-- Existing ORDERED PRs may refer to POs issued outside this application.
-- Do not fabricate purchase orders or document numbers for those records.
CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "poNumber" TEXT NOT NULL,
  "purchaseRequestId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supplierName" TEXT NOT NULL,
  "supplierAddress" TEXT,
  "supplierContact" TEXT,
  "deliveryAddress" TEXT,
  "paymentTerms" TEXT,
  "expectedDeliveryDate" TIMESTAMP(3),
  "note" TEXT,
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrder_poNumber_nonempty" CHECK (LENGTH(BTRIM("poNumber")) > 0),
  CONSTRAINT "PurchaseOrder_supplierName_nonempty" CHECK (LENGTH(BTRIM("supplierName")) > 0),
  CONSTRAINT "PurchaseOrder_totalAmount_nonnegative" CHECK ("totalAmount" >= 0)
);

CREATE TABLE "PurchaseOrderItem" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "purchaseRequestItemId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "itemName" TEXT NOT NULL,
  "description" TEXT,
  "quantity" INTEGER NOT NULL,
  "unit" TEXT,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,

  CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrderItem_position_nonnegative" CHECK ("position" >= 0),
  CONSTRAINT "PurchaseOrderItem_itemName_nonempty" CHECK (LENGTH(BTRIM("itemName")) > 0),
  CONSTRAINT "PurchaseOrderItem_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "PurchaseOrderItem_unitPrice_nonnegative" CHECK ("unitPrice" >= 0),
  CONSTRAINT "PurchaseOrderItem_amount_nonnegative" CHECK ("amount" >= 0)
);

CREATE TABLE "PurchaseOrderNumberSequence" (
  "key" TEXT NOT NULL,
  -- The next unused number. Reserve a batch of N by atomically incrementing
  -- this value by N, then use returned nextValue - N through nextValue - 1.
  "nextValue" INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "PurchaseOrderNumberSequence_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "PurchaseOrderNumberSequence_key_nonempty" CHECK (LENGTH(BTRIM("key")) > 0),
  CONSTRAINT "PurchaseOrderNumberSequence_nextValue_positive" CHECK ("nextValue" > 0)
);

CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");
CREATE INDEX "PurchaseOrder_purchaseRequestId_issuedAt_idx"
  ON "PurchaseOrder"("purchaseRequestId", "issuedAt");
CREATE INDEX "PurchaseOrder_createdById_idx" ON "PurchaseOrder"("createdById");

-- A PR line is allocated once at its full approved quantity. Multi-supplier
-- conversion issues all selected supplier orders in one transaction.
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseRequestItemId_key"
  ON "PurchaseOrderItem"("purchaseRequestItemId");
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_position_key"
  ON "PurchaseOrderItem"("purchaseOrderId", "position");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_purchaseRequestId_fkey"
    FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseOrder_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseOrderItem_purchaseRequestItemId_fkey"
    FOREIGN KEY ("purchaseRequestItemId") REFERENCES "PurchaseRequestItem"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
