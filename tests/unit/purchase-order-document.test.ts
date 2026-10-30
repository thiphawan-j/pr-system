import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { toThaiBahtText } from "../../src/lib/baht-text";
import { getDictionary } from "../../src/lib/i18n";
import type { PurchaseOrderDocument, PurchaseOrderDocumentText } from "../../src/lib/purchase-order-document";
import { calculatePurchaseOrderPricing, calculatePurchaseOrderTax } from "../../src/lib/purchase-order-tax";
import { buildPurchaseOrderDocument } from "../../src/server/purchase-orders/purchase-order-document";
import { createPurchaseOrderPdf, loadPurchaseOrderFonts, measurePurchaseOrderText } from "../../src/server/purchase-orders/purchase-order-pdf";
import { discountDocumentFixture, documentOrderFixture, emptyOptionalDocumentFixture, screenshotDiscountDocumentFixture, taxDocumentFixture } from "../fixtures/purchase-order-document";

function textOf(document: PurchaseOrderDocument, page?: number) {
  return (page === undefined ? document.pages : [document.pages[page]]).flatMap((item) => item.elements.filter((element): element is PurchaseOrderDocumentText => element.type === "text"));
}

function summaryValue(document: PurchaseOrderDocument, label: string) {
  for (const page of document.pages) {
    const texts = page.elements.filter((element): element is PurchaseOrderDocumentText => element.type === "text");
    const heading = texts.find((item) => item.x > document.width / 2 && item.text === label && item.align !== "right");
    if (!heading) continue;
    const value = texts.find((item) => item.align === "right" && Math.abs(item.y - heading.y) < 0.01);
    assert(value, `missing summary value on the same page as: ${label}`);
    return value.text;
  }
  assert.fail(`missing summary label: ${label}`);
}

function summaryLabels(document: PurchaseOrderDocument) {
  return textOf(document).filter((item) => item.x > document.width / 2 && item.align !== "right").map((item) => item.text);
}

function compactText(document: PurchaseOrderDocument) {
  return textOf(document).map((item) => item.text).join("").replace(/\s/g, "");
}

async function assertDocumentBounds(document: PurchaseOrderDocument) {
  const fonts = await loadPurchaseOrderFonts();
  for (const page of document.pages) {
    for (const element of page.elements) {
      if (element.type === "rect" && element.y !== 0) {
        assert(element.y + element.height <= 789, `rectangle outside A4 content body: ${element.y}`);
      }
      if (element.type !== "text") continue;
      const width = measurePurchaseOrderText(element.text, element.size, Boolean(element.bold), fonts);
      const left = element.x - (element.align === "right" ? width : element.align === "center" ? width / 2 : 0);
      assert(left >= 35 && left + width <= document.width - 26, `horizontal overflow: ${element.text}`);
      assert(element.y >= 0 && element.y <= document.height - 12, `vertical overflow: ${element.text}`);
    }
  }
}

async function assertSummaryColumns(document: PurchaseOrderDocument, headingLabel: string) {
  const fonts = await loadPurchaseOrderFonts();
  for (const page of document.pages) {
    const texts = page.elements.filter((element): element is PurchaseOrderDocumentText => element.type === "text");
    const heading = texts.find((item) => item.text === headingLabel);
    if (!heading) continue;
    const total = texts.find((item) => item.text === "ยอดรวมตาม PO" && item.x > document.width / 2);
    assert(total, "summary and grand total must stay on the same page");
    const card = page.elements.find((element) => element.type === "rect" && element.x > document.width / 2
      && element.y < heading.y && element.y + element.height > total.y);
    assert(card?.type === "rect", "summary heading and total must stay inside their shared card");
    const inCard = texts.filter((item) => item.x >= card.x && item.y >= card.y && item.y <= card.y + card.height);
    for (const value of inCard.filter((item) => item.align === "right")) {
      const valueLeft = value.x - measurePurchaseOrderText(value.text, value.size, Boolean(value.bold), fonts);
      for (const label of inCard.filter((item) => item.align !== "right" && Math.abs(item.y - value.y) < 0.01)) {
        const labelRight = label.x + measurePurchaseOrderText(label.text, label.size, Boolean(label.bold), fonts);
        assert(labelRight + 8 <= valueLeft, `summary label overlaps its amount: ${label.text} / ${value.text}`);
      }
    }
    return;
  }
  assert.fail(`missing summary heading: ${headingLabel}`);
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
  assert.equal(summaryValue(document, "ภาษีมูลค่าเพิ่ม"), "-");
  for (const label of ["ส่วนลดท้ายเอกสาร", "มูลค่าหลังส่วนลด", "ค่าขนส่ง"]) assert(!summaryLabels(document).includes(label));
  assert(!texts.includes(order.purchaseRequest.requesterName));
  for (const placeholder of ["ที่อยู่  -", "เลขประจำตัวผู้เสียภาษี  -    สาขา  -", "โทร  -    อีเมล  -"]) assert(texts.includes(placeholder));
});

