-- BOM 是下单推荐基础资料，范围、组件结构、默认数量必须在数据库层保持稳定，不能被脏数据静默覆盖。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBom_identity_not_blank'
  ) THEN
    ALTER TABLE "ModelBom"
    ADD CONSTRAINT "ModelBom_identity_not_blank"
    CHECK (
      BTRIM("bomName") <> ''
      AND BTRIM("customerScopeMode") <> ''
      AND BTRIM("customerScopeKey") <> ''
      AND BTRIM("projectModelScopeKey") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBom_scope_mode_valid'
  ) THEN
    ALTER TABLE "ModelBom"
    ADD CONSTRAINT "ModelBom_scope_mode_valid"
    CHECK ("customerScopeMode" IN ('ALL', 'PRIVATE', 'SELECTED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBom_scope_keys_valid'
  ) THEN
    ALTER TABLE "ModelBom"
    ADD CONSTRAINT "ModelBom_scope_keys_valid"
    CHECK (
      (
        (
          "customerScopeMode" = 'ALL'
          AND "customerId" IS NULL
          AND "customerScopeKey" = 'ALL'
          AND "customerNameSnapshot" IS NULL
        )
        OR (
          "customerScopeMode" = 'PRIVATE'
          AND "customerId" IS NOT NULL
          AND "customerScopeKey" = "customerId"
          AND "customerNameSnapshot" IS NOT NULL
          AND BTRIM("customerNameSnapshot") <> ''
        )
        OR (
          "customerScopeMode" = 'SELECTED'
          AND "customerId" IS NULL
          AND "customerScopeKey" LIKE 'SELECTED:%'
          AND "customerNameSnapshot" IS NULL
        )
      )
      AND
      (
        (
          BTRIM("projectModel") = ''
          AND "projectModelScopeKey" = 'ALL'
        )
        OR (
          BTRIM("projectModel") <> ''
          AND "projectModelScopeKey" = UPPER(BTRIM("projectModel"))
        )
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBom_common_sort_valid'
  ) THEN
    ALTER TABLE "ModelBom"
    ADD CONSTRAINT "ModelBom_common_sort_valid"
    CHECK (
      ("isCommon" = false AND "commonSortOrder" IS NULL)
      OR ("isCommon" = true AND "commonSortOrder" IS NOT NULL AND "commonSortOrder" > 0)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBom_optional_text_not_blank'
  ) THEN
    ALTER TABLE "ModelBom"
    ADD CONSTRAINT "ModelBom_optional_text_not_blank"
    CHECK (
      ("customerNameSnapshot" IS NULL OR BTRIM("customerNameSnapshot") <> '')
      AND ("sourceBomNameSnapshot" IS NULL OR BTRIM("sourceBomNameSnapshot") <> '')
      AND ("remark" IS NULL OR BTRIM("remark") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomCustomerScope_identity_not_blank'
  ) THEN
    ALTER TABLE "ModelBomCustomerScope"
    ADD CONSTRAINT "ModelBomCustomerScope_identity_not_blank"
    CHECK (
      BTRIM("bomId") <> ''
      AND BTRIM("customerId") <> ''
      AND "customerNameSnapshot" IS NOT NULL
      AND BTRIM("customerNameSnapshot") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomLine_identity_not_blank'
  ) THEN
    ALTER TABLE "ModelBomLine"
    ADD CONSTRAINT "ModelBomLine_identity_not_blank"
    CHECK (
      BTRIM("bomId") <> ''
      AND BTRIM("materialId") <> ''
      AND BTRIM("partCodeSnapshot") <> ''
      AND BTRIM("partNameSnapshot") <> ''
      AND BTRIM("unitSnapshot") <> ''
      AND BTRIM("lineType") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomLine_type_valid'
  ) THEN
    ALTER TABLE "ModelBomLine"
    ADD CONSTRAINT "ModelBomLine_type_valid"
    CHECK ("lineType" IN ('PART', 'COMPONENT'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomLine_quantities_valid'
  ) THEN
    ALTER TABLE "ModelBomLine"
    ADD CONSTRAINT "ModelBomLine_quantities_valid"
    CHECK (
      "defaultQuantity" > 0
      AND ("partThicknessSnapshot" IS NULL OR "partThicknessSnapshot" >= 0)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomLine_optional_text_not_blank'
  ) THEN
    ALTER TABLE "ModelBomLine"
    ADD CONSTRAINT "ModelBomLine_optional_text_not_blank"
    CHECK (
      ("partSpecificationSnapshot" IS NULL OR BTRIM("partSpecificationSnapshot") <> '')
      AND ("partCategory" IS NULL OR BTRIM("partCategory") <> '')
      AND ("componentNo" IS NULL OR BTRIM("componentNo") <> '')
      AND ("parentComponentNo" IS NULL OR BTRIM("parentComponentNo") <> '')
      AND ("defaultProcessRoute" IS NULL OR BTRIM("defaultProcessRoute") <> '')
      AND ("remark" IS NULL OR BTRIM("remark") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomLine_component_shape_valid'
  ) THEN
    ALTER TABLE "ModelBomLine"
    ADD CONSTRAINT "ModelBomLine_component_shape_valid"
    CHECK (
      (
        "lineType" = 'COMPONENT'
        AND "componentNo" IS NOT NULL
        AND BTRIM("componentNo") <> ''
        AND "parentComponentNo" IS NULL
        AND "partThicknessSnapshot" IS NULL
      )
      OR
      (
        "lineType" = 'PART'
        AND "componentNo" IS NULL
      )
    );
  END IF;
END $$;
