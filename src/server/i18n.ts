import "server-only";

import { cookies } from "next/headers";

import {
  defaultLocale,
  getDictionary,
  LOCALE_COOKIE_NAME,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n";

export async function getCurrentLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;

  return normalizeLocale(cookieLocale ?? defaultLocale);
}

export async function getCurrentDictionary() {
  return getDictionary(await getCurrentLocale());
}
