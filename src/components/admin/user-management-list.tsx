"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  FilePenLine,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { departments } from "@/lib/constants";
import { getInitials } from "@/lib/format";
import {
  getDepartmentLabel,
  translateMessage,
} from "@/lib/i18n";
import { roles, type AdminUserItem } from "@/lib/types";
import {
  adminResetPasswordSchema,
  updateUserSchema,
} from "@/server/users/user.schemas";

type UserManagementListProps = {
  currentUserId: string;
  users: AdminUserItem[];
};

type UpdateUserFormValues = z.input<typeof updateUserSchema>;
type UpdateUserPayload = z.output<typeof updateUserSchema>;
type ResetPasswordFormValues = z.input<typeof adminResetPasswordSchema>;
type ResetPasswordPayload = z.output<typeof adminResetPasswordSchema>;

function getStatusBadgeClassName(isActive: boolean) {
  return isActive
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : "border-border/70 bg-muted text-muted-foreground";
}

function toUpdateUserValues(user: AdminUserItem): UpdateUserFormValues {
  return {
    employeeCode: user.employeeCode,
    name: user.name,
    username: user.username ?? "",
    phone: user.phone ?? "",
    email: user.email,
    department: user.department as UpdateUserFormValues["department"],
    role: user.role,
    title: user.title ?? "",
  };
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  const { dictionary } = useI18n();

  return (
    <Badge variant="outline" className={getStatusBadgeClassName(isActive)}>
      {isActive ? dictionary.admin.active : dictionary.admin.inactive}
    </Badge>
  );
}

