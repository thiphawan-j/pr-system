import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { Client } from "pg";

import type { PurchaseOrderDocument, PurchaseOrderDocumentText } from "../../src/lib/purchase-order-document";
import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail, SupplierDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

test.setTimeout(90_000);

type Preview = {
  previewFingerprint: string;
  orders: Array<{ supplierName: string; itemCount: number; totalAmount: number; document: PurchaseOrderDocument }>;
};

type Item = { itemName: string; supplierName: string; quantity: number; unitPrice: number };

async function approvedSource(page: Page, suppliedItems?: Item[]) {
  await authenticate(page);
  const marker = uniqueValue("Preview-PR");
  const items = suppliedItems ?? [
    { itemName: `${marker} bolts`, supplierName: "Preview supplier A", quantity: 2, unitPrice: 50 },
    { itemName: `${marker} seals`, supplierName: "Preview supplier B", quantity: 1, unitPrice: 107 },
  ];
  const response = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify({
    requestDate: new Date().toISOString().slice(0, 10), department: "Operations", reason: `Review documents for ${marker}`,
    urgency: "NORMAL", submit: true,
    items: items.map((item) => ({ ...item, unit: "ชิ้น", amount: item.quantity * item.unitPrice })),
  }) } });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  await authenticate(page, credentials.admin);
  await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, {
    data: { action: "APPROVED", comment: "Approve source before reviewing the proposed PO documents" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, id);
}

const createPath = (id: string) => `/api/purchase-requests/${id}/purchase-orders`;
const previewPath = (id: string) => `${createPath(id)}/preview`;

function singlePayload(source: PurchaseRequestDetail) {
  return {
    expectedUpdatedAt: source.orderPreparationVersion ?? source.updatedAt,
    orders: [{ supplierName: "Preview supplier", itemIds: source.items.map((item) => item.id), deliveryRecipientId: source.requester.id }],
  };
}

async function preview(response: Pick<APIResponse, "status" | "text" | "json">): Promise<Preview> {
  await expectStatus(response, 200);
  const result = await response.json() as Preview;
  expect(result.previewFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(result.orders.length).toBeGreaterThan(0);
  return result;
}

function documentText(document: PurchaseOrderDocument) {
  return document.pages.flatMap((page) => page.elements.filter((element): element is PurchaseOrderDocumentText => element.type === "text"))
    .map((element) => element.text).join("\n");
}

async function databaseState(sourceIds: string[]) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Preview SQL checks require an explicit isolated E2E database");
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !decodeURIComponent(url.pathname.slice(1)).endsWith("_e2e")) {
    throw new Error("Refusing SQL outside a loopback database whose name ends in _e2e");
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`SELECT jsonb_build_object(
      'orders', (SELECT count(*) FROM "PurchaseOrder"),
      'sequences', (SELECT coalesce(jsonb_agg(to_jsonb(sequence) ORDER BY "key"), '[]'::jsonb) FROM "PurchaseOrderNumberSequence" sequence),
      'approvals', (SELECT count(*) FROM "Approval"),
      'notifications', (SELECT count(*) FROM "Notification"),
      'requests', (SELECT jsonb_agg(to_jsonb(source) ORDER BY "id") FROM "PurchaseRequest" source WHERE "id" = ANY($1::text[])),
      'items', (SELECT jsonb_agg(to_jsonb(item) ORDER BY "id") FROM "PurchaseRequestItem" item WHERE "purchaseRequestId" = ANY($1::text[]))
    ) AS state`, [sourceIds]);
    return result.rows[0].state;
  } finally { await client.end(); }
}

