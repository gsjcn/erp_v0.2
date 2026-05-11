import { CommonStatus, InventoryStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class InventoryQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsEnum(InventoryStatus)
  status?: InventoryStatus;

  @IsOptional()
  @IsString()
  excludeOrderNo?: string;

  @IsOptional()
  @IsString()
  excludeOrderId?: string;
}

export class MaterialSuggestionQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsIn(['ALL', 'ORDER', 'STOCK'])
  sourceType?: 'ALL' | 'ORDER' | 'STOCK';

  @IsOptional()
  @IsString()
  excludeOrderNo?: string;

  @IsOptional()
  @IsString()
  excludeOrderId?: string;
}

export class MaterialQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class UpdateMaterialDto {
  @IsOptional()
  @IsString()
  partCode?: string;

  @IsOptional()
  @IsString()
  partName?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  partSpecification?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class InventorySourceDetailQueryDto {
  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsIn(['ALL', 'ORDER', 'STOCK'])
  sourceType?: 'ALL' | 'ORDER' | 'STOCK';

  @IsOptional()
  @IsString()
  excludeOrderNo?: string;

  @IsOptional()
  @IsString()
  excludeOrderId?: string;
}

export class AdjustInventoryBatchDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  afterQuantity!: number;

  @IsString()
  countedBy!: string;

  @IsOptional()
  @IsString()
  countedAt?: string;

  @IsString()
  signatureName!: string;

  @IsString()
  attachmentFileName!: string;

  @IsString()
  attachmentFileUrl!: string;

  @IsOptional()
  @IsString()
  attachmentMimeType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  attachmentSize?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}
