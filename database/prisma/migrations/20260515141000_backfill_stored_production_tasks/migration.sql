-- 旧数据中已有关联入库批次的生产任务统一回填 STORED，保持生产状态和库存来源一致。
UPDATE "ProductionTask" AS task
SET "status" = 'STORED'
WHERE task."status" = 'COMPLETED'
  AND EXISTS (
    SELECT 1
    FROM "InventoryBatch" AS batch
    WHERE batch."productionTaskId" = task."id"
  );
