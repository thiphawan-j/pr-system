"use client";

import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { PurchaseOrderItemTaxSelect, PurchaseOrderTaxFields, PurchaseOrderTaxSummary } from "@/components/purchase-orders/purchase-order-tax-fields";
import { SupplierCombobox } from "@/components/suppliers/supplier-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatNumber } from "@/lib/format";
import { translateMessage } from "@/lib/i18n";
import { calculatePurchaseOrderTax, type PurchasePriceTaxMode } from "@/lib/purchase-order-tax";
import { supplierContactChannels, type PurchaseOrderDetail, type SupplierContact, type SupplierDetail } from "@/lib/types";

type DraftItem = { key: string; id?: string; itemName: string; description: string; unit: string; quantity: string; unitPrice: string; taxMode: PurchasePriceTaxMode | null };

const MAX_ITEMS = 500;
const MAX_AMOUNT_CENTS = 999999999999;

function itemValues(item: DraftItem) {
  const quantityText = item.quantity.trim();
  const priceText = item.unitPrice.trim();
  const quantity = /^\d+$/.test(quantityText) ? Number(quantityText) : Number.NaN;
  const validQuantity = Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 2147483647;
  const validPriceText = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(priceText);
  const [whole = "", fraction = ""] = priceText.split(".");
  const unitPriceCents = validPriceText ? Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0")) : Number.NaN;
  const validPrice = Number.isSafeInteger(unitPriceCents) && unitPriceCents >= 0 && unitPriceCents <= MAX_AMOUNT_CENTS;
  const amountCents = quantity * unitPriceCents;
  const validAmount = validQuantity && validPrice && Number.isSafeInteger(amountCents) && amountCents <= MAX_AMOUNT_CENTS;
  return { quantity, validQuantity, unitPriceCents, validPrice, amountCents, validAmount };
}

