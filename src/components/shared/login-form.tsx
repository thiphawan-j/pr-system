"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, LockKeyhole, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { translateMessage } from "@/lib/i18n";
import { loginSchema } from "@/server/purchase-requests/purchase-request.schemas";

type LoginFormValues = z.infer<typeof loginSchema>;

const defaultValues: LoginFormValues = {
  identifier: "employee@demo.local",
  password: "Passw0rd!",
};

type LoginFormProps = {
  showDemoAccounts?: boolean;
};

export function LoginForm({ showDemoAccounts = true }: LoginFormProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: showDemoAccounts
      ? defaultValues
      : {
          identifier: "",
          password: "",
        },
  });

  function onSubmit(values: LoginFormValues) {
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      const payload = await response.json().catch(() => null);
      setIsPending(false);

      if (!response.ok) {
        toast.error(
          translateMessage(payload?.error, locale) ?? dictionary.auth.signInError,
        );
        return;
      }

      toast.success(dictionary.auth.signInSuccess);
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <Card className="border-border/70 bg-card/90 shadow-xl shadow-slate-950/10 backdrop-blur">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl">{dictionary.auth.loginTitle}</CardTitle>
        <CardDescription>
          {showDemoAccounts
            ? dictionary.auth.loginDescription
            : dictionary.auth.loginDescriptionProduction}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="identifier">{dictionary.auth.loginId}</Label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="identifier"
                type="text"
                autoComplete="username"
                className="pl-9"
                placeholder={dictionary.auth.loginIdPlaceholder}
                {...form.register("identifier")}
              />
            </div>
            {form.formState.errors.identifier ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.identifier.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{dictionary.auth.password}</Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              leadingIcon={<LockKeyhole className="size-4" />}
              showPasswordLabel={dictionary.common.showPassword}
              hidePasswordLabel={dictionary.common.hidePassword}
              {...form.register("password")}
            />
            {form.formState.errors.password ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.password.message, locale)}
              </p>
            ) : null}
          </div>

          <Button type="submit" className="w-full rounded-xl py-6" disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" /> : null}
            {isPending ? dictionary.auth.signingIn : dictionary.auth.signIn}
          </Button>
        </form>

        {showDemoAccounts ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border/80 bg-muted/40 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{dictionary.auth.demoAccounts}</p>
            <p>`employee@demo.local` | `somchai` | `0811111111` / `Passw0rd!`</p>
            <p>`approver@demo.local` | `wipa` | `0811111112` / `Passw0rd!`</p>
            <p>`purchasing@demo.local` | `kitti` | `0811111113` / `Passw0rd!`</p>
            <p>`admin@demo.local` | `admin` | `0811111114` / `Passw0rd!`</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
