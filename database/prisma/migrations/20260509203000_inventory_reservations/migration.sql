-- CreateEnum
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

-- AlterTable
ALTER TABLE "OrderLine"
ADD COLUMN "productionPlanSuggestedQuantity" DECIMAL(18,3),
ADD COLUMN "productionPlanOverrideByCode" TEXT,
ADD COLUMN "productionPlanOverrideByName" TEXT,
ADD COLUMN "productionPlanOverrideByRole" TEXT,
ADD COLUMN "productionPlanOverrideAt" TIMESTAMP(3),
ADD COLUMN "productionPlanOverrideReason" TEXT;

-- CreateTable
CREATE TABLE "InventoryReservation" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderLineId" TEXT,
  "orderNo" TEXT NOT NULL,
  "partCode" TEXT NOT NULL,
  "partName" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryReservation_batchId_status_idx" ON "InventoryReservation"("batchId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservation_orderId_status_idx" ON "InventoryReservation"("orderId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservation_orderLineId_status_idx" ON "InventoryReservation"("orderLineId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservation_orderNo_idx" ON "InventoryReservation"("orderNo");

-- CreateIndex
CREATE INDEX "InventoryReservation_partCode_idx" ON "InventoryReservation"("partCode");

-- AddForeignKey
ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_orderLineId_fkey"
FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
