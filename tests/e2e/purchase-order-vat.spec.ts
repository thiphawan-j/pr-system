import { expect, test, type Page } from "@playwright/test";
import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import type { PurchasePriceTaxMode } from "../../src/lib/purchase-order-tax";
import { authenticate, expectStatus, getRequest, receive } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

async function approvedRequest(page: Page) {
  await authenticate(page);
  const marker = uniqueValue("PO-VAT");
  const created = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify({
    requestDate: "2026-10-24", department: "Operations", reason: `VAT preparation ${marker}`, urgency: "NORMAL", submit: true,
    items: [
      { itemName: `${marker} first`, quantity: 2, unit: "ชิ้น", unitPrice: 50, amount: 100 },
      { itemName: `${marker} second`, quantity: 1, unit: "ชิ้น", unitPrice: 107, amount: 107 },
      { itemName: `${marker} third`, quantity: 1, unit: "ชิ้น", unitPrice: 50, amount: 50 },
    ],
  }) } });
  await expectStatus(created, 200);
  const { id } = await created.json() as { id: string };
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, { data: { action: "APPROVED", comment: "Approved source for VAT tests" } }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, id);
}

async function orderById(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

function preparationItems(request: PurchaseRequestDetail, modes: Array<PurchasePriceTaxMode | null>) {
  return request.items.map((item, index) => ({
    clientId: item.id, sourceItemId: item.id, itemName: item.itemName, quantity: item.quantity,
    unit: item.unit, unitPrice: item.unitPrice!, taxMode: modes[index] ?? null,
  }));
}

async function issueMixed(page: Page) {
  const request = await approvedRequest(page);
  const response = await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, { data: {
    expectedUpdatedAt: request.orderPreparationVersion,
    orders: [{ supplierName: "Mixed VAT supplier", itemIds: request.items.map((item) => item.id), taxMode: "EXCLUSIVE", vatRate: 7 }],
    items: preparationItems(request, [null, "INCLUSIVE", "NONE"]),
  } });
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  return { request, order: await orderById(page, purchaseOrders[0]!.id) };
}

function changePayload(order: PurchaseOrderDetail, extra: Record<string, unknown> = {}) {
  return {
    expectedVersion: order.version, reason: "Correct VAT treatment from supplier quotation", supplier: { supplierName: order.supplierName },
    deliveryAddress: order.deliveryAddress ?? "", paymentTerms: order.paymentTerms ?? "", expectedDeliveryDate: order.expectedDeliveryDate ?? "", note: order.note ?? "",
    items: order.items.map((item) => ({ id: item.id, itemName: item.itemName, description: item.description ?? "", quantity: item.quantity, unit: item.unit ?? "", unitPrice: item.unitPrice })),
    ...extra,
  };
}

