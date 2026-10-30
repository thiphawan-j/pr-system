CREATE TABLE "PurchaseOrderShare" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "supplierKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  CONSTRAINT "PurchaseOrderShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PurchaseOrderShare_purchaseOrderId_key" ON "PurchaseOrderShare"("purchaseOrderId");
CREATE UNIQUE INDEX "PurchaseOrderShare_token_key" ON "PurchaseOrderShare"("token");
CREATE INDEX "PurchaseOrderShare_createdById_idx" ON "PurchaseOrderShare"("createdById");
CREATE INDEX "PurchaseOrderShare_revokedById_idx" ON "PurchaseOrderShare"("revokedById");
ALTER TABLE "PurchaseOrderShare" ADD CONSTRAINT "PurchaseOrderShare_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderShare" ADD CONSTRAINT "PurchaseOrderShare_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderShare" ADD CONSTRAINT "PurchaseOrderShare_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
