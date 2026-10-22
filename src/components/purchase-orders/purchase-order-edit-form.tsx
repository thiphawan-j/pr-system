"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { SupplierCombobox } from "@/components/suppliers/supplier-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatNumber } from "@/lib/format";
import { translateMessage } from "@/lib/i18n";
import { supplierContactChannels, type PurchaseOrderDetail, type SupplierContact, type SupplierDetail } from "@/lib/types";

type DraftItem = { key: string; id?: string; itemName: string; description: string; unit: string; quantity: string; unitPrice: string };

export function PurchaseOrderEditForm({ order, suppliers }: { order: PurchaseOrderDetail; suppliers: SupplierDetail[] }) {
  const router = useRouter();
  const { dictionary, locale } = useI18n();
  const labels = dictionary.poChanges;
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [supplier, setSupplier] = useState({
    supplierId: order.supplierId, supplierName: order.supplierName, supplierTaxId: order.supplierTaxId ?? "",
    supplierAddress: order.supplierAddress ?? "", supplierContactPerson: order.supplierContactPerson ?? "",
    supplierContact: order.supplierContact ?? "", supplierContacts: order.supplierContacts,
  });
  const [headers, setHeaders] = useState({ deliveryAddress: order.deliveryAddress ?? "", paymentTerms: order.paymentTerms ?? "", expectedDeliveryDate: order.expectedDeliveryDate ?? "", note: order.note ?? "" });
  const [items, setItems] = useState<DraftItem[]>(() => order.items.map((item) => ({ key: item.id, id: item.id, itemName: item.itemName, description: item.description ?? "", unit: item.unit ?? "", quantity: String(item.quantity), unitPrice: String(item.unitPrice) })));
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const composingRef = useRef(false);
  const newItemCounter = useRef(0);
  const originalById = new Map(order.items.map((item) => [item.id, item]));
  const supplierLocked = order.items.some((item) => item.receivedQuantity > 0 || item.closedQuantity > 0);
  const disabled = isPending || !mounted;
  // Keeping the issued supplier remains valid even if its master was deactivated.
  const pickerSuppliers: SupplierDetail[] = order.supplierId && !suppliers.some((entry) => entry.id === order.supplierId)
    ? [...suppliers, { id: order.supplierId, code: order.supplierCode ?? "", name: order.supplierName, taxId: order.supplierTaxId, address: order.supplierAddress, contactPerson: order.supplierContactPerson, paymentTerms: order.paymentTerms, note: null, contacts: order.supplierContacts, isActive: true, version: 0, createdAt: order.issuedAt, updatedAt: order.issuedAt }]
    : suppliers;
  const previewTotal = items.reduce((sum, item) => sum + Math.round(Number(item.quantity) * Number(item.unitPrice) * 100) / 100, 0);

  function updateItem(key: string, field: keyof DraftItem, value: string) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));
  }

  function selectSupplier(selected: SupplierDetail) {
    setSupplier({ supplierId: selected.id, supplierName: selected.name, supplierTaxId: selected.taxId ?? "", supplierAddress: selected.address ?? "", supplierContactPerson: selected.contactPerson ?? "", supplierContacts: selected.contacts, supplierContact: "" });
    setHeaders((current) => ({ ...current, paymentTerms: selected.paymentTerms ?? "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || composingRef.current) return;
    if (reason.trim().length < 5) { setError(labels.reasonRequired); return; }
    if (!supplier.supplierName.trim()) { setError(dictionary.suppliers.nameRequired); return; }
    if (supplier.supplierId && supplier.supplierId !== order.supplierId && !suppliers.some((entry) => entry.id === supplier.supplierId && entry.isActive)) { setError(dictionary.suppliers.unavailable); return; }
    if (!items.length || items.some((item) => !item.itemName.trim())) { setError(labels.itemRequired); return; }
    const proposedItems = items.map((item) => ({ id: item.id, itemName: item.itemName, description: item.description, unit: item.unit, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) }));
    if (proposedItems.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 2147483647 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || Math.abs(item.unitPrice * 100 - Math.round(item.unitPrice * 100)) > 0.000001)) { setError(labels.invalidNumber); return; }
    for (const item of proposedItems) {
      const original = item.id ? originalById.get(item.id) : undefined;
      if (original && item.quantity !== original.quantity && item.quantity < original.receivedQuantity + original.closedQuantity) { setError(labels.quantityTooLow); return; }
    }
    if (!Number.isFinite(previewTotal) || previewTotal > 9999999999.99 || proposedItems.some((item) => item.quantity * item.unitPrice > 9999999999.99 || item.unitPrice > 9999999999.99)) { setError(labels.amountLimit); return; }
    if (supplier.supplierContacts.some((contact) => !contact.value.trim())) { setError(dictionary.suppliers.contactRequired); return; }
    pendingRef.current = true;
    setIsPending(true);
    setError(null);
    try {
      const { supplierId, ...supplierFields } = supplier;
      const response = await fetch(`/api/purchase-orders/${order.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: order.version, reason, supplier: { ...(supplierId ? { supplierId } : {}), ...supplierFields }, ...headers, items: proposedItems }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setError(translateMessage(payload?.error, locale) ?? labels.saveError); if (response.status === 409) router.refresh(); return; }
      toast.success(labels.submitted);
      router.push(`/purchase-orders/${order.id}`);
      router.refresh();
    } catch { setError(labels.saveError); }
    finally { pendingRef.current = false; setIsPending(false); }
  }

  return <form noValidate onSubmit={submit} className="space-y-6">
    <Card className="overflow-visible border-border/70"><CardHeader><CardTitle>{dictionary.purchaseOrders.supplierName}</CardTitle><CardDescription>{supplierLocked ? labels.supplierLock : labels.description}</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="space-y-2"><Label htmlFor="po-edit-supplier">{dictionary.purchaseOrders.supplierName}</Label><SupplierCombobox id="po-edit-supplier" value={supplier.supplierName} selectedSupplierId={supplier.supplierId ?? undefined} suppliers={pickerSuppliers} disabled={disabled || supplierLocked} onChange={(name) => setSupplier((current) => ({ ...current, supplierId: null, supplierName: name, ...(current.supplierId ? { supplierTaxId: "", supplierAddress: "", supplierContactPerson: "", supplierContact: "", supplierContacts: [] } : {}) }))} onSelect={selectSupplier} onCompositionChange={(composing) => { composingRef.current = composing; }} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="po-edit-supplier-tax-id">{dictionary.suppliers.taxId}</Label><Input id="po-edit-supplier-tax-id" maxLength={50} readOnly={supplierLocked} disabled={disabled} value={supplier.supplierTaxId} onChange={(event) => setSupplier((current) => ({ ...current, supplierTaxId: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="po-edit-supplier-contact-person">{dictionary.suppliers.contactPerson}</Label><Input id="po-edit-supplier-contact-person" maxLength={200} disabled={disabled} value={supplier.supplierContactPerson} onChange={(event) => setSupplier((current) => ({ ...current, supplierContactPerson: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="po-edit-supplier-address">{dictionary.suppliers.address}</Label><Textarea id="po-edit-supplier-address" maxLength={2000} disabled={disabled} value={supplier.supplierAddress} onChange={(event) => setSupplier((current) => ({ ...current, supplierAddress: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="po-edit-supplier-contact">{dictionary.purchaseOrders.supplierContact}</Label><Input id="po-edit-supplier-contact" maxLength={200} disabled={disabled} value={supplier.supplierContact} onChange={(event) => setSupplier((current) => ({ ...current, supplierContact: event.target.value }))} /></div>
      </div>
      <fieldset className="space-y-3 rounded-xl border border-border/70 p-3"><legend className="px-1 text-sm">{dictionary.suppliers.channels}</legend><div className="flex flex-wrap gap-4">{supplierContactChannels.map((channel) => <Label key={channel} htmlFor={`po-edit-channel-${channel}`} className="flex items-center gap-2"><input id={`po-edit-channel-${channel}`} type="checkbox" className="size-4 accent-primary" disabled={disabled} checked={supplier.supplierContacts.some((contact) => contact.channel === channel)} onChange={(event) => setSupplier((current) => ({ ...current, supplierContacts: event.target.checked ? [...current.supplierContacts, { channel, value: "" }] : current.supplierContacts.filter((contact) => contact.channel !== channel) }))} />{dictionary.suppliers[channel]}</Label>)}</div>{supplier.supplierContacts.map((contact: SupplierContact) => <div key={contact.channel} className="space-y-2"><Label htmlFor={`po-edit-contact-${contact.channel}`}>{dictionary.suppliers[contact.channel]}</Label><Input id={`po-edit-contact-${contact.channel}`} maxLength={500} disabled={disabled} value={contact.value} onChange={(event) => setSupplier((current) => ({ ...current, supplierContacts: current.supplierContacts.map((entry) => entry.channel === contact.channel ? { ...entry, value: event.target.value } : entry) }))} /></div>)}</fieldset>
    </CardContent></Card>
    <Card className="border-border/70"><CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="po-edit-delivery-address">{dictionary.purchaseOrders.deliveryAddress}</Label><Textarea id="po-edit-delivery-address" maxLength={2000} disabled={disabled} value={headers.deliveryAddress} onChange={(event) => setHeaders((current) => ({ ...current, deliveryAddress: event.target.value }))} /></div>
      <div className="space-y-2"><Label htmlFor="po-edit-payment-terms">{dictionary.purchaseOrders.paymentTerms}</Label><Textarea id="po-edit-payment-terms" maxLength={500} disabled={disabled} value={headers.paymentTerms} onChange={(event) => setHeaders((current) => ({ ...current, paymentTerms: event.target.value }))} /></div>
      <div className="space-y-2"><Label htmlFor="po-edit-expected-delivery-date">{dictionary.purchaseOrders.expectedDeliveryDate}</Label><Input id="po-edit-expected-delivery-date" type="date" disabled={disabled} value={headers.expectedDeliveryDate} onChange={(event) => setHeaders((current) => ({ ...current, expectedDeliveryDate: event.target.value }))} /></div>
      <div className="space-y-2"><Label htmlFor="po-edit-note">{dictionary.purchaseOrders.note}</Label><Textarea id="po-edit-note" maxLength={2000} disabled={disabled} value={headers.note} onChange={(event) => setHeaders((current) => ({ ...current, note: event.target.value }))} /></div>
    </CardContent></Card>
    <Card className="border-border/70"><CardHeader><CardTitle>{dictionary.purchaseRequests.itemList}</CardTitle></CardHeader><CardContent className="space-y-4">
      {items.map((item, index) => {
        const original = item.id ? originalById.get(item.id) : undefined;
        const locked = Boolean(original && (original.receivedQuantity > 0 || original.closedQuantity > 0));
        return <div key={item.key} className="space-y-3 rounded-2xl border border-border/70 p-4">
          {locked ? <p className="text-sm text-muted-foreground">{labels.receivedLock} ({dictionary.receiptWorkflow.received}: {formatNumber(original!.receivedQuantity, locale)} · {dictionary.receiptWorkflow.cancelled}: {formatNumber(original!.closedQuantity, locale)})</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor={`po-edit-item-name-${index}`}>{labels.itemName}</Label><Input id={`po-edit-item-name-${index}`} maxLength={200} readOnly={locked} disabled={disabled} value={item.itemName} onChange={(event) => updateItem(item.key, "itemName", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor={`po-edit-item-description-${index}`}>{labels.descriptionLabel}</Label><Textarea id={`po-edit-item-description-${index}`} maxLength={2000} readOnly={locked} disabled={disabled} value={item.description} onChange={(event) => updateItem(item.key, "description", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor={`po-edit-item-unit-${index}`}>{labels.unit}</Label><Input id={`po-edit-item-unit-${index}`} maxLength={50} readOnly={locked} disabled={disabled} value={item.unit} onChange={(event) => updateItem(item.key, "unit", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor={`po-edit-item-quantity-${index}`}>{labels.quantity}</Label><Input id={`po-edit-item-quantity-${index}`} type="number" min="1" max="2147483647" step="1" disabled={disabled} value={item.quantity} onChange={(event) => updateItem(item.key, "quantity", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor={`po-edit-item-unit-price-${index}`}>{labels.price}</Label><Input id={`po-edit-item-unit-price-${index}`} type="number" min="0" step="0.01" readOnly={locked} disabled={disabled} value={item.unitPrice} onChange={(event) => updateItem(item.key, "unitPrice", event.target.value)} /></div>
            <p className="self-end pb-1 text-sm font-medium">{dictionary.purchaseRequests.lineTotal}: {formatCurrency(Number(item.quantity) * Number(item.unitPrice), locale)}</p>
          </div>
          <Button id={`po-edit-remove-${index}`} type="button" variant="outline" disabled={disabled || locked} onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}>{labels.removeItem}</Button>
        </div>;
      })}
      <Button id="po-edit-add-item" type="button" variant="outline" disabled={disabled || items.length >= 500} onClick={() => { const key = `new-${newItemCounter.current++}`; setItems((current) => [...current, { key, itemName: "", description: "", unit: "", quantity: "1", unitPrice: "0" }]); }}>{labels.addItem}</Button>
      <p className="text-right text-xl font-semibold">{dictionary.common.totalAmount}: {formatCurrency(previewTotal, locale)}</p>
    </CardContent></Card>
    <Card className="border-border/70"><CardContent className="space-y-3 pt-4"><Label htmlFor="po-edit-reason">{labels.reason}</Label><Textarea id="po-edit-reason" rows={3} required maxLength={2000} disabled={disabled} value={reason} onChange={(event) => setReason(event.target.value)} />{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" disabled={disabled} onClick={() => router.push(`/purchase-orders/${order.id}`)}>{labels.cancel}</Button><Button id="save-po-changes" type="submit" disabled={disabled} aria-busy={isPending}>{isPending ? dictionary.common.saving : labels.save}</Button></div></CardContent></Card>
  </form>;
}
