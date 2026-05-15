-- 库存批次状态补齐第一阶段枚举范围；可用库存仍只按 AVAILABLE 且 quantity > 0 计算。
DO $$
BEGIN
  ALTER TABLE "InventoryBatch"
  DROP CONSTRAINT IF EXISTS "InventoryBatch_status_quantity_consistent";

  ALTER TABLE "InventoryBatch"
  ADD CONSTRAINT "InventoryBatch_status_quantity_consistent"
  CHECK (
    ("status" = 'AVAILABLE' AND "quantity" > 0)
    OR ("status" = 'RESERVED' AND "quantity" > 0)
    OR ("status" IN ('USED', 'SCRAPPED') AND "quantity" = 0)
  );
END $$;
