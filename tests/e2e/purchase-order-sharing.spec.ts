import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { Client } from "pg";

import type { PurchaseOrderDetail, PurchaseOrderShareState, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { createRequestViaApi, credentials, uniqueValue } from "./support";

test.setTimeout(90_000);

async function approvedSource(page: Page, privateMarker = uniqueValue("PRIVATE-PR")) {
  await authenticate(page);
  const source = await createRequestViaApi(page, { submit: true, reason: privateMarker });
  await authenticate(page, credentials.admin);
  await expectStatus(await page.request.post(`/api/purchase-requests/${source.id}/approval`, {
    data: { action: "APPROVED", comment: `${privateMarker} internal approval discussion` },
  }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, source.id);
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function issuedOrder(page: Page, sources?: PurchaseRequestDetail[]) {
  const requests = sources ?? [await approvedSource(page)];
  await authenticate(page, credentials.purchasing);
  const response = await page.request.post("/api/purchase-orders", { data: {
    requests: requests.map((source) => ({ id: source.id, expectedUpdatedAt: source.orderPreparationVersion ?? source.updatedAt })),
    orders: [{ supplierName: uniqueValue("Shared supplier"), itemIds: requests.flatMap((source) => source.items.map((item) => item.id)),
      note: "Supplier-facing delivery instructions", deliveryAddress: "Receiving warehouse", paymentTerms: "Net 30",
    }],
  } });
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  return { order: await getOrder(page, purchaseOrders[0]!.id), sources: requests };
}

const endpoint = (orderId: string) => `/api/purchase-orders/${orderId}/share`;
const publicPdf = (path: string) => `${path.replace("/shared/", "/api/shared/")}/pdf`;

async function state(response: Pick<APIResponse, "status" | "text" | "json">) {
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderShareState;
}

async function createShare(page: Page, orderId: string, expiresInDays?: number) {
  const result = await state(await page.request.post(endpoint(orderId), { data: expiresInDays === undefined ? {} : { expiresInDays } }));
  expect(result.isActive).toBe(true);
  expect(result.id).toBeTruthy();
  expect(result.path).toMatch(/^\/shared\/purchase-orders\/[A-Za-z0-9_-]{43}$/);
  return result;
}

function expectLifetime(shared: PurchaseOrderShareState, days: number) {
  expect(shared.expiresInDays).toBe(days);
  const remaining = new Date(shared.expiresAt!).getTime() - Date.now();
  expect(remaining).toBeGreaterThan(days * 86_400_000 - 60_000);
  expect(remaining).toBeLessThanOrEqual(days * 86_400_000);
}

async function unavailable(request: APIRequestContext, path: string) {
  const pdf = await request.get(publicPdf(path));
  await expectStatus(pdf, 404);
  expect(pdf.headers()["cache-control"]).toContain("no-store");
  return await pdf.json() as { error: string };
}

function amendment(order: PurchaseOrderDetail, extra: Record<string, unknown> = {}) {
  return {
    expectedVersion: order.version, reason: uniqueValue("PRIVATE-CHANGE-REASON"),
    supplier: { supplierName: order.supplierName },
    deliveryAddress: order.deliveryAddress ?? "", paymentTerms: order.paymentTerms ?? "",
    note: order.note ?? "",
    items: order.items.map((item) => ({ id: item.id, sourcePurchaseRequestId: item.sourcePurchaseRequestId,
      itemName: item.itemName, description: item.description ?? "", quantity: item.quantity,
      unit: item.unit ?? "", unitPrice: item.unitPrice,
    })), ...extra,
  };
}

async function propose(page: Page, order: PurchaseOrderDetail, extra: Record<string, unknown>) {
  await authenticate(page, credentials.purchasing);
  const response = await page.request.patch(`/api/purchase-orders/${order.id}`, { data: amendment(order, extra) });
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function approve(page: Page, order: PurchaseOrderDetail) {
  await authenticate(page, credentials.admin);
  const response = await page.request.post(`/api/purchase-orders/${order.id}/changes/${order.pendingChangeId}/review`, {
    data: { expectedVersion: order.version, action: "APPROVED", comment: uniqueValue("PRIVATE-REVIEW") },
  });
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function isolatedTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Sharing SQL tests require an explicit isolated E2E database");
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !databaseName.endsWith("_e2e")) {
    throw new Error("Refusing SQL outside a loopback database whose name ends in _e2e");
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function expireOwnShare(orderId: string, shareId: string) {
  const client = await isolatedTestDatabase();
  try {
    const result = await client.query('UPDATE "PurchaseOrderShare" SET "expiresAt" = NOW() - INTERVAL \'1 second\' WHERE "id" = $1 AND "purchaseOrderId" = $2', [shareId, orderId]);
    expect(result.rowCount).toBe(1);
  } finally { await client.end(); }
}

async function markOwnSourceCancelled(sourceId: string, status: "CANCEL_REQUESTED" | "CANCELLED") {
  const client = await isolatedTestDatabase();
  try {
    // The regular cancellation API forbids these states once a PO exists. Own
    // isolated rows reproduce historical states to exercise the public guard.
    const result = await client.query('UPDATE "PurchaseRequest" SET "status" = $2::"PurchaseRequestStatus" WHERE "id" = $1', [sourceId, status]);
    expect(result.rowCount).toBe(1);
  } finally { await client.end(); }
}

test("only purchasing and admin manage supplier links while authenticated and anonymous PO access remain separate", async ({ page, request }) => {
  const { order } = await issuedOrder(page);
  expect(await state(await page.request.get(endpoint(order.id)))).toEqual({ id: null, path: null, expiresAt: null, isActive: false, expiresInDays: 30 });
  const shared = await createShare(page, order.id);
  await authenticate(page, credentials.admin);
  expect((await state(await page.request.get(endpoint(order.id)))).id).toBe(shared.id);
  expect((await state(await page.request.post(endpoint(order.id), { data: {} }))).id).toBe(shared.id);
  for (const account of [credentials.employee, credentials.approver, credentials.management]) {
    await authenticate(page, account);
    await expectStatus(await page.request.get(endpoint(order.id)), 403);
    await expectStatus(await page.request.post(endpoint(order.id), { data: {} }), 403);
    await expectStatus(await page.request.delete(endpoint(order.id), { data: { expectedShareId: shared.id } }), 403);
  }
  await expectStatus(await request.get(endpoint(order.id)), 401);
  await expectStatus(await request.post(endpoint(order.id), { data: {} }), 401);
  await expectStatus(await request.delete(endpoint(order.id), { data: { expectedShareId: shared.id } }), 401);
  await expectStatus(await request.get(`/api/purchase-orders/${order.id}`), 401);
  await expectStatus(await request.get(`/api/purchase-orders/${order.id}/pdf`), 401);
  await expectStatus(await request.get(shared.path!), 200);
});

test("anonymous vendors see only the issued document, can download PDF, and use mobile and print layouts without internal data", async ({ page, browser, baseURL }, testInfo) => {
  const privateMarker = uniqueValue("NEVER-PUBLISH-PR");
  const source = await approvedSource(page, privateMarker);
  await expectStatus(await page.request.post(`/api/purchase-requests/${source.id}/comments`, { data: { comment: `${privateMarker} internal timeline note` } }), 200);
  const { order } = await issuedOrder(page, [await getRequest(page, source.id)]);
  const shared = await createShare(page, order.id);
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 844 } });
  try {
    const vendor = await context.newPage();
    const response = await vendor.goto(shared.path!);
    expect(response?.status()).toBe(200);
    expect(response!.headers()["cache-control"]).toContain("no-store");
    expect(response!.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response!.headers()["x-robots-tag"]).toContain("noindex");
    const html = await response!.text();
    for (const privateValue of [privateMarker, source.id, "po-change-history", `/api/purchase-orders/${order.id}`]) expect(html).not.toContain(privateValue);
    await expect(vendor.locator(".purchase-order-document")).toContainText(order.poNumber);
    await expect(vendor.locator(".purchase-order-document")).toContainText(order.items[0]!.itemName);
    await expect(vendor.locator(".purchase-order-document")).toContainText(order.note!);
    await expect(vendor.locator("#share-po-button")).toHaveCount(0);
    await expect(vendor.getByRole("navigation")).toHaveCount(0);
    await expect.poll(() => vendor.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await vendor.screenshot({ path: testInfo.outputPath("supplier-po-mobile.png"), fullPage: true });
    await vendor.emulateMedia({ media: "print" });
    await expect(vendor.locator(".purchase-order-actions")).toBeHidden();
    await expect(vendor.locator(".purchase-order-document")).toBeVisible();
    await vendor.emulateMedia({ media: "screen" });
    const pdf = await context.request.get(publicPdf(shared.path!));
    await expectStatus(pdf, 200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect(pdf.headers()["content-disposition"]).toContain(`${order.poNumber}.pdf`);
    expect(pdf.headers()["cache-control"]).toContain("no-store");
    expect(pdf.headers()["referrer-policy"]).toBe("no-referrer");
    expect(pdf.headers()["x-robots-tag"]).toContain("noindex");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(vendor.locator('#download-shared-purchase-order-pdf')).toHaveAttribute("href", publicPdf(shared.path!));
  } finally { await context.close(); }
});

test("concurrent share creation reuses one capability and renewal and revocation reject stale management requests", async ({ page, request }) => {
  const { order, sources } = await issuedOrder(page);
  const results = await Promise.all(Array.from({ length: 3 }, async () => state(await page.request.post(endpoint(order.id), { data: {} }))));
  const first = results[0]!;
  expect(first.expiresInDays).toBe(30);
  expect(results.every((result) => result.id === first.id && result.path === first.path)).toBe(true);
  expect(first.path).toMatch(/^\/shared\/purchase-orders\/[A-Za-z0-9_-]{43}$/);
  const lifetime = new Date(first.expiresAt!).getTime() - Date.now();
  expect(lifetime).toBeGreaterThan(29 * 86_400_000);
  expect(lifetime).toBeLessThanOrEqual(30 * 86_400_000);
  const renewed = await state(await page.request.post(endpoint(order.id), { data: { renew: true, expectedShareId: first.id } }));
  expect(renewed.id === first.id).toBe(false);
  expect(renewed.path === first.path).toBe(false);
  await unavailable(request, first.path!);
  await expectStatus(await page.request.post(endpoint(order.id), { data: { renew: true, expectedShareId: first.id } }), 409);
  await expectStatus(await page.request.delete(endpoint(order.id), { data: { expectedShareId: first.id } }), 409);
  await expectStatus(await request.get(publicPdf(renewed.path!)), 200);
  expect((await createShare(page, order.id)).id).toBe(renewed.id);
  const revoked = await state(await page.request.delete(endpoint(order.id), { data: { expectedShareId: renewed.id } }));
  expect(revoked).toMatchObject({ id: renewed.id, path: null, isActive: false });
  await unavailable(request, renewed.path!);
  const replacement = await createShare(page, order.id);
  expect(replacement.id === renewed.id).toBe(false);
  await unavailable(request, first.path!);
  await unavailable(request, renewed.path!);
  const timeline = (await getRequest(page, sources[0]!.id)).approvals.map((entry) => entry.comment ?? "").join("\n");
  expect(timeline).toContain("ลิงก์");
  for (const capability of [first, renewed, replacement]) {
    expect(timeline).not.toContain(capability.path!);
    expect(timeline).not.toContain(capability.path!.split("/").at(-1)!);
  }
});

test("the sharing dialog chooses a lifetime before creation and changes an existing expiry only through explicit renewal", async ({ page, context, request }, testInfo) => {
  const { order } = await issuedOrder(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let postCount = 0;
  page.on("request", (candidate) => {
    if (candidate.method() === "POST" && new URL(candidate.url()).pathname === endpoint(order.id)) postCount++;
  });
  await page.goto(`/purchase-orders/${order.id}`);
  await page.locator("#share-po-button").click();
  const link = page.locator("#share-po-link");
  const lifetime = page.locator("#share-po-lifetime-days");
  await expect(lifetime).toHaveValue("30");
  await expect(page.locator("#create-share-po-link")).toBeEnabled();
  await expect(link).toHaveCount(0);
  expect(postCount).toBe(0);
  await lifetime.fill("7");
  const createdResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === endpoint(order.id));
  await page.locator("#create-share-po-link").click();
  const created = await state(await createdResponse);
  expectLifetime(created, 7);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("readonly", "");
  const firstUrl = await link.inputValue();
  expect(new URL(firstUrl).pathname).toMatch(/^\/shared\/purchase-orders\/[A-Za-z0-9_-]{43}$/);
  await page.locator("#copy-share-po-link").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(firstUrl);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#share-po-button").click();
  await expect(link).toHaveValue(firstUrl);
  await expect(lifetime).toHaveValue("7");
  expect(postCount).toBe(1);
  const originalExpiryText = await page.locator("#share-po-expires-at").textContent();
  await lifetime.fill("14");
  await expect(link).toHaveValue(firstUrl);
  await expect(page.locator("#share-po-expires-at")).toHaveText(originalExpiryText!);
  const unchanged = await state(await page.request.get(endpoint(order.id)));
  expect(unchanged).toEqual(created);
  expect(postCount).toBe(1);
  await page.setViewportSize({ width: 375, height: 667 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(668);
  await page.screenshot({ path: testInfo.outputPath("share-lifetime-mobile.png") });
  const renewedResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === endpoint(order.id));
  await page.locator("#renew-share-po-link").click();
  const renewed = await state(await renewedResponse);
  expectLifetime(renewed, 14);
  await expect.poll(() => link.inputValue()).not.toBe(firstUrl);
  const renewedUrl = await link.inputValue();
  await unavailable(request, new URL(firstUrl).pathname);
  await page.locator("#revoke-share-po-link").click();
  await expect(link).toHaveCount(0);
  await expect(page.locator("#create-share-po-link")).toBeEnabled();
  await unavailable(request, new URL(renewedUrl).pathname);
});

test("custom lifetimes respect their requested duration and active links keep their expiry until explicitly replaced", async ({ page, request }) => {
  const { order } = await issuedOrder(page);
  const first = await createShare(page, order.id, 7);
  expectLifetime(first, 7);
  expect(await state(await page.request.get(endpoint(order.id)))).toEqual(first);
  const reused = await state(await page.request.post(endpoint(order.id), { data: { expiresInDays: 90 } }));
  expect(reused).toEqual(first);
  const minimum = await state(await page.request.post(endpoint(order.id), {
    data: { renew: true, expectedShareId: first.id, expiresInDays: 1 },
  }));
  expectLifetime(minimum, 1);
  expect(minimum.id).not.toBe(first.id);
  await unavailable(request, first.path!);
  const maximum = await state(await page.request.post(endpoint(order.id), {
    data: { renew: true, expectedShareId: minimum.id, expiresInDays: 365 },
  }));
  expectLifetime(maximum, 365);
  await unavailable(request, minimum.path!);
  await expectStatus(await request.get(publicPdf(maximum.path!)), 200);
});

test("invalid link lifetimes are rejected before creating or renewing any share state or timeline", async ({ page }) => {
  const { order, sources } = await issuedOrder(page);
  const beforeSource = await getRequest(page, sources[0]!.id);
  const beforeState = await state(await page.request.get(endpoint(order.id)));
  const invalidDays = [0, -1, 366, 1.5, "7", "", null];
  for (const expiresInDays of invalidDays) {
    await expectStatus(await page.request.post(endpoint(order.id), { data: { expiresInDays } }), 400);
    expect(await state(await page.request.get(endpoint(order.id)))).toEqual(beforeState);
  }
  expect(await getRequest(page, sources[0]!.id)).toEqual(beforeSource);
  expect(await getOrder(page, order.id)).toEqual(order);
  const active = await createShare(page, order.id, 7);
  const afterCreate = await getRequest(page, sources[0]!.id);
  for (const expiresInDays of invalidDays) {
    await expectStatus(await page.request.post(endpoint(order.id), {
      data: { renew: true, expectedShareId: active.id, expiresInDays },
    }), 400);
    expect(await state(await page.request.get(endpoint(order.id)))).toEqual(active);
  }
  expect(await getRequest(page, sources[0]!.id)).toEqual(afterCreate);
});

test("invalid duration never posts and failed creation retains the selected days for retry", async ({ page }) => {
  const { order } = await issuedOrder(page);
  let postCount = 0;
  page.on("request", (candidate) => {
    if (candidate.method() === "POST" && new URL(candidate.url()).pathname === endpoint(order.id)) postCount++;
  });
  await page.goto(`/purchase-orders/${order.id}`);
  await page.locator("#share-po-button").click();
  const lifetime = page.locator("#share-po-lifetime-days");
  const create = page.locator("#create-share-po-link");
  await expect(lifetime).toHaveValue("30");
  for (const value of ["", "0", "1.5", "366"]) {
    await lifetime.fill(value);
    await create.click();
    await expect(page.locator("#share-po-lifetime-error")).toBeVisible();
    await expect(lifetime).toBeFocused();
    expect(postCount).toBe(0);
  }
  const routePattern = `**${endpoint(order.id)}`;
  await page.route(routePattern, (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 500, json: { error: "Temporary link creation failure" } }) : route.continue());
  await lifetime.fill("21");
  await create.click();
  await expect(page.locator("#share-po-error")).toContainText("Temporary link creation failure");
  await expect(create).toBeEnabled();
  await expect(lifetime).toHaveValue("21");
  expect(postCount).toBe(1);
  await page.unroute(routePattern);
  await create.click();
  await expect(page.locator("#share-po-link")).toBeVisible();
  await expect(lifetime).toHaveValue("21");
  expectLifetime(await state(await page.request.get(endpoint(order.id))), 21);
  expect(postCount).toBe(2);
  await lifetime.fill("0");
  await page.locator("#renew-share-po-link").click();
  await expect(page.locator("#share-po-lifetime-error")).toBeVisible();
  await expect(page.locator("#copy-share-po-link")).toBeEnabled();
  await expect(page.locator("#revoke-share-po-link")).toBeEnabled();
  expect(postCount).toBe(2);
});

test("public links show only approved same-supplier revisions and permanently stop exposing the PO after supplier replacement", async ({ page, browser, baseURL }) => {
  const { order } = await issuedOrder(page);
  const shared = await createShare(page, order.id);
  const context = await browser.newContext({ baseURL });
  try {
    const vendor = await context.newPage();
    const pendingItemName = uniqueValue("Revised approved item");
    const privateReason = uniqueValue("PRIVATE-PENDING-REASON");
    const pending = await propose(page, order, { reason: privateReason,
      items: amendment(order).items.map((item) => ({ ...item, itemName: pendingItemName, unitPrice: 333 })),
    });
    await vendor.goto(shared.path!);
    await expect(vendor.locator(".purchase-order-document")).toContainText(order.items[0]!.itemName);
    expect(await vendor.content()).not.toContain(pendingItemName);
    expect(await vendor.content()).not.toContain(privateReason);
    await expect(vendor.locator("#shared-po-revision")).toHaveText("0");
    const approved = await approve(page, pending);
    expect(approved.totalAmount).toBe(666);
    await vendor.reload();
    await expect(vendor.locator(".purchase-order-document")).toContainText(pendingItemName);
    await expect(vendor.locator(".purchase-order-document")).toContainText("666.00");
    await expect(vendor.locator("#shared-po-revision")).toHaveText("1");
    expect(await vendor.content()).not.toContain(privateReason);
    await authenticate(page, credentials.purchasing);
    expect((await state(await page.request.get(endpoint(order.id)))).path === shared.path).toBe(true);
    const supplierChange = await propose(page, approved, { supplier: { supplierName: uniqueValue("Replacement supplier") } });
    await expectStatus(await context.request.get(publicPdf(shared.path!)), 200);
    const replaced = await approve(page, supplierChange);
    await unavailable(context.request, shared.path!);
    expect((await state(await page.request.get(endpoint(order.id)))).isActive).toBe(false);
    const next = await createShare(page, order.id);
    expect(next.path === shared.path).toBe(false);
    await vendor.goto(next.path!);
    await expect(vendor.locator(".purchase-order-document")).toContainText(replaced.supplierName);
    await unavailable(context.request, shared.path!);
  } finally { await context.close(); }
});

test("expired and invalid links return the same unavailable PDF response and creating again never revives an expired capability", async ({ page, request }) => {
  const { order } = await issuedOrder(page);
  const shared = await createShare(page, order.id);
  await expireOwnShare(order.id, shared.id!);
  const expired = await unavailable(request, shared.path!);
  const malformed = await unavailable(request, "/shared/purchase-orders/invalid");
  const unknown = await unavailable(request, `/shared/purchase-orders/${"A".repeat(43)}`);
  expect(expired).toEqual(malformed);
  expect(expired).toEqual(unknown);
  const current = await state(await page.request.get(endpoint(order.id)));
  expect(current).toMatchObject({ id: shared.id, path: null, isActive: false });
  const replacement = await createShare(page, order.id);
  expect(replacement.id === shared.id).toBe(false);
  await expectStatus(await request.get(publicPdf(replacement.path!)), 200);
  await unavailable(request, shared.path!);
});

test("PO cancellation and cancellation of any combined source immediately disable the supplier document", async ({ page, request }) => {
  const { order } = await issuedOrder(page);
  const shared = await createShare(page, order.id);
  await expectStatus(await page.request.post(`/api/purchase-orders/${order.id}/cancellation`, { data: {
    expectedVersion: order.version, reason: "Supplier cannot fulfill this shared purchase order",
  } }), 200);
  await unavailable(request, shared.path!);
  const publicPage = await request.get(shared.path!);
  const unavailableHtml = await publicPage.text();
  expect(unavailableHtml).not.toContain(order.items[0]!.itemName);
  expect(unavailableHtml).not.toContain(order.poNumber);
  expect((await state(await page.request.get(endpoint(order.id)))).isActive).toBe(false);
  await expectStatus(await page.request.post(endpoint(order.id), { data: {} }), 400);
  const a = await approvedSource(page);
  const b = await approvedSource(page);
  const { order: combined } = await issuedOrder(page, [a, b]);
  const combinedShare = await createShare(page, combined.id);
  const nonPrimarySource = [a, b].find((source) => source.id !== combined.purchaseRequest.id)!;
  expect(combined.purchaseRequests?.some((source) => source.id === nonPrimarySource.id)).toBe(true);
  for (const status of ["CANCEL_REQUESTED", "CANCELLED"] as const) {
    await markOwnSourceCancelled(nonPrimarySource.id, status);
    await unavailable(request, combinedShare.path!);
    const unavailablePage = await request.get(combinedShare.path!);
    const combinedHtml = await unavailablePage.text();
    expect(combinedHtml).not.toContain(combined.items[0]!.itemName);
    expect(combinedHtml).not.toContain(combined.poNumber);
    expect((await state(await page.request.get(endpoint(combined.id)))).isActive).toBe(false);
    await expectStatus(await page.request.post(endpoint(combined.id), { data: {} }), 400);
  }
});
