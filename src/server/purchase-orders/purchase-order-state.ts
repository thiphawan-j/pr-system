import "server-only";

import { Prisma } from "@prisma/client";
import { calculateTaxLine } from "@/lib/purchase-order-tax";
import { invariant } from "@/server/shared/errors";

/** Every operation touching multiple sources acquires the same ordered locks. */
export async function lockPurchaseRequests(transaction: Prisma.TransactionClient, ids: string[]) {
  const sourceIds = [...new Set(ids)].sort();
  if (!sourceIds.length) return;
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "PurchaseRequest" WHERE "id" IN (${Prisma.join(sourceIds)}) ORDER BY "id" FOR UPDATE
  `);
}

/** Rebuild commercial totals and receipt completeness for each origin separately. */
export async function refreshPurchaseRequestsAfterOrderChange(
  transaction: Prisma.TransactionClient,
  ids: string[],
  options: { incrementReceiptVersion?: boolean; reopenWhenNoActiveOrders?: boolean } = {},
) {
  for (const id of [...new Set(ids)].sort()) {
    const request = await transaction.purchaseRequest.findUnique({
      where: { id },
      include: {
        items: true,
        purchaseOrders: { where: { status: "ISSUED" }, include: { items: { where: { sourcePurchaseRequestId: id } } } },
        receipts: { where: { action: "RECEIVED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
      },
    });
    invariant(request, "ไม่พบเอกสาร PR ที่ต้องการ", 404);
    const lines = request.purchaseOrders.flatMap((order) => order.items);
    const assigned = new Set(lines.flatMap((line) => line.purchaseRequestItemId ? [line.purchaseRequestItemId] : []));
    const pending = request.items.filter((item) => !assigned.has(item.id));
    const allSettled = (request.items.length > 0 || lines.length > 0)
      && lines.every((line) => line.receivedQuantity + line.closedQuantity >= line.quantity)
      && pending.every((item) => item.receivedQuantity + item.closedQuantity >= item.quantity);
    const totalAmount = request.items.reduce((sum, item) => sum.plus(calculateTaxLine(
      item.amount.toString(), item.taxMode, Number(item.vatRate), {
        discountType: item.discountType, discountValue: Number(item.discountValue), orderDiscountAmount: Number(item.orderDiscountAmount),
      },
    ).totalAmount), new Prisma.Decimal(0));
    invariant(totalAmount.lte("9999999999.99"), "ยอดรวม PR มากเกินขอบเขตที่รองรับ", 400);
    const reopen = options.reopenWhenNoActiveOrders && request.status === "ORDERED"
      && request.purchaseOrders.length === 0 && request.receipts.length === 0;
    await transaction.purchaseRequest.update({
      where: { id },
      data: {
        totalAmount,
        receivedAt: allSettled ? request.receipts[0]?.receivedDate ?? null : null,
        ...(reopen ? { status: "APPROVED", orderedAt: null, completedAt: null } : {}),
        ...(options.incrementReceiptVersion ? { receiptVersion: { increment: 1 } } : {}),
      },
    });
  }
}
