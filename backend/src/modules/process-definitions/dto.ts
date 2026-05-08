import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CommonStatus } from '@prisma/client';

export class ProcessDefinitionQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
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
