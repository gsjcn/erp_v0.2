import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductionStatus } from '@prisma/client';
import { decimalToNumber } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConfirmReceiptDto,
  ConfirmShipmentDto,
  CreateWarehouseDto,
  CreateWarehouseLocationDto,
  WarehouseWorkQueryDto,
  WarehouseTransactionQueryDto
} from './dto';

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

  async createWarehouse(dto: CreateWarehouseDto) {
    if (!dto.warehouseName?.trim()) {
      throw new BadRequestException('warehouseName is required');
    }

    const warehouseCode = dto.warehouseCode?.trim() || (await this.generateWarehouseCode());

    // 第一阶段只维护仓库基础资料，不扩展复杂仓储策略或权限审批。
    return this.prisma.warehouse.create({
      data: {
        warehouseCode,
        warehouseName: dto.warehouseName.trim()
      },
      include: { locations: { orderBy: { locationCode: 'asc' } } }
    });
  }

  async createLocation(warehouseId: string, dto: CreateWarehouseLocationDto) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    if (!dto.locationCode?.trim()) {
      throw new BadRequestException('locationCode is required');
    }

    // 库位只作为第一阶段库存定位字段，后续不在这里引入复杂库区规则。
    return this.prisma.warehouseLocation.create({
      data: {
        warehouseId,
        locationCode: dto.locationCode.trim(),
        locationName: dto.locationName?.trim() || dto.locationCode.trim()
      }
    });
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

    return tasks.map((task) => this.toReceipt(task, '待入库'));
  }

  async confirmReceipt(productionTaskId: string, dto: ConfirmReceiptDto) {
    const task = await this.prisma.productionTask.findUnique({
      where: { id: productionTaskId },
      include: { order: true }
    });
    if (!task) {
      throw new NotFoundException('Production task not found');
    }
    if (task.status !== ProductionStatus.COMPLETED) {
      throw new BadRequestException('Only completed production tasks can be received');
    }

    const existing = await this.prisma.inventoryBatch.findUnique({ where: { productionTaskId } });
    if (existing) {
      return existing;
    }

    const target = await this.resolveTargetLocation(dto);
    const plannedQuantity = decimalToNumber(task.plannedQuantity);
    const completedQuantity = decimalToNumber(task.completedQuantity);
    const orderQuantity = Math.min(completedQuantity, plannedQuantity);
    const stockQuantity = Math.max(completedQuantity - plannedQuantity, 0);
    const batchNo = `IB-${task.productionTaskNo}`;
    const stockBatchNo = `IB-STOCK-${task.productionTaskNo}`;
    const transactionNo = `IT-IN-${task.productionTaskNo}`;
    const stockTransactionNo = `IT-IN-STOCK-${task.productionTaskNo}`;

    // 仓库确认入库时按订单计划数和多做数量拆分：订单数量用于后续发货，多做数量转为无订单绑定的备货库存。
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.inventoryBatch.create({
        data: {
          batchNo,
          partCode: task.partCode,
          partName: task.partName,
          sourceOrderId: task.orderId,
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

      if (stockQuantity > 0) {
        const stockBatch = await tx.inventoryBatch.create({
          data: {
            batchNo: stockBatchNo,
            partCode: task.partCode,
            partName: task.partName,
            sourceOrderId: null,
            sourceOrderNo: null,
            sourceCustomerName: null,
            productionTaskId: null,
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
    });
  }

  async pendingShipments(query: WarehouseWorkQueryDto) {
    const where: Prisma.InventoryBatchWhereInput = { status: 'AVAILABLE', sourceOrderId: { not: null } };
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
        productionTask: { include: { orderLine: true } }
      },
      orderBy: [{ createdAt: 'desc' }, { batchNo: 'asc' }]
    });

    return batches.map((batch) => this.toShipment(batch));
  }

  async confirmShipment(batchId: string, dto: ConfirmShipmentDto) {
    const batch = await this.prisma.inventoryBatch.findUnique({
      where: { id: batchId },
      include: { warehouse: true, location: true }
    });
    if (!batch) {
      throw new NotFoundException('Inventory batch not found');
    }
    if (batch.status !== 'AVAILABLE') {
      throw new BadRequestException('Only AVAILABLE inventory can be shipped');
    }

    // 发货是第一阶段的最小出库动作：库存批次改为 USED，并追加 OUT 库存流水。
    return this.prisma.$transaction(async (tx) => {
      const shipped = await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: { status: 'USED' },
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
        const orderTasks = await tx.productionTask.findMany({
          where: { orderId: batch.sourceOrderId },
          include: { inventoryBatch: true }
        });
        const allShipped =
          orderTasks.length > 0 &&
          orderTasks.every((task) => task.status === 'COMPLETED' && task.inventoryBatch?.status === 'USED');

        if (allShipped) {
          await tx.customerOrder.update({
            where: { id: batch.sourceOrderId },
            // 只有全部生产任务已入库并完成发货后，订单才允许进入 COMPLETED。
            data: { status: 'COMPLETED' }
          });
        }
      }

      return shipped;
    });
  }

  async findTransactions(query: WarehouseTransactionQueryDto) {
    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: query.transactionType ? { transactionType: query.transactionType } : undefined,
      include: { warehouse: true, location: true },
      orderBy: { transactionTime: 'desc' },
      take: 50
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

  private toReceipt(task: any, statusText: string) {
    const plannedQuantity = decimalToNumber(task.plannedQuantity);
    const completedQuantity = decimalToNumber(task.completedQuantity);
    const orderReceiptQuantity = Math.min(completedQuantity, plannedQuantity);
    const stockQuantity = Math.max(completedQuantity - plannedQuantity, 0);

    return {
      id: task.id,
      productionTaskNo: task.productionTaskNo,
      customerId: task.order?.customerId,
      orderNo: task.orderNo,
      customerName: task.customerName,
      orderDate: task.order?.orderDate,
      deliveryDate: task.orderLine?.deliveryDate || task.order?.deliveryDate,
      partCode: task.partCode,
      partName: task.partName,
      plannedQuantity,
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
      customerId: batch.sourceOrder?.customerId,
      orderNo: batch.sourceOrderNo,
      customerName: batch.sourceCustomerName,
      orderDate: batch.sourceOrder?.orderDate,
      deliveryDate: batch.productionTask?.orderLine?.deliveryDate || batch.sourceOrder?.deliveryDate,
      partCode: batch.partCode,
      partName: batch.partName,
      quantity: decimalToNumber(batch.quantity),
      unit: batch.unit,
      warehouseName: batch.warehouse.warehouseName,
      locationName: batch.location?.locationName,
      status: '待发货'
    };
  }

  private async generateWarehouseCode() {
    const count = await this.prisma.warehouse.count();
    for (let index = count + 1; index < count + 1000; index += 1) {
      const code = `WH-${String(index).padStart(3, '0')}`;
      const existing = await this.prisma.warehouse.findUnique({ where: { warehouseCode: code } });
      if (!existing) {
        return code;
      }
    }
    throw new BadRequestException('Unable to generate warehouseCode');
  }
}
