import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import {
  AcknowledgeWarehouseNoticeDto,
  ConfirmBatchShipmentDto,
  ConfirmReceiptDto,
  ConfirmShipmentDto,
  CreateWarehouseDto,
  CreateWarehouseLocationDto,
  UpdateWarehouseDto,
  UpdateWarehouseLocationDto,
  WarehouseConfigQueryDto,
  WarehouseNoticeQueryDto,
  WarehouseWorkQueryDto,
  WarehouseTransactionQueryDto
} from './dto';
import { WarehousesService } from './warehouses.service';

@Controller()
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get('warehouses')
  findWarehouses(@Query() query: WarehouseConfigQueryDto) {
    return this.warehousesService.findWarehouses(query);
  }

  @Get('warehouses/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="warehouse-config-export.xlsx"')
  async exportWarehouseConfig(@Query() query: WarehouseConfigQueryDto) {
    return new StreamableFile(await this.warehousesService.buildWarehouseConfigExport(query));
  }

  @Post('warehouses')
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.warehousesService.createWarehouse(dto);
  }

  @Patch('warehouses/:warehouseId')
  updateWarehouse(@Param('warehouseId') warehouseId: string, @Body() dto: UpdateWarehouseDto) {
    return this.warehousesService.updateWarehouse(warehouseId, dto);
  }

  @Delete('warehouses/:warehouseId')
  deleteWarehouse(@Param('warehouseId') warehouseId: string) {
    return this.warehousesService.deleteWarehouse(warehouseId);
  }

  @Post('warehouses/:warehouseId/locations')
  createLocation(@Param('warehouseId') warehouseId: string, @Body() dto: CreateWarehouseLocationDto) {
    return this.warehousesService.createLocation(warehouseId, dto);
  }

  @Patch('warehouses/:warehouseId/locations/:locationId')
  updateLocation(
    @Param('warehouseId') warehouseId: string,
    @Param('locationId') locationId: string,
    @Body() dto: UpdateWarehouseLocationDto
  ) {
    return this.warehousesService.updateLocation(warehouseId, locationId, dto);
  }

  @Delete('warehouses/:warehouseId/locations/:locationId')
  deleteLocation(@Param('warehouseId') warehouseId: string, @Param('locationId') locationId: string) {
    return this.warehousesService.deleteLocation(warehouseId, locationId);
  }

  @Get('warehouse/notices')
  warehouseNotices(@Query() query: WarehouseNoticeQueryDto) {
    return this.warehousesService.warehouseNotices({ ...query, withPage: 'true' });
  }

  @Get('warehouse/notices/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="warehouse-notices-export.xlsx"')
  async exportWarehouseNotices(@Query() query: WarehouseNoticeQueryDto) {
    return new StreamableFile(await this.warehousesService.buildWarehouseNoticesExport(query));
  }

  @Post('warehouse/notices/:id/acknowledge')
  acknowledgeWarehouseNotice(@Param('id') id: string, @Body() dto: AcknowledgeWarehouseNoticeDto) {
    return this.warehousesService.acknowledgeWarehouseNotice(id, dto);
  }

  @Get('warehouse/receipts/pending')
  pendingReceipts(@Query() query: WarehouseWorkQueryDto) {
    return this.warehousesService.pendingReceipts(query);
  }

  @Get('warehouse/work/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="warehouse-work-export.xlsx"')
  async exportWarehouseWork(@Query() query: WarehouseWorkQueryDto) {
    return new StreamableFile(await this.warehousesService.buildWarehouseWorkExport(query));
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

  @Post('warehouse/shipments/batch-confirm')
  confirmBatchShipment(@Body() dto: ConfirmBatchShipmentDto) {
    return this.warehousesService.confirmBatchShipment(dto);
  }

  @Post('warehouse/shipments/orders/:orderNo/confirm')
  confirmOrderShipment(@Param('orderNo') orderNo: string, @Body() dto: ConfirmShipmentDto) {
    return this.warehousesService.confirmOrderShipment(orderNo, dto);
  }

  @Get('warehouse/transactions/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="warehouse-transactions-export.xlsx"')
  async exportTransactions(@Query() query: WarehouseTransactionQueryDto) {
    return new StreamableFile(await this.warehousesService.buildWarehouseTransactionsExport(query));
  }

  @Get('warehouse/transactions')
  findTransactions(@Query() query: WarehouseTransactionQueryDto) {
    return this.warehousesService.findTransactions({ ...query, withPage: 'true' });
  }
}
