import { expect, test, type Page } from "@playwright/test";

import {
  authenticate,
  createOrderedRequest,
  expectStatus,
  getRequest,
  receive,
} from "./receipt-support";
import { credentials, uniqueValue } from "./support";

const receiveButton = /บันทึกรับของ|save received date/i;
const closeButton = /บันทึกปิดยอดค้างรับ|save outstanding closure/i;
const finalizeButton = /บันทึกเอกสารและปิดงาน|save documents and close/i;
const partialStatus = /รับบางส่วน \/ รอรับเพิ่ม|partially received \/ awaiting more/i;

test.setTimeout(60_000);

function postResponse(page: Page, path: string) {
  return page.waitForResponse((response) =>
    response.url().endsWith(path) && response.request().method() === "POST",
  );
}

function historyPanel(page: Page) {
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]').filter({
      hasText: /ประวัติรับของและปิดยอดค้างรับ|receipt and outstanding closure history/i,
    }),
  });
}

function roundEditor(page: Page, receiptId: string) {
  return page.locator("details").filter({
    has: page.locator(`#history-receipt-number-${receiptId}`),
  });
}

async function dashboardReceiptCount(page: Page) {
  const count = page.locator('a[href="/purchase-requests?preset=awaiting_receipt"] [data-slot="card-content"] > p').first();
  await expect(count).toBeVisible();
  return Number((await count.innerText()).replaceAll(",", ""));
}

test("partial requests remain in the receipt queue and move through document and completed filters", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }], {
    receiptNumber: "FILTER-FIRST-ROUND",
  }), 200);
  request = await getRequest(page, request.id);
  const query = encodeURIComponent(request.prNumber);

  await page.goto(`/purchase-requests?preset=awaiting_receipt&query=${query}`);
  await expect(page.getByRole("row").filter({ hasText: request.prNumber })).toContainText(partialStatus);
  await page.goto(`/purchase-requests?status=ORDERED&query=${query}`);
  await expect(page.getByRole("row").filter({ hasText: request.prNumber })).toContainText(partialStatus);
  await page.goto(`/purchase-requests?status=AWAITING_RECEIPT_REFERENCES&query=${query}`);
  await expect(page.getByRole("row").filter({ hasText: request.prNumber })).toHaveCount(0);

  await expectStatus(await receive(page, request, [{ itemId, quantity: 60 }], {
    receiptNumber: "FILTER-LAST-ROUND",
  }), 200);
  await page.goto(`/purchase-requests?preset=awaiting_receipt&query=${query}`);
  await expect(page.getByRole("row").filter({ hasText: request.prNumber })).toHaveCount(0);
  await page.goto(`/purchase-requests?status=AWAITING_RECEIPT_REFERENCES&query=${query}`);
  await expect(page.getByRole("row").filter({ hasText: request.prNumber })).toContainText(/รอบันทึกเลขเอกสาร|awaiting document numbers/i);

  await authenticate(page, credentials.purchasing);
  request = await getRequest(page, request.id);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
    data: { expectedVersion: request.receiptVersion, receiptNumber: "FILTER-LAST-ROUND" },
  }), 200);
  await page.goto(`/purchase-requests?status=COMPLETED&query=${query}`);
  await expect(page.getByRole("row").filter({ hasText: request.prNumber })).toContainText(/เสร็จสมบูรณ์|completed/i);
  await page.goto(`/purchase-requests?status=AWAITING_RECEIPT_REFERENCES&query=${query}`);
  await expect(page.getByRole("row").filter({ hasText: request.prNumber })).toHaveCount(0);
});

