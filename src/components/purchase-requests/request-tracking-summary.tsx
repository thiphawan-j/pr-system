import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { PurchaseRequestDetail } from "@/lib/types";

export function RequestTrackingSummary({ request: r, locale }: { request: PurchaseRequestDetail; locale: Locale }) {
  const th = locale === "th";
  const t = (thai: string, english: string) => th ? thai : english;
  const activeOrders = r.purchaseOrders.filter(order => order.status !== "CANCELLED");
  const cancelledOrders = r.purchaseOrders.length - activeOrders.length;
  const outstanding = r.receivingItems.filter(item => item.remainingQuantity > 0).length;
  const closed = r.receivingItems.filter(item => item.closedQuantity > 0).length;
  const next: Record<PurchaseRequestDetail["status"], string> = {
    DRAFT: t("ผู้ขอซื้อตรวจสอบและส่งใบขอซื้อ", "Requester reviews and submits the request"),
    SUBMITTED: t("ส่งใบขอซื้อแล้ว รอดำเนินการอนุมัติ", "Request submitted; awaiting approval processing"),
    PENDING_APPROVAL: t("รอผู้อนุมัติพิจารณา", "Awaiting approver review"),
    NEED_REVISION: t("ผู้ขอซื้อแก้ไขตามความเห็นและส่งกลับ", "Requester revises and resubmits"),
    NEED_CLARIFICATION: t("ผู้ขอซื้อชี้แจงข้อมูลและส่งกลับ", "Requester clarifies and resubmits"),
    APPROVED: t("ฝ่ายจัดซื้อเตรียมการสั่งซื้อ", "Purchasing prepares the order"),
    ORDERED: r.hasPendingPurchaseOrderChange
      ? t("รอพิจารณาการเปลี่ยนแปลง PO ก่อนรับสินค้า", "Awaiting PO change review before receiving")
      : r.receivedAt
        ? t("รับ/ปิดยอดแล้ว รอฝ่ายจัดซื้อยืนยันเอกสารอ้างอิง", "Receipt/quantity settlement recorded; awaiting purchasing reference confirmation")
        : t("ติดตามรายการที่ยังไม่สั่งซื้อและยอดค้างรับ", "Follow up on unplaced items and outstanding receipts"),
    COMPLETED: t("PR เสร็จสิ้น ตรวจสอบประวัติรับและเอกสารได้ด้านล่าง", "PR completed; receipt history and references remain available below"),
    REJECTED: t("ใบขอซื้อถูกปฏิเสธ ดูเหตุผลในประวัติ", "Request rejected; see the history for the reason"),
    CANCEL_REQUESTED: t("รอผู้มีสิทธิ์พิจารณาคำขอยกเลิก", "Awaiting authorized cancellation review"),
    CANCELLED: t("ใบขอซื้อถูกยกเลิก ข้อมูลด้านล่างเป็นประวัติ ไม่ใช่งานที่ต้องทำต่อ", "Request cancelled; details below are history, not pending work"),
  };
  const date = (value?: string | null) => value ? formatDateTime(value, locale) : t("ยังไม่มีข้อมูล", "Not recorded");
  return <Card data-testid="request-tracking-summary" className="min-w-0 border-primary/25">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{t("ภาพรวมการติดตาม PR → อนุมัติ → PO → รับสินค้า", "PR → approval → PO → receipt overview")}</CardTitle>
      <p data-testid="tracking-next-step" className="text-sm font-medium text-primary">{next[r.status]}</p>
      <p className="text-xs text-muted-foreground">{t("สรุปจากข้อมูลเดิม ไม่เปลี่ยนสถานะหรือสิทธิ์ วันที่แสดงเป็นประวัติที่บันทึกไว้", "Read-only summary of existing records. Dates are recorded history; permissions and status are unchanged.")}</p>
    </CardHeader>
    <CardContent className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <section className="min-w-0 space-y-2 rounded-xl border p-4">
        <h3 className="font-semibold">1. {t("ใบขอซื้อ", "Request")}</h3>
        <p className="break-words text-sm">{r.prNumber} · {r.requester.name}</p>
        <p className="text-xs text-muted-foreground">{t("สร้าง", "Created")}: {date(r.createdAt)}</p>
        <p className="text-xs text-muted-foreground">{t("ส่งอนุมัติ", "Submitted")}: {date(r.submittedAt)}</p>
        <a href="#pr-details" className="text-sm text-primary underline">{t("ดูรายละเอียด", "View details")}</a>
      </section>
      <section className="min-w-0 space-y-2 rounded-xl border p-4">
        <h3 className="font-semibold">2. {t("การอนุมัติ", "Approval")}</h3>
        <p className="break-words text-sm">{t("ผู้อนุมัติปัจจุบัน", "Current approver")}: {r.currentApprover?.name ?? t("ไม่มีผู้รับผิดชอบที่ระบุ", "Not assigned")}</p>
        <p className="text-xs text-muted-foreground">{t("วันที่อนุมัติที่บันทึกไว้", "Recorded approval date")}: {date(r.approvedAt)}</p>
        <a href="#pr-approval-history" className="text-sm text-primary underline">{t("ดูความเห็นและประวัติ", "View comments and history")}</a>
      </section>
      <section className="min-w-0 space-y-2 rounded-xl border p-4">
        <h3 className="font-semibold">3. {t("การสั่งซื้อ", "Orders")}</h3>
        <p className="text-sm">{t("PO ที่ไม่ถูกยกเลิก", "Non-cancelled POs")}: {activeOrders.length} · {t("ยกเลิก", "Cancelled")}: {cancelledOrders}</p>
        <p className="text-sm">{t("รายการที่เปิด PO ได้ในสถานะปัจจุบัน", "Lines eligible for PO creation in the current state")}: {r.orderableItemCount ?? t("ยังไม่มีข้อมูล", "Not recorded")}</p>
        <p className="text-xs text-muted-foreground">{t("วันที่สั่งซื้อ", "Ordered")}: {date(r.orderedAt)}</p>
        {r.purchaseOrders.length ? <ul className="space-y-1 text-sm">{r.purchaseOrders.map(order => <li key={order.id} className="break-words">{order.canView === false ? <span>{order.poNumber}</span> : <Link className="text-primary underline" href={`/purchase-orders/${order.id}`}>{order.poNumber}</Link>}{order.status === "CANCELLED" ? t(" (ยกเลิก)", " (cancelled)") : ""}</li>)}</ul> : <p className="text-xs text-muted-foreground">{r.orderedAt ? t("สั่งซื้อผ่านขั้นตอนเดิมโดยไม่มี PO ในระบบ", "Legacy order recorded without a system PO") : t("ยังไม่มี PO ในระบบ", "No system PO yet")}</p>}
      </section>
      <section className="min-w-0 space-y-2 rounded-xl border p-4">
        <h3 className="font-semibold">4. {t("รับสินค้าและปิดงาน", "Receipt and completion")}</h3>
        <p className="text-sm">{t("บันทึกรับ/ปิดยอดคงเหลือ", "Receipt / close-remainder records")}: {r.receipts.length}</p>
        <p className="text-sm">{t("รายการค้างรับ", "Outstanding lines")}: {outstanding} · {t("รายการที่ปิดยอดคงเหลือ", "Lines with closed remainder")}: {closed}</p>
        <p className="text-xs text-muted-foreground">{t("รับ/ปิดยอด", "Received/settled")}: {date(r.receivedAt)}</p>
        <p className="text-xs text-muted-foreground">{t("เสร็จสิ้น", "Completed")}: {date(r.completedAt)}</p>
        <a href="#pr-receipt-history" className="text-sm text-primary underline">{t("ดูประวัติรับและเอกสาร", "View receipts and references")}</a>
      </section>
    </CardContent>
  </Card>;
}
