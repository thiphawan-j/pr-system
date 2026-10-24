import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { toThaiBahtText } from "../../src/lib/baht-text";
import { getDictionary } from "../../src/lib/i18n";
import type { PurchaseOrderDocument, PurchaseOrderDocumentText } from "../../src/lib/purchase-order-document";
import { calculatePurchaseOrderTax } from "../../src/lib/purchase-order-tax";
import { buildPurchaseOrderDocument } from "../../src/server/purchase-orders/purchase-order-document";
import { createPurchaseOrderPdf, loadPurchaseOrderFonts, measurePurchaseOrderText } from "../../src/server/purchase-orders/purchase-order-pdf";
import { documentOrderFixture, emptyOptionalDocumentFixture, taxDocumentFixture } from "../fixtures/purchase-order-document";

function textOf(document: PurchaseOrderDocument, page?: number) {
  return (page === undefined ? document.pages : [document.pages[page]]).flatMap((item) => item.elements.filter((element): element is PurchaseOrderDocumentText => element.type === "text"));
}

function summaryValue(document: PurchaseOrderDocument, label: string) {
  const texts = textOf(document);
  const heading = texts.find((item) => item.x === 334 && item.text === label);
  assert(heading, `missing summary label: ${label}`);
  return texts.find((item) => item.align === "right" && item.y === heading.y)?.text;
}

test("short PO preserves issued snapshots, stored amounts and unknown financial fields", async () => {
  const order = documentOrderFixture();
  const document = await buildPurchaseOrderDocument(order, "th");
  assert.equal(document.pages.length, 1);
  const texts = textOf(document).map((element) => element.text);
  const itemColumnText = textOf(document).filter((element) => element.x === 72).map((element) => element.text).join("").replace(/\s/g, "");
  for (const item of order.items) {
    assert(itemColumnText.includes(item.itemName.replace(/\s/g, "")));
    assert(texts.includes(item.amount.toFixed(2)));
    assert(texts.includes(item.unitPrice.toFixed(2)));
  }
  assert(texts.includes(order.supplierName));
  assert(texts.includes("37.02"));
  assert(texts.includes("จำนวนเงิน (ตัวอักษร)  สามสิบเจ็ดบาทสองสตางค์"));
  assert(texts.includes(`ราคาต่อหน่วย: ${getDictionary("th").poTax.UNSPECIFIED}  |  จำนวนเงิน: บาท`));
  assert(!texts.some((value) => /7%|เครดิต 30|ตัวอย่างเอกสาร|สถานะ PR ปัจจุบัน|10,700/.test(value)));
  for (const label of ["ส่วนลดท้ายเอกสาร", "มูลค่าหลังส่วนลด", "ค่าขนส่ง", "ภาษีมูลค่าเพิ่ม"]) {
    const element = textOf(document).find((item) => item.text === label)!;
    assert(textOf(document).some((item) => item.y === element.y && item.text === "-"));
  }
  assert(!texts.includes(order.purchaseRequest.requesterName));
  for (const placeholder of ["ที่อยู่  -", "เลขประจำตัวผู้เสียภาษี  -    สาขา  -", "โทร  -    อีเมล  -"]) assert(texts.includes(placeholder));
});

test("inclusive prices disclose net and VAT without adding VAT twice", async () => {
  for (const locale of ["th", "en"] as const) {
    const order = taxDocumentFixture("INCLUSIVE");
    const document = await buildPurchaseOrderDocument(order, locale);
    const labels = getDictionary(locale).poTax;
    assert.equal(document.pages.length, 1);
    assert.equal(summaryValue(document, labels.netAmount), "93.46");
    assert.equal(summaryValue(document, `${labels.taxAmount} 7%`), "6.54");
    assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "100.00");
    assert(textOf(document).some((item) => item.text === `VAT: ${labels.INCLUSIVE} 7%`));
    assert(textOf(document).some((item) => item.text === "จำนวนเงิน (ตัวอักษร)  หนึ่งร้อยบาทถ้วน"));
  }
});