async function propose(page: Page, order: PurchaseOrderDetail, extra: Record<string, unknown>) {
  const response = await page.request.patch(`/api/purchase-orders/${order.id}`, { data: changePayload(order, extra) });
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function approve(page: Page, pending: PurchaseOrderDetail) {
  await authenticate(page, credentials.approver);
  const response = await page.request.post(`/api/purchase-orders/${pending.id}/changes/${pending.pendingChangeId}/review`, { data: {
    expectedVersion: pending.version, action: "APPROVED", comment: "VAT quotation verified independently",
  } });
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

test("whole-PO VAT with line overrides preserves entered prices and synchronizes payable PR totals and Timeline", async ({ page }) => {
  const { request, order } = await issueMixed(page);
  expect(order).toMatchObject({ taxMode: "EXCLUSIVE", vatRate: 7, subtotalAmount: 257, netAmount: 250, taxAmount: 14, totalAmount: 264, hasUnspecifiedTax: false });
  expect(order.items[0]).toMatchObject({ taxMode: null, effectiveTaxMode: "EXCLUSIVE", quantity: 2, unitPrice: 50, amount: 100, netAmount: 100, taxAmount: 7, totalWithTax: 107 });
  expect(order.items[1]).toMatchObject({ taxMode: "INCLUSIVE", effectiveTaxMode: "INCLUSIVE", unitPrice: 107, amount: 107, netAmount: 100, taxAmount: 7, totalWithTax: 107 });
  expect(order.items[2]).toMatchObject({ taxMode: "NONE", amount: 50, netAmount: 50, taxAmount: 0, totalWithTax: 50 });
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(264);
  for (const [index, mode] of ["EXCLUSIVE", "INCLUSIVE", "NONE"].entries()) {
    expect(source.items[index]).toMatchObject({ taxMode: mode, vatRate: 7, unitPrice: request.items[index]!.unitPrice, amount: request.items[index]!.amount });
    expect(source.receivingItems[index]).toMatchObject({ taxMode: mode, vatRate: 7, receivedQuantity: 0, closedQuantity: 0 });
  }
  const comment = source.approvals.find((entry) => entry.stepLabel === "ปรับรายการก่อนออก PO")?.comment;
  for (const value of ["รวม VAT แล้ว", "ยังไม่รวม VAT", "ไม่มี VAT", "7.00%", "257.00", "264.00"]) expect(comment).toContain(value);
});

test("VAT-only approval preserves omitted row overrides, keeps pending values unchanged, and records before/after tax details", async ({ page }) => {
  const { request, order } = await issueMixed(page);
  const originalSource = await getRequest(page, request.id);
  const pending = await propose(page, order, { taxMode: "INCLUSIVE" });
  expect(pending).toMatchObject({ totalAmount: 264, taxMode: "EXCLUSIVE", vatRate: 7 });
  expect((await getRequest(page, request.id)).items).toEqual(originalSource.items);
  expect((await getRequest(page, request.id)).totalAmount).toBe(264);
  expect(pending.changes[0]!.after).toMatchObject({ taxMode: "INCLUSIVE", vatRate: 7, totalAmount: 257 });
  expect(pending.changes[0]!.after.items.map((item) => item.taxMode)).toEqual([null, "INCLUSIVE", "NONE"]);
  const approved = await approve(page, pending);
  expect(approved).toMatchObject({ taxMode: "INCLUSIVE", vatRate: 7, subtotalAmount: 257, netAmount: 243.46, taxAmount: 13.54, totalAmount: 257 });
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(257);
  expect(source.items[0]).toMatchObject({ taxMode: "INCLUSIVE", amount: 100, totalWithTax: 100 });
  const comment = source.approvals.find((entry) => entry.stepLabel === "อนุมัติแก้ไข PO")?.comment;
  for (const value of ["รูปแบบภาษีทั้งใบ", "ยังไม่รวม VAT", "รวม VAT แล้ว", "250.00", "243.46", "14.00", "13.54", "264.00", "257.00"]) expect(comment).toContain(value);
  await authenticate(page, credentials.employee);
  await expectStatus(await receive(page, source, [{ itemId: source.receivingItems[0]!.id, quantity: 1 }]), 200);
  const received = await getRequest(page, request.id);
  expect(received.receivingItems[0]).toMatchObject({ receivedQuantity: 1, remainingQuantity: 1, taxMode: "INCLUSIVE", totalWithTax: 100 });
});

test("unknown-tax overrides remain explicit and known rows stay accurate when VAT rate changes", async ({ page }) => {
  const { request, order } = await issueMixed(page);
  const items = changePayload(order).items.map((item, index) => ({ ...item, ...(index === 2 ? { taxMode: "UNSPECIFIED" } : {}) }));
  const approved = await approve(page, await propose(page, order, { vatRate: 10, items }));
  expect(approved).toMatchObject({ taxMode: "EXCLUSIVE", vatRate: 10, subtotalAmount: 257, netAmount: null, taxAmount: null, totalAmount: 267, hasUnspecifiedTax: true });
  expect(approved.items[0]).toMatchObject({ taxMode: null, netAmount: 100, taxAmount: 10, totalWithTax: 110 });
  expect(approved.items[1]).toMatchObject({ taxMode: "INCLUSIVE", netAmount: 97.27, taxAmount: 9.73, totalWithTax: 107 });
  expect(approved.items[2]).toMatchObject({ taxMode: "UNSPECIFIED", netAmount: null, taxAmount: null, totalWithTax: 50 });
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(267);
  expect(source.items[2]).toMatchObject({ taxMode: "UNSPECIFIED", vatRate: 10, totalWithTax: 50 });
});

test("VAT changes to settled rows are rejected atomically while equal effective overrides remain permitted", async ({ page }) => {
  const { request, order } = await issueMixed(page);
  await authenticate(page, credentials.employee);
  const source = await getRequest(page, request.id);
  await expectStatus(await receive(page, source, [{ itemId: source.receivingItems[0]!.id, quantity: 1 }]), 200);
  await authenticate(page, credentials.purchasing);
  const original = await orderById(page, order.id);
  for (const extra of [{ taxMode: "INCLUSIVE" }, { vatRate: 10 }, { items: changePayload(original).items.map((item, index) => ({ ...item, ...(index === 0 ? { taxMode: "NONE" } : {}) })) }]) {
    await expectStatus(await page.request.patch(`/api/purchase-orders/${order.id}`, { data: changePayload(original, extra) }), 400);
    expect(await orderById(page, order.id)).toEqual(original);
  }
  const items = changePayload(original).items.map((item, index) => ({ ...item, ...(index === 0 ? { taxMode: "EXCLUSIVE" } : {}) }));
  const approved = await approve(page, await propose(page, original, { taxMode: "INCLUSIVE", items }));
  expect(approved.items[0]).toMatchObject({ taxMode: "EXCLUSIVE", effectiveTaxMode: "EXCLUSIVE", receivedQuantity: 1, closedQuantity: 0 });
  expect(approved.totalAmount).toBe(264);
  const current = await getRequest(page, request.id);
  expect(current.totalAmount).toBe(264);
  expect(current.receivingItems[0]).toMatchObject({ receivedQuantity: 1, remainingQuantity: 1, taxMode: "EXCLUSIVE", totalWithTax: 107 });
});

test("invalid VAT values and exclusive-tax overflow roll back issuance, and default legacy snapshots remain unchanged", async ({ page }) => {
  const request = await approvedRequest(page);
  const itemIds = request.items.map((item) => item.id);
  const base = { expectedUpdatedAt: request.orderPreparationVersion, orders: [{ supplierName: "VAT validation supplier", itemIds }] };
  const invalid = [
    { ...base, orders: [{ ...base.orders[0], taxMode: "BAD" }] },
    ...[-1, 100.01, 7.001].map((vatRate) => ({ ...base, orders: [{ ...base.orders[0], taxMode: "EXCLUSIVE", vatRate }] })),
    { ...base, orders: [{ ...base.orders[0], taxMode: "EXCLUSIVE", vatRate: 100 }], items: preparationItems(request, [null, null, null]).map((item, index) => ({ ...item, quantity: 1, unitPrice: index === 0 ? 9999999999.99 : 0 })) },
  ];
  for (const data of invalid) {
    await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, { data }), 400);
    expect(await getRequest(page, request.id)).toEqual(request);
  }
  const issued = await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, { data: base });
  await expectStatus(issued, 201);
  const { purchaseOrders } = await issued.json() as { purchaseOrders: PurchaseOrderSummary[] };
  const order = await orderById(page, purchaseOrders[0]!.id);
  expect(order.totalAmount).toBe(257);
  expect(order.taxMode).toBeUndefined();
  await expectStatus(await page.request.patch(`/api/purchase-orders/${order.id}`, { data: changePayload(order, {
    taxMode: "UNSPECIFIED", vatRate: 7, items: changePayload(order).items.map((item) => ({ ...item, taxMode: null })),
  }) }), 400);
  expect(await orderById(page, order.id)).toEqual(order);
});