function focusField(id: string) {
  const element = document.getElementById(id);
  let details = element?.closest("details");
  while (details) {
    details.open = true;
    details = details.parentElement?.closest("details") ?? null;
  }
  element?.focus();
  element?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function PurchaseOrderEditForm({ order, suppliers }: { order: PurchaseOrderDetail; suppliers: SupplierDetail[] }) {
  const router = useRouter();
  const { dictionary, locale } = useI18n();
  const labels = dictionary.poChanges;
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [sourceOrder] = useState(order);
  const [supplier, setSupplier] = useState({
    supplierId: order.supplierId, supplierName: order.supplierName, supplierTaxId: order.supplierTaxId ?? "",
    supplierAddress: order.supplierAddress ?? "", supplierContactPerson: order.supplierContactPerson ?? "",
    supplierContact: order.supplierContact ?? "", supplierContacts: order.supplierContacts,
  });
  const [headers, setHeaders] = useState({ deliveryAddress: order.deliveryAddress ?? "", paymentTerms: order.paymentTerms ?? "", expectedDeliveryDate: order.expectedDeliveryDate ?? "", note: order.note ?? "" });
  const [items, setItems] = useState<DraftItem[]>(() => order.items.map((item) => ({ key: item.id, id: item.id, itemName: item.itemName, description: item.description ?? "", unit: item.unit ?? "", quantity: String(item.quantity), unitPrice: String(item.unitPrice), taxMode: item.taxMode ?? null })));
  const [taxMode, setTaxMode] = useState<PurchasePriceTaxMode>(order.taxMode ?? "UNSPECIFIED");
  const [vatRate, setVatRate] = useState(String(order.vatRate ?? 7));
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hasConflict, setHasConflict] = useState(false);
  const pendingRef = useRef(false);
  const composingRef = useRef(false);
  const newItemCounter = useRef(0);
  const originalById = new Map(sourceOrder.items.map((item) => [item.id, item]));
  const supplierLocked = sourceOrder.items.some((item) => item.receivedQuantity > 0 || item.closedQuantity > 0);
  const disabled = isPending || !mounted;
  // Keeping the issued supplier remains valid even if its master was deactivated.
  const pickerSuppliers: SupplierDetail[] = sourceOrder.supplierId && !suppliers.some((entry) => entry.id === sourceOrder.supplierId)
    ? [...suppliers, { id: sourceOrder.supplierId, code: sourceOrder.supplierCode ?? "", name: sourceOrder.supplierName, taxId: sourceOrder.supplierTaxId, address: sourceOrder.supplierAddress, contactPerson: sourceOrder.supplierContactPerson, paymentTerms: sourceOrder.paymentTerms, note: null, contacts: sourceOrder.supplierContacts, isActive: true, version: 0, createdAt: sourceOrder.issuedAt, updatedAt: sourceOrder.issuedAt }]
    : suppliers;
  const values = items.map(itemValues);
  const previewCents = values.reduce((sum, value) => sum + (value.validAmount ? value.amountCents : 0), 0);
  const vatRateNumber = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(vatRate.trim()) ? Number(vatRate) : Number.NaN;
  const validVatRate = Number.isFinite(vatRateNumber) && vatRateNumber >= 0 && vatRateNumber <= 100;
  const taxItems = items.map((item, index) => ({ amount: values[index]!.validAmount ? values[index]!.amountCents / 100 : 0, taxMode: item.taxMode }));
  let taxSummary: ReturnType<typeof calculatePurchaseOrderTax> | null = null;
  try { taxSummary = calculatePurchaseOrderTax(taxItems, taxMode, validVatRate ? vatRateNumber : 7); }
  catch { /* Invalid or overflowing drafts stay editable and display no payable total. */ }
  const validTotal = validVatRate && values.every((value) => value.validAmount) && Number.isSafeInteger(previewCents) && previewCents <= MAX_AMOUNT_CENTS && taxSummary !== null;
  const previewTotal = taxSummary?.totalAmount ?? 0;

  function clearFieldError(id: string) {
    setError(null);
    setFieldErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function fail(id: string, message: string) {
    setError(message);
    setFieldErrors({ [id]: message });
    focusField(id);
  }

  function fieldError(id: string) {
    return fieldErrors[id] ? <p id={`${id}-error`} className="text-xs text-destructive">{fieldErrors[id]}</p> : null;
  }

  function updateItem(key: string, field: "itemName" | "description" | "unit" | "quantity" | "unitPrice", value: string, index: number) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));
    const suffix = field === "itemName" ? "name" : field === "unitPrice" ? "unit-price" : field;
    clearFieldError(`po-edit-item-${suffix}-${index}`);
  }

  function addItem() {
    const key = `new-${newItemCounter.current++}`;
    const index = items.length;
    setItems((current) => [...current, { key, itemName: "", description: "", unit: "", quantity: "1", unitPrice: "", taxMode: null }]);
    requestAnimationFrame(() => focusField(`po-edit-item-name-${index}`));
  }

  function selectSupplier(selected: SupplierDetail) {
    setSupplier({ supplierId: selected.id, supplierName: selected.name, supplierTaxId: selected.taxId ?? "", supplierAddress: selected.address ?? "", supplierContactPerson: selected.contactPerson ?? "", supplierContacts: selected.contacts, supplierContact: "" });
    setHeaders((current) => ({ ...current, paymentTerms: selected.paymentTerms ?? "" }));
    clearFieldError("po-edit-supplier");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || composingRef.current || hasConflict) return;
    if (!items.length) { fail("po-edit-add-item", labels.itemRequired); return; }
    if (items.length > MAX_ITEMS) { fail("po-edit-add-item", labels.itemLimit); return; }
    for (const [index, item] of items.entries()) {
      const value = values[index]!;
      if (!item.itemName.trim()) { fail(`po-edit-item-name-${index}`, dictionary.purchaseOrders.itemNameRequired); return; }
      if (!value.validQuantity) { fail(`po-edit-item-quantity-${index}`, dictionary.purchaseOrders.quantityInvalid); return; }
      if (!value.validPrice) { fail(`po-edit-item-unit-price-${index}`, dictionary.purchaseOrders.priceInvalid); return; }
      if (!value.validAmount) { fail(`po-edit-item-unit-price-${index}`, labels.amountLimit); return; }
      const original = item.id ? originalById.get(item.id) : undefined;
      if (original && value.quantity !== original.quantity && value.quantity < original.receivedQuantity + original.closedQuantity) { fail(`po-edit-item-quantity-${index}`, labels.quantityTooLow); return; }
    }
    if (!validVatRate) { fail("po-edit-vat-rate", dictionary.poTax.rateInvalid); return; }
    if (!validTotal) { fail("po-edit-add-item", labels.amountLimit); return; }
    if (!supplier.supplierName.trim()) { fail("po-edit-supplier", dictionary.suppliers.nameRequired); return; }
    if (supplier.supplierId && supplier.supplierId !== sourceOrder.supplierId && !suppliers.some((entry) => entry.id === supplier.supplierId && entry.isActive)) { fail("po-edit-supplier", dictionary.suppliers.unavailable); return; }
    const emptyContact = supplier.supplierContacts.find((contact) => !contact.value.trim());
    if (emptyContact) { fail(`po-edit-contact-${emptyContact.channel}`, dictionary.suppliers.contactRequired); return; }
    if (reason.trim().length < 5) { fail("po-edit-reason", labels.reasonRequired); return; }
    const proposedItems = items.map((item, index) => ({ id: item.id, itemName: item.itemName, description: item.description, unit: item.unit, quantity: values[index]!.quantity, unitPrice: values[index]!.unitPriceCents / 100, taxMode: item.taxMode }));
    pendingRef.current = true;
    setIsPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const { supplierId, ...supplierFields } = supplier;
      const response = await fetch(`/api/purchase-orders/${sourceOrder.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: sourceOrder.version, reason, supplier: { ...(supplierId ? { supplierId } : {}), ...supplierFields }, ...headers, taxMode, vatRate: vatRateNumber, items: proposedItems }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) { setHasConflict(true); setError(null); }
        else setError(translateMessage(payload?.error, locale) ?? labels.saveError);
        return;
      }
      toast.success(labels.submitted);
      router.push(`/purchase-orders/${sourceOrder.id}`);
      router.refresh();
    } catch { setError(labels.saveError); }
    finally { pendingRef.current = false; setIsPending(false); }
  }


  const columnLayout = "md:grid-cols-[minmax(0,1fr)_5rem_4.5rem_7rem_7rem_2rem]";

  return (
    <form
      noValidate onSubmit={submit} className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]"
      onCompositionStartCapture={() => { composingRef.current = true; }}
      onCompositionEndCapture={() => { composingRef.current = false; }}
      onKeyDown={(event) => { if (event.key === "Enter" && event.keyCode === 229 && !event.nativeEvent.isComposing) event.preventDefault(); }}
    >
      <div className="min-w-0 space-y-6">
        <Card className="min-w-0 border-border/70">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{dictionary.purchaseRequests.itemList} <span className="text-sm font-normal text-muted-foreground">({formatNumber(items.length, locale)})</span></CardTitle>
              <Button id="po-edit-add-item" type="button" variant="outline" disabled={disabled || items.length >= MAX_ITEMS} title={items.length >= MAX_ITEMS ? labels.itemLimit : undefined} onClick={addItem}><Plus className="size-4" />{labels.addItem}</Button>
            </div>
            <CardDescription>{labels.editItemsHint}</CardDescription>
            {fieldError("po-edit-add-item")}
          </CardHeader>
          <CardContent className="min-w-0 space-y-4">
            <div className="space-y-2">
              <PurchaseOrderTaxFields idPrefix="po-edit" taxMode={taxMode} vatRate={vatRate} rateError={fieldErrors["po-edit-vat-rate"]} disabled={disabled || supplierLocked} onTaxModeChange={(mode) => { setTaxMode(mode); clearFieldError("po-edit-add-item"); }} onVatRateChange={(value) => { setVatRate(value); clearFieldError("po-edit-vat-rate"); }} onApplyAll={() => { setItems((current) => current.map((item) => ({ ...item, taxMode: null }))); clearFieldError("po-edit-add-item"); }} />
              {fieldError("po-edit-vat-rate")}
              {supplierLocked ? <p className="text-xs text-muted-foreground">{dictionary.poTax.receivedLock}</p> : null}
            </div>
            <div aria-hidden="true" className={`hidden gap-3 px-3 text-xs text-muted-foreground md:grid ${columnLayout}`}>
              <span>{labels.itemName}</span><span>{labels.quantity}</span><span>{labels.unit}</span><span>{labels.price}</span><span className="text-right">{dictionary.purchaseRequests.lineTotal}</span><span />
            </div>
            {items.map((item, index) => {
              const original = item.id ? originalById.get(item.id) : undefined;
              const locked = Boolean(original && (original.receivedQuantity > 0 || original.closedQuantity > 0));
              const value = values[index]!;
              return (
                <div key={item.key} data-po-edit-item={item.key} className="min-w-0 space-y-3 rounded-xl border border-border/70 p-3">
                  <div className={`grid min-w-0 grid-cols-2 items-start gap-3 ${columnLayout}`}>
                    <div className="col-span-2 min-w-0 space-y-1.5 md:col-span-1">
                      <Label htmlFor={`po-edit-item-name-${index}`} className="text-xs md:sr-only">{labels.itemName} {index + 1}</Label>
                      <div className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="text-xs tabular-nums text-muted-foreground">{index + 1}.</span><Input id={`po-edit-item-name-${index}`} maxLength={200} readOnly={locked} disabled={disabled} value={item.itemName} aria-invalid={Boolean(fieldErrors[`po-edit-item-name-${index}`])} aria-describedby={fieldErrors[`po-edit-item-name-${index}`] ? `po-edit-item-name-${index}-error` : undefined} onChange={(event) => updateItem(item.key, "itemName", event.target.value, index)} /></div>
                      {fieldError(`po-edit-item-name-${index}`)}
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor={`po-edit-item-quantity-${index}`} className="text-xs md:sr-only">{labels.quantity} {index + 1}</Label>
                      <Input id={`po-edit-item-quantity-${index}`} inputMode="numeric" disabled={disabled} value={item.quantity} aria-invalid={Boolean(fieldErrors[`po-edit-item-quantity-${index}`])} aria-describedby={fieldErrors[`po-edit-item-quantity-${index}`] ? `po-edit-item-quantity-${index}-error` : undefined} onChange={(event) => updateItem(item.key, "quantity", event.target.value, index)} />
                      {fieldError(`po-edit-item-quantity-${index}`)}
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor={`po-edit-item-unit-${index}`} className="text-xs md:sr-only">{labels.unit} {index + 1}</Label>
                      <Input id={`po-edit-item-unit-${index}`} maxLength={50} readOnly={locked} disabled={disabled} value={item.unit} onChange={(event) => updateItem(item.key, "unit", event.target.value, index)} />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor={`po-edit-item-unit-price-${index}`} className="text-xs md:sr-only">{labels.price} {index + 1}</Label>
                      <Input id={`po-edit-item-unit-price-${index}`} inputMode="decimal" readOnly={locked} disabled={disabled} value={item.unitPrice} aria-invalid={Boolean(fieldErrors[`po-edit-item-unit-price-${index}`])} aria-describedby={fieldErrors[`po-edit-item-unit-price-${index}`] ? `po-edit-item-unit-price-${index}-error` : undefined} onChange={(event) => updateItem(item.key, "unitPrice", event.target.value, index)} />
                      {fieldError(`po-edit-item-unit-price-${index}`)}
                    </div>
                    <div className="min-w-0 space-y-1.5 text-right md:pt-1.5">
                      <p className="text-xs text-muted-foreground md:sr-only">{dictionary.purchaseRequests.lineTotal}</p>
                      <p id={`po-edit-item-total-${index}`} className="break-all text-sm font-medium tabular-nums">{value.validAmount ? formatCurrency(value.amountCents / 100, locale) : "—"}</p>
                    </div>
                    <Button id={`po-edit-remove-${index}`} type="button" variant="ghost" size="icon" className="col-span-2 justify-self-end text-destructive hover:text-destructive md:col-span-1" disabled={disabled || locked || items.length <= 1} title={items.length <= 1 ? labels.minimumItems : locked ? labels.receivedLock : labels.removeItem} aria-label={`${labels.removeItem}: ${item.itemName || index + 1}`} onClick={() => { setItems((current) => current.filter((entry) => entry.key !== item.key)); setFieldErrors({}); setError(null); }}><Trash2 className="size-4" /></Button>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-t border-border/50 pt-3">
                    <div className="min-w-0 max-w-full space-y-1.5"><Label htmlFor={`po-edit-item-tax-mode-${index}`} className="text-xs text-muted-foreground">{dictionary.poTax.itemMode}</Label><PurchaseOrderItemTaxSelect id={`po-edit-item-tax-mode-${index}`} value={item.taxMode} disabled={disabled || locked} onChange={(mode) => { setItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, taxMode: mode } : entry)); clearFieldError("po-edit-add-item"); }} /></div>
                    <details className="group min-w-0 grow basis-48">
                      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronDown className="size-3 transition-transform group-open:rotate-180" />{labels.descriptionLabel}{item.description ? <span className="size-1 rounded-full bg-primary" aria-hidden="true" /> : null}</summary>
                      <div className="space-y-2 pt-3"><Label htmlFor={`po-edit-item-description-${index}`} className="sr-only">{labels.descriptionLabel} {index + 1}</Label><Textarea id={`po-edit-item-description-${index}`} rows={2} maxLength={2000} readOnly={locked} disabled={disabled} value={item.description} onChange={(event) => updateItem(item.key, "description", event.target.value, index)} /></div>
                    </details>
                  </div>
                  {locked ? <p className="text-xs leading-5 text-muted-foreground">{labels.receivedLock} ({dictionary.receiptWorkflow.received}: {formatNumber(original!.receivedQuantity, locale)} · {dictionary.receiptWorkflow.cancelled}: {formatNumber(original!.closedQuantity, locale)})</p> : null}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">{items.length >= MAX_ITEMS ? labels.itemLimit : labels.minimumItems}</p>
          </CardContent>
        </Card>

        <Card className="overflow-visible border-border/70">
          <CardHeader><CardTitle>{dictionary.purchaseOrders.supplierName}</CardTitle>{supplierLocked ? <CardDescription>{labels.supplierLock}</CardDescription> : null}</CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="po-edit-supplier" className="sr-only">{dictionary.purchaseOrders.supplierName}</Label>
              <SupplierCombobox id="po-edit-supplier" value={supplier.supplierName} selectedSupplierId={supplier.supplierId ?? undefined} suppliers={pickerSuppliers} disabled={disabled || supplierLocked} invalid={Boolean(fieldErrors["po-edit-supplier"])} onChange={(name) => { setSupplier((current) => ({ ...current, supplierId: null, supplierName: name, ...(current.supplierId ? { supplierTaxId: "", supplierAddress: "", supplierContactPerson: "", supplierContact: "", supplierContacts: [] } : {}) })); clearFieldError("po-edit-supplier"); }} onSelect={selectSupplier} onCompositionChange={(composing) => { composingRef.current = composing; }} />
              {fieldError("po-edit-supplier")}
            </div>
            <details className="group">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-2 text-sm font-medium"><ChevronDown className="size-4 transition-transform group-open:rotate-180" />{labels.supplierDetails}</summary>
              <div className="space-y-4 pt-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="po-edit-supplier-tax-id">{dictionary.suppliers.taxId}</Label><Input id="po-edit-supplier-tax-id" maxLength={50} readOnly={supplierLocked} disabled={disabled} value={supplier.supplierTaxId} onChange={(event) => setSupplier((current) => ({ ...current, supplierTaxId: event.target.value }))} /></div>
                  <div className="space-y-2"><Label htmlFor="po-edit-supplier-contact-person">{dictionary.suppliers.contactPerson}</Label><Input id="po-edit-supplier-contact-person" maxLength={200} disabled={disabled} value={supplier.supplierContactPerson} onChange={(event) => setSupplier((current) => ({ ...current, supplierContactPerson: event.target.value }))} /></div>
                  <div className="space-y-2"><Label htmlFor="po-edit-supplier-address">{dictionary.suppliers.address}</Label><Textarea id="po-edit-supplier-address" maxLength={2000} disabled={disabled} value={supplier.supplierAddress} onChange={(event) => setSupplier((current) => ({ ...current, supplierAddress: event.target.value }))} /></div>
                  <div className="space-y-2"><Label htmlFor="po-edit-supplier-contact">{dictionary.purchaseOrders.supplierContact}</Label><Input id="po-edit-supplier-contact" maxLength={200} disabled={disabled} value={supplier.supplierContact} onChange={(event) => setSupplier((current) => ({ ...current, supplierContact: event.target.value }))} /></div>
                </div>
                <fieldset className="space-y-3 rounded-xl border border-border/70 p-3">
                  <legend className="px-1 text-sm">{dictionary.suppliers.channels}</legend>
                  <div className="flex flex-wrap gap-4">{supplierContactChannels.map((channel) => <Label key={channel} htmlFor={`po-edit-channel-${channel}`} className="flex items-center gap-2"><input id={`po-edit-channel-${channel}`} type="checkbox" className="size-4 accent-primary" disabled={disabled} checked={supplier.supplierContacts.some((contact) => contact.channel === channel)} onChange={(event) => setSupplier((current) => ({ ...current, supplierContacts: event.target.checked ? [...current.supplierContacts, { channel, value: "" }] : current.supplierContacts.filter((contact) => contact.channel !== channel) }))} />{dictionary.suppliers[channel]}</Label>)}</div>
                  {supplier.supplierContacts.map((contact: SupplierContact) => <div key={contact.channel} className="space-y-2"><Label htmlFor={`po-edit-contact-${contact.channel}`}>{dictionary.suppliers[contact.channel]}</Label><Input id={`po-edit-contact-${contact.channel}`} maxLength={500} disabled={disabled} value={contact.value} aria-invalid={Boolean(fieldErrors[`po-edit-contact-${contact.channel}`])} aria-describedby={fieldErrors[`po-edit-contact-${contact.channel}`] ? `po-edit-contact-${contact.channel}-error` : undefined} onChange={(event) => { setSupplier((current) => ({ ...current, supplierContacts: current.supplierContacts.map((entry) => entry.channel === contact.channel ? { ...entry, value: event.target.value } : entry) })); clearFieldError(`po-edit-contact-${contact.channel}`); }} />{fieldError(`po-edit-contact-${contact.channel}`)}</div>)}
                </fieldset>
              </div>
            </details>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 font-medium"><ChevronDown className="size-4 transition-transform group-open:rotate-180" />{labels.deliveryDetails}</summary>
              <div className="grid gap-4 pt-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="po-edit-delivery-address">{dictionary.purchaseOrders.deliveryAddress}</Label><Textarea id="po-edit-delivery-address" maxLength={2000} disabled={disabled} value={headers.deliveryAddress} onChange={(event) => setHeaders((current) => ({ ...current, deliveryAddress: event.target.value }))} /></div>
                <div className="space-y-2"><Label htmlFor="po-edit-payment-terms">{dictionary.purchaseOrders.paymentTerms}</Label><Textarea id="po-edit-payment-terms" maxLength={500} disabled={disabled} value={headers.paymentTerms} onChange={(event) => setHeaders((current) => ({ ...current, paymentTerms: event.target.value }))} /></div>
                <div className="space-y-2"><Label htmlFor="po-edit-expected-delivery-date">{dictionary.purchaseOrders.expectedDeliveryDate}</Label><Input id="po-edit-expected-delivery-date" type="date" disabled={disabled} value={headers.expectedDeliveryDate} onChange={(event) => setHeaders((current) => ({ ...current, expectedDeliveryDate: event.target.value }))} /></div>
                <div className="space-y-2"><Label htmlFor="po-edit-note">{dictionary.purchaseOrders.note}</Label><Textarea id="po-edit-note" maxLength={2000} disabled={disabled} value={headers.note} onChange={(event) => setHeaders((current) => ({ ...current, note: event.target.value }))} /></div>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>

      <aside className="min-w-0 xl:sticky xl:top-24">
        <Card className="border-border/70">
          <CardHeader><CardTitle>{labels.summaryTitle}</CardTitle><CardDescription>{sourceOrder.poNumber} · {labels.revision} {sourceOrder.revision}</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <dl className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">{labels.itemCount}</dt><dd className="tabular-nums">{formatNumber(items.length, locale)}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">{labels.totalBefore}</dt><dd className="text-right tabular-nums">{formatCurrency(sourceOrder.totalAmount, locale)}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">{labels.totalDifference}</dt><dd id="po-edit-total-difference" className="text-right tabular-nums">{validTotal ? `${previewTotal > sourceOrder.totalAmount ? "+" : ""}${formatCurrency(previewTotal - sourceOrder.totalAmount, locale)}` : "—"}</dd></div>
            </dl>
            {validTotal ? <PurchaseOrderTaxSummary items={taxItems} taxMode={taxMode} vatRate={vatRateNumber} totalId="po-edit-total" /> : <div className="flex justify-between gap-2 border-t border-border/70 pt-3"><p>{labels.totalAfter}</p><p id="po-edit-total" className="text-xl font-semibold">—</p></div>}
            <div className="space-y-2"><Label htmlFor="po-edit-reason">{labels.reason} <span aria-hidden="true" className="text-destructive">*</span></Label><Textarea id="po-edit-reason" rows={3} required maxLength={2000} disabled={disabled} value={reason} aria-invalid={Boolean(fieldErrors["po-edit-reason"])} aria-describedby={fieldErrors["po-edit-reason"] ? "po-edit-reason-error" : "po-edit-reason-hint"} onChange={(event) => { setReason(event.target.value); clearFieldError("po-edit-reason"); }} />{fieldError("po-edit-reason")}<p id="po-edit-reason-hint" className="text-xs leading-5 text-muted-foreground">{labels.reasonRequired}</p></div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            {hasConflict ? <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"><p>{labels.conflict}</p><p className="text-xs text-muted-foreground">{labels.reloadHint}</p><Button id="reload-po-edit" type="button" variant="outline" disabled={disabled} onClick={() => window.location.reload()}>{labels.reload}</Button></div> : null}
            <div className="flex flex-col gap-2"><Button id="save-po-changes" type="submit" className="h-auto min-h-9 whitespace-normal py-2" disabled={disabled || hasConflict} aria-busy={isPending}>{isPending ? dictionary.common.saving : labels.save}</Button><Button type="button" variant="outline" disabled={disabled} onClick={() => router.push(`/purchase-orders/${sourceOrder.id}`)}>{labels.cancel}</Button></div>
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}
