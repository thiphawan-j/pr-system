import { ShieldCheck, TimerReset, WalletCards } from "lucide-react";

import { LanguageToggle } from "@/components/i18n/language-toggle";
import { LoginForm } from "@/components/shared/login-form";
import { getCurrentDictionary } from "@/server/i18n";

export default async function LoginPage() {
  const dictionary = await getCurrentDictionary();
  const appEnv =
    process.env.APP_ENV ??
    (process.env.NODE_ENV === "production" ? "prod" : "dev");
  const showDemoAccounts = appEnv !== "prod";

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18),transparent_24%)]" />
      <div className="absolute top-4 right-4 z-10">
        <LanguageToggle />
      </div>
      <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
        <section className="space-y-8">
          <div className="space-y-4">
            <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-4 py-1 text-sm font-medium text-primary">
              {dictionary.auth.heroBadge}
            </span>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                {dictionary.auth.heroTitle}
              </h1>
              <p className="max-w-2xl text-lg text-muted-foreground">
                {dictionary.auth.heroDescription}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="glass-panel rounded-3xl p-5">
              <TimerReset className="mb-3 size-6 text-primary" />
              <h2 className="font-semibold">{dictionary.auth.featureFastTitle}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {dictionary.auth.featureFastDescription}
              </p>
            </div>
            <div className="glass-panel rounded-3xl p-5">
              <WalletCards className="mb-3 size-6 text-primary" />
              <h2 className="font-semibold">{dictionary.auth.featureBudgetTitle}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {dictionary.auth.featureBudgetDescription}
              </p>
            </div>
            <div className="glass-panel rounded-3xl p-5">
              <ShieldCheck className="mb-3 size-6 text-primary" />
              <h2 className="font-semibold">{dictionary.auth.featureAccessTitle}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {dictionary.auth.featureAccessDescription}
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-md">
          <LoginForm showDemoAccounts={showDemoAccounts} />
        </section>
      </div>
    </main>
  );
}
