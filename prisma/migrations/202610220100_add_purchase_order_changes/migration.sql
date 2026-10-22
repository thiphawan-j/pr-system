CREATE TYPE "PurchaseOrderChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "PurchaseOrder"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "PurchaseOrder_version_nonnegative" CHECK ("version" >= 0),
  ADD CONSTRAINT "PurchaseOrder_revision_nonnegative" CHECK ("revision" >= 0);

CREATE TABLE "PurchaseOrderChange" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "submittedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reason" TEXT NOT NULL,
  "reviewComment" TEXT,
  "status" "PurchaseOrderChangeStatus" NOT NULL DEFAULT 'PENDING',
  "baseVersion" INTEGER NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),

  CONSTRAINT "PurchaseOrderChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrderChange_baseVersion_nonnegative" CHECK ("baseVersion" >= 0),
  CONSTRAINT "PurchaseOrderChange_reason_minimum_length" CHECK (LENGTH(BTRIM("reason")) >= 5),
  CONSTRAINT "PurchaseOrderChange_before_object" CHECK (JSONB_TYPEOF("before") = 'object'),
  CONSTRAINT "PurchaseOrderChange_after_object" CHECK (JSONB_TYPEOF("after") = 'object')
);

CREATE INDEX "PurchaseOrderChange_purchaseOrderId_createdAt_idx"
  ON "PurchaseOrderChange"("purchaseOrderId", "createdAt");
CREATE INDEX "PurchaseOrderChange_purchaseOrderId_status_idx"
  ON "PurchaseOrderChange"("purchaseOrderId", "status");
CREATE INDEX "PurchaseOrderChange_submittedById_idx"
  ON "PurchaseOrderChange"("submittedById");
CREATE INDEX "PurchaseOrderChange_reviewedById_idx"
  ON "PurchaseOrderChange"("reviewedById");

-- Resolved changes remain as history, while only one proposed revision can be
-- pending for an issued PO. Application writes also serialize on PO.version.
CREATE UNIQUE INDEX "PurchaseOrderChange_purchaseOrderId_pending_key"
  ON "PurchaseOrderChange"("purchaseOrderId") WHERE "status" = 'PENDING';

ALTER TABLE "PurchaseOrderChange"
  ADD CONSTRAINT "PurchaseOrderChange_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseOrderChange_submittedById_fkey"
    FOREIGN KEY ("submittedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseOrderChange_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
