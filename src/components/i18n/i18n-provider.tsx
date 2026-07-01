"use client";

import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { Dictionary, Locale } from "@/lib/i18n";

type I18nContextValue = {
  locale: Locale;
  dictionary: Dictionary;
  setLocale: Dispatch<SetStateAction<Locale>>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

type I18nProviderProps = {
  children: React.ReactNode;
  locale: Locale;
  dictionary: Dictionary;
  setLocale: Dispatch<SetStateAction<Locale>>;
};

export function I18nProvider({
  children,
  locale,
  dictionary,
  setLocale,
}: I18nProviderProps) {
  return (
    <I18nContext.Provider value={{ locale, dictionary, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return context;
}
