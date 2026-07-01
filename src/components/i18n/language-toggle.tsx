"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getDictionary, type Locale, translateMessage } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/i18n-provider";

export function LanguageToggle() {
  const router = useRouter();
  const { locale, dictionary, setLocale } = useI18n();
  const nextLocale: Locale = locale === "th" ? "en" : "th";

  function handleToggle() {
    startTransition(async () => {
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
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-full"
      aria-label={`${dictionary.languageToggle.label}: ${
        getDictionary(nextLocale).localeName
      }`}
      title={dictionary.languageToggle.title}
      onClick={handleToggle}
    >
      <Languages />
      {dictionary.languageToggle.next}
    </Button>
  );
}
