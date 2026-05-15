-- 库存批次和库存流水必须保留正数、非空快照和明确批次归属，避免绕过业务层静默改库存。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "InventoryTransaction" WHERE "batchId" IS NULL
  ) THEN
    RAISE EXCEPTION 'InventoryTransaction.batchId contains NULL rows; repair data before applying InventoryTransaction_batch_required';
  END IF;

  ALTER TABLE "InventoryTransaction" ALTER COLUMN "batchId" SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryBatch_quantity_non_negative'
  ) THEN
    ALTER TABLE "InventoryBatch"
    ADD CONSTRAINT "InventoryBatch_quantity_non_negative"
    CHECK ("quantity" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryBatch_identity_not_blank'
  ) THEN
    ALTER TABLE "InventoryBatch"
    ADD CONSTRAINT "InventoryBatch_identity_not_blank"
    CHECK (
      BTRIM("batchNo") <> ''
      AND BTRIM("partCode") <> ''
      AND BTRIM("partName") <> ''
      AND BTRIM("unit") <> ''
      AND BTRIM("sourceKind") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryBatch_status_quantity_consistent'
  ) THEN
    ALTER TABLE "InventoryBatch"
    ADD CONSTRAINT "InventoryBatch_status_quantity_consistent"
    CHECK (
      ("status" = 'AVAILABLE' AND "quantity" > 0)
      OR ("status" = 'USED' AND "quantity" = 0)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryTransaction_quantity_positive'
  ) THEN
    ALTER TABLE "InventoryTransaction"
    ADD CONSTRAINT "InventoryTransaction_quantity_positive"
    CHECK ("quantity" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryTransaction_identity_not_blank'
  ) THEN
    ALTER TABLE "InventoryTransaction"
    ADD CONSTRAINT "InventoryTransaction_identity_not_blank"
    CHECK (
      BTRIM("transactionNo") <> ''
      AND BTRIM("partCode") <> ''
      AND BTRIM("partName") <> ''
      AND BTRIM("unit") <> ''
    );
  END IF;
END $$;
