-- Store metadata for files uploaded with purchase requests.
CREATE TABLE "PurchaseRequestAttachment" (
    "id" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequestAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseRequestAttachment_purchaseRequestId_createdAt_idx" ON "PurchaseRequestAttachment"("purchaseRequestId", "createdAt");
CREATE INDEX "PurchaseRequestAttachment_uploadedById_idx" ON "PurchaseRequestAttachment"("uploadedById");

ALTER TABLE "PurchaseRequestAttachment" ADD CONSTRAINT "PurchaseRequestAttachment_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequestAttachment" ADD CONSTRAINT "PurchaseRequestAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