test("delivery details print the saved recipient snapshot and phone without substituting the requester", async () => {
  const order = documentOrderFixture(1);
  order.deliveryRecipientId = "recipient-test";
  order.deliveryRecipientName = "คุณผู้รับสินค้าที่บันทึกไว้ คลังสินค้าฝั่งตะวันออก";
  order.deliveryRecipientPhone = "081-234-5678";
  for (const locale of ["th", "en"] as const) {
    const document = await buildPurchaseOrderDocument(order, locale);
    const text = compactText(document);
    assert(text.includes(`ผู้รับสินค้า${order.deliveryRecipientName}`.replace(/\s/g, "")));
    assert(text.includes(`โทร${order.deliveryRecipientPhone}`));
    assert(!text.includes(order.purchaseRequest.requesterName.replace(/\s/g, "")));
    await assertDocumentBounds(document);
  }
});

test("draft previews label every A4 page, omit issued numbers and preserve financial details", async () => {
  for (const locale of ["th", "en"] as const) {
    const order = discountDocumentFixture();
    const preview = await buildPurchaseOrderDocument(order, locale, { draft: true });
    const issued = await buildPurchaseOrderDocument(order, locale);
    const labels = getDictionary(locale).poPreview;
    assert.equal(preview.poNumber, labels.draft);
    assert(!compactText(preview).includes(order.poNumber));
    assert.equal(summaryValue(preview, "ยอดรวมตาม PO"), summaryValue(issued, "ยอดรวมตาม PO"));
    const multiPage = await buildPurchaseOrderDocument(documentOrderFixture(70), locale, { draft: true });
    assert(multiPage.pages.length > 1);
    for (const page of multiPage.pages) {
      assert(page.elements.some((element) => element.type === "text" && element.text === labels.draftNotice));
    }
    await assertDocumentBounds(preview);
    await assertDocumentBounds(multiPage);
  }
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
    assert(compactText(document).includes(`${labels.INCLUSIVE}7%`.replace(/\s/g, "")));
    assert(!textOf(document).some((item) => item.text.startsWith("VAT:")), "uniform VAT belongs above the table, not on every item");
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
  assert(!summaryLabels(document).includes("มูลค่าหลังส่วนลด"));
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "207.00");
  assert(textOf(document).some((item) => item.text === `VAT: ${labels.UNSPECIFIED}`));
});

