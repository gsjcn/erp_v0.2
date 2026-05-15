import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InventoryReservationStatus,
  InventoryTransactionType,
  OrderStatus,
  Prisma,
  ProductionNoticeStatus,
  ProductionNoticeTarget,
  ProductionStatus
} from '@prisma/client';
import { businessDateKey } from '../../common/business-date';
import { decimalToNumber } from '../../common/serializers';
import { runSerializableTransaction } from '../../common/transactions';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AcknowledgeWarehouseNoticeDto,
  ConfirmBatchShipmentDto,
  ConfirmReceiptDto,
  ConfirmShipmentDto,
  CreateWarehouseDto,
  CreateWarehouseLocationDto,
  UpdateWarehouseDto,
  UpdateWarehouseLocationDto,
  WarehouseNoticeQueryDto,
  WarehouseWorkQueryDto,
  WarehouseTransactionQueryDto
} from './dto';

type WarehousePrismaClient = PrismaService | Prisma.TransactionClient;
type NormalizedShipmentItem = {
  batchId: string;
  shipmentQuantity: number;
  orderLineId?: string;
};
type ShipmentTargetOrder = {
  id: string;
  orderNo: string;
};
type ShipmentTargetOrderLine = {
  id: string;
  partCode: string;
  partName: string;
  quantity: Prisma.Decimal;
  unit: string;
};
type WarehouseOperatorRow = {
  accountId: string;
  name: string;
  role: string;
  pinyin?: string | null;
  pinyinInitials?: string | null;
  keywords?: string[] | null;
};

