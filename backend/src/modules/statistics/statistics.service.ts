import { Injectable } from '@nestjs/common';
import { InventoryTransactionType } from '@prisma/client';
import { decimalToNumber } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatisticsQueryDto, StatisticsPeriod } from './dto';

type InternalSummaryRow = {
  periodKey: string;
  periodLabel: string;
  partCode: string;
  partName: string;
  unit: string;
  orderNoSet: Set<string>;
  customerOrderQuantity: number;
  productionPlanQuantity: number;
  completedProductionQuantity: number;
  shippedOrderQuantity: number;
  stockQuantity: number;
};

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async orderStatistics(query: OrderStatisticsQueryDto) {
    const period = query.period || StatisticsPeriod.YEAR;
    const year = query.year || new Date().getFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    const customerId = query.customerId?.trim();

    const orders = await this.prisma.customerOrder.findMany({
      // 统计表仍是只读展示，客户筛选只限制订单范围，不改变按 orderDate 归属的统计口径。
      where: {
        orderDate: { gte: start, lt: end },
        customerId: customerId || undefined
      },
      include: { lines: true },
      orderBy: [{ orderDate: 'desc' }, { orderNo: 'desc' }]
    });

    const orderNos = orders.map((order) => order.orderNo);
    const rows = new Map<string, InternalSummaryRow>();
    const orderPeriodMap = new Map(orders.map((order) => [order.orderNo, this.getPeriod(order.orderDate, period)]));

    const getRow = (periodKey: string, periodLabel: string, partCode: string, partName: string, unit: string) => {
      const key = `${periodKey}__${partCode}__${unit}`;
      const current = rows.get(key);
      if (current) {
        return current;
      }
      const row: InternalSummaryRow = {
        periodKey,
        periodLabel,
        partCode,
        partName,
        unit,
        orderNoSet: new Set<string>(),
        customerOrderQuantity: 0,
        productionPlanQuantity: 0,
        completedProductionQuantity: 0,
        shippedOrderQuantity: 0,
        stockQuantity: 0
      };
      rows.set(key, row);
      return row;
    };

    for (const order of orders) {
      const orderPeriod = orderPeriodMap.get(order.orderNo);
      if (!orderPeriod) {
        continue;
      }
      for (const line of order.lines) {
        const row = getRow(orderPeriod.periodKey, orderPeriod.periodLabel, line.partCode, line.partName, line.unit);
        row.orderNoSet.add(order.orderNo);
        row.customerOrderQuantity += decimalToNumber(line.quantity);
        row.productionPlanQuantity += decimalToNumber(line.productionPlanQuantity ?? line.quantity);
      }
    }

    const [productionTasks, shipmentTransactions] =
      orderNos.length > 0
        ? await this.prisma.$transaction([
            this.prisma.productionTask.findMany({
              where: { orderNo: { in: orderNos } },
              include: { inventoryBatch: true }
            }),
            this.prisma.inventoryTransaction.findMany({
              where: {
                transactionType: InventoryTransactionType.OUT,
                orderNo: { in: orderNos },
                // 订单发货数量只统计仓库确认发货生成的 OUT 流水；取消、盘点和备货领用不能混入发货口径。
                sourceRecordType: 'InventoryBatch'
              }
            })
          ])
        : [[], []];

    const taskPeriodMap = new Map<string, { periodKey: string; periodLabel: string }>();
    for (const task of productionTasks) {
      const orderPeriod = orderPeriodMap.get(task.orderNo);
      if (!orderPeriod) {
        continue;
      }
      taskPeriodMap.set(task.productionTaskNo, orderPeriod);
      const row = getRow(orderPeriod.periodKey, orderPeriod.periodLabel, task.partCode, task.partName, task.unit);
      row.orderNoSet.add(task.orderNo);
    }

    for (const transaction of shipmentTransactions) {
      if (!transaction.orderNo) {
        continue;
      }
      const orderPeriod = orderPeriodMap.get(transaction.orderNo);
      if (!orderPeriod) {
        continue;
      }
      const row = getRow(
        orderPeriod.periodKey,
        orderPeriod.periodLabel,
        transaction.partCode,
        transaction.partName,
        transaction.unit
      );
      row.orderNoSet.add(transaction.orderNo);
      row.shippedOrderQuantity += decimalToNumber(transaction.quantity);
    }

    const taskNos = Array.from(taskPeriodMap.keys());
    const receiptTransactions =
      taskNos.length > 0
        ? await this.prisma.inventoryTransaction.findMany({
            where: {
              transactionType: InventoryTransactionType.IN,
              productionTaskNo: { in: taskNos }
            }
          })
        : [];

    const stockQuantityByTaskNo = new Map<string, number>();
    const orderReceiptQuantityByTaskNo = new Map<string, number>();
    for (const transaction of receiptTransactions) {
      if (!transaction.productionTaskNo) {
        continue;
      }
      const orderPeriod = taskPeriodMap.get(transaction.productionTaskNo);
      if (!orderPeriod) {
        continue;
      }
      const quantity = decimalToNumber(transaction.quantity);
      // 统计历史生产结果必须按 IN 流水计算，不能按当前库存余量计算。
      if (transaction.orderNo) {
        orderReceiptQuantityByTaskNo.set(
          transaction.productionTaskNo,
          (orderReceiptQuantityByTaskNo.get(transaction.productionTaskNo) || 0) + quantity
        );
        continue;
      }
      const row = getRow(
        orderPeriod.periodKey,
        orderPeriod.periodLabel,
        transaction.partCode,
        transaction.partName,
        transaction.unit
      );
      row.stockQuantity += quantity;
      stockQuantityByTaskNo.set(transaction.productionTaskNo, (stockQuantityByTaskNo.get(transaction.productionTaskNo) || 0) + quantity);
    }

    for (const task of productionTasks) {
      const orderPeriod = taskPeriodMap.get(task.productionTaskNo);
      if (!orderPeriod) {
        continue;
      }
      const row = getRow(orderPeriod.periodKey, orderPeriod.periodLabel, task.partCode, task.partName, task.unit);
      row.completedProductionQuantity += this.toEffectiveTaskCompletedQuantity(
        task,
        stockQuantityByTaskNo.get(task.productionTaskNo) || 0,
        orderReceiptQuantityByTaskNo.get(task.productionTaskNo) || 0
      );
    }

    // 统计页只读展示，所有周期均按 CustomerOrder.orderDate 归属，不按生产完成或发货日期归属。
    const summaryRows = Array.from(rows.values())
      .map((row) => ({
        periodKey: row.periodKey,
        periodLabel: row.periodLabel,
        partCode: row.partCode,
        partName: row.partName,
        unit: row.unit,
        orderCount: row.orderNoSet.size,
        customerOrderQuantity: row.customerOrderQuantity,
        productionPlanQuantity: row.productionPlanQuantity,
        completedProductionQuantity: row.completedProductionQuantity,
        shippedOrderQuantity: row.shippedOrderQuantity,
        stockQuantity: row.stockQuantity
      }))
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.partCode.localeCompare(b.partCode, 'zh-Hans-CN'));

    const orderRows = orders.map((order) => {
      const orderPeriod = orderPeriodMap.get(order.orderNo) || this.getPeriod(order.orderDate, period);
      const quantityByUnit = this.toOrderQuantityByUnit(order.lines);
      const totalQuantity = quantityByUnit.reduce((sum, row) => sum + row.totalQuantity, 0);
      const totalProductionPlanQuantity = quantityByUnit.reduce((sum, row) => sum + row.totalProductionPlanQuantity, 0);
      return {
        periodKey: orderPeriod.periodKey,
        periodLabel: orderPeriod.periodLabel,
        orderNo: order.orderNo,
        customerName: order.customerName,
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        status: order.status,
        partCount: order.lines.length,
        totalQuantity,
        totalProductionPlanQuantity,
        quantityByUnit,
        unit: order.lines[0]?.unit || '件'
      };
    });

    return {
      period,
      year,
      summaryRows,
      orderRows
    };
  }

  private toOrderQuantityByUnit(lines: any[]) {
    const unitMap = new Map<string, { unit: string; totalQuantity: number; totalProductionPlanQuantity: number }>();
    for (const line of lines) {
      const unit = line.unit || '件';
      const row = unitMap.get(unit) || { unit, totalQuantity: 0, totalProductionPlanQuantity: 0 };
      row.totalQuantity += decimalToNumber(line.quantity);
      row.totalProductionPlanQuantity += decimalToNumber(line.productionPlanQuantity ?? line.quantity);
      unitMap.set(unit, row);
    }
    // 订单展示按单位分组汇总，避免只读统计页把不同计量单位混算成一个总数。
    return Array.from(unitMap.values()).sort((a, b) => a.unit.localeCompare(b.unit, 'zh-Hans-CN'));
  }

  private getPeriod(orderDate: Date, period: StatisticsPeriod) {
    const year = orderDate.getUTCFullYear();
    const month = orderDate.getUTCMonth() + 1;
    if (period === StatisticsPeriod.MONTH) {
      return {
        periodKey: `${year}-${String(month).padStart(2, '0')}`,
        periodLabel: `${year}年${month}月`
      };
    }
    if (period === StatisticsPeriod.QUARTER) {
      const quarter = Math.floor((month - 1) / 3) + 1;
      return {
        periodKey: `${year}-Q${quarter}`,
        periodLabel: `${year}年第${quarter}季度`
      };
    }
    return {
      periodKey: String(year),
      periodLabel: `${year}年`
    };
  }

  private toEffectiveTaskCompletedQuantity(task: any, stockQuantity = 0, orderReceiptQuantity = 0) {
    const completedQuantity = decimalToNumber(task.completedQuantity);
    if (completedQuantity > 0) {
      return completedQuantity;
    }
    // 历史任务若已入库但 completedQuantity 仍为 0，优先使用订单入库 IN 流水兜底。
    const orderInventoryQuantity = orderReceiptQuantity || (task.inventoryBatch ? decimalToNumber(task.inventoryBatch.quantity) : 0);
    return orderInventoryQuantity + stockQuantity;
  }
}
