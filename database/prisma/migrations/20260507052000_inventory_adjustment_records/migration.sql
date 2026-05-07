CREATE TABLE "InventoryAdjustment" (
    "id" TEXT NOT NULL,
    "adjustmentNo" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "partCode" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "beforeQuantity" DECIMAL(18,3) NOT NULL,
    "afterQuantity" DECIMAL(18,3) NOT NULL,
    "deltaQuantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "countedBy" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL,
    "signatureName" TEXT NOT NULL,
    "attachmentFileName" TEXT,
    "attachmentFileUrl" TEXT,
    "attachmentMimeType" TEXT,
    "attachmentSize" INTEGER,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryAdjustment_adjustmentNo_key"
    ON "InventoryAdjustment"("adjustmentNo");

CREATE INDEX "InventoryAdjustment_batchId_idx"
    ON "InventoryAdjustment"("batchId");

CREATE INDEX "InventoryAdjustment_partCode_idx"
    ON "InventoryAdjustment"("partCode");

CREATE INDEX "InventoryAdjustment_countedAt_idx"
    ON "InventoryAdjustment"("countedAt");

CREATE INDEX "InventoryAdjustment_createdAt_idx"
    ON "InventoryAdjustment"("createdAt");

ALTER TABLE "InventoryAdjustment"
    ADD CONSTRAINT "InventoryAdjustment_batchId_fkey"
    FOREIGN KEY ("batchId")
    REFERENCES "InventoryBatch"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
