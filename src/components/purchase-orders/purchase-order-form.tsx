"use client";

import { Eye, Plus, Trash2 } from "lucide-react";
import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { DeliveryRecipientSelect } from "@/components/purchase-orders/delivery-recipient-select";
import { PurchaseOrderCreationPreviewStep } from "@/components/purchase-orders/purchase-order-creation-preview";
import { discountDraftError, PurchaseOrderDiscountFields } from "@/components/purchase-orders/purchase-order-discount-fields";
import { PurchaseOrderItemTaxSelect, PurchaseOrderTaxFields, PurchaseOrderTaxSummary } from "@/components/purchase-orders/purchase-order-tax-fields";
import { SupplierCombobox } from "@/components/suppliers/supplier-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatNumber } from "@/lib/format";
import { getUnitLabel, translateMessage } from "@/lib/i18n";
import { calculatePurchaseOrderPricing, type PurchaseDiscountType, type PurchasePriceTaxMode } from "@/lib/purchase-order-tax";
import type { PurchaseOrderCreationPreview, PurchaseOrderRecipientOption, PurchaseRequestDetail, SupplierDetail } from "@/lib/types";

import "@/components/purchase-orders/purchase-order-print.css";

type OrderHeaders = {
  supplierAddress: string;
  supplierContact: string;
  deliveryAddress: string;
  paymentTerms: string;
  expectedDeliveryDate: string;
  note: string;
};

type EditableItem = {
  clientId: string;
  sourceItemId?: string;
  sourcePurchaseRequestId: string;
  itemName: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxMode: PurchasePriceTaxMode | null;
  discountType: PurchaseDiscountType;
  discountValue: string;
};

const MAX_AMOUNT_CENTS = 999999999999;
const MAX_QUANTITY = 2147483647;
const MAX_ITEMS = 500;

function itemValues(item: EditableItem, original?: { quantity: number; unitPrice?: number | null; amount: number }) {
  const quantityText = item.quantity.trim();
  const priceText = item.unitPrice.trim();
  const quantity = /^\d+$/.test(quantityText) ? Number(quantityText) : Number.NaN;
  const validQuantity = Number.isInteger(quantity) && quantity > 0 && quantity <= MAX_QUANTITY;
  const validPriceText = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(priceText);
  const [whole = "", fraction = ""] = priceText.split(".");
  const unitPriceCents = validPriceText ? Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0")) : Number.NaN;
  const validPrice = Number.isSafeInteger(unitPriceCents) && unitPriceCents >= 0 && unitPriceCents <= MAX_AMOUNT_CENTS;
  const keepsStoredAmount = original && validQuantity && validPrice
    && quantity === original.quantity && unitPriceCents === Math.round((original.unitPrice ?? 0) * 100);
  const amountCents = keepsStoredAmount ? Math.round(original.amount * 100) : validQuantity && validPrice ? quantity * unitPriceCents : 0;
  const validAmount = validQuantity && validPrice && Number.isSafeInteger(amountCents) && amountCents >= 0 && amountCents <= MAX_AMOUNT_CENTS;
  return { quantity, validQuantity, validPrice, unitPriceCents, amountCents, validAmount };
}

function normalizedItem(item: EditableItem, includeSource = false) {
  const values = itemValues(item);
  return {
    clientId: item.clientId,
    ...(includeSource ? { sourcePurchaseRequestId: item.sourcePurchaseRequestId } : {}),
    ...(item.sourceItemId ? { sourceItemId: item.sourceItemId } : {}),
    itemName: item.itemName.trim(),
    description: item.description.trim() || undefined,
    quantity: values.quantity,
    unit: item.unit.trim() || undefined,
    unitPrice: values.unitPriceCents / 100,
    taxMode: item.taxMode,
    ...(item.discountType !== "NONE" ? { discountType: item.discountType, discountValue: Number(item.discountValue) } : {}),
  };
}

const emptyHeaders: OrderHeaders = {
  supplierAddress: "", supplierContact: "", deliveryAddress: "",
  paymentTerms: "", expectedDeliveryDate: "", note: "",
};