test("line percentages and fixed order discounts are disclosed before exclusive VAT without rewriting entered prices", async () => {
  for (const locale of ["th", "en"] as const) {
    const order = discountDocumentFixture();
    const document = await buildPurchaseOrderDocument(order, locale);
    const labels = getDictionary(locale);
    assert.equal(summaryValue(document, labels.poDiscount.subtotalAmount), "1,000.00");
    assert.equal(summaryValue(document, labels.poDiscount.itemDiscountAmount), "-100.00");
    assert.equal(summaryValue(document, labels.poDiscount.orderDiscountAmount), "-90.00");
    assert(!summaryLabels(document).includes(labels.poDiscount.discountedSubtotalAmount), "exclusive discounted base must appear only once");
    assert.equal(summaryValue(document, labels.poTax.netAmount), "810.00");
    assert.equal(summaryValue(document, `${labels.poTax.taxAmount} 7%`), "56.70");
    assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "866.70");
    const content = compactText(document);
    assert(content.includes(`${labels.poDiscount.lineTitle}:10%`.replace(/\s/g, "")));
    assert(content.includes("100.00"));
    assert(!content.includes(`${labels.poDiscount.orderDiscountAmount}:90.00`.replace(/\s/g, "")), "allocated whole-PO discounts must not repeat inside item details");
    assert(!content.includes(labels.poDiscount.basisHint.replace(/\s/g, "")), "internal calculation instructions must not become supplier notes");
    assert(textOf(document).some((item) => item.text === "1,000.00"));
    // Render the stored issued total even if a historical snapshot differs by a cent.
    order.totalAmount = 866.69;
    assert.equal(summaryValue(await buildPurchaseOrderDocument(order, locale), "ยอดรวมตาม PO"), "866.69");
  }
});

test("fixed line and percentage order discounts reduce inclusive prices before VAT is split out", async () => {
  const order = discountDocumentFixture();
  order.taxMode = "INCLUSIVE";
  order.discountType = "PERCENT";
  order.discountValue = 10;
  order.items[0] = { ...order.items[0]!, unitPrice: 1070, amount: 1070, discountType: "AMOUNT", discountValue: 107, orderDiscountAmount: 96.3 };
  const document = await buildPurchaseOrderDocument(order, "th");
  const labels = getDictionary("th");
  assert.equal(summaryValue(document, labels.poDiscount.subtotalAmount), "1,070.00");
  assert.equal(summaryValue(document, labels.poDiscount.itemDiscountAmount), "-107.00");
  assert.equal(summaryValue(document, labels.poDiscount.orderDiscountAmount), "-96.30");
  assert.equal(summaryValue(document, labels.poDiscount.discountedSubtotalAmount), "866.70");
  assert.equal(summaryValue(document, labels.poTax.netAmount), "810.00");
  assert.equal(summaryValue(document, `${labels.poTax.taxAmount} 7%`), "56.70");
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "866.70");
  const content = textOf(document).map((item) => item.text).join("").replace(/\s/g, "");
  assert(content.includes("10%"), "the configured whole-PO percentage remains disclosed");
});

test("mixed tax prices retain their bases and combine item and PO discounts, net and VAT once", async () => {
  const order = discountDocumentFixture();
  const source = order.items[0]!;
  order.discountValue = 24.7;
  order.totalAmount = 227.97;
  order.items = [
    { ...source, id: "discount-exclusive", unitPrice: 100, amount: 100, taxMode: "EXCLUSIVE", discountType: "PERCENT", discountValue: 10, orderDiscountAmount: 9 },
    { ...source, id: "discount-inclusive", unitPrice: 107, amount: 107, taxMode: "INCLUSIVE", discountType: "NONE", discountValue: 0, orderDiscountAmount: 10.7 },
    { ...source, id: "discount-no-vat", unitPrice: 50, amount: 50, taxMode: "NONE", discountType: "NONE", discountValue: 0, orderDiscountAmount: 5 },
  ];
  order.itemCount = order.items.length;
  const document = await buildPurchaseOrderDocument(order, "th");
  const labels = getDictionary("th");
  assert.equal(summaryValue(document, labels.poDiscount.subtotalAmount), "257.00");
  assert.equal(summaryValue(document, labels.poDiscount.itemDiscountAmount), "-10.00");
  assert.equal(summaryValue(document, labels.poDiscount.orderDiscountAmount), "-24.70");
  assert.equal(summaryValue(document, labels.poDiscount.discountedSubtotalAmount), "222.30");
  assert.equal(summaryValue(document, labels.poTax.netAmount), "216.00");
  assert.equal(summaryValue(document, `${labels.poTax.taxAmount} 7%`), "11.97");
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "227.97");
  const content = textOf(document).map((item) => item.text).join("").replace(/\s/g, "");
  for (const share of ["9.00", "10.70", "5.00"]) {
    assert(!content.includes(`${labels.poDiscount.orderDiscountAmount}:${share}`.replace(/\s/g, "")), "allocated PO shares must not clutter the item descriptions");
  }
});

