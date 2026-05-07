CREATE TYPE "OrderLineFulfillmentMode" AS ENUM ('PRODUCTION', 'STOCK', 'REWORK');

ALTER TABLE "OrderLine"
    ADD COLUMN "fulfillmentMode" "OrderLineFulfillmentMode" NOT NULL DEFAULT 'PRODUCTION';

ALTER TABLE "InventoryBatch"
    ADD COLUMN "sourceOrderLineId" TEXT;

ALTER TABLE "InventoryBatch"
    ADD CONSTRAINT "InventoryBatch_sourceOrderLineId_fkey"
    FOREIGN KEY ("sourceOrderLineId")
    REFERENCES "OrderLine"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

CREATE INDEX "OrderLine_fulfillmentMode_idx"
    ON "OrderLine"("fulfillmentMode");

CREATE INDEX "InventoryBatch_sourceOrderLineId_idx"
    ON "InventoryBatch"("sourceOrderLineId");
