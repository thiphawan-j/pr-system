"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2 } from "lucide-react";
import { startTransition, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { translateMessage } from "@/lib/i18n";
import { changePasswordSchema } from "@/server/users/user.schemas";

type ChangePasswordFormValues = z.input<typeof changePasswordSchema>;
type ChangePasswordPayload = z.output<typeof changePasswordSchema>;

const defaultValues: ChangePasswordFormValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export function ChangePasswordForm() {
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();
  const form = useForm<
    ChangePasswordFormValues,
    undefined,
    ChangePasswordPayload
  >({
    resolver: zodResolver(changePasswordSchema),
    defaultValues,
  });

  function onSubmit(values: ChangePasswordPayload) {
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch("/api/users/me/password", {
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
          translateMessage(payload?.error, locale) ??
            dictionary.profile.changePasswordError,
        );
        return;
      }

      toast.success(dictionary.profile.changePasswordSuccess);
      form.reset(defaultValues);
    });
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <KeyRound className="size-5" />
          </div>
          <div>
            <CardTitle>{dictionary.profile.passwordTitle}</CardTitle>
            <CardDescription>
              {dictionary.profile.passwordDescription}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="currentPassword">
              {dictionary.profile.currentPassword}
            </Label>
            <PasswordInput
              id="currentPassword"
              autoComplete="current-password"
              showPasswordLabel={dictionary.common.showPassword}
              hidePasswordLabel={dictionary.common.hidePassword}
              {...form.register("currentPassword")}
            />
            {form.formState.errors.currentPassword ? (
              <p className="text-xs text-destructive">
                {translateMessage(
                  form.formState.errors.currentPassword.message,
                  locale,
                )}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">{dictionary.profile.newPassword}</Label>
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              placeholder={dictionary.admin.passwordHint}
              showPasswordLabel={dictionary.common.showPassword}
              hidePasswordLabel={dictionary.common.hidePassword}
              {...form.register("newPassword")}
            />
            {form.formState.errors.newPassword ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.newPassword.message, locale)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {dictionary.admin.passwordHint}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">
              {dictionary.profile.confirmPassword}
            </Label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              showPasswordLabel={dictionary.common.showPassword}
              hidePasswordLabel={dictionary.common.hidePassword}
              {...form.register("confirmPassword")}
            />
            {form.formState.errors.confirmPassword ? (
              <p className="text-xs text-destructive">
                {translateMessage(
                  form.formState.errors.confirmPassword.message,
                  locale,
                )}
              </p>
            ) : null}
          </div>

          <div className="md:col-span-2">
            <Button
              type="submit"
              disabled={isPending}
              className="w-full rounded-xl sm:w-auto"
            >
              {isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {isPending
                ? dictionary.profile.changingPassword
                : dictionary.profile.changePassword}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
