-- BOM 差异核对记录只保存人工确认结果，不会自动覆盖来源 BOM 或客户 BOM 明细。
CREATE TABLE "ModelBomDiffReview" (
    "id" TEXT NOT NULL,
    "targetBomId" TEXT NOT NULL,
    "sourceBomId" TEXT NOT NULL,
    "reviewKey" TEXT NOT NULL,
    "issueKind" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "targetLineId" TEXT,
    "issueTitle" TEXT NOT NULL,
    "issueDetail" TEXT,
    "diffFingerprint" TEXT NOT NULL,
    "fieldsJson" JSONB,
    "reviewedBy" TEXT,
    "reviewRemark" TEXT,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelBomDiffReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelBomDiffReview_reviewKey_key" ON "ModelBomDiffReview"("reviewKey");
CREATE INDEX "ModelBomDiffReview_targetBomId_sourceBomId_idx" ON "ModelBomDiffReview"("targetBomId", "sourceBomId");
CREATE INDEX "ModelBomDiffReview_targetBomId_status_idx" ON "ModelBomDiffReview"("targetBomId", "status");
CREATE INDEX "ModelBomDiffReview_sourceBomId_idx" ON "ModelBomDiffReview"("sourceBomId");
CREATE INDEX "ModelBomDiffReview_sourceLineId_idx" ON "ModelBomDiffReview"("sourceLineId");
CREATE INDEX "ModelBomDiffReview_targetLineId_idx" ON "ModelBomDiffReview"("targetLineId");
CREATE INDEX "ModelBomDiffReview_reviewedAt_idx" ON "ModelBomDiffReview"("reviewedAt");
