import { z } from "zod";

import { departments } from "@/lib/constants";
import {
  filterablePurchaseRequestStatuses,
  priorities,
  purchaseRequestQuickFilters,
} from "@/lib/types";

const optionalTrimmedString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const positiveInteger = z.coerce.number().int().positive();

const optionalPositiveInteger = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }

    return value;
  },
  positiveInteger.optional(),
);

const optionalPageSizeInteger = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }

    return value;
  },
  positiveInteger.max(100).optional(),
);

const optionalPositiveNumber = z.preprocess(
  (value) => {
    if (
      value === "" ||
      value === null ||
      value === undefined ||
      (typeof value === "number" && Number.isNaN(value))
    ) {
      return undefined;
    }

    return value;
  },
  z.coerce.number().nonnegative("ราคาต่อหน่วยต้องไม่ติดลบ").optional(),
);

export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(2, "กรุณาระบุอีเมล username หรือเบอร์โทร"),
  password: z.string().min(6, "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"),
});

export const purchaseRequestItemSchema = z
  .object({
    id: z.string().optional(),
    itemName: z.string().trim().min(1, "กรุณาระบุชื่อสินค้า"),
    description: optionalTrimmedString,
    supplierName: optionalTrimmedString,
    quantity: z.coerce.number().int().positive("จำนวนต้องมากกว่า 0"),
    unit: optionalTrimmedString,
    unitPrice: optionalPositiveNumber,
    amount: z.coerce.number().nonnegative(),
  })
  .transform((item) => ({
    ...item,
    amount: Number((item.quantity * (item.unitPrice ?? 0)).toFixed(2)),
  }));

export const purchaseRequestPayloadSchema = z.object({
  requestDate: z.iso.date("กรุณาระบุวันที่เอกสาร"),
  department: z.enum(departments, { error: "กรุณาเลือกแผนก" }),
  reason: z.string().trim().min(10, "กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร"),
  urgency: z.enum(priorities, { error: "กรุณาเลือกระดับความเร่งด่วน" }),
  items: z.array(purchaseRequestItemSchema).min(1, "ต้องมีอย่างน้อย 1 รายการ"),
  submit: z.boolean().optional().default(false),
  requesterComment: optionalTrimmedString,
});

export const purchaseRequestFiltersSchema = z.object({
  query: optionalTrimmedString,
  status: z.preprocess(
    (value) => (value === "SUBMITTED" ? "ALL" : value),
    z
      .enum(["ALL", ...filterablePurchaseRequestStatuses] as const)
      .optional()
      .default("ALL"),
  ),
  urgency: z
    .enum(["ALL", ...priorities] as const)
    .optional()
    .default("ALL"),
  preset: z.enum(purchaseRequestQuickFilters).optional(),
  department: z
    .enum(["ALL", ...departments] as const)
    .optional()
    .default("ALL"),
  from: optionalTrimmedString,
  to: optionalTrimmedString,
  sort: z.preprocess(
    (value) => {
      if (value === "newest") {
        return "pr_desc";
      }

      if (value === "oldest") {
        return "pr_asc";
      }

      if (value === "amount_desc" || value === "amount_asc") {
        return "pr_desc";
      }

      return value;
    },
    z
      .enum(["pr_desc", "pr_asc", "updated_desc", "status_asc"])
      .optional()
      .default("updated_desc"),
  ),
});

export const purchaseRequestPaginationSchema = z.object({
  page: optionalPositiveInteger.default(1),
  limit: optionalPageSizeInteger.default(20),
});

export const approvalDecisionSchema = z
  .object({
    action: z.enum(["APPROVED", "REJECTED", "RETURNED"]),
    comment: optionalTrimmedString,
  })
  .superRefine((value, ctx) => {
    if (
      (value.action === "REJECTED" || value.action === "RETURNED") &&
      !value.comment
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comment"],
        message: "กรุณาระบุเหตุผลหรือหมายเหตุประกอบการดำเนินการ",
      });
    }
  });

export const purchaseRequestCommentSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(1, "กรุณาระบุหมายเหตุ")
    .max(2000, "หมายเหตุต้องไม่เกิน 2,000 ตัวอักษร"),
});

export const purchasingProgressSchema = z
  .object({
    action: z.enum([
      "ORDERED",
      "RECEIVED",
      "REQUEST_REVISION",
      "REQUEST_CLARIFICATION",
    ]),
    comment: optionalTrimmedString,
    receivedDate: z.iso.date("กรุณาระบุวันที่รับของ").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "RECEIVED" && !value.receivedDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receivedDate"],
        message: "กรุณาระบุวันที่รับของ",
      });
    }

    if (
      (value.action === "REQUEST_REVISION" ||
        value.action === "REQUEST_CLARIFICATION") &&
      !value.comment
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comment"],
        message: "กรุณาระบุเหตุผลหรือคำถามประกอบการดำเนินการ",
      });
    }
  });

export const receiptReferenceSchema = z
  .object({
    receiptNumber: optionalTrimmedString,
    taxInvoiceNumber: optionalTrimmedString,
    note: optionalTrimmedString,
  })
  .superRefine((value, ctx) => {
    if (!value.receiptNumber && !value.taxInvoiceNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receiptNumber"],
        message: "กรุณาระบุหมายเลขรับของหรือเลขที่ใบกำกับภาษี",
      });
    }
  });
