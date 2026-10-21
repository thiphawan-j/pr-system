"use client";

import { useRef, useState, type FormEvent } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateMessage } from "@/lib/i18n";
import type { SupplierDetail } from "@/lib/types";

const channels = ["LINE", "PHONE", "ECOMMERCE", "EMAIL", "OTHER"] as const;
type Channel = (typeof channels)[number];
const hints = { LINE: "lineHint", PHONE: "phoneHint", ECOMMERCE: "ecommerceHint", EMAIL: "emailHint", OTHER: "otherHint" } as const;

export function SupplierForm({ supplier, onSaved, onReloaded, onPendingChange }: {
  supplier: SupplierDetail | null;
  onSaved: () => void;
  onReloaded: (supplier: SupplierDetail) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { dictionary, locale } = useI18n();
  const labels = dictionary.suppliers;
  const [fields, setFields] = useState({
    name: supplier?.name ?? "", taxId: supplier?.taxId ?? "", address: supplier?.address ?? "",
    contactPerson: supplier?.contactPerson ?? "", paymentTerms: supplier?.paymentTerms ?? "", note: supplier?.note ?? "",
  });
  const [selected, setSelected] = useState<Channel[]>(supplier?.contacts.map((contact) => contact.channel) ?? []);
  const [values, setValues] = useState<Partial<Record<Channel, string>>>(() =>
    Object.fromEntries(supplier?.contacts.map((contact) => [contact.channel, contact.value]) ?? []),
  );
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const pendingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const contactRefs = useRef<Partial<Record<Channel, HTMLInputElement | null>>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (!fields.name.trim()) { setError(labels.nameRequired); nameRef.current?.focus(); return; }
    if (!selected.length) { setError(labels.channelRequired); return; }
    const missing = selected.find((channel) => !values[channel]?.trim());
    if (missing) { setError(labels.contactRequired); contactRefs.current[missing]?.focus(); return; }
    pendingRef.current = true;
    setIsPending(true);
    onPendingChange(true);
    setError(null);
    try {
      const response = await fetch(supplier ? `/api/suppliers/${supplier.id}` : "/api/suppliers", {
        method: supplier ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fields,
          contacts: channels.filter((channel) => selected.includes(channel)).map((channel) => ({ channel, value: values[channel]!.trim() })),
          ...(supplier ? { expectedVersion: supplier.version, isActive } : {}),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setHasConflict(response.status === 409);
        setError(translateMessage(payload?.error, locale) ?? labels.saveError);
        return;
      }
      onSaved();
    } catch { setError(labels.saveError); }
    finally { pendingRef.current = false; setIsPending(false); onPendingChange(false); }
  }

  async function reloadLatest() {
    if (!supplier || pendingRef.current) return;
    pendingRef.current = true;
    setIsPending(true);
    onPendingChange(true);
    try {
      const response = await fetch(`/api/suppliers/${supplier.id}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(translateMessage(payload?.error, locale) ?? labels.loadError); return; }
      onReloaded(payload as SupplierDetail);
    } catch { setError(labels.loadError); }
    finally { pendingRef.current = false; setIsPending(false); onPendingChange(false); }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="supplier-name">{labels.name}</Label><Input ref={nameRef} id="supplier-name" required maxLength={200} disabled={isPending} value={fields.name} onChange={(event) => setFields((current) => ({ ...current, name: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="supplier-tax-id">{labels.taxId}</Label><Input id="supplier-tax-id" maxLength={50} disabled={isPending} value={fields.taxId} onChange={(event) => setFields((current) => ({ ...current, taxId: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="supplier-contact-person">{labels.contactPerson}</Label><Input id="supplier-contact-person" maxLength={200} disabled={isPending} value={fields.contactPerson} onChange={(event) => setFields((current) => ({ ...current, contactPerson: event.target.value }))} /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="supplier-address">{labels.address}</Label><Textarea id="supplier-address" maxLength={2000} disabled={isPending} value={fields.address} onChange={(event) => setFields((current) => ({ ...current, address: event.target.value }))} /></div>
      </div>
      <fieldset className="space-y-3 rounded-xl border border-border/70 p-3">
        <legend className="px-1 font-medium">{labels.channels}</legend>
        <div className="flex flex-wrap gap-4">
          {channels.map((channel) => <Label key={channel} htmlFor={`supplier-channel-${channel}`} className="flex items-center gap-2">
            <input id={`supplier-channel-${channel}`} type="checkbox" className="size-4 accent-primary" disabled={isPending} checked={selected.includes(channel)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, channel] : current.filter((item) => item !== channel))} />
            {labels[channel]}
          </Label>)}
        </div>
        {channels.filter((channel) => selected.includes(channel)).map((channel) => <div key={channel} className="space-y-2">
          <Label htmlFor={`supplier-contact-${channel}`}>{labels[channel]}</Label>
          <Input ref={(element) => { contactRefs.current[channel] = element; }} id={`supplier-contact-${channel}`} required maxLength={500} disabled={isPending} placeholder={labels[hints[channel]]} value={values[channel] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [channel]: event.target.value }))} />
        </div>)}
      </fieldset>
      <div className="space-y-2"><Label htmlFor="supplier-payment-terms">{labels.paymentTerms}</Label><Textarea id="supplier-payment-terms" maxLength={500} disabled={isPending} value={fields.paymentTerms} onChange={(event) => setFields((current) => ({ ...current, paymentTerms: event.target.value }))} /></div>
      <div className="space-y-2"><Label htmlFor="supplier-note">{labels.note}</Label><Textarea id="supplier-note" maxLength={2000} disabled={isPending} value={fields.note} onChange={(event) => setFields((current) => ({ ...current, note: event.target.value }))} /></div>
      {supplier ? <Label htmlFor="supplier-is-active" className="flex items-center gap-2"><input id="supplier-is-active" type="checkbox" className="size-4 accent-primary" disabled={isPending} checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />{labels.active}</Label> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {hasConflict ? <Button id="reload-supplier" type="button" variant="outline" disabled={isPending} onClick={reloadLatest}>{labels.reloadLatest}</Button> : null}
      <Button id="save-supplier" type="submit" className="w-full" disabled={isPending} aria-busy={isPending}>{isPending ? dictionary.common.saving : labels.save}</Button>
    </form>
  );
}
