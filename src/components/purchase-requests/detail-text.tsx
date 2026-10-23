import { ChevronDown } from "lucide-react";

import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type DetailTextProps = {
  text: string;
  locale: Locale;
  className?: string;
};

export function DetailText({ text, locale, className }: DetailTextProps) {
  if (text.length <= 240) {
    return (
      <p className={cn("min-w-0 whitespace-pre-wrap wrap-anywhere", className)}>
        {text}
      </p>
    );
  }

  return (
    <details className={cn("group/detail-text min-w-0", className)}>
      <summary className="cursor-pointer list-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="mb-2 line-clamp-2 whitespace-pre-wrap wrap-anywhere group-open/detail-text:hidden"
        >
          {text}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          <span className="group-open/detail-text:hidden">
            {locale === "th" ? "ดูข้อความทั้งหมด" : "Show full text"}
          </span>
          <span className="hidden group-open/detail-text:inline">
            {locale === "th" ? "ย่อข้อความ" : "Show less"}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform group-open/detail-text:rotate-180"
          />
        </span>
      </summary>
      <p className="mt-3 whitespace-pre-wrap wrap-anywhere">{text}</p>
    </details>
  );
}
