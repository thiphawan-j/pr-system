import "server-only";

import { createHash } from "node:crypto";
import { ApprovalAction, NotificationType, Prisma, type PurchaseRequestItem, type PurchasePriceTaxMode, type PurchaseDiscountType } from "@prisma/client";
import { calculatePurchaseOrderPricing, calculateTaxLine } from "@/lib/purchase-order-tax";
import { toBangkokDateValue, toBangkokIsoString, toBangkokMonthValue } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { PurchaseOrderDocumentData } from "@/lib/purchase-order-document";
import type { PurchaseOrderCreationPreview, PurchaseOrderSummary, SessionUser } from "@/lib/types";
import { isPurchasing } from "@/server/auth/authorization";
import { companyIdentity, lockCompanyProfile } from "@/server/company/company.service";
import { getDb } from "@/server/db";
import { createNotifications } from "@/server/notifications/notification.service";
import type { PurchaseOrderCombinedConversionInput, PurchaseOrderConversionInput } from "@/server/purchase-orders/purchase-order.schemas";
import { defaultPurchaseOrderRecipient, resolvePurchaseOrderRecipient } from "@/server/purchase-orders/purchase-order-recipient";
import { buildPurchaseOrderDocument } from "@/server/purchase-orders/purchase-order-document";
import { lockPurchaseRequests, refreshPurchaseRequestsAfterOrderChange } from "@/server/purchase-orders/purchase-order-state";
import { AppError, invariant } from "@/server/shared/errors";
import { formatSupplierCode } from "@/server/suppliers/supplier.service";

const maximumPreparationAmount = new Prisma.Decimal("9999999999.99");

type ConversionInput = Pick<PurchaseOrderConversionInput, "items" | "orders" | "previewFingerprint">;
type ConversionSources = Array<{ id: string; expectedUpdatedAt?: string }>;

export class PurchaseOrderPreviewChangedError extends AppError {
  readonly code = "PO_PREVIEW_CHANGED";

  constructor() {
    super("ข้อมูลสำหรับ Preview เปลี่ยนแปลง กรุณาดู Preview ใหม่ก่อนยืนยันสร้าง PO", 409);
  }
}

type PreparedConversionItem = {
  clientId: string;
  sourceItemId?: string;
  sourcePurchaseRequestId: string;
  itemName: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
  taxMode: PurchasePriceTaxMode | null;
  discountType: PurchaseDiscountType;
  discountValue: Prisma.Decimal;
  orderDiscountAmount: Prisma.Decimal;
};

function prepareConversionItems(input: ConversionInput, originals: PurchaseRequestItem[], requestIds: string[]) {
  if (!input.items) return null;
  const sourceIds = new Set(originals.map((item) => item.id));
  const originalsById = new Map(originals.map((item) => [item.id, item]));
  const retainedSourceIds = input.items.flatMap((item) => item.sourceItemId ? [item.sourceItemId] : []);
  invariant(retainedSourceIds.every((itemId) => sourceIds.has(itemId)), "ไม่พบรายการสินค้าใน PR นี้", 400);
  invariant(new Set(retainedSourceIds).size === retainedSourceIds.length &&
    new Set(input.items.map((item) => item.clientId)).size === input.items.length,
  "รายการสินค้าซ้ำกัน", 400);
  // An approved, unissued PR normally has no receipt activity. Keep this guard
  // explicit so preparation can never discard an existing receiving ledger.
  invariant(originals.every((item) => item.receivedQuantity === 0 && item.closedQuantity === 0),
    "ไม่สามารถปรับรายการก่อนออก PO ของ PR ที่มีการรับสินค้าหรือปิดยอดแล้ว", 400);

  const items: PreparedConversionItem[] = input.items.map((item) => {
    const original = item.sourceItemId ? originalsById.get(item.sourceItemId) : undefined;
    invariant(!item.sourcePurchaseRequestId || requestIds.includes(item.sourcePurchaseRequestId), "ไม่พบ PR ต้นทางของสินค้า", 400);
    invariant(!original || !item.sourcePurchaseRequestId || item.sourcePurchaseRequestId === original.purchaseRequestId, "PR ต้นทางของสินค้าไม่ตรงกัน", 400);
    invariant(original || requestIds.length === 1 || item.sourcePurchaseRequestId, "กรุณาระบุ PR ต้นทางของสินค้าใหม่", 400);
    const unitPrice = new Prisma.Decimal(item.unitPrice);
    // Older PRs can have an authoritative stored line amount without a unit
    // price. Changing a discount or description must not erase that amount.
    const amount = original && original.quantity === item.quantity && (original.unitPrice ?? new Prisma.Decimal(0)).equals(unitPrice)
      ? original.amount : unitPrice.times(item.quantity);
    invariant(amount.lte(maximumPreparationAmount), "ยอดเงินมากเกินขอบเขตที่รองรับ", 400);

    return {
      clientId: item.clientId, sourceItemId: item.sourceItemId,
      sourcePurchaseRequestId: original?.purchaseRequestId ?? item.sourcePurchaseRequestId ?? requestIds[0]!,
      itemName: item.itemName, description: item.description ?? null,
      quantity: item.quantity, unit: item.unit ?? null, unitPrice, amount, taxMode: item.taxMode ?? null,
      discountType: item.discountType ?? original?.discountType ?? "NONE",
      discountValue: new Prisma.Decimal(item.discountType === "NONE" ? 0 : item.discountValue ?? original?.discountValue ?? 0),
      orderDiscountAmount: new Prisma.Decimal(0),
    };
  });
  return { items };
}

