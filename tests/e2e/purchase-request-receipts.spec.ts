import { expect, test } from "@playwright/test";

import { createRequestViaApi, credentials, uniqueValue } from "./support";
import {
  authenticate,
  createOrderedRequest,
  expectStatus,
  getRequest,
  receive,
  receivedDate,
} from "./receipt-support";

test("partial receipts track each item across rounds and block early completion", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page);
  const [first, second] = request.items;
  const firstRoundComment = uniqueValue("First-delivery");
  await expectStatus(
    await receive(
      page,
      request,
      [
        { itemId: first!.id, quantity: 40 },
        { itemId: second!.id, quantity: 10 },
      ],
      { comment: firstRoundComment, receiptNumber: "RCV-PARTIAL-1" },
    ),
    200,
  );

  request = await getRequest(page, request.id);
  expect(request.status).toBe("ORDERED");
  expect(request.receivedAt).toBeNull();
  expect(request.completedAt).toBeNull();
  expect(request.receiptVersion).toBe(1);
  expect(request.items).toEqual([
    expect.objectContaining({
      id: first!.id,
      quantity: 100,
      receivedQuantity: 40,
      closedQuantity: 0,
      remainingQuantity: 60,
      overReceivedQuantity: 0,
    }),
    expect.objectContaining({
      id: second!.id,
      quantity: 10,
      receivedQuantity: 10,
      remainingQuantity: 0,
    }),
  ]);
  expect(request.receipts).toEqual([
    expect.objectContaining({
      action: "RECEIVED",
      receivedDate,
      comment: firstRoundComment,
      receiptNumber: "RCV-PARTIAL-1",
      recordedBy: expect.objectContaining({ id: request.requester.id }),
      items: expect.arrayContaining([
        expect.objectContaining({ itemId: first!.id, quantity: 40 }),
        expect.objectContaining({ itemId: second!.id, quantity: 10 }),
      ]),
    }),
  ]);

  await authenticate(page, credentials.purchasing);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { receiptNumber: "CANNOT-CLOSE-WITH-60-OUTSTANDING" },
    }),
    400,
  );
  await authenticate(page, credentials.employee);
  const secondRoundComment = uniqueValue("Final-delivery");
  await expectStatus(
    await receive(page, request, [{ itemId: first!.id, quantity: 60 }], {
      comment: secondRoundComment,
    }),
    200,
  );
  request = await getRequest(page, request.id);
  expect(request.receiptVersion).toBe(2);
  expect(request.receivedAt).toBe(receivedDate);
  expect(request.items.every((item) => item.remainingQuantity === 0)).toBe(true);
  expect(request.receipts).toHaveLength(2);
  expect(request.receipts).toContainEqual(
    expect.objectContaining({
      comment: secondRoundComment,
      items: [expect.objectContaining({ itemId: first!.id, quantity: 60 })],
    }),
  );

  await authenticate(page, credentials.purchasing);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { receiptNumber: "RCV-PARTIAL-2", taxInvoiceNumber: "TAX-PARTIAL-2" },
    }),
    200,
  );
  request = await getRequest(page, request.id);
  expect(request.status).toBe("COMPLETED");
  expect(request.completedAt).toBeTruthy();
  expect(request.receipts).toContainEqual(
    expect.objectContaining({ comment: firstRoundComment, receiptNumber: "RCV-PARTIAL-1" }),
  );
  expect(request.receipts).toContainEqual(
    expect.objectContaining({
      comment: secondRoundComment,
      receiptNumber: "RCV-PARTIAL-2",
      taxInvoiceNumber: "TAX-PARTIAL-2",
    }),
  );
});

