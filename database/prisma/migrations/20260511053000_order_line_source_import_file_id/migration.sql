ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "sourceImportFileId" TEXT;

UPDATE "OrderLine" AS line
SET "sourceImportFileId" = matched."fileId"
FROM (
  SELECT DISTINCT ON (line_inner."id")
    line_inner."id" AS "lineId",
    row."fileId"
  FROM "OrderLine" AS line_inner
  JOIN "OrderImportRow" AS row
    ON row."sessionId" = line_inner."sourceImportSessionId"
   AND row."sourceRowNo" = line_inner."sourceImportRowNo"
   AND UPPER(COALESCE(row."partCode", '')) = UPPER(COALESCE(line_inner."partCode", ''))
   AND UPPER(COALESCE(row."drawingNo", '')) = UPPER(COALESCE(line_inner."drawingNo", ''))
   AND COALESCE(row."partName", '') = COALESCE(line_inner."partName", '')
  JOIN "OrderImportFile" AS file
    ON file."id" = row."fileId"
  WHERE line_inner."sourceImportFileId" IS NULL
    AND line_inner."sourceImportSessionId" IS NOT NULL
    AND line_inner."sourceImportRowNo" IS NOT NULL
    AND (
      line_inner."sourceImportFileName" IS NULL
      OR line_inner."sourceImportFileName" = file."fileName"
    )
  ORDER BY line_inner."id", row."sourceRowNo" ASC
) AS matched
WHERE line."id" = matched."lineId";

CREATE INDEX IF NOT EXISTS "OrderLine_sourceImportFileId_idx" ON "OrderLine"("sourceImportFileId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OrderLine_sourceImportFileId_fkey'
  ) THEN
    ALTER TABLE "OrderLine"
      ADD CONSTRAINT "OrderLine_sourceImportFileId_fkey"
      FOREIGN KEY ("sourceImportFileId")
      REFERENCES "OrderImportFile"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
