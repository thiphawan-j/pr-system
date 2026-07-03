"use client";

import Link from "next/link";
import { Eye, FilePenLine, Loader2 } from "lucide-react";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

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
import { purchaseRequestListPageSize } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { ApiClientError, apiFetch } from "@/lib/http";
import { getDepartmentLabel, translateMessage } from "@/lib/i18n";
import type {
  PurchaseRequestListItem,
  PurchaseRequestListPage,
  SessionUser,
} from "@/lib/types";

type PurchaseRequestListProps = {
  currentUserId: string;
  currentUserRole: SessionUser["role"];
  initialItems: PurchaseRequestListItem[];
  initialHasMore: boolean;
  initialNextPage: number | null;
  queryString: string;
};

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

export function PurchaseRequestList({
  currentUserId,
  currentUserRole,
  initialItems,
  initialHasMore,
  initialNextPage,
  queryString,
}: PurchaseRequestListProps) {
  const { dictionary, locale } = useI18n();
  const [requests, setRequests] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextPage, setNextPage] = useState(initialNextPage);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchMoreRequestsRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setRequests(initialItems);
    setHasMore(initialHasMore);
    setNextPage(initialNextPage);
    setIsLoadingMore(false);
    setLoadError(null);

    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [initialHasMore, initialItems, initialNextPage, queryString]);

  async function fetchMoreRequests() {
    if (isLoadingMore || !hasMore || nextPage === null) {
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsLoadingMore(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams(queryString);
      params.set("page", String(nextPage));
      params.set("limit", String(purchaseRequestListPageSize));

      const payload = await apiFetch<PurchaseRequestListPage>(
        `/api/purchase-requests?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        },
      );

      startTransition(() => {
        setRequests((current) => {
          const seenIds = new Set(current.map((item) => item.id));
          const appendedItems = payload.items.filter((item) => !seenIds.has(item.id));

          return [...current, ...appendedItems];
        });
        setHasMore(payload.hasMore);
        setNextPage(payload.nextPage);
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const message =
        error instanceof ApiClientError
          ? translateMessage(error.message, locale) ??
            dictionary.purchaseRequests.loadMoreError
          : dictionary.purchaseRequests.loadMoreError;

      setLoadError(message);
      toast.error(message);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }

      setIsLoadingMore(false);
    }
  }
  fetchMoreRequestsRef.current = fetchMoreRequests;

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel || !hasMore || nextPage === null || isLoadingMore || loadError) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchMoreRequestsRef.current();
        }
      },
      {
        rootMargin: "160px 0px",
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoadingMore, loadError, nextPage, queryString, requests.length]);

  if (!requests.length) {
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
        {requests.map((request) => (
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
                <StatusBadge status={request.status} locale={locale} />
              </div>
              <div className="flex flex-wrap gap-2">
                <PriorityBadge priority={request.urgency} locale={locale} />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>{request.reason}</p>
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
                {requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{request.prNumber}</p>
                        <p className="line-clamp-1 max-w-xs text-xs text-muted-foreground">
                          {request.reason}
                        </p>
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
                      <StatusBadge status={request.status} locale={locale} />
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

      <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

      {isLoadingMore ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>{dictionary.purchaseRequests.loadingMore}</span>
        </div>
      ) : null}

      {loadError ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-4 py-5 text-center">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button type="button" variant="outline" onClick={() => void fetchMoreRequests()}>
            {dictionary.common.retry}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
