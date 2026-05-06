import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ConfirmReceiptDto,
  ConfirmShipmentDto,
  CreateWarehouseDto,
  CreateWarehouseLocationDto,
  WarehouseWorkQueryDto,
  WarehouseTransactionQueryDto
} from './dto';
import { WarehousesService } from './warehouses.service';

@Controller()
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get('warehouses')
  findWarehouses() {
    return this.warehousesService.findWarehouses();
  }

  @Post('warehouses')
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.warehousesService.createWarehouse(dto);
  }

  @Post('warehouses/:warehouseId/locations')
  createLocation(@Param('warehouseId') warehouseId: string, @Body() dto: CreateWarehouseLocationDto) {
    return this.warehousesService.createLocation(warehouseId, dto);
  }

  @Get('warehouse/receipts/pending')
  pendingReceipts(@Query() query: WarehouseWorkQueryDto) {
    return this.warehousesService.pendingReceipts(query);
  }

  @Post('warehouse/receipts/:productionTaskId/confirm')
  confirmReceipt(@Param('productionTaskId') productionTaskId: string, @Body() dto: ConfirmReceiptDto) {
    return this.warehousesService.confirmReceipt(productionTaskId, dto);
  }

  @Get('warehouse/shipments/pending')
  pendingShipments(@Query() query: WarehouseWorkQueryDto) {
    return this.warehousesService.pendingShipments(query);
  }

  @Post('warehouse/shipments/:batchId/confirm')
  confirmShipment(@Param('batchId') batchId: string, @Body() dto: ConfirmShipmentDto) {
    return this.warehousesService.confirmShipment(batchId, dto);
  }

  @Get('warehouse/transactions')
  findTransactions(@Query() query: WarehouseTransactionQueryDto) {
    return this.warehousesService.findTransactions(query);
  }
}
