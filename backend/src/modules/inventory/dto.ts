import { CommonStatus, InventoryStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

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

export class CreateMaterialImportSessionDto {
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class GetMaterialImportSessionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rowLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rowOffset?: number;
}

export class CommitMaterialImportSessionDto {
  @IsString()
  previewToken!: string;
}

export class CreateMaterialDto {
  @IsString()
  partCode!: string;

  @IsString()
  partName!: string;

  @IsString()
  unit!: string;

  @IsOptional()
  @IsString()
  partSpecification?: string;

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

export class SaveMaterialDrawingRevisionDto {
  @IsString()
  drawingNo!: string;

  @IsString()
  drawingVersion!: string;

  @IsOptional()
  @IsDateString()
  drawingDate?: string;

  @IsOptional()
  @IsString()
  drawingStatus?: string;

  @IsOptional()
  @IsString()
  drawingFileName?: string;

  @IsOptional()
  @IsString()
  drawingFileUrl?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  defaultChangedBy?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class SaveMaterialApplicabilityDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  projectModel?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class ModelBomQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  projectModel?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class SaveModelBomDto {
  @IsString()
  bomName!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsString()
  projectModel!: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class CopyModelBomDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  bomName?: string;

  @IsOptional()
  @IsString()
  projectModel?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class SaveModelBomLineDto {
  @IsString()
  materialId!: string;

  @IsOptional()
  @IsIn(['PART', 'COMPONENT'])
  lineType?: string;

  @IsOptional()
  @IsString()
  partCategory?: string;

  @IsOptional()
  @IsString()
  componentNo?: string;

  @IsOptional()
  @IsString()
  parentComponentNo?: string;

  @IsOptional()
  @IsString()
  defaultDrawingRevisionId?: string;

  @IsOptional()
  @IsString()
  defaultProcessRoute?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  defaultQuantity!: number;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class ReorderModelBomLineItemDto {
  @IsString()
  lineId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sortOrder!: number;
}

export class ReorderModelBomLinesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderModelBomLineItemDto)
  items!: ReorderModelBomLineItemDto[];
}

export class MaterialTransformRuleQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  projectModel?: string;

  @IsOptional()
  @IsString()
  sourceMaterialId?: string;

  @IsOptional()
  @IsString()
  sourcePartCode?: string;

  @IsOptional()
  @IsString()
  targetMaterialId?: string;

  @IsOptional()
  @IsString()
  targetPartCode?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

export class SaveMaterialTransformRuleDto {
  @IsString()
  sourceMaterialId!: string;

  @IsString()
  targetMaterialId!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  projectModel?: string;

  @IsOptional()
  @IsString()
  conversionDescription?: string;

  @IsOptional()
  @IsString()
  defaultProcessRoute?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  multiplier?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lossRate?: number;

  @IsOptional()
  @IsString()
  remark?: string;

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
