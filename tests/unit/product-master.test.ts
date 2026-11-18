import assert from "node:assert/strict";
import test from "node:test";
import { createProductAliasSchema, createProductSchema, normalizeProductName, productFiltersSchema } from "../../src/server/products/product.schemas";
import { createProduct, createProductAlias, resolveConfirmedProductLinks } from "../../src/server/products/product.service";
import type { SessionUser } from "../../src/lib/types";

const employee = { id: "employee", role: "EMPLOYEE" } as SessionUser;
const catalog = [{ id: "p1", code: "S0001", name: "Steel", version: 0 }, { id: "p2", code: "X0001", name: "Finished steel", version: 0 }];
function fakeDb() {
  let reads = 0;
  return {
    get reads() { return reads; },
    $queryRaw: async () => [],
    product: { findMany: async () => { reads++; return catalog; } },
  };
}
type LinkDb = Parameters<typeof resolveConfirmedProductLinks>[0];

test("catalog codes normalize but names retain original display spelling", () => {
  assert.deepEqual(createProductSchema.parse({ code: " s0001 ", name: " เหล็ก ", unit: "ชิ้น" }), { code: "S0001", name: "เหล็ก", unit: "ชิ้น" });
  assert.equal(createProductSchema.safeParse({ code: "S 1", name: "Steel", unit: "kg" }).success, false);
});
test("alias association must be explicitly confirmed", () => {
  assert.equal(createProductAliasSchema.safeParse({ name: "steel" }).success, false);
  assert.equal(createProductAliasSchema.safeParse({ name: "steel", confirmed: false }).success, false);
  assert.equal(createProductAliasSchema.safeParse({ name: "steel", confirmed: true }).success, true);
  assert.equal(normalizeProductName(" ＳＴＥＥＬ  Plate "), "steel plate");
});
test("bounded search pagination rejects unbounded queries", () => {
  assert.equal(productFiltersSchema.parse({}).limit, 20);
  for (const input of [{ limit: 51 }, { page: 0 }, { page: 1.5 }, { query: "x".repeat(201) }]) {
    assert.equal(productFiltersSchema.safeParse(input).success, false);
  }
});
test("employees cannot create master records or aliases", async () => {
  await assert.rejects(() => createProduct(employee, { code: "S1", name: "Steel", unit: "kg" }), /สิทธิ์/);
  await assert.rejects(() => createProductAlias(employee, "p1", { name: "Plate", context: "", confirmed: true }), /สิทธิ์/);
});
test("no selection leaves documents unlinked and performs no lookup", async () => {
  const db = fakeDb();
  const result = await resolveConfirmedProductLinks(db as unknown as LinkDb, [{}], "actor");
  assert.equal(result[0].productId, null);
  assert.equal(result[0].productNameSnapshot, null);
  assert.equal(db.reads, 0);
});
test("forged or missing confirmation rejects before catalog lookup", async () => {
  const db = fakeDb();
  await assert.rejects(() => resolveConfirmedProductLinks(db as unknown as LinkDb, [{ productId: "p1" }], "actor"), /ยืนยัน/);
  assert.equal(db.reads, 0);
});
test("explicit links snapshot canonical identity and confirmation actor without transforming item names", async () => {
  const db = fakeDb();
  const result = await resolveConfirmedProductLinks(db as unknown as LinkDb, [{ productId: "p1", productConfirmed: true, productVersion: 0 }, { productId: "p2", productConfirmed: true, productVersion: 0 }], "actor");
  assert.equal(result[0].productCodeSnapshot, "S0001");
  assert.equal(result[0].productNameSnapshot, "Steel");
  assert.equal(result[0].productConfirmedById, "actor");
  assert.ok(result[0].productConfirmedAt instanceof Date);
  assert.equal(result[1].productCodeSnapshot, "X0001");
  assert.equal("itemName" in result[0], false);
});
test("missing and inactive catalog selection is rejected instead of silently dropping link", async () => {
  const db = fakeDb();
  await assert.rejects(() => resolveConfirmedProductLinks(db as unknown as LinkDb, [{ productId: "missing", productConfirmed: true, productVersion: 0 }], "actor"), /ไม่พบสินค้า/);
});

test("new confirmed link must use the current catalog version", async () => {
  const db = fakeDb();
  for (const productVersion of [undefined, 1]) {
    await assert.rejects(() => resolveConfirmedProductLinks(db as unknown as LinkDb, [{ productId: "p1", productConfirmed: true, productVersion }], "actor"), /เปลี่ยนแปลง/);
  }
});
