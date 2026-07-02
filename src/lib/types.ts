export const roles = ["EMPLOYEE", "APPROVER", "PURCHASING", "ADMIN"] as const;
export type Role = (typeof roles)[number];

export const priorities = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof priorities)[number];

export const purchaseRequestStatuses = [
  "DRAFT",
  "SUBMITTED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "ORDERED",
  "COMPLETED",
] as const;
export type PurchaseRequestStatus = (typeof purchaseRequestStatuses)[number];

export const approvalActions = [
  "DRAFT_SAVED",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "RETURNED",
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
  totalAmount: number;
  monthlyChart: Array<{
    month: string;
    amount: number;
    count: number;
  }>;
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
  status?: PurchaseRequestStatus | "ALL";
  department?: string | "ALL";
  from?: string;
  to?: string;
  sort?: "newest" | "oldest" | "amount_desc" | "amount_asc";
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
