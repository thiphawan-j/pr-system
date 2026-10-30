import { expect, test, type APIResponse, type Page } from "@playwright/test";

import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest, receive } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

type PreparedItem = {
  clientId: string;
  sourceItemId?: string;
  itemName: string;
  description?: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
};

type Preparation = {
  expectedUpdatedAt?: string;
  items: PreparedItem[];
  orders: Array<{ supplierName: string; itemIds: string[] }>;
};

async function createRequest(page: Page, approved = true) {
  await authenticate(page);
  const marker = uniqueValue("Prepare-PO");
  const response = await page.request.post("/api/purchase-requests", {
    multipart: { payload: JSON.stringify({
      requestDate: "2026-10-21", department: "Operations", reason: `Prepare supplier orders for ${marker}`,
      urgency: "NORMAL", submit: true,
      items: [
        { itemName: `${marker} bolts`, description: "Stainless bolts", supplierName: "Original supplier A", quantity: 2, unit: "กล่อง", unitPrice: 10.25, amount: 20.5 },
        { itemName: `${marker} pump`, description: "Replacement pump", supplierName: "Original supplier B", quantity: 3, unit: "เครื่อง", unitPrice: 99.99, amount: 299.97 },
        { itemName: `${marker} seals`, description: "Pump seals", supplierName: "Original supplier A", quantity: 4, unit: "ชิ้น", unitPrice: 55.1, amount: 220.4 },
      ],
    }) },
  });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  if (approved) {
    await authenticate(page, credentials.approver);
    await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, {
      data: { action: "APPROVED", comment: "Approve the source before preparing its first PO" },
    }), 200);
  }
  await authenticate(page, credentials.purchasing);
  return getRequest(page, id);
}

function preparation(request: PurchaseRequestDetail): Preparation {
  const items = request.items.map((item) => ({
    clientId: item.id, sourceItemId: item.id, itemName: item.itemName,
    description: item.description ?? undefined, quantity: item.quantity,
    unit: item.unit ?? undefined, unitPrice: item.unitPrice ?? 0,
  }));
  return {
    expectedUpdatedAt: request.orderPreparationVersion,
    items,
    orders: [{ supplierName: "Prepared supplier", itemIds: items.map((item) => item.clientId) }],
  };
}

function convert(page: Page, request: PurchaseRequestDetail, data: unknown) {
  return page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, { data });
}

