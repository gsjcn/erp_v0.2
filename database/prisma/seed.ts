import { PrismaClient, OrderStatus, ProductionStatus } from '@prisma/client';

const prisma = new PrismaClient();

const processMap: Record<string, string[]> = {
  'P-1001': ['激光切割', '折弯', '焊接', '打磨', '包装'],
  'P-1002': ['激光切割', '折弯', '喷涂', '包装'],
  'P-1003': ['冲压', '打磨', '装配', '包装'],
  'P-2001': ['激光切割', '折弯', '包装'],
  'P-2002': ['冲压', '焊接', '打磨', '包装'],
  'P-2003': ['激光切割', '喷涂', '包装'],
  'P-3001': ['冲压', '打磨', '包装'],
  'P-3002': ['激光切割', '折弯', '焊接', '包装'],
  'P-3003': ['折弯', '装配', '包装'],
  'P-4001': ['激光切割', '折弯', '包装'],
  'P-4002': ['冲压', '打磨', '包装'],
  'P-4003': ['激光切割', '喷涂', '包装'],
  'P-4004': ['装配', '包装']
};

async function seedCustomers() {
  const customers = [
    {
      customerCode: 'C-001',
      customerName: '常州某钣金客户',
      regionType: 'CHINA' as const,
      country: '中国',
      province: '江苏省',
      city: '常州市',
      detailAddress: '',
      contacts: [{ contactName: '张经理', contactPhone: '138****6201', title: '经理' }],
      remark: '第一阶段示例客户',
      status: 'ENABLED' as const
    },
    {
      customerCode: 'C-002',
      customerName: '无锡设备配套客户',
      regionType: 'CHINA' as const,
      country: '中国',
      province: '江苏省',
      city: '无锡市',
      detailAddress: '',
      contacts: [{ contactName: '李工', contactPhone: '139****1024', title: '工程' }],
      remark: '设备配套订单',
      status: 'ENABLED' as const
    },
    {
      customerCode: 'C-003',
      customerName: '苏州表面处理客户',
      regionType: 'CHINA' as const,
      country: '中国',
      province: '江苏省',
      city: '苏州市',
      detailAddress: '',
      contacts: [{ contactName: '王主管', contactPhone: '137****8890', title: '主管' }],
      remark: '当前停用',
      status: 'DISABLED' as const
    }
  ];

  for (const customer of customers) {
    const { contacts, ...customerData } = customer;
    const primaryContact = contacts[0];
    const saved = await prisma.customer.upsert({
      where: { customerCode: customer.customerCode },
      update: {
        ...customerData,
        contactName: primaryContact?.contactName,
        contactPhone: primaryContact?.contactPhone,
        address: [customerData.country, customerData.province, customerData.city, customerData.detailAddress].filter(Boolean).join(' ')
      },
      create: {
        ...customerData,
        contactName: primaryContact?.contactName,
        contactPhone: primaryContact?.contactPhone,
        address: [customerData.country, customerData.province, customerData.city, customerData.detailAddress].filter(Boolean).join(' ')
      }
    });
    await prisma.customerContact.deleteMany({ where: { customerId: saved.id } });
    await prisma.customerContact.createMany({
      data: contacts.map((contact, index) => ({
        customerId: saved.id,
        ...contact,
        isPrimary: index === 0
      }))
    });
  }
}

async function seedWarehouses() {
  const warehouses = [
    {
      warehouseCode: 'WH-FG',
      warehouseName: '成品仓',
      locations: [
        { locationCode: 'A-01', locationName: 'A-01' },
        { locationCode: 'A-02', locationName: 'A-02' },
        { locationCode: 'A-03', locationName: 'A-03' }
      ]
    },
    {
      warehouseCode: 'WH-MAT',
      warehouseName: '辅料仓',
      locations: [{ locationCode: 'B-01', locationName: 'B-01' }]
    },
    {
      warehouseCode: 'WH-TMP',
      warehouseName: '临时仓',
      locations: [{ locationCode: 'T-01', locationName: 'T-01' }]
    }
  ];

  for (const warehouse of warehouses) {
    const saved = await prisma.warehouse.upsert({
      where: { warehouseCode: warehouse.warehouseCode },
      update: { warehouseName: warehouse.warehouseName, status: 'ENABLED' },
      create: {
        warehouseCode: warehouse.warehouseCode,
        warehouseName: warehouse.warehouseName
      }
    });

    for (const location of warehouse.locations) {
      await prisma.warehouseLocation.upsert({
        where: {
          warehouseId_locationCode: {
            warehouseId: saved.id,
            locationCode: location.locationCode
          }
        },
        update: { locationName: location.locationName, status: 'ENABLED' },
        create: {
          warehouseId: saved.id,
          locationCode: location.locationCode,
          locationName: location.locationName
        }
      });
    }
  }
}

