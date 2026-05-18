import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { CommonStatus } from '@prisma/client';

export class ProcessDefinitionQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsIn(['ENABLED', 'DISABLED', 'ALL'])
  status?: CommonStatus | 'ALL';

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

export class CreateProcessDefinitionDto {
  @IsString()
  @IsNotEmpty()
  processName!: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateProcessDefinitionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  processName?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}