async function issued(response: Pick<APIResponse, "status" | "text" | "json">) {
  await expectStatus(response, 201);
  return (await response.json() as { purchaseOrders: PurchaseOrderSummary[] }).purchaseOrders;
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function rejectWithoutChanges(page: Page, request: PurchaseRequestDetail, data: unknown, status = 400) {
  await expectStatus(await convert(page, request, data), status);
  expect(await getRequest(page, request.id)).toEqual(request);
}

test("Purchasing synchronizes prepared items to PR and PO with Timeline history and receives against PO balances", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const original = await createRequest(page);
  const [first, removed, retained] = original.items;
  await page.goto(`/purchase-requests/${original.id}/purchase-orders/new`);
  await expect(page.locator(`#po-item-name-${first!.id}`)).toBeEnabled();
  const changedName = uniqueValue("Revised bolts");
  await page.locator(`#po-item-name-${first!.id}`).fill(changedName);
  await page.locator(`#po-item-quantity-${first!.id}`).fill("5");
  await page.locator(`#po-item-unit-price-${first!.id}`).fill("12.34");
  await page.locator(`#remove-po-item-${removed!.id}`).click();
  await expect(page.locator(`#po-item-name-${removed!.id}`)).toHaveCount(0);
  await page.locator("#add-po-item").click();
  const names = page.locator('input[id^="po-item-name-"]');
  await expect(names).toHaveCount(3);
  const newInputId = (await names.evaluateAll((elements) => elements.map((element) => element.id)))
    .find((id) => ![first!.id, retained!.id].some((sourceId) => id === `po-item-name-${sourceId}`))!;
  const clientId = newInputId.slice("po-item-name-".length);
  const addedName = uniqueValue("Complimentary sample");
  await page.locator(`#${newInputId}`).fill(addedName);
  await page.locator(`#po-item-quantity-${clientId}`).fill("2");
  await page.locator(`#po-item-unit-price-${clientId}`).fill("0");
  const supplierName = uniqueValue("Combined prepared supplier");
  for (const itemId of [first!.id, retained!.id, clientId]) {
    const input = page.locator(`#po-supplier-${itemId}`);
    await input.fill(supplierName);
    await input.press("Escape");
  }
  expect(await getRequest(page, original.id)).toEqual(original);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("purchase-order-preparation-desktop.png"), fullPage: true });
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 844 });
  await expect.poll(() => page.evaluate(() => window.document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("purchase-order-preparation-mobile.png"), fullPage: true });
  if (viewport) await page.setViewportSize(viewport);
  const conversion = page.waitForResponse((response) => response.url().endsWith(`/purchase-requests/${original.id}/purchase-orders`)
    && response.request().method() === "POST");
  await page.locator("#create-purchase-orders").click();
  await page.locator("#confirm-create-purchase-orders").click();
  const response = await conversion;
  const orders = await issued(response);
  const submitted = response.request().postDataJSON() as Preparation;
  expect(submitted.expectedUpdatedAt).toBe(original.orderPreparationVersion);
  expect(submitted.items).toHaveLength(3);
  expect(submitted.orders).toEqual([{ supplierName, itemIds: [first!.id, retained!.id, clientId], deliveryRecipientId: original.requester.id, taxMode: "UNSPECIFIED", vatRate: 7 }]);
  expect(orders).toHaveLength(1);
  await expect(page).toHaveURL(new RegExp(`/purchase-requests/${original.id}$`));
  const ordered = await getRequest(page, original.id);
  expect(ordered.status).toBe("ORDERED");
  expect(ordered.totalAmount).toBe(282.1);
  expect(ordered.items).toHaveLength(3);
  expect(ordered.items.find((item) => item.id === first!.id)).toMatchObject({ itemName: changedName, quantity: 5, unitPrice: 12.34, amount: 61.7, receivedQuantity: 0, closedQuantity: 0 });
  expect(ordered.items.some((item) => item.id === removed!.id)).toBe(false);
  const addedSource = ordered.items.find((item) => item.itemName === addedName)!;
  expect(addedSource.id).not.toBe(clientId);
  expect(addedSource).toMatchObject({ quantity: 2, unitPrice: 0, amount: 0, receivedQuantity: 0, closedQuantity: 0 });
  expect(ordered.items.every((item) => item.supplierName === supplierName)).toBe(true);
  const audit = ordered.approvals.filter((approval) => approval.stepLabel === "ปรับรายการก่อนออก PO");
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ action: "COMMENTED" });
  for (const value of [orders[0]!.poNumber, first!.itemName, changedName, removed!.itemName, addedName, "540.87", "282.10"]) {
    expect(audit[0]!.comment).toContain(value);
  }
  expect(ordered.approvals.filter((approval) => approval.action === "ORDERED")).toHaveLength(1);
  const document = await getOrder(page, orders[0]!.id);
  expect(document).toMatchObject({ totalAmount: 282.1, itemCount: 3, supplierName });
  expect(document.items.find((item) => item.purchaseRequestItemId === first!.id)).toMatchObject({ itemName: changedName, quantity: 5, unitPrice: 12.34, amount: 61.7 });
  expect(document.items.some((item) => item.purchaseRequestItemId === removed!.id)).toBe(false);
  expect(document.items.find((item) => item.purchaseRequestItemId === retained!.id)).toMatchObject({ itemName: retained!.itemName, quantity: retained!.quantity, amount: retained!.amount });
  const added = document.items.find((item) => item.itemName === addedName)!;
  expect(added.id).not.toBe(clientId);
  expect(added).toMatchObject({ purchaseRequestItemId: addedSource.id, quantity: 2, unitPrice: 0, amount: 0, receivedQuantity: 0, closedQuantity: 0 });
  expect(document.items.map((item) => item.purchaseRequestItemId).sort()).toEqual(ordered.items.map((item) => item.id).sort());
  expect(ordered.receivingItems.find((item) => item.id === addedSource.id)).toMatchObject({ itemName: addedName, quantity: 2, remainingQuantity: 2 });
  await expect(page.locator("main")).toContainText(orders[0]!.poNumber);
  await expect(page.locator("main")).toContainText(changedName);
  await expect(page.locator("main")).toContainText(removed!.itemName);
  await authenticate(page);
  await expectStatus(await receive(page, ordered, [{ itemId: addedSource.id, quantity: 1 }]), 200);
  const received = await getRequest(page, original.id);
  expect(received.items).toEqual(ordered.items);
  expect(received.totalAmount).toBe(ordered.totalAmount);
  expect(received.receivingItems.find((item) => item.id === addedSource.id)).toMatchObject({ receivedQuantity: 1, remainingQuantity: 1 });
  expect(received.receipts[0]!.items).toContainEqual({ itemId: addedSource.id, itemName: addedName, quantity: 1 });
  await authenticate(page, credentials.purchasing);
  expect((await getOrder(page, document.id)).items.find((item) => item.id === added.id))
    .toMatchObject({ receivedQuantity: 1, quantity: 2, unitPrice: 0, amount: 0 });
});

