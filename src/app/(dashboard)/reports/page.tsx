import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExportButtons } from "@/components/reports/export-buttons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { departments } from "@/lib/constants";
import { formatCurrency, formatNumber } from "@/lib/format";
import { getDepartmentLabel } from "@/lib/i18n";
import { filterablePurchaseRequestStatuses } from "@/lib/types";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary, getCurrentLocale } from "@/server/i18n";
import { purchaseRequestFiltersSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { getReportSummary } from "@/server/purchase-requests/purchase-request.service";

function firstOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, locale, dictionary] = await Promise.all([
    requireSession(),
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
  const summary = await getReportSummary(session, filters);

  const queryString = new URLSearchParams(
    Object.entries(filters).flatMap(([key, value]) =>
      value && value !== "ALL" ? [[key, value]] : [],
    ),
  ).toString();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {dictionary.reports.title}
          </h1>
          <p className="text-muted-foreground">
            {dictionary.reports.description}
          </p>
        </div>
        <ExportButtons queryString={queryString} dictionary={dictionary} />
      </div>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>{dictionary.reports.filtersTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 lg:grid-cols-5">
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
              <Label htmlFor="from">{dictionary.common.documentDateFrom}</Label>
              <Input id="from" name="from" type="date" defaultValue={filters.from} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">{dictionary.common.documentDateTo}</Label>
              <Input id="to" name="to" type="date" defaultValue={filters.to} />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="h-10 w-full rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                {dictionary.reports.update}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              {dictionary.reports.totalRequests}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {formatNumber(summary.totalRequests, locale)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              {dictionary.reports.totalAmount}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {formatCurrency(summary.totalAmount, locale)}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>{dictionary.reports.byMonth}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.byMonth.map((item) => (
              <div key={item.month} className="flex items-center justify-between rounded-2xl border border-border/70 px-4 py-3">
                <div>
                  <p className="font-medium">{item.month}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatNumber(item.count, locale)} {dictionary.common.itemCount}
                  </p>
                </div>
                <p className="font-semibold">
                  {formatCurrency(item.totalAmount, locale)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>{dictionary.reports.byDepartment}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.byDepartment.map((item) => (
              <div key={item.department} className="flex items-center justify-between rounded-2xl border border-border/70 px-4 py-3">
                <div>
                  <p className="font-medium">
                    {getDepartmentLabel(item.department, locale)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatNumber(item.count, locale)} {dictionary.common.itemCount}
                  </p>
                </div>
                <p className="font-semibold">
                  {formatCurrency(item.totalAmount, locale)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>{dictionary.reports.byRequester}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.byRequester.map((item) => (
              <div key={item.requesterName} className="flex items-center justify-between rounded-2xl border border-border/70 px-4 py-3">
                <div>
                  <p className="font-medium">{item.requesterName}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatNumber(item.count, locale)} {dictionary.common.itemCount}
                  </p>
                </div>
                <p className="font-semibold">
                  {formatCurrency(item.totalAmount, locale)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
