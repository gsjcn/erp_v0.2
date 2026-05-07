ALTER TABLE "ProductionTask"
    ADD COLUMN "isReplenishment" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "sourceProductionTaskNo" TEXT;

ALTER TABLE "ProductionProcessCompletion"
    ADD COLUMN "scrapQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    ADD COLUMN "shortageQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    ADD COLUMN "shortageMode" TEXT,
    ADD COLUMN "replenishmentTaskNo" TEXT,
    ADD COLUMN "managerName" TEXT,
    ADD COLUMN "shortageReason" TEXT;

CREATE INDEX "ProductionTask_isReplenishment_idx"
    ON "ProductionTask"("isReplenishment");

CREATE INDEX "ProductionTask_sourceProductionTaskNo_idx"
    ON "ProductionTask"("sourceProductionTaskNo");
