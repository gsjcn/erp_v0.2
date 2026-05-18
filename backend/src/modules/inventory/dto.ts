import { CommonStatus, InventoryStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export const stockAlertFilterValues = ['ALL', 'ENABLED', 'TRIGGERED', 'DISABLED'] as const;
export type StockAlertFilter = (typeof stockAlertFilterValues)[number];

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
  @IsIn(stockAlertFilterValues)
  stockAlert?: StockAlertFilter;

  @IsOptional()
  @IsString()
  excludeOrderNo?: string;

  @IsOptional()
  @IsString()
  excludeOrderId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  withPage?: string;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;

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
  projectModel?: string;

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

  @IsOptional()
  @IsIn(stockAlertFilterValues)
  stockAlert?: StockAlertFilter;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  withPage?: string;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
}

export class CreateMaterialImportSessionDto {
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class CreateMaterialImportFromOrderImportDto {
  @IsString()
  previewToken!: string;

  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class CreateModelBomDraftFromOrderImportDto {
  @IsString()
  previewToken!: string;
}

export class CommitModelBomDraftFromOrderImportDto {
  @IsString()
  previewToken!: string;

  @IsString()
  draftKey!: string;

  @IsOptional()
  @IsString()
  bomName?: string;

  @IsOptional()
  @IsString()
  confirmedBy?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reviewedExistingBomIds?: string[];
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
  @IsString()
  defaultProcessRoute?: string;

  @IsOptional()
  @IsBoolean()
  stockAlertEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stockAlertQuantity?: number;

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
  @IsString()
  defaultProcessRoute?: string;

  @IsOptional()
  @IsBoolean()
  stockAlertEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stockAlertQuantity?: number;

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
  @IsIn(['ALL', 'PRIVATE', 'SELECTED'])
  scopeMode?: 'ALL' | 'PRIVATE' | 'SELECTED';

  @IsOptional()
  @IsString()
  excludeGlobalAllProject?: string;

  @IsOptional()
  @IsString()
  commonOnly?: string;

  @IsOptional()
  @IsIn(['ENABLED', 'DISABLED', 'ALL'])
  status?: CommonStatus | 'ALL';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  withPage?: string;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
}

export class SaveModelBomDto {
  @IsString()
  bomName!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsIn(['ALL', 'PRIVATE', 'SELECTED'])
  customerScopeMode?: 'ALL' | 'PRIVATE' | 'SELECTED';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customerIds?: string[];

  @IsOptional()
  @IsString()
  projectModel?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @IsOptional()
  @IsBoolean()
  isCommon?: boolean;

  @IsOptional()
  @IsBoolean()
  scopeChangeConfirmed?: boolean;

  @IsOptional()
  @IsString()
  scopeApprovalRequestId?: string;
}

export class CreateModelBomScopeApprovalRequestDto extends SaveModelBomDto {
  @IsString()
  requestedBy!: string;

  @IsString()
  requestReason!: string;
}

export class ModelBomScopeApprovalRequestQueryDto {
  @IsOptional()
  @IsString()
  bomId?: string;

  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'USED', 'ALL'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'ALL';

  @IsOptional()
  @IsIn(['ALL', 'PRIVATE', 'SELECTED'])
  requestedCustomerScopeMode?: 'ALL' | 'PRIVATE' | 'SELECTED';

  @IsOptional()
  @IsString()
  requestedScopeKey?: string;

  @IsOptional()
  @IsString()
  requestedProjectModelScopeKey?: string;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;
}

export class ReviewModelBomScopeApprovalRequestDto {
  @IsString()
  reviewedBy!: string;

  @IsOptional()
  @IsString()
  reviewRemark?: string;
}

export class SetModelBomCommonDto {
  @IsBoolean()
  isCommon!: boolean;
}

export class SetModelBomsCommonBatchDto {
  @IsArray()
  @IsString({ each: true })
  bomIds!: string[];

  @IsBoolean()
  isCommon!: boolean;
}

export class ReorderModelBomCommonItemDto {
  @IsString()
  bomId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  commonSortOrder!: number;
}

export class ReorderModelBomCommonDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderModelBomCommonItemDto)
  items!: ReorderModelBomCommonItemDto[];
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

  @IsOptional()
  @IsBoolean()
  isCommon?: boolean;
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

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  partThickness?: number;

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

export class ModelBomDiffReviewQueryDto {
  @IsOptional()
  @IsString()
  sourceBomId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  withPage?: string;
}

export class ModelBomRevisionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;
}

export class ConfirmModelBomDiffReviewDto {
  @IsString()
  sourceBomId!: string;

  @IsString()
  reviewKey!: string;

  @IsString()
  issueKind!: string;

  @IsOptional()
  @IsString()
  sourceLineId?: string;

  @IsOptional()
  @IsString()
  targetLineId?: string;

  @IsString()
  issueTitle!: string;

  @IsOptional()
  @IsString()
  issueDetail?: string;

  @IsString()
  diffFingerprint!: string;

  @IsOptional()
  @IsObject()
  fieldsJson?: Record<string, unknown>;

  @IsString()
  reviewedBy!: string;

  @IsOptional()
  @IsString()
  reviewRemark?: string;
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
  @IsIn(['ENABLED', 'DISABLED', 'ALL'])
  status?: CommonStatus | 'ALL';

  @IsOptional()
  @IsIn(['ALL', 'WITH_STOCK', 'NO_STOCK'])
  sourceStockStatus?: 'ALL' | 'WITH_STOCK' | 'NO_STOCK';

  @IsOptional()
  @IsIn(['ALL', 'WITH_STOCK', 'NO_STOCK'])
  targetStockStatus?: 'ALL' | 'WITH_STOCK' | 'NO_STOCK';

  @IsOptional()
  @IsIn(['ALL', 'TARGET_STOCK', 'SOURCE_REWORK', 'NO_STOCK'])
  inventoryDecision?: 'ALL' | 'TARGET_STOCK' | 'SOURCE_REWORK' | 'NO_STOCK';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  withPage?: string;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
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
  customerId?: string;

  @IsOptional()
  @IsString()
  excludeOrderNo?: string;

  @IsOptional()
  @IsString()
  excludeOrderId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  withPage?: string;
}

export class AdjustInventoryBatchDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  afterQuantity!: number;

  @IsOptional()
  @IsIn(['SCRAPPED'])
  targetStatus?: 'SCRAPPED';

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