test("dashboard keeps a partial receipt in its queue until the remaining quantity is closed", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await page.goto("/dashboard");
  const initialCount = await dashboardReceiptCount(page);
  expect(initialCount).toBeGreaterThan(0);

  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }]), 200);
  request = await getRequest(page, request.id);
  await page.reload();
  expect(await dashboardReceiptCount(page)).toBe(initialCount);

  await authenticate(page, credentials.purchasing);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipts`, {
    data: {
      action: "CLOSE_REMAINDER",
      expectedVersion: request.receiptVersion,
      items: [{ itemId, quantity: 60 }],
      comment: "The supplier will not deliver the remaining quantity",
    },
  }), 200);
  await authenticate(page);
  await page.reload();
  expect(await dashboardReceiptCount(page)).toBe(initialCount - 1);
  request = await getRequest(page, request.id);
  expect(request.status).toBe("ORDERED");
  expect(request.receivedAt).toBeTruthy();
});

test("round document editors preserve earlier references and synchronize the final receipt before closing", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }]), 200);
  request = await getRequest(page, request.id);
  await expectStatus(await receive(page, request, [{ itemId, quantity: 60 }], {
    receiptNumber: "UI-LATEST-ORIGINAL",
  }), 200);
  request = await getRequest(page, request.id);
  const [firstReceipt, lastReceipt] = request.receipts;
  await authenticate(page, credentials.purchasing);
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.locator("#receipt-number")).toHaveValue("UI-LATEST-ORIGINAL");

  let response = postResponse(page, `/purchase-requests/${request.id}/receipt-references`);
  await page.getByRole("button", { name: finalizeButton }).click();
  await expectStatus(await response, 400);
  await expect(page.getByText(/กรุณาบันทึกเลขเอกสารของการรับสินค้าแต่ละรอบให้ครบก่อนปิดงาน|add document numbers for every receipt round/i)).toBeVisible();

  const firstEditor = roundEditor(page, firstReceipt!.id);
  await firstEditor.locator("summary").click();
  await page.locator(`#history-tax-invoice-${firstReceipt!.id}`).fill("UI-FIRST-INVOICE");
  response = postResponse(page, `/purchase-requests/${request.id}/receipts/${firstReceipt!.id}/references`);
  await firstEditor.getByRole("button", { name: /บันทึกเลขเอกสาร|save document numbers/i }).click();
  await expectStatus(await response, 200);
  await expect(historyPanel(page)).toContainText("UI-FIRST-INVOICE");
  await expect(page.locator("#receipt-number")).toHaveValue("UI-LATEST-ORIGINAL");

  const lastEditor = roundEditor(page, lastReceipt!.id);
  await lastEditor.locator("summary").click();
  await page.locator(`#history-receipt-number-${lastReceipt!.id}`).fill("UI-LATEST-REVISED");
  response = postResponse(page, `/purchase-requests/${request.id}/receipts/${lastReceipt!.id}/references`);
  await lastEditor.getByRole("button", { name: /บันทึกเลขเอกสาร|save document numbers/i }).click();
  await expectStatus(await response, 200);
  await expect(page.locator("#receipt-number")).toHaveValue("UI-LATEST-REVISED");

  response = postResponse(page, `/purchase-requests/${request.id}/receipt-references`);
  await page.getByRole("button", { name: finalizeButton }).click();
  await expectStatus(await response, 200);
  await expect(page.locator("#received-date")).toHaveCount(0);
  await page.reload();
  await expect(historyPanel(page)).toContainText("UI-FIRST-INVOICE");
  await expect(historyPanel(page)).toContainText("UI-LATEST-REVISED");
  await expect(page.locator("#receipt-number")).toHaveValue("UI-LATEST-REVISED");
  request = await getRequest(page, request.id);
  expect(request.status).toBe("COMPLETED");
  expect(request.receipts[0]!.taxInvoiceNumber).toBe("UI-FIRST-INVOICE");
  expect(request.receiptNumber).toBe("UI-LATEST-REVISED");
});

test("a stale browser receipt refreshes outstanding defaults without duplicating the delivery", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await page.goto(`/purchase-requests/${request.id}`);
  await page.locator(`#receipt-quantity-${itemId}`).fill("20");

  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }], {
    comment: "A delivery recorded while the browser form was open",
  }), 200);
  let response = postResponse(page, `/purchase-requests/${request.id}/receipts`);
  await page.getByRole("button", { name: receiveButton }).click();
  await expectStatus(await response, 409);
  await expect(page.locator(`#receipt-quantity-${itemId}`)).toHaveValue("60");
  request = await getRequest(page, request.id);
  expect(request.receipts).toHaveLength(1);
  expect(request.items[0]!.receivedQuantity).toBe(40);

  await page.locator("#round-receipt-number").fill("AFTER-STALE-REFRESH");
  response = postResponse(page, `/purchase-requests/${request.id}/receipts`);
  await page.getByRole("button", { name: receiveButton }).click();
  await expectStatus(await response, 200);
  await expect(page.locator(`#receipt-quantity-${itemId}`)).toHaveValue("0");
  await page.reload();
  await expect(historyPanel(page)).toContainText("AFTER-STALE-REFRESH");
  request = await getRequest(page, request.id);
  expect(request.receipts).toHaveLength(2);
  expect(request.items[0]!.receivedQuantity).toBe(100);
  expect(request.receipts.map((receipt) => receipt.items[0]!.quantity)).toEqual([40, 60]);
});

