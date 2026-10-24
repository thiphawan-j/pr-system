import { readFile } from "node:fs/promises";

import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest, receive } from "./receipt-support";
import { createRequestViaApi, credentials, uniqueValue } from "./support";

type OrderInput = {
  supplierName: string;
  itemIds: string[];
  supplierAddress?: string;
  supplierContact?: string;
  deliveryAddress?: string;
  paymentTerms?: string;
  expectedDeliveryDate?: string;
  note?: string;
};

declare global {
  interface Window { __poPrintCalls: number }
}

async function createApprovedRequest(page: Page) {
  await authenticate(page);
  const marker = uniqueValue("E2E-PO");
  const response = await page.request.post("/api/purchase-requests", {
    multipart: { payload: JSON.stringify({
      requestDate: "2026-10-21",
      department: "Operations",
      reason: `Approved procurement source for ${marker}`,
      urgency: "NORMAL",
      submit: true,
      items: [
        { itemName: `${marker} bolts`, description: "Approved stainless steel bolts", supplierName: "Alpha Supplies", quantity: 2, unit: "กล่อง", unitPrice: 10.25, amount: 20.5 },
        { itemName: `${marker} pump`, description: "Approved replacement pump", supplierName: "Beta Supplies", quantity: 3, unit: "เครื่อง", unitPrice: 99.99, amount: 299.97 },
        { itemName: `${marker} seals`, description: "Approved pump seals", supplierName: "Alpha Supplies", quantity: 4, unit: "ชิ้น", unitPrice: 55.1, amount: 220.4 },
      ],
    }) },
  });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, {
    data: { action: "APPROVED", comment: "Approved quantities and prices for PO conversion" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, id);
}

function defaultOrders(request: PurchaseRequestDetail): OrderInput[] {
  const groups = new Map<string, string[]>();
  for (const item of request.items) {
    const supplier = item.supplierName ?? "Test Supplier";
    groups.set(supplier, [...(groups.get(supplier) ?? []), item.id]);
  }
  return [...groups].map(([supplierName, itemIds]) => ({ supplierName, itemIds }));
}

function convert(page: Page, request: PurchaseRequestDetail, orders = defaultOrders(request)) {
  return page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, { data: { orders } });
}

async function issuedOrders(response: Pick<APIResponse, "status" | "text" | "json">) {
  await expectStatus(response, 201);
  return (await response.json() as { purchaseOrders: PurchaseOrderSummary[] }).purchaseOrders;
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function rejectWithoutChanges(page: Page, request: PurchaseRequestDetail, response: Promise<APIResponse>, status = 400) {
  await expectStatus(await response, status);
  expect(await getRequest(page, request.id)).toEqual(request);
}

test("conversion splits all approved items by supplier and persists exact source snapshots and totals", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const orders = await issuedOrders(await convert(page, request));
  expect(orders).toHaveLength(2);
  expect(new Set(orders.map((order) => order.poNumber)).size).toBe(2);
  const documents = await Promise.all(orders.map((order) => getOrder(page, order.id)));
  const allocatedIds = documents.flatMap((order) => order.items.map((item) => item.purchaseRequestItemId));
  expect(allocatedIds.sort()).toEqual(request.items.map((item) => item.id).sort());
  expect(documents.reduce((sum, order) => sum + order.totalAmount, 0)).toBeCloseTo(request.totalAmount, 2);
  for (const document of documents) {
    expect(document.purchaseRequest).toMatchObject({ id: request.id, prNumber: request.prNumber, status: "ORDERED" });
    expect(document.createdBy.id).not.toBe(request.requester.id);
    expect(document.issuedAt).toBeTruthy();
    expect(document.itemCount).toBe(document.items.length);
    for (const item of document.items) {
      const source = request.items.find((entry) => entry.id === item.purchaseRequestItemId)!;
      expect(document.supplierName).toBe(source.supplierName);
      expect(item).toMatchObject({
        itemName: source.itemName,
        description: source.description,
        quantity: source.quantity,
        unit: source.unit,
        unitPrice: source.unitPrice,
        amount: source.amount,
        receivedQuantity: 0,
        closedQuantity: 0,
      });
    }
  }
  const ordered = await getRequest(page, request.id);
  expect(ordered.status).toBe("ORDERED");
  expect(ordered.orderedAt).toBeTruthy();
  expect(ordered.items).toEqual(request.items);
  expect(ordered.receiptVersion).toBe(request.receiptVersion);
  expect(ordered.purchaseOrders).toEqual(expect.arrayContaining(orders));
  expect(ordered.approvals.filter((approval) => approval.action === "ORDERED")).toHaveLength(1);
});

