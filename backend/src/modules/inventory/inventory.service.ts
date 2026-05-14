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
  CommitMaterialImportSessionDto,
  ConfirmModelBomDiffReviewDto,
  CopyModelBomDto,
  CreateMaterialDto,
  CreateMaterialImportSessionDto,
  GetMaterialImportSessionQueryDto,
  InventoryQueryDto,
  InventorySourceDetailQueryDto,
  MaterialQueryDto,
  MaterialSuggestionQueryDto,
  MaterialTransformRuleQueryDto,
  ModelBomDiffReviewQueryDto,
  ModelBomQueryDto,
  ReorderModelBomCommonDto,
  ReorderModelBomLinesDto,
  SaveMaterialDrawingRevisionDto,
  SaveMaterialApplicabilityDto,
  SaveMaterialTransformRuleDto,
  SetModelBomCommonDto,
  SetModelBomsCommonBatchDto,
  SaveModelBomDto,
  SaveModelBomLineDto,
  UpdateMaterialDto
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

type MaterialSuggestionBase = {
  materialId?: string;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: Date | null;
  drawingStatus?: string | null;
  partThickness?: number | null;
  projectModel?: string | null;
};

type ModelBomCustomerScopeMode = 'ALL' | 'PRIVATE' | 'SELECTED';

type ModelBomSortableRow = {
  customerId: string | null;
  customerScopeMode?: string | null;
  customerScopes?: Array<{ customerId: string; status: CommonStatus }>;
  projectModel: string;
  isCommon?: boolean | null;
  commonSortOrder?: number | null;
  updatedAt: Date;
  bomName: string;
};

type ModelBomDisplayOrderLine = {
  id: string;
  sortOrder: number;
  createdAt: Date;
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
  status: CommonStatus;
  createdAt: Date;
  updatedAt: Date;
};

type MaterialImportIssue = {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
};

