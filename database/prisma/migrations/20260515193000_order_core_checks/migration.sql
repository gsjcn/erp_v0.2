-- 订单和订单明细是生产、仓库、库存追溯源头，基础身份字段和数量字段必须在数据库层保护。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerOrder_identity_not_blank'
  ) THEN
    ALTER TABLE "CustomerOrder"
    ADD CONSTRAINT "CustomerOrder_identity_not_blank"
    CHECK (
      BTRIM("orderNo") <> ''
      AND BTRIM("customerId") <> ''
      AND BTRIM("customerCode") <> ''
      AND BTRIM("customerName") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerOrder_order_no_normalized'
  ) THEN
    ALTER TABLE "CustomerOrder"
    ADD CONSTRAINT "CustomerOrder_order_no_normalized"
    CHECK ("orderNo" = UPPER(BTRIM("orderNo")));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerOrder_customer_snapshot_shape'
  ) THEN
    ALTER TABLE "CustomerOrder"
    ADD CONSTRAINT "CustomerOrder_customer_snapshot_shape"
    CHECK (jsonb_typeof("customerSnapshot") = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderLine_required_text_not_blank'
  ) THEN
    ALTER TABLE "OrderLine"
    ADD CONSTRAINT "OrderLine_required_text_not_blank"
    CHECK (
      BTRIM("orderId") <> ''
      AND BTRIM("partCode") <> ''
      AND BTRIM("partName") <> ''
      AND BTRIM("unit") <> ''
      AND BTRIM("lineType") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderLine_quantities_valid'
  ) THEN
    ALTER TABLE "OrderLine"
    ADD CONSTRAINT "OrderLine_quantities_valid"
    CHECK (
      "lineNo" > 0
      AND "quantity" > 0
      AND "productionPlanQuantity" >= 0
      AND ("productionPlanSuggestedQuantity" IS NULL OR "productionPlanSuggestedQuantity" >= 0)
      AND "partThickness" >= 0
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderLine_optional_text_not_blank'
  ) THEN
    ALTER TABLE "OrderLine"
    ADD CONSTRAINT "OrderLine_optional_text_not_blank"
    CHECK (
      ("drawingNo" IS NULL OR BTRIM("drawingNo") <> '')
      AND ("drawingVersion" IS NULL OR BTRIM("drawingVersion") <> '')
      AND ("drawingFileName" IS NULL OR BTRIM("drawingFileName") <> '')
      AND ("drawingFileUrl" IS NULL OR BTRIM("drawingFileUrl") <> '')
      AND ("partSpecification" IS NULL OR BTRIM("partSpecification") <> '')
      AND ("componentNo" IS NULL OR BTRIM("componentNo") <> '')
      AND ("parentComponentNo" IS NULL OR BTRIM("parentComponentNo") <> '')
      AND ("sourceImportSessionId" IS NULL OR BTRIM("sourceImportSessionId") <> '')
      AND ("sourceImportFileId" IS NULL OR BTRIM("sourceImportFileId") <> '')
      AND ("sourceImportFileName" IS NULL OR BTRIM("sourceImportFileName") <> '')
      AND ("projectModel" IS NULL OR BTRIM("projectModel") <> '')
      AND ("drawingStatus" IS NULL OR BTRIM("drawingStatus") <> '')
      AND ("productionPlanOverrideByCode" IS NULL OR BTRIM("productionPlanOverrideByCode") <> '')
      AND ("productionPlanOverrideByName" IS NULL OR BTRIM("productionPlanOverrideByName") <> '')
      AND ("productionPlanOverrideByRole" IS NULL OR BTRIM("productionPlanOverrideByRole") <> '')
      AND ("productionPlanOverrideReason" IS NULL OR BTRIM("productionPlanOverrideReason") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderLine_component_shape_valid'
  ) THEN
    ALTER TABLE "OrderLine"
    ADD CONSTRAINT "OrderLine_component_shape_valid"
    CHECK (
      (
        "lineType" = 'COMPONENT'
        AND "componentNo" IS NOT NULL
        AND UPPER(BTRIM("componentNo")) ~ '^C([0-9]{3}|[1-9][0-9]{3})$'
        AND CAST(SUBSTRING(UPPER(BTRIM("componentNo")) FROM 2) AS INTEGER) BETWEEN 1 AND 9999
        AND "parentComponentNo" IS NULL
        AND "partThickness" = 0
      )
      OR (
        "lineType" = 'PART'
        AND "componentNo" IS NULL
        AND "partThickness" > 0
        AND (
          "parentComponentNo" IS NULL
          OR (
            UPPER(BTRIM("parentComponentNo")) ~ '^C([0-9]{3}|[1-9][0-9]{3})$'
            AND CAST(SUBSTRING(UPPER(BTRIM("parentComponentNo")) FROM 2) AS INTEGER) BETWEEN 1 AND 9999
          )
        )
      )
    );
  END IF;
END $$;
