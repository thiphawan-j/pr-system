import assert from "node:assert/strict";
import test from "node:test";
import { correctProductSchema, deactivateProductAliasSchema } from "../../src/server/products/product.schemas";
import { correctProduct, deactivateProductAlias, getProductAudit, lockProductRows } from "../../src/server/products/product.service";
import type { SessionUser } from "../../src/lib/types";

const employee = { id: "employee", name: "Employee", role: "EMPLOYEE" } as SessionUser;
test("correction accepts only rename and deactivate with version and reason", () => {
  assert.equal(correctProductSchema.safeParse({ action: "RENAME", name: "Correct name", expectedVersion: 0, reason: "Correct typo" }).success, true);
  assert.equal(correctProductSchema.safeParse({ action: "DEACTIVATE", expectedVersion: 1, reason: "No longer used" }).success, true);
  for (const input of [
    { action: "RENAME", name: "Name", reason: "Correct typo" },
    { action: "RENAME", name: "Name", expectedVersion: 0, reason: "no" },
    { action: "RENAME", name: "Name", expectedVersion: -1, reason: "Correct typo" },
    { action: "RENAME", name: "Name", code: "NEW-CODE", expectedVersion: 0, reason: "Correct typo" },
    { action: "DEACTIVATE", unit: "kg", expectedVersion: 0, reason: "Correct typo" },
    { action: "REACTIVATE", expectedVersion: 0, reason: "Correct typo" },
  ]) assert.equal(correctProductSchema.safeParse(input).success, false);
});
test("alias correction cannot reparent or rename, and requires reason/version", () => {
  const base = { expectedVersion: 0, reason: "Incorrect association" };
  assert.equal(deactivateProductAliasSchema.safeParse(base).success, true);
  for (const input of [{ ...base, name: "Renamed" }, { ...base, productId: "other" }, { reason: base.reason }, { ...base, reason: "" }]) {
    assert.equal(deactivateProductAliasSchema.safeParse(input).success, false);
  }
});
test("employees cannot correct catalog or access audit actors", async () => {
  await assert.rejects(() => correctProduct(employee, "p1", { action: "DEACTIVATE", expectedVersion: 0, reason: "Incorrect product" }), /สิทธิ์/);
  await assert.rejects(() => deactivateProductAlias(employee, "p1", "a1", { expectedVersion: 0, reason: "Incorrect alias" }), /สิทธิ์/);
  await assert.rejects(() => getProductAudit(employee, "p1"), /สิทธิ์/);
});
test("row locks use deduplicated deterministic ordering and parameterized product IDs", async () => {
  const calls: Array<{ values: unknown[]; sql: string }> = [];
  const tx = { $queryRaw: async (query: { values: unknown[]; sql: string }) => { calls.push(query); return []; } };
  await lockProductRows(tx as unknown as Parameters<typeof lockProductRows>[0], ["z", "a", "z", "x';DROP TABLE"]);
  assert.deepEqual(calls.map(c => c.values), [["a"], ["x';DROP TABLE"], ["z"]]);
  assert.ok(calls.every(c => c.sql.endsWith("FOR UPDATE")));
  assert.ok(calls.every(c => !c.sql.includes("DROP TABLE")));
});
