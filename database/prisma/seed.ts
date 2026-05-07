import { Prisma, PrismaClient, OrderStatus, ProductionStatus, OrderLineFulfillmentMode } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawingUploadPath } from '../../backend/src/storage/upload-paths';

const prisma = new PrismaClient();

function assertSeedResetAllowed() {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowDestructiveSeed = process.env.ALLOW_DESTRUCTIVE_SEED === 'true';
  if (isProduction && !allowDestructiveSeed) {
    throw new Error('Seed reset is blocked in production. Set ALLOW_DESTRUCTIVE_SEED=true only when you intentionally reset test data.');
  }
}

type SeedOrderLine = {
  partCode: string;
  partName: string;
  drawingNo: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness?: number;
  partSpecification?: string;
  quantity: number;
  productionPlanQuantity?: number;
  fulfillmentMode?: OrderLineFulfillmentMode;
  unit: string;
};

type SeedProcessStep = string | { processName: string; processRemark?: string };

type NormalizedSeedProcessStep = {
  processName: string;
  processRemark?: string;
};

const defaultPartSpecifications = ['120mm x 204mm x 10mm', '200mm x 300mm x 2mm', '500mm x 800mm x 3mm'];
const defaultPartThicknesses = [1.2, 2, 3, 1.5];
const seedDrawingByNo: Record<string, { drawingFileName: string; drawingFileUrl: string; title: string }> = {
  'DRW-4101': {
    drawingFileName: 'DRW-4101-A.pdf',
    drawingFileUrl: '/uploads/drawings/seed-DRW-4101-A.pdf',
    title: 'DRW-4101 Press Test Cover'
  },
  'DRW-4102': {
    drawingFileName: 'DRW-4102-A.pdf',
    drawingFileUrl: '/uploads/drawings/seed-DRW-4102-A.pdf',
    title: 'DRW-4102 Welding Test Bracket'
  },
  'DRW-4103': {
    drawingFileName: 'DRW-4103-A.pdf',
    drawingFileUrl: '/uploads/drawings/seed-DRW-4103-A.pdf',
    title: 'DRW-4103 Coating Test Base'
  }
};

function withPartDrawingDefaults(line: SeedOrderLine, index: number) {
  const drawing = seedDrawingByNo[line.drawingNo];
  return {
    ...line,
    drawingVersion: line.drawingVersion || 'A',
    drawingFileName: line.drawingFileName || drawing?.drawingFileName,
    drawingFileUrl: line.drawingFileUrl || drawing?.drawingFileUrl,
    partThickness: line.partThickness ?? defaultPartThicknesses[index % defaultPartThicknesses.length],
    partSpecification: line.partSpecification || defaultPartSpecifications[index % defaultPartSpecifications.length]
  };
}

function pdfEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSeedPdf(title: string) {
  const lines = [title, 'Baisheng ERP seed drawing', 'Used for drawing preview and duplicate file name tests.'];
  const content = [
    'BT',
    '/F1 18 Tf',
    '72 760 Td',
    `(${pdfEscape(lines[0])}) Tj`,
    '/F1 12 Tf',
    '0 -28 Td',
    `(${pdfEscape(lines[1])}) Tj`,
    '0 -20 Td',
    `(${pdfEscape(lines[2])}) Tj`,
    'ET'
  ].join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

async function seedDrawingFiles() {
  const uploadPath = drawingUploadPath();
  for (const drawing of Object.values(seedDrawingByNo)) {
    const fileName = drawing.drawingFileUrl.split('/').pop();
    if (!fileName) {
      continue;
    }
    // 示例图纸用于本地测试“在线预览”和“同名图纸确认”，不代表真实客户图纸。
    writeFileSync(join(uploadPath, fileName), buildSeedPdf(drawing.title));
  }
}

async function resetSeedData() {
  // 本地测试 seed 必须可重复执行；先清空业务表，避免旧补单、库存和工序记录污染新测试数据。
  await prisma.inventoryAdjustment.deleteMany();
  await prisma.inventoryTransaction.deleteMany();
  await prisma.inventoryBatch.deleteMany();
  await prisma.productionScrapRecord.deleteMany();
  await prisma.productionNotice.deleteMany();
  await prisma.productionProcessCompletionLog.deleteMany();
  await prisma.productionProcessCompletion.deleteMany();
  await prisma.productionTask.deleteMany();
  await prisma.orderLineProcessStep.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.customerOrder.deleteMany();
  await prisma.customerContact.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.warehouseLocation.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.productionOperator.deleteMany();
  await prisma.material.deleteMany();
}

const processMap: Record<string, SeedProcessStep[]> = {
  'P-1001': ['激光切割', '折弯', '焊接', '打磨', '包装'],
  'P-1002': ['激光切割', '折弯', '喷涂', '包装'],
  'P-1003': ['冲压', '打磨', '装配', '包装'],
  'P-2001': ['激光切割', '折弯', '包装'],
  'P-2002': ['冲压', '焊接', '打磨', '包装'],
  'P-2003': ['激光切割', '喷涂', '包装'],
  'P-3001': ['冲压', '打磨', '包装'],
  'P-3002': ['激光切割', '折弯', '焊接', '包装'],
  'P-3003': ['折弯', '装配', '包装'],
  'P-4001': ['激光切割', '折弯', { processName: '冲压', processRemark: '4次' }, '包装'],
  'P-4002': ['冲压', { processName: '打磨', processRemark: '去毛刺' }, '包装'],
  'P-4003': ['激光切割', '喷涂', '包装'],
  'P-4004': ['装配', '包装'],
  'P-4101': [{ processName: '冲压', processRemark: '首件确认后连续生产' }, '打磨', '包装'],
  'P-4102': ['激光切割', { processName: '折弯', processRemark: 'R角按图纸' }, '焊接', '包装'],
  'P-4103': ['冲压', '喷涂', '包装']
};

function normalizeSeedProcessSteps(steps: SeedProcessStep[]): NormalizedSeedProcessStep[] {
  return steps
    .map((step) => {
      if (typeof step === 'string') {
        return { processName: step.trim() };
      }
      return {
        processName: step.processName.trim(),
        processRemark: step.processRemark?.trim()
      };
    })
    .filter((step) => step.processName);
}

function seedProcessSnapshot(steps: NormalizedSeedProcessStep[]): Prisma.InputJsonValue {
  return steps.map((step) => ({
    processName: step.processName,
    ...(step.processRemark ? { processRemark: step.processRemark } : {})
  })) as Prisma.InputJsonValue;
}

const productionOperatorSeeds = [
  {
    accountId: 'OP-001',
    name: '张明',
    role: '冲压操作员',
    pinyin: 'zhangming',
    pinyinInitials: 'zm',
    keywords: ['zhang', 'ming', 'zm', '冲压'],
    idCardBound: false
  },
  {
    accountId: 'OP-002',
    name: '李强',
    role: '激光切割操作员',
    pinyin: 'liqiang',
    pinyinInitials: 'lq',
    keywords: ['li', 'qiang', 'lq', '激光', '切割'],
    idCardBound: false
  },
  {
    accountId: 'OP-003',
    name: '王磊',
    role: '焊接操作员',
    pinyin: 'wanglei',
    pinyinInitials: 'wl',
    keywords: ['wang', 'lei', 'wl', '焊接'],
    idCardBound: false
  },
  {
    accountId: 'OP-004',
    name: '赵敏',
    role: '包装操作员',
    pinyin: 'zhaomin',
    pinyinInitials: 'zm',
    keywords: ['zhao', 'min', 'zm', '包装'],
    idCardBound: false
  },
  {
    accountId: 'OP-005',
    name: '顾胜钧',
    role: '折弯操作员',
    pinyin: 'gushengjun',
    pinyinInitials: 'gsj',
    keywords: ['gu', 'sheng', 'jun', 'gs', 'gsj', '折弯'],
    idCardMasked: '3204********1234',
    idCardBound: true
  }
];

const seedOperators = productionOperatorSeeds.map((operator) => ({
  operatorCode: operator.accountId,
  operatorName: operator.name,
  operatorRole: operator.role
}));

async function seedProductionOperators() {
  for (const operator of productionOperatorSeeds) {
    await prisma.productionOperator.upsert({
      where: { accountId: operator.accountId },
      update: {
        name: operator.name,
        role: operator.role,
        pinyin: operator.pinyin,
        pinyinInitials: operator.pinyinInitials,
        keywords: operator.keywords,
        idCardMasked: operator.idCardMasked,
        idCardBound: operator.idCardBound,
        status: 'ENABLED'
      },
      create: {
        ...operator,
        status: 'ENABLED'
      }
    });
  }
}

function seedProductionTaskState(
  orderNo: string,
  lineIndex: number,
  orderStatus: OrderStatus,
  processSteps: NormalizedSeedProcessStep[]
) {
  if (orderStatus === OrderStatus.COMPLETED) {
    return { taskStatus: ProductionStatus.COMPLETED, partialCompletedStepCount: processSteps.length };
  }

  // SO-20260506-005 专门保留多种生产测试状态：
  // 001：所有工序已确认但未最终确认，用于测试“确认完成”和短缺 / 补单逻辑。
  // 002：只完成第一道工序，用于测试“下一道工序”和多选连续工序。
  // 003：未开始生产，用于测试“开始生产”。
  if (orderNo === 'SO-20260506-005') {
    if (lineIndex === 0) {
      return { taskStatus: ProductionStatus.IN_PROGRESS, partialCompletedStepCount: processSteps.length };
    }
    if (lineIndex === 1) {
      return { taskStatus: ProductionStatus.IN_PROGRESS, partialCompletedStepCount: 1 };
    }
    return { taskStatus: ProductionStatus.PENDING, partialCompletedStepCount: 0 };
  }

  if (orderStatus === OrderStatus.IN_PRODUCTION && lineIndex === 0) {
    return { taskStatus: ProductionStatus.IN_PROGRESS, partialCompletedStepCount: 1 };
  }

  return { taskStatus: ProductionStatus.PENDING, partialCompletedStepCount: 0 };
}

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
    },
    {
      orderNo: 'SO-20260506-005',
      customer: customer1,
      orderDate: new Date('2026-05-06T00:00:00.000Z'),
      deliveryDate: new Date('2026-05-28T00:00:00.000Z'),
      status: OrderStatus.IN_PRODUCTION,
      lines: [
        { partCode: 'P-4101', partName: '冲压测试盖板', drawingNo: 'DRW-4101', quantity: 100, productionPlanQuantity: 120, unit: '件' },
        { partCode: 'P-4102', partName: '焊接测试支架', drawingNo: 'DRW-4102', quantity: 60, productionPlanQuantity: 60, unit: '件' },
        { partCode: 'P-4103', partName: '喷涂测试底座', drawingNo: 'DRW-4103', quantity: 80, productionPlanQuantity: 100, unit: '件' }
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
      const lineData = withPartDrawingDefaults(line, index);
      const fulfillmentMode = lineData.fulfillmentMode || OrderLineFulfillmentMode.PRODUCTION;
      const processSteps =
        fulfillmentMode === OrderLineFulfillmentMode.STOCK ? [] : normalizeSeedProcessSteps(processMap[lineData.partCode] || []);
      const savedLine = await prisma.orderLine.upsert({
        where: { orderId_lineNo: { orderId: savedOrder.id, lineNo: index + 1 } },
        update: {
          ...lineData,
          quantity: lineData.quantity,
          productionPlanQuantity: lineData.productionPlanQuantity ?? lineData.quantity,
          fulfillmentMode,
          processSnapshot: seedProcessSnapshot(processSteps)
        },
        create: {
          orderId: savedOrder.id,
          lineNo: index + 1,
          ...lineData,
          quantity: lineData.quantity,
          productionPlanQuantity: lineData.productionPlanQuantity ?? lineData.quantity,
          fulfillmentMode,
          deliveryDate: order.deliveryDate,
          processSnapshot: seedProcessSnapshot(processSteps)
        }
      });

      await prisma.orderLineProcessStep.deleteMany({ where: { orderLineId: savedLine.id } });
      for (const [stepIndex, processStep] of processSteps.entries()) {
        await prisma.orderLineProcessStep.create({
          data: {
            orderLineId: savedLine.id,
            stepNo: stepIndex + 1,
            processName: processStep.processName,
            processRemark: processStep.processRemark
          }
        });
      }

      if (order.status !== OrderStatus.DRAFT && fulfillmentMode !== OrderLineFulfillmentMode.STOCK) {
        const { taskStatus, partialCompletedStepCount } = seedProductionTaskState(order.orderNo, index, order.status, processSteps);

        const savedTask = await prisma.productionTask.upsert({
          where: { productionTaskNo: `PT-${order.orderNo}-${String(index + 1).padStart(3, '0')}` },
          update: {
            status: taskStatus,
            plannedQuantity: lineData.productionPlanQuantity ?? lineData.quantity,
            completedQuantity: taskStatus === ProductionStatus.COMPLETED ? lineData.quantity : 0,
            processSnapshot: seedProcessSnapshot(processSteps),
            startedAt: taskStatus !== ProductionStatus.PENDING ? new Date('2026-05-06T02:00:00.000Z') : null,
            completedAt: taskStatus === ProductionStatus.COMPLETED ? new Date('2026-05-06T08:00:00.000Z') : null
          },
          create: {
            productionTaskNo: `PT-${order.orderNo}-${String(index + 1).padStart(3, '0')}`,
            orderId: savedOrder.id,
            orderLineId: savedLine.id,
            orderNo: order.orderNo,
            customerName: order.customer.customerName,
            partCode: lineData.partCode,
            partName: lineData.partName,
            plannedQuantity: lineData.productionPlanQuantity ?? lineData.quantity,
            completedQuantity: taskStatus === ProductionStatus.COMPLETED ? lineData.quantity : 0,
            unit: lineData.unit,
            status: taskStatus,
            processSnapshot: seedProcessSnapshot(processSteps),
            startedAt: taskStatus !== ProductionStatus.PENDING ? new Date('2026-05-06T02:00:00.000Z') : null,
            completedAt: taskStatus === ProductionStatus.COMPLETED ? new Date('2026-05-06T08:00:00.000Z') : null
          }
        });

        await seedTaskProcessCompletions({
          productionTaskId: savedTask.id,
          taskStatus,
          steps: processSteps,
          unit: lineData.unit,
          completedQuantity:
            taskStatus === ProductionStatus.COMPLETED ? lineData.quantity : lineData.productionPlanQuantity ?? lineData.quantity,
          partialCompletedStepCount
        });
      }
    }
  }
}

