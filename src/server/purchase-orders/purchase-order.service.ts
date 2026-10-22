import "server-only";

import { ApprovalAction, NotificationType, Prisma, PurchaseRequestStatus } from "@prisma/client";
import { toBangkokDateValue, toBangkokIsoString, toBangkokMonthValue } from "@/lib/format";
import type { PurchaseOrderDetail, PurchaseOrderSnapshot, PurchaseOrderSummary, SessionUser } from "@/lib/types";
import { canApprovePurchaseRequest, isPurchasing } from "@/server/auth/authorization";
import { getDb } from "@/server/db";
import { createNotifications } from "@/server/notifications/notification.service";
import type { PurchaseOrderConversionInput } from "@/server/purchase-orders/purchase-order.schemas";
import { assertCanViewPurchaseRequest } from "@/server/purchase-requests/purchase-request.service";
import { AppError, invariant } from "@/server/shared/errors";
import { supplierContactSchema } from "@/server/suppliers/supplier.schemas";
import { formatSupplierCode } from "@/server/suppliers/supplier.service";
import { z } from "zod";

export async function convertPurchaseRequestToOrders(
  id: string,
  session: SessionUser,
  input: PurchaseOrderConversionInput,
): Promise<PurchaseOrderSummary[]> {
  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
  const db = getDb();
  const issuedAt = new Date();
  const { purchaseOrders, request } = await db.$transaction(async (transaction) => {
    const request = await transaction.purchaseRequest.findUnique({
      where: { id },
      include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, purchaseOrders: { select: { id: true } } },
    });
    invariant(request, "ไม่พบเอกสาร PR ที่ต้องการ", 404);
    invariant(request.purchaseOrders.length === 0, "PR นี้ถูกแปลงเป็น PO แล้ว กรุณาโหลดข้อมูลใหม่", 409);
    invariant(request.status === PurchaseRequestStatus.APPROVED, "PR ต้องได้รับการอนุมัติก่อนแปลงเป็น PO", 400);

    const allocatedIds = input.orders.flatMap((order) => order.itemIds);
    const sourceIds = new Set(request.items.map((item) => item.id));
    invariant(
      allocatedIds.length === sourceIds.size && new Set(allocatedIds).size === sourceIds.size && allocatedIds.every((itemId) => sourceIds.has(itemId)),
      "กรุณาจัดผู้ขายให้ครบทุกรายการใน PR โดยไม่ซ้ำกัน", 400,
    );

    // Serialize conversion against cancellation, returns, and another conversion.
    // The timestamp also prevents issuing an older snapshot after a revision cycle.
    const updated = await transaction.purchaseRequest.updateMany({
      where: { id, status: PurchaseRequestStatus.APPROVED, updatedAt: request.updatedAt, purchaseOrders: { none: {} } },
      data: { status: PurchaseRequestStatus.ORDERED, orderedAt: issuedAt },
    });
    invariant(updated.count === 1, "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);

    const supplierIds = [...new Set(input.orders.flatMap((order) => "supplierId" in order ? [order.supplierId] : []))].sort();
    if (supplierIds.length) {
      // Master updates lock the supplier before replacing its contacts. Lock
      // suppliers in a stable order so every issued PO captures one committed
      // version of its header, activation state, and contact channels together.
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Supplier"
        WHERE "id" IN (${Prisma.join(supplierIds)}) ORDER BY "id" FOR SHARE
      `);
    }
    const suppliers = supplierIds.length ? await transaction.supplier.findMany({
      where: { id: { in: supplierIds } }, include: { contacts: { orderBy: { channel: "asc" } } },
    }) : [];
    const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    invariant(suppliers.length === supplierIds.length, "ไม่พบผู้ขายที่เลือก กรุณาเลือกผู้ขายใหม่", 400);
    invariant(suppliers.every((supplier) => supplier.isActive), "ผู้ขายที่เลือกถูกปิดใช้งานแล้ว กรุณาเลือกผู้ขายใหม่", 400);

    const key = toBangkokMonthValue(issuedAt).replace("-", "");
    const sequence = await transaction.purchaseOrderNumberSequence.upsert({
      where: { key },
      create: { key, nextValue: input.orders.length + 1 },
      update: { nextValue: { increment: input.orders.length } },
    });
    const firstNumber = sequence.nextValue - input.orders.length;
    const purchaseOrders: PurchaseOrderSummary[] = [];
    for (const [index, order] of input.orders.entries()) {
      const registered = "supplierId" in order ? suppliersById.get(order.supplierId)! : null;
      const supplierData = registered ? {
        supplierId: registered.id,
        supplierCode: formatSupplierCode(registered.code),
        supplierName: registered.name,
        supplierAddress: registered.address,
        supplierContact: null,
        supplierTaxId: registered.taxId,
        supplierContactPerson: registered.contactPerson,
        supplierContacts: registered.contacts.map(({ channel, value }) => ({ channel, value })),
        paymentTerms: registered.paymentTerms,
      } : "supplierName" in order ? {
        supplierName: order.supplierName,
        supplierAddress: order.supplierAddress,
        supplierContact: order.supplierContact,
        paymentTerms: order.paymentTerms,
      } : null;
      invariant(supplierData, "กรุณาระบุผู้ขายของทุกรายการ", 400);
      const selectedIds = new Set(order.itemIds);
      const items = request.items.filter((item) => selectedIds.has(item.id));
      const totalAmount = items.reduce((total, item) => total.plus(item.amount), new Prisma.Decimal(0));
      const created = await transaction.purchaseOrder.create({
        data: {
          poNumber: `PO-${key}-${String(firstNumber + index).padStart(4, "0")}`,
          purchaseRequestId: id,
          createdById: session.id,
          issuedAt,
          ...supplierData,
          deliveryAddress: order.deliveryAddress,
          expectedDeliveryDate: order.expectedDeliveryDate ? new Date(`${order.expectedDeliveryDate}T00:00:00.000Z`) : null,
          note: order.note,
          totalAmount,
          items: {
            create: items.map((item, position) => ({
              purchaseRequestItemId: item.id,
              position,
              itemName: item.itemName,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice ?? new Prisma.Decimal(0),
              amount: item.amount,
            })),
          },
        },
      });
      purchaseOrders.push({ id: created.id, poNumber: created.poNumber, supplierName: created.supplierName, issuedAt: toBangkokIsoString(created.issuedAt), totalAmount: Number(created.totalAmount), itemCount: items.length });
    }
    await transaction.approval.create({
      data: { purchaseRequestId: id, approverId: session.id, action: ApprovalAction.ORDERED, stepLabel: "ฝ่ายจัดซื้อ", comment: `แปลง PR เป็น PO: ${purchaseOrders.map((order) => order.poNumber).join(", ")}` },
    });
    return { purchaseOrders, request };
  }, { timeout: 15000 });

  // Issuing POs has already committed. Notification delivery must not make the
  // caller believe issuance failed and encourage an accidental resubmission.
  await createNotifications([{
    userId: request.requesterId,
    title: "ฝ่ายจัดซื้อออกใบสั่งซื้อแล้ว",
    message: `${request.prNumber} ถูกแปลงเป็น ${purchaseOrders.map((order) => order.poNumber).join(", ")}`,
    link: `/purchase-requests/${id}`,
    type: NotificationType.SUCCESS,
  }]).catch((error: unknown) => console.error("[purchase-order-notification]", error));
  return purchaseOrders;
}

export async function getPurchaseOrderById(id: string, session: SessionUser): Promise<PurchaseOrderDetail> {
  const order = await getDb().purchaseOrder.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      purchaseRequest: { select: { id: true, prNumber: true, requesterId: true, department: true, currentApproverId: true, status: true, receivedAt: true, requester: { select: { name: true } },
        approvals: { where: { action: "APPROVED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { approverId: true } } } },
      items: { orderBy: { position: "asc" }, include: { purchaseRequestItem: { select: { receivedQuantity: true, closedQuantity: true } } } },
      changes: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: {
        submittedBy: { select: { id: true, name: true } }, reviewedBy: { select: { id: true, name: true } },
      } },
    },
  });
  if (!order) throw new AppError("ไม่พบเอกสาร PO ที่ต้องการ", 404);
  const source = order.purchaseRequest;
  // The original PR approver still needs the PO and its revision history when
  // reviewing an amendment, including after a department reassignment.
  if (!canApprovePurchaseRequest(session, source.approvals[0]?.approverId)) {
    assertCanViewPurchaseRequest(session, source.requesterId, source.department, source.currentApproverId);
  }
  const contacts = z.array(supplierContactSchema).safeParse(order.supplierContacts);
  const pending = order.changes.find((change) => change.status === "PENDING");
  const active = source.status === "ORDERED" && !source.receivedAt;
  const reviewable = source.status === "ORDERED";
  return {
    version: order.version, revision: order.revision,
    canEdit: active && isPurchasing(session) && !pending,
    canReview: reviewable && Boolean(pending) && pending?.submittedById !== session.id && canApprovePurchaseRequest(session, source.approvals[0]?.approverId),
    canWithdraw: reviewable && pending?.submittedById === session.id,
    pendingChangeId: pending?.id ?? null,
    changes: order.changes.map((change) => ({
      id: change.id, status: change.status, baseVersion: change.baseVersion,
      reason: change.reason, reviewComment: change.reviewComment,
      createdAt: toBangkokIsoString(change.createdAt), reviewedAt: change.reviewedAt ? toBangkokIsoString(change.reviewedAt) : null,
      submittedBy: change.submittedBy, reviewedBy: change.reviewedBy,
      before: change.before as unknown as PurchaseOrderSnapshot, after: change.after as unknown as PurchaseOrderSnapshot,
    })),
    supplierId: order.supplierId,
    supplierCode: order.supplierCode,
    supplierTaxId: order.supplierTaxId,
    supplierContactPerson: order.supplierContactPerson,
    supplierContacts: contacts.success ? contacts.data : [],
    id: order.id, poNumber: order.poNumber, supplierName: order.supplierName,
    issuedAt: toBangkokIsoString(order.issuedAt), totalAmount: Number(order.totalAmount), itemCount: order.items.length,
    supplierAddress: order.supplierAddress, supplierContact: order.supplierContact,
    deliveryAddress: order.deliveryAddress, paymentTerms: order.paymentTerms,
    expectedDeliveryDate: order.expectedDeliveryDate ? toBangkokDateValue(order.expectedDeliveryDate) : null,
    note: order.note, createdBy: order.createdBy,
    purchaseRequest: { id: source.id, prNumber: source.prNumber, department: source.department, requesterName: source.requester.name, status: source.status },
    items: order.items.map((item) => ({
      id: item.id, purchaseRequestItemId: item.purchaseRequestItemId,
      itemName: item.itemName, description: item.description, quantity: item.quantity, unit: item.unit,
      unitPrice: Number(item.unitPrice), amount: Number(item.amount),
      receivedQuantity: item.purchaseRequestItem.receivedQuantity, closedQuantity: item.purchaseRequestItem.closedQuantity,
    })),
  };
}
