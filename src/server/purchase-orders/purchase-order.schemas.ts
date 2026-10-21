import { z } from "zod";

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
