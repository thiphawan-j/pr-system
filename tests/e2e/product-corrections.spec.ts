import { expect, test, type Page } from "@playwright/test";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

type Product = { id: string; code: string; name: string; unit: string; version: number; isActive: boolean; aliases: { id: string; name: string; isActive: boolean }[] };
type Audit = { action: string; before: Record<string, unknown>; after: Record<string, unknown>; actorId: string; reason: string; createdAt: string };
async function createProduct(page: Page) {
  const response = await page.request.post("/api/products", { data: { code: uniqueValue("CORRECTION"), name: uniqueValue("Original catalog name"), unit: "ชิ้น" } });
  await expectStatus(response, 201);
  return await response.json() as Product;
}
async function getProduct(page: Page, code: string, status = "ACTIVE") {
  const response = await page.request.get("/api/products", { params: { query: code, status } });
  await expectStatus(response, 200);
  const data = await response.json() as { items: Product[] };
  const product = data.items.find(item => item.code === code);
  expect(product).toBeDefined();
  return product!;
}
function payload(item: Record<string, unknown>) {
  return { requestDate: "2026-11-18", department: "Operations", reason: "Synthetic catalog correction regression", urgency: "NORMAL", submit: false,
    items: [{ itemName: "Original document spelling", quantity: 1, unit: "ชิ้น", unitPrice: 10, amount: 10, ...item }] };
}
async function createDraft(page: Page, product: Product) {
  const response = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify(payload({ productId: product.id, productConfirmed: true, productVersion: product.version })) } });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  return getRequest(page, id);
}
async function audit(page: Page, id: string) {
  const response = await page.request.get(`/api/products/${id}/audit?page=1`);
  await expectStatus(response, 200);
  return await response.json() as { items: Audit[]; totalCount: number; totalPages: number };
}

test("catalog corrections enforce roles, reasons, immutable identity fields and stale versions", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const original = await createProduct(page);
  await authenticate(page);
  const valid = { action: "RENAME", name: "Corrected spelling", expectedVersion: original.version, reason: "Correct catalog spelling" };
  await expectStatus(await page.request.patch(`/api/products/${original.id}`, { data: valid }), 403);
  await expectStatus(await page.request.get(`/api/products/${original.id}/audit`), 403);
  await expectStatus(await page.request.get("/api/products?status=ALL"), 403);
  await expectStatus(await page.request.get("/api/products?status=INACTIVE"), 403);
  await authenticate(page, credentials.admin);
  for (const data of [{ ...valid, reason: "" }, { ...valid, code: "CHANGED" }, { ...valid, unit: "kg" }, { ...valid, action: "DELETE" }]) {
    await expectStatus(await page.request.patch(`/api/products/${original.id}`, { data }), 400);
  }
  await expectStatus(await page.request.patch(`/api/products/${original.id}`, { data: valid }), 200);
  const corrected = await getProduct(page, original.code);
  expect(corrected).toMatchObject({ id: original.id, code: original.code, name: valid.name, unit: original.unit, version: original.version + 1 });
  await expectStatus(await page.request.patch(`/api/products/${original.id}`, { data: { ...valid, name: "Stale overwrite" } }), 409);
  const history = await audit(page, original.id);
  const rename = history.items.find(entry => entry.reason === valid.reason);
  expect(rename).toMatchObject({ before: { name: original.name }, after: { name: valid.name } });
  expect(rename?.actorId).toBeTruthy();
  expect(Number.isNaN(Date.parse(rename!.createdAt))).toBe(false);
  expect((await getProduct(page, original.code)).name).toBe(valid.name);
});

test("concurrent corrections with one catalog version cannot overwrite one another", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const original = await createProduct(page);
  const names = [uniqueValue("Concurrent A"), uniqueValue("Concurrent B")];
  const responses = await Promise.all(names.map(name => page.request.patch(`/api/products/${original.id}`, { data: { action: "RENAME", name, expectedVersion: original.version, reason: `Correct to ${name}` } })));
  expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
  const winner = responses.findIndex(response => response.status() === 200);
  const corrected = await getProduct(page, original.code);
  expect(corrected.name).toBe(names[winner]);
  expect(corrected.version).toBe(original.version + 1);
  const history = await audit(page, original.id);
  expect(history.items.filter(entry => entry.reason.startsWith("Correct to "))).toHaveLength(1);
});

