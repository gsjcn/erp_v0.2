-- 库存预占只表达草稿占用、提交消耗或释放结果，数量和关闭时间必须与状态一致。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryReservation_quantity_positive'
  ) THEN
    ALTER TABLE "InventoryReservation"
    ADD CONSTRAINT "InventoryReservation_quantity_positive"
    CHECK ("quantity" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryReservation_identity_not_blank'
  ) THEN
    ALTER TABLE "InventoryReservation"
    ADD CONSTRAINT "InventoryReservation_identity_not_blank"
    CHECK (
      BTRIM("orderNo") <> ''
      AND BTRIM("partCode") <> ''
      AND BTRIM("partName") <> ''
      AND BTRIM("unit") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InventoryReservation_status_time_consistent'
  ) THEN
    ALTER TABLE "InventoryReservation"
    ADD CONSTRAINT "InventoryReservation_status_time_consistent"
    CHECK (
      (
        "status" = 'ACTIVE'
        AND "releasedAt" IS NULL
        AND "consumedAt" IS NULL
      )
      OR (
        "status" = 'CONSUMED'
        AND "consumedAt" IS NOT NULL
        AND "releasedAt" IS NULL
      )
      OR (
        "status" = 'RELEASED'
        AND "releasedAt" IS NOT NULL
        AND "consumedAt" IS NULL
      )
    );
  END IF;
END $$;
