-- Material 默认工艺只保存人工维护的建议值；数据库层阻止空白字符串污染下单初始流程。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Material_default_process_route_not_blank'
  ) THEN
    ALTER TABLE "Material"
    ADD CONSTRAINT "Material_default_process_route_not_blank"
    CHECK ("defaultProcessRoute" IS NULL OR BTRIM("defaultProcessRoute") <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaterialImportRow_default_process_route_not_blank'
  ) THEN
    ALTER TABLE "MaterialImportRow"
    ADD CONSTRAINT "MaterialImportRow_default_process_route_not_blank"
    CHECK ("defaultProcessRoute" IS NULL OR BTRIM("defaultProcessRoute") <> '');
  END IF;
END $$;
