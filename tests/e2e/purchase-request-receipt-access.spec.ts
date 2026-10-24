import { expect, test, type Page } from "@playwright/test";

import type { PurchaseRequestDetail } from "../../src/lib/types";
import {
  authenticate,
  createOrderedRequest,
  expectStatus,
  getRequest,
  receive,
  receivedDate,
} from "./receipt-support";
import { createRequestViaApi, credentials, uniqueValue } from "./support";

function closeRemainder(page: Page, request: PurchaseRequestDetail, quantity: number) {
  return page.request.post(`/api/purchase-requests/${request.id}/receipts`, {
    data: {
      action: "CLOSE_REMAINDER",
      expectedVersion: request.receiptVersion,
      items: [{ itemId: request.items[0]!.id, quantity }],
      comment: "Supplier will not deliver the outstanding quantities",
    },
  });
}

async function expectUnchanged(page: Page, request: PurchaseRequestDetail) {
  expect(await getRequest(page, request.id)).toEqual(request);
}

test("unauthenticated requests cannot receive, close quantities, or edit receipt documents", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 40 }]),
    200,
  );
  request = await getRequest(page, request.id);
  await page.context().clearCookies();

  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 1 }]),
    401,
  );
  await expectStatus(await closeRemainder(page, request, 60), 401);
  await expectStatus(
    await page.request.post(
      `/api/purchase-requests/${request.id}/receipts/${request.receipts[0]!.id}/references`,
      { data: { receiptNumber: "UNAUTHENTICATED-ROUND-REFERENCE" } },
    ),
    401,
  );
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { receiptNumber: "UNAUTHENTICATED-FINAL-REFERENCE" },
    }),
    401,
  );
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/status`, {
      data: { action: "RECEIVED", receivedDate },
    }),
    401,
  );

  await authenticate(page);
  await expectUnchanged(page, request);
});

test("an unrelated employee cannot view or mutate another request's receipt history", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 40 }], {
      receiptNumber: "OWNER-RECEIPT",
    }),
    200,
  );
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.employee2);

  await expectStatus(await page.request.get(`/api/purchase-requests/${request.id}`), 403);
  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 1 }]),
    403,
  );
  await expectStatus(await closeRemainder(page, request, 60), 403);
  await expectStatus(
    await page.request.post(
      `/api/purchase-requests/${request.id}/receipts/${request.receipts[0]!.id}/references`,
      { data: { receiptNumber: "OTHER-EMPLOYEE-REFERENCE" } },
    ),
    403,
  );
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { receiptNumber: "OTHER-EMPLOYEE-FINAL-REFERENCE" },
    }),
    403,
  );
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/status`, {
      data: { action: "RECEIVED", receivedDate },
    }),
    403,
  );

  await authenticate(page);
  await expectUnchanged(page, request);
});

test("a department approver may receive visible items but cannot close quantities or edit documents", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await authenticate(page, credentials.approver);
  expect((await getRequest(page, request.id)).id).toBe(request.id);
  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 40 }]),
    200,
  );
  request = await getRequest(page, request.id);
  expect(request.receipts[0]!.recordedBy.id).not.toBe(request.requester.id);
  expect(request.approvals.at(-1)!.approver.role).toBe("APPROVER");

  await expectStatus(await closeRemainder(page, request, 60), 403);
  await expectStatus(
    await page.request.post(
      `/api/purchase-requests/${request.id}/receipts/${request.receipts[0]!.id}/references`,
      { data: { receiptNumber: "APPROVER-MUST-NOT-EDIT-DOCUMENTS" } },
    ),
    403,
  );
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { receiptNumber: "APPROVER-MUST-NOT-FINALIZE" },
    }),
    403,
  );
  await expectUnchanged(page, request);
});

