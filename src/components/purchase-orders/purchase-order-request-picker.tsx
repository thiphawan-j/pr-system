"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { PurchaseOrderForm } from "@/components/purchase-orders/purchase-order-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/format";
import { getDepartmentLabelFromDictionary, translateMessage } from "@/lib/i18n";
import type { PurchaseOrderEligibleRequest, PurchaseOrderRecipientOption, PurchaseRequestDetail, SupplierDetail } from "@/lib/types";

export function PurchaseOrderRequestPicker({ suppliers, recipients = [], initialRequest }: { suppliers: SupplierDetail[]; recipients?: PurchaseOrderRecipientOption[]; initialRequest?: PurchaseOrderEligibleRequest }) {
  const { dictionary, locale } = useI18n();
  const labels = dictionary.poCombined;
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<PurchaseOrderEligibleRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<PurchaseOrderEligibleRequest[]>(() => initialRequest ? [initialRequest] : []);
  const [prepared, setPrepared] = useState<PurchaseRequestDetail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (prepared) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/purchase-orders/eligible?query=${encodeURIComponent(query)}&page=${page}`, { signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? labels.loadError);
        if (!payload || !Array.isArray(payload.requests)) throw new Error(labels.loadError);
        setResults(payload.requests);
        setTotal(payload.total);
      } catch (error) {
        if (!controller.signal.aborted) setError(translateMessage(error instanceof Error ? error.message : undefined, locale) ?? labels.loadError);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, prepared, labels.loadError, locale]);

  async function prepare() {
    if (pendingRef.current || !selected.length) return;
    pendingRef.current = true;
    setPreparing(true);
    setError(null);
    try {
      const requests = await Promise.all(selected.map(async (entry) => {
        const response = await fetch(`/api/purchase-requests/${entry.id}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? labels.loadError);
        if (!payload) throw new Error(labels.loadError);
        return payload as PurchaseRequestDetail;
      }));
      if (requests.some((request) => !["APPROVED", "ORDERED"].includes(request.status) || request.completedAt || request.hasPendingPurchaseOrderChange || !request.items.some((item) => item.canOrder !== false))) throw new Error(labels.conflict);
      setPrepared(requests);
    } catch (error) { setError(translateMessage(error instanceof Error ? error.message : undefined, locale) ?? labels.loadError); }
    finally { pendingRef.current = false; setPreparing(false); }
  }

  if (prepared) return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-4">
      <p className="min-w-0 break-words text-sm font-medium">{labels.selectedRequests}: {prepared.map((request) => request.prNumber).join(", ")}</p>
      <Button id="change-po-source-requests" type="button" variant="outline" onClick={() => { if (window.confirm(labels.discardPreparation)) setPrepared(null); }}>{labels.changeRequests}</Button>
    </div>
    <PurchaseOrderForm request={prepared[0]!} requests={prepared} suppliers={suppliers} recipients={recipients} />
  </div>;

  return <Card className="min-w-0 border-border/70">
    <CardHeader><CardTitle>{labels.selectRequests}</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <div className="space-y-2"><Label htmlFor="po-request-search">{labels.search}</Label><div className="relative"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input id="po-request-search" className="pl-9" placeholder={labels.searchPlaceholder} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></div></div>
      <div id="po-selected-requests" className="space-y-2">
        <p className="text-sm font-medium">{labels.selectedRequests}: {formatNumber(selected.length, locale)}</p>
        <div className="flex flex-wrap gap-2">{selected.map((request) => <Button key={request.id} type="button" variant="outline" size="sm" disabled={preparing} aria-label={`${labels.removeRequest}: ${request.prNumber}`} onClick={() => setSelected((current) => current.filter((entry) => entry.id !== request.id))}>{request.prNumber}<X className="size-3" /></Button>)}</div>
      </div>
      <div aria-busy={loading} className="space-y-2">
        {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{dictionary.common.loading}</p> : !results.length ? <p className="text-sm text-muted-foreground">{labels.noRequests}</p> : null}
        {results.map((request) => <label key={request.id} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/70 p-4 has-checked:border-primary/50 has-checked:bg-primary/5">
          <input id={`po-source-request-${request.id}`} type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={selected.some((entry) => entry.id === request.id)} disabled={preparing} onChange={(event) => setSelected((current) => event.target.checked ? [...current, request] : current.filter((entry) => entry.id !== request.id))} />
          <span className="min-w-0 flex-1 space-y-1"><span className="block break-words text-sm font-semibold">{request.prNumber}</span><span className="block text-xs text-muted-foreground">{request.requesterName} · {getDepartmentLabelFromDictionary(request.department, dictionary)}</span><span className="block text-xs text-muted-foreground">{labels.pending}: {formatNumber(request.orderableItemCount, locale)}</span></span>
        </label>)}
      </div>
      <div className="flex items-center justify-between gap-3"><Button type="button" variant="outline" disabled={page <= 1 || loading || preparing} onClick={() => setPage((current) => current - 1)}>{labels.previous}</Button><span className="text-sm text-muted-foreground">{formatNumber(page, locale)} / {formatNumber(Math.max(1, Math.ceil(total / 10)), locale)}</span><Button type="button" variant="outline" disabled={page * 10 >= total || loading || preparing} onClick={() => setPage((current) => current + 1)}>{labels.next}</Button></div>
      <p className="text-xs leading-6 text-muted-foreground">{labels.mixedApprovers}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button id="prepare-combined-po" type="button" loading={preparing} disabled={!selected.length || preparing} onClick={() => void prepare()}>{preparing ? dictionary.common.loading : labels.prepare}</Button>
    </CardContent>
  </Card>;
}