test("Purchasing can group source items into one supplier PO with trimmed delivery and payment details", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const orders = await issuedOrders(await convert(page, request, [{
    supplierName: "  Consolidated Supplier  ",
    supplierAddress: "  123 Supplier Road  ",
    supplierContact: "  sales@example.test  ",
    deliveryAddress: "  Operations receiving dock  ",
    paymentTerms: "  Net 30 days  ",
    expectedDeliveryDate: "2026-11-01",
    note: "  Deliver the complete approved purchase  ",
    itemIds: request.items.map((item) => item.id).reverse(),
  }]));
  expect(orders).toHaveLength(1);
  const document = await getOrder(page, orders[0]!.id);
  expect(document).toMatchObject({
    supplierName: "Consolidated Supplier",
    supplierAddress: "123 Supplier Road",
    supplierContact: "sales@example.test",
    deliveryAddress: "Operations receiving dock",
    paymentTerms: "Net 30 days",
    expectedDeliveryDate: "2026-11-01",
    note: "Deliver the complete approved purchase",
    itemCount: 3,
    totalAmount: request.totalAmount,
  });
  expect((await getRequest(page, request.id)).items).toEqual(request.items);
});

test("Admin can issue POs and their read access follows the source PR visibility", async ({ page }) => {
  const request = await createApprovedRequest(page);
  await authenticate(page, credentials.admin);
  const orders = await issuedOrders(await convert(page, request));
  const endpoint = `/api/purchase-orders/${orders[0]!.id}`;
  for (const account of [credentials.employee, credentials.approver, credentials.purchasing, credentials.admin, credentials.management]) {
    await authenticate(page, account);
    await expectStatus(await page.request.get(endpoint), 200);
  }
  await authenticate(page, credentials.employee2);
  await expectStatus(await page.request.get(endpoint), 403);
  await page.goto(`/purchase-orders/${orders[0]!.id}`);
  await expect(page.getByRole("heading", { name: /ไม่พบหน้าที่ต้องการ|page not found/i })).toBeVisible();
  await expect(page.locator(".purchase-order-document")).toHaveCount(0);
  await page.context().clearCookies();
  await expectStatus(await page.request.get(endpoint), 401);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await page.request.get("/api/purchase-orders/nonexistent-order-id"), 404);
});

test("PR ownership and approval or management rights do not grant PO issuance permission", async ({ page }) => {
  const request = await createApprovedRequest(page);
  for (const account of [credentials.employee, credentials.employee2, credentials.approver, credentials.management]) {
    await authenticate(page, account);
    await expectStatus(await convert(page, request), 403);
  }
  await page.context().clearCookies();
  await expectStatus(await convert(page, request), 401);
  await authenticate(page, credentials.purchasing);
  expect(await getRequest(page, request.id)).toEqual(request);
});

