-- Enforce BOM name + scope uniqueness case-insensitively. PostgreSQL default text
-- uniqueness is case-sensitive, while ERP operators treat BOM names as business names.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(trim("bomName")) AS "bomNameKey", "customerScopeKey", "projectModelScopeKey", COUNT(*) AS "count"
      FROM "ModelBom"
      GROUP BY lower(trim("bomName")), "customerScopeKey", "projectModelScopeKey"
      HAVING COUNT(*) > 1
    ) duplicate_scope
  ) THEN
    RAISE EXCEPTION 'ModelBom has duplicate case-insensitive bomName/customerScopeKey/projectModelScopeKey scopes. Run npm run backend:verify:first-stage and rename or merge duplicate BOMs before applying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ModelBom_bomName_ci_customerScopeKey_projectModelScopeKey_key"
ON "ModelBom" (lower(trim("bomName")), "customerScopeKey", "projectModelScopeKey");
