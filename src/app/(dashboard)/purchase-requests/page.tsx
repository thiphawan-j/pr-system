import Link from "@/components/loading/navigation-link";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";

import { NavigationForm, NavigationSubmitButton } from "@/components/loading/navigation-form";
import { PurchaseRequestList } from "@/components/purchase-requests/purchase-request-list";
import { PurchaseRequestStatusFilter } from "@/components/purchase-requests/purchase-request-status-filter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { departments, purchaseRequestListPageSize } from "@/lib/constants";
import { getDepartmentLabel } from "@/lib/i18n";
import { priorities } from "@/lib/types";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary, getCurrentLocale } from "@/server/i18n";
import {
  purchaseRequestListFiltersSchema,
  purchaseRequestPaginationSchema,
} from "@/server/purchase-requests/purchase-request.schemas";
import { listPurchaseRequestsPage } from "@/server/purchase-requests/purchase-request.service";

function firstOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function toFilterQueryString(filters: ReturnType<typeof purchaseRequestListFiltersSchema.parse>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
    } else if (value) {
      params.append(key, value);
    }
  }

  return params.toString();
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
  const filters = purchaseRequestListFiltersSchema.parse({
    query: firstOf(rawSearchParams.query),
    status: rawSearchParams.status,
    urgency: firstOf(rawSearchParams.urgency),
    preset: firstOf(rawSearchParams.preset),
    department: firstOf(rawSearchParams.department),
    from: firstOf(rawSearchParams.from),
    to: firstOf(rawSearchParams.to),
    sort: firstOf(rawSearchParams.sort),
  });
  const paginationResult = purchaseRequestPaginationSchema.safeParse({
    page: firstOf(rawSearchParams.page),
    limit: purchaseRequestListPageSize,
  });
  const page = paginationResult.success ? paginationResult.data.page : 1;
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
    page,
    limit: purchaseRequestListPageSize,
  });
  const filterQueryString = toFilterQueryString(filters);
  const thai = locale === "th";
  const activeAdvanced = [
    filters.department !== "ALL" ? getDepartmentLabel(filters.department, locale) : null,
    filters.from || filters.to ? `${dictionary.common.documentDateFrom}: ${filters.from || "…"} / ${dictionary.common.documentDateTo}: ${filters.to || "…"}` : null,
    filters.urgency !== "ALL" ? `${dictionary.common.priority}: ${dictionary.priorities[filters.urgency]}` : null,
    filters.sort !== "updated_desc" ? dictionary.sortOptions[filters.sort] : null,
  ].filter((value): value is string => value !== null);
  const hasFilters = Boolean(filters.query || filters.status.length || filters.preset || activeAdvanced.length);

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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{dictionary.purchaseRequests.filtersTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <NavigationForm key={filterQueryString} action="/purchase-requests" className="space-y-3">
            {filters.preset ? (
              <input type="hidden" name="preset" value={filters.preset} />
            ) : null}

            {quickFilterTitle ? (
              <div className="min-w-0">
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

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(11rem,15rem)_auto] lg:items-end">
              <div className="min-w-0 space-y-2 col-span-2 lg:col-span-1">
                <Label htmlFor="query">{dictionary.purchaseRequests.searchLabel}</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="query"
                    name="query"
                    defaultValue={filters.query}
                    className="min-h-11 pl-9"
                    placeholder={dictionary.purchaseRequests.searchPlaceholder}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">{dictionary.common.status}</Label>
                <PurchaseRequestStatusFilter
                  key={filterQueryString}
                  defaultValue={filters.status}
                />
              </div>

              <NavigationSubmitButton className="min-h-11 w-full self-end gap-2 rounded-xl px-4">
                <Search aria-hidden="true" className="size-4" />
                {dictionary.common.search}
              </NavigationSubmitButton>
            </div>

            <details data-testid="pr-advanced-filters" className="group overflow-hidden rounded-xl border border-border/70">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium outline-offset-[-3px] hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {thai ? "ตัวกรองเพิ่มเติม" : "More filters"}
                {activeAdvanced.length > 0 && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-foreground">{activeAdvanced.length}</span>
                )}
                <ChevronDown aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted-foreground group-open:rotate-180" />
              </summary>
              <div className="grid gap-3 border-t border-border/70 bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="min-w-0 space-y-2">
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

                <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:col-span-2">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="from">{dictionary.common.documentDateFrom}</Label>
                    <Input id="from" name="from" type="date" className="min-w-0 w-full" defaultValue={filters.from} />
                  </div>

                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="to">{dictionary.common.documentDateTo}</Label>
                    <Input id="to" name="to" type="date" className="min-w-0 w-full" defaultValue={filters.to} />
                  </div>
                </div>

                <div className="min-w-0 space-y-2">
                  <Label htmlFor="urgency">{dictionary.common.priority}</Label>
                  <select
                    id="urgency"
                    name="urgency"
                    defaultValue={filters.urgency}
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    <option value="ALL">{dictionary.common.all}</option>
                    {priorities.map((priority) => (
                      <option key={priority} value={priority}>
                        {dictionary.priorities[priority]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="min-w-0 space-y-2">
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

                <div className="flex justify-end sm:col-span-2 lg:col-span-5">
                  <NavigationSubmitButton className="min-h-11 w-full rounded-xl sm:w-auto">
                    {thai ? "ใช้ตัวกรอง" : "Apply filters"}
                  </NavigationSubmitButton>
                </div>
              </div>
            </details>
            {hasFilters && (
              <div className="flex flex-wrap items-center gap-2" aria-label={thai ? "ตัวกรองที่ใช้" : "Applied filters"}>
                {activeAdvanced.map((value, index) => (
                  <span key={index} className="max-w-full break-words rounded-lg bg-muted px-2 py-1 text-xs text-foreground">{value}</span>
                ))}
                <Link href="/purchase-requests" className="inline-flex min-h-9 items-center px-2 text-sm font-medium text-primary underline underline-offset-4">
                  {dictionary.purchaseRequests.clearFilters}
                </Link>
              </div>
            )}
          </NavigationForm>
        </CardContent>
      </Card>

      <PurchaseRequestList
        currentUserId={session.id}
        currentUserRole={session.role}
        items={initialPage.items}
        page={initialPage.page}
        totalCount={initialPage.totalCount}
        totalPages={initialPage.totalPages}
        queryString={filterQueryString}
      />
    </div>
  );
}
