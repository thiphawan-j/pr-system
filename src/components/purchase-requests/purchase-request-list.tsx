"use client";

import Link from "@/components/loading/navigation-link";
import { ChevronLeft, ChevronRight, Eye, FilePenLine } from "lucide-react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { PriorityBadge } from "@/components/purchase-requests/priority-badge";
import { StatusBadge } from "@/components/purchase-requests/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { getDepartmentLabel, interpolate } from "@/lib/i18n";
import type {
  PurchaseRequestListItem,
  SessionUser,
} from "@/lib/types";

type PurchaseRequestListProps = {
  currentUserId: string;
  currentUserRole: SessionUser["role"];
  items: PurchaseRequestListItem[];
  page: number;
  totalCount: number;
  totalPages: number;
  queryString: string;
};

type PaginationItem = number | "ellipsis";

function getPaginationItems(page: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((item) => item >= 1 && item <= totalPages)
    .sort((a, b) => a - b);

  return pages.flatMap((item, index) => {
    const previous = pages[index - 1];

    return previous !== undefined && item - previous > 1
      ? ["ellipsis" as const, item]
      : [item];
  });
}

function getPageHref(queryString: string, page: number) {
  const params = new URLSearchParams(queryString);

  if (page === 1) {
    params.delete("page");
  } else {
    params.set("page", String(page));
  }

  const query = params.toString();

  return `/purchase-requests${query ? `?${query}` : ""}`;
}

function canEditDraft(
  request: PurchaseRequestListItem,
  currentUserId: string,
  currentUserRole: SessionUser["role"],
) {
  return (
    request.status === "DRAFT" &&
    (currentUserId === request.requesterId || currentUserRole === "ADMIN")
  );
}

function ItemNamesSummary({ request }: { request: PurchaseRequestListItem }) {
  const { dictionary, locale } = useI18n();
  const remainingCount = Math.max(0, request.itemCount - request.itemNames.length);

  if (!request.itemNames.length) {
    return null;
  }

  return (
    <div className="min-w-0 space-y-1 whitespace-normal">
      <p className="text-xs text-muted-foreground">{dictionary.purchaseRequests.itemList}</p>
      <ul className="min-w-0 space-y-0.5 text-xs leading-5">
        {request.itemNames.map((name, index) => (
          <li key={`${index}-${name}`} className="line-clamp-1 wrap-anywhere" title={name}>
            {name}
          </li>
        ))}
      </ul>
      {remainingCount > 0 ? (
        <Link
          href={`/purchase-requests/${request.id}`}
          className="inline-block rounded-sm text-xs font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={`${dictionary.purchaseRequests.itemList} ${request.prNumber}: ${interpolate(dictionary.purchaseRequests.moreItems, { count: formatNumber(remainingCount, locale) })}`}
        >
          {interpolate(dictionary.purchaseRequests.moreItems, { count: formatNumber(remainingCount, locale) })}
        </Link>
      ) : null}
    </div>
  );
}

