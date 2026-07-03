import Link from "next/link";
import { Search } from "lucide-react";

import { PurchaseRequestList } from "@/components/purchase-requests/purchase-request-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { departments, purchaseRequestListPageSize } from "@/lib/constants";
import { getDepartmentLabel } from "@/lib/i18n";
import { filterablePurchaseRequestStatuses } from "@/lib/types";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary, getCurrentLocale } from "@/server/i18n";
import { purchaseRequestFiltersSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { listPurchaseRequestsPage } from "@/server/purchase-requests/purchase-request.service";

function firstOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function toFilterQueryString(filters: ReturnType<typeof purchaseRequestFiltersSchema.parse>) {
  return new URLSearchParams(
    Object.entries(filters).flatMap(([key, value]) =>
      value ? [[key, value]] : [],
    ),
  ).toString();
}

export default async function PurchaseRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const [locale, dictionary] = await Promise.all([
    getCurrentLocale(),
    getCurrentDictionary(),
  ]);
  const rawSearchParams = await searchParams;
  const filters = purchaseRequestFiltersSchema.parse({
    query: firstOf(rawSearchParams.query),
    status: firstOf(rawSearchParams.status),
    preset: firstOf(rawSearchParams.preset),
    department: firstOf(rawSearchParams.department),
    from: firstOf(rawSearchParams.from),
    to: firstOf(rawSearchParams.to),
    sort: firstOf(rawSearchParams.sort),
  });
  const quickFilterTitle =
    filters.preset === "pending"
      ? dictionary.dashboard.pendingTitle
      : filters.preset === "approved"
        ? dictionary.dashboard.approvedTitle
        : filters.preset === "rejected"
          ? dictionary.dashboard.rejectedTitle
          : filters.preset === "awaiting_receipt"
            ? dictionary.dashboard.awaitingReceiptTitle
            : null;

  const initialPage = await listPurchaseRequestsPage(session, filters, {
    page: 1,
    limit: purchaseRequestListPageSize,
  });
  const filterQueryString = toFilterQueryString(filters);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {dictionary.purchaseRequests.listTitle}
        </h1>
        <p className="text-muted-foreground">
          {dictionary.purchaseRequests.listDescription}
        </p>
      </div>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>{dictionary.purchaseRequests.filtersTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 lg:grid-cols-6">
            {filters.preset ? (
              <input type="hidden" name="preset" value={filters.preset} />
            ) : null}

            {quickFilterTitle ? (
              <div className="lg:col-span-6">
                <div className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium text-primary">
                      {dictionary.purchaseRequests.quickFilterLabel}
                    </p>
                    <p className="text-sm font-medium">{quickFilterTitle}</p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                    <Link href="/purchase-requests">
                      {dictionary.purchaseRequests.clearQuickFilter}
                    </Link>
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="query">{dictionary.purchaseRequests.searchLabel}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="query"
                  name="query"
                  defaultValue={filters.query}
                  className="pl-9"
                  placeholder={dictionary.purchaseRequests.searchPlaceholder}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">{dictionary.common.status}</Label>
              <select
                id="status"
                name="status"
                defaultValue={filters.status}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="ALL">{dictionary.common.all}</option>
                {filterablePurchaseRequestStatuses.map((status) => (
                  <option key={status} value={status}>
                    {dictionary.statuses[status]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="department">{dictionary.common.department}</Label>
              <select
                id="department"
                name="department"
                defaultValue={filters.department}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="ALL">{dictionary.common.all}</option>
                {departments.map((department) => (
                  <option key={department} value={department}>
                    {getDepartmentLabel(department, locale)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="from">{dictionary.common.documentDateFrom}</Label>
              <Input id="from" name="from" type="date" defaultValue={filters.from} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="to">{dictionary.common.documentDateTo}</Label>
              <Input id="to" name="to" type="date" defaultValue={filters.to} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sort">{dictionary.common.sort}</Label>
              <select
                id="sort"
                name="sort"
                defaultValue={filters.sort}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="pr_desc">{dictionary.sortOptions.pr_desc}</option>
                <option value="pr_asc">{dictionary.sortOptions.pr_asc}</option>
                <option value="updated_desc">{dictionary.sortOptions.updated_desc}</option>
                <option value="status_asc">{dictionary.sortOptions.status_asc}</option>
              </select>
            </div>

            <div className="flex items-end gap-4">
              <Button type="submit" className="w-full rounded-xl">
                {dictionary.common.search}
              </Button>
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
                <Button asChild variant="outline" className="w-full rounded-xl sm:w-auto">
                  <Link href="/purchase-requests">
                    {dictionary.purchaseRequests.clearFilters}
                  </Link>
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <PurchaseRequestList
        currentUserId={session.id}
        currentUserRole={session.role}
        initialItems={initialPage.items}
        initialHasMore={initialPage.hasMore}
        initialNextPage={initialPage.nextPage}
        queryString={filterQueryString}
      />
    </div>
  );
}
