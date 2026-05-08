import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class ProcessTemplateQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;
}

export class ProcessTemplateStepDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  processName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  processRemark?: string;
}

export class CreateProcessTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  templateName!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessTemplateStepDto)
  steps!: ProcessTemplateStepDto[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  remark?: string;
}

export class UpdateProcessTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  templateName?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessTemplateStepDto)
  steps?: ProcessTemplateStepDto[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  remark?: string;
}
