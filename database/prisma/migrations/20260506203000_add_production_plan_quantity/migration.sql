ALTER TABLE "OrderLine" ADD COLUMN "productionPlanQuantity" DECIMAL(18, 3);

UPDATE "OrderLine"
SET "productionPlanQuantity" = "quantity";

ALTER TABLE "OrderLine" ALTER COLUMN "productionPlanQuantity" SET NOT NULL;