test("unapproved, returned, rejected and cancelled PRs never create POs or order audits", async ({ page }) => {
  for (const state of ["DRAFT", "PENDING_APPROVAL", "NEED_REVISION", "REJECTED", "CANCELLED"]) {
    let request: PurchaseRequestDetail;
    if (state === "NEED_REVISION") {
      request = await createApprovedRequest(page);
      await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/status`, {
        data: { action: "REQUEST_REVISION", comment: "Quantities need another review before ordering" },
      }), 200);
    } else {
      await authenticate(page);
      const created = await createRequestViaApi(page, { submit: state !== "DRAFT" });
      request = await getRequest(page, created.id);
      if (state === "REJECTED") {
        await authenticate(page, credentials.approver);
        await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/approval`, {
          data: { action: "REJECTED", comment: "Purchase is outside the approved budget" },
        }), 200);
      } else if (state === "CANCELLED") {
        await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/cancellation`, {
          data: { action: "CANCEL", reason: "The purchase is no longer required" },
        }), 200);
      }
    }
    await authenticate(page, credentials.purchasing);
    request = await getRequest(page, request.id);
    expect(request.status).toBe(state);
    await rejectWithoutChanges(page, request, convert(page, request));
  }
});

test("missing item allocations reject the entire supplier batch without issuing a partial PO", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const validFirst = defaultOrders(request)[0]!;
  await rejectWithoutChanges(page, request, convert(page, request, [validFirst]));
  await rejectWithoutChanges(page, request, convert(page, request, []));
  await rejectWithoutChanges(page, request, convert(page, request, [
    validFirst, { supplierName: "Empty Supplier", itemIds: [] },
  ]));
});

test("a source item cannot appear twice within a PO or across supplier POs", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const orders = defaultOrders(request);
  await rejectWithoutChanges(page, request, convert(page, request, [{
    supplierName: "Duplicated Item Supplier",
    itemIds: [...request.items.map((item) => item.id), request.items[0]!.id],
  }]));
  await rejectWithoutChanges(page, request, convert(page, request, [
    orders[0]!, { ...orders[1]!, itemIds: [...orders[1]!.itemIds, orders[0]!.itemIds[0]!] },
  ]));
});

test("a later foreign or unknown item allocation cannot commit earlier valid supplier POs", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const other = await createApprovedRequest(page);
  const orders = defaultOrders(request);
  for (const itemId of [other.items[0]!.id, "nonexistent-source-item"]) {
    await rejectWithoutChanges(page, request, convert(page, request, [
      orders[0]!, { ...orders[1]!, itemIds: [itemId] },
    ]));
    expect(await getRequest(page, other.id)).toEqual(other);
  }
});

test("caller quantities, prices and totals cannot override the approved financial snapshot", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const endpoint = `/api/purchase-requests/${request.id}/purchase-orders`;
  const orders = defaultOrders(request);
  for (const data of [
    { orders, totalAmount: 0 },
    { orders: [{ ...orders[0]!, quantity: 999 }, orders[1]!] },
    { orders: [{ ...orders[0]!, unitPrice: 0 }, orders[1]!] },
    { orders: [{ ...orders[0]!, items: [{ itemId: orders[0]!.itemIds[0], quantity: 999, unitPrice: 0 }] }, orders[1]!] },
  ]) {
    await rejectWithoutChanges(page, request, page.request.post(endpoint, { data }));
  }
});

test("supplier grouping and delivery dates validate before any PO is issued", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const [first, second] = defaultOrders(request);
  for (const orders of [
    [{ ...first!, supplierName: "   " }, second!],
    [first!, { ...second!, supplierName: `  ${first!.supplierName.toUpperCase()}  ` }],
    [{ ...first!, expectedDeliveryDate: "2026-02-29" }, second!],
    [{ ...first!, supplierContact: "x".repeat(201) }, second!],
  ]) {
    await rejectWithoutChanges(page, request, convert(page, request, orders));
  }
});

test("concurrent conversion and a repeated submission produce exactly one complete PO batch", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const results = await Promise.all([convert(page, request), convert(page, request)]);
  expect(results.map((response) => response.status()).sort()).toEqual([201, 409]);
  const winner = results.find((response) => response.status() === 201)!;
  const created = await issuedOrders(winner);
  const current = await getRequest(page, request.id);
  expect(current.purchaseOrders).toHaveLength(defaultOrders(request).length);
  expect(current.purchaseOrders.map((order) => order.id).sort()).toEqual(created.map((order) => order.id).sort());
  expect(current.approvals.filter((approval) => approval.action === "ORDERED")).toHaveLength(1);
  await rejectWithoutChanges(page, current, convert(page, request), 409);
});

test("concurrent conversions of different PRs allocate distinct PO numbers without lost batches", async ({ page }) => {
  const first = await createApprovedRequest(page);
  const second = await createApprovedRequest(page);
  const results = await Promise.all([convert(page, first), convert(page, second)]);
  const batches = await Promise.all(results.map(issuedOrders));
  const all = batches.flat();
  expect(all).toHaveLength(4);
  expect(new Set(all.map((order) => order.id)).size).toBe(4);
  expect(new Set(all.map((order) => order.poNumber)).size).toBe(4);
  for (const request of [first, second]) {
    const current = await getRequest(page, request.id);
    expect(current.status).toBe("ORDERED");
    expect(current.purchaseOrders).toHaveLength(2);
  }
});

test("conversion racing a return for revision preserves only one valid workflow outcome", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const [conversion, revision] = await Promise.all([
    convert(page, request),
    page.request.post(`/api/purchase-requests/${request.id}/status`, {
      data: { action: "REQUEST_REVISION", comment: "Do not issue an outdated purchase specification" },
    }),
  ]);
  expect([conversion.status(), revision.status()].filter((status) => status === 200 || status === 201)).toHaveLength(1);
  const current = await getRequest(page, request.id);
  expect(current.approvals).toHaveLength(request.approvals.length + 1);
  if (conversion.status() === 201) {
    expect([400, 409]).toContain(revision.status());
    expect(current.status).toBe("ORDERED");
    expect(current.purchaseOrders).toHaveLength(2);
  } else {
    expect([400, 409]).toContain(conversion.status());
    expect(revision.status()).toBe(200);
    expect(current.status).toBe("NEED_REVISION");
    expect(current.purchaseOrders).toHaveLength(0);
    expect(current.orderedAt).toBeNull();
  }
});

test("legacy external PO acknowledgement changes PR status without fabricating internal POs", async ({ page }) => {
  const request = await createApprovedRequest(page);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/status`, {
    data: { action: "ORDERED", comment: "External purchasing system issued EXTERNAL-PO-001" },
  }), 200);
  const current = await getRequest(page, request.id);
  expect(current.status).toBe("ORDERED");
  expect(current.purchaseOrders).toHaveLength(0);
  await rejectWithoutChanges(page, current, convert(page, current));
});

