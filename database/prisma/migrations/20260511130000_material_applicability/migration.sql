-- 零件适用范围只维护推荐规则，不生成订单、不提交生产、不占库存。

CREATE TABLE "MaterialApplicability" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerNameSnapshot" TEXT,
    "projectModel" TEXT,
    "customerScopeKey" TEXT NOT NULL DEFAULT 'ALL',
    "projectModelScopeKey" TEXT NOT NULL DEFAULT 'ALL',
    "remark" TEXT,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialApplicability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialApplicability_materialId_customerScopeKey_projectModelScopeKey_key"
    ON "MaterialApplicability"("materialId", "customerScopeKey", "projectModelScopeKey");

CREATE INDEX "MaterialApplicability_customerId_idx"
    ON "MaterialApplicability"("customerId");

CREATE INDEX "MaterialApplicability_projectModelScopeKey_idx"
    ON "MaterialApplicability"("projectModelScopeKey");

CREATE INDEX "MaterialApplicability_status_idx"
    ON "MaterialApplicability"("status");

ALTER TABLE "MaterialApplicability"
    ADD CONSTRAINT "MaterialApplicability_materialId_fkey"
    FOREIGN KEY ("materialId")
    REFERENCES "Material"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "MaterialApplicability"
    ADD CONSTRAINT "MaterialApplicability_customerId_fkey"
    FOREIGN KEY ("customerId")
    REFERENCES "Customer"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
