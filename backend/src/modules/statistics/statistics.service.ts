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

    const orders = await this.prisma.customerOrder.findMany({
      where: { orderDate: { gte: start, lt: end } },
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
            this.prisma.productionTask.findMany({ where: { orderNo: { in: orderNos } } }),
            this.prisma.inventoryTransaction.findMany({
              where: {
                transactionType: InventoryTransactionType.OUT,
                orderNo: { in: orderNos }
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
      row.completedProductionQuantity += decimalToNumber(task.completedQuantity);
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
    const stockBatches =
      taskNos.length > 0
        ? await this.prisma.inventoryBatch.findMany({
            where: {
              sourceOrderId: null,
              sourceProductionTaskNo: { in: taskNos }
            }
          })
        : [];

    for (const batch of stockBatches) {
      if (!batch.sourceProductionTaskNo) {
        continue;
      }
      const orderPeriod = taskPeriodMap.get(batch.sourceProductionTaskNo);
      if (!orderPeriod) {
        continue;
      }
      const row = getRow(orderPeriod.periodKey, orderPeriod.periodLabel, batch.partCode, batch.partName, batch.unit);
      row.stockQuantity += decimalToNumber(batch.quantity);
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
      const totalQuantity = order.lines.reduce((sum, line) => sum + decimalToNumber(line.quantity), 0);
      const totalProductionPlanQuantity = order.lines.reduce(
        (sum, line) => sum + decimalToNumber(line.productionPlanQuantity ?? line.quantity),
        0
      );
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
}
