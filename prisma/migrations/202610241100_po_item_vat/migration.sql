-- Keep legacy prices tax-unspecified: no historical invoice is reinterpreted.
CREATE TYPE "PurchasePriceTaxMode" AS ENUM ('UNSPECIFIED', 'INCLUSIVE', 'EXCLUSIVE', 'NONE');

ALTER TABLE "PurchaseOrder"
  ADD COLUMN "taxMode" "PurchasePriceTaxMode" NOT NULL DEFAULT 'UNSPECIFIED',
  ADD COLUMN "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 7;
ALTER TABLE "PurchaseOrderItem"
  ADD COLUMN "taxMode" "PurchasePriceTaxMode";
ALTER TABLE "PurchaseRequestItem"
  ADD COLUMN "taxMode" "PurchasePriceTaxMode" NOT NULL DEFAULT 'UNSPECIFIED',
  ADD COLUMN "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 7;

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vatRate_range" CHECK ("vatRate" >= 0 AND "vatRate" <= 100);
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_vatRate_range" CHECK ("vatRate" >= 0 AND "vatRate" <= 100);
