-- 发货流水需要明确绑定订单零件，避免备货库存超发时只能靠 partCode/unit 推断归属。
ALTER TABLE "InventoryTransaction" ADD COLUMN "orderLineId" TEXT;

ALTER TABLE "InventoryTransaction"
ADD CONSTRAINT "InventoryTransaction_orderLineId_fkey"
FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "InventoryTransaction_orderLineId_idx" ON "InventoryTransaction"("orderLineId");
