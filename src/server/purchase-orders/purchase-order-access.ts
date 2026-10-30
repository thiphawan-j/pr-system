import "server-only";

import type { SessionUser } from "@/lib/types";
import { canApprovePurchaseRequest } from "@/server/auth/authorization";
import { assertCanViewPurchaseRequest } from "@/server/purchase-requests/purchase-request.service";

type SourceAccess = {
  requesterId: string;
  department: string;
  currentApproverId?: string | null;
  approvals: Array<{ approverId: string }>;
};

export function orderSources<T>(order: { purchaseRequest: T; purchaseRequests: T[] }): T[] {
  return order.purchaseRequests.length ? order.purchaseRequests : [order.purchaseRequest];
}

export function assertCanViewOrderSources(session: SessionUser, sources: SourceAccess[]) {
  for (const source of sources) {
    // An approver can continue reviewing their original PR after reassignment.
    // Access to one source never grants access to the other sources in a PO.
    if (!canApprovePurchaseRequest(session, source.approvals[0]?.approverId)) {
      assertCanViewPurchaseRequest(session, source.requesterId, source.department, source.currentApproverId);
    }
  }
}

export function canReviewOrderSources(session: SessionUser, sources: Pick<SourceAccess, "approvals">[]) {
  const approverIds = new Set(sources.map((source) => source.approvals[0]?.approverId ?? null));
  // Different original approvers require an administrator or management to
  // approve the whole amendment. A single department approver cannot do so.
  return canApprovePurchaseRequest(session, approverIds.size === 1 ? sources[0]?.approvals[0]?.approverId : undefined);
}
