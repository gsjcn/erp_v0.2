-- 零件基础资料只保存身份和推荐规则，不保存库存数量；基础字段和适用范围 key 必须稳定可追溯。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Material_identity_not_blank'
  ) THEN
    ALTER TABLE "Material"
    ADD CONSTRAINT "Material_identity_not_blank"
    CHECK (
      BTRIM("partCode") <> ''
      AND BTRIM("partName") <> ''
      AND BTRIM("unit") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Material_optional_text_not_blank'
  ) THEN
    ALTER TABLE "Material"
    ADD CONSTRAINT "Material_optional_text_not_blank"
    CHECK ("partSpecification" IS NULL OR BTRIM("partSpecification") <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Material_stock_alert_valid'
  ) THEN
    ALTER TABLE "Material"
    ADD CONSTRAINT "Material_stock_alert_valid"
    CHECK (
      ("stockAlertQuantity" IS NULL OR "stockAlertQuantity" >= 0)
      AND ("stockAlertEnabled" = false OR "stockAlertQuantity" IS NOT NULL)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialApplicability_identity_not_blank'
  ) THEN
    ALTER TABLE "MaterialApplicability"
    ADD CONSTRAINT "MaterialApplicability_identity_not_blank"
    CHECK (
      BTRIM("materialId") <> ''
      AND BTRIM("customerScopeKey") <> ''
      AND BTRIM("projectModelScopeKey") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialApplicability_optional_text_not_blank'
  ) THEN
    ALTER TABLE "MaterialApplicability"
    ADD CONSTRAINT "MaterialApplicability_optional_text_not_blank"
    CHECK (
      ("customerNameSnapshot" IS NULL OR BTRIM("customerNameSnapshot") <> '')
      AND ("projectModel" IS NULL OR BTRIM("projectModel") <> '')
      AND ("remark" IS NULL OR BTRIM("remark") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialApplicability_scope_keys_valid'
  ) THEN
    ALTER TABLE "MaterialApplicability"
    ADD CONSTRAINT "MaterialApplicability_scope_keys_valid"
    CHECK (
      (
        (
          "customerId" IS NULL
          AND "customerScopeKey" = 'ALL'
          AND "customerNameSnapshot" IS NULL
        )
        OR (
          "customerId" IS NOT NULL
          AND "customerScopeKey" = "customerId"
          AND "customerNameSnapshot" IS NOT NULL
          AND BTRIM("customerNameSnapshot") <> ''
        )
      )
      AND
      (
        (
          "projectModel" IS NULL
          AND "projectModelScopeKey" = 'ALL'
        )
        OR (
          "projectModel" IS NOT NULL
          AND "projectModelScopeKey" = UPPER(BTRIM("projectModel"))
        )
      )
    );
  END IF;
END $$;
