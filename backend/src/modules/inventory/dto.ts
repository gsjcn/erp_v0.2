import { InventoryStatus } from '@prisma/client';
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
}

export class MaterialSuggestionQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;
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
