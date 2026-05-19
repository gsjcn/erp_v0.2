import { Type } from 'class-transformer';
import { ProductionNoticeStatus, ProductionNoticeTarget, ProductionNoticeType, ProductionStatus } from '@prisma/client';
import {
  ArrayMinSize,
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
  Max,
  Min,
  ValidateNested
} from 'class-validator';

export const productionShortageModes = ['REPLENISHMENT_REQUEST', 'REPLENISHMENT', 'MANAGER_APPROVED'] as const;
export const productionWithdrawHandlingModes = ['STOCK', 'SCRAP', 'NONE'] as const;
export const productionReplenishmentRequestStatuses = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const productionExportViewModes = ['ORDER_SUMMARY', 'TASK_DETAIL'] as const;
export const productionExportStatuses = [
  'ALL',
  'ACTIVE',
  'PENDING',
  'IN_PROGRESS',
  'WAITING_CONFIRMATION',
  'READY_TO_COMPLETE',
  'COMPLETED',
  'RECEIVED',
  'STORED',
  'CANCELLED'
] as const;

export class ProductionOperatorQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;
}

export class ProductionNoticeQueryDto {
  @IsOptional()
  @IsEnum(ProductionNoticeStatus)
  status?: ProductionNoticeStatus;

  @IsOptional()
  @IsEnum(ProductionNoticeTarget)
  target?: ProductionNoticeTarget;

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

export class AcknowledgeProductionNoticeDto {
  @IsString()
  acknowledgedBy!: string;
}

export class ApproveProductionReplenishmentRequestDto {
  @IsString()
  managerName!: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class RejectProductionReplenishmentRequestDto {
  @IsString()
  managerName!: string;

  @IsString()
  reason!: string;
}

export class ProductionReplenishmentRequestQueryDto {
  @IsOptional()
  @IsIn(productionReplenishmentRequestStatuses)
  status?: (typeof productionReplenishmentRequestStatuses)[number];

  @IsOptional()
  @IsString()
  keyword?: string;

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

export class ProductionScrapQueryDto {
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

export class ProductionTaskQueryDto {
  @IsOptional()
  @IsEnum(ProductionStatus)
  status?: ProductionStatus;

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
  @IsIn(productionExportStatuses)
  displayStatus?: (typeof productionExportStatuses)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset?: number;

  @IsOptional()
  @IsString()
  withPage?: string;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
}

export class ProductionExportQueryDto extends ProductionTaskQueryDto {
  @IsOptional()
  @IsIn(productionExportViewModes)
  viewMode?: (typeof productionExportViewModes)[number];
}

export class WithdrawProductionTaskDto {
  @IsString()
  managerName!: string;

  @IsString()
  reason!: string;

  @IsIn(productionWithdrawHandlingModes)
  handlingMode!: (typeof productionWithdrawHandlingModes)[number];

  @IsNumber()
  @Min(0)
  handlingQuantity!: number;

  @IsOptional()
  @IsDateString()
  handledAt?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class StartProductionDto {
  @IsString()
  @IsNotEmpty()
  supervisorCode!: string;
}

export class BatchStartProductionDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  taskIds!: string[];

  @IsString()
  @IsNotEmpty()
  supervisorCode!: string;
}

export class CompleteProductionDto {
  @IsString()
  @IsNotEmpty()
  supervisorCode!: string;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  completedQuantity?: number;

  @IsOptional()
  @IsString()
  operatorCode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operatorCodes?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  scrapQuantity?: number;

  @IsOptional()
  @IsIn(productionShortageModes)
  shortageMode?: (typeof productionShortageModes)[number];

  @IsOptional()
  @IsBoolean()
  createReplenishment?: boolean;

  @IsOptional()
  @IsString()
  managerName?: string;

  @IsOptional()
  @IsString()
  shortageReason?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class ProcessOperatorAssignmentDto {
  @IsString()
  processName!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operatorCodes?: string[];
}

export class CompleteProcessStepDto {
  @IsString()
  processName!: string;

  @IsBoolean()
  isCompleted!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  completedQuantity?: number;

  @IsOptional()
  @IsString()
  operatorCode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operatorCodes?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  scrapQuantity?: number;

  @IsOptional()
  @IsIn(productionShortageModes)
  shortageMode?: (typeof productionShortageModes)[number];

  @IsOptional()
  @IsBoolean()
  createReplenishment?: boolean;

  @IsOptional()
  @IsString()
  managerName?: string;

  @IsOptional()
  @IsString()
  shortageReason?: string;

  @IsOptional()
  @IsString()
  quantityOverrideReason?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class CompleteProcessStepsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  processNames!: string[];

  @IsNumber()
  @Min(0.001)
  completedQuantity!: number;

  @IsOptional()
  @IsString()
  operatorCode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operatorCodes?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessOperatorAssignmentDto)
  operatorsByProcess?: ProcessOperatorAssignmentDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  scrapQuantity?: number;

  @IsOptional()
  @IsIn(productionShortageModes)
  shortageMode?: (typeof productionShortageModes)[number];

  @IsOptional()
  @IsBoolean()
  createReplenishment?: boolean;

  @IsOptional()
  @IsString()
  managerName?: string;

  @IsOptional()
  @IsString()
  shortageReason?: string;

  @IsOptional()
  @IsString()
  quantityOverrideReason?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class ProductionAnnualSummaryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year?: number;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
}
