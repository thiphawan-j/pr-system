import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

function getFirstZodMessage(error: ZodError) {
  return error.issues[0]?.message ?? "ข้อมูลที่ส่งมาไม่ถูกต้อง";
}

function isSchemaMismatchError(error: Prisma.PrismaClientKnownRequestError) {
  if (error.code === "P2022") {
    return true;
  }

  if (error.code !== "P2011") {
    return false;
  }

  return JSON.stringify(error.meta ?? {}).includes("unitPrice");
}

function isEnumSchemaMismatchError(error: unknown) {
  return (
    error instanceof Error &&
    /invalid input value for enum|value .* does not exist in enum/i.test(
      error.message,
    )
  );
}

function databaseMigrationRequiredResponse() {
  return NextResponse.json(
    {
      error:
        "ฐานข้อมูลของระบบยังไม่อัปเดต กรุณาแจ้งผู้ดูแลระบบให้รัน migration ล่าสุด",
    },
    { status: 500 },
  );
}

function toPrismaErrorResponse(error: Prisma.PrismaClientKnownRequestError) {
  if (isSchemaMismatchError(error)) {
    return databaseMigrationRequiredResponse();
  }

  if (error.code === "P2002") {
    return NextResponse.json(
      { error: "ข้อมูลนี้ถูกสร้างซ้ำในระบบ กรุณาลองใหม่อีกครั้ง" },
      { status: 409 },
    );
  }

  return null;
}

function toErrorLogPayload(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      type: "PrismaClientKnownRequestError",
      code: error.code,
      message: error.message,
      meta: error.meta,
    };
  }

  if (error instanceof ZodError) {
    return {
      type: "ZodError",
      issues: error.issues,
    };
  }

  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { type: typeof error, error };
}

export function invariant(
  condition: unknown,
  message: string,
  statusCode = 400,
): asserts condition {
  if (!condition) {
    throw new AppError(message, statusCode);
  }
}

export function toErrorResponse(error: unknown) {
  if (isAppError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  if (error instanceof ZodError) {
    return NextResponse.json({ error: getFirstZodMessage(error) }, { status: 400 });
  }

  if (isEnumSchemaMismatchError(error)) {
    console.error("[api-error]", toErrorLogPayload(error));
    return databaseMigrationRequiredResponse();
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const response = toPrismaErrorResponse(error);

    if (response) {
      console.error("[api-error]", toErrorLogPayload(error));
      return response;
    }
  }

  console.error("[api-error]", toErrorLogPayload(error));

  return NextResponse.json(
    { error: "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง" },
    { status: 500 },
  );
}
