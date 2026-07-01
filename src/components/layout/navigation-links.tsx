"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/components/i18n/i18n-provider";
import { navigationItems } from "@/lib/constants";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavigationLinksProps = {
  sessionRole: Role;
  vertical?: boolean;
  onNavigate?: () => void;
};

export function NavigationLinks({
  sessionRole,
  vertical = false,
  onNavigate,
}: NavigationLinksProps) {
  const pathname = usePathname();
  const { dictionary } = useI18n();

  return (
    <nav
      className={cn(
        "flex gap-2",
        vertical ? "flex-col items-stretch" : "flex-wrap items-center",
      )}
    >
      {navigationItems.map((item) => {
        const allowedRoles =
          "roles" in item ? (item.roles as readonly Role[]) : null;

        if (allowedRoles && !allowedRoles.includes(sessionRole)) {
          return null;
        }

        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              vertical && "justify-start rounded-2xl px-4 py-3",
            )}
          >
            {dictionary.navigation[item.labelKey]}
          </Link>
        );
      })}
    </nav>
  );
}
