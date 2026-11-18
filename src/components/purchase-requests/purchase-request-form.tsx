"use client";

import { DownloadButton } from "@/components/shared/download-button";

import { zodResolver } from "@hookform/resolvers/zod";
import { Download, FileText, Paperclip, Plus, Trash2, X } from "lucide-react";
import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import {
  startTransition,
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useI18n } from "@/components/i18n/i18n-provider";
import { AttachmentPreviewButton } from "@/components/purchase-requests/attachment-preview-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { departments, units } from "@/lib/constants";
import {
  formatCurrency,
  formatFileSize,
  toBangkokDateValue,
} from "@/lib/format";
import {
  getDepartmentLabel,
  interpolate,
  translateMessage,
} from "@/lib/i18n";
import { priorities } from "@/lib/types";
import { cn } from "@/lib/utils";
import { purchaseRequestPayloadSchema } from "@/server/purchase-requests/purchase-request.schemas";
import type { PurchaseRequestDetail, SessionUser } from "@/lib/types";

const itemDefaults = {
  itemName: "",
  description: "",
  supplierName: "",
  quantity: 1,
  unit: "",
  unitPrice: undefined,
  amount: 0,
};

type PurchaseRequestFormValues = z.input<typeof purchaseRequestPayloadSchema>;
type PurchaseRequestFormPayload = z.output<typeof purchaseRequestPayloadSchema>;

type PurchaseRequestFormProps = {
  mode: "create" | "edit";
  session: SessionUser;
  requestId?: string;
  initialData?: PurchaseRequestDetail;
};

