import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { OrderLineFulfillmentMode, OrderStatus } from '@prisma/client';

export class OrderQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class NextOrderNoQueryDto {
  @IsOptional()
  @IsDateString()
  orderDate?: string;
}

export class CheckOrderNoQueryDto {
  @IsString()
  @IsNotEmpty()
  orderNo!: string;

  @IsOptional()
  @IsString()
  excludeOrderNo?: string;
}

export class DrawingDuplicateQueryDto {
  @IsString()
  @IsNotEmpty()
  value!: string;

  @IsOptional()
  @IsString()
  excludeOrderNo?: string;
}

export class ProcessStepDto {
  @IsString()
  @IsNotEmpty()
  processName!: string;

  @IsOptional()
  @IsString()
  processRemark?: string;
}

export class CreateOrderLineDto {
  @IsString()
  partCode!: string;

  @IsString()
  partName!: string;

  @IsOptional()
  @IsString()
  drawingNo?: string;

  @IsOptional()
  @IsString()
  drawingVersion?: string;

  @IsOptional()
  @IsString()
  drawingFileName?: string;

  @IsOptional()
  @IsString()
  drawingFileUrl?: string;

  @IsNumber()
  @Min(0.001)
  partThickness!: number;

  @IsOptional()
  @IsString()
  partSpecification?: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  productionPlanQuantity?: number;

  @IsOptional()
  @IsEnum(OrderLineFulfillmentMode)
  fulfillmentMode?: OrderLineFulfillmentMode;

  @IsString()
  unit!: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessStepDto)
  processSteps?: ProcessStepDto[];
}

export class CreateOrderDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];
}

export class UpdateOrderDto {
  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];
}

export class UpdateLineProcessDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessStepDto)
  steps!: ProcessStepDto[];
}

export class CreateLineReplenishmentDto {
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  managerName?: string;
}

export class CreateAdditionalMaterialDto extends CreateOrderLineDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  managerName?: string;
}

export class UpdateLineQuantityDto {
  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  productionPlanQuantity?: number;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  managerName?: string;
}

export class CancelOrderDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  managerName?: string;
}

export class CancelStartedOrderDto extends CancelOrderDto {}

export class CancelReplenishmentDto extends CancelOrderDto {}
