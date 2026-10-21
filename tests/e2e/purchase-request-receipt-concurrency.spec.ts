import { expect, test } from "@playwright/test";

import { credentials } from "./support";
import {
  authenticate,
  createOrderedRequest,
  expectStatus,
  getRequest,
  receive,
  receivedDate,
} from "./receipt-support";

test("receiving and closing different portions serialize and the loser can retry", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 10 }]), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  const close = (version: number) => page.request.post(`/api/purchase-requests/${request.id}/receipts`, {
    data: {
      action: "CLOSE_REMAINDER",
      expectedVersion: version,
      items: [{ itemId, quantity: 60 }],
      comment: "Supplier cannot provide these sixty remaining units",
    },
  });
  const results = await Promise.all([
    receive(page, request, [{ itemId, quantity: 20 }]),
    close(request.receiptVersion),
  ]);
  expect(results.map((response) => response.status()).sort()).toEqual([200, 409]);
  let current = await getRequest(page, request.id);
  expect(current.receiptVersion).toBe(request.receiptVersion + 1);
  expect(current.receipts).toHaveLength(2);
  expect(current.approvals).toHaveLength(request.approvals.length + 1);

  if (results[0]!.status() === 409) {
    await expectStatus(await receive(page, current, [{ itemId, quantity: 20 }]), 200);
  } else {
    await expectStatus(await close(current.receiptVersion), 200);
  }
  current = await getRequest(page, request.id);
  expect(current.items[0]).toMatchObject({ receivedQuantity: 30, closedQuantity: 60, remainingQuantity: 10 });
  expect(current.receipts).toHaveLength(3);
  expect(current.receivedAt).toBeNull();
});

test("simultaneous closures cannot consume the same outstanding balance twice", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }]), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  const data = {
    action: "CLOSE_REMAINDER",
    expectedVersion: request.receiptVersion,
    items: [{ itemId, quantity: 60 }],
    comment: "The remaining stock will no longer be delivered",
  };
  const endpoint = `/api/purchase-requests/${request.id}/receipts`;
  const results = await Promise.all([
    page.request.post(endpoint, { data }),
    page.request.post(endpoint, { data }),
  ]);
  expect(results.map((response) => response.status()).sort()).toEqual([200, 409]);
  const current = await getRequest(page, request.id);
  expect(current.items[0]).toMatchObject({ receivedQuantity: 40, closedQuantity: 60, remainingQuantity: 0 });
  expect(current.receipts.filter((receipt) => receipt.action === "CLOSE_REMAINDER")).toHaveLength(1);
  expect(current.approvals.filter((approval) => approval.stepLabel === "ปิดยอดค้างรับ")).toHaveLength(1);
});

test("a first receipt racing PO cancellation preserves exactly one valid outcome", async ({ page }) => {
  await authenticate(page);
  const request = await createOrderedRequest(page, [100]);
  await authenticate(page, credentials.purchasing);
  const [receiptResponse, cancellationResponse] = await Promise.all([
    receive(page, request, [{ itemId: request.items[0]!.id, quantity: 40 }]),
    page.request.post(`/api/purchase-requests/${request.id}/cancellation`, {
      data: {
        action: "CANCEL",
        reason: "The supplier confirmed cancellation of this purchase order",
        cancellationReference: "PO-RACE-CANCEL",
      },
    }),
  ]);
  const statuses = [receiptResponse.status(), cancellationResponse.status()];
  expect(statuses.filter((status) => status === 200)).toHaveLength(1);
  expect([400, 409]).toContain(statuses.find((status) => status !== 200));
  const current = await getRequest(page, request.id);
  expect(current.approvals).toHaveLength(request.approvals.length + 1);
  if (receiptResponse.status() === 200) {
    expect(current.status).toBe("ORDERED");
    expect(current.items[0]).toMatchObject({ receivedQuantity: 40, remainingQuantity: 60 });
    expect(current.receipts).toHaveLength(1);
    expect(current.cancelledAt).toBeNull();
  } else {
    expect(current.status).toBe("CANCELLED");
    expect(current.items[0]).toMatchObject({ receivedQuantity: 0, remainingQuantity: 100 });
    expect(current.receipts).toHaveLength(0);
    expect(current.receiptVersion).toBe(0);
  }
});

