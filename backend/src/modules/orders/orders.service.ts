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
  STANDARD_PROCESS_NAMES,
  decimalToNumber,
  processSnapshotToArray,
  processSnapshotToDetails,
  type ProcessStepSnapshot
} from '../../common/serializers';
import { buildPinyinSearchText } from '../../common/pinyin-search';
import { runSerializableTransaction } from '../../common/transactions';
import { PrismaService } from '../../prisma/prisma.service';
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
  UpdateLineProcessDto,
  UpdateLineQuantityDto,
  UpdateOrderDto
} from './dto';
import { randomUUID } from 'node:crypto';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: OrderQueryDto) {
    const where: Prisma.CustomerOrderWhereInput = {};

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (query.status) {
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

    return orders.map((order) => this.toSummary(order));
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
      throw new NotFoundException('Order not found');
    }

    const taskNos = order.lines.flatMap((line) => line.productionTasks.map((task) => task.productionTaskNo));
    const stockQuantityByTaskNo = await this.getStockQuantityByTaskNo(taskNos);
    return this.toDetail(order, stockQuantityByTaskNo);
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

    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (customer.status !== CommonStatus.ENABLED) {
      throw new BadRequestException('Only enabled customers can create orders');
    }

    const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date();
    const orderNo = dto.orderNo?.trim() ? this.normalizeOrderNo(dto.orderNo) : await this.generateOrderNo(orderDate);
    await this.ensureOrderNoAvailable(orderNo);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.upsertMaterials(tx, dto.lines);
        return tx.customerOrder.create({
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
              processSnapshot: this.processStepsToJson(this.normalizeProcessSteps(line.processSteps, false)),
              processSteps: {
                create: this.normalizeProcessSteps(line.processSteps, false).map((processStep, stepIndex) => ({
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

    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT orders can be edited');
    }

    const nextOrderNo = dto.orderNo?.trim() ? this.normalizeOrderNo(dto.orderNo) : order.orderNo;
    if (nextOrderNo !== order.orderNo) {
      await this.ensureOrderNoAvailable(nextOrderNo, order.orderNo);
    }

    // DRAFT 订单还没有进入生产，允许修改订单号和整体替换订单零件，保持订单总表和明细表边界清晰。
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
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
                processSnapshot: this.processStepsToJson(this.normalizeProcessSteps(line.processSteps, false)),
                processSteps: {
                  create: this.normalizeProcessSteps(line.processSteps, false).map((processStep, stepIndex) => ({
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
    const steps = this.normalizeProcessSteps(dto.steps, true);
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } }
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT orders can update process steps');
    }

    const line = await this.prisma.orderLine.findFirst({ where: { id: lineId, orderId: order.id } });
    if (!line) {
      throw new NotFoundException('Order line not found');
    }
    if (line.fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      throw new BadRequestException('Stock order line does not require production process steps');
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
      await tx.productionTask.updateMany({
        where: { orderLineId: lineId, status: { not: 'COMPLETED' } },
        data: { processSnapshot: this.processStepsToJson(steps) }
      });
    });

    return this.findOne(order.orderNo);
  }

  async createLineReplenishment(orderNo: string, lineId: string, dto: CreateLineReplenishmentDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await this.prisma.$transaction(async (tx) => {
      const { order, line, baseTask } = await this.findStartedOrderLineTask(tx, normalizedOrderNo, lineId);
      this.assertOrderAcceptsProductionChange(order);
      const quantity = this.normalizeQuantity(dto.quantity, 'Replenishment quantity');
      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('Replenishment reason is required');
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
    });

    return this.findOne(normalizedOrderNo);
  }

  async cancelReplenishment(orderNo: string, productionTaskNo: string, dto: CancelReplenishmentDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const normalizedTaskNo = productionTaskNo.trim().toUpperCase();
    if (!normalizedTaskNo) {
      throw new BadRequestException('Production task number is required');
    }

    await this.prisma.$transaction(async (tx) => {
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
        throw new NotFoundException('Replenishment task not found');
      }
      if (!task.isReplenishment) {
        throw new BadRequestException('Only replenishment task can be cancelled here');
      }
      if (task.order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Order is already cancelled');
      }
      if (task.order.status === OrderStatus.COMPLETED) {
        throw new BadRequestException('Completed order cannot cancel replenishment');
      }
      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('Cancel reason is required');
      }
      if (task.inventoryBatch) {
        throw new BadRequestException('Replenishment task has entered warehouse and cannot be cancelled');
      }
      if (this.isStartedProductionTask(task)) {
        throw new BadRequestException('Started replenishment task cannot be cancelled directly. Please use production withdraw');
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
            `取消补单 ${task.productionTaskNo}：${reason}${dto.managerName?.trim() ? `（${dto.managerName.trim()}）` : ''}`
          )
        }
      });
    });

    return this.findOne(normalizedOrderNo);
  }

  async createAdditionalMaterial(orderNo: string, dto: CreateAdditionalMaterialDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await this.prisma.$transaction(async (tx) => {
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
        throw new NotFoundException('Order not found');
      }
      if (order.status === OrderStatus.DRAFT) {
        throw new BadRequestException('DRAFT order should be edited directly instead of creating additional material');
      }
      this.assertOrderAcceptsProductionChange(order);
      const startedTask = order.productionTasks.find((task) => this.isStartedProductionTask(task));
      if (!startedTask) {
        throw new BadRequestException('Order has not started production. Additional material is not allowed');
      }

      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('Additional material reason is required');
      }
      const fulfillmentMode = this.normalizeFulfillmentMode(dto.fulfillmentMode);
      if (fulfillmentMode !== OrderLineFulfillmentMode.PRODUCTION) {
        throw new BadRequestException('Additional material replenishment must use production mode');
      }
      const steps = this.normalizeProcessSteps(dto.processSteps, true);
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
    });

    return this.findOne(normalizedOrderNo);
  }

  async updateLineQuantityAfterProductionStarted(orderNo: string, lineId: string, dto: UpdateLineQuantityDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await this.prisma.$transaction(async (tx) => {
      const { order, line, baseTask } = await this.findStartedOrderLineTask(tx, normalizedOrderNo, lineId);
      this.assertOrderAcceptsProductionChange(order);
      const oldQuantity = decimalToNumber(line.quantity);
      const nextQuantity = this.normalizeQuantity(dto.quantity, 'Customer order quantity', true);
      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('Quantity change reason is required');
      }
      if (oldQuantity === nextQuantity) {
        throw new BadRequestException('Quantity is not changed');
      }

      const deltaQuantity = this.roundQuantity(nextQuantity - oldQuantity);
      const currentPlanQuantity = decimalToNumber(line.productionPlanQuantity);
      const nextPlanQuantity =
        dto.productionPlanQuantity !== undefined
          ? this.normalizeQuantity(dto.productionPlanQuantity, 'Production plan quantity', true)
          : deltaQuantity > 0
            ? this.roundQuantity(currentPlanQuantity + deltaQuantity)
            : Math.max(currentPlanQuantity, nextQuantity);
      if (nextPlanQuantity < nextQuantity) {
        throw new BadRequestException('Production plan quantity cannot be less than customer order quantity');
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
    });

    return this.findOne(normalizedOrderNo);
  }

  async cancelOrder(orderNo: string, dto: CancelOrderDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await this.prisma.$transaction(async (tx) => {
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
        throw new NotFoundException('Order not found');
      }
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Order is already cancelled');
      }
      if (order.status === OrderStatus.COMPLETED) {
        throw new BadRequestException('Completed order cannot be cancelled in first stage');
      }

      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('Cancel reason is required');
      }

      const startedTasks = order.productionTasks.filter((task) => this.isStartedProductionTask(task));
      const shippedBatches = order.inventoryBatches.filter((batch) => batch.sourceOrderId && batch.status === 'USED');
      if (shippedBatches.length > 0) {
        throw new BadRequestException('Order has shipped inventory and cannot be cancelled directly');
      }

      const progressText = await this.describeOrderProductionProgress(tx, order.id);
      const noticeReason =
        startedTasks.length > 0
          ? `客户取消整张订单：${reason}。${progressText}。请管理人员确认已生产物料转库存或销毁处理，并同步仓库。`
          : `客户取消整张订单：${reason}。订单尚未开始生产，系统取消未开始任务并释放未发货库存。`;

      // 整单取消后，客户订单数量归零；生产任务保留已有进度，未开始的待生产任务删除，避免误开工。
      await tx.customerOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          remark: this.appendRemark(order.remark, `客户取消整单：${reason}`)
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
            reason: noticeReason,
            managerName: dto.managerName?.trim()
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
            reason: `${noticeReason} 仓库需等待转库存或销毁结果；未确认前不得进入可用库存。`,
            managerName: dto.managerName?.trim()
          });
        }
      }
    });

    return this.findOne(normalizedOrderNo);
  }

  async cancelAfterProductionStarted(orderNo: string, dto: CancelStartedOrderDto) {
    return this.cancelOrder(orderNo, dto);
  }

  async submit(orderNo: string) {
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
          throw new NotFoundException('Order not found');
        }
        if (order.lines.length === 0) {
          throw new BadRequestException('Order lines are required');
        }
        if (order.status !== OrderStatus.DRAFT) {
          throw new BadRequestException('Only DRAFT orders can be submitted');
        }
        const missingProcessLine = order.lines.find(
          (line) => line.fulfillmentMode !== OrderLineFulfillmentMode.STOCK && line.processSteps.length === 0
        );
        if (missingProcessLine) {
          throw new BadRequestException(`Process steps are required for part ${missingProcessLine.partCode}`);
        }

        // 订单提交会占用备货库存或生成生产任务，所有判断必须在事务内基于最新订单状态执行。
        await tx.customerOrder.update({
          where: { id: order.id },
          data: { status: OrderStatus.SUBMITTED }
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

  private async findStartedOrderLineTask(tx: Prisma.TransactionClient, orderNo: string, lineId: string) {
    const order = await tx.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } }
    });
    if (!order) {
      throw new NotFoundException('Order not found');
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
      throw new NotFoundException('Order line not found');
    }

    const baseTask = line.productionTasks.find((task) => !task.isReplenishment && this.isStartedProductionTask(task));
    if (!baseTask) {
      throw new BadRequestException('Order line has not started production. Please edit the order instead of creating replenishment');
    }

    return { order, line, baseTask };
  }

  private assertOrderAcceptsProductionChange(order: { status: OrderStatus }) {
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cancelled order cannot create replenishment or production quantity change');
    }
    if (order.status === OrderStatus.COMPLETED) {
      throw new BadRequestException('Completed order cannot create replenishment or production quantity change');
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
        status: { not: ProductionStatus.PENDING }
      },
      orderBy: { productionTaskNo: 'desc' }
    });
    if (existingStarted) {
      throw new BadRequestException('Existing replenishment task has started. Create a new customer change record after manager review');
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
    throw new BadRequestException('No available replenishment task number');
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
      managerName: data.managerName || null
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
    const stockBatches = await tx.inventoryBatch.findMany({
      where: {
        sourceOrderId: null,
        partCode: { equals: line.partCode, mode: 'insensitive' },
        unit: line.unit,
        quantity: { gt: 0 },
        status: 'AVAILABLE'
      },
      orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }]
    });
    const availableQuantity = stockBatches.reduce((sum, batch) => sum + decimalToNumber(batch.quantity), 0);
    if (availableQuantity + 0.0001 < requiredQuantity) {
      throw new BadRequestException(
        `Available stock is not enough for part ${line.partCode}. Required ${requiredQuantity}, available ${availableQuantity}`
      );
    }

    let remainingQuantity = this.roundQuantity(requiredQuantity);
    let sequence = 1;
    for (const batch of stockBatches) {
      if (remainingQuantity <= 0) {
        break;
      }

      const batchQuantity = decimalToNumber(batch.quantity);
      const usedQuantity = this.roundQuantity(Math.min(batchQuantity, remainingQuantity));
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
          productionTaskNo: null,
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
            sourceProductionTaskNo: null,
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
            productionTaskNo: null,
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
          productionTaskNo: null,
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
    const existingOrders = await this.prisma.customerOrder.findMany({
      where: { orderNo: { startsWith: prefix } },
      select: { orderNo: true }
    });
    const usedOrderNos = new Set(existingOrders.map((order) => order.orderNo));

    // 自动生成时按日期前缀递增，并跳过已存在编号，避免删除旧单后再次生成重复号。
    for (let index = 1; index < 10000; index += 1) {
      const orderNo = `${prefix}${String(index).padStart(3, '0')}`;
      if (!usedOrderNos.has(orderNo)) {
        return orderNo;
      }
    }
    throw new BadRequestException('No available order number for this date');
  }

  private async orderNoExists(orderNo: string, excludeOrderNo?: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const normalizedExcludeOrderNo = excludeOrderNo?.trim() ? this.normalizeOrderNo(excludeOrderNo) : undefined;
    const existing = await this.prisma.customerOrder.findFirst({
      where: {
        // 订单号查重必须大小写不敏感，避免 SO-xxx 和 so-xxx 被当成两个订单。
        orderNo: { equals: normalizedOrderNo, mode: 'insensitive' },
        NOT: normalizedExcludeOrderNo ? { orderNo: { equals: normalizedExcludeOrderNo, mode: 'insensitive' } } : undefined
      },
      select: { id: true }
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
      throw new BadRequestException('Order number is required');
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

  private validateOrderLines(lines: CreateOrderDto['lines']) {
    // 新增订单默认给 3 行方便录入，但允许删除误填行；业务上只要求订单至少保留 1 个零件。
    if (!lines || lines.length < 1) {
      throw new BadRequestException('At least 1 order line is required');
    }

    lines.forEach((line, index) => {
      this.validateSingleOrderLine(line, `Order line ${index + 1}`);
    });
  }

  private validateSingleOrderLine(line: CreateOrderLineDto, label = 'Order line') {
    if (!line.partCode?.trim() || !line.partName?.trim() || !line.unit?.trim()) {
      throw new BadRequestException(`${label} is incomplete`);
    }
    if (!Number.isFinite(Number(line.partThickness)) || Number(line.partThickness) <= 0) {
      throw new BadRequestException(`${label} thickness must be greater than 0`);
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
        throw new BadRequestException(`${label} production plan quantity must be 0 when using stock`);
      }
    } else {
      if (productionPlanQuantity < orderQuantity) {
        throw new BadRequestException(`${label} production plan quantity cannot be less than order quantity`);
      }
    }
    this.normalizeProcessSteps(line.processSteps, false);
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
    throw new BadRequestException('Invalid order line fulfillment mode');
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
      throw new BadRequestException(`${label} must be a valid number`);
    }
    if (allowZero ? quantity < 0 : quantity <= 0) {
      throw new BadRequestException(
        allowZero ? `${label} cannot be less than 0` : `${label} must be greater than 0`
      );
    }
    return quantity;
  }

  private normalizeProcessSteps(steps: CreateOrderLineDto['processSteps'] | undefined, requireOne = false): ProcessStepSnapshot[] {
    const normalized = processSnapshotToDetails(steps || []).filter((step) => step.processName);
    if (requireOne && normalized.length === 0) {
      throw new BadRequestException('At least one process step is required');
    }

    const seen = new Set<string>();
    for (const step of normalized) {
      if (!(STANDARD_PROCESS_NAMES as readonly string[]).includes(step.processName)) {
        throw new BadRequestException(`Invalid standard process step ${step.processName}`);
      }
      const key = step.processName.toLocaleLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException(`Duplicate process step ${step.processName}`);
      }
      seen.add(key);
    }

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
    const totalQuantity = order.lines.reduce((sum: number, line: any) => sum + decimalToNumber(line.quantity), 0);
    const totalProductionPlanQuantity = order.lines.reduce(
      (sum: number, line: any) => sum + decimalToNumber(line.productionPlanQuantity ?? line.quantity),
      0
    );

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
      unit: order.lines[0]?.unit || '件',
      warehouseStage: this.toOrderWarehouseStage(order),
      remark: order.remark,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };
  }

  private toDetail(order: any, stockQuantityByTaskNo = new Map<string, number>()) {
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
        processSteps: this.processRowsToSnapshots(line.processSteps).map((step) => step.processName),
        processStepDetails: this.processRowsToSnapshots(line.processSteps),
        productionTasks: this.toLineProductionTasks(line.productionTasks || [], stockQuantityByTaskNo),
        ...this.toLineWarehouseInfo(line, stockQuantityByTaskNo)
      }))
    };
  }

  private toLineProductionTasks(tasks: any[], stockQuantityByTaskNo = new Map<string, number>()) {
    return tasks.map((task) => ({
      id: task.id,
      productionTaskNo: task.productionTaskNo,
      status: this.toEffectiveTaskProductionStatus(task),
      isReplenishment: task.isReplenishment,
      sourceProductionTaskNo: task.sourceProductionTaskNo,
      plannedQuantity: decimalToNumber(task.plannedQuantity),
      completedQuantity: this.toEffectiveTaskCompletedQuantity(
        task,
        stockQuantityByTaskNo.get(task.productionTaskNo) || 0
      ),
      canCancelReplenishment: Boolean(
        task.isReplenishment && !task.inventoryBatch && !this.isStartedProductionTask(task)
      )
    }));
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
    // 订单变更和补单必须让操作人员先看到当前零件进行到哪一道工序，避免把已生产变更误当成草稿修改。
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
              managerName: finalCompletion.managerName,
              shortageReason: finalCompletion.shortageReason
            }
          : null;
      })
      .filter((record) => record && record.shortageQuantity > 0);

    const productionReplenishmentTaskNos = shortageRecords
      .map((record: any) => record.replenishmentTaskNo)
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
            : 'MANAGER_APPROVED',
      productionReplenishmentTaskNos,
      productionShortageReasons
    };
  }
}
