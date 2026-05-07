import { Type } from 'class-transformer';
import { ProductionNoticeStatus, ProductionNoticeTarget, ProductionStatus } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested
} from 'class-validator';

export const productionShortageModes = ['REPLENISHMENT', 'MANAGER_APPROVED'] as const;
export const productionWithdrawHandlingModes = ['STOCK', 'SCRAP', 'NONE'] as const;

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
}

export class AcknowledgeProductionNoticeDto {
  @IsString()
  acknowledgedBy!: string;
}

export class ProductionScrapQueryDto {
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

export class CompleteProductionDto {
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
}
