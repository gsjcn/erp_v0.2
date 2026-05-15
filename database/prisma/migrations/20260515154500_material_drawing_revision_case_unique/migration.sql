-- 图纸编号和版本按大小写不敏感唯一，避免绕过后端时写入 A/a 这类重复版本。
CREATE UNIQUE INDEX IF NOT EXISTS "MaterialDrawingRevision_materialId_drawingNo_drawingVersion_lower_key"
ON "MaterialDrawingRevision"("materialId", LOWER("drawingNo"), LOWER("drawingVersion"));
