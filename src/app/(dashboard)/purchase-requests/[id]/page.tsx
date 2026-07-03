import Link from "next/link";
import {
  CircleAlert,
  Download,
  FilePenLine,
  GitBranch,
  Paperclip,
  ReceiptText,
  UserRoundCheck,
} from "lucide-react";

import { ApprovalActionPanel } from "@/components/purchase-requests/approval-action-panel";
import { PriorityBadge } from "@/components/purchase-requests/priority-badge";
import { PurchasingProgressPanel } from "@/components/purchase-requests/purchasing-progress-panel";
import { ReceiptConfirmationPanel } from "@/components/purchase-requests/receipt-confirmation-panel";
import { ReceiptReferencePanel } from "@/components/purchase-requests/receipt-reference-panel";
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

  const canEdit =
    request.status === "DRAFT" &&
    (request.requester.id === session.id || session.role === "ADMIN");
  const canApprove =
    request.status === "PENDING_APPROVAL" &&
    (session.role === "APPROVER" || session.role === "ADMIN");
  const canProgress =
    request.status === "APPROVED" &&
    (session.role === "PURCHASING" || session.role === "ADMIN");
  const canConfirmReceipt =
    request.status === "ORDERED" && !request.receivedAt;
  const canEditReceiptReferences =
    ((request.status === "ORDERED" && request.receivedAt) ||
      request.status === "COMPLETED") &&
    (session.role === "PURCHASING" || session.role === "ADMIN");
  const receiptReferenceStatus =
    request.status === "COMPLETED" ? "COMPLETED" : "ORDERED";
  const isAwaitingReceiptReferences =
    request.status === "ORDERED" && Boolean(request.receivedAt);
  const statusLabel = isAwaitingReceiptReferences
    ? dictionary.approval.awaitingReceiptReferences
    : undefined;
  const statusClassName = isAwaitingReceiptReferences
    ? "bg-amber-500/15 text-amber-700 ring-amber-500/20 dark:text-amber-300"
    : undefined;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-[2rem] border border-border/70 bg-card/80 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge
                status={request.status}
                locale={locale}
                label={statusLabel}
                className={statusClassName}
              />
              <PriorityBadge priority={request.urgency} locale={locale} />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{request.prNumber}</h1>
              <p className="text-muted-foreground">{request.reason}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
            {canEdit ? (
              <Button asChild variant="outline" className="rounded-xl">
                <Link href={`/purchase-requests/${request.id}/edit`}>
                  <FilePenLine />
                  {dictionary.purchaseRequests.editDraft}
                </Link>
              </Button>
            ) : null}
            {request.status === "DRAFT" && request.requester.id === session.id ? (
              <SubmitPurchaseRequestButton requestId={request.id} />
            ) : null}
          </div>
        </div>
      </section>

      {isAwaitingReceiptReferences && canEditReceiptReferences ? (
        <Alert className="border-amber-500/25 bg-amber-500/10 text-amber-950 dark:text-amber-100">
          <CircleAlert className="size-4" />
          <AlertTitle>{dictionary.approval.receiptReferencesPendingTitle}</AlertTitle>
          <AlertDescription className="text-amber-900/80 dark:text-amber-100/80">
            {dictionary.approval.receiptReferencesPendingDescription}
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

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>{dictionary.purchaseRequests.detailTitle}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">
                  {dictionary.common.documentDate}
                </p>
                <p className="font-medium">{formatDate(request.requestDate, locale)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {dictionary.common.department}
                </p>
                <p className="font-medium">
                  {getDepartmentLabel(request.department, locale)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {dictionary.common.requester}
                </p>
                <p className="font-medium">{request.requester.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {dictionary.purchaseRequests.currentApprover}
                </p>
                <p className="font-medium">
                  {request.currentApprover?.name ?? dictionary.common.none}
                </p>
              </div>
              {request.orderedAt ? (
                <div>
                  <p className="text-sm text-muted-foreground">
                    {dictionary.common.orderedDate}
                  </p>
                  <p className="font-medium">{formatDate(request.orderedAt, locale)}</p>
                </div>
              ) : null}
              {request.receivedAt ? (
                <div>
                  <p className="text-sm text-muted-foreground">
                    {dictionary.common.receivedDate}
                  </p>
                  <p className="font-medium">
                    {formatDate(request.receivedAt, locale)}
                  </p>
                </div>
              ) : null}
              {request.completedAt ? (
                <div>
                  <p className="text-sm text-muted-foreground">
                    {dictionary.common.completedDate}
                  </p>
                  <p className="font-medium">
                    {formatDate(request.completedAt, locale)}
                  </p>
                </div>
              ) : null}
              {request.status === "COMPLETED" || request.receiptNumber ? (
                <div>
                  <p className="text-sm text-muted-foreground">
                    {dictionary.common.receiptNumber}
                  </p>
                  <p className="font-medium">
                    {request.receiptNumber ?? dictionary.common.none}
                  </p>
                </div>
              ) : null}
              {request.status === "COMPLETED" || request.taxInvoiceNumber ? (
                <div>
                  <p className="text-sm text-muted-foreground">
                    {dictionary.common.taxInvoiceNumber}
                  </p>
                  <p className="font-medium">
                    {request.taxInvoiceNumber ?? dictionary.common.none}
                  </p>
                </div>
              ) : null}
              {request.status === "COMPLETED" || request.receiptReferenceNote ? (
                <div className="sm:col-span-2">
                  <p className="text-sm text-muted-foreground">
                    {dictionary.common.comment}
                  </p>
                  <p className="font-medium">
                    {request.receiptReferenceNote ?? dictionary.common.none}
                  </p>
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <p className="text-sm text-muted-foreground">
                  {dictionary.purchaseRequests.reason}
                </p>
                <p className="font-medium">{request.reason}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>{dictionary.purchaseRequests.itemList}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {request.items.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 rounded-2xl border border-border/70 p-4 sm:grid-cols-[1.2fr_1fr_0.6fr_0.8fr]"
                >
                  <div>
                    <p className="font-medium">{item.itemName}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.description || dictionary.common.noDescription}
                    </p>
                    {item.supplierName ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {dictionary.purchaseRequests.supplierName}:{" "}
                        <span className="font-medium text-foreground">
                          {item.supplierName}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <div className="text-sm">
                    <p className="text-muted-foreground">
                      {dictionary.purchaseRequests.quantityUnit}
                    </p>
                    <p className="font-medium">
                      {formatNumber(item.quantity, locale)}
                      {item.unit ? ` ${getUnitLabel(item.unit, locale)}` : ""}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p className="text-muted-foreground">
                      {dictionary.purchaseRequests.unitPrice}
                    </p>
                    <p className="font-medium">
                      {item.unitPrice === undefined
                        ? "-"
                        : formatCurrency(item.unitPrice, locale)}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p className="text-muted-foreground">
                      {dictionary.purchaseRequests.lineTotal}
                    </p>
                    <p className="font-semibold">{formatCurrency(item.amount, locale)}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center gap-3">
              <GitBranch className="size-5 text-primary" />
              <CardTitle>{dictionary.purchaseRequests.timelineTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {request.approvals.map((approval, index) => (
                  <div key={approval.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <UserRoundCheck className="size-4" />
                      </div>
                      {index < request.approvals.length - 1 ? (
                        <div className="mt-2 h-full w-px bg-border" />
                      ) : null}
                    </div>
                    <div className="flex-1 pb-4">
                      {(() => {
                        const actionLabel =
                          approval.action === "COMMENTED" && approval.stepLabel
                            ? translateWorkflowText(approval.stepLabel, locale)
                            : formatApprovalAction(approval.action, locale);
                        const stepLabel =
                          approval.action === "COMMENTED"
                            ? null
                            : translateWorkflowText(approval.stepLabel, locale);

                        return (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{actionLabel}</p>
                        {stepLabel ? (
                          <span className="text-sm text-muted-foreground">
                            {stepLabel}
                          </span>
                        ) : null}
                      </div>
                        );
                      })()}
                      <p className="text-sm text-muted-foreground">
                        {approval.approver.name} ·{" "}
                        {formatDateTime(approval.createdAt, locale)}
                      </p>
                      {approval.comment ? (
                        <p className="mt-2 text-sm">
                          {translateWorkflowText(approval.comment, locale)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center gap-3">
              <ReceiptText className="size-5 text-primary" />
              <CardTitle>{dictionary.purchaseRequests.totalSummary}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {dictionary.purchaseRequests.itemList}
                </span>
                <span className="font-medium">{request.items.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {dictionary.common.totalAmount}
                </span>
                <span className="text-2xl font-semibold">
                  {formatCurrency(request.totalAmount, locale)}
                </span>
              </div>
              <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                <p>
                  {dictionary.common.createdAt}{" "}
                  {formatDateTime(request.createdAt, locale)}
                </p>
                <p>
                  {dictionary.common.updatedAt}{" "}
                  {formatDateTime(request.updatedAt, locale)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center gap-3">
              <Paperclip className="size-5 text-primary" />
              <CardTitle>{dictionary.purchaseRequests.attachmentsTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {request.attachments.length ? (
                request.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={`/api/purchase-requests/${request.id}/attachments/${attachment.id}`}
                    className="flex items-start justify-between gap-3 rounded-2xl border border-border/70 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {attachment.originalName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(attachment.size, locale)} ·{" "}
                        {dictionary.purchaseRequests.uploadedBy}{" "}
                        {attachment.uploadedBy.name}
                      </p>
                    </div>
                    <Download className="mt-0.5 size-4 shrink-0 text-primary" />
                  </a>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  {dictionary.purchaseRequests.noAttachments}
                </div>
              )}
            </CardContent>
          </Card>

          {canApprove ? <ApprovalActionPanel requestId={request.id} /> : null}
          {canProgress ? (
            <PurchasingProgressPanel requestId={request.id} status={request.status} />
          ) : null}
          {canConfirmReceipt ? (
            <ReceiptConfirmationPanel requestId={request.id} />
          ) : null}
          {canEditReceiptReferences ? (
            <ReceiptReferencePanel
              requestId={request.id}
              status={receiptReferenceStatus}
              receiptNumber={request.receiptNumber}
              taxInvoiceNumber={request.taxInvoiceNumber}
              receiptReferenceNote={request.receiptReferenceNote}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
