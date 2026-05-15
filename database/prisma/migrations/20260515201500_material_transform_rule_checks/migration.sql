-- 来源加工关系只提供库存来源建议，不自动扣库存；规则身份、范围 key 和倍率必须稳定可校验。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialTransformRule_identity_not_blank'
  ) THEN
    ALTER TABLE "MaterialTransformRule"
    ADD CONSTRAINT "MaterialTransformRule_identity_not_blank"
    CHECK (
      BTRIM("sourceMaterialId") <> ''
      AND BTRIM("targetMaterialId") <> ''
      AND BTRIM("customerScopeKey") <> ''
      AND BTRIM("projectModelScopeKey") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialTransformRule_source_target_distinct'
  ) THEN
    ALTER TABLE "MaterialTransformRule"
    ADD CONSTRAINT "MaterialTransformRule_source_target_distinct"
    CHECK ("sourceMaterialId" <> "targetMaterialId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialTransformRule_quantities_valid'
  ) THEN
    ALTER TABLE "MaterialTransformRule"
    ADD CONSTRAINT "MaterialTransformRule_quantities_valid"
    CHECK (
      "multiplier" > 0
      AND ("lossRate" IS NULL OR "lossRate" >= 0)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialTransformRule_optional_text_not_blank'
  ) THEN
    ALTER TABLE "MaterialTransformRule"
    ADD CONSTRAINT "MaterialTransformRule_optional_text_not_blank"
    CHECK (
      ("customerNameSnapshot" IS NULL OR BTRIM("customerNameSnapshot") <> '')
      AND ("projectModel" IS NULL OR BTRIM("projectModel") <> '')
      AND ("conversionDescription" IS NULL OR BTRIM("conversionDescription") <> '')
      AND ("defaultProcessRoute" IS NULL OR BTRIM("defaultProcessRoute") <> '')
      AND ("remark" IS NULL OR BTRIM("remark") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialTransformRule_scope_keys_valid'
  ) THEN
    ALTER TABLE "MaterialTransformRule"
    ADD CONSTRAINT "MaterialTransformRule_scope_keys_valid"
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
