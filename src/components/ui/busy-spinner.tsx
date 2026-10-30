"use client";

import { LoaderCircle } from "lucide-react";

import { usePendingActivity, type ActivityKind } from "@/components/loading/app-activity";
import { cn } from "@/lib/utils";

export function BusySpinner({
  active = true,
  kind = "process",
  className,
}: {
  active?: boolean;
  kind?: ActivityKind;
  className?: string;
}) {
  usePendingActivity(active, kind);
  return active ? <LoaderCircle data-busy-spinner aria-hidden="true" className={cn("size-4 animate-spin motion-reduce:animate-none", className)} /> : null;
}
