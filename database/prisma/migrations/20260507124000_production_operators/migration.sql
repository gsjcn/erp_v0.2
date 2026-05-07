CREATE TABLE "ProductionOperator" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "pinyin" TEXT,
    "pinyinInitials" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "idCardMasked" TEXT,
    "idCardBound" BOOLEAN NOT NULL DEFAULT false,
    "status" "CommonStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOperator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionOperator_accountId_key" ON "ProductionOperator"("accountId");
CREATE INDEX "ProductionOperator_name_idx" ON "ProductionOperator"("name");
CREATE INDEX "ProductionOperator_status_idx" ON "ProductionOperator"("status");
