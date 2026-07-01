-- Allow item unit and unit price to be omitted while preserving computed amount.
ALTER TABLE "PurchaseRequestItem" ALTER COLUMN "unit" DROP NOT NULL;
ALTER TABLE "PurchaseRequestItem" ALTER COLUMN "unitPrice" DROP NOT NULL;
