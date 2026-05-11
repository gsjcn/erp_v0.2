ALTER TABLE "OrderImportRow" ADD COLUMN IF NOT EXISTS "errorCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderImportRow" ADD COLUMN IF NOT EXISTS "warningCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "OrderImportRow"
SET
  "errorCount" = COALESCE((
    SELECT COUNT(*)::INTEGER
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof("OrderImportRow"."issues") = 'array' THEN "OrderImportRow"."issues"
        ELSE '[]'::jsonb
      END
    ) AS issue
    WHERE issue ->> 'severity' = 'ERROR'
  ), 0),
  "warningCount" = COALESCE((
    SELECT COUNT(*)::INTEGER
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof("OrderImportRow"."issues") = 'array' THEN "OrderImportRow"."issues"
        ELSE '[]'::jsonb
      END
    ) AS issue
    WHERE issue ->> 'severity' = 'WARNING'
  ), 0)
WHERE "issues" IS NOT NULL;
