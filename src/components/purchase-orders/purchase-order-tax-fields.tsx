"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/format";
import { calculatePurchaseOrderTax, PURCHASE_PRICE_TAX_MODES, type PurchaseOrderTaxItem, type PurchasePriceTaxMode } from "@/lib/purchase-order-tax";

const selectClass = "h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

export function PurchaseOrderTaxFields({
  idPrefix, taxMode, vatRate, disabled, onTaxModeChange, onVatRateChange, onApplyAll, rateError,
}: {
  idPrefix: string;
  taxMode: PurchasePriceTaxMode;
  vatRate: string;
  disabled?: boolean;
  onTaxModeChange: (value: PurchasePriceTaxMode) => void;
  onVatRateChange: (value: string) => void;
  onApplyAll?: () => void;
  rateError?: string;
}) {
  const { dictionary } = useI18n();
  const labels = dictionary.poTax;
  return <fieldset className="min-w-0 space-y-3 rounded-xl border border-border/70 p-4">
    <legend className="px-1 text-sm font-semibold">{labels.title}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
      <div className="min-w-0 space-y-2">
        <Label htmlFor={`${idPrefix}-tax-mode`}>{labels.headerMode}</Label>
        <select id={`${idPrefix}-tax-mode`} className={selectClass} value={taxMode} disabled={disabled} onChange={(event) => onTaxModeChange(event.target.value as PurchasePriceTaxMode)}>
          {PURCHASE_PRICE_TAX_MODES.map((mode) => <option key={mode} value={mode}>{labels[mode]}</option>)}
        </select>
      </div>
      <div className="min-w-0 space-y-2">
        <Label htmlFor={`${idPrefix}-vat-rate`}>{labels.vatRate}</Label>
        <Input id={`${idPrefix}-vat-rate`} inputMode="decimal" value={vatRate} disabled={disabled} aria-invalid={Boolean(rateError)} aria-describedby={rateError ? `${idPrefix}-vat-rate-error` : undefined} onChange={(event) => onVatRateChange(event.target.value)} />
      </div>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">{labels.headerHint}</p>
    {onApplyAll ? <Button id={`${idPrefix}-apply-tax-all`} type="button" size="sm" variant="outline" disabled={disabled} onClick={onApplyAll}>{labels.applyAll}</Button> : null}
    <details className="text-xs leading-5 text-muted-foreground">
      <summary className="cursor-pointer font-medium">{labels.examples}</summary>
      <div className="space-y-1 pt-2"><p>{labels.exampleExclusive}</p><p>{labels.exampleInclusive}</p></div>
    </details>
  </fieldset>;
}

export function PurchaseOrderItemTaxSelect({ id, value, disabled, onChange }: {
  id: string;
  value: PurchasePriceTaxMode | null;
  disabled?: boolean;
  onChange: (value: PurchasePriceTaxMode | null) => void;
}) {
  const { dictionary } = useI18n();
  return <select id={id} className={selectClass} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value ? event.target.value as PurchasePriceTaxMode : null)}>
    <option value="">{dictionary.poTax.inherit}</option>
    {PURCHASE_PRICE_TAX_MODES.map((mode) => <option key={mode} value={mode}>{dictionary.poTax[mode]}</option>)}
  </select>;
}

export function PurchaseOrderTaxSummary({ items, taxMode = "UNSPECIFIED", vatRate = 7, totalId }: {
  items: readonly PurchaseOrderTaxItem[];
  taxMode?: PurchasePriceTaxMode;
  vatRate?: number;
  totalId?: string;
}) {
  const { dictionary, locale } = useI18n();
  const labels = dictionary.poTax;
  let totals;
  try { totals = calculatePurchaseOrderTax(items, taxMode, vatRate); }
  catch { return <p role="status" className="text-sm text-destructive">{labels.amountInvalid}</p>; }
  return <div className="min-w-0 space-y-3">
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{labels.netAmount}</dt><dd id={totalId ? `${totalId}-net` : undefined} className="font-medium tabular-nums">{totals.netAmount === null ? "—" : formatCurrency(totals.netAmount, locale)}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{labels.taxAmount}</dt><dd id={totalId ? `${totalId}-vat` : undefined} className="font-medium tabular-nums">{totals.taxAmount === null ? "—" : formatCurrency(totals.taxAmount, locale)}</dd></div>
      <div className="flex flex-wrap justify-between gap-3 border-t border-border/70 pt-3"><dt className="font-semibold">{labels.totalAmount}</dt><dd id={totalId} className="text-xl font-semibold text-primary tabular-nums">{formatCurrency(totals.totalAmount, locale)}</dd></div>
    </dl>
    {totals.hasUnspecifiedTax ? <p className="text-xs leading-5 text-muted-foreground">{labels.unknownHint}</p> : null}
    <p className="text-xs leading-5 text-muted-foreground">{labels.roundingHint}</p>
  </div>;
}
