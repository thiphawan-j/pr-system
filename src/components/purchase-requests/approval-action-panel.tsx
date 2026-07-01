"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
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

export function ApprovalActionPanel({
  requestId,
}: ApprovalActionPanelProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();
  const form = useForm<ApprovalFormValues, undefined, ApprovalFormPayload>({
    resolver: zodResolver(approvalDecisionSchema),
    defaultValues: {
      action: "APPROVED",
      comment: "",
    },
  });

  function submit(action: ApprovalFormValues["action"]) {
    form.setValue("action", action);
    form.handleSubmit((values: ApprovalFormPayload) => {
      setIsPending(true);
      startTransition(async () => {
        const response = await fetch(`/api/purchase-requests/${requestId}/approval`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(values),
        });
        const payload = await response.json().catch(() => null);
        setIsPending(false);

        if (!response.ok) {
          toast.error(
            translateMessage(payload?.error, locale) ?? dictionary.approval.saveError,
          );
          return;
        }

        toast.success(dictionary.approval.saveSuccess);
        router.refresh();
      });
    })();
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
            disabled={isPending}
            onClick={() => submit("APPROVED")}
          >
            {dictionary.approval.approve}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="rounded-xl"
            disabled={isPending}
            onClick={() => submit("RETURNED")}
          >
            {dictionary.approval.return}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="rounded-xl"
            disabled={isPending}
            onClick={() => submit("REJECTED")}
          >
            {dictionary.approval.reject}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
