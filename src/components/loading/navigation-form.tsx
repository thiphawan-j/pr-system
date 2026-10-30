"use client";

import { createContext, useContext, type ComponentProps } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { useAppRouter } from "@/components/loading/use-app-router";
import { Button } from "@/components/ui/button";

const FormPendingContext = createContext(false);
type FormSubmitEvent = Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0];

/** Keep GET filters in the client router so their pending state stays visible. */
export function NavigationForm({ children, onSubmit, method = "get", ...props }: ComponentProps<"form">) {
  const router = useAppRouter();
  function submit(event: FormSubmitEvent) {
    onSubmit?.(event);
    if (event.defaultPrevented || method.toLowerCase() !== "get" || typeof props.action === "function") return;
    const form = event.currentTarget;
    const target = new URL(form.action || window.location.href, window.location.href);
    if (target.origin !== window.location.origin || form.target && form.target !== "_self") return;
    event.preventDefault();
    if (router.isPending) return;
    const parameters = new URLSearchParams();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    for (const [key, value] of new FormData(form, submitter)) parameters.append(key, typeof value === "string" ? value : value.name);
    target.search = parameters.toString();
    router.push(target.pathname + target.search + target.hash);
  }
  return <FormPendingContext.Provider value={router.isPending}>
    <form {...props} method={method} onSubmit={submit} aria-busy={router.isPending || undefined}>{children}</form>
  </FormPendingContext.Provider>;
}

export function NavigationSubmitButton({ children, loading, ...props }: ComponentProps<typeof Button>) {
  const pending = useContext(FormPendingContext);
  const { dictionary } = useI18n();
  return <Button {...props} type="submit" loading={pending || loading} loadingKind="navigation">
    {pending ? dictionary.common.loading : children}
  </Button>;
}