test("exclusive prices show entered prices separately from the payable VAT-inclusive total", async () => {
  const order = taxDocumentFixture("EXCLUSIVE");
  const document = await buildPurchaseOrderDocument(order, "th");
  const labels = getDictionary("th").poTax;
  assert.equal(summaryValue(document, "รวมค่าสินค้าตาม PO"), "100.00");
  assert.equal(summaryValue(document, labels.netAmount), "100.00");
  assert.equal(summaryValue(document, `${labels.taxAmount} 7%`), "7.00");
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "107.00");
  assert(textOf(document).some((item) => item.text === "จำนวนเงิน (ตัวอักษร)  หนึ่งร้อยเจ็ดบาทถ้วน"));
  // A historical issued total is authoritative even when it is not a fresh calculation.
  order.totalAmount = 106.99;
  const historical = await buildPurchaseOrderDocument(order, "th");
  assert.equal(summaryValue(historical, "ยอดรวมตาม PO"), "106.99");
});

test("mixed item overrides retain each price basis and disclose the combined net, VAT and payable total", async () => {
  const order = taxDocumentFixture("EXCLUSIVE");
  const source = order.items[0];
  order.items = [
    { ...source, id: "inclusive", unitPrice: 107, amount: 107, taxMode: "INCLUSIVE" },
    { ...source, id: "inherit", unitPrice: 100, amount: 100, taxMode: null },
    { ...source, id: "none", unitPrice: 25, amount: 25, taxMode: "NONE" },
  ];
  order.itemCount = order.items.length;
  order.totalAmount = 239;
  const document = await buildPurchaseOrderDocument(order, "th");
  const labels = getDictionary("th").poTax;
  const texts = textOf(document).map((item) => item.text);
  assert(texts.some((item) => item.includes(labels.mixed)));
  for (const mode of ["INCLUSIVE", "EXCLUSIVE", "NONE"] as const) {
    assert(texts.includes(`VAT: ${labels[mode]}${mode === "NONE" ? "" : " 7%"}`));
  }
  assert.equal(summaryValue(document, "รวมค่าสินค้าตาม PO"), "232.00");
  assert.equal(summaryValue(document, labels.netAmount), "225.00");
  assert.equal(summaryValue(document, `${labels.taxAmount} 7%`), "14.00");
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "239.00");
});

test("no-VAT means an actual zero tax while unspecified and mixed unknown prices remain unknown", async () => {
  const noVat = await buildPurchaseOrderDocument(taxDocumentFixture("NONE"), "th");
  const labels = getDictionary("th").poTax;
  assert.equal(summaryValue(noVat, labels.netAmount), "100.00");
  assert.equal(summaryValue(noVat, labels.taxAmount), "0.00");
  assert.equal(summaryValue(noVat, "ยอดรวมตาม PO"), "100.00");
  assert(!textOf(noVat).some((item) => item.text.includes("7%")));
  const unknown = taxDocumentFixture("UNSPECIFIED");
  unknown.items.push({ ...unknown.items[0], id: "known", taxMode: "EXCLUSIVE" });
  unknown.itemCount = 2;
  unknown.totalAmount = 207;
  const document = await buildPurchaseOrderDocument(unknown, "th");
  assert.equal(summaryValue(document, "ภาษีมูลค่าเพิ่ม"), "-");
  assert.equal(summaryValue(document, "มูลค่าหลังส่วนลด"), "-");
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "207.00");
  assert(textOf(document).some((item) => item.text === `VAT: ${labels.UNSPECIFIED}`));
});

test("buyer identity uses the issued company snapshot and keeps supplier and amounts intact", async () => {
  const order = documentOrderFixture();
  order.buyerCompany = {
    name: "บริษัทผู้ซื้อสำหรับทดสอบ จำกัด",
    address: "123 ถนนทดสอบ\nกรุงเทพมหานคร 10000",
    taxId: "0105555000123",
    branch: "สำนักงานใหญ่",
    phone: "02-123-4567",
    email: "buyer@example.test",
  };
  const document = await buildPurchaseOrderDocument(order, "th");
  const texts = textOf(document);
  const content = texts.map((item) => item.text).join("").replace(/\s/g, "");
  for (const value of Object.values(order.buyerCompany)) {
    assert(value !== null);
    assert(content.includes(value.replace(/\s/g, "")), `missing buyer field: ${value}`);
  }
  assert(texts.some((item) => item.text === order.supplierName));
  assert(texts.some((item) => item.text === "37.02"));
  const lastBuyerField = texts.find((item) => item.text.includes(order.buyerCompany!.email!))!;
  const reference = texts.find((item) => item.text === "อ้างอิงใบขอซื้อ (PR)")!;
  assert(reference.y > lastBuyerField.y + 10, "references must start below the buyer header");
});

