import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CommonStatus,
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

const fallbackSubmitPlanOperators: SubmitPlanOperator[] = [
  {
    accountId: 'PLAN-001',
    name: '刘计划',
    role: '生产计划员'
  },
  {
    accountId: 'WS-001',
    name: '陈主任',
    role: '车间主任'
  }
];

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
    const productionStatuses = this.parseEnumList<ProductionStatus>(
      query.productionStatuses,
      Object.values(ProductionStatus) as ProductionStatus[],
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
            inventoryBatches: true
          }
        },
        productionTasks: {
          include: { inventoryBatch: true }
        },
        inventoryBatches: true
      },
      orderBy: [{ orderDate: 'desc' }, { orderNo: 'desc' }]
    });

    const summaries = orders.map((order) => this.toSummary(order));
    if (productionStatuses.length === 0) {
      return summaries;
    }

    return summaries.filter((order) => productionStatuses.includes(order.productionStatus));
  }

  async findOne(orderNo: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
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
    const stockSourceInfoByBatchId = await this.getStockSourceInfoByBatchId(selectedStockBatchIds);
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
    this.validateOrderLines(dto.lines);
    await this.validateOrderStockSourceSelections(dto.lines);

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
      const created = await this.prisma.$transaction(async (tx) => {
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
                productionPlanQuantity: this.resolveProductionPlanQuantity(line),
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
        return createdOrder;
      });

      return this.toDetail(created);
    } catch (error) {
      if (this.isDuplicateOrderNoError(error)) {
        throw new BadRequestException(`订单号 ${orderNo} 已存在，请修改后再保存`);
      }
      throw error;
    }
  }

  async update(orderNo: string, dto: UpdateOrderDto) {
    this.validateOrderLines(dto.lines);
    await this.validateOrderStockSourceSelections(dto.lines);

    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('只有草稿订单可以编辑');
    }

    const nextOrderNo = dto.orderNo?.trim() ? this.normalizeOrderNo(dto.orderNo) : order.orderNo;
    if (nextOrderNo !== order.orderNo) {
      await this.ensureOrderNoAvailable(nextOrderNo, order.orderNo);
    }
    const normalizedLineSteps = await Promise.all(dto.lines.map((line) => this.normalizeProcessSteps(line.processSteps, false)));

    // DRAFT 订单还没有进入生产，允许修改订单号和整体替换订单零件，保持订单总表和明细表边界清晰。
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (nextOrderNo !== order.orderNo) {
          await this.reserveOrderNo(tx, nextOrderNo, order.id, 'DRAFT_ORDER_RENUMBERED');
        } else {
          await this.linkOrderNoReservation(tx, nextOrderNo, order.id, 'ORDER_CREATED');
        }
        await this.upsertMaterials(tx, dto.lines);
        await tx.orderLine.deleteMany({ where: { orderId: order.id } });
        return tx.customerOrder.update({
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
                productionPlanQuantity: this.resolveProductionPlanQuantity(line),
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
      });

      return this.toDetail(updated);
    } catch (error) {
      if (this.isDuplicateOrderNoError(error)) {
        throw new BadRequestException(`订单号 ${nextOrderNo} 已存在，请修改后再保存`);
      }
      throw error;
    }
  }

  async updateLineProcess(orderNo: string, lineId: string, dto: UpdateLineProcessDto) {
    const processEditor = await this.resolveProcessEditorOperator(dto.configuredByCode);
    const steps = await this.normalizeProcessSteps(dto.steps, true);
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('只有草稿订单可以修改生产流程');
    }

    const line = await this.prisma.orderLine.findFirst({ where: { id: lineId, orderId: order.id } });
    if (!line) {
      throw new NotFoundException('订单零件不存在');
    }
    if (line.fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      throw new BadRequestException('使用库存的订单零件不需要设置生产流程');
    }

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
      },
      '当前订单生产任务正在被其他操作修改，请刷新后重新创建补单'
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
        throw new BadRequestException('草稿订单请直接编辑订单，不要创建补单物料');
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
          productionPlanQuantity: this.resolveProductionPlanQuantity(dto),
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
      if (nextPlanQuantity < nextQuantity) {
        throw new BadRequestException('生产计划数量不能小于客户订单数量');
      }

      await tx.orderLine.update({
        where: { id: line.id },
        data: {
          quantity: nextQuantity,
          productionPlanQuantity: nextPlanQuantity
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

      await this.createProductionNotice(tx, {
        noticeType,
        target: ProductionNoticeTarget.PRODUCTION,
        order,
        line,
        productionTaskNo: replenishmentTaskNo || baseTask.productionTaskNo,
        beforeQuantity: oldQuantity,
        afterQuantity: nextQuantity,
        deltaQuantity,
        reason: noticeReason,
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
          reason: `${noticeReason} 仓库需等待管理处理结果；后续如转库存必须按库存批次入库，如销毁不得进入可用库存。`,
          managerName: dto.managerName?.trim()
        });
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
        const shippedBatches = order.inventoryBatches.filter((batch) => batch.sourceOrderId && batch.status === 'USED');
        if (shippedBatches.length > 0) {
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
    const submitOperator = await this.resolveSubmitPlanOperator(dto.submittedByCode, '下计划操作员');

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
          throw new BadRequestException('只有草稿订单可以提交生产');
        }
        const missingProcessLine = order.lines.find(
          (line) => line.fulfillmentMode !== OrderLineFulfillmentMode.STOCK && line.processSteps.length === 0
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
          if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
            await this.allocateStockToOrderLine(tx, order, line);
            continue;
          }

          if (fulfillmentMode === OrderLineFulfillmentMode.REWORK) {
            await this.consumeStockForRework(tx, order, line);
          }

          // 生产任务计划数使用生产计划数量，不再混用客户订单数量；REWORK 会先扣备货库存再进入生产。
          await tx.productionTask.upsert({
            where: { productionTaskNo: `PT-${order.orderNo}-${String(line.lineNo).padStart(3, '0')}` },
            update: {
              processSnapshot: this.processStepsToJson(steps),
              plannedQuantity: line.productionPlanQuantity,
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
              plannedQuantity: line.productionPlanQuantity,
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

  private async resolveSubmitPlanOperator(submittedByCode: string, label = '下计划操作员') {
    const accountId = submittedByCode?.trim();
    if (!accountId) {
      throw new BadRequestException(`请选择${label}`);
    }

    const operator = await this.prisma.productionOperator.findFirst({
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

  private isSubmitPlanOperatorRole(role?: string | null) {
    const value = role || '';
    return /计划/.test(value) && !/车间主任|主任/.test(value);
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
      throw new BadRequestException('生产流程只能由下单/计划或技术工艺人员填写，车间人员只能查看生产流程');
    }
    return {
      accountId: processEditor.accountId,
      name: processEditor.name,
      role: processEditor.role
    };
  }

  private isProcessEditorRole(role?: string | null) {
    const value = role || '';
    return /计划|下单|订单|技术|工艺/.test(value) && !/车间|主任|操作员/.test(value);
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
    await this.consumeAvailableStock(tx, order, line, decimalToNumber(line.quantity), 'STOCK');
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
    if (purpose === 'STOCK') {
      this.validateDirectStockOrderLineInfo(line);
    }
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
        productionTask: { include: { orderLine: true } }
      },
      orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }]
    });
    const sourceTaskMap = await this.findStockSourceTaskMap(tx, stockBatches);
    const selectedSourceMap = new Map(selectedSources.map((source) => [source.batchId, source]));
    const foundBatchIds = new Set(stockBatches.map((batch) => batch.id));
    const missingSelection = selectedSources.find((source) => !foundBatchIds.has(source.batchId));
    if (missingSelection) {
      throw new BadRequestException(`已选库存批次 ${missingSelection.batchNo || missingSelection.batchId} 不存在或当前不可用`);
    }
    if (hasManualSelections) {
      const selectedTotal = selectedSources.reduce((sum, source) => sum + Number(source.quantity || 0), 0);
      if (selectedTotal > requiredQuantity + 0.0001) {
        throw new BadRequestException(
          `零件 ${line.partCode} 已选库存数量超过本次需要数量：需要 ${requiredQuantity}，已选 ${selectedTotal}`
        );
      }
    }

    const sortedStockBatches = hasManualSelections
      ? selectedSources
          .map((source) => stockBatches.find((batch) => batch.id === source.batchId))
          .filter(Boolean)
      : this.sortStockBatchesForOrderLine(line, stockBatches, sourceTaskMap);
    const candidateBatches = hasManualSelections
      ? sortedStockBatches.map((batch) => ({
          ...batch,
          selectedQuantity: selectedSourceMap.get(batch.id)?.quantity || 0
        }))
      : purpose === 'STOCK'
        ? sortedStockBatches.filter((batch) => this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap))
        : sortedStockBatches;

    for (const batch of candidateBatches) {
      if (batch.unit !== line.unit) {
        throw new BadRequestException(`已选库存批次 ${batch.batchNo} 的单位 ${batch.unit} 与订单单位 ${line.unit} 不一致`);
      }
      if (hasManualSelections && decimalToNumber(batch.quantity) + 0.0001 < Number(batch.selectedQuantity || 0)) {
        throw new BadRequestException(`已选库存批次 ${batch.batchNo} 的使用数量超过当前可用库存`);
      }
      const selectedSource = hasManualSelections ? selectedSourceMap.get(batch.id) : undefined;
      if (hasManualSelections && purpose === 'STOCK') {
        // 直接使用库存必须能追到来源图纸，不能靠人工说明绕过缺失图号、版本或文件。
        const missingSourceDrawingInfo = this.directStockSourceMissingDrawingInfo(batch, sourceTaskMap);
        if (missingSourceDrawingInfo.length > 0) {
          throw new BadRequestException(
            `已选库存批次 ${batch.batchNo} 缺少来源${missingSourceDrawingInfo.join('、')}，不能直接使用库存，请改为库存再加工或重新生产`
          );
        }
      }
      if (
        hasManualSelections &&
        !this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap) &&
        !this.stockSourceManualConfirmationComplete(selectedSource)
      ) {
        // 后端必须按真实库存来源重新核对，不能只相信前端提交的 compatibilityStatus。
        throw new BadRequestException(`已选库存批次 ${batch.batchNo} 与本次订单资料不完全匹配，必须填写人工确认记录`);
      }
    }

    const availableQuantity = candidateBatches.reduce((sum, batch) => sum + decimalToNumber(batch.quantity), 0);
    const selectedAvailableQuantity = hasManualSelections
      ? candidateBatches.reduce((sum, batch) => sum + Math.min(decimalToNumber(batch.quantity), Number(batch.selectedQuantity || 0)), 0)
      : availableQuantity;
    if (selectedAvailableQuantity + 0.0001 < requiredQuantity) {
      if (hasManualSelections) {
        throw new BadRequestException(
          `零件 ${line.partCode} 已选库存不足：需要 ${requiredQuantity}，已选 ${selectedAvailableQuantity}`
        );
      }
      if (purpose === 'STOCK' && stockBatches.length > 0) {
        throw new BadRequestException(
          `零件 ${line.partCode} 图纸匹配库存不足：需要 ${requiredQuantity}，匹配 ${availableQuantity}。请选择库存再加工或重新生产`
        );
      }
      throw new BadRequestException(`零件 ${line.partCode} 可用库存不足：需要 ${requiredQuantity}，可用 ${availableQuantity}`);
    }

    let remainingQuantity = this.roundQuantity(requiredQuantity);
    let sequence = 1;
    for (const batch of candidateBatches) {
      if (remainingQuantity <= 0) {
        break;
      }

      const batchQuantity = decimalToNumber(batch.quantity);
      const selectedLimit = hasManualSelections ? Number(batch.selectedQuantity || 0) : batchQuantity;
      const usedQuantity = this.roundQuantity(Math.min(batchQuantity, selectedLimit, remainingQuantity));
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

  private validateDirectStockOrderLineInfo(line: any) {
    const missingFields = [
      !String(line.drawingNo || '').trim() ? '图号' : '',
      !String(line.drawingVersion || '').trim() ? '图纸版本' : '',
      !String(line.partSpecification || '').trim() ? '成品规格' : '',
      decimalToNumber(line.partThickness) <= 0 ? '零件厚度' : ''
    ].filter(Boolean);
    if (missingFields.length === 0) {
      return;
    }

    // 直接使用库存必须有本次订单的关键图纸资料；否则后端无法可靠判断旧库存是否适用。
    throw new BadRequestException(
      `零件 ${line.partCode} 直接使用库存前必须补齐图纸资料：${missingFields.join('、')}`
    );
  }

  private validateSelectedStockSourceManualConfirmations(selectedSources: ReturnType<OrdersService['jsonToStockSourceSelections']>) {
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
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map((item) => item.batch);
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
      // 旧备货库存没有来源图纸时不能直接作为“使用库存”，只能让操作员选择库存再加工或重新生产。
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
    // 直接使用库存必须能追到原生产图纸文件；没有图纸文件的库存只能走库存再加工或重新生产。
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

  private validateOrderLines(lines: CreateOrderDto['lines']) {
    // 新增订单默认给 3 行方便录入，但允许删除误填行；业务上只要求订单至少保留 1 个零件。
    if (!lines || lines.length < 1) {
      throw new BadRequestException('订单至少需要一个零件');
    }

    lines.forEach((line, index) => {
      this.validateSingleOrderLine(line, `第 ${index + 1} 个零件`);
    });
  }

  private validateSingleOrderLine(line: CreateOrderLineDto, label = 'Order line') {
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
      fulfillmentMode === OrderLineFulfillmentMode.STOCK
    );
    if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      if (productionPlanQuantity !== 0) {
        throw new BadRequestException(`${label}使用库存时生产计划数量必须为 0`);
      }
      this.validateDirectStockOrderLineInfo(line);
    } else {
      if (productionPlanQuantity < orderQuantity) {
        throw new BadRequestException(`${label}生产计划数量不能小于客户订单数量`);
      }
    }
    this.validateStockSourceSelectionQuantity(line, label, fulfillmentMode, orderQuantity, productionPlanQuantity);
  }

  private validateStockSourceSelectionQuantity(
    line: CreateOrderLineDto,
    label: string,
    fulfillmentMode: OrderLineFulfillmentMode,
    orderQuantity: number,
    productionPlanQuantity: number
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
      throw new BadRequestException(`${label}必须先选择库存批次并完成来源核对`);
    }
    this.validateSelectedStockSourceManualConfirmations(selectedSources);
    // 草稿保存时也要拒绝数量不足或超量来源，避免提交生产前已经保存了不可执行的库存批次选择。
    if (selectedQuantity + 0.0001 < requiredQuantity) {
      throw new BadRequestException(`${label}已选库存数量少于本次需要数量：需要 ${requiredQuantity}，已选 ${selectedQuantity}`);
    }
    if (selectedQuantity > requiredQuantity + 0.0001) {
      throw new BadRequestException(`${label}已选库存数量超过本次需要数量：需要 ${requiredQuantity}，已选 ${selectedQuantity}`);
    }
  }

  private async validateOrderStockSourceSelections(lines: CreateOrderDto['lines']) {
    const selectedRows = lines.flatMap((line, lineIndex) =>
      this.normalizeStockSourceSelections(line.selectedStockSources).map((source) => ({ line, lineIndex, source }))
    );
    if (selectedRows.length === 0) {
      return;
    }

    const batchIds = [...new Set(selectedRows.map((row) => row.source.batchId))];
    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        id: { in: batchIds },
        sourceOrderId: null,
        quantity: { gt: 0 },
        status: 'AVAILABLE'
      },
      include: {
        sourceOrderLine: true,
        productionTask: { include: { orderLine: true } }
      }
    });
    const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
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
      const availableQuantity = decimalToNumber(batch.quantity);
      if (availableQuantity + 0.0001 < selectedQuantity) {
        throw new BadRequestException(
          `已选库存批次 ${batch.batchNo} 在当前订单中被多行重复占用：当前可用 ${availableQuantity}，合计选用 ${selectedQuantity}`
        );
      }
    }
    const sourceTaskMap = await this.findStockSourceTaskMapByBatches(batches);

    for (const { line, lineIndex, source } of selectedRows) {
      const label = `第 ${lineIndex + 1} 个零件`;
      const batch = batchMap.get(source.batchId);
      if (!batch) {
        throw new BadRequestException(`${label}已选库存批次 ${source.batchNo || source.batchId} 不存在或当前不可用`);
      }
      if (batch.unit !== line.unit) {
        throw new BadRequestException(`${label}已选库存批次 ${batch.batchNo} 的单位 ${batch.unit} 与订单单位 ${line.unit} 不一致`);
      }
      if (decimalToNumber(batch.quantity) + 0.0001 < source.quantity) {
        throw new BadRequestException(`${label}已选库存批次 ${batch.batchNo} 的使用数量超过当前可用库存`);
      }

      const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
      if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
        // 草稿保存阶段也必须按真实批次核对来源图纸，不能信任前端提交的 compatibilityStatus。
        const missingSourceDrawingInfo = this.directStockSourceMissingDrawingInfo(batch, sourceTaskMap);
        if (missingSourceDrawingInfo.length > 0) {
          throw new BadRequestException(
            `${label}已选库存批次 ${batch.batchNo} 缺少来源${missingSourceDrawingInfo.join('、')}，不能直接使用库存，请改为库存再加工或重新生产`
          );
        }
      }

      if (!this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap) && !this.stockSourceManualConfirmationComplete(source)) {
        throw new BadRequestException(`${label}已选库存批次 ${batch.batchNo} 与本次订单资料不完全匹配，必须填写人工确认记录`);
      }
    }
  }

  private async findStockSourceTaskMapByBatches(batches: any[]) {
    const taskNos = [...new Set(batches.map((batch) => batch.sourceProductionTaskNo).filter(Boolean))] as string[];
    if (taskNos.length === 0) {
      return new Map<string, any>();
    }
    const tasks = await this.prisma.productionTask.findMany({
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
      return 0;
    }
    return line.productionPlanQuantity ?? line.quantity;
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
      remark: order.remark,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
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
        ...this.toLineWarehouseInfo(line, stockQuantityByTaskNo)
      }))
    };
  }

  private async getStockSourceInfoByBatchId(batchIds: string[]) {
    const ids = [...new Set(batchIds.filter(Boolean))];
    if (ids.length === 0) {
      return new Map<string, ReturnType<OrdersService['toStockSourceSelectionInfo']>>();
    }

    const batches = await this.prisma.inventoryBatch.findMany({
      where: { id: { in: ids } },
      include: { productionTask: true }
    });

    return new Map(batches.map((batch) => [batch.id, this.toStockSourceSelectionInfo(batch)]));
  }

  private toStockSourceSelectionInfo(batch: any) {
    const replenishmentSourceType = batch.replenishmentSourceType || batch.productionTask?.replenishmentSourceType || undefined;
    const replenishmentSourceRequestNo =
      batch.replenishmentSourceRequestNo || batch.productionTask?.replenishmentSourceRequestNo || undefined;
    return {
      batchId: batch.id,
      batchNo: batch.batchNo,
      partCode: batch.partCode,
      partName: batch.partName,
      availableQuantity: decimalToNumber(batch.quantity),
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

    const tasks = order.productionTasks || [];
    const orderBatches = (order.inventoryBatches || []).filter((batch: any) => batch.sourceOrderId);
    if (tasks.length === 0 && orderBatches.length === 0) {
      return 'WAITING_PRODUCTION';
    }

    const finishedCount = tasks.filter((task: any) => this.isTaskWarehouseFinished(task)).length;
    const shippedCount = tasks.filter((task: any) => this.isTaskOrderBatchShipped(task)).length;
    const availableOrderBatchCount = orderBatches.filter((batch: any) => batch.status === 'AVAILABLE').length;
    const shippedOrderBatchCount = orderBatches.filter((batch: any) => batch.status === 'USED').length;
    const allTasksFinished = tasks.length === 0 || finishedCount === tasks.length;
    if (allTasksFinished && orderBatches.length > 0 && shippedOrderBatchCount === orderBatches.length) {
      return 'SHIPPED';
    }
    if (tasks.length > 0 && finishedCount === tasks.length && availableOrderBatchCount === 0) {
      return 'SHIPPED';
    }
    if (shippedCount > 0 || shippedOrderBatchCount > 0) {
      return 'PARTIAL_SHIPPED';
    }

    if (availableOrderBatchCount > 0 || tasks.some((task: any) => this.isTaskOrderBatchAvailable(task))) {
      return 'WAITING_SHIPMENT';
    }

    if (tasks.some((task: any) => task.status === 'COMPLETED' && !task.inventoryBatch)) {
      return 'WAITING_RECEIPT';
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
    if (tasks.length === 0) {
      return ProductionStatus.PENDING;
    }

    const taskStatuses = tasks.map((task: any) => this.toEffectiveTaskProductionStatus(task));
    if (taskStatuses.every((status: ProductionStatus) => status === ProductionStatus.COMPLETED)) {
      return ProductionStatus.COMPLETED;
    }
    // 只要已有任务开工或部分任务完成，订单级生产状态就不再显示为待生产。
    if (taskStatuses.some((status: ProductionStatus) => status !== ProductionStatus.PENDING)) {
      return ProductionStatus.IN_PROGRESS;
    }
    return ProductionStatus.PENDING;
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

  private toLineWarehouseInfo(line: any, stockQuantityByTaskNo = new Map<string, number>()) {
    const tasks = line.productionTasks || [];
    const lineBatches = (line.inventoryBatches || []).filter((batch: any) => batch.sourceOrderId);
    const visibleLineBatch =
      lineBatches.find((batch: any) => batch.status === 'AVAILABLE') ||
      lineBatches.find((batch: any) => batch.status === 'USED');
    if (tasks.length === 0) {
      if (visibleLineBatch) {
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
          warehouseStage: visibleLineBatch.status === 'AVAILABLE' ? 'WAITING_SHIPMENT' : 'SHIPPED',
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
      tasks.find((task: any) => task.inventoryBatch?.sourceOrderId && task.inventoryBatch.status === 'AVAILABLE')?.inventoryBatch ||
      tasks.find((task: any) => task.inventoryBatch?.sourceOrderId && task.inventoryBatch.status === 'USED')?.inventoryBatch ||
      primaryTask.inventoryBatch;
    const finishedCount = tasks.filter((task: any) => this.isTaskWarehouseFinished(task)).length;
    const shippedCount = tasks.filter((task: any) => this.isTaskOrderBatchShipped(task)).length;
    const shortageInfo = this.toLineShortageInfo(tasks);
    let warehouseStage = 'WAITING_PRODUCTION';
    if (finishedCount === tasks.length) {
      warehouseStage = 'SHIPPED';
    } else if (shippedCount > 0) {
      warehouseStage = 'PARTIAL_SHIPPED';
    } else if (tasks.some((task: any) => this.isTaskOrderBatchAvailable(task))) {
      warehouseStage = 'WAITING_SHIPMENT';
    } else if (tasks.some((task: any) => task.status === 'COMPLETED' && !task.inventoryBatch)) {
      warehouseStage = 'WAITING_RECEIPT';
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
        0
      ),
      productionTaskCount: tasks.length,
      ...shortageInfo,
      productionProgressText: this.formatLineProductionProgress(tasks),
      warehouseStage,
      inventoryBatchNo: visibleBatch?.batchNo || null,
      inventoryStatus: visibleBatch?.status || null,
      warehouseName: visibleBatch?.warehouse?.warehouseName || null,
      locationName: visibleBatch?.location?.locationName || null
    };
  }

  private formatLineProductionProgress(tasks: any[]) {
    // 订单变更和补单必须让操作人员先看到当前零件进行到哪一道工序，避免把已生产数量变更误当成草稿修改。
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
        return `${taskNo} 待生产`;
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

  private toLineShortageInfo(tasks: any[]) {
    const shortageRecords = tasks
      .map((task) => {
        const finalCompletion = (task.processCompletions || []).reduce((current: any, item: any) => {
          if (!current || item.stepNo > current.stepNo) {
            return item;
          }
          return current;
        }, null);
        return finalCompletion
          ? {
              shortageQuantity: decimalToNumber(finalCompletion.shortageQuantity),
              scrapQuantity: decimalToNumber(finalCompletion.scrapQuantity),
              shortageMode: finalCompletion.shortageMode,
              replenishmentTaskNo: finalCompletion.replenishmentTaskNo,
              replenishmentRequestNo: finalCompletion.replenishmentRequests?.[0]?.requestNo,
              managerName: finalCompletion.managerName,
              shortageReason: finalCompletion.shortageReason
            }
          : null;
      })
      .filter((record) => record && record.shortageQuantity > 0);

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
      productionShortageReasons
    };
  }
}
