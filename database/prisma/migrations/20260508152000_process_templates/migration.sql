-- CreateTable
CREATE TABLE "ProcessTemplate" (
    "id" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "templateNameNormalized" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "remark" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessTemplate_templateNameNormalized_key" ON "ProcessTemplate"("templateNameNormalized");

-- CreateIndex
CREATE INDEX "ProcessTemplate_templateName_idx" ON "ProcessTemplate"("templateName");

-- CreateIndex
CREATE INDEX "ProcessTemplate_searchText_idx" ON "ProcessTemplate"("searchText");

-- Seed first-stage reusable process memories.
INSERT INTO "ProcessTemplate" ("id", "templateName", "templateNameNormalized", "steps", "remark", "searchText", "updatedAt")
VALUES
  (
    'process-template-0001',
    '激光折弯包装',
    '激光折弯包装',
    '[{"processName":"激光切割"},{"processName":"折弯"},{"processName":"包装"}]'::jsonb,
    '常用钣金零件基础流程',
    '激光折弯包装 激光切割 折弯 包装 常用钣金零件基础流程',
    CURRENT_TIMESTAMP
  ),
  (
    'process-template-0002',
    '焊接件',
    '焊接件',
    '[{"processName":"激光切割"},{"processName":"折弯"},{"processName":"焊接"},{"processName":"打磨"},{"processName":"包装"}]'::jsonb,
    '带焊接和打磨的组合件流程',
    '焊接件 激光切割 折弯 焊接 打磨 包装 带焊接和打磨的组合件流程',
    CURRENT_TIMESTAMP
  ),
  (
    'process-template-0003',
    '冲压装配件',
    '冲压装配件',
    '[{"processName":"冲压"},{"processName":"打磨"},{"processName":"装配"},{"processName":"包装"}]'::jsonb,
    '冲压后需要装配的零件流程',
    '冲压装配件 冲压 打磨 装配 包装 冲压后需要装配的零件流程',
    CURRENT_TIMESTAMP
  ),
  (
    'process-template-0004',
    '喷涂件',
    '喷涂件',
    '[{"processName":"激光切割"},{"processName":"折弯"},{"processName":"喷涂"},{"processName":"包装"}]'::jsonb,
    '带表面喷涂的基础流程',
    '喷涂件 激光切割 折弯 喷涂 包装 带表面喷涂的基础流程',
    CURRENT_TIMESTAMP
  );