export function PurchaseRequestList({
  currentUserId,
  currentUserRole,
  items,
  page,
  totalCount,
  totalPages,
  queryString,
}: PurchaseRequestListProps) {
  const { dictionary, locale } = useI18n();

  if (!items.length) {
    return (
      <Card className="border-dashed border-border/80">
        <CardContent className="py-12 text-center text-muted-foreground">
          {dictionary.purchaseRequests.empty}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:hidden">
        {items.map((request) => (
          <Card key={request.id} className="border-border/70">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{request.prNumber}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {request.requesterName} ·{" "}
                    {getDepartmentLabel(request.requesterDepartment, locale)}
                  </p>
                </div>
                <StatusBadge
                  status={request.status}
                  receivedAt={request.receivedAt}
                  hasPartialReceipt={request.hasPartialReceipt}
                  hasClosedRemainder={request.hasClosedRemainder}
                  locale={locale}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <PriorityBadge priority={request.urgency} locale={locale} />
              </div>
            </CardHeader>
            <CardContent className="min-w-0 space-y-3 text-sm">
              <p>{request.reason}</p>
              <ItemNamesSummary request={request} />
              <div className="grid grid-cols-2 gap-3 text-muted-foreground">
                <div>
                  <p>{dictionary.common.date}</p>
                  <p className="font-medium text-foreground">
                    {formatDate(request.requestDate, locale)}
                  </p>
                </div>
                <div>
                  <p>{dictionary.common.updatedAt}</p>
                  <p className="font-medium text-foreground">
                    {formatDateTime(request.updatedAt, locale)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" className="flex-1 rounded-xl">
                  <Link href={`/purchase-requests/${request.id}`}>
                    <Eye />
                    {dictionary.common.details}
                  </Link>
                </Button>
                {canEditDraft(request, currentUserId, currentUserRole) ? (
                  <Button asChild className="rounded-xl">
                    <Link href={`/purchase-requests/${request.id}/edit`}>
                      <FilePenLine />
                      {dictionary.common.edit}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="hidden lg:block">
        <Card className="border-border/70">
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dictionary.purchaseRequests.prNumber}</TableHead>
                  <TableHead>{dictionary.common.requester}</TableHead>
                  <TableHead>{dictionary.common.date}</TableHead>
                  <TableHead>{dictionary.common.status}</TableHead>
                  <TableHead>{dictionary.common.priority}</TableHead>
                  <TableHead>{dictionary.common.updatedAt}</TableHead>
                  <TableHead className="text-right">{dictionary.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="max-w-xs whitespace-normal">
                      <div className="min-w-0 max-w-xs space-y-2">
                        <div>
                          <p className="font-medium">{request.prNumber}</p>
                          <p className="line-clamp-1 text-xs text-muted-foreground wrap-anywhere">
                            {request.reason}
                          </p>
                        </div>
                        <ItemNamesSummary request={request} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p>{request.requesterName}</p>
                        <p className="text-xs text-muted-foreground">
                          {getDepartmentLabel(request.requesterDepartment, locale)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(request.requestDate, locale)}</TableCell>
                    <TableCell>
                      <StatusBadge
                        status={request.status}
                        receivedAt={request.receivedAt}
                        hasPartialReceipt={request.hasPartialReceipt}
                        hasClosedRemainder={request.hasClosedRemainder}
                        locale={locale}
                      />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={request.urgency} locale={locale} />
                    </TableCell>
                    <TableCell>
                      {formatDateTime(request.updatedAt, locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/purchase-requests/${request.id}`}>
                            <Eye />
                            {dictionary.common.open}
                          </Link>
                        </Button>
                        {canEditDraft(request, currentUserId, currentUserRole) ? (
                          <Button asChild size="sm">
                            <Link href={`/purchase-requests/${request.id}/edit`}>
                              <FilePenLine />
                              {dictionary.common.edit}
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {totalPages > 1 ? (
        <nav
          aria-label={dictionary.purchaseRequests.paginationLabel}
          className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 sm:flex-row"
        >
          <p className="text-sm text-muted-foreground">
            {interpolate(dictionary.purchaseRequests.paginationSummary, {
              page,
              totalPages,
              totalCount,
            })}
          </p>

          <div className="flex items-center gap-1">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={getPageHref(queryString, page - 1)}
                  aria-label={dictionary.purchaseRequests.previousPage}
                >
                  <ChevronLeft />
                  <span className="hidden sm:inline">
                    {dictionary.purchaseRequests.previousPage}
                  </span>
                </Link>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                aria-label={dictionary.purchaseRequests.previousPage}
                disabled
              >
                <ChevronLeft />
                <span className="hidden sm:inline">
                  {dictionary.purchaseRequests.previousPage}
                </span>
              </Button>
            )}

            <div className="hidden items-center gap-1 sm:flex">
              {getPaginationItems(page, totalPages).map((item, index) =>
                item === "ellipsis" ? (
                  <span
                    key={`ellipsis-${index}`}
                    className="flex size-7 items-center justify-center text-sm text-muted-foreground"
                    aria-hidden="true"
                  >
                    ...
                  </span>
                ) : (
                  <Button
                    key={item}
                    asChild
                    variant={item === page ? "default" : "outline"}
                    size="icon-sm"
                  >
                    <Link
                      href={getPageHref(queryString, item)}
                      aria-current={item === page ? "page" : undefined}
                      aria-label={`${dictionary.purchaseRequests.paginationLabel}: ${item}`}
                    >
                      {item}
                    </Link>
                  </Button>
                ),
              )}
            </div>

            {page < totalPages ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={getPageHref(queryString, page + 1)}
                  aria-label={dictionary.purchaseRequests.nextPage}
                >
                  <span className="hidden sm:inline">
                    {dictionary.purchaseRequests.nextPage}
                  </span>
                  <ChevronRight />
                </Link>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                aria-label={dictionary.purchaseRequests.nextPage}
                disabled
              >
                <span className="hidden sm:inline">
                  {dictionary.purchaseRequests.nextPage}
                </span>
                <ChevronRight />
              </Button>
            )}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
