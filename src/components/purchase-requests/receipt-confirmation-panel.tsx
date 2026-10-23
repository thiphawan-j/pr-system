"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber, toBangkokDateValue } from "@/lib/format";
import { getUnitLabel, translateMessage } from "@/lib/i18n";
import type { PurchaseRequestDetail } from "@/lib/types";

type ReceiptConfirmationPanelProps = {
  requestId: string;
  expectedVersion: number;
  items: PurchaseRequestDetail["items"];
  canCloseOutstanding: boolean;
};

export function ReceiptConfirmationPanel({
  requestId,
  expectedVersion,
  items,
  canCloseOutstanding,
}: ReceiptConfirmationPanelProps) {
  const router = useRouter();
  const [receivedDate, setReceivedDate] = useState(toBangkokDateValue());
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, String(item.remainingQuantity)])),
  );
  const [comment, setComment] = useState("");
  const [overReceiptReason, setOverReceiptReason] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState("");
  const [closeQuantities, setCloseQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, String(item.remainingQuantity)])),
  );
  const [closeReason, setCloseReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const { dictionary, locale } = useI18n();
  const labels = dictionary.receiptWorkflow;
  const overReceived = items.some(
    (item) => Number(quantities[item.id] || 0) > 0 &&
      Number(quantities[item.id] || 0) + item.receivedQuantity > item.quantity,
  );
  const outstandingItems = items.filter((item) => item.remainingQuantity > 0);

  function submitReceipt(action: "RECEIVED" | "CLOSE_REMAINDER") {
    const isClosure = action === "CLOSE_REMAINDER";
    const selectedQuantities = isClosure ? closeQuantities : quantities;
    const setCurrentError = isClosure ? setCloseError : setError;
    const nextItems = items.map((item) => ({
      itemId: item.id,
      quantity: Number(selectedQuantities[item.id] || 0),
    }));

    if (nextItems.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity < 0)) {
      setCurrentError(labels.invalidQuantity);
      return;
    }
    if (nextItems.some((entry) => entry.quantity > 2147483647 ||
      (!isClosure && entry.quantity + items.find((item) => item.id === entry.itemId)!.receivedQuantity > 2147483647))) {
      setCurrentError(labels.quantityLimit);
      return;
    }
    if (!nextItems.some((item) => item.quantity > 0)) {
      setCurrentError(isClosure ? labels.closeQuantityRequired : labels.quantityRequired);
      return;
    }
    if (isClosure) {
      if (nextItems.some((entry) => entry.quantity > items.find((item) => item.id === entry.itemId)!.remainingQuantity)) {
        setCurrentError(labels.closeQuantityExceeded);
        return;
      }
      if (closeReason.trim().length < 5) {
        setCurrentError(labels.closeReasonRequired);
        return;
      }
    } else {
      if (!receivedDate) {
        setCurrentError(translateMessage("กรุณาระบุวันที่รับของ", locale) ?? dictionary.approval.updateError);
        return;
      }
      if (nextItems.some((entry) => {
        const item = items.find((candidate) => candidate.id === entry.itemId)!;
        return item.closedQuantity > 0 && entry.quantity > item.remainingQuantity;
      })) {
        setCurrentError(labels.closedQuantityLocked);
        return;
      }
      if (overReceived && overReceiptReason.trim().length < 5) {
        setCurrentError(labels.overReceiptReasonRequired);
        return;
      }
    }

    setCurrentError(null);
    setIsPending(true);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/purchase-requests/${requestId}/receipts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            expectedVersion,
            items: nextItems.filter((item) => item.quantity > 0),
            receivedDate: isClosure ? undefined : receivedDate,
            comment: isClosure ? closeReason : comment,
            overReceiptReason: !isClosure && overReceived ? overReceiptReason : undefined,
            receiptNumber: isClosure ? undefined : receiptNumber,
            taxInvoiceNumber: isClosure ? undefined : taxInvoiceNumber,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setCurrentError(translateMessage(payload?.error, locale) ?? dictionary.approval.updateError);
          if (response.status === 409) router.refresh();
          return;
        }
        toast.success(isClosure ? labels.closeSaved : labels.receiptSaved);
        router.refresh();
      } catch {
        setCurrentError(dictionary.approval.updateError);
      } finally {
        setIsPending(false);
      }
    });
  }

  return (
    <>
      <Card className="min-w-0 border-border/70">
        <CardHeader className="border-b">
          <CardTitle>{dictionary.approval.receivedTitle}</CardTitle>
          <CardDescription>{labels.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2 sm:max-w-xs">
            <Label htmlFor="received-date">{dictionary.common.receivedDate}</Label>
            <Input id="received-date" type="date" required disabled={isPending} value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} />
          </div>
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="grid min-w-0 gap-4 rounded-xl border border-border/70 bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)] sm:items-center">
                <div className="min-w-0 space-y-1.5">
                  <p className="font-medium [overflow-wrap:anywhere]">{item.itemName}</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {labels.ordered} {formatNumber(item.quantity, locale)} · {labels.received} {formatNumber(item.receivedQuantity, locale)} · {labels.remaining} {formatNumber(item.remainingQuantity, locale)}
                    {item.unit ? ` ${getUnitLabel(item.unit, locale)}` : ""}
                  </p>
                </div>
                <div className="min-w-0 space-y-2">
                  <Label className="block leading-5 [overflow-wrap:anywhere]" htmlFor={`receipt-quantity-${item.id}`}>{labels.receiveNow} · {item.itemName}</Label>
                  <Input id={`receipt-quantity-${item.id}`} type="number" min="0" max={2147483647 - item.receivedQuantity} step="1" disabled={isPending} value={quantities[item.id] ?? "0"} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} />
                </div>
              </div>
            ))}
          </div>
          {overReceived ? (
            <div className="space-y-3">
              <Alert className="border-amber-500/30 bg-amber-500/10">
                <CircleAlert className="size-4 text-amber-700" />
                <AlertDescription>{labels.overReceiptWarning}</AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="over-receipt-reason">{labels.overReceiptReason}</Label>
                <Textarea id="over-receipt-reason" required aria-required="true" maxLength={2000} disabled={isPending} value={overReceiptReason} onChange={(event) => setOverReceiptReason(event.target.value)} placeholder={labels.overReceiptReasonPlaceholder} />
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="receipt-comment">{dictionary.common.comment}</Label>
            <Textarea id="receipt-comment" rows={3} maxLength={2000} disabled={isPending} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={dictionary.approval.receivedCommentPlaceholder} />
          </div>
          <fieldset className="min-w-0 rounded-xl border border-border/70 p-4">
            <legend className="px-1 text-xs text-muted-foreground">{labels.optionalRoundReferences}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="round-receipt-number">{dictionary.common.receiptNumber}</Label>
                <Input id="round-receipt-number" maxLength={200} disabled={isPending} value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} placeholder={dictionary.approval.receiptNumberPlaceholder} />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="round-tax-invoice-number">{dictionary.common.taxInvoiceNumber}</Label>
                <Input id="round-tax-invoice-number" maxLength={200} disabled={isPending} value={taxInvoiceNumber} onChange={(event) => setTaxInvoiceNumber(event.target.value)} placeholder={dictionary.approval.taxInvoiceNumberPlaceholder} />
              </div>
            </div>
          </fieldset>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end border-t border-border/70 pt-4">
            <Button type="button" className="w-full rounded-xl sm:w-auto sm:min-w-44" disabled={isPending} onClick={() => submitReceipt("RECEIVED")}>
              {isPending ? dictionary.common.saving : dictionary.approval.confirmReceived}
            </Button>
          </div>
        </CardContent>
      </Card>
      {canCloseOutstanding && outstandingItems.length > 0 ? (
        <Card className="min-w-0 border-amber-500/30">
          <CardHeader className="border-b">
            <CardTitle>{labels.closeTitle}</CardTitle>
            <CardDescription>{labels.closeDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {outstandingItems.map((item) => (
              <div key={item.id} className="grid min-w-0 gap-3 rounded-xl border border-border/70 bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)] sm:items-center">
                <div className="min-w-0 space-y-1.5">
                  <Label className="block leading-5 [overflow-wrap:anywhere]" htmlFor={`close-quantity-${item.id}`}>{labels.closeQuantity} · {item.itemName}</Label>
                  <p className="text-xs text-muted-foreground">{labels.remaining}: {formatNumber(item.remainingQuantity, locale)}</p>
                </div>
                <Input id={`close-quantity-${item.id}`} type="number" min="0" max={item.remainingQuantity} step="1" disabled={isPending} value={closeQuantities[item.id] ?? "0"} onChange={(event) => setCloseQuantities((current) => ({ ...current, [item.id]: event.target.value }))} />
              </div>
            ))}
            <div className="space-y-2">
              <Label htmlFor="close-remainder-reason">{labels.closeReason}</Label>
              <Textarea id="close-remainder-reason" required aria-required="true" rows={3} maxLength={2000} disabled={isPending} value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder={labels.closeReasonPlaceholder} />
            </div>
            {closeError ? <p role="alert" className="text-sm text-destructive">{closeError}</p> : null}
            <div className="flex justify-end border-t border-border/70 pt-4">
              <Button type="button" variant="outline" className="w-full rounded-xl sm:w-auto sm:min-w-44" disabled={isPending} onClick={() => submitReceipt("CLOSE_REMAINDER")}>
                {isPending ? dictionary.common.saving : labels.closeOutstanding}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