test("a full percentage discount prints actual zero payable and no extra VAT, while legacy defaults stay visually unchanged", async () => {
  const order = discountDocumentFixture();
  order.discountType = "PERCENT";
  order.discountValue = 100;
  order.items[0] = { ...order.items[0]!, unitPrice: 100, amount: 100, discountType: "NONE", discountValue: 0, orderDiscountAmount: 100 };
  order.totalAmount = 0;
  const document = await buildPurchaseOrderDocument(order, "th");
  const labels = getDictionary("th");
  assert(!summaryLabels(document).includes(labels.poDiscount.itemDiscountAmount), "an unused item-discount row is omitted");
  assert.equal(summaryValue(document, labels.poDiscount.orderDiscountAmount), "-100.00");
  assert.equal(summaryValue(document, labels.poTax.netAmount), "0.00");
  assert.equal(summaryValue(document, `${labels.poTax.taxAmount} 7%`), "0.00");
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "0.00");
  assert(textOf(document).some((item) => item.text === "จำนวนเงิน (ตัวอักษร)  ศูนย์บาทถ้วน"));
  const legacy = documentOrderFixture();
  const baseline = await buildPurchaseOrderDocument(legacy, "th");
  const explicit = { ...legacy, discountType: "NONE" as const, discountValue: 0, items: legacy.items.map((item) => ({ ...item, discountType: "NONE" as const, discountValue: 0, orderDiscountAmount: 0 })) };
  assert.deepEqual(await buildPurchaseOrderDocument(explicit, "th"), baseline);
});

test("the screenshot PO separates item and PO discounts from its exact VAT and stored payable amount", async () => {
  const order = screenshotDiscountDocumentFixture();
  const document = await buildPurchaseOrderDocument(order, "th");
  const labels = getDictionary("th");
  assert.equal(document.pages.length, 1);
  assert.equal(summaryValue(document, labels.poDiscount.subtotalAmount), "1,260.00");
  assert.equal(summaryValue(document, labels.poDiscount.itemDiscountAmount), "-20.00");
  assert.equal(summaryValue(document, labels.poDiscount.orderDiscountAmount), "-100.00");
  assert.equal(summaryValue(document, labels.poTax.netAmount), "1,140.00");
  assert.equal(summaryValue(document, `${labels.poTax.taxAmount} 7%`), "79.80");
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "1,219.80");
  assert(!summaryLabels(document).includes(labels.poDiscount.discountedSubtotalAmount));
  assert(!summaryLabels(document).includes("ค่าขนส่ง"));
  const content = compactText(document);
  assert(content.includes(`${labels.poDiscount.lineTitle}:20.00บาท`.replace(/\s/g, "")));
  assert(!content.includes("20.00บาท=20.00"));
  assert(!content.includes(`${labels.poDiscount.orderDiscountAmount}:100.00`.replace(/\s/g, "")));
  assert(!content.includes(labels.poDiscount.basisHint.replace(/\s/g, "")));
  assert(!textOf(document).some((item) => item.text.startsWith("VAT:")));
  assert(textOf(document).some((item) => item.text.includes("105.00")));
  await assertDocumentBounds(document);
  await assertSummaryColumns(document, "สรุปยอดสั่งซื้อ");
  const pdf = await PDFDocument.load(await createPurchaseOrderPdf(document));
  assert.equal(pdf.getPageCount(), 1);
});

test("inclusive screenshot prices keep the different discounted gross and pre-VAT bases visible", async () => {
  const order = screenshotDiscountDocumentFixture();
  order.taxMode = "INCLUSIVE";
  order.totalAmount = 1140;
  const document = await buildPurchaseOrderDocument(order, "th");
  const labels = getDictionary("th");
  assert.equal(summaryValue(document, labels.poDiscount.discountedSubtotalAmount), "1,140.00");
  assert.equal(summaryValue(document, labels.poTax.netAmount), "1,065.42");
  assert.equal(summaryValue(document, `${labels.poTax.taxAmount} 7%`), "74.58");
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "1,140.00");
  assert.equal(summaryLabels(document).filter((label) => label === labels.poDiscount.discountedSubtotalAmount).length, 1);
  await assertSummaryColumns(document, "สรุปยอดสั่งซื้อ");
});

