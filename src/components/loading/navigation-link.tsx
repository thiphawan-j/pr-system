"use client";

import NextLink, { useLinkStatus } from "next/link";
import { forwardRef, type ComponentProps } from "react";

import { usePendingActivity } from "@/components/loading/app-activity";

function LinkActivity() {
  const { pending } = useLinkStatus();
  usePendingActivity(pending, "navigation");
  return null;
}

const NavigationLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(
  function NavigationLink({ children, ...props }, ref) {
    return <NextLink {...props} ref={ref}>{children}<LinkActivity /></NextLink>;
  },
);

export default NavigationLink;
