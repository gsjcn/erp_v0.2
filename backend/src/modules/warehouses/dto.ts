import { InventoryTransactionType, ProductionNoticeStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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
  @IsString()
  @IsNotEmpty()
  warehouseId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class ConfirmShipmentDto {
  @IsOptional()
  @IsString()
  remark?: string;
}

export class ConfirmBatchShipmentDto extends ConfirmShipmentDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  batchIds!: string[];
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

export class WarehouseNoticeQueryDto {
  @IsOptional()
  @IsEnum(ProductionNoticeStatus)
  status?: ProductionNoticeStatus;
}

export class AcknowledgeWarehouseNoticeDto {
  @IsString()
  acknowledgedBy!: string;

  @IsOptional()
  @IsIn(['STOCK', 'SCRAP', 'NONE'])
  handlingMode?: 'STOCK' | 'SCRAP' | 'NONE';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  handlingQuantity?: number;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsBoolean()
  mergeConfirmed?: boolean;
}
