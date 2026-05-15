-- 生产工序完成日志只做追加审计，动作、快照和关联任务必须保持可追溯。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionProcessCompletionLog_identity_not_blank'
  ) THEN
    ALTER TABLE "ProductionProcessCompletionLog"
    ADD CONSTRAINT "ProductionProcessCompletionLog_identity_not_blank"
    CHECK (
      BTRIM("completionId") <> ''
      AND BTRIM("productionTaskId") <> ''
      AND BTRIM("processName") <> ''
      AND BTRIM("action") <> ''
    );
  END IF;

  UPDATE "ProductionProcessCompletionLog"
  SET "action" = 'TASK_FINAL_CONFIRM'
  WHERE "action" = 'SEED_COMPLETE';

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionProcessCompletionLog_action_valid'
  ) THEN
    ALTER TABLE "ProductionProcessCompletionLog"
    ADD CONSTRAINT "ProductionProcessCompletionLog_action_valid"
    CHECK (
      "action" IN (
        'CREATE',
        'UPDATE',
        'BATCH_CREATE',
        'BATCH_UPDATE',
        'TASK_FINAL_CONFIRM',
        'TASK_FINAL_UPDATE',
        'TASK_WITHDRAWN',
        'APPROVE_REPLENISHMENT_REQUEST',
        'REJECT_REPLENISHMENT_REQUEST'
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionProcessCompletionLog_snapshot_shape'
  ) THEN
    ALTER TABLE "ProductionProcessCompletionLog"
    ADD CONSTRAINT "ProductionProcessCompletionLog_snapshot_shape"
    CHECK (
      jsonb_typeof("afterSnapshot") = 'object'
      AND (
        "beforeSnapshot" IS NULL
        OR jsonb_typeof("beforeSnapshot") IN ('object', 'null')
      )
    );
  END IF;
END $$;
