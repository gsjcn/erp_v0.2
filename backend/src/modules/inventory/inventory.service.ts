import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decimalToNumber } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryQueryDto } from './dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: InventoryQueryDto) {
    const where: Prisma.InventoryBatchWhereInput = {};
    const keyword = query.keyword?.trim();

    if (keyword) {
      where.OR = [
        { partCode: { contains: keyword, mode: 'insensitive' } },
        { partName: { contains: keyword, mode: 'insensitive' } },
        { sourceOrderNo: { contains: keyword, mode: 'insensitive' } },
        { sourceCustomerName: { contains: keyword, mode: 'insensitive' } }
      ];
    }

    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }

    if (query.orderNo) {
      where.sourceOrderNo = { contains: query.orderNo, mode: 'insensitive' };
    }

    if (query.status) {
      where.status = query.status;
    }

    const batches = await this.prisma.inventoryBatch.findMany({
      where,
      include: {
        warehouse: true,
        location: true,
        sourceOrder: true,
        productionTask: { include: { orderLine: true } }
      },
      orderBy: [{ createdAt: 'desc' }, { partCode: 'asc' }]
    });

    return batches.map((batch) => ({
      id: batch.id,
      batchNo: batch.batchNo,
      partCode: batch.partCode,
      partName: batch.partName,
      quantity: decimalToNumber(batch.quantity),
      unit: batch.unit,
      warehouseId: batch.warehouseId,
      warehouseName: batch.warehouse.warehouseName,
      locationId: batch.locationId,
      locationName: batch.location?.locationName,
      sourceOrderNo: batch.sourceOrderNo,
      sourceCustomerName: batch.sourceCustomerName,
      sourceProductionTaskNo: batch.sourceProductionTaskNo,
      // 库存来源订单日期用于入库后继续追踪交期，不做质量追溯扩展。
      orderDate: batch.sourceOrder?.orderDate,
      deliveryDate: batch.productionTask?.orderLine?.deliveryDate || batch.sourceOrder?.deliveryDate,
      status: batch.status,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt
    }));
  }
}