async function seedOrders() {
  const customer1 = await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'C-001' } });
  const customer2 = await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'C-002' } });

  const orders = [
    {
      orderNo: 'SO-20260506-001',
      customer: customer1,
      orderDate: new Date('2026-05-06T00:00:00.000Z'),
      deliveryDate: new Date('2026-05-18T00:00:00.000Z'),
      status: OrderStatus.SUBMITTED,
      lines: [
        { partCode: 'P-1001', partName: '侧板支架', drawingNo: 'DRW-1001', quantity: 200, productionPlanQuantity: 200, unit: '件' },
        { partCode: 'P-1002', partName: '电控箱底板', drawingNo: 'DRW-1002', quantity: 80, productionPlanQuantity: 80, unit: '件' },
        { partCode: 'P-1003', partName: '加强筋', drawingNo: 'DRW-1003', quantity: 450, productionPlanQuantity: 450, unit: '件' }
      ]
    },
    {
      orderNo: 'SO-20260506-002',
      customer: customer2,
      orderDate: new Date('2026-05-06T00:00:00.000Z'),
      deliveryDate: new Date('2026-05-20T00:00:00.000Z'),
      status: OrderStatus.IN_PRODUCTION,
      lines: [
        { partCode: 'P-2001', partName: '设备门板', drawingNo: 'DRW-2001', quantity: 120, productionPlanQuantity: 180, unit: '件' },
        { partCode: 'P-2002', partName: '机架横梁', drawingNo: 'DRW-2002', quantity: 180, productionPlanQuantity: 180, unit: '件' },
        { partCode: 'P-2003', partName: '安装底座', drawingNo: 'DRW-2003', quantity: 120, productionPlanQuantity: 120, unit: '件' }
      ]
    },
    {
      orderNo: 'SO-20260506-003',
      customer: customer1,
      orderDate: new Date('2026-05-05T00:00:00.000Z'),
      deliveryDate: new Date('2026-05-15T00:00:00.000Z'),
      status: OrderStatus.COMPLETED,
      lines: [
        { partCode: 'P-3001', partName: '端盖', drawingNo: 'DRW-3001', quantity: 300, productionPlanQuantity: 300, unit: '件' },
        { partCode: 'P-3002', partName: '侧梁', drawingNo: 'DRW-3002', quantity: 360, productionPlanQuantity: 360, unit: '件' },
        { partCode: 'P-3003', partName: '连接板', drawingNo: 'DRW-3003', quantity: 300, productionPlanQuantity: 300, unit: '件' }
      ]
    },
    {
      orderNo: 'SO-20260506-004',
      customer: customer2,
      orderDate: new Date('2026-05-04T00:00:00.000Z'),
      deliveryDate: new Date('2026-05-24T00:00:00.000Z'),
      status: OrderStatus.DRAFT,
      lines: [
        { partCode: 'P-4001', partName: '前挡板', drawingNo: 'DRW-4001', quantity: 70, productionPlanQuantity: 70, unit: '件' },
        { partCode: 'P-4002', partName: '后挡板', drawingNo: 'DRW-4002', quantity: 70, productionPlanQuantity: 70, unit: '件' },
        { partCode: 'P-4003', partName: '侧封板', drawingNo: 'DRW-4003', quantity: 90, productionPlanQuantity: 90, unit: '件' },
        { partCode: 'P-4004', partName: '支撑脚', drawingNo: 'DRW-4004', quantity: 80, productionPlanQuantity: 80, unit: '件' }
      ]
    }
  ];

  for (const order of orders) {
    const savedOrder = await prisma.customerOrder.upsert({
      where: { orderNo: order.orderNo },
      update: {
        customerId: order.customer.id,
        customerCode: order.customer.customerCode,
        customerName: order.customer.customerName,
        customerSnapshot: {
          customerCode: order.customer.customerCode,
          customerName: order.customer.customerName,
          contactName: order.customer.contactName,
          contactPhone: order.customer.contactPhone
        },
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        status: order.status
      },
      create: {
        orderNo: order.orderNo,
        customerId: order.customer.id,
        customerCode: order.customer.customerCode,
        customerName: order.customer.customerName,
        customerSnapshot: {
          customerCode: order.customer.customerCode,
          customerName: order.customer.customerName,
          contactName: order.customer.contactName,
          contactPhone: order.customer.contactPhone
        },
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        status: order.status
      }
    });

    for (const [index, line] of order.lines.entries()) {
      const savedLine = await prisma.orderLine.upsert({
        where: { orderId_lineNo: { orderId: savedOrder.id, lineNo: index + 1 } },
        update: {
          ...line,
          quantity: line.quantity,
          productionPlanQuantity: line.productionPlanQuantity ?? line.quantity,
          processSnapshot: processMap[line.partCode]
        },
        create: {
          orderId: savedOrder.id,
          lineNo: index + 1,
          ...line,
          quantity: line.quantity,
          productionPlanQuantity: line.productionPlanQuantity ?? line.quantity,
          deliveryDate: order.deliveryDate,
          processSnapshot: processMap[line.partCode]
        }
      });

      await prisma.orderLineProcessStep.deleteMany({ where: { orderLineId: savedLine.id } });
      for (const [stepIndex, processName] of processMap[line.partCode].entries()) {
        await prisma.orderLineProcessStep.create({
          data: {
            orderLineId: savedLine.id,
            stepNo: stepIndex + 1,
            processName
          }
        });
      }

      if (order.status !== OrderStatus.DRAFT) {
        const taskStatus =
          order.status === OrderStatus.COMPLETED
            ? ProductionStatus.COMPLETED
            : order.status === OrderStatus.IN_PRODUCTION && index === 0
              ? ProductionStatus.IN_PROGRESS
              : ProductionStatus.PENDING;

        await prisma.productionTask.upsert({
          where: { productionTaskNo: `PT-${order.orderNo}-${String(index + 1).padStart(3, '0')}` },
          update: {
            status: taskStatus,
            plannedQuantity: line.productionPlanQuantity ?? line.quantity,
            completedQuantity: taskStatus === ProductionStatus.COMPLETED ? line.quantity : 0,
            processSnapshot: processMap[line.partCode],
            startedAt: taskStatus !== ProductionStatus.PENDING ? new Date('2026-05-06T02:00:00.000Z') : null,
            completedAt: taskStatus === ProductionStatus.COMPLETED ? new Date('2026-05-06T08:00:00.000Z') : null
          },
          create: {
            productionTaskNo: `PT-${order.orderNo}-${String(index + 1).padStart(3, '0')}`,
            orderId: savedOrder.id,
            orderLineId: savedLine.id,
            orderNo: order.orderNo,
            customerName: order.customer.customerName,
            partCode: line.partCode,
            partName: line.partName,
            plannedQuantity: line.productionPlanQuantity ?? line.quantity,
            completedQuantity: taskStatus === ProductionStatus.COMPLETED ? line.quantity : 0,
            unit: line.unit,
            status: taskStatus,
            processSnapshot: processMap[line.partCode],
            startedAt: taskStatus !== ProductionStatus.PENDING ? new Date('2026-05-06T02:00:00.000Z') : null,
            completedAt: taskStatus === ProductionStatus.COMPLETED ? new Date('2026-05-06T08:00:00.000Z') : null
          }
        });
      }
    }
  }
}