test("deactivated aliases disappear from matching without reassignment and retain audit history", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const original = await createProduct(page);
  const aliasName = uniqueValue("Wrong contextual alias");
  const added = await page.request.post(`/api/products/${original.id}/aliases`, { data: { name: aliasName, context: "Production", confirmed: true } });
  await expectStatus(added, 201);
  const alias = await added.json() as { id: string };
  let current = await getProduct(page, original.code);
  expect(current.version).toBe(original.version + 1);
  const disable = { expectedVersion: current.version, reason: "Alias belongs to a different product" };
  await authenticate(page);
  await expectStatus(await page.request.patch(`/api/products/${original.id}/aliases/${alias.id}`, { data: disable }), 403);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await page.request.patch(`/api/products/${original.id}/aliases/${alias.id}`, { data: { ...disable, productId: "different-product" } }), 400);
  await expectStatus(await page.request.patch(`/api/products/${original.id}/aliases/${alias.id}`, { data: disable }), 200);
  const result = await page.request.get("/api/products", { params: { query: aliasName } });
  await expectStatus(result, 200);
  expect((await result.json()).items).toHaveLength(0);
  current = await getProduct(page, original.code);
  expect(current.version).toBe(disable.expectedVersion + 1);
  expect(current.aliases.filter(item => item.isActive).map(item => item.id)).not.toContain(alias.id);
  const history = await audit(page, original.id);
  const entry = history.items.find(item => item.reason === disable.reason);
  expect(entry).toBeDefined();
  expect(JSON.stringify(entry)).toContain(aliasName);
  expect(entry?.actorId).toBeTruthy();
  const replacement = uniqueValue("Correct contextual alias");
  await expectStatus(await page.request.post(`/api/products/${original.id}/aliases`, { data: { name: replacement, confirmed: true } }), 201);
  const found = await page.request.get("/api/products", { params: { query: replacement } });
  expect((await found.json()).items.map((item: Product) => item.id)).toContain(original.id);
});

test("master rename and deactivation preserve old snapshots while new stale selections fail", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const original = await createProduct(page);
  await authenticate(page);
  const before = await createDraft(page, original);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await page.request.patch(`/api/products/${original.id}`, { data: { action: "RENAME", name: uniqueValue("Correct new master spelling"), expectedVersion: original.version, reason: "Correct spelling only, preserve documents" } }), 200);
  const renamed = await getProduct(page, original.code);
  await authenticate(page);
  const afterRename = await getRequest(page, before.id);
  expect(afterRename.items).toEqual(before.items);
  expect(afterRename.approvals).toEqual(before.approvals);
  const stale = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify(payload({ productId: original.id, productConfirmed: true, productVersion: original.version })) } });
  await expectStatus(stale, 409);
  const noVersion = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify(payload({ productId: original.id, productConfirmed: true })) } });
  await expectStatus(noVersion, 409);
  const newDraft = await createDraft(page, renamed);
  expect(newDraft.items[0].productNameSnapshot).toBe(renamed.name);
  await authenticate(page, credentials.purchasing);
  await expectStatus(await page.request.patch(`/api/products/${original.id}`, { data: { action: "DEACTIVATE", expectedVersion: renamed.version, reason: "Incorrect identity; use a new product code" } }), 200);
  const inactive = await getProduct(page, original.code, "INACTIVE");
  expect(inactive.isActive).toBe(false);
  expect(inactive.id).toBe(original.id);
  await authenticate(page);
  const result = await page.request.get("/api/products", { params: { query: original.code } });
  expect((await result.json()).items).toHaveLength(0);
  const afterDeactivate = await getRequest(page, before.id);
  expect(afterDeactivate.items).toEqual(before.items.map(item => ({ ...item, productIsActive: false })));
  expect(afterDeactivate.approvals).toEqual(before.approvals);
  await expectStatus(await page.request.patch(`/api/purchase-requests/${before.id}`, { multipart: { payload: JSON.stringify(payload({ ...before.items[0], quantity: 2, productConfirmed: false })) } }), 200);
  const edited = await getRequest(page, before.id);
  expect(edited.items[0].productId).toBe(original.id);
  expect(edited.items[0].productNameSnapshot).toBe(original.name);
  const blocked = await page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify(payload({ productId: original.id, productConfirmed: true, productVersion: inactive.version })) } });
  await expectStatus(blocked, 400);
});

