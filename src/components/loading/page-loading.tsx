"use client";

import { LoaderCircle } from "lucide-react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { usePendingActivity } from "@/components/loading/app-activity";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading() {
  const { dictionary } = useI18n();
  usePendingActivity(true, "navigation");

  return <section className="space-y-6" aria-busy="true">
    <div role="status" aria-live="polite" className="flex items-center gap-2.5 py-2 text-sm font-medium text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-primary motion-reduce:animate-none" />
      {dictionary.common.loadingPage}
    </div>
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-3"><Skeleton className="h-8 w-56 max-w-full" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <Card><CardContent className="grid gap-4 py-6 sm:grid-cols-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></CardContent></Card>
      <Card><CardContent className="space-y-4 py-6">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</CardContent></Card>
    </div>
  </section>;
}
