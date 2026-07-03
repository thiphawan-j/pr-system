"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { departments } from "@/lib/constants";
import { roles } from "@/lib/types";
import { getDepartmentLabel, translateMessage } from "@/lib/i18n";
import { createUserSchema } from "@/server/users/user.schemas";

type CreateUserFormValues = z.input<typeof createUserSchema>;
type CreateUserPayload = z.output<typeof createUserSchema>;

const defaultValues = {
  employeeCode: "",
  name: "",
  username: "",
  phone: "",
  email: "",
  password: "",
  department: departments[0],
  role: "EMPLOYEE",
  title: "",
} satisfies CreateUserFormValues;

export function UserCreateForm() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();
  const form = useForm<CreateUserFormValues, undefined, CreateUserPayload>({
    resolver: zodResolver(createUserSchema),
    defaultValues,
  });
  const selectedDepartment = useWatch({
    control: form.control,
    name: "department",
  });
  const selectedRole = useWatch({
    control: form.control,
    name: "role",
  });

  function onSubmit(values: CreateUserPayload) {
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch("/api/admin/users", {
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
          translateMessage(payload?.error, locale) ?? dictionary.admin.createError,
        );
        return;
      }

      toast.success(dictionary.admin.createSuccess);
      form.reset(defaultValues);
      router.refresh();
    });
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <UserPlus className="size-5" />
          </div>
          <div>
            <CardTitle>{dictionary.admin.createUserTitle}</CardTitle>
            <CardDescription>
              {dictionary.admin.createUserDescription}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <div className="space-y-2">
            <Label htmlFor="employeeCode">{dictionary.admin.employeeCode}</Label>
            <Input
              id="employeeCode"
              autoComplete="off"
              placeholder={dictionary.admin.employeeCodePlaceholder}
              {...form.register("employeeCode")}
            />
            {form.formState.errors.employeeCode ? (
              <p className="text-xs text-destructive">
                {translateMessage(
                  form.formState.errors.employeeCode.message,
                  locale,
                )}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{dictionary.admin.name}</Label>
            <Input
              id="name"
              autoComplete="name"
              placeholder={dictionary.admin.namePlaceholder}
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.name.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">{dictionary.admin.username}</Label>
            <Input
              id="username"
              autoComplete="username"
              placeholder={dictionary.admin.usernamePlaceholder}
              {...form.register("username")}
            />
            {form.formState.errors.username ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.username.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">{dictionary.admin.phone}</Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder={dictionary.admin.phonePlaceholder}
              {...form.register("phone")}
            />
            {form.formState.errors.phone ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.phone.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{dictionary.auth.email}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="user@company.com"
              {...form.register("email")}
            />
            {form.formState.errors.email ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.email.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{dictionary.auth.password}</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              placeholder={dictionary.admin.passwordHint}
              showPasswordLabel={dictionary.common.showPassword}
              hidePasswordLabel={dictionary.common.hidePassword}
              {...form.register("password")}
            />
            {form.formState.errors.password ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.password.message, locale)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {dictionary.admin.passwordHint}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{dictionary.common.department}</Label>
            <Select
              value={selectedDepartment}
              onValueChange={(value) =>
                form.setValue(
                  "department",
                  value as CreateUserFormValues["department"],
                  { shouldValidate: true },
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={dictionary.purchaseRequests.departmentPlaceholder}>
                  {getDepartmentLabel(selectedDepartment, locale)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {departments.map((department) => (
                  <SelectItem key={department} value={department}>
                    {getDepartmentLabel(department, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.department ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.department.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>{dictionary.admin.role}</Label>
            <Select
              value={selectedRole}
              onValueChange={(value) =>
                form.setValue("role", value as CreateUserFormValues["role"], {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={dictionary.admin.rolePlaceholder}>
                  {dictionary.roles[selectedRole]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {dictionary.roles[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.role ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.role.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="title">{dictionary.admin.title}</Label>
            <Input
              id="title"
              autoComplete="organization-title"
              placeholder={dictionary.admin.titlePlaceholder}
              {...form.register("title")}
            />
          </div>

          <div className="md:col-span-2">
            <Button
              type="submit"
              disabled={isPending}
              className="w-full rounded-xl sm:w-auto"
            >
              <UserPlus />
              {isPending
                ? dictionary.admin.creatingUser
                : dictionary.admin.createUser}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
