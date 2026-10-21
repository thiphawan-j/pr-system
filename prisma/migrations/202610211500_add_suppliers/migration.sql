CREATE TYPE "SupplierContactChannel" AS ENUM ('LINE', 'PHONE', 'ECOMMERCE', 'EMAIL', 'OTHER');

CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "code" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "taxId" TEXT,
  "address" TEXT,
  "contactPerson" TEXT,
  "paymentTerms" TEXT,
  "note" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Supplier_code_positive" CHECK ("code" > 0),
  CONSTRAINT "Supplier_name_nonempty" CHECK (LENGTH(BTRIM("name")) > 0),
  CONSTRAINT "Supplier_version_nonnegative" CHECK ("version" >= 0)
);

CREATE TABLE "SupplierContact" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "channel" "SupplierContactChannel" NOT NULL,
  "value" TEXT NOT NULL,

  CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierContact_value_nonempty" CHECK (LENGTH(BTRIM("value")) > 0)
);

CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");
CREATE INDEX "Supplier_isActive_name_idx" ON "Supplier"("isActive", "name");
CREATE UNIQUE INDEX "SupplierContact_supplierId_channel_key"
  ON "SupplierContact"("supplierId", "channel");

ALTER TABLE "SupplierContact"
  ADD CONSTRAINT "SupplierContact_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the original freeform supplier name/contact fields and preserve every
-- issued PO as-is. Existing documents do not imply verified supplier masters.
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "supplierCode" TEXT,
  ADD COLUMN "supplierTaxId" TEXT,
  ADD COLUMN "supplierContactPerson" TEXT,
  ADD COLUMN "supplierContacts" JSONB,
  ADD CONSTRAINT "PurchaseOrder_supplierContacts_array"
    CHECK ("supplierContacts" IS NULL OR JSONB_TYPEOF("supplierContacts") = 'array');

CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
