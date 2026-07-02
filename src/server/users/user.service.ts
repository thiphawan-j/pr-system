import "server-only";

import type { Prisma } from "@prisma/client";
import { Role } from "@prisma/client";
import type { AdminUserItem, SessionUser } from "@/lib/types";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { getDb } from "@/server/db";
import { AppError } from "@/server/shared/errors";
import {
  type AdminResetPasswordInput,
  normalizePhone,
  normalizeUsername,
  type ChangePasswordInput,
  type CreateUserInput,
  type UpdateUserInput,
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

function toAdminUserItem(user: {
  id: string;
  employeeCode: string;
  name: string;
  username: string | null;
  phone: string | null;
  email: string;
  department: string;
  role: Role;
  title: string | null;
  isActive: boolean;
}) {
  return {
    ...toSessionUser(user),
    isActive: user.isActive,
  } satisfies AdminUserItem;
}

async function countActiveAdmins(excludedUserId?: string) {
  const db = getDb();

  return db.user.count({
    where: {
      role: Role.ADMIN,
      isActive: true,
      id: excludedUserId ? { not: excludedUserId } : undefined,
    },
  });
}

function buildUserConflictMessage(
  existingUser: {
    employeeCode: string | null;
    username: string | null;
    phone: string | null;
    email: string | null;
  } | null,
  input: {
    employeeCode: string;
    username: string;
    phone: string;
    email: string;
  },
) {
  if (existingUser?.employeeCode === input.employeeCode) {
    return "รหัสพนักงานนี้ถูกใช้งานแล้ว";
  }

  if (existingUser?.username === input.username) {
    return "username นี้ถูกใช้งานแล้ว";
  }

  if (existingUser?.phone === input.phone) {
    return "เบอร์โทรนี้ถูกใช้งานแล้ว";
  }

  if (existingUser?.email === input.email) {
    return "อีเมลนี้ถูกใช้งานแล้ว";
  }

  return null;
}

async function assertUniqueUserIdentity(input: {
  employeeCode: string;
  username: string;
  phone: string;
  email: string;
  excludedUserId?: string;
}) {
  const db = getDb();
  const existingUser = await db.user.findFirst({
    where: {
      id: input.excludedUserId ? { not: input.excludedUserId } : undefined,
      OR: [
        { employeeCode: input.employeeCode },
        { username: input.username },
        { phone: input.phone },
        { email: input.email },
      ],
    },
    select: {
      employeeCode: true,
      username: true,
      phone: true,
      email: true,
    },
  });

  const conflictMessage = buildUserConflictMessage(existingUser, input);

  if (conflictMessage) {
    throw new AppError(conflictMessage, 409);
  }
}

async function assertActiveAdminWillRemain(input: {
  userId: string;
  currentRole: Role;
  currentIsActive: boolean;
  nextRole: Role;
  nextIsActive: boolean;
}) {
  const isCurrentlyActiveAdmin = input.currentRole === Role.ADMIN && input.currentIsActive;
  const willRemainActiveAdmin = input.nextRole === Role.ADMIN && input.nextIsActive;

  if (!isCurrentlyActiveAdmin || willRemainActiveAdmin) {
    return;
  }

  const otherActiveAdmins = await countActiveAdmins(input.userId);

  if (otherActiveAdmins === 0) {
    throw new AppError(
      "ต้องมีผู้ดูแลระบบที่เปิดใช้งานอย่างน้อย 1 บัญชี",
      400,
    );
  }
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

  if (!matchedUser.isActive) {
    throw new AppError("บัญชีผู้ใช้งานนี้ถูกปิดการใช้งาน", 403);
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

export async function findActiveUserById(userId: string) {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user || !user.isActive) {
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
        isActive: true,
        department,
      },
      orderBy: { createdAt: "asc" },
    })) ??
    (await db.user.findFirst({
      where: {
        role: Role.ADMIN,
        isActive: true,
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
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
    })) ??
    (await db.user.findFirst({
      where: {
        role: Role.ADMIN,
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
    }));

  return user ? toSessionUser(user) : null;
}

export async function listAllUsers() {
  const db = getDb();
  const users = await db.user.findMany({
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
  });

  return users.map(toAdminUserItem);
}

export async function createUser(input: CreateUserInput) {
  const employeeCode = input.employeeCode.trim();
  const username = input.username;
  const phone = input.phone;
  const email = input.email.toLowerCase().trim();
  const db = getDb();

  await assertUniqueUserIdentity({
    employeeCode,
    username,
    phone,
    email,
  });

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

export async function updateUser(userId: string, input: UpdateUserInput) {
  const db = getDb();
  const existingUser = await db.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    throw new AppError("ไม่พบบัญชีผู้ใช้งาน", 404);
  }

  const employeeCode = input.employeeCode.trim();
  const username = input.username;
  const phone = input.phone;
  const email = input.email.toLowerCase().trim();

  await assertUniqueUserIdentity({
    employeeCode,
    username,
    phone,
    email,
    excludedUserId: existingUser.id,
  });

  await assertActiveAdminWillRemain({
    userId: existingUser.id,
    currentRole: existingUser.role,
    currentIsActive: existingUser.isActive,
    nextRole: input.role,
    nextIsActive: existingUser.isActive,
  });

  const updatedUser = await db.user.update({
    where: { id: existingUser.id },
    data: {
      employeeCode,
      name: input.name.trim(),
      username,
      phone,
      email,
      department: input.department,
      role: input.role,
      title: input.title,
    },
  });

  return toAdminUserItem(updatedUser);
}

export async function resetUserPasswordByAdmin(
  userId: string,
  input: AdminResetPasswordInput,
) {
  const db = getDb();
  const existingUser = await db.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    throw new AppError("ไม่พบบัญชีผู้ใช้งาน", 404);
  }

  const isSamePassword = await verifyPassword(
    input.newPassword,
    existingUser.passwordHash,
  );

  if (isSamePassword) {
    throw new AppError("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน", 400);
  }

  const passwordHash = await hashPassword(input.newPassword);

  await db.user.update({
    where: { id: existingUser.id },
    data: { passwordHash },
  });
}

export async function setUserActiveStatus(
  userId: string,
  actingAdminId: string,
  isActive: boolean,
) {
  const db = getDb();
  const existingUser = await db.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    throw new AppError("ไม่พบบัญชีผู้ใช้งาน", 404);
  }

  if (existingUser.id === actingAdminId && !isActive) {
    throw new AppError("ไม่สามารถปิดการใช้งานบัญชีของตัวเองได้", 400);
  }

  await assertActiveAdminWillRemain({
    userId: existingUser.id,
    currentRole: existingUser.role,
    currentIsActive: existingUser.isActive,
    nextRole: existingUser.role,
    nextIsActive: isActive,
  });

  const updatedUser = await db.user.update({
    where: { id: existingUser.id },
    data: { isActive },
  });

  return toAdminUserItem(updatedUser);
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