test("all receipt rounds need documents and Purchasing can update each round", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }]), 200);
  request = await getRequest(page, request.id);
  const firstReceiptId = request.receipts[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 60 }]), 200);

  await expectStatus(
    await page.request.post(
      `/api/purchase-requests/${request.id}/receipts/${firstReceiptId}/references`,
      { data: { receiptNumber: "EMPLOYEE-MUST-NOT-CHANGE-DOCUMENTS" } },
    ),
    403,
  );
  await authenticate(page, credentials.purchasing);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { receiptNumber: "RCV-SECOND-ROUND" },
    }),
    400,
  );
  request = await getRequest(page, request.id);
  expect(request.status).toBe("ORDERED");
  expect(request.completedAt).toBeNull();

  await expectStatus(
    await page.request.post(
      `/api/purchase-requests/${request.id}/receipts/${firstReceiptId}/references`,
      { data: { taxInvoiceNumber: "TAX-FIRST-ROUND", note: "First delivery invoice" } },
    ),
    200,
  );
  request = await getRequest(page, request.id);
  expect(request.status).toBe("ORDERED");
  expect(request.receipts).toContainEqual(
    expect.objectContaining({ id: firstReceiptId, taxInvoiceNumber: "TAX-FIRST-ROUND" }),
  );
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { receiptNumber: "RCV-SECOND-ROUND" },
    }),
    200,
  );
  const completed = await getRequest(page, request.id);
  expect(completed.status).toBe("COMPLETED");
  const latestReceipt = completed.receipts[completed.receipts.length - 1]!;
  const latestReferencesEndpoint = `/api/purchase-requests/${request.id}/receipts/${latestReceipt.id}/references`;
  await expectStatus(
    await page.request.post(latestReferencesEndpoint, {
      data: {
        receiptNumber: "RCV-SECOND-ROUND-REVISED",
        expectedVersion: completed.receiptVersion,
      },
    }),
    200,
  );
  const revised = await getRequest(page, request.id);
  expect(revised.receiptNumber).toBe("RCV-SECOND-ROUND-REVISED");
  expect(revised.receipts).toContainEqual(
    expect.objectContaining({ id: latestReceipt.id, receiptNumber: "RCV-SECOND-ROUND-REVISED" }),
  );
  await expectStatus(
    await page.request.post(latestReferencesEndpoint, {
      data: {
        receiptNumber: "STALE-EDIT-MUST-NOT-REPLACE-REVISED-REFERENCE",
        expectedVersion: completed.receiptVersion,
      },
    }),
    409,
  );
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: {
        receiptNumber: revised.receiptNumber,
        expectedVersion: revised.receiptVersion,
      },
    }),
    200,
  );
  const afterUnchangedFinalization = await getRequest(page, request.id);
  expect(afterUnchangedFinalization.status).toBe("COMPLETED");
  expect(afterUnchangedFinalization.receiptNumber).toBe("RCV-SECOND-ROUND-REVISED");
  expect(afterUnchangedFinalization.receipts).toEqual(revised.receipts);
});

test("overreceipts need a reason even after the ordered quantity is fully received", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 100 }]), 200);
  request = await getRequest(page, request.id);
  await expectStatus(await receive(page, request, [{ itemId, quantity: 5 }]), 400);
  const afterRejected = await getRequest(page, request.id);
  expect(afterRejected.receiptVersion).toBe(request.receiptVersion);
  expect(afterRejected.receipts).toHaveLength(1);
  expect(afterRejected.items[0]!.receivedQuantity).toBe(100);

  const reason = uniqueValue("Supplier-delivered-extra");
  await expectStatus(
    await receive(page, request, [{ itemId, quantity: 5 }], {
      overReceiptReason: reason,
    }),
    200,
  );
  request = await getRequest(page, request.id);
  expect(request.items[0]).toMatchObject({
    quantity: 100,
    receivedQuantity: 105,
    closedQuantity: 0,
    remainingQuantity: 0,
    overReceivedQuantity: 5,
  });
  expect(request.receipts).toContainEqual(
    expect.objectContaining({
      overReceiptReason: reason,
      items: [expect.objectContaining({ itemId, quantity: 5 })],
    }),
  );
});

test("Purchasing can close unreceived quantities with an audited reason", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page);
  const [first, second] = request.items;
  await expectStatus(
    await receive(page, request, [{ itemId: first!.id, quantity: 40 }], {
      receiptNumber: "RCV-CLOSE-REMAINDER",
    }),
    200,
  );
  request = await getRequest(page, request.id);
  const closure = {
    action: "CLOSE_REMAINDER",
    expectedVersion: request.receiptVersion,
    items: [
      { itemId: first!.id, quantity: 60 },
      { itemId: second!.id, quantity: 10 },
    ],
    comment: uniqueValue("Supplier-cannot-deliver-remainder"),
  };
  const endpoint = `/api/purchase-requests/${request.id}/receipts`;
  await expectStatus(await page.request.post(endpoint, { data: closure }), 403);

  await authenticate(page, credentials.purchasing);
  await expectStatus(
    await page.request.post(endpoint, { data: { ...closure, comment: "" } }),
    400,
  );
  await expectStatus(
    await page.request.post(endpoint, {
      data: { ...closure, items: [{ itemId: first!.id, quantity: 61 }] },
    }),
    400,
  );
  await expectStatus(await page.request.post(endpoint, { data: closure }), 200);
  request = await getRequest(page, request.id);
  expect(request.status).toBe("ORDERED");
  expect(request.receivedAt).toBe(receivedDate);
  expect(request.items).toEqual([
    expect.objectContaining({
      id: first!.id,
      quantity: 100,
      receivedQuantity: 40,
      closedQuantity: 60,
      remainingQuantity: 0,
      overReceivedQuantity: 0,
    }),
    expect.objectContaining({
      id: second!.id,
      quantity: 10,
      receivedQuantity: 0,
      closedQuantity: 10,
      remainingQuantity: 0,
    }),
  ]);
  const closureRecord = request.receipts.find((receipt) => receipt.action === "CLOSE_REMAINDER");
  expect(closureRecord).toMatchObject({
    comment: closure.comment,
    recordedBy: { id: expect.any(String), name: expect.any(String) },
    items: expect.arrayContaining([
      expect.objectContaining({ itemId: first!.id, quantity: 60 }),
      expect.objectContaining({ itemId: second!.id, quantity: 10 }),
    ]),
  });
  expect(closureRecord!.recordedBy.id).not.toBe(request.requester.id);

  await expectStatus(
    await receive(page, request, [{ itemId: first!.id, quantity: 1 }], {
      overReceiptReason: "A closed remainder cannot be received again",
    }),
    400,
  );
  await expectStatus(
    await page.request.post(endpoint, {
      data: { ...closure, expectedVersion: request.receiptVersion },
    }),
    400,
  );
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { receiptNumber: "RCV-CLOSE-REMAINDER" },
    }),
    200,
  );
  request = await getRequest(page, request.id);
  expect(request.status).toBe("COMPLETED");
  expect(request.items[0]!.receivedQuantity).toBe(40);
  expect(request.items[0]!.closedQuantity).toBe(60);
});

