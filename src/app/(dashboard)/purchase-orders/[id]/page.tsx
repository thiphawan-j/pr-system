import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, Building2, CircleAlert, Download } from "lucide-react";

import { PrintPurchaseOrderButton } from "@/components/purchase-orders/print-purchase-order-button";
import { PurchaseOrderChangeHistory } from "@/components/purchase-orders/purchase-order-change-history";
import { PurchaseOrderChangeReview } from "@/components/purchase-orders/purchase-order-change-review";
import { PurchaseOrderDocumentPreview } from "@/components/purchase-orders/purchase-order-document";
import { StatusBadge } from "@/components/purchase-requests/status-badge";
import { CloseOrderButton } from "@/components/purchase-requests/close-order-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary, getCurrentLocale } from "@/server/i18n";
import { buildPurchaseOrderDocument } from "@/server/purchase-orders/purchase-order-document";
import { getPurchaseOrderById } from "@/server/purchase-orders/purchase-order.service";
import { isAppError } from "@/server/shared/errors";

import "@/components/purchase-orders/purchase-order-print.css";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const [session, dictionary, locale] = await Promise.all([
    requireSession(), getCurrentDictionary(), getCurrentLocale(),
  ]);
  const { id } = await params;
  const order = await getPurchaseOrderById(id, session).catch((error: unknown) => {
    if (isAppError(error) && (error.statusCode === 403 || error.statusCode === 404)) notFound();
    throw error;
  });
  const document = await buildPurchaseOrderDocument(order, locale);
  const labels = dictionary.purchaseOrders;
  const cancelled = order.purchaseRequest.status === "CANCELLED";
  const cancellationPending = order.purchaseRequest.status === "CANCEL_REQUESTED";

  return (
    <div className="purchase-order-view space-y-6">
      <div className="purchase-order-actions flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="outline" className="rounded-xl">
          <Link href={`/purchase-requests/${order.purchaseRequest.id}`}><ArrowLeft />{labels.backToRequest}</Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {order.purchaseRequest.canCloseOrder ? (
            <CloseOrderButton requestId={order.purchaseRequest.id} expectedVersion={order.purchaseRequest.receiptVersion} prNumber={order.purchaseRequest.prNumber} />
          ) : null}
          {order.canEdit ? <Button asChild variant="outline" className="rounded-xl"><Link id="edit-purchase-order" href={`/purchase-orders/${order.id}/edit`}>{dictionary.poChanges.edit}</Link></Button> : null}
          <Button asChild variant="outline" className="rounded-xl"><a id="download-purchase-order-pdf" href={`/api/purchase-orders/${order.id}/pdf`}><Download />{labels.downloadPdf}</a></Button>
          <PrintPurchaseOrderButton />
        </div>
      </div>
      <section className="purchase-order-actions space-y-4 rounded-2xl border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="text-2xl font-semibold">{labels.documentTitle}</h1><p className="mt-1 text-muted-foreground">{order.poNumber}</p></div>
          <dl className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-muted-foreground">{dictionary.poChanges.revision}</dt><dd id="po-revision" className="font-medium">{formatNumber(order.revision, locale)}</dd></div>
            <div><dt className="text-muted-foreground">{labels.sourceRequest}</dt><dd><Link href={`/purchase-requests/${order.purchaseRequest.id}`} className="font-medium underline underline-offset-4">{order.purchaseRequest.prNumber}</Link></dd></div>
            <div className="purchase-order-pr-status"><dt className="mb-1 text-muted-foreground">{labels.sourceStatus}</dt><dd><StatusBadge status={order.purchaseRequest.status} locale={locale} /></dd></div>
          </dl>
        </div>
        {!order.buyerCompany && session.role === "ADMIN" ? (
          <Alert id="po-company-setup-notice">
            <Building2 className="size-4" />
            <AlertTitle>{dictionary.companySettings.setupNotice}</AlertTitle>
            <AlertDescription>
              <Link href="/admin/company" className="font-medium text-primary underline underline-offset-4">{dictionary.companySettings.setupLink}</Link>
            </AlertDescription>
          </Alert>
        ) : null}
        {order.pendingChangeId ? <Alert id="po-change-pending" className="border-amber-500/40 bg-amber-500/10"><CircleAlert className="size-4" /><AlertTitle>{dictionary.poChanges.pendingTitle}</AlertTitle><AlertDescription>{dictionary.poChanges.pendingDescription}</AlertDescription></Alert> : null}
        {cancelled || cancellationPending ? (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            {cancelled ? <Ban className="size-4" /> : <CircleAlert className="size-4" />}
            <AlertTitle>{cancelled ? labels.cancelledTitle : labels.cancellationPendingTitle}</AlertTitle>
            <AlertDescription>{cancelled ? labels.cancelledDescription : labels.cancellationPendingDescription}</AlertDescription>
          </Alert>
        ) : null}
      </section>
      <PurchaseOrderDocumentPreview document={document} />
      <div className="purchase-order-actions space-y-6">
        <PurchaseOrderChangeHistory changes={order.changes} pendingChangeId={order.pendingChangeId} />
        <PurchaseOrderChangeReview key={order.version} order={order} />
      </div>
    </div>
  );
}
