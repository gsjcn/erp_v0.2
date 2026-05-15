ALTER TABLE "Material"
ADD COLUMN IF NOT EXISTS "stockAlertEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "stockAlertQuantity" DECIMAL(18, 3);

CREATE INDEX IF NOT EXISTS "Material_stockAlertEnabled_idx"
ON "Material"("stockAlertEnabled");
