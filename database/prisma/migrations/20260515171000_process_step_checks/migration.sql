-- 工序明细和工序完成表必须保留可执行的正序号、非空工序名和非负数量。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderLineProcessStep_stepNo_positive'
  ) THEN
    ALTER TABLE "OrderLineProcessStep"
    ADD CONSTRAINT "OrderLineProcessStep_stepNo_positive"
    CHECK ("stepNo" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderLineProcessStep_processName_not_blank'
  ) THEN
    ALTER TABLE "OrderLineProcessStep"
    ADD CONSTRAINT "OrderLineProcessStep_processName_not_blank"
    CHECK (BTRIM("processName") <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionProcessCompletion_stepNo_positive'
  ) THEN
    ALTER TABLE "ProductionProcessCompletion"
    ADD CONSTRAINT "ProductionProcessCompletion_stepNo_positive"
    CHECK ("stepNo" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionProcessCompletion_processName_not_blank'
  ) THEN
    ALTER TABLE "ProductionProcessCompletion"
    ADD CONSTRAINT "ProductionProcessCompletion_processName_not_blank"
    CHECK (BTRIM("processName") <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionProcessCompletion_quantities_non_negative'
  ) THEN
    ALTER TABLE "ProductionProcessCompletion"
    ADD CONSTRAINT "ProductionProcessCompletion_quantities_non_negative"
    CHECK ("completedQuantity" >= 0 AND "scrapQuantity" >= 0 AND "shortageQuantity" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionProcessCompletion_completed_quantity_positive'
  ) THEN
    ALTER TABLE "ProductionProcessCompletion"
    ADD CONSTRAINT "ProductionProcessCompletion_completed_quantity_positive"
    CHECK ("isCompleted" = false OR "completedQuantity" > 0);
  END IF;
END $$;
