import { expect, test, type Page } from "@playwright/test";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

type Product = { id: string; code: string; name: string; unit: string; version: number; aliases?: { name: string; context: string }[] };
async function createProduct(page: Page, name = uniqueValue("Catalog item")) {
  const response = await page.request.post("/api/products", { data: { code: uniqueValue("E2E-PRODUCT"), name, unit: "ชิ้น" } });
  await expectStatus(response, 201);
  return await response.json() as Product;
}
function payload(item: Record<string, unknown>) {
  return { requestDate: "2026-11-18", department: "Operations", reason: "Synthetic product catalog integration test", urgency: "NORMAL", submit: false,
    items: [{ itemName: "Local department name", quantity: 2, unit: "ชิ้น", unitPrice: 10, amount: 20, ...item }] };
}
async function createDraft(page: Page, item: Record<string, unknown>) {
  const response = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify(payload(item)) } });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  return getRequest(page, id);
}

test("catalog authentication, role restrictions and bounded searches", async ({ page }) => {
  await expectStatus(await page.request.get("/api/products"), 401);
  await authenticate(page, credentials.employee);
  await expectStatus(await page.request.get("/api/products"), 200);
  await expectStatus(await page.request.post("/api/products", { data: { code: "NO-ACCESS", name: "No permission", unit: "kg" } }), 403);
  await expectStatus(await page.request.post("/api/products/missing/aliases", { data: { name: "No permission", confirmed: true } }), 403);
  await expectStatus(await page.request.get("/api/products?limit=51"), 400);
  await expectStatus(await page.request.get("/api/products?page=0"), 400);
  await authenticate(page, credentials.purchasing);
  const product = await createProduct(page);
  await expectStatus(await page.request.post("/api/products", { data: { code: product.code.toLowerCase(), name: "Duplicate code", unit: "kg" } }), 409);
});

test("aliases require confirmation and ambiguous names return distinct canonical identities", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const first = await createProduct(page);
  const second = await createProduct(page);
  const alias = uniqueValue("Shared local spelling");
  await expectStatus(await page.request.post(`/api/products/${first.id}/aliases`, { data: { name: alias } }), 400);
  for (const product of [first, second]) {
    await expectStatus(await page.request.post(`/api/products/${product.id}/aliases`, { data: { name: alias, context: "Production", confirmed: true } }), 201);
  }
  await expectStatus(await page.request.post(`/api/products/${first.id}/aliases`, { data: { name: `  ${alias.toUpperCase()}  `, context: "Production", confirmed: true } }), 409);
  await authenticate(page, credentials.employee);
  const response = await page.request.get("/api/products", { params: { query: alias.toUpperCase(), limit: 1 } });
  await expectStatus(response, 200);
  const result = await response.json() as { items: Product[]; totalCount: number; totalPages: number };
  expect(result.totalCount).toBe(2);
  expect(result.totalPages).toBe(2);
  expect(result.items).toHaveLength(1);
  const next = await page.request.get("/api/products", { params: { query: alias, limit: 1, page: 2 } });
  const secondPage = await next.json() as { items: Product[] };
  expect(new Set([result.items[0].id, secondPage.items[0].id])).toEqual(new Set([first.id, second.id]));
});

test("PR catalog selection requires human confirmation and preserves document spelling", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const product = await createProduct(page);
  await authenticate(page);
  for (const item of [{ productId: product.id }, { productId: "missing-catalog-id", productConfirmed: true, productVersion: 0 }]) {
    await expectStatus(await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify(payload(item)) } }), 400);
  }
  const draft = await createDraft(page, { productId: product.id, productConfirmed: true, productVersion: product.version });
  expect(draft.items[0].itemName).toBe("Local department name");
  expect(draft.items[0].productId).toBe(product.id);
  expect(draft.items[0].productCodeSnapshot).toBe(product.code);
  expect(draft.items[0].productNameSnapshot).toBe(product.name);
  await expectStatus(await page.request.patch(`/api/purchase-requests/${draft.id}`, { multipart: { payload: JSON.stringify(payload({ ...draft.items[0], quantity: 3, productConfirmed: false })) } }), 200);
  let edited = await getRequest(page, draft.id);
  const { productId: _omittedId, ...withoutProductId } = edited.items[0];
  void _omittedId;
  await expectStatus(await page.request.patch(`/api/purchase-requests/${draft.id}`, { multipart: { payload: JSON.stringify(payload({ ...withoutProductId, quantity: 4 })) } }), 200);
  edited = await getRequest(page, draft.id);
  expect(edited.items[0].productId).toBe(product.id);
  expect(edited.items[0].productNameSnapshot).toBe(product.name);
  expect(edited.items[0].itemName).toBe("Local department name");
  await expectStatus(await page.request.patch(`/api/purchase-requests/${draft.id}`, { multipart: { payload: JSON.stringify(payload({ ...edited.items[0], itemName: "Different meaning", productConfirmed: false })) } }), 400);
  await expectStatus(await page.request.patch(`/api/purchase-requests/${draft.id}`, { multipart: { payload: JSON.stringify(payload({ ...edited.items[0], productId: null, productConfirmed: false })) } }), 200);
  expect((await getRequest(page, draft.id)).items[0].productId).toBeNull();
});

