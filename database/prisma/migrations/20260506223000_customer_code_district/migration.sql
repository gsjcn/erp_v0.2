ALTER TABLE "Customer"
ADD COLUMN "district" TEXT;

CREATE UNIQUE INDEX "Customer_customerCode_lower_key" ON "Customer"(LOWER("customerCode"));
