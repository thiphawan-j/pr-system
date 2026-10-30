"use client";

import { Languages } from "lucide-react";
import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { startTransition, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getDictionary, type Locale, translateMessage } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/i18n-provider";

export function LanguageToggle() {
  const router = useRouter();
  const { locale, dictionary, setLocale } = useI18n();
  const [requestPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const isPending = requestPending || router.isPending;
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const nextLocale: Locale = locale === "th" ? "en" : "th";

  function handleToggle() {
    if (pendingRef.current || router.isPending) return;
    pendingRef.current = true;
    setIsPending(true);
    startTransition(async () => {
      try {
        const response = await fetch("/api/locale", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ locale: nextLocale }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          toast.error(
            translateMessage(payload?.error, locale) ??
              "Unable to update language",
          );
          return;
        }

        setLocale(nextLocale);
        router.refresh();
      } catch {
        toast.error(locale === "th" ? "เปลี่ยนภาษาไม่สำเร็จ กรุณาลองใหม่" : "Unable to update language. Try again.");
      } finally {
        pendingRef.current = false;
        setIsPending(false);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-full"
      disabled={!mounted}
      loading={isPending}
      aria-label={`${dictionary.languageToggle.label}: ${
        getDictionary(nextLocale).localeName
      }`}
      title={dictionary.languageToggle.title}
      onClick={handleToggle}
    >
      {!isPending ? <Languages /> : null}
      {dictionary.languageToggle.next}
    </Button>
  );
}
