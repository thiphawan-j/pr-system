import { toThaiBahtText } from "@/lib/baht-text";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { getDictionary, getUnitLabel, type Locale } from "@/lib/i18n";
import type { PurchaseOrderDocument, PurchaseOrderDocumentElement } from "@/lib/purchase-order-document";
import { calculatePurchaseOrderPricing, type PurchaseDiscountType, type PurchasePriceTaxMode } from "@/lib/purchase-order-tax";
import type { PurchaseOrderDetail } from "@/lib/types";
import { loadPurchaseOrderFonts, measurePurchaseOrderText } from "./purchase-order-pdf";

const W = 595.28;
const H = 841.89;
const M = 36;
const RIGHT = W - M;
const BOTTOM = 789;
const NAVY = "#173c4b";
const INK = "#263640";
const MUTED = "#5b6971";
const RULE = "#c4cdd1";
const PALE = "#edf3f5";
const ROW = "#f7f9fa";

type TextLine = { text: string; size: number; bold?: boolean; color?: string };

/**
 * Layout only the issued PO. Changes awaiting review, PR comments and approval
 * reasons deliberately never enter this vendor-facing document.
 * Tax metadata describes the issued unit prices; it never rewrites them.
 * The payable amount remains the stored PO total, including for legacy orders
 * whose VAT treatment was never recorded.
 */
