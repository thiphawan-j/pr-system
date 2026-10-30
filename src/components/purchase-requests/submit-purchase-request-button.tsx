"use client";

import { SendHorizonal } from "lucide-react";
import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { startTransition, useRef, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { translateMessage } from "@/lib/i18n";

type SubmitPurchaseRequestButtonProps = {
  requestId: string;
};

export function SubmitPurchaseRequestButton({
  requestId,
}: SubmitPurchaseRequestButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = isPending || router.isPending;
  const { dictionary, locale } = useI18n();

  return (
    <Button
      type="button"
      className="w-full rounded-xl"
      loading={busy}
      disabled={busy}
      onClick={() => {
        if (pendingRef.current || busy) return;
        pendingRef.current = true;
        setIsPending(true);
        startTransition(async () => {
          try {
            const response = await fetch(`/api/purchase-requests/${requestId}/submit`, { method: "POST" });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              toast.error(translateMessage(payload?.error, locale) ?? dictionary.purchaseRequests.submitError);
              return;
            }
            toast.success(dictionary.purchaseRequests.submitSuccess);
            router.refresh();
          } catch {
            toast.error(dictionary.purchaseRequests.submitError);
          } finally {
            pendingRef.current = false;
            setIsPending(false);
          }
        });
      }}
    >
      {!busy ? <SendHorizonal /> : null}
      {busy ? dictionary.common.sending : dictionary.purchaseRequests.submitApproval}
    </Button>
  );
}
