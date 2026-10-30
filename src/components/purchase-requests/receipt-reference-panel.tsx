"use client";

import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { startTransition, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateMessage } from "@/lib/i18n";

type ReceiptReferencePanelProps = {
  requestId: string;
  expectedVersion: number;
  status: "ORDERED" | "COMPLETED";
  receiptNumber?: string | null;
  taxInvoiceNumber?: string | null;
  receiptReferenceNote?: string | null;
};

export function ReceiptReferencePanel({
  requestId,
  expectedVersion,
  status,
  receiptNumber,
  taxInvoiceNumber,
  receiptReferenceNote,
}: ReceiptReferencePanelProps) {
  const router = useRouter();
  const [currentReceiptNumber, setCurrentReceiptNumber] = useState(receiptNumber ?? "");
  const [currentTaxInvoiceNumber, setCurrentTaxInvoiceNumber] = useState(
    taxInvoiceNumber ?? "",
  );
  const [currentNote, setCurrentNote] = useState(receiptReferenceNote ?? "");
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = isPending || router.isPending;
  const { dictionary, locale } = useI18n();

  useEffect(() => {
    setCurrentReceiptNumber(receiptNumber ?? "");
    setCurrentTaxInvoiceNumber(taxInvoiceNumber ?? "");
    setCurrentNote(receiptReferenceNote ?? "");
  }, [receiptNumber, taxInvoiceNumber, receiptReferenceNote]);

  function handleSubmit() {
    if (pendingRef.current || busy) return;
    pendingRef.current = true;
    setIsPending(true);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/purchase-requests/${requestId}/receipt-references`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              expectedVersion,
              receiptNumber: currentReceiptNumber,
              taxInvoiceNumber: currentTaxInvoiceNumber,
              note: currentNote,
            }),
          },
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          toast.error(
            translateMessage(payload?.error, locale) ?? dictionary.approval.updateError,
          );
          if (response.status === 409) router.refresh();
          return;
        }

        toast.success(
          status === "ORDERED"
            ? dictionary.approval.saveReceiptReferencesSuccess
            : dictionary.approval.updateReceiptReferencesSuccess,
        );
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
    <Card id="receipt-reference-panel" className="min-w-0 border-border/70">
      <CardHeader className="border-b">
        <CardTitle>{dictionary.approval.receiptReferenceTitle}</CardTitle>
        {status === "ORDERED" ? (
          <CardDescription>
            {dictionary.approval.receiptReferenceDescription}
            {" "}
            {dictionary.receiptWorkflow.previousDocumentsRequired}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="receipt-number">{dictionary.common.receiptNumber}</Label>
            <Input
              id="receipt-number"
              disabled={busy}
              value={currentReceiptNumber}
              onChange={(event) => setCurrentReceiptNumber(event.target.value)}
              placeholder={dictionary.approval.receiptNumberPlaceholder}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="tax-invoice-number">
              {dictionary.common.taxInvoiceNumber}
            </Label>
            <Input
              id="tax-invoice-number"
              disabled={busy}
              value={currentTaxInvoiceNumber}
              onChange={(event) => setCurrentTaxInvoiceNumber(event.target.value)}
              placeholder={dictionary.approval.taxInvoiceNumberPlaceholder}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="receipt-reference-note">{dictionary.common.comment}</Label>
          <Textarea
            id="receipt-reference-note"
            rows={4}
            disabled={busy}
            value={currentNote}
            onChange={(event) => setCurrentNote(event.target.value)}
            placeholder={dictionary.approval.receiptReferenceNotePlaceholder}
          />
        </div>
        <div className="flex justify-end border-t border-border/70 pt-4">
          <Button
            type="button"
            className="w-full rounded-xl sm:w-auto sm:min-w-44"
            loading={busy}
            disabled={
              busy ||
              (!currentReceiptNumber.trim() && !currentTaxInvoiceNumber.trim())
            }
            onClick={handleSubmit}
          >
            {busy
              ? dictionary.common.saving
              : status === "ORDERED"
                ? dictionary.approval.saveReceiptReferences
                : dictionary.approval.updateReceiptReferences}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
