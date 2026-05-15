-- 仓库和库位是入库、发货、库存流水的基础定位资料，编码和名称必须保持可追溯。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Warehouse_identity_not_blank'
  ) THEN
    ALTER TABLE "Warehouse"
    ADD CONSTRAINT "Warehouse_identity_not_blank"
    CHECK (
      BTRIM("warehouseCode") <> ''
      AND BTRIM("warehouseName") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Warehouse_code_normalized'
  ) THEN
    ALTER TABLE "Warehouse"
    ADD CONSTRAINT "Warehouse_code_normalized"
    CHECK ("warehouseCode" = UPPER(BTRIM("warehouseCode")));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WarehouseLocation_identity_not_blank'
  ) THEN
    ALTER TABLE "WarehouseLocation"
    ADD CONSTRAINT "WarehouseLocation_identity_not_blank"
    CHECK (
      BTRIM("warehouseId") <> ''
      AND BTRIM("locationCode") <> ''
      AND BTRIM("locationName") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WarehouseLocation_code_normalized'
  ) THEN
    ALTER TABLE "WarehouseLocation"
    ADD CONSTRAINT "WarehouseLocation_code_normalized"
    CHECK ("locationCode" = UPPER(BTRIM("locationCode")));
  END IF;
END $$;
