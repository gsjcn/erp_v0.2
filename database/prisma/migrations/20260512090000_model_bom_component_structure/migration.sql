ALTER TABLE "ModelBomLine"
ADD COLUMN "lineType" TEXT NOT NULL DEFAULT 'PART',
ADD COLUMN "partCategory" TEXT,
ADD COLUMN "componentNo" TEXT,
ADD COLUMN "parentComponentNo" TEXT;

DROP INDEX IF EXISTS "ModelBomLine_bomId_materialId_key";

CREATE INDEX "ModelBomLine_bomId_materialId_idx" ON "ModelBomLine"("bomId", "materialId");
CREATE INDEX "ModelBomLine_bomId_lineType_sortOrder_idx" ON "ModelBomLine"("bomId", "lineType", "sortOrder");
CREATE INDEX "ModelBomLine_bomId_componentNo_idx" ON "ModelBomLine"("bomId", "componentNo");
CREATE INDEX "ModelBomLine_bomId_parentComponentNo_idx" ON "ModelBomLine"("bomId", "parentComponentNo");
