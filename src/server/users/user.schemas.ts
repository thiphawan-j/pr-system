import { z } from "zod";

import { adminUserListPageSize, departments } from "@/lib/constants";
import { roles } from "@/lib/types";

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

const usernamePattern = /^[a-z0-9._-]+$/;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string) {
  const trimmed = value.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digitsOnly = trimmed.replace(/\D/g, "");

  if (!digitsOnly) {
    return "";
  }

  return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
}

const userFieldsSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .min(2, "กรุณาระบุรหัสพนักงานอย่างน้อย 2 ตัวอักษร")
    .max(30, "รหัสพนักงานต้องไม่เกิน 30 ตัวอักษร"),
  name: z
    .string()
    .trim()
    .min(2, "กรุณาระบุชื่อผู้ใช้อย่างน้อย 2 ตัวอักษร"),
  username: z
    .string()
    .trim()
    .min(3, "กรุณาระบุ username อย่างน้อย 3 ตัวอักษร")
    .max(30, "username ต้องไม่เกิน 30 ตัวอักษร")
    .regex(
      usernamePattern,
      "username ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง",
    )
    .transform(normalizeUsername),
  phone: z
    .string()
    .trim()
    .transform(normalizePhone)
    .refine(
      (value) => /^\+?\d{9,15}$/.test(value),
      "กรุณาระบุเบอร์โทรให้ถูกต้อง",
    ),
  email: z.email("กรุณาระบุอีเมลให้ถูกต้อง").transform((value) =>
    value.toLowerCase().trim(),
  ),
  department: z.enum(departments, { error: "กรุณาเลือกแผนก" }),
  role: z.enum(roles, { error: "กรุณาเลือกบทบาทผู้ใช้งาน" }),
  title: optionalTrimmedString,
});

export const createUserSchema = userFieldsSchema.extend({
  password: z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"),
});

export const updateUserSchema = userFieldsSchema;

export const adminResetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร"),
    confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่านใหม่"),
  })
  .superRefine((value, ctx) => {
    if (value.newPassword !== value.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน",
      });
    }
  });

export const setUserActiveSchema = z.object({
  isActive: z.boolean(),
});

export const adminUsersPaginationSchema = z.object({
  page: optionalPositiveInteger.default(1),
  limit: optionalPageSizeInteger.default(adminUserListPageSize),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "กรุณาระบุรหัสผ่านปัจจุบัน"),
    newPassword: z.string().min(8, "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร"),
    confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่านใหม่"),
  })
  .superRefine((value, ctx) => {
    if (value.newPassword !== value.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน",
      });
    }
  });

export type CreateUserInput = z.output<typeof createUserSchema>;
export type UpdateUserInput = z.output<typeof updateUserSchema>;
export type ChangePasswordInput = z.output<typeof changePasswordSchema>;
export type AdminResetPasswordInput = z.output<typeof adminResetPasswordSchema>;
export type SetUserActiveInput = z.output<typeof setUserActiveSchema>;
