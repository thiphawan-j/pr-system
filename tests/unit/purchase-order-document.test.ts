import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { toThaiBahtText } from "../../src/lib/baht-text";
import type { PurchaseOrderDocument, PurchaseOrderDocumentText } from "../../src/lib/purchase-order-document";
import { buildPurchaseOrderDocument } from "../../src/server/purchase-orders/purchase-order-document";
import { createPurchaseOrderPdf, loadPurchaseOrderFonts, measurePurchaseOrderText } from "../../src/server/purchase-orders/purchase-order-pdf";
import { documentOrderFixture, emptyOptionalDocumentFixture } from "../fixtures/purchase-order-document";

function textOf(document: PurchaseOrderDocument, page?: number) {
  return (page === undefined ? document.pages : [document.pages[page]]).flatMap((item) => item.elements.filter((element): element is PurchaseOrderDocumentText => element.type === "text"));
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
  assert(texts.includes("ราคาต่อหน่วย: ไม่ระบุการรวม VAT  |  จำนวนเงิน: บาท"));
  assert(!texts.some((value) => /7%|เครดิต 30|ตัวอย่างเอกสาร|สถานะ PR ปัจจุบัน|10,700/.test(value)));
  for (const label of ["ส่วนลดท้ายเอกสาร", "มูลค่าหลังส่วนลด", "ค่าขนส่ง", "ภาษีมูลค่าเพิ่ม"]) {
    const element = textOf(document).find((item) => item.text === label)!;
    assert(textOf(document).some((item) => item.y === element.y && item.text === "-"));
  }
  assert(!texts.includes(order.purchaseRequest.requesterName));
});

test("long PO repeats table headings, wraps inside margins, and groups closing fields on final page", async () => {
  const order = documentOrderFixture(45, true);
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
