import { expect, test, type Page } from "@playwright/test";

import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import {
  authenticate,
  createOrderedRequest,
  expectStatus,
  getRequest,
  receive,
  receivedDate,
} from "./receipt-support";
import { createRequestViaApi, credentials, uniqueValue } from "./support";

function closeOrder(page: Page, request: PurchaseRequestDetail, expectedVersion = request.receiptVersion) {
  return page.request.post(`/api/purchase-requests/${request.id}/close`, {
    data: { expectedVersion },
  });
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function createIssuedRequest(page: Page) {
  await authenticate(page);
  const created = await createRequestViaApi(page, { submit: true });
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${created.id}/approval`, {
    data: { action: "APPROVED", comment: "Approved for order closure tests" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  const approved = await getRequest(page, created.id);
  const response = await page.request.post(`/api/purchase-requests/${created.id}/purchase-orders`, {
    data: { orders: [{ supplierName: uniqueValue("Closure supplier"), itemIds: approved.items.map((item) => item.id) }] },
  });
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  return { request: await getRequest(page, created.id), order: await getOrder(page, purchaseOrders[0]!.id) };
}

test("fresh ordered PRs can close immediately with Purchasing or Admin permission and a valid version", async ({ page }) => {
  test.setTimeout(120_000);
  await authenticate(page);
  const request = await createOrderedRequest(page, [100]);
  for (const account of [credentials.purchasing, credentials.admin]) {
    await authenticate(page, account);
    expect((await getRequest(page, request.id)).canCloseOrder).toBe(true);
    await page.goto(`/purchase-requests/${request.id}`);
    await expect(page.locator("#close-order")).toBeVisible();
  }
  for (const account of [credentials.employee, credentials.approver, credentials.management]) {
    await authenticate(page, account);
    expect((await getRequest(page, request.id)).canCloseOrder).toBe(false);
    await page.goto(`/purchase-requests/${request.id}`);
    await expect(page.locator("#close-order")).toHaveCount(0);
    await expectStatus(await closeOrder(page, request), 403);
  }
  await page.context().clearCookies();
  await expectStatus(await closeOrder(page, request), 401);

  await authenticate(page, credentials.purchasing);
  const current = await getRequest(page, request.id);
  expect(current.canCloseOrder).toBe(true);
  const endpoint = `/api/purchase-requests/${current.id}/close`;
  for (const data of [{}, { expectedVersion: -1 }, { expectedVersion: 0.5 }, { expectedVersion: "0" }]) {
    await expectStatus(await page.request.post(endpoint, { data }), 400);
  }
  const draft = await createRequestViaApi(page);
  await expectStatus(await closeOrder(page, await getRequest(page, draft.id)), 400);
  const unchanged = await getRequest(page, current.id);
  expect(unchanged.status).toBe("ORDERED");
  expect(unchanged.receiptVersion).toBe(current.receiptVersion);
  expect(unchanged.receipts).toHaveLength(0);
});

test("Purchasing confirms PR closure, preserving actual receipts and missing round documents", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await authenticate(page);
  let request = await createOrderedRequest(page);
  const [first, second] = request.items;
  await expectStatus(await receive(page, request, [
    { itemId: first!.id, quantity: 40 },
    { itemId: second!.id, quantity: 10 },
  ], { receiptNumber: "CLOSURE-RECEIPT-KEEP", taxInvoiceNumber: "CLOSURE-TAX-KEEP" }), 200);
  request = await getRequest(page, request.id);
  await expectStatus(await receive(page, request, [{ itemId: first!.id, quantity: 5 }]), 200);
  const before = await getRequest(page, request.id);
  expect(before.receipts).toHaveLength(2);
  expect(before.receipts[1]!.receiptNumber).toBeNull();
  await authenticate(page, credentials.purchasing);
  await page.goto(`/purchase-requests/${request.id}`);
  const trigger = page.locator("#close-order");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toContainText(request.prNumber);
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("alertdialog").screenshot({ path: testInfo.outputPath("order-closure-mobile.png") });
  if (originalViewport) await page.setViewportSize(originalViewport);
  expect((await getRequest(page, request.id)).status).toBe("ORDERED");
  const response = page.waitForResponse((result) => result.url().endsWith(`/purchase-requests/${request.id}/close`) && result.request().method() === "POST");
  await page.locator("#confirm-close-order").click();
  await expectStatus(await response, 200);
  await expect(trigger).toHaveCount(0);
  const completed = await getRequest(page, request.id);
  expect(completed).toMatchObject({
    status: "COMPLETED", receiptVersion: before.receiptVersion + 1,
    receivedAt: receivedDate, canCloseOrder: false,
  });
  expect(completed.completedAt).toBeTruthy();
  expect(completed.items).toEqual([
    expect.objectContaining({ id: first!.id, receivedQuantity: 45, closedQuantity: 55, remainingQuantity: 0 }),
    expect.objectContaining({ id: second!.id, receivedQuantity: 10, closedQuantity: 0, remainingQuantity: 0 }),
  ]);
  expect(completed.receipts.filter((receipt) => receipt.action === "RECEIVED")).toEqual(before.receipts);
  const closures = completed.receipts.filter((receipt) => receipt.action === "CLOSE_REMAINDER");
  expect(closures).toHaveLength(1);
  expect(closures[0]).toMatchObject({
    comment: expect.any(String), recordedBy: { id: expect.any(String) },
    items: [expect.objectContaining({ itemId: first!.id, quantity: 55 })],
  });
  expect(closures[0]!.recordedBy.id).not.toBe(completed.requester.id);
  expect(completed.approvals.filter((approval) => approval.action === "COMPLETED")).toHaveLength(1);
});

test("a fully received order can close missing paperwork without adding a delivery or closure receipt", async ({ page }) => {
  test.setTimeout(90_000);
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await expectStatus(await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 100 }]), 200);
  request = await getRequest(page, request.id);
  expect(request.status).toBe("ORDERED");
  expect(request.receivedAt).toBe(receivedDate);
  expect(request.receipts[0]!.receiptNumber).toBeNull();
  await authenticate(page, credentials.purchasing);
  await expectStatus(await closeOrder(page, request), 200);
  const completed = await getRequest(page, request.id);
  expect(completed.status).toBe("COMPLETED");
  expect(completed.receivedAt).toBe(receivedDate);
  expect(completed.receiptVersion).toBe(request.receiptVersion + 1);
  expect(completed.items[0]).toMatchObject({ receivedQuantity: 100, closedQuantity: 0, remainingQuantity: 0 });
  expect(completed.receipts).toEqual(request.receipts);
  expect(completed.approvals.filter((approval) => approval.action === "COMPLETED")).toHaveLength(1);
});

test("Admin closes an unreceived order from PO without inventing a received date", async ({ page }) => {
  test.setTimeout(120_000);
  const { request, order } = await createIssuedRequest(page);
  await authenticate(page, credentials.admin);
  const currentOrder = await getOrder(page, order.id);
  expect(currentOrder.purchaseRequest.canCloseOrder).toBe(true);
  await page.goto(`/purchase-orders/${order.id}`);
  await expect(page.locator("#close-order")).toBeVisible();
  await page.locator("#close-order").click();
  const response = page.waitForResponse((result) => result.url().endsWith(`/purchase-requests/${request.id}/close`) && result.request().method() === "POST");
  await page.locator("#confirm-close-order").click();
  await expectStatus(await response, 200);
  await expect(page.locator("#close-order")).toHaveCount(0);
  const completed = await getRequest(page, request.id);
  expect(completed.status).toBe("COMPLETED");
  expect(completed.completedAt).toBeTruthy();
  expect(completed.receivedAt).toBeNull();
  expect(completed.receiptNumber).toBeNull();
  expect(completed.taxInvoiceNumber).toBeNull();
  expect(completed.items).toEqual(request.items);
  expect(completed.totalAmount).toBe(request.totalAmount);
  expect(completed.receivingItems).toEqual(request.receivingItems.map((item) => expect.objectContaining({
    id: item.id, receivedQuantity: 0, closedQuantity: item.quantity, remainingQuantity: 0,
  })));
  expect(completed.receipts).toHaveLength(1);
  expect(completed.receipts[0]).toMatchObject({ action: "CLOSE_REMAINDER", receiptNumber: null, taxInvoiceNumber: null });
  expect((await getOrder(page, order.id)).purchaseRequest).toMatchObject({ status: "COMPLETED", canCloseOrder: false });
  await expectStatus(await closeOrder(page, completed), 400);
  expect((await getRequest(page, request.id)).receipts).toEqual(completed.receipts);
});

test("stale and concurrent closures cannot lose receipts or duplicate the completion audit", async ({ page }) => {
  test.setTimeout(120_000);
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const staleVersion = request.receiptVersion;
  await expectStatus(await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 30 }]), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await closeOrder(page, request, staleVersion), 409);
  expect((await getRequest(page, request.id)).items[0]!.receivedQuantity).toBe(30);
  const responses = await Promise.all([closeOrder(page, request), closeOrder(page, request)]);
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
  const completed = await getRequest(page, request.id);
  expect(completed.status).toBe("COMPLETED");
  expect(completed.receiptVersion).toBe(request.receiptVersion + 1);
  expect(completed.items[0]).toMatchObject({ receivedQuantity: 30, closedQuantity: 70, remainingQuantity: 0 });
  expect(completed.receipts.filter((receipt) => receipt.action === "RECEIVED")).toEqual(request.receipts);
  expect(completed.receipts.filter((receipt) => receipt.action === "CLOSE_REMAINDER")).toHaveLength(1);
  expect(completed.approvals.filter((approval) => approval.action === "COMPLETED")).toHaveLength(1);
  await expectStatus(await closeOrder(page, request), 409);
  expect((await getRequest(page, request.id)).receipts).toEqual(completed.receipts);
});

test("a receipt racing order closure commits only the delivered quantity or the closed balance", async ({ page }) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const request = await createOrderedRequest(page, [100]);
  await authenticate(page, credentials.purchasing);
  const [closure, receipt] = await Promise.all([
    closeOrder(page, request),
    receive(page, request, [{ itemId: request.items[0]!.id, quantity: 30 }]),
  ]);
  expect([closure.status(), receipt.status()].filter((status) => status === 200)).toHaveLength(1);
  expect([400, 409]).toContain(closure.status() === 200 ? receipt.status() : closure.status());
  const updated = await getRequest(page, request.id);
  expect(updated.receiptVersion).toBe(request.receiptVersion + 1);
  expect(updated.receipts).toHaveLength(1);
  const item = updated.items[0]!;
  expect(item.receivedQuantity + item.closedQuantity).toBeLessThanOrEqual(item.quantity);
  const completions = updated.approvals.filter((approval) => approval.action === "COMPLETED");
  if (receipt.status() === 200) {
    expect(updated.status).toBe("ORDERED");
    expect(item).toMatchObject({ receivedQuantity: 30, closedQuantity: 0, remainingQuantity: 70 });
    expect(updated.receipts[0]).toMatchObject({ action: "RECEIVED", items: [expect.objectContaining({ quantity: 30 })] });
    expect(completions).toHaveLength(0);
  } else {
    expect(updated.status).toBe("COMPLETED");
    expect(updated.receivedAt).toBeNull();
    expect(item).toMatchObject({ receivedQuantity: 0, closedQuantity: 100, remainingQuantity: 0 });
    expect(updated.receipts[0]).toMatchObject({ action: "CLOSE_REMAINDER", items: [expect.objectContaining({ quantity: 100 })] });
    expect(completions).toHaveLength(1);
  }
});

test("a pending PO amendment blocks order closure until it is reviewed", async ({ page }) => {
  test.setTimeout(120_000);
  const { request, order } = await createIssuedRequest(page);
  const proposal = await page.request.patch(`/api/purchase-orders/${order.id}`, {
    data: {
      expectedVersion: order.version,
      reason: "Order closure must wait for this proposed header change",
      supplier: { supplierName: order.supplierName },
      note: "Pending revised supplier delivery note",
      items: order.items.map((item) => ({
        id: item.id, itemName: item.itemName, description: item.description ?? "",
        quantity: item.quantity, unit: item.unit ?? "", unitPrice: item.unitPrice,
      })),
    },
  });
  await expectStatus(proposal, 200);
  const pending = await getRequest(page, request.id);
  expect(pending.hasPendingPurchaseOrderChange).toBe(true);
  expect(pending.canCloseOrder).toBe(false);
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.locator("#close-order")).toHaveCount(0);
  await page.goto(`/purchase-orders/${order.id}`);
  await expect(page.locator("#close-order")).toHaveCount(0);
  await expectStatus(await closeOrder(page, pending), 400);
  const unchanged = await getRequest(page, request.id);
  expect(unchanged.status).toBe("ORDERED");
  expect(unchanged.receiptVersion).toBe(pending.receiptVersion);
  expect(unchanged.receipts).toHaveLength(0);
});
