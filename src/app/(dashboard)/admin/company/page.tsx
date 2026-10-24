import { Building2, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { CompanyProfileForm } from "@/components/admin/company-profile-form";
import { requireSession } from "@/server/auth/session";
import { getCompanyProfile } from "@/server/company/company.service";
import { getCurrentDictionary } from "@/server/i18n";

export default async function CompanySettingsPage() {
  const session = await requireSession();
  if (session.role !== "ADMIN") redirect("/dashboard");

  const [profile, dictionary] = await Promise.all([
    getCompanyProfile(session),
    getCurrentDictionary(),
  ]);
  const labels = dictionary.companySettings;

  return (
    <div className="min-w-0 space-y-6">
      <section className="space-y-4 rounded-3xl border border-border/70 bg-card/80 p-5 sm:p-6">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <ShieldCheck className="size-3.5" /> Admin
        </span>
        <div className="flex items-start gap-3">
          <Building2 className="mt-1 size-6 shrink-0 text-primary" />
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{labels.title}</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{labels.description}</p>
          </div>
        </div>
      </section>
      <CompanyProfileForm key={profile?.version ?? 0} profile={profile} />
    </div>
  );
}
