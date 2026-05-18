import { Prisma, PrismaClient, OrderStatus, ProductionStatus, OrderLineFulfillmentMode, InventoryReservationStatus } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawingUploadPath, inventoryAdjustmentUploadPath } from '../../backend/src/storage/upload-paths';
import { buildPinyinSearchText } from '../../backend/src/common/pinyin-search';
import { decimalToNumber } from '../../backend/src/common/serializers';

const prisma = new PrismaClient();

function isLocalSeedDatabaseUrl(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    return false;
  }
  try {
    const host = new URL(databaseUrl).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function assertSeedResetAllowed() {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowDestructiveSeed = process.env.ALLOW_DESTRUCTIVE_SEED === 'true';
  const backupConfirmed = process.env.SEED_BACKUP_CONFIRMED === 'true';
  if (isProduction && !allowDestructiveSeed) {
    throw new Error('Seed reset is blocked in production. Set ALLOW_DESTRUCTIVE_SEED=true only when you intentionally reset test data.');
  }
  if (allowDestructiveSeed || backupConfirmed || (!isProduction && isLocalSeedDatabaseUrl())) {
    return;
  }
  throw new Error(
    'Seed reset is blocked. Use a local DATABASE_URL, run npm run docker:db:seed so backup confirmation is passed, or set ALLOW_DESTRUCTIVE_SEED=true only for intentional test resets.'
  );
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

function roundSeedQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function seedProductionPlanFields(line: SeedOrderLine, fulfillmentMode: OrderLineFulfillmentMode, selectedStockQuantity = 0) {
  const productionPlanQuantity = roundSeedQuantity(Number(line.productionPlanQuantity ?? line.quantity));
  const suggestedQuantity =
    fulfillmentMode === OrderLineFulfillmentMode.STOCK
      ? roundSeedQuantity(Math.max(Number(line.quantity || 0) - selectedStockQuantity, 0))
      : roundSeedQuantity(Number(line.quantity || 0));
  const planDiffers = Math.abs(productionPlanQuantity - suggestedQuantity) > 0.0001;

  return {
    productionPlanQuantity,
    productionPlanSuggestedQuantity: suggestedQuantity,
    productionPlanOverrideByCode: planDiffers ? 'PLAN-001' : null,
    productionPlanOverrideByName: planDiffers ? '刘计划' : null,
    productionPlanOverrideByRole: planDiffers ? '生产计划员' : null,
    productionPlanOverrideAt: planDiffers ? new Date('2026-05-08T09:00:00.000Z') : null,
    // 种子数据也必须保留计划偏差说明，避免回归验证把测试数据误判成真实业务漏洞。
    productionPlanOverrideReason: planDiffers
      ? `种子数据：生产计划数量 ${productionPlanQuantity} 与建议数量 ${suggestedQuantity} 不一致，用于验证计划偏差记录。`
      : null
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

function seedInventoryAdjustmentAttachment() {
  const fileName = 'seed-inventory-adjustment-001.pdf';
  const content = buildSeedPdf('Seed inventory adjustment worksheet');
  writeFileSync(join(inventoryAdjustmentUploadPath(), fileName), content);
  return {
    fileName,
    fileUrl: `/uploads/inventory-adjustments/${fileName}`,
    mimeType: 'application/pdf',
    size: content.byteLength
  };
}

async function resetSeedData() {
  // 本地测试 seed 必须可重复执行；先清空业务表，避免旧补单、库存和工序记录污染新测试数据。
  await prisma.inventoryReservation.deleteMany();
  await prisma.inventoryAdjustment.deleteMany();
  await prisma.inventoryTransaction.deleteMany();
  await prisma.inventoryBatch.deleteMany();
  await prisma.productionScrapRecord.deleteMany();
  await prisma.productionReplenishmentRequest.deleteMany();
  await prisma.productionNotice.deleteMany();
  await prisma.productionProcessCompletionLog.deleteMany();
  await prisma.productionProcessCompletion.deleteMany();
  await prisma.productionTask.deleteMany();
  await prisma.orderLineProcessStep.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.customerOrder.deleteMany();
  await prisma.orderNoReservation.deleteMany();
  await prisma.modelBomDiffReview.deleteMany();
  await prisma.modelBomCustomerScope.deleteMany();
  await prisma.modelBomLine.deleteMany();
  await prisma.modelBom.deleteMany();
  await prisma.materialTransformRule.deleteMany();
  await prisma.materialApplicability.deleteMany();
  await prisma.materialDrawingRevision.deleteMany();
  await prisma.materialCommonProjectModel.deleteMany();
  await prisma.customerContact.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.warehouseLocation.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.productionOperator.deleteMany();
  await prisma.processTemplate.deleteMany();
  await prisma.processDefinition.deleteMany();
  await prisma.material.deleteMany();
}

async function seedCommonProjectModels() {
  const projectModels = ['B3', 'B5'];
  for (const [index, projectModel] of projectModels.entries()) {
    // 常用机型只是零件管理快捷入口默认值，不改变 BOM、适用范围、订单或库存。
    await prisma.materialCommonProjectModel.upsert({
      where: { projectModelNormalized: projectModel.toLocaleLowerCase('zh-CN') },
      update: {
        projectModel,
        sortOrder: index + 1,
        status: 'ENABLED'
      },
      create: {
        projectModel,
        projectModelNormalized: projectModel.toLocaleLowerCase('zh-CN'),
        sortOrder: index + 1,
        status: 'ENABLED'
      }
    });
  }
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
  'P-4103': ['冲压', '喷涂', '包装'],
  'P-6001': ['激光切割', '折弯', '包装'],
  'P-6002': ['冲压', '焊接', '包装']
};

const processTemplateSeeds: Array<{ templateName: string; steps: SeedProcessStep[]; remark?: string }> = [
  { templateName: '激光折弯包装', steps: ['激光切割', '折弯', '包装'], remark: '常用钣金零件基础流程' },
  { templateName: '焊接件', steps: ['激光切割', '折弯', '焊接', '打磨', '包装'], remark: '带焊接和打磨的组合件流程' },
  { templateName: '冲压装配件', steps: ['冲压', '打磨', '装配', '包装'], remark: '冲压后需要装配的零件流程' },
  { templateName: '喷涂件', steps: ['激光切割', '折弯', '喷涂', '包装'], remark: '带表面喷涂的基础流程' }
];

const processDefinitionSeeds = [
  '激光切割',
  '折弯',
  '冲压',
  '焊接',
  '打磨',
  '喷涂',
  '抛丸',
  '抛光',
  '测试1',
  '测试2',
  '装配',
  '包装',
  '其他'
];

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
    accountId: 'PLAN-001',
    name: '刘计划',
    role: '生产计划员',
    pinyin: 'liujihua',
    pinyinInitials: 'ljh',
    keywords: ['liu', 'jihua', 'ljh', '计划', '下计划', '下单', '订单'],
    idCardBound: false
  },
  {
    accountId: 'ORDER-001',
    name: '孙下单',
    role: '下单管理员',
    pinyin: 'sunxiadan',
    pinyinInitials: 'sxd',
    keywords: ['sun', 'xiadan', 'sxd', '下单', '订单', '订单管理员'],
    idCardBound: false
  },
  {
    accountId: 'WS-001',
    name: '陈主任',
    role: '车间主任',
    pinyin: 'chenzhuren',
    pinyinInitials: 'czr',
    keywords: ['chen', 'zhuren', 'czr', '车间主任', '主任', '车间', '主管'],
    idCardBound: false
  },
  {
    accountId: 'WH-001',
    name: '周仓管',
    role: '仓库管理员',
    pinyin: 'zhoucangguan',
    pinyinInitials: 'zcg',
    keywords: ['zhou', 'cangguan', 'zcg', '仓库', '仓管', '库管', '入库', '发货'],
    idCardBound: false
  },
  {
    accountId: 'TECH-001',
    name: '王工艺',
    role: '技术工艺员',
    pinyin: 'wanggongyi',
    pinyinInitials: 'wgy',
    keywords: ['wang', 'gongyi', 'wgy', '技术', '工艺', '流程'],
    idCardBound: false
  },
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

async function seedProcessTemplates() {
  for (const template of processTemplateSeeds) {
    const steps = normalizeSeedProcessSteps(template.steps);
    await prisma.processTemplate.upsert({
      where: { templateNameNormalized: template.templateName.trim().toLowerCase() },
      update: {
        steps: seedProcessSnapshot(steps),
        remark: template.remark,
        searchText: buildPinyinSearchText([template.templateName, template.remark, ...steps.flatMap((step) => [step.processName, step.processRemark])])
      },
      create: {
        templateName: template.templateName,
        templateNameNormalized: template.templateName.trim().toLowerCase(),
        steps: seedProcessSnapshot(steps),
        remark: template.remark,
        searchText: buildPinyinSearchText([template.templateName, template.remark, ...steps.flatMap((step) => [step.processName, step.processRemark])])
      }
    });
  }
}

async function seedProcessDefinitions() {
  for (const processName of processDefinitionSeeds) {
    await prisma.processDefinition.upsert({
      where: { processNameNormalized: processName.trim().toLowerCase() },
      update: {
        processName,
        status: 'ENABLED',
        searchText: buildPinyinSearchText([processName])
      },
      create: {
        processName,
        processNameNormalized: processName.trim().toLowerCase(),
        status: 'ENABLED',
        searchText: buildPinyinSearchText([processName])
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
      return { taskStatus: ProductionStatus.WAITING_CONFIRMATION, partialCompletedStepCount: processSteps.length };
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
      detailAddress: null,
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
      detailAddress: null,
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
      detailAddress: null,
      contacts: [{ contactName: '王主管', contactPhone: '137****8890', title: '主管' }],
      remark: '当前停用',
      status: 'DISABLED' as const
    },
    {
      customerCode: 'C-004',
      customerName: '江阴市百胜制冷设备有限公司',
      regionType: 'CHINA' as const,
      country: '中国',
      province: '江苏省',
      city: '江阴市',
      detailAddress: null,
      contacts: [{ contactName: '百胜制冷', contactPhone: '136****0520', title: '业务' }],
      remark: '百胜全部机型通用零件包所属客户',
      status: 'ENABLED' as const
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
      status: OrderStatus.PENDING_PRODUCTION,
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
        { partCode: 'P-3001', partName: '端盖', drawingNo: 'DRW-3001', quantity: 300, productionPlanQuantity: 320, unit: '件' },
        { partCode: 'P-3002', partName: '侧梁', drawingNo: 'DRW-3002', quantity: 360, productionPlanQuantity: 360, unit: '件' },
        { partCode: 'P-3003', partName: '连接板', drawingNo: 'DRW-3003', quantity: 300, productionPlanQuantity: 300, unit: '件' }
      ]
    },
    {
      orderNo: 'SO-20260506-006',
      customer: customer2,
      orderDate: new Date('2026-05-07T00:00:00.000Z'),
      deliveryDate: new Date('2026-05-25T00:00:00.000Z'),
      status: OrderStatus.COMPLETED,
      lines: [
        { partCode: 'P-6001', partName: '发货测试面板', drawingNo: 'DRW-6001', quantity: 40, productionPlanQuantity: 40, unit: '件' },
        { partCode: 'P-6002', partName: '发货测试支架', drawingNo: 'DRW-6002', quantity: 60, productionPlanQuantity: 60, unit: '件' }
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

    await prisma.orderNoReservation.upsert({
      where: { orderNoNormalized: order.orderNo.toUpperCase() },
      update: {
        orderNo: order.orderNo.toUpperCase(),
        sourceOrderId: savedOrder.id,
        reservedReason: 'SEED_ORDER_RESERVED'
      },
      create: {
        orderNo: order.orderNo.toUpperCase(),
        orderNoNormalized: order.orderNo.toUpperCase(),
        sourceOrderId: savedOrder.id,
        reservedReason: 'SEED_ORDER_RESERVED'
      }
    });

    for (const [index, line] of order.lines.entries()) {
      const lineData = withPartDrawingDefaults(line, index);
      const fulfillmentMode = lineData.fulfillmentMode || OrderLineFulfillmentMode.PRODUCTION;
      const productionPlanFields = seedProductionPlanFields(lineData, fulfillmentMode);
      const processSteps =
        fulfillmentMode === OrderLineFulfillmentMode.STOCK ? [] : normalizeSeedProcessSteps(processMap[lineData.partCode] || []);
      const savedLine = await prisma.orderLine.upsert({
        where: { orderId_lineNo: { orderId: savedOrder.id, lineNo: index + 1 } },
        update: {
          ...lineData,
          quantity: lineData.quantity,
          ...productionPlanFields,
          fulfillmentMode,
          processSnapshot: seedProcessSnapshot(processSteps)
        },
        create: {
          orderId: savedOrder.id,
          lineNo: index + 1,
          ...lineData,
          quantity: lineData.quantity,
          ...productionPlanFields,
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
        const taskCompletedQuantity =
          taskStatus === ProductionStatus.COMPLETED ? lineData.productionPlanQuantity ?? lineData.quantity : 0;
        const processCompletedQuantity =
          taskStatus === ProductionStatus.COMPLETED ? taskCompletedQuantity : lineData.productionPlanQuantity ?? lineData.quantity;

        const savedTask = await prisma.productionTask.upsert({
          where: { productionTaskNo: `PT-${order.orderNo}-${String(index + 1).padStart(3, '0')}` },
          update: {
            status: taskStatus,
            plannedQuantity: lineData.productionPlanQuantity ?? lineData.quantity,
            completedQuantity: taskCompletedQuantity,
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
            completedQuantity: taskCompletedQuantity,
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
          completedQuantity: processCompletedQuantity,
          partialCompletedStepCount
        });
      }
    }
  }
}

async function seedReplenishmentAndNotices() {
  const task = await prisma.productionTask.findUniqueOrThrow({
    where: { productionTaskNo: 'PT-SO-20260506-005-001' },
    include: {
      order: true,
      orderLine: true,
      processCompletions: { orderBy: { stepNo: 'desc' } }
    }
  });
  const completion = task.processCompletions[0];
  if (!completion) {
    throw new Error('Seed task PT-SO-20260506-005-001 has no process completion');
  }

  // 这组数据用于验收生产报废补单：工序完成表已申请补齐，但还未生成补单任务。
  const requestedQuantity = 20;
  const savedCompletion = await prisma.productionProcessCompletion.update({
    where: { id: completion.id },
    data: {
      completedQuantity: 100,
      scrapQuantity: requestedQuantity,
      shortageQuantity: requestedQuantity,
      shortageMode: 'REPLENISHMENT_REQUEST',
      shortageReason: '种子数据：末道工序报废 20 件，申请补齐客户订单数量',
      remark: '种子数据：待主管确认生产报废补单'
    }
  });

  await prisma.productionReplenishmentRequest.upsert({
    where: { requestNo: 'PRR-20260508-001' },
    update: {
      status: 'PENDING',
      orderId: task.orderId,
      orderNo: task.orderNo,
      orderLineId: task.orderLineId,
      productionTaskId: task.id,
      productionTaskNo: task.productionTaskNo,
      processCompletionId: savedCompletion.id,
      partCode: task.partCode,
      partName: task.partName,
      requestQuantity: requestedQuantity,
      scrapQuantity: requestedQuantity,
      unit: task.unit,
      reason: '种子数据：报废缺件，需要主管确认后生成补单任务',
      requestedByCode: savedCompletion.operatorCode,
      requestedByName: savedCompletion.operatorName,
      supervisorName: null,
      supervisorRemark: null,
      approvedAt: null,
      reviewedAt: null,
      replenishmentTaskNo: null
    },
    create: {
      requestNo: 'PRR-20260508-001',
      sourceType: 'PRODUCTION_SCRAP',
      status: 'PENDING',
      orderId: task.orderId,
      orderNo: task.orderNo,
      orderLineId: task.orderLineId,
      productionTaskId: task.id,
      productionTaskNo: task.productionTaskNo,
      processCompletionId: savedCompletion.id,
      partCode: task.partCode,
      partName: task.partName,
      requestQuantity: requestedQuantity,
      scrapQuantity: requestedQuantity,
      unit: task.unit,
      reason: '种子数据：报废缺件，需要主管确认后生成补单任务',
      requestedByCode: savedCompletion.operatorCode,
      requestedByName: savedCompletion.operatorName
    }
  });

  await prisma.productionScrapRecord.upsert({
    where: { scrapNo: 'SCRAP-SEED-001' },
    update: {
      orderId: task.orderId,
      orderNo: task.orderNo,
      orderLineId: task.orderLineId,
      productionTaskId: task.id,
      productionTaskNo: task.productionTaskNo,
      partCode: task.partCode,
      partName: task.partName,
      quantity: requestedQuantity,
      unit: task.unit,
      reason: '种子数据：末道工序报废',
      sourceRecordType: 'ProductionProcessCompletion',
      sourceRecordId: savedCompletion.id,
      recordDate: new Date('2026-05-08T03:00:00.000Z')
    },
    create: {
      scrapNo: 'SCRAP-SEED-001',
      orderId: task.orderId,
      orderNo: task.orderNo,
      orderLineId: task.orderLineId,
      productionTaskId: task.id,
      productionTaskNo: task.productionTaskNo,
      partCode: task.partCode,
      partName: task.partName,
      quantity: requestedQuantity,
      unit: task.unit,
      reason: '种子数据：末道工序报废',
      sourceRecordType: 'ProductionProcessCompletion',
      sourceRecordId: savedCompletion.id,
      recordDate: new Date('2026-05-08T03:00:00.000Z')
    }
  });

  const resolvedShortageTask = await prisma.productionTask.findUniqueOrThrow({
    where: { productionTaskNo: 'PT-SO-20260506-005-002' },
    include: {
      order: true,
      orderLine: true,
      processCompletions: { orderBy: { stepNo: 'asc' } }
    }
  });
  const resolvedShortageCompletion = resolvedShortageTask.processCompletions[0];
  if (!resolvedShortageCompletion) {
    throw new Error('Seed task PT-SO-20260506-005-002 has no process completion');
  }

  // 这组数据用于验收“生产短缺已处理，无需补单”的闭环：短缺仍保留记录，但订单明细不再提示待补单。
  const resolvedShortageQuantity = 5;
  const savedResolvedShortageCompletion = await prisma.productionProcessCompletion.update({
    where: { id: resolvedShortageCompletion.id },
    data: {
      completedQuantity: 55,
      scrapQuantity: resolvedShortageQuantity,
      shortageQuantity: resolvedShortageQuantity,
      shortageMode: 'MANAGER_APPROVED',
      shortageReason: '种子数据：生产缺 5 件，客户确认接受缺货',
      shortageResolutionMode: 'NO_REPLENISHMENT',
      shortageResolutionBy: '种子管理员',
      shortageResolutionReason: '种子数据：客户确认接受缺货发货，不生成补单',
      shortageResolvedAt: new Date('2026-05-08T04:00:00.000Z'),
      remark: '种子数据：短缺已处理，无需补单'
    }
  });

  await prisma.productionScrapRecord.upsert({
    where: { scrapNo: 'SCRAP-SEED-002' },
    update: {
      orderId: resolvedShortageTask.orderId,
      orderNo: resolvedShortageTask.orderNo,
      orderLineId: resolvedShortageTask.orderLineId,
      productionTaskId: resolvedShortageTask.id,
      productionTaskNo: resolvedShortageTask.productionTaskNo,
      partCode: resolvedShortageTask.partCode,
      partName: resolvedShortageTask.partName,
      quantity: resolvedShortageQuantity,
      unit: resolvedShortageTask.unit,
      reason: '种子数据：客户确认接受缺货，不补单',
      sourceRecordType: 'ProductionProcessCompletion',
      sourceRecordId: savedResolvedShortageCompletion.id,
      recordDate: new Date('2026-05-08T04:00:00.000Z')
    },
    create: {
      scrapNo: 'SCRAP-SEED-002',
      orderId: resolvedShortageTask.orderId,
      orderNo: resolvedShortageTask.orderNo,
      orderLineId: resolvedShortageTask.orderLineId,
      productionTaskId: resolvedShortageTask.id,
      productionTaskNo: resolvedShortageTask.productionTaskNo,
      partCode: resolvedShortageTask.partCode,
      partName: resolvedShortageTask.partName,
      quantity: resolvedShortageQuantity,
      unit: resolvedShortageTask.unit,
      reason: '种子数据：客户确认接受缺货，不补单',
      sourceRecordType: 'ProductionProcessCompletion',
      sourceRecordId: savedResolvedShortageCompletion.id,
      recordDate: new Date('2026-05-08T04:00:00.000Z')
    }
  });

  const noticeOrder = await prisma.customerOrder.findUniqueOrThrow({
    where: { orderNo: 'SO-20260506-005' },
    include: { lines: { orderBy: { lineNo: 'asc' } } }
  });
  const noticeLine = noticeOrder.lines[1] || noticeOrder.lines[0];

  await prisma.productionNotice.upsert({
    where: { noticeNo: 'PN-SEED-PRODUCTION-001' },
    update: {
      noticeType: 'QUANTITY_INCREASE',
      status: 'PENDING',
      target: 'PRODUCTION',
      orderId: noticeOrder.id,
      orderNo: noticeOrder.orderNo,
      orderLineId: noticeLine.id,
      partCode: noticeLine.partCode,
      partName: noticeLine.partName,
      beforeQuantity: 60,
      afterQuantity: 80,
      deltaQuantity: 20,
      unit: noticeLine.unit,
      reason: '种子数据：客户数量增加，等待生产确认',
      managerName: '种子管理员',
      acknowledgedBy: null,
      acknowledgedAt: null
    },
    create: {
      noticeNo: 'PN-SEED-PRODUCTION-001',
      noticeType: 'QUANTITY_INCREASE',
      status: 'PENDING',
      target: 'PRODUCTION',
      orderId: noticeOrder.id,
      orderNo: noticeOrder.orderNo,
      orderLineId: noticeLine.id,
      partCode: noticeLine.partCode,
      partName: noticeLine.partName,
      beforeQuantity: 60,
      afterQuantity: 80,
      deltaQuantity: 20,
      unit: noticeLine.unit,
      reason: '种子数据：客户数量增加，等待生产确认',
      managerName: '种子管理员'
    }
  });

  await prisma.productionNotice.upsert({
    where: { noticeNo: 'PN-SEED-WAREHOUSE-001' },
    update: {
      noticeType: 'MATERIAL_ADDED',
      status: 'PENDING',
      target: 'WAREHOUSE',
      orderId: noticeOrder.id,
      orderNo: noticeOrder.orderNo,
      orderLineId: noticeLine.id,
      partCode: noticeLine.partCode,
      partName: noticeLine.partName,
      unit: noticeLine.unit,
      reason: '种子数据：订单新增物料，等待仓库确认',
      managerName: '种子管理员',
      acknowledgedBy: null,
      acknowledgedAt: null
    },
    create: {
      noticeNo: 'PN-SEED-WAREHOUSE-001',
      noticeType: 'MATERIAL_ADDED',
      status: 'PENDING',
      target: 'WAREHOUSE',
      orderId: noticeOrder.id,
      orderNo: noticeOrder.orderNo,
      orderLineId: noticeLine.id,
      partCode: noticeLine.partCode,
      partName: noticeLine.partName,
      unit: noticeLine.unit,
      reason: '种子数据：订单新增物料，等待仓库确认',
      managerName: '种子管理员'
    }
  });
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
          action: 'TASK_FINAL_CONFIRM',
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

async function upsertMaterial(data: {
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  stockAlertEnabled?: boolean;
  stockAlertQuantity?: number | null;
}) {
  const existing = await prisma.material.findFirst({
    where: { partCode: { equals: data.partCode, mode: 'insensitive' } },
    select: { id: true, partSpecification: true }
  });
  const stockAlertData =
    data.stockAlertEnabled === undefined
      ? {}
      : {
          stockAlertEnabled: data.stockAlertEnabled,
          stockAlertQuantity: data.stockAlertEnabled ? (data.stockAlertQuantity ?? null) : null
        };

  if (existing) {
    await prisma.material.update({
      where: { id: existing.id },
      data: {
        partName: data.partName,
        unit: data.unit,
        partSpecification: data.partSpecification ?? existing.partSpecification,
        status: 'ENABLED',
        ...stockAlertData
      }
    });
    return;
  }

  await prisma.material.create({
    data: {
      partCode: data.partCode,
      partName: data.partName,
      unit: data.unit,
      partSpecification: data.partSpecification || null,
      stockAlertEnabled: data.stockAlertEnabled ?? false,
      stockAlertQuantity: data.stockAlertEnabled ? (data.stockAlertQuantity ?? null) : null
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

  const stockAlertFixtures = [
    { partCode: 'P-4101', stockAlertQuantity: 20 },
    { partCode: 'P-4102', stockAlertQuantity: 50 },
    { partCode: 'B3-0001', stockAlertQuantity: 5 }
  ];
  for (const fixture of stockAlertFixtures) {
    // 库存报警 seed 只写 Material 基础资料的提醒线，不自动补单、下单、提交生产或扣库存。
    await prisma.material.updateMany({
      where: { partCode: { equals: fixture.partCode, mode: 'insensitive' } },
      data: {
        stockAlertEnabled: true,
        stockAlertQuantity: fixture.stockAlertQuantity
      }
    });
  }

  const drawingLines = await prisma.orderLine.findMany({
    where: { drawingNo: { not: null } },
    select: {
      partCode: true,
      drawingNo: true,
      drawingVersion: true,
      drawingDate: true,
      drawingStatus: true,
      drawingFileName: true,
      drawingFileUrl: true
    },
    orderBy: [{ createdAt: 'desc' }]
  });
  const defaultDrawingMaterialIds = new Set<string>();
  const seenDrawingKeys = new Set<string>();
  for (const line of drawingLines) {
    const drawingNo = line.drawingNo?.trim();
    if (!drawingNo) {
      continue;
    }
    const material = await prisma.material.findFirst({
      where: { partCode: { equals: line.partCode, mode: 'insensitive' } },
      select: { id: true }
    });
    if (!material) {
      continue;
    }
    const drawingVersion = line.drawingVersion?.trim() || 'A';
    const drawingKey = [material.id, drawingNo, drawingVersion].map((item) => item.toLocaleLowerCase()).join('|');
    if (seenDrawingKeys.has(drawingKey)) {
      continue;
    }
    seenDrawingKeys.add(drawingKey);
    const isDefault = !defaultDrawingMaterialIds.has(material.id);
    if (isDefault) {
      await prisma.materialDrawingRevision.updateMany({
        where: { materialId: material.id, isDefault: true },
        data: { isDefault: false }
      });
      defaultDrawingMaterialIds.add(material.id);
    }
    await prisma.materialDrawingRevision.upsert({
      where: {
        materialId_drawingNo_drawingVersion: {
          materialId: material.id,
          drawingNo,
          drawingVersion
        }
      },
      update: {
        drawingDate: line.drawingDate,
        drawingStatus: line.drawingStatus,
        drawingFileName: line.drawingFileName,
        drawingFileUrl: line.drawingFileUrl,
        isDefault,
        defaultChangedBy: isDefault ? 'seed' : null,
        defaultChangedAt: isDefault ? new Date('2026-05-08T00:00:00.000Z') : null,
        status: 'ENABLED'
      },
      create: {
        materialId: material.id,
        drawingNo,
        drawingVersion,
        drawingDate: line.drawingDate,
        drawingStatus: line.drawingStatus,
        drawingFileName: line.drawingFileName,
        drawingFileUrl: line.drawingFileUrl,
        isDefault,
        defaultChangedBy: isDefault ? 'seed' : null,
        defaultChangedAt: isDefault ? new Date('2026-05-08T00:00:00.000Z') : null,
        remark: '种子数据：从历史订单图纸快照生成零件默认图纸版本',
        status: 'ENABLED'
      }
    });
  }
}

async function seedModelBoms() {
  const customer1 = await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'C-001' } });
  const customer2 = await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'C-002' } });
  const baishengCustomer = await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'C-004' } });

  const materialByCode = async (partCode: string) => {
    const material = await prisma.material.findUniqueOrThrow({
      where: { partCode },
      include: {
        drawingRevisions: {
          where: { status: 'ENABLED' },
          orderBy: [{ isDefault: 'desc' }, { drawingDate: 'desc' }, { createdAt: 'desc' }]
        }
      }
    });
    return material;
  };

  const [b3Assembly, sideBracket, bottomPlate, stiffener, b5Assembly, doorPanel, frameBeam, mountingBase, customPanel] = await Promise.all([
    materialByCode('B3'),
    materialByCode('P-1001'),
    materialByCode('P-1002'),
    materialByCode('P-1003'),
    materialByCode('B3-0001'),
    materialByCode('P-2001'),
    materialByCode('P-2002'),
    materialByCode('P-2003'),
    materialByCode('P-4001')
  ]);

  const lineData = (
    material: Awaited<ReturnType<typeof materialByCode>>,
    options: {
      lineType?: 'COMPONENT' | 'PART';
      partCategory: string;
      componentNo?: string | null;
      parentComponentNo?: string | null;
      defaultQuantity: number;
      sortOrder: number;
      defaultProcessRoute?: string;
      remark?: string;
    }
  ) => ({
    materialId: material.id,
    partCodeSnapshot: material.partCode,
    partNameSnapshot: material.partName,
    unitSnapshot: material.unit,
    partSpecificationSnapshot: material.partSpecification,
    lineType: options.lineType || 'PART',
    partCategory: options.partCategory,
    componentNo: options.lineType === 'COMPONENT' ? options.componentNo || null : null,
    parentComponentNo: options.lineType === 'COMPONENT' ? null : options.parentComponentNo || null,
    defaultDrawingRevisionId: material.drawingRevisions[0]?.id || null,
    defaultProcessRoute: options.defaultProcessRoute || null,
    defaultQuantity: options.defaultQuantity,
    sortOrder: options.sortOrder,
    remark: options.remark || null,
    status: 'ENABLED' as const
  });

  await prisma.modelBom.create({
    data: {
      bomName: '百胜全部机型通用零件包',
      customerId: baishengCustomer.id,
      customerNameSnapshot: baishengCustomer.customerName,
      projectModel: '',
      customerScopeMode: 'PRIVATE',
      customerScopeKey: baishengCustomer.id,
      projectModelScopeKey: 'ALL',
      remark: '种子数据：百胜全部机型通用 BOM 已转入江阴市百胜制冷设备有限公司客户下，避免其他客户界面误显示',
      isCommon: true,
      commonSortOrder: 1,
      status: 'ENABLED',
      // BOM seed 只写基础资料和推荐清单，不生成订单、生产任务或库存流水。
      lines: {
        create: [
          lineData(stiffener, {
            partCategory: '百胜通用件',
            defaultQuantity: 1,
            sortOrder: 1,
            defaultProcessRoute: '冲压、打磨、包装',
            remark: '全部机型通用备件'
          })
        ]
      }
    }
  });

  const globalB3 = await prisma.modelBom.create({
    data: {
      bomName: 'B3 百胜通用零件包',
      customerId: null,
      customerNameSnapshot: null,
      projectModel: 'B3',
      customerScopeMode: 'ALL',
      customerScopeKey: 'ALL',
      projectModelScopeKey: 'B3',
      remark: '种子数据：百胜通用 BOM，可复制为客户独立 BOM',
      status: 'ENABLED',
      // BOM seed 只写基础资料和推荐清单，不生成订单、生产任务或库存流水。
      lines: {
        create: [
          lineData(b3Assembly, {
            lineType: 'COMPONENT',
            partCategory: '百胜通用组件',
            componentNo: 'C001',
            defaultQuantity: 1,
            sortOrder: 1,
            defaultProcessRoute: '装配、包装',
            remark: 'B3 组件父级'
          }),
          lineData(sideBracket, {
            partCategory: '百胜通用件',
            parentComponentNo: 'C001',
            defaultQuantity: 2,
            sortOrder: 2,
            defaultProcessRoute: '激光切割、折弯、包装'
          }),
          lineData(bottomPlate, {
            partCategory: '百胜通用件',
            parentComponentNo: 'C001',
            defaultQuantity: 1,
            sortOrder: 3,
            defaultProcessRoute: '激光切割、折弯、喷涂、包装'
          }),
          lineData(stiffener, {
            partCategory: '百胜通用件',
            defaultQuantity: 4,
            sortOrder: 4,
            defaultProcessRoute: '冲压、打磨、装配、包装'
          })
        ]
      }
    }
  });

  await prisma.modelBom.create({
    data: {
      bomName: '常州客户通用零件包',
      customerId: customer1.id,
      customerNameSnapshot: customer1.customerName,
      projectModel: '',
      customerScopeMode: 'PRIVATE',
      customerScopeKey: customer1.id,
      projectModelScopeKey: 'ALL',
      remark: '种子数据：客户全部机型通用 BOM，验证客户通用件和指定机型 BOM 可并存',
      status: 'ENABLED',
      lines: {
        create: [
          lineData(mountingBase, {
            partCategory: '客户通用件',
            defaultQuantity: 1,
            sortOrder: 1,
            defaultProcessRoute: '激光切割、喷涂、包装',
            remark: '客户全部机型通用底座'
          })
        ]
      }
    }
  });

  await prisma.modelBom.create({
    data: {
      bomName: 'B3 常州客户零件包',
      customerId: customer1.id,
      customerNameSnapshot: customer1.customerName,
      projectModel: 'B3',
      customerScopeMode: 'PRIVATE',
      customerScopeKey: customer1.id,
      projectModelScopeKey: 'B3',
      sourceBomId: globalB3.id,
      sourceBomNameSnapshot: globalB3.bomName,
      remark: '种子数据：从百胜通用 BOM 复制后独立维护，验证客户下拉和差异提示',
      isCommon: true,
      commonSortOrder: 2,
      status: 'ENABLED',
      lines: {
        create: [
          lineData(b3Assembly, {
            lineType: 'COMPONENT',
            partCategory: '客户通用组件',
            componentNo: 'C001',
            defaultQuantity: 1,
            sortOrder: 1,
            defaultProcessRoute: '装配、包装'
          }),
          lineData(sideBracket, {
            partCategory: '客户通用件',
            parentComponentNo: 'C001',
            defaultQuantity: 2,
            sortOrder: 2,
            defaultProcessRoute: '激光切割、折弯、包装'
          }),
          lineData(customPanel, {
            partCategory: '客户定制件',
            parentComponentNo: 'C001',
            defaultQuantity: 1,
            sortOrder: 3,
            defaultProcessRoute: '激光切割、折弯、包装',
            remark: '客户 B3 定制替换件'
          })
        ]
      }
    }
  });

  await prisma.modelBom.create({
    data: {
      bomName: 'B5 无锡客户零件包',
      customerId: customer2.id,
      customerNameSnapshot: customer2.customerName,
      projectModel: 'B5',
      customerScopeMode: 'PRIVATE',
      customerScopeKey: customer2.id,
      projectModelScopeKey: 'B5',
      remark: '种子数据：客户指定机型 BOM，验证客户关键字和机型筛选',
      isCommon: true,
      commonSortOrder: 3,
      status: 'ENABLED',
      lines: {
        create: [
          lineData(b5Assembly, {
            lineType: 'COMPONENT',
            partCategory: '客户通用组件',
            componentNo: 'C001',
            defaultQuantity: 1,
            sortOrder: 1,
            defaultProcessRoute: '装配、包装'
          }),
          lineData(doorPanel, {
            partCategory: '客户定制件',
            parentComponentNo: 'C001',
            defaultQuantity: 2,
            sortOrder: 2,
            defaultProcessRoute: '激光切割、折弯、包装'
          }),
          lineData(frameBeam, {
            partCategory: '客户通用件',
            parentComponentNo: 'C001',
            defaultQuantity: 4,
            sortOrder: 3,
            defaultProcessRoute: '冲压、焊接、打磨、包装'
          }),
          lineData(mountingBase, {
            partCategory: '客户通用件',
            defaultQuantity: 1,
            sortOrder: 4,
            defaultProcessRoute: '激光切割、喷涂、包装'
          })
        ]
      }
    }
  });
}

async function seedMaterialTransformRules() {
  const customer1 = await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'C-001' } });
  const customer2 = await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'C-002' } });
  const materialByCode = async (partCode: string) =>
    prisma.material.findUniqueOrThrow({
      where: { partCode },
      select: { id: true, partCode: true, partName: true }
    });

  const [pressCover, frontPanel, weldingBracket, frameBeam] = await Promise.all([
    materialByCode('P-4101'),
    materialByCode('P-4001'),
    materialByCode('P-4102'),
    materialByCode('P-2002')
  ]);

  const transformRules = [
    {
      source: pressCover,
      target: frontPanel,
      customer: customer2,
      projectModel: 'B3',
      multiplier: 1,
      lossRate: 0.03,
      defaultProcessRoute: '冲压、打磨、包装',
      conversionDescription: '示例：库存冲压测试盖板可作为前挡板再加工来源，提交生产时仍需人工核对图纸和批次。',
      remark: '种子数据：验证来源加工关系只作为库存来源建议，不自动扣库存。'
    },
    {
      source: weldingBracket,
      target: frameBeam,
      customer: customer2,
      projectModel: 'B5',
      multiplier: 1,
      lossRate: 0.02,
      defaultProcessRoute: '焊接、打磨、包装',
      conversionDescription: '示例：焊接测试支架可作为机架横梁的再加工来源，点击查来源库存后仍需逐批确认。',
      remark: '种子数据：用于库存来源核对弹窗展示来源加工建议。'
    }
  ];

  for (const rule of transformRules) {
    // 来源加工关系只写建议规则，不生成订单、生产任务、库存批次或库存流水。
    await prisma.materialTransformRule.create({
      data: {
        sourceMaterialId: rule.source.id,
        targetMaterialId: rule.target.id,
        customerId: rule.customer.id,
        customerNameSnapshot: rule.customer.customerName,
        projectModel: rule.projectModel,
        customerScopeKey: rule.customer.id,
        projectModelScopeKey: rule.projectModel,
        conversionDescription: rule.conversionDescription,
        defaultProcessRoute: rule.defaultProcessRoute,
        multiplier: rule.multiplier,
        lossRate: rule.lossRate,
        remark: rule.remark,
        status: 'ENABLED'
      }
    });
  }
}

