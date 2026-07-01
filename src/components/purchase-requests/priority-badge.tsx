import { Badge } from "@/components/ui/badge";
import { priorityToneClassNames } from "@/lib/constants";
import { defaultLocale, getDictionary, type Locale } from "@/lib/i18n";
import type { Priority } from "@/lib/types";

type PriorityBadgeProps = {
  priority: Priority;
  locale?: Locale;
};

export function PriorityBadge({
  priority,
  locale = defaultLocale,
}: PriorityBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={`rounded-full border-transparent px-3 py-1 text-xs ${priorityToneClassNames[priority]}`}
    >
      {getDictionary(locale).priorities[priority]}
    </Badge>
  );
}
