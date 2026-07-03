import { Badge } from "@/components/ui/badge";
import { statusToneClassNames } from "@/lib/constants";
import { defaultLocale, getDictionary, type Locale } from "@/lib/i18n";
import type { PurchaseRequestStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: PurchaseRequestStatus;
  locale?: Locale;
  label?: string;
  className?: string;
};

export function StatusBadge({
  status,
  locale = defaultLocale,
  label,
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full border-transparent px-3 py-1 text-xs",
        statusToneClassNames[status],
        className,
      )}
    >
      {label ?? getDictionary(locale).statuses[status]}
    </Badge>
  );
}