const fallbackWarehouseOperators: WarehouseOperatorRow[] = [
  {
    accountId: 'WH-001',
    name: '周仓管',
    role: '仓库管理员',
    pinyin: 'zhoucangguan',
    pinyinInitials: 'zcg',
    keywords: ['zhou', 'cangguan', 'zcg', '仓库', '仓管', '库管', '入库', '发货']
  }
];

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  async findWarehouses() {
    const warehouses = await this.prisma.warehouse.findMany({
      include: { locations: { orderBy: { locationCode: 'asc' } } },
      orderBy: { warehouseCode: 'asc' }
    });

    return warehouses;
  }

  async warehouseNotices(query: WarehouseNoticeQueryDto = {}) {
    const where = await this.buildWarehouseNoticeWhere(query);
    const notices = await this.prisma.productionNotice.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    return this.toNoticesWithCustomerNames(notices);
  }

  async acknowledgeWarehouseNotice(id: string, dto: AcknowledgeWarehouseNoticeDto) {
    const acknowledgedBy = await this.resolveWarehouseOperatorSnapshot(dto.acknowledgedByCode, dto.acknowledgedBy, '通知');
    dto.acknowledgedBy = acknowledgedBy;

    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const notice = await tx.productionNotice.findFirst({
          where: { id, target: ProductionNoticeTarget.WAREHOUSE }
        });
        if (!notice) {
          throw new NotFoundException('仓库通知不存在');
        }
        if (notice.status !== ProductionNoticeStatus.PENDING) {
          throw new BadRequestException('仓库通知已确认，不能重复确认');
        }

        if (this.requiresWithdrawStockReceipt(notice)) {
          // 管理撤回选择“转库存”时，仓库确认通知必须同步生成备货库存和入库流水，避免通知已确认但库存账没有增加。
          await this.createStockBatchFromNotice(tx, notice, dto, {
            batchPrefix: 'IB-WITHDRAW',
            transactionPrefix: 'IT-IN-WITHDRAW',
            sourceRecordType: 'ProductionTaskWithdrawStock',
            defaultRemark: '管理撤回转入备货库存',
            requireQuantityFromNotice: true,
            sourceKind: 'NORMAL_ORDER'
          });
        } else if (this.requiresCustomerChangeHandling(notice)) {
          // 客户取消或减量后，仓库必须记录多余实物的处理方式：转备货库存、报废，或确认无实物。
          await this.applyCustomerChangeNoticeHandling(tx, notice, dto);
        }

        const saved = await tx.productionNotice.update({
          where: { id },
          data: {
            status: ProductionNoticeStatus.ACKNOWLEDGED,
            acknowledgedBy,
            acknowledgedAt: new Date()
          }
        });
        const [noticeWithCustomer] = await this.toNoticesWithCustomerNames([saved], tx);
        return noticeWithCustomer;
      },
      '当前仓库通知正在被其他操作处理，请刷新后重新确认'
    );
  }

  private requiresWithdrawStockReceipt(notice: any) {
    return (
      notice.noticeType === 'TASK_WITHDRAWN' &&
      notice.target === ProductionNoticeTarget.WAREHOUSE &&
      decimalToNumber(notice.afterQuantity) > 0
    );
  }

  private requiresCustomerChangeHandling(notice: any) {
    return (
      notice.target === ProductionNoticeTarget.WAREHOUSE &&
      (notice.noticeType === 'QUANTITY_DECREASE' || notice.noticeType === 'ORDER_CANCELLED')
    );
  }

  private async applyCustomerChangeNoticeHandling(
    tx: Prisma.TransactionClient,
    notice: any,
    dto: AcknowledgeWarehouseNoticeDto
  ) {
    const handlingMode = dto.handlingMode || 'NONE';
    const handlingQuantity = decimalToNumber(dto.handlingQuantity);

    if (!['STOCK', 'SCRAP', 'NONE'].includes(handlingMode)) {
      throw new BadRequestException('请选择仓库处理方式');
    }
    if (handlingMode !== 'NONE' && handlingQuantity <= 0) {
      throw new BadRequestException('转库存或报废时必须填写处理数量');
    }
    if (handlingMode === 'NONE' && handlingQuantity > 0) {
      throw new BadRequestException('确认无实物处理时，处理数量必须为 0');
    }
    const maxHandlingQuantity = this.customerChangeHandlingQuantityLimit(notice);
    if (handlingMode !== 'NONE' && maxHandlingQuantity <= 0) {
      throw new BadRequestException('当前客户变更通知没有可转库存或报废的处理数量');
    }
    if (handlingMode !== 'NONE' && handlingQuantity > maxHandlingQuantity + 0.0001) {
      // 客户取消/减量通知只能处理本次变更产生的多余实物，不能凭通知生成超量备货或报废记录。
      throw new BadRequestException(`处理数量不能超过本次客户变更数量 ${this.formatQuantity(maxHandlingQuantity, notice.unit)}`);
    }
    if (handlingMode === 'NONE' && maxHandlingQuantity > 0 && !dto.remark?.trim()) {
      throw new BadRequestException('确认无实物处理时必须填写备注说明');
    }

    if (handlingMode === 'STOCK') {
      await this.createStockBatchFromNotice(tx, notice, dto, {
        batchPrefix: 'IB-NOTICE',
        transactionPrefix: 'IT-IN-NOTICE',
        sourceRecordType: 'CustomerChangeStockHandling',
        defaultRemark: '客户取消或减量后转入备货库存',
        handlingQuantity,
        sourceKind: notice.noticeType === 'ORDER_CANCELLED' ? 'CANCELLED_ORDER' : 'CUSTOMER_CHANGE'
      });
      return;
    }

    if (handlingMode === 'SCRAP') {
      await this.createScrapRecordFromNotice(tx, notice, dto, handlingQuantity);
    }
  }

  private customerChangeHandlingQuantityLimit(notice: any) {
    const beforeQuantity = decimalToNumber(notice.beforeQuantity);
    const afterQuantity = decimalToNumber(notice.afterQuantity);
    const deltaQuantity = Math.abs(decimalToNumber(notice.deltaQuantity));
    const plannedHandlingQuantity = decimalToNumber(notice.handlingPlan?.handlingQuantity);
    const reducedQuantity = beforeQuantity > afterQuantity ? beforeQuantity - afterQuantity : 0;
    return this.roundQuantity(Math.max(deltaQuantity, reducedQuantity, plannedHandlingQuantity, 0));
  }

  private async createStockBatchFromNotice(
    tx: Prisma.TransactionClient,
    notice: any,
    dto: AcknowledgeWarehouseNoticeDto,
    options: {
      batchPrefix: string;
      transactionPrefix: string;
      sourceRecordType: string;
      defaultRemark: string;
      requireQuantityFromNotice?: boolean;
      handlingQuantity?: number;
      sourceKind?: string;
    }
  ) {
    const quantity = options.requireQuantityFromNotice ? decimalToNumber(notice.afterQuantity) : decimalToNumber(options.handlingQuantity);
    if (quantity <= 0) {
      throw new BadRequestException('转入库存数量必须大于 0');
    }
    if (!notice.partCode || !notice.partName || !notice.unit || !notice.productionTaskNo) {
      throw new BadRequestException('仓库转库存通知缺少零件或生产任务信息');
    }
    if (!dto.warehouseId?.trim()) {
      throw new BadRequestException('转入库存时必须选择仓库');
    }
    if (!dto.locationId?.trim()) {
      throw new BadRequestException('转入库存时必须选择库位');
    }

    const existingTransaction = await tx.inventoryTransaction.findFirst({
      where: {
        sourceRecordType: options.sourceRecordType,
        sourceRecordId: notice.id
      },
      select: { id: true }
    });
    if (existingTransaction) {
      return;
    }

    const target = await this.resolveTargetLocationWithClient(tx, dto.warehouseId, dto.locationId);
    const sourceKind = options.sourceKind || 'NORMAL_ORDER';
    await this.ensureMergeConfirmedForMixedStock(tx, notice, target.warehouseId, sourceKind, dto.mergeConfirmed);
    const sourceOrder = notice.orderId
      ? await tx.customerOrder.findUnique({
          where: { id: notice.orderId },
          select: { orderNo: true, customerName: true }
        })
      : null;
    const batchNo = `${options.batchPrefix}-${notice.noticeNo}`;
    const transactionNo = `${options.transactionPrefix}-${notice.noticeNo}`;
    const batch = await tx.inventoryBatch.upsert({
      where: { batchNo },
      update: {},
      create: {
        batchNo,
        partCode: notice.partCode,
        partName: notice.partName,
        sourceOrderId: null,
        sourceOrderNo: sourceOrder?.orderNo || notice.orderNo || null,
        sourceCustomerName: sourceOrder?.customerName || null,
        productionTaskId: null,
        sourceProductionTaskNo: notice.productionTaskNo,
        sourceKind,
        quantity,
        unit: notice.unit,
        warehouseId: target.warehouseId,
        locationId: target.locationId,
        status: 'AVAILABLE'
      }
    });

    await tx.inventoryTransaction.upsert({
      where: { transactionNo },
      update: {},
      create: {
        transactionNo,
        transactionType: 'IN',
        batchId: batch.id,
        partCode: notice.partCode,
        partName: notice.partName,
        orderNo: null,
        productionTaskNo: notice.productionTaskNo,
        quantity,
        unit: notice.unit,
        warehouseId: target.warehouseId,
        locationId: target.locationId,
        remark: this.formatWarehouseNoticeHandlingRemark(dto, notice.reason || options.defaultRemark),
        sourceRecordType: options.sourceRecordType,
        sourceRecordId: notice.id
      }
    });
  }

  private formatWarehouseNoticeHandlingRemark(dto: AcknowledgeWarehouseNoticeDto, defaultRemark: string) {
    return [dto.remark?.trim() || defaultRemark, dto.acknowledgedBy?.trim() ? `仓库确认人：${dto.acknowledgedBy.trim()}` : '']
      .filter(Boolean)
      .join('；');
  }

  private async ensureMergeConfirmedForMixedStock(
    tx: Prisma.TransactionClient,
    notice: any,
    warehouseId: string,
    sourceKind: string,
    mergeConfirmed?: boolean
  ) {
    if (!['CANCELLED_ORDER', 'CUSTOMER_CHANGE'].includes(sourceKind)) {
      return;
    }

    const existingMixedStock = await tx.inventoryBatch.findFirst({
      where: {
        partCode: { equals: notice.partCode, mode: 'insensitive' },
        unit: notice.unit,
        warehouseId,
        status: 'AVAILABLE',
        quantity: { gt: 0 },
        sourceOrderId: null,
        sourceKind: { not: sourceKind }
      },
      select: { batchNo: true, sourceKind: true, sourceOrderNo: true }
    });

    if (existingMixedStock && !mergeConfirmed) {
      throw new BadRequestException(
        `库存来源混合需要确认。已有批次 ${existingMixedStock.batchNo} 的来源类型为 ${existingMixedStock.sourceKind}`
      );
    }
  }

  private async createScrapRecordFromNotice(
    tx: Prisma.TransactionClient,
    notice: any,
    dto: AcknowledgeWarehouseNoticeDto,
    quantity: number
  ) {
    if (!notice.partCode || !notice.partName || !notice.unit) {
      throw new BadRequestException('仓库报废通知缺少零件信息');
    }

    await tx.productionScrapRecord.upsert({
      where: {
        sourceRecordType_sourceRecordId: {
          sourceRecordType: 'CustomerChangeWarehouseScrap',
          sourceRecordId: notice.id
        }
      },
      update: {},
      create: {
        scrapNo: await this.generateNextScrapNo(tx),
        orderId: notice.orderId,
        orderNo: notice.orderNo,
        orderLineId: notice.orderLineId,
        productionTaskId: notice.productionTaskId,
        productionTaskNo: notice.productionTaskNo,
        partCode: notice.partCode,
        partName: notice.partName,
        quantity,
        unit: notice.unit,
        reason: this.formatWarehouseNoticeHandlingRemark(dto, `仓库按客户取消或减量处理报废：${notice.reason}`),
        sourceRecordType: 'CustomerChangeWarehouseScrap',
        sourceRecordId: notice.id,
        recordDate: new Date()
      }
    });
  }

  async createWarehouse(dto: CreateWarehouseDto) {
    if (!dto.warehouseName?.trim()) {
      throw new BadRequestException('请填写仓库名称');
    }

    const warehouseCode = dto.warehouseCode?.trim()
      ? this.normalizeBusinessCode(dto.warehouseCode, '请填写仓库编码')
      : await this.generateWarehouseCode();
    await this.ensureWarehouseCodeAvailable(warehouseCode);

    // 第一阶段只维护仓库基础资料，保持仓库编码和库位编码可迁移、可查重。
    try {
      return await this.prisma.warehouse.create({
        data: {
          warehouseCode,
          warehouseName: dto.warehouseName.trim()
        },
        include: { locations: { orderBy: { locationCode: 'asc' } } }
      });
    } catch (error) {
      if (this.isDuplicateWarehouseCodeError(error)) {
        throw new BadRequestException(`仓库编码 ${warehouseCode} 已存在`);
      }
      throw error;
    }
  }

  async updateWarehouse(warehouseId: string, dto: UpdateWarehouseDto) {
    const existing = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: { locations: { orderBy: { locationCode: 'asc' } } }
    });
    if (!existing) {
      throw new NotFoundException('仓库不存在');
    }

    const data: Prisma.WarehouseUpdateInput = {};
    if (dto.warehouseCode !== undefined) {
      const warehouseCode = this.normalizeBusinessCode(dto.warehouseCode, '请填写仓库编码');
      await this.ensureWarehouseCodeAvailable(warehouseCode, warehouseId);
      data.warehouseCode = warehouseCode;
    }
    if (dto.warehouseName !== undefined) {
      const warehouseName = dto.warehouseName.trim();
      if (!warehouseName) {
        throw new BadRequestException('请填写仓库名称');
      }
      data.warehouseName = warehouseName;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (Object.keys(data).length === 0) {
      return existing;
    }

    if (data.status === 'DISABLED') {
      return runSerializableTransaction(
        this.prisma,
        async (tx) => {
          await tx.warehouse.update({
            where: { id: warehouseId },
            data
          });
          // 仓库停用后，该仓库下的启用库位也不得继续作为新入库或转库存候选；历史库存来源仍保留原仓库/库位名称。
          await tx.warehouseLocation.updateMany({
            where: { warehouseId, status: 'ENABLED' },
            data: { status: 'DISABLED' }
          });
          const refreshed = await tx.warehouse.findUnique({
            where: { id: warehouseId },
            include: { locations: { orderBy: { locationCode: 'asc' } } }
          });
          if (!refreshed) {
            throw new NotFoundException('仓库不存在');
          }
          return refreshed;
        },
        '仓库状态正在被其他业务修改，请刷新后重新停用'
      );
    }

    // 仓库停用只影响后续入库/发货选择，历史库存批次和库存流水必须继续保留。
    return this.prisma.warehouse.update({
      where: { id: warehouseId },
      data,
      include: { locations: { orderBy: { locationCode: 'asc' } } }
    });
  }

  async deleteWarehouse(warehouseId: string) {
    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const warehouse = await tx.warehouse.findUnique({
          where: { id: warehouseId },
          include: { locations: true }
        });
        if (!warehouse) {
          throw new NotFoundException('仓库不存在');
        }
        const locationIds = warehouse.locations.map((item) => item.id);
        const [batchCount, transactionCount, locationBatchCount, locationTransactionCount] = await Promise.all([
          tx.inventoryBatch.count({ where: { warehouseId } }),
          tx.inventoryTransaction.count({ where: { warehouseId } }),
          locationIds.length > 0 ? tx.inventoryBatch.count({ where: { locationId: { in: locationIds } } }) : Promise.resolve(0),
          locationIds.length > 0 ? tx.inventoryTransaction.count({ where: { locationId: { in: locationIds } } }) : Promise.resolve(0)
        ]);
        if (batchCount + transactionCount + locationBatchCount + locationTransactionCount > 0) {
          throw new BadRequestException('该仓库已有库存批次或库存流水，只能停用，不能删除');
        }
        // 只有完全没有库存批次和库存流水历史的空仓库允许物理删除。
        await tx.warehouse.delete({ where: { id: warehouseId } });
        return { deleted: true };
      },
      '仓库正在被其他业务写入，请刷新后重新删除'
    );
  }

  async createLocation(warehouseId: string, dto: CreateWarehouseLocationDto) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      throw new NotFoundException('仓库不存在');
    }
    if (warehouse.status !== 'ENABLED') {
      // 停用仓库不允许新增后续可选库位，避免基础配置绕过仓库停用边界。
      throw new BadRequestException('停用仓库不能新增库位，请先启用仓库');
    }

    const locationCode = this.normalizeBusinessCode(dto.locationCode, '请填写库位编码');
    await this.ensureLocationCodeAvailable(warehouseId, locationCode);

    // 库位只作为第一阶段库存定位字段，后续不在这里引入复杂库区规则。
    try {
      return await this.prisma.warehouseLocation.create({
        data: {
          warehouseId,
          locationCode,
          locationName: dto.locationName?.trim() || locationCode
        }
      });
    } catch (error) {
      if (this.isDuplicateLocationCodeError(error)) {
        throw new BadRequestException(`当前仓库已存在库位编码 ${locationCode}`);
      }
      throw error;
    }
  }

  async updateLocation(warehouseId: string, locationId: string, dto: UpdateWarehouseLocationDto) {
    const existing = await this.prisma.warehouseLocation.findFirst({
      where: { id: locationId, warehouseId },
      include: { warehouse: true }
    });
    if (!existing) {
      throw new NotFoundException('库位不存在');
    }

    const data: Prisma.WarehouseLocationUpdateInput = {};
    if (dto.locationCode !== undefined) {
      const locationCode = this.normalizeBusinessCode(dto.locationCode, '请填写库位编码');
      await this.ensureLocationCodeAvailable(warehouseId, locationCode, locationId);
      data.locationCode = locationCode;
    }
    if (dto.locationName !== undefined) {
      data.locationName = dto.locationName.trim() || (typeof data.locationCode === 'string' ? data.locationCode : existing.locationCode);
    }
    if (dto.status !== undefined) {
      if (dto.status === 'ENABLED' && existing.warehouse.status !== 'ENABLED') {
        // 库位恢复启用前必须先启用所属仓库，避免停用仓库下出现新的可选库位。
        throw new BadRequestException('停用仓库下的库位不能启用，请先启用所属仓库');
      }
      data.status = dto.status;
    }
    if (Object.keys(data).length === 0) {
      return existing;
    }

    // 库位停用只影响后续选择，不修改历史批次、流水和订单来源。
    return this.prisma.warehouseLocation.update({
      where: { id: locationId },
      data
    });
  }

  async deleteLocation(warehouseId: string, locationId: string) {
    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const existing = await tx.warehouseLocation.findFirst({ where: { id: locationId, warehouseId } });
        if (!existing) {
          throw new NotFoundException('库位不存在');
        }
        const [batchCount, transactionCount] = await Promise.all([
          tx.inventoryBatch.count({ where: { locationId } }),
          tx.inventoryTransaction.count({ where: { locationId } })
        ]);
        if (batchCount + transactionCount > 0) {
          throw new BadRequestException('该库位已有库存批次或库存流水，只能停用，不能删除');
        }
        // 只有完全没有库存批次和库存流水历史的空库位允许物理删除。
        await tx.warehouseLocation.delete({ where: { id: locationId } });
        return { deleted: true };
      },
      '库位正在被其他业务写入，请刷新后重新删除'
    );
  }

  private normalizeWarehouseOperatorKeyword(value: string) {
    return value.trim().toLowerCase().replace(/[\s\-_./\\（）()]+/g, '');
  }

  private async loadWarehouseOperators(client: WarehousePrismaClient = this.prisma) {
    try {
      const rows = await client.productionOperator.findMany({
        where: { status: 'ENABLED' },
        orderBy: [{ accountId: 'asc' }]
      });
      const existingAccountIds = new Set(rows.map((operator) => operator.accountId.toLowerCase()));
      return [
        ...rows.map((operator) => ({
          accountId: operator.accountId,
          name: operator.name,
          role: operator.role,
          pinyin: operator.pinyin,
          pinyinInitials: operator.pinyinInitials,
          keywords: operator.keywords || []
        })),
        ...fallbackWarehouseOperators.filter((operator) => !existingAccountIds.has(operator.accountId.toLowerCase()))
      ];
    } catch {
      return fallbackWarehouseOperators;
    }
  }

  private isWarehouseOperator(operator: WarehouseOperatorRow) {
    const tokens = [
      operator.role,
      operator.name,
      operator.accountId,
      operator.pinyin,
      operator.pinyinInitials,
      ...(operator.keywords || [])
    ]
      .filter(Boolean)
      .map((value) => this.normalizeWarehouseOperatorKeyword(String(value)));
    return tokens.some((token) => token.includes('仓库') || token.includes('仓管') || token.includes('库管') || token.includes('cangguan'));
  }

  private formatWarehouseOperatorSnapshot(operator: WarehouseOperatorRow) {
    return `${operator.name}（${operator.accountId} / ${operator.role}）`;
  }

  private async resolveWarehouseOperatorSnapshot(
    operatorCode: string | undefined,
    operatorText: string | undefined,
    actionName: string,
    client: WarehousePrismaClient = this.prisma
  ) {
    const operators = (await this.loadWarehouseOperators(client)).filter((operator) => this.isWarehouseOperator(operator));
    const normalizedCode = this.normalizeWarehouseOperatorKeyword(operatorCode || '');
    if (normalizedCode) {
      const operator = operators.find((item) => this.normalizeWarehouseOperatorKeyword(item.accountId) === normalizedCode);
      if (!operator) {
        throw new BadRequestException(`请选择有效的${actionName}仓库确认人账号`);
      }
      return this.formatWarehouseOperatorSnapshot(operator);
    }

    const normalizedText = this.normalizeWarehouseOperatorKeyword(operatorText || '');
    if (!normalizedText) {
      throw new BadRequestException(`请选择${actionName}仓库确认人`);
    }

    const matched = operators.filter((operator) =>
      [
        operator.accountId,
        operator.name,
        this.formatWarehouseOperatorSnapshot(operator)
      ].some((value) => this.normalizeWarehouseOperatorKeyword(value) === normalizedText)
    );
    if (matched.length !== 1) {
      throw new BadRequestException(`请选择有效的${actionName}仓库确认人账号`);
    }
    return this.formatWarehouseOperatorSnapshot(matched[0]);
  }

  async pendingReceipts(query: WarehouseWorkQueryDto) {
    const where: Prisma.ProductionTaskWhereInput = {
      status: ProductionStatus.COMPLETED,
      inventoryBatch: null
    };
    const orderWhere = this.buildOrderWhere(query);
    if (Object.keys(orderWhere).length > 0) {
      // 待入库按订单关系筛选，避免仓库页面直接暴露不相关客户订单。
      where.order = orderWhere;
    }
    if (query.orderNo) {
      where.orderNo = { contains: query.orderNo.trim(), mode: 'insensitive' };
    }

    const tasks = await this.prisma.productionTask.findMany({
      where,
      include: { order: true, orderLine: true },
      orderBy: [{ completedAt: 'desc' }, { productionTaskNo: 'asc' }]
    });
    const receivedQuantityMap = await this.getReceivedOrderQuantityMap(tasks.map((task) => task.orderLineId));

    return tasks.map((task) => this.toReceipt(task, '待入库', receivedQuantityMap.get(task.orderLineId) ?? 0));
  }

  async confirmReceipt(productionTaskId: string, dto: ConfirmReceiptDto) {
    const target = await this.resolveTargetLocation(dto);
    const warehouseConfirmedBy = await this.resolveWarehouseOperatorSnapshot(
      dto.warehouseConfirmedByCode,
      dto.warehouseConfirmedBy,
      '入库'
    );
    const receiptRemark = this.formatReceiptRemark(dto, warehouseConfirmedBy, '生产完成确认入库');
    const stockReceiptRemark = this.formatReceiptRemark(dto, warehouseConfirmedBy, '生产超计划数量转库存');

    // 仓库确认入库时按当前零件的客户订单剩余未入库数量拆分，补单或多做超出的部分转为备货库存。
    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const task = await tx.productionTask.findUnique({
          where: { id: productionTaskId },
          include: { order: true, orderLine: true }
        });
        if (!task) {
          throw new NotFoundException('生产任务不存在');
        }
        if (task.status !== ProductionStatus.COMPLETED) {
          throw new BadRequestException('只有已完成生产的任务才能入库');
        }

        const existing = await tx.inventoryBatch.findUnique({
          where: { productionTaskId },
          include: { warehouse: true, location: true }
        });
        if (existing) {
          await tx.productionTask.update({
            where: { id: task.id },
            data: { status: ProductionStatus.STORED }
          });
          return existing;
        }

        const completedQuantity = decimalToNumber(task.completedQuantity);
        // 入库确认必须在同一个事务里重新计算订单剩余未入库数量，避免并发入库把多做数量误算进订单库存。
        if (completedQuantity <= 0) {
          throw new BadRequestException('入库前完成数量必须大于 0');
        }
        const customerOrderQuantity = decimalToNumber(task.orderLine.quantity);
        const receivedOrderQuantity = await this.getReceivedOrderQuantity(task.orderLineId, tx);
        const remainingOrderQuantity = Math.max(customerOrderQuantity - receivedOrderQuantity, 0);
        const orderQuantity = Math.min(completedQuantity, remainingOrderQuantity);
        const stockQuantity = Math.max(completedQuantity - orderQuantity, 0);
        const batchNo = `IB-${task.productionTaskNo}`;
        const stockBatchNo = `IB-STOCK-${task.productionTaskNo}`;
        const transactionNo = `IT-IN-${task.productionTaskNo}`;
        const stockTransactionNo = `IT-IN-STOCK-${task.productionTaskNo}`;
        let batch = null;
        if (orderQuantity > 0) {
          batch = await tx.inventoryBatch.create({
            data: {
              batchNo,
              partCode: task.partCode,
              partName: task.partName,
              sourceOrderId: task.orderId,
              sourceOrderLineId: task.orderLineId,
              sourceOrderNo: task.orderNo,
              sourceCustomerName: task.customerName,
              productionTaskId: task.id,
              sourceProductionTaskNo: task.productionTaskNo,
              sourceKind: 'NORMAL_ORDER',
              // 库存批次保留补单来源，避免后续发货或借用库存时丢失生产报废补单 / 订单补单区别。
              replenishmentSourceType: task.replenishmentSourceType,
              replenishmentSourceRequestNo: task.replenishmentSourceRequestNo,
              quantity: orderQuantity,
              unit: task.unit,
              warehouseId: target.warehouseId,
              locationId: target.locationId,
              status: 'AVAILABLE'
            },
            include: { warehouse: true, location: true }
          });

          await tx.inventoryTransaction.create({
            data: {
              transactionNo,
              transactionType: 'IN',
              batchId: batch.id,
              orderLineId: task.orderLineId,
              partCode: task.partCode,
              partName: task.partName,
              orderNo: task.orderNo,
              productionTaskNo: task.productionTaskNo,
              quantity: orderQuantity,
              unit: task.unit,
              warehouseId: target.warehouseId,
              locationId: target.locationId,
              remark: receiptRemark,
              sourceRecordType: 'ProductionTask',
              sourceRecordId: task.id
            }
          });
        }

        if (stockQuantity > 0) {
          const stockBatch = await tx.inventoryBatch.create({
            data: {
              batchNo: stockBatchNo,
              partCode: task.partCode,
              partName: task.partName,
              sourceOrderId: null,
              sourceOrderNo: null,
              sourceCustomerName: task.customerName,
              productionTaskId: orderQuantity > 0 ? null : task.id,
              sourceProductionTaskNo: task.productionTaskNo,
              sourceKind: 'NORMAL_ORDER',
              // 多做转库存也必须继承原生产任务的补单来源，后续库存合并时才能核对来源构成。
              replenishmentSourceType: task.replenishmentSourceType,
              replenishmentSourceRequestNo: task.replenishmentSourceRequestNo,
              quantity: stockQuantity,
              unit: task.unit,
              warehouseId: target.warehouseId,
              locationId: target.locationId,
              status: 'AVAILABLE'
            },
            include: { warehouse: true, location: true }
          });

          await tx.inventoryTransaction.create({
            data: {
              transactionNo: stockTransactionNo,
              transactionType: 'IN',
              batchId: stockBatch.id,
              partCode: task.partCode,
              partName: task.partName,
              orderNo: null,
              productionTaskNo: task.productionTaskNo,
              quantity: stockQuantity,
              unit: task.unit,
              warehouseId: target.warehouseId,
              locationId: target.locationId,
              remark: stockReceiptRemark,
              sourceRecordType: 'ProductionTaskOverage',
              sourceRecordId: task.id
            }
          });

          await tx.productionTask.update({
            where: { id: task.id },
            data: { status: ProductionStatus.STORED }
          });

          return { orderBatch: batch, stockBatch };
        }

        await tx.productionTask.update({
          where: { id: task.id },
          data: { status: ProductionStatus.STORED }
        });

        return { orderBatch: batch, stockBatch: null };
      },
      '当前生产任务或订单库存正在被其他入库操作修改，请刷新后重新入库'
    );
  }

  async pendingShipments(query: WarehouseWorkQueryDto) {
    const where: Prisma.InventoryBatchWhereInput = {
      status: 'AVAILABLE',
      sourceOrderId: { not: null },
      quantity: { gt: 0 }
    };
    const orderWhere: Prisma.CustomerOrderWhereInput = {
      ...this.buildOrderWhere(query),
      status: { notIn: [OrderStatus.DRAFT, OrderStatus.CANCELLED, OrderStatus.COMPLETED] }
    };
    // 待发货库存只展示仍可流转的订单，已取消或已完成发货的历史订单不能再次发货。
    where.sourceOrder = orderWhere;
    if (query.orderNo) {
      const orderNo = query.orderNo.trim();
      // 待发货可按当前绑定订单、原生产任务号或原生产订单检索，避免备货库存绑定新订单后丢失来源查询能力。
      where.OR = [
        { sourceOrderNo: { contains: orderNo, mode: 'insensitive' } },
        { sourceProductionTaskNo: { contains: orderNo, mode: 'insensitive' } },
        { replenishmentSourceRequestNo: { contains: orderNo, mode: 'insensitive' } },
        { productionTask: { is: { orderNo: { contains: orderNo, mode: 'insensitive' } } } }
      ];
    }

    const batches = await this.prisma.inventoryBatch.findMany({
      where,
      include: {
          warehouse: true,
          location: true,
          sourceOrder: true,
          sourceOrderLine: true,
          productionTask: { include: { order: true, orderLine: true } }
        },
      orderBy: [{ createdAt: 'desc' }, { batchNo: 'asc' }]
    });

    const shippedQuantityByLine = await this.getShippedOrderQuantityMap(
      batches.map((batch) => batch.sourceOrderLineId).filter((id): id is string => Boolean(id))
    );

    const remainingSuggestionQuantityByLine = new Map<string, number>();
    return batches.map((batch) => this.toShipment(batch, shippedQuantityByLine, remainingSuggestionQuantityByLine));
  }

  async confirmShipment(batchId: string, dto: ConfirmShipmentDto) {
    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const batch = await tx.inventoryBatch.findUnique({
          where: { id: batchId },
          select: { sourceOrderId: true }
        });
        if (!batch) {
          throw new NotFoundException('库存批次不存在');
        }
        if (batch.sourceOrderId) {
          await this.assertOrderHasNoPendingShortage(tx, batch.sourceOrderId, '单批发货');
        }
        const shipped = await this.shipOneBatch(tx, batchId, dto);
        if (shipped.sourceOrderId) {
          await this.refreshOrderShipmentStatus(tx, shipped.sourceOrderId);
        }
        return shipped;
      },
      '当前库存批次正在被其他发货操作修改，请刷新后重新发货'
    );
  }

  async confirmBatchShipment(dto: ConfirmBatchShipmentDto) {
    const batchShipmentRequest = this.normalizeBatchShipmentRequest(dto);
    const batchIds = batchShipmentRequest.batchIds;
    if (batchIds.length === 0) {
      throw new BadRequestException('请选择需要发货的库存批次');
    }

    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const batches = await tx.inventoryBatch.findMany({
          where: { id: { in: batchIds } },
          select: { id: true, sourceOrderId: true, sourceOrderNo: true }
        });
        if (batches.length !== batchIds.length) {
          throw new NotFoundException('部分库存批次不存在');
        }
        const orderIds = Array.from(
          new Set(batches.map((batch) => batch.sourceOrderId).filter((value): value is string => Boolean(value)))
        );
        if (batches.some((batch) => !batch.sourceOrderId)) {
          throw new BadRequestException('批量发货只能选择订单库存；备货库存超发请从订单发货中处理');
        }
        if (orderIds.length !== 1) {
          throw new BadRequestException('批量发货只能选择同一个订单的库存批次');
        }
        await this.assertOrderHasNoPendingShortage(tx, orderIds[0], '批量发货');

        // 批量发货仍逐批写 OUT 流水，但必须放在同一事务里，保证同一订单多零件出库状态一致。
        const shipped = [];
        for (const batchId of batchIds) {
          shipped.push(
            await this.shipOneBatch(tx, batchId, {
              ...dto,
              shipmentQuantity: batchShipmentRequest.quantityByBatchId.get(batchId) ?? dto.shipmentQuantity,
              remark: dto.remark || '按订单批量发货'
            })
          );
        }
        await this.refreshOrderShipmentStatus(tx, orderIds[0]);
        return {
          orderId: orderIds[0],
          shippedCount: shipped.length,
          shipped
        };
      },
      '当前订单库存正在被其他发货操作修改，请刷新后重新发货'
    );
  }

  async confirmOrderShipment(orderNo: string, dto: ConfirmShipmentDto) {
    const normalizedOrderNo = orderNo.trim();
    if (!normalizedOrderNo) {
      throw new BadRequestException('请提供订单号');
    }
    const orderShipmentRequest = this.normalizeShipmentItems(dto);
    if (orderShipmentRequest.hasExplicitQuantities && orderShipmentRequest.batchIds.length === 0) {
      throw new BadRequestException('请填写本次发货数量');
    }

    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const order = await tx.customerOrder.findFirst({
          where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
          select: {
            id: true,
            orderNo: true,
            status: true,
            lines: {
              select: {
                id: true,
                partCode: true,
                partName: true,
                quantity: true,
                unit: true
              }
            }
          }
        });
        if (!order) {
          throw new NotFoundException('订单不存在');
        }
        if (order.status === 'CANCELLED') {
          throw new BadRequestException('已取消订单不能发货');
        }
        if (order.status === 'DRAFT') {
          throw new BadRequestException('待提交生产订单不能发货，请先提交生产并形成待发货库存');
        }
        if (order.status === 'COMPLETED') {
          throw new BadRequestException('已完成发货订单不能再次发货');
        }
        await this.assertOrderHasNoPendingShortage(tx, order.id, '整单发货');

        const batches = await tx.inventoryBatch.findMany({
          where: orderShipmentRequest.hasExplicitQuantities
            ? {
                id: { in: orderShipmentRequest.batchIds },
                status: 'AVAILABLE',
                quantity: { gt: 0 },
                OR: [{ sourceOrderId: order.id }, { sourceOrderId: null }]
              }
            : {
                sourceOrderId: order.id,
                status: 'AVAILABLE',
                quantity: { gt: 0 }
              },
          select: { id: true, sourceOrderId: true, partCode: true, partName: true, quantity: true, unit: true },
          orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }]
        });
        if (orderShipmentRequest.hasExplicitQuantities && batches.length !== orderShipmentRequest.batchIds.length) {
          throw new BadRequestException('部分发货库存批次不存在、不可发货，或既不属于当前订单也不是备货库存');
        }
        if (batches.length === 0) {
          throw new BadRequestException('该订单没有待发货库存');
        }
        if (batches.some((batch) => !batch.sourceOrderId)) {
          if (!dto.salesConfirmedBy?.trim()) {
            throw new BadRequestException('订单发货使用备货库存时，必须填写销售确认人');
          }
          if (!dto.overShipmentReason?.trim()) {
            throw new BadRequestException('订单发货使用备货库存时，必须填写超发或客户追加发货说明');
          }
        }

        const shipped = [];
        const shipmentBatches = [...batches].sort((a, b) => Number(!a.sourceOrderId) - Number(!b.sourceOrderId));
        for (const batch of shipmentBatches) {
          const shipmentItem = orderShipmentRequest.itemByBatchId.get(batch.id);
          shipped.push(
            await this.shipOneBatch(
              tx,
              batch.id,
              {
                ...dto,
                shipmentQuantity: shipmentItem?.shipmentQuantity ?? dto.shipmentQuantity,
                remark: dto.remark || '按订单本次发货'
              },
              batch.sourceOrderId
                ? undefined
                : {
                    targetOrder: { id: order.id, orderNo: order.orderNo },
                    targetOrderLine: this.resolveStockShipmentTargetLine(order, batch, shipmentItem)
                  }
            )
          );
        }
        await this.refreshOrderShipmentStatus(tx, order.id);
        return {
          orderId: order.id,
          orderNo: order.orderNo,
          shippedCount: shipped.length,
          shipped
        };
      },
      '当前订单库存正在被其他发货操作修改，请刷新后重新整单发货'
    );
  }

  async findTransactions(query: WarehouseTransactionQueryDto) {
    const where: Prisma.InventoryTransactionWhereInput = {};
    if (query.transactionType) {
      where.transactionType = query.transactionType;
    }

    const scopedWhere = await this.buildWarehouseTransactionScopeWhere(query);
    if (scopedWhere) {
      where.AND = Array.isArray(where.AND)
        ? [...where.AND, scopedWhere]
        : where.AND
          ? [where.AND, scopedWhere]
          : [scopedWhere];
    }

    const transactions = await this.prisma.inventoryTransaction.findMany({
      where,
      include: {
        warehouse: true,
        location: true,
        batch: {
          include: {
            sourceOrder: true,
            sourceOrderLine: true,
            productionTask: { include: { order: true, orderLine: true } },
            reservations: {
              where: { status: InventoryReservationStatus.ACTIVE },
              select: { quantity: true }
            }
          }
        }
      },
      orderBy: { transactionTime: 'desc' }
    });

    const sourceTaskMap = await this.findWarehouseSourceTaskMap(
      transactions.flatMap((item) => [item.productionTaskNo, item.batch?.sourceProductionTaskNo])
    );

    return transactions.map((item) => {
      const sourceTask = this.resolveWarehouseTransactionSourceTask(item, sourceTaskMap);
      const sourceLine = this.resolveWarehouseTransactionSourceLine(item, sourceTask);
      const batchPhysicalQuantity = item.batch?.status === 'AVAILABLE' ? decimalToNumber(item.batch.quantity) : 0;
      const batchReservedQuantity =
        item.batch && !item.batch.sourceOrderId
          ? item.batch.reservations.reduce((sum, reservation) => sum + decimalToNumber(reservation.quantity), 0)
          : 0;
      const batchAvailableQuantity = Math.max(
        Math.round((batchPhysicalQuantity - batchReservedQuantity + Number.EPSILON) * 1000) / 1000,
        0
      );
      const sourceOrderNo =
        item.orderNo ||
        item.batch?.sourceOrderNo ||
        item.batch?.sourceOrder?.orderNo ||
        item.batch?.productionTask?.orderNo ||
        sourceTask?.orderNo ||
        sourceTask?.order?.orderNo ||
        null;
      return {
        id: item.id,
        transactionNo: item.transactionNo,
        transactionType: item.transactionType,
        partCode: item.partCode,
        partName: item.partName,
        lineType: sourceLine?.lineType || undefined,
        partCategory: sourceLine?.partCategory || undefined,
        componentNo: sourceLine?.componentNo || undefined,
        parentComponentNo: sourceLine?.parentComponentNo || undefined,
        importSequence: sourceLine?.importSequence || undefined,
        orderNo: item.orderNo,
        sourceOrderNo,
        productionSourceOrderNo: sourceTask?.orderNo || sourceTask?.order?.orderNo || item.batch?.productionTask?.orderNo || null,
        batchId: item.batchId,
        batchNo: item.batch?.batchNo,
        batchStatus: item.batch?.status,
        physicalQuantity: item.batch ? batchPhysicalQuantity : null,
        reservedQuantity: item.batch ? batchReservedQuantity : null,
        availableQuantity: item.batch ? batchAvailableQuantity : null,
        productionTaskNo: item.productionTaskNo || item.batch?.sourceProductionTaskNo,
        quantity: decimalToNumber(item.quantity),
        unit: item.unit,
        warehouseName: item.warehouse.warehouseName,
        locationName: item.location?.locationName,
        transactionTime: item.transactionTime,
        remark: item.remark
      };
    });
  }

  private async buildWarehouseTransactionScopeWhere(query: WarehouseTransactionQueryDto) {
    const hasOrderScope = Boolean(query.customerId || query.orderNo?.trim() || query.dateFrom || query.dateTo);
    if (!hasOrderScope) {
      return null;
    }

    const orderWhere = this.buildOrderWhere(query);
    const orderNo = query.orderNo?.trim();
    const scopedOrderWhere = { ...orderWhere };
    if (orderNo) {
      scopedOrderWhere.orderNo = { contains: orderNo, mode: 'insensitive' };
    }

    const orders = await this.prisma.customerOrder.findMany({
      where: scopedOrderWhere,
      select: { orderNo: true }
    });
    const orderNos = new Set(orders.map((order) => order.orderNo));

    const taskWhere: Prisma.ProductionTaskWhereInput = {};
    if (Object.keys(orderWhere).length > 0) {
      taskWhere.order = orderWhere;
    }
    if (orderNo) {
      taskWhere.OR = [
        { orderNo: { contains: orderNo, mode: 'insensitive' } },
        { productionTaskNo: { contains: orderNo, mode: 'insensitive' } }
      ];
    }
    const tasks = await this.prisma.productionTask.findMany({
      where: taskWhere,
      select: { orderNo: true, productionTaskNo: true }
    });
    const productionTaskNos = new Set(tasks.map((task) => task.productionTaskNo));
    tasks.forEach((task) => orderNos.add(task.orderNo));

    const orderNoList = [...orderNos].filter(Boolean);
    const productionTaskNoList = [...productionTaskNos].filter(Boolean);
    const or: Prisma.InventoryTransactionWhereInput[] = [];
    if (orderNo) {
      // 仓库流水可能是订单库存、备货库存、补单库存或订单库存发货，来源订单必须多字段兜底。
      or.push(
        { orderNo: { contains: orderNo, mode: 'insensitive' } },
        { productionTaskNo: { contains: orderNo, mode: 'insensitive' } },
        { batch: { sourceOrderNo: { contains: orderNo, mode: 'insensitive' } } },
        { batch: { sourceProductionTaskNo: { contains: orderNo, mode: 'insensitive' } } },
        { batch: { replenishmentSourceRequestNo: { contains: orderNo, mode: 'insensitive' } } },
        { batch: { sourceOrder: { is: { orderNo: { contains: orderNo, mode: 'insensitive' } } } } },
        { batch: { productionTask: { is: { orderNo: { contains: orderNo, mode: 'insensitive' } } } } },
        { batch: { productionTask: { is: { productionTaskNo: { contains: orderNo, mode: 'insensitive' } } } } }
      );
    }
    if (orderNoList.length > 0) {
      or.push(
        { orderNo: { in: orderNoList } },
        { batch: { sourceOrderNo: { in: orderNoList } } },
        { batch: { sourceOrder: { is: { orderNo: { in: orderNoList } } } } },
        { batch: { productionTask: { is: { orderNo: { in: orderNoList } } } } }
      );
    }
    if (productionTaskNoList.length > 0) {
      or.push(
        { productionTaskNo: { in: productionTaskNoList } },
        { batch: { sourceProductionTaskNo: { in: productionTaskNoList } } },
        { batch: { productionTask: { is: { productionTaskNo: { in: productionTaskNoList } } } } }
      );
    }

    return { OR: or.length > 0 ? or : [{ id: '__NO_WAREHOUSE_TRANSACTION_MATCH__' }] };
  }

  private async resolveTargetLocation(dto: ConfirmReceiptDto) {
    return this.resolveTargetLocationWithClient(this.prisma, dto.warehouseId, dto.locationId);
  }

  private async resolveTargetLocationWithClient(
    client: WarehousePrismaClient,
    warehouseId?: string,
    locationId?: string
  ) {
    if (!warehouseId?.trim()) {
      throw new BadRequestException('请选择仓库');
    }
    if (!locationId?.trim()) {
      throw new BadRequestException('请选择库位');
    }

    const warehouse = await client.warehouse.findUnique({
      where: { id: warehouseId },
      include: { locations: { where: { status: 'ENABLED' }, orderBy: { locationCode: 'asc' } } }
    });
    if (!warehouse) {
      throw new NotFoundException('仓库不存在');
    }
    if (warehouse.status !== 'ENABLED') {
      throw new BadRequestException('只有启用状态的仓库可以入库');
    }

    const location = warehouse.locations.find((item) => item.id === locationId);
    if (!location) {
      throw new BadRequestException('所选库位不属于当前启用仓库');
    }

    return {
      warehouseId: warehouse.id,
      locationId: location.id
    };
  }

  private buildOrderWhere(query: WarehouseWorkQueryDto) {
    const orderWhere: Prisma.CustomerOrderWhereInput = {};
    if (query.customerId) {
      orderWhere.customerId = query.customerId;
    }

    if (query.dateFrom || query.dateTo) {
      const orderDate: Prisma.DateTimeFilter = {};
      if (query.dateFrom) {
        orderDate.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        const dateTo = new Date(query.dateTo);
        dateTo.setHours(23, 59, 59, 999);
        orderDate.lte = dateTo;
      }
      orderWhere.orderDate = orderDate;
    }

    return orderWhere;
  }

  private async findWarehouseSourceTaskMap(taskNos: Array<string | null | undefined>) {
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

  private resolveWarehouseTransactionSourceTask(transaction: any, sourceTaskMap: Map<string, any>) {
    return (
      (transaction.productionTaskNo && sourceTaskMap.get(transaction.productionTaskNo)) ||
      (transaction.batch?.sourceProductionTaskNo && sourceTaskMap.get(transaction.batch.sourceProductionTaskNo)) ||
      transaction.batch?.productionTask ||
      null
    );
  }

  private resolveWarehouseTransactionSourceLine(transaction: any, sourceTask: any) {
    if (transaction.batch?.sourceProductionTaskNo && sourceTask?.orderLine) {
      return sourceTask.orderLine;
    }
    return transaction.batch?.sourceOrderLine || sourceTask?.orderLine || transaction.batch?.productionTask?.orderLine || null;
  }

  private async getReceivedOrderQuantity(orderLineId: string, client: WarehousePrismaClient = this.prisma) {
    const receivedMap = await this.getReceivedOrderQuantityMap([orderLineId], client);
    return receivedMap.get(orderLineId) ?? 0;
  }

  private async getReceivedOrderQuantityMap(orderLineIds: string[], client: WarehousePrismaClient = this.prisma) {
    const uniqueOrderLineIds = Array.from(new Set(orderLineIds.filter(Boolean)));
    const receivedMap = new Map<string, number>();
    if (uniqueOrderLineIds.length === 0) {
      return receivedMap;
    }

    const transactions = await client.inventoryTransaction.findMany({
      where: {
        transactionType: 'IN',
        batch: {
          sourceOrderLineId: { in: uniqueOrderLineIds },
          sourceOrderId: { not: null }
        }
      },
      select: {
        quantity: true,
        batch: { select: { sourceOrderLineId: true } }
      }
    });

    for (const transaction of transactions) {
      const orderLineId = transaction.batch?.sourceOrderLineId;
      if (!orderLineId) {
        continue;
      }
      receivedMap.set(
        orderLineId,
        (receivedMap.get(orderLineId) ?? 0) + decimalToNumber(transaction.quantity)
      );
    }
    return receivedMap;
  }

  private async getShippedOrderQuantityMap(orderLineIds: string[], client: WarehousePrismaClient = this.prisma) {
    const uniqueOrderLineIds = Array.from(new Set(orderLineIds.filter(Boolean)));
    const shippedMap = new Map<string, number>();
    if (uniqueOrderLineIds.length === 0) {
      return shippedMap;
    }

    const transactions = await client.inventoryTransaction.findMany({
      where: {
        transactionType: 'OUT',
        sourceRecordType: 'InventoryBatch',
        OR: [
          { orderLineId: { in: uniqueOrderLineIds } },
          {
            batch: {
              sourceOrderLineId: { in: uniqueOrderLineIds },
              sourceOrderId: { not: null }
            }
          }
        ]
      },
      select: {
        orderLineId: true,
        quantity: true,
        batch: { select: { sourceOrderLineId: true } }
      }
    });

    for (const transaction of transactions) {
      const orderLineId = transaction.orderLineId || transaction.batch?.sourceOrderLineId;
      if (!orderLineId) {
        continue;
      }
      shippedMap.set(orderLineId, (shippedMap.get(orderLineId) ?? 0) + decimalToNumber(transaction.quantity));
    }
    return shippedMap;
  }

  private replenishmentSourceLabel(row: { replenishmentSourceType?: string | null; replenishmentSourceRequestNo?: string | null } | null | undefined) {
    if (!row?.replenishmentSourceType) {
      return null;
    }
    const prefix = row.replenishmentSourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单';
    return row.replenishmentSourceRequestNo ? `${prefix}：${row.replenishmentSourceRequestNo}` : prefix;
  }

  private toReceipt(task: any, statusText: string, receivedOrderQuantity = 0) {
    const plannedQuantity = decimalToNumber(task.plannedQuantity);
    const completedQuantity = decimalToNumber(task.completedQuantity);
    const customerOrderQuantity = decimalToNumber(task.orderLine?.quantity ?? task.plannedQuantity);
    const remainingOrderQuantity = Math.max(customerOrderQuantity - receivedOrderQuantity, 0);
    const orderReceiptQuantity = Math.min(completedQuantity, remainingOrderQuantity);
    const stockQuantity = Math.max(completedQuantity - orderReceiptQuantity, 0);

    return {
      id: task.id,
      productionTaskNo: task.productionTaskNo,
      isReplenishment: task.isReplenishment,
      sourceProductionTaskNo: task.sourceProductionTaskNo,
      replenishmentSourceType: task.replenishmentSourceType,
      replenishmentSourceRequestNo: task.replenishmentSourceRequestNo,
      replenishmentSourceLabel: this.replenishmentSourceLabel(task),
      customerId: task.order?.customerId,
      orderNo: task.orderNo,
      customerName: task.customerName,
      orderDate: task.order?.orderDate,
      deliveryDate: task.orderLine?.deliveryDate || task.order?.deliveryDate,
      partCode: task.partCode,
      partName: task.partName,
      lineType: task.orderLine?.lineType || 'PART',
      partCategory: task.orderLine?.partCategory,
      componentNo: task.orderLine?.componentNo,
      parentComponentNo: task.orderLine?.parentComponentNo,
      importSequence: task.orderLine?.importSequence,
      plannedQuantity,
      customerOrderQuantity,
      receivedOrderQuantity,
      remainingOrderQuantity,
      completedQuantity,
      orderReceiptQuantity,
      stockQuantity,
      quantity: completedQuantity,
      unit: task.unit,
      drawingNo: task.orderLine?.drawingNo,
      drawingVersion: task.orderLine?.drawingVersion,
      drawingFileName: task.orderLine?.drawingFileName,
      drawingFileUrl: task.orderLine?.drawingFileUrl,
      partThickness:
        task.orderLine?.partThickness === null || task.orderLine?.partThickness === undefined
          ? null
          : decimalToNumber(task.orderLine.partThickness),
      partSpecification: task.orderLine?.partSpecification,
      status: statusText,
      completedAt: task.completedAt
    };
  }

  private toShipment(
    batch: any,
    shippedQuantityByLine = new Map<string, number>(),
    remainingSuggestionQuantityByLine = new Map<string, number>()
  ) {
    const customerOrderQuantity = decimalToNumber(batch.sourceOrderLine?.quantity);
    const shippedQuantity = batch.sourceOrderLineId ? (shippedQuantityByLine.get(batch.sourceOrderLineId) ?? 0) : 0;
    const remainingQuantity =
      customerOrderQuantity > 0 ? Math.max(this.roundQuantity(customerOrderQuantity - shippedQuantity), 0) : decimalToNumber(batch.quantity);
    const availableQuantity = decimalToNumber(batch.quantity);
    const suggestionRemaining = batch.sourceOrderLineId
      ? remainingSuggestionQuantityByLine.get(batch.sourceOrderLineId) ?? remainingQuantity
      : remainingQuantity;
    const suggestedShipmentQuantity = Math.min(availableQuantity, Math.max(suggestionRemaining, 0));
    if (batch.sourceOrderLineId) {
      remainingSuggestionQuantityByLine.set(
        batch.sourceOrderLineId,
        this.roundQuantity(Math.max(suggestionRemaining - suggestedShipmentQuantity, 0))
      );
    }
    const sourceLine = batch.productionTask?.orderLine || batch.sourceOrderLine;
    return {
      id: batch.id,
      batchNo: batch.batchNo,
      orderLineId: batch.sourceOrderLineId,
      productionTaskNo: batch.sourceProductionTaskNo,
      isReplenishment: Boolean(batch.productionTask?.isReplenishment),
      sourceProductionTaskNo: batch.productionTask?.sourceProductionTaskNo,
      replenishmentSourceType: batch.replenishmentSourceType || batch.productionTask?.replenishmentSourceType,
      replenishmentSourceRequestNo: batch.replenishmentSourceRequestNo || batch.productionTask?.replenishmentSourceRequestNo,
      replenishmentSourceLabel: this.replenishmentSourceLabel(batch.productionTask || batch),
      customerId: batch.sourceOrder?.customerId,
      orderStatus: batch.sourceOrder?.status,
      orderNo: batch.sourceOrderNo,
      customerName: batch.sourceCustomerName,
      orderDate: batch.sourceOrder?.orderDate,
      deliveryDate: batch.productionTask?.orderLine?.deliveryDate || batch.sourceOrderLine?.deliveryDate || batch.sourceOrder?.deliveryDate,
      partCode: batch.partCode,
      partName: batch.partName,
      lineType: sourceLine?.lineType || 'PART',
      partCategory: sourceLine?.partCategory,
      componentNo: sourceLine?.componentNo,
      parentComponentNo: sourceLine?.parentComponentNo,
      importSequence: sourceLine?.importSequence,
      quantity: availableQuantity,
      customerOrderQuantity,
      shippedQuantity: this.roundQuantity(shippedQuantity),
      remainingQuantity,
      suggestedShipmentQuantity: this.roundQuantity(suggestedShipmentQuantity),
      unit: batch.unit,
      warehouseId: batch.warehouseId,
      warehouseName: batch.warehouse.warehouseName,
      locationId: batch.locationId,
      locationName: batch.location?.locationName,
      inventorySourceType: batch.sourceOrderId ? 'ORDER' : 'STOCK',
      sourceKind: batch.sourceKind || 'NORMAL_ORDER',
      productionSourceOrderNo: batch.productionTask?.order?.orderNo,
      productionSourceCustomerName: batch.productionTask?.order?.customerName || batch.sourceCustomerName,
      productionDate: batch.productionTask?.completedAt || batch.createdAt,
      drawingNo: batch.productionTask?.orderLine?.drawingNo || batch.sourceOrderLine?.drawingNo,
      drawingVersion: batch.productionTask?.orderLine?.drawingVersion || batch.sourceOrderLine?.drawingVersion,
      drawingFileName: batch.productionTask?.orderLine?.drawingFileName || batch.sourceOrderLine?.drawingFileName,
      drawingFileUrl: batch.productionTask?.orderLine?.drawingFileUrl || batch.sourceOrderLine?.drawingFileUrl,
      partThickness:
        batch.productionTask?.orderLine?.partThickness !== null && batch.productionTask?.orderLine?.partThickness !== undefined
          ? decimalToNumber(batch.productionTask.orderLine.partThickness)
          : batch.sourceOrderLine?.partThickness !== null && batch.sourceOrderLine?.partThickness !== undefined
            ? decimalToNumber(batch.sourceOrderLine.partThickness)
            : null,
      partSpecification: batch.productionTask?.orderLine?.partSpecification || batch.sourceOrderLine?.partSpecification,
      status: '待发货'
    };
  }

  private normalizeBatchShipmentRequest(dto: ConfirmBatchShipmentDto) {
    const requestedBatchIds = Array.from(new Set(dto.batchIds.map((item) => item.trim()).filter(Boolean)));
    const explicitRequest = this.normalizeShipmentItems(dto);
    if (explicitRequest.hasExplicitQuantities) {
      const requestedBatchIdSet = new Set(requestedBatchIds);
      const outsideRequestedBatch = explicitRequest.batchIds.find((batchId) => !requestedBatchIdSet.has(batchId));
      if (outsideRequestedBatch) {
        throw new BadRequestException('批量发货数量明细包含未勾选的库存批次');
      }
      return explicitRequest;
    }

    return {
      hasExplicitQuantities: false,
      batchIds: requestedBatchIds,
      quantityByBatchId: new Map<string, number>(),
      itemByBatchId: new Map<string, NormalizedShipmentItem>()
    };
  }

  private normalizeShipmentItems(dto: ConfirmShipmentDto) {
    const quantityByBatchId = new Map<string, number>();
    const itemByBatchId = new Map<string, NormalizedShipmentItem>();
    for (const item of dto.batchShipments || []) {
      const batchId = item.batchId?.trim();
      if (!batchId) {
        throw new BadRequestException('发货批次不能为空');
      }
      const shipmentQuantity = this.roundQuantity(decimalToNumber(item.shipmentQuantity));
      if (shipmentQuantity <= 0) {
        continue;
      }
      if (quantityByBatchId.has(batchId)) {
        throw new BadRequestException('同一个库存批次不能重复填写发货数量');
      }
      quantityByBatchId.set(batchId, shipmentQuantity);
      itemByBatchId.set(batchId, {
        batchId,
        shipmentQuantity,
        orderLineId: item.orderLineId?.trim() || undefined
      });
    }

    return {
      hasExplicitQuantities: Boolean(dto.batchShipments && dto.batchShipments.length > 0),
      batchIds: Array.from(quantityByBatchId.keys()),
      quantityByBatchId,
      itemByBatchId
    };
  }

  private resolveStockShipmentTargetLine(
    order: { lines: ShipmentTargetOrderLine[] },
    batch: { partCode: string; partName: string; unit: string },
    item?: NormalizedShipmentItem
  ) {
    const targetLine = item?.orderLineId
      ? order.lines.find((line) => line.id === item.orderLineId)
      : (() => {
          const candidates = order.lines.filter((line) => line.partCode === batch.partCode && line.unit === batch.unit);
          if (candidates.length !== 1) {
            throw new BadRequestException(
              candidates.length === 0
                ? `备货库存 ${batch.partCode} / ${batch.partName} 无法匹配当前订单零件`
                : `备货库存 ${batch.partCode} / ${batch.partName} 匹配到多个订单零件，请指定 orderLineId`
            );
          }
          return candidates[0];
        })();

    if (!targetLine) {
      throw new BadRequestException('备货库存超发必须指定有效的订单零件');
    }
    if (targetLine.partCode !== batch.partCode || targetLine.unit !== batch.unit) {
      throw new BadRequestException('备货库存批次与目标订单零件编码或单位不一致');
    }
    return targetLine;
  }

  private async getShippedQuantityForTargetOrderLine(
    tx: Prisma.TransactionClient,
    orderNo: string,
    line: ShipmentTargetOrderLine
  ) {
    const transactions = await tx.inventoryTransaction.findMany({
      where: {
        transactionType: 'OUT',
        sourceRecordType: 'InventoryBatch',
        OR: [
          { orderLineId: line.id },
          {
            batch: {
              sourceOrderLineId: line.id,
              sourceOrderId: { not: null }
            }
          },
          {
            orderNo,
            partCode: line.partCode,
            unit: line.unit,
            orderLineId: null,
            batch: { sourceOrderId: null }
          }
        ]
      },
      select: { quantity: true }
    });
    return this.roundQuantity(transactions.reduce((sum, item) => sum + decimalToNumber(item.quantity), 0));
  }

  private async shipOneBatch(
    tx: Prisma.TransactionClient,
    batchId: string,
    dto: ConfirmShipmentDto,
    options?: { targetOrder?: ShipmentTargetOrder; targetOrderLine?: ShipmentTargetOrderLine }
  ) {
    const batch = await tx.inventoryBatch.findUnique({
      where: { id: batchId },
      include: {
        warehouse: true,
        location: true,
        sourceOrder: { select: { status: true } },
        sourceOrderLine: true,
        reservations: {
          where: { status: InventoryReservationStatus.ACTIVE },
          select: { quantity: true }
        }
      }
    });
    if (!batch) {
      throw new NotFoundException('库存批次不存在');
    }
    const targetOrder = batch.sourceOrderId ? undefined : options?.targetOrder;
    const targetOrderLine = batch.sourceOrderId ? undefined : options?.targetOrderLine;
    if (!batch.sourceOrderId && (!targetOrder || !targetOrderLine)) {
      throw new BadRequestException('备货库存只能在订单发货中作为客户超发来源使用');
    }
    if (targetOrderLine && (batch.partCode !== targetOrderLine.partCode || batch.unit !== targetOrderLine.unit)) {
      throw new BadRequestException('备货库存批次与目标订单零件编码或单位不一致');
    }
    if (batch.sourceOrder?.status === 'DRAFT') {
      throw new BadRequestException('待提交生产订单不能发货，请先提交生产并形成待发货库存');
    }
    if (batch.sourceOrder?.status === 'CANCELLED') {
      throw new BadRequestException('已取消订单库存不能发货');
    }
    if (batch.sourceOrder?.status === 'COMPLETED') {
      throw new BadRequestException('已完成发货订单库存不能再次发货');
    }
    if (batch.status !== 'AVAILABLE') {
      throw new BadRequestException('只有可用库存可以发货');
    }
    const availableQuantity = decimalToNumber(batch.quantity);
    if (availableQuantity <= 0) {
      throw new BadRequestException('库存数量必须大于 0 才能发货');
    }
    const shipmentQuantity = this.roundQuantity(
      dto.shipmentQuantity === undefined ? availableQuantity : decimalToNumber(dto.shipmentQuantity)
    );
    if (shipmentQuantity <= 0) {
      throw new BadRequestException('本次发货数量必须大于 0');
    }
    if (shipmentQuantity > availableQuantity + 0.0001) {
      throw new BadRequestException(`本次发货数量不能大于当前库存 ${this.formatQuantity(availableQuantity, batch.unit)}`);
    }
    const reservedQuantity = !batch.sourceOrderId
      ? batch.reservations.reduce((sum, reservation) => sum + decimalToNumber(reservation.quantity), 0)
      : 0;
    const shippableQuantity = this.roundQuantity(Math.max(availableQuantity - reservedQuantity, 0));
    if (targetOrder && shipmentQuantity > shippableQuantity + 0.0001) {
      throw new BadRequestException(
        `备货库存可发数量不足：账面 ${this.formatQuantity(availableQuantity, batch.unit)}，已被其他订单预占 ${this.formatQuantity(
          reservedQuantity,
          batch.unit
        )}，当前可发 ${this.formatQuantity(shippableQuantity, batch.unit)}`
      );
    }
    const warehouseConfirmedBy = await this.resolveWarehouseOperatorSnapshot(
      dto.warehouseConfirmedByCode,
      dto.warehouseConfirmedBy,
      '发货',
      tx
    );

    const customerOrderQuantity = decimalToNumber(batch.sourceOrderLine?.quantity ?? targetOrderLine?.quantity);
    const shippedQuantityMap = await this.getShippedOrderQuantityMap(
      batch.sourceOrderLineId ? [batch.sourceOrderLineId] : [],
      tx
    );
    const shippedQuantity = batch.sourceOrderLineId
      ? (shippedQuantityMap.get(batch.sourceOrderLineId) ?? 0)
      : targetOrder && targetOrderLine
        ? await this.getShippedQuantityForTargetOrderLine(tx, targetOrder.orderNo, targetOrderLine)
        : 0;
    const remainingOrderQuantity =
      customerOrderQuantity > 0 ? Math.max(this.roundQuantity(customerOrderQuantity - shippedQuantity), 0) : shipmentQuantity;
    if (targetOrder && shipmentQuantity <= remainingOrderQuantity + 0.0001) {
      throw new BadRequestException('备货库存只能用于超过订单未发货数量的客户额外发货；正常发货请使用订单库存');
    }
    const overShipmentQuantity = this.roundQuantity(Math.max(shipmentQuantity - remainingOrderQuantity, 0));
    if (overShipmentQuantity > 0) {
      if (!dto.salesConfirmedBy?.trim()) {
        throw new BadRequestException('本次发货超过订单未发货数量，必须填写销售确认人');
      }
      if (!dto.overShipmentReason?.trim()) {
        throw new BadRequestException('本次发货超过订单未发货数量，必须填写超发说明');
      }
    }
    const remainingBatchQuantity = this.roundQuantity(availableQuantity - shipmentQuantity);

    // 发货状态检查和出库流水必须共用同一份最新库存批次，防止重复点击把同一批库存出两次。
    const shipped = await tx.inventoryBatch.update({
      where: { id: batch.id },
      data: { quantity: remainingBatchQuantity, status: remainingBatchQuantity > 0 ? 'AVAILABLE' : 'USED' },
      include: { warehouse: true, location: true }
    });

    await tx.inventoryTransaction.create({
      data: {
        transactionNo: await this.generateShipmentTransactionNo(tx, batch.batchNo),
        transactionType: 'OUT',
        batchId: batch.id,
        orderLineId: batch.sourceOrderLineId || targetOrderLine?.id,
        partCode: batch.partCode,
        partName: batch.partName,
        orderNo: batch.sourceOrderNo || targetOrder?.orderNo,
        productionTaskNo: batch.sourceProductionTaskNo,
        quantity: shipmentQuantity,
        unit: batch.unit,
        warehouseId: batch.warehouseId,
        locationId: batch.locationId,
        remark: this.formatShipmentRemark(
          dto,
          warehouseConfirmedBy,
          overShipmentQuantity,
          targetOrder ? `备货库存超发：${targetOrder.orderNo}` : undefined
        ),
        sourceRecordType: 'InventoryBatch',
        sourceRecordId: batch.id
      }
    });

    return shipped;
  }

  private async generateShipmentTransactionNo(tx: Prisma.TransactionClient, batchNo: string) {
    const prefix = `IT-OUT-${batchNo}-`;
    const lastTransaction = await tx.inventoryTransaction.findFirst({
      where: { transactionNo: { startsWith: prefix } },
      orderBy: { transactionNo: 'desc' },
      select: { transactionNo: true }
    });
    const nextSequence = lastTransaction ? Number(lastTransaction.transactionNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(nextSequence).padStart(3, '0')}`;
  }

  private formatReceiptRemark(dto: ConfirmReceiptDto, warehouseConfirmedBy: string, defaultRemark: string) {
    return [dto.remark?.trim() || defaultRemark, `仓库确认人：${warehouseConfirmedBy}`].filter(Boolean).join('；');
  }

  private formatShipmentRemark(
    dto: ConfirmShipmentDto,
    warehouseConfirmedBy: string,
    overShipmentQuantity: number,
    shipmentContext?: string
  ) {
    const lines = [
      dto.remark?.trim() || '仓库确认发货',
      shipmentContext,
      `仓库确认人：${warehouseConfirmedBy}`,
      dto.salesConfirmedBy?.trim() ? `销售确认人：${dto.salesConfirmedBy.trim()}` : '',
      overShipmentQuantity > 0 ? `超发数量：${this.roundQuantity(overShipmentQuantity)}` : '',
      overShipmentQuantity > 0 && dto.overShipmentReason?.trim() ? `超发说明：${dto.overShipmentReason.trim()}` : ''
    ];
    return lines.filter(Boolean).join('；');
  }

  private async assertOrderHasNoPendingShortage(tx: Prisma.TransactionClient, orderId: string, actionName: string) {
    const completions = await tx.productionProcessCompletion.findMany({
      where: {
        shortageQuantity: { gt: 0 },
        shortageResolutionMode: null,
        OR: [
          { shortageMode: 'MANAGER_APPROVED' },
          { shortageMode: 'REPLENISHMENT_REQUEST' },
          { shortageMode: 'REPLENISHMENT', replenishmentTaskNo: null }
        ],
        productionTask: { orderId }
      },
      include: {
        productionTask: {
          select: {
            productionTaskNo: true,
            partCode: true,
            partName: true,
            unit: true
          }
        }
      },
      orderBy: [{ completedAt: 'asc' }, { createdAt: 'asc' }]
    });
    if (completions.length === 0) {
      return;
    }

    const shortageText = completions
      .map((completion) => {
        const task = completion.productionTask;
        return `${task?.partCode || '-'} / ${task?.partName || '-'} 缺 ${this.formatQuantity(decimalToNumber(completion.shortageQuantity), completion.unit || task?.unit)}`;
      })
      .join('；');
    throw new BadRequestException(`${actionName}前必须先处理生产短缺补单：${shortageText}。请到订单明细处理补单、客户减量或无需补单说明。`);
  }

  private async refreshOrderShipmentStatus(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.customerOrder.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order || order.status === 'CANCELLED') {
      return;
    }

    if (await this.isOrderShipmentClosed(tx, orderId)) {
      await tx.customerOrder.update({
        where: { id: orderId },
        // 只有全部订单库存发货完成后，订单才允许进入 COMPLETED。
        data: { status: 'COMPLETED' }
      });
      return;
    }

    if (order.status !== 'DRAFT') {
      // 部分发货时订单仍在流转中；页面库存/发货状态会按批次显示“待发货/部分发货”。
      await tx.customerOrder.update({
        where: { id: orderId },
        data: { status: 'IN_PRODUCTION' }
      });
    }
  }

  private async isOrderShipmentClosed(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.customerOrder.findUnique({
      where: { id: orderId },
      include: { lines: true }
    });
    if (!order || order.lines.length === 0) {
      return false;
    }

    const shippedQuantityByLine = await this.getShippedOrderQuantityMap(
      order.lines.map((line) => line.id),
      tx
    );
    return order.lines.every((line) => {
      const customerQuantity = decimalToNumber(line.quantity);
      if (customerQuantity <= 0) {
        return true;
      }
      return (shippedQuantityByLine.get(line.id) ?? 0) + 0.0001 >= customerQuantity;
    });
  }

  private toLineShippedQuantity(line: any, orderNo: string) {
    // 整单是否发货完成必须按 OUT 流水累计数量判断，不能只看批次 USED；部分发货后批次剩余也会变 0。
    return (line.inventoryBatches || []).reduce((sum: number, batch: any) => {
      if (!batch.sourceOrderId) {
        return sum;
      }
      return (
        sum +
        (batch.transactions || []).reduce((batchSum: number, transaction: any) => {
          if (
            transaction.transactionType !== InventoryTransactionType.OUT ||
            transaction.sourceRecordType !== 'InventoryBatch' ||
            transaction.orderNo !== orderNo
          ) {
            return batchSum;
          }
          return batchSum + decimalToNumber(transaction.quantity);
        }, 0)
      );
    }, 0);
  }

  private async buildWarehouseNoticeWhere(query: WarehouseNoticeQueryDto) {
    const where: Prisma.ProductionNoticeWhereInput = { target: ProductionNoticeTarget.WAREHOUSE };
    const and: Prisma.ProductionNoticeWhereInput[] = [];

    if (query.status) {
      where.status = query.status;
    }
    if (query.noticeType) {
      where.noticeType = query.noticeType;
    }
    if (query.orderNo?.trim()) {
      where.orderNo = { contains: query.orderNo.trim(), mode: 'insensitive' };
    }
    if (query.productionTaskNo?.trim()) {
      where.productionTaskNo = { contains: query.productionTaskNo.trim(), mode: 'insensitive' };
    }
    if (query.partCode?.trim()) {
      where.partCode = { contains: query.partCode.trim(), mode: 'insensitive' };
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) {
        where.createdAt.gte = this.noticeStartOfDay(query.dateFrom);
      }
      if (query.dateTo) {
        where.createdAt.lte = this.noticeEndOfDay(query.dateTo);
      }
    }

    const customerScope = await this.warehouseNoticeCustomerScope(query.customerId, query.customerKeyword);
    if (customerScope) {
      and.push(customerScope);
    }

    const keyword = query.keyword?.trim();
    if (keyword) {
      // 仓库历史通知筛选必须支持订单、客户、零件、通知类型和时间组合查询，确认后也不能从历史入口消失。
      const keywordCustomerScope = await this.warehouseNoticeCustomerScope(undefined, keyword);
      and.push({
        OR: [
          { noticeNo: { contains: keyword, mode: 'insensitive' } },
          { orderNo: { contains: keyword, mode: 'insensitive' } },
          { productionTaskNo: { contains: keyword, mode: 'insensitive' } },
          { partCode: { contains: keyword, mode: 'insensitive' } },
          { partName: { contains: keyword, mode: 'insensitive' } },
          { reason: { contains: keyword, mode: 'insensitive' } },
          ...(keywordCustomerScope?.OR || [])
        ]
      });
    }

    if (and.length > 0) {
      where.AND = and;
    }

    return where;
  }

  private async warehouseNoticeCustomerScope(customerId?: string, customerKeyword?: string): Promise<Prisma.ProductionNoticeWhereInput | null> {
    const normalizedCustomerId = customerId?.trim();
    const keyword = customerKeyword?.trim();
    if (!normalizedCustomerId && !keyword) {
      return null;
    }

    const orderWhere: Prisma.CustomerOrderWhereInput = {};
    if (normalizedCustomerId) {
      orderWhere.customerId = normalizedCustomerId;
    }
    if (keyword) {
      orderWhere.OR = [
        { customerName: { contains: keyword, mode: 'insensitive' } },
        { customerCode: { contains: keyword, mode: 'insensitive' } },
        { orderNo: { contains: keyword, mode: 'insensitive' } }
      ];
    }

    const orders = await this.prisma.customerOrder.findMany({
      where: orderWhere,
      select: { id: true, orderNo: true }
    });
    const orderIds = [...new Set(orders.map((order) => order.id).filter(Boolean))];
    const orderNos = [...new Set(orders.map((order) => order.orderNo).filter(Boolean))];

    if (orderIds.length === 0 && orderNos.length === 0) {
      return { id: '__NO_WAREHOUSE_NOTICE_CUSTOMER_MATCH__' };
    }

    return {
      OR: [
        ...(orderIds.length > 0 ? [{ orderId: { in: orderIds } }] : []),
        ...(orderNos.length > 0 ? [{ orderNo: { in: orderNos } }] : [])
      ]
    };
  }

  private noticeStartOfDay(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('开始日期无效');
    }
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private noticeEndOfDay(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('结束日期无效');
    }
    date.setHours(23, 59, 59, 999);
    return date;
  }

  private async toNoticesWithCustomerNames(notices: any[], db: WarehousePrismaClient = this.prisma) {
    const orderIds = [...new Set(notices.map((notice) => String(notice.orderId || '').trim()).filter(Boolean))];
    const orderNos = [...new Set(notices.map((notice) => String(notice.orderNo || '').trim()).filter(Boolean))];
    const orderWhere: Prisma.CustomerOrderWhereInput[] = [];
    if (orderIds.length > 0) {
      orderWhere.push({ id: { in: orderIds } });
    }
    if (orderNos.length > 0) {
      orderWhere.push({ orderNo: { in: orderNos } });
    }

    const orders =
      orderWhere.length > 0
        ? await db.customerOrder.findMany({
            where: { OR: orderWhere },
            select: { id: true, orderNo: true, customerName: true }
          })
        : [];
    const customerNameByOrderId = new Map(orders.map((order) => [order.id, order.customerName]));
    const customerNameByOrderNo = new Map(orders.map((order) => [order.orderNo, order.customerName]));

    return notices.map((notice) =>
      this.toNotice(
        notice,
        customerNameByOrderId.get(notice.orderId) || customerNameByOrderNo.get(notice.orderNo) || undefined
      )
    );
  }

  private toNotice(notice: any, customerName?: string) {
    return {
      id: notice.id,
      noticeNo: notice.noticeNo,
      noticeType: notice.noticeType,
      target: notice.target,
      status: notice.status,
      orderId: notice.orderId,
      orderNo: notice.orderNo,
      customerName,
      orderLineId: notice.orderLineId,
      productionTaskId: notice.productionTaskId,
      productionTaskNo: notice.productionTaskNo,
      partCode: notice.partCode,
      partName: notice.partName,
      beforeQuantity: decimalToNumber(notice.beforeQuantity),
      afterQuantity: decimalToNumber(notice.afterQuantity),
      deltaQuantity: decimalToNumber(notice.deltaQuantity),
      unit: notice.unit,
      reason: notice.reason,
      managerName: notice.managerName,
      handlingPlan: notice.handlingPlan,
      acknowledgedBy: notice.acknowledgedBy,
      acknowledgedAt: notice.acknowledgedAt,
      createdAt: notice.createdAt
    };
  }

  private async generateNextScrapNo(tx: Prisma.TransactionClient) {
    const dateKey = businessDateKey();
    const prefix = `SCRAP-${dateKey}-`;
    const lastRecord = await tx.productionScrapRecord.findFirst({
      where: { scrapNo: { startsWith: prefix } },
      orderBy: { scrapNo: 'desc' },
      select: { scrapNo: true }
    });
    const nextSequence = lastRecord ? Number(lastRecord.scrapNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(nextSequence).padStart(4, '0')}`;
  }

  private async generateWarehouseCode() {
    const count = await this.prisma.warehouse.count();
    for (let index = count + 1; index < count + 1000; index += 1) {
      const code = `WH-${String(index).padStart(3, '0')}`;
      if (!(await this.warehouseCodeExists(code))) {
        return code;
      }
    }
    throw new BadRequestException('无法生成仓库编码，请手动填写');
  }

  private normalizeBusinessCode(value: string | undefined, message: string) {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException(message);
    }
    return normalized;
  }

  private formatQuantity(value: number, unit?: string | null) {
    const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000;
    return `${rounded} ${unit || '件'}`;
  }

  private roundQuantity(value: number) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  private async warehouseCodeExists(warehouseCode: string, excludeId?: string) {
    const existing = await this.prisma.warehouse.findFirst({
      where: {
        warehouseCode: { equals: warehouseCode, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {})
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  private async ensureWarehouseCodeAvailable(warehouseCode: string, excludeId?: string) {
    // 仓库编码大小写不敏感查重，避免 WH-FG 和 wh-fg 变成两个仓库。
    if (await this.warehouseCodeExists(warehouseCode, excludeId)) {
      throw new BadRequestException(`仓库编码 ${warehouseCode} 已存在`);
    }
  }

  private async locationCodeExists(warehouseId: string, locationCode: string, excludeId?: string) {
    const existing = await this.prisma.warehouseLocation.findFirst({
      where: {
        warehouseId,
        locationCode: { equals: locationCode, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {})
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  private async ensureLocationCodeAvailable(warehouseId: string, locationCode: string, excludeId?: string) {
    // 同一仓库内库位编码必须大小写不敏感唯一，不同仓库可以使用相同库位编号。
    if (await this.locationCodeExists(warehouseId, locationCode, excludeId)) {
      throw new BadRequestException(`当前仓库已存在库位编码 ${locationCode}`);
    }
  }

  private isDuplicateWarehouseCodeError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (JSON.stringify(error.meta || {}).includes('warehouseCode') ||
        JSON.stringify(error.meta || {}).includes('Warehouse_warehouseCode_lower_key'))
    );
  }

  private isDuplicateLocationCodeError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (JSON.stringify(error.meta || {}).includes('locationCode') ||
        JSON.stringify(error.meta || {}).includes('WarehouseLocation_warehouseId_locationCode_lower_key'))
    );
  }
}
