"use client";

import type { ReactNode } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { getUnitLabel } from "@/lib/i18n";
import { calculatePurchaseOrderPricing, type PurchaseDiscountType, type PurchasePriceTaxMode } from "@/lib/purchase-order-tax";
import type { PurchaseOrderChange, PurchaseOrderSnapshot } from "@/lib/types";

function Snapshot({ value, title }: { value: PurchaseOrderSnapshot; title: string }) {
  const { dictionary, locale } = useI18n();
  const labels = dictionary.purchaseOrders;
  const taxLabels = dictionary.poTax;
  const discountLabels = dictionary.poDiscount;
  const taxMode = value.taxMode ?? "UNSPECIFIED";
  const vatRate = value.vatRate ?? 7;
  const taxSummary = calculatePurchaseOrderPricing(value.items, taxMode, vatRate, value);
  const hasDiscount = (value.discountType ?? "NONE") !== "NONE" || (value.discountValue ?? 0) !== 0
    || value.items.some((item) => (item.discountType ?? "NONE") !== "NONE" || (item.discountValue ?? 0) !== 0 || (item.orderDiscountAmount ?? 0) !== 0);
  const discountDescription = (type: PurchaseDiscountType | undefined, amount = 0) => type === "PERCENT"
    ? `${formatNumber(amount, locale)}%` : type === "AMOUNT" ? formatCurrency(amount, locale) : discountLabels.NONE;
  const modeLabel = (mode: PurchasePriceTaxMode) => `${taxLabels[mode]}${mode === "INCLUSIVE" || mode === "EXCLUSIVE" ? ` ${formatNumber(vatRate, locale)}%` : ""}`;
  const fields: Array<[string, ReactNode]> = [
    [labels.supplierName, value.supplierName],
    [dictionary.suppliers.code, value.supplierCode],
    [dictionary.suppliers.taxId, value.supplierTaxId],
    [labels.supplierAddress, value.supplierAddress],
    [dictionary.suppliers.contactPerson, value.supplierContactPerson],
    ...value.supplierContacts.map((contact): [string, ReactNode] => [dictionary.suppliers[contact.channel], contact.value]),
    [labels.supplierContact, value.supplierContact],
    [labels.deliveryAddress, value.deliveryAddress],
    [labels.paymentTerms, value.paymentTerms],
    [labels.expectedDeliveryDate, value.expectedDeliveryDate ? formatDate(value.expectedDeliveryDate, locale) : null],
    [labels.note, value.note],
    [taxLabels.headerMode, modeLabel(taxMode)],
    ...(value.vatRate !== undefined ? [[taxLabels.vatRate, `${formatNumber(value.vatRate, locale)}%`] satisfies [string, ReactNode]] : []),
    ...(hasDiscount ? [[discountLabels.orderTitle, discountDescription(value.discountType, value.discountValue)] satisfies [string, ReactNode]] : []),
  ];
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-border/70 p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {fields.map(([label, content], index) => <div key={`${label}-${index}`} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{content || "—"}</dd></div>)}
      </dl>
      <Table>
        <TableHeader><TableRow><TableHead>{dictionary.purchaseRequests.itemList}</TableHead><TableHead className="text-right">{dictionary.purchaseRequests.quantityUnit}</TableHead><TableHead className="text-right">{dictionary.purchaseRequests.unitPrice}</TableHead><TableHead className="text-right">{dictionary.purchaseRequests.lineTotal}</TableHead></TableRow></TableHeader>
        <TableBody>{value.items.map((item, index) => <TableRow key={item.id ?? index}>
          <TableCell className="min-w-40 whitespace-normal align-top"><p className="font-medium break-words">{item.itemName}</p>{item.description ? <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{item.description}</p> : null}<p className="mt-1 text-xs text-muted-foreground">{item.taxMode == null ? `${taxLabels.inherit}: ` : ""}{modeLabel(item.taxMode ?? taxMode)}</p>
            {(item.discountType ?? "NONE") !== "NONE" || (item.discountValue ?? 0) !== 0 ? <p className="mt-1 text-xs text-muted-foreground">{discountLabels.lineTitle}: {discountDescription(item.discountType, item.discountValue)} = {formatCurrency(taxSummary.lines[index]!.itemDiscountAmount, locale)}</p> : null}
            {(value.discountType ?? "NONE") !== "NONE" || (value.discountValue ?? 0) !== 0 || (item.orderDiscountAmount ?? 0) !== 0 ? <p className="mt-1 text-xs text-muted-foreground">{discountLabels.orderDiscountAmount}: {formatCurrency(taxSummary.lines[index]!.orderDiscountAmount, locale)}</p> : null}
          </TableCell>
          <TableCell className="text-right align-top">{formatNumber(item.quantity, locale)} {item.unit ? getUnitLabel(item.unit, locale) : ""}</TableCell>
          <TableCell className="text-right align-top">{formatCurrency(item.unitPrice, locale)}</TableCell>
          <TableCell className="text-right align-top">{formatCurrency(item.amount, locale)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
      <dl className="ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
        {hasDiscount ? <>
          <dt>{discountLabels.subtotalAmount}</dt><dd className="text-right">{formatCurrency(taxSummary.subtotalAmount, locale)}</dd>
          <dt>{discountLabels.itemDiscountAmount}</dt><dd className="text-right">{formatCurrency(taxSummary.itemDiscountAmount, locale)}</dd>
          <dt>{discountLabels.orderDiscountAmount}</dt><dd className="text-right">{formatCurrency(taxSummary.orderDiscountAmount, locale)}</dd>
          <dt>{discountLabels.discountedSubtotalAmount}</dt><dd className="text-right">{formatCurrency(taxSummary.discountedSubtotalAmount, locale)}</dd>
        </> : null}
        <dt>{taxLabels.netAmount}</dt><dd className="text-right">{taxSummary.netAmount === null ? "—" : formatCurrency(taxSummary.netAmount, locale)}</dd>
        <dt>{taxLabels.taxAmount}</dt><dd className="text-right">{taxSummary.taxAmount === null ? "—" : formatCurrency(taxSummary.taxAmount, locale)}</dd>
        <dt className="font-semibold">{dictionary.common.totalAmount}</dt><dd className="text-right font-semibold">{formatCurrency(value.totalAmount, locale)}</dd>
      </dl>
      {taxSummary.hasUnspecifiedTax ? <p className="text-sm text-muted-foreground">{taxLabels.unknownHint}</p> : null}
    </section>
  );
}

export function PurchaseOrderChangeHistory({ changes, pendingChangeId }: { changes: PurchaseOrderChange[]; pendingChangeId: string | null }) {
  const { dictionary, locale } = useI18n();
  const labels = dictionary.poChanges;
  if (!changes.length) return null;
  return (
    <section id="po-change-history" className="space-y-4" aria-labelledby="po-change-history-title">
      <h2 id="po-change-history-title" className="text-xl font-semibold">{labels.history}</h2>
      {changes.map((change) => <Card id={`po-change-${change.id}`} key={change.id} className="border-border/70">
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">{labels.submittedBy}: {change.submittedBy.name}</CardTitle><Badge variant={change.status === "PENDING" ? "secondary" : "outline"}>{labels[change.status]}</Badge></div>
          <p className="text-sm text-muted-foreground">{formatDateTime(change.createdAt, locale)} · {labels.version}: {change.baseVersion}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div><p className="text-sm text-muted-foreground">{labels.reason}</p><p className="whitespace-pre-wrap break-words">{change.reason}</p></div>
          {change.reviewedBy ? <p className="text-sm">{labels.reviewedBy}: {change.reviewedBy.name}{change.reviewedAt ? ` · ${labels.reviewedAt}: ${formatDateTime(change.reviewedAt, locale)}` : ""}</p> : null}
          {change.reviewComment ? <div><p className="text-sm text-muted-foreground">{labels.decisionComment}</p><p className="whitespace-pre-wrap break-words">{change.reviewComment}</p></div> : null}
          <details open={change.id === pendingChangeId} className="space-y-4">
            <summary className="w-fit cursor-pointer rounded text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{labels.compare}</summary>
            <div className="grid gap-4 xl:grid-cols-2"><Snapshot title={labels.before} value={change.before} /><Snapshot title={labels.after} value={change.after} /></div>
          </details>
        </CardContent>
      </Card>)}
    </section>
  );
}
