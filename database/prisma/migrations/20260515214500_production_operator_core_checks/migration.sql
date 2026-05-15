-- 生产、仓库和订单提交都依赖操作人员快照；账号基础资料必须可搜索、可留痕且不能暴露完整证件号。
UPDATE "ProductionOperator"
SET
  "pinyin" = NULLIF(BTRIM("pinyin"), ''),
  "pinyinInitials" = NULLIF(BTRIM("pinyinInitials"), ''),
  "idCardMasked" = NULLIF(BTRIM("idCardMasked"), '')
WHERE "pinyin" IS NOT NULL
   OR "pinyinInitials" IS NOT NULL
   OR "idCardMasked" IS NOT NULL;

UPDATE "ProductionOperator"
SET "idCardMasked" = NULL
WHERE "idCardBound" = false
  AND "idCardMasked" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'ProductionOperator_accountId_lower_key'
  ) THEN
    CREATE UNIQUE INDEX "ProductionOperator_accountId_lower_key"
    ON "ProductionOperator"(LOWER("accountId"));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionOperator_identity_not_blank'
  ) THEN
    ALTER TABLE "ProductionOperator"
    ADD CONSTRAINT "ProductionOperator_identity_not_blank"
    CHECK (
      BTRIM("accountId") <> ''
      AND "accountId" = BTRIM("accountId")
      AND BTRIM("name") <> ''
      AND "name" = BTRIM("name")
      AND BTRIM("role") <> ''
      AND "role" = BTRIM("role")
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionOperator_optional_text_not_blank'
  ) THEN
    ALTER TABLE "ProductionOperator"
    ADD CONSTRAINT "ProductionOperator_optional_text_not_blank"
    CHECK (
      ("pinyin" IS NULL OR (BTRIM("pinyin") <> '' AND "pinyin" = BTRIM("pinyin")))
      AND ("pinyinInitials" IS NULL OR (BTRIM("pinyinInitials") <> '' AND "pinyinInitials" = BTRIM("pinyinInitials")))
      AND ("idCardMasked" IS NULL OR (BTRIM("idCardMasked") <> '' AND "idCardMasked" = BTRIM("idCardMasked")))
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionOperator_enabled_search_fields_valid'
  ) THEN
    ALTER TABLE "ProductionOperator"
    ADD CONSTRAINT "ProductionOperator_enabled_search_fields_valid"
    CHECK (
      "status" = 'DISABLED'
      OR (
        "pinyin" IS NOT NULL
        AND BTRIM("pinyin") <> ''
        AND "pinyin" = LOWER("pinyin")
        AND "pinyin" !~ '\s'
        AND "pinyinInitials" IS NOT NULL
        AND BTRIM("pinyinInitials") <> ''
        AND "pinyinInitials" = LOWER("pinyinInitials")
        AND "pinyinInitials" !~ '\s'
        AND CARDINALITY("keywords") > 0
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionOperator_id_card_mask_valid'
  ) THEN
    ALTER TABLE "ProductionOperator"
    ADD CONSTRAINT "ProductionOperator_id_card_mask_valid"
    CHECK (
      ("idCardBound" = false AND "idCardMasked" IS NULL)
      OR (
        "idCardBound" = true
        AND "idCardMasked" IS NOT NULL
        AND BTRIM("idCardMasked") <> ''
        AND "idCardMasked" !~ '\d{8,}'
      )
    );
  END IF;
END $$;
