import { expect, test, type APIResponse, type Page } from "@playwright/test";

import type { PurchaseRequestDetail } from "../../src/lib/types";
import {
  authenticate,
  createOrderedRequest,
  expectStatus,
  getRequest,
  receive,
  receivedDate,
} from "./receipt-support";
import { createRequestViaApi, credentials } from "./support";

type ReceiptLine = { itemId: string; quantity: number };

function receiptState(request: PurchaseRequestDetail) {
  return {
    receiptVersion: request.receiptVersion,
    status: request.status,
    receivedAt: request.receivedAt,
    completedAt: request.completedAt,
    receiptNumber: request.receiptNumber,
    taxInvoiceNumber: request.taxInvoiceNumber,
    updatedAt: request.updatedAt,
    items: [...request.items].sort((left, right) => left.id.localeCompare(right.id)),
    receipts: request.receipts,
    approvals: request.approvals,
  };
}

async function rejectWithoutChanges(
  page: Page,
  before: PurchaseRequestDetail,
  mutation: Promise<APIResponse>,
  status = 400,
) {
  await expectStatus(await mutation, status);
  expect(receiptState(await getRequest(page, before.id))).toEqual(receiptState(before));
}

function closeRemainder(
  page: Page,
  request: PurchaseRequestDetail,
  items: ReceiptLine[],
  comment: string,
) {
  return page.request.post(`/api/purchase-requests/${request.id}/receipts`, {
    data: {
      action: "CLOSE_REMAINDER",
      expectedVersion: request.receiptVersion,
      items,
      comment,
    },
  });
}

test("a foreign item after a valid item leaves both PRs and receipt audits unchanged", async ({ page }) => {
  await authenticate(page);
  const request = await createOrderedRequest(page);
  const other = await createRequestViaApi(page);
  const otherRequest = await getRequest(page, other.id);

  await rejectWithoutChanges(page, request, receive(page, request, [
    { itemId: request.items[0]!.id, quantity: 40 },
    { itemId: otherRequest.items[0]!.id, quantity: 1 },
  ], { receiptNumber: "MUST-NOT-COMMIT-FOREIGN-ITEM" }));
  expect(receiptState(await getRequest(page, other.id))).toEqual(receiptState(otherRequest));
});

test("a later overreceipt without a reason rolls back the entire mixed delivery", async ({ page }) => {
  await authenticate(page);
  const request = await createOrderedRequest(page);
  await rejectWithoutChanges(page, request, receive(page, request, [
    { itemId: request.items[0]!.id, quantity: 40 },
    { itemId: request.items[1]!.id, quantity: 11 },
  ], {
    comment: "Neither item may be committed if the later item needs an overreceipt reason",
    receiptNumber: "MUST-NOT-COMMIT-OVERRECEIPT",
    taxInvoiceNumber: "MUST-NOT-COMMIT-TAX",
  }));
});

test("an excessive second closure rolls back a valid first closure and its audit", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page);
  await expectStatus(await receive(page, request, [
    { itemId: request.items[0]!.id, quantity: 40 },
    { itemId: request.items[1]!.id, quantity: 3 },
  ], { receiptNumber: "RCV-BEFORE-ATOMIC-CLOSURE" }), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);

  await rejectWithoutChanges(page, request, closeRemainder(page, request, [
    { itemId: request.items[0]!.id, quantity: 60 },
    { itemId: request.items[1]!.id, quantity: 8 },
  ], "The second item has only seven units left to close"));
});

test("a later locked item cannot partially commit a valid delivery on another item", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page);
  const [first, second] = request.items;
  await expectStatus(await receive(page, request, [
    { itemId: first!.id, quantity: 10 },
    { itemId: second!.id, quantity: 2 },
  ]), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await closeRemainder(page, request, [
    { itemId: second!.id, quantity: 5 },
  ], "Five units will not be delivered"), 200);
  request = await getRequest(page, request.id);
  await authenticate(page);

  await rejectWithoutChanges(page, request, receive(page, request, [
    { itemId: first!.id, quantity: 5 },
    { itemId: second!.id, quantity: 4 },
  ], { overReceiptReason: "A reason must not unlock quantities already closed" }));
});

test("cumulative receipt quantities allow the Int maximum and reject overflow atomically", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 2_147_483_640 }], {
    overReceiptReason: "Boundary delivery approaching the supported quantity maximum",
  }), 200);
  request = await getRequest(page, request.id);
  await rejectWithoutChanges(page, request, receive(page, request, [{ itemId, quantity: 8 }], {
    overReceiptReason: "This cumulative quantity exceeds the database Int maximum",
  }));

  await expectStatus(await receive(page, request, [{ itemId, quantity: 7 }], {
    overReceiptReason: "Exactly the supported cumulative maximum",
  }), 200);
  request = await getRequest(page, request.id);
  expect(request.items[0]).toMatchObject({
    quantity: 100,
    receivedQuantity: 2_147_483_647,
    remainingQuantity: 0,
    overReceivedQuantity: 2_147_483_547,
  });
  await rejectWithoutChanges(page, request, receive(page, request, [{ itemId, quantity: 1 }], {
    overReceiptReason: "One more unit cannot overflow the persisted cumulative quantity",
  }));
});

