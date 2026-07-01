import Link from "next/link";
import { CheckCircle2, Clock3, ReceiptText, XCircle } from "lucide-react";

import { MonthlySpendChart } from "@/components/dashboard/monthly-spend-chart";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/format";
import { interpolate } from "@/lib/i18n";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary, getCurrentLocale } from "@/server/i18n";
import {
  getDashboardSummary,
  listPurchaseRequests,
} from "@/server/purchase-requests/purchase-request.service";

export default async function DashboardPage() {
  const session = await requireSession();
  const [summary, pendingRequests, locale, dictionary] = await Promise.all([
    getDashboardSummary(session),
    listPurchaseRequests(session, {
      status: "PENDING_APPROVAL",
      sort: "newest",
    }),
    getCurrentLocale(),
    getCurrentDictionary(),
  ]);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-[2rem] border border-border/70 bg-card/80 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary">
              {dictionary.dashboard.eyebrow}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {interpolate(dictionary.dashboard.greeting, { name: session.name })}
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              {interpolate(dictionary.dashboard.description, {
                role: dictionary.roles[session.role],
              })}
            </p>
          </div>
          <Button asChild className="rounded-xl">
            <Link href="/purchase-requests/new">
              <ReceiptText />
              {dictionary.dashboard.createButton}
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title={dictionary.dashboard.pendingTitle}
          value={formatNumber(summary.pendingCount, locale)}
          subtitle={dictionary.dashboard.pendingSubtitle}
          accentClassName="from-amber-500/25 via-amber-300/10 to-transparent"
        />
        <SummaryCard
          title={dictionary.dashboard.approvedTitle}
          value={formatNumber(summary.approvedCount, locale)}
          subtitle={dictionary.dashboard.approvedSubtitle}
          accentClassName="from-emerald-500/25 via-emerald-300/10 to-transparent"
        />
        <SummaryCard
          title={dictionary.dashboard.rejectedTitle}
          value={formatNumber(summary.rejectedCount, locale)}
          subtitle={dictionary.dashboard.rejectedSubtitle}
          accentClassName="from-rose-500/25 via-rose-300/10 to-transparent"
        />
        <SummaryCard
          title={dictionary.dashboard.totalTitle}
          value={formatCurrency(summary.totalAmount, locale)}
          subtitle={dictionary.dashboard.totalSubtitle}
          accentClassName="from-cyan-500/25 via-cyan-300/10 to-transparent"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <MonthlySpendChart data={summary.monthlyChart} />

        <Card className="border-border/70">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{dictionary.dashboard.urgentTitle}</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/purchase-requests">{dictionary.dashboard.viewAll}</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingRequests.slice(0, 5).length ? (
              pendingRequests.slice(0, 5).map((request) => (
                <Link
                  key={request.id}
                  href={`/purchase-requests/${request.id}`}
                  className="block rounded-2xl border border-border/70 p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{request.prNumber}</p>
                      <p className="text-sm text-muted-foreground">
                        {request.requesterName}
                      </p>
                    </div>
                    <Clock3 className="size-4 text-amber-400" />
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {request.reason}
                  </p>
                </Link>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
                {dictionary.dashboard.emptyPending}
              </div>
            )}

            <div className="grid gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4 sm:grid-cols-3">
              <div className="flex items-center gap-3">
                <Clock3 className="size-4 text-amber-500" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    {dictionary.statuses.PENDING_APPROVAL}
                  </p>
                  <p className="font-semibold">
                    {formatNumber(summary.pendingCount, locale)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-4 text-emerald-500" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    {dictionary.statuses.APPROVED}
                  </p>
                  <p className="font-semibold">
                    {formatNumber(summary.approvedCount, locale)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <XCircle className="size-4 text-rose-500" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    {dictionary.statuses.REJECTED}
                  </p>
                  <p className="font-semibold">
                    {formatNumber(summary.rejectedCount, locale)}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
