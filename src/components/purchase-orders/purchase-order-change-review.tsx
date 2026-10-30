"use client";

import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateMessage } from "@/lib/i18n";
import type { PurchaseOrderDetail } from "@/lib/types";

export function PurchaseOrderChangeReview({ order }: { order: PurchaseOrderDetail }) {
  const router = useRouter();
  const { dictionary, locale } = useI18n();
  const labels = dictionary.poChanges;
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [comment, setComment] = useState("");
  const [isPending, setIsPending] = useState(false);
  const busy = isPending || router.isPending;
  const [pendingAction, setPendingAction] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  if (!order.pendingChangeId || (!order.canReview && !order.canWithdraw)) return null;

  async function review(action: "APPROVED" | "REJECTED") {
    if (pendingRef.current || router.isPending) return;
    if (action === "REJECTED" && comment.trim().length < 5) { setError(labels.rejectReason); return; }
    pendingRef.current = true;
    setPendingAction(action);
    setIsPending(true);
    setError(null);
    let saved = false;
    try {
      const response = await fetch(`/api/purchase-orders/${order.id}/changes/${order.pendingChangeId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: order.version, action, comment }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(translateMessage(payload?.error, locale) ?? labels.reviewError);
        if (response.status === 409) router.refresh();
        return;
      }
      saved = true;
      toast.success(labels.reviewSaved);
      router.refresh();
    } catch { setError(labels.reviewError); }
    finally { pendingRef.current = false; setIsPending(false); if (!saved) setPendingAction(null); }
  }

  const disabled = busy || !mounted;
  return (
    <Card id="po-change-review" className="border-border/70">
      <CardHeader><CardTitle>{labels.reviewTitle}</CardTitle><CardDescription>{labels.description}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Label htmlFor="po-review-comment">{labels.comment}</Label>
        <Textarea id="po-review-comment" rows={3} maxLength={2000} disabled={disabled} value={comment} onChange={(event) => setComment(event.target.value)} />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2" aria-busy={isPending}>
          {order.canWithdraw ? <Button id="withdraw-po-change" type="button" loading={busy && pendingAction === "REJECTED"} variant="outline" disabled={disabled} onClick={() => review("REJECTED")}>{busy && pendingAction === "REJECTED" ? dictionary.common.saving : labels.withdraw}</Button> : null}
          {order.canReview ? <><Button id="reject-po-change" type="button" loading={busy && pendingAction === "REJECTED"} variant="outline" disabled={disabled} onClick={() => review("REJECTED")}>{busy && pendingAction === "REJECTED" ? dictionary.common.saving : labels.reject}</Button><Button id="approve-po-change" type="button" loading={busy && pendingAction === "APPROVED"} disabled={disabled} onClick={() => review("APPROVED")}>{busy && pendingAction === "APPROVED" ? dictionary.common.saving : labels.approve}</Button></> : null}
        </div>
      </CardContent>
    </Card>
  );
}
