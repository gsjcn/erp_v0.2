-- 订单 Excel 导入只能形成可预览、可追溯的 DRAFT 草稿来源；会话、文件和行快照必须保留稳定形状。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportSession_status_valid'
  ) THEN
    ALTER TABLE "OrderImportSession"
    ADD CONSTRAINT "OrderImportSession_status_valid"
    CHECK ("status" IN ('DRAFT', 'COMMITTED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportSession_created_by_not_blank'
  ) THEN
    ALTER TABLE "OrderImportSession"
    ADD CONSTRAINT "OrderImportSession_created_by_not_blank"
    CHECK ("createdBy" IS NULL OR BTRIM("createdBy") <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportSession_commit_fields_valid'
  ) THEN
    ALTER TABLE "OrderImportSession"
    ADD CONSTRAINT "OrderImportSession_commit_fields_valid"
    CHECK (
      (
        "status" = 'DRAFT'
        AND "committedAt" IS NULL
        AND "committedOrderNos" IS NULL
      )
      OR
      (
        "status" = 'COMMITTED'
        AND "committedAt" IS NOT NULL
        AND "committedOrderNos" IS NOT NULL
        AND jsonb_typeof("committedOrderNos") = 'array'
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportFile_identity_not_blank'
  ) THEN
    ALTER TABLE "OrderImportFile"
    ADD CONSTRAINT "OrderImportFile_identity_not_blank"
    CHECK (
      BTRIM("sessionId") <> ''
      AND BTRIM("fileName") <> ''
      AND ("storedFileName" IS NULL OR BTRIM("storedFileName") <> '')
      AND BTRIM("fileHash") <> ''
      AND BTRIM("sheetName") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportFile_counts_valid'
  ) THEN
    ALTER TABLE "OrderImportFile"
    ADD CONSTRAINT "OrderImportFile_counts_valid"
    CHECK (
      "rowCount" >= 0
      AND "acceptedRowCount" >= 0
      AND "duplicateRowCount" >= 0
      AND "acceptedRowCount" + "duplicateRowCount" <= "rowCount"
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportRow_identity_not_blank'
  ) THEN
    ALTER TABLE "OrderImportRow"
    ADD CONSTRAINT "OrderImportRow_identity_not_blank"
    CHECK (
      BTRIM("sessionId") <> ''
      AND BTRIM("fileId") <> ''
      AND BTRIM("rowHash") <> ''
      AND BTRIM("lineType") <> ''
      AND BTRIM("unit") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportRow_line_type_valid'
  ) THEN
    ALTER TABLE "OrderImportRow"
    ADD CONSTRAINT "OrderImportRow_line_type_valid"
    CHECK ("lineType" IN ('PART', 'COMPONENT'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportRow_quantities_valid'
  ) THEN
    ALTER TABLE "OrderImportRow"
    ADD CONSTRAINT "OrderImportRow_quantities_valid"
    CHECK (
      "sourceRowNo" > 0
      AND "partThickness" >= 0
      AND ("orderQuantity" IS NULL OR "orderQuantity" >= 0)
      AND ("unitUsage" IS NULL OR "unitUsage" >= 0)
      AND "demandQuantity" >= 0
      AND "errorCount" >= 0
      AND "warningCount" >= 0
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportRow_json_shape_valid'
  ) THEN
    ALTER TABLE "OrderImportRow"
    ADD CONSTRAINT "OrderImportRow_json_shape_valid"
    CHECK (
      jsonb_typeof("raw") = 'object'
      AND ("issues" IS NULL OR jsonb_typeof("issues") = 'array')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportRow_optional_text_not_blank'
  ) THEN
    ALTER TABLE "OrderImportRow"
    ADD CONSTRAINT "OrderImportRow_optional_text_not_blank"
    CHECK (
      ("orderBlock" IS NULL OR BTRIM("orderBlock") <> '')
      AND ("projectModel" IS NULL OR BTRIM("projectModel") <> '')
      AND ("importSequence" IS NULL OR BTRIM("importSequence") <> '')
      AND ("partCategory" IS NULL OR BTRIM("partCategory") <> '')
      AND ("componentNo" IS NULL OR BTRIM("componentNo") <> '')
      AND ("parentComponentNo" IS NULL OR BTRIM("parentComponentNo") <> '')
      AND ("drawingNo" IS NULL OR BTRIM("drawingNo") <> '')
      AND ("partSpecification" IS NULL OR BTRIM("partSpecification") <> '')
      AND ("processRoute" IS NULL OR BTRIM("processRoute") <> '')
      AND ("processRemark" IS NULL OR BTRIM("processRemark") <> '')
      AND ("drawingStatus" IS NULL OR BTRIM("drawingStatus") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportRow_clean_required_fields'
  ) THEN
    ALTER TABLE "OrderImportRow"
    ADD CONSTRAINT "OrderImportRow_clean_required_fields"
    CHECK (
      "errorCount" > 0
      OR (
        BTRIM("orderNo") <> ''
        AND BTRIM("customerName") <> ''
        AND BTRIM("partCode") <> ''
        AND BTRIM("partName") <> ''
        AND "demandQuantity" > 0
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderImportRow_clean_component_shape'
  ) THEN
    ALTER TABLE "OrderImportRow"
    ADD CONSTRAINT "OrderImportRow_clean_component_shape"
    CHECK (
      "errorCount" > 0
      OR
      (
        "lineType" = 'COMPONENT'
        AND "componentNo" IS NOT NULL
        AND BTRIM("componentNo") <> ''
        AND "parentComponentNo" IS NULL
      )
      OR
      (
        "lineType" = 'PART'
        AND "componentNo" IS NULL
      )
    );
  END IF;
END $$;
