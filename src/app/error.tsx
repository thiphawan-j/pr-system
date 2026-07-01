"use client";

import { useEffect } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { dictionary, locale } = useI18n();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-3xl font-semibold">
            {dictionary.error.unexpectedTitle}
          </h1>
          <p className="text-muted-foreground">
            {dictionary.error.unexpectedDescription}
          </p>
          <Button onClick={reset}>{dictionary.common.retry}</Button>
        </div>
      </body>
    </html>
  );
}
