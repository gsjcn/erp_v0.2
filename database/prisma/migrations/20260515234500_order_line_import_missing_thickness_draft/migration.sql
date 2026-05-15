-- 订单 Excel 导入只能生成 DRAFT。缺厚度零件允许先保存为 0 待人工核对，提交生产时再强制拦截。
DO $$
BEGIN
  ALTER TABLE "OrderLine" DROP CONSTRAINT IF EXISTS "OrderLine_component_shape_valid";
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
        AND "partThickness" >= 0
        AND (
          "parentComponentNo" IS NULL
          OR (
            UPPER(BTRIM("parentComponentNo")) ~ '^C([0-9]{3}|[1-9][0-9]{3})$'
            AND CAST(SUBSTRING(UPPER(BTRIM("parentComponentNo")) FROM 2) AS INTEGER) BETWEEN 1 AND 9999
          )
        )
      )
    );
END $$;
