CREATE TABLE "ProductionReplenishmentRequest" (
    "id" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'PRODUCTION_SCRAP',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT,
    "orderNo" TEXT NOT NULL,
    "orderLineId" TEXT,
    "productionTaskId" TEXT,
    "productionTaskNo" TEXT,
    "processCompletionId" TEXT,
    "partCode" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "requestQuantity" DECIMAL(18,3) NOT NULL,
    "scrapQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedByCode" TEXT,
    "requestedByName" TEXT,
    "supervisorName" TEXT,
    "supervisorRemark" TEXT,
    "approvedAt" TIMESTAMP(3),
    "replenishmentTaskNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionReplenishmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionReplenishmentRequest_requestNo_key" ON "ProductionReplenishmentRequest"("requestNo");
CREATE UNIQUE INDEX "ProductionReplenishmentRequest_processCompletionId_key" ON "ProductionReplenishmentRequest"("processCompletionId");
CREATE INDEX "ProductionReplenishmentRequest_status_idx" ON "ProductionReplenishmentRequest"("status");
CREATE INDEX "ProductionReplenishmentRequest_sourceType_idx" ON "ProductionReplenishmentRequest"("sourceType");
CREATE INDEX "ProductionReplenishmentRequest_orderNo_idx" ON "ProductionReplenishmentRequest"("orderNo");
CREATE INDEX "ProductionReplenishmentRequest_productionTaskNo_idx" ON "ProductionReplenishmentRequest"("productionTaskNo");
CREATE INDEX "ProductionReplenishmentRequest_partCode_idx" ON "ProductionReplenishmentRequest"("partCode");
CREATE INDEX "ProductionReplenishmentRequest_createdAt_idx" ON "ProductionReplenishmentRequest"("createdAt");

ALTER TABLE "ProductionReplenishmentRequest"
ADD CONSTRAINT "ProductionReplenishmentRequest_processCompletionId_fkey"
FOREIGN KEY ("processCompletionId") REFERENCES "ProductionProcessCompletion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
