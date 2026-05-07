import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { buildPinyinSearchText, normalizeSearchKeyword } from '../../common/pinyin-search';
import { decimalToNumber } from '../../common/serializers';
import { runSerializableTransaction } from '../../common/transactions';
import { PrismaService } from '../../prisma/prisma.service';
import { inventoryAdjustmentUploadPath } from '../../storage/upload-paths';
import { AdjustInventoryBatchDto, InventoryQueryDto, MaterialSuggestionQueryDto } from './dto';

type InventorySummaryAccumulator = {
  partCode: string;
  partName: string;
  unit: string;
  batchCount: number;
  warehouseIds: Set<string>;
  availableQuantity: number;
  usedQuantity: number;
  totalQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
  warehouses: Map<
    string,
    {
      warehouseId: string;
      warehouseName: string;
      availableQuantity: number;
      batchCount: number;
    }
  >;
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

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private buildInventoryWhere(query: InventoryQueryDto) {
    const where: Prisma.InventoryBatchWhereInput = {};

    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }

    if (query.customerId) {
      // 客户筛选只作用于订单库存；多做的备货库存没有客户绑定，不混入客户订单统计。
      where.sourceOrder = { customerId: query.customerId };
    }

    if (query.orderNo) {
      where.sourceOrderNo = { contains: query.orderNo, mode: 'insensitive' };
    }

    if (query.status) {
      where.status = query.status;
      if (query.status === 'AVAILABLE') {
        where.quantity = { gt: 0 };
      }
    }

    return where;
  }

  private buildInventoryOutTransactionWhere(query: InventoryQueryDto) {
    if (query.status === 'AVAILABLE') {
      return null;
    }

    const where: Prisma.InventoryTransactionWhereInput = { transactionType: 'OUT' };
    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }
    if (query.orderNo) {
      where.orderNo = { contains: query.orderNo, mode: 'insensitive' };
    }
    if (query.customerId) {
      where.batch = { sourceOrder: { customerId: query.customerId } };
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
    return buildPinyinSearchText([material.partCode, material.partName, material.unit, material.partSpecification]).includes(keyword);
  }

  private inventoryBatchMatchesKeyword(
    batch: {
      batchNo?: string | null;
      partCode?: string | null;
      partName?: string | null;
      sourceOrderNo?: string | null;
      sourceProductionTaskNo?: string | null;
      sourceCustomerName?: string | null;
      unit?: string | null;
      warehouse?: { warehouseName?: string | null } | null;
    },
    keyword?: string | null
  ) {
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    if (!normalizedKeyword) {
      return true;
    }
    // 库存搜索必须支持零件名称拼音 / 首字母，也要能按批号、订单号、任务号、客户和仓库命中。
    return buildPinyinSearchText([
      batch.batchNo,
      batch.partCode,
      batch.partName,
      batch.unit,
      batch.sourceOrderNo,
      batch.sourceProductionTaskNo,
      batch.sourceCustomerName,
      batch.warehouse?.warehouseName
    ]).includes(normalizedKeyword);
  }

  private inventoryTransactionMatchesKeyword(
    transaction: {
      partCode?: string | null;
      partName?: string | null;
      unit?: string | null;
      orderNo?: string | null;
      productionTaskNo?: string | null;
      batch?: { batchNo?: string | null; sourceCustomerName?: string | null } | null;
    },
    keyword?: string | null
  ) {
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    if (!normalizedKeyword) {
      return true;
    }
    return buildPinyinSearchText([
      transaction.partCode,
      transaction.partName,
      transaction.unit,
      transaction.orderNo,
      transaction.productionTaskNo,
      transaction.batch?.batchNo,
      transaction.batch?.sourceCustomerName
    ]).includes(normalizedKeyword);
  }

  private async findZeroInventoryMaterialRows(query: InventoryQueryDto) {
    const keyword = query.keyword?.trim();
    if (!keyword || query.status === 'USED') {
      return [];
    }
    // 关键字查到物料但没有库存批次时，也要返回 0 库存行，方便仓库确认“数据库有此物料、当前仓库无库存”。
    return this.findMaterialsByKeyword(keyword);
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
      availableQuantity: 0,
      usedQuantity: 0,
      totalQuantity: 0,
      orderInventoryQuantity: 0,
      stockInventoryQuantity: 0,
      warehouses: new Map()
    };
  }

  private async getWarehouseSnapshot(warehouseId: string) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, warehouseName: true }
    });
    return warehouse ? { warehouseId: warehouse.id, warehouseName: warehouse.warehouseName } : null;
  }

  async summary(query: InventoryQueryDto) {
    const batches = await this.prisma.inventoryBatch.findMany({
      where: this.buildInventoryWhere(query),
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
        sourceCustomerName: true,
        warehouseId: true,
        warehouse: { select: { warehouseName: true } }
      },
      orderBy: [{ partCode: 'asc' }, { partName: 'asc' }]
    });

    const summaryMap = new Map<string, InventorySummaryAccumulator>();

    for (const batch of batches.filter((item) => this.inventoryBatchMatchesKeyword(item, query.keyword))) {
      const key = this.materialSummaryKey(batch);
      const row = summaryMap.get(key) ?? this.createSummaryAccumulator(batch);

      const quantity = decimalToNumber(batch.quantity);
      const isAvailable = batch.status === 'AVAILABLE' && quantity > 0;
      row.batchCount += 1;
      row.totalQuantity += quantity;

      if (isAvailable) {
        row.availableQuantity += quantity;
        row.warehouseIds.add(batch.warehouseId);

        if (batch.sourceOrderId) {
          row.orderInventoryQuantity += quantity;
        } else {
          row.stockInventoryQuantity += quantity;
        }
      } else {
        row.usedQuantity += quantity;
      }

      const warehouseRow =
        row.warehouses.get(batch.warehouseId) ??
        {
          warehouseId: batch.warehouseId,
          warehouseName: batch.warehouse.warehouseName,
          availableQuantity: 0,
          batchCount: 0
        };
      warehouseRow.batchCount += 1;
      if (isAvailable) {
        warehouseRow.availableQuantity += quantity;
      }
      row.warehouses.set(batch.warehouseId, warehouseRow);
      summaryMap.set(key, row);
    }

    const outTransactionWhere = this.buildInventoryOutTransactionWhere(query);
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
          batch: { select: { batchNo: true, sourceCustomerName: true } }
        }
      });
      const outQuantityMap = new Map<string, { quantity: number; partCode: string; partName: string; unit: string }>();
      for (const transaction of outTransactions.filter((item) => this.inventoryTransactionMatchesKeyword(item, query.keyword))) {
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
      availableQuantity: row.availableQuantity,
      usedQuantity: row.usedQuantity,
      totalQuantity: row.totalQuantity,
      orderInventoryQuantity: row.orderInventoryQuantity,
      stockInventoryQuantity: row.stockInventoryQuantity,
      warehouses: [...row.warehouses.values()].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, 'zh-Hans-CN'))
    })).sort((a, b) => a.partCode.localeCompare(b.partCode, 'zh-Hans-CN'));
  }

  async materialSuggestions(query: MaterialSuggestionQueryDto) {
    const materials = await this.findMaterialsByKeyword(query.keyword);
    if (materials.length === 0) {
      return [];
    }

    const partCodes = materials.map((material) => material.partCode);
    const materialCodeSet = new Set(partCodes.map((partCode) => partCode.toLocaleLowerCase()));
    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        status: 'AVAILABLE',
        quantity: { gt: 0 },
        // 物料下拉允许空关键字查看完整物料清单；批次数量在内存中按物料主数据再次过滤，避免数据库结果被条数限制误导。
        ...(partCodes.length <= 500
          ? { OR: partCodes.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' } })) }
          : {}),
        warehouseId: query.warehouseId || undefined
      },
      select: {
        partCode: true,
        quantity: true,
        sourceOrderId: true
      }
    });

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
      const quantity = decimalToNumber(batch.quantity);
      row.availableQuantity += quantity;
      if (batch.sourceOrderId) {
        row.orderInventoryQuantity += quantity;
      } else {
        row.stockInventoryQuantity += quantity;
      }
      quantityMap.set(key, row);
    }

    return materials.map((material) => {
      const quantity = quantityMap.get(material.partCode.toLocaleLowerCase()) ?? {
        availableQuantity: 0,
        orderInventoryQuantity: 0,
        stockInventoryQuantity: 0
      };
      return {
        value: `${material.partCode} ${material.partName}`,
        partCode: material.partCode,
        partName: material.partName,
        unit: material.unit,
        partSpecification: material.partSpecification,
        ...quantity
      };
    });
  }

  async adjustBatchQuantity(batchId: string, dto: AdjustInventoryBatchDto) {
    const afterQuantity = Number(dto.afterQuantity);
    if (!Number.isFinite(afterQuantity) || afterQuantity < 0) {
      throw new BadRequestException('afterQuantity must be greater than or equal to 0');
    }

    const countedBy = dto.countedBy?.trim();
    const signatureName = dto.signatureName?.trim();
    if (!countedBy) {
      throw new BadRequestException('countedBy is required');
    }
    if (!signatureName) {
      throw new BadRequestException('signatureName is required');
    }
    const attachmentFileName = dto.attachmentFileName?.trim();
    const attachmentFileUrl = dto.attachmentFileUrl?.trim();
    if (!attachmentFileName || !attachmentFileUrl) {
      throw new BadRequestException('Inventory adjustment attachment is required');
    }
    const attachmentMimeType = dto.attachmentMimeType?.trim();
    this.validateAdjustmentAttachment(attachmentFileUrl, attachmentFileName, attachmentMimeType);

    const countedAt = dto.countedAt ? new Date(dto.countedAt) : new Date();
    if (Number.isNaN(countedAt.getTime())) {
      throw new BadRequestException('countedAt is invalid');
    }

    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const batch = await tx.inventoryBatch.findUnique({
          where: { id: batchId },
          include: { warehouse: true, location: true }
        });
        if (!batch) {
          throw new NotFoundException('Inventory batch not found');
        }

        const beforeQuantity = decimalToNumber(batch.quantity);
        if (batch.status !== 'AVAILABLE' && beforeQuantity > 0) {
          throw new BadRequestException('Only AVAILABLE inventory can be adjusted');
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
      throw new NotFoundException('Inventory batch not found');
    }

    const adjustments = await this.prisma.inventoryAdjustment.findMany({
      where: { batchId },
      orderBy: { createdAt: 'desc' }
    });

    return adjustments.map((adjustment) => this.toAdjustment(adjustment));
  }

  async findAll(query: InventoryQueryDto) {
    const where = this.buildInventoryWhere(query);

    const batches = (await this.prisma.inventoryBatch.findMany({
      where,
      include: {
        warehouse: true,
        location: true,
        sourceOrder: true,
        sourceOrderLine: true,
        productionTask: { include: { orderLine: true } }
      },
      orderBy: [{ createdAt: 'desc' }, { partCode: 'asc' }]
    })).filter((batch) => this.inventoryBatchMatchesKeyword(batch, query.keyword));

    const taskNos = [...new Set(batches.map((batch) => batch.sourceProductionTaskNo).filter(Boolean))] as string[];
    const sourceTasks = taskNos.length
      ? await this.prisma.productionTask.findMany({
          where: { productionTaskNo: { in: taskNos } },
          include: { orderLine: true }
        })
      : [];
    const sourceTaskMap = new Map(sourceTasks.map((task) => [task.productionTaskNo, task]));

    return batches.map((batch) => {
      const storedQuantity = decimalToNumber(batch.quantity);
      const currentQuantity = batch.status === 'AVAILABLE' ? storedQuantity : 0;

      return {
        // 库存列表需要区分订单库存和备货库存，后续发货只允许订单库存进入发货流程。
        id: batch.id,
        batchNo: batch.batchNo,
        partCode: batch.partCode,
        partName: batch.partName,
        // 批次列表的 quantity 表示当前剩余；USED 历史批次即使旧数据保留原数量，也按 0 返回。
        quantity: currentQuantity,
        canAdjust: batch.status === 'AVAILABLE' || storedQuantity === 0,
        unit: batch.unit,
        warehouseId: batch.warehouseId,
        warehouseName: batch.warehouse.warehouseName,
        locationId: batch.locationId,
        locationName: batch.location?.locationName,
        inventorySourceType: batch.sourceOrderId ? 'ORDER' : 'STOCK',
        isOrderInventory: Boolean(batch.sourceOrderId),
        sourceOrderNo: batch.sourceOrderNo,
        sourceCustomerName: batch.sourceCustomerName,
        sourceProductionTaskNo: batch.sourceProductionTaskNo,
        isReplenishment: Boolean(
          (batch.sourceProductionTaskNo && sourceTaskMap.get(batch.sourceProductionTaskNo)?.isReplenishment) ||
            batch.productionTask?.isReplenishment
        ),
        sourceReplenishmentTaskNo:
          (batch.sourceProductionTaskNo && sourceTaskMap.get(batch.sourceProductionTaskNo)?.sourceProductionTaskNo) ||
          batch.productionTask?.sourceProductionTaskNo,
        // 库存来源订单日期用于入库后继续追踪交期，不做质量追溯扩展。
        orderDate: batch.sourceOrder?.orderDate,
        deliveryDate:
          (batch.sourceProductionTaskNo && sourceTaskMap.get(batch.sourceProductionTaskNo)?.orderLine?.deliveryDate) ||
          batch.productionTask?.orderLine?.deliveryDate ||
          batch.sourceOrderLine?.deliveryDate ||
          batch.sourceOrder?.deliveryDate,
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
      throw new BadRequestException('Inventory adjustment attachment must be uploaded by system upload API');
    }

    const decodedFileName = decodeURIComponent(fileUrl.slice(adjustmentAttachmentPrefix.length));
    const storedFileName = basename(decodedFileName);
    if (!storedFileName || storedFileName !== decodedFileName) {
      throw new BadRequestException('Inventory adjustment attachment path is invalid');
    }

    const storedExtension = storedFileName.slice(storedFileName.lastIndexOf('.')).toLowerCase();
    const originalExtension = originalFileName.slice(originalFileName.lastIndexOf('.')).toLowerCase();
    if (!allowedAdjustmentExtensions.has(storedExtension) || !allowedAdjustmentExtensions.has(originalExtension)) {
      throw new BadRequestException('Inventory adjustment attachment extension is not supported');
    }
    if (!mimeType || !allowedAdjustmentMimeTypes.has(mimeType)) {
      throw new BadRequestException('Inventory adjustment attachment mimeType is not supported');
    }

    const uploadRoot = resolve(inventoryAdjustmentUploadPath());
    const fullPath = resolve(uploadRoot, storedFileName);
    if (!fullPath.startsWith(uploadRoot)) {
      throw new BadRequestException('Inventory adjustment attachment path is invalid');
    }
    if (!existsSync(fullPath)) {
      // 盘点附件必须是真实上传文件，不能手工伪造一个 URL 当作凭证。
      throw new BadRequestException('Inventory adjustment attachment file does not exist');
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
