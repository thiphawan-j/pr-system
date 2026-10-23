import "server-only";

import {
  ApprovalAction,
  NotificationType,
  Prisma,
  PurchaseRequestStatus,
  Role,
} from "@prisma/client";
import {
  toBangkokDateValue,
  toBangkokIsoString,
  toBangkokMonthValue,
  toUtcEndOfDayFromDateValue,
  toUtcStartOfDayFromDateValue,
} from "@/lib/format";
import type {
  DashboardSummary,
  PurchaseRequestAttachmentInput,
  PurchaseRequestDetail,
  PurchaseRequestFilters,
  PurchaseRequestListPage,
  PurchaseRequestItemInput,
  PurchaseRequestListItem,
  ReportsSummary,
  SessionUser,
} from "@/lib/types";
import {
  deleteSavedAttachmentFiles,
  toAttachmentCreateManyInput,
} from "@/server/attachments/attachment.service";
import {
  canApprovePurchaseRequest,
  canCancelPurchaseRequestAsOwner,
  canHandlePurchaseRequestCancellation,
  canManageRequestAsOwner,
  hasGlobalPurchaseRequestVisibility,
  isApprover,
  isManagementApprover,
  isPurchasing,
} from "@/server/auth/authorization";
import {
  createNotifications,
  getUnreadNotificationCount,
  listNotificationsForUser,
} from "@/server/notifications/notification.service";
import { getDb } from "@/server/db";
import { AppError, invariant } from "@/server/shared/errors";
import type { ReceiptEntryInput } from "@/server/purchase-requests/purchase-request.schemas";
import {
  findApproverForDepartment,
  findPrimaryPurchasingUser,
} from "@/server/users/user.service";

type PersistedItem = {
  itemName: string;
  description?: string;
  supplierName?: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
};

