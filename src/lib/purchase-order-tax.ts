export const PURCHASE_PRICE_TAX_MODES = ["UNSPECIFIED", "INCLUSIVE", "EXCLUSIVE", "NONE"] as const;
export type PurchasePriceTaxMode = (typeof PURCHASE_PRICE_TAX_MODES)[number];
export const PURCHASE_DISCOUNT_TYPES = ["NONE", "AMOUNT", "PERCENT"] as const;
export type PurchaseDiscountType = (typeof PURCHASE_DISCOUNT_TYPES)[number];
export type PurchaseOrderDiscount = { discountType?: PurchaseDiscountType; discountValue?: number | string };

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);
const RATE_BASE = BigInt(10000);
const MAX_CENTS = BigInt("999999999999");

function decimalCents(value: number | string) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Invalid money precision");
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole!) * HUNDRED + BigInt(fraction.padEnd(2, "0"));
  if (cents > MAX_CENTS) throw new Error("Amount exceeds supported limit");
  return cents;
}

function ratePoints(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("Invalid VAT rate");
  return decimalCents(value);
}

function money(cents: bigint) {
  if (cents < ZERO || cents > MAX_CENTS) throw new Error("Amount exceeds supported limit");
  return Number(cents) / 100;
}

function halfUp(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / BigInt(2)) / denominator;
}

function discountCents(amount: bigint, config: PurchaseOrderDiscount = {}) {
  const type = config.discountType ?? "NONE";
  const value = decimalCents(config.discountValue ?? 0);
  if (!PURCHASE_DISCOUNT_TYPES.includes(type)) throw new Error("Invalid discount type");
  if (type === "NONE") {
    if (value !== ZERO) throw new Error("A disabled discount must be zero");
    return ZERO;
  }
  if (type === "PERCENT" && value > RATE_BASE) throw new Error("Discount percent exceeds 100");
  const discount = type === "PERCENT" ? halfUp(amount * value, RATE_BASE) : value;
  if (discount > amount) throw new Error("Discount exceeds eligible amount");
  return discount;
}

export function calculateTaxLine(
  amount: number | string,
  taxMode: PurchasePriceTaxMode,
  vatRate = 7,
  discount: PurchaseOrderDiscount & { orderDiscountAmount?: number | string } = {},
) {
  const raw = decimalCents(amount);
  const entered = raw - discountCents(raw, discount) - decimalCents(discount.orderDiscountAmount ?? 0);
  if (entered < ZERO) throw new Error("Discount exceeds eligible amount");
  const rate = ratePoints(vatRate);
  if (!PURCHASE_PRICE_TAX_MODES.includes(taxMode)) throw new Error("Invalid VAT mode");
  if (taxMode === "UNSPECIFIED") return { netAmount: null, taxAmount: null, totalAmount: money(entered) };
  if (taxMode === "NONE") return { netAmount: money(entered), taxAmount: 0, totalAmount: money(entered) };
  const tax = taxMode === "INCLUSIVE" ? halfUp(entered * rate, RATE_BASE + rate) : halfUp(entered * rate, RATE_BASE);
  const net = taxMode === "INCLUSIVE" ? entered - tax : entered;
  return { netAmount: money(net), taxAmount: money(tax), totalAmount: money(net + tax) };
}

export type PurchaseOrderTaxItem = PurchaseOrderDiscount & { amount: number | string; taxMode?: PurchasePriceTaxMode | null };

// Allocate integer cents once per PO. Stable position breaks equal remainders
// so preview, approval, PR sources and documents use the same allocations.
function allocateDiscount(discount: bigint, weights: readonly bigint[]) {
  const total = weights.reduce((sum, value) => sum + value, ZERO);
  if (total === ZERO || discount === ZERO) return weights.map(() => ZERO);
  const allocations = weights.map((value) => discount * value / total);
  const remainder = Number(discount - allocations.reduce((sum, value) => sum + value, ZERO));
  const priority = weights.map((value, index) => ({ index, remainder: discount * value % total }))
    .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remainder; index += 1) allocations[priority[index]!.index] += BigInt(1);
  return allocations;
}

export function calculatePurchaseOrderPricing(
  items: readonly PurchaseOrderTaxItem[],
  taxMode: PurchasePriceTaxMode = "UNSPECIFIED",
  vatRate = 7,
  orderDiscount: PurchaseOrderDiscount = {},
) {
  ratePoints(vatRate);
  if (!PURCHASE_PRICE_TAX_MODES.includes(taxMode)) throw new Error("Invalid VAT mode");
  const raw = items.map((item) => decimalCents(item.amount));
  const itemDiscounts = raw.map((amount, index) => discountCents(amount, items[index]!));
  const remaining = raw.map((amount, index) => amount - itemDiscounts[index]!);
  const eligible = remaining.reduce((sum, amount) => sum + amount, ZERO);
  const allocated = allocateDiscount(discountCents(eligible, orderDiscount), remaining);
  let net = ZERO, tax = ZERO, total = ZERO;
  let hasUnspecifiedTax = false;
  const lines = items.map((item, index) => {
    const discountedAmount = remaining[index]! - allocated[index]!;
    const line = calculateTaxLine(money(discountedAmount), item.taxMode ?? taxMode, vatRate);
    total += decimalCents(line.totalAmount);
    if (line.netAmount === null || line.taxAmount === null) hasUnspecifiedTax = true;
    else { net += decimalCents(line.netAmount); tax += decimalCents(line.taxAmount); }
    return {
      amount: money(raw[index]!),
      itemDiscountAmount: money(itemDiscounts[index]!),
      orderDiscountAmount: money(allocated[index]!),
      discountAmount: money(itemDiscounts[index]! + allocated[index]!),
      discountedAmount: money(discountedAmount),
      ...line,
    };
  });
  const itemDiscountAmount = itemDiscounts.reduce((sum, value) => sum + value, ZERO);
  const orderDiscountAmount = allocated.reduce((sum, value) => sum + value, ZERO);
  return {
    subtotalAmount: money(raw.reduce((sum, amount) => sum + amount, ZERO)),
    itemDiscountAmount: money(itemDiscountAmount),
    orderDiscountAmount: money(orderDiscountAmount),
    discountAmount: money(itemDiscountAmount + orderDiscountAmount),
    discountedSubtotalAmount: money(eligible - orderDiscountAmount),
    netAmount: hasUnspecifiedTax ? null : money(net),
    taxAmount: hasUnspecifiedTax ? null : money(tax),
    totalAmount: money(total),
    hasUnspecifiedTax,
    lines,
  };
}

export function calculatePurchaseOrderTax(
  items: readonly PurchaseOrderTaxItem[],
  taxMode: PurchasePriceTaxMode = "UNSPECIFIED",
  vatRate = 7,
  orderDiscount: PurchaseOrderDiscount = {},
) {
  const result = calculatePurchaseOrderPricing(items, taxMode, vatRate, orderDiscount);
  const hasDiscount = [orderDiscount, ...items].some((value) => (value.discountType ?? "NONE") !== "NONE" || Number(value.discountValue ?? 0) !== 0);
  return {
    subtotalAmount: result.subtotalAmount,
    netAmount: result.netAmount,
    taxAmount: result.taxAmount,
    totalAmount: result.totalAmount,
    hasUnspecifiedTax: result.hasUnspecifiedTax,
    ...(hasDiscount ? {
      itemDiscountAmount: result.itemDiscountAmount, orderDiscountAmount: result.orderDiscountAmount,
      discountAmount: result.discountAmount, discountedSubtotalAmount: result.discountedSubtotalAmount,
    } : {}),
  };
}
