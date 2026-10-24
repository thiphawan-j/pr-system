import assert from "node:assert/strict";
import test from "node:test";
import { calculatePurchaseOrderTax, calculateTaxLine } from "../../src/lib/purchase-order-tax";

test("exclusive and inclusive prices produce the same payable total without adding VAT twice", () => {
  assert.deepEqual(calculateTaxLine("100.00", "EXCLUSIVE", 7), { netAmount: 100, taxAmount: 7, totalAmount: 107 });
  assert.deepEqual(calculateTaxLine("107.00", "INCLUSIVE", 7), { netAmount: 100, taxAmount: 7, totalAmount: 107 });
});

test("mixed item overrides use the PO basis only for inheriting rows", () => {
  assert.deepEqual(calculatePurchaseOrderTax([
    { amount: 100, taxMode: null }, { amount: 107, taxMode: "INCLUSIVE" }, { amount: 50, taxMode: "NONE" },
  ], "EXCLUSIVE", 7), {
    subtotalAmount: 257, netAmount: 250, taxAmount: 14, totalAmount: 264, hasUnspecifiedTax: false,
  });
});

test("VAT rounds half up by line, including inclusive half-cent ties", () => {
  assert.deepEqual(calculateTaxLine("0.05", "EXCLUSIVE", 10), { netAmount: 0.05, taxAmount: 0.01, totalAmount: 0.06 });
  assert.deepEqual(calculateTaxLine("0.03", "INCLUSIVE", 20), { netAmount: 0.02, taxAmount: 0.01, totalAmount: 0.03 });
  assert.deepEqual(calculateTaxLine("0.01", "INCLUSIVE", 100), { netAmount: 0, taxAmount: 0.01, totalAmount: 0.01 });
  assert.deepEqual(calculatePurchaseOrderTax([{ amount: "0.05" }, { amount: "0.05" }], "EXCLUSIVE", 10), {
    subtotalAmount: 0.1, netAmount: 0.1, taxAmount: 0.02, totalAmount: 0.12, hasUnspecifiedTax: false,
  });
});

test("unknown VAT stays unknown while real zero and no VAT remain zero", () => {
  assert.deepEqual(calculateTaxLine(107, "UNSPECIFIED", 7), { netAmount: null, taxAmount: null, totalAmount: 107 });
  assert.deepEqual(calculateTaxLine(0, "INCLUSIVE", 7), { netAmount: 0, taxAmount: 0, totalAmount: 0 });
  assert.deepEqual(calculateTaxLine(100, "NONE", 7), { netAmount: 100, taxAmount: 0, totalAmount: 100 });
  assert.deepEqual(calculateTaxLine(100, "EXCLUSIVE", 0), { netAmount: 100, taxAmount: 0, totalAmount: 100 });
  assert.deepEqual(calculatePurchaseOrderTax([{ amount: 100 }, { amount: 100, taxMode: "EXCLUSIVE" }]), {
    subtotalAmount: 200, netAmount: null, taxAmount: null, totalAmount: 207, hasUnspecifiedTax: true,
  });
});

test("rates may use two decimal places and large inclusive values remain exact", () => {
  assert.deepEqual(calculateTaxLine(100, "EXCLUSIVE", 7.25), { netAmount: 100, taxAmount: 7.25, totalAmount: 107.25 });
  const result = calculateTaxLine("9999999999.99", "INCLUSIVE", 7);
  assert.equal(result.totalAmount, 9999999999.99);
  assert.equal(Math.round(result.netAmount! * 100) + Math.round(result.taxAmount! * 100), 999999999999);
});

test("invalid precision, rates, and payable overflows fail instead of rounding silently", () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, "1.001", "", "1e2"]) {
    assert.throws(() => calculateTaxLine(value, "EXCLUSIVE", 7));
  }
  for (const rate of [-1, 100.01, 7.001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => calculateTaxLine(100, "INCLUSIVE", rate));
  }
  assert.throws(() => calculateTaxLine("9999999999.99", "EXCLUSIVE", 7));
  assert.throws(() => calculatePurchaseOrderTax([{ amount: "9999999999.99" }, { amount: "0.01" }], "NONE"));
});
