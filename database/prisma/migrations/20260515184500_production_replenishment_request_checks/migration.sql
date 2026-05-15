-- 生产报废补单申请必须保留数量、来源和审批状态一致性，避免绕过后端生成半确认申请。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionReplenishmentRequest_identity_not_blank'
  ) THEN
    ALTER TABLE "ProductionReplenishmentRequest"
    ADD CONSTRAINT "ProductionReplenishmentRequest_identity_not_blank"
    CHECK (
      BTRIM("requestNo") <> ''
      AND BTRIM("sourceType") <> ''
      AND BTRIM("status") <> ''
      AND BTRIM("orderNo") <> ''
      AND ("productionTaskNo" IS NULL OR BTRIM("productionTaskNo") <> '')
      AND BTRIM("partCode") <> ''
      AND BTRIM("partName") <> ''
      AND BTRIM("unit") <> ''
      AND BTRIM("reason") <> ''
      AND ("requestedByCode" IS NULL OR BTRIM("requestedByCode") <> '')
      AND ("requestedByName" IS NULL OR BTRIM("requestedByName") <> '')
      AND ("supervisorName" IS NULL OR BTRIM("supervisorName") <> '')
      AND ("supervisorRemark" IS NULL OR BTRIM("supervisorRemark") <> '')
      AND ("replenishmentTaskNo" IS NULL OR BTRIM("replenishmentTaskNo") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionReplenishmentRequest_source_status_valid'
  ) THEN
    ALTER TABLE "ProductionReplenishmentRequest"
    ADD CONSTRAINT "ProductionReplenishmentRequest_source_status_valid"
    CHECK (
      "sourceType" = 'PRODUCTION_SCRAP'
      AND "status" IN ('PENDING', 'APPROVED', 'REJECTED')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionReplenishmentRequest_quantities_valid'
  ) THEN
    ALTER TABLE "ProductionReplenishmentRequest"
    ADD CONSTRAINT "ProductionReplenishmentRequest_quantities_valid"
    CHECK ("requestQuantity" > 0 AND "scrapQuantity" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionReplenishmentRequest_status_fields_consistent'
  ) THEN
    ALTER TABLE "ProductionReplenishmentRequest"
    ADD CONSTRAINT "ProductionReplenishmentRequest_status_fields_consistent"
    CHECK (
      (
        "status" = 'PENDING'
        AND "supervisorName" IS NULL
        AND "supervisorRemark" IS NULL
        AND "approvedAt" IS NULL
        AND "reviewedAt" IS NULL
        AND "replenishmentTaskNo" IS NULL
      )
      OR (
        "status" = 'APPROVED'
        AND "supervisorName" IS NOT NULL
        AND BTRIM("supervisorName") <> ''
        AND "approvedAt" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
        AND "replenishmentTaskNo" IS NOT NULL
        AND BTRIM("replenishmentTaskNo") <> ''
      )
      OR (
        "status" = 'REJECTED'
        AND "supervisorName" IS NOT NULL
        AND BTRIM("supervisorName") <> ''
        AND "supervisorRemark" IS NOT NULL
        AND BTRIM("supervisorRemark") <> ''
        AND "approvedAt" IS NULL
        AND "reviewedAt" IS NOT NULL
        AND "replenishmentTaskNo" IS NULL
      )
    );
  END IF;
END $$;