async function seedInventory() {
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { warehouseCode: 'WH-FG' },
    include: { locations: true }
  });
  const completedTasks = await prisma.productionTask.findMany({
    where: { status: ProductionStatus.COMPLETED },
    include: { order: true, orderLine: true },
    orderBy: [{ orderNo: 'asc' }, { productionTaskNo: 'asc' }]
  });

  for (const [index, task] of completedTasks.entries()) {
    const location = warehouse.locations[index % warehouse.locations.length];
    const batchNo = `IB-${task.productionTaskNo}`;
    const stockBatchNo = `IB-STOCK-${task.productionTaskNo}`;
    const transactionNo = `IT-IN-${task.productionTaskNo}`;
    const stockTransactionNo = `IT-IN-STOCK-${task.productionTaskNo}`;
    const completedQuantity = decimalToNumber(task.completedQuantity);
    const customerOrderQuantity = decimalToNumber(task.orderLine.quantity);
    const orderQuantity = Math.min(completedQuantity, customerOrderQuantity);
    const stockQuantity = Math.max(completedQuantity - orderQuantity, 0);

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
        sourceKind: 'NORMAL_ORDER',
        quantity: orderQuantity,
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
        sourceKind: 'NORMAL_ORDER',
        quantity: orderQuantity,
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
        quantity: orderQuantity,
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
        quantity: orderQuantity,
        unit: task.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        remark: '种子数据入库',
        sourceRecordType: 'ProductionTask',
        sourceRecordId: task.id
      }
    });

    if (stockQuantity > 0) {
      const stockBatch = await prisma.inventoryBatch.upsert({
        where: { batchNo: stockBatchNo },
        update: {
          partCode: task.partCode,
          partName: task.partName,
          sourceOrderId: null,
          sourceOrderLineId: null,
          sourceOrderNo: null,
          sourceCustomerName: task.customerName,
          productionTaskId: null,
          sourceProductionTaskNo: task.productionTaskNo,
          sourceKind: 'NORMAL_ORDER',
          quantity: stockQuantity,
          unit: task.unit,
          warehouseId: warehouse.id,
          locationId: location.id,
          status: 'AVAILABLE'
        },
        create: {
          batchNo: stockBatchNo,
          partCode: task.partCode,
          partName: task.partName,
          sourceOrderId: null,
          sourceOrderLineId: null,
          sourceOrderNo: null,
          sourceCustomerName: task.customerName,
          productionTaskId: null,
          sourceProductionTaskNo: task.productionTaskNo,
          sourceKind: 'NORMAL_ORDER',
          quantity: stockQuantity,
          unit: task.unit,
          warehouseId: warehouse.id,
          locationId: location.id,
          status: 'AVAILABLE'
        }
      });

      await prisma.inventoryTransaction.upsert({
        where: { transactionNo: stockTransactionNo },
        update: {
          batchId: stockBatch.id,
          quantity: stockQuantity,
          warehouseId: warehouse.id,
          locationId: location.id
        },
        create: {
          transactionNo: stockTransactionNo,
          transactionType: 'IN',
          batchId: stockBatch.id,
          partCode: task.partCode,
          partName: task.partName,
          orderNo: null,
          productionTaskNo: task.productionTaskNo,
          quantity: stockQuantity,
          unit: task.unit,
          warehouseId: warehouse.id,
          locationId: location.id,
          remark: '种子数据：生产多做数量转备货库存，可用于下单库存来源核对',
          sourceRecordType: 'ProductionTaskOverage',
          sourceRecordId: task.id
        }
      });
    }

    await prisma.productionTask.update({
      where: { id: task.id },
      data: { status: ProductionStatus.STORED }
    });
  }

  const stockSeedItems = [
    {
      batchNo: 'IB-STOCK-DEMO-P2001-SMALL',
      transactionNo: 'IT-IN-STOCK-DEMO-P2001-SMALL',
      partCode: 'P-2001',
      partName: '设备门板',
      quantity: 2,
      unit: '件',
      sourceProductionTaskNo: 'PT-SO-20260506-002-001'
    },
    {
      batchNo: 'IB-STOCK-DEMO-P2001-LARGE',
      transactionNo: 'IT-IN-STOCK-DEMO-P2001-LARGE',
      partCode: 'P-2001',
      partName: '设备门板',
      quantity: 58,
      unit: '件',
      sourceProductionTaskNo: 'PT-SO-20260506-002-001'
    },
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
        sourceProductionTaskNo: item.sourceProductionTaskNo ?? null,
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
        sourceProductionTaskNo: item.sourceProductionTaskNo ?? null,
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
        productionTaskNo: item.sourceProductionTaskNo ?? null,
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
        productionTaskNo: item.sourceProductionTaskNo ?? null,
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

  await seedDraftInventoryReservationOrder();
  await seedStockFulfillmentOrders();

  // SO-20260506-003 用于验证已生产但未全量发货：先发一批，剩余批次继续待发货。
  await seedOrderShipment('SO-20260506-003', 'PARTIAL', '种子数据：部分发货，用于验证已完成未发货状态');

  // SO-20260506-006 用于验证已完成发货：订单库存全部发完后才进入 COMPLETED。
  await seedOrderShipment('SO-20260506-006', 'FULL', '种子数据：整单发货，用于验证已完成发货状态');

  // 种子数据中的已入库库存若还没有全量发货，订单不能直接显示为已完成发货。
  await prisma.customerOrder.updateMany({
    where: {
      orderNo: 'SO-20260506-003',
      inventoryBatches: { some: { status: 'AVAILABLE' } }
    },
    data: { status: OrderStatus.IN_PRODUCTION }
  });
}

