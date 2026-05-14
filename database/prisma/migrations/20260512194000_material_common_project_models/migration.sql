-- 零件管理常用机型快捷入口：只保存显示顺序，不改变 BOM、零件适用范围、订单或库存。
CREATE TABLE IF NOT EXISTS "MaterialCommonProjectModel" (
  "id" TEXT NOT NULL,
  "projectModel" TEXT NOT NULL,
  "projectModelNormalized" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaterialCommonProjectModel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MaterialCommonProjectModel_projectModelNormalized_key"
ON "MaterialCommonProjectModel"("projectModelNormalized");

CREATE INDEX IF NOT EXISTS "MaterialCommonProjectModel_sortOrder_idx"
ON "MaterialCommonProjectModel"("sortOrder");

CREATE INDEX IF NOT EXISTS "MaterialCommonProjectModel_status_idx"
ON "MaterialCommonProjectModel"("status");

INSERT INTO "MaterialCommonProjectModel" (
  "id",
  "projectModel",
  "projectModelNormalized",
  "sortOrder",
  "status",
  "createdAt",
  "updatedAt"
) VALUES
  ('material-common-project-b3', 'B3', 'b3', 1, 'ENABLED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('material-common-project-b5', 'B5', 'b5', 2, 'ENABLED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("projectModelNormalized") DO NOTHING;
