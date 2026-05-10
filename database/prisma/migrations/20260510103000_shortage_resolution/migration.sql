ALTER TABLE "ProductionProcessCompletion"
    ADD COLUMN "shortageResolutionMode" TEXT,
    ADD COLUMN "shortageResolutionBy" TEXT,
    ADD COLUMN "shortageResolutionReason" TEXT,
    ADD COLUMN "shortageResolvedAt" TIMESTAMP(3);

CREATE INDEX "ProductionProcessCompletion_shortageResolutionMode_idx"
    ON "ProductionProcessCompletion"("shortageResolutionMode");
