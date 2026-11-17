import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/types";
import { isApprover, isManagementApprover, isPurchasing } from "@/server/auth/authorization";

// These filters only narrow the existing visibility predicate. They grant no
// mutation permissions; every action still goes through the existing detail/API.
export function workQueueFilters(user: SessionUser) {
  const groups: { key: "drafts" | "returned" | "approval" | "purchasing" | "receipts"; where: Prisma.PurchaseRequestWhereInput }[] = [
    { key: "drafts", where: { requesterId: user.id, status: "DRAFT" } },
    { key: "returned", where: { requesterId: user.id, status: { in: ["NEED_REVISION", "NEED_CLARIFICATION"] } } },
  ];
  if (isApprover(user)) groups.push({ key: "approval", where: {
    status: "PENDING_APPROVAL",
    ...(user.role === "ADMIN" || isManagementApprover(user) ? {} : { currentApproverId: user.id }),
  } });
  if (isPurchasing(user)) groups.push({ key: "purchasing", where: { status: "APPROVED" } });
  groups.push({ key: "receipts", where: { status: "ORDERED", receivedAt: null } });
  return groups;
}
