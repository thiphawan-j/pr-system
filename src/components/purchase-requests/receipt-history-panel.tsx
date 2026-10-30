"use client";

import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { startTransition, useRef, useState } from "react";
import { History } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { translateMessage, translateWorkflowText } from "@/lib/i18n";
import type { PurchaseRequestDetail } from "@/lib/types";

type Receipt = PurchaseRequestDetail["receipts"][number];

function RoundReferences({ requestId, receipt, expectedVersion }: { requestId: string; receipt: Receipt; expectedVersion: number }) {
  const router = useRouter();
  const { dictionary, locale } = useI18n();
  const [receiptNumber, setReceiptNumber] = useState(receipt.receiptNumber ?? "");
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState(receipt.taxInvoiceNumber ?? "");
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = isPending || router.isPending;

  function handleSubmit() {
    if (pendingRef.current || busy) return;
    pendingRef.current = true;
    setIsPending(true);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/purchase-requests/${requestId}/receipts/${receipt.id}/references`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiptNumber, taxInvoiceNumber, expectedVersion }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error(translateMessage(payload?.error, locale) ?? dictionary.approval.updateError);
          if (response.status === 409) router.refresh();
          return;
        }
        toast.success(dictionary.receiptWorkflow.saveReferencesSuccess);
        router.refresh();
      } catch {
        toast.error(dictionary.approval.updateError);
      } finally {
        pendingRef.current = false;
        setIsPending(false);
      }
    });
  }

  return (
    <details className="mt-3 rounded-xl border border-border/70 p-3">
      <summary className="cursor-pointer text-sm font-medium">{dictionary.receiptWorkflow.editRoundReferences}</summary>
      <div className="mt-3 space-y-3">
        <div className="space-y-2">
          <Label htmlFor={`history-receipt-number-${receipt.id}`}>{dictionary.common.receiptNumber}</Label>
          <Input id={`history-receipt-number-${receipt.id}`} disabled={busy} maxLength={200} value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`history-tax-invoice-${receipt.id}`}>{dictionary.common.taxInvoiceNumber}</Label>
          <Input id={`history-tax-invoice-${receipt.id}`} disabled={busy} maxLength={200} value={taxInvoiceNumber} onChange={(event) => setTaxInvoiceNumber(event.target.value)} />
        </div>
        <Button type="button" size="sm" variant="outline" loading={busy} disabled={busy || (!receiptNumber.trim() && !taxInvoiceNumber.trim())} onClick={handleSubmit}>
          {busy ? dictionary.common.saving : dictionary.receiptWorkflow.saveReferences}
        </Button>
      </div>
    </details>
  );
}

export function ReceiptHistoryPanel({
  requestId,
  expectedVersion,
  receipts,
  canEditReferences,
}: {
  requestId: string;
  expectedVersion: number;
  receipts: PurchaseRequestDetail["receipts"];
  canEditReferences: boolean;
}) {
  const { dictionary, locale } = useI18n();
  const labels = dictionary.receiptWorkflow;

  if (!receipts.length) return null;

  return (
    <Card className="border-border/70">
      <CardHeader className="flex flex-row items-center gap-3">
        <History className="size-5 text-primary" />
        <CardTitle>{labels.historyTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {receipts.map((receipt) => (
          <div key={receipt.id} className="rounded-2xl border border-border/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{receipt.action === "RECEIVED" ? labels.receiptRound : labels.closureRound} · {formatDate(receipt.receivedDate, locale)}</p>
              <p className="text-xs text-muted-foreground">{labels.recordedBy} {receipt.recordedBy.name} · {formatDateTime(receipt.createdAt, locale)}</p>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {receipt.items.map((item) => (
                <li key={item.itemId} className="flex justify-between gap-3">
                  <span>{item.itemName}</span>
                  <span className="font-medium">{formatNumber(item.quantity, locale)}</span>
                </li>
              ))}
            </ul>
            {receipt.comment ? <p className="mt-3 whitespace-pre-wrap text-sm"><span className="text-muted-foreground">{receipt.action === "CLOSE_REMAINDER" ? labels.closeReason : dictionary.common.comment}: </span>{translateWorkflowText(receipt.comment, locale)}</p> : null}
            {receipt.overReceiptReason ? <p className="mt-2 whitespace-pre-wrap text-sm text-amber-800 dark:text-amber-200">{labels.overReceiptReason}: {receipt.overReceiptReason}</p> : null}
            {receipt.action === "RECEIVED" ? (
              <div className="mt-3 space-y-1 text-sm">
                <p><span className="text-muted-foreground">{dictionary.common.receiptNumber}: </span>{receipt.receiptNumber || dictionary.common.none}</p>
                <p><span className="text-muted-foreground">{dictionary.common.taxInvoiceNumber}: </span>{receipt.taxInvoiceNumber || dictionary.common.none}</p>
                {canEditReferences ? <RoundReferences key={`${receipt.id}-${receipt.receiptNumber}-${receipt.taxInvoiceNumber}`} requestId={requestId} expectedVersion={expectedVersion} receipt={receipt} /> : null}
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
