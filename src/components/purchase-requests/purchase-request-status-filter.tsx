"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  purchaseRequestListStatusFilters,
  type PurchaseRequestListStatusFilter,
} from "@/lib/types";

type PurchaseRequestStatusFilterProps = {
  defaultValue: PurchaseRequestListStatusFilter[];
};

export function PurchaseRequestStatusFilter({
  defaultValue,
}: PurchaseRequestStatusFilterProps) {
  const { dictionary } = useI18n();
  const [selectedStatuses, setSelectedStatuses] = useState(() =>
    purchaseRequestListStatusFilters.filter((status) => defaultValue.includes(status)),
  );

  function statusLabel(status: PurchaseRequestListStatusFilter) {
    return status === "AWAITING_RECEIPT_REFERENCES"
      ? dictionary.approval.awaitingReceiptReferences
      : dictionary.statuses[status];
  }

  const selectionLabel = selectedStatuses.length === 0
    ? dictionary.common.all
    : selectedStatuses.length === 1
      ? statusLabel(selectedStatuses[0])
      : dictionary.purchaseRequests.statusSelectionCount.replace("{count}", String(selectedStatuses.length));

  function updateStatus(status: PurchaseRequestListStatusFilter, checked: boolean) {
    setSelectedStatuses((current) =>
      purchaseRequestListStatusFilters.filter((candidate) =>
        candidate === status ? checked : current.includes(candidate),
      ),
    );
  }

  return (
    <>
      {selectedStatuses.map((status) => (
        <input key={status} type="hidden" name="status" value={status} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            id="status"
            type="button"
            variant="outline"
            aria-label={`${dictionary.common.status}: ${selectionLabel}`}
            className="h-10 w-full min-w-0 justify-between rounded-xl border-input px-3 font-normal"
          >
            <span className="truncate">{selectionLabel}</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          aria-label={dictionary.common.status}
          className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] min-w-64 max-w-[calc(100vw-2rem)] overflow-y-auto"
        >
          <DropdownMenuLabel>{dictionary.purchaseRequests.statusSelectionHint}</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={selectedStatuses.length === 0}
            onCheckedChange={() => setSelectedStatuses([])}
            onSelect={(event) => event.preventDefault()}
            className="py-2"
          >
            {dictionary.common.all}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {purchaseRequestListStatusFilters.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={selectedStatuses.includes(status)}
              onCheckedChange={(checked) => updateStatus(status, checked === true)}
              onSelect={(event) => event.preventDefault()}
              className="py-2"
            >
              {statusLabel(status)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
