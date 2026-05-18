-- 订单导入行必须保留图纸版本快照，供订单草稿、零件库草稿和 BOM 草稿人工核对；不创建订单、生产任务或库存流水。
ALTER TABLE "OrderImportRow"
ADD COLUMN IF NOT EXISTS "drawingVersion" TEXT;

ALTER TABLE "OrderImportRow"
DROP CONSTRAINT IF EXISTS "OrderImportRow_optional_text_not_blank";

ALTER TABLE "OrderImportRow"
ADD CONSTRAINT "OrderImportRow_optional_text_not_blank"
CHECK (
  ("orderBlock" IS NULL OR BTRIM("orderBlock") <> '')
  AND ("projectModel" IS NULL OR BTRIM("projectModel") <> '')
  AND ("importSequence" IS NULL OR BTRIM("importSequence") <> '')
  AND ("partCategory" IS NULL OR BTRIM("partCategory") <> '')
  AND ("componentNo" IS NULL OR BTRIM("componentNo") <> '')
  AND ("parentComponentNo" IS NULL OR BTRIM("parentComponentNo") <> '')
  AND ("drawingNo" IS NULL OR BTRIM("drawingNo") <> '')
  AND ("drawingVersion" IS NULL OR BTRIM("drawingVersion") <> '')
  AND ("partSpecification" IS NULL OR BTRIM("partSpecification") <> '')
  AND ("processRoute" IS NULL OR BTRIM("processRoute") <> '')
  AND ("processRemark" IS NULL OR BTRIM("processRemark") <> '')
  AND ("drawingStatus" IS NULL OR BTRIM("drawingStatus") <> '')
);
