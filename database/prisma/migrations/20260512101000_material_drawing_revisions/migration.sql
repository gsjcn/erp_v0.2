-- 零件图纸版本只维护基础资料和下单快照来源，不生成订单、生产任务或库存流水。
CREATE TABLE "MaterialDrawingRevision" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "drawingNo" TEXT NOT NULL,
    "drawingVersion" TEXT NOT NULL,
    "drawingDate" TIMESTAMP(3),
    "drawingStatus" TEXT,
    "drawingFileName" TEXT,
    "drawingFileUrl" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "defaultChangedBy" TEXT,
    "defaultChangedAt" TIMESTAMP(3),
    "remark" TEXT,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialDrawingRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ModelBomLine"
ADD COLUMN "defaultDrawingRevisionId" TEXT,
ADD COLUMN "defaultProcessRoute" TEXT;

CREATE UNIQUE INDEX "MaterialDrawingRevision_materialId_drawingNo_drawingVersion_key"
ON "MaterialDrawingRevision"("materialId", "drawingNo", "drawingVersion");

CREATE INDEX "MaterialDrawingRevision_materialId_isDefault_idx"
ON "MaterialDrawingRevision"("materialId", "isDefault");

CREATE INDEX "MaterialDrawingRevision_materialId_drawingDate_idx"
ON "MaterialDrawingRevision"("materialId", "drawingDate");

CREATE INDEX "MaterialDrawingRevision_drawingNo_idx"
ON "MaterialDrawingRevision"("drawingNo");

CREATE INDEX "MaterialDrawingRevision_status_idx"
ON "MaterialDrawingRevision"("status");

CREATE INDEX "ModelBomLine_defaultDrawingRevisionId_idx"
ON "ModelBomLine"("defaultDrawingRevisionId");

ALTER TABLE "MaterialDrawingRevision"
ADD CONSTRAINT "MaterialDrawingRevision_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelBomLine"
ADD CONSTRAINT "ModelBomLine_defaultDrawingRevisionId_fkey"
FOREIGN KEY ("defaultDrawingRevisionId") REFERENCES "MaterialDrawingRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
