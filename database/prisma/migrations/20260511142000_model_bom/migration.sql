-- 机型零件包只维护下单推荐基础，不自动生成订单、不提交生产、不占库存。

CREATE TABLE "ModelBom" (
    "id" TEXT NOT NULL,
    "bomName" TEXT NOT NULL,
    "customerId" TEXT,
    "customerNameSnapshot" TEXT,
    "projectModel" TEXT NOT NULL,
    "customerScopeKey" TEXT NOT NULL DEFAULT 'ALL',
    "projectModelScopeKey" TEXT NOT NULL,
    "remark" TEXT,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelBom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelBomLine" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "partCodeSnapshot" TEXT NOT NULL,
    "partNameSnapshot" TEXT NOT NULL,
    "unitSnapshot" TEXT NOT NULL,
    "partSpecificationSnapshot" TEXT,
    "defaultQuantity" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "remark" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelBomLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelBom_bomName_customerScopeKey_projectModelScopeKey_key"
    ON "ModelBom"("bomName", "customerScopeKey", "projectModelScopeKey");

CREATE INDEX "ModelBom_customerId_idx"
    ON "ModelBom"("customerId");

CREATE INDEX "ModelBom_projectModelScopeKey_idx"
    ON "ModelBom"("projectModelScopeKey");

CREATE INDEX "ModelBom_status_idx"
    ON "ModelBom"("status");

CREATE UNIQUE INDEX "ModelBomLine_bomId_materialId_key"
    ON "ModelBomLine"("bomId", "materialId");

CREATE INDEX "ModelBomLine_materialId_idx"
    ON "ModelBomLine"("materialId");

CREATE INDEX "ModelBomLine_status_idx"
    ON "ModelBomLine"("status");

ALTER TABLE "ModelBom"
    ADD CONSTRAINT "ModelBom_customerId_fkey"
    FOREIGN KEY ("customerId")
    REFERENCES "Customer"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE "ModelBomLine"
    ADD CONSTRAINT "ModelBomLine_bomId_fkey"
    FOREIGN KEY ("bomId")
    REFERENCES "ModelBom"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "ModelBomLine"
    ADD CONSTRAINT "ModelBomLine_materialId_fkey"
    FOREIGN KEY ("materialId")
    REFERENCES "Material"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
