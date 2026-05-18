-- Speed up exact BOM scope approval lookups and prevent duplicate open approvals for the same target scope.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "ModelBomScopeApprovalRequest"
        WHERE "status" IN ('PENDING', 'APPROVED') AND "usedAt" IS NULL
        GROUP BY
          "bomId",
          "requestedCustomerScopeMode",
          "requestedScopeKey",
          "requestedProjectModelScopeKey"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'ModelBomScopeApprovalRequest has duplicate open approvals for the same BOM target scope. Run npm run backend:verify:first-stage and reject or consume duplicate approvals before applying this migration.';
    END IF;
END $$;

CREATE INDEX "ModelBomScopeApprovalRequest_scope_query_idx"
  ON "ModelBomScopeApprovalRequest"(
    "bomId",
    "status",
    "requestedCustomerScopeMode",
    "requestedScopeKey",
    "requestedProjectModelScopeKey"
  );

CREATE UNIQUE INDEX "ModelBomScopeApprovalRequest_open_scope_unique"
  ON "ModelBomScopeApprovalRequest"(
    "bomId",
    "requestedCustomerScopeMode",
    "requestedScopeKey",
    "requestedProjectModelScopeKey"
  )
  WHERE "status" IN ('PENDING', 'APPROVED') AND "usedAt" IS NULL;
