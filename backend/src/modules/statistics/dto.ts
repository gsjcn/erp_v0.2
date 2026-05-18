import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum StatisticsPeriod {
  YEAR = 'year',
  QUARTER = 'quarter',
  MONTH = 'month'
}

export class OrderStatisticsQueryDto {
  @IsOptional()
  @IsEnum(StatisticsPeriod)
  period?: StatisticsPeriod;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  inventorySnapshotLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  inventorySnapshotOffset?: number;
}
