"use client";

import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { startTransition, useRef, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateMessage } from "@/lib/i18n";

type PurchaseRequestCommentPanelProps = {
  requestId: string;
};

export function PurchaseRequestCommentPanel({
  requestId,
}: PurchaseRequestCommentPanelProps) {
  const router = useRouter();
  const { dictionary, locale } = useI18n();
  const [comment, setComment] = useState("");
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = isPending || router.isPending;

  function handleSubmit() {
    if (pendingRef.current || busy) return;
    const trimmedComment = comment.trim();

    if (!trimmedComment) {
      return;
    }

    pendingRef.current = true;
    setIsPending(true);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/purchase-requests/${requestId}/comments`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ comment: trimmedComment }),
          },
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          toast.error(
            translateMessage(payload?.error, locale) ??
              dictionary.approval.commentError,
          );
          return;
        }

        setComment("");
        toast.success(dictionary.approval.commentSaved);
        router.refresh();
      } catch {
        toast.error(dictionary.approval.commentError);
      } finally {
        pendingRef.current = false;
        setIsPending(false);
      }
    });
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{dictionary.approval.commentTitle}</CardTitle>
        <CardDescription>
          {dictionary.approval.commentDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="purchase-request-comment">
            {dictionary.common.comment}
          </Label>
          <Textarea
            id="purchase-request-comment"
            rows={4}
            maxLength={2000}
            disabled={busy}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={dictionary.approval.commentPlaceholder}
          />
        </div>
        <Button
          type="button"
          className="w-full rounded-xl"
          loading={busy}
          disabled={busy || !comment.trim()}
          onClick={handleSubmit}
        >
          {busy
            ? dictionary.common.saving
            : dictionary.approval.addComment}
        </Button>
      </CardContent>
    </Card>
  );
}
