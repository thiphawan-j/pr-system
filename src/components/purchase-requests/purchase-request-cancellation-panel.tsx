"use client";

import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { startTransition, useRef, useState } from "react";
import { Ban, Check, Trash2, X } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateMessage } from "@/lib/i18n";

export type PurchaseRequestCancellationMode =
  | "DELETE_DRAFT"
  | "CANCEL_DIRECT"
  | "REQUEST"
  | "REVIEW"
  | "CANCEL_ORDERED";

type CancellationAction = "DELETE" | "CANCEL" | "REQUEST" | "CONFIRM" | "REJECT";

type PurchaseRequestCancellationPanelProps = {
  requestId: string;
  mode: PurchaseRequestCancellationMode;
  requestedReason?: string | null;
};

export function PurchaseRequestCancellationPanel({
  requestId,
  mode,
  requestedReason,
}: PurchaseRequestCancellationPanelProps) {
  const router = useRouter();
  const { dictionary, locale } = useI18n();
  const [dialogAction, setDialogAction] = useState<CancellationAction | null>(null);
  const [reason, setReason] = useState("");
  const [cancellationReference, setCancellationReference] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = isPending || router.isPending;

  const isOrderedCancellation = mode === "CANCEL_ORDERED";
  const requiresReason =
    dialogAction === "CANCEL" ||
    dialogAction === "REQUEST" ||
    dialogAction === "REJECT";

  function resetDialog() {
    setDialogAction(null);
    setReason("");
    setCancellationReference("");
    setReasonError(null);
    setReferenceError(null);
  }

  function closeDialog() {
    if (!busy) {
      resetDialog();
    }
  }

  function openDialog(action: CancellationAction) {
    if (pendingRef.current || busy) return;
    setReason("");
    setCancellationReference("");
    setReasonError(null);
    setReferenceError(null);
    setDialogAction(action);
  }

  function validate() {
    const nextReasonError =
      requiresReason && reason.trim().length < 5
        ? dictionary.cancellation.reasonRequired
        : null;
    const nextReferenceError =
      dialogAction === "CANCEL" &&
      isOrderedCancellation &&
      !cancellationReference.trim()
        ? dictionary.cancellation.referenceRequired
        : null;

    setReasonError(nextReasonError);
    setReferenceError(nextReferenceError);

    return !nextReasonError && !nextReferenceError;
  }

  function handleSubmit() {
    if (pendingRef.current || busy) return;
    if (!dialogAction || !validate()) {
      return;
    }

    pendingRef.current = true;
    setIsPending(true);
    startTransition(async () => {
      try {
        const response =
          dialogAction === "DELETE"
            ? await fetch(`/api/purchase-requests/${requestId}`, {
                method: "DELETE",
              })
            : await fetch(`/api/purchase-requests/${requestId}/cancellation`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  action: dialogAction,
                  reason,
                  cancellationReference:
                    dialogAction === "CANCEL" && isOrderedCancellation
                      ? cancellationReference
                      : undefined,
                }),
              });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          toast.error(
            translateMessage(payload?.error, locale) ??
              (dialogAction === "DELETE"
                ? dictionary.cancellation.deleteDraftError
                : dictionary.cancellation.updateError),
          );
          return;
        }

        const successMessage =
          dialogAction === "DELETE"
            ? dictionary.cancellation.deleteDraftSuccess
            : dialogAction === "REQUEST"
              ? dictionary.cancellation.requestSuccess
              : dialogAction === "CONFIRM"
                ? dictionary.cancellation.confirmSuccess
                : dialogAction === "REJECT"
                  ? dictionary.cancellation.declineSuccess
                  : dictionary.cancellation.cancelSuccess;

        toast.success(successMessage);
        resetDialog();

        if (dialogAction === "DELETE") {
          router.replace("/purchase-requests");
          return;
        }

        router.refresh();
      } catch {
        toast.error(
          dialogAction === "DELETE"
            ? dictionary.cancellation.deleteDraftError
            : dictionary.cancellation.updateError,
        );
      } finally {
        pendingRef.current = false;
        setIsPending(false);
      }
    });
  }

  const singleAction =
    mode === "DELETE_DRAFT"
      ? ("DELETE" as const)
      : mode === "REQUEST"
        ? ("REQUEST" as const)
        : mode === "REVIEW"
          ? null
          : ("CANCEL" as const);
  const cardDescription =
    mode === "DELETE_DRAFT"
      ? dictionary.cancellation.deleteDraftDescription
      : mode === "REQUEST"
        ? dictionary.cancellation.requestDescription
        : mode === "REVIEW"
          ? dictionary.cancellation.reviewDescription
          : mode === "CANCEL_ORDERED"
            ? dictionary.cancellation.orderedDescription
            : dictionary.cancellation.directDescription;
  const dialogTitle =
    dialogAction === "DELETE"
      ? dictionary.cancellation.deleteDraftTitle
      : dialogAction === "REQUEST"
        ? dictionary.cancellation.requestTitle
        : dialogAction === "CONFIRM" || dialogAction === "REJECT"
          ? dictionary.cancellation.reviewTitle
          : isOrderedCancellation
            ? dictionary.cancellation.orderedTitle
            : dictionary.cancellation.directTitle;

  return (
    <>
      <Card className="border-destructive/25">
        <CardHeader>
          <CardTitle>
            {mode === "REVIEW"
              ? dictionary.cancellation.reviewTitle
              : dictionary.cancellation.title}
          </CardTitle>
          <CardDescription>{cardDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "REVIEW" && requestedReason ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                {dictionary.cancellation.reasonLabel}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{requestedReason}</p>
            </div>
          ) : null}

          {mode === "REVIEW" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="destructive"
                className="rounded-xl"
                disabled={busy}
                onClick={() => openDialog("CONFIRM")}
              >
                <Check />
                {dictionary.cancellation.confirmCancellation}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={busy}
                onClick={() => openDialog("REJECT")}
              >
                <X />
                {dictionary.cancellation.declineCancellation}
              </Button>
            </div>
          ) : singleAction ? (
            <Button
              type="button"
              variant="destructive"
              className="w-full rounded-xl"
              disabled={busy}
              onClick={() => openDialog(singleAction)}
            >
              {singleAction === "DELETE" ? <Trash2 /> : <Ban />}
              {singleAction === "DELETE"
                ? dictionary.cancellation.deleteDraft
                : singleAction === "REQUEST"
                  ? dictionary.cancellation.requestCancellation
                  : dictionary.cancellation.cancelPr}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={dialogAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {dialogAction === "DELETE"
                ? dictionary.cancellation.deleteDraftDescription
                : dialogAction === "REQUEST"
                  ? dictionary.cancellation.requestDescription
                  : dialogAction === "CONFIRM" || dialogAction === "REJECT"
                    ? dictionary.cancellation.reviewDescription
                    : cardDescription}
            </DialogDescription>
          </DialogHeader>

          {dialogAction !== "DELETE" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cancellation-reason">
                  {dialogAction === "CONFIRM"
                    ? dictionary.cancellation.reviewCommentLabel
                    : dialogAction === "REJECT"
                      ? dictionary.cancellation.declineReasonLabel
                      : dictionary.cancellation.reasonLabel}
                </Label>
                <Textarea
                  id="cancellation-reason"
                  disabled={busy}
                  rows={4}
                  autoFocus
                  required={requiresReason}
                  aria-required={requiresReason}
                  maxLength={2000}
                  value={reason}
                  aria-invalid={Boolean(reasonError)}
                  aria-describedby={
                    reasonError ? "cancellation-reason-error" : undefined
                  }
                  placeholder={
                    dialogAction === "CONFIRM"
                      ? dictionary.cancellation.reviewCommentPlaceholder
                      : dialogAction === "REJECT"
                        ? dictionary.cancellation.declineReasonPlaceholder
                        : dictionary.cancellation.reasonPlaceholder
                  }
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReasonError(null);
                  }}
                />
                {reasonError ? (
                  <p
                    id="cancellation-reason-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {reasonError}
                  </p>
                ) : null}
              </div>

              {dialogAction === "CANCEL" && isOrderedCancellation ? (
                <div className="space-y-2">
                  <Label htmlFor="cancellation-reference">
                    {dictionary.cancellation.referenceLabel}
                  </Label>
                  <Input
                    id="cancellation-reference"
                    disabled={busy}
                    required
                    aria-required="true"
                    maxLength={200}
                    value={cancellationReference}
                    aria-invalid={Boolean(referenceError)}
                    aria-describedby={
                      referenceError ? "cancellation-reference-error" : undefined
                    }
                    placeholder={dictionary.cancellation.referencePlaceholder}
                    onChange={(event) => {
                      setCancellationReference(event.target.value);
                      setReferenceError(null);
                    }}
                  />
                  {referenceError ? (
                    <p
                      id="cancellation-reference-error"
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {referenceError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={closeDialog}
            >
              {mode === "REVIEW"
                ? dictionary.cancellation.back
                : dictionary.cancellation.keepPr}
            </Button>
            <Button
              type="button"
              variant={dialogAction === "REJECT" ? "default" : "destructive"}
              loading={busy}
              disabled={busy}
              onClick={handleSubmit}
            >
              {busy
                ? dictionary.common.saving
                : dialogAction === "DELETE"
                  ? dictionary.cancellation.deleteDraft
                  : dialogAction === "REQUEST"
                    ? dictionary.cancellation.requestCancellation
                    : dialogAction === "CONFIRM"
                      ? dictionary.cancellation.confirmCancellation
                      : dialogAction === "REJECT"
                        ? dictionary.cancellation.declineCancellation
                        : dictionary.cancellation.cancelPr}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
