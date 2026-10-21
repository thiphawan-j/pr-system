import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, CircleAlert } from "lucide-react";

import { PrintPurchaseOrderButton } from "@/components/purchase-orders/print-purchase-order-button";
import { StatusBadge } from "@/components/purchase-requests/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { getDepartmentLabel, getUnitLabel } from "@/lib/i18n";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary, getCurrentLocale } from "@/server/i18n";
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
  const labels = dictionary.purchaseOrders;
  const cancelled = order.purchaseRequest.status === "CANCELLED";
  const cancellationPending = order.purchaseRequest.status === "CANCEL_REQUESTED";

  return (
    <div className="space-y-6">
      <div className="purchase-order-actions flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="outline" className="rounded-xl">
          <Link href={`/purchase-requests/${order.purchaseRequest.id}`}><ArrowLeft />{labels.backToRequest}</Link>
        </Button>
        <PrintPurchaseOrderButton />
      </div>
      <article className="purchase-order-document space-y-6 rounded-[2rem] border border-border/70 bg-card p-6 sm:p-8">
        {cancelled || cancellationPending ? (
          <Alert className="purchase-order-notice border-amber-500/40 bg-amber-500/10">
            {cancelled ? <Ban className="size-4" /> : <CircleAlert className="size-4" />}
            <AlertTitle>{cancelled ? labels.cancelledTitle : labels.cancellationPendingTitle}</AlertTitle>
            <AlertDescription>{cancelled ? labels.cancelledDescription : labels.cancellationPendingDescription}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <p className="text-sm text-muted-foreground">{dictionary.app.name}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{labels.documentTitle}</h1>
            <p className="mt-2 text-lg font-medium">{order.poNumber}</p>
          </div>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-muted-foreground">{labels.issuedAt}</dt><dd>{formatDate(order.issuedAt, locale)}</dd></div>
            <div><dt className="text-muted-foreground">{labels.sourceRequest}</dt><dd><Link href={`/purchase-requests/${order.purchaseRequest.id}`} className="font-medium underline underline-offset-4">{order.purchaseRequest.prNumber}</Link></dd></div>
            <div><dt className="mb-1 text-muted-foreground">{labels.sourceStatus}</dt><dd><StatusBadge status={order.purchaseRequest.status} locale={locale} /></dd></div>
          </dl>
        </div>
        <div className="purchase-order-parties grid gap-6 sm:grid-cols-2">
          <div className="space-y-3">
            <div><p className="text-sm text-muted-foreground">{labels.supplierName}</p><p className="font-semibold">{order.supplierName}</p></div>
            {order.supplierCode ? <div><p className="text-sm text-muted-foreground">{dictionary.suppliers.code}</p><p>{order.supplierCode}</p></div> : null}
            {order.supplierTaxId ? <div><p className="text-sm text-muted-foreground">{dictionary.suppliers.taxId}</p><p>{order.supplierTaxId}</p></div> : null}
            {order.supplierAddress ? <div><p className="text-sm text-muted-foreground">{labels.supplierAddress}</p><p className="whitespace-pre-wrap break-words">{order.supplierAddress}</p></div> : null}
            {order.supplierContactPerson ? <div><p className="text-sm text-muted-foreground">{dictionary.suppliers.contactPerson}</p><p className="whitespace-pre-wrap break-words">{order.supplierContactPerson}</p></div> : null}
            {order.supplierContacts.length ? <div className="space-y-1">{order.supplierContacts.map((contact) => <p key={contact.channel} className="whitespace-pre-wrap break-words"><span className="text-sm text-muted-foreground">{dictionary.suppliers[contact.channel]}: </span>{contact.value}</p>)}</div> : null}
            {order.supplierContact ? <div><p className="text-sm text-muted-foreground">{labels.supplierContact}</p><p className="whitespace-pre-wrap break-words">{order.supplierContact}</p></div> : null}
          </div>
          <div className="space-y-3">
            <div><p className="text-sm text-muted-foreground">{dictionary.common.department}</p><p>{getDepartmentLabel(order.purchaseRequest.department, locale)}</p></div>
            <div><p className="text-sm text-muted-foreground">{dictionary.common.requester}</p><p>{order.purchaseRequest.requesterName}</p></div>
            {order.deliveryAddress ? <div><p className="text-sm text-muted-foreground">{labels.deliveryAddress}</p><p className="whitespace-pre-wrap break-words">{order.deliveryAddress}</p></div> : null}
            {order.expectedDeliveryDate ? <div><p className="text-sm text-muted-foreground">{labels.expectedDeliveryDate}</p><p>{formatDate(order.expectedDeliveryDate, locale)}</p></div> : null}
          </div>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>{labels.lineNumber}</TableHead>
            <TableHead>{dictionary.purchaseRequests.itemList}</TableHead>
            <TableHead className="text-right">{dictionary.purchaseRequests.quantityUnit}</TableHead>
            <TableHead className="text-right">{dictionary.purchaseRequests.unitPrice}</TableHead>
            <TableHead className="text-right">{dictionary.purchaseRequests.lineTotal}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {order.items.map((item, index) => <TableRow key={item.id}>
              <TableCell className="align-top">{index + 1}</TableCell>
              <TableCell className="min-w-44 max-w-96 whitespace-normal align-top">
                <p className="font-medium break-words">{item.itemName}</p>
                {item.description ? <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{item.description}</p> : null}
              </TableCell>
              <TableCell className="text-right align-top">{formatNumber(item.quantity, locale)} {item.unit ? getUnitLabel(item.unit, locale) : ""}</TableCell>
              <TableCell className="text-right align-top">{formatCurrency(item.unitPrice, locale)}</TableCell>
              <TableCell className="text-right align-top">{formatCurrency(item.amount, locale)}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
        <div className="border-t border-border/70 pt-4 text-right">
          <span className="text-muted-foreground">{dictionary.common.totalAmount}: </span>
          <span className="text-2xl font-semibold">{formatCurrency(order.totalAmount, locale)}</span>
        </div>
        {order.paymentTerms ? <div><p className="text-sm text-muted-foreground">{labels.paymentTerms}</p><p className="whitespace-pre-wrap break-words">{order.paymentTerms}</p></div> : null}
        {order.note ? <div><p className="text-sm text-muted-foreground">{labels.note}</p><p className="whitespace-pre-wrap break-words">{order.note}</p></div> : null}
        <p className="border-t border-border/70 pt-4 text-sm text-muted-foreground">{labels.createdBy}: {order.createdBy.name}</p>
      </article>
    </div>
  );
}
