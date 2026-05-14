-- BOM 客户适用范围：支持全部客户通用、客户私有、勾选指定客户可用。
ALTER TABLE "ModelBom"
ADD COLUMN IF NOT EXISTS "customerScopeMode" TEXT NOT NULL DEFAULT 'ALL';

UPDATE "ModelBom"
SET "customerScopeMode" = CASE
  WHEN "customerId" IS NULL THEN 'ALL'
  ELSE 'PRIVATE'
END;

CREATE TABLE IF NOT EXISTS "ModelBomCustomerScope" (
  "id" TEXT NOT NULL,
  "bomId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "customerNameSnapshot" TEXT,
  "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelBomCustomerScope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ModelBomCustomerScope_bomId_customerId_key"
ON "ModelBomCustomerScope"("bomId", "customerId");

CREATE INDEX IF NOT EXISTS "ModelBomCustomerScope_customerId_status_idx"
ON "ModelBomCustomerScope"("customerId", "status");

ALTER TABLE "ModelBomCustomerScope"
DROP CONSTRAINT IF EXISTS "ModelBomCustomerScope_bomId_fkey";

ALTER TABLE "ModelBomCustomerScope"
ADD CONSTRAINT "ModelBomCustomerScope_bomId_fkey"
FOREIGN KEY ("bomId") REFERENCES "ModelBom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelBomCustomerScope"
DROP CONSTRAINT IF EXISTS "ModelBomCustomerScope_customerId_fkey";

ALTER TABLE "ModelBomCustomerScope"
ADD CONSTRAINT "ModelBomCustomerScope_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
