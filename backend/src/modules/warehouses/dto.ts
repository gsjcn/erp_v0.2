import { InventoryTransactionType, ProductionNoticeStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateWarehouseDto {
  @IsOptional()
  @IsString()
  warehouseCode?: string;

  @IsString()
  warehouseName!: string;
}

export class CreateWarehouseLocationDto {
  @IsString()
  locationCode!: string;

  @IsOptional()
  @IsString()
  locationName?: string;
}

export class ConfirmReceiptDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class ConfirmShipmentDto {
  @IsOptional()
  @IsString()
  remark?: string;
}

export class WarehouseWorkQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class WarehouseTransactionQueryDto {
  @IsOptional()
  @IsEnum(InventoryTransactionType)
  transactionType?: InventoryTransactionType;
}

export class WarehouseNoticeQueryDto {
  @IsOptional()
  @IsEnum(ProductionNoticeStatus)
  status?: ProductionNoticeStatus;
}

export class AcknowledgeWarehouseNoticeDto {
  @IsString()
  acknowledgedBy!: string;
}
