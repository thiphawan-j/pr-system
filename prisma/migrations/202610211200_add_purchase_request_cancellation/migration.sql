ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'CANCEL_REQUESTED';
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'CANCELLATION_REQUESTED';
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'CANCELLATION_DECLINED';
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "PurchaseRequest"
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancellationReference" TEXT;

CREATE INDEX "PurchaseRequest_cancelledById_idx" ON "PurchaseRequest"("cancelledById");

ALTER TABLE "PurchaseRequest"
  ADD CONSTRAINT "PurchaseRequest_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
