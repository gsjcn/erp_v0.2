-- 旧发货 / 库存占用流水创建时没有 orderLineId。补齐后，订单明细、统计和备货超发校验都能按订单零件精确累计。
UPDATE "InventoryTransaction" AS transaction
SET "orderLineId" = batch."sourceOrderLineId"
FROM "InventoryBatch" AS batch
WHERE transaction."batchId" = batch."id"
  AND transaction."orderLineId" IS NULL
  AND batch."sourceOrderLineId" IS NOT NULL;

UPDATE "InventoryTransaction" AS transaction
SET "orderLineId" = line."id"
FROM "OrderLine" AS line
WHERE transaction."orderLineId" IS NULL
  AND transaction."sourceRecordId" = line."id"
  AND transaction."sourceRecordType" IN (
    'OrderLineSTOCK',
    'OrderLineREWORK',
    'OrderLineStockAllocation',
    'OrderCancellation',
    'OrderCancellationReleaseStock'
  );
