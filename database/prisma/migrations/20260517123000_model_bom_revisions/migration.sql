CREATE TABLE "ModelBomRevision" (
  "id" TEXT NOT NULL,
  "bomId" TEXT NOT NULL,
  "revisionNo" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "changedBy" TEXT,
  "changeRemark" TEXT,
  "snapshotJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelBomRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelBomRevision_bomId_revisionNo_key" ON "ModelBomRevision"("bomId", "revisionNo");
CREATE INDEX "ModelBomRevision_bomId_createdAt_idx" ON "ModelBomRevision"("bomId", "createdAt");
CREATE INDEX "ModelBomRevision_action_idx" ON "ModelBomRevision"("action");

ALTER TABLE "ModelBomRevision"
  ADD CONSTRAINT "ModelBomRevision_bomId_fkey"
  FOREIGN KEY ("bomId") REFERENCES "ModelBom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelBomRevision"
  ADD CONSTRAINT "ModelBomRevision_revision_no_positive" CHECK ("revisionNo" > 0);

ALTER TABLE "ModelBomRevision"
  ADD CONSTRAINT "ModelBomRevision_action_not_blank" CHECK (BTRIM("action") <> '');
