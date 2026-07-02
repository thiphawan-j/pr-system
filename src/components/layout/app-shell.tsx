import Link from "next/link";
import { LayoutGrid, PlusCircle } from "lucide-react";

import { LanguageToggle } from "@/components/i18n/language-toggle";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NavigationLinks } from "@/components/layout/navigation-links";
import { NotificationBell } from "@/components/layout/notification-bell";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/format";
import { getDepartmentLabelFromDictionary, type Dictionary } from "@/lib/i18n";
import type { NotificationItem, SessionUser } from "@/lib/types";

type AppShellProps = {
  children: React.ReactNode;
  session: SessionUser;
  notifications: NotificationItem[];
  unreadNotificationCount: number;
  dictionary: Dictionary;
};

export function AppShell({
  children,
  session,
  notifications,
  unreadNotificationCount,
  dictionary,
}: AppShellProps) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <MobileNav session={session} />
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-full px-1 py-1"
            >
              <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                <LayoutGrid className="size-5" />
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold">PR Flow</p>
                <p className="text-xs text-muted-foreground">
                  {dictionary.app.shortDescription}
                </p>
              </div>
            </Link>
          </div>

          <div className="hidden lg:flex">
            <NavigationLinks sessionRole={session.role} />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm" className="hidden rounded-full sm:inline-flex">
              <Link href="/purchase-requests/new">
                <PlusCircle />
                {dictionary.navigation.createPurchaseRequest}
              </Link>
            </Button>
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadNotificationCount}
            />
            <ThemeToggle />
            <LanguageToggle />
            <Link
              href="/profile"
              aria-label={dictionary.navigation.profile}
              title={dictionary.navigation.profile}
              className="hidden items-center gap-3 rounded-full border border-border/70 bg-card px-3 py-1.5 transition-colors hover:bg-muted/40 md:flex"
            >
              <Avatar size="sm">
                <AvatarFallback>{getInitials(session.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="max-w-44 truncate text-sm font-medium">{session.name}</p>
                <p className="text-xs text-muted-foreground">
                  {getDepartmentLabelFromDictionary(session.department, dictionary)} ·{" "}
                  {dictionary.roles[session.role]}
                </p>
              </div>
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
