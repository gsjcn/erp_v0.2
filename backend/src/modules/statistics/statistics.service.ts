import { Injectable } from '@nestjs/common';
import { InventoryReservationStatus, InventoryStatus, InventoryTransactionType, OrderStatus, Prisma, ProductionStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { businessDateKey } from '../../common/business-date';
import { decimalToNumber } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatisticsQueryDto, StatisticsPeriod } from './dto';

type StatisticsExportCellValue = string | number | Date | null | undefined;

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
  currentInventoryQuantity: number;
  currentOrderInventoryQuantity: number;
  currentStockInventoryQuantity: number;
  scrapQuantity: number;
};

type InternalCustomerSummaryRow = {
  periodKey: string;
  periodLabel: string;
  customerId?: string | null;
  customerName: string;
  unit: string;
  orderNoSet: Set<string>;
  customerOrderQuantity: number;
  productionPlanQuantity: number;
  completedProductionQuantity: number;
  shippedOrderQuantity: number;
  stockQuantity: number;
  currentInventoryQuantity: number;
  currentOrderInventoryQuantity: number;
  currentStockInventoryQuantity: number;
  scrapQuantity: number;
};

type CustomerStatisticsSnapshot = {
  customerId?: string | null;
  customerName: string;
};

type InventorySnapshotRow = {
  partCode: string;
  partName: string;
  unit: string;
  batchCount: number;
  warehouseCount: number;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
  stockAlertEnabled: boolean;
  stockAlertQuantity: number | null;
  stockAlertTriggered: boolean;
};

type InventorySnapshotPagination = {
  limit?: number;
  offset: number;
};

