import { expect, test, type Page } from "@playwright/test";

import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail, SupplierDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

async function createSupplier(page: Page, name = uniqueValue("Combo-supplier"), suffix = "A") {
  const response = await page.request.post("/api/suppliers", { data: {
    name, taxId: `TAX-${suffix}`, address: `Registered address ${suffix}`, contactPerson: `Registered person ${suffix}`,
    paymentTerms: `Registered terms ${suffix}`, contacts: [{ channel: "LINE", value: `@registered-${suffix}` }],
  } });
  await expectStatus(response, 201);
  return await response.json() as SupplierDetail;
}

async function deactivateSupplier(page: Page, supplier: SupplierDetail) {
  await expectStatus(await page.request.patch(`/api/suppliers/${supplier.id}`, { data: {
    name: supplier.name, taxId: supplier.taxId ?? "", address: supplier.address ?? "", contactPerson: supplier.contactPerson ?? "",
    paymentTerms: supplier.paymentTerms ?? "", note: supplier.note ?? "", contacts: supplier.contacts,
    expectedVersion: supplier.version, isActive: false,
  } }), 200);
}

async function createApprovedRequest(page: Page, itemCount = 1) {
  await authenticate(page);
  const marker = uniqueValue("Combo-PR");
  const response = await page.request.post("/api/purchase-requests", {
    multipart: { payload: JSON.stringify({
      requestDate: "2026-10-21", department: "Operations", reason: `Approved supplier selection ${marker}`, urgency: "NORMAL", submit: true,
      items: Array.from({ length: itemCount }, (_, index) => ({
        itemName: `${marker} item ${index + 1}`, quantity: 2, unit: "ชิ้น", unitPrice: 5, amount: 10,
      })),
    }) },
  });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, {
    data: { action: "APPROVED", comment: "Approved for supplier combobox E2E" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, id);
}

async function openForm(page: Page, request: PurchaseRequestDetail) {
  await page.goto(`/purchase-requests/${request.id}/purchase-orders/new`);
  await expect(page.locator(`#po-supplier-${request.items[0]!.id}`)).toBeEnabled();
}

async function selectSupplier(page: Page, itemId: string, supplier: SupplierDetail, query = supplier.code) {
  const inputId = `po-supplier-${itemId}`;
  await page.locator(`#${inputId}`).fill(query);
  await page.locator(`#${inputId}-listbox`).getByRole("option").filter({ hasText: supplier.code }).click();
  await expect(page.locator(`#${inputId}-selection`)).toContainText(supplier.code);
}

async function submitOrders(page: Page, request: PurchaseRequestDetail) {
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith(`/purchase-requests/${request.id}/purchase-orders`) && candidate.request().method() === "POST",
  );
  await page.locator("#create-purchase-orders").click();
  await page.locator("#confirm-create-purchase-orders").click();
  const issued = await response;
  await expectStatus(issued, 201);
  return {
    orders: (await issued.json() as { purchaseOrders: PurchaseOrderSummary[] }).purchaseOrders,
    payload: issued.request().postDataJSON() as { orders: Array<Record<string, unknown>> },
  };
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

function isConversion(requestId: string, request: { url(): string; method(): string }) {
  const endpoint = `/purchase-requests/${requestId}/purchase-orders`;
  return request.method() === "POST" && [endpoint, `${endpoint}/preview`].some((path) => request.url().endsWith(path));
}

test("one editable supplier field searches by name and code and explicitly selects a registered supplier", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const marker = uniqueValue("Searchable-supplier");
  const first = await createSupplier(page, `${marker} Alpha`);
  const second = await createSupplier(page, `${marker} Beta`, "B");
  const request = await createApprovedRequest(page);
  await openForm(page, request);
  const inputId = `po-supplier-${request.items[0]!.id}`;
  const input = page.locator(`#${inputId}`);
  await expect(input).toHaveAttribute("role", "combobox");
  await expect(page.locator(`#po-registered-supplier-${request.items[0]!.id}`)).toHaveCount(0);
  await input.fill(marker.toUpperCase());
  const listbox = page.locator(`#${inputId}-listbox`);
  await expect(listbox.getByRole("option").filter({ hasText: first.code })).toBeVisible();
  await expect(listbox.getByRole("option").filter({ hasText: second.code })).toBeVisible();
  await input.fill(second.code.toLowerCase());
  await expect(listbox.getByRole("option").filter({ hasText: first.code })).toHaveCount(0);
  await listbox.getByRole("option").filter({ hasText: second.code }).click();
  await expect(input).toHaveValue(second.name);
  await expect(input).toHaveJSProperty("readOnly", false);
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(`#${inputId}-selection`)).toContainText(second.code);
  await expect(page.locator("#po-supplier-address-0")).toHaveValue(second.address!);
});

