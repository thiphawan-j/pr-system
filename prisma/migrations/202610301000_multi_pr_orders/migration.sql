-- Keep the historical primary PR reference while introducing all source PRs.
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('ISSUED', 'CANCELLED');
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'ISSUED',
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancellationReference" TEXT;

CREATE TABLE "_PurchaseOrderSources" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_PurchaseOrderSources_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_PurchaseOrderSources_B_index" ON "_PurchaseOrderSources"("B");
ALTER TABLE "_PurchaseOrderSources" ADD CONSTRAINT "_PurchaseOrderSources_A_fkey"
  FOREIGN KEY ("A") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_PurchaseOrderSources" ADD CONSTRAINT "_PurchaseOrderSources_B_fkey"
  FOREIGN KEY ("B") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "_PurchaseOrderSources" ("A", "B") SELECT "id", "purchaseRequestId" FROM "PurchaseOrder";

-- Rows retain their origin even if their commercial source row is later removed.
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "sourcePurchaseRequestId" TEXT;
UPDATE "PurchaseOrderItem" AS line
SET "sourcePurchaseRequestId" = COALESCE((SELECT source."purchaseRequestId" FROM "PurchaseRequestItem" AS source WHERE source."id" = line."purchaseRequestItemId"), orders."purchaseRequestId")
FROM "PurchaseOrder" AS orders
WHERE line."purchaseOrderId" = orders."id";
-- Be conservative for any legacy detached/inconsistent source reference.
UPDATE "PurchaseOrderItem" AS line
SET "sourcePurchaseRequestId" = orders."purchaseRequestId"
FROM "PurchaseOrder" AS orders
WHERE line."purchaseOrderId" = orders."id" AND line."sourcePurchaseRequestId" IS NULL;
INSERT INTO "_PurchaseOrderSources" ("A", "B")
SELECT DISTINCT "purchaseOrderId", "sourcePurchaseRequestId" FROM "PurchaseOrderItem"
ON CONFLICT DO NOTHING;
ALTER TABLE "PurchaseOrderItem" ALTER COLUMN "sourcePurchaseRequestId" SET NOT NULL;
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_sourcePurchaseRequestId_fkey"
  FOREIGN KEY ("sourcePurchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX "PurchaseOrderItem_purchaseRequestItemId_key";
CREATE INDEX "PurchaseOrderItem_purchaseRequestItemId_idx" ON "PurchaseOrderItem"("purchaseRequestItemId");
CREATE INDEX "PurchaseOrderItem_sourcePurchaseRequestId_purchaseOrderId_idx" ON "PurchaseOrderItem"("sourcePurchaseRequestId", "purchaseOrderId");

-- Old PO cancellation was represented on its PR. Preserve that meaning without
-- touching monetary snapshots, amendment JSON, receipt ledgers or PR statuses.
UPDATE "PurchaseOrder" AS orders
SET "status" = 'CANCELLED', "cancelledAt" = source."cancelledAt",
    "cancelledById" = source."cancelledById", "cancellationReason" = source."cancellationReason",
    "cancellationReference" = source."cancellationReference"
FROM "PurchaseRequest" AS source
WHERE orders."purchaseRequestId" = source."id" AND source."status" = 'CANCELLED';
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PurchaseOrder_status_issuedAt_idx" ON "PurchaseOrder"("status", "issuedAt");
CREATE INDEX "PurchaseOrder_cancelledById_idx" ON "PurchaseOrder"("cancelledById");