const STATISTICS_TEST_FIXTURE_PREFIXES = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  private hasTestFixturePrefix(...values: Array<string | null | undefined>) {
    return values.some((value) => {
      const text = String(value || '').trim();
      return STATISTICS_TEST_FIXTURE_PREFIXES.some((prefix) => text.startsWith(prefix));
    });
  }

  private isStatisticsTestFixtureOrder(
    order: Pick<Prisma.CustomerOrderGetPayload<{ include: { lines: true } }>, 'orderNo' | 'customerCode' | 'customerName' | 'lines'>
  ) {
    return (
      this.hasTestFixturePrefix(order.orderNo, order.customerCode, order.customerName) ||
      order.lines.some((line) => this.hasTestFixturePrefix(line.partCode, line.partName, line.projectModel))
    );
  }

  private isStatisticsTestFixtureInventoryBatch(batch: {
    batchNo?: string | null;
    partCode?: string | null;
    partName?: string | null;
    sourceOrderNo?: string | null;
    sourceCustomerName?: string | null;
    sourceOrder?: { orderNo?: string | null; customerName?: string | null } | null;
    productionTask?: { orderNo?: string | null; productionTaskNo?: string | null; customerName?: string | null; order?: { orderNo?: string | null; customerName?: string | null } | null } | null;
  }) {
    return this.hasTestFixturePrefix(
      batch.batchNo,
      batch.partCode,
      batch.partName,
      batch.sourceOrderNo,
      batch.sourceCustomerName,
      batch.sourceOrder?.orderNo,
      batch.sourceOrder?.customerName,
      batch.productionTask?.productionTaskNo,
      batch.productionTask?.orderNo,
      batch.productionTask?.customerName,
      batch.productionTask?.order?.orderNo,
      batch.productionTask?.order?.customerName
    );
  }

  async orderStatistics(query: OrderStatisticsQueryDto) {
    const period = query.period || StatisticsPeriod.YEAR;
    const year = query.year || Number(businessDateKey().substring(0, 4));
    const dateWindow = this.resolveStatisticsDateWindow(year);
    const start = dateWindow.start;
    const end = dateWindow.end;

    const customerId = query.customerId?.trim();
    const inventorySnapshotPagination = this.resolveInventorySnapshotPagination(query);
    const allInventorySnapshotRows = await this.currentInventorySnapshot(customerId);
    const inventorySnapshotPage = this.paginateInventorySnapshotRows(allInventorySnapshotRows, inventorySnapshotPagination);

    if (dateWindow.isFuturePeriod) {
      return {
        period,
        year,
        currentBusinessDate: dateWindow.currentBusinessDate,
        statisticsEndDate: dateWindow.statisticsEndDate,
        isFuturePeriod: true,
        isCurrentPeriodPartial: false,
        cutoffNotice: dateWindow.cutoffNotice,
        inventorySnapshotRows: inventorySnapshotPage.rows,
        inventorySnapshotTotal: inventorySnapshotPage.total,
        inventorySnapshotLimit: inventorySnapshotPage.limit,
        inventorySnapshotOffset: inventorySnapshotPage.offset,
        inventorySnapshotHasMore: inventorySnapshotPage.hasMore,
        customerRows: [],
        summaryRows: [],
        orderRows: []
      };
    }

    const orders = (await this.prisma.customerOrder.findMany({
      // 统计表仍是只读展示，客户筛选只限制订单范围；当前年份只统计到真实业务日期，不能把未来订单当作已发生。
      where: {
        orderDate: { gte: start, lt: end },
        customerId: customerId || undefined
      },
      include: { lines: true, inventoryBatches: true },
      orderBy: [{ orderDate: 'desc' }, { orderNo: 'desc' }]
    })).filter((order) => !this.isStatisticsTestFixtureOrder(order));

    const orderNos = orders.map((order) => order.orderNo);
    const rows = new Map<string, InternalSummaryRow>();
    const customerRows = new Map<string, InternalCustomerSummaryRow>();
    const orderPeriodMap = new Map(orders.map((order) => [order.orderNo, this.getPeriod(order.orderDate, period)]));
    const orderCustomerMap = new Map(
      orders.map((order) => [order.orderNo, { customerId: order.customerId, customerName: order.customerName }])
    );

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
        stockQuantity: 0,
        currentInventoryQuantity: 0,
        currentOrderInventoryQuantity: 0,
        currentStockInventoryQuantity: 0,
        scrapQuantity: 0
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
        const customerRow = this.getCustomerStatisticsRow(
          customerRows,
          orderPeriod.periodKey,
          orderPeriod.periodLabel,
          order.customerId,
          order.customerName,
          line.unit
        );
        customerRow.orderNoSet.add(order.orderNo);
        customerRow.customerOrderQuantity += decimalToNumber(line.quantity);
        customerRow.productionPlanQuantity += decimalToNumber(line.productionPlanQuantity ?? line.quantity);
      }
    }

    const [productionTasks, shipmentTransactions, stockAllocationTransactions] =
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
              },
              include: { batch: { select: { sourceOrderLineId: true } } }
            }),
            this.prisma.inventoryTransaction.findMany({
              where: {
                transactionType: InventoryTransactionType.IN,
                orderNo: { in: orderNos },
                sourceRecordType: 'OrderLineStockAllocation'
              }
            })
          ])
        : [[], [], []];

    const taskPeriodMap = new Map<string, { periodKey: string; periodLabel: string }>();
    const taskByTaskNo = new Map<string, (typeof productionTasks)[number]>();
    const tasksByOrderNo = new Map<string, typeof productionTasks>();
    for (const task of productionTasks) {
      const orderPeriod = orderPeriodMap.get(task.orderNo);
      if (!orderPeriod) {
        continue;
      }
      taskPeriodMap.set(task.productionTaskNo, orderPeriod);
      taskByTaskNo.set(task.productionTaskNo, task);
      const orderTasks = tasksByOrderNo.get(task.orderNo) || [];
      orderTasks.push(task);
      tasksByOrderNo.set(task.orderNo, orderTasks);
      const row = getRow(orderPeriod.periodKey, orderPeriod.periodLabel, task.partCode, task.partName, task.unit);
      row.orderNoSet.add(task.orderNo);
    }

    const shippedQuantityByOrderUnit = new Map<string, Map<string, number>>();
    const shippedQuantityByOrderLineId = new Map<string, number>();
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
      const quantity = decimalToNumber(transaction.quantity);
      row.shippedOrderQuantity += quantity;
      this.addOrderUnitQuantity(shippedQuantityByOrderUnit, transaction.orderNo, transaction.unit, quantity);
      const orderLineId = transaction.orderLineId || transaction.batch?.sourceOrderLineId;
      if (orderLineId) {
        this.addLineQuantity(shippedQuantityByOrderLineId, orderLineId, quantity);
      }
      const customer = orderCustomerMap.get(transaction.orderNo);
      if (customer) {
        const customerRow = this.getCustomerStatisticsRow(
          customerRows,
          orderPeriod.periodKey,
          orderPeriod.periodLabel,
          customer.customerId,
          customer.customerName,
          transaction.unit
        );
        customerRow.orderNoSet.add(transaction.orderNo);
        customerRow.shippedOrderQuantity += quantity;
      }
    }

    const stockAllocatedQuantityByOrderUnit = new Map<string, Map<string, number>>();
    const stockAllocatedQuantityByOrderLineId = new Map<string, number>();
    for (const transaction of stockAllocationTransactions) {
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
      const quantity = decimalToNumber(transaction.quantity);
      // 使用库存转订单待发货库存只代表该数量已经可发货；统计页“实际完成数量”仍只统计真实生产入库。
      this.addOrderUnitQuantity(stockAllocatedQuantityByOrderUnit, transaction.orderNo, transaction.unit, quantity);
      if (transaction.orderLineId) {
        this.addLineQuantity(stockAllocatedQuantityByOrderLineId, transaction.orderLineId, quantity);
      }
    }

    const taskNos = Array.from(taskPeriodMap.keys());
    const receiptTransactions =
      taskNos.length > 0
        ? await this.prisma.inventoryTransaction.findMany({
            where: {
              transactionType: InventoryTransactionType.IN,
              productionTaskNo: { in: taskNos },
              // 只统计生产任务确认入库产生的 IN；备货库存转订单库存由 OrderLineStockAllocation 单独统计。
              sourceRecordType: 'ProductionTask'
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
          (orderReceiptQuantityByTaskNo.get(transaction.productionTaskNo) ?? 0) + quantity
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
      stockQuantityByTaskNo.set(transaction.productionTaskNo, (stockQuantityByTaskNo.get(transaction.productionTaskNo) ?? 0) + quantity);
      const task = taskByTaskNo.get(transaction.productionTaskNo);
      if (task) {
        const customer: CustomerStatisticsSnapshot = orderCustomerMap.get(task.orderNo) || { customerName: task.customerName };
        const customerRow = this.getCustomerStatisticsRow(
          customerRows,
          orderPeriod.periodKey,
          orderPeriod.periodLabel,
          customer.customerId,
          customer.customerName,
          transaction.unit
        );
        customerRow.orderNoSet.add(task.orderNo);
        customerRow.stockQuantity += quantity;
      }
    }

    const completedProductionQuantityByOrderUnit = new Map<string, Map<string, number>>();
    const completedProductionQuantityByOrderLineId = new Map<string, number>();
    for (const task of productionTasks) {
      const orderPeriod = taskPeriodMap.get(task.productionTaskNo);
      if (!orderPeriod) {
        continue;
      }
      const row = getRow(orderPeriod.periodKey, orderPeriod.periodLabel, task.partCode, task.partName, task.unit);
      const completedQuantity = this.toEffectiveTaskCompletedQuantity(
        task,
        stockQuantityByTaskNo.get(task.productionTaskNo) ?? 0,
        orderReceiptQuantityByTaskNo.get(task.productionTaskNo) ?? 0
      );
      row.completedProductionQuantity += completedQuantity;
      this.addOrderUnitQuantity(completedProductionQuantityByOrderUnit, task.orderNo, task.unit, completedQuantity);
      if (task.orderLineId) {
        this.addLineQuantity(completedProductionQuantityByOrderLineId, task.orderLineId, completedQuantity);
      }
      const customer: CustomerStatisticsSnapshot = orderCustomerMap.get(task.orderNo) || { customerName: task.customerName };
      const customerRow = this.getCustomerStatisticsRow(
        customerRows,
        orderPeriod.periodKey,
        orderPeriod.periodLabel,
        customer.customerId,
        customer.customerName,
        task.unit
      );
      customerRow.orderNoSet.add(task.orderNo);
      customerRow.completedProductionQuantity += completedQuantity;
    }

    const completedFulfillmentQuantityByOrderUnit = this.mergeOrderUnitQuantityMaps(
      completedProductionQuantityByOrderUnit,
      stockAllocatedQuantityByOrderUnit
    );
    const completedFulfillmentQuantityByOrderLineId = this.mergeLineQuantityMaps(
      completedProductionQuantityByOrderLineId,
      stockAllocatedQuantityByOrderLineId
    );

    await this.appendScrapStatisticsRows(rows, customerRows, period, start, end, customerId);
    if (dateWindow.isCurrentPeriodPartial) {
      await this.appendCurrentInventoryStatisticsRows(rows, customerRows, period, dateWindow, customerId);
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
        stockQuantity: row.stockQuantity,
        currentInventoryQuantity: row.currentInventoryQuantity,
        currentOrderInventoryQuantity: row.currentOrderInventoryQuantity,
        currentStockInventoryQuantity: row.currentStockInventoryQuantity,
        scrapQuantity: row.scrapQuantity
      }))
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.partCode.localeCompare(b.partCode, 'zh-Hans-CN'));

    const customerSummaryRows = Array.from(customerRows.values())
      .map((row) => ({
        periodKey: row.periodKey,
        periodLabel: row.periodLabel,
        customerId: row.customerId || undefined,
        customerName: row.customerName,
        unit: row.unit,
        orderCount: row.orderNoSet.size,
        customerOrderQuantity: row.customerOrderQuantity,
        productionPlanQuantity: row.productionPlanQuantity,
        completedProductionQuantity: row.completedProductionQuantity,
        shippedOrderQuantity: row.shippedOrderQuantity,
        stockQuantity: row.stockQuantity,
        currentInventoryQuantity: row.currentInventoryQuantity,
        currentOrderInventoryQuantity: row.currentOrderInventoryQuantity,
        currentStockInventoryQuantity: row.currentStockInventoryQuantity,
        scrapQuantity: row.scrapQuantity
      }))
      .sort(
        (a, b) =>
          a.periodKey.localeCompare(b.periodKey) ||
          a.customerName.localeCompare(b.customerName, 'zh-Hans-CN') ||
          a.unit.localeCompare(b.unit, 'zh-Hans-CN')
      );

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
        statisticsStatus: this.resolveOrderStatisticsStatus(
          order.status,
          order.lines,
          quantityByUnit,
          tasksByOrderNo.get(order.orderNo) || [],
          completedProductionQuantityByOrderUnit.get(order.orderNo) || new Map<string, number>(),
          completedFulfillmentQuantityByOrderUnit.get(order.orderNo) || new Map<string, number>(),
          shippedQuantityByOrderUnit.get(order.orderNo) || new Map<string, number>(),
          completedFulfillmentQuantityByOrderLineId,
          shippedQuantityByOrderLineId,
          order.inventoryBatches || []
        ),
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
      currentBusinessDate: dateWindow.currentBusinessDate,
      statisticsEndDate: dateWindow.statisticsEndDate,
      isFuturePeriod: false,
      isCurrentPeriodPartial: dateWindow.isCurrentPeriodPartial,
      cutoffNotice: dateWindow.cutoffNotice,
      inventorySnapshotRows: inventorySnapshotPage.rows,
      inventorySnapshotTotal: inventorySnapshotPage.total,
      inventorySnapshotLimit: inventorySnapshotPage.limit,
      inventorySnapshotOffset: inventorySnapshotPage.offset,
      inventorySnapshotHasMore: inventorySnapshotPage.hasMore,
      customerRows: customerSummaryRows,
      summaryRows,
      orderRows
    };
  }

  async buildOrderStatisticsExport(query: OrderStatisticsQueryDto): Promise<Uint8Array> {
    const statistics = await this.orderStatistics({
      ...query,
      inventorySnapshotLimit: undefined,
      inventorySnapshotOffset: undefined
    });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();

    const scopeText = await this.orderStatisticsExportScopeText(query, statistics);
    this.addOrderStatisticsExportSheet(workbook, {
      sheetName: '总汇总',
      title: '订单统计表 - 总汇总',
      scopeText,
      headers: ['序号', '统计范围', '指标', '数量', '单位'],
      rows: this.orderStatisticsTotalExportRows(statistics)
    });

    this.addOrderStatisticsExportSheet(workbook, {
      sheetName: '客户汇总',
      title: '订单统计表 - 客户汇总',
      scopeText,
      headers: [
        '序号',
        '统计周期',
        '客户',
        '订单数',
        '客户订单数量',
        '生产计划数量',
        '实际完成数量',
        '订单发货数量',
        '转库存数量',
        '当前库存数量',
        '当前订单库存数量',
        '当前备货库存数量',
        '报废数量',
        '单位'
      ],
      rows: statistics.customerRows.map((row, index) => [
        index + 1,
        row.periodLabel,
        row.customerName,
        row.orderCount,
        row.customerOrderQuantity,
        row.productionPlanQuantity,
        row.completedProductionQuantity,
        row.shippedOrderQuantity,
        row.stockQuantity,
        row.currentInventoryQuantity,
        row.currentOrderInventoryQuantity,
        row.currentStockInventoryQuantity,
        row.scrapQuantity,
        row.unit
      ])
    });

    this.addOrderStatisticsExportSheet(workbook, {
      sheetName: '零件汇总',
      title: '订单统计表 - 零件汇总',
      scopeText,
      headers: [
        '序号',
        '统计周期',
        '零件编码',
        '零件名称',
        '订单数',
        '客户订单数量',
        '生产计划数量',
        '实际完成数量',
        '订单发货数量',
        '转库存数量',
        '当前库存数量',
        '当前订单库存数量',
        '当前备货库存数量',
        '报废数量',
        '单位'
      ],
      rows: statistics.summaryRows.map((row, index) => [
        index + 1,
        row.periodLabel,
        row.partCode,
        row.partName,
        row.orderCount,
        row.customerOrderQuantity,
        row.productionPlanQuantity,
        row.completedProductionQuantity,
        row.shippedOrderQuantity,
        row.stockQuantity,
        row.currentInventoryQuantity,
        row.currentOrderInventoryQuantity,
        row.currentStockInventoryQuantity,
        row.scrapQuantity,
        row.unit
      ])
    });

    this.addOrderStatisticsExportSheet(workbook, {
      sheetName: '订单展示',
      title: '订单统计表 - 订单展示',
      scopeText,
      headers: ['序号', '统计周期', '订单号', '客户', '订单日期', '交期', '零件数', '客户订单数量', '生产计划数量', '订单状态'],
      rows: statistics.orderRows.map((row, index) => [
        index + 1,
        row.periodLabel,
        row.orderNo,
        row.customerName,
        this.formatBusinessDateText(row.orderDate),
        this.formatBusinessDateText(row.deliveryDate),
        row.partCount,
        this.orderStatisticsExportOrderQuantityText(row, 'totalQuantity'),
        this.orderStatisticsExportOrderQuantityText(row, 'totalProductionPlanQuantity'),
        this.orderStatisticsStatusLabel(row.statisticsStatus || row.status)
      ])
    });

    this.addOrderStatisticsExportSheet(workbook, {
      sheetName: '库存快照',
      title: '订单统计表 - 库存快照',
      scopeText,
      headers: [
        '序号',
        '零件编码',
        '零件名称',
        '批次数',
        '仓库数',
        '账面数量',
        '预占数量',
        '可用数量',
        '订单库存',
        '备货库存',
        '库存报警',
        '单位'
      ],
      rows: statistics.inventorySnapshotRows.map((row, index) => [
        index + 1,
        row.partCode,
        row.partName,
        row.batchCount,
        row.warehouseCount,
        row.physicalQuantity,
        row.reservedQuantity,
        row.availableQuantity,
        row.orderInventoryQuantity,
        row.stockInventoryQuantity,
        this.orderStatisticsInventorySnapshotAlertText(row),
        row.unit
      ])
    });

    // 统计导出只复用只读统计结果生成真实 .xlsx，不写入订单、生产、仓库或库存数据。
    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  private orderStatisticsTotalExportRows(statistics: Awaited<ReturnType<StatisticsService['orderStatistics']>>) {
    const rows: StatisticsExportCellValue[][] = [[1, '全部客户合计', '订单数', statistics.orderRows.length, '单']];
    const metrics = [
      { field: 'customerOrderQuantity' as const, label: '客户订单数量' },
      { field: 'productionPlanQuantity' as const, label: '生产计划数量' },
      { field: 'completedProductionQuantity' as const, label: '实际完成数量' },
      { field: 'shippedOrderQuantity' as const, label: '订单发货数量' },
      { field: 'stockQuantity' as const, label: '转库存数量' },
      { field: 'currentInventoryQuantity' as const, label: '当前库存数量' },
      { field: 'currentOrderInventoryQuantity' as const, label: '当前订单库存数量' },
      { field: 'currentStockInventoryQuantity' as const, label: '当前备货库存数量' },
      { field: 'scrapQuantity' as const, label: '报废数量' }
    ];

    for (const metric of metrics) {
      const quantityByUnit = new Map<string, number>();
      for (const row of statistics.summaryRows) {
        const unit = row.unit || '件';
        quantityByUnit.set(unit, (quantityByUnit.get(unit) ?? 0) + Number(row[metric.field] ?? 0));
      }
      const unitRows = quantityByUnit.size > 0 ? Array.from(quantityByUnit.entries()) : [['件', 0] as [string, number]];
      for (const [unit, quantity] of unitRows) {
        rows.push([rows.length + 1, '全部客户合计', metric.label, quantity, unit]);
      }
    }

    return rows;
  }

  private resolveStatisticsDateWindow(year: number) {
    const currentKey = businessDateKey();
    const currentYear = Number(currentKey.substring(0, 4));
    const currentMonth = Number(currentKey.substring(4, 6));
    const currentDay = Number(currentKey.substring(6, 8));
    const currentBusinessDate = `${currentKey.substring(0, 4)}-${currentKey.substring(4, 6)}-${currentKey.substring(6, 8)}`;
    const start = new Date(Date.UTC(year, 0, 1));

    if (year > currentYear) {
      return {
        start,
        end: start,
        currentBusinessDate,
        statisticsEndDate: currentBusinessDate,
        isFuturePeriod: true,
        isCurrentPeriodPartial: false,
        cutoffNotice: `${year}年是未来期间，统计页不把未来订单当作已发生数据。`
      };
    }

    if (year === currentYear) {
      return {
        start,
        end: new Date(Date.UTC(currentYear, currentMonth - 1, currentDay + 1)),
        currentBusinessDate,
        statisticsEndDate: currentBusinessDate,
        isFuturePeriod: false,
        isCurrentPeriodPartial: true,
        cutoffNotice: `当前${year}年统计截止到真实业务日期 ${currentBusinessDate}，未来日期不纳入已发生数据。`
      };
    }

    return {
      start,
      end: new Date(Date.UTC(year + 1, 0, 1)),
      currentBusinessDate,
      statisticsEndDate: `${year}-12-31`,
      isFuturePeriod: false,
      isCurrentPeriodPartial: false,
      cutoffNotice: ''
    };
  }

  private addOrderStatisticsExportSheet(
    workbook: ExcelJS.Workbook,
    options: {
      sheetName: string;
      title: string;
      scopeText: string;
      headers: string[];
      rows: StatisticsExportCellValue[][];
    }
  ) {
    const worksheet = workbook.addWorksheet(this.safeOrderStatisticsExportSheetName(options.sheetName), {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 }
      },
      views: [{ state: 'frozen', ySplit: 4 }]
    });
    const columnCount = Math.max(options.headers.length, 1);
    const titleRow = worksheet.addRow([options.title]);
    worksheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount);
    titleRow.font = { bold: true, size: 16 };
    titleRow.alignment = { vertical: 'middle', horizontal: 'center' };
    titleRow.height = 26;

    const scopeRow = worksheet.addRow([options.scopeText]);
    worksheet.mergeCells(scopeRow.number, 1, scopeRow.number, columnCount);
    scopeRow.font = { color: { argb: 'FF475569' } };
    scopeRow.alignment = { vertical: 'middle', wrapText: true };

    const generatedRow = worksheet.addRow([`制表日期：${this.orderStatisticsExportDateTimeText(new Date())}`]);
    worksheet.mergeCells(generatedRow.number, 1, generatedRow.number, columnCount);
    generatedRow.font = { color: { argb: 'FF475569' } };

    const headerRow = worksheet.addRow(options.headers);
    headerRow.font = { bold: true, color: { argb: 'FF0F172A' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.border = this.orderStatisticsExportThinBorder();
    });

    for (const row of options.rows) {
      const dataRow = worksheet.addRow(row);
      dataRow.alignment = { vertical: 'top', wrapText: true };
      dataRow.eachCell((cell) => {
        cell.border = this.orderStatisticsExportThinBorder();
      });
    }

    options.headers.forEach((header, index) => {
      const column = worksheet.getColumn(index + 1);
      const maxLength = [header, ...options.rows.map((row) => row[index])]
        .map((value) => this.orderStatisticsExportDisplayWidth(value))
        .reduce((max, width) => Math.max(max, width), 0);
      column.width = Math.min(Math.max(maxLength + 2, 8), 34);
    });

    worksheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: columnCount }
    };
  }

  private async orderStatisticsExportScopeText(query: OrderStatisticsQueryDto, statistics: Awaited<ReturnType<StatisticsService['orderStatistics']>>) {
    const customerLabel = await this.orderStatisticsExportCustomerLabel(query.customerId);
    return [
      `统计周期：${this.orderStatisticsExportPeriodLabel(statistics.period)}`,
      `年份：${statistics.year}`,
      `客户：${customerLabel}`,
      `统计截止：${statistics.statisticsEndDate || '-'}`,
      statistics.cutoffNotice ? `提示：${statistics.cutoffNotice}` : ''
    ]
      .filter(Boolean)
      .join('；');
  }

  private async orderStatisticsExportCustomerLabel(customerId?: string) {
    if (!customerId?.trim()) {
      return '全部客户';
    }
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId.trim() },
      select: { customerCode: true, customerName: true }
    });
    return customer ? `${customer.customerName} / ${customer.customerCode}` : customerId.trim();
  }

  private orderStatisticsExportPeriodLabel(period: StatisticsPeriod) {
    if (period === StatisticsPeriod.MONTH) {
      return '月度';
    }
    if (period === StatisticsPeriod.QUARTER) {
      return '季度';
    }
    return '年度';
  }

  private orderStatisticsExportOrderQuantityText(
    row: { quantityByUnit?: Array<{ unit: string; totalQuantity: number; totalProductionPlanQuantity: number }>; unit: string } & Record<
      string,
      unknown
    >,
    field: 'totalQuantity' | 'totalProductionPlanQuantity'
  ) {
    if (row.quantityByUnit?.length) {
      return row.quantityByUnit.map((item) => `${Number(item[field] ?? 0)} ${item.unit || '件'}`).join(' / ');
    }
    return `${Number(row[field] ?? 0)} ${row.unit || '件'}`;
  }

  private orderStatisticsInventorySnapshotAlertText(row: InventorySnapshotRow) {
    if (!row.stockAlertEnabled) {
      return '未启用';
    }
    const alertQuantity = row.stockAlertQuantity === null || row.stockAlertQuantity === undefined ? '-' : `${row.stockAlertQuantity} ${row.unit || ''}`.trim();
    return row.stockAlertTriggered ? `低库存：低于 ${alertQuantity}` : `正常：下限 ${alertQuantity}`;
  }

  private orderStatisticsStatusLabel(status?: string) {
    const labels: Record<string, string> = {
      ORDER_DRAFT: '待提交生产',
      WAITING_PRODUCTION: '待确认生产',
      ORDER_IN_PRODUCTION: '生产中',
      ORDER_COMPLETED_UNSHIPPED: '已完成未发货',
      PARTIAL_SHIPPED: '部分发货',
      ORDER_SHIPPED_COMPLETED: '已完成发货',
      ORDER_CANCELLED: '已取消',
      DRAFT: '待提交生产',
      PENDING_PRODUCTION: '待确认生产',
      IN_PRODUCTION: '生产中',
      COMPLETED: '已完成',
      CANCELLED: '已取消'
    };
    return labels[String(status || '')] || String(status || '-');
  }

  private safeOrderStatisticsExportSheetName(value: string) {
    const safeName = value.replace(/[\\/*?:[\]]/g, '').trim() || 'Sheet1';
    return safeName.substring(0, 31);
  }

  private orderStatisticsExportDateTimeText(value: Date) {
    const dateText = this.formatBusinessDateText(value);
    const hour = String(value.getHours()).padStart(2, '0');
    const minute = String(value.getMinutes()).padStart(2, '0');
    const second = String(value.getSeconds()).padStart(2, '0');
    return `${dateText} ${hour}:${minute}:${second}`;
  }

  private formatBusinessDateText(value?: Date | string | null) {
    if (!value) {
      return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private orderStatisticsExportDisplayWidth(value: StatisticsExportCellValue) {
    const text = value instanceof Date ? this.formatBusinessDateText(value) : String(value ?? '');
    return [...text].reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
  }

  private orderStatisticsExportThinBorder() {
    return {
      top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } }
    };
  }

  private async appendScrapStatisticsRows(
    rows: Map<string, InternalSummaryRow>,
    customerRows: Map<string, InternalCustomerSummaryRow>,
    period: StatisticsPeriod,
    start: Date,
    end: Date,
    customerId?: string
  ) {
    const where: Prisma.ProductionScrapRecordWhereInput = {
      recordDate: { gte: start, lt: end },
      // 报废统计只统计有效报废来源；取消归档和撤回快照只保留追溯，不进入发生量。
      sourceRecordType: { in: ['ProductionProcessCompletion', 'ProductionTaskWithdraw', 'CustomerChangeWarehouseScrap'] }
    };
    if (customerId) {
      const scopedOrders = await this.prisma.customerOrder.findMany({
        where: { customerId },
        select: { id: true, orderNo: true }
      });
      if (scopedOrders.length === 0) {
        return;
      }
      where.OR = [
        { orderId: { in: scopedOrders.map((order) => order.id) } },
        { orderNo: { in: scopedOrders.map((order) => order.orderNo) } }
      ];
    }

    const scrapRecords = (await this.prisma.productionScrapRecord.findMany({
      where,
      select: { recordDate: true, orderId: true, orderNo: true, partCode: true, partName: true, quantity: true, unit: true }
    })).filter((record) => !this.hasTestFixturePrefix(record.orderNo, record.partCode, record.partName));
    const scrapOrderMap = await this.findOrderCustomerMapForStatistics(scrapRecords.map((record) => record.orderNo));
    for (const record of scrapRecords) {
      const recordPeriod = this.getPeriod(record.recordDate, period);
      const row = this.getStatisticsRow(rows, recordPeriod.periodKey, recordPeriod.periodLabel, record.partCode, record.partName, record.unit);
      const quantity = decimalToNumber(record.quantity);
      row.scrapQuantity += quantity;
      const customer = scrapOrderMap.get(record.orderNo);
      if (customer) {
        const customerRow = this.getCustomerStatisticsRow(
          customerRows,
          recordPeriod.periodKey,
          recordPeriod.periodLabel,
          customer.customerId,
          customer.customerName,
          record.unit
        );
        customerRow.orderNoSet.add(record.orderNo);
        customerRow.scrapQuantity += quantity;
      }
    }
  }

  private async appendCurrentInventoryStatisticsRows(
    rows: Map<string, InternalSummaryRow>,
    customerRows: Map<string, InternalCustomerSummaryRow>,
    period: StatisticsPeriod,
    dateWindow: { currentBusinessDate: string },
    customerId?: string
  ) {
    const currentPeriod = this.getPeriod(this.businessDateTextToUtcDate(dateWindow.currentBusinessDate), period);
    const where: Prisma.InventoryBatchWhereInput = {
      status: InventoryStatus.AVAILABLE,
      quantity: { gt: 0 }
    };
    if (customerId) {
      where.OR = [
        { sourceOrder: { customerId } },
        { productionTask: { order: { customerId } } }
      ];
    }

    const batches = await this.prisma.inventoryBatch.findMany({
      where,
      select: {
        batchNo: true,
        partCode: true,
        partName: true,
        quantity: true,
        unit: true,
        sourceOrderId: true,
        sourceOrderNo: true,
        sourceCustomerName: true,
        sourceOrder: { select: { orderNo: true, customerId: true, customerName: true } },
        productionTask: { select: { productionTaskNo: true, orderNo: true, customerName: true, order: { select: { orderNo: true, customerId: true, customerName: true } } } }
      }
    });
    for (const batch of batches.filter((item) => !this.isStatisticsTestFixtureInventoryBatch(item))) {
      const row = this.getStatisticsRow(rows, currentPeriod.periodKey, currentPeriod.periodLabel, batch.partCode, batch.partName, batch.unit);
      // 当前库存是查询时点快照，只从 InventoryBatch 实时计算，不保存第二份汇总数量。
      const quantity = decimalToNumber(batch.quantity);
      row.currentInventoryQuantity += quantity;
      if (batch.sourceOrderId) {
        row.currentOrderInventoryQuantity += quantity;
      } else {
        row.currentStockInventoryQuantity += quantity;
      }
      const customer = this.inventoryBatchCustomerSnapshot(batch);
      const customerRow = this.getCustomerStatisticsRow(
        customerRows,
        currentPeriod.periodKey,
        currentPeriod.periodLabel,
        customer.customerId,
        customer.customerName,
        batch.unit
      );
      if (batch.productionTask?.orderNo) {
        customerRow.orderNoSet.add(batch.productionTask.orderNo);
      }
      customerRow.currentInventoryQuantity += quantity;
      if (batch.sourceOrderId) {
        customerRow.currentOrderInventoryQuantity += quantity;
      } else {
        customerRow.currentStockInventoryQuantity += quantity;
      }
    }
  }

  private getStatisticsRow(
    rows: Map<string, InternalSummaryRow>,
    periodKey: string,
    periodLabel: string,
    partCode: string,
    partName: string,
    unit: string
  ) {
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
      stockQuantity: 0,
      currentInventoryQuantity: 0,
      currentOrderInventoryQuantity: 0,
      currentStockInventoryQuantity: 0,
      scrapQuantity: 0
    };
    rows.set(key, row);
    return row;
  }

  private getCustomerStatisticsRow(
    rows: Map<string, InternalCustomerSummaryRow>,
    periodKey: string,
    periodLabel: string,
    customerId: string | null | undefined,
    customerName: string,
    unit: string
  ) {
    const normalizedCustomerName = customerName || '未关联客户';
    const key = `${periodKey}__${customerId || 'NO_CUSTOMER_ID'}__${normalizedCustomerName}__${unit || '件'}`;
    const current = rows.get(key);
    if (current) {
      return current;
    }
    const row: InternalCustomerSummaryRow = {
      periodKey,
      periodLabel,
      customerId,
      customerName: normalizedCustomerName,
      unit: unit || '件',
      orderNoSet: new Set<string>(),
      customerOrderQuantity: 0,
      productionPlanQuantity: 0,
      completedProductionQuantity: 0,
      shippedOrderQuantity: 0,
      stockQuantity: 0,
      currentInventoryQuantity: 0,
      currentOrderInventoryQuantity: 0,
      currentStockInventoryQuantity: 0,
      scrapQuantity: 0
    };
    rows.set(key, row);
    return row;
  }

  private async findOrderCustomerMapForStatistics(orderNos: Array<string | null | undefined>) {
    const normalizedOrderNos = Array.from(new Set(orderNos.map((orderNo) => orderNo?.trim()).filter(Boolean) as string[]));
    if (normalizedOrderNos.length === 0) {
      return new Map<string, CustomerStatisticsSnapshot>();
    }
    const orders = await this.prisma.customerOrder.findMany({
      where: { orderNo: { in: normalizedOrderNos } },
      select: { orderNo: true, customerId: true, customerName: true }
    });
    return new Map(orders.map((order) => [order.orderNo, { customerId: order.customerId, customerName: order.customerName }]));
  }

  private resolveInventorySnapshotPagination(query: OrderStatisticsQueryDto): InventorySnapshotPagination {
    const limit = query.inventorySnapshotLimit;
    const offset = query.inventorySnapshotOffset ?? 0;
    return {
      limit: typeof limit === 'number' && Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : undefined,
      offset: Number.isFinite(offset) ? Math.min(Math.max(Math.trunc(offset), 0), 100000) : 0
    };
  }

  private paginateInventorySnapshotRows(rows: InventorySnapshotRow[], pagination: InventorySnapshotPagination) {
    const total = rows.length;
    const offset = Math.min(pagination.offset, total);
    const limit = pagination.limit ?? total;
    const pageRows = pagination.limit === undefined ? rows : rows.slice(offset, offset + limit);
    return {
      rows: pageRows,
      total,
      limit,
      offset,
      hasMore: offset + pageRows.length < total
    };
  }

  private async currentInventorySnapshot(customerId?: string): Promise<InventorySnapshotRow[]> {
    const where: Prisma.InventoryBatchWhereInput = {
      status: InventoryStatus.AVAILABLE,
      quantity: { gt: 0 }
    };
    if (customerId) {
      where.OR = [
        { sourceOrder: { customerId } },
        { productionTask: { order: { customerId } } }
      ];
    }

    const batches = await this.prisma.inventoryBatch.findMany({
      where,
      select: {
        id: true,
        batchNo: true,
        partCode: true,
        partName: true,
        quantity: true,
        unit: true,
        sourceOrderId: true,
        sourceOrderNo: true,
        sourceCustomerName: true,
        warehouseId: true,
        sourceOrder: { select: { orderNo: true, customerName: true } },
        productionTask: { select: { productionTaskNo: true, orderNo: true, customerName: true, order: { select: { orderNo: true, customerName: true } } } }
      },
      orderBy: [{ partCode: 'asc' }, { createdAt: 'asc' }]
    });
    const visibleBatches = batches.filter((item) => !this.isStatisticsTestFixtureInventoryBatch(item));
    if (visibleBatches.length === 0) {
      return [];
    }

    const activeReservations = await this.prisma.inventoryReservation.groupBy({
      by: ['batchId'],
      where: {
        batchId: { in: visibleBatches.map((batch) => batch.id) },
        status: InventoryReservationStatus.ACTIVE
      },
      _sum: { quantity: true }
    });
    const reservedQuantityByBatchId = new Map(activeReservations.map((row) => [row.batchId, decimalToNumber(row._sum.quantity)]));
    const materialPartCodes = Array.from(new Set(visibleBatches.map((batch) => batch.partCode.trim()).filter(Boolean)));
    const materials = await this.prisma.material.findMany({
      where: {
        OR: materialPartCodes.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' } }))
      },
      select: {
        partCode: true,
        stockAlertEnabled: true,
        stockAlertQuantity: true
      }
    });
    const materialByCode = new Map(materials.map((material) => [material.partCode.trim().toLocaleLowerCase('zh-CN'), material]));
    const rows = new Map<string, InventorySnapshotRow & { warehouseIds: Set<string> }>();

    for (const batch of visibleBatches) {
      const partCode = batch.partCode.trim();
      const unit = batch.unit || '件';
      const key = `${partCode.toLocaleLowerCase('zh-CN')}__${unit}`;
      const material = materialByCode.get(partCode.toLocaleLowerCase('zh-CN'));
      const row =
        rows.get(key) ||
        ({
          partCode,
          partName: batch.partName,
          unit,
          batchCount: 0,
          warehouseCount: 0,
          physicalQuantity: 0,
          reservedQuantity: 0,
          availableQuantity: 0,
          orderInventoryQuantity: 0,
          stockInventoryQuantity: 0,
          stockAlertEnabled: Boolean(material?.stockAlertEnabled),
          stockAlertQuantity:
            material?.stockAlertQuantity === null || material?.stockAlertQuantity === undefined
              ? null
              : decimalToNumber(material.stockAlertQuantity),
          stockAlertTriggered: false,
          warehouseIds: new Set<string>()
        } satisfies InventorySnapshotRow & { warehouseIds: Set<string> });
      const physicalQuantity = decimalToNumber(batch.quantity);
      const reservedQuantity = batch.sourceOrderId ? 0 : (reservedQuantityByBatchId.get(batch.id) ?? 0);
      const availableQuantity = Math.max(Math.round((physicalQuantity - reservedQuantity + Number.EPSILON) * 1000) / 1000, 0);

      row.partName = row.partName || batch.partName;
      row.batchCount += 1;
      row.warehouseIds.add(batch.warehouseId);
      row.warehouseCount = row.warehouseIds.size;
      row.physicalQuantity += physicalQuantity;
      row.reservedQuantity += reservedQuantity;
      row.availableQuantity += availableQuantity;
      if (batch.sourceOrderId) {
        row.orderInventoryQuantity += availableQuantity;
      } else {
        row.stockInventoryQuantity += availableQuantity;
      }
      rows.set(key, row);
    }

    return Array.from(rows.values())
      .map(({ warehouseIds: _warehouseIds, ...row }) => ({
        ...row,
        stockAlertTriggered: row.stockAlertEnabled && row.stockAlertQuantity !== null && row.availableQuantity <= row.stockAlertQuantity
      }))
      .sort((a, b) => {
        if (a.stockAlertTriggered !== b.stockAlertTriggered) {
          return a.stockAlertTriggered ? -1 : 1;
        }
        return a.partCode.localeCompare(b.partCode, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      });
  }

  private inventoryBatchCustomerSnapshot(batch: {
    sourceCustomerName?: string | null;
    sourceOrder?: { customerId?: string | null; customerName?: string | null } | null;
    productionTask?: {
      customerName?: string | null;
      order?: { customerId?: string | null; customerName?: string | null } | null;
    } | null;
  }): CustomerStatisticsSnapshot {
    if (batch.sourceOrder?.customerName) {
      return { customerId: batch.sourceOrder.customerId, customerName: batch.sourceOrder.customerName };
    }
    if (batch.productionTask?.order?.customerName) {
      return { customerId: batch.productionTask.order.customerId, customerName: batch.productionTask.order.customerName };
    }
    if (batch.productionTask?.customerName) {
      return { customerName: batch.productionTask.customerName };
    }
    if (batch.sourceCustomerName) {
      return { customerName: batch.sourceCustomerName };
    }
    return { customerName: '未关联客户' };
  }

  private businessDateTextToUtcDate(value: string) {
    const year = Number(value.substring(0, 4));
    const month = Number(value.substring(5, 7));
    const day = Number(value.substring(8, 10));
    return new Date(Date.UTC(year, month - 1, day));
  }

  private addOrderUnitQuantity(target: Map<string, Map<string, number>>, orderNo: string, unit: string, quantity: number) {
    const unitMap = target.get(orderNo) || new Map<string, number>();
    const normalizedUnit = unit || '件';
    unitMap.set(normalizedUnit, (unitMap.get(normalizedUnit) ?? 0) + quantity);
    target.set(orderNo, unitMap);
  }

  private addLineQuantity(target: Map<string, number>, orderLineId: string, quantity: number) {
    target.set(orderLineId, (target.get(orderLineId) ?? 0) + quantity);
  }

  private mergeLineQuantityMaps(...sources: Array<Map<string, number>>) {
    const merged = new Map<string, number>();
    for (const source of sources) {
      for (const [orderLineId, quantity] of source.entries()) {
        this.addLineQuantity(merged, orderLineId, quantity);
      }
    }
    return merged;
  }

  private mergeOrderUnitQuantityMaps(...sources: Array<Map<string, Map<string, number>>>) {
    const merged = new Map<string, Map<string, number>>();
    for (const source of sources) {
      for (const [orderNo, quantityByUnit] of source.entries()) {
        for (const [unit, quantity] of quantityByUnit.entries()) {
          this.addOrderUnitQuantity(merged, orderNo, unit, quantity);
        }
      }
    }
    return merged;
  }

  private resolveOrderStatisticsStatus(
    orderStatus: OrderStatus,
    lines: Array<{ id: string; quantity: unknown }>,
    quantityByUnit: Array<{ unit: string; totalQuantity: number; totalProductionPlanQuantity: number }>,
    tasks: Array<{ status: ProductionStatus }>,
    completedProductionQuantityByUnit: Map<string, number>,
    completedFulfillmentQuantityByUnit: Map<string, number>,
    shippedQuantityByUnit: Map<string, number>,
    completedFulfillmentQuantityByLineId: Map<string, number>,
    shippedQuantityByLineId: Map<string, number>,
    orderBatches: Array<{ status: string }>
  ) {
    if (orderStatus === OrderStatus.DRAFT) {
      return 'ORDER_DRAFT';
    }
    if (orderStatus === OrderStatus.CANCELLED) {
      return 'ORDER_CANCELLED';
    }
    const hasLineShipmentData = this.hasLineQuantity(lines, shippedQuantityByLineId);
    const hasLineFulfillmentData = this.hasLineQuantity(lines, completedFulfillmentQuantityByLineId);
    if (
      hasLineShipmentData
        ? this.allLinesReached(lines, shippedQuantityByLineId)
        : this.allUnitsReached(quantityByUnit, 'totalQuantity', shippedQuantityByUnit)
    ) {
      return 'ORDER_SHIPPED_COMPLETED';
    }
    if (
      hasLineShipmentData
        ? this.totalQuantityFromLineMap(lines, shippedQuantityByLineId) > 0
        : this.totalQuantityFromUnitMap(shippedQuantityByUnit) > 0
    ) {
      return 'PARTIAL_SHIPPED';
    }
    if (orderStatus === OrderStatus.COMPLETED) {
      // 当前第一阶段只有仓库全量发货闭环后才把 CustomerOrder.status 置为 COMPLETED。
      // 旧数据若缺少发货 OUT 流水，也应按业务状态展示为已完成发货。
      return 'ORDER_SHIPPED_COMPLETED';
    }
    if (
      hasLineFulfillmentData
        ? this.allLinesReached(lines, completedFulfillmentQuantityByLineId)
        : this.allUnitsReached(quantityByUnit, 'totalQuantity', completedFulfillmentQuantityByUnit)
    ) {
      return 'ORDER_COMPLETED_UNSHIPPED';
    }
    if (this.orderUsesOnlyAllocatedStock(quantityByUnit, orderBatches)) {
      return 'ORDER_COMPLETED_UNSHIPPED';
    }
    if (
      this.allUnitsReached(quantityByUnit, 'totalProductionPlanQuantity', completedProductionQuantityByUnit) &&
      quantityByUnit.every((row) => Number(row.totalProductionPlanQuantity ?? 0) >= Number(row.totalQuantity ?? 0))
    ) {
      // 兼容纯重新生产的历史订单：没有库存分配流水时，生产完成数量达到生产计划即可视为已完成未发货。
      return 'ORDER_COMPLETED_UNSHIPPED';
    }
    if (
      orderStatus === OrderStatus.IN_PRODUCTION ||
      tasks.some((task) =>
        new Set<ProductionStatus>([
          ProductionStatus.IN_PROGRESS,
          ProductionStatus.WAITING_CONFIRMATION,
          ProductionStatus.COMPLETED,
          ProductionStatus.STORED
        ]).has(task.status)
      )
    ) {
      return 'ORDER_IN_PRODUCTION';
    }
    if (tasks.length > 0 || orderStatus === OrderStatus.PENDING_PRODUCTION) {
      return 'WAITING_PRODUCTION';
    }
    return orderStatus;
  }

  private orderUsesOnlyAllocatedStock(
    quantityByUnit: Array<{ unit: string; totalQuantity: number; totalProductionPlanQuantity: number }>,
    orderBatches: Array<{ status: string }>
  ) {
    return (
      orderBatches.length > 0 &&
      quantityByUnit.some((row) => Number(row.totalQuantity ?? 0) > 0) &&
      quantityByUnit.every((row) => Number(row.totalProductionPlanQuantity ?? 0) <= 0)
    );
  }

  private allUnitsReached(
    quantityByUnit: Array<{ unit: string; totalQuantity: number; totalProductionPlanQuantity: number }>,
    field: 'totalQuantity' | 'totalProductionPlanQuantity',
    actualQuantityByUnit: Map<string, number>
  ) {
    const targets = quantityByUnit.filter((row) => Number(row[field] ?? 0) > 0);
    if (targets.length === 0) {
      return false;
    }
    return targets.every((row) => (actualQuantityByUnit.get(row.unit || '件') ?? 0) + 0.0001 >= Number(row[field] ?? 0));
  }

  private totalQuantityFromUnitMap(quantityByUnit: Map<string, number>) {
    return Array.from(quantityByUnit.values()).reduce((sum, quantity) => sum + quantity, 0);
  }

  private hasLineQuantity(lines: Array<{ id: string }>, quantityByLineId: Map<string, number>) {
    return lines.some((line) => (quantityByLineId.get(line.id) ?? 0) > 0);
  }

  private allLinesReached(lines: Array<{ id: string; quantity: unknown }>, quantityByLineId: Map<string, number>) {
    const targets = lines.filter((line) => decimalToNumber(line.quantity as Prisma.Decimal | number | string | null | undefined) > 0);
    if (targets.length === 0) {
      return false;
    }
    return targets.every((line) => {
      const targetQuantity = decimalToNumber(line.quantity as Prisma.Decimal | number | string | null | undefined);
      return (quantityByLineId.get(line.id) ?? 0) + 0.0001 >= targetQuantity;
    });
  }

  private totalQuantityFromLineMap(lines: Array<{ id: string }>, quantityByLineId: Map<string, number>) {
    return lines.reduce((sum, line) => sum + (quantityByLineId.get(line.id) ?? 0), 0);
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
    const orderInventoryQuantity = orderReceiptQuantity > 0 ? orderReceiptQuantity : task.inventoryBatch ? decimalToNumber(task.inventoryBatch.quantity) : 0;
    return orderInventoryQuantity + stockQuantity;
  }
}
