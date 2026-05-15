-- 默认图纸只允许一个启用版本，避免下单和 BOM 推荐时默认图纸来源不确定。
CREATE UNIQUE INDEX IF NOT EXISTS "MaterialDrawingRevision_enabled_default_unique"
ON "MaterialDrawingRevision"("materialId")
WHERE "isDefault" = true AND "status" = 'ENABLED';