test("closing rejects zero and excessive quantities, then preserves a partial closure after reload", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }], {
    receiptNumber: "BEFORE-PARTIAL-CLOSURE",
  }), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  await page.goto(`/purchase-requests/${request.id}`);
  const closeReason = uniqueValue("Close-only-part-of-remainder");
  await page.locator("#close-remainder-reason").fill(closeReason);
  await page.locator(`#close-quantity-${itemId}`).fill("0");
  await page.getByRole("button", { name: closeButton }).click();
  await expect(page.getByRole("alert").filter({
    hasText: /กรุณาระบุจำนวนที่จะปิดยอดมากกว่า 0|enter a positive closure quantity/i,
  })).toBeVisible();

  await page.locator(`#close-quantity-${itemId}`).fill("61");
  await page.getByRole("button", { name: closeButton }).click();
  await expect(page.getByRole("alert").filter({
    hasText: /จำนวนที่จะปิดยอดต้องไม่เกินยอดค้างรับ|closure quantities cannot exceed outstanding/i,
  })).toBeVisible();
  expect((await getRequest(page, request.id)).receiptVersion).toBe(request.receiptVersion);

  await page.locator(`#close-quantity-${itemId}`).fill("20");
  const response = postResponse(page, `/purchase-requests/${request.id}/receipts`);
  await page.getByRole("button", { name: closeButton }).click();
  await expectStatus(await response, 200);
  await expect(page.locator(`#close-quantity-${itemId}`)).toHaveValue("40");
  await page.reload();
  await expect(page.locator(`#receipt-quantity-${itemId}`)).toHaveValue("40");
  await expect(page.locator(`#close-quantity-${itemId}`)).toHaveValue("40");
  await expect(historyPanel(page)).toContainText(closeReason);
  await expect(page.locator("#receipt-reference-panel")).toHaveCount(0);
  request = await getRequest(page, request.id);
  expect(request.receipts).toHaveLength(2);
  expect(request.items[0]).toMatchObject({
    receivedQuantity: 40, closedQuantity: 20, remainingQuantity: 40,
  });
});

test("receipt, closure, and document controls follow employee, purchasing, and admin privileges", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }], {
    receiptNumber: "PRIVILEGE-RECEIPT",
  }), 200);
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.locator(`#receipt-quantity-${itemId}`)).toHaveValue("60");
  await expect(page.locator("#close-remainder-reason")).toHaveCount(0);
  await expect(historyPanel(page).locator("details")).toHaveCount(0);
  await expect(page.locator("#receipt-reference-panel")).toHaveCount(0);

  await authenticate(page, credentials.purchasing);
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.locator("#close-remainder-reason")).toBeVisible();
  await expect(historyPanel(page).locator("details")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^ยกเลิก PR$|^cancel pr$/i })).toHaveCount(0);

  await authenticate(page, credentials.admin);
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.locator("#close-remainder-reason")).toBeVisible();
  await expect(historyPanel(page).locator("details")).toHaveCount(1);
  await page.locator("#close-remainder-reason").fill("Admin confirms that the remaining delivery is cancelled");
  const response = postResponse(page, `/purchase-requests/${request.id}/receipts`);
  await page.getByRole("button", { name: closeButton }).click();
  await expectStatus(await response, 200);
  await expect(page.locator("#receipt-reference-panel")).toBeVisible();
  request = await getRequest(page, request.id);
  const closure = request.receipts.find((receipt) => receipt.action === "CLOSE_REMAINDER")!;
  expect(closure.recordedBy.id).not.toBe(request.requester.id);

  await authenticate(page);
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.locator("#receipt-reference-panel")).toHaveCount(0);
  await expect(historyPanel(page).locator("details")).toHaveCount(0);
  await expect(historyPanel(page)).toContainText(closure.recordedBy.name);
});

