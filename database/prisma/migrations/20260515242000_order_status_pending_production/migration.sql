-- 订单提交生产后的状态命名对齐第一阶段规范：PENDING_PRODUCTION 表示已提交、等待生产确认。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OrderStatus'
      AND e.enumlabel = 'SUBMITTED'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OrderStatus'
      AND e.enumlabel = 'PENDING_PRODUCTION'
  ) THEN
    ALTER TYPE "OrderStatus" RENAME VALUE 'SUBMITTED' TO 'PENDING_PRODUCTION';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OrderStatus'
      AND e.enumlabel = 'SUBMITTED'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OrderStatus'
      AND e.enumlabel = 'PENDING_PRODUCTION'
  ) THEN
    UPDATE "CustomerOrder"
    SET "status" = 'PENDING_PRODUCTION'::"OrderStatus"
    WHERE "status"::text = 'SUBMITTED';
  END IF;
END $$;
