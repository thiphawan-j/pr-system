import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  CircleAlert,
  Download,
  FilePenLine,
  FileText,
  GitBranch,
  Package,
  Paperclip,
  UserRoundCheck,
} from "lucide-react";

import { ApprovalActionPanel } from "@/components/purchase-requests/approval-action-panel";
import { AttachmentPreviewButton } from "@/components/purchase-requests/attachment-preview-button";
import { CloseOrderButton } from "@/components/purchase-requests/close-order-button";
import { DetailText } from "@/components/purchase-requests/detail-text";
import { PriorityBadge } from "@/components/purchase-requests/priority-badge";
import {
  PurchaseRequestCancellationPanel,
  type PurchaseRequestCancellationMode,
} from "@/components/purchase-requests/purchase-request-cancellation-panel";
import { PurchaseRequestCommentPanel } from "@/components/purchase-requests/purchase-request-comment-panel";
import { PurchasingProgressPanel } from "@/components/purchase-requests/purchasing-progress-panel";
import { ReceiptConfirmationPanel } from "@/components/purchase-requests/receipt-confirmation-panel";
import { ReceiptHistoryPanel } from "@/components/purchase-requests/receipt-history-panel";
import { ReceiptReferencePanel } from "@/components/purchase-requests/receipt-reference-panel";
import { SharePurchaseRequestButton } from "@/components/purchase-requests/share-purchase-request-button";
import { StatusBadge } from "@/components/purchase-requests/status-badge";
import { SubmitPurchaseRequestButton } from "@/components/purchase-requests/submit-purchase-request-button";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatApprovalAction,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
} from "@/lib/format";
import {
  getDepartmentLabel,
  getUnitLabel,
  translateWorkflowText,
} from "@/lib/i18n";
import {
  canApprovePurchaseRequest,
  canHandlePurchaseRequestCancellation,
  hasCancellationAdminRights,
} from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary, getCurrentLocale } from "@/server/i18n";
import { getPurchaseRequestById } from "@/server/purchase-requests/purchase-request.service";

