import type {
  ApprovalAction,
  Priority,
  PurchaseRequestStatus,
  Role,
} from "@/lib/types";

export const appName = "PR Flow";

export const departments = [
  "Operations",
  "Projects",
  "Finance",
  "IT",
  "Admin",
  "Purchasing",
] as const;

export const units = ["ชิ้น", "ชุด", "เครื่อง", "กล่อง", "ใบ", "เมตร"] as const;

export const roleLabels: Record<Role, string> = {
  EMPLOYEE: "พนักงาน",
  APPROVER: "ผู้อนุมัติ",
  PURCHASING: "ฝ่ายจัดซื้อ",
  ADMIN: "ผู้ดูแลระบบ",
};

export const priorityLabels: Record<Priority, string> = {
  LOW: "ต่ำ",
  NORMAL: "ปกติ",
  HIGH: "สูง",
  URGENT: "ด่วนมาก",
};

export const statusLabels: Record<PurchaseRequestStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PENDING_APPROVAL: "รออนุมัติ",
  APPROVED: "อนุมัติแล้ว",
  REJECTED: "ถูกปฏิเสธ",
  ORDERED: "สั่งซื้อแล้ว",
  COMPLETED: "เสร็จสมบูรณ์",
};

export const approvalActionLabels: Record<ApprovalAction, string> = {
  DRAFT_SAVED: "บันทึกร่าง",
  SUBMITTED: "ส่งอนุมัติ",
  APPROVED: "อนุมัติ",
  REJECTED: "ปฏิเสธ",
  RETURNED: "ส่งกลับแก้ไข",
  ORDERED: "สั่งซื้อแล้ว",
  COMPLETED: "ปิดงาน",
  COMMENTED: "เพิ่มหมายเหตุ",
};

export const statusToneClassNames: Record<PurchaseRequestStatus, string> = {
  DRAFT: "bg-slate-500/15 text-slate-200 ring-slate-400/30 dark:text-slate-100",
  SUBMITTED: "bg-sky-500/15 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  PENDING_APPROVAL:
    "bg-amber-500/15 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  APPROVED:
    "bg-emerald-500/15 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  REJECTED: "bg-rose-500/15 text-rose-700 ring-rose-500/20 dark:text-rose-300",
  ORDERED:
    "bg-cyan-500/15 text-cyan-700 ring-cyan-500/20 dark:text-cyan-300",
  COMPLETED:
    "bg-violet-500/15 text-violet-700 ring-violet-500/20 dark:text-violet-300",
};

export const priorityToneClassNames: Record<Priority, string> = {
  LOW: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  NORMAL: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  HIGH: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  URGENT: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export const navigationItems = [
  { href: "/dashboard", labelKey: "dashboard" },
  { href: "/purchase-requests", labelKey: "purchaseRequests" },
  { href: "/purchase-requests/new", labelKey: "createPurchaseRequest" },
  { href: "/reports", labelKey: "reports" },
  { href: "/profile", labelKey: "profile" },
  { href: "/admin/users", labelKey: "adminUsers", roles: ["ADMIN"] },
] as const;
