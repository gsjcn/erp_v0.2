-- 图纸版本基础字段必须可用于下单快照；默认图纸必须保留明确操作人和时间。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialDrawingRevision_identity_not_blank'
  ) THEN
    ALTER TABLE "MaterialDrawingRevision"
    ADD CONSTRAINT "MaterialDrawingRevision_identity_not_blank"
    CHECK (BTRIM("drawingNo") <> '' AND BTRIM("drawingVersion") <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialDrawingRevision_disabled_not_default'
  ) THEN
    ALTER TABLE "MaterialDrawingRevision"
    ADD CONSTRAINT "MaterialDrawingRevision_disabled_not_default"
    CHECK ("status" = 'ENABLED' OR "isDefault" = false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialDrawingRevision_default_operator_required'
  ) THEN
    ALTER TABLE "MaterialDrawingRevision"
    ADD CONSTRAINT "MaterialDrawingRevision_default_operator_required"
    CHECK (
      "isDefault" = false
      OR "status" <> 'ENABLED'
      OR (
        "defaultChangedBy" IS NOT NULL
        AND BTRIM("defaultChangedBy") <> ''
        AND "defaultChangedAt" IS NOT NULL
      )
    );
  END IF;
END $$;