function EditUserDialog({
  user,
  onOpenChange,
}: {
  user: AdminUserItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();
  const form = useForm<UpdateUserFormValues, undefined, UpdateUserPayload>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: user ? toUpdateUserValues(user) : undefined,
  });
  const selectedDepartment = useWatch({
    control: form.control,
    name: "department",
  });
  const selectedRole = useWatch({
    control: form.control,
    name: "role",
  });

  useEffect(() => {
    if (user) {
      form.reset(toUpdateUserValues(user));
    }
  }, [form, user]);

  if (!user) {
    return null;
  }

  const userId = user.id;

  function closeDialog() {
    onOpenChange(false);
  }

  function onSubmit(values: UpdateUserPayload) {
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });
      const payload = await response.json().catch(() => null);

      setIsPending(false);

      if (!response.ok) {
        toast.error(
          translateMessage(payload?.error, locale) ?? dictionary.admin.updateError,
        );
        return;
      }

      toast.success(dictionary.admin.updateSuccess);
      closeDialog();
      router.refresh();
    });
  }

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{dictionary.admin.editUserTitle}</DialogTitle>
          <DialogDescription>
            {dictionary.admin.editUserDescription}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="edit-employeeCode">{dictionary.admin.employeeCode}</Label>
            <Input id="edit-employeeCode" {...form.register("employeeCode")} />
            {form.formState.errors.employeeCode ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.employeeCode.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-name">{dictionary.admin.name}</Label>
            <Input id="edit-name" {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.name.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-username">{dictionary.admin.username}</Label>
            <Input id="edit-username" {...form.register("username")} />
            {form.formState.errors.username ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.username.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-phone">{dictionary.admin.phone}</Label>
            <Input id="edit-phone" {...form.register("phone")} />
            {form.formState.errors.phone ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.phone.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-email">{dictionary.auth.email}</Label>
            <Input id="edit-email" type="email" {...form.register("email")} />
            {form.formState.errors.email ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.email.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>{dictionary.common.department}</Label>
            <Select
              value={selectedDepartment}
              onValueChange={(value) =>
                form.setValue(
                  "department",
                  value as UpdateUserFormValues["department"],
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
                form.setValue("role", value as UpdateUserFormValues["role"], {
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
            <Label htmlFor="edit-title">{dictionary.admin.title}</Label>
            <Input
              id="edit-title"
              placeholder={dictionary.admin.titlePlaceholder}
              {...form.register("title")}
            />
          </div>

          <DialogFooter className="md:col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={isPending}
            >
              {dictionary.common.cancel}
            </Button>
            <Button type="submit" disabled={isPending}>
              <FilePenLine />
              {isPending ? dictionary.admin.updatingUser : dictionary.admin.updateUser}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: AdminUserItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();
  const form = useForm<
    ResetPasswordFormValues,
    undefined,
    ResetPasswordPayload
  >({
    resolver: zodResolver(adminResetPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (user) {
      form.reset({
        newPassword: "",
        confirmPassword: "",
      });
    }
  }, [form, user]);

  if (!user) {
    return null;
  }

  const userId = user.id;

  function closeDialog() {
    onOpenChange(false);
  }

  function onSubmit(values: ResetPasswordPayload) {
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
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
            dictionary.admin.resetPasswordError,
        );
        return;
      }

      toast.success(dictionary.admin.resetPasswordSuccess);
      closeDialog();
      router.refresh();
    });
  }

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dictionary.admin.resetPasswordTitle}</DialogTitle>
          <DialogDescription>
            {dictionary.admin.resetPasswordDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm">
          <p className="font-medium">{user.name}</p>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="reset-newPassword">{dictionary.profile.newPassword}</Label>
            <Input
              id="reset-newPassword"
              type="password"
              autoComplete="new-password"
              {...form.register("newPassword")}
            />
            {form.formState.errors.newPassword ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.newPassword.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reset-confirmPassword">
              {dictionary.profile.confirmPassword}
            </Label>
            <Input
              id="reset-confirmPassword"
              type="password"
              autoComplete="new-password"
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={isPending}
            >
              {dictionary.common.cancel}
            </Button>
            <Button type="submit" disabled={isPending}>
              <KeyRound />
              {isPending
                ? dictionary.admin.resettingPassword
                : dictionary.admin.resetPassword}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleUserStatusDialog({
  currentUserId,
  user,
  onOpenChange,
}: {
  currentUserId: string;
  user: AdminUserItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const { dictionary, locale } = useI18n();

  if (!user) {
    return null;
  }

  const userId = user.id;
  const nextIsActive = !user.isActive;

  function closeDialog() {
    onOpenChange(false);
  }

  function handleSubmit() {
    setIsPending(true);
    startTransition(async () => {
      const response = await fetch(`/api/admin/users/${userId}/activation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isActive: nextIsActive }),
      });
      const payload = await response.json().catch(() => null);

      setIsPending(false);

      if (!response.ok) {
        toast.error(
          translateMessage(payload?.error, locale) ??
            dictionary.admin.toggleStatusError,
        );
        return;
      }

      toast.success(
        nextIsActive
          ? dictionary.admin.activateSuccess
          : dictionary.admin.deactivateSuccess,
      );
      closeDialog();
      router.refresh();
    });
  }

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {nextIsActive
              ? dictionary.admin.activateUserTitle
              : dictionary.admin.deactivateUserTitle}
          </DialogTitle>
          <DialogDescription>
            {nextIsActive
              ? dictionary.admin.activateUserDescription
              : dictionary.admin.deactivateUserDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm">
          <p className="font-medium">{user.name}</p>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={closeDialog}
            disabled={isPending}
          >
            {dictionary.common.cancel}
          </Button>
          <Button
            type="button"
            variant={nextIsActive ? "default" : "destructive"}
            onClick={handleSubmit}
            disabled={isPending || (user.id === currentUserId && !nextIsActive)}
          >
            {nextIsActive ? <UserCheck /> : <UserX />}
            {nextIsActive
              ? dictionary.admin.activateUser
              : dictionary.admin.deactivateUser}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserManagementList({
  currentUserId,
  users,
}: UserManagementListProps) {
  const { dictionary, locale } = useI18n();
  const [editingUser, setEditingUser] = useState<AdminUserItem | null>(null);
  const [resettingUser, setResettingUser] = useState<AdminUserItem | null>(null);
  const [togglingUser, setTogglingUser] = useState<AdminUserItem | null>(null);

  function renderActionButtons(user: AdminUserItem, compact = false) {
    return (
      <div className={`flex flex-wrap gap-2 ${compact ? "" : "justify-end"}`}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditingUser(user)}
        >
          <FilePenLine />
          {dictionary.admin.editUser}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setResettingUser(user)}
        >
          <KeyRound />
          {dictionary.admin.resetPassword}
        </Button>
        <Button
          type="button"
          variant={user.isActive ? "destructive" : "secondary"}
          size="sm"
          onClick={() => setTogglingUser(user)}
          disabled={user.id === currentUserId && user.isActive}
        >
          {user.isActive ? <ShieldOff /> : <ShieldCheck />}
          {user.isActive
            ? dictionary.admin.deactivateUser
            : dictionary.admin.activateUser}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 md:hidden">
        {users.map((user) => (
          <div
            key={user.id}
            className={`rounded-2xl border border-border/70 p-4 ${
              user.isActive ? "" : "opacity-75"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-sm font-semibold">
                {getInitials(user.name)}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{user.name}</p>
                  <Badge variant="outline">{dictionary.roles[user.role]}</Badge>
                  <StatusBadge isActive={user.isActive} />
                </div>
                <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                <p className="text-sm text-muted-foreground">
                  {user.employeeCode} · {getDepartmentLabel(user.department, locale)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {user.username ?? "-"} · {user.phone ?? "-"}
                </p>
                {user.title ? (
                  <p className="text-sm text-muted-foreground">{user.title}</p>
                ) : null}
                {renderActionButtons(user, true)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{dictionary.admin.employeeCode}</TableHead>
              <TableHead>{dictionary.admin.name}</TableHead>
              <TableHead>{dictionary.admin.username}</TableHead>
              <TableHead>{dictionary.admin.phone}</TableHead>
              <TableHead>{dictionary.auth.email}</TableHead>
              <TableHead>{dictionary.common.department}</TableHead>
              <TableHead>{dictionary.admin.role}</TableHead>
              <TableHead>{dictionary.admin.accountStatus}</TableHead>
              <TableHead>{dictionary.admin.title}</TableHead>
              <TableHead className="text-right">{dictionary.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} className={user.isActive ? "" : "opacity-75"}>
                <TableCell className="font-mono text-xs">
                  {user.employeeCode}
                </TableCell>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  {user.username ?? "-"}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {user.phone ?? "-"}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{getDepartmentLabel(user.department, locale)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{dictionary.roles[user.role]}</Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge isActive={user.isActive} />
                </TableCell>
                <TableCell>{user.title ?? "-"}</TableCell>
                <TableCell className="text-right">
                  {renderActionButtons(user)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EditUserDialog
        user={editingUser}
        onOpenChange={(open) => {
          if (!open) {
            setEditingUser(null);
          }
        }}
      />
      <ResetPasswordDialog
        user={resettingUser}
        onOpenChange={(open) => {
          if (!open) {
            setResettingUser(null);
          }
        }}
      />
      <ToggleUserStatusDialog
        currentUserId={currentUserId}
        user={togglingUser}
        onOpenChange={(open) => {
          if (!open) {
            setTogglingUser(null);
          }
        }}
      />
    </>
  );
}
