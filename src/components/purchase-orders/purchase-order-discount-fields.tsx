"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PurchaseDiscountType } from "@/lib/purchase-order-tax";

export function discountDraftError(type: PurchaseDiscountType, value: string, eligibleCents?: number) {
  if (type === "NONE") return null;
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value.trim())) return "invalid" as const;
  const [whole = "", fraction = ""] = value.trim().split(".");
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 999999999999) return "invalid" as const;
  if (type === "PERCENT" && cents > 10000) return "percentInvalid" as const;
  if (type === "AMOUNT" && eligibleCents !== undefined && cents > eligibleCents) return "exceeds" as const;
  return null;
}

export function PurchaseOrderDiscountFields({
  typeId, valueId, title, discountType, discountValue, disabled, error, onTypeChange, onValueChange,
}: {
  typeId: string;
  valueId: string;
  title?: string;
  discountType: PurchaseDiscountType;
  discountValue: string;
  disabled?: boolean;
  error?: string;
  onTypeChange: (value: PurchaseDiscountType) => void;
  onValueChange: (value: string) => void;
}) {
  const { dictionary } = useI18n();
  const labels = dictionary.poDiscount;
  return <div className="min-w-0 space-y-2">
    {title ? <p className="text-sm font-medium">{title}</p> : null}
    <div className="grid min-w-0 grid-cols-2 gap-3">
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={typeId} className="text-xs text-muted-foreground">{labels.type}</Label>
        <select id={typeId} value={discountType} disabled={disabled} className="h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50" onChange={(event) => onTypeChange(event.target.value as PurchaseDiscountType)}>
          {(["NONE", "AMOUNT", "PERCENT"] as const).map((type) => <option key={type} value={type}>{labels[type]}</option>)}
        </select>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={valueId} className="text-xs text-muted-foreground">{labels.value}{discountType === "NONE" ? "" : ` (${discountType === "PERCENT" ? labels.percent : labels.amount})`}</Label>
        <Input id={valueId} inputMode="decimal" disabled={disabled || discountType === "NONE"} value={discountType === "NONE" ? "0" : discountValue} aria-invalid={Boolean(error)} aria-describedby={error ? `${valueId}-error` : undefined} onChange={(event) => onValueChange(event.target.value)} />
      </div>
    </div>
    {error ? <p id={`${valueId}-error`} className="text-xs text-destructive">{error}</p> : null}
  </div>;
}
