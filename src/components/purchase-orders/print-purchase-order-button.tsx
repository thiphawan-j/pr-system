"use client";

import { Printer } from "lucide-react";
import { useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";

export function PrintPurchaseOrderButton() {
  const { dictionary } = useI18n();
  const preparing = useRef(false);
  const [isPreparing, setIsPreparing] = useState(false);

  async function print() {
    if (preparing.current) return;
    preparing.current = true;
    setIsPreparing(true);
    try {
      await Promise.all([
        document.fonts.load('400 12pt "Noto Sans Thai"', "มูลค่ารวม Total ฿0.00"),
        document.fonts.load('700 16pt "Noto Sans Thai"', "มูลค่ารวม Total ฿0.00"),
      ]).catch(() => []);
      await document.fonts.ready;
      window.print();
    } finally {
      preparing.current = false;
      setIsPreparing(false);
    }
  }

  return (
    <Button id="print-purchase-order" type="button" className="rounded-xl" loading={isPreparing} disabled={isPreparing} aria-busy={isPreparing} onClick={print}>
      {!isPreparing ? <Printer /> : null}
      {isPreparing ? dictionary.common.loading : dictionary.purchaseOrders.print}
    </Button>
  );
}
