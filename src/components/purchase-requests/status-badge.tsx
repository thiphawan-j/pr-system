import { Badge } from "@/components/ui/badge";
import { statusToneClassNames } from "@/lib/constants";
import { defaultLocale, getDictionary, type Locale } from "@/lib/i18n";
import type { PurchaseRequestStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: PurchaseRequestStatus;
  receivedAt?: string | null;
  locale?: Locale;
  label?: string;
  className?: string;
};

export function StatusBadge({
  status,
  receivedAt,
  locale = defaultLocale,
  label,
  className,
}: StatusBadgeProps) {
  const dictionary = getDictionary(locale);
  const isAwaitingReceiptReferences =
    status === "ORDERED" && Boolean(receivedAt);

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full border-transparent px-3 py-1 text-xs",
        statusToneClassNames[status],
        isAwaitingReceiptReferences &&
          "bg-amber-500/15 text-amber-700 ring-amber-500/20 dark:text-amber-300",
        className,
      )}
    >
      {label ??
        (isAwaitingReceiptReferences
          ? dictionary.approval.awaitingReceiptReferences
          : dictionary.statuses[status])}
    </Badge>
  );
}
