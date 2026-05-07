CREATE TYPE "ProductionNoticeTarget" AS ENUM ('PRODUCTION', 'WAREHOUSE');

ALTER TABLE "ProductionNotice"
ADD COLUMN "target" "ProductionNoticeTarget" NOT NULL DEFAULT 'PRODUCTION';

CREATE INDEX "ProductionNotice_target_idx" ON "ProductionNotice"("target");
CREATE INDEX "ProductionNotice_target_status_idx" ON "ProductionNotice"("target", "status");

CREATE UNIQUE INDEX "ProductionTask_pending_replenishment_unique"
ON "ProductionTask"("orderLineId", "sourceProductionTaskNo")
WHERE "isReplenishment" = true AND "status" = 'PENDING';
