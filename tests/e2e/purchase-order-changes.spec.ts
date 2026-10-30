import { expect, test, type APIResponse, type Page } from "@playwright/test";

import type { PurchaseOrderDetail, PurchaseOrderSnapshot, PurchaseOrderSummary, PurchaseRequestDetail, SupplierDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest, receive, receivedDate } from "./receipt-support";
import { credentials, uniqueValue, type Credentials } from "./support";

type ChangeItem = { id?: string; itemName: string; description?: string; quantity: number; unit?: string; unitPrice: number };
type ChangeSupplier = { supplierId: string } | {
  supplierName: string; supplierTaxId?: string; supplierAddress?: string; supplierContactPerson?: string;
  supplierContacts?: Array<{ channel: "LINE" | "PHONE" | "ECOMMERCE" | "EMAIL" | "OTHER"; value: string }>;
  supplierContact?: string;
};

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function createSupplier(page: Page, suffix: string) {
  const response = await page.request.post("/api/suppliers", { data: {
    name: uniqueValue(`Change-supplier-${suffix}`), taxId: `TAX-${suffix}`, address: `Address ${suffix}`, contactPerson: `Person ${suffix}`,
    paymentTerms: `Terms ${suffix}`, contacts: [{ channel: "LINE", value: `@change-${suffix}` }],
  } });
  await expectStatus(response, 201);
  return await response.json() as SupplierDetail;
}