test("eight lines of real notes remain clear of compact totals, baht words and signatures", async () => {
  for (const hasDiscount of [false, true]) {
    const order = hasDiscount ? screenshotDiscountDocumentFixture() : taxDocumentFixture("UNSPECIFIED");
    if (hasDiscount) {
      // Inclusive bases and a percentage caption leave a realistic summary
      // beside which all eight note lines fit; the short unknown summary must
      // flow these same notes before its closing block instead.
      order.taxMode = "INCLUSIVE";
      order.discountType = "PERCENT";
      order.discountValue = 8;
      const pricing = calculatePurchaseOrderPricing(order.items, order.taxMode, order.vatRate, order);
      order.totalAmount = pricing.totalAmount;
      order.items[0]!.orderDiscountAmount = pricing.lines[0]!.orderDiscountAmount;
    }
    const noteLines = Array.from({ length: 8 }, (_, index) => `NOTE-LINE-${index + 1} เงื่อนไขจัดส่ง กิ่กี้กุ๊ก`);
    order.note = noteLines.join("\n");
    const document = await buildPurchaseOrderDocument(order, "th");
    const fonts = await loadPurchaseOrderFonts();
    const allTexts = textOf(document);
    for (const line of noteLines) assert(allTexts.some((item) => item.text === line), `a real note was lost: ${line}`);
    const lastPageTexts = textOf(document, document.pages.length - 1);
    const amountWords = lastPageTexts.find((item) => item.text.startsWith("จำนวนเงิน (ตัวอักษร)"));
    const total = lastPageTexts.find((item) => item.text === "ยอดรวมตาม PO");
    assert(amountWords && total);
    assert(amountWords.y > total.y + total.size);
    const notesOnLastPage = lastPageTexts.filter((item) => item.text.startsWith("NOTE-LINE-"));
    for (const note of notesOnLastPage) {
      assert(amountWords.y > note.y + note.size + 8, "notes must finish before baht words");
      const width = measurePurchaseOrderText(note.text, note.size, Boolean(note.bold), fonts);
      assert(note.x + width < document.width / 2 + 8, "notes must retain a gutter before the totals column");
    }
    if (hasDiscount) {
      const heading = lastPageTexts.find((item) => item.text === "สรุปยอดสั่งซื้อ")!;
      assert(notesOnLastPage.length === 8 && notesOnLastPage.some((note) => note.y > heading.y), "exercise notes beside the summary card");
    }
    for (const label of ["ผู้จัดทำ", "ผู้อนุมัติ", "ผู้รับคำสั่งซื้อ (ผู้จำหน่าย)"]) {
      const signature = lastPageTexts.find((item) => item.text === label);
      assert(signature && signature.y > amountWords.y, "signature block must follow the amount words");
    }
    await assertDocumentBounds(document);
    await assertSummaryColumns(document, "สรุปยอดสั่งซื้อ");
  }
});

test("maximum supported monetary values and signed deductions leave a readable gap from English summary labels", async () => {
  for (const discounted of [false, true]) {
    const order = taxDocumentFixture(discounted ? "UNSPECIFIED" : "NONE");
    order.note = null;
    order.items[0] = { ...order.items[0]!, quantity: 1, unitPrice: 9999999999.99, amount: 9999999999.99 };
    order.totalAmount = discounted ? 0.01 : 9999999999.99;
    if (discounted) {
      order.discountType = "AMOUNT";
      order.discountValue = 9999999999.98;
      order.items[0].orderDiscountAmount = order.discountValue;
    }
    const document = await buildPurchaseOrderDocument(order, "en");
    const labels = getDictionary("en");
    assert.equal(summaryValue(document, "ยอดรวมตาม PO"), discounted ? "0.01" : "9,999,999,999.99");
    if (discounted) {
      assert.equal(summaryValue(document, labels.poDiscount.orderDiscountAmount), "-9,999,999,999.98");
      assert.equal(summaryValue(document, labels.poDiscount.discountedSubtotalAmount), "0.01");
      assert.equal(summaryValue(document, labels.poTax.netAmount), "-");
      assert.equal(summaryValue(document, labels.poTax.taxAmount), "-");
    }
    await assertSummaryColumns(document, "Order summary");
    await assertDocumentBounds(document);
    const pdf = await PDFDocument.load(await createPurchaseOrderPdf(document));
    assert.equal(pdf.getPageCount(), document.pages.length);
  }
});

