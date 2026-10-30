import "server-only";

import { randomBytes } from "node:crypto";
import { Prisma, type PurchaseOrderShare } from "@prisma/client";
import { z } from "zod";

import { toBangkokDateValue, toBangkokIsoString } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { PurchaseOrderDocument, PurchaseOrderDocumentData } from "@/lib/purchase-order-document";
import {
  PURCHASE_ORDER_SHARE_DEFAULT_DAYS,
  PURCHASE_ORDER_SHARE_LIFETIME_ERROR,
  PURCHASE_ORDER_SHARE_MAX_DAYS,
  PURCHASE_ORDER_SHARE_MIN_DAYS,
} from "@/lib/purchase-order-share";
import type { PurchaseOrderShareState, SessionUser } from "@/lib/types";
import { isPurchasing } from "@/server/auth/authorization";
import { companyIdentitySchema } from "@/server/company/company.schemas";
import { getDb } from "@/server/db";
import { assertCanViewOrderSources, orderSources } from "@/server/purchase-orders/purchase-order-access";
import { buildPurchaseOrderDocument } from "@/server/purchase-orders/purchase-order-document";
import { lockPurchaseRequests } from "@/server/purchase-orders/purchase-order-state";
import { AppError, invariant } from "@/server/shared/errors";
import { supplierContactSchema } from "@/server/suppliers/supplier.schemas";

const millisecondsPerDay = 24 * 60 * 60 * 1000;
export const sharedPurchaseOrderUnavailableMessage = "ไม่พบเอกสารหรือลิงก์นี้ไม่สามารถใช้งานได้แล้ว";

export const purchaseOrderShareResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
};

export function purchaseOrderSupplierKey(order: { supplierId: string | null; supplierName: string }) {
  return order.supplierId ? `registered:${order.supplierId}`
    : `manual:${order.supplierName.normalize("NFKC").trim().toLowerCase()}`;
}

