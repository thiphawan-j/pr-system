"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollArea } from "radix-ui";
import { useEffect, useRef } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { navigationItems } from "@/lib/constants";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavigationLinksProps = {
  sessionRole: Role;
  vertical?: boolean;
  onNavigate?: () => void;
};

function matchesPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavigationLinks({
  sessionRole,
  vertical = false,
  onNavigate,
}: NavigationLinksProps) {
  const pathname = usePathname();
  const { dictionary, locale } = useI18n();
  const navigationRef = useRef<HTMLDivElement>(null);
  const visibleItems = navigationItems.filter((item) => {
    const allowedRoles =
      "roles" in item ? (item.roles as readonly Role[]) : null;

    return !allowedRoles || allowedRoles.includes(sessionRole);
  });
  const activeHref =
    visibleItems
      .filter((item) => matchesPath(pathname, item.href))
      .sort((left, right) => right.href.length - left.href.length)[0]?.href ?? null;

  useEffect(() => {
    const navigation = navigationRef.current;
    if (vertical || !navigation) return;

    function revealActiveLink() {
      if (!navigation || navigation.clientWidth === 0) return;
      const activeLink = navigation.querySelector<HTMLElement>('[aria-current="page"]');
      if (!activeLink) return;
      const bounds = navigation.getBoundingClientRect();
      const activeBounds = activeLink.getBoundingClientRect();
      if (activeBounds.left < bounds.left + 4) {
        navigation.scrollBy({ left: activeBounds.left - bounds.left - 4 });
      } else if (activeBounds.right > bounds.right - 4) {
        navigation.scrollBy({ left: activeBounds.right - bounds.right + 4 });
      }
    }

    revealActiveLink();
    const observer = new ResizeObserver(revealActiveLink);
    observer.observe(navigation);
    return () => observer.disconnect();
  }, [activeHref, vertical, locale]);

  const links = visibleItems.map((item) => {
    const isActive = activeHref === item.href;

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
          vertical && "justify-start rounded-2xl px-4 py-3",
          !vertical && "whitespace-nowrap",
        )}
      >
        {dictionary.navigation[item.labelKey]}
      </Link>
    );
  });

  if (vertical) {
    return <nav aria-label={dictionary.navigation.mainMenu} className="flex flex-col items-stretch gap-2">{links}</nav>;
  }

  return (
    <ScrollArea.Root type="always" className="w-full min-w-0">
      <ScrollArea.Viewport
        ref={navigationRef}
        role="navigation"
        aria-label={dictionary.navigation.mainMenu}
        tabIndex={0}
        className="main-navigation w-full overscroll-x-contain rounded-xl pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <div className="flex w-max min-w-full flex-nowrap items-center gap-2 p-1">{links}</div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="horizontal" className="flex h-1.5 flex-col touch-none select-none rounded-full bg-muted">
        <ScrollArea.Thumb className="flex-1 rounded-full bg-muted-foreground/50 hover:bg-muted-foreground/70" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