function preparationItemSummary(item: Pick<PurchaseRequestItem, "itemName" | "description" | "quantity" | "unit" | "unitPrice" | "amount"> & { taxMode?: PurchasePriceTaxMode | null; vatRate?: Prisma.Decimal; discountType?: PurchaseDiscountType; discountValue?: Prisma.Decimal; orderDiscountAmount?: Prisma.Decimal }) {
  const mode = item.taxMode ?? "UNSPECIFIED";
  const rate = Number(item.vatRate ?? 7);
  const tax = calculateTaxLine(item.amount.toString(), mode, rate, { discountType: item.discountType ?? "NONE", discountValue: Number(item.discountValue ?? 0), orderDiscountAmount: Number(item.orderDiscountAmount ?? 0) });
  return [
    `ชื่อสินค้า: ${item.itemName}`,
    `รายละเอียด: ${item.description ?? "—"}`,
    `จำนวน: ${item.quantity}`,
    `หน่วย: ${item.unit ?? "—"}`,
    `ราคาต่อหน่วย: ${item.unitPrice ? `${item.unitPrice.toFixed(2)} บาท` : "ไม่ได้ระบุ"}`,
    `ยอดรวม: ${item.amount.toFixed(2)} บาท`,
    ...(item.discountType && item.discountType !== "NONE" || !new Prisma.Decimal(item.orderDiscountAmount ?? 0).equals(0) ? [
      `ส่วนลดรายการ: ${(item.discountValue ?? new Prisma.Decimal(0)).toFixed(2)} ${item.discountType === "PERCENT" ? "%" : "บาท"}`,
      `ส่วนลดทั้งใบที่จัดสรร: ${(item.orderDiscountAmount ?? new Prisma.Decimal(0)).toFixed(2)} บาท`,
    ] : []),
    `รูปแบบภาษี: ${taxModeLabel(mode)}`, `อัตรา VAT: ${rate.toFixed(2)}%`,
    `ยอดสุทธิ: ${tax.netAmount === null ? "ไม่ได้ระบุ" : `${tax.netAmount.toFixed(2)} บาท`}`,
    `VAT: ${tax.taxAmount === null ? "ไม่ได้ระบุ" : `${tax.taxAmount.toFixed(2)} บาท`}`,
    `ยอดชำระ: ${tax.totalAmount.toFixed(2)} บาท`,
  ].join(" | ");
}

function taxModeLabel(mode: PurchasePriceTaxMode) {
  return { UNSPECIFIED: "ไม่ได้ระบุ", INCLUSIVE: "รวม VAT แล้ว", EXCLUSIVE: "ยังไม่รวม VAT", NONE: "ไม่มี VAT" }[mode];
}

