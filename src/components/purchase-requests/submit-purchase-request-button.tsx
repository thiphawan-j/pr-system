"use client";

import { SendHorizonal } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
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
  const { dictionary, locale } = useI18n();

  return (
    <Button
      type="button"
      className="w-full rounded-xl"
      disabled={isPending}
      onClick={() => {
        setIsPending(true);
        startTransition(async () => {
          const response = await fetch(`/api/purchase-requests/${requestId}/submit`, {
            method: "POST",
          });
          const payload = await response.json().catch(() => null);
          setIsPending(false);

          if (!response.ok) {
            toast.error(
              translateMessage(payload?.error, locale) ??
                dictionary.purchaseRequests.submitError,
            );
            return;
          }

          toast.success(dictionary.purchaseRequests.submitSuccess);
          router.refresh();
        });
      }}
    >
      <SendHorizonal />
      {isPending ? dictionary.common.sending : dictionary.purchaseRequests.submitApproval}
    </Button>
  );
}
