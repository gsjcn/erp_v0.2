-- Material 默认工艺只作为后续下单初始建议；不生成订单、生产任务或库存流水。
ALTER TABLE "Material" ADD COLUMN "defaultProcessRoute" TEXT;

-- 零件库导入行保留默认工艺草稿，提交时仍重新校验标准工序库。
ALTER TABLE "MaterialImportRow" ADD COLUMN "defaultProcessRoute" TEXT;
