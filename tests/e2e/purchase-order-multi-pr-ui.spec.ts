import { expect, test, type Page } from "@playwright/test";

import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

async function approvedSources(page: Page, counts: number[]) {
  const marker = uniqueValue("Multi-PR-UI");
  await authenticate(page);
  const ids: string[] = [];
  for (const [source, count] of counts.entries()) {
    const response = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify({
      requestDate: "2026-10-30", department: "Operations", reason: `Prepare consolidated purchase ${marker} ${source}`,
      urgency: "NORMAL", submit: true,
      items: Array.from({ length: count }, (_, index) => ({ itemName: `${marker}-${source}-${index}`, quantity: 1, unit: "ชิ้น", unitPrice: source === 0 ? (index + 1) * 10 : 30, amount: source === 0 ? (index + 1) * 10 : 30, supplierName: "Shared UI supplier" })),
    }) } });
    await expectStatus(response, 200);
    ids.push((await response.json() as { id: string }).id);
  }
  await authenticate(page, credentials.approver);
  for (const id of ids) await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, { data: { action: "APPROVED", comment: "Approve sources for combined PO UI" } }), 200);
  await authenticate(page, credentials.purchasing);
  return { marker, sources: await Promise.all(ids.map((id) => getRequest(page, id))) };
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return response.json() as Promise<PurchaseOrderDetail>;
}

function references(sources: PurchaseRequestDetail[]) {
  return sources.map((source) => ({ id: source.id, expectedUpdatedAt: source.orderPreparationVersion ?? source.updatedAt }));
}

test("Purchasing selects several PRs, leaves unchecked rows pending, and cancels only the combined PO", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { marker, sources: [a, b] } = await approvedSources(page, [2, 1]);
  await page.goto(`/purchase-orders/new?requestId=${a!.id}`);
  await page.locator("#po-request-search").fill(marker);
  await expect(page.locator(`#po-source-request-${a!.id}`)).toBeChecked();
  await page.locator(`#po-source-request-${b!.id}`).check();
  await page.locator("#prepare-combined-po").click();
  await expect(page.locator(`#select-po-item-${a!.items[0]!.id}`)).toBeChecked();
  await page.locator(`#select-po-item-${a!.items[1]!.id}`).uncheck();
  await expect(page.locator("#po-selected-count")).toContainText("2 / 3");
  await page.locator("#po-group-0-tax-mode").selectOption("EXCLUSIVE");
  await page.locator("#po-group-0-discount-type").selectOption("PERCENT");
  await page.locator("#po-group-0-discount-value").fill("10");
  await expect(page.locator("#po-preparation-total")).toContainText("38.52");
  await page.screenshot({ path: testInfo.outputPath("multi-pr-create-desktop.png"), fullPage: true });
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath("multi-pr-create-mobile.png"), fullPage: true });
  if (viewport) await page.setViewportSize(viewport);
  const creating = page.waitForResponse((response) => response.url().endsWith("/api/purchase-orders") && response.request().method() === "POST");
  await page.locator("#create-purchase-orders").click();
  await page.locator("#confirm-create-purchase-orders").click();
  const created = await creating;
  await expectStatus(created, 201);
  const [summary] = (await created.json() as { purchaseOrders: PurchaseOrderSummary[] }).purchaseOrders;
  await expect(page).toHaveURL(`/purchase-orders/${summary!.id}`);
  await expect(page.locator(`a[href="/purchase-requests/${a!.id}"]`).first()).toBeVisible();
  await expect(page.locator(`a[href="/purchase-requests/${b!.id}"]`).first()).toBeVisible();
  await expect(page.locator("#close-order")).toHaveCount(0);
  const order = await getOrder(page, summary!.id);
  expect(order.items).toHaveLength(2);
  expect(order.totalAmount).toBe(38.52);
  const partialA = await getRequest(page, a!.id);
  expect(partialA.items).toHaveLength(2);
  expect(partialA.orderableItemCount).toBe(1);
  expect(partialA.items.find((item) => item.id === a!.items[1]!.id)?.amount).toBe(20);
  await page.locator("#cancel-purchase-order").click();
  await page.locator("#confirm-cancel-purchase-order").click();
  await expect(page.getByRole("alertdialog").getByRole("alert")).toBeVisible();
  await page.locator("#po-cancellation-reason").fill("Replace this supplier PO while retaining both PRs");
  await page.locator("#po-cancellation-reference").fill("CANCEL-UI-2026");
  const cancelling = page.waitForResponse((response) => response.url().endsWith(`/purchase-orders/${order.id}/cancellation`) && response.request().method() === "POST");
  await page.locator("#confirm-cancel-purchase-order").click();
  await expectStatus(await cancelling, 200);
  await expect(page.locator("#po-cancellation-notice")).toContainText(/PO.*ยกเลิก|PO.*cancelled/i);
  await expect(page.locator("#cancel-purchase-order")).toHaveCount(0);
  for (const [source, count] of [[a!, 2], [b!, 1]] as const) {
    const retained = await getRequest(page, source.id);
    expect(retained.status).toBe("APPROVED");
    expect(retained.orderableItemCount).toBe(count);
    expect(retained.items).toHaveLength(count);
  }
  expect((await getOrder(page, order.id)).status).toBe("CANCELLED");
});

