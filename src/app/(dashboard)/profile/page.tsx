import { UserRound } from "lucide-react";

import { ChangePasswordForm } from "@/components/profile/change-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDepartmentLabelFromDictionary } from "@/lib/i18n";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";
import { findUserById } from "@/server/users/user.service";

export default async function ProfilePage() {
  const [session, dictionary] = await Promise.all([
    requireSession(),
    getCurrentDictionary(),
  ]);
  const user = (await findUserById(session.id)) ?? session;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-border/70 bg-card/80 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="flex w-fit items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              <UserRound className="size-4" />
              {dictionary.navigation.profile}
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {dictionary.profile.title}
              </h1>
              <p className="max-w-2xl text-muted-foreground">
                {dictionary.profile.description}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="w-fit rounded-full px-3 py-1.5 text-sm">
            {dictionary.roles[user.role]}
          </Badge>
        </div>
      </section>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>{dictionary.profile.accountTitle}</CardTitle>
          <CardDescription>
            {dictionary.profile.accountDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">{dictionary.admin.name}</p>
            <p className="font-medium">{user.name}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{dictionary.admin.employeeCode}</p>
            <p className="font-medium">{user.employeeCode}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{dictionary.profile.username}</p>
            <p className="font-medium">{user.username ?? "-"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{dictionary.profile.phone}</p>
            <p className="font-medium">{user.phone ?? "-"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{dictionary.auth.email}</p>
            <p className="font-medium">{user.email}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{dictionary.common.department}</p>
            <p className="font-medium">
              {getDepartmentLabelFromDictionary(user.department, dictionary)}
            </p>
          </div>
          <div className="sm:col-span-2 xl:col-span-3">
            <p className="text-sm text-muted-foreground">{dictionary.admin.title}</p>
            <p className="font-medium">{user.title ?? "-"}</p>
          </div>
        </CardContent>
      </Card>

      <ChangePasswordForm />
    </div>
  );
}
