ALTER TABLE "MaterialImportRow"
ADD COLUMN IF NOT EXISTS "stockAlertEnabled" BOOLEAN,
ADD COLUMN IF NOT EXISTS "stockAlertQuantity" DECIMAL(18, 3);
