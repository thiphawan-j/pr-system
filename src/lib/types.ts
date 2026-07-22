export const roles = ["EMPLOYEE", "APPROVER", "PURCHASING", "ADMIN"] as const;
export type Role = (typeof roles)[number];

export const priorities = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof priorities)[number];

export const purchaseRequestStatuses = [
  "DRAFT",
  "SUBMITTED",
  "PENDING_APPROVAL",
  "APPROVED",
  "NEED_REVISION",
  "NEED_CLARIFICATION",
  "REJECTED",
  "ORDERED",
  "COMPLETED",
] as const;
export type PurchaseRequestStatus = (typeof purchaseRequestStatuses)[number];

export const filterablePurchaseRequestStatuses = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "NEED_REVISION",
  "NEED_CLARIFICATION",
  "REJECTED",
  "ORDERED",
  "COMPLETED",
] as const;
export type FilterablePurchaseRequestStatus =
  (typeof filterablePurchaseRequestStatuses)[number];

export const purchaseRequestQuickFilters = [
  "pending",
  "approved",
  "rejected",
  "awaiting_receipt",
] as const;
export type PurchaseRequestQuickFilter =
  (typeof purchaseRequestQuickFilters)[number];

export const approvalActions = [
  "DRAFT_SAVED",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "RETURNED",
  "REQUESTED_REVISION",
  "REQUESTED_CLARIFICATION",
  "ORDERED",
  "COMPLETED",
  "COMMENTED",
] as const;
export type ApprovalAction =
  (typeof approvalActions)[number];

export const notificationTypes = ["INFO", "SUCCESS", "WARNING", "ERROR"] as const;
export type NotificationType = (typeof notificationTypes)[number];

export type SessionUser = {
  id: string;
  employeeCode: string;
  name: string;
  username?: string | null;
  phone?: string | null;
  email: string;
  department: string;
  role: Role;
  title?: string | null;
};

export type AdminUserItem = SessionUser & {
  isActive: boolean;
};

export type AdminUserListPage = {
  items: AdminUserItem[];
  page: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
  nextPage: number | null;
};

export type PurchaseRequestItemInput = {
  itemName: string;
  description?: string;
  supplierName?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  amount: number;
};

export type PurchaseRequestAttachmentInput = {
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  storagePath: string;
};

export type PurchaseRequestAttachmentItem = PurchaseRequestAttachmentInput & {
  id: string;
  createdAt: string;
  uploadedBy: Pick<SessionUser, "id" | "name" | "email" | "role">;
};

export type PurchaseRequestListItem = {
  id: string;
  prNumber: string;
  requestDate: string;
  updatedAt: string;
  requesterId: string;
  requesterName: string;
  requesterDepartment: string;
  reason: string;
  urgency: Priority;
  status: PurchaseRequestStatus;
  totalAmount: number;
  itemCount: number;
  currentApproverName?: string | null;
  latestComment?: string | null;
};

export type PurchaseRequestDetail = {
  id: string;
  prNumber: string;
  requestDate: string;
  department: string;
  reason: string;
  urgency: Priority;
  status: PurchaseRequestStatus;
  totalAmount: number;
  requester: SessionUser;
  currentApprover?: Pick<SessionUser, "id" | "name" | "email" | "role"> | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  orderedAt?: string | null;
  receivedAt?: string | null;
  completedAt?: string | null;
  receiptNumber?: string | null;
  taxInvoiceNumber?: string | null;
  receiptReferenceNote?: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<
    PurchaseRequestItemInput & {
      id: string;
    }
  >;
  attachments: PurchaseRequestAttachmentItem[];
  approvals: Array<{
    id: string;
    action: ApprovalAction;
    comment?: string | null;
    stepLabel?: string | null;
    createdAt: string;
    approver: Pick<SessionUser, "id" | "name" | "email" | "role">;
  }>;
};

export type DashboardSummary = {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  awaitingReceiptCount: number;
  requestVolumeChart: {
    day: Array<{
      startDate: string;
      count: number;
    }>;
    week: Array<{
      startDate: string;
      endDate: string;
      count: number;
    }>;
    month: Array<{
      startDate: string;
      count: number;
    }>;
  };
};

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  link?: string | null;
  type: NotificationType;
  readAt?: string | null;
  createdAt: string;
};

export type PurchaseRequestFilters = {
  query?: string;
  status?: FilterablePurchaseRequestStatus | "ALL";
  urgency?: Priority | "ALL";
  preset?: PurchaseRequestQuickFilter;
  department?: string | "ALL";
  from?: string;
  to?: string;
  sort?: "pr_desc" | "pr_asc" | "updated_desc" | "status_asc";
};

export type PurchaseRequestListPage = {
  items: PurchaseRequestListItem[];
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

export type ReportsSummary = {
  totalAmount: number;
  totalRequests: number;
  byDepartment: Array<{
    department: string;
    totalAmount: number;
    count: number;
  }>;
  byRequester: Array<{
    requesterName: string;
    totalAmount: number;
    count: number;
  }>;
  byMonth: Array<{
    month: string;
    totalAmount: number;
    count: number;
  }>;
};
