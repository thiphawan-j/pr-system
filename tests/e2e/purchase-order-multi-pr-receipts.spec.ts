import { expect, test, type Page } from "@playwright/test";
import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest, receive } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

async function approved(page: Page, count = 2) {
  await authenticate(page);
  const marker = uniqueValue("Multi-PR-receipts");
  const response = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify({
    requestDate: "2026-10-30", department: "Operations", reason: marker, urgency: "NORMAL", submit: true,
    items: Array.from({ length: count }, (_, index) => ({ itemName: `${marker}-${index}`, quantity: 2,
      unit: "ชิ้น", unitPrice: 100, amount: 200, supplierName: "Shared receiving supplier" })),
  }) } });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, {
    data: { action: "APPROVED", comment: "Approve sources for combined receiving" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, id);
}

async function combine(page: Page, sources: PurchaseRequestDetail[], itemIds: string[]) {
  const response = await page.request.post("/api/purchase-orders", { data: {
    requests: sources.map((source) => ({ id: source.id, expectedUpdatedAt: source.orderPreparationVersion })),
    orders: [{ supplierName: "Shared receiving supplier", itemIds }],
  } });
  await expectStatus(response, 201);
  return (await response.json() as { purchaseOrders: PurchaseOrderSummary[] }).purchaseOrders[0]!;
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

test("receiving an issued subset leaves unissued PR rows pending through the next PO", async ({ page }) => {
  const source = await approved(page, 3);
  const first = await combine(page, [source], [source.items[0]!.id]);
  let current = await getRequest(page, source.id);
  expect(current.orderableItemCount).toBe(2);
  expect(current.receivingItems).toHaveLength(1);
  await expectStatus(await receive(page, current, [{ itemId: current.receivingItems[0]!.id, quantity: 2 }]), 200);
  current = await getRequest(page, source.id);
  expect(current.status).toBe("ORDERED");
  expect(current.receivedAt).toBeNull();
  expect(current.orderableItemCount).toBe(2);
  await expectStatus(await receive(page, current, [{ itemId: source.items[1]!.id, quantity: 1 }]), 400);
  await expectStatus(await page.request.post(`/api/purchase-requests/${source.id}/receipt-references`, {
    data: { expectedVersion: current.receiptVersion, receiptNumber: "GR-NOT-COMPLETE", taxInvoiceNumber: "INV-NOT-COMPLETE" },
  }), 400);
  const second = await combine(page, [current], source.items.slice(1).map((item) => item.id));
  expect(second.id).not.toBe(first.id);
  current = await getRequest(page, source.id);
  expect(current.orderableItemCount).toBe(0);
  expect(current.receivingItems).toHaveLength(3);
  await expectStatus(await receive(page, current, current.receivingItems.filter((item) => item.remainingQuantity > 0)
    .map((item) => ({ itemId: item.id, quantity: item.remainingQuantity }))), 200);
  expect((await getRequest(page, source.id)).receivedAt).toBeTruthy();
});

test("a combined PO receives only the origin PR rows and closing one PR leaves the other open", async ({ page }) => {
  const a = await approved(page);
  const b = await approved(page);
  const combined = await combine(page, [a, b], [a.items[0]!.id, b.items[0]!.id]);
  let aCurrent = await getRequest(page, a.id);
  let bCurrent = await getRequest(page, b.id);
  expect(aCurrent.receivingItems.map((item) => item.id)).toEqual([a.items[0]!.id]);
  expect(bCurrent.receivingItems.map((item) => item.id)).toEqual([b.items[0]!.id]);
  await expectStatus(await receive(page, aCurrent, [{ itemId: b.items[0]!.id, quantity: 1 }]), 400);
  await expectStatus(await receive(page, aCurrent, [{ itemId: a.items[0]!.id, quantity: 1 }]), 200);
  aCurrent = await getRequest(page, a.id);
  await expectStatus(await page.request.post(`/api/purchase-requests/${a.id}/close`, {
    data: { expectedVersion: aCurrent.receiptVersion },
  }), 200);
  aCurrent = await getRequest(page, a.id);
  bCurrent = await getRequest(page, b.id);
  expect(aCurrent.status).toBe("COMPLETED");
  expect(aCurrent.orderableItemCount).toBe(0);
  expect(aCurrent.items[1]!.closedQuantity).toBe(2);
  expect(bCurrent.status).toBe("ORDERED");
  expect(bCurrent.receivingItems[0]!.receivedQuantity).toBe(0);
  expect(bCurrent.orderableItemCount).toBe(1);
  const document = await getOrder(page, combined.id);
  expect(document.items.find((item) => item.sourcePurchaseRequestId === b.id)!.closedQuantity).toBe(0);
  await expectStatus(await receive(page, bCurrent, [{ itemId: bCurrent.receivingItems[0]!.id, quantity: 2 }]), 200);
  expect((await getRequest(page, b.id)).receivedAt).toBeNull();
});

test("cancelled PO rows cannot receive and reissued rows start with independent balances", async ({ page }) => {
  const source = await approved(page, 1);
  const cancelled = await combine(page, [source], [source.items[0]!.id]);
  const staleReceipt = await getRequest(page, source.id);
  const before = await getOrder(page, cancelled.id);
  await expectStatus(await page.request.post(`/api/purchase-orders/${cancelled.id}/cancellation`, {
    data: { expectedVersion: before.version, reason: "Supplier cannot fulfil this order" },
  }), 200);
  const pending = await getRequest(page, source.id);
  expect(pending.status).toBe("APPROVED");
  expect(pending.receivingItems).toHaveLength(0);
  expect(pending.orderableItemCount).toBe(1);
  await combine(page, [pending], [pending.items[0]!.id]);
  await expectStatus(await receive(page, staleReceipt, [{ itemId: source.items[0]!.id, quantity: 1 }]), 409);
  const reissued = await getRequest(page, source.id);
  const oldLine = before.items[0]!;
  await expectStatus(await receive(page, reissued, [{ itemId: oldLine.id, quantity: 1 }]), 400);
  await expectStatus(await receive(page, reissued, [{ itemId: reissued.receivingItems[0]!.id, quantity: 2 }]), 200);
  const oldDocument = await getOrder(page, cancelled.id);
  expect(oldDocument.status).toBe("CANCELLED");
  expect(oldDocument.items[0]!.receivedQuantity).toBe(0);
});

test("cancelling a PR cannot cancel a shared PO or the other source PR", async ({ page }) => {
  const a = await approved(page, 1);
  const b = await approved(page, 1);
  const combined = await combine(page, [a, b], [a.items[0]!.id, b.items[0]!.id]);
  await expectStatus(await page.request.post(`/api/purchase-requests/${a.id}/cancellation`, {
    data: { action: "CANCEL", reason: "Cancel only this procurement request", cancellationReference: "CANCEL-SHARED" },
  }), 400);
  expect((await getRequest(page, a.id)).status).toBe("ORDERED");
  expect((await getRequest(page, b.id)).status).toBe("ORDERED");
  expect((await getOrder(page, combined.id)).status).toBe("ISSUED");
});

test("a cancelled PO permits a returned PR revision while keeping its issued snapshot", async ({ page }) => {
  const source = await approved(page, 1);
  const summary = await combine(page, [source], [source.items[0]!.id]);
  const issued = await getOrder(page, summary.id);
  await expectStatus(await page.request.post(`/api/purchase-orders/${issued.id}/cancellation`, {
    data: { expectedVersion: issued.version, reason: "Return this purchase for a new specification" },
  }), 200);
  await expectStatus(await page.request.post(`/api/purchase-requests/${source.id}/status`, {
    data: { action: "ORDERED", comment: "Cannot replace an internal order with a manual status" },
  }), 400);
  await expectStatus(await page.request.post(`/api/purchase-requests/${source.id}/status`, {
    data: { action: "REQUEST_REVISION", comment: "Revise the specification before issuing a replacement PO" },
  }), 200);
  await authenticate(page);
  await expectStatus(await page.request.patch(`/api/purchase-requests/${source.id}`, { data: {
    requestDate: "2026-10-30", department: "Operations", reason: "Revised specification after cancelling the first PO",
    urgency: "NORMAL", submit: true, items: [{ itemName: "Replacement requested item", quantity: 3,
      unit: "ชิ้น", unitPrice: 5, amount: 15 }],
  } }), 200);
  const revised = await getRequest(page, source.id);
  expect(revised.status).toBe("APPROVED");
  expect(revised.orderableItemCount).toBe(1);
  expect(revised.items[0]!.id).not.toBe(source.items[0]!.id);
  const cancelled = await getOrder(page, issued.id);
  expect(cancelled.status).toBe("CANCELLED");
  expect(cancelled.items[0]!).toMatchObject({ itemName: source.items[0]!.itemName, quantity: 2,
    amount: 200, sourcePurchaseRequestId: source.id, purchaseRequestItemId: null });
  await authenticate(page, credentials.purchasing);
  const replacement = await combine(page, [revised], [revised.items[0]!.id]);
  expect((await getOrder(page, replacement.id)).totalAmount).toBe(15);
});