test("header-only VAT across supplier POs aggregates PR payable totals using each supplier's rate", async ({ page }) => {
  const request = await approvedRequest(page);
  const response = await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, { data: {
    expectedUpdatedAt: request.orderPreparationVersion,
    orders: [
      { supplierName: "Supplier VAT 7", itemIds: [request.items[0]!.id], taxMode: "EXCLUSIVE", vatRate: 7 },
      { supplierName: "Supplier VAT 10", itemIds: request.items.slice(1).map((item) => item.id), taxMode: "EXCLUSIVE", vatRate: 10 },
    ],
  } });
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  expect(purchaseOrders.map((order) => order.totalAmount)).toEqual([107, 172.7]);
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(279.7);
  expect(source.items[0]).toMatchObject({ taxMode: "EXCLUSIVE", vatRate: 7, amount: 100, totalWithTax: 107 });
  expect(source.items[1]).toMatchObject({ taxMode: "EXCLUSIVE", vatRate: 10, amount: 107, totalWithTax: 117.7 });
  expect(source.items[2]).toMatchObject({ taxMode: "EXCLUSIVE", vatRate: 10, amount: 50, totalWithTax: 55 });
  const order = await orderById(page, purchaseOrders[0]!.id);
  const approved = await approve(page, await propose(page, order, { vatRate: 0 }));
  expect(approved).toMatchObject({ taxMode: "EXCLUSIVE", vatRate: 0, taxAmount: 0, totalAmount: 100 });
  const revisedSource = await getRequest(page, request.id);
  expect(revisedSource.totalAmount).toBe(272.7);
  expect(revisedSource.items[0]).toMatchObject({ taxMode: "EXCLUSIVE", vatRate: 0, totalWithTax: 100 });
  expect(revisedSource.items.slice(1)).toEqual(source.items.slice(1));
  expect((await orderById(page, purchaseOrders[1]!.id)).totalAmount).toBe(172.7);
});

