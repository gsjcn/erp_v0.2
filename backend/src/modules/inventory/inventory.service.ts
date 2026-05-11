import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommonStatus, InventoryReservationStatus, OrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { normalizeSearchKeyword, pinyinSearchMatches } from '../../common/pinyin-search';
import { decimalToNumber } from '../../common/serializers';
import { runSerializableTransaction } from '../../common/transactions';
import { PrismaService } from '../../prisma/prisma.service';
import { inventoryAdjustmentUploadPath } from '../../storage/upload-paths';
import { AdjustInventoryBatchDto, InventoryQueryDto, InventorySourceDetailQueryDto, MaterialQueryDto, MaterialSuggestionQueryDto, UpdateMaterialDto } from './dto';

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
  constructor(private readonly prisma: PrismaService) {}

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

  private async ensureMaterialCodeAvailable(partCode: string, excludeId?: string) {
    const existing = await this.prisma.material.findFirst({
      where: {
        partCode: { equals: partCode, mode: 'insensitive' },
        id: excludeId ? { not: excludeId } : undefined
      },
      select: { id: true }
    });
    if (existing) {
      throw new BadRequestException(`物料编码 ${partCode} 已存在，请勿重复维护`);
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
    if (materials.length === 0) {
      return [];
    }

    const materialByCode = new Map(materials.map((material) => [material.partCode.trim().toLocaleLowerCase(), material]));
    const partCodeConditions = materials.map((material) => ({ partCode: { equals: material.partCode, mode: 'insensitive' as const } }));
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

    return materials.map((material) => {
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
    });
  }

  async updateMaterial(materialId: string, dto: UpdateMaterialDto) {
    const existing = await this.prisma.material.findUnique({ where: { id: materialId } });
    if (!existing) {
      throw new NotFoundException('物料基础资料不存在');
    }
    const partCode = dto.partCode !== undefined ? this.normalizeMaterialRequired(dto.partCode, '物料编码') : existing.partCode;
    const partName = dto.partName !== undefined ? this.normalizeMaterialRequired(dto.partName, '物料名称') : existing.partName;
    const unit = dto.unit !== undefined ? this.normalizeMaterialRequired(dto.unit, '单位') : existing.unit;
    if (partCode.toLocaleLowerCase() !== existing.partCode.toLocaleLowerCase()) {
      await this.ensureMaterialCodeAvailable(partCode, materialId);
    }
    return this.prisma.material.update({
      where: { id: materialId },
      data: {
        partCode,
        partName,
        unit,
        partSpecification:
          dto.partSpecification !== undefined ? String(dto.partSpecification || '').trim() || null : existing.partSpecification,
        status: dto.status || existing.status
      }
    });
  }

  async disableMaterial(materialId: string) {
    const existing = await this.prisma.material.findUnique({ where: { id: materialId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('物料基础资料不存在');
    }
    return this.prisma.material.update({
      where: { id: materialId },
      data: { status: 'DISABLED' }
    });
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
    // 关键字查到物料但没有库存批次时，也要返回 0 库存行，方便仓库确认“数据库有此物料、当前仓库无库存”。
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
        // 查询指定仓库但该物料无库存时，只展示“该仓库 0 件”，不能把它计入有库存仓库数。
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
    if (!keyword && !customerId) {
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
    const materialCodeSet = new Set(partCodes.map((partCode) => partCode.toLocaleLowerCase()));
    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        status: 'AVAILABLE',
        quantity: { gt: 0 },
        ...(sourceType === 'STOCK' ? { sourceOrderId: null } : {}),
        ...(sourceType === 'ORDER' ? { sourceOrderId: { not: null } } : {}),
        // 物料下拉允许空关键字查看完整物料清单；批次数量在内存中按物料主数据再次过滤，避免数据库结果被条数限制误导。
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
      const quantity = quantityMap.get(material.partCode.toLocaleLowerCase()) ?? {
        availableQuantity: 0,
        orderInventoryQuantity: 0,
        stockInventoryQuantity: 0
      };
      const matchHint = matchHints.get(material.partCode.toLocaleLowerCase()) || {};
      const history = historyByCode.get(material.partCode.toLocaleLowerCase());
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
      .sort((a, b) => this.compareMaterialSuggestions(a, b, Boolean(customerId)));
  }

  private async findMaterialSuggestionHistory(query: MaterialSuggestionQueryDto, keyword?: string) {
    const customerId = query.customerId?.trim();
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    const historyByCode = new Map<string, MaterialSuggestionHistory>();
    if (!customerId && !normalizedKeyword) {
      return historyByCode;
    }

    const lines = await this.prisma.orderLine.findMany({
      where: !normalizedKeyword && customerId ? { order: { customerId } } : {},
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
    return [formatted, compactDate, looseDate];
  }

  private compareMaterialSuggestions(
    left: {
      partCode: string;
      searchMatchRank?: number;
      customerUsageCount?: number;
      historyUsageCount?: number;
      availableQuantity?: number;
      lastCustomerOrderDate?: string;
    },
    right: {
      partCode: string;
      searchMatchRank?: number;
      customerUsageCount?: number;
      historyUsageCount?: number;
      availableQuantity?: number;
      lastCustomerOrderDate?: string;
    },
    preferCustomerHistory: boolean
  ) {
    const searchRankDiff = (right.searchMatchRank || 0) - (left.searchMatchRank || 0);
    if (searchRankDiff !== 0) {
      return searchRankDiff;
    }

    if (preferCustomerHistory) {
      const customerUsageDiff = (right.customerUsageCount || 0) - (left.customerUsageCount || 0);
      if (customerUsageDiff !== 0) {
        return customerUsageDiff;
      }

      const lastCustomerOrderDateDiff =
        this.sortableDateValue(right.lastCustomerOrderDate) - this.sortableDateValue(left.lastCustomerOrderDate);
      if (lastCustomerOrderDateDiff !== 0) {
        return lastCustomerOrderDateDiff;
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

    const sourceTaskMap = await this.findSourceTaskMap(batches.map((batch) => batch.sourceProductionTaskNo));
    const material = await this.prisma.material.findFirst({
      where: { partCode: { equals: normalizedPartCode, mode: 'insensitive' } }
    });
    const firstBatch = batches[0];
    const unit = query.unit?.trim() || firstBatch?.unit || material?.unit || '件';

    const sources = batches.map((batch) => this.toInventorySourceDetail(batch, sourceTaskMap, currentOrder));
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

  private buildAdjustmentNo() {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('');
    return `IA-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private buildAdjustmentTransactionNo() {
    return `IT-ADJ-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
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
