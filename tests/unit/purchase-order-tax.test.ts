import assert from "node:assert/strict";
import test from "node:test";
import { calculatePurchaseOrderPricing, calculatePurchaseOrderTax, calculateTaxLine } from "../../src/lib/purchase-order-tax";

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

test("item discounts reduce the entered price before adding or splitting VAT", () => {
  assert.deepEqual(calculateTaxLine(100, "EXCLUSIVE", 7, { discountType: "PERCENT", discountValue: 10 }), { netAmount: 90, taxAmount: 6.3, totalAmount: 96.3 });
  assert.deepEqual(calculateTaxLine(107, "INCLUSIVE", 7, { discountType: "AMOUNT", discountValue: 10.7 }), { netAmount: 90, taxAmount: 6.3, totalAmount: 96.3 });
  assert.deepEqual(calculateTaxLine(100, "UNSPECIFIED", 7, { discountType: "AMOUNT", discountValue: 10 }), { netAmount: null, taxAmount: null, totalAmount: 90 });
});

test("item discounts apply before the PO discount and stored PR allocations reproduce each payable line", () => {
  const result = calculatePurchaseOrderPricing([
    { amount: 100, discountType: "PERCENT", discountValue: 10 }, { amount: 100 },
  ], "EXCLUSIVE", 7, { discountType: "PERCENT", discountValue: 10 });
  assert.equal(result.subtotalAmount, 200);
  assert.equal(result.itemDiscountAmount, 10);
  assert.equal(result.orderDiscountAmount, 19);
  assert.equal(result.discountAmount, 29);
  assert.equal(result.discountedSubtotalAmount, 171);
  assert.equal(result.netAmount, 171);
  assert.equal(result.taxAmount, 11.97);
  assert.equal(result.totalAmount, 182.97);
  assert.deepEqual(result.lines.map((line) => line.orderDiscountAmount), [9, 10]);
  assert.deepEqual(calculateTaxLine(100, "EXCLUSIVE", 7, { discountType: "PERCENT", discountValue: 10, orderDiscountAmount: 9 }), {
    netAmount: result.lines[0]!.netAmount, taxAmount: result.lines[0]!.taxAmount, totalAmount: result.lines[0]!.totalAmount,
  });
});

test("a shared percentage or amount preserves mixed inclusive and exclusive price bases", () => {
  for (const discount of [{ discountType: "PERCENT" as const, discountValue: 10 }, { discountType: "AMOUNT" as const, discountValue: 20.7 }]) {
    const result = calculatePurchaseOrderPricing([{ amount: 100 }, { amount: 107, taxMode: "INCLUSIVE" }], "EXCLUSIVE", 7, discount);
    assert.deepEqual(result.lines.map((line) => line.orderDiscountAmount), [10, 10.7]);
    assert.equal(result.netAmount, 180);
    assert.equal(result.taxAmount, 12.6);
    assert.equal(result.totalAmount, 192.6);
  }
});

test("PO discount cents use stable largest remainders and never allocate to zero-value rows", () => {
  const equal = calculatePurchaseOrderPricing([{ amount: 1 }, { amount: 1 }, { amount: 1 }], "NONE", 7, { discountType: "AMOUNT", discountValue: 0.01 });
  assert.deepEqual(equal.lines.map((line) => line.orderDiscountAmount), [0.01, 0, 0]);
  assert.equal(equal.totalAmount, 2.99);
  const varied = calculatePurchaseOrderPricing([{ amount: 0 }, { amount: 1 }, { amount: 2 }], "NONE", 7, { discountType: "AMOUNT", discountValue: 0.02 });
  assert.deepEqual(varied.lines.map((line) => line.orderDiscountAmount), [0, 0.01, 0.01]);
  assert.equal(varied.totalAmount, 2.98);
});

test("fully discounted rows contribute zero weight and full discounts produce actual zero tax", () => {
  const result = calculatePurchaseOrderPricing([{ amount: 100, discountType: "PERCENT", discountValue: 100 }, { amount: 100 }], "EXCLUSIVE", 7, { discountType: "AMOUNT", discountValue: 100 });
  assert.deepEqual(result.lines.map((line) => line.orderDiscountAmount), [0, 100]);
  assert.equal(result.discountAmount, 200);
  assert.equal(result.netAmount, 0);
  assert.equal(result.taxAmount, 0);
  assert.equal(result.totalAmount, 0);
  assert.equal(calculatePurchaseOrderPricing([{ amount: 0 }], "NONE", 7, { discountType: "PERCENT", discountValue: 100 }).totalAmount, 0);
});

test("unknown VAT remains unknown after discounts and legacy no-discount result shapes stay unchanged", () => {
  const result = calculatePurchaseOrderTax([{ amount: 100, discountType: "PERCENT", discountValue: 10 }]);
  assert.equal(result.netAmount, null);
  assert.equal(result.taxAmount, null);
  assert.equal(result.totalAmount, 90);
  assert.equal(result.discountAmount, 10);
  assert.equal(result.discountedSubtotalAmount, 90);
  assert.deepEqual(calculatePurchaseOrderTax([{ amount: 100, discountType: "NONE", discountValue: 0 }], "NONE", 7, { discountType: "NONE", discountValue: 0 }), {
    subtotalAmount: 100, netAmount: 100, taxAmount: 0, totalAmount: 100, hasUnspecifiedTax: false,
  });
});

test("invalid discounts reject excessive, negative, fractional-precision and disabled nonzero amounts", () => {
  for (const discount of [
    { discountType: "AMOUNT" as const, discountValue: 100.01 },
    { discountType: "PERCENT" as const, discountValue: 100.01 },
    { discountType: "AMOUNT" as const, discountValue: -1 },
    { discountType: "PERCENT" as const, discountValue: 1.001 },
    { discountType: "NONE" as const, discountValue: 1 },
  ]) assert.throws(() => calculatePurchaseOrderPricing([{ amount: 100 }], "NONE", 7, discount));
  assert.throws(() => calculatePurchaseOrderPricing([{ amount: 100, discountType: "AMOUNT", discountValue: 20 }], "NONE", 7, { discountType: "AMOUNT", discountValue: 81 }));
  assert.throws(() => calculateTaxLine(100, "NONE", 7, { discountType: "PERCENT", discountValue: 50, orderDiscountAmount: 50.01 }));
  assert.throws(() => calculatePurchaseOrderPricing([{ amount: 0 }], "NONE", 7, { discountType: "AMOUNT", discountValue: 0.01 }));
});