test("Thai and English show partial and closed-remainder statuses in detail and list", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  const itemId = request.items[0]!.id;
  await expectStatus(await receive(page, request, [{ itemId, quantity: 40 }], {
    receiptNumber: "BILINGUAL-RECEIPT",
  }), 200);
  request = await getRequest(page, request.id);
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.getByText("รับบางส่วน / รอรับเพิ่ม", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ภาษา: English" }).click();
  await expect(page.getByText("Partially received / awaiting more", { exact: true })).toBeVisible();
  const query = encodeURIComponent(request.prNumber);
  await page.goto(`/purchase-requests?query=${query}`);
  await expect(page.getByRole("row").filter({ hasText: request.prNumber })).toContainText("Partially received / awaiting more");

  await authenticate(page, credentials.purchasing);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipts`, {
    data: {
      action: "CLOSE_REMAINDER",
      expectedVersion: request.receiptVersion,
      items: [{ itemId, quantity: 60 }],
      comment: "The remaining quantity will no longer be received",
    },
  }), 200);
  request = await getRequest(page, request.id);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
    data: { expectedVersion: request.receiptVersion, receiptNumber: "BILINGUAL-RECEIPT" },
  }), 200);
  await page.goto(`/purchase-requests/${request.id}`);
  await expect(page.getByText("รับบางส่วนและปิดงาน", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ภาษา: English" }).click();
  await expect(page.getByText("Partially received and closed", { exact: true })).toBeVisible();
  await page.goto(`/purchase-requests?status=COMPLETED&query=${query}`);
  await expect(page.getByRole("row").filter({ hasText: request.prNumber })).toContainText("Partially received and closed");
  await page.getByRole("button", { name: "Language: ไทย" }).click();
  await expect(page.getByRole("row").filter({ hasText: request.prNumber })).toContainText("รับบางส่วนและปิดงาน");
});

test("stale global and round document forms refresh without replacing a newer reference", async ({ page }) => {
  await authenticate(page);
  let request = await createOrderedRequest(page, [100]);
  await expectStatus(await receive(page, request, [{ itemId: request.items[0]!.id, quantity: 100 }], {
    receiptNumber: "DOCUMENT-BASE",
  }), 200);
  request = await getRequest(page, request.id);
  const receiptId = request.receipts[0]!.id;
  await authenticate(page, credentials.purchasing);
  await page.goto(`/purchase-requests/${request.id}`);
  await page.locator("#receipt-number").fill("STALE-GLOBAL-FORM");
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipts/${receiptId}/references`, {
    data: { expectedVersion: request.receiptVersion, receiptNumber: "WINNING-ROUND-EDIT" },
  }), 200);
  let response = postResponse(page, `/purchase-requests/${request.id}/receipt-references`);
  await page.getByRole("button", { name: finalizeButton }).click();
  await expectStatus(await response, 409);
  await expect(page.locator("#receipt-number")).toHaveValue("WINNING-ROUND-EDIT");

  const editor = roundEditor(page, receiptId);
  await editor.locator("summary").click();
  await page.locator(`#history-receipt-number-${receiptId}`).fill("STALE-ROUND-FORM");
  request = await getRequest(page, request.id);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
    data: { expectedVersion: request.receiptVersion, receiptNumber: "WINNING-FINAL-DOCUMENT" },
  }), 200);
  response = postResponse(page, `/purchase-requests/${request.id}/receipts/${receiptId}/references`);
  await editor.getByRole("button", { name: /บันทึกเลขเอกสาร|save document numbers/i }).click();
  await expectStatus(await response, 409);
  await expect(page.locator("#receipt-number")).toHaveValue("WINNING-FINAL-DOCUMENT");
  await expect(historyPanel(page)).toContainText("WINNING-FINAL-DOCUMENT");
  await expect(page.locator("main")).not.toContainText("STALE-GLOBAL-FORM");
  request = await getRequest(page, request.id);
  expect(request.status).toBe("COMPLETED");
  expect(request.receipts).toHaveLength(1);
  expect(request.receiptNumber).toBe("WINNING-FINAL-DOCUMENT");
  expect(request.receipts[0]!.receiptNumber).toBe("WINNING-FINAL-DOCUMENT");
});
