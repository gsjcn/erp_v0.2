-- 生产任务状态字段必须和数量、时间保持一致，避免绕过后端写入不可执行任务。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionTask_quantities_valid'
  ) THEN
    ALTER TABLE "ProductionTask"
    ADD CONSTRAINT "ProductionTask_quantities_valid"
    CHECK ("plannedQuantity" > 0 AND "completedQuantity" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionTask_identity_not_blank'
  ) THEN
    ALTER TABLE "ProductionTask"
    ADD CONSTRAINT "ProductionTask_identity_not_blank"
    CHECK (
      BTRIM("productionTaskNo") <> ''
      AND BTRIM("orderNo") <> ''
      AND BTRIM("customerName") <> ''
      AND BTRIM("partCode") <> ''
      AND BTRIM("partName") <> ''
      AND BTRIM("unit") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionTask_completed_time_order'
  ) THEN
    ALTER TABLE "ProductionTask"
    ADD CONSTRAINT "ProductionTask_completed_time_order"
    CHECK ("startedAt" IS NULL OR "completedAt" IS NULL OR "completedAt" >= "startedAt");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionTask_status_fields_consistent'
  ) THEN
    ALTER TABLE "ProductionTask"
    ADD CONSTRAINT "ProductionTask_status_fields_consistent"
    CHECK (
      (
        "status" = 'PENDING'
        AND "startedAt" IS NULL
        AND "completedAt" IS NULL
        AND "completedQuantity" = 0
      )
      OR (
        "status" = 'IN_PROGRESS'
        AND "startedAt" IS NOT NULL
        AND "completedAt" IS NULL
      )
      OR (
        "status" = 'WAITING_CONFIRMATION'
        AND "startedAt" IS NOT NULL
        AND "completedAt" IS NULL
        AND "completedQuantity" = 0
      )
      OR (
        "status" IN ('COMPLETED', 'STORED')
        AND "startedAt" IS NOT NULL
        AND "completedAt" IS NOT NULL
        AND "completedQuantity" > 0
      )
      OR (
        "status" = 'CANCELLED'
        AND "startedAt" IS NULL
        AND "completedAt" IS NULL
        AND "completedQuantity" = 0
        AND "remark" IS NOT NULL
        AND BTRIM("remark") <> ''
      )
    );
  END IF;
END $$;