test("single PR create page issues selected rows and shows the remaining rows on its next visit", async ({ page }) => {
  const { sources: [source] } = await approvedSources(page, [2]);
  await page.goto(`/purchase-requests/${source!.id}/purchase-orders/new`);
  await page.locator("#clear-po-item-selection").click();
  await page.locator("#create-purchase-orders").click();
  await expect(page.locator('form [role="alert"]')).toContainText(/เลือก.*รายการ|Select at least one item/);
  await page.locator(`#select-po-item-${source!.items[0]!.id}`).check();
  await expect(page.locator("#po-preparation-total")).toContainText("10.00");
  const creating = page.waitForResponse((response) => response.url().endsWith(`/purchase-requests/${source!.id}/purchase-orders`) && response.request().method() === "POST");
  await page.locator("#create-purchase-orders").click();
  await page.locator("#confirm-create-purchase-orders").click();
  await expectStatus(await creating, 201);
  await expect(page).toHaveURL(`/purchase-requests/${source!.id}`);
  await page.goto(`/purchase-requests/${source!.id}/purchase-orders/new`);
  await expect(page.locator(`#po-item-name-${source!.items[0]!.id}`)).toHaveCount(0);
  await expect(page.locator(`#select-po-item-${source!.items[1]!.id}`)).toBeChecked();
  await expect(page.locator("#po-selected-count")).toContainText("1 / 1");
  const retained = await getRequest(page, source!.id);
  expect(retained.items).toHaveLength(2);
  expect(retained.orderableItemCount).toBe(1);
});

test("combined PO edit assigns a newly added row to the selected source PR and waits for approval", async ({ page }) => {
  test.setTimeout(90_000);
  const { sources: [a, b] } = await approvedSources(page, [1, 1]);
  const created = await page.request.post("/api/purchase-orders", { data: { requests: references([a!, b!]), orders: [{ supplierName: "Shared UI supplier", itemIds: [a!.items[0]!.id, b!.items[0]!.id] }] } });
  await expectStatus(created, 201);
  const [summary] = (await created.json() as { purchaseOrders: PurchaseOrderSummary[] }).purchaseOrders;
  await page.goto(`/purchase-orders/${summary!.id}/edit`);
  await expect(page.locator('select[id^="po-edit-item-source-"]')).toHaveCount(0);
  await page.locator("#po-edit-add-item").click();
  await page.locator("#po-edit-item-name-2").fill("New item assigned to second source PR");
  await page.locator("#po-edit-item-quantity-2").fill("2");
  await page.locator("#po-edit-item-unit-price-2").fill("5");
  await page.locator("#po-edit-item-source-2").selectOption(b!.id);
  await page.locator("#po-edit-reason").fill("Add missing item to the second source PR");
  const submitting = page.waitForResponse((response) => response.url().endsWith(`/purchase-orders/${summary!.id}`) && response.request().method() === "PATCH");
  await page.locator("#save-po-changes").click();
  await expectStatus(await submitting, 200);
  const pending = await getOrder(page, summary!.id);
  expect(pending.items).toHaveLength(2);
  expect(pending.pendingChangeId).toBeTruthy();
  expect((await getRequest(page, b!.id)).items).toHaveLength(1);
  await authenticate(page, credentials.admin);
  await expectStatus(await page.request.post(`/api/purchase-orders/${pending.id}/changes/${pending.pendingChangeId}/review`, { data: { expectedVersion: pending.version, action: "APPROVED", comment: "Approve the selected source PR allocation" } }), 200);
  const amended = await getOrder(page, summary!.id);
  expect(amended.items.find((item) => item.itemName === "New item assigned to second source PR")?.sourcePurchaseRequestId).toBe(b!.id);
  expect((await getRequest(page, a!.id)).items).toHaveLength(1);
  expect((await getRequest(page, b!.id)).items).toHaveLength(2);
});
