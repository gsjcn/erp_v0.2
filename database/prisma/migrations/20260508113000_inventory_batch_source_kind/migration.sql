ALTER TABLE "InventoryBatch"
    ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'NORMAL_ORDER';

CREATE INDEX "InventoryBatch_sourceKind_idx"
    ON "InventoryBatch"("sourceKind");
