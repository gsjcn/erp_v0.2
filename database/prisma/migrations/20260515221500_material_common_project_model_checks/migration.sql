-- 常用机型只控制零件管理快捷入口的显示顺序，不写入 BOM、适用范围、订单或库存。
UPDATE "MaterialCommonProjectModel"
SET
  "projectModel" = BTRIM("projectModel"),
  "projectModelNormalized" = LOWER(BTRIM("projectModelNormalized"))
WHERE "projectModel" <> BTRIM("projectModel")
   OR "projectModelNormalized" <> LOWER(BTRIM("projectModelNormalized"));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialCommonProjectModel_identity_not_blank'
  ) THEN
    ALTER TABLE "MaterialCommonProjectModel"
    ADD CONSTRAINT "MaterialCommonProjectModel_identity_not_blank"
    CHECK (
      BTRIM("projectModel") <> ''
      AND "projectModel" = BTRIM("projectModel")
      AND BTRIM("projectModelNormalized") <> ''
      AND "projectModelNormalized" = BTRIM("projectModelNormalized")
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialCommonProjectModel_normalized_key_valid'
  ) THEN
    ALTER TABLE "MaterialCommonProjectModel"
    ADD CONSTRAINT "MaterialCommonProjectModel_normalized_key_valid"
    CHECK ("projectModelNormalized" = LOWER("projectModel"));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialCommonProjectModel_sort_order_positive'
  ) THEN
    ALTER TABLE "MaterialCommonProjectModel"
    ADD CONSTRAINT "MaterialCommonProjectModel_sort_order_positive"
    CHECK ("sortOrder" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'MaterialCommonProjectModel_enabled_sortOrder_key'
  ) THEN
    CREATE UNIQUE INDEX "MaterialCommonProjectModel_enabled_sortOrder_key"
    ON "MaterialCommonProjectModel"("sortOrder")
    WHERE "status" = 'ENABLED';
  END IF;
END $$;
