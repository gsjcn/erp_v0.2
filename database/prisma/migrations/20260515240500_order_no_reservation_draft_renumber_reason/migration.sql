-- DRAFT 订单允许人工改号；新订单号仍要永久占用并记录改号原因。
ALTER TABLE "OrderNoReservation" DROP CONSTRAINT IF EXISTS "OrderNoReservation_reason_valid";

ALTER TABLE "OrderNoReservation"
  ADD CONSTRAINT "OrderNoReservation_reason_valid"
  CHECK (
    "reservedReason" IN (
      'ORDER_CREATED',
      'ORDER_IMPORTED',
      'EXISTING_ORDER_RESERVED',
      'CANCELLED_ORDER_RESERVED',
      'DRAFT_ORDER_RENUMBERED',
      'SEED_ORDER_RESERVED',
      'SEED_DRAFT_STOCK_RESERVED',
      'SEED_STOCK_ORDER_RESERVED'
    )
  );