test("Admin can replace all source lines and exact decimal totals persist in both PR and PO", async ({ page }) => {
  const original = await createRequest(page);
  await authenticate(page, credentials.admin);
  const data = preparation(original);
  data.items = [
    { clientId: "replacement-line", itemName: "  Replacement kit  ", description: "  New supplier specification  ", quantity: 3, unit: "  ชุด  ", unitPrice: 0.1 },
    { clientId: "free-line", itemName: "Included accessory", quantity: 1, unitPrice: 0 },
  ];
  data.orders[0]!.itemIds = data.items.map((item) => item.clientId);
  const orders = await issued(await convert(page, original, data));
  expect(orders).toHaveLength(1);
  const current = await getRequest(page, original.id);
  expect(current.totalAmount).toBe(0.3);
  expect(current.items).toHaveLength(2);
  expect(current.items.some((item) => original.items.some((source) => source.id === item.id))).toBe(false);
  expect(current.items.find((item) => item.itemName === "Replacement kit")).toMatchObject({ description: "New supplier specification", unit: "ชุด", quantity: 3, unitPrice: 0.1, amount: 0.3 });
  const document = await getOrder(page, orders[0]!.id);
  expect(document.totalAmount).toBe(0.3);
  expect(document.items).toHaveLength(2);
  expect(document.items.map((item) => item.purchaseRequestItemId).sort()).toEqual(current.items.map((item) => item.id).sort());
  expect(document.items.find((item) => item.itemName === "Replacement kit")).toMatchObject({ description: "New supplier specification", unit: "ชุด", quantity: 3, unitPrice: 0.1, amount: 0.3 });
  expect(current.receivingItems.map((item) => item.id).sort()).toEqual(current.items.map((item) => item.id).sort());
  expect(current.approvals.filter((approval) => approval.stepLabel === "ปรับรายการก่อนออก PO")).toHaveLength(1);
});

test("foreign source lines and duplicate identities reject atomically while unselected prepared rows remain pending", async ({ page }) => {
  const request = await createRequest(page);
  const other = await createRequest(page);
  const base = preparation(request);
  const invalid: unknown[] = [
    { ...base, items: base.items.map((item, index) => index === 0 ? { ...item, sourceItemId: other.items[0]!.id } : item) },
    { ...base, items: base.items.map((item, index) => index === 1 ? { ...item, sourceItemId: base.items[0]!.sourceItemId } : item) },
    { ...base, items: base.items.map((item, index) => index === 1 ? { ...item, clientId: base.items[0]!.clientId } : item) },
    { ...base, orders: [{ supplierName: "Unknown allocation", itemIds: [...base.orders[0]!.itemIds.slice(0, 2), "not-in-prepared-lines"] }] },
    { ...base, orders: [{ supplierName: "Repeated allocation", itemIds: [...base.orders[0]!.itemIds, base.items[0]!.clientId] }] },
    { ...base, items: [], orders: [] },
    { ...base, expectedUpdatedAt: undefined },
    { ...base, items: base.items.map((item, index) => index === 0 ? { ...item, quantity: 8 } : item), orders: [
      { supplierName: "Would create first", itemIds: [base.items[0]!.clientId] },
      { supplierId: "nonexistent-supplier", itemIds: base.items.slice(1).map((item) => item.clientId) },
    ] },
  ];
  for (const payload of invalid) await rejectWithoutChanges(page, request, payload);
  expect(await getRequest(page, other.id)).toEqual(other);
  const itemIds = base.orders[0]!.itemIds.slice(0, 2);
  const [partial] = await issued(await convert(page, request, {
    ...base, orders: [{ supplierName: "Selected prepared supplier", itemIds }],
  }));
  const after = await getRequest(page, request.id);
  expect(after.items).toHaveLength(request.items.length);
  expect(after.totalAmount).toBe(request.totalAmount);
  expect(after.orderableItemCount).toBe(1);
  expect(after.items.filter((item) => item.canOrder).map((item) => item.id)).toEqual([base.items[2]!.sourceItemId]);
  expect((await getOrder(page, partial!.id)).items.map((item) => item.purchaseRequestItemId).sort()).toEqual([...itemIds].sort());
});

