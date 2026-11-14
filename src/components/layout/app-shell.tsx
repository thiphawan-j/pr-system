import Link from "@/components/loading/navigation-link";
import { LayoutGrid } from "lucide-react";

import { LanguageToggle } from "@/components/i18n/language-toggle";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NavigationLinks } from "@/components/layout/navigation-links";
import { NotificationBell } from "@/components/layout/notification-bell";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

export function AppShell({ children, session, notifications, unreadNotificationCount, dictionary }: AppShellProps) {
  const brand = (
    <Link href="/dashboard" className="flex shrink-0 items-center gap-3 rounded-xl px-1 py-1" aria-label={dictionary.navigation.dashboard}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <LayoutGrid className="size-5" aria-hidden="true" />
      </div>
      <div className="hidden sm:block">
        <p className="text-sm font-semibold">TangThong <span className="font-normal text-muted-foreground">PR</span></p>
        <p className="text-xs text-muted-foreground">{dictionary.app.shortDescription}</p>
      </div>
    </Link>
  );

  return (
    <div className="min-h-screen lg:pl-64 print:pl-0">
      <a href="#main-content" className="sr-only fixed top-3 left-3 z-50 rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only">{dictionary.navigation.skipToContent}</a>
      <aside data-desktop-navigation className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex print:hidden">
        <div className="px-5 py-6">{brand}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <NavigationLinks sessionRole={session.role} />
        </div>
        <div className="border-t border-sidebar-border px-6 py-4 text-xs text-muted-foreground">{dictionary.roles[session.role]}</div>
      </aside>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-card/95 backdrop-blur print:hidden">
        <div className="mx-auto flex min-h-16 w-full max-w-[1600px] items-center gap-2 px-3 py-3 sm:px-6 lg:px-8">
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            <MobileNav session={session} />
            {brand}
          </div>
          <p className="hidden text-sm font-medium text-muted-foreground lg:block">{dictionary.app.shortDescription}</p>
          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            <NotificationBell notifications={notifications} unreadCount={unreadNotificationCount} />
            <ThemeToggle />
            <LanguageToggle />
            <Link href="/profile" aria-label={dictionary.navigation.profile} title={dictionary.navigation.profile}
              className="flex shrink-0 items-center gap-2 rounded-full border border-border/70 bg-card p-1 transition-colors hover:bg-muted/40 xl:px-3 xl:py-1.5">
              <Avatar size="sm"><AvatarFallback>{getInitials(session.name)}</AvatarFallback></Avatar>
              <div className="hidden min-w-0 xl:block">
                <p className="max-w-40 truncate text-xs font-medium">{session.name}</p>
                <p className="max-w-40 truncate text-xs text-muted-foreground">{getDepartmentLabelFromDictionary(session.department, dictionary)} · {dictionary.roles[session.role]}</p>
              </div>
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-6 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8 print:p-0">
        {children}
      </main>
    </div>
  );
}
