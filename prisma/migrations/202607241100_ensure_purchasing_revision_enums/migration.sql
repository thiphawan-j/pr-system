-- Repair databases where the earlier purchasing revision migration was
-- resolved as applied before every enum value had been created.
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'NEED_REVISION';
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'NEED_CLARIFICATION';

ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'REQUESTED_REVISION';
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'REQUESTED_CLARIFICATION';
