import "server-only";

import {
  ApprovalAction,
  NotificationType,
  Prisma,
  PurchaseRequestStatus,
} from "@prisma/client";
import type {
  DashboardSummary,
  PurchaseRequestAttachmentInput,
  PurchaseRequestDetail,
  PurchaseRequestFilters,
  PurchaseRequestItemInput,
  PurchaseRequestListItem,
  ReportsSummary,
  SessionUser,
} from "@/lib/types";
import { toAttachmentCreateManyInput } from "@/server/attachments/attachment.service";
import {
  canManageRequestAsOwner,
  isAdmin,
  isApprover,
  isPurchasing,
} from "@/server/auth/authorization";
import {
  createNotifications,
  getUnreadNotificationCount,
  listNotificationsForUser,
} from "@/server/notifications/notification.service";
import { getDb } from "@/server/db";
import { AppError, invariant } from "@/server/shared/errors";
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
  unitPrice?: number | null;
  amount: number;
};

const purchaseRequestInclude = {
  requester: true,
  currentApprover: true,
  items: {
    orderBy: {
      createdAt: "asc",
    },
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
    unitPrice:
      item.unitPrice === undefined ? null : Number(item.unitPrice.toFixed(2)),
    amount: Number((item.quantity * (item.unitPrice ?? 0)).toFixed(2)),
  }));
}

function calculateTotal(items: PersistedItem[]) {
  return Number(
    items.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
  );
}

function buildVisibleWhere(session: SessionUser): Prisma.PurchaseRequestWhereInput {
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
        { items: { some: { supplierName: { contains: filters.query, mode: "insensitive" } } } },
      ],
    });
  }

  if (filters.status && filters.status !== "ALL") {
    andConditions.push({
      status: filters.status as PurchaseRequestStatus,
    });
  }

  if (filters.department && filters.department !== "ALL") {
    andConditions.push({
      department: filters.department,
    });
  }

  if (filters.from || filters.to) {
    andConditions.push({
      requestDate: {
        gte: filters.from ? new Date(filters.from) : undefined,
        lte: filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : undefined,
      },
    });
  }

  return {
    AND: andConditions,
  };
}

function buildSortOrder(sort: PurchaseRequestFilters["sort"]) {
  switch (sort) {
    case "oldest":
      return [{ requestDate: "asc" }] satisfies Prisma.PurchaseRequestOrderByWithRelationInput[];
    case "amount_desc":
      return [{ totalAmount: "desc" }, { requestDate: "desc" }] satisfies Prisma.PurchaseRequestOrderByWithRelationInput[];
    case "amount_asc":
      return [{ totalAmount: "asc" }, { requestDate: "desc" }] satisfies Prisma.PurchaseRequestOrderByWithRelationInput[];
    case "newest":
    default:
      return [{ requestDate: "desc" }] satisfies Prisma.PurchaseRequestOrderByWithRelationInput[];
  }
}

