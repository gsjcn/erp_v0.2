-- 生产任务状态补齐第一阶段主流程：工序全完成待最终确认、仓库已入库。
ALTER TYPE "ProductionStatus" ADD VALUE IF NOT EXISTS 'WAITING_CONFIRMATION';
ALTER TYPE "ProductionStatus" ADD VALUE IF NOT EXISTS 'STORED';
