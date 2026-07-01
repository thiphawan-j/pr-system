import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { getShellContext } from "@/server/purchase-requests/purchase-request.service";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession().catch(() => null);

  if (!session) {
    redirect("/login");
  }

  const [shellContext, dictionary] = await Promise.all([
    getShellContext(session),
    getCurrentDictionary(),
  ]);

  return (
    <AppShell
      session={session}
      notifications={shellContext.notifications}
      unreadNotificationCount={shellContext.unreadNotificationCount}
      dictionary={dictionary}
    >
      {children}
    </AppShell>
  );
}
