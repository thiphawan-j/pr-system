CREATE TABLE "CompanyProfile" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "taxId" TEXT,
  "branch" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyProfile_singleton" CHECK ("id" = 'default'),
  CONSTRAINT "CompanyProfile_name_nonempty" CHECK (LENGTH(BTRIM("name")) > 0),
  CONSTRAINT "CompanyProfile_address_nonempty" CHECK (LENGTH(BTRIM("address")) > 0),
  CONSTRAINT "CompanyProfile_version_positive" CHECK ("version" > 0)
);

ALTER TABLE "PurchaseOrder"
  ADD COLUMN "buyerCompany" JSONB,
  ADD CONSTRAINT "PurchaseOrder_buyerCompany_object"
    CHECK ("buyerCompany" IS NULL OR JSONB_TYPEOF("buyerCompany") = 'object');
