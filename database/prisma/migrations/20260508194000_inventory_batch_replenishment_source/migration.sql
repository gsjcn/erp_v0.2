ALTER TABLE "InventoryBatch"
ADD COLUMN "replenishmentSourceType" TEXT,
ADD COLUMN "replenishmentSourceRequestNo" TEXT;

UPDATE "InventoryBatch" AS batch
SET
  "replenishmentSourceType" = task."replenishmentSourceType",
  "replenishmentSourceRequestNo" = task."replenishmentSourceRequestNo"
FROM "ProductionTask" AS task
WHERE batch."sourceProductionTaskNo" = task."productionTaskNo";

CREATE INDEX "InventoryBatch_replenishmentSourceType_idx" ON "InventoryBatch"("replenishmentSourceType");
CREATE INDEX "InventoryBatch_replenishmentSourceRequestNo_idx" ON "InventoryBatch"("replenishmentSourceRequestNo");
