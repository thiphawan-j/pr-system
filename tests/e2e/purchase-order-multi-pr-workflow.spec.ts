import { expect, test, type Page } from "@playwright/test";
import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest, receive } from "./receipt-support";
import { credentials, uniqueValue, type Credentials } from "./support";

async function approvedSource(page: Page, owner: Credentials = credentials.employee, approver: Credentials = credentials.approver, prices = [100]) {
  await authenticate(page, owner);
  const marker = uniqueValue("Combined-workflow");
  const response = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify({
    requestDate: "2026-10-30", department: owner === credentials.employee2 ? "Projects" : "Operations",
    reason: `Purchasing source ${marker}`, urgency: "NORMAL", submit: true,
    items: prices.map((unitPrice, index) => ({ itemName: `${marker} row ${index + 1}`, quantity: 1, unit: "ชิ้น", unitPrice, amount: unitPrice })),
  }) } });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  await authenticate(page, approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, { data: { action: "APPROVED", comment: "Approve source for combined PO workflow" } }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, id);
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function combinedOrder(page: Page, sources: PurchaseRequestDetail[], extra: Record<string, unknown> = {}) {
  await authenticate(page, credentials.purchasing);
  const response = await page.request.post("/api/purchase-orders", { data: {
    requests: sources.map((source) => ({ id: source.id, expectedUpdatedAt: source.orderPreparationVersion ?? source.updatedAt })),
    orders: [{ supplierName: "One combined supplier", itemIds: sources.map((source) => source.items[0]!.id), ...extra }],
  } });
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  expect(purchaseOrders).toHaveLength(1);
  return getOrder(page, purchaseOrders[0]!.id);
}

function amendment(order: PurchaseOrderDetail, extra: Record<string, unknown> = {}) {
  return {
    expectedVersion: order.version, reason: "Revise the combined supplier quotation",
    supplier: { supplierName: order.supplierName },
    deliveryAddress: order.deliveryAddress ?? "", paymentTerms: order.paymentTerms ?? "",
    expectedDeliveryDate: order.expectedDeliveryDate ?? "", note: order.note ?? "",
    items: order.items.map((item) => ({
      id: item.id, sourcePurchaseRequestId: item.sourcePurchaseRequestId, itemName: item.itemName,
      description: item.description ?? "", quantity: item.quantity, unit: item.unit ?? "", unitPrice: item.unitPrice,
    })), ...extra,
  };
}

