CREATE TYPE "ProductionNoticeType" AS ENUM ('QUANTITY_INCREASE', 'QUANTITY_DECREASE', 'ORDER_CANCELLED', 'MATERIAL_ADDED', 'TASK_WITHDRAWN');
CREATE TYPE "ProductionNoticeStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED');

CREATE TABLE "ProductionNotice" (
    "id" TEXT NOT NULL,
    "noticeNo" TEXT NOT NULL,
    "noticeType" "ProductionNoticeType" NOT NULL,
    "status" "ProductionNoticeStatus" NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT,
    "orderNo" TEXT NOT NULL,
    "orderLineId" TEXT,
    "productionTaskId" TEXT,
    "productionTaskNo" TEXT,
    "partCode" TEXT,
    "partName" TEXT,
    "beforeQuantity" DECIMAL(18,3),
    "afterQuantity" DECIMAL(18,3),
    "deltaQuantity" DECIMAL(18,3),
    "unit" TEXT,
    "reason" TEXT NOT NULL,
    "managerName" TEXT,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionNotice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionScrapRecord" (
    "id" TEXT NOT NULL,
    "scrapNo" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNo" TEXT NOT NULL,
    "orderLineId" TEXT,
    "productionTaskId" TEXT,
    "productionTaskNo" TEXT,
    "partCode" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceRecordType" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "recordDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionScrapRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionNotice_noticeNo_key" ON "ProductionNotice"("noticeNo");
CREATE INDEX "ProductionNotice_status_idx" ON "ProductionNotice"("status");
CREATE INDEX "ProductionNotice_noticeType_idx" ON "ProductionNotice"("noticeType");
CREATE INDEX "ProductionNotice_orderNo_idx" ON "ProductionNotice"("orderNo");
CREATE INDEX "ProductionNotice_productionTaskNo_idx" ON "ProductionNotice"("productionTaskNo");
CREATE INDEX "ProductionNotice_createdAt_idx" ON "ProductionNotice"("createdAt");

CREATE UNIQUE INDEX "ProductionScrapRecord_scrapNo_key" ON "ProductionScrapRecord"("scrapNo");
CREATE UNIQUE INDEX "ProductionScrapRecord_sourceRecordType_sourceRecordId_key" ON "ProductionScrapRecord"("sourceRecordType", "sourceRecordId");
CREATE INDEX "ProductionScrapRecord_orderNo_idx" ON "ProductionScrapRecord"("orderNo");
CREATE INDEX "ProductionScrapRecord_productionTaskNo_idx" ON "ProductionScrapRecord"("productionTaskNo");
CREATE INDEX "ProductionScrapRecord_partCode_idx" ON "ProductionScrapRecord"("partCode");
CREATE INDEX "ProductionScrapRecord_recordDate_idx" ON "ProductionScrapRecord"("recordDate");