type SeedStockCustomer = {
  id: string;
  customerCode: string;
  customerName: string;
  contactName?: string | null;
  contactPhone?: string | null;
};

async function seedStockFulfillmentOrders() {
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { warehouseCode: 'WH-FG' },
    include: { locations: true }
  });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'C-001' } });

  await seedStockFulfillmentOrder({
    orderNo: 'SO-20260508-002',
    customer,
    orderDate: new Date('2026-05-08T00:00:00.000Z'),
    deliveryDate: new Date('2026-05-26T00:00:00.000Z'),
    line: {
      partCode: 'P-4102',
      partName: '焊接测试支架',
      drawingNo: 'DRW-4102',
      quantity: 40,
      productionPlanQuantity: 0,
      unit: '件'
    },
    selectedBatchNo: 'IB-STOCK-DEMO-P4102',
    selectedQuantity: 40,
    locationId: warehouse.locations[0]?.id
  });

  await seedStockFulfillmentOrder({
    orderNo: 'SO-20260508-003',
    customer,
    orderDate: new Date('2026-05-08T00:00:00.000Z'),
    deliveryDate: new Date('2026-05-27T00:00:00.000Z'),
    line: {
      partCode: 'P-4103',
      partName: '喷涂测试底座',
      drawingNo: 'DRW-4103',
      quantity: 100,
      productionPlanQuantity: 40,
      unit: '件'
    },
    selectedBatchNo: 'IB-STOCK-DEMO-P4103',
    selectedQuantity: 60,
    locationId: warehouse.locations[1]?.id || warehouse.locations[0]?.id
  });
}

