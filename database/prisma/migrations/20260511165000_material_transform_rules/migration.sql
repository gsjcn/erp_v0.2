CREATE TABLE "MaterialTransformRule" (
    "id" TEXT NOT NULL,
    "sourceMaterialId" TEXT NOT NULL,
    "targetMaterialId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerNameSnapshot" TEXT,
    "projectModel" TEXT,
    "customerScopeKey" TEXT NOT NULL DEFAULT 'ALL',
    "projectModelScopeKey" TEXT NOT NULL DEFAULT 'ALL',
    "conversionDescription" TEXT,
    "defaultProcessRoute" TEXT,
    "multiplier" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "lossRate" DECIMAL(18,4),
    "remark" TEXT,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialTransformRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialTransformRule_sourceMaterialId_targetMaterialId_customerScopeKey_projectModelScopeKey_key" ON "MaterialTransformRule"("sourceMaterialId", "targetMaterialId", "customerScopeKey", "projectModelScopeKey");
CREATE INDEX "MaterialTransformRule_sourceMaterialId_idx" ON "MaterialTransformRule"("sourceMaterialId");
CREATE INDEX "MaterialTransformRule_targetMaterialId_idx" ON "MaterialTransformRule"("targetMaterialId");
CREATE INDEX "MaterialTransformRule_customerId_idx" ON "MaterialTransformRule"("customerId");
CREATE INDEX "MaterialTransformRule_projectModelScopeKey_idx" ON "MaterialTransformRule"("projectModelScopeKey");
CREATE INDEX "MaterialTransformRule_status_idx" ON "MaterialTransformRule"("status");

ALTER TABLE "MaterialTransformRule" ADD CONSTRAINT "MaterialTransformRule_sourceMaterialId_fkey" FOREIGN KEY ("sourceMaterialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialTransformRule" ADD CONSTRAINT "MaterialTransformRule_targetMaterialId_fkey" FOREIGN KEY ("targetMaterialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialTransformRule" ADD CONSTRAINT "MaterialTransformRule_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
