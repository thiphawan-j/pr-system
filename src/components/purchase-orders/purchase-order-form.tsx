"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { SupplierCombobox } from "@/components/suppliers/supplier-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatNumber } from "@/lib/format";
import { getUnitLabel, translateMessage } from "@/lib/i18n";
import type { PurchaseRequestDetail, SupplierDetail } from "@/lib/types";

type OrderHeaders = {
  supplierAddress: string;
  supplierContact: string;
  deliveryAddress: string;
  paymentTerms: string;
  expectedDeliveryDate: string;
  note: string;
};

const emptyHeaders: OrderHeaders = {
  supplierAddress: "", supplierContact: "", deliveryAddress: "",
  paymentTerms: "", expectedDeliveryDate: "", note: "",
};

export function PurchaseOrderForm({ request, suppliers = [] }: { request: PurchaseRequestDetail; suppliers?: SupplierDetail[] }) {
  const router = useRouter();
  const { dictionary, locale } = useI18n();
  const labels = dictionary.purchaseOrders;
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [assignments, setAssignments] = useState<Record<string, { supplierId: string; name: string }>>(() =>
    Object.fromEntries(request.items.map((item) => [item.id, { supplierId: "", name: item.supplierName ?? "" }])),
  );
  const supplierIds = Object.fromEntries(Object.entries(assignments).map(([id, assignment]) => [id, assignment.supplierId]));
  const supplierNames = Object.fromEntries(Object.entries(assignments).map(([id, assignment]) => [id, assignment.name]));
  const [headers, setHeaders] = useState<Record<string, OrderHeaders>>({});
  const [isPending, setIsPending] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showSupplierErrors, setShowSupplierErrors] = useState(false);
  const pendingRef = useRef(false);
  const composingItems = useRef(new Set<string>());
  const supplierInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const groupedItems = new Map<string, { supplierName: string; supplier?: SupplierDetail; items: PurchaseRequestDetail["items"] }>();
  for (const item of request.items) {
    const supplier = supplierById.get(supplierIds[item.id] ?? "");
    if (supplierIds[item.id] && (!supplier || !supplier.isActive)) continue;
    const supplierName = supplier?.name ?? (supplierNames[item.id] ?? "").trim();
    if (!supplierName) continue;
    const key = supplier ? `supplier:${supplier.id}` : `manual:${supplierName.normalize("NFKC").toLowerCase()}`;
    const group = groupedItems.get(key);
    if (group) group.items.push(item);
    else groupedItems.set(key, { supplierName, supplier, items: [item] });
  }
  const groups = [...groupedItems.entries()];

  function updateHeader(key: string, field: keyof OrderHeaders, value: string) {
    setHeaders((current) => ({
      ...current,
      [key]: { ...emptyHeaders, ...current[key], [field]: value },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || composingItems.current.size) return;
    if (request.items.some((item) => supplierIds[item.id] && !supplierById.get(supplierIds[item.id])?.isActive)) {
      setError(dictionary.suppliers.unavailable);
      return;
    }
    const unassigned = request.items.find((item) => !supplierIds[item.id] && !(supplierNames[item.id] ?? "").trim());
    if (unassigned) {
      setShowSupplierErrors(true);
      setError(labels.supplierRequired);
      supplierInputs.current[unassigned.id]?.focus();
      return;
    }
    pendingRef.current = true;
    setIsPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/purchase-requests/${request.id}/purchase-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orders: groups.map(([key, group]) => ({
            ...(group.supplier ? { supplierId: group.supplier.id } : { supplierName: group.supplierName }),
            itemIds: group.items.map((item) => item.id),
            ...Object.fromEntries(Object.entries(headers[key] ?? emptyHeaders)
              .filter(([field, value]) => value.trim() && (!group.supplier || ["deliveryAddress", "expectedDeliveryDate", "note"].includes(field)))
              .map(([field, value]) => [field, value.trim()])),
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(translateMessage(payload?.error, locale) ?? labels.createError);
        if (response.status === 409) router.refresh();
        return;
      }
      toast.success(labels.createSuccess);
      router.push(`/purchase-requests/${request.id}`);
      router.refresh();
    } catch {
      setError(labels.createError);
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="overflow-visible border-border/70">
        <CardHeader>
          <CardTitle>{labels.allocationTitle}</CardTitle>
          <CardDescription>{labels.allocationDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{labels.fixedPrices}</p>
          <p className="text-sm text-muted-foreground">{dictionary.suppliers.registryHint}</p>
          {!suppliers.length ? <p className="text-sm text-muted-foreground">{dictionary.suppliers.noRegistered}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button id="manage-suppliers" type="button" variant="outline" disabled={isPending || !mounted} onClick={() => router.push("/suppliers")}>{dictionary.suppliers.manage}</Button>
            <Button id="refresh-po-suppliers" type="button" variant="outline" disabled={isPending || isRefreshing || !mounted} aria-busy={isRefreshing} onClick={() => startRefresh(() => router.refresh())}>{isRefreshing ? dictionary.common.loading : dictionary.suppliers.refresh}</Button>
          </div>
          {request.items.map((item) => (
            <div key={item.id} className="grid gap-4 rounded-2xl border border-border/70 p-4 sm:grid-cols-2">
              <div>
                <p className="font-medium">{item.itemName}</p>
                {item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}
                <p className="mt-2 text-sm text-muted-foreground">
                  {formatNumber(item.quantity, locale)} {item.unit ? getUnitLabel(item.unit, locale) : ""} × {formatCurrency(item.unitPrice ?? 0, locale)} = {formatCurrency(item.amount, locale)}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`po-supplier-${item.id}`}>{labels.supplierName} · {item.itemName}</Label>
                <SupplierCombobox
                  inputRef={(element) => { supplierInputs.current[item.id] = element; }}
                  id={`po-supplier-${item.id}`}
                  disabled={isPending || !mounted}
                  invalid={showSupplierErrors && !supplierIds[item.id] && !(supplierNames[item.id] ?? "").trim()}
                  selectedSupplierId={supplierIds[item.id]}
                  suppliers={suppliers}
                  value={supplierById.get(supplierIds[item.id] ?? "")?.name ?? supplierNames[item.id] ?? ""}
                  onChange={(name) => setAssignments((current) => ({ ...current, [item.id]: { supplierId: "", name } }))}
                  onSelect={(supplier) => setAssignments((current) => ({ ...current, [item.id]: { supplierId: supplier.id, name: supplier.name } }))}
                  onCompositionChange={(composing) => { if (composing) composingItems.current.add(item.id); else composingItems.current.delete(item.id); }}
                />
              </div>
            </div>
          ))}
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
          <Card key={key} className="border-border/70">
            <CardHeader>
              <CardTitle>{labels.supplierName}: {group.supplierName}</CardTitle>
              <CardDescription>{labels.groupDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {group.supplier ? <div id={`po-supplier-contacts-${index}`} className="space-y-1 rounded-xl border border-border/70 p-3 text-sm">
                <p className="font-medium">{group.supplier.code} · {group.supplier.name}</p>
                {group.supplier.taxId ? <p>{dictionary.suppliers.taxId}: {group.supplier.taxId}</p> : null}
                {group.supplier.contacts.map((contact) => <p key={contact.channel} className="break-words">{dictionary.suppliers[contact.channel]}: {contact.value}</p>)}
              </div> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`po-supplier-address-${index}`}>{labels.supplierAddress}</Label>
                  <Textarea id={`po-supplier-address-${index}`} maxLength={2000} disabled={isPending || !mounted} readOnly={Boolean(group.supplier)} value={fields.supplierAddress} onChange={(event) => updateHeader(key, "supplierAddress", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-supplier-contact-${index}`}>{labels.supplierContact}</Label>
                  <Input id={`po-supplier-contact-${index}`} maxLength={200} disabled={isPending || !mounted} readOnly={Boolean(group.supplier)} value={fields.supplierContact} onChange={(event) => updateHeader(key, "supplierContact", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-delivery-address-${index}`}>{labels.deliveryAddress}</Label>
                  <Textarea id={`po-delivery-address-${index}`} maxLength={2000} disabled={isPending || !mounted} value={fields.deliveryAddress} onChange={(event) => updateHeader(key, "deliveryAddress", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-payment-terms-${index}`}>{labels.paymentTerms}</Label>
                  <Textarea id={`po-payment-terms-${index}`} maxLength={500} disabled={isPending || !mounted} readOnly={Boolean(group.supplier)} value={fields.paymentTerms} onChange={(event) => updateHeader(key, "paymentTerms", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-expected-delivery-date-${index}`}>{labels.expectedDeliveryDate}</Label>
                  <Input id={`po-expected-delivery-date-${index}`} type="date" disabled={isPending || !mounted} value={fields.expectedDeliveryDate} onChange={(event) => updateHeader(key, "expectedDeliveryDate", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-note-${index}`}>{labels.note}</Label>
                  <Textarea id={`po-note-${index}`} maxLength={2000} disabled={isPending || !mounted} value={fields.note} onChange={(event) => updateHeader(key, "note", event.target.value)} />
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
                  {group.items.map((item) => <TableRow key={item.id}>
                    <TableCell>{item.itemName}</TableCell>
                    <TableCell className="text-right">{formatNumber(item.quantity, locale)} {item.unit ? getUnitLabel(item.unit, locale) : ""}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.unitPrice ?? 0, locale)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.amount, locale)}</TableCell>
                  </TableRow>)}
                </TableBody>
              </Table>
              <p className="text-right font-semibold">{dictionary.common.totalAmount}: {formatCurrency(group.items.reduce((sum, item) => sum + item.amount, 0), locale)}</p>
            </CardContent>
          </Card>
        );
      })}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium">{labels.batchSummary}: {groups.length}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" disabled={isPending || !mounted} onClick={() => router.push(`/purchase-requests/${request.id}`)}>{labels.backToRequest}</Button>
          <Button id="create-purchase-orders" type="submit" disabled={isPending || !mounted} aria-busy={isPending}>
            {isPending ? labels.creating : labels.create}
          </Button>
        </div>
      </div>
    </form>
  );
}
