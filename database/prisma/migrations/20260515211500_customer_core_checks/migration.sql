-- 客户基础资料是订单、BOM、生产和库存追溯的源头；客户编号、名称、地区和联系人快照必须稳定可校验。
DO $$
BEGIN
  UPDATE "Customer"
  SET
    "contactName" = NULLIF(BTRIM("contactName"), ''),
    "contactPhone" = NULLIF(BTRIM("contactPhone"), ''),
    "address" = NULLIF(BTRIM("address"), ''),
    "province" = NULLIF(BTRIM("province"), ''),
    "state" = NULLIF(BTRIM("state"), ''),
    "district" = NULLIF(BTRIM("district"), ''),
    "city" = NULLIF(BTRIM("city"), ''),
    "detailAddress" = NULLIF(BTRIM("detailAddress"), ''),
    "remark" = NULLIF(BTRIM("remark"), '')
  WHERE
    ("contactName" IS NOT NULL AND BTRIM("contactName") = '')
    OR ("contactPhone" IS NOT NULL AND BTRIM("contactPhone") = '')
    OR ("address" IS NOT NULL AND BTRIM("address") = '')
    OR ("province" IS NOT NULL AND BTRIM("province") = '')
    OR ("state" IS NOT NULL AND BTRIM("state") = '')
    OR ("district" IS NOT NULL AND BTRIM("district") = '')
    OR ("city" IS NOT NULL AND BTRIM("city") = '')
    OR ("detailAddress" IS NOT NULL AND BTRIM("detailAddress") = '')
    OR ("remark" IS NOT NULL AND BTRIM("remark") = '');

  UPDATE "CustomerContact"
  SET
    "contactPhone" = NULLIF(BTRIM("contactPhone"), ''),
    "title" = NULLIF(BTRIM("title"), ''),
    "remark" = NULLIF(BTRIM("remark"), '')
  WHERE
    ("contactPhone" IS NOT NULL AND BTRIM("contactPhone") = '')
    OR ("title" IS NOT NULL AND BTRIM("title") = '')
    OR ("remark" IS NOT NULL AND BTRIM("remark") = '');

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Customer_identity_not_blank'
  ) THEN
    ALTER TABLE "Customer"
    ADD CONSTRAINT "Customer_identity_not_blank"
    CHECK (
      BTRIM("customerCode") <> ''
      AND BTRIM("customerName") <> ''
      AND BTRIM("country") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Customer_optional_text_not_blank'
  ) THEN
    ALTER TABLE "Customer"
    ADD CONSTRAINT "Customer_optional_text_not_blank"
    CHECK (
      ("contactName" IS NULL OR BTRIM("contactName") <> '')
      AND ("contactPhone" IS NULL OR BTRIM("contactPhone") <> '')
      AND ("address" IS NULL OR BTRIM("address") <> '')
      AND ("province" IS NULL OR BTRIM("province") <> '')
      AND ("state" IS NULL OR BTRIM("state") <> '')
      AND ("district" IS NULL OR BTRIM("district") <> '')
      AND ("city" IS NULL OR BTRIM("city") <> '')
      AND ("detailAddress" IS NULL OR BTRIM("detailAddress") <> '')
      AND ("remark" IS NULL OR BTRIM("remark") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Customer_region_fields_valid'
  ) THEN
    ALTER TABLE "Customer"
    ADD CONSTRAINT "Customer_region_fields_valid"
    CHECK (
      (
        "regionType" = 'CHINA'
        AND BTRIM("country") <> ''
        AND "province" IS NOT NULL
        AND BTRIM("province") <> ''
        AND "city" IS NOT NULL
        AND BTRIM("city") <> ''
      )
      OR
      (
        "regionType" = 'OVERSEAS'
        AND BTRIM("country") <> ''
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Customer_contact_snapshot_valid'
  ) THEN
    ALTER TABLE "Customer"
    ADD CONSTRAINT "Customer_contact_snapshot_valid"
    CHECK ("contactName" IS NOT NULL OR "contactPhone" IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerContact_identity_not_blank'
  ) THEN
    ALTER TABLE "CustomerContact"
    ADD CONSTRAINT "CustomerContact_identity_not_blank"
    CHECK (
      BTRIM("customerId") <> ''
      AND BTRIM("contactName") <> ''
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerContact_optional_text_not_blank'
  ) THEN
    ALTER TABLE "CustomerContact"
    ADD CONSTRAINT "CustomerContact_optional_text_not_blank"
    CHECK (
      ("contactPhone" IS NULL OR BTRIM("contactPhone") <> '')
      AND ("title" IS NULL OR BTRIM("title") <> '')
      AND ("remark" IS NULL OR BTRIM("remark") <> '')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerContact_disabled_not_primary'
  ) THEN
    ALTER TABLE "CustomerContact"
    ADD CONSTRAINT "CustomerContact_disabled_not_primary"
    CHECK (NOT ("status" = 'DISABLED' AND "isPrimary" = true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'CustomerContact_one_enabled_primary_per_customer'
  ) THEN
    CREATE UNIQUE INDEX "CustomerContact_one_enabled_primary_per_customer"
    ON "CustomerContact"("customerId")
    WHERE "status" = 'ENABLED' AND "isPrimary" = true;
  END IF;
END $$;
