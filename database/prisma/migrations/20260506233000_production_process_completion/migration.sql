-- 每道生产工序的完成表单，保存当前有效状态。
CREATE TABLE "ProductionProcessCompletion" (
    "id" TEXT NOT NULL,
    "productionTaskId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "processName" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "operatorCode" TEXT,
    "operatorName" TEXT,
    "operatorRole" TEXT,
    "completedAt" TIMESTAMP(3),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionProcessCompletion_pkey" PRIMARY KEY ("id")
);

-- 工序完成表单修改日志，只追加记录，不覆盖历史。
CREATE TABLE "ProductionProcessCompletionLog" (
    "id" TEXT NOT NULL,
    "completionId" TEXT NOT NULL,
    "productionTaskId" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "operatorCode" TEXT,
    "operatorName" TEXT,
    "beforeSnapshot" JSONB,
    "afterSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionProcessCompletionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionProcessCompletion_productionTaskId_stepNo_key"
    ON "ProductionProcessCompletion"("productionTaskId", "stepNo");

CREATE INDEX "ProductionProcessCompletion_processName_idx"
    ON "ProductionProcessCompletion"("processName");

CREATE INDEX "ProductionProcessCompletion_isCompleted_idx"
    ON "ProductionProcessCompletion"("isCompleted");

CREATE INDEX "ProductionProcessCompletion_completedAt_idx"
    ON "ProductionProcessCompletion"("completedAt");

CREATE INDEX "ProductionProcessCompletionLog_completionId_idx"
    ON "ProductionProcessCompletionLog"("completionId");

CREATE INDEX "ProductionProcessCompletionLog_productionTaskId_idx"
    ON "ProductionProcessCompletionLog"("productionTaskId");

CREATE INDEX "ProductionProcessCompletionLog_createdAt_idx"
    ON "ProductionProcessCompletionLog"("createdAt");

ALTER TABLE "ProductionProcessCompletion"
    ADD CONSTRAINT "ProductionProcessCompletion_productionTaskId_fkey"
    FOREIGN KEY ("productionTaskId") REFERENCES "ProductionTask"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductionProcessCompletionLog"
    ADD CONSTRAINT "ProductionProcessCompletionLog_completionId_fkey"
    FOREIGN KEY ("completionId") REFERENCES "ProductionProcessCompletion"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
