-- AlterTable
ALTER TABLE "InventoryReservation"
ADD COLUMN "unit" TEXT NOT NULL DEFAULT '件',
ADD COLUMN "statusReason" TEXT,
ADD COLUMN "releasedAt" TIMESTAMP(3),
ADD COLUMN "consumedAt" TIMESTAMP(3);
