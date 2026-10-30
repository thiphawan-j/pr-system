"use client";

import { Copy, RefreshCw, Share2, Unlink } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BusySpinner } from "@/components/ui/busy-spinner";
import { formatDateTime } from "@/lib/format";
import { translateMessage } from "@/lib/i18n";
import { PURCHASE_ORDER_SHARE_DEFAULT_DAYS, PURCHASE_ORDER_SHARE_MAX_DAYS, PURCHASE_ORDER_SHARE_MIN_DAYS } from "@/lib/purchase-order-share";
import type { PurchaseOrderShareState } from "@/lib/types";

type LinkAction = "create" | "renew" | "revoke";
type ShareFeedback = "copied" | "copyFailed" | "shared" | "shareFailed" | "revoked";

export function SharePurchaseOrderButton({ orderId, poNumber, supplierName }: { orderId: string; poNumber: string; supplierName: string }) {
  const { dictionary, locale } = useI18n();
  const labels = dictionary.sharePurchaseOrder;
  const inputRef = useRef<HTMLInputElement>(null);
  const lifetimeInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PurchaseOrderShareState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lifetimeDays, setLifetimeDays] = useState(String(PURCHASE_ORDER_SHARE_DEFAULT_DAYS));
  const [showLifetimeError, setShowLifetimeError] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [action, setAction] = useState<LinkAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ShareFeedback | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const hasLink = Boolean(state?.isActive && state.path && shareUrl);
  const busy = loading || action !== null || copying || sharing;
  const days = Number(lifetimeDays.trim());
  const validLifetime = /^\d+$/.test(lifetimeDays.trim()) && Number.isInteger(days)
    && days >= PURCHASE_ORDER_SHARE_MIN_DAYS && days <= PURCHASE_ORDER_SHARE_MAX_DAYS;
  const invalidLifetime = showLifetimeError && !validLifetime;
  const endpoint = `/api/purchase-orders/${encodeURIComponent(orderId)}/share`;

  function updateState(next: PurchaseOrderShareState, resetLifetime = true) {
    setState(next);
    setLoaded(true);
    setShareUrl(next.isActive && next.path ? new URL(next.path, window.location.origin).href : "");
    if (resetLifetime) {
      setLifetimeDays(String(next.expiresInDays));
      setShowLifetimeError(false);
    }
  }

  async function refreshState() {
    const response = await fetch(endpoint, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error(translateMessage(payload?.error, locale) ?? labels.loadError);
    updateState(payload as PurchaseOrderShareState);
  }

  async function loadState() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setLoading(true);
    setLoaded(false);
    setState(null);
    setShareUrl("");
    setError(null);
    setFeedback(null);
    try {
      await refreshState();
    } catch (failure) {
      setError(failure instanceof Error && !(failure instanceof TypeError) ? failure.message : labels.loadError);
    } finally {
      pendingRef.current = false;
      setLoading(false);
    }
  }

  async function manageLink(nextAction: LinkAction) {
    if (pendingRef.current || !loaded) return;
    if (nextAction !== "revoke" && !validLifetime) {
      setShowLifetimeError(true);
      lifetimeInputRef.current?.focus();
      return;
    }
    pendingRef.current = true;
    setAction(nextAction);
    setError(null);
    setFeedback(null);
    try {
      const response = await fetch(endpoint, {
        method: nextAction === "revoke" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextAction === "create" ? { expiresInDays: days } : {
          ...(nextAction === "renew" ? { renew: true, expiresInDays: days } : {}), expectedShareId: state?.id,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 409) {
        // Another tab may have changed the link. Refresh without rotating again.
        setLoaded(false);
        setState(null);
        setShareUrl("");
        await refreshState();
        const message = translateMessage(payload?.error, locale) ?? labels.error;
        setError(message);
        toast.error(message);
        return;
      }
      if (!response.ok || !payload) throw new Error(translateMessage(payload?.error, locale) ?? labels.error);
      updateState(payload as PurchaseOrderShareState, nextAction !== "revoke");
      if (nextAction === "revoke") setFeedback("revoked");
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : labels.error;
      setError(message);
      toast.error(message);
    } finally {
      pendingRef.current = false;
      setAction(null);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setCanNativeShare(typeof navigator.share === "function");
    setFeedback(null);
    setLifetimeDays(String(state?.expiresInDays ?? PURCHASE_ORDER_SHARE_DEFAULT_DAYS));
    setShowLifetimeError(false);
    void loadState();
  }

  function selectLink() {
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  async function copyLink() {
    if (pendingRef.current || !hasLink) return;
    pendingRef.current = true;
    setCopying(true);
    setFeedback(null);
    try {
      if (typeof navigator.clipboard?.writeText !== "function") {
        setFeedback("copyFailed");
        selectLink();
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setFeedback("copied");
    } catch {
      setFeedback("copyFailed");
      selectLink();
    } finally {
      pendingRef.current = false;
      setCopying(false);
    }
  }

  async function shareViaDevice() {
    if (pendingRef.current || !hasLink || typeof navigator.share !== "function") return;
    pendingRef.current = true;
    setSharing(true);
    setFeedback(null);
    try {
      await navigator.share({ title: poNumber, text: supplierName, url: shareUrl });
      setFeedback("shared");
    } catch (failure) {
      if (!(failure instanceof Error && failure.name === "AbortError")) {
        setFeedback("shareFailed");
        selectLink();
      }
    } finally {
      pendingRef.current = false;
      setSharing(false);
    }
  }

  return <Dialog open={open} onOpenChange={handleOpenChange}>
    <DialogTrigger asChild><Button id="share-po-button" type="button" variant="outline" className="rounded-xl"><Share2 />{labels.button}</Button></DialogTrigger>
    <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" onOpenAutoFocus={(event) => { if (inputRef.current) { event.preventDefault(); selectLink(); } }}>
      <DialogHeader><DialogTitle>{labels.title} · {poNumber}</DialogTitle><DialogDescription>{labels.description}</DialogDescription></DialogHeader>
      {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><BusySpinner />{labels.loading}</p> : loaded ? <>
        {hasLink ?
        <div className="space-y-2">
          <Label htmlFor="share-po-link">{labels.linkLabel}</Label>
          <Input id="share-po-link" ref={inputRef} readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} aria-describedby={feedback ? "share-po-feedback" : undefined} />
          {state?.expiresAt ? <p id="share-po-expires-at" className="text-xs text-muted-foreground">{labels.expiresAt}: {formatDateTime(state.expiresAt, locale)}</p> : null}
        </div> : null}
        <div className="space-y-2">
          <Label htmlFor="share-po-lifetime-days">{labels.lifetimeDays}</Label>
          <Input id="share-po-lifetime-days" ref={lifetimeInputRef} type="number" min={PURCHASE_ORDER_SHARE_MIN_DAYS} max={PURCHASE_ORDER_SHARE_MAX_DAYS} step={1}
            disabled={busy} value={lifetimeDays} aria-invalid={invalidLifetime || undefined}
            aria-describedby={`share-po-lifetime-hint${hasLink ? " share-po-lifetime-apply-hint" : ""}${invalidLifetime ? " share-po-lifetime-error" : ""}`}
            onChange={(event) => { setLifetimeDays(event.target.value); setShowLifetimeError(false); setError(null); }} />
          <p id="share-po-lifetime-hint" className="text-xs leading-5 text-muted-foreground">{labels.lifetimeHint}</p>
          {hasLink ? <p id="share-po-lifetime-apply-hint" className="text-xs leading-5 text-muted-foreground">{labels.lifetimeApplyHint}</p> : null}
          {invalidLifetime ? <p id="share-po-lifetime-error" role="alert" className="text-sm text-destructive">{labels.lifetimeInvalid}</p> : null}
        </div>
        {hasLink ?
        <div className="space-y-3 rounded-xl border border-border/70 p-3">
          <p className="text-xs leading-5 text-muted-foreground">{labels.renewHint}</p>
          <div className="flex flex-wrap gap-2">
            <Button id="renew-share-po-link" type="button" variant="outline" size="sm" loading={action === "renew"} disabled={busy} onClick={() => void manageLink("renew")}>
              {action !== "renew" ? <RefreshCw /> : null}{action === "renew" ? labels.renewing : labels.renew}
            </Button>
            <Button id="revoke-share-po-link" type="button" variant="outline" size="sm" loading={action === "revoke"} disabled={busy} onClick={() => void manageLink("revoke")}>
              {action !== "revoke" ? <Unlink /> : null}{action === "revoke" ? labels.revoking : labels.revoke}
            </Button>
          </div>
        </div> : <div className="space-y-3 rounded-xl border border-border/70 p-4">
        {action !== "create" ? <p className="text-sm text-muted-foreground">{feedback === "revoked" ? labels.revoked : labels.unavailable}</p> : null}
        <Button id="create-share-po-link" type="button" loading={action === "create"} disabled={busy} onClick={() => void manageLink("create")}>{action === "create" ? labels.creating : labels.createLink}</Button>
        </div>}
      </> : <Button id="retry-share-po-state" type="button" variant="outline" onClick={() => void loadState()}>{labels.retry}</Button>}
      {error ? <p id="share-po-error" role="alert" className="text-sm text-destructive">{error}</p> : null}
      {feedback && feedback !== "revoked" ? <div className="space-y-2">
        <p id="share-po-feedback" role="status" className="text-sm text-muted-foreground">{labels[feedback]}</p>
        {feedback === "copyFailed" || feedback === "shareFailed" ? <Button type="button" variant="link" className="h-auto p-0" onClick={selectLink}>{labels.selectLink}</Button> : null}
      </div> : null}
      <DialogFooter className="flex-wrap">
        <DialogClose asChild><Button type="button" variant="outline">{labels.close}</Button></DialogClose>
        {canNativeShare && hasLink ? <Button id="native-share-po-link" type="button" variant="outline" loading={sharing} disabled={busy} onClick={() => void shareViaDevice()}>
          {!sharing ? <Share2 /> : null}{sharing ? labels.sharing : labels.nativeShare}
        </Button> : null}
        {hasLink ? <Button id="copy-share-po-link" type="button" loading={copying} disabled={busy} onClick={() => void copyLink()}>
          {!copying ? <Copy /> : null}{copying ? labels.copying : labels.copyLink}
        </Button> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
