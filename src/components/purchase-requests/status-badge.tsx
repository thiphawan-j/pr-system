import { Badge } from "@/components/ui/badge";
import { statusToneClassNames } from "@/lib/constants";
import { defaultLocale, getDictionary, type Locale } from "@/lib/i18n";
import type { PurchaseRequestStatus } from "@/lib/types";

type StatusBadgeProps = {
  status: PurchaseRequestStatus;
  locale?: Locale;
};

export function StatusBadge({ status, locale = defaultLocale }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={`rounded-full border-transparent px-3 py-1 text-xs ${statusToneClassNames[status]}`}
    >
      {getDictionary(locale).statuses[status]}
    </Badge>
  );
}
