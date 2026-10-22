"use client";

import { useRouter } from "next/navigation";
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
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  if (!order.pendingChangeId || (!order.canReview && !order.canWithdraw)) return null;

  async function review(action: "APPROVED" | "REJECTED") {
    if (pendingRef.current) return;
    if (action === "REJECTED" && comment.trim().length < 5) { setError(labels.rejectReason); return; }
    pendingRef.current = true;
    setIsPending(true);
    setError(null);
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
      toast.success(labels.reviewSaved);
      router.refresh();
    } catch { setError(labels.reviewError); }
    finally { pendingRef.current = false; setIsPending(false); }
  }

  const disabled = isPending || !mounted;
  return (
    <Card id="po-change-review" className="border-border/70">
      <CardHeader><CardTitle>{labels.reviewTitle}</CardTitle><CardDescription>{labels.description}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Label htmlFor="po-review-comment">{labels.comment}</Label>
        <Textarea id="po-review-comment" rows={3} maxLength={2000} disabled={disabled} value={comment} onChange={(event) => setComment(event.target.value)} />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2" aria-busy={isPending}>
          {order.canWithdraw ? <Button id="withdraw-po-change" type="button" variant="outline" disabled={disabled} onClick={() => review("REJECTED")}>{labels.withdraw}</Button> : null}
          {order.canReview ? <><Button id="reject-po-change" type="button" variant="outline" disabled={disabled} onClick={() => review("REJECTED")}>{labels.reject}</Button><Button id="approve-po-change" type="button" disabled={disabled} onClick={() => review("APPROVED")}>{labels.approve}</Button></> : null}
        </div>
      </CardContent>
    </Card>
  );
}