test("invalid quantities, prices, injected totals and line or PO overflow leave the approved snapshot untouched", async ({ page }) => {
  const request = await createRequest(page);
  const base = preparation(request);
  for (const change of [
    { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: 2147483648 },
    { unitPrice: -0.01 }, { unitPrice: 0.001 }, { unitPrice: 10000000000 },
    { quantity: 2, unitPrice: 6000000000 }, { itemName: "   " }, { amount: 0 },
  ]) {
    await rejectWithoutChanges(page, request, { ...base, items: base.items.map((item, index) => index === 0 ? { ...item, ...change } : item) });
  }
  await rejectWithoutChanges(page, request, {
    ...base, items: base.items.map((item, index) => ({ ...item, quantity: 1, unitPrice: index < 2 ? 6000000000 : 0 })),
  });
  await rejectWithoutChanges(page, request, { ...base, totalAmount: 0 });
});

test("only Purchasing or Admin may prepare an approved and unissued PR", async ({ page }) => {
  test.setTimeout(60_000);
  const approved = await createRequest(page);
  const payload = preparation(approved);
  for (const account of [credentials.employee, credentials.approver, credentials.management]) {
    await authenticate(page, account);
    await expectStatus(await convert(page, approved, payload), 403);
    await page.goto(`/purchase-requests/${approved.id}/purchase-orders/new`);
    await expect(page).toHaveURL(new RegExp(`/purchase-requests/${approved.id}$`));
    await expect(page.locator("#add-po-item")).toHaveCount(0);
  }
  await page.context().clearCookies();
  await expectStatus(await convert(page, approved, payload), 401);
  await authenticate(page, credentials.purchasing);
  expect(await getRequest(page, approved.id)).toEqual(approved);
  const pending = await createRequest(page, false);
  await rejectWithoutChanges(page, pending, preparation(pending));
  await expectStatus(await page.request.post(`/api/purchase-requests/${approved.id}/status`, {
    data: { action: "REQUEST_REVISION", comment: "The source needs another approval before issuing" },
  }), 200);
  const returned = await getRequest(page, approved.id);
  expect(returned.status).toBe("NEED_REVISION");
  await rejectWithoutChanges(page, returned, preparation(returned));
});

test("stale preparation and concurrent edited conversions cannot overwrite a newer PR or issue twice", async ({ page }) => {
  const original = await createRequest(page);
  const stale = preparation(original);
  stale.items[0]!.quantity = 8;
  await expectStatus(await page.request.post(`/api/purchase-requests/${original.id}/comments`, {
    data: { comment: "New information arrived while the PO preparation form was open" },
  }), 200);
  const latest = await getRequest(page, original.id);
  expect(latest.orderPreparationVersion).not.toBe(original.orderPreparationVersion);
  await rejectWithoutChanges(page, latest, stale, 409);
  const data = preparation(latest);
  data.items[0]!.quantity = 8;
  const results = await Promise.all([convert(page, latest, data), convert(page, latest, data)]);
  expect(results.map((response) => response.status()).sort()).toEqual([201, 409]);
  const orders = await issued(results.find((response) => response.status() === 201)!);
  const current = await getRequest(page, latest.id);
  expect(current.items.find((item) => item.id === latest.items[0]!.id)).toMatchObject({ quantity: 8, amount: 82, receivedQuantity: 0, closedQuantity: 0 });
  expect(current.totalAmount).toBe(602.37);
  const document = await getOrder(page, orders[0]!.id);
  expect(document.totalAmount).toBe(602.37);
  expect(document.items.find((item) => item.purchaseRequestItemId === latest.items[0]!.id)).toMatchObject({ quantity: 8, amount: 82 });
  expect(current.purchaseOrders.map((order) => order.id)).toEqual(orders.map((order) => order.id));
  expect(current.approvals.filter((approval) => approval.stepLabel === "ปรับรายการก่อนออก PO")).toHaveLength(1);
  expect(current.approvals.filter((approval) => approval.action === "ORDERED")).toHaveLength(1);
  await rejectWithoutChanges(page, current, data, 409);
});