async function seedTaskProcessCompletions({
  productionTaskId,
  taskStatus,
  steps,
  unit,
  completedQuantity,
  partialCompletedStepCount
}: {
  productionTaskId: string;
  taskStatus: ProductionStatus;
  steps: NormalizedSeedProcessStep[];
  unit: string;
  completedQuantity: number;
  partialCompletedStepCount: number;
}) {
  await prisma.productionProcessCompletion.deleteMany({ where: { productionTaskId } });

  for (const [index, processStep] of steps.entries()) {
    const processName = processStep.processName;
    const isCompleted = taskStatus === ProductionStatus.COMPLETED || index < partialCompletedStepCount;
    const operator = seedOperators[index % seedOperators.length];
    const completedAt = isCompleted ? new Date(`2026-05-06T0${Math.min(index + 2, 8)}:00:00.000Z`) : null;
    const completion = await prisma.productionProcessCompletion.create({
      data: {
        productionTaskId,
        stepNo: index + 1,
        processName,
        processRemark: processStep.processRemark,
        isCompleted,
        completedQuantity: isCompleted ? completedQuantity : 0,
        unit,
        operatorCode: isCompleted ? operator.operatorCode : null,
        operatorName: isCompleted ? operator.operatorName : null,
        operatorRole: isCompleted ? operator.operatorRole : null,
        completedAt,
        remark: isCompleted ? '种子数据：工序已完成' : null
      }
    });

    if (isCompleted) {
      await prisma.productionProcessCompletionLog.create({
        data: {
          completionId: completion.id,
          productionTaskId,
          processName,
          action: 'SEED_COMPLETE',
          operatorCode: operator.operatorCode,
          operatorName: operator.operatorName,
          afterSnapshot: {
            stepNo: index + 1,
            processName,
            processRemark: processStep.processRemark,
            isCompleted,
            completedQuantity,
            unit,
            operatorCode: operator.operatorCode,
            operatorName: operator.operatorName,
            operatorRole: operator.operatorRole,
            completedAt: completedAt?.toISOString(),
            remark: '种子数据：工序已完成'
          }
        }
      });
    }
  }
}

