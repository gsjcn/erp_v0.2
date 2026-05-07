CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "partCode" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '件',
    "partSpecification" TEXT,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Material_partCode_key"
    ON "Material"("partCode");

CREATE UNIQUE INDEX "Material_partCode_lower_key"
    ON "Material"(LOWER("partCode"));

CREATE INDEX "Material_partName_idx"
    ON "Material"("partName");

CREATE INDEX "Material_status_idx"
    ON "Material"("status");