test("an administrator can receive, close the remainder, edit round documents, and complete the PR", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await authenticate(page, credentials.admin);
  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 40 }]),
    200,
  );
  request = await getRequest(page, request.id);
  const receivingRecord = request.receipts[0]!;
  expect(request.approvals.at(-1)!.approver.role).toBe("ADMIN");

  await expectStatus(await closeRemainder(page, request, 60), 200);
  request = await getRequest(page, request.id);
  expect(request.items[0]).toMatchObject({
    receivedQuantity: 40,
    closedQuantity: 60,
    remainingQuantity: 0,
  });
  expect(request.receipts.find((receipt) => receipt.action === "CLOSE_REMAINDER")).toMatchObject({
    recordedBy: { id: receivingRecord.recordedBy.id },
  });
  await expectStatus(
    await page.request.post(
      `/api/purchase-requests/${request.id}/receipts/${receivingRecord.id}/references`,
      {
        data: {
          taxInvoiceNumber: "ADMIN-RECEIPT-INVOICE",
          expectedVersion: request.receiptVersion,
        },
      },
    ),
    200,
  );
  request = await getRequest(page, request.id);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: {
        taxInvoiceNumber: "ADMIN-RECEIPT-INVOICE",
        expectedVersion: request.receiptVersion,
      },
    }),
    200,
  );
  request = await getRequest(page, request.id);
  expect(request.status).toBe("COMPLETED");
  expect(request.completedAt).toBeTruthy();
  expect(request.taxInvoiceNumber).toBe("ADMIN-RECEIPT-INVOICE");
  expect(request.receipts.filter((receipt) => receipt.action === "RECEIVED")).toEqual([
    expect.objectContaining({ id: receivingRecord.id, taxInvoiceNumber: "ADMIN-RECEIPT-INVOICE" }),
  ]);
  expect(request.approvals.at(-1)).toMatchObject({ action: "COMPLETED", approver: { role: "ADMIN" } });
});

test("receiving is blocked in draft, pending approval, and approved states without adding audit entries", async ({
  page,
}) => {
  await authenticate(page);
  const created = await createRequestViaApi(page);

  async function expectReceivingBlocked(status: PurchaseRequestDetail["status"]) {
    await authenticate(page, credentials.purchasing);
    const request = await getRequest(page, created.id);
    expect(request.status).toBe(status);
    await expectStatus(
      await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 1 }]),
      400,
    );
    await expectStatus(await closeRemainder(page, request, 1), 400);
    await expectStatus(
      await page.request.post(`/api/purchase-requests/${request.id}/status`, {
        data: { action: "RECEIVED", receivedDate },
      }),
      400,
    );
    await expectUnchanged(page, request);
  }

  await expectReceivingBlocked("DRAFT");
  await authenticate(page);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${created.id}/submit`),
    200,
  );
  await expectReceivingBlocked("PENDING_APPROVAL");
  await authenticate(page, credentials.approver);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${created.id}/approval`, {
      data: { action: "APPROVED", comment: "Approved without opening a PO" },
    }),
    200,
  );
  await expectReceivingBlocked("APPROVED");
});