test("finalization racing an extra receipt cannot close with stale receipt documents", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 100 }], { receiptNumber: "RCV-BEFORE-EXTRA" }), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  const [receiptResponse, finalizationResponse] = await Promise.all([
    receive(page, request, [{ itemId, quantity: 5 }], {
      overReceiptReason: "Supplier delivered five additional usable units",
      receiptNumber: "RCV-EXTRA-RACE",
    }),
    page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { expectedVersion: request.receiptVersion, receiptNumber: "RCV-BEFORE-EXTRA" },
    }),
  ]);
  const statuses = [receiptResponse.status(), finalizationResponse.status()];
  expect(statuses.filter((status) => status === 200)).toHaveLength(1);
  expect([400, 409]).toContain(statuses.find((status) => status !== 200));
  const current = await getRequest(page, request.id);
  expect(current.receiptVersion).toBe(request.receiptVersion + 1);
  expect(current.approvals).toHaveLength(request.approvals.length + 1);
  if (receiptResponse.status() === 200) {
    expect(current.status).toBe("ORDERED");
    expect(current.items[0]).toMatchObject({ receivedQuantity: 105, overReceivedQuantity: 5 });
    expect(current.receiptNumber).toBe("RCV-EXTRA-RACE");
    expect(current.receipts).toHaveLength(2);
  } else {
    expect(current.status).toBe("COMPLETED");
    expect(current.items[0]).toMatchObject({ receivedQuantity: 100, overReceivedQuantity: 0 });
    expect(current.receiptNumber).toBe("RCV-BEFORE-EXTRA");
    expect(current.receipts).toHaveLength(1);
  }
});

test("a round document edit racing finalization keeps header and ledger consistent", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await expectStatus(await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 100 }], { receiptNumber: "RCV-ORIGINAL-RACE" }), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  const results = await Promise.all([
    page.request.post(`/api/purchase-requests/${request.id}/receipts/${request.receipts[0]!.id}/references`, {
      data: { expectedVersion: request.receiptVersion, receiptNumber: "RCV-REVISED-RACE" },
    }),
    page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
      data: { expectedVersion: request.receiptVersion, receiptNumber: "RCV-ORIGINAL-RACE" },
    }),
  ]);
  expect(results.map((response) => response.status()).sort()).toEqual([200, 409]);
  const current = await getRequest(page, request.id);
  const expectedReference = results[0]!.status() === 200 ? "RCV-REVISED-RACE" : "RCV-ORIGINAL-RACE";
  expect(current.receiptNumber).toBe(expectedReference);
  expect(current.receipts[0]!.receiptNumber).toBe(expectedReference);
  expect(current.status).toBe(results[0]!.status() === 200 ? "ORDERED" : "COMPLETED");
  expect(current.approvals).toHaveLength(request.approvals.length + 1);
});

test("legacy full-receipt API racing a quantity receipt never receives more than ordered", async ({ page }) => {
  await authenticate(page);
  const request = await createOrderedRequest(page, [100]);
  const results = await Promise.all([
    receive(page, request, [{ itemId: request.items[0]!.id, quantity: 40 }]),
    page.request.post(`/api/purchase-requests/${request.id}/status`, {
      data: { action: "RECEIVED", receivedDate, comment: "Legacy client receives outstanding balance" },
    }),
  ]);
  expect(results.some((response) => response.status() === 200)).toBe(true);
  for (const response of results) expect([200, 409]).toContain(response.status());
  const current = await getRequest(page, request.id);
  const receivedQuantity = current.items[0]!.receivedQuantity;
  expect([40, 100]).toContain(receivedQuantity);
  expect(current.items[0]!.overReceivedQuantity).toBe(0);
  expect(current.receipts.reduce((sum, receipt) => sum + receipt.items[0]!.quantity, 0)).toBe(receivedQuantity);
  expect(current.receipts).toHaveLength(results.filter((response) => response.status() === 200).length);
  expect(current.approvals).toHaveLength(request.approvals.length + current.receipts.length);
});

test("retrying the legacy document-close command creates one completion audit entry", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await expectStatus(await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 100 }]), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  const endpoint = `/api/purchase-requests/${request.id}/receipt-references`;
  const data = { receiptNumber: "RCV-LEGACY-RETRY", note: "Close after delivery" };
  const results = await Promise.all([
    page.request.post(endpoint, { data }),
    page.request.post(endpoint, { data }),
  ]);
  expect(results.some((response) => response.status() === 200)).toBe(true);
  for (const response of results) expect([200, 409]).toContain(response.status());
  await expectStatus(await page.request.post(endpoint, { data }), 200);
  const current = await getRequest(page, request.id);
  expect(current.status).toBe("COMPLETED");
  expect(current.approvals.filter((approval) => approval.action === "COMPLETED")).toHaveLength(1);
  expect(current.receipts).toHaveLength(1);
  expect(current.receiptVersion).toBe(request.receiptVersion + 1);
});