export async function buildPurchaseOrderDocument(order: PurchaseOrderDetail, locale: Locale): Promise<PurchaseOrderDocument> {
  const fonts = await loadPurchaseOrderFonts();
  const dictionary = getDictionary(locale);
  const taxLabels = dictionary.poTax;
  const discountLabels = dictionary.poDiscount;
  const taxMode = order.taxMode ?? "UNSPECIFIED";
  const vatRate = order.vatRate ?? 7;
  const taxSummary = order.items.every((item) => typeof item.amount === "number" && Number.isFinite(item.amount))
    ? calculatePurchaseOrderPricing(order.items, taxMode, vatRate, order)
    : null;
  const hasDiscount = (order.discountType ?? "NONE") !== "NONE" || (order.discountValue ?? 0) !== 0
    || order.items.some((item) => (item.discountType ?? "NONE") !== "NONE" || (item.discountValue ?? 0) !== 0 || (item.orderDiscountAmount ?? 0) !== 0);
  const effectiveModes = new Set(order.items.map((item) => item.taxMode ?? taxMode));
  const hasVat = effectiveModes.has("INCLUSIVE") || effectiveModes.has("EXCLUSIVE");
  const taxModeLabel = (mode: PurchasePriceTaxMode) => `${taxLabels[mode]}${mode === "INCLUSIVE" || mode === "EXCLUSIVE" ? ` ${formatNumber(vatRate, locale)}%` : ""}`;
  const priceTaxHint = effectiveModes.size > 1 ? taxLabels.mixed : taxModeLabel(effectiveModes.values().next().value ?? taxMode);
  const document: PurchaseOrderDocument = { width: W, height: H, poNumber: order.poNumber, pages: [] };
  let elements: PurchaseOrderDocumentElement[] = [];
  let y = 0;
  const width = (value: string, size: number, bold = false) => measurePurchaseOrderText(value, size, bold, fonts);
  const safe = (value: string | null | undefined) => value?.trim() || "-";
  const money = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value)
    ? formatCurrency(value, locale).replace(/฿|THB/g, "").trim()
    : "-";
  const discountDescription = (type: PurchaseDiscountType | undefined, value = 0) => type === "PERCENT"
    ? `${formatNumber(value, locale)}%`
    : type === "AMOUNT" ? `${money(value)} ${locale === "th" ? "บาท" : "THB"}` : discountLabels.NONE;
  const date = (value: string | null) => value ? formatDate(value, locale) : "-";
  function text(value: string, x: number, baseline: number, size = 9, bold = false, color = INK, align: "left" | "right" | "center" = "left") {
    elements.push({ type: "text", text: value, x, y: baseline, size, bold, color, align });
  }
  function line(x: number, top: number, x2 = RIGHT, color = RULE) {
    elements.push({ type: "line", x, y: top, x2, y2: top, color });
  }
  function rect(x: number, top: number, w: number, h: number, fill: string, stroke?: string) {
    elements.push({ type: "rect", x, y: top, width: w, height: h, fill, stroke });
  }
  const words = new Intl.Segmenter(locale === "th" ? "th" : "en", { granularity: "word" });
  const graphemes = new Intl.Segmenter("th", { granularity: "grapheme" });
  function wrap(value: string, maxWidth: number, size = 9, bold = false): string[] {
    const result: string[] = [];
    for (const paragraph of value.replace(/\r/g, "").split("\n")) {
      let current = "";
      for (const { segment } of words.segment(paragraph)) {
        if (width(current + segment, size, bold) <= maxWidth) {
          current += segment;
          continue;
        }
        if (current.trim()) result.push(current.trimEnd());
        current = "";
        if (width(segment, size, bold) <= maxWidth) {
          current = segment.trimStart();
          continue;
        }
        // A URL/code with no word boundaries must also stay inside its cell.
        for (const { segment: grapheme } of graphemes.segment(segment)) {
          if (current && width(current + grapheme, size, bold) > maxWidth) {
            result.push(current);
            current = "";
          }
          current += grapheme;
        }
      }
      if (current.trim() || !paragraph) result.push(current.trimEnd());
    }
    return result.length ? result : ["-"];
  }
  function newPage(continuation = true) {
    elements = [];
    document.pages.push({ elements });
    rect(0, 0, W, H, "#ffffff");
    if (continuation) {
      text("ใบสั่งซื้อ / PURCHASE ORDER", M, 49, 15, true, NAVY);
      text(order.poNumber, RIGHT, 48, 11, true, NAVY, "right");
      text(`วันที่เอกสาร ${date(order.issuedAt)}  |  ฉบับแก้ไข ${formatNumber(order.revision, locale)}`, RIGHT, 65, 8, false, MUTED, "right");
      line(M, 76, RIGHT, NAVY);
      y = 94;
    }
  }
  function ensureSpace(height: number) {
    if (y + height > BOTTOM) newPage();
  }
  newPage(false);
  rect(M, 41, 4, 24, "#b29a63");
  text("ผู้ซื้อ / BUYER", M + 12, 50, 9, true, MUTED);
  text("ใบสั่งซื้อ", RIGHT, 65, 25, true, NAVY, "right");
  text("PURCHASE ORDER", RIGHT, 84, 11, true, NAVY, "right");
  text(order.poNumber, RIGHT, 108, 11, true, NAVY, "right");
  text(`วันที่เอกสาร  ${date(order.issuedAt)}`, RIGHT, 124, 9, false, INK, "right");
  text(`ฉบับแก้ไข  ${formatNumber(order.revision, locale)}`, RIGHT, 138, 8, false, MUTED, "right");
  if (order.buyerCompany) {
    // The issued buyer snapshot stays separate from the title/PO metadata.
    // Every field can wrap, including unbroken emails and long legal addresses.
    const buyer = order.buyerCompany;
    const buyerWidth = RIGHT - M - 190;
    const buyerLines = [
      ...wrap(safe(buyer.name), buyerWidth - 12, 18, true).map((value) => ({ text: value, size: 18, bold: true, color: NAVY, indent: 12, leading: 22 })),
      ...wrap(`ที่อยู่  ${safe(buyer.address)}`, buyerWidth, 9).map((value) => ({ text: value, size: 9, bold: false, color: INK, indent: 0, leading: 14 })),
      ...wrap(`เลขประจำตัวผู้เสียภาษี  ${safe(buyer.taxId)}    สาขา  ${safe(buyer.branch)}`, buyerWidth, 8.5).map((value) => ({ text: value, size: 8.5, bold: false, color: INK, indent: 0, leading: 14 })),
      ...wrap(`โทร  ${safe(buyer.phone)}    อีเมล  ${safe(buyer.email)}`, buyerWidth, 8.5).map((value) => ({ text: value, size: 8.5, bold: false, color: INK, indent: 0, leading: 14 })),
    ];
    y = 74;
    for (const item of buyerLines) {
      if (y + item.leading > BOTTOM) {
        newPage();
        text("ผู้ซื้อ / BUYER (ต่อ)", M, y, 9, true, MUTED);
        y += 20;
      }
      text(item.text, M + item.indent, y, item.size, item.bold, item.color);
      y += item.leading;
    }
    y = Math.max(document.pages.length === 1 ? 148 : 94, y + 5);
    ensureSpace(10);
  } else {
    // Older POs have no legal identity snapshot; never invent a buyer company.
    text("-", M + 12, 74, 18, true, NAVY);
    text("ที่อยู่  -", M, 94, 9);
    text("เลขประจำตัวผู้เสียภาษี  -    สาขา  -", M, 110, 8.5);
    text("โทร  -    อีเมล  -", M, 126, 8.5);
    y = 148;
  }
  line(M, y, RIGHT, NAVY);
  y += 10;
  const notices: string[] = [];
  if (order.purchaseRequest.status === "CANCELLED") notices.push(`${dictionary.purchaseOrders.cancelledTitle}: ${dictionary.purchaseOrders.cancelledDescription}`);
  if (order.purchaseRequest.status === "CANCEL_REQUESTED") notices.push(`${dictionary.purchaseOrders.cancellationPendingTitle}: ${dictionary.purchaseOrders.cancellationPendingDescription}`);
  if (order.pendingChangeId) notices.push(`${dictionary.poChanges.pendingTitle}: ${dictionary.poChanges.pendingDescription}`);
  for (const notice of notices) {
    const lines = wrap(notice, RIGHT - M - 16, 8.5, true);
    ensureSpace(lines.length * 14 + 22);
    rect(M, y, RIGHT - M, lines.length * 14 + 12, "#f5eee2", "#ba9c65");
    lines.forEach((value, i) => text(value, M + 8, y + 15 + i * 14, 8.5, true));
    y += lines.length * 14 + 22;
  }
  ensureSpace(58);
  rect(M, y, RIGHT - M, 40, PALE);
  const refWidth = (RIGHT - M) / 3;
  [
    ["อ้างอิงใบขอซื้อ (PR)", order.purchaseRequest.prNumber],
    ["ใบเสนอราคาผู้จำหน่าย", "-"],
    ["สกุลเงิน", "THB (บาท)"], // THB is the existing application's currency.
  ].forEach(([label, value], index) => {
    text(label, M + index * refWidth + 10, y + 15, 8, false, MUTED);
    text(value, M + index * refWidth + 10, y + 31, 9.5, true, NAVY);
  });
  y += 58;
  const half = (RIGHT - M - 28) / 2;
  const field = (label: string, value: string | null | undefined): TextLine[] => wrap(`${label}  ${safe(value)}`, half, 8.8).map((value) => ({ text: value, size: 8.8 }));
  const phone = order.supplierContacts.filter((contact) => contact.channel === "PHONE").map((contact) => contact.value).join(", ");
  const supplier: TextLine[] = [
    { text: "ผู้จำหน่าย / SUPPLIER", size: 10, bold: true, color: NAVY },
    ...wrap(safe(order.supplierName), half, 10, true).map((value) => ({ text: value, size: 10, bold: true })),
    ...field("ที่อยู่", order.supplierAddress),
    ...field("เลขประจำตัวผู้เสียภาษี", order.supplierTaxId),
    ...field("ผู้ติดต่อ", order.supplierContactPerson),
    ...field("โทร", phone),
    ...(order.supplierCode ? field("รหัสผู้จำหน่าย", order.supplierCode) : []),
    ...order.supplierContacts.filter((contact) => contact.channel !== "PHONE").flatMap((contact) => field(dictionary.suppliers[contact.channel], contact.value)),
    ...(order.supplierContact ? field("ติดต่อเพิ่มเติม", order.supplierContact) : []),
  ];
  const delivery: TextLine[] = [
    { text: "การส่งมอบ / DELIVERY", size: 10, bold: true, color: NAVY },
    ...field("สถานที่รับสินค้า", null),
    ...field("ที่อยู่จัดส่ง", order.deliveryAddress),
    ...field("กำหนดส่งสินค้า", date(order.expectedDeliveryDate)),
    ...field("ผู้รับสินค้า", null),
    ...field("โทร", null),
  ];
  for (let i = 0; i < Math.max(supplier.length, delivery.length); i++) {
    ensureSpace(15);
    for (const [column, lines] of [supplier, delivery].entries()) {
      const item = lines[i];
      if (item) text(item.text, M + column * (half + 28), y, item.size, item.bold, item.color);
    }
    y += i === 0 ? 21 : 14;
  }
  y += 5;
  ensureSpace(54);
  line(M, y);
  y += 17;
  for (const value of wrap(`เงื่อนไขชำระเงิน  ${safe(order.paymentTerms)}`, RIGHT - M, 9)) {
    ensureSpace(16);
    text(value, M, y);
    y += 14;
  }
  ensureSpace(24);
  text("ค่าขนส่ง  -", M, y);
  y += 22;

  // Fixed columns, explicit wrapping and shared page breaks keep print and the
  // downloadable PDF in sync even for unbroken codes and multi-page items.
  const edges = [M, M + 28, M + 261, M + 313, M + 358, M + 437, RIGHT];
  const rowHeight = 13;
  function tableHeader() {
    text("รายการสั่งซื้อ", M, y, 10, true, NAVY);
    const hint = locale === "th"
      ? `ราคาต่อหน่วย: ${priceTaxHint}  |  จำนวนเงิน: บาท`
      : `Unit prices: ${priceTaxHint}  |  Amounts: THB`;
    const hints = wrap(hint, RIGHT - M - 100, 7.8);
    hints.forEach((value, index) => text(value, RIGHT, y + index * 12, 7.8, false, MUTED, "right"));
    y += 9 + (hints.length - 1) * 12;
    rect(M, y, RIGHT - M, 27, NAVY);
    ["ลำดับ", "รายการสินค้า / รายละเอียด", "จำนวน", "หน่วย", "ราคา/หน่วย", "จำนวนเงิน"].forEach((label, index) => {
      const center = index === 0 || index === 3;
      const right = index === 2 || index >= 4;
      text(label, center ? (edges[index] + edges[index + 1]) / 2 : right ? edges[index + 1] - 7 : edges[index] + 8, y + 18, 8.1, true, "#ffffff", center ? "center" : right ? "right" : "left");
    });
    y += 27;
  }
  function tablePage() { newPage(); tableHeader(); }
  ensureSpace(95);
  tableHeader();
  order.items.forEach((item, index) => {
    const discount = taxSummary?.lines[index];
    const lines: TextLine[] = [
      ...wrap(safe(item.itemName), edges[2] - edges[1] - 16, 9.5, true).map((value) => ({ text: value, size: 9.5, bold: true })),
      ...(item.description ? wrap(item.description, edges[2] - edges[1] - 16, 8.5).map((value) => ({ text: value, size: 8.5, color: MUTED })) : []),
      ...((item.taxMode ?? taxMode) !== "UNSPECIFIED" || effectiveModes.size > 1 ? wrap(`VAT: ${taxModeLabel(item.taxMode ?? taxMode)}`, edges[2] - edges[1] - 16, 8).map((value) => ({ text: value, size: 8, color: MUTED })) : []),
      ...((item.discountType ?? "NONE") !== "NONE" || (item.discountValue ?? 0) !== 0
        ? wrap(`${discountLabels.lineTitle}: ${discountDescription(item.discountType, item.discountValue)} = ${money(discount?.itemDiscountAmount)}`, edges[2] - edges[1] - 16, 8).map((value) => ({ text: value, size: 8, color: MUTED })) : []),
      ...((order.discountType ?? "NONE") !== "NONE" || (order.discountValue ?? 0) !== 0 || (item.orderDiscountAmount ?? 0) !== 0
        ? wrap(`${discountLabels.orderDiscountAmount}: ${money(discount?.orderDiscountAmount)}`, edges[2] - edges[1] - 16, 8).map((value) => ({ text: value, size: 8, color: MUTED })) : []),
    ];
    const unit = wrap(item.unit ? getUnitLabel(item.unit, locale) : "-", edges[4] - edges[3] - 12, 8.5);
    const count = Math.max(lines.length, unit.length);
    const height = count * rowHeight + 16;
    if (y + height > BOTTOM && height <= BOTTOM - 130) tablePage();
    let offset = 0;
    while (offset < count) {
      if (y + rowHeight + 16 > BOTTOM) tablePage();
      const take = Math.min(count - offset, Math.floor((BOTTOM - y - 16) / rowHeight));
      const segmentHeight = take * rowHeight + 16;
      rect(M, y, RIGHT - M, segmentHeight, index % 2 === 0 ? ROW : "#ffffff");
      text(String(index + 1), (edges[0] + edges[1]) / 2, y + 18, 8.5, false, INK, "center");
      for (let i = 0; i < take; i++) {
        const content = lines[offset + i];
        if (content) text(content.text, edges[1] + 8, y + 18 + i * rowHeight, content.size, content.bold, content.color);
        if (unit[offset + i]) text(unit[offset + i], (edges[3] + edges[4]) / 2, y + 18 + i * rowHeight, 8.5, false, INK, "center");
      }
      if (offset === 0) {
        [formatNumber(item.quantity, locale), money(item.unitPrice), money(item.amount)].forEach((value, column) => {
          const edge = [3, 5, 6][column];
          let size = 9;
          while (size > 6 && width(value, size) > edges[edge] - edges[edge - 1] - 12) size -= 0.25;
          text(value, edges[edge] - 7, y + 18, size, false, INK, "right");
        });
      }
      y += segmentHeight;
      line(M, y);
      offset += take;
    }
  });
  y += 15;
  const noteWidth = 275;
  const noteLines = [
    ...wrap(safe(order.note), noteWidth, 8.7),
    ...(hasDiscount ? [
      ...wrap(`${discountLabels.orderTitle}: ${discountDescription(order.discountType, order.discountValue)}`, noteWidth, 8.7),
      ...wrap(discountLabels.basisHint, noteWidth, 8.2),
    ] : []),
  ];
  const totalWords = toThaiBahtText(Number.isFinite(order.totalAmount) ? order.totalAmount.toFixed(2) : null) ?? "-";
  const wordLines = wrap(`จำนวนเงิน (ตัวอักษร)  ${totalWords}`, RIGHT - M - 18, 9.5, true);
  const signatureWidth = (RIGHT - M - 36) / 3;
  const signatureNames = [safe(order.createdBy.name), "-", "-"].map((name) => wrap(`ชื่อ  ${name}`, signatureWidth - 8, 8));
  const extraNameHeight = (Math.max(...signatureNames.map((names) => names.length)) - 1) * 12;
  const summaryRows = hasDiscount ? [
    [discountLabels.subtotalAmount, money(taxSummary?.subtotalAmount)],
    [discountLabels.itemDiscountAmount, money(taxSummary?.itemDiscountAmount)],
    [discountLabels.orderDiscountAmount, money(taxSummary?.orderDiscountAmount)],
    [discountLabels.discountedSubtotalAmount, money(taxSummary?.discountedSubtotalAmount)],
    [taxLabels.netAmount, money(taxSummary?.netAmount)],
    ["ค่าขนส่ง", "-"],
    [taxSummary && !taxSummary.hasUnspecifiedTax ? `${taxLabels.taxAmount}${hasVat ? ` ${formatNumber(vatRate, locale)}%` : ""}` : "ภาษีมูลค่าเพิ่ม", money(taxSummary?.taxAmount)],
    ["ยอดรวมตาม PO", money(order.totalAmount)],
  ] : [
    ["รวมค่าสินค้าตาม PO", money(taxSummary?.subtotalAmount)],
    ["ส่วนลดท้ายเอกสาร", "-"],
    [taxSummary && !taxSummary.hasUnspecifiedTax ? taxLabels.netAmount : "มูลค่าหลังส่วนลด", money(taxSummary?.netAmount)],
    ["ค่าขนส่ง", "-"],
    [taxSummary && !taxSummary.hasUnspecifiedTax ? `${taxLabels.taxAmount}${hasVat ? ` ${formatNumber(vatRate, locale)}%` : ""}` : "ภาษีมูลค่าเพิ่ม", money(taxSummary?.taxAmount)],
    ["ยอดรวมตาม PO", money(order.totalAmount)],
  ];
  const closingHeight = 214 + (summaryRows.length - 6) * 16 + (wordLines.length - 1) * 15 + extraNameHeight;
  // Long notes flow before the closing group. Totals, baht text and signature
  // spaces always remain together on the final page.
  const separateNotes = noteLines.length * 14 + 25 > 126;
  if (separateNotes) {
    ensureSpace(38);
    text("หมายเหตุและเงื่อนไขการสั่งซื้อ", M, y, 9, true, NAVY);
    y += 18;
    for (const value of noteLines) { ensureSpace(16); text(value, M, y, 8.7); y += 14; }
    y += 16;
  }
  ensureSpace(closingHeight);
  const summaryY = y;
  if (!separateNotes) {
    text("หมายเหตุและเงื่อนไขการสั่งซื้อ", M, y + 3, 9, true, NAVY);
    noteLines.forEach((value, i) => text(value, M, y + 22 + i * 14, 8.7));
  }
  const summaryX = M + 298;
  summaryRows.forEach(([label, value], index) => {
    const baseline = summaryY + index * 16 + 4;
    const isTotal = index === summaryRows.length - 1;
    if (isTotal) rect(summaryX - 8, baseline - 13, RIGHT - summaryX + 16, 25, PALE);
    text(label, summaryX, baseline + (isTotal ? 3 : 0), isTotal ? 10 : 8.5, isTotal, isTotal ? NAVY : INK);
    text(value, RIGHT - 2, baseline + (isTotal ? 3 : 0), isTotal ? 11 : 9, isTotal, isTotal ? NAVY : INK, "right");
  });
  y = summaryY + summaryRows.length * 16 + 8;
  line(M, y, RIGHT, NAVY);
  wordLines.forEach((value, index) => text(value, M + 9, y + 21 + index * 15, 9.5, true, NAVY));
  y += 34 + (wordLines.length - 1) * 15;
  ["ผู้จัดทำ", "ผู้อนุมัติ", "ผู้รับคำสั่งซื้อ (ผู้จำหน่าย)"].forEach((label, index) => {
    const x = M + index * (signatureWidth + 18);
    text(label, x + signatureWidth / 2, y + 12, 9, true, NAVY, "center");
    line(x + 8, y + 44, x + signatureWidth - 8);
    // The author is recorded. Approval/acknowledgement signatures are not.
    const names = signatureNames[index];
    names.forEach((value, i) => text(value, x + 4, y + 59 + i * 12, 8));
    text("วันที่  ...... / ...... / ............", x + 4, y + 59 + Math.max(1, names.length) * 12 + 5, 7.8);
  });
  for (const [index, page] of document.pages.entries()) {
    elements = page.elements;
    line(M, 809);
    text(order.poNumber, M, 825, 7.5, false, MUTED);
    text(`หน้า ${index + 1} / ${document.pages.length}`, RIGHT, 825, 8, false, MUTED, "right");
  }
  return document;
}
