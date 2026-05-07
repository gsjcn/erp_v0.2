import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, ProductionNoticeStatus, ProductionNoticeTarget, ProductionStatus } from '@prisma/client';
import { decimalToNumber, processSnapshotToDetails, type ProcessStepSnapshot } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CompleteProcessStepDto,
  CompleteProcessStepsDto,
  CompleteProductionDto,
  AcknowledgeProductionNoticeDto,
  ProductionAnnualSummaryQueryDto,
  ProductionNoticeQueryDto,
  ProductionOperatorQueryDto,
  ProductionScrapQueryDto,
  ProductionTaskQueryDto,
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

const fallbackProductionOperators: ProductionOperatorRow[] = [
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

type ShortageMode = 'REPLENISHMENT' | 'MANAGER_APPROVED';

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
    return notices.map((notice) => this.toNotice(notice));
  }

  async acknowledgeNotice(id: string, dto: AcknowledgeProductionNoticeDto) {
    const acknowledgedBy = dto.acknowledgedBy.trim();
    if (!acknowledgedBy) {
      throw new BadRequestException('Acknowledged by is required');
    }
    const notice = await this.prisma.productionNotice.findUnique({ where: { id } });
    if (!notice) {
      throw new NotFoundException('Production notice not found');
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

  async scrapRecords(query: ProductionScrapQueryDto = {}) {
    const where: Prisma.ProductionScrapRecordWhereInput = {};
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
        return rows.map((operator) => this.toProductionOperatorRow(operator));
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
        throw new BadRequestException(`Valid operatorCode is required: ${code}`);
      }
      return operator;
    });

    return {
      code: operators.map((operator) => operator.code).join(', '),
      name: operators.map((operator) => operator.name).join('、'),
      role: operators.map((operator) => operator.role).join('、')
    };
  }

  private async resolveOperatorSnapshotForProcess(
    dto: CompleteProcessStepsDto,
    processName: string
  ): Promise<ResolvedOperatorSnapshot> {
    const assignment = dto.operatorsByProcess?.find((item) => item.processName.trim() === processName);
    return this.resolveOperatorSnapshot(assignment?.operatorCodes ?? dto.operatorCodes, dto.operatorCode);
  }

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
      include: this.taskInclude(),
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
        where: { order: { orderDate: { gte: start, lt: end } } },
        include: { inventoryBatch: true }
      })
    ]);

    const orderNos = Array.from(new Set(productionTasks.map((task) => task.orderNo)));
    const productionTaskNos = productionTasks.map((task) => task.productionTaskNo);
    const [shipmentTransactions, receiptTransactions] = await this.prisma.$transaction([
      // 发货统计也按来源订单的下单日期归属，不能按出库当天归属，否则跨年订单会被统计到错误年度。
      orderNos.length > 0
        ? this.prisma.inventoryTransaction.findMany({
            where: {
              transactionType: 'OUT',
              orderNo: { in: orderNos }
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

  async start(id: string) {
    const task = await this.findTaskOrThrow(id);
    if (task.order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cancelled order cannot start new production task');
    }
    if (task.inventoryBatch) {
      throw new BadRequestException('Production task cannot be started after warehouse receipt');
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
      await this.markOrderInProduction(tx, task.orderId);
      return saved;
    });

    return this.toTask((await this.findTaskOrThrow(updated.id))!);
  }

  async withdraw(id: string, dto: WithdrawProductionTaskDto) {
    const managerName = dto.managerName.trim();
    const reason = dto.reason.trim();
    const handlingMode = dto.handlingMode;
    const handlingQuantity = Number(dto.handlingQuantity);
    const handledAt = dto.handledAt ? new Date(dto.handledAt) : new Date();
    const remark = dto.remark?.trim();
    if (!managerName || !reason) {
      throw new BadRequestException('Manager name and withdraw reason are required');
    }
    if (!['STOCK', 'SCRAP', 'NONE'].includes(handlingMode)) {
      throw new BadRequestException('Withdraw handling mode is required');
    }
    if (!Number.isFinite(handlingQuantity) || handlingQuantity < 0) {
      throw new BadRequestException('Withdraw handling quantity must be greater than or equal to 0');
    }
    if (handlingMode !== 'NONE' && handlingQuantity <= 0) {
      throw new BadRequestException('Withdraw handling quantity is required when parts are moved to stock or scrapped');
    }
    if (handlingMode === 'NONE' && handlingQuantity > 0) {
      throw new BadRequestException('Handling quantity must be 0 when no physical parts are handled');
    }
    if (Number.isNaN(handledAt.getTime())) {
      throw new BadRequestException('Withdraw handled date is invalid');
    }

    const task = await this.findTaskOrThrow(id);
    if (task.inventoryBatch) {
      throw new BadRequestException('Production task cannot be withdrawn after warehouse receipt');
    }

    await this.prisma.$transaction(async (tx) => {
      const childTasks = await tx.productionTask.findMany({
        where: { sourceProductionTaskNo: task.productionTaskNo },
        include: { inventoryBatch: true, processCompletions: true }
      });
      const lockedChild = childTasks.find(
        (child) => child.status !== ProductionStatus.PENDING || child.inventoryBatch || child.processCompletions.length > 0
      );
      if (lockedChild) {
        throw new BadRequestException('Started replenishment task exists and cannot be withdrawn automatically');
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
    });

    return this.toTask((await this.findTaskOrThrow(id))!);
  }

  async complete(id: string, dto: CompleteProductionDto) {
    const task = await this.findTaskOrThrow(id);
    if (task.inventoryBatch) {
      throw new BadRequestException('Production task cannot be changed after warehouse receipt');
    }
    const isFinalCorrection = task.status === ProductionStatus.COMPLETED;
    if (task.status !== ProductionStatus.IN_PROGRESS && !isFinalCorrection) {
      throw new BadRequestException('Production task must be started before completion');
    }

    const stepDetails = processSnapshotToDetails(task.processSnapshot);
    const steps = stepDetails.map((step) => step.processName);
    const plannedQuantity = decimalToNumber(task.plannedQuantity);
    const completedQuantity = dto.completedQuantity ?? plannedQuantity;
    if (completedQuantity <= 0) {
      throw new BadRequestException('Completed quantity must be greater than 0');
    }

    const completionMap = new Map((task.processCompletions || []).map((item: any) => [item.stepNo, item]));
    const finalCompletion = steps.length > 0 ? completionMap.get(steps.length) : null;
    if (steps.length > 0 && !steps.every((_, index) => completionMap.get(index + 1)?.isCompleted)) {
      throw new BadRequestException('All process steps must be confirmed before production completion');
    }

    const finalOperators =
      dto.operatorCodes !== undefined || dto.operatorCode !== undefined
        ? await this.resolveOperatorSnapshot(dto.operatorCodes, dto.operatorCode)
        : await this.resolveOperatorSnapshot(
            finalCompletion?.operatorCode?.split(',').map((code: string) => code.trim()).filter(Boolean),
            undefined
          );

    // 完成生产记录实际完成数，允许超过订单计划数；超出部分由仓库确认入库时转为备货库存。
    // 未入库前允许修正最终确认，入库后禁止改数量，避免库存和生产任务不一致。
    const updated = await this.prisma.$transaction(async (tx) => {
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
      } else if (completedQuantity < plannedQuantity) {
        throw new BadRequestException('Completed quantity cannot be less than planned quantity');
      }

      const saved = await tx.productionTask.update({
        where: { id },
        data: {
          status: ProductionStatus.COMPLETED,
          completedQuantity,
          startedAt: task.startedAt || new Date(),
          completedAt: isFinalCorrection ? task.completedAt || new Date() : new Date(),
          remark: dto.remark
        }
      });

      // 订单不能在生产完成时直接完成，必须经过仓库入库和发货后才允许进入 COMPLETED。
      await this.markOrderInProduction(tx, task.orderId);

      if (steps.length === 0) {
        await this.markAllProcessStepsCompleted(tx, task, completedQuantity, dto.remark);
      }

      return saved;
    });

    return this.toTask((await this.findTaskOrThrow(updated.id))!);
  }

  async completeProcessStep(id: string, dto: CompleteProcessStepDto) {
    const task = await this.findTaskOrThrow(id);
    if (task.inventoryBatch) {
      throw new BadRequestException('Production process cannot be changed after warehouse receipt');
    }
    const stepDetails = processSnapshotToDetails(task.processSnapshot);
    const steps = stepDetails.map((step) => step.processName);
    const stepIndex = steps.findIndex((step) => step === dto.processName);
    if (stepIndex < 0) {
      throw new BadRequestException('Process step does not belong to this production task');
    }
    if (task.status === ProductionStatus.PENDING) {
      throw new BadRequestException('Production task must be started before process completion');
    }
    if (task.status === ProductionStatus.COMPLETED && !dto.isCompleted) {
      throw new BadRequestException('Completed production process cannot be marked incomplete');
    }

    if (dto.isCompleted && !dto.completedQuantity) {
      throw new BadRequestException('Completed quantity is required');
    }
    const operators = await this.resolveOperatorSnapshot(dto.operatorCodes, dto.operatorCode);

    const stepNo = stepIndex + 1;
    const processRemark = stepDetails[stepIndex]?.processRemark || null;
    const completedQuantity = dto.isCompleted ? Number(dto.completedQuantity) : 0;
    if (dto.isCompleted && completedQuantity <= 0) {
      throw new BadRequestException('Completed quantity must be greater than 0');
    }

    await this.prisma.$transaction(async (tx) => {
      const completions = await tx.productionProcessCompletion.findMany({
        where: { productionTaskId: task.id }
      });
      const completionMap = new Map(completions.map((item) => [item.stepNo, item]));

      // 生产流程必须按已保存的顺序完成，避免跳过前道工序直接把后道工序标绿。
      if (dto.isCompleted && stepNo > 1 && !completionMap.get(stepNo - 1)?.isCompleted) {
        throw new BadRequestException('Previous process step must be completed first');
      }

      if (!dto.isCompleted && completions.some((item) => item.stepNo > stepNo && item.isCompleted)) {
        throw new BadRequestException('Later process step is already completed');
      }

      const existing = await tx.productionProcessCompletion.findUnique({
        where: { productionTaskId_stepNo: { productionTaskId: task.id, stepNo } }
      });
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
    });

    return this.toTask((await this.findTaskOrThrow(id))!);
  }

  async completeProcessSteps(id: string, dto: CompleteProcessStepsDto) {
    const task = await this.findTaskOrThrow(id);
    if (task.inventoryBatch) {
      throw new BadRequestException('Production process cannot be changed after warehouse receipt');
    }
    const stepDetails = processSnapshotToDetails(task.processSnapshot);
    const steps = stepDetails.map((step) => step.processName);
    if (task.status === ProductionStatus.PENDING) {
      throw new BadRequestException('Production task must be started before process completion');
    }

    const completedQuantity = Number(dto.completedQuantity);
    if (completedQuantity <= 0) {
      throw new BadRequestException('Completed quantity must be greater than 0');
    }

    const selectedStepNos = dto.processNames.map((processName) => {
      const stepIndex = steps.findIndex((step) => step === processName.trim());
      if (stepIndex < 0) {
        throw new BadRequestException(`Process step ${processName} does not belong to this production task`);
      }
      return stepIndex + 1;
    });
    const uniqueStepNos = Array.from(new Set(selectedStepNos)).sort((a, b) => a - b);
    if (uniqueStepNos.length === 0) {
      throw new BadRequestException('At least one process step is required');
    }
    for (let index = 1; index < uniqueStepNos.length; index += 1) {
      if (uniqueStepNos[index] !== uniqueStepNos[index - 1] + 1) {
        throw new BadRequestException('Batch completed process steps must be continuous');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const completions = await tx.productionProcessCompletion.findMany({
        where: { productionTaskId: task.id }
      });
      const completionMap = new Map(completions.map((item) => [item.stepNo, item]));
      const selectedStepNoSet = new Set(uniqueStepNos);

      // 批量确认仍必须遵守工艺顺序，只允许连续确认，不能跳过前道工序。
      for (const stepNo of uniqueStepNos) {
        if (stepNo > 1 && !completionMap.get(stepNo - 1)?.isCompleted && !selectedStepNoSet.has(stepNo - 1)) {
          throw new BadRequestException('Previous process step must be completed first');
        }
      }

      for (const stepNo of uniqueStepNos) {
        const processName = steps[stepNo - 1];
        const processRemark = stepDetails[stepNo - 1]?.processRemark || null;
        const operators = await this.resolveOperatorSnapshotForProcess(dto, processName);
        const existing = await tx.productionProcessCompletion.findUnique({
          where: { productionTaskId_stepNo: { productionTaskId: task.id, stepNo } }
        });
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
    });

    return this.toTask((await this.findTaskOrThrow(id))!);
  }

  private taskInclude() {
    return {
      order: true,
      orderLine: true,
      inventoryBatch: true,
      processCompletions: {
        orderBy: { stepNo: 'asc' as const },
        include: {
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
      throw new NotFoundException('Production task not found');
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
        throw new BadRequestException('Quantity override reason is required when completed quantity is greater than previous process quantity');
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
      throw new BadRequestException('Scrap quantity is required when final completed quantity is less than planned quantity');
    }

    const scrapQuantity = Number(dto.scrapQuantity);
    if (!Number.isFinite(scrapQuantity) || scrapQuantity < 0) {
      throw new BadRequestException('Scrap quantity must be greater than or equal to 0');
    }
    if (scrapQuantity > shortageQuantity) {
      throw new BadRequestException('Scrap quantity cannot be greater than shortage quantity');
    }

    const shortageMode = dto.shortageMode || (dto.createReplenishment ? 'REPLENISHMENT' : undefined);
    if (!shortageMode) {
      throw new BadRequestException('Shortage handling method is required');
    }
    if (shortageMode !== 'REPLENISHMENT' && shortageMode !== 'MANAGER_APPROVED') {
      throw new BadRequestException('Invalid shortage handling method');
    }

    if (existingReplenishmentTaskNo && shortageMode !== 'REPLENISHMENT') {
      throw new BadRequestException('Existing replenishment task cannot be changed to manager approval');
    }

    const managerName = dto.managerName?.trim() || null;
    const shortageReason = dto.shortageReason?.trim() || null;
    if (shortageMode === 'MANAGER_APPROVED' && (!managerName || !shortageReason)) {
      throw new BadRequestException('Manager name and shortage reason are required when no replenishment is created');
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
    existingReplenishmentTaskNo?: string | null
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

    return this.createOrUpdateReplenishmentTask(tx, task, steps, shortageHandling.shortageQuantity, existingReplenishmentTaskNo);
  }

  private async createOrUpdateReplenishmentTask(
    tx: Prisma.TransactionClient,
    task: any,
    steps: ProcessStepSnapshot[],
    plannedQuantity: number,
    existingReplenishmentTaskNo?: string | null
  ) {
    // 补单仍然挂在原订单和零件下，任务号按原任务号追加 R 序号，现场更容易区分来源。
    if (existingReplenishmentTaskNo) {
      const existing = await tx.productionTask.findUnique({
        where: { productionTaskNo: existingReplenishmentTaskNo }
      });
      if (existing) {
        if (existing.status !== ProductionStatus.PENDING) {
          throw new BadRequestException('Existing replenishment task has started and cannot be changed');
        }
        await tx.productionTask.update({
          where: { productionTaskNo: existingReplenishmentTaskNo },
          data: {
            plannedQuantity,
            unit: task.unit,
            processSnapshot: this.processStepsToJson(steps),
            remark: `补单来源：${task.productionTaskNo}`
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
          remark: `补单来源：${task.productionTaskNo}`
        }
      });
      return existingPending.productionTaskNo;
    }

    const existingStarted = await tx.productionTask.findFirst({
      where: {
        orderLineId: task.orderLineId,
        isReplenishment: true,
        sourceProductionTaskNo,
        status: { not: ProductionStatus.PENDING }
      },
      orderBy: { productionTaskNo: 'desc' }
    });
    if (existingStarted) {
      throw new BadRequestException('Existing replenishment task has started and cannot be replaced by a duplicate');
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
        remark: `补单来源：${task.productionTaskNo}`
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
      throw new BadRequestException('Existing replenishment task has records and cannot be removed automatically');
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
    throw new BadRequestException('No available replenishment task number');
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

  private async generateNextNoticeNo(tx: Prisma.TransactionClient) {
    const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PN-${dateKey}-`;
    const lastNotice = await tx.productionNotice.findFirst({
      where: { noticeNo: { startsWith: prefix } },
      orderBy: { noticeNo: 'desc' },
      select: { noticeNo: true }
    });
    const nextSequence = lastNotice ? Number(lastNotice.noticeNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(nextSequence).padStart(4, '0')}`;
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

  private toEffectiveTaskCompletedQuantity(task: any, stockQuantity = 0, orderReceiptQuantity = 0) {
    const completedQuantity = decimalToNumber(task.completedQuantity);
    if (completedQuantity > 0) {
      return completedQuantity;
    }
    // 生产统计不能只依赖旧 completedQuantity；已入库历史任务用订单入库批次和转库存批次数量兜底。
    const orderInventoryQuantity = orderReceiptQuantity || (task.inventoryBatch ? decimalToNumber(task.inventoryBatch.quantity) : 0);
    return orderInventoryQuantity + stockQuantity;
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
      managerName: completion.managerName,
      shortageReason: completion.shortageReason,
      unit: completion.unit,
      operatorCode: completion.operatorCode,
      operatorName: completion.operatorName,
      operatorRole: completion.operatorRole,
      completedAt: completion.completedAt ? new Date(completion.completedAt).toISOString() : null,
      quantityOverrideReason: completion.quantityOverrideReason,
      remark: completion.remark
    };
  }

  private toNotice(notice: any) {
    return {
      id: notice.id,
      noticeNo: notice.noticeNo,
      noticeType: notice.noticeType,
      status: notice.status,
      target: notice.target,
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

  private toTask(task: any) {
    const stepDetails = processSnapshotToDetails(task.processSnapshot);
    const steps = stepDetails.map((step) => step.processName);
    const completionMap = new Map((task.processCompletions || []).map((item: any) => [item.stepNo, item]));
    const effectiveCompletedQuantity = this.toEffectiveTaskCompletedQuantity(task);
    const isImplicitlyCompleted = Boolean(task.inventoryBatch) || task.status === ProductionStatus.COMPLETED;
    return {
      id: task.id,
      productionTaskNo: task.productionTaskNo,
      orderId: task.orderId,
      orderNo: task.orderNo,
      isReplenishment: task.isReplenishment,
      sourceProductionTaskNo: task.sourceProductionTaskNo,
      customerId: task.order?.customerId,
      customerName: task.customerName,
      orderDate: task.order?.orderDate,
      deliveryDate: task.orderLine?.deliveryDate || task.order?.deliveryDate,
      partCode: task.partCode,
      partName: task.partName,
      drawingNo: task.orderLine?.drawingNo,
      drawingVersion: task.orderLine?.drawingVersion,
      drawingFileName: task.orderLine?.drawingFileName,
      drawingFileUrl: task.orderLine?.drawingFileUrl,
      partThickness: decimalToNumber(task.orderLine?.partThickness),
      partSpecification: task.orderLine?.partSpecification,
      customerOrderQuantity: decimalToNumber(task.orderLine?.quantity ?? task.plannedQuantity),
      plannedQuantity: decimalToNumber(task.plannedQuantity),
      completedQuantity: effectiveCompletedQuantity,
      unit: task.unit,
      status: task.status,
      inventoryBatchNo: task.inventoryBatch?.batchNo,
      inventoryStatus: task.inventoryBatch?.status,
      processSteps: steps,
      processStepDetails: stepDetails,
      processCompletions: steps.map((processName, index) => {
        const stepNo = index + 1;
        const completion = completionMap.get(stepNo) as any;
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
          managerName: completion?.managerName,
          shortageReason: completion?.shortageReason,
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
}
