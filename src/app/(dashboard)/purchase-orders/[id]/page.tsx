import Link from "@/components/loading/navigation-link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, Building2, CircleAlert, Download } from "lucide-react";

import { PrintPurchaseOrderButton } from "@/components/purchase-orders/print-purchase-order-button";
import { SharePurchaseOrderButton } from "@/components/purchase-orders/share-purchase-order-button";
import { PurchaseOrderChangeHistory } from "@/components/purchase-orders/purchase-order-change-history";
import { PurchaseOrderChangeReview } from "@/components/purchase-orders/purchase-order-change-review";
import { PurchaseOrderDocumentPreview } from "@/components/purchase-orders/purchase-order-document";
import { CancelPurchaseOrderButton } from "@/components/purchase-orders/cancel-purchase-order-button";
import { StatusBadge } from "@/components/purchase-requests/status-badge";
import { CloseOrderButton } from "@/components/purchase-requests/close-order-button";
import { DownloadButton } from "@/components/shared/download-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber } from "@/lib/format";
import { requireSession } from "@/server/auth/session";
import { isPurchasing } from "@/server/auth/authorization";
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
  const sources = order.purchaseRequests?.length ? order.purchaseRequests : [order.purchaseRequest];
  const sourceCancelled = sources.some((source) => source.status === "CANCELLED");
  const independentlyCancelled = order.status === "CANCELLED" && !sourceCancelled;
  const cancelled = order.status === "CANCELLED" || sourceCancelled;
  const cancellationPending = sources.some((source) => source.status === "CANCEL_REQUESTED");

  return (
    <div className="purchase-order-view space-y-6">
      <div className="purchase-order-actions flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="outline" className="rounded-xl">
          <Link href={`/purchase-requests/${order.purchaseRequest.id}`}><ArrowLeft />{labels.backToRequest}</Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {sources.length === 1 && !cancelled && order.purchaseRequest.canCloseOrder ? (
            <CloseOrderButton requestId={order.purchaseRequest.id} expectedVersion={order.purchaseRequest.receiptVersion} prNumber={order.purchaseRequest.prNumber} />
          ) : null}
          {order.canEdit ? <Button asChild variant="outline" className="rounded-xl"><Link id="edit-purchase-order" href={`/purchase-orders/${order.id}/edit`}>{dictionary.poChanges.edit}</Link></Button> : null}
          {order.canCancel ? <CancelPurchaseOrderButton key={order.version} orderId={order.id} expectedVersion={order.version} poNumber={order.poNumber} /> : null}
          {isPurchasing(session) && !cancelled && !cancellationPending ? <SharePurchaseOrderButton orderId={order.id} poNumber={order.poNumber} supplierName={order.supplierName} /> : null}
          <DownloadButton id="download-purchase-order-pdf" href={`/api/purchase-orders/${order.id}/pdf`} filename={`${order.poNumber}.pdf`} className="rounded-xl"><Download />{labels.downloadPdf}</DownloadButton>
          <PrintPurchaseOrderButton />
        </div>
      </div>
      <section className="purchase-order-actions space-y-4 rounded-2xl border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="text-2xl font-semibold">{labels.documentTitle}</h1><p className="mt-1 text-muted-foreground">{order.poNumber}</p></div>
          <dl className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-muted-foreground">{dictionary.poChanges.revision}</dt><dd id="po-revision" className="font-medium">{formatNumber(order.revision, locale)}</dd></div>
            <div><dt className="text-muted-foreground">{labels.sourceRequest}</dt><dd className="mt-1 flex flex-col gap-2">{sources.map((source) => <span key={source.id} className="flex flex-wrap items-center gap-2"><Link href={`/purchase-requests/${source.id}`} className="font-medium underline underline-offset-4">{source.prNumber}</Link><span className="purchase-order-pr-status"><StatusBadge status={source.status} locale={locale} /></span></span>)}</dd></div>
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
          <Alert id="po-cancellation-notice" className="border-amber-500/40 bg-amber-500/10">
            {cancelled ? <Ban className="size-4" /> : <CircleAlert className="size-4" />}
            <AlertTitle>{independentlyCancelled ? dictionary.poCombined.cancelledTitle : cancelled ? labels.cancelledTitle : labels.cancellationPendingTitle}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{independentlyCancelled ? dictionary.poCombined.cancelledDescription : cancelled ? labels.cancelledDescription : labels.cancellationPendingDescription}</p>
              {order.cancellationReason ? <p className="whitespace-pre-wrap break-words">{dictionary.poCombined.cancelReason}: {order.cancellationReason}</p> : null}
              {order.cancelledAt ? <p>{dictionary.poCombined.cancelledAt}: {formatDateTime(order.cancelledAt, locale)}{order.cancelledBy ? ` · ${dictionary.poCombined.cancelledBy}: ${order.cancelledBy.name}` : ""}</p> : null}
              {order.cancellationReference ? <p className="break-words">{dictionary.poCombined.cancelReference}: {order.cancellationReference}</p> : null}
            </AlertDescription>
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