async function orderById(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

test("server preview resolves every supplier document and VAT/discount/recipient without changing PRs or reserving PO numbers", async ({ page }) => {
  const source = await approvedSource(page);
  const [a, b] = source.items;
  const payload = {
    expectedUpdatedAt: source.orderPreparationVersion ?? source.updatedAt,
    items: source.items.map((item, index) => ({
      clientId: item.id, sourceItemId: item.id, itemName: item.itemName, quantity: item.quantity,
      unit: item.unit ?? undefined, unitPrice: item.unitPrice ?? 0,
      discountType: index === 0 ? "PERCENT" : "NONE", discountValue: index === 0 ? 10 : 0,
    })),
    orders: [
      { supplierName: "Preview supplier A", itemIds: [a!.id], taxMode: "EXCLUSIVE", vatRate: 7, discountType: "AMOUNT", discountValue: 10, deliveryRecipientId: source.requester.id },
      { supplierName: "Preview supplier B", itemIds: [b!.id], taxMode: "INCLUSIVE", vatRate: 7, discountType: "PERCENT", discountValue: 10, deliveryRecipientId: source.requester.id },
    ],
  };
  const before = await databaseState([source.id]);
  const first = await preview(await page.request.post(previewPath(source.id), { data: payload }));
  const repeated = await preview(await page.request.post(previewPath(source.id), { data: payload }));
  expect(repeated.previewFingerprint).toBe(first.previewFingerprint);
  expect(first.orders.map((order) => ({ supplierName: order.supplierName, itemCount: order.itemCount, totalAmount: order.totalAmount }))).toEqual([
    { supplierName: "Preview supplier A", itemCount: 1, totalAmount: 85.6 },
    { supplierName: "Preview supplier B", itemCount: 1, totalAmount: 96.3 },
  ]);
  for (const order of first.orders) {
    const text = documentText(order.document);
    expect(text).toContain(order.supplierName);
    expect(text).toContain(source.requester.name);
    expect(text).toContain(order.totalAmount.toFixed(2));
    expect(order.document.poNumber).not.toMatch(/^PO-\d/);
  }
  expect(documentText(first.orders[0]!.document)).toContain("5.60");
  expect(documentText(first.orders[1]!.document)).toContain("6.30");
  expect(await databaseState([source.id])).toEqual(before);
});

test("the preview step preserves draft values on return and creates exactly once only after explicit confirmation", async ({ page }, testInfo) => {
  const source = await approvedSource(page);
  const first = source.items[0]!;
  await page.goto(`/purchase-requests/${source.id}/purchase-orders/new`);
  const name = uniqueValue("Reviewed item");
  await page.locator(`#po-item-name-${first.id}`).fill(name);
  await page.locator(`#po-item-quantity-${first.id}`).fill("3");
  await page.locator("#po-group-0-tax-mode").selectOption("EXCLUSIVE");
  await page.locator("#po-group-0-discount-type").selectOption("PERCENT");
  await page.locator("#po-group-0-discount-value").fill("10");
  let creates = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === createPath(source.id) && request.method() === "POST") creates++; });
  const before = await databaseState([source.id]);
  await page.locator("#create-purchase-orders").click();
  await expect(page.locator("#po-creation-preview")).toBeVisible();
  await expect(page.locator(".purchase-order-document")).toHaveCount(2);
  await expect(page.locator("#po-preview-order-0")).toContainText(name);
  expect(creates).toBe(0);
  expect(await databaseState([source.id])).toEqual(before);
  await page.locator("#back-to-po-preparation").click();
  await expect(page.locator(`#po-item-name-${first.id}`)).toHaveValue(name);
  await expect(page.locator(`#po-item-quantity-${first.id}`)).toHaveValue("3");
  await expect(page.locator("#po-group-0-discount-value")).toHaveValue("10");
  await expect(page.locator("#po-delivery-recipient-0")).toHaveValue(source.requester.id);
  await page.locator(`#po-item-quantity-${first.id}`).fill("4");
  const preparing = page.waitForResponse((response) => new URL(response.url()).pathname === previewPath(source.id));
  await page.locator("#create-purchase-orders").click();
  const previewResponse = await preparing;
  const current = await preview(previewResponse);
  await expect(page.locator("#po-creation-preview")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath("po-before-confirm-mobile.png"), fullPage: true });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**${createPath(source.id)}`, async (route) => { await held; await route.continue(); });
  const confirmation = page.waitForResponse((response) => new URL(response.url()).pathname === createPath(source.id) && response.request().method() === "POST");
  try {
    await page.locator("#confirm-create-purchase-orders").evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(page.locator("#confirm-create-purchase-orders")).toBeDisabled();
    await expect(page.locator("#confirm-create-purchase-orders")).toHaveAttribute("aria-busy", "true");
  } finally { release(); }
  const confirmed = await confirmation;
  await expectStatus(confirmed, 201);
  expect(confirmed.request().postDataJSON()).toEqual({ ...previewResponse.request().postDataJSON(), previewFingerprint: current.previewFingerprint });
  expect(creates).toBe(1);
  const orders = (await confirmed.json() as { purchaseOrders: PurchaseOrderSummary[] }).purchaseOrders;
  expect(orders.map((order) => order.totalAmount)).toEqual(current.orders.map((order) => order.totalAmount));
  const issued = await orderById(page, orders[0]!.id);
  expect(issued.items[0]).toMatchObject({ itemName: name, quantity: 4 });
  await expect(page).toHaveURL(new RegExp(`/purchase-requests/${source.id}$`));
});

test("preview enforces permissions, invalid input and stale source versions without writing business data", async ({ page, request }) => {
  const source = await approvedSource(page);
  const payload = singlePayload(source);
  const before = await databaseState([source.id]);
  await expectStatus(await request.post(previewPath(source.id), { data: payload }), 401);
  await authenticate(page, credentials.employee);
  await expectStatus(await page.request.post(previewPath(source.id), { data: payload }), 403);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await page.request.post(previewPath(source.id), { data: { ...payload, orders: [] } }), 400);
  expect(await databaseState([source.id])).toEqual(before);
  await expectStatus(await page.request.post(`/api/purchase-requests/${source.id}/comments`, {
    data: { comment: uniqueValue("Source changed before preview") },
  }), 200);
  const latest = await databaseState([source.id]);
  await expectStatus(await page.request.post(previewPath(source.id), { data: payload }), 409);
  expect(await databaseState([source.id])).toEqual(latest);
});

test("changing registered supplier details invalidates confirmation atomically and a fresh preview uses the new details", async ({ page }) => {
  const source = await approvedSource(page);
  const supplierResponse = await page.request.post("/api/suppliers", { data: {
    name: uniqueValue("Preview registered supplier"), address: "Address reviewed initially", taxId: "PREVIEW-TAX",
    contactPerson: "Supplier contact", paymentTerms: "Net 30", contacts: [{ channel: "PHONE", value: "02-123-4567" }],
  } });
  await expectStatus(supplierResponse, 201);
  const supplier = await supplierResponse.json() as SupplierDetail;
  const payload = { expectedUpdatedAt: source.orderPreparationVersion ?? source.updatedAt,
    orders: [{ supplierId: supplier.id, itemIds: source.items.map((item) => item.id), deliveryRecipientId: source.requester.id }],
  };
  const original = await preview(await page.request.post(previewPath(source.id), { data: payload }));
  expect(documentText(original.orders[0]!.document)).toContain(supplier.address!);
  await expectStatus(await page.request.patch(`/api/suppliers/${supplier.id}`, { data: {
    name: supplier.name, address: "Address changed after preview", taxId: supplier.taxId ?? "", contactPerson: supplier.contactPerson ?? "",
    paymentTerms: supplier.paymentTerms ?? "", note: supplier.note ?? "", contacts: supplier.contacts,
    expectedVersion: supplier.version, isActive: true,
  } }), 200);
  const before = await databaseState([source.id]);
  const stale = await page.request.post(createPath(source.id), { data: { ...payload, previewFingerprint: original.previewFingerprint } });
  await expectStatus(stale, 409);
  expect(await stale.json()).toMatchObject({ code: "PO_PREVIEW_CHANGED" });
  expect(await databaseState([source.id])).toEqual(before);
  const refreshed = await preview(await page.request.post(previewPath(source.id), { data: payload }));
  expect(refreshed.previewFingerprint).not.toBe(original.previewFingerprint);
  expect(documentText(refreshed.orders[0]!.document)).toContain("Address changed after preview");
  const confirmed = await page.request.post(createPath(source.id), { data: { ...payload, previewFingerprint: refreshed.previewFingerprint } });
  await expectStatus(confirmed, 201);
  const { purchaseOrders } = await confirmed.json() as { purchaseOrders: PurchaseOrderSummary[] };
  expect(await orderById(page, purchaseOrders[0]!.id)).toMatchObject({ supplierAddress: "Address changed after preview", totalAmount: refreshed.orders[0]!.totalAmount });
});

test("combined partial preview includes only selected rows and preserves pending rows until confirmation", async ({ page }) => {
  const a = await approvedSource(page);
  const b = await approvedSource(page);
  const payload = {
    requests: [a, b].map((source) => ({ id: source.id, expectedUpdatedAt: source.orderPreparationVersion ?? source.updatedAt })),
    orders: [{ supplierName: "Combined preview supplier", itemIds: [a.items[0]!.id, b.items[0]!.id] }],
  };
  const before = await databaseState([a.id, b.id]);
  const draft = await preview(await page.request.post("/api/purchase-orders/preview", { data: payload }));
  expect(draft.orders).toHaveLength(1);
  expect(draft.orders[0]).toMatchObject({ itemCount: 2, totalAmount: 200 });
  const text = documentText(draft.orders[0]!.document);
  for (const source of [a, b]) {
    expect(text).toContain(source.prNumber);
    expect(text).toContain(source.items[0]!.itemName);
    expect(text).not.toContain(source.items[1]!.itemName);
  }
  expect(await databaseState([a.id, b.id])).toEqual(before);
  await expectStatus(await page.request.post("/api/purchase-orders", { data: { ...payload, previewFingerprint: draft.previewFingerprint } }), 201);
  for (const source of [a, b]) {
    const current = await getRequest(page, source.id);
    expect(current.items).toHaveLength(2);
    expect(current.orderableItemCount).toBe(1);
    expect(current.items.find((item) => item.id === source.items[1]!.id)?.canOrder).toBe(true);
  }
});
