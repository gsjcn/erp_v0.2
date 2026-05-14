import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, ProductionNoticeStatus, ProductionNoticeTarget, ProductionStatus } from '@prisma/client';
import { businessDateKey } from '../../common/business-date';
import { decimalToNumber, processSnapshotToDetails, type ProcessStepSnapshot } from '../../common/serializers';
import { runSerializableTransaction } from '../../common/transactions';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApproveProductionReplenishmentRequestDto,
  BatchStartProductionDto,
  CompleteProcessStepDto,
  CompleteProcessStepsDto,
  CompleteProductionDto,
  AcknowledgeProductionNoticeDto,
  ProductionAnnualSummaryQueryDto,
  ProductionNoticeQueryDto,
  ProductionOperatorQueryDto,
  ProductionReplenishmentRequestQueryDto,
  ProductionScrapQueryDto,
  ProductionTaskQueryDto,
  RejectProductionReplenishmentRequestDto,
  StartProductionDto,
  WithdrawProductionTaskDto
} from './dto';

type ProductionOperatorRow = {
  code: string;
  accountId: string;
  name: string;
  role: string;
  pinyin?: string | null;
  pinyinInitials?: string | null;
  keywords?: string[];
  idCardMasked?: string | null;
  idCardBound?: boolean;
};

type ProductionOrderSummaryStatus = ProductionStatus | 'READY_TO_COMPLETE' | 'RECEIVED';

const fallbackProductionOperators: ProductionOperatorRow[] = [
  {
    code: 'PLAN-001',
    accountId: 'PLAN-001',
    name: '刘计划',
    role: '生产计划员',
    pinyin: 'liujihua',
    pinyinInitials: 'ljh',
    keywords: ['liu', 'jihua', 'ljh', '计划', '下计划', '下单', '订单']
  },
  {
    code: 'ORDER-001',
    accountId: 'ORDER-001',
    name: '孙下单',
    role: '下单管理员',
    pinyin: 'sunxiadan',
    pinyinInitials: 'sxd',
    keywords: ['sun', 'xiadan', 'sxd', '下单', '订单', '订单管理员']
  },
  {
    code: 'WS-001',
    accountId: 'WS-001',
    name: '陈主任',
    role: '车间主任',
    pinyin: 'chenzhuren',
    pinyinInitials: 'czr',
    keywords: ['chen', 'zhuren', 'czr', '车间主任', '主任', '车间', '主管']
  },
  {
    code: 'TECH-001',
    accountId: 'TECH-001',
    name: '王工艺',
    role: '技术工艺员',
    pinyin: 'wanggongyi',
    pinyinInitials: 'wgy',
    keywords: ['wang', 'gongyi', 'wgy', '技术', '工艺', '流程']
  },
  {
    code: 'OP-001',
    accountId: 'OP-001',
    name: '张明',
    role: '冲压操作员',
    pinyin: 'zhangming',
    pinyinInitials: 'zm',
    keywords: ['zhang', 'ming', 'zm', '冲压']
  },
  {
    code: 'OP-002',
    accountId: 'OP-002',
    name: '李强',
    role: '激光切割操作员',
    pinyin: 'liqiang',
    pinyinInitials: 'lq',
    keywords: ['li', 'qiang', 'lq', '激光', '切割']
  },
  {
    code: 'OP-003',
    accountId: 'OP-003',
    name: '王磊',
    role: '焊接操作员',
    pinyin: 'wanglei',
    pinyinInitials: 'wl',
    keywords: ['wang', 'lei', 'wl', '焊接']
  },
  {
    code: 'OP-004',
    accountId: 'OP-004',
    name: '赵敏',
    role: '包装操作员',
    pinyin: 'zhaomin',
    pinyinInitials: 'zm',
    keywords: ['zhao', 'min', 'zm', '包装']
  },
  {
    code: 'OP-005',
    accountId: 'OP-005',
    name: '顾胜钧',
    role: '折弯操作员',
    pinyin: 'gushengjun',
    pinyinInitials: 'gsj',
    keywords: ['gu', 'sheng', 'jun', 'gs', 'gsj', '折弯'],
    idCardMasked: '3204********1234'
  }
];

type ShortageMode = 'REPLENISHMENT_REQUEST' | 'REPLENISHMENT' | 'MANAGER_APPROVED';

interface ProcessShortageDto {
  scrapQuantity?: number;
  shortageMode?: ShortageMode;
  createReplenishment?: boolean;
  managerName?: string;
  shortageReason?: string;
}

interface ResolvedShortageHandling {
  scrapQuantity: number;
  shortageQuantity: number;
  shortageMode: ShortageMode | null;
  replenishmentTaskNo: string | null;
  managerName: string | null;
  shortageReason: string | null;
}

interface ResolvedOperatorSnapshot {
  code: string | null;
  name: string | null;
  role: string | null;
}

interface ReplenishmentTaskSourceInfo {
  sourceType: 'PRODUCTION_SCRAP' | 'ORDER_CHANGE';
  sourceRequestNo?: string | null;
}

