import { calculatePurchaseOrderPricing, calculateTaxLine, type PurchasePriceTaxMode, type PurchaseDiscountType } from "@/lib/purchase-order-tax";
import type { PurchaseOrderSnapshot } from "@/lib/types";

type Item = PurchaseOrderSnapshot["items"][number];

function taxModeLabel(mode: PurchasePriceTaxMode) {
  return { UNSPECIFIED: "ไม่ได้ระบุ", INCLUSIVE: "รวม VAT แล้ว", EXCLUSIVE: "ยังไม่รวม VAT", NONE: "ไม่มี VAT" }[mode];
}

function discountLabel(type: PurchaseDiscountType = "NONE", value = 0) {
  return type === "NONE" ? "ไม่มีส่วนลด" : `${value.toFixed(2)} ${type === "PERCENT" ? "%" : "บาท"}`;
}

function itemSummary(item: Item, order: PurchaseOrderSnapshot) {
  const mode = item.taxMode ?? order.taxMode ?? "UNSPECIFIED";
  const tax = calculateTaxLine(item.amount, mode, order.vatRate ?? 7, { discountType: item.discountType, discountValue: item.discountValue, orderDiscountAmount: item.orderDiscountAmount });
  const hasDiscount = (item.discountType ?? "NONE") !== "NONE" || (item.discountValue ?? 0) !== 0 || (item.orderDiscountAmount ?? 0) !== 0 || (order.discountType ?? "NONE") !== "NONE";
  return [
    `ชื่อสินค้า: ${item.itemName}`,
    `รายละเอียด: ${item.description ?? "—"}`,
    `จำนวน: ${item.quantity}`,
    `หน่วย: ${item.unit ?? "—"}`,
    `ราคาต่อหน่วย: ${item.unitPrice.toFixed(2)} บาท`,
    `ยอดรวม: ${item.amount.toFixed(2)} บาท`,
    ...(hasDiscount ? [`ส่วนลดรายการ: ${discountLabel(item.discountType, item.discountValue)}`, `ส่วนลดทั้งใบที่จัดสรร: ${(item.orderDiscountAmount ?? 0).toFixed(2)} บาท`] : []),
    ...(order.taxMode !== undefined || item.taxMode !== undefined || hasDiscount ? [
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
  sourcePurchaseRequestId?: string,
) {
  if (sourcePurchaseRequestId) {
    const scoped = (order: PurchaseOrderSnapshot): PurchaseOrderSnapshot => {
      const items = order.items.filter((item) => item.sourcePurchaseRequestId === sourcePurchaseRequestId);
      const totalAmount = items.reduce((sum, item) => sum + calculateTaxLine(item.amount,
        item.taxMode ?? order.taxMode ?? "UNSPECIFIED", order.vatRate ?? 7, item).totalAmount, 0);
      return { ...order, items, totalAmount: Math.round(totalAmount * 100) / 100 };
    };
    before = scoped(before);
    after = scoped(after);
  }
  const changes = [`${poNumber}\nเหตุผล: ${reason}`];
  if (reviewComment) changes.push(`ความเห็นผู้พิจารณา: ${reviewComment}`);
  if (after.deliveryRecipientId !== undefined && ((before.deliveryRecipientId ?? null) !== after.deliveryRecipientId
    || (before.deliveryRecipientName ?? null) !== (after.deliveryRecipientName ?? null))) {
    changes.push(`ผู้รับสินค้า: ${before.deliveryRecipientName || "—"} → ${after.deliveryRecipientName || "—"}`);
  }
  if (after.deliveryRecipientPhone !== undefined && (before.deliveryRecipientPhone ?? null) !== after.deliveryRecipientPhone) {
    changes.push(`โทรผู้รับสินค้า: ${before.deliveryRecipientPhone || "—"} → ${after.deliveryRecipientPhone || "—"}`);
  }
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
  const hasDiscount = before.discountType !== undefined || after.discountType !== undefined || before.items.some((item) => item.discountType !== undefined) || after.items.some((item) => item.discountType !== undefined);
  if (!sourcePurchaseRequestId && ((before.discountType ?? "NONE") !== (after.discountType ?? "NONE") || (before.discountValue ?? 0) !== (after.discountValue ?? 0))) {
    changes.push(`ส่วนลดทั้งใบ: ${discountLabel(before.discountType, before.discountValue)} → ${discountLabel(after.discountType, after.discountValue)}`);
  }
  if (before.taxMode !== undefined || after.taxMode !== undefined || before.items.some((item) => item.taxMode != null) || after.items.some((item) => item.taxMode != null) || hasDiscount) {
    const totals = (order: PurchaseOrderSnapshot) => {
      if (!sourcePurchaseRequestId) return calculatePurchaseOrderPricing(order.items, order.taxMode ?? "UNSPECIFIED", order.vatRate ?? 7, order);
      const individual = calculatePurchaseOrderPricing(order.items, order.taxMode ?? "UNSPECIFIED", order.vatRate ?? 7);
      const lines = order.items.map((item) => calculateTaxLine(item.amount,
        item.taxMode ?? order.taxMode ?? "UNSPECIFIED", order.vatRate ?? 7, item));
      const allocated = order.items.reduce((sum, item) => sum + (item.orderDiscountAmount ?? 0), 0);
      const moneySum = (values: Array<number | null>) => values.some((value) => value === null)
        ? null : Math.round(values.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 100) / 100;
      return { ...individual, orderDiscountAmount: Math.round(allocated * 100) / 100,
        discountAmount: Math.round((individual.itemDiscountAmount + allocated) * 100) / 100,
        netAmount: moneySum(lines.map((line) => line.netAmount)), taxAmount: moneySum(lines.map((line) => line.taxAmount)) };
    };
    const oldTax = totals(before);
    const newTax = totals(after);
    const money = (value: number | null) => value === null ? "ไม่ได้ระบุ" : `${value.toFixed(2)} บาท`;
    if (hasDiscount) changes.push(`ส่วนลดรายการรวม: ${money(oldTax.itemDiscountAmount)} → ${money(newTax.itemDiscountAmount)}`, `ส่วนลดทั้งใบรวม: ${money(oldTax.orderDiscountAmount)} → ${money(newTax.orderDiscountAmount)}`, `ส่วนลดรวม: ${money(oldTax.discountAmount)} → ${money(newTax.discountAmount)}`);
    changes.push(`ยอดสุทธิ: ${money(oldTax.netAmount)} → ${money(newTax.netAmount)}`, `VAT: ${money(oldTax.taxAmount)} → ${money(newTax.taxAmount)}`);
  }
  changes.push(`${sourcePurchaseRequestId ? "ยอดรวม PO ส่วนของ PR นี้" : "ยอดรวม PO"}: ${before.totalAmount.toFixed(2)} → ${after.totalAmount.toFixed(2)} บาท`);
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
