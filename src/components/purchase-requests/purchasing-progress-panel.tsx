"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
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

type PurchasingAction = "ORDERED" | "REQUEST_REVISION" | "REQUEST_CLARIFICATION";

export function PurchasingProgressPanel({
  requestId,
  status,
}: PurchasingProgressPanelProps) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [pendingAction, setPendingAction] = useState<PurchasingAction | null>(null);
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();

  useEffect(() => {
    setComment("");
  }, [status]);

  function handleSubmit(action: PurchasingAction) {
    if (action !== "ORDERED" && !comment.trim()) {
      toast.error(dictionary.approval.purchasingCommentRequired);
      return;
    }

    setPendingAction(action);
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch(`/api/purchase-requests/${requestId}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          comment,
        }),
      });
      const payload = await response.json().catch(() => null);
      setIsPending(false);
      setPendingAction(null);

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
          <div className="flex flex-wrap gap-2">
            {dictionary.approval.purchasingReturnExamples.map((example) => (
              <Button
                key={example}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={isPending}
                onClick={() =>
                  setComment((currentComment) =>
                    currentComment ? `${currentComment}\n${example}` : example,
                  )
                }
              >
                {example}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          <Button
            type="button"
            className="rounded-xl"
            disabled={isPending}
            onClick={() => handleSubmit("ORDERED")}
          >
            {isPending && pendingAction === "ORDERED"
              ? dictionary.common.saving
              : dictionary.approval.approvePo}
          </Button>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="secondary"
              className="rounded-xl"
              disabled={isPending}
              onClick={() => handleSubmit("REQUEST_CLARIFICATION")}
            >
              {isPending && pendingAction === "REQUEST_CLARIFICATION"
                ? dictionary.common.saving
                : dictionary.approval.requestClarification}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-xl"
              disabled={isPending}
              onClick={() => handleSubmit("REQUEST_REVISION")}
            >
              {isPending && pendingAction === "REQUEST_REVISION"
                ? dictionary.common.saving
                : dictionary.approval.requestRevision}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
