import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest, receive } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

async function approvedRequest(page: Page) {
  await authenticate(page);
  const marker = uniqueValue("PO-discount");
  const response = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify({
    requestDate: "2026-10-29", department: "Operations", reason: `Discounted supplier quotation ${marker}`, urgency: "NORMAL", submit: true,
    items: [
      { itemName: `${marker} first`, quantity: 2, unit: "ชิ้น", unitPrice: 50, amount: 100 },
      { itemName: `${marker} second`, quantity: 1, unit: "ชิ้น", unitPrice: 107, amount: 107 },
      { itemName: `${marker} third`, quantity: 1, unit: "ชิ้น", unitPrice: 50, amount: 50 },
    ],
  }) } });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, { data: { action: "APPROVED", comment: "Approved source for supplier discounts" } }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, id);
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

function preparationItems(request: PurchaseRequestDetail) {
  return request.items.map((item) => ({ clientId: item.id, sourceItemId: item.id, itemName: item.itemName, quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice! }));
}

async function issue(page: Page, request: PurchaseRequestDetail, extra: Record<string, unknown> = {}) {
  const response = await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, { data: {
    expectedUpdatedAt: request.orderPreparationVersion,
    orders: [{ supplierName: "Discount supplier", itemIds: request.items.map((item) => item.id) }], ...extra,
  } });
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  return Promise.all(purchaseOrders.map((order) => getOrder(page, order.id)));
}

function payload(order: PurchaseOrderDetail, extra: Record<string, unknown> = {}) {
  return {
    expectedVersion: order.version, reason: "Reconcile supplier discount with approved quotation", supplier: { supplierName: order.supplierName },
    deliveryAddress: order.deliveryAddress ?? "", paymentTerms: order.paymentTerms ?? "", expectedDeliveryDate: order.expectedDeliveryDate ?? "", note: order.note ?? "",
    items: order.items.map((item) => ({ id: item.id, itemName: item.itemName, description: item.description ?? "", quantity: item.quantity, unit: item.unit ?? "", unitPrice: item.unitPrice })),
    ...extra,
  };
}

