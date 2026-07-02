ALTER TABLE "PurchaseRequest"
ADD COLUMN "receivedAt" TIMESTAMP(3);

UPDATE "PurchaseRequest"
SET "receivedAt" = "completedAt"
WHERE "status" = 'COMPLETED'
  AND "completedAt" IS NOT NULL
  AND "receivedAt" IS NULL;
