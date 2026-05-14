ALTER TABLE "ProcessTemplate"
ADD COLUMN IF NOT EXISTS "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED';

CREATE INDEX IF NOT EXISTS "ProcessTemplate_status_updatedAt_idx"
ON "ProcessTemplate"("status", "updatedAt");