async function propose(page: Page, order: PurchaseOrderDetail, extra: Record<string, unknown>) {
  const response = await page.request.patch(`/api/purchase-orders/${order.id}`, { data: payload(order, extra) });
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function approve(page: Page, pending: PurchaseOrderDetail) {
  await authenticate(page, credentials.approver);
  const response = await page.request.post(`/api/purchase-orders/${pending.id}/changes/${pending.pendingChangeId}/review`, { data: {
    expectedVersion: pending.version, action: "APPROVED", comment: "Supplier discounts independently verified",
  } });
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

test("item discounts precede proportional PO discounts and mixed VAT agrees with PR, receiving and Timeline", async ({ page }) => {
  const request = await approvedRequest(page);
  const items = preparationItems(request).map((item, index) => ({ ...item,
    taxMode: index === 1 ? "INCLUSIVE" : index === 2 ? "NONE" : null,
    discountType: index === 0 ? "PERCENT" : index === 1 ? "AMOUNT" : "NONE", discountValue: index === 0 ? 10 : index === 1 ? 7 : 0,
  }));
  const [order] = await issue(page, request, { items, orders: [{ supplierName: "Mixed discounted supplier", itemIds: items.map((item) => item.clientId), taxMode: "EXCLUSIVE", vatRate: 7, discountType: "PERCENT", discountValue: 10 }] });
  expect(order).toMatchObject({ discountType: "PERCENT", discountValue: 10, subtotalAmount: 257, itemDiscountAmount: 17, orderDiscountAmount: 24, discountAmount: 41, discountedSubtotalAmount: 216, netAmount: 210.11, taxAmount: 11.56, totalAmount: 221.67 });
  expect(order!.items[0]).toMatchObject({ quantity: 2, unitPrice: 50, amount: 100, discountType: "PERCENT", discountValue: 10, itemDiscountAmount: 10, orderDiscountAmount: 9, discountedAmount: 81, totalWithTax: 86.67 });
  expect(order!.items[1]).toMatchObject({ unitPrice: 107, amount: 107, discountType: "AMOUNT", discountValue: 7, itemDiscountAmount: 7, orderDiscountAmount: 10, discountedAmount: 90, totalWithTax: 90 });
  expect(order!.items[2]).toMatchObject({ orderDiscountAmount: 5, totalWithTax: 45 });
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(221.67);
  expect(source.items[0]).toMatchObject({ quantity: 2, unitPrice: 50, amount: 100, discountType: "PERCENT", discountValue: 10, orderDiscountAmount: 9, totalWithTax: 86.67 });
  expect(source.receivingItems[0]).toMatchObject({ orderDiscountAmount: 9, totalWithTax: 86.67, receivedQuantity: 0 });
  const comment = source.approvals.find((entry) => entry.stepLabel === "ปรับรายการก่อนออก PO")?.comment;
  for (const value of ["ส่วนลดรายการ", "ส่วนลดทั้งใบ", "10.00", "9.00", "221.67"]) expect(comment).toContain(value);
  await authenticate(page, credentials.employee);
  await expectStatus(await receive(page, source, [{ itemId: source.receivingItems[0]!.id, quantity: 1 }]), 200);
  expect((await getRequest(page, request.id)).receivingItems[0]).toMatchObject({ orderDiscountAmount: 9, totalWithTax: 86.67, receivedQuantity: 1 });
});

test("header-only discounts preserve raw legacy amounts and expose discounted totals even without a VAT basis", async ({ page }) => {
  const request = await approvedRequest(page);
  const [order] = await issue(page, request, { orders: [{ supplierName: "Header discount only", itemIds: request.items.map((item) => item.id), discountType: "AMOUNT", discountValue: 20 }] });
  expect(order).toMatchObject({ taxMode: "UNSPECIFIED", discountType: "AMOUNT", discountValue: 20, subtotalAmount: 257, discountAmount: 20, netAmount: null, taxAmount: null, totalAmount: 237 });
  expect(order!.items.map((item) => item.orderDiscountAmount)).toEqual([7.78, 8.33, 3.89]);
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(237);
  expect(source.items.map((item) => item.amount)).toEqual([100, 107, 50]);
  expect(source.items.map((item) => item.totalWithTax)).toEqual([92.22, 98.67, 46.11]);
});

test("pending changes preserve issued discounts and approval synchronizes new totals and before/after history", async ({ page }) => {
  const request = await approvedRequest(page);
  const [issued] = await issue(page, request, { orders: [{ supplierName: "Approved discount supplier", itemIds: request.items.map((item) => item.id), taxMode: "EXCLUSIVE", vatRate: 7, discountType: "PERCENT", discountValue: 10 }] });
  const original = await getRequest(page, request.id);
  const pending = await propose(page, issued!, { discountType: "PERCENT", discountValue: 20 });
  expect(pending.totalAmount).toBe(247.49);
  expect(pending.changes[0]!.after).toMatchObject({ discountType: "PERCENT", discountValue: 20, totalAmount: 219.99 });
  expect((await getRequest(page, request.id)).items).toEqual(original.items);
  expect((await getRequest(page, request.id)).totalAmount).toBe(247.49);
  const approved = await approve(page, pending);
  expect(approved).toMatchObject({ discountType: "PERCENT", discountValue: 20, discountAmount: 51.4, netAmount: 205.6, taxAmount: 14.39, totalAmount: 219.99 });
  const current = await getRequest(page, request.id);
  expect(current.totalAmount).toBe(219.99);
  expect(current.items.map((item) => item.orderDiscountAmount)).toEqual([20, 21.4, 10]);
  const comment = current.approvals.find((entry) => entry.stepLabel === "อนุมัติแก้ไข PO")?.comment;
  for (const value of ["ส่วนลดทั้งใบ", "10.00 %", "20.00 %", "25.70", "51.40", "247.49", "219.99"]) expect(comment).toContain(value);
});

test("whole-PO and row discount changes cannot reallocate a settled item's financial history", async ({ page }) => {
  const request = await approvedRequest(page);
  const [issued] = await issue(page, request, { orders: [{ supplierName: "Settled discount supplier", itemIds: request.items.map((item) => item.id), taxMode: "EXCLUSIVE", discountType: "AMOUNT", discountValue: 20 }] });
  const source = await getRequest(page, request.id);
  await authenticate(page, credentials.employee);
  await expectStatus(await receive(page, source, [{ itemId: source.receivingItems[0]!.id, quantity: 1 }]), 200);
  await authenticate(page, credentials.purchasing);
  const original = await getOrder(page, issued!.id);
  const invalid = [
    { discountType: "AMOUNT", discountValue: 21 },
    { items: payload(original).items.map((item, index) => ({ ...item, ...(index === 0 ? { discountType: "PERCENT", discountValue: 10 } : {}) })) },
    { items: payload(original).items.map((item, index) => ({ ...item, ...(index === 1 ? { unitPrice: 214 } : {}) })) },
    { items: payload(original).items.slice(0, 2) },
  ];
  for (const extra of invalid) {
    await expectStatus(await page.request.patch(`/api/purchase-orders/${original.id}`, { data: payload(original, extra) }), 400);
    expect(await getOrder(page, original.id)).toEqual(original);
  }
  const approved = await approve(page, await propose(page, original, { note: "Keep the allocated supplier discounts and received quantity" }));
  expect(approved.items[0]).toMatchObject({ receivedQuantity: 1, orderDiscountAmount: 7.78 });
  expect(approved.totalAmount).toBe(original.totalAmount);
});

test("invalid discounts and spoofed allocations roll back the entire batch while zero defaults remain a no-op", async ({ page }) => {
  const request = await approvedRequest(page);
  const items = preparationItems(request);
  const order = { supplierName: "Invalid discount supplier", itemIds: items.map((item) => item.clientId) };
  const invalid = [
    { orders: [{ ...order, discountType: "NONE", discountValue: 1 }] },
    { orders: [{ ...order, discountType: "PERCENT", discountValue: 100.01 }] },
    { orders: [{ ...order, discountType: "AMOUNT", discountValue: 258 }] },
    { orders: [{ ...order, discountType: "AMOUNT", discountValue: -1 }] },
    { orders: [{ ...order, discountType: "PERCENT", discountValue: 1.001 }] },
    { orders: [order], items: items.map((item, index) => ({ ...item, ...(index === 0 ? { discountType: "AMOUNT", discountValue: 101 } : {}) })) },
    { orders: [order], items: items.map((item) => ({ ...item, orderDiscountAmount: 1 })) },
    { orders: [{ ...order, discountType: "AMOUNT", discountValue: 1 }], items: items.map((item) => ({ ...item, discountType: "PERCENT", discountValue: 100 })) },
  ];
  for (const data of invalid) {
    await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, { data: { expectedUpdatedAt: request.orderPreparationVersion, ...data } }), 400);
    expect(await getRequest(page, request.id)).toEqual(request);
  }
  const [issued] = await issue(page, request);
  expect(issued!.discountType).toBeUndefined();
  await expectStatus(await page.request.patch(`/api/purchase-orders/${issued!.id}`, { data: payload(issued!, { discountType: "NONE", discountValue: 0,
    items: payload(issued!).items.map((item) => ({ ...item, discountType: "NONE", discountValue: 0 })),
  }) }), 400);
  expect(await getOrder(page, issued!.id)).toEqual(issued);
});

