"use client";

import { MonitorCog, MoonStar, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";

const themes = [
  { value: "light", icon: SunMedium, labelKey: "light" },
  { value: "dark", icon: MoonStar, labelKey: "dark" },
  { value: "system", icon: MonitorCog, labelKey: "system" },
] as const;

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const { dictionary } = useI18n();
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  if (!mounted) {
    return (
      <Button variant="outline" size="icon-sm" aria-label={dictionary.theme.toggle}>
        <MoonStar />
      </Button>
    );
  }

  const currentIndex = themes.findIndex((item) => item.value === theme);
  const nextTheme = themes[(currentIndex + 1) % themes.length] ?? themes[0];
  const CurrentIcon =
    themes.find((item) => item.value === theme)?.icon ?? MoonStar;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={dictionary.theme[nextTheme.labelKey]}
      onClick={() => setTheme(nextTheme.value)}
      title={dictionary.theme[nextTheme.labelKey]}
    >
      <CurrentIcon />
    </Button>
  );
}
