"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { startTransition, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateMessage } from "@/lib/i18n";
import { approvalDecisionSchema } from "@/server/purchase-requests/purchase-request.schemas";

type ApprovalActionPanelProps = {
  requestId: string;
};

type ApprovalFormValues = z.input<typeof approvalDecisionSchema>;
type ApprovalFormPayload = z.output<typeof approvalDecisionSchema>;
type ApprovalAction = ApprovalFormValues["action"];

const approvalRequestTimeoutMs = 20_000;

export function ApprovalActionPanel({
  requestId,
}: ApprovalActionPanelProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<ApprovalAction | null>(null);
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = isPending || router.isPending;
  const { dictionary, locale } = useI18n();
  const form = useForm<ApprovalFormValues, undefined, ApprovalFormPayload>({
    resolver: zodResolver(approvalDecisionSchema),
    defaultValues: {
      action: "APPROVED",
      comment: "",
    },
  });

  function submit(action: ApprovalAction) {
    if (pendingRef.current || busy) return;
    pendingRef.current = true;
    form.setValue("action", action);
    void form.handleSubmit((values: ApprovalFormPayload) => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        approvalRequestTimeoutMs,
      );

      setPendingAction(action);
      setIsPending(true);
      startTransition(async () => {
        let saved = false;
        try {
          const response = await fetch(
            `/api/purchase-requests/${requestId}/approval`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(values),
              signal: controller.signal,
            },
          );
          const payload = await response.json().catch(() => null);

          if (!response.ok) {
            toast.error(
              translateMessage(payload?.error, locale) ?? dictionary.approval.saveError,
            );
            return;
          }

          saved = true;
          toast.success(dictionary.approval.saveSuccess);
          router.refresh();
        } catch {
          toast.error(
            dictionary.approval.saveError,
          );
        } finally {
          window.clearTimeout(timeoutId);
          pendingRef.current = false;
          setIsPending(false);
          if (!saved) setPendingAction(null);
        }
      });
    }, () => { pendingRef.current = false; })().catch(() => {
      pendingRef.current = false;
      setIsPending(false);
      setPendingAction(null);
      toast.error(dictionary.approval.saveError);
    });
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{dictionary.approval.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="approval-comment">
            {dictionary.approval.decisionComment}
          </Label>
          <Textarea
            id="approval-comment"
            rows={4}
            disabled={busy}
            placeholder={dictionary.approval.decisionPlaceholder}
            {...form.register("comment")}
          />
          {form.formState.errors.comment ? (
            <p className="text-xs text-destructive">
              {translateMessage(form.formState.errors.comment.message, locale)}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            type="button"
            className="rounded-xl"
            disabled={busy}
            loading={busy && pendingAction === "APPROVED"}
            onClick={() => submit("APPROVED")}
          >
            {busy && pendingAction === "APPROVED"
              ? dictionary.common.saving
              : dictionary.approval.approve}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="rounded-xl"
            disabled={busy}
            loading={busy && pendingAction === "RETURNED"}
            onClick={() => submit("RETURNED")}
          >
            {busy && pendingAction === "RETURNED"
              ? dictionary.common.saving
              : dictionary.approval.return}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="rounded-xl"
            disabled={busy}
            loading={busy && pendingAction === "REJECTED"}
            onClick={() => submit("REJECTED")}
          >
            {busy && pendingAction === "REJECTED"
              ? dictionary.common.saving
              : dictionary.approval.reject}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