const sourceAccessSelect = {
  id: true, status: true, requesterId: true, department: true, currentApproverId: true,
  approvals: { where: { action: "APPROVED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { approverId: true } },
} satisfies Prisma.PurchaseRequestSelect;

const managementSelect = {
  id: true, poNumber: true, status: true, supplierId: true, supplierName: true,
  purchaseRequest: { select: sourceAccessSelect },
  purchaseRequests: { select: sourceAccessSelect, orderBy: { id: "asc" } },
  share: true,
} satisfies Prisma.PurchaseOrderSelect;

type ManagedOrder = Prisma.PurchaseOrderGetPayload<{ select: typeof managementSelect }>;

function isOrderShareable(order: { status: string; purchaseRequest: { status: string }; purchaseRequests: Array<{ status: string }> }) {
  return order.status === "ISSUED" && [order.purchaseRequest, ...order.purchaseRequests]
    .every((source) => source.status !== "CANCELLED" && source.status !== "CANCEL_REQUESTED");
}

function shareState(share: PurchaseOrderShare | null, order: ManagedOrder): PurchaseOrderShareState {
  const isActive = Boolean(share && !share.revokedAt && share.expiresAt.getTime() > Date.now()
    && isOrderShareable(order) && share.supplierKey === purchaseOrderSupplierKey(order));
  return {
    id: share?.id ?? null,
    path: isActive && share ? `/shared/purchase-orders/${share.token}` : null,
    expiresAt: share ? toBangkokIsoString(share.expiresAt) : null,
    expiresInDays: share ? Math.round((share.expiresAt.getTime() - share.createdAt.getTime()) / millisecondsPerDay)
      : PURCHASE_ORDER_SHARE_DEFAULT_DAYS,
    isActive,
  };
}

function assertManager(session: SessionUser) {
  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อหรือแอดมินเท่านั้นที่จัดการลิงก์ PO ได้", 403);
}

async function managedOrder(transaction: Prisma.TransactionClient, id: string, session: SessionUser, lock: boolean) {
  if (lock) {
    const reference = await transaction.purchaseOrder.findUnique({
      where: { id }, select: { purchaseRequestId: true, purchaseRequests: { select: { id: true } } },
    });
    invariant(reference, "ไม่พบเอกสาร PO ที่ต้องการ", 404);
    await lockPurchaseRequests(transaction, [reference.purchaseRequestId, ...reference.purchaseRequests.map((source) => source.id)]);
    await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} FOR UPDATE`);
  }
  const order = await transaction.purchaseOrder.findUnique({ where: { id }, select: managementSelect });
  invariant(order, "ไม่พบเอกสาร PO ที่ต้องการ", 404);
  assertCanViewOrderSources(session, orderSources(order));
  return order;
}

async function recordShareAction(transaction: Prisma.TransactionClient, order: ManagedOrder, session: SessionUser, action: string, expiresAt?: Date) {
  for (const source of orderSources(order)) {
    await transaction.approval.create({ data: {
      purchaseRequestId: source.id, approverId: session.id, action: "COMMENTED",
      stepLabel: "ลิงก์ PO สำหรับผู้ขาย",
      // Never put the capability or path in the internal timeline.
      comment: `${order.poNumber} · ${action}${expiresAt ? `\nหมดอายุ: ${toBangkokIsoString(expiresAt)}` : ""}`,
    } });
  }
}

export async function getPurchaseOrderShare(id: string, session: SessionUser): Promise<PurchaseOrderShareState> {
  assertManager(session);
  return getDb().$transaction(async (transaction) => {
    const order = await managedOrder(transaction, id, session, false);
    return shareState(order.share, order);
  });
}

export async function createPurchaseOrderShare(
  id: string,
  session: SessionUser,
  input: { renew?: true; expectedShareId?: string; expiresInDays?: number } = {},
): Promise<PurchaseOrderShareState> {
  assertManager(session);
  const expiresInDays = input.expiresInDays === undefined ? PURCHASE_ORDER_SHARE_DEFAULT_DAYS : input.expiresInDays;
  invariant(Number.isInteger(expiresInDays) && expiresInDays >= PURCHASE_ORDER_SHARE_MIN_DAYS
    && expiresInDays <= PURCHASE_ORDER_SHARE_MAX_DAYS, PURCHASE_ORDER_SHARE_LIFETIME_ERROR, 400);
  invariant(!input.renew || Boolean(input.expectedShareId), "กรุณาโหลดข้อมูลลิงก์ใหม่ก่อนสร้างลิงก์ใหม่", 400);
  return getDb().$transaction(async (transaction) => {
    const order = await managedOrder(transaction, id, session, true);
    invariant(isOrderShareable(order), "ไม่สามารถแชร์ PO ที่ยกเลิกหรือ PR กำลังรอยกเลิกได้", 400);
    const current = order.share;
    if (input.renew) invariant(current?.id === input.expectedShareId, "ลิงก์ PO มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
    if (!input.renew && shareState(current, order).isActive) return shareState(current, order);
    if (current) await transaction.purchaseOrderShare.delete({ where: { id: current.id } });
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + expiresInDays * millisecondsPerDay);
    const share = await transaction.purchaseOrderShare.create({ data: {
      purchaseOrderId: id, token: randomBytes(32).toString("base64url"),
      supplierKey: purchaseOrderSupplierKey(order), createdById: session.id, createdAt, expiresAt,
    } });
    await recordShareAction(transaction, order, session,
      `${input.renew ? "สร้างลิงก์ใหม่แทนลิงก์เดิม" : "สร้างลิงก์สำหรับผู้ขาย"} · อายุลิงก์ ${expiresInDays} วัน`, expiresAt);
    return shareState(share, order);
  }, { timeout: 15000 });
}

export async function revokePurchaseOrderShare(
  id: string,
  session: SessionUser,
  input: { expectedShareId: string },
): Promise<PurchaseOrderShareState> {
  assertManager(session);
  invariant(Boolean(input.expectedShareId), "กรุณาโหลดข้อมูลลิงก์ใหม่ก่อนปิดลิงก์", 400);
  return getDb().$transaction(async (transaction) => {
    const order = await managedOrder(transaction, id, session, true);
    invariant(order.share?.id === input.expectedShareId, "ลิงก์ PO มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
    if (order.share.revokedAt) return shareState(order.share, order);
    const share = await transaction.purchaseOrderShare.update({
      where: { id: order.share.id }, data: { revokedAt: new Date(), revokedById: session.id },
    });
    await recordShareAction(transaction, order, session, "ปิดลิงก์สำหรับผู้ขาย");
    return shareState(share, order);
  }, { timeout: 15000 });
}

const publicSourceSelect = { prNumber: true, status: true } satisfies Prisma.PurchaseRequestSelect;
const publicOrderSelect = {
  poNumber: true, status: true, issuedAt: true, revision: true,
  supplierName: true, supplierCode: true, supplierTaxId: true,
  supplierContactPerson: true, supplierContacts: true, supplierAddress: true, supplierContact: true,
  buyerCompany: true, deliveryAddress: true, deliveryRecipientName: true, deliveryRecipientPhone: true,
  paymentTerms: true, expectedDeliveryDate: true, note: true, totalAmount: true,
  taxMode: true, vatRate: true, discountType: true, discountValue: true,
  createdBy: { select: { name: true } },
  purchaseRequest: { select: publicSourceSelect },
  purchaseRequests: { select: publicSourceSelect, orderBy: { prNumber: "asc" } },
  items: { orderBy: { position: "asc" }, select: {
    sourcePurchaseRequest: { select: { prNumber: true } },
    itemName: true, description: true, quantity: true,
    unit: true, unitPrice: true, amount: true, taxMode: true,
    discountType: true, discountValue: true, orderDiscountAmount: true,
  } },
} satisfies Prisma.PurchaseOrderSelect;

/** Public reads select only the issued commercial document, never revisions or PR notes. */
export async function getSharedPurchaseOrderDocument(token: string, locale: Locale): Promise<{
  document: PurchaseOrderDocument;
  poNumber: string;
  revision: number;
  supplierName: string;
  expiresAt: string;
}> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(sharedPurchaseOrderUnavailableMessage, 404);
  const share = await getDb().$transaction(async (transaction) => {
    // Apply capability and cancellation predicates in SQL before resolving any
    // commercial content. Development RSC debug output can serialize resolved
    // query values even when the surrounding page subsequently returns 404.
    const where = {
      token, revokedAt: null, expiresAt: { gt: new Date() },
      purchaseOrder: {
        status: "ISSUED",
        purchaseRequest: { status: { notIn: ["CANCELLED", "CANCEL_REQUESTED"] } },
        purchaseRequests: { none: { status: { in: ["CANCELLED", "CANCEL_REQUESTED"] } } },
      },
    } satisfies Prisma.PurchaseOrderShareWhereInput;
    const authorization = await transaction.purchaseOrderShare.findFirst({
      where, select: {
        supplierKey: true,
        purchaseOrder: { select: { supplierId: true, supplierName: true } },
      },
    });
    if (!authorization || authorization.supplierKey !== purchaseOrderSupplierKey(authorization.purchaseOrder)) return null;
    return transaction.purchaseOrderShare.findFirst({
      where: { ...where, expiresAt: { gt: new Date() }, supplierKey: authorization.supplierKey }, select: {
        expiresAt: true,
        purchaseOrder: { select: publicOrderSelect },
      },
    });
  }, { isolationLevel: "RepeatableRead" });
  if (!share) {
    throw new AppError(sharedPurchaseOrderUnavailableMessage, 404);
  }
  const order = share.purchaseOrder;
  const contacts = z.array(supplierContactSchema).safeParse(order.supplierContacts);
  const company = companyIdentitySchema.safeParse(order.buyerCompany);
  // PR numbers are already printed references and make safe renderer keys;
  // PR database identifiers must never enter public query results or Flight data.
  const publicSource = (source: typeof order.purchaseRequest) => ({ ...source, id: source.prNumber });
  const sources = orderSources(order).map(publicSource);
  const documentData: PurchaseOrderDocumentData = {
    poNumber: order.poNumber, status: order.status, issuedAt: toBangkokIsoString(order.issuedAt), revision: order.revision,
    supplierName: order.supplierName, supplierCode: order.supplierCode, supplierTaxId: order.supplierTaxId,
    supplierAddress: order.supplierAddress, supplierContactPerson: order.supplierContactPerson,
    supplierContact: order.supplierContact, supplierContacts: contacts.success ? contacts.data : [],
    buyerCompany: company.success ? company.data : null,
    deliveryAddress: order.deliveryAddress, deliveryRecipientName: order.deliveryRecipientName,
    deliveryRecipientPhone: order.deliveryRecipientPhone, paymentTerms: order.paymentTerms,
    expectedDeliveryDate: order.expectedDeliveryDate ? toBangkokDateValue(order.expectedDeliveryDate) : null,
    note: order.note, totalAmount: Number(order.totalAmount),
    taxMode: order.taxMode, vatRate: Number(order.vatRate),
    discountType: order.discountType, discountValue: Number(order.discountValue),
    createdBy: order.createdBy, purchaseRequest: publicSource(order.purchaseRequest), purchaseRequests: sources,
    items: order.items.map((item) => ({
      sourcePurchaseRequestId: item.sourcePurchaseRequest.prNumber,
      sourcePrNumber: item.sourcePurchaseRequest.prNumber,
      itemName: item.itemName, description: item.description, quantity: item.quantity, unit: item.unit,
      unitPrice: Number(item.unitPrice), amount: Number(item.amount), taxMode: item.taxMode,
      discountType: item.discountType, discountValue: Number(item.discountValue), orderDiscountAmount: Number(item.orderDiscountAmount),
    })),
  };
  return {
    document: await buildPurchaseOrderDocument(documentData, locale),
    poNumber: order.poNumber, revision: order.revision, supplierName: order.supplierName,
    expiresAt: toBangkokIsoString(share.expiresAt),
  };
}
