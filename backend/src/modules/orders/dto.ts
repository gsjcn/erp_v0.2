import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { OrderLineFulfillmentMode, OrderStatus } from '@prisma/client';

export class OrderQueryDto {
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
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  statuses?: string;

  @IsOptional()
  @IsString()
  productionStatuses?: string;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
}

export class NextOrderNoQueryDto {
  @IsOptional()
  @IsDateString()
  orderDate?: string;
}

export class CheckOrderNoQueryDto {
  @IsString()
  @IsNotEmpty()
  orderNo!: string;

  @IsOptional()
  @IsString()
  excludeOrderNo?: string;
}

export class DrawingDuplicateQueryDto {
  @IsString()
  @IsNotEmpty()
  value!: string;

  @IsOptional()
  @IsString()
  excludeOrderNo?: string;
}

export class ProcessStepDto {
  @IsString()
  @IsNotEmpty()
  processName!: string;

  @IsOptional()
  @IsString()
  processRemark?: string;
}

export class StockSourceSelectionDto {
  @IsString()
  @IsNotEmpty()
  batchId!: string;

  @IsOptional()
  @IsString()
  batchNo?: string;

  @IsOptional()
  @IsString()
  partCode?: string;

  @IsOptional()
  @IsString()
  partName?: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  replenishmentSourceType?: string;

  @IsOptional()
  @IsString()
  replenishmentSourceRequestNo?: string;

  @IsOptional()
  @IsString()
  replenishmentSourceLabel?: string;

  @IsOptional()
  @IsIn(['MATCHED', 'NEEDS_CONFIRMATION', 'INCOMPLETE', 'UNKNOWN'])
  compatibilityStatus?: 'MATCHED' | 'NEEDS_CONFIRMATION' | 'INCOMPLETE' | 'UNKNOWN';

  @IsOptional()
  @IsString()
  compatibilityReason?: string;

  @IsOptional()
  @IsString()
  manualConfirmedBy?: string;

  @IsOptional()
  @IsString()
  manualConfirmedAt?: string;

  @IsOptional()
  @IsString()
  manualConfirmRemark?: string;
}

export class CreateOrderLineDto {
  @IsOptional()
  @IsIn(['PART', 'COMPONENT'])
  lineType?: 'PART' | 'COMPONENT';

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
  importSequence?: string;

  @IsOptional()
  @IsString()
  sourceImportSessionId?: string;

  @IsOptional()
  @IsString()
  sourceImportFileId?: string;

  @IsOptional()
  @IsString()
  sourceImportFileName?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  sourceImportRowNo?: number;

  @IsOptional()
  @IsString()
  projectModel?: string;

  @IsOptional()
  @IsDateString()
  drawingDate?: string;

  @IsOptional()
  @IsString()
  drawingStatus?: string;

  @IsString()
  partCode!: string;

  @IsString()
  partName!: string;

  @IsOptional()
  @IsString()
  drawingNo?: string;

  @IsOptional()
  @IsString()
  drawingVersion?: string;

  @IsOptional()
  @IsString()
  drawingFileName?: string;

  @IsOptional()
  @IsString()
  drawingFileUrl?: string;

  @IsNumber()
  @Min(0)
  partThickness!: number;

  @IsOptional()
  @IsString()
  partSpecification?: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  productionPlanQuantity?: number;

  @IsOptional()
  @IsString()
  productionPlanOverrideByCode?: string;

  @IsOptional()
  @IsString()
  productionPlanOverrideReason?: string;

  @IsOptional()
  @IsEnum(OrderLineFulfillmentMode)
  fulfillmentMode?: OrderLineFulfillmentMode;

  @IsString()
  unit!: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessStepDto)
  processSteps?: ProcessStepDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockSourceSelectionDto)
  selectedStockSources?: StockSourceSelectionDto[];
}

export class CreateOrderDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];
}

export class CreateOrderImportSessionDto {
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class ListOrderImportSessionQueryDto {
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
  includeTestFixtures?: string;
}

export class GetOrderImportSessionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  orderLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  orderOffset?: number;
}

export class GetOrderImportFilePreviewQueryDto {
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

export class CommitOrderImportSessionDto {
  @IsOptional()
  @IsBoolean()
  allSelectable?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  orderNos?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedOrderNos?: string[];

  @IsOptional()
  @IsString()
  previewToken?: string;
}

export class UpdateOrderDto {
  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];
}

export class UpdateLineProcessDto {
  @IsString()
  @IsNotEmpty()
  configuredByCode!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessStepDto)
  steps!: ProcessStepDto[];
}

export class SubmitOrderDto {
  @IsString()
  @IsNotEmpty()
  submittedByCode!: string;

  @IsOptional()
  @IsBoolean()
  materialIdentityConfirmed?: boolean;
}

export class CreateLineReplenishmentDto {
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  managerName?: string;
}

export class CreateAdditionalMaterialDto extends CreateOrderLineDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  managerName?: string;
}

export class UpdateLineQuantityDto {
  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  productionPlanQuantity?: number;

  @IsOptional()
  @IsString()
  productionPlanOverrideByCode?: string;

  @IsOptional()
  @IsString()
  productionPlanOverrideReason?: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  managerName?: string;
}

export class ResolveLineShortageDto {
  @IsIn(['NO_REPLENISHMENT'])
  resolutionMode!: 'NO_REPLENISHMENT';

  @IsString()
  @IsNotEmpty()
  managerName!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class CancelOrderHandlingPlanItemDto {
  @IsString()
  @IsNotEmpty()
  orderLineId!: string;

  @IsString()
  @IsNotEmpty()
  productionTaskNo!: string;

  @IsIn(['STOCK', 'SCRAP', 'NONE'])
  handlingMode!: 'STOCK' | 'SCRAP' | 'NONE';

  @IsOptional()
  @IsNumber()
  @Min(0)
  handlingQuantity?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class CancelOrderDto {
  @IsString()
  reason!: string;

  @IsString()
  @IsNotEmpty()
  managerName!: string;

  @IsOptional()
  @IsIn(['NOT_PRODUCED', 'PRODUCED'])
  productionCancelState?: 'NOT_PRODUCED' | 'PRODUCED';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CancelOrderHandlingPlanItemDto)
  handlingPlan?: CancelOrderHandlingPlanItemDto[];
}

export class CancelStartedOrderDto extends CancelOrderDto {}

export class CancelReplenishmentDto extends CancelOrderDto {}
