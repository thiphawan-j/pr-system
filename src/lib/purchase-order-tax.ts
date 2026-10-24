export const PURCHASE_PRICE_TAX_MODES = ["UNSPECIFIED", "INCLUSIVE", "EXCLUSIVE", "NONE"] as const;
export type PurchasePriceTaxMode = (typeof PURCHASE_PRICE_TAX_MODES)[number];

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

export function calculateTaxLine(amount: number | string, taxMode: PurchasePriceTaxMode, vatRate = 7) {
  const entered = decimalCents(amount);
  const rate = ratePoints(vatRate);
  if (!PURCHASE_PRICE_TAX_MODES.includes(taxMode)) throw new Error("Invalid VAT mode");
  if (taxMode === "UNSPECIFIED") return { netAmount: null, taxAmount: null, totalAmount: money(entered) };
  if (taxMode === "NONE") return { netAmount: money(entered), taxAmount: 0, totalAmount: money(entered) };
  const tax = taxMode === "INCLUSIVE" ? halfUp(entered * rate, RATE_BASE + rate) : halfUp(entered * rate, RATE_BASE);
  const net = taxMode === "INCLUSIVE" ? entered - tax : entered;
  return { netAmount: money(net), taxAmount: money(tax), totalAmount: money(net + tax) };
}

export type PurchaseOrderTaxItem = { amount: number | string; taxMode?: PurchasePriceTaxMode | null };

export function calculatePurchaseOrderTax(
  items: readonly PurchaseOrderTaxItem[],
  taxMode: PurchasePriceTaxMode = "UNSPECIFIED",
  vatRate = 7,
) {
  ratePoints(vatRate);
  if (!PURCHASE_PRICE_TAX_MODES.includes(taxMode)) throw new Error("Invalid VAT mode");
  let subtotal = ZERO, net = ZERO, tax = ZERO, total = ZERO;
  let hasUnspecifiedTax = false;
  for (const item of items) {
    subtotal += decimalCents(item.amount);
    const line = calculateTaxLine(item.amount, item.taxMode ?? taxMode, vatRate);
    total += decimalCents(line.totalAmount);
    if (line.netAmount === null || line.taxAmount === null) hasUnspecifiedTax = true;
    else {
      net += decimalCents(line.netAmount);
      tax += decimalCents(line.taxAmount);
    }
  }
  return {
    subtotalAmount: money(subtotal),
    netAmount: hasUnspecifiedTax ? null : money(net),
    taxAmount: hasUnspecifiedTax ? null : money(tax),
    totalAmount: money(total),
    hasUnspecifiedTax,
  };
}