test("the form validates before posting and retains stale edits until an explicit reload", async ({ page }) => {
  test.setTimeout(60_000);
  const original = await createRequest(page);
  const first = original.items[0]!;
  await page.goto(`/purchase-requests/${original.id}/purchase-orders/new`);
  const name = page.locator(`#po-item-name-${first.id}`);
  const quantity = page.locator(`#po-item-quantity-${first.id}`);
  const price = page.locator(`#po-item-unit-price-${first.id}`);
  const create = page.locator("#create-purchase-orders");
  await expect(name).toBeEnabled();
  let posted = 0;
  const isConversion = (request: { url(): string; method(): string }) => request.url()
    .endsWith(`/purchase-requests/${original.id}/purchase-orders`) && request.method() === "POST";
  const isPreview = (request: { url(): string; method(): string }) => request.url()
    .endsWith(`/purchase-requests/${original.id}/purchase-orders/preview`) && request.method() === "POST";
  page.on("request", (request) => { if (isConversion(request) || isPreview(request)) posted += 1; });
  await name.fill("   ");
  await create.click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  expect(posted).toBe(0);
  await name.fill(first.itemName);
  for (const value of ["", "0"]) {
    await quantity.fill(value);
    await create.click();
    await expect(quantity).toBeFocused();
    await expect(quantity).toHaveAttribute("aria-invalid", "true");
    expect(posted).toBe(0);
  }
  await quantity.fill("2");
  await price.fill("12.345");
  await create.click();
  await expect(price).toBeFocused();
  await expect(price).toHaveAttribute("aria-invalid", "true");
  expect(posted).toBe(0);
  const draftName = uniqueValue("Unsaved preparation draft");
  await name.fill(draftName);
  await quantity.fill("7");
  await price.fill("8.88");
  const comment = uniqueValue("Source updated while preparation was open");
  await expectStatus(await page.request.post(`/api/purchase-requests/${original.id}/comments`, {
    data: { comment },
  }), 200);
  const latest = await getRequest(page, original.id);
  expect(latest.orderPreparationVersion).not.toBe(original.orderPreparationVersion);
  const rejected = page.waitForResponse((response) => isPreview(response.request()));
  await create.click();
  await expectStatus(await rejected, 409);
  await expect(name).toHaveValue(draftName);
  await expect(quantity).toHaveValue("7");
  await expect(price).toHaveValue("8.88");
  await expect(create).toBeDisabled();
  const reload = page.locator("#reload-po-preparation");
  await expect(reload).toBeVisible();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  expect(await getRequest(page, original.id)).toEqual(latest);
  expect(posted).toBe(1);
  await Promise.all([page.waitForEvent("load"), reload.click()]);
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue(first.itemName);
  await expect(quantity).toHaveValue(String(first.quantity));
  await expect(price).toHaveValue(String(first.unitPrice));
  await expect(create).toBeEnabled();
  await expect(reload).toHaveCount(0);
  const fresh = page.waitForResponse((response) => isConversion(response.request()));
  await create.click();
  await page.locator("#confirm-create-purchase-orders").click();
  const response = await fresh;
  const orders = await issued(response);
  expect(response.request().postDataJSON()).toMatchObject({ expectedUpdatedAt: latest.orderPreparationVersion });
  expect(response.request().postDataJSON()).not.toHaveProperty("items");
  expect(orders).toHaveLength(2);
  const current = await getRequest(page, original.id);
  expect(current.status).toBe("ORDERED");
  expect(current.items).toEqual(original.items.map((item) => ({ ...item, canOrder: false })));
  expect(current.approvals.some((approval) => approval.comment === comment)).toBe(true);
  expect(current.approvals.filter((approval) => approval.stepLabel === "ปรับรายการก่อนออก PO")).toHaveLength(0);
  expect(posted).toBe(3);
});
