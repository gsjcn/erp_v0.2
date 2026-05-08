-- 补单任务来源必须结构化保存，避免以后只靠 remark 文本判断来源。
ALTER TABLE "ProductionTask"
  ADD COLUMN "replenishmentSourceType" TEXT,
  ADD COLUMN "replenishmentSourceRequestNo" TEXT;

UPDATE "ProductionTask"
SET "replenishmentSourceType" = CASE
  WHEN "isReplenishment" = true AND ("remark" ILIKE '%生产报废%' OR "remark" ILIKE '%PRODUCTION_SCRAP%') THEN 'PRODUCTION_SCRAP'
  WHEN "isReplenishment" = true THEN 'ORDER_CHANGE'
  ELSE NULL
END
WHERE "isReplenishment" = true;

UPDATE "ProductionTask" task
SET "replenishmentSourceRequestNo" = request."requestNo"
FROM "ProductionReplenishmentRequest" request
WHERE task."productionTaskNo" = request."replenishmentTaskNo"
  AND task."isReplenishment" = true
  AND request."requestNo" IS NOT NULL;

UPDATE "ProductionTask"
SET "replenishmentSourceRequestNo" = "orderNo"
WHERE "isReplenishment" = true
  AND "replenishmentSourceType" = 'ORDER_CHANGE'
  AND "replenishmentSourceRequestNo" IS NULL;

CREATE INDEX "ProductionTask_replenishmentSourceType_idx" ON "ProductionTask"("replenishmentSourceType");
CREATE INDEX "ProductionTask_replenishmentSourceRequestNo_idx" ON "ProductionTask"("replenishmentSourceRequestNo");