test("adding catalog identity and aliases never backfills existing documents or approval history", async ({ page }) => {
  await authenticate(page);
  const localName = uniqueValue("Historical spelling");
  const before = await createDraft(page, { itemName: localName });
  await authenticate(page, credentials.purchasing);
  const product = await createProduct(page, localName);
  await expectStatus(await page.request.post(`/api/products/${product.id}/aliases`, { data: { name: uniqueValue("Alternative spelling"), confirmed: true } }), 201);
  await authenticate(page);
  const after = await getRequest(page, before.id);
  expect(after.items).toEqual(before.items);
  expect(after.approvals).toEqual(before.approvals);
  expect(after.items[0].productId).toBeNull();
  expect(after.items[0].itemName).toBe(localName);
});


test("mobile catalog selector cancels safely, confirms explicitly, and clears when document name changes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticate(page, credentials.purchasing);
  const product = await createProduct(page);
  const alias = uniqueValue("Mobile alias");
  await expectStatus(await page.request.post(`/api/products/${product.id}/aliases`, { data: { name: alias, confirmed: true } }), 201);
  await authenticate(page);
  await page.goto("/purchase-requests/new");
  const itemName = page.locator('input[name="items.0.itemName"]');
  await itemName.fill(alias);
  let writes = 0;
  page.on("request", request => {
    if (request.url().endsWith("/api/purchase-requests") && request.method() === "POST") writes++;
  });
  const open = page.getByRole("button", { name: /ค้นหารหัส \/ ชื่อเรียก|Find code \/ alias/i });
  const dialog = page.getByRole("dialog");
  async function searchAndSelect() {
    await open.click();
    const query = dialog.getByRole("textbox", { name: /ค้นหาสินค้า|Search products/i });
    await expect(query).toHaveValue(alias);
    const search = dialog.getByRole("button", { name: /^(ค้นหา|Search)$/ });
    for (let attempt = 0; attempt < 2; attempt++) {
      await search.click();
      await expect(search).toBeEnabled();
      await expect(dialog.getByRole("button", { name: new RegExp(product.code) })).toBeVisible();
    }
    await dialog.getByRole("button", { name: new RegExp(product.code) }).click();
    await expect(dialog.getByRole("button", { name: /ยืนยันผูกรายการนี้|Confirm this link/i })).toBeVisible();
  }
  await searchAndSelect();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/ยังไม่ผูกรหัสกลาง|No catalog link/i)).toBeVisible();
  await expect(itemName).toHaveValue(alias);
  expect(writes).toBe(0);
  await searchAndSelect();
  await dialog.getByRole("button", { name: /ยืนยันผูกรายการนี้|Confirm this link/i }).click();
  await expect(dialog).toBeHidden();
  const linkLabel = page.getByText(new RegExp(`(?:รหัสกลาง|Product): ${product.code}`));
  await expect(linkLabel).toBeVisible();
  await expect(itemName).toHaveValue(alias);
  // Opening and abandoning another selection must keep the confirmed code label.
  await open.click();
  await page.keyboard.press("Escape");
  await expect(linkLabel).toBeVisible();
  await itemName.fill("Different item name");
  await expect(page.getByText(/ยังไม่ผูกรหัสกลาง|No catalog link/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /ยกเลิกการผูก|^Unlink$/i })).toHaveCount(0);
  await expect(page).toHaveURL(/\/purchase-requests\/new$/);
  expect(writes).toBe(0);
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});
