-- Additive migration; historical PR/PO snapshots are deliberately untouched.
ALTER TABLE "Product" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductAlias" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "ProductAudit" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductAudit_productId_createdAt_idx" ON "ProductAudit"("productId", "createdAt");
ALTER TABLE "ProductAudit" ADD CONSTRAINT "ProductAudit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