test("keeping the registered supplier permits a full reset to unspecified VAT and detects the next default no-op", async ({ page }) => {
  const request = await approvedRequest(page);
  const createdSupplier = await page.request.post("/api/suppliers", { data: {
    name: uniqueValue("Registered VAT reset"), contacts: [{ channel: "EMAIL", value: "vat-reset@example.com" }],
  } });
  await expectStatus(createdSupplier, 201);
  const { id: supplierId } = await createdSupplier.json() as { id: string };
  const issued = await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, { data: {
    expectedUpdatedAt: request.orderPreparationVersion,
    orders: [{ supplierId, itemIds: request.items.map((item) => item.id), taxMode: "EXCLUSIVE", vatRate: 7 }],
  } });
  await expectStatus(issued, 201);
  const { purchaseOrders } = await issued.json() as { purchaseOrders: PurchaseOrderSummary[] };
  const order = await orderById(page, purchaseOrders[0]!.id);
  expect(order).toMatchObject({ supplierId, taxMode: "EXCLUSIVE", vatRate: 7, totalAmount: 274.99 });
  const pending = await propose(page, order, {
    supplier: { supplierId }, taxMode: "UNSPECIFIED", vatRate: 7,
    items: changePayload(order).items.map((item) => ({ ...item, taxMode: null })),
  });
  expect(pending.changes[0]!.after.totalAmount).toBe(257);
  expect(pending.changes[0]!.after.taxMode).toBeUndefined();
  expect(pending.changes[0]!.after.vatRate).toBeUndefined();
  expect(pending.changes[0]!.after.items.every((item) => item.taxMode === undefined)).toBe(true);
  const approved = await approve(page, pending);
  expect(approved.supplierId).toBe(supplierId);
  expect(approved.totalAmount).toBe(257);
  expect(approved.taxMode).toBeUndefined();
  expect(approved.vatRate).toBeUndefined();
  expect(approved.items.every((item) => item.taxMode === undefined)).toBe(true);
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(257);
  expect(source.items.every((item) => item.taxMode === undefined)).toBe(true);
  await authenticate(page, credentials.purchasing);
  const purchasingView = await orderById(page, approved.id);
  await expectStatus(await page.request.patch(`/api/purchase-orders/${approved.id}`, { data: changePayload(approved, {
    supplier: { supplierId }, taxMode: "UNSPECIFIED", vatRate: 7,
    items: changePayload(approved).items.map((item) => ({ ...item, taxMode: null })),
  }) }), 400);
  expect(await orderById(page, approved.id)).toEqual(purchasingView);
});
