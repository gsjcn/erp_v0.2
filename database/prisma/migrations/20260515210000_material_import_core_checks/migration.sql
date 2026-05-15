-- 零件库 Excel 导入只写基础资料、适用范围和来源加工建议；导入会话、文件和预览行必须可追溯且可重新校验。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialImportSession_status_valid'
  ) THEN
    ALTER TABLE "MaterialImportSession"
    ADD CONSTRAINT "MaterialImportSession_status_valid"
    CHECK ("status" IN ('DRAFT', 'COMMITTED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialImportSession_created_by_not_blank'
  ) THEN
    ALTER TABLE "MaterialImportSession"
    ADD CONSTRAINT "MaterialImportSession_created_by_not_blank"
    CHECK ("createdBy" IS NULL OR BTRIM("createdBy") <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialImportSession_commit_fields_valid'
  ) THEN
    ALTER TABLE "MaterialImportSession"
    ADD CONSTRAINT "MaterialImportSession_commit_fields_valid"
    CHECK (
      (
        "status" = 'DRAFT'
        AND "committedAt" IS NULL
        AND "committedMaterialCodes" IS NULL
      )
      OR
      (
        "status" = 'COMMITTED'
        AND "committedAt" IS NOT NULL
        AND "committedMaterialCodes" IS NOT NULL
        AND jsonb_typeof("committedMaterialCodes") = 'array'
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialImportFile_identity_not_blank'
  ) THEN
    ALTER TABLE "MaterialImportFile"
    ADD CONSTRAINT "MaterialImportFile_identity_not_blank"
    CHECK (
      BTRIM("sessionId") <> ''
      AND BTRIM("fileName") <> ''
      AND ("storedFileName" IS NULL OR BTRIM("storedFileName") <> '')
      AND BTRIM("fileHash") <> ''
      AND BTRIM("sheetName") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialImportFile_counts_valid'
  ) THEN
    ALTER TABLE "MaterialImportFile"
    ADD CONSTRAINT "MaterialImportFile_counts_valid"
    CHECK (
      "rowCount" >= 0
      AND "materialRowCount" >= 0
      AND "scopeRowCount" >= 0
      AND "transformRowCount" >= 0
      AND "acceptedRowCount" >= 0
      AND "duplicateRowCount" >= 0
      AND "materialRowCount" + "scopeRowCount" + "transformRowCount" = "rowCount"
      AND "acceptedRowCount" + "duplicateRowCount" = "rowCount"
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialImportRow_identity_not_blank'
  ) THEN
    ALTER TABLE "MaterialImportRow"
    ADD CONSTRAINT "MaterialImportRow_identity_not_blank"
    CHECK (
      BTRIM("sessionId") <> ''
      AND BTRIM("fileId") <> ''
      AND BTRIM("rowHash") <> ''
      AND BTRIM("partCode") <> ''
      AND BTRIM("partName") <> ''
      AND BTRIM("unit") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialImportRow_values_valid'
  ) THEN
    ALTER TABLE "MaterialImportRow"
    ADD CONSTRAINT "MaterialImportRow_values_valid"
    CHECK (
      "sourceRowNo" > 0
      AND ("partThickness" IS NULL OR "partThickness" >= 0)
      AND ("stockAlertQuantity" IS NULL OR "stockAlertQuantity" >= 0)
      AND ("stockAlertEnabled" IS DISTINCT FROM true OR "stockAlertQuantity" IS NOT NULL)
      AND "errorCount" >= 0
      AND "warningCount" >= 0
      AND jsonb_typeof("raw") = 'object'
      AND ("issues" IS NULL OR jsonb_typeof("issues") = 'array')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialImportRow_optional_text_not_blank'
  ) THEN
    ALTER TABLE "MaterialImportRow"
    ADD CONSTRAINT "MaterialImportRow_optional_text_not_blank"
    CHECK (
      ("partSpecification" IS NULL OR BTRIM("partSpecification") <> '')
      AND ("drawingNo" IS NULL OR BTRIM("drawingNo") <> '')
      AND ("drawingVersion" IS NULL OR BTRIM("drawingVersion") <> '')
      AND ("drawingStatus" IS NULL OR BTRIM("drawingStatus") <> '')
      AND ("projectModel" IS NULL OR BTRIM("projectModel") <> '')
      AND ("remark" IS NULL OR BTRIM("remark") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialApplicabilityImportRow_identity_not_blank'
  ) THEN
    ALTER TABLE "MaterialApplicabilityImportRow"
    ADD CONSTRAINT "MaterialApplicabilityImportRow_identity_not_blank"
    CHECK (
      BTRIM("sessionId") <> ''
      AND BTRIM("fileId") <> ''
      AND BTRIM("rowHash") <> ''
      AND BTRIM("partCode") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialApplicabilityImportRow_values_valid'
  ) THEN
    ALTER TABLE "MaterialApplicabilityImportRow"
    ADD CONSTRAINT "MaterialApplicabilityImportRow_values_valid"
    CHECK (
      "sourceRowNo" > 0
      AND "status" IN ('ENABLED', 'DISABLED')
      AND "errorCount" >= 0
      AND "warningCount" >= 0
      AND jsonb_typeof("raw") = 'object'
      AND ("issues" IS NULL OR jsonb_typeof("issues") = 'array')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialApplicabilityImportRow_optional_text_not_blank'
  ) THEN
    ALTER TABLE "MaterialApplicabilityImportRow"
    ADD CONSTRAINT "MaterialApplicabilityImportRow_optional_text_not_blank"
    CHECK (
      ("customerCode" IS NULL OR BTRIM("customerCode") <> '')
      AND ("customerName" IS NULL OR BTRIM("customerName") <> '')
      AND ("projectModel" IS NULL OR BTRIM("projectModel") <> '')
      AND ("remark" IS NULL OR BTRIM("remark") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialTransformImportRow_identity_not_blank'
  ) THEN
    ALTER TABLE "MaterialTransformImportRow"
    ADD CONSTRAINT "MaterialTransformImportRow_identity_not_blank"
    CHECK (
      BTRIM("sessionId") <> ''
      AND BTRIM("fileId") <> ''
      AND BTRIM("rowHash") <> ''
      AND BTRIM("sourcePartCode") <> ''
      AND BTRIM("targetPartCode") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialTransformImportRow_values_valid'
  ) THEN
    ALTER TABLE "MaterialTransformImportRow"
    ADD CONSTRAINT "MaterialTransformImportRow_values_valid"
    CHECK (
      "sourceRowNo" > 0
      AND LOWER(BTRIM("sourcePartCode")) <> LOWER(BTRIM("targetPartCode"))
      AND ("multiplier" IS NULL OR "multiplier" > 0)
      AND ("lossRate" IS NULL OR "lossRate" >= 0)
      AND "status" IN ('ENABLED', 'DISABLED')
      AND "errorCount" >= 0
      AND "warningCount" >= 0
      AND jsonb_typeof("raw") = 'object'
      AND ("issues" IS NULL OR jsonb_typeof("issues") = 'array')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialTransformImportRow_optional_text_not_blank'
  ) THEN
    ALTER TABLE "MaterialTransformImportRow"
    ADD CONSTRAINT "MaterialTransformImportRow_optional_text_not_blank"
    CHECK (
      ("customerCode" IS NULL OR BTRIM("customerCode") <> '')
      AND ("customerName" IS NULL OR BTRIM("customerName") <> '')
      AND ("projectModel" IS NULL OR BTRIM("projectModel") <> '')
      AND ("defaultProcessRoute" IS NULL OR BTRIM("defaultProcessRoute") <> '')
      AND ("conversionDescription" IS NULL OR BTRIM("conversionDescription") <> '')
      AND ("remark" IS NULL OR BTRIM("remark") <> '')
    );
  END IF;
END $$;
