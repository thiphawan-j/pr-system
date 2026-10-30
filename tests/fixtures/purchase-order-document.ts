import type { PurchaseOrderDetail } from "../../src/lib/types";

/** Synthetic issued-PO snapshots for document verification, never database seeds. */
export function documentOrderFixture(count = 2, longDescriptions = false): PurchaseOrderDetail {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `item-${index + 1}`,
    purchaseRequestItemId: `pr-item-${index + 1}`,
    itemName: `DOC-${String(index + 1).padStart(3, "0")} อุปกรณ์ทดสอบภาษาไทย ผู้สั่งซื้อ น้ำหนึ่ง ญี่ปุ่น${longDescriptions ? " สำหรับงานซ่อมบำรุงระบบควบคุมและตรวจสอบคุณภาพสินค้า รุ่นที่มีรายละเอียดและชื่อสินค้ายาวเป็นพิเศษ" : ""}`,
    description: longDescriptions ? `รายละเอียดบรรจุภัณฑ์ทดสอบ 12 ชิ้น/กล่อง รหัส TEST-${index + 1} ${"รายละเอียดสินค้าสำหรับตรวจการตัดบรรทัดและวรรณยุกต์ กิ่กี้กุ๊ก ".repeat(3)}` : "12 ชิ้น/กล่อง",
    quantity: index + 1,
    unit: "กล่อง",
    unitPrice: 12.34,
    amount: Math.round((index + 1) * 1234) / 100,
    receivedQuantity: 0,
    closedQuantity: 0,
  }));
  return {
    id: "document-test",
    poNumber: `PO-DOC-TEST-${count}`,
    issuedAt: "2026-10-22T10:30:00+07:00",
    totalAmount: items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100,
    itemCount: count,
    version: 0,
    revision: 0,
    canEdit: true,
    canReview: false,
    canWithdraw: false,
    pendingChangeId: null,
    changes: [],
    buyerCompany: null,
    supplierId: "supplier-test",
    supplierCode: "SUP-DOC-TEST",
    supplierName: "ผู้จำหน่ายสำหรับทดสอบเอกสาร",
    supplierTaxId: "0100000000000",
    supplierContactPerson: "คุณผู้ติดต่อทดสอบ",
    supplierContacts: [{ channel: "PHONE", value: "02-000-0000" }, { channel: "LINE", value: "test-contact" }],
    supplierAddress: "ที่อยู่สำหรับทดสอบการจัดวางเอกสารภาษาไทย\nแขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10000",
    supplierContact: null,
    deliveryAddress: "คลังสินค้าทดสอบ ชั้น 1\nกรุงเทพมหานคร 10000",
    paymentTerms: "เงื่อนไขตามที่บันทึกไว้ใน PO ทดสอบ",
    expectedDeliveryDate: "2026-10-29",
    note: "หมายเหตุ PO ที่อนุญาตให้ผู้ขายเห็น สำหรับตรวจรูปแบบเอกสาร",
    createdBy: { id: "author-test", name: "ผู้จัดทำทดสอบ" },
    purchaseRequest: { id: "pr-test", prNumber: "PR-DOC-TEST", department: "Operations", requesterName: "ผู้ขอซื้อทดสอบ", status: "ORDERED", receiptVersion: 0, canCloseOrder: false },
    items,
  };
}

export function emptyOptionalDocumentFixture(): PurchaseOrderDetail {
  const order = documentOrderFixture(1);
  return {
    ...order,
    poNumber: "PO-DOC-EMPTY",
    supplierId: null,
    supplierCode: null,
    supplierTaxId: null,
    supplierContactPerson: null,
    supplierContacts: [],
    supplierAddress: null,
    supplierContact: null,
    deliveryAddress: null,
    paymentTerms: null,
    expectedDeliveryDate: null,
    note: null,
    items: order.items.map((item) => ({ ...item, unit: null, description: null })),
  };
}

/** Explicit tax metadata for print/PDF checks; the ordinary fixture stays legacy/unknown. */
export function taxDocumentFixture(mode: "INCLUSIVE" | "EXCLUSIVE" | "NONE" | "UNSPECIFIED"): PurchaseOrderDetail {
  const order = documentOrderFixture(1);
  return {
    ...order,
    taxMode: mode,
    vatRate: 7,
    totalAmount: mode === "EXCLUSIVE" ? 107 : 100,
    items: order.items.map((item) => ({
      ...item,
      quantity: 1,
      unitPrice: 100,
      amount: 100,
      taxMode: null,
    })),
  };
}

/** Entered prices stay visible; discount/VAT amounts are independently asserted by document tests. */
export function discountDocumentFixture(): PurchaseOrderDetail {
  const order = taxDocumentFixture("EXCLUSIVE");
  return {
    ...order,
    discountType: "AMOUNT",
    discountValue: 90,
    totalAmount: 866.7,
    items: order.items.map((item) => ({
      ...item, quantity: 1, unitPrice: 1000, amount: 1000,
      discountType: "PERCENT", discountValue: 10, orderDiscountAmount: 90,
    })),
  };
}

/** Matches the user's PO screenshot: 12 bottles at 105, then 20 + 100 THB discounts. */
export function screenshotDiscountDocumentFixture(): PurchaseOrderDetail {
  const order = discountDocumentFixture();
  return {
    ...order,
    poNumber: "PO-DISPLAY-1260",
    note: null,
    discountType: "AMOUNT",
    discountValue: 100,
    totalAmount: 1219.8,
    items: [{
      ...order.items[0]!, itemName: "น้ำยาทำความสะอาดพื้น", description: "ข้อมูลตัวอย่างสำหรับทดสอบขั้นตอนอนุมัติในระบบ local",
      quantity: 12, unit: "ขวด", unitPrice: 105, amount: 1260,
      discountType: "AMOUNT", discountValue: 20, orderDiscountAmount: 100,
    }],
  };
}
