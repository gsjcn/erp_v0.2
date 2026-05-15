-- 零件库导入预览必须保存业务错误行，由 issues 明细提示人工修正，不能被数据库约束提前拦截。
DO $$
BEGIN
  ALTER TABLE "MaterialImportRow" DROP CONSTRAINT IF EXISTS "MaterialImportRow_identity_not_blank";
  ALTER TABLE "MaterialImportRow" DROP CONSTRAINT IF EXISTS "MaterialImportRow_trace_identity_not_blank";
  ALTER TABLE "MaterialImportRow"
    ADD CONSTRAINT "MaterialImportRow_trace_identity_not_blank"
    CHECK (
      BTRIM("sessionId") <> ''
      AND BTRIM("fileId") <> ''
      AND BTRIM("rowHash") <> ''
    );

  ALTER TABLE "MaterialImportRow" DROP CONSTRAINT IF EXISTS "MaterialImportRow_values_valid";
  ALTER TABLE "MaterialImportRow"
    ADD CONSTRAINT "MaterialImportRow_values_valid"
    CHECK (
      "sourceRowNo" > 0
      AND "errorCount" >= 0
      AND "warningCount" >= 0
      AND jsonb_typeof("raw") = 'object'
      AND ("issues" IS NULL OR jsonb_typeof("issues") = 'array')
    );

  ALTER TABLE "MaterialApplicabilityImportRow" DROP CONSTRAINT IF EXISTS "MaterialApplicabilityImportRow_identity_not_blank";
  ALTER TABLE "MaterialApplicabilityImportRow" DROP CONSTRAINT IF EXISTS "MaterialApplicabilityImportRow_trace_identity_not_blank";
  ALTER TABLE "MaterialApplicabilityImportRow"
    ADD CONSTRAINT "MaterialApplicabilityImportRow_trace_identity_not_blank"
    CHECK (
      BTRIM("sessionId") <> ''
      AND BTRIM("fileId") <> ''
      AND BTRIM("rowHash") <> ''
    );

  ALTER TABLE "MaterialTransformImportRow" DROP CONSTRAINT IF EXISTS "MaterialTransformImportRow_identity_not_blank";
  ALTER TABLE "MaterialTransformImportRow" DROP CONSTRAINT IF EXISTS "MaterialTransformImportRow_trace_identity_not_blank";
  ALTER TABLE "MaterialTransformImportRow"
    ADD CONSTRAINT "MaterialTransformImportRow_trace_identity_not_blank"
    CHECK (
      BTRIM("sessionId") <> ''
      AND BTRIM("fileId") <> ''
      AND BTRIM("rowHash") <> ''
    );

  ALTER TABLE "MaterialTransformImportRow" DROP CONSTRAINT IF EXISTS "MaterialTransformImportRow_values_valid";
  ALTER TABLE "MaterialTransformImportRow"
    ADD CONSTRAINT "MaterialTransformImportRow_values_valid"
    CHECK (
      "sourceRowNo" > 0
      AND "status" IN ('ENABLED', 'DISABLED')
      AND "errorCount" >= 0
      AND "warningCount" >= 0
      AND jsonb_typeof("raw") = 'object'
      AND ("issues" IS NULL OR jsonb_typeof("issues") = 'array')
    );
END $$;