test("maximum-length buyer fields paginate completely without title overlap or clipped content", async () => {
  const order = documentOrderFixture();
  order.buyerCompany = {
    name: "N".repeat(200),
    address: "A".repeat(2000),
    taxId: "0105555000123",
    branch: "B".repeat(200),
    phone: "P".repeat(100),
    email: `${"E".repeat(200)}@example.test`,
  };
  const document = await buildPurchaseOrderDocument(order, "th");
  assert(document.pages.length >= 2 && document.pages.length < 8, "long buyer details must finish in a bounded number of pages");
  const fonts = await loadPurchaseOrderFonts();
  const buyerLines: PurchaseOrderDocumentText[] = [];
  let reachedReferences = false;
  for (const page of document.pages) {
    for (const item of page.elements) {
      if (item.type !== "text") continue;
      if (item.text === "อ้างอิงใบขอซื้อ (PR)") reachedReferences = true;
      if (!reachedReferences && (item.x === 36 || item.x === 48) && ![
        "ผู้ซื้อ / BUYER", "ผู้ซื้อ / BUYER (ต่อ)", "ใบสั่งซื้อ / PURCHASE ORDER", order.poNumber,
      ].includes(item.text)) buyerLines.push(item);
    }
  }
  const buyerText = buyerLines.map((item) => item.text).join("").replace(/\s/g, "");
  for (const value of Object.values(order.buyerCompany)) {
    assert(value !== null);
    assert(buyerText.includes(value), `buyer field was clipped: ${value.slice(0, 30)}`);
  }
  for (const item of buyerLines) {
    const width = measurePurchaseOrderText(item.text, item.size, Boolean(item.bold), fonts);
    assert(item.x + width <= document.width - 36 - 190 + 0.01, `buyer text entered title column: ${item.text}`);
    assert(item.y >= 74 && item.y <= 789, `buyer vertical overflow: ${item.text}`);
  }
  for (const item of textOf(document)) {
    const width = measurePurchaseOrderText(item.text, item.size, Boolean(item.bold), fonts);
    const left = item.x - (item.align === "right" ? width : item.align === "center" ? width / 2 : 0);
    assert(left >= 35 && left + width <= document.width - 26, `horizontal overflow: ${item.text}`);
    assert(item.y >= 0 && item.y <= document.height - 12, `vertical overflow: ${item.text}`);
  }
  assert(textOf(document).some((item) => item.text === "รายการสินค้า / รายละเอียด"));
  assert(textOf(document, document.pages.length - 1).some((item) => item.text === "ยอดรวมตาม PO"));
  const pdf = await PDFDocument.load(await createPurchaseOrderPdf(document));
  assert.equal(pdf.getPageCount(), document.pages.length);
});

test("references and validity notices move to a fresh page when buyer details fill the first page", async () => {
  const order = documentOrderFixture();
  order.buyerCompany = {
    name: "Buyer Company",
    address: Array.from({ length: 45 }, () => "ที่อยู่ทดสอบ").join("\n"),
    taxId: null, branch: null, phone: null, email: null,
  };
  for (const cancelled of [false, true]) {
    if (cancelled) order.purchaseRequest.status = "CANCELLED";
    const document = await buildPurchaseOrderDocument(order, "th");
    assert(!textOf(document, 0).some((item) => item.text === "อ้างอิงใบขอซื้อ (PR)"));
    assert(textOf(document).some((item) => item.text === "อ้างอิงใบขอซื้อ (PR)"));
    for (const page of document.pages) for (const element of page.elements) {
      if (element.type === "rect" && element.y !== 0) assert(element.y + element.height <= 789, `content rectangle exceeds page body: ${element.y}`);
    }
  }
});

