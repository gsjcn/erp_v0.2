import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CommonStatus,
  InventoryReservationStatus,
  InventoryTransactionType,
  OrderLineFulfillmentMode,
  OrderStatus,
  Prisma,
  ProductionNoticeStatus,
  ProductionNoticeTarget,
  ProductionStatus
} from '@prisma/client';
import {
  decimalToNumber,
  processSnapshotToArray,
  processSnapshotToDetails,
  type ProcessStepSnapshot
} from '../../common/serializers';
import { buildPinyinSearchText, normalizeSearchKeyword } from '../../common/pinyin-search';
import { runSerializableTransaction } from '../../common/transactions';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcessDefinitionsService } from '../process-definitions/process-definitions.service';
import {
  CancelOrderDto,
  CancelReplenishmentDto,
  CancelStartedOrderDto,
  CreateAdditionalMaterialDto,
  CreateLineReplenishmentDto,
  CreateOrderLineDto,
  CreateOrderDto,
  NextOrderNoQueryDto,
  OrderQueryDto,
  ResolveLineShortageDto,
  SubmitOrderDto,
  UpdateLineProcessDto,
  UpdateLineQuantityDto,
  UpdateOrderDto
} from './dto';
import { randomUUID } from 'node:crypto';

type NormalizedCancelHandlingPlanItem = {
  orderLineId: string;
  productionTaskNo: string;
  handlingMode: 'STOCK' | 'SCRAP' | 'NONE';
  handlingQuantity: number;
  remark?: string;
};

type SubmitPlanOperator = {
  accountId: string;
  name: string;
  role: string;
};

type PreparedOrderLinePlan = {
  productionPlanQuantity: number;
  productionPlanSuggestedQuantity: number;
  productionPlanOverrideByCode?: string | null;
  productionPlanOverrideByName?: string | null;
  productionPlanOverrideByRole?: string | null;
  productionPlanOverrideAt?: Date | null;
  productionPlanOverrideReason?: string | null;
};

type InventoryReservationCarryover = {
  quantity: number;
  createdAt: Date;
};

type StockReservationPriorityOrder = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  createdAt: Date;
};

const fallbackSubmitPlanOperators: SubmitPlanOperator[] = [
  {
    accountId: 'PLAN-001',
    name: '刘计划',
    role: '生产计划员'
  },
  {
    accountId: 'ORDER-001',
    name: '孙下单',
    role: '下单管理员'
  },
  {
    accountId: 'WS-001',
    name: '陈主任',
    role: '车间主任'
  },
  {
    accountId: 'TECH-001',
    name: '王工艺',
    role: '技术工艺员'
  }
];

const orderProductionFilterStatuses = [
  'ORDER_DRAFT',
  'WAITING_PRODUCTION',
  'ORDER_IN_PRODUCTION',
  'ORDER_COMPLETED_UNSHIPPED',
  'PARTIAL_SHIPPED',
  'ORDER_SHIPPED_COMPLETED',
  'ORDER_CANCELLED',
  ProductionStatus.PENDING,
  ProductionStatus.IN_PROGRESS,
  ProductionStatus.COMPLETED
] as const;