async function createIssued(page: Page, quantities = [10, 5], split = false, supplier?: SupplierDetail) {
  await authenticate(page);
  const marker = uniqueValue("PO-change-source");
  const created = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify({
    requestDate: "2026-10-22", department: "Operations", reason: `Approved source for ${marker}`, urgency: "NORMAL", submit: true,
    items: quantities.map((quantity, index) => ({
      itemName: `${marker} item ${index + 1}`, description: `Original description ${index + 1}`, quantity, unit: "ชิ้น", unitPrice: (index + 1) * 10,
      amount: quantity * (index + 1) * 10,
    })),
  }) } });
  await expectStatus(created, 200);
  const { id } = await created.json() as { id: string };
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, {
    data: { action: "APPROVED", comment: "Approved before issuing editable purchase orders" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  const approved = await getRequest(page, id);
  const groups = split ? approved.items.map((item) => [item.id]) : [approved.items.map((item) => item.id)];
  const issued = await page.request.post(`/api/purchase-requests/${id}/purchase-orders`, { data: {
    orders: groups.map((itemIds, index) => ({
      ...(supplier ? { supplierId: supplier.id } : { supplierName: `Original supplier ${index}`, supplierAddress: "Original address", supplierContact: "Original contact" }),
      deliveryAddress: "Original delivery address", note: "Original order note", itemIds,
    })),
  } });
  await expectStatus(issued, 201);
  const summaries = (await issued.json() as { purchaseOrders: PurchaseOrderSummary[] }).purchaseOrders;
  return {
    request: await getRequest(page, id),
    orders: await Promise.all(summaries.map((order) => getOrder(page, order.id))),
  };
}

function itemsOf(order: PurchaseOrderDetail): ChangeItem[] {
  return order.items.map((item) => ({ id: item.id, itemName: item.itemName, description: item.description ?? "", quantity: item.quantity, unit: item.unit ?? "", unitPrice: item.unitPrice }));
}

function receiptItemId(item: PurchaseOrderDetail["items"][number]) {
  return item.purchaseRequestItemId ?? item.id;
}

function expectSourceUnchanged(current: PurchaseRequestDetail, original: PurchaseRequestDetail) {
  expect(current.items).toEqual(original.items);
  expect(current.totalAmount).toBe(original.totalAmount);
}

function snapshot(order: PurchaseOrderDetail): PurchaseOrderSnapshot {
  return {
    supplierId: order.supplierId, supplierCode: order.supplierCode, supplierName: order.supplierName,
    supplierTaxId: order.supplierTaxId, supplierAddress: order.supplierAddress, supplierContact: order.supplierContact,
    supplierContactPerson: order.supplierContactPerson, supplierContacts: order.supplierContacts,
    deliveryAddress: order.deliveryAddress, paymentTerms: order.paymentTerms, expectedDeliveryDate: order.expectedDeliveryDate,
    deliveryRecipientId: order.deliveryRecipientId, deliveryRecipientName: order.deliveryRecipientName,
    deliveryRecipientPhone: order.deliveryRecipientPhone,
    note: order.note, totalAmount: order.totalAmount,
    items: order.items.map((item) => ({
      id: item.id, purchaseRequestItemId: item.purchaseRequestItemId, itemName: item.itemName, description: item.description,
      quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice, amount: item.amount,
    })),
  };
}

function changePayload(order: PurchaseOrderDetail, extra: Record<string, unknown> = {}) {
  const supplier: ChangeSupplier = order.supplierId ? { supplierId: order.supplierId } : {
    supplierName: order.supplierName, supplierTaxId: order.supplierTaxId ?? "", supplierAddress: order.supplierAddress ?? "",
    supplierContactPerson: order.supplierContactPerson ?? "", supplierContacts: order.supplierContacts, supplierContact: order.supplierContact ?? "",
  };
  return {
    expectedVersion: order.version, reason: uniqueValue("Approved-specification-change"), supplier,
    deliveryAddress: order.deliveryAddress ?? "", paymentTerms: order.paymentTerms ?? "", expectedDeliveryDate: order.expectedDeliveryDate ?? undefined,
    note: order.note ?? "", items: itemsOf(order), ...extra,
  };
}

function propose(page: Page, order: PurchaseOrderDetail, extra: Record<string, unknown> = {}) {
  return page.request.patch(`/api/purchase-orders/${order.id}`, { data: changePayload(order, extra) });
}

async function proposed(response: Pick<APIResponse, "status" | "text" | "json">) {
  await expectStatus(response, 200);
  const order = await response.json() as PurchaseOrderDetail;
  expect(order.pendingChangeId).toBeTruthy();
  expect(order.changes.find((change) => change.id === order.pendingChangeId)?.status).toBe("PENDING");
  return order;
}

function review(page: Page, order: PurchaseOrderDetail, action: "APPROVED" | "REJECTED", comment?: string, expectedVersion = order.version, changeId = order.pendingChangeId!) {
  return page.request.post(`/api/purchase-orders/${order.id}/changes/${changeId}/review`, { data: { expectedVersion, action, comment } });
}

async function approve(page: Page, order: PurchaseOrderDetail, account: Credentials = credentials.approver) {
  await authenticate(page, account);
  const response = await review(page, order, "APPROVED", "Reviewed the revised purchase specification");
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function assertRejectedProposal(page: Page, order: PurchaseOrderDetail, mutation: Promise<APIResponse>, status = 400) {
  await expectStatus(await mutation, status);
  expect(await getOrder(page, order.id)).toEqual(order);
}

test("proposing supplier, header and financial changes records before/after without changing the issued PO or PR", async ({ page }) => {
  const { request, orders: [original] } = await createIssued(page);
  const items = itemsOf(original!);
  items[0] = { ...items[0]!, itemName: "Revised unreceived item", quantity: 12, unitPrice: 11.25 };
  const reason = uniqueValue("Supplier-quotation-was-revised");
  const pending = await proposed(await propose(page, original!, {
    reason, supplier: { supplierName: "Revised supplier", supplierTaxId: "NEW-TAX", supplierAddress: "Revised address", supplierContactPerson: "Revised person", supplierContacts: [{ channel: "PHONE", value: "0822222222" }] },
    deliveryAddress: "Revised delivery address", paymentTerms: "Net 45", expectedDeliveryDate: "2026-11-15", note: "Pending revised quote", items,
  }));
  expect(snapshot(pending)).toEqual(snapshot(original!));
  expect(pending.version).toBe(original!.version + 1);
  expect(pending.revision).toBe(original!.revision);
  expect(pending.canWithdraw).toBe(true);
  expect(pending.canReview).toBe(false);
  const change = pending.changes.find((entry) => entry.id === pending.pendingChangeId)!;
  expect(change).toMatchObject({ reason, status: "PENDING", baseVersion: original!.version, reviewedBy: null, reviewedAt: null, before: snapshot(original!) });
  expect(change.after).toMatchObject({ supplierName: "Revised supplier", totalAmount: 235, deliveryAddress: "Revised delivery address", paymentTerms: "Net 45" });
  const unchanged = await getRequest(page, request.id);
  expect(unchanged.items).toEqual(request.items);
  expect(unchanged.totalAmount).toBe(request.totalAmount);
  expect(unchanged.receipts).toEqual(request.receipts);
});

test("independent approval synchronizes PR and PO commercial fields and records before and after details in Timeline", async ({ page }) => {
  const { request, orders: [original] } = await createIssued(page);
  const items = itemsOf(original!);
  items[0] = { ...items[0]!, quantity: 12, unitPrice: 11.25 };
  const reason = uniqueValue("Quotation-price-and-quantity-changed");
  const pending = await proposed(await propose(page, original!, { reason, items, note: "Approved revised quote" }));
  const audit = pending.changes[0]!;
  const approved = await approve(page, pending);
  expect(approved.poNumber).toBe(original!.poNumber);
  expect(approved.version).toBe(pending.version + 1);
  expect(approved.revision).toBe(original!.revision + 1);
  expect(approved.pendingChangeId).toBeNull();
  expect(approved.totalAmount).toBe(235);
  expect(approved.items[0]).toMatchObject({ id: original!.items[0]!.id, quantity: 12, unitPrice: 11.25, amount: 135 });
  expect(approved.changes[0]).toMatchObject({ status: "APPROVED", before: audit.before, after: audit.after, submittedBy: audit.submittedBy });
  expect(approved.changes[0]!.reviewedBy?.id).not.toBe(audit.submittedBy.id);
  expect(approved.changes[0]!.reviewedAt).toBeTruthy();
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(235);
  expect(source.items.find((item) => item.id === original!.items[0]!.purchaseRequestItemId)).toMatchObject({ quantity: 12, unitPrice: 11.25, amount: 135, receivedQuantity: 0, closedQuantity: 0 });
  expect(source.receivingItems.find((item) => item.id === receiptItemId(original!.items[0]!))).toMatchObject({ quantity: 12, unitPrice: 11.25, amount: 135, remainingQuantity: 12 });
  const timeline = source.approvals.filter((entry) => entry.stepLabel === "อนุมัติแก้ไข PO");
  expect(timeline).toHaveLength(1);
  expect(timeline[0]!.action).toBe("COMMENTED");
  for (const value of [original!.poNumber, reason, original!.items[0]!.itemName, "10.00", "11.25", "200.00", "235.00"]) {
    expect(timeline[0]!.comment).toContain(value);
  }
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.locator("main")).toContainText(reason);
  await expect(page.locator("main")).toContainText(original!.poNumber);
  await expect(page.locator("main")).toContainText("235.00");
});

test("rejection requires a reason and leaves the issued specification unchanged and editable", async ({ page }) => {
  const { orders: [original] } = await createIssued(page);
  const pending = await proposed(await propose(page, original!, { note: "A quote needing rejection" }));
  await authenticate(page, credentials.approver);
  for (const comment of [undefined, "   ", "abcd"]) await expectStatus(await review(page, pending, "REJECTED", comment), 400);
  const response = await review(page, pending, "REJECTED", "The supplier quote exceeds the approved budget");
  await expectStatus(response, 200);
  const rejected = await response.json() as PurchaseOrderDetail;
  expect(snapshot(rejected)).toEqual(snapshot(original!));
  expect(rejected.revision).toBe(original!.revision);
  expect(rejected.changes[0]).toMatchObject({ status: "REJECTED", reviewComment: "The supplier quote exceeds the approved budget" });
  await authenticate(page, credentials.purchasing);
  expect((await getOrder(page, original!.id)).canEdit).toBe(true);
});

test("the submitter can withdraw but cannot approve their own change", async ({ page }) => {
  const { orders: [original] } = await createIssued(page);
  const pending = await proposed(await propose(page, original!, { note: "Withdraw this proposed quote" }));
  await expectStatus(await review(page, pending, "APPROVED"), 403);
  const withdrawal = await review(page, pending, "REJECTED", "The supplier withdrew the proposed quotation");
  await expectStatus(withdrawal, 200);
  const withdrawn = await withdrawal.json() as PurchaseOrderDetail;
  expect(withdrawn.pendingChangeId).toBeNull();
  expect(withdrawn.changes[0]!.status).toBe("REJECTED");
  expect(withdrawn.changes[0]!.reviewedBy?.id).toBe(withdrawn.changes[0]!.submittedBy.id);
  expect(snapshot(withdrawn)).toEqual(snapshot(original!));
});

test("Admin self-approval is denied while Management can independently review the proposal", async ({ page }) => {
  const { orders: [original] } = await createIssued(page);
  await authenticate(page, credentials.admin);
  const pending = await proposed(await propose(page, original!, { note: "Administrator proposed this update" }));
  await expectStatus(await review(page, pending, "APPROVED"), 403);
  const approved = await approve(page, pending, credentials.management);
  expect(approved.changes[0]!.status).toBe("APPROVED");
  expect(approved.note).toBe("Administrator proposed this update");
});

test("requester and ordinary employee visibility does not grant PO editing or change approval", async ({ page }) => {
  const { orders: [original] } = await createIssued(page);
  const pending = await proposed(await propose(page, original!, { note: "Protected editing workflow" }));
  for (const account of [credentials.employee, credentials.employee2]) {
    await authenticate(page, account);
    await expectStatus(await propose(page, original!, { note: "Unauthorized edit" }), 403);
    await expectStatus(await review(page, pending, "APPROVED"), 403);
  }
  await authenticate(page, credentials.employee);
  const visible = await getOrder(page, original!.id);
  expect(visible.canEdit).toBe(false);
  expect(visible.canReview).toBe(false);
  await page.context().clearCookies();
  await expectStatus(await propose(page, original!), 401);
  await expectStatus(await review(page, pending, "APPROVED"), 401);
});

test("a change ID from another PO cannot be reviewed through an unrelated PO URL", async ({ page }) => {
  const { orders } = await createIssued(page, [10, 5], true);
  const pending = await proposed(await propose(page, orders[0]!, { note: "Only the first PO may use this change" }));
  await authenticate(page, credentials.approver);
  await expectStatus(await review(page, orders[1]!, "APPROVED", "Must not cross the PO boundary", orders[1]!.version, pending.pendingChangeId!), 404);
  expect((await getOrder(page, orders[0]!.id)).pendingChangeId).toBe(pending.pendingChangeId);
  expect((await getOrder(page, orders[1]!.id)).changes).toHaveLength(0);
});

test("stale proposals cannot overwrite a rejected revision cycle and fresh versions remain usable", async ({ page }) => {
  const { orders: [original] } = await createIssued(page);
  const pending = await proposed(await propose(page, original!, { note: "First version" }));
  await expectStatus(await review(page, pending, "REJECTED", "Withdraw before revising the proposal"), 200);
  const current = await getOrder(page, original!.id);
  await assertRejectedProposal(page, current, propose(page, original!, { note: "Stale editor" }), 409);
  const fresh = await proposed(await propose(page, current, { note: "Current editor version" }));
  expect(fresh.changes).toHaveLength(2);
});

test("simultaneous proposals create one pending change without duplicating snapshots", async ({ page }) => {
  const { orders: [original] } = await createIssued(page);
  const results = await Promise.all([propose(page, original!, { note: "Concurrent A" }), propose(page, original!, { note: "Concurrent B" })]);
  expect(results.map((response) => response.status()).sort()).toEqual([200, 409]);
  const current = await getOrder(page, original!.id);
  expect(current.changes).toHaveLength(1);
  expect(current.version).toBe(original!.version + 1);
  expect(snapshot(current)).toEqual(snapshot(original!));
});

test("competing approval and rejection commit exactly one decision and one revision outcome", async ({ page }) => {
  const { request, orders: [original] } = await createIssued(page, [10]);
  const pending = await proposed(await propose(page, original!, { items: [{ ...itemsOf(original!)[0]!, quantity: 12 }] }));
  await authenticate(page, credentials.approver);
  const [approval, rejection] = await Promise.all([
    review(page, pending, "APPROVED", "Approve the new quantity"), review(page, pending, "REJECTED", "The quantity increase is unnecessary"),
  ]);
  expect([approval.status(), rejection.status()].sort()).toEqual([200, 409]);
  const current = await getOrder(page, original!.id);
  expect(current.version).toBe(pending.version + 1);
  expect(current.pendingChangeId).toBeNull();
  expect(current.changes).toHaveLength(1);
  const accepted = approval.status() === 200;
  expect(current.revision).toBe(original!.revision + (accepted ? 1 : 0));
  expect(current.changes[0]!.status).toBe(accepted ? "APPROVED" : "REJECTED");
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(accepted ? 120 : 100);
  expect(source.items[0]).toMatchObject({ quantity: accepted ? 12 : 10, amount: accepted ? 120 : 100, receivedQuantity: 0, closedQuantity: 0 });
  expect(source.receivingItems[0]!.quantity).toBe(accepted ? 12 : 10);
});

test("approval adds and removes linked PR and PO lines while PO counters track receiving separately", async ({ page }) => {
  const { request, orders: [original] } = await createIssued(page);
  const removed = original!.items[0]!;
  const surviving = original!.items[1]!;
  const pending = await proposed(await propose(page, original!, { items: [
    itemsOf(original!)[1]!, { itemName: "New replacement item", description: "Added by the reviewed change", quantity: 3, unit: "ชุด", unitPrice: 7.25 },
  ] }));
  const approved = await approve(page, pending);
  expect(approved.items).toHaveLength(2);
  expect(approved.items.some((item) => item.id === removed.id)).toBe(false);
  expect(approved.items.find((item) => item.id === surviving.id)?.purchaseRequestItemId).toBe(surviving.purchaseRequestItemId);
  const added = approved.items.find((item) => item.itemName === "New replacement item")!;
  expect(added).toMatchObject({ quantity: 3, unitPrice: 7.25, amount: 21.75, receivedQuantity: 0, closedQuantity: 0 });
  expect(added.purchaseRequestItemId).toBeTruthy();
  expect(approved.totalAmount).toBe(121.75);
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(121.75);
  expect(source.items).toHaveLength(2);
  expect(source.items.some((item) => item.id === removed.purchaseRequestItemId)).toBe(false);
  expect(source.items.find((item) => item.id === added.purchaseRequestItemId)).toMatchObject({ itemName: added.itemName, quantity: 3, unitPrice: 7.25, amount: 21.75, receivedQuantity: 0, closedQuantity: 0 });
  expect(source.receivingItems.some((item) => item.id === receiptItemId(removed))).toBe(false);
  expect(source.receivingItems.find((item) => item.id === receiptItemId(added))).toMatchObject({ itemName: added.itemName, quantity: 3, unitPrice: 7.25 });
  const audit = source.approvals.find((entry) => entry.stepLabel === "อนุมัติแก้ไข PO")!;
  for (const value of [original!.poNumber, removed.itemName, added.itemName, "200.00", "121.75"]) expect(audit.comment).toContain(value);
  await authenticate(page);
  await expectStatus(await receive(page, source, [{ itemId: receiptItemId(added), quantity: 1 }]), 200);
  const received = await getRequest(page, request.id);
  expectSourceUnchanged(received, source);
  expect(received.receivingItems.find((item) => item.id === receiptItemId(added))).toMatchObject({ receivedQuantity: 1, remainingQuantity: 2 });
  expect(received.receipts[0]!.items).toContainEqual({ itemId: receiptItemId(added), itemName: added.itemName, quantity: 1 });
});

test("duplicate and foreign PO line IDs reject the whole proposal without changing either document", async ({ page }) => {
  const { orders } = await createIssued(page, [10, 5], true);
  const original = orders[0]!;
  const item = itemsOf(original)[0]!;
  await assertRejectedProposal(page, original, propose(page, original, { items: [item, item] }));
  await assertRejectedProposal(page, original, propose(page, original, { items: [itemsOf(orders[1]!)[0]!] }));
  expect(await getOrder(page, orders[1]!.id)).toEqual(orders[1]);
});

test("invalid reasons, fractional quantities and money precision never create a pending history entry", async ({ page }) => {
  const { orders: [original] } = await createIssued(page, [10]);
  const item = itemsOf(original!)[0]!;
  for (const extra of [
    { reason: "   " }, { reason: "abcd" }, { items: [] }, { items: [{ ...item, quantity: 0 }] },
    { items: [{ ...item, quantity: 1.5 }] }, { items: [{ ...item, unitPrice: -1 }] }, { items: [{ ...item, unitPrice: 1.234 }] },
    { items: [{ ...item, amount: 0 }] },
  ]) await assertRejectedProposal(page, original!, propose(page, original!, extra));
});

test("one pending PO change holds receipts on all supplier POs and blocks cancellation and completion", async ({ page }) => {
  const { request, orders } = await createIssued(page, [10, 5], true);
  await proposed(await propose(page, orders[0]!, { note: "Hold this PR while revised terms are reviewed" }));
  const heldRequest = await getRequest(page, request.id);
  await expectStatus(await receive(page, heldRequest, [{ itemId: receiptItemId(orders[1]!.items[0]!), quantity: 1 }]), 400);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/status`, {
    data: { action: "RECEIVED", receivedDate: "2026-10-22" },
  }), 400);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/cancellation`, {
    data: { action: "CANCEL", reason: "Cancellation must wait for the pending PO decision", cancellationReference: "PENDING-CHANGE-CANCEL" },
  }), 400);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
    data: { receiptNumber: "CANNOT-CLOSE-PENDING-CHANGE" },
  }), 400);
  const held = await getRequest(page, request.id);
  expect(held.status).toBe("ORDERED");
  expect(held.items).toEqual(request.items);
  expect(held.receipts).toEqual([]);
});