type ParsedMaterialImportRow = {
  sourceRowNo: number;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: Date | null;
  drawingStatus?: string | null;
  partThickness?: number | null;
  projectModel?: string | null;
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
  drawingNo: ['图号', 'drawingNo'],
  drawingVersion: ['图纸版本', '版本', 'drawingVersion'],
  drawingDate: ['图纸日期', 'drawingDate'],
  drawingStatus: ['图纸状态', 'drawingStatus'],
  partThickness: ['厚度', '厚度(mm)', 'partThickness'],
  projectModel: ['项目型号', '机型', 'projectModel'],
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly processDefinitionsService: ProcessDefinitionsService
  ) {}

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

  private async buildInventoryOutTransactionWhere(query: InventoryQueryDto) {
    if (query.status === 'AVAILABLE') {
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
      orderBy: [{ partCode: 'asc' }, { partName: 'asc' }]
    });
    if (!normalizedKeyword) {
      return materials;
    }
    return materials.filter((material) => this.materialMatchesKeyword(material, normalizedKeyword));
  }

  private async findEnabledMaterialMastersByCodes(partCodes: string[]) {
    const uniquePartCodes = [...new Set(partCodes.map((partCode) => partCode.trim()).filter(Boolean))];
    const rows: Array<{ id: string; partCode: string }> = [];
    for (let index = 0; index < uniquePartCodes.length; index += 500) {
      const chunk = uniquePartCodes.slice(index, index + 500);
      rows.push(
        ...(await this.prisma.material.findMany({
          where: {
            status: 'ENABLED',
            OR: chunk.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' } }))
          },
          select: { id: true, partCode: true }
        }))
      );
    }
    return new Map(rows.map((row) => [row.partCode.trim().toLocaleLowerCase(), row]));
  }

  private materialMatchesKeyword(material: { partCode?: string | null; partName?: string | null; unit?: string | null; partSpecification?: string | null }, keyword: string) {
    return pinyinSearchMatches([material.partCode, material.partName, material.unit, material.partSpecification], keyword);
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

  private materialMemoryMatchesKeyword(material: MaterialMemoryRow, keyword?: string) {
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    if (!normalizedKeyword) {
      return true;
    }
    return pinyinSearchMatches([material.partCode, material.partName, material.unit, material.partSpecification], normalizedKeyword);
  }

  async materials(query: MaterialQueryDto) {
    const status = query.status || 'ENABLED';
    const normalizedKeyword = normalizeSearchKeyword(query.keyword);
    const withPage = query.withPage === 'true';
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const historyByCode = normalizedKeyword
      ? await this.findMaterialSuggestionHistory({ keyword: query.keyword }, query.keyword)
      : new Map<string, MaterialSuggestionHistory>();
    const materialRows = await this.prisma.material.findMany({
      where: { status },
      orderBy: [{ updatedAt: 'desc' }, { partCode: 'asc' }]
    });
    const materials = materialRows.filter(
      (material) =>
        this.materialMemoryMatchesKeyword(material, query.keyword) || historyByCode.has(material.partCode.trim().toLocaleLowerCase())
    );
    const totalCount = materials.length;
    const pageMaterials = withPage ? materials.slice(offset, offset + limit) : materials;
    if (pageMaterials.length === 0) {
      const emptyItems: never[] = [];
      return withPage
        ? {
            items: emptyItems,
            totalCount,
            limit,
            offset,
            hasMore: false
          }
        : emptyItems;
    }

    const materialByCode = new Map(pageMaterials.map((material) => [material.partCode.trim().toLocaleLowerCase(), material]));
    const partCodeConditions = pageMaterials.map((material) => ({ partCode: { equals: material.partCode, mode: 'insensitive' as const } }));
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
      const reservedQuantity = batch.sourceOrderId ? 0 : reservedQuantityByBatchId.get(batch.id) || 0;
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

    const items = pageMaterials.map((material) => this.serializeMaterialMemoryRow(material, quantityByCode, usageByCode));
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
      status: material.status,
      ...quantity,
      orderLineUsageCount: usage.orderLineUsageCount,
      lastOrderNo: usage.lastOrderNo,
      lastCustomerName: usage.lastCustomerName,
      lastOrderDate: this.formatDateOnly(usage.lastOrderDate),
      createdAt: material.createdAt,
      updatedAt: material.updatedAt
    };
  }

  async createMaterial(dto: CreateMaterialDto) {
    const partCode = this.normalizeMaterialRequired(dto.partCode, '零件编码');
    const partName = this.normalizeMaterialRequired(dto.partName, '零件名称');
    const unit = this.normalizeMaterialRequired(dto.unit, '单位');
    await this.ensureMaterialCodeAvailable(partCode);

    // 零件基础库只维护搜索资料，不创建库存、订单或生产任务。
    return this.prisma.material.create({
      data: {
        partCode,
        partName,
        unit,
        partSpecification: String(dto.partSpecification || '').trim() || null,
        status: dto.status || 'ENABLED'
      }
    });
  }

  async updateMaterial(materialId: string, dto: UpdateMaterialDto) {
    const existing = await this.prisma.material.findUnique({ where: { id: materialId } });
    if (!existing) {
      throw new NotFoundException('零件基础资料不存在');
    }
    const partCode = dto.partCode !== undefined ? this.normalizeMaterialRequired(dto.partCode, '零件编码') : existing.partCode;
    const partName = dto.partName !== undefined ? this.normalizeMaterialRequired(dto.partName, '零件名称') : existing.partName;
    const unit = dto.unit !== undefined ? this.normalizeMaterialRequired(dto.unit, '单位') : existing.unit;
    if (partCode.toLocaleLowerCase() !== existing.partCode.toLocaleLowerCase()) {
      await this.ensureMaterialCodeAvailable(partCode, materialId);
    }
    const status = dto.status || existing.status;
    const data = {
      partCode,
      partName,
      unit,
      partSpecification:
        dto.partSpecification !== undefined ? String(dto.partSpecification || '').trim() || null : existing.partSpecification,
      status
    };
    if (status !== 'DISABLED') {
      return this.prisma.material.update({
        where: { id: materialId },
        data
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.material.update({
        where: { id: materialId },
        data
      });
      await this.disableMaterialRecommendationLinks(tx, materialId);
      return row;
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
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
    });
    if (referencingLines.length > 0) {
      // 图纸停用不能让启用 BOM 行留下失效默认图纸，避免后续推荐带错下单图纸快照。
      const references = referencingLines
        .map((line) => `${line.bom.bomName} / ${line.bom.customer?.customerName || line.bom.customerNameSnapshot || '全部客户'} / ${line.bom.projectModel} / ${line.partCodeSnapshot}`)
        .join('、');
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

  async saveMaterialDrawingRevision(materialId: string, dto: SaveMaterialDrawingRevisionDto) {
    const material = await this.prisma.material.findUnique({ where: { id: materialId }, select: { id: true } });
    if (!material) {
      throw new NotFoundException('零件基础资料不存在');
    }
    const data = this.resolveMaterialDrawingRevisionData(dto);
    await this.ensureMaterialDrawingRevisionAvailable(materialId, data.drawingNo, data.drawingVersion);

    const row = await this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        // 默认图纸修改必须保留操作时间和人员；这里只维护基础资料，不覆盖历史订单图纸快照。
        await tx.materialDrawingRevision.updateMany({ where: { materialId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.materialDrawingRevision.create({
        data: {
          materialId,
          ...data,
          defaultChangedBy: data.isDefault ? data.defaultChangedBy || '系统操作员' : null,
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
    const data = this.resolveMaterialDrawingRevisionData(dto);
    await this.ensureMaterialDrawingRevisionAvailable(existing.materialId, data.drawingNo, data.drawingVersion, existing.id);
    if (data.status === 'DISABLED') {
      await this.ensureMaterialDrawingRevisionCanBeDisabled(existing.id);
    }
    const row = await this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        // 同一个零件只允许一个启用默认图纸，BOM 行可另外指定自己的默认生产图纸。
        await tx.materialDrawingRevision.updateMany({
          where: { materialId: existing.materialId, isDefault: true, id: { not: existing.id } },
          data: { isDefault: false }
        });
      }
      return tx.materialDrawingRevision.update({
        where: { id: existing.id },
        data: {
          ...data,
          defaultChangedBy: data.isDefault ? data.defaultChangedBy || existing.defaultChangedBy || '系统操作员' : null,
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
    createdAt: Date;
    updatedAt: Date;
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
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
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
      { header: '图号', key: 'drawingNo', width: 24 },
      { header: '图纸版本', key: 'drawingVersion', width: 14 },
      { header: '图纸日期', key: 'drawingDate', width: 14 },
      { header: '图纸状态', key: 'drawingStatus', width: 14 },
      { header: '厚度', key: 'partThickness', width: 12 },
      { header: '项目型号', key: 'projectModel', width: 18 },
      { header: '备注', key: 'remark', width: 34 }
    ];
    worksheet.addRows([
      {
        partCode: 'RS10703010033',
        partName: '顶盖',
        unit: '件',
        drawingNo: 'RBKS-300DBII-10-50-01',
        drawingStatus: '旧图',
        partThickness: 1,
        projectModel: 'B型5P',
        remark: '百胜样机款'
      },
      {
        partCode: 'RS1071123',
        partName: '风机支架组件',
        unit: '套',
        drawingNo: 'B5机型图号-10-30',
        drawingStatus: '旧图',
        partThickness: 2,
        projectModel: 'B型5P',
        remark: '组件主件，子件后续在机型零件包维护'
      },
      {
        partCode: 'P-BASE-001',
        partName: '百胜通用半成品',
        unit: '件',
        drawingNo: 'BASE-001',
        drawingStatus: '旧图',
        partThickness: 2,
        projectModel: '',
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

  async getMaterialImportSession(sessionId: string, query: GetMaterialImportSessionQueryDto = {}) {
    return this.buildMaterialImportSessionPreview(sessionId, this.materialImportPageOptions(query));
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
      ['生成时间', new Date().toISOString(), '说明', '仅用于修正 Excel；提交前后端仍会重新校验']
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
    issueSheet.autoFilter = { from: 'A1', to: 'V1' };
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

    try {
      const createdFile = await this.prisma.$transaction(async (tx) => {
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
            transformRowCount: parsed.transformRows.length
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
                drawingNo: row.drawingNo,
                drawingVersion: row.drawingVersion,
                drawingDate: row.drawingDate,
                drawingStatus: row.drawingStatus,
                partThickness: row.partThickness,
                projectModel: row.projectModel,
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
      });

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
      await this.removeMaterialImportStoredFile(file.filename);
      throw error;
    }
  }

  async commitMaterialImportSession(sessionId: string, dto: CommitMaterialImportSessionDto) {
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

    const rows = await this.prisma.materialImportRow.findMany({
      where: { sessionId, errorCount: 0 },
      orderBy: [{ partCode: 'asc' }, { createdAt: 'asc' }]
    });
    const [applicabilityRows, transformRows] = await Promise.all([
      this.prisma.materialApplicabilityImportRow.findMany({
        where: { sessionId, errorCount: 0 },
        orderBy: [{ partCode: 'asc' }, { createdAt: 'asc' }]
      }),
      this.prisma.materialTransformImportRow.findMany({
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

    const result = await this.prisma.$transaction(async (tx) => {
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
        if (existing) {
          await tx.material.update({
            where: { id: existing.id },
            data: {
              partCode: row.partCode,
              partName: row.partName,
              unit: row.unit,
              partSpecification: row.partSpecification || null,
              status: 'ENABLED'
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
              status: 'ENABLED'
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
    });

    return {
      sessionId,
      ...result,
      committedMaterialCount: result.createdCount + result.updatedCount
    };
  }

  async deleteMaterialImportFile(sessionId: string, fileId: string) {
    const session = await this.prisma.materialImportSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('零件导入会话不存在');
    }
    if (session.status !== 'DRAFT') {
      throw new BadRequestException('已提交或已放弃的零件导入会话不能删除文件');
    }
    const importFile = await this.prisma.materialImportFile.findFirst({ where: { id: fileId, sessionId } });
    if (!importFile) {
      throw new NotFoundException('零件导入文件不存在');
    }
    await this.prisma.materialImportFile.delete({ where: { id: importFile.id } });
    await this.removeMaterialImportStoredFile(importFile.storedFileName);
    return this.buildMaterialImportSessionPreview(sessionId, this.materialImportPageOptions());
  }

  async discardMaterialImportSession(sessionId: string) {
    const session = await this.prisma.materialImportSession.findUnique({
      where: { id: sessionId },
      include: { files: true }
    });
    if (!session) {
      throw new NotFoundException('零件导入会话不存在');
    }
    if (session.status === 'COMMITTED') {
      throw new BadRequestException('已提交的零件导入会话不能放弃');
    }
    await this.prisma.materialImportSession.delete({ where: { id: sessionId } });
    await Promise.all(session.files.map((file) => this.removeMaterialImportStoredFile(file.storedFileName)));
    return {
      sessionId,
      discarded: true,
      deletedFileCount: session.files.length
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
      select: { id: true, materialId: true }
    });
    if (!existing) {
      throw new NotFoundException('零件适用范围不存在');
    }
    const scope = await this.resolveMaterialApplicabilityScope(dto);
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
    createdAt: Date;
    updatedAt: Date;
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
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
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
    const rank: Record<ModelBomCustomerScopeMode, number> = {
      PRIVATE: 1,
      SELECTED: 2,
      ALL: 3
    };
    return rank[nextMode] > rank[previousMode];
  }

  private modelBomProjectScopeBroadens(previousProjectModel?: string | null, nextProjectModel?: string | null) {
    return Boolean(String(previousProjectModel || '').trim()) && !String(nextProjectModel || '').trim();
  }

  private modelBomSelectedCustomerScopeAdds(
    row: { customerId?: string | null; customerScopeMode?: string | null; customerScopes?: Array<{ customerId: string; status?: CommonStatus }> },
    nextMode: ModelBomCustomerScopeMode,
    nextCustomerIds: string[]
  ) {
    if (this.modelBomCustomerScopeModeFromRow(row) !== 'SELECTED' || nextMode !== 'SELECTED') {
      return false;
    }
    const previousCustomerIds = new Set(
      (row.customerScopes || [])
        .filter((scope) => !scope.status || scope.status === 'ENABLED')
        .map((scope) => scope.customerId)
    );
    return nextCustomerIds.some((customerId) => !previousCustomerIds.has(customerId));
  }

  private modelBomInclude(
    orderBy: Prisma.ModelBomLineOrderByWithRelationInput[] = [{ status: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }]
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

  private async nextModelBomCommonSortOrder(customerScopeKey: string, projectModelScopeKey: string) {
    const maxCommon = await this.prisma.modelBom.aggregate({
      _max: { commonSortOrder: true },
      where: {
        isCommon: true,
        customerScopeKey,
        projectModelScopeKey
      }
    });
    return (maxCommon._max.commonSortOrder || 0) + 1;
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
      orderBy: [{ updatedAt: 'desc' }, { projectModel: 'asc' }, { bomName: 'asc' }]
    });
    const visibleRows =
      customerId && query.excludeGlobalAllProject === 'true'
        ? rows.filter((row) => !(row.customerScopeMode === 'ALL' && row.projectModelScopeKey === 'ALL'))
        : rows;
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
    const pageRows = withPage ? sortedRows.slice(offset, offset + limit) : sortedRows;
    const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(pageRows.flatMap((row) => row.lines)));
    const items = pageRows.map((row) => this.serializeModelBom(row, partThicknessByScopeKey));
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

      const updatedDiff = right.updatedAt.getTime() - left.updatedAt.getTime();
      if (updatedDiff !== 0) {
        return updatedDiff;
      }
      return `${left.projectModel}-${left.bomName}`.localeCompare(`${right.projectModel}-${right.bomName}`, 'zh-Hans-CN');
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

  async modelBomDiffReviews(bomId: string, query: ModelBomDiffReviewQueryDto) {
    const bom = await this.prisma.modelBom.findUnique({ where: { id: bomId }, select: { id: true, sourceBomId: true } });
    if (!bom) {
      throw new NotFoundException('机型零件包不存在');
    }
    const sourceBomId = query.sourceBomId?.trim() || bom.sourceBomId || undefined;
    const rows = await this.prisma.modelBomDiffReview.findMany({
      where: {
        targetBomId: bomId,
        ...(sourceBomId ? { sourceBomId } : {}),
        status: 'ENABLED'
      },
      orderBy: [{ reviewedAt: 'desc' }, { updatedAt: 'desc' }]
    });
    return rows.map((row) => this.serializeModelBomDiffReview(row));
  }

  async confirmModelBomDiffReview(bomId: string, dto: ConfirmModelBomDiffReviewDto) {
    const bom = await this.prisma.modelBom.findUnique({ where: { id: bomId }, select: { id: true, sourceBomId: true } });
    if (!bom) {
      throw new NotFoundException('机型零件包不存在');
    }
    if (!bom.sourceBomId) {
      throw new BadRequestException('只有复制自来源 BOM 的客户 BOM 才需要差异核对');
    }
    if (dto.sourceBomId.trim() !== bom.sourceBomId) {
      throw new BadRequestException('差异核对来源 BOM 与当前客户 BOM 的复制来源不一致');
    }
    const reviewKey = dto.reviewKey.trim();
    const diffFingerprint = dto.diffFingerprint.trim();
    if (!reviewKey || !diffFingerprint) {
      throw new BadRequestException('差异核对记录缺少 reviewKey 或 diffFingerprint');
    }
    const fieldsJson = dto.fieldsJson ? (dto.fieldsJson as Prisma.InputJsonValue) : Prisma.JsonNull;
    // 只记录人工核对结果；不会自动覆盖来源 BOM 或客户 BOM 明细。
    const row = await this.prisma.modelBomDiffReview.upsert({
      where: { reviewKey },
      create: {
        targetBomId: bom.id,
        sourceBomId: bom.sourceBomId,
        reviewKey,
        issueKind: dto.issueKind.trim(),
        sourceLineId: dto.sourceLineId?.trim() || null,
        targetLineId: dto.targetLineId?.trim() || null,
        issueTitle: dto.issueTitle.trim(),
        issueDetail: dto.issueDetail?.trim() || null,
        diffFingerprint,
        fieldsJson,
        reviewedBy: dto.reviewedBy?.trim() || null,
        reviewRemark: dto.reviewRemark?.trim() || null,
        status: 'ENABLED',
        reviewedAt: new Date()
      },
      update: {
        issueKind: dto.issueKind.trim(),
        sourceLineId: dto.sourceLineId?.trim() || null,
        targetLineId: dto.targetLineId?.trim() || null,
        issueTitle: dto.issueTitle.trim(),
        issueDetail: dto.issueDetail?.trim() || null,
        diffFingerprint,
        fieldsJson,
        reviewedBy: dto.reviewedBy?.trim() || null,
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
    const scopedDuplicate = await this.prisma.modelBom.findFirst({
      where: {
        customerScopeKey: scopeData.customerScopeKey,
        projectModelScopeKey: scopeData.projectModelScopeKey
      },
      select: { id: true }
    });
    if (scopedDuplicate) {
      throw new BadRequestException('当前客户/机型范围已存在 BOM，请直接维护现有零件包，避免重复新建');
    }
    const existing = await this.prisma.modelBom.findUnique({
      where: {
        bomName_customerScopeKey_projectModelScopeKey: {
          bomName: scopeData.bomName,
          customerScopeKey: scopeData.customerScopeKey,
          projectModelScopeKey: scopeData.projectModelScopeKey
        }
      },
      select: { id: true }
    });
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
      const row = await this.prisma.modelBom.create({
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
      const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
      return this.serializeModelBom(row, partThicknessByScopeKey);
    } catch (error) {
      this.handleModelBomScopeUniqueError(error, '当前客户/机型范围已存在 BOM，请直接维护现有零件包，避免重复新建');
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
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
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
    const scopedDuplicate = await this.prisma.modelBom.findFirst({
      where: { customerScopeKey, projectModelScopeKey },
      select: { id: true }
    });
    if (scopedDuplicate) {
      throw new BadRequestException('当前客户和机型/项目已存在客户零件包，请打开现有客户 BOM 继续维护，避免重复复制');
    }
    const duplicate = await this.prisma.modelBom.findUnique({
      where: {
        bomName_customerScopeKey_projectModelScopeKey: {
          bomName,
          customerScopeKey,
          projectModelScopeKey
        }
      },
      select: { id: true }
    });
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
          )._max.commonSortOrder || 0
        ) + 1
      : null;

    try {
      const row = await this.prisma.modelBom.create({
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
      const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
      return this.serializeModelBom(row, partThicknessByScopeKey);
    } catch (error) {
      this.handleModelBomScopeUniqueError(error, '当前客户和机型/项目已存在客户零件包，请打开现有客户 BOM 继续维护，避免重复复制');
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
      this.modelBomSelectedCustomerScopeAdds(existing, nextScopeMode, nextScopeCustomerIds) ||
      this.modelBomProjectScopeBroadens(existing.projectModel, scopeData.projectModel);
    if (scopeBroadens && dto.scopeChangeConfirmed !== true) {
      // 后端兜底要求扩大 BOM 可见客户范围前必须人工确认；不生成订单、生产任务或库存流水。
      throw new BadRequestException('BOM 适用客户范围将被扩大，请在前端确认后再保存');
    }
    const scopedDuplicate = await this.prisma.modelBom.findFirst({
      where: {
        customerScopeKey: scopeData.customerScopeKey,
        projectModelScopeKey: scopeData.projectModelScopeKey,
        id: { not: bomId }
      },
      select: { id: true }
    });
    if (scopedDuplicate) {
      throw new BadRequestException('当前客户/机型范围已存在 BOM，请直接维护现有零件包，避免编辑覆盖其他 BOM 范围');
    }
    const duplicate = await this.prisma.modelBom.findUnique({
      where: {
        bomName_customerScopeKey_projectModelScopeKey: {
          bomName: scopeData.bomName,
          customerScopeKey: scopeData.customerScopeKey,
          projectModelScopeKey: scopeData.projectModelScopeKey
        }
      },
      select: { id: true }
    });
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
      const row = await this.prisma.modelBom.update({
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
      const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
      return this.serializeModelBom(row, partThicknessByScopeKey);
    } catch (error) {
      this.handleModelBomScopeUniqueError(error, '当前客户/机型范围已存在 BOM，请直接维护现有零件包，避免编辑覆盖其他 BOM 范围');
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

    const row = await this.prisma.modelBom.update({
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
        let nextSortOrder = maxCommon._max.commonSortOrder || 0;
        for (const row of groupRows) {
          const commonSortOrder = row.isCommon && row.commonSortOrder ? row.commonSortOrder : ++nextSortOrder;
          await tx.modelBom.update({
            where: { id: row.id },
            data: { isCommon: true, commonSortOrder }
          });
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
    await this.prisma.$transaction(
      items.map((item, index) =>
        this.prisma.modelBom.update({
          where: { id: item.bomId },
          // 常用排序只影响推荐和列表显示优先级，不修改 BOM 明细、适用范围、订单、生产或库存。
          data: { commonSortOrder: item.commonSortOrder > 0 ? item.commonSortOrder : index + 1 }
        })
      )
    );
    return { updatedCount: items.length };
  }

  async disableModelBom(bomId: string) {
    const existing = await this.prisma.modelBom.findUnique({ where: { id: bomId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('机型零件包不存在');
    }
    const row = await this.prisma.modelBom.update({
      where: { id: bomId },
      // 停用 BOM 同时取消常用优先级；只影响后续推荐显示，不删除明细、订单、生产或库存。
      data: { status: 'DISABLED', isCommon: false, commonSortOrder: null },
      include: this.modelBomInclude([{ status: 'asc' }, { sortOrder: 'asc' }])
    });
    const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes(row.lines));
    return this.serializeModelBom(row, partThicknessByScopeKey);
  }

  async deleteModelBom(bomId: string) {
    const existing = await this.prisma.modelBom.findUnique({
      where: { id: bomId },
      select: {
        id: true,
        bomName: true,
        lines: { select: { id: true } },
        customerScopes: { select: { id: true } },
        diffReviewsAsSource: { select: { id: true } },
        diffReviewsAsTarget: { select: { id: true } }
      }
    });
    if (!existing) {
      throw new NotFoundException('机型零件包不存在');
    }
    const copiedCustomerBoms = await this.prisma.modelBom.findMany({
      where: { sourceBomId: bomId },
      select: { bomName: true, customerNameSnapshot: true, projectModel: true, status: true },
      orderBy: [{ updatedAt: 'desc' }]
    });
    if (copiedCustomerBoms.length > 0) {
      const previewRows: string[] = [];
      for (const bom of copiedCustomerBoms) {
        if (previewRows.length >= 3) {
          break;
        }
        previewRows.push(`${bom.bomName}${bom.customerNameSnapshot ? ` / ${bom.customerNameSnapshot}` : ''}${bom.projectModel ? ` / ${bom.projectModel}` : ''}`);
      }
      const preview = previewRows.join('、');
      const remaining = copiedCustomerBoms.length > 3 ? ` 等 ${copiedCustomerBoms.length} 个客户 BOM` : '';
      throw new BadRequestException(
        `该 BOM 已被${copiedCustomerBoms.length} 个客户 BOM 作为来源引用：${preview}${remaining}。请先确认并删除这些客户 BOM，或改为停用来源 BOM；永久删除不会自动覆盖客户 BOM。`
      );
    }

    await this.prisma.$transaction([
      this.prisma.modelBomDiffReview.deleteMany({
        where: { OR: [{ sourceBomId: bomId }, { targetBomId: bomId }] }
      }),
      this.prisma.modelBomCustomerScope.deleteMany({ where: { bomId } }),
      // 无效 BOM 物理删除只清理 BOM 配置、适用客户、包内明细和差异核对记录，不改订单、生产或库存数据。
      this.prisma.modelBomLine.deleteMany({ where: { bomId } }),
      this.prisma.modelBom.delete({ where: { id: bomId } })
    ]);

    return {
      id: existing.id,
      bomName: existing.bomName,
      lineCount: existing.lines.length,
      customerScopeCount: existing.customerScopes.length,
      diffReviewCount: existing.diffReviewsAsSource.length + existing.diffReviewsAsTarget.length,
      deleted: true
    };
  }

  private handleModelBomScopeUniqueError(error: unknown, message: string): never {
    if (this.isModelBomScopeUniqueError(error)) {
      throw new BadRequestException(message);
    }
    throw error;
  }

  private isModelBomScopeUniqueError(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    const targetText = Array.isArray(target) ? target.join(',') : String(target || '');
    return (
      targetText.includes('ModelBom_customerScopeKey_projectModelScopeKey_key') ||
      (targetText.includes('customerScopeKey') && targetText.includes('projectModelScopeKey'))
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
    const defaultQuantity = Number(dto.defaultQuantity || 0);
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
      }))._max.sortOrder || 0) + 10;
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
    const row = await this.prisma.modelBomLine.create({
      data: { bomId, ...data },
      include: this.modelBomLineInclude()
    });
    const partThicknessByScopeKey = await this.latestOrderLineThicknessByScopeKey(this.modelBomLinePartCodes([row]));
    const displayOrder = await this.modelBomLineDisplayOrderForLine(bomId, row.id);
    return this.serializeModelBomLine(row, partThicknessByScopeKey, bom, displayOrder);
  }

  async updateModelBomLine(lineId: string, dto: SaveModelBomLineDto) {
    const existing = await this.prisma.modelBomLine.findUnique({
      where: { id: lineId },
      select: { id: true, bomId: true, lineType: true, componentNo: true, partThicknessSnapshot: true, bom: { select: { customerId: true, projectModel: true } } }
    });
    if (!existing) {
      throw new NotFoundException('机型零件包明细不存在');
    }
    const material = await this.prisma.material.findUnique({
      where: { id: dto.materialId },
      select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true, status: true }
    });
    if (!material) {
      throw new BadRequestException('零件基础资料不存在');
    }
    const defaultQuantity = Number(dto.defaultQuantity || 0);
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

    const bom = await this.prisma.modelBom.findUnique({ where: { id: bomId }, select: { id: true } });
    if (!bom) {
      throw new NotFoundException('机型零件包不存在');
    }
    const lines = await this.prisma.modelBomLine.findMany({
      where: { id: { in: normalizedItems.map((item) => item.lineId) } },
      select: { id: true, bomId: true }
    });
    if (lines.length !== normalizedItems.length || lines.some((line) => line.bomId !== bomId)) {
      throw new BadRequestException('BOM 排序明细必须全部属于当前机型零件包');
    }

    await this.prisma.$transaction(async (tx) => {
      // BOM 拖拽排序必须事务化保存，避免多行逐个更新造成部分成功、部分失败。
      for (const item of normalizedItems) {
        await tx.modelBomLine.update({
          where: { id: item.lineId },
          data: { sortOrder: item.sortOrder }
        });
      }
    });
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
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    });
    const normalizedKeyword = normalizeSearchKeyword(query.keyword);
    const filtered = normalizedKeyword
      ? rows.filter((row) =>
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
      : rows;
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
    const existing = await this.prisma.materialTransformRule.findUnique({ where: { id: ruleId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('来源加工关系不存在');
    }
    const data = await this.resolveMaterialTransformRuleData(dto);
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
      const reservedQuantity = batch.sourceOrderId ? 0 : reservedQuantityByBatchId.get(batch.id) || 0;
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
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
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
    createdAt: Date;
    updatedAt: Date;
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
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
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
    createdAt: Date;
    updatedAt: Date;
    customer?: { id: string; customerName: string; customerCode: string } | null;
    customerScopes?: Array<{
      customerId: string;
      customerNameSnapshot: string | null;
      status: CommonStatus;
      customer?: { id: string; customerName: string; customerCode: string } | null;
    }>;
      lines: Array<Parameters<InventoryService['serializeModelBomLine']>[0]>;
    },
    partThicknessByScopeKey = new Map<string, number>()
  ) {
    const customerName = row.customer?.customerName || row.customerNameSnapshot || '';
    const projectScopeLabel = row.projectModel || '全部机型/项目';
    const customerScopeMode: ModelBomCustomerScopeMode = row.customerId ? 'PRIVATE' : row.customerScopeMode === 'SELECTED' ? 'SELECTED' : 'ALL';
    const scopeCustomers = (row.customerScopes || []).map((scope) => ({
      customerId: scope.customerId,
      customerCode: scope.customer?.customerCode,
      customerName: scope.customer?.customerName || scope.customerNameSnapshot || ''
    }));
    const customerScopeLabel =
      customerScopeMode === 'PRIVATE'
        ? customerName || '指定客户'
        : customerScopeMode === 'SELECTED'
          ? scopeCustomers.map((scope) => scope.customerName).filter(Boolean).join('、') || '指定客户'
          : '全部客户';
    const scopeTypeLabel =
      customerScopeMode === 'PRIVATE' ? '客户私有' : customerScopeMode === 'SELECTED' ? '指定客户可用' : '全部客户通用';
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
      scopeCustomers,
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
      lines: (() => {
        const displayOrderByLineId = this.modelBomLineDisplayOrderMap(row.lines);
        return row.lines.map((line) =>
          this.serializeModelBomLine(
            line,
            partThicknessByScopeKey,
            { customerId: row.customerId, projectModel: row.projectModel },
            displayOrderByLineId.get(line.id)
          )
        );
      })(),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
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
    createdAt: Date;
    updatedAt: Date;
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
      createdAt: Date;
      updatedAt: Date;
    } | null;
    material?: {
      id: string;
      partCode: string;
      partName: string;
      unit: string;
      partSpecification: string | null;
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
        createdAt: Date;
        updatedAt: Date;
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
      defaultProcessRoute: line.defaultProcessRoute,
      defaultQuantity: decimalToNumber(line.defaultQuantity),
      remark: line.remark,
      sortOrder: line.sortOrder,
      status: line.status,
      materialStatus: line.material?.status,
      createdAt: line.createdAt,
      updatedAt: line.updatedAt
    };
  }

  private modelBomLineDisplayOrderMap(lines: ModelBomDisplayOrderLine[]) {
    // displayOrder 是页面查看用连续序号，必须包含当前 BOM 明细里所有可见行；sortOrder 仍只是拖拽持久化的内部间隔值。
    const sortedLines = [...lines].sort(
      (left, right) =>
        (left.sortOrder || 0) - (right.sortOrder || 0) ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
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
        createdAt: true,
        status: true,
        lineType: true,
        componentNo: true,
        parentComponentNo: true,
        material: { select: { status: true } }
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
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
    if (!keyword || query.status === 'USED') {
      return [];
    }
    // 关键字查到零件但没有库存批次时，也要返回 0 库存行，方便仓库确认“数据库有此零件、当前仓库无库存”。
    return this.findMaterialsByKeyword(keyword);
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
      return this.prisma.customerOrder.findUnique({
        where: { id: excludeOrderId },
        select: { id: true, orderNo: true, status: true, createdAt: true }
      });
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
    const sourceTaskMap = await this.findSourceTaskMap(batches.map((batch) => batch.sourceProductionTaskNo));

    const summaryMap = new Map<string, InventorySummaryAccumulator>();

    for (const batch of batches.filter((item) => this.inventoryBatchMatchesKeyword(item, query.keyword, this.inventoryBatchSourceSearchValues(item, sourceTaskMap)))) {
      const key = this.materialSummaryKey(batch);
      const row = summaryMap.get(key) ?? this.createSummaryAccumulator(batch);

      const quantity = decimalToNumber(batch.quantity);
      const isAvailable = batch.status === 'AVAILABLE' && quantity > 0;
      const reservedQuantity = isAvailable && !batch.sourceOrderId
        ? batch.reservations
            .filter((reservation) => this.stockReservationConsumesAvailability(reservation.order, currentOrder))
            .reduce((sum, reservation) => sum + decimalToNumber(reservation.quantity), 0)
        : 0;
      const availableQuantity = isAvailable ? Math.max(Math.round((quantity - reservedQuantity + Number.EPSILON) * 1000) / 1000, 0) : 0;
      row.batchCount += 1;
      row.totalQuantity += quantity;

      if (isAvailable) {
        row.physicalQuantity += quantity;
        row.reservedQuantity += reservedQuantity;
        row.availableQuantity += availableQuantity;
        row.warehouseIds.add(batch.warehouseId);

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
      if (isAvailable) {
        warehouseRow.reservedQuantity += reservedQuantity;
        warehouseRow.availableQuantity += availableQuantity;
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

    return [...summaryMap.values()].map((row) => ({
      // 按零件库存汇总只从 InventoryBatch 实时计算，不保存第二份汇总数量，避免库存账面不一致。
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
      warehouses: [...row.warehouses.values()].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, 'zh-Hans-CN'))
    })).sort((a, b) => a.partCode.localeCompare(b.partCode, 'zh-Hans-CN'));
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
      const reservedQuantity = batch.sourceOrderId ? 0 : reservedQuantityByBatchId.get(batch.id) || 0;
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
      const matchHint = matchHints.get(materialKey) || {};
      const history = historyByCode.get(materialKey);
      const searchMatch = this.materialSuggestionSearchMatch(material, keyword, history, matchHint);
      const useQueryCustomerSnapshot = Boolean(customerId && history?.hasQueryCustomerHistory);
      const partName = useQueryCustomerSnapshot ? history?.partName || material.partName : material.partName;
      const unit = useQueryCustomerSnapshot ? history?.unit || material.unit : material.unit;
      const partSpecification = useQueryCustomerSnapshot
        ? history?.partSpecification || material.partSpecification
        : material.partSpecification;
      const drawingNo = useQueryCustomerSnapshot
        ? history?.drawingNo || material.drawingNo
        : material.drawingNo || history?.drawingNo;
      const drawingVersion = useQueryCustomerSnapshot
        ? history?.drawingVersion || material.drawingVersion
        : material.drawingVersion || history?.drawingVersion;
      const drawingDate = useQueryCustomerSnapshot
        ? history?.drawingDate || material.drawingDate
        : material.drawingDate || history?.drawingDate;
      const drawingStatus = useQueryCustomerSnapshot
        ? history?.drawingStatus || material.drawingStatus
        : material.drawingStatus || history?.drawingStatus;
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
        drawingNo,
        drawingVersion,
        drawingDate: this.formatDateOnly(drawingDate),
        drawingStatus,
        partThickness,
        projectModel,
        customerUsageCount: history?.customerUsageCount || 0,
        historyUsageCount: history?.usageCount || 0,
        hasCurrentCustomerHistory: Boolean(history?.hasQueryCustomerHistory),
        identityVariantCount: history?.identityVariantCount || 0,
        hasIdentityConflict: Boolean((history?.identityVariantCount || 0) > 1),
        identityConflictFields: this.materialSuggestionIdentityConflictFields(history),
        lastCustomerCode: history?.lastCustomerCode,
        lastCustomerName: history?.lastCustomerName,
        lastCustomerOrderNo: history?.lastCustomerOrderNo,
        lastCustomerOrderDate: this.formatDateOnly(history?.lastCustomerOrderDate),
        matchedCustomerCode: history?.matchedCustomerCode,
        matchedCustomerName: history?.matchedCustomerName,
        matchedHistoryOrderNo: history?.matchedHistoryOrderNo,
        historyCustomerNames: history ? [...history.historyCustomerNames] : [],
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
        partThickness: line.partThickness ? decimalToNumber(line.partThickness) : null,
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
    existing.partThickness = line.partThickness ? decimalToNumber(line.partThickness) : null;
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
    const searchRankDiff = (right.searchMatchRank || 0) - (left.searchMatchRank || 0);
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

      const customerUsageDiff = (right.customerUsageCount || 0) - (left.customerUsageCount || 0);
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

    const historyUsageDiff = (right.historyUsageCount || 0) - (left.historyUsageCount || 0);
    if (historyUsageDiff !== 0) {
      return historyUsageDiff;
    }

    const stockDiff = (right.availableQuantity || 0) - (left.availableQuantity || 0);
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
    return {
      partCode: firstBatch?.partCode || material?.partCode || normalizedPartCode,
      partName: firstBatch?.partName || material?.partName || '',
      unit,
      availableQuantity: sources.reduce((sum, row) => sum + row.quantity, 0),
      batchCount: sources.length,
      orderSourceCount: sources.filter((row) => row.inventorySourceType === 'ORDER').length,
      stockSourceCount: sources.filter((row) => row.inventorySourceType === 'STOCK').length,
      sources
    };
  }

  async adjustBatchQuantity(batchId: string, dto: AdjustInventoryBatchDto) {
    const afterQuantity = Number(dto.afterQuantity);
    if (!Number.isFinite(afterQuantity) || afterQuantity < 0) {
      throw new BadRequestException('盘点后数量必须大于或等于 0');
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
          data: { quantity: afterQuantity, status: afterQuantity > 0 ? 'AVAILABLE' : 'USED' }
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
      quantityByBatchId.set(row.batchId, (quantityByBatchId.get(row.batchId) || 0) + decimalToNumber(row.quantity));
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
    const reservedQuantity = reservations.reduce((sum: number, reservation: any) => sum + reservation.quantity, 0);
    const physicalQuantity = batch.status === 'AVAILABLE' ? decimalToNumber(batch.quantity) : 0;
    const quantity = Math.max(Math.round((physicalQuantity - reservedQuantity + Number.EPSILON) * 1000) / 1000, 0);

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
      drawingFileName: sourceLine?.drawingFileName,
      drawingFileUrl: sourceLine?.drawingFileUrl,
      partThickness: sourceLine ? decimalToNumber(sourceLine.partThickness) : null,
      partSpecification: sourceLine?.partSpecification,
      status: batch.status,
      createdAt: batch.createdAt
    };
  }

  async findAll(query: InventoryQueryDto) {
    const where = await this.buildInventoryWhere(query);
    const currentOrder = await this.resolveStockReservationPriorityOrder(query);
    const reservationWhere = currentOrder
      ? this.activeReservationWhereForPriority(currentOrder)
      : this.activeReservationWhere(query.excludeOrderNo, query.excludeOrderId);

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

    const sourceTaskMap = await this.findSourceTaskMap(rawBatches.map((batch) => batch.sourceProductionTaskNo));
    const batches = rawBatches.filter((batch) =>
      this.inventoryBatchMatchesKeyword(batch, query.keyword, this.inventoryBatchSourceSearchValues(batch, sourceTaskMap))
    );

    return batches.map((batch) => {
      const storedQuantity = decimalToNumber(batch.quantity);
      const physicalQuantity = batch.status === 'AVAILABLE' ? storedQuantity : 0;
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
      const reservedQuantity = batch.sourceOrderId ? 0 : reservations.reduce((sum: number, reservation: any) => sum + reservation.quantity, 0);
      const availableQuantity = Math.max(Math.round((physicalQuantity - reservedQuantity + Number.EPSILON) * 1000) / 1000, 0);
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
        quantity: physicalQuantity,
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
      Number(materialIssueAggregate._sum.errorCount || 0) +
      Number(scopeIssueAggregate._sum.errorCount || 0) +
      Number(transformIssueAggregate._sum.errorCount || 0);
    const warningCount =
      Number(materialIssueAggregate._sum.warningCount || 0) +
      Number(scopeIssueAggregate._sum.warningCount || 0) +
      Number(transformIssueAggregate._sum.warningCount || 0);
    const duplicateRowCount = Number(duplicateAggregate._sum.duplicateRowCount || 0);
    const previewToken = createHash('sha256')
      .update(
        JSON.stringify({
          sessionId,
          status: session.status,
          updatedAt: session.updatedAt.toISOString(),
          rowCount,
          errorCount,
          warningCount,
          duplicateRowCount,
          files: session.files.map((file) => [
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
        loadedCount: previewRows.length,
        totalCount: rowCount,
        hasMore: rowOffset + previewRows.length < rowCount
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
        drawingNo: row.drawingNo,
        drawingVersion: row.drawingVersion,
        drawingDate: this.formatDateOnly(row.drawingDate),
        drawingStatus: row.drawingStatus,
        partThickness: row.partThickness ? decimalToNumber(row.partThickness) : null,
        projectModel: row.projectModel,
        remark: row.remark,
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

    this.applyMaterialImportDuplicateConflicts(rows);
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
      const parsedRow: ParsedMaterialImportRow = {
        sourceRowNo: rowNo,
        partCode: this.materialImportCellText(row, columns.partCode),
        partName: this.materialImportCellText(row, columns.partName),
        unit: this.materialImportCellText(row, columns.unit),
        partSpecification: this.materialImportOptionalCellText(row, columns.partSpecification),
        drawingNo: this.materialImportOptionalCellText(row, columns.drawingNo),
        drawingVersion: this.materialImportOptionalCellText(row, columns.drawingVersion),
        drawingDate: this.materialImportCellDate(row, columns.drawingDate),
        drawingStatus: this.materialImportOptionalCellText(row, columns.drawingStatus),
        partThickness: this.materialImportCellNumber(row, columns.partThickness),
        projectModel: this.materialImportOptionalCellText(row, columns.projectModel),
        remark: this.materialImportOptionalCellText(row, columns.remark),
        raw,
        rowHash: '',
        issues: [],
        errorCount: 0,
        warningCount: 0
      };
      parsedRow.issues = this.buildMaterialImportRowIssues(parsedRow);
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

  private buildMaterialImportRowIssues(row: ParsedMaterialImportRow): MaterialImportIssue[] {
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
      const signatures = new Set(sameCodeRows.map((row) => this.materialImportIdentitySignature(row)));
      if (signatures.size <= 1) {
        continue;
      }
      for (const row of sameCodeRows) {
        this.pushMaterialImportIssue(row, {
          severity: 'ERROR',
          code: 'DUPLICATE_PART_CONFLICT',
          message: '同一导入会话内相同零件编码的名称、单位或规格不一致'
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
      if (existing && this.materialImportIdentitySignature(existing) !== this.materialImportIdentitySignature(row)) {
        throw new BadRequestException(`零件编码 ${row.partCode} 在导入会话内存在不一致信息，请重新上传`);
      }
      byCode.set(key, row);
    }
    return [...byCode.values()];
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
    const results: Array<{ id: string; partCode: string; partName: string; unit: string; partSpecification?: string | null }> = [];
    for (let index = 0; index < uniquePartCodes.length; index += 500) {
      const chunk = uniquePartCodes.slice(index, index + 500);
      if (chunk.length === 0) {
        continue;
      }
      results.push(
        ...(await client.material.findMany({
          where: { OR: chunk.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' } })) },
          select: { id: true, partCode: true, partName: true, unit: true, partSpecification: true }
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
          drawingNo: row.drawingNo,
          drawingVersion: row.drawingVersion,
          drawingDate: this.formatDateOnly(row.drawingDate),
          drawingStatus: row.drawingStatus,
          partThickness: row.partThickness,
          projectModel: row.projectModel,
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
    const text = this.materialImportCellText(row, column).replace(/mm$/i, '').trim();
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
