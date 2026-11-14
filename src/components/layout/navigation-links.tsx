"use client";

import Link from "@/components/loading/navigation-link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, ClipboardList, FilePlus2, LayoutDashboard, ShoppingCart, Truck, Users } from "lucide-react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { navigationItems } from "@/lib/constants";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const groups = [
  { label: "requestsGroup", paths: ["/dashboard", "/purchase-requests", "/purchase-requests/new", "/reports"] },
  { label: "purchasingGroup", paths: ["/purchase-orders/new", "/suppliers"] },
  { label: "administrationGroup", paths: ["/admin/users", "/admin/company"] },
] as const;
const icons = { dashboard: LayoutDashboard, purchaseRequests: ClipboardList, createPurchaseRequest: FilePlus2, reports: BarChart3, createPurchaseOrders: ShoppingCart, suppliers: Truck, adminUsers: Users, companySettings: Building2 };

type NavigationLinksProps = {
  sessionRole: Role;
  onNavigate?: () => void;
};

export function NavigationLinks({ sessionRole, onNavigate }: NavigationLinksProps) {
  const pathname = usePathname();
  const { dictionary } = useI18n();
  // Retain the existing role filter and longest-path match. A detail page must
  // not mark both the list and creation links as active.
  const visibleItems = navigationItems.filter((item) => {
    const allowedRoles = "roles" in item ? (item.roles as readonly Role[]) : null;
    return !allowedRoles || allowedRoles.includes(sessionRole);
  });
  const activeHref = visibleItems
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href ?? null;

  return (
    <nav aria-label={dictionary.navigation.mainMenu} className="space-y-6">
      {groups.map((group) => {
        const items = visibleItems.filter((item) => (group.paths as readonly string[]).includes(item.href));
        if (!items.length) return null;
        return (
          <div key={group.label} className="space-y-2">
            <p className="px-3 text-xs font-medium text-muted-foreground">{dictionary.navigation[group.label]}</p>
            <div className="flex flex-col gap-1">
              {items.map((item) => {
                const Icon = icons[item.labelKey];
                const isActive = activeHref === item.href;
                return (
                  <Link key={item.href} href={item.href} onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span>{dictionary.navigation[item.labelKey]}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