async function propose(page: Page, order: PurchaseOrderDetail, extra: Record<string, unknown> = {}) {
  const response = await page.request.patch(`/api/purchase-orders/${order.id}`, { data: amendment(order, extra) });
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

function review(page: Page, order: PurchaseOrderDetail) {
  return page.request.post(`/api/purchase-orders/${order.id}/changes/${order.pendingChangeId}/review`, {
    data: { expectedVersion: order.version, action: "APPROVED", comment: "Reviewed the source allocation and prices" },
  });
}

function cancel(page: Page, order: PurchaseOrderDetail) {
  return page.request.post(`/api/purchase-orders/${order.id}/cancellation`, { data: {
    expectedVersion: order.version, reason: "Supplier cannot fulfill this purchase order", cancellationReference: "CANCEL-COMBINED-PO",
  } });
}

test("combined PO amendments synchronize only each origin's rows and allocated amounts, with private per-PR Timeline", async ({ page }) => {
  const a = await approvedSource(page, credentials.employee, credentials.approver, [100, 30]);
  const b = await approvedSource(page, credentials.employee, credentials.approver, [200]);
  const order = await combinedOrder(page, [a, b], { taxMode: "EXCLUSIVE", vatRate: 7, discountType: "PERCENT", discountValue: 10 });
  expect(order.totalAmount).toBe(288.9);
  const pending = await propose(page, order, {
    items: (amendment(order).items).map((item) => ({ ...item, unitPrice: item.sourcePurchaseRequestId === a.id ? 150 : 250 })),
  });
  await authenticate(page, credentials.approver);
  const response = await review(page, pending);
  await expectStatus(response, 200);
  const updated = await response.json() as PurchaseOrderDetail;
  expect(updated.totalAmount).toBe(385.2);
  const sourceA = await getRequest(page, a.id);
  const sourceB = await getRequest(page, b.id);
  expect(sourceA.totalAmount).toBe(174.45); // 150 less 10%, plus VAT, plus untouched 30.
  expect(sourceB.totalAmount).toBe(240.75);
  expect(sourceA.items.find((item) => item.id === a.items[1]!.id)).toMatchObject({ amount: 30, unitPrice: 30 });
  const timelineA = sourceA.approvals.filter((entry) => entry.stepLabel === "อนุมัติแก้ไข PO").map((entry) => entry.comment).join("\n");
  const timelineB = sourceB.approvals.filter((entry) => entry.stepLabel === "อนุมัติแก้ไข PO").map((entry) => entry.comment).join("\n");
  expect(timelineA).toContain(a.items[0]!.itemName);
  expect(timelineA).not.toContain(b.items[0]!.itemName);
  expect(timelineB).toContain(b.items[0]!.itemName);
  expect(timelineB).not.toContain(a.items[0]!.itemName);
  expect(sourceA.receivingItems.map((item) => item.itemName)).toEqual([a.items[0]!.itemName]);
  expect(sourceB.receivingItems.map((item) => item.itemName)).toEqual([b.items[0]!.itemName]);
  expect(updated.items.every((item) => item.receivedQuantity === 0)).toBe(true);
});

test("different original approvers require management or admin, and access to one PR never exposes the combined PO or PDF", async ({ page }) => {
  const a = await approvedSource(page);
  const b = await approvedSource(page, credentials.employee2, credentials.admin);
  const order = await combinedOrder(page, [a, b]);
  const pending = await propose(page, order, { note: "A header change that affects both source requests" });
  for (const account of [credentials.employee, credentials.employee2, credentials.approver]) {
    await authenticate(page, account);
    await expectStatus(await page.request.get(`/api/purchase-orders/${order.id}`), 403);
    await expectStatus(await page.request.get(`/api/purchase-orders/${order.id}/pdf`), 403);
    await expectStatus(await review(page, pending), 403);
  }
  await authenticate(page, credentials.purchasing);
  await expectStatus(await review(page, pending), 403);
  await authenticate(page, credentials.management);
  await expectStatus(await review(page, pending), 200);
  const approved = await getOrder(page, order.id);
  expect(approved.note).toBe("A header change that affects both source requests");
  expect(approved.pendingChangeId).toBeNull();
});

test("cancelling only a combined PO retains its snapshot, reopens source rows and permits issuing them again", async ({ page }) => {
  const a = await approvedSource(page, credentials.employee, credentials.approver, [100, 30]);
  const b = await approvedSource(page, credentials.employee2, credentials.admin, [200]);
  const order = await combinedOrder(page, [a, b], { discountType: "AMOUNT", discountValue: 30 });
  expect(order.totalAmount).toBe(270);
  const response = await cancel(page, order);
  await expectStatus(response, 200);
  const cancelled = await response.json() as PurchaseOrderDetail;
  expect(cancelled).toMatchObject({ status: "CANCELLED", totalAmount: 270, canCancel: false, canEdit: false, canReview: false, cancellationReference: "CANCEL-COMBINED-PO" });
  expect(cancelled.cancelledAt).toBeTruthy();
  expect(cancelled.cancelledBy?.id).toBeTruthy();
  expect(cancelled.items).toEqual(order.items);
  const sourceA = await getRequest(page, a.id);
  const sourceB = await getRequest(page, b.id);
  expect(sourceA.status).toBe("APPROVED");
  expect(sourceB.status).toBe("APPROVED");
  expect(sourceA.items).toHaveLength(2);
  expect(sourceA.totalAmount).toBe(130);
  expect(sourceB.totalAmount).toBe(200);
  expect(sourceA.items[0]!.orderDiscountAmount ?? 0).toBe(0);
  expect(sourceA.receipts).toHaveLength(0);
  const ownHistory = sourceA.approvals.find((entry) => entry.stepLabel === "ยกเลิกเฉพาะ PO")!.comment;
  expect(ownHistory).toContain(a.items[0]!.itemName);
  expect(ownHistory).not.toContain(b.items[0]!.itemName);
  await expectStatus(await cancel(page, order), 409);
  const reissued = await combinedOrder(page, [sourceA, sourceB]);
  expect(reissued.id).not.toBe(order.id);
  expect(reissued.poNumber).not.toBe(order.poNumber);
  expect(reissued.totalAmount).toBe(300);
  expect((await getOrder(page, order.id)).items).toEqual(order.items);
  expect((await getRequest(page, a.id)).items).toHaveLength(2);
});

test("cancellation enforces role, version, pending amendment and receipt restrictions", async ({ page }) => {
  const a = await approvedSource(page);
  const b = await approvedSource(page);
  const order = await combinedOrder(page, [a, b]);
  await authenticate(page, credentials.employee);
  await expectStatus(await cancel(page, order), 403);
  await authenticate(page, credentials.purchasing);
  const pending = await propose(page, order, { note: "Review must finish before cancellation" });
  await expectStatus(await cancel(page, pending), 409);
  await authenticate(page, credentials.approver);
  await expectStatus(await review(page, pending), 200);
  await authenticate(page, credentials.purchasing);
  const approved = await getOrder(page, order.id);
  await expectStatus(await cancel(page, order), 409);
  const sourceA = await getRequest(page, a.id);
  await expectStatus(await receive(page, sourceA, [{ itemId: sourceA.receivingItems[0]!.id, quantity: 1 }]), 200);
  const received = await getOrder(page, order.id);
  expect(received.canCancel).toBe(false);
  await expectStatus(await cancel(page, received), 400);
  expect((await getOrder(page, order.id)).status).toBe("ISSUED");
  expect(approved.items[0]!.receivedQuantity).toBe(0);
});

test("new amendment rows require an origin and existing rows cannot be reassigned to another PR", async ({ page }) => {
  const a = await approvedSource(page);
  const b = await approvedSource(page);
  const order = await combinedOrder(page, [a, b]);
  const itemA = order.items.find((item) => item.sourcePurchaseRequestId === a.id)!;
  const rows = amendment(order).items;
  await expectStatus(await page.request.patch(`/api/purchase-orders/${order.id}`, { data: amendment(order, {
    items: rows.filter((item) => item.sourcePurchaseRequestId !== a.id),
  }) }), 400);
  await expectStatus(await page.request.patch(`/api/purchase-orders/${order.id}`, { data: amendment(order, {
    items: rows.map((item) => item.id === itemA.id ? { ...item, sourcePurchaseRequestId: b.id } : item),
  }) }), 400);
  const added = { itemName: "Additional origin-specific cable", quantity: 2, unit: "ชิ้น", unitPrice: 10 };
  await expectStatus(await page.request.patch(`/api/purchase-orders/${order.id}`, { data: amendment(order, { items: [...rows, added] }) }), 400);
  const pending = await propose(page, order, { items: [...rows, { ...added, sourcePurchaseRequestId: b.id }] });
  await authenticate(page, credentials.approver);
  await expectStatus(await review(page, pending), 200);
  const sourceA = await getRequest(page, a.id);
  const sourceB = await getRequest(page, b.id);
  expect(sourceA.items).toHaveLength(1);
  expect(sourceB.items).toHaveLength(2);
  expect(sourceB.items.find((item) => item.itemName === added.itemName)).toMatchObject({ quantity: 2, amount: 20 });
  expect(sourceA.totalAmount).toBe(100);
  expect(sourceB.totalAmount).toBe(120);
});

test("per-PR overflow including unissued rows rejects an otherwise valid combined-PO total atomically", async ({ page }) => {
  const a = await approvedSource(page, credentials.employee, credentials.approver, [50, 100]);
  const b = await approvedSource(page, credentials.employee, credentials.approver, [20]);
  const order = await combinedOrder(page, [a, b]);
  const beforeA = await getRequest(page, a.id);
  const beforeB = await getRequest(page, b.id);
  await expectStatus(await page.request.patch(`/api/purchase-orders/${order.id}`, { data: amendment(order, {
    items: amendment(order).items.map((item) => ({ ...item, unitPrice: item.sourcePurchaseRequestId === a.id ? 9999999950 : item.unitPrice })),
  }) }), 400);
  expect(await getOrder(page, order.id)).toEqual(order);
  expect(await getRequest(page, a.id)).toEqual(beforeA);
  expect(await getRequest(page, b.id)).toEqual(beforeB);
});

test("a cancellation racing a receipt cannot cancel a received document or record a receipt on a cancelled PO", async ({ page }) => {
  const a = await approvedSource(page);
  const b = await approvedSource(page);
  const order = await combinedOrder(page, [a, b]);
  const sourceA = await getRequest(page, a.id);
  const [cancellation, receipt] = await Promise.all([
    cancel(page, order), receive(page, sourceA, [{ itemId: sourceA.receivingItems[0]!.id, quantity: 1 }]),
  ]);
  expect([cancellation.status(), receipt.status()].filter((status) => status === 200)).toHaveLength(1);
  expect([400, 409]).toContain(cancellation.status() === 200 ? receipt.status() : cancellation.status());
  const current = await getOrder(page, order.id);
  if (current.status === "CANCELLED") {
    expect(current.items.every((item) => item.receivedQuantity === 0)).toBe(true);
    expect((await getRequest(page, a.id)).receipts).toHaveLength(0);
  } else {
    expect(current.items.find((item) => item.sourcePurchaseRequestId === a.id)!.receivedQuantity).toBe(1);
    expect((await getRequest(page, a.id)).receipts).toHaveLength(1);
  }
});

test("closing one source PR keeps the other origin editable while every closed-origin commercial row stays frozen", async ({ page }) => {
  const a = await approvedSource(page);
  const b = await approvedSource(page);
  const order = await combinedOrder(page, [a, b]);
  const sourceA = await getRequest(page, a.id);
  await expectStatus(await page.request.post(`/api/purchase-requests/${a.id}/close`, { data: { expectedVersion: sourceA.receiptVersion } }), 200);
  const closedA = await getRequest(page, a.id);
  expect(closedA.status).toBe("COMPLETED");
  const current = await getOrder(page, order.id);
  expect(current.canEdit).toBe(true);
  const rows = amendment(current).items;
  await expectStatus(await page.request.patch(`/api/purchase-orders/${order.id}`, { data: amendment(current, {
    items: rows.map((item) => item.sourcePurchaseRequestId === a.id ? { ...item, quantity: 2 } : item),
  }) }), 400);
  await expectStatus(await page.request.patch(`/api/purchase-orders/${order.id}`, { data: amendment(current, {
    items: [...rows, { sourcePurchaseRequestId: a.id, itemName: "Cannot add to a closed origin", quantity: 1, unitPrice: 10 }],
  }) }), 400);
  const pending = await propose(page, current, {
    items: rows.map((item) => item.sourcePurchaseRequestId === b.id ? { ...item, quantity: 2 } : item),
  });
  await authenticate(page, credentials.approver);
  await expectStatus(await review(page, pending), 200);
  const unchangedA = await getRequest(page, a.id);
  expect(unchangedA.status).toBe("COMPLETED");
  expect(unchangedA.items).toEqual(closedA.items);
  expect(unchangedA.receipts).toEqual(closedA.receipts);
  expect(unchangedA.totalAmount).toBe(100);
  const changedB = await getRequest(page, b.id);
  expect(changedB.items[0]!.quantity).toBe(2);
  expect(changedB.totalAmount).toBe(200);
  expect(changedB.status).toBe("ORDERED");
});

test("a historical closed origin with no remaining PO rows does not prevent cancelling another origin's unreceived rows", async ({ page }) => {
  const a = await approvedSource(page, credentials.employee, credentials.approver, [100, 30]);
  const b = await approvedSource(page);
  const order = await combinedOrder(page, [a, b]);
  const pending = await propose(page, order, {
    items: amendment(order).items.filter((item) => item.sourcePurchaseRequestId !== a.id),
  });
  await authenticate(page, credentials.approver);
  await expectStatus(await review(page, pending), 200);
  await authenticate(page, credentials.purchasing);
  const sourceA = await getRequest(page, a.id);
  expect(sourceA.items).toHaveLength(1);
  expect(sourceA.items[0]!.id).toBe(a.items[1]!.id);
  await expectStatus(await page.request.post(`/api/purchase-requests/${a.id}/close`, { data: { expectedVersion: sourceA.receiptVersion } }), 200);
  const closedA = await getRequest(page, a.id);
  expect(closedA.status).toBe("COMPLETED");
  const current = await getOrder(page, order.id);
  expect(current.items).toHaveLength(1);
  expect(current.items[0]!.sourcePurchaseRequestId).toBe(b.id);
  expect(current.purchaseRequests?.map((source) => source.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  expect(current.canCancel).toBe(true);
  await expectStatus(await cancel(page, current), 200);
  const unchangedA = await getRequest(page, a.id);
  expect(unchangedA.status).toBe("COMPLETED");
  expect(unchangedA.items).toEqual(closedA.items);
  expect(unchangedA.receipts).toEqual(closedA.receipts);
  expect((await getRequest(page, b.id)).status).toBe("APPROVED");
  expect((await getOrder(page, order.id)).status).toBe("CANCELLED");
});