export default async function PurchaseRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [session, locale, dictionary] = await Promise.all([
    requireSession(),
    getCurrentLocale(),
    getCurrentDictionary(),
  ]);
  const { id } = await params;
  const request = await getPurchaseRequestById(id, session);
  const isPurchasingReturnStatus =
    request.status === "NEED_REVISION" ||
    request.status === "NEED_CLARIFICATION";
  const latestPurchasingReturn = request.approvals
    .slice()
    .reverse()
    .find(
      (approval) =>
        approval.action === "REQUESTED_REVISION" ||
        approval.action === "REQUESTED_CLARIFICATION",
    );
  const latestCancellationRequest = request.approvals
    .slice()
    .reverse()
    .find((approval) => approval.action === "CANCELLATION_REQUESTED");
  const isOwner = request.requester.id === session.id;
  const canManageAsOwner = isOwner || hasCancellationAdminRights(session);
  const canHandleCancellation = canHandlePurchaseRequestCancellation(session);
  const canReviewCancellation = !isOwner && canHandleCancellation;

  let cancellationMode: PurchaseRequestCancellationMode | null = null;

  if (request.status === "DRAFT" && !request.submittedAt && canManageAsOwner) {
    cancellationMode = "DELETE_DRAFT";
  } else if (
    canManageAsOwner &&
    (request.status === "PENDING_APPROVAL" ||
      request.status === "NEED_REVISION" ||
      request.status === "NEED_CLARIFICATION" ||
      (request.status === "DRAFT" && Boolean(request.submittedAt)))
  ) {
    cancellationMode = "CANCEL_DIRECT";
  } else if (request.status === "APPROVED" && isOwner) {
    cancellationMode = "REQUEST";
  } else if (request.status === "CANCEL_REQUESTED" && canReviewCancellation) {
    cancellationMode = "REVIEW";
  } else if (
    request.status === "ORDERED" &&
    !request.receivedAt &&
    request.receipts.length === 0 &&
    !request.hasPendingPurchaseOrderChange &&
    canHandleCancellation
  ) {
    cancellationMode = "CANCEL_ORDERED";
  }

  const canEdit =
    (request.status === "DRAFT" || isPurchasingReturnStatus) &&
    (request.requester.id === session.id || session.role === "ADMIN");
  const canApprove =
    request.status === "PENDING_APPROVAL" &&
    canApprovePurchaseRequest(session, request.currentApprover?.id ?? null);
  const canProgress =
    request.status === "APPROVED" &&
    (session.role === "PURCHASING" || session.role === "ADMIN");
  const canConfirmReceipt = request.status === "ORDERED" && !request.hasPendingPurchaseOrderChange;
  const isPurchasing = session.role === "PURCHASING" || session.role === "ADMIN";
  const canCloseOutstanding =
    isPurchasing && request.receivingItems.some((item) => item.receivedQuantity > 0);
  const canEditReceiptReferences =
    !request.hasPendingPurchaseOrderChange &&
    Boolean(request.receivedAt) &&
    (request.status === "ORDERED" || request.status === "COMPLETED") &&
    (session.role === "PURCHASING" || session.role === "ADMIN");
  const receiptReferenceStatus =
    request.status === "COMPLETED" ? "COMPLETED" : "ORDERED";
  const isAwaitingReceiptReferences =
    request.status === "ORDERED" && Boolean(request.receivedAt);
  const hasClosedRemainder = request.receivingItems.some((item) => item.closedQuantity > 0);
  const documentDetails = [
    { label: dictionary.common.documentDate, value: formatDate(request.requestDate, locale) },
    { label: dictionary.common.department, value: getDepartmentLabel(request.department, locale) },
    { label: dictionary.common.requester, value: request.requester.name },
    { label: dictionary.purchaseRequests.currentApprover, value: request.currentApprover?.name ?? dictionary.common.none },
    ...(request.orderedAt ? [{ label: dictionary.common.orderedDate, value: formatDate(request.orderedAt, locale) }] : []),
    ...(request.receivedAt ? [{ label: dictionary.common.receivedDate, value: formatDate(request.receivedAt, locale) }] : []),
    ...(request.completedAt ? [{ label: dictionary.common.completedDate, value: formatDate(request.completedAt, locale) }] : []),
    ...(request.status === "COMPLETED" || request.receiptNumber
      ? [{ label: dictionary.common.receiptNumber, value: request.receiptNumber ?? dictionary.common.none }] : []),
    ...(request.status === "COMPLETED" || request.taxInvoiceNumber
      ? [{ label: dictionary.common.taxInvoiceNumber, value: request.taxInvoiceNumber ?? dictionary.common.none }] : []),
  ];

  return (
    <div className="min-w-0 space-y-6 wrap-anywhere">
      {request.hasPendingPurchaseOrderChange ? (
        <Alert className="border-amber-500/40 bg-amber-500/10" id="pending-po-change-notice">
          <CircleAlert className="size-4" />
          <AlertTitle>{locale === "th" ? "มี PO รอตรวจการแก้ไข" : "A PO revision is awaiting review"}</AlertTitle>
          <AlertDescription>{locale === "th"
            ? "เปิด PO จากส่วนใบสั่งซื้อเพื่อดูฉบับแก้ไข ระหว่างรอตรวจ ระบบพักการรับสินค้า การยกเลิก และการปิดงานของ PR นี้"
            : "Open the PO below to review the proposed revision. Receiving, cancellation, and completion are paused until the revision is resolved."}</AlertDescription>
        </Alert>
      ) : null}
      <Link
        href="/purchase-requests"
        className="inline-flex items-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" />
        {dictionary.navigation.purchaseRequests}
      </Link>

      <section className="space-y-5 rounded-3xl border border-border/70 bg-card/90 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              status={request.status}
              receivedAt={request.receivedAt}
              hasPartialReceipt={request.hasPartialReceipt}
              hasClosedRemainder={hasClosedRemainder}
              locale={locale}
            />
            <PriorityBadge priority={request.urgency} locale={locale} />
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end *:w-full sm:*:w-auto">
            <SharePurchaseRequestButton requestId={request.id} prNumber={request.prNumber} reason={request.reason} />
            {request.canCloseOrder ? (
              <CloseOrderButton
                requestId={request.id}
                expectedVersion={request.receiptVersion}
                prNumber={request.prNumber}
              />
            ) : null}
            {canEdit ? (
              <Button asChild variant="outline" className="rounded-xl">
                <Link href={`/purchase-requests/${request.id}/edit`}>
                  <FilePenLine />
                  {isPurchasingReturnStatus ? dictionary.purchaseRequests.editReturnedRequest : dictionary.purchaseRequests.editDraft}
                </Link>
              </Button>
            ) : null}
            {request.status === "DRAFT" && isOwner ? (
              <SubmitPurchaseRequestButton requestId={request.id} />
            ) : null}
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{request.prNumber}</h1>
            <DetailText text={request.reason} locale={locale} className="text-base text-muted-foreground" />
          </div>
          <div aria-label={dictionary.purchaseRequests.totalSummary} className="min-w-0 space-y-1 rounded-2xl bg-primary/5 p-4 md:min-w-56 md:border-l md:border-border/70 md:bg-transparent md:py-0 md:pr-0 md:pl-6 md:text-right">
            <p className="text-sm text-muted-foreground">{dictionary.common.totalAmount}</p>
            <p className="text-3xl font-semibold tracking-tight text-primary tabular-nums">{formatCurrency(request.totalAmount, locale)}</p>
            <p className="text-xs text-muted-foreground">{dictionary.purchaseRequests.itemList} · {formatNumber(request.items.length, locale)} {dictionary.common.itemCount}</p>
          </div>
        </div>
        <div className="flex flex-col gap-x-6 gap-y-1 border-t border-border/70 pt-4 text-xs leading-5 text-muted-foreground sm:flex-row sm:flex-wrap">
          <p>{dictionary.common.createdAt} {formatDateTime(request.createdAt, locale)}</p>
          <p>{dictionary.common.updatedAt} {formatDateTime(request.updatedAt, locale)}</p>
        </div>
      </section>

      {request.status === "CANCEL_REQUESTED" ? (
        <Alert className="border-amber-500/25 bg-amber-500/10 text-amber-950 dark:text-amber-100">
          <CircleAlert className="size-4" />
          <AlertTitle>{dictionary.cancellation.pendingTitle}</AlertTitle>
          <AlertDescription className="space-y-2 text-amber-900/80 dark:text-amber-100/80">
            <p>{dictionary.cancellation.pendingDescription}</p>
            {latestCancellationRequest ? (
              <div className="space-y-1">
                <p>
                  {dictionary.cancellation.requestedBy}: {latestCancellationRequest.approver.name}
                </p>
                <p>
                  {dictionary.cancellation.requestedAt}:{" "}
                  {formatDateTime(latestCancellationRequest.createdAt, locale)}
                </p>
                {latestCancellationRequest.comment ? (
                  <p className="whitespace-pre-wrap font-medium">
                    {latestCancellationRequest.comment}
                  </p>
                ) : null}
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {request.status === "CANCELLED" ? (
        <Alert className="border-slate-500/25 bg-slate-500/10">
          <Ban className="size-4" />
          <AlertTitle>{dictionary.cancellation.cancelledTitle}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{dictionary.cancellation.cancelledDescription}</p>
            <div className="space-y-1">
              {request.cancellationReason ? (
                <p className="whitespace-pre-wrap font-medium">
                  {dictionary.cancellation.reasonLabel}: {request.cancellationReason}
                </p>
              ) : null}
              {request.cancellationReference ? (
                <p>
                  {dictionary.cancellation.cancellationReference}:{" "}
                  {request.cancellationReference}
                </p>
              ) : null}
              {request.cancelledBy ? (
                <p>
                  {dictionary.cancellation.cancelledBy}: {request.cancelledBy.name}
                </p>
              ) : null}
              {request.cancelledAt ? (
                <p>
                  {dictionary.cancellation.cancelledAt}:{" "}
                  {formatDateTime(request.cancelledAt, locale)}
                </p>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {isPurchasingReturnStatus ? (
        <Alert
          className={
            request.status === "NEED_REVISION"
              ? "border-rose-500/25 bg-rose-500/10 text-rose-950 dark:text-rose-100"
              : "border-amber-500/25 bg-amber-500/10 text-amber-950 dark:text-amber-100"
          }
        >
          <CircleAlert className="size-4" />
          <AlertTitle>
            {request.status === "NEED_REVISION"
              ? dictionary.approval.needRevisionTitle
              : dictionary.approval.needClarificationTitle}
          </AlertTitle>
          <AlertDescription
            className={
              request.status === "NEED_REVISION"
                ? "text-rose-900/80 dark:text-rose-100/80"
                : "text-amber-900/80 dark:text-amber-100/80"
            }
          >
            {latestPurchasingReturn?.comment
              ? translateWorkflowText(latestPurchasingReturn.comment, locale)
              : dictionary.approval.purchasingReturnNoComment}
          </AlertDescription>
          {canEdit ? (
            <AlertAction>
              <Button asChild size="sm" variant="outline" className="bg-background/70">
                <Link href={`/purchase-requests/${request.id}/edit`}>
                  {dictionary.purchaseRequests.editReturnedRequest}
                </Link>
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      ) : null}

      {isAwaitingReceiptReferences && canEditReceiptReferences ? (
        <Alert className="border-amber-500/25 bg-amber-500/10 text-amber-950 dark:text-amber-100">
          <CircleAlert className="size-4" />
          <AlertTitle>{hasClosedRemainder ? dictionary.receiptWorkflow.settledWithClosureTitle : dictionary.approval.receiptReferencesPendingTitle}</AlertTitle>
          <AlertDescription className="text-amber-900/80 dark:text-amber-100/80">
            {hasClosedRemainder ? dictionary.receiptWorkflow.settledWithClosureDescription : dictionary.approval.receiptReferencesPendingDescription}
          </AlertDescription>
          <AlertAction>
            <Button
              asChild
              size="sm"
              variant="outline"
              className="border-amber-500/30 bg-background/70"
            >
              <a href="#receipt-reference-panel">
                {dictionary.approval.receiptReferencesPendingAction}
              </a>
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
        <div className="min-w-0 space-y-5 lg:space-y-6">
          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center gap-2.5 border-b">
              <FileText className="size-4 shrink-0 text-primary" />
              <CardTitle role="heading" aria-level={2}>{dictionary.purchaseRequests.detailTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
                {documentDetails.map((detail) => (
                  <div key={detail.label} className="min-w-0 space-y-1">
                    <dt className="text-xs text-muted-foreground">{detail.label}</dt>
                    <dd className="font-medium leading-6">{detail.value}</dd>
                  </div>
                ))}
              </dl>
              {request.status === "COMPLETED" || request.receiptReferenceNote ? (
                <div className="space-y-1.5 border-t border-border/70 pt-4">
                  <p className="text-xs text-muted-foreground">{dictionary.common.comment}</p>
                  <DetailText text={request.receiptReferenceNote ?? dictionary.common.none} locale={locale} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          {request.purchaseOrders.length > 0 ? (
            <Card className="border-border/70">
              <CardHeader><CardTitle role="heading" aria-level={2}>{dictionary.purchaseOrders.linkedTitle}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {request.purchaseOrders.map((order) => (
                  <div key={order.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/70 p-4">
                    <div className="min-w-0 space-y-1">
                      <Link href={`/purchase-orders/${order.id}`} className="font-semibold text-primary underline underline-offset-4">{order.poNumber}</Link>
                      <p className="text-sm text-muted-foreground">{order.supplierName} · {formatDate(order.issuedAt, locale)}</p>
                    </div>
                    <p className="font-medium tabular-nums">{formatCurrency(order.totalAmount, locale)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b">
              <div className="flex min-w-0 items-center gap-2.5">
                <Package className="size-4 shrink-0 text-primary" />
                <CardTitle role="heading" aria-level={2}>{dictionary.purchaseRequests.itemList}</CardTitle>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{request.items.length} {dictionary.common.itemCount}</span>
            </CardHeader>
            <CardContent className="space-y-4">
              {request.items.map((item, index) => (
                <article key={item.id} className="min-w-0 overflow-hidden rounded-2xl border border-border/70">
                  <div className="space-y-4 p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <h3 className="font-semibold leading-6">{item.itemName}</h3>
                        <DetailText text={item.description || dictionary.common.noDescription} locale={locale} className="text-muted-foreground" />
                      </div>
                    </div>
                    {item.supplierName ? (
                      <div className="min-w-0 space-y-1.5 rounded-xl bg-muted/40 px-3 py-3">
                        <p className="text-xs text-muted-foreground">{dictionary.purchaseRequests.supplierName}</p>
                        <DetailText text={item.supplierName} locale={locale} />
                      </div>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-4 border-t border-border/70 bg-muted/20 p-4 sm:grid-cols-3 sm:px-5">
                    <div className="min-w-0 space-y-1">
                      <dt className="text-xs text-muted-foreground">{dictionary.purchaseRequests.quantityUnit}</dt>
                      <dd className="font-medium tabular-nums">{formatNumber(item.quantity, locale)}{item.unit ? ` ${getUnitLabel(item.unit, locale)}` : ""}</dd>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <dt className="text-xs text-muted-foreground">{dictionary.purchaseRequests.unitPrice}</dt>
                      <dd className="font-medium tabular-nums">{item.unitPrice === undefined ? "-" : formatCurrency(item.unitPrice, locale)}</dd>
                      {item.taxMode && item.taxMode !== "UNSPECIFIED" ? <p className="text-xs text-muted-foreground">{dictionary.poTax[item.taxMode]}{item.taxMode === "NONE" ? "" : ` ${item.vatRate ?? 7}%`}</p> : null}
                    </div>
                    <div className="col-span-2 min-w-0 space-y-1 border-t border-border/70 pt-3 sm:col-span-1 sm:border-t-0 sm:pt-0">
                      <dt className="text-xs text-muted-foreground">{dictionary.purchaseRequests.lineTotal}</dt>
                      <dd className="font-semibold text-primary tabular-nums">{formatCurrency(item.amount, locale)}</dd>
                    </div>
                  </dl>
                  {(item.discountAmount ?? 0) > 0 ? (
                    <dl className="grid grid-cols-2 gap-4 border-t border-border/70 p-4 sm:grid-cols-3 sm:px-5">
                      {[
                        { label: dictionary.poDiscount.itemDiscountAmount, value: item.itemDiscountAmount },
                        { label: dictionary.poDiscount.orderDiscountAmount, value: item.orderDiscountAmount },
                        { label: dictionary.poDiscount.discountedSubtotalAmount, value: item.discountedAmount },
                      ].map((value) => <div key={value.label} className="min-w-0 space-y-1"><dt className="text-xs text-muted-foreground">{value.label}</dt><dd className="font-medium tabular-nums">{value.value == null ? "—" : formatCurrency(value.value, locale)}</dd></div>)}
                    </dl>
                  ) : null}
                  {(item.taxMode && item.taxMode !== "UNSPECIFIED") || (item.discountAmount ?? 0) > 0 ? (
                    <dl className="grid grid-cols-2 gap-4 border-t border-border/70 bg-primary/5 p-4 sm:grid-cols-3 sm:px-5">
                      {[
                        { label: dictionary.poTax.netAmount, value: item.netAmount },
                        { label: dictionary.poTax.taxAmount, value: item.taxAmount },
                        { label: dictionary.poTax.totalAmount, value: item.totalWithTax },
                      ].map((value) => <div key={value.label} className="min-w-0 space-y-1"><dt className="text-xs text-muted-foreground">{value.label}</dt><dd className="font-medium tabular-nums">{value.value == null ? "—" : formatCurrency(value.value, locale)}</dd></div>)}
                    </dl>
                  ) : null}
                  {!request.purchaseOrders.length && (request.receipts.length > 0 || hasClosedRemainder) ? (
                    <dl className="grid grid-cols-2 gap-4 border-t border-border/70 p-4 sm:grid-cols-4 sm:px-5">
                      {[
                        { label: dictionary.receiptWorkflow.received, value: item.receivedQuantity },
                        { label: dictionary.receiptWorkflow.cancelled, value: item.closedQuantity },
                        { label: dictionary.receiptWorkflow.remaining, value: item.remainingQuantity },
                        { label: dictionary.receiptWorkflow.overReceived, value: item.overReceivedQuantity },
                      ].map((stat, statIndex) => (
                        <div key={stat.label} className="min-w-0 space-y-1">
                          <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                          <dd className={statIndex === 3 && stat.value > 0 ? "font-medium text-amber-700 tabular-nums dark:text-amber-300" : "font-medium tabular-nums"}>{formatNumber(stat.value, locale)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </article>
              ))}
            </CardContent>
          </Card>

          {request.purchaseOrders.length > 0 ? (
            <Card className="border-border/70" data-testid="po-receiving-items">
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>{dictionary.receiptWorkflow.poItemsTitle}</CardTitle>
                <p className="text-sm text-muted-foreground">{dictionary.receiptWorkflow.poItemsDescription}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {request.receivingItems.map((item) => (
                  <article key={item.id} className="min-w-0 space-y-3 rounded-xl border border-border/70 p-4">
                    <div className="min-w-0 space-y-1">
                      <h3 className="font-medium [overflow-wrap:anywhere]">{item.itemName}</h3>
                      {item.supplierName ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.supplierName}</p> : null}
                    </div>
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {[
                        { label: dictionary.receiptWorkflow.ordered, value: item.quantity },
                        { label: dictionary.receiptWorkflow.received, value: item.receivedQuantity },
                        { label: dictionary.receiptWorkflow.cancelled, value: item.closedQuantity },
                        { label: dictionary.receiptWorkflow.remaining, value: item.remainingQuantity },
                        { label: dictionary.receiptWorkflow.overReceived, value: item.overReceivedQuantity },
                      ].map((stat) => (
                        <div key={stat.label} className="min-w-0 space-y-1">
                          <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                          <dd className="font-medium tabular-nums">{formatNumber(stat.value, locale)}{item.unit ? ` ${getUnitLabel(item.unit, locale)}` : ""}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {canApprove ? <ApprovalActionPanel requestId={request.id} /> : null}
          {canProgress ? <PurchasingProgressPanel requestId={request.id} status={request.status} /> : null}
          {canConfirmReceipt ? (
            <ReceiptConfirmationPanel
              key={request.receiptVersion}
              requestId={request.id}
              expectedVersion={request.receiptVersion}
              items={request.receivingItems}
              canCloseOutstanding={canCloseOutstanding}
            />
          ) : null}
          {canEditReceiptReferences ? (
            <ReceiptReferencePanel
              requestId={request.id}
              expectedVersion={request.receiptVersion}
              status={receiptReferenceStatus}
              receiptNumber={request.receiptNumber}
              taxInvoiceNumber={request.taxInvoiceNumber}
              receiptReferenceNote={request.receiptReferenceNote}
            />
          ) : null}
          <ReceiptHistoryPanel
            requestId={request.id}
            expectedVersion={request.receiptVersion}
            receipts={request.receipts}
            canEditReferences={isPurchasing}
          />

          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center gap-2.5 border-b">
              <GitBranch className="size-4 shrink-0 text-primary" />
              <CardTitle role="heading" aria-level={2}>{dictionary.purchaseRequests.timelineTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol>
                {request.approvals.map((approval, index) => {
                  const actionLabel = approval.action === "COMMENTED" && approval.stepLabel
                    ? translateWorkflowText(approval.stepLabel, locale)
                    : formatApprovalAction(approval.action, locale);
                  const stepLabel = approval.action === "COMMENTED" ? null : translateWorkflowText(approval.stepLabel, locale);
                  return (
                    <li key={approval.id} className="relative flex gap-3 pb-6 last:pb-0 sm:gap-4">
                      {index < request.approvals.length - 1 ? <span aria-hidden="true" className="absolute top-9 bottom-0 left-4 w-px bg-border" /> : null}
                      <div className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <UserRoundCheck className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1 pt-0.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="font-medium">{actionLabel}</p>
                          {stepLabel ? <span className="text-xs text-muted-foreground">{stepLabel}</span> : null}
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">{approval.approver.name} · {formatDateTime(approval.createdAt, locale)}</p>
                        {approval.comment ? <DetailText text={translateWorkflowText(approval.comment, locale) ?? approval.comment} locale={locale} className="pt-1" /> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>

        <aside aria-label={dictionary.purchaseRequests.attachmentsTitle} className="min-w-0 space-y-5 lg:space-y-6">
          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center gap-2.5 border-b">
              <Paperclip className="size-4 shrink-0 text-primary" />
              <CardTitle role="heading" aria-level={2}>{dictionary.purchaseRequests.attachmentsTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {request.attachments.length ? request.attachments.map((attachment) => (
                <div key={attachment.id} className="min-w-0 space-y-3 rounded-xl border border-border/70 p-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium leading-5">{attachment.originalName}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{formatFileSize(attachment.size, locale)} · {dictionary.purchaseRequests.uploadedBy} {attachment.uploadedBy.name}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AttachmentPreviewButton requestId={request.id} attachment={attachment} />
                    <Button asChild variant="outline" size="sm" className="rounded-xl">
                      <a href={`/api/purchase-requests/${request.id}/attachments/${attachment.id}`}>
                        <Download />
                        {dictionary.purchaseRequests.downloadAttachment}
                      </a>
                    </Button>
                  </div>
                </div>
              )) : (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm leading-6 text-muted-foreground">{dictionary.purchaseRequests.noAttachments}</div>
              )}
            </CardContent>
          </Card>
          <PurchaseRequestCommentPanel requestId={request.id} />
          {cancellationMode ? (
            <PurchaseRequestCancellationPanel requestId={request.id} mode={cancellationMode} requestedReason={latestCancellationRequest?.comment} />
          ) : null}
        </aside>
      </section>
    </div>
  );
}
