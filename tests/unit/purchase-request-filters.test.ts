import assert from "node:assert/strict";
import test from "node:test";

import {
  purchaseRequestFiltersSchema,
  purchaseRequestListFiltersSchema,
} from "../../src/server/purchase-requests/purchase-request.schemas";

test("list filters normalize scalar and repeated statuses without duplicates", () => {
  assert.deepEqual(purchaseRequestListFiltersSchema.parse({}).status, []);
  assert.deepEqual(purchaseRequestListFiltersSchema.parse({ status: [] }).status, []);
  assert.deepEqual(purchaseRequestListFiltersSchema.parse({ status: "DRAFT" }).status, ["DRAFT"]);
  assert.deepEqual(purchaseRequestListFiltersSchema.parse({
    status: ["ORDERED", "AWAITING_RECEIPT_REFERENCES", "ORDERED"],
  }).status, ["ORDERED", "AWAITING_RECEIPT_REFERENCES"]);
});

test("all-status sentinels preserve legacy behavior while invalid entries fail validation", () => {
  for (const status of ["ALL", "SUBMITTED", ["DRAFT", "ALL"], ["SUBMITTED", "ORDERED"]]) {
    assert.deepEqual(purchaseRequestListFiltersSchema.parse({ status }).status, []);
  }
  for (const status of ["UNKNOWN", ["DRAFT", "UNKNOWN"], ["ALL", "UNKNOWN"], ["SUBMITTED", "UNKNOWN"], null]) {
    assert.equal(purchaseRequestListFiltersSchema.safeParse({ status }).success, false);
  }
});

test("report filters retain scalar statuses and list filters preserve other criteria", () => {
  assert.equal(purchaseRequestFiltersSchema.parse({}).status, "ALL");
  assert.equal(purchaseRequestFiltersSchema.parse({ status: "DRAFT" }).status, "DRAFT");
  assert.equal(purchaseRequestFiltersSchema.parse({ status: "SUBMITTED" }).status, "ALL");
  assert.equal(purchaseRequestFiltersSchema.safeParse({ status: ["DRAFT", "ORDERED"] }).success, false);
  assert.deepEqual(purchaseRequestListFiltersSchema.parse({
    query: "  receipt documents  ", status: ["DRAFT", "ORDERED"],
    department: "Operations", urgency: "HIGH", preset: "approved",
    from: "2026-10-01", to: "2026-10-31", sort: "oldest",
  }), {
    query: "receipt documents", status: ["DRAFT", "ORDERED"],
    department: "Operations", urgency: "HIGH", preset: "approved",
    from: "2026-10-01", to: "2026-10-31", sort: "pr_asc",
  });
});