test("page-aware summary lookup cannot confuse a prior-page amount with the same baseline", () => {
  const document: PurchaseOrderDocument = {
    width: 595.28, height: 841.89, poNumber: "PO-PAGE-LOOKUP", pages: [
      { elements: [{ type: "text", text: "999.99", x: 550, y: 500, size: 9, align: "right" }] },
      { elements: [
        { type: "text", text: "ยอดรวมตาม PO", x: 330, y: 500, size: 10, bold: true },
        { type: "text", text: "1,219.80", x: 550, y: 500, size: 11, align: "right", bold: true },
      ] },
    ],
  };
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "1,219.80");
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

test("long discounted PO keeps every item discount, totals, baht words and signatures within A4 pages", async () => {
  const order = documentOrderFixture(45, true);
  order.taxMode = "INCLUSIVE";
  order.vatRate = 7;
  order.discountType = "PERCENT";
  order.discountValue = 3.25;
  order.items = order.items.map((item, index) => ({
    ...item, taxMode: index % 3 === 0 ? "EXCLUSIVE" : index % 3 === 1 ? "NONE" : null,
    discountType: index % 2 === 0 ? "PERCENT" : "AMOUNT", discountValue: index % 2 === 0 ? 5 : 0.25,
  }));
  const pricing = calculatePurchaseOrderPricing(order.items, order.taxMode, order.vatRate, order);
  order.items = order.items.map((item, index) => ({ ...item, orderDiscountAmount: pricing.lines[index]!.orderDiscountAmount }));
  order.totalAmount = pricing.totalAmount;
  const document = await buildPurchaseOrderDocument(order, "th");
  const fonts = await loadPurchaseOrderFonts();
  const discountLabels = getDictionary("th").poDiscount;
  assert(document.pages.length >= 3);
  for (const [index, page] of document.pages.entries()) {
    const texts = textOf(document, index);
    assert(texts.some((item) => item.text === `หน้า ${index + 1} / ${document.pages.length}`));
    if (texts.some((item) => item.text.includes("DOC-0"))) assert(texts.some((item) => item.text === "รายการสินค้า / รายละเอียด"));
    for (const item of texts) {
      const width = measurePurchaseOrderText(item.text, item.size, Boolean(item.bold), fonts);
      const left = item.x - (item.align === "right" ? width : item.align === "center" ? width / 2 : 0);
      assert(left >= 35 && left + width <= document.width - 26, `horizontal overflow: ${item.text}`);
      assert(item.y >= 0 && item.y <= document.height - 12, `vertical overflow: ${item.text}`);
    }
    assert(page.elements.length > 8);
  }
  for (let number = 1; number <= order.items.length; number++) assert(textOf(document).some((item) => item.text.includes(`DOC-${String(number).padStart(3, "0")}`)));
  assert.equal(textOf(document).filter((item) => item.text === discountLabels.orderDiscountAmount).length, 1);
  const finalText = textOf(document, document.pages.length - 1).map((item) => item.text).join("\n");
  for (const value of ["ยอดรวมตาม PO", "จำนวนเงิน (ตัวอักษร)", "ผู้จัดทำ", "ผู้อนุมัติ", "ผู้รับคำสั่งซื้อ (ผู้จำหน่าย)"]) assert(finalText.includes(value));
  const pdf = await PDFDocument.load(await createPurchaseOrderPdf(document));
  assert.equal(pdf.getPageCount(), document.pages.length);
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

test("combined POs print every source PR and the correct origin beside each item", async () => {
  const order = documentOrderFixture();
  const second = { ...order.purchaseRequest, id: "pr-second", prNumber: "PR-SECOND-2026" };
  order.purchaseRequests = [order.purchaseRequest, second];
  order.items = order.items.map((item, index) => ({ ...item, sourcePurchaseRequestId: index === 0 ? order.purchaseRequest.id : second.id }));
  const document = await buildPurchaseOrderDocument(order, "th");
  const content = textOf(document).map((item) => item.text).join(" ");
  assert(content.includes(order.purchaseRequest.prNumber));
  assert(content.includes(second.prNumber));
  const itemText = textOf(document).filter((item) => item.x === 72).map((item) => item.text).join(" ");
  assert(itemText.includes(`${getDictionary("th").poCombined.source}: ${order.purchaseRequest.prNumber}`));
  assert(itemText.includes(`${getDictionary("th").poCombined.source}: ${second.prNumber}`));
  assert.equal(summaryValue(document, "ยอดรวมตาม PO"), "37.02");
});

test("many source PR references wrap across pages within A4 bounds", async () => {
  const order = documentOrderFixture(1);
  order.purchaseRequests = Array.from({ length: 100 }, (_, index) => ({ ...order.purchaseRequest, id: `origin-${index}`, prNumber: `PR-202610-${String(index).padStart(4, "0")}` }));
  const document = await buildPurchaseOrderDocument(order, "th");
  const elements = textOf(document);
  const content = elements.map((item) => item.text).join(" ");
  for (const request of order.purchaseRequests) assert(content.includes(request.prNumber));
  const fonts = await loadPurchaseOrderFonts();
  for (const item of elements) {
    assert(item.y >= 0 && item.y <= document.height, `text outside page: ${item.text}`);
    const width = measurePurchaseOrderText(item.text, item.size, Boolean(item.bold), fonts);
    const left = item.align === "right" ? item.x - width : item.align === "center" ? item.x - width / 2 : item.x;
    assert(left >= 0 && left + width <= document.width + 0.01, `text outside width: ${item.text}`);
  }
});

test("independently cancelled PO shows its own validity notice while source PR remains approved", async () => {
  const order = documentOrderFixture();
  order.status = "CANCELLED";
  order.purchaseRequest.status = "APPROVED";
  order.cancellationReason = "Internal cancellation reason stays out of supplier document";
  for (const locale of ["th", "en"] as const) {
    const content = textOf(await buildPurchaseOrderDocument(order, locale)).map((item) => item.text).join(" ");
    assert(content.includes(getDictionary(locale).poCombined.cancelledTitle));
    assert(!content.includes(order.cancellationReason));
    assert(content.includes("37.02"));
  }
});

test("a PO cancelled with its source PR retains the source cancellation notice", async () => {
  const order = documentOrderFixture();
  order.status = "CANCELLED";
  order.purchaseRequest.status = "CANCELLED";
  const text = textOf(await buildPurchaseOrderDocument(order, "th")).map((item) => item.text).join(" ");
  assert(text.includes(getDictionary("th").purchaseOrders.cancelledTitle));
  assert(!text.includes(getDictionary("th").poCombined.cancelledDescription));
});

test("baht words use exact supplied decimals without introducing rounding", () => {
  for (const [amount, expected] of [
    ["0", "ศูนย์บาทถ้วน"], ["0.01", "ศูนย์บาทหนึ่งสตางค์"],
    ["11.21", "สิบเอ็ดบาทยี่สิบเอ็ดสตางค์"], ["21", "ยี่สิบเอ็ดบาทถ้วน"],
    ["101", "หนึ่งร้อยเอ็ดบาทถ้วน"], ["1000001", "หนึ่งล้านเอ็ดบาทถ้วน"],
  ]) assert.equal(toThaiBahtText(amount), expected);
  for (const invalid of [null, NaN, Infinity, -1, "1.001", "1,000", ""]) assert.equal(toThaiBahtText(invalid), null);
});
