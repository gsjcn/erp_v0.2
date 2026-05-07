CREATE UNIQUE INDEX "Warehouse_warehouseCode_lower_key" ON "Warehouse"(LOWER("warehouseCode"));

CREATE UNIQUE INDEX "WarehouseLocation_warehouseId_locationCode_lower_key"
  ON "WarehouseLocation"("warehouseId", LOWER("locationCode"));
