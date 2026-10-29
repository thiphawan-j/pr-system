import "server-only";

import { isDeepStrictEqual } from "node:util";
import { ApprovalAction, Prisma } from "@prisma/client";
import { calculatePurchaseOrderPricing, calculateTaxLine } from "@/lib/purchase-order-tax";
import { toBangkokDateValue } from "@/lib/format";
import type { PurchaseOrderSnapshot, SessionUser } from "@/lib/types";
import { canApprovePurchaseRequest, isPurchasing } from "@/server/auth/authorization";
import { getDb } from "@/server/db";
import { createNotifications } from "@/server/notifications/notification.service";
import { purchaseOrderChangeComment } from "@/server/purchase-orders/purchase-order-audit";
import { getPurchaseOrderById } from "@/server/purchase-orders/purchase-order.service";
import type { PurchaseOrderChangeInput, PurchaseOrderChangeReviewInput } from "@/server/purchase-orders/purchase-order.schemas";
import { AppError, invariant } from "@/server/shared/errors";
import { formatSupplierCode } from "@/server/suppliers/supplier.service";
import { supplierContactSchema } from "@/server/suppliers/supplier.schemas";
import { z } from "zod";

const orderInclude = {
  items: { orderBy: { position: "asc" } },
  changes: { where: { status: "PENDING" }, take: 1 },
  purchaseRequest: { include: {
    items: true,
    approvals: { where: { action: "APPROVED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
  } },
} satisfies Prisma.PurchaseOrderInclude;
type Order = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;
const maximumAmount = new Prisma.Decimal("9999999999.99");

function snapshot(order: Order): PurchaseOrderSnapshot {
  const contacts = z.array(supplierContactSchema).safeParse(order.supplierContacts);
  const hasDiscountMetadata = order.discountType !== "NONE" || !order.discountValue.equals(0) || order.items.some((item) => item.discountType !== "NONE" || !item.discountValue.equals(0) || !item.orderDiscountAmount.equals(0));
  const hasTaxMetadata = hasDiscountMetadata || order.taxMode !== "UNSPECIFIED" || !order.vatRate.equals(7) || order.items.some((item) => item.taxMode !== null);
  return {
    ...(hasTaxMetadata ? { taxMode: order.taxMode, vatRate: Number(order.vatRate) } : {}),
    ...(hasDiscountMetadata ? { discountType: order.discountType, discountValue: Number(order.discountValue) } : {}),
    supplierId: order.supplierId, supplierCode: order.supplierCode, supplierName: order.supplierName,
    supplierTaxId: order.supplierTaxId, supplierAddress: order.supplierAddress,
    supplierContact: order.supplierContact, supplierContactPerson: order.supplierContactPerson,
    supplierContacts: contacts.success ? contacts.data.sort((a, b) => a.channel.localeCompare(b.channel)) : [],
    deliveryAddress: order.deliveryAddress, paymentTerms: order.paymentTerms,
    expectedDeliveryDate: order.expectedDeliveryDate ? toBangkokDateValue(order.expectedDeliveryDate) : null,
    note: order.note, totalAmount: Number(order.totalAmount),
    items: order.items.map((item) => ({
      id: item.id, purchaseRequestItemId: item.purchaseRequestItemId,
      itemName: item.itemName, description: item.description, quantity: item.quantity,
      unit: item.unit, unitPrice: Number(item.unitPrice), amount: Number(item.amount),
      ...(hasTaxMetadata ? { taxMode: item.taxMode } : {}),
      ...(hasDiscountMetadata ? { discountType: item.discountType, discountValue: Number(item.discountValue), orderDiscountAmount: Number(item.orderDiscountAmount) } : {}),
    })),
  };
}

async function lockedOrder(transaction: Prisma.TransactionClient, id: string) {
  const reference = await transaction.purchaseOrder.findUnique({ where: { id }, select: { purchaseRequestId: true } });
  invariant(reference, "ไม่พบเอกสาร PO ที่ต้องการ", 404);
  // The PR row is the common lock for receipts, cancellations, and all its POs.
  await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "PurchaseRequest" WHERE "id" = ${reference.purchaseRequestId} FOR UPDATE`);
  const order = await transaction.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
  invariant(order, "ไม่พบเอกสาร PO ที่ต้องการ", 404);
  return order;
}

function assertEditable(order: Order) {
  invariant(order.purchaseRequest.status === "ORDERED" && !order.purchaseRequest.receivedAt,
    "แก้ไข PO ได้เฉพาะ PR ที่สั่งซื้อแล้วและยังรับสินค้าไม่ครบ", 400);
}

function validateItems(order: Order, after: PurchaseOrderSnapshot) {
  const oldItems = new Map(order.items.map((item) => [item.id, item]));
  const ids = after.items.flatMap((item) => item.id ? [item.id] : []);
  invariant(new Set(ids).size === ids.length, "รายการสินค้าซ้ำกัน", 400);
  const hasReceived = order.items.some((item) => item.receivedQuantity || item.closedQuantity);
  if (hasReceived) {
    invariant(order.supplierId === after.supplierId && order.supplierName === after.supplierName && order.supplierTaxId === after.supplierTaxId,
      "ไม่สามารถเปลี่ยนผู้ขายของ PO ที่มีการรับสินค้าหรือปิดยอดแล้ว", 400);
    invariant((after.discountType ?? "NONE") === order.discountType && new Prisma.Decimal(after.discountValue ?? 0).equals(order.discountValue),
      "ไม่สามารถเปลี่ยนส่วนลดทั้งใบของ PO ที่มีการรับสินค้าหรือปิดยอดแล้ว", 400);
  }
  for (const item of after.items) {
    if (!item.id) continue;
    const original = oldItems.get(item.id);
    invariant(original, "ไม่พบรายการสินค้าใน PO นี้", 400);
    const { receivedQuantity, closedQuantity } = original;
    const settled = receivedQuantity + closedQuantity;
    if (settled > 0) {
      invariant((item.discountType ?? "NONE") === original.discountType && new Prisma.Decimal(item.discountValue ?? 0).equals(original.discountValue),
        "ไม่สามารถเปลี่ยนส่วนลดของสินค้าที่รับหรือปิดยอดแล้ว", 400);
      invariant(new Prisma.Decimal(item.orderDiscountAmount ?? 0).equals(original.orderDiscountAmount),
        "การแก้ไขทำให้ส่วนลดทั้งใบที่จัดสรรให้สินค้าที่รับหรือปิดยอดแล้วเปลี่ยนแปลง", 400);
      invariant(item.itemName === original.itemName && item.description === original.description && item.unit === original.unit &&
        new Prisma.Decimal(item.unitPrice).equals(original.unitPrice),
      "ไม่สามารถเปลี่ยนรายละเอียด หน่วย หรือราคาของสินค้าที่รับหรือปิดยอดแล้ว", 400);
      invariant((item.taxMode ?? after.taxMode ?? "UNSPECIFIED") === (original.taxMode ?? order.taxMode) &&
        new Prisma.Decimal(after.vatRate ?? 7).equals(order.vatRate),
      "ไม่สามารถเปลี่ยนรูปแบบภาษีหรืออัตรา VAT ของสินค้าที่รับหรือปิดยอดแล้ว", 400);
      invariant(item.quantity === original.quantity || item.quantity >= settled,
        "จำนวนใหม่ต้องไม่น้อยกว่าจำนวนที่รับและปิดยอดแล้ว", 400);
    }
  }
  for (const original of order.items) {
    if (!ids.includes(original.id)) {
      invariant(original.receivedQuantity === 0 && original.closedQuantity === 0,
        "ไม่สามารถลบสินค้าที่รับหรือปิดยอดแล้ว", 400);
    }
  }
}

async function proposedSnapshot(transaction: Prisma.TransactionClient, order: Order, input: PurchaseOrderChangeInput) {
  const before = snapshot(order);
  let supplier: Pick<PurchaseOrderSnapshot, "supplierId" | "supplierCode" | "supplierName" | "supplierTaxId" | "supplierAddress" | "supplierContactPerson" | "supplierContacts" | "supplierContact">;
  if ("supplierId" in input.supplier) {
    if (input.supplier.supplierId === order.supplierId) {
      supplier = {
        supplierId: before.supplierId, supplierCode: before.supplierCode, supplierName: before.supplierName,
        supplierTaxId: before.supplierTaxId, supplierAddress: before.supplierAddress,
        supplierContactPerson: before.supplierContactPerson, supplierContacts: before.supplierContacts,
        supplierContact: before.supplierContact,
      };
    } else {
      await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "Supplier" WHERE "id" = ${input.supplier.supplierId} FOR SHARE`);
      const registered = await transaction.supplier.findUnique({ where: { id: input.supplier.supplierId }, include: { contacts: { orderBy: { channel: "asc" } } } });
      invariant(registered?.isActive, "ไม่พบผู้ขายที่เลือกหรือผู้ขายถูกปิดใช้งานแล้ว", 400);
      supplier = {
        supplierId: registered.id, supplierCode: formatSupplierCode(registered.code), supplierName: registered.name,
        supplierTaxId: registered.taxId, supplierAddress: registered.address,
        supplierContactPerson: registered.contactPerson, supplierContact: null,
        supplierContacts: registered.contacts.map(({ channel, value }) => ({ channel, value })),
      };
    }
  } else {
    supplier = { supplierId: null, supplierCode: null, supplierName: input.supplier.supplierName,
      supplierTaxId: null, supplierAddress: null, supplierContactPerson: null, supplierContact: null, supplierContacts: [] };
  }
  const overrides = input.supplier;
  if (overrides.supplierName !== undefined) supplier.supplierName = overrides.supplierName;
  for (const field of ["supplierTaxId", "supplierAddress", "supplierContactPerson", "supplierContact"] as const) {
    if (Object.hasOwn(overrides, field)) supplier[field] = overrides[field] ?? null;
  }
  if (overrides.supplierContacts !== undefined) supplier.supplierContacts = overrides.supplierContacts;
  supplier.supplierContacts = [...supplier.supplierContacts].sort((a, b) => a.channel.localeCompare(b.channel));
  const originals = new Map(order.items.map((item) => [item.id, item]));
  const taxMode = input.taxMode ?? order.taxMode;
  const vatRate = input.vatRate ?? Number(order.vatRate);
  const discountType = input.discountType ?? order.discountType;
  const discountValue = input.discountType === "NONE" ? 0 : input.discountValue ?? Number(order.discountValue);
  const items = input.items.map((item) => {
    const original = item.id ? originals.get(item.id) : undefined;
    // Preserve an issued legacy line's authoritative stored amount when its
    // quantity and unit price are unchanged; do not reinterpret old snapshots.
    const amount = original && item.quantity === original.quantity && original.unitPrice.equals(item.unitPrice)
      ? original.amount : new Prisma.Decimal(item.unitPrice).times(item.quantity);
    invariant(amount.lte(maximumAmount), "ยอดเงินมากเกินขอบเขตที่รองรับ", 400);
    const override = item.taxMode === undefined ? original?.taxMode ?? null : item.taxMode;
    return {
      ...(item.id ? { id: item.id, purchaseRequestItemId: original?.purchaseRequestItemId } : {}),
      itemName: item.itemName, description: item.description ?? null, unit: item.unit ?? null,
      quantity: item.quantity, unitPrice: item.unitPrice, amount: Number(amount), taxMode: override,
      discountType: item.discountType ?? original?.discountType ?? "NONE",
      discountValue: item.discountType === "NONE" ? 0 : item.discountValue ?? Number(original?.discountValue ?? 0),
    };
  });
  let tax;
  try {
    tax = calculatePurchaseOrderPricing(items, taxMode, vatRate, { discountType, discountValue });
  } catch {
    throw new AppError("ส่วนลดหรือยอดเงินไม่ถูกต้อง ส่วนลดต้องไม่เกินยอดสินค้าที่เหลือ", 400);
  }
  const hasDiscountMetadata = discountType !== "NONE" || discountValue !== 0 || items.some((item) => item.discountType !== "NONE" || item.discountValue !== 0);
  const hasTaxMetadata = hasDiscountMetadata || taxMode !== "UNSPECIFIED" || vatRate !== 7 || items.some((item) => item.taxMode !== null);
  const after: PurchaseOrderSnapshot = {
    ...supplier, deliveryAddress: input.deliveryAddress ?? null, paymentTerms: input.paymentTerms ?? null,
    expectedDeliveryDate: input.expectedDeliveryDate || null, note: input.note ?? null, totalAmount: tax.totalAmount,
    ...(hasTaxMetadata ? { taxMode, vatRate } : {}),
    ...(hasDiscountMetadata ? { discountType, discountValue } : {}),
    items: items.map(({ taxMode: override, discountType: itemDiscountType, discountValue: itemDiscountValue, ...item }, index) => ({
      ...item, ...(hasTaxMetadata ? { taxMode: override } : {}),
      ...(hasDiscountMetadata ? { discountType: itemDiscountType, discountValue: itemDiscountValue, orderDiscountAmount: tax.lines[index]!.orderDiscountAmount } : {}),
    })),
  };
  invariant(order.purchaseRequest.totalAmount.minus(order.totalAmount).plus(after.totalAmount).lte(maximumAmount), "ยอดรวม PR มากเกินขอบเขตที่รองรับ", 400);
  validateItems(order, after);
  return { before, after };
}

