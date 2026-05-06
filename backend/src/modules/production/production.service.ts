import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductionStatus } from '@prisma/client';
import { decimalToNumber, processSnapshotToArray } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { CompleteProductionDto, ProductionAnnualSummaryQueryDto, ProductionTaskQueryDto } from './dto';

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async findTasks(query: ProductionTaskQueryDto) {
    const where: Prisma.ProductionTaskWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.orderNo) {
      where.orderNo = { contains: query.orderNo.trim(), mode: 'insensitive' };
    }

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

    if (Object.keys(orderWhere).length > 0) {
      // 生产任务筛选通过订单关系完成，避免在 ProductionTask 冗余保存客户和订单日期字段。
      where.order = orderWhere;
    }

    const tasks = await this.prisma.productionTask.findMany({
      where,
      include: { order: true, orderLine: true },
      orderBy: [{ status: 'asc' }, { orderNo: 'desc' }, { productionTaskNo: 'asc' }]
    });

    return tasks.map((task) => this.toTask(task));
  }

  async annualSummary(query: ProductionAnnualSummaryQueryDto) {
    const year = query.year || new Date().getFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const rows = new Map<
      string,
      {
        partCode: string;
        partName: string;
        unit: string;
        customerOrderQuantity: number;
        productionPlanQuantity: number;
        completedProductionQuantity: number;
        shippedOrderQuantity: number;
        stockQuantity: number;
      }
    >();

    const getRow = (partCode: string, partName: string, unit: string) => {
      const key = `${partCode}__${unit}`;
      const current = rows.get(key);
      if (current) {
        return current;
      }
      const row = {
        partCode,
        partName,
        unit,
        customerOrderQuantity: 0,
        productionPlanQuantity: 0,
        completedProductionQuantity: 0,
        shippedOrderQuantity: 0,
        stockQuantity: 0
      };
      rows.set(key, row);
      return row;
    };

    const [orderLines, productionTasks] = await this.prisma.$transaction([
      // 年度生产情况按零件汇总，客户订单、生产计划、实际完成、订单发货分别计算，避免一个数量字段承担多个业务含义。
      this.prisma.orderLine.findMany({
        where: { order: { orderDate: { gte: start, lt: end } } }
      }),
      this.prisma.productionTask.findMany({
        where: { order: { orderDate: { gte: start, lt: end } } }
      })
    ]);

    const orderNos = Array.from(new Set(productionTasks.map((task) => task.orderNo)));
    const productionTaskNos = productionTasks.map((task) => task.productionTaskNo);
    const [shipmentTransactions, stockBatches] = await this.prisma.$transaction([
      // 发货统计也按来源订单的下单日期归属，不能按出库当天归属，否则跨年订单会被统计到错误年度。
      orderNos.length > 0
        ? this.prisma.inventoryTransaction.findMany({
            where: {
              transactionType: 'OUT',
              orderNo: { in: orderNos }
            }
          })
        : this.prisma.inventoryTransaction.findMany({ where: { id: '__empty__' } }),
      // 多做库存来自同一批生产任务，仍归属这些任务对应订单的下单年度。
      productionTaskNos.length > 0
        ? this.prisma.inventoryBatch.findMany({
            where: {
              sourceOrderId: null,
              sourceProductionTaskNo: { in: productionTaskNos }
            }
          })
        : this.prisma.inventoryBatch.findMany({ where: { id: '__empty__' } })
    ]);

    for (const line of orderLines) {
      const row = getRow(line.partCode, line.partName, line.unit);
      row.customerOrderQuantity += decimalToNumber(line.quantity);
      row.productionPlanQuantity += decimalToNumber(line.productionPlanQuantity ?? line.quantity);
    }

    for (const task of productionTasks) {
      const row = getRow(task.partCode, task.partName, task.unit);
      row.completedProductionQuantity += decimalToNumber(task.completedQuantity);
    }

    for (const transaction of shipmentTransactions) {
      const row = getRow(transaction.partCode, transaction.partName, transaction.unit);
      row.shippedOrderQuantity += decimalToNumber(transaction.quantity);
    }

    for (const batch of stockBatches) {
      const row = getRow(batch.partCode, batch.partName, batch.unit);
      row.stockQuantity += decimalToNumber(batch.quantity);
    }

    return Array.from(rows.values()).sort((a, b) => a.partCode.localeCompare(b.partCode, 'zh-Hans-CN'));
  }

  async start(id: string) {
    const task = await this.prisma.productionTask.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException('Production task not found');
    }
    if (task.status === ProductionStatus.COMPLETED) {
      throw new BadRequestException('Completed task cannot be started');
    }

    // 开始生产时同步订单状态，第一阶段只标记为 IN_PRODUCTION。
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.productionTask.update({
        where: { id },
        data: {
          status: ProductionStatus.IN_PROGRESS,
          startedAt: task.startedAt || new Date()
        }
      });
      await tx.customerOrder.update({
        where: { id: task.orderId },
        data: { status: 'IN_PRODUCTION' }
      });
      return saved;
    });

    return this.toTask(updated);
  }

  async complete(id: string, dto: CompleteProductionDto) {
    const task = await this.prisma.productionTask.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException('Production task not found');
    }
    if (task.status === ProductionStatus.COMPLETED) {
      throw new BadRequestException('Production task is already completed');
    }
    if (task.status !== ProductionStatus.IN_PROGRESS) {
      throw new BadRequestException('Production task must be started before completion');
    }

    const plannedQuantity = decimalToNumber(task.plannedQuantity);
    const completedQuantity = dto.completedQuantity ?? plannedQuantity;

    // 完成生产记录实际完成数，允许超过订单计划数；超出部分由仓库确认入库时转为备货库存。
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.productionTask.update({
        where: { id },
        data: {
          status: ProductionStatus.COMPLETED,
          completedQuantity,
          startedAt: task.startedAt || new Date(),
          completedAt: new Date(),
          remark: dto.remark
        }
      });

      await tx.customerOrder.update({
        where: { id: task.orderId },
        // 订单不能在生产完成时直接完成，必须经过仓库入库和发货后才允许进入 COMPLETED。
        data: { status: 'IN_PRODUCTION' }
      });

      return saved;
    });

    return this.toTask(updated);
  }

  private toTask(task: any) {
    return {
      id: task.id,
      productionTaskNo: task.productionTaskNo,
      orderId: task.orderId,
      orderNo: task.orderNo,
      customerId: task.order?.customerId,
      customerName: task.customerName,
      orderDate: task.order?.orderDate,
      deliveryDate: task.orderLine?.deliveryDate || task.order?.deliveryDate,
      partCode: task.partCode,
      partName: task.partName,
      plannedQuantity: decimalToNumber(task.plannedQuantity),
      completedQuantity: decimalToNumber(task.completedQuantity),
      unit: task.unit,
      status: task.status,
      processSteps: processSnapshotToArray(task.processSnapshot),
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      remark: task.remark
    };
  }
}
