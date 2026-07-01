"use client";

import { useEffect, useState } from "react";
import { ThemeProvider } from "next-themes";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { Toaster } from "@/components/ui/sonner";
import {
  getDictionary,
  type Dictionary,
  type Locale,
} from "@/lib/i18n";

type ProvidersProps = {
  children: React.ReactNode;
  locale: Locale;
  dictionary: Dictionary;
};

export function Providers({ children, locale, dictionary }: ProvidersProps) {
  const [currentLocale, setCurrentLocale] = useState(locale);

  useEffect(() => {
    setCurrentLocale(locale);
  }, [locale]);

  return (
    <I18nProvider
      locale={currentLocale}
      dictionary={currentLocale === locale ? dictionary : getDictionary(currentLocale)}
      setLocale={setCurrentLocale}
    >
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        {children}
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </I18nProvider>
  );
}
