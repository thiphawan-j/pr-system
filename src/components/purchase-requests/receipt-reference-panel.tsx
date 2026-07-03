"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
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
  status: "ORDERED" | "COMPLETED";
  receiptNumber?: string | null;
  taxInvoiceNumber?: string | null;
  receiptReferenceNote?: string | null;
};

export function ReceiptReferencePanel({
  requestId,
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
  const { dictionary, locale } = useI18n();

  useEffect(() => {
    setCurrentReceiptNumber(receiptNumber ?? "");
    setCurrentTaxInvoiceNumber(taxInvoiceNumber ?? "");
    setCurrentNote(receiptReferenceNote ?? "");
  }, [receiptNumber, taxInvoiceNumber, receiptReferenceNote]);

  function handleSubmit() {
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch(
        `/api/purchase-requests/${requestId}/receipt-references`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            receiptNumber: currentReceiptNumber,
            taxInvoiceNumber: currentTaxInvoiceNumber,
            note: currentNote,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      setIsPending(false);

      if (!response.ok) {
        toast.error(
          translateMessage(payload?.error, locale) ?? dictionary.approval.updateError,
        );
        return;
      }

      toast.success(
        status === "ORDERED"
          ? dictionary.approval.saveReceiptReferencesSuccess
          : dictionary.approval.updateReceiptReferencesSuccess,
      );
      router.refresh();
    });
  }

  return (
    <Card id="receipt-reference-panel" className="border-border/70">
      <CardHeader>
        <CardTitle>{dictionary.approval.receiptReferenceTitle}</CardTitle>
        {status === "ORDERED" ? (
          <CardDescription>
            {dictionary.approval.receiptReferenceDescription}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="receipt-number">{dictionary.common.receiptNumber}</Label>
          <Input
            id="receipt-number"
            value={currentReceiptNumber}
            onChange={(event) => setCurrentReceiptNumber(event.target.value)}
            placeholder={dictionary.approval.receiptNumberPlaceholder}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tax-invoice-number">
            {dictionary.common.taxInvoiceNumber}
          </Label>
          <Input
            id="tax-invoice-number"
            value={currentTaxInvoiceNumber}
            onChange={(event) => setCurrentTaxInvoiceNumber(event.target.value)}
            placeholder={dictionary.approval.taxInvoiceNumberPlaceholder}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="receipt-reference-note">{dictionary.common.comment}</Label>
          <Textarea
            id="receipt-reference-note"
            rows={4}
            value={currentNote}
            onChange={(event) => setCurrentNote(event.target.value)}
            placeholder={dictionary.approval.receiptReferenceNotePlaceholder}
          />
        </div>
        <Button
          type="button"
          className="w-full rounded-xl"
          disabled={
            isPending ||
            (!currentReceiptNumber.trim() && !currentTaxInvoiceNumber.trim())
          }
          onClick={handleSubmit}
        >
          {isPending
            ? dictionary.common.saving
            : status === "ORDERED"
              ? dictionary.approval.saveReceiptReferences
              : dictionary.approval.updateReceiptReferences}
        </Button>
      </CardContent>
    </Card>
  );
}
