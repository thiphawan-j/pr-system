import { z } from "zod";

const nameSchema = z.string().trim().min(1, "กรุณาระบุชื่อบริษัท").max(200);
const addressSchema = z.string().trim().min(1, "กรุณาระบุที่อยู่บริษัท").max(2000);
const emailSchema = z.string().trim().max(254).email("รูปแบบอีเมลไม่ถูกต้อง");

/** The exact shape stored on an issued PO; no settings metadata is included. */
export const companyIdentitySchema = z.object({
  name: nameSchema,
  address: addressSchema,
  taxId: z.string().trim().max(50).nullable(),
  branch: z.string().trim().max(100).nullable(),
  phone: z.string().trim().max(100).nullable(),
  email: emailSchema.nullable(),
}).strict();

const optionalText = (max: number) => z.string().trim().max(max).nullish()
  .transform((value) => value || null);
const optionalEmail = z.string().trim().nullish()
  .transform((value) => value || null)
  .pipe(emailSchema.nullable());

export const updateCompanyProfileSchema = z.object({
  name: nameSchema,
  address: addressSchema,
  taxId: optionalText(50),
  branch: optionalText(100),
  phone: optionalText(100),
  email: optionalEmail,
  expectedVersion: z.number().int().nonnegative().max(2147483647),
}).strict();

export type UpdateCompanyProfileInput = z.output<typeof updateCompanyProfileSchema>;
