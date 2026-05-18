-- 取消订单会把历史 OrderLine.quantity 置为 0 以保留明细但停止履约；数据库只禁止负数。
ALTER TABLE "OrderLine" DROP CONSTRAINT IF EXISTS "OrderLine_quantities_valid";

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_quantities_valid"
CHECK (
  "lineNo" > 0
  AND "quantity" >= 0
  AND "productionPlanQuantity" >= 0
  AND ("productionPlanSuggestedQuantity" IS NULL OR "productionPlanSuggestedQuantity" >= 0)
  AND "partThickness" >= 0
);
