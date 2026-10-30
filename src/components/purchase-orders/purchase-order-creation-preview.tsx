"use client";

import { ArrowLeft, Check } from "lucide-react";
import { useEffect, useRef } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { PurchaseOrderDocumentPreview } from "@/components/purchase-orders/purchase-order-document";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { PurchaseOrderCreationPreview } from "@/lib/types";

export function PurchaseOrderCreationPreviewStep({ preview, busy, confirming, error, onBack, onConfirm }: {
  preview: PurchaseOrderCreationPreview;
  busy: boolean;
  confirming: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { dictionary, locale } = useI18n();
  const labels = dictionary.poPreview;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const total = preview.orders.reduce((sum, order) => sum + Math.round(order.totalAmount * 100), 0) / 100;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, []);

  return <section id="po-creation-preview" className="purchase-order-view min-w-0 space-y-6" aria-labelledby="po-creation-preview-title">
    <div className="purchase-order-actions space-y-4 rounded-2xl border border-border/70 bg-card p-4 sm:p-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="po-creation-preview-title" ref={headingRef} tabIndex={-1} className="scroll-mt-28 text-2xl font-semibold focus:outline-none">{labels.title}</h2>
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">{labels.draft}</span>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{labels.description}</p>
      </div>
      <div className="space-y-1 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm leading-6">
        <p className="font-medium">{labels.draftNotice}</p>
        <p className="text-muted-foreground">{labels.documentNumberPending}</p>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <div><dt className="text-sm text-muted-foreground">{labels.orderCount}</dt><dd className="font-semibold">{formatNumber(preview.orders.length, locale)}</dd></div>
        <div><dt className="text-sm text-muted-foreground">{dictionary.poTax.totalAmount}</dt><dd id="po-preview-total" className="font-semibold">{formatCurrency(total, locale)}</dd></div>
      </dl>
      {preview.orders.length > 1 ? <nav aria-label={labels.title}>
        <ol className="flex flex-wrap gap-2">{preview.orders.map((order, index) => <li key={index} className="min-w-0 max-w-full">
          <a href={`#po-preview-order-${index}`} className="block max-w-full rounded-lg border border-border/70 px-3 py-2 text-sm break-words [overflow-wrap:anywhere] hover:bg-muted/40">
            {formatNumber(index + 1, locale)}. {order.supplierName}
          </a>
        </li>)}</ol>
      </nav> : null}
    </div>
    {preview.orders.map((order, index) => <section id={`po-preview-order-${index}`} key={index} className="min-w-0 scroll-mt-24 space-y-3" aria-labelledby={`po-preview-supplier-${index}`}>
      <div className="purchase-order-actions flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border/70 bg-card px-4 py-3">
        <h3 id={`po-preview-supplier-${index}`} className="min-w-0 font-semibold break-words [overflow-wrap:anywhere]">{formatNumber(index + 1, locale)}. {order.supplierName}</h3>
        <p className="text-sm text-muted-foreground">{formatNumber(order.itemCount, locale)} {dictionary.common.itemCount} · {formatCurrency(order.totalAmount, locale)}</p>
      </div>
      <PurchaseOrderDocumentPreview document={order.document} />
    </section>)}
    <div className="purchase-order-actions sticky bottom-0 z-20 space-y-3 rounded-2xl border border-border/70 bg-card/95 p-4 shadow-lg backdrop-blur">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold">{dictionary.poTax.totalAmount}: {formatCurrency(total, locale)}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button id="back-to-po-preparation" type="button" variant="outline" disabled={busy} onClick={onBack}><ArrowLeft />{labels.back}</Button>
          <Button id="confirm-create-purchase-orders" type="button" disabled={busy} loading={confirming} onClick={onConfirm}>
            {!confirming ? <Check /> : null}{confirming ? labels.confirming : labels.confirm}
          </Button>
        </div>
      </div>
    </div>
  </section>;
}
