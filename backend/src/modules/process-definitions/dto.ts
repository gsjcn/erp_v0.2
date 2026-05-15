import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CommonStatus } from '@prisma/client';

export class ProcessDefinitionQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsIn(['ENABLED', 'DISABLED', 'ALL'])
  status?: CommonStatus | 'ALL';
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
