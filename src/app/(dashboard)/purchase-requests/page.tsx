import { Search } from "lucide-react";

import { PurchaseRequestList } from "@/components/purchase-requests/purchase-request-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { departments } from "@/lib/constants";
import { purchaseRequestStatuses } from "@/lib/types";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary, getCurrentLocale } from "@/server/i18n";
import { purchaseRequestFiltersSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { listPurchaseRequests } from "@/server/purchase-requests/purchase-request.service";

function firstOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
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
    department: firstOf(rawSearchParams.department),
    from: firstOf(rawSearchParams.from),
    to: firstOf(rawSearchParams.to),
    sort: firstOf(rawSearchParams.sort),
  });

  const requests = await listPurchaseRequests(session, filters);

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
                {purchaseRequestStatuses.map((status) => (
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
                    {department}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="from">{dictionary.common.fromDate}</Label>
              <Input id="from" name="from" type="date" defaultValue={filters.from} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="to">{dictionary.common.toDate}</Label>
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
                <option value="newest">{dictionary.sortOptions.newest}</option>
                <option value="oldest">{dictionary.sortOptions.oldest}</option>
                <option value="amount_desc">{dictionary.sortOptions.amount_desc}</option>
                <option value="amount_asc">{dictionary.sortOptions.amount_asc}</option>
              </select>
            </div>

            <div className="flex items-end">
              <Button type="submit" className="w-full rounded-xl">
                {dictionary.common.search}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <PurchaseRequestList requests={requests} session={session} locale={locale} />
    </div>
  );
}
