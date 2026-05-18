import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommonStatus, InventoryReservationStatus, OrderStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { normalizeSearchKeyword, pinyinSearchMatches } from '../../common/pinyin-search';
import { normalizeMultipartFileName } from '../../common/upload-filenames';
import { decimalToNumber } from '../../common/serializers';
import { runSerializableTransaction } from '../../common/transactions';
import { businessDateTimeKey } from '../../common/business-date';
import { PrismaService } from '../../prisma/prisma.service';
import { inventoryAdjustmentUploadPath, materialImportUploadPath } from '../../storage/upload-paths';
import { ProcessDefinitionsService } from '../process-definitions/process-definitions.service';
import * as ExcelJS from 'exceljs';
import {
  AdjustInventoryBatchDto,
  CommitModelBomDraftFromOrderImportDto,
  CommitMaterialImportSessionDto,
  ConfirmModelBomDiffReviewDto,
  CopyModelBomDto,
  CreateMaterialDto,
  CreateMaterialImportFromOrderImportDto,
  CreateMaterialImportSessionDto,
  CreateModelBomDraftFromOrderImportDto,
  CreateModelBomScopeApprovalRequestDto,
  GetMaterialImportSessionQueryDto,
  InventoryQueryDto,
  InventorySourceDetailQueryDto,
  MaterialQueryDto,
  MaterialSuggestionQueryDto,
  MaterialTransformRuleQueryDto,
  ModelBomDiffReviewQueryDto,
  ModelBomQueryDto,
  ModelBomRevisionQueryDto,
  ModelBomScopeApprovalRequestQueryDto,
  ReorderModelBomCommonDto,
  ReorderModelBomLinesDto,
  ReviewModelBomScopeApprovalRequestDto,
  SaveMaterialDrawingRevisionDto,
  SaveMaterialApplicabilityDto,
  SaveMaterialTransformRuleDto,
  SetModelBomCommonDto,
  SetModelBomsCommonBatchDto,
  SaveModelBomDto,
  SaveModelBomLineDto,
  UpdateMaterialDto,
  type StockAlertFilter
} from './dto';

type InventorySummaryAccumulator = {
  partCode: string;
  partName: string;
  unit: string;
  batchCount: number;
  warehouseIds: Set<string>;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  usedQuantity: number;
  totalQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
  normalOrderStockQuantity: number;
  cancelledOrderStockQuantity: number;
  customerChangeStockQuantity: number;
  warehouses: Map<
    string,
    {
      warehouseId: string;
      warehouseName: string;
      reservedQuantity: number;
      availableQuantity: number;
      batchCount: number;
    }
  >;
};

type InventoryExportCellValue = string | number | Date | null | undefined;

type ModelBomDraftExistingLineForDiff = {
  id?: string;
  partCodeSnapshot: string;
  partNameSnapshot: string;
  unitSnapshot: string;
  partSpecificationSnapshot: string | null;
  partThicknessSnapshot?: Prisma.Decimal | number | null;
  lineType: string;
  partCategory: string | null;
  componentNo: string | null;
  parentComponentNo: string | null;
  defaultProcessRoute: string | null;
  defaultQuantity: Prisma.Decimal | number;
};

type ModelBomDraftLineForDiff = {
  sourceRowNo?: number;
  orderNo?: string;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  partThickness?: number | null;
  lineType: string;
  partCategory?: string | null;
  componentNo?: string | null;
  parentComponentNo?: string | null;
  defaultProcessRoute?: string | null;
  defaultQuantity: number;
};

type MaterialSuggestionBase = {
  materialId?: string;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  defaultProcessRoute?: string | null;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: Date | null;
  drawingStatus?: string | null;
  drawingFileName?: string | null;
  drawingFileUrl?: string | null;
  partThickness?: number | null;
  projectModel?: string | null;
};

const MATERIAL_SUGGESTION_HISTORY_CUSTOMER_PREVIEW_LIMIT = 20;

type ModelBomCustomerScopeMode = 'ALL' | 'PRIVATE' | 'SELECTED';

type ModelBomSortableRow = {
  id: string;
  customerId: string | null;
  customerScopeMode?: string | null;
  customerScopeKey: string;
  customerScopes?: Array<{ customerId: string; status: CommonStatus }>;
  projectModel: string;
  projectModelScopeKey: string;
  isCommon?: boolean | null;
  commonSortOrder?: number | null;
  bomName: string;
};

type ModelBomDisplayOrderLine = {
  id: string;
  sortOrder: number;
  status: CommonStatus;
  lineType: string;
  componentNo: string | null;
  parentComponentNo: string | null;
  material?: { status: CommonStatus } | null;
};

type MaterialSuggestionHistory = {
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: Date | null;
  drawingStatus?: string | null;
  drawingFileName?: string | null;
  drawingFileUrl?: string | null;
  partThickness?: number | null;
  projectModel?: string | null;
  usageCount: number;
  customerUsageCount: number;
  lastCustomerCode?: string;
  lastCustomerName?: string;
  lastCustomerOrderNo?: string;
  lastCustomerOrderDate?: Date | null;
  matchedCustomerCode?: string;
  matchedCustomerName?: string;
  matchedHistoryOrderNo?: string;
  hasQueryCustomerHistory?: boolean;
  lastCustomerOrderBelongsToQueryCustomer?: boolean;
  queryCustomerSnapshotOrderDate?: Date | null;
  queryCustomerSnapshotCreatedAt?: Date | null;
  identityKeys: Set<string>;
  identityFieldValues: Map<string, Set<string>>;
  identityVariantCount?: number;
  historyCustomerNames: Set<string>;
};

type ModelBomThicknessSnapshot = {
  partThickness: number;
  orderTime: number;
  lineTime: number;
};

type ModelBomThicknessScope = {
  customerId?: string | null;
  projectModel?: string | null;
};

const materialSuggestionIdentityFieldLabels: Record<string, string> = {
  partName: '名称',
  partSpecification: '规格',
  drawingNo: '图号',
  drawingVersion: '版本',
  drawingDate: '图纸日期',
  drawingStatus: '图纸状态',
  partThickness: '厚度',
  projectModel: '项目型号'
};

type InventoryCustomerScope = {
  customerId: string;
  customerName?: string;
  orderNos: string[];
  productionTaskNos: string[];
};

type StockReservationPriorityOrder = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  createdAt: Date;
};

type MaterialMemoryRow = {
  id: string;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  defaultProcessRoute?: string | null;
  stockAlertEnabled: boolean;
  stockAlertQuantity?: Prisma.Decimal | number | null;
  status: CommonStatus;
};

type StockAlertComparableRow = {
  materialId?: string;
  stockAlertEnabled: boolean;
  stockAlertQuantity?: number | null;
  availableQuantity: number;
};

type MaterialImportIssue = {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
};

type OrderImportRowWithFile = Prisma.OrderImportRowGetPayload<{
  include: { file: { select: { fileName: true; sheetName: true } } };
}>;

type ParsedMaterialImportRow = {
  sourceRowNo: number;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  defaultProcessRoute?: string | null;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: Date | null;
  drawingStatus?: string | null;
  partThickness?: number | null;
  projectModel?: string | null;
  stockAlertEnabled?: boolean | null;
  stockAlertQuantity?: number | null;
  remark?: string | null;
  raw: Record<string, string | number | null>;
  rowHash: string;
  issues: MaterialImportIssue[];
  errorCount: number;
  warningCount: number;
};

type ParsedMaterialImportIssueRow = {
  issues: MaterialImportIssue[];
  errorCount: number;
  warningCount: number;
};

type ParsedMaterialApplicabilityImportRow = ParsedMaterialImportIssueRow & {
  sourceRowNo: number;
  partCode: string;
  customerCode?: string | null;
  customerName?: string | null;
  projectModel?: string | null;
  remark?: string | null;
  status: CommonStatus;
  raw: Record<string, string | number | null>;
  rowHash: string;
};

type ParsedMaterialTransformImportRow = ParsedMaterialImportIssueRow & {
  sourceRowNo: number;
  sourcePartCode: string;
  targetPartCode: string;
  customerCode?: string | null;
  customerName?: string | null;
  projectModel?: string | null;
  multiplier?: number | null;
  lossRate?: number | null;
  defaultProcessRoute?: string | null;
  conversionDescription?: string | null;
  remark?: string | null;
  status: CommonStatus;
  raw: Record<string, string | number | null>;
  rowHash: string;
};

const materialImportSheetName = '零件基础库';
const materialApplicabilityImportSheetName = '适用范围';
const materialTransformImportSheetName = '来源加工关系';
const materialImportRequiredHeaders = ['零件编码', '零件名称', '单位'];
const materialImportHeaderAliases: Record<string, string[]> = {
  partCode: ['零件编码', '物料号', '物料编码', 'partCode', '编码'],
  partName: ['零件名称', '物料名称', 'partName', '名称'],
  unit: ['单位', 'unit'],
  partSpecification: ['成品规格', '规格', 'partSpecification'],
  defaultProcessRoute: ['默认工艺', '建议工艺', 'defaultProcessRoute'],
  drawingNo: ['图号', 'drawingNo'],
  drawingVersion: ['图纸版本', '版本', 'drawingVersion'],
  drawingDate: ['图纸日期', 'drawingDate'],
  drawingStatus: ['图纸状态', 'drawingStatus'],
  partThickness: ['厚度', '厚度(mm)', 'partThickness'],
  projectModel: ['项目型号', '机型', 'projectModel'],
  stockAlertEnabled: ['库存报警', '启用库存报警', '是否启用库存报警', 'stockAlertEnabled'],
  stockAlertQuantity: ['最小库存', '最低库存', '库存报警数量', 'stockAlertQuantity'],
  remark: ['备注', 'remark']
};
const materialApplicabilityImportRequiredHeaders = ['零件编码'];
const materialApplicabilityImportHeaderAliases: Record<string, string[]> = {
  partCode: ['零件编码', '物料号', '物料编码', 'partCode', '编码'],
  customerCode: ['客户编码', 'customerCode'],
  customerName: ['客户名称', '客户', 'customerName'],
  projectModel: ['项目型号', '机型', 'projectModel'],
  status: ['状态', 'status'],
  remark: ['备注', 'remark']
};
const materialTransformImportRequiredHeaders = ['来源零件编码', '目标零件编码'];
const materialTransformImportHeaderAliases: Record<string, string[]> = {
  sourcePartCode: ['来源零件编码', '来源物料编码', '来源编码', 'sourcePartCode'],
  targetPartCode: ['目标零件编码', '目标物料编码', '目标编码', 'targetPartCode'],
  customerCode: ['客户编码', 'customerCode'],
  customerName: ['客户名称', '客户', 'customerName'],
  projectModel: ['项目型号', '机型', 'projectModel'],
  multiplier: ['倍率', '用量倍率', 'multiplier'],
  lossRate: ['损耗率', 'lossRate'],
  defaultProcessRoute: ['默认工艺', '建议工艺', 'defaultProcessRoute'],
  conversionDescription: ['转换说明', '加工说明', 'conversionDescription'],
  status: ['状态', 'status'],
  remark: ['备注', 'remark']
};

const materialImportSessionMaterialIssueCodes = new Set([
  'DUPLICATE_PART_CONFLICT',
  'DUPLICATE_STOCK_ALERT_CONFLICT',
  'DUPLICATE_DEFAULT_PROCESS_ROUTE_CONFLICT',
  'DUPLICATE_DRAWING_REVISION_CONFLICT',
  'EXISTING_MATERIAL_DIFFERENT',
  'ORDER_HISTORY_DIFFERENT',
  'EXISTING_DRAWING_REVISION_DIFFERENT',
  'INVALID_DEFAULT_PROCESS_ROUTE'
]);
const materialImportSessionApplicabilityIssueCodes = new Set([
  'DUPLICATE_SCOPE_CONFLICT',
  'UNKNOWN_PART_CODE',
  'INVALID_CUSTOMER'
]);
const materialImportSessionTransformIssueCodes = new Set([
  'DUPLICATE_TRANSFORM_CONFLICT',
  'UNKNOWN_SOURCE_PART_CODE',
  'UNKNOWN_TARGET_PART_CODE',
  'INVALID_CUSTOMER',
  'INVALID_DEFAULT_PROCESS_ROUTE'
]);

const adjustmentAttachmentPrefix = '/uploads/inventory-adjustments/';
const allowedAdjustmentExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff']);
const allowedAdjustmentMimeTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/gif',
  'image/tiff'
]);
const genericUploadMimeTypes = new Set(['', 'application/octet-stream']);

@Injectable()
export class InventoryService {
  private readonly testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly processDefinitionsService: ProcessDefinitionsService
  ) {}

  private hasTestFixturePrefix(...values: Array<string | null | undefined>) {
    return values.some((value) => {
      const text = String(value || '').trim();
      return this.testFixturePrefixes.some((prefix) => text.startsWith(prefix));
    });
  }

  private isTestFixtureMaterial(material: { partCode?: string | null; partName?: string | null; status?: CommonStatus | null }) {
    return this.hasTestFixturePrefix(material.partCode, material.partName);
  }

  private isDisabledTestFixtureModelBom(row: { bomName?: string | null; projectModel?: string | null; status?: CommonStatus | null }) {
    return row.status === CommonStatus.DISABLED && this.hasTestFixturePrefix(row.bomName, row.projectModel);
  }

  private isTestFixtureMaterialTransformRule(row: {
    customerNameSnapshot?: string | null;
    projectModel?: string | null;
    conversionDescription?: string | null;
    defaultProcessRoute?: string | null;
    remark?: string | null;
    customer?: { customerCode?: string | null; customerName?: string | null } | null;
    sourceMaterial?: { partCode?: string | null; partName?: string | null } | null;
    targetMaterial?: { partCode?: string | null; partName?: string | null } | null;
  }) {
    return this.hasTestFixturePrefix(
      row.customerNameSnapshot,
      row.projectModel,
      row.conversionDescription,
      row.defaultProcessRoute,
      row.remark,
      row.customer?.customerCode,
      row.customer?.customerName,
      row.sourceMaterial?.partCode,
      row.sourceMaterial?.partName,
      row.targetMaterial?.partCode,
      row.targetMaterial?.partName
    );
  }

  private modelBomScopeApprovalFixtureWhere(): Prisma.ModelBomScopeApprovalRequestWhereInput {
    return {
      OR: this.testFixturePrefixes.flatMap((prefix) => [
        { requestNo: { startsWith: prefix } },
        { requestedBomName: { startsWith: prefix } },
        { requestedCustomerNameSnapshot: { startsWith: prefix } },
        { requestedProjectModel: { startsWith: prefix } },
        { requestedScopeKey: { startsWith: prefix } },
        { requestedProjectModelScopeKey: { startsWith: prefix } },
        { bom: { is: { bomName: { startsWith: prefix } } } },
        { bom: { is: { projectModel: { startsWith: prefix } } } },
        { bom: { is: { customerNameSnapshot: { startsWith: prefix } } } }
      ])
    };
  }

  private isTestFixtureInventoryBatch(batch: {
    batchNo?: string | null;
    partCode?: string | null;
    partName?: string | null;
    sourceOrderNo?: string | null;
    sourceCustomerName?: string | null;
    sourceProductionTaskNo?: string | null;
    replenishmentSourceRequestNo?: string | null;
    sourceOrder?: { orderNo?: string | null; customerName?: string | null } | null;
    productionTask?: { orderNo?: string | null; productionTaskNo?: string | null; customerName?: string | null; order?: { orderNo?: string | null; customerName?: string | null } | null } | null;
  }) {
    return this.hasTestFixturePrefix(
      batch.batchNo,
      batch.partCode,
      batch.partName,
      batch.sourceOrderNo,
      batch.sourceCustomerName,
      batch.sourceProductionTaskNo,
      batch.replenishmentSourceRequestNo,
      batch.sourceOrder?.orderNo,
      batch.sourceOrder?.customerName,
      batch.productionTask?.productionTaskNo,
      batch.productionTask?.orderNo,
      batch.productionTask?.customerName,
      batch.productionTask?.order?.orderNo,
      batch.productionTask?.order?.customerName
    );
  }

  private async resolveInventoryCustomerScope(customerId?: string): Promise<InventoryCustomerScope | null> {
    const normalizedCustomerId = customerId?.trim();
    if (!normalizedCustomerId) {
      return null;
    }

    const [customer, orders, productionTasks] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: normalizedCustomerId },
        select: { customerName: true }
      }),
      this.prisma.customerOrder.findMany({
        where: { customerId: normalizedCustomerId },
        select: { orderNo: true }
      }),
      this.prisma.productionTask.findMany({
        where: { order: { customerId: normalizedCustomerId } },
        select: { productionTaskNo: true }
      })
    ]);

    return {
      customerId: normalizedCustomerId,
      customerName: customer?.customerName?.trim() || undefined,
      orderNos: orders.map((order) => order.orderNo).filter(Boolean),
      productionTaskNos: productionTasks.map((task) => task.productionTaskNo).filter(Boolean)
    };
  }

  private inventoryBatchMatchesCustomerScope(batch: any, customerScope: InventoryCustomerScope) {
    const orderNoSet = new Set(customerScope.orderNos);
    const taskNoSet = new Set(customerScope.productionTaskNos);
    const sourceCustomerName = String(batch.sourceCustomerName || '').trim();
    return Boolean(
      batch.sourceOrder?.customerId === customerScope.customerId ||
        batch.productionTask?.order?.customerId === customerScope.customerId ||
        (batch.sourceOrderNo && orderNoSet.has(batch.sourceOrderNo)) ||
        (batch.sourceProductionTaskNo && taskNoSet.has(batch.sourceProductionTaskNo)) ||
        (customerScope.customerName && sourceCustomerName === customerScope.customerName)
    );
  }

  private async buildInventoryWhere(query: InventoryQueryDto) {
    const where: Prisma.InventoryBatchWhereInput = {};
    const andConditions: Prisma.InventoryBatchWhereInput[] = [];

    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }

    const customerScope = await this.resolveInventoryCustomerScope(query.customerId);
    if (customerScope) {
      // 客户筛选既要看到当前订单库存，也要看到该客户订单生产后转出的备货库存。
      // 旧库存可能只保留 sourceProductionTaskNo / sourceOrderNo，没有 productionTaskId 关系，因此这里必须用多种来源字段兜底。
      const customerOrConditions: Prisma.InventoryBatchWhereInput[] = [
        { sourceOrder: { is: { customerId: customerScope.customerId } } },
        { productionTask: { is: { order: { customerId: customerScope.customerId } } } }
      ];
      if (customerScope.orderNos.length > 0) {
        customerOrConditions.push({ sourceOrderNo: { in: customerScope.orderNos } });
      }
      if (customerScope.productionTaskNos.length > 0) {
        customerOrConditions.push({ sourceProductionTaskNo: { in: customerScope.productionTaskNos } });
      }
      if (customerScope.customerName) {
        customerOrConditions.push({ sourceCustomerName: { equals: customerScope.customerName } });
      }
      andConditions.push({ OR: customerOrConditions });
    }

    const orderNo = query.orderNo?.trim();
    if (orderNo) {
      // 库存可能是当前订单库存，也可能是由历史生产任务转成的备货库存；订单号筛选必须同时覆盖这两类来源。
      andConditions.push({
        OR: [
          { sourceOrderNo: { contains: orderNo, mode: 'insensitive' } },
          { sourceProductionTaskNo: { contains: orderNo, mode: 'insensitive' } },
          { replenishmentSourceRequestNo: { contains: orderNo, mode: 'insensitive' } },
          { productionTask: { is: { orderNo: { contains: orderNo, mode: 'insensitive' } } } }
        ]
      });
    }

    if (query.status) {
      where.status = query.status;
      if (query.status === 'AVAILABLE') {
        where.quantity = { gt: 0 };
      }
    }
    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    return where;
  }

  private isPhysicalInventoryBatchStatus(status?: string | null) {
    return status === 'AVAILABLE' || status === 'RESERVED';
  }

  private inventoryBatchReservedQuantity(status: string | null | undefined, storedQuantity: number, activeReservationQuantity: number) {
    // RESERVED 批次代表仍有实物但已不可作为新订单可用库存，展示时必须计入预占而不是已使用。
    return status === 'RESERVED' ? storedQuantity : activeReservationQuantity;
  }

  private async buildInventoryOutTransactionWhere(query: InventoryQueryDto) {
    if (query.status && query.status !== 'USED') {
      return null;
    }

    const where: Prisma.InventoryTransactionWhereInput = { transactionType: 'OUT' };
    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }
    const orderNo = query.orderNo?.trim();
    if (orderNo) {
      // 出库流水也要支持用生产任务号里的订单号反查，方便核对备货库存来源。
      where.OR = [
        { orderNo: { contains: orderNo, mode: 'insensitive' } },
        { productionTaskNo: { contains: orderNo, mode: 'insensitive' } },
        { batch: { sourceOrderNo: { contains: orderNo, mode: 'insensitive' } } },
        { batch: { sourceProductionTaskNo: { contains: orderNo, mode: 'insensitive' } } },
        { batch: { productionTask: { is: { orderNo: { contains: orderNo, mode: 'insensitive' } } } } }
      ];
    }
    const customerScope = await this.resolveInventoryCustomerScope(query.customerId);
    if (customerScope) {
      const customerOrConditions: Prisma.InventoryTransactionWhereInput[] = [
        { batch: { sourceOrder: { is: { customerId: customerScope.customerId } } } },
        { batch: { productionTask: { is: { order: { customerId: customerScope.customerId } } } } }
      ];
      if (customerScope.orderNos.length > 0) {
        customerOrConditions.push({ orderNo: { in: customerScope.orderNos } });
        customerOrConditions.push({ batch: { sourceOrderNo: { in: customerScope.orderNos } } });
      }
      if (customerScope.productionTaskNos.length > 0) {
        customerOrConditions.push({ productionTaskNo: { in: customerScope.productionTaskNos } });
        customerOrConditions.push({ batch: { sourceProductionTaskNo: { in: customerScope.productionTaskNos } } });
      }
      if (customerScope.customerName) {
        customerOrConditions.push({ batch: { sourceCustomerName: { equals: customerScope.customerName } } });
      }
      const customerTransactionScope: Prisma.InventoryTransactionWhereInput = {
        OR: customerOrConditions
      };
      where.AND = Array.isArray(where.AND)
        ? [...where.AND, customerTransactionScope]
        : where.AND
          ? [where.AND, customerTransactionScope]
          : [customerTransactionScope];
    }
    return where;
  }

  private async findMaterialsByKeyword(keyword?: string) {
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    const materials = await this.prisma.material.findMany({
      where: {
        status: 'ENABLED'
      },
      include: {
        drawingRevisions: {
          where: { status: 'ENABLED' },
          orderBy: [{ isDefault: 'desc' }, { drawingDate: 'desc' }, { createdAt: 'desc' }]
        }
      },
      orderBy: [{ partCode: 'asc' }, { partName: 'asc' }]
    });
    const rows = materials.map((material) => {
      const drawingRevision = material.drawingRevisions[0] || null;
      return {
        materialId: material.id,
        partCode: material.partCode,
        partName: material.partName,
        unit: material.unit,
        partSpecification: material.partSpecification,
        defaultProcessRoute: material.defaultProcessRoute,
        drawingNo: drawingRevision?.drawingNo ?? null,
        drawingVersion: drawingRevision?.drawingVersion ?? null,
        drawingDate: drawingRevision?.drawingDate ?? null,
        drawingStatus: drawingRevision?.drawingStatus ?? null,
        drawingFileName: drawingRevision?.drawingFileName ?? null,
        drawingFileUrl: drawingRevision?.drawingFileUrl ?? null
      };
    });
    if (!normalizedKeyword) {
      return rows;
    }
    return rows.filter((material) => this.materialMatchesKeyword(material, normalizedKeyword));
  }

  private async findEnabledMaterialMastersByCodes(partCodes: string[]) {
    const uniquePartCodes = [...new Set(partCodes.map((partCode) => partCode.trim()).filter(Boolean))];
    const rows: Array<{
      id: string;
      partCode: string;
      defaultProcessRoute: string | null;
      drawingRevisions: Array<{
        drawingNo: string;
        drawingVersion: string;
        drawingDate: Date | null;
        drawingStatus: string | null;
        drawingFileName: string | null;
        drawingFileUrl: string | null;
      }>;
    }> = [];
    for (let index = 0; index < uniquePartCodes.length; index += 500) {
      const chunk = uniquePartCodes.slice(index, index + 500);
      rows.push(
        ...(await this.prisma.material.findMany({
          where: {
            status: 'ENABLED',
            OR: chunk.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' } }))
          },
          select: {
            id: true,
            partCode: true,
            defaultProcessRoute: true,
            drawingRevisions: {
              where: { status: 'ENABLED' },
              orderBy: [{ isDefault: 'desc' }, { drawingDate: 'desc' }, { createdAt: 'desc' }],
              select: {
                drawingNo: true,
                drawingVersion: true,
                drawingDate: true,
                drawingStatus: true,
                drawingFileName: true,
                drawingFileUrl: true
              }
            }
          }
        }))
      );
    }
    return new Map(
      rows.map((row) => {
        const drawingRevision = row.drawingRevisions[0] || null;
        return [
          row.partCode.trim().toLocaleLowerCase(),
          {
            id: row.id,
            partCode: row.partCode,
            defaultProcessRoute: row.defaultProcessRoute,
            drawingNo: drawingRevision?.drawingNo ?? null,
            drawingVersion: drawingRevision?.drawingVersion ?? null,
            drawingDate: drawingRevision?.drawingDate ?? null,
            drawingStatus: drawingRevision?.drawingStatus ?? null,
            drawingFileName: drawingRevision?.drawingFileName ?? null,
            drawingFileUrl: drawingRevision?.drawingFileUrl ?? null
          }
        ];
      })
    );
  }

  private materialMatchesKeyword(
    material: {
      partCode?: string | null;
      partName?: string | null;
      unit?: string | null;
      partSpecification?: string | null;
      drawingNo?: string | null;
      drawingVersion?: string | null;
      drawingDate?: Date | null;
      drawingStatus?: string | null;
      drawingFileName?: string | null;
    },
    keyword: string
  ) {
    return pinyinSearchMatches(
      [
        material.partCode,
        material.partName,
        material.unit,
        material.partSpecification,
        material.drawingNo,
        material.drawingVersion,
        ...this.materialDateSearchValues(material.drawingDate),
        material.drawingStatus,
        material.drawingFileName
      ],
      keyword
    );
  }

  private normalizeMaterialRequired(value: string | undefined, fieldName: string) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      throw new BadRequestException(`${fieldName}不能为空`);
    }
    return normalized;
  }

  private normalizeMaterialScopeKey(value?: string | null) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.toLocaleUpperCase() : 'ALL';
  }

  private async resolveMaterialApplicabilityScope(dto: SaveMaterialApplicabilityDto) {
    const customerId = String(dto.customerId || '').trim() || null;
    const projectModel = String(dto.projectModel || '').trim() || null;
    const customer = customerId
      ? await this.prisma.customer.findUnique({
          where: { id: customerId },
          select: { id: true, customerName: true }
        })
      : null;
    if (customerId && !customer) {
      throw new BadRequestException('适用客户不存在');
    }
    return {
      customerId: customer?.id || null,
      customerNameSnapshot: customer?.customerName || null,
      projectModel,
      customerScopeKey: customer?.id || 'ALL',
      projectModelScopeKey: this.normalizeMaterialScopeKey(projectModel),
      remark: String(dto.remark || '').trim() || null,
      status: dto.status || 'ENABLED'
    };
  }

  private async ensureMaterialCodeAvailable(partCode: string, excludeId?: string) {
    const existing = await this.prisma.material.findFirst({
      where: {
        partCode: { equals: partCode, mode: 'insensitive' },
        id: excludeId ? { not: excludeId } : undefined
      },
      select: { id: true }
    });
    if (existing) {
      throw new BadRequestException(`零件编码 ${partCode} 已存在，请勿重复维护`);
    }
  }

  private normalizeStockAlertQuantity(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new BadRequestException('库存报警数量必须大于或等于 0');
    }
    return quantity;
  }

  private materialMemoryMatchesKeyword(material: MaterialMemoryRow, keyword?: string) {
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    if (!normalizedKeyword) {
      return true;
    }
    return pinyinSearchMatches([material.partCode, material.partName, material.unit, material.partSpecification], normalizedKeyword);
  }

  private normalizeStockAlertFilter(filter?: StockAlertFilter | string) {
    if (filter === 'ENABLED' || filter === 'TRIGGERED' || filter === 'DISABLED') {
      return filter;
    }
    return undefined;
  }

  private materialMatchesStockAlertFilter(row: StockAlertComparableRow, filter?: StockAlertFilter | string) {
    const normalizedFilter = this.normalizeStockAlertFilter(filter);
    if (!normalizedFilter) {
      return true;
    }
    if (normalizedFilter === 'ENABLED') {
      return row.stockAlertEnabled;
    }
    if (normalizedFilter === 'DISABLED') {
      return !row.stockAlertEnabled;
    }
    const alertQuantity = row.stockAlertQuantity === null || row.stockAlertQuantity === undefined ? null : Number(row.stockAlertQuantity);
    return row.stockAlertEnabled && alertQuantity !== null && Number(row.availableQuantity ?? 0) <= alertQuantity;
  }

  async materials(query: MaterialQueryDto) {
    const status = query.status || 'ENABLED';
    const normalizedKeyword = normalizeSearchKeyword(query.keyword);
    const withPage = query.withPage === 'true';
    const includeTestFixtures = query.includeTestFixtures === 'true';
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const historyByCode = normalizedKeyword
      ? await this.findMaterialSuggestionHistory({ keyword: query.keyword }, query.keyword)
      : new Map<string, MaterialSuggestionHistory>();
    const materialRows = await this.prisma.material.findMany({
      where: { status },
      orderBy: [{ partCode: 'asc' }, { id: 'asc' }]
    });
    const visibleMaterialRows = includeTestFixtures ? materialRows : materialRows.filter((material) => !this.isTestFixtureMaterial(material));
    const stockAlertFilter = this.normalizeStockAlertFilter(query.stockAlert);
    let materials = visibleMaterialRows.filter(
      (material) =>
        this.materialMemoryMatchesKeyword(material, query.keyword) || historyByCode.has(material.partCode.trim().toLocaleLowerCase())
    );
    if (stockAlertFilter === 'ENABLED') {
      materials = materials.filter((material) => material.stockAlertEnabled);
    } else if (stockAlertFilter === 'DISABLED') {
      materials = materials.filter((material) => !material.stockAlertEnabled);
    }

    const needsFullStockAlertCheck = stockAlertFilter === 'TRIGGERED';
    const aggregationMaterials = needsFullStockAlertCheck ? materials : withPage ? materials.slice(offset, offset + limit) : materials;
    if (aggregationMaterials.length === 0) {
      const emptyItems: never[] = [];
      return withPage
        ? {
            items: emptyItems,
            totalCount: needsFullStockAlertCheck ? 0 : materials.length,
            limit,
            offset,
            hasMore: false
          }
        : emptyItems;
    }

    const materialByCode = new Map(aggregationMaterials.map((material) => [material.partCode.trim().toLocaleLowerCase(), material]));
    const partCodeConditions = aggregationMaterials.map((material) => ({ partCode: { equals: material.partCode, mode: 'insensitive' as const } }));
    const [batches, orderLines] = await Promise.all([
      this.prisma.inventoryBatch.findMany({
        where: {
          status: 'AVAILABLE',
          quantity: { gt: 0 },
          OR: partCodeConditions
        },
        select: { id: true, partCode: true, quantity: true, sourceOrderId: true }
      }),
      this.prisma.orderLine.findMany({
        where: { OR: partCodeConditions },
        select: {
          partCode: true,
          createdAt: true,
          order: {
            select: {
              orderNo: true,
              customerName: true,
              orderDate: true
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }]
      })
    ]);
    const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(
      batches.filter((batch) => !batch.sourceOrderId).map((batch) => batch.id),
      {}
    );
    const quantityByCode = new Map<
      string,
      {
        availableQuantity: number;
        orderInventoryQuantity: number;
        stockInventoryQuantity: number;
      }
    >();
    for (const batch of batches) {
      const key = batch.partCode.trim().toLocaleLowerCase();
      if (!materialByCode.has(key)) {
        continue;
      }
      const current = quantityByCode.get(key) || {
        availableQuantity: 0,
        orderInventoryQuantity: 0,
        stockInventoryQuantity: 0
      };
      const reservedQuantity = batch.sourceOrderId ? 0 : (reservedQuantityByBatchId.get(batch.id) ?? 0);
      const quantity = Math.max(decimalToNumber(batch.quantity) - reservedQuantity, 0);
      current.availableQuantity += quantity;
      if (batch.sourceOrderId) {
        current.orderInventoryQuantity += quantity;
      } else {
        current.stockInventoryQuantity += quantity;
      }
      quantityByCode.set(key, current);
    }

    const usageByCode = new Map<
      string,
      {
        orderLineUsageCount: number;
        lastOrderNo?: string;
        lastCustomerName?: string;
        lastOrderDate?: Date | null;
      }
    >();
    for (const line of orderLines) {
      const key = line.partCode.trim().toLocaleLowerCase();
      if (!materialByCode.has(key)) {
        continue;
      }
      const current = usageByCode.get(key) || { orderLineUsageCount: 0 };
      current.orderLineUsageCount += 1;
      if (!current.lastOrderDate || (line.order.orderDate && line.order.orderDate.getTime() > current.lastOrderDate.getTime())) {
        current.lastOrderNo = line.order.orderNo;
        current.lastCustomerName = line.order.customerName;
        current.lastOrderDate = line.order.orderDate;
      }
      usageByCode.set(key, current);
    }

    const stockAlertFilteredItems = aggregationMaterials
      .map((material) => this.serializeMaterialMemoryRow(material, quantityByCode, usageByCode))
      .filter((item) => this.materialMatchesStockAlertFilter(item, query.stockAlert));
    const totalCount = needsFullStockAlertCheck ? stockAlertFilteredItems.length : materials.length;
    const items = needsFullStockAlertCheck && withPage ? stockAlertFilteredItems.slice(offset, offset + limit) : stockAlertFilteredItems;
    return withPage
      ? {
          items,
          totalCount,
          limit,
          offset,
          hasMore: offset + items.length < totalCount
        }
      : items;
  }

  private serializeMaterialMemoryRow(
    material: MaterialMemoryRow,
    quantityByCode: Map<
      string,
      {
        availableQuantity: number;
        orderInventoryQuantity: number;
        stockInventoryQuantity: number;
      }
    >,
    usageByCode: Map<
      string,
      {
        orderLineUsageCount: number;
        lastOrderNo?: string;
        lastCustomerName?: string;
        lastOrderDate?: Date | null;
      }
    >
  ) {
    const key = material.partCode.trim().toLocaleLowerCase();
    const quantity = quantityByCode.get(key) || {
      availableQuantity: 0,
      orderInventoryQuantity: 0,
      stockInventoryQuantity: 0
    };
    const usage = usageByCode.get(key) || { orderLineUsageCount: 0 };
    return {
      id: material.id,
      partCode: material.partCode,
      partName: material.partName,
      unit: material.unit,
      partSpecification: material.partSpecification,
      defaultProcessRoute: material.defaultProcessRoute,
      stockAlertEnabled: material.stockAlertEnabled,
      stockAlertQuantity: material.stockAlertQuantity === null || material.stockAlertQuantity === undefined ? null : decimalToNumber(material.stockAlertQuantity),
      status: material.status,
      ...quantity,
      orderLineUsageCount: usage.orderLineUsageCount,
      lastOrderNo: usage.lastOrderNo,
      lastCustomerName: usage.lastCustomerName,
      lastOrderDate: this.formatDateOnly(usage.lastOrderDate)
    };
  }

  async buildMaterialMemoryExport(query: MaterialQueryDto): Promise<Uint8Array> {
    // 零件基础库导出只读取 Material 搜索记忆和实时库存摘要，不创建订单、生产任务、库存批次或库存流水。
    const rows = (await this.materials({
      ...query,
      withPage: undefined,
      limit: undefined,
      offset: undefined
    })) as Array<ReturnType<InventoryService['serializeMaterialMemoryRow']>>;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();
    const headers = [
      '序号',
      '零件编码',
      '零件名称',
      '单位',
      '成品规格',
      '默认工艺',
      '可用库存',
      '订单库存',
      '备货库存',
      '库存报警',
      '最小库存',
      '订单使用次数',
      '最近订单号',
      '最近客户',
      '最近下单日期',
      '状态'
    ];
    const exportRows =
      rows.length > 0
        ? rows.map((row, index) => [
            index + 1,
            row.partCode,
            row.partName,
            row.unit,
            row.partSpecification || '',
            row.defaultProcessRoute || '',
            row.availableQuantity ?? 0,
            row.orderInventoryQuantity ?? 0,
            row.stockInventoryQuantity ?? 0,
            this.materialMemoryExportStockAlertText(row),
            row.stockAlertQuantity ?? '',
            row.orderLineUsageCount ?? 0,
            row.lastOrderNo || '',
            row.lastCustomerName || '',
            row.lastOrderDate || '',
            this.materialMemoryExportStatusText(row.status)
          ])
        : [['当前筛选范围没有零件基础资料']];

    this.addInventoryExportSheet(workbook, {
      sheetName: '零件基础资料',
      title: '零件基础库导出',
      scopeText: this.materialMemoryExportScopeText(query),
      headers,
      rows: exportRows
    });

    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  async createMaterial(dto: CreateMaterialDto) {
    const partCode = this.normalizeMaterialRequired(dto.partCode, '零件编码');
    const partName = this.normalizeMaterialRequired(dto.partName, '零件名称');
    const unit = this.normalizeMaterialRequired(dto.unit, '单位');
    const stockAlertEnabled = Boolean(dto.stockAlertEnabled);
    const stockAlertQuantity = this.normalizeStockAlertQuantity(dto.stockAlertQuantity);
    if (stockAlertEnabled && stockAlertQuantity === null) {
      throw new BadRequestException('启用库存报警时必须填写最小库存数量');
    }
    await this.ensureMaterialCodeAvailable(partCode);

    // 零件基础库只维护搜索资料，不创建库存、订单或生产任务。
    return this.prisma.material.create({
      data: {
        partCode,
        partName,
        unit,
        partSpecification: String(dto.partSpecification || '').trim() || null,
        defaultProcessRoute: await this.normalizeMaterialDefaultProcessRoute(dto.defaultProcessRoute),
        stockAlertEnabled,
        stockAlertQuantity: stockAlertEnabled ? stockAlertQuantity : null,
        status: dto.status || 'ENABLED'
      }
    });
  }

  async updateMaterial(materialId: string, dto: UpdateMaterialDto) {
    const existing = await this.prisma.material.findUnique({ where: { id: materialId } });
    if (!existing) {
      throw new NotFoundException('零件基础资料不存在');
    }
    if (dto.status !== undefined && dto.status !== existing.status) {
      // 零件基础资料状态变更必须走 disableMaterial / restoreMaterial，避免普通编辑绕过推荐关系停用和恢复边界。
      throw new BadRequestException('零件基础资料状态请使用专用启用/停用接口');
    }
    const partCode = dto.partCode !== undefined ? this.normalizeMaterialRequired(dto.partCode, '零件编码') : existing.partCode;
    const partName = dto.partName !== undefined ? this.normalizeMaterialRequired(dto.partName, '零件名称') : existing.partName;
    const unit = dto.unit !== undefined ? this.normalizeMaterialRequired(dto.unit, '单位') : existing.unit;
    const stockAlertEnabled = dto.stockAlertEnabled !== undefined ? dto.stockAlertEnabled : existing.stockAlertEnabled;
    let stockAlertQuantity =
      dto.stockAlertQuantity !== undefined
        ? this.normalizeStockAlertQuantity(dto.stockAlertQuantity)
        : existing.stockAlertQuantity === null
          ? null
          : decimalToNumber(existing.stockAlertQuantity);
    if (!stockAlertEnabled) {
      stockAlertQuantity = null;
    }
    if (stockAlertEnabled && stockAlertQuantity === null) {
      throw new BadRequestException('启用库存报警时必须填写最小库存数量');
    }
    if (partCode.toLocaleLowerCase() !== existing.partCode.toLocaleLowerCase()) {
      await this.ensureMaterialCodeAvailable(partCode, materialId);
    }
    const data = {
      partCode,
      partName,
      unit,
      partSpecification:
        dto.partSpecification !== undefined ? String(dto.partSpecification || '').trim() || null : existing.partSpecification,
      defaultProcessRoute:
        dto.defaultProcessRoute !== undefined
          ? await this.normalizeMaterialDefaultProcessRoute(dto.defaultProcessRoute)
          : existing.defaultProcessRoute,
      stockAlertEnabled,
      stockAlertQuantity
    };
    return this.prisma.material.update({
      where: { id: materialId },
      data
    });
  }

  async disableMaterial(materialId: string) {
    const existing = await this.prisma.material.findUnique({ where: { id: materialId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('零件基础资料不存在');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.material.update({
        where: { id: materialId },
        data: { status: 'DISABLED' }
      });
      await this.disableMaterialRecommendationLinks(tx, materialId);
      return row;
    });
  }

  async restoreMaterial(materialId: string) {
    const existing = await this.prisma.material.findUnique({ where: { id: materialId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('零件基础资料不存在');
    }
    // 恢复零件搜索记忆只恢复 Material 后续可选状态，不自动恢复适用范围、BOM 行、默认图纸或来源加工关系。
    return this.prisma.material.update({
      where: { id: materialId },
      data: { status: 'ENABLED' }
    });
  }

  private async disableMaterialRecommendationLinks(tx: Prisma.TransactionClient, materialId: string) {
    const componentLines = await tx.modelBomLine.findMany({
      where: {
        materialId,
        lineType: 'COMPONENT',
        status: 'ENABLED',
        componentNo: { not: null }
      },
      select: { bomId: true, componentNo: true }
    });

    // 零件软停用只影响后续推荐：同步停用适用范围、BOM 行和来源加工关系，不删除历史订单或库存记录。
    await tx.materialApplicability.updateMany({
      where: { materialId, status: 'ENABLED' },
      data: { status: 'DISABLED' }
    });
    await tx.modelBomLine.updateMany({
      where: { materialId, status: 'ENABLED' },
      data: { status: 'DISABLED' }
    });
    for (const line of componentLines) {
      const componentNoCandidates = this.modelBomComponentNoCandidates(line.componentNo);
      await tx.modelBomLine.updateMany({
        where: { bomId: line.bomId, parentComponentNo: { in: componentNoCandidates }, status: 'ENABLED' },
        data: { status: 'DISABLED' }
      });
    }
    await tx.materialTransformRule.updateMany({
      where: {
        OR: [{ sourceMaterialId: materialId }, { targetMaterialId: materialId }],
        status: 'ENABLED'
      },
      data: { status: 'DISABLED' }
    });
  }

  private parseOptionalDrawingDate(value?: string) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('图纸日期格式不正确');
    }
    return date;
  }

  private async ensureMaterialDrawingRevisionAvailable(materialId: string, drawingNo: string, drawingVersion: string, excludeId?: string) {
    const existing = await this.prisma.materialDrawingRevision.findFirst({
      where: {
        materialId,
        drawingNo: { equals: drawingNo, mode: 'insensitive' },
        drawingVersion: { equals: drawingVersion, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {})
      },
      select: { id: true }
    });
    if (existing) {
      throw new BadRequestException(`图纸 ${drawingNo} / ${drawingVersion} 已存在，请勿重复维护`);
    }
  }

  private async ensureMaterialDrawingRevisionCanBeDisabled(revisionId: string) {
    const referencingLines = await this.prisma.modelBomLine.findMany({
      where: {
        defaultDrawingRevisionId: revisionId,
        status: 'ENABLED',
        bom: { status: 'ENABLED' }
      },
      include: {
        bom: {
          select: {
            bomName: true,
            projectModel: true,
            customerNameSnapshot: true,
            customer: { select: { customerName: true } }
          }
        }
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    });
    if (referencingLines.length > 0) {
      // 图纸停用不能让启用 BOM 行留下失效默认图纸，避免后续推荐带错下单图纸快照。
      const references = this.formatBusinessListPreview(
        referencingLines.map(
          (line) =>
            `${line.bom.bomName} / ${line.bom.customer?.customerName || line.bom.customerNameSnapshot || '全部客户'} / ${line.bom.projectModel} / ${line.partCodeSnapshot}`
        ),
        'BOM 行'
      );
      throw new BadRequestException(`该图纸版本已被启用 BOM 行指定为默认图纸：${references}。请先调整 BOM 行默认图纸后再停用。`);
    }
  }

  private resolveMaterialDrawingRevisionData(dto: SaveMaterialDrawingRevisionDto) {
    const status = dto.status || 'ENABLED';
    return {
      drawingNo: this.normalizeMaterialRequired(dto.drawingNo, '图号'),
      drawingVersion: this.normalizeMaterialRequired(dto.drawingVersion, '图纸版本'),
      drawingDate: this.parseOptionalDrawingDate(dto.drawingDate),
      drawingStatus: String(dto.drawingStatus || '').trim() || null,
      drawingFileName: String(dto.drawingFileName || '').trim() || null,
      drawingFileUrl: String(dto.drawingFileUrl || '').trim() || null,
      isDefault: status === 'DISABLED' ? false : Boolean(dto.isDefault),
      defaultChangedBy: String(dto.defaultChangedBy || '').trim() || null,
      remark: String(dto.remark || '').trim() || null,
      status
    };
  }

  private requireDefaultDrawingChangedBy(value?: string | null) {
    const changedBy = String(value || '').trim();
    if (!changedBy) {
      throw new BadRequestException('设置默认图纸必须填写操作人员');
    }
    return changedBy;
  }

  async materialDrawingRevisions(materialId: string) {
    const material = await this.prisma.material.findUnique({ where: { id: materialId }, select: { id: true } });
    if (!material) {
      throw new NotFoundException('零件基础资料不存在');
    }
    const rows = await this.prisma.materialDrawingRevision.findMany({
      where: { materialId },
      orderBy: [{ status: 'asc' }, { isDefault: 'desc' }, { drawingDate: 'desc' }, { createdAt: 'desc' }]
    });
    return { items: rows.map((row) => this.serializeMaterialDrawingRevision(row)) };
  }

  async buildMaterialDrawingRevisionsExport(materialId: string): Promise<Uint8Array> {
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true }
    });
    if (!material) {
      throw new NotFoundException('零件基础资料不存在');
    }
    const rows = await this.prisma.materialDrawingRevision.findMany({
      where: { materialId },
      orderBy: [{ status: 'asc' }, { isDefault: 'desc' }, { drawingDate: 'desc' }, { createdAt: 'desc' }]
    });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();
    const headers = [
      '序号',
      '零件编码',
      '零件名称',
      '单位',
      '成品规格',
      '图号',
      '图纸版本',
      '图纸日期',
      '图纸状态',
      '默认图纸',
      '默认变更人',
      '默认变更时间',
      '图纸文件名',
      '图纸文件地址',
      '版本状态',
      '备注'
    ];
    const exportRows =
      rows.length > 0
        ? rows.map((row, index) => [
            index + 1,
            material.partCode,
            material.partName,
            material.unit,
            material.partSpecification || '',
            row.drawingNo,
            row.drawingVersion,
            this.formatDateOnly(row.drawingDate),
            row.drawingStatus || '',
            row.isDefault ? '是' : '否',
            row.defaultChangedBy || '',
            row.defaultChangedAt ? this.businessDateTimeText(row.defaultChangedAt) : '',
            row.drawingFileName || '',
            row.drawingFileUrl || '',
            this.materialMemoryExportStatusText(row.status),
            row.remark || ''
          ])
        : [['当前零件没有维护图纸版本']];

    this.addInventoryExportSheet(workbook, {
      sheetName: '图纸版本',
      title: '零件图纸版本导出',
      scopeText: [
        `零件：${material.partCode} / ${material.partName}`,
        `单位：${material.unit}`,
        `成品规格：${material.partSpecification || '-'}`,
        `零件状态：${this.materialMemoryExportStatusText(material.status)}`
      ].join('；'),
      headers,
      rows: exportRows
    });

    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  async saveMaterialDrawingRevision(materialId: string, dto: SaveMaterialDrawingRevisionDto) {
    const material = await this.prisma.material.findUnique({ where: { id: materialId }, select: { id: true } });
    if (!material) {
      throw new NotFoundException('零件基础资料不存在');
    }
    const data = this.resolveMaterialDrawingRevisionData(dto);
    await this.ensureMaterialDrawingRevisionAvailable(materialId, data.drawingNo, data.drawingVersion);

    const row = await this.prisma.$transaction(async (tx) => {
      const defaultChangedBy = data.isDefault ? this.requireDefaultDrawingChangedBy(data.defaultChangedBy) : null;
      if (data.isDefault) {
        // 默认图纸修改必须保留操作时间和人员；这里只维护基础资料，不覆盖历史订单图纸快照。
        await tx.materialDrawingRevision.updateMany({ where: { materialId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.materialDrawingRevision.create({
        data: {
          materialId,
          ...data,
          defaultChangedBy,
          defaultChangedAt: data.isDefault ? new Date() : null
        }
      });
    });
    return this.serializeMaterialDrawingRevision(row);
  }

  async updateMaterialDrawingRevision(revisionId: string, dto: SaveMaterialDrawingRevisionDto) {
    const existing = await this.prisma.materialDrawingRevision.findUnique({ where: { id: revisionId } });
    if (!existing) {
      throw new NotFoundException('图纸版本不存在');
    }
    if (dto.status !== undefined && dto.status !== existing.status) {
      // 图纸版本状态变更必须走 disableMaterialDrawingRevision / restoreMaterialDrawingRevision，避免编辑图纸时绕过默认图纸和历史快照边界。
      throw new BadRequestException('图纸版本状态请使用专用启用/停用接口');
    }
    const nextStatus = dto.status || existing.status;
    const data = this.resolveMaterialDrawingRevisionData({ ...dto, status: nextStatus });
    await this.ensureMaterialDrawingRevisionAvailable(existing.materialId, data.drawingNo, data.drawingVersion, existing.id);
    const row = await this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        // 同一个零件只允许一个启用默认图纸，BOM 行可另外指定自己的默认生产图纸。
        if (!existing.isDefault) {
          this.requireDefaultDrawingChangedBy(data.defaultChangedBy);
        }
        await tx.materialDrawingRevision.updateMany({
          where: { materialId: existing.materialId, isDefault: true, id: { not: existing.id } },
          data: { isDefault: false }
        });
      }
      return tx.materialDrawingRevision.update({
        where: { id: existing.id },
        data: {
          ...data,
          defaultChangedBy: data.isDefault ? data.defaultChangedBy || existing.defaultChangedBy : null,
          defaultChangedAt: data.isDefault && !existing.isDefault ? new Date() : data.isDefault ? existing.defaultChangedAt || new Date() : null
        }
      });
    });
    return this.serializeMaterialDrawingRevision(row);
  }

  async disableMaterialDrawingRevision(revisionId: string) {
    const existing = await this.prisma.materialDrawingRevision.findUnique({ where: { id: revisionId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('图纸版本不存在');
    }
    await this.ensureMaterialDrawingRevisionCanBeDisabled(revisionId);
    const row = await this.prisma.materialDrawingRevision.update({
      where: { id: revisionId },
      data: { status: 'DISABLED', isDefault: false, defaultChangedBy: null, defaultChangedAt: null }
    });
    return this.serializeMaterialDrawingRevision(row);
  }

  async restoreMaterialDrawingRevision(revisionId: string) {
    const existing = await this.prisma.materialDrawingRevision.findUnique({
      where: { id: revisionId },
      include: { material: { select: { id: true, status: true } } }
    });
    if (!existing) {
      throw new NotFoundException('图纸版本不存在');
    }
    if (existing.material.status !== 'ENABLED') {
      throw new BadRequestException('恢复图纸版本前，所属零件基础资料必须是启用状态');
    }
    // 恢复图纸版本只恢复后续可选状态，不自动设为默认图纸，也不覆盖历史订单图纸快照。
    const row = await this.prisma.materialDrawingRevision.update({
      where: { id: revisionId },
      data: { status: 'ENABLED' }
    });
    return this.serializeMaterialDrawingRevision(row);
  }

  private serializeMaterialDrawingRevision(row: {
    id: string;
    materialId: string;
    drawingNo: string;
    drawingVersion: string;
    drawingDate: Date | null;
    drawingStatus: string | null;
    drawingFileName: string | null;
    drawingFileUrl: string | null;
    isDefault: boolean;
    defaultChangedBy: string | null;
    defaultChangedAt: Date | null;
    remark: string | null;
    status: CommonStatus;
  }) {
    return {
      id: row.id,
      materialId: row.materialId,
      drawingNo: row.drawingNo,
      drawingVersion: row.drawingVersion,
      drawingDate: this.formatDateOnly(row.drawingDate),
      drawingStatus: row.drawingStatus,
      drawingFileName: row.drawingFileName,
      drawingFileUrl: row.drawingFileUrl,
      isDefault: row.isDefault,
      defaultChangedBy: row.defaultChangedBy,
      defaultChangedAt: row.defaultChangedAt,
      remark: row.remark,
      status: row.status
    };
  }

  async buildMaterialImportTemplate(): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(materialImportSheetName, {
      views: [{ state: 'frozen', ySplit: 1 }]
    });
    worksheet.columns = [
      { header: '零件编码', key: 'partCode', width: 24 },
      { header: '零件名称', key: 'partName', width: 24 },
      { header: '单位', key: 'unit', width: 10 },
      { header: '成品规格', key: 'partSpecification', width: 24 },
      { header: '默认工艺', key: 'defaultProcessRoute', width: 24 },
      { header: '图号', key: 'drawingNo', width: 24 },
      { header: '图纸版本', key: 'drawingVersion', width: 14 },
      { header: '图纸日期', key: 'drawingDate', width: 14 },
      { header: '图纸状态', key: 'drawingStatus', width: 14 },
      { header: '厚度', key: 'partThickness', width: 12 },
      { header: '项目型号', key: 'projectModel', width: 18 },
      { header: '库存报警', key: 'stockAlertEnabled', width: 14 },
      { header: '最小库存', key: 'stockAlertQuantity', width: 12 },
      { header: '备注', key: 'remark', width: 34 }
    ];
    worksheet.addRows([
      {
        partCode: 'RS10703010033',
        partName: '顶盖',
        unit: '件',
        defaultProcessRoute: '激光切割→折弯',
        drawingNo: 'RBKS-300DBII-10-50-01',
        drawingStatus: '旧图',
        partThickness: 1,
        projectModel: 'B型5P',
        stockAlertEnabled: '启用',
        stockAlertQuantity: 20,
        remark: '百胜样机款'
      },
      {
        partCode: 'RS1071123',
        partName: '风机支架组件',
        unit: '套',
        defaultProcessRoute: '装配',
        drawingNo: 'B5机型图号-10-30',
        drawingStatus: '旧图',
        partThickness: 2,
        projectModel: 'B型5P',
        stockAlertEnabled: '停用',
        remark: '组件主件，子件后续在机型零件包维护'
      },
      {
        partCode: 'P-BASE-001',
        partName: '百胜通用半成品',
        unit: '件',
        defaultProcessRoute: '激光切割',
        drawingNo: 'BASE-001',
        drawingStatus: '旧图',
        partThickness: 2,
        projectModel: '',
        stockAlertEnabled: '启用',
        stockAlertQuantity: 10,
        remark: '示例来源零件，可加工为客户特定零件'
      }
    ]);
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFB7C9D6' } },
          left: { style: 'thin', color: { argb: 'FFB7C9D6' } },
          bottom: { style: 'thin', color: { argb: 'FFB7C9D6' } },
          right: { style: 'thin', color: { argb: 'FFB7C9D6' } }
        };
      });
    });
    (worksheet as ExcelJS.Worksheet & { dataValidations: { add(address: string, validation: ExcelJS.DataValidation): void } }).dataValidations.add('C2:C2000', {
      type: 'list',
      allowBlank: false,
      formulae: ['"件,套,个,张,米,公斤"'],
      showErrorMessage: true,
      errorTitle: '单位必填',
      error: '请选择或填写常用单位'
    });
    (worksheet as ExcelJS.Worksheet & { dataValidations: { add(address: string, validation: ExcelJS.DataValidation): void } }).dataValidations.add('L2:L2000', {
      type: 'list',
      allowBlank: true,
      formulae: ['"启用,停用,是,否,ENABLED,DISABLED"'],
      showErrorMessage: true,
      errorTitle: '库存报警格式',
      error: '库存报警只能填写启用、停用、是、否、ENABLED 或 DISABLED'
    });

    const scopeSheet = workbook.addWorksheet(materialApplicabilityImportSheetName, {
      views: [{ state: 'frozen', ySplit: 1 }]
    });
    scopeSheet.columns = [
      { header: '零件编码', key: 'partCode', width: 24 },
      { header: '客户编码', key: 'customerCode', width: 18 },
      { header: '客户名称', key: 'customerName', width: 24 },
      { header: '项目型号', key: 'projectModel', width: 18 },
      { header: '状态', key: 'status', width: 12 },
      { header: '备注', key: 'remark', width: 34 }
    ];
    scopeSheet.addRows([
      {
        partCode: 'RS10703010033',
        customerName: '',
        projectModel: '',
        status: '启用',
        remark: '空客户、空项目表示全部客户 / 全部机型通用'
      },
      {
        partCode: 'RS1071123',
        customerName: '常州某钣金客户',
        projectModel: 'B型5P',
        status: '启用',
        remark: '指定客户 + 指定机型'
      }
    ]);

    const sourceSheet = workbook.addWorksheet(materialTransformImportSheetName, {
      views: [{ state: 'frozen', ySplit: 1 }]
    });
    sourceSheet.columns = [
      { header: '来源零件编码', key: 'sourcePartCode', width: 24 },
      { header: '目标零件编码', key: 'targetPartCode', width: 24 },
      { header: '客户编码', key: 'customerCode', width: 18 },
      { header: '客户名称', key: 'customerName', width: 24 },
      { header: '项目型号', key: 'projectModel', width: 18 },
      { header: '倍率', key: 'multiplier', width: 12 },
      { header: '损耗率', key: 'lossRate', width: 12 },
      { header: '默认工艺', key: 'defaultProcessRoute', width: 24 },
      { header: '转换说明', key: 'conversionDescription', width: 34 },
      { header: '状态', key: 'status', width: 12 },
      { header: '备注', key: 'remark', width: 34 }
    ];
    sourceSheet.addRows([
      {
        sourcePartCode: 'P-BASE-001',
        targetPartCode: 'RS1071123',
        customerName: '常州某钣金客户',
        projectModel: 'B型5P',
        multiplier: 1,
        lossRate: 0,
        defaultProcessRoute: '激光切割→折弯',
        conversionDescription: '百胜通用件加工为客户 B5 风机支架组件',
        status: '启用',
        remark: '只作为库存来源建议'
      }
    ]);

    for (const extraSheet of [scopeSheet, sourceSheet]) {
      extraSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      extraSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
      extraSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
      extraSheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFB7C9D6' } },
            left: { style: 'thin', color: { argb: 'FFB7C9D6' } },
            bottom: { style: 'thin', color: { argb: 'FFB7C9D6' } },
            right: { style: 'thin', color: { argb: 'FFB7C9D6' } }
          };
        });
      });
    }
    for (const address of ['E2:E2000', 'J2:J2000']) {
      (workbook.getWorksheet(address.startsWith('E') ? materialApplicabilityImportSheetName : materialTransformImportSheetName) as
        | (ExcelJS.Worksheet & { dataValidations: { add(address: string, validation: ExcelJS.DataValidation): void } })
        | undefined)?.dataValidations.add(address, {
        type: 'list',
        allowBlank: true,
        formulae: ['"启用,停用,ENABLED,DISABLED"'],
        showErrorMessage: true,
        errorTitle: '状态格式',
        error: '状态只能填写启用、停用、ENABLED 或 DISABLED'
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new Uint8Array(buffer as unknown as ArrayBuffer);
  }

  async createMaterialImportSession(dto: CreateMaterialImportSessionDto = {}) {
    const session = await this.prisma.materialImportSession.create({
      data: { createdBy: dto.createdBy?.trim() || null }
    });
    return this.buildMaterialImportSessionPreview(session.id);
  }

  async createMaterialImportSessionFromOrderImport(orderImportSessionId: string, dto: CreateMaterialImportFromOrderImportDto) {
    const sourceSession = await this.prisma.orderImportSession.findUnique({
      where: { id: orderImportSessionId },
      include: { files: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }
    });
    if (!sourceSession) {
      throw new NotFoundException('订单导入会话不存在，无法提取零件库草稿');
    }
    if (!sourceSession.files.length) {
      throw new BadRequestException('订单导入会话没有 ERP上传净表 文件，无法提取零件库草稿');
    }
    const expectedPreviewToken = this.orderImportPreviewToken({
      sessionId: sourceSession.id,
      status: sourceSession.status,
      files: sourceSession.files
    });
    if (!dto.previewToken || dto.previewToken !== expectedPreviewToken) {
      throw new BadRequestException('订单导入预览已变化，请刷新 ERP上传净表 预览后再提取零件库草稿');
    }

    const sourceRows = await this.prisma.orderImportRow.findMany({
      where: { sessionId: orderImportSessionId },
      include: { file: { select: { fileName: true, sheetName: true } } },
      orderBy: [{ orderNo: 'asc' }, { sourceRowNo: 'asc' }]
    });
    if (!sourceRows.length) {
      throw new BadRequestException('订单导入会话没有可提取的明细行');
    }

    const materialRows = sourceRows.map((row) => this.orderImportRowToMaterialImportRow(row));
    const applicabilityRows = this.orderImportRowsToMaterialApplicabilityImportRows(sourceRows);
    const materialFileHash = createHash('sha256')
      .update(
        JSON.stringify({
          source: 'ORDER_IMPORT',
          orderImportSessionId,
          previewToken: expectedPreviewToken,
          rows: materialRows.map((row) => row.rowHash),
          applicabilityRows: applicabilityRows.map((row) => row.rowHash)
        })
      )
      .digest('hex');

    const sessionId = await runSerializableTransaction(this.prisma, async (tx) => {
      const materialSession = await tx.materialImportSession.create({
        data: { createdBy: dto.createdBy?.trim() || null }
      });
      const importFile = await tx.materialImportFile.create({
        data: {
          sessionId: materialSession.id,
          fileName: `订单净表提取-${businessDateTimeKey()}.xlsx`,
          storedFileName: null,
          fileHash: materialFileHash,
          sheetName: 'ERP上传净表提取',
          rowCount: materialRows.length + applicabilityRows.length,
          materialRowCount: materialRows.length,
          scopeRowCount: applicabilityRows.length,
          transformRowCount: 0,
          // 订单净表提取只生成零件库导入草稿，不写入正式零件、BOM、订单、生产任务或库存。
          acceptedRowCount: materialRows.length + applicabilityRows.length,
          duplicateRowCount: 0
        }
      });
      const createdRows = await tx.materialImportRow.createMany({
        data: materialRows.map((row) => ({
          sessionId: materialSession.id,
          fileId: importFile.id,
          sourceRowNo: row.sourceRowNo,
          rowHash: row.rowHash,
          partCode: row.partCode,
          partName: row.partName,
          unit: row.unit,
          partSpecification: row.partSpecification,
          defaultProcessRoute: row.defaultProcessRoute,
          drawingNo: row.drawingNo,
          drawingVersion: row.drawingVersion,
          drawingDate: row.drawingDate,
          drawingStatus: row.drawingStatus,
          partThickness: row.partThickness,
          projectModel: row.projectModel,
          stockAlertEnabled: row.stockAlertEnabled,
          stockAlertQuantity: row.stockAlertQuantity,
          remark: row.remark,
          raw: row.raw,
          issues: row.issues,
          errorCount: row.errorCount,
          warningCount: row.warningCount
        })),
        skipDuplicates: true
      });
      const createdApplicabilityRows = applicabilityRows.length
        ? await tx.materialApplicabilityImportRow.createMany({
            data: applicabilityRows.map((row) => ({
              sessionId: materialSession.id,
              fileId: importFile.id,
              sourceRowNo: row.sourceRowNo,
              rowHash: row.rowHash,
              partCode: row.partCode,
              customerCode: row.customerCode,
              customerName: row.customerName,
              projectModel: row.projectModel,
              remark: row.remark,
              status: row.status,
              raw: row.raw,
              issues: row.issues,
              errorCount: row.errorCount,
              warningCount: row.warningCount
            })),
            skipDuplicates: true
          })
        : { count: 0 };
      await tx.materialImportFile.update({
        where: { id: importFile.id },
        data: {
          acceptedRowCount: createdRows.count + createdApplicabilityRows.count,
          duplicateRowCount: materialRows.length + applicabilityRows.length - createdRows.count - createdApplicabilityRows.count
        }
      });
      return materialSession.id;
    });
    await this.refreshMaterialImportSessionIssues(sessionId);
    return this.buildMaterialImportSessionPreview(sessionId);
  }

  async getMaterialImportSession(sessionId: string, query: GetMaterialImportSessionQueryDto = {}) {
    return this.buildMaterialImportSessionPreview(sessionId, this.materialImportPageOptions(query));
  }

  async createModelBomDraftsFromOrderImport(orderImportSessionId: string, dto: CreateModelBomDraftFromOrderImportDto) {
    const sourceSession = await this.prisma.orderImportSession.findUnique({
      where: { id: orderImportSessionId },
      include: { files: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }
    });
    if (!sourceSession) {
      throw new NotFoundException('订单导入会话不存在，无法提取 BOM 草稿');
    }
    if (!sourceSession.files.length) {
      throw new BadRequestException('订单导入会话没有 ERP上传净表 文件，无法提取 BOM 草稿');
    }
    const expectedPreviewToken = this.orderImportPreviewToken({
      sessionId: sourceSession.id,
      status: sourceSession.status,
      files: sourceSession.files
    });
    if (!dto.previewToken || dto.previewToken !== expectedPreviewToken) {
      throw new BadRequestException('订单导入预览已变化，请刷新 ERP上传净表 预览后再提取 BOM 草稿');
    }

    const sourceRows = await this.prisma.orderImportRow.findMany({
      where: { sessionId: orderImportSessionId },
      include: { file: { select: { fileName: true, sheetName: true } } },
      orderBy: [{ customerName: 'asc' }, { projectModel: 'asc' }, { orderNo: 'asc' }, { sourceRowNo: 'asc' }]
    });
    if (!sourceRows.length) {
      throw new BadRequestException('订单导入会话没有可提取的 BOM 明细行');
    }

    const partCodes = [...new Set(sourceRows.map((row) => row.partCode.trim()).filter(Boolean))];
    const [existingMaterials, customerLookup] = await Promise.all([
      this.findExistingMaterialsByPartCodes(partCodes),
      this.findMaterialImportCustomers(sourceRows.map((row) => ({ customerName: row.customerName })))
    ]);
    const enabledMaterials = existingMaterials.filter((material) => material.status === 'ENABLED');
    const materialByCode = new Map(enabledMaterials.map((material) => [material.partCode.trim().toLocaleLowerCase(), material]));
    const materialIdsForDrawingLookup = [...new Set(enabledMaterials.map((material) => material.id))];
    const drawingRowsForPreview = materialIdsForDrawingLookup.length
      ? await this.prisma.materialDrawingRevision.findMany({
          where: { materialId: { in: materialIdsForDrawingLookup }, status: 'ENABLED' },
          select: { materialId: true, drawingNo: true, drawingVersion: true }
        })
      : [];
    const drawingNoKeysForPreview = new Set(
      drawingRowsForPreview.map((drawing) => `${drawing.materialId}|${String(drawing.drawingNo || '').trim().toLocaleLowerCase()}`)
    );
    const drawingNoVersionKeysForPreview = new Set(
      drawingRowsForPreview.map(
        (drawing) =>
          `${drawing.materialId}|${String(drawing.drawingNo || '').trim().toLocaleLowerCase()}|${String(drawing.drawingVersion || '').trim().toLocaleLowerCase()}`
      )
    );
    const rowsByScope = new Map<string, OrderImportRowWithFile[]>();
    for (const row of sourceRows) {
      const scopeKey = [
        row.customerName.trim().toLocaleLowerCase(),
        this.normalizeMaterialScopeKey(row.projectModel)
      ].join('|');
      rowsByScope.set(scopeKey, [...(rowsByScope.get(scopeKey) || []), row]);
    }

    const drafts = [];
    for (const [scopeKey, rows] of rowsByScope.entries()) {
      const firstRow = rows[0];
      const projectModel = String(firstRow.projectModel || '').trim() || null;
      let customer: { id: string; customerCode: string; customerName: string } | null = null;
      const draftIssues: MaterialImportIssue[] = [];
      try {
        customer = this.resolveMaterialImportCustomer({ customerName: firstRow.customerName }, customerLookup);
      } catch (error) {
        draftIssues.push({
          severity: 'ERROR',
          code: 'INVALID_CUSTOMER',
          message: error instanceof Error ? error.message : '客户信息无法识别'
        });
      }

      const projectModelScopeKey = this.normalizeMaterialScopeKey(projectModel);
      const existingBoms = customer
        ? await this.prisma.modelBom.findMany({
            where: {
              customerScopeKey: customer.id,
              projectModelScopeKey,
              status: 'ENABLED'
            },
            include: {
              lines: {
                where: { status: 'ENABLED' },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
              }
            },
            orderBy: [{ isCommon: 'desc' }, { commonSortOrder: 'asc' }, { bomName: 'asc' }, { id: 'asc' }]
          })
        : [];
      if (existingBoms.length > 0) {
        draftIssues.push({
          severity: 'WARNING',
          code: 'EXISTING_BOM_SCOPE',
          message: `当前客户和机型/项目已有 ${existingBoms.length} 个正式 BOM；本次确认会新建另一个 BOM，不会覆盖已有 BOM`
        });
      }

      const componentNoCounts = new Map<string, number>();
      for (const componentNo of rows
        .filter((row) => this.normalizeModelBomLineType(row.lineType) === 'COMPONENT')
        .map((row) => this.normalizeModelBomComponentNo(row.componentNo))
        .filter(Boolean) as string[]) {
        componentNoCounts.set(componentNo, (componentNoCounts.get(componentNo) || 0) + 1);
      }
      const componentNos = new Set(componentNoCounts.keys());
      const draftLineKeys = new Set<string>();
      const existingBomLines = existingBoms.flatMap((bom) => bom.lines || []);
      const existingLineKeys = new Set(
        existingBomLines.map((line) =>
          this.modelBomDraftLineKey({
            partCode: line.partCodeSnapshot,
            lineType: line.lineType,
            componentNo: line.componentNo,
            parentComponentNo: line.parentComponentNo
          })
        )
      );
      const existingPartCodes = new Set(existingBomLines.map((line) => line.partCodeSnapshot.trim().toLocaleLowerCase()));
      const lines = rows.map((row, index) => {
        const material = materialByCode.get(row.partCode.trim().toLocaleLowerCase());
        const lineType = this.normalizeModelBomLineType(row.lineType);
        const componentNo = lineType === 'COMPONENT' ? this.normalizeModelBomComponentNo(row.componentNo) : null;
        const parentComponentNo = lineType === 'COMPONENT' ? null : this.normalizeModelBomComponentNo(row.parentComponentNo);
        const defaultQuantity = this.orderImportBomDefaultQuantity(row);
        const issues: MaterialImportIssue[] = [];
        if (!material) {
          issues.push({
            severity: 'WARNING',
            code: 'MATERIAL_NOT_FOUND',
            message: '零件基础库尚未维护该零件，确认正式 BOM 前请先写入零件基础资料'
          });
        }
        const requestedDrawingNo = String(row.drawingNo || '').trim();
        const requestedDrawingVersion = String(row.drawingVersion || '').trim();
        if (
          material &&
          requestedDrawingNo &&
          !(requestedDrawingVersion
            ? drawingNoVersionKeysForPreview.has(`${material.id}|${requestedDrawingNo.toLocaleLowerCase()}|${requestedDrawingVersion.toLocaleLowerCase()}`)
            : drawingNoKeysForPreview.has(`${material.id}|${requestedDrawingNo.toLocaleLowerCase()}`))
        ) {
          issues.push({
            severity: 'WARNING',
            code: 'DRAWING_REVISION_NOT_FOUND',
            message: '零件基础库没有与导入图号和版本一致的启用图纸版本，确认正式 BOM 前请先维护图纸版本或人工核对默认图纸'
          });
        }
        if (lineType === 'COMPONENT' && !componentNo) {
          issues.push({ severity: 'ERROR', code: 'COMPONENT_NO_REQUIRED', message: '组件行缺少组件编号，无法形成 BOM 组件结构' });
        }
        if (lineType === 'COMPONENT' && componentNo && (componentNoCounts.get(componentNo) || 0) > 1) {
          issues.push({
            severity: 'ERROR',
            code: 'DUPLICATE_COMPONENT_NO',
            message: '组件编号在当前 BOM 草稿中重复，必须先人工合并或修改组件编号'
          });
        }
        if (lineType !== 'COMPONENT' && parentComponentNo && !componentNos.has(parentComponentNo)) {
          issues.push({
            severity: 'ERROR',
            code: 'PARENT_COMPONENT_NOT_FOUND',
            message: '子零件所属组件在当前 BOM 草稿中不存在'
          });
        }
        if (defaultQuantity <= 0) {
          issues.push({ severity: 'ERROR', code: 'INVALID_DEFAULT_QUANTITY', message: 'BOM 默认数量必须大于 0' });
        }
        const draftLineKey = this.modelBomDraftLineKey({ partCode: row.partCode, lineType, componentNo, parentComponentNo });
        if (draftLineKeys.has(draftLineKey)) {
          issues.push({
            severity: 'ERROR',
            code: 'DUPLICATE_DRAFT_LINE',
            message: '当前 BOM 草稿中存在相同零件和相同结构位置，请先人工合并数量后再确认正式 BOM'
          });
        }
        draftLineKeys.add(draftLineKey);
        if (existingLineKeys.has(draftLineKey)) {
          issues.push({
            severity: 'WARNING',
            code: 'EXISTING_BOM_LINE',
            message: '正式 BOM 中已有相同零件和结构位置，导入草稿不会自动覆盖'
          });
        } else if (existingPartCodes.has(row.partCode.trim().toLocaleLowerCase())) {
          issues.push({
            severity: 'WARNING',
            code: 'EXISTING_BOM_PART_DIFFERENT_STRUCTURE',
            message: '正式 BOM 中已有相同零件但结构位置不同，请人工核对组件关系'
          });
        }
        return {
          sourceFileName: row.file?.fileName || null,
          sourceSheetName: row.file?.sheetName || null,
          sourceRowNo: row.sourceRowNo,
          orderNo: row.orderNo,
          lineType,
          partCategory: row.partCategory,
          componentNo,
          parentComponentNo,
          partCode: row.partCode,
          partName: row.partName,
          materialId: material?.id || null,
          materialStatus: material?.status || null,
          drawingNo: row.drawingNo,
          drawingVersion: row.drawingVersion,
          drawingDate: this.formatDateOnly(row.drawingDate),
          drawingStatus: row.drawingStatus,
          partSpecification: row.partSpecification,
          partThickness: row.partThickness === null ? null : decimalToNumber(row.partThickness),
          defaultQuantity,
          unit: row.unit,
          defaultProcessRoute: row.processRoute,
          sortOrder: (index + 1) * 10,
          raw: row.raw || {},
          issues
        };
      });

      const existingBomSummaries = existingBoms.map((bom) => {
        const diff = this.modelBomDraftExistingBomDiffReview(bom, lines);
        return {
          id: bom.id,
          bomName: bom.bomName,
          status: bom.status,
          lineCount: bom.lines.length,
          diffSummary: diff.summary,
          diffLines: diff.lines
        };
      });
      const firstExistingBomSummary = existingBomSummaries[0] || null;

      drafts.push({
        draftKey: scopeKey,
        bomName: `${customer?.customerName || firstRow.customerName}${projectModel ? ` ${projectModel}` : ''} BOM 草稿`,
        customerId: customer?.id || null,
        customerCode: customer?.customerCode || null,
        customerName: customer?.customerName || firstRow.customerName,
        customerScopeMode: 'PRIVATE',
        projectModel,
        existingBom: firstExistingBomSummary,
        existingBoms: existingBomSummaries,
        lineCount: lines.length,
        componentCount: lines.filter((line) => line.lineType === 'COMPONENT').length,
        childPartCount: lines.filter((line) => line.lineType !== 'COMPONENT' && line.parentComponentNo).length,
        standalonePartCount: lines.filter((line) => line.lineType !== 'COMPONENT' && !line.parentComponentNo).length,
        issues: draftIssues,
        lines
      });
    }

    const allIssues = drafts.flatMap((draft) => [...draft.issues, ...draft.lines.flatMap((line) => line.issues)]);
    return {
      sourceOrderImportSessionId: sourceSession.id,
      sourceStatus: sourceSession.status,
      previewToken: expectedPreviewToken,
      summary: {
        draftCount: drafts.length,
        lineCount: drafts.reduce((total, draft) => total + draft.lineCount, 0),
        componentCount: drafts.reduce((total, draft) => total + draft.componentCount, 0),
        childPartCount: drafts.reduce((total, draft) => total + draft.childPartCount, 0),
        standalonePartCount: drafts.reduce((total, draft) => total + draft.standalonePartCount, 0),
        existingBomScopeCount: drafts.filter((draft) => draft.existingBoms?.length || draft.existingBom).length,
        missingMaterialCount: drafts.reduce(
          (total, draft) => total + draft.lines.filter((line) => line.issues.some((issue) => issue.code === 'MATERIAL_NOT_FOUND')).length,
          0
        ),
        errorCount: allIssues.filter((issue) => issue.severity === 'ERROR').length,
        warningCount: allIssues.filter((issue) => issue.severity === 'WARNING').length
      },
      drafts
    };
  }

  async commitModelBomDraftFromOrderImport(orderImportSessionId: string, dto: CommitModelBomDraftFromOrderImportDto) {
    const preview = await this.createModelBomDraftsFromOrderImport(orderImportSessionId, { previewToken: dto.previewToken });
    const draft = preview.drafts.find((item) => item.draftKey === dto.draftKey);
    if (!draft) {
      throw new NotFoundException('BOM 草稿不存在，请刷新订单导入预览后重新选择');
    }
    const allIssues = [...draft.issues, ...draft.lines.flatMap((line) => line.issues)];
    const errorIssue = allIssues.find((issue) => issue.severity === 'ERROR');
    if (errorIssue) {
      throw new BadRequestException(`BOM 草稿仍有错误：${errorIssue.message}`);
    }
    if (!draft.customerId) {
      throw new BadRequestException('BOM 草稿未匹配到有效客户，不能写入正式 BOM');
    }
    const missingMaterial = draft.lines.find((line) => !line.materialId);
    if (missingMaterial) {
      throw new BadRequestException(`零件 ${missingMaterial.partCode} 尚未写入零件基础库，请先确认零件库导入草稿`);
    }
    const disabledMaterial = draft.lines.find((line) => line.materialStatus !== 'ENABLED');
    if (disabledMaterial) {
      throw new BadRequestException(`零件 ${disabledMaterial.partCode} 已停用，不能写入启用 BOM 明细`);
    }
    const existingBoms = draft.existingBoms || (draft.existingBom ? [draft.existingBom] : []);
    const reviewedExistingBomIds = new Set(
      (dto.reviewedExistingBomIds || []).map((id) => String(id || '').trim()).filter(Boolean)
    );
    const existingBomIds = new Set(existingBoms.map((bom) => bom.id));
    const unrelatedReviewedBomIds = [...reviewedExistingBomIds].filter((id) => !existingBomIds.has(id));
    if (unrelatedReviewedBomIds.length > 0) {
      throw new BadRequestException('核对 BOM 不属于当前草稿范围，请刷新 BOM 草稿预览后重新核对');
    }
    if (existingBoms.length > 0) {
      const missingReviewBoms = existingBoms.filter((bom) => !reviewedExistingBomIds.has(bom.id));
      if (missingReviewBoms.length > 0) {
        throw new BadRequestException(
          `当前范围已有 ${existingBoms.length} 个正式 BOM，创建新 BOM 前必须逐个完成差异核对：${this.formatBomNamePreview(
            missingReviewBoms.map((bom) => bom.bomName)
          )}`
        );
      }
    }
    const reviewedExistingBomRemark = existingBoms.length
      ? `已核对已有 BOM：${this.formatBomNamePreview(existingBoms.map((bom) => bom.bomName))}`
      : '';

    const normalizedLines: Array<(typeof draft.lines)[number] & { defaultProcessRoute: string | null }> = [];
    for (const line of draft.lines) {
      const processNames = this.splitDefaultProcessRoute(line.defaultProcessRoute || '');
      if (processNames.length > 0) {
        await this.processDefinitionsService.ensureActiveNames(processNames);
      }
      normalizedLines.push({
        ...line,
        defaultProcessRoute: processNames.length > 0 ? processNames.join('、') : null
      });
    }
    const confirmedBomName = String(dto.bomName || draft.bomName).trim();
    if (!confirmedBomName) {
      throw new BadRequestException('正式 BOM 名称不能为空');
    }

    try {
      return await runSerializableTransaction(
        this.prisma,
        async (tx) => {
        const customerScopeKey = draft.customerId as string;
        const projectModelScopeKey = this.normalizeMaterialScopeKey(draft.projectModel);
        const currentSameScopeBoms = await tx.modelBom.findMany({
          where: {
            customerScopeKey,
            projectModelScopeKey,
            status: 'ENABLED'
          },
          select: { id: true, bomName: true },
          orderBy: [{ bomName: 'asc' }, { id: 'asc' }]
        });
        const currentSameScopeBomIds = new Set(currentSameScopeBoms.map((bom) => bom.id));
        const staleReviewedBomIds = [...reviewedExistingBomIds].filter((id) => !currentSameScopeBomIds.has(id));
        if (staleReviewedBomIds.length > 0) {
          throw new BadRequestException('核对 BOM 不属于当前草稿范围，请刷新 BOM 草稿预览后重新核对');
        }
        const unreviewedCurrentBoms = currentSameScopeBoms.filter((bom) => !reviewedExistingBomIds.has(bom.id));
        if (unreviewedCurrentBoms.length > 0) {
          throw new BadRequestException(
            `当前范围已有新的正式 BOM 尚未核对，请刷新 BOM 草稿预览后重新核对：${this.formatBomNamePreview(
              unreviewedCurrentBoms.map((bom) => bom.bomName)
            )}`
          );
        }
        const duplicateNameKey = this.normalizeModelBomNameScopeKey(confirmedBomName);
        const duplicateName = currentSameScopeBoms.find((bom) => this.normalizeModelBomNameScopeKey(bom.bomName) === duplicateNameKey);
        if (duplicateName) {
          throw new BadRequestException('相同名称、客户范围和机型/项目的 BOM 已存在');
        }

        const materialIds = [...new Set(normalizedLines.map((line) => String(line.materialId || '')).filter(Boolean))];
        const drawingRows = materialIds.length
          ? await tx.materialDrawingRevision.findMany({
              where: { materialId: { in: materialIds }, status: 'ENABLED' },
              orderBy: [{ isDefault: 'desc' }, { drawingDate: 'desc' }, { createdAt: 'desc' }],
              select: { id: true, materialId: true, drawingNo: true, drawingVersion: true }
            })
          : [];
        const drawingByMaterialAndNo = new Map<string, (typeof drawingRows)[number]>();
        const drawingByMaterialNoAndVersion = new Map<string, (typeof drawingRows)[number]>();
        const drawingByMaterial = new Map<string, (typeof drawingRows)[number]>();
        for (const drawing of drawingRows) {
          if (!drawingByMaterial.has(drawing.materialId)) {
            drawingByMaterial.set(drawing.materialId, drawing);
          }
          const drawingNoKey = `${drawing.materialId}|${String(drawing.drawingNo || '').trim().toLocaleLowerCase()}`;
          if (!drawingByMaterialAndNo.has(drawingNoKey)) {
            drawingByMaterialAndNo.set(drawingNoKey, drawing);
          }
          const drawingVersionKey = `${drawing.materialId}|${String(drawing.drawingNo || '').trim().toLocaleLowerCase()}|${String(drawing.drawingVersion || '').trim().toLocaleLowerCase()}`;
          if (!drawingByMaterialNoAndVersion.has(drawingVersionKey)) {
            drawingByMaterialNoAndVersion.set(drawingVersionKey, drawing);
          }
        }

        const lineKeys = new Set<string>();
        for (const line of normalizedLines) {
          const lineKey = this.modelBomDraftLineKey(line);
          if (lineKeys.has(lineKey)) {
            throw new BadRequestException(`零件 ${line.partCode} 在 BOM 草稿中存在重复结构位置，请先人工合并后再确认`);
          }
          lineKeys.add(lineKey);
        }

        const row = await tx.modelBom.create({
          data: {
            bomName: confirmedBomName,
            customerId: draft.customerId,
            customerNameSnapshot: draft.customerName,
            projectModel: String(draft.projectModel || '').trim(),
            customerScopeMode: 'PRIVATE',
            customerScopeKey,
            projectModelScopeKey,
            sourceBomId: null,
            sourceBomNameSnapshot: null,
            isCommon: false,
            commonSortOrder: null,
            remark: [
              `来自订单导入 ${orderImportSessionId} 的 BOM 草稿人工确认`,
              reviewedExistingBomRemark,
              dto.confirmedBy?.trim() ? `确认人：${dto.confirmedBy.trim()}` : ''
            ]
              .filter(Boolean)
              .join('；'),
            status: 'ENABLED',
            // 订单净表 BOM 草稿确认只创建正式 BOM 和 BOM 明细，不创建订单、生产任务、库存批次或库存流水，也不覆盖已有 BOM。
            lines: {
              create: normalizedLines.map((line) => {
                const materialId = String(line.materialId);
                const requestedDrawingNo = String(line.drawingNo || '').trim();
                const requestedDrawingVersion = String(line.drawingVersion || '').trim();
                const drawingNoKey = `${materialId}|${requestedDrawingNo.toLocaleLowerCase()}`;
                const drawingVersionKey = `${drawingNoKey}|${requestedDrawingVersion.toLocaleLowerCase()}`;
                // 有导入图号和版本时只绑定完全一致的图纸，避免把其他默认图纸误写成 BOM 行默认图纸。
                const drawing = requestedDrawingNo
                  ? requestedDrawingVersion
                    ? drawingByMaterialNoAndVersion.get(drawingVersionKey) || null
                    : drawingByMaterialAndNo.get(drawingNoKey) || null
                  : drawingByMaterial.get(materialId) || null;
                return {
                  materialId,
                  partCodeSnapshot: line.partCode,
                  partNameSnapshot: line.partName,
                  unitSnapshot: line.unit,
                  partSpecificationSnapshot: line.partSpecification || null,
                  partThicknessSnapshot:
                    line.lineType === 'COMPONENT' || line.partThickness === null || line.partThickness === undefined
                      ? null
                      : new Prisma.Decimal(line.partThickness),
                  lineType: line.lineType,
                  partCategory: line.partCategory || null,
                  componentNo: line.lineType === 'COMPONENT' ? line.componentNo || null : null,
                  parentComponentNo: line.lineType === 'COMPONENT' ? null : line.parentComponentNo || null,
                  defaultDrawingRevisionId: drawing?.id || null,
                  defaultProcessRoute: line.defaultProcessRoute || null,
                  defaultQuantity: new Prisma.Decimal(line.defaultQuantity),
                  remark: `来自订单 ${line.orderNo} 第 ${line.sourceRowNo} 行`,
                  sortOrder: line.sortOrder,
                  status: 'ENABLED' as const
                };
              })
            }
          },
          include: this.modelBomInclude([{ sortOrder: 'asc' }, { id: 'asc' }])
        });
        await this.createModelBomRevision(
          tx,
          row.id,
          'ORDER_IMPORT_DRAFT_COMMIT',
          dto.confirmedBy || '订单导入页面',
          ['订单净表 BOM 草稿人工确认创建', reviewedExistingBomRemark].filter(Boolean).join('；')
        );
        const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
        return this.serializeModelBom(row, partThicknessByScopeKey);
        },
      'BOM 草稿确认正在被其他操作并发修改，请刷新预览后重新确认'
      );
    } catch (error) {
      this.handleModelBomNameUniqueError(error, '相同名称、客户范围和机型/项目的 BOM 已存在');
    }
  }

  private modelBomDraftLineKey(input: {
    partCode?: string | null;
    lineType?: string | null;
    componentNo?: string | null;
    parentComponentNo?: string | null;
  }) {
    return [
      String(input.partCode || '').trim().toLocaleLowerCase(),
      this.normalizeModelBomLineType(input.lineType),
      this.normalizeModelBomComponentNo(input.componentNo) || '',
      this.normalizeModelBomComponentNo(input.parentComponentNo) || ''
    ].join('|');
  }

  private modelBomDraftComparableText(value?: string | null) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  private modelBomDraftComparableProcess(value?: string | null) {
    return this.splitDefaultProcessRoute(value || '').join('、').toLocaleLowerCase();
  }

  private modelBomDraftDecimalDisplay(value?: Prisma.Decimal | number | null) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(decimalToNumber(value));
  }

  private modelBomDraftQuantityDisplay(value?: Prisma.Decimal | number | null, unit?: string | null) {
    return [this.modelBomDraftDecimalDisplay(value), String(unit || '').trim()].filter(Boolean).join(' ');
  }

  private modelBomDraftStructureText(line?: {
    lineType?: string | null;
    componentNo?: string | null;
    parentComponentNo?: string | null;
  }) {
    if (!line) {
      return '';
    }
    if (this.normalizeModelBomLineType(line.lineType) === 'COMPONENT') {
      return `组件 ${this.normalizeModelBomComponentNo(line.componentNo) || '未编号'}`;
    }
    const parentComponentNo = this.normalizeModelBomComponentNo(line.parentComponentNo);
    return parentComponentNo ? `子零件 -> ${parentComponentNo}` : '独立零件';
  }

  private modelBomDraftDiffField(label: string, draftValue: string, existingValue: string, draftComparable?: string, existingComparable?: string) {
    return {
      label,
      draftValue,
      existingValue,
      changed: (draftComparable ?? this.modelBomDraftComparableText(draftValue)) !== (existingComparable ?? this.modelBomDraftComparableText(existingValue))
    };
  }

  private modelBomDraftExistingBomDiffFields(draftLine?: ModelBomDraftLineForDiff, existingLine?: ModelBomDraftExistingLineForDiff) {
    return [
      this.modelBomDraftDiffField('结构', this.modelBomDraftStructureText(draftLine), this.modelBomDraftStructureText(existingLine)),
      this.modelBomDraftDiffField('零件编码', draftLine?.partCode || '', existingLine?.partCodeSnapshot || ''),
      this.modelBomDraftDiffField('零件名称', draftLine?.partName || '', existingLine?.partNameSnapshot || ''),
      this.modelBomDraftDiffField('零件类型', draftLine?.partCategory || '', existingLine?.partCategory || ''),
      this.modelBomDraftDiffField(
        '默认数量',
        this.modelBomDraftQuantityDisplay(draftLine?.defaultQuantity, draftLine?.unit),
        this.modelBomDraftQuantityDisplay(existingLine?.defaultQuantity, existingLine?.unitSnapshot)
      ),
      this.modelBomDraftDiffField('单位', draftLine?.unit || '', existingLine?.unitSnapshot || ''),
      this.modelBomDraftDiffField('厚度', this.modelBomDraftDecimalDisplay(draftLine?.partThickness), this.modelBomDraftDecimalDisplay(existingLine?.partThicknessSnapshot)),
      this.modelBomDraftDiffField('规格', draftLine?.partSpecification || '', existingLine?.partSpecificationSnapshot || ''),
      this.modelBomDraftDiffField(
        '默认工艺',
        draftLine?.defaultProcessRoute || '',
        existingLine?.defaultProcessRoute || '',
        this.modelBomDraftComparableProcess(draftLine?.defaultProcessRoute),
        this.modelBomDraftComparableProcess(existingLine?.defaultProcessRoute)
      )
    ];
  }

  private modelBomDraftLineSnapshot(line?: ModelBomDraftLineForDiff) {
    if (!line) {
      return null;
    }
    return {
      sourceRowNo: line.sourceRowNo ?? null,
      orderNo: line.orderNo || null,
      structureText: this.modelBomDraftStructureText(line),
      partCode: line.partCode,
      partName: line.partName,
      partCategory: line.partCategory || null,
      defaultQuantityText: this.modelBomDraftQuantityDisplay(line.defaultQuantity, line.unit),
      unit: line.unit,
      partThicknessText: this.modelBomDraftDecimalDisplay(line.partThickness),
      partSpecification: line.partSpecification || null,
      defaultProcessRoute: line.defaultProcessRoute || null
    };
  }

  private modelBomDraftExistingLineSnapshot(line?: ModelBomDraftExistingLineForDiff) {
    if (!line) {
      return null;
    }
    return {
      id: line.id || null,
      structureText: this.modelBomDraftStructureText(line),
      partCode: line.partCodeSnapshot,
      partName: line.partNameSnapshot,
      partCategory: line.partCategory || null,
      defaultQuantityText: this.modelBomDraftQuantityDisplay(line.defaultQuantity, line.unitSnapshot),
      unit: line.unitSnapshot,
      partThicknessText: this.modelBomDraftDecimalDisplay(line.partThicknessSnapshot),
      partSpecification: line.partSpecificationSnapshot || null,
      defaultProcessRoute: line.defaultProcessRoute || null
    };
  }

  private modelBomDraftExistingBomDiffReview(
    bom: {
      lines: ModelBomDraftExistingLineForDiff[];
    },
    draftLines: ModelBomDraftLineForDiff[]
  ) {
    const existingByKey = new Map(
      bom.lines.map((line) => [
        this.modelBomDraftLineKey({
          partCode: line.partCodeSnapshot,
          lineType: line.lineType,
          componentNo: line.componentNo,
          parentComponentNo: line.parentComponentNo
        }),
        line
      ])
    );
    const draftKeys = new Set<string>();
    const changedFields = new Set<string>();
    let sameLineCount = 0;
    let changedLineCount = 0;
    let newLineCount = 0;
    const diffLines: Array<{
      key: string;
      status: 'SAME' | 'CHANGED' | 'DRAFT_ONLY' | 'EXISTING_ONLY';
      structureText: string;
      partCode: string;
      partName: string;
      draftLine: ReturnType<InventoryService['modelBomDraftLineSnapshot']>;
      existingLine: ReturnType<InventoryService['modelBomDraftExistingLineSnapshot']>;
      fields: ReturnType<InventoryService['modelBomDraftExistingBomDiffFields']>;
    }> = [];

    for (const line of draftLines) {
      const key = this.modelBomDraftLineKey(line);
      draftKeys.add(key);
      const existingLine = existingByKey.get(key);
      const fields = this.modelBomDraftExistingBomDiffFields(line, existingLine);
      if (!existingLine) {
        newLineCount += 1;
        diffLines.push({
          key,
          status: 'DRAFT_ONLY',
          structureText: this.modelBomDraftStructureText(line),
          partCode: line.partCode,
          partName: line.partName,
          draftLine: this.modelBomDraftLineSnapshot(line),
          existingLine: null,
          fields
        });
        continue;
      }
      const lineChangedFields = fields.filter((field) => field.changed).map((field) => field.label);
      if (lineChangedFields.length > 0) {
        changedLineCount += 1;
        lineChangedFields.forEach((field) => changedFields.add(field));
      } else {
        sameLineCount += 1;
      }
      diffLines.push({
        key,
        status: lineChangedFields.length > 0 ? 'CHANGED' : 'SAME',
        structureText: this.modelBomDraftStructureText(line),
        partCode: line.partCode,
        partName: line.partName,
        draftLine: this.modelBomDraftLineSnapshot(line),
        existingLine: this.modelBomDraftExistingLineSnapshot(existingLine),
        fields
      });
    }

    for (const [key, existingLine] of existingByKey.entries()) {
      if (draftKeys.has(key)) {
        continue;
      }
      diffLines.push({
        key,
        status: 'EXISTING_ONLY',
        structureText: this.modelBomDraftStructureText(existingLine),
        partCode: existingLine.partCodeSnapshot,
        partName: existingLine.partNameSnapshot,
        draftLine: null,
        existingLine: this.modelBomDraftExistingLineSnapshot(existingLine),
        fields: this.modelBomDraftExistingBomDiffFields(undefined, existingLine)
      });
    }

    const removedLineCount = diffLines.filter((line) => line.status === 'EXISTING_ONLY').length;
    return {
      summary: {
        sameLineCount,
        changedLineCount,
        newLineCount,
        removedLineCount,
        changedFields: [...changedFields]
      },
      lines: diffLines
    };
  }

  private orderImportBomDefaultQuantity(row: OrderImportRowWithFile) {
    const candidates = [row.unitUsage, row.orderQuantity, row.demandQuantity]
      .map((value) => (value === null || value === undefined ? 0 : decimalToNumber(value)))
      .filter((value) => Number.isFinite(value) && value > 0);
    return candidates[0] || 1;
  }

  private orderImportPreviewToken(input: {
    sessionId: string;
    status: string;
    files: Array<{
      id: string;
      fileHash: string;
      rowCount: number;
      acceptedRowCount: number;
      duplicateRowCount: number;
      createdAt: Date;
    }>;
  }) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          sessionId: input.sessionId,
          status: input.status,
          files: input.files.map((file) => ({
            id: file.id,
            fileHash: file.fileHash,
            rowCount: file.rowCount,
            acceptedRowCount: file.acceptedRowCount,
            duplicateRowCount: file.duplicateRowCount,
            createdAt: file.createdAt.toISOString()
          }))
        })
      )
      .digest('hex');
  }

  private orderImportRowToMaterialImportRow(row: OrderImportRowWithFile): ParsedMaterialImportRow {
    const partThickness = row.partThickness === null || row.partThickness === undefined ? null : decimalToNumber(row.partThickness);
    const raw = {
      来源: 'ERP上传净表提取',
      来源文件: row.file?.fileName || null,
      来源工作表: row.file?.sheetName || 'ERP上传净表',
      来源行: row.sourceRowNo,
      订单编号: row.orderNo,
      客户名称: row.customerName,
      机型项目: row.projectModel || null,
      行类型: row.lineType,
      组件编号: row.componentNo || null,
      所属组件: row.parentComponentNo || null,
      零件编码: row.partCode,
      零件名称: row.partName,
      单位: row.unit,
      图号: row.drawingNo || null,
      版本: row.drawingVersion || null,
      图纸日期: this.formatDateOnly(row.drawingDate) || null,
      图纸状态: row.drawingStatus || null,
      厚度: partThickness,
      规格: row.partSpecification || null,
      默认工艺: row.processRoute || null
    };
    const parsedRow: ParsedMaterialImportRow = {
      sourceRowNo: row.sourceRowNo,
      partCode: row.partCode,
      partName: row.partName,
      unit: row.unit,
      partSpecification: row.partSpecification,
      defaultProcessRoute: row.processRoute,
      drawingNo: row.drawingNo,
      drawingVersion: row.drawingVersion || null,
      drawingDate: row.drawingDate,
      drawingStatus: row.drawingStatus,
      partThickness,
      projectModel: null,
      stockAlertEnabled: null,
      stockAlertQuantity: null,
      remark: `来自订单导入 ${row.orderNo} 第 ${row.sourceRowNo} 行，仅作为零件库草稿预览`,
      raw,
      rowHash: '',
      issues: [],
      errorCount: 0,
      warningCount: 0
    };
    parsedRow.issues = this.buildMaterialImportRowIssues(parsedRow, '', '', null);
    const counts = this.countMaterialImportIssues(parsedRow.issues);
    parsedRow.errorCount = counts.errorCount;
    parsedRow.warningCount = counts.warningCount;
    parsedRow.rowHash = this.hashMaterialImportRow(parsedRow);
    return parsedRow;
  }

  private orderImportRowsToMaterialApplicabilityImportRows(rows: OrderImportRowWithFile[]): ParsedMaterialApplicabilityImportRow[] {
    const rowsByScope = new Map<string, ParsedMaterialApplicabilityImportRow>();
    for (const row of rows) {
      const scopeKey = [
        row.partCode.trim().toLocaleLowerCase(),
        row.customerName.trim().toLocaleLowerCase(),
        this.normalizeMaterialScopeKey(row.projectModel)
      ].join('|');
      if (rowsByScope.has(scopeKey)) {
        continue;
      }
      const raw = {
        来源: 'ERP上传净表提取',
        来源文件: row.file?.fileName || null,
        来源工作表: row.file?.sheetName || 'ERP上传净表',
        来源行: row.sourceRowNo,
        订单编号: row.orderNo,
        客户名称: row.customerName,
        机型项目: row.projectModel || null,
        零件编码: row.partCode,
        零件名称: row.partName
      };
      const parsedRow: ParsedMaterialApplicabilityImportRow = {
        sourceRowNo: row.sourceRowNo,
        partCode: row.partCode,
        customerCode: null,
        customerName: row.customerName,
        projectModel: row.projectModel,
        remark: '来自订单导入净表提取，仅作为零件适用范围草稿预览',
        status: 'ENABLED',
        raw,
        rowHash: '',
        issues: [],
        errorCount: 0,
        warningCount: 0
      };
      parsedRow.issues = this.buildMaterialApplicabilityImportRowIssues(parsedRow, '', 'ENABLED');
      const counts = this.countMaterialImportIssues(parsedRow.issues);
      parsedRow.errorCount = counts.errorCount;
      parsedRow.warningCount = counts.warningCount;
      parsedRow.rowHash = this.hashMaterialApplicabilityImportRow(parsedRow);
      rowsByScope.set(scopeKey, parsedRow);
    }
    return [...rowsByScope.values()];
  }

  private businessDateTimeText(value = new Date()) {
    const stamp = businessDateTimeKey(value);
    // 零件库导出文件里的生成时间按公司业务时区展示，避免 NAS / Docker 默认 UTC 造成现场核对时间偏差。
    return stamp.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6');
  }

  async buildMaterialImportIssueReport(sessionId: string): Promise<Uint8Array> {
    const preview = await this.buildMaterialImportSessionPreview(sessionId, { includeRows: false });
    const [materialRows, applicabilityRows, transformRows] = await Promise.all([
      this.prisma.materialImportRow.findMany({
        where: { sessionId, OR: [{ errorCount: { gt: 0 } }, { warningCount: { gt: 0 } }] },
        include: { file: { select: { fileName: true, sheetName: true } } },
        orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }]
      }),
      this.prisma.materialApplicabilityImportRow.findMany({
        where: { sessionId, OR: [{ errorCount: { gt: 0 } }, { warningCount: { gt: 0 } }] },
        include: { file: { select: { fileName: true, sheetName: true } } },
        orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }]
      }),
      this.prisma.materialTransformImportRow.findMany({
        where: { sessionId, OR: [{ errorCount: { gt: 0 } }, { warningCount: { gt: 0 } }] },
        include: { file: { select: { fileName: true, sheetName: true } } },
        orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }]
      })
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();

    const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F4E78' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };
    const border = {
      top: { style: 'thin' as const, color: { argb: 'FFD9E5EF' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFD9E5EF' } },
      left: { style: 'thin' as const, color: { argb: 'FFD9E5EF' } },
      right: { style: 'thin' as const, color: { argb: 'FFD9E5EF' } }
    };
    const styleHeader = (worksheet: ExcelJS.Worksheet) => {
      worksheet.getRow(1).eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = border;
      });
      worksheet.getRow(1).height = 26;
    };
    const styleBody = (worksheet: ExcelJS.Worksheet, startRow = 2) => {
      for (let rowNo = startRow; rowNo <= worksheet.rowCount; rowNo += 1) {
        worksheet.getRow(rowNo).eachCell((cell) => {
          cell.alignment = { vertical: 'top', wrapText: true };
          cell.border = border;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNo % 2 === 0 ? 'FFF4FBFD' : 'FFFFFFFF' } };
        });
      }
    };

    const overviewSheet = workbook.addWorksheet('导入概览');
    overviewSheet.columns = [{ width: 24 }, { width: 28 }, { width: 24 }, { width: 48 }];
    overviewSheet.addRow(['项目', '数值', '项目', '数值']);
    overviewSheet.addRows([
      ['导入会话', preview.id, '状态', preview.status === 'DRAFT' ? '草稿' : '已提交'],
      ['上传文件数', preview.summary.fileCount, '读取行数', preview.summary.rowCount],
      ['可写入行', preview.summary.importableRowCount, '重复行', preview.summary.duplicateRowCount],
      ['零件数', preview.summary.materialUpsertCount, '图纸版本', preview.summary.drawingRevisionUpsertCount || 0],
      ['适用范围', preview.summary.applicabilityUpsertCount || 0, '来源关系', preview.summary.transformRuleUpsertCount || 0],
      ['错误数', preview.summary.errorCount, '警告数', preview.summary.warningCount],
      ['生成时间', this.businessDateTimeText(), '说明', '仅用于修正 Excel；提交前后端仍会重新校验']
    ]);
    styleHeader(overviewSheet);
    styleBody(overviewSheet);

    const fileSheet = workbook.addWorksheet('上传文件');
    fileSheet.columns = [
      { header: '文件名', key: 'fileName', width: 38 },
      { header: '工作表', key: 'sheetName', width: 34 },
      { header: '读取行', key: 'rowCount', width: 12 },
      { header: '零件行', key: 'materialRowCount', width: 12 },
      { header: '范围行', key: 'scopeRowCount', width: 12 },
      { header: '来源关系行', key: 'transformRowCount', width: 14 },
      { header: '重复行', key: 'duplicateRowCount', width: 12 }
    ];
    fileSheet.addRows(
      preview.files.map((file) => ({
        fileName: file.fileName,
        sheetName: file.sheetName,
        rowCount: file.rowCount,
        materialRowCount: file.materialRowCount || 0,
        scopeRowCount: file.scopeRowCount || 0,
        transformRowCount: file.transformRowCount || 0,
        duplicateRowCount: file.duplicateRowCount
      }))
    );
    styleHeader(fileSheet);
    styleBody(fileSheet);

    const issueSheet = workbook.addWorksheet('问题明细', { views: [{ state: 'frozen', ySplit: 1 }] });
    issueSheet.columns = [
      { header: '业务表', key: 'sheetType', width: 16 },
      { header: '来源文件', key: 'sourceFileName', width: 34 },
      { header: '工作表', key: 'sourceSheetName', width: 24 },
      { header: 'Excel 行', key: 'sourceRowNo', width: 10 },
      { header: '零件编码', key: 'partCode', width: 18 },
      { header: '零件名称', key: 'partName', width: 22 },
      { header: '来源零件编码', key: 'sourcePartCode', width: 18 },
      { header: '目标零件编码', key: 'targetPartCode', width: 18 },
      { header: '客户编码', key: 'customerCode', width: 16 },
      { header: '客户名称', key: 'customerName', width: 22 },
      { header: '项目型号', key: 'projectModel', width: 16 },
      { header: '图号', key: 'drawingNo', width: 18 },
      { header: '图纸版本', key: 'drawingVersion', width: 12 },
      { header: '图纸日期', key: 'drawingDate', width: 14 },
      { header: '图纸状态', key: 'drawingStatus', width: 14 },
      { header: '厚度', key: 'partThickness', width: 10 },
      { header: '单位', key: 'unit', width: 10 },
      { header: '库存报警', key: 'stockAlertEnabled', width: 12 },
      { header: '最小库存', key: 'stockAlertQuantity', width: 12 },
      { header: '状态', key: 'status', width: 12 },
      { header: '严重程度', key: 'severity', width: 12 },
      { header: '问题代码', key: 'code', width: 24 },
      { header: '问题说明', key: 'message', width: 62 },
      { header: '备注', key: 'remark', width: 34 }
    ];
    styleHeader(issueSheet);

    // 零件库导入问题导出只输出校验明细，不写入正式零件库。
    const addIssueRows = (base: Record<string, string | number | null | undefined>, issues: MaterialImportIssue[]) => {
      for (const issue of issues) {
        issueSheet.addRow({
          ...base,
          severity: issue.severity === 'ERROR' ? '错误' : '警告',
          code: issue.code,
          message: issue.message
        });
      }
    };
    for (const row of materialRows) {
      addIssueRows(
        {
          sheetType: '零件基础库',
          sourceFileName: row.file.fileName,
          sourceSheetName: row.file.sheetName,
          sourceRowNo: row.sourceRowNo,
          partCode: row.partCode,
          partName: row.partName,
          projectModel: row.projectModel,
          drawingNo: row.drawingNo,
          drawingVersion: row.drawingVersion,
          drawingDate: this.formatDateOnly(row.drawingDate),
          drawingStatus: row.drawingStatus,
          partThickness: row.partThickness === null ? null : decimalToNumber(row.partThickness),
          unit: row.unit,
          stockAlertEnabled:
            row.stockAlertEnabled === null || row.stockAlertEnabled === undefined ? '' : row.stockAlertEnabled ? '启用' : '停用',
          stockAlertQuantity:
            row.stockAlertQuantity === null || row.stockAlertQuantity === undefined ? null : decimalToNumber(row.stockAlertQuantity),
          remark: row.remark
        },
        this.materialImportIssueArray(row.issues)
      );
    }
    for (const row of applicabilityRows) {
      addIssueRows(
        {
          sheetType: '适用范围',
          sourceFileName: row.file.fileName,
          sourceSheetName: row.file.sheetName,
          sourceRowNo: row.sourceRowNo,
          partCode: row.partCode,
          customerCode: row.customerCode,
          customerName: row.customerName,
          projectModel: row.projectModel,
          status: row.status === 'ENABLED' ? '启用' : '停用',
          remark: row.remark
        },
        this.materialImportIssueArray(row.issues)
      );
    }
    for (const row of transformRows) {
      addIssueRows(
        {
          sheetType: '来源加工关系',
          sourceFileName: row.file.fileName,
          sourceSheetName: row.file.sheetName,
          sourceRowNo: row.sourceRowNo,
          sourcePartCode: row.sourcePartCode,
          targetPartCode: row.targetPartCode,
          customerCode: row.customerCode,
          customerName: row.customerName,
          projectModel: row.projectModel,
          status: row.status === 'ENABLED' ? '启用' : '停用',
          remark: row.remark
        },
        this.materialImportIssueArray(row.issues)
      );
    }
    if (issueSheet.rowCount === 1) {
      issueSheet.addRow({ severity: '通过', message: '当前零件库导入预览没有错误或警告' });
    }
    issueSheet.autoFilter = { from: 'A1', to: 'X1' };
    styleBody(issueSheet);

    const buffer = await workbook.xlsx.writeBuffer();
    return new Uint8Array(buffer as unknown as ArrayBuffer);
  }

  async uploadMaterialImportFile(sessionId: string, file: Express.Multer.File) {
    const normalizedFileName = normalizeMultipartFileName(file.originalname);
    const session = await this.prisma.materialImportSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      await this.removeMaterialImportStoredFile(file.filename);
      throw new NotFoundException('零件导入会话不存在');
    }
    if (session.status !== 'DRAFT') {
      await this.removeMaterialImportStoredFile(file.filename);
      throw new BadRequestException('已提交或已放弃的零件导入会话不能继续上传');
    }

    const fileHash = await this.hashMaterialImportFile(file.path);
    const duplicatedFile = await this.prisma.materialImportFile.findUnique({
      where: { sessionId_fileHash: { sessionId, fileHash } },
      select: { id: true, fileName: true }
    });
    if (duplicatedFile) {
      await this.removeMaterialImportStoredFile(file.filename);
      throw new BadRequestException(`当前会话已上传过相同文件：${duplicatedFile.fileName}`);
    }

    let parsed: Awaited<ReturnType<typeof this.parseMaterialImportWorkbook>>;
    try {
      parsed = await this.parseMaterialImportWorkbook(file.path);
    } catch (error) {
      await this.removeMaterialImportStoredFile(file.filename);
      throw error;
    }
    const parsedRowCount = parsed.rows.length + parsed.applicabilityRows.length + parsed.transformRows.length;
    if (parsedRowCount === 0) {
      await this.removeMaterialImportStoredFile(file.filename);
      throw new BadRequestException('Excel 中没有可读取的零件行');
    }
    await this.enrichMaterialImportWorkbookRows(parsed);

    let createdFile: { id: string; acceptedRowCount: number; duplicateRowCount: number } | null = null;
    try {
      createdFile = await runSerializableTransaction(
        this.prisma,
        async (tx) => {
        const freshSession = await tx.materialImportSession.findUnique({
          where: { id: sessionId },
          select: { status: true }
        });
        if (!freshSession) {
          throw new NotFoundException('零件导入会话不存在');
        }
        if (freshSession.status !== 'DRAFT') {
          throw new BadRequestException('已提交或已放弃的零件导入会话不能继续上传');
        }
        const freshDuplicatedFile = await tx.materialImportFile.findUnique({
          where: { sessionId_fileHash: { sessionId, fileHash } },
          select: { id: true, fileName: true }
        });
        if (freshDuplicatedFile) {
          throw new BadRequestException(`当前会话已上传过相同文件：${freshDuplicatedFile.fileName}`);
        }

        const importFile = await tx.materialImportFile.create({
          data: {
            sessionId,
            fileName: normalizedFileName,
            storedFileName: file.filename,
            fileHash,
            sheetName: parsed.sheetName,
            rowCount: parsedRowCount,
            materialRowCount: parsed.rows.length,
            scopeRowCount: parsed.applicabilityRows.length,
            transformRowCount: parsed.transformRows.length,
            // 文件记录先满足数据库计数约束，实际重复行数在写入预览行后立即回填。
            acceptedRowCount: parsedRowCount,
            duplicateRowCount: 0
          }
        });
        const createRowsResult = parsed.rows.length
          ? await tx.materialImportRow.createMany({
              data: parsed.rows.map((row) => ({
                sessionId,
                fileId: importFile.id,
                sourceRowNo: row.sourceRowNo,
                rowHash: row.rowHash,
                partCode: row.partCode,
                partName: row.partName,
                unit: row.unit,
                partSpecification: row.partSpecification,
                defaultProcessRoute: row.defaultProcessRoute,
                drawingNo: row.drawingNo,
                drawingVersion: row.drawingVersion,
                drawingDate: row.drawingDate,
                drawingStatus: row.drawingStatus,
                partThickness: row.partThickness,
                projectModel: row.projectModel,
                stockAlertEnabled: row.stockAlertEnabled,
                stockAlertQuantity: row.stockAlertQuantity,
                remark: row.remark,
                raw: row.raw,
                issues: row.issues,
                errorCount: row.errorCount,
                warningCount: row.warningCount
              })),
              skipDuplicates: true
            })
          : { count: 0 };
        const createApplicabilityRowsResult = parsed.applicabilityRows.length
          ? await tx.materialApplicabilityImportRow.createMany({
              data: parsed.applicabilityRows.map((row) => ({
                sessionId,
                fileId: importFile.id,
                sourceRowNo: row.sourceRowNo,
                rowHash: row.rowHash,
                partCode: row.partCode,
                customerCode: row.customerCode,
                customerName: row.customerName,
                projectModel: row.projectModel,
                remark: row.remark,
                status: row.status,
                raw: row.raw,
                issues: row.issues,
                errorCount: row.errorCount,
                warningCount: row.warningCount
              })),
              skipDuplicates: true
            })
          : { count: 0 };
        const createTransformRowsResult = parsed.transformRows.length
          ? await tx.materialTransformImportRow.createMany({
              data: parsed.transformRows.map((row) => ({
                sessionId,
                fileId: importFile.id,
                sourceRowNo: row.sourceRowNo,
                rowHash: row.rowHash,
                sourcePartCode: row.sourcePartCode,
                targetPartCode: row.targetPartCode,
                customerCode: row.customerCode,
                customerName: row.customerName,
                projectModel: row.projectModel,
                multiplier: row.multiplier,
                lossRate: row.lossRate,
                defaultProcessRoute: row.defaultProcessRoute,
                conversionDescription: row.conversionDescription,
                remark: row.remark,
                status: row.status,
                raw: row.raw,
                issues: row.issues,
                errorCount: row.errorCount,
                warningCount: row.warningCount
              })),
              skipDuplicates: true
            })
          : { count: 0 };
        const acceptedRowCount = createRowsResult.count + createApplicabilityRowsResult.count + createTransformRowsResult.count;
        return tx.materialImportFile.update({
          where: { id: importFile.id },
          data: {
            acceptedRowCount,
            duplicateRowCount: parsedRowCount - acceptedRowCount
          }
        });
        },
        '零件库导入会话正在被其他操作修改，请刷新后重新上传'
      );
      await this.refreshMaterialImportSessionIssues(sessionId);

      return {
        ...(await this.buildMaterialImportSessionPreview(sessionId, this.materialImportPageOptions())),
        uploadResult: {
          fileName: normalizedFileName,
          sheetName: parsed.sheetName,
          rowCount: parsedRowCount,
          acceptedRowCount: createdFile.acceptedRowCount,
          duplicateRowCount: createdFile.duplicateRowCount
        }
      };
    } catch (error) {
      if (createdFile?.id) {
        await this.prisma.materialImportFile.delete({ where: { id: createdFile.id } }).catch(() => undefined);
      }
      await this.removeMaterialImportStoredFile(file.filename);
      throw error;
    }
  }

  async commitMaterialImportSession(sessionId: string, dto: CommitMaterialImportSessionDto) {
    await this.refreshMaterialImportSessionIssues(sessionId);
    const preview = await this.buildMaterialImportSessionPreview(sessionId, { includeRows: false });
    if (preview.status !== 'DRAFT') {
      throw new BadRequestException('只有草稿导入会话可以提交');
    }
    if (!preview.previewToken || dto.previewToken !== preview.previewToken) {
      throw new BadRequestException('导入预览已变化，请刷新预览后再提交');
    }
    if (preview.summary.rowCount === 0) {
      throw new BadRequestException('没有可提交的零件导入行');
    }
    if (preview.summary.errorCount > 0) {
      throw new BadRequestException('导入存在错误，请先修正 Excel 后重新上传');
    }

    const result = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
      const freshPreview = await this.buildMaterialImportPreviewTokenSnapshot(sessionId, tx);
      if (freshPreview.status !== 'DRAFT') {
        throw new BadRequestException('只有草稿导入会话可以提交');
      }
      if (freshPreview.previewToken !== dto.previewToken) {
        throw new BadRequestException('导入预览已变化，请刷新预览后再提交');
      }
      if (freshPreview.rowCount === 0) {
        throw new BadRequestException('没有可提交的零件导入行');
      }
      if (freshPreview.errorCount > 0) {
        throw new BadRequestException('导入存在错误，请先修正 Excel 后重新上传');
      }

      const rows = await tx.materialImportRow.findMany({
        where: { sessionId, errorCount: 0 },
        orderBy: [{ partCode: 'asc' }, { createdAt: 'asc' }]
      });
      const [applicabilityRows, transformRows] = await Promise.all([
        tx.materialApplicabilityImportRow.findMany({
          where: { sessionId, errorCount: 0 },
          orderBy: [{ partCode: 'asc' }, { createdAt: 'asc' }]
        }),
        tx.materialTransformImportRow.findMany({
          where: { sessionId, errorCount: 0 },
          orderBy: [{ targetPartCode: 'asc' }, { createdAt: 'asc' }]
        })
      ]);
      const materialRows = this.uniqueMaterialImportRows(rows);
      const partCodes = [
        ...materialRows.map((row) => row.partCode),
        ...applicabilityRows.map((row) => row.partCode),
        ...transformRows.flatMap((row) => [row.sourcePartCode, row.targetPartCode])
      ];
      const existingMaterials = await this.findExistingMaterialsByPartCodes(partCodes, tx);
      const existingByCode = new Map(existingMaterials.map((material) => [material.partCode.trim().toLocaleLowerCase(), material]));
      const customerLookup = await this.findMaterialImportCustomers([...applicabilityRows, ...transformRows], tx);
      let createdCount = 0;
      let updatedCount = 0;
      let drawingRevisionUpsertCount = 0;
      let applicabilityUpsertCount = 0;
      let transformRuleUpsertCount = 0;
      const committedMaterialCodes: string[] = [];

      for (const row of materialRows) {
      const key = row.partCode.trim().toLocaleLowerCase();
      const existing = existingByCode.get(key);
      // 库存报警导入只写 Material 基础资料提醒，不创建订单、生产任务或库存流水。
      // 默认工艺导入也只写 Material 后续下单建议，不自动生成流程、订单或生产任务。
      const stockAlertData = this.materialImportStockAlertData(row);
      const defaultProcessRoute = await this.normalizeMaterialDefaultProcessRoute(row.defaultProcessRoute);
      if (existing) {
        await tx.material.update({
          where: { id: existing.id },
          data: {
            partCode: row.partCode,
            partName: row.partName,
            unit: row.unit,
            partSpecification: row.partSpecification || null,
            defaultProcessRoute,
            status: 'ENABLED',
            ...stockAlertData
            }
          });
          updatedCount += 1;
        } else {
          const created = await tx.material.create({
            data: {
            partCode: row.partCode,
            partName: row.partName,
            unit: row.unit,
            partSpecification: row.partSpecification || null,
            defaultProcessRoute,
            status: 'ENABLED',
            ...stockAlertData
            }
          });
          existingByCode.set(key, created);
          createdCount += 1;
        }
        committedMaterialCodes.push(row.partCode);
      }

      const drawingRows = this.uniqueMaterialDrawingImportRows(rows);
      const drawingMaterialIds = [
        ...new Set(
          drawingRows
            .map((row) => existingByCode.get(String(row.partCode || '').trim().toLocaleLowerCase())?.id)
            .filter(Boolean)
        )
      ] as string[];
      const existingDefaultDrawingRows =
        drawingMaterialIds.length > 0
          ? await tx.materialDrawingRevision.findMany({
              where: { materialId: { in: drawingMaterialIds }, isDefault: true, status: 'ENABLED' },
              select: { materialId: true }
            })
          : [];
      const materialsWithDefaultDrawing = new Set(existingDefaultDrawingRows.map((row) => row.materialId));
      for (const row of drawingRows) {
        const material = existingByCode.get(String(row.partCode || '').trim().toLocaleLowerCase());
        if (!material) {
          continue;
        }
        const drawingNo = String(row.drawingNo || '').trim();
        if (!drawingNo) {
          continue;
        }
        const drawingVersion = String(row.drawingVersion || 'A').trim() || 'A';
        const existingRevision = await tx.materialDrawingRevision.findFirst({
          where: {
            materialId: material.id,
            drawingNo: { equals: drawingNo, mode: 'insensitive' },
            drawingVersion: { equals: drawingVersion, mode: 'insensitive' }
          },
          select: { id: true, isDefault: true }
        });
        const shouldSetDefault = Boolean(existingRevision?.isDefault) || !materialsWithDefaultDrawing.has(material.id);
        if (shouldSetDefault) {
          await tx.materialDrawingRevision.updateMany({
            where: { materialId: material.id, isDefault: true, ...(existingRevision ? { id: { not: existingRevision.id } } : {}) },
            data: { isDefault: false }
          });
        }
        const data = {
          drawingNo,
          drawingVersion,
          drawingDate: row.drawingDate || null,
          drawingStatus: row.drawingStatus || null,
          drawingFileName: null,
          drawingFileUrl: null,
          isDefault: shouldSetDefault,
          defaultChangedBy: shouldSetDefault ? '零件库导入' : null,
          defaultChangedAt: shouldSetDefault ? new Date() : null,
          remark: row.remark || null,
          status: 'ENABLED' as const
        };
        if (existingRevision) {
          await tx.materialDrawingRevision.update({ where: { id: existingRevision.id }, data });
        } else {
          await tx.materialDrawingRevision.create({ data: { materialId: material.id, ...data } });
        }
        if (shouldSetDefault) {
          materialsWithDefaultDrawing.add(material.id);
        }
        drawingRevisionUpsertCount += 1;
      }

      for (const row of applicabilityRows) {
        const material = existingByCode.get(row.partCode.trim().toLocaleLowerCase());
        if (!material) {
          throw new BadRequestException(`适用范围零件 ${row.partCode} 不存在，请先导入或新增零件基础资料`);
        }
        const customer = this.resolveMaterialImportCustomer(row, customerLookup);
        const projectModel = String(row.projectModel || '').trim() || null;
        const data = {
          customerId: customer?.id || null,
          customerNameSnapshot: customer?.customerName || null,
          projectModel,
          customerScopeKey: customer?.id || 'ALL',
          projectModelScopeKey: this.normalizeMaterialScopeKey(projectModel),
          remark: row.remark || null,
          status: row.status
        };
        const existing = await tx.materialApplicability.findUnique({
          where: {
            materialId_customerScopeKey_projectModelScopeKey: {
              materialId: material.id,
              customerScopeKey: data.customerScopeKey,
              projectModelScopeKey: data.projectModelScopeKey
            }
          },
          select: { id: true }
        });
        if (existing) {
          await tx.materialApplicability.update({ where: { id: existing.id }, data });
        } else {
          await tx.materialApplicability.create({ data: { materialId: material.id, ...data } });
        }
        applicabilityUpsertCount += 1;
      }

      for (const row of transformRows) {
        const sourceMaterial = existingByCode.get(row.sourcePartCode.trim().toLocaleLowerCase());
        const targetMaterial = existingByCode.get(row.targetPartCode.trim().toLocaleLowerCase());
        if (!sourceMaterial || !targetMaterial) {
          throw new BadRequestException(
            `来源加工关系 ${row.sourcePartCode} -> ${row.targetPartCode} 的来源或目标零件不存在，请先导入或新增零件基础资料`
          );
        }
        const customer = this.resolveMaterialImportCustomer(row, customerLookup);
        const projectModel = String(row.projectModel || '').trim() || null;
        const processNames = this.splitDefaultProcessRoute(row.defaultProcessRoute || '');
        if (processNames.length > 0) {
          // 提交前重新核对标准工序，避免预览后标准工序被停用仍写入正式来源加工关系。
          await this.processDefinitionsService.ensureActiveNames(processNames);
        }
        const data = {
          sourceMaterialId: sourceMaterial.id,
          targetMaterialId: targetMaterial.id,
          customerId: customer?.id || null,
          customerNameSnapshot: customer?.customerName || null,
          projectModel,
          customerScopeKey: customer?.id || 'ALL',
          projectModelScopeKey: this.normalizeMaterialScopeKey(projectModel),
          conversionDescription: row.conversionDescription || null,
          defaultProcessRoute: processNames.length > 0 ? processNames.join('、') : null,
          multiplier: row.multiplier ?? 1,
          lossRate: row.lossRate ?? null,
          remark: row.remark || null,
          status: row.status
        };
        const existing = await tx.materialTransformRule.findUnique({
          where: {
            sourceMaterialId_targetMaterialId_customerScopeKey_projectModelScopeKey: {
              sourceMaterialId: data.sourceMaterialId,
              targetMaterialId: data.targetMaterialId,
              customerScopeKey: data.customerScopeKey,
              projectModelScopeKey: data.projectModelScopeKey
            }
          },
          select: { id: true }
        });
        if (existing) {
          await tx.materialTransformRule.update({ where: { id: existing.id }, data });
        } else {
          await tx.materialTransformRule.create({ data });
        }
        transformRuleUpsertCount += 1;
      }

      await tx.materialImportSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMMITTED',
          committedAt: new Date(),
          committedMaterialCodes
        }
      });

      return { createdCount, updatedCount, drawingRevisionUpsertCount, applicabilityUpsertCount, transformRuleUpsertCount, committedMaterialCodes };
      },
      '零件库导入会话正在被其他操作修改，请刷新预览后重新提交'
    );

    return {
      sessionId,
      ...result,
      committedMaterialCount: result.createdCount + result.updatedCount
    };
  }

  async deleteMaterialImportFile(sessionId: string, fileId: string) {
    const deletedFile = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const session = await tx.materialImportSession.findUnique({ where: { id: sessionId }, select: { status: true } });
        if (!session) {
          throw new NotFoundException('零件导入会话不存在');
        }
        if (session.status !== 'DRAFT') {
          throw new BadRequestException('已提交或已放弃的零件导入会话不能删除文件');
        }
        const importFile = await tx.materialImportFile.findFirst({
          where: { id: fileId, sessionId },
          select: { id: true, storedFileName: true }
        });
        if (!importFile) {
          throw new NotFoundException('零件导入文件不存在');
        }
        await tx.materialImportFile.delete({ where: { id: importFile.id } });
        return importFile;
      },
      '零件库导入会话正在被其他操作修改，请刷新后重新删除文件'
    );
    await this.removeMaterialImportStoredFile(deletedFile.storedFileName);
    await this.refreshMaterialImportSessionIssues(sessionId);
    return this.buildMaterialImportSessionPreview(sessionId, this.materialImportPageOptions());
  }

  async discardMaterialImportSession(sessionId: string) {
    const discardedFileNames = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const session = await tx.materialImportSession.findUnique({
          where: { id: sessionId },
          include: { files: { select: { storedFileName: true } } }
        });
        if (!session) {
          throw new NotFoundException('零件导入会话不存在');
        }
        if (session.status === 'COMMITTED') {
          throw new BadRequestException('已提交的零件导入会话不能放弃');
        }
        const storedFileNames = session.files.map((file) => file.storedFileName);
        await tx.materialImportSession.delete({ where: { id: sessionId } });
        return storedFileNames;
      },
      '零件库导入会话正在被其他操作修改，请刷新后重新放弃'
    );
    await Promise.all(discardedFileNames.map((storedFileName) => this.removeMaterialImportStoredFile(storedFileName)));
    return {
      sessionId,
      discarded: true,
      deletedFileCount: discardedFileNames.length
    };
  }

  async materialApplicabilities(materialId: string) {
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      select: {
        id: true,
        partCode: true,
        partName: true,
        applicabilities: {
          include: {
            customer: {
              select: {
                id: true,
                customerName: true,
                customerCode: true
              }
            }
          },
          orderBy: [{ status: 'asc' }, { customerScopeKey: 'asc' }, { projectModelScopeKey: 'asc' }]
        }
      }
    });
    if (!material) {
      throw new NotFoundException('零件基础资料不存在');
    }
    return {
      material: {
        id: material.id,
        partCode: material.partCode,
        partName: material.partName
      },
      items: material.applicabilities.map((item) => this.serializeMaterialApplicability(item))
    };
  }

  async buildMaterialApplicabilitiesExport(materialId: string): Promise<Uint8Array> {
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      select: {
        id: true,
        partCode: true,
        partName: true,
        unit: true,
        partSpecification: true,
        status: true,
        applicabilities: {
          include: {
            customer: {
              select: {
                id: true,
                customerName: true,
                customerCode: true
              }
            }
          },
          orderBy: [{ status: 'asc' }, { customerScopeKey: 'asc' }, { projectModelScopeKey: 'asc' }]
        }
      }
    });
    if (!material) {
      throw new NotFoundException('零件基础资料不存在');
    }

    // 零件适用范围导出只读取当前零件适用规则，不生成订单、不占用库存、不改 BOM 或生产任务。
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();
    const headers = [
      '序号',
      '零件编码',
      '零件名称',
      '单位',
      '成品规格',
      '客户范围',
      '客户编码',
      '客户名称',
      '机型/项目范围',
      '机型/项目',
      '适用范围',
      '状态',
      '备注'
    ];
    const exportRows =
      material.applicabilities.length > 0
        ? material.applicabilities.map((item, index) => [
            index + 1,
            material.partCode,
            material.partName,
            material.unit,
            material.partSpecification || '',
            item.customerId ? '指定客户' : '全部客户',
            item.customer?.customerCode || '',
            item.customer?.customerName || item.customerNameSnapshot || '',
            item.projectModel ? '指定机型/项目' : '全部机型/项目',
            item.projectModel || '',
            this.serializeMaterialApplicability(item).scopeLabel,
            this.materialMemoryExportStatusText(item.status),
            item.remark || ''
          ])
        : [['当前零件没有维护适用范围']];

    this.addInventoryExportSheet(workbook, {
      sheetName: '适用范围',
      title: '零件适用范围导出',
      scopeText: [
        `零件：${material.partCode} / ${material.partName}`,
        `单位：${material.unit}`,
        `成品规格：${material.partSpecification || '-'}`,
        `零件状态：${this.materialMemoryExportStatusText(material.status)}`
      ].join('；'),
      headers,
      rows: exportRows
    });

    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  async saveMaterialApplicability(materialId: string, dto: SaveMaterialApplicabilityDto) {
    const material = await this.prisma.material.findUnique({ where: { id: materialId }, select: { id: true } });
    if (!material) {
      throw new NotFoundException('零件基础资料不存在');
    }
    const scope = await this.resolveMaterialApplicabilityScope(dto);
    const existing = await this.prisma.materialApplicability.findUnique({
      where: {
        materialId_customerScopeKey_projectModelScopeKey: {
          materialId,
          customerScopeKey: scope.customerScopeKey,
          projectModelScopeKey: scope.projectModelScopeKey
        }
      }
    });

    const row = existing
      ? await this.prisma.materialApplicability.update({
          where: { id: existing.id },
          data: scope,
          include: { customer: { select: { id: true, customerName: true, customerCode: true } } }
        })
      : await this.prisma.materialApplicability.create({
          data: {
            materialId,
            ...scope
          },
          include: { customer: { select: { id: true, customerName: true, customerCode: true } } }
        });
    return this.serializeMaterialApplicability(row);
  }

  async updateMaterialApplicability(applicabilityId: string, dto: SaveMaterialApplicabilityDto) {
    const existing = await this.prisma.materialApplicability.findUnique({
      where: { id: applicabilityId },
      select: { id: true, materialId: true, status: true }
    });
    if (!existing) {
      throw new NotFoundException('零件适用范围不存在');
    }
    if (dto.status !== undefined && dto.status !== existing.status) {
      // 零件适用范围状态变更必须走 disableMaterialApplicability / restoreMaterialApplicability，避免普通编辑绕过客户和机型推荐边界。
      throw new BadRequestException('零件适用范围状态请使用专用启用/停用接口');
    }
    const scope = await this.resolveMaterialApplicabilityScope({ ...dto, status: dto.status || existing.status });
    const duplicate = await this.prisma.materialApplicability.findUnique({
      where: {
        materialId_customerScopeKey_projectModelScopeKey: {
          materialId: existing.materialId,
          customerScopeKey: scope.customerScopeKey,
          projectModelScopeKey: scope.projectModelScopeKey
        }
      },
      select: { id: true }
    });
    if (duplicate && duplicate.id !== existing.id) {
      throw new BadRequestException('相同客户和机型/项目适用范围已存在');
    }
    const row = await this.prisma.materialApplicability.update({
      where: { id: existing.id },
      data: scope,
      include: { customer: { select: { id: true, customerName: true, customerCode: true } } }
    });
    return this.serializeMaterialApplicability(row);
  }

  async disableMaterialApplicability(applicabilityId: string) {
    const existing = await this.prisma.materialApplicability.findUnique({ where: { id: applicabilityId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('零件适用范围不存在');
    }
    const row = await this.prisma.materialApplicability.update({
      where: { id: applicabilityId },
      data: { status: 'DISABLED' },
      include: { customer: { select: { id: true, customerName: true, customerCode: true } } }
    });
    return this.serializeMaterialApplicability(row);
  }

  async restoreMaterialApplicability(applicabilityId: string) {
    const existing = await this.prisma.materialApplicability.findUnique({
      where: { id: applicabilityId },
      include: {
        material: { select: { id: true, status: true } }
      }
    });
    if (!existing) {
      throw new NotFoundException('零件适用范围不存在');
    }
    if (existing.material.status !== 'ENABLED') {
      throw new BadRequestException('恢复适用范围前，所属零件基础资料必须是启用状态');
    }
    // 恢复适用范围只恢复后续推荐入口，不重写客户范围、机型范围，也不生成订单、库存或生产任务。
    const row = await this.prisma.materialApplicability.update({
      where: { id: applicabilityId },
      data: { status: 'ENABLED' },
      include: { customer: { select: { id: true, customerName: true, customerCode: true } } }
    });
    return this.serializeMaterialApplicability(row);
  }

  private serializeMaterialApplicability(item: {
    id: string;
    materialId: string;
    customerId: string | null;
    customerNameSnapshot: string | null;
    projectModel: string | null;
    customerScopeKey: string;
    projectModelScopeKey: string;
    remark: string | null;
    status: CommonStatus;
    customer?: { id: string; customerName: string; customerCode: string } | null;
  }) {
    const customerName = item.customer?.customerName || item.customerNameSnapshot || '';
    const customerScopeLabel = item.customerId ? customerName || '指定客户' : '全部客户';
    const projectScopeLabel = item.projectModel ? item.projectModel : '全部机型/项目';
    return {
      id: item.id,
      materialId: item.materialId,
      customerId: item.customerId,
      customerCode: item.customer?.customerCode,
      customerName,
      projectModel: item.projectModel,
      customerScopeKey: item.customerScopeKey,
      projectModelScopeKey: item.projectModelScopeKey,
      scopeLabel: `${customerScopeLabel} / ${projectScopeLabel}`,
      remark: item.remark,
      status: item.status
    };
  }

  private async resolveModelBomScope(dto: SaveModelBomDto) {
    const bomName = this.normalizeMaterialRequired(dto.bomName, '零件包名称');
    const projectModel = String(dto.projectModel || '').trim();
    const status = dto.status || 'ENABLED';
    const selectedCustomerIds = [
      ...new Set((dto.customerIds || []).map((id) => String(id || '').trim()).filter(Boolean))
    ].sort();
    const requestedMode = (dto.customerScopeMode || (selectedCustomerIds.length > 0 ? 'SELECTED' : dto.customerId ? 'PRIVATE' : 'ALL')) as ModelBomCustomerScopeMode;
    const projectModelScopeKey = this.normalizeMaterialScopeKey(projectModel);

    if (requestedMode === 'SELECTED') {
      if (selectedCustomerIds.length === 0) {
        throw new BadRequestException('请选择至少一个可使用该 BOM 的客户');
      }
      const selectedCustomers = await this.prisma.customer.findMany({
        where: { id: { in: selectedCustomerIds }, status: 'ENABLED' },
        select: { id: true, customerName: true, customerCode: true }
      });
      if (selectedCustomers.length !== selectedCustomerIds.length) {
        throw new BadRequestException('BOM 指定客户范围包含不存在或已停用的客户');
      }
      const selectedCustomerMap = new Map(selectedCustomers.map((customer) => [customer.id, customer]));
      const orderedCustomers = selectedCustomerIds.map((id) => selectedCustomerMap.get(id)).filter(Boolean) as typeof selectedCustomers;
      return {
        data: {
          bomName,
          customerId: null,
          customerNameSnapshot: null,
          projectModel,
          customerScopeMode: 'SELECTED',
          customerScopeKey: `SELECTED:${selectedCustomerIds.join(',')}`,
          projectModelScopeKey,
          remark: String(dto.remark || '').trim() || null,
          status
        },
        selectedCustomers: orderedCustomers
      };
    }

    if (requestedMode === 'PRIVATE') {
      const customerId = String(dto.customerId || '').trim();
      if (!customerId) {
        throw new BadRequestException('请选择客户私有 BOM 的所属客户');
      }
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, customerName: true }
      });
      if (!customer) {
        throw new BadRequestException('零件包适用客户不存在');
      }
      return {
        data: {
          bomName,
          customerId: customer.id,
          customerNameSnapshot: customer.customerName,
          projectModel,
          customerScopeMode: 'PRIVATE',
          customerScopeKey: customer.id,
          projectModelScopeKey,
          remark: String(dto.remark || '').trim() || null,
          status
        },
        selectedCustomers: []
      };
    }

    return {
      data: {
        bomName,
        customerId: null,
        customerNameSnapshot: null,
        projectModel,
        customerScopeMode: 'ALL',
        customerScopeKey: 'ALL',
        projectModelScopeKey,
        remark: String(dto.remark || '').trim() || null,
        status
      },
      selectedCustomers: []
    };
  }

  private modelBomCustomerScopeCreateData(scope: Awaited<ReturnType<InventoryService['resolveModelBomScope']>>) {
    return scope.selectedCustomers.map((customer) => ({
      customerId: customer.id,
      customerNameSnapshot: customer.customerName,
      status: 'ENABLED' as CommonStatus
    }));
  }

  private modelBomCustomerScopeModeFromRow(row: { customerId?: string | null; customerScopeMode?: string | null }) {
    return row.customerId ? 'PRIVATE' : row.customerScopeMode === 'SELECTED' ? 'SELECTED' : 'ALL';
  }

  private modelBomCustomerScopeBroadens(previousMode: ModelBomCustomerScopeMode, nextMode: ModelBomCustomerScopeMode) {
    return previousMode !== 'ALL' && nextMode === 'ALL';
  }

  private modelBomProjectScopeBroadens(previousProjectModel?: string | null, nextProjectModel?: string | null) {
    return Boolean(String(previousProjectModel || '').trim()) && !String(nextProjectModel || '').trim();
  }

  private modelBomCustomerScopeExposesNewCustomers(
    row: { customerId?: string | null; customerScopeMode?: string | null; customerScopes?: Array<{ customerId: string; status?: CommonStatus }> },
    nextMode: ModelBomCustomerScopeMode,
    nextCustomerId?: string | null,
    nextCustomerIds: string[] = []
  ) {
    const previousMode = this.modelBomCustomerScopeModeFromRow(row);
    if (previousMode === 'ALL' || nextMode === 'ALL') {
      return false;
    }
    const previousCustomerIds = new Set(this.modelBomVisibleCustomerIds(row, previousMode));
    const nextVisibleCustomerIds =
      nextMode === 'PRIVATE'
        ? [String(nextCustomerId || '').trim()].filter(Boolean)
        : [...new Set(nextCustomerIds.map((customerId) => String(customerId || '').trim()).filter(Boolean))];

    /* 新增可见客户才需要管理员审批；同一客户从 PRIVATE 改为 SELECTED 不算扩大。 */
    return nextVisibleCustomerIds.some((customerId) => !previousCustomerIds.has(customerId));
  }

  private modelBomVisibleCustomerIds(
    row: { customerId?: string | null; customerScopes?: Array<{ customerId: string; status?: CommonStatus }> },
    mode: ModelBomCustomerScopeMode
  ) {
    if (mode === 'PRIVATE') {
      return [String(row.customerId || '').trim()].filter(Boolean);
    }
    if (mode === 'SELECTED') {
      return [
        ...new Set(
          (row.customerScopes || [])
            .filter((scope) => !scope.status || scope.status === 'ENABLED')
            .map((scope) => String(scope.customerId || '').trim())
            .filter(Boolean)
        )
      ];
    }
    return [];
  }

  private modelBomCurrentScopeApprovalSnapshot(row: {
    bomName: string;
    customerId?: string | null;
    customerNameSnapshot?: string | null;
    customerScopeMode?: string | null;
    customerScopeKey: string;
    projectModel: string;
    projectModelScopeKey: string;
    customerScopes?: Array<{ customerId: string; customerNameSnapshot?: string | null; status?: CommonStatus }>;
  }): Prisma.InputJsonValue {
    return {
      bomName: row.bomName,
      customerScopeMode: this.modelBomCustomerScopeModeFromRow(row),
      customerId: row.customerId || null,
      customerNameSnapshot: row.customerNameSnapshot || null,
      customerScopeKey: row.customerScopeKey,
      projectModel: row.projectModel,
      projectModelScopeKey: row.projectModelScopeKey,
      customerIds: (row.customerScopes || [])
        .filter((scope) => !scope.status || scope.status === 'ENABLED')
        .map((scope) => ({
          customerId: scope.customerId,
          customerName: scope.customerNameSnapshot || ''
        }))
    };
  }

  private modelBomRequestedScopeApprovalSnapshot(scope: Awaited<ReturnType<InventoryService['resolveModelBomScope']>>): Prisma.InputJsonValue {
    return {
      bomName: scope.data.bomName,
      customerScopeMode: scope.data.customerScopeMode,
      customerId: scope.data.customerId || null,
      customerNameSnapshot: scope.data.customerNameSnapshot || null,
      customerScopeKey: scope.data.customerScopeKey,
      projectModel: scope.data.projectModel,
      projectModelScopeKey: scope.data.projectModelScopeKey,
      customerIds: scope.selectedCustomers.map((customer) => ({
        customerId: customer.id,
        customerName: customer.customerName,
        customerCode: customer.customerCode
      }))
    };
  }

  private modelBomScopeApprovalMatchesRequest(
    row: {
      requestedCustomerScopeMode: string;
      requestedScopeKey: string;
      requestedProjectModelScopeKey: string;
    },
    scope: Awaited<ReturnType<InventoryService['resolveModelBomScope']>>
  ) {
    return (
      row.requestedCustomerScopeMode === scope.data.customerScopeMode &&
      row.requestedScopeKey === scope.data.customerScopeKey &&
      row.requestedProjectModelScopeKey === scope.data.projectModelScopeKey
    );
  }

  private nextModelBomScopeApprovalRequestNo() {
    return `BOM-SCOPE-${businessDateTimeKey()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  private modelBomInclude(
    orderBy: Prisma.ModelBomLineOrderByWithRelationInput[] = [{ status: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }]
  ): Prisma.ModelBomInclude {
    return {
      customer: { select: { id: true, customerName: true, customerCode: true } },
      customerScopes: {
        where: { status: 'ENABLED' },
        include: { customer: { select: { id: true, customerName: true, customerCode: true } } },
        orderBy: [{ customerNameSnapshot: 'asc' }]
      },
      lines: {
        include: this.modelBomLineInclude(),
        orderBy
      }
    };
  }

  private async createModelBomRevision(
    tx: Prisma.TransactionClient,
    bomId: string,
    action: string,
    changedBy?: string | null,
    changeRemark?: string | null
  ) {
    const row = await tx.modelBom.findUnique({
      where: { id: bomId },
      include: {
        customerScopes: {
          where: { status: 'ENABLED' },
          orderBy: [{ customerNameSnapshot: 'asc' }]
        },
        lines: {
          include: {
            defaultDrawingRevision: {
              select: {
                id: true,
                drawingNo: true,
                drawingVersion: true,
                drawingDate: true,
                drawingStatus: true,
                drawingFileName: true,
                drawingFileUrl: true,
                status: true
              }
            }
          },
          orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }]
        }
      }
    });
    if (!row) {
      throw new NotFoundException('机型零件包不存在，无法记录 BOM 版本');
    }
    const latestRevision = await tx.modelBomRevision.aggregate({
      where: { bomId },
      _max: { revisionNo: true }
    });
    const snapshotJson: Prisma.InputJsonValue = {
      bom: {
        id: row.id,
        bomName: row.bomName,
        customerId: row.customerId,
        customerNameSnapshot: row.customerNameSnapshot,
        projectModel: row.projectModel,
        customerScopeMode: row.customerScopeMode,
        customerScopeKey: row.customerScopeKey,
        projectModelScopeKey: row.projectModelScopeKey,
        sourceBomId: row.sourceBomId,
        sourceBomNameSnapshot: row.sourceBomNameSnapshot,
        isCommon: row.isCommon,
        commonSortOrder: row.commonSortOrder,
        remark: row.remark,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      },
      customerScopes: row.customerScopes.map((scope) => ({
        customerId: scope.customerId,
        customerNameSnapshot: scope.customerNameSnapshot,
        status: scope.status
      })),
      lines: row.lines.map((line) => ({
        id: line.id,
        materialId: line.materialId,
        partCodeSnapshot: line.partCodeSnapshot,
        partNameSnapshot: line.partNameSnapshot,
        unitSnapshot: line.unitSnapshot,
        partSpecificationSnapshot: line.partSpecificationSnapshot,
        partThicknessSnapshot: decimalToNumber(line.partThicknessSnapshot),
        lineType: line.lineType,
        partCategory: line.partCategory,
        componentNo: line.componentNo,
        parentComponentNo: line.parentComponentNo,
        defaultDrawingRevisionId: line.defaultDrawingRevisionId,
        defaultDrawingRevision: line.defaultDrawingRevision
          ? {
              id: line.defaultDrawingRevision.id,
              drawingNo: line.defaultDrawingRevision.drawingNo,
              drawingVersion: line.defaultDrawingRevision.drawingVersion,
              drawingDate: line.defaultDrawingRevision.drawingDate?.toISOString() || null,
              drawingStatus: line.defaultDrawingRevision.drawingStatus,
              drawingFileName: line.defaultDrawingRevision.drawingFileName,
              drawingFileUrl: line.defaultDrawingRevision.drawingFileUrl,
              status: line.defaultDrawingRevision.status
            }
          : null,
        defaultProcessRoute: line.defaultProcessRoute,
        defaultQuantity: decimalToNumber(line.defaultQuantity),
        remark: line.remark,
        sortOrder: line.sortOrder,
        status: line.status,
        createdAt: line.createdAt.toISOString(),
        updatedAt: line.updatedAt.toISOString()
      }))
    };
    const revision = await tx.modelBomRevision.create({
      data: {
        bomId,
        revisionNo: (latestRevision._max.revisionNo ?? 0) + 1,
        action,
        changedBy: String(changedBy || '').trim() || null,
        changeRemark: String(changeRemark || '').trim() || null,
        snapshotJson
      }
    });
    return this.serializeModelBomRevision(revision);
  }

  async modelBomRevisions(bomId: string, query: ModelBomRevisionQueryDto) {
    const existing = await this.prisma.modelBom.findUnique({ where: { id: bomId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('机型零件包不存在');
    }
    const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
    const offset = Math.max(Number(query.offset || 0), 0);
    const [totalCount, rows] = await Promise.all([
      this.prisma.modelBomRevision.count({ where: { bomId } }),
      this.prisma.modelBomRevision.findMany({
        where: { bomId },
        orderBy: [{ revisionNo: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit
      })
    ]);
    const items = rows.map((row) => this.serializeModelBomRevision(row));
    return {
      items,
      totalCount,
      limit,
      offset,
      hasMore: offset + items.length < totalCount
    };
  }

  async modelBomScopeApprovalRequests(query: ModelBomScopeApprovalRequestQueryDto = {}) {
    const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
    const offset = Math.max(Number(query.offset || 0), 0);
    const includeTestFixtures = query.includeTestFixtures === 'true';
    const where: Prisma.ModelBomScopeApprovalRequestWhereInput = {};
    if (query.bomId?.trim()) {
      where.bomId = query.bomId.trim();
    }
    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }
    if (query.requestedCustomerScopeMode) {
      where.requestedCustomerScopeMode = query.requestedCustomerScopeMode;
    }
    if (query.requestedScopeKey?.trim()) {
      where.requestedScopeKey = query.requestedScopeKey.trim();
    }
    if (query.requestedProjectModelScopeKey?.trim()) {
      where.requestedProjectModelScopeKey = query.requestedProjectModelScopeKey.trim();
    }
    if (!includeTestFixtures) {
      where.NOT = this.modelBomScopeApprovalFixtureWhere();
    }
    const [totalCount, rows] = await Promise.all([
      this.prisma.modelBomScopeApprovalRequest.count({ where }),
      this.prisma.modelBomScopeApprovalRequest.findMany({
        where,
        include: { bom: { select: { bomName: true, customerNameSnapshot: true, projectModel: true, status: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit
      })
    ]);
    return {
      items: rows.map((row) => this.serializeModelBomScopeApprovalRequest(row)),
      totalCount,
      limit,
      offset,
      hasMore: offset + rows.length < totalCount
    };
  }

  async createModelBomScopeApprovalRequest(bomId: string, dto: CreateModelBomScopeApprovalRequestDto) {
    const requestedBy = String(dto.requestedBy || '').trim();
    const reason = String(dto.requestReason || '').trim();
    if (!requestedBy) {
      throw new BadRequestException('请填写 BOM 范围申请人');
    }
    if (!reason) {
      throw new BadRequestException('请填写 BOM 范围扩大申请原因');
    }
    const existing = await this.prisma.modelBom.findUnique({
      where: { id: bomId },
      select: {
        id: true,
        bomName: true,
        customerId: true,
        customerNameSnapshot: true,
        customerScopeMode: true,
        customerScopeKey: true,
        projectModel: true,
        projectModelScopeKey: true,
        status: true,
        customerScopes: { where: { status: 'ENABLED' }, select: { customerId: true, customerNameSnapshot: true, status: true } }
      }
    });
    if (!existing) {
      throw new NotFoundException('机型零件包不存在');
    }
    const scope = await this.resolveModelBomScope(dto);
    const previousScopeMode = this.modelBomCustomerScopeModeFromRow(existing);
    const nextScopeMode = scope.data.customerScopeMode as ModelBomCustomerScopeMode;
    const nextScopeCustomerIds = scope.selectedCustomers.map((customer) => customer.id);
    const scopeBroadens =
      this.modelBomCustomerScopeBroadens(previousScopeMode, nextScopeMode) ||
      this.modelBomCustomerScopeExposesNewCustomers(existing, nextScopeMode, scope.data.customerId, nextScopeCustomerIds) ||
      this.modelBomProjectScopeBroadens(existing.projectModel, scope.data.projectModel);
    if (!scopeBroadens) {
      throw new BadRequestException('只有扩大 BOM 可见客户或机型范围时才需要管理员审批申请');
    }
    const duplicateApproval = await this.prisma.modelBomScopeApprovalRequest.findFirst({
      where: {
        bomId,
        requestedCustomerScopeMode: scope.data.customerScopeMode,
        requestedScopeKey: scope.data.customerScopeKey,
        requestedProjectModelScopeKey: scope.data.projectModelScopeKey,
        status: { in: ['PENDING', 'APPROVED'] },
        usedAt: null
      },
      select: { requestNo: true, status: true }
    });
    if (duplicateApproval) {
      throw new BadRequestException(`相同 BOM 范围已有未使用审批申请：${duplicateApproval.requestNo}`);
    }
    const currentScopeJson = this.modelBomCurrentScopeApprovalSnapshot(existing);
    const requestedScopeJson = this.modelBomRequestedScopeApprovalSnapshot(scope);
    try {
      const row = await this.prisma.modelBomScopeApprovalRequest.create({
        data: {
          requestNo: this.nextModelBomScopeApprovalRequestNo(),
          bomId,
          requestedBomName: scope.data.bomName,
          requestedCustomerScopeMode: scope.data.customerScopeMode,
          requestedCustomerId: scope.data.customerId,
          requestedCustomerNameSnapshot: scope.data.customerNameSnapshot,
          requestedCustomerIds: scope.selectedCustomers.map((customer) => ({
            customerId: customer.id,
            customerName: customer.customerName,
            customerCode: customer.customerCode
          })) as Prisma.InputJsonValue,
          requestedProjectModel: scope.data.projectModel,
          requestedScopeKey: scope.data.customerScopeKey,
          requestedProjectModelScopeKey: scope.data.projectModelScopeKey,
          currentScopeJson,
          requestedScopeJson,
          reason,
          requestedBy
        },
        include: { bom: { select: { bomName: true, customerNameSnapshot: true, projectModel: true, status: true } } }
      });
      return this.serializeModelBomScopeApprovalRequest(row);
    } catch (error) {
      this.handleModelBomScopeApprovalOpenUniqueError(error);
    }
  }

  async approveModelBomScopeApprovalRequest(requestId: string, dto: ReviewModelBomScopeApprovalRequestDto) {
    return this.reviewModelBomScopeApprovalRequest(requestId, dto, 'APPROVED');
  }

  async rejectModelBomScopeApprovalRequest(requestId: string, dto: ReviewModelBomScopeApprovalRequestDto) {
    return this.reviewModelBomScopeApprovalRequest(requestId, dto, 'REJECTED');
  }

  private async reviewModelBomScopeApprovalRequest(
    requestId: string,
    dto: ReviewModelBomScopeApprovalRequestDto,
    nextStatus: 'APPROVED' | 'REJECTED'
  ) {
    const reviewedBy = String(dto.reviewedBy || '').trim();
    if (!reviewedBy) {
      throw new BadRequestException('请填写管理员审批人');
    }
    const existing = await this.prisma.modelBomScopeApprovalRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true } });
    if (!existing) {
      throw new NotFoundException('BOM 范围审批申请不存在');
    }
    if (existing.status !== 'PENDING') {
      throw new BadRequestException('只有待审批的 BOM 范围申请可以审批');
    }
    const now = new Date();
    const row = await this.prisma.modelBomScopeApprovalRequest.update({
      where: { id: requestId },
      data:
        nextStatus === 'APPROVED'
          ? {
              status: 'APPROVED',
              approvedBy: reviewedBy,
              approvedAt: now,
              reviewRemark: String(dto.reviewRemark || '').trim() || null
            }
          : {
              status: 'REJECTED',
              rejectedBy: reviewedBy,
              rejectedAt: now,
              reviewRemark: String(dto.reviewRemark || '').trim() || null
            },
      include: { bom: { select: { bomName: true, customerNameSnapshot: true, projectModel: true, status: true } } }
    });
    return this.serializeModelBomScopeApprovalRequest(row);
  }

  private async nextModelBomCommonSortOrder(customerScopeKey: string, projectModelScopeKey: string) {
    const maxCommon = await this.prisma.modelBom.aggregate({
      _max: { commonSortOrder: true },
      where: {
        isCommon: true,
        customerScopeKey,
        projectModelScopeKey
      }
    });
    return (maxCommon._max.commonSortOrder ?? 0) + 1;
  }

  private async modelBomCommonSaveData(args: {
    isCommon?: boolean;
    customerScopeKey: string;
    projectModelScopeKey: string;
    existing?: { isCommon: boolean; commonSortOrder: number | null; customerScopeKey: string; projectModelScopeKey: string } | null;
  }) {
    if (typeof args.isCommon !== 'boolean') {
      return {};
    }
    if (!args.isCommon) {
      return { isCommon: false, commonSortOrder: null };
    }
    if (
      args.existing?.isCommon &&
      args.existing.commonSortOrder &&
      args.existing.customerScopeKey === args.customerScopeKey &&
      args.existing.projectModelScopeKey === args.projectModelScopeKey
    ) {
      return {
        isCommon: true,
        commonSortOrder: args.existing.commonSortOrder
      };
    }
    const commonSortOrder = await this.nextModelBomCommonSortOrder(args.customerScopeKey, args.projectModelScopeKey);
    return {
      isCommon: true,
      commonSortOrder
    };
  }

  private modelBomLineInclude(): Prisma.ModelBomLineInclude {
    return {
      defaultDrawingRevision: true,
      material: {
        select: {
          id: true,
          partCode: true,
          partName: true,
          unit: true,
          partSpecification: true,
          defaultProcessRoute: true,
          status: true,
          drawingRevisions: {
            where: { status: 'ENABLED' },
            orderBy: [{ isDefault: 'desc' }, { drawingDate: 'desc' }, { createdAt: 'desc' }]
          }
        }
      }
    };
  }

  private modelBomLinePartCodes(lines: Array<{ partCodeSnapshot: string; material?: { partCode: string } | null }>) {
    return [
      ...new Set(
        lines
          .map((line) => String(line.material?.partCode || line.partCodeSnapshot || '').trim())
          .filter(Boolean)
      )
    ];
  }

  private modelBomThicknessKey(partCode: string, customerId?: string | null, projectModel?: string | null) {
    const codeKey = String(partCode || '').trim().toLocaleLowerCase();
    const customerScopeKey = String(customerId || '').trim() || 'ALL';
    const projectScopeKey = this.normalizeMaterialScopeKey(projectModel);
    return `${codeKey}__${customerScopeKey}__${projectScopeKey}`;
  }

  private setLatestModelBomThickness(
    latestByScopeKey: Map<string, ModelBomThicknessSnapshot>,
    key: string,
    snapshot: ModelBomThicknessSnapshot
  ) {
    const existing = latestByScopeKey.get(key);
    if (!existing || snapshot.orderTime > existing.orderTime || (snapshot.orderTime === existing.orderTime && snapshot.lineTime > existing.lineTime)) {
      latestByScopeKey.set(key, snapshot);
    }
  }

  private async latestOrderLineThicknessByScopeKey(partCodes: string[]) {
    const uniquePartCodes = [...new Set(partCodes.map((partCode) => String(partCode || '').trim()).filter(Boolean))];
    const latestByScopeKey = new Map<string, ModelBomThicknessSnapshot>();
    for (let index = 0; index < uniquePartCodes.length; index += 200) {
      const chunk = uniquePartCodes.slice(index, index + 200);
      const rows = await this.prisma.orderLine.findMany({
        where: { OR: chunk.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' } })) },
        select: {
          partCode: true,
          projectModel: true,
          partThickness: true,
          createdAt: true,
          order: { select: { customerId: true, orderDate: true } }
        },
        orderBy: [{ order: { orderDate: 'desc' } }, { createdAt: 'desc' }]
      });
      for (const row of rows) {
        const partCode = row.partCode.trim();
        if (!partCode) {
          continue;
        }
        const orderTime = row.order.orderDate.getTime();
        const lineTime = row.createdAt.getTime();
        const snapshot = { partThickness: decimalToNumber(row.partThickness), orderTime, lineTime };
        // BOM 厚度来自历史订单快照；客户/机型匹配优先，避免同编码跨客户厚度被误用。
        const keys = new Set([
          this.modelBomThicknessKey(partCode, row.order.customerId, row.projectModel),
          this.modelBomThicknessKey(partCode, row.order.customerId, null),
          this.modelBomThicknessKey(partCode, null, row.projectModel),
          this.modelBomThicknessKey(partCode, null, null)
        ]);
        for (const key of keys) {
          this.setLatestModelBomThickness(latestByScopeKey, key, snapshot);
        }
      }
    }
    return new Map([...latestByScopeKey].map(([key, value]) => [key, value.partThickness]));
  }

  async modelBoms(query: ModelBomQueryDto) {
    const status = query.status === 'ALL' ? undefined : query.status || 'ENABLED';
    const projectModel = query.projectModel?.trim();
    const withPage = query.withPage === 'true';
    const includeTestFixtures = query.includeTestFixtures === 'true';
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const where: Prisma.ModelBomWhereInput = {
      ...(status ? { status } : {}),
      ...(projectModel
        ? {
            OR: [{ projectModel: { contains: projectModel, mode: 'insensitive' } }, { projectModelScopeKey: 'ALL' }]
          }
        : {})
    };
    const customerId = query.customerId?.trim();
    if (customerId) {
      const projectScopeOr = where.OR;
      const customerScopeOr: Prisma.ModelBomWhereInput[] = [
        { customerId },
        { customerId: null, customerScopeMode: 'ALL' },
        { customerId: null, customerScopeMode: 'SELECTED', customerScopes: { some: { customerId, status: 'ENABLED' } } }
      ];
      where.AND = [{ OR: customerScopeOr }, ...(projectScopeOr ? [{ OR: projectScopeOr }] : [])];
      delete where.OR;
    }
    const rows = await this.prisma.modelBom.findMany({
      where,
      include: this.modelBomInclude(),
      orderBy: [
        { customerScopeKey: 'asc' },
        { projectModelScopeKey: 'asc' },
        { isCommon: 'desc' },
        { commonSortOrder: 'asc' },
        { projectModel: 'asc' },
        { bomName: 'asc' },
        { id: 'asc' }
      ]
    });
    const businessRows = includeTestFixtures ? rows : rows.filter((row) => !this.isDisabledTestFixtureModelBom(row));
    const visibleRows =
      customerId && query.excludeGlobalAllProject === 'true'
        ? businessRows.filter((row) => !(row.customerScopeMode === 'ALL' && row.projectModelScopeKey === 'ALL'))
        : businessRows;
    const normalizedKeyword = normalizeSearchKeyword(query.keyword);
    const filtered = normalizedKeyword
      ? visibleRows.filter((row) =>
          pinyinSearchMatches(
            [
              row.bomName,
              row.projectModel,
              row.customer?.customerName,
              row.customer?.customerCode,
              row.customerNameSnapshot,
              ...row.customerScopes.map((scope) => scope.customerNameSnapshot),
              ...row.lines.flatMap((line) => [line.partCodeSnapshot, line.partNameSnapshot])
            ],
            normalizedKeyword
          )
        )
      : visibleRows;
    const scopeSummary = this.modelBomScopeSummary(filtered);
    const scopedRows = query.scopeMode ? filtered.filter((row) => this.modelBomCustomerScopeModeForRow(row) === query.scopeMode) : filtered;
    const commonRows = query.commonOnly === 'true' ? scopedRows.filter((row) => row.isCommon) : scopedRows;
    const sortedRows = this.sortModelBomRows(commonRows, query);
    const totalCount = sortedRows.length;
    const sameScopeCountByKey = this.modelBomSameScopeCountMap(sortedRows);
    const pageRows = withPage ? sortedRows.slice(offset, offset + limit) : sortedRows;
    const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(pageRows.flatMap((row) => row.lines)));
    const items = pageRows.map((row) =>
      this.serializeModelBom(row, partThicknessByScopeKey, sameScopeCountByKey.get(this.modelBomSameScopeKey(row)) || 1, {
        previewScopeCustomers: withPage,
        previewLines: withPage
      })
    );
    return withPage
      ? {
          items,
          totalCount,
          limit,
          offset,
          hasMore: offset + items.length < totalCount,
          scopeSummary
        }
      : items;
  }

  private modelBomCustomerScopeModeForRow(row: ModelBomSortableRow): ModelBomCustomerScopeMode {
    if (row.customerScopeMode === 'SELECTED') {
      return 'SELECTED';
    }
    if (row.customerId) {
      return 'PRIVATE';
    }
    return 'ALL';
  }

  private modelBomScopeSummary(rows: ModelBomSortableRow[]) {
    return {
      totalCount: rows.length,
      allCustomerCount: rows.filter((row) => this.modelBomCustomerScopeModeForRow(row) === 'ALL').length,
      selectedCustomerCount: rows.filter((row) => this.modelBomCustomerScopeModeForRow(row) === 'SELECTED').length,
      privateCount: rows.filter((row) => this.modelBomCustomerScopeModeForRow(row) === 'PRIVATE').length,
      commonCount: rows.filter((row) => row.isCommon).length
    };
  }

  private modelBomSameScopeKey(row: Pick<ModelBomSortableRow, 'customerScopeKey' | 'projectModelScopeKey'>) {
    return `${row.customerScopeKey || 'ALL'}__${row.projectModelScopeKey || 'ALL'}`;
  }

  private modelBomSameScopeCountMap(rows: ModelBomSortableRow[]) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const scopeKey = this.modelBomSameScopeKey(row);
      counts.set(scopeKey, (counts.get(scopeKey) || 0) + 1);
    }
    return counts;
  }

  private sortModelBomRows<T extends ModelBomSortableRow>(
    rows: T[],
    query: ModelBomQueryDto
  ) {
    const requestedCustomerId = String(query.customerId || '').trim();
    const requestedProjectModel = this.normalizeMaterialScopeKey(query.projectModel);
    return [...rows].sort((left, right) => {
      // 订单推荐 BOM 时，客户专属清单优先于百胜通用清单；通用清单只作为兜底建议。
      const leftCustomerScore = this.modelBomCustomerScopeSortScore(left, requestedCustomerId);
      const rightCustomerScore = this.modelBomCustomerScopeSortScore(right, requestedCustomerId);
      if (leftCustomerScore !== rightCustomerScore) {
        return leftCustomerScore - rightCustomerScore;
      }

      const leftProjectScopeKey = this.normalizeMaterialScopeKey(left.projectModel);
      const rightProjectScopeKey = this.normalizeMaterialScopeKey(right.projectModel);
      const leftProjectScore = requestedProjectModel === 'ALL' ? 0 : leftProjectScopeKey === requestedProjectModel ? 0 : leftProjectScopeKey === 'ALL' ? 1 : 2;
      const rightProjectScore =
        requestedProjectModel === 'ALL' ? 0 : rightProjectScopeKey === requestedProjectModel ? 0 : rightProjectScopeKey === 'ALL' ? 1 : 2;
      if (leftProjectScore !== rightProjectScore) {
        return leftProjectScore - rightProjectScore;
      }

      // 常用 BOM 只提升同一客户/机型范围内的显示优先级，不改变适用范围或自动带入订单。
      if (Boolean(left.isCommon) !== Boolean(right.isCommon)) {
        return left.isCommon ? -1 : 1;
      }
      if (left.isCommon && right.isCommon) {
        const leftOrder = left.commonSortOrder ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.commonSortOrder ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
      }

      const leftStableKey = [
        left.customerScopeKey || 'ALL',
        left.projectModelScopeKey || 'ALL',
        left.projectModel || '',
        left.bomName || '',
        left.id || ''
      ].join('|');
      const rightStableKey = [
        right.customerScopeKey || 'ALL',
        right.projectModelScopeKey || 'ALL',
        right.projectModel || '',
        right.bomName || '',
        right.id || ''
      ].join('|');
      const stableDiff = leftStableKey.localeCompare(rightStableKey, 'zh-Hans-CN');
      if (stableDiff !== 0) {
        return stableDiff;
      }
      return 0;
    });
  }

  private modelBomCustomerScopeSortScore(row: ModelBomSortableRow, requestedCustomerId: string) {
    if (!requestedCustomerId) {
      if (row.customerScopeMode === 'ALL' || (!row.customerScopeMode && !row.customerId)) {
        return 0;
      }
      return row.customerScopeMode === 'SELECTED' ? 1 : 2;
    }
    if (row.customerId === requestedCustomerId) {
      return 0;
    }
    if (row.customerScopeMode === 'SELECTED' && row.customerScopes?.some((scope) => scope.customerId === requestedCustomerId && scope.status === 'ENABLED')) {
      return 1;
    }
    if (!row.customerId && (row.customerScopeMode === 'ALL' || !row.customerScopeMode)) {
      return 2;
    }
    return 3;
  }

  async modelBom(bomId: string) {
    const row = await this.prisma.modelBom.findUnique({
      where: { id: bomId },
      include: this.modelBomInclude()
    });
    if (!row) {
      throw new NotFoundException('机型零件包不存在');
    }
    const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
    return this.serializeModelBom(row, partThicknessByScopeKey);
  }

  async buildModelBomsExport(query: ModelBomQueryDto): Promise<Uint8Array> {
    // BOM 导出只读取筛选后的零件包和明细快照，不创建订单、不覆盖正式 BOM、不改动库存或生产。
    const rows = (await this.modelBoms({
      ...query,
      withPage: undefined,
      limit: undefined,
      offset: undefined
    })) as any[];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();
    const scopeText = await this.modelBomExportScopeText(query);

    this.addInventoryExportSheet(workbook, {
      sheetName: 'BOM列表',
      title: '机型零件包导出',
      scopeText,
      headers: [
        '序号',
        'BOM名称',
        'BOM范围',
        '适用范围',
        '所属客户',
        '机型/项目',
        '常用',
        '常用排序',
        '来源BOM',
        '有效推荐行',
        '明细总行',
        '组件',
        '子零件',
        '单独零件',
        '未匹配父级',
        '厚度待核对',
        '停用明细',
        '基础零件停用',
        '状态',
        '备注'
      ],
      rows: rows.map((row, index) => {
        const summary = this.modelBomExportLineSummary(row.lines || []);
        return [
          index + 1,
          row.bomName,
          row.scopeTypeLabel || this.modelBomExportScopeModeLabel(row.customerScopeMode),
          row.scopeLabel,
          row.customerName || '',
          row.projectModel || '全部机型/项目',
          row.isCommon ? '是' : '否',
          row.commonSortOrder ?? '',
          row.sourceBomNameSnapshot || '',
          row.lineCount ?? summary.effectiveCount,
          (row.lines || []).length,
          summary.componentCount,
          summary.childPartCount,
          summary.standalonePartCount,
          summary.orphanPartCount,
          summary.missingThicknessCount,
          summary.disabledCount,
          summary.materialDisabledCount,
          this.modelBomExportStatusLabel(row.status),
          row.remark || ''
        ];
      })
    });

    const detailRows: InventoryExportCellValue[][] = [];
    for (const row of rows) {
      const lines = [...(row.lines || [])].sort(
        (left: any, right: any) =>
          Number(left.displayOrder ?? 0) - Number(right.displayOrder ?? 0) ||
          Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0) ||
          String(left.partCode || '').localeCompare(String(right.partCode || ''), 'zh-Hans-CN')
      );
      for (const line of lines) {
        detailRows.push([
          row.bomName,
          row.scopeTypeLabel || this.modelBomExportScopeModeLabel(row.customerScopeMode),
          row.scopeLabel,
          row.customerName || '',
          row.projectModel || '全部机型/项目',
          row.isCommon ? '是' : '否',
          this.modelBomExportStatusLabel(row.status),
          line.displayOrder ?? '',
          this.modelBomExportLineTypeLabel(line),
          line.componentNo || '',
          line.parentComponentNo || '',
          line.partCode,
          line.partName,
          line.partCategory || '',
          line.defaultQuantity ?? 0,
          line.unit,
          line.partThickness ?? '',
          this.modelBomExportPartThicknessSourceLabel(line.partThicknessSource),
          line.partSpecification || '',
          line.drawingNo || '',
          line.drawingVersion || '',
          line.drawingDate || '',
          line.drawingStatus || '',
          line.drawingFileName || '',
          line.drawingFileUrl || '',
          this.modelBomExportDrawingSourceLabel(line.drawingSource),
          line.defaultProcessRoute || '',
          this.modelBomExportDefaultProcessSourceLabel(line.defaultProcessRouteSource),
          this.modelBomExportStatusLabel(line.status),
          this.modelBomExportStatusLabel(line.materialStatus),
          line.remark || ''
        ]);
      }
    }
    if (detailRows.length === 0) {
      detailRows.push(['', '', '', '', '', '', '', '', '', '', '', '', '当前筛选范围没有 BOM 明细', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    }

    this.addInventoryExportSheet(workbook, {
      sheetName: 'BOM明细',
      title: '机型零件包明细导出',
      scopeText,
      headers: [
        'BOM名称',
        'BOM范围',
        '适用范围',
        '所属客户',
        '机型/项目',
        '常用',
        'BOM状态',
        '显示行号',
        '结构',
        '组件编号',
        '所属组件',
        '零件编码',
        '零件名称',
        '零件类型',
        '默认数量',
        '单位',
        '厚度',
        '厚度来源',
        '规格',
        '图号',
        '版本',
        '图纸日期',
        '图纸状态',
        '图纸文件',
        '图纸文件地址',
        '图纸来源',
        '默认工艺',
        '工艺来源',
        '明细状态',
        '基础零件状态',
        '备注'
      ],
      rows: detailRows
    });

    const scopeRows: InventoryExportCellValue[][] = [];
    for (const row of rows) {
      const scopeMode = row.customerScopeMode || (row.customerId ? 'PRIVATE' : 'ALL');
      const commonCells = [
        row.bomName,
        row.scopeTypeLabel || this.modelBomExportScopeModeLabel(row.customerScopeMode),
        row.scopeLabel,
        row.projectModel || '全部机型/项目',
        row.isCommon ? '是' : '否',
        this.modelBomExportStatusLabel(row.status)
      ];
      if (scopeMode === 'SELECTED') {
        const scopeCustomers = row.scopeCustomers || [];
        if (scopeCustomers.length === 0) {
          scopeRows.push([scopeRows.length + 1, ...commonCells, '指定客户可用', '', '', '当前 BOM 未维护可用客户明细，请核对适用范围']);
          continue;
        }
        for (const customer of scopeCustomers) {
          scopeRows.push([
            scopeRows.length + 1,
            ...commonCells,
            '指定客户可用',
            customer.customerCode || '',
            customer.customerName || '',
            '仅该客户可在对应机型/项目范围内使用该 BOM'
          ]);
        }
      } else if (scopeMode === 'PRIVATE') {
        scopeRows.push([
          scopeRows.length + 1,
          ...commonCells,
          '客户私有',
          row.customerCode || '',
          row.customerName || '',
          '仅所属客户可使用该 BOM'
        ]);
      } else {
        scopeRows.push([scopeRows.length + 1, ...commonCells, '全部客户通用', '', '全部客户', '全部客户可在对应机型/项目范围内使用该 BOM']);
      }
    }
    if (scopeRows.length === 0) {
      scopeRows.push(['当前筛选范围没有 BOM 适用客户记录']);
    }

    this.addInventoryExportSheet(workbook, {
      sheetName: 'BOM适用客户',
      title: '机型零件包适用客户导出',
      scopeText,
      headers: [
        '序号',
        'BOM名称',
        'BOM范围',
        '适用范围',
        '机型/项目',
        '常用',
        'BOM状态',
        '客户范围类型',
        '客户编码',
        '客户名称',
        '说明'
      ],
      rows: scopeRows
    });

    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  async modelBomDiffReviews(bomId: string, query: ModelBomDiffReviewQueryDto) {
    const bom = await this.prisma.modelBom.findUnique({ where: { id: bomId }, select: { id: true, sourceBomId: true } });
    if (!bom) {
      throw new NotFoundException('机型零件包不存在');
    }
    const sourceBomId = query.sourceBomId?.trim() || bom.sourceBomId || undefined;
    const where: Prisma.ModelBomDiffReviewWhereInput = {
      targetBomId: bomId,
      ...(sourceBomId ? { sourceBomId } : {}),
      status: 'ENABLED'
    };
    const orderBy: Prisma.ModelBomDiffReviewOrderByWithRelationInput[] = [{ reviewedAt: 'desc' }, { id: 'desc' }];
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
    const offset = Math.max(Number(query.offset || 0), 0);
    const [totalCount, rows, keyRows] = await Promise.all([
      this.prisma.modelBomDiffReview.count({ where }),
      this.prisma.modelBomDiffReview.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit
      }),
      this.prisma.modelBomDiffReview.findMany({
        where,
        select: { reviewKey: true },
        orderBy
      })
    ]);
    const items = rows.map((row) => this.serializeModelBomDiffReview(row));
    return {
      items,
      totalCount,
      limit,
      offset,
      hasMore: offset + items.length < totalCount,
      reviewKeys: keyRows.map((row) => row.reviewKey)
    };
  }

  async buildModelBomDiffReviewsExport(bomId: string, query: ModelBomDiffReviewQueryDto): Promise<Uint8Array> {
    const bom = await this.prisma.modelBom.findUnique({
      where: { id: bomId },
      select: {
        id: true,
        bomName: true,
        customerNameSnapshot: true,
        projectModel: true,
        sourceBomId: true,
        sourceBomNameSnapshot: true,
        status: true,
        customer: { select: { customerCode: true, customerName: true } }
      }
    });
    if (!bom) {
      throw new NotFoundException('机型零件包不存在');
    }
    const sourceBomId = query.sourceBomId?.trim() || bom.sourceBomId || undefined;
    const sourceBom = sourceBomId
      ? await this.prisma.modelBom.findUnique({
          where: { id: sourceBomId },
          select: { id: true, bomName: true, projectModel: true, status: true }
        })
      : null;
    const rows = await this.prisma.modelBomDiffReview.findMany({
      where: {
        targetBomId: bomId,
        ...(sourceBomId ? { sourceBomId } : {}),
        status: 'ENABLED'
      },
      include: {
        sourceLine: { select: this.modelBomDiffReviewLineSelect() },
        targetLine: { select: this.modelBomDiffReviewLineSelect() }
      },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }]
    });

    // BOM 差异核对导出只输出人工核对记录，用于差异复核；不会覆盖来源 BOM、客户 BOM、订单、生产或库存。
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();
    const headers = [
      '序号',
      '客户BOM',
      '来源BOM',
      '客户',
      '机型/项目',
      '差异类型',
      '差异项',
      '差异说明',
      '来源行',
      '客户BOM行',
      '差异字段',
      '核对人',
      '核对备注',
      '核对时间',
      '状态'
    ];
    const exportRows =
      rows.length > 0
        ? rows.map((row, index) => [
            index + 1,
            bom.bomName,
            sourceBom?.bomName || bom.sourceBomNameSnapshot || row.sourceBomId,
            bom.customer?.customerName || bom.customerNameSnapshot || '',
            bom.projectModel || '全部机型/项目',
            this.modelBomDiffReviewIssueKindLabel(row.issueKind),
            row.issueTitle,
            row.issueDetail || '',
            this.modelBomDiffReviewLineText(row.sourceLine),
            this.modelBomDiffReviewLineText(row.targetLine),
            this.modelBomDiffReviewFieldsText(row.fieldsJson),
            row.reviewedBy || '',
            row.reviewRemark || '保留为客户 BOM 差异',
            this.businessDateTimeText(row.reviewedAt),
            this.modelBomExportStatusLabel(row.status)
          ])
        : [['当前 BOM 没有已确认的来源差异核对记录']];

    this.addInventoryExportSheet(workbook, {
      sheetName: '差异核对记录',
      title: 'BOM 差异核对记录导出',
      scopeText: [
        `客户BOM：${bom.bomName}`,
        `来源BOM：${sourceBom?.bomName || bom.sourceBomNameSnapshot || sourceBomId || '-'}`,
        `客户：${bom.customer?.customerName || bom.customerNameSnapshot || '-'}`,
        `机型/项目：${bom.projectModel || '全部机型/项目'}`,
        `客户BOM状态：${this.modelBomExportStatusLabel(bom.status)}`
      ].join('；'),
      headers,
      rows: exportRows
    });

    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  async confirmModelBomDiffReview(bomId: string, dto: ConfirmModelBomDiffReviewDto) {
    const bom = await this.prisma.modelBom.findUnique({ where: { id: bomId }, select: { id: true, sourceBomId: true } });
    if (!bom) {
      throw new NotFoundException('机型零件包不存在');
    }
    if (!bom.sourceBomId) {
      throw new BadRequestException('只有复制自来源 BOM 的客户 BOM 才需要差异核对');
    }
    const sourceBomId = dto.sourceBomId?.trim() || '';
    if (sourceBomId !== bom.sourceBomId) {
      throw new BadRequestException('差异核对来源 BOM 与当前客户 BOM 的复制来源不一致');
    }
    const reviewKey = dto.reviewKey.trim();
    const diffFingerprint = dto.diffFingerprint.trim();
    if (!reviewKey || !diffFingerprint) {
      throw new BadRequestException('差异核对记录缺少 reviewKey 或 diffFingerprint');
    }
    if (!reviewKey.startsWith(`${bom.id}|${bom.sourceBomId}|`)) {
      throw new BadRequestException('差异核对记录 reviewKey 与当前客户 BOM 或来源 BOM 不一致');
    }
    const issueKind = dto.issueKind.trim();
    if (!['MISSING_IN_CUSTOMER', 'CHANGED', 'CUSTOMER_EXTRA'].includes(issueKind)) {
      throw new BadRequestException('差异核对类型无效');
    }
    const sourceLineId = dto.sourceLineId?.trim() || null;
    const targetLineId = dto.targetLineId?.trim() || null;
    if (
      (issueKind === 'MISSING_IN_CUSTOMER' && (!sourceLineId || targetLineId)) ||
      (issueKind === 'CHANGED' && (!sourceLineId || !targetLineId)) ||
      (issueKind === 'CUSTOMER_EXTRA' && (sourceLineId || !targetLineId))
    ) {
      throw new BadRequestException('差异核对行引用与差异类型不一致');
    }
    const issueTitle = dto.issueTitle.trim();
    if (!issueTitle) {
      throw new BadRequestException('差异核对标题不能为空');
    }
    const reviewedBy = dto.reviewedBy?.trim() || '';
    if (!reviewedBy) {
      throw new BadRequestException('BOM 差异核对必须填写核对人员');
    }
    const fieldsJson = dto.fieldsJson ? (dto.fieldsJson as Prisma.InputJsonValue) : Prisma.JsonNull;
    // 只记录人工核对结果；不会自动覆盖来源 BOM 或客户 BOM 明细。
    const row = await this.prisma.modelBomDiffReview.upsert({
      where: { reviewKey },
      create: {
        targetBomId: bom.id,
        sourceBomId: bom.sourceBomId,
        reviewKey,
        issueKind,
        sourceLineId,
        targetLineId,
        issueTitle,
        issueDetail: dto.issueDetail?.trim() || null,
        diffFingerprint,
        fieldsJson,
        reviewedBy,
        reviewRemark: dto.reviewRemark?.trim() || null,
        status: 'ENABLED',
        reviewedAt: new Date()
      },
      update: {
        issueKind,
        sourceLineId,
        targetLineId,
        issueTitle,
        issueDetail: dto.issueDetail?.trim() || null,
        diffFingerprint,
        fieldsJson,
        reviewedBy,
        reviewRemark: dto.reviewRemark?.trim() || null,
        status: 'ENABLED',
        reviewedAt: new Date()
      }
    });
    return this.serializeModelBomDiffReview(row);
  }

  async disableModelBomDiffReview(reviewId: string) {
    const existing = await this.prisma.modelBomDiffReview.findUnique({ where: { id: reviewId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('BOM 差异核对记录不存在');
    }
    // 核对记录撤销只停用人工确认，不会删除或覆盖任何 BOM 明细。
    const row = await this.prisma.modelBomDiffReview.update({
      where: { id: reviewId },
      data: { status: 'DISABLED' }
    });
    return this.serializeModelBomDiffReview(row);
  }

  async createModelBom(dto: SaveModelBomDto) {
    const scope = await this.resolveModelBomScope(dto);
    const scopeData = scope.data;
    const existing = await this.findModelBomNameScopeDuplicate(
      scopeData.bomName,
      scopeData.customerScopeKey,
      scopeData.projectModelScopeKey
    );
    if (existing) {
      throw new BadRequestException('相同名称、客户范围和机型/项目的零件包已存在');
    }
    if (dto.isCommon && scopeData.status === 'DISABLED') {
      throw new BadRequestException('已停用 BOM 不能设为常用 BOM，请先启用后再设置');
    }
    const commonSaveData =
      scopeData.status === 'DISABLED'
        ? { isCommon: false, commonSortOrder: null }
        : await this.modelBomCommonSaveData({
            isCommon: dto.isCommon,
            customerScopeKey: scopeData.customerScopeKey,
            projectModelScopeKey: scopeData.projectModelScopeKey
          });
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.modelBom.create({
        data: {
          ...scopeData,
          // 表头保存常用状态只影响同范围内显示和推荐顺序；停用表头会强制清理常用排序，不生成订单、生产任务或库存数据。
          ...commonSaveData,
          customerScopes:
            scope.selectedCustomers.length > 0
              ? {
                  create: this.modelBomCustomerScopeCreateData(scope)
                }
              : undefined
        },
          include: this.modelBomInclude([{ sortOrder: 'asc' }])
        });
        await this.createModelBomRevision(tx, created.id, 'CREATE', '零件包页面', '新建 BOM');
        return created;
      });
      const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
      return this.serializeModelBom(row, partThicknessByScopeKey);
    } catch (error) {
      this.handleModelBomNameUniqueError(error, '相同名称、客户范围和机型/项目的零件包已存在');
    }
  }

  async copyModelBom(sourceBomId: string, dto: CopyModelBomDto) {
    const source = await this.prisma.modelBom.findUnique({
      where: { id: sourceBomId },
      include: {
        lines: {
          include: {
            material: { select: { status: true } }
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
        }
      }
    });
    if (!source) {
      throw new NotFoundException('来源机型零件包不存在');
    }
    if (source.customerId) {
      throw new BadRequestException('当前阶段只允许从百胜通用零件包复制为客户零件包');
    }
    const customerId = String(dto.customerId || '').trim();
    const customer = customerId
      ? await this.prisma.customer.findUnique({
          where: { id: customerId },
          select: { id: true, customerName: true, customerCode: true }
        })
      : null;
    if (!customer) {
      throw new BadRequestException('请选择复制目标客户');
    }
    const projectModel = String(dto.projectModel ?? source.projectModel).trim();
    const bomName = String(dto.bomName || `${source.bomName}-${customer.customerName}`).trim();
    const customerScopeKey = customer.id;
    const projectModelScopeKey = this.normalizeMaterialScopeKey(projectModel);
    const duplicate = await this.findModelBomNameScopeDuplicate(bomName, customerScopeKey, projectModelScopeKey);
    if (duplicate) {
      throw new BadRequestException('目标客户下已存在相同名称和机型/项目的零件包');
    }
    const enabledComponentNos = new Set(
      source.lines
        .filter((line) => line.status === 'ENABLED' && line.material.status === 'ENABLED' && line.lineType === 'COMPONENT' && line.componentNo)
        .map((line) => this.normalizeModelBomComponentNo(line.componentNo))
        .filter(Boolean)
    );
    const copyableSourceLines = source.lines.filter((line) => {
      if (line.status !== 'ENABLED' || line.material.status !== 'ENABLED') {
        return false;
      }
      if (line.lineType === 'COMPONENT') {
        return !!this.normalizeModelBomComponentNo(line.componentNo);
      }
      if (this.normalizeModelBomComponentNo(line.componentNo)) {
        return false;
      }
      const parentComponentNo = this.normalizeModelBomComponentNo(line.parentComponentNo);
      return !parentComponentNo || enabledComponentNos.has(parentComponentNo);
    });
    if (copyableSourceLines.length === 0) {
      throw new BadRequestException('来源零件包没有可复制的启用明细');
    }
    const copiedStatus = dto.status || 'ENABLED';
    // 复制时设为常用只影响目标客户 / 机型范围内的显示顺序；停用副本强制非常用，不修改来源 BOM、订单、生产或库存。
    const copiedAsCommon = dto.isCommon === true && copiedStatus !== 'DISABLED';
    const copiedCommonSortOrder = copiedAsCommon
      ? (
          (
            await this.prisma.modelBom.aggregate({
              _max: { commonSortOrder: true },
              where: {
                isCommon: true,
                customerScopeKey,
                projectModelScopeKey
              }
            })
          )._max.commonSortOrder ?? 0
        ) + 1
      : null;

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.modelBom.create({
      data: {
        bomName,
        customerId: customer.id,
        customerNameSnapshot: customer.customerName,
        projectModel,
        customerScopeMode: 'PRIVATE',
        customerScopeKey,
        projectModelScopeKey,
        sourceBomId: source.id,
        sourceBomNameSnapshot: source.bomName,
        remark: String(dto.remark || `从 ${source.bomName} 复制生成`).trim() || null,
        status: copiedStatus,
        isCommon: copiedAsCommon,
        commonSortOrder: copiedCommonSortOrder,
        // 复制 BOM 只复制当前启用明细并生成客户独立副本，不反向修改百胜通用 BOM，也不生成订单、生产或库存数据。
        lines: {
          create: copyableSourceLines.map((line) => {
            const componentNo = this.normalizeModelBomComponentNo(line.componentNo) || null;
            const parentComponentNo = this.normalizeModelBomComponentNo(line.parentComponentNo) || null;
            return {
              materialId: line.materialId,
              partCodeSnapshot: line.partCodeSnapshot,
              partNameSnapshot: line.partNameSnapshot,
              unitSnapshot: line.unitSnapshot,
              partSpecificationSnapshot: line.partSpecificationSnapshot,
              partThicknessSnapshot: line.lineType === 'COMPONENT' ? null : line.partThicknessSnapshot,
              lineType: line.lineType,
              partCategory: line.partCategory,
              componentNo: line.lineType === 'COMPONENT' ? componentNo : null,
              parentComponentNo: line.lineType === 'COMPONENT' ? null : parentComponentNo,
              defaultDrawingRevisionId: line.defaultDrawingRevisionId,
              defaultProcessRoute: line.defaultProcessRoute,
              defaultQuantity: line.defaultQuantity,
              remark: line.remark,
              sortOrder: line.sortOrder,
              status: 'ENABLED'
            };
          })
        }
      },
      include: this.modelBomInclude()
    });
        await this.createModelBomRevision(tx, created.id, 'COPY_FROM_SOURCE', '零件包页面', `从 ${source.bomName} 复制`);
        return created;
      });
      const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
      return this.serializeModelBom(row, partThicknessByScopeKey);
    } catch (error) {
      this.handleModelBomNameUniqueError(error, '目标客户下已存在相同名称和机型/项目的零件包');
    }
  }

  async updateModelBom(bomId: string, dto: SaveModelBomDto) {
    const existing = await this.prisma.modelBom.findUnique({
      where: { id: bomId },
      select: {
        id: true,
        customerId: true,
        customerScopeMode: true,
        projectModel: true,
        customerScopeKey: true,
        projectModelScopeKey: true,
        status: true,
        isCommon: true,
        commonSortOrder: true,
        customerScopes: { select: { customerId: true, status: true } }
      }
    });
    if (!existing) {
      throw new NotFoundException('机型零件包不存在');
    }
    const scope = await this.resolveModelBomScope(dto);
    const scopeData = scope.data;
    const previousScopeMode = this.modelBomCustomerScopeModeFromRow(existing);
    const nextScopeMode = scopeData.customerScopeMode as ModelBomCustomerScopeMode;
    const nextScopeCustomerIds = scope.selectedCustomers.map((customer) => customer.id);
    const scopeBroadens =
      this.modelBomCustomerScopeBroadens(previousScopeMode, nextScopeMode) ||
      this.modelBomCustomerScopeExposesNewCustomers(existing, nextScopeMode, scopeData.customerId, nextScopeCustomerIds) ||
      this.modelBomProjectScopeBroadens(existing.projectModel, scopeData.projectModel);
    const scopeApprovalRequestId = String(dto.scopeApprovalRequestId || '').trim();
    if (scopeBroadens) {
      // 后端兜底要求扩大 BOM 可见客户范围前必须人工确认；现在人工确认升级为管理员审批申请。
      // 兼容旧校验关键词 dto.scopeChangeConfirmed !== true，但不能再仅凭弹窗确认保存；BOM 适用客户范围将被扩大时必须携带已批准申请。
      if (!scopeApprovalRequestId) {
        throw new BadRequestException('BOM 适用范围扩大需要先提交管理员审批申请，并在批准后携带审批记录保存');
      }
      const approvalRequest = await this.prisma.modelBomScopeApprovalRequest.findUnique({
        where: { id: scopeApprovalRequestId },
        select: {
          id: true,
          bomId: true,
          status: true,
          usedAt: true,
          requestedCustomerScopeMode: true,
          requestedScopeKey: true,
          requestedProjectModelScopeKey: true
        }
      });
      if (!approvalRequest || approvalRequest.bomId !== bomId) {
        throw new BadRequestException('BOM 适用范围审批申请不存在或不属于当前 BOM');
      }
      if (approvalRequest.status !== 'APPROVED' || approvalRequest.usedAt) {
        throw new BadRequestException('BOM 适用范围审批申请尚未批准或已经使用');
      }
      if (!this.modelBomScopeApprovalMatchesRequest(approvalRequest, scope)) {
        throw new BadRequestException('BOM 适用范围审批申请与当前保存范围不一致，请重新提交申请');
      }
    }
    const duplicate = await this.findModelBomNameScopeDuplicate(
      scopeData.bomName,
      scopeData.customerScopeKey,
      scopeData.projectModelScopeKey,
      bomId
    );
    if (duplicate && duplicate.id !== bomId) {
      throw new BadRequestException('相同名称、客户范围和机型/项目的零件包已存在');
    }
    if (dto.isCommon && scopeData.status === 'DISABLED') {
      throw new BadRequestException('已停用 BOM 不能设为常用 BOM，请先启用后再设置');
    }
    const commonSaveData =
      scopeData.status === 'DISABLED'
        ? { isCommon: false, commonSortOrder: null }
        : await this.modelBomCommonSaveData({
            isCommon: dto.isCommon,
            customerScopeKey: scopeData.customerScopeKey,
            projectModelScopeKey: scopeData.projectModelScopeKey,
            existing
          });
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.modelBom.update({
        where: { id: bomId },
        data: {
          ...scopeData,
          // 编辑表头时同步保存常用状态；停用表头会强制清理常用排序，不修改 BOM 明细、订单、生产或库存。
          ...commonSaveData,
          customerScopes: {
            deleteMany: {},
            create: this.modelBomCustomerScopeCreateData(scope)
          }
        },
          include: this.modelBomInclude([{ status: 'asc' }, { sortOrder: 'asc' }])
        });
        await this.createModelBomRevision(tx, updated.id, 'UPDATE_HEADER', '零件包页面', '编辑 BOM 表头和适用范围');
        if (scopeBroadens && scopeApprovalRequestId) {
          const used = await tx.modelBomScopeApprovalRequest.updateMany({
            where: { id: scopeApprovalRequestId, bomId, status: 'APPROVED', usedAt: null },
            data: { status: 'USED', usedAt: new Date() }
          });
          if (used.count !== 1) {
            throw new BadRequestException('BOM 适用范围审批申请状态已变化，请刷新后重试');
          }
        }
        return updated;
      });
      const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
      return this.serializeModelBom(row, partThicknessByScopeKey);
    } catch (error) {
      this.handleModelBomNameUniqueError(error, '相同名称、客户范围和机型/项目的零件包已存在');
    }
  }

  async setModelBomCommon(bomId: string, dto: SetModelBomCommonDto) {
    const existing = await this.prisma.modelBom.findUnique({
      where: { id: bomId },
      select: { id: true, status: true, isCommon: true, commonSortOrder: true, customerScopeKey: true, projectModelScopeKey: true }
    });
    if (!existing) {
      throw new NotFoundException('机型零件包不存在');
    }
    if (dto.isCommon && existing.status === 'DISABLED') {
      // 已停用 BOM 不能进入常用推荐；只允许启用后再人工设为常用，不自动恢复 BOM 状态。
      throw new BadRequestException('已停用 BOM 不能设为常用 BOM，请先启用后再设置');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.modelBom.update({
      where: { id: bomId },
      // 常用零件包只影响显示优先级；不会修改 BOM 明细、适用客户、订单、生产或库存。
      data: await this.modelBomCommonSaveData({
        isCommon: dto.isCommon,
        customerScopeKey: existing.customerScopeKey,
        projectModelScopeKey: existing.projectModelScopeKey,
        existing
      }),
        include: this.modelBomInclude([{ status: 'asc' }, { sortOrder: 'asc' }])
      });
      await this.createModelBomRevision(tx, updated.id, dto.isCommon ? 'SET_COMMON' : 'UNSET_COMMON', '零件包页面', '调整常用 BOM');
      return updated;
    });
    const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
    return this.serializeModelBom(row, partThicknessByScopeKey);
  }

  async setModelBomsCommonBatch(dto: SetModelBomsCommonBatchDto) {
    const bomIds = [...new Set((dto.bomIds || []).map((bomId) => String(bomId || '').trim()).filter(Boolean))];
    if (bomIds.length === 0) {
      throw new BadRequestException('请提供需要批量设置常用状态的 BOM');
    }
    const rows = await this.prisma.modelBom.findMany({
      where: { id: { in: bomIds } },
      select: {
        id: true,
        bomName: true,
        status: true,
        isCommon: true,
        commonSortOrder: true,
        customerScopeKey: true,
        projectModelScopeKey: true
      }
    });
    if (rows.length !== bomIds.length) {
      throw new BadRequestException('批量常用设置包含不存在的 BOM，请刷新后重试');
    }
    if (dto.isCommon) {
      const disabledRow = rows.find((row) => row.status === 'DISABLED');
      if (disabledRow) {
        throw new BadRequestException(`${disabledRow.bomName} 已停用，不能设为常用 BOM`);
      }
    }
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const orderedRows = bomIds.map((bomId) => rowsById.get(bomId)).filter((row): row is (typeof rows)[number] => Boolean(row));
    // 批量常用状态在事务内保存；只调整显示和推荐优先级，不修改 BOM 明细、适用客户、订单、生产任务或库存。
    return this.prisma.$transaction(async (tx) => {
      if (!dto.isCommon) {
        const updated = await tx.modelBom.updateMany({
          where: { id: { in: bomIds } },
          data: { isCommon: false, commonSortOrder: null }
        });
        for (const bomId of bomIds) {
          await this.createModelBomRevision(tx, bomId, 'UNSET_COMMON_BATCH', '零件包页面', '批量取消常用 BOM');
        }
        return { updatedCount: updated.count, isCommon: false };
      }

      const groups = new Map<string, typeof orderedRows>();
      for (const row of orderedRows) {
        const scopeKey = `${row.customerScopeKey}__${row.projectModelScopeKey}`;
        groups.set(scopeKey, [...(groups.get(scopeKey) || []), row]);
      }
      let updatedCount = 0;
      for (const groupRows of groups.values()) {
        const firstRow = groupRows[0];
        if (!firstRow) {
          continue;
        }
        const maxCommon = await tx.modelBom.aggregate({
          _max: { commonSortOrder: true },
          where: {
            isCommon: true,
            customerScopeKey: firstRow.customerScopeKey,
            projectModelScopeKey: firstRow.projectModelScopeKey
          }
        });
        let nextSortOrder = maxCommon._max.commonSortOrder ?? 0;
        for (const row of groupRows) {
          const commonSortOrder = row.isCommon && row.commonSortOrder ? row.commonSortOrder : ++nextSortOrder;
          await tx.modelBom.update({
            where: { id: row.id },
            data: { isCommon: true, commonSortOrder }
          });
          await this.createModelBomRevision(tx, row.id, 'SET_COMMON_BATCH', '零件包页面', '批量设置常用 BOM');
          updatedCount += 1;
        }
      }
      return { updatedCount, isCommon: true };
    });
  }

  async reorderModelBomCommon(dto: ReorderModelBomCommonDto) {
    const items = dto.items
      .map((item) => ({ bomId: String(item.bomId || '').trim(), commonSortOrder: Number(item.commonSortOrder) }))
      .filter((item) => item.bomId);
    if (items.length === 0) {
      throw new BadRequestException('请提供需要排序的常用 BOM');
    }
    const uniqueIds = new Set(items.map((item) => item.bomId));
    if (uniqueIds.size !== items.length) {
      throw new BadRequestException('常用 BOM 排序列表包含重复 BOM');
    }
    const rows = await this.prisma.modelBom.findMany({
      where: { id: { in: [...uniqueIds] } },
      select: { id: true, bomName: true, status: true, isCommon: true, customerScopeKey: true, projectModelScopeKey: true }
    });
    if (rows.length !== uniqueIds.size) {
      throw new BadRequestException('常用 BOM 排序列表包含不存在的 BOM');
    }
    const disabledRow = rows.find((row) => row.status === 'DISABLED');
    if (disabledRow) {
      throw new BadRequestException(`${disabledRow.bomName} 已停用，不能参与常用排序`);
    }
    const nonCommon = rows.find((row) => !row.isCommon);
    if (nonCommon) {
      throw new BadRequestException(`${nonCommon.bomName} 不是常用 BOM，不能参与常用排序`);
    }
    const firstRow = rows[0];
    if (!firstRow) {
      throw new BadRequestException('请提供需要排序的常用 BOM');
    }
    const mixedScope = rows.some((row) => row.customerScopeKey !== firstRow.customerScopeKey || row.projectModelScopeKey !== firstRow.projectModelScopeKey);
    if (mixedScope) {
      throw new BadRequestException('常用 BOM 只能在同一客户范围和同一机型/项目范围内拖拽排序');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [index, item] of items.entries()) {
        await tx.modelBom.update({
          where: { id: item.bomId },
          // 常用排序只影响推荐和列表显示优先级，不修改 BOM 明细、适用范围、订单、生产或库存。
          data: { commonSortOrder: item.commonSortOrder > 0 ? item.commonSortOrder : index + 1 }
        });
        await this.createModelBomRevision(tx, item.bomId, 'REORDER_COMMON', '零件包页面', '调整常用 BOM 排序');
      }
    });
    return { updatedCount: items.length };
  }

  async disableModelBom(bomId: string) {
    const existing = await this.prisma.modelBom.findUnique({ where: { id: bomId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('机型零件包不存在');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.modelBom.update({
      where: { id: bomId },
      // 停用 BOM 同时取消常用优先级；只影响后续推荐显示，不删除明细、订单、生产或库存。
      data: { status: 'DISABLED', isCommon: false, commonSortOrder: null },
        include: this.modelBomInclude([{ status: 'asc' }, { sortOrder: 'asc' }])
      });
      await this.createModelBomRevision(tx, updated.id, 'DISABLE_BOM', '零件包页面', '停用 BOM');
      return updated;
    });
    const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
    return this.serializeModelBom(row, partThicknessByScopeKey);
  }

  async deleteModelBom(bomId: string) {
    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const existing = await tx.modelBom.findUnique({
          where: { id: bomId },
          select: {
            id: true,
            bomName: true,
            status: true,
            lines: { select: { id: true } },
            customerScopes: { select: { id: true } },
            diffReviewsAsSource: { select: { id: true } },
            diffReviewsAsTarget: { select: { id: true } }
          }
        });
        if (!existing) {
          throw new NotFoundException('机型零件包不存在');
        }
        if (existing.status !== 'DISABLED') {
          throw new BadRequestException('只有已停用的无效空 BOM 才能永久删除；正常暂不用的 BOM 请先停用，保留历史推荐和维护记录');
        }
        if (existing.lines.length > 0) {
          throw new BadRequestException(`该 BOM 仍有 ${existing.lines.length} 行明细，只能停用，不能物理删除；BOM 行删除必须软停用以保留历史维护记录`);
        }
        if (existing.customerScopes.length > 0) {
          throw new BadRequestException(`该 BOM 仍有 ${existing.customerScopes.length} 个适用客户范围，只能停用，不能物理删除`);
        }
        const diffReviewCount = existing.diffReviewsAsSource.length + existing.diffReviewsAsTarget.length;
        if (diffReviewCount > 0) {
          throw new BadRequestException(`该 BOM 仍有 ${diffReviewCount} 条差异核对记录，只能停用，不能物理删除`);
        }
        const copiedCustomerBoms = await tx.modelBom.findMany({
          where: { sourceBomId: bomId },
          select: { bomName: true, customerNameSnapshot: true, projectModel: true, status: true },
          orderBy: [{ bomName: 'asc' }, { id: 'asc' }]
        });
        if (copiedCustomerBoms.length > 0) {
          const preview = this.formatBusinessListPreview(
            copiedCustomerBoms.map(
              (bom) => `${bom.bomName}${bom.customerNameSnapshot ? ` / ${bom.customerNameSnapshot}` : ''}${bom.projectModel ? ` / ${bom.projectModel}` : ''}`
            ),
            '客户 BOM'
          );
          throw new BadRequestException(
            `该 BOM 已被${copiedCustomerBoms.length} 个客户 BOM 作为来源引用：${preview}。请先确认并删除这些客户 BOM，或改为停用来源 BOM；永久删除不会自动覆盖客户 BOM。`
          );
        }

        // 永久删除必须在事务内重新确认 BOM 仍为空；不能在永久删除时清理 BOM 行、适用范围或差异记录。
        await tx.modelBom.delete({ where: { id: bomId } });

        return {
          id: existing.id,
          bomName: existing.bomName,
          lineCount: existing.lines.length,
          customerScopeCount: existing.customerScopes.length,
          diffReviewCount,
          deleted: true
        };
      },
      'BOM 永久删除正在被其他业务写入，请刷新后重新删除'
    );
  }

  private handleModelBomScopeApprovalOpenUniqueError(error: unknown): never {
    if (this.isModelBomScopeApprovalOpenUniqueError(error)) {
      throw new BadRequestException('相同 BOM 范围已有未使用审批申请，请刷新审批列表后继续处理');
    }
    throw error;
  }

  private async findModelBomNameScopeDuplicate(
    bomName: string,
    customerScopeKey: string,
    projectModelScopeKey: string,
    excludeId?: string
  ) {
    const bomNameKey = this.normalizeModelBomNameScopeKey(bomName);
    const where: Prisma.ModelBomWhereInput = {
      customerScopeKey,
      projectModelScopeKey
    };
    if (excludeId) {
      where.id = { not: excludeId };
    }
    const rows = await this.prisma.modelBom.findMany({
      where,
      select: { id: true, bomName: true }
    });
    return rows.find((row) => this.normalizeModelBomNameScopeKey(row.bomName) === bomNameKey) || null;
  }

  private normalizeModelBomNameScopeKey(value?: string | null) {
    return String(value || '').trim().toLowerCase();
  }

  private isModelBomScopeApprovalOpenUniqueError(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    const targetText = Array.isArray(target) ? target.join(',') : String(target || '');
    return (
      targetText.includes('ModelBomScopeApprovalRequest_open_scope_unique') ||
      (targetText.includes('bomId') &&
        targetText.includes('requestedCustomerScopeMode') &&
        targetText.includes('requestedScopeKey') &&
        targetText.includes('requestedProjectModelScopeKey'))
    );
  }

  private handleModelBomNameUniqueError(error: unknown, message: string): never {
    if (this.isModelBomNameUniqueError(error)) {
      throw new BadRequestException(message);
    }
    throw error;
  }

  private isModelBomNameUniqueError(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    const targetText = Array.isArray(target) ? target.join(',') : String(target || '');
    return (
      targetText.includes('ModelBom_bomName_ci_customerScopeKey_projectModelScopeKey_key') ||
      targetText.includes('ModelBom_bomName_customerScopeKey_projectModelScopeKey_key') ||
      (targetText.includes('bomName') && targetText.includes('customerScopeKey') && targetText.includes('projectModelScopeKey'))
    );
  }

  private normalizeModelBomLineType(value?: string | null) {
    return value === 'COMPONENT' ? 'COMPONENT' : 'PART';
  }

  private normalizeModelBomComponentNo(value?: string | null) {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized || null;
  }

  private modelBomComponentNoCandidates(...values: Array<string | null | undefined>) {
    const candidates = new Set<string>();
    for (const value of values) {
      const raw = String(value || '');
      if (raw) {
        candidates.add(raw);
      }
      const normalized = this.normalizeModelBomComponentNo(raw);
      if (normalized) {
        candidates.add(normalized);
      }
    }
    return [...candidates];
  }

  private async nextModelBomComponentNo(bomId: string) {
    const rows = await this.prisma.modelBomLine.findMany({
      where: { bomId, lineType: 'COMPONENT' },
      select: { componentNo: true }
    });
    let maxNo = 0;
    for (const row of rows) {
      const matched = /^C(\d+)$/i.exec(this.normalizeModelBomComponentNo(row.componentNo) || '');
      if (matched) {
        maxNo = Math.max(maxNo, Number(matched[1]) || 0);
      }
    }
    if (maxNo >= 9999) {
      throw new BadRequestException('当前零件包 C001-C9999 自动组件编号已用完，请手工填写当前零件包内唯一组件编号');
    }
    return `C${String(maxNo + 1).padStart(3, '0')}`;
  }

  private ensureModelBomComponentNoRange(componentNo?: string | null) {
    const matched = /^C(\d+)$/i.exec(this.normalizeModelBomComponentNo(componentNo) || '');
    if (matched && (Number(matched[1]) < 1 || Number(matched[1]) > 9999)) {
      throw new BadRequestException('组件编号只支持 C001-C9999；自定义编号请不要使用 C 开头的非 C001-C9999 数字格式');
    }
  }

  private async findModelBomComponentByNo(bomId: string, componentNo?: string | null, excludeId?: string) {
    const normalizedComponentNo = this.normalizeModelBomComponentNo(componentNo);
    if (!normalizedComponentNo) {
      return null;
    }
    const components = await this.prisma.modelBomLine.findMany({
      where: {
        bomId,
        lineType: 'COMPONENT',
        ...(excludeId ? { id: { not: excludeId } } : {})
      },
      select: { id: true, status: true, componentNo: true }
    });
    return components.find((line) => this.normalizeModelBomComponentNo(line.componentNo) === normalizedComponentNo) || null;
  }

  private async resolveModelBomLineStructure(bomId: string, dto: SaveModelBomLineDto, excludeId?: string) {
    const lineType = this.normalizeModelBomLineType(dto.lineType);
    const partCategory = String(dto.partCategory || '').trim() || null;
    let componentNo = this.normalizeModelBomComponentNo(dto.componentNo);
    let parentComponentNo = this.normalizeModelBomComponentNo(dto.parentComponentNo);

    if (lineType === 'COMPONENT') {
      parentComponentNo = null;
      componentNo = componentNo || (await this.nextModelBomComponentNo(bomId));
      this.ensureModelBomComponentNoRange(componentNo);
      const duplicateComponent = await this.findModelBomComponentByNo(bomId, componentNo, excludeId);
      if (duplicateComponent) {
        throw new BadRequestException('当前零件包内组件编号已存在');
      }
    } else {
      componentNo = null;
      if (parentComponentNo) {
        const parent = await this.findModelBomComponentByNo(bomId, parentComponentNo);
        if (!parent) {
          throw new BadRequestException('所属组件不存在，请先维护组件行');
        }
        if ((dto.status || 'ENABLED') !== 'DISABLED' && parent.status !== 'ENABLED') {
          throw new BadRequestException('所属组件已停用，请先启用组件行再维护子零件');
        }
      }
    }

    return {
      lineType,
      partCategory,
      componentNo,
      parentComponentNo
    };
  }

  private async ensureModelBomLineUnique(
    bomId: string,
    materialId: string,
    structure: Awaited<ReturnType<InventoryService['resolveModelBomLineStructure']>>,
    excludeId?: string
  ) {
    const duplicateCandidates = await this.prisma.modelBomLine.findMany({
      where: {
        bomId,
        materialId,
        lineType: structure.lineType,
        ...(excludeId ? { id: { not: excludeId } } : {})
      },
      select: { id: true, componentNo: true, parentComponentNo: true }
    });
    const componentNo = this.normalizeModelBomComponentNo(structure.componentNo);
    const parentComponentNo = this.normalizeModelBomComponentNo(structure.parentComponentNo);
    const duplicate = duplicateCandidates.find(
      (line) =>
        this.normalizeModelBomComponentNo(line.componentNo) === componentNo &&
        this.normalizeModelBomComponentNo(line.parentComponentNo) === parentComponentNo
    );
    if (duplicate) {
      throw new BadRequestException('该零件已经存在于当前零件包的相同结构位置');
    }
  }

  private splitDefaultProcessRoute(value?: string) {
    return String(value || '')
      .split(/(?:->|→|[、,，;；\n\r]+)/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async normalizeMaterialDefaultProcessRoute(value?: string | null) {
    const processNames = this.splitDefaultProcessRoute(value || '');
    if (processNames.length > 0) {
      // 零件默认工艺只作为下单初始建议；保存前仍校验标准工序库，不能绕过生产流程选择页。
      await this.processDefinitionsService.ensureActiveNames(processNames);
    }
    return processNames.length > 0 ? processNames.join('、') : null;
  }

  private async resolveModelBomLineDefaults(materialId: string, dto: SaveModelBomLineDto) {
    const defaultDrawingRevisionId = String(dto.defaultDrawingRevisionId || '').trim() || null;
    if (defaultDrawingRevisionId) {
      const revision = await this.prisma.materialDrawingRevision.findUnique({
        where: { id: defaultDrawingRevisionId },
        select: { id: true, materialId: true, status: true }
      });
      if (!revision || revision.materialId !== materialId || revision.status !== 'ENABLED') {
        throw new BadRequestException('BOM 默认图纸必须选择当前零件的启用图纸版本');
      }
    }

    const processNames = this.splitDefaultProcessRoute(dto.defaultProcessRoute);
    if (processNames.length > 0) {
      // BOM 行默认工艺只作为下单建议；保存前仍校验标准工序库，订单保存后会形成独立流程快照。
      await this.processDefinitionsService.ensureActiveNames(processNames);
    }

    return {
      defaultDrawingRevisionId,
      defaultProcessRoute: processNames.length > 0 ? processNames.join('、') : null
    };
  }

  private normalizeModelBomLineThickness(value?: number | null) {
    const thickness = Number(value ?? 0);
    if (!Number.isFinite(thickness) || thickness < 0) {
      throw new BadRequestException('BOM 行厚度不能小于 0');
    }
    return thickness > 0 ? new Prisma.Decimal(thickness) : null;
  }

  private resolveModelBomLineThicknessSnapshot(
    lineType: string,
    value: number | null | undefined,
    existing?: Prisma.Decimal | number | null
  ) {
    // 父级组件由多个子零件拼接，不维护自身厚度；厚度只核对子零件和单独零件。
    if (lineType === 'COMPONENT') {
      return null;
    }
    if (value === undefined) {
      return existing ?? null;
    }
    return this.normalizeModelBomLineThickness(value);
  }

  async saveModelBomLine(bomId: string, dto: SaveModelBomLineDto) {
    const [bom, material] = await Promise.all([
      this.prisma.modelBom.findUnique({ where: { id: bomId }, select: { id: true, customerId: true, projectModel: true, status: true } }),
      this.prisma.material.findUnique({ where: { id: dto.materialId }, select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } })
    ]);
    if (!bom) {
      throw new NotFoundException('机型零件包不存在');
    }
    if (bom.status === 'DISABLED') {
      throw new BadRequestException('停用零件包不能新增 BOM 明细，请先恢复启用后再维护');
    }
    if (!material) {
      throw new BadRequestException('零件基础资料不存在');
    }
    const defaultQuantity = Number(dto.defaultQuantity ?? 0);
    if (defaultQuantity <= 0) {
      throw new BadRequestException('默认数量必须大于 0');
    }
    if ((dto.status || 'ENABLED') === 'ENABLED' && material.status !== 'ENABLED') {
      throw new BadRequestException('停用零件不能加入启用 BOM 行，请先启用零件或将 BOM 行保存为停用');
    }
    const structure = await this.resolveModelBomLineStructure(bomId, dto);
    await this.ensureModelBomLineUnique(bomId, material.id, structure);
    const defaults = await this.resolveModelBomLineDefaults(material.id, dto);
    const sortOrder =
      dto.sortOrder ??
      ((await this.prisma.modelBomLine.aggregate({
        where: { bomId },
        _max: { sortOrder: true }
      }))._max.sortOrder ?? 0) + 10;
    const data = {
      materialId: material.id,
      partCodeSnapshot: material.partCode,
      partNameSnapshot: material.partName,
      unitSnapshot: material.unit,
      partSpecificationSnapshot: material.partSpecification,
      partThicknessSnapshot: this.resolveModelBomLineThicknessSnapshot(structure.lineType, dto.partThickness),
      lineType: structure.lineType,
      partCategory: structure.partCategory,
      componentNo: structure.componentNo,
      parentComponentNo: structure.parentComponentNo,
      defaultDrawingRevisionId: defaults.defaultDrawingRevisionId,
      defaultProcessRoute: defaults.defaultProcessRoute,
      defaultQuantity,
      remark: String(dto.remark || '').trim() || null,
      sortOrder,
      status: dto.status || 'ENABLED'
    };
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.modelBomLine.create({
        data: { bomId, ...data },
        include: this.modelBomLineInclude()
      });
      await this.createModelBomRevision(tx, bomId, 'CREATE_LINE', '零件包页面', `新增 BOM 明细 ${material.partCode}`);
      return created;
    });
    const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes([row]));
    const displayOrder = await this.modelBomLineDisplayOrderForLine(bomId, row.id);
    return this.serializeModelBomLine(row, partThicknessByScopeKey, bom, displayOrder);
  }

  async updateModelBomLine(lineId: string, dto: SaveModelBomLineDto) {
    const existing = await this.prisma.modelBomLine.findUnique({
      where: { id: lineId },
      select: { id: true, bomId: true, lineType: true, componentNo: true, partThicknessSnapshot: true, bom: { select: { customerId: true, projectModel: true, status: true } } }
    });
    if (!existing) {
      throw new NotFoundException('机型零件包明细不存在');
    }
    if (existing.bom.status === 'DISABLED') {
      throw new BadRequestException('停用零件包不能编辑 BOM 明细，请先恢复启用后再维护');
    }
    const material = await this.prisma.material.findUnique({
      where: { id: dto.materialId },
      select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true }
    });
    if (!material) {
      throw new BadRequestException('零件基础资料不存在');
    }
    const defaultQuantity = Number(dto.defaultQuantity ?? 0);
    if (defaultQuantity <= 0) {
      throw new BadRequestException('默认数量必须大于 0');
    }
    if ((dto.status || 'ENABLED') === 'ENABLED' && material.status !== 'ENABLED') {
      throw new BadRequestException('停用零件不能启用到 BOM 行，请先启用零件或将 BOM 行保存为停用');
    }
    const structure = await this.resolveModelBomLineStructure(existing.bomId, dto, existing.id);
    await this.ensureModelBomLineUnique(existing.bomId, material.id, structure, existing.id);
    const defaults = await this.resolveModelBomLineDefaults(material.id, dto);
    const existingComponentNo = this.normalizeModelBomComponentNo(existing.componentNo) || '';
    const nextComponentNo = this.normalizeModelBomComponentNo(structure.componentNo) || '';
    const existingComponentNoCandidates = this.modelBomComponentNoCandidates(existing.componentNo, existingComponentNo);
    const activeComponentNoCandidates = this.modelBomComponentNoCandidates(existing.componentNo, existingComponentNo, structure.componentNo, nextComponentNo);
    const shouldSyncChildren =
      existing.lineType === 'COMPONENT' &&
      existingComponentNo &&
      structure.lineType === 'COMPONENT' &&
      nextComponentNo &&
      existingComponentNo !== nextComponentNo;
    const shouldClearChildren = existing.lineType === 'COMPONENT' && existingComponentNo && structure.lineType !== 'COMPONENT';
    const shouldDisableChildren = structure.lineType === 'COMPONENT' && nextComponentNo && (dto.status || 'ENABLED') === 'DISABLED';

    const row = await this.prisma.$transaction(async (tx) => {
      const currentBom = await tx.modelBom.findUnique({ where: { id: existing.bomId }, select: { status: true } });
      if (!currentBom || currentBom.status === 'DISABLED') {
        // BOM 明细编辑必须在事务内复核表头状态，避免停用后仍被并发请求改写明细。
        throw new BadRequestException('停用零件包不能编辑 BOM 明细，请先恢复启用后再维护');
      }
      const updated = await tx.modelBomLine.update({
        where: { id: existing.id },
        data: {
          materialId: material.id,
          partCodeSnapshot: material.partCode,
          partNameSnapshot: material.partName,
          unitSnapshot: material.unit,
          partSpecificationSnapshot: material.partSpecification,
          partThicknessSnapshot: this.resolveModelBomLineThicknessSnapshot(structure.lineType, dto.partThickness, existing.partThicknessSnapshot),
          lineType: structure.lineType,
          partCategory: structure.partCategory,
          componentNo: structure.componentNo,
          parentComponentNo: structure.parentComponentNo,
          defaultDrawingRevisionId: defaults.defaultDrawingRevisionId,
          defaultProcessRoute: defaults.defaultProcessRoute,
          defaultQuantity,
          remark: String(dto.remark || '').trim() || null,
          sortOrder: dto.sortOrder ?? 0,
          status: dto.status || 'ENABLED'
        },
        include: this.modelBomLineInclude()
      });
      if (shouldSyncChildren) {
        // BOM 组件编号变更时，仅同步仍指向旧组件编号的子零件，保留人工改到其他组件的关系。
        await tx.modelBomLine.updateMany({
          where: { bomId: existing.bomId, parentComponentNo: { in: existingComponentNoCandidates } },
          data: { parentComponentNo: nextComponentNo }
        });
      }
      if (shouldClearChildren) {
        // 组件行改成普通零件后，原子零件不再挂靠已经不存在的组件。
        await tx.modelBomLine.updateMany({
          where: { bomId: existing.bomId, parentComponentNo: { in: existingComponentNoCandidates } },
          data: { parentComponentNo: null }
        });
      }
      if (shouldDisableChildren) {
        // 停用组件行时，所属子零件同步软停用，避免启用子零件继续挂在停用父组件下。
        await tx.modelBomLine.updateMany({
          where: { bomId: existing.bomId, parentComponentNo: { in: activeComponentNoCandidates }, status: 'ENABLED' },
          data: { status: 'DISABLED' }
        });
      }
      await this.createModelBomRevision(tx, existing.bomId, 'UPDATE_LINE', '零件包页面', `编辑 BOM 明细 ${material.partCode}`);
      return updated;
    });
    const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes([row]));
    const displayOrder = await this.modelBomLineDisplayOrderForLine(existing.bomId, row.id);
    return this.serializeModelBomLine(row, partThicknessByScopeKey, existing.bom, displayOrder);
  }

  async reorderModelBomLines(bomId: string, dto: ReorderModelBomLinesDto) {
    const items = dto.items || [];
    if (items.length === 0) {
      throw new BadRequestException('请提供需要排序的 BOM 明细');
    }
    const lineIds = items.map((item) => String(item.lineId || '').trim()).filter(Boolean);
    const uniqueLineIds = new Set(lineIds);
    if (lineIds.length !== items.length || uniqueLineIds.size !== lineIds.length) {
      throw new BadRequestException('BOM 排序明细存在空行或重复行');
    }

    const normalizedItems = items.map((item) => {
      const sortOrder = Number(item.sortOrder);
      if (!Number.isFinite(sortOrder) || sortOrder < 0) {
        throw new BadRequestException('BOM 排序值必须是大于等于 0 的数字');
      }
      return {
        lineId: String(item.lineId).trim(),
        sortOrder
      };
    });

    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const bom = await tx.modelBom.findUnique({ where: { id: bomId }, select: { id: true, status: true } });
        if (!bom) {
          throw new NotFoundException('机型零件包不存在');
        }
        if (bom.status === 'DISABLED') {
          throw new BadRequestException('停用零件包不能拖拽排序 BOM 明细，请先恢复启用后再维护');
        }
        const lines = await tx.modelBomLine.findMany({
          where: { id: { in: normalizedItems.map((item) => item.lineId) } },
          select: { id: true, bomId: true }
        });
        if (lines.length !== normalizedItems.length || lines.some((line) => line.bomId !== bomId)) {
          throw new BadRequestException('BOM 排序明细必须全部属于当前机型零件包');
        }

        // BOM 拖拽排序必须事务化保存，并在同一事务内复核表头状态，避免停用后仍被并发请求改写排序。
        for (const item of normalizedItems) {
          await tx.modelBomLine.update({
            where: { id: item.lineId },
            data: { sortOrder: item.sortOrder }
          });
        }
        await this.createModelBomRevision(tx, bomId, 'REORDER_LINES', '零件包页面', '调整 BOM 明细顺序');
      },
      'BOM 明细排序正在被其他业务写入，请刷新后重新排序'
    );
    return this.modelBom(bomId);
  }

  async disableModelBomLine(lineId: string) {
    const existing = await this.prisma.modelBomLine.findUnique({
      where: { id: lineId },
      select: { id: true, bomId: true, lineType: true, componentNo: true, bom: { select: { customerId: true, projectModel: true } } }
    });
    if (!existing) {
      throw new NotFoundException('机型零件包明细不存在');
    }
    const componentNo = this.normalizeModelBomComponentNo(existing.componentNo) || '';
    const componentNoCandidates = this.modelBomComponentNoCandidates(existing.componentNo, componentNo);
    const row = await this.prisma.$transaction(async (tx) => {
      const disabled = await tx.modelBomLine.update({
        where: { id: lineId },
        data: { status: 'DISABLED' },
        include: this.modelBomLineInclude()
      });
      if (existing.lineType === 'COMPONENT' && componentNo) {
        // BOM 行只能软停用；组件停用后子零件也必须停用，避免后续推荐出不完整结构。
        await tx.modelBomLine.updateMany({
          where: { bomId: existing.bomId, parentComponentNo: { in: componentNoCandidates }, status: 'ENABLED' },
          data: { status: 'DISABLED' }
        });
      }
      await this.createModelBomRevision(tx, existing.bomId, 'DISABLE_LINE', '零件包页面', `停用 BOM 明细 ${disabled.partCodeSnapshot}`);
      return disabled;
    });
    const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes([row]));
    const displayOrder = await this.modelBomLineDisplayOrderForLine(existing.bomId, row.id);
    return this.serializeModelBomLine(row, partThicknessByScopeKey, existing.bom, displayOrder);
  }

  private async resolveMaterialTransformRuleData(dto: SaveMaterialTransformRuleDto) {
    const sourceMaterialId = this.normalizeMaterialRequired(dto.sourceMaterialId, '来源零件');
    const targetMaterialId = this.normalizeMaterialRequired(dto.targetMaterialId, '目标零件');
    if (sourceMaterialId === targetMaterialId) {
      throw new BadRequestException('来源零件和目标零件不能相同');
    }
    const customerId = String(dto.customerId || '').trim() || null;
    const [sourceMaterial, targetMaterial, customer] = await Promise.all([
      this.prisma.material.findUnique({
        where: { id: sourceMaterialId },
        select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true }
      }),
      this.prisma.material.findUnique({
        where: { id: targetMaterialId },
        select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true }
      }),
      customerId
        ? this.prisma.customer.findUnique({
            where: { id: customerId },
            select: { id: true, customerName: true }
          })
        : null
    ]);
    if (!sourceMaterial) {
      throw new BadRequestException('来源零件不存在');
    }
    if (!targetMaterial) {
      throw new BadRequestException('目标零件不存在');
    }
    if (customerId && !customer) {
      throw new BadRequestException('适用客户不存在');
    }
    const status = dto.status || 'ENABLED';
    if (status === 'ENABLED' && (sourceMaterial.status !== 'ENABLED' || targetMaterial.status !== 'ENABLED')) {
      throw new BadRequestException('来源加工关系启用时，来源零件和目标零件都必须是启用状态');
    }
    const multiplier = Number(dto.multiplier ?? 1);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new BadRequestException('换算倍率必须大于 0');
    }
    const lossRate = dto.lossRate === undefined || dto.lossRate === null ? null : Number(dto.lossRate);
    if (lossRate !== null && (!Number.isFinite(lossRate) || lossRate < 0)) {
      throw new BadRequestException('损耗率不能小于 0');
    }
    const projectModel = String(dto.projectModel || '').trim() || null;
    const processNames = this.splitDefaultProcessRoute(dto.defaultProcessRoute);
    if (processNames.length > 0) {
      // 来源加工关系只作为库存来源建议，默认工艺保存前仍必须来自标准工序库。
      await this.processDefinitionsService.ensureActiveNames(processNames);
    }
    return {
      sourceMaterialId: sourceMaterial.id,
      targetMaterialId: targetMaterial.id,
      customerId: customer?.id || null,
      customerNameSnapshot: customer?.customerName || null,
      projectModel,
      customerScopeKey: customer?.id || 'ALL',
      projectModelScopeKey: this.normalizeMaterialScopeKey(projectModel),
      conversionDescription: String(dto.conversionDescription || '').trim() || null,
      defaultProcessRoute: processNames.length > 0 ? processNames.join('、') : null,
      multiplier,
      lossRate,
      remark: String(dto.remark || '').trim() || null,
      status
    };
  }

  private async ensureMaterialTransformRuleUnique(
    data: Awaited<ReturnType<InventoryService['resolveMaterialTransformRuleData']>>,
    excludeId?: string
  ) {
    const existing = await this.prisma.materialTransformRule.findFirst({
      where: {
        sourceMaterialId: data.sourceMaterialId,
        targetMaterialId: data.targetMaterialId,
        customerScopeKey: data.customerScopeKey,
        projectModelScopeKey: data.projectModelScopeKey,
        ...(excludeId ? { id: { not: excludeId } } : {})
      },
      select: { id: true }
    });
    if (existing) {
      throw new BadRequestException('相同来源、目标、客户范围和机型范围的加工关系已存在');
    }
  }

  async materialTransformRules(query: MaterialTransformRuleQueryDto) {
    const status = query.status || 'ENABLED';
    const withPage = query.withPage === 'true';
    const includeTestFixtures = query.includeTestFixtures === 'true';
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const and: Prisma.MaterialTransformRuleWhereInput[] = status === 'ALL' ? [] : [{ status }];
    if (status === 'ENABLED') {
      and.push({ sourceMaterial: { status: 'ENABLED' }, targetMaterial: { status: 'ENABLED' } });
    }
    const customerId = query.customerId?.trim();
    if (customerId) {
      and.push({ OR: [{ customerId }, { customerId: null }] });
    }
    const projectModel = query.projectModel?.trim();
    if (projectModel) {
      and.push({ OR: [{ projectModel: { contains: projectModel, mode: 'insensitive' } }, { projectModel: null }] });
    }
    if (query.sourceMaterialId?.trim()) {
      and.push({ sourceMaterialId: query.sourceMaterialId.trim() });
    }
    if (query.sourcePartCode?.trim()) {
      and.push({ sourceMaterial: { partCode: { equals: query.sourcePartCode.trim(), mode: 'insensitive' } } });
    }
    if (query.targetMaterialId?.trim()) {
      and.push({ targetMaterialId: query.targetMaterialId.trim() });
    }
    if (query.targetPartCode?.trim()) {
      and.push({ targetMaterial: { partCode: { equals: query.targetPartCode.trim(), mode: 'insensitive' } } });
    }
    const rows = await this.prisma.materialTransformRule.findMany({
      where: { AND: and },
      include: {
        customer: { select: { id: true, customerName: true, customerCode: true } },
        sourceMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } },
        targetMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } }
      },
      orderBy: [{ sourceMaterialId: 'asc' }, { targetMaterialId: 'asc' }, { customerScopeKey: 'asc' }, { projectModelScopeKey: 'asc' }, { id: 'asc' }]
    });
    const businessRows = includeTestFixtures ? rows : rows.filter((row) => !this.isTestFixtureMaterialTransformRule(row));
    const normalizedKeyword = normalizeSearchKeyword(query.keyword);
    const filtered = normalizedKeyword
      ? businessRows.filter((row) =>
          pinyinSearchMatches(
            [
              row.sourceMaterial.partCode,
              row.sourceMaterial.partName,
              row.targetMaterial.partCode,
              row.targetMaterial.partName,
              row.customer?.customerName,
              row.customer?.customerCode,
              row.customerNameSnapshot,
              row.projectModel,
              row.conversionDescription,
              row.defaultProcessRoute,
              row.remark
            ],
            normalizedKeyword
          )
        )
      : businessRows;
    const inventorySummary = await this.findTransformMaterialInventorySummary(
      filtered.flatMap((row) => [row.sourceMaterial.partCode, row.targetMaterial.partCode])
    );
    let serialized = filtered.map((row) => this.serializeMaterialTransformRule(row, inventorySummary));
    if (query.sourceStockStatus === 'WITH_STOCK') {
      serialized = serialized.filter((row) => row.sourceAvailableQuantity > 0);
    } else if (query.sourceStockStatus === 'NO_STOCK') {
      serialized = serialized.filter((row) => row.sourceAvailableQuantity <= 0);
    }
    if (query.targetStockStatus === 'WITH_STOCK') {
      serialized = serialized.filter((row) => row.targetAvailableQuantity > 0);
    } else if (query.targetStockStatus === 'NO_STOCK') {
      serialized = serialized.filter((row) => row.targetAvailableQuantity <= 0);
    }
    if (query.inventoryDecision === 'TARGET_STOCK') {
      serialized = serialized.filter((row) => row.targetAvailableQuantity > 0);
    } else if (query.inventoryDecision === 'SOURCE_REWORK') {
      serialized = serialized.filter((row) => row.targetAvailableQuantity <= 0 && row.sourceAvailableQuantity > 0);
    } else if (query.inventoryDecision === 'NO_STOCK') {
      serialized = serialized.filter((row) => row.targetAvailableQuantity <= 0 && row.sourceAvailableQuantity <= 0);
    }
    const totalCount = serialized.length;
    const items = withPage ? serialized.slice(offset, offset + limit) : serialized;
    return withPage
      ? {
          items,
          totalCount,
          limit,
          offset,
          hasMore: offset + items.length < totalCount
        }
      : items;
  }

  async buildMaterialTransformRulesExport(query: MaterialTransformRuleQueryDto): Promise<Uint8Array> {
    // 来源加工关系导出只读取建议规则和库存摘要，不创建订单、不提交生产、不扣减来源库存。
    const rows = (await this.materialTransformRules({
      ...query,
      withPage: undefined,
      limit: undefined,
      offset: undefined
    })) as any[];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();
    const scopeText = await this.materialTransformExportScopeText(query);
    const headers = [
      '序号',
      '库存判断',
      '判断依据',
      '来源零件编码',
      '来源零件名称',
      '来源规格',
      '来源单位',
      '来源可用库存',
      '来源库存批次',
      '来源零件状态',
      '目标零件编码',
      '目标零件名称',
      '目标规格',
      '目标单位',
      '目标可用库存',
      '目标库存批次',
      '目标零件状态',
      '客户范围',
      '机型/项目',
      '适用范围',
      '换算倍率',
      '损耗率',
      '建议工艺',
      '转换说明',
      '关系状态',
      '备注'
    ];
    const dataRows =
      rows.length > 0
        ? rows.map((row, index) => [
            index + 1,
            this.materialTransformExportDecisionLabel(row),
            this.materialTransformExportDecisionReason(row),
            row.sourcePartCode,
            row.sourcePartName,
            row.sourcePartSpecification || '',
            row.sourceUnit,
            row.sourceAvailableQuantity ?? 0,
            row.sourceAvailableBatchCount ?? 0,
            this.materialTransformExportStatusLabel(row.sourceMaterialStatus),
            row.targetPartCode,
            row.targetPartName,
            row.targetPartSpecification || '',
            row.targetUnit,
            row.targetAvailableQuantity ?? 0,
            row.targetAvailableBatchCount ?? 0,
            this.materialTransformExportStatusLabel(row.targetMaterialStatus),
            row.customerName || '全部客户',
            row.projectModel || '全部机型/项目',
            row.scopeLabel,
            row.multiplier ?? 1,
            row.lossRate ?? '',
            row.defaultProcessRoute || '',
            row.conversionDescription || '',
            this.materialTransformExportStatusLabel(row.status),
            row.remark || ''
          ])
        : [['当前筛选范围没有来源加工关系']];

    this.addInventoryExportSheet(workbook, {
      sheetName: '来源加工关系',
      title: '来源加工关系导出',
      scopeText,
      headers,
      rows: dataRows
    });

    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  async createMaterialTransformRule(dto: SaveMaterialTransformRuleDto) {
    const data = await this.resolveMaterialTransformRuleData(dto);
    await this.ensureMaterialTransformRuleUnique(data);
    const row = await this.prisma.materialTransformRule.create({
      data,
      include: {
        customer: { select: { id: true, customerName: true, customerCode: true } },
        sourceMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } },
        targetMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } }
      }
    });
    const inventorySummary = await this.findTransformMaterialInventorySummary([row.sourceMaterial.partCode, row.targetMaterial.partCode]);
    return this.serializeMaterialTransformRule(row, inventorySummary);
  }

  async updateMaterialTransformRule(ruleId: string, dto: SaveMaterialTransformRuleDto) {
    const existing = await this.prisma.materialTransformRule.findUnique({ where: { id: ruleId }, select: { id: true, status: true } });
    if (!existing) {
      throw new NotFoundException('来源加工关系不存在');
    }
    if (dto.status !== undefined && dto.status !== existing.status) {
      // 来源加工关系状态变更必须走 disableMaterialTransformRule / restoreMaterialTransformRule，避免普通编辑绕过库存来源核对边界。
      throw new BadRequestException('来源加工关系状态请使用专用启用/停用接口');
    }
    const data = await this.resolveMaterialTransformRuleData({ ...dto, status: dto.status || existing.status });
    await this.ensureMaterialTransformRuleUnique(data, ruleId);
    const row = await this.prisma.materialTransformRule.update({
      where: { id: ruleId },
      data,
      include: {
        customer: { select: { id: true, customerName: true, customerCode: true } },
        sourceMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } },
        targetMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } }
      }
    });
    const inventorySummary = await this.findTransformMaterialInventorySummary([row.sourceMaterial.partCode, row.targetMaterial.partCode]);
    return this.serializeMaterialTransformRule(row, inventorySummary);
  }

  async disableMaterialTransformRule(ruleId: string) {
    const existing = await this.prisma.materialTransformRule.findUnique({ where: { id: ruleId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('来源加工关系不存在');
    }
    const row = await this.prisma.materialTransformRule.update({
      where: { id: ruleId },
      data: { status: 'DISABLED' },
      include: {
        customer: { select: { id: true, customerName: true, customerCode: true } },
        sourceMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } },
        targetMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } }
      }
    });
    const inventorySummary = await this.findTransformMaterialInventorySummary([row.sourceMaterial.partCode, row.targetMaterial.partCode]);
    return this.serializeMaterialTransformRule(row, inventorySummary);
  }

  async restoreMaterialTransformRule(ruleId: string) {
    const existing = await this.prisma.materialTransformRule.findUnique({
      where: { id: ruleId },
      include: {
        sourceMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } },
        targetMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } }
      }
    });
    if (!existing) {
      throw new NotFoundException('来源加工关系不存在');
    }
    if (existing.sourceMaterial.status !== 'ENABLED' || existing.targetMaterial.status !== 'ENABLED') {
      throw new BadRequestException('恢复来源加工关系前，来源零件和目标零件都必须是启用状态');
    }
    // 恢复启用只恢复后续建议展示，不重写客户范围、机型范围、工艺建议，也不改订单、生产任务或库存。
    const row = await this.prisma.materialTransformRule.update({
      where: { id: ruleId },
      data: { status: 'ENABLED' },
      include: {
        customer: { select: { id: true, customerName: true, customerCode: true } },
        sourceMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } },
        targetMaterial: { select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true } }
      }
    });
    const inventorySummary = await this.findTransformMaterialInventorySummary([row.sourceMaterial.partCode, row.targetMaterial.partCode]);
    return this.serializeMaterialTransformRule(row, inventorySummary);
  }

  private async findTransformMaterialInventorySummary(partCodes: string[]) {
    const normalizedCodes = [...new Set(partCodes.map((partCode) => partCode.trim()).filter(Boolean))];
    const summary = new Map<string, { availableQuantity: number; batchCount: number }>();
    normalizedCodes.forEach((partCode) => summary.set(partCode.toLocaleLowerCase(), { availableQuantity: 0, batchCount: 0 }));
    if (normalizedCodes.length === 0) {
      return summary;
    }

    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        status: 'AVAILABLE',
        quantity: { gt: 0 },
        ...(normalizedCodes.length <= 500
          ? { OR: normalizedCodes.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' as const } })) }
          : {})
      },
      select: {
        id: true,
        partCode: true,
        quantity: true,
        sourceOrderId: true
      }
    });
    const normalizedCodeSet = new Set(normalizedCodes.map((partCode) => partCode.toLocaleLowerCase()));
    const matchedBatches = batches.filter((batch) => normalizedCodeSet.has(batch.partCode.trim().toLocaleLowerCase()));
    const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(
      matchedBatches.filter((batch) => !batch.sourceOrderId).map((batch) => batch.id)
    );

    for (const batch of matchedBatches) {
      const key = batch.partCode.trim().toLocaleLowerCase();
      const row = summary.get(key) || { availableQuantity: 0, batchCount: 0 };
      const physicalQuantity = decimalToNumber(batch.quantity);
      const reservedQuantity = batch.sourceOrderId ? 0 : (reservedQuantityByBatchId.get(batch.id) ?? 0);
      const availableQuantity = Math.max(Math.round((physicalQuantity - reservedQuantity + Number.EPSILON) * 1000) / 1000, 0);
      if (availableQuantity <= 0) {
        continue;
      }
      // 来源加工关系只显示可核对库存摘要，是否使用库存仍由库存来源核对弹窗人工确认。
      row.availableQuantity = Math.round((row.availableQuantity + availableQuantity + Number.EPSILON) * 1000) / 1000;
      row.batchCount += 1;
      summary.set(key, row);
    }

    return summary;
  }

  private serializeMaterialTransformRule(row: {
    id: string;
    sourceMaterialId: string;
    targetMaterialId: string;
    customerId: string | null;
    customerNameSnapshot: string | null;
    projectModel: string | null;
    customerScopeKey: string;
    projectModelScopeKey: string;
    conversionDescription: string | null;
    defaultProcessRoute: string | null;
    multiplier: Prisma.Decimal | number;
    lossRate: Prisma.Decimal | number | null;
    remark: string | null;
    status: CommonStatus;
    createdAt: Date;
    updatedAt: Date;
    customer?: { id: string; customerName: string; customerCode: string } | null;
    sourceMaterial: { id: string; partCode: string; partName: string; unit: string; partSpecification: string | null; status: CommonStatus };
    targetMaterial: { id: string; partCode: string; partName: string; unit: string; partSpecification: string | null; status: CommonStatus };
  }, inventorySummary: Map<string, { availableQuantity: number; batchCount: number }> = new Map()) {
    const customerName = row.customer?.customerName || row.customerNameSnapshot || '';
    const customerScopeLabel = row.customerId ? customerName || '指定客户' : '全部客户';
    const projectScopeLabel = row.projectModel || '全部机型/项目';
    const sourceInventory = inventorySummary.get(row.sourceMaterial.partCode.trim().toLocaleLowerCase()) || { availableQuantity: 0, batchCount: 0 };
    const targetInventory = inventorySummary.get(row.targetMaterial.partCode.trim().toLocaleLowerCase()) || { availableQuantity: 0, batchCount: 0 };
    return {
      id: row.id,
      sourceMaterialId: row.sourceMaterialId,
      sourcePartCode: row.sourceMaterial.partCode,
      sourcePartName: row.sourceMaterial.partName,
      sourceUnit: row.sourceMaterial.unit,
      sourcePartSpecification: row.sourceMaterial.partSpecification,
      sourceMaterialStatus: row.sourceMaterial.status,
      sourceAvailableQuantity: sourceInventory.availableQuantity,
      sourceAvailableBatchCount: sourceInventory.batchCount,
      targetMaterialId: row.targetMaterialId,
      targetPartCode: row.targetMaterial.partCode,
      targetPartName: row.targetMaterial.partName,
      targetUnit: row.targetMaterial.unit,
      targetPartSpecification: row.targetMaterial.partSpecification,
      targetMaterialStatus: row.targetMaterial.status,
      targetAvailableQuantity: targetInventory.availableQuantity,
      targetAvailableBatchCount: targetInventory.batchCount,
      customerId: row.customerId,
      customerCode: row.customer?.customerCode,
      customerName,
      projectModel: row.projectModel,
      customerScopeKey: row.customerScopeKey,
      projectModelScopeKey: row.projectModelScopeKey,
      scopeLabel: `${customerScopeLabel} / ${projectScopeLabel}`,
      conversionDescription: row.conversionDescription,
      defaultProcessRoute: row.defaultProcessRoute,
      multiplier: decimalToNumber(row.multiplier),
      lossRate: row.lossRate === null ? null : decimalToNumber(row.lossRate),
      remark: row.remark,
      status: row.status
    };
  }

  private modelBomDiffReviewLineSelect() {
    return {
      id: true,
      partCodeSnapshot: true,
      partNameSnapshot: true,
      unitSnapshot: true,
      lineType: true,
      componentNo: true,
      parentComponentNo: true,
      defaultQuantity: true
    } as const;
  }

  private modelBomDiffReviewIssueKindLabel(issueKind?: string | null) {
    if (issueKind === 'MISSING_IN_CUSTOMER') {
      return '来源 BOM 有，客户 BOM 缺失';
    }
    if (issueKind === 'CHANGED') {
      return '来源 BOM 与客户 BOM 明细不同';
    }
    if (issueKind === 'CUSTOMER_EXTRA') {
      return '客户 BOM 独有';
    }
    return issueKind || '';
  }

  private modelBomDiffReviewLineText(line?: {
    partCodeSnapshot: string;
    partNameSnapshot: string;
    unitSnapshot: string;
    lineType: string;
    componentNo: string | null;
    parentComponentNo: string | null;
    defaultQuantity: Prisma.Decimal | number;
  } | null) {
    if (!line) {
      return '';
    }
    const structure =
      line.lineType === 'COMPONENT'
        ? `组件 ${line.componentNo || ''}`.trim()
        : line.parentComponentNo
          ? `子零件 -> ${line.parentComponentNo}`
          : '独立零件';
    return `${structure} / ${line.partCodeSnapshot} ${line.partNameSnapshot} / ${decimalToNumber(line.defaultQuantity)}${line.unitSnapshot || ''}`;
  }

  private modelBomDiffReviewFieldsText(fieldsJson: Prisma.JsonValue | null) {
    const fields = typeof fieldsJson === 'object' && fieldsJson && !Array.isArray(fieldsJson) ? (fieldsJson as { fields?: unknown }).fields : undefined;
    if (!Array.isArray(fields)) {
      return fieldsJson ? JSON.stringify(fieldsJson) : '';
    }
    return fields
      .map((field) => {
        if (!field || typeof field !== 'object') {
          return '';
        }
        const item = field as { label?: unknown; sourceValue?: unknown; targetValue?: unknown; changed?: unknown };
        const label = String(item.label || '字段');
        const sourceValue = String(item.sourceValue || '-');
        const targetValue = String(item.targetValue || '-');
        const changed = item.changed === false ? '未变化' : '已变化';
        return `${label}：${sourceValue} -> ${targetValue}（${changed}）`;
      })
      .filter(Boolean)
      .join('\n');
  }

  private serializeModelBomRevision(row: {
    id: string;
    bomId: string;
    revisionNo: number;
    action: string;
    changedBy: string | null;
    changeRemark: string | null;
    snapshotJson: Prisma.JsonValue;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      bomId: row.bomId,
      revisionNo: row.revisionNo,
      action: row.action,
      changedBy: row.changedBy,
      changeRemark: row.changeRemark,
      snapshotJson: row.snapshotJson,
      createdAt: row.createdAt
    };
  }

  private serializeModelBomScopeApprovalRequest(row: any) {
    return {
      id: row.id,
      requestNo: row.requestNo,
      bomId: row.bomId,
      bomName: row.bom?.bomName || row.requestedBomName,
      requestType: row.requestType,
      status: row.status,
      requestedBomName: row.requestedBomName,
      requestedCustomerScopeMode: row.requestedCustomerScopeMode,
      requestedCustomerId: row.requestedCustomerId,
      requestedCustomerNameSnapshot: row.requestedCustomerNameSnapshot,
      requestedCustomerIds: row.requestedCustomerIds,
      requestedProjectModel: row.requestedProjectModel,
      requestedScopeKey: row.requestedScopeKey,
      requestedProjectModelScopeKey: row.requestedProjectModelScopeKey,
      currentScopeJson: row.currentScopeJson,
      requestedScopeJson: row.requestedScopeJson,
      reason: row.reason,
      requestedBy: row.requestedBy,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      rejectedBy: row.rejectedBy,
      rejectedAt: row.rejectedAt,
      reviewRemark: row.reviewRemark,
      usedAt: row.usedAt,
    };
  }

  private serializeModelBomDiffReview(row: {
    id: string;
    targetBomId: string;
    sourceBomId: string;
    reviewKey: string;
    issueKind: string;
    sourceLineId: string | null;
    targetLineId: string | null;
    issueTitle: string;
    issueDetail: string | null;
    diffFingerprint: string;
    fieldsJson: Prisma.JsonValue | null;
    reviewedBy: string | null;
    reviewRemark: string | null;
    status: CommonStatus;
    reviewedAt: Date;
  }) {
    return {
      id: row.id,
      targetBomId: row.targetBomId,
      sourceBomId: row.sourceBomId,
      reviewKey: row.reviewKey,
      issueKind: row.issueKind,
      sourceLineId: row.sourceLineId,
      targetLineId: row.targetLineId,
      issueTitle: row.issueTitle,
      issueDetail: row.issueDetail,
      diffFingerprint: row.diffFingerprint,
      fieldsJson: row.fieldsJson,
      reviewedBy: row.reviewedBy,
      reviewRemark: row.reviewRemark,
      status: row.status,
      reviewedAt: row.reviewedAt
    };
  }

  private serializeModelBom(
    row: {
    id: string;
    bomName: string;
    customerId: string | null;
    customerNameSnapshot: string | null;
    projectModel: string;
    customerScopeMode?: string | null;
    customerScopeKey: string;
    projectModelScopeKey: string;
    sourceBomId: string | null;
    sourceBomNameSnapshot: string | null;
    isCommon?: boolean | null;
    commonSortOrder?: number | null;
    remark: string | null;
    status: CommonStatus;
    customer?: { id: string; customerName: string; customerCode: string } | null;
    customerScopes?: Array<{
      customerId: string;
      customerNameSnapshot: string | null;
      status: CommonStatus;
      customer?: { id: string; customerName: string; customerCode: string } | null;
    }>;
      lines: Array<Parameters<InventoryService['serializeModelBomLine']>[0]>;
    },
    partThicknessByScopeKey = new Map<string, number>(),
    sameScopeBomCount = 1,
    options: { previewScopeCustomers?: boolean; previewLines?: boolean } = {}
  ) {
    const customerName = row.customer?.customerName || row.customerNameSnapshot || '';
    const projectScopeLabel = row.projectModel || '全部机型/项目';
    const customerScopeMode: ModelBomCustomerScopeMode = row.customerId ? 'PRIVATE' : row.customerScopeMode === 'SELECTED' ? 'SELECTED' : 'ALL';
    const scopeCustomers = (row.customerScopes || []).map((scope) => ({
      customerId: scope.customerId,
      customerCode: scope.customer?.customerCode,
      customerName: scope.customer?.customerName || scope.customerNameSnapshot || ''
    }));
    const scopeCustomerPreviewLimit = 20;
    const scopeCustomerCount = scopeCustomers.length;
    const visibleScopeCustomers = options.previewScopeCustomers ? scopeCustomers.slice(0, scopeCustomerPreviewLimit) : scopeCustomers;
    const customerScopeLabel =
      customerScopeMode === 'PRIVATE'
        ? customerName || '指定客户'
        : customerScopeMode === 'SELECTED'
          ? this.formatCustomerNamePreview(scopeCustomers.map((scope) => scope.customerName), '指定客户')
          : '全部客户';
    const scopeTypeLabel =
      customerScopeMode === 'PRIVATE' ? '客户私有' : customerScopeMode === 'SELECTED' ? '指定客户可用' : '全部客户通用';
    const displayOrderByLineId = this.modelBomLineDisplayOrderMap(row.lines);
    const lines = row.lines.map((line) =>
      this.serializeModelBomLine(
        line,
        partThicknessByScopeKey,
        { customerId: row.customerId, projectModel: row.projectModel },
        displayOrderByLineId.get(line.id)
      )
    );
    const lineSummary = this.summarizeSerializedModelBomLines(lines);
    return {
      id: row.id,
      bomName: row.bomName,
      customerId: row.customerId,
      customerCode: row.customer?.customerCode,
      customerName,
      projectModel: row.projectModel,
      customerScopeMode,
      scopeTypeLabel,
      scopeCustomerIds: scopeCustomers.map((scope) => scope.customerId),
      scopeCustomerCount,
      scopeCustomers: visibleScopeCustomers,
      customerScopeKey: row.customerScopeKey,
      projectModelScopeKey: row.projectModelScopeKey,
      scopeLabel: `${customerScopeLabel} / ${projectScopeLabel}`,
      sourceBomId: row.sourceBomId,
      sourceBomNameSnapshot: row.sourceBomNameSnapshot,
      isCommon: Boolean(row.isCommon),
      commonSortOrder: row.commonSortOrder,
      remark: row.remark,
      status: row.status,
      lineCount: row.lines.filter((line) => line.status === 'ENABLED' && line.material?.status !== 'DISABLED').length,
      lineSummary,
      sameScopeBomCount,
      lines: options.previewLines ? [] : lines
    };
  }

  private summarizeSerializedModelBomLines(lines: Array<ReturnType<InventoryService['serializeModelBomLine']>>) {
    const activeContentLines = lines.filter((line) => line.status === 'ENABLED' && line.materialStatus !== 'DISABLED');
    const enabledComponentNos = new Set(
      activeContentLines
        .filter((line) => line.lineType === 'COMPONENT')
        .map((line) => this.normalizeModelBomComponentNo(line.componentNo))
        .filter(Boolean) as string[]
    );
    return lines.reduce(
      (summary, line) => {
        const parentComponentNo = this.normalizeModelBomComponentNo(line.parentComponentNo);
        const activeLine = line.status === 'ENABLED' && line.materialStatus !== 'DISABLED';
        if (line.status === 'DISABLED') {
          summary.disabledCount += 1;
        }
        if (line.materialStatus === 'DISABLED') {
          summary.materialDisabledCount += 1;
        }
        if (!activeLine) {
          return summary;
        }
        summary.effectiveCount += 1;
        if (line.lineType !== 'COMPONENT') {
          if (Number(line.partThickness || 0) > 0 && line.partThicknessSource === 'BOM_LINE') {
            summary.confirmedThicknessCount += 1;
          } else if (Number(line.partThickness || 0) > 0 && line.partThicknessSource === 'ORDER_HISTORY') {
            summary.historyThicknessCount += 1;
          } else {
            summary.noThicknessCount += 1;
          }
          if (Number(line.partThickness || 0) <= 0 || line.partThicknessSource !== 'BOM_LINE') {
            summary.missingThicknessCount += 1;
          }
        }
        if (line.lineType === 'COMPONENT') {
          summary.componentCount += 1;
        } else if (parentComponentNo && !enabledComponentNos.has(parentComponentNo)) {
          summary.orphanPartCount += 1;
        } else if (parentComponentNo) {
          summary.childPartCount += 1;
        } else {
          summary.standalonePartCount += 1;
        }
        return summary;
      },
      {
        componentCount: 0,
        childPartCount: 0,
        standalonePartCount: 0,
        orphanPartCount: 0,
        missingThicknessCount: 0,
        disabledCount: 0,
        materialDisabledCount: 0,
        effectiveCount: 0,
        inactiveCount: Math.max(lines.length - activeContentLines.length, 0),
        confirmedThicknessCount: 0,
        historyThicknessCount: 0,
        noThicknessCount: 0
      }
    );
  }

  private formatCustomerNamePreview(names: Array<string | null | undefined>, emptyText = '-') {
    return this.formatBusinessListPreview(names, '客户', emptyText);
  }

  private formatBomNamePreview(names: Array<string | null | undefined>, emptyText = '-') {
    return this.formatBusinessListPreview(names, 'BOM', emptyText);
  }

  private formatBusinessListPreview(values: Array<string | null | undefined>, unitLabel: string, emptyText = '-', maxCount = 3) {
    const filtered = values.map((value) => String(value || '').trim()).filter(Boolean);
    if (filtered.length === 0) {
      return emptyText;
    }
    const preview = filtered.filter((_, index) => index < maxCount).join('、');
    const normalizedUnitLabel = /^[A-Za-z]/.test(unitLabel) ? ` ${unitLabel}` : unitLabel;
    return filtered.length > maxCount ? `${preview} 等 ${filtered.length} 个${normalizedUnitLabel}` : preview;
  }

  private serializeModelBomLine(
    line: {
    id: string;
    bomId: string;
    materialId: string;
    partCodeSnapshot: string;
    partNameSnapshot: string;
    unitSnapshot: string;
    partSpecificationSnapshot: string | null;
    partThicknessSnapshot?: Prisma.Decimal | number | null;
    lineType: string;
    partCategory: string | null;
    componentNo: string | null;
    parentComponentNo: string | null;
    defaultDrawingRevisionId: string | null;
    defaultProcessRoute: string | null;
    defaultQuantity: Prisma.Decimal | number;
    remark: string | null;
    sortOrder: number;
    status: CommonStatus;
    defaultDrawingRevision?: {
      id: string;
      materialId: string;
      drawingNo: string;
      drawingVersion: string;
      drawingDate: Date | null;
      drawingStatus: string | null;
      drawingFileName: string | null;
      drawingFileUrl: string | null;
      isDefault: boolean;
      defaultChangedBy: string | null;
      defaultChangedAt: Date | null;
      remark: string | null;
      status: CommonStatus;
    } | null;
    material?: {
      id: string;
      partCode: string;
      partName: string;
      unit: string;
      partSpecification: string | null;
      defaultProcessRoute: string | null;
      status: CommonStatus;
      drawingRevisions?: Array<{
        id: string;
        materialId: string;
        drawingNo: string;
        drawingVersion: string;
        drawingDate: Date | null;
        drawingStatus: string | null;
        drawingFileName: string | null;
        drawingFileUrl: string | null;
        isDefault: boolean;
        defaultChangedBy: string | null;
        defaultChangedAt: Date | null;
        remark: string | null;
        status: CommonStatus;
      }>;
    } | null;
  },
    partThicknessByScopeKey = new Map<string, number>(),
    scope: ModelBomThicknessScope = {},
    displayOrder?: number
  ) {
    const lineType = this.normalizeModelBomLineType(line.lineType);
    const componentNo = this.normalizeModelBomComponentNo(line.componentNo);
    const parentComponentNo = this.normalizeModelBomComponentNo(line.parentComponentNo);
    const structureType = lineType === 'COMPONENT' ? 'COMPONENT' : parentComponentNo ? 'CHILD_PART' : 'STANDALONE_PART';
    const structureLabel =
      structureType === 'COMPONENT'
        ? `组件 ${componentNo || '未编号'}`
        : structureType === 'CHILD_PART'
          ? `子零件 -> ${parentComponentNo || '-'}`
          : '单独零件';
    const defaultDrawingRevision = line.defaultDrawingRevision?.status === 'ENABLED' ? line.defaultDrawingRevision : null;
    const materialDrawingRevision = line.material?.drawingRevisions?.[0] || null;
    const drawingRevision = defaultDrawingRevision || materialDrawingRevision;
    const partCode = String(line.material?.partCode || line.partCodeSnapshot || '').trim();
    const bomLinePartThickness = decimalToNumber(line.partThicknessSnapshot);
    const historyPartThickness =
      partThicknessByScopeKey.get(this.modelBomThicknessKey(partCode, scope.customerId, scope.projectModel)) ??
      partThicknessByScopeKey.get(this.modelBomThicknessKey(partCode, scope.customerId, null)) ??
      partThicknessByScopeKey.get(this.modelBomThicknessKey(partCode, null, scope.projectModel)) ??
      partThicknessByScopeKey.get(this.modelBomThicknessKey(partCode, null, null)) ??
      null;
    const hasBomLinePartThickness = bomLinePartThickness > 0;
    const hasHistoryPartThickness = Number(historyPartThickness || 0) > 0;
    // 历史订单厚度只作为 BOM 核对预填，不代表当前 BOM 行已确认；前端必须继续根据 partThicknessSource 提示待核对。
    const partThickness = lineType === 'COMPONENT' ? null : hasBomLinePartThickness ? bomLinePartThickness : historyPartThickness;
    const partThicknessSource =
      lineType === 'COMPONENT' ? null : hasBomLinePartThickness ? 'BOM_LINE' : hasHistoryPartThickness ? 'ORDER_HISTORY' : null;
    // BOM 行图纸优先，其次零件默认图纸；没有默认图纸时才使用当前启用最新图纸。
    const drawingSource = defaultDrawingRevision ? 'BOM_LINE' : materialDrawingRevision?.isDefault ? 'MATERIAL_DEFAULT' : materialDrawingRevision ? 'MATERIAL_LATEST' : undefined;
    // BOM 行默认工艺优先，其次零件基础库默认工艺；都只作为下单初始建议，订单保存后形成订单行流程快照。
    const defaultProcessRoute = line.defaultProcessRoute || line.material?.defaultProcessRoute || null;
    const defaultProcessRouteSource = line.defaultProcessRoute ? 'BOM_LINE' : line.material?.defaultProcessRoute ? 'MATERIAL' : null;
    return {
      id: line.id,
      bomId: line.bomId,
      materialId: line.materialId,
      partCode: line.material?.partCode || line.partCodeSnapshot,
      partName: line.material?.partName || line.partNameSnapshot,
      unit: line.material?.unit || line.unitSnapshot,
      partSpecification: line.material?.partSpecification ?? line.partSpecificationSnapshot,
      partThickness,
      partThicknessSource,
      lineType,
      partCategory: line.partCategory,
      componentNo,
      parentComponentNo,
      structureType,
      structureLabel,
      level: structureType === 'CHILD_PART' ? 1 : 0,
      displayOrder: displayOrder ?? null,
      defaultDrawingRevisionId: line.defaultDrawingRevisionId,
      resolvedDrawingRevisionId: drawingRevision?.id,
      drawingNo: drawingRevision?.drawingNo,
      drawingVersion: drawingRevision?.drawingVersion,
      drawingDate: this.formatDateOnly(drawingRevision?.drawingDate),
      drawingStatus: drawingRevision?.drawingStatus,
      drawingFileName: drawingRevision?.drawingFileName,
      drawingFileUrl: drawingRevision?.drawingFileUrl,
      drawingSource,
      bomLineDefaultProcessRoute: line.defaultProcessRoute,
      defaultProcessRoute,
      defaultProcessRouteSource,
      defaultQuantity: decimalToNumber(line.defaultQuantity),
      remark: line.remark,
      sortOrder: line.sortOrder,
      status: line.status,
      materialStatus: line.material?.status
    };
  }

  private modelBomLineDisplayOrderMap(lines: ModelBomDisplayOrderLine[]) {
    // displayOrder 是页面查看用连续序号，必须包含当前 BOM 明细里所有可见行；sortOrder 仍只是拖拽持久化的内部间隔值。
    const sortedLines = [...lines].sort(
      (left, right) =>
        (left.sortOrder || 0) - (right.sortOrder || 0) ||
        left.id.localeCompare(right.id)
    );
    const childrenByParent = new Map<string, typeof sortedLines>();
    const enabledComponentNos = new Set(
      sortedLines
        .filter((line) => this.normalizeModelBomLineType(line.lineType) === 'COMPONENT' && line.status === 'ENABLED')
        .map((line) => this.normalizeModelBomComponentNo(line.componentNo))
        .filter(Boolean) as string[]
    );
    const rootLines: typeof sortedLines = [];
    for (const line of sortedLines) {
      const parentComponentNo = this.normalizeModelBomComponentNo(line.parentComponentNo);
      if (this.normalizeModelBomLineType(line.lineType) === 'PART' && parentComponentNo) {
        childrenByParent.set(parentComponentNo, [...(childrenByParent.get(parentComponentNo) || []), line]);
      } else {
        rootLines.push(line);
      }
    }
    const ordered: typeof sortedLines = [];
    const attachedIds = new Set<string>();
    for (const line of rootLines) {
      ordered.push(line);
      const componentNo = this.normalizeModelBomComponentNo(line.componentNo);
      if (this.normalizeModelBomLineType(line.lineType) === 'COMPONENT' && componentNo && enabledComponentNos.has(componentNo)) {
        for (const child of childrenByParent.get(componentNo) || []) {
          ordered.push(child);
          attachedIds.add(child.id);
        }
      }
    }
    for (const line of sortedLines) {
      if (this.normalizeModelBomLineType(line.lineType) === 'PART' && line.parentComponentNo && !attachedIds.has(line.id)) {
        ordered.push(line);
      }
    }
    return new Map(ordered.map((line, index) => [line.id, index + 1]));
  }

  private async modelBomLineDisplayOrderForLine(bomId: string, lineId: string) {
    const lines = await this.prisma.modelBomLine.findMany({
      where: { bomId },
      select: {
        id: true,
        sortOrder: true,
        status: true,
        lineType: true,
        componentNo: true,
        parentComponentNo: true,
        material: { select: { status: true } }
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    });
    return this.modelBomLineDisplayOrderMap(lines).get(lineId);
  }

  private inventoryBatchMatchesKeyword(
    batch: {
      batchNo?: string | null;
      partCode?: string | null;
      partName?: string | null;
      sourceOrderNo?: string | null;
      sourceProductionTaskNo?: string | null;
      replenishmentSourceType?: string | null;
      replenishmentSourceRequestNo?: string | null;
      sourceCustomerName?: string | null;
      unit?: string | null;
      warehouse?: { warehouseName?: string | null } | null;
      sourceOrder?: { orderNo?: string | null; customerName?: string | null } | null;
      productionTask?: { orderNo?: string | null; customerName?: string | null } | null;
    },
    keyword?: string | null,
    extraSearchValues: Array<string | null | undefined> = []
  ) {
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    if (!normalizedKeyword) {
      return true;
    }
    // 库存搜索必须支持零件名称拼音 / 首字母，也要能按批号、订单号、任务号、客户和仓库命中。
    return pinyinSearchMatches([
      batch.batchNo,
      batch.partCode,
      batch.partName,
      batch.unit,
      batch.sourceOrderNo,
      batch.sourceProductionTaskNo,
      batch.replenishmentSourceType,
      batch.replenishmentSourceRequestNo,
      batch.sourceCustomerName,
      batch.sourceOrder?.orderNo,
      batch.sourceOrder?.customerName,
      batch.productionTask?.orderNo,
      batch.productionTask?.customerName,
      batch.warehouse?.warehouseName,
      ...extraSearchValues
    ], normalizedKeyword);
  }

  private inventoryTransactionMatchesKeyword(
    transaction: {
      partCode?: string | null;
      partName?: string | null;
      unit?: string | null;
      orderNo?: string | null;
      productionTaskNo?: string | null;
      batch?: {
        batchNo?: string | null;
        sourceOrderNo?: string | null;
        sourceProductionTaskNo?: string | null;
        sourceCustomerName?: string | null;
        sourceOrder?: { orderNo?: string | null; customerName?: string | null } | null;
        productionTask?: { orderNo?: string | null; customerName?: string | null } | null;
      } | null;
    },
    keyword?: string | null,
    extraSearchValues: Array<string | null | undefined> = []
  ) {
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    if (!normalizedKeyword) {
      return true;
    }
    return pinyinSearchMatches([
      transaction.partCode,
      transaction.partName,
      transaction.unit,
      transaction.orderNo,
      transaction.productionTaskNo,
      transaction.batch?.batchNo,
      transaction.batch?.sourceOrderNo,
      transaction.batch?.sourceProductionTaskNo,
      transaction.batch?.sourceCustomerName,
      transaction.batch?.sourceOrder?.orderNo,
      transaction.batch?.sourceOrder?.customerName,
      transaction.batch?.productionTask?.orderNo,
      transaction.batch?.productionTask?.customerName,
      ...extraSearchValues
    ], normalizedKeyword);
  }

  private async findZeroInventoryMaterialRows(query: InventoryQueryDto) {
    const keyword = query.keyword?.trim();
    const includeTestFixtures = query.includeTestFixtures === 'true';
    if (query.status && query.status !== 'AVAILABLE') {
      return [];
    }
    if (!keyword) {
      const stockAlertFilter = this.normalizeStockAlertFilter(query.stockAlert);
      if (stockAlertFilter !== 'ENABLED' && stockAlertFilter !== 'TRIGGERED') {
        return [];
      }
      // 库存报警筛选必须覆盖没有库存批次的零件；这里只生成 0 库存展示行，不创建库存批次、不追加库存流水。
      const materials = await this.prisma.material.findMany({
        where: {
          status: 'ENABLED',
          stockAlertEnabled: true
        },
        orderBy: [{ partCode: 'asc' }, { partName: 'asc' }]
      });
      return includeTestFixtures ? materials : materials.filter((material) => !this.isTestFixtureMaterial(material));
    }
    // 关键字查到零件但没有库存批次时，也要返回 0 库存行，方便仓库确认“数据库有此零件、当前仓库无库存”。
    const materials = await this.findMaterialsByKeyword(keyword);
    return includeTestFixtures ? materials : materials.filter((material) => !this.isTestFixtureMaterial(material));
  }

  private inventoryBatchSourceSearchValues(batch: { sourceProductionTaskNo?: string | null }, sourceTaskMap: Map<string, any>) {
    const sourceTask = this.resolveInventorySourceTask(batch, sourceTaskMap);
    const sourceOrder = sourceTask?.order;
    return [
      sourceTask?.productionTaskNo,
      sourceTask?.orderNo,
      sourceTask?.customerName,
      sourceOrder?.orderNo,
      sourceOrder?.customerName
    ];
  }

  private inventoryTransactionSourceSearchValues(
    transaction: { productionTaskNo?: string | null; batch?: { sourceProductionTaskNo?: string | null } | null },
    sourceTaskMap: Map<string, any>
  ) {
    const taskNos = [...new Set([transaction.productionTaskNo, transaction.batch?.sourceProductionTaskNo].filter(Boolean))] as string[];
    return taskNos.flatMap((taskNo) => {
      const sourceTask = sourceTaskMap.get(taskNo);
      const sourceOrder = sourceTask?.order;
      return [
        sourceTask?.productionTaskNo,
        sourceTask?.orderNo,
        sourceTask?.customerName,
        sourceOrder?.orderNo,
        sourceOrder?.customerName
      ];
    });
  }

  private materialSummaryKey(material: { partCode: string; unit: string }) {
    return `${material.partCode.trim().toLocaleLowerCase()}__${material.unit.trim().toLocaleLowerCase()}`;
  }

  private createSummaryAccumulator(material: { partCode: string; partName: string; unit: string }): InventorySummaryAccumulator {
    return {
      partCode: material.partCode,
      partName: material.partName,
      unit: material.unit,
      batchCount: 0,
      warehouseIds: new Set<string>(),
      physicalQuantity: 0,
      reservedQuantity: 0,
      availableQuantity: 0,
      usedQuantity: 0,
      totalQuantity: 0,
      orderInventoryQuantity: 0,
      stockInventoryQuantity: 0,
      normalOrderStockQuantity: 0,
      cancelledOrderStockQuantity: 0,
      customerChangeStockQuantity: 0,
      warehouses: new Map()
    };
  }

  private async findMaterialStockAlertMap(partCodes: string[]) {
    const normalizedPartCodes = [...new Set(partCodes.map((partCode) => partCode.trim()).filter(Boolean))];
    if (!normalizedPartCodes.length) {
      return new Map<string, { materialId: string; stockAlertEnabled: boolean; stockAlertQuantity: number | null }>();
    }
    const materials = await this.prisma.material.findMany({
      where: {
        OR: normalizedPartCodes.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' as const } }))
      },
      select: {
        id: true,
        partCode: true,
        stockAlertEnabled: true,
        stockAlertQuantity: true
      }
    });
    return new Map(
      materials.map((material) => [
        material.partCode.trim().toLocaleLowerCase(),
        {
          materialId: material.id,
          stockAlertEnabled: material.stockAlertEnabled,
          stockAlertQuantity:
            material.stockAlertQuantity === null || material.stockAlertQuantity === undefined ? null : decimalToNumber(material.stockAlertQuantity)
        }
      ])
    );
  }

  private activeReservationWhere(excludeOrderNo?: string, excludeOrderId?: string): Prisma.InventoryReservationWhereInput {
    const normalizedExcludeOrderId = excludeOrderId?.trim();
    const normalizedExcludeOrderNo = excludeOrderNo?.trim();
    return {
      status: InventoryReservationStatus.ACTIVE,
      ...(normalizedExcludeOrderId
        ? { orderId: { not: normalizedExcludeOrderId } }
        : normalizedExcludeOrderNo
          ? { orderNo: { not: normalizedExcludeOrderNo } }
          : {})
    };
  }

  private activeReservationWhereForPriority(currentOrder?: StockReservationPriorityOrder | null): Prisma.InventoryReservationWhereInput {
    return {
      status: InventoryReservationStatus.ACTIVE,
      ...(currentOrder ? { orderId: { not: currentOrder.id } } : {})
    };
  }

  private async resolveStockReservationPriorityOrder(query: { excludeOrderNo?: string; excludeOrderId?: string }) {
    const excludeOrderId = query.excludeOrderId?.trim();
    if (excludeOrderId) {
      const currentOrder = await this.prisma.customerOrder.findUnique({
        where: { id: excludeOrderId },
        select: { id: true, orderNo: true, status: true, createdAt: true }
      });
      if (currentOrder) {
        return currentOrder;
      }
    }

    const excludeOrderNo = query.excludeOrderNo?.trim();
    if (!excludeOrderNo) {
      return null;
    }
    return this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: excludeOrderNo, mode: 'insensitive' } },
      select: { id: true, orderNo: true, status: true, createdAt: true }
    });
  }

  private stockReservationConsumesAvailability(
    reservationOrder: StockReservationPriorityOrder | null | undefined,
    currentOrder?: StockReservationPriorityOrder | null
  ) {
    if (!currentOrder || !reservationOrder) {
      return true;
    }
    if (reservationOrder.id === currentOrder.id) {
      return false;
    }
    if (reservationOrder.status !== OrderStatus.DRAFT || currentOrder.status !== OrderStatus.DRAFT) {
      return true;
    }
    const createdAtDiff = reservationOrder.createdAt.getTime() - currentOrder.createdAt.getTime();
    if (createdAtDiff !== 0) {
      return createdAtDiff < 0;
    }
    return reservationOrder.orderNo.localeCompare(currentOrder.orderNo) < 0;
  }

  private async getWarehouseSnapshot(warehouseId: string) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, warehouseName: true }
    });
    return warehouse ? { warehouseId: warehouse.id, warehouseName: warehouse.warehouseName } : null;
  }

  async summary(query: InventoryQueryDto) {
    const includeTestFixtures = query.includeTestFixtures === 'true';
    const currentOrder = await this.resolveStockReservationPriorityOrder(query);
    const reservationWhere = currentOrder
      ? this.activeReservationWhereForPriority(currentOrder)
      : this.activeReservationWhere(query.excludeOrderNo, query.excludeOrderId);
    const batches = await this.prisma.inventoryBatch.findMany({
      where: await this.buildInventoryWhere(query),
      select: {
        batchNo: true,
        partCode: true,
        partName: true,
        quantity: true,
        unit: true,
        status: true,
        sourceOrderNo: true,
        sourceOrderId: true,
        sourceProductionTaskNo: true,
        sourceKind: true,
        replenishmentSourceType: true,
        replenishmentSourceRequestNo: true,
        sourceCustomerName: true,
        warehouseId: true,
        warehouse: { select: { warehouseName: true } },
        sourceOrder: { select: { orderNo: true, customerName: true } },
        productionTask: { select: { orderNo: true, customerName: true } },
        reservations: {
          where: reservationWhere,
          select: {
            quantity: true,
            order: { select: { id: true, orderNo: true, status: true, createdAt: true } }
          }
        }
      },
      orderBy: [{ partCode: 'asc' }, { partName: 'asc' }]
    });
    const visibleBatches = includeTestFixtures ? batches : batches.filter((batch) => !this.isTestFixtureInventoryBatch(batch));
    const sourceTaskMap = await this.findSourceTaskMap(visibleBatches.map((batch) => batch.sourceProductionTaskNo));

    const summaryMap = new Map<string, InventorySummaryAccumulator>();

    for (const batch of visibleBatches.filter((item) => this.inventoryBatchMatchesKeyword(item, query.keyword, this.inventoryBatchSourceSearchValues(item, sourceTaskMap)))) {
      const key = this.materialSummaryKey(batch);
      const row = summaryMap.get(key) ?? this.createSummaryAccumulator(batch);

      const quantity = decimalToNumber(batch.quantity);
      const isPhysical = this.isPhysicalInventoryBatchStatus(batch.status) && quantity > 0;
      const isAvailable = batch.status === 'AVAILABLE' && quantity > 0;
      const activeReservationQuantity = isAvailable && !batch.sourceOrderId
        ? batch.reservations
            .filter((reservation) => this.stockReservationConsumesAvailability(reservation.order, currentOrder))
            .reduce((sum, reservation) => sum + decimalToNumber(reservation.quantity), 0)
        : 0;
      const reservedQuantity = this.inventoryBatchReservedQuantity(batch.status, quantity, activeReservationQuantity);
      const availableQuantity = isAvailable ? Math.max(Math.round((quantity - reservedQuantity + Number.EPSILON) * 1000) / 1000, 0) : 0;
      row.batchCount += 1;
      row.totalQuantity += quantity;

      if (isPhysical) {
        row.physicalQuantity += quantity;
        row.reservedQuantity += reservedQuantity;
        row.availableQuantity += availableQuantity;
        row.warehouseIds.add(batch.warehouseId);

        if (isAvailable) {
          if (batch.sourceOrderId) {
            row.orderInventoryQuantity += availableQuantity;
          } else {
            row.stockInventoryQuantity += availableQuantity;
            if (batch.sourceKind === 'CANCELLED_ORDER') {
              row.cancelledOrderStockQuantity += availableQuantity;
            } else if (batch.sourceKind === 'CUSTOMER_CHANGE') {
              row.customerChangeStockQuantity += availableQuantity;
            } else {
              row.normalOrderStockQuantity += availableQuantity;
            }
          }
        }
      } else {
        row.usedQuantity += quantity;
      }

      const warehouseRow =
        row.warehouses.get(batch.warehouseId) ??
        {
          warehouseId: batch.warehouseId,
          warehouseName: batch.warehouse.warehouseName,
          reservedQuantity: 0,
          availableQuantity: 0,
          batchCount: 0
      };
      warehouseRow.batchCount += 1;
      if (isPhysical) {
        warehouseRow.reservedQuantity += reservedQuantity;
        if (isAvailable) {
          warehouseRow.availableQuantity += availableQuantity;
        }
      }
      row.warehouses.set(batch.warehouseId, warehouseRow);
      summaryMap.set(key, row);
    }

    const outTransactionWhere = await this.buildInventoryOutTransactionWhere(query);
    if (outTransactionWhere) {
      const outTransactions = await this.prisma.inventoryTransaction.findMany({
        where: outTransactionWhere,
        select: {
          partCode: true,
          partName: true,
          unit: true,
          quantity: true,
          orderNo: true,
          productionTaskNo: true,
          batch: {
            select: {
              batchNo: true,
              sourceOrderNo: true,
              sourceProductionTaskNo: true,
              sourceCustomerName: true,
              sourceOrder: { select: { orderNo: true, customerName: true } },
              productionTask: { select: { orderNo: true, customerName: true } }
            }
          }
        }
      });
      const outQuantityMap = new Map<string, { quantity: number; partCode: string; partName: string; unit: string }>();
      const outSourceTaskMap = await this.findSourceTaskMap(
        outTransactions.flatMap((transaction) => [transaction.productionTaskNo, transaction.batch?.sourceProductionTaskNo])
      );
      for (const transaction of outTransactions.filter((item) =>
        this.inventoryTransactionMatchesKeyword(item, query.keyword, this.inventoryTransactionSourceSearchValues(item, outSourceTaskMap))
      )) {
        const key = this.materialSummaryKey(transaction);
        const row = outQuantityMap.get(key) ?? {
          quantity: 0,
          partCode: transaction.partCode,
          partName: transaction.partName,
          unit: transaction.unit
        };
        row.quantity += decimalToNumber(transaction.quantity);
        outQuantityMap.set(key, row);
      }

      for (const [key, outRow] of outQuantityMap.entries()) {
        const row = summaryMap.get(key) ?? this.createSummaryAccumulator(outRow);
        // 已出库 / 已使用数量以 OUT 流水为准；兼容旧数据时取更大值，避免重复统计或漏统计。
        row.usedQuantity = Math.max(row.usedQuantity, outRow.quantity);
        row.totalQuantity = Math.max(row.totalQuantity, row.availableQuantity + row.usedQuantity);
        summaryMap.set(key, row);
      }
    }

    const zeroMaterialRows = await this.findZeroInventoryMaterialRows(query);
    const selectedWarehouse = query.warehouseId ? await this.getWarehouseSnapshot(query.warehouseId) : null;
    for (const material of zeroMaterialRows) {
      const key = this.materialSummaryKey(material);
      if (summaryMap.has(key)) {
        continue;
      }
      const row = this.createSummaryAccumulator(material);
      if (selectedWarehouse) {
        // 查询指定仓库但该零件无库存时，只展示“该仓库 0 件”，不能把它计入有库存仓库数。
        row.warehouses.set(selectedWarehouse.warehouseId, {
          warehouseId: selectedWarehouse.warehouseId,
          warehouseName: selectedWarehouse.warehouseName,
          reservedQuantity: 0,
          availableQuantity: 0,
          batchCount: 0
        });
      }
      summaryMap.set(key, row);
    }

    const summaryRows = [...summaryMap.values()];
    const stockAlertByPartCode = await this.findMaterialStockAlertMap(summaryRows.map((row) => row.partCode));

    const rows = summaryRows.map((row) => {
      const stockAlert = stockAlertByPartCode.get(row.partCode.trim().toLocaleLowerCase());
      const stockAlertEnabled = Boolean(stockAlert?.stockAlertEnabled);
      const stockAlertQuantity = stockAlert?.stockAlertQuantity ?? null;
      return {
        // 按零件库存汇总只从 InventoryBatch 实时计算，不保存第二份汇总数量，避免库存账面不一致。
        materialId: stockAlert?.materialId,
        partCode: row.partCode,
        partName: row.partName,
        unit: row.unit,
        batchCount: row.batchCount,
        warehouseCount: row.warehouseIds.size,
        physicalQuantity: row.physicalQuantity,
        reservedQuantity: row.reservedQuantity,
        availableQuantity: row.availableQuantity,
        usedQuantity: row.usedQuantity,
        totalQuantity: row.totalQuantity,
        orderInventoryQuantity: row.orderInventoryQuantity,
        stockInventoryQuantity: row.stockInventoryQuantity,
        normalOrderStockQuantity: row.normalOrderStockQuantity,
        cancelledOrderStockQuantity: row.cancelledOrderStockQuantity,
        customerChangeStockQuantity: row.customerChangeStockQuantity,
        stockAlertEnabled,
        stockAlertQuantity,
        stockAlertTriggered: stockAlertEnabled && stockAlertQuantity !== null && row.availableQuantity <= stockAlertQuantity,
        warehouses: [...row.warehouses.values()].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, 'zh-Hans-CN'))
      };
    })
      .filter((row) => this.materialMatchesStockAlertFilter(row, query.stockAlert))
      .sort((a, b) => a.partCode.localeCompare(b.partCode, 'zh-Hans-CN'));
    if (query.withPage !== 'true') {
      return rows;
    }
    const limit = Math.min(Math.max(query.limit || 50, 1), 200);
    const offset = Math.max(query.offset || 0, 0);
    const items = rows.slice(offset, offset + limit);
    // 库存汇总分页只影响返回展示，不改变实时汇总计算、库存报警筛选或 Excel 导出范围。
    return {
      items,
      totalCount: rows.length,
      limit,
      offset,
      hasMore: offset + items.length < rows.length
    };
  }

  async materialSuggestions(query: MaterialSuggestionQueryDto) {
    const keyword = query.keyword?.trim();
    const customerId = query.customerId?.trim();
    const projectModel = query.projectModel?.trim();
    if (!keyword && !customerId && !projectModel) {
      return [];
    }
    const sourceType = query.sourceType || 'ALL';
    const materialRows = new Map<string, MaterialSuggestionBase>();
    const disabledMaterialCodes = new Set(
      (
        await this.prisma.material.findMany({
          where: { status: 'DISABLED' },
          select: { partCode: true }
        })
      ).map((material) => material.partCode.trim().toLocaleLowerCase())
    );
    const matchHints = new Map<
      string,
      {
        matchedBatchNo?: string;
        matchedSourceOrderNo?: string;
        matchedProductionTaskNo?: string;
      }
    >();
    const historyByCode = await this.findMaterialSuggestionHistory(query, keyword);

    for (const [key, history] of historyByCode) {
      if (disabledMaterialCodes.has(key)) {
        continue;
      }
      materialRows.set(key, {
        partCode: history.partCode,
        partName: history.partName,
        unit: history.unit,
        partSpecification: history.partSpecification,
        drawingNo: history.drawingNo,
        drawingVersion: history.drawingVersion,
        drawingDate: history.drawingDate,
        drawingStatus: history.drawingStatus,
        partThickness: history.partThickness,
        projectModel: history.projectModel
      });
    }

    const shouldSeedMaterialMaster = Boolean(keyword);
    if (shouldSeedMaterialMaster) {
      const materials = await this.findMaterialsByKeyword(keyword);
      materials.forEach((material) => {
        materialRows.set(material.partCode.toLocaleLowerCase(), material);
      });
    }

    if (keyword) {
      const [allMaterials, candidateBatches] = await Promise.all([
        this.findMaterialsByKeyword(''),
        this.prisma.inventoryBatch.findMany({
          where: {
            status: 'AVAILABLE',
            quantity: { gt: 0 },
            warehouseId: query.warehouseId || undefined,
            ...(sourceType === 'STOCK' ? { sourceOrderId: null } : {}),
            ...(sourceType === 'ORDER' ? { sourceOrderId: { not: null } } : {})
          },
          select: {
            batchNo: true,
            partCode: true,
            partName: true,
            unit: true,
            sourceOrderNo: true,
            sourceProductionTaskNo: true,
            replenishmentSourceType: true,
            replenishmentSourceRequestNo: true,
            sourceCustomerName: true,
            warehouse: { select: { warehouseName: true } },
            sourceOrder: { select: { orderNo: true, customerName: true } },
            productionTask: { select: { orderNo: true, customerName: true } }
          },
          orderBy: [{ partCode: 'asc' }, { batchNo: 'asc' }]
        })
      ]);
      const materialByCode = new Map(allMaterials.map((material) => [material.partCode.toLocaleLowerCase(), material]));
      const sourceTaskMap = await this.findSourceTaskMap(candidateBatches.map((batch) => batch.sourceProductionTaskNo));
      for (const batch of candidateBatches.filter((item) => this.inventoryBatchMatchesKeyword(item, keyword, this.inventoryBatchSourceSearchValues(item, sourceTaskMap)))) {
        const key = batch.partCode.toLocaleLowerCase();
        if (disabledMaterialCodes.has(key)) {
          continue;
        }
        materialRows.set(
          key,
          materialRows.get(key) ||
            materialByCode.get(key) || {
              partCode: batch.partCode,
              partName: batch.partName,
              unit: batch.unit,
              partSpecification: null
            }
        );
        if (!matchHints.has(key)) {
          matchHints.set(key, {
            matchedBatchNo: batch.batchNo,
            matchedSourceOrderNo: batch.sourceOrderNo || undefined,
            matchedProductionTaskNo: batch.sourceProductionTaskNo || undefined
          });
        }
      }
    }

    const suggestionMaterials = [...materialRows.values()].filter((material) => !disabledMaterialCodes.has(material.partCode.trim().toLocaleLowerCase()));
    if (suggestionMaterials.length === 0) {
      return [];
    }

    const partCodes = suggestionMaterials.map((material) => material.partCode);
    const materialMasterByCode = await this.findEnabledMaterialMastersByCodes(partCodes);
    const materialCodeSet = new Set(partCodes.map((partCode) => partCode.toLocaleLowerCase()));
    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        status: 'AVAILABLE',
        quantity: { gt: 0 },
        ...(sourceType === 'STOCK' ? { sourceOrderId: null } : {}),
        ...(sourceType === 'ORDER' ? { sourceOrderId: { not: null } } : {}),
        // 零件下拉允许空关键字查看完整零件清单；批次数量在内存中按 Material 搜索记忆再次过滤，避免数据库结果被条数限制误导。
        ...(partCodes.length <= 500
          ? { OR: partCodes.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' } })) }
          : {}),
        warehouseId: query.warehouseId || undefined
      },
      select: {
        id: true,
        partCode: true,
        quantity: true,
        sourceOrderId: true
      }
    });
    const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(
      batches.filter((batch) => !batch.sourceOrderId).map((batch) => batch.id),
      query
    );

    const quantityMap = new Map<
      string,
      {
        availableQuantity: number;
        orderInventoryQuantity: number;
        stockInventoryQuantity: number;
      }
    >();
    for (const batch of batches) {
      const key = batch.partCode.toLocaleLowerCase();
      if (!materialCodeSet.has(key)) {
        continue;
      }
      const row = quantityMap.get(key) ?? {
        availableQuantity: 0,
        orderInventoryQuantity: 0,
        stockInventoryQuantity: 0
      };
      const reservedQuantity = batch.sourceOrderId ? 0 : (reservedQuantityByBatchId.get(batch.id) ?? 0);
      const quantity = Math.max(decimalToNumber(batch.quantity) - reservedQuantity, 0);
      row.availableQuantity += quantity;
      if (batch.sourceOrderId) {
        row.orderInventoryQuantity += quantity;
      } else {
        row.stockInventoryQuantity += quantity;
      }
      quantityMap.set(key, row);
    }

    return suggestionMaterials.map((material) => {
      const materialKey = material.partCode.toLocaleLowerCase();
      const quantity = quantityMap.get(materialKey) ?? {
        availableQuantity: 0,
        orderInventoryQuantity: 0,
        stockInventoryQuantity: 0
      };
      const materialMaster = materialMasterByCode.get(materialKey);
      const matchHint = matchHints.get(materialKey) || {};
      const history = historyByCode.get(materialKey);
      const historyCustomerNames = history ? [...history.historyCustomerNames] : [];
      const searchMatch = this.materialSuggestionSearchMatch(material, keyword, history, matchHint);
      const useQueryCustomerSnapshot = Boolean(customerId && history?.hasQueryCustomerHistory);
      const partName = useQueryCustomerSnapshot ? history?.partName || material.partName : material.partName;
      const unit = useQueryCustomerSnapshot ? history?.unit || material.unit : material.unit;
      const partSpecification = useQueryCustomerSnapshot
        ? history?.partSpecification || material.partSpecification
        : material.partSpecification;
      const defaultProcessRoute = material.defaultProcessRoute || materialMaster?.defaultProcessRoute || null;
      const drawingNo = useQueryCustomerSnapshot
        ? history?.drawingNo || material.drawingNo || materialMaster?.drawingNo
        : material.drawingNo || materialMaster?.drawingNo || history?.drawingNo;
      const drawingVersion = useQueryCustomerSnapshot
        ? history?.drawingVersion || material.drawingVersion || materialMaster?.drawingVersion
        : material.drawingVersion || materialMaster?.drawingVersion || history?.drawingVersion;
      const drawingDate = useQueryCustomerSnapshot
        ? history?.drawingDate || material.drawingDate || materialMaster?.drawingDate
        : material.drawingDate || materialMaster?.drawingDate || history?.drawingDate;
      const drawingStatus = useQueryCustomerSnapshot
        ? history?.drawingStatus || material.drawingStatus || materialMaster?.drawingStatus
        : material.drawingStatus || materialMaster?.drawingStatus || history?.drawingStatus;
      const drawingFileName = useQueryCustomerSnapshot
        ? history?.drawingFileName || material.drawingFileName || materialMaster?.drawingFileName
        : material.drawingFileName || materialMaster?.drawingFileName || history?.drawingFileName;
      const drawingFileUrl = useQueryCustomerSnapshot
        ? history?.drawingFileUrl || material.drawingFileUrl || materialMaster?.drawingFileUrl
        : material.drawingFileUrl || materialMaster?.drawingFileUrl || history?.drawingFileUrl;
      const partThickness = useQueryCustomerSnapshot
        ? history?.partThickness ?? material.partThickness
        : material.partThickness ?? history?.partThickness;
      const projectModel = useQueryCustomerSnapshot
        ? history?.projectModel || material.projectModel
        : material.projectModel || history?.projectModel;
      return {
        value: `${material.partCode} ${partName}`,
        materialId: material.materialId || materialMasterByCode.get(materialKey)?.id,
        partCode: material.partCode,
        partName,
        unit,
        partSpecification,
        defaultProcessRoute,
        drawingNo,
        drawingVersion,
        drawingDate: this.formatDateOnly(drawingDate),
        drawingStatus,
        drawingFileName,
        drawingFileUrl,
        partThickness,
        projectModel,
        customerUsageCount: history?.customerUsageCount ?? 0,
        historyUsageCount: history?.usageCount ?? 0,
        hasCurrentCustomerHistory: Boolean(history?.hasQueryCustomerHistory),
        identityVariantCount: history?.identityVariantCount ?? 0,
        hasIdentityConflict: Boolean((history?.identityVariantCount ?? 0) > 1),
        identityConflictFields: this.materialSuggestionIdentityConflictFields(history),
        lastCustomerCode: history?.lastCustomerCode,
        lastCustomerName: history?.lastCustomerName,
        lastCustomerOrderNo: history?.lastCustomerOrderNo,
        lastCustomerOrderDate: this.formatDateOnly(history?.lastCustomerOrderDate),
        matchedCustomerCode: history?.matchedCustomerCode,
        matchedCustomerName: history?.matchedCustomerName,
        matchedHistoryOrderNo: history?.matchedHistoryOrderNo,
        historyCustomerNames: historyCustomerNames.slice(0, MATERIAL_SUGGESTION_HISTORY_CUSTOMER_PREVIEW_LIMIT),
        historyCustomerCount: historyCustomerNames.length,
        ...searchMatch,
        ...matchHint,
        ...quantity
      };
    }).filter((item) => sourceType === 'ALL' || item.availableQuantity > 0)
      .sort((a, b) => this.compareMaterialSuggestions(a, b, Boolean(customerId), normalizeSearchKeyword(projectModel)));
  }

  private async findMaterialSuggestionHistory(query: MaterialSuggestionQueryDto, keyword?: string) {
    const customerId = query.customerId?.trim();
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    const requestedProjectModel = query.projectModel?.trim();
    const projectModel = normalizeSearchKeyword(requestedProjectModel);
    const historyByCode = new Map<string, MaterialSuggestionHistory>();
    if (!customerId && !normalizedKeyword && !projectModel) {
      return historyByCode;
    }

    const lines = await this.prisma.orderLine.findMany({
      where: !normalizedKeyword
        ? {
            ...(customerId ? { order: { customerId } } : {}),
            ...(requestedProjectModel ? { projectModel: { contains: requestedProjectModel, mode: 'insensitive' } } : {})
          }
        : {},
      select: {
        partCode: true,
        partName: true,
        unit: true,
        partSpecification: true,
        drawingNo: true,
        drawingVersion: true,
        drawingDate: true,
        drawingStatus: true,
        drawingFileName: true,
        drawingFileUrl: true,
        partThickness: true,
        projectModel: true,
        createdAt: true,
        order: {
          select: {
            customerId: true,
            customerCode: true,
            customerName: true,
            orderNo: true,
            orderDate: true
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }]
    });

    for (const line of lines) {
      if (normalizedKeyword && !this.materialHistoryLineMatchesKeyword(line, normalizedKeyword)) {
        continue;
      }
      if (projectModel && !pinyinSearchMatches([line.projectModel], projectModel)) {
        continue;
      }

      const partCode = line.partCode.trim();
      if (!partCode) {
        continue;
      }

      const key = partCode.toLocaleLowerCase();
      const existing = historyByCode.get(key) ?? {
        partCode,
        partName: line.partName,
        unit: line.unit,
        partSpecification: line.partSpecification,
        drawingNo: line.drawingNo,
        drawingVersion: line.drawingVersion,
        drawingDate: line.drawingDate,
        drawingStatus: line.drawingStatus,
        drawingFileName: line.drawingFileName,
        drawingFileUrl: line.drawingFileUrl,
        partThickness: line.partThickness === null || line.partThickness === undefined ? null : decimalToNumber(line.partThickness),
        projectModel: line.projectModel,
        usageCount: 0,
        customerUsageCount: 0,
        identityKeys: new Set<string>(),
        identityFieldValues: new Map<string, Set<string>>(),
        historyCustomerNames: new Set<string>()
      };

      const lineBelongsToQueryCustomer = Boolean(customerId && line.order.customerId === customerId);
      existing.usageCount += 1;
      existing.identityVariantCount = this.recordMaterialSuggestionIdentity(existing, line);
      if (lineBelongsToQueryCustomer) {
        if (
          !existing.hasQueryCustomerHistory ||
          this.isMaterialSuggestionHistorySnapshotNewer(
            line,
            existing.queryCustomerSnapshotOrderDate,
            existing.queryCustomerSnapshotCreatedAt
          )
        ) {
          this.applyMaterialSuggestionHistorySnapshot(existing, line);
          existing.queryCustomerSnapshotOrderDate = line.order.orderDate;
          existing.queryCustomerSnapshotCreatedAt = line.createdAt;
        }
        existing.customerUsageCount += 1;
        existing.hasQueryCustomerHistory = true;
      }
      if (line.order.customerName) {
        existing.historyCustomerNames.add(line.order.customerName);
      }
      const lineCanUpdateLastCustomerOrder =
        !customerId || lineBelongsToQueryCustomer || !existing.hasQueryCustomerHistory;
      if (
        lineCanUpdateLastCustomerOrder &&
        (!existing.lastCustomerOrderDate ||
          (lineBelongsToQueryCustomer && !existing.lastCustomerOrderBelongsToQueryCustomer) ||
          (line.order.orderDate && line.order.orderDate.getTime() > existing.lastCustomerOrderDate.getTime()))
      ) {
        existing.lastCustomerCode = line.order.customerCode;
        existing.lastCustomerName = line.order.customerName;
        existing.lastCustomerOrderNo = line.order.orderNo;
        existing.lastCustomerOrderDate = line.order.orderDate;
        existing.lastCustomerOrderBelongsToQueryCustomer = lineBelongsToQueryCustomer;
      }
      if (
        !existing.matchedCustomerName &&
        normalizedKeyword &&
        pinyinSearchMatches([line.order.customerCode, line.order.customerName], normalizedKeyword)
      ) {
        existing.matchedCustomerCode = line.order.customerCode;
        existing.matchedCustomerName = line.order.customerName;
      }
      if (
        !existing.matchedHistoryOrderNo &&
        normalizedKeyword &&
        pinyinSearchMatches([line.order.orderNo], normalizedKeyword)
      ) {
        existing.matchedHistoryOrderNo = line.order.orderNo;
      }

      historyByCode.set(key, existing);
    }

    return historyByCode;
  }

  private recordMaterialSuggestionIdentity(
    existing: MaterialSuggestionHistory,
    value: {
      partName?: string | null;
      partSpecification?: string | null;
      drawingNo?: string | null;
      drawingVersion?: string | null;
      drawingDate?: Date | null;
      drawingStatus?: string | null;
      drawingFileName?: string | null;
      drawingFileUrl?: string | null;
      partThickness?: Prisma.Decimal | number | string | null;
      projectModel?: string | null;
    }
  ) {
    const identityValues = this.materialSuggestionIdentityValues(value);
    const identityKey = identityValues.map((item) => `${item.field}:${item.value}`).join('|');
    if (identityKey) {
      existing.identityKeys.add(identityKey);
    }
    for (const item of identityValues) {
      const values = existing.identityFieldValues.get(item.field) || new Set<string>();
      values.add(item.value);
      existing.identityFieldValues.set(item.field, values);
    }
    let maxDistinctValues = 0;
    for (const values of existing.identityFieldValues.values()) {
      maxDistinctValues = Math.max(maxDistinctValues, values.size);
    }
    return Math.max(maxDistinctValues, maxDistinctValues > 1 ? existing.identityKeys.size : 1);
  }

  private materialSuggestionIdentityConflictFields(history?: MaterialSuggestionHistory) {
    if (!history) {
      return [];
    }
    const fields: string[] = [];
    for (const [field, values] of history.identityFieldValues) {
      if (values.size > 1) {
        fields.push(materialSuggestionIdentityFieldLabels[field] || field);
      }
    }
    return fields;
  }

  private materialSuggestionIdentityValues(value: {
    partName?: string | null;
    partSpecification?: string | null;
    drawingNo?: string | null;
    drawingVersion?: string | null;
    drawingDate?: Date | null;
    drawingStatus?: string | null;
    partThickness?: Prisma.Decimal | number | string | null;
    projectModel?: string | null;
  }): Array<{ field: string; value: string }> {
    return [
      { field: 'partName', value: normalizeSearchKeyword(value.partName) },
      { field: 'partSpecification', value: normalizeSearchKeyword(value.partSpecification) },
      { field: 'drawingNo', value: normalizeSearchKeyword(value.drawingNo) },
      { field: 'drawingVersion', value: normalizeSearchKeyword(value.drawingVersion) },
      { field: 'drawingDate', value: value.drawingDate ? this.formatDateOnly(value.drawingDate) || '' : '' },
      { field: 'drawingStatus', value: normalizeSearchKeyword(value.drawingStatus) },
      { field: 'partThickness', value: value.partThickness ? String(decimalToNumber(value.partThickness)) : '' },
      { field: 'projectModel', value: normalizeSearchKeyword(value.projectModel) }
    ].filter((item) => item.value);
  }

  private applyMaterialSuggestionHistorySnapshot(
    existing: MaterialSuggestionHistory,
    line: {
      partName: string;
      unit: string;
      partSpecification?: string | null;
      drawingNo?: string | null;
      drawingVersion?: string | null;
      drawingDate?: Date | null;
      drawingStatus?: string | null;
      drawingFileName?: string | null;
      drawingFileUrl?: string | null;
      partThickness?: Prisma.Decimal | number | string | null;
      projectModel?: string | null;
    }
  ) {
    existing.partName = line.partName;
    existing.unit = line.unit;
    existing.partSpecification = line.partSpecification;
    existing.drawingNo = line.drawingNo;
    existing.drawingVersion = line.drawingVersion;
    existing.drawingDate = line.drawingDate;
    existing.drawingStatus = line.drawingStatus;
    existing.drawingFileName = line.drawingFileName;
    existing.drawingFileUrl = line.drawingFileUrl;
    existing.partThickness = line.partThickness === null || line.partThickness === undefined ? null : decimalToNumber(line.partThickness);
    existing.projectModel = line.projectModel;
  }

  private isMaterialSuggestionHistorySnapshotNewer(
    line: { createdAt: Date; order: { orderDate?: Date | null } },
    existingOrderDate?: Date | null,
    existingCreatedAt?: Date | null
  ) {
    const lineOrderTime = line.order.orderDate?.getTime() ?? 0;
    const existingOrderTime = existingOrderDate?.getTime() ?? 0;
    if (lineOrderTime !== existingOrderTime) {
      return lineOrderTime > existingOrderTime;
    }
    return line.createdAt.getTime() > (existingCreatedAt?.getTime() ?? 0);
  }

  private materialHistoryLineMatchesKeyword(
    line: {
      partCode?: string | null;
      partName?: string | null;
      unit?: string | null;
      partSpecification?: string | null;
      drawingNo?: string | null;
      drawingVersion?: string | null;
      drawingDate?: Date | null;
      drawingStatus?: string | null;
      drawingFileName?: string | null;
      partThickness?: Prisma.Decimal | number | string | null;
      projectModel?: string | null;
      order: { customerCode?: string | null; customerName?: string | null; orderNo?: string | null };
    },
    keyword: string
  ) {
    return pinyinSearchMatches(
      [
        line.partCode,
        line.partName,
        line.unit,
        line.partSpecification,
        line.drawingNo,
        line.drawingVersion,
        ...this.materialDateSearchValues(line.drawingDate),
        line.drawingStatus,
        line.drawingFileName,
        ...this.materialThicknessSearchValues(line.partThickness),
        line.projectModel,
        line.order.customerCode,
        line.order.customerName,
        line.order.orderNo
      ],
      keyword
    );
  }

  private materialSuggestionSearchMatch(
    material: MaterialSuggestionBase,
    keyword?: string,
    history?: MaterialSuggestionHistory,
    matchHint?: {
      matchedBatchNo?: string;
      matchedSourceOrderNo?: string;
      matchedProductionTaskNo?: string;
    }
  ) {
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    if (!normalizedKeyword) {
      return { searchMatchRank: 0 };
    }

    const partCode = normalizeSearchKeyword(material.partCode);
    const partName = normalizeSearchKeyword(material.partName);
    if (partCode === normalizedKeyword) {
      return { searchMatchRank: 1000, searchMatchText: '编码精确匹配' };
    }
    if (partName === normalizedKeyword) {
      return { searchMatchRank: 960, searchMatchText: '名称精确匹配' };
    }
    if (partCode.startsWith(normalizedKeyword)) {
      return { searchMatchRank: 920, searchMatchText: '编码前缀匹配' };
    }
    if (partCode.includes(normalizedKeyword)) {
      return { searchMatchRank: 880, searchMatchText: '编码包含匹配' };
    }
    if (pinyinSearchMatches([material.partCode], normalizedKeyword)) {
      return { searchMatchRank: 840, searchMatchText: '编码缩写匹配' };
    }
    if (partName.startsWith(normalizedKeyword)) {
      return { searchMatchRank: 830, searchMatchText: '名称前缀匹配' };
    }
    if (partName.includes(normalizedKeyword)) {
      return { searchMatchRank: 820, searchMatchText: '名称包含匹配' };
    }
    if (pinyinSearchMatches([material.partName], normalizedKeyword)) {
      return { searchMatchRank: 800, searchMatchText: '名称拼音匹配' };
    }
    if (
      pinyinSearchMatches(
        [
          material.partSpecification,
          material.drawingNo,
          material.drawingVersion,
          ...this.materialDateSearchValues(material.drawingDate),
          material.drawingStatus,
          material.drawingFileName,
          ...this.materialThicknessSearchValues(material.partThickness),
          material.projectModel
        ],
        normalizedKeyword
      )
    ) {
      return { searchMatchRank: 760, searchMatchText: '图纸资料匹配' };
    }
    if (history?.matchedCustomerName) {
      return { searchMatchRank: 720, searchMatchText: '客户历史匹配' };
    }
    if (history?.matchedHistoryOrderNo) {
      return { searchMatchRank: 710, searchMatchText: '历史订单匹配' };
    }
    if (matchHint?.matchedBatchNo || matchHint?.matchedSourceOrderNo || matchHint?.matchedProductionTaskNo) {
      return { searchMatchRank: 680, searchMatchText: '库存来源匹配' };
    }
    if (history?.usageCount) {
      return { searchMatchRank: 640, searchMatchText: '历史订单匹配' };
    }
    return { searchMatchRank: 0 };
  }

  private materialThicknessSearchValues(value?: Prisma.Decimal | number | string | null) {
    if (value === null || value === undefined || value === '') {
      return [];
    }
    const numericValue = decimalToNumber(value);
    if (!Number.isFinite(numericValue)) {
      return [];
    }
    const normalizedValue = Number(numericValue.toFixed(4));
    const values = new Set<string>();
    const addThicknessValue = (text: string) => {
      values.add(text);
      values.add(`${text}mm`);
    };
    addThicknessValue(normalizedValue.toString());
    for (const precision of [0, 1, 2, 3, 4]) {
      const formatted = normalizedValue.toFixed(precision);
      if (Math.abs(Number(formatted) - normalizedValue) <= 0.000001) {
        addThicknessValue(formatted);
      }
    }
    return [...values];
  }

  private materialDateSearchValues(value?: Date | string | null) {
    const formatted = this.formatDateOnly(value);
    if (!formatted) {
      return [];
    }
    const [year, month, day] = formatted.split('-');
    const compactDate = `${year}${month}${day}`;
    const looseDate = `${year}-${Number(month)}-${Number(day)}`;
    // 订单详情接口可能返回 ISO 日期字符串，搜索时也要能直接命中历史图纸日期。
    const isoDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
    const looseIsoDate = `${looseDate}T00:00:00.000Z`;
    return [formatted, compactDate, looseDate, isoDate, looseIsoDate];
  }

  private compareMaterialSuggestions(
    left: {
      partCode: string;
      searchMatchRank?: number;
      customerUsageCount?: number;
      historyUsageCount?: number;
      availableQuantity?: number;
      lastCustomerOrderDate?: string;
      projectModel?: string | null;
    },
    right: {
      partCode: string;
      searchMatchRank?: number;
      customerUsageCount?: number;
      historyUsageCount?: number;
      availableQuantity?: number;
      lastCustomerOrderDate?: string;
      projectModel?: string | null;
    },
    preferCustomerHistory: boolean,
    preferredProjectModel = ''
  ) {
    const searchRankDiff = (right.searchMatchRank ?? 0) - (left.searchMatchRank ?? 0);
    if (searchRankDiff !== 0) {
      return searchRankDiff;
    }

    if (preferCustomerHistory) {
      // 当前客户空关键字下拉优先展示最近使用过的零件；使用次数作为次级排序，避免旧高频零件压过刚下单的客户用料。
      const lastCustomerOrderDateDiff =
        this.sortableDateValue(right.lastCustomerOrderDate) - this.sortableDateValue(left.lastCustomerOrderDate);
      if (lastCustomerOrderDateDiff !== 0) {
        return lastCustomerOrderDateDiff;
      }

      const customerUsageDiff = (right.customerUsageCount ?? 0) - (left.customerUsageCount ?? 0);
      if (customerUsageDiff !== 0) {
        return customerUsageDiff;
      }
    }

    if (preferredProjectModel) {
      const leftProjectRank = normalizeSearchKeyword(left.projectModel) === preferredProjectModel ? 1 : 0;
      const rightProjectRank = normalizeSearchKeyword(right.projectModel) === preferredProjectModel ? 1 : 0;
      const projectRankDiff = rightProjectRank - leftProjectRank;
      if (projectRankDiff !== 0) {
        return projectRankDiff;
      }
    }

    const historyUsageDiff = (right.historyUsageCount ?? 0) - (left.historyUsageCount ?? 0);
    if (historyUsageDiff !== 0) {
      return historyUsageDiff;
    }

    const stockDiff = (right.availableQuantity ?? 0) - (left.availableQuantity ?? 0);
    if (stockDiff !== 0) {
      return stockDiff;
    }

    return left.partCode.localeCompare(right.partCode, 'zh-Hans-CN');
  }

  private sortableDateValue(value?: Date | string | null) {
    if (!value) {
      return 0;
    }
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
  }

  private formatDateOnly(value?: Date | string | null) {
    if (!value) {
      return undefined;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async materialSourceDetails(partCode: string, query: InventorySourceDetailQueryDto) {
    const normalizedPartCode = partCode.trim();
    if (!normalizedPartCode) {
      throw new BadRequestException('零件编码不能为空');
    }

    const sourceType = query.sourceType || 'ALL';
    const customerScope = await this.resolveInventoryCustomerScope(query.customerId);
    const where: Prisma.InventoryBatchWhereInput = {
      partCode: { equals: normalizedPartCode, mode: 'insensitive' },
      quantity: { gt: 0 },
      status: 'AVAILABLE',
      ...(query.unit?.trim() ? { unit: query.unit.trim() } : {}),
      ...(query.warehouseId?.trim() ? { warehouseId: query.warehouseId.trim() } : {})
    };
    if (sourceType === 'STOCK') {
      where.sourceOrderId = null;
    } else if (sourceType === 'ORDER') {
      where.sourceOrderId = { not: null };
    }

    const currentOrder = await this.resolveStockReservationPriorityOrder(query);
    const reservationWhere = currentOrder
      ? this.activeReservationWhereForPriority(currentOrder)
      : this.activeReservationWhere(query.excludeOrderNo, query.excludeOrderId);
    const batches = await this.prisma.inventoryBatch.findMany({
      where,
      include: {
        warehouse: true,
        location: true,
        sourceOrder: true,
        sourceOrderLine: true,
        productionTask: { include: { order: true, orderLine: true } },
        reservations: {
          where: reservationWhere,
          include: {
            order: { select: { id: true, orderNo: true, status: true, createdAt: true, customerName: true, orderDate: true } },
            orderLine: { select: { lineNo: true, partCode: true, partName: true } }
          },
          orderBy: [{ createdAt: 'asc' }]
        }
      },
      // 下单选择备货库存时默认从小批次数量开始，减少大批次被过早拆散。
      orderBy: [{ quantity: 'asc' }, { createdAt: 'asc' }, { batchNo: 'asc' }]
    });

    const orderedBatches = customerScope
      ? [...batches].sort((left, right) => {
          // 库存来源核对只调整当前客户来源的展示优先级，不过滤全局备货，避免新客户无法使用可用库存。
          const leftCustomerRank = this.inventoryBatchMatchesCustomerScope(left, customerScope) ? 0 : 1;
          const rightCustomerRank = this.inventoryBatchMatchesCustomerScope(right, customerScope) ? 0 : 1;
          return (
            leftCustomerRank - rightCustomerRank ||
            decimalToNumber(left.quantity) - decimalToNumber(right.quantity) ||
            String(left.createdAt || '').localeCompare(String(right.createdAt || ''), 'zh-Hans-CN') ||
            String(left.batchNo || '').localeCompare(String(right.batchNo || ''), 'zh-Hans-CN')
          );
        })
      : batches;
    const sourceTaskMap = await this.findSourceTaskMap(orderedBatches.map((batch) => batch.sourceProductionTaskNo));
    const material = await this.prisma.material.findFirst({
      where: { partCode: { equals: normalizedPartCode, mode: 'insensitive' } }
    });
    const firstBatch = orderedBatches[0];
    const unit = query.unit?.trim() || firstBatch?.unit || material?.unit || '件';

    const sources = orderedBatches.map((batch) => this.toInventorySourceDetail(batch, sourceTaskMap, currentOrder));
    const withPage = query.withPage === 'true';
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const pagedSources = withPage ? sources.slice(offset, offset + limit) : sources;
    const totalSourceCount = sources.length;
    return {
      partCode: firstBatch?.partCode || material?.partCode || normalizedPartCode,
      partName: firstBatch?.partName || material?.partName || '',
      unit,
      availableQuantity: sources.reduce((sum, row) => sum + row.quantity, 0),
      batchCount: totalSourceCount,
      orderSourceCount: sources.filter((row) => row.inventorySourceType === 'ORDER').length,
      stockSourceCount: sources.filter((row) => row.inventorySourceType === 'STOCK').length,
      sources: pagedSources,
      ...(withPage
        ? {
            totalSourceCount,
            sourceLimit: limit,
            sourceOffset: offset,
            sourceHasMore: offset + pagedSources.length < totalSourceCount
          }
        : {})
    };
  }

  async adjustBatchQuantity(batchId: string, dto: AdjustInventoryBatchDto) {
    const afterQuantity = Number(dto.afterQuantity);
    if (!Number.isFinite(afterQuantity) || afterQuantity < 0) {
      throw new BadRequestException('盘点后数量必须大于或等于 0');
    }

    const targetStatus = dto.targetStatus;
    if (targetStatus === 'SCRAPPED' && afterQuantity !== 0) {
      throw new BadRequestException('报废或销毁清零后数量必须为 0');
    }

    const countedBy = dto.countedBy?.trim();
    const signatureName = dto.signatureName?.trim();
    if (!countedBy) {
      throw new BadRequestException('盘点人员不能为空');
    }
    if (!signatureName) {
      throw new BadRequestException('签字姓名不能为空');
    }
    const attachmentFileName = dto.attachmentFileName?.trim();
    const attachmentFileUrl = dto.attachmentFileUrl?.trim();
    if (!attachmentFileName || !attachmentFileUrl) {
      throw new BadRequestException('库存盘点必须上传统计工单或照片附件');
    }
    const attachmentMimeType = dto.attachmentMimeType?.trim();
    this.validateAdjustmentAttachment(attachmentFileUrl, attachmentFileName, attachmentMimeType);

    const countedAt = dto.countedAt ? new Date(dto.countedAt) : new Date();
    if (Number.isNaN(countedAt.getTime())) {
      throw new BadRequestException('盘点日期无效');
    }

    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const batch = await tx.inventoryBatch.findUnique({
          where: { id: batchId },
          include: {
            warehouse: true,
            location: true,
            reservations: {
              where: { status: InventoryReservationStatus.ACTIVE },
              include: {
                order: { select: { orderNo: true, customerName: true } },
                orderLine: { select: { partCode: true, partName: true } }
              },
              orderBy: [{ createdAt: 'asc' }]
            }
          }
        });
        if (!batch) {
          throw new NotFoundException('库存批次不存在');
        }

        const beforeQuantity = decimalToNumber(batch.quantity);
        if (batch.status !== 'AVAILABLE' && beforeQuantity > 0) {
          throw new BadRequestException('只有可用库存可以盘点调整');
        }
        const reservedQuantity = batch.sourceOrderId
          ? 0
          : batch.reservations.reduce((sum, reservation) => sum + decimalToNumber(reservation.quantity), 0);
        if (afterQuantity + 0.0001 < reservedQuantity) {
          const reservationText = batch.reservations
            .map((reservation) => {
              const orderNo = reservation.orderNo || reservation.order?.orderNo || '草稿订单';
              const partName = reservation.partName || reservation.orderLine?.partName || reservation.partCode || reservation.orderLine?.partCode || '-';
              return `${orderNo}/${partName} ${decimalToNumber(reservation.quantity)}${reservation.unit || batch.unit}`;
            })
            .join('，');
          throw new BadRequestException(
            `盘点后数量不能小于已预占数量：已预占 ${reservedQuantity}${batch.unit}，盘点后 ${afterQuantity}${batch.unit}${
              reservationText ? `（${reservationText}）` : ''
            }。请先处理订单库存选择或释放预占后再盘点。`
          );
        }
        const deltaQuantity = afterQuantity - beforeQuantity;
        const adjustmentNo = this.buildAdjustmentNo();

        const adjustment = await tx.inventoryAdjustment.create({
          data: {
            adjustmentNo,
            batchId: batch.id,
            partCode: batch.partCode,
            partName: batch.partName,
            beforeQuantity,
            afterQuantity,
            deltaQuantity,
            unit: batch.unit,
            countedBy,
            countedAt,
            signatureName,
            attachmentFileName,
            attachmentFileUrl,
            attachmentMimeType,
            attachmentSize: dto.attachmentSize ?? null,
            remark: dto.remark?.trim() || null
          }
        });

        await tx.inventoryBatch.update({
          where: { id: batch.id },
          // 盘点为 0 的批次不再作为可用库存；如果后续重新盘点到正数，允许恢复为 AVAILABLE。
          data: {
            quantity: afterQuantity,
            status: targetStatus === 'SCRAPPED' ? 'SCRAPPED' : afterQuantity > 0 ? 'AVAILABLE' : 'USED'
          }
        });

        if (deltaQuantity !== 0) {
          await tx.inventoryTransaction.create({
            data: {
              transactionNo: this.buildAdjustmentTransactionNo(),
              transactionType: deltaQuantity > 0 ? 'IN' : 'OUT',
              batchId: batch.id,
              partCode: batch.partCode,
              partName: batch.partName,
              orderNo: batch.sourceOrderNo,
              productionTaskNo: batch.sourceProductionTaskNo,
              quantity: Math.abs(deltaQuantity),
              unit: batch.unit,
              warehouseId: batch.warehouseId,
              locationId: batch.locationId,
              // 盘点调整不覆盖原始库存来源，只用流水追加差异数量，保证库存账可核对。
              remark: dto.remark?.trim() || `盘点调整：${beforeQuantity} -> ${afterQuantity}`,
              sourceRecordType: 'InventoryAdjustment',
              sourceRecordId: adjustment.id
            }
          });
        }

        return this.toAdjustment(adjustment);
      },
      '当前库存批次正在被其他操作修改，请刷新后重新盘点'
    );
  }

  async findBatchAdjustments(batchId: string) {
    const batch = await this.prisma.inventoryBatch.findUnique({ where: { id: batchId }, select: { id: true } });
    if (!batch) {
      throw new NotFoundException('库存批次不存在');
    }

    const adjustments = await this.prisma.inventoryAdjustment.findMany({
      where: { batchId },
      orderBy: { createdAt: 'desc' }
    });

    return adjustments.map((adjustment) => this.toAdjustment(adjustment));
  }

  async findBatchReservations(batchId: string) {
    const batch = await this.prisma.inventoryBatch.findUnique({
      where: { id: batchId },
      select: { id: true }
    });
    if (!batch) {
      throw new NotFoundException('库存批次不存在');
    }

    const reservations = await this.prisma.inventoryReservation.findMany({
      where: { batchId },
      include: {
        order: { select: { orderNo: true, customerName: true, orderDate: true } },
        orderLine: { select: { lineNo: true, partCode: true, partName: true } }
      },
      orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }]
    });

    return reservations.map((reservation) => ({
      id: reservation.id,
      batchId: reservation.batchId,
      orderId: reservation.orderId,
      orderLineId: reservation.orderLineId,
      orderNo: reservation.orderNo || reservation.order?.orderNo,
      customerName: reservation.order?.customerName,
      orderDate: reservation.order?.orderDate,
      lineNo: reservation.orderLine?.lineNo,
      partCode: reservation.partCode || reservation.orderLine?.partCode,
      partName: reservation.partName || reservation.orderLine?.partName,
      quantity: decimalToNumber(reservation.quantity),
      unit: reservation.unit,
      status: reservation.status,
      statusReason: reservation.statusReason,
      releasedAt: reservation.releasedAt,
      consumedAt: reservation.consumedAt,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt
    }));
  }

  private async findSourceTaskMap(taskNos: Array<string | null | undefined>) {
    const uniqueTaskNos = [...new Set(taskNos.filter(Boolean))] as string[];
    if (uniqueTaskNos.length === 0) {
      return new Map<string, any>();
    }

    const tasks = await this.prisma.productionTask.findMany({
      where: { productionTaskNo: { in: uniqueTaskNos } },
      include: { order: true, orderLine: true }
    });
    return new Map(tasks.map((task) => [task.productionTaskNo, task]));
  }

  private resolveInventorySourceTask(batch: any, sourceTaskMap: Map<string, any>) {
    return (batch.sourceProductionTaskNo && sourceTaskMap.get(batch.sourceProductionTaskNo)) || batch.productionTask || null;
  }

  private resolveInventorySourceLine(batch: any, sourceTask: any) {
    if (batch.sourceProductionTaskNo && sourceTask?.orderLine) {
      // 订单使用备货库存时，sourceOrderLine 是当前订单零件；库存图纸必须优先取原生产任务的订单零件。
      return sourceTask.orderLine;
    }
    return batch.sourceOrderLine || sourceTask?.orderLine || batch.productionTask?.orderLine || null;
  }

  private resolveInventorySourceOrder(batch: any, sourceTask: any) {
    if (batch.sourceProductionTaskNo && sourceTask?.order) {
      return sourceTask.order;
    }
    return batch.sourceOrder || sourceTask?.order || batch.productionTask?.order || null;
  }

  private replenishmentSourceLabel(batch: any, sourceTask: any) {
    const sourceType = batch.replenishmentSourceType || sourceTask?.replenishmentSourceType;
    const sourceRequestNo = batch.replenishmentSourceRequestNo || sourceTask?.replenishmentSourceRequestNo;
    if (!sourceType) {
      return null;
    }
    const prefix = sourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单';
    return sourceRequestNo ? `${prefix}：${sourceRequestNo}` : prefix;
  }

  private async activeReservationQuantityByBatchId(
    batchIds: string[],
    query: { excludeOrderNo?: string; excludeOrderId?: string } = {}
  ) {
    if (batchIds.length === 0) {
      return new Map<string, number>();
    }
    const currentOrder = await this.resolveStockReservationPriorityOrder(query);
    const rows = await this.prisma.inventoryReservation.findMany({
      where: {
        batchId: { in: batchIds },
        ...(currentOrder ? this.activeReservationWhereForPriority(currentOrder) : this.activeReservationWhere(query.excludeOrderNo, query.excludeOrderId))
      },
      select: {
        batchId: true,
        quantity: true,
        order: { select: { id: true, orderNo: true, status: true, createdAt: true } }
      }
    });
    const quantityByBatchId = new Map<string, number>();
    for (const row of rows) {
      if (!this.stockReservationConsumesAvailability(row.order, currentOrder)) {
        continue;
      }
      quantityByBatchId.set(row.batchId, (quantityByBatchId.get(row.batchId) ?? 0) + decimalToNumber(row.quantity));
    }
    return quantityByBatchId;
  }

  private toInventorySourceDetail(batch: any, sourceTaskMap: Map<string, any>, currentOrder?: StockReservationPriorityOrder | null) {
    const sourceTask = this.resolveInventorySourceTask(batch, sourceTaskMap);
    const sourceLine = this.resolveInventorySourceLine(batch, sourceTask);
    const sourceOrder = this.resolveInventorySourceOrder(batch, sourceTask);
    const reservations = (batch.reservations || [])
      .filter((reservation: any) => this.stockReservationConsumesAvailability(reservation.order, currentOrder))
      .map((reservation: any) => ({
        id: reservation.id,
        orderNo: reservation.orderNo || reservation.order?.orderNo,
        customerName: reservation.order?.customerName,
        orderDate: reservation.order?.orderDate,
        orderLineId: reservation.orderLineId,
        lineNo: reservation.orderLine?.lineNo,
        partCode: reservation.partCode || reservation.orderLine?.partCode,
        partName: reservation.partName || reservation.orderLine?.partName,
        quantity: decimalToNumber(reservation.quantity),
        unit: reservation.unit,
        statusReason: reservation.statusReason,
        createdAt: reservation.createdAt
      }));
    const storedQuantity = decimalToNumber(batch.quantity);
    const activeReservationQuantity = batch.sourceOrderId ? 0 : reservations.reduce((sum: number, reservation: any) => sum + reservation.quantity, 0);
    const reservedQuantity = this.inventoryBatchReservedQuantity(batch.status, storedQuantity, activeReservationQuantity);
    const physicalQuantity = this.isPhysicalInventoryBatchStatus(batch.status) ? storedQuantity : 0;
    const quantity =
      batch.status === 'AVAILABLE' ? Math.max(Math.round((physicalQuantity - reservedQuantity + Number.EPSILON) * 1000) / 1000, 0) : 0;

    return {
      id: batch.id,
      batchNo: batch.batchNo,
      partCode: batch.partCode,
      partName: batch.partName,
      lineType: sourceLine?.lineType || undefined,
      partCategory: sourceLine?.partCategory || undefined,
      componentNo: sourceLine?.componentNo || undefined,
      parentComponentNo: sourceLine?.parentComponentNo || undefined,
      importSequence: sourceLine?.importSequence || undefined,
      quantity,
      physicalQuantity,
      reservedQuantity,
      reservations,
      unit: batch.unit,
      warehouseId: batch.warehouseId,
      warehouseName: batch.warehouse?.warehouseName,
      locationId: batch.locationId,
      locationName: batch.location?.locationName,
      inventorySourceType: batch.sourceOrderId ? 'ORDER' : 'STOCK',
      sourceKind: batch.sourceKind || 'NORMAL_ORDER',
      replenishmentSourceType: batch.replenishmentSourceType || sourceTask?.replenishmentSourceType,
      replenishmentSourceRequestNo: batch.replenishmentSourceRequestNo || sourceTask?.replenishmentSourceRequestNo,
      replenishmentSourceLabel: this.replenishmentSourceLabel(batch, sourceTask),
      sourceOrderNo: batch.sourceOrderNo,
      sourceCustomerName: batch.sourceCustomerName,
      productionSourceOrderNo: sourceOrder?.orderNo,
      productionSourceCustomerName: sourceOrder?.customerName || sourceTask?.customerName || batch.sourceCustomerName,
      sourceProductionTaskNo: batch.sourceProductionTaskNo || sourceTask?.productionTaskNo,
      productionDate: sourceTask?.completedAt || batch.createdAt,
      orderDate: sourceOrder?.orderDate,
      deliveryDate: sourceLine?.deliveryDate || sourceOrder?.deliveryDate,
      drawingNo: sourceLine?.drawingNo,
      drawingVersion: sourceLine?.drawingVersion,
      drawingDate: this.formatDateOnly(sourceLine?.drawingDate),
      drawingStatus: sourceLine?.drawingStatus,
      drawingFileName: sourceLine?.drawingFileName,
      drawingFileUrl: sourceLine?.drawingFileUrl,
      partThickness: sourceLine ? decimalToNumber(sourceLine.partThickness) : null,
      partSpecification: sourceLine?.partSpecification,
      projectModel: sourceLine?.projectModel,
      status: batch.status,
      createdAt: batch.createdAt
    };
  }

  async findAll(query: InventoryQueryDto) {
    const where = await this.buildInventoryWhere(query);
    const includeTestFixtures = query.includeTestFixtures === 'true';
    const currentOrder = await this.resolveStockReservationPriorityOrder(query);
    const reservationWhere = currentOrder
      ? this.activeReservationWhereForPriority(currentOrder)
      : this.activeReservationWhere(query.excludeOrderNo, query.excludeOrderId);
    const withPage = query.withPage === 'true';
    const limit = Math.min(Math.max(query.limit || 50, 1), 200);
    const offset = Math.max(query.offset || 0, 0);

    const rawBatches = await this.prisma.inventoryBatch.findMany({
      where,
      include: {
        warehouse: true,
        location: true,
        sourceOrder: true,
        sourceOrderLine: true,
        productionTask: { include: { order: true, orderLine: true } },
        reservations: {
          where: reservationWhere,
          include: {
            order: { select: { id: true, orderNo: true, status: true, createdAt: true, customerName: true, orderDate: true } },
            orderLine: { select: { lineNo: true, partCode: true, partName: true } }
          },
          orderBy: [{ createdAt: 'asc' }]
        }
      },
      orderBy: [{ createdAt: 'desc' }, { partCode: 'asc' }]
    });

    const visibleRawBatches = includeTestFixtures ? rawBatches : rawBatches.filter((batch) => !this.isTestFixtureInventoryBatch(batch));
    const sourceTaskMap = await this.findSourceTaskMap(visibleRawBatches.map((batch) => batch.sourceProductionTaskNo));
    const stockAlertSummaryRows = this.normalizeStockAlertFilter(query.stockAlert)
      ? ((await this.summary({ ...query, withPage: undefined, limit: undefined, offset: undefined })) as Array<{ partCode: string }>)
      : [];
    const stockAlertPartCodes = this.normalizeStockAlertFilter(query.stockAlert)
      ? new Set(stockAlertSummaryRows.map((row) => row.partCode.trim().toLocaleLowerCase()))
      : null;
    const batches = visibleRawBatches.filter((batch) =>
      this.inventoryBatchMatchesKeyword(batch, query.keyword, this.inventoryBatchSourceSearchValues(batch, sourceTaskMap)) &&
        (!stockAlertPartCodes || stockAlertPartCodes.has(batch.partCode.trim().toLocaleLowerCase()))
    );

    const items = batches.map((batch) => {
      const storedQuantity = decimalToNumber(batch.quantity);
      const physicalQuantity = this.isPhysicalInventoryBatchStatus(batch.status) ? storedQuantity : 0;
      const reservations = (batch.reservations || [])
        .filter((reservation: any) => this.stockReservationConsumesAvailability(reservation.order, currentOrder))
        .map((reservation: any) => ({
          id: reservation.id,
          orderNo: reservation.orderNo || reservation.order?.orderNo,
          customerName: reservation.order?.customerName,
          orderDate: reservation.order?.orderDate,
          orderLineId: reservation.orderLineId,
          lineNo: reservation.orderLine?.lineNo,
          partCode: reservation.partCode || reservation.orderLine?.partCode,
          partName: reservation.partName || reservation.orderLine?.partName,
          quantity: decimalToNumber(reservation.quantity),
          unit: reservation.unit,
          statusReason: reservation.statusReason,
          createdAt: reservation.createdAt
        }));
      const activeReservationQuantity = batch.sourceOrderId ? 0 : reservations.reduce((sum: number, reservation: any) => sum + reservation.quantity, 0);
      const reservedQuantity = this.inventoryBatchReservedQuantity(batch.status, storedQuantity, activeReservationQuantity);
      const availableQuantity =
        batch.status === 'AVAILABLE' ? Math.max(Math.round((physicalQuantity - reservedQuantity + Number.EPSILON) * 1000) / 1000, 0) : 0;
      const sourceTask = this.resolveInventorySourceTask(batch, sourceTaskMap);
      const sourceLine = this.resolveInventorySourceLine(batch, sourceTask);
      const sourceOrder = this.resolveInventorySourceOrder(batch, sourceTask);

      return {
        // 库存列表需要区分订单库存和备货库存，后续发货只允许订单库存进入发货流程。
        id: batch.id,
        batchNo: batch.batchNo,
        partCode: batch.partCode,
        partName: batch.partName,
        lineType: sourceLine?.lineType || undefined,
        partCategory: sourceLine?.partCategory || undefined,
        componentNo: sourceLine?.componentNo || undefined,
        parentComponentNo: sourceLine?.parentComponentNo || undefined,
        importSequence: sourceLine?.importSequence || undefined,
        // 批次列表的 quantity 保持账面当前剩余，盘点调整必须以它为准；availableQuantity 才是扣除预占后的可下单数量。
        quantity: storedQuantity,
        physicalQuantity,
        reservedQuantity,
        availableQuantity,
        reservations,
        canAdjust: batch.status === 'AVAILABLE' || storedQuantity === 0,
        unit: batch.unit,
        warehouseId: batch.warehouseId,
        warehouseName: batch.warehouse.warehouseName,
        locationId: batch.locationId,
        locationName: batch.location?.locationName,
        inventorySourceType: batch.sourceOrderId ? 'ORDER' : 'STOCK',
        sourceKind: batch.sourceKind || 'NORMAL_ORDER',
        replenishmentSourceType: batch.replenishmentSourceType || sourceTask?.replenishmentSourceType,
        replenishmentSourceRequestNo: batch.replenishmentSourceRequestNo || sourceTask?.replenishmentSourceRequestNo,
        replenishmentSourceLabel: this.replenishmentSourceLabel(batch, sourceTask),
        isOrderInventory: Boolean(batch.sourceOrderId),
        sourceOrderNo: batch.sourceOrderNo,
        sourceCustomerName: batch.sourceCustomerName,
        productionSourceOrderNo: sourceOrder?.orderNo,
        productionSourceCustomerName: sourceOrder?.customerName || sourceTask?.customerName || batch.sourceCustomerName,
        sourceProductionTaskNo: batch.sourceProductionTaskNo || sourceTask?.productionTaskNo,
        isReplenishment: Boolean(sourceTask?.isReplenishment),
        sourceReplenishmentTaskNo: sourceTask?.sourceProductionTaskNo,
        productionDate: sourceTask?.completedAt || batch.createdAt,
        drawingNo: sourceLine?.drawingNo,
        drawingVersion: sourceLine?.drawingVersion,
        drawingDate: this.formatDateOnly(sourceLine?.drawingDate),
        drawingStatus: sourceLine?.drawingStatus,
        drawingFileName: sourceLine?.drawingFileName,
        drawingFileUrl: sourceLine?.drawingFileUrl,
        partThickness: sourceLine ? decimalToNumber(sourceLine.partThickness) : null,
        partSpecification: sourceLine?.partSpecification,
        // 库存来源订单日期用于入库后继续核对交期和订单来源。
        orderDate: sourceOrder?.orderDate,
        deliveryDate: sourceLine?.deliveryDate || sourceOrder?.deliveryDate,
        status: batch.status,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt
      };
    });

    if (!withPage) {
      return items;
    }

    const totalCount = items.length;
    const pagedItems = items.slice(offset, offset + limit);
    // 库存批次分页必须显式返回总数和 hasMore，避免前端静默截断批次来源，影响仓库核对。
    return {
      items: pagedItems,
      totalCount,
      limit,
      offset,
      hasMore: offset + pagedItems.length < totalCount
    };
  }

  async buildInventoryExport(query: InventoryQueryDto): Promise<Uint8Array> {
    const exportQuery = { ...query, withPage: undefined, limit: undefined, offset: undefined };
    const [summaryRows, batchRows] = await Promise.all([
      this.summary(exportQuery) as Promise<any[]>,
      this.findAll(exportQuery) as Promise<any[]>
    ]);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();
    const scopeText = await this.inventoryExportScopeText(query);

    this.addInventoryExportSheet(workbook, {
      sheetName: '库存汇总',
      title: '库存汇总导出',
      scopeText,
      headers: [
        '序号',
        '零件编码',
        '零件名称',
        '单位',
        '批次数',
        '仓库数',
        '账面数量',
        '预占数量',
        '可用数量',
        '已出库/已使用数量',
        '累计数量',
        '订单库存',
        '备货库存',
        '正常备货',
        '取消转备货',
        '客户变更转备货',
        '库存报警',
        '最小库存',
        '仓库分布'
      ],
      rows: summaryRows.map((row, index) => [
        index + 1,
        row.partCode,
        row.partName,
        row.unit,
        row.batchCount,
        row.warehouseCount,
        row.physicalQuantity,
        row.reservedQuantity,
        row.availableQuantity,
        row.usedQuantity,
        row.totalQuantity,
        row.orderInventoryQuantity,
        row.stockInventoryQuantity,
        row.normalOrderStockQuantity,
        row.cancelledOrderStockQuantity,
        row.customerChangeStockQuantity,
        row.stockAlertTriggered ? '已触发' : row.stockAlertEnabled ? '已启用' : '未启用',
        row.stockAlertQuantity ?? '',
        row.warehouses
          .map(
            (warehouse: any) =>
              `${warehouse.warehouseName}：可用 ${warehouse.availableQuantity}${row.unit} / 预占 ${warehouse.reservedQuantity}${row.unit} / ${warehouse.batchCount} 批`
          )
          .join('\n')
      ])
    });

    this.addInventoryExportSheet(workbook, {
      sheetName: '库存批次',
      title: '库存批次导出',
      scopeText,
      headers: [
        '序号',
        '批次号',
        '零件编码',
        '零件名称',
        '行类型',
        '零件类型',
        '组件编号',
        '所属组件',
        '图号',
        '图纸版本',
        '图纸日期',
        '图纸状态',
        '厚度',
        '规格',
        '账面数量',
        '预占数量',
        '可用数量',
        '单位',
        '库存来源',
        '备货来源',
        '客户',
        '来源订单',
        '生产来源订单',
        '生产任务',
        '补单来源任务',
        '生产日期',
        '订单日期',
        '交期',
        '仓库',
        '库位',
        '状态'
      ],
      rows: batchRows.map((row, index) => [
        index + 1,
        row.batchNo,
        row.partCode,
        row.partName,
        this.inventoryExportLineTypeLabel(row.lineType),
        row.partCategory || '',
        row.componentNo || '',
        row.parentComponentNo || '',
        row.drawingNo || '',
        row.drawingVersion || '',
        row.drawingDate || '',
        row.drawingStatus || '',
        row.partThickness ?? '',
        row.partSpecification || '',
        row.physicalQuantity ?? row.quantity,
        row.reservedQuantity ?? 0,
        row.availableQuantity ?? 0,
        row.unit,
        this.inventoryExportSourceTypeLabel(row.inventorySourceType),
        this.inventoryExportSourceKindLabel(row.sourceKind, row.replenishmentSourceLabel),
        row.productionSourceCustomerName || row.sourceCustomerName || '',
        row.sourceOrderNo || '',
        row.productionSourceOrderNo || '',
        row.sourceProductionTaskNo || '',
        row.sourceReplenishmentTaskNo || '',
        this.formatDateOnly(row.productionDate),
        this.formatDateOnly(row.orderDate),
        this.formatDateOnly(row.deliveryDate),
        row.warehouseName,
        row.locationName || '',
        this.inventoryExportStatusLabel(row.status)
      ])
    });

    // 库存导出只读取实时汇总和批次明细，不写入 InventoryBatch、InventoryTransaction 或库存报警设置。
    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  private addInventoryExportSheet(
    workbook: ExcelJS.Workbook,
    options: {
      sheetName: string;
      title: string;
      scopeText: string;
      headers: string[];
      rows: InventoryExportCellValue[][];
    }
  ) {
    const worksheet = workbook.addWorksheet(options.sheetName, {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 }
      },
      views: [{ state: 'frozen', ySplit: 4 }]
    });
    const columnCount = Math.max(options.headers.length, 1);
    const titleRow = worksheet.addRow([options.title]);
    worksheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount);
    titleRow.font = { bold: true, size: 16 };
    titleRow.alignment = { vertical: 'middle', horizontal: 'center' };
    titleRow.height = 26;

    const scopeRow = worksheet.addRow([options.scopeText]);
    worksheet.mergeCells(scopeRow.number, 1, scopeRow.number, columnCount);
    scopeRow.font = { color: { argb: 'FF475569' } };
    scopeRow.alignment = { vertical: 'middle', wrapText: true };

    const generatedRow = worksheet.addRow([`制表时间：${this.businessDateTimeText(new Date())}`]);
    worksheet.mergeCells(generatedRow.number, 1, generatedRow.number, columnCount);
    generatedRow.font = { color: { argb: 'FF475569' } };

    const headerRow = worksheet.addRow(options.headers);
    headerRow.font = { bold: true, color: { argb: 'FF0F172A' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.border = this.inventoryExportThinBorder();
    });

    for (const row of options.rows) {
      const dataRow = worksheet.addRow(row);
      dataRow.alignment = { vertical: 'top', wrapText: true };
      dataRow.eachCell((cell) => {
        cell.border = this.inventoryExportThinBorder();
      });
    }

    options.headers.forEach((header, index) => {
      const column = worksheet.getColumn(index + 1);
      const maxLength = [header, ...options.rows.map((row) => row[index])]
        .map((value) => this.inventoryExportDisplayWidth(value))
        .reduce((max, width) => Math.max(max, width), 0);
      column.width = Math.min(Math.max(maxLength + 2, 8), index === options.headers.length - 1 ? 42 : 34);
    });
    worksheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: columnCount }
    };
  }

  private async inventoryExportScopeText(query: InventoryQueryDto) {
    return [
      `关键词：${query.keyword?.trim() || '全部'}`,
      `客户：${await this.inventoryExportCustomerLabel(query.customerId)}`,
      `仓库：${await this.inventoryExportWarehouseLabel(query.warehouseId)}`,
      `订单：${query.orderNo?.trim() || '全部'}`,
      `状态：${this.inventoryExportStatusLabel(query.status) || '全部'}`,
      `库存报警：${this.inventoryExportStockAlertLabel(query.stockAlert)}`
    ].join('；');
  }

  private async inventoryExportCustomerLabel(customerId?: string) {
    if (!customerId?.trim()) {
      return '全部客户';
    }
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId.trim() },
      select: { customerCode: true, customerName: true }
    });
    return customer ? `${customer.customerName} / ${customer.customerCode}` : customerId.trim();
  }

  private async inventoryExportWarehouseLabel(warehouseId?: string) {
    if (!warehouseId?.trim()) {
      return '全部仓库';
    }
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId.trim() },
      select: { warehouseCode: true, warehouseName: true }
    });
    return warehouse ? `${warehouse.warehouseName} / ${warehouse.warehouseCode}` : warehouseId.trim();
  }

  private inventoryExportStockAlertLabel(stockAlert?: StockAlertFilter) {
    if (stockAlert === 'TRIGGERED') {
      return '已触发';
    }
    if (stockAlert === 'ENABLED') {
      return '已启用';
    }
    if (stockAlert === 'DISABLED') {
      return '未启用';
    }
    return '全部';
  }

  private inventoryExportStatusLabel(status?: string | null) {
    if (status === 'AVAILABLE') {
      return '可用';
    }
    if (status === 'RESERVED') {
      return '已预占';
    }
    if (status === 'USED') {
      return '已用完';
    }
    if (status === 'SCRAPPED') {
      return '已报废';
    }
    return status || '';
  }

  private inventoryExportSourceTypeLabel(sourceType?: string | null) {
    if (sourceType === 'ORDER') {
      return '订单库存';
    }
    if (sourceType === 'STOCK') {
      return '备货库存';
    }
    return sourceType || '';
  }

  private inventoryExportSourceKindLabel(sourceKind?: string | null, replenishmentSourceLabel?: string | null) {
    if (replenishmentSourceLabel) {
      return replenishmentSourceLabel;
    }
    if (sourceKind === 'CANCELLED_ORDER') {
      return '订单取消转备货';
    }
    if (sourceKind === 'CUSTOMER_CHANGE') {
      return '客户变更转备货';
    }
    return '正常订单';
  }

  private async modelBomExportScopeText(query: ModelBomQueryDto) {
    return [
      `关键词：${query.keyword?.trim() || '全部'}`,
      `客户：${await this.modelBomExportCustomerLabel(query.customerId)}`,
      `机型/项目：${query.projectModel?.trim() || '全部'}`,
      `BOM范围：${this.modelBomExportScopeModeLabel(query.scopeMode) || '全部'}`,
      `泛用包：${query.excludeGlobalAllProject === 'true' ? '排除全部客户/全部机型通用包' : '包含全部客户/全部机型通用包'}`,
      `常用：${query.commonOnly === 'true' ? '只看常用 BOM' : '全部'}`,
      `状态：${this.modelBomExportStatusLabel(query.status) || '启用'}`
    ].join('；');
  }

  private async modelBomExportCustomerLabel(customerId?: string) {
    if (!customerId?.trim()) {
      return '全部客户';
    }
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId.trim() },
      select: { customerCode: true, customerName: true }
    });
    return customer ? `${customer.customerName} / ${customer.customerCode}` : customerId.trim();
  }

  private modelBomExportScopeModeLabel(scopeMode?: string | null) {
    if (scopeMode === 'ALL') {
      return '全部客户通用';
    }
    if (scopeMode === 'SELECTED') {
      return '指定客户可用';
    }
    if (scopeMode === 'PRIVATE') {
      return '客户私有';
    }
    return scopeMode || '';
  }

  private modelBomExportStatusLabel(status?: string | null) {
    if (status === 'ENABLED') {
      return '启用';
    }
    if (status === 'DISABLED') {
      return '停用';
    }
    if (status === 'ALL') {
      return '全部';
    }
    return status || '';
  }

  private modelBomExportLineTypeLabel(line: {
    structureType?: string | null;
    lineType?: string | null;
    componentNo?: string | null;
    parentComponentNo?: string | null;
  }) {
    if (line.structureType === 'COMPONENT' || line.lineType === 'COMPONENT') {
      return line.componentNo ? `组件 ${line.componentNo}` : '组件';
    }
    if (line.structureType === 'CHILD_PART' || line.parentComponentNo) {
      return line.parentComponentNo ? `子零件 -> ${line.parentComponentNo}` : '子零件';
    }
    return '单独零件';
  }

  private modelBomExportPartThicknessSourceLabel(source?: string | null) {
    if (source === 'BOM_LINE') {
      return 'BOM行确认';
    }
    if (source === 'ORDER_HISTORY') {
      return '历史订单预填';
    }
    return source || '';
  }

  private modelBomExportDrawingSourceLabel(source?: string | null) {
    if (source === 'BOM_LINE') {
      return 'BOM行指定';
    }
    if (source === 'MATERIAL_DEFAULT') {
      return '零件默认图纸';
    }
    if (source === 'MATERIAL_LATEST') {
      return '零件最新启用图纸';
    }
    return source || '';
  }

  private modelBomExportDefaultProcessSourceLabel(source?: string | null) {
    if (source === 'BOM_LINE') {
      return 'BOM行默认工艺';
    }
    if (source === 'MATERIAL') {
      return '零件基础库默认工艺';
    }
    return source || '';
  }

  private modelBomExportLineSummary(
    lines: Array<{
      structureType?: string | null;
      lineType?: string | null;
      componentNo?: string | null;
      parentComponentNo?: string | null;
      partThickness?: number | null;
      status?: string | null;
      materialStatus?: string | null;
    }>
  ) {
    const enabledComponentNos = new Set(
      lines
        .filter((line) => (line.structureType === 'COMPONENT' || line.lineType === 'COMPONENT') && line.status === 'ENABLED')
        .map((line) => String(line.componentNo || '').trim())
        .filter(Boolean)
    );
    const summary = {
      effectiveCount: 0,
      componentCount: 0,
      childPartCount: 0,
      standalonePartCount: 0,
      orphanPartCount: 0,
      missingThicknessCount: 0,
      disabledCount: 0,
      materialDisabledCount: 0
    };
    for (const line of lines) {
      const isComponent = line.structureType === 'COMPONENT' || line.lineType === 'COMPONENT';
      if (line.status === 'DISABLED') {
        summary.disabledCount += 1;
      }
      if (line.materialStatus === 'DISABLED') {
        summary.materialDisabledCount += 1;
      }
      if (line.status === 'ENABLED' && line.materialStatus !== 'DISABLED') {
        summary.effectiveCount += 1;
      }
      if (isComponent) {
        summary.componentCount += 1;
      } else if (line.parentComponentNo) {
        if (enabledComponentNos.has(String(line.parentComponentNo).trim())) {
          summary.childPartCount += 1;
        } else {
          summary.orphanPartCount += 1;
        }
      } else {
        summary.standalonePartCount += 1;
      }
      if (!isComponent && Number(line.partThickness ?? 0) <= 0) {
        summary.missingThicknessCount += 1;
      }
    }
    return summary;
  }

  private async materialTransformExportScopeText(query: MaterialTransformRuleQueryDto) {
    return [
      `关键词：${query.keyword?.trim() || '全部'}`,
      `来源零件：${query.sourcePartCode?.trim() || query.sourceMaterialId?.trim() || '全部'}`,
      `目标零件：${query.targetPartCode?.trim() || query.targetMaterialId?.trim() || '全部'}`,
      `客户：${await this.inventoryExportCustomerLabel(query.customerId)}`,
      `机型/项目：${query.projectModel?.trim() || '全部'}`,
      `来源库存：${this.materialTransformExportStockFilterLabel(query.sourceStockStatus)}`,
      `目标库存：${this.materialTransformExportStockFilterLabel(query.targetStockStatus)}`,
      `库存判断：${this.materialTransformExportDecisionFilterLabel(query.inventoryDecision)}`,
      `状态：${this.materialTransformExportStatusLabel(query.status || 'ENABLED')}`
    ].join('；');
  }

  private materialTransformExportStockFilterLabel(value?: string | null) {
    if (value === 'WITH_STOCK') {
      return '有可用库存';
    }
    if (value === 'NO_STOCK') {
      return '无可用库存';
    }
    return '全部';
  }

  private materialTransformExportDecisionFilterLabel(value?: string | null) {
    if (value === 'TARGET_STOCK') {
      return '先核对目标库存';
    }
    if (value === 'SOURCE_REWORK') {
      return '可核对来源再加工';
    }
    if (value === 'NO_STOCK') {
      return '暂无库存，考虑生产';
    }
    return '全部';
  }

  private materialTransformExportDecisionLabel(row: { sourceAvailableQuantity?: number | null; targetAvailableQuantity?: number | null }) {
    if ((row.targetAvailableQuantity ?? 0) > 0) {
      return '先核对目标库存';
    }
    if ((row.sourceAvailableQuantity ?? 0) > 0) {
      return '可核对来源再加工';
    }
    return '暂无库存，考虑生产';
  }

  private materialTransformExportDecisionReason(row: {
    sourceAvailableQuantity?: number | null;
    sourceUnit?: string | null;
    targetAvailableQuantity?: number | null;
    targetUnit?: string | null;
  }) {
    const sourceQuantity = row.sourceAvailableQuantity ?? 0;
    const targetQuantity = row.targetAvailableQuantity ?? 0;
    if (targetQuantity > 0) {
      return `目标零件有 ${targetQuantity}${row.targetUnit || ''} 可用库存，提交生产时先打开目标库存批次核对。`;
    }
    if (sourceQuantity > 0) {
      return `目标零件暂无可用库存，来源零件有 ${sourceQuantity}${row.sourceUnit || ''} 可用库存，可在库存来源核对中人工选择再加工。`;
    }
    return '来源零件和目标零件都暂无可用库存，提交生产时仍需人工确认重新生产。';
  }

  private materialTransformExportStatusLabel(status?: string | null) {
    if (status === 'ENABLED') {
      return '启用';
    }
    if (status === 'DISABLED') {
      return '停用';
    }
    if (status === 'ALL') {
      return '全部';
    }
    return status || '';
  }

  private materialMemoryExportScopeText(query: MaterialQueryDto) {
    return [
      `关键词：${query.keyword?.trim() || '全部'}`,
      `状态：${this.materialMemoryExportStatusText(query.status || 'ENABLED')}`,
      `库存报警：${this.inventoryExportStockAlertLabel(query.stockAlert)}`
    ].join('；');
  }

  private materialMemoryExportStatusText(status?: string | null) {
    if (status === 'ENABLED') {
      return '启用';
    }
    if (status === 'DISABLED') {
      return '停用';
    }
    return status || '';
  }

  private materialMemoryExportStockAlertText(row: {
    stockAlertEnabled?: boolean | null;
    stockAlertTriggered?: boolean | null;
    stockAlertQuantity?: number | null;
    unit?: string | null;
  }) {
    if (!row.stockAlertEnabled) {
      return '未启用';
    }
    const quantityText = row.stockAlertQuantity === null || row.stockAlertQuantity === undefined ? '-' : `${row.stockAlertQuantity}${row.unit || ''}`;
    return row.stockAlertTriggered ? `已触发：低于 ${quantityText}` : `已启用：下限 ${quantityText}`;
  }

  private inventoryExportLineTypeLabel(lineType?: string | null) {
    if (lineType === 'COMPONENT') {
      return '组件';
    }
    if (lineType === 'PART') {
      return '零件';
    }
    return lineType || '';
  }

  private inventoryExportDisplayWidth(value: InventoryExportCellValue) {
    const text = String(value ?? '');
    return Array.from(text).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
  }

  private inventoryExportThinBorder(): Partial<ExcelJS.Borders> {
    return {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
    };
  }

  private async buildMaterialImportSessionPreview(
    sessionId: string,
    options: { rowLimit?: number; rowOffset?: number; includeRows?: boolean } = {}
  ) {
    const session = await this.prisma.materialImportSession.findUnique({
      where: { id: sessionId },
      include: { files: { orderBy: { createdAt: 'asc' } } }
    });
    if (!session) {
      throw new NotFoundException('零件导入会话不存在');
    }

    const [
      materialRowCount,
      materialImportableRowCount,
      materialIssueAggregate,
      scopeRowCount,
      scopeImportableRowCount,
      scopeIssueAggregate,
      transformRowCount,
      transformImportableRowCount,
      transformIssueAggregate,
      duplicateAggregate,
      importableCodes,
      importableDrawingRows
    ] = await Promise.all([
      this.prisma.materialImportRow.count({ where: { sessionId } }),
      this.prisma.materialImportRow.count({ where: { sessionId, errorCount: 0 } }),
      this.prisma.materialImportRow.aggregate({
        where: { sessionId },
        _sum: { errorCount: true, warningCount: true }
      }),
      this.prisma.materialApplicabilityImportRow.count({ where: { sessionId } }),
      this.prisma.materialApplicabilityImportRow.count({ where: { sessionId, errorCount: 0 } }),
      this.prisma.materialApplicabilityImportRow.aggregate({
        where: { sessionId },
        _sum: { errorCount: true, warningCount: true }
      }),
      this.prisma.materialTransformImportRow.count({ where: { sessionId } }),
      this.prisma.materialTransformImportRow.count({ where: { sessionId, errorCount: 0 } }),
      this.prisma.materialTransformImportRow.aggregate({
        where: { sessionId },
        _sum: { errorCount: true, warningCount: true }
      }),
      this.prisma.materialImportFile.aggregate({
        where: { sessionId },
        _sum: { duplicateRowCount: true }
      }),
      this.prisma.materialImportRow.groupBy({
        by: ['partCode'],
        where: { sessionId, errorCount: 0, partCode: { not: '' } }
      }),
      this.prisma.materialImportRow.findMany({
        where: { sessionId, errorCount: 0, drawingNo: { not: null } },
        select: { partCode: true, drawingNo: true, drawingVersion: true }
      })
    ]);
    const drawingRevisionUpsertCount = new Set(
      importableDrawingRows
        .filter((row) => String(row.partCode || '').trim() && String(row.drawingNo || '').trim())
        .map((row) =>
          [row.partCode, row.drawingNo, String(row.drawingVersion || 'A')]
            .map((item) => String(item || '').trim().toLocaleLowerCase())
            .join('|')
        )
    ).size;
    const rowCount = materialRowCount + scopeRowCount + transformRowCount;
    const importableRowCount = materialImportableRowCount + scopeImportableRowCount + transformImportableRowCount;
    const rowLimit = options.rowLimit ?? 100;
    const rowOffset = options.rowOffset ?? 0;
    const shouldIncludeRows = options.includeRows !== false;
    const [previewRows, previewApplicabilityRows, previewTransformRows] = shouldIncludeRows
      ? await Promise.all([
          this.prisma.materialImportRow.findMany({
            where: { sessionId },
            include: { file: { select: { fileName: true, sheetName: true } } },
            orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }],
            skip: rowOffset,
            take: rowLimit
          }),
          this.prisma.materialApplicabilityImportRow.findMany({
            where: { sessionId },
            include: { file: { select: { fileName: true, sheetName: true } } },
            orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }],
            skip: rowOffset,
            take: rowLimit
          }),
          this.prisma.materialTransformImportRow.findMany({
            where: { sessionId },
            include: { file: { select: { fileName: true, sheetName: true } } },
            orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }],
            skip: rowOffset,
            take: rowLimit
          })
        ])
      : [[], [], []];
    const errorCount =
      Number(materialIssueAggregate._sum.errorCount ?? 0) +
      Number(scopeIssueAggregate._sum.errorCount ?? 0) +
      Number(transformIssueAggregate._sum.errorCount ?? 0);
    const warningCount =
      Number(materialIssueAggregate._sum.warningCount ?? 0) +
      Number(scopeIssueAggregate._sum.warningCount ?? 0) +
      Number(transformIssueAggregate._sum.warningCount ?? 0);
    const duplicateRowCount = Number(duplicateAggregate._sum.duplicateRowCount ?? 0);
    const previewToken = this.materialImportPreviewToken({
      sessionId,
      status: session.status,
      updatedAt: session.updatedAt,
      rowCount,
      errorCount,
      warningCount,
      duplicateRowCount,
      files: session.files
    });

    return {
      id: session.id,
      status: session.status,
      createdBy: session.createdBy || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      committedAt: session.committedAt || undefined,
      committedMaterialCodes: Array.isArray(session.committedMaterialCodes) ? session.committedMaterialCodes : [],
      previewToken,
      files: session.files.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        sheetName: file.sheetName,
        rowCount: file.rowCount,
        materialRowCount: file.materialRowCount,
        scopeRowCount: file.scopeRowCount,
        transformRowCount: file.transformRowCount,
        acceptedRowCount: file.acceptedRowCount,
        duplicateRowCount: file.duplicateRowCount,
        createdAt: file.createdAt
      })),
      summary: {
        fileCount: session.files.length,
        rowCount,
        importableRowCount,
        materialUpsertCount: importableCodes.length,
        drawingRevisionUpsertCount,
        materialRowCount,
        applicabilityRowCount: scopeRowCount,
        transformRowCount,
        applicabilityUpsertCount: scopeImportableRowCount,
        transformRuleUpsertCount: transformImportableRowCount,
        errorCount,
        warningCount,
        duplicateRowCount
      },
      rowPage: {
        offset: rowOffset,
        limit: rowLimit,
        loadedCount: previewRows.length + previewApplicabilityRows.length + previewTransformRows.length,
        totalCount: rowCount,
        hasMore:
          rowOffset + rowLimit < materialRowCount ||
          rowOffset + rowLimit < scopeRowCount ||
          rowOffset + rowLimit < transformRowCount
      },
      rows: previewRows.map((row) => ({
        id: row.id,
        sourceFileName: row.file.fileName,
        sourceSheetName: row.file.sheetName,
        sourceRowNo: row.sourceRowNo,
        partCode: row.partCode,
        partName: row.partName,
        unit: row.unit,
        partSpecification: row.partSpecification,
        defaultProcessRoute: row.defaultProcessRoute,
        drawingNo: row.drawingNo,
        drawingVersion: row.drawingVersion,
        drawingDate: this.formatDateOnly(row.drawingDate),
        drawingStatus: row.drawingStatus,
        partThickness: row.partThickness === null ? null : decimalToNumber(row.partThickness),
        projectModel: row.projectModel,
        stockAlertEnabled: row.stockAlertEnabled,
        stockAlertQuantity:
          row.stockAlertQuantity === null || row.stockAlertQuantity === undefined ? null : decimalToNumber(row.stockAlertQuantity),
        remark: row.remark,
        raw: (row.raw || {}) as Record<string, string | number | null>,
        issues: this.materialImportIssueArray(row.issues),
        errorCount: row.errorCount,
        warningCount: row.warningCount
      })),
      applicabilityRows: previewApplicabilityRows.map((row) => ({
        id: row.id,
        sourceFileName: row.file.fileName,
        sourceSheetName: row.file.sheetName,
        sourceRowNo: row.sourceRowNo,
        partCode: row.partCode,
        customerCode: row.customerCode,
        customerName: row.customerName,
        projectModel: row.projectModel,
        remark: row.remark,
        status: row.status,
        raw: (row.raw || {}) as Record<string, string | number | null>,
        issues: this.materialImportIssueArray(row.issues),
        errorCount: row.errorCount,
        warningCount: row.warningCount
      })),
      transformRows: previewTransformRows.map((row) => ({
        id: row.id,
        sourceFileName: row.file.fileName,
        sourceSheetName: row.file.sheetName,
        sourceRowNo: row.sourceRowNo,
        sourcePartCode: row.sourcePartCode,
        targetPartCode: row.targetPartCode,
        customerCode: row.customerCode,
        customerName: row.customerName,
        projectModel: row.projectModel,
        multiplier: row.multiplier === null ? null : decimalToNumber(row.multiplier),
        lossRate: row.lossRate === null ? null : decimalToNumber(row.lossRate),
        defaultProcessRoute: row.defaultProcessRoute,
        conversionDescription: row.conversionDescription,
        remark: row.remark,
        status: row.status,
        raw: (row.raw || {}) as Record<string, string | number | null>,
        issues: this.materialImportIssueArray(row.issues),
        errorCount: row.errorCount,
        warningCount: row.warningCount
      }))
    };
  }

  private materialImportPageOptions(query: GetMaterialImportSessionQueryDto = {}) {
    const rowLimit = Math.min(Math.max(Math.floor(Number(query.rowLimit || 100)), 1), 500);
    const rowOffset = Math.max(Math.floor(Number(query.rowOffset || 0)), 0);
    return { rowLimit, rowOffset, includeRows: true };
  }

  private materialImportPreviewToken(input: {
    sessionId: string;
    status: string;
    updatedAt: Date;
    rowCount: number;
    errorCount: number;
    warningCount: number;
    duplicateRowCount: number;
    files: Array<{
      id: string;
      fileHash: string;
      rowCount: number;
      materialRowCount: number;
      scopeRowCount: number;
      transformRowCount: number;
      acceptedRowCount: number;
      duplicateRowCount: number;
    }>;
  }) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          sessionId: input.sessionId,
          status: input.status,
          updatedAt: input.updatedAt.toISOString(),
          rowCount: input.rowCount,
          errorCount: input.errorCount,
          warningCount: input.warningCount,
          duplicateRowCount: input.duplicateRowCount,
          files: input.files.map((file) => [
            file.id,
            file.fileHash,
            file.rowCount,
            file.materialRowCount,
            file.scopeRowCount,
            file.transformRowCount,
            file.acceptedRowCount,
            file.duplicateRowCount
          ])
        })
      )
      .digest('hex');
  }

  private async buildMaterialImportPreviewTokenSnapshot(sessionId: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const session = await client.materialImportSession.findUnique({
      where: { id: sessionId },
      include: { files: { orderBy: { createdAt: 'asc' } } }
    });
    if (!session) {
      throw new NotFoundException('零件导入会话不存在');
    }
    const [
      materialRowCount,
      materialIssueAggregate,
      scopeRowCount,
      scopeIssueAggregate,
      transformRowCount,
      transformIssueAggregate,
      duplicateAggregate
    ] = await Promise.all([
      client.materialImportRow.count({ where: { sessionId } }),
      client.materialImportRow.aggregate({
        where: { sessionId },
        _sum: { errorCount: true, warningCount: true }
      }),
      client.materialApplicabilityImportRow.count({ where: { sessionId } }),
      client.materialApplicabilityImportRow.aggregate({
        where: { sessionId },
        _sum: { errorCount: true, warningCount: true }
      }),
      client.materialTransformImportRow.count({ where: { sessionId } }),
      client.materialTransformImportRow.aggregate({
        where: { sessionId },
        _sum: { errorCount: true, warningCount: true }
      }),
      client.materialImportFile.aggregate({
        where: { sessionId },
        _sum: { duplicateRowCount: true }
      })
    ]);
    const rowCount = materialRowCount + scopeRowCount + transformRowCount;
    const errorCount =
      Number(materialIssueAggregate._sum.errorCount ?? 0) +
      Number(scopeIssueAggregate._sum.errorCount ?? 0) +
      Number(transformIssueAggregate._sum.errorCount ?? 0);
    const warningCount =
      Number(materialIssueAggregate._sum.warningCount ?? 0) +
      Number(scopeIssueAggregate._sum.warningCount ?? 0) +
      Number(transformIssueAggregate._sum.warningCount ?? 0);
    const duplicateRowCount = Number(duplicateAggregate._sum.duplicateRowCount ?? 0);
    return {
      status: session.status,
      rowCount,
      errorCount,
      warningCount,
      duplicateRowCount,
      previewToken: this.materialImportPreviewToken({
        sessionId,
        status: session.status,
        updatedAt: session.updatedAt,
        rowCount,
        errorCount,
        warningCount,
        duplicateRowCount,
        files: session.files
      })
    };
  }

  private materialImportIssueArray(value: Prisma.JsonValue | MaterialImportIssue[] | null | undefined): MaterialImportIssue[] {
    return Array.isArray(value) ? (value as MaterialImportIssue[]) : [];
  }

  private countMaterialImportIssues(issues: MaterialImportIssue[]) {
    return {
      errorCount: issues.filter((issue) => issue.severity === 'ERROR').length,
      warningCount: issues.filter((issue) => issue.severity === 'WARNING').length
    };
  }

  private pushMaterialImportIssue(row: ParsedMaterialImportIssueRow, issue: MaterialImportIssue) {
    if (row.issues.some((current) => current.severity === issue.severity && current.code === issue.code && current.message === issue.message)) {
      return;
    }
    row.issues.push(issue);
    const counts = this.countMaterialImportIssues(row.issues);
    row.errorCount = counts.errorCount;
    row.warningCount = counts.warningCount;
  }

  private async refreshMaterialImportSessionIssues(sessionId: string) {
    const session = await this.prisma.materialImportSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true }
    });
    if (!session || session.status !== 'DRAFT') {
      return;
    }

    const [materialRows, applicabilityRows, transformRows] = await Promise.all([
      this.prisma.materialImportRow.findMany({ where: { sessionId }, orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }] }),
      this.prisma.materialApplicabilityImportRow.findMany({ where: { sessionId }, orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }] }),
      this.prisma.materialTransformImportRow.findMany({ where: { sessionId }, orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }] })
    ]);
    const parsed = {
      rows: materialRows.map((row) => this.toMaterialImportSessionMaterialRow(row)),
      applicabilityRows: applicabilityRows.map((row) => this.toMaterialImportSessionApplicabilityRow(row)),
      transformRows: transformRows.map((row) => this.toMaterialImportSessionTransformRow(row))
    };

    // 多文件导入会话必须在每次文件变化后重新合并校验，避免拆分上传绕过零件、图纸、适用范围和来源关系冲突。
    this.applyMaterialImportDuplicateConflicts(parsed.rows);
    this.applyMaterialDrawingImportDuplicateConflicts(parsed.rows);
    this.applyMaterialApplicabilityImportDuplicateConflicts(parsed.applicabilityRows);
    this.applyMaterialTransformImportDuplicateConflicts(parsed.transformRows);
    await this.enrichMaterialImportWorkbookRows(parsed);
    await this.persistMaterialImportSessionIssues(parsed);
  }

  private materialImportIssuesWithoutCodes(value: Prisma.JsonValue | MaterialImportIssue[] | null | undefined, codes: Set<string>) {
    return this.materialImportIssueArray(value).filter((issue) => !codes.has(issue.code));
  }

  private resetMaterialImportIssueCounts<T extends ParsedMaterialImportIssueRow>(row: T) {
    const counts = this.countMaterialImportIssues(row.issues);
    row.errorCount = counts.errorCount;
    row.warningCount = counts.warningCount;
    return row;
  }

  private toMaterialImportSessionMaterialRow(row: Prisma.MaterialImportRowGetPayload<object>): ParsedMaterialImportRow & { id: string } {
    return this.resetMaterialImportIssueCounts({
      id: row.id,
      sourceRowNo: row.sourceRowNo,
      partCode: row.partCode,
      partName: row.partName,
      unit: row.unit,
      partSpecification: row.partSpecification,
      defaultProcessRoute: row.defaultProcessRoute,
      drawingNo: row.drawingNo,
      drawingVersion: row.drawingVersion,
      drawingDate: row.drawingDate,
      drawingStatus: row.drawingStatus,
      partThickness: row.partThickness === null ? null : decimalToNumber(row.partThickness),
      projectModel: row.projectModel,
      stockAlertEnabled: row.stockAlertEnabled,
      stockAlertQuantity: row.stockAlertQuantity === null ? null : decimalToNumber(row.stockAlertQuantity),
      remark: row.remark,
      raw: (row.raw || {}) as Record<string, string | number | null>,
      rowHash: row.rowHash,
      issues: this.materialImportIssuesWithoutCodes(row.issues, materialImportSessionMaterialIssueCodes),
      errorCount: 0,
      warningCount: 0
    });
  }

  private toMaterialImportSessionApplicabilityRow(
    row: Prisma.MaterialApplicabilityImportRowGetPayload<object>
  ): ParsedMaterialApplicabilityImportRow & { id: string } {
    return this.resetMaterialImportIssueCounts({
      id: row.id,
      sourceRowNo: row.sourceRowNo,
      partCode: row.partCode,
      customerCode: row.customerCode,
      customerName: row.customerName,
      projectModel: row.projectModel,
      remark: row.remark,
      status: row.status,
      raw: (row.raw || {}) as Record<string, string | number | null>,
      rowHash: row.rowHash,
      issues: this.materialImportIssuesWithoutCodes(row.issues, materialImportSessionApplicabilityIssueCodes),
      errorCount: 0,
      warningCount: 0
    });
  }

  private toMaterialImportSessionTransformRow(
    row: Prisma.MaterialTransformImportRowGetPayload<object>
  ): ParsedMaterialTransformImportRow & { id: string } {
    return this.resetMaterialImportIssueCounts({
      id: row.id,
      sourceRowNo: row.sourceRowNo,
      sourcePartCode: row.sourcePartCode,
      targetPartCode: row.targetPartCode,
      customerCode: row.customerCode,
      customerName: row.customerName,
      projectModel: row.projectModel,
      multiplier: row.multiplier === null ? null : decimalToNumber(row.multiplier),
      lossRate: row.lossRate === null ? null : decimalToNumber(row.lossRate),
      defaultProcessRoute: row.defaultProcessRoute,
      conversionDescription: row.conversionDescription,
      remark: row.remark,
      status: row.status,
      raw: (row.raw || {}) as Record<string, string | number | null>,
      rowHash: row.rowHash,
      issues: this.materialImportIssuesWithoutCodes(row.issues, materialImportSessionTransformIssueCodes),
      errorCount: 0,
      warningCount: 0
    });
  }

  private async persistMaterialImportSessionIssues(parsed: {
    rows: Array<ParsedMaterialImportRow & { id: string }>;
    applicabilityRows: Array<ParsedMaterialApplicabilityImportRow & { id: string }>;
    transformRows: Array<ParsedMaterialTransformImportRow & { id: string }>;
  }) {
    const operations: Prisma.PrismaPromise<unknown>[] = [
      ...parsed.rows.map((row) =>
        this.prisma.materialImportRow.update({
          where: { id: row.id },
          data: { issues: row.issues, errorCount: row.errorCount, warningCount: row.warningCount }
        })
      ),
      ...parsed.applicabilityRows.map((row) =>
        this.prisma.materialApplicabilityImportRow.update({
          where: { id: row.id },
          data: { issues: row.issues, errorCount: row.errorCount, warningCount: row.warningCount }
        })
      ),
      ...parsed.transformRows.map((row) =>
        this.prisma.materialTransformImportRow.update({
          where: { id: row.id },
          data: { issues: row.issues, errorCount: row.errorCount, warningCount: row.warningCount }
        })
      )
    ];
    for (let index = 0; index < operations.length; index += 100) {
      await this.prisma.$transaction(operations.slice(index, index + 100));
    }
  }

  private async parseMaterialImportWorkbook(filePath: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    if (workbook.worksheets.length === 0) {
      throw new BadRequestException('Excel 中没有可读取的工作表');
    }

    const materialWorksheet =
      workbook.getWorksheet(materialImportSheetName) ||
      workbook.worksheets.find((worksheet) => this.findMaterialImportHeaderRow(worksheet, materialImportRequiredHeaders));
    const scopeWorksheet = workbook.getWorksheet(materialApplicabilityImportSheetName);
    const transformWorksheet = workbook.getWorksheet(materialTransformImportSheetName);

    const rows = materialWorksheet ? this.parseMaterialImportRowsFromWorksheet(materialWorksheet) : [];
    const applicabilityRows = scopeWorksheet
      ? this.parseMaterialApplicabilityImportRowsFromWorksheet(scopeWorksheet)
      : [];
    const transformRows = transformWorksheet
      ? this.parseMaterialTransformImportRowsFromWorksheet(transformWorksheet)
      : [];

    await this.validateMaterialImportDefaultProcessRoutes(rows);
    this.applyMaterialImportDuplicateConflicts(rows);
    this.applyMaterialDrawingImportDuplicateConflicts(rows);
    this.applyMaterialApplicabilityImportDuplicateConflicts(applicabilityRows);
    this.applyMaterialTransformImportDuplicateConflicts(transformRows);

    const sheetName = [
      rows.length ? materialWorksheet?.name : '',
      applicabilityRows.length ? scopeWorksheet?.name : '',
      transformRows.length ? transformWorksheet?.name : ''
    ]
      .filter(Boolean)
      .join(' / ');
    return { sheetName: sheetName || materialWorksheet?.name || workbook.worksheets[0].name, rows, applicabilityRows, transformRows };
  }

  private parseMaterialImportRowsFromWorksheet(worksheet: ExcelJS.Worksheet) {
    const headerRowNo = this.findMaterialImportHeaderRow(worksheet, materialImportRequiredHeaders);
    if (!headerRowNo) {
      throw new BadRequestException(`没有找到零件导入表头，必须包含：${materialImportRequiredHeaders.join('、')}`);
    }
    const { columns, labels } = this.mapMaterialImportColumns(
      worksheet.getRow(headerRowNo),
      materialImportRequiredHeaders,
      materialImportHeaderAliases
    );
    const rows: ParsedMaterialImportRow[] = [];

    for (let rowNo = headerRowNo + 1; rowNo <= worksheet.rowCount; rowNo += 1) {
      const row = worksheet.getRow(rowNo);
      const raw = this.rawMaterialImportRow(row, columns, labels);
      if (Object.values(raw).every((value) => String(value ?? '').trim() === '')) {
        continue;
      }
      const stockAlertEnabledText = this.materialImportCellText(row, columns.stockAlertEnabled);
      const stockAlertQuantityText = this.materialImportCellText(row, columns.stockAlertQuantity);
      const parsedStockAlertEnabled = this.parseMaterialImportBoolean(stockAlertEnabledText);
      const parsedRow: ParsedMaterialImportRow = {
        sourceRowNo: rowNo,
        partCode: this.materialImportCellText(row, columns.partCode),
        partName: this.materialImportCellText(row, columns.partName),
        unit: this.materialImportCellText(row, columns.unit),
        partSpecification: this.materialImportOptionalCellText(row, columns.partSpecification),
        defaultProcessRoute: this.materialImportOptionalCellText(row, columns.defaultProcessRoute),
        drawingNo: this.materialImportOptionalCellText(row, columns.drawingNo),
        drawingVersion: this.materialImportOptionalCellText(row, columns.drawingVersion),
        drawingDate: this.materialImportCellDate(row, columns.drawingDate),
        drawingStatus: this.materialImportOptionalCellText(row, columns.drawingStatus),
        partThickness: this.materialImportCellNumber(row, columns.partThickness),
        projectModel: this.materialImportOptionalCellText(row, columns.projectModel),
        stockAlertEnabled: parsedStockAlertEnabled,
        stockAlertQuantity: this.parseMaterialImportNumberText(stockAlertQuantityText),
        remark: this.materialImportOptionalCellText(row, columns.remark),
        raw,
        rowHash: '',
        issues: [],
        errorCount: 0,
        warningCount: 0
      };
      parsedRow.issues = this.buildMaterialImportRowIssues(parsedRow, stockAlertEnabledText, stockAlertQuantityText, parsedStockAlertEnabled);
      const counts = this.countMaterialImportIssues(parsedRow.issues);
      parsedRow.errorCount = counts.errorCount;
      parsedRow.warningCount = counts.warningCount;
      parsedRow.rowHash = this.hashMaterialImportRow(parsedRow);
      rows.push(parsedRow);
    }

    return rows;
  }

  private parseMaterialApplicabilityImportRowsFromWorksheet(worksheet: ExcelJS.Worksheet) {
    const headerRowNo = this.findMaterialImportHeaderRow(worksheet, materialApplicabilityImportRequiredHeaders);
    if (!headerRowNo) {
      throw new BadRequestException(`没有找到适用范围表头，必须包含：${materialApplicabilityImportRequiredHeaders.join('、')}`);
    }
    const { columns, labels } = this.mapMaterialImportColumns(
      worksheet.getRow(headerRowNo),
      materialApplicabilityImportRequiredHeaders,
      materialApplicabilityImportHeaderAliases
    );
    const rows: ParsedMaterialApplicabilityImportRow[] = [];

    for (let rowNo = headerRowNo + 1; rowNo <= worksheet.rowCount; rowNo += 1) {
      const row = worksheet.getRow(rowNo);
      const raw = this.rawMaterialImportRow(row, columns, labels);
      if (Object.values(raw).every((value) => String(value ?? '').trim() === '')) {
        continue;
      }
      const statusText = this.materialImportCellText(row, columns.status);
      const parsedStatus = this.parseMaterialImportStatus(statusText);
      const parsedRow: ParsedMaterialApplicabilityImportRow = {
        sourceRowNo: rowNo,
        partCode: this.materialImportCellText(row, columns.partCode),
        customerCode: this.materialImportOptionalCellText(row, columns.customerCode),
        customerName: this.materialImportOptionalCellText(row, columns.customerName),
        projectModel: this.materialImportOptionalCellText(row, columns.projectModel),
        remark: this.materialImportOptionalCellText(row, columns.remark),
        status: parsedStatus || 'ENABLED',
        raw,
        rowHash: '',
        issues: [],
        errorCount: 0,
        warningCount: 0
      };
      parsedRow.issues = this.buildMaterialApplicabilityImportRowIssues(parsedRow, statusText, parsedStatus);
      const counts = this.countMaterialImportIssues(parsedRow.issues);
      parsedRow.errorCount = counts.errorCount;
      parsedRow.warningCount = counts.warningCount;
      parsedRow.rowHash = this.hashMaterialApplicabilityImportRow(parsedRow);
      rows.push(parsedRow);
    }

    return rows;
  }

  private parseMaterialTransformImportRowsFromWorksheet(worksheet: ExcelJS.Worksheet) {
    const headerRowNo = this.findMaterialImportHeaderRow(worksheet, materialTransformImportRequiredHeaders);
    if (!headerRowNo) {
      throw new BadRequestException(`没有找到来源加工关系表头，必须包含：${materialTransformImportRequiredHeaders.join('、')}`);
    }
    const { columns, labels } = this.mapMaterialImportColumns(
      worksheet.getRow(headerRowNo),
      materialTransformImportRequiredHeaders,
      materialTransformImportHeaderAliases
    );
    const rows: ParsedMaterialTransformImportRow[] = [];

    for (let rowNo = headerRowNo + 1; rowNo <= worksheet.rowCount; rowNo += 1) {
      const row = worksheet.getRow(rowNo);
      const raw = this.rawMaterialImportRow(row, columns, labels);
      if (Object.values(raw).every((value) => String(value ?? '').trim() === '')) {
        continue;
      }
      const statusText = this.materialImportCellText(row, columns.status);
      const parsedStatus = this.parseMaterialImportStatus(statusText);
      const parsedRow: ParsedMaterialTransformImportRow = {
        sourceRowNo: rowNo,
        sourcePartCode: this.materialImportCellText(row, columns.sourcePartCode),
        targetPartCode: this.materialImportCellText(row, columns.targetPartCode),
        customerCode: this.materialImportOptionalCellText(row, columns.customerCode),
        customerName: this.materialImportOptionalCellText(row, columns.customerName),
        projectModel: this.materialImportOptionalCellText(row, columns.projectModel),
        multiplier: this.materialImportCellNumber(row, columns.multiplier),
        lossRate: this.materialImportCellRatio(row, columns.lossRate),
        defaultProcessRoute: this.materialImportOptionalCellText(row, columns.defaultProcessRoute),
        conversionDescription: this.materialImportOptionalCellText(row, columns.conversionDescription),
        remark: this.materialImportOptionalCellText(row, columns.remark),
        status: parsedStatus || 'ENABLED',
        raw,
        rowHash: '',
        issues: [],
        errorCount: 0,
        warningCount: 0
      };
      parsedRow.issues = this.buildMaterialTransformImportRowIssues(parsedRow, statusText, parsedStatus);
      const counts = this.countMaterialImportIssues(parsedRow.issues);
      parsedRow.errorCount = counts.errorCount;
      parsedRow.warningCount = counts.warningCount;
      parsedRow.rowHash = this.hashMaterialTransformImportRow(parsedRow);
      rows.push(parsedRow);
    }

    return rows;
  }

  private findMaterialImportHeaderRow(worksheet: ExcelJS.Worksheet, requiredHeaders: string[]) {
    const maxRow = Math.min(worksheet.rowCount, 30);
    for (let rowNo = 1; rowNo <= maxRow; rowNo += 1) {
      const row = worksheet.getRow(rowNo);
      const headers = new Set<string>();
      row.eachCell((cell) => headers.add(this.normalizeMaterialImportHeader(this.materialImportCellValueText(cell.value))));
      const hasAllRequired = requiredHeaders.every((requiredHeader) =>
        headers.has(this.normalizeMaterialImportHeader(requiredHeader))
      );
      if (hasAllRequired) {
        return rowNo;
      }
    }
    return 0;
  }

  private mapMaterialImportColumns(row: ExcelJS.Row, requiredHeaders: string[], headerAliases: Record<string, string[]>) {
    const headerToColumn = new Map<string, number>();
    const labels: Record<string, string> = {};
    row.eachCell((cell, column) => {
      const text = this.materialImportCellValueText(cell.value);
      if (!text) {
        return;
      }
      headerToColumn.set(this.normalizeMaterialImportHeader(text), column);
    });
    const columns: Record<string, number | undefined> = {};
    for (const [field, aliases] of Object.entries(headerAliases)) {
      const matchedAlias = aliases.find((alias) => headerToColumn.has(this.normalizeMaterialImportHeader(alias)));
      if (matchedAlias) {
        const normalizedAlias = this.normalizeMaterialImportHeader(matchedAlias);
        columns[field] = headerToColumn.get(normalizedAlias);
        labels[field] = matchedAlias;
      }
    }
    for (const requiredHeader of requiredHeaders) {
      const hasColumn = Object.values(headerAliases).some(
        (aliases) => aliases.includes(requiredHeader) && columns[Object.keys(headerAliases).find((key) => headerAliases[key].includes(requiredHeader)) || '']
      );
      if (!hasColumn && !headerToColumn.has(this.normalizeMaterialImportHeader(requiredHeader))) {
        throw new BadRequestException(`缺少必填列：${requiredHeader}`);
      }
    }
    return { columns: columns as Record<string, number>, labels };
  }

  private rawMaterialImportRow(row: ExcelJS.Row, columns: Record<string, number>, labels: Record<string, string>) {
    return Object.entries(columns).reduce<Record<string, string | number | null>>((raw, [field, column]) => {
      if (!column) {
        return raw;
      }
      raw[labels[field] || field] = this.materialImportCellText(row, column);
      return raw;
    }, {});
  }

  private buildMaterialImportRowIssues(
    row: ParsedMaterialImportRow,
    stockAlertEnabledText: string,
    stockAlertQuantityText: string,
    parsedStockAlertEnabled: boolean | null
  ): MaterialImportIssue[] {
    const issues: MaterialImportIssue[] = [];
    if (!row.partCode) {
      issues.push({ severity: 'ERROR', code: 'REQUIRED_PART_CODE', message: '零件编码不能为空' });
    }
    if (!row.partName) {
      issues.push({ severity: 'ERROR', code: 'REQUIRED_PART_NAME', message: '零件名称不能为空' });
    }
    if (!row.unit) {
      issues.push({ severity: 'ERROR', code: 'REQUIRED_UNIT', message: '单位不能为空' });
    }
    if (stockAlertEnabledText && parsedStockAlertEnabled === null) {
      issues.push({
        severity: 'ERROR',
        code: 'INVALID_STOCK_ALERT_ENABLED',
        message: '库存报警只能填写启用、停用、是、否、ENABLED 或 DISABLED'
      });
    }
    if (stockAlertQuantityText && row.stockAlertQuantity === null) {
      issues.push({ severity: 'ERROR', code: 'INVALID_STOCK_ALERT_QUANTITY', message: '最小库存必须是有效数字' });
    }
    if (row.partThickness !== null && row.partThickness !== undefined && row.partThickness < 0) {
      issues.push({ severity: 'ERROR', code: 'INVALID_PART_THICKNESS', message: '厚度不能小于 0' });
    }
    if (row.stockAlertQuantity !== null && row.stockAlertQuantity !== undefined && row.stockAlertQuantity < 0) {
      issues.push({ severity: 'ERROR', code: 'INVALID_STOCK_ALERT_QUANTITY', message: '最小库存不能小于 0' });
    }
    if (row.stockAlertEnabled === true && !stockAlertQuantityText) {
      issues.push({ severity: 'ERROR', code: 'STOCK_ALERT_QUANTITY_REQUIRED', message: '启用库存报警时必须填写最小库存数量' });
    }
    if (row.stockAlertEnabled === false && row.stockAlertQuantity !== null && row.stockAlertQuantity !== undefined) {
      issues.push({
        severity: 'WARNING',
        code: 'STOCK_ALERT_QUANTITY_IGNORED',
        message: '库存报警已停用，最小库存数量提交后会清空'
      });
    }
    if (row.stockAlertEnabled === null && row.stockAlertQuantity !== null && row.stockAlertQuantity !== undefined) {
      issues.push({
        severity: 'WARNING',
        code: 'STOCK_ALERT_QUANTITY_WITHOUT_ENABLED',
        message: '只填写最小库存不会启用库存报警，提交后不会改动现有库存报警设置'
      });
    }
    return issues;
  }

  private buildMaterialApplicabilityImportRowIssues(
    row: ParsedMaterialApplicabilityImportRow,
    statusText: string,
    parsedStatus: CommonStatus | null
  ): MaterialImportIssue[] {
    const issues: MaterialImportIssue[] = [];
    if (!row.partCode) {
      issues.push({ severity: 'ERROR', code: 'REQUIRED_PART_CODE', message: '零件编码不能为空' });
    }
    if (statusText && !parsedStatus) {
      issues.push({ severity: 'ERROR', code: 'INVALID_STATUS', message: '状态只能填写启用、停用、ENABLED 或 DISABLED' });
    }
    return issues;
  }

  private buildMaterialTransformImportRowIssues(
    row: ParsedMaterialTransformImportRow,
    statusText: string,
    parsedStatus: CommonStatus | null
  ): MaterialImportIssue[] {
    const issues: MaterialImportIssue[] = [];
    if (!row.sourcePartCode) {
      issues.push({ severity: 'ERROR', code: 'REQUIRED_SOURCE_PART_CODE', message: '来源零件编码不能为空' });
    }
    if (!row.targetPartCode) {
      issues.push({ severity: 'ERROR', code: 'REQUIRED_TARGET_PART_CODE', message: '目标零件编码不能为空' });
    }
    if (row.sourcePartCode && row.targetPartCode && row.sourcePartCode.trim().toLocaleLowerCase() === row.targetPartCode.trim().toLocaleLowerCase()) {
      issues.push({ severity: 'ERROR', code: 'SAME_SOURCE_TARGET', message: '来源零件和目标零件不能相同' });
    }
    if (row.multiplier !== null && row.multiplier !== undefined && row.multiplier <= 0) {
      issues.push({ severity: 'ERROR', code: 'INVALID_MULTIPLIER', message: '倍率必须大于 0' });
    }
    if (row.lossRate !== null && row.lossRate !== undefined && row.lossRate < 0) {
      issues.push({ severity: 'ERROR', code: 'INVALID_LOSS_RATE', message: '损耗率不能小于 0' });
    }
    if (statusText && !parsedStatus) {
      issues.push({ severity: 'ERROR', code: 'INVALID_STATUS', message: '状态只能填写启用、停用、ENABLED 或 DISABLED' });
    }
    return issues;
  }

  private async validateMaterialImportDefaultProcessRoutes(rows: ParsedMaterialImportRow[]) {
    for (const row of rows) {
      const processNames = this.splitDefaultProcessRoute(row.defaultProcessRoute || '');
      if (processNames.length === 0) {
        row.defaultProcessRoute = null;
        row.rowHash = this.hashMaterialImportRow(row);
        continue;
      }
      try {
        // 零件库导入的默认工艺只作为下单初始建议，预览阶段必须先核对标准工序。
        await this.processDefinitionsService.ensureActiveNames(processNames);
        row.defaultProcessRoute = processNames.join('、');
      } catch (error) {
        this.pushMaterialImportIssue(row, {
          severity: 'ERROR',
          code: 'INVALID_DEFAULT_PROCESS_ROUTE',
          message: error instanceof Error ? error.message : '默认工艺必须来自启用的标准工序'
        });
      }
      const counts = this.countMaterialImportIssues(row.issues);
      row.errorCount = counts.errorCount;
      row.warningCount = counts.warningCount;
      row.rowHash = this.hashMaterialImportRow(row);
    }
  }

  private applyMaterialImportDuplicateConflicts(rows: ParsedMaterialImportRow[]) {
    const rowsByCode = new Map<string, ParsedMaterialImportRow[]>();
    for (const row of rows) {
      const key = row.partCode.trim().toLocaleLowerCase();
      if (!key) {
        continue;
      }
      rowsByCode.set(key, [...(rowsByCode.get(key) || []), row]);
    }
    for (const sameCodeRows of rowsByCode.values()) {
      const signatures = new Set(sameCodeRows.map((row) => this.materialImportImportIdentitySignature(row)));
      if (signatures.size > 1) {
        for (const row of sameCodeRows) {
          this.pushMaterialImportIssue(row, {
            severity: 'ERROR',
            code: 'DUPLICATE_PART_CONFLICT',
            message: '同一导入会话内相同零件编码的名称、单位、规格、厚度或项目型号不一致'
          });
        }
      }

      const stockAlertSignatures = new Set(
        sameCodeRows.map((row) => this.materialImportExplicitStockAlertSignature(row)).filter(Boolean)
      );
      if (stockAlertSignatures.size > 1) {
        for (const row of sameCodeRows) {
          this.pushMaterialImportIssue(row, {
            severity: 'ERROR',
            code: 'DUPLICATE_STOCK_ALERT_CONFLICT',
            message: '同一导入会话内相同零件编码的库存报警设置不一致'
          });
        }
      }

      const defaultProcessRouteSignatures = new Set(
        sameCodeRows.map((row) => this.materialImportExplicitDefaultProcessRouteSignature(row)).filter(Boolean)
      );
      if (defaultProcessRouteSignatures.size > 1) {
        for (const row of sameCodeRows) {
          this.pushMaterialImportIssue(row, {
            severity: 'ERROR',
            code: 'DUPLICATE_DEFAULT_PROCESS_ROUTE_CONFLICT',
            message: '同一导入会话内相同零件编码的默认工艺不一致'
          });
        }
      }
    }
  }

  private applyMaterialDrawingImportDuplicateConflicts(rows: ParsedMaterialImportRow[]) {
    const rowsByDrawing = new Map<string, ParsedMaterialImportRow[]>();
    for (const row of rows) {
      const partCode = row.partCode.trim().toLocaleLowerCase();
      const drawingNo = String(row.drawingNo || '').trim().toLocaleLowerCase();
      if (!partCode || !drawingNo) {
        continue;
      }
      const drawingVersion = String(row.drawingVersion || 'A').trim().toLocaleLowerCase() || 'a';
      const key = [partCode, drawingNo, drawingVersion].join('|');
      rowsByDrawing.set(key, [...(rowsByDrawing.get(key) || []), row]);
    }
    for (const sameDrawingRows of rowsByDrawing.values()) {
      const signatures = new Set(sameDrawingRows.map((row) => this.materialImportDrawingRevisionSignature(row)));
      if (signatures.size <= 1) {
        continue;
      }
      for (const row of sameDrawingRows) {
        this.pushMaterialImportIssue(row, {
          severity: 'ERROR',
          code: 'DUPLICATE_DRAWING_REVISION_CONFLICT',
          message: '同一导入会话内相同零件编码、图号和图纸版本的图纸日期、状态或备注不一致'
        });
      }
    }
  }

  private applyMaterialApplicabilityImportDuplicateConflicts(rows: ParsedMaterialApplicabilityImportRow[]) {
    const rowsByScope = new Map<string, ParsedMaterialApplicabilityImportRow[]>();
    for (const row of rows) {
      const key = [
        row.partCode.trim().toLocaleLowerCase(),
        String(row.customerCode || row.customerName || 'ALL').trim().toLocaleLowerCase(),
        this.normalizeMaterialScopeKey(row.projectModel)
      ].join('|');
      if (!row.partCode.trim()) {
        continue;
      }
      rowsByScope.set(key, [...(rowsByScope.get(key) || []), row]);
    }
    for (const sameScopeRows of rowsByScope.values()) {
      const signatures = new Set(sameScopeRows.map((row) => this.hashMaterialApplicabilityImportRow(row)));
      if (signatures.size <= 1) {
        continue;
      }
      for (const row of sameScopeRows) {
        this.pushMaterialImportIssue(row, {
          severity: 'ERROR',
          code: 'DUPLICATE_SCOPE_CONFLICT',
          message: '同一零件、客户和机型/项目适用范围在导入会话内存在不一致信息'
        });
      }
    }
  }

  private applyMaterialTransformImportDuplicateConflicts(rows: ParsedMaterialTransformImportRow[]) {
    const rowsByScope = new Map<string, ParsedMaterialTransformImportRow[]>();
    for (const row of rows) {
      const key = [
        row.sourcePartCode.trim().toLocaleLowerCase(),
        row.targetPartCode.trim().toLocaleLowerCase(),
        String(row.customerCode || row.customerName || 'ALL').trim().toLocaleLowerCase(),
        this.normalizeMaterialScopeKey(row.projectModel)
      ].join('|');
      if (!row.sourcePartCode.trim() || !row.targetPartCode.trim()) {
        continue;
      }
      rowsByScope.set(key, [...(rowsByScope.get(key) || []), row]);
    }
    for (const sameScopeRows of rowsByScope.values()) {
      const signatures = new Set(sameScopeRows.map((row) => this.hashMaterialTransformImportRow(row)));
      if (signatures.size <= 1) {
        continue;
      }
      for (const row of sameScopeRows) {
        this.pushMaterialImportIssue(row, {
          severity: 'ERROR',
          code: 'DUPLICATE_TRANSFORM_CONFLICT',
          message: '同一来源、目标、客户和机型/项目加工关系在导入会话内存在不一致信息'
        });
      }
    }
  }

  private async enrichMaterialImportWorkbookRows(parsed: {
    rows: ParsedMaterialImportRow[];
    applicabilityRows: ParsedMaterialApplicabilityImportRow[];
    transformRows: ParsedMaterialTransformImportRow[];
  }) {
    await this.enrichMaterialImportRows(parsed.rows);
    await this.enrichMaterialRelationImportRows(parsed);
  }

  private async enrichMaterialImportRows(rows: ParsedMaterialImportRow[]) {
    const partCodes = [...new Set(rows.map((row) => row.partCode.trim()).filter(Boolean))];
    if (partCodes.length === 0) {
      return;
    }
    const existingMaterials = await this.findExistingMaterialsByPartCodes(partCodes);
    const existingByCode = new Map(existingMaterials.map((material) => [material.partCode.trim().toLocaleLowerCase(), material]));
    const existingMaterialCodeById = new Map(existingMaterials.map((material) => [material.id, material.partCode.trim().toLocaleLowerCase()]));
    const existingDrawingRevisions =
      existingMaterials.length > 0
        ? await this.prisma.materialDrawingRevision.findMany({
            where: { materialId: { in: existingMaterials.map((material) => material.id) } },
            select: {
              materialId: true,
              drawingNo: true,
              drawingVersion: true,
              drawingDate: true,
              drawingStatus: true,
              remark: true
            }
          })
        : [];
    const existingDrawingByKey = new Map(
      existingDrawingRevisions.map((revision) => {
        const partCode = existingMaterialCodeById.get(revision.materialId) || '';
        return [this.materialImportDrawingRevisionKey(partCode, revision.drawingNo, revision.drawingVersion), revision] as const;
      })
    );
    const historyRows = await this.findOrderLineHistoryByPartCodes(partCodes);
    const historyByCode = new Map<string, typeof historyRows>();
    for (const line of historyRows) {
      const key = line.partCode.trim().toLocaleLowerCase();
      historyByCode.set(key, [...(historyByCode.get(key) || []), line]);
    }

    for (const row of rows) {
      const key = row.partCode.trim().toLocaleLowerCase();
      if (!key) {
        continue;
      }
      const existing = existingByCode.get(key);
      if (
        existing &&
        this.materialImportIdentitySignature(existing) !== this.materialImportIdentitySignature(row)
      ) {
        this.pushMaterialImportIssue(row, {
          severity: 'WARNING',
          code: 'EXISTING_MATERIAL_DIFFERENT',
          message: '系统零件库中已有相同编码，但名称、单位或规格与本次导入不完全一致，提交后会更新零件库'
        });
      }
      const history = historyByCode.get(key) || [];
      if (history.some((line) => this.materialImportHistoryIdentitySignature(line) !== this.materialImportHistoryIdentitySignature(row))) {
        this.pushMaterialImportIssue(row, {
          severity: 'WARNING',
          code: 'ORDER_HISTORY_DIFFERENT',
          message: '历史订单中相同零件编码存在不同图号、名称、规格或厚度，请提交前确认'
        });
      }
      const existingDrawing = existingDrawingByKey.get(
        this.materialImportDrawingRevisionKey(row.partCode, row.drawingNo || '', row.drawingVersion || 'A')
      );
      if (existingDrawing && this.materialImportDrawingRevisionSignature(existingDrawing) !== this.materialImportDrawingRevisionSignature(row)) {
        this.pushMaterialImportIssue(row, {
          severity: 'WARNING',
          code: 'EXISTING_DRAWING_REVISION_DIFFERENT',
          message: '系统已存在相同零件编码、图号和图纸版本，但图纸日期、状态或备注与本次导入不一致，提交后会按本次导入更新图纸版本'
        });
      }
    }
  }

  private async enrichMaterialRelationImportRows(parsed: {
    rows: ParsedMaterialImportRow[];
    applicabilityRows: ParsedMaterialApplicabilityImportRow[];
    transformRows: ParsedMaterialTransformImportRow[];
  }) {
    const importedMaterialCodes = new Set(parsed.rows.map((row) => row.partCode.trim().toLocaleLowerCase()).filter(Boolean));
    const relationMaterialCodes = [
      ...parsed.applicabilityRows.map((row) => row.partCode),
      ...parsed.transformRows.flatMap((row) => [row.sourcePartCode, row.targetPartCode])
    ];
    const existingMaterials = await this.findExistingMaterialsByPartCodes(relationMaterialCodes);
    const existingMaterialCodes = new Set(existingMaterials.map((material) => material.partCode.trim().toLocaleLowerCase()));
    const materialExistsInImportOrDb = (partCode: string) => {
      const key = partCode.trim().toLocaleLowerCase();
      return Boolean(key && (importedMaterialCodes.has(key) || existingMaterialCodes.has(key)));
    };
    const customerLookup = await this.findMaterialImportCustomers([...parsed.applicabilityRows, ...parsed.transformRows]);

    for (const row of parsed.applicabilityRows) {
      if (row.partCode && !materialExistsInImportOrDb(row.partCode)) {
        this.pushMaterialImportIssue(row, {
          severity: 'ERROR',
          code: 'UNKNOWN_PART_CODE',
          message: '适用范围引用的零件编码在系统和本次零件基础库导入中都不存在'
        });
      }
      const customerIssue = this.materialImportCustomerValidationMessage(row, customerLookup);
      if (customerIssue) {
        this.pushMaterialImportIssue(row, {
          severity: 'ERROR',
          code: 'INVALID_CUSTOMER',
          message: customerIssue
        });
      }
    }

    for (const row of parsed.transformRows) {
      if (row.sourcePartCode && !materialExistsInImportOrDb(row.sourcePartCode)) {
        this.pushMaterialImportIssue(row, {
          severity: 'ERROR',
          code: 'UNKNOWN_SOURCE_PART_CODE',
          message: '来源加工关系引用的来源零件编码在系统和本次零件基础库导入中都不存在'
        });
      }
      if (row.targetPartCode && !materialExistsInImportOrDb(row.targetPartCode)) {
        this.pushMaterialImportIssue(row, {
          severity: 'ERROR',
          code: 'UNKNOWN_TARGET_PART_CODE',
          message: '来源加工关系引用的目标零件编码在系统和本次零件基础库导入中都不存在'
        });
      }
      const customerIssue = this.materialImportCustomerValidationMessage(row, customerLookup);
      if (customerIssue) {
        this.pushMaterialImportIssue(row, {
          severity: 'ERROR',
          code: 'INVALID_CUSTOMER',
          message: customerIssue
        });
      }
      await this.validateMaterialTransformImportDefaultProcessRoute(row);
    }
  }

  private async validateMaterialTransformImportDefaultProcessRoute(row: ParsedMaterialTransformImportRow) {
    const processNames = this.splitDefaultProcessRoute(row.defaultProcessRoute || '');
    if (processNames.length === 0) {
      row.defaultProcessRoute = null;
      return;
    }
    try {
      // 零件库导入来源加工关系时，默认工艺也只能引用标准工序库，不允许绕过页面自由写入。
      await this.processDefinitionsService.ensureActiveNames(processNames);
      row.defaultProcessRoute = processNames.join('、');
    } catch (error) {
      this.pushMaterialImportIssue(row, {
        severity: 'ERROR',
        code: 'INVALID_DEFAULT_PROCESS_ROUTE',
        message: error instanceof Error ? error.message : '默认工艺必须来自启用的标准工序'
      });
    }
  }

  private uniqueMaterialImportRows(rows: any[]) {
    const byCode = new Map<string, any>();
    for (const row of rows) {
      const key = String(row.partCode || '').trim().toLocaleLowerCase();
      if (!key) {
        continue;
      }
      const existing = byCode.get(key);
      if (existing && this.materialImportImportIdentitySignature(existing) !== this.materialImportImportIdentitySignature(row)) {
        throw new BadRequestException(`零件编码 ${row.partCode} 在导入会话内存在不一致信息，请重新上传`);
      }
      const existingStockAlertSignature = existing ? this.materialImportExplicitStockAlertSignature(existing) : '';
      const currentStockAlertSignature = this.materialImportExplicitStockAlertSignature(row);
      if (existingStockAlertSignature && currentStockAlertSignature && existingStockAlertSignature !== currentStockAlertSignature) {
        throw new BadRequestException(`零件编码 ${row.partCode} 在导入会话内存在不一致库存报警设置，请重新上传`);
      }
      const existingDefaultProcessRouteSignature = existing ? this.materialImportExplicitDefaultProcessRouteSignature(existing) : '';
      const currentDefaultProcessRouteSignature = this.materialImportExplicitDefaultProcessRouteSignature(row);
      if (
        existingDefaultProcessRouteSignature &&
        currentDefaultProcessRouteSignature &&
        existingDefaultProcessRouteSignature !== currentDefaultProcessRouteSignature
      ) {
        throw new BadRequestException(`零件编码 ${row.partCode} 在导入会话内存在不一致默认工艺，请重新上传`);
      }
      byCode.set(key, existing ? this.mergeMaterialImportBaseRows(existing, row) : row);
    }
    return [...byCode.values()];
  }

  private mergeMaterialImportBaseRows(existing: any, current: any) {
    const merged = { ...current };
    if (current.stockAlertEnabled !== null && current.stockAlertEnabled !== undefined) {
      // 当前行显式维护库存报警时，以当前行作为导入草稿设置。
    } else if (existing.stockAlertEnabled !== null && existing.stockAlertEnabled !== undefined) {
      merged.stockAlertEnabled = existing.stockAlertEnabled;
      merged.stockAlertQuantity = existing.stockAlertQuantity ?? null;
    }
    if (!this.materialImportExplicitDefaultProcessRouteSignature(merged)) {
      merged.defaultProcessRoute = existing.defaultProcessRoute ?? null;
    }
    return merged;
  }

  private uniqueMaterialDrawingImportRows(
    rows: Array<{
      partCode?: string | null;
      drawingNo?: string | null;
      drawingVersion?: string | null;
      drawingDate?: Date | null;
      drawingStatus?: string | null;
      remark?: string | null;
    }>
  ) {
    const byDrawing = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const partCode = String(row.partCode || '').trim();
      const drawingNo = String(row.drawingNo || '').trim();
      if (!partCode || !drawingNo) {
        continue;
      }
      const drawingVersion = String(row.drawingVersion || 'A').trim() || 'A';
      const key = [partCode, drawingNo, drawingVersion].map((item) => item.toLocaleLowerCase()).join('|');
      byDrawing.set(key, row);
    }
    return [...byDrawing.values()];
  }

  private async findMaterialImportCustomers(
    rows: Array<{ customerCode?: string | null; customerName?: string | null }>,
    client: any = this.prisma
  ) {
    const customerCodes = [...new Set(rows.map((row) => String(row.customerCode || '').trim()).filter(Boolean))];
    const customerNames = [...new Set(rows.map((row) => String(row.customerName || '').trim()).filter(Boolean))];
    if (customerCodes.length === 0 && customerNames.length === 0) {
      return {
        byCode: new Map<string, { id: string; customerCode: string; customerName: string }>(),
        byName: new Map<string, { id: string; customerCode: string; customerName: string }>(),
        duplicateNames: new Set<string>()
      };
    }
    const customers = await client.customer.findMany({
      where: {
        OR: [
          ...customerCodes.map((customerCode) => ({ customerCode: { equals: customerCode, mode: 'insensitive' as const } })),
          ...customerNames.map((customerName) => ({ customerName: { equals: customerName, mode: 'insensitive' as const } }))
        ]
      },
      select: { id: true, customerCode: true, customerName: true }
    });
    const byCode = new Map<string, { id: string; customerCode: string; customerName: string }>();
    const byName = new Map<string, { id: string; customerCode: string; customerName: string }>();
    const duplicateNames = new Set<string>();
    for (const customer of customers) {
      byCode.set(customer.customerCode.trim().toLocaleLowerCase(), customer);
      const nameKey = customer.customerName.trim().toLocaleLowerCase();
      if (byName.has(nameKey)) {
        duplicateNames.add(nameKey);
      } else {
        byName.set(nameKey, customer);
      }
    }
    return { byCode, byName, duplicateNames };
  }

  private materialImportCustomerValidationMessage(
    row: { customerCode?: string | null; customerName?: string | null },
    lookup: Awaited<ReturnType<InventoryService['findMaterialImportCustomers']>>
  ) {
    try {
      this.resolveMaterialImportCustomer(row, lookup);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '客户信息无法识别';
    }
  }

  private resolveMaterialImportCustomer(
    row: { customerCode?: string | null; customerName?: string | null },
    lookup: Awaited<ReturnType<InventoryService['findMaterialImportCustomers']>>
  ) {
    const customerCode = String(row.customerCode || '').trim();
    const customerName = String(row.customerName || '').trim();
    if (!customerCode && !customerName) {
      return null;
    }
    if (customerCode) {
      const customer = lookup.byCode.get(customerCode.toLocaleLowerCase());
      if (!customer) {
        throw new BadRequestException(`客户编码 ${customerCode} 不存在`);
      }
      if (customerName && customer.customerName.trim().toLocaleLowerCase() !== customerName.toLocaleLowerCase()) {
        throw new BadRequestException(`客户编码 ${customerCode} 与客户名称 ${customerName} 不一致`);
      }
      return customer;
    }
    const nameKey = customerName.toLocaleLowerCase();
    if (lookup.duplicateNames.has(nameKey)) {
      throw new BadRequestException(`客户名称 ${customerName} 对应多个客户，请填写客户编码`);
    }
    const customer = lookup.byName.get(nameKey);
    if (!customer) {
      throw new BadRequestException(`客户名称 ${customerName} 不存在`);
    }
    return customer;
  }

  private async findExistingMaterialsByPartCodes(partCodes: string[], client: any = this.prisma) {
    const uniquePartCodes = [...new Set(partCodes.map((partCode) => partCode.trim()).filter(Boolean))];
    const results: Array<{ id: string; partCode: string; partName: string; unit: string; partSpecification?: string | null; status?: CommonStatus }> = [];
    for (let index = 0; index < uniquePartCodes.length; index += 500) {
      const chunk = uniquePartCodes.slice(index, index + 500);
      if (chunk.length === 0) {
        continue;
      }
      results.push(
        ...(await client.material.findMany({
          where: { OR: chunk.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' } })) },
          select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true }
        }))
      );
    }
    return results;
  }

  private async findOrderLineHistoryByPartCodes(partCodes: string[]) {
    const uniquePartCodes = [...new Set(partCodes.map((partCode) => partCode.trim()).filter(Boolean))];
    const results: Array<{
      partCode: string;
      partName: string;
      unit: string;
      partSpecification?: string | null;
      drawingNo?: string | null;
      drawingVersion?: string | null;
      partThickness: Prisma.Decimal;
    }> = [];
    for (let index = 0; index < uniquePartCodes.length; index += 500) {
      const chunk = uniquePartCodes.slice(index, index + 500);
      if (chunk.length === 0) {
        continue;
      }
      results.push(
        ...(await this.prisma.orderLine.findMany({
          where: { OR: chunk.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' } })) },
          select: {
            partCode: true,
            partName: true,
            unit: true,
            partSpecification: true,
            drawingNo: true,
            drawingVersion: true,
            partThickness: true
          },
          orderBy: { createdAt: 'desc' }
        }))
      );
    }
    return results;
  }

  private materialImportIdentitySignature(value: {
    partName?: string | null;
    unit?: string | null;
    partSpecification?: string | null;
  }) {
    return [value.partName, value.unit, value.partSpecification].map((item) => String(item || '').trim()).join('|');
  }

  private materialImportImportIdentitySignature(value: {
    partName?: string | null;
    unit?: string | null;
    partSpecification?: string | null;
    partThickness?: number | Prisma.Decimal | null;
    projectModel?: string | null;
  }) {
    const thickness =
      value.partThickness === null || value.partThickness === undefined
        ? ''
        : typeof value.partThickness === 'number'
          ? String(value.partThickness)
          : String(decimalToNumber(value.partThickness));
    return [value.partName, value.unit, value.partSpecification, thickness, value.projectModel]
      .map((item) => String(item || '').trim())
      .join('|');
  }

  private materialImportDrawingRevisionKey(partCode?: string | null, drawingNo?: string | null, drawingVersion?: string | null) {
    return [partCode, drawingNo, drawingVersion || 'A']
      .map((item) => String(item || '').trim().toLocaleLowerCase())
      .join('|');
  }

  private materialImportDrawingRevisionSignature(value: {
    drawingDate?: Date | string | null;
    drawingStatus?: string | null;
    remark?: string | null;
  }) {
    const drawingDate = value.drawingDate instanceof Date ? this.formatDateOnly(value.drawingDate) : value.drawingDate;
    return [drawingDate, value.drawingStatus, value.remark].map((item) => String(item || '').trim()).join('|');
  }

  private materialImportExplicitStockAlertSignature(value: {
    stockAlertEnabled?: boolean | null;
    stockAlertQuantity?: number | Prisma.Decimal | null;
  }) {
    if (value.stockAlertEnabled === null || value.stockAlertEnabled === undefined) {
      return '';
    }
    if (value.stockAlertEnabled === false) {
      return 'DISABLED';
    }
    const quantity =
      value.stockAlertQuantity === null || value.stockAlertQuantity === undefined
        ? ''
        : typeof value.stockAlertQuantity === 'number'
          ? String(value.stockAlertQuantity)
          : String(decimalToNumber(value.stockAlertQuantity));
    return ['ENABLED', quantity].join('|');
  }

  private materialImportExplicitDefaultProcessRouteSignature(value: { defaultProcessRoute?: string | null }) {
    return String(value.defaultProcessRoute || '').trim();
  }

  private materialImportStockAlertData(row: {
    stockAlertEnabled?: boolean | null;
    stockAlertQuantity?: number | Prisma.Decimal | null;
  }) {
    if (row.stockAlertEnabled === true) {
      return { stockAlertEnabled: true, stockAlertQuantity: row.stockAlertQuantity ?? 0 };
    }
    if (row.stockAlertEnabled === false) {
      return { stockAlertEnabled: false, stockAlertQuantity: null };
    }
    return {};
  }

  private materialImportHistoryIdentitySignature(value: {
    partName?: string | null;
    unit?: string | null;
    partSpecification?: string | null;
    drawingNo?: string | null;
    drawingVersion?: string | null;
    partThickness?: number | Prisma.Decimal | null;
  }) {
    const thickness =
      value.partThickness === null || value.partThickness === undefined
        ? ''
        : typeof value.partThickness === 'number'
          ? String(value.partThickness)
          : String(decimalToNumber(value.partThickness));
    return [value.partName, value.unit, value.partSpecification, value.drawingNo, value.drawingVersion, thickness]
      .map((item) => String(item || '').trim())
      .join('|');
  }

  private hashMaterialImportRow(row: ParsedMaterialImportRow) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          partCode: row.partCode,
          partName: row.partName,
          unit: row.unit,
          partSpecification: row.partSpecification,
          defaultProcessRoute: row.defaultProcessRoute,
          drawingNo: row.drawingNo,
          drawingVersion: row.drawingVersion,
          drawingDate: this.formatDateOnly(row.drawingDate),
          drawingStatus: row.drawingStatus,
          partThickness: row.partThickness,
          projectModel: row.projectModel,
          stockAlertEnabled: row.stockAlertEnabled,
          stockAlertQuantity: row.stockAlertQuantity,
          remark: row.remark
        })
      )
      .digest('hex');
  }

  private hashMaterialApplicabilityImportRow(row: ParsedMaterialApplicabilityImportRow) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          partCode: row.partCode,
          customerCode: row.customerCode,
          customerName: row.customerName,
          projectModel: row.projectModel,
          remark: row.remark,
          status: row.status
        })
      )
      .digest('hex');
  }

  private hashMaterialTransformImportRow(row: ParsedMaterialTransformImportRow) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          sourcePartCode: row.sourcePartCode,
          targetPartCode: row.targetPartCode,
          customerCode: row.customerCode,
          customerName: row.customerName,
          projectModel: row.projectModel,
          multiplier: row.multiplier,
          lossRate: row.lossRate,
          defaultProcessRoute: row.defaultProcessRoute,
          conversionDescription: row.conversionDescription,
          remark: row.remark,
          status: row.status
        })
      )
      .digest('hex');
  }

  private async hashMaterialImportFile(filePath: string) {
    return createHash('sha256').update(await readFile(filePath)).digest('hex');
  }

  private parseMaterialImportStatus(value?: string | null): CommonStatus | null {
    const normalized = String(value || '').trim().toLocaleLowerCase();
    if (!normalized || ['启用', 'enabled', 'enable', '1', '是', 'yes'].includes(normalized)) {
      return 'ENABLED';
    }
    if (['停用', 'disabled', 'disable', '0', '否', 'no'].includes(normalized)) {
      return 'DISABLED';
    }
    return null;
  }

  private parseMaterialImportBoolean(value?: string | null): boolean | null {
    const normalized = String(value || '').trim().toLocaleLowerCase();
    if (!normalized) {
      return null;
    }
    if (['启用', '启用报警', '低库存报警', 'enabled', 'enable', 'true', '1', '是', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['停用', '不启用', '关闭', '关闭报警', 'disabled', 'disable', 'false', '0', '否', 'no', 'n'].includes(normalized)) {
      return false;
    }
    return null;
  }

  private normalizeMaterialImportHeader(value: string) {
    return value.replace(/\s+/g, '').trim().toLocaleLowerCase();
  }

  private materialImportOptionalCellText(row: ExcelJS.Row, column?: number) {
    if (!column) {
      return null;
    }
    return this.materialImportCellText(row, column) || null;
  }

  private materialImportCellText(row: ExcelJS.Row, column?: number) {
    if (!column) {
      return '';
    }
    return this.materialImportCellValueText(row.getCell(column).value);
  }

  private materialImportCellValueText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return this.formatDateOnly(value) || '';
    }
    if (typeof value === 'object') {
      if ('text' in value && value.text !== undefined) {
        return String(value.text).trim();
      }
      if ('result' in value && value.result !== undefined) {
        return this.materialImportCellValueText(value.result as ExcelJS.CellValue);
      }
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText.map((part) => part.text).join('').trim();
      }
      if ('hyperlink' in value && 'text' in value) {
        return String(value.text || '').trim();
      }
      return String(JSON.stringify(value)).trim();
    }
    return String(value).trim();
  }

  private materialImportCellNumber(row: ExcelJS.Row, column?: number) {
    return this.parseMaterialImportNumberText(this.materialImportCellText(row, column));
  }

  private parseMaterialImportNumberText(value?: string | null) {
    const text = String(value || '').replace(/mm$/i, '').trim();
    if (!text) {
      return null;
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private materialImportCellRatio(row: ExcelJS.Row, column?: number) {
    const text = this.materialImportCellText(row, column).trim();
    if (!text) {
      return null;
    }
    if (text.endsWith('%')) {
      const parsedPercent = Number(text.slice(0, -1).trim());
      return Number.isFinite(parsedPercent) ? parsedPercent / 100 : null;
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private materialImportCellDate(row: ExcelJS.Row, column?: number) {
    if (!column) {
      return null;
    }
    const value = row.getCell(column).value;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    const text = this.materialImportCellText(row, column);
    if (!text) {
      return null;
    }
    const parsed = new Date(text.replace(/\./g, '/').replace(/-/g, '/'));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async removeMaterialImportStoredFile(storedFileName?: string | null) {
    if (!storedFileName) {
      return false;
    }
    const uploadDir = resolve(materialImportUploadPath());
    const safeFileName = basename(storedFileName);
    const filePath = resolve(uploadDir, safeFileName);
    if (!filePath.startsWith(uploadDir)) {
      return false;
    }
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private buildAdjustmentNo() {
    const stamp = businessDateTimeKey();
    return `IA-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private buildAdjustmentTransactionNo() {
    const stamp = businessDateTimeKey();
    return `IT-ADJ-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  private validateAdjustmentAttachment(fileUrl: string, originalFileName: string, mimeType?: string) {
    if (!fileUrl.startsWith(adjustmentAttachmentPrefix) || fileUrl.includes('..')) {
      throw new BadRequestException('库存盘点附件必须通过系统上传接口上传');
    }

    const decodedFileName = decodeURIComponent(fileUrl.slice(adjustmentAttachmentPrefix.length));
    const storedFileName = basename(decodedFileName);
    if (!storedFileName || storedFileName !== decodedFileName) {
      throw new BadRequestException('库存盘点附件路径无效');
    }

    const storedExtension = storedFileName.slice(storedFileName.lastIndexOf('.')).toLowerCase();
    const originalExtension = originalFileName.slice(originalFileName.lastIndexOf('.')).toLowerCase();
    if (!allowedAdjustmentExtensions.has(storedExtension) || !allowedAdjustmentExtensions.has(originalExtension)) {
      throw new BadRequestException('库存盘点附件格式不支持');
    }
    if (mimeType && !genericUploadMimeTypes.has(mimeType) && !allowedAdjustmentMimeTypes.has(mimeType)) {
      throw new BadRequestException('库存盘点附件 mimeType 不支持');
    }

    const uploadRoot = resolve(inventoryAdjustmentUploadPath());
    const fullPath = resolve(uploadRoot, storedFileName);
    if (!fullPath.startsWith(uploadRoot)) {
      throw new BadRequestException('库存盘点附件路径无效');
    }
    if (!existsSync(fullPath)) {
      // 盘点附件必须是真实上传文件，不能手工伪造一个 URL 当作凭证。
      throw new BadRequestException('库存盘点附件文件不存在');
    }
  }

  private toAdjustment(adjustment: any) {
    return {
      id: adjustment.id,
      adjustmentNo: adjustment.adjustmentNo,
      batchId: adjustment.batchId,
      partCode: adjustment.partCode,
      partName: adjustment.partName,
      beforeQuantity: decimalToNumber(adjustment.beforeQuantity),
      afterQuantity: decimalToNumber(adjustment.afterQuantity),
      deltaQuantity: decimalToNumber(adjustment.deltaQuantity),
      unit: adjustment.unit,
      countedBy: adjustment.countedBy,
      countedAt: adjustment.countedAt,
      signatureName: adjustment.signatureName,
      attachmentFileName: adjustment.attachmentFileName,
      attachmentFileUrl: adjustment.attachmentFileUrl,
      attachmentMimeType: adjustment.attachmentMimeType,
      attachmentSize: adjustment.attachmentSize,
      remark: adjustment.remark,
      createdAt: adjustment.createdAt
    };
  }
}
