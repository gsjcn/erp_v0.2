-- 客户零件包常用标记：只影响页面优先显示和下单推荐排序，不改变 BOM 适用范围、明细、订单、生产或库存。
ALTER TABLE "ModelBom"
ADD COLUMN IF NOT EXISTS "isCommon" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "commonSortOrder" INTEGER;

CREATE INDEX IF NOT EXISTS "ModelBom_isCommon_commonSortOrder_idx"
ON "ModelBom"("isCommon", "commonSortOrder");
