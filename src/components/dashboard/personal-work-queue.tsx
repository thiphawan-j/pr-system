import Link from "@/components/loading/navigation-link";
import { ArrowRight, ClipboardList } from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { getPersonalWorkQueue } from "@/server/purchase-requests/purchase-request.service";

const labels = {
  th: { title: "งานของฉัน", hint: "เริ่มจากงานที่ต้องทำต่อ • แสดงสูงสุด 5 รายการต่อกลุ่ม เรียงจากรายการที่รอนาน", empty: "ไม่มีงานในกลุ่มนี้", open: "เปิดรายละเอียด", edit: "กรอก / แก้ไขต่อ", all: "รายการ PR ทั้งหมด", receiptHint: "เปิดตรวจยอดและเงื่อนไขการรับของก่อนดำเนินการ", groups: { drafts: "ร่างของฉัน", returned: "ต้องแก้ไข / เพิ่มข้อมูล", approval: "รอฉันตรวจอนุมัติ", purchasing: "รอดำเนินการจัดซื้อ", receipts: "ติดตามการรับของ" } },
  en: { title: "My work", hint: "What to do next • Up to 5 requests per group, oldest update first", empty: "No work in this group", open: "Open details", edit: "Continue editing", all: "All purchase requests", receiptHint: "Review quantities and receiving conditions before taking action", groups: { drafts: "My drafts", returned: "Revisions / clarification", approval: "Approval review", purchasing: "Ready for purchasing", receipts: "Receiving follow-up" } },
};
export function PersonalWorkQueue({ groups, locale }: { groups: Awaited<ReturnType<typeof getPersonalWorkQueue>>; locale: "th" | "en" }) {
  const t = labels[locale];
  return <section aria-labelledby="personal-work-title" className="space-y-4" data-personal-work-queue>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="personal-work-title" className="flex items-center gap-2 text-2xl font-semibold"><ClipboardList className="size-5 text-primary" />{t.title}</h2><p className="mt-1 text-sm text-muted-foreground">{t.hint}</p></div>
      <Link href="/purchase-requests" className="rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-muted">{t.all}</Link>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map(group => <div key={group.key} data-work-group={group.key} className="min-w-0 rounded-2xl border border-border/70 bg-card p-5">
        <h3 className="mb-4 flex items-center justify-between gap-3 font-semibold">{t.groups[group.key]}<span className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">{formatNumber(group.total, locale)}</span></h3>
        {!group.items.length ? <p className="py-3 text-sm text-muted-foreground">{t.empty}</p> : <ul className="space-y-3">{group.items.map(item => <li key={item.id}>
          <Link href={`/purchase-requests/${item.id}${group.key === "drafts" || group.key === "returned" ? "/edit" : ""}`} className="block rounded-xl border border-border/60 p-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
            <span className="text-xs text-muted-foreground">{item.prNumber} · {item.requesterName}</span>
            <p className="mt-1 line-clamp-2 break-words text-sm font-medium">{item.reason}</p>
            {group.key === "returned" && item.latestComment ? <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{item.latestComment}</p> : null}
            <span className="mt-2 flex items-center gap-2 text-xs font-medium text-primary">{group.key === "drafts" || group.key === "returned" ? t.edit : t.open}<ArrowRight className="size-3" /></span>
          </Link>
        </li>)}</ul>}
        {group.key === "receipts" ? <p className="mt-3 text-xs text-muted-foreground">{t.receiptHint}</p> : null}
      </div>)}
    </div>
  </section>;
}
