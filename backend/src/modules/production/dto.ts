import { Type } from 'class-transformer';
import { ProductionStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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

export class CompleteProductionDto {
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  completedQuantity?: number;

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
