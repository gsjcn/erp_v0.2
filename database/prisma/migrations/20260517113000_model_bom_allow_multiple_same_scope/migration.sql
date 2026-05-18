-- 允许同一客户 / 同一机型保留多个不同用途的 BOM；仍通过 bomName + scope 防止同名重复。
DROP INDEX IF EXISTS "ModelBom_customerScopeKey_projectModelScopeKey_key";
