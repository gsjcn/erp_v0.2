ALTER TABLE "MaterialImportFile"
ADD COLUMN "materialRowCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "scopeRowCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "transformRowCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "MaterialImportFile" SET "materialRowCount" = "rowCount";

CREATE TABLE "MaterialApplicabilityImportRow" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sourceRowNo" INTEGER NOT NULL,
    "rowHash" TEXT NOT NULL,
    "partCode" TEXT NOT NULL,
    "customerCode" TEXT,
    "customerName" TEXT,
    "projectModel" TEXT,
    "remark" TEXT,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "raw" JSONB NOT NULL,
    "issues" JSONB,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialApplicabilityImportRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaterialTransformImportRow" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sourceRowNo" INTEGER NOT NULL,
    "rowHash" TEXT NOT NULL,
    "sourcePartCode" TEXT NOT NULL,
    "targetPartCode" TEXT NOT NULL,
    "customerCode" TEXT,
    "customerName" TEXT,
    "projectModel" TEXT,
    "multiplier" DECIMAL(18,3),
    "lossRate" DECIMAL(18,4),
    "defaultProcessRoute" TEXT,
    "conversionDescription" TEXT,
    "remark" TEXT,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "raw" JSONB NOT NULL,
    "issues" JSONB,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialTransformImportRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialApplicabilityImportRow_sessionId_idx" ON "MaterialApplicabilityImportRow"("sessionId");
CREATE INDEX "MaterialApplicabilityImportRow_fileId_idx" ON "MaterialApplicabilityImportRow"("fileId");
CREATE INDEX "MaterialApplicabilityImportRow_partCode_idx" ON "MaterialApplicabilityImportRow"("partCode");
CREATE UNIQUE INDEX "MaterialApplicabilityImportRow_sessionId_rowHash_key" ON "MaterialApplicabilityImportRow"("sessionId", "rowHash");

CREATE INDEX "MaterialTransformImportRow_sessionId_idx" ON "MaterialTransformImportRow"("sessionId");
CREATE INDEX "MaterialTransformImportRow_fileId_idx" ON "MaterialTransformImportRow"("fileId");
CREATE INDEX "MaterialTransformImportRow_sourcePartCode_idx" ON "MaterialTransformImportRow"("sourcePartCode");
CREATE INDEX "MaterialTransformImportRow_targetPartCode_idx" ON "MaterialTransformImportRow"("targetPartCode");
CREATE UNIQUE INDEX "MaterialTransformImportRow_sessionId_rowHash_key" ON "MaterialTransformImportRow"("sessionId", "rowHash");

ALTER TABLE "MaterialApplicabilityImportRow"
ADD CONSTRAINT "MaterialApplicabilityImportRow_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "MaterialImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialApplicabilityImportRow"
ADD CONSTRAINT "MaterialApplicabilityImportRow_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "MaterialImportFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialTransformImportRow"
ADD CONSTRAINT "MaterialTransformImportRow_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "MaterialImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialTransformImportRow"
ADD CONSTRAINT "MaterialTransformImportRow_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "MaterialImportFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
