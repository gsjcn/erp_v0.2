CREATE TYPE "CustomerRegionType" AS ENUM ('CHINA', 'OVERSEAS');

ALTER TABLE "Customer"
ADD COLUMN "regionType" "CustomerRegionType" NOT NULL DEFAULT 'CHINA',
ADD COLUMN "country" TEXT NOT NULL DEFAULT '中国',
ADD COLUMN "province" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "detailAddress" TEXT;

CREATE TABLE "CustomerContact" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "contactPhone" TEXT,
  "title" TEXT,
  "remark" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CustomerContact"
ADD CONSTRAINT "CustomerContact_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");
CREATE INDEX "CustomerContact_contactName_idx" ON "CustomerContact"("contactName");

INSERT INTO "CustomerContact" (
  "id",
  "customerId",
  "contactName",
  "contactPhone",
  "isPrimary",
  "createdAt",
  "updatedAt"
)
SELECT
  md5("id" || CURRENT_TIMESTAMP::text),
  "id",
  COALESCE(NULLIF(TRIM("contactName"), ''), '默认联系人'),
  NULLIF(TRIM("contactPhone"), ''),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Customer"
WHERE NULLIF(TRIM(COALESCE("contactName", '')), '') IS NOT NULL
   OR NULLIF(TRIM(COALESCE("contactPhone", '')), '') IS NOT NULL;

CREATE UNIQUE INDEX "Customer_customerName_lower_key" ON "Customer"(LOWER("customerName"));
