"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateMessage } from "@/lib/i18n";
import type { PurchaseRequestStatus } from "@/lib/types";

type PurchasingProgressPanelProps = {
  requestId: string;
  status: PurchaseRequestStatus;
};

export function PurchasingProgressPanel({
  requestId,
  status,
}: PurchasingProgressPanelProps) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();

  const nextAction = status === "APPROVED" ? "ORDERED" : "COMPLETED";
  const nextLabel =
    status === "APPROVED"
      ? dictionary.approval.confirmOrdered
      : dictionary.approval.complete;

  function handleSubmit() {
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch(`/api/purchase-requests/${requestId}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: nextAction,
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
      router.refresh();
    });
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{dictionary.approval.purchasingTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="purchasing-comment">{dictionary.common.comment}</Label>
          <Textarea
            id="purchasing-comment"
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={dictionary.approval.purchasingCommentPlaceholder}
          />
        </div>
        <Button
          type="button"
          className="w-full rounded-xl"
          disabled={isPending}
          onClick={handleSubmit}
        >
          {isPending ? dictionary.common.saving : nextLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