async function upsertMaterial(data: { partCode: string; partName: string; unit: string; partSpecification?: string | null }) {
  const existing = await prisma.material.findFirst({
    where: { partCode: { equals: data.partCode, mode: 'insensitive' } },
    select: { id: true, partSpecification: true }
  });

  if (existing) {
    await prisma.material.update({
      where: { id: existing.id },
      data: {
        partName: data.partName,
        unit: data.unit,
        partSpecification: data.partSpecification ?? existing.partSpecification,
        status: 'ENABLED'
      }
    });
    return;
  }

  await prisma.material.create({
    data: {
      partCode: data.partCode,
      partName: data.partName,
      unit: data.unit,
      partSpecification: data.partSpecification || null
    }
  });
}

async function seedMaterials() {
  const orderMaterials = await prisma.orderLine.findMany({
    select: {
      partCode: true,
      partName: true,
      unit: true,
      partSpecification: true
    },
    orderBy: [{ partCode: 'asc' }]
  });

  for (const material of orderMaterials) {
    await upsertMaterial({
      partCode: material.partCode,
      partName: material.partName,
      unit: material.unit,
      partSpecification: material.partSpecification
    });
  }

  const demoZeroStockMaterials = [
    { partCode: 'B3', partName: 'B3门板', unit: '件', partSpecification: '120mm x 204mm x 10mm' },
    { partCode: 'B3-0001', partName: 'B3-测试门板', unit: '件', partSpecification: '200mm x 300mm x 2mm' },
    { partCode: 'B3ASDJ', partName: 'B3ASDJ门板', unit: '件', partSpecification: '500mm x 800mm x 3mm' },
    { partCode: 'C3', partName: 'C3门板', unit: '件', partSpecification: '100mm x 180mm x 1.5mm' },
    { partCode: 'MC-3', partName: '3类机加工产品', unit: '件', partSpecification: '按图加工' }
  ];

  // 这些物料只进入物料清单，不创建库存批次，用于验证库存页 0 库存搜索结果。
  for (const material of demoZeroStockMaterials) {
    await upsertMaterial(material);
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
        partCode: task.partCode,
        partName: task.partName,
        sourceOrderId: task.orderId,
        sourceOrderLineId: task.orderLineId,
        sourceOrderNo: task.orderNo,
        sourceCustomerName: task.customerName,
        productionTaskId: task.id,
        sourceProductionTaskNo: task.productionTaskNo,
        quantity: task.completedQuantity,
        unit: task.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      },
      create: {
        batchNo,
        partCode: task.partCode,
        partName: task.partName,
        sourceOrderId: task.orderId,
        sourceOrderLineId: task.orderLineId,
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

  const stockSeedItems = [
    {
      batchNo: 'IB-STOCK-DEMO-P4101',
      transactionNo: 'IT-IN-STOCK-DEMO-P4101',
      partCode: 'P-4101',
      partName: '冲压测试盖板',
      quantity: 50,
      unit: '件'
    },
    {
      batchNo: 'IB-STOCK-DEMO-P4102',
      transactionNo: 'IT-IN-STOCK-DEMO-P4102',
      partCode: 'P-4102',
      partName: '焊接测试支架',
      quantity: 40,
      unit: '件'
    },
    {
      batchNo: 'IB-STOCK-DEMO-P4103',
      transactionNo: 'IT-IN-STOCK-DEMO-P4103',
      partCode: 'P-4103',
      partName: '喷涂测试底座',
      quantity: 60,
      unit: '件'
    }
  ];

  // 独立库存批次不绑定订单，用于测试下单时“使用库存”和“库存再加工”的库存扣减逻辑。
  for (const [index, item] of stockSeedItems.entries()) {
    const location = warehouse.locations[index % warehouse.locations.length];
    const batch = await prisma.inventoryBatch.upsert({
      where: { batchNo: item.batchNo },
      update: {
        partCode: item.partCode,
        partName: item.partName,
        sourceOrderId: null,
        sourceOrderLineId: null,
        sourceOrderNo: null,
        sourceCustomerName: null,
        productionTaskId: null,
        sourceProductionTaskNo: null,
        quantity: item.quantity,
        unit: item.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      },
      create: {
        batchNo: item.batchNo,
        partCode: item.partCode,
        partName: item.partName,
        sourceOrderId: null,
        sourceOrderLineId: null,
        sourceOrderNo: null,
        sourceCustomerName: null,
        productionTaskId: null,
        sourceProductionTaskNo: null,
        quantity: item.quantity,
        unit: item.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await prisma.inventoryTransaction.upsert({
      where: { transactionNo: item.transactionNo },
      update: {
        batchId: batch.id,
        quantity: item.quantity,
        warehouseId: warehouse.id,
        locationId: location.id
      },
      create: {
        transactionNo: item.transactionNo,
        transactionType: 'IN',
        batchId: batch.id,
        partCode: item.partCode,
        partName: item.partName,
        orderNo: null,
        productionTaskNo: null,
        quantity: item.quantity,
        unit: item.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        remark: '种子数据：独立库存，可用于下单时选择使用库存或库存再加工',
        sourceRecordType: 'SeedStockInventory',
        sourceRecordId: item.batchNo
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
  assertSeedResetAllowed();
  await resetSeedData();
  await seedDrawingFiles();
  await seedCustomers();
  await seedWarehouses();
  await seedProductionOperators();
  await seedOrders();
  await seedMaterials();
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
