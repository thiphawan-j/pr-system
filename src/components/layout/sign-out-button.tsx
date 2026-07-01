"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { translateMessage } from "@/lib/i18n";

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();

  function handleSignOut() {
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      setIsPending(false);

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        toast.error(
          translateMessage(payload?.error, locale) ?? dictionary.auth.signOutError,
        );
        return;
      }

      router.push("/login");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="rounded-full"
      onClick={handleSignOut}
      disabled={isPending}
    >
      <LogOut />
      {isPending ? dictionary.auth.signingOut : dictionary.auth.signOut}
    </Button>
  );
}
