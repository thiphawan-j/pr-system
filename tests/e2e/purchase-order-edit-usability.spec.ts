import { expect, test, type Page } from "@playwright/test";

import type { PurchaseOrderDetail, PurchaseOrderSummary } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { createRequestViaApi, credentials, uniqueValue } from "./support";

async function createEditableOrder(page: Page) {
  await authenticate(page);
  const request = await createRequestViaApi(page, { submit: true, itemName: "Monitor with adjustable display stand", description: "Keep this specification when changing quantity or price" });
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/approval`, {
    data: { action: "APPROVED", comment: "Approved for PO editing usability checks" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  const approved = await getRequest(page, request.id);
  const issued = await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, {
    data: { orders: [{ supplierName: "Example supplier", supplierAddress: "Original supplier address", deliveryAddress: "Original delivery address", itemIds: approved.items.map((item) => item.id) }] },
  });
  await expectStatus(issued, 201);
  const { purchaseOrders } = await issued.json() as { purchaseOrders: PurchaseOrderSummary[] };
  const response = await page.request.get(`/api/purchase-orders/${purchaseOrders[0]!.id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

test("PO edit rows validate empty prices, focus additions and fit desktop and mobile screens", async ({ page }, testInfo) => {
  const order = await createEditableOrder(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/purchase-orders/${order.id}/edit`);
  await expect(page.locator("#po-edit-item-description-0")).toBeHidden();
  await expect(page.locator("#po-edit-supplier-address")).toBeHidden();
  await expect(page.locator("#po-edit-delivery-address")).toBeHidden();
  await expect(page.locator("#po-edit-remove-0")).toBeDisabled();

  let proposals = 0;
  page.on("request", (request) => { if (request.method() === "PATCH" && request.url().endsWith(`/api/purchase-orders/${order.id}`)) proposals += 1; });
  await page.locator("#po-edit-item-unit-price-0").fill("");
  await page.locator("#po-edit-reason").fill(uniqueValue("Revise quotation"));
  await page.locator("#save-po-changes").click();
  await expect(page.locator("#po-edit-item-unit-price-0")).toBeFocused();
  await expect(page.locator("#po-edit-item-unit-price-0")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#po-edit-total")).toHaveText("—");
  expect(proposals).toBe(0);
  await page.locator("#po-edit-item-unit-price-0").fill("1.25");
  await page.locator("#po-edit-item-quantity-0").fill("1.5");
  await page.locator("#save-po-changes").click();
  await expect(page.locator("#po-edit-item-quantity-0")).toBeFocused();
  expect(proposals).toBe(0);
  await page.locator("#po-edit-item-quantity-0").fill("3");
  await expect(page.locator("#po-edit-total")).toContainText("3.75");
  await page.locator("#po-edit-vat-rate").fill("");
  await page.locator("#save-po-changes").click();
  await expect(page.locator("#po-edit-vat-rate")).toBeFocused();
  await expect(page.locator("#po-edit-vat-rate")).toHaveAttribute("aria-invalid", "true");
  expect(proposals).toBe(0);
  await page.locator("#po-edit-vat-rate").fill("7");

  await page.locator("#po-edit-add-item").click();
  await expect(page.locator("#po-edit-item-name-1")).toBeFocused();
  await expect(page.locator("#po-edit-item-unit-price-1")).toHaveValue("");
  await page.locator("#po-edit-item-name-1").fill("Delivery accessory");
  await page.locator("#po-edit-item-quantity-1").fill("2");
  await page.locator("#po-edit-item-unit-price-1").fill("3.35");
  await expect(page.locator("#po-edit-total")).toContainText("10.45");
  await page.locator("#po-edit-tax-mode").selectOption("EXCLUSIVE");
  await page.locator("#po-edit-item-tax-mode-1").selectOption("INCLUSIVE");
  await expect(page.locator("#po-edit-total")).toContainText("10.71");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("purchase-order-edit-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("purchase-order-edit-mobile.png"), fullPage: true });
  await page.locator("#po-edit-remove-1").click();
  await expect(page.locator("#po-edit-item-name-1")).toHaveCount(0);
  await expect(page.locator("#po-edit-remove-0")).toBeDisabled();
  await expect(page.locator("#po-edit-total")).toContainText("4.01");
});

test("a conflicting PO edit preserves the draft and requires an explicit reload", async ({ page }) => {
  const order = await createEditableOrder(page);
  await page.goto(`/purchase-orders/${order.id}/edit`);
  const reason = uniqueValue("Keep my draft on conflict");
  await page.locator("#po-edit-item-quantity-0").fill("9");
  await page.locator("#po-edit-reason").fill(reason);
  await page.route(`**/api/purchase-orders/${order.id}`, async (route) => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    expect(route.request().postDataJSON().expectedVersion).toBe(order.version);
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Purchase order changed" }) });
  });
  await page.locator("#save-po-changes").click();
  await expect(page.locator("#reload-po-edit")).toBeVisible();
  await expect(page.locator("#save-po-changes")).toBeDisabled();
  await expect(page.locator("#po-edit-item-quantity-0")).toHaveValue("9");
  await expect(page.locator("#po-edit-reason")).toHaveValue(reason);
  await page.unroute(`**/api/purchase-orders/${order.id}`);
  await page.locator("#reload-po-edit").click();
  await expect(page.locator("#reload-po-edit")).toHaveCount(0);
  await expect(page.locator("#po-edit-item-quantity-0")).toHaveValue("2");
  await expect(page.locator("#po-edit-reason")).toHaveValue("");
  await expect(page.locator("#save-po-changes")).toBeEnabled();
});

test("validation opens collapsed supplier details and focuses a missing contact", async ({ page }) => {
  const order = await createEditableOrder(page);
  await page.goto(`/purchase-orders/${order.id}/edit`);
  const details = page.locator("details").filter({ has: page.locator("#po-edit-channel-PHONE") });
  await details.locator("summary").click();
  await page.locator("#po-edit-channel-PHONE").check();
  await details.locator("summary").click();
  await expect(page.locator("#po-edit-contact-PHONE")).toBeHidden();
  await page.locator("#po-edit-reason").fill("Update supplier contact details");
  await page.locator("#save-po-changes").click();
  await expect(page.locator("#po-edit-contact-PHONE")).toBeVisible();
  await expect(page.locator("#po-edit-contact-PHONE")).toBeFocused();
  await expect(page.locator("#po-edit-contact-PHONE")).toHaveAttribute("aria-invalid", "true");
  const response = await page.request.get(`/api/purchase-orders/${order.id}`);
  await expectStatus(response, 200);
  expect((await response.json() as PurchaseOrderDetail).pendingChangeId).toBeNull();
});

test("creating and amending a PO through VAT controls records mixed item taxes and approved totals", async ({ page }) => {
  await authenticate(page);
  const request = await createRequestViaApi(page, { submit: true, itemName: "Product priced before VAT" });
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/approval`, {
    data: { action: "APPROVED", comment: "Approved source for the full VAT browser workflow" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  const approved = await getRequest(page, request.id);
  const sourceItemId = approved.items[0]!.id;
  const supplierName = uniqueValue("Mixed VAT supplier");
  await page.goto(`/purchase-requests/${request.id}/purchase-orders/new`);
  await page.locator(`#po-item-quantity-${sourceItemId}`).fill("1");
  await page.locator(`#po-item-unit-price-${sourceItemId}`).fill("100");
  await page.locator(`#po-supplier-${sourceItemId}`).fill(supplierName);
  await page.locator("#add-po-item").click();
  const addedRow = page.locator("[data-po-item]").nth(1);
  await expect(addedRow).toBeVisible();
  const addedItemId = await addedRow.getAttribute("data-po-item");
  expect(addedItemId).toBeTruthy();
  await page.locator(`#po-item-name-${addedItemId}`).fill("Product with VAT included");
  await page.locator(`#po-item-quantity-${addedItemId}`).fill("1");
  await page.locator(`#po-item-unit-price-${addedItemId}`).fill("107");
  await page.locator(`#po-supplier-${addedItemId}`).fill(supplierName);
  await page.locator(`#po-item-tax-mode-${addedItemId}`).selectOption("INCLUSIVE");
  await page.locator("#po-group-0-tax-mode").selectOption("EXCLUSIVE");
  await page.locator("#po-group-0-vat-rate").fill("7");
  await expect(page.locator("#po-group-1-tax-mode")).toHaveCount(0);
  await expect(page.locator("#po-group-0-total-net")).toContainText("200.00");
  await expect(page.locator("#po-group-0-total-vat")).toContainText("14.00");
  await expect(page.locator("#po-preparation-total")).toContainText("214.00");
  const issuance = page.waitForResponse((response) => response.url().endsWith(`/api/purchase-requests/${request.id}/purchase-orders`) && response.request().method() === "POST");
  await page.locator("#create-purchase-orders").click();
  await page.locator("#confirm-create-purchase-orders").click();
  const issuedResponse = await issuance;
  await expectStatus(issuedResponse, 201);
  const { purchaseOrders } = await issuedResponse.json() as { purchaseOrders: PurchaseOrderSummary[] };
  expect(purchaseOrders).toHaveLength(1);
  const orderId = purchaseOrders[0]!.id;
  await expect(page).toHaveURL(new RegExp(`/purchase-requests/${request.id}$`));
  const issuedDetail = await page.request.get(`/api/purchase-orders/${orderId}`);
  await expectStatus(issuedDetail, 200);
  const issued = await issuedDetail.json() as PurchaseOrderDetail;
  expect(issued).toMatchObject({ taxMode: "EXCLUSIVE", vatRate: 7, subtotalAmount: 207, netAmount: 200, taxAmount: 14, totalAmount: 214 });
  expect(issued.items.find((item) => item.itemName === "Product priced before VAT")).toMatchObject({ taxMode: null, totalWithTax: 107 });
  expect(issued.items.find((item) => item.itemName === "Product with VAT included")).toMatchObject({ taxMode: "INCLUSIVE", totalWithTax: 107 });

  await page.goto(`/purchase-orders/${orderId}/edit`);
  await page.locator("#po-edit-tax-mode").selectOption("INCLUSIVE");
  await expect(page.locator("#po-edit-total")).toContainText("207.00");
  await expect(page.locator("#po-edit-total-vat")).toContainText("13.54");
  const reason = uniqueValue("Supplier confirms all entered prices include VAT");
  await page.locator("#po-edit-reason").fill(reason);
  const submission = page.waitForResponse((response) => response.url().endsWith(`/api/purchase-orders/${orderId}`) && response.request().method() === "PATCH");
  await page.locator("#save-po-changes").click();
  const pendingResponse = await submission;
  await expectStatus(pendingResponse, 200);
  const pending = await pendingResponse.json() as PurchaseOrderDetail;
  expect(pending).toMatchObject({ taxMode: "EXCLUSIVE", totalAmount: 214 });
  const change = pending.changes.find((entry) => entry.id === pending.pendingChangeId)!;
  expect(change).toMatchObject({ reason, status: "PENDING", before: { taxMode: "EXCLUSIVE", totalAmount: 214 }, after: { taxMode: "INCLUSIVE", totalAmount: 207 } });
  await expect(page).toHaveURL(new RegExp(`/purchase-orders/${orderId}$`));
  await authenticate(page, credentials.approver);
  const review = await page.request.post(`/api/purchase-orders/${orderId}/changes/${pending.pendingChangeId}/review`, {
    data: { expectedVersion: pending.version, action: "APPROVED", comment: "Confirmed VAT treatment against the supplier quotation" },
  });
  await expectStatus(review, 200);
  const updated = await review.json() as PurchaseOrderDetail;
  expect(updated).toMatchObject({ taxMode: "INCLUSIVE", vatRate: 7, netAmount: 193.46, taxAmount: 13.54, totalAmount: 207, pendingChangeId: null });
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(207);
  expect(source.receivingItems.reduce((sum, item) => sum + (item.totalWithTax ?? item.amount ?? 0), 0)).toBe(207);
  expect(source.approvals.some((entry) => entry.comment?.includes(reason))).toBe(true);
});
