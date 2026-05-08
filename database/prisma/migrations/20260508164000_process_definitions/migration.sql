CREATE TABLE "ProcessDefinition" (
    "id" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "processNameNormalized" TEXT NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',
    "remark" TEXT,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessDefinition_processNameNormalized_key" ON "ProcessDefinition"("processNameNormalized");
CREATE INDEX "ProcessDefinition_status_processName_idx" ON "ProcessDefinition"("status", "processName");

INSERT INTO "ProcessDefinition" (
    "id",
    "processName",
    "processNameNormalized",
    "searchText",
    "createdAt",
    "updatedAt"
) VALUES
    ('process-definition-laser-cutting', '激光切割', '激光切割', '激光切割 jiguangqiege jgqg', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('process-definition-bending', '折弯', '折弯', '折弯 zhewan zw', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('process-definition-stamping', '冲压', '冲压', '冲压 chongya cy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('process-definition-welding', '焊接', '焊接', '焊接 hanjie hj', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('process-definition-grinding', '打磨', '打磨', '打磨 dama dm', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('process-definition-painting', '喷涂', '喷涂', '喷涂 pentu pt', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('process-definition-shot-blasting', '抛丸', '抛丸', '抛丸 paowan pw', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('process-definition-polishing', '抛光', '抛光', '抛光 paoguang pg', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('process-definition-assembly', '装配', '装配', '装配 zhuangpei zp', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('process-definition-packing', '包装', '包装', '包装 baozhuang bz', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('process-definition-other', '其他', '其他', '其他 qita qt', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("processNameNormalized") DO NOTHING;