test("concurrent receipt writes accept one version and reject stale replay", async ({
  page,
}) => {
  await authenticate(page);
  const request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  const responses = await Promise.all([
    receive(page, request, [{ itemId, quantity: 40 }], { comment: "Concurrent delivery A" }),
    receive(page, request, [{ itemId, quantity: 30 }], { comment: "Concurrent delivery B" }),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
  const updated = await getRequest(page, request.id);
  expect(updated.receiptVersion).toBe(request.receiptVersion + 1);
  expect(updated.receipts).toHaveLength(1);
  expect([30, 40]).toContain(updated.items[0]!.receivedQuantity);
  expect(updated.items[0]!.receivedQuantity).toBe(updated.receipts[0]!.items[0]!.quantity);
  expect(updated.items[0]!.remainingQuantity).toBe(100 - updated.items[0]!.receivedQuantity);

  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }]), 409);
  const afterReplay = await getRequest(page, request.id);
  expect(afterReplay.receiptVersion).toBe(updated.receiptVersion);
  expect(afterReplay.receipts).toHaveLength(1);
  expect(afterReplay.items).toEqual(updated.items);
});

test("a partial receipt prevents cancellation even while quantities remain", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 40 }]),
    200,
  );
  request = await getRequest(page, request.id);
  expect(request.receivedAt).toBeNull();
  expect(request.items[0]!.remainingQuantity).toBe(60);

  await authenticate(page, credentials.purchasing);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/cancellation`, {
      data: {
        action: "CANCEL",
        reason: "Cancellation must preserve the recorded partial delivery",
        cancellationReference: "PO-CANCEL-AFTER-PARTIAL",
      },
    }),
    400,
  );
  const afterCancellation = await getRequest(page, request.id);
  expect(afterCancellation.status).toBe("ORDERED");
  expect(afterCancellation.receipts).toHaveLength(1);
  expect(afterCancellation.items[0]!.receivedQuantity).toBe(40);
});

test("receipt validation rejects invalid quantities and unrelated or repeated items", async ({
  page,
}) => {
  await authenticate(page);
  const request = await createOrderedRequest(page, [100]);
  const otherRequest = await createRequestViaApi(page);
  const otherDetail = await getRequest(page, otherRequest.id);
  const itemId = request.items[0]!.id;
  const endpoint = `/api/purchase-requests/${request.id}/receipts`;
  const validPayload = {
    action: "RECEIVED",
    expectedVersion: request.receiptVersion,
    receivedDate,
    items: [{ itemId, quantity: 1 }],
  };
  const invalidPayloads = [
    { ...validPayload, expectedVersion: undefined },
    { ...validPayload, receivedDate: undefined },
    { ...validPayload, items: [] },
    { ...validPayload, items: [{ itemId, quantity: 0 }] },
    { ...validPayload, items: [{ itemId, quantity: -1 }] },
    { ...validPayload, items: [{ itemId, quantity: 1.5 }] },
    { ...validPayload, items: [{ itemId: otherDetail.items[0]!.id, quantity: 1 }] },
    {
      ...validPayload,
      items: [{ itemId, quantity: 1 }, { itemId, quantity: 2 }],
    },
  ];
  for (const data of invalidPayloads) {
    await expectStatus(await page.request.post(endpoint, { data }), 400);
  }

  const afterValidation = await getRequest(page, request.id);
  expect(afterValidation.receiptVersion).toBe(request.receiptVersion);
  expect(afterValidation.receipts).toHaveLength(0);
  expect(afterValidation.items[0]!.receivedQuantity).toBe(0);
  await authenticate(page, credentials.purchasing);
  await expectStatus(
    await page.request.post(endpoint, {
      data: {
        action: "CLOSE_REMAINDER",
        expectedVersion: request.receiptVersion,
        items: [{ itemId, quantity: 100 }],
        comment: "No delivered quantities exist to close this as a partial receipt",
      },
    }),
    400,
  );
});

test("receipt UI refreshes remaining quantities, requires reasons, and closes a partial order", async ({
  page,
}) => {
  await authenticate(page);
  const request = await createOrderedRequest(page);
  const [first, second] = request.items;
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.locator("#close-remainder-reason")).toHaveCount(0);
  await page.locator(`#receipt-quantity-${first!.id}`).fill("40");
  await page.locator(`#receipt-quantity-${second!.id}`).fill("0");
  await page.locator("#round-receipt-number").fill("RCV-UI-FIRST");
  const receiptButton = page.getByRole("button", {
    name: /บันทึกรับของ|save received date/i,
  });
  let receiptResponse = page.waitForResponse(
    (response) => response.url().endsWith(`/purchase-requests/${request.id}/receipts`) &&
      response.request().method() === "POST",
  );
  await receiptButton.click();
  await expectStatus(await receiptResponse, 200);
  await expect(page.locator(`#receipt-quantity-${first!.id}`)).toHaveValue("60");
  await expect(page.locator(`#receipt-quantity-${second!.id}`)).toHaveValue("10");
  await expect(page.locator("#round-receipt-number")).toHaveValue("");

  await page.locator(`#receipt-quantity-${first!.id}`).fill("65");
  await page.locator(`#receipt-quantity-${second!.id}`).fill("0");
  await expect(page.locator("#over-receipt-reason")).toBeVisible();
  await receiptButton.click();
  await expect(page.getByRole("alert").filter({
    hasText: /กรุณาระบุเหตุผลที่รับเกิน|provide an overreceipt reason/i,
  })).toBeVisible();
  const overReason = uniqueValue("UI-extra-delivery");
  await page.locator("#over-receipt-reason").fill(overReason);
  await page.locator("#round-receipt-number").fill("RCV-UI-SECOND");
  receiptResponse = page.waitForResponse(
    (response) => response.url().endsWith(`/purchase-requests/${request.id}/receipts`) &&
      response.request().method() === "POST",
  );
  await receiptButton.click();
  await expectStatus(await receiptResponse, 200);
  await expect(page.locator(`#receipt-quantity-${first!.id}`)).toHaveValue("0");
  await expect(page.locator("main")).toContainText(overReason);

  await authenticate(page, credentials.purchasing);
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.locator(`#close-quantity-${second!.id}`)).toHaveValue("10");
  await expect(page.locator(`#close-quantity-${first!.id}`)).toHaveCount(0);
  const closeButton = page.getByRole("button", {
    name: /บันทึกปิดยอดค้างรับ|save outstanding closure/i,
  });
  await closeButton.click();
  await expect(page.getByRole("alert").filter({
    hasText: /กรุณาระบุเหตุผลที่ไม่รับต่อ|provide a closure reason/i,
  })).toBeVisible();
  const closeReason = uniqueValue("UI-remainder-not-required");
  await page.locator("#close-remainder-reason").fill(closeReason);
  const closeResponse = page.waitForResponse(
    (response) => response.url().endsWith(`/purchase-requests/${request.id}/receipts`) &&
      response.request().method() === "POST",
  );
  await closeButton.click();
  await expectStatus(await closeResponse, 200);
  await expect(page.locator("#close-remainder-reason")).toHaveCount(0);
  await expect(page.locator("main")).toContainText(closeReason);
  await expect(page.locator("#receipt-reference-panel")).toBeVisible();

  await page.locator("#receipt-number").fill("RCV-UI-SECOND");
  await page.getByRole("button", {
    name: /บันทึกเอกสารและปิดงาน|save documents and close/i,
  }).click();
  await expect(page.locator("main")).toContainText(/รับบางส่วนและปิดงาน|partially received and closed/i);
  const completed = await getRequest(page, request.id);
  expect(completed.status).toBe("COMPLETED");
  expect(completed.items).toEqual([
    expect.objectContaining({
      id: first!.id,
      quantity: 100,
      receivedQuantity: 105,
      remainingQuantity: 0,
      overReceivedQuantity: 5,
    }),
    expect.objectContaining({
      id: second!.id,
      receivedQuantity: 0,
      closedQuantity: 10,
      remainingQuantity: 0,
    }),
  ]);
});