const purchaseRequestInclude = {
  requester: true,
  purchaseOrders: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: {
    _count: { select: { items: true } }, changes: { where: { status: "PENDING" }, select: { id: true } },
  } },
  currentApprover: true,
  cancelledBy: true,
  items: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  receipts: {
    include: {
      recordedBy: { select: { id: true, name: true } },
      items: { include: { item: { select: { itemName: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  approvals: {
    include: {
      approver: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
  attachments: {
    include: {
      uploadedBy: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
} satisfies Prisma.PurchaseRequestInclude;

const purchaseRequestListSelect = {
  id: true,
  prNumber: true,
  requestDate: true,
  receivedAt: true,
  receipts: { where: { action: "CLOSE_REMAINDER" }, select: { id: true }, take: 1 },
  updatedAt: true,
  requesterId: true,
  department: true,
  reason: true,
  urgency: true,
  status: true,
  totalAmount: true,
  items: {
    select: { itemName: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 2,
  },
  requester: {
    select: {
      name: true,
    },
  },
  currentApprover: {
    select: {
      name: true,
    },
  },
  approvals: {
    select: {
      comment: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 1,
  },
  _count: {
    select: {
      items: true,
      receipts: true,
    },
  },
} satisfies Prisma.PurchaseRequestSelect;

function decimalToNumber(value: Prisma.Decimal | number) {
  return Number(value);
}

function toPersistedItems(items: PurchaseRequestItemInput[]): PersistedItem[] {
  return items.map((item) => ({
    itemName: item.itemName,
    description: item.description,
    supplierName: item.supplierName,
    quantity: item.quantity,
    unit: item.unit,
    // Persist zero instead of null so older databases that still expect a
    // non-null unit price do not crash on valid "price omitted" requests.
    unitPrice:
      item.unitPrice === undefined ? 0 : Number(item.unitPrice.toFixed(2)),
    amount: Number((item.quantity * (item.unitPrice ?? 0)).toFixed(2)),
  }));
}

function calculateTotal(items: PersistedItem[]) {
  return Number(
    items.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
  );
}

function parseDateValueAsUtc(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatUtcDateValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDaysToDateValue(value: string, days: number) {
  const next = parseDateValueAsUtc(value);
  next.setUTCDate(next.getUTCDate() + days);

  return formatUtcDateValue(next);
}

function getWeekStartDateValue(value: string) {
  const date = parseDateValueAsUtc(value);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);

  return formatUtcDateValue(date);
}

function addMonthsToDateValue(value: string, months: number) {
  const date = parseDateValueAsUtc(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);

  return formatUtcDateValue(date);
}

function buildVisibleWhere(session: SessionUser): Prisma.PurchaseRequestWhereInput {
  if (hasGlobalPurchaseRequestVisibility(session)) {
    return {};
  }

  if (session.role === "EMPLOYEE") {
    return { requesterId: session.id };
  }

  if (session.role === "APPROVER") {
    return {
      OR: [
        { department: session.department },
        { currentApproverId: session.id },
        { requesterId: session.id },
      ],
    };
  }

  return {};
}

function buildFilterWhere(
  session: SessionUser,
  filters: PurchaseRequestFilters,
): Prisma.PurchaseRequestWhereInput {
  const andConditions: Prisma.PurchaseRequestWhereInput[] = [buildVisibleWhere(session)];

  if (filters.query) {
    andConditions.push({
      OR: [
        { prNumber: { contains: filters.query, mode: "insensitive" } },
        { reason: { contains: filters.query, mode: "insensitive" } },
        { requester: { name: { contains: filters.query, mode: "insensitive" } } },
        {
          items: {
            some: {
              OR: [
                { itemName: { contains: filters.query, mode: "insensitive" } },
                { description: { contains: filters.query, mode: "insensitive" } },
                { supplierName: { contains: filters.query, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  }

  const selectedStatuses = Array.isArray(filters.status)
    ? filters.status
    : filters.status && filters.status !== "ALL" ? [filters.status] : [];

  if (selectedStatuses.length) {
    const statusConditions = selectedStatuses.map((status): Prisma.PurchaseRequestWhereInput => {
      if (status === "AWAITING_RECEIPT_REFERENCES") {
        return {
          status: PurchaseRequestStatus.ORDERED,
          receivedAt: { not: null },
        };
      }

      if (status === "ORDERED") {
        return {
          status: PurchaseRequestStatus.ORDERED,
          receivedAt: null,
        };
      }

      return { status };
    });

    andConditions.push({ OR: statusConditions });
  }

  if (filters.urgency && filters.urgency !== "ALL") {
    andConditions.push({
      urgency: filters.urgency,
    });
  }

  if (filters.preset) {
    switch (filters.preset) {
      case "pending":
        andConditions.push({
          status: PurchaseRequestStatus.PENDING_APPROVAL,
        });
        break;
      case "approved":
        andConditions.push({
          status: {
            in: [
              PurchaseRequestStatus.APPROVED,
              PurchaseRequestStatus.CANCEL_REQUESTED,
              PurchaseRequestStatus.ORDERED,
              PurchaseRequestStatus.COMPLETED,
            ],
          },
        });
        break;
      case "rejected":
        andConditions.push({
          status: {
            in: [
              PurchaseRequestStatus.REJECTED,
              PurchaseRequestStatus.NEED_REVISION,
              PurchaseRequestStatus.NEED_CLARIFICATION,
            ],
          },
        });
        break;
      case "awaiting_receipt":
        andConditions.push({
          status: PurchaseRequestStatus.ORDERED,
          receivedAt: null,
        });
        break;
    }
  }

  if (filters.department && filters.department !== "ALL") {
    andConditions.push({
      department: filters.department,
    });
  }

  if (filters.from || filters.to) {
    andConditions.push({
      requestDate: {
        gte: filters.from ? toUtcStartOfDayFromDateValue(filters.from) : undefined,
        lte: filters.to ? toUtcEndOfDayFromDateValue(filters.to) : undefined,
      },
    });
  }

  return {
    AND: andConditions,
  };
}

function buildSortOrder(sort: PurchaseRequestFilters["sort"]) {
  switch (sort) {
    case "pr_asc":
      return [{ prNumber: "asc" }] satisfies Prisma.PurchaseRequestOrderByWithRelationInput[];
    case "updated_desc":
      return [{ updatedAt: "desc" }, { prNumber: "desc" }] satisfies Prisma.PurchaseRequestOrderByWithRelationInput[];
    case "status_asc":
      return [{ status: "asc" }, { prNumber: "desc" }] satisfies Prisma.PurchaseRequestOrderByWithRelationInput[];
    case "pr_desc":
    default:
      return [{ prNumber: "desc" }] satisfies Prisma.PurchaseRequestOrderByWithRelationInput[];
  }
}

function toListItem(
  request: Prisma.PurchaseRequestGetPayload<{
    select: typeof purchaseRequestListSelect;
  }>,
) {
  const latestApproval = request.approvals[0];

  return {
    id: request.id,
    prNumber: request.prNumber,
    requestDate: toBangkokDateValue(request.requestDate),
    receivedAt: request.receivedAt ? toBangkokDateValue(request.receivedAt) : null,
    hasPartialReceipt: request._count.receipts > 0 && !request.receivedAt,
    hasClosedRemainder: request.receipts.length > 0,
    updatedAt: toBangkokIsoString(request.updatedAt),
    requesterId: request.requesterId,
    requesterName: request.requester.name,
    requesterDepartment: request.department,
    reason: request.reason,
    urgency: request.urgency,
    status: request.status,
    totalAmount: decimalToNumber(request.totalAmount),
    itemCount: request._count.items,
    itemNames: request.items.map((item) => item.itemName),
    currentApproverName: request.currentApprover?.name ?? null,
    latestComment: latestApproval?.comment ?? null,
  } satisfies PurchaseRequestListItem;
}

function toDetail(
  request: Prisma.PurchaseRequestGetPayload<{
    include: typeof purchaseRequestInclude;
  }>,
) {
  return {
    id: request.id,
    prNumber: request.prNumber,
    requestDate: toBangkokDateValue(request.requestDate),
    department: request.department,
    reason: request.reason,
    urgency: request.urgency,
    status: request.status,
    totalAmount: decimalToNumber(request.totalAmount),
    requester: {
      id: request.requester.id,
      employeeCode: request.requester.employeeCode,
      name: request.requester.name,
      email: request.requester.email,
      department: request.requester.department,
      role: request.requester.role,
      title: request.requester.title,
    },
    currentApprover: request.currentApprover
      ? {
          id: request.currentApprover.id,
          name: request.currentApprover.name,
          email: request.currentApprover.email,
          role: request.currentApprover.role,
        }
      : null,
    submittedAt: request.submittedAt ? toBangkokIsoString(request.submittedAt) : null,
    approvedAt: request.approvedAt ? toBangkokIsoString(request.approvedAt) : null,
    orderedAt: request.orderedAt ? toBangkokIsoString(request.orderedAt) : null,
    receivedAt: request.receivedAt ? toBangkokDateValue(request.receivedAt) : null,
    purchaseOrders: request.purchaseOrders.map((order) => ({ id: order.id, poNumber: order.poNumber, supplierName: order.supplierName, issuedAt: toBangkokIsoString(order.issuedAt), totalAmount: Number(order.totalAmount), itemCount: order._count.items })),
    hasPendingPurchaseOrderChange: request.purchaseOrders.some((order) => order.changes.length > 0),
    receiptVersion: request.receiptVersion,
    hasPartialReceipt: request.items.some((item) => item.receivedQuantity > 0) && !request.receivedAt,
    receipts: request.receipts.map((receipt) => ({
      id: receipt.id,
      action: receipt.action,
      receivedDate: toBangkokDateValue(receipt.receivedDate),
      comment: receipt.comment,
      overReceiptReason: receipt.overReceiptReason,
      receiptNumber: receipt.receiptNumber,
      taxInvoiceNumber: receipt.taxInvoiceNumber,
      createdAt: toBangkokIsoString(receipt.createdAt),
      recordedBy: receipt.recordedBy,
      items: receipt.items.map((item) => ({
        itemId: item.itemId,
        itemName: item.item.itemName,
        quantity: item.quantity,
      })),
    })),
    completedAt: request.completedAt ? toBangkokIsoString(request.completedAt) : null,
    cancellationRequestedAt: request.cancellationRequestedAt
      ? toBangkokIsoString(request.cancellationRequestedAt)
      : null,
    cancelledAt: request.cancelledAt
      ? toBangkokIsoString(request.cancelledAt)
      : null,
    cancellationReason: request.cancellationReason ?? null,
    cancellationReference: request.cancellationReference ?? null,
    cancelledBy: request.cancelledBy
      ? {
          id: request.cancelledBy.id,
          name: request.cancelledBy.name,
          email: request.cancelledBy.email,
          role: request.cancelledBy.role,
        }
      : null,
    receiptNumber: request.receiptNumber ?? null,
    taxInvoiceNumber: request.taxInvoiceNumber ?? null,
    receiptReferenceNote: request.receiptReferenceNote ?? null,
    createdAt: toBangkokIsoString(request.createdAt),
    updatedAt: toBangkokIsoString(request.updatedAt),
    items: request.items.map((item) => ({
      id: item.id,
      itemName: item.itemName,
      description: item.description ?? undefined,
      supplierName: item.supplierName ?? undefined,
      quantity: item.quantity,
      receivedQuantity: item.receivedQuantity,
      closedQuantity: item.closedQuantity,
      remainingQuantity: Math.max(0, item.quantity - item.receivedQuantity - item.closedQuantity),
      overReceivedQuantity: Math.max(0, item.receivedQuantity - item.quantity),
      unit: item.unit ?? undefined,
      unitPrice:
        item.unitPrice === null
          ? undefined
          : (() => {
              const unitPrice = decimalToNumber(item.unitPrice);
              return unitPrice === 0 && decimalToNumber(item.amount) === 0
                ? undefined
                : unitPrice;
            })(),
      amount: decimalToNumber(item.amount),
    })),
    attachments: request.attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      storedName: attachment.storedName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      storagePath: attachment.storagePath,
      createdAt: toBangkokIsoString(attachment.createdAt),
      uploadedBy: {
        id: attachment.uploadedBy.id,
        employeeCode: attachment.uploadedBy.employeeCode,
        name: attachment.uploadedBy.name,
        email: attachment.uploadedBy.email,
        department: attachment.uploadedBy.department,
        role: attachment.uploadedBy.role,
        title: attachment.uploadedBy.title,
      },
    })),
    approvals: request.approvals.map((approval) => ({
      id: approval.id,
      action: approval.action,
      comment: approval.comment,
      stepLabel: approval.stepLabel,
      createdAt: toBangkokIsoString(approval.createdAt),
      approver: {
        id: approval.approver.id,
        employeeCode: approval.approver.employeeCode,
        name: approval.approver.name,
        email: approval.approver.email,
        department: approval.approver.department,
        role: approval.approver.role,
        title: approval.approver.title,
      },
    })),
  } satisfies PurchaseRequestDetail;
}

export function assertCanViewPurchaseRequest(
  session: SessionUser,
  requesterId: string,
  department: string,
  currentApproverId?: string | null,
) {
  if (hasGlobalPurchaseRequestVisibility(session)) {
    return;
  }

  if (
    session.role === "APPROVER" &&
    (session.department === department || currentApproverId === session.id)
  ) {
    return;
  }

  if (session.id === requesterId) {
    return;
  }

  throw new AppError("คุณไม่มีสิทธิ์ดูเอกสารนี้", 403);
}

function assertEditableDraft(
  session: SessionUser,
  request: {
    requesterId: string;
    status: PurchaseRequestStatus;
  },
) {
  invariant(
    canManageRequestAsOwner(session, request.requesterId),
    "คุณไม่มีสิทธิ์แก้ไขเอกสารนี้",
    403,
  );
  invariant(
    isEditableRequestStatus(request.status),
    "เอกสารนี้ไม่สามารถแก้ไขได้",
    400,
  );
}

function isEditableRequestStatus(status: PurchaseRequestStatus) {
  return status === PurchaseRequestStatus.DRAFT || isPurchasingReturnStatus(status);
}

function isPurchasingReturnStatus(status: PurchaseRequestStatus) {
  return (
    status === PurchaseRequestStatus.NEED_REVISION ||
    status === PurchaseRequestStatus.NEED_CLARIFICATION
  );
}

async function generateNextPrNumber(requestDate: Date) {
  const db = getDb();
  const [year, month] = toBangkokMonthValue(requestDate).split("-");
  const prefix = `PR-${year}${month}`;

  const latest = await db.purchaseRequest.findFirst({
    where: {
      prNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      prNumber: "desc",
    },
  });

  const nextSequence = latest
    ? Number(latest.prNumber.slice(-4)) + 1
    : 1;

  return `${prefix}-${`${nextSequence}`.padStart(4, "0")}`;
}

async function notifySubmission(
  requestId: string,
  prNumber: string,
  requesterName: string,
  approverId: string,
) {
  await createNotifications([
    {
      userId: approverId,
      title: "มี PR ใหม่รออนุมัติ",
      message: `${prNumber} จาก ${requesterName} ถูกส่งเข้าระบบแล้ว`,
      link: `/purchase-requests/${requestId}`,
      type: NotificationType.INFO,
    },
  ]);
}

async function notifyApprovalResult(input: {
  requestId: string;
  prNumber: string;
  requesterId: string;
  action: "APPROVED" | "REJECTED" | "RETURNED";
  purchasingUserId?: string | null;
}) {
  const notifications: Array<{
    userId: string;
    title: string;
    message: string;
    link: string;
    type: NotificationType;
  }> = [];

  if (input.action === "APPROVED") {
    notifications.push({
      userId: input.requesterId,
      title: "PR ได้รับการอนุมัติแล้ว",
      message: `${input.prNumber} ผ่านการอนุมัติและส่งต่อให้ฝ่ายจัดซื้อ`,
      link: `/purchase-requests/${input.requestId}`,
      type: NotificationType.SUCCESS,
    });

    if (input.purchasingUserId) {
      notifications.push({
        userId: input.purchasingUserId,
        title: "มี PR พร้อมดำเนินการสั่งซื้อ",
        message: `${input.prNumber} ได้รับการอนุมัติครบถ้วนแล้ว`,
        link: `/purchase-requests/${input.requestId}`,
        type: NotificationType.INFO,
      });
    }
  }

  if (input.action === "REJECTED") {
    notifications.push({
      userId: input.requesterId,
      title: "PR ถูกปฏิเสธ",
      message: `${input.prNumber} ถูกปฏิเสธ กรุณาตรวจสอบหมายเหตุ`,
      link: `/purchase-requests/${input.requestId}`,
      type: NotificationType.ERROR,
    });
  }

  if (input.action === "RETURNED") {
    notifications.push({
      userId: input.requesterId,
      title: "PR ถูกส่งกลับแก้ไข",
      message: `${input.prNumber} ต้องการข้อมูลเพิ่มเติมก่อนอนุมัติ`,
      link: `/purchase-requests/${input.requestId}`,
      type: NotificationType.WARNING,
    });
  }

  await createNotifications(notifications);
}

async function notifyPurchasingReturn(input: {
  requestId: string;
  prNumber: string;
  requesterId: string;
  action: "REQUEST_REVISION" | "REQUEST_CLARIFICATION";
}) {
  await createNotifications([
    {
      userId: input.requesterId,
      title:
        input.action === "REQUEST_REVISION"
          ? "PR รอแก้ไขจากผู้ขอซื้อ"
          : "PR ต้องการข้อมูลเพิ่มเติม",
      message:
        input.action === "REQUEST_REVISION"
          ? `${input.prNumber} ถูกฝ่ายจัดซื้อส่งกลับให้แก้ไข กรุณาตรวจสอบเหตุผล`
          : `${input.prNumber} ฝ่ายจัดซื้อต้องการข้อมูลเพิ่มเติม กรุณาตรวจสอบคำถาม`,
      link: `/purchase-requests/${input.requestId}`,
      type:
        input.action === "REQUEST_REVISION"
          ? NotificationType.ERROR
          : NotificationType.WARNING,
    },
  ]);
}

async function notifyPurchasingResubmission(input: {
  requestId: string;
  prNumber: string;
  requesterName: string;
  purchasingUserId: string;
}) {
  await createNotifications([
    {
      userId: input.purchasingUserId,
      title: "PR ถูกส่งกลับมาตรวจอีกครั้ง",
      message: `${input.prNumber} จาก ${input.requesterName} แก้ไขหรือตอบข้อมูลแล้ว`,
      link: `/purchase-requests/${input.requestId}`,
      type: NotificationType.INFO,
    },
  ]);
}

async function notifyProgressUpdate(input: {
  requestId: string;
  prNumber: string;
  requesterId: string;
  action: "ORDERED" | "COMPLETED";
}) {
  await createNotifications([
    {
      userId: input.requesterId,
      title:
        input.action === "ORDERED"
          ? "PR อยู่ระหว่างจัดซื้อ"
          : "PR ดำเนินการเสร็จสมบูรณ์",
      message:
        input.action === "ORDERED"
          ? `${input.prNumber} ถูกส่งคำสั่งซื้อแล้ว`
          : `${input.prNumber} ถูกปิดงานเรียบร้อยแล้ว`,
      link: `/purchase-requests/${input.requestId}`,
      type: NotificationType.SUCCESS,
    },
  ]);
}

async function notifyReceiptReferencesPending(input: {
  requestId: string;
  prNumber: string;
  purchasingUserId: string;
}) {
  await createNotifications([
    {
      userId: input.purchasingUserId,
      title: "PR รอกรอกเลขเอกสาร",
      message: `${input.prNumber} มีการยืนยันรับของแล้ว กรุณาบันทึกเลขรับของหรือใบกำกับภาษี`,
      link: `/purchase-requests/${input.requestId}`,
      type: NotificationType.WARNING,
    },
  ]);
}

async function notifyCancellationRequested(input: {
  requestId: string;
  prNumber: string;
  requesterId: string;
  purchasingUserId: string;
  actorId: string;
}) {
  const recipientIds = new Set<string>();

  if (input.purchasingUserId !== input.actorId) {
    recipientIds.add(input.purchasingUserId);
  }

  if (input.requesterId !== input.actorId) {
    recipientIds.add(input.requesterId);
  }

  await createNotifications(
    Array.from(recipientIds).map((userId) => ({
      userId,
      title: "มีคำขอยกเลิก PR",
      message: `${input.prNumber} รอฝ่ายจัดซื้อยืนยันการยกเลิก`,
      link: `/purchase-requests/${input.requestId}`,
      type: NotificationType.WARNING,
    })),
  );
}

async function notifyCancellationCompleted(input: {
  requestId: string;
  prNumber: string;
  requesterId: string;
  currentApproverId?: string | null;
  actorId: string;
}) {
  const recipientIds = new Set<string>();

  if (input.requesterId !== input.actorId) {
    recipientIds.add(input.requesterId);
  }

  if (input.currentApproverId && input.currentApproverId !== input.actorId) {
    recipientIds.add(input.currentApproverId);
  }

  await createNotifications(
    Array.from(recipientIds).map((userId) => ({
      userId,
      title: "PR ถูกยกเลิกแล้ว",
      message: `${input.prNumber} ถูกยกเลิกแล้ว กรุณาตรวจสอบเหตุผล`,
      link: `/purchase-requests/${input.requestId}`,
      type: NotificationType.ERROR,
    })),
  );
}

async function notifyCancellationDeclined(input: {
  requestId: string;
  prNumber: string;
  requesterId: string;
  actorId: string;
}) {
  if (input.requesterId === input.actorId) {
    return;
  }

  await createNotifications([
    {
      userId: input.requesterId,
      title: "คำขอยกเลิก PR ไม่ได้รับอนุมัติ",
      message: `${input.prNumber} ดำเนินการจัดซื้อต่อตามเดิม กรุณาตรวจสอบเหตุผล`,
      link: `/purchase-requests/${input.requestId}`,
      type: NotificationType.WARNING,
    },
  ]);
}

async function sendCancellationNotification(
  notification: () => Promise<void>,
) {
  try {
    await notification();
  } catch (error) {
    // The state transition and its audit entry are already committed. A
    // notification outage must not make a successful cancellation look failed.
    console.error("[purchase-requests] failed to create cancellation notification", error);
  }
}

export async function listPurchaseRequests(
  session: SessionUser,
  filters: PurchaseRequestFilters,
) {
  const db = getDb();
  const where = buildFilterWhere(session, filters);
  const orderBy = buildSortOrder(filters.sort);

  const requests = await db.purchaseRequest.findMany({
    where,
    select: purchaseRequestListSelect,
    orderBy,
  });

  return requests.map(toListItem);
}

export async function listPurchaseRequestsPage(
  session: SessionUser,
  filters: PurchaseRequestFilters,
  pagination: {
    page: number;
    limit: number;
  },
) {
  const db = getDb();
  const where = buildFilterWhere(session, filters);
  const orderBy = buildSortOrder(filters.sort);
  const limit = pagination.limit;
  const totalCount = await db.purchaseRequest.count({ where });
  const totalPages = Math.ceil(totalCount / limit);
  const page = totalPages > 0 ? Math.min(pagination.page, totalPages) : 1;

  const requests = await db.purchaseRequest.findMany({
    where,
    select: purchaseRequestListSelect,
    orderBy,
    skip: (page - 1) * limit,
    take: limit,
  });

  const hasMore = page < totalPages;
  const items = requests.map(toListItem);

  return {
    items,
    page,
    limit,
    totalCount,
    totalPages,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
  } satisfies PurchaseRequestListPage;
}

export async function getPurchaseRequestById(id: string, session: SessionUser) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
    include: purchaseRequestInclude,
  });

  if (!request) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  assertCanViewPurchaseRequest(
    session,
    request.requesterId,
    request.department,
    request.currentApproverId,
  );

  return toDetail(request);
}

export async function addPurchaseRequestComment(
  id: string,
  session: SessionUser,
  input: { comment: string },
) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
    select: {
      requesterId: true,
      department: true,
      currentApproverId: true,
    },
  });

  if (!request) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  assertCanViewPurchaseRequest(
    session,
    request.requesterId,
    request.department,
    request.currentApproverId,
  );

  await db.purchaseRequest.update({
    where: { id },
    data: {
      updatedAt: new Date(),
      approvals: {
        create: {
          approverId: session.id,
          action: ApprovalAction.COMMENTED,
          comment: input.comment,
        },
      },
    },
  });
}

export async function createPurchaseRequest(
  session: SessionUser,
  input: {
    requestDate: string;
    department: string;
    reason: string;
    urgency: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    items: PurchaseRequestItemInput[];
    submit: boolean;
    requesterComment?: string;
    attachments?: PurchaseRequestAttachmentInput[];
  },
) {
  const db = getDb();
  const normalizedItems = toPersistedItems(input.items);
  const totalAmount = calculateTotal(normalizedItems);
  const requestDate = toUtcStartOfDayFromDateValue(input.requestDate);
  const prNumber = await generateNextPrNumber(requestDate);

  let currentApprover = null;
  if (input.submit) {
    currentApprover = await findApproverForDepartment(input.department);
    invariant(currentApprover, "ไม่พบผู้อนุมัติสำหรับแผนกนี้", 400);
  }

  const request = await db.purchaseRequest.create({
    data: {
      prNumber,
      requestDate,
      requesterId: session.id,
      currentApproverId: currentApprover?.id ?? null,
      department: input.department,
      reason: input.reason,
      urgency: input.urgency,
      status: input.submit
        ? PurchaseRequestStatus.PENDING_APPROVAL
        : PurchaseRequestStatus.DRAFT,
      submittedAt: input.submit ? new Date() : null,
      totalAmount,
      items: {
        create: normalizedItems,
      },
      attachments: input.attachments?.length
        ? {
            createMany: {
              data: toAttachmentCreateManyInput(input.attachments, session.id),
            },
          }
        : undefined,
      approvals: {
        create: {
          approverId: session.id,
          action: input.submit
            ? ApprovalAction.SUBMITTED
            : ApprovalAction.DRAFT_SAVED,
          stepLabel: "ผู้ขอซื้อ",
          comment: input.submit ? "สร้างและส่งเอกสารเข้าระบบ" : "บันทึกร่างเอกสาร",
        },
      },
    },
  });

  if (currentApprover) {
    await notifySubmission(request.id, request.prNumber, session.name, currentApprover.id);
  }

  return request.id;
}

export async function updatePurchaseRequest(
  id: string,
  session: SessionUser,
  input: {
    requestDate: string;
    department: string;
    reason: string;
    urgency: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    items: PurchaseRequestItemInput[];
    submit: boolean;
    requesterComment?: string;
    attachments?: PurchaseRequestAttachmentInput[];
  },
) {
  const db = getDb();
  const existing = await db.purchaseRequest.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  assertEditableDraft(session, existing);

  const normalizedItems = toPersistedItems(input.items);
  const totalAmount = calculateTotal(normalizedItems);
  const isReturningToPurchasing = isPurchasingReturnStatus(existing.status);
  let nextApproverId: string | null = null;

  if (input.submit) {
    if (isReturningToPurchasing) {
      nextApproverId =
        existing.currentApproverId ?? (await findPrimaryPurchasingUser())?.id ?? null;
    } else {
      nextApproverId = (await findApproverForDepartment(input.department))?.id ?? null;
    }

    invariant(
      nextApproverId,
      isReturningToPurchasing
        ? "ไม่พบผู้รับผิดชอบฝ่ายจัดซื้อ"
        : "ไม่พบผู้อนุมัติสำหรับแผนกนี้",
      400,
    );
  }

  const nextStatus = input.submit
    ? isReturningToPurchasing
      ? PurchaseRequestStatus.APPROVED
      : PurchaseRequestStatus.PENDING_APPROVAL
    : existing.status;
  const updateComment = input.submit
    ? isReturningToPurchasing
      ? "แก้ไขและส่งกลับให้จัดซื้อตรวจอีกครั้ง"
      : "แก้ไขและส่งเอกสารใหม่"
    : isReturningToPurchasing
      ? "แก้ไขเอกสารตามคำขอจัดซื้อ"
      : "แก้ไขร่างเอกสาร";
  const requesterComment = isReturningToPurchasing
    ? input.requesterComment?.trim()
    : undefined;
  const approvalHistory = [
    {
      approverId: session.id,
      action: input.submit
        ? ApprovalAction.SUBMITTED
        : ApprovalAction.DRAFT_SAVED,
      stepLabel: "ผู้ขอซื้อ",
      comment: updateComment,
    },
    ...(requesterComment
      ? [
          {
            approverId: session.id,
            action: ApprovalAction.COMMENTED,
            stepLabel: "ความเห็นจากผู้ขอซื้อ",
            comment: requesterComment,
          },
        ]
      : []),
  ];

  await db.$transaction(async (transaction) => {
    const claimed = await transaction.purchaseRequest.updateMany({
      where: {
        id,
        status: existing.status,
        updatedAt: existing.updatedAt,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    invariant(
      claimed.count === 1,
      "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง",
      409,
    );

    await transaction.purchaseRequestItem.deleteMany({
      where: { purchaseRequestId: id },
    });

    await transaction.purchaseRequest.update({
      where: { id },
      data: {
        requestDate: toUtcStartOfDayFromDateValue(input.requestDate),
        department: input.department,
        reason: input.reason,
        urgency: input.urgency,
        totalAmount,
        currentApproverId: input.submit
          ? nextApproverId
          : existing.currentApproverId,
        submittedAt: input.submit ? existing.submittedAt ?? new Date() : existing.submittedAt,
        status: nextStatus,
        items: {
          create: normalizedItems,
        },
        approvals: {
          create: approvalHistory,
        },
      },
    });

    if (input.attachments?.length) {
      await transaction.purchaseRequestAttachment.createMany({
        data: input.attachments.map((attachment) => ({
          ...attachment,
          purchaseRequestId: id,
          uploadedById: session.id,
        })),
      });
    }
  });

  if (nextApproverId && input.submit) {
    if (isReturningToPurchasing) {
      await notifyPurchasingResubmission({
        requestId: existing.id,
        prNumber: existing.prNumber,
        requesterName: session.name,
        purchasingUserId: nextApproverId,
      });
    } else {
      await notifySubmission(existing.id, existing.prNumber, session.name, nextApproverId);
    }
  }

  return existing.id;
}

export async function deleteDraftPurchaseRequest(
  id: string,
  session: SessionUser,
) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
    select: {
      requesterId: true,
      status: true,
      submittedAt: true,
      updatedAt: true,
      attachments: {
        select: {
          storagePath: true,
        },
      },
    },
  });

  if (!request) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  invariant(
    canCancelPurchaseRequestAsOwner(session, request.requesterId),
    "คุณไม่มีสิทธิ์ลบร่างเอกสารนี้",
    403,
  );
  invariant(
    request.status === PurchaseRequestStatus.DRAFT && !request.submittedAt,
    "ลบได้เฉพาะร่างที่ยังไม่เคยส่งอนุมัติ",
    400,
  );

  const deleted = await db.purchaseRequest.deleteMany({
    where: {
      id,
      status: PurchaseRequestStatus.DRAFT,
      submittedAt: null,
      updatedAt: request.updatedAt,
    },
  });

  invariant(
    deleted.count === 1,
    "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง",
    409,
  );

  await deleteSavedAttachmentFiles(request.attachments);
}

type PurchaseRequestCancellationInput =
  | {
      action: "CANCEL";
      reason: string;
      cancellationReference?: string;
    }
  | {
      action: "REQUEST";
      reason: string;
    }
  | {
      action: "CONFIRM";
      reason?: string;
    }
  | {
      action: "REJECT";
      reason: string;
    };

function buildCancellationComment(
  reason: string,
  cancellationReference?: string,
) {
  return cancellationReference
    ? `${reason} | เลขอ้างอิงการยกเลิก PO: ${cancellationReference}`
    : reason;
}

function getCancellationDecisionStepLabel(session: SessionUser) {
  if (session.role === "ADMIN") {
    return "ผู้ดูแลระบบ";
  }

  if (isManagementApprover(session)) {
    return "บริหาร/จัดการ";
  }

  return "ฝ่ายจัดซื้อ";
}

export async function updatePurchaseRequestCancellation(
  id: string,
  session: SessionUser,
  input: PurchaseRequestCancellationInput,
) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
    include: { _count: { select: { receipts: true } } },
  });

  if (!request) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  invariant(
    session.id === request.requesterId ||
      canHandlePurchaseRequestCancellation(session),
    "คุณไม่มีสิทธิ์ดำเนินการยกเลิก PR นี้",
    403,
  );

  if (input.action === "REQUEST") {
    invariant(
      session.id === request.requesterId,
      "เฉพาะผู้ขอซื้อเท่านั้นที่ขอยกเลิก PR ที่อนุมัติแล้วได้",
      403,
    );
    invariant(
      request.status === PurchaseRequestStatus.APPROVED,
      "ขอยกเลิกได้เฉพาะ PR ที่อนุมัติแล้วและยังไม่เปิด PO",
      400,
    );

    const activeCurrentPurchasingUser = request.currentApproverId
      ? await db.user.findFirst({
          where: {
            id: request.currentApproverId,
            isActive: true,
            role: {
              in: [Role.PURCHASING, Role.ADMIN],
            },
          },
          select: {
            id: true,
          },
        })
      : null;
    const purchasingUserId =
      activeCurrentPurchasingUser?.id ??
      (await findPrimaryPurchasingUser())?.id ??
      null;

    invariant(purchasingUserId, "ไม่พบผู้รับผิดชอบฝ่ายจัดซื้อ", 400);

    await db.$transaction(async (transaction) => {
      const updated = await transaction.purchaseRequest.updateMany({
        where: {
          id,
          status: PurchaseRequestStatus.APPROVED,
        },
        data: {
          status: PurchaseRequestStatus.CANCEL_REQUESTED,
          currentApproverId: purchasingUserId,
          cancellationRequestedAt: new Date(),
          cancellationReason: input.reason,
          cancellationReference: null,
          cancelledAt: null,
          cancelledById: null,
        },
      });

      invariant(
        updated.count === 1,
        "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง",
        409,
      );

      await transaction.approval.create({
        data: {
          purchaseRequestId: id,
          approverId: session.id,
          action: ApprovalAction.CANCELLATION_REQUESTED,
          stepLabel: "การยกเลิก PR",
          comment: input.reason,
        },
      });
    });

    await sendCancellationNotification(() =>
      notifyCancellationRequested({
        requestId: id,
        prNumber: request.prNumber,
        requesterId: request.requesterId,
        purchasingUserId,
        actorId: session.id,
      }),
    );
    return;
  }

  if (input.action === "CONFIRM" || input.action === "REJECT") {
    invariant(
      canHandlePurchaseRequestCancellation(session),
      "เฉพาะฝ่ายจัดซื้อ ผู้ดูแลระบบ หรือฝ่ายบริหาร/จัดการเท่านั้นที่พิจารณาคำขอยกเลิกได้",
      403,
    );
    invariant(
      session.id !== request.requesterId,
      "ผู้ขอซื้อไม่สามารถพิจารณาคำขอยกเลิกของตนเองได้",
      403,
    );
    invariant(
      request.status === PurchaseRequestStatus.CANCEL_REQUESTED,
      "เอกสารนี้ไม่ได้อยู่ในขั้นตอนรออนุมัติการยกเลิก",
      400,
    );

    const isConfirmed = input.action === "CONFIRM";

    await db.$transaction(async (transaction) => {
      const updated = await transaction.purchaseRequest.updateMany({
        where: {
          id,
          status: PurchaseRequestStatus.CANCEL_REQUESTED,
        },
        data: isConfirmed
          ? {
              status: PurchaseRequestStatus.CANCELLED,
              currentApproverId: null,
              cancelledAt: new Date(),
              cancelledById: session.id,
            }
          : {
              status: PurchaseRequestStatus.APPROVED,
              cancellationRequestedAt: null,
              cancellationReason: null,
              cancellationReference: null,
              cancelledAt: null,
              cancelledById: null,
            },
      });

      invariant(
        updated.count === 1,
        "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง",
        409,
      );

      await transaction.approval.create({
        data: {
          purchaseRequestId: id,
          approverId: session.id,
          action: isConfirmed
            ? ApprovalAction.CANCELLED
            : ApprovalAction.CANCELLATION_DECLINED,
          stepLabel: getCancellationDecisionStepLabel(session),
          comment: input.reason,
        },
      });
    });

    if (isConfirmed) {
      await sendCancellationNotification(() =>
        notifyCancellationCompleted({
          requestId: id,
          prNumber: request.prNumber,
          requesterId: request.requesterId,
          currentApproverId: request.currentApproverId,
          actorId: session.id,
        }),
      );
    } else {
      await sendCancellationNotification(() =>
        notifyCancellationDeclined({
          requestId: id,
          prNumber: request.prNumber,
          requesterId: request.requesterId,
          actorId: session.id,
        }),
      );
    }
    return;
  }

  const isOrderedCancellation = request.status === PurchaseRequestStatus.ORDERED;
  const isOwnerCancellation =
    request.status === PurchaseRequestStatus.PENDING_APPROVAL ||
    request.status === PurchaseRequestStatus.NEED_REVISION ||
    request.status === PurchaseRequestStatus.NEED_CLARIFICATION ||
    (request.status === PurchaseRequestStatus.DRAFT && Boolean(request.submittedAt));

  if (isOrderedCancellation) {
    invariant(
      canHandlePurchaseRequestCancellation(session),
      "เฉพาะฝ่ายจัดซื้อ ผู้ดูแลระบบ หรือฝ่ายบริหาร/จัดการเท่านั้นที่ยกเลิก PR ที่เปิด PO แล้วได้",
      403,
    );
    invariant(
      !request.receivedAt && request._count.receipts === 0,
      "PR ที่รับของแล้วไม่สามารถยกเลิกได้",
      400,
    );
    invariant(
      input.cancellationReference,
      "กรุณาระบุเลขอ้างอิงการยกเลิก PO",
      400,
    );
    await assertNoPendingPurchaseOrderChanges(db, id);
  } else {
    invariant(isOwnerCancellation, "PR สถานะนี้ไม่สามารถยกเลิกได้", 400);
    invariant(
      canCancelPurchaseRequestAsOwner(session, request.requesterId),
      "เฉพาะผู้ขอซื้อ ผู้ดูแลระบบ หรือฝ่ายบริหาร/จัดการเท่านั้นที่ยกเลิก PR นี้ได้",
      403,
    );
  }

  await db.$transaction(async (transaction) => {
    const updated = await transaction.purchaseRequest.updateMany({
      where: {
        id,
        status: request.status,
        ...(isOrderedCancellation ? { receivedAt: null, receiptVersion: request.receiptVersion, receipts: { none: {} },
          purchaseOrders: { none: { changes: { some: { status: "PENDING" } } } },
        } : {}),
      },
      data: {
        status: PurchaseRequestStatus.CANCELLED,
        currentApproverId: null,
        cancellationRequestedAt: null,
        cancelledAt: new Date(),
        cancelledById: session.id,
        cancellationReason: input.reason,
        cancellationReference: isOrderedCancellation
          ? input.cancellationReference ?? null
          : null,
      },
    });

    invariant(
      updated.count === 1,
      "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง",
      409,
    );

    await transaction.approval.create({
      data: {
        purchaseRequestId: id,
        approverId: session.id,
        action: ApprovalAction.CANCELLED,
        stepLabel: isOrderedCancellation
          ? getCancellationDecisionStepLabel(session)
          : "การยกเลิก PR",
        comment: buildCancellationComment(
          input.reason,
          isOrderedCancellation ? input.cancellationReference : undefined,
        ),
      },
    });
  });

  await sendCancellationNotification(() =>
    notifyCancellationCompleted({
      requestId: id,
      prNumber: request.prNumber,
      requesterId: request.requesterId,
      currentApproverId: request.currentApproverId,
      actorId: session.id,
    }),
  );
}

export async function submitPurchaseRequest(id: string, session: SessionUser) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
  });

  if (!request) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  assertEditableDraft(session, request);
  invariant(
    request.status === PurchaseRequestStatus.DRAFT,
    "เอกสารนี้ต้องแก้ไขและส่งกลับผ่านหน้าฟอร์ม",
    400,
  );

  const approver = await findApproverForDepartment(request.department);
  invariant(approver, "ไม่พบผู้อนุมัติสำหรับแผนกนี้", 400);

  await db.$transaction(async (transaction) => {
    const updated = await transaction.purchaseRequest.updateMany({
      where: {
        id,
        status: PurchaseRequestStatus.DRAFT,
        updatedAt: request.updatedAt,
      },
      data: {
        status: PurchaseRequestStatus.PENDING_APPROVAL,
        submittedAt: new Date(),
        currentApproverId: approver.id,
      },
    });

    invariant(
      updated.count === 1,
      "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง",
      409,
    );

    await transaction.approval.create({
      data: {
        purchaseRequestId: id,
        approverId: session.id,
        action: ApprovalAction.SUBMITTED,
        stepLabel: "ผู้ขอซื้อ",
        comment: "ส่งเอกสารเข้าระบบเพื่ออนุมัติ",
      },
    });
  });

  await notifySubmission(id, request.prNumber, session.name, approver.id);
}

export async function reviewPurchaseRequest(
  id: string,
  session: SessionUser,
  input: {
    action: "APPROVED" | "REJECTED" | "RETURNED";
    comment?: string;
  },
) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
  });

  if (!request) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  invariant(isApprover(session), "เฉพาะผู้อนุมัติเท่านั้นที่ดำเนินการได้", 403);
  invariant(
    request.status === PurchaseRequestStatus.PENDING_APPROVAL,
    "เอกสารนี้ไม่ได้อยู่ในขั้นตอนรออนุมัติ",
    400,
  );
  invariant(
    canApprovePurchaseRequest(session, request.currentApproverId),
    "คุณไม่ใช่ผู้อนุมัติที่รับผิดชอบเอกสารนี้",
    403,
  );

  const purchasingUser =
    input.action === "APPROVED" ? await findPrimaryPurchasingUser() : null;

  const nextStatus =
    input.action === "APPROVED"
      ? PurchaseRequestStatus.APPROVED
      : input.action === "REJECTED"
        ? PurchaseRequestStatus.REJECTED
        : PurchaseRequestStatus.DRAFT;

  await db.$transaction(async (transaction) => {
    const updated = await transaction.purchaseRequest.updateMany({
      where: {
        id,
        status: PurchaseRequestStatus.PENDING_APPROVAL,
        currentApproverId: request.currentApproverId,
      },
      data: {
        status: nextStatus,
        approvedAt: input.action === "APPROVED" ? new Date() : null,
        currentApproverId:
          input.action === "APPROVED" ? purchasingUser?.id ?? null : null,
      },
    });

    invariant(
      updated.count === 1,
      "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง",
      409,
    );

    await transaction.approval.create({
      data: {
        purchaseRequestId: id,
        approverId: session.id,
        action:
          input.action === "APPROVED"
            ? ApprovalAction.APPROVED
            : input.action === "REJECTED"
              ? ApprovalAction.REJECTED
              : ApprovalAction.RETURNED,
        stepLabel: "หัวหน้าแผนก",
        comment: input.comment,
      },
    });
  });

  await notifyApprovalResult({
    requestId: id,
    prNumber: request.prNumber,
    requesterId: request.requesterId,
    action: input.action,
    purchasingUserId: purchasingUser?.id ?? null,
  });
}

async function assertNoPendingPurchaseOrderChanges(db: Pick<Prisma.TransactionClient, "purchaseOrderChange">, id: string) {
  const pending = await db.purchaseOrderChange.findFirst({ where: { purchaseOrder: { purchaseRequestId: id }, status: "PENDING" }, select: { id: true } });
  invariant(!pending, "PR นี้มี PO รอตรวจการแก้ไข กรุณาพิจารณาให้เสร็จก่อนรับสินค้า ยกเลิก หรือปิดงาน", 400);
}

export async function recordPurchaseRequestReceipt(
  id: string,
  session: SessionUser,
  input: ReceiptEntryInput,
) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
    include: {
      items: true,
      receipts: { where: { action: "RECEIVED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
    },
  });
  invariant(request, "ไม่พบเอกสาร PR ที่ต้องการ", 404);
  assertCanViewPurchaseRequest(session, request.requesterId, request.department, request.currentApproverId);
  invariant(request.status === PurchaseRequestStatus.ORDERED, "PR ต้องถูกสั่งซื้อแล้วและยังไม่ปิดงานจึงจะบันทึกรับของได้", 400);
  invariant(request.receiptVersion === input.expectedVersion, "ข้อมูลการรับสินค้ามีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
  await assertNoPendingPurchaseOrderChanges(db, id);

  const isClosing = input.action === "CLOSE_REMAINDER";
  if (isClosing) {
    invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อหรือผู้ดูแลระบบเท่านั้นที่ปิดยอดค้างรับได้", 403);
    invariant(input.comment && input.comment.trim().length >= 5, "กรุณาระบุเหตุผลการปิดยอดค้างรับอย่างน้อย 5 ตัวอักษร", 400);
    invariant(request.items.some((item) => item.receivedQuantity > 0), "กรุณาบันทึกรับสินค้าบางส่วนก่อนปิดยอดค้างรับ", 400);
  } else {
    invariant(input.receivedDate, "กรุณาระบุวันที่รับของ", 400);
  }
  invariant(input.items.length > 0, "กรุณาระบุจำนวนสินค้าอย่างน้อยหนึ่งรายการ", 400);
  invariant(new Set(input.items.map((item) => item.itemId)).size === input.items.length, "รายการสินค้าซ้ำกัน", 400);
  const itemById = new Map(request.items.map((item) => [item.id, item]));
  let hasOverReceipt = false;
  for (const entry of input.items) {
    const item = itemById.get(entry.itemId);
    invariant(item, "ไม่พบรายการสินค้าใน PR นี้", 400);
    invariant(Number.isInteger(entry.quantity) && entry.quantity > 0, "จำนวนต้องเป็นจำนวนเต็มที่มากกว่า 0", 400);
    const remaining = Math.max(0, item.quantity - item.receivedQuantity - item.closedQuantity);
    if (isClosing) {
      invariant(entry.quantity <= remaining, "จำนวนปิดยอดต้องไม่เกินยอดค้างรับ", 400);
      item.closedQuantity += entry.quantity;
    } else {
      invariant(item.closedQuantity === 0 || entry.quantity <= remaining, "ไม่สามารถรับสินค้าในส่วนที่ปิดยอดแล้วได้", 400);
      invariant(item.receivedQuantity + entry.quantity <= 2147483647, "จำนวนรับสินค้ามากเกินขอบเขตที่รองรับ", 400);
      item.receivedQuantity += entry.quantity;
      hasOverReceipt ||= item.receivedQuantity > item.quantity;
    }
  }
  if (hasOverReceipt) {
    invariant(input.overReceiptReason && input.overReceiptReason.trim().length >= 5, "กรุณาระบุเหตุผลการรับเกินอย่างน้อย 5 ตัวอักษร", 400);
  }
  const allSettled = request.items.every((item) => item.receivedQuantity + item.closedQuantity >= item.quantity);
  const eventDate = toUtcStartOfDayFromDateValue(input.receivedDate ?? toBangkokDateValue(new Date()));
  // Closing an undelivered balance must not change the actual goods-received
  // date to the day Purchasing closed that balance.
  const settledReceivedAt = isClosing ? request.receipts[0]?.receivedDate ?? eventDate : eventDate;
  const receipt = await db.$transaction(async (transaction) => {
    // Serialize all quantity changes, cancellation and completion on the PR.
    // A stale form or repeated submission cannot append another receipt.
    const updated = await transaction.purchaseRequest.updateMany({
      where: { id, status: PurchaseRequestStatus.ORDERED, receiptVersion: input.expectedVersion,
        purchaseOrders: { none: { changes: { some: { status: "PENDING" } } } },
      },
      data: {
        receiptVersion: { increment: 1 },
        receivedAt: allSettled ? settledReceivedAt : null,
        ...(!isClosing ? { receiptNumber: input.receiptNumber?.trim() || null, taxInvoiceNumber: input.taxInvoiceNumber?.trim() || null } : {}),
      },
    });
    invariant(updated.count === 1, "ข้อมูลการรับสินค้ามีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
    for (const entry of input.items) {
      await transaction.purchaseRequestItem.update({
        where: { id: entry.itemId },
        data: isClosing
          ? { closedQuantity: { increment: entry.quantity } }
          : { receivedQuantity: { increment: entry.quantity } },
      });
    }
    const created = await transaction.purchaseRequestReceipt.create({
      data: {
        purchaseRequestId: id,
        recordedById: session.id,
        action: input.action,
        receivedDate: eventDate,
        comment: input.comment?.trim() || null,
        overReceiptReason: hasOverReceipt ? input.overReceiptReason?.trim() : null,
        receiptNumber: !isClosing ? input.receiptNumber?.trim() || null : null,
        taxInvoiceNumber: !isClosing ? input.taxInvoiceNumber?.trim() || null : null,
        items: { create: input.items.map((entry) => ({ itemId: entry.itemId, quantity: entry.quantity })) },
      },
    });
    const quantities = input.items.map((entry) => `${itemById.get(entry.itemId)!.itemName}: ${entry.quantity}`).join(", ");
    await transaction.approval.create({
      data: {
        purchaseRequestId: id,
        approverId: session.id,
        action: ApprovalAction.COMMENTED,
        stepLabel: isClosing ? "ปิดยอดค้างรับ" : "ยืนยันรับของ",
        comment: [quantities, input.comment, hasOverReceipt ? `เหตุผลรับเกิน: ${input.overReceiptReason}` : null].filter(Boolean).join(" | "),
      },
    });
    return created;
  });
  if (allSettled && !request.receivedAt && request.currentApproverId && request.currentApproverId !== session.id) {
    try {
      await notifyReceiptReferencesPending({ requestId: id, prNumber: request.prNumber, purchasingUserId: request.currentApproverId });
    } catch (error) {
      console.error("[receipt-notification]", error);
    }
  }
  return { id: receipt.id };
}

export async function updatePurchaseRequestReceiptReferences(
  id: string,
  receiptId: string,
  session: SessionUser,
  input: { receiptNumber?: string; taxInvoiceNumber?: string; note?: string; expectedVersion?: number },
) {
  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
    include: { receipts: { where: { action: "RECEIVED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
  });
  invariant(request, "ไม่พบเอกสาร PR ที่ต้องการ", 404);
  invariant(input.expectedVersion === undefined || request.receiptVersion === input.expectedVersion, "ข้อมูลการรับสินค้ามีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
  invariant(request.status === PurchaseRequestStatus.ORDERED || request.status === PurchaseRequestStatus.COMPLETED, "PR สถานะนี้ไม่สามารถแก้ไขเอกสารรับของได้", 400);
  const receipt = await db.purchaseRequestReceipt.findFirst({ where: { id: receiptId, purchaseRequestId: id, action: "RECEIVED" } });
  invariant(receipt, "ไม่พบรายการรับสินค้าใน PR นี้", 404);
  invariant(input.receiptNumber || input.taxInvoiceNumber, "กรุณาระบุหมายเลขรับของหรือเลขที่ใบกำกับภาษี", 400);
  await db.$transaction(async (transaction) => {
    const updated = await transaction.purchaseRequest.updateMany({
      where: { id, status: request.status, receiptVersion: request.receiptVersion },
      data: {
        receiptVersion: { increment: 1 },
        ...(request.receipts[0]?.id === receiptId ? { receiptNumber: input.receiptNumber || null, taxInvoiceNumber: input.taxInvoiceNumber || null } : {}),
      },
    });
    invariant(updated.count === 1, "ข้อมูลการรับสินค้ามีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
    await transaction.purchaseRequestReceipt.update({ where: { id: receiptId }, data: { receiptNumber: input.receiptNumber || null, taxInvoiceNumber: input.taxInvoiceNumber || null } });
    await transaction.approval.create({ data: { purchaseRequestId: id, approverId: session.id, action: ApprovalAction.COMMENTED, stepLabel: "อัปเดตเอกสารรับสินค้า", comment: buildReceiptReferenceComment(input) } });
  });
}

export async function progressPurchaseRequest(
  id: string,
  session: SessionUser,
  input: {
    action: "ORDERED" | "RECEIVED" | "REQUEST_REVISION" | "REQUEST_CLARIFICATION";
    comment?: string;
    receivedDate?: string;
  },
) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!request) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  // Preserve the original all-at-once API for existing clients. New clients
  // submit explicit item quantities and a version through the receipts route.
  if (input.action === "RECEIVED") {
    const items = request.items
      .map((item) => ({ itemId: item.id, quantity: Math.max(0, item.quantity - item.receivedQuantity - item.closedQuantity) }))
      .filter((item) => item.quantity > 0);
    invariant(items.length > 0, "ไม่มีจำนวนค้างรับ กรุณาใช้หน้ารับสินค้าเพื่อบันทึกรับเกิน", 400);
    await recordPurchaseRequestReceipt(id, session, {
      action: "RECEIVED",
      expectedVersion: request.receiptVersion,
      receivedDate: input.receivedDate,
      comment: input.comment,
      items,
    });
    return;
  }

  if (
    input.action === "ORDERED" ||
    input.action === "REQUEST_REVISION" ||
    input.action === "REQUEST_CLARIFICATION"
  ) {
    invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
    invariant(
      request.status === PurchaseRequestStatus.APPROVED,
      "PR ต้องได้รับการอนุมัติก่อนฝ่ายจัดซื้อจึงจะดำเนินการได้",
      400,
    );
  }

  if (
    (input.action === "REQUEST_REVISION" ||
      input.action === "REQUEST_CLARIFICATION") &&
    !input.comment
  ) {
    throw new AppError("กรุณาระบุเหตุผลหรือคำถามประกอบการดำเนินการ", 400);
  }

  const nextStatus =
    input.action === "REQUEST_REVISION"
      ? PurchaseRequestStatus.NEED_REVISION
      : input.action === "REQUEST_CLARIFICATION"
        ? PurchaseRequestStatus.NEED_CLARIFICATION
        : PurchaseRequestStatus.ORDERED;
  const nextApprovalAction =
    input.action === "ORDERED"
      ? ApprovalAction.ORDERED
      : input.action === "REQUEST_REVISION"
        ? ApprovalAction.REQUESTED_REVISION
        : input.action === "REQUEST_CLARIFICATION"
          ? ApprovalAction.REQUESTED_CLARIFICATION
          : ApprovalAction.COMMENTED;
  const nextStepLabel = "ฝ่ายจัดซื้อ";

  await db.$transaction(async (transaction) => {
    const updated = await transaction.purchaseRequest.updateMany({
      where: {
        id,
        status: PurchaseRequestStatus.APPROVED,
      },
      data: {
        status: nextStatus,
        orderedAt: input.action === "ORDERED" ? new Date() : request.orderedAt,
      },
    });

    invariant(
      updated.count === 1,
      "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง",
      409,
    );

    await transaction.approval.create({
      data: {
        purchaseRequestId: id,
        approverId: session.id,
        action: nextApprovalAction,
        stepLabel: nextStepLabel,
        comment: input.comment,
      },
    });
  });

  if (input.action === "ORDERED") {
    await notifyProgressUpdate({
      requestId: id,
      prNumber: request.prNumber,
      requesterId: request.requesterId,
      action: input.action,
    });
  }

  if (
    input.action === "REQUEST_REVISION" ||
    input.action === "REQUEST_CLARIFICATION"
  ) {
    await notifyPurchasingReturn({
      requestId: id,
      prNumber: request.prNumber,
      requesterId: request.requesterId,
      action: input.action,
    });
  }

}

function buildReceiptReferenceComment(input: {
  receiptNumber?: string;
  taxInvoiceNumber?: string;
  note?: string;
}) {
  const parts = [
    input.receiptNumber ? `เลขรับของ: ${input.receiptNumber}` : null,
    input.taxInvoiceNumber
      ? `เลขที่ใบกำกับภาษี: ${input.taxInvoiceNumber}`
      : null,
    input.note ? `หมายเหตุ: ${input.note}` : null,
  ].filter(Boolean);

  return parts.join(" | ");
}

export async function updateReceiptReferences(
  id: string,
  session: SessionUser,
  input: {
    receiptNumber?: string;
    taxInvoiceNumber?: string;
    note?: string;
    expectedVersion?: number;
  },
) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
    include: { items: true, receipts: { where: { action: "RECEIVED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });

  if (!request) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
  invariant(input.expectedVersion === undefined || request.receiptVersion === input.expectedVersion, "ข้อมูลการรับสินค้ามีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
  await assertNoPendingPurchaseOrderChanges(db, id);
  invariant(
    request.status === PurchaseRequestStatus.ORDERED ||
      request.status === PurchaseRequestStatus.COMPLETED,
    "PR ต้องยืนยันรับของก่อนจึงจะบันทึกเลขเอกสารได้",
    400,
  );
  invariant(
    request.receivedAt,
    "PR ต้องยืนยันรับของก่อนจึงจะบันทึกเลขเอกสารได้",
    400,
  );
  invariant(request.items.every((item) => item.receivedQuantity + item.closedQuantity >= item.quantity), "ยังมียอดค้างรับ กรุณารับสินค้าหรือปิดยอดค้างรับให้ครบก่อนปิดงาน", 400);
  invariant(request.receipts.slice(0, -1).every((receipt) => receipt.receiptNumber || receipt.taxInvoiceNumber), "กรุณาบันทึกเลขเอกสารของการรับสินค้าแต่ละรอบให้ครบก่อนปิดงาน", 400);
  invariant(
    input.receiptNumber || input.taxInvoiceNumber,
    "กรุณาระบุหมายเลขรับของหรือเลขที่ใบกำกับภาษี",
    400,
  );

  const nextReceiptNumber = input.receiptNumber ?? null;
  const nextTaxInvoiceNumber = input.taxInvoiceNumber ?? null;
  const nextReceiptReferenceNote = input.note ?? null;
  const hasChanges =
    request.receiptNumber !== nextReceiptNumber ||
    request.taxInvoiceNumber !== nextTaxInvoiceNumber ||
    request.receiptReferenceNote !== nextReceiptReferenceNote;

  if (!hasChanges && request.status === PurchaseRequestStatus.COMPLETED) {
    return;
  }

  await db.$transaction(async (transaction) => {
    const updated = await transaction.purchaseRequest.updateMany({
      where: {
        id,
        status: request.status,
        receivedAt: request.receivedAt,
        updatedAt: request.updatedAt,
        receiptVersion: request.receiptVersion,
        purchaseOrders: { none: { changes: { some: { status: "PENDING" } } } },
      },
      data: {
        status:
          request.status === PurchaseRequestStatus.ORDERED
            ? PurchaseRequestStatus.COMPLETED
            : request.status,
        completedAt:
          request.status === PurchaseRequestStatus.ORDERED
            ? new Date()
            : request.completedAt,
        receiptNumber: nextReceiptNumber,
        taxInvoiceNumber: nextTaxInvoiceNumber,
        receiptReferenceNote: nextReceiptReferenceNote,
        receiptVersion: { increment: 1 },
      },
    });

    invariant(
      updated.count === 1,
      "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง",
      409,
    );

    const lastReceipt = request.receipts.at(-1);
    if (lastReceipt) {
      await transaction.purchaseRequestReceipt.update({
        where: { id: lastReceipt.id },
        data: { receiptNumber: nextReceiptNumber, taxInvoiceNumber: nextTaxInvoiceNumber },
      });
    }

    await transaction.approval.create({
      data: {
        purchaseRequestId: id,
        approverId: session.id,
        action:
          request.status === PurchaseRequestStatus.ORDERED
            ? ApprovalAction.COMPLETED
            : ApprovalAction.COMMENTED,
        stepLabel:
          request.status === PurchaseRequestStatus.ORDERED
            ? "ฝ่ายจัดซื้อ"
            : "อัปเดตเลขเอกสาร",
        comment: buildReceiptReferenceComment(input),
      },
    });
  });

  if (request.status === PurchaseRequestStatus.ORDERED) {
    await notifyProgressUpdate({
      requestId: id,
      prNumber: request.prNumber,
      requesterId: request.requesterId,
      action: "COMPLETED",
    });
  }
}

export async function getDashboardSummary(session: SessionUser) {
  const db = getDb();
  const visibleWhere = buildVisibleWhere(session);
  const today = toBangkokDateValue(new Date());
  const dailyStartDate = addDaysToDateValue(today, -13);
  const currentWeekStartDate = getWeekStartDateValue(today);
  const weeklyStartDate = addDaysToDateValue(currentWeekStartDate, -49);
  const currentMonthStartDate = `${toBangkokMonthValue(new Date())}-01`;
  const monthlyStartDate = addMonthsToDateValue(currentMonthStartDate, -5);

  const [pendingCount, approvedCount, rejectedCount, awaitingReceiptCount, recent] =
    await Promise.all([
      db.purchaseRequest.count({
        where: {
          ...visibleWhere,
          status: PurchaseRequestStatus.PENDING_APPROVAL,
        },
      }),
      db.purchaseRequest.count({
        where: {
          ...visibleWhere,
          status: {
            in: [
              PurchaseRequestStatus.APPROVED,
              PurchaseRequestStatus.CANCEL_REQUESTED,
              PurchaseRequestStatus.ORDERED,
              PurchaseRequestStatus.COMPLETED,
            ],
          },
        },
      }),
      db.purchaseRequest.count({
        where: {
          ...visibleWhere,
          status: {
            in: [
              PurchaseRequestStatus.REJECTED,
              PurchaseRequestStatus.NEED_REVISION,
              PurchaseRequestStatus.NEED_CLARIFICATION,
            ],
          },
        },
      }),
      db.purchaseRequest.count({
        where: {
          ...visibleWhere,
          status: PurchaseRequestStatus.ORDERED,
          receivedAt: null,
        },
      }),
      db.purchaseRequest.findMany({
        where: {
          ...visibleWhere,
          requestDate: {
            gte: toUtcStartOfDayFromDateValue(monthlyStartDate),
          },
        },
        select: {
          requestDate: true,
        },
        orderBy: {
          requestDate: "asc",
        },
      }),
    ]);

  const dailyMap = new Map<string, number>();
  const weeklyMap = new Map<string, number>();
  const monthlyMap = new Map<string, number>();

  recent.forEach((request) => {
    const requestDate = toBangkokDateValue(request.requestDate);
    const weekStartDate = getWeekStartDateValue(requestDate);
    const monthStartDate = `${toBangkokMonthValue(request.requestDate)}-01`;

    if (requestDate >= dailyStartDate) {
      dailyMap.set(requestDate, (dailyMap.get(requestDate) ?? 0) + 1);
    }

    if (weekStartDate >= weeklyStartDate) {
      weeklyMap.set(weekStartDate, (weeklyMap.get(weekStartDate) ?? 0) + 1);
    }

    monthlyMap.set(monthStartDate, (monthlyMap.get(monthStartDate) ?? 0) + 1);
  });

  const day = [];
  for (
    let cursor = dailyStartDate;
    cursor <= today;
    cursor = addDaysToDateValue(cursor, 1)
  ) {
    day.push({
      startDate: cursor,
      count: dailyMap.get(cursor) ?? 0,
    });
  }

  const week = [];
  for (
    let cursor = weeklyStartDate;
    cursor <= currentWeekStartDate;
    cursor = addDaysToDateValue(cursor, 7)
  ) {
    week.push({
      startDate: cursor,
      endDate: addDaysToDateValue(cursor, 6),
      count: weeklyMap.get(cursor) ?? 0,
    });
  }

  const month = [];
  for (
    let cursor = monthlyStartDate;
    cursor <= currentMonthStartDate;
    cursor = addMonthsToDateValue(cursor, 1)
  ) {
    month.push({
      startDate: cursor,
      count: monthlyMap.get(cursor) ?? 0,
    });
  }

  return {
    pendingCount,
    approvedCount,
    rejectedCount,
    awaitingReceiptCount,
    requestVolumeChart: {
      day,
      week,
      month,
    },
  } satisfies DashboardSummary;
}

export async function getReportSummary(
  session: SessionUser,
  filters: PurchaseRequestFilters,
) {
  const db = getDb();
  const requests = await db.purchaseRequest.findMany({
    where: buildFilterWhere(session, filters),
    include: {
      requester: true,
    },
    orderBy: {
      requestDate: "desc",
    },
  });

  const byDepartmentMap = new Map<string, { totalAmount: number; count: number }>();
  const byRequesterMap = new Map<string, { totalAmount: number; count: number }>();
  const byMonthMap = new Map<string, { totalAmount: number; count: number }>();

  requests.forEach((request) => {
    const amount = decimalToNumber(request.totalAmount);
    const month = toBangkokMonthValue(request.requestDate);

    const department = byDepartmentMap.get(request.department) ?? {
      totalAmount: 0,
      count: 0,
    };
    department.totalAmount += amount;
    department.count += 1;
    byDepartmentMap.set(request.department, department);

    const requester = byRequesterMap.get(request.requester.name) ?? {
      totalAmount: 0,
      count: 0,
    };
    requester.totalAmount += amount;
    requester.count += 1;
    byRequesterMap.set(request.requester.name, requester);

    const byMonth = byMonthMap.get(month) ?? { totalAmount: 0, count: 0 };
    byMonth.totalAmount += amount;
    byMonth.count += 1;
    byMonthMap.set(month, byMonth);
  });

  return {
    totalAmount: requests.reduce(
      (sum, request) => sum + decimalToNumber(request.totalAmount),
      0,
    ),
    totalRequests: requests.length,
    byDepartment: Array.from(byDepartmentMap.entries()).map(
      ([department, value]) => ({
        department,
        totalAmount: Number(value.totalAmount.toFixed(2)),
        count: value.count,
      }),
    ),
    byRequester: Array.from(byRequesterMap.entries()).map(
      ([requesterName, value]) => ({
        requesterName,
        totalAmount: Number(value.totalAmount.toFixed(2)),
        count: value.count,
      }),
    ),
    byMonth: Array.from(byMonthMap.entries()).map(([month, value]) => ({
      month,
      totalAmount: Number(value.totalAmount.toFixed(2)),
      count: value.count,
    })),
  } satisfies ReportsSummary;
}

export async function getShellContext(session: SessionUser) {
  const [notifications, unreadNotificationCount] = await Promise.all([
    listNotificationsForUser(session.id),
    getUnreadNotificationCount(session.id),
  ]);

  return {
    notifications,
    unreadNotificationCount,
  };
}
