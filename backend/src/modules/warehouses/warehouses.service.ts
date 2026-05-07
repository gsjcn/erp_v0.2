import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductionNoticeStatus, ProductionNoticeTarget, ProductionStatus } from '@prisma/client';
import { decimalToNumber } from '../../common/serializers';
import { runSerializableTransaction } from '../../common/transactions';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AcknowledgeWarehouseNoticeDto,
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
      throw new BadRequestException('Acknowledged by is required');
    }
    const notice = await this.prisma.productionNotice.findFirst({
      where: { id, target: ProductionNoticeTarget.WAREHOUSE }
    });
    if (!notice) {
      throw new NotFoundException('Warehouse notice not found');
    }
    const saved = await this.prisma.productionNotice.update({
      where: { id },
      data: {
        status: ProductionNoticeStatus.ACKNOWLEDGED,
        acknowledgedBy,
        acknowledgedAt: new Date()
      }
    });
    return this.toNotice(saved);
  }

  async createWarehouse(dto: CreateWarehouseDto) {
    if (!dto.warehouseName?.trim()) {
      throw new BadRequestException('warehouseName is required');
    }

    const warehouseCode = dto.warehouseCode?.trim()
      ? this.normalizeBusinessCode(dto.warehouseCode, 'warehouseCode is required')
      : await this.generateWarehouseCode();
    await this.ensureWarehouseCodeAvailable(warehouseCode);

    // 第一阶段只维护仓库基础资料，不扩展复杂仓储策略或权限审批。
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
        throw new BadRequestException(`Warehouse code ${warehouseCode} already exists`);
      }
      throw error;
    }
  }

  async createLocation(warehouseId: string, dto: CreateWarehouseLocationDto) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    const locationCode = this.normalizeBusinessCode(dto.locationCode, 'locationCode is required');
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
        throw new BadRequestException(`Location code ${locationCode} already exists in this warehouse`);
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
          throw new NotFoundException('Production task not found');
        }
        if (task.status !== ProductionStatus.COMPLETED) {
          throw new BadRequestException('Only completed production tasks can be received');
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
          throw new BadRequestException('Completed quantity must be greater than 0 before receipt');
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
              sourceCustomerName: null,
              productionTaskId: orderQuantity > 0 ? null : task.id,
              sourceProductionTaskNo: task.productionTaskNo,
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
      where.sourceOrderNo = { contains: query.orderNo.trim(), mode: 'insensitive' };
    }

    const batches = await this.prisma.inventoryBatch.findMany({
      where,
      include: {
        warehouse: true,
        location: true,
        sourceOrder: true,
        sourceOrderLine: true,
        productionTask: { include: { orderLine: true } }
      },
      orderBy: [{ createdAt: 'desc' }, { batchNo: 'asc' }]
    });

    return batches.map((batch) => this.toShipment(batch));
  }

  async confirmShipment(batchId: string, dto: ConfirmShipmentDto) {
    // 发货是第一阶段的最小出库动作：库存批次改为 USED，并追加 OUT 库存流水。
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
        if (batch.status !== 'AVAILABLE') {
          throw new BadRequestException('Only AVAILABLE inventory can be shipped');
        }
        if (decimalToNumber(batch.quantity) <= 0) {
          throw new BadRequestException('Only inventory quantity greater than 0 can be shipped');
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
            remark: dto.remark || '仓库确认发货',
            sourceRecordType: 'InventoryBatch',
            sourceRecordId: batch.id
          }
        });

        if (batch.sourceOrderId) {
          if (await this.isOrderShipmentClosed(tx, batch.sourceOrderId)) {
            await tx.customerOrder.update({
              where: { id: batch.sourceOrderId },
              // 只有全部生产任务已入库并完成发货后，订单才允许进入 COMPLETED。
              data: { status: 'COMPLETED' }
            });
          }
        }

        return shipped;
      },
      '当前库存批次正在被其他发货操作修改，请刷新后重新发货'
    );
  }

  async findTransactions(query: WarehouseTransactionQueryDto) {
    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: query.transactionType ? { transactionType: query.transactionType } : undefined,
      include: { warehouse: true, location: true },
      orderBy: { transactionTime: 'desc' }
    });

    return transactions.map((item) => ({
      id: item.id,
      transactionNo: item.transactionNo,
      transactionType: item.transactionType,
      partCode: item.partCode,
      partName: item.partName,
      orderNo: item.orderNo,
      productionTaskNo: item.productionTaskNo,
      quantity: decimalToNumber(item.quantity),
      unit: item.unit,
      warehouseName: item.warehouse.warehouseName,
      locationName: item.location?.locationName,
      transactionTime: item.transactionTime,
      remark: item.remark
    }));
  }

  private async resolveTargetLocation(dto: ConfirmReceiptDto) {
    if (dto.warehouseId) {
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: dto.warehouseId },
        include: { locations: { orderBy: { locationCode: 'asc' } } }
      });
      if (!warehouse) {
        throw new NotFoundException('Warehouse not found');
      }

      const location = dto.locationId
        ? warehouse.locations.find((item) => item.id === dto.locationId)
        : warehouse.locations[0];

      return {
        warehouseId: warehouse.id,
        locationId: location?.id
      };
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { status: 'ENABLED' },
      include: { locations: { where: { status: 'ENABLED' }, orderBy: { locationCode: 'asc' } } },
      orderBy: { warehouseCode: 'asc' }
    });
    if (!warehouse) {
      throw new NotFoundException('Enabled warehouse not found');
    }

    return {
      warehouseId: warehouse.id,
      locationId: warehouse.locations[0]?.id
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
      customerId: batch.sourceOrder?.customerId,
      orderNo: batch.sourceOrderNo,
      customerName: batch.sourceCustomerName,
      orderDate: batch.sourceOrder?.orderDate,
      deliveryDate: batch.productionTask?.orderLine?.deliveryDate || batch.sourceOrderLine?.deliveryDate || batch.sourceOrder?.deliveryDate,
      partCode: batch.partCode,
      partName: batch.partName,
      quantity: decimalToNumber(batch.quantity),
      unit: batch.unit,
      warehouseName: batch.warehouse.warehouseName,
      locationName: batch.location?.locationName,
      status: '待发货'
    };
  }

  private async isOrderShipmentClosed(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.customerOrder.findUnique({
      where: { id: orderId },
      include: {
        lines: {
          include: {
            inventoryBatches: true,
            productionTasks: { include: { inventoryBatch: true } }
          }
        }
      }
    });
    if (!order || order.lines.length === 0) {
      return false;
    }

    return order.lines.every((line) => {
      const orderBatches = line.inventoryBatches.filter((batch) => batch.sourceOrderId === orderId);
      if (line.fulfillmentMode === 'STOCK') {
        return orderBatches.length > 0 && orderBatches.every((batch) => batch.status === 'USED');
      }
      return line.productionTasks.length > 0 && line.productionTasks.every((task) => this.isTaskShipmentClosed(task));
    });
  }

  private isTaskShipmentClosed(task: any) {
    // 发货完成判断以库存批次为准：历史任务即使 status 仍是 IN_PROGRESS，只要订单库存已出库，也应允许订单进入完成。
    return Boolean(
      task.inventoryBatch &&
        (task.inventoryBatch.sourceOrderId === null || task.inventoryBatch.status === 'USED')
    );
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
      acknowledgedBy: notice.acknowledgedBy,
      acknowledgedAt: notice.acknowledgedAt,
      createdAt: notice.createdAt
    };
  }

  private async generateWarehouseCode() {
    const count = await this.prisma.warehouse.count();
    for (let index = count + 1; index < count + 1000; index += 1) {
      const code = `WH-${String(index).padStart(3, '0')}`;
      if (!(await this.warehouseCodeExists(code))) {
        return code;
      }
    }
    throw new BadRequestException('Unable to generate warehouseCode');
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
      throw new BadRequestException(`Warehouse code ${warehouseCode} already exists`);
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
      throw new BadRequestException(`Location code ${locationCode} already exists in this warehouse`);
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