interface ProcessQuantityGuard {
  expectedQuantity: number;
  previousShortageQuantity: number;
  previousProcessName: string | null;
  quantityOverrideReason: string | null;
}

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async operators(query: ProductionOperatorQueryDto = {}) {
    const operators = await this.loadProductionOperators();
    const keyword = this.normalizeOperatorKeyword(query.keyword || '');
    if (!keyword) {
      return operators;
    }
    return operators.filter((operator) => this.operatorMatchesKeyword(operator, keyword));
  }

  async notices(query: ProductionNoticeQueryDto = {}) {
    const target = query.target || ProductionNoticeTarget.PRODUCTION;
    const notices = await this.prisma.productionNotice.findMany({
      where: {
        target,
        ...(query.status ? { status: query.status } : {})
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }]
    });
    return this.toNoticesWithCustomerNames(notices);
  }

  async acknowledgeNotice(id: string, dto: AcknowledgeProductionNoticeDto) {
    const acknowledgedBy = dto.acknowledgedBy.trim();
    if (!acknowledgedBy) {
      throw new BadRequestException('确认人员不能为空');
    }
    const notice = await this.prisma.productionNotice.findUnique({ where: { id } });
    if (!notice) {
      throw new NotFoundException('生产通知不存在');
    }
    const saved = await this.prisma.productionNotice.update({
      where: { id },
      data: {
        status: ProductionNoticeStatus.ACKNOWLEDGED,
        acknowledgedBy,
        acknowledgedAt: new Date()
      }
    });
    const [noticeWithCustomer] = await this.toNoticesWithCustomerNames([saved]);
    return noticeWithCustomer;
  }

  async replenishmentRequests(query: ProductionReplenishmentRequestQueryDto = {}) {
    const where: Prisma.ProductionReplenishmentRequestWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    const keyword = query.keyword?.trim();
    if (keyword) {
      where.OR = [
        { requestNo: { contains: keyword, mode: 'insensitive' } },
        { orderNo: { contains: keyword, mode: 'insensitive' } },
        { productionTaskNo: { contains: keyword, mode: 'insensitive' } },
        { partCode: { contains: keyword, mode: 'insensitive' } },
        { partName: { contains: keyword, mode: 'insensitive' } },
        { reason: { contains: keyword, mode: 'insensitive' } },
        { requestedByCode: { contains: keyword, mode: 'insensitive' } },
        { requestedByName: { contains: keyword, mode: 'insensitive' } },
        { supervisorName: { contains: keyword, mode: 'insensitive' } },
        { supervisorRemark: { contains: keyword, mode: 'insensitive' } },
        { replenishmentTaskNo: { contains: keyword, mode: 'insensitive' } }
      ];
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
        where.createdAt.gte = this.startOfDay(query.dateFrom);
      }
      if (query.dateTo) {
        where.createdAt.lte = this.endOfDay(query.dateTo);
      }
    }

    const requests = await this.prisma.productionReplenishmentRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }]
    });
    const orderIds = Array.from(new Set(requests.map((request) => request.orderId).filter(Boolean))) as string[];
    const orderNos = Array.from(new Set(requests.map((request) => request.orderNo?.trim()).filter(Boolean))) as string[];
    const relatedOrders =
      orderIds.length > 0 || orderNos.length > 0
        ? await this.prisma.customerOrder.findMany({
            where: {
              OR: [
                ...(orderIds.length > 0 ? [{ id: { in: orderIds } }] : []),
                ...(orderNos.length > 0 ? [{ orderNo: { in: orderNos } }] : [])
              ]
            },
            select: { id: true, orderNo: true, status: true }
          })
        : [];
    const orderStatusByOrderId = new Map(relatedOrders.map((order) => [order.id, order.status]));
    const orderStatusByOrderNo = new Map(relatedOrders.map((order) => [order.orderNo.trim().toUpperCase(), order.status]));
    const statusRank: Record<string, number> = { PENDING: 0, APPROVED: 1, REJECTED: 2 };
    return requests
      .sort((left, right) => (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9))
      .map((request) =>
        this.toProductionReplenishmentRequest(
          request,
          (request.orderId ? orderStatusByOrderId.get(request.orderId) : undefined) ||
            orderStatusByOrderNo.get(request.orderNo.trim().toUpperCase())
        )
      );
  }

  async scrapRecords(query: ProductionScrapQueryDto = {}) {
    const where: Prisma.ProductionScrapRecordWhereInput = {};
    if (query.customerId?.trim()) {
      const orders = await this.prisma.customerOrder.findMany({
        where: { customerId: query.customerId.trim() },
        select: { id: true }
      });
      const orderIds = orders.map((order) => order.id);
      if (orderIds.length === 0) {
        return [];
      }
      // ProductionScrapRecord 第一阶段只保存 orderId 快照，不做复杂关系；客户筛选先通过订单表换算 orderId。
      where.orderId = { in: orderIds };
    }
    if (query.orderNo?.trim()) {
      where.orderNo = { contains: query.orderNo.trim(), mode: 'insensitive' };
    }
    if (query.dateFrom || query.dateTo) {
      where.recordDate = {
        ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000`) } : {}),
        ...(query.dateTo ? { lte: new Date(`${query.dateTo}T23:59:59.999`) } : {})
      };
    }
    const records = await this.prisma.productionScrapRecord.findMany({
      where,
      orderBy: [{ recordDate: 'desc' }, { scrapNo: 'desc' }]
    });
    return records.map((record) => this.toScrapRecord(record));
  }

  private normalizeOperatorKeyword(value: string) {
    return value.trim().toLowerCase().replace(/[\s\-_./\\]+/g, '');
  }

  private async loadProductionOperators(): Promise<ProductionOperatorRow[]> {
    try {
      const rows = await this.prisma.productionOperator.findMany({
        where: { status: 'ENABLED' },
        orderBy: [{ accountId: 'asc' }]
      });
      if (rows.length > 0) {
        const dbRows = rows.map((operator) => this.toProductionOperatorRow(operator));
        const existingCodes = new Set(dbRows.map((operator) => operator.accountId.toLocaleLowerCase()));
        // 开发库可能已有旧测试人员但缺少计划员；合并基础岗位，避免提交生产入口没有下单/计划操作员可选。
        return [
          ...dbRows,
          ...fallbackProductionOperators.filter((operator) => !existingCodes.has(operator.accountId.toLocaleLowerCase()))
        ];
      }
    } catch {
      // 数据库还未执行新迁移时，先保留兜底名单，避免当前测试页面无法选择操作人员。
    }
    return fallbackProductionOperators;
  }

  private toProductionOperatorRow(operator: {
    accountId: string;
    name: string;
    role: string;
    pinyin?: string | null;
    pinyinInitials?: string | null;
    keywords?: string[] | null;
    idCardMasked?: string | null;
    idCardBound?: boolean | null;
  }): ProductionOperatorRow {
    return {
      code: operator.accountId,
      accountId: operator.accountId,
      name: operator.name,
      role: operator.role,
      pinyin: operator.pinyin,
      pinyinInitials: operator.pinyinInitials,
      keywords: operator.keywords || [],
      idCardMasked: operator.idCardMasked,
      idCardBound: Boolean(operator.idCardBound)
    };
  }

  private async loadProductionOperatorMap() {
    const operators = await this.loadProductionOperators();
    return new Map(operators.map((operator) => [operator.code, operator]));
  }

  private operatorMatchesKeyword(operator: ProductionOperatorRow, keyword: string) {
    const tokens = [
      operator.code,
      operator.accountId,
      operator.name,
      operator.role,
      operator.pinyin,
      operator.pinyinInitials,
      ...(operator.keywords || [])
    ]
      .filter(Boolean)
      .map((value) => this.normalizeOperatorKeyword(String(value)))
      .filter(Boolean);
    // 逐字段匹配，避免把多个字段拼接后产生跨字段误命中；例如 zm 不应命中顾胜钧。
    return tokens.some((token) => token.includes(keyword));
  }

  private async resolveOperatorSnapshot(operatorCodes?: string[], fallbackOperatorCode?: string): Promise<ResolvedOperatorSnapshot> {
    const normalizedCodes = [
      ...(operatorCodes || []),
      ...(fallbackOperatorCode ? [fallbackOperatorCode] : [])
    ]
      .map((code) => String(code).trim())
      .filter(Boolean);
    const uniqueCodes = Array.from(new Set(normalizedCodes));
    if (uniqueCodes.length === 0) {
      // 工序完成表允许暂不填写操作人员，但如果填写就必须来自后端账户清单。
      return { code: null, name: null, role: null };
    }

    const operatorMap = await this.loadProductionOperatorMap();
    const operators = uniqueCodes.map((code) => {
      const operator = operatorMap.get(code);
      if (!operator) {
        throw new BadRequestException(`操作人员不存在或未启用：${code}`);
      }
      return operator;
    });

    return {
      code: operators.map((operator) => operator.code).join(', '),
      name: operators.map((operator) => operator.name).join('、'),
      role: operators.map((operator) => operator.role).join('、')
    };
  }

  private isWorkshopSupervisor(operator: ProductionOperatorRow) {
    const role = operator.role || '';
    return !role.includes('计划') && (role.includes('车间主任') || role.includes('车间主管') || role.includes('主任'));
  }

  private async resolveWorkshopSupervisor(supervisorCode?: string): Promise<ProductionOperatorRow> {
    const code = supervisorCode?.trim();
    if (!code) {
      throw new BadRequestException('请选择车间主任');
    }

    const operators = await this.loadProductionOperators();
    const normalizedCode = code.toLocaleLowerCase();
    const operator = operators.find(
      (item) => item.code.toLocaleLowerCase() === normalizedCode || item.accountId.toLocaleLowerCase() === normalizedCode
    );
    if (!operator) {
      throw new BadRequestException(`车间主任不存在或未启用：${code}`);
    }
    if (!this.isWorkshopSupervisor(operator)) {
      throw new BadRequestException('开始生产和确认生产只能由车间主任操作');
    }
    return operator;
  }

  private async resolveOperatorSnapshotForProcess(
    dto: CompleteProcessStepsDto,
    processName: string
  ): Promise<ResolvedOperatorSnapshot> {
    const assignment = dto.operatorsByProcess?.find((item) => item.processName.trim() === processName);
    return this.resolveOperatorSnapshot(assignment?.operatorCodes ?? dto.operatorCodes, dto.operatorCode);
  }

  private buildTaskWhere(query: ProductionTaskQueryDto) {
    const where: Prisma.ProductionTaskWhereInput = {
      // 已取消订单只保留已开工且未入库的任务，供管理撤回；未开工或已入库的取消任务不再干扰生产首页。
      NOT: [
        {
          status: ProductionStatus.PENDING,
          order: { status: OrderStatus.CANCELLED }
        },
        {
          order: { status: OrderStatus.CANCELLED },
          inventoryBatch: { isNot: null }
        }
      ]
    };

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

    return where;
  }

  async findTasks(query: ProductionTaskQueryDto) {
    const tasks = await this.prisma.productionTask.findMany({
      where: this.buildTaskWhere(query),
      include: this.taskInclude(),
      orderBy: [{ status: 'asc' }, { orderNo: 'desc' }, { productionTaskNo: 'asc' }]
    });

    const completedReplenishmentQuantityByLine = this.toCompletedReplenishmentQuantityByLine(tasks);
    return tasks.map((task) => this.toTask(task, completedReplenishmentQuantityByLine));
  }

  async orderSummary(query: ProductionTaskQueryDto) {
    const tasks = await this.prisma.productionTask.findMany({
      where: this.buildTaskWhere(query),
      include: this.taskInclude(),
      orderBy: [{ orderNo: 'desc' }, { productionTaskNo: 'asc' }]
    });
    const summaries = new Map<string, any>();

    const completedReplenishmentQuantityByLine = this.toCompletedReplenishmentQuantityByLine(tasks);
    for (const task of tasks.map((item) => this.toTask(item, completedReplenishmentQuantityByLine))) {
      const key = task.orderId;
      const current =
        summaries.get(key) ||
        {
          orderId: task.orderId,
          orderNo: task.orderNo,
          orderStatus: task.orderStatus,
          customerId: task.customerId,
          customerName: task.customerName,
          orderDate: task.orderDate,
          deliveryDate: task.deliveryDate,
          taskCount: 0,
          partCount: 0,
          pendingCount: 0,
          inProgressCount: 0,
          readyToCompleteCount: 0,
          completedCount: 0,
          receivedCount: 0,
          totalPlannedQuantity: 0,
          totalCompletedQuantity: 0,
          unit: task.unit,
          status: 'PENDING' as ProductionOrderSummaryStatus,
          progressPercent: 0,
          pendingTaskIds: [] as string[],
          pendingTasks: [] as any[],
          progressBuckets: new Map<string, number>(),
          partKeys: new Set<string>(),
          customerOrderLineKeys: new Set<string>(),
          unresolvedShortageLineKeys: new Set<string>(),
          unresolvedShortageQuantityByUnit: new Map<string, number>(),
          pendingProductionReplenishmentLineKeys: new Set<string>(),
          pendingProductionReplenishmentQuantityByUnit: new Map<string, number>(),
          shortageActionTasks: [] as any[],
          quantityByUnit: new Map<string, any>()
        };

      current.taskCount += 1;
      current.partKeys.add(`${task.partCode}__${task.partName}`);
      current.partCount = current.partKeys.size;
      current.deliveryDate = this.pickEarliestDate(current.deliveryDate, task.deliveryDate);

      const quantityRow =
        current.quantityByUnit.get(task.unit) ||
        {
          unit: task.unit,
          customerOrderQuantity: 0,
          plannedQuantity: 0,
          completedQuantity: 0
        };
      const customerOrderLineKey = task.orderLineId || `${task.partCode}__${task.partName}__${task.unit}`;
      if (!current.customerOrderLineKeys.has(customerOrderLineKey)) {
        quantityRow.customerOrderQuantity += Number(task.customerOrderQuantity || 0);
        current.customerOrderLineKeys.add(customerOrderLineKey);
      }
      quantityRow.plannedQuantity += Number(task.plannedQuantity || 0);
      quantityRow.completedQuantity += Number(task.completedQuantity || 0);
      current.quantityByUnit.set(task.unit, quantityRow);
      current.totalPlannedQuantity += Number(task.plannedQuantity || 0);
      current.totalCompletedQuantity += Number(task.completedQuantity || 0);
      if (Number(task.unresolvedShortageQuantity || 0) > 0) {
        current.unresolvedShortageLineKeys.add(task.orderLineId || task.id);
        const shortageUnit = task.unresolvedShortageUnit || task.unit || '件';
        current.unresolvedShortageQuantityByUnit.set(
          shortageUnit,
          (current.unresolvedShortageQuantityByUnit.get(shortageUnit) || 0) + Number(task.unresolvedShortageQuantity || 0)
        );
        current.shortageActionTasks.push({
          id: task.id,
          orderLineId: task.orderLineId,
          productionTaskNo: task.productionTaskNo,
          partCode: task.partCode,
          partName: task.partName,
          shortageQuantity: task.unresolvedShortageQuantity,
          unit: shortageUnit
        });
      }
      if (Number(task.pendingProductionReplenishmentQuantity || 0) > 0) {
        current.pendingProductionReplenishmentLineKeys.add(task.orderLineId || task.id);
        const shortageUnit = task.pendingProductionReplenishmentUnit || task.unit || '件';
        current.pendingProductionReplenishmentQuantityByUnit.set(
          shortageUnit,
          (current.pendingProductionReplenishmentQuantityByUnit.get(shortageUnit) || 0) +
            Number(task.pendingProductionReplenishmentQuantity || 0)
        );
      }

      const status = this.productionDisplayStatus(task);
      if (status === 'PENDING') {
        current.pendingCount += 1;
        current.pendingTaskIds.push(task.id);
        current.pendingTasks.push({
          id: task.id,
          orderLineId: task.orderLineId,
          orderNo: task.orderNo,
          orderStatus: task.orderStatus,
          productionTaskNo: task.productionTaskNo,
          partCode: task.partCode,
          partName: task.partName,
          lineType: task.lineType,
          partCategory: task.partCategory,
          componentNo: task.componentNo,
          parentComponentNo: task.parentComponentNo,
          importSequence: task.importSequence,
          projectModel: task.projectModel,
          plannedQuantity: task.plannedQuantity,
          unit: task.unit,
          processSteps: task.processSteps,
          processStepDetails: task.processStepDetails
        });
      } else if (status === 'IN_PROGRESS') {
        current.inProgressCount += 1;
      } else if (status === 'READY_TO_COMPLETE') {
        current.readyToCompleteCount += 1;
      } else if (status === 'COMPLETED') {
        current.completedCount += 1;
      } else if (status === 'RECEIVED') {
        current.receivedCount += 1;
      }
      const progressLabel = this.orderSummaryProgressLabel(task, status);
      current.progressBuckets.set(progressLabel, (current.progressBuckets.get(progressLabel) || 0) + 1);

      summaries.set(key, current);
    }

    return Array.from(summaries.values()).map((summary) => {
      const doneCount = summary.completedCount + summary.receivedCount;
      return {
        orderId: summary.orderId,
        orderNo: summary.orderNo,
        orderStatus: summary.orderStatus,
        customerId: summary.customerId,
        customerName: summary.customerName,
        orderDate: summary.orderDate,
        deliveryDate: summary.deliveryDate,
        taskCount: summary.taskCount,
        partCount: summary.partCount,
        pendingCount: summary.pendingCount,
        inProgressCount: summary.inProgressCount,
        readyToCompleteCount: summary.readyToCompleteCount,
        completedCount: summary.completedCount,
        receivedCount: summary.receivedCount,
        totalPlannedQuantity: this.roundQuantity(summary.totalPlannedQuantity),
        totalCompletedQuantity: this.roundQuantity(summary.totalCompletedQuantity),
        unit: summary.unit,
        status: this.resolveOrderSummaryStatus(summary),
        progressPercent: summary.taskCount > 0 ? Math.round((doneCount / summary.taskCount) * 100) : 0,
        quantityByUnit: Array.from(summary.quantityByUnit.values()).map((row: any) => ({
          unit: row.unit,
          customerOrderQuantity: this.roundQuantity(row.customerOrderQuantity),
          plannedQuantity: this.roundQuantity(row.plannedQuantity),
          completedQuantity: this.roundQuantity(row.completedQuantity)
        })),
        progressItems: Array.from((summary.progressBuckets as Map<string, number>).entries()).map(([label, count]) => ({
          label,
          count,
          text: `${label} ${count}`
        })),
        unresolvedShortageLineCount: summary.unresolvedShortageLineKeys.size,
        unresolvedShortageQuantity: this.roundQuantity(
          Array.from((summary.unresolvedShortageQuantityByUnit as Map<string, number>).values()).reduce(
            (sum, quantity) => sum + quantity,
            0
          )
        ),
        unresolvedShortageUnit:
          summary.unresolvedShortageQuantityByUnit.size === 1
            ? Array.from((summary.unresolvedShortageQuantityByUnit as Map<string, number>).keys())[0]
            : undefined,
        unresolvedShortageQuantityByUnit: Array.from(
          (summary.unresolvedShortageQuantityByUnit as Map<string, number>).entries()
        ).map(([unit, quantity]) => ({ unit, quantity: this.roundQuantity(quantity) })),
        needsReplenishmentAction: summary.unresolvedShortageLineKeys.size > 0,
        pendingProductionReplenishmentLineCount: summary.pendingProductionReplenishmentLineKeys.size,
        pendingProductionReplenishmentQuantity: this.roundQuantity(
          Array.from((summary.pendingProductionReplenishmentQuantityByUnit as Map<string, number>).values()).reduce(
            (sum, quantity) => sum + quantity,
            0
          )
        ),
        pendingProductionReplenishmentUnit:
          summary.pendingProductionReplenishmentQuantityByUnit.size === 1
            ? Array.from((summary.pendingProductionReplenishmentQuantityByUnit as Map<string, number>).keys())[0]
            : undefined,
        pendingProductionReplenishmentQuantityByUnit: Array.from(
          (summary.pendingProductionReplenishmentQuantityByUnit as Map<string, number>).entries()
        ).map(([unit, quantity]) => ({ unit, quantity: this.roundQuantity(quantity) })),
        needsProductionReplenishmentReview: summary.pendingProductionReplenishmentLineKeys.size > 0,
        shortageActionTasks: summary.shortageActionTasks,
        pendingTaskIds: summary.pendingTaskIds,
        pendingTasks: summary.pendingTasks
      };
    });
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
        where: { order: { orderDate: { gte: start, lt: end } } },
        include: {
          order: {
            select: { orderNo: true }
          }
        }
      }),
      this.prisma.productionTask.findMany({
        where: { order: { orderDate: { gte: start, lt: end } } },
        include: { inventoryBatch: true }
      })
    ]);

    const orderNos = Array.from(
      new Set([
        ...orderLines.map((line) => line.order?.orderNo).filter((orderNo): orderNo is string => Boolean(orderNo)),
        ...productionTasks.map((task) => task.orderNo)
      ])
    );
    const productionTaskNos = productionTasks.map((task) => task.productionTaskNo);
    const [shipmentTransactions, receiptTransactions] = await this.prisma.$transaction([
      // 发货统计也按来源订单的下单日期归属，不能按出库当天归属，否则跨年订单会被统计到错误年度。
      orderNos.length > 0
        ? this.prisma.inventoryTransaction.findMany({
            where: {
              transactionType: 'OUT',
              orderNo: { in: orderNos },
              sourceRecordType: 'InventoryBatch'
            }
          })
        : this.prisma.inventoryTransaction.findMany({ where: { id: '__empty__' } }),
      // 生产入库历史以 IN 流水为准；库存批次 quantity 是当前剩余，不能用于历史统计。
      productionTaskNos.length > 0
        ? this.prisma.inventoryTransaction.findMany({
            where: {
              transactionType: 'IN',
              productionTaskNo: { in: productionTaskNos }
            }
          })
        : this.prisma.inventoryTransaction.findMany({ where: { id: '__empty__' } })
    ]);

    for (const line of orderLines) {
      const row = getRow(line.partCode, line.partName, line.unit);
      row.customerOrderQuantity += decimalToNumber(line.quantity);
      row.productionPlanQuantity += decimalToNumber(line.productionPlanQuantity ?? line.quantity);
    }

    for (const transaction of shipmentTransactions) {
      const row = getRow(transaction.partCode, transaction.partName, transaction.unit);
      row.shippedOrderQuantity += decimalToNumber(transaction.quantity);
    }

    const stockQuantityByTaskNo = new Map<string, number>();
    const orderReceiptQuantityByTaskNo = new Map<string, number>();
    for (const transaction of receiptTransactions) {
      if (!transaction.productionTaskNo) {
        continue;
      }
      const quantity = decimalToNumber(transaction.quantity);
      if (transaction.orderNo) {
        orderReceiptQuantityByTaskNo.set(
          transaction.productionTaskNo,
          (orderReceiptQuantityByTaskNo.get(transaction.productionTaskNo) || 0) + quantity
        );
        continue;
      }

      const row = getRow(transaction.partCode, transaction.partName, transaction.unit);
      row.stockQuantity += quantity;
      stockQuantityByTaskNo.set(transaction.productionTaskNo, (stockQuantityByTaskNo.get(transaction.productionTaskNo) || 0) + quantity);
    }

    for (const task of productionTasks) {
      const row = getRow(task.partCode, task.partName, task.unit);
      row.completedProductionQuantity += this.toEffectiveTaskCompletedQuantity(
        task,
        stockQuantityByTaskNo.get(task.productionTaskNo) || 0,
        orderReceiptQuantityByTaskNo.get(task.productionTaskNo) || 0
      );
    }

    return Array.from(rows.values()).sort((a, b) => a.partCode.localeCompare(b.partCode, 'zh-Hans-CN'));
  }

  async start(id: string, dto: StartProductionDto) {
    const supervisor = await this.resolveWorkshopSupervisor(dto.supervisorCode);

    // 开始生产必须在事务内重新读取任务状态，避免多人或重复点击把同一任务开始两次。
    const updated = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const task = await tx.productionTask.findUnique({
          where: { id },
          include: { order: true, inventoryBatch: true }
        });
        if (!task) {
          throw new NotFoundException('生产任务不存在');
        }
        if (task.order.status === OrderStatus.CANCELLED) {
          throw new BadRequestException('已取消订单不能开始新的生产任务');
        }
        if (task.order.status === OrderStatus.COMPLETED) {
          throw new BadRequestException('已完成发货订单不能开始新的生产任务');
        }
        if (task.inventoryBatch) {
          throw new BadRequestException('生产任务已入库，不能重新开始生产');
        }
        if (task.status === ProductionStatus.COMPLETED) {
          throw new BadRequestException('已完成任务不能重新开始生产');
        }
        if (task.status !== ProductionStatus.PENDING) {
          throw new BadRequestException('只能开始待确认生产任务');
        }

        const saved = await tx.productionTask.update({
          where: { id },
          data: {
            status: ProductionStatus.IN_PROGRESS,
            startedAt: task.startedAt || new Date(),
            remark: this.appendTaskRemark(task.remark, this.formatSupervisorActionRemark('开始生产', supervisor))
          }
        });
        await this.markOrderInProduction(tx, task.orderId);
        return saved;
      },
      '当前生产任务正在被其他操作开始生产，请刷新后重试'
    );

    return this.toTask((await this.findTaskOrThrow(updated.id))!);
  }

  async batchStart(dto: BatchStartProductionDto) {
    const supervisor = await this.resolveWorkshopSupervisor(dto.supervisorCode);
    const taskIds = Array.from(new Set(dto.taskIds.map((id) => id.trim()).filter(Boolean)));
    if (taskIds.length === 0) {
      throw new BadRequestException('请选择需要开始生产的任务');
    }

    const result = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const tasks = await tx.productionTask.findMany({
          where: { id: { in: taskIds } },
          include: {
            order: true,
            inventoryBatch: true
          }
        });
        if (tasks.length !== taskIds.length) {
          throw new NotFoundException('部分生产任务不存在');
        }

        const orderIds = new Set(tasks.map((task) => task.orderId));
        if (orderIds.size !== 1) {
          throw new BadRequestException('批量开始生产只能选择同一订单的任务');
        }

        for (const task of tasks) {
          if (task.order.status === OrderStatus.CANCELLED) {
            throw new BadRequestException(`已取消订单不能开始新的生产任务：${task.orderNo}`);
          }
          if (task.order.status === OrderStatus.COMPLETED) {
            throw new BadRequestException(`已完成发货订单不能开始新的生产任务：${task.orderNo}`);
          }
          if (task.inventoryBatch) {
            throw new BadRequestException(`生产任务已入库，不能重新开始生产：${task.productionTaskNo}`);
          }
          if (task.status !== ProductionStatus.PENDING) {
            throw new BadRequestException(`只能批量开始待确认生产任务：${task.productionTaskNo}`);
          }
        }

        const now = new Date();
        const actionRemark = this.formatSupervisorActionRemark('批量开始生产', supervisor);
        for (const task of tasks) {
          await tx.productionTask.update({
            where: { id: task.id },
            data: {
              status: ProductionStatus.IN_PROGRESS,
              startedAt: task.startedAt || now,
              remark: this.appendTaskRemark(task.remark, actionRemark)
            }
          });
        }

        await this.markOrderInProduction(tx, tasks[0].orderId);
        return {
          orderId: tasks[0].orderId,
          orderNo: tasks[0].orderNo,
          startedCount: tasks.length
        };
      },
      '当前订单生产任务正在被其他操作开始生产，请刷新后重试'
    );

    return result;
  }

  async withdraw(id: string, dto: WithdrawProductionTaskDto) {
    const managerName = dto.managerName.trim();
    const reason = dto.reason.trim();
    const handlingMode = dto.handlingMode;
    const handlingQuantity = Number(dto.handlingQuantity);
    const handledAt = dto.handledAt ? new Date(dto.handledAt) : new Date();
    const remark = dto.remark?.trim();
    if (!managerName || !reason) {
      throw new BadRequestException('管理人员姓名和撤回原因不能为空');
    }
    if (!['STOCK', 'SCRAP', 'NONE'].includes(handlingMode)) {
      throw new BadRequestException('撤回处理方式不能为空');
    }
    if (!Number.isFinite(handlingQuantity) || handlingQuantity < 0) {
      throw new BadRequestException('撤回处理数量必须大于或等于 0');
    }
    if (handlingMode !== 'NONE' && handlingQuantity <= 0) {
      throw new BadRequestException('转库存或报废时，撤回处理数量必须大于 0');
    }
    if (handlingMode === 'NONE' && handlingQuantity > 0) {
      throw new BadRequestException('无实物处理时，处理数量必须为 0');
    }
    if (Number.isNaN(handledAt.getTime())) {
      throw new BadRequestException('撤回处理日期无效');
    }

    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const task = await this.findTaskForMutationOrThrow(tx, id);
        if (task.order.status === OrderStatus.CANCELLED) {
          throw new BadRequestException('已取消订单不能撤回生产任务');
        }
        if (task.order.status === OrderStatus.COMPLETED) {
          throw new BadRequestException('已完成发货订单不能撤回生产任务');
        }
        if (task.inventoryBatch) {
          throw new BadRequestException('生产任务已入库，不能撤回');
        }
        const childTasks = await tx.productionTask.findMany({
          where: { sourceProductionTaskNo: task.productionTaskNo },
          include: { inventoryBatch: true, processCompletions: true }
        });
        const lockedChild = childTasks.find(
          (child) => child.status !== ProductionStatus.PENDING || child.inventoryBatch || child.processCompletions.length > 0
        );
        if (lockedChild) {
          throw new BadRequestException('已有补单任务开始生产，不能自动撤回');
        }

        await tx.productionTask.deleteMany({
          where: { sourceProductionTaskNo: task.productionTaskNo, status: ProductionStatus.PENDING }
        });
        await tx.productionScrapRecord.deleteMany({
          where: { productionTaskId: task.id }
        });
        await tx.productionProcessCompletion.deleteMany({
          where: { productionTaskId: task.id }
        });
        await tx.productionTask.update({
          where: { id },
          data: {
            status: ProductionStatus.PENDING,
            completedQuantity: 0,
            startedAt: null,
            completedAt: null,
            remark: this.formatWithdrawRemark(reason, handlingMode, handlingQuantity, task.unit, handledAt, managerName, remark)
          }
        });
        await this.markOrderInProduction(tx, task.orderId);
        if (handlingMode === 'SCRAP' && handlingQuantity > 0) {
          await tx.productionScrapRecord.create({
            data: {
              scrapNo: await this.generateNextScrapNo(tx),
              orderId: task.orderId,
              orderNo: task.orderNo,
              orderLineId: task.orderLineId,
              productionTaskId: task.id,
              productionTaskNo: task.productionTaskNo,
              partCode: task.partCode,
              partName: task.partName,
              quantity: this.roundQuantity(handlingQuantity),
              unit: task.unit,
              reason: `管理撤回报废：${reason}${remark ? `；说明：${remark}` : ''}`,
              sourceRecordType: 'ProductionTaskWithdraw',
              sourceRecordId: `${task.id}:${handledAt.getTime()}`,
              recordDate: handledAt
            }
          });
        }
        await tx.productionNotice.create({
          data: {
            noticeNo: await this.generateNextNoticeNo(tx),
            noticeType: 'TASK_WITHDRAWN',
            status: ProductionNoticeStatus.ACKNOWLEDGED,
            target: ProductionNoticeTarget.PRODUCTION,
            orderId: task.orderId,
            orderNo: task.orderNo,
            orderLineId: task.orderLineId,
            productionTaskId: task.id,
            productionTaskNo: task.productionTaskNo,
            partCode: task.partCode,
            partName: task.partName,
            afterQuantity: handlingQuantity,
            unit: task.unit,
            reason: this.formatWithdrawNoticeReason(reason, handlingMode, handlingQuantity, task.unit, handledAt, remark),
            managerName,
            acknowledgedBy: managerName,
            acknowledgedAt: new Date()
          }
        });
        if (handlingMode === 'STOCK' && handlingQuantity > 0) {
          await tx.productionNotice.create({
            data: {
              noticeNo: await this.generateNextNoticeNo(tx),
              noticeType: 'TASK_WITHDRAWN',
              status: ProductionNoticeStatus.PENDING,
              target: ProductionNoticeTarget.WAREHOUSE,
              orderId: task.orderId,
              orderNo: task.orderNo,
              orderLineId: task.orderLineId,
              productionTaskId: task.id,
              productionTaskNo: task.productionTaskNo,
              partCode: task.partCode,
              partName: task.partName,
              afterQuantity: handlingQuantity,
              unit: task.unit,
              reason: `管理撤回后需要仓库确认转库存：${this.formatWithdrawNoticeReason(
                reason,
                handlingMode,
                handlingQuantity,
                task.unit,
                handledAt,
                remark
              )}`,
              managerName
            }
          });
        }
      },
      '当前生产任务正在被其他操作修改，请刷新后重试'
    );

    return this.toTask((await this.findTaskOrThrow(id))!);
  }

  async complete(id: string, dto: CompleteProductionDto) {
    const supervisor = await this.resolveWorkshopSupervisor(dto.supervisorCode);
    const requestedFinalOperators =
      dto.operatorCodes !== undefined || dto.operatorCode !== undefined
        ? await this.resolveOperatorSnapshot(dto.operatorCodes, dto.operatorCode)
        : null;

    // 完成生产记录实际完成数，允许超过订单计划数；超出部分由仓库确认入库时转为备货库存。
    // 未入库前允许修正最终确认，入库后禁止改数量，避免库存和生产任务不一致。
    const updated = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const task = await this.findTaskForMutationOrThrow(tx, id);
        if (task.order.status === OrderStatus.CANCELLED) {
          throw new BadRequestException('已取消订单不能确认生产完成');
        }
        if (task.order.status === OrderStatus.COMPLETED) {
          throw new BadRequestException('已完成发货订单不能修改生产完成记录');
        }
        if (task.inventoryBatch) {
          throw new BadRequestException('生产任务已入库，不能修改生产完成记录');
        }
        const isFinalCorrection = task.status === ProductionStatus.COMPLETED;
        if (task.status !== ProductionStatus.IN_PROGRESS && !isFinalCorrection) {
          throw new BadRequestException('生产任务必须先开始，才能确认完成');
        }

        const stepDetails = processSnapshotToDetails(task.processSnapshot);
        const steps = stepDetails.map((step) => step.processName);
        const plannedQuantity = decimalToNumber(task.plannedQuantity);
        const completedQuantity = dto.completedQuantity ?? plannedQuantity;
        if (completedQuantity <= 0) {
          throw new BadRequestException('完成数量必须大于 0');
        }

        const completionMap = new Map((task.processCompletions || []).map((item: any) => [item.stepNo, item]));
        const finalCompletion = steps.length > 0 ? completionMap.get(steps.length) : null;
        if (steps.length > 0 && !steps.every((_, index) => completionMap.get(index + 1)?.isCompleted)) {
          throw new BadRequestException('所有工序确认完成后，才能确认生产完成');
        }

        const finalOperators = requestedFinalOperators ?? {
          // 无工序任务没有最后一道工序操作员，最终确认人默认记录为本次车间主任。
          code: finalCompletion?.operatorCode ?? supervisor.code,
          name: finalCompletion?.operatorName ?? supervisor.name,
          role: finalCompletion?.operatorRole ?? supervisor.role
        };

        if (steps.length > 0 && finalCompletion) {
          const beforeSnapshot = this.toProcessCompletionSnapshot(finalCompletion);
          const shortageHandling = this.resolveShortageHandling(
            dto,
            completedQuantity,
            plannedQuantity,
            finalCompletion.replenishmentTaskNo
          );
          shortageHandling.replenishmentTaskNo = await this.applyReplenishmentHandling(
            tx,
            task,
            stepDetails,
            shortageHandling,
            finalCompletion.replenishmentTaskNo
          );

          // 最终生产确认只落在最后一道工序记录上，便于后续查看报废、补单和缺货完成理由。
          const savedCompletion = await tx.productionProcessCompletion.update({
            where: { productionTaskId_stepNo: { productionTaskId: task.id, stepNo: steps.length } },
            data: {
              processRemark: stepDetails[steps.length - 1]?.processRemark || finalCompletion.processRemark || null,
              completedQuantity,
              scrapQuantity: shortageHandling.scrapQuantity,
              shortageQuantity: shortageHandling.shortageQuantity,
              shortageMode: shortageHandling.shortageMode,
              replenishmentTaskNo: shortageHandling.replenishmentTaskNo,
              managerName: shortageHandling.managerName,
              shortageReason: shortageHandling.shortageReason,
              operatorCode: finalOperators.code,
              operatorName: finalOperators.name,
              operatorRole: finalOperators.role,
              completedAt: new Date(),
              remark: dto.remark?.trim() || finalCompletion.remark
            }
          });

          await tx.productionProcessCompletionLog.create({
            data: {
              completionId: savedCompletion.id,
              productionTaskId: task.id,
              processName: savedCompletion.processName,
              action: isFinalCorrection ? 'TASK_FINAL_UPDATE' : 'TASK_FINAL_CONFIRM',
              operatorCode: finalOperators.code,
              operatorName: finalOperators.name,
              beforeSnapshot,
              afterSnapshot: this.toProcessCompletionSnapshot(savedCompletion)
            }
          });
          await this.upsertProductionScrapRecord(tx, task, savedCompletion, shortageHandling.scrapQuantity);
          await this.syncProductionReplenishmentRequest(tx, task, savedCompletion, shortageHandling, finalOperators);
        } else {
          const existingFinalCompletion = completionMap.get(1);
          const shortageHandling = this.resolveShortageHandling(
            dto,
            completedQuantity,
            plannedQuantity,
            existingFinalCompletion?.replenishmentTaskNo
          );
          const savedCompletion = await this.upsertProcesslessFinalCompletion(
            tx,
            task,
            existingFinalCompletion,
            completedQuantity,
            finalOperators,
            shortageHandling,
            dto.remark
          );
          await this.upsertProductionScrapRecord(tx, task, savedCompletion, shortageHandling.scrapQuantity);
          await this.syncProductionReplenishmentRequest(tx, task, savedCompletion, shortageHandling, finalOperators);
        }

        const saved = await tx.productionTask.update({
          where: { id },
          data: {
            status: ProductionStatus.COMPLETED,
            completedQuantity,
            startedAt: task.startedAt || new Date(),
            completedAt: isFinalCorrection ? task.completedAt || new Date() : new Date(),
            remark: this.appendTaskRemark(dto.remark?.trim() || task.remark, this.formatSupervisorActionRemark('确认生产', supervisor))
          }
        });

        // 订单不能在生产完成时直接完成，必须经过仓库入库和发货后才允许进入 COMPLETED。
        await this.markOrderInProduction(tx, task.orderId);

        if (steps.length > 0) {
          await this.markAllProcessStepsCompleted(tx, task, completedQuantity, dto.remark);
        }

        return saved;
      },
      '当前生产任务正在被其他操作确认完成，请刷新后重试'
    );

    return this.toTask((await this.findTaskOrThrow(updated.id))!);
  }

  async completeProcessStep(id: string, dto: CompleteProcessStepDto) {
    if (dto.isCompleted && !dto.completedQuantity) {
      throw new BadRequestException('完成数量不能为空');
    }
    const operators = await this.resolveOperatorSnapshot(dto.operatorCodes, dto.operatorCode);

    const completedQuantity = dto.isCompleted ? Number(dto.completedQuantity) : 0;
    if (dto.isCompleted && completedQuantity <= 0) {
      throw new BadRequestException('完成数量必须大于 0');
    }

    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const task = await this.findTaskForMutationOrThrow(tx, id);
        if (task.order.status === OrderStatus.CANCELLED) {
          throw new BadRequestException('已取消订单不能修改工序完成记录');
        }
        if (task.order.status === OrderStatus.COMPLETED) {
          throw new BadRequestException('已完成发货订单不能修改工序完成记录');
        }
        if (task.inventoryBatch) {
          throw new BadRequestException('生产任务已入库，不能修改工序完成记录');
        }
        const stepDetails = processSnapshotToDetails(task.processSnapshot);
        const steps = stepDetails.map((step) => step.processName);
        const stepIndex = steps.findIndex((step) => step === dto.processName);
        if (stepIndex < 0) {
          throw new BadRequestException('该工序不属于当前生产任务');
        }
        if (task.status === ProductionStatus.PENDING) {
          throw new BadRequestException('生产任务必须先开始，才能确认工序完成');
        }
        if (task.status === ProductionStatus.COMPLETED && !dto.isCompleted) {
          throw new BadRequestException('已完成生产的工序不能改为未完成');
        }

        const stepNo = stepIndex + 1;
        const processRemark = stepDetails[stepIndex]?.processRemark || null;
        const completions = task.processCompletions || [];
        const completionMap = new Map(completions.map((item: any) => [item.stepNo, item]));

        // 生产流程必须按已保存的顺序完成，避免跳过前道工序直接把后道工序标绿。
        if (dto.isCompleted && stepNo > 1 && !completionMap.get(stepNo - 1)?.isCompleted) {
          throw new BadRequestException('必须先完成上一道工序');
        }

        if (!dto.isCompleted && completions.some((item: any) => item.stepNo > stepNo && item.isCompleted)) {
          throw new BadRequestException('后续工序已完成，不能回退当前工序');
        }

        const existing = completionMap.get(stepNo);
        const beforeSnapshot = existing ? this.toProcessCompletionSnapshot(existing) : null;
        const shortageHandling = existing ? this.shortageHandlingFromCompletion(existing) : this.emptyShortageHandling();
        const quantityGuard = dto.isCompleted
          ? this.resolveProcessQuantityGuard(
              task,
              stepDetails,
              completionMap,
              stepNo,
              completedQuantity,
              dto.quantityOverrideReason ?? existing?.quantityOverrideReason
            )
          : null;

        const saved = await tx.productionProcessCompletion.upsert({
          where: { productionTaskId_stepNo: { productionTaskId: task.id, stepNo } },
          update: {
            processName: dto.processName,
            processRemark,
            isCompleted: dto.isCompleted,
            completedQuantity,
            scrapQuantity: shortageHandling.scrapQuantity,
            shortageQuantity: shortageHandling.shortageQuantity,
            shortageMode: shortageHandling.shortageMode,
            replenishmentTaskNo: shortageHandling.replenishmentTaskNo,
            managerName: shortageHandling.managerName,
            shortageReason: shortageHandling.shortageReason,
            unit: task.unit,
            operatorCode: operators.code,
            operatorName: operators.name,
            operatorRole: operators.role,
            completedAt: dto.isCompleted ? new Date() : null,
            quantityOverrideReason: quantityGuard?.quantityOverrideReason ?? null,
            remark: dto.remark?.trim() || null
          },
          create: {
            productionTaskId: task.id,
            stepNo,
            processName: dto.processName,
            processRemark,
            isCompleted: dto.isCompleted,
            completedQuantity,
            scrapQuantity: shortageHandling.scrapQuantity,
            shortageQuantity: shortageHandling.shortageQuantity,
            shortageMode: shortageHandling.shortageMode,
            replenishmentTaskNo: shortageHandling.replenishmentTaskNo,
            managerName: shortageHandling.managerName,
            shortageReason: shortageHandling.shortageReason,
            unit: task.unit,
            operatorCode: operators.code,
            operatorName: operators.name,
            operatorRole: operators.role,
            completedAt: dto.isCompleted ? new Date() : null,
            quantityOverrideReason: quantityGuard?.quantityOverrideReason ?? null,
            remark: dto.remark?.trim() || null
          }
        });

        await tx.productionProcessCompletionLog.create({
          data: {
            completionId: saved.id,
            productionTaskId: task.id,
            processName: dto.processName,
            action: existing ? 'UPDATE' : 'CREATE',
            operatorCode: operators.code,
            operatorName: operators.name,
            beforeSnapshot: beforeSnapshot ?? Prisma.JsonNull,
            afterSnapshot: this.toProcessCompletionSnapshot(saved)
          }
        });

        // 工序确认只负责标记工艺进度；整单生产完成必须在所有工序确认后单独点击“确认完成”。
        await this.syncTaskStatusFromProcessSteps(
          tx,
          task.id,
          task.orderId,
          steps,
          task.startedAt,
          task.status,
          task.completedAt,
          decimalToNumber(task.completedQuantity)
        );
      },
      '当前生产任务正在被其他操作修改工序，请刷新后重试'
    );

    return this.toTask((await this.findTaskOrThrow(id))!);
  }

  async completeProcessSteps(id: string, dto: CompleteProcessStepsDto) {
    const completedQuantity = Number(dto.completedQuantity);
    if (completedQuantity <= 0) {
      throw new BadRequestException('完成数量必须大于 0');
    }

    const operatorsBySubmittedProcess = new Map<string, ResolvedOperatorSnapshot>();
    for (const processName of dto.processNames) {
      const trimmedProcessName = processName.trim();
      if (!operatorsBySubmittedProcess.has(trimmedProcessName)) {
        operatorsBySubmittedProcess.set(trimmedProcessName, await this.resolveOperatorSnapshotForProcess(dto, trimmedProcessName));
      }
    }

    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const task = await this.findTaskForMutationOrThrow(tx, id);
        if (task.order.status === OrderStatus.CANCELLED) {
          throw new BadRequestException('已取消订单不能修改工序完成记录');
        }
        if (task.order.status === OrderStatus.COMPLETED) {
          throw new BadRequestException('已完成发货订单不能修改工序完成记录');
        }
        if (task.inventoryBatch) {
          throw new BadRequestException('生产任务已入库，不能修改工序完成记录');
        }
        if (task.status === ProductionStatus.PENDING) {
          throw new BadRequestException('生产任务必须先开始，才能确认工序完成');
        }

        const stepDetails = processSnapshotToDetails(task.processSnapshot);
        const steps = stepDetails.map((step) => step.processName);
        const selectedStepNos = dto.processNames.map((processName) => {
          const stepIndex = steps.findIndex((step) => step === processName.trim());
          if (stepIndex < 0) {
            throw new BadRequestException(`工序 ${processName} 不属于当前生产任务`);
          }
          return stepIndex + 1;
        });
        const uniqueStepNos = Array.from(new Set(selectedStepNos)).sort((a, b) => a - b);
        if (uniqueStepNos.length === 0) {
          throw new BadRequestException('至少需要选择一道工序');
        }
        for (let index = 1; index < uniqueStepNos.length; index += 1) {
          if (uniqueStepNos[index] !== uniqueStepNos[index - 1] + 1) {
            throw new BadRequestException('批量确认的工序必须连续');
          }
        }

        const completions = task.processCompletions || [];
        const completionMap = new Map(completions.map((item: any) => [item.stepNo, item]));
        const selectedStepNoSet = new Set(uniqueStepNos);

        // 批量确认仍必须遵守工艺顺序，只允许连续确认，不能跳过前道工序。
        for (const stepNo of uniqueStepNos) {
          if (stepNo > 1 && !completionMap.get(stepNo - 1)?.isCompleted && !selectedStepNoSet.has(stepNo - 1)) {
            throw new BadRequestException('必须先完成上一道工序');
          }
        }

        for (const stepNo of uniqueStepNos) {
          const processName = steps[stepNo - 1];
          const processRemark = stepDetails[stepNo - 1]?.processRemark || null;
          const operators = operatorsBySubmittedProcess.get(processName.trim()) || { code: null, name: null, role: null };
          const existing = completionMap.get(stepNo);
          const beforeSnapshot = existing ? this.toProcessCompletionSnapshot(existing) : null;
          const shortageHandling = existing ? this.shortageHandlingFromCompletion(existing) : this.emptyShortageHandling();
          const quantityGuard = this.resolveProcessQuantityGuard(
            task,
            stepDetails,
            completionMap,
            stepNo,
            completedQuantity,
            dto.quantityOverrideReason ?? existing?.quantityOverrideReason
          );

          const saved = await tx.productionProcessCompletion.upsert({
            where: { productionTaskId_stepNo: { productionTaskId: task.id, stepNo } },
            update: {
              processName,
              processRemark,
              isCompleted: true,
              completedQuantity,
              scrapQuantity: shortageHandling.scrapQuantity,
              shortageQuantity: shortageHandling.shortageQuantity,
              shortageMode: shortageHandling.shortageMode,
              replenishmentTaskNo: shortageHandling.replenishmentTaskNo,
              managerName: shortageHandling.managerName,
              shortageReason: shortageHandling.shortageReason,
              unit: task.unit,
              operatorCode: operators.code,
              operatorName: operators.name,
              operatorRole: operators.role,
              completedAt: new Date(),
              quantityOverrideReason: quantityGuard.quantityOverrideReason,
              remark: dto.remark?.trim() || null
            },
            create: {
              productionTaskId: task.id,
              stepNo,
              processName,
              processRemark,
              isCompleted: true,
              completedQuantity,
              scrapQuantity: shortageHandling.scrapQuantity,
              shortageQuantity: shortageHandling.shortageQuantity,
              shortageMode: shortageHandling.shortageMode,
              replenishmentTaskNo: shortageHandling.replenishmentTaskNo,
              managerName: shortageHandling.managerName,
              shortageReason: shortageHandling.shortageReason,
              unit: task.unit,
              operatorCode: operators.code,
              operatorName: operators.name,
              operatorRole: operators.role,
              completedAt: new Date(),
              quantityOverrideReason: quantityGuard.quantityOverrideReason,
              remark: dto.remark?.trim() || null
            }
          });
          completionMap.set(stepNo, saved);

          await tx.productionProcessCompletionLog.create({
            data: {
              completionId: saved.id,
              productionTaskId: task.id,
              processName,
              action: existing ? 'BATCH_UPDATE' : 'BATCH_CREATE',
              operatorCode: operators.code,
              operatorName: operators.name,
              beforeSnapshot: beforeSnapshot ?? Prisma.JsonNull,
              afterSnapshot: this.toProcessCompletionSnapshot(saved)
            }
          });
        }

        await this.syncTaskStatusFromProcessSteps(
          tx,
          task.id,
          task.orderId,
          steps,
          task.startedAt,
          task.status,
          task.completedAt,
          decimalToNumber(task.completedQuantity)
        );
      },
      '当前生产任务正在被其他操作批量确认工序，请刷新后重试'
    );

    return this.toTask((await this.findTaskOrThrow(id))!);
  }

  async approveReplenishmentRequest(id: string, dto: ApproveProductionReplenishmentRequestDto) {
    const managerName = dto.managerName?.trim();
    if (!managerName) {
      throw new BadRequestException('车间主管姓名不能为空');
    }
    const supervisorRemark = dto.remark?.trim() || null;

    const updatedTaskId = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
      const completion = await tx.productionProcessCompletion.findUnique({
        where: { id },
        include: {
          productionTask: {
            include: {
              order: true,
              orderLine: true,
              inventoryBatch: true
            }
          },
          replenishmentRequests: {
            orderBy: { createdAt: 'desc' }
          }
        }
      });
      if (!completion) {
        throw new NotFoundException('生产报废补单申请不存在');
      }
      if (completion.shortageMode !== 'REPLENISHMENT_REQUEST') {
        throw new BadRequestException('没有待确认的生产报废补单申请');
      }
      if (completion.replenishmentTaskNo) {
        throw new BadRequestException('生产报废补单申请已经生成任务');
      }

      const task = completion.productionTask;
      if (task.order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('已取消订单不能确认生产报废补单');
      }
      if (task.order.status === OrderStatus.COMPLETED) {
        throw new BadRequestException('已完成发货订单不能确认生产报废补单');
      }
      if (task.inventoryBatch) {
        throw new BadRequestException('生产任务已入库，不能确认生产报废补单');
      }
      const shortageQuantity = decimalToNumber(completion.shortageQuantity);
      if (shortageQuantity <= 0) {
        throw new BadRequestException('生产报废补单申请数量必须大于 0');
      }

      // 生产报废补单必须由车间主管确认后才生成补单任务；它和订单页面由销售/计划发起的数量增加补单分开记录。
      let request = completion.replenishmentRequests[0];
      if (!request) {
        request = await this.createProductionReplenishmentRequest(tx, task, completion, {
          code: completion.operatorCode,
          name: completion.operatorName,
          role: completion.operatorRole
        });
      }
      if (request.status === 'APPROVED') {
        throw new BadRequestException('生产报废补单申请已经确认');
      }

      const stepDetails = processSnapshotToDetails(task.processSnapshot);
      const shortageHandling: ResolvedShortageHandling = {
        scrapQuantity: decimalToNumber(completion.scrapQuantity),
        shortageQuantity,
        shortageMode: 'REPLENISHMENT',
        replenishmentTaskNo: null,
        managerName,
        shortageReason: completion.shortageReason || request.reason || '生产报废补单申请已由车间主管确认'
      };
      const replenishmentTaskNo = await this.applyReplenishmentHandling(tx, task, stepDetails, shortageHandling, null, {
        sourceType: 'PRODUCTION_SCRAP',
        sourceRequestNo: request.requestNo
      });
      if (!replenishmentTaskNo) {
        throw new BadRequestException('生产报废补单任务生成失败');
      }

      const beforeSnapshot = this.toProcessCompletionSnapshot(completion);
      const reviewedAt = new Date();
      const savedCompletion = await tx.productionProcessCompletion.update({
        where: { id: completion.id },
        data: {
          shortageMode: 'REPLENISHMENT',
          replenishmentTaskNo,
          managerName,
          shortageReason: shortageHandling.shortageReason,
          remark: supervisorRemark || completion.remark
        }
      });

      await tx.productionReplenishmentRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          supervisorName: managerName,
          supervisorRemark,
          approvedAt: reviewedAt,
          reviewedAt,
          replenishmentTaskNo
        }
      });

      await tx.productionProcessCompletionLog.create({
        data: {
          completionId: savedCompletion.id,
          productionTaskId: task.id,
          processName: savedCompletion.processName,
          action: 'APPROVE_REPLENISHMENT_REQUEST',
          operatorName: managerName,
          beforeSnapshot,
          afterSnapshot: this.toProcessCompletionSnapshot(savedCompletion)
        }
      });

      return task.id;
      },
      '当前生产报废补单申请正在被其他操作处理，请刷新后重试'
    );

    return this.toTask((await this.findTaskOrThrow(updatedTaskId))!);
  }

  async rejectReplenishmentRequest(id: string, dto: RejectProductionReplenishmentRequestDto) {
    const managerName = dto.managerName?.trim();
    const reason = dto.reason?.trim();
    if (!managerName) {
      throw new BadRequestException('车间主管姓名不能为空');
    }
    if (!reason) {
      throw new BadRequestException('驳回原因不能为空');
    }

    const updatedTaskId = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
      const completion = await tx.productionProcessCompletion.findUnique({
        where: { id },
        include: {
          productionTask: {
            include: {
              order: true,
              orderLine: true,
              inventoryBatch: true
            }
          },
          replenishmentRequests: {
            orderBy: { createdAt: 'desc' }
          }
        }
      });
      if (!completion) {
        throw new NotFoundException('生产报废补单申请不存在');
      }
      if (completion.shortageMode !== 'REPLENISHMENT_REQUEST') {
        throw new BadRequestException('没有待确认的生产报废补单申请');
      }
      if (completion.replenishmentTaskNo) {
        throw new BadRequestException('生产报废补单申请已经生成任务');
      }

      const task = completion.productionTask;
      if (task.order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('已取消订单不能驳回生产报废补单');
      }
      if (task.order.status === OrderStatus.COMPLETED) {
        throw new BadRequestException('已完成发货订单不能驳回生产报废补单');
      }
      if (task.inventoryBatch) {
        throw new BadRequestException('生产任务已入库，不能驳回生产报废补单');
      }
      const shortageQuantity = decimalToNumber(completion.shortageQuantity);
      if (shortageQuantity <= 0) {
        throw new BadRequestException('生产报废补单申请数量必须大于 0');
      }

      let request = completion.replenishmentRequests[0];
      if (!request) {
        request = await this.createProductionReplenishmentRequest(tx, task, completion, {
          code: completion.operatorCode,
          name: completion.operatorName,
          role: completion.operatorRole
        });
      }
      if (request.status === 'APPROVED') {
        throw new BadRequestException('已确认的生产报废补单申请不能驳回');
      }
      if (request.status === 'REJECTED') {
        throw new BadRequestException('生产报废补单申请已经驳回');
      }

      const shortageReason = `生产报废补单申请被主管驳回：${reason}`;
      const beforeSnapshot = this.toProcessCompletionSnapshot(completion);
      const reviewedAt = new Date();
      const savedCompletion = await tx.productionProcessCompletion.update({
        where: { id: completion.id },
        data: {
          shortageMode: 'MANAGER_APPROVED',
          managerName,
          shortageReason
        }
      });

      await tx.productionReplenishmentRequest.update({
        where: { id: request.id },
        data: {
          status: 'REJECTED',
          supervisorName: managerName,
          supervisorRemark: reason,
          approvedAt: null,
          reviewedAt,
          replenishmentTaskNo: null
        }
      });

      await tx.productionProcessCompletionLog.create({
        data: {
          completionId: savedCompletion.id,
          productionTaskId: task.id,
          processName: savedCompletion.processName,
          action: 'REJECT_REPLENISHMENT_REQUEST',
          operatorName: managerName,
          beforeSnapshot,
          afterSnapshot: this.toProcessCompletionSnapshot(savedCompletion)
        }
      });

      return task.id;
      },
      '当前生产报废补单申请正在被其他操作处理，请刷新后重试'
    );

    return this.toTask((await this.findTaskOrThrow(updatedTaskId))!);
  }

  private taskInclude() {
    return {
      order: true,
      orderLine: true,
      inventoryBatch: true,
      processCompletions: {
        orderBy: { stepNo: 'asc' as const },
        include: {
          replenishmentRequests: {
            orderBy: { createdAt: 'desc' as const }
          },
          logs: {
            orderBy: { createdAt: 'desc' as const }
          }
        }
      }
    };
  }

  private async findTaskOrThrow(id: string) {
    const task = await this.prisma.productionTask.findUnique({
      where: { id },
      include: this.taskInclude()
    });
    if (!task) {
      throw new NotFoundException('生产任务不存在');
    }
    return task;
  }

  private async findTaskForMutationOrThrow(tx: Prisma.TransactionClient, id: string) {
    const task = await tx.productionTask.findUnique({
      where: { id },
      include: this.taskInclude()
    });
    if (!task) {
      throw new NotFoundException('生产任务不存在');
    }
    return task;
  }

  private resolveProcessQuantityGuard(
    task: any,
    stepDetails: ProcessStepSnapshot[],
    completionMap: Map<number, any>,
    stepNo: number,
    completedQuantity: number,
    quantityOverrideReason?: string | null
  ): ProcessQuantityGuard {
    const expectedQuantity = this.expectedProcessQuantity(task, completionMap, stepNo);
    const previousProcessName = stepNo > 1 ? stepDetails[stepNo - 2]?.processName || null : null;
    const previousShortageQuantity =
      stepNo > 1 ? Math.max(this.roundQuantity(decimalToNumber(task.plannedQuantity) - expectedQuantity), 0) : 0;
    if (stepNo > 1 && completedQuantity > expectedQuantity) {
      const reason = quantityOverrideReason?.trim();
      if (!reason) {
        throw new BadRequestException('当前工序完成数量大于上一道工序数量时，必须填写原因');
      }
      return {
        expectedQuantity,
        previousShortageQuantity,
        previousProcessName,
        quantityOverrideReason: reason
      };
    }

    return {
      expectedQuantity,
      previousShortageQuantity,
      previousProcessName,
      quantityOverrideReason: null
    };
  }

  private expectedProcessQuantity(task: any, completionMap: Map<number, any>, stepNo: number) {
    if (stepNo <= 1) {
      return decimalToNumber(task.plannedQuantity);
    }
    const previousCompletion = completionMap.get(stepNo - 1);
    if (!previousCompletion?.isCompleted) {
      return decimalToNumber(task.plannedQuantity);
    }
    return decimalToNumber(previousCompletion.completedQuantity);
  }

  private emptyShortageHandling(): ResolvedShortageHandling {
    return {
      scrapQuantity: 0,
      shortageQuantity: 0,
      shortageMode: null,
      replenishmentTaskNo: null,
      managerName: null,
      shortageReason: null
    };
  }

  private shortageHandlingFromCompletion(completion: any): ResolvedShortageHandling {
    return {
      scrapQuantity: decimalToNumber(completion.scrapQuantity),
      shortageQuantity: decimalToNumber(completion.shortageQuantity),
      shortageMode: completion.shortageMode,
      replenishmentTaskNo: completion.replenishmentTaskNo,
      managerName: completion.managerName,
      shortageReason: completion.shortageReason
    };
  }

  private resolveShortageHandling(
    dto: ProcessShortageDto,
    completedQuantity: number,
    plannedQuantity: number,
    existingReplenishmentTaskNo?: string | null
  ): ResolvedShortageHandling {
    // 最后一道工序允许少于生产计划数，但必须明确报废数量和短缺处理方式。
    const shortageQuantity = this.roundQuantity(plannedQuantity - completedQuantity);
    if (shortageQuantity <= 0) {
      return this.emptyShortageHandling();
    }

    if (dto.scrapQuantity === undefined || dto.scrapQuantity === null) {
      throw new BadRequestException('最终完成数量小于计划数量时，必须填写报废数量');
    }

    const scrapQuantity = Number(dto.scrapQuantity);
    if (!Number.isFinite(scrapQuantity) || scrapQuantity < 0) {
      throw new BadRequestException('报废数量必须大于或等于 0');
    }
    if (scrapQuantity > shortageQuantity) {
      throw new BadRequestException('报废数量不能大于短缺数量');
    }

    // 兼容旧前端字段：生产人员不能直接生成补单任务，只能发起生产报废补单申请。
    const shortageMode = dto.shortageMode || (dto.createReplenishment ? 'REPLENISHMENT_REQUEST' : undefined);
    if (!shortageMode) {
      throw new BadRequestException('短缺处理方式不能为空');
    }
    if (
      shortageMode !== 'REPLENISHMENT_REQUEST' &&
      shortageMode !== 'REPLENISHMENT' &&
      shortageMode !== 'MANAGER_APPROVED'
    ) {
      throw new BadRequestException('短缺处理方式无效');
    }

    if (shortageMode === 'REPLENISHMENT' && !existingReplenishmentTaskNo) {
      throw new BadRequestException('生产报废补单必须先由生产人员申请，并由车间主管确认');
    }

    if (existingReplenishmentTaskNo && shortageMode !== 'REPLENISHMENT') {
      throw new BadRequestException('已有补单任务时，不能改成其他短缺处理方式');
    }

    const managerName = dto.managerName?.trim() || null;
    const shortageReason = dto.shortageReason?.trim() || null;
    if (shortageMode === 'MANAGER_APPROVED' && (!managerName || !shortageReason)) {
      throw new BadRequestException('不补单完成时，必须填写管理人员姓名和缺货理由');
    }

    return {
      scrapQuantity: this.roundQuantity(scrapQuantity),
      shortageQuantity,
      shortageMode,
      replenishmentTaskNo: existingReplenishmentTaskNo || null,
      managerName: shortageMode === 'MANAGER_APPROVED' ? managerName : null,
      shortageReason: shortageMode === 'MANAGER_APPROVED' ? shortageReason : null
    };
  }

  private processStepsToJson(steps: ProcessStepSnapshot[]): Prisma.InputJsonValue {
    return steps.map((step) => ({
      processName: step.processName,
      ...(step.processRemark ? { processRemark: step.processRemark } : {})
    })) as Prisma.InputJsonValue;
  }

  private async applyReplenishmentHandling(
    tx: Prisma.TransactionClient,
    task: any,
    steps: ProcessStepSnapshot[],
    shortageHandling: ResolvedShortageHandling,
    existingReplenishmentTaskNo?: string | null,
    sourceInfo?: ReplenishmentTaskSourceInfo
  ) {
    if (shortageHandling.shortageQuantity <= 0) {
      if (existingReplenishmentTaskNo) {
        await this.deletePendingReplenishmentTask(tx, existingReplenishmentTaskNo);
      }
      return null;
    }

    if (shortageHandling.shortageMode !== 'REPLENISHMENT') {
      return null;
    }

    return this.createOrUpdateReplenishmentTask(
      tx,
      task,
      steps,
      shortageHandling.shortageQuantity,
      existingReplenishmentTaskNo,
      shortageHandling.shortageReason,
      sourceInfo
    );
  }

  private async createOrUpdateReplenishmentTask(
    tx: Prisma.TransactionClient,
    task: any,
    steps: ProcessStepSnapshot[],
    plannedQuantity: number,
    existingReplenishmentTaskNo?: string | null,
    sourceRemark?: string | null,
    sourceInfo?: ReplenishmentTaskSourceInfo
  ) {
    // 补单仍然挂在原订单和零件下，任务号按原任务号追加 R 序号，现场更容易区分来源。
    const replenishmentRemark = sourceRemark || `补单来源：${task.productionTaskNo}`;
    if (existingReplenishmentTaskNo) {
      const existing = await tx.productionTask.findUnique({
        where: { productionTaskNo: existingReplenishmentTaskNo }
      });
      if (existing) {
        if (existing.status !== ProductionStatus.PENDING) {
          throw new BadRequestException('已有补单任务已开始生产，不能修改');
        }
        await tx.productionTask.update({
          where: { productionTaskNo: existingReplenishmentTaskNo },
          data: {
            plannedQuantity,
            unit: task.unit,
            processSnapshot: this.processStepsToJson(steps),
            ...(sourceInfo
              ? {
                  replenishmentSourceType: sourceInfo.sourceType,
                  replenishmentSourceRequestNo: sourceInfo.sourceRequestNo || null
                }
              : {}),
            remark: replenishmentRemark
          }
        });
        return existingReplenishmentTaskNo;
      }
    }

    const sourceProductionTaskNo = task.sourceProductionTaskNo || task.productionTaskNo;
    const existingPending = await tx.productionTask.findFirst({
      where: {
        orderLineId: task.orderLineId,
        isReplenishment: true,
        sourceProductionTaskNo,
        ...(sourceInfo?.sourceType ? { replenishmentSourceType: sourceInfo.sourceType } : {}),
        status: ProductionStatus.PENDING
      },
      orderBy: { productionTaskNo: 'asc' }
    });
    if (existingPending) {
      await tx.productionTask.update({
        where: { id: existingPending.id },
        data: {
          plannedQuantity,
          unit: task.unit,
          processSnapshot: this.processStepsToJson(steps),
          ...(sourceInfo
            ? {
                replenishmentSourceType: sourceInfo.sourceType,
                replenishmentSourceRequestNo: sourceInfo.sourceRequestNo || null
              }
            : {}),
          remark: replenishmentRemark
        }
      });
      return existingPending.productionTaskNo;
    }

    const existingStarted = await tx.productionTask.findFirst({
      where: {
        orderLineId: task.orderLineId,
        isReplenishment: true,
        sourceProductionTaskNo,
        ...(sourceInfo?.sourceType ? { replenishmentSourceType: sourceInfo.sourceType } : {}),
        status: { not: ProductionStatus.PENDING }
      },
      orderBy: { productionTaskNo: 'desc' }
    });
    if (existingStarted) {
      throw new BadRequestException('已有补单任务已开始生产，不能用重复补单替换');
    }

    const productionTaskNo = await this.generateNextReplenishmentTaskNo(tx, sourceProductionTaskNo);
    await tx.productionTask.create({
      data: {
        productionTaskNo,
        orderId: task.orderId,
        orderLineId: task.orderLineId,
        orderNo: task.orderNo,
        customerName: task.customerName,
        partCode: task.partCode,
        partName: task.partName,
        plannedQuantity,
        unit: task.unit,
        processSnapshot: this.processStepsToJson(steps),
        status: ProductionStatus.PENDING,
        isReplenishment: true,
        sourceProductionTaskNo,
        replenishmentSourceType: sourceInfo?.sourceType || 'PRODUCTION_SCRAP',
        replenishmentSourceRequestNo: sourceInfo?.sourceRequestNo || null,
        remark: replenishmentRemark
      }
    });
    return productionTaskNo;
  }

  private async deletePendingReplenishmentTask(tx: Prisma.TransactionClient, replenishmentTaskNo: string) {
    const existing = await tx.productionTask.findUnique({
      where: { productionTaskNo: replenishmentTaskNo },
      include: {
        inventoryBatch: true,
        processCompletions: true
      }
    });
    if (!existing) {
      return;
    }
    if (existing.status !== ProductionStatus.PENDING || existing.inventoryBatch || existing.processCompletions.length > 0) {
      throw new BadRequestException('已有补单任务存在生产记录，不能自动删除');
    }
    await tx.productionTask.delete({ where: { productionTaskNo: replenishmentTaskNo } });
  }

  private async generateNextReplenishmentTaskNo(tx: Prisma.TransactionClient, sourceProductionTaskNo: string) {
    const prefix = `${sourceProductionTaskNo}-R`;
    const existingTasks = await tx.productionTask.findMany({
      where: {
        OR: [{ sourceProductionTaskNo }, { productionTaskNo: { startsWith: prefix } }]
      },
      select: { productionTaskNo: true }
    });
    const usedSequences = new Set<number>();
    for (const task of existingTasks) {
      const matched = task.productionTaskNo.match(/-R(\d+)$/);
      if (matched) {
        usedSequences.add(Number(matched[1]));
      }
    }
    for (let index = 1; index < 1000; index += 1) {
      if (!usedSequences.has(index)) {
        return `${prefix}${String(index).padStart(2, '0')}`;
      }
    }
    throw new BadRequestException('没有可用的补单任务号');
  }

  private async upsertProductionScrapRecord(
    tx: Prisma.TransactionClient,
    task: any,
    completion: any,
    scrapQuantity: number
  ) {
    const sourceRecordType = 'ProductionProcessCompletion';
    const sourceRecordId = completion.id;
    if (scrapQuantity <= 0) {
      await tx.productionScrapRecord.deleteMany({
        where: { sourceRecordType, sourceRecordId }
      });
      return;
    }

    await tx.productionScrapRecord.upsert({
      where: { sourceRecordType_sourceRecordId: { sourceRecordType, sourceRecordId } },
      update: {
        orderId: task.orderId,
        orderNo: task.orderNo,
        orderLineId: task.orderLineId,
        productionTaskId: task.id,
        productionTaskNo: task.productionTaskNo,
        partCode: task.partCode,
        partName: task.partName,
        quantity: scrapQuantity,
        unit: task.unit,
        reason: completion.shortageReason || completion.remark || '生产完成短缺报废',
        recordDate: new Date()
      },
      create: {
        scrapNo: await this.generateNextScrapNo(tx),
        orderId: task.orderId,
        orderNo: task.orderNo,
        orderLineId: task.orderLineId,
        productionTaskId: task.id,
        productionTaskNo: task.productionTaskNo,
        partCode: task.partCode,
        partName: task.partName,
        quantity: scrapQuantity,
        unit: task.unit,
        reason: completion.shortageReason || completion.remark || '生产完成短缺报废',
        sourceRecordType,
        sourceRecordId,
        recordDate: new Date()
      }
    });
  }

  private async syncProductionReplenishmentRequest(
    tx: Prisma.TransactionClient,
    task: any,
    completion: any,
    shortageHandling: ResolvedShortageHandling,
    requestedBy: ResolvedOperatorSnapshot
  ) {
    const existingRequest = await tx.productionReplenishmentRequest.findUnique({
      where: { processCompletionId: completion.id }
    });

    if (shortageHandling.shortageMode !== 'REPLENISHMENT_REQUEST' || shortageHandling.shortageQuantity <= 0) {
      if (existingRequest?.status === 'PENDING') {
        await tx.productionReplenishmentRequest.delete({ where: { id: existingRequest.id } });
      }
      return;
    }

    if (existingRequest?.status === 'APPROVED') {
      throw new BadRequestException('已确认的生产报废补单申请不能修改');
    }

    // 操作员在工序完成表中发现报废并选择“生产报废补单申请”时，只创建待确认申请，不直接生成生产任务。
    await this.createProductionReplenishmentRequest(tx, task, completion, requestedBy, existingRequest?.requestNo);
  }

  private async createProductionReplenishmentRequest(
    tx: Prisma.TransactionClient,
    task: any,
    completion: any,
    requestedBy: ResolvedOperatorSnapshot,
    existingRequestNo?: string | null
  ) {
    // sourceType 固定为 PRODUCTION_SCRAP，用于后续区分“生产报废补单”和“销售/计划追加补单”。
    const requestQuantity = decimalToNumber(completion.shortageQuantity);
    const scrapQuantity = decimalToNumber(completion.scrapQuantity);
    const reason = [
      `生产报废补单申请：${task.productionTaskNo}`,
      `工序：${completion.processName}`,
      `报废：${this.roundQuantity(scrapQuantity)} ${task.unit}`,
      `申请补齐：${this.roundQuantity(requestQuantity)} ${task.unit}`,
      completion.remark ? `说明：${completion.remark}` : ''
    ]
      .filter(Boolean)
      .join('；');

    return tx.productionReplenishmentRequest.upsert({
      where: { processCompletionId: completion.id },
      update: {
        sourceType: 'PRODUCTION_SCRAP',
        status: 'PENDING',
        orderId: task.orderId,
        orderNo: task.orderNo,
        orderLineId: task.orderLineId,
        productionTaskId: task.id,
        productionTaskNo: task.productionTaskNo,
        partCode: task.partCode,
        partName: task.partName,
        requestQuantity,
        scrapQuantity,
        unit: task.unit,
        reason,
        requestedByCode: requestedBy.code,
        requestedByName: requestedBy.name,
        supervisorName: null,
        supervisorRemark: null,
        approvedAt: null,
        reviewedAt: null,
        replenishmentTaskNo: null
      },
      create: {
        requestNo: existingRequestNo || (await this.generateNextReplenishmentRequestNo(tx)),
        sourceType: 'PRODUCTION_SCRAP',
        status: 'PENDING',
        orderId: task.orderId,
        orderNo: task.orderNo,
        orderLineId: task.orderLineId,
        productionTaskId: task.id,
        productionTaskNo: task.productionTaskNo,
        processCompletionId: completion.id,
        partCode: task.partCode,
        partName: task.partName,
        requestQuantity,
        scrapQuantity,
        unit: task.unit,
        reason,
        requestedByCode: requestedBy.code,
        requestedByName: requestedBy.name
      }
    });
  }

  private async generateNextReplenishmentRequestNo(tx: Prisma.TransactionClient) {
    const dateKey = businessDateKey();
    const prefix = `PRR-${dateKey}-`;
    const lastRequest = await tx.productionReplenishmentRequest.findFirst({
      where: { requestNo: { startsWith: prefix } },
      orderBy: { requestNo: 'desc' },
      select: { requestNo: true }
    });
    const nextSequence = lastRequest ? Number(lastRequest.requestNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(nextSequence).padStart(4, '0')}`;
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

  private async generateNextNoticeNo(tx: Prisma.TransactionClient) {
    const dateKey = businessDateKey();
    const prefix = `PN-${dateKey}-`;
    const lastNotice = await tx.productionNotice.findFirst({
      where: { noticeNo: { startsWith: prefix } },
      orderBy: { noticeNo: 'desc' },
      select: { noticeNo: true }
    });
    const nextSequence = lastNotice ? Number(lastNotice.noticeNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(nextSequence).padStart(4, '0')}`;
  }

  private appendTaskRemark(existingRemark: string | null | undefined, appendLine: string) {
    const existing = existingRemark?.trim();
    return [existing, appendLine].filter(Boolean).join('；');
  }

  private formatSupervisorActionRemark(action: string, supervisor: ProductionOperatorRow) {
    return `${action}：${supervisor.name}（${supervisor.accountId || supervisor.code} / ${supervisor.role}）`;
  }

  private formatWithdrawRemark(
    reason: string,
    handlingMode: string,
    handlingQuantity: number,
    unit: string,
    handledAt: Date,
    managerName: string,
    remark?: string
  ) {
    const handlingText = this.withdrawHandlingText(handlingMode);
    const quantityText = handlingMode === 'NONE' ? '无实物处理' : `${this.roundQuantity(handlingQuantity)} ${unit}`;
    return [
      `管理撤回：${reason}`,
      `处理方式：${handlingText}`,
      `处理数量：${quantityText}`,
      `处理日期：${handledAt.toISOString()}`,
      `管理人员：${managerName}`,
      remark ? `说明：${remark}` : ''
    ]
      .filter(Boolean)
      .join('；');
  }

  private formatWithdrawNoticeReason(
    reason: string,
    handlingMode: string,
    handlingQuantity: number,
    unit: string,
    handledAt: Date,
    remark?: string
  ) {
    const handlingText = this.withdrawHandlingText(handlingMode);
    const quantityText = handlingMode === 'NONE' ? '无实物处理' : `${this.roundQuantity(handlingQuantity)} ${unit}`;
    return [
      `撤回原因：${reason}`,
      `处理方式：${handlingText}`,
      `处理数量：${quantityText}`,
      `处理日期：${handledAt.toLocaleString('zh-CN', { hour12: false })}`,
      remark ? `说明：${remark}` : ''
    ]
      .filter(Boolean)
      .join('；');
  }

  private withdrawHandlingText(handlingMode: string) {
    if (handlingMode === 'STOCK') {
      return '转入库存，等待仓库确认';
    }
    if (handlingMode === 'SCRAP') {
      return '报废，不得入库';
    }
    return '无已生产零件需要处理';
  }

  private roundQuantity(value: number) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  private pickEarliestDate(current?: Date | string | null, candidate?: Date | string | null) {
    if (!current) {
      return candidate;
    }
    if (!candidate) {
      return current;
    }
    return new Date(candidate).getTime() < new Date(current).getTime() ? candidate : current;
  }

  private productionDisplayStatus(task: any): ProductionOrderSummaryStatus {
    if (task.inventoryBatchNo) {
      return 'RECEIVED';
    }
    const processSteps = Array.isArray(task.processSteps) ? task.processSteps : [];
    const allProcessesCompleted =
      processSteps.length === 0
        ? task.status !== ProductionStatus.PENDING
        : processSteps.every((step: string) =>
            task.processCompletions?.some((completion: any) => completion.processName === step && completion.isCompleted)
          );
    if (
      task.status !== ProductionStatus.PENDING &&
      task.status !== ProductionStatus.COMPLETED &&
      allProcessesCompleted
    ) {
      return 'READY_TO_COMPLETE';
    }
    return task.status;
  }

  private toEffectiveTaskProductionStatus(task: any) {
    if (task.inventoryBatch || task.status === ProductionStatus.COMPLETED) {
      return ProductionStatus.COMPLETED;
    }
    return task.status === ProductionStatus.IN_PROGRESS ? ProductionStatus.IN_PROGRESS : ProductionStatus.PENDING;
  }

  private orderSummaryProgressLabel(task: any, status: ProductionOrderSummaryStatus) {
    if (status === 'PENDING') {
      return '待确认生产';
    }
    if (status === 'IN_PROGRESS') {
      return this.currentProcessTextForSummary(task);
    }
    if (status === 'READY_TO_COMPLETE') {
      return '待确认完成';
    }
    return this.productionStatusLabelForSummary(status);
  }

  private currentProcessTextForSummary(task: any) {
    const currentProcess = task.processSteps?.find(
      (step: string) =>
        !task.processCompletions?.some((completion: any) => completion.processName === step && completion.isCompleted)
    );
    return currentProcess ? this.processStepTextForSummary(task, currentProcess) : '待确认完成';
  }

  private processStepTextForSummary(task: any, processName: string) {
    const detail = task.processStepDetails?.find((item: any) => item.processName === processName);
    const remark = detail?.processRemark?.trim();
    return remark ? `${processName}（${remark}）` : processName;
  }

  private productionStatusLabelForSummary(status: ProductionOrderSummaryStatus) {
    if (status === 'IN_PROGRESS') {
      return '生产中';
    }
    if (status === 'COMPLETED') {
      return '已完成';
    }
    if (status === 'RECEIVED') {
      return '已入库';
    }
    if (status === 'READY_TO_COMPLETE') {
      return '待确认完成';
    }
    return '待确认生产';
  }

  private resolveOrderSummaryStatus(summary: any): ProductionOrderSummaryStatus {
    if (summary.taskCount > 0 && summary.receivedCount === summary.taskCount) {
      return 'RECEIVED';
    }
    if (summary.taskCount > 0 && summary.completedCount + summary.receivedCount === summary.taskCount) {
      return 'COMPLETED';
    }
    if (summary.readyToCompleteCount > 0) {
      return 'READY_TO_COMPLETE';
    }
    if (summary.inProgressCount > 0) {
      return 'IN_PROGRESS';
    }
    return 'PENDING';
  }

  private toEffectiveTaskCompletedQuantity(task: any, stockQuantity = 0, orderReceiptQuantity = 0) {
    const completedQuantity = decimalToNumber(task.completedQuantity);
    if (completedQuantity > 0) {
      return completedQuantity;
    }
    // 生产统计不能只依赖旧 completedQuantity；已入库历史任务用订单入库批次和转库存批次数量兜底。
    const orderInventoryQuantity = orderReceiptQuantity || (task.inventoryBatch ? decimalToNumber(task.inventoryBatch.quantity) : 0);
    return orderInventoryQuantity + stockQuantity;
  }

  private toCompletedReplenishmentQuantityByLine(tasks: any[]) {
    const quantityByLine = new Map<string, number>();
    for (const task of tasks) {
      if (!task?.isReplenishment || this.toEffectiveTaskProductionStatus(task) !== ProductionStatus.COMPLETED) {
        continue;
      }
      const key = task.orderLineId || task.sourceProductionTaskNo || task.productionTaskNo;
      const quantity = this.roundQuantity(
        this.toEffectiveTaskCompletedQuantity(task) || decimalToNumber(task.plannedQuantity)
      );
      if (quantity <= 0) {
        continue;
      }
      quantityByLine.set(key, this.roundQuantity((quantityByLine.get(key) || 0) + quantity));
    }
    return quantityByLine;
  }

  private resolveTaskUnresolvedShortageQuantity(
    task: any,
    shortageQuantity: number,
    completedReplenishmentQuantityByLine?: Map<string, number>
  ) {
    if (shortageQuantity <= 0 || !completedReplenishmentQuantityByLine) {
      return shortageQuantity;
    }
    const key = task.orderLineId || task.productionTaskNo;
    const coveringQuantity = completedReplenishmentQuantityByLine.get(key) || 0;
    if (coveringQuantity <= 0) {
      return shortageQuantity;
    }

    const usedQuantity = Math.min(shortageQuantity, coveringQuantity);
    completedReplenishmentQuantityByLine.set(key, this.roundQuantity(coveringQuantity - usedQuantity));
    return this.roundQuantity(shortageQuantity - usedQuantity);
  }

  private async markAllProcessStepsCompleted(
    tx: Prisma.TransactionClient,
    task: any,
    completedQuantity: number,
    remark?: string
  ) {
    const stepDetails = processSnapshotToDetails(task.processSnapshot);
    for (const [index, processStep] of stepDetails.entries()) {
      const processName = processStep.processName;
      const stepNo = index + 1;
      const existing = await tx.productionProcessCompletion.findUnique({
        where: { productionTaskId_stepNo: { productionTaskId: task.id, stepNo } }
      });
      const beforeSnapshot = existing ? this.toProcessCompletionSnapshot(existing) : null;
      const saved = await tx.productionProcessCompletion.upsert({
        where: { productionTaskId_stepNo: { productionTaskId: task.id, stepNo } },
        update: {
          processName,
          processRemark: processStep.processRemark || null,
          isCompleted: true,
          completedQuantity,
          scrapQuantity: 0,
          shortageQuantity: 0,
          shortageMode: null,
          replenishmentTaskNo: null,
          managerName: null,
          shortageReason: null,
          unit: task.unit,
          operatorCode: 'SYSTEM',
          operatorName: '系统完成',
          operatorRole: '整单完成',
          completedAt: new Date(),
          remark: remark?.trim() || existing?.remark || null
        },
        create: {
          productionTaskId: task.id,
          stepNo,
          processName,
          processRemark: processStep.processRemark || null,
          isCompleted: true,
          completedQuantity,
          scrapQuantity: 0,
          shortageQuantity: 0,
          shortageMode: null,
          replenishmentTaskNo: null,
          managerName: null,
          shortageReason: null,
          unit: task.unit,
          operatorCode: 'SYSTEM',
          operatorName: '系统完成',
          operatorRole: '整单完成',
          completedAt: new Date(),
          remark: remark?.trim() || null
        }
      });

      await tx.productionProcessCompletionLog.create({
        data: {
          completionId: saved.id,
          productionTaskId: task.id,
          processName,
          action: existing ? 'TASK_COMPLETE_UPDATE' : 'TASK_COMPLETE_CREATE',
          operatorCode: 'SYSTEM',
          operatorName: '系统完成',
          beforeSnapshot: beforeSnapshot ?? Prisma.JsonNull,
          afterSnapshot: this.toProcessCompletionSnapshot(saved)
        }
      });
    }
  }

  private async upsertProcesslessFinalCompletion(
    tx: Prisma.TransactionClient,
    task: any,
    existing: any,
    completedQuantity: number,
    operators: ResolvedOperatorSnapshot,
    shortageHandling: ResolvedShortageHandling,
    remark?: string
  ) {
    const beforeSnapshot = existing ? this.toProcessCompletionSnapshot(existing) : null;
    const saved = await tx.productionProcessCompletion.upsert({
      where: { productionTaskId_stepNo: { productionTaskId: task.id, stepNo: 1 } },
      update: {
        processName: '最终确认',
        processRemark: '无工序快照任务的最终生产确认',
        isCompleted: true,
        completedQuantity,
        scrapQuantity: shortageHandling.scrapQuantity,
        shortageQuantity: shortageHandling.shortageQuantity,
        shortageMode: shortageHandling.shortageMode,
        replenishmentTaskNo: shortageHandling.replenishmentTaskNo,
        managerName: shortageHandling.managerName,
        shortageReason: shortageHandling.shortageReason,
        unit: task.unit,
        operatorCode: operators.code,
        operatorName: operators.name,
        operatorRole: operators.role,
        completedAt: new Date(),
        remark: remark?.trim() || existing?.remark || null
      },
      create: {
        productionTaskId: task.id,
        stepNo: 1,
        processName: '最终确认',
        processRemark: '无工序快照任务的最终生产确认',
        isCompleted: true,
        completedQuantity,
        scrapQuantity: shortageHandling.scrapQuantity,
        shortageQuantity: shortageHandling.shortageQuantity,
        shortageMode: shortageHandling.shortageMode,
        replenishmentTaskNo: shortageHandling.replenishmentTaskNo,
        managerName: shortageHandling.managerName,
        shortageReason: shortageHandling.shortageReason,
        unit: task.unit,
        operatorCode: operators.code,
        operatorName: operators.name,
        operatorRole: operators.role,
        completedAt: new Date(),
        remark: remark?.trim() || null
      },
      include: { replenishmentRequests: true, logs: true }
    });

    await tx.productionProcessCompletionLog.create({
      data: {
        completionId: saved.id,
        productionTaskId: task.id,
        processName: saved.processName,
        action: existing ? 'TASK_FINAL_UPDATE' : 'TASK_FINAL_CONFIRM',
        operatorCode: operators.code,
        operatorName: operators.name,
        beforeSnapshot: beforeSnapshot ?? Prisma.JsonNull,
        afterSnapshot: this.toProcessCompletionSnapshot(saved)
      }
    });

    return saved;
  }

  private async syncTaskStatusFromProcessSteps(
    tx: Prisma.TransactionClient,
    productionTaskId: string,
    orderId: string,
    _steps: string[],
    startedAt?: Date | null,
    currentStatus?: ProductionStatus,
    currentCompletedAt?: Date | null,
    currentCompletedQuantity = 0
  ) {
    const isAlreadyCompleted = currentStatus === ProductionStatus.COMPLETED;

    await tx.productionTask.update({
      where: { id: productionTaskId },
      data: {
        status: isAlreadyCompleted ? ProductionStatus.COMPLETED : ProductionStatus.IN_PROGRESS,
        // 工序完成表可能多次修改，startedAt 必须保留首次开始生产时间，不能被后续修改日志刷新。
        startedAt: startedAt || new Date(),
        completedAt: isAlreadyCompleted ? currentCompletedAt || new Date() : null,
        completedQuantity: isAlreadyCompleted ? currentCompletedQuantity : 0
      }
    });

    await this.markOrderInProduction(tx, orderId);
  }

  private async markOrderInProduction(tx: Prisma.TransactionClient, orderId: string) {
    await tx.customerOrder.updateMany({
      where: { id: orderId, status: { not: OrderStatus.CANCELLED } },
      data: { status: OrderStatus.IN_PRODUCTION }
    });
  }

  private toProcessCompletionSnapshot(completion: any) {
    const replenishmentRequest = completion.replenishmentRequests?.[0];
    return {
      stepNo: completion.stepNo,
      processName: completion.processName,
      processRemark: completion.processRemark,
      isCompleted: completion.isCompleted,
      completedQuantity: decimalToNumber(completion.completedQuantity),
      scrapQuantity: decimalToNumber(completion.scrapQuantity),
      shortageQuantity: decimalToNumber(completion.shortageQuantity),
      shortageMode: completion.shortageMode,
      replenishmentTaskNo: completion.replenishmentTaskNo,
      replenishmentRequestNo: replenishmentRequest?.requestNo,
      replenishmentSource: replenishmentRequest?.sourceType,
      replenishmentRequestStatus: replenishmentRequest?.status,
      replenishmentApprovedBy: replenishmentRequest?.supervisorName,
      replenishmentApprovedAt: replenishmentRequest?.approvedAt ? new Date(replenishmentRequest.approvedAt).toISOString() : null,
      replenishmentReviewedAt: replenishmentRequest?.reviewedAt ? new Date(replenishmentRequest.reviewedAt).toISOString() : null,
      managerName: completion.managerName,
      shortageReason: completion.shortageReason,
      shortageResolutionMode: completion.shortageResolutionMode,
      shortageResolutionBy: completion.shortageResolutionBy,
      shortageResolutionReason: completion.shortageResolutionReason,
      shortageResolvedAt: completion.shortageResolvedAt ? new Date(completion.shortageResolvedAt).toISOString() : null,
      unit: completion.unit,
      operatorCode: completion.operatorCode,
      operatorName: completion.operatorName,
      operatorRole: completion.operatorRole,
      completedAt: completion.completedAt ? new Date(completion.completedAt).toISOString() : null,
      quantityOverrideReason: completion.quantityOverrideReason,
      remark: completion.remark
    };
  }

  private async toNoticesWithCustomerNames(notices: any[]) {
    const orderIds = [
      ...new Set(notices.map((notice) => String(notice.orderId || '').trim()).filter(Boolean))
    ];
    const orderNos = [
      ...new Set(notices.map((notice) => String(notice.orderNo || '').trim()).filter(Boolean))
    ];
    const orderWhere: Prisma.CustomerOrderWhereInput[] = [];
    if (orderIds.length > 0) {
      orderWhere.push({ id: { in: orderIds } });
    }
    if (orderNos.length > 0) {
      orderWhere.push({ orderNo: { in: orderNos } });
    }

    const orders =
      orderWhere.length > 0
        ? await this.prisma.customerOrder.findMany({
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
      status: notice.status,
      target: notice.target,
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

  private toScrapRecord(record: any) {
    return {
      id: record.id,
      scrapNo: record.scrapNo,
      orderNo: record.orderNo,
      orderLineId: record.orderLineId,
      productionTaskId: record.productionTaskId,
      productionTaskNo: record.productionTaskNo,
      partCode: record.partCode,
      partName: record.partName,
      quantity: decimalToNumber(record.quantity),
      unit: record.unit,
      reason: record.reason,
      recordDate: record.recordDate,
      sourceRecordType: record.sourceRecordType,
      sourceRecordId: record.sourceRecordId,
      createdAt: record.createdAt
    };
  }

  private toProductionReplenishmentRequest(request: any, orderStatus?: OrderStatus) {
    return {
      id: request.id,
      requestNo: request.requestNo,
      sourceType: request.sourceType,
      status: request.status,
      orderStatus,
      orderId: request.orderId,
      orderNo: request.orderNo,
      orderLineId: request.orderLineId,
      productionTaskId: request.productionTaskId,
      productionTaskNo: request.productionTaskNo,
      processCompletionId: request.processCompletionId,
      partCode: request.partCode,
      partName: request.partName,
      requestQuantity: decimalToNumber(request.requestQuantity),
      scrapQuantity: decimalToNumber(request.scrapQuantity),
      unit: request.unit,
      reason: request.reason,
      requestedByCode: request.requestedByCode,
      requestedByName: request.requestedByName,
      supervisorName: request.supervisorName,
      supervisorRemark: request.supervisorRemark,
      approvedAt: request.approvedAt,
      reviewedAt: request.reviewedAt,
      replenishmentTaskNo: request.replenishmentTaskNo,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt
    };
  }

  private toTask(task: any, completedReplenishmentQuantityByLine?: Map<string, number>) {
    const snapshotStepDetails = processSnapshotToDetails(task.processSnapshot);
    const processlessCompletionDetails: ProcessStepSnapshot[] =
      snapshotStepDetails.length === 0
        ? (task.processCompletions || [])
            .slice()
            .sort((left: any, right: any) => left.stepNo - right.stepNo)
            .map((completion: any) => ({
              processName: completion.processName,
              processRemark: completion.processRemark || ''
            }))
        : [];
    const stepDetails = snapshotStepDetails.length > 0 ? snapshotStepDetails : processlessCompletionDetails;
    const steps = stepDetails.map((step) => step.processName);
    const completionMap = new Map((task.processCompletions || []).map((item: any) => [item.stepNo, item]));
    const effectiveCompletedQuantity = this.toEffectiveTaskCompletedQuantity(task);
    const isImplicitlyCompleted = Boolean(task.inventoryBatch) || task.status === ProductionStatus.COMPLETED;
    const finalCompletion = (task.processCompletions || []).reduce((current: any, item: any) => {
      if (!current || item.stepNo > current.stepNo) {
        return item;
      }
      return current;
    }, null);
    const rawUnresolvedShortageQuantity =
      finalCompletion?.shortageMode === 'MANAGER_APPROVED' &&
      !finalCompletion.shortageResolutionMode &&
      decimalToNumber(finalCompletion.shortageQuantity) > 0
        ? decimalToNumber(finalCompletion.shortageQuantity)
        : 0;
    const unresolvedShortageQuantity = this.resolveTaskUnresolvedShortageQuantity(
      task,
      rawUnresolvedShortageQuantity,
      completedReplenishmentQuantityByLine
    );
    const latestReplenishmentRequest = finalCompletion?.replenishmentRequests?.[0];
    const pendingProductionReplenishmentQuantity =
      finalCompletion?.shortageMode === 'REPLENISHMENT_REQUEST' &&
      !finalCompletion.replenishmentTaskNo &&
      latestReplenishmentRequest?.status !== 'REJECTED' &&
      decimalToNumber(finalCompletion.shortageQuantity) > 0
        ? decimalToNumber(finalCompletion.shortageQuantity)
        : 0;
    return {
      id: task.id,
      productionTaskNo: task.productionTaskNo,
      orderId: task.orderId,
      orderLineId: task.orderLineId,
      orderNo: task.orderNo,
      isReplenishment: task.isReplenishment,
      sourceProductionTaskNo: task.sourceProductionTaskNo,
      replenishmentSourceType: this.resolveTaskReplenishmentSourceType(task),
      replenishmentSourceRequestNo: task.replenishmentSourceRequestNo,
      replenishmentSourceLabel: this.resolveTaskReplenishmentSourceLabel(task),
      customerId: task.order?.customerId,
      orderStatus: task.order?.status,
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
      projectModel: task.orderLine?.projectModel,
      drawingNo: task.orderLine?.drawingNo,
      drawingVersion: task.orderLine?.drawingVersion,
      drawingFileName: task.orderLine?.drawingFileName,
      drawingFileUrl: task.orderLine?.drawingFileUrl,
      partThickness: decimalToNumber(task.orderLine?.partThickness),
      partSpecification: task.orderLine?.partSpecification,
      customerOrderQuantity: decimalToNumber(task.orderLine?.quantity ?? task.plannedQuantity),
      plannedQuantity: decimalToNumber(task.plannedQuantity),
      completedQuantity: effectiveCompletedQuantity,
      unresolvedShortageQuantity,
      unresolvedShortageUnit: unresolvedShortageQuantity > 0 ? finalCompletion?.unit || task.unit : undefined,
      unresolvedShortageReason:
        unresolvedShortageQuantity > 0
          ? `${finalCompletion?.managerName || '-'}确认：${finalCompletion?.shortageReason || '管理确认缺货完成'}`
          : undefined,
      pendingProductionReplenishmentQuantity,
      pendingProductionReplenishmentUnit:
        pendingProductionReplenishmentQuantity > 0 ? finalCompletion?.unit || task.unit : undefined,
      unit: task.unit,
      status: task.status,
      inventoryBatchNo: task.inventoryBatch?.batchNo,
      inventoryStatus: task.inventoryBatch?.status,
      processSteps: steps,
      processStepDetails: stepDetails,
      processCompletions: steps.map((processName, index) => {
        const stepNo = index + 1;
        const completion = completionMap.get(stepNo) as any;
        const replenishmentRequest = completion?.replenishmentRequests?.[0];
        // 已完成或已入库的历史任务可能没有完整工序表记录；接口层按业务结果兜底，让页面工序标签保持绿色只读。
        const isCompleted = Boolean(completion?.isCompleted) || isImplicitlyCompleted;
        const completionQuantity = completion ? decimalToNumber(completion.completedQuantity) : 0;
        return {
          id: completion?.id,
          stepNo,
          processName,
          processRemark: completion?.processRemark || stepDetails[index]?.processRemark,
          isCompleted,
          completedQuantity: completionQuantity > 0 ? completionQuantity : isCompleted ? effectiveCompletedQuantity : 0,
          scrapQuantity: decimalToNumber(completion?.scrapQuantity),
          shortageQuantity: decimalToNumber(completion?.shortageQuantity),
          shortageMode: completion?.shortageMode,
          replenishmentTaskNo: completion?.replenishmentTaskNo,
          replenishmentRequestNo: replenishmentRequest?.requestNo,
          replenishmentSource: replenishmentRequest?.sourceType,
          replenishmentRequestStatus: replenishmentRequest?.status,
          replenishmentApprovedBy: replenishmentRequest?.supervisorName,
          replenishmentApprovedAt: replenishmentRequest?.approvedAt,
          replenishmentReviewedAt: replenishmentRequest?.reviewedAt,
          replenishmentApprovalRemark: replenishmentRequest?.supervisorRemark,
          managerName: completion?.managerName,
          shortageReason: completion?.shortageReason,
          shortageResolutionMode: completion?.shortageResolutionMode,
          shortageResolutionBy: completion?.shortageResolutionBy,
          shortageResolutionReason: completion?.shortageResolutionReason,
          shortageResolvedAt: completion?.shortageResolvedAt,
          unit: completion?.unit || task.unit,
          operatorCode: completion?.operatorCode,
          operatorName: completion?.operatorName,
          operatorRole: completion?.operatorRole,
          completedAt: completion?.completedAt,
          quantityOverrideReason: completion?.quantityOverrideReason,
          remark: completion?.remark,
          logs: (completion?.logs || []).map((log: any) => ({
            id: log.id,
            action: log.action,
            operatorCode: log.operatorCode,
            operatorName: log.operatorName,
            beforeSnapshot: log.beforeSnapshot,
            afterSnapshot: log.afterSnapshot,
            createdAt: log.createdAt
          }))
        };
      }),
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      remark: task.remark
    };
  }

  private resolveTaskReplenishmentSourceType(task: any) {
    if (!task?.isReplenishment) {
      return null;
    }
    if (task.replenishmentSourceType) {
      return task.replenishmentSourceType;
    }
    const remark = String(task.remark || '');
    if (remark.includes('生产报废') || remark.includes('PRODUCTION_SCRAP')) {
      return 'PRODUCTION_SCRAP';
    }
    return 'ORDER_CHANGE';
  }

  private resolveTaskReplenishmentSourceLabel(task: any) {
    const sourceType = this.resolveTaskReplenishmentSourceType(task);
    if (sourceType === 'PRODUCTION_SCRAP') {
      return '生产报废补单';
    }
    if (sourceType === 'ORDER_CHANGE') {
      return '订单补单';
    }
    return null;
  }

  private startOfDay(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('开始日期无效');
    }
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private endOfDay(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('结束日期无效');
    }
    date.setHours(23, 59, 59, 999);
    return date;
  }
}
