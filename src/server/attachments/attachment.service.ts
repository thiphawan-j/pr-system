import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import type {
  PurchaseRequestAttachmentInput,
  SessionUser,
} from "@/lib/types";
import {
  isAdmin,
  isPurchasing,
} from "@/server/auth/authorization";
import { getDb } from "@/server/db";
import { AppError } from "@/server/shared/errors";

const storageRoot = path.join(process.cwd(), "storage");
const attachmentStorageRoot = path.join(storageRoot, "pr-attachments");
const maxAttachmentCount = 10;
const maxAttachmentSize = 10 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

function isAllowedMimeType(mimeType: string) {
  return mimeType.startsWith("image/") || allowedMimeTypes.has(mimeType);
}

function sanitizeFileName(fileName: string) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const safeBaseName =
    baseName
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "attachment";

  return `${safeBaseName}${extension.toLowerCase()}`;
}

function getRelativeAttachmentPath(storedName: string) {
  return path.posix.join("pr-attachments", storedName);
}

function getAbsoluteAttachmentPath(storagePath: string) {
  const resolvedPath = path.resolve(storageRoot, storagePath);

  if (!resolvedPath.startsWith(storageRoot)) {
    throw new AppError("Invalid attachment path", 400);
  }

  return resolvedPath;
}

export function getFilesFromFormData(formData: FormData) {
  return formData
    .getAll("attachments")
    .filter((value): value is File => value instanceof File && value.size > 0);
}

export function validateAttachmentFiles(files: File[]) {
  if (files.length > maxAttachmentCount) {
    throw new AppError(`แนบไฟล์ได้สูงสุด ${maxAttachmentCount} ไฟล์`, 400);
  }

  for (const file of files) {
    if (file.size > maxAttachmentSize) {
      throw new AppError(`ไฟล์ ${file.name} มีขนาดเกิน 10 MB`, 400);
    }

    if (!isAllowedMimeType(file.type)) {
      throw new AppError(`ไม่รองรับประเภทไฟล์ ${file.name}`, 400);
    }
  }
}

export async function saveAttachmentFiles(files: File[]) {
  validateAttachmentFiles(files);
  await mkdir(attachmentStorageRoot, { recursive: true });

  const savedFiles: PurchaseRequestAttachmentInput[] = [];

  try {
    for (const file of files) {
      const safeName = sanitizeFileName(file.name);
      const storedName = `${randomUUID()}-${safeName}`;
      const storagePath = getRelativeAttachmentPath(storedName);
      const absolutePath = getAbsoluteAttachmentPath(storagePath);
      const bytes = Buffer.from(await file.arrayBuffer());

      await writeFile(absolutePath, bytes);
      savedFiles.push({
        originalName: file.name,
        storedName,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        storagePath,
      });
    }

    return savedFiles;
  } catch (error) {
    await deleteSavedAttachmentFiles(savedFiles);
    throw error;
  }
}

export async function deleteSavedAttachmentFiles(
  attachments: Array<Pick<PurchaseRequestAttachmentInput, "storagePath">>,
) {
  await Promise.allSettled(
    attachments.map((attachment) => unlink(getAbsoluteAttachmentPath(attachment.storagePath))),
  );
}

export function toAttachmentCreateManyInput(
  attachments: PurchaseRequestAttachmentInput[],
  uploadedById: string,
) {
  return attachments.map((attachment) => ({
    ...attachment,
    uploadedById,
  }));
}

function canViewPurchaseRequest(
  session: SessionUser,
  request: {
    requesterId: string;
    department: string;
    currentApproverId?: string | null;
  },
) {
  if (isAdmin(session) || isPurchasing(session)) {
    return true;
  }

  if (session.role === "EMPLOYEE") {
    return request.requesterId === session.id;
  }

  if (session.role === "APPROVER") {
    return (
      request.department === session.department ||
      request.currentApproverId === session.id ||
      request.requesterId === session.id
    );
  }

  return false;
}

export async function getAttachmentForDownload(
  purchaseRequestId: string,
  attachmentId: string,
  session: SessionUser,
) {
  const db = getDb();
  const attachment = await db.purchaseRequestAttachment.findUnique({
    where: { id: attachmentId },
    include: {
      purchaseRequest: true,
    },
  });

  if (!attachment || attachment.purchaseRequestId !== purchaseRequestId) {
    throw new AppError("ไม่พบไฟล์แนบที่ต้องการ", 404);
  }

  if (!canViewPurchaseRequest(session, attachment.purchaseRequest)) {
    throw new AppError("คุณไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้", 403);
  }

  const bytes = await readFile(getAbsoluteAttachmentPath(attachment.storagePath));

  return {
    attachment,
    bytes,
  };
}

export type PurchaseRequestAttachmentCreateInput =
  Prisma.PurchaseRequestAttachmentCreateWithoutPurchaseRequestInput;
