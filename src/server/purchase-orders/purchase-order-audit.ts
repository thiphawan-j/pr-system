import { calculatePurchaseOrderTax, calculateTaxLine, type PurchasePriceTaxMode } from "@/lib/purchase-order-tax";
import type { PurchaseOrderSnapshot } from "@/lib/types";

type Item = PurchaseOrderSnapshot["items"][number];

function taxModeLabel(mode: PurchasePriceTaxMode) {
  return { UNSPECIFIED: "ไม่ได้ระบุ", INCLUSIVE: "รวม VAT แล้ว", EXCLUSIVE: "ยังไม่รวม VAT", NONE: "ไม่มี VAT" }[mode];
}

function itemSummary(item: Item, order: PurchaseOrderSnapshot) {
  const mode = item.taxMode ?? order.taxMode ?? "UNSPECIFIED";
  const tax = calculateTaxLine(item.amount, mode, order.vatRate ?? 7);
  return [
    `ชื่อสินค้า: ${item.itemName}`,
    `รายละเอียด: ${item.description ?? "—"}`,
    `จำนวน: ${item.quantity}`,
    `หน่วย: ${item.unit ?? "—"}`,
    `ราคาต่อหน่วย: ${item.unitPrice.toFixed(2)} บาท`,
    `ยอดรวม: ${item.amount.toFixed(2)} บาท`,
    ...(order.taxMode !== undefined || item.taxMode !== undefined ? [
      `รูปแบบภาษี: ${taxModeLabel(mode)}${item.taxMode == null ? " (ตามทั้งใบ)" : " (กำหนดเฉพาะรายการ)"}`,
      `อัตรา VAT: ${(order.vatRate ?? 7).toFixed(2)}%`,
      `ยอดสุทธิ: ${tax.netAmount === null ? "ไม่ได้ระบุ" : `${tax.netAmount.toFixed(2)} บาท`}`,
      `VAT: ${tax.taxAmount === null ? "ไม่ได้ระบุ" : `${tax.taxAmount.toFixed(2)} บาท`}`,
      `ยอดชำระ: ${tax.totalAmount.toFixed(2)} บาท`,
    ] : []),
  ].join(" | ");
}

export function purchaseOrderChangeComment(
  poNumber: string,
  before: PurchaseOrderSnapshot,
  after: PurchaseOrderSnapshot,
  reason: string,
  reviewComment?: string | null,
) {
  const changes = [`${poNumber}\nเหตุผล: ${reason}`];
  if (reviewComment) changes.push(`ความเห็นผู้พิจารณา: ${reviewComment}`);
  const fields = {
    supplierName: "ผู้ขาย", supplierCode: "รหัสผู้ขาย", supplierTaxId: "เลขประจำตัวผู้เสียภาษีผู้ขาย",
    supplierAddress: "ที่อยู่ผู้ขาย", supplierContactPerson: "ผู้ติดต่อ", supplierContact: "ข้อมูลติดต่อ",
    deliveryAddress: "สถานที่ส่งสินค้า", paymentTerms: "เงื่อนไขชำระเงิน",
    expectedDeliveryDate: "วันที่ส่งสินค้า", note: "หมายเหตุ",
  } as const;
  for (const [field, label] of Object.entries(fields) as Array<[keyof typeof fields, string]>) {
    if (before[field] !== after[field]) changes.push(`${label}: ${before[field] || "—"} → ${after[field] || "—"}`);
  }
  const contactSummary = (value: PurchaseOrderSnapshot) => value.supplierContacts.map((contact) => `${contact.channel}: ${contact.value}`).join(", ") || "—";
  if (contactSummary(before) !== contactSummary(after)) {
    changes.push(`ช่องทางติดต่อ: ${contactSummary(before)} → ${contactSummary(after)}`);
  }
  if ((before.taxMode ?? "UNSPECIFIED") !== (after.taxMode ?? "UNSPECIFIED")) {
    changes.push(`รูปแบบภาษีทั้งใบ: ${taxModeLabel(before.taxMode ?? "UNSPECIFIED")} → ${taxModeLabel(after.taxMode ?? "UNSPECIFIED")}`);
  }
  if ((before.vatRate ?? 7) !== (after.vatRate ?? 7)) changes.push(`อัตรา VAT: ${(before.vatRate ?? 7).toFixed(2)}% → ${(after.vatRate ?? 7).toFixed(2)}%`);
  if (before.taxMode !== undefined || after.taxMode !== undefined || before.items.some((item) => item.taxMode != null) || after.items.some((item) => item.taxMode != null)) {
    const totals = (order: PurchaseOrderSnapshot) => calculatePurchaseOrderTax(order.items, order.taxMode ?? "UNSPECIFIED", order.vatRate ?? 7);
    const oldTax = totals(before);
    const newTax = totals(after);
    const money = (value: number | null) => value === null ? "ไม่ได้ระบุ" : `${value.toFixed(2)} บาท`;
    changes.push(`ยอดสุทธิ: ${money(oldTax.netAmount)} → ${money(newTax.netAmount)}`, `VAT: ${money(oldTax.taxAmount)} → ${money(newTax.taxAmount)}`);
  }
  changes.push(`ยอดรวม PO: ${before.totalAmount.toFixed(2)} → ${after.totalAmount.toFixed(2)} บาท`);
  const retainedIds = new Set(after.items.flatMap((item) => item.id ? [item.id] : []));
  for (const item of before.items) {
    if (!item.id || !retainedIds.has(item.id)) changes.push(`ลบสินค้า: ${itemSummary(item, before)}`);
  }
  const originals = new Map(before.items.map((item, index) => [item.id, { item, index }]));
  for (const [index, item] of after.items.entries()) {
    const original = item.id ? originals.get(item.id) : undefined;
    if (!original) {
      changes.push(`เพิ่มสินค้า: ${itemSummary(item, after)}`);
    } else if (itemSummary(original.item, before) !== itemSummary(item, after)) {
      changes.push(`แก้ไขสินค้า\nก่อน: ${itemSummary(original.item, before)}\nหลัง: ${itemSummary(item, after)}`);
    } else if (original.index !== index) {
      changes.push(`ลำดับสินค้า ${item.itemName}: ${original.index + 1} → ${index + 1}`);
    }
  }
  return changes.join("\n");
}
