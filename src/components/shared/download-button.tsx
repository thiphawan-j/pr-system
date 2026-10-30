"use client";

import { useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { translateMessage } from "@/lib/i18n";

type DownloadButtonProps = Omit<ComponentProps<"a">, "children"> & {
  href: string;
  filename?: string;
  children: ReactNode;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
};

function downloadFilename(disposition: string | null, fallback: string) {
  const encoded = disposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  let name = disposition?.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
    ?? disposition?.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim()
    ?? fallback;
  if (encoded) {
    try { name = decodeURIComponent(encoded.trim()); } catch { /* Use the plain filename if malformed. */ }
  }
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim() || fallback;
}

export function DownloadButton({ href, filename = "download", children, variant = "outline", size, className, onClick, target, ...props }: DownloadButtonProps) {
  const { dictionary, locale } = useI18n();
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);

  async function downloadFile(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || target && target !== "_self") return;
    event.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    setIsPending(true);
    try {
      const response = await fetch(href);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        toast.error(translateMessage(payload?.error, locale) ?? dictionary.common.downloadError);
        return;
      }
      if (response.headers.get("content-type")?.includes("text/html")) throw new Error(dictionary.common.downloadError);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = downloadFilename(response.headers.get("content-disposition"), filename);
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        // Give the browser time to consume the blob before releasing it.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      toast.error(dictionary.common.downloadError);
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  return <Button asChild variant={variant} size={size} className={className} loading={isPending} loadingKind="download">
    <a {...props} href={href} target={target} aria-disabled={isPending || undefined} onClick={(event) => void downloadFile(event)}>
      {isPending ? dictionary.common.preparingFile : children}
    </a>
  </Button>;
}
