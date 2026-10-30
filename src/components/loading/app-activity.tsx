"use client";

import { LoaderCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";

export type ActivityKind = "navigation" | "process" | "download";

type ActivityContextValue = { begin: (kind: ActivityKind) => () => void };
const idleActivity: ActivityContextValue = { begin: () => () => undefined };
const ActivityContext = createContext<ActivityContextValue>(idleActivity);

export function AppActivityProvider({ children }: { children: React.ReactNode }) {
  const activities = useRef(new Map<symbol, ActivityKind>());
  const [currentKind, setCurrentKind] = useState<ActivityKind | null>(null);
  const { dictionary } = useI18n();

  const publish = useCallback(() => {
    const kinds = [...activities.current.values()];
    setCurrentKind(kinds.includes("process") ? "process" : kinds.includes("download") ? "download" : kinds.length ? "navigation" : null);
  }, []);

  const begin = useCallback((kind: ActivityKind) => {
    const token = Symbol(kind);
    activities.current.set(token, kind);
    publish();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      activities.current.delete(token);
      publish();
    };
  }, [publish]);
  const value = useMemo(() => ({ begin }), [begin]);
  const label = currentKind === "process" ? dictionary.common.processing
    : currentKind === "download" ? dictionary.common.preparingFile : dictionary.common.loadingPage;

  return <ActivityContext.Provider value={value}>
    {children}
    {currentKind ? <>
      <div data-app-activity="progress" className="app-activity-feedback pointer-events-none fixed inset-x-0 top-0 z-[80] h-1 overflow-hidden bg-primary/10" aria-hidden="true">
        <div className="app-activity-progress h-full w-1/3 rounded-full bg-primary" />
      </div>
      <div data-app-activity="status" data-activity-kind={currentKind} role="status" aria-live="polite" aria-atomic="true"
        className="app-activity-feedback pointer-events-none fixed right-4 bottom-4 z-[80] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-primary/20 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg backdrop-blur sm:right-6 sm:bottom-6">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </> : null}
  </ActivityContext.Provider>;
}

export function useAppActivity() {
  return useContext(ActivityContext);
}

/** Each mounted pending operation owns a token, including concurrent requests. */
export function usePendingActivity(pending: boolean, kind: ActivityKind = "process") {
  const { begin } = useAppActivity();
  useEffect(() => {
    if (!pending) return;
    return begin(kind);
  }, [begin, kind, pending]);
}
