import "server-only";

import { managementDepartment } from "@/lib/constants";
import type { Role, SessionUser } from "@/lib/types";
import { AppError } from "@/server/shared/errors";

export function assertRole(user: SessionUser, allowedRoles: Role[]) {
  if (!allowedRoles.includes(user.role)) {
    throw new AppError("คุณไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้", 403);
  }
}

export function isAdmin(user: SessionUser) {
  return user.role === "ADMIN";
}

export function isApprover(user: SessionUser) {
  return user.role === "APPROVER" || user.role === "ADMIN";
}

export function isPurchasing(user: SessionUser) {
  return user.role === "PURCHASING" || user.role === "ADMIN";
}

export function isManagementApprover(user: SessionUser) {
  return user.role === "APPROVER" && user.department === managementDepartment;
}

export function hasGlobalPurchaseRequestVisibility(user: SessionUser) {
  return (
    isAdmin(user) ||
    isPurchasing(user) ||
    isManagementApprover(user)
  );
}

export function canApprovePurchaseRequest(
  user: SessionUser,
  currentApproverId?: string | null,
) {
  return (
    isAdmin(user) ||
    isManagementApprover(user) ||
    (user.role === "APPROVER" && currentApproverId === user.id)
  );
}

export function canManageRequestAsOwner(user: SessionUser, requesterId: string) {
  return isAdmin(user) || user.id === requesterId;
}
