"use client";

import { CircleCheck } from "lucide-react";
import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { AlertDialog } from "radix-ui";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { translateMessage } from "@/lib/i18n";

type CloseOrderButtonProps = {
  requestId: string;
  expectedVersion: number;
  prNumber: string;
};

export function CloseOrderButton({
  requestId,
  expectedVersion,
  prNumber,
}: CloseOrderButtonProps) {
  const router = useRouter();
  const { dictionary, locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = isPending || router.isPending;
  const text = dictionary.orderClosure;

  async function closeOrder() {
    if (pendingRef.current || busy) return;
    pendingRef.current = true;

    setIsPending(true);
    try {
      const response = await fetch(`/api/purchase-requests/${requestId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = typeof payload?.error === "string" ? payload.error : undefined;
        toast.error(translateMessage(message, locale) ?? text.error);
        if (response.status === 409) {
          setIsOpen(false);
          router.refresh();
        }
        return;
      }

      setIsOpen(false);
      toast.success(text.success);
      router.refresh();
    } catch {
      toast.error(text.error);
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  return (
    <AlertDialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!busy) setIsOpen(open);
      }}
    >
      <AlertDialog.Trigger asChild>
        <Button
          id="close-order"
          type="button"
          variant="outline"
          className="rounded-xl"
          disabled={busy}
        >
          <CircleCheck />
          {text.button}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 isolate z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-md">
          <AlertDialog.Title className="font-heading text-base font-medium">
            {text.title.replace("{prNumber}", prNumber)}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="space-y-3 leading-relaxed text-muted-foreground">
              <p>{text.description}</p>
              <p className="rounded-lg bg-muted p-3 font-medium text-foreground">
                {text.scopeNote}
              </p>
            </div>
          </AlertDialog.Description>
          <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button type="button" variant="outline" disabled={busy}>
                {text.cancel}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                id="confirm-close-order"
                type="button"
                loading={busy}
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  void closeOrder();
                }}
              >
                {!busy ? <CircleCheck /> : null}
                {busy ? text.closing : text.confirm}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
