import "server-only";

import type { Prisma } from "@prisma/client";
import { Role } from "@prisma/client";
import type { SessionUser } from "@/lib/types";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { getDb } from "@/server/db";
import { AppError } from "@/server/shared/errors";
import {
  normalizePhone,
  normalizeUsername,
  type ChangePasswordInput,
  type CreateUserInput,
} from "@/server/users/user.schemas";

function toSessionUser(user: {
  id: string;
  employeeCode: string;
  name: string;
  username: string | null;
  phone: string | null;
  email: string;
  department: string;
  role: Role;
  title: string | null;
}) {
  return {
    id: user.id,
    employeeCode: user.employeeCode,
    name: user.name,
    username: user.username,
    phone: user.phone,
    email: user.email,
    department: user.department,
    role: user.role,
    title: user.title,
  } satisfies SessionUser;
}

export async function authenticateUser(identifier: string, password: string) {
  const db = getDb();
  const normalizedIdentifier = identifier.trim();
  const normalizedPhone = normalizePhone(normalizedIdentifier);
  const where: Prisma.UserWhereInput[] = [
    { email: normalizedIdentifier.toLowerCase() },
    { username: normalizeUsername(normalizedIdentifier) },
  ];

  if (/^\+?\d{9,15}$/.test(normalizedPhone)) {
    where.push({ phone: normalizedPhone });
  }

  const matchedUser = await db.user.findFirst({
    where: {
      OR: where,
    },
  });

  if (!matchedUser) {
    throw new AppError("ข้อมูลเข้าสู่ระบบหรือรหัสผ่านไม่ถูกต้อง", 401);
  }

  const isPasswordValid = await verifyPassword(password, matchedUser.passwordHash);

  if (!isPasswordValid) {
    throw new AppError("ข้อมูลเข้าสู่ระบบหรือรหัสผ่านไม่ถูกต้อง", 401);
  }

  return toSessionUser(matchedUser);
}

export async function findUserById(userId: string) {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return null;
  }

  return toSessionUser(user);
}

export async function findApproverForDepartment(department: string) {
  const db = getDb();

  const approver =
    (await db.user.findFirst({
      where: {
        role: Role.APPROVER,
        department,
      },
      orderBy: { createdAt: "asc" },
    })) ??
    (await db.user.findFirst({
      where: {
        role: Role.ADMIN,
      },
      orderBy: { createdAt: "asc" },
    }));

  return approver ? toSessionUser(approver) : null;
}

export async function findPrimaryPurchasingUser() {
  const db = getDb();

  const user =
    (await db.user.findFirst({
      where: {
        role: Role.PURCHASING,
      },
      orderBy: { createdAt: "asc" },
    })) ??
    (await db.user.findFirst({
      where: {
        role: Role.ADMIN,
      },
      orderBy: { createdAt: "asc" },
    }));

  return user ? toSessionUser(user) : null;
}

export async function listAllUsers() {
  const db = getDb();
  const users = await db.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return users.map(toSessionUser);
}

export async function createUser(input: CreateUserInput) {
  const db = getDb();
  const employeeCode = input.employeeCode.trim();
  const username = input.username;
  const phone = input.phone;
  const email = input.email.toLowerCase().trim();

  const existingUser = await db.user.findFirst({
    where: {
      OR: [{ employeeCode }, { username }, { phone }, { email }],
    },
    select: {
      employeeCode: true,
      username: true,
      phone: true,
      email: true,
    },
  });

  if (existingUser?.employeeCode === employeeCode) {
    throw new AppError("รหัสพนักงานนี้ถูกใช้งานแล้ว", 409);
  }

  if (existingUser?.username === username) {
    throw new AppError("username นี้ถูกใช้งานแล้ว", 409);
  }

  if (existingUser?.phone === phone) {
    throw new AppError("เบอร์โทรนี้ถูกใช้งานแล้ว", 409);
  }

  if (existingUser?.email === email) {
    throw new AppError("อีเมลนี้ถูกใช้งานแล้ว", 409);
  }

  const passwordHash = await hashPassword(input.password);
  const user = await db.user.create({
    data: {
      employeeCode,
      name: input.name.trim(),
      username,
      phone,
      email,
      passwordHash,
      department: input.department,
      role: input.role,
      title: input.title,
    },
  });

  return toSessionUser(user);
}

export async function changeOwnPassword(
  session: SessionUser,
  input: ChangePasswordInput,
) {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: session.id },
  });

  if (!user) {
    throw new AppError("ไม่พบบัญชีผู้ใช้งาน", 404);
  }

  const isCurrentPasswordValid = await verifyPassword(
    input.currentPassword,
    user.passwordHash,
  );

  if (!isCurrentPasswordValid) {
    throw new AppError("รหัสผ่านปัจจุบันไม่ถูกต้อง", 400);
  }

  const isSamePassword = await verifyPassword(
    input.newPassword,
    user.passwordHash,
  );

  if (isSamePassword) {
    throw new AppError("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน", 400);
  }

  const passwordHash = await hashPassword(input.newPassword);

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
}
