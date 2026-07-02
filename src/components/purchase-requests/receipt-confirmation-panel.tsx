"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateMessage } from "@/lib/i18n";

type ReceiptConfirmationPanelProps = {
  requestId: string;
};

export function ReceiptConfirmationPanel({
  requestId,
}: ReceiptConfirmationPanelProps) {
  const router = useRouter();
  const [receivedDate, setReceivedDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [comment, setComment] = useState("");
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();

  function handleSubmit() {
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch(`/api/purchase-requests/${requestId}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "RECEIVED",
          receivedDate,
          comment,
        }),
      });
      const payload = await response.json().catch(() => null);
      setIsPending(false);

      if (!response.ok) {
        toast.error(
          translateMessage(payload?.error, locale) ?? dictionary.approval.updateError,
        );
        return;
      }

      toast.success(dictionary.approval.updateSuccess);
      setComment("");
      router.refresh();
    });
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{dictionary.approval.receivedTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="received-date">{dictionary.common.receivedDate}</Label>
          <Input
            id="received-date"
            type="date"
            value={receivedDate}
            onChange={(event) => setReceivedDate(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="receipt-comment">{dictionary.common.comment}</Label>
          <Textarea
            id="receipt-comment"
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={dictionary.approval.receivedCommentPlaceholder}
          />
        </div>
        <Button
          type="button"
          className="w-full rounded-xl"
          disabled={isPending}
          onClick={handleSubmit}
        >
          {isPending ? dictionary.common.saving : dictionary.approval.confirmReceived}
        </Button>
      </CardContent>
    </Card>
  );
}