async function seedInventory() {
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { warehouseCode: 'WH-FG' },
    include: { locations: true }
  });
  const completedTasks = await prisma.productionTask.findMany({
    where: { orderNo: 'SO-20260506-003', status: ProductionStatus.COMPLETED },
    include: { order: true }
  });

  for (const [index, task] of completedTasks.entries()) {
    const location = warehouse.locations[index % warehouse.locations.length];
    const batchNo = `IB-${task.productionTaskNo}`;
    const transactionNo = `IT-IN-${task.productionTaskNo}`;

    const batch = await prisma.inventoryBatch.upsert({
      where: { batchNo },
      update: {
        quantity: task.completedQuantity,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      },
      create: {
        batchNo,
        partCode: task.partCode,
        partName: task.partName,
        sourceOrderId: task.orderId,
        sourceOrderNo: task.orderNo,
        sourceCustomerName: task.customerName,
        productionTaskId: task.id,
        sourceProductionTaskNo: task.productionTaskNo,
        quantity: task.completedQuantity,
        unit: task.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await prisma.inventoryTransaction.upsert({
      where: { transactionNo },
      update: {
        batchId: batch.id,
        quantity: task.completedQuantity,
        warehouseId: warehouse.id,
        locationId: location.id
      },
      create: {
        transactionNo,
        transactionType: 'IN',
        batchId: batch.id,
        partCode: task.partCode,
        partName: task.partName,
        orderNo: task.orderNo,
        productionTaskNo: task.productionTaskNo,
        quantity: task.completedQuantity,
        unit: task.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        remark: '种子数据入库',
        sourceRecordType: 'ProductionTask',
        sourceRecordId: task.id
      }
    });
  }

  // 种子数据中的已入库库存还没有发货，所以订单不能直接显示为已完成。
  await prisma.customerOrder.updateMany({
    where: {
      orderNo: 'SO-20260506-003',
      inventoryBatches: { some: { status: 'AVAILABLE' } }
    },
    data: { status: OrderStatus.IN_PRODUCTION }
  });
}

async function main() {
  await seedCustomers();
  await seedWarehouses();
  await seedOrders();
  await seedInventory();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
