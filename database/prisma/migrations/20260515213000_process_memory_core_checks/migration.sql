-- 标准工序和流程记忆是订单生产流程的基础资料；数据库层兜底禁止空名称、空备注和无效步骤结构。
UPDATE "ProcessDefinition"
SET "remark" = NULL
WHERE "remark" IS NOT NULL
  AND BTRIM("remark") = '';

UPDATE "ProcessTemplate"
SET "remark" = NULL
WHERE "remark" IS NOT NULL
  AND BTRIM("remark") = '';

UPDATE "ProcessTemplate"
SET "searchText" = ''
WHERE "status" = 'DISABLED'
  AND "searchText" <> '';

UPDATE "ProcessTemplate"
SET "templateNameNormalized" = 'disabled:' || "id" || ':' || COALESCE(NULLIF(BTRIM("templateNameNormalized"), ''), 'unnamed')
WHERE "status" = 'DISABLED'
  AND "templateNameNormalized" NOT LIKE ('disabled:' || "id" || ':%');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProcessDefinition_identity_not_blank'
  ) THEN
    ALTER TABLE "ProcessDefinition"
    ADD CONSTRAINT "ProcessDefinition_identity_not_blank"
    CHECK (
      BTRIM("processName") <> ''
      AND "processName" = BTRIM("processName")
      AND BTRIM("processNameNormalized") <> ''
      AND "processNameNormalized" = BTRIM("processNameNormalized")
      AND BTRIM("searchText") <> ''
      AND "searchText" = BTRIM("searchText")
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProcessDefinition_optional_text_not_blank'
  ) THEN
    ALTER TABLE "ProcessDefinition"
    ADD CONSTRAINT "ProcessDefinition_optional_text_not_blank"
    CHECK ("remark" IS NULL OR BTRIM("remark") <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProcessTemplate_identity_not_blank'
  ) THEN
    ALTER TABLE "ProcessTemplate"
    ADD CONSTRAINT "ProcessTemplate_identity_not_blank"
    CHECK (
      BTRIM("templateName") <> ''
      AND "templateName" = BTRIM("templateName")
      AND BTRIM("templateNameNormalized") <> ''
      AND "templateNameNormalized" = BTRIM("templateNameNormalized")
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProcessTemplate_status_search_consistent'
  ) THEN
    ALTER TABLE "ProcessTemplate"
    ADD CONSTRAINT "ProcessTemplate_status_search_consistent"
    CHECK (
      (
        "status" = 'ENABLED'
        AND BTRIM("searchText") <> ''
        AND "searchText" = BTRIM("searchText")
        AND "templateNameNormalized" NOT LIKE 'disabled:%'
      )
      OR (
        "status" = 'DISABLED'
        AND "searchText" = ''
        AND "templateNameNormalized" LIKE ('disabled:' || "id" || ':%')
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProcessTemplate_steps_array_not_empty'
  ) THEN
    ALTER TABLE "ProcessTemplate"
    ADD CONSTRAINT "ProcessTemplate_steps_array_not_empty"
    CHECK (jsonb_typeof("steps") = 'array' AND jsonb_array_length("steps") > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProcessTemplate_optional_text_not_blank'
  ) THEN
    ALTER TABLE "ProcessTemplate"
    ADD CONSTRAINT "ProcessTemplate_optional_text_not_blank"
    CHECK ("remark" IS NULL OR BTRIM("remark") <> '');
  END IF;
END $$;
