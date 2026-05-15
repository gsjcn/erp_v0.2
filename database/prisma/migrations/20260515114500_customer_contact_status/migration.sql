-- 客户多联系人改为软停用旧记录，避免编辑客户时物理删除联系人维护历史。
ALTER TABLE "CustomerContact" ADD COLUMN IF NOT EXISTS "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED';

CREATE INDEX IF NOT EXISTS "CustomerContact_customerId_status_idx" ON "CustomerContact"("customerId", "status");
