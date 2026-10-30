"use client";

import Link from "@/components/loading/navigation-link";
import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { startTransition, useEffect, useRef, useState } from "react";
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
  allowExternalOrder?: boolean;
};

type PurchasingAction = "ORDERED" | "REQUEST_REVISION" | "REQUEST_CLARIFICATION";

export function PurchasingProgressPanel({
  requestId,
  status,
  allowExternalOrder = true,
}: PurchasingProgressPanelProps) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [pendingAction, setPendingAction] = useState<PurchasingAction | null>(null);
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = isPending || router.isPending;
  const { dictionary, locale } = useI18n();

  useEffect(() => {
    setComment("");
  }, [status]);

  function handleSubmit(action: PurchasingAction) {
    if (pendingRef.current || busy) return;
    if (action !== "ORDERED" && !comment.trim()) {
      toast.error(dictionary.approval.purchasingCommentRequired);
      return;
    }

    setPendingAction(action);
    pendingRef.current = true;
    setIsPending(true);
    startTransition(async () => {
      let saved = false;
      try {
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

        if (!response.ok) {
          toast.error(
            translateMessage(payload?.error, locale) ?? dictionary.approval.updateError,
          );
          return;
        }

        saved = true;
        toast.success(dictionary.approval.updateSuccess);
        setComment("");
        router.refresh();
      } catch {
        toast.error(dictionary.approval.updateError);
      } finally {
        pendingRef.current = false;
        setIsPending(false);
        if (!saved) setPendingAction(null);
      }
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
            disabled={busy}
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
                disabled={busy}
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
          <Button asChild className="rounded-xl">
            <Link
              id="convert-pr-to-po"
              href={`/purchase-requests/${requestId}/purchase-orders/new`}
              aria-disabled={busy}
              tabIndex={busy ? -1 : undefined}
              onClick={(event) => { if (busy) event.preventDefault(); }}
            >
              {dictionary.purchaseOrders.convert}
            </Link>
          </Button>
          {allowExternalOrder ? <>
          <p className="text-xs text-muted-foreground">{dictionary.purchaseOrders.externalPoHint}</p>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            disabled={busy}
            loading={busy && pendingAction === "ORDERED"}
            onClick={() => handleSubmit("ORDERED")}
          >
            {busy && pendingAction === "ORDERED"
              ? dictionary.common.saving
              : dictionary.approval.approvePo}
          </Button>
          </> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="secondary"
              className="rounded-xl"
              disabled={busy}
              loading={busy && pendingAction === "REQUEST_CLARIFICATION"}
            onClick={() => handleSubmit("REQUEST_CLARIFICATION")}
            >
              {busy && pendingAction === "REQUEST_CLARIFICATION"
                ? dictionary.common.saving
                : dictionary.approval.requestClarification}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-xl"
              disabled={busy}
              loading={busy && pendingAction === "REQUEST_REVISION"}
            onClick={() => handleSubmit("REQUEST_REVISION")}
            >
              {busy && pendingAction === "REQUEST_REVISION"
                ? dictionary.common.saving
                : dictionary.approval.requestRevision}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
