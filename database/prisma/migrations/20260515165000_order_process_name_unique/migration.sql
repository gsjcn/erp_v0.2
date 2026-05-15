-- 同一订单零件和同一生产任务内不允许重复同名工序；次数或参数差异应写入 processRemark。
CREATE UNIQUE INDEX IF NOT EXISTS "OrderLineProcessStep_orderLineId_processName_lower_key"
ON "OrderLineProcessStep"("orderLineId", LOWER("processName"));

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionProcessCompletion_productionTaskId_processName_lower_key"
ON "ProductionProcessCompletion"("productionTaskId", LOWER("processName"));