test("sibling POs retain their discounts when one PO is revised and PR aggregates stored line allocations", async ({ page }) => {
  const request = await approvedRequest(page);
  const orders = await issue(page, request, { orders: [
    { supplierName: "Discount supplier A", itemIds: [request.items[0]!.id], taxMode: "EXCLUSIVE", discountType: "AMOUNT", discountValue: 10 },
    { supplierName: "Discount supplier B", itemIds: request.items.slice(1).map((item) => item.id), taxMode: "INCLUSIVE", discountType: "PERCENT", discountValue: 10 },
  ] });
  expect(orders.map((order) => order.totalAmount)).toEqual([96.3, 141.3]);
  const original = await getRequest(page, request.id);
  expect(original.totalAmount).toBe(237.6);
  const approved = await approve(page, await propose(page, orders[0]!, { discountType: "PERCENT", discountValue: 20 }));
  expect(approved.totalAmount).toBe(85.6);
  const current = await getRequest(page, request.id);
  expect(current.totalAmount).toBe(226.9);
  expect(current.items.slice(1)).toEqual(original.items.slice(1));
  expect((await getOrder(page, orders[1]!.id)).totalAmount).toBe(141.3);
});

test("a full remaining discount produces zero payable without settling physical receiving quantities", async ({ page }) => {
  const request = await approvedRequest(page);
  const items = preparationItems(request).map((item) => ({ ...item, discountType: "PERCENT", discountValue: 50 }));
  const [order] = await issue(page, request, { items, orders: [{ supplierName: "Free replacement supplier", itemIds: items.map((item) => item.clientId), taxMode: "EXCLUSIVE", vatRate: 7, discountType: "PERCENT", discountValue: 100 }] });
  expect(order).toMatchObject({ subtotalAmount: 257, itemDiscountAmount: 128.5, orderDiscountAmount: 128.5, discountAmount: 257, netAmount: 0, taxAmount: 0, totalAmount: 0 });
  expect(order!.items.every((item) => item.totalWithTax === 0 && item.receivedQuantity === 0 && item.closedQuantity === 0)).toBe(true);
  const source = await getRequest(page, request.id);
  expect(source).toMatchObject({ status: "ORDERED", totalAmount: 0, receivedAt: null });
  expect(source.receivingItems.map((item) => item.remainingQuantity)).toEqual([2, 1, 1]);
});

