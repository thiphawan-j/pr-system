import "server-only";

import { ApprovalAction, Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/types";
import { isPurchasing } from "@/server/auth/authorization";
import { getDb } from "@/server/db";
import { createNotifications } from "@/server/notifications/notification.service";
import { orderSources } from "@/server/purchase-orders/purchase-order-access";
import type { PurchaseOrderCancellationInput } from "@/server/purchase-orders/purchase-order.schemas";
import { getPurchaseOrderById } from "@/server/purchase-orders/purchase-order.service";
import { lockPurchaseRequests, refreshPurchaseRequestsAfterOrderChange } from "@/server/purchase-orders/purchase-order-state";
import { invariant } from "@/server/shared/errors";

export async function cancelPurchaseOrder(id: string, session: SessionUser, input: PurchaseOrderCancellationInput) {
  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อหรือผู้ดูแลระบบเท่านั้นที่ยกเลิก PO ได้", 403);
  const order = await getDb().$transaction(async (transaction) => {
    const reference = await transaction.purchaseOrder.findUnique({
      where: { id }, select: { purchaseRequestId: true, purchaseRequests: { select: { id: true } } },
    });
    invariant(reference, "ไม่พบเอกสาร PO ที่ต้องการ", 404);
    await lockPurchaseRequests(transaction, [reference.purchaseRequestId, ...reference.purchaseRequests.map((source) => source.id)]);
    await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} FOR UPDATE`);
    const current = await transaction.purchaseOrder.findUnique({
      where: { id }, include: {
        purchaseRequest: true, purchaseRequests: { orderBy: { id: "asc" } },
        items: { include: { _count: { select: { receiptItems: true } } } },
        changes: { where: { status: "PENDING" }, take: 1 },
      },
    });
    invariant(current, "ไม่พบเอกสาร PO ที่ต้องการ", 404);
    invariant(current.version === input.expectedVersion, "PO มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
    invariant(current.status === "ISSUED", "PO นี้ถูกยกเลิกแล้ว", 409);
    const sources = orderSources(current);
    invariant(sources.every((source) => source.status === "ORDERED" || source.status === "COMPLETED"
      && current.items.every((item) => item.sourcePurchaseRequestId !== source.id)), "สถานะ PR ต้นทางไม่อนุญาตให้ยกเลิก PO", 400);
    invariant(current.changes.length === 0, "กรุณาพิจารณาการแก้ไข PO ให้เสร็จก่อนยกเลิก", 409);
    invariant(current.items.every((item) => item.receivedQuantity === 0 && item.closedQuantity === 0 && item._count.receiptItems === 0),
      "ไม่สามารถยกเลิก PO ที่มีการรับสินค้าหรือปิดยอดแล้ว กรุณาปิดยอดคงเหลือแทน", 400);
    await transaction.purchaseOrder.update({ where: { id }, data: {
      status: "CANCELLED", cancelledAt: new Date(), cancelledById: session.id,
      cancellationReason: input.reason, cancellationReference: input.cancellationReference ?? null,
      version: { increment: 1 },
    } });
    const releasedIds = current.items.flatMap((item) => item.purchaseRequestItemId ? [item.purchaseRequestItemId] : []);
    if (releasedIds.length) {
      // The allocation belongs to this cancelled PO, not to a future reissue.
      // Row prices, own discounts and VAT remain the last purchasing terms.
      await transaction.purchaseRequestItem.updateMany({ where: {
        id: { in: releasedIds }, purchaseOrderItems: { none: { purchaseOrder: { status: "ISSUED" } } },
      }, data: { orderDiscountAmount: 0 } });
    }
    await refreshPurchaseRequestsAfterOrderChange(transaction, sources.map((source) => source.id), {
      incrementReceiptVersion: true, reopenWhenNoActiveOrders: true,
    });
    for (const source of sources) {
      const refreshed = await transaction.purchaseRequest.findUniqueOrThrow({ where: { id: source.id }, select: { totalAmount: true } });
      const ownItems = current.items.filter((item) => item.sourcePurchaseRequestId === source.id);
      await transaction.approval.create({ data: {
        purchaseRequestId: source.id, approverId: session.id, action: ApprovalAction.COMMENTED,
        stepLabel: "ยกเลิกเฉพาะ PO", comment: [
          `ยกเลิก ${current.poNumber} โดยคง PR ไว้`, `เหตุผล: ${input.reason}`,
          ...(input.cancellationReference ? [`เลขอ้างอิงการยกเลิก: ${input.cancellationReference}`] : []),
          `ยอดรวม PR: ${source.totalAmount.toFixed(2)} → ${refreshed.totalAmount.toFixed(2)} บาท`,
          ...ownItems.map((item) => `คืนรายการรอเปิด PO: ${item.itemName} | จำนวน: ${item.quantity} ${item.unit ?? ""}`),
        ].join("\n"),
      } });
    }
    return current;
  }, { timeout: 15000 });
  await createNotifications(orderSources(order).map((source) => ({
    userId: source.requesterId, title: "ยกเลิกใบสั่งซื้อแล้ว โดยคง PR ไว้",
    message: `${order.poNumber} · ${source.prNumber} ${order.items.some((item) => item.sourcePurchaseRequestId === source.id) ? "รายการกลับไปรอเปิด PO" : "ยกเลิกเอกสาร PO ที่อ้างอิง PR นี้"}`,
    link: `/purchase-requests/${source.id}`, type: "INFO" as const,
  }))).catch((error: unknown) => console.error("[purchase-order-cancellation-notification]", error));
  return getPurchaseOrderById(id, session);
}
