CREATE TYPE "ReceiptAction" AS ENUM ('RECEIVED', 'CLOSE_REMAINDER');

ALTER TABLE "PurchaseRequest"
  ADD COLUMN "receiptVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PurchaseRequestItem"
  ADD COLUMN "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "closedQuantity" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PurchaseRequestReceipt" (
  "id" TEXT NOT NULL,
  "purchaseRequestId" TEXT NOT NULL,
  "recordedById" TEXT NOT NULL,
  "action" "ReceiptAction" NOT NULL,
  "receivedDate" TIMESTAMP(3) NOT NULL,
  "comment" TEXT,
  "overReceiptReason" TEXT,
  "receiptNumber" TEXT,
  "taxInvoiceNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PurchaseRequestReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseRequestReceiptItem" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,

  CONSTRAINT "PurchaseRequestReceiptItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseRequestReceipt_purchaseRequestId_createdAt_idx"
  ON "PurchaseRequestReceipt"("purchaseRequestId", "createdAt");
CREATE UNIQUE INDEX "PurchaseRequestReceiptItem_receiptId_itemId_key"
  ON "PurchaseRequestReceiptItem"("receiptId", "itemId");
CREATE INDEX "PurchaseRequestReceiptItem_itemId_idx"
  ON "PurchaseRequestReceiptItem"("itemId");

ALTER TABLE "PurchaseRequestReceipt"
  ADD CONSTRAINT "PurchaseRequestReceipt_purchaseRequestId_fkey"
    FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseRequestReceipt_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseRequestReceiptItem"
  ADD CONSTRAINT "PurchaseRequestReceiptItem_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "PurchaseRequestReceipt"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseRequestReceiptItem_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "PurchaseRequestItem"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Legacy receiving confirmed the entire PR at once. Preserve those receipts,
-- including completed PRs, without inventing document references or receipt dates.
-- The original receiving approval records the actor when available; otherwise the
-- requester is used as the legacy owner and the import is explicitly annotated.
INSERT INTO "PurchaseRequestReceipt" (
  "id", "purchaseRequestId", "recordedById", "action", "receivedDate",
  "comment", "receiptNumber", "taxInvoiceNumber", "createdAt"
)
SELECT
  'legacy_receipt_' || request."id",
  request."id",
  COALESCE(receiving_approval."approverId", request."requesterId"),
  'RECEIVED'::"ReceiptAction",
  request."receivedAt",
  CONCAT_WS(E'\n',
    CASE WHEN receiving_approval."approverId" IS NULL
      THEN 'นำเข้าจากข้อมูลการรับสินค้าเดิม (ไม่พบผู้รับเดิม ใช้ผู้ขอเป็นผู้ดูแลข้อมูลนำเข้า)'
      ELSE 'นำเข้าจากข้อมูลการรับสินค้าเดิม'
    END,
    NULLIF(receiving_approval."comment", ''),
    NULLIF(request."receiptReferenceNote", '')
  ),
  request."receiptNumber",
  request."taxInvoiceNumber",
  COALESCE(receiving_approval."createdAt", request."receivedAt")
FROM "PurchaseRequest" AS request
LEFT JOIN LATERAL (
  SELECT approval."approverId", approval."comment", approval."createdAt"
  FROM "Approval" AS approval
  WHERE approval."purchaseRequestId" = request."id"
    AND approval."action" = 'COMMENTED'
    AND approval."stepLabel" = 'ยืนยันรับของ'
  ORDER BY approval."createdAt" DESC, approval."id" DESC
  LIMIT 1
) AS receiving_approval ON TRUE
WHERE request."receivedAt" IS NOT NULL;

INSERT INTO "PurchaseRequestReceiptItem" ("id", "receiptId", "itemId", "quantity")
SELECT
  'legacy_receipt_item_' || item."id",
  'legacy_receipt_' || item."purchaseRequestId",
  item."id",
  item."quantity"
FROM "PurchaseRequestItem" AS item
JOIN "PurchaseRequest" AS request ON request."id" = item."purchaseRequestId"
WHERE request."receivedAt" IS NOT NULL;

UPDATE "PurchaseRequestItem" AS item
SET "receivedQuantity" = item."quantity"
FROM "PurchaseRequest" AS request
WHERE request."id" = item."purchaseRequestId"
  AND request."receivedAt" IS NOT NULL;

UPDATE "PurchaseRequest"
SET "receiptVersion" = 1
WHERE "receivedAt" IS NOT NULL;

ALTER TABLE "PurchaseRequest"
  ADD CONSTRAINT "PurchaseRequest_receiptVersion_nonnegative"
    CHECK ("receiptVersion" >= 0);

ALTER TABLE "PurchaseRequestItem"
  ADD CONSTRAINT "PurchaseRequestItem_quantity_positive"
    CHECK ("quantity" > 0),
  ADD CONSTRAINT "PurchaseRequestItem_receivedQuantity_nonnegative"
    CHECK ("receivedQuantity" >= 0),
  ADD CONSTRAINT "PurchaseRequestItem_closedQuantity_nonnegative"
    CHECK ("closedQuantity" >= 0),
  -- Overreceipts are allowed when nothing has been closed. A closed remainder
  -- remains unavailable to later receiving events.
  ADD CONSTRAINT "PurchaseRequestItem_receipt_totals_valid"
    CHECK ("closedQuantity" + LEAST("receivedQuantity", "quantity") <= "quantity");

ALTER TABLE "PurchaseRequestReceiptItem"
  ADD CONSTRAINT "PurchaseRequestReceiptItem_quantity_positive"
    CHECK ("quantity" > 0);