type OrderProductionFilterStatus = (typeof orderProductionFilterStatuses)[number];

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processDefinitionsService: ProcessDefinitionsService
  ) {}

  async findAll(query: OrderQueryDto) {
    const where: Prisma.CustomerOrderWhereInput = {};
    const orderStatuses = this.parseEnumList<OrderStatus>(
      query.statuses,
      Object.values(OrderStatus) as OrderStatus[],
      '订单状态'
    );
    const productionStatuses = this.parseEnumList<OrderProductionFilterStatus>(
      query.productionStatuses,
      [...orderProductionFilterStatuses],
      '生产状态'
    );

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (orderStatuses.length > 0) {
      where.status = { in: orderStatuses };
    } else if (query.status) {
      where.status = query.status;
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
      where.orderDate = orderDate;
    }

    const orders = await this.prisma.customerOrder.findMany({
      where,
      include: {
        lines: {
          include: {
            inventoryTransactions: {
              where: { transactionType: InventoryTransactionType.OUT, sourceRecordType: 'InventoryBatch' },
              select: { id: true, transactionType: true, sourceRecordType: true, orderNo: true, quantity: true, unit: true }
            },
            inventoryBatches: {
              include: { transactions: true }
            }
          }
        },
        productionTasks: {
          include: {
            inventoryBatch: true,
            processCompletions: {
              include: {
                replenishmentRequests: {
                  orderBy: { createdAt: 'desc' }
                }
              }
            }
          }
        },
        inventoryBatches: {
          include: { transactions: true }
        }
      },
      orderBy: [{ orderDate: 'desc' }, { orderNo: 'desc' }]
    });

    const summaries = orders.map((order) => this.toSummary(order));
    if (productionStatuses.length === 0) {
      return summaries;
    }

    return summaries.filter((order) => this.orderMatchesProductionFilter(order, productionStatuses));
  }

  async findOne(orderNo: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
      include: {
        customer: true,
        inventoryBatches: {
          include: { transactions: true }
        },
        productionTasks: {
          include: {
            inventoryBatch: true,
            processCompletions: {
              include: {
                replenishmentRequests: {
                  orderBy: { createdAt: 'desc' }
                }
              }
            }
          }
        },
        lines: {
          include: {
            processSteps: { orderBy: { stepNo: 'asc' } },
            inventoryTransactions: {
              where: { transactionType: InventoryTransactionType.OUT, sourceRecordType: 'InventoryBatch' },
              select: { id: true, transactionType: true, sourceRecordType: true, orderNo: true, quantity: true, unit: true }
            },
            inventoryBatches: {
              include: { warehouse: true, location: true, transactions: true },
              orderBy: { createdAt: 'asc' }
            },
            productionTasks: {
              include: {
                inventoryBatch: {
                  include: { warehouse: true, location: true }
                },
                processCompletions: {
                  include: {
                    replenishmentRequests: {
                      orderBy: { createdAt: 'desc' }
                    }
                  },
                  orderBy: { stepNo: 'asc' }
                }
              },
              orderBy: { productionTaskNo: 'asc' }
            }
          },
          orderBy: { lineNo: 'asc' }
        }
      }
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const taskNos = order.lines.flatMap((line) => line.productionTasks.map((task) => task.productionTaskNo));
    const stockQuantityByTaskNo = await this.getStockQuantityByTaskNo(taskNos);
    const selectedStockBatchIds = order.lines.flatMap((line) =>
      this.jsonToStockSourceSelections(line.stockSourceSelections).map((source) => source.batchId)
    );
    const stockSourceInfoByBatchId = await this.getStockSourceInfoByBatchId(selectedStockBatchIds, order.id);
    return this.toDetail(order, stockQuantityByTaskNo, stockSourceInfoByBatchId);
  }

  async nextOrderNo(query: NextOrderNoQueryDto) {
    const orderDate = query.orderDate ? new Date(query.orderDate) : new Date();
    return { orderNo: await this.generateOrderNo(orderDate) };
  }

  async checkOrderNo(orderNo: string, excludeOrderNo?: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const exists = await this.orderNoExists(normalizedOrderNo, excludeOrderNo);
    return {
      orderNo: normalizedOrderNo,
      exists,
      available: !exists
    };
  }

  async findDuplicateDrawingNos(value: string, excludeOrderNo?: string) {
    return this.findDuplicateOrderLines('drawingNo', value, excludeOrderNo);
  }

  async findDuplicateDrawingFiles(value: string, excludeOrderNo?: string) {
    return this.findDuplicateOrderLines('drawingFileName', value, excludeOrderNo);
  }

  async create(dto: CreateOrderDto) {
    this.validateOrderLines(dto.lines, { requireStockSources: false });
    const preparedLinePlans = await this.prepareOrderLinePlans(dto.lines);

    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) {
      throw new NotFoundException('客户不存在');
    }
    if (customer.status !== CommonStatus.ENABLED) {
      throw new BadRequestException('只有启用状态的客户可以创建订单');
    }

    const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date();
    const orderNo = dto.orderNo?.trim() ? this.normalizeOrderNo(dto.orderNo) : await this.generateOrderNo(orderDate);
    await this.ensureOrderNoAvailable(orderNo);
    const normalizedLineSteps = await Promise.all(dto.lines.map((line) => this.normalizeProcessSteps(line.processSteps, false)));

    try {
      const created = await runSerializableTransaction(this.prisma, async (tx) => {
        // 草稿保存也会形成库存预占，库存来源必须在同一个 Serializable 事务内按最新库存复核。
        await this.validateOrderStockSourceSelections(dto.lines, undefined, tx);
        await this.reserveOrderNo(tx, orderNo, undefined, 'ORDER_CREATED');
        await this.upsertMaterials(tx, dto.lines);
        const createdOrder = await tx.customerOrder.create({
          data: {
            orderNo,
            customerId: customer.id,
            customerCode: customer.customerCode,
            customerName: customer.customerName,
            customerSnapshot: {
              customerCode: customer.customerCode,
              customerName: customer.customerName,
              contactName: customer.contactName,
              contactPhone: customer.contactPhone
            },
            orderDate,
            deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
            remark: dto.remark,
            status: OrderStatus.DRAFT,
            lines: {
              create: dto.lines.map((line, index) => ({
                lineNo: index + 1,
                partCode: line.partCode.trim(),
                partName: line.partName.trim(),
                drawingNo: line.drawingNo?.trim(),
                drawingVersion: line.drawingVersion?.trim(),
                drawingFileName: line.drawingFileName?.trim(),
                drawingFileUrl: line.drawingFileUrl?.trim(),
                partThickness: line.partThickness,
                partSpecification: line.partSpecification?.trim(),
                quantity: line.quantity,
                ...this.orderLinePlanData(preparedLinePlans[index]),
                fulfillmentMode: this.normalizeFulfillmentMode(line.fulfillmentMode),
                unit: line.unit.trim(),
                deliveryDate: line.deliveryDate ? new Date(line.deliveryDate) : dto.deliveryDate ? new Date(dto.deliveryDate) : null,
                remark: line.remark,
                processSnapshot: this.processStepsToJson(normalizedLineSteps[index]),
                stockSourceSelections: this.stockSourceSelectionsToJson(line.selectedStockSources),
                processSteps: {
                  create: normalizedLineSteps[index].map((processStep, stepIndex) => ({
                    stepNo: stepIndex + 1,
                    processName: processStep.processName,
                    processRemark: processStep.processRemark
                  }))
                }
              }))
            }
          },
          include: {
            customer: true,
            inventoryBatches: true,
            lines: {
              include: {
                processSteps: { orderBy: { stepNo: 'asc' } },
                inventoryBatches: {
                  include: { warehouse: true, location: true },
                  orderBy: { createdAt: 'asc' }
                },
                productionTasks: {
                  include: {
                    inventoryBatch: {
                      include: { warehouse: true, location: true }
                    }
                  },
                  orderBy: { productionTaskNo: 'asc' }
                }
              },
              orderBy: { lineNo: 'asc' }
            }
          }
        });
        await this.linkOrderNoReservation(tx, orderNo, createdOrder.id, 'ORDER_CREATED');
        await this.syncOrderInventoryReservations(tx, createdOrder.id);
        return createdOrder;
      }, '库存正在被其他订单占用，请刷新库存后重新保存订单');

      return this.findOne(created.orderNo);
    } catch (error) {
      if (this.isDuplicateOrderNoError(error)) {
        throw new BadRequestException(`订单号 ${orderNo} 已存在，请修改后再保存`);
      }
      throw error;
    }
  }

  async update(orderNo: string, dto: UpdateOrderDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('只有待提交生产订单可以编辑');
    }

    this.validateOrderLines(dto.lines, { requireStockSources: false });
    const preparedLinePlans = await this.prepareOrderLinePlans(dto.lines);
    const nextOrderNo = dto.orderNo?.trim() ? this.normalizeOrderNo(dto.orderNo) : order.orderNo;
    if (nextOrderNo !== order.orderNo) {
      await this.ensureOrderNoAvailable(nextOrderNo, order.orderNo);
    }
    const normalizedLineSteps = await Promise.all(dto.lines.map((line) => this.normalizeProcessSteps(line.processSteps, false)));

    // DRAFT 订单还没有进入生产，允许修改订单号和整体替换订单零件，保持订单总表和明细表边界清晰。
    try {
      const updated = await runSerializableTransaction(this.prisma, async (tx) => {
        // 编辑草稿时先在事务内复核库存来源，再替换订单零件和同步 ACTIVE 预占。
        await this.validateOrderStockSourceSelections(dto.lines, order, tx);
        if (nextOrderNo !== order.orderNo) {
          await this.reserveOrderNo(tx, nextOrderNo, order.id, 'DRAFT_ORDER_RENUMBERED');
        } else {
          await this.linkOrderNoReservation(tx, nextOrderNo, order.id, 'ORDER_CREATED');
        }
        const reservationCarryovers = await this.findOrderReservationCarryovers(tx, order.id);
        await this.upsertMaterials(tx, dto.lines);
        await tx.orderLine.deleteMany({ where: { orderId: order.id } });
        const updatedOrder = await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            orderNo: nextOrderNo,
            deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
            remark: dto.remark,
            lines: {
              create: dto.lines.map((line, index) => ({
                lineNo: index + 1,
                partCode: line.partCode.trim(),
                partName: line.partName.trim(),
                drawingNo: line.drawingNo?.trim(),
                drawingVersion: line.drawingVersion?.trim(),
                drawingFileName: line.drawingFileName?.trim(),
                drawingFileUrl: line.drawingFileUrl?.trim(),
                partThickness: line.partThickness,
                partSpecification: line.partSpecification?.trim(),
                quantity: line.quantity,
                ...this.orderLinePlanData(preparedLinePlans[index]),
                fulfillmentMode: this.normalizeFulfillmentMode(line.fulfillmentMode),
                unit: line.unit.trim(),
                deliveryDate: line.deliveryDate ? new Date(line.deliveryDate) : dto.deliveryDate ? new Date(dto.deliveryDate) : null,
                remark: line.remark,
                processSnapshot: this.processStepsToJson(normalizedLineSteps[index]),
                stockSourceSelections: this.stockSourceSelectionsToJson(line.selectedStockSources),
                processSteps: {
                  create: normalizedLineSteps[index].map((processStep, stepIndex) => ({
                    stepNo: stepIndex + 1,
                    processName: processStep.processName,
                    processRemark: processStep.processRemark
                  }))
                }
              }))
            }
          },
          include: {
            customer: true,
            inventoryBatches: true,
            lines: {
              include: {
                processSteps: { orderBy: { stepNo: 'asc' } },
                inventoryBatches: {
                  include: { warehouse: true, location: true },
                  orderBy: { createdAt: 'asc' }
                },
                productionTasks: {
                  include: {
                    inventoryBatch: {
                      include: { warehouse: true, location: true }
                    }
                  },
                  orderBy: { productionTaskNo: 'asc' }
                }
              },
              orderBy: { lineNo: 'asc' }
            }
          }
        });
        await this.syncOrderInventoryReservations(tx, updatedOrder.id, reservationCarryovers);
        return updatedOrder;
      }, '库存正在被其他订单占用，请刷新库存后重新保存订单');

      return this.findOne(updated.orderNo);
    } catch (error) {
      if (this.isDuplicateOrderNoError(error)) {
        throw new BadRequestException(`订单号 ${nextOrderNo} 已存在，请修改后再保存`);
      }
      throw error;
    }
  }

  async updateLineProcess(orderNo: string, lineId: string, dto: UpdateLineProcessDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('只有待提交生产订单可以修改生产流程');
    }

    const line = await this.prisma.orderLine.findFirst({ where: { id: lineId, orderId: order.id } });
    if (!line) {
      throw new NotFoundException('订单零件不存在');
    }
    if (
      line.fulfillmentMode === OrderLineFulfillmentMode.STOCK &&
      decimalToNumber(line.productionPlanQuantity) <= 0
    ) {
      throw new BadRequestException('该零件已全量使用库存，不需要设置生产流程');
    }
    const steps = await this.normalizeProcessSteps(dto.steps, true);
    const processEditor = await this.resolveProcessEditorOperator(dto.configuredByCode);

    // 保存某个订单零件的独立生产流程，并同步未完成的生产任务快照。
    await this.prisma.$transaction(async (tx) => {
      await tx.orderLineProcessStep.deleteMany({ where: { orderLineId: lineId } });
      if (steps.length > 0) {
        await tx.orderLineProcessStep.createMany({
          data: steps.map((processStep, index) => ({
            orderLineId: lineId,
            stepNo: index + 1,
            processName: processStep.processName,
            processRemark: processStep.processRemark
          }))
        });
      }
      await tx.orderLine.update({
        where: { id: lineId },
        data: { processSnapshot: this.processStepsToJson(steps) }
      });
      await tx.customerOrder.update({
        where: { id: order.id },
        data: {
          remark: this.appendOrderRemark(
            order.remark,
            `生产流程填写：${processEditor.name}（${processEditor.accountId} / ${processEditor.role}），零件 ${line.partCode}`
          )
        }
      });
      await tx.productionTask.updateMany({
        where: { orderLineId: lineId, status: { not: 'COMPLETED' } },
        data: { processSnapshot: this.processStepsToJson(steps) }
      });
    });

    return this.findOne(order.orderNo);
  }

  async createLineReplenishment(orderNo: string, lineId: string, dto: CreateLineReplenishmentDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const { order, line, baseTask } = await this.findStartedOrderLineTask(tx, normalizedOrderNo, lineId);
        this.assertOrderAcceptsProductionChange(order);
        const quantity = this.normalizeQuantity(dto.quantity, '补单数量');
        const reason = dto.reason.trim();
        if (!reason) {
          throw new BadRequestException('补单原因不能为空');
        }

        const taskNo = await this.createReplenishmentTaskForLine(tx, order, line, baseTask, quantity, reason);
        const progressText = await this.describeOrderProductionProgress(tx, order.id);
        await this.createProductionNotice(tx, {
          noticeType: 'QUANTITY_INCREASE',
          target: ProductionNoticeTarget.PRODUCTION,
          order,
          line,
          productionTaskNo: taskNo,
          beforeQuantity: decimalToNumber(line.quantity),
          afterQuantity: this.roundQuantity(decimalToNumber(line.quantity) + quantity),
          deltaQuantity: quantity,
          reason: `补单：${reason}。${progressText}`,
          managerName: dto.managerName?.trim()
        });
        await this.markLineShortagesResolved(
          tx,
          line.id,
          quantity,
          'ORDER_REPLENISHMENT',
          dto.managerName?.trim() || '订单补单',
          `已创建订单补单 ${taskNo}：${reason}`
        );
      },
      '当前订单生产任务正在被其他操作修改，请刷新后重新创建补单'
    );

    return this.findOne(normalizedOrderNo);
  }

  async resolveLineShortage(orderNo: string, lineId: string, dto: ResolveLineShortageDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const { order, line } = await this.findStartedOrderLineTask(tx, normalizedOrderNo, lineId);
        this.assertOrderAcceptsProductionChange(order);
        const managerName = dto.managerName.trim();
        const reason = dto.reason.trim();
        if (!managerName) {
          throw new BadRequestException('处理人员不能为空');
        }
        if (!reason) {
          throw new BadRequestException('无需补单说明不能为空');
        }
        const resolvedCount = await this.markLineShortagesResolved(
          tx,
          line.id,
          undefined,
          dto.resolutionMode,
          managerName,
          reason
        );
        if (resolvedCount === 0) {
          throw new BadRequestException('当前零件没有待处理的管理确认短缺');
        }
        await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            remark: this.appendOrderRemark(
              order.remark,
              `短缺无需补单确认：${managerName}，零件 ${line.partCode} / ${line.partName}，说明：${reason}`
            )
          }
        });
      },
      '当前订单短缺处理正在被其他操作修改，请刷新后重试'
    );

    return this.findOne(normalizedOrderNo);
  }

  async cancelReplenishment(orderNo: string, productionTaskNo: string, dto: CancelReplenishmentDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const normalizedTaskNo = productionTaskNo.trim().toUpperCase();
    if (!normalizedTaskNo) {
      throw new BadRequestException('生产任务号不能为空');
    }

    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
      const task = await tx.productionTask.findFirst({
        where: {
          productionTaskNo: { equals: normalizedTaskNo, mode: 'insensitive' },
          orderNo: { equals: normalizedOrderNo, mode: 'insensitive' }
        },
        include: {
          order: true,
          orderLine: {
            include: {
              productionTasks: { include: { processCompletions: true } },
              inventoryBatches: true
            }
          },
          processCompletions: true,
          inventoryBatch: true
        }
      });
      if (!task) {
        throw new NotFoundException('补单任务不存在');
      }
      if (!task.isReplenishment) {
        throw new BadRequestException('这里只能取消补单任务');
      }
      if (task.order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('订单已经取消');
      }
      if (task.order.status === OrderStatus.COMPLETED) {
        throw new BadRequestException('已完成订单不能取消补单');
      }
      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('取消原因不能为空');
      }
      const managerName = dto.managerName?.trim();
      if (!managerName) {
        throw new BadRequestException('管理人员姓名不能为空');
      }
      if (task.inventoryBatch) {
        throw new BadRequestException('补单任务已入库，不能取消');
      }
      if (this.isStartedProductionTask(task)) {
        throw new BadRequestException('已开始生产的补单不能直接取消，请走生产撤回流程');
      }

      const onlyThisTaskOnLine = task.orderLine.productionTasks.length === 1;
      const hasLineInventory = task.orderLine.inventoryBatches.length > 0;

      // 未开始的补单可以取消；已经发到生产端的待确认通知必须同步清理，避免现场继续按旧补单开工。
      await tx.productionNotice.deleteMany({
        where: {
          status: ProductionNoticeStatus.PENDING,
          orderNo: { equals: normalizedOrderNo, mode: 'insensitive' },
          productionTaskNo: { equals: task.productionTaskNo, mode: 'insensitive' }
        }
      });
      await tx.productionTask.delete({ where: { id: task.id } });

      if (onlyThisTaskOnLine && !hasLineInventory && task.sourceProductionTaskNo === null) {
        await tx.orderLine.delete({ where: { id: task.orderLineId } });
      }

      await tx.customerOrder.update({
        where: { id: task.orderId },
        data: {
          remark: this.appendRemark(
            task.order.remark,
            `取消补单 ${task.productionTaskNo}：${reason}（管理人员：${managerName}）`
          )
        }
      });
      },
      '当前补单任务正在被其他操作修改，请刷新后重新取消补单'
    );

    return this.findOne(normalizedOrderNo);
  }

  async createAdditionalMaterial(orderNo: string, dto: CreateAdditionalMaterialDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
      const order = await tx.customerOrder.findFirst({
        where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
        include: {
          lines: { orderBy: { lineNo: 'asc' } },
          productionTasks: {
            include: { processCompletions: true },
            orderBy: { productionTaskNo: 'asc' }
          }
        }
      });
      if (!order) {
        throw new NotFoundException('订单不存在');
      }
      if (order.status === OrderStatus.DRAFT) {
        throw new BadRequestException('待提交生产订单请直接编辑订单，不要创建补单物料');
      }
      this.assertOrderAcceptsProductionChange(order);
      const startedTask = order.productionTasks.find((task) => this.isStartedProductionTask(task));
      if (!startedTask) {
        throw new BadRequestException('订单尚未开始生产，不能新增补单物料，请直接修改订单');
      }

      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('新增补单物料原因不能为空');
      }
      const fulfillmentMode = this.normalizeFulfillmentMode(dto.fulfillmentMode);
      if (fulfillmentMode !== OrderLineFulfillmentMode.PRODUCTION) {
        throw new BadRequestException('新增补单物料必须使用重新生产方式');
      }
      const steps = await this.normalizeProcessSteps(dto.processSteps, true);
      this.validateSingleOrderLine(dto);
      const linePlan = await this.prepareOrderLinePlan(dto, '新增补单物料');
      if (linePlan.productionPlanQuantity <= 0) {
        throw new BadRequestException('新增补单物料生产计划数量必须大于 0');
      }
      await this.upsertMaterials(tx, [dto]);

      const lineNo = Math.max(0, ...order.lines.map((line) => line.lineNo)) + 1;
      const productionTaskNo = `PT-${order.orderNo}-${String(lineNo).padStart(3, '0')}`;
      const line = await tx.orderLine.create({
        data: {
          orderId: order.id,
          lineNo,
          partCode: dto.partCode.trim(),
          partName: dto.partName.trim(),
          drawingNo: dto.drawingNo?.trim(),
          drawingVersion: dto.drawingVersion?.trim(),
          drawingFileName: dto.drawingFileName?.trim(),
          drawingFileUrl: dto.drawingFileUrl?.trim(),
          partThickness: dto.partThickness,
          partSpecification: dto.partSpecification?.trim(),
          quantity: dto.quantity,
          ...this.orderLinePlanData(linePlan),
          fulfillmentMode,
          unit: dto.unit.trim(),
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : order.deliveryDate,
          remark: dto.remark,
          processSnapshot: this.processStepsToJson(steps),
          processSteps: {
            create: steps.map((processStep, stepIndex) => ({
              stepNo: stepIndex + 1,
              processName: processStep.processName,
              processRemark: processStep.processRemark
            }))
          }
        },
        include: { processSteps: { orderBy: { stepNo: 'asc' } } }
      });

      await tx.productionTask.create({
        data: {
          productionTaskNo,
          orderId: order.id,
          orderLineId: line.id,
          orderNo: order.orderNo,
          customerName: order.customerName,
          partCode: line.partCode,
          partName: line.partName,
          plannedQuantity: line.productionPlanQuantity,
          unit: line.unit,
          processSnapshot: this.processStepsToJson(steps),
          status: ProductionStatus.PENDING,
          isReplenishment: true,
          replenishmentSourceType: 'ORDER_CHANGE',
          replenishmentSourceRequestNo: order.orderNo,
          remark: `客户新增物料：${reason}`
        }
      });

      const progressText = await this.describeOrderProductionProgress(tx, order.id);
      await this.createProductionNotice(tx, {
        noticeType: 'MATERIAL_ADDED',
        target: ProductionNoticeTarget.PRODUCTION,
        order,
        line,
        productionTaskNo,
        beforeQuantity: 0,
        afterQuantity: decimalToNumber(line.quantity),
        deltaQuantity: decimalToNumber(line.quantity),
        reason: `客户新增物料：${reason}。${progressText}`,
        managerName: dto.managerName?.trim()
      });
      },
      '当前订单生产任务正在被其他操作修改，请刷新后重新新增补单物料'
    );

    return this.findOne(normalizedOrderNo);
  }

  async updateLineQuantityAfterProductionStarted(orderNo: string, lineId: string, dto: UpdateLineQuantityDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
      const { order, line, baseTask } = await this.findStartedOrderLineTask(tx, normalizedOrderNo, lineId);
      this.assertOrderAcceptsProductionChange(order);
      const oldQuantity = decimalToNumber(line.quantity);
      const nextQuantity = this.normalizeQuantity(dto.quantity, '客户订单数量', true);
      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('生产数量变更原因不能为空');
      }
      if (oldQuantity === nextQuantity) {
        throw new BadRequestException('数量没有变化');
      }

      const deltaQuantity = this.roundQuantity(nextQuantity - oldQuantity);
      const currentPlanQuantity = decimalToNumber(line.productionPlanQuantity);
      const nextPlanQuantity =
        dto.productionPlanQuantity !== undefined
          ? this.normalizeQuantity(dto.productionPlanQuantity, '生产计划数量', true)
          : deltaQuantity > 0
            ? this.roundQuantity(currentPlanQuantity + deltaQuantity)
            : Math.max(currentPlanQuantity, nextQuantity);
      const suggestedPlanQuantity = this.resolveSuggestedProductionPlanQuantity({
        fulfillmentMode: line.fulfillmentMode,
        quantity: nextQuantity,
        stockSourceSelections: line.stockSourceSelections
      });
      const planDiffersFromSuggestion = Math.abs(nextPlanQuantity - suggestedPlanQuantity) > 0.0001;
      const planOverrideReason = dto.productionPlanOverrideReason?.trim() || reason;
      const planOverrideOperator = planDiffersFromSuggestion
        ? await this.resolveSubmitPlanOperator(dto.productionPlanOverrideByCode || '', '生产计划调整操作员')
        : undefined;

      await tx.orderLine.update({
        where: { id: line.id },
        data: {
          quantity: nextQuantity,
          productionPlanQuantity: nextPlanQuantity,
          productionPlanSuggestedQuantity: suggestedPlanQuantity,
          productionPlanOverrideByCode: planOverrideOperator?.accountId ?? null,
          productionPlanOverrideByName: planOverrideOperator?.name ?? null,
          productionPlanOverrideByRole: planOverrideOperator?.role ?? null,
          productionPlanOverrideAt: planDiffersFromSuggestion ? new Date() : null,
          productionPlanOverrideReason: planDiffersFromSuggestion ? planOverrideReason : null
        }
      });

      let replenishmentTaskNo: string | undefined;
      if (deltaQuantity > 0) {
        replenishmentTaskNo = await this.createReplenishmentTaskForLine(
          tx,
          order,
          line,
          baseTask,
          deltaQuantity,
          `客户数量增加：${reason}`
        );
      }

      const progressText = await this.describeOrderProductionProgress(tx, order.id);
      const noticeType =
        nextQuantity === 0 ? 'ORDER_CANCELLED' : deltaQuantity > 0 ? 'QUANTITY_INCREASE' : 'QUANTITY_DECREASE';
      const noticeReason =
        deltaQuantity > 0
          ? `客户要求增加 ${Math.abs(deltaQuantity)} ${line.unit}：${reason}。${progressText}`
          : nextQuantity === 0
            ? `客户取消该物料：${reason}。${progressText}。请管理人员确认已生产物料转库存或销毁处理，并同步仓库。`
            : `客户要求减少 ${Math.abs(deltaQuantity)} ${line.unit}：${reason}。${progressText}。请管理人员确认已生产多余物料转库存或销毁处理，并同步仓库。`;
      const planOverrideText = planDiffersFromSuggestion
        ? ` 生产计划调整：建议 ${suggestedPlanQuantity} ${line.unit}，实际计划 ${nextPlanQuantity} ${line.unit}，操作人员 ${planOverrideOperator?.name}（${planOverrideOperator?.accountId} / ${planOverrideOperator?.role}），说明：${planOverrideReason}。`
        : '';

      await this.createProductionNotice(tx, {
        noticeType,
        target: ProductionNoticeTarget.PRODUCTION,
        order,
        line,
        productionTaskNo: replenishmentTaskNo || baseTask.productionTaskNo,
        beforeQuantity: oldQuantity,
        afterQuantity: nextQuantity,
        deltaQuantity,
        reason: `${noticeReason}${planOverrideText}`,
        managerName: dto.managerName?.trim()
      });

      if (noticeType === 'QUANTITY_DECREASE' || noticeType === 'ORDER_CANCELLED') {
        await this.createProductionNotice(tx, {
          noticeType,
          target: ProductionNoticeTarget.WAREHOUSE,
          order,
          line,
          productionTaskNo: baseTask.productionTaskNo,
          beforeQuantity: oldQuantity,
          afterQuantity: nextQuantity,
          deltaQuantity,
          reason: `${noticeReason}${planOverrideText} 仓库需等待管理处理结果；后续如转库存必须按库存批次入库，如销毁不得进入可用库存。`,
          managerName: dto.managerName?.trim()
        });
      }
      if (deltaQuantity < 0) {
        await this.markLineShortagesResolved(
          tx,
          line.id,
          Math.abs(deltaQuantity),
          'CUSTOMER_QUANTITY_CHANGED',
          dto.managerName?.trim() || '客户数量变更',
          `客户数量由 ${oldQuantity} ${line.unit} 调整为 ${nextQuantity} ${line.unit}：${reason}`
        );
      }
      },
      '当前订单生产任务正在被其他操作修改，请刷新后重新变更数量'
    );

    return this.findOne(normalizedOrderNo);
  }

  async cancelOrder(orderNo: string, dto: CancelOrderDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const order = await tx.customerOrder.findFirst({
          where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
          include: {
            lines: {
              include: {
                inventoryBatches: true,
                processSteps: { orderBy: { stepNo: 'asc' } },
                productionTasks: {
                  include: { processCompletions: true, inventoryBatch: true },
                  orderBy: { productionTaskNo: 'asc' }
                }
              },
              orderBy: { lineNo: 'asc' }
            },
            productionTasks: {
              include: { processCompletions: true, inventoryBatch: true },
              orderBy: { productionTaskNo: 'asc' }
            },
            inventoryBatches: true
          }
        });
        if (!order) {
          throw new NotFoundException('订单不存在');
        }
        if (order.status === OrderStatus.CANCELLED) {
          throw new BadRequestException('订单已经取消');
        }
        if (order.status === OrderStatus.COMPLETED) {
          throw new BadRequestException('已完成订单不能在第一阶段取消');
        }

        const reason = dto.reason.trim();
        if (!reason) {
          throw new BadRequestException('取消原因不能为空');
        }
        const managerName = dto.managerName?.trim();
        if (!managerName) {
          throw new BadRequestException('管理人员姓名不能为空');
        }

        const startedTasks = order.productionTasks.filter((task) => this.isStartedProductionTask(task));
        const productionCancelState =
          dto.productionCancelState || (startedTasks.length > 0 ? 'PRODUCED' : 'NOT_PRODUCED');
        if (productionCancelState === 'NOT_PRODUCED' && startedTasks.length > 0) {
          throw new BadRequestException('订单已经有生产进度，请选择已生产取消');
        }
        if (productionCancelState === 'PRODUCED' && startedTasks.length === 0) {
          throw new BadRequestException('订单没有生产进度，请选择未生产取消');
        }
        const cancelHandlingPlanMap = this.normalizeCancelHandlingPlan(
          dto.handlingPlan,
          startedTasks,
          productionCancelState
        );
        const cancelHandledAt = new Date();
        const orderLineIds = order.lines.map((line) => line.id);
        const shippedTransaction = await tx.inventoryTransaction.findFirst({
          where: {
            transactionType: InventoryTransactionType.OUT,
            sourceRecordType: 'InventoryBatch',
            OR: [
              { batch: { sourceOrderId: order.id } },
              { orderNo: order.orderNo, orderLineId: { in: orderLineIds } }
            ]
          },
          select: { id: true }
        });
        if (shippedTransaction) {
          throw new BadRequestException('订单已有发货库存，不能直接取消');
        }

        const progressText = await this.describeOrderProductionProgress(tx, order.id);
        const noticeReason =
          startedTasks.length > 0
            ? `客户取消整张订单：${reason}。${progressText}。请管理人员确认已生产物料转库存或销毁处理，并同步仓库。`
            : `客户取消整张订单：${reason}。订单尚未开始生产，系统取消未开始任务并释放未发货库存。`;

        // 整单取消会释放订单库存和退回备货库存，必须放在 Serializable 事务内，避免和发货/提交订单并发造成库存账不一致。
        await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
            remark: this.appendRemark(order.remark, `客户取消整单：${reason}（管理人员：${managerName}）`)
          }
        });
        await this.releaseOrderInventoryReservations(tx, order.id, 'ORDER_CANCELLED');

        for (const line of order.lines) {
          const oldQuantity = decimalToNumber(line.quantity);
          const lineStartedTasks = line.productionTasks.filter((task) => this.isStartedProductionTask(task));
          if (lineStartedTasks.length === 0) {
            await this.releaseUnstartedLineStock(tx, order, line, reason);
          }

          if (oldQuantity > 0) {
            await tx.orderLine.update({
              where: { id: line.id },
              data: { quantity: 0 }
            });
          }

          const pendingTaskIds = line.productionTasks
            .filter((task) => !this.isStartedProductionTask(task))
            .map((task) => task.id);
          if (pendingTaskIds.length > 0) {
            await tx.productionNotice.deleteMany({
              where: {
                status: ProductionNoticeStatus.PENDING,
                productionTaskId: { in: pendingTaskIds }
              }
            });
            await tx.productionTask.deleteMany({ where: { id: { in: pendingTaskIds } } });
          }

          for (const task of lineStartedTasks) {
            const taskPlan = cancelHandlingPlanMap.get(task.productionTaskNo.toUpperCase());
            const plannedNoticeReason = taskPlan
              ? `${noticeReason} 取消处理计划：${this.formatCancelHandlingPlan(taskPlan, line.unit)}。`
              : noticeReason;
            const handlingPlanJson = taskPlan
              ? this.cancelHandlingPlanToJson(taskPlan, managerName, cancelHandledAt)
              : undefined;
            await this.createProductionNotice(tx, {
              noticeType: 'ORDER_CANCELLED',
              target: ProductionNoticeTarget.PRODUCTION,
              order,
              line,
              productionTaskId: task.id,
              productionTaskNo: task.productionTaskNo,
              beforeQuantity: oldQuantity,
              afterQuantity: 0,
              deltaQuantity: -oldQuantity,
              reason: plannedNoticeReason,
              managerName,
              handlingPlan: handlingPlanJson
            });
            await this.createProductionNotice(tx, {
              noticeType: 'ORDER_CANCELLED',
              target: ProductionNoticeTarget.WAREHOUSE,
              order,
              line,
              productionTaskId: task.id,
              productionTaskNo: task.productionTaskNo,
              beforeQuantity: oldQuantity,
              afterQuantity: 0,
              deltaQuantity: -oldQuantity,
              reason: `${plannedNoticeReason} 仓库需等待转库存或销毁结果；未确认前不得进入可用库存。`,
              managerName,
              handlingPlan: handlingPlanJson
            });
          }
        }
      },
      '当前订单或库存正在被其他操作修改，请刷新后重新取消订单'
    );

    return this.findOne(normalizedOrderNo);
  }

  async cancelAfterProductionStarted(orderNo: string, dto: CancelStartedOrderDto) {
    return this.cancelOrder(orderNo, dto);
  }

  async submit(orderNo: string, dto: SubmitOrderDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);

    // 提交订单时按零件来源处理：重新生产生成 ProductionTask，使用库存则把备货库存转为订单库存。
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const order = await tx.customerOrder.findFirst({
          where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
          include: {
            lines: {
              include: { processSteps: { orderBy: { stepNo: 'asc' } } },
              orderBy: { lineNo: 'asc' }
            }
          }
        });

        if (!order) {
          throw new NotFoundException('订单不存在');
        }
        if (order.lines.length === 0) {
          throw new BadRequestException('订单至少需要一个零件');
        }
        if (order.status !== OrderStatus.DRAFT) {
          throw new BadRequestException('只有待提交生产订单可以提交生产');
        }
        const submitOperator = await this.resolveSubmitPlanOperatorFromClient(tx, dto.submittedByCode, '下单/计划操作员');
        order.lines.forEach((line, index) => {
          this.validateSingleOrderLine(this.persistedOrderLineToValidationDto(line), `第 ${index + 1} 个零件`, true);
        });
        await this.syncOrderInventoryReservations(tx, order.id);
        const missingStockSourceLine = order.lines.find(
          (line) =>
            (this.normalizeFulfillmentMode(line.fulfillmentMode) === OrderLineFulfillmentMode.STOCK ||
              this.normalizeFulfillmentMode(line.fulfillmentMode) === OrderLineFulfillmentMode.REWORK) &&
            this.selectedStockSourceQuantity(line) <= 0
        );
        if (missingStockSourceLine) {
          const sourceModeText =
            this.normalizeFulfillmentMode(missingStockSourceLine.fulfillmentMode) === OrderLineFulfillmentMode.REWORK ? '库存再加工' : '使用库存';
          throw new BadRequestException(
            `零件 ${missingStockSourceLine.partCode} ${sourceModeText}时必须先选择库存批次并完成来源核对；如不使用库存请改为重新生产`
          );
        }
        const effectivePlanQuantityByLineId = new Map(
          order.lines.map((line) => [line.id, this.resolveSubmittedProductionPlanQuantity(line)])
        );
        const missingPlanOverrideLine = order.lines.find((line) => {
          const effectivePlanQuantity = effectivePlanQuantityByLineId.get(line.id) || 0;
          const suggestedQuantity = this.resolveSuggestedProductionPlanQuantity(line);
          return (
            Math.abs(effectivePlanQuantity - suggestedQuantity) > 0.0001 &&
            !this.hasProductionPlanOverrideRecord(line)
          );
        });
        if (missingPlanOverrideLine) {
          throw new BadRequestException(
            `零件 ${missingPlanOverrideLine.partCode} 生产计划数量与建议数量不一致，必须记录操作人员和调整说明`
          );
        }
        await this.assertSubmittedProductionPlanOverrides(tx, order.lines, effectivePlanQuantityByLineId);
        const insufficientReworkSourceLine = order.lines.find(
          (line) =>
            this.normalizeFulfillmentMode(line.fulfillmentMode) === OrderLineFulfillmentMode.REWORK &&
            this.selectedStockSourceQuantity(line) + 0.0001 < (effectivePlanQuantityByLineId.get(line.id) || 0)
        );
        if (insufficientReworkSourceLine) {
          throw new BadRequestException(
            `零件 ${insufficientReworkSourceLine.partCode} 库存再加工已选库存少于生产计划数量：需要 ${
              effectivePlanQuantityByLineId.get(insufficientReworkSourceLine.id) || 0
            }，已选 ${this.selectedStockSourceQuantity(insufficientReworkSourceLine)}`
          );
        }
        const missingProcessLine = order.lines.find(
          (line) => (effectivePlanQuantityByLineId.get(line.id) || 0) > 0 && line.processSteps.length === 0
        );
        if (missingProcessLine) {
          throw new BadRequestException(`零件 ${missingProcessLine.partCode} 必须先设置生产流程`);
        }

        // 订单提交会占用备货库存或生成生产任务，所有判断必须在事务内基于最新订单状态执行。
        await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.SUBMITTED,
            remark: this.appendOrderRemark(
              order.remark,
              `提交生产：${submitOperator.name}（${submitOperator.accountId} / ${submitOperator.role}）`
            )
          }
        });

        for (const line of order.lines) {
          const steps = this.processRowsToSnapshots(line.processSteps);
          const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
          const effectivePlanQuantity = effectivePlanQuantityByLineId.get(line.id) || 0;
          if (Math.abs(decimalToNumber(line.productionPlanQuantity) - effectivePlanQuantity) > 0.0001) {
            await tx.orderLine.update({
              where: { id: line.id },
              data: { productionPlanQuantity: effectivePlanQuantity }
            });
          }

          if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
            await this.allocateStockToOrderLine(tx, order, line);
          }

          if (fulfillmentMode === OrderLineFulfillmentMode.REWORK) {
            await this.consumeAvailableStock(tx, order, line, effectivePlanQuantity, 'REWORK');
          }

          if (effectivePlanQuantity <= 0) {
            continue;
          }

          // 生产任务计划数使用生产计划数量，不再混用客户订单数量；REWORK 会先扣备货库存再进入生产。
          await tx.productionTask.upsert({
            where: { productionTaskNo: `PT-${order.orderNo}-${String(line.lineNo).padStart(3, '0')}` },
            update: {
              processSnapshot: this.processStepsToJson(steps),
              plannedQuantity: effectivePlanQuantity,
              unit: line.unit
            },
            create: {
              productionTaskNo: `PT-${order.orderNo}-${String(line.lineNo).padStart(3, '0')}`,
              orderId: order.id,
              orderLineId: line.id,
              orderNo: order.orderNo,
              customerName: order.customerName,
              partCode: line.partCode,
              partName: line.partName,
              plannedQuantity: effectivePlanQuantity,
              unit: line.unit,
              processSnapshot: this.processStepsToJson(steps),
              status: 'PENDING'
            }
          });
        }
      },
      '库存正在被其他订单占用，请刷新库存后重新提交订单'
    );

    return this.findOne(normalizedOrderNo);
  }

  private async resolveSubmitPlanOperator(submittedByCode: string, label = '下单/计划操作员') {
    return this.resolveSubmitPlanOperatorFromClient(this.prisma, submittedByCode, label);
  }

  private async resolveSubmitPlanOperatorFromClient(
    client: { productionOperator: { findFirst: (args: any) => Promise<any> } },
    submittedByCode: string,
    label = '下单/计划操作员'
  ) {
    const accountId = submittedByCode?.trim();
    if (!accountId) {
      throw new BadRequestException(`请选择${label}`);
    }

    const operator = await client.productionOperator.findFirst({
      where: { accountId: { equals: accountId, mode: 'insensitive' } },
      select: { accountId: true, name: true, role: true, status: true }
    });
    const fallbackOperator = fallbackSubmitPlanOperators.find(
      (item) => item.accountId.toLocaleLowerCase() === accountId.toLocaleLowerCase()
    );
    const submitOperator = operator || fallbackOperator;
    if (!submitOperator) {
      throw new BadRequestException(`${label}不存在，请刷新后重新选择`);
    }
    if ('status' in submitOperator && submitOperator.status !== CommonStatus.ENABLED) {
      throw new BadRequestException(`${label}已停用，不能操作`);
    }
    if (!this.isSubmitPlanOperatorRole(submitOperator.role)) {
      throw new BadRequestException(`${label}必须是下单/计划管理人员，车间人员只能查看生产流程`);
    }
    return {
      accountId: submitOperator.accountId,
      name: submitOperator.name,
      role: submitOperator.role
    };
  }

  private async assertSubmittedProductionPlanOverrides(
    tx: Prisma.TransactionClient,
    lines: Array<{
      id: string;
      partCode: string;
      quantity: Prisma.Decimal | number | string | null;
      fulfillmentMode?: OrderLineFulfillmentMode | string | null;
      productionPlanQuantity: Prisma.Decimal | number | string | null;
      productionPlanOverrideByCode?: string | null;
      productionPlanOverrideByName?: string | null;
      productionPlanOverrideByRole?: string | null;
      productionPlanOverrideAt?: Date | string | null;
      productionPlanOverrideReason?: string | null;
      stockSourceSelections?: Prisma.JsonValue | null;
    }>,
    effectivePlanQuantityByLineId: Map<string, number>
  ) {
    for (const line of lines) {
      const effectivePlanQuantity = effectivePlanQuantityByLineId.get(line.id) || 0;
      const suggestedQuantity = this.resolveSuggestedProductionPlanQuantity(line);
      if (Math.abs(effectivePlanQuantity - suggestedQuantity) <= 0.0001) {
        continue;
      }

      const operator = await this.resolveSubmitPlanOperatorFromClient(
        tx,
        line.productionPlanOverrideByCode || '',
        `零件 ${line.partCode} 生产计划调整操作员`
      );
      const overrideAt = line.productionPlanOverrideAt ? new Date(line.productionPlanOverrideAt) : null;
      if (!overrideAt || Number.isNaN(overrideAt.getTime()) || !line.productionPlanOverrideReason?.trim()) {
        throw new BadRequestException(`零件 ${line.partCode} 生产计划数量与建议数量不一致，必须记录调整时间和说明`);
      }
      if (line.productionPlanOverrideByName !== operator.name || line.productionPlanOverrideByRole !== operator.role) {
        throw new BadRequestException(
          `零件 ${line.partCode} 生产计划调整操作员快照已过期，请重新选择 ${operator.accountId} 并保存订单后再提交生产`
        );
      }
    }
  }

  private isSubmitPlanOperatorRole(role?: string | null) {
    const value = role || '';
    return /计划|下单|订单/.test(value) && !/车间|主任|技术|工艺/.test(value);
  }

  private async resolveProcessEditorOperator(configuredByCode: string) {
    const accountId = configuredByCode?.trim();
    if (!accountId) {
      throw new BadRequestException('请选择生产流程填写人员');
    }

    const operator = await this.prisma.productionOperator.findFirst({
      where: { accountId: { equals: accountId, mode: 'insensitive' } },
      select: { accountId: true, name: true, role: true, status: true }
    });
    const fallbackOperator = fallbackSubmitPlanOperators.find(
      (item) => item.accountId.toLocaleLowerCase() === accountId.toLocaleLowerCase()
    );
    const processEditor = operator || fallbackOperator;
    if (!processEditor) {
      throw new BadRequestException('生产流程填写人员不存在，请刷新后重新选择');
    }
    if ('status' in processEditor && processEditor.status !== CommonStatus.ENABLED) {
      throw new BadRequestException('生产流程填写人员已停用，不能操作');
    }
    if (!this.isProcessEditorRole(processEditor.role)) {
      throw new BadRequestException('生产流程只能由下单/计划管理人员填写，车间人员只能查看生产流程');
    }
    return {
      accountId: processEditor.accountId,
      name: processEditor.name,
      role: processEditor.role
    };
  }

  private isProcessEditorRole(role?: string | null) {
    const value = role || '';
    return /计划|下单|订单/.test(value) && !/车间|主任|技术|工艺|操作员/.test(value);
  }

  private appendOrderRemark(existingRemark: string | null | undefined, line: string) {
    const normalizedRemark = existingRemark?.trim();
    const record = `${new Date().toISOString()} ${line}`;
    return normalizedRemark ? `${normalizedRemark}\n${record}` : record;
  }

  private async findStartedOrderLineTask(tx: Prisma.TransactionClient, orderNo: string, lineId: string) {
    const order = await tx.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    this.assertOrderAcceptsProductionChange(order);

    const line = await tx.orderLine.findFirst({
      where: { id: lineId, orderId: order.id },
      include: {
        processSteps: { orderBy: { stepNo: 'asc' } },
        productionTasks: {
          include: { processCompletions: true },
          orderBy: { productionTaskNo: 'asc' }
        }
      }
    });
    if (!line) {
      throw new NotFoundException('订单零件不存在');
    }

    const baseTask = line.productionTasks.find((task) => !task.isReplenishment && this.isStartedProductionTask(task));
    if (!baseTask) {
      throw new BadRequestException('该订单零件尚未开始生产，请修改订单，不要创建补单');
    }

    return { order, line, baseTask };
  }

  private assertOrderAcceptsProductionChange(order: { status: OrderStatus }) {
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('已取消订单不能创建补单或生产数量变更');
    }
    if (order.status === OrderStatus.COMPLETED) {
      throw new BadRequestException('已完成订单不能创建补单或生产数量变更');
    }
  }

  private isStartedProductionTask(task: { status: ProductionStatus; processCompletions?: unknown[] }) {
    return task.status !== ProductionStatus.PENDING || this.hasEffectiveProcessProgress(task);
  }

  private hasEffectiveProcessProgress(task: { processCompletions?: any[] }) {
    return Boolean(
      task.processCompletions?.some(
        (completion) =>
          completion.isCompleted ||
          Boolean(completion.completedAt) ||
          decimalToNumber(completion.completedQuantity) > 0 ||
          decimalToNumber(completion.scrapQuantity) > 0 ||
          decimalToNumber(completion.shortageQuantity) > 0
      )
    );
  }

  private appendRemark(current: string | null | undefined, next: string) {
    return [current?.trim(), next].filter(Boolean).join('\n');
  }

  private async markLineShortagesResolved(
    tx: Prisma.TransactionClient,
    orderLineId: string,
    coveringQuantity: number | undefined,
    resolutionMode: string,
    resolvedBy: string,
    reason: string
  ) {
    const tasks = await tx.productionTask.findMany({
      where: { orderLineId },
      include: { processCompletions: true }
    });
    const records = this.toUnresolvedShortageRecords(tasks);
    const totalShortage = records.reduce((sum: number, record: any) => sum + Number(record.shortageQuantity || 0), 0);
    if (records.length === 0 || (coveringQuantity !== undefined && coveringQuantity + 0.0001 < totalShortage)) {
      return 0;
    }

    const now = new Date();
    await tx.productionProcessCompletion.updateMany({
      where: { id: { in: records.map((record: any) => record.completionId).filter(Boolean) } },
      data: {
        shortageResolutionMode: resolutionMode,
        shortageResolutionBy: resolvedBy,
        shortageResolutionReason: reason,
        shortageResolvedAt: now
      }
    });
    return records.length;
  }

  private async createReplenishmentTaskForLine(
    tx: Prisma.TransactionClient,
    order: any,
    line: any,
    baseTask: any,
    plannedQuantity: number,
    reason: string
  ) {
    const sourceProductionTaskNo = baseTask.sourceProductionTaskNo || baseTask.productionTaskNo;
    const existingPending = await tx.productionTask.findFirst({
      where: {
        orderLineId: line.id,
        isReplenishment: true,
        sourceProductionTaskNo,
        replenishmentSourceType: 'ORDER_CHANGE',
        status: ProductionStatus.PENDING
      },
      orderBy: { productionTaskNo: 'asc' }
    });
    const steps = this.processRowsToSnapshots(line.processSteps || []);

    if (existingPending) {
      await tx.productionTask.update({
        where: { id: existingPending.id },
        data: {
          plannedQuantity,
          processSnapshot: this.processStepsToJson(steps),
          replenishmentSourceType: 'ORDER_CHANGE',
          replenishmentSourceRequestNo: order.orderNo,
          remark: reason
        }
      });
      return existingPending.productionTaskNo;
    }

    const existingStarted = await tx.productionTask.findFirst({
      where: {
        orderLineId: line.id,
        isReplenishment: true,
        sourceProductionTaskNo,
        replenishmentSourceType: 'ORDER_CHANGE',
        status: { not: ProductionStatus.PENDING }
      },
      orderBy: { productionTaskNo: 'desc' }
    });
    if (existingStarted) {
      throw new BadRequestException('已有补单任务已开始生产，请管理人员确认后再创建新的客户变更记录');
    }

    const productionTaskNo = await this.generateNextReplenishmentTaskNo(tx, sourceProductionTaskNo);
    await tx.productionTask.create({
      data: {
        productionTaskNo,
        orderId: order.id,
        orderLineId: line.id,
        orderNo: order.orderNo,
        customerName: order.customerName,
        partCode: line.partCode,
        partName: line.partName,
        plannedQuantity,
        unit: line.unit,
        processSnapshot: this.processStepsToJson(steps),
        status: ProductionStatus.PENDING,
        isReplenishment: true,
        sourceProductionTaskNo,
        replenishmentSourceType: 'ORDER_CHANGE',
        replenishmentSourceRequestNo: order.orderNo,
        remark: reason
      }
    });
    return productionTaskNo;
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

  private async describeOrderProductionProgress(tx: Prisma.TransactionClient, orderId: string) {
    const tasks = await tx.productionTask.findMany({
      where: { orderId },
      include: { processCompletions: { orderBy: { stepNo: 'asc' } } },
      orderBy: { productionTaskNo: 'asc' }
    });
    const startedTasks = tasks.filter((task) => this.isStartedProductionTask(task));
    if (startedTasks.length === 0) {
      return '当前订单尚未开始生产';
    }
    const summaries = startedTasks.map((task) => {
      const steps = processSnapshotToArray(task.processSnapshot);
      const completedNames = task.processCompletions
        .filter((completion) => completion.isCompleted)
        .map((completion) => completion.processName);
      const nextStep = steps.find((step) => !completedNames.includes(step));
      if (task.status === ProductionStatus.COMPLETED) {
        return `${task.partCode} 已完成`;
      }
      if (completedNames.length === 0) {
        return `${task.partCode} 已开始生产，下一工序 ${nextStep || '待确认'}`;
      }
      return `${task.partCode} 已完成 ${completedNames.join('、')}，下一工序 ${nextStep || '待最终确认'}`;
    });
    return `当前订单生产进度：${summaries.join('；')}`;
  }

  private normalizeCancelHandlingPlan(
    items: CancelOrderDto['handlingPlan'],
    startedTasks: any[],
    productionCancelState: 'NOT_PRODUCED' | 'PRODUCED'
  ) {
    const planMap = new Map<string, NormalizedCancelHandlingPlanItem>();
    if (productionCancelState !== 'PRODUCED') {
      return planMap;
    }
    if (startedTasks.length === 0) {
      return planMap;
    }
    if (!items || items.length === 0) {
      throw new BadRequestException('已生产取消必须填写已生产零件的处理方案');
    }

    const taskMap = new Map(startedTasks.map((task) => [task.productionTaskNo.toUpperCase(), task]));
    for (const item of items) {
      const taskNo = item.productionTaskNo.trim().toUpperCase();
      const task = taskMap.get(taskNo);
      if (!task || task.orderLineId !== item.orderLineId) {
        throw new BadRequestException(`取消处理方案包含无效任务 ${item.productionTaskNo}`);
      }
      if (planMap.has(taskNo)) {
        throw new BadRequestException(`取消处理方案存在重复任务 ${item.productionTaskNo}`);
      }

      const handlingQuantity = this.roundQuantity(decimalToNumber(item.handlingQuantity));
      if ((item.handlingMode === 'STOCK' || item.handlingMode === 'SCRAP') && handlingQuantity <= 0) {
        throw new BadRequestException(`任务 ${item.productionTaskNo} 的处理数量必须大于 0`);
      }
      if (item.handlingMode === 'NONE' && handlingQuantity > 0) {
        throw new BadRequestException(`任务 ${item.productionTaskNo} 选择无实物处理时，处理数量必须为 0`);
      }
      if (item.handlingMode === 'NONE' && !item.remark?.trim()) {
        throw new BadRequestException(`任务 ${item.productionTaskNo} 选择无实物处理时必须填写说明`);
      }

      const maxQuantity = Math.max(
        decimalToNumber(task.completedQuantity),
        decimalToNumber(task.plannedQuantity),
        0
      );
      if (handlingQuantity > maxQuantity) {
        throw new BadRequestException(`任务 ${item.productionTaskNo} 的处理数量不能超过生产任务数量`);
      }

      planMap.set(taskNo, {
        orderLineId: item.orderLineId,
        productionTaskNo: task.productionTaskNo,
        handlingMode: item.handlingMode,
        handlingQuantity,
        remark: item.remark?.trim() || undefined
      });
    }

    const missingTask = startedTasks.find((task) => !planMap.has(task.productionTaskNo.toUpperCase()));
    if (missingTask) {
      throw new BadRequestException(`取消处理方案缺少任务 ${missingTask.productionTaskNo}`);
    }
    return planMap;
  }

  private formatCancelHandlingPlan(plan: NormalizedCancelHandlingPlanItem, unit?: string) {
    const quantityText = `${this.roundQuantity(plan.handlingQuantity)} ${unit || '件'}`;
    const remarkText = plan.remark ? `，说明：${plan.remark}` : '';
    if (plan.handlingMode === 'STOCK') {
      return `管理人员建议转备货库存 ${quantityText}${remarkText}`;
    }
    if (plan.handlingMode === 'SCRAP') {
      return `管理人员建议报废 ${quantityText}${remarkText}`;
    }
    return `管理人员确认无实物处理${remarkText}`;
  }

  private cancelHandlingPlanToJson(
    plan: NormalizedCancelHandlingPlanItem,
    managerName: string,
    plannedAt: Date
  ): Prisma.InputJsonValue {
    return {
      handlingMode: plan.handlingMode,
      handlingQuantity: plan.handlingQuantity,
      remark: plan.remark || '',
      plannedBy: managerName,
      plannedAt: plannedAt.toISOString()
    };
  }

  private async createProductionNotice(
    tx: Prisma.TransactionClient,
    data: {
      noticeType: 'QUANTITY_INCREASE' | 'QUANTITY_DECREASE' | 'ORDER_CANCELLED' | 'MATERIAL_ADDED' | 'TASK_WITHDRAWN';
      target?: ProductionNoticeTarget;
      order: any;
      line?: any;
      productionTaskId?: string;
      productionTaskNo?: string;
      beforeQuantity?: number;
      afterQuantity?: number;
      deltaQuantity?: number;
      reason: string;
      managerName?: string;
      handlingPlan?: Prisma.InputJsonValue;
    }
  ) {
    const target = data.target || ProductionNoticeTarget.PRODUCTION;
    const existingPendingNotice = await tx.productionNotice.findFirst({
      where: {
        noticeType: data.noticeType,
        target,
        status: ProductionNoticeStatus.PENDING,
        orderLineId: data.line?.id,
        productionTaskNo: data.productionTaskNo
      },
      orderBy: { createdAt: 'desc' }
    });

    const noticeData = {
      noticeType: data.noticeType,
      target,
      orderId: data.order.id,
      orderNo: data.order.orderNo,
      orderLineId: data.line?.id,
      productionTaskId: data.productionTaskId,
      productionTaskNo: data.productionTaskNo,
      partCode: data.line?.partCode,
      partName: data.line?.partName,
      beforeQuantity: data.beforeQuantity,
      afterQuantity: data.afterQuantity,
      deltaQuantity: data.deltaQuantity,
      unit: data.line?.unit,
      reason: data.reason,
      managerName: data.managerName || null,
      ...(data.handlingPlan !== undefined ? { handlingPlan: data.handlingPlan } : {})
    };

    if (existingPendingNotice) {
      await tx.productionNotice.update({
        where: { id: existingPendingNotice.id },
        data: noticeData
      });
      return;
    }

    await tx.productionNotice.create({
      data: {
        noticeNo: await this.generateNextNoticeNo(tx),
        ...noticeData
      }
    });
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

  private async allocateStockToOrderLine(tx: Prisma.TransactionClient, order: any, line: any) {
    await this.consumeAvailableStock(tx, order, line, this.selectedStockSourceQuantity(line), 'STOCK');
  }

  private async consumeStockForRework(tx: Prisma.TransactionClient, order: any, line: any) {
    // 库存再加工要按生产计划数量领用备货库存；多计划的数量后续生产完成后仍可转为备货库存。
    await this.consumeAvailableStock(tx, order, line, decimalToNumber(line.productionPlanQuantity), 'REWORK');
  }

  private async consumeAvailableStock(
    tx: Prisma.TransactionClient,
    order: any,
    line: any,
    requiredQuantity: number,
    purpose: 'STOCK' | 'REWORK'
  ) {
    const selectedSources = this.jsonToStockSourceSelections(line.stockSourceSelections);
    this.validateSelectedStockSourceManualConfirmations(selectedSources);
    const hasManualSelections = selectedSources.length > 0;
    if (!hasManualSelections) {
      throw new BadRequestException(`零件 ${line.partCode} 必须先选择库存批次并完成来源核对`);
    }
    const stockBatches = await tx.inventoryBatch.findMany({
      where: hasManualSelections
        ? {
            id: { in: selectedSources.map((source) => source.batchId) },
            sourceOrderId: null,
            quantity: { gt: 0 },
            status: 'AVAILABLE'
          }
        : {
            sourceOrderId: null,
            partCode: { equals: line.partCode, mode: 'insensitive' },
            unit: line.unit,
            quantity: { gt: 0 },
            status: 'AVAILABLE'
          },
      include: {
        sourceOrderLine: true,
        productionTask: { include: { orderLine: true } },
        reservations: {
          where: { status: InventoryReservationStatus.ACTIVE },
          include: {
            order: { select: { orderNo: true, customerName: true, orderDate: true } },
            orderLine: { select: { lineNo: true, partCode: true, partName: true } }
          },
          orderBy: [{ createdAt: 'asc' }]
        }
      },
      orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }]
    });
    const usageCandidateBatches = await this.findAvailableStockUsageCandidateBatches(tx, stockBatches, order.id);
    const sourceTaskMap = await this.findStockSourceTaskMap(tx, usageCandidateBatches);
    const selectedSourceMap = new Map(selectedSources.map((source) => [source.batchId, source]));
    const foundBatchIds = new Set(stockBatches.map((batch) => batch.id));
    const missingSelection = selectedSources.find((source) => !foundBatchIds.has(source.batchId));
    if (missingSelection) {
      throw new BadRequestException(`已选库存批次 ${missingSelection.batchNo || missingSelection.batchId} 不存在或当前不可用`);
    }
    const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(
      tx,
      stockBatches.map((batch) => batch.id),
      order
    );
    if (hasManualSelections) {
      const selectedTotal = selectedSources.reduce((sum, source) => sum + Number(source.quantity || 0), 0);
      if (selectedTotal > requiredQuantity + 0.0001) {
        throw new BadRequestException(
          `零件 ${line.partCode} 已选库存数量超过本次需要数量：需要 ${requiredQuantity}，已选 ${selectedTotal}`
        );
      }
    }

    // 操作员已经在库存来源弹窗确定了使用队列；提交生产扣库必须严格按 selectedStockSources 顺序执行。
    const sortedStockBatches = hasManualSelections
      ? selectedSources
          .map((source) => stockBatches.find((batch) => batch.id === source.batchId))
          .filter(Boolean)
      : this.sortStockBatchesForOrderLine(line, stockBatches, sourceTaskMap);
    const candidateBatches = hasManualSelections
      ? sortedStockBatches.map((batch) => ({
          ...batch,
          selectedQuantity: selectedSourceMap.get(batch.id)?.quantity || 0,
          reservedByOtherOrders: reservedQuantityByBatchId.get(batch.id) || 0,
          availableQuantity: Math.max(decimalToNumber(batch.quantity) - (reservedQuantityByBatchId.get(batch.id) || 0), 0)
        }))
      : purpose === 'STOCK'
        ? sortedStockBatches.filter((batch) => this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap))
        : sortedStockBatches;

    for (const batch of candidateBatches) {
      if (batch.unit !== line.unit) {
        throw new BadRequestException(`已选库存批次 ${batch.batchNo} 的单位 ${batch.unit} 与订单单位 ${line.unit} 不一致`);
      }
      const batchAvailableQuantity = Number(batch.availableQuantity ?? decimalToNumber(batch.quantity));
      if (hasManualSelections && batchAvailableQuantity + 0.0001 < Number(batch.selectedQuantity || 0)) {
        throw new BadRequestException(
          `已选库存批次 ${batch.batchNo} 的使用数量超过当前可用库存：${this.stockAvailabilitySummary([batch], order.id)}`
        );
      }
      const selectedSource = hasManualSelections ? selectedSourceMap.get(batch.id) : undefined;
      if (hasManualSelections) {
        const usageOrderIssue = this.stockSourceUsageOrderIssue(
          line,
          batch,
          sourceTaskMap,
          selectedSources,
          usageCandidateBatches,
          order.id
        );
        const needsManualConfirmation =
          purpose === 'STOCK'
            ? this.stockSourceSelectionNeedsManualConfirmation(line, batch, sourceTaskMap, selectedSources, usageCandidateBatches, order.id)
            : !this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap) ||
              Boolean(usageOrderIssue);
        if (needsManualConfirmation && !this.stockSourceManualConfirmationComplete(selectedSource)) {
          // 后端必须按真实库存来源重新核对，不能只相信前端提交的 compatibilityStatus。
          throw new BadRequestException(
            `已选库存批次 ${batch.batchNo} 需要填写人工确认记录${usageOrderIssue ? `：${usageOrderIssue}` : ''}`
          );
        }
      }
    }

    const availableQuantity = candidateBatches.reduce(
      (sum, batch) => sum + Number(batch.availableQuantity ?? decimalToNumber(batch.quantity)),
      0
    );
    const selectedAvailableQuantity = hasManualSelections
      ? candidateBatches.reduce(
          (sum, batch) => sum + Math.min(Number(batch.availableQuantity ?? decimalToNumber(batch.quantity)), Number(batch.selectedQuantity || 0)),
          0
        )
      : availableQuantity;
    const availabilitySummary = this.stockAvailabilitySummary(candidateBatches, order.id);
    if (selectedAvailableQuantity + 0.0001 < requiredQuantity) {
      if (hasManualSelections) {
        throw new BadRequestException(
          `零件 ${line.partCode} 已选库存不足：需要 ${requiredQuantity}，已选可用 ${selectedAvailableQuantity}。${availabilitySummary}`
        );
      }
      if (purpose === 'STOCK' && stockBatches.length > 0) {
        throw new BadRequestException(
          `零件 ${line.partCode} 可用库存不足：需要 ${requiredQuantity}，可用 ${availableQuantity}。${availabilitySummary}`
        );
      }
      throw new BadRequestException(`零件 ${line.partCode} 可用库存不足：需要 ${requiredQuantity}，可用 ${availableQuantity}。${availabilitySummary}`);
    }

    let remainingQuantity = this.roundQuantity(requiredQuantity);
    let sequence = 1;
    for (const batch of candidateBatches) {
      if (remainingQuantity <= 0) {
        break;
      }

      const batchQuantity = decimalToNumber(batch.quantity);
      const batchAvailableQuantity = this.roundQuantity(Number(batch.availableQuantity ?? batchQuantity));
      const selectedLimit = hasManualSelections ? Number(batch.selectedQuantity || 0) : batchAvailableQuantity;
      const usedQuantity = this.roundQuantity(Math.min(batchAvailableQuantity, selectedLimit, remainingQuantity));
      if (usedQuantity <= 0) {
        continue;
      }
      const leftQuantity = this.roundQuantity(batchQuantity - usedQuantity);
      const suffix = `${String(line.lineNo).padStart(3, '0')}-${String(sequence).padStart(2, '0')}`;

      // 使用备货库存不能只写订单字段，必须先扣减原备货库存并追加 OUT 流水，保证库存账准确。
      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: leftQuantity > 0 ? { quantity: leftQuantity } : { quantity: 0, status: 'USED' }
      });

      await tx.inventoryTransaction.create({
        data: {
          transactionNo: `IT-${purpose}-OUT-${order.orderNo}-${suffix}`,
          transactionType: 'OUT',
          batchId: batch.id,
          orderLineId: line.id,
          partCode: batch.partCode,
          partName: batch.partName,
          orderNo: null,
          productionTaskNo: batch.sourceProductionTaskNo,
          quantity: usedQuantity,
          unit: batch.unit,
          warehouseId: batch.warehouseId,
          locationId: batch.locationId,
          remark: purpose === 'STOCK' ? '订单使用备货库存' : '库存修改再加工领用',
          sourceRecordType: `OrderLine${purpose}`,
          sourceRecordId: line.id
        }
      });

      await this.consumeActiveInventoryReservations(tx, order, line, batch, usedQuantity);

      if (purpose === 'STOCK') {
        const sourceTask = batch.sourceProductionTaskNo ? sourceTaskMap.get(batch.sourceProductionTaskNo) : null;
        const orderBatch = await tx.inventoryBatch.create({
          data: {
            batchNo: `IB-ALLOC-${order.orderNo}-${suffix}`,
            partCode: line.partCode,
            partName: line.partName,
            sourceOrderId: order.id,
            sourceOrderLineId: line.id,
            sourceOrderNo: order.orderNo,
            sourceCustomerName: order.customerName,
            productionTaskId: null,
            // 备货库存转成订单待发库存时仍要保留原生产任务号，用于核对原订单、图号和版本。
            sourceProductionTaskNo: batch.sourceProductionTaskNo,
            sourceKind: batch.sourceKind || 'NORMAL_ORDER',
            // 订单占用库存后不能丢失原批次的补单来源，否则发货和库存来源核对会看不出是订单补单还是生产报废补单。
            replenishmentSourceType: batch.replenishmentSourceType || sourceTask?.replenishmentSourceType,
            replenishmentSourceRequestNo: batch.replenishmentSourceRequestNo || sourceTask?.replenishmentSourceRequestNo,
            quantity: usedQuantity,
            unit: line.unit,
            warehouseId: batch.warehouseId,
            locationId: batch.locationId,
            status: 'AVAILABLE'
          }
        });

        await tx.inventoryTransaction.create({
          data: {
            transactionNo: `IT-STOCK-IN-${order.orderNo}-${suffix}`,
            transactionType: 'IN',
            batchId: orderBatch.id,
            orderLineId: line.id,
            partCode: line.partCode,
            partName: line.partName,
            orderNo: order.orderNo,
            productionTaskNo: batch.sourceProductionTaskNo,
            quantity: usedQuantity,
            unit: line.unit,
            warehouseId: batch.warehouseId,
            locationId: batch.locationId,
            remark: '备货库存转订单待发货库存',
            sourceRecordType: 'OrderLineStockAllocation',
            sourceRecordId: line.id
          }
        });
      }

      remainingQuantity = this.roundQuantity(remainingQuantity - usedQuantity);
      sequence += 1;
    }
  }

  private async consumeActiveInventoryReservations(
    tx: Prisma.TransactionClient,
    order: { id: string; orderNo: string },
    line: { id: string; partCode: string; partName: string; unit: string },
    batch: { id: string; batchNo: string; unit: string },
    usedQuantity: number
  ) {
    const reservations = await tx.inventoryReservation.findMany({
      where: {
        batchId: batch.id,
        orderId: order.id,
        orderLineId: line.id,
        status: InventoryReservationStatus.ACTIVE
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const reservedQuantity = this.roundQuantity(
      reservations.reduce((sum, reservation) => sum + decimalToNumber(reservation.quantity), 0)
    );

    // 提交生产时必须把草稿预占、实际扣库存和库存流水逐批对齐，避免旧数据造成少生产或重复占用。
    if (Math.abs(reservedQuantity - usedQuantity) > 0.0001) {
      throw new BadRequestException(
        `库存批次 ${batch.batchNo} 的草稿预占数量异常：本次应消费 ${usedQuantity}${batch.unit}，` +
          `实际 ACTIVE 预占 ${reservedQuantity}${batch.unit}。请重新保存订单库存来源后再提交生产。`
      );
    }
    if (reservations.length === 0) {
      throw new BadRequestException(
        `库存批次 ${batch.batchNo} 缺少草稿库存预占记录，请重新保存订单库存来源后再提交生产。`
      );
    }

    await tx.inventoryReservation.updateMany({
      where: { id: { in: reservations.map((reservation) => reservation.id) } },
      data: {
        status: InventoryReservationStatus.CONSUMED,
        statusReason: `订单 ${order.orderNo} 提交生产消费库存`,
        consumedAt: new Date()
      }
    });
  }

  private stockAvailabilitySummary(batches: any[], currentOrderId?: string) {
    if (!batches.length) {
      return '没有可用库存批次';
    }
    return batches
      .map((batch) => {
        const unit = batch.unit || '件';
        const physicalQuantity = this.roundQuantity(decimalToNumber(batch.quantity));
        const reservationRows = (batch.reservations || []).filter((reservation: any) => reservation.orderId !== currentOrderId);
        const reservationQuantity = this.roundQuantity(
          batch.reservedByOtherOrders !== undefined
            ? Number(batch.reservedByOtherOrders || 0)
            : reservationRows.reduce((sum: number, reservation: any) => sum + decimalToNumber(reservation.quantity), 0)
        );
        const availableQuantity = this.roundQuantity(
          batch.availableQuantity !== undefined ? Number(batch.availableQuantity ?? 0) : Math.max(physicalQuantity - reservationQuantity, 0)
        );
        const selectedQuantity = this.roundQuantity(Number(batch.selectedQuantity || 0));
        const reservationText = reservationRows
          .map((reservation: any) => {
            const orderNo = reservation.orderNo || reservation.order?.orderNo || '草稿订单';
            const partName = reservation.partName || reservation.orderLine?.partName || reservation.partCode || reservation.orderLine?.partCode || '-';
            return `${orderNo}/${partName} 预占 ${this.roundQuantity(decimalToNumber(reservation.quantity))}${reservation.unit || unit}`;
          })
          .join('，');
        const selectedText = selectedQuantity > 0 ? `，本次选择 ${selectedQuantity}${unit}` : '';
        const reservationDetailText =
          reservationText || reservationQuantity <= 0
            ? reservationText
            : `其他订单合计预占 ${reservationQuantity}${unit}`;
        return `${batch.batchNo}: 当前库存 ${physicalQuantity}${unit}，其他订单预占 ${reservationQuantity}${unit}，可用 ${availableQuantity}${unit}${selectedText}${
          reservationDetailText ? `（${reservationDetailText}）` : ''
        }`;
      })
      .join('；');
  }

  private validateSelectedStockSourceManualConfirmations(selectedSources: ReturnType<OrdersService['jsonToStockSourceSelections']>) {
    const missingReviewSource = selectedSources.find((source) => !source.compatibilityStatus);
    if (missingReviewSource) {
      throw new BadRequestException(
        `已选库存批次 ${missingReviewSource.batchNo || missingReviewSource.batchId} 缺少库存来源核对结果，请重新打开库存来源并确认后再保存`
      );
    }

    const incompleteSource = selectedSources.find(
      (source) => source.compatibilityStatus && source.compatibilityStatus !== 'MATCHED' && !this.stockSourceManualConfirmationComplete(source)
    );
    if (!incompleteSource) {
      return;
    }

    throw new BadRequestException(
      `已选库存批次 ${incompleteSource.batchNo || incompleteSource.batchId} 与本次订单资料不完全匹配，必须填写人工确认记录`
    );
  }

  private stockSourceManualConfirmationComplete(source?: ReturnType<OrdersService['jsonToStockSourceSelections']>[number]) {
    const confirmedAt = source?.manualConfirmedAt?.trim();
    return Boolean(
      source?.manualConfirmedBy?.trim() &&
        confirmedAt &&
        !Number.isNaN(new Date(confirmedAt).getTime()) &&
        source?.manualConfirmRemark?.trim()
    );
  }

  private async findStockSourceTaskMap(tx: Prisma.TransactionClient, batches: any[]) {
    const taskNos = [...new Set(batches.map((batch) => batch.sourceProductionTaskNo).filter(Boolean))] as string[];
    if (taskNos.length === 0) {
      return new Map<string, any>();
    }

    const tasks = await tx.productionTask.findMany({
      where: { productionTaskNo: { in: taskNos } },
      include: { orderLine: true }
    });
    return new Map(tasks.map((task) => [task.productionTaskNo, task]));
  }

  private async findAvailableStockUsageCandidateBatches(
    client: { inventoryBatch: { findMany: (args: any) => Promise<any[]> } },
    selectedBatches: any[],
    excludeOrderId?: string
  ) {
    const keys = new Map<string, { partCode: string; unit: string }>();
    for (const batch of selectedBatches) {
      const partCode = String(batch.partCode || '').trim();
      const unit = String(batch.unit || '').trim();
      if (!partCode || !unit) {
        continue;
      }
      keys.set(`${partCode.toLocaleLowerCase()}__${unit.toLocaleLowerCase()}`, { partCode, unit });
    }
    if (keys.size === 0) {
      return selectedBatches;
    }

    const candidateBatches = await client.inventoryBatch.findMany({
      where: {
        sourceOrderId: null,
        quantity: { gt: 0 },
        status: 'AVAILABLE',
        OR: [...keys.values()].map((key) => ({
          partCode: { equals: key.partCode, mode: 'insensitive' },
          unit: key.unit
        }))
      },
      include: {
        sourceOrderLine: true,
        productionTask: { include: { orderLine: true } },
        reservations: {
          where: {
            status: InventoryReservationStatus.ACTIVE,
            ...(excludeOrderId ? { orderId: { not: excludeOrderId } } : {})
          }
        }
      },
      orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }]
    });

    // 使用顺序校验必须包含未被选中的同类小批次，后端才能发现“先用大库存、跳过小库存”的情况。
    const rows = new Map<string, any>();
    for (const batch of candidateBatches) {
      rows.set(batch.id, batch);
    }
    for (const batch of selectedBatches) {
      rows.set(batch.id, batch);
    }
    return [...rows.values()];
  }

  private resolveStockBatchSourceLine(batch: any, sourceTaskMap: Map<string, any>) {
    const sourceTask = batch.sourceProductionTaskNo ? sourceTaskMap.get(batch.sourceProductionTaskNo) : null;
    if (sourceTask?.orderLine) {
      // 备货库存可能后来被分配给新订单，图纸匹配必须取原生产任务的订单零件信息。
      return sourceTask.orderLine;
    }
    return batch.sourceOrderLine || batch.productionTask?.orderLine || null;
  }

  private sortStockBatchesForOrderLine(line: any, batches: any[], sourceTaskMap: Map<string, any>) {
    return batches
      .map((batch, index) => ({
        batch,
        index,
        rank: this.stockBatchCompatibilityRank(line, batch, sourceTaskMap)
      }))
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          this.stockBatchAvailableQuantity(left.batch) - this.stockBatchAvailableQuantity(right.batch) ||
          left.index - right.index
      )
      .map((item) => item.batch);
  }

  private stockBatchReservedQuantity(batch: any, currentOrderId?: string) {
    if (batch.reservedByOtherOrders !== undefined) {
      return this.roundQuantity(Number(batch.reservedByOtherOrders || 0));
    }
    return this.roundQuantity(
      (batch.reservations || [])
        .filter((reservation: any) => !currentOrderId || reservation.orderId !== currentOrderId)
        .reduce((sum: number, reservation: any) => sum + decimalToNumber(reservation.quantity), 0)
    );
  }

  private stockBatchAvailableQuantity(batch: any, currentOrderId?: string) {
    if (batch.availableQuantity !== undefined) {
      return this.roundQuantity(Number(batch.availableQuantity ?? 0));
    }
    return this.roundQuantity(Math.max(decimalToNumber(batch.quantity) - this.stockBatchReservedQuantity(batch, currentOrderId), 0));
  }

  private stockBatchCompatibilityRank(line: any, batch: any, sourceTaskMap: Map<string, any>) {
    const sourceLine = this.resolveStockBatchSourceLine(batch, sourceTaskMap);
    if (this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap)) {
      return 0;
    }
    if (!sourceLine) {
      return 2;
    }
    return 1;
  }

  private stockBatchMatchesOrderLine(line: any, batch: any, sourceTaskMap: Map<string, any>) {
    const sourceLine = this.resolveStockBatchSourceLine(batch, sourceTaskMap);
    if (!sourceLine) {
      return false;
    }

    return (
      this.sourceLineHasDirectStockDrawingInfo(sourceLine) &&
      this.requiredTextMatches(line.partCode, batch.partCode) &&
      this.requiredTextMatches(line.drawingNo, sourceLine.drawingNo) &&
      this.requiredTextMatches(line.drawingVersion, sourceLine.drawingVersion) &&
      this.requiredTextMatches(line.partSpecification, sourceLine.partSpecification) &&
      this.requiredNumberMatches(line.partThickness, sourceLine.partThickness)
    );
  }

  private stockSourceSelectionNeedsManualConfirmation(
    line: any,
    batch: any,
    sourceTaskMap: Map<string, any>,
    selectedSources: ReturnType<OrdersService['jsonToStockSourceSelections']>,
    availableBatches: any[],
    currentOrderId?: string
  ) {
    return (
      this.stockSourceMissingOrderInfo(line).length > 0 ||
      this.directStockSourceMissingDrawingInfo(batch, sourceTaskMap).length > 0 ||
      !this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap) ||
      Boolean(this.stockSourceUsageOrderIssue(line, batch, sourceTaskMap, selectedSources, availableBatches, currentOrderId))
    );
  }

  private stockSourceUsageOrderIssue(
    line: any,
    batch: any,
    sourceTaskMap: Map<string, any>,
    selectedSources: ReturnType<OrdersService['jsonToStockSourceSelections']>,
    availableBatches: any[],
    currentOrderId?: string
  ) {
    const selectedQuantityMap = new Map(selectedSources.map((source) => [source.batchId, source.quantity]));
    const selectedOrderIndexMap = new Map(selectedSources.map((source, index) => [source.batchId, index]));
    const currentSelectedIndex = selectedOrderIndexMap.get(batch.id);
    const currentQuantity = this.stockBatchAvailableQuantity(batch, currentOrderId);
    const currentCompatibilityRank = this.stockBatchCompatibilityRank(line, batch, sourceTaskMap);
    const requiredQuantity =
      this.normalizeFulfillmentMode(line.fulfillmentMode) === OrderLineFulfillmentMode.REWORK
        ? decimalToNumber(this.resolveProductionPlanQuantity(line))
        : decimalToNumber(line.quantity);
    const smallerBatch = availableBatches
      .filter(
        (candidate) =>
          candidate.id !== batch.id &&
          candidate.unit === batch.unit &&
          String(candidate.partCode || '').trim().toLocaleLowerCase() === String(batch.partCode || '').trim().toLocaleLowerCase() &&
          this.stockBatchCompatibilityRank(line, candidate, sourceTaskMap) === currentCompatibilityRank
      )
      .sort((left, right) => this.stockBatchAvailableQuantity(left, currentOrderId) - this.stockBatchAvailableQuantity(right, currentOrderId))
      .find((candidate) => {
        const selectedQuantity = selectedQuantityMap.get(candidate.id) || 0;
        const candidateSelectedIndex = selectedOrderIndexMap.get(candidate.id);
        const candidateAvailableQuantity = this.stockBatchAvailableQuantity(candidate, currentOrderId);
        const expectedEarlierUseQuantity = Math.min(candidateAvailableQuantity, requiredQuantity || candidateAvailableQuantity);
        const smallerQuantity = candidateAvailableQuantity > 0 && candidateAvailableQuantity + 0.0001 < currentQuantity;
        const notFullyUsed = selectedQuantity + 0.0001 < expectedEarlierUseQuantity;
        const selectedAfterCurrent =
          currentSelectedIndex !== undefined &&
          candidateSelectedIndex !== undefined &&
          candidateSelectedIndex > currentSelectedIndex;
        return smallerQuantity && (notFullyUsed || selectedAfterCurrent);
      });
    return smallerBatch ? `未优先使用较小库存批次 ${smallerBatch.batchNo}` : '';
  }

  private stockSourceMissingOrderInfo(line: any) {
    return [
      !String(line.drawingNo || '').trim() ? '图号' : '',
      !String(line.drawingVersion || '').trim() ? '图纸版本' : '',
      !String(line.partSpecification || '').trim() ? '成品规格' : '',
      decimalToNumber(line.partThickness) <= 0 ? '零件厚度' : ''
    ].filter(Boolean);
  }

  private directStockSourceMissingDrawingInfo(batch: any, sourceTaskMap: Map<string, any>) {
    const sourceLine = this.resolveStockBatchSourceLine(batch, sourceTaskMap);
    if (!sourceLine) {
      return ['图纸资料'];
    }
    return [
      !String(sourceLine.drawingNo || '').trim() ? '图号' : '',
      !String(sourceLine.drawingVersion || '').trim() ? '图纸版本' : '',
      !String(sourceLine.drawingFileUrl || '').trim() ? '图纸文件' : ''
    ].filter(Boolean);
  }

  private sourceLineHasDirectStockDrawingInfo(sourceLine: any) {
    return Boolean(
      String(sourceLine.drawingNo || '').trim() &&
        String(sourceLine.drawingVersion || '').trim() &&
        String(sourceLine.drawingFileUrl || '').trim()
    );
  }

  private requiredTextMatches(required?: string | null, actual?: string | null) {
    const normalizedRequired = String(required ?? '').trim().toLocaleLowerCase();
    if (!normalizedRequired) {
      return true;
    }
    return normalizedRequired === String(actual ?? '').trim().toLocaleLowerCase();
  }

  private requiredNumberMatches(required?: number | Prisma.Decimal | null, actual?: number | Prisma.Decimal | null) {
    const requiredNumber = decimalToNumber(required);
    if (!requiredNumber) {
      return true;
    }
    const actualNumber = decimalToNumber(actual);
    if (!actualNumber) {
      return false;
    }
    return Math.abs(requiredNumber - actualNumber) < 0.0001;
  }

  private async releaseUnstartedLineStock(tx: Prisma.TransactionClient, order: any, line: any, reason: string) {
    const allocationBatches = (line.inventoryBatches || []).filter(
      (batch: any) => batch.sourceOrderId && batch.status === 'AVAILABLE' && decimalToNumber(batch.quantity) > 0
    );

    for (const batch of allocationBatches) {
      const quantity = decimalToNumber(batch.quantity);
      await tx.inventoryTransaction.create({
        data: {
          transactionNo: this.buildOrderCancelTransactionNo('OUT', order.orderNo, line.lineNo),
          transactionType: 'OUT',
          batchId: batch.id,
          orderLineId: line.id,
          partCode: batch.partCode,
          partName: batch.partName,
          orderNo: order.orderNo,
          productionTaskNo: batch.sourceProductionTaskNo,
          quantity,
          unit: batch.unit,
          warehouseId: batch.warehouseId,
          locationId: batch.locationId,
          remark: `取消订单释放订单库存：${reason}`,
          sourceRecordType: 'OrderCancellation',
          sourceRecordId: line.id
        }
      });
      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: { quantity: 0, status: 'USED' }
      });
    }

    const consumedTransactions = await tx.inventoryTransaction.findMany({
      where: {
        transactionType: 'OUT',
        sourceRecordId: line.id,
        sourceRecordType: { in: ['OrderLineSTOCK', 'OrderLineREWORK'] }
      },
      orderBy: { createdAt: 'asc' }
    });

    for (const transaction of consumedTransactions) {
      const quantity = decimalToNumber(transaction.quantity);
      if (!transaction.batchId || quantity <= 0) {
        continue;
      }

      const sourceBatch = await tx.inventoryBatch.findUnique({ where: { id: transaction.batchId } });
      if (!sourceBatch) {
        continue;
      }

      // 未开工订单取消时，必须把已占用的备货库存退回原批次，并追加 IN 流水，不能直接改订单状态。
      await tx.inventoryBatch.update({
        where: { id: sourceBatch.id },
        data: {
          quantity: this.roundQuantity(decimalToNumber(sourceBatch.quantity) + quantity),
          status: 'AVAILABLE'
        }
      });
      await tx.inventoryTransaction.create({
        data: {
          transactionNo: this.buildOrderCancelTransactionNo('IN', order.orderNo, line.lineNo),
          transactionType: 'IN',
          batchId: sourceBatch.id,
          orderLineId: line.id,
          partCode: transaction.partCode,
          partName: transaction.partName,
          orderNo: null,
          productionTaskNo: transaction.productionTaskNo,
          quantity,
          unit: transaction.unit,
          warehouseId: transaction.warehouseId,
          locationId: transaction.locationId,
          remark: `取消订单退回备货库存：${reason}`,
          sourceRecordType: 'OrderCancellationReleaseStock',
          sourceRecordId: line.id
        }
      });
    }
  }

  private buildOrderCancelTransactionNo(direction: 'IN' | 'OUT', orderNo: string, lineNo: number) {
    return `IT-CANCEL-${direction}-${orderNo}-${String(lineNo).padStart(3, '0')}-${randomUUID()
      .slice(0, 8)
      .toUpperCase()}`;
  }

  private async upsertMaterials(tx: Prisma.TransactionClient, lines: CreateOrderDto['lines']) {
    const materialMap = new Map<
      string,
      {
        partCode: string;
        partName: string;
        unit: string;
        partSpecification?: string;
      }
    >();

    for (const line of lines) {
      const partCode = line.partCode.trim();
      const partName = line.partName.trim();
      const unit = line.unit.trim();
      if (!partCode || !partName || !unit) {
        continue;
      }
      materialMap.set(partCode.toLocaleLowerCase(), {
        partCode,
        partName,
        unit,
        partSpecification: line.partSpecification?.trim() || undefined
      });
    }

    for (const material of materialMap.values()) {
      const existing = await tx.material.findFirst({
        where: { partCode: { equals: material.partCode, mode: 'insensitive' } },
        select: { id: true, partSpecification: true }
      });

      if (existing) {
        await tx.material.update({
          where: { id: existing.id },
          data: {
            partName: material.partName,
            unit: material.unit,
            partSpecification: material.partSpecification ?? existing.partSpecification,
            status: 'ENABLED'
          }
        });
        continue;
      }

      // 新订单里出现的新零件同步进入物料基础清单，库存页才能在 0 库存时搜索到它。
      await tx.material.create({
        data: {
          partCode: material.partCode,
          partName: material.partName,
          unit: material.unit,
          partSpecification: material.partSpecification
        }
      });
    }
  }

  private async generateOrderNo(orderDate: Date) {
    const dateKey = orderDate.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `SO-${dateKey}-`;
    const [existingOrders, reservedOrderNos] = await Promise.all([
      this.prisma.customerOrder.findMany({
        where: { orderNo: { startsWith: prefix } },
        select: { orderNo: true }
      }),
      this.prisma.orderNoReservation.findMany({
        where: { orderNoNormalized: { startsWith: prefix } },
        select: { orderNoNormalized: true }
      })
    ]);
    const usedOrderNos = new Set([
      ...existingOrders.map((order) => this.normalizeOrderNo(order.orderNo)),
      ...reservedOrderNos.map((reservation) => this.normalizeOrderNo(reservation.orderNoNormalized))
    ]);

    // 自动生成时按日期前缀递增，并跳过所有已占用编号；取消订单的编号也会永久保留。
    for (let index = 1; index < 10000; index += 1) {
      const orderNo = `${prefix}${String(index).padStart(3, '0')}`;
      if (!usedOrderNos.has(orderNo)) {
        return orderNo;
      }
    }
    throw new BadRequestException('当前日期没有可用订单号');
  }

  private async reserveOrderNo(
    tx: Prisma.TransactionClient,
    orderNo: string,
    sourceOrderId?: string,
    reservedReason = 'ORDER_CREATED'
  ) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    try {
      await tx.orderNoReservation.create({
        data: {
          orderNo: normalizedOrderNo,
          orderNoNormalized: normalizedOrderNo,
          sourceOrderId,
          reservedReason
        }
      });
    } catch (error) {
      if (this.isDuplicateOrderNoReservationError(error)) {
        throw new BadRequestException(`订单号 ${normalizedOrderNo} 已被占用，请修改后再保存`);
      }
      throw error;
    }
  }

  private async linkOrderNoReservation(
    tx: Prisma.TransactionClient,
    orderNo: string,
    sourceOrderId: string,
    reservedReason = 'ORDER_CREATED'
  ) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await tx.orderNoReservation.upsert({
      where: { orderNoNormalized: normalizedOrderNo },
      create: {
        orderNo: normalizedOrderNo,
        orderNoNormalized: normalizedOrderNo,
        sourceOrderId,
        reservedReason
      },
      update: {
        sourceOrderId,
        reservedReason
      }
    });
  }

  private async orderNoExists(orderNo: string, excludeOrderNo?: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const normalizedExcludeOrderNo = excludeOrderNo?.trim() ? this.normalizeOrderNo(excludeOrderNo) : undefined;
    const reservation = await this.prisma.orderNoReservation.findFirst({
      where: {
        orderNoNormalized: normalizedOrderNo,
        NOT: normalizedExcludeOrderNo ? { orderNoNormalized: normalizedExcludeOrderNo } : undefined
      },
      select: { id: true }
    });
    if (reservation) {
      return true;
    }

    const existing = await this.prisma.customerOrder.findFirst({
      where: {
        // 订单号查重必须大小写不敏感，避免 SO-xxx 和 so-xxx 被当成两个订单。
        orderNo: { equals: normalizedOrderNo, mode: 'insensitive' },
        NOT: normalizedExcludeOrderNo ? { orderNo: { equals: normalizedExcludeOrderNo, mode: 'insensitive' } } : undefined
      },
      select: { orderNo: true }
    });
    return Boolean(existing);
  }

  private async ensureOrderNoAvailable(orderNo: string, excludeOrderNo?: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    if (await this.orderNoExists(normalizedOrderNo, excludeOrderNo)) {
      throw new BadRequestException(`订单号 ${normalizedOrderNo} 已存在，请修改后再保存`);
    }
  }

  private normalizeOrderNo(orderNo: string) {
    // 手工输入订单号时统一转成大写，保证 URL、查重、生产任务编号使用同一套订单号。
    const normalizedOrderNo = orderNo.trim().toUpperCase();
    if (!normalizedOrderNo) {
      throw new BadRequestException('订单号不能为空');
    }
    return normalizedOrderNo;
  }

  private isDuplicateOrderNoError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (Array.isArray(error.meta?.target)
        ? error.meta.target.includes('orderNo')
        : JSON.stringify(error.meta || {}).includes('CustomerOrder_orderNo_lower_key'))
    );
  }

  private isDuplicateOrderNoReservationError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (Array.isArray(error.meta?.target)
        ? error.meta.target.includes('orderNoNormalized')
        : JSON.stringify(error.meta || {}).includes('OrderNoReservation_orderNoNormalized_key'))
    );
  }

  private validateOrderLines(lines: CreateOrderDto['lines'], options: { requireStockSources?: boolean } = {}) {
    // 新增订单默认给 3 行方便录入，但允许删除误填行；业务上只要求订单至少保留 1 个零件。
    if (!lines || lines.length < 1) {
      throw new BadRequestException('订单至少需要一个零件');
    }

    lines.forEach((line, index) => {
      this.validateSingleOrderLine(line, `第 ${index + 1} 个零件`, Boolean(options.requireStockSources));
    });
  }

  private validateSingleOrderLine(line: CreateOrderLineDto, label = 'Order line', requireStockSources = true) {
    if (!line.partCode?.trim() || !line.partName?.trim() || !line.unit?.trim()) {
      throw new BadRequestException(`${label}资料不完整`);
    }
    if (!Number.isFinite(Number(line.partThickness)) || Number(line.partThickness) <= 0) {
      throw new BadRequestException(`${label}厚度必须大于 0`);
    }
    const orderQuantity = this.normalizeQuantity(line.quantity, `${label} quantity`);
    const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
    const productionPlanQuantity = this.normalizeQuantity(
      this.resolveProductionPlanQuantity(line),
      `${label} production plan quantity`,
      true
    );
    if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      const selectedQuantity = this.selectedStockSourceQuantity(line);
      if (requireStockSources && selectedQuantity <= 0) {
        throw new BadRequestException(`${label}必须先选择库存批次并完成来源核对`);
      }
      if (selectedQuantity > orderQuantity + 0.0001) {
        throw new BadRequestException(`${label}已选库存数量超过客户订单数量：需要 ${orderQuantity}，已选 ${selectedQuantity}`);
      }
    }
    this.validateStockSourceSelectionQuantity(line, label, fulfillmentMode, orderQuantity, productionPlanQuantity, requireStockSources);
  }

  private persistedOrderLineToValidationDto(line: any): CreateOrderLineDto {
    // 提交生产必须基于数据库中的草稿明细重新校验，不能只依赖前端创建/编辑时的校验结果。
    return {
      partCode: line.partCode,
      partName: line.partName,
      drawingNo: line.drawingNo || undefined,
      drawingVersion: line.drawingVersion || undefined,
      drawingFileName: line.drawingFileName || undefined,
      drawingFileUrl: line.drawingFileUrl || undefined,
      partThickness: decimalToNumber(line.partThickness),
      partSpecification: line.partSpecification || undefined,
      quantity: decimalToNumber(line.quantity),
      productionPlanQuantity: decimalToNumber(line.productionPlanQuantity ?? 0),
      productionPlanOverrideByCode: line.productionPlanOverrideByCode || undefined,
      productionPlanOverrideReason: line.productionPlanOverrideReason || undefined,
      fulfillmentMode: this.normalizeFulfillmentMode(line.fulfillmentMode || undefined),
      unit: line.unit,
      deliveryDate: line.deliveryDate ? new Date(line.deliveryDate).toISOString().slice(0, 10) : undefined,
      remark: line.remark || undefined,
      processSteps: this.processRowsToSnapshots(line.processSteps || []),
      selectedStockSources: this.jsonToStockSourceSelections(line.stockSourceSelections)
    };
  }

  private validateStockSourceSelectionQuantity(
    line: CreateOrderLineDto,
    label: string,
    fulfillmentMode: OrderLineFulfillmentMode,
    orderQuantity: number,
    productionPlanQuantity: number,
    requireStockSources = true
  ) {
    const selectedSources = this.normalizeStockSourceSelections(line.selectedStockSources);
    if (fulfillmentMode !== OrderLineFulfillmentMode.STOCK && fulfillmentMode !== OrderLineFulfillmentMode.REWORK) {
      if (selectedSources.length === 0) {
        return;
      }
      throw new BadRequestException(`${label}不是使用库存或库存再加工，不能保留库存来源选择`);
    }

    const requiredQuantity = fulfillmentMode === OrderLineFulfillmentMode.STOCK ? orderQuantity : productionPlanQuantity;
    const selectedQuantity = selectedSources.reduce((sum, source) => sum + source.quantity, 0);
    if (selectedSources.length === 0 || selectedQuantity <= 0) {
      if (!requireStockSources) {
        return;
      }
      throw new BadRequestException(`${label}必须先选择库存批次并完成来源核对`);
    }
    this.validateSelectedStockSourceManualConfirmations(selectedSources);
    // 草稿允许库存来源暂存未选满；提交生产时 REWORK 才必须选满领料数量。
    if (requireStockSources && fulfillmentMode !== OrderLineFulfillmentMode.STOCK && selectedQuantity + 0.0001 < requiredQuantity) {
      throw new BadRequestException(`${label}已选库存数量少于本次需要数量：需要 ${requiredQuantity}，已选 ${selectedQuantity}`);
    }
    if (selectedQuantity > requiredQuantity + 0.0001) {
      throw new BadRequestException(`${label}已选库存数量超过本次需要数量：需要 ${requiredQuantity}，已选 ${selectedQuantity}`);
    }
  }

  private selectedStockSourceQuantity(line: { stockSourceSelections?: Prisma.JsonValue | null; selectedStockSources?: CreateOrderLineDto['selectedStockSources'] }) {
    const sources =
      'selectedStockSources' in line
        ? this.normalizeStockSourceSelections(line.selectedStockSources)
        : this.jsonToStockSourceSelections(line.stockSourceSelections);
    return this.roundQuantity(sources.reduce((sum, source) => sum + source.quantity, 0));
  }

  private async validateOrderStockSourceSelections(
    lines: CreateOrderDto['lines'],
    currentOrder?: StockReservationPriorityOrder,
    client: Prisma.TransactionClient | PrismaService = this.prisma
  ) {
    const selectedRows = lines.flatMap((line, lineIndex) =>
      this.normalizeStockSourceSelections(line.selectedStockSources).map((source) => ({ line, lineIndex, source }))
    );
    if (selectedRows.length === 0) {
      return;
    }

    const batchIds = [...new Set(selectedRows.map((row) => row.source.batchId))];
    const batches = await client.inventoryBatch.findMany({
      where: {
        id: { in: batchIds },
        sourceOrderId: null,
        quantity: { gt: 0 },
        status: 'AVAILABLE'
      },
      include: {
        sourceOrderLine: true,
        productionTask: { include: { orderLine: true } },
        reservations: {
          where: { status: InventoryReservationStatus.ACTIVE },
          include: {
            order: { select: { orderNo: true, customerName: true, orderDate: true } },
            orderLine: { select: { lineNo: true, partCode: true, partName: true } }
          },
          orderBy: [{ createdAt: 'asc' }]
        }
      }
    });
    const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
    const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(client, batchIds, currentOrder);
    const selectedQuantityByBatchId = new Map<string, number>();
    for (const { source } of selectedRows) {
      selectedQuantityByBatchId.set(
        source.batchId,
        this.roundQuantity((selectedQuantityByBatchId.get(source.batchId) || 0) + source.quantity)
      );
    }
    for (const [batchId, selectedQuantity] of selectedQuantityByBatchId) {
      const batch = batchMap.get(batchId);
      if (!batch) {
        continue;
      }
      const reservedQuantity = reservedQuantityByBatchId.get(batchId) || 0;
      const availableQuantity = this.roundQuantity(decimalToNumber(batch.quantity) - reservedQuantity);
      if (availableQuantity + 0.0001 < selectedQuantity) {
        throw new BadRequestException(
          `已选库存批次 ${batch.batchNo} 可用库存不足：${this.stockAvailabilitySummary(
            [{ ...batch, reservedByOtherOrders: reservedQuantity, availableQuantity: Math.max(availableQuantity, 0), selectedQuantity }],
            currentOrder?.id
          )}，本次合计选用 ${selectedQuantity}`
        );
      }
    }
    const usageCandidateBatches = await this.findAvailableStockUsageCandidateBatches(client, batches, currentOrder?.id);
    const sourceTaskMap = await this.findStockSourceTaskMapByBatches(client, usageCandidateBatches);

    for (const { line, lineIndex, source } of selectedRows) {
      const label = `第 ${lineIndex + 1} 个零件`;
      const batch = batchMap.get(source.batchId);
      if (!batch) {
        throw new BadRequestException(`${label}已选库存批次 ${source.batchNo || source.batchId} 不存在或当前不可用`);
      }
      if (batch.unit !== line.unit) {
        throw new BadRequestException(`${label}已选库存批次 ${batch.batchNo} 的单位 ${batch.unit} 与订单单位 ${line.unit} 不一致`);
      }
      const batchReservedQuantity = reservedQuantityByBatchId.get(batch.id) || 0;
      const batchAvailableQuantity = this.roundQuantity(decimalToNumber(batch.quantity) - batchReservedQuantity);
      if (batchAvailableQuantity + 0.0001 < source.quantity) {
        throw new BadRequestException(
          `${label}已选库存批次 ${batch.batchNo} 的使用数量超过当前可用库存：${this.stockAvailabilitySummary(
            [{ ...batch, reservedByOtherOrders: batchReservedQuantity, availableQuantity: Math.max(batchAvailableQuantity, 0), selectedQuantity: source.quantity }],
            currentOrder?.id
          )}`
        );
      }

      const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
      const lineSources = this.normalizeStockSourceSelections(line.selectedStockSources);
      const usageOrderIssue = this.stockSourceUsageOrderIssue(
        line,
        batch,
        sourceTaskMap,
        lineSources,
        usageCandidateBatches,
        currentOrder?.id
      );
      if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
        if (
          this.stockSourceSelectionNeedsManualConfirmation(line, batch, sourceTaskMap, lineSources, usageCandidateBatches, currentOrder?.id) &&
          !this.stockSourceManualConfirmationComplete(source)
        ) {
          throw new BadRequestException(
            `${label}已选库存批次 ${batch.batchNo} 需要填写人工确认记录${usageOrderIssue ? `：${usageOrderIssue}` : ''}`
          );
        }
        continue;
      }

      const needsReworkManualConfirmation =
        !this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap) ||
        Boolean(usageOrderIssue);
      if (needsReworkManualConfirmation && !this.stockSourceManualConfirmationComplete(source)) {
        throw new BadRequestException(
          `${label}已选库存批次 ${batch.batchNo} 需要填写人工确认记录${usageOrderIssue ? `：${usageOrderIssue}` : ''}`
        );
      }
    }
  }

  private async activeReservationQuantityByBatchId(
    client: {
      inventoryReservation: {
        findMany: (args: any) => Promise<any[]>;
      };
      customerOrder?: {
        findUnique: (args: any) => Promise<any>;
      };
    },
    batchIds: string[],
    currentOrder?: string | StockReservationPriorityOrder
  ) {
    if (batchIds.length === 0) {
      return new Map<string, number>();
    }
    const currentPriorityOrder = await this.resolveStockReservationPriorityOrder(client, currentOrder);
    const rows = await client.inventoryReservation.findMany({
      where: {
        batchId: { in: batchIds },
        status: InventoryReservationStatus.ACTIVE,
        ...(currentPriorityOrder ? { orderId: { not: currentPriorityOrder.id } } : {})
      },
      select: {
        batchId: true,
        quantity: true,
        order: {
          select: {
            id: true,
            orderNo: true,
            status: true,
            createdAt: true
          }
        }
      }
    });
    const reservedQuantityByBatchId = new Map<string, number>();
    for (const row of rows) {
      if (!this.stockReservationConsumesAvailability(row.order, currentPriorityOrder)) {
        continue;
      }
      reservedQuantityByBatchId.set(
        row.batchId,
        this.roundQuantity((reservedQuantityByBatchId.get(row.batchId) || 0) + decimalToNumber(row.quantity))
      );
    }
    return reservedQuantityByBatchId;
  }

  private async resolveStockReservationPriorityOrder(
    client: { customerOrder?: { findUnique: (args: any) => Promise<any> } },
    currentOrder?: string | StockReservationPriorityOrder
  ) {
    if (!currentOrder) {
      return undefined;
    }
    if (typeof currentOrder !== 'string') {
      return currentOrder;
    }
    if (!client.customerOrder) {
      return undefined;
    }
    return (
      (await client.customerOrder.findUnique({
        where: { id: currentOrder },
        select: { id: true, orderNo: true, status: true, createdAt: true }
      })) || undefined
    );
  }

  private stockReservationConsumesAvailability(
    reservationOrder: StockReservationPriorityOrder,
    currentOrder?: StockReservationPriorityOrder
  ) {
    if (!currentOrder) {
      return true;
    }
    if (reservationOrder.id === currentOrder.id) {
      return false;
    }
    if (reservationOrder.status !== OrderStatus.DRAFT || currentOrder.status !== OrderStatus.DRAFT) {
      return true;
    }
    const createdAtDiff = reservationOrder.createdAt.getTime() - currentOrder.createdAt.getTime();
    if (createdAtDiff !== 0) {
      return createdAtDiff < 0;
    }
    return reservationOrder.orderNo.localeCompare(currentOrder.orderNo) < 0;
  }

  private async releaseOrderInventoryReservations(tx: Prisma.TransactionClient, orderId: string, reason: string) {
    await tx.inventoryReservation.updateMany({
      where: { orderId, status: InventoryReservationStatus.ACTIVE },
      data: {
        status: InventoryReservationStatus.RELEASED,
        statusReason: reason,
        releasedAt: new Date()
      }
    });
  }

  private reservationCarryoverKey(lineNo: number, batchId: string) {
    return `${lineNo}__${batchId}`;
  }

  private async findOrderReservationCarryovers(tx: Prisma.TransactionClient, orderId: string) {
    const reservations = await tx.inventoryReservation.findMany({
      where: { orderId, status: InventoryReservationStatus.ACTIVE },
      include: {
        orderLine: { select: { lineNo: true } }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const carryovers = new Map<string, InventoryReservationCarryover[]>();
    for (const reservation of reservations) {
      const lineNo = reservation.orderLine?.lineNo;
      if (!lineNo) {
        continue;
      }
      const key = this.reservationCarryoverKey(lineNo, reservation.batchId);
      const rows = carryovers.get(key) || [];
      rows.push({
        quantity: this.roundQuantity(decimalToNumber(reservation.quantity)),
        createdAt: reservation.createdAt
      });
      carryovers.set(key, rows);
    }
    return carryovers;
  }

  private buildReservationCreateRows(
    order: { id: string; orderNo: string },
    line: { id: string; lineNo: number; partCode: string; partName: string; unit: string },
    source: ReturnType<OrdersService['jsonToStockSourceSelections']>[number],
    carryovers: Map<string, InventoryReservationCarryover[]>
  ): Prisma.InventoryReservationCreateManyInput[] {
    const key = this.reservationCarryoverKey(line.lineNo, source.batchId);
    const sourceCarryovers = [...(carryovers.get(key) || [])];
    let remainingQuantity = this.roundQuantity(source.quantity);
    const rows: Prisma.InventoryReservationCreateManyInput[] = [];

    for (const carryover of sourceCarryovers) {
      if (remainingQuantity <= 0) {
        break;
      }
      const quantity = this.roundQuantity(Math.min(remainingQuantity, carryover.quantity));
      if (quantity <= 0) {
        continue;
      }
      rows.push({
        batchId: source.batchId,
        orderId: order.id,
        orderLineId: line.id,
        orderNo: order.orderNo,
        partCode: line.partCode,
        partName: line.partName,
        quantity,
        unit: line.unit,
        status: InventoryReservationStatus.ACTIVE,
        statusReason: 'DRAFT_ORDER_RESERVED',
        createdAt: carryover.createdAt
      });
      remainingQuantity = this.roundQuantity(remainingQuantity - quantity);
    }

    if (remainingQuantity > 0) {
      rows.push({
        batchId: source.batchId,
        orderId: order.id,
        orderLineId: line.id,
        orderNo: order.orderNo,
        partCode: line.partCode,
        partName: line.partName,
        quantity: remainingQuantity,
        unit: line.unit,
        status: InventoryReservationStatus.ACTIVE,
        statusReason: 'DRAFT_ORDER_RESERVED'
      });
    }

    return rows;
  }

  private async syncOrderInventoryReservations(
    tx: Prisma.TransactionClient,
    orderId: string,
    carryovers?: Map<string, InventoryReservationCarryover[]>
  ) {
    const order = await tx.customerOrder.findUnique({
      where: { id: orderId },
      include: { lines: { orderBy: { lineNo: 'asc' } } }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    const reservationCarryovers = carryovers || (await this.findOrderReservationCarryovers(tx, order.id));
    await this.releaseOrderInventoryReservations(tx, order.id, 'SYNC_ORDER_RESERVATION');

    const selectedRows = order.lines.flatMap((line) => {
      const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
      if (fulfillmentMode !== OrderLineFulfillmentMode.STOCK && fulfillmentMode !== OrderLineFulfillmentMode.REWORK) {
        return [];
      }
      return this.jsonToStockSourceSelections(line.stockSourceSelections).map((source) => ({ line, source }));
    });
    if (selectedRows.length === 0) {
      return;
    }

    const batchIds = [...new Set(selectedRows.map((row) => row.source.batchId))];
    const batches = await tx.inventoryBatch.findMany({
      where: {
        id: { in: batchIds },
        sourceOrderId: null,
        quantity: { gt: 0 },
        status: 'AVAILABLE'
      },
      include: {
        reservations: {
          where: { status: InventoryReservationStatus.ACTIVE },
          include: {
            order: { select: { orderNo: true, customerName: true, orderDate: true } },
            orderLine: { select: { lineNo: true, partCode: true, partName: true } }
          },
          orderBy: [{ createdAt: 'asc' }]
        }
      }
    });
    const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
    const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(tx, batchIds, order);
    const selectedQuantityByBatchId = new Map<string, number>();
    for (const { source } of selectedRows) {
      selectedQuantityByBatchId.set(
        source.batchId,
        this.roundQuantity((selectedQuantityByBatchId.get(source.batchId) || 0) + source.quantity)
      );
    }

    // 同一张草稿订单可能有多个零件共用一个库存批次，必须先按批次合计，再和扣除其他订单预占后的可用量比较。
    for (const [batchId, selectedQuantity] of selectedQuantityByBatchId) {
      const batch = batchMap.get(batchId);
      if (!batch) {
        throw new BadRequestException(`已选库存批次 ${batchId} 不存在或当前不可用`);
      }
      const reservedQuantity = reservedQuantityByBatchId.get(batchId) || 0;
      const availableQuantity = this.roundQuantity(decimalToNumber(batch.quantity) - reservedQuantity);
      if (availableQuantity + 0.0001 < selectedQuantity) {
        throw new BadRequestException(
          `库存批次 ${batch.batchNo} 可用库存不足：${this.stockAvailabilitySummary(
            [{ ...batch, reservedByOtherOrders: reservedQuantity, availableQuantity: Math.max(availableQuantity, 0), selectedQuantity }],
            order.id
          )}，本订单需要 ${selectedQuantity}`
        );
      }
    }

    const reservationRows = selectedRows.flatMap(({ line, source }) =>
      this.buildReservationCreateRows(order, line, source, reservationCarryovers)
    );
    if (reservationRows.length > 0) {
      await tx.inventoryReservation.createMany({ data: reservationRows });
    }
  }

  private async findStockSourceTaskMapByBatches(
    client: { productionTask: { findMany: (args: any) => Promise<any[]> } },
    batches: any[]
  ) {
    const taskNos = [...new Set(batches.map((batch) => batch.sourceProductionTaskNo).filter(Boolean))] as string[];
    if (taskNos.length === 0) {
      return new Map<string, any>();
    }
    const tasks = await client.productionTask.findMany({
      where: { productionTaskNo: { in: taskNos } },
      include: { orderLine: true }
    });
    return new Map(tasks.map((task) => [task.productionTaskNo, task]));
  }

  private normalizeFulfillmentMode(mode?: OrderLineFulfillmentMode | string) {
    if (!mode) {
      return OrderLineFulfillmentMode.PRODUCTION;
    }
    if (
      mode === OrderLineFulfillmentMode.PRODUCTION ||
      mode === OrderLineFulfillmentMode.STOCK ||
      mode === OrderLineFulfillmentMode.REWORK
    ) {
      return mode;
    }
    throw new BadRequestException('库存/生产方式无效');
  }

  private resolveProductionPlanQuantity(line: CreateOrderDto['lines'][number]) {
    const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
    if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      const suggestedQuantity = this.resolveStockSuggestedProductionQuantity(line);
      return line.productionPlanQuantity === undefined || line.productionPlanQuantity === null
        ? suggestedQuantity
        : this.roundQuantity(Number(line.productionPlanQuantity));
    }
    return line.productionPlanQuantity ?? line.quantity;
  }

  private resolveStockSuggestedProductionQuantity(line: {
    quantity: Prisma.Decimal | number | string | null | undefined;
    stockSourceSelections?: Prisma.JsonValue | null;
    selectedStockSources?: CreateOrderLineDto['selectedStockSources'];
  }) {
    return this.roundQuantity(Math.max(decimalToNumber(line.quantity) - this.selectedStockSourceQuantity(line), 0));
  }

  private resolveSuggestedProductionPlanQuantity(line: {
    fulfillmentMode?: OrderLineFulfillmentMode | string | null;
    quantity: Prisma.Decimal | number | string | null | undefined;
    stockSourceSelections?: Prisma.JsonValue | null;
    selectedStockSources?: CreateOrderLineDto['selectedStockSources'];
  }) {
    const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode || undefined);
    return fulfillmentMode === OrderLineFulfillmentMode.STOCK
      ? this.resolveStockSuggestedProductionQuantity(line)
      : this.roundQuantity(decimalToNumber(line.quantity));
  }

  private async prepareOrderLinePlans(lines: CreateOrderDto['lines']) {
    return Promise.all(lines.map((line, index) => this.prepareOrderLinePlan(line, `第 ${index + 1} 个零件`)));
  }

  private async prepareOrderLinePlan(line: CreateOrderDto['lines'][number], label: string): Promise<PreparedOrderLinePlan> {
    const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
    let productionPlanQuantity = this.normalizeQuantity(
      this.resolveProductionPlanQuantity(line),
      `${label} production plan quantity`,
      true
    );
    const suggestedQuantity = this.resolveSuggestedProductionPlanQuantity(line);
    const stockCoversCustomerQuantity =
      fulfillmentMode === OrderLineFulfillmentMode.STOCK &&
      suggestedQuantity <= 0 &&
      this.selectedStockSourceQuantity(line) + 0.0001 >= decimalToNumber(line.quantity);
    const hasExplicitProductionPlanOverride = Boolean(
      line.productionPlanOverrideByCode?.trim() || line.productionPlanOverrideReason?.trim()
    );
    if (stockCoversCustomerQuantity && productionPlanQuantity > 0 && !hasExplicitProductionPlanOverride) {
      productionPlanQuantity = suggestedQuantity;
    }

    if (Math.abs(productionPlanQuantity - suggestedQuantity) <= 0.0001) {
      return {
        productionPlanQuantity,
        productionPlanSuggestedQuantity: suggestedQuantity,
        productionPlanOverrideByCode: null,
        productionPlanOverrideByName: null,
        productionPlanOverrideByRole: null,
        productionPlanOverrideAt: null,
        productionPlanOverrideReason: null
      };
    }

    const reason = line.productionPlanOverrideReason?.trim();
    if (!reason) {
      throw new BadRequestException(`${label}生产计划数量与建议数量不一致，必须填写调整说明`);
    }
    const operator = await this.resolveSubmitPlanOperator(
      line.productionPlanOverrideByCode || '',
      '生产计划调整操作员'
    );
    return {
      productionPlanQuantity,
      productionPlanSuggestedQuantity: suggestedQuantity,
      productionPlanOverrideByCode: operator.accountId,
      productionPlanOverrideByName: operator.name,
      productionPlanOverrideByRole: operator.role,
      productionPlanOverrideAt: new Date(),
      productionPlanOverrideReason: reason
    };
  }

  private orderLinePlanData(plan: PreparedOrderLinePlan) {
    return {
      productionPlanQuantity: plan.productionPlanQuantity,
      productionPlanSuggestedQuantity: plan.productionPlanSuggestedQuantity,
      productionPlanOverrideByCode: plan.productionPlanOverrideByCode,
      productionPlanOverrideByName: plan.productionPlanOverrideByName,
      productionPlanOverrideByRole: plan.productionPlanOverrideByRole,
      productionPlanOverrideAt: plan.productionPlanOverrideAt,
      productionPlanOverrideReason: plan.productionPlanOverrideReason
    };
  }

  private hasProductionPlanOverrideRecord(line: {
    productionPlanOverrideByCode?: string | null;
    productionPlanOverrideByName?: string | null;
    productionPlanOverrideByRole?: string | null;
    productionPlanOverrideAt?: Date | string | null;
    productionPlanOverrideReason?: string | null;
  }) {
    const overrideAt = line.productionPlanOverrideAt ? new Date(line.productionPlanOverrideAt) : null;
    return Boolean(
      line.productionPlanOverrideByCode?.trim() &&
        line.productionPlanOverrideByName?.trim() &&
        line.productionPlanOverrideByRole?.trim() &&
        overrideAt &&
        !Number.isNaN(overrideAt.getTime()) &&
        line.productionPlanOverrideReason?.trim()
    );
  }

  private resolveSubmittedProductionPlanQuantity(line: {
    fulfillmentMode?: OrderLineFulfillmentMode | string | null;
    quantity: Prisma.Decimal | number | string | null | undefined;
    productionPlanQuantity: Prisma.Decimal | number | string | null | undefined;
    stockSourceSelections?: Prisma.JsonValue | null;
    selectedStockSources?: CreateOrderLineDto['selectedStockSources'];
  }) {
    const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode || undefined);
    if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      return this.roundQuantity(decimalToNumber(line.productionPlanQuantity ?? 0));
    }
    return this.roundQuantity(decimalToNumber(line.productionPlanQuantity ?? line.quantity));
  }

  private roundQuantity(value: number) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  private normalizeQuantity(value: unknown, label: string, allowZero = false) {
    const quantity = this.roundQuantity(Number(value));
    if (!Number.isFinite(quantity)) {
      throw new BadRequestException(`${label}必须是有效数字`);
    }
    if (allowZero ? quantity < 0 : quantity <= 0) {
      throw new BadRequestException(
        allowZero ? `${label}不能小于 0` : `${label}必须大于 0`
      );
    }
    return quantity;
  }

  private async normalizeProcessSteps(steps: CreateOrderLineDto['processSteps'] | undefined, requireOne = false): Promise<ProcessStepSnapshot[]> {
    const normalized = processSnapshotToDetails(steps || []).filter((step) => step.processName);
    if (requireOne && normalized.length === 0) {
      throw new BadRequestException('至少需要一道生产工序');
    }

    const seen = new Set<string>();
    for (const step of normalized) {
      const key = normalizeSearchKeyword(step.processName);
      if (seen.has(key)) {
        throw new BadRequestException(`生产流程存在重复工序：${step.processName}`);
      }
      seen.add(key);
    }
    await this.processDefinitionsService.ensureActiveNames(normalized.map((step) => step.processName));

    return normalized;
  }

  private processRowsToSnapshots(steps: Array<{ processName: string; processRemark?: string | null }>): ProcessStepSnapshot[] {
    return processSnapshotToDetails(steps.map((step) => ({ processName: step.processName, processRemark: step.processRemark || '' })));
  }

  private processStepsToJson(steps: ProcessStepSnapshot[]): Prisma.InputJsonValue {
    return steps.map((step) => ({
      processName: step.processName,
      ...(step.processRemark ? { processRemark: step.processRemark } : {})
    })) as Prisma.InputJsonValue;
  }

  private normalizeStockSourceSelections(selections: CreateOrderLineDto['selectedStockSources'] | undefined) {
    const normalized = new Map<
      string,
      {
        batchId: string;
        batchNo?: string;
        partCode?: string;
        partName?: string;
        quantity: number;
        unit?: string;
        replenishmentSourceType?: string;
        replenishmentSourceRequestNo?: string;
        replenishmentSourceLabel?: string;
        compatibilityStatus?: 'MATCHED' | 'NEEDS_CONFIRMATION' | 'INCOMPLETE' | 'UNKNOWN';
        compatibilityReason?: string;
        manualConfirmedBy?: string;
        manualConfirmedAt?: string;
        manualConfirmRemark?: string;
      }
    >();
    for (const selection of selections || []) {
      const batchId = selection.batchId?.trim();
      const quantity = this.roundQuantity(Number(selection.quantity || 0));
      if (!batchId || quantity <= 0) {
        continue;
      }
      const current = normalized.get(batchId);
      normalized.set(batchId, {
        batchId,
        batchNo: selection.batchNo?.trim() || current?.batchNo,
        partCode: selection.partCode?.trim() || current?.partCode,
        partName: selection.partName?.trim() || current?.partName,
        quantity: this.roundQuantity((current?.quantity || 0) + quantity),
        unit: selection.unit?.trim() || current?.unit,
        replenishmentSourceType: selection.replenishmentSourceType?.trim() || current?.replenishmentSourceType,
        replenishmentSourceRequestNo: selection.replenishmentSourceRequestNo?.trim() || current?.replenishmentSourceRequestNo,
        replenishmentSourceLabel: selection.replenishmentSourceLabel?.trim() || current?.replenishmentSourceLabel,
        compatibilityStatus: selection.compatibilityStatus || current?.compatibilityStatus,
        compatibilityReason: selection.compatibilityReason?.trim() || current?.compatibilityReason,
        manualConfirmedBy: selection.manualConfirmedBy?.trim() || current?.manualConfirmedBy,
        manualConfirmedAt: selection.manualConfirmedAt?.trim() || current?.manualConfirmedAt,
        manualConfirmRemark: selection.manualConfirmRemark?.trim() || current?.manualConfirmRemark
      });
    }
    return [...normalized.values()];
  }

  private stockSourceSelectionsToJson(selections: CreateOrderLineDto['selectedStockSources'] | undefined): Prisma.InputJsonValue | undefined {
    const normalized = this.normalizeStockSourceSelections(selections);
    return normalized.length > 0 ? (normalized as Prisma.InputJsonValue) : undefined;
  }

  private jsonToStockSourceSelections(value: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }
    return this.normalizeStockSourceSelections(
      value.map((item) => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        return {
          batchId: String(row.batchId || ''),
          batchNo: row.batchNo ? String(row.batchNo) : undefined,
          partCode: row.partCode ? String(row.partCode) : undefined,
          partName: row.partName ? String(row.partName) : undefined,
          quantity: Number(row.quantity || 0),
          unit: row.unit ? String(row.unit) : undefined,
          replenishmentSourceType: row.replenishmentSourceType ? String(row.replenishmentSourceType) : undefined,
          replenishmentSourceRequestNo: row.replenishmentSourceRequestNo ? String(row.replenishmentSourceRequestNo) : undefined,
          replenishmentSourceLabel: row.replenishmentSourceLabel ? String(row.replenishmentSourceLabel) : undefined,
          compatibilityStatus: this.normalizeStockCompatibilityStatus(row.compatibilityStatus),
          compatibilityReason: row.compatibilityReason ? String(row.compatibilityReason) : undefined,
          manualConfirmedBy: row.manualConfirmedBy ? String(row.manualConfirmedBy) : undefined,
          manualConfirmedAt: row.manualConfirmedAt ? String(row.manualConfirmedAt) : undefined,
          manualConfirmRemark: row.manualConfirmRemark ? String(row.manualConfirmRemark) : undefined
        };
      })
    );
  }

  private normalizeStockCompatibilityStatus(value: unknown) {
    if (value === 'MATCHED' || value === 'NEEDS_CONFIRMATION' || value === 'INCOMPLETE' || value === 'UNKNOWN') {
      return value;
    }
    return undefined;
  }

  private async findDuplicateOrderLines(field: 'drawingNo' | 'drawingFileName', value: string, excludeOrderNo?: string) {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return [];
    }

    const where: Prisma.OrderLineWhereInput =
      field === 'drawingNo'
        ? { drawingNo: { equals: normalizedValue, mode: 'insensitive' } }
        : { drawingFileName: { equals: normalizedValue, mode: 'insensitive' } };

    if (excludeOrderNo?.trim()) {
      where.order = { orderNo: { not: this.normalizeOrderNo(excludeOrderNo) } };
    }

    const lines = await this.prisma.orderLine.findMany({
      where,
      include: {
        order: {
          select: {
            orderNo: true,
            customerName: true,
            orderDate: true
          }
        }
      },
      orderBy: [{ updatedAt: 'desc' }]
    });

    return lines.map((line) => ({
      orderNo: line.order.orderNo,
      customerName: line.order.customerName,
      orderDate: line.order.orderDate,
      partCode: line.partCode,
      partName: line.partName,
      drawingNo: line.drawingNo,
      drawingVersion: line.drawingVersion,
      drawingFileName: line.drawingFileName,
      drawingFileUrl: line.drawingFileUrl
    }));
  }

  private toSummary(order: any) {
    const quantityByUnit = this.toOrderQuantityByUnit(order.lines);
    const totalQuantity = quantityByUnit.reduce((sum, row) => sum + row.totalQuantity, 0);
    const totalProductionPlanQuantity = quantityByUnit.reduce((sum, row) => sum + row.totalProductionPlanQuantity, 0);
    const unresolvedShortageInfo = this.toOrderUnresolvedShortageInfo(order.productionTasks || []);

    return {
      id: order.id,
      orderNo: order.orderNo,
      customerId: order.customerId,
      customerCode: order.customerCode,
      customerName: order.customerName,
      // 订单下拉需要按客户中文、拼音、首字母和订单号搜索；搜索文本由后端统一生成，避免各页面规则分裂。
      customerSearchText: buildPinyinSearchText([order.orderNo, order.customerCode, order.customerName]),
      orderDate: order.orderDate,
      deliveryDate: order.deliveryDate,
      status: order.status,
      partCount: order.lines.length,
      totalQuantity,
      totalProductionPlanQuantity,
      quantityByUnit,
      unit: order.lines[0]?.unit || '件',
      productionStatus: this.toOrderProductionStatus(order),
      warehouseStage: this.toOrderWarehouseStage(order),
      ...unresolvedShortageInfo,
      remark: order.remark,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };
  }

  private toOrderUnresolvedShortageInfo(tasks: any[]) {
    const shortageRecords = this.toShortageRecords(tasks) as any[];
    const records = this.toEffectiveUnresolvedShortageRecords(tasks);
    const pendingProductionRecords = shortageRecords.filter((record) => this.isPendingProductionReplenishmentRecord(record));
    const unresolvedQuantityInfo = this.toShortageQuantityInfo(records);
    const pendingProductionQuantityInfo = this.toShortageQuantityInfo(pendingProductionRecords);

    return {
      unresolvedShortageLineCount: unresolvedQuantityInfo.lineCount,
      unresolvedShortageQuantity: unresolvedQuantityInfo.quantity,
      unresolvedShortageUnit: unresolvedQuantityInfo.unit,
      unresolvedShortageQuantityByUnit: unresolvedQuantityInfo.quantityByUnit,
      needsReplenishmentAction: records.length > 0,
      pendingProductionReplenishmentLineCount: pendingProductionQuantityInfo.lineCount,
      pendingProductionReplenishmentQuantity: pendingProductionQuantityInfo.quantity,
      pendingProductionReplenishmentUnit: pendingProductionQuantityInfo.unit,
      pendingProductionReplenishmentQuantityByUnit: pendingProductionQuantityInfo.quantityByUnit,
      needsProductionReplenishmentReview: pendingProductionRecords.length > 0
    };
  }

  private toShortageQuantityInfo(records: any[]) {
    const lineKeys = new Set(records.map((record) => record.orderLineId || record.productionTaskNo));
    const unitMap = new Map<string, number>();
    for (const record of records) {
      const unit = record.unit || '件';
      unitMap.set(unit, (unitMap.get(unit) || 0) + record.shortageQuantity);
    }
    const quantityByUnit = Array.from(unitMap.entries())
      .map(([unit, quantity]) => ({ unit, quantity: this.roundQuantity(quantity) }))
      .sort((left, right) => left.unit.localeCompare(right.unit, 'zh-Hans-CN'));

    return {
      lineCount: lineKeys.size,
      quantity: this.roundQuantity(records.reduce((sum, record) => sum + record.shortageQuantity, 0)),
      unit: quantityByUnit.length === 1 ? quantityByUnit[0].unit : undefined,
      quantityByUnit
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
    // 订单可能包含不同计量单位，列表汇总必须按单位分组，避免把“件”和“米”等直接相加。
    return Array.from(unitMap.values()).sort((a, b) => a.unit.localeCompare(b.unit, 'zh-Hans-CN'));
  }

  private toOrderShippedQuantityByUnit(order: any) {
    const shippedQuantityByUnit = new Map<string, number>();
    const countedTransactionIds = new Set<string>();
    for (const line of order.lines || []) {
      for (const transaction of line.inventoryTransactions || []) {
        if (
          countedTransactionIds.has(transaction.id) ||
          transaction.transactionType !== InventoryTransactionType.OUT ||
          transaction.sourceRecordType !== 'InventoryBatch' ||
          transaction.orderNo !== order.orderNo
        ) {
          continue;
        }
        countedTransactionIds.add(transaction.id);
        const unit = transaction.unit || line.unit || '件';
        shippedQuantityByUnit.set(unit, (shippedQuantityByUnit.get(unit) || 0) + decimalToNumber(transaction.quantity));
      }
    }
    for (const batch of order.inventoryBatches || []) {
      if (!batch.sourceOrderId) {
        continue;
      }
      for (const transaction of batch.transactions || []) {
        if (
          countedTransactionIds.has(transaction.id) ||
          transaction.transactionType !== InventoryTransactionType.OUT ||
          transaction.sourceRecordType !== 'InventoryBatch' ||
          transaction.orderNo !== order.orderNo
        ) {
          continue;
        }
        countedTransactionIds.add(transaction.id);
        const unit = transaction.unit || batch.unit || '件';
        shippedQuantityByUnit.set(unit, (shippedQuantityByUnit.get(unit) || 0) + decimalToNumber(transaction.quantity));
      }
    }
    return shippedQuantityByUnit;
  }

  private allOrderQuantitiesReached(
    quantityByUnit: Array<{ unit: string; totalQuantity: number }>,
    actualQuantityByUnit: Map<string, number>
  ) {
    const targets = quantityByUnit.filter((row) => Number(row.totalQuantity || 0) > 0);
    if (targets.length === 0) {
      return false;
    }
    return targets.every((row) => (actualQuantityByUnit.get(row.unit || '件') || 0) + 0.0001 >= Number(row.totalQuantity || 0));
  }

  private totalQuantityFromUnitMap(quantityByUnit: Map<string, number>) {
    return Array.from(quantityByUnit.values()).reduce((sum, quantity) => sum + quantity, 0);
  }

  private toDetail(
    order: any,
    stockQuantityByTaskNo = new Map<string, number>(),
    stockSourceInfoByBatchId = new Map<string, ReturnType<OrdersService['toStockSourceSelectionInfo']>>()
  ) {
    return {
      ...this.toSummary(order),
      customer: order.customer,
      lines: order.lines.map((line: any) => ({
        id: line.id,
        lineNo: line.lineNo,
        partCode: line.partCode,
        partName: line.partName,
        drawingNo: line.drawingNo,
        drawingVersion: line.drawingVersion,
        drawingFileName: line.drawingFileName,
        drawingFileUrl: line.drawingFileUrl,
        partThickness: decimalToNumber(line.partThickness),
        partSpecification: line.partSpecification,
        quantity: decimalToNumber(line.quantity),
        productionPlanQuantity: decimalToNumber(line.productionPlanQuantity ?? line.quantity),
        productionPlanSuggestedQuantity:
          line.productionPlanSuggestedQuantity === null || line.productionPlanSuggestedQuantity === undefined
            ? undefined
            : decimalToNumber(line.productionPlanSuggestedQuantity),
        productionPlanOverrideByCode: line.productionPlanOverrideByCode,
        productionPlanOverrideByName: line.productionPlanOverrideByName,
        productionPlanOverrideByRole: line.productionPlanOverrideByRole,
        productionPlanOverrideAt: line.productionPlanOverrideAt,
        productionPlanOverrideReason: line.productionPlanOverrideReason,
        fulfillmentMode: line.fulfillmentMode,
        unit: line.unit,
        deliveryDate: line.deliveryDate,
        remark: line.remark,
        selectedStockSources: this.enrichSelectedStockSources(
          this.jsonToStockSourceSelections(line.stockSourceSelections),
          stockSourceInfoByBatchId
        ),
        processSteps: this.processRowsToSnapshots(line.processSteps).map((step) => step.processName),
        processStepDetails: this.processRowsToSnapshots(line.processSteps),
        productionTasks: this.toLineProductionTasks(line.productionTasks || [], stockQuantityByTaskNo),
        ...this.toLineWarehouseInfo(line, stockQuantityByTaskNo, order.orderNo)
      }))
    };
  }

  private async getStockSourceInfoByBatchId(batchIds: string[], currentOrderId?: string) {
    const ids = [...new Set(batchIds.filter(Boolean))];
    if (ids.length === 0) {
      return new Map<string, ReturnType<OrdersService['toStockSourceSelectionInfo']>>();
    }

    const [batches, reservedQuantityByBatchId] = await Promise.all([
      this.prisma.inventoryBatch.findMany({
        where: { id: { in: ids } },
        include: { productionTask: true }
      }),
      this.activeReservationQuantityByBatchId(this.prisma, ids, currentOrderId)
    ]);

    return new Map(
      batches.map((batch) => [
        batch.id,
        this.toStockSourceSelectionInfo(batch, reservedQuantityByBatchId.get(batch.id) || 0)
      ])
    );
  }

  private toStockSourceSelectionInfo(batch: any, reservedByOtherOrders = 0) {
    const replenishmentSourceType = batch.replenishmentSourceType || batch.productionTask?.replenishmentSourceType || undefined;
    const replenishmentSourceRequestNo =
      batch.replenishmentSourceRequestNo || batch.productionTask?.replenishmentSourceRequestNo || undefined;
    const physicalQuantity = batch.status === 'AVAILABLE' ? decimalToNumber(batch.quantity) : 0;
    return {
      batchId: batch.id,
      batchNo: batch.batchNo,
      partCode: batch.partCode,
      partName: batch.partName,
      availableQuantity: Math.max(this.roundQuantity(physicalQuantity - reservedByOtherOrders), 0),
      unit: batch.unit,
      replenishmentSourceType,
      replenishmentSourceRequestNo,
      replenishmentSourceLabel: this.stockSourceReplenishmentSourceLabel(replenishmentSourceType, replenishmentSourceRequestNo)
    };
  }

  private enrichSelectedStockSources(
    selectedSources: ReturnType<OrdersService['jsonToStockSourceSelections']>,
    stockSourceInfoByBatchId: Map<string, ReturnType<OrdersService['toStockSourceSelectionInfo']>>
  ) {
    return selectedSources.map((source) => {
      const sourceInfo = stockSourceInfoByBatchId.get(source.batchId);
      if (!sourceInfo) {
        return source;
      }
      return {
        ...source,
        batchNo: source.batchNo || sourceInfo.batchNo,
        partCode: source.partCode || sourceInfo.partCode,
        partName: source.partName || sourceInfo.partName,
        availableQuantity: sourceInfo.availableQuantity,
        unit: source.unit || sourceInfo.unit,
        replenishmentSourceType: source.replenishmentSourceType || sourceInfo.replenishmentSourceType,
        replenishmentSourceRequestNo: source.replenishmentSourceRequestNo || sourceInfo.replenishmentSourceRequestNo,
        replenishmentSourceLabel: source.replenishmentSourceLabel || sourceInfo.replenishmentSourceLabel
      };
    });
  }

  private toLineProductionTasks(tasks: any[], stockQuantityByTaskNo = new Map<string, number>()) {
    return tasks.map((task) => ({
      id: task.id,
      productionTaskNo: task.productionTaskNo,
      status: this.toEffectiveTaskProductionStatus(task),
      isReplenishment: task.isReplenishment,
      sourceProductionTaskNo: task.sourceProductionTaskNo,
      replenishmentSourceType: this.resolveTaskReplenishmentSourceType(task),
      replenishmentSourceRequestNo: task.replenishmentSourceRequestNo,
      replenishmentSourceLabel: this.resolveTaskReplenishmentSourceLabel(task),
      plannedQuantity: decimalToNumber(task.plannedQuantity),
      completedQuantity: this.toEffectiveTaskCompletedQuantity(
        task,
        stockQuantityByTaskNo.get(task.productionTaskNo) || 0
      ),
      canCancelReplenishment: Boolean(
        task.isReplenishment &&
          this.resolveTaskReplenishmentSourceType(task) !== 'PRODUCTION_SCRAP' &&
          !task.inventoryBatch &&
          !this.isStartedProductionTask(task)
      )
    }));
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

  private stockSourceReplenishmentSourceLabel(sourceType?: string | null, sourceRequestNo?: string | null) {
    if (!sourceType) {
      return undefined;
    }
    const sourceTypeText =
      sourceType === 'PRODUCTION_SCRAP'
        ? '生产报废补单'
        : sourceType === 'ORDER_CHANGE'
          ? '订单数量补单'
          : sourceType;
    return sourceRequestNo ? `${sourceTypeText}：${sourceRequestNo}` : sourceTypeText;
  }

  private toOrderWarehouseStage(order: any) {
    if (order.status === OrderStatus.DRAFT) {
      return 'ORDER_DRAFT';
    }
    if (order.status === OrderStatus.CANCELLED) {
      return 'ORDER_CANCELLED';
    }
    if (order.status === OrderStatus.COMPLETED) {
      // 第一阶段订单 COMPLETED 只由仓库全量发货关闭订单产生，列表必须显示为已完成发货。
      return 'SHIPPED';
    }

    const tasks = order.productionTasks || [];
    const orderBatches = (order.inventoryBatches || []).filter((batch: any) => batch.sourceOrderId);
    if (tasks.length === 0 && orderBatches.length === 0) {
      return 'WAITING_PRODUCTION';
    }

    const finishedCount = tasks.filter((task: any) => this.isTaskWarehouseFinished(task)).length;
    const shippedCount = tasks.filter((task: any) => this.isTaskOrderBatchShipped(task)).length;
    const availableOrderBatchCount = orderBatches.filter((batch: any) => batch.status === 'AVAILABLE').length;
    const shippedOrderBatchCount = orderBatches.filter((batch: any) => batch.status === 'USED').length;
    const quantityByUnit = this.toOrderQuantityByUnit(order.lines || []);
    const shippedQuantityByUnit = this.toOrderShippedQuantityByUnit(order);
    const taskStatuses = tasks.map((task: any) => this.toEffectiveTaskProductionStatus(task));
    const productionFinished = tasks.length === 0 || taskStatuses.every((status: ProductionStatus) => status === ProductionStatus.COMPLETED);
    if (!productionFinished) {
      if (taskStatuses.some((status: ProductionStatus) => status !== ProductionStatus.PENDING)) {
        return 'IN_PRODUCTION_STAGE';
      }
      return 'WAITING_PRODUCTION';
    }

    const allTasksFinished = tasks.length === 0 || finishedCount === tasks.length;
    if (allTasksFinished && this.allOrderQuantitiesReached(quantityByUnit, shippedQuantityByUnit)) {
      return 'SHIPPED';
    }
    if (shippedCount > 0 || shippedOrderBatchCount > 0 || this.totalQuantityFromUnitMap(shippedQuantityByUnit) > 0) {
      return 'PARTIAL_SHIPPED';
    }

    if (tasks.some((task: any) => task.status === 'COMPLETED' && !task.inventoryBatch)) {
      return 'WAITING_RECEIPT';
    }

    if (availableOrderBatchCount > 0 || tasks.some((task: any) => this.isTaskOrderBatchAvailable(task))) {
      return 'WAITING_SHIPMENT';
    }

    if (tasks.some((task: any) => task.status === 'IN_PROGRESS')) {
      return 'IN_PRODUCTION_STAGE';
    }

    return 'WAITING_PRODUCTION';
  }

  private toOrderProductionStatus(order: any): ProductionStatus {
    if (order.status === OrderStatus.COMPLETED) {
      return ProductionStatus.COMPLETED;
    }

    const tasks = order.productionTasks || [];
    const orderBatches = (order.inventoryBatches || []).filter((batch: any) => batch.sourceOrderId);
    if (tasks.length === 0) {
      return orderBatches.length > 0 ? ProductionStatus.COMPLETED : ProductionStatus.PENDING;
    }

    const taskStatuses = tasks.map((task: any) => this.toEffectiveTaskProductionStatus(task));
    if (taskStatuses.every((status: ProductionStatus) => status === ProductionStatus.COMPLETED)) {
      return ProductionStatus.COMPLETED;
    }
    // 只要已有任务开工或部分任务完成，订单级生产状态就不再显示为待确认生产。
    if (taskStatuses.some((status: ProductionStatus) => status !== ProductionStatus.PENDING)) {
      return ProductionStatus.IN_PROGRESS;
    }
    return ProductionStatus.PENDING;
  }

  private orderMatchesProductionFilter(order: any, productionStatuses: OrderProductionFilterStatus[]) {
    const displayStatus = this.toOrderProductionFilterStatus(order);
    if (productionStatuses.includes(displayStatus)) {
      return true;
    }
    // 兼容旧查询值：PENDING / IN_PROGRESS / COMPLETED。
    return productionStatuses.includes(order.productionStatus);
  }

  private toOrderProductionFilterStatus(order: { status: OrderStatus; productionStatus: ProductionStatus; warehouseStage?: string }) {
    if (order.status === OrderStatus.DRAFT) {
      return 'ORDER_DRAFT';
    }
    if (order.status === OrderStatus.CANCELLED) {
      return 'ORDER_CANCELLED';
    }
    if (order.warehouseStage === 'SHIPPED') {
      return 'ORDER_SHIPPED_COMPLETED';
    }
    if (order.status === OrderStatus.COMPLETED) {
      return 'ORDER_SHIPPED_COMPLETED';
    }
    if (order.warehouseStage === 'PARTIAL_SHIPPED') {
      return 'PARTIAL_SHIPPED';
    }
    if (
      order.productionStatus === ProductionStatus.COMPLETED ||
      order.warehouseStage === 'WAITING_RECEIPT' ||
      order.warehouseStage === 'WAITING_SHIPMENT'
    ) {
      return 'ORDER_COMPLETED_UNSHIPPED';
    }
    if (
      order.status === OrderStatus.IN_PRODUCTION ||
      order.productionStatus === ProductionStatus.IN_PROGRESS ||
      order.warehouseStage === 'IN_PRODUCTION_STAGE'
    ) {
      return 'ORDER_IN_PRODUCTION';
    }
    return 'WAITING_PRODUCTION';
  }

  private parseEnumList<T extends string>(value: string | undefined, allowedValues: T[], fieldName: string) {
    if (!value) {
      return [];
    }

    const values = Array.from(
      new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
    const invalidValues = values.filter((item) => !allowedValues.includes(item as T));
    if (invalidValues.length > 0) {
      throw new BadRequestException(`${fieldName}不正确：${invalidValues.join('、')}`);
    }

    return values as T[];
  }

  private toLineWarehouseInfo(line: any, stockQuantityByTaskNo = new Map<string, number>(), orderNo?: string) {
    const tasks = line.productionTasks || [];
    const lineBatches = (line.inventoryBatches || []).filter((batch: any) => batch.sourceOrderId);
    const visibleLineBatch =
      lineBatches.find((batch: any) => batch.status === 'AVAILABLE') ||
      lineBatches.find((batch: any) => batch.status === 'USED');
    if (tasks.length === 0) {
      if (visibleLineBatch) {
        const shippedQuantity = this.toLineShippedQuantity(line, orderNo);
        const warehouseStage =
          shippedQuantity + 0.0001 >= decimalToNumber(line.quantity)
            ? 'SHIPPED'
            : shippedQuantity > 0
              ? 'PARTIAL_SHIPPED'
              : 'WAITING_SHIPMENT';
        return {
          productionTaskNo: null,
          productionStatus: null,
          // STOCK 直接使用库存没有生产任务；发货后批次当前剩余会变成 0，订单明细仍应显示客户订单数量。
          completedQuantity: decimalToNumber(line.quantity),
          productionTaskCount: 0,
          productionShortageQuantity: 0,
          productionScrapQuantity: 0,
          productionShortageMode: null,
          productionReplenishmentTaskNos: [],
          productionReplenishmentRequestNos: [],
          productionShortageReasons: [],
          productionProgressText: '使用库存，无生产工序',
          warehouseStage,
          inventoryBatchNo: visibleLineBatch.batchNo,
          inventoryStatus: visibleLineBatch.status,
          warehouseName: visibleLineBatch.warehouse?.warehouseName || null,
          locationName: visibleLineBatch.location?.locationName || null
        };
      }
      return {
        productionTaskNo: null,
        productionStatus: null,
        completedQuantity: 0,
        productionTaskCount: 0,
        productionShortageQuantity: 0,
        productionScrapQuantity: 0,
        productionShortageMode: null,
        productionReplenishmentTaskNos: [],
        productionReplenishmentRequestNos: [],
        productionShortageReasons: [],
        productionProgressText: '尚未生成生产任务',
        warehouseStage: 'ORDER_DRAFT',
        inventoryBatchNo: null,
        inventoryStatus: null,
        warehouseName: null,
        locationName: null
      };
    }

    // 一个订单零件可能因为报废补单生成多个生产任务，明细页必须按全部任务汇总阶段，避免原任务发货后误判零件已结束。
    const primaryTask = tasks[0];
    const visibleBatch =
      lineBatches.find((batch: any) => batch.status === 'AVAILABLE') ||
      lineBatches.find((batch: any) => batch.status === 'USED') ||
      tasks.find((task: any) => task.inventoryBatch?.sourceOrderId && task.inventoryBatch.status === 'AVAILABLE')?.inventoryBatch ||
      tasks.find((task: any) => task.inventoryBatch?.sourceOrderId && task.inventoryBatch.status === 'USED')?.inventoryBatch ||
      primaryTask.inventoryBatch;
    const finishedCount = tasks.filter((task: any) => this.isTaskWarehouseFinished(task)).length;
    const shippedCount = tasks.filter((task: any) => this.isTaskOrderBatchShipped(task)).length;
    const shippedQuantity = this.toLineShippedQuantity(line, orderNo);
    const shortageInfo = this.toLineShortageInfo(tasks);
    const taskStatuses = tasks.map((task: any) => this.toEffectiveTaskProductionStatus(task));
    const productionFinished = taskStatuses.every((status: ProductionStatus) => status === ProductionStatus.COMPLETED);
    const stockCoveredQuantity =
      line.fulfillmentMode === OrderLineFulfillmentMode.STOCK
        ? Math.max(decimalToNumber(line.quantity) - decimalToNumber(line.productionPlanQuantity), 0)
        : 0;
    let warehouseStage = 'WAITING_PRODUCTION';
    if (!productionFinished) {
      if (taskStatuses.some((status: ProductionStatus) => status !== ProductionStatus.PENDING)) {
        warehouseStage = 'IN_PRODUCTION_STAGE';
      }
    } else if (
      shippedQuantity + 0.0001 >= decimalToNumber(line.quantity) &&
      finishedCount === tasks.length
    ) {
      warehouseStage = 'SHIPPED';
    } else if (shippedQuantity > 0 || shippedCount > 0) {
      warehouseStage = 'PARTIAL_SHIPPED';
    } else if (tasks.some((task: any) => task.status === 'COMPLETED' && !task.inventoryBatch)) {
      warehouseStage = 'WAITING_RECEIPT';
    } else if (lineBatches.some((batch: any) => batch.status === 'AVAILABLE') || tasks.some((task: any) => this.isTaskOrderBatchAvailable(task))) {
      warehouseStage = 'WAITING_SHIPMENT';
    } else if (tasks.some((task: any) => task.status === 'IN_PROGRESS')) {
      warehouseStage = 'IN_PRODUCTION_STAGE';
    }

    return {
      productionTaskNo:
        tasks.length === 1 ? primaryTask.productionTaskNo : `${primaryTask.productionTaskNo} 等 ${tasks.length} 个任务`,
      productionStatus: tasks.every((task: any) => this.toEffectiveTaskProductionStatus(task) === 'COMPLETED')
        ? 'COMPLETED'
        : tasks.some((task: any) => this.toEffectiveTaskProductionStatus(task) === 'IN_PROGRESS')
          ? 'IN_PROGRESS'
          : 'PENDING',
      completedQuantity: tasks.reduce(
        (sum: number, task: any) =>
          sum + this.toEffectiveTaskCompletedQuantity(task, stockQuantityByTaskNo.get(task.productionTaskNo) || 0),
        stockCoveredQuantity
      ),
      productionTaskCount: tasks.length,
      ...shortageInfo,
      productionProgressText:
        stockCoveredQuantity > 0
          ? `库存已覆盖 ${stockCoveredQuantity} ${line.unit || '件'}；${this.formatLineProductionProgress(tasks)}`
          : this.formatLineProductionProgress(tasks),
      warehouseStage,
      inventoryBatchNo: visibleBatch?.batchNo || null,
      inventoryStatus: visibleBatch?.status || null,
      warehouseName: visibleBatch?.warehouse?.warehouseName || null,
      locationName: visibleBatch?.location?.locationName || null
    };
  }

  private formatLineProductionProgress(tasks: any[]) {
    // 订单变更和补单必须让操作人员先看到当前零件进行到哪一道工序，避免把已生产数量变更误当成待提交生产订单修改。
    if (tasks.length === 0) {
      return '尚未生成生产任务';
    }

    const summaries = tasks.map((task) => {
      const steps = processSnapshotToArray(task.processSnapshot);
      const completedNames = (task.processCompletions || [])
        .filter((completion: any) => completion.isCompleted)
        .map((completion: any) => completion.processName);
      const nextStep = steps.find((step) => !completedNames.includes(step));
      const taskNo = task.productionTaskNo;
      if (task.inventoryBatch) {
        return `${taskNo} 已入库`;
      }
      if (task.status === ProductionStatus.COMPLETED) {
        return `${taskNo} 已完成，等待仓库`;
      }
      if (task.status === ProductionStatus.PENDING && completedNames.length === 0) {
        return `${taskNo} 待确认生产`;
      }
      if (completedNames.length === 0) {
        return `${taskNo} 已开始，下一道 ${nextStep || '待确认完成'}`;
      }
      return `${taskNo} 已完成 ${completedNames.join('、')}，下一道 ${nextStep || '待确认完成'}`;
    });

    return summaries.join('；');
  }

  private isTaskOrderBatchAvailable(task: any) {
    return Boolean(task.inventoryBatch?.sourceOrderId && task.inventoryBatch.status === 'AVAILABLE');
  }

  private isTaskOrderBatchShipped(task: any) {
    return Boolean(task.inventoryBatch?.sourceOrderId && task.inventoryBatch.status === 'USED');
  }

  private toLineShippedQuantity(line: any, orderNo?: string) {
    const countedTransactionIds = new Set<string>();
    let lineShipmentQuantity = 0;
    for (const transaction of line.inventoryTransactions || []) {
      if (
        countedTransactionIds.has(transaction.id) ||
        transaction.transactionType !== InventoryTransactionType.OUT ||
        transaction.sourceRecordType !== 'InventoryBatch' ||
        (orderNo && transaction.orderNo !== orderNo)
      ) {
        continue;
      }
      countedTransactionIds.add(transaction.id);
      lineShipmentQuantity += decimalToNumber(transaction.quantity);
    }
    return lineShipmentQuantity + (line.inventoryBatches || []).reduce((sum: number, batch: any) => {
      if (!batch.sourceOrderId) {
        return sum;
      }
      return (
        sum +
        (batch.transactions || []).reduce((batchSum: number, transaction: any) => {
          if (
            countedTransactionIds.has(transaction.id) ||
            transaction.transactionType !== InventoryTransactionType.OUT ||
            transaction.sourceRecordType !== 'InventoryBatch' ||
            (orderNo && transaction.orderNo !== orderNo)
          ) {
            return batchSum;
          }
          countedTransactionIds.add(transaction.id);
          return batchSum + decimalToNumber(transaction.quantity);
        }, 0)
      );
    }, 0);
  }

  private isTaskWarehouseFinished(task: any) {
    // 已经入库的历史任务可能仍保留旧的 IN_PROGRESS 状态；订单页必须以仓库批次为准，避免误判还在生产。
    return Boolean(
      task.inventoryBatch &&
        (task.inventoryBatch.sourceOrderId === null || task.inventoryBatch.status === 'USED')
    );
  }

  private toEffectiveTaskProductionStatus(task: any) {
    if (task.inventoryBatch || task.status === 'COMPLETED') {
      return 'COMPLETED';
    }
    return task.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PENDING';
  }

  private toEffectiveTaskCompletedQuantity(task: any, stockQuantity = 0) {
    const completedQuantity = decimalToNumber(task.completedQuantity);
    if (completedQuantity > 0) {
      return completedQuantity;
    }
    // 已入库但旧任务完成数为 0 时，用订单入库批次 + 多做备货批次数量兜底，保证订单明细不漏算超产转库存部分。
    return (task.inventoryBatch ? decimalToNumber(task.inventoryBatch.quantity) : 0) + stockQuantity;
  }

  private async getStockQuantityByTaskNo(taskNos: string[]) {
    const uniqueTaskNos = Array.from(new Set(taskNos.filter(Boolean)));
    const quantityMap = new Map<string, number>();
    if (uniqueTaskNos.length === 0) {
      return quantityMap;
    }

    const stockBatches = await this.prisma.inventoryBatch.findMany({
      where: {
        sourceOrderId: null,
        sourceProductionTaskNo: { in: uniqueTaskNos }
      }
    });

    for (const batch of stockBatches) {
      if (!batch.sourceProductionTaskNo) {
        continue;
      }
      quantityMap.set(
        batch.sourceProductionTaskNo,
        (quantityMap.get(batch.sourceProductionTaskNo) || 0) + decimalToNumber(batch.quantity)
      );
    }
    return quantityMap;
  }

  private finalProcessCompletion(task: any) {
    return (task.processCompletions || []).reduce((current: any, item: any) => {
      if (!current || item.stepNo > current.stepNo) {
        return item;
      }
      return current;
    }, null);
  }

  private toShortageRecords(tasks: any[]) {
    return tasks
      .map((task) => {
        const finalCompletion = this.finalProcessCompletion(task);
        return finalCompletion
          ? {
              completionId: finalCompletion.id,
              productionTaskNo: task.productionTaskNo,
              orderLineId: task.orderLineId,
              partCode: task.partCode,
              partName: task.partName,
              shortageQuantity: decimalToNumber(finalCompletion.shortageQuantity),
              scrapQuantity: decimalToNumber(finalCompletion.scrapQuantity),
              shortageMode: finalCompletion.shortageMode,
              replenishmentTaskNo: finalCompletion.replenishmentTaskNo,
              replenishmentRequestNo: finalCompletion.replenishmentRequests?.[0]?.requestNo,
              replenishmentRequestStatus: finalCompletion.replenishmentRequests?.[0]?.status,
              managerName: finalCompletion.managerName,
              shortageReason: finalCompletion.shortageReason,
              shortageResolutionMode: finalCompletion.shortageResolutionMode,
              shortageResolutionBy: finalCompletion.shortageResolutionBy,
              shortageResolutionReason: finalCompletion.shortageResolutionReason,
              shortageResolvedAt: finalCompletion.shortageResolvedAt,
              unit: finalCompletion.unit || task.unit || '件'
            }
          : null;
      })
      .filter((record) => record && record.shortageQuantity > 0);
  }

  private isUnresolvedShortageRecord(record: any) {
    return record.shortageMode === 'MANAGER_APPROVED' && !record.shortageResolutionMode;
  }

  private isPendingProductionReplenishmentRecord(record: any) {
    return (
      record.shortageMode === 'REPLENISHMENT_REQUEST' &&
      !record.replenishmentTaskNo &&
      record.replenishmentRequestStatus !== 'REJECTED'
    );
  }

  private toUnresolvedShortageRecords(tasks: any[]) {
    return this.toEffectiveUnresolvedShortageRecords(tasks);
  }

  private toLineShortageInfo(tasks: any[]) {
    const shortageRecords = this.toShortageRecords(tasks);
    const unresolvedShortageRecords = this.toEffectiveUnresolvedShortageRecords(tasks);

    const productionReplenishmentTaskNos = shortageRecords
      .map((record: any) => record.replenishmentTaskNo)
      .filter(Boolean);
    const productionReplenishmentRequestNos = shortageRecords
      .map((record: any) => record.replenishmentRequestNo)
      .filter(Boolean);
    const productionShortageReasons = shortageRecords
      .filter((record: any) => record.shortageMode === 'MANAGER_APPROVED')
      .map((record: any) => ({
        managerName: record.managerName,
        shortageReason: record.shortageReason
      }));

    return {
      productionShortageQuantity: shortageRecords.reduce(
        (sum: number, record: any) => sum + decimalToNumber(record.shortageQuantity),
        0
      ),
      productionScrapQuantity: shortageRecords.reduce((sum: number, record: any) => sum + decimalToNumber(record.scrapQuantity), 0),
      productionShortageMode:
        shortageRecords.length === 0
          ? null
          : shortageRecords.some((record: any) => record.shortageMode === 'REPLENISHMENT')
            ? 'REPLENISHMENT'
            : shortageRecords.some((record: any) => record.shortageMode === 'REPLENISHMENT_REQUEST')
              ? 'REPLENISHMENT_REQUEST'
              : 'MANAGER_APPROVED',
      productionReplenishmentTaskNos,
      productionReplenishmentRequestNos,
      productionShortageReasons,
      unresolvedShortageQuantity: unresolvedShortageRecords.reduce(
        (sum: number, record: any) => sum + decimalToNumber(record.shortageQuantity),
        0
      ),
      unresolvedShortageCount: unresolvedShortageRecords.length,
      unresolvedShortageRecords: unresolvedShortageRecords.map((record: any) => ({
        completionId: record.completionId,
        productionTaskNo: record.productionTaskNo,
        partCode: record.partCode,
        partName: record.partName,
        shortageQuantity: record.shortageQuantity,
        scrapQuantity: record.scrapQuantity,
        managerName: record.managerName,
        shortageReason: record.shortageReason,
        unit: record.unit
      }))
    };
  }

  private toEffectiveUnresolvedShortageRecords(tasks: any[]) {
    const records = this.toShortageRecords(tasks).filter((record: any) => this.isUnresolvedShortageRecord(record));
    if (records.length === 0) {
      return [];
    }

    const completedReplenishmentQuantityByLine = this.toCompletedReplenishmentQuantityByLine(tasks);
    return records.flatMap((record: any) => {
      const key = record.orderLineId || record.productionTaskNo;
      const coveringQuantity = completedReplenishmentQuantityByLine.get(key) || 0;
      if (coveringQuantity <= 0) {
        return [record];
      }

      const usedQuantity = Math.min(record.shortageQuantity, coveringQuantity);
      const remainingQuantity = this.roundQuantity(record.shortageQuantity - usedQuantity);
      completedReplenishmentQuantityByLine.set(key, this.roundQuantity(coveringQuantity - usedQuantity));
      if (remainingQuantity <= 0) {
        return [];
      }
      return [{ ...record, shortageQuantity: remainingQuantity }];
    });
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
}
