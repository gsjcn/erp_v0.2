import { CommonStatus, InventoryTransactionType, ProductionNoticeStatus, ProductionNoticeType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested
} from 'class-validator';

export class CreateWarehouseDto {
  @IsOptional()
  @IsString()
  warehouseCode?: string;

  @IsString()
  warehouseName!: string;
}

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  warehouseCode?: string;

  @IsOptional()
  @IsString()
  warehouseName?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class CreateWarehouseLocationDto {
  @IsString()
  locationCode!: string;

  @IsOptional()
  @IsString()
  locationName?: string;
}

export class UpdateWarehouseLocationDto {
  @IsOptional()
  @IsString()
  locationCode?: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class WarehouseConfigQueryDto {
  @IsOptional()
  @IsIn(['ALL', 'ENABLED', 'DISABLED'])
  status?: 'ALL' | CommonStatus;

  @IsOptional()
  @IsIn(['ALL', 'ENABLED', 'DISABLED'])
  locationStatus?: 'ALL' | CommonStatus;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
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
  warehouseConfirmedByCode?: string;

  @IsOptional()
  @IsString()
  warehouseConfirmedBy?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class ConfirmShipmentItemDto {
  @IsString()
  @IsNotEmpty()
  batchId!: string;

  @IsOptional()
  @IsString()
  orderLineId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shipmentQuantity!: number;
}

export class ConfirmShipmentDto {
  @IsOptional()
  @IsString()
  warehouseConfirmedByCode?: string;

  @IsOptional()
  @IsString()
  warehouseConfirmedBy?: string;

  @IsOptional()
  @IsString()
  salesConfirmedBy?: string;

  @IsOptional()
  @IsString()
  overShipmentReason?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shipmentQuantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmShipmentItemDto)
  batchShipments?: ConfirmShipmentItemDto[];
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

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  withPage?: string;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
}

export class WarehouseNoticeQueryDto {
  @IsOptional()
  @IsEnum(ProductionNoticeStatus)
  status?: ProductionNoticeStatus;

  @IsOptional()
  @IsEnum(ProductionNoticeType)
  noticeType?: ProductionNoticeType;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerKeyword?: string;

  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsString()
  productionTaskNo?: string;

  @IsOptional()
  @IsString()
  partCode?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  withPage?: string;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
}

export class AcknowledgeWarehouseNoticeDto {
  @IsOptional()
  @IsString()
  acknowledgedByCode?: string;

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