export function PurchaseOrderForm({ request, requests, suppliers = [], recipients = [] }: { request: PurchaseRequestDetail; requests?: PurchaseRequestDetail[]; suppliers?: SupplierDetail[]; recipients?: PurchaseOrderRecipientOption[] }) {
  const router = useRouter();
  const { dictionary, locale } = useI18n();
  const labels = dictionary.purchaseOrders;
  const previewLabels = dictionary.poPreview;
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [sourceRequests] = useState(() => requests ?? [request]);
  const sourceRequest = sourceRequests[0]!;
  const isCombined = Boolean(requests);
  const sourceLines = sourceRequests.flatMap((source) => source.items.filter((item) => item.canOrder !== false).map((item) => ({ ...item, sourcePurchaseRequestId: source.id })));
  const sourceById = new Map(sourceRequests.map((source) => [source.id, source]));
  const [selectedIds, setSelectedIds] = useState(() => new Set(sourceLines.map((item) => item.id)));
  const [items, setItems] = useState<EditableItem[]>(() => sourceLines.map((item) => ({
    sourcePurchaseRequestId: item.sourcePurchaseRequestId,
    clientId: item.id,
    sourceItemId: item.id,
    itemName: item.itemName,
    description: item.description ?? "",
    quantity: String(item.quantity),
    unit: item.unit ?? "",
    unitPrice: String(item.unitPrice ?? 0),
    taxMode: item.taxMode && item.taxMode !== "UNSPECIFIED" ? item.taxMode : null,
    discountType: item.discountType ?? "NONE",
    discountValue: String(item.discountValue ?? 0),
  })));
  const [assignments, setAssignments] = useState<Record<string, { supplierId: string; name: string }>>(() =>
    Object.fromEntries(sourceLines.map((item) => [item.id, { supplierId: "", name: item.supplierName ?? "" }])),
  );
  const supplierIds = Object.fromEntries(Object.entries(assignments).map(([id, assignment]) => [id, assignment.supplierId]));
  const supplierNames = Object.fromEntries(Object.entries(assignments).map(([id, assignment]) => [id, assignment.name]));
  const [headers, setHeaders] = useState<Record<string, OrderHeaders>>({});
  const [deliveryRecipients, setDeliveryRecipients] = useState<Record<string, string>>({});
  const [taxSettings, setTaxSettings] = useState<Record<string, { taxMode: PurchasePriceTaxMode; vatRate: string }>>({});
  const [discountSettings, setDiscountSettings] = useState<Record<string, { discountType: PurchaseDiscountType; discountValue: string }>>({});
  const [isPending, setIsPending] = useState(false);
  const [saveStarted, setSaveStarted] = useState(false);
  const [preview, setPreview] = useState<{ result: PurchaseOrderCreationPreview; payloadJson: string } | null>(null);
  const saving = (isPending || router.isPending) && saveStarted;
  const busy = isPending || router.isPending;
  const [isRefreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [showSupplierErrors, setShowSupplierErrors] = useState(false);
  const [showItemErrors, setShowItemErrors] = useState(false);
  const pendingRef = useRef(false);
  const composingItems = useRef(new Set<string>());
  const supplierInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const sourceItems = new Map(sourceLines.map((item) => [item.id, item]));
  const itemsChanged = items.length !== sourceLines.length || items.some((item, index) => {
    const source = sourceLines[index];
    if (!source || item.sourceItemId !== source.id) return true;
    const normalized = normalizedItem(item);
    return normalized.itemName !== source.itemName.trim()
      || (normalized.description ?? "") !== (source.description ?? "").trim()
      || normalized.quantity !== source.quantity
      || (normalized.unit ?? "") !== (source.unit ?? "").trim()
      || normalized.unitPrice !== (source.unitPrice ?? 0)
      || normalized.taxMode !== (source.taxMode && source.taxMode !== "UNSPECIFIED" ? source.taxMode : null)
      || item.discountType !== (source.discountType ?? "NONE")
      || (item.discountType === "NONE" ? 0 : Number(item.discountValue)) !== (source.discountValue ?? 0);
  });
  const draftValues = new Map(items.map((item) => [item.clientId, itemValues(item, sourceItems.get(item.sourceItemId ?? item.clientId))] as const));
  const amounts = new Map(items.map((item) => {
    const values = draftValues.get(item.clientId)!;
    return [item.clientId, values.validAmount ? values.amountCents / 100 : 0] as const;
  }));
  const selectedItems = items.filter((item) => selectedIds.has(item.clientId));
  const totalCents = selectedItems.reduce((total, item) => total + draftValues.get(item.clientId)!.amountCents, 0);
  const groupedItems = new Map<string, { supplierName: string; supplier?: SupplierDetail; items: EditableItem[] }>();
  for (const item of selectedItems) {
    const supplier = supplierById.get(supplierIds[item.clientId] ?? "");
    if (supplierIds[item.clientId] && (!supplier || !supplier.isActive)) continue;
    const supplierName = supplier?.name ?? (supplierNames[item.clientId] ?? "").trim();
    if (!supplierName) continue;
    const key = supplier ? `supplier:${supplier.id}` : `manual:${supplierName.normalize("NFKC").toLowerCase()}`;
    const group = groupedItems.get(key);
    if (group) group.items.push(item);
    else groupedItems.set(key, { supplierName, supplier, items: [item] });
  }
  const groups = [...groupedItems.entries()];
  function deliveryRecipientFor(key: string, group: { items: EditableItem[] }) {
    if (deliveryRecipients[key] !== undefined) return deliveryRecipients[key];
    const requesterId = sourceById.get(group.items[0]!.sourcePurchaseRequestId)?.requester.id;
    return recipients.some((recipient) => recipient.id === requesterId) ? requesterId! : "";
  }
  const groupTotals = new Map(groups.map(([key, group]) => {
    const settings = taxSettings[key] ?? { taxMode: "UNSPECIFIED" as const, vatRate: "7" };
    const rate = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(settings.vatRate.trim()) ? Number(settings.vatRate) : Number.NaN;
    try {
      return [key, calculatePurchaseOrderPricing(group.items.map((item) => ({ amount: amounts.get(item.clientId) ?? 0, taxMode: item.taxMode, discountType: item.discountType, discountValue: item.discountValue })), settings.taxMode, rate, discountSettings[key])] as const;
    } catch { return [key, null] as const; }
  }));
  const assignedItemIds = new Set(groups.flatMap(([, group]) => group.items.map((item) => item.clientId)));
  const unassignedTotals = selectedItems.filter((item) => !assignedItemIds.has(item.clientId)).map((item) => {
    try {
      return calculatePurchaseOrderPricing([{ amount: amounts.get(item.clientId) ?? 0, taxMode: item.taxMode, discountType: item.discountType, discountValue: item.discountValue }], "UNSPECIFIED", 7);
    } catch { return null; }
  });
  const pricingTotals = [...groupTotals.values(), ...unassignedTotals];
  const validTaxTotals = pricingTotals.every(Boolean);
  const totalAmount = pricingTotals.reduce((total, pricing) => total + Math.round((pricing?.totalAmount ?? 0) * 100), 0) / 100;

  function groupDiscountError(key: string, group: { items: EditableItem[] }) {
    const discount = discountSettings[key] ?? { discountType: "NONE", discountValue: "0" };
    let eligibleCents: number | undefined;
    try {
      const remaining = calculatePurchaseOrderPricing(group.items.map((item) => ({ amount: amounts.get(item.clientId) ?? 0, taxMode: "NONE" as const, discountType: item.discountType, discountValue: item.discountValue })), "NONE", 0);
      eligibleCents = Math.round(remaining.discountedSubtotalAmount * 100);
    } catch { /* Item validation reports an invalid line before its order discount. */ }
    return discountDraftError(discount.discountType as PurchaseDiscountType, discount.discountValue, eligibleCents);
  }

  function updateItem(clientId: string, field: keyof Omit<EditableItem, "clientId" | "sourceItemId">, value: string) {
    setItems((current) => current.map((item) => item.clientId === clientId ? { ...item, [field]: value } : item));
    setError(null);
  }

  function addItem() {
    if (pendingRef.current || items.length >= MAX_ITEMS) return;
    const clientId = `new-${crypto.randomUUID()}`;
    setItems((current) => [...current, {
      clientId, sourcePurchaseRequestId: sourceRequest.id, itemName: "", description: "", quantity: "1", unit: "", unitPrice: "0", taxMode: null, discountType: "NONE", discountValue: "0",
    }]);
    setSelectedIds((current) => new Set([...current, clientId]));
    setAssignments((current) => ({ ...current, [clientId]: { supplierId: "", name: "" } }));
    setError(null);
  }

  function removeItem(clientId: string) {
    if (pendingRef.current || items.length <= 1) return;
    setItems((current) => current.filter((item) => item.clientId !== clientId));
    setSelectedIds((current) => new Set([...current].filter((id) => id !== clientId)));
    setAssignments((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== clientId)));
    composingItems.current.delete(clientId);
    delete supplierInputs.current[clientId];
    setError(null);
  }

  function showItemError(message: string, fieldId?: string) {
    setShowItemErrors(true);
    setError(message);
    if (fieldId) document.getElementById(fieldId)?.focus();
  }

  function updateHeader(key: string, field: keyof OrderHeaders, value: string) {
    setHeaders((current) => ({
      ...current,
      [key]: { ...emptyHeaders, ...current[key], [field]: value },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || pendingRef.current || router.isPending || composingItems.current.size || hasConflict) return;
    if (!selectedItems.length) {
      showItemError(dictionary.poCombined.selectionRequired);
      return;
    }
    for (const item of items) {
      if (!item.itemName.trim()) {
        showItemError(labels.itemNameRequired, `po-item-name-${item.clientId}`);
        return;
      }
      const values = draftValues.get(item.clientId)!;
      if (!values.validQuantity) {
        showItemError(labels.quantityInvalid, `po-item-quantity-${item.clientId}`);
        return;
      }
      if (!values.validPrice) {
        showItemError(labels.priceInvalid, `po-item-unit-price-${item.clientId}`);
        return;
      }
      if (!values.validAmount) {
        showItemError(labels.amountTooLarge, `po-item-unit-price-${item.clientId}`);
        return;
      }
      const invalidDiscount = discountDraftError(item.discountType, item.discountValue, values.amountCents);
      if (invalidDiscount) {
        showItemError(dictionary.poDiscount[invalidDiscount], `po-item-discount-value-${item.clientId}`);
        return;
      }
    }
    if (!Number.isSafeInteger(totalCents) || totalCents > MAX_AMOUNT_CENTS || totalAmount > MAX_AMOUNT_CENTS / 100) {
      showItemError(labels.amountTooLarge);
      return;
    }
    if (selectedItems.some((item) => supplierIds[item.clientId] && !supplierById.get(supplierIds[item.clientId])?.isActive)) {
      setError(dictionary.suppliers.unavailable);
      return;
    }
    const unassigned = selectedItems.find((item) => !supplierIds[item.clientId] && !(supplierNames[item.clientId] ?? "").trim());
    if (unassigned) {
      setShowSupplierErrors(true);
      setError(labels.supplierRequired);
      supplierInputs.current[unassigned.clientId]?.focus();
      return;
    }
    for (const [index, [key, group]] of groups.entries()) {
      const invalidDiscount = groupDiscountError(key, group);
      if (invalidDiscount) {
        showItemError(dictionary.poDiscount[invalidDiscount], `po-group-${index}-discount-value`);
        return;
      }
    }
    const invalidTaxGroup = groups.find(([key]) => !groupTotals.get(key));
    if (invalidTaxGroup) {
      const settings = taxSettings[invalidTaxGroup[0]];
      const validRate = settings && /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(settings.vatRate.trim()) && Number(settings.vatRate) >= 0 && Number(settings.vatRate) <= 100;
      showItemError(validRate ? labels.amountTooLarge : dictionary.poTax.rateInvalid, `po-group-${groups.findIndex(([key]) => key === invalidTaxGroup[0])}-vat-rate`);
      return;
    }
    pendingRef.current = true;
    setSaveStarted(false);
    setIsPending(true);
    setError(null);
    try {
      // Keep the reviewed payload immutable while the preview is displayed.
      const payloadJson = JSON.stringify({
          ...(isCombined ? { requests: sourceRequests.map((source) => ({ id: source.id, expectedUpdatedAt: source.orderPreparationVersion ?? source.updatedAt })) } : { expectedUpdatedAt: sourceRequest.orderPreparationVersion ?? sourceRequest.updatedAt }),
          ...(itemsChanged ? { items: items.map((item) => normalizedItem(item, isCombined)) } : {}),
          orders: groups.map(([key, group]) => ({
            ...(group.supplier ? { supplierId: group.supplier.id } : { supplierName: group.supplierName }),
            deliveryRecipientId: deliveryRecipientFor(key, group) || null,
            itemIds: group.items.map((item) => item.clientId),
            taxMode: taxSettings[key]?.taxMode ?? "UNSPECIFIED",
            vatRate: Number(taxSettings[key]?.vatRate ?? "7"),
            ...(discountSettings[key]?.discountType && discountSettings[key]?.discountType !== "NONE" ? { discountType: discountSettings[key]!.discountType, discountValue: Number(discountSettings[key]!.discountValue) } : {}),
            ...Object.fromEntries(Object.entries(headers[key] ?? emptyHeaders)
              .filter(([field, value]) => value.trim() && (!group.supplier || ["deliveryAddress", "expectedDeliveryDate", "note"].includes(field)))
              .map(([field, value]) => [field, value.trim()])),
          })),
        });
      const response = await fetch(isCombined ? "/api/purchase-orders/preview" : `/api/purchase-requests/${request.id}/purchase-orders/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payloadJson,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) {
          setHasConflict(true);
          setError(null);
        } else {
          setError(translateMessage(payload?.error, locale) ?? previewLabels.error);
        }
        return;
      }
      if (!payload || !/^[a-f0-9]{64}$/.test(payload.previewFingerprint) || !Array.isArray(payload.orders) || !payload.orders.length) {
        setError(previewLabels.error);
        return;
      }
      setPreview({ result: payload as PurchaseOrderCreationPreview, payloadJson });
    } catch {
      setError(previewLabels.error);
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  function returnToPreparation(message: string | null = null) {
    setPreview(null);
    setError(message);
    setSaveStarted(false);
    requestAnimationFrame(() => previewButtonRef.current?.focus());
  }

  async function confirmCreate() {
    if (!preview || pendingRef.current || router.isPending || hasConflict) return;
    pendingRef.current = true;
    setSaveStarted(true);
    setIsPending(true);
    setError(null);
    try {
      const capturedPayload = JSON.parse(preview.payloadJson) as Record<string, unknown>;
      const response = await fetch(isCombined ? "/api/purchase-orders" : `/api/purchase-requests/${request.id}/purchase-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...capturedPayload, previewFingerprint: preview.result.previewFingerprint }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setSaveStarted(false);
        if (response.status === 409 && payload?.code === "PO_PREVIEW_CHANGED") {
          returnToPreparation(previewLabels.changed);
        } else if (response.status === 409) {
          returnToPreparation();
          setHasConflict(true);
        } else {
          setError(translateMessage(payload?.error, locale) ?? labels.createError);
        }
        return;
      }
      toast.success(labels.createSuccess);
      router.push(isCombined && payload?.purchaseOrders?.[0]?.id ? `/purchase-orders/${payload.purchaseOrders[0].id}` : `/purchase-requests/${request.id}`);
      router.refresh();
    } catch {
      setSaveStarted(false);
      setError(labels.createError);
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  if (preview) {
    return <PurchaseOrderCreationPreviewStep preview={preview.result} busy={busy} confirming={saving} error={error}
      onBack={() => { if (!pendingRef.current && !router.isPending) returnToPreparation(); }}
      onConfirm={() => void confirmCreate()} />;
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="min-w-0 space-y-6" onKeyDown={(event) => {
      if (event.key === "Enter" && event.keyCode === 229 && !event.nativeEvent.isComposing) event.preventDefault();
    }}>
      <Card className="overflow-visible border-border/70">
        <CardHeader>
          <CardTitle>{labels.allocationTitle}</CardTitle>
          <CardDescription>{labels.allocationDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <p className="text-sm leading-6">{dictionary.poCombined.selectionHint}</p>
            <p className="text-xs text-muted-foreground">{dictionary.poCombined.wholeRowHint}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span id="po-selected-count" className="mr-auto text-sm font-medium">{dictionary.poCombined.selected}: {formatNumber(selectedItems.length, locale)} / {formatNumber(items.length, locale)}</span>
              <Button id="select-all-po-items" type="button" variant="outline" size="sm" disabled={busy || !mounted} onClick={() => setSelectedIds(new Set(items.map((item) => item.clientId)))}>{dictionary.poCombined.selectAll}</Button>
              <Button id="clear-po-item-selection" type="button" variant="outline" size="sm" disabled={busy || !mounted} onClick={() => setSelectedIds(new Set())}>{dictionary.poCombined.clearSelection}</Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{labels.editableItemsHint}</p>
          <p className="text-sm text-muted-foreground">{dictionary.suppliers.registryHint}</p>
          {!suppliers.length ? <p className="text-sm text-muted-foreground">{dictionary.suppliers.noRegistered}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button id="manage-suppliers" type="button" variant="outline" disabled={busy || !mounted} onClick={() => router.push("/suppliers")}>{dictionary.suppliers.manage}</Button>
            <Button id="refresh-po-suppliers" type="button" variant="outline" disabled={busy || isRefreshing || !mounted} loading={isRefreshing} aria-busy={isRefreshing} onClick={() => startRefresh(() => router.refresh())}>{isRefreshing ? dictionary.common.loading : dictionary.suppliers.refresh}</Button>
          </div>
          <div role="note" aria-labelledby="po-same-supplier-title" className="space-y-2 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
            <p id="po-same-supplier-title" className="font-semibold text-primary">{labels.sameSupplierTitle}</p>
            <p>{labels.sameSupplierHelp}</p>
            <p className="text-muted-foreground">{labels.sameSupplierExample}</p>
          </div>
          {items.map((item, index) => {
            const values = draftValues.get(item.clientId)!;
            const invalidName = showItemErrors && !item.itemName.trim();
            const invalidQuantity = showItemErrors && !values.validQuantity;
            const invalidPrice = showItemErrors && !values.validPrice;
            const invalidAmount = showItemErrors && !values.validAmount;
            return (
              <div
                key={item.clientId}
                data-po-item={item.clientId}
                className="min-w-0 space-y-4 rounded-2xl border border-border/70 p-4"
                onCompositionStart={() => composingItems.current.add(item.clientId)}
                onCompositionEnd={() => composingItems.current.delete(item.clientId)}
              >
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`select-po-item-${item.clientId}`} className="flex min-w-0 items-center gap-3">
                    <input id={`select-po-item-${item.clientId}`} type="checkbox" className="size-4 shrink-0 accent-primary" checked={selectedIds.has(item.clientId)} disabled={busy || !mounted} onChange={(event) => {
                      setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.clientId); else next.delete(item.clientId); return next; });
                      setError(null);
                    }} />
                    <span className="min-w-0 text-sm font-medium">{dictionary.poCombined.selectItem} · {index + 1}<span className="mt-1 block text-xs font-normal text-muted-foreground">{sourceById.get(item.sourcePurchaseRequestId)?.prNumber}</span></span>
                  </Label>
                  <Button
                    id={`remove-po-item-${item.clientId}`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive hover:text-destructive"
                    disabled={busy || !mounted || items.length <= 1}
                    title={items.length <= 1 ? labels.minimumItems : undefined}
                    aria-label={`${labels.removeItem}: ${item.itemName || index + 1}`}
                    onClick={() => removeItem(item.clientId)}
                  >
                    <Trash2 className="size-4" />{labels.removeItem}
                  </Button>
                </div>
                {isCombined && !item.sourceItemId ? <div className="space-y-2">
                  <Label htmlFor={`po-item-source-${item.clientId}`}>{dictionary.poCombined.newItemSource}</Label>
                  <select id={`po-item-source-${item.clientId}`} className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm" value={item.sourcePurchaseRequestId} disabled={busy || !mounted} onChange={(event) => updateItem(item.clientId, "sourcePurchaseRequestId", event.target.value)}>
                    {sourceRequests.map((source) => <option key={source.id} value={source.id}>{source.prNumber} · {source.department}</option>)}
                  </select>
                </div> : null}
                <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                  <div className="min-w-0 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor={`po-item-name-${item.clientId}`}>{labels.itemName}</Label>
                      <Input
                        id={`po-item-name-${item.clientId}`}
                        required
                        maxLength={200}
                        disabled={busy || !mounted}
                        value={item.itemName}
                        aria-invalid={invalidName}
                        aria-describedby={invalidName ? `po-item-name-error-${item.clientId}` : undefined}
                        onChange={(event) => updateItem(item.clientId, "itemName", event.target.value)}
                      />
                      {invalidName ? <p id={`po-item-name-error-${item.clientId}`} className="text-sm text-destructive">{labels.itemNameRequired}</p> : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`po-item-description-${item.clientId}`}>{labels.description}</Label>
                      <Textarea
                        id={`po-item-description-${item.clientId}`}
                        className="min-w-0 [overflow-wrap:anywhere]"
                        maxLength={2000}
                        disabled={busy || !mounted}
                        value={item.description}
                        onChange={(event) => updateItem(item.clientId, "description", event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="min-w-0 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor={`po-supplier-${item.clientId}`} className="break-words [overflow-wrap:anywhere]">{labels.supplierName} · {item.itemName || `${labels.itemName} ${index + 1}`}</Label>
                      <SupplierCombobox
                        inputRef={(element) => { supplierInputs.current[item.clientId] = element; }}
                        id={`po-supplier-${item.clientId}`}
                        disabled={busy || !mounted}
                        invalid={showSupplierErrors && !supplierIds[item.clientId] && !(supplierNames[item.clientId] ?? "").trim()}
                        selectedSupplierId={supplierIds[item.clientId]}
                        suppliers={suppliers}
                        value={supplierById.get(supplierIds[item.clientId] ?? "")?.name ?? supplierNames[item.clientId] ?? ""}
                        onChange={(name) => setAssignments((current) => ({ ...current, [item.clientId]: { supplierId: "", name } }))}
                        onSelect={(supplier) => setAssignments((current) => ({ ...current, [item.clientId]: { supplierId: supplier.id, name: supplier.name } }))}
                        onCompositionChange={(composing) => { if (composing) composingItems.current.add(item.clientId); else composingItems.current.delete(item.clientId); }}
                      />
                    </div>
                    <div className="grid min-w-0 grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor={`po-item-quantity-${item.clientId}`}>{labels.quantity}</Label>
                        <Input
                          id={`po-item-quantity-${item.clientId}`}
                          inputMode="numeric"
                          required
                          disabled={busy || !mounted}
                          value={item.quantity}
                          aria-invalid={invalidQuantity}
                          aria-describedby={invalidQuantity ? `po-item-quantity-error-${item.clientId}` : undefined}
                          onChange={(event) => updateItem(item.clientId, "quantity", event.target.value)}
                        />
                        {invalidQuantity ? <p id={`po-item-quantity-error-${item.clientId}`} className="text-sm text-destructive">{labels.quantityInvalid}</p> : null}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`po-item-unit-${item.clientId}`}>{labels.unit}</Label>
                        <Input id={`po-item-unit-${item.clientId}`} maxLength={50} disabled={busy || !mounted} value={item.unit} onChange={(event) => updateItem(item.clientId, "unit", event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`po-item-unit-price-${item.clientId}`}>{labels.unitPrice}</Label>
                        <Input
                          id={`po-item-unit-price-${item.clientId}`}
                          inputMode="decimal"
                          required
                          disabled={busy || !mounted}
                          value={item.unitPrice}
                          aria-invalid={invalidPrice || invalidAmount}
                          aria-describedby={invalidPrice || invalidAmount ? `po-item-price-error-${item.clientId}` : undefined}
                          onChange={(event) => updateItem(item.clientId, "unitPrice", event.target.value)}
                        />
                        {invalidPrice || invalidAmount ? <p id={`po-item-price-error-${item.clientId}`} className="text-sm text-destructive">{invalidPrice ? labels.priceInvalid : labels.amountTooLarge}</p> : null}
                      </div>
                      <div className="min-w-0 space-y-2">
                        <p className="text-sm font-medium">{labels.lineTotal}</p>
                        <p id={`po-item-total-${item.clientId}`} className="break-words py-1 text-sm font-semibold [overflow-wrap:anywhere]">{formatCurrency(amounts.get(item.clientId) ?? 0, locale)}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`po-item-tax-mode-${item.clientId}`}>{dictionary.poTax.itemMode}</Label>
                      <PurchaseOrderItemTaxSelect id={`po-item-tax-mode-${item.clientId}`} value={item.taxMode} disabled={busy || !mounted} onChange={(mode) => {
                        setItems((current) => current.map((entry) => entry.clientId === item.clientId ? { ...entry, taxMode: mode } : entry));
                        setError(null);
                      }} />
                    </div>
                    <PurchaseOrderDiscountFields typeId={`po-item-discount-type-${item.clientId}`} valueId={`po-item-discount-value-${item.clientId}`} title={dictionary.poDiscount.lineTitle} discountType={item.discountType} discountValue={item.discountValue} disabled={busy || !mounted}
                      error={showItemErrors && discountDraftError(item.discountType, item.discountValue, values.amountCents) ? dictionary.poDiscount[discountDraftError(item.discountType, item.discountValue, values.amountCents)!] : undefined}
                      onTypeChange={(type) => { setItems((current) => current.map((entry) => entry.clientId === item.clientId ? { ...entry, discountType: type, discountValue: type === "NONE" ? "0" : entry.discountValue } : entry)); setError(null); }}
                      onValueChange={(value) => { setItems((current) => current.map((entry) => entry.clientId === item.clientId ? { ...entry, discountValue: value } : entry)); setError(null); }} />
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button id="add-po-item" type="button" variant="outline" disabled={busy || !mounted || items.length >= MAX_ITEMS} onClick={addItem}>
              <Plus className="size-4" />{labels.addItem}
            </Button>
            <p className="text-sm text-muted-foreground">{items.length >= MAX_ITEMS ? labels.itemLimit : labels.minimumItems}</p>
          </div>
          {itemsChanged ? <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-primary">{labels.itemsChangedSummary}</p> : null}
        </CardContent>
      </Card>

      {groups.map(([key, group], index) => {
        const fields = group.supplier ? {
          ...emptyHeaders, ...headers[key],
          supplierAddress: group.supplier.address ?? "",
          supplierContact: group.supplier.contactPerson ?? "",
          paymentTerms: group.supplier.paymentTerms ?? "",
        } : headers[key] ?? emptyHeaders;
        return (
          <Card key={key} className="min-w-0 border-border/70">
            <CardHeader>
              <CardTitle className="break-words [overflow-wrap:anywhere]">{labels.supplierName}: {group.supplierName}</CardTitle>
              <CardDescription>{labels.groupDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <PurchaseOrderTaxFields idPrefix={`po-group-${index}`} taxMode={taxSettings[key]?.taxMode ?? "UNSPECIFIED"} vatRate={taxSettings[key]?.vatRate ?? "7"} disabled={busy || !mounted}
                onTaxModeChange={(mode) => setTaxSettings((current) => ({ ...current, [key]: { taxMode: mode, vatRate: current[key]?.vatRate ?? "7" } }))}
                onVatRateChange={(rate) => setTaxSettings((current) => ({ ...current, [key]: { taxMode: current[key]?.taxMode ?? "UNSPECIFIED", vatRate: rate } }))}
                onApplyAll={() => setItems((current) => current.map((item) => group.items.some((entry) => entry.clientId === item.clientId) ? { ...item, taxMode: null } : item))} />
              <div className="space-y-2 rounded-xl border border-border/70 p-4">
                <PurchaseOrderDiscountFields typeId={`po-group-${index}-discount-type`} valueId={`po-group-${index}-discount-value`} title={dictionary.poDiscount.orderTitle} discountType={discountSettings[key]?.discountType ?? "NONE"} discountValue={discountSettings[key]?.discountValue ?? "0"} disabled={busy || !mounted}
                  error={showItemErrors && groupDiscountError(key, group) ? dictionary.poDiscount[groupDiscountError(key, group)!] : undefined}
                  onTypeChange={(type) => { setDiscountSettings((current) => ({ ...current, [key]: { discountType: type, discountValue: type === "NONE" ? "0" : current[key]?.discountValue ?? "0" } })); setError(null); }}
                  onValueChange={(value) => { setDiscountSettings((current) => ({ ...current, [key]: { discountType: current[key]?.discountType ?? "NONE", discountValue: value } })); setError(null); }} />
                <p className="text-xs leading-5 text-muted-foreground">{dictionary.poDiscount.basisHint}</p>
                <p className="text-xs leading-5 text-muted-foreground">{dictionary.poDiscount.orderHint}</p>
              </div>
              {group.supplier ? <div id={`po-supplier-contacts-${index}`} className="space-y-1 rounded-xl border border-border/70 p-3 text-sm">
                <p className="break-words [overflow-wrap:anywhere] font-medium">{group.supplier.code} · {group.supplier.name}</p>
                {group.supplier.taxId ? <p>{dictionary.suppliers.taxId}: {group.supplier.taxId}</p> : null}
                {group.supplier.contacts.map((contact) => <p key={contact.channel} className="break-words">{dictionary.suppliers[contact.channel]}: {contact.value}</p>)}
              </div> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`po-supplier-address-${index}`}>{labels.supplierAddress}</Label>
                  <Textarea id={`po-supplier-address-${index}`} maxLength={2000} disabled={busy || !mounted} readOnly={Boolean(group.supplier)} value={fields.supplierAddress} onChange={(event) => updateHeader(key, "supplierAddress", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-supplier-contact-${index}`}>{labels.supplierContact}</Label>
                  <Input id={`po-supplier-contact-${index}`} maxLength={200} disabled={busy || !mounted} readOnly={Boolean(group.supplier)} value={fields.supplierContact} onChange={(event) => updateHeader(key, "supplierContact", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-delivery-address-${index}`}>{labels.deliveryAddress}</Label>
                  <Textarea id={`po-delivery-address-${index}`} maxLength={2000} disabled={busy || !mounted} value={fields.deliveryAddress} onChange={(event) => updateHeader(key, "deliveryAddress", event.target.value)} />
                </div>
                <DeliveryRecipientSelect id={`po-delivery-recipient-${index}`} recipients={recipients} value={deliveryRecipientFor(key, group)} disabled={busy || !mounted}
                  onChange={(value) => { setDeliveryRecipients((current) => ({ ...current, [key]: value })); setError(null); }} />
                <div className="space-y-2">
                  <Label htmlFor={`po-payment-terms-${index}`}>{labels.paymentTerms}</Label>
                  <Textarea id={`po-payment-terms-${index}`} maxLength={500} disabled={busy || !mounted} readOnly={Boolean(group.supplier)} value={fields.paymentTerms} onChange={(event) => updateHeader(key, "paymentTerms", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-expected-delivery-date-${index}`}>{labels.expectedDeliveryDate}</Label>
                  <Input id={`po-expected-delivery-date-${index}`} type="date" disabled={busy || !mounted} value={fields.expectedDeliveryDate} onChange={(event) => updateHeader(key, "expectedDeliveryDate", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-note-${index}`}>{labels.note}</Label>
                  <Textarea id={`po-note-${index}`} maxLength={2000} disabled={busy || !mounted} value={fields.note} onChange={(event) => updateHeader(key, "note", event.target.value)} />
                </div>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>{dictionary.purchaseRequests.itemList}</TableHead>
                  <TableHead className="text-right">{dictionary.purchaseRequests.quantityUnit}</TableHead>
                  <TableHead className="text-right">{dictionary.purchaseRequests.unitPrice}</TableHead>
                  <TableHead className="text-right">{dictionary.purchaseRequests.lineTotal}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {group.items.map((item) => {
                    const values = draftValues.get(item.clientId)!;
                    return <TableRow key={item.clientId}>
                      <TableCell className="max-w-64 whitespace-normal break-words [overflow-wrap:anywhere]">{item.itemName}{isCombined ? <span className="mt-1 block text-xs text-muted-foreground">{sourceById.get(item.sourcePurchaseRequestId)?.prNumber}</span> : null}</TableCell>
                      <TableCell className="text-right">{formatNumber(values.validQuantity ? values.quantity : 0, locale)} {item.unit ? getUnitLabel(item.unit, locale) : ""}</TableCell>
                      <TableCell className="text-right">{formatCurrency(values.validPrice ? values.unitPriceCents / 100 : 0, locale)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(amounts.get(item.clientId) ?? 0, locale)}</TableCell>
                    </TableRow>;
                  })}
                </TableBody>
              </Table>
              <PurchaseOrderTaxSummary items={group.items.map((item) => ({ amount: amounts.get(item.clientId) ?? 0, taxMode: item.taxMode, discountType: item.discountType, discountValue: item.discountValue }))} taxMode={taxSettings[key]?.taxMode ?? "UNSPECIFIED"} vatRate={Number(taxSettings[key]?.vatRate ?? "7")} discountType={discountSettings[key]?.discountType ?? "NONE"} discountValue={discountSettings[key]?.discountValue ?? "0"} totalId={`po-group-${index}-total`} />
            </CardContent>
          </Card>
        );
      })}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {hasConflict ? <div role="alert" className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm text-destructive">{labels.preparationConflict}</p>
        <Button id="reload-po-preparation" type="button" variant="outline" onClick={() => window.location.reload()}>{labels.reloadPreparation}</Button>
      </div> : null}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{labels.batchSummary}: {groups.length}</p>
          <p id="po-preparation-total" className="break-words font-semibold [overflow-wrap:anywhere]">{dictionary.poTax.totalAmount}: {validTaxTotals ? formatCurrency(totalAmount, locale) : "—"}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" disabled={busy || !mounted} onClick={() => router.push(`/purchase-requests/${request.id}`)}>{labels.backToRequest}</Button>
          <Button ref={previewButtonRef} id="create-purchase-orders" type="submit" loading={isPending} disabled={busy || !mounted || hasConflict} aria-busy={isPending}>
            {!isPending ? <Eye /> : null}{isPending ? previewLabels.previewing : previewLabels.preview}
          </Button>
        </div>
      </div>
    </form>
  );
}
