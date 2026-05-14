-- BOM 差异核对记录只做人工追溯；补充外键避免孤立核对记录污染后续差异判断。
DELETE FROM "ModelBomDiffReview" review
WHERE NOT EXISTS (SELECT 1 FROM "ModelBom" bom WHERE bom."id" = review."targetBomId")
   OR NOT EXISTS (SELECT 1 FROM "ModelBom" bom WHERE bom."id" = review."sourceBomId");

UPDATE "ModelBomDiffReview" review
SET "sourceLineId" = NULL
WHERE review."sourceLineId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ModelBomLine" line WHERE line."id" = review."sourceLineId");

UPDATE "ModelBomDiffReview" review
SET "targetLineId" = NULL
WHERE review."targetLineId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ModelBomLine" line WHERE line."id" = review."targetLineId");

ALTER TABLE "ModelBomDiffReview"
  ADD CONSTRAINT "ModelBomDiffReview_targetBomId_fkey"
  FOREIGN KEY ("targetBomId") REFERENCES "ModelBom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelBomDiffReview"
  ADD CONSTRAINT "ModelBomDiffReview_sourceBomId_fkey"
  FOREIGN KEY ("sourceBomId") REFERENCES "ModelBom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelBomDiffReview"
  ADD CONSTRAINT "ModelBomDiffReview_sourceLineId_fkey"
  FOREIGN KEY ("sourceLineId") REFERENCES "ModelBomLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModelBomDiffReview"
  ADD CONSTRAINT "ModelBomDiffReview_targetLineId_fkey"
  FOREIGN KEY ("targetLineId") REFERENCES "ModelBomLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
