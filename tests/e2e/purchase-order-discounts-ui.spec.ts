import { expect, test, type Page } from "@playwright/test";

import type { PurchaseOrderDetail, PurchaseOrderSummary } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { createRequestViaApi, credentials, uniqueValue } from "./support";

async function approvedRequest(page: Page) {
  await authenticate(page);
  const request = await createRequestViaApi(page, { submit: true, itemName: "Discounted product before VAT" });
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/approval`, {
    data: { action: "APPROVED", comment: "Approved for discount browser checks" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, request.id);
}

async function orderById(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function simpleOrder(page: Page) {
  const request = await approvedRequest(page);
  const response = await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, {
    data: { orders: [{ supplierName: "Discount validation supplier", itemIds: request.items.map((item) => item.id) }] },
  });
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  return { request, order: await orderById(page, purchaseOrders[0]!.id) };
}

test("the browser creates mixed VAT discounts and approves revised per-item and whole-PO discounts", async ({ page }, testInfo) => {
  const request = await approvedRequest(page);
  const firstId = request.items[0]!.id;
  const supplier = uniqueValue("Discount supplier");
  await page.goto(`/purchase-requests/${request.id}/purchase-orders/new`);
  await page.locator(`#po-item-quantity-${firstId}`).fill("2");
  await page.locator(`#po-item-unit-price-${firstId}`).fill("50");
  await page.locator(`#po-supplier-${firstId}`).fill(supplier);
  await page.locator(`#po-item-discount-type-${firstId}`).selectOption("PERCENT");
  await page.locator(`#po-item-discount-value-${firstId}`).fill("10");
  await page.locator("#add-po-item").click();
  const secondId = await page.locator("[data-po-item]").nth(1).getAttribute("data-po-item");
  expect(secondId).toBeTruthy();
  await page.locator(`#po-item-name-${secondId}`).fill("Discounted product with VAT included");
  await page.locator(`#po-item-quantity-${secondId}`).fill("1");
  await page.locator(`#po-item-unit-price-${secondId}`).fill("107");
  await page.locator(`#po-supplier-${secondId}`).fill(supplier);
  await page.locator(`#po-item-tax-mode-${secondId}`).selectOption("INCLUSIVE");
  await page.locator("#po-group-0-tax-mode").selectOption("EXCLUSIVE");
  await page.locator("#po-group-0-discount-type").selectOption("PERCENT");
  await page.locator("#po-group-0-discount-value").fill("10");
  await expect(page.locator("#po-group-0-total-item-discount")).toContainText("10.00");
  await expect(page.locator("#po-group-0-total-order-discount")).toContainText("19.70");
  await expect(page.locator("#po-group-0-total-net")).toContainText("171.00");
  await expect(page.locator("#po-group-0-total-vat")).toContainText("11.97");
  await expect(page.locator("#po-preparation-total")).toContainText("182.97");
  const issuance = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/purchase-requests/${request.id}/purchase-orders`));
  await page.locator("#create-purchase-orders").click();
  const issuedResponse = await issuance;
  await expectStatus(issuedResponse, 201);
  const { purchaseOrders } = await issuedResponse.json() as { purchaseOrders: PurchaseOrderSummary[] };
  const order = await orderById(page, purchaseOrders[0]!.id);
  expect(order).toMatchObject({ discountType: "PERCENT", discountValue: 10, totalAmount: 182.97 });
  expect((await getRequest(page, request.id)).totalAmount).toBe(182.97);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/purchase-orders/${order.id}/edit`);
  await expect(page.locator("#po-edit-item-discount-type-0")).toHaveValue("PERCENT");
  await expect(page.locator("#po-edit-item-discount-value-0")).toHaveValue("10");
  await page.locator("#po-edit-item-discount-value-0").fill("20");
  await page.locator("#po-edit-discount-type").selectOption("AMOUNT");
  await page.locator("#po-edit-discount-value").fill("18.70");
  await expect(page.locator("#po-edit-total-item-discount")).toContainText("20.00");
  await expect(page.locator("#po-edit-total-order-discount")).toContainText("18.70");
  await expect(page.locator("#po-edit-total-net")).toContainText("162.00");
  await expect(page.locator("#po-edit-total-vat")).toContainText("11.34");
  await expect(page.locator("#po-edit-total")).toContainText("173.34");
  const reason = uniqueValue("Supplier confirms item and order discounts");
  await page.locator("#po-edit-reason").fill(reason);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("purchase-order-discount-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("purchase-order-discount-mobile.png"), fullPage: true });
  const submission = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/purchase-orders/${order.id}`));
  await page.locator("#save-po-changes").click();
  const pendingResponse = await submission;
  await expectStatus(pendingResponse, 200);
  const pending = await pendingResponse.json() as PurchaseOrderDetail;
  expect(pending.totalAmount).toBe(182.97);
  const change = pending.changes.find((entry) => entry.id === pending.pendingChangeId)!;
  expect(change.after).toMatchObject({ discountType: "AMOUNT", discountValue: 18.7, totalAmount: 173.34 });
  expect((await getRequest(page, request.id)).totalAmount).toBe(182.97);
  await authenticate(page, credentials.approver);
  const review = await page.request.post(`/api/purchase-orders/${order.id}/changes/${pending.pendingChangeId}/review`, {
    data: { expectedVersion: pending.version, action: "APPROVED", comment: "Discount quotation checked" },
  });
  await expectStatus(review, 200);
  expect(await orderById(page, order.id)).toMatchObject({ discountType: "AMOUNT", discountValue: 18.7, totalAmount: 173.34 });
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(173.34);
  expect(source.approvals.some((entry) => entry.stepLabel === "อนุมัติแก้ไข PO" && entry.comment?.includes(reason))).toBe(true);
});

test("discount validation focuses empty, excessive and over-100-percent inputs without submitting", async ({ page }) => {
  const { order } = await simpleOrder(page);
  await page.goto(`/purchase-orders/${order.id}/edit`);
  await page.locator("#po-edit-reason").fill("Validate proposed discounts before submitting");
  let proposals = 0;
  page.on("request", (request) => { if (request.method() === "PATCH" && request.url().endsWith(`/purchase-orders/${order.id}`)) proposals += 1; });
  await page.locator("#po-edit-item-discount-type-0").selectOption("AMOUNT");
  for (const value of ["", "2500.01", "-1", "1.001"]) {
    await page.locator("#po-edit-item-discount-value-0").fill(value);
    await page.locator("#save-po-changes").click();
    await expect(page.locator("#po-edit-item-discount-value-0")).toBeFocused();
    await expect(page.locator("#po-edit-item-discount-value-0")).toHaveAttribute("aria-invalid", "true");
    expect(proposals).toBe(0);
  }
  await page.locator("#po-edit-item-discount-type-0").selectOption("PERCENT");
  await page.locator("#po-edit-item-discount-value-0").fill("100.01");
  await page.locator("#save-po-changes").click();
  await expect(page.locator("#po-edit-item-discount-value-0")).toBeFocused();
  expect(proposals).toBe(0);
  await page.locator("#po-edit-item-discount-value-0").fill("100");
  await expect(page.locator("#po-edit-total")).toContainText("0.00");
  await page.locator("#po-edit-discount-type").selectOption("AMOUNT");
  await page.locator("#po-edit-discount-value").fill("0.01");
  await page.locator("#save-po-changes").click();
  await expect(page.locator("#po-edit-discount-value")).toBeFocused();
  await expect(page.locator("#po-edit-discount-value")).toHaveAttribute("aria-invalid", "true");
  expect(proposals).toBe(0);
  await page.locator("#po-edit-discount-type").selectOption("NONE");
  await expect(page.locator("#po-edit-discount-value")).toBeDisabled();
  await expect(page.locator("#po-edit-total")).toContainText("0.00");
  expect((await orderById(page, order.id)).pendingChangeId).toBeNull();
});

test("creation keeps fully discounted items and rejects an order discount above the remaining amount", async ({ page }) => {
  const request = await approvedRequest(page);
  const firstId = request.items[0]!.id;
  await page.goto(`/purchase-requests/${request.id}/purchase-orders/new`);
  const supplierInput = page.locator(`#po-supplier-${firstId}`);
  const supplier = await supplierInput.inputValue();
  await supplierInput.fill("");
  await page.locator(`#po-item-discount-type-${firstId}`).selectOption("PERCENT");
  await page.locator(`#po-item-discount-value-${firstId}`).fill("100.01");
  await expect(page.locator("#po-preparation-total")).toContainText("—");
  await page.locator(`#po-item-discount-value-${firstId}`).fill("100");
  await expect(page.locator("#po-preparation-total")).toContainText("0.00");
  await supplierInput.fill(supplier);
  await page.locator("#po-group-0-discount-type").selectOption("AMOUNT");
  await page.locator("#po-group-0-discount-value").fill("0.01");
  let issuances = 0;
  page.on("request", (sent) => { if (sent.method() === "POST" && sent.url().endsWith(`/purchase-requests/${request.id}/purchase-orders`)) issuances += 1; });
  await page.locator("#create-purchase-orders").click();
  await expect(page.locator("#po-group-0-discount-value")).toBeFocused();
  await expect(page.locator("#po-group-0-discount-value")).toHaveAttribute("aria-invalid", "true");
  expect(issuances).toBe(0);
  await page.locator("#po-group-0-discount-type").selectOption("NONE");
  await expect(page.locator("#po-preparation-total")).toContainText("0.00");
  const issuance = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/purchase-requests/${request.id}/purchase-orders`));
  await page.locator("#create-purchase-orders").click();
  const response = await issuance;
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  expect(purchaseOrders[0]!.totalAmount).toBe(0);
  const source = await getRequest(page, request.id);
  expect(source.items).toHaveLength(1);
  expect(source.items[0]!.quantity).toBe(2);
  expect(source.totalAmount).toBe(0);
});
