-- 订单组件编号允许 C001-C9999，也允许不以 C+纯数字表示的业务自定义编号；组件行厚度统一保存为 0。
DO $$
BEGIN
  ALTER TABLE "OrderLine" DROP CONSTRAINT IF EXISTS "OrderLine_component_shape_valid";
  ALTER TABLE "OrderLine"
    ADD CONSTRAINT "OrderLine_component_shape_valid"
    CHECK (
      (
        "lineType" = 'COMPONENT'
        AND "componentNo" IS NOT NULL
        AND BTRIM("componentNo") <> ''
        AND (
          UPPER(BTRIM("componentNo")) !~ '^C[0-9]+$'
          OR UPPER(BTRIM("componentNo")) ~ '^C(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2}|[1-9][0-9]{3})$'
        )
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
            BTRIM("parentComponentNo") <> ''
            AND (
              UPPER(BTRIM("parentComponentNo")) !~ '^C[0-9]+$'
              OR UPPER(BTRIM("parentComponentNo")) ~ '^C(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2}|[1-9][0-9]{3})$'
            )
          )
        )
      )
    );
END $$;