export function PurchaseRequestForm({
  mode,
  session,
  requestId,
  initialData,
}: PurchaseRequestFormProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const [pendingIntent, setPendingIntent] = useState<boolean | null>(null);
  const savedRef = useRef(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [validationFailed, setValidationFailed] = useState(false);
  const busy = isPending || router.isPending;
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [isDraggingAttachments, setIsDraggingAttachments] = useState(false);
  const [existingAttachments, setExistingAttachments] = useState(
    initialData?.attachments ?? [],
  );
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);
  const { dictionary, locale } = useI18n();
  const ux = locale === "th" ? {
    basics: "1. ข้อมูลพื้นฐาน", items: "2. รายการและไฟล์แนบ", review: "3. ตรวจสอบก่อนส่ง",
    leave: "มีข้อมูลที่ยังไม่ได้บันทึก ออกจากหน้านี้โดยไม่บันทึกหรือไม่?", dirty: "มีการแก้ไขที่ยังไม่ได้บันทึก",
    hint: "บันทึกร่างยังไม่ส่งอนุมัติ • ข้อมูลต้องผ่านการตรวจสอบตามกฎเดิม",
    errors: "ยังบันทึกไม่ได้ กรุณาตรวจช่องที่แจ้งข้อผิดพลาด", reviewTitle: "ตรวจสอบใบขอซื้อก่อนส่ง",
    reviewHint: "ส่งตามสิทธิ์และสายอนุมัติเดิม การยืนยันนี้ไม่อนุมัติหรือสร้าง PO อัตโนมัติ",
    confirm: "ยืนยันส่งใบขอซื้อ", back: "กลับไปแก้ไข", unknown: "ยังไม่ระบุราคา", partial: "ยอดรวมเฉพาะรายการที่มีราคา",
    estimate: "ยอดประมาณการ ไม่ใช่ยอดชำระ PO", attachments: "ไฟล์แนบ", next: "ถัดไป", edit: "แก้ไขข้อมูล",
  } : {
    basics: "1. Basic information", items: "2. Items and attachments", review: "3. Review before sending",
    leave: "You have unsaved changes. Leave this page without saving?", dirty: "Unsaved changes",
    hint: "Saving a draft does not submit it • Existing validation rules still apply",
    errors: "Unable to save. Please check the highlighted fields", reviewTitle: "Review purchase request before sending",
    reviewHint: "The existing permissions and approval process apply. Confirming does not approve the request or create a PO automatically.",
    confirm: "Confirm send request", back: "Back to editing", unknown: "Price not specified", partial: "Subtotal of priced items",
    estimate: "Estimated amount, not a PO payment total", attachments: "Attachments", next: "Next", edit: "Edit details",
  };
  const isPurchasingReturnEdit =
    initialData?.status === "NEED_REVISION" ||
    initialData?.status === "NEED_CLARIFICATION";
  const form = useForm<
    PurchaseRequestFormValues,
    undefined,
    PurchaseRequestFormPayload
  >({
    resolver: zodResolver(purchaseRequestPayloadSchema),
    defaultValues: initialData
      ? {
          requestDate: toBangkokDateValue(initialData.requestDate),
          department: initialData.department as PurchaseRequestFormValues["department"],
          reason: initialData.reason,
          urgency: initialData.urgency,
          items: initialData.items.map((item) => ({
            id: item.id,
            itemName: item.itemName,
            description: item.description ?? "",
            supplierName: item.supplierName ?? "",
            quantity: item.quantity,
            unit: item.unit ?? "",
            unitPrice: item.unitPrice,
            amount: item.amount,
          })),
          submit: false,
          requesterComment: "",
        }
      : {
          requestDate: toBangkokDateValue(),
          department: session.department as PurchaseRequestFormValues["department"],
          reason: "",
          urgency: "NORMAL",
          items: [{ ...itemDefaults }],
          submit: false,
          requesterComment: "",
        },
  });

  const itemsArray = useFieldArray({
    control: form.control,
    name: "items",
  });

  const watchedItems = useWatch({
    control: form.control,
    name: "items",
  });
  const watchedDepartment = useWatch({
    control: form.control,
    name: "department",
  });
  const watchedUrgency = useWatch({
    control: form.control,
    name: "urgency",
  });

  const watchedReason = useWatch({ control: form.control, name: "reason" });
  const watchedDate = useWatch({ control: form.control, name: "requestDate" });
  const hasUnpricedItems = watchedItems.some((item) => item.unitPrice === undefined || item.unitPrice === null || item.unitPrice === "");
  const unsaved = form.formState.isDirty || attachmentFiles.length > 0;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!unsaved || savedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const guardLink = (event: MouseEvent) => {
      if (savedRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const next = new URL(anchor.href, window.location.href);
      if (next.origin === window.location.origin && next.pathname === window.location.pathname && next.search === window.location.search) return;
      // A document boundary is intentional: Back/Forward must run beforeunload.
      // Do not add synthetic history entries or race Next's popstate restoration.
      if (next.protocol !== "http:" && next.protocol !== "https:") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(next.href);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", guardLink, true);
    };
  }, [unsaved]);

  function jumpTo(id: string) {
    const section = document.getElementById(id);
    section?.scrollIntoView({ block: "start", behavior: "smooth" });
    section?.focus({ preventScroll: true });
  }

  async function reviewRequest() {
    if (pendingRef.current || busy || deletingAttachmentId) return;
    form.setValue("submit", true);
    const valid = await form.trigger();
    setValidationFailed(!valid);
    if (valid) setReviewOpen(true);
    else requestAnimationFrame(() => jumpTo("pr-form-errors"));
  }

  const grandTotal = useMemo(
    () =>
      watchedItems.reduce((sum, item) => {
        const quantity = Number(item?.quantity ?? 0);
        const unitPrice = Number(item?.unitPrice ?? 0);
        return sum + quantity * unitPrice;
      }, 0),
    [watchedItems],
  );

  useEffect(() => {
    setExistingAttachments(initialData?.attachments ?? []);
  }, [initialData?.attachments]);

  function addAttachmentFiles(files: FileList | File[] | null) {
    if (!files?.length) {
      return;
    }

    setAttachmentFiles((currentFiles) => [
      ...currentFiles,
      ...Array.from(files),
    ]);
  }

  function handleAttachmentPaste(event: ClipboardEvent<HTMLDivElement>) {
    const pastedImages = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );

    if (!pastedImages.length) {
      return;
    }

    event.preventDefault();
    const timestamp = Date.now();
    const namedImages = pastedImages.map((file, index) => {
      const rawExtension = file.type.split("/")[1] || "png";
      const extension = rawExtension === "jpeg" ? "jpg" : rawExtension;

      return new File(
        [file],
        `screenshot-${timestamp}-${index + 1}.${extension}`,
        {
          type: file.type,
          lastModified: timestamp,
        },
      );
    });

    addAttachmentFiles(namedImages);
    toast.success(dictionary.purchaseRequests.attachmentPasteSuccess);
  }

  function handleAttachmentDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingAttachments(false);

    const droppedFiles = Array.from(event.dataTransfer.files);

    if (!droppedFiles.length) {
      return;
    }

    addAttachmentFiles(droppedFiles);
    toast.success(dictionary.purchaseRequests.attachmentDropSuccess);
  }

  function removeAttachmentFile(index: number) {
    setAttachmentFiles((currentFiles) =>
      currentFiles.filter((_, fileIndex) => fileIndex !== index),
    );
  }

  function removeExistingAttachment(attachmentId: string) {
    if (!initialData || pendingRef.current || busy || deletingAttachmentId) return;
    pendingRef.current = true;
    setDeletingAttachmentId(attachmentId);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/purchase-requests/${initialData.id}/attachments/${attachmentId}`,
          {
            method: "DELETE",
          },
        );
        const responsePayload = await response.json().catch(() => null);

        if (!response.ok) {
          toast.error(
            translateMessage(responsePayload?.error, locale) ??
              dictionary.purchaseRequests.deleteAttachmentError,
          );
          return;
        }

        setExistingAttachments((currentAttachments) =>
          currentAttachments.filter((attachment) => attachment.id !== attachmentId),
        );
        toast.success(dictionary.purchaseRequests.deleteAttachmentSuccess);
        router.refresh();
      } catch {
        toast.error(dictionary.purchaseRequests.deleteAttachmentError);
      } finally {
        pendingRef.current = false;
        setDeletingAttachmentId(null);
      }
    });
  }

  function submit(submit: boolean) {
    if (pendingRef.current || busy || deletingAttachmentId) return;
    pendingRef.current = true;
    setValidationFailed(false);
    form.setValue("submit", submit);
    void form.handleSubmit((values: PurchaseRequestFormPayload) => {
      setPendingIntent(submit);
      setIsPending(true);
      startTransition(async () => {
        let saved = false;
        try {
          const url =
            mode === "edit" && requestId
              ? `/api/purchase-requests/${requestId}`
              : "/api/purchase-requests";
          const payload = {
            ...values,
            submit,
            items: values.items.map(
              (item: PurchaseRequestFormPayload["items"][number]) => ({
                ...item,
                amount: Number((item.quantity * (item.unitPrice ?? 0)).toFixed(2)),
              }),
            ),
          };
          const formData = new FormData();

          formData.append("payload", JSON.stringify(payload));
          attachmentFiles.forEach((file) => {
            formData.append("attachments", file);
          });

          const response = await fetch(url, {
            method: mode === "edit" ? "PATCH" : "POST",
            body: formData,
          });
          const responsePayload = await response.json().catch(() => null);

          if (!response.ok) {
            toast.error(
              translateMessage(responsePayload?.error, locale) ??
                dictionary.purchaseRequests.saveError,
            );
            return;
          }

          saved = true;
          savedRef.current = true;
          setReviewOpen(false);
          toast.success(
            submit
              ? isPurchasingReturnEdit
                ? dictionary.purchaseRequests.resubmittedToPurchasing
                : dictionary.purchaseRequests.submittedSaved
              : dictionary.purchaseRequests.draftSaved,
          );
          // Replace the completed form with a fresh document, not a same-document
          // forward entry that could bypass beforeunload after returning to edit.
          window.location.replace(`/purchase-requests/${responsePayload.id}`);
        } catch {
          toast.error(dictionary.purchaseRequests.saveError);
        } finally {
          // A successful document navigation is asynchronous. Keep controls locked
          // until unload so a slow destination cannot permit a duplicate save.
          if (!saved) {
            pendingRef.current = false;
            setIsPending(false);
            setPendingIntent(null);
          }
        }
      });
    }, () => { pendingRef.current = false; setValidationFailed(true); requestAnimationFrame(() => jumpTo("pr-form-errors")); })().catch(() => {
      pendingRef.current = false;
      setIsPending(false);
      setPendingIntent(null);
      toast.error(dictionary.purchaseRequests.saveError);
    });
  }

  return (
    <fieldset className="min-w-0 space-y-6" disabled={busy || Boolean(deletingAttachmentId)}>
      <nav aria-label={ux.reviewTitle} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[ ["pr-form-basics", ux.basics], ["pr-form-items", ux.items], ["pr-form-review", ux.review] ].map(([id, label]) => (
          <Button key={id} type="button" variant="outline" className="h-auto min-h-11 justify-start whitespace-normal rounded-xl" onClick={() => jumpTo(id)}>{label}</Button>
        ))}
      </nav>
      <p className="text-sm text-muted-foreground">{ux.hint}</p>
      {validationFailed ? <div id="pr-form-errors" tabIndex={-1} role="alert" className="scroll-mt-24 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{ux.errors}</div> : null}
      <Card id="pr-form-basics" tabIndex={-1} className="scroll-mt-24 border-border/70">
        <CardHeader>
          <CardTitle>{ux.basics}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="requestDate">{dictionary.common.documentDate}</Label>
            <Input id="requestDate" type="date" {...form.register("requestDate")} />
            {form.formState.errors.requestDate ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.requestDate.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>{dictionary.common.department}</Label>
            <Select
              value={watchedDepartment}
              onValueChange={(value) =>
                form.setValue("department", value as PurchaseRequestFormValues["department"], { shouldDirty: true })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={dictionary.purchaseRequests.departmentPlaceholder}
                >
                  {getDepartmentLabel(watchedDepartment, locale)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {departments.map((department) => (
                  <SelectItem key={department} value={department}>
                    {getDepartmentLabel(department, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.department ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.department.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="reason">{dictionary.purchaseRequests.reason}</Label>
            <Textarea
              id="reason"
              rows={4}
              placeholder={dictionary.purchaseRequests.reasonPlaceholder}
              {...form.register("reason")}
            />
            {form.formState.errors.reason ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.reason.message, locale)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>{dictionary.common.priority}</Label>
            <Select
              value={watchedUrgency}
              onValueChange={(value) =>
                form.setValue("urgency", value as PurchaseRequestFormValues["urgency"], { shouldDirty: true })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={dictionary.purchaseRequests.priorityPlaceholder}
                />
              </SelectTrigger>
              <SelectContent>
                {priorities.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {dictionary.priorities[priority]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.urgency ? (
              <p className="text-xs text-destructive">
                {translateMessage(form.formState.errors.urgency.message, locale)}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card id="pr-form-items" tabIndex={-1} className="scroll-mt-24 border-border/70">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{ux.items}</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => itemsArray.append({ ...itemDefaults })}
          >
            <Plus />
            {dictionary.purchaseRequests.addItem}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {itemsArray.fields.map((field, index) => {
            const quantity = Number(watchedItems[index]?.quantity ?? 0);
            const unitPrice = Number(watchedItems[index]?.unitPrice ?? 0);
            const amount = quantity * unitPrice;

            return (
              <div
                key={field.id}
                className="rounded-2xl border border-border/70 bg-muted/30 p-4"
              >
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
                  <div className="space-y-2 xl:col-span-2">
                    <Label>{dictionary.purchaseRequests.itemName}</Label>
                    <Input {...form.register(`items.${index}.itemName`)} />
                    {form.formState.errors.items?.[index]?.itemName ? (
                      <p className="text-xs text-destructive">
                        {translateMessage(
                          form.formState.errors.items[index]?.itemName?.message,
                          locale,
                        )}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label>{dictionary.purchaseRequests.quantity}</Label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      {...form.register(`items.${index}.quantity`, {
                        valueAsNumber: true,
                      })}
                    />
                    {form.formState.errors.items?.[index]?.quantity ? <p className="text-xs text-destructive">{translateMessage(form.formState.errors.items[index]?.quantity?.message, locale)}</p> : null}
                  </div>

                  <div className="space-y-2">
                    <Label>{dictionary.purchaseRequests.unitOptional}</Label>
                    <Input
                      list={`unit-options-${field.id}`}
                      {...form.register(`items.${index}.unit`)}
                    />
                    <datalist id={`unit-options-${field.id}`}>
                      {units.map((unit) => (
                        <option key={unit} value={unit}>
                          {dictionary.units[unit]}
                        </option>
                      ))}
                    </datalist>
                  </div>

                  <div className="space-y-2">
                    <Label>{dictionary.purchaseRequests.unitPriceOptional}</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      {...form.register(`items.${index}.unitPrice`)}
                    />
                    {form.formState.errors.items?.[index]?.unitPrice ? <p className="text-xs text-destructive">{translateMessage(form.formState.errors.items[index]?.unitPrice?.message, locale)}</p> : null}
                  </div>

                  <div className="space-y-2">
                    <Label>{dictionary.purchaseRequests.lineTotal}</Label>
                    <Input value={watchedItems[index]?.unitPrice === undefined || watchedItems[index]?.unitPrice === "" ? ux.unknown : formatCurrency(amount, locale)} readOnly />
                  </div>

                  <div className="space-y-2 xl:col-span-3">
                    <Label>{dictionary.purchaseRequests.description}</Label>
                    <Input {...form.register(`items.${index}.description`)} />
                  </div>

                  <div className="space-y-2 xl:col-span-3">
                    <Label>{dictionary.purchaseRequests.supplierName}</Label>
                    <Input
                      placeholder={dictionary.purchaseRequests.supplierNamePlaceholder}
                      {...form.register(`items.${index}.supplierName`)}
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() =>
                      itemsArray.fields.length > 1
                        ? itemsArray.remove(index)
                        : form.setValue("items", [{ ...itemDefaults }], { shouldDirty: true })
                    }
                  >
                    <Trash2 />
                    {dictionary.purchaseRequests.removeItem}
                  </Button>
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 px-4 py-4">
            <div>
              <p className="text-sm text-muted-foreground">
                {hasUnpricedItems ? ux.partial : dictionary.purchaseRequests.grandTotal}
              </p>
              <p className="text-2xl font-semibold">
                {formatCurrency(grandTotal, locale)}
              </p>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <p>
                {interpolate(dictionary.purchaseRequests.requesterLine, {
                  name: session.name,
                })}
              </p>
              <p>
                {interpolate(dictionary.purchaseRequests.departmentLine, {
                  department: getDepartmentLabel(watchedDepartment, locale),
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="size-5 text-primary" />
            {dictionary.purchaseRequests.attachmentsTitle}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {dictionary.purchaseRequests.attachmentsDescription}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="attachments">
              {dictionary.purchaseRequests.attachmentsInput}
            </Label>
            <Input
              id="attachments"
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
              onChange={(event) => {
                addAttachmentFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              {dictionary.purchaseRequests.attachmentsHint}
            </p>
          </div>

          <div
            role="button"
            tabIndex={0}
            className={cn(
              "rounded-2xl border border-dashed border-primary/30 bg-primary/5 px-4 py-5 text-center outline-none transition-colors hover:bg-primary/10 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20",
              isDraggingAttachments &&
                "border-primary bg-primary/15 ring-3 ring-primary/20",
            )}
            aria-label={dictionary.purchaseRequests.attachmentPasteTitle}
            onClick={(event) => event.currentTarget.focus()}
            onPaste={handleAttachmentPaste}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDraggingAttachments(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsDraggingAttachments(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setIsDraggingAttachments(false);
              }
            }}
            onDrop={handleAttachmentDrop}
          >
            <p className="text-sm font-medium">
              {dictionary.purchaseRequests.attachmentPasteTitle}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {dictionary.purchaseRequests.attachmentPasteHint}
            </p>
          </div>

          {attachmentFiles.length ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {dictionary.purchaseRequests.selectedAttachments}
              </p>
              <div className="grid gap-2">
                {attachmentFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <FileText className="size-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(file.size, locale)}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 rounded-full"
                      aria-label={dictionary.purchaseRequests.removeAttachment}
                      onClick={() => removeAttachmentFile(index)}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {initialData && existingAttachments.length ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {dictionary.purchaseRequests.existingAttachments}
              </p>
              <div className="grid gap-2">
                {existingAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 px-4 py-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {attachment.originalName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(attachment.size, locale)}
                      </span>
                    </span>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <AttachmentPreviewButton
                        requestId={initialData.id}
                        attachment={attachment}
                      />
                      <DownloadButton variant="outline" size="sm" className="rounded-xl" filename={attachment.originalName}
                          href={`/api/purchase-requests/${initialData.id}/attachments/${attachment.id}`}
                        >
                          <Download />
                          {dictionary.purchaseRequests.downloadAttachment}
                      </DownloadButton>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-full"
                        aria-label={dictionary.purchaseRequests.removeAttachment}
                        disabled={busy || Boolean(deletingAttachmentId)}
                        loading={deletingAttachmentId === attachment.id}
                        onClick={() => removeExistingAttachment(attachment.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isPurchasingReturnEdit ? (
        <Card className="border-border/70">
          <CardHeader className="space-y-2">
            <CardTitle>
              {dictionary.purchaseRequests.requesterCommentTitle}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {dictionary.purchaseRequests.requesterCommentDescription}
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="requesterComment">
                {dictionary.purchaseRequests.requesterCommentLabel}
              </Label>
              <Textarea
                id="requesterComment"
                rows={4}
                placeholder={dictionary.purchaseRequests.requesterCommentPlaceholder}
                {...form.register("requesterComment")}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card id="pr-form-review" tabIndex={-1} className="scroll-mt-24 border-primary/20 bg-primary/5">
        <CardHeader><CardTitle>{ux.review}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="break-words"><strong>{session.name}</strong> · {getDepartmentLabel(watchedDepartment, locale)} · {watchedDate}</p>
          <p className="whitespace-pre-wrap break-words">{watchedReason}</p>
          <p>{watchedItems.length} {dictionary.purchaseRequests.itemList} · {existingAttachments.length + attachmentFiles.length} {ux.attachments}</p>
          <p className="font-semibold">{hasUnpricedItems ? ux.partial : dictionary.purchaseRequests.grandTotal}: {formatCurrency(grandTotal, locale)}</p>
          {hasUnpricedItems ? <p>{ux.unknown}: {watchedItems.filter(item => item.unitPrice === undefined || item.unitPrice === null || item.unitPrice === "").length}</p> : null}
          <p className="text-muted-foreground">{ux.estimate}</p>
        </CardContent>
      </Card>
      <div className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-xl border border-border bg-background/95 p-4 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-end">
        <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">{unsaved ? ux.dirty : ux.hint}</p>
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          disabled={busy || Boolean(deletingAttachmentId)}
          loading={busy && pendingIntent === false}
          onClick={() => submit(false)}
        >
          {busy && pendingIntent === false ? dictionary.common.saving : dictionary.purchaseRequests.saveDraft}
        </Button>
        <Button
          type="button"
          className="rounded-xl"
          disabled={busy || Boolean(deletingAttachmentId)}
          loading={busy && pendingIntent === true}
          onClick={() => void reviewRequest()}
        >
          {busy && pendingIntent === true
            ? dictionary.common.sending
            : isPurchasingReturnEdit
              ? dictionary.purchaseRequests.resubmitToPurchasing
              : dictionary.purchaseRequests.saveAndSubmit}
        </Button>
      </div>
      <Dialog open={reviewOpen} onOpenChange={(open) => { if (!busy) setReviewOpen(open); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{ux.reviewTitle}</DialogTitle><DialogDescription>{ux.reviewHint}</DialogDescription></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>{session.name} · {getDepartmentLabel(watchedDepartment, locale)} · {watchedDate}</p>
            <p className="whitespace-pre-wrap break-words">{watchedReason}</p>
            {watchedItems.map((item, index) => <div key={index} className="rounded-xl border p-3"><p className="break-words font-medium">{item.itemName}</p><p>{String(item.quantity ?? "")} {item.unit} · {item.unitPrice === undefined || item.unitPrice === "" ? ux.unknown : formatCurrency(Number(item.unitPrice), locale)}</p></div>)}
            <p>{existingAttachments.length + attachmentFiles.length} {ux.attachments}</p>
            <p className="font-semibold">{hasUnpricedItems ? ux.partial : dictionary.purchaseRequests.grandTotal}: {formatCurrency(grandTotal, locale)}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setReviewOpen(false)}>{ux.back}</Button>
            <Button type="button" data-testid="confirm-pr-submit" disabled={busy} loading={busy && pendingIntent === true} onClick={() => submit(true)}>{ux.confirm}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </fieldset>
  );
}
