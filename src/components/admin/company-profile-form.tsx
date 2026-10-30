"use client";

import { Building2, Save } from "lucide-react";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { translateMessage } from "@/lib/i18n";
import type { CompanyProfile } from "@/lib/types";
import { updateCompanyProfileSchema } from "@/server/company/company.schemas";

type CompanyField = "name" | "address" | "taxId" | "branch" | "phone" | "email";
type FormValues = Record<CompanyField, string>;

function profileValues(profile: CompanyProfile | null): FormValues {
  return {
    name: profile?.name ?? "",
    address: profile?.address ?? "",
    taxId: profile?.taxId ?? "",
    branch: profile?.branch ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
  };
}

const fields: Array<{ name: CompanyField; id: string; maxLength: number; required?: boolean; type?: string }> = [
  { name: "name", id: "company-name", maxLength: 200, required: true },
  { name: "address", id: "company-address", maxLength: 2000, required: true },
  { name: "taxId", id: "company-tax-id", maxLength: 50 },
  { name: "branch", id: "company-branch", maxLength: 100 },
  { name: "phone", id: "company-phone", maxLength: 100, type: "tel" },
  { name: "email", id: "company-email", maxLength: 254, type: "email" },
];

export function CompanyProfileForm({ profile }: { profile: CompanyProfile | null }) {
  const { dictionary, locale } = useI18n();
  const labels = dictionary.companySettings;
  const [values, setValues] = useState(() => profileValues(profile));
  const [version, setVersion] = useState(profile?.version ?? 0);
  const [savedAt, setSavedAt] = useState(profile?.updatedAt ?? null);
  const [pendingAction, setPendingAction] = useState<"save" | "reload" | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CompanyField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const isPending = pendingAction !== null;
  const pendingRef = useRef(false);

  function applyProfile(next: CompanyProfile | null) {
    setValues(profileValues(next));
    setVersion(next?.version ?? 0);
    setSavedAt(next?.updatedAt ?? null);
    setFieldErrors({});
    setError(null);
    setConflict(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const parsed = updateCompanyProfileSchema.safeParse({ ...values, expectedVersion: version });
    if (!parsed.success) {
      const errors: Partial<Record<CompanyField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in values) {
          errors[field as CompanyField] ??= translateMessage(issue.message, locale) ?? labels.saveError;
        }
      }
      setFieldErrors(errors);
      return;
    }

    pendingRef.current = true;
    setFieldErrors({});
    setError(null);
    setConflict(false);
    setPendingAction("save");
    try {
      const response = await fetch("/api/admin/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setConflict(response.status === 409);
        setError(response.status === 409 ? labels.conflict : translateMessage(payload?.error, locale) ?? labels.saveError);
        return;
      }
      if (!payload || typeof payload.name !== "string") throw new Error("Invalid company response");
      applyProfile(payload as CompanyProfile);
      toast.success(labels.saved);
    } catch {
      setError(labels.saveError);
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }

  async function reload() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingAction("reload");
    try {
      const response = await fetch("/api/admin/company", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error("Unable to load company");
      applyProfile(payload as CompanyProfile | null);
    } catch {
      setError(labels.loadError);
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }

  const placeholders: Partial<Record<CompanyField, string>> = {
    name: labels.namePlaceholder,
    address: labels.addressPlaceholder,
    branch: labels.branchPlaceholder,
  };

  return (
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <Card className="min-w-0 border-border/70">
        <CardHeader className="border-b">
          <CardTitle role="heading" aria-level={2}>{labels.formTitle}</CardTitle>
          <CardDescription>{labels.formDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate className="space-y-5" onSubmit={save}>
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground">{labels.identityNote}</div>
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              {fields.map((field) => {
                const fieldError = fieldErrors[field.name];
                const inputProps = {
                  id: field.id,
                  name: field.name,
                  value: values[field.name],
                  maxLength: field.maxLength,
                  required: field.required,
                  disabled: isPending,
                  "aria-invalid": Boolean(fieldError),
                  "aria-describedby": fieldError ? `${field.id}-error` : undefined,
                  placeholder: placeholders[field.name],
                  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                    setValues((current) => ({ ...current, [field.name]: event.target.value }));
                    setFieldErrors((current) => ({ ...current, [field.name]: undefined }));
                  },
                };
                return (
                  <div key={field.name} className={`min-w-0 space-y-2${field.name === "name" || field.name === "address" ? " sm:col-span-2" : ""}`}>
                    <Label htmlFor={field.id}>{labels[field.name]}{field.required ? <span aria-hidden="true" className="text-destructive">*</span> : null}</Label>
                    {field.name === "address" ? <Textarea {...inputProps} rows={4} /> : <Input {...inputProps} type={field.type ?? "text"} />}
                    {fieldError ? <p id={`${field.id}-error`} className="text-xs text-destructive">{fieldError}</p> : null}
                  </div>
                );
              })}
            </div>
            {error ? (
              <div role="alert" className="space-y-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm leading-6">
                <p className="text-destructive">{error}</p>
                {conflict ? <Button id="reload-company-profile" type="button" variant="outline" disabled={isPending} loading={pendingAction === "reload"} onClick={reload}>{pendingAction === "reload" ? dictionary.common.loading : labels.reload}</Button> : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p role="status" className="text-xs leading-5 text-muted-foreground">{savedAt ? `${labels.lastSaved} ${formatDateTime(savedAt, locale)}` : labels.notConfigured}</p>
              <Button type="submit" disabled={isPending} loading={pendingAction === "save"} className="w-full rounded-xl sm:w-auto">
                {pendingAction !== "save" ? <Save /> : null}{pendingAction === "save" ? dictionary.common.saving : labels.save}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="min-w-0 border-border/70 xl:sticky xl:top-28">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>{labels.previewTitle}</CardTitle>
          <CardDescription>{labels.previewDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 wrap-anywhere">
          <div className="space-y-3 rounded-xl border border-border/70 bg-background/50 p-4">
            <Building2 className="size-7 text-primary" />
            <p className="font-semibold leading-6">{values.name.trim() || "—"}</p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{values.address.trim() || "—"}</p>
            <dl className="space-y-3 border-t border-border/70 pt-4 text-sm">
              {(["taxId", "branch", "phone", "email"] as const).map((field) => (
                <div key={field} className="space-y-1">
                  <dt className="text-xs text-muted-foreground">{labels[field]}</dt>
                  <dd>{values[field].trim() || "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
