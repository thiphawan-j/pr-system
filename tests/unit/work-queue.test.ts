import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { Role, SessionUser } from "../../src/lib/types";
import { managementDepartment } from "../../src/lib/constants";
import { workQueueFilters } from "../../src/server/purchase-requests/work-queue";

const user = (role: Role, department = "Operations"): SessionUser => ({
  id: "viewer", name: "Viewer", email: "viewer@example.test", username: "viewer",
  phone: null, employeeCode: "TEST-001", title: null, role, department,
});

test("personal drafts and returned requests stay owned by the viewer for every role", () => {
  for (const role of ["EMPLOYEE", "APPROVER", "PURCHASING", "ADMIN"] as const) {
    const groups = workQueueFilters(user(role));
    assert.deepEqual(groups[0], { key: "drafts", where: { requesterId: "viewer", status: "DRAFT" } });
    assert.deepEqual(groups[1], { key: "returned", where: { requesterId: "viewer", status: { in: ["NEED_REVISION", "NEED_CLARIFICATION"] } } });
  }
});

test("ordinary approval queue is assignment-scoped, while management and admin retain existing review rights", () => {
  const approval = (u: SessionUser) => workQueueFilters(u).find(group => group.key === "approval");
  assert.deepEqual(approval(user("APPROVER"))?.where, { status: "PENDING_APPROVAL", currentApproverId: "viewer" });
  assert.deepEqual(approval(user("APPROVER", managementDepartment))?.where, { status: "PENDING_APPROVAL" });
  assert.deepEqual(approval(user("ADMIN"))?.where, { status: "PENDING_APPROVAL" });
  assert.equal(approval(user("EMPLOYEE")), undefined);
  assert.equal(approval(user("PURCHASING")), undefined);
});

test("purchasing work is only offered to purchasing and admin; receiving is read-only follow-up", () => {
  for (const role of ["EMPLOYEE", "APPROVER", "PURCHASING", "ADMIN"] as const) {
    const groups = workQueueFilters(user(role));
    assert.equal(groups.some(group => group.key === "purchasing"), role === "PURCHASING" || role === "ADMIN");
    assert.deepEqual(groups.find(group => group.key === "receipts")?.where, { status: "ORDERED", receivedAt: null });
  }
});

test("queue counts and bounded reads intersect existing visibility without invoking any writes", async () => {
  const { getPersonalWorkQueue } = await import("../../src/server/purchase-requests/purchase-request.service");
  const previous = globalThis.prismaClientSingleton;
  const reads: { operation: string; args: Record<string, unknown> }[] = [];
  // No database, connection string, write method or fixtures are provided.
  globalThis.prismaClientSingleton = { purchaseRequest: {
    count: async (args: Record<string, unknown>) => { reads.push({ operation: "count", args }); return 7; },
    findMany: async (args: Record<string, unknown>) => { reads.push({ operation: "findMany", args }); return []; },
  } } as unknown as PrismaClient;
  try {
    for (const account of [user("EMPLOYEE"), user("APPROVER"), user("APPROVER", managementDepartment), user("PURCHASING"), user("ADMIN")]) {
      reads.length = 0;
      const result = await getPersonalWorkQueue(account);
      const expectedVisibility = account.role === "EMPLOYEE" ? { requesterId: account.id }
        : account.role === "APPROVER" && account.department !== managementDepartment
          ? { OR: [{ department: account.department }, { currentApproverId: account.id }, { requesterId: account.id }] } : {};
      const filters = workQueueFilters(account);
      assert.deepEqual(result.map(group => ({ key: group.key, total: group.total, items: group.items })), filters.map(group => ({ key: group.key, total: 7, items: [] })));
      assert.equal(reads.length, filters.length * 2);
      for (let i = 0; i < filters.length; i++) {
        const expectedWhere = { AND: [expectedVisibility, filters[i].where] };
        assert.deepEqual(reads[i * 2].args.where, expectedWhere);
        assert.deepEqual(reads[i * 2 + 1].args.where, expectedWhere);
        assert.equal(reads[i * 2 + 1].args.take, 5);
        assert.deepEqual(reads[i * 2 + 1].args.orderBy, [{ updatedAt: "asc" }, { id: "asc" }]);
        assert.ok(reads[i * 2 + 1].args.select);
      }
    }
  } finally {
    globalThis.prismaClientSingleton = previous;
  }
});
