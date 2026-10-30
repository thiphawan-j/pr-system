-- Keep the recipient's issued identity even if their employee profile changes.
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "deliveryRecipientId" TEXT,
  ADD COLUMN "deliveryRecipientName" TEXT,
  ADD COLUMN "deliveryRecipientPhone" TEXT;

CREATE INDEX "PurchaseOrder_deliveryRecipientId_idx" ON "PurchaseOrder"("deliveryRecipientId");
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_deliveryRecipientId_fkey"
  FOREIGN KEY ("deliveryRecipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
