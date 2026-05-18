import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

const materialStockAlertFilterValues = ['ALL', 'ENABLED', 'TRIGGERED', 'DISABLED'] as const;
export type MaterialStockAlertFilter = (typeof materialStockAlertFilterValues)[number];
const materialDashboardStatusFilterValues = ['ALL', 'ENABLED', 'DISABLED'] as const;
export type MaterialDashboardStatusFilter = (typeof materialDashboardStatusFilterValues)[number];

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
  @IsIn(['BOM', 'APPLICABILITY', 'ORDER_HISTORY', 'MATERIAL_ONLY'])
  relationType?: 'BOM' | 'APPLICABILITY' | 'ORDER_HISTORY' | 'MATERIAL_ONLY';

  @IsOptional()
  @IsString()
  drawingNo?: string;

  @IsOptional()
  @IsString()
  drawingStatus?: string;

  @IsOptional()
  @IsIn(['BOM_LINE', 'MATERIAL_DEFAULT', 'MATERIAL_LATEST', 'ORDER_HISTORY', 'NONE'])
  drawingSource?: 'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST' | 'ORDER_HISTORY' | 'NONE';

  @IsOptional()
  @IsIn(['COMPONENT', 'CHILD_PART', 'STANDALONE_PART', 'NONE'])
  bomStructureType?: 'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART' | 'NONE';

  @IsOptional()
  @IsIn(['WITH_BOM', 'WITHOUT_BOM'])
  bomPresence?: 'WITH_BOM' | 'WITHOUT_BOM';

  @IsOptional()
  @IsIn(['WITH_RECENT_ORDER', 'WITHOUT_RECENT_ORDER'])
  recentOrderPresence?: 'WITH_RECENT_ORDER' | 'WITHOUT_RECENT_ORDER';

  @IsOptional()
  @IsIn(materialStockAlertFilterValues)
  stockAlert?: MaterialStockAlertFilter;

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
  @IsIn(materialDashboardStatusFilterValues)
  status?: MaterialDashboardStatusFilter;

  @IsOptional()
  @IsIn(['LAST_ORDER_DATE', 'DRAWING_DATE', 'BOM_STATUS', 'PART_CODE'])
  sortBy?: 'LAST_ORDER_DATE' | 'DRAWING_DATE' | 'BOM_STATUS' | 'PART_CODE';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC';

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

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
}

export class MaterialProjectOptionsQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  includeTestFixtures?: string;
}

export class SaveCommonProjectModelsDto {
  @IsArray()
  @IsString({ each: true })
  projectModels!: string[];
}
