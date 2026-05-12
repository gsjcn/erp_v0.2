import { CommonStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class MaterialDashboardQueryDto {
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
  @IsIn(['COMMON', 'CUSTOM'])
  scopeType?: 'COMMON' | 'CUSTOM';

  @IsOptional()
  @IsString()
  drawingNo?: string;

  @IsOptional()
  @IsString()
  drawingStatus?: string;

  @IsOptional()
  @IsString()
  drawingDateFrom?: string;

  @IsOptional()
  @IsString()
  drawingDateTo?: string;

  @IsOptional()
  @IsString()
  lastOrderDateFrom?: string;

  @IsOptional()
  @IsString()
  lastOrderDateTo?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;
}

export class MaterialProjectOptionsQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;
}