test("keyboard navigation selects a supplier while an IME Enter never selects or submits the form", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const marker = uniqueValue("ผู้ขายคีย์บอร์ด");
  const supplier = await createSupplier(page, `${marker} ภาษาไทย`);
  const request = await createApprovedRequest(page);
  await openForm(page, request);
  const inputId = `po-supplier-${request.items[0]!.id}`;
  const input = page.locator(`#${inputId}`);
  let submitted = 0;
  page.on("request", (candidate) => { if (isConversion(request.id, candidate)) submitted += 1; });
  await input.fill(marker);
  await input.dispatchEvent("compositionstart", { data: "ผู้ขาย" });
  const compositionCanCommit = await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", isComposing: true, bubbles: true, cancelable: true,
  })));
  expect(compositionCanCommit).toBe(true);
  await expect(page.locator(`#${inputId}-selection`)).toHaveCount(0);
  expect(submitted).toBe(0);
  await input.dispatchEvent("compositionend", { data: "ผู้ขาย" });
  const safariEnterCanSubmit = await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", keyCode: 229, isComposing: false, bubbles: true, cancelable: true,
  })));
  expect(safariEnterCanSubmit).toBe(false);
  await expect(page.locator(`#${inputId}-selection`)).toHaveCount(0);
  expect(submitted).toBe(0);
  await input.press("ArrowDown");
  await input.press("End");
  await expect(page.locator(`#${inputId}-manual`)).toHaveAttribute("aria-selected", "true");
  await input.press("Home");
  await expect(page.locator(`#${inputId}-listbox`).getByRole("option").filter({ hasText: supplier.code })).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");
  await expect(page.locator(`#${inputId}-selection`)).toContainText(supplier.code);
  await expect(input).toHaveValue(supplier.name);
  expect(submitted).toBe(0);
});

test("new typed supplier names group by normalized spelling and create manual POs without a registry entry", async ({ page }) => {
  const request = await createApprovedRequest(page, 2);
  await openForm(page, request);
  const name = uniqueValue("Typed-new-supplier");
  const fullWidth = name.toLowerCase().replace(/[!-~]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 0xfee0));
  for (const [index, value] of [`  ${name}  `, fullWidth].entries()) {
    const inputId = `po-supplier-${request.items[index]!.id}`;
    await page.locator(`#${inputId}`).fill(value);
    await page.locator(`#${inputId}-manual`).click();
    await expect(page.locator(`#${inputId}-selection`)).toHaveCount(0);
  }
  const { orders, payload } = await submitOrders(page, request);
  expect(orders).toHaveLength(1);
  expect(payload.orders).toEqual([{ supplierName: name, deliveryRecipientId: request.requester.id, itemIds: request.items.map((item) => item.id), taxMode: "UNSPECIFIED", vatRate: 7 }]);
  const document = await getOrder(page, orders[0]!.id);
  expect(document.supplierId).toBeNull();
  expect(document.supplierName).toBe(name);
  const registry = await page.request.get("/api/suppliers", { params: { query: name } });
  await expectStatus(registry, 200);
  expect((await registry.json() as { items: SupplierDetail[] }).items).toEqual([]);
});

test("editing a registered choice clears its identity and headers even when the final text exactly matches its name", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page);
  const request = await createApprovedRequest(page);
  await openForm(page, request);
  const inputId = `po-supplier-${request.items[0]!.id}`;
  await selectSupplier(page, request.items[0]!.id, supplier);
  await expect(page.locator("#po-supplier-address-0")).toHaveValue(supplier.address!);
  await page.locator(`#${inputId}`).fill("A different typed supplier");
  await expect(page.locator(`#${inputId}-selection`)).toHaveCount(0);
  for (const field of ["po-supplier-address-0", "po-supplier-contact-0", "po-payment-terms-0"]) {
    await expect(page.locator(`#${field}`)).toHaveValue("");
    await expect(page.locator(`#${field}`)).toHaveJSProperty("readOnly", false);
  }
  await page.locator(`#${inputId}`).fill(supplier.name);
  await page.locator(`#${inputId}`).press("Escape");
  await page.locator("#po-supplier-address-0").fill("Manually supplied address");
  const { orders, payload } = await submitOrders(page, request);
  expect(payload.orders).toEqual([{
    supplierName: supplier.name, deliveryRecipientId: request.requester.id, itemIds: [request.items[0]!.id], supplierAddress: "Manually supplied address",
    taxMode: "UNSPECIFIED", vatRate: 7,
  }]);
  const document = await getOrder(page, orders[0]!.id);
  expect(document).toMatchObject({ supplierId: null, supplierAddress: "Manually supplied address", supplierContacts: [], paymentTerms: null });
});

