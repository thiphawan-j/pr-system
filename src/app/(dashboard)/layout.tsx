import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { getShellContext } from "@/server/purchase-requests/purchase-request.service";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";
import { getLoginPath, LOGIN_RETURN_PATH_HEADER } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession().catch(() => null);

  if (!session) {
    const requestHeaders = await headers();
    redirect(getLoginPath(requestHeaders.get(LOGIN_RETURN_PATH_HEADER)));
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
