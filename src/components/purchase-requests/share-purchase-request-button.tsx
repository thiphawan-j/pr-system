"use client";

import { useRef, useState } from "react";
import { Copy, Share2 } from "lucide-react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SharePurchaseRequestButtonProps = {
  requestId: string;
  prNumber: string;
  reason: string;
};

type ShareFeedback = "copied" | "copyFailed" | "shared" | "shareFailed";

export function SharePurchaseRequestButton({
  requestId,
  prNumber,
  reason,
}: SharePurchaseRequestButtonProps) {
  const { dictionary } = useI18n();
  const labels = dictionary.sharePurchaseRequest;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [feedback, setFeedback] = useState<ShareFeedback | null>(null);

  function handleOpenChange(open: boolean) {
    if (open) {
      setShareUrl(
        new URL(
          `/purchase-requests/${encodeURIComponent(requestId)}`,
          window.location.origin,
        ).href,
      );
      setCanNativeShare(typeof navigator.share === "function");
      setFeedback(null);
    }
    setIsOpen(open);
  }

  function selectLink() {
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  async function copyLink() {
    setIsCopying(true);
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
      setIsCopying(false);
    }
  }

  async function shareViaDevice() {
    setIsSharing(true);
    setFeedback(null);
    try {
      await navigator.share({ title: prNumber, text: reason, url: shareUrl });
      setFeedback("shared");
    } catch (error) {
      const wasCancelled =
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError";
      if (!wasCancelled) {
        setFeedback("shareFailed");
        selectLink();
      }
    } finally {
      setIsSharing(false);
    }
  }

  const isBusy = isCopying || isSharing;
  const needsManualCopy = feedback === "copyFailed" || feedback === "shareFailed";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button id="share-pr-button" type="button" variant="outline" className="rounded-xl">
          <Share2 />
          {labels.button}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          selectLink();
        }}
      >
        <DialogHeader>
          <DialogTitle>{labels.title} · {prNumber}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="share-pr-link">{labels.linkLabel}</Label>
          <Input
            ref={inputRef}
            id="share-pr-link"
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
            aria-describedby={feedback ? "share-pr-feedback" : undefined}
          />
        </div>
        {feedback ? (
          <div className="space-y-2">
            <p id="share-pr-feedback" role="status" className="text-sm text-muted-foreground">
              {labels[feedback]}
            </p>
            {needsManualCopy ? (
              <Button type="button" variant="link" className="h-auto p-0" onClick={selectLink}>
                {labels.selectLink}
              </Button>
            ) : null}
          </div>
        ) : null}
        <DialogFooter className="flex-wrap">
          <DialogClose asChild>
            <Button type="button" variant="outline">{labels.close}</Button>
          </DialogClose>
          {canNativeShare ? (
            <Button
              id="native-share-pr-link"
              type="button"
              variant="outline"
              disabled={isBusy || !shareUrl}
              aria-busy={isSharing}
              onClick={shareViaDevice}
            >
              <Share2 />
              {isSharing ? labels.sharing : labels.nativeShare}
            </Button>
          ) : null}
          <Button
            id="copy-share-pr-link"
            type="button"
            disabled={isBusy || !shareUrl}
            aria-busy={isCopying}
            onClick={copyLink}
          >
            <Copy />
            {isCopying ? labels.copying : labels.copyLink}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