test("received item identity, description, unit, price and supplier identity cannot be changed or removed", async ({ page }) => {
  const { request, orders: [issued] } = await createIssued(page);
  const received = issued!.items[0]!;
  await expectStatus(await receive(page, request, [{ itemId: receiptItemId(received), quantity: 4 }]), 200);
  const original = await getOrder(page, issued!.id);
  const items = itemsOf(original);
  for (const changed of [
    { itemName: "Different identity" }, { description: "Different description" }, { unit: "กล่อง" }, { unitPrice: 99 }, { quantity: 3 },
  ]) await assertRejectedProposal(page, original, propose(page, original, { items: [{ ...items[0]!, ...changed }, items[1]!] }));
  await assertRejectedProposal(page, original, propose(page, original, { items: [items[1]!] }));
  await assertRejectedProposal(page, original, propose(page, original, { supplier: { supplierName: "A different supplier" } }));
  await assertRejectedProposal(page, original, propose(page, original, { supplier: { supplierName: original.supplierName, supplierTaxId: "DIFFERENT-TAX" } }));
});

test("received and closed quantities constrain revised PO lines and synchronize PR commercial fields without moving receipt counters", async ({ page }) => {
  const { request, orders: [issued] } = await createIssued(page);
  const first = issued!.items[0]!;
  await expectStatus(await receive(page, request, [{ itemId: receiptItemId(first), quantity: 4 }]), 200);
  const received = await getRequest(page, request.id);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipts`, { data: {
    action: "CLOSE_REMAINDER", expectedVersion: received.receiptVersion, items: [{ itemId: receiptItemId(first), quantity: 2 }], comment: "Two units will no longer be delivered",
  } }), 200);
  const original = await getOrder(page, issued!.id);
  const items = itemsOf(original);
  await assertRejectedProposal(page, original, propose(page, original, { items: [{ ...items[0]!, quantity: 5 }, items[1]!] }));
  const pending = await proposed(await propose(page, original, { items: [{ ...items[0]!, quantity: 12 }, items[1]!] }));
  const approved = await approve(page, pending);
  expect(approved.items.find((item) => item.id === first.id)).toMatchObject({ quantity: 12, receivedQuantity: 4, closedQuantity: 2 });
  const source = await getRequest(page, request.id);
  expect(source.totalAmount).toBe(220);
  expect(source.items.find((item) => item.id === first.purchaseRequestItemId)).toMatchObject({ quantity: 12, unitPrice: 10, amount: 120, receivedQuantity: 0, closedQuantity: 0 });
  expect(source.receivingItems.find((item) => item.id === receiptItemId(first))).toMatchObject({ quantity: 12, receivedQuantity: 4, closedQuantity: 2, remainingQuantity: 6 });
});

test("an unchanged overreceived quantity preserves the recorded excess when another PR item remains open", async ({ page }) => {
  const { request, orders: [issued] } = await createIssued(page, [10, 5]);
  const first = issued!.items[0]!;
  await expectStatus(await receive(page, request, [{ itemId: receiptItemId(first), quantity: 12 }], { overReceiptReason: "Supplier delivered two additional units" }), 200);
  const original = await getOrder(page, issued!.id);
  const items = itemsOf(original);
  for (const quantity of [9, 11]) await assertRejectedProposal(page, original, propose(page, original, { items: [{ ...items[0]!, quantity }, items[1]!] }));
  const pending = await proposed(await propose(page, original, { note: "Contact only; keep the recorded overreceipt" }));
  await approve(page, pending);
  const source = await getRequest(page, request.id);
  expectSourceUnchanged(source, {
    ...request,
    items: request.items.map((item) => ({ ...item, supplierName: original.supplierName })),
  });
  expect(source.receivingItems.find((item) => item.id === receiptItemId(first))).toMatchObject({ quantity: 10, receivedQuantity: 12, overReceivedQuantity: 2 });
});

test("fully settled and cancelled PRs cannot open new PO changes", async ({ page }) => {
  const settled = await createIssued(page, [10]);
  await expectStatus(await receive(page, settled.request, [{ itemId: receiptItemId(settled.orders[0]!.items[0]!), quantity: 10 }]), 200);
  const settledOrder = await getOrder(page, settled.orders[0]!.id);
  await assertRejectedProposal(page, settledOrder, propose(page, settledOrder, { note: "Too late to alter the completed receiving balance" }));
  const cancelled = await createIssued(page, [10]);
  await expectStatus(await page.request.post(`/api/purchase-requests/${cancelled.request.id}/cancellation`, {
    data: { action: "CANCEL", reason: "Supplier accepted cancellation before any goods arrived", cancellationReference: "CANCEL-BEFORE-PO-EDIT" },
  }), 200);
  const cancelledOrder = await getOrder(page, cancelled.orders[0]!.id);
  await assertRejectedProposal(page, cancelledOrder, propose(page, cancelledOrder, { note: "Cannot edit a cancelled purchase" }));
});

test("same registered supplier edits preserve the issued snapshot even after that master is changed and disabled", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page, "issued");
  const { orders: [original] } = await createIssued(page, [10], false, supplier);
  const response = await page.request.patch(`/api/suppliers/${supplier.id}`, { data: {
    name: "Master changed after issuance", taxId: "NEW-MASTER-TAX", address: "New master address", contactPerson: "New master contact", paymentTerms: "Cash",
    note: "Changed master", contacts: [{ channel: "PHONE", value: "0899999999" }], isActive: false, expectedVersion: supplier.version,
  } });
  await expectStatus(response, 200);
  const disabled = await response.json() as SupplierDetail;
  const pending = await proposed(await propose(page, original!, { note: "Keep issued supplier details" }));
  expect(pending.changes[0]!.after).toMatchObject({ supplierId: supplier.id, supplierName: original!.supplierName, supplierTaxId: original!.supplierTaxId, supplierAddress: original!.supplierAddress, supplierContacts: original!.supplierContacts });
  const approved = await approve(page, pending);
  expect(approved.supplierName).toBe(original!.supplierName);
  await authenticate(page, credentials.purchasing);
  const freshMaster = await page.request.get(`/api/suppliers/${supplier.id}`);
  await expectStatus(freshMaster, 200);
  expect(await freshMaster.json()).toEqual(disabled);
});

test("an active new registered supplier can replace an unreceived PO supplier without mutating the master", async ({ page }) => {
  const { orders: [original] } = await createIssued(page, [10]);
  const supplier = await createSupplier(page, "replacement");
  const pending = await proposed(await propose(page, original!, { supplier: { supplierId: supplier.id } }));
  const approved = await approve(page, pending);
  expect(approved).toMatchObject({ supplierId: supplier.id, supplierName: supplier.name, supplierTaxId: supplier.taxId, supplierAddress: supplier.address, supplierContacts: supplier.contacts });
  await authenticate(page, credentials.purchasing);
  const master = await page.request.get(`/api/suppliers/${supplier.id}`);
  await expectStatus(master, 200);
  expect(await master.json()).toEqual(supplier);
});

test("a proposal racing a receipt commits only a valid quantity floor or a pending hold", async ({ page }) => {
  const { request, orders: [original] } = await createIssued(page, [10]);
  const [change, receipt] = await Promise.all([
    propose(page, original!, { items: [{ ...itemsOf(original!)[0]!, quantity: 2 }] }),
    receive(page, request, [{ itemId: receiptItemId(original!.items[0]!), quantity: 4 }]),
  ]);
  expect([change.status(), receipt.status()].filter((status) => status === 200)).toHaveLength(1);
  expect([400, 409]).toContain(change.status() === 200 ? receipt.status() : change.status());
  const source = await getRequest(page, request.id);
  const current = await getOrder(page, original!.id);
  if (change.status() === 200) {
    expect(current.pendingChangeId).toBeTruthy();
    expect(source.receipts).toHaveLength(0);
    expect(source.receivingItems[0]!.receivedQuantity).toBe(0);
  } else {
    expect(current.pendingChangeId).toBeNull();
    expect(current.changes).toHaveLength(0);
    expect(source.receivingItems[0]!.receivedQuantity).toBe(4);
  }
  expectSourceUnchanged(source, request);
});

test("a reason without any specification change cannot create a pending amendment or hold receiving", async ({ page }) => {
  const { request, orders: [original] } = await createIssued(page, [10]);
  await assertRejectedProposal(page, original!, propose(page, original!));
  const unchanged = await getRequest(page, request.id);
  expect(unchanged.receiptVersion).toBe(request.receiptVersion);
  expect(unchanged.approvals).toEqual(request.approvals);
  await expectStatus(await receive(page, unchanged, [{ itemId: receiptItemId(original!.items[0]!), quantity: 1 }]), 200);
});

test("reducing a partial order to its received quantity settles the PR on the actual receipt date and permits finalization", async ({ page }) => {
  const { request, orders: [original] } = await createIssued(page, [10]);
  await expectStatus(await receive(page, request, [{ itemId: receiptItemId(original!.items[0]!), quantity: 4 }], { receiptNumber: "RCV-REDUCED-ORDER" }), 200);
  const received = await getRequest(page, request.id);
  const order = await getOrder(page, original!.id);
  const pending = await proposed(await propose(page, order, { items: [{ ...itemsOf(order)[0]!, quantity: 4 }] }));
  const approved = await approve(page, pending);
  expect(approved.items[0]).toMatchObject({ quantity: 4, receivedQuantity: 4, amount: 40 });
  expect(approved.canEdit).toBe(false);
  const settled = await getRequest(page, request.id);
  expect(settled.receivedAt).toBe(receivedDate);
  expect(settled.totalAmount).toBe(40);
  expect(settled.items[0]).toMatchObject({ quantity: 4, unitPrice: 10, amount: 40, remainingQuantity: 4, receivedQuantity: 0, closedQuantity: 0 });
  expect(settled.receivingItems[0]).toMatchObject({ quantity: 4, remainingQuantity: 0, receivedQuantity: 4, overReceivedQuantity: 0 });
  expect(settled.receipts).toEqual(received.receipts);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
    data: { expectedVersion: settled.receiptVersion, receiptNumber: "RCV-REDUCED-ORDER", taxInvoiceNumber: "TAX-REDUCED-ORDER" },
  }), 200);
  expect((await getRequest(page, request.id)).status).toBe("COMPLETED");
  expect((await getOrder(page, order.id)).purchaseRequest.status).toBe("COMPLETED");
});

test("received registered PO contact and header overrides are reviewed without altering its supplier master or receipt history", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page, "contact-override");
  const { request, orders: [original] } = await createIssued(page, [10], false, supplier);
  await expectStatus(await receive(page, request, [{ itemId: receiptItemId(original!.items[0]!), quantity: 1 }]), 200);
  const received = await getRequest(page, request.id);
  const order = await getOrder(page, original!.id);
  const contacts = [{ channel: "PHONE", value: "0812345678" }];
  const pending = await proposed(await propose(page, order, {
    supplier: { supplierId: supplier.id, supplierAddress: "PO delivery office", supplierContactPerson: "PO-specific contact", supplierContact: "Extension 123", supplierContacts: contacts },
    paymentTerms: "Net 60 for this order", deliveryAddress: "Revised receiving desk", expectedDeliveryDate: "2026-11-20",
  }));
  const approved = await approve(page, pending);
  expect(approved).toMatchObject({
    supplierId: supplier.id, supplierName: supplier.name, supplierTaxId: supplier.taxId,
    supplierAddress: "PO delivery office", supplierContactPerson: "PO-specific contact", supplierContact: "Extension 123", supplierContacts: contacts,
    paymentTerms: "Net 60 for this order", deliveryAddress: "Revised receiving desk", expectedDeliveryDate: "2026-11-20",
  });
  expect(approved.totalAmount).toBe(original!.totalAmount);
  expect((await getRequest(page, request.id)).receipts).toEqual(received.receipts);
  await authenticate(page, credentials.purchasing);
  const master = await page.request.get(`/api/suppliers/${supplier.id}`);
  await expectStatus(master, 200);
  expect(await master.json()).toEqual(supplier);
});

test("a replacement supplier disabled during review prevents approval atomically and rejection releases the receiving hold", async ({ page }) => {
  const { request, orders: [original] } = await createIssued(page, [10]);
  const supplier = await createSupplier(page, "disabled-during-review");
  const pending = await proposed(await propose(page, original!, { supplier: { supplierId: supplier.id } }));
  await expectStatus(await page.request.patch(`/api/suppliers/${supplier.id}`, { data: {
    name: supplier.name, taxId: supplier.taxId, address: supplier.address, contactPerson: supplier.contactPerson,
    paymentTerms: supplier.paymentTerms, contacts: supplier.contacts, expectedVersion: supplier.version, isActive: false,
  } }), 200);
  await authenticate(page, credentials.approver);
  const before = await getOrder(page, original!.id);
  const sourceBefore = await getRequest(page, request.id);
  await expectStatus(await review(page, pending, "APPROVED", "Recheck supplier activation before applying"), 400);
  expect(await getOrder(page, original!.id)).toEqual(before);
  expect(await getRequest(page, request.id)).toEqual(sourceBefore);
  await expectStatus(await review(page, pending, "REJECTED", "The proposed replacement supplier is inactive"), 200);
  await authenticate(page, credentials.purchasing);
  const current = await getOrder(page, original!.id);
  expect(snapshot(current)).toEqual(snapshot(original!));
  for (const supplierId of [supplier.id, "nonexistent-replacement-supplier"]) {
    await assertRejectedProposal(page, current, propose(page, current, { supplier: { supplierId } }));
  }
  const released = await getRequest(page, request.id);
  await expectStatus(await receive(page, released, [{ itemId: receiptItemId(original!.items[0]!), quantity: 1 }]), 200);
});

test("a late combined PR total overflow rolls back every PO, PR line and Timeline update", async ({ page }) => {
  const { request, orders } = await createIssued(page, [10, 5], true);
  const pendingFirst = await proposed(await propose(page, orders[0]!, { items: [{ ...itemsOf(orders[0]!)[0]!, quantity: 1, unitPrice: 6000000000 }] }));
  const pendingSecond = await proposed(await propose(page, orders[1]!, { items: [{ ...itemsOf(orders[1]!)[0]!, quantity: 1, unitPrice: 6000000000 }] }));
  await approve(page, pendingFirst);
  const beforeOrders = await Promise.all(orders.map((order) => getOrder(page, order.id)));
  const beforeRequest = await getRequest(page, request.id);
  expect(beforeRequest.totalAmount).toBe(6000000100);
  await expectStatus(await review(page, pendingSecond, "APPROVED", "The combined PR total must remain within its monetary limit"), 400);
  expect(await Promise.all(orders.map((order) => getOrder(page, order.id)))).toEqual(beforeOrders);
  expect(await getRequest(page, request.id)).toEqual(beforeRequest);
});

test("existing pending changes remain reviewable after another supplier PO revision settles the whole PR", async ({ page }) => {
  const { request, orders } = await createIssued(page, [10, 5], true);
  await expectStatus(await receive(page, request, [
    { itemId: receiptItemId(orders[0]!.items[0]!), quantity: 4 },
    { itemId: receiptItemId(orders[1]!.items[0]!), quantity: 5 },
  ]), 200);
  const first = await getOrder(page, orders[0]!.id);
  const second = await getOrder(page, orders[1]!.id);
  const pendingFirst = await proposed(await propose(page, first, { items: [{ ...itemsOf(first)[0]!, quantity: 4 }] }));
  const pendingSecond = await proposed(await propose(page, second, { note: "Header change submitted before settlement" }));
  await approve(page, pendingFirst);
  const settled = await getRequest(page, request.id);
  expect(settled.receivedAt).toBe(receivedDate);
  expect(settled.totalAmount).toBe(140);
  expect(settled.items.find((item) => item.id === first.items[0]!.purchaseRequestItemId)).toMatchObject({ quantity: 4, amount: 40, receivedQuantity: 0, closedQuantity: 0 });
  expect(settled.receivingItems.every((item) => item.remainingQuantity === 0)).toBe(true);
  const remaining = await getOrder(page, second.id);
  expect(remaining.canReview).toBe(true);
  expect(remaining.canEdit).toBe(false);
  await expectStatus(await review(page, remaining, "APPROVED", "Review the existing header change after settlement"), 200);
  const done = await getOrder(page, second.id);
  expect(done.pendingChangeId).toBeNull();
  expect(done.note).toBe("Header change submitted before settlement");
  expect(done.changes[0]!.id).toBe(pendingSecond.pendingChangeId);
  await authenticate(page, credentials.purchasing);
  await assertRejectedProposal(page, await getOrder(page, second.id), propose(page, done, { note: "New proposals are disallowed after full settlement" }));
  const final = await getRequest(page, request.id);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
    data: { expectedVersion: final.receiptVersion, receiptNumber: "RCV-ALL-PENDING-REVIEWED" },
  }), 200);
  expect((await getRequest(page, request.id)).status).toBe("COMPLETED");
});

test("Purchasing submits a quantity amendment and its approver reviews the English history in the browser", async ({ page }) => {
  const { orders: [original] } = await createIssued(page, [10]);
  await page.goto(`/purchase-orders/${original!.id}`);
  await page.locator("#edit-purchase-order").click();
  await page.locator("#po-edit-item-quantity-0").fill("12");
  const reason = uniqueValue("Browser-PO-amendment");
  await page.locator("#po-edit-reason").fill(reason);
  const submission = page.waitForResponse((response) => response.url().endsWith(`/api/purchase-orders/${original!.id}`) && response.request().method() === "PATCH");
  await page.locator("#save-po-changes").click();
  await expectStatus(await submission, 200);
  await expect(page).toHaveURL(new RegExp(`/purchase-orders/${original!.id}$`));
  await expect(page.locator("main")).toContainText(reason);
  await authenticate(page, credentials.approver);
  await page.goto(`/purchase-orders/${original!.id}`);
  await page.getByRole("button", { name: "ภาษา: English" }).click();
  await expect(page.getByRole("heading", { name: "PO change history", exact: true })).toBeVisible();
  await expect(page.locator("#approve-po-change")).toHaveText("Approve PO changes");
  await page.locator("#po-review-comment").fill("Approved after checking the amended quantity");
  const decision = page.waitForResponse((response) => response.url().includes(`/purchase-orders/${original!.id}/changes/`) && response.url().endsWith("/review") && response.request().method() === "POST");
  await page.locator("#approve-po-change").click();
  await expectStatus(await decision, 200);
  await expect(page.locator("main")).toContainText(reason);
  await expect(page.locator("main")).toContainText("Approved after checking the amended quantity");
  expect((await getOrder(page, original!.id)).items[0]!.quantity).toBe(12);
});
