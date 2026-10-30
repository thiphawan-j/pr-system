import "server-only";

import { Prisma } from "@prisma/client";
import type { PurchaseOrderRecipientOption, SessionUser } from "@/lib/types";
import { isPurchasing } from "@/server/auth/authorization";
import { getDb } from "@/server/db";
import { invariant } from "@/server/shared/errors";

export type PurchaseOrderRecipientIdentity = {
  deliveryRecipientId: string | null;
  deliveryRecipientName: string | null;
  deliveryRecipientPhone: string | null;
};

const noRecipient: PurchaseOrderRecipientIdentity = {
  deliveryRecipientId: null,
  deliveryRecipientName: null,
  deliveryRecipientPhone: null,
};

export async function listPurchaseOrderRecipients(session: SessionUser): Promise<PurchaseOrderRecipientOption[]> {
  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
  return getDb().user.findMany({
    where: { isActive: true, role: { not: "ADMIN" } },
    select: { id: true, name: true, employeeCode: true, department: true },
    orderBy: [{ name: "asc" }, { employeeCode: "asc" }, { id: "asc" }],
  });
}

async function eligibleRecipient(transaction: Prisma.TransactionClient, id: string) {
  // Retain eligibility until the PO mutation commits if an administrator is
  // changing the same employee's role or active status concurrently.
  await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${id} FOR SHARE`);
  const user = await transaction.user.findUnique({
    where: { id }, select: { id: true, name: true, phone: true, role: true, isActive: true },
  });
  if (!user?.isActive || user.role === "ADMIN") return null;
  return { deliveryRecipientId: user.id, deliveryRecipientName: user.name, deliveryRecipientPhone: user.phone };
}

export async function defaultPurchaseOrderRecipient(transaction: Prisma.TransactionClient, requesterId: string): Promise<PurchaseOrderRecipientIdentity> {
  return await eligibleRecipient(transaction, requesterId) ?? { ...noRecipient };
}

export async function resolvePurchaseOrderRecipient(
  transaction: Prisma.TransactionClient,
  id: string | null | undefined,
  current: PurchaseOrderRecipientIdentity = noRecipient,
): Promise<PurchaseOrderRecipientIdentity> {
  // Unchanged issued recipients retain their historical identity, even after
  // a rename, deactivation, or role change. They are not offered as new choices.
  if (id === undefined || id !== null && id === current.deliveryRecipientId) return {
    deliveryRecipientId: current.deliveryRecipientId,
    deliveryRecipientName: current.deliveryRecipientName,
    deliveryRecipientPhone: current.deliveryRecipientPhone,
  };
  if (id === null) return { ...noRecipient };
  const recipient = await eligibleRecipient(transaction, id);
  invariant(recipient, "ไม่พบผู้รับสินค้าที่เลือก หรือบัญชีถูกปิดใช้งานหรือเป็นแอดมิน กรุณาเลือกพนักงานใหม่", 400);
  return recipient;
}
