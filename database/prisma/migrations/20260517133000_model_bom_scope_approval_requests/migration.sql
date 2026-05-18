-- BOM 适用范围扩大审批申请；只记录管理员批准，不生成订单、生产任务或库存流水。
CREATE TABLE "ModelBomScopeApprovalRequest" (
  "id" TEXT NOT NULL,
  "requestNo" TEXT NOT NULL,
  "bomId" TEXT NOT NULL,
  "requestType" TEXT NOT NULL DEFAULT 'EXPAND_SCOPE',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requestedBomName" TEXT NOT NULL,
  "requestedCustomerScopeMode" TEXT NOT NULL,
  "requestedCustomerId" TEXT,
  "requestedCustomerNameSnapshot" TEXT,
  "requestedCustomerIds" JSONB,
  "requestedProjectModel" TEXT NOT NULL,
  "requestedScopeKey" TEXT NOT NULL,
  "requestedProjectModelScopeKey" TEXT NOT NULL,
  "currentScopeJson" JSONB NOT NULL,
  "requestedScopeJson" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedBy" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "reviewRemark" TEXT,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModelBomScopeApprovalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelBomScopeApprovalRequest_requestNo_key" ON "ModelBomScopeApprovalRequest"("requestNo");
CREATE INDEX "ModelBomScopeApprovalRequest_bomId_status_idx" ON "ModelBomScopeApprovalRequest"("bomId", "status");
CREATE INDEX "ModelBomScopeApprovalRequest_status_createdAt_idx" ON "ModelBomScopeApprovalRequest"("status", "createdAt");
CREATE INDEX "ModelBomScopeApprovalRequest_requestType_idx" ON "ModelBomScopeApprovalRequest"("requestType");

ALTER TABLE "ModelBomScopeApprovalRequest"
  ADD CONSTRAINT "ModelBomScopeApprovalRequest_bomId_fkey"
  FOREIGN KEY ("bomId") REFERENCES "ModelBom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