async function sendChangeNotification(userIds: string[], order: Order, title: string, message: string) {
  await createNotifications([...new Set(userIds)].map((userId) => ({
    userId, title, message, link: `/purchase-orders/${order.id}`, type: "INFO" as const,
  }))).catch((error: unknown) => console.error("[purchase-order-change-notification]", error));
}

export async function proposePurchaseOrderChange(id: string, session: SessionUser, input: PurchaseOrderChangeInput) {
  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อหรือผู้ดูแลระบบเท่านั้นที่แก้ไข PO ได้", 403);
  const result = await getDb().$transaction(async (transaction) => {
    const order = await lockedOrder(transaction, id);
    assertEditable(order);
    invariant(order.version === input.expectedVersion, "PO มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
    invariant(order.changes.length === 0, "PO นี้มีฉบับแก้ไขรอตรวจอยู่แล้ว", 409);
    const { before, after } = await proposedSnapshot(transaction, order, input);
    invariant(!isDeepStrictEqual(before, after), "กรุณาแก้ไขข้อมูลก่อนส่งตรวจ", 400);
    const reviewers = await transaction.user.findMany({ where: {
      isActive: true, id: { not: session.id }, OR: [
        { role: "ADMIN" }, { role: "APPROVER", department: "บริหาร/จัดการ" },
        ...(order.purchaseRequest.approvals[0] ? [{ id: order.purchaseRequest.approvals[0].approverId, role: { in: ["APPROVER", "ADMIN"] as ("APPROVER" | "ADMIN")[] } }] : []),
      ],
    }, select: { id: true } });
    invariant(reviewers.length > 0, "ไม่พบผู้อนุมัติที่สามารถตรวจการแก้ไข PO นี้ได้", 400);
    await transaction.purchaseOrder.update({ where: { id }, data: { version: { increment: 1 } } });
    await transaction.purchaseOrderChange.create({ data: {
      purchaseOrderId: id, submittedById: session.id, baseVersion: order.version, reason: input.reason,
      before: before as unknown as Prisma.InputJsonObject, after: after as unknown as Prisma.InputJsonObject,
    } });
    await transaction.purchaseRequest.update({ where: { id: order.purchaseRequestId }, data: { receiptVersion: { increment: 1 } } });
    await transaction.approval.create({ data: {
      purchaseRequestId: order.purchaseRequestId, approverId: session.id, action: ApprovalAction.COMMENTED,
      stepLabel: "ขอแก้ไข PO", comment: purchaseOrderChangeComment(order.poNumber, before, after, input.reason),
    } });
    return { order, reviewers: reviewers.map((reviewer) => reviewer.id) };
  }, { timeout: 15000 });
  await sendChangeNotification(result.reviewers, result.order, "PO รอตรวจการแก้ไข", `${result.order.poNumber}: ${input.reason}`);
  return getPurchaseOrderById(id, session);
}

async function applySnapshot(transaction: Prisma.TransactionClient, order: Order, after: PurchaseOrderSnapshot) {
  validateItems(order, after);
  if (after.supplierId && after.supplierId !== order.supplierId) {
    await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "Supplier" WHERE "id" = ${after.supplierId} FOR SHARE`);
    invariant((await transaction.supplier.findUnique({ where: { id: after.supplierId } }))?.isActive,
      "ผู้ขายที่เลือกถูกปิดใช้งานแล้ว กรุณาปฏิเสธและส่งฉบับแก้ไขใหม่", 400);
  }
  const oldIds = new Set(after.items.flatMap((item) => item.id ? [item.id] : []));
  for (const old of order.items) {
    if (!oldIds.has(old.id)) {
      await transaction.purchaseOrderItem.delete({ where: { id: old.id } });
      if (old.purchaseRequestItemId) await transaction.purchaseRequestItem.delete({ where: { id: old.purchaseRequestItemId } });
    }
  }
  // Vacate unique positions before reordering retained and newly inserted lines.
  await transaction.purchaseOrderItem.updateMany({ where: { purchaseOrderId: order.id }, data: { position: { increment: 500 } } });
  for (const [position, item] of after.items.entries()) {
    const poFields = { itemName: item.itemName, description: item.description,
      quantity: item.quantity, unit: item.unit, unitPrice: new Prisma.Decimal(item.unitPrice), amount: new Prisma.Decimal(item.amount), taxMode: item.taxMode ?? null,
      discountType: item.discountType ?? "NONE", discountValue: item.discountValue ?? 0, orderDiscountAmount: item.orderDiscountAmount ?? 0 };
    const sourceFields = { ...poFields, supplierName: after.supplierName, taxMode: item.taxMode ?? after.taxMode ?? "UNSPECIFIED", vatRate: after.vatRate ?? 7 };
    if (item.id) {
      const old = order.items.find((entry) => entry.id === item.id)!;
      const source = old.purchaseRequestItemId
        ? await transaction.purchaseRequestItem.update({ where: { id: old.purchaseRequestItemId }, data: sourceFields })
        : await transaction.purchaseRequestItem.create({ data: { ...sourceFields, purchaseRequestId: order.purchaseRequestId } });
      await transaction.purchaseOrderItem.update({ where: { id: item.id }, data: { ...poFields, position, purchaseRequestItemId: source.id } });
    } else {
      const source = await transaction.purchaseRequestItem.create({ data: { ...sourceFields, purchaseRequestId: order.purchaseRequestId } });
      await transaction.purchaseOrderItem.create({ data: { ...poFields, position, purchaseOrderId: order.id, purchaseRequestItemId: source.id } });
    }
  }
  await transaction.purchaseOrder.update({ where: { id: order.id }, data: {
    supplierId: after.supplierId, supplierCode: after.supplierCode, supplierName: after.supplierName,
    supplierTaxId: after.supplierTaxId, supplierAddress: after.supplierAddress,
    supplierContact: after.supplierContact, supplierContactPerson: after.supplierContactPerson,
    supplierContacts: after.supplierContacts, deliveryAddress: after.deliveryAddress,
    paymentTerms: after.paymentTerms, note: after.note, totalAmount: new Prisma.Decimal(after.totalAmount),
    taxMode: after.taxMode ?? "UNSPECIFIED", vatRate: after.vatRate ?? 7,
    discountType: after.discountType ?? "NONE", discountValue: after.discountValue ?? 0,
    expectedDeliveryDate: after.expectedDeliveryDate ? new Date(`${after.expectedDeliveryDate}T00:00:00.000Z`) : null,
    revision: { increment: 1 },
  } });
  const sourceItems = await transaction.purchaseRequestItem.findMany({ where: { purchaseRequestId: order.purchaseRequestId }, select: { amount: true, taxMode: true, vatRate: true, discountType: true, discountValue: true, orderDiscountAmount: true } });
  const requestTotal = sourceItems.reduce((sum, item) => sum.plus(calculateTaxLine(item.amount.toString(), item.taxMode, Number(item.vatRate), { discountType: item.discountType, discountValue: Number(item.discountValue), orderDiscountAmount: Number(item.orderDiscountAmount) }).totalAmount), new Prisma.Decimal(0));
  invariant(requestTotal.lte(maximumAmount), "ยอดรวม PR มากเกินขอบเขตที่รองรับ", 400);
  const orderedItems = await transaction.purchaseOrderItem.findMany({ where: { purchaseOrder: { purchaseRequestId: order.purchaseRequestId } }, select: { quantity: true, receivedQuantity: true, closedQuantity: true } });
  const allSettled = orderedItems.length > 0 && orderedItems.every((item) => item.receivedQuantity + item.closedQuantity >= item.quantity);
  const lastReceipt = allSettled ? await transaction.purchaseRequestReceipt.findFirst({
    where: { purchaseRequestId: order.purchaseRequestId, action: "RECEIVED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  }) : null;
  await transaction.purchaseRequest.update({ where: { id: order.purchaseRequestId }, data: {
    totalAmount: requestTotal, receivedAt: allSettled ? lastReceipt?.receivedDate ?? null : null,
  } });
}

export async function reviewPurchaseOrderChange(id: string, changeId: string, session: SessionUser, input: PurchaseOrderChangeReviewInput) {
  // Fail before a decision commits if this account has lost document visibility.
  await getPurchaseOrderById(id, session);
  const order = await getDb().$transaction(async (transaction) => {
    const current = await lockedOrder(transaction, id);
    const change = await transaction.purchaseOrderChange.findFirst({ where: { id: changeId, purchaseOrderId: id } });
    invariant(change, "ไม่พบฉบับแก้ไข PO ที่ต้องการ", 404);
    const reviewer = canApprovePurchaseRequest(session, current.purchaseRequest.approvals[0]?.approverId);
    const withdraw = input.action === "REJECTED" && session.id === change.submittedById;
    invariant(withdraw || (reviewer && session.id !== change.submittedById), "คุณไม่มีสิทธิ์พิจารณาการแก้ไข PO นี้ หรือกำลังอนุมัติงานของตนเอง", 403);
    // Another PO's approved revision can settle the PR while this revision is
    // already pending. It must remain resolvable so receiving is not held forever.
    invariant(current.purchaseRequest.status === "ORDERED", "PR สถานะนี้ไม่สามารถพิจารณาการแก้ไข PO ได้", 400);
    invariant(current.version === input.expectedVersion && change.status === "PENDING", "PO มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
    const after = change.after as unknown as PurchaseOrderSnapshot;
    if (input.action === "APPROVED") await applySnapshot(transaction, current, after);
    await transaction.purchaseOrder.update({ where: { id }, data: { version: { increment: 1 } } });
    await transaction.purchaseOrderChange.update({ where: { id: changeId }, data: {
      status: input.action, reviewedById: session.id, reviewedAt: new Date(), reviewComment: input.comment ?? null,
    } });
    await transaction.purchaseRequest.update({ where: { id: current.purchaseRequestId }, data: { receiptVersion: { increment: 1 } } });
    await transaction.approval.create({ data: {
      purchaseRequestId: current.purchaseRequestId, approverId: session.id, action: ApprovalAction.COMMENTED,
      stepLabel: input.action === "APPROVED" ? "อนุมัติแก้ไข PO" : withdraw ? "ถอนคำขอแก้ไข PO" : "ไม่อนุมัติแก้ไข PO",
      comment: input.action === "APPROVED"
        ? purchaseOrderChangeComment(current.poNumber, change.before as unknown as PurchaseOrderSnapshot, after, change.reason, input.comment)
        : `${current.poNumber}\nเหตุผลที่ขอแก้ไข: ${change.reason}\nผลการพิจารณา: ${input.comment ?? change.reason}`,
    } });
    return current;
  }, { timeout: 15000 });
  await sendChangeNotification([order.createdById, ...order.changes.map((change) => change.submittedById), order.purchaseRequest.requesterId], order,
    input.action === "APPROVED" ? "อนุมัติการแก้ไข PO แล้ว" : "ฉบับแก้ไข PO ถูกปฏิเสธหรือถอนแล้ว", `${order.poNumber}${input.comment ? `: ${input.comment}` : ""}`);
  return getPurchaseOrderById(id, session);
}
