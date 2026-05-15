-- BOM 差异核对只记录人工确认结果；不得用无效类型、错误来源或空核对人绕过客户 BOM 独立维护边界。
UPDATE "ModelBomDiffReview"
SET
  "reviewKey" = BTRIM("reviewKey"),
  "issueKind" = BTRIM("issueKind"),
  "sourceLineId" = NULLIF(BTRIM("sourceLineId"), ''),
  "targetLineId" = NULLIF(BTRIM("targetLineId"), ''),
  "issueTitle" = BTRIM("issueTitle"),
  "issueDetail" = NULLIF(BTRIM("issueDetail"), ''),
  "diffFingerprint" = BTRIM("diffFingerprint"),
  "reviewedBy" = NULLIF(BTRIM("reviewedBy"), ''),
  "reviewRemark" = NULLIF(BTRIM("reviewRemark"), '')
WHERE true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomDiffReview_identity_not_blank'
  ) THEN
    ALTER TABLE "ModelBomDiffReview"
    ADD CONSTRAINT "ModelBomDiffReview_identity_not_blank"
    CHECK (
      BTRIM("targetBomId") <> ''
      AND BTRIM("sourceBomId") <> ''
      AND BTRIM("reviewKey") <> ''
      AND "reviewKey" = BTRIM("reviewKey")
      AND BTRIM("issueKind") <> ''
      AND "issueKind" = BTRIM("issueKind")
      AND BTRIM("issueTitle") <> ''
      AND "issueTitle" = BTRIM("issueTitle")
      AND BTRIM("diffFingerprint") <> ''
      AND "diffFingerprint" = BTRIM("diffFingerprint")
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomDiffReview_source_target_distinct'
  ) THEN
    ALTER TABLE "ModelBomDiffReview"
    ADD CONSTRAINT "ModelBomDiffReview_source_target_distinct"
    CHECK ("targetBomId" <> "sourceBomId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomDiffReview_issue_kind_valid'
  ) THEN
    ALTER TABLE "ModelBomDiffReview"
    ADD CONSTRAINT "ModelBomDiffReview_issue_kind_valid"
    CHECK ("issueKind" IN ('MISSING_IN_CUSTOMER', 'CHANGED', 'CUSTOMER_EXTRA'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomDiffReview_issue_line_shape_valid'
  ) THEN
    ALTER TABLE "ModelBomDiffReview"
    ADD CONSTRAINT "ModelBomDiffReview_issue_line_shape_valid"
    CHECK (
      ("issueKind" = 'MISSING_IN_CUSTOMER' AND "sourceLineId" IS NOT NULL AND "targetLineId" IS NULL)
      OR ("issueKind" = 'CHANGED' AND "sourceLineId" IS NOT NULL AND "targetLineId" IS NOT NULL)
      OR ("issueKind" = 'CUSTOMER_EXTRA' AND "sourceLineId" IS NULL AND "targetLineId" IS NOT NULL)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomDiffReview_review_key_scope_valid'
  ) THEN
    ALTER TABLE "ModelBomDiffReview"
    ADD CONSTRAINT "ModelBomDiffReview_review_key_scope_valid"
    CHECK (POSITION("targetBomId" || '|' || "sourceBomId" || '|' IN "reviewKey") = 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomDiffReview_reviewed_by_required'
  ) THEN
    ALTER TABLE "ModelBomDiffReview"
    ADD CONSTRAINT "ModelBomDiffReview_reviewed_by_required"
    CHECK ("reviewedBy" IS NOT NULL AND BTRIM("reviewedBy") <> '' AND "reviewedBy" = BTRIM("reviewedBy"));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomDiffReview_optional_text_not_blank'
  ) THEN
    ALTER TABLE "ModelBomDiffReview"
    ADD CONSTRAINT "ModelBomDiffReview_optional_text_not_blank"
    CHECK (
      ("sourceLineId" IS NULL OR BTRIM("sourceLineId") <> '')
      AND ("targetLineId" IS NULL OR BTRIM("targetLineId") <> '')
      AND ("issueDetail" IS NULL OR BTRIM("issueDetail") <> '')
      AND ("reviewRemark" IS NULL OR BTRIM("reviewRemark") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModelBomDiffReview_fields_json_shape'
  ) THEN
    ALTER TABLE "ModelBomDiffReview"
    ADD CONSTRAINT "ModelBomDiffReview_fields_json_shape"
    CHECK ("fieldsJson" IS NULL OR jsonb_typeof("fieldsJson") = 'object');
  END IF;
END $$;
