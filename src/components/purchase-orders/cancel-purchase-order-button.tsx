"use client";

import { Ban } from "lucide-react";
import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { AlertDialog } from "radix-ui";
import { useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { translateMessage } from "@/lib/i18n";

export function CancelPurchaseOrderButton({ orderId, poNumber, expectedVersion }: { orderId: string; poNumber: string; expectedVersion: number }) {
  const router = useRouter();
  const { dictionary, locale } = useI18n();
  const labels = dictionary.poCombined;
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const busy = pending || router.isPending;
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const pendingRef = useRef(false);

  async function cancelOrder() {
    if (pendingRef.current || router.isPending || conflict) return;
    if (reason.trim().length < 5) { setError(labels.cancelReasonRequired); document.getElementById("po-cancellation-reason")?.focus(); return; }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/purchase-orders/${orderId}/cancellation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion, reason: reason.trim(), ...(reference.trim() ? { cancellationReference: reference.trim() } : {}) }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setConflict(response.status === 409);
        setError(response.status === 409 ? labels.conflict : translateMessage(payload?.error, locale) ?? labels.cancelError);
        return;
      }
      toast.success(labels.cancelSuccess);
      setOpen(false);
      router.refresh();
    } catch { setError(labels.cancelError); }
    finally { pendingRef.current = false; setPending(false); }
  }

  return <AlertDialog.Root open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
    <AlertDialog.Trigger asChild><Button id="cancel-purchase-order" type="button" variant="outline" className="rounded-xl text-destructive" disabled={!mounted || busy}><Ban />{labels.cancel}</Button></AlertDialog.Trigger>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-xs" />
      <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border bg-popover p-5 text-popover-foreground shadow-lg">
        <AlertDialog.Title className="text-lg font-semibold">{labels.cancelTitle.replace("{poNumber}", poNumber)}</AlertDialog.Title>
        <AlertDialog.Description className="text-sm leading-6 text-muted-foreground">{labels.cancelDescription}</AlertDialog.Description>
        <div className="space-y-2"><Label htmlFor="po-cancellation-reason">{labels.cancelReason}</Label><Textarea id="po-cancellation-reason" maxLength={2000} value={reason} disabled={busy || conflict} aria-invalid={Boolean(error) && reason.trim().length < 5} onChange={(event) => { setReason(event.target.value); setError(null); }} /></div>
        <div className="space-y-2"><Label htmlFor="po-cancellation-reference">{labels.cancelReference}</Label><Input id="po-cancellation-reference" maxLength={200} value={reference} disabled={busy || conflict} onChange={(event) => setReference(event.target.value)} /></div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {conflict ? <Button id="reload-po-cancellation" type="button" variant="outline" onClick={() => { setOpen(false); router.refresh(); }}>{labels.reload}</Button> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialog.Cancel asChild><Button type="button" variant="outline" disabled={busy}>{dictionary.common.cancel}</Button></AlertDialog.Cancel>
          <Button id="confirm-cancel-purchase-order" type="button" loading={pending} variant="destructive" disabled={busy || conflict} onClick={() => void cancelOrder()}>{!pending ? <Ban /> : null}{pending ? labels.cancelling : labels.confirmCancel}</Button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
