CREATE TABLE "OrderNoReservation" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "orderNoNormalized" TEXT NOT NULL,
    "sourceOrderId" TEXT,
    "reservedReason" TEXT NOT NULL DEFAULT 'ORDER_CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderNoReservation_pkey" PRIMARY KEY ("id")
);

INSERT INTO "OrderNoReservation" (
    "id",
    "orderNo",
    "orderNoNormalized",
    "sourceOrderId",
    "reservedReason",
    "createdAt",
    "updatedAt"
)
SELECT DISTINCT ON (UPPER("orderNo"))
    'order-no-' || md5(UPPER("orderNo")),
    "orderNo",
    UPPER("orderNo"),
    "id",
    CASE
        WHEN "status"::TEXT = 'CANCELLED' THEN 'CANCELLED_ORDER_RESERVED'
        ELSE 'EXISTING_ORDER_RESERVED'
    END,
    "createdAt",
    CURRENT_TIMESTAMP
FROM "CustomerOrder"
ORDER BY UPPER("orderNo"), "createdAt" ASC;

CREATE UNIQUE INDEX "OrderNoReservation_orderNoNormalized_key"
    ON "OrderNoReservation"("orderNoNormalized");

CREATE INDEX "OrderNoReservation_orderNo_idx"
    ON "OrderNoReservation"("orderNo");

CREATE INDEX "OrderNoReservation_sourceOrderId_idx"
    ON "OrderNoReservation"("sourceOrderId");
