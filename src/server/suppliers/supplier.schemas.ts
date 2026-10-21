import { z } from "zod";
import { supplierContactChannels } from "@/lib/types";

const optionalText = (max: number) => z.string().trim().max(max).optional()
  .transform((value) => value || undefined);

export const supplierContactSchema = z.object({
  channel: z.enum(supplierContactChannels, { error: "กรุณาเลือกช่องทางติดต่อที่รองรับ" }),
  value: z.string().trim().min(1, "กรุณาระบุรายละเอียดของช่องทางติดต่อที่เลือก").max(500),
}).strict();

const supplierFields = {
  name: z.string().trim().min(1, "กรุณาระบุชื่อผู้ขาย").max(200),
  taxId: optionalText(50),
  address: optionalText(2000),
  contactPerson: optionalText(200),
  paymentTerms: optionalText(500),
  note: optionalText(2000),
  contacts: z.array(supplierContactSchema).min(1, "กรุณาเลือกช่องทางติดต่ออย่างน้อยหนึ่งช่องทาง").max(5)
    .refine((contacts) => new Set(contacts.map((contact) => contact.channel)).size === contacts.length, "ช่องทางติดต่อซ้ำกัน"),
};

export const createSupplierSchema = z.object(supplierFields).strict();
export const updateSupplierSchema = z.object({
  ...supplierFields,
  expectedVersion: z.number().int().nonnegative().max(2147483647),
  isActive: z.boolean(),
}).strict();

export const supplierFiltersSchema = z.object({
  query: optionalText(200),
  status: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSupplierInput = z.output<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.output<typeof updateSupplierSchema>;
export type SupplierFilters = z.output<typeof supplierFiltersSchema>;
