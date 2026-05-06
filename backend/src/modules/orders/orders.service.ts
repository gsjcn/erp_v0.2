import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { decimalToNumber } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto, NextOrderNoQueryDto, OrderQueryDto, UpdateLineProcessDto, UpdateOrderDto } from './dto';

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
      include: { lines: true },
      orderBy: [{ orderDate: 'desc' }, { orderNo: 'desc' }]
    });

    return orders.map((order) => this.toSummary(order));
  }

  async findOne(orderNo: string) {
    const order = await this.prisma.customerOrder.findUnique({
      where: { orderNo },
      include: {
        customer: true,
        lines: {
          include: { processSteps: { orderBy: { stepNo: 'asc' } } },
          orderBy: { lineNo: 'asc' }
        }
      }
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.toDetail(order);
  }

  async nextOrderNo(query: NextOrderNoQueryDto) {
    const orderDate = query.orderDate ? new Date(query.orderDate) : new Date();
    return { orderNo: await this.generateOrderNo(orderDate) };
  }

  async checkOrderNo(orderNo: string) {
    const normalizedOrderNo = orderNo.trim();
    if (!normalizedOrderNo) {
      throw new BadRequestException('Order number is required');
    }
    const exists = await this.orderNoExists(normalizedOrderNo);
    return {
      orderNo: normalizedOrderNo,
      exists,
      available: !exists
    };
  }

  async create(dto: CreateOrderDto) {
    this.validateOrderLines(dto.lines);

    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date();
    const orderNo = dto.orderNo?.trim() || (await this.generateOrderNo(orderDate));
    await this.ensureOrderNoAvailable(orderNo);

    try {
      const created = await this.prisma.customerOrder.create({
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
              quantity: line.quantity,
              productionPlanQuantity: line.productionPlanQuantity ?? line.quantity,
              unit: line.unit.trim(),
              deliveryDate: line.deliveryDate ? new Date(line.deliveryDate) : dto.deliveryDate ? new Date(dto.deliveryDate) : null,
              remark: line.remark,
              processSnapshot: line.processSteps || [],
              processSteps: {
                create: (line.processSteps || []).map((processName, stepIndex) => ({
                  stepNo: stepIndex + 1,
                  processName
                }))
              }
            }))
          }
        },
        include: {
          customer: true,
          lines: {
            include: { processSteps: { orderBy: { stepNo: 'asc' } } },
            orderBy: { lineNo: 'asc' }
          }
        }
      });

      return this.toDetail(created);
    } catch (error) {
      if (this.isDuplicateOrderNoError(error)) {
        throw new BadRequestException(`Order number ${orderNo} already exists`);
      }
      throw error;
    }
  }

  async update(orderNo: string, dto: UpdateOrderDto) {
    this.validateOrderLines(dto.lines);

    const order = await this.prisma.customerOrder.findUnique({
      where: { orderNo },
      include: { lines: true }
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT orders can be edited');
    }

    // DRAFT 订单还没有进入生产，允许用当前明细整体替换订单零件，保持订单总表和明细表边界清晰。
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderLine.deleteMany({ where: { orderId: order.id } });
      return tx.customerOrder.update({
        where: { id: order.id },
        data: {
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          remark: dto.remark,
          lines: {
            create: dto.lines.map((line, index) => ({
              lineNo: index + 1,
              partCode: line.partCode.trim(),
              partName: line.partName.trim(),
              drawingNo: line.drawingNo?.trim(),
              quantity: line.quantity,
              productionPlanQuantity: line.productionPlanQuantity ?? line.quantity,
              unit: line.unit.trim(),
              deliveryDate: line.deliveryDate ? new Date(line.deliveryDate) : dto.deliveryDate ? new Date(dto.deliveryDate) : null,
              remark: line.remark,
              processSnapshot: line.processSteps || [],
              processSteps: {
                create: (line.processSteps || []).map((processName, stepIndex) => ({
                  stepNo: stepIndex + 1,
                  processName
                }))
              }
            }))
          }
        },
        include: {
          customer: true,
          lines: {
            include: { processSteps: { orderBy: { stepNo: 'asc' } } },
            orderBy: { lineNo: 'asc' }
          }
        }
      });
    });

    return this.toDetail(updated);
  }

  async updateLineProcess(orderNo: string, lineId: string, dto: UpdateLineProcessDto) {
    const order = await this.prisma.customerOrder.findUnique({ where: { orderNo } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const line = await this.prisma.orderLine.findFirst({ where: { id: lineId, orderId: order.id } });
    if (!line) {
      throw new NotFoundException('Order line not found');
    }

    // 保存某个订单零件的独立生产流程，并同步未完成的生产任务快照。
    await this.prisma.$transaction(async (tx) => {
      await tx.orderLineProcessStep.deleteMany({ where: { orderLineId: lineId } });
      if (dto.steps.length > 0) {
        await tx.orderLineProcessStep.createMany({
          data: dto.steps.map((processName, index) => ({
            orderLineId: lineId,
            stepNo: index + 1,
            processName
          }))
        });
      }
      await tx.orderLine.update({
        where: { id: lineId },
        data: { processSnapshot: dto.steps }
      });
      await tx.productionTask.updateMany({
        where: { orderLineId: lineId, status: { not: 'COMPLETED' } },
        data: { processSnapshot: dto.steps }
      });
    });

    return this.findOne(orderNo);
  }

  async submit(orderNo: string) {
    const order = await this.prisma.customerOrder.findUnique({
      where: { orderNo },
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
    const missingProcessLine = order.lines.find((line) => line.processSteps.length === 0);
    if (missingProcessLine) {
      throw new BadRequestException(`Process steps are required for part ${missingProcessLine.partCode}`);
    }

    // 提交订单时，为每个订单零件生成一条生产任务，保证多零件订单可以分别生产。
    await this.prisma.$transaction(async (tx) => {
      await tx.customerOrder.update({
        where: { id: order.id },
        data: { status: order.status === OrderStatus.DRAFT ? OrderStatus.SUBMITTED : order.status }
      });

      for (const line of order.lines) {
        const steps = line.processSteps.map((step) => step.processName);
        // 生产任务计划数使用生产计划数量，不再混用客户订单数量。
        await tx.productionTask.upsert({
          where: { productionTaskNo: `PT-${order.orderNo}-${String(line.lineNo).padStart(3, '0')}` },
          update: {
            processSnapshot: steps,
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
            processSnapshot: steps,
            status: 'PENDING'
          }
        });
      }
    });

    return this.findOne(orderNo);
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

  private async orderNoExists(orderNo: string) {
    const existing = await this.prisma.customerOrder.findUnique({
      where: { orderNo },
      select: { id: true }
    });
    return Boolean(existing);
  }

  private async ensureOrderNoAvailable(orderNo: string) {
    if (!orderNo.trim()) {
      throw new BadRequestException('Order number is required');
    }
    if (await this.orderNoExists(orderNo)) {
      throw new BadRequestException(`Order number ${orderNo} already exists`);
    }
  }

  private isDuplicateOrderNoError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes('orderNo')
    );
  }

  private validateOrderLines(lines: CreateOrderDto['lines']) {
    // 第一阶段按用户要求，一个订单最少保留 3 个零件，避免把订单总表和明细混成单零件订单。
    if (!lines || lines.length < 3) {
      throw new BadRequestException('At least 3 order lines are required');
    }

    lines.forEach((line, index) => {
      if (!line.partCode?.trim() || !line.partName?.trim() || !line.unit?.trim()) {
        throw new BadRequestException(`Order line ${index + 1} is incomplete`);
      }
      if (Number(line.quantity) <= 0) {
        throw new BadRequestException(`Order line ${index + 1} quantity must be greater than 0`);
      }
      const productionPlanQuantity = line.productionPlanQuantity ?? line.quantity;
      if (Number(productionPlanQuantity) <= 0) {
        throw new BadRequestException(`Order line ${index + 1} production plan quantity must be greater than 0`);
      }
      if (Number(productionPlanQuantity) < Number(line.quantity)) {
        throw new BadRequestException(`Order line ${index + 1} production plan quantity cannot be less than order quantity`);
      }
    });
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
      orderDate: order.orderDate,
      deliveryDate: order.deliveryDate,
      status: order.status,
      partCount: order.lines.length,
      totalQuantity,
      totalProductionPlanQuantity,
      unit: order.lines[0]?.unit || '件',
      remark: order.remark,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };
  }

  private toDetail(order: any) {
    return {
      ...this.toSummary(order),
      customer: order.customer,
      lines: order.lines.map((line: any) => ({
        id: line.id,
        lineNo: line.lineNo,
        partCode: line.partCode,
        partName: line.partName,
        drawingNo: line.drawingNo,
        quantity: decimalToNumber(line.quantity),
        productionPlanQuantity: decimalToNumber(line.productionPlanQuantity ?? line.quantity),
        unit: line.unit,
        deliveryDate: line.deliveryDate,
        remark: line.remark,
        processSteps: line.processSteps.map((step: any) => step.processName)
      }))
    };
  }
}