test("completed PRs reject additional receipts and closures without changing their audit trail", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 100 }]),
    200,
  );
  await authenticate(page, credentials.purchasing);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { receiptNumber: "COMPLETED-ORDER-RECEIPT" },
    }),
    200,
  );
  request = await getRequest(page, request.id);
  expect(request.status).toBe("COMPLETED");

  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 5 }], {
      overReceiptReason: "An extra delivery cannot reopen a completed PR",
    }),
    400,
  );
  await expectStatus(await closeRemainder(page, request, 1), 400);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/status`, {
      data: { action: "RECEIVED", receivedDate },
    }),
    400,
  );
  await expectUnchanged(page, request);
});

test("cancelled PRs cannot receive goods or create closure or document audit entries", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await authenticate(page, credentials.purchasing);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/cancellation`, {
      data: {
        action: "CANCEL",
        reason: "The supplier cancelled this order before delivering any goods",
        cancellationReference: uniqueValue("PO-CANCEL-BEFORE-DELIVERY"),
      },
    }),
    200,
  );
  request = await getRequest(page, request.id);
  expect(request.status).toBe("CANCELLED");

  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 1 }]),
    400,
  );
  await expectStatus(await closeRemainder(page, request, 100), 400);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/status`, {
      data: { action: "RECEIVED", receivedDate },
    }),
    400,
  );
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { receiptNumber: "CANCELLED-PR-MUST-NOT-HAVE-RECEIPTS" },
    }),
    400,
  );
  await expectUnchanged(page, request);
});

test("a receipt belonging to another PR cannot be updated through the wrong PR endpoint", async ({
  page,
}) => {
  await authenticate(page);
  let first = await createOrderedRequest(page, [100]);
  await expectStatus(
    await receive(page, first, [{ itemId: first.items[0]!.id, quantity: 40 }], {
      receiptNumber: "FIRST-PR-RECEIPT",
    }),
    200,
  );
  first = await getRequest(page, first.id);
  let second = await createOrderedRequest(page, [100]);
  await expectStatus(
    await receive(page, second, [{ itemId: second.items[0]!.id, quantity: 20 }], {
      receiptNumber: "SECOND-PR-RECEIPT",
    }),
    200,
  );
  second = await getRequest(page, second.id);
  await authenticate(page, credentials.purchasing);
  // Action permissions in the DTO depend on the current viewer.
  first = await getRequest(page, first.id);
  second = await getRequest(page, second.id);

  await expectStatus(
    await page.request.post(
      `/api/purchase-requests/${first.id}/receipts/${second.receipts[0]!.id}/references`,
      {
        data: {
          receiptNumber: "CROSS-PR-REFERENCE-MUST-BE-REJECTED",
          expectedVersion: first.receiptVersion,
        },
      },
    ),
    404,
  );
  await expectUnchanged(page, first);
  await expectUnchanged(page, second);
});

test("a closure event cannot be assigned receipt or tax invoice references", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await expectStatus(
    await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 40 }]),
    200,
  );
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await closeRemainder(page, request, 60), 200);
  request = await getRequest(page, request.id);
  const closure = request.receipts.find((receipt) => receipt.action === "CLOSE_REMAINDER")!;

  await expectStatus(
    await page.request.post(
      `/api/purchase-requests/${request.id}/receipts/${closure.id}/references`,
      {
        data: {
          receiptNumber: "CLOSURE-IS-NOT-A-DELIVERY",
          taxInvoiceNumber: "NO-TAX-INVOICE-FOR-CLOSURE",
          expectedVersion: request.receiptVersion,
        },
      },
    ),
    404,
  );
  await expectUnchanged(page, request);
});

test("the legacy receive endpoint receives only remaining quantities and preserves earlier rounds", async ({
  page,
}) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100, 10]);
  const [first, second] = request.items;
  await expectStatus(
    await receive(page, request, [
      { itemId: first!.id, quantity: 40 },
      { itemId: second!.id, quantity: 5 },
    ], {
      receiptNumber: "ORIGINAL-PARTIAL-RECEIPT",
      comment: "Keep this earlier partial delivery unchanged",
    }),
    200,
  );
  request = await getRequest(page, request.id);
  const originalReceipt = request.receipts[0]!;
  const originalApprovals = request.approvals;
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/status`, {
      data: {
        action: "RECEIVED",
        receivedDate,
        comment: "Remaining quantities confirmed by an existing API client",
      },
    }),
    200,
  );
  const updated = await getRequest(page, request.id);
  expect(updated.status).toBe("ORDERED");
  expect(updated.receivedAt).toBe(receivedDate);
  expect(updated.receiptVersion).toBe(request.receiptVersion + 1);
  expect(updated.receipts).toHaveLength(2);
  expect(updated.receipts[0]).toEqual(originalReceipt);
  expect(updated.receipts[1]!.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ itemId: first!.id, quantity: 60 }),
    expect.objectContaining({ itemId: second!.id, quantity: 5 }),
  ]));
  expect(updated.items).toEqual([
    expect.objectContaining({ id: first!.id, quantity: 100, receivedQuantity: 100, remainingQuantity: 0 }),
    expect.objectContaining({ id: second!.id, quantity: 10, receivedQuantity: 10, remainingQuantity: 0 }),
  ]);
  expect(updated.approvals.slice(0, originalApprovals.length)).toEqual(originalApprovals);
  expect(updated.approvals).toHaveLength(originalApprovals.length + 1);

  await expectStatus(
    await page.request.post(`/api/purchase-requests/${request.id}/status`, {
      data: { action: "RECEIVED", receivedDate },
    }),
    400,
  );
  await expectUnchanged(page, updated);
});
