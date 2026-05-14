import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
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
  @MaxLength(30)
  processName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;
}

export class UpdateProcessDefinitionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  processName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}