test("cancellation is reflected on every issued PO while preserving its supplier and financial history", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const summaries = await issuedOrders(await convert(page, request));
  const before = await Promise.all(summaries.map((order) => getOrder(page, order.id)));
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/cancellation`, {
    data: {
      action: "CANCEL",
      reason: "Both suppliers confirmed that the purchase can be cancelled",
      cancellationReference: summaries.map((order) => order.poNumber).join(", "),
    },
  }), 200);
  for (const original of before) {
    const current = await getOrder(page, original.id);
    expect(current).toEqual({
      ...original,
      canEdit: false,
      purchaseRequest: { ...original.purchaseRequest, status: "CANCELLED", canCloseOrder: false },
    });
  }
  await page.goto(`/purchase-orders/${summaries[0]!.id}`);
  await expect(page.locator("main")).toContainText(/ยกเลิกแล้ว|cancelled/i);
  await page.emulateMedia({ media: "print" });
  const printedDocument = page.locator(".purchase-order-document");
  await expect(printedDocument).toBeVisible();
  await expect(printedDocument.locator("svg text").filter({ hasText: /ยกเลิก|cancelled/i }).first()).toBeVisible();
  await expect(printedDocument).toContainText(/PR ต้นทางถูกยกเลิกแล้ว|The source PR has been cancelled/i);
});

test("PO source links retain live partial receipt and closed balances without changing ordered snapshots", async ({ page }) => {
  let request = await createApprovedRequest(page);
  const summaries = await issuedOrders(await convert(page, request));
  const before = await Promise.all(summaries.map((order) => getOrder(page, order.id)));
  request = await getRequest(page, request.id);
  const firstItem = request.receivingItems[0]!;
  await authenticate(page);
  await expectStatus(await receive(page, request, [{ itemId: firstItem.id, quantity: 1 }], { receiptNumber: "RCV-REAL-PO-PARTIAL" }), 200);
  request = await getRequest(page, request.id);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipts`, {
    data: {
      action: "CLOSE_REMAINDER",
      expectedVersion: request.receiptVersion,
      items: request.receivingItems.filter((item) => item.remainingQuantity > 0).map((item) => ({ itemId: item.id, quantity: item.remainingQuantity })),
      comment: "The remaining approved quantities will no longer be delivered",
    },
  }), 200);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/receipt-references`, {
    data: { receiptNumber: "RCV-REAL-PO-PARTIAL" },
  }), 200);
  const completed = await getRequest(page, request.id);
  expect(completed.status).toBe("COMPLETED");
  for (const original of before) {
    const current = await getOrder(page, original.id);
    expect(current.purchaseRequest.status).toBe("COMPLETED");
    expect(current.totalAmount).toBe(original.totalAmount);
    for (const item of current.items) {
      const source = completed.receivingItems.find((entry) => entry.id === (item.purchaseRequestItemId ?? item.id))!;
      const snapshot = original.items.find((entry) => entry.id === item.id)!;
      expect(item).toEqual({ ...snapshot, receivedQuantity: source.receivedQuantity, closedQuantity: source.closedQuantity });
    }
  }
});

test("Purchasing converts supplier groups in the browser and opens a printable PO linked to its PR", async ({ page }) => {
  await page.addInitScript(() => {
    window.__poPrintCalls = 0;
    window.print = () => { window.__poPrintCalls += 1; };
  });
  const request = await createApprovedRequest(page);
  await page.goto(`/purchase-requests/${request.id}`);
  await page.locator("#convert-pr-to-po").click();
  await expect(page).toHaveURL(new RegExp(`/purchase-requests/${request.id}/purchase-orders/new$`));
  const betaItem = request.items.find((item) => item.supplierName === "Beta Supplies")!;
  await page.locator(`#po-supplier-${betaItem.id}`).fill("Gamma Supplies");
  await page.locator("#po-supplier-address-0").fill("123 Alpha Supplier Road");
  await page.locator("#po-payment-terms-0").fill("Net 30 days");
  await page.locator("#po-expected-delivery-date-1").fill("2026-11-01");
  const conversionResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/purchase-requests/${request.id}/purchase-orders`) && response.request().method() === "POST",
  );
  await page.locator("#create-purchase-orders").click();
  const summaries = await issuedOrders(await conversionResponse);
  expect(summaries).toHaveLength(2);
  expect(summaries.map((order) => order.supplierName).sort()).toEqual(["Alpha Supplies", "Gamma Supplies"]);
  await expect(page).toHaveURL(new RegExp(`/purchase-requests/${request.id}$`));
  await expect(page.locator("#convert-pr-to-po")).toHaveCount(0);
  for (const order of summaries) {
    await expect(page.locator(`a[href="/purchase-orders/${order.id}"]`)).toContainText(order.poNumber);
  }
  const first = summaries.find((order) => order.supplierName === "Alpha Supplies")!;
  await page.locator(`a[href="/purchase-orders/${first.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/purchase-orders/${first.id}$`));
  await expect(page.locator("main")).toContainText(first.poNumber);
  await expect(page.locator("main")).toContainText("123 Alpha Supplier Road");
  await expect(page.locator(`.purchase-order-actions dl a[href="/purchase-requests/${request.id}"]`)).toBeVisible();
  const document = page.locator(".purchase-order-document");
  await expect(document).toBeVisible();
  const issued = await getOrder(page, first.id);
  const locale = await page.locator("html").getAttribute("lang") === "en" ? "en-US" : "th-TH";
  const number = new Intl.NumberFormat(locale);
  const money = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const renderedText = (await document.locator("svg text").allTextContents()).join(" ").replace(/\s+/g, " ");
  const numericColumns = (await document.locator('svg text[text-anchor="end"]').allTextContents()).join("|");
  expect(renderedText).toContain(issued.supplierName);
  expect(renderedText).toContain(request.prNumber);
  expect(renderedText).toContain("Net 30 days");
  for (const item of issued.items) {
    expect(renderedText).toContain(item.itemName);
    if (item.description) expect(renderedText).toContain(item.description);
    if (item.unit) expect(renderedText).toContain(item.unit);
    expect(numericColumns).toContain([number.format(item.quantity), money.format(item.unitPrice), money.format(item.amount)].join("|"));
  }
  expect(renderedText).toContain(money.format(issued.totalAmount));
  const downloadLink = page.locator("#download-purchase-order-pdf");
  await expect(downloadLink).toHaveAttribute("href", `/api/purchase-orders/${first.id}/pdf`);
  const downloaded = page.waitForEvent("download");
  const downloadedResponse = page.waitForResponse((response) => response.url().endsWith(`/api/purchase-orders/${first.id}/pdf`) && response.request().method() === "GET");
  await downloadLink.click();
  const [download, pdfResponse] = await Promise.all([downloaded, downloadedResponse]);
  expect(pdfResponse.status()).toBe(200);
  expect(await pdfResponse.headerValue("content-type")).toContain("application/pdf");
  expect(await pdfResponse.headerValue("content-disposition")).toContain(`attachment; filename="${first.poNumber}.pdf"`);
  expect(download.suggestedFilename()).toBe(`${first.poNumber}.pdf`);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const pdf = await PDFDocument.load(await readFile(downloadedPath!));
  expect(pdf.getPageCount()).toBe(await document.locator("svg.purchase-order-page").count());
  for (const pdfPage of pdf.getPages()) {
    expect(pdfPage.getWidth()).toBeCloseTo(595.28, 1);
    expect(pdfPage.getHeight()).toBeCloseTo(841.89, 1);
  }
  await page.locator("#print-purchase-order").click();
  await expect.poll(() => page.evaluate(() => window.__poPrintCalls)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("banner")).toBeHidden();
  const actionSections = page.locator(".purchase-order-actions");
  expect(await actionSections.count()).toBeGreaterThan(0);
  for (const section of await actionSections.all()) await expect(section).toBeHidden();
  await expect(page.locator(".purchase-order-pr-status")).toBeHidden();
  await expect(page.locator(".purchase-order-document")).toBeVisible();
  await expect(page.locator(".purchase-order-document")).toContainText(first.poNumber);
});