test("overreceipt reasons enforce trimmed minimum and maximum lengths without consuming a version", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [1]);
  const items = [{ itemId: request.items[0]!.id, quantity: 2 }];
  for (const overReceiptReason of ["     ", "  abcd  ", "x".repeat(2001)]) {
    await rejectWithoutChanges(page, request, receive(page, request, items, { overReceiptReason }));
  }
  await expectStatus(await receive(page, request, items, { overReceiptReason: "  abcde  " }), 200);
  request = await getRequest(page, request.id);
  expect(request.receipts[0]!.overReceiptReason).toBe("abcde");
  const maximumReason = "x".repeat(2000);
  await expectStatus(await receive(page, request, [{ itemId: items[0]!.itemId, quantity: 1 }], {
    overReceiptReason: `  ${maximumReason}  `,
  }), 200);
  request = await getRequest(page, request.id);
  expect(request.receipts[1]!.overReceiptReason).toBe(maximumReason);
});

test("closure reasons enforce trimmed boundaries and keep each accepted reason in history", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }]), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  for (const comment of ["     ", "  abcd  ", "x".repeat(2001)]) {
    await rejectWithoutChanges(page, request, closeRemainder(page, request, [{ itemId, quantity: 1 }], comment));
  }
  await expectStatus(await closeRemainder(page, request, [{ itemId, quantity: 1 }], "  abcde  "), 200);
  request = await getRequest(page, request.id);
  const maximumReason = "x".repeat(2000);
  await expectStatus(await closeRemainder(page, request, [{ itemId, quantity: 1 }], `  ${maximumReason}  `), 200);
  request = await getRequest(page, request.id);
  expect(request.items[0]).toMatchObject({ receivedQuantity: 40, closedQuantity: 2, remainingQuantity: 58 });
  expect(request.receipts.filter((receipt) => receipt.action === "CLOSE_REMAINDER").map((receipt) => receipt.comment))
    .toEqual(["abcde", maximumReason]);
});

test("an existing overreceipt does not require a reason or alter totals when another item arrives normally", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page);
  const [first, second] = request.items;
  await expectStatus(await receive(page, request, [
    { itemId: first!.id, quantity: 105 },
    { itemId: second!.id, quantity: 3 },
  ], { overReceiptReason: "The first item includes five extra supplier units" }), 200);
  request = await getRequest(page, request.id);
  expect(request.receivedAt).toBeNull();
  await expectStatus(await receive(page, request, [{ itemId: second!.id, quantity: 7 }]), 200);
  request = await getRequest(page, request.id);
  expect(request.items).toEqual([
    expect.objectContaining({ id: first!.id, quantity: 100, receivedQuantity: 105, overReceivedQuantity: 5, remainingQuantity: 0 }),
    expect.objectContaining({ id: second!.id, quantity: 10, receivedQuantity: 10, overReceivedQuantity: 0, remainingQuantity: 0 }),
  ]);
  expect(request.receipts[1]).toMatchObject({
    overReceiptReason: null,
    items: [expect.objectContaining({ itemId: second!.id, quantity: 7 })],
  });
  expect(request.receivedAt).toBe(receivedDate);
});

test("invalid calendar dates never normalize silently and a real leap day is preserved", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [1]);
  const items = [{ itemId: request.items[0]!.id, quantity: 1 }];
  for (const invalidDate of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-10-20T00:00:00Z"]) {
    await rejectWithoutChanges(page, request, receive(page, request, items, { receivedDate: invalidDate }));
  }
  await expectStatus(await receive(page, request, items, { receivedDate: "2024-02-29" }), 200);
  request = await getRequest(page, request.id);
  expect(request.receivedAt).toBe("2024-02-29");
  expect(request.receipts[0]!.receivedDate).toBe("2024-02-29");
});

test("partially closing a remainder still permits its exact open balance to arrive later", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }]), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await closeRemainder(page, request, [{ itemId, quantity: 20 }], "Only twenty units will not be delivered"), 200);
  request = await getRequest(page, request.id);
  expect(request.items[0]).toMatchObject({ receivedQuantity: 40, closedQuantity: 20, remainingQuantity: 40 });
  expect(request.receivedAt).toBeNull();
  await authenticate(page);
  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }], { receivedDate: "2026-10-21" }), 200);
  request = await getRequest(page, request.id);
  expect(request.items[0]).toMatchObject({ quantity: 100, receivedQuantity: 80, closedQuantity: 20, remainingQuantity: 0, overReceivedQuantity: 0 });
  expect(request.receivedAt).toBe("2026-10-21");
  expect(request.receipts.map((receipt) => receipt.action)).toEqual(["RECEIVED", "CLOSE_REMAINDER", "RECEIVED"]);
  await rejectWithoutChanges(page, request, receive(page, request, [{ itemId, quantity: 1 }], {
    overReceiptReason: "Receiving beyond the open balance must not undo the closed quantity",
  }));
});

test("future or malformed versions cannot reserve quantities and the current version remains usable", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const items = [{ itemId: request.items[0]!.id, quantity: 40 }];
  for (const expectedVersion of [-1, 0.5, "0", null]) {
    await rejectWithoutChanges(page, request, receive(page, request, items, { expectedVersion }));
  }
  for (const expectedVersion of [request.receiptVersion + 1, Number.MAX_SAFE_INTEGER]) {
    await rejectWithoutChanges(page, request, receive(page, request, items, { expectedVersion }), 409);
  }
  await expectStatus(await receive(page, request, items), 200);
  request = await getRequest(page, request.id);
  expect(request.receiptVersion).toBe(1);
  expect(request.items[0]!.receivedQuantity).toBe(40);
  expect(request.receipts).toHaveLength(1);
});
