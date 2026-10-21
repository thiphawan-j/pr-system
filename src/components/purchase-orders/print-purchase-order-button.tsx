"use client";

import { Printer } from "lucide-react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";

export function PrintPurchaseOrderButton() {
  const { dictionary } = useI18n();
  return (
    <Button id="print-purchase-order" type="button" className="rounded-xl" onClick={() => window.print()}>
      <Printer />
      {dictionary.purchaseOrders.print}
    </Button>
  );
}