test("long PO with mixed tax prices repeats headings, wraps inside margins, and groups closing fields on final page", async () => {
  const order = documentOrderFixture(45, true);
  order.taxMode = "INCLUSIVE";
  order.vatRate = 7;
  order.items = order.items.map((item, index) => ({ ...item, taxMode: index % 3 === 0 ? "EXCLUSIVE" : index % 3 === 1 ? "NONE" : null }));
  order.totalAmount = calculatePurchaseOrderTax(order.items, order.taxMode, order.vatRate).totalAmount;
  const document = await buildPurchaseOrderDocument(order, "th");
  assert(document.pages.length >= 3);
  const fonts = await loadPurchaseOrderFonts();
  for (const [index, page] of document.pages.entries()) {
    const texts = textOf(document, index);
    assert(texts.some((item) => item.text === `หน้า ${index + 1} / ${document.pages.length}`));
    if (texts.some((item) => item.text.includes("DOC-0"))) assert(texts.some((item) => item.text === "รายการสินค้า / รายละเอียด"));
    for (const item of texts) {
      assert(item.y >= 0 && item.y <= document.height - 12, `vertical overflow: ${item.text}`);
      const width = measurePurchaseOrderText(item.text, item.size, Boolean(item.bold), fonts);
      const left = item.x - (item.align === "right" ? width : item.align === "center" ? width / 2 : 0);
      assert(left >= 35 && left + width <= document.width - 26, `horizontal overflow: ${item.text}`);
    }
    assert(page.elements.length > 8);
  }
  for (let number = 1; number <= order.items.length; number++) {
    assert(textOf(document).some((item) => item.text.includes(`DOC-${String(number).padStart(3, "0")}`)));
  }
  const finalText = textOf(document, document.pages.length - 1).map((item) => item.text).join("\n");
  for (const label of ["ยอดรวมตาม PO", "จำนวนเงิน (ตัวอักษร)", "ผู้จัดทำ", "ผู้อนุมัติ", "ผู้รับคำสั่งซื้อ (ผู้จำหน่าย)"]) assert(finalText.includes(label));
  assert.equal(textOf(document).filter((item) => item.text === "ยอดรวมตาม PO").length, 1);
  const pdf = await PDFDocument.load(await createPurchaseOrderPdf(document));
  assert.equal(pdf.getPageCount(), document.pages.length);
  for (const page of pdf.getPages()) assert.deepEqual(page.getSize(), { width: 595.28, height: 841.89 });
});

test("empty optional fields remain blank, missing amounts differ from actual zero", async () => {
  const order = emptyOptionalDocumentFixture();
  const blank = await buildPurchaseOrderDocument(order, "th");
  assert.equal(blank.pages.length, 1);
  assert(!textOf(blank).some((item) => /undefined|null|NaN/.test(item.text)));
  order.totalAmount = 0;
  order.items[0].unitPrice = 0;
  order.items[0].amount = 0;
  const zero = textOf(await buildPurchaseOrderDocument(order, "th")).map((item) => item.text);
  assert(zero.includes("0.00"));
  assert(zero.includes("จำนวนเงิน (ตัวอักษร)  ศูนย์บาทถ้วน"));
  // Runtime defensive handling must never invent a financial zero.
  order.totalAmount = null as unknown as number;
  order.items[0].unitPrice = null as unknown as number;
  order.items[0].amount = null as unknown as number;
  const missing = textOf(await buildPurchaseOrderDocument(order, "th")).map((item) => item.text);
  assert(!missing.includes("0.00"));
  assert(missing.includes("จำนวนเงิน (ตัวอักษร)  -"));
});

test("cancelled and pending documents retain validity notices without changing issued values", async () => {
  const order = documentOrderFixture();
  order.purchaseRequest.status = "CANCELLED";
  order.pendingChangeId = "pending-change";
  const text = textOf(await buildPurchaseOrderDocument(order, "th")).map((item) => item.text).join("\n");
  assert(text.includes("ถูกยกเลิก"));
  assert(text.includes("มีการแก้ไขรออนุมัติ"));
  assert(text.includes("37.02"));
});

test("baht words use exact supplied decimals without introducing rounding", () => {
  for (const [amount, expected] of [
    ["0", "ศูนย์บาทถ้วน"], ["0.01", "ศูนย์บาทหนึ่งสตางค์"],
    ["11.21", "สิบเอ็ดบาทยี่สิบเอ็ดสตางค์"], ["21", "ยี่สิบเอ็ดบาทถ้วน"],
    ["101", "หนึ่งร้อยเอ็ดบาทถ้วน"], ["1000001", "หนึ่งล้านเอ็ดบาทถ้วน"],
  ]) assert.equal(toThaiBahtText(amount), expected);
  for (const invalid of [null, NaN, Infinity, -1, "1.001", "1,000", ""]) assert.equal(toThaiBahtText(invalid), null);
});
