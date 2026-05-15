-- 生产和仓库通知只保留待确认或已确认两种状态；确认字段、数量字段和基础快照必须一致。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionNotice_identity_not_blank'
  ) THEN
    ALTER TABLE "ProductionNotice"
    ADD CONSTRAINT "ProductionNotice_identity_not_blank"
    CHECK (
      BTRIM("noticeNo") <> ''
      AND BTRIM("orderNo") <> ''
      AND BTRIM("reason") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionNotice_optional_text_not_blank'
  ) THEN
    ALTER TABLE "ProductionNotice"
    ADD CONSTRAINT "ProductionNotice_optional_text_not_blank"
    CHECK (
      ("productionTaskNo" IS NULL OR BTRIM("productionTaskNo") <> '')
      AND ("partCode" IS NULL OR BTRIM("partCode") <> '')
      AND ("partName" IS NULL OR BTRIM("partName") <> '')
      AND ("unit" IS NULL OR BTRIM("unit") <> '')
      AND ("managerName" IS NULL OR BTRIM("managerName") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionNotice_ack_status_consistent'
  ) THEN
    ALTER TABLE "ProductionNotice"
    ADD CONSTRAINT "ProductionNotice_ack_status_consistent"
    CHECK (
      (
        "status" = 'PENDING'
        AND "acknowledgedBy" IS NULL
        AND "acknowledgedAt" IS NULL
      )
      OR (
        "status" = 'ACKNOWLEDGED'
        AND "acknowledgedBy" IS NOT NULL
        AND BTRIM("acknowledgedBy") <> ''
        AND "acknowledgedAt" IS NOT NULL
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionNotice_quantity_fields_consistent'
  ) THEN
    ALTER TABLE "ProductionNotice"
    ADD CONSTRAINT "ProductionNotice_quantity_fields_consistent"
    CHECK (
      (
        "beforeQuantity" IS NULL
        AND "afterQuantity" IS NULL
        AND "deltaQuantity" IS NULL
      )
      OR (
        "beforeQuantity" IS NOT NULL
        AND "afterQuantity" IS NOT NULL
        AND "deltaQuantity" IS NOT NULL
        AND "beforeQuantity" >= 0
        AND "afterQuantity" >= 0
        AND "deltaQuantity" = "afterQuantity" - "beforeQuantity"
        AND "unit" IS NOT NULL
        AND BTRIM("unit") <> ''
      )
    );
  END IF;
END $$;