test("suppliers with identical names remain separate identities and PO groups through their supplier codes", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const name = uniqueValue("Same-named-supplier");
  const first = await createSupplier(page, name, "first");
  const second = await createSupplier(page, name, "second");
  const request = await createApprovedRequest(page, 2);
  await openForm(page, request);
  for (const [index, supplier] of [first, second].entries()) {
    await selectSupplier(page, request.items[index]!.id, supplier, name);
  }
  const { orders, payload } = await submitOrders(page, request);
  expect(orders).toHaveLength(2);
  expect(payload.orders.map((order) => order.supplierId).sort()).toEqual([first.id, second.id].sort());
  const documents = await Promise.all(orders.map((order) => getOrder(page, order.id)));
  for (const supplier of [first, second]) {
    const document = documents.find((order) => order.supplierId === supplier.id)!;
    expect(document).toMatchObject({ supplierCode: supplier.code, supplierName: name, supplierAddress: supplier.address, supplierContacts: supplier.contacts });
  }
});

test.describe("touch supplier selection", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

  test("inactive and unmatched results permit manual entry, clearing and outside taps on mobile", async ({ page }, testInfo) => {
    await authenticate(page, credentials.purchasing);
    const active = await createSupplier(page);
    const inactive = await createSupplier(page, uniqueValue("Inactive-combo-supplier"), "inactive");
    await deactivateSupplier(page, inactive);
    const request = await createApprovedRequest(page);
    await openForm(page, request);
    const inputId = `po-supplier-${request.items[0]!.id}`;
    const input = page.locator(`#${inputId}`);
    await input.fill(inactive.name);
    await expect(page.locator(`#${inputId}-listbox`)).toContainText(/ไม่พบผู้ขายในทะเบียน|no registered suppliers found/i);
    await expect(page.locator(`#${inputId}-listbox`).getByRole("option").filter({ hasText: inactive.code })).toHaveCount(0);
    await expect(page.locator(`#${inputId}-manual`)).toBeVisible();
    await page.getByRole("heading", { level: 1 }).tap();
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(input).toHaveValue(inactive.name);
    await input.fill(active.code);
    await page.locator(`#${inputId}-listbox`).getByRole("option").filter({ hasText: active.code }).tap();
    await expect(page.locator(`#${inputId}-selection`)).toContainText(active.code);
    await page.locator(`#${inputId}-clear`).tap();
    await expect(input).toHaveValue("");
    await expect(page.locator(`#${inputId}-selection`)).toHaveCount(0);
    await input.fill(active.code);
    await expect(page.locator(`#${inputId}-listbox`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("supplier-combobox.png"), fullPage: true });
    await input.press("Tab");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(`#${inputId}-selection`)).toHaveCount(0);
  });
});

test("refreshing after a selected supplier is deactivated blocks issuance instead of silently converting it to manual text", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page);
  const request = await createApprovedRequest(page);
  await openForm(page, request);
  const inputId = `po-supplier-${request.items[0]!.id}`;
  await selectSupplier(page, request.items[0]!.id, supplier);
  await deactivateSupplier(page, supplier);
  await page.locator("#refresh-po-suppliers").click();
  await expect(page.locator("#refresh-po-suppliers")).toBeEnabled();
  await expect(page.locator("#refresh-po-suppliers")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator(`#${inputId}-selection`)).toContainText(/ไม่พร้อมใช้งาน|unavailable/i);
  let submitted = 0;
  page.on("request", (candidate) => { if (isConversion(request.id, candidate)) submitted += 1; });
  await page.locator("#create-purchase-orders").click();
  await expect(page.locator("form").getByRole("alert")).toContainText(/ไม่พร้อมใช้งาน|unavailable/i);
  expect(submitted).toBe(0);
  const current = await getRequest(page, request.id);
  expect(current.status).toBe("APPROVED");
  expect(current.purchaseOrders).toEqual([]);
  await page.locator(`#${inputId}`).fill("A deliberately new manual supplier");
  await expect(page.locator(`#${inputId}-selection`)).toHaveCount(0);
});
