"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileText, Paperclip, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useI18n } from "@/components/i18n/i18n-provider";
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
import { Textarea } from "@/components/ui/textarea";
import { departments, units } from "@/lib/constants";
import { formatCurrency, formatFileSize } from "@/lib/format";
import { interpolate, translateMessage } from "@/lib/i18n";
import { priorities } from "@/lib/types";
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
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const { dictionary, locale } = useI18n();
  const form = useForm<
    PurchaseRequestFormValues,
    undefined,
    PurchaseRequestFormPayload
  >({
    resolver: zodResolver(purchaseRequestPayloadSchema),
    defaultValues: initialData
      ? {
          requestDate: initialData.requestDate.slice(0, 10),
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
        }
      : {
          requestDate: new Date().toISOString().slice(0, 10),
          department: session.department as PurchaseRequestFormValues["department"],
          reason: "",
          urgency: "NORMAL",
          items: [{ ...itemDefaults }],
          submit: false,
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

  const grandTotal = useMemo(
    () =>
      watchedItems.reduce((sum, item) => {
        const quantity = Number(item?.quantity ?? 0);
        const unitPrice = Number(item?.unitPrice ?? 0);
        return sum + quantity * unitPrice;
      }, 0),
    [watchedItems],
  );

  function addAttachmentFiles(fileList: FileList | null) {
    if (!fileList?.length) {
      return;
    }

    setAttachmentFiles((currentFiles) => [
      ...currentFiles,
      ...Array.from(fileList),
    ]);
  }

  function removeAttachmentFile(index: number) {
    setAttachmentFiles((currentFiles) =>
      currentFiles.filter((_, fileIndex) => fileIndex !== index),
    );
  }

  function submit(submit: boolean) {
    form.setValue("submit", submit);
    form.handleSubmit((values: PurchaseRequestFormPayload) => {
      setIsPending(true);
      startTransition(async () => {
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
        setIsPending(false);

        if (!response.ok) {
          toast.error(
            translateMessage(responsePayload?.error, locale) ??
              dictionary.purchaseRequests.saveError,
          );
          return;
        }

        toast.success(
          submit
            ? dictionary.purchaseRequests.submittedSaved
            : dictionary.purchaseRequests.draftSaved,
        );
        router.push(`/purchase-requests/${responsePayload.id}`);
        router.refresh();
      });
    })();
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>{dictionary.purchaseRequests.headerInfo}</CardTitle>
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
                form.setValue("department", value as PurchaseRequestFormValues["department"])
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={dictionary.purchaseRequests.departmentPlaceholder}
                />
              </SelectTrigger>
              <SelectContent>
                {departments.map((department) => (
                  <SelectItem key={department} value={department}>
                    {department}
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
                form.setValue("urgency", value as PurchaseRequestFormValues["urgency"])
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

      <Card className="border-border/70">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{dictionary.purchaseRequests.itemList}</CardTitle>
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
                  </div>

                  <div className="space-y-2">
                    <Label>{dictionary.purchaseRequests.lineTotal}</Label>
                    <Input value={formatCurrency(amount, locale)} readOnly />
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
                        : form.setValue("items", [{ ...itemDefaults }])
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
                {dictionary.purchaseRequests.grandTotal}
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
                  department: session.department,
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

          {initialData?.attachments.length ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {dictionary.purchaseRequests.existingAttachments}
              </p>
              <div className="grid gap-2">
                {initialData.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={`/api/purchase-requests/${initialData.id}/attachments/${attachment.id}`}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 px-4 py-3 text-sm transition-colors hover:bg-muted/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {attachment.originalName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(attachment.size, locale)}
                      </span>
                    </span>
                    <span className="text-xs text-primary">
                      {dictionary.purchaseRequests.downloadAttachment}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          disabled={isPending}
          onClick={() => submit(false)}
        >
          {isPending ? dictionary.common.saving : dictionary.purchaseRequests.saveDraft}
        </Button>
        <Button
          type="button"
          className="rounded-xl"
          disabled={isPending}
          onClick={() => submit(true)}
        >
          {isPending
            ? dictionary.common.sending
            : dictionary.purchaseRequests.saveAndSubmit}
        </Button>
      </div>
    </div>
  );
}
