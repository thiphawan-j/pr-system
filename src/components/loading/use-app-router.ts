"use client";

import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";

import { usePendingActivity } from "@/components/loading/app-activity";

/** Use the router's React transition to track completion, including refreshes. */
export function useAppRouter() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  usePendingActivity(isPending, "navigation");

  return useMemo(() => ({
    ...router,
    isPending,
    push: (...args: Parameters<typeof router.push>) => startTransition(() => router.push(...args)),
    replace: (...args: Parameters<typeof router.replace>) => startTransition(() => router.replace(...args)),
    refresh: () => startTransition(() => router.refresh()),
    back: () => startTransition(() => router.back()),
    forward: () => startTransition(() => router.forward()),
  }), [isPending, router, startTransition]);
}
