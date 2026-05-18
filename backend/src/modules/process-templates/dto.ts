import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { CommonStatus } from '@prisma/client';

export class ProcessTemplateQueryDto {
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

export class ProcessTemplateStepDto {
  @IsString()
  @IsNotEmpty()
  processName!: string;

  @IsOptional()
  @IsString()
  processRemark?: string;
}

export class CreateProcessTemplateDto {
  @IsString()
  @IsNotEmpty()
  templateName!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessTemplateStepDto)
  steps!: ProcessTemplateStepDto[];

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateProcessTemplateDto {
  @IsOptional()
  @IsString()
  templateName?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessTemplateStepDto)
  steps?: ProcessTemplateStepDto[];

  @IsOptional()
  @IsString()
  remark?: string;
}