function preparationAuditComment(originals: PurchaseRequestItem[], items: Array<PreparedConversionItem & { vatRate?: Prisma.Decimal }>, beforeTotal: Prisma.Decimal, afterTotal: Prisma.Decimal) {
  const byId = new Map(originals.map((item) => [item.id, item]));
  const retainedIds = new Set(items.flatMap((item) => item.sourceItemId ? [item.sourceItemId] : []));
  const changes: string[] = [];
  for (const original of originals) {
    if (!retainedIds.has(original.id)) changes.push(`ลบสินค้า: ${preparationItemSummary(original)}`);
  }
  for (const item of items) {
    const original = item.sourceItemId ? byId.get(item.sourceItemId) : undefined;
    if (!original) {
      changes.push(`เพิ่มสินค้า: ${preparationItemSummary(item)}`);
    } else if (original.itemName !== item.itemName || original.description !== item.description ||
      original.quantity !== item.quantity || original.unit !== item.unit ||
      !(original.unitPrice ?? new Prisma.Decimal(0)).equals(item.unitPrice) || !original.amount.equals(item.amount) ||
      original.taxMode !== (item.taxMode ?? "UNSPECIFIED") || !original.vatRate.equals(item.vatRate ?? 7) ||
      original.discountType !== item.discountType || !original.discountValue.equals(item.discountValue) || !original.orderDiscountAmount.equals(item.orderDiscountAmount)) {
      changes.push(`แก้ไขสินค้า\nก่อน: ${preparationItemSummary(original)}\nหลัง: ${preparationItemSummary(item)}`);
    }
  }
  if (!changes.length && beforeTotal.equals(afterTotal)) return null;
  return [`ปรับรายการก่อนออก PO โดยฝ่ายจัดซื้อ`,
    `ยอดรวม PR: ${beforeTotal.toFixed(2)} → ${afterTotal.toFixed(2)} บาท`,
    `ยอดรวม PO: ${afterTotal.toFixed(2)} บาท`, ...changes].join("\n");
}

