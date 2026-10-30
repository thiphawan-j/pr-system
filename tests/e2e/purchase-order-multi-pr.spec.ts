import { expect, test, type APIResponse, type Page } from "@playwright/test";

import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

async function approved(page: Page, count = 3, shouldApprove = true) {
  await authenticate(page);
  const marker = uniqueValue("Multi-PR");
  const response = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify({
    requestDate: "2026-10-30", department: "Operations", reason: `Consolidated procurement ${marker}`,
    urgency: "NORMAL", submit: true,
    items: Array.from({ length: count }, (_, index) => ({
      itemName: `${marker}-${index + 1}`, quantity: index + 1, unit: "ชิ้น", unitPrice: 10,
      amount: (index + 1) * 10, supplierName: "Shared supplier",
    })),
  }) } });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  if (shouldApprove) {
    await authenticate(page, credentials.approver);
    await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, {
      data: { action: "APPROVED", comment: "Approve source rows for consolidated purchasing" },
    }), 200);
  }
  await authenticate(page, credentials.purchasing);
  return getRequest(page, id);
}

function references(...requests: PurchaseRequestDetail[]) {
  return requests.map((request) => ({ id: request.id, expectedUpdatedAt: request.orderPreparationVersion ?? request.updatedAt }));
}

async function issued(response: APIResponse) {
  await expectStatus(response, 201);
  return (await response.json() as { purchaseOrders: PurchaseOrderSummary[] }).purchaseOrders;
}

async function order(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return response.json() as Promise<PurchaseOrderDetail>;
}

function preparation(request: PurchaseRequestDetail) {
  return request.items.filter((item) => item.canOrder !== false).map((item) => ({
    clientId: item.id, sourceItemId: item.id, sourcePurchaseRequestId: request.id,
    itemName: item.itemName, description: item.description ?? undefined, quantity: item.quantity,
    unit: item.unit ?? undefined, unitPrice: item.unitPrice ?? 0,
  }));
}

test("issue 3 of 10 PR rows then issue the remaining 7 without deleting or ordering a row twice", async ({ page }) => {
  const source = await approved(page, 10);
  const firstIds = source.items.slice(0, 3).map((item) => item.id);
  const [first] = await issued(await page.request.post(`/api/purchase-requests/${source.id}/purchase-orders`, {
    data: { orders: [{ supplierName: "First supplier", itemIds: firstIds }] },
  }));
  const partial = await getRequest(page, source.id);
  expect(partial.items).toHaveLength(10);
  expect(partial.orderableItemCount).toBe(7);
  expect(partial.receivedAt).toBeNull();
  expect((await order(page, first!.id)).items).toHaveLength(3);
  const [second] = await issued(await page.request.post(`/api/purchase-requests/${source.id}/purchase-orders`, {
    data: { expectedUpdatedAt: partial.orderPreparationVersion, orders: [{ supplierName: "Second supplier", itemIds: source.items.slice(3).map((item) => item.id) }] },
  }));
  expect((await order(page, second!.id)).items).toHaveLength(7);
  const complete = await getRequest(page, source.id);
  expect(complete.items).toHaveLength(10);
  expect(complete.orderableItemCount).toBe(0);
  expect(complete.purchaseOrders).toHaveLength(2);
  expect(complete.totalAmount).toBe(550);
  expect(complete.receivedAt).toBeNull();
  await expectStatus(await page.request.post(`/api/purchase-requests/${source.id}/purchase-orders`, {
    data: { orders: [{ supplierName: "Duplicate", itemIds: firstIds }] },
  }), 409);
  expect(await getRequest(page, source.id)).toEqual(complete);
});

test("one supplier PO can combine source rows from two PRs with origin-specific discounts and VAT totals", async ({ page }) => {
  const a = await approved(page, 3);
  const b = await approved(page, 2);
  const [created] = await issued(await page.request.post("/api/purchase-orders", { data: {
    requests: references(a, b), orders: [{ supplierName: "Combined supplier", taxMode: "EXCLUSIVE", vatRate: 7,
      discountType: "PERCENT", discountValue: 10, itemIds: [a.items[0]!.id, b.items[1]!.id],
    }],
  } }));
  const document = await order(page, created!.id);
  expect(document.purchaseRequests?.map((source) => source.id).sort()).toEqual([a.id, b.id].sort());
  expect(document.items.map((item) => item.sourcePurchaseRequestId).sort()).toEqual([a.id, b.id].sort());
  expect(document.totalAmount).toBe(28.89);
  const afterA = await getRequest(page, a.id);
  const afterB = await getRequest(page, b.id);
  expect(afterA.totalAmount).toBe(59.63);
  expect(afterB.totalAmount).toBe(29.26);
  expect(afterA.orderableItemCount).toBe(2);
  expect(afterB.orderableItemCount).toBe(1);
  expect(afterA.purchaseOrders[0]!.id).toBe(created!.id);
  expect(afterB.purchaseOrders[0]!.id).toBe(created!.id);
  expect(afterA.approvals.some((entry) => entry.comment?.includes(created!.poNumber))).toBe(true);
  expect(afterB.approvals.some((entry) => entry.comment?.includes(created!.poNumber))).toBe(true);
});

