ALTER TABLE "ModelBom"
ADD COLUMN "sourceBomId" TEXT,
ADD COLUMN "sourceBomNameSnapshot" TEXT;

CREATE INDEX "ModelBom_sourceBomId_idx" ON "ModelBom"("sourceBomId");