async function prepareIssuance(
  transaction: Prisma.TransactionClient,
  session: SessionUser,
  sources: ConversionSources,
  input: ConversionInput,
) {
  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
  const sourceIds = sources.map((source) => source.id).sort();
  invariant(sourceIds.length > 0 && new Set(sourceIds).size === sourceIds.length, "รายการ PR ซ้ำกัน", 400);
  await lockCompanyProfile(transaction, "shared");
  await lockPurchaseRequests(transaction, sourceIds);
  const company = await transaction.companyProfile.findUnique({ where: { id: "default" } });
  const requests = await transaction.purchaseRequest.findMany({
    where: { id: { in: sourceIds } }, orderBy: { id: "asc" },
    include: {
      items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: {
        purchaseOrderItems: { where: { purchaseOrder: { status: "ISSUED" } }, select: { id: true } },
      } },
      purchaseOrders: { select: { id: true, changes: { where: { status: "PENDING" }, select: { id: true }, take: 1 }, status: true } },
    },
  });
  invariant(requests.length === sourceIds.length, "ไม่พบเอกสาร PR ที่ต้องการ", 404);
  for (const request of requests) {
    invariant((request.status === "APPROVED" || request.status === "ORDERED") && !request.completedAt,
      "PR ต้องได้รับการอนุมัติและยังไม่ปิดงานก่อนแปลงเป็น PO", 400);
    invariant(request.status !== "ORDERED" || request.purchaseOrders.length > 0,
      "PR นี้สั่งซื้อภายนอกระบบแล้ว ไม่สามารถเปิด PO ซ้ำได้", 400);
    invariant(!request.purchaseOrders.some((order) => order.status === "ISSUED" && order.changes.length),
      "กรุณาพิจารณาคำขอแก้ไข PO ให้เสร็จก่อนออก PO เพิ่ม", 409);
    const expected = sources.find((source) => source.id === request.id)?.expectedUpdatedAt;
    invariant(!expected || new Date(expected).getTime() === request.updatedAt.getTime(),
      "ข้อมูล PR มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
  }
  const pendingOriginals = requests.flatMap((request) => request.items.filter((item) =>
    item.purchaseOrderItems.length === 0 && item.receivedQuantity === 0 && item.closedQuantity === 0));
  const prepared = prepareConversionItems(input, pendingOriginals, sourceIds);
  const conversionItems: Array<PreparedConversionItem & { supplierName?: string | null }> = prepared?.items
    ?? pendingOriginals.map((item) => ({ ...item, clientId: item.id, sourceItemId: item.id,
      sourcePurchaseRequestId: item.purchaseRequestId, unitPrice: item.unitPrice ?? new Prisma.Decimal(0),
      taxMode: item.taxMode === "UNSPECIFIED" ? null : item.taxMode,
    }));
  const selectedIds = input.orders.flatMap((order) => order.itemIds);
  const eligibleIds = new Set(conversionItems.map((item) => item.clientId));
  invariant(selectedIds.length > 0 && new Set(selectedIds).size === selectedIds.length
    && selectedIds.every((id) => eligibleIds.has(id)),
  "รายการสินค้าถูกเปิด PO แล้วหรือไม่พร้อมสั่งซื้อ กรุณาโหลดข้อมูลใหม่", 409);

  const supplierIds = [...new Set(input.orders.flatMap((order) => "supplierId" in order ? [order.supplierId] : []))].sort();
  if (supplierIds.length) await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Supplier" WHERE "id" IN (${Prisma.join(supplierIds)}) ORDER BY "id" FOR SHARE
  `);
  const suppliers = await transaction.supplier.findMany({ where: { id: { in: supplierIds } }, include: { contacts: { orderBy: { channel: "asc" } } } });
  invariant(suppliers.length === supplierIds.length && suppliers.every((supplier) => supplier.isActive),
    "ผู้ขายที่เลือกถูกปิดใช้งานแล้ว กรุณาเลือกผู้ขายใหม่", 400);
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const supplierNames = new Map(input.orders.flatMap((order) => order.itemIds.map((id) => [id,
    "supplierId" in order ? suppliersById.get(order.supplierId)!.name : order.supplierName] as const)));
  const orders = [];
  for (const order of input.orders) {
    const registered = "supplierId" in order ? suppliersById.get(order.supplierId)! : null;
    const manual = "supplierName" in order ? order : null;
    invariant(registered || manual, "กรุณาระบุผู้ขายของทุกรายการ", 400);
    const supplierData = {
      supplierId: registered?.id ?? null,
      supplierCode: registered ? formatSupplierCode(registered.code) : null,
      supplierName: registered?.name ?? manual!.supplierName,
      supplierAddress: registered?.address ?? (registered ? null : manual?.supplierAddress ?? null),
      supplierContact: registered ? null : manual?.supplierContact ?? null,
      supplierTaxId: registered?.taxId ?? null,
      supplierContactPerson: registered?.contactPerson ?? null,
      supplierContacts: registered?.contacts.map(({ channel, value }) => ({ channel, value })) ?? [],
      paymentTerms: registered?.paymentTerms ?? (registered ? null : manual?.paymentTerms ?? null),
    };
    const chosen = new Set(order.itemIds);
    const items = conversionItems.filter((item) => chosen.has(item.clientId));
    const requestIds = [...new Set(items.map((item) => item.sourcePurchaseRequestId))].sort();
    const requesterId = requests.find((request) => request.id === items[0]!.sourcePurchaseRequestId)!.requesterId;
    const recipient = order.deliveryRecipientId === undefined
      ? await defaultPurchaseOrderRecipient(transaction, requesterId)
      : await resolvePurchaseOrderRecipient(transaction, order.deliveryRecipientId);
    const taxMode = order.taxMode ?? "UNSPECIFIED";
    const vatRate = order.vatRate ?? 7;
    const discountType = order.discountType ?? "NONE";
    const discountValue = order.discountType === "NONE" ? 0 : order.discountValue ?? 0;
    let pricing;
    try {
      pricing = calculatePurchaseOrderPricing(items.map((item) => ({ amount: item.amount.toString(),
        taxMode: item.taxMode, discountType: item.discountType, discountValue: Number(item.discountValue),
      })), taxMode, vatRate, { discountType, discountValue });
    } catch {
      throw new AppError("ส่วนลดหรือยอดเงินไม่ถูกต้อง ส่วนลดต้องไม่เกินยอดสินค้าที่เหลือ", 400);
    }
    orders.push({ order, supplierData, items, requestIds, recipient, taxMode, vatRate, discountType, discountValue, pricing });
  }

  // Preview must reject the same empty-source and aggregate-overflow cases as
  // issuance, without updating source rows merely to calculate their totals.
  const pendingById = new Map(pendingOriginals.map((item) => [item.id, item]));
  const termsById = new Map(orders.flatMap((group) => group.items.map((item, index) => [item.clientId, {
    taxMode: item.taxMode ?? group.taxMode, vatRate: new Prisma.Decimal(group.vatRate),
    orderDiscountAmount: new Prisma.Decimal(group.pricing.lines[index]!.orderDiscountAmount),
  }] as const)));
  const projectedRequestTotals = requests.map((request) => {
    const rows = [
      ...request.items.filter((item) => !pendingById.has(item.id)),
      ...conversionItems.filter((item) => item.sourcePurchaseRequestId === request.id).map((item) => {
        const original = item.sourceItemId ? pendingById.get(item.sourceItemId) : undefined;
        const values = prepared ? {
          ...item, taxMode: item.taxMode ?? original?.taxMode ?? "UNSPECIFIED" as PurchasePriceTaxMode,
          vatRate: original?.vatRate ?? new Prisma.Decimal(7), orderDiscountAmount: new Prisma.Decimal(0),
        } : { ...original! };
        return { ...values, ...termsById.get(item.clientId) };
      }),
    ];
    invariant(rows.length > 0, "PR ต้องมีสินค้าอย่างน้อยหนึ่งรายการ ไม่สามารถลบทุกรายการของ PR ได้", 400);
    let totalAmount = new Prisma.Decimal(0);
    try {
      totalAmount = rows.reduce((sum, item) => sum.plus(calculateTaxLine(
        item.amount.toString(), item.taxMode, Number(item.vatRate), {
          discountType: item.discountType, discountValue: Number(item.discountValue), orderDiscountAmount: Number(item.orderDiscountAmount),
        },
      ).totalAmount), totalAmount);
    } catch {
      throw new AppError("ส่วนลดหรือยอดเงินไม่ถูกต้อง ส่วนลดต้องไม่เกินยอดสินค้าที่เหลือ", 400);
    }
    invariant(totalAmount.lte(maximumPreparationAmount), "ยอดรวม PR มากเกินขอบเขตที่รองรับ", 400);
    return { id: request.id, totalAmount: totalAmount.toFixed(2) };
  });
  return { company, requests, pendingOriginals, prepared, conversionItems, sourceIds, suppliersById, supplierNames, orders, projectedRequestTotals };
}

type PreparedIssuance = Awaited<ReturnType<typeof prepareIssuance>>;

function previewDocumentData(prepared: PreparedIssuance, session: SessionUser, issuedAt: Date): PurchaseOrderDocumentData[] {
  return prepared.orders.map((group) => {
    const sources = group.requestIds.map((id) => {
      const source = prepared.requests.find((request) => request.id === id)!;
      return { id: source.id, prNumber: source.prNumber, status: source.status };
    });
    return {
      poNumber: "PREVIEW", status: "ISSUED", revision: 0,
      // Document headers display a Bangkok calendar date, not this request's
      // transient timestamp. Crossing midnight requires another preview.
      issuedAt: toBangkokDateValue(issuedAt),
      createdBy: { name: session.name }, buyerCompany: prepared.company ? companyIdentity(prepared.company) : null,
      ...group.supplierData, ...group.recipient,
      deliveryAddress: group.order.deliveryAddress ?? null,
      expectedDeliveryDate: group.order.expectedDeliveryDate ?? null,
      note: group.order.note ?? null, totalAmount: group.pricing.totalAmount,
      taxMode: group.taxMode, vatRate: group.vatRate, discountType: group.discountType, discountValue: group.discountValue,
      purchaseRequest: sources[0]!, purchaseRequests: sources,
      items: group.items.map((item, index) => ({
        sourcePurchaseRequestId: item.sourcePurchaseRequestId,
        sourcePrNumber: sources.find((source) => source.id === item.sourcePurchaseRequestId)?.prNumber,
        itemName: item.itemName, description: item.description, quantity: item.quantity, unit: item.unit,
        unitPrice: Number(item.unitPrice), amount: Number(item.amount), taxMode: item.taxMode,
        discountType: item.discountType, discountValue: Number(item.discountValue),
        orderDiscountAmount: group.pricing.lines[index]!.orderDiscountAmount,
      })),
    };
  });
}

function previewFingerprint(prepared: PreparedIssuance, session: SessionUser, issuedAt: Date) {
  return createHash("sha256").update(JSON.stringify({
    sources: prepared.requests.map((request) => ({ id: request.id, updatedAt: request.updatedAt.toISOString() })),
    documents: previewDocumentData(prepared, session, issuedAt),
    preparationItems: prepared.conversionItems,
    projectedRequestTotals: prepared.projectedRequestTotals,
  })).digest("hex");
}

async function previewPurchaseOrders(session: SessionUser, sources: ConversionSources, input: ConversionInput, locale: Locale): Promise<PurchaseOrderCreationPreview> {
  const issuedAt = new Date();
  const prepared = await getDb().$transaction((transaction) => prepareIssuance(transaction, session, sources, input), { timeout: 30000 });
  const documents = previewDocumentData(prepared, session, issuedAt);
  return {
    previewFingerprint: previewFingerprint(prepared, session, issuedAt),
    orders: await Promise.all(documents.map(async (data) => ({
      supplierName: data.supplierName, itemCount: data.items.length, totalAmount: data.totalAmount,
      document: await buildPurchaseOrderDocument(data, locale, { draft: true }),
    }))),
  };
}

export async function previewPurchaseRequestOrders(id: string, session: SessionUser, input: PurchaseOrderConversionInput, locale: Locale) {
  assertConversionVersion(input);
  return previewPurchaseOrders(session, [{ id, expectedUpdatedAt: input.expectedUpdatedAt }], input, locale);
}

export async function previewCombinedPurchaseOrders(session: SessionUser, input: PurchaseOrderCombinedConversionInput, locale: Locale) {
  return previewPurchaseOrders(session, input.requests, input, locale);
}

function assertConversionVersion(input: PurchaseOrderConversionInput) {
  invariant(!(input.items || input.orders.some((order) => order.taxMode !== undefined || order.vatRate !== undefined || order.discountType !== undefined || order.discountValue !== undefined)) || input.expectedUpdatedAt,
    "กรุณาโหลดข้อมูล PR ใหม่ก่อนแก้ไขรายการ", 400);
}

export async function convertPurchaseRequestToOrders(
  id: string,
  session: SessionUser,
  input: PurchaseOrderConversionInput,
): Promise<PurchaseOrderSummary[]> {
  assertConversionVersion(input);
  return issuePurchaseOrders(session, [{ id, expectedUpdatedAt: input.expectedUpdatedAt }], input);
}

export async function combinePurchaseRequestsToOrders(
  session: SessionUser,
  input: PurchaseOrderCombinedConversionInput,
): Promise<PurchaseOrderSummary[]> {
  return issuePurchaseOrders(session, input.requests, input);
}

async function issuePurchaseOrders(
  session: SessionUser,
  sources: ConversionSources,
  input: ConversionInput,
): Promise<PurchaseOrderSummary[]> {
  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
  const sourceIds = sources.map((source) => source.id).sort();
  invariant(sourceIds.length > 0 && new Set(sourceIds).size === sourceIds.length, "รายการ PR ซ้ำกัน", 400);
  const issuedAt = new Date();
  const { purchaseOrders, notifications } = await getDb().$transaction(async (transaction) => {
    const preparation = await prepareIssuance(transaction, session, sources, input);
    const { company, requests, pendingOriginals, prepared, conversionItems, supplierNames, orders } = preparation;
    if (input.previewFingerprint && input.previewFingerprint !== previewFingerprint(preparation, session, issuedAt)) {
      throw new PurchaseOrderPreviewChangedError();
    }

    if (prepared) {
      const retained = new Set(prepared.items.flatMap((item) => item.sourceItemId ? [item.sourceItemId] : []));
      const deleted = pendingOriginals.filter((item) => !retained.has(item.id)).map((item) => item.id);
      if (deleted.length) {
        // A cancelled document keeps its issued snapshot and origin even after
        // the now-pending commercial source row is explicitly removed.
        await transaction.purchaseOrderItem.updateMany({
          where: { purchaseRequestItemId: { in: deleted }, purchaseOrder: { status: "CANCELLED" } },
          data: { purchaseRequestItemId: null },
        });
        await transaction.purchaseRequestItem.deleteMany({ where: { id: { in: deleted } } });
      }
      for (const item of conversionItems) {
        const original = pendingOriginals.find((source) => source.id === item.sourceItemId);
        const fields = {
          itemName: item.itemName, description: item.description, quantity: item.quantity,
          unit: item.unit, unitPrice: item.unitPrice, amount: item.amount,
          supplierName: supplierNames.get(item.clientId) ?? original?.supplierName ?? null,
          taxMode: item.taxMode ?? original?.taxMode ?? "UNSPECIFIED" as PurchasePriceTaxMode,
          discountType: item.discountType, discountValue: item.discountValue,
          orderDiscountAmount: new Prisma.Decimal(0),
        };
        const source = item.sourceItemId
          ? await transaction.purchaseRequestItem.update({ where: { id: item.sourceItemId }, data: fields })
          : await transaction.purchaseRequestItem.create({ data: { ...fields, purchaseRequestId: item.sourcePurchaseRequestId } });
        item.sourceItemId = source.id;
      }
      const nonemptySources = await transaction.purchaseRequestItem.groupBy({
        by: ["purchaseRequestId"], where: { purchaseRequestId: { in: sourceIds } },
      });
      const retainedSources = new Set(nonemptySources.map((item) => item.purchaseRequestId));
      invariant(sourceIds.every((id) => retainedSources.has(id)),
        "PR ต้องมีสินค้าอย่างน้อยหนึ่งรายการ ไม่สามารถลบทุกรายการของ PR ได้", 400);
    }

    const key = toBangkokMonthValue(issuedAt).replace("-", "");
    const sequence = await transaction.purchaseOrderNumberSequence.upsert({
      where: { key }, create: { key, nextValue: input.orders.length + 1 }, update: { nextValue: { increment: input.orders.length } },
    });
    const firstNumber = sequence.nextValue - input.orders.length;
    const purchaseOrders: PurchaseOrderSummary[] = [];
    const createdSources = new Map<string, string[]>();
    const createdRecipients = new Map<string, string | null>();
    const auditedItems = new Map(conversionItems.map((item) => [item.clientId, { ...item,
      vatRate: pendingOriginals.find((source) => source.id === item.sourceItemId)?.vatRate ?? new Prisma.Decimal(7),
    }]));
    const touchedIds = new Set<string>();
    for (const [index, group] of orders.entries()) {
      const { order, supplierData, items, requestIds, recipient, taxMode, vatRate, discountType, discountValue, pricing } = group;
      requestIds.forEach((id) => touchedIds.add(id));
      for (const [position, item] of items.entries()) {
        const orderDiscountAmount = new Prisma.Decimal(pricing.lines[position]!.orderDiscountAmount);
        const effectiveTaxMode = item.taxMode ?? taxMode;
        await transaction.purchaseRequestItem.update({ where: { id: item.sourceItemId }, data: {
          taxMode: effectiveTaxMode, vatRate, orderDiscountAmount,
        } });
        auditedItems.set(item.clientId, { ...item, taxMode: effectiveTaxMode, vatRate: new Prisma.Decimal(vatRate), orderDiscountAmount });
      }
      const created = await transaction.purchaseOrder.create({ data: {
        poNumber: `PO-${key}-${String(firstNumber + index).padStart(4, "0")}`,
        purchaseRequestId: requestIds[0]!, purchaseRequests: { connect: requestIds.map((id) => ({ id })) },
        createdById: session.id, issuedAt, buyerCompany: company ? companyIdentity(company) : Prisma.DbNull,
        ...supplierData, ...recipient, deliveryAddress: order.deliveryAddress,
        expectedDeliveryDate: order.expectedDeliveryDate ? new Date(`${order.expectedDeliveryDate}T00:00:00.000Z`) : null,
        note: order.note, totalAmount: new Prisma.Decimal(pricing.totalAmount), taxMode, vatRate, discountType, discountValue,
        items: { create: items.map((item, position) => ({
          purchaseRequestItemId: item.sourceItemId, sourcePurchaseRequestId: item.sourcePurchaseRequestId, position,
          itemName: item.itemName, description: item.description, quantity: item.quantity,
          unit: item.unit, unitPrice: item.unitPrice, amount: item.amount, taxMode: item.taxMode,
          discountType: item.discountType, discountValue: item.discountValue,
          orderDiscountAmount: new Prisma.Decimal(pricing.lines[position]!.orderDiscountAmount),
        })) },
      } });
      createdSources.set(created.id, requestIds);
      createdRecipients.set(created.id, recipient.deliveryRecipientName);
      purchaseOrders.push({ id: created.id, poNumber: created.poNumber, supplierName: created.supplierName,
        issuedAt: toBangkokIsoString(created.issuedAt), totalAmount: Number(created.totalAmount), itemCount: items.length,
        status: "ISSUED", canView: true });
    }
    await refreshPurchaseRequestsAfterOrderChange(transaction, sourceIds);
    for (const request of requests) {
      const ownOrders = purchaseOrders.filter((order) => createdSources.get(order.id)?.includes(request.id));
      const refreshed = await transaction.purchaseRequest.findUniqueOrThrow({ where: { id: request.id }, select: { totalAmount: true } });
      const comment = preparationAuditComment(request.items,
        [...auditedItems.values()].filter((item) => item.sourcePurchaseRequestId === request.id)
          .concat(request.items.filter((item) => !pendingOriginals.some((pending) => pending.id === item.id)).map((item) => ({
            ...item, clientId: item.id, sourceItemId: item.id, sourcePurchaseRequestId: request.id,
            unitPrice: item.unitPrice ?? new Prisma.Decimal(0),
          }))), request.totalAmount, refreshed.totalAmount);
      if (comment) await transaction.approval.create({ data: {
        purchaseRequestId: request.id, approverId: session.id, action: ApprovalAction.COMMENTED,
        stepLabel: "ปรับรายการก่อนออก PO", comment: `${ownOrders.map((order) => order.poNumber).join(", ")}\n${comment}`,
      } });
      if (touchedIds.has(request.id)) {
        await transaction.purchaseRequest.update({ where: { id: request.id }, data: {
          status: "ORDERED", orderedAt: request.orderedAt ?? issuedAt, receivedAt: null,
          ...(request.status === "ORDERED" ? { receiptVersion: { increment: 1 } } : {}),
        } });
        await transaction.approval.create({ data: {
          purchaseRequestId: request.id, approverId: session.id, action: ApprovalAction.ORDERED,
          stepLabel: "ฝ่ายจัดซื้อ", comment: `ออก PO สำหรับรายการที่เลือก: ${ownOrders.map((order) => order.poNumber).join(", ")}\n${ownOrders.map((order) => `${order.poNumber} · ผู้รับสินค้า: ${createdRecipients.get(order.id) ?? "—"}`).join("\n")}`,
        } });
      }
    }
    return { purchaseOrders, notifications: requests.filter((request) => touchedIds.has(request.id)).map((request) => ({
      userId: request.requesterId, title: "ฝ่ายจัดซื้อออกใบสั่งซื้อแล้ว",
      message: `${request.prNumber} ออก ${purchaseOrders.filter((order) => createdSources.get(order.id)?.includes(request.id)).map((order) => order.poNumber).join(", ")}`,
      link: `/purchase-requests/${request.id}`, type: NotificationType.SUCCESS,
    })) };
  }, { timeout: 30000 });
  await createNotifications(notifications).catch((error: unknown) => console.error("[purchase-order-notification]", error));
  return purchaseOrders;
}

export async function listPurchaseOrderCandidates(session: SessionUser, filters: { query?: string; page?: number } = {}) {
  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
  const page = Math.min(214748364, Math.max(1, Number.isSafeInteger(filters.page) ? filters.page! : 1));
  const pageSize = 10;
  const query = filters.query?.trim() ?? "";
  const pendingRow = { receivedQuantity: 0, closedQuantity: 0,
    purchaseOrderItems: { none: { purchaseOrder: { status: "ISSUED" as const } } },
  } satisfies Prisma.PurchaseRequestItemWhereInput;
  const where = {
    AND: [
      { OR: [{ status: "APPROVED" as const }, { status: "ORDERED" as const, purchaseOrders: { some: {} } }] },
      { completedAt: null }, { items: { some: pendingRow } },
      { purchaseOrders: { none: { status: "ISSUED" as const, changes: { some: { status: "PENDING" as const } } } } },
      ...(query ? [{ OR: [{ prNumber: { contains: query, mode: "insensitive" as const } },
        { reason: { contains: query, mode: "insensitive" as const } },
        { requester: { name: { contains: query, mode: "insensitive" as const } } },
        { items: { some: { itemName: { contains: query, mode: "insensitive" as const } } } },
      ] }] : []),
    ],
  } satisfies Prisma.PurchaseRequestWhereInput;
  const db = getDb();
  const [total, requests] = await Promise.all([
    db.purchaseRequest.count({ where }),
    db.purchaseRequest.findMany({ where, orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
      take: pageSize, skip: (page - 1) * pageSize,
      select: { id: true, prNumber: true, department: true, updatedAt: true,
        requester: { select: { name: true } }, _count: { select: { items: { where: pendingRow } } },
      },
    }),
  ]);
  return { requests: requests.map((request) => ({ id: request.id, prNumber: request.prNumber,
    department: request.department, requesterName: request.requester.name,
    orderableItemCount: request._count.items, updatedAt: toBangkokIsoString(request.updatedAt),
  })), page, pageSize, total };
}

