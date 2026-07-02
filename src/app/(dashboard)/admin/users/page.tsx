import { redirect } from "next/navigation";
import { ShieldCheck, Users } from "lucide-react";

import { UserCreateForm } from "@/components/admin/user-create-form";
import { UserManagementList } from "@/components/admin/user-management-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { interpolate } from "@/lib/i18n";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";
import { listAllUsers } from "@/server/users/user.service";

export default async function AdminUsersPage() {
  const [session, dictionary] = await Promise.all([
    requireSession(),
    getCurrentDictionary(),
  ]);

  if (session.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const users = await listAllUsers();

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-border/70 bg-card/80 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="flex w-fit items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              <ShieldCheck className="size-4" />
              Admin
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {dictionary.admin.usersTitle}
              </h1>
              <p className="max-w-2xl text-muted-foreground">
                {dictionary.admin.usersDescription}
              </p>
            </div>
          </div>
          <div className="rounded-3xl border border-border/70 bg-background/70 px-5 py-4">
            <p className="text-sm text-muted-foreground">
              {dictionary.admin.userListTitle}
            </p>
            <p className="text-2xl font-semibold">
              {interpolate(dictionary.admin.userCount, {
                count: users.length,
              })}
            </p>
          </div>
        </div>
      </section>

      <UserCreateForm />

      <Card className="border-border/70">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Users className="size-5" />
            </div>
            <div>
              <CardTitle>{dictionary.admin.userListTitle}</CardTitle>
              <CardDescription>
                {dictionary.admin.userListDescription}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {users.length ? (
            <UserManagementList currentUserId={session.id} users={users} />
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-muted-foreground">
              {dictionary.admin.emptyUsers}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