test("concurrent selection and rename never persist a snapshot different from the confirmed version", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const original = await createProduct(page);
  const correctedName = uniqueValue("Concurrent corrected name");
  const [selected, corrected] = await Promise.all([
    page.request.post("/api/purchase-requests", { multipart: { payload: JSON.stringify(payload({ productId: original.id, productConfirmed: true, productVersion: original.version })) } }),
    page.request.patch(`/api/products/${original.id}`, { data: { action: "RENAME", name: correctedName, expectedVersion: original.version, reason: "Race with an explicit document selection" } }),
  ]);
  await expectStatus(corrected, 200);
  expect([200, 409]).toContain(selected.status());
  if (selected.status() === 200) {
    const { id } = await selected.json() as { id: string };
    const document = await getRequest(page, id);
    expect(document.items[0].productNameSnapshot).toBe(original.name);
    expect(document.items[0].productCodeSnapshot).toBe(original.code);
  }
  expect((await getProduct(page, original.code)).name).toBe(correctedName);
});

test("mobile catalog correction cancels without writing, confirms safely and displays its audit trail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticate(page, credentials.purchasing);
  const original = await createProduct(page);
  await page.goto("/products");
  await page.getByRole("textbox", { name: /ค้นหารหัส ชื่อ หรือชื่อเรียก|Search code, name or alias/i }).fill(original.code);
  await page.getByRole("button", { name: /^(ค้นหา|Search)$/ }).click();
  const heading = page.getByRole("heading", { level: 2, name: new RegExp(original.code) });
  const card = page.locator("article").filter({ has: heading });
  await expect(heading).toContainText(original.name);
  let writes = 0;
  page.on("request", request => { if (request.method() === "PATCH" && request.url().endsWith(`/api/products/${original.id}`)) writes++; });
  const rename = card.getByRole("button", { name: /แก้ชื่อกลาง|Correct name/i });
  const dialog = page.getByRole("dialog");
  await rename.click();
  await dialog.locator("#correction-name").fill("Discarded spelling");
  await dialog.locator("#correction-reason").fill("Discarded correction reason");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: /^(ยกเลิก|Cancel)$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(heading).toContainText(original.name);
  expect(writes).toBe(0);
  await rename.click();
  await expect(dialog.locator("#correction-name")).toHaveValue(original.name);
  const corrected = uniqueValue("Corrected mobile name");
  const reason = "Correct a typo without changing product identity";
  await dialog.locator("#correction-name").fill(corrected);
  await dialog.locator("#correction-reason").fill(reason);
  const confirm = dialog.getByRole("button", { name: /ยืนยันบันทึกการแก้ไข|Confirm correction/i });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  const response = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/api/products/${original.id}`));
  await confirm.click();
  expect((await response).status()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(heading).toContainText(corrected);
  expect(writes).toBe(1);
  await card.getByRole("button", { name: /ดูประวัติการแก้ไข|View correction history/i }).click();
  await expect(dialog).toContainText(original.name);
  await expect(dialog).toContainText(corrected);
  await expect(dialog).toContainText(reason);
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: /ปิดใช้งานสินค้า|Deactivate product/i }).click();
  await dialog.locator("#correction-reason").fill("Wrong product record; retain historical documents");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: /ยืนยันบันทึกการแก้ไข|Confirm correction/i }).click();
  await expect(dialog).toBeHidden();
  await expect(heading).toHaveCount(0);
  await page.getByRole("combobox", { name: /สถานะทะเบียน|Catalog status/i }).selectOption("INACTIVE");
  await expect(heading).toContainText(corrected);
  await expect(card.getByRole("button", { name: /แก้ชื่อกลาง|Correct name/i })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /ปิดใช้งานสินค้า|Deactivate product/i })).toHaveCount(0);
  expect(writes).toBe(2);
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});
