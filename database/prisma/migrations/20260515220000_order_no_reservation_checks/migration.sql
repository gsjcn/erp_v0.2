-- 订单号创建后永久占用；占用表必须保存规范化订单号和明确占用原因，避免取消、归档或草稿删除后复用。
UPDATE "OrderNoReservation"
SET
  "orderNo" = UPPER(BTRIM("orderNo")),
  "orderNoNormalized" = UPPER(BTRIM("orderNoNormalized")),
  "reservedReason" = COALESCE(NULLIF(BTRIM("reservedReason"), ''), 'ORDER_CREATED')
WHERE "orderNo" <> UPPER(BTRIM("orderNo"))
   OR "orderNoNormalized" <> UPPER(BTRIM("orderNoNormalized"))
   OR BTRIM("reservedReason") = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderNoReservation_identity_not_blank'
  ) THEN
    ALTER TABLE "OrderNoReservation"
    ADD CONSTRAINT "OrderNoReservation_identity_not_blank"
    CHECK (
      BTRIM("orderNo") <> ''
      AND "orderNo" = BTRIM("orderNo")
      AND BTRIM("orderNoNormalized") <> ''
      AND "orderNoNormalized" = BTRIM("orderNoNormalized")
      AND BTRIM("reservedReason") <> ''
      AND "reservedReason" = BTRIM("reservedReason")
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderNoReservation_order_no_normalized'
  ) THEN
    ALTER TABLE "OrderNoReservation"
    ADD CONSTRAINT "OrderNoReservation_order_no_normalized"
    CHECK ("orderNo" = UPPER("orderNo") AND "orderNoNormalized" = UPPER("orderNo"));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderNoReservation_reason_valid'
  ) THEN
    ALTER TABLE "OrderNoReservation"
    ADD CONSTRAINT "OrderNoReservation_reason_valid"
    CHECK (
      "reservedReason" IN (
        'ORDER_CREATED',
        'ORDER_IMPORTED',
        'EXISTING_ORDER_RESERVED',
        'CANCELLED_ORDER_RESERVED',
        'SEED_ORDER_RESERVED',
        'SEED_DRAFT_STOCK_RESERVED',
        'SEED_STOCK_ORDER_RESERVED'
      )
    );
  END IF;
END $$;
