"use client";

import Image from "next/image";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatFileSize } from "@/lib/format";
import type { PurchaseRequestAttachmentItem } from "@/lib/types";

type AttachmentPreviewButtonProps = {
  requestId: string;
  attachment: Pick<
    PurchaseRequestAttachmentItem,
    "id" | "mimeType" | "originalName" | "size"
  >;
};

type PreviewKind = "image" | "pdf" | "text" | "unsupported";

const textPreviewMimeTypes = new Set(["text/plain", "text/csv"]);

function getPreviewKind(mimeType: string): PreviewKind {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType === "application/pdf") {
    return "pdf";
  }

  if (textPreviewMimeTypes.has(mimeType)) {
    return "text";
  }

  return "unsupported";
}

export function AttachmentPreviewButton({
  requestId,
  attachment,
}: AttachmentPreviewButtonProps) {
  const [open, setOpen] = useState(false);
  const [textPreview, setTextPreview] = useState("");
  const [isLoadingTextPreview, setIsLoadingTextPreview] = useState(false);
  const [textPreviewError, setTextPreviewError] = useState<string | null>(null);
  const { dictionary, locale } = useI18n();

  const previewKind = getPreviewKind(attachment.mimeType);
  const downloadUrl = `/api/purchase-requests/${requestId}/attachments/${attachment.id}`;
  const previewUrl = `${downloadUrl}?disposition=inline`;

  useEffect(() => {
    if (!open || previewKind !== "text") {
      return;
    }

    let isCancelled = false;
    setIsLoadingTextPreview(true);
    setTextPreviewError(null);

    void fetch(previewUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("preview_failed");
        }

        const nextTextPreview = await response.text();

        if (!isCancelled) {
          setTextPreview(nextTextPreview);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setTextPreviewError(dictionary.purchaseRequests.previewLoadError);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingTextPreview(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [dictionary.purchaseRequests.previewLoadError, open, previewKind, previewUrl]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="rounded-xl">
          <Eye />
          {dictionary.purchaseRequests.previewAttachment}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border/70 px-6 pt-6 pb-4">
          <DialogTitle>{attachment.originalName}</DialogTitle>
          <DialogDescription>
            {attachment.mimeType} · {formatFileSize(attachment.size, locale)}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5">
          {previewKind === "image" ? (
            <div className="relative h-[72vh] rounded-2xl border border-border/70 bg-muted/30 p-4">
              <Image
                src={previewUrl}
                alt={attachment.originalName}
                fill
                unoptimized
                sizes="100vw"
                className="object-contain p-4"
              />
            </div>
          ) : null}

          {previewKind === "pdf" ? (
            <iframe
              src={previewUrl}
              title={dictionary.purchaseRequests.previewTitle}
              className="h-[72vh] w-full rounded-2xl border border-border/70 bg-background"
            />
          ) : null}

          {previewKind === "text" ? (
            <div className="h-[72vh] overflow-auto rounded-2xl border border-border/70 bg-muted/20 p-4">
              {isLoadingTextPreview ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {dictionary.purchaseRequests.previewLoading}
                </div>
              ) : textPreviewError ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {textPreviewError}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words text-xs leading-6">
                  {textPreview}
                </pre>
              )}
            </div>
          ) : null}

          {previewKind === "unsupported" ? (
            <div className="flex h-[40vh] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 text-center">
              <FileText className="size-10 text-muted-foreground" />
              <div className="space-y-1">
                <p className="font-medium">{dictionary.purchaseRequests.previewUnsupported}</p>
                <p className="text-sm text-muted-foreground">
                  {dictionary.purchaseRequests.previewUnsupportedDescription}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border/70">
          <Button asChild variant="outline" className="rounded-xl">
            <a href={downloadUrl}>
              <Download />
              {dictionary.purchaseRequests.downloadAttachment}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
