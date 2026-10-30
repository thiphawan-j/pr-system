"use client";

import { LogOut } from "lucide-react";
import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { startTransition, useRef, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { translateMessage } from "@/lib/i18n";

export function SignOutButton() {
  const router = useRouter();
  const [requestPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const isPending = requestPending || router.isPending;
  const { dictionary, locale } = useI18n();

  function handleSignOut() {
    if (pendingRef.current || router.isPending) return;
    pendingRef.current = true;
    setIsPending(true);
    startTransition(async () => {
      try {
        const response = await fetch("/api/auth/logout", {
          method: "POST",
        });


        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          toast.error(
            translateMessage(payload?.error, locale) ?? dictionary.auth.signOutError,
          );
          return;
        }

        router.push("/login");
        router.refresh();
      } catch {
        toast.error(dictionary.auth.signOutError);
      } finally {
        pendingRef.current = false;
        setIsPending(false);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="size-8 rounded-full p-0 sm:h-7 sm:w-auto sm:px-2.5"
      aria-label={isPending ? dictionary.auth.signingOut : dictionary.auth.signOut}
      title={isPending ? dictionary.auth.signingOut : dictionary.auth.signOut}
      onClick={handleSignOut}
      loading={isPending}
    >
      {!isPending ? <LogOut /> : null}
      <span className="hidden sm:inline">
        {isPending ? dictionary.auth.signingOut : dictionary.auth.signOut}
      </span>
    </Button>
  );
}
