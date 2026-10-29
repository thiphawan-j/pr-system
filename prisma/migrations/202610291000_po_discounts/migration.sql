-- Historical prices and VAT are unchanged until an explicit PO discount is saved.
CREATE TYPE "PurchaseDiscountType" AS ENUM ('NONE', 'AMOUNT', 'PERCENT');
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "discountType" "PurchaseDiscountType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderItem"
  ADD COLUMN "discountType" "PurchaseDiscountType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "orderDiscountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseRequestItem"
  ADD COLUMN "discountType" "PurchaseDiscountType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "orderDiscountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_discount_valid"
  CHECK ("discountValue" >= 0 AND ("discountType" != 'PERCENT' OR "discountValue" <= 100) AND ("discountType" != 'NONE' OR "discountValue" = 0));
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_discount_valid"
  CHECK ("discountValue" >= 0 AND "orderDiscountAmount" >= 0 AND ("discountType" != 'PERCENT' OR "discountValue" <= 100) AND ("discountType" != 'NONE' OR "discountValue" = 0));
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_discount_valid"
  CHECK ("discountValue" >= 0 AND "orderDiscountAmount" >= 0 AND ("discountType" != 'PERCENT' OR "discountValue" <= 100) AND ("discountType" != 'NONE' OR "discountValue" = 0));
