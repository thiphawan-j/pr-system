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
  "CANCEL_REQUESTED",
  "CANCELLED",
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
  "CANCEL_REQUESTED",
  "CANCELLED",
] as const;
export type FilterablePurchaseRequestStatus =
  (typeof filterablePurchaseRequestStatuses)[number];

export const purchaseRequestListStatusFilters = [
  ...filterablePurchaseRequestStatuses,
  "AWAITING_RECEIPT_REFERENCES",
] as const;
export type PurchaseRequestListStatusFilter =
  (typeof purchaseRequestListStatusFilters)[number];

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
  "CANCELLATION_REQUESTED",
  "CANCELLATION_DECLINED",
  "CANCELLED",
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
  receivedAt?: string | null;
  hasPartialReceipt: boolean;
  hasClosedRemainder: boolean;
  updatedAt: string;
  requesterId: string;
  requesterName: string;
  requesterDepartment: string;
  reason: string;
  urgency: Priority;
  status: PurchaseRequestStatus;
  totalAmount: number;
  itemCount: number;
  itemNames: string[];
  currentApproverName?: string | null;
  latestComment?: string | null;
};

export type PurchaseRequestReceipt = {
  id: string;
  action: "RECEIVED" | "CLOSE_REMAINDER";
  receivedDate: string;
  comment: string | null;
  overReceiptReason: string | null;
  receiptNumber: string | null;
  taxInvoiceNumber: string | null;
  createdAt: string;
  recordedBy: { id: string; name: string };
  items: Array<{ itemId: string; itemName: string; quantity: number }>;
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
  receiptVersion: number;
  hasPartialReceipt: boolean;
  receipts: PurchaseRequestReceipt[];
  purchaseOrders: PurchaseOrderSummary[];
  hasPendingPurchaseOrderChange: boolean;
  completedAt?: string | null;
  cancellationRequestedAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  cancellationReference?: string | null;
  cancelledBy?: Pick<SessionUser, "id" | "name" | "email" | "role"> | null;
  receiptNumber?: string | null;
  taxInvoiceNumber?: string | null;
  receiptReferenceNote?: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<
    PurchaseRequestItemInput & {
      id: string;
      receivedQuantity: number;
      closedQuantity: number;
      remainingQuantity: number;
      overReceivedQuantity: number;
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

export type PurchaseOrderSummary = {
  id: string;
  poNumber: string;
  supplierName: string;
  issuedAt: string;
  totalAmount: number;
  itemCount: number;
};

export type PurchaseOrderDetail = PurchaseOrderSummary & {
  version: number;
  revision: number;
  canEdit: boolean;
  canReview: boolean;
  canWithdraw: boolean;
  pendingChangeId: string | null;
  changes: PurchaseOrderChange[];
  supplierId: string | null;
  supplierCode: string | null;
  supplierTaxId: string | null;
  supplierContactPerson: string | null;
  supplierContacts: SupplierContact[];
  supplierAddress: string | null;
  supplierContact: string | null;
  deliveryAddress: string | null;
  paymentTerms: string | null;
  expectedDeliveryDate: string | null;
  note: string | null;
  createdBy: { id: string; name: string };
  purchaseRequest: {
    id: string;
    prNumber: string;
    department: string;
    requesterName: string;
    status: PurchaseRequestStatus;
  };
  items: Array<{
    id: string;
    purchaseRequestItemId: string;
    itemName: string;
    description: string | null;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    amount: number;
    receivedQuantity: number;
    closedQuantity: number;
  }>;
};

export const purchaseOrderChangeStatuses = ["PENDING", "APPROVED", "REJECTED"] as const;
export type PurchaseOrderChangeStatus = (typeof purchaseOrderChangeStatuses)[number];

export type PurchaseOrderSnapshot = {
  supplierId: string | null;
  supplierCode: string | null;
  supplierTaxId: string | null;
  supplierContactPerson: string | null;
  supplierContacts: SupplierContact[];
  supplierName: string;
  supplierAddress: string | null;
  supplierContact: string | null;
  deliveryAddress: string | null;
  paymentTerms: string | null;
  expectedDeliveryDate: string | null;
  note: string | null;
  totalAmount: number;
  items: Array<{
    id?: string;
    purchaseRequestItemId?: string;
    itemName: string;
    description: string | null;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    amount: number;
  }>;
};

export type PurchaseOrderChange = {
  id: string;
  status: PurchaseOrderChangeStatus;
  baseVersion: number;
  reason: string;
  reviewComment: string | null;
  createdAt: string;
  reviewedAt: string | null;
  submittedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  before: PurchaseOrderSnapshot;
  after: PurchaseOrderSnapshot;
};

export const supplierContactChannels = ["LINE", "PHONE", "ECOMMERCE", "EMAIL", "OTHER"] as const;
export type SupplierContactChannel = (typeof supplierContactChannels)[number];
export type SupplierContact = { channel: SupplierContactChannel; value: string };

export type SupplierDetail = {
  id: string;
  code: string;
  name: string;
  taxId: string | null;
  address: string | null;
  contactPerson: string | null;
  paymentTerms: string | null;
  note: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  contacts: SupplierContact[];
};

export type SupplierListPage = {
  items: SupplierDetail[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
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
  status?: PurchaseRequestListStatusFilter | "ALL" | PurchaseRequestListStatusFilter[];
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
  totalCount: number;
  totalPages: number;
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
