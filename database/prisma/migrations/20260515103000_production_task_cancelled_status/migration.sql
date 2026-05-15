-- 未开始生产任务取消后保留 ProductionTask 历史，不再为了隐藏待办而物理删除任务。
ALTER TYPE "ProductionStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