function toListItem(
  request: Prisma.PurchaseRequestGetPayload<{
    include: {
      requester: true;
      currentApprover: true;
      items: true;
      approvals: {
        include: { approver: true };
      };
    };
  }>,
) {
  const latestApproval = request.approvals[request.approvals.length - 1];

  return {
    id: request.id,
    prNumber: request.prNumber,
    requestDate: request.requestDate.toISOString(),
    requesterId: request.requesterId,
    requesterName: request.requester.name,
    requesterDepartment: request.department,
    reason: request.reason,
    urgency: request.urgency,
    status: request.status,
    totalAmount: decimalToNumber(request.totalAmount),
    itemCount: request.items.length,
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
    requestDate: request.requestDate.toISOString(),
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
    submittedAt: request.submittedAt?.toISOString() ?? null,
    approvedAt: request.approvedAt?.toISOString() ?? null,
    orderedAt: request.orderedAt?.toISOString() ?? null,
    receivedAt: request.receivedAt?.toISOString() ?? null,
    completedAt: request.completedAt?.toISOString() ?? null,
    receiptNumber: request.receiptNumber ?? null,
    taxInvoiceNumber: request.taxInvoiceNumber ?? null,
    receiptReferenceNote: request.receiptReferenceNote ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    items: request.items.map((item) => ({
      id: item.id,
      itemName: item.itemName,
      description: item.description ?? undefined,
      supplierName: item.supplierName ?? undefined,
      quantity: item.quantity,
      unit: item.unit ?? undefined,
      unitPrice:
        item.unitPrice === null ? undefined : decimalToNumber(item.unitPrice),
      amount: decimalToNumber(item.amount),
    })),
    attachments: request.attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      storedName: attachment.storedName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      storagePath: attachment.storagePath,
      createdAt: attachment.createdAt.toISOString(),
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
      createdAt: approval.createdAt.toISOString(),
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

function assertCanView(
  session: SessionUser,
  requesterId: string,
  department: string,
  currentApproverId?: string | null,
) {
  if (isAdmin(session) || isPurchasing(session)) {
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
    request.status === PurchaseRequestStatus.DRAFT,
    "เอกสารที่ส่งอนุมัติแล้วไม่สามารถแก้ไขได้",
    400,
  );
}

async function generateNextPrNumber(requestDate: Date) {
  const db = getDb();
  const year = requestDate.getUTCFullYear();
  const month = `${requestDate.getUTCMonth() + 1}`.padStart(2, "0");
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

export async function listPurchaseRequests(
  session: SessionUser,
  filters: PurchaseRequestFilters,
) {
  const db = getDb();
  const where = buildFilterWhere(session, filters);
  const orderBy = buildSortOrder(filters.sort);

  const requests = await db.purchaseRequest.findMany({
    where,
    include: {
      requester: true,
      currentApprover: true,
      items: true,
      approvals: {
        include: {
          approver: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
    orderBy,
  });

  return requests.map(toListItem);
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

  assertCanView(
    session,
    request.requesterId,
    request.department,
    request.currentApproverId,
  );

  return toDetail(request);
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
    attachments?: PurchaseRequestAttachmentInput[];
  },
) {
  const db = getDb();
  const normalizedItems = toPersistedItems(input.items);
  const totalAmount = calculateTotal(normalizedItems);
  const requestDate = new Date(`${input.requestDate}T00:00:00.000Z`);
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
  let currentApprover = null;

  if (input.submit) {
    currentApprover = await findApproverForDepartment(input.department);
    invariant(currentApprover, "ไม่พบผู้อนุมัติสำหรับแผนกนี้", 400);
  }

  await db.$transaction(async (transaction) => {
    await transaction.purchaseRequestItem.deleteMany({
      where: { purchaseRequestId: id },
    });

    await transaction.purchaseRequest.update({
      where: { id },
      data: {
        requestDate: new Date(`${input.requestDate}T00:00:00.000Z`),
        department: input.department,
        reason: input.reason,
        urgency: input.urgency,
        totalAmount,
        currentApproverId: currentApprover?.id ?? null,
        submittedAt: input.submit ? new Date() : null,
        status: input.submit
          ? PurchaseRequestStatus.PENDING_APPROVAL
          : PurchaseRequestStatus.DRAFT,
        items: {
          create: normalizedItems,
        },
        approvals: {
          create: {
            approverId: session.id,
            action: input.submit
              ? ApprovalAction.SUBMITTED
              : ApprovalAction.DRAFT_SAVED,
            stepLabel: "ผู้ขอซื้อ",
            comment: input.submit ? "แก้ไขและส่งเอกสารใหม่" : "แก้ไขร่างเอกสาร",
          },
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

  if (currentApprover) {
    await notifySubmission(existing.id, existing.prNumber, session.name, currentApprover.id);
  }

  return existing.id;
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

  const approver = await findApproverForDepartment(request.department);
  invariant(approver, "ไม่พบผู้อนุมัติสำหรับแผนกนี้", 400);

  await db.purchaseRequest.update({
    where: { id },
    data: {
      status: PurchaseRequestStatus.PENDING_APPROVAL,
      submittedAt: new Date(),
      currentApproverId: approver.id,
      approvals: {
        create: {
          approverId: session.id,
          action: ApprovalAction.SUBMITTED,
          stepLabel: "ผู้ขอซื้อ",
          comment: "ส่งเอกสารเข้าระบบเพื่ออนุมัติ",
        },
      },
    },
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
    isAdmin(session) || request.currentApproverId === session.id,
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

  await db.purchaseRequest.update({
    where: { id },
    data: {
      status: nextStatus,
      approvedAt: input.action === "APPROVED" ? new Date() : null,
      currentApproverId:
        input.action === "APPROVED" ? purchasingUser?.id ?? null : null,
      approvals: {
        create: {
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
      },
    },
  });

  await notifyApprovalResult({
    requestId: id,
    prNumber: request.prNumber,
    requesterId: request.requesterId,
    action: input.action,
    purchasingUserId: purchasingUser?.id ?? null,
  });
}

export async function progressPurchaseRequest(
  id: string,
  session: SessionUser,
  input: {
    action: "ORDERED" | "RECEIVED";
    comment?: string;
    receivedDate?: string;
  },
) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
  });

  if (!request) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  if (input.action === "ORDERED") {
    invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
    invariant(
      request.status === PurchaseRequestStatus.APPROVED,
      "PR ต้องได้รับการอนุมัติก่อนจึงจะสั่งซื้อได้",
      400,
    );
  }

  if (input.action === "RECEIVED") {
    assertCanView(
      session,
      request.requesterId,
      request.department,
      request.currentApproverId,
    );
    invariant(input.receivedDate, "กรุณาระบุวันที่รับของ", 400);
    invariant(
      request.status === PurchaseRequestStatus.ORDERED,
      "PR ต้องถูกสั่งซื้อแล้วก่อนจึงจะยืนยันรับของได้",
      400,
    );
  }

  await db.purchaseRequest.update({
    where: { id },
    data: {
      status: PurchaseRequestStatus.ORDERED,
      orderedAt: input.action === "ORDERED" ? new Date() : request.orderedAt,
      receivedAt:
        input.action === "RECEIVED" && input.receivedDate
          ? new Date(`${input.receivedDate}T00:00:00.000Z`)
          : request.receivedAt,
      approvals: {
        create: {
          approverId: session.id,
          action:
            input.action === "ORDERED"
              ? ApprovalAction.ORDERED
              : ApprovalAction.COMMENTED,
          stepLabel: input.action === "ORDERED" ? "ฝ่ายจัดซื้อ" : "ยืนยันรับของ",
          comment: input.comment,
        },
      },
    },
  });

  if (input.action === "ORDERED") {
    await notifyProgressUpdate({
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
  },
) {
  const db = getDb();
  const request = await db.purchaseRequest.findUnique({
    where: { id },
  });

  if (!request) {
    throw new AppError("ไม่พบเอกสาร PR ที่ต้องการ", 404);
  }

  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
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

  if (!hasChanges) {
    return;
  }

  await db.purchaseRequest.update({
    where: { id },
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
      approvals: {
        create: {
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
      },
    },
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

  const [pendingCount, approvedCount, rejectedCount, amountAggregate, recent] =
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
              PurchaseRequestStatus.ORDERED,
              PurchaseRequestStatus.COMPLETED,
            ],
          },
        },
      }),
      db.purchaseRequest.count({
        where: {
          ...visibleWhere,
          status: PurchaseRequestStatus.REJECTED,
        },
      }),
      db.purchaseRequest.aggregate({
        where: visibleWhere,
        _sum: {
          totalAmount: true,
        },
      }),
      db.purchaseRequest.findMany({
        where: {
          ...visibleWhere,
          requestDate: {
            gte: new Date(new Date().setMonth(new Date().getMonth() - 5)),
          },
        },
        select: {
          requestDate: true,
          totalAmount: true,
        },
        orderBy: {
          requestDate: "asc",
        },
      }),
    ]);

  const monthlyMap = new Map<string, { amount: number; count: number }>();

  recent.forEach((request) => {
    const key = request.requestDate.toISOString().slice(0, 7);
    const current = monthlyMap.get(key) ?? { amount: 0, count: 0 };
    current.amount += decimalToNumber(request.totalAmount);
    current.count += 1;
    monthlyMap.set(key, current);
  });

  const monthlyChart = Array.from(monthlyMap.entries()).map(([month, value]) => ({
    month,
    amount: Number(value.amount.toFixed(2)),
    count: value.count,
  }));

  return {
    pendingCount,
    approvedCount,
    rejectedCount,
    totalAmount: decimalToNumber(amountAggregate._sum.totalAmount ?? 0),
    monthlyChart,
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
    const month = request.requestDate.toISOString().slice(0, 7);

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
