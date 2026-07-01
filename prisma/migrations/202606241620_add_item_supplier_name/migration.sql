-- Add optional supplier/additional note field to each purchase request item.
ALTER TABLE "PurchaseRequestItem" ADD COLUMN "supplierName" TEXT;