test("discount and description edits preserve an unpriced legacy line's authoritative stored amount", async ({ page }) => {
  const request = await approvedRequest(page);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("The legacy fixture requires an explicitly configured E2E database");
  let databaseName: string;
  try { databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, "")); }
  catch { throw new Error("The legacy fixture requires a valid E2E database configuration"); }
  if (!databaseName.endsWith("_e2e")) throw new Error("Refusing to alter a legacy fixture outside a named E2E database");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query('UPDATE "PurchaseRequestItem" SET "unitPrice" = 0, "amount" = 321.09 WHERE "id" = $1 AND "purchaseRequestId" = $2', [request.items[0]!.id, request.id]);
    await client.query('UPDATE "PurchaseRequest" SET "totalAmount" = (SELECT SUM("amount") FROM "PurchaseRequestItem" WHERE "purchaseRequestId" = $1), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1', [request.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
  const legacy = await getRequest(page, request.id);
  expect(legacy.items[0]).toMatchObject({ quantity: 2, unitPrice: 0, amount: 321.09 });
  await page.goto(`/purchase-requests/${request.id}/purchase-orders/new`);
  await expect(page.locator(`#po-item-unit-price-${legacy.items[0]!.id}`)).toHaveValue("0");
  await expect(page.locator(`#po-item-total-${legacy.items[0]!.id}`)).toContainText("321.09");
  await expect(page.locator("#po-preparation-total")).toContainText("478.09");
  await page.locator(`#po-item-name-${legacy.items[0]!.id}`).fill(`${legacy.items[0]!.itemName} clarified`);
  await page.locator(`#po-item-discount-type-${legacy.items[0]!.id}`).selectOption("PERCENT");
  await page.locator(`#po-item-discount-value-${legacy.items[0]!.id}`).fill("10");
  await expect(page.locator(`#po-item-total-${legacy.items[0]!.id}`)).toContainText("321.09");
  const items = preparationItems(legacy).map((item, index) => ({ ...item,
    ...(index === 0 ? { description: "Clarified legacy specification", discountType: "PERCENT", discountValue: 10 } : {}),
  }));
  const [order] = await issue(page, legacy, { items });
  expect(order!.items[0]).toMatchObject({ quantity: 2, unitPrice: 0, amount: 321.09, itemDiscountAmount: 32.11, totalWithTax: 288.98 });
  expect(order!.totalAmount).toBe(445.98);
  await page.goto(`/purchase-orders/${order!.id}/edit`);
  await expect(page.locator("#po-edit-item-total-0")).toContainText("321.09");
  await expect(page.locator("#po-edit-total")).toContainText("445.98");
  await page.locator("#po-edit-discount-type").selectOption("AMOUNT");
  await page.locator("#po-edit-discount-value").fill("20");
  await expect(page.locator("#po-edit-total")).toContainText("425.98");
  const approved = await approve(page, await propose(page, order!, { discountType: "AMOUNT", discountValue: 20 }));
  expect(approved.items[0]).toMatchObject({ quantity: 2, unitPrice: 0, amount: 321.09, itemDiscountAmount: 32.11 });
  expect(approved.totalAmount).toBe(425.98);
  const source = await getRequest(page, request.id);
  expect(source.items[0]).toMatchObject({ quantity: 2, unitPrice: 0, amount: 321.09 });
  expect(source.totalAmount).toBe(425.98);
});
