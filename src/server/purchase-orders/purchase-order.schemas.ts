import { z } from "zod";
import { supplierContactSchema } from "@/server/suppliers/supplier.schemas";

const optionalText = (max: number) => z.string().trim().max(max).optional()
  .transform((value) => value || undefined);

const orderFields = {
  deliveryAddress: optionalText(2000),
  expectedDeliveryDate: z.iso.date("กรุณาระบุวันที่ส่งมอบที่ถูกต้อง").optional(),
  note: optionalText(2000),
  itemIds: z.array(z.string().min(1).max(100)).min(1).max(500),
};

const registeredOrderSchema = z.object({
  ...orderFields,
  supplierId: z.string().min(1).max(100),
}).strict();

const manualOrderSchema = z.object({
    ...orderFields,
    supplierName: z.string().trim().min(1, "กรุณาระบุผู้ขายของทุกรายการ").max(200),
    supplierAddress: optionalText(2000),
    supplierContact: optionalText(200),
    paymentTerms: optionalText(500),
}).strict();

export const purchaseOrderConversionSchema = z.object({
  orders: z.array(z.union([registeredOrderSchema, manualOrderSchema]))
    .min(1, "กรุณาระบุใบสั่งซื้ออย่างน้อยหนึ่งใบ").max(500),
}).strict().superRefine(({ orders }, context) => {
  const suppliers = orders.map((order) => "supplierId" in order
    ? `registered:${order.supplierId}`
    : `manual:${order.supplierName.normalize("NFKC").toLowerCase()}`);
  if (new Set(suppliers).size !== suppliers.length) {
    context.addIssue({ code: "custom", path: ["orders"], message: "กรุณารวมรายการของผู้ขายเดียวกันไว้ใน PO เดียว" });
  }
  const itemIds = orders.flatMap((order) => order.itemIds);
  if (new Set(itemIds).size !== itemIds.length) {
    context.addIssue({ code: "custom", path: ["orders"], message: "รายการสินค้าซ้ำกัน" });
  }
});

export type PurchaseOrderConversionInput = z.infer<typeof purchaseOrderConversionSchema>;

const supplierOverrides = {
  supplierTaxId: optionalText(50),
  supplierAddress: optionalText(2000),
  supplierContactPerson: optionalText(200),
  supplierContact: optionalText(200),
  supplierContacts: z.array(supplierContactSchema).max(5).refine(
    (contacts) => new Set(contacts.map((contact) => contact.channel)).size === contacts.length,
    "ช่องทางติดต่อซ้ำกัน",
  ).optional(),
};

export const purchaseOrderChangeSchema = z.object({
  expectedVersion: z.number().int().nonnegative().max(2147483646),
  reason: z.string().trim().min(5, "กรุณาระบุเหตุผลการแก้ไขอย่างน้อย 5 ตัวอักษร").max(2000),
  supplier: z.union([
    z.object({ supplierId: z.string().min(1).max(100), supplierName: z.string().trim().min(1).max(200).optional(), ...supplierOverrides }).strict(),
    z.object({ supplierName: z.string().trim().min(1, "กรุณาระบุผู้ขาย").max(200), ...supplierOverrides }).strict(),
  ]),
  deliveryAddress: optionalText(2000),
  paymentTerms: optionalText(500),
  expectedDeliveryDate: z.union([z.iso.date("กรุณาระบุวันที่ส่งมอบที่ถูกต้อง"), z.literal("")]).optional(),
  note: optionalText(2000),
  items: z.array(z.object({
    id: z.string().min(1).max(100).optional(),
    itemName: z.string().trim().min(1, "กรุณาระบุชื่อสินค้า").max(200),
    description: optionalText(2000),
    quantity: z.number().int().positive().max(2147483647),
    unit: optionalText(50),
    unitPrice: z.number().finite().nonnegative().max(9999999999.99).multipleOf(0.01, "ราคาต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง"),
  }).strict()).min(1, "PO ต้องมีสินค้าอย่างน้อยหนึ่งรายการ").max(500),
}).strict();

export const purchaseOrderChangeReviewSchema = z.object({
  expectedVersion: z.number().int().nonnegative().max(2147483646),
  action: z.enum(["APPROVED", "REJECTED"]),
  comment: optionalText(2000),
}).strict().superRefine((input, context) => {
  if (input.action === "REJECTED" && (!input.comment || input.comment.length < 5)) {
    context.addIssue({ code: "custom", path: ["comment"], message: "กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร" });
  }
});

export type PurchaseOrderChangeInput = z.output<typeof purchaseOrderChangeSchema>;
export type PurchaseOrderChangeReviewInput = z.output<typeof purchaseOrderChangeReviewSchema>;
