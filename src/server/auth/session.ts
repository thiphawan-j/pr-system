import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import type { SessionUser } from "@/lib/types";
import { AppError } from "@/server/shared/errors";

const sessionDurationInSeconds = 60 * 60 * 12;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("Missing JWT_SECRET environment variable");
  }

  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser) {
  return new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionDurationInSeconds}s`)
    .sign(getJwtSecret());
}

export async function verifySession(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());

    return {
      id: String(payload.id),
      employeeCode: String(payload.employeeCode),
      name: String(payload.name),
      username: payload.username ? String(payload.username) : null,
      phone: payload.phone ? String(payload.phone) : null,
      email: String(payload.email),
      department: String(payload.department),
      role: payload.role as SessionUser["role"],
      title: payload.title ? String(payload.title) : null,
    } satisfies SessionUser;
  } catch {
    return null;
  }
}

export const getCurrentSession = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return verifySession(token);
});

export async function requireSession() {
  const session = await getCurrentSession();

  if (!session) {
    throw new AppError("กรุณาเข้าสู่ระบบก่อนใช้งาน", 401);
  }

  return session;
}

export function getSessionCookieConfig() {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionDurationInSeconds,
  };
}
