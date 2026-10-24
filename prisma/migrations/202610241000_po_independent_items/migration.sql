-- PO lines track receiving balances separately from their related PR lines.
ALTER TABLE "PurchaseOrderItem"
  ALTER COLUMN "purchaseRequestItemId" DROP NOT NULL,
  ADD COLUMN "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "closedQuantity" INTEGER NOT NULL DEFAULT 0;

-- Preserve all historical receipts and closed balances when moving the live
-- receiving ledger from PR lines to their corresponding PO lines.
UPDATE "PurchaseOrderItem" AS po
SET "receivedQuantity" = pr."receivedQuantity",
    "closedQuantity" = pr."closedQuantity"
FROM "PurchaseRequestItem" AS pr
WHERE po."purchaseRequestItemId" = pr."id";

ALTER TABLE "PurchaseRequestReceiptItem"
  ALTER COLUMN "itemId" DROP NOT NULL,
  ADD COLUMN "purchaseOrderItemId" TEXT;

UPDATE "PurchaseRequestReceiptItem" AS receipt
SET "purchaseOrderItemId" = po."id"
FROM "PurchaseOrderItem" AS po
WHERE receipt."itemId" = po."purchaseRequestItemId";

CREATE UNIQUE INDEX "PurchaseRequestReceiptItem_receiptId_purchaseOrderItemId_key"
  ON "PurchaseRequestReceiptItem"("receiptId", "purchaseOrderItemId");
CREATE INDEX "PurchaseRequestReceiptItem_purchaseOrderItemId_idx"
  ON "PurchaseRequestReceiptItem"("purchaseOrderItemId");

ALTER TABLE "PurchaseRequestReceiptItem"
  ADD CONSTRAINT "PurchaseRequestReceiptItem_purchaseOrderItemId_fkey"
    FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseRequestReceiptItem_has_source"
    CHECK ("itemId" IS NOT NULL OR "purchaseOrderItemId" IS NOT NULL);

ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_receiving_nonnegative"
    CHECK ("receivedQuantity" >= 0 AND "closedQuantity" >= 0);
