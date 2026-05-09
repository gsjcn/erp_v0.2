import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InventoryReservationStatus,
  InventoryTransactionType,
  Prisma,
  ProductionNoticeStatus,
  ProductionNoticeTarget,
  ProductionStatus
} from '@prisma/client';
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
  WarehouseNoticeQueryDto,
  WarehouseWorkQueryDto,
  WarehouseTransactionQueryDto
} from './dto';

type WarehousePrismaClient = PrismaService | Prisma.TransactionClient;

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
    const notices = await this.prisma.productionNotice.findMany({
      where: {
        target: ProductionNoticeTarget.WAREHOUSE,
        ...(query.status ? { status: query.status } : {})
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }]
    });
    return notices.map((notice) => this.toNotice(notice));
  }

  async acknowledgeWarehouseNotice(id: string, dto: AcknowledgeWarehouseNoticeDto) {
    const acknowledgedBy = dto.acknowledgedBy.trim();
    if (!acknowledgedBy) {
      throw new BadRequestException('请填写仓库确认人员');
    }

    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const notice = await tx.productionNotice.findFirst({
          where: { id, target: ProductionNoticeTarget.WAREHOUSE }
        });
        if (!notice) {
          throw new NotFoundException('仓库通知不存在');
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
        return this.toNotice(saved);
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
        remark: dto.remark?.trim() || notice.reason || options.defaultRemark,
        sourceRecordType: options.sourceRecordType,
        sourceRecordId: notice.id
      }
    });
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
        reason: dto.remark?.trim() || `仓库按客户取消或减量处理报废：${notice.reason}`,
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

  async createLocation(warehouseId: string, dto: CreateWarehouseLocationDto) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      throw new NotFoundException('仓库不存在');
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

    return tasks.map((task) => this.toReceipt(task, '待入库', receivedQuantityMap.get(task.orderLineId) || 0));
  }

  async confirmReceipt(productionTaskId: string, dto: ConfirmReceiptDto) {
    const target = await this.resolveTargetLocation(dto);

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
              partCode: task.partCode,
              partName: task.partName,
              orderNo: task.orderNo,
              productionTaskNo: task.productionTaskNo,
              quantity: orderQuantity,
              unit: task.unit,
              warehouseId: target.warehouseId,
              locationId: target.locationId,
              remark: dto.remark || '生产完成确认入库',
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
              remark: dto.remark || '生产超计划数量转库存',
              sourceRecordType: 'ProductionTaskOverage',
              sourceRecordId: task.id
            }
          });

          return { orderBatch: batch, stockBatch };
        }

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
    const orderWhere = this.buildOrderWhere(query);
    if (Object.keys(orderWhere).length > 0) {
      // 待发货库存仍按来源订单筛选，保证订单入库后可继续同一条件发货。
      where.sourceOrder = orderWhere;
    }
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

    return batches.map((batch) => this.toShipment(batch));
  }

  async confirmShipment(batchId: string, dto: ConfirmShipmentDto) {
    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const shipped = await this.shipOneBatch(tx, batchId, dto.remark);
        if (shipped.sourceOrderId) {
          await this.refreshOrderShipmentStatus(tx, shipped.sourceOrderId);
        }
        return shipped;
      },
      '当前库存批次正在被其他发货操作修改，请刷新后重新发货'
    );
  }

  async confirmBatchShipment(dto: ConfirmBatchShipmentDto) {
    const batchIds = Array.from(new Set(dto.batchIds.map((item) => item.trim()).filter(Boolean)));
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
        if (orderIds.length !== 1) {
          throw new BadRequestException('批量发货只能选择同一个订单的库存批次');
        }

        // 批量发货仍逐批写 OUT 流水，但必须放在同一事务里，保证同一订单多零件出库状态一致。
        const shipped = [];
        for (const batchId of batchIds) {
          shipped.push(await this.shipOneBatch(tx, batchId, dto.remark || '按订单批量发货'));
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

    return runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const order = await tx.customerOrder.findFirst({
          where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
          select: { id: true, orderNo: true, status: true }
        });
        if (!order) {
          throw new NotFoundException('订单不存在');
        }
        if (order.status === 'CANCELLED') {
          throw new BadRequestException('已取消订单不能发货');
        }

        const batches = await tx.inventoryBatch.findMany({
          where: {
            sourceOrderId: order.id,
            status: 'AVAILABLE',
            quantity: { gt: 0 }
          },
          select: { id: true },
          orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }]
        });
        if (batches.length === 0) {
          throw new BadRequestException('该订单没有待发货库存');
        }

        const shipped = [];
        for (const batch of batches) {
          shipped.push(await this.shipOneBatch(tx, batch.id, dto.remark || '按订单整单发货'));
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
            productionTask: { include: { order: true } },
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
      include: { order: true }
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

  private async getReceivedOrderQuantity(orderLineId: string, client: WarehousePrismaClient = this.prisma) {
    const receivedMap = await this.getReceivedOrderQuantityMap([orderLineId], client);
    return receivedMap.get(orderLineId) || 0;
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
        (receivedMap.get(orderLineId) || 0) + decimalToNumber(transaction.quantity)
      );
    }
    return receivedMap;
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
      partThickness: task.orderLine?.partThickness ? decimalToNumber(task.orderLine.partThickness) : null,
      partSpecification: task.orderLine?.partSpecification,
      status: statusText,
      completedAt: task.completedAt
    };
  }

  private toShipment(batch: any) {
    return {
      id: batch.id,
      batchNo: batch.batchNo,
      productionTaskNo: batch.sourceProductionTaskNo,
      isReplenishment: Boolean(batch.productionTask?.isReplenishment),
      sourceProductionTaskNo: batch.productionTask?.sourceProductionTaskNo,
      replenishmentSourceType: batch.replenishmentSourceType || batch.productionTask?.replenishmentSourceType,
      replenishmentSourceRequestNo: batch.replenishmentSourceRequestNo || batch.productionTask?.replenishmentSourceRequestNo,
      replenishmentSourceLabel: this.replenishmentSourceLabel(batch.productionTask || batch),
      customerId: batch.sourceOrder?.customerId,
      orderNo: batch.sourceOrderNo,
      customerName: batch.sourceCustomerName,
      orderDate: batch.sourceOrder?.orderDate,
      deliveryDate: batch.productionTask?.orderLine?.deliveryDate || batch.sourceOrderLine?.deliveryDate || batch.sourceOrder?.deliveryDate,
      partCode: batch.partCode,
      partName: batch.partName,
      quantity: decimalToNumber(batch.quantity),
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
      partThickness: batch.productionTask?.orderLine?.partThickness
        ? decimalToNumber(batch.productionTask.orderLine.partThickness)
        : batch.sourceOrderLine?.partThickness
          ? decimalToNumber(batch.sourceOrderLine.partThickness)
          : null,
      partSpecification: batch.productionTask?.orderLine?.partSpecification || batch.sourceOrderLine?.partSpecification,
      status: '待发货'
    };
  }

  private async shipOneBatch(tx: Prisma.TransactionClient, batchId: string, remark?: string) {
    const batch = await tx.inventoryBatch.findUnique({
      where: { id: batchId },
      include: { warehouse: true, location: true }
    });
    if (!batch) {
      throw new NotFoundException('库存批次不存在');
    }
    if (!batch.sourceOrderId) {
      throw new BadRequestException('只有订单库存可以从仓库发货');
    }
    if (batch.status !== 'AVAILABLE') {
      throw new BadRequestException('只有可用库存可以发货');
    }
    if (decimalToNumber(batch.quantity) <= 0) {
      throw new BadRequestException('库存数量必须大于 0 才能发货');
    }

    // 发货状态检查和出库流水必须共用同一份最新库存批次，防止重复点击把同一批库存出两次。
    const shipped = await tx.inventoryBatch.update({
      where: { id: batch.id },
      data: { quantity: 0, status: 'USED' },
      include: { warehouse: true, location: true }
    });

    await tx.inventoryTransaction.create({
      data: {
        transactionNo: `IT-OUT-${batch.batchNo}`,
        transactionType: 'OUT',
        batchId: batch.id,
        partCode: batch.partCode,
        partName: batch.partName,
        orderNo: batch.sourceOrderNo,
        productionTaskNo: batch.sourceProductionTaskNo,
        quantity: batch.quantity,
        unit: batch.unit,
        warehouseId: batch.warehouseId,
        locationId: batch.locationId,
        remark: remark || '仓库确认发货',
        sourceRecordType: 'InventoryBatch',
        sourceRecordId: batch.id
      }
    });

    return shipped;
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
      include: {
        lines: {
          include: {
            inventoryBatches: {
              include: { transactions: true }
            }
          }
        }
      }
    });
    if (!order || order.lines.length === 0) {
      return false;
    }

    return order.lines.every((line) => {
      const customerQuantity = decimalToNumber(line.quantity);
      if (customerQuantity <= 0) {
        return true;
      }
      return this.toLineShippedQuantity(line, order.orderNo) + 0.0001 >= customerQuantity;
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

  private toNotice(notice: any) {
    return {
      id: notice.id,
      noticeNo: notice.noticeNo,
      noticeType: notice.noticeType,
      target: notice.target,
      status: notice.status,
      orderNo: notice.orderNo,
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
    const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
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

  private async warehouseCodeExists(warehouseCode: string) {
    const existing = await this.prisma.warehouse.findFirst({
      where: { warehouseCode: { equals: warehouseCode, mode: 'insensitive' } },
      select: { id: true }
    });
    return Boolean(existing);
  }

  private async ensureWarehouseCodeAvailable(warehouseCode: string) {
    // 仓库编码大小写不敏感查重，避免 WH-FG 和 wh-fg 变成两个仓库。
    if (await this.warehouseCodeExists(warehouseCode)) {
      throw new BadRequestException(`仓库编码 ${warehouseCode} 已存在`);
    }
  }

  private async locationCodeExists(warehouseId: string, locationCode: string) {
    const existing = await this.prisma.warehouseLocation.findFirst({
      where: {
        warehouseId,
        locationCode: { equals: locationCode, mode: 'insensitive' }
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  private async ensureLocationCodeAvailable(warehouseId: string, locationCode: string) {
    // 同一仓库内库位编码必须大小写不敏感唯一，不同仓库可以使用相同库位编号。
    if (await this.locationCodeExists(warehouseId, locationCode)) {
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