test("preparation preserves unchecked pending rows and previously ordered rows while explicitly deleted pending rows are removed", async ({ page }) => {
  const source = await approved(page, 4);
  const [first] = await issued(await page.request.post(`/api/purchase-requests/${source.id}/purchase-orders`, {
    data: { orders: [{ supplierName: "First", itemIds: [source.items[0]!.id] }] },
  }));
  const partial = await getRequest(page, source.id);
  const pending = preparation(partial).filter((item) => item.sourceItemId !== source.items[0]!.id);
  const selected = { ...pending[0]!, quantity: 5, unitPrice: 12 };
  const unchecked = pending[1]!;
  await issued(await page.request.post("/api/purchase-orders", { data: {
    requests: references(partial), items: [selected, unchecked],
    orders: [{ supplierName: "Next", itemIds: [selected.clientId] }],
  } }));
  const after = await getRequest(page, source.id);
  expect(after.items).toHaveLength(3);
  expect(after.items.find((item) => item.id === selected.sourceItemId)?.quantity).toBe(5);
  expect(after.items.find((item) => item.id === unchecked.sourceItemId)?.canOrder).toBe(true);
  expect(after.items.find((item) => item.id === source.items[0]!.id)?.quantity).toBe(1);
  expect((await order(page, first!.id)).items[0]!.quantity).toBe(1);
  expect(after.totalAmount).toBe(100);
});

test("concurrent overlapping combined issuances create only one PO and keep the other PR pending", async ({ page }) => {
  const a = await approved(page, 2);
  const b = await approved(page, 2);
  const data = { requests: references(a, b), orders: [{ supplierName: "Concurrent supplier", itemIds: [a.items[0]!.id, b.items[0]!.id] }] };
  const responses = await Promise.all([page.request.post("/api/purchase-orders", { data }), page.request.post("/api/purchase-orders", { data })]);
  expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
  for (const request of [a, b]) {
    const current = await getRequest(page, request.id);
    expect(current.purchaseOrders).toHaveLength(1);
    expect(current.orderableItemCount).toBe(1);
    expect(current.items).toHaveLength(2);
  }
});

test("preparation cannot delete every row of one source PR while ordering only another PR", async ({ page }) => {
  const a = await approved(page, 2);
  const b = await approved(page, 2);
  const beforeA = await getRequest(page, a.id);
  const beforeB = await getRequest(page, b.id);
  const response = await page.request.post("/api/purchase-orders", { data: {
    requests: references(a, b), items: preparation(b),
    orders: [{ supplierName: "Must roll back", itemIds: b.items.map((item) => item.id) }],
  } });
  await expectStatus(response, 400);
  expect(await getRequest(page, a.id)).toEqual(beforeA);
  expect(await getRequest(page, b.id)).toEqual(beforeB);
});

test("stale, duplicate, foreign-source and unapproved combined requests roll back every PR", async ({ page }) => {
  const a = await approved(page, 2);
  const b = await approved(page, 2);
  const stranger = await approved(page, 1);
  const unapproved = await approved(page, 1, false);
  const beforeA = await getRequest(page, a.id);
  const beforeB = await getRequest(page, b.id);
  const attempts = [
    { requests: [{ id: a.id, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, ...references(b)], orders: [{ supplierName: "Invalid", itemIds: [a.items[0]!.id, b.items[0]!.id] }] },
    { requests: references(a, a), orders: [{ supplierName: "Invalid", itemIds: [a.items[0]!.id] }] },
    { requests: references(a, b), orders: [{ supplierName: "Invalid", itemIds: [stranger.items[0]!.id] }] },
    { requests: references(a, b), orders: [{ supplierName: " Same ", itemIds: [a.items[0]!.id] }, { supplierName: "same", itemIds: [b.items[0]!.id] }] },
    { requests: references(a, b), items: [{ ...preparation(a)[0]!, sourcePurchaseRequestId: b.id }], orders: [{ supplierName: "Invalid", itemIds: [a.items[0]!.id] }] },
    { requests: references(a, b), items: [{ clientId: "new-without-origin", itemName: "Ambiguous source", quantity: 1, unitPrice: 10 }], orders: [{ supplierName: "Invalid", itemIds: ["new-without-origin"] }] },
    { requests: references(a, unapproved), orders: [{ supplierName: "Invalid", itemIds: [a.items[0]!.id, unapproved.items[0]!.id] }] },
  ];
  for (const data of attempts) {
    const response = await page.request.post("/api/purchase-orders", { data });
    expect([400, 409]).toContain(response.status());
    expect(await getRequest(page, a.id)).toEqual(beforeA);
    expect(await getRequest(page, b.id)).toEqual(beforeB);
  }
  await authenticate(page);
  await expectStatus(await page.request.post("/api/purchase-orders", { data: {
    requests: references(a, b), orders: [{ supplierName: "Unauthorized", itemIds: [a.items[0]!.id] }],
  } }), 403);
});

test("eligible source lookup is restricted to purchasing and returns only remaining rows with 10 per page", async ({ page }) => {
  const a = await approved(page, 3);
  await issued(await page.request.post(`/api/purchase-requests/${a.id}/purchase-orders`, {
    data: { orders: [{ supplierName: "Lookup", itemIds: [a.items[0]!.id] }] },
  }));
  const response = await page.request.get(`/api/purchase-orders/eligible?query=${encodeURIComponent(a.prNumber)}`);
  await expectStatus(response, 200);
  const result = await response.json();
  expect(result.pageSize).toBe(10);
  expect(result.requests).toEqual([expect.objectContaining({ id: a.id, orderableItemCount: 2 })]);
  const current = await getRequest(page, a.id);
  await issued(await page.request.post("/api/purchase-orders", { data: {
    requests: references(current), orders: [{ supplierName: "Lookup rest", itemIds: current.items.slice(1).map((item) => item.id) }],
  } }));
  expect((await (await page.request.get(`/api/purchase-orders/eligible?query=${encodeURIComponent(a.prNumber)}`)).json()).requests).toEqual([]);
  await authenticate(page, credentials.employee);
  await expectStatus(await page.request.get("/api/purchase-orders/eligible"), 403);
});
