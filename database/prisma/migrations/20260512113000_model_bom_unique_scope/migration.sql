-- ModelBom 每个客户 / 机型范围只能保留一套独立 BOM，避免脚本或手工 SQL 绕过服务层重复创建。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "ModelBom"
        GROUP BY "customerScopeKey", "projectModelScopeKey"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'ModelBom has duplicate customerScopeKey/projectModelScopeKey scopes. Run npm run backend:verify:first-stage and merge duplicate BOM scopes before applying this migration.';
    END IF;
END $$;

CREATE UNIQUE INDEX "ModelBom_customerScopeKey_projectModelScopeKey_key"
    ON "ModelBom"("customerScopeKey", "projectModelScopeKey");
