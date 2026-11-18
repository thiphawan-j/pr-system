import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestTrackingSummary } from "../../src/components/purchase-requests/request-tracking-summary";
import type { PurchaseRequestDetail, PurchaseRequestReceivingItem, PurchaseOrderSummary, PurchaseRequestReceipt } from "../../src/lib/types";

const timestamp = "2026-11-18T02:00:00.000Z";
const base: PurchaseRequestDetail = {
  id: "pr-test", prNumber: "PR-TEST-001", requestDate: "2026-11-18", department: "Operations", reason: "Test only", urgency: "NORMAL", status: "ORDERED", totalAmount: 100,
  requester: { id: "requester", employeeCode: "TEST", name: "Test requester", email: "test@example.test", role: "EMPLOYEE", department: "Operations" },
  receiptVersion: 0, canCloseOrder: false, hasPartialReceipt: false, receipts: [], purchaseOrders: [], hasPendingPurchaseOrderChange: false,
  createdAt: timestamp, updatedAt: timestamp, orderableItemCount: 0, items: [], receivingItems: [], attachments: [], approvals: [],
};
const item = (id: string, unit: string, remainingQuantity: number, closedQuantity = 0): PurchaseRequestReceivingItem => ({
  id, itemName: id, quantity: 100, unit, amount: 100, receivedQuantity: 2, closedQuantity, remainingQuantity, overReceivedQuantity: 0,
});
const order = (id: string, status: PurchaseOrderSummary["status"] = "ISSUED", canView = true): PurchaseOrderSummary => ({
  id, poNumber: `PO-${id}`, supplierName: "Test supplier", issuedAt: timestamp, totalAmount: 100, itemCount: 1, status, canView,
});
const receipt = (id: string, action: PurchaseRequestReceipt["action"]): PurchaseRequestReceipt => ({
  id, action, receivedDate: timestamp, comment: null, overReceiptReason: null, receiptNumber: null, taxInvoiceNumber: null,
  createdAt: timestamp, recordedBy: { id: "receiver", name: "Test receiver" }, items: [],
});
function render(overrides: Partial<PurchaseRequestDetail> = {}, locale: "th" | "en" = "en") {
  return renderToStaticMarkup(RequestTrackingSummary({ request: { ...base, ...overrides }, locale }));
}
function next(markup: string) {
  return markup.match(/data-testid="tracking-next-step"[^>]*>(.*?)<\/p>/)?.[1] ?? "";
}
function text(markup: string) { return markup.replace(/<[^>]*>/g, "").replaceAll("<!-- -->", ""); }

test("terminal and returned next steps never imply normal ongoing order or receipt work", () => {
  const cases = {
    CANCELLED: /Request cancelled;.*history, not pending work/,
    REJECTED: /Request rejected; see the history/,
    NEED_REVISION: /Requester revises and resubmits/,
    NEED_CLARIFICATION: /Requester clarifies and resubmits/,
    COMPLETED: /PR completed;/,
  } as const;
  for (const [status, expected] of Object.entries(cases)) {
    const output = render({ status: status as PurchaseRequestDetail["status"], orderedAt: timestamp, receivedAt: timestamp, hasPendingPurchaseOrderChange: true });
    assert.match(next(output), expected);
    assert.doesNotMatch(next(output), /Awaiting PO|Follow up on|Purchasing prepares|awaiting purchasing reference/);
  }
});

test("partial and multiple POs preserve counts, cancellation markers and per-order view permission", () => {
  const output = render({ purchaseOrders: [order("first"), order("restricted", "ISSUED", false), order("cancelled", "CANCELLED")], orderableItemCount: 2 });
  assert.match(text(output), /Non-cancelled POs: 2 · Cancelled: 1/);
  assert.match(text(output), /Lines eligible for PO creation in the current state: 2/);
  assert.match(output, /href="\/purchase-orders\/first"/);
  assert.doesNotMatch(output, /href="\/purchase-orders\/restricted"/);
  assert.match(output, /<span>PO-restricted<\/span>/);
  assert.match(text(output), /PO-cancelled \(cancelled\)/);
});

test("partial receipts count lines instead of summing quantities from mixed units", () => {
  const output = render({ hasPartialReceipt: true, receivingItems: [item("steel", "kg", 11), item("bolts", "pieces", 17), item("closed", "litres", 0, 9)], receipts: [receipt("one", "RECEIVED"), receipt("two", "CLOSE_REMAINDER")] });
  assert.match(text(output), /Outstanding lines: 2 · Lines with closed remainder: 1/);
  assert.doesNotMatch(text(output), /28|37|kg|litres|pieces/);
  assert.match(next(output), /Follow up on unplaced items and outstanding receipts/);
  assert.doesNotMatch(next(output), /PR completed|reference confirmation/);
  assert.match(text(output), /Receipt \/ close-remainder records: 2/);
});

test("settled quantities awaiting references are not described as completed", () => {
  const output = render({ receivedAt: timestamp, receivingItems: [item("closed", "kg", 0, 8)] });
  assert.match(next(output), /Receipt\/quantity settlement recorded; awaiting purchasing reference confirmation/);
  assert.match(text(output), /Outstanding lines: 0 · Lines with closed remainder: 1/);
  assert.match(text(output), /Completed: Not recorded/);
  assert.doesNotMatch(next(output), /PR completed/);
});

test("pending PO change takes precedence over receiving follow-up", () => {
  assert.match(next(render({ receivedAt: timestamp, hasPendingPurchaseOrderChange: true })), /Awaiting PO change review before receiving/);
});

test("legacy orders and unknown dates are explicitly labelled, with stable history anchors", () => {
  const output = render({ orderedAt: timestamp });
  assert.match(text(output), /Legacy order recorded without a system PO/);
  assert.match(text(output), /Recorded approval date: Not recorded/);
  for (const target of ["pr-details", "pr-approval-history", "pr-receipt-history"]) assert.match(output, new RegExp(`href="#${target}"`));
  assert.doesNotMatch(output, /<button|<form/);
});

test("Thai terminal state explicitly labels cancelled details as history", () => {
  assert.match(next(render({ status: "CANCELLED" }, "th")), /เป็นประวัติ ไม่ใช่งานที่ต้องทำต่อ/);
});

test("unknown orderable count remains unknown instead of claiming zero", () => {
  assert.match(text(render({ orderableItemCount: undefined })), /Lines eligible for PO creation in the current state: Not recorded/);
});
