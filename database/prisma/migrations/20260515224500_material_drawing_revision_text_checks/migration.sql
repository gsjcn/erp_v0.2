-- 图纸版本会被订单和 BOM 行作为快照引用；图号、版本和可选文本必须保持规范，避免同一图纸被空格拆成多套资料。
UPDATE "MaterialDrawingRevision"
SET
  "drawingNo" = BTRIM("drawingNo"),
  "drawingVersion" = BTRIM("drawingVersion"),
  "drawingStatus" = NULLIF(BTRIM("drawingStatus"), ''),
  "drawingFileName" = NULLIF(BTRIM("drawingFileName"), ''),
  "drawingFileUrl" = NULLIF(BTRIM("drawingFileUrl"), ''),
  "defaultChangedBy" = NULLIF(BTRIM("defaultChangedBy"), ''),
  "remark" = NULLIF(BTRIM("remark"), '')
WHERE true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialDrawingRevision_identity_trimmed'
  ) THEN
    ALTER TABLE "MaterialDrawingRevision"
    ADD CONSTRAINT "MaterialDrawingRevision_identity_trimmed"
    CHECK (
      "drawingNo" = BTRIM("drawingNo")
      AND "drawingVersion" = BTRIM("drawingVersion")
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialDrawingRevision_optional_text_not_blank'
  ) THEN
    ALTER TABLE "MaterialDrawingRevision"
    ADD CONSTRAINT "MaterialDrawingRevision_optional_text_not_blank"
    CHECK (
      ("drawingStatus" IS NULL OR (BTRIM("drawingStatus") <> '' AND "drawingStatus" = BTRIM("drawingStatus")))
      AND ("drawingFileName" IS NULL OR (BTRIM("drawingFileName") <> '' AND "drawingFileName" = BTRIM("drawingFileName")))
      AND ("drawingFileUrl" IS NULL OR (BTRIM("drawingFileUrl") <> '' AND "drawingFileUrl" = BTRIM("drawingFileUrl")))
      AND ("defaultChangedBy" IS NULL OR (BTRIM("defaultChangedBy") <> '' AND "defaultChangedBy" = BTRIM("defaultChangedBy")))
      AND ("remark" IS NULL OR (BTRIM("remark") <> '' AND "remark" = BTRIM("remark")))
    );
  END IF;
END $$;
