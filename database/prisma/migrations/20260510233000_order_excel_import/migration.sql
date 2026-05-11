-- Excel 组件/零件清单导入只创建订单草稿，不自动提交生产。

-- AlterTable
ALTER TABLE "OrderLine"
ADD COLUMN "lineType" TEXT NOT NULL DEFAULT 'PART',
ADD COLUMN "partCategory" TEXT,
ADD COLUMN "componentNo" TEXT,
ADD COLUMN "parentComponentNo" TEXT,
ADD COLUMN "importSequence" TEXT,
ADD COLUMN "sourceImportSessionId" TEXT,
ADD COLUMN "sourceImportFileName" TEXT,
ADD COLUMN "sourceImportRowNo" INTEGER,
ADD COLUMN "projectModel" TEXT,
ADD COLUMN "drawingDate" TIMESTAMP(3),
ADD COLUMN "drawingStatus" TEXT;

-- CreateTable
CREATE TABLE "OrderImportSession" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdBy" TEXT,
  "committedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderImportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderImportFile" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "sheetName" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "acceptedRowCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateRowCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderImportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderImportRow" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "sourceRowNo" INTEGER NOT NULL,
  "rowHash" TEXT NOT NULL,
  "orderBlock" TEXT,
  "orderNo" TEXT NOT NULL,
  "orderDate" TIMESTAMP(3) NOT NULL,
  "customerName" TEXT NOT NULL,
  "projectModel" TEXT,
  "lineType" TEXT NOT NULL,
  "importSequence" TEXT,
  "partCategory" TEXT,
  "componentNo" TEXT,
  "parentComponentNo" TEXT,
  "partCode" TEXT NOT NULL,
  "drawingNo" TEXT,
  "partName" TEXT NOT NULL,
  "partSpecification" TEXT,
  "partThickness" DECIMAL(18,3) NOT NULL DEFAULT 1,
  "orderQuantity" DECIMAL(18,3),
  "unitUsage" DECIMAL(18,3),
  "demandQuantity" DECIMAL(18,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "processRoute" TEXT,
  "processRemark" TEXT,
  "drawingDate" TIMESTAMP(3),
  "drawingStatus" TEXT,
  "raw" JSONB NOT NULL,
  "issues" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderLine_lineType_idx" ON "OrderLine"("lineType");

-- CreateIndex
CREATE INDEX "OrderLine_componentNo_idx" ON "OrderLine"("componentNo");

-- CreateIndex
CREATE INDEX "OrderLine_parentComponentNo_idx" ON "OrderLine"("parentComponentNo");

-- CreateIndex
CREATE INDEX "OrderLine_sourceImportSessionId_idx" ON "OrderLine"("sourceImportSessionId");

-- CreateIndex
CREATE INDEX "OrderImportSession_status_idx" ON "OrderImportSession"("status");

-- CreateIndex
CREATE INDEX "OrderImportSession_createdAt_idx" ON "OrderImportSession"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderImportFile_sessionId_fileHash_key" ON "OrderImportFile"("sessionId", "fileHash");

-- CreateIndex
CREATE INDEX "OrderImportFile_sessionId_idx" ON "OrderImportFile"("sessionId");

-- CreateIndex
CREATE INDEX "OrderImportFile_fileHash_idx" ON "OrderImportFile"("fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "OrderImportRow_sessionId_rowHash_key" ON "OrderImportRow"("sessionId", "rowHash");

-- CreateIndex
CREATE INDEX "OrderImportRow_sessionId_idx" ON "OrderImportRow"("sessionId");

-- CreateIndex
CREATE INDEX "OrderImportRow_fileId_idx" ON "OrderImportRow"("fileId");

-- CreateIndex
CREATE INDEX "OrderImportRow_orderNo_idx" ON "OrderImportRow"("orderNo");

-- CreateIndex
CREATE INDEX "OrderImportRow_componentNo_idx" ON "OrderImportRow"("componentNo");

-- CreateIndex
CREATE INDEX "OrderImportRow_parentComponentNo_idx" ON "OrderImportRow"("parentComponentNo");

-- AddForeignKey
ALTER TABLE "OrderImportFile"
ADD CONSTRAINT "OrderImportFile_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "OrderImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderImportRow"
ADD CONSTRAINT "OrderImportRow_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "OrderImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderImportRow"
ADD CONSTRAINT "OrderImportRow_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "OrderImportFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
