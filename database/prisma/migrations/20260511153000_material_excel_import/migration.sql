-- 零件基础库 Excel 导入会话。只写入 Material 主数据，不创建订单、库存或生产任务。
CREATE TABLE "MaterialImportSession" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT,
    "committedAt" TIMESTAMP(3),
    "committedMaterialCodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialImportSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaterialImportFile" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedFileName" TEXT,
    "fileHash" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedRowCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateRowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialImportFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaterialImportRow" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sourceRowNo" INTEGER NOT NULL,
    "rowHash" TEXT NOT NULL,
    "partCode" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "partSpecification" TEXT,
    "drawingNo" TEXT,
    "drawingVersion" TEXT,
    "drawingDate" TIMESTAMP(3),
    "drawingStatus" TEXT,
    "partThickness" DECIMAL(18,3),
    "projectModel" TEXT,
    "remark" TEXT,
    "raw" JSONB NOT NULL,
    "issues" JSONB,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialImportRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialImportSession_status_idx" ON "MaterialImportSession"("status");
CREATE INDEX "MaterialImportSession_createdAt_idx" ON "MaterialImportSession"("createdAt");
CREATE INDEX "MaterialImportFile_sessionId_idx" ON "MaterialImportFile"("sessionId");
CREATE INDEX "MaterialImportFile_fileHash_idx" ON "MaterialImportFile"("fileHash");
CREATE UNIQUE INDEX "MaterialImportFile_sessionId_fileHash_key" ON "MaterialImportFile"("sessionId", "fileHash");
CREATE INDEX "MaterialImportRow_sessionId_idx" ON "MaterialImportRow"("sessionId");
CREATE INDEX "MaterialImportRow_fileId_idx" ON "MaterialImportRow"("fileId");
CREATE INDEX "MaterialImportRow_partCode_idx" ON "MaterialImportRow"("partCode");
CREATE UNIQUE INDEX "MaterialImportRow_sessionId_rowHash_key" ON "MaterialImportRow"("sessionId", "rowHash");

ALTER TABLE "MaterialImportFile"
ADD CONSTRAINT "MaterialImportFile_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "MaterialImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialImportRow"
ADD CONSTRAINT "MaterialImportRow_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "MaterialImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialImportRow"
ADD CONSTRAINT "MaterialImportRow_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "MaterialImportFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