async function seedDraftInventoryReservationOrder() {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'C-001' } });
  const sourceBatch = await prisma.inventoryBatch.findUniqueOrThrow({
    where: { batchNo: 'IB-STOCK-DEMO-P2001-LARGE' }
  });
  const orderDate = new Date('2026-05-08T00:00:00.000Z');
  const processSteps = normalizeSeedProcessSteps(processMap['P-2001'] || []);
  const draftOrders = [
    {
      orderNo: 'SO-20260508-900',
      deliveryDate: new Date('2026-05-30T00:00:00.000Z'),
      remark: '种子数据：两条草稿零件共用同一备货库存批次，用于验证订单内库存预占扣除。',
      manualRemark: '种子数据：演示同一库存批次被同一草稿订单的两条零件预占。',
      lines: [
        { lineNo: 1, quantity: 50, selectedQuantity: 20, productionPlanQuantity: 30, remark: '种子数据：同批次库存预占第一条' },
        { lineNo: 2, quantity: 100, selectedQuantity: 30, productionPlanQuantity: 70, remark: '种子数据：同批次库存预占第二条' }
      ]
    },
    {
      orderNo: 'SO-20260508-901',
      deliveryDate: new Date('2026-05-31T00:00:00.000Z'),
      remark: '种子数据：第二张草稿订单引用同一备货库存批次，用于验证跨订单库存预占扣除。',
      manualRemark: '种子数据：演示同一库存批次被另一张草稿订单预占。',
      lines: [
        { lineNo: 1, quantity: 20, selectedQuantity: 5, productionPlanQuantity: 15, remark: '种子数据：跨订单库存预占' }
      ]
    }
  ];

  for (const draftOrder of draftOrders) {
    const order = await prisma.customerOrder.upsert({
      where: { orderNo: draftOrder.orderNo },
      update: {
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
        deliveryDate: draftOrder.deliveryDate,
        status: OrderStatus.DRAFT,
        remark: draftOrder.remark
      },
      create: {
        orderNo: draftOrder.orderNo,
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
        deliveryDate: draftOrder.deliveryDate,
        status: OrderStatus.DRAFT,
        remark: draftOrder.remark
      }
    });

    await prisma.orderNoReservation.upsert({
      where: { orderNoNormalized: draftOrder.orderNo.toUpperCase() },
      update: {
        orderNo: draftOrder.orderNo.toUpperCase(),
        sourceOrderId: order.id,
        reservedReason: 'SEED_DRAFT_STOCK_RESERVED'
      },
      create: {
        orderNo: draftOrder.orderNo.toUpperCase(),
        orderNoNormalized: draftOrder.orderNo.toUpperCase(),
        sourceOrderId: order.id,
        reservedReason: 'SEED_DRAFT_STOCK_RESERVED'
      }
    });

    await prisma.inventoryReservation.deleteMany({ where: { orderId: order.id } });
    await prisma.orderLineProcessStep.deleteMany({ where: { orderLine: { orderId: order.id } } });
    await prisma.orderLine.deleteMany({ where: { orderId: order.id } });

    for (const line of draftOrder.lines) {
      const lineData = withPartDrawingDefaults(
        {
          partCode: 'P-2001',
          partName: '设备门板',
          drawingNo: 'DRW-2001',
          quantity: line.quantity,
          productionPlanQuantity: line.productionPlanQuantity,
          fulfillmentMode: OrderLineFulfillmentMode.STOCK,
          unit: '件'
        },
        line.lineNo
      );
      const productionPlanFields = seedProductionPlanFields(lineData, OrderLineFulfillmentMode.STOCK, line.selectedQuantity);
      const selectedSources = [
        {
          batchId: sourceBatch.id,
          batchNo: sourceBatch.batchNo,
          partCode: sourceBatch.partCode,
          partName: sourceBatch.partName,
          quantity: line.selectedQuantity,
          unit: sourceBatch.unit,
          compatibilityStatus: 'NEEDS_CONFIRMATION',
          compatibilityReason: '种子数据：跳过较小库存批次，已人工确认使用当前批次',
          manualConfirmedBy: '计划员',
          manualConfirmedAt: '2026-05-08T09:00:00.000Z',
          manualConfirmRemark: draftOrder.manualRemark
        }
      ];

      const savedLine = await prisma.orderLine.create({
        data: {
          order: { connect: { id: order.id } },
          lineNo: line.lineNo,
          ...lineData,
          ...productionPlanFields,
          deliveryDate: draftOrder.deliveryDate,
          remark: line.remark,
          processSnapshot: seedProcessSnapshot(processSteps),
          stockSourceSelections: selectedSources as Prisma.InputJsonValue
        }
      });

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

      await prisma.inventoryReservation.create({
        data: {
          batchId: sourceBatch.id,
          orderId: order.id,
          orderLineId: savedLine.id,
          orderNo: draftOrder.orderNo,
          partCode: lineData.partCode,
          partName: lineData.partName,
          quantity: line.selectedQuantity,
          unit: lineData.unit,
          status: InventoryReservationStatus.ACTIVE,
          statusReason: 'SEED_DRAFT_ORDER_RESERVED'
        }
      });
    }
  }
}

