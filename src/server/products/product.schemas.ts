import { z } from "zod";

export function normalizeProductName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

const name = z.string().trim().min(1, "กรุณาระบุชื่อสินค้า").max(200);
export const createProductSchema = z.object({
  code: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "รหัสสินค้าใช้ตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง").transform((v) => v.toUpperCase()),
  name,
  unit: z.string().trim().min(1, "กรุณาระบุหน่วยสินค้า").max(50),
}).strict();
export const createProductAliasSchema = z.object({
  name,
  context: z.string().trim().max(100).default(""),
  confirmed: z.literal(true, { error: "กรุณายืนยันว่าชื่อนี้หมายถึงสินค้าเดียวกัน" }),
}).strict();
export const productFiltersSchema = z.object({
  query: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type CreateProductAliasInput = z.infer<typeof createProductAliasSchema>;
export type ProductFilters = z.infer<typeof productFiltersSchema>;
