import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";

import { PrintPurchaseOrderButton } from "@/components/purchase-orders/print-purchase-order-button";
import { PurchaseOrderDocumentPreview } from "@/components/purchase-orders/purchase-order-document";
import { DownloadButton } from "@/components/shared/download-button";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getCurrentDictionary, getCurrentLocale } from "@/server/i18n";
import { getSharedPurchaseOrderDocument } from "@/server/purchase-orders/purchase-order-share.service";
import { isAppError } from "@/server/shared/errors";

import "@/components/purchase-orders/purchase-order-print.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Purchase order | PR Flow",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function SharedPurchaseOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, dictionary, locale] = await Promise.all([params, getCurrentDictionary(), getCurrentLocale()]);
  const shared = await getSharedPurchaseOrderDocument(token, locale).catch((error: unknown) => {
    if (isAppError(error) && error.statusCode === 404) notFound();
    console.error("Shared purchase order page failed", { errorType: error instanceof Error ? error.name : typeof error });
    throw new Error("Shared purchase order is unavailable");
  });
  const labels = dictionary.sharePurchaseOrder;

  return <main className="purchase-order-view mx-auto min-h-screen max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
    <header className="purchase-order-actions space-y-4 rounded-2xl border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold">{labels.publicTitle} · {shared.poNumber}</h1>
          <p className="break-words text-muted-foreground">{shared.supplierName}</p>
          <p className="text-sm text-muted-foreground">{labels.publicDescription}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DownloadButton id="download-shared-purchase-order-pdf" href={`/api/shared/purchase-orders/${encodeURIComponent(token)}/pdf`} filename={`${shared.poNumber}.pdf`} className="rounded-xl"><Download />{dictionary.purchaseOrders.downloadPdf}</DownloadButton>
          <PrintPurchaseOrderButton />
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
        <div><dt className="text-muted-foreground">{dictionary.poChanges.revision}</dt><dd id="shared-po-revision" className="font-medium">{formatNumber(shared.revision, locale)}</dd></div>
        <div><dt className="text-muted-foreground">{labels.expiresAt}</dt><dd id="shared-po-expires-at" className="font-medium">{formatDateTime(shared.expiresAt, locale)}</dd></div>
      </dl>
    </header>
    <PurchaseOrderDocumentPreview document={shared.document} />
  </main>;
}