async function seedStockFulfillmentOrder(options: {
  orderNo: string;
  customer: SeedStockCustomer;
  orderDate: Date;
  deliveryDate: Date;
  line: SeedOrderLine;
  selectedBatchNo: string;
  selectedQuantity: number;
  locationId?: string;
}) {
  const savedOrder = await prisma.customerOrder.upsert({
    where: { orderNo: options.orderNo },
    update: {
      customerId: options.customer.id,
      customerCode: options.customer.customerCode,
      customerName: options.customer.customerName,
      customerSnapshot: {
        customerCode: options.customer.customerCode,
        customerName: options.customer.customerName,
        contactName: options.customer.contactName,
        contactPhone: options.customer.contactPhone
      },
      orderDate: options.orderDate,
      deliveryDate: options.deliveryDate,
      status: OrderStatus.PENDING_PRODUCTION
    },
    create: {
      orderNo: options.orderNo,
      customerId: options.customer.id,
      customerCode: options.customer.customerCode,
      customerName: options.customer.customerName,
      customerSnapshot: {
        customerCode: options.customer.customerCode,
        customerName: options.customer.customerName,
        contactName: options.customer.contactName,
        contactPhone: options.customer.contactPhone
      },
      orderDate: options.orderDate,
      deliveryDate: options.deliveryDate,
      status: OrderStatus.PENDING_PRODUCTION
    }
  });

  await prisma.orderNoReservation.upsert({
    where: { orderNoNormalized: options.orderNo.toUpperCase() },
    update: {
      orderNo: options.orderNo.toUpperCase(),
      sourceOrderId: savedOrder.id,
      reservedReason: 'SEED_STOCK_ORDER_RESERVED'
    },
    create: {
      orderNo: options.orderNo.toUpperCase(),
      orderNoNormalized: options.orderNo.toUpperCase(),
      sourceOrderId: savedOrder.id,
      reservedReason: 'SEED_STOCK_ORDER_RESERVED'
    }
  });

  const sourceBatch = await prisma.inventoryBatch.findUniqueOrThrow({
    where: { batchNo: options.selectedBatchNo }
  });
  const sourceAvailableQuantity = decimalToNumber(sourceBatch.quantity);
  if (sourceAvailableQuantity + 0.0001 < options.selectedQuantity) {
    throw new Error(`Seed stock batch ${options.selectedBatchNo} quantity is not enough`);
  }

  const lineData = withPartDrawingDefaults(
    {
      ...options.line,
      fulfillmentMode: OrderLineFulfillmentMode.STOCK
    },
    0
  );
  const productionPlanQuantity = Number(lineData.productionPlanQuantity || 0);
  const productionPlanFields = seedProductionPlanFields(lineData, OrderLineFulfillmentMode.STOCK, options.selectedQuantity);
  const processSteps = productionPlanQuantity > 0 ? normalizeSeedProcessSteps(processMap[lineData.partCode] || []) : [];
  const selectedSources = [
    {
      batchId: sourceBatch.id,
      batchNo: sourceBatch.batchNo,
      partCode: sourceBatch.partCode,
      partName: sourceBatch.partName,
      quantity: options.selectedQuantity,
      unit: sourceBatch.unit,
      compatibilityStatus: 'NEEDS_CONFIRMATION',
      compatibilityReason: '种子数据：独立备货库存缺少生产来源图纸快照，必须人工核对后使用',
      manualConfirmedBy: '种子库存核对员',
      manualConfirmedAt: '2026-05-08T02:00:00.000Z',
      manualConfirmRemark: '种子数据：已核对库存批次、图号、规格和用途，仅用于演示人工确认后的库存履约'
    }
  ];

  const savedLine = await prisma.orderLine.upsert({
    where: { orderId_lineNo: { orderId: savedOrder.id, lineNo: 1 } },
    update: {
      ...lineData,
      ...productionPlanFields,
      fulfillmentMode: OrderLineFulfillmentMode.STOCK,
      processSnapshot: seedProcessSnapshot(processSteps),
      stockSourceSelections: selectedSources as Prisma.InputJsonValue
    },
    create: {
      orderId: savedOrder.id,
      lineNo: 1,
      ...lineData,
      ...productionPlanFields,
      fulfillmentMode: OrderLineFulfillmentMode.STOCK,
      deliveryDate: options.deliveryDate,
      processSnapshot: seedProcessSnapshot(processSteps),
      stockSourceSelections: selectedSources as Prisma.InputJsonValue
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

  await prisma.inventoryReservation.deleteMany({
    where: {
      orderId: savedOrder.id,
      orderLineId: savedLine.id,
      batchId: sourceBatch.id
    }
  });
  await prisma.inventoryReservation.create({
    data: {
      batchId: sourceBatch.id,
      orderId: savedOrder.id,
      orderLineId: savedLine.id,
      orderNo: options.orderNo,
      partCode: lineData.partCode,
      partName: lineData.partName,
      quantity: options.selectedQuantity,
      unit: lineData.unit,
      status: InventoryReservationStatus.CONSUMED,
      statusReason: '种子数据：订单提交后已消耗备货库存',
      consumedAt: new Date('2026-05-08T02:05:00.000Z')
    }
  });

  const suffix = '001-01';
  const remainingSourceQuantity = Math.max(sourceAvailableQuantity - options.selectedQuantity, 0);
  // 使用库存订单的 seed 按真实业务写 OUT + IN 流水，避免测试数据绕过库存账。
  await prisma.inventoryBatch.update({
    where: { id: sourceBatch.id },
    data: remainingSourceQuantity > 0 ? { quantity: remainingSourceQuantity } : { quantity: 0, status: 'USED' }
  });

  await prisma.inventoryTransaction.upsert({
    where: { transactionNo: `IT-STOCK-OUT-${options.orderNo}-${suffix}` },
    update: {
      transactionType: 'OUT',
      batchId: sourceBatch.id,
      orderLineId: savedLine.id,
      partCode: sourceBatch.partCode,
      partName: sourceBatch.partName,
      orderNo: null,
      productionTaskNo: sourceBatch.sourceProductionTaskNo,
      quantity: options.selectedQuantity,
      unit: sourceBatch.unit,
      warehouseId: sourceBatch.warehouseId,
      locationId: sourceBatch.locationId,
      remark: '种子数据：订单使用备货库存',
      sourceRecordType: 'OrderLineSTOCK',
      sourceRecordId: savedLine.id
    },
    create: {
      transactionNo: `IT-STOCK-OUT-${options.orderNo}-${suffix}`,
      transactionType: 'OUT',
      batchId: sourceBatch.id,
      orderLineId: savedLine.id,
      partCode: sourceBatch.partCode,
      partName: sourceBatch.partName,
      orderNo: null,
      productionTaskNo: sourceBatch.sourceProductionTaskNo,
      quantity: options.selectedQuantity,
      unit: sourceBatch.unit,
      warehouseId: sourceBatch.warehouseId,
      locationId: sourceBatch.locationId,
      remark: '种子数据：订单使用备货库存',
      sourceRecordType: 'OrderLineSTOCK',
      sourceRecordId: savedLine.id
    }
  });

  const orderBatch = await prisma.inventoryBatch.upsert({
    where: { batchNo: `IB-ALLOC-${options.orderNo}-${suffix}` },
    update: {
      partCode: lineData.partCode,
      partName: lineData.partName,
      sourceOrderId: savedOrder.id,
      sourceOrderLineId: savedLine.id,
      sourceOrderNo: options.orderNo,
      sourceCustomerName: options.customer.customerName,
      productionTaskId: null,
      sourceProductionTaskNo: sourceBatch.sourceProductionTaskNo,
      sourceKind: sourceBatch.sourceKind,
      replenishmentSourceType: sourceBatch.replenishmentSourceType,
      replenishmentSourceRequestNo: sourceBatch.replenishmentSourceRequestNo,
      quantity: options.selectedQuantity,
      unit: lineData.unit,
      warehouseId: sourceBatch.warehouseId,
      locationId: options.locationId || sourceBatch.locationId,
      status: 'AVAILABLE'
    },
    create: {
      batchNo: `IB-ALLOC-${options.orderNo}-${suffix}`,
      partCode: lineData.partCode,
      partName: lineData.partName,
      sourceOrderId: savedOrder.id,
      sourceOrderLineId: savedLine.id,
      sourceOrderNo: options.orderNo,
      sourceCustomerName: options.customer.customerName,
      productionTaskId: null,
      sourceProductionTaskNo: sourceBatch.sourceProductionTaskNo,
      sourceKind: sourceBatch.sourceKind,
      replenishmentSourceType: sourceBatch.replenishmentSourceType,
      replenishmentSourceRequestNo: sourceBatch.replenishmentSourceRequestNo,
      quantity: options.selectedQuantity,
      unit: lineData.unit,
      warehouseId: sourceBatch.warehouseId,
      locationId: options.locationId || sourceBatch.locationId,
      status: 'AVAILABLE'
    }
  });

  await prisma.inventoryTransaction.upsert({
    where: { transactionNo: `IT-STOCK-IN-${options.orderNo}-${suffix}` },
    update: {
      transactionType: 'IN',
      batchId: orderBatch.id,
      orderLineId: savedLine.id,
      partCode: lineData.partCode,
      partName: lineData.partName,
      orderNo: options.orderNo,
      productionTaskNo: sourceBatch.sourceProductionTaskNo,
      quantity: options.selectedQuantity,
      unit: lineData.unit,
      warehouseId: orderBatch.warehouseId,
      locationId: orderBatch.locationId,
      remark: '种子数据：备货库存转订单待发货库存',
      sourceRecordType: 'OrderLineStockAllocation',
      sourceRecordId: savedLine.id
    },
    create: {
      transactionNo: `IT-STOCK-IN-${options.orderNo}-${suffix}`,
      transactionType: 'IN',
      batchId: orderBatch.id,
      orderLineId: savedLine.id,
      partCode: lineData.partCode,
      partName: lineData.partName,
      orderNo: options.orderNo,
      productionTaskNo: sourceBatch.sourceProductionTaskNo,
      quantity: options.selectedQuantity,
      unit: lineData.unit,
      warehouseId: orderBatch.warehouseId,
      locationId: orderBatch.locationId,
      remark: '种子数据：备货库存转订单待发货库存',
      sourceRecordType: 'OrderLineStockAllocation',
      sourceRecordId: savedLine.id
    }
  });

  if (productionPlanQuantity <= 0) {
    return;
  }

  const productionTaskNo = `PT-${options.orderNo}-001`;
  const savedTask = await prisma.productionTask.upsert({
    where: { productionTaskNo },
    update: {
      orderId: savedOrder.id,
      orderLineId: savedLine.id,
      orderNo: options.orderNo,
      customerName: options.customer.customerName,
      partCode: lineData.partCode,
      partName: lineData.partName,
      plannedQuantity: productionPlanQuantity,
      completedQuantity: 0,
      unit: lineData.unit,
      status: ProductionStatus.PENDING,
      processSnapshot: seedProcessSnapshot(processSteps),
      startedAt: null,
      completedAt: null
    },
    create: {
      productionTaskNo,
      orderId: savedOrder.id,
      orderLineId: savedLine.id,
      orderNo: options.orderNo,
      customerName: options.customer.customerName,
      partCode: lineData.partCode,
      partName: lineData.partName,
      plannedQuantity: productionPlanQuantity,
      completedQuantity: 0,
      unit: lineData.unit,
      status: ProductionStatus.PENDING,
      processSnapshot: seedProcessSnapshot(processSteps),
      startedAt: null,
      completedAt: null
    }
  });

  await seedTaskProcessCompletions({
    productionTaskId: savedTask.id,
    taskStatus: ProductionStatus.PENDING,
    steps: processSteps,
    unit: lineData.unit,
    completedQuantity: productionPlanQuantity,
    partialCompletedStepCount: 0
  });
}

async function seedOrderShipment(orderNo: string, mode: 'FULL' | 'PARTIAL', remark: string) {
  const order = await prisma.customerOrder.findUniqueOrThrow({
    where: { orderNo },
    include: {
      inventoryBatches: {
        where: {
          sourceOrderId: { not: null },
          status: 'AVAILABLE'
        },
        include: { warehouse: true, location: true },
        orderBy: [{ batchNo: 'asc' }]
      }
    }
  });
  const batches = mode === 'PARTIAL' ? order.inventoryBatches.slice(0, 1) : order.inventoryBatches;

  for (const batch of batches) {
    const shippedQuantity = decimalToNumber(batch.quantity);
    if (shippedQuantity <= 0) {
      continue;
    }

    await prisma.inventoryBatch.update({
      where: { id: batch.id },
      data: {
        quantity: 0,
        status: 'USED'
      }
    });

    await prisma.inventoryTransaction.upsert({
      where: { transactionNo: `IT-OUT-${batch.batchNo}` },
      update: {
        transactionType: 'OUT',
        batchId: batch.id,
        orderLineId: batch.sourceOrderLineId,
        partCode: batch.partCode,
        partName: batch.partName,
        orderNo: batch.sourceOrderNo,
        productionTaskNo: batch.sourceProductionTaskNo,
        quantity: shippedQuantity,
        unit: batch.unit,
        warehouseId: batch.warehouseId,
        locationId: batch.locationId,
        remark,
        sourceRecordType: 'InventoryBatch',
        sourceRecordId: batch.id
      },
      create: {
        transactionNo: `IT-OUT-${batch.batchNo}`,
        transactionType: 'OUT',
        batchId: batch.id,
        orderLineId: batch.sourceOrderLineId,
        partCode: batch.partCode,
        partName: batch.partName,
        orderNo: batch.sourceOrderNo,
        productionTaskNo: batch.sourceProductionTaskNo,
        quantity: shippedQuantity,
        unit: batch.unit,
        warehouseId: batch.warehouseId,
        locationId: batch.locationId,
        remark,
        sourceRecordType: 'InventoryBatch',
        sourceRecordId: batch.id
      }
    });
  }

  await prisma.customerOrder.update({
    where: { id: order.id },
    data: { status: mode === 'FULL' ? OrderStatus.COMPLETED : OrderStatus.IN_PRODUCTION }
  });
}

async function seedInventoryAdjustment() {
  const attachment = seedInventoryAdjustmentAttachment();
  const batch = await prisma.inventoryBatch.findUniqueOrThrow({
    where: { batchNo: 'IB-STOCK-DEMO-P4101' },
    include: { warehouse: true, location: true }
  });
  const beforeQuantity = 50;
  const afterQuantity = 48;
  const deltaQuantity = afterQuantity - beforeQuantity;

  await prisma.inventoryBatch.update({
    where: { id: batch.id },
    data: {
      quantity: afterQuantity,
      status: 'AVAILABLE'
    }
  });

  const adjustment = await prisma.inventoryAdjustment.upsert({
    where: { adjustmentNo: 'IA-SEED-20260508-001' },
    update: {
      batchId: batch.id,
      partCode: batch.partCode,
      partName: batch.partName,
      beforeQuantity,
      afterQuantity,
      deltaQuantity,
      unit: batch.unit,
      countedBy: '种子盘点员',
      countedAt: new Date('2026-05-08T04:00:00.000Z'),
      signatureName: '种子盘点员',
      attachmentFileName: attachment.fileName,
      attachmentFileUrl: attachment.fileUrl,
      attachmentMimeType: attachment.mimeType,
      attachmentSize: attachment.size,
      remark: '种子数据：库存盘点从 50 调整为 48'
    },
    create: {
      adjustmentNo: 'IA-SEED-20260508-001',
      batchId: batch.id,
      partCode: batch.partCode,
      partName: batch.partName,
      beforeQuantity,
      afterQuantity,
      deltaQuantity,
      unit: batch.unit,
      countedBy: '种子盘点员',
      countedAt: new Date('2026-05-08T04:00:00.000Z'),
      signatureName: '种子盘点员',
      attachmentFileName: attachment.fileName,
      attachmentFileUrl: attachment.fileUrl,
      attachmentMimeType: attachment.mimeType,
      attachmentSize: attachment.size,
      remark: '种子数据：库存盘点从 50 调整为 48'
    }
  });

  await prisma.inventoryTransaction.upsert({
    where: { transactionNo: 'IT-ADJ-SEED-P4101-001' },
    update: {
      batchId: batch.id,
      transactionType: 'OUT',
      partCode: batch.partCode,
      partName: batch.partName,
      orderNo: batch.sourceOrderNo,
      productionTaskNo: batch.sourceProductionTaskNo,
      quantity: Math.abs(deltaQuantity),
      unit: batch.unit,
      warehouseId: batch.warehouseId,
      locationId: batch.locationId,
      remark: '种子数据：库存盘点从 50 调整为 48',
      sourceRecordType: 'InventoryAdjustment',
      sourceRecordId: adjustment.id
    },
    create: {
      transactionNo: 'IT-ADJ-SEED-P4101-001',
      transactionType: 'OUT',
      batchId: batch.id,
      partCode: batch.partCode,
      partName: batch.partName,
      orderNo: batch.sourceOrderNo,
      productionTaskNo: batch.sourceProductionTaskNo,
      quantity: Math.abs(deltaQuantity),
      unit: batch.unit,
      warehouseId: batch.warehouseId,
      locationId: batch.locationId,
      remark: '种子数据：库存盘点从 50 调整为 48',
      sourceRecordType: 'InventoryAdjustment',
      sourceRecordId: adjustment.id
    }
  });
}

async function main() {
  assertSeedResetAllowed();
  await resetSeedData();
  await seedDrawingFiles();
  await seedCustomers();
  await seedWarehouses();
  await seedProductionOperators();
  await seedProcessDefinitions();
  await seedProcessTemplates();
  await seedCommonProjectModels();
  await seedOrders();
  await seedReplenishmentAndNotices();
  await seedMaterials();
  await seedModelBoms();
  await seedMaterialTransformRules();
  await seedInventory();
  await seedInventoryAdjustment();
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
