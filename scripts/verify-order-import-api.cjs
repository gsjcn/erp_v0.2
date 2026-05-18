#!/usr/bin/env node

const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { pinyin } = require('pinyin-pro');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

for (const envPath of [resolve('.env'), resolve('backend/.env')]) {
  if (!existsSync(envPath)) {
    continue;
  }
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const apiBaseUrl = (process.env.ORDER_IMPORT_API_BASE_URL || process.env.FIRST_STAGE_API_BASE_URL || 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const runId = 'STABLE';
const orderPrefix = 'COD-IMPORT-STABLE';
const materialPrefix = 'MAT-STABLE';
const customerSearchPrefix = 'CUST-SEARCH-STABLE';
const longProcessRemark = `LONG-PROCESS-REMARK-${runId}-` + 'no-business-text-limit-'.repeat(120);
const createdOrderNos = [];
const importSessionIds = [];
const createdRegressionCustomerIds = [];
let sessionId = '';
const mojibakePattern =
  /[ÃÂ�]|锟|脙|脗|鈥|绗|\u95c3\u8235|\u95c3\u8236|寮€|涓€|瀵煎|璁㈠崟|鏂囦欢|缂栫爜|鍚嶇О|绮剧‘|鍖归厤|鍓嶇紑|鎷奸煶|鍥剧焊|瀹㈡埛|鍘嗗彶|搴撳瓨|鏉ユ簮|涔辩爜|淇|楠岃瘉|鏃犳硶|鏈壘|鎵惧埌|涓|尮閰|墿鏂|璇蜂粠|嬫媺|閫夋嫨|鏌ヨ|澶辫触|宸ヨ緭|闃绘柇/;

async function requestJson(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && body.message ? body.message : text;
    throw new Error(`${response.status} ${response.statusText}: ${Array.isArray(message) ? message.join('; ') : message}`);
  }
  return body;
}

async function expectRequestFailure(path, options, expectedMessage) {
  try {
    await requestJson(path, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expectedMessage), `expected request failure message to include ${expectedMessage}, actual=${message}`);
    return;
  }
  throw new Error(`expected request to fail with message: ${expectedMessage}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pageItems(result) {
  return Array.isArray(result) ? result : result?.items || [];
}

function assertNoMojibake(value, label) {
  const text = String(value || '');
  assert(!mojibakePattern.test(text), `${label} 不能出现乱码：${text}`);
}

function pinyinInitials(value) {
  return pinyin(String(value || ''), {
    toneType: 'none',
    type: 'array',
    pattern: 'first'
  })
    .join('')
    .toLowerCase();
}

async function createOrderImportRegressionCustomer(kind, customerName, overrides = {}) {
  const contactName = overrides.contactName || '订单导入验证';
  const contactPhone = overrides.contactPhone || '13800000000';
  const customerCode = overrides.customerCode || `${orderPrefix}-${kind}-CUST`;
  const reusableCustomer = await activateReusableRegressionCustomer(customerCode, customerName, contactName, contactPhone);
  if (reusableCustomer) {
    if (!createdRegressionCustomerIds.includes(reusableCustomer.id)) {
      createdRegressionCustomerIds.push(reusableCustomer.id);
    }
    return reusableCustomer;
  }
  await archiveExistingCustomerByCode(customerCode);
  const customer = await requestJson('/customers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerCode,
      customerName,
      contactName,
      contactPhone,
      regionType: 'CHINA',
      country: '中国',
      province: overrides.province || '江苏省',
      city: overrides.city || '常州市',
      detailAddress: overrides.detailAddress || '订单导入验证地址',
      contacts: [
        {
          contactName,
          contactPhone,
          isPrimary: true
        }
      ],
      remark: 'verify-order-import-api 自动创建，脚本结束后软停用。'
    })
  });
  assert(customer?.id && customer?.customerName, `无法创建订单导入回归客户：${kind}`);
  createdRegressionCustomerIds.push(customer.id);
  return customer;
}

async function createOrderImportRegressionCustomers() {
  const primaryCustomer = await createOrderImportRegressionCustomer('MAIN', `订单导入验证客户 ${runId}`);
  await createOrderImportRegressionCustomer('OTHER', `订单导入其他客户 ${runId}`);
  return primaryCustomer.customerName;
}

function archivedCustomerIdentity(value, customerId) {
  return `${String(value || 'TEST-CUSTOMER').slice(0, 120)}__DISABLED__${customerId.slice(0, 8)}`;
}

async function archiveDisabledCustomersByIds(prisma, customerIds) {
  const uniqueCustomerIds = [...new Set(customerIds.filter(Boolean))];
  if (uniqueCustomerIds.length === 0) {
    return;
  }
  const customers = await prisma.customer.findMany({
    where: { id: { in: uniqueCustomerIds } },
    select: { id: true, customerCode: true, customerName: true }
  });
  if (customers.length === 0) {
    return;
  }
  await prisma.customerContact.updateMany({
    where: { customerId: { in: customers.map((customer) => customer.id) } },
    data: { status: 'DISABLED', isPrimary: false }
  });
  for (const customer of customers) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        customerCode: archivedCustomerIdentity(customer.customerCode, customer.id),
        customerName: archivedCustomerIdentity(customer.customerName, customer.id),
        status: 'DISABLED',
        contactName: null,
        contactPhone: null
      }
    });
  }
}

function orderImportCaseSuffix(customerCode) {
  const text = String(customerCode || '');
  const timestampMatch = text.match(/^COD-IMPORT-\d{14}(.+)$/);
  if (timestampMatch) {
    return timestampMatch[1];
  }
  const stableMatch = text.match(/^COD-IMPORT-STABLE(.+)$/);
  return stableMatch ? stableMatch[1] : '';
}

async function findReusableCustomerByCode(prisma, customerCode) {
  const exactCustomer = await prisma.customer.findUnique({
    where: { customerCode }
  });
  if (exactCustomer) {
    return exactCustomer;
  }
  return prisma.customer.findFirst({
    where: { customerCode: { startsWith: `${customerCode}__DISABLED__` } },
    orderBy: { createdAt: 'asc' }
  });
}

async function createRegressionCustomerRecord(prisma, args) {
  const data = args?.data || {};
  const customerCode = data.customerCode;
  if (!customerCode) {
    return prisma.customer.create(args);
  }
  const reusableCustomer = await findReusableCustomerByCode(prisma, customerCode);
  if (!reusableCustomer) {
    return prisma.customer.create(args);
  }
  const { contacts, ...customerData } = data;
  await prisma.customerContact.updateMany({
    where: { customerId: reusableCustomer.id },
    data: { status: 'DISABLED', isPrimary: false }
  });
  const updatedCustomer = await prisma.customer.update({
    where: { id: reusableCustomer.id },
    data: { ...customerData, customerCode, status: customerData.status || 'ENABLED' }
  });
  const contactRows = Array.isArray(contacts?.create) ? contacts.create : [];
  if (contactRows.length > 0) {
    await prisma.customerContact.createMany({
      data: contactRows.map((contact) => ({
        ...contact,
        customerId: updatedCustomer.id
      }))
    });
  }
  return updatedCustomer;
}

async function activateReusableRegressionCustomer(customerCode, customerName, contactName, contactPhone) {
  const prisma = new PrismaClient();
  try {
    const reusableCustomer = await findReusableCustomerByCode(prisma, customerCode);
    if (!reusableCustomer) {
      return null;
    }
    await prisma.customerContact.updateMany({
      where: { customerId: reusableCustomer.id },
      data: { status: 'DISABLED', isPrimary: false }
    });
    await prisma.customerContact.create({
      data: {
        customerId: reusableCustomer.id,
        contactName,
        contactPhone,
        isPrimary: true
      }
    });
    return prisma.customer.update({
      where: { id: reusableCustomer.id },
      data: {
        customerCode,
        customerName,
        contactName,
        contactPhone,
        status: 'ENABLED'
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function softDisableCustomerByCode(prisma, customerCode) {
  const suffix = orderImportCaseSuffix(customerCode);
  const historicalSameCaseWhere = suffix
    ? {
        AND: [{ customerCode: { startsWith: 'COD-IMPORT-' } }, { customerCode: { endsWith: suffix } }]
      }
    : null;
  const customers = await prisma.customer.findMany({
    where: { OR: [{ customerCode }, { customerCode: { startsWith: `${customerCode}__DISABLED__` } }, ...(historicalSameCaseWhere ? [historicalSameCaseWhere] : [])] },
    select: { id: true }
  });
  await archiveDisabledCustomersByIds(
    prisma,
    customers.map((customer) => customer.id)
  );
}

async function archiveExistingCustomerByCode(customerCode) {
  const prisma = new PrismaClient();
  try {
    await softDisableCustomerByCode(prisma, customerCode);
  } finally {
    await prisma.$disconnect();
  }
}

async function softDisableRegressionWarehouse(prisma, warehouseCode, locationCode) {
  const warehouse = await prisma.warehouse.findUnique({
    where: { warehouseCode },
    select: { id: true }
  });
  if (!warehouse) {
    return;
  }
  await prisma.warehouseLocation.updateMany({
    where: {
      warehouseId: warehouse.id,
      ...(locationCode ? { locationCode } : {})
    },
    data: { status: 'DISABLED' }
  });
  await prisma.warehouse.update({
    where: { id: warehouse.id },
    data: { status: 'DISABLED' }
  });
}

async function upsertOrderImportWarehouseWithLocation(prisma, { warehouseCode, warehouseName, locationCode, locationName }) {
  const warehouse = await prisma.warehouse.upsert({
    where: { warehouseCode },
    update: {
      warehouseName,
      status: 'ENABLED'
    },
    create: {
      warehouseCode,
      warehouseName,
      status: 'ENABLED'
    }
  });
  const existingLocation = await prisma.warehouseLocation.findFirst({
    where: {
      warehouseId: warehouse.id,
      locationCode
    }
  });
  const location = existingLocation
    ? await prisma.warehouseLocation.update({
        where: { id: existingLocation.id },
        data: {
          locationName,
          status: 'ENABLED'
        }
      })
    : await prisma.warehouseLocation.create({
        data: {
          warehouseId: warehouse.id,
          locationCode,
          locationName,
          status: 'ENABLED'
        }
      });
  return { warehouse, location };
}

async function assertCustomerSearchRanking() {
  const exactName = `排序客户${runId}`;
  const prefixName = `${exactName}附加`;
  const exactCode = `${customerSearchPrefix}-Z`;
  const prefixCode = `${customerSearchPrefix}-A`;
  await createOrderImportRegressionCustomer('RANK-PREFIX', prefixName, {
    customerCode: prefixCode,
    contactName: '排序回归联系人',
    city: '常州市',
    detailAddress: '客户搜索排序回归地址'
  });
  await createOrderImportRegressionCustomer('RANK-EXACT', exactName, {
    customerCode: exactCode,
    contactName: '排序回归联系人',
    city: '无锡市',
    detailAddress: '客户搜索排序回归地址'
  });

  const exactNameResults = pageItems(await requestJson(`/customers?status=ENABLED&keyword=${encodeURIComponent(exactName)}&includeTestFixtures=true`));
  assert(
    exactNameResults[0]?.customerCode === exactCode,
    `Customer search must rank exact customerName first; actual=${exactNameResults[0]?.customerCode}`
  );

  const exactCodeResults = pageItems(await requestJson(`/customers?status=ENABLED&keyword=${encodeURIComponent(prefixCode)}&includeTestFixtures=true`));
  assert(
    exactCodeResults[0]?.customerCode === prefixCode,
    `Customer search must rank exact customerCode first; actual=${exactCodeResults[0]?.customerCode}`
  );
}

async function orderImportUploadDir() {
  const health = await requestJson('/health');
  const uploadRoot = resolveHostUploadRoot(health?.storage?.uploads?.path);
  assert(uploadRoot, '健康检查必须返回上传目录，用于验证导入临时文件清理');
  return join(uploadRoot, 'order-imports');
}

function resolveHostUploadRoot(uploadRoot) {
  if (!uploadRoot) {
    return '';
  }
  if (existsSync(uploadRoot)) {
    return uploadRoot;
  }
  const normalized = String(uploadRoot).replace(/\\/g, '/');
  if (normalized === '/app/storage/uploads') {
    return resolve(process.env.UPLOAD_DIR || 'storage/uploads');
  }
  return uploadRoot;
}

function storedImportFilesMatching(uploadDir, nameToken) {
  if (!existsSync(uploadDir)) {
    return [];
  }
  return readdirSync(uploadDir).filter((fileName) => fileName.includes(nameToken));
}

function assertNoStoredImportFilesMatching(uploadDir, nameToken, label) {
  const matches = storedImportFilesMatching(uploadDir, nameToken);
  assert(matches.length === 0, `${label} 不应残留服务器端 Excel 文件：${matches.join('、')}`);
}

function addRow(sheet, rowNo, values) {
  values.forEach((value, index) => {
    sheet.getCell(rowNo, index + 1).value = value;
  });
}

const orderImportHeaders = [
  '订单块(自动)',
  '订单编号',
  '制单日期',
  '客户名称',
  '项目型号',
  '行类型',
  '自动序号',
  '零件类型',
  '组件编号(自动)',
  '所属组件编号(自动/可改)',
  '物料号',
  '图号',
  '产品名称',
  '展开尺寸',
  '厚度',
  '订单数',
  '单套用量',
  '需求数量(自动)',
  '单位',
  '工艺路线',
  '工艺备注',
  '图纸日期',
  '图纸状态'
];

async function buildWorkbookBufferFromRows(rows, headers = orderImportHeaders) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ERP上传净表');
  addRow(sheet, 1, headers);
  rows.forEach((row, index) => addRow(sheet, index + 2, row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildDrawingVersionWorkbookBuffer(customerName) {
  const headers = [...orderImportHeaders, '版本'];
  const rows = [
    [
      1,
      `${orderPrefix}-DRAWING-VERSION`,
      '2026/6/24',
      customerName,
      '图纸版本导入验证',
      '零件',
      1,
      '通用件',
      '',
      '',
      `${materialPrefix}-DRAWING-VERSION`,
      `VERIFY-${runId}-DRAWING-VERSION`,
      '图纸版本快照零件',
      '',
      '1mm',
      2,
      '',
      2,
      '件',
      '',
      '版本列必须进入订单行快照',
      '2026/5/30',
      '新图',
      'B'
    ]
  ];
  return buildWorkbookBufferFromRows(rows, headers);
}

async function buildWorkbookBuffer(customerName) {
  const today = '2026/6/18';
  const headers = [...orderImportHeaders, '版本'];
  const rows = [
    [1, `${orderPrefix}-001`, today, customerName, '导入验证A', '零件', 1, '通用件', '', '', `${materialPrefix}-001`, `VERIFY-${runId}-10-01`, '验证顶盖', '', '1mm', 8, '', 8, '件', '', longProcessRemark, '2026/5/30', '旧图'],
    [1, `${orderPrefix}-001`, today, customerName, '导入验证A', '组件', 2, '定制件', 'C001', '', `${materialPrefix}-002`, `VERIFY-${runId}-20-00`, '验证支架组件', '', '2mm', 20, 2, 40, '套', '装配', 'API 回归组件行', '', '旧图'],
    [1, `${orderPrefix}-001`, today, customerName, '导入验证A', '零件', '2.1', '定制件', '', 'C001', `${materialPrefix}-003`, `VERIFY-${runId}-20-A`, '验证支架子件A', '', '2mm', '', 2, 80, '件', '', '按父组件需求数量×2', '', '旧图'],
    [2, `${orderPrefix}-002`, today, customerName, '导入验证B', '零件', 1, '外协件', '', '', `${materialPrefix}-004`, `VERIFY-${runId}-30-01`, '验证外协网罩', '', '1mm', 16, '', 16, '件', '', 'API 回归外协件', '', '新图'],
    [2, `${orderPrefix}-002`, today, customerName, '导入验证B', '组件', 2, '定制件', 'C001', '', `${materialPrefix}-005`, `VERIFY-${runId}-40-00`, '验证底盘组件', '', '2mm', 10, 1, 10, '套', '装配', '第二个订单组件编号从 C001 开始', '', '旧图'],
    [2, `${orderPrefix}-002`, today, customerName, '导入验证B', '零件', '2.1', '定制件', '', 'C001', `${materialPrefix}-006`, `VERIFY-${runId}-40-A`, '验证底盘子件', '', '1.5mm', '', 3, 30, '件', '', '按父组件需求数量×3', '', '旧图'],
    [3, `${orderPrefix}-003`, today, customerName, '导入验证C', '组件', 1, '数控件', 'ASM-X1', '', `${materialPrefix}-007`, `VERIFY-${runId}-50-00`, '验证自定义编号组件', '', '1.2mm', 6, 1, 6, '套', '激光折弯', '自定义组件编号不能被 C001-C9999 写死', '', '旧图'],
    [3, `${orderPrefix}-003`, today, customerName, '导入验证C', '零件', '1.1', '数控件', '', 'ASM-X1', `${materialPrefix}-008`, `VERIFY-${runId}-50-01`, '验证自定义编号子件', '', '1.2mm', '', 2, 12, '件', '激光折弯', '按自定义父组件编号关联', '', '旧图'],
    [4, `${orderPrefix}-BAD`, '', customerName, '导入验证错误订单', '零件', 1, '通用件', 'C999', '', `${materialPrefix}-BAD`, `VERIFY-${runId}-BAD`, '错误零件填了组件编号', '', '', 1, '', 1, '件', '', '用于验证预览阶段拦截组件结构错误和缺厚度待核对', '2026/5/30', '旧图', 'B']
  ];
  return buildWorkbookBufferFromRows(rows, headers);
}

async function buildSplitWorkbookBuffer(customerName, rows) {
  return buildWorkbookBufferFromRows(rows.map((row) => [5, `${orderPrefix}-SPLIT`, '2026/6/19', customerName, '连续上传验证', ...row]));
}

async function buildSelectedCommitWorkbookBuffer(customerName) {
  const rows = [
    [1, `${orderPrefix}-PAGE-001`, '2026/6/20', customerName, '分页选择验证', '零件', 1, '通用件', '', '', `${materialPrefix}-PAGE-001`, `VERIFY-${runId}-PAGE-01`, '分页选择零件1', '', '1mm', 1, '', 1, '件', '', '分页验证第1单', '', '旧图'],
    [2, `${orderPrefix}-PAGE-002`, '2026/6/20', customerName, '分页选择验证', '零件', 1, '通用件', '', '', `${materialPrefix}-PAGE-002`, `VERIFY-${runId}-PAGE-02`, '分页选择零件2', '', '1mm', 2, '', 2, '件', '', '分页验证第2单', '', '旧图'],
    [3, `${orderPrefix}-PAGE-003`, '2026/6/20', customerName, '分页选择验证', '零件', 1, '通用件', '', '', `${materialPrefix}-PAGE-003`, `VERIFY-${runId}-PAGE-03`, '分页选择零件3', '', '1mm', 3, '', 3, '件', '', '分页验证第3单', '', '旧图']
  ];
  return buildWorkbookBufferFromRows(rows);
}

async function buildExcludedCommitWorkbookBuffer(customerName) {
  const rows = [
    [1, `${orderPrefix}-EXCLUDE-001`, '2026/6/21', customerName, '排除提交验证', '零件', 1, '通用件', '', '', `${materialPrefix}-EXCLUDE-001`, `VERIFY-${runId}-EXCLUDE-01`, '排除提交零件1', '', '1mm', 1, '', 1, '件', '', '排除提交第1单', '', '旧图'],
    [2, `${orderPrefix}-EXCLUDE-002`, '2026/6/21', customerName, '排除提交验证', '零件', 1, '通用件', '', '', `${materialPrefix}-EXCLUDE-002`, `VERIFY-${runId}-EXCLUDE-02`, '排除提交零件2', '', '1mm', 2, '', 2, '件', '未维护工序', '用于验证可选订单警告统计', '', '旧图'],
    [3, `${orderPrefix}-EXCLUDE-003`, '2026/6/21', customerName, '排除提交验证', '零件', 1, '通用件', '', '', `${materialPrefix}-EXCLUDE-003`, `VERIFY-${runId}-EXCLUDE-03`, '排除提交零件3', '', '1mm', 3, '', 3, '件', '', '排除提交第3单', '', '旧图']
  ];
  return buildWorkbookBufferFromRows(rows);
}

async function buildWorkbookWithoutUploadSheetBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('清单台账');
  addRow(sheet, 1, orderImportHeaders);
  addRow(sheet, 2, [
    1,
    `${orderPrefix}-NO-UPLOAD-SHEET`,
    '2026/6/20',
    '错误客户',
    '缺少上传净表验证',
    '零件',
    1,
    '通用件',
    '',
    '',
    `${materialPrefix}-NO-UPLOAD-SHEET`,
    `VERIFY-${runId}-NO-UPLOAD-SHEET`,
    '缺少上传净表',
    '',
    '1mm',
    1,
    '',
    1,
    '件',
    '',
    '',
    '',
    '旧图'
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildWorkbookWithBlankRowInMiddleBuffer(customerName) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ERP上传净表');
  addRow(sheet, 1, orderImportHeaders);
  addRow(sheet, 2, [
    1,
    `${orderPrefix}-BLANK-ROW`,
    '2026/6/20',
    customerName,
    '中间空行验证',
    '零件',
    1,
    '通用件',
    '',
    '',
    `${materialPrefix}-BLANK-001`,
    `VERIFY-${runId}-BLANK-01`,
    '中间空行前零件',
    '',
    '1mm',
    1,
    '',
    1,
    '件',
    '',
    '',
    '',
    '旧图'
  ]);
  addRow(sheet, 4, [
    1,
    `${orderPrefix}-BLANK-ROW`,
    '2026/6/20',
    customerName,
    '中间空行验证',
    '零件',
    2,
    '通用件',
    '',
    '',
    `${materialPrefix}-BLANK-002`,
    `VERIFY-${runId}-BLANK-02`,
    '中间空行后零件',
    '',
    '1mm',
    1,
    '',
    1,
    '件',
    '',
    '',
    '',
    '旧图'
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildWorkbookWithOrderHeadRowBuffer(customerName) {
  return buildWorkbookBufferFromRows([
    [
      1,
      `${orderPrefix}-ORDER-HEAD`,
      '2026/6/20',
      customerName,
      '订单头行验证',
      '订单头',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ],
    [
      1,
      `${orderPrefix}-ORDER-HEAD`,
      '2026/6/20',
      customerName,
      '订单头行验证',
      '零件',
      1,
      '通用件',
      '',
      '',
      `${materialPrefix}-ORDER-HEAD`,
      `VERIFY-${runId}-ORDER-HEAD`,
      '订单头后零件',
      '',
      '1mm',
      1,
      '',
      1,
      '件',
      '',
      '',
      '',
      '旧图'
    ]
  ]);
}

async function buildWorkbookWithMissingRequiredHeaderBuffer(customerName) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ERP上传净表');
  const headers = orderImportHeaders.filter((header) => header !== '需求数量(自动)');
  addRow(sheet, 1, headers);
  addRow(sheet, 2, [
    1,
    `${orderPrefix}-MISSING-HEADER`,
    '2026/6/20',
    customerName,
    '缺少表头验证',
    '零件',
    1,
    '通用件',
    '',
    '',
    `${materialPrefix}-MISSING-HEADER`,
    `VERIFY-${runId}-MISSING-HEADER`,
    '缺少需求数量表头零件',
    '',
    '1mm',
    1,
    '',
    '件',
    '',
    '',
    '',
    '旧图'
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildWorkbookWithEmptyUploadSheetBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ERP上传净表');
  addRow(sheet, 1, orderImportHeaders);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function uploadWorkbook(sessionId, buffer, fileName = `order-import-api-${runId}.xlsx`) {
  const form = new FormData();
  form.set(
    'file',
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName
  );
  const response = await fetch(`${apiBaseUrl}/orders/import-sessions/${sessionId}/files`, {
    method: 'POST',
    body: form
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function uploadWorkbookExpectFailure(sessionId, buffer, expectedMessage, fileName = `order-import-api-fail-${runId}.xlsx`) {
  let rejected = false;
  try {
    await uploadWorkbook(sessionId, buffer, fileName);
  } catch (error) {
    rejected = true;
    assert(
      String(error.message || '').includes(expectedMessage),
      `上传失败原因应包含“${expectedMessage}”，实际：${error.message}`
    );
  }
  assert(rejected, `上传 ${fileName} 应失败`);
}

async function commitImportSessionExpectFailure(sessionIdForCommit, payload, expectedMessage) {
  let rejected = false;
  try {
    await requestJson(`/orders/import-sessions/${sessionIdForCommit}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    rejected = true;
    assert(
      String(error.message || '').includes(expectedMessage),
      `导入提交失败原因应包含“${expectedMessage}”，实际：${error.message}`
    );
  }
  assert(rejected, '导入提交应被拒绝');
}

async function verifyBundledWorkbookUploadPreviews() {
  const workbookDir = resolve('outputs/component-order-template');
  if (!existsSync(workbookDir)) {
    throw new Error(`缺少 Excel 模板目录：${workbookDir}`);
  }
  const workbookFiles = readdirSync(workbookDir)
    .filter((fileName) => fileName.endsWith('.xlsx'))
    .sort();
  assert(workbookFiles.includes('组件零件清单ERP上传模板.xlsx'), '缺少网页下载同源的空白 ERP 上传模板');
  assert(workbookFiles.some((fileName) => fileName.includes('最终版')), '缺少最终版组件零件清单台账模板');
  assert(workbookFiles.includes('erpordertest.xlsx'), '缺少 erpordertest.xlsx 汇总上传测试文件');

  for (const fileName of workbookFiles) {
    if (fileName === '组件零件清单ERP上传模板.xlsx') {
      continue;
    }
    const previewSession = await requestJson('/orders/import-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ createdBy: `verify-workbook-preview-${runId}` })
    });
    try {
      const buffer = readFileSync(join(workbookDir, fileName));
      const upload = await uploadWorkbook(previewSession.id, buffer, fileName);
      assert(upload.summary.fileCount === 1, `${fileName} 上传预览应只包含 1 个文件`);
      assert(upload.summary.rowCount > 0, `${fileName} 上传预览必须读取到 ERP上传净表 明细`);
      assert(upload.files?.[0]?.fileName === fileName, `${fileName} 上传预览必须保留中文文件名，实际 ${upload.files?.[0]?.fileName}`);
      assert(upload.files?.[0]?.sheetName === 'ERP上传净表', `${fileName} 必须由 ERP上传净表 生成预览`);
      assert(upload.summary.orderCount > 0, `${fileName} 上传预览必须识别到订单`);
      assert(
        upload.orders?.[0]?.rows?.[0]?.sourceFileName === fileName,
        `${fileName} 预览明细来源文件名必须保留中文，实际 ${upload.orders?.[0]?.rows?.[0]?.sourceFileName}`
      );
    } finally {
      try {
        await requestJson(`/orders/import-sessions/${previewSession.id}`, { method: 'DELETE' });
      } catch {
        // 预览会话清理尽力执行；失败不掩盖真正的解析错误。
      }
    }
  }
}

async function downloadTemplate() {
  const response = await fetch(`${apiBaseUrl}/orders/import-template`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${buffer.toString('utf8')}`);
  }
  return {
    contentType: response.headers.get('content-type') || '',
    buffer
  };
}

async function downloadIssueReport(sessionId) {
  const response = await fetch(`${apiBaseUrl}/orders/import-sessions/${sessionId}/error-report`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${buffer.toString('utf8')}`);
  }
  return {
    contentType: response.headers.get('content-type') || '',
    buffer
  };
}

async function loadWorkbookFromBuffer(buffer, label) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (error) {
    throw new Error(`${label} 不是 ExcelJS 可读取的 xlsx：${error.message}`);
  }
  return workbook;
}

async function assertTemplateWorkbook(template) {
  assert(
    template.contentType.includes('spreadsheetml.sheet'),
    `模板应返回 xlsx content-type，实际 ${template.contentType}`
  );
  assert(template.buffer.slice(0, 2).toString('utf8') === 'PK', '模板必须是 xlsx zip 文件');
  const bundledTemplatePath = join(resolve('outputs/component-order-template'), '组件零件清单ERP上传模板.xlsx');
  assert(existsSync(bundledTemplatePath), '必须保留 outputs/component-order-template/组件零件清单ERP上传模板.xlsx 作为网页下载模板来源');
  assert(
    template.buffer.equals(readFileSync(bundledTemplatePath)),
    '网页下载的 ERP 上传模板必须和 outputs/component-order-template/组件零件清单ERP上传模板.xlsx 完全一致'
  );
  const workbook = await loadWorkbookFromBuffer(template.buffer, '订单导入模板');
  for (const sheetName of ['ERP上传净表', '字段说明', '示例数据', '选项']) {
    assert(workbook.getWorksheet(sheetName), `订单导入模板必须包含 ${sheetName} 工作表`);
  }
  const uploadSheet = workbook.getWorksheet('ERP上传净表');
  assert(uploadSheet.getCell('A4').text === '订单块(自动)', 'ERP上传净表第 4 行必须是正式上传表头');
  assert(uploadSheet.getCell('P4').text === '订单数', 'ERP上传净表必须使用订单数字段');
  assert(uploadSheet.getCell('R4').text === '需求数量(自动)', 'ERP上传净表必须保留自动需求数量字段');
  assert(uploadSheet.getCell('X4').text === '版本', 'ERP上传净表必须保留图纸版本字段');
  const optionsSheet = workbook.getWorksheet('选项');
  assert(optionsSheet.getCell('E2').text === 'C001', '订单导入模板组件编号选项必须从 C001 开始');
  assert(optionsSheet.getCell('E10000').text === 'C9999', '订单导入模板组件编号选项必须支持到 C9999');
  assert(uploadSheet.getCell('I5').dataValidation?.errorStyle === 'warning', '组件编号下拉只能警告，不能阻止自定义组件编号');
  assert(uploadSheet.getCell('J5').dataValidation?.errorStyle === 'warning', '所属组件编号下拉只能警告，不能阻止自定义组件编号');
  assert(!workbook.getWorksheet('清单台账'), 'ERP 下载模板不应混入台账工作表，避免误上传');
}

async function assertIssueReportWorkbook(issueReport, options = {}) {
  assert(
    issueReport.contentType.includes('spreadsheetml.sheet'),
    `问题明细应返回 xlsx content-type，实际 ${issueReport.contentType}`
  );
  assert(issueReport.buffer.slice(0, 2).toString('utf8') === 'PK', '问题明细必须是可打开的 xlsx 文件');
  const workbook = await loadWorkbookFromBuffer(issueReport.buffer, '订单导入问题明细');
  for (const sheetName of ['导入概览', '上传文件', '问题明细']) {
    assert(workbook.getWorksheet(sheetName), `问题明细文件必须包含 ${sheetName} 工作表`);
  }
  const issueSheet = workbook.getWorksheet('问题明细');
  const headerColumns = new Map();
  issueSheet.getRow(1).eachCell((cell, columnNo) => {
    headerColumns.set(String(cell.text || '').trim(), columnNo);
  });
  assert(headerColumns.has('版本'), '问题明细必须包含版本字段，便于按图号和版本核对导入错误');
  assert(headerColumns.has('图纸日期'), '问题明细必须包含图纸日期字段，便于按图号、版本和日期核对导入错误');
  assert(headerColumns.has('图纸状态'), '问题明细必须包含图纸状态字段，便于按图号、版本、日期和状态核对导入错误');
  const cellText = (row, headerName, fallbackColumnNo) => row.getCell(headerColumns.get(headerName) || fallbackColumnNo).text;
  const rows = [];
  issueSheet.eachRow((row, rowNo) => {
    if (rowNo <= 1) {
      return;
    }
    rows.push({
      orderNo: cellText(row, '订单编号', 1),
      sourceRowNo: cellText(row, '来源行', 4),
      lineType: cellText(row, '行类型', 6),
      drawingVersion: cellText(row, '版本', 11),
      drawingDate: cellText(row, '图纸日期', 12),
      drawingStatus: cellText(row, '图纸状态', 18),
      issueCode: cellText(row, '问题代码', 15),
      issueMessage: cellText(row, '问题说明', 16)
    });
  });
  for (const code of options.requiredCodes || []) {
    assert(rows.some((row) => row.issueCode === code), `问题明细必须包含错误代码 ${code}`);
  }
  for (const item of options.requiredDrawingVersions || []) {
    assert(
      rows.some((row) => row.issueCode === item.code && row.drawingVersion === item.version),
      `问题明细必须在错误代码 ${item.code} 行保留图纸版本 ${item.version}`
    );
  }
  for (const item of options.requiredDrawingDates || []) {
    assert(
      rows.some((row) => row.issueCode === item.code && row.drawingDate === item.date),
      `问题明细必须在错误代码 ${item.code} 行保留图纸日期 ${item.date}`
    );
  }
  for (const item of options.requiredDrawingStatuses || []) {
    assert(
      rows.some((row) => row.issueCode === item.code && row.drawingStatus === item.status),
      `问题明细必须在错误代码 ${item.code} 行保留图纸状态 ${item.status}`
    );
  }
  for (const pair of options.forbiddenOrderCodePairs || []) {
    assert(
      !rows.some((row) => row.orderNo === pair.orderNo && row.issueCode === pair.code),
      `订单 ${pair.orderNo} 不应残留错误代码 ${pair.code}`
    );
  }
  return rows;
}

function toOrderUpdateLine(line, overrides = {}) {
  const processStepDetails =
    line.processStepDetails && line.processStepDetails.length > 0
      ? line.processStepDetails
      : (line.processSteps || []).map((processName) => ({ processName, processRemark: '' }));
  return {
    lineType: line.lineType || 'PART',
    partCategory: line.partCategory || '',
    componentNo: line.componentNo || '',
    parentComponentNo: line.parentComponentNo || '',
    importSequence: line.importSequence || '',
    sourceImportSessionId: line.sourceImportSessionId || '',
    sourceImportFileId: line.sourceImportFileId || '',
    sourceImportFileName: line.sourceImportFileName || '',
    sourceImportRowNo: line.sourceImportRowNo || undefined,
    projectModel: line.projectModel || '',
    drawingDate: line.drawingDate || undefined,
    drawingStatus: line.drawingStatus || '',
    partCode: line.partCode,
    partName: line.partName,
    drawingNo: line.drawingNo || '',
    drawingVersion: line.drawingVersion || '',
    drawingFileName: line.drawingFileName || '',
    drawingFileUrl: line.drawingFileUrl || '',
    partThickness: Number(line.partThickness || 0),
    partSpecification: line.partSpecification || '',
    quantity: Number(line.quantity || 0),
    productionPlanQuantity: Number(line.productionPlanQuantity ?? line.quantity ?? 0),
    fulfillmentMode: line.fulfillmentMode || 'PRODUCTION',
    unit: line.unit || '件',
    deliveryDate: line.deliveryDate || undefined,
    remark: line.remark || '',
    processSteps: processStepDetails.map((step) => ({
      processName: step.processName,
      processRemark: step.processRemark || ''
    })),
    selectedStockSources: line.selectedStockSources || [],
    ...overrides
  };
}

function assertNoBlankOptionalOrderLineText(order, label) {
  const optionalFields = ['drawingNo', 'drawingVersion', 'drawingFileName', 'drawingFileUrl', 'partSpecification', 'remark'];
  for (const line of order.lines || []) {
    for (const field of optionalFields) {
      const value = line[field];
      assert(
        value === null || value === undefined || String(value).trim() !== '',
        `${label} ${line.partCode} ${field} 不能保存为空字符串，空值必须归一化为 null`
      );
    }
  }
}

async function assertImportSourcePreview(order) {
  const sourceLine = order.lines.find((line) => line.sourceImportFileId && line.sourceImportFileName);
  assert(sourceLine, '订单明细必须返回来源 Excel 文件 ID 和文件名，便于订单页预览来源文件');
  assertNoMojibake(sourceLine.sourceImportFileName, '来源 Excel 文件名');
  const previewPage = await requestJson(
    `/orders/${encodeURIComponent(order.orderNo)}/import-source-files/${encodeURIComponent(sourceLine.sourceImportFileId)}/preview?limit=2&offset=0`
  );
  assert(previewPage.rowPage.totalCount === order.lines.length, '来源 Excel 预览必须返回当前订单总行数');
  assert(previewPage.rows.length === Math.min(order.lines.length, 2), '来源 Excel 预览必须按 limit 分页返回');
  assert(previewPage.rowPage.hasMore === order.lines.length > previewPage.rows.length, '来源 Excel 预览必须返回 hasMore');
  const preview = await requestJson(
    `/orders/${encodeURIComponent(order.orderNo)}/import-source-files/${encodeURIComponent(sourceLine.sourceImportFileId)}/preview?limit=500&offset=0`
  );
  assert(preview.file.fileName === sourceLine.sourceImportFileName, '来源 Excel 预览必须保留中文文件名并与订单明细一致');
  assert(preview.file.fileUrl, '来源 Excel 预览必须返回可打开的原文件地址');
  assert(preview.file.sheetName === 'ERP上传净表', `来源 Excel 预览必须显示 ERP上传净表 工作表，实际 ${preview.file.sheetName}`);
  assert(preview.rows.length === order.lines.length, `来源 Excel 预览行数应等于当前订单行数，实际 ${preview.rows.length}`);
  for (const row of preview.rows) {
    assertNoMojibake(row.customerName, '来源 Excel 预览客户名称');
    assertNoMojibake(row.partName, '来源 Excel 预览产品名称');
    assertNoMojibake(row.processRemark, '来源 Excel 预览工艺备注');
    assertNoMojibake(row.drawingStatus, '来源 Excel 预览图纸状态');
  }
  const versionLine = order.lines.find((line) => line.drawingVersion);
  if (versionLine) {
    const sourceVersionRow = preview.rows.find((row) => row.sourceRowNo === versionLine.sourceImportRowNo);
    assert(
      sourceVersionRow?.drawingVersion === versionLine.drawingVersion,
      `来源 Excel 预览必须保留图纸版本 ${versionLine.drawingVersion}，实际 ${sourceVersionRow?.drawingVersion}`
    );
  }
  assert(
    preview.rows.some((row) => row.sourceRowNo === sourceLine.sourceImportRowNo && row.partCode === sourceLine.partCode),
    '来源 Excel 预览必须能定位到当前订单零件原始 Excel 行'
  );
}

async function assertImportSessionFilePreview(sessionIdForPreview, fileId, expectedFileName) {
  const firstPage = await requestJson(
    `/orders/import-sessions/${sessionIdForPreview}/files/${fileId}/preview?limit=3&offset=0`
  );
  assert(firstPage.file.fileName === expectedFileName, `上传文件预览必须保留中文文件名，实际 ${firstPage.file.fileName}`);
  assert(firstPage.file.fileUrl, '上传文件预览必须返回可打开的原文件地址');
  assert(firstPage.rows.length === 3, `上传文件预览第一页应按 limit 返回 3 行，实际 ${firstPage.rows.length}`);
  assert(firstPage.rowPage.hasMore === true, '上传文件预览必须支持分页加载更多行');
  assert(
    firstPage.rows.every((row) => row.sourceImportFileId === fileId && row.sourceFileName === expectedFileName),
    '上传文件预览每行必须带来源文件 ID 和中文来源文件名'
  );
  for (const row of firstPage.rows) {
    assertNoMojibake(row.sourceFileName, '上传文件预览来源文件名');
    assertNoMojibake(row.customerName, '上传文件预览客户名称');
    assertNoMojibake(row.partName, '上传文件预览产品名称');
    assertNoMojibake(row.processRemark, '上传文件预览工艺备注');
  }
  assert(firstPage.rows.some((row) => row.orderNo && row.partName), '上传文件预览必须返回订单编号和中文产品名称');

  const secondPage = await requestJson(
    `/orders/import-sessions/${sessionIdForPreview}/files/${fileId}/preview?limit=3&offset=3`
  );
  assert(secondPage.rows.length === 3, `上传文件预览第二页应继续返回 3 行，实际 ${secondPage.rows.length}`);
  assert(
    !new Set(firstPage.rows.map((row) => row.id)).has(secondPage.rows[0].id),
    '上传文件预览分页不应重复第一页第一行'
  );
}

async function cleanup() {
  for (const orderNo of createdOrderNos) {
    try {
      await requestJson(`/orders/${encodeURIComponent(orderNo)}`, { method: 'DELETE' });
    } catch {
      // 回归验证清理尽力执行；最终错误仍由主流程抛出。
    }
  }
  if (sessionId && !importSessionIds.includes(sessionId)) {
    importSessionIds.push(sessionId);
  }
  for (const id of importSessionIds) {
    try {
      await requestJson(`/orders/import-sessions/${id}`, { method: 'DELETE' });
    } catch {
      // 已提交导入记录可以删除记忆；失败时不掩盖主错误。
    }
  }
  for (const customerId of createdRegressionCustomerIds) {
    try {
      await requestJson(`/customers/${customerId}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'DISABLED' })
      });
    } catch {
      // 验证客户只软停用，不物理删除；失败时由 cleanup:test-data 兜底。
    }
  }
  const prisma = new PrismaClient();
  try {
    await archiveDisabledCustomersByIds(prisma, createdRegressionCustomerIds);
    await prisma.material.updateMany({
      where: {
        partCode: { startsWith: materialPrefix }
      },
      data: {
        status: 'DISABLED'
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function activateOrderImportMaterialFixtures() {
  const prisma = new PrismaClient();
  try {
    await prisma.material.updateMany({
      where: {
        partCode: { startsWith: materialPrefix }
      },
      data: {
        status: 'ENABLED'
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function assertDraftStockReservationReleasedOnCancel() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-RESERVATION-CANCEL`;
  const customerCode = `${orderPrefix}-RES-CUST`;
  const warehouseCode = `${orderPrefix}-RES-WH`;
  const locationCode = `${orderPrefix}-RES-LOC`;
  const partCode = `${materialPrefix}-RES-CANCEL`;

  async function cleanupReservationCase() {
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupReservationCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '订单取消库存预占释放回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '订单取消库存预占释放回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '订单取消库存预占释放回归仓库',
      locationCode,
      locationName: '订单取消库存预占释放回归库位'
    });
    const batch = await prisma.inventoryBatch.create({
      data: {
        batchNo: `${orderPrefix}-RES-BATCH`,
        partCode,
        partName: '订单取消库存预占释放回归零件',
        quantity: 8,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });
    const order = await prisma.customerOrder.create({
      data: {
        orderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-06-15T00:00:00.000Z'),
        status: 'DRAFT',
        lines: {
          create: [
            {
              lineNo: 1,
              partCode,
              partName: '订单取消库存预占释放回归零件',
              partThickness: 1,
              quantity: 4,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: '件',
              stockSourceSelections: [{ batchId: batch.id, quantity: 4 }]
            }
          ]
        }
      },
      include: { lines: true }
    });
    await prisma.orderNoReservation.create({
      data: {
        orderNo,
        orderNoNormalized: orderNo.toUpperCase(),
        sourceOrderId: order.id,
        reservedReason: 'ORDER_CREATED'
      }
    });
    const line = order.lines[0];
    const reservation = await prisma.inventoryReservation.create({
      data: {
        batchId: batch.id,
        orderId: order.id,
        orderLineId: line.id,
        orderNo,
        partCode,
        partName: line.partName,
        quantity: 4,
        unit: line.unit,
        status: 'ACTIVE',
        statusReason: 'DRAFT_ORDER_RESERVED'
      }
    });

    const cancelledOrder = await requestJson(`/orders/${encodeURIComponent(orderNo)}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: '验证草稿订单取消必须释放库存预占',
        managerName: 'Order Reservation API Tester',
        productionCancelState: 'NOT_PRODUCED'
      })
    });
    assert(cancelledOrder.status === 'CANCELLED', `cancelled order status should be CANCELLED, actual=${cancelledOrder.status}`);

    const releasedReservation = await prisma.inventoryReservation.findUnique({ where: { id: reservation.id } });
    assert(releasedReservation?.status === 'RELEASED', `draft stock reservation must become RELEASED after order cancel, actual=${releasedReservation?.status}`);
    assert(releasedReservation?.statusReason === 'ORDER_CANCELLED', `released reservation reason should be ORDER_CANCELLED, actual=${releasedReservation?.statusReason}`);
    assert(releasedReservation?.releasedAt, 'released reservation must keep releasedAt for audit');
    assert(!releasedReservation?.consumedAt, 'cancelled draft reservation must not be marked consumed');

    const lineAfterCancel = await prisma.orderLine.findUnique({ where: { id: line.id } });
    assert(Number(lineAfterCancel?.quantity) === 0, `cancelled draft order line quantity should become 0, actual=${lineAfterCancel?.quantity}`);
    const batchAfterCancel = await prisma.inventoryBatch.findUnique({ where: { id: batch.id } });
    assert(batchAfterCancel?.status === 'AVAILABLE', `stock batch should remain AVAILABLE after draft cancel, actual=${batchAfterCancel?.status}`);
    assert(Number(batchAfterCancel?.quantity) === 8, `stock batch quantity should remain 8 after draft cancel, actual=${batchAfterCancel?.quantity}`);
    const orderNoReservation = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(orderNoReservation?.sourceOrderId === order.id, 'cancelled order must keep orderNo reservation instead of releasing reused order number');
  } finally {
    await cleanupReservationCase();
    await prisma.$disconnect();
  }
}

async function assertDraftStockReservationRemovedOnDelete() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-RESERVATION-DELETE`;
  const customerCode = `${orderPrefix}-DEL-CUST`;
  const warehouseCode = `${orderPrefix}-DEL-WH`;
  const locationCode = `${orderPrefix}-DEL-LOC`;
  const partCode = `${materialPrefix}-RES-DELETE`;

  async function cleanupDraftDeleteCase() {
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupDraftDeleteCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '草稿删除库存预占清理回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '草稿删除库存预占清理回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '草稿删除库存预占清理回归仓库',
      locationCode,
      locationName: '草稿删除库存预占清理回归库位'
    });
    const batch = await prisma.inventoryBatch.create({
      data: {
        batchNo: `${orderPrefix}-DEL-BATCH`,
        partCode,
        partName: '草稿删除库存预占清理回归零件',
        quantity: 9,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });
    const order = await prisma.customerOrder.create({
      data: {
        orderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-06-16T00:00:00.000Z'),
        status: 'DRAFT',
        lines: {
          create: [
            {
              lineNo: 1,
              partCode,
              partName: '草稿删除库存预占清理回归零件',
              partThickness: 1,
              quantity: 5,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: '件',
              stockSourceSelections: [{ batchId: batch.id, quantity: 5 }]
            }
          ]
        }
      },
      include: { lines: true }
    });
    await prisma.orderNoReservation.create({
      data: {
        orderNo,
        orderNoNormalized: orderNo.toUpperCase(),
        sourceOrderId: order.id,
        reservedReason: 'ORDER_CREATED'
      }
    });
    const line = order.lines[0];
    const reservation = await prisma.inventoryReservation.create({
      data: {
        batchId: batch.id,
        orderId: order.id,
        orderLineId: line.id,
        orderNo,
        partCode,
        partName: line.partName,
        quantity: 5,
        unit: line.unit,
        status: 'ACTIVE',
        statusReason: 'DRAFT_ORDER_RESERVED'
      }
    });

    const deleteResult = await requestJson(`/orders/${encodeURIComponent(orderNo)}`, { method: 'DELETE' });
    assert(deleteResult.deleted === true && deleteResult.orderNo === orderNo, 'draft delete API must report the deleted orderNo');

    const deletedOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!deletedOrder, 'deleted draft order must be physically removed');
    const deletedReservation = await prisma.inventoryReservation.findUnique({ where: { id: reservation.id } });
    assert(!deletedReservation, 'deleted draft order must remove ACTIVE InventoryReservation rows');
    const releasedOrderNo = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!releasedOrderNo, 'deleted unsubmitted draft must release orderNo reservation for corrected re-import');
    const batchAfterDelete = await prisma.inventoryBatch.findUnique({ where: { id: batch.id } });
    assert(batchAfterDelete?.status === 'AVAILABLE', `stock batch should remain AVAILABLE after draft delete, actual=${batchAfterDelete?.status}`);
    assert(Number(batchAfterDelete?.quantity) === 9, `stock batch quantity should remain 9 after draft delete, actual=${batchAfterDelete?.quantity}`);
  } finally {
    await cleanupDraftDeleteCase();
    await prisma.$disconnect();
  }
}

async function assertDraftStockReservationReplacedOnEdit() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-RESERVATION-EDIT`;
  const customerCode = `${orderPrefix}-EDIT-RES-CUST`;
  const warehouseCode = `${orderPrefix}-EDIT-RES-WH`;
  const locationCode = `${orderPrefix}-EDIT-RES-LOC`;
  const partCode = `${materialPrefix}-RES-EDIT`;
  const firstBatchNo = `${orderPrefix}-EDIT-RES-A`;
  const secondBatchNo = `${orderPrefix}-EDIT-RES-B`;

  async function cleanupDraftEditReservationCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  const baseLine = {
    lineType: 'PART',
    partCategory: '通用件',
    projectModel: '草稿库存预占编辑',
    partCode,
    partName: '草稿库存预占编辑回归零件',
    drawingNo: `VERIFY-${runId}-RES-EDIT`,
    drawingVersion: 'A',
    partThickness: 1,
    partSpecification: '100mm x 100mm',
    unit: '件'
  };

  try {
    await cleanupDraftEditReservationCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '草稿库存预占编辑回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '草稿库存预占编辑回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '草稿库存预占编辑回归仓库',
      locationCode,
      locationName: '草稿库存预占编辑回归库位'
    });
    const firstBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: firstBatchNo,
        partCode,
        partName: baseLine.partName,
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });
    const secondBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: secondBatchNo,
        partCode,
        partName: baseLine.partName,
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-06-17',
        lines: [
          {
            ...baseLine,
            quantity: 4,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            selectedStockSources: [
              {
                batchId: firstBatch.id,
                batchNo: firstBatch.batchNo,
                partCode,
                partName: firstBatch.partName,
                quantity: 4,
                unit: firstBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同编码同单位库存来源',
                manualConfirmedBy: 'verify-draft-reservation-edit',
                manualConfirmedAt: '2026-06-17T08:00:00.000Z',
                manualConfirmRemark: '回归验证草稿库存来源可编辑'
              }
            ]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(draftOrder?.id, '草稿编辑库存预占订单必须写入数据库');
    const firstActiveReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: draftOrder.lines[0].id,
        batchId: firstBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(firstActiveReservation, '草稿编辑前必须先创建 A 批次 ACTIVE InventoryReservation');
    assert(Number(firstActiveReservation.quantity) === 4, `草稿编辑前 A 批次 ACTIVE 预占数量应为 4，实际 ${firstActiveReservation.quantity}`);
    const firstReservationCreatedAt = firstActiveReservation.createdAt;

    await requestJson(`/orders/${encodeURIComponent(orderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo,
        lines: [
          {
            ...baseLine,
            quantity: 5,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            selectedStockSources: [
              {
                batchId: firstBatch.id,
                batchNo: firstBatch.batchNo,
                partCode,
                partName: firstBatch.partName,
                quantity: 5,
                unit: firstBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同批次增加草稿预占数量',
                manualConfirmedBy: 'verify-draft-reservation-edit',
                manualConfirmedAt: '2026-06-17T08:30:00.000Z',
                manualConfirmRemark: '回归验证同批次预占扩数量'
              }
            ]
          }
        ]
      })
    });

    const increasedFirstBatchReservations = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, batchId: firstBatch.id, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(increasedFirstBatchReservations.length === 2, `草稿编辑同批次增加数量后应保留旧预占并追加新预占，实际 ${increasedFirstBatchReservations.length}`);
    assert(
      increasedFirstBatchReservations.reduce((sum, reservation) => sum + Number(reservation.quantity), 0) === 5,
      `草稿编辑同批次增加数量后 ACTIVE 预占合计应为 5，实际 ${increasedFirstBatchReservations.reduce(
        (sum, reservation) => sum + Number(reservation.quantity),
        0
      )}`
    );
    assert(
      increasedFirstBatchReservations[0].createdAt.getTime() === firstReservationCreatedAt.getTime(),
      '草稿编辑同批次增加数量后必须保留原预占 createdAt，避免后下单抢占库存优先级'
    );
    assert(Number(increasedFirstBatchReservations[0].quantity) === 4, `草稿编辑同批次增加数量后原时间预占数量应保持 4，实际 ${increasedFirstBatchReservations[0].quantity}`);

    await requestJson(`/orders/${encodeURIComponent(orderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo,
        lines: [
          {
            ...baseLine,
            quantity: 2,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            selectedStockSources: [
              {
                batchId: firstBatch.id,
                batchNo: firstBatch.batchNo,
                partCode,
                partName: firstBatch.partName,
                quantity: 2,
                unit: firstBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同批次减少草稿预占数量',
                manualConfirmedBy: 'verify-draft-reservation-edit',
                manualConfirmedAt: '2026-06-17T08:45:00.000Z',
                manualConfirmRemark: '回归验证同批次预占减数量'
              }
            ]
          }
        ]
      })
    });

    const reducedFirstBatchReservations = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, batchId: firstBatch.id, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(reducedFirstBatchReservations.length === 1, `草稿编辑同批次减少数量后应只保留 1 条 ACTIVE 预占，实际 ${reducedFirstBatchReservations.length}`);
    assert(Number(reducedFirstBatchReservations[0].quantity) === 2, `草稿编辑同批次减少数量后 ACTIVE 预占数量应为 2，实际 ${reducedFirstBatchReservations[0].quantity}`);
    assert(
      reducedFirstBatchReservations[0].createdAt.getTime() === firstReservationCreatedAt.getTime(),
      '草稿编辑同批次减少数量后仍必须保留原预占 createdAt'
    );
    const reducedFirstReservationId = reducedFirstBatchReservations[0].id;
    const releasedReservationCountBeforeRejectedEdit = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, status: 'RELEASED' }
    });

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderNo,
          lines: [
            {
              ...baseLine,
              quantity: 7,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              selectedStockSources: [
                {
                  batchId: secondBatch.id,
                  batchNo: secondBatch.batchNo,
                  partCode,
                  partName: secondBatch.partName,
                  quantity: 7,
                  unit: secondBatch.unit,
                  compatibilityStatus: 'MATCHED',
                  compatibilityReason: '尝试超过 B 批次可用库存',
                  manualConfirmedBy: 'verify-draft-reservation-edit',
                  manualConfirmedAt: '2026-06-17T08:50:00.000Z',
                  manualConfirmRemark: '回归验证库存来源编辑失败不释放旧预占'
                }
              ]
            }
          ]
        })
      },
      `已选库存批次 ${secondBatch.batchNo} 可用库存不足`
    );

    const orderAfterRejectedStockEdit = await prisma.customerOrder.findUnique({
      where: { id: draftOrder.id },
      include: { lines: true }
    });
    const rejectedEditLine = orderAfterRejectedStockEdit?.lines[0];
    assert(orderAfterRejectedStockEdit?.status === 'DRAFT', `草稿编辑库存来源失败后订单必须保持 DRAFT，实际 ${orderAfterRejectedStockEdit?.status}`);
    assert(Number(rejectedEditLine?.quantity) === 2, `草稿编辑库存来源失败后订单行数量必须保留为 2，实际 ${rejectedEditLine?.quantity}`);
    const rejectedLineSources = Array.isArray(rejectedEditLine?.stockSourceSelections) ? rejectedEditLine.stockSourceSelections : [];
    assert(
      rejectedLineSources.some((source) => source.batchId === firstBatch.id && Number(source.quantity) === 2),
      '草稿编辑库存来源失败后订单行必须保留原 A 批次库存来源'
    );

    const activeFirstReservationsAfterRejectedEdit = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, batchId: firstBatch.id, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(
      activeFirstReservationsAfterRejectedEdit.length === 1,
      `草稿编辑库存来源失败后必须保留原 ACTIVE InventoryReservation，实际 ${activeFirstReservationsAfterRejectedEdit.length}`
    );
    assert(
      activeFirstReservationsAfterRejectedEdit[0].id === reducedFirstReservationId,
      '草稿编辑库存来源失败后必须保留原 ACTIVE InventoryReservation 记录'
    );
    assert(
      Number(activeFirstReservationsAfterRejectedEdit[0].quantity) === 2,
      `草稿编辑库存来源失败后原 ACTIVE 预占数量必须仍为 2，实际 ${activeFirstReservationsAfterRejectedEdit[0].quantity}`
    );
    assert(
      activeFirstReservationsAfterRejectedEdit[0].createdAt.getTime() === firstReservationCreatedAt.getTime(),
      '草稿编辑库存来源失败后原 ACTIVE 预占 createdAt 不得变化'
    );
    const releasedReservationCountAfterRejectedEdit = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, status: 'RELEASED' }
    });
    assert(
      releasedReservationCountAfterRejectedEdit === releasedReservationCountBeforeRejectedEdit,
      `草稿编辑库存来源失败后不得提前释放旧预占，失败前 ${releasedReservationCountBeforeRejectedEdit}，失败后 ${releasedReservationCountAfterRejectedEdit}`
    );
    const activeSecondReservationCountAfterRejectedEdit = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, batchId: secondBatch.id, status: 'ACTIVE' }
    });
    assert(
      activeSecondReservationCountAfterRejectedEdit === 0,
      `草稿编辑库存来源失败后不得生成新库存批次预占，实际 ${activeSecondReservationCountAfterRejectedEdit}`
    );
    const transactionCountAfterRejectedEdit = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(
      transactionCountAfterRejectedEdit === 0,
      `草稿编辑库存来源失败后不得生成 InventoryTransaction，实际 ${transactionCountAfterRejectedEdit}`
    );

    await requestJson(`/orders/${encodeURIComponent(orderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo,
        lines: [
          {
            ...baseLine,
            quantity: 3,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            selectedStockSources: [
              {
                batchId: secondBatch.id,
                batchNo: secondBatch.batchNo,
                partCode,
                partName: secondBatch.partName,
                quantity: 3,
                unit: secondBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '改为使用 B 批次',
                manualConfirmedBy: 'verify-draft-reservation-edit',
                manualConfirmedAt: '2026-06-17T09:00:00.000Z',
                manualConfirmRemark: '回归验证草稿库存来源换批次'
              }
            ]
          }
        ]
      })
    });

    const orderAfterStockEdit = await prisma.customerOrder.findUnique({
      where: { id: draftOrder.id },
      include: { lines: true }
    });
    const stockEditLine = orderAfterStockEdit?.lines[0];
    assert(orderAfterStockEdit?.status === 'DRAFT', `草稿编辑换库存批次后订单必须保持 DRAFT，实际 ${orderAfterStockEdit?.status}`);
    const releasedFirstReservation = await prisma.inventoryReservation.findUnique({ where: { id: firstActiveReservation.id } });
    assert(releasedFirstReservation?.status === 'RELEASED', `草稿编辑换库存批次后旧 ACTIVE 预占必须释放，实际 ${releasedFirstReservation?.status}`);
    assert(releasedFirstReservation?.statusReason === 'SYNC_ORDER_RESERVATION', `草稿编辑换库存批次后旧预占释放原因必须是 SYNC_ORDER_RESERVATION，实际 ${releasedFirstReservation?.statusReason}`);
    assert(releasedFirstReservation?.releasedAt, '草稿编辑换库存批次后旧预占必须记录 releasedAt');
    assert(!releasedFirstReservation?.consumedAt, '草稿编辑换库存批次不得把旧预占标记为 CONSUMED');

    const secondActiveReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: stockEditLine?.id,
        batchId: secondBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(secondActiveReservation, '草稿编辑换库存批次后新库存批次必须创建 ACTIVE InventoryReservation');
    assert(Number(secondActiveReservation.quantity) === 3, `草稿编辑换库存批次后 B 批次 ACTIVE 预占数量应为 3，实际 ${secondActiveReservation.quantity}`);
    const firstActiveCountAfterEdit = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, batchId: firstBatch.id, status: 'ACTIVE' }
    });
    assert(firstActiveCountAfterEdit === 0, `草稿编辑换库存批次后 A 批次不得继续保留 ACTIVE 预占，实际 ${firstActiveCountAfterEdit}`);

    await requestJson(`/orders/${encodeURIComponent(orderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo,
        lines: [
          {
            ...baseLine,
            quantity: 3,
            productionPlanQuantity: 3,
            fulfillmentMode: 'STOCK',
            selectedStockSources: []
          }
        ]
      })
    });

    const orderAfterStockSourceClearedEdit = await prisma.customerOrder.findUnique({
      where: { id: draftOrder.id },
      include: { lines: true }
    });
    const stockSourceClearedLine = orderAfterStockSourceClearedEdit?.lines[0];
    assert(
      stockSourceClearedLine?.fulfillmentMode === 'STOCK',
      `草稿编辑清空库存来源后订单行履约方式必须仍为 STOCK，实际 ${stockSourceClearedLine?.fulfillmentMode}`
    );
    assert(
      Number(stockSourceClearedLine?.productionPlanQuantity) === 3,
      `草稿编辑清空库存来源后生产计划数量必须补回 3，实际 ${stockSourceClearedLine?.productionPlanQuantity}`
    );
    const clearedStockSources = Array.isArray(stockSourceClearedLine?.stockSourceSelections)
      ? stockSourceClearedLine.stockSourceSelections
      : [];
    assert(clearedStockSources.length === 0, `草稿编辑清空库存来源后订单行不得保留库存来源，实际 ${clearedStockSources.length}`);
    const activeReservationCountAfterStockSourceCleared = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, status: 'ACTIVE' }
    });
    assert(
      activeReservationCountAfterStockSourceCleared === 0,
      `草稿编辑清空库存来源后不得保留 ACTIVE InventoryReservation，实际 ${activeReservationCountAfterStockSourceCleared}`
    );
    const releasedSecondReservationAfterStockSourceCleared = await prisma.inventoryReservation.findUnique({
      where: { id: secondActiveReservation.id }
    });
    assert(
      releasedSecondReservationAfterStockSourceCleared?.status === 'RELEASED',
      `草稿编辑清空库存来源后旧库存批次预占必须释放，实际 ${releasedSecondReservationAfterStockSourceCleared?.status}`
    );
    assert(
      releasedSecondReservationAfterStockSourceCleared?.statusReason === 'SYNC_ORDER_RESERVATION',
      `草稿编辑清空库存来源后释放原因必须是 SYNC_ORDER_RESERVATION，实际 ${releasedSecondReservationAfterStockSourceCleared?.statusReason}`
    );
    assert(releasedSecondReservationAfterStockSourceCleared?.releasedAt, '草稿编辑清空库存来源后旧预占必须记录 releasedAt');
    assert(!releasedSecondReservationAfterStockSourceCleared?.consumedAt, '草稿编辑清空库存来源不得把旧预占标记为 CONSUMED');
    const transactionCountAfterStockSourceCleared = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(
      transactionCountAfterStockSourceCleared === 0,
      `草稿编辑清空库存来源不得生成 InventoryTransaction，实际 ${transactionCountAfterStockSourceCleared}`
    );

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      '第 1 个零件必须先选择库存批次并完成来源核对'
    );
    const orderAfterStockSourceClearedSubmitRejected = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(
      orderAfterStockSourceClearedSubmitRejected?.status === 'DRAFT',
      `清空库存来源草稿提交失败后订单必须保持 DRAFT，实际 ${orderAfterStockSourceClearedSubmitRejected?.status}`
    );
    const activeReservationCountAfterStockSourceClearedSubmitRejected = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, status: 'ACTIVE' }
    });
    assert(
      activeReservationCountAfterStockSourceClearedSubmitRejected === 0,
      `清空库存来源草稿提交失败后不得重新生成 ACTIVE InventoryReservation，实际 ${activeReservationCountAfterStockSourceClearedSubmitRejected}`
    );
    const transactionCountAfterStockSourceClearedSubmitRejected = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(
      transactionCountAfterStockSourceClearedSubmitRejected === 0,
      `清空库存来源草稿提交失败后不得生成 InventoryTransaction，实际 ${transactionCountAfterStockSourceClearedSubmitRejected}`
    );
    const orderBatchCountAfterStockSourceClearedSubmitRejected = await prisma.inventoryBatch.count({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(
      orderBatchCountAfterStockSourceClearedSubmitRejected === 0,
      `清空库存来源草稿提交失败后不得生成订单待发货库存批次，实际 ${orderBatchCountAfterStockSourceClearedSubmitRejected}`
    );
    const taskCountAfterStockSourceClearedSubmitRejected = await prisma.productionTask.count({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } }
    });
    assert(
      taskCountAfterStockSourceClearedSubmitRejected === 0,
      `清空库存来源草稿提交失败后不得生成 ProductionTask，实际 ${taskCountAfterStockSourceClearedSubmitRejected}`
    );

    await requestJson(`/orders/${encodeURIComponent(orderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo,
        lines: [
          {
            ...baseLine,
            quantity: 3,
            productionPlanQuantity: 3,
            fulfillmentMode: 'PRODUCTION',
            processSteps: [{ processName: '激光切割' }]
          }
        ]
      })
    });

    const activeReservationCountAfterProductionEdit = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, status: 'ACTIVE' }
    });
    assert(
      activeReservationCountAfterProductionEdit === 0,
      `草稿编辑改为重新生产后不得保留 ACTIVE InventoryReservation，实际 ${activeReservationCountAfterProductionEdit}`
    );
    const releasedSecondReservation = await prisma.inventoryReservation.findUnique({ where: { id: secondActiveReservation.id } });
    assert(releasedSecondReservation?.status === 'RELEASED', `草稿编辑改为重新生产后 B 批次预占必须释放，实际 ${releasedSecondReservation?.status}`);
    assert(releasedSecondReservation?.statusReason === 'SYNC_ORDER_RESERVATION', `草稿编辑改为重新生产后释放原因必须是 SYNC_ORDER_RESERVATION，实际 ${releasedSecondReservation?.statusReason}`);

    const firstBatchAfterEdits = await prisma.inventoryBatch.findUnique({ where: { id: firstBatch.id } });
    const secondBatchAfterEdits = await prisma.inventoryBatch.findUnique({ where: { id: secondBatch.id } });
    assert(Number(firstBatchAfterEdits?.quantity) === 6, `草稿编辑库存来源不得扣减 A 批次数量，实际 ${firstBatchAfterEdits?.quantity}`);
    assert(Number(secondBatchAfterEdits?.quantity) === 6, `草稿编辑库存来源不得扣减 B 批次数量，实际 ${secondBatchAfterEdits?.quantity}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `草稿编辑库存来源不得生成 InventoryTransaction，实际 ${transactionCount}`);
  } finally {
    await cleanupDraftEditReservationCase();
    await prisma.$disconnect();
  }
}

async function assertDraftStockReservationOrderNoRenumberedOnEdit() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-RESERVATION-RENUMBER`;
  const occupiedOrderNo = `${orderPrefix}-RESERVATION-RENUMBER-OCCUPIED`;
  const renumberedOrderNo = `${orderPrefix}-RESERVATION-RENUMBER-NEW`;
  const customerCode = `${orderPrefix}-REN-RES-CUST`;
  const warehouseCode = `${orderPrefix}-REN-RES-WH`;
  const locationCode = `${orderPrefix}-REN-RES-LOC`;
  const partCode = `${materialPrefix}-RES-RENUMBER`;
  const batchNo = `${orderPrefix}-REN-RES-BATCH`;

  async function cleanupDraftRenumberReservationCase() {
    const orderNos = [orderNo, occupiedOrderNo, renumberedOrderNo];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  const baseLine = {
    lineType: 'PART',
    partCategory: '通用件',
    projectModel: '草稿订单号变更库存预占',
    partCode,
    partName: '草稿订单号变更库存预占回归零件',
    drawingNo: `VERIFY-${runId}-RES-RENUMBER`,
    drawingVersion: 'A',
    partThickness: 1,
    partSpecification: '100mm x 100mm',
    unit: '件'
  };

  try {
    await cleanupDraftRenumberReservationCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '草稿订单号变更库存预占回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '草稿订单号变更库存预占回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '草稿订单号变更库存预占回归仓库',
      locationCode,
      locationName: '草稿订单号变更库存预占回归库位'
    });
    const batch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: baseLine.partName,
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-06-18',
        lines: [
          {
            ...baseLine,
            quantity: 4,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            selectedStockSources: [
              {
                batchId: batch.id,
                batchNo: batch.batchNo,
                partCode,
                partName: batch.partName,
                quantity: 4,
                unit: batch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同编码同单位库存来源',
                manualConfirmedBy: 'verify-draft-reservation-renumber',
                manualConfirmedAt: '2026-06-18T08:00:00.000Z',
                manualConfirmRemark: '回归验证草稿改订单号同步库存预占'
              }
            ]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(draftOrder?.id, '草稿修改订单号前必须先写入原订单');
    const originalActiveReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: draftOrder.lines[0].id,
        batchId: batch.id,
        status: 'ACTIVE'
      }
    });
    assert(originalActiveReservation, '草稿修改订单号前必须先创建原 ACTIVE InventoryReservation');

    await prisma.orderNoReservation.create({
      data: {
        orderNo: occupiedOrderNo,
        orderNoNormalized: occupiedOrderNo,
        reservedReason: 'EXISTING_ORDER_RESERVED'
      }
    });
    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderNo: occupiedOrderNo,
          lines: [
            {
              ...baseLine,
              quantity: 4,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              selectedStockSources: [
                {
                  batchId: batch.id,
                  batchNo: batch.batchNo,
                  partCode,
                  partName: batch.partName,
                  quantity: 4,
                  unit: batch.unit,
                  compatibilityStatus: 'MATCHED',
                  compatibilityReason: '尝试改成已占用订单号',
                  manualConfirmedBy: 'verify-draft-reservation-renumber',
                  manualConfirmedAt: '2026-06-18T08:15:00.000Z',
                  manualConfirmRemark: '回归验证已占用订单号失败不改变库存预占'
                }
              ]
            }
          ]
        })
      },
      `订单号 ${occupiedOrderNo} 已存在`
    );
    const orderAfterRejectedRenumber = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(
      orderAfterRejectedRenumber?.orderNo === orderNo,
      `草稿改成已占用订单号失败后订单号必须保持不变，实际 ${orderAfterRejectedRenumber?.orderNo}`
    );
    const occupiedCustomerOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: occupiedOrderNo, mode: 'insensitive' } }
    });
    assert(!occupiedCustomerOrder, '草稿改成已占用订单号失败后不得生成目标订单号订单');
    const reservationAfterRejectedRenumber = await prisma.inventoryReservation.findUnique({ where: { id: originalActiveReservation.id } });
    assert(
      reservationAfterRejectedRenumber?.status === 'ACTIVE',
      `草稿改成已占用订单号失败后原 ACTIVE 预占必须保持 ACTIVE，实际 ${reservationAfterRejectedRenumber?.status}`
    );
    assert(
      reservationAfterRejectedRenumber?.orderNo === orderNo,
      `草稿改成已占用订单号失败后原 ACTIVE 预占 orderNo 必须保持不变，实际 ${reservationAfterRejectedRenumber?.orderNo}`
    );
    assert(Number(reservationAfterRejectedRenumber?.quantity) === 4, `草稿改成已占用订单号失败后原 ACTIVE 预占数量必须仍为 4，实际 ${reservationAfterRejectedRenumber?.quantity}`);
    assert(!reservationAfterRejectedRenumber?.releasedAt, '草稿改成已占用订单号失败后不得释放原 ACTIVE 预占');
    assert(!reservationAfterRejectedRenumber?.consumedAt, '草稿改成已占用订单号失败后不得消耗原 ACTIVE 预占');
    const originalOrderNoReservationAfterRejectedRenumber = await prisma.orderNoReservation.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } }
    });
    assert(
      originalOrderNoReservationAfterRejectedRenumber?.sourceOrderId === draftOrder.id,
      '草稿改成已占用订单号失败后原订单号占用必须保持'
    );
    const occupiedOrderNoReservationAfterRejectedRenumber = await prisma.orderNoReservation.findFirst({
      where: { orderNo: { equals: occupiedOrderNo, mode: 'insensitive' } }
    });
    assert(
      occupiedOrderNoReservationAfterRejectedRenumber?.sourceOrderId !== draftOrder.id,
      '草稿改成已占用订单号失败后不得把目标订单号占用转给当前订单'
    );
    const batchAfterRejectedRenumber = await prisma.inventoryBatch.findUnique({ where: { id: batch.id } });
    assert(Number(batchAfterRejectedRenumber?.quantity) === 6, `草稿改成已占用订单号失败后不得扣减库存批次数量，实际 ${batchAfterRejectedRenumber?.quantity}`);
    const transactionCountAfterRejectedRenumber = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(
      transactionCountAfterRejectedRenumber === 0,
      `草稿改成已占用订单号失败后不得生成 InventoryTransaction，实际 ${transactionCountAfterRejectedRenumber}`
    );

    const renumberedResult = await requestJson(`/orders/${encodeURIComponent(orderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo: renumberedOrderNo,
        lines: [
          {
            ...baseLine,
            quantity: 4,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            selectedStockSources: [
              {
                batchId: batch.id,
                batchNo: batch.batchNo,
                partCode,
                partName: batch.partName,
                quantity: 4,
                unit: batch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '修改订单号后沿用原库存来源',
                manualConfirmedBy: 'verify-draft-reservation-renumber',
                manualConfirmedAt: '2026-06-18T08:30:00.000Z',
                manualConfirmRemark: '回归验证订单号变更后预占同步新订单号'
              }
            ]
          }
        ]
      })
    });
    assert(renumberedResult.orderNo === renumberedOrderNo, `草稿修改订单号后接口必须返回新订单号，实际 ${renumberedResult.orderNo}`);

    const oldOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!oldOrder, '草稿修改订单号后旧订单号不得继续查到订单');
    const renumberedOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: renumberedOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(renumberedOrder?.id === draftOrder.id, '草稿修改订单号后必须保留同一张订单记录');

    const releasedOriginalReservation = await prisma.inventoryReservation.findUnique({ where: { id: originalActiveReservation.id } });
    assert(releasedOriginalReservation?.status === 'RELEASED', `草稿修改订单号后旧订单号预占必须释放，实际 ${releasedOriginalReservation?.status}`);
    assert(
      releasedOriginalReservation?.statusReason === 'SYNC_ORDER_RESERVATION',
      `草稿修改订单号后旧预占释放原因必须是 SYNC_ORDER_RESERVATION，实际 ${releasedOriginalReservation?.statusReason}`
    );
    assert(releasedOriginalReservation?.orderNo === orderNo, `草稿修改订单号后旧预占必须保留原 orderNo 审计，实际 ${releasedOriginalReservation?.orderNo}`);
    assert(releasedOriginalReservation?.releasedAt, '草稿修改订单号后旧预占必须记录 releasedAt');

    const activeRenumberedReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        batchId: batch.id,
        status: 'ACTIVE'
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(activeRenumberedReservation, '草稿修改订单号后必须重建 ACTIVE InventoryReservation');
    assert(activeRenumberedReservation.id !== originalActiveReservation.id, '草稿修改订单号后新的 ACTIVE 预占不能复用已释放记录');
    assert(
      activeRenumberedReservation.orderNo === renumberedOrderNo,
      `草稿修改订单号后 ACTIVE InventoryReservation 必须同步新 orderNo，实际 ${activeRenumberedReservation.orderNo}`
    );
    assert(Number(activeRenumberedReservation.quantity) === 4, `草稿修改订单号后 ACTIVE 预占数量必须仍为 4，实际 ${activeRenumberedReservation.quantity}`);
    assert(
      activeRenumberedReservation.createdAt.getTime() === originalActiveReservation.createdAt.getTime(),
      '草稿修改订单号后同批次预占必须保留原 createdAt，避免改变库存占用优先级'
    );
    const oldActiveReservationCount = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, orderNo, status: 'ACTIVE' }
    });
    assert(oldActiveReservationCount === 0, `草稿修改订单号后旧订单号不得保留 ACTIVE 预占，实际 ${oldActiveReservationCount}`);

    const oldOrderNoReservation = await prisma.orderNoReservation.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } }
    });
    assert(!oldOrderNoReservation, '草稿修改订单号后旧订单号占用必须释放');
    const newOrderNoReservation = await prisma.orderNoReservation.findFirst({
      where: { orderNo: { equals: renumberedOrderNo, mode: 'insensitive' } }
    });
    assert(newOrderNoReservation?.sourceOrderId === draftOrder.id, '草稿修改订单号后新订单号必须继续占用');
    assert(
      newOrderNoReservation?.reservedReason === 'DRAFT_ORDER_RENUMBERED',
      `草稿修改订单号后新订单号占用原因必须是 DRAFT_ORDER_RENUMBERED，实际 ${newOrderNoReservation?.reservedReason}`
    );
    const batchAfterRenumber = await prisma.inventoryBatch.findUnique({ where: { id: batch.id } });
    assert(Number(batchAfterRenumber?.quantity) === 6, `草稿修改订单号不得扣减库存批次数量，实际 ${batchAfterRenumber?.quantity}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `草稿修改订单号不得生成 InventoryTransaction，实际 ${transactionCount}`);

    const deleteResult = await requestJson(`/orders/${encodeURIComponent(renumberedOrderNo)}`, { method: 'DELETE' });
    assert(deleteResult.deleted === true && deleteResult.orderNo === renumberedOrderNo, '草稿修改订单号后删除接口必须返回新订单号');
    const deletedRenumberedOrder = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(!deletedRenumberedOrder, '草稿修改订单号后删除草稿必须移除同一张订单记录');
    const remainingReservationCount = await prisma.inventoryReservation.count({ where: { orderId: draftOrder.id } });
    assert(remainingReservationCount === 0, `草稿修改订单号后删除草稿必须清理全部 InventoryReservation，实际 ${remainingReservationCount}`);
    const remainingOldOrderNoReservations = await prisma.inventoryReservation.count({ where: { orderNo } });
    assert(remainingOldOrderNoReservations === 0, `草稿修改订单号后删除草稿不得残留旧订单号 InventoryReservation，实际 ${remainingOldOrderNoReservations}`);
    const remainingNewOrderNoReservations = await prisma.inventoryReservation.count({ where: { orderNo: renumberedOrderNo } });
    assert(remainingNewOrderNoReservations === 0, `草稿修改订单号后删除草稿不得残留新订单号 InventoryReservation，实际 ${remainingNewOrderNoReservations}`);
    const newOrderNoReservationAfterDelete = await prisma.orderNoReservation.findFirst({
      where: { orderNo: { equals: renumberedOrderNo, mode: 'insensitive' } }
    });
    assert(!newOrderNoReservationAfterDelete, '草稿修改订单号后删除草稿必须释放新订单号占用');
    const batchAfterDelete = await prisma.inventoryBatch.findUnique({ where: { id: batch.id } });
    assert(Number(batchAfterDelete?.quantity) === 6, `草稿修改订单号后删除草稿不得扣减库存批次数量，实际 ${batchAfterDelete?.quantity}`);
  } finally {
    await cleanupDraftRenumberReservationCase();
    await prisma.$disconnect();
  }
}

async function assertDraftWithInventoryCannotBeDeleted() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-DRAFT-INVENTORY-DELETE-BLOCK`;
  const customerCode = `${orderPrefix}-BLOCK-CUST`;
  const warehouseCode = `${orderPrefix}-BLOCK-WH`;
  const locationCode = `${orderPrefix}-BLOCK-LOC`;
  const partCode = `${materialPrefix}-DELETE-BLOCK`;

  async function cleanupDraftInventoryBlockCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupDraftInventoryBlockCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '草稿已有库存禁止删除回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '草稿已有库存禁止删除回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '草稿已有库存禁止删除回归仓库',
      locationCode,
      locationName: '草稿已有库存禁止删除回归库位'
    });
    const order = await prisma.customerOrder.create({
      data: {
        orderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-06-17T00:00:00.000Z'),
        status: 'DRAFT',
        lines: {
          create: [
            {
              lineNo: 1,
              partCode,
              partName: '草稿已有库存禁止删除回归零件',
              partThickness: 1,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: '件'
            }
          ]
        }
      },
      include: { lines: true }
    });
    await prisma.orderNoReservation.create({
      data: {
        orderNo,
        orderNoNormalized: orderNo.toUpperCase(),
        sourceOrderId: order.id,
        reservedReason: 'ORDER_CREATED'
      }
    });
    const line = order.lines[0];
    const batch = await prisma.inventoryBatch.create({
      data: {
        batchNo: `${orderPrefix}-BLOCK-BATCH`,
        partCode,
        partName: line.partName,
        sourceOrderId: order.id,
        sourceOrderLineId: line.id,
        sourceOrderNo: order.orderNo,
        sourceCustomerName: order.customerName,
        quantity: 2,
        unit: line.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}`,
      { method: 'DELETE' },
      '已经存在生产或库存记录'
    );

    const preservedOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(preservedOrder?.id === order.id, 'draft with inventory must stay after rejected delete');
    const preservedBatch = await prisma.inventoryBatch.findUnique({ where: { id: batch.id } });
    assert(preservedBatch?.sourceOrderId === order.id, 'draft inventory batch must stay linked after rejected delete');
    assert(Number(preservedBatch?.quantity) === 2, `draft inventory batch quantity must stay 2 after rejected delete, actual=${preservedBatch?.quantity}`);
    const preservedOrderNo = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(preservedOrderNo?.sourceOrderId === order.id, 'rejected draft delete must keep orderNo reservation occupied');
  } finally {
    await cleanupDraftInventoryBlockCase();
    await prisma.$disconnect();
  }
}

async function assertSubmittedOrderCannotBeDeleted() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-SUBMITTED-DELETE-BLOCK`;
  const customerCode = `${orderPrefix}-SUBMITTED-BLOCK-CUST`;
  const partCode = `${materialPrefix}-SUBMITTED-DELETE-BLOCK`;

  async function cleanupSubmittedDeleteBlockCase() {
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupSubmittedDeleteBlockCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '已提交订单禁止删除回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '已提交订单禁止删除回归地址'
      }
    });
    const order = await prisma.customerOrder.create({
      data: {
        orderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-06-20T00:00:00.000Z'),
        status: 'PENDING_PRODUCTION',
        lines: {
          create: [
            {
              lineNo: 1,
              partCode,
              partName: '已提交订单禁止删除回归零件',
              partThickness: 1,
              quantity: 2,
              productionPlanQuantity: 2,
              fulfillmentMode: 'PRODUCTION',
              unit: '件'
            }
          ]
        }
      }
    });
    await prisma.orderNoReservation.create({
      data: {
        orderNo,
        orderNoNormalized: orderNo.toUpperCase(),
        sourceOrderId: order.id,
        reservedReason: 'ORDER_CREATED'
      }
    });

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}`,
      { method: 'DELETE' },
      '只有待提交生产草稿订单可以删除'
    );

    const preservedOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(preservedOrder?.id === order.id, 'submitted order must stay after rejected delete');
    assert(preservedOrder?.status === 'PENDING_PRODUCTION', `submitted order status must remain PENDING_PRODUCTION, actual=${preservedOrder?.status}`);
    const preservedOrderNo = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(preservedOrderNo?.sourceOrderId === order.id, 'rejected submitted delete must keep orderNo reservation occupied');
  } finally {
    await cleanupSubmittedDeleteBlockCase();
    await prisma.$disconnect();
  }
}

async function assertDraftWithProductionTaskCannotBeDeleted() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-DRAFT-TASK-DELETE-BLOCK`;
  const customerCode = `${orderPrefix}-TASK-BLOCK-CUST`;
  const partCode = `${materialPrefix}-TASK-DELETE-BLOCK`;
  const productionTaskNo = `${orderPrefix}-TASK-BLOCK-001`;

  async function cleanupDraftTaskBlockCase() {
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupDraftTaskBlockCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '草稿已有生产任务禁止删除回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '草稿已有生产任务禁止删除回归地址'
      }
    });
    const order = await prisma.customerOrder.create({
      data: {
        orderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-06-18T00:00:00.000Z'),
        status: 'DRAFT',
        lines: {
          create: [
            {
              lineNo: 1,
              partCode,
              partName: '草稿已有生产任务禁止删除回归零件',
              partThickness: 1,
              quantity: 2,
              productionPlanQuantity: 2,
              fulfillmentMode: 'PRODUCTION',
              unit: '件',
              processSnapshot: [{ stepNo: 1, processName: '下料' }]
            }
          ]
        }
      },
      include: { lines: true }
    });
    await prisma.orderNoReservation.create({
      data: {
        orderNo,
        orderNoNormalized: orderNo.toUpperCase(),
        sourceOrderId: order.id,
        reservedReason: 'ORDER_CREATED'
      }
    });
    const line = order.lines[0];
    const task = await prisma.productionTask.create({
      data: {
        productionTaskNo,
        orderId: order.id,
        orderLineId: line.id,
        orderNo,
        customerName: order.customerName,
        partCode,
        partName: line.partName,
        plannedQuantity: 2,
        unit: line.unit,
        status: 'PENDING',
        processSnapshot: [{ stepNo: 1, processName: '下料' }]
      }
    });

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}`,
      { method: 'DELETE' },
      '已经存在生产或库存记录'
    );

    const preservedOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(preservedOrder?.id === order.id, 'draft with production task must stay after rejected delete');
    const preservedTask = await prisma.productionTask.findUnique({ where: { id: task.id } });
    assert(preservedTask?.orderLineId === line.id, 'draft production task must stay linked after rejected delete');
    const preservedOrderNo = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(preservedOrderNo?.sourceOrderId === order.id, 'rejected draft task delete must keep orderNo reservation occupied');
  } finally {
    await cleanupDraftTaskBlockCase();
    await prisma.$disconnect();
  }
}

async function assertDraftWithInventoryTransactionCannotBeDeleted() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-DRAFT-TXN-DELETE-BLOCK`;
  const customerCode = `${orderPrefix}-TXN-BLOCK-CUST`;
  const warehouseCode = `${orderPrefix}-TXN-BLOCK-WH`;
  const locationCode = `${orderPrefix}-TXN-BLOCK-LOC`;
  const partCode = `${materialPrefix}-TXN-DELETE-BLOCK`;
  const batchNo = `${orderPrefix}-TXN-BLOCK-BATCH`;
  const transactionNo = `${orderPrefix}-TXN-BLOCK-001`;

  async function cleanupDraftTransactionBlockCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { transactionNo } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { batchNo } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupDraftTransactionBlockCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '草稿已有库存流水禁止删除回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '草稿已有库存流水禁止删除回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '草稿已有库存流水禁止删除回归仓库',
      locationCode,
      locationName: '草稿已有库存流水禁止删除回归库位'
    });
    const order = await prisma.customerOrder.create({
      data: {
        orderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-06-19T00:00:00.000Z'),
        status: 'DRAFT',
        lines: {
          create: [
            {
              lineNo: 1,
              partCode,
              partName: '草稿已有库存流水禁止删除回归零件',
              partThickness: 1,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: '件'
            }
          ]
        }
      },
      include: { lines: true }
    });
    await prisma.orderNoReservation.create({
      data: {
        orderNo,
        orderNoNormalized: orderNo.toUpperCase(),
        sourceOrderId: order.id,
        reservedReason: 'ORDER_CREATED'
      }
    });
    const line = order.lines[0];
    const batch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: line.partName,
        quantity: 2,
        unit: line.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });
    const transaction = await prisma.inventoryTransaction.create({
      data: {
        transactionNo,
        transactionType: 'IN',
        batchId: batch.id,
        orderLineId: line.id,
        partCode,
        partName: line.partName,
        orderNo,
        quantity: 2,
        unit: line.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        sourceRecordType: 'DraftDeleteRegression'
      }
    });

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}`,
      { method: 'DELETE' },
      '已经存在生产或库存记录'
    );

    const preservedOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(preservedOrder?.id === order.id, 'draft with inventory transaction must stay after rejected delete');
    const preservedTransaction = await prisma.inventoryTransaction.findUnique({ where: { id: transaction.id } });
    assert(preservedTransaction?.orderLineId === line.id, 'draft inventory transaction must stay linked after rejected delete');
    const preservedOrderNo = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(preservedOrderNo?.sourceOrderId === order.id, 'rejected draft transaction delete must keep orderNo reservation occupied');
  } finally {
    await cleanupDraftTransactionBlockCase();
    await prisma.$disconnect();
  }
}

async function assertImportedMaterialsUpserted(expectedPartCodes, forbiddenPartCodes = []) {
  const prisma = new PrismaClient();
  try {
    const materials = await prisma.material.findMany({
      where: { partCode: { in: expectedPartCodes } },
      select: { partCode: true, partName: true, unit: true, status: true }
    });
    const foundPartCodes = new Set(materials.map((material) => material.partCode));
    const missingPartCodes = expectedPartCodes.filter((partCode) => !foundPartCodes.has(partCode));
    assert(
      missingPartCodes.length === 0,
      `Imported order lines must be upserted into Material library, missing: ${missingPartCodes.join(', ')}`
    );
    assert(
      materials.every((material) => material.status === 'ENABLED'),
      'Imported Material rows must be enabled'
    );
    assert(
      materials.every((material) => material.partName && material.unit),
      'Imported Material rows must keep partName and unit'
    );
    for (const material of materials) {
      assertNoMojibake(material.partName, `Material ${material.partCode} 产品名称`);
      assertNoMojibake(material.unit, `Material ${material.partCode} 单位`);
    }
    if (forbiddenPartCodes.length > 0) {
      const rejectedMaterials = await prisma.material.findMany({
        where: { partCode: { in: forbiddenPartCodes } },
        select: { partCode: true }
      });
      assert(
        rejectedMaterials.length === 0,
        `Blocked import rows must not be upserted into Material library: ${rejectedMaterials
          .map((material) => material.partCode)
          .join(', ')}`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function assertOrderImportDoesNotOverwriteExistingMaterial(customerName) {
  const partCode = `${materialPrefix}-LOCKED`;
  const orderNo = `${orderPrefix}-NO-MATERIAL-OVERWRITE`;
  const originalMaterial = {
    partCode,
    partName: '订单导入不得覆盖已有 Material',
    unit: '件',
    partSpecification: '原始基础资料规格',
    status: 'DISABLED'
  };
  const importedSnapshot = {
    partName: '订单导入行独立快照名称',
    unit: '套',
    partSpecification: '订单行规格 888mm x 999mm'
  };

  const prisma = new PrismaClient();
  try {
    await prisma.material.upsert({
      where: { partCode },
      create: originalMaterial,
      update: originalMaterial
    });
  } finally {
    await prisma.$disconnect();
  }

  const overwriteSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-material-no-overwrite' })
  });
  importSessionIds.push(overwriteSession.id);

  const upload = await uploadWorkbook(
    overwriteSession.id,
    await buildWorkbookBufferFromRows([
      [
        1,
        orderNo,
        '2026/6/18',
        customerName,
        '导入不覆盖基础资料',
        '零件',
        1,
        '通用件',
        '',
        '',
        partCode,
        `VERIFY-${runId}-LOCKED`,
        importedSnapshot.partName,
        importedSnapshot.partSpecification,
        '1.5mm',
        2,
        '',
        2,
        importedSnapshot.unit,
        '激光切割',
        '订单导入只保存订单行快照，不能覆盖 Material 搜索记忆',
        '2026/6/18',
        '旧图'
      ]
    ]),
    `order-import-material-no-overwrite-${runId}.xlsx`
  );
  assert(upload.summary.selectableOrderCount === 1, `订单导入不得覆盖已有 Material 回归预览应有 1 个可导入订单，实际 ${upload.summary.selectableOrderCount}`);

  const commit = await requestJson(`/orders/import-sessions/${overwriteSession.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allSelectable: true, previewToken: upload.previewToken })
  });
  assert(commit.createdCount === 1, `订单导入不得覆盖已有 Material 回归应创建 1 个草稿订单，实际 ${commit.createdCount}`);
  assert(commit.materialSyncCount === 1, `订单导入不得覆盖已有 Material 回归仍应统计 1 个涉及零件编码，实际 ${commit.materialSyncCount}`);
  createdOrderNos.push(orderNo);

  const verifyPrisma = new PrismaClient();
  try {
    const material = await verifyPrisma.material.findUnique({
      where: { partCode },
      select: { partCode: true, partName: true, unit: true, partSpecification: true, status: true }
    });
    assert(material?.status === 'DISABLED', `订单导入不得把已停用 Material 自动恢复启用，实际 ${material?.status}`);
    assert(material.partName === originalMaterial.partName, `订单导入不得覆盖已有 Material.partName，实际 ${material.partName}`);
    assert(material.unit === originalMaterial.unit, `订单导入不得覆盖已有 Material.unit，实际 ${material.unit}`);
    assert(
      material.partSpecification === originalMaterial.partSpecification,
      `订单导入不得覆盖已有 Material.partSpecification，实际 ${material.partSpecification}`
    );

    const order = await verifyPrisma.customerOrder.findUnique({
      where: { orderNo },
      select: {
        status: true,
        lines: {
          where: { partCode },
          select: { partName: true, unit: true, partSpecification: true }
        }
      }
    });
    const importedLine = order?.lines?.[0];
    assert(order?.status === 'DRAFT', `订单导入只应创建 DRAFT 草稿订单，实际 ${order?.status}`);
    assert(importedLine?.partName === importedSnapshot.partName, `订单行应保留导入快照 partName，实际 ${importedLine?.partName}`);
    assert(importedLine?.unit === importedSnapshot.unit, `订单行应保留导入快照 unit，实际 ${importedLine?.unit}`);
    assert(
      importedLine?.partSpecification === importedSnapshot.partSpecification,
      `订单行应保留导入快照 partSpecification，实际 ${importedLine?.partSpecification}`
    );
  } finally {
    await verifyPrisma.$disconnect();
  }
}

async function assertMaterialMemoryHistorySearch(orderNo, expectedPartCode, drawingNo) {
  const prisma = new PrismaClient();
  try {
    const order = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      select: {
        customerCode: true,
        customerName: true
      }
    });
    assert(order?.customerCode, `Order ${orderNo} must have customerCode for material memory history search regression`);
    assert(order?.customerName, `Order ${orderNo} must have customerName for material memory history search regression`);

    const byCustomerCode = pageItems(await requestJson(`/inventory/materials?keyword=${encodeURIComponent(order.customerCode)}&includeTestFixtures=true`));
    assert(
      byCustomerCode.some((item) => item.partCode === expectedPartCode),
      `Material memory search by historical customerCode must find ${expectedPartCode}`
    );

    const byCustomerName = pageItems(await requestJson(`/inventory/materials?keyword=${encodeURIComponent(order.customerName)}&includeTestFixtures=true`));
    assert(
      byCustomerName.some((item) => item.partCode === expectedPartCode),
      `Material memory search by historical customerName must find ${expectedPartCode}`
    );

    const byDrawingNo = pageItems(await requestJson(`/inventory/materials?keyword=${encodeURIComponent(drawingNo)}&includeTestFixtures=true`));
    assert(
      byDrawingNo.some((item) => item.partCode === expectedPartCode),
      `Material memory search by historical drawingNo must find ${expectedPartCode}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function assertDisabledMaterialMemoryExcludedFromSuggestions(partCode, customerOrderNo) {
  const prisma = new PrismaClient();
  let materialId = '';
  try {
    const material = await prisma.material.findFirst({
      where: { partCode: { equals: partCode, mode: 'insensitive' } },
      select: { id: true }
    });
    assert(material?.id, `Material ${partCode} must exist before disabled-memory suggestion regression`);
    materialId = material.id;

    const order = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: customerOrderNo, mode: 'insensitive' } },
      select: { customerId: true }
    });
    assert(order?.customerId, `Order ${customerOrderNo} must have customerId for disabled-memory suggestion regression`);

    await requestJson(`/inventory/materials/${material.id}`, { method: 'DELETE' });

    const keywordSuggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}`);
    assert(
      !keywordSuggestions.some((item) => String(item.partCode || '').toLocaleLowerCase() === partCode.toLocaleLowerCase()),
      `Disabled Material ${partCode} must not appear in keyword material suggestions`
    );

    const customerSuggestions = await requestJson(`/inventory/materials/suggestions?customerId=${encodeURIComponent(order.customerId)}`);
    assert(
      !customerSuggestions.some((item) => String(item.partCode || '').toLocaleLowerCase() === partCode.toLocaleLowerCase()),
      `Disabled Material ${partCode} must not appear in current-customer history suggestions`
    );

    const disabledMemoryRows = pageItems(
      await requestJson(`/inventory/materials?keyword=${encodeURIComponent(partCode)}&status=DISABLED&includeTestFixtures=true`)
    );
    assert(
      disabledMemoryRows.some((item) => String(item.partCode || '').toLocaleLowerCase() === partCode.toLocaleLowerCase()),
      `Disabled Material ${partCode} must remain visible in disabled material-memory management`
    );
  } finally {
    if (materialId) {
      await prisma.material.update({
        where: { id: materialId },
        data: { status: 'ENABLED' }
      });
    }
    await prisma.$disconnect();
  }
}

async function assertMaterialSuggestionCustomerCodeSearch(orderNo, expectedPartCode) {
  const prisma = new PrismaClient();
  try {
    const order = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      select: {
        customerId: true,
        customerCode: true,
        customerName: true
      }
    });
    assert(order?.customerId, `订单 ${orderNo} 必须有客户 ID，才能验证当前客户历史用料聚焦推荐`);
    assert(order?.customerCode, `订单 ${orderNo} 必须有客户编码，才能验证过往客户快速检索`);

    const focusedSuggestions = await requestJson(`/inventory/materials/suggestions?customerId=${encodeURIComponent(order.customerId)}`);
    const focusedMatched = focusedSuggestions.find((item) => item.partCode === expectedPartCode);
    assert(
      focusedMatched,
      `客户已选但未输入关键字时，必须能推荐当前客户历史用料 ${expectedPartCode}`
    );
    assert(
      focusedMatched.customerUsageCount > 0,
      `当前客户历史用料必须返回 customerUsageCount，实际 ${focusedMatched.customerUsageCount}`
    );
    assert(
      focusedMatched.lastCustomerOrderNo,
      '当前客户历史用料必须返回最近订单号，便于下单人员判断是否选对'
    );

    const globalEmptySuggestions = await requestJson('/inventory/materials/suggestions');
    assert(
      Array.isArray(globalEmptySuggestions) && globalEmptySuggestions.length === 0,
      '没有关键词且没有当前客户时，物料建议不得返回全库物料'
    );

    const suggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(order.customerCode)}`);
    const matched = suggestions.find((item) => item.partCode === expectedPartCode);
    assert(
      matched,
      `用客户编码 ${order.customerCode} 搜索时必须能找到历史使用零件 ${expectedPartCode}`
    );
    assert(
      matched.matchedCustomerCode === order.customerCode,
      `客户编码搜索结果必须返回 matchedCustomerCode，实际 ${matched.matchedCustomerCode}`
    );
    assert(
      matched.matchedCustomerName === order.customerName,
      `客户编码搜索结果必须返回 matchedCustomerName，实际 ${matched.matchedCustomerName}`
    );
    assert(
      matched.searchMatchText === '客户历史匹配',
      `客户编码搜索结果必须标记客户历史匹配，实际 ${matched.searchMatchText}`
    );
    assert(Array.isArray(matched.historyCustomerNames), 'Material suggestions must expose historyCustomerNames as a preview array');
    assert(typeof matched.historyCustomerCount === 'number', 'Material suggestions must expose historyCustomerCount');
    assert(
      matched.historyCustomerNames.length <= 20,
      `Material suggestion history customer preview must not exceed 20, actual ${matched.historyCustomerNames.length}`
    );
    assert(
      matched.historyCustomerCount >= matched.historyCustomerNames.length,
      'Material suggestion historyCustomerCount must be >= historyCustomerNames preview length'
    );

    const customerNameSuggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(order.customerName)}`);
    const matchedByName = customerNameSuggestions.find((item) => item.partCode === expectedPartCode);
    assert(
      matchedByName,
      `用客户名称 ${order.customerName} 搜索时必须能找到历史使用零件 ${expectedPartCode}`
    );
    assert(
      matchedByName.matchedCustomerName === order.customerName,
      `客户名称搜索结果必须返回 matchedCustomerName，实际 ${matchedByName.matchedCustomerName}`
    );
    assert(
      matchedByName.searchMatchText === '客户历史匹配',
      `客户名称搜索结果必须标记客户历史匹配，实际 ${matchedByName.searchMatchText}`
    );

    const customerNameFragment = order.customerName.slice(0, Math.min(2, order.customerName.length));
    if (customerNameFragment && customerNameFragment !== order.customerName) {
      const fragmentSuggestions = await requestJson(
        `/inventory/materials/suggestions?keyword=${encodeURIComponent(customerNameFragment)}`
      );
      const matchedByFragment = fragmentSuggestions.find((item) => item.partCode === expectedPartCode);
      assert(
        matchedByFragment,
        `用客户名称片段 ${customerNameFragment} 搜索时必须能找到历史使用零件 ${expectedPartCode}`
      );
      assert(
        matchedByFragment.matchedCustomerName === order.customerName,
        `客户名称片段搜索结果必须返回 matchedCustomerName，实际 ${matchedByFragment.matchedCustomerName}`
      );
    }

    const customerInitials = pinyinInitials(order.customerName);
    assert(customerInitials.length >= 2, `客户名称 ${order.customerName} 必须能生成拼音首字母用于搜索回归`);
    const initialSuggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(customerInitials)}`);
    const matchedByInitials = initialSuggestions.find((item) => item.partCode === expectedPartCode);
    assert(
      matchedByInitials,
      `用客户名称拼音首字母 ${customerInitials} 搜索时必须能找到历史使用零件 ${expectedPartCode}`
    );
    assert(
      matchedByInitials.matchedCustomerName === order.customerName,
      `客户名称拼音首字母搜索结果必须返回 matchedCustomerName，实际 ${matchedByInitials.matchedCustomerName}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function assertMaterialSuggestionRecentCustomerHistorySort(recentOrderNo, expectedFirstPartCode) {
  let customerId = '';
  const prisma = new PrismaClient();
  try {
    const recentOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: recentOrderNo, mode: 'insensitive' } },
      select: { customerId: true }
    });
    assert(recentOrder?.customerId, `Order ${recentOrderNo} must have customerId for recent customer history sort regression`);
    customerId = recentOrder.customerId;
    await prisma.customerOrder.updateMany({
      where: {
        customerId,
        orderNo: { startsWith: orderPrefix }
      },
      data: { orderDate: new Date('2026-06-01T00:00:00.000Z') }
    });
    await prisma.customerOrder.updateMany({
      where: { orderNo: { equals: recentOrderNo, mode: 'insensitive' } },
      data: { orderDate: new Date('2026-07-01T00:00:00.000Z') }
    });
  } finally {
    await prisma.$disconnect();
  }

  const focusedSuggestions = await requestJson(`/inventory/materials/suggestions?customerId=${encodeURIComponent(customerId)}`);
  assert(
    focusedSuggestions[0]?.partCode === expectedFirstPartCode,
    `Current customer material suggestions must sort tied history by recent order date; first=${focusedSuggestions[0]?.partCode}`
  );
  assert(
    focusedSuggestions[0]?.lastCustomerOrderNo === recentOrderNo,
    `Current customer material suggestions must expose recent source order after sorting; actual=${focusedSuggestions[0]?.lastCustomerOrderNo}`
  );
}

async function assertMaterialSuggestionLastOrderScopedToCustomer(currentOrderNo, partCode) {
  const otherOrderNo = `${currentOrderNo}-OTHER-CUSTOMER-HISTORY`;
  const prisma = new PrismaClient();
  try {
    const currentOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: currentOrderNo, mode: 'insensitive' } },
      select: {
        customerId: true,
        customerName: true,
        lines: {
          where: { partCode },
          take: 1,
          select: { partName: true, drawingNo: true, partThickness: true, quantity: true, unit: true }
        }
      }
    });
    assert(currentOrder?.customerId, `Order ${currentOrderNo} must have customerId for scoped customer history regression`);
    const sourceLine = currentOrder.lines[0];
    assert(sourceLine, `Order ${currentOrderNo} must contain ${partCode} for scoped customer history regression`);
    const otherCustomer = await prisma.customer.findFirst({
      where: {
        id: { not: currentOrder.customerId },
        status: 'ENABLED'
      },
      select: { id: true, customerCode: true, customerName: true }
    });
    assert(otherCustomer, 'Scoped customer history regression requires another enabled customer');

    await prisma.customerOrder.deleteMany({ where: { orderNo: otherOrderNo } });
    const otherCustomerPartName = `${sourceLine.partName}-其他客户误用`;
    const otherCustomerDrawingNo = `${sourceLine.drawingNo || partCode}-OTHER`;
    const otherCustomerThickness = Number(sourceLine.partThickness || 0) + 9;
    await prisma.customerOrder.create({
      data: {
        orderNo: otherOrderNo,
        customerId: otherCustomer.id,
        customerCode: otherCustomer.customerCode,
        customerName: otherCustomer.customerName,
        customerSnapshot: otherCustomer,
        orderDate: new Date('2026-08-01T00:00:00.000Z'),
        status: 'DRAFT',
        lines: {
          create: [
            {
              lineNo: 1,
              partCode,
              partName: otherCustomerPartName,
              drawingNo: otherCustomerDrawingNo,
              partThickness: otherCustomerThickness,
              quantity: 1,
              productionPlanQuantity: 1,
              unit: sourceLine.unit,
              remark: 'Scoped customer history regression'
            }
          ]
        }
      }
    });

    const suggestions = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&customerId=${encodeURIComponent(currentOrder.customerId)}`
    );
    const matched = suggestions.find((item) => item.partCode === partCode);
    assert(matched, `Material suggestion must find ${partCode} when scoped by current customer`);
    assert(
      matched.lastCustomerOrderNo === currentOrderNo,
      `Material suggestion lastCustomerOrderNo must stay scoped to current customer; actual=${matched.lastCustomerOrderNo}`
    );
    assert(
      matched.lastCustomerName === currentOrder.customerName,
      `Material suggestion lastCustomerName must stay scoped to current customer; actual=${matched.lastCustomerName}`
    );
    assert(
      matched.partName === sourceLine.partName,
      `Material suggestion partName must prefer current customer history; actual=${matched.partName}`
    );
    assert(
      matched.drawingNo === sourceLine.drawingNo,
      `Material suggestion drawingNo must prefer current customer history; actual=${matched.drawingNo}`
    );
    assert(
      Number(matched.partThickness || 0) === Number(sourceLine.partThickness || 0),
      `Material suggestion partThickness must prefer current customer history; actual=${matched.partThickness}`
    );
    assert(
      matched.hasIdentityConflict === true && Number(matched.identityVariantCount || 0) >= 2,
      `Material suggestion must flag same-code identity conflicts; actual=${matched.identityVariantCount}`
    );
    const conflictFields = matched.identityConflictFields || [];
    for (const field of ['名称', '图号', '厚度']) {
      assert(
        conflictFields.includes(field),
        `Material suggestion identityConflictFields must include ${field}; actual=${conflictFields.join(',')}`
      );
    }
  } finally {
    await prisma.customerOrder.deleteMany({ where: { orderNo: otherOrderNo } });
    await prisma.$disconnect();
  }
}

async function assertMaterialSuggestionPinyinInitialSearch(keyword, expectedPartCode, expectedMatchText) {
  const suggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(keyword)}`);
  const matched = suggestions.find((item) => item.partCode === expectedPartCode);
  assert(
    matched,
    `用拼音/首字母 ${keyword} 搜索时必须能找到零件 ${expectedPartCode}`
  );
  assert(
    matched.searchMatchText === expectedMatchText,
    `拼音/首字母搜索结果必须标记 ${expectedMatchText}，实际 ${matched.searchMatchText}`
  );
  assertNoMojibake(matched.partName, '拼音/首字母搜索结果产品名称');
}

async function assertMaterialSuggestionCodeAbbreviationSearch(keyword, expectedPartCode) {
  const suggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(keyword)}`);
  const matched = suggestions.find((item) => item.partCode === expectedPartCode);
  assert(
    matched,
    `用编码缩写 ${keyword} 搜索时必须能找到零件 ${expectedPartCode}`
  );
  assert(
    matched.searchMatchText === '编码缩写匹配',
    `编码缩写搜索结果必须标记编码缩写匹配，实际 ${matched.searchMatchText}`
  );
  assertNoMojibake(matched.partName, '编码缩写搜索结果产品名称');
}

async function assertMaterialSuggestionHistoryFieldSearch(keyword, expectedPartCode, expectedMatchText, label) {
  assert(keyword, `必须提供${label}关键词，才能验证物料历史快速检索`);
  const suggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(keyword)}`);
  const matched = suggestions.find((item) => item.partCode === expectedPartCode);
  assert(
    matched,
    `用${label} ${keyword} 搜索时必须能找到历史使用零件 ${expectedPartCode}`
  );
  assert(
    matched.searchMatchText === expectedMatchText,
    `${label}搜索结果必须标记 ${expectedMatchText}，实际 ${matched.searchMatchText}`
  );
  if (expectedMatchText === '历史订单匹配') {
    assert(
      matched.matchedHistoryOrderNo === keyword,
      `${label}搜索结果必须返回 matchedHistoryOrderNo=${keyword}，实际 ${matched.matchedHistoryOrderNo}`
    );
  }
  assertNoMojibake(matched.partName, `${label}搜索结果产品名称`);
}

async function assertStockOnlySuggestionsExcludeNoStockHistory(keyword, expectedPartCode) {
  const suggestions = await requestJson(
    `/inventory/materials/suggestions?keyword=${encodeURIComponent(keyword)}&sourceType=STOCK`
  );
  assert(
    !suggestions.some((item) => item.partCode === expectedPartCode),
    `sourceType=STOCK must not return history-only Material ${expectedPartCode} when no available stock exists`
  );
}

async function assertSubmitRejectsInvalidPersistedComponentStructure(orderNo) {
  const prisma = new PrismaClient();
  try {
    const order = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' }
        }
      }
    });
    assert(order, `未找到待破坏组件结构的订单 ${orderNo}`);
    const childLine = order.lines.find((line) => line.parentComponentNo);
    assert(childLine, `订单 ${orderNo} 必须包含子零件，才能验证提交生产前组件结构兜底校验`);
    await prisma.orderLine.update({
      where: { id: childLine.id },
      data: { parentComponentNo: 'MISSING-COMPONENT' }
    });
  } finally {
    await prisma.$disconnect();
  }

  let rejected = false;
  try {
    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
  } catch (error) {
    rejected = true;
    assert(
      String(error.message || '').includes('所属组件 MISSING-COMPONENT 在当前订单内不存在'),
      `提交生产前必须拦截数据库中异常的组件父子关系，实际错误：${error.message}`
    );
  }
  assert(rejected, '提交生产前必须拒绝数据库中组件父子关系异常的草稿订单');
}

async function deleteSubmittedOrderStatusRegressionData(orderNo) {
  const prisma = new PrismaClient();
  try {
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
  } finally {
    await prisma.$disconnect();
  }
}

async function assertSubmitReturnsPendingProductionStatus(customerName) {
  const orderNo = `${orderPrefix}-PENDING-PRODUCTION`;
  const partCode = `${materialPrefix}-PENDING-PRODUCTION`;
  let cleanupIndex = -1;
  try {
    await deleteSubmittedOrderStatusRegressionData(orderNo);
    const prisma = new PrismaClient();
    let customer;
    try {
      customer = await prisma.customer.findFirst({
        where: { customerName },
        orderBy: { createdAt: 'asc' },
        select: { id: true }
      });
    } finally {
      await prisma.$disconnect();
    }
    assert(customer?.id, `未找到客户 ${customerName}，无法验证提交生产状态`);

    const createdOrder = await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-06-24',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '提交状态回归',
            partCode,
            partName: '提交状态回归零件',
            drawingNo: `VERIFY-${runId}-PENDING`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: 1,
            productionPlanQuantity: 1,
            fulfillmentMode: 'PRODUCTION',
            unit: '件',
            processSteps: [{ processName: '激光切割' }]
          }
        ]
      })
    });
    createdOrderNos.push(orderNo);
    cleanupIndex = createdOrderNos.length - 1;
    assert(createdOrder.status === 'DRAFT', `提交状态回归订单创建后必须是 DRAFT，实际 ${createdOrder.status}`);

    const submittedOrder = await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
    assert(
      submittedOrder.status === 'PENDING_PRODUCTION',
      `订单提交生产后必须返回 PENDING_PRODUCTION，实际 ${submittedOrder.status}`
    );
    const fetchedOrder = await requestJson(`/orders/${encodeURIComponent(orderNo)}`);
    assert(
      fetchedOrder.status === 'PENDING_PRODUCTION',
      `订单提交生产后详情接口必须返回 PENDING_PRODUCTION，实际 ${fetchedOrder.status}`
    );
  } finally {
    if (cleanupIndex >= 0) {
      createdOrderNos.splice(cleanupIndex, 1);
    }
    await deleteSubmittedOrderStatusRegressionData(orderNo);
  }
}

async function assertSubmitConsumesDraftStockReservation() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-RESERVATION-CONSUME`;
  const customerCode = `${orderPrefix}-STOCK-CONSUME-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-CONSUME-WH`;
  const locationCode = `${orderPrefix}-STOCK-CONSUME-LOC`;
  const partCode = `${materialPrefix}-STOCK-CONSUME`;
  const batchNo = `${orderPrefix}-STOCK-CONSUME-BATCH`;
  const selectedQuantity = 4;
  let createdOrderCleanupIndex = -1;

  async function cleanupSubmitStockReservationCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupSubmitStockReservationCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '提交生产消费草稿库存预占回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '提交生产消费草稿库存预占回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '提交生产消费草稿库存预占回归仓库',
      locationCode,
      locationName: '提交生产消费草稿库存预占回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '提交生产消费草稿库存预占回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    const createdOrder = await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-06-25',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '库存预占消费回归',
            partCode,
            partName: '提交生产消费草稿库存预占回归零件',
            drawingNo: `VERIFY-${runId}-STOCK-CONSUME`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: selectedQuantity,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            unit: '件',
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: selectedQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同编码同单位库存来源',
                manualConfirmedBy: 'verify-stock-reservation-consume',
                manualConfirmedAt: '2026-06-25T08:00:00.000Z',
                manualConfirmRemark: '回归验证人工确认库存来源可用于本订单'
              }
            ]
          }
        ]
      })
    });
    createdOrderNos.push(orderNo);
    createdOrderCleanupIndex = createdOrderNos.length - 1;
    assert(createdOrder.status === 'DRAFT', `库存预占消费回归订单创建后必须是 DRAFT，实际 ${createdOrder.status}`);

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(draftOrder?.id, '库存预占消费回归订单必须写入数据库');
    const draftLine = draftOrder.lines[0];
    assert(Number(draftLine.productionPlanQuantity) === 0, `库存全覆盖订单生产计划应为 0，实际 ${draftLine.productionPlanQuantity}`);
    const activeReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: draftLine.id,
        batchId: stockBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(activeReservation, '库存全覆盖草稿保存后必须创建 ACTIVE InventoryReservation');
    assert(Number(activeReservation.quantity) === selectedQuantity, `ACTIVE InventoryReservation 数量应为 ${selectedQuantity}，实际 ${activeReservation.quantity}`);

    const submittedOrder = await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
    assert(submittedOrder.status === 'PENDING_PRODUCTION', `库存全覆盖提交后订单状态必须是 PENDING_PRODUCTION，实际 ${submittedOrder.status}`);

    const consumedReservation = await prisma.inventoryReservation.findUnique({ where: { id: activeReservation.id } });
    assert(consumedReservation?.status === 'CONSUMED', `提交生产后草稿库存预占必须转为 CONSUMED，实际 ${consumedReservation?.status}`);
    assert(consumedReservation?.statusReason?.includes(orderNo), `CONSUMED InventoryReservation 必须记录订单号，实际 ${consumedReservation?.statusReason}`);
    assert(consumedReservation?.consumedAt, 'CONSUMED InventoryReservation 必须记录 consumedAt');
    assert(!consumedReservation?.releasedAt, 'CONSUMED InventoryReservation 不能误写 releasedAt');

    const sourceBatchAfterSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(sourceBatchAfterSubmit?.quantity) === 2, `原备货批次提交后应剩余 2，实际 ${sourceBatchAfterSubmit?.quantity}`);
    assert(sourceBatchAfterSubmit?.status === 'AVAILABLE', `原备货批次仍有库存时必须保持 AVAILABLE，实际 ${sourceBatchAfterSubmit?.status}`);
    const orderBatch = await prisma.inventoryBatch.findFirst({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderLineId: draftLine.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(orderBatch, '库存全覆盖提交后必须生成订单待发货库存批次');
    assert(Number(orderBatch.quantity) === selectedQuantity, `订单待发货库存批次数量应为 ${selectedQuantity}，实际 ${orderBatch.quantity}`);
    assert(orderBatch.status === 'AVAILABLE', `订单待发货库存批次必须为 AVAILABLE，实际 ${orderBatch.status}`);

    const transactions = await prisma.inventoryTransaction.findMany({
      where: { partCode },
      orderBy: { transactionNo: 'asc' }
    });
    const outTransaction = transactions.find((transaction) => transaction.transactionType === 'OUT' && transaction.batchId === stockBatch.id);
    assert(outTransaction, '库存全覆盖提交后必须给原备货批次追加 OUT InventoryTransaction');
    assert(Number(outTransaction.quantity) === selectedQuantity, `OUT InventoryTransaction 数量应为 ${selectedQuantity}，实际 ${outTransaction.quantity}`);
    assert(outTransaction.orderLineId === draftLine.id, 'OUT InventoryTransaction 必须关联订单行');
    assert(outTransaction.orderNo === null, `OUT InventoryTransaction 不应把备货批次写成订单库存，实际 orderNo=${outTransaction.orderNo}`);
    assert(outTransaction.sourceRecordType === 'OrderLineSTOCK', `OUT InventoryTransaction sourceRecordType 应为 OrderLineSTOCK，实际 ${outTransaction.sourceRecordType}`);
    const inTransaction = transactions.find((transaction) => transaction.transactionType === 'IN' && transaction.batchId === orderBatch.id);
    assert(inTransaction, '库存全覆盖提交后必须给订单待发货批次追加 IN InventoryTransaction');
    assert(Number(inTransaction.quantity) === selectedQuantity, `IN InventoryTransaction 数量应为 ${selectedQuantity}，实际 ${inTransaction.quantity}`);
    assert(inTransaction.orderLineId === draftLine.id, 'IN InventoryTransaction 必须关联订单行');
    assert(inTransaction.orderNo === orderNo, `IN InventoryTransaction 必须记录订单号 ${orderNo}，实际 ${inTransaction.orderNo}`);
    assert(inTransaction.sourceRecordType === 'OrderLineStockAllocation', `IN InventoryTransaction sourceRecordType 应为 OrderLineStockAllocation，实际 ${inTransaction.sourceRecordType}`);

    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `库存全覆盖且 productionPlanQuantity=0 时不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    if (createdOrderCleanupIndex >= 0) {
      createdOrderNos.splice(createdOrderCleanupIndex, 1);
    }
    await cleanupSubmitStockReservationCase();
    await prisma.$disconnect();
  }
}

async function assertSubmitPartiallyConsumesStockAndCreatesProductionTask() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-PARTIAL-PRODUCTION`;
  const customerCode = `${orderPrefix}-STOCK-PARTIAL-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-PARTIAL-WH`;
  const locationCode = `${orderPrefix}-STOCK-PARTIAL-LOC`;
  const partCode = `${materialPrefix}-STOCK-PARTIAL`;
  const batchNo = `${orderPrefix}-STOCK-PARTIAL-BATCH`;
  const orderQuantity = 5;
  const selectedQuantity = 3;
  const productionQuantity = orderQuantity - selectedQuantity;

  async function cleanupPartialStockCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupPartialStockCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '部分库存覆盖提交生产回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '部分库存覆盖提交生产回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '部分库存覆盖提交生产回归仓库',
      locationCode,
      locationName: '部分库存覆盖提交生产回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '部分库存覆盖提交生产回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    const createdOrder = await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-06-28',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '部分库存覆盖',
            partCode,
            partName: '部分库存覆盖提交生产回归零件',
            drawingNo: `VERIFY-${runId}-STOCK-PARTIAL`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: orderQuantity,
            productionPlanQuantity: productionQuantity,
            fulfillmentMode: 'STOCK',
            unit: '件',
            processSteps: [{ processName: '激光切割' }],
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: selectedQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同编码同单位库存来源',
                manualConfirmedBy: 'verify-stock-partial',
                manualConfirmedAt: '2026-06-28T08:00:00.000Z',
                manualConfirmRemark: '回归验证人工确认库存来源可用于本订单'
              }
            ]
          }
        ]
      })
    });
    assert(createdOrder.status === 'DRAFT', `部分库存覆盖订单创建后必须是 DRAFT，实际 ${createdOrder.status}`);

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(draftOrder?.id, '部分库存覆盖订单必须写入数据库');
    const draftLine = draftOrder.lines[0];
    assert(Number(draftLine.quantity) === orderQuantity, `部分库存覆盖订单客户数量必须是 ${orderQuantity}，实际 ${draftLine.quantity}`);
    assert(Number(draftLine.productionPlanQuantity) === productionQuantity, `部分库存覆盖订单生产计划必须是 ${productionQuantity}，实际 ${draftLine.productionPlanQuantity}`);
    const activeReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: draftLine.id,
        batchId: stockBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(activeReservation, '部分库存覆盖草稿保存后必须创建 ACTIVE InventoryReservation');
    assert(Number(activeReservation.quantity) === selectedQuantity, `部分库存覆盖 ACTIVE InventoryReservation 数量应为 ${selectedQuantity}，实际 ${activeReservation.quantity}`);

    const submittedOrder = await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
    assert(submittedOrder.status === 'PENDING_PRODUCTION', `部分库存覆盖提交后订单状态必须是 PENDING_PRODUCTION，实际 ${submittedOrder.status}`);

    const consumedReservation = await prisma.inventoryReservation.findUnique({ where: { id: activeReservation.id } });
    assert(consumedReservation?.status === 'CONSUMED', `部分库存覆盖提交后草稿预占必须转为 CONSUMED，实际 ${consumedReservation?.status}`);
    assert(Number(consumedReservation?.quantity) === selectedQuantity, `部分库存覆盖 CONSUMED 预占数量应为 ${selectedQuantity}，实际 ${consumedReservation?.quantity}`);
    const sourceBatchAfterSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(sourceBatchAfterSubmit?.quantity) === 3, `部分库存覆盖提交后原备货批次应剩余 3，实际 ${sourceBatchAfterSubmit?.quantity}`);
    assert(sourceBatchAfterSubmit?.status === 'AVAILABLE', `部分库存覆盖提交后原备货批次必须保持 AVAILABLE，实际 ${sourceBatchAfterSubmit?.status}`);
    const orderBatch = await prisma.inventoryBatch.findFirst({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderLineId: draftLine.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(orderBatch, '部分库存覆盖提交后必须生成订单待发货库存批次');
    assert(Number(orderBatch.quantity) === selectedQuantity, `部分库存覆盖订单待发货库存批次数量应为 ${selectedQuantity}，实际 ${orderBatch.quantity}`);

    const transactions = await prisma.inventoryTransaction.findMany({
      where: { partCode },
      orderBy: { transactionNo: 'asc' }
    });
    const outTransaction = transactions.find((transaction) => transaction.transactionType === 'OUT' && transaction.batchId === stockBatch.id);
    assert(outTransaction, '部分库存覆盖提交后必须给原备货批次追加 OUT InventoryTransaction');
    assert(Number(outTransaction.quantity) === selectedQuantity, `部分库存覆盖 OUT InventoryTransaction 数量应为 ${selectedQuantity}，实际 ${outTransaction.quantity}`);
    const inTransaction = transactions.find((transaction) => transaction.transactionType === 'IN' && transaction.batchId === orderBatch.id);
    assert(inTransaction, '部分库存覆盖提交后必须给订单待发货批次追加 IN InventoryTransaction');
    assert(Number(inTransaction.quantity) === selectedQuantity, `部分库存覆盖 IN InventoryTransaction 数量应为 ${selectedQuantity}，实际 ${inTransaction.quantity}`);

    const productionTasks = await prisma.productionTask.findMany({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      orderBy: { productionTaskNo: 'asc' }
    });
    assert(productionTasks.length === 1, `部分库存覆盖只应按剩余数量生成 1 个 ProductionTask，实际 ${productionTasks.length}`);
    assert(Number(productionTasks[0].plannedQuantity) === productionQuantity, `部分库存覆盖 ProductionTask plannedQuantity 应为 ${productionQuantity}，实际 ${productionTasks[0].plannedQuantity}`);
    assert(productionTasks[0].orderLineId === draftLine.id, '部分库存覆盖 ProductionTask 必须关联订单行');
    assert(productionTasks[0].status === 'PENDING', `部分库存覆盖 ProductionTask 初始状态必须是 PENDING，实际 ${productionTasks[0].status}`);
    assert(productionTasks[0].productionTaskNo === `PT-${orderNo}-001`, `部分库存覆盖 ProductionTask 编号应按订单行生成，实际 ${productionTasks[0].productionTaskNo}`);
    const taskProcessSnapshot = Array.isArray(productionTasks[0].processSnapshot) ? productionTasks[0].processSnapshot : [];
    assert(
      taskProcessSnapshot.some((step) => step.processName === '激光切割'),
      `部分库存覆盖 ProductionTask 必须保留下单时的 processSnapshot，实际 ${JSON.stringify(productionTasks[0].processSnapshot)}`
    );
  } finally {
    await cleanupPartialStockCase();
    await prisma.$disconnect();
  }
}

async function assertSubmitRejectsPartialStockWithoutProcessSteps() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-PARTIAL-NO-PROCESS`;
  const customerCode = `${orderPrefix}-STOCK-NO-PROCESS-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-NO-PROCESS-WH`;
  const locationCode = `${orderPrefix}-STOCK-NO-PROCESS-LOC`;
  const partCode = `${materialPrefix}-STOCK-NO-PROCESS`;
  const batchNo = `${orderPrefix}-STOCK-NO-PROCESS-BATCH`;
  const orderQuantity = 5;
  const selectedQuantity = 3;
  const productionQuantity = 2;

  async function cleanupPartialStockNoProcessCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupPartialStockNoProcessCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '部分库存缺工序拒绝提交回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '部分库存缺工序拒绝提交回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '部分库存缺工序拒绝提交回归仓库',
      locationCode,
      locationName: '部分库存缺工序拒绝提交回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '部分库存缺工序拒绝提交回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-07-01',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '部分库存缺工序',
            partCode,
            partName: '部分库存缺工序拒绝提交回归零件',
            drawingNo: `VERIFY-${runId}-STOCK-NO-PROCESS`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: orderQuantity,
            productionPlanQuantity: productionQuantity,
            fulfillmentMode: 'STOCK',
            unit: '件',
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: selectedQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同编码同单位库存来源',
                manualConfirmedBy: 'verify-stock-partial-no-process',
                manualConfirmedAt: '2026-07-01T08:00:00.000Z',
                manualConfirmRemark: '回归验证部分库存缺工序不能提交'
              }
            ]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: { include: { processSteps: true } } }
    });
    assert(draftOrder?.id, '部分库存缺工序订单必须写入数据库');
    const draftLine = draftOrder.lines[0];
    assert(draftLine.processSteps.length === 0, `部分库存缺工序订单保存后不应有工序明细，实际 ${draftLine.processSteps.length}`);
    const activeReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: draftLine.id,
        batchId: stockBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(activeReservation, '部分库存缺工序草稿保存后必须先创建 ACTIVE InventoryReservation');

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      `零件 ${partCode} 必须先设置生产流程`
    );

    const orderAfterRejectedSubmit = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(orderAfterRejectedSubmit?.status === 'DRAFT', `部分库存缺工序提交失败后订单必须保持 DRAFT，实际 ${orderAfterRejectedSubmit?.status}`);
    const reservationAfterRejectedSubmit = await prisma.inventoryReservation.findUnique({ where: { id: activeReservation.id } });
    assert(reservationAfterRejectedSubmit?.status === 'ACTIVE', `部分库存缺工序提交失败后预占必须保持 ACTIVE，实际 ${reservationAfterRejectedSubmit?.status}`);
    assert(!reservationAfterRejectedSubmit?.consumedAt, '部分库存缺工序提交失败后不得写入 consumedAt');
    assert(!reservationAfterRejectedSubmit?.releasedAt, '部分库存缺工序提交失败后不得写入 releasedAt');
    const batchAfterRejectedSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterRejectedSubmit?.quantity) === 6, `部分库存缺工序提交失败后原备货批次数量必须保持 6，实际 ${batchAfterRejectedSubmit?.quantity}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `部分库存缺工序提交失败后不得生成 InventoryTransaction，实际 ${transactionCount}`);
    const orderBatchCount = await prisma.inventoryBatch.count({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderLineId: draftLine.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(orderBatchCount === 0, `部分库存缺工序提交失败后不得生成订单待发货库存批次，实际 ${orderBatchCount}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `部分库存缺工序提交失败后不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupPartialStockNoProcessCase();
    await prisma.$disconnect();
  }
}

async function assertSubmitConsumesReworkStockAndCreatesProductionTask() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-REWORK-STOCK`;
  const customerCode = `${orderPrefix}-REWORK-CUST`;
  const warehouseCode = `${orderPrefix}-REWORK-WH`;
  const locationCode = `${orderPrefix}-REWORK-LOC`;
  const partCode = `${materialPrefix}-REWORK`;
  const batchNo = `${orderPrefix}-REWORK-BATCH`;
  const productionQuantity = 4;

  async function cleanupReworkStockCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupReworkStockCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '库存再加工提交生产回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '库存再加工提交生产回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '库存再加工提交生产回归仓库',
      locationCode,
      locationName: '库存再加工提交生产回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '库存再加工提交生产回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-07-02',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '库存再加工',
            partCode,
            partName: '库存再加工提交生产回归零件',
            drawingNo: `VERIFY-${runId}-REWORK`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: 4,
            productionPlanQuantity: productionQuantity,
            fulfillmentMode: 'REWORK',
            unit: '件',
            processSteps: [{ processName: '激光切割' }, { processName: '折弯' }],
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: productionQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '库存再加工领用来源',
                manualConfirmedBy: 'verify-rework-stock',
                manualConfirmedAt: '2026-07-02T08:00:00.000Z',
                manualConfirmRemark: '回归验证库存再加工人工确认来源'
              }
            ]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: { include: { processSteps: { orderBy: { stepNo: 'asc' } } } } }
    });
    assert(draftOrder?.id, '库存再加工订单必须写入数据库');
    const draftLine = draftOrder.lines[0];
    assert(draftLine.fulfillmentMode === 'REWORK', `库存再加工订单行履约方式必须是 REWORK，实际 ${draftLine.fulfillmentMode}`);
    assert(Number(draftLine.productionPlanQuantity) === productionQuantity, `库存再加工订单生产计划必须是 ${productionQuantity}，实际 ${draftLine.productionPlanQuantity}`);
    assert(draftLine.processSteps.length === 2, `库存再加工订单提交前必须保留 2 道工序，实际 ${draftLine.processSteps.length}`);
    const activeReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: draftLine.id,
        batchId: stockBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(activeReservation, '库存再加工草稿保存后必须创建 ACTIVE InventoryReservation');
    assert(Number(activeReservation.quantity) === productionQuantity, `库存再加工 ACTIVE 预占数量应为 ${productionQuantity}，实际 ${activeReservation.quantity}`);
    let submitLine = draftLine;
    let submitReservation = activeReservation;

    await requestJson(`/orders/${encodeURIComponent(orderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo,
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '库存再加工',
            partCode,
            partName: '库存再加工提交生产回归零件',
            drawingNo: `VERIFY-${runId}-REWORK`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: 4,
            productionPlanQuantity: productionQuantity,
            fulfillmentMode: 'REWORK',
            unit: '件',
            processSteps: [{ processName: '激光切割' }, { processName: '折弯' }],
            selectedStockSources: []
          }
        ]
      })
    });

    const orderAfterReworkStockSourceCleared = await prisma.customerOrder.findUnique({
      where: { id: draftOrder.id },
      include: { lines: { include: { processSteps: { orderBy: { stepNo: 'asc' } } } } }
    });
    const clearedReworkLine = orderAfterReworkStockSourceCleared?.lines[0];
    assert(clearedReworkLine?.fulfillmentMode === 'REWORK', `库存再加工清空来源后履约方式必须仍为 REWORK，实际 ${clearedReworkLine?.fulfillmentMode}`);
    assert(clearedReworkLine?.processSteps.length === 2, `库存再加工清空来源后必须保留工序快照，实际 ${clearedReworkLine?.processSteps.length}`);
    const clearedReworkSources = Array.isArray(clearedReworkLine?.stockSourceSelections) ? clearedReworkLine.stockSourceSelections : [];
    assert(clearedReworkSources.length === 0, `库存再加工清空来源后订单行不得保留库存来源，实际 ${clearedReworkSources.length}`);
    const activeReservationCountAfterReworkSourceCleared = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, status: 'ACTIVE' }
    });
    assert(
      activeReservationCountAfterReworkSourceCleared === 0,
      `库存再加工清空来源后不得保留 ACTIVE InventoryReservation，实际 ${activeReservationCountAfterReworkSourceCleared}`
    );
    const releasedReworkReservationAfterSourceCleared = await prisma.inventoryReservation.findUnique({
      where: { id: activeReservation.id }
    });
    assert(
      releasedReworkReservationAfterSourceCleared?.status === 'RELEASED',
      `库存再加工清空来源后旧预占必须释放，实际 ${releasedReworkReservationAfterSourceCleared?.status}`
    );
    assert(releasedReworkReservationAfterSourceCleared?.releasedAt, '库存再加工清空来源后旧预占必须记录 releasedAt');
    assert(!releasedReworkReservationAfterSourceCleared?.consumedAt, '库存再加工清空来源不得把旧预占标记为 CONSUMED');

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      '第 1 个零件必须先选择库存批次并完成来源核对'
    );
    const orderAfterClearedReworkSubmitRejected = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(
      orderAfterClearedReworkSubmitRejected?.status === 'DRAFT',
      `库存再加工清空来源提交失败后订单必须保持 DRAFT，实际 ${orderAfterClearedReworkSubmitRejected?.status}`
    );
    const batchAfterClearedReworkSubmitRejected = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(
      Number(batchAfterClearedReworkSubmitRejected?.quantity) === 6,
      `库存再加工清空来源提交失败后原备货批次数量必须保持 6，实际 ${batchAfterClearedReworkSubmitRejected?.quantity}`
    );
    const transactionCountAfterClearedReworkSubmitRejected = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(
      transactionCountAfterClearedReworkSubmitRejected === 0,
      `库存再加工清空来源提交失败后不得生成 InventoryTransaction，实际 ${transactionCountAfterClearedReworkSubmitRejected}`
    );
    const taskCountAfterClearedReworkSubmitRejected = await prisma.productionTask.count({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } }
    });
    assert(
      taskCountAfterClearedReworkSubmitRejected === 0,
      `库存再加工清空来源提交失败后不得生成 ProductionTask，实际 ${taskCountAfterClearedReworkSubmitRejected}`
    );

    await requestJson(`/orders/${encodeURIComponent(orderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo,
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '库存再加工',
            partCode,
            partName: '库存再加工提交生产回归零件',
            drawingNo: `VERIFY-${runId}-REWORK`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: 4,
            productionPlanQuantity: productionQuantity,
            fulfillmentMode: 'REWORK',
            unit: '件',
            processSteps: [{ processName: '激光切割' }, { processName: '折弯' }],
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: productionQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '清空后重新选择库存再加工来源',
                manualConfirmedBy: 'verify-rework-stock',
                manualConfirmedAt: '2026-07-02T08:30:00.000Z',
                manualConfirmRemark: '回归验证库存再加工来源可重新选择'
              }
            ]
          }
        ]
      })
    });
    const restoredReworkOrder = await prisma.customerOrder.findUnique({
      where: { id: draftOrder.id },
      include: { lines: { include: { processSteps: { orderBy: { stepNo: 'asc' } } } } }
    });
    const restoredReworkLine = restoredReworkOrder?.lines[0];
    assert(restoredReworkLine?.id, '库存再加工重新选择来源后必须保留订单行');
    const restoredReworkReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: restoredReworkLine?.id,
        batchId: stockBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(restoredReworkReservation, '库存再加工重新选择来源后必须重新创建 ACTIVE InventoryReservation');
    assert(Number(restoredReworkReservation.quantity) === productionQuantity, `库存再加工重新选择来源后 ACTIVE 预占数量应为 ${productionQuantity}，实际 ${restoredReworkReservation.quantity}`);
    submitLine = restoredReworkLine;
    submitReservation = restoredReworkReservation;

    const submittedOrder = await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
    assert(submittedOrder.status === 'PENDING_PRODUCTION', `库存再加工提交后订单状态必须是 PENDING_PRODUCTION，实际 ${submittedOrder.status}`);

    const consumedReservation = await prisma.inventoryReservation.findUnique({ where: { id: submitReservation.id } });
    assert(consumedReservation?.status === 'CONSUMED', `库存再加工提交后草稿预占必须转为 CONSUMED，实际 ${consumedReservation?.status}`);
    assert(consumedReservation?.consumedAt, '库存再加工提交后 CONSUMED InventoryReservation 必须记录 consumedAt');
    assert(!consumedReservation?.releasedAt, '库存再加工提交后预占不得误写 releasedAt');
    const sourceBatchAfterSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(sourceBatchAfterSubmit?.quantity) === 2, `库存再加工提交后原备货批次应剩余 2，实际 ${sourceBatchAfterSubmit?.quantity}`);

    const transactions = await prisma.inventoryTransaction.findMany({
      where: { partCode },
      orderBy: { transactionNo: 'asc' }
    });
    assert(transactions.length === 1, `库存再加工提交后只应生成 1 条 OUT InventoryTransaction，实际 ${transactions.length}`);
    assert(transactions[0].transactionType === 'OUT', `库存再加工流水必须是 OUT，实际 ${transactions[0].transactionType}`);
    assert(transactions[0].sourceRecordType === 'OrderLineREWORK', `库存再加工流水 sourceRecordType 必须是 OrderLineREWORK，实际 ${transactions[0].sourceRecordType}`);
    assert(transactions[0].transactionNo === `IT-REWORK-OUT-${orderNo}-001-01`, `库存再加工 OUT 流水编号不正确，实际 ${transactions[0].transactionNo}`);
    assert(Number(transactions[0].quantity) === productionQuantity, `库存再加工 OUT 数量应为 ${productionQuantity}，实际 ${transactions[0].quantity}`);

    const orderBatchCount = await prisma.inventoryBatch.count({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderLineId: submitLine.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(orderBatchCount === 0, `库存再加工提交后不得生成订单待发货库存批次，实际 ${orderBatchCount}`);

    const productionTasks = await prisma.productionTask.findMany({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      orderBy: { productionTaskNo: 'asc' }
    });
    assert(productionTasks.length === 1, `库存再加工提交后应生成 1 个 ProductionTask，实际 ${productionTasks.length}`);
    assert(Number(productionTasks[0].plannedQuantity) === productionQuantity, `库存再加工 ProductionTask plannedQuantity 应为 ${productionQuantity}，实际 ${productionTasks[0].plannedQuantity}`);
    assert(productionTasks[0].productionTaskNo === `PT-${orderNo}-001`, `库存再加工 ProductionTask 编号应按订单行生成，实际 ${productionTasks[0].productionTaskNo}`);
    const taskProcessSnapshot = Array.isArray(productionTasks[0].processSnapshot) ? productionTasks[0].processSnapshot : [];
    assert(
      taskProcessSnapshot.some((step) => step.processName === '激光切割') &&
        taskProcessSnapshot.some((step) => step.processName === '折弯'),
      `库存再加工 ProductionTask 必须保留下单时的 processSnapshot，实际 ${JSON.stringify(productionTasks[0].processSnapshot)}`
    );
  } finally {
    await cleanupReworkStockCase();
    await prisma.$disconnect();
  }
}

async function assertSubmitRejectsReworkStockSourceShortage() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-REWORK-SHORTAGE`;
  const customerCode = `${orderPrefix}-REWORK-SHORT-CUST`;
  const warehouseCode = `${orderPrefix}-REWORK-SHORT-WH`;
  const locationCode = `${orderPrefix}-REWORK-SHORT-LOC`;
  const partCode = `${materialPrefix}-REWORK-SHORT`;
  const batchNo = `${orderPrefix}-REWORK-SHORT-BATCH`;
  const productionQuantity = 4;
  const selectedQuantity = 2;

  async function cleanupReworkShortageCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupReworkShortageCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '库存再加工来源不足拒绝提交回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '库存再加工来源不足拒绝提交回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '库存再加工来源不足拒绝提交回归仓库',
      locationCode,
      locationName: '库存再加工来源不足拒绝提交回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '库存再加工来源不足拒绝提交回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-07-03',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '库存再加工来源不足',
            partCode,
            partName: '库存再加工来源不足拒绝提交回归零件',
            drawingNo: `VERIFY-${runId}-REWORK-SHORT`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: 4,
            productionPlanQuantity: productionQuantity,
            fulfillmentMode: 'REWORK',
            unit: '件',
            processSteps: [{ processName: '激光切割' }],
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: selectedQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '库存再加工领用来源不足',
                manualConfirmedBy: 'verify-rework-shortage',
                manualConfirmedAt: '2026-07-03T08:00:00.000Z',
                manualConfirmRemark: '回归验证库存再加工来源不足不能提交'
              }
            ]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: { include: { processSteps: true } } }
    });
    assert(draftOrder?.id, '库存再加工来源不足订单必须写入数据库');
    const draftLine = draftOrder.lines[0];
    assert(draftLine.processSteps.length === 1, `库存再加工来源不足订单必须已有工序，实际 ${draftLine.processSteps.length}`);
    const activeReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: draftLine.id,
        batchId: stockBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(activeReservation, '库存再加工来源不足草稿保存后必须创建 ACTIVE InventoryReservation');
    assert(Number(activeReservation.quantity) === selectedQuantity, `库存再加工来源不足 ACTIVE 预占数量应为 ${selectedQuantity}，实际 ${activeReservation.quantity}`);

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      `第 1 个零件已选库存数量少于本次需要数量：需要 ${productionQuantity}，已选 ${selectedQuantity}`
    );

    const orderAfterRejectedSubmit = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(orderAfterRejectedSubmit?.status === 'DRAFT', `库存再加工来源不足提交失败后订单必须保持 DRAFT，实际 ${orderAfterRejectedSubmit?.status}`);
    const reservationAfterRejectedSubmit = await prisma.inventoryReservation.findUnique({ where: { id: activeReservation.id } });
    assert(reservationAfterRejectedSubmit?.status === 'ACTIVE', `库存再加工来源不足提交失败后预占必须保持 ACTIVE，实际 ${reservationAfterRejectedSubmit?.status}`);
    assert(!reservationAfterRejectedSubmit?.consumedAt, '库存再加工来源不足提交失败后不得写入 consumedAt');
    assert(!reservationAfterRejectedSubmit?.releasedAt, '库存再加工来源不足提交失败后不得写入 releasedAt');
    const batchAfterRejectedSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterRejectedSubmit?.quantity) === 6, `库存再加工来源不足提交失败后原备货批次数量必须保持 6，实际 ${batchAfterRejectedSubmit?.quantity}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `库存再加工来源不足提交失败后不得生成 InventoryTransaction，实际 ${transactionCount}`);
    const orderBatchCount = await prisma.inventoryBatch.count({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderLineId: draftLine.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(orderBatchCount === 0, `库存再加工来源不足提交失败后不得生成订单待发货库存批次，实际 ${orderBatchCount}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `库存再加工来源不足提交失败后不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupReworkShortageCase();
    await prisma.$disconnect();
  }
}

async function assertCreateRejectsStockSourceOverAvailable() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-OVER-AVAILABLE`;
  const customerCode = `${orderPrefix}-STOCK-OVER-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-OVER-WH`;
  const locationCode = `${orderPrefix}-STOCK-OVER-LOC`;
  const partCode = `${materialPrefix}-STOCK-OVER`;
  const batchNo = `${orderPrefix}-STOCK-OVER-BATCH`;
  const batchQuantity = 3;
  const selectedQuantity = 4;

  async function cleanupStockOverAvailableCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupStockOverAvailableCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '使用库存超可用量拒绝保存回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '使用库存超可用量拒绝保存回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '使用库存超可用量拒绝保存回归仓库',
      locationCode,
      locationName: '使用库存超可用量拒绝保存回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '使用库存超可用量拒绝保存回归零件',
        quantity: batchQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo,
          orderDate: '2026-07-02',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: '使用库存超可用量',
              partCode,
              partName: '使用库存超可用量拒绝保存回归零件',
              drawingNo: `VERIFY-${runId}-STOCK-OVER`,
              drawingVersion: 'A',
              partThickness: 1,
              partSpecification: '100mm x 100mm',
              quantity: selectedQuantity,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: '件',
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: selectedQuantity,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED',
                  compatibilityReason: '同编码同单位库存来源但超过可用库存',
                  manualConfirmedBy: 'verify-stock-over-available',
                  manualConfirmedAt: '2026-07-02T08:00:00.000Z',
                  manualConfirmRemark: '回归验证使用库存超可用量不能保存草稿'
                }
              ]
            }
          ]
        })
      },
      `已选库存批次 ${stockBatch.batchNo} 可用库存不足`
    );

    const rejectedOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!rejectedOrder, '使用库存超可用量保存失败后不得生成草稿订单');
    const orderNoReservation = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!orderNoReservation, '使用库存超可用量保存失败后不得占用订单号');
    const reservationCount = await prisma.inventoryReservation.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(reservationCount === 0, `使用库存超可用量保存失败后不得生成 InventoryReservation，实际 ${reservationCount}`);
    const batchAfterRejectedCreate = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(
      Number(batchAfterRejectedCreate?.quantity) === batchQuantity,
      `使用库存超可用量保存失败后原备货批次数量必须保持 ${batchQuantity}，实际 ${batchAfterRejectedCreate?.quantity}`
    );
    assert(batchAfterRejectedCreate?.status === 'AVAILABLE', `使用库存超可用量保存失败后原备货批次必须保持 AVAILABLE，实际 ${batchAfterRejectedCreate?.status}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `使用库存超可用量保存失败后不得生成 InventoryTransaction，实际 ${transactionCount}`);
  } finally {
    await cleanupStockOverAvailableCase();
    await prisma.$disconnect();
  }
}

async function assertCreateRejectsSameBatchStockSourcesOverAvailableAcrossLines() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-SAME-BATCH-OVER`;
  const customerCode = `${orderPrefix}-STOCK-SAME-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-SAME-WH`;
  const locationCode = `${orderPrefix}-STOCK-SAME-LOC`;
  const partCode = `${materialPrefix}-STOCK-SAME`;
  const batchNo = `${orderPrefix}-STOCK-SAME-BATCH`;
  const batchQuantity = 5;
  const lineSelectedQuantity = 3;

  async function cleanupSameBatchOverAvailableCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function stockLine(index) {
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel: `同批次聚合校验-${index}`,
      partCode,
      partName: `同批次聚合校验回归零件-${index}`,
      drawingNo: `VERIFY-${runId}-STOCK-SAME-${index}`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity: lineSelectedQuantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件'
    };
  }

  try {
    await cleanupSameBatchOverAvailableCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '同批次聚合超库存拒绝保存回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '同批次聚合超库存拒绝保存回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '同批次聚合超库存拒绝保存回归仓库',
      locationCode,
      locationName: '同批次聚合超库存拒绝保存回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '同批次聚合超库存拒绝保存回归零件',
        quantity: batchQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo,
          orderDate: '2026-07-04',
          lines: [1, 2].map((index) => ({
            ...stockLine(index),
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: lineSelectedQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同一草稿订单多行共用同一库存批次',
                manualConfirmedBy: 'verify-stock-same-batch-over',
                manualConfirmedAt: '2026-07-04T08:00:00.000Z',
                manualConfirmRemark: `回归验证第 ${index} 行同批次聚合超库存`
              }
            ]
          }))
        })
      },
      `已选库存批次 ${stockBatch.batchNo} 可用库存不足`
    );

    const rejectedOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!rejectedOrder, '同一草稿订单多行共用同一库存批次超库存保存失败后不得生成草稿订单');
    const orderNoReservation = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!orderNoReservation, '同一草稿订单多行共用同一库存批次超库存保存失败后不得占用订单号');
    const reservationCount = await prisma.inventoryReservation.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(
      reservationCount === 0,
      `同一草稿订单多行共用同一库存批次超库存保存失败后不得生成 InventoryReservation，实际 ${reservationCount}`
    );
    const batchAfterRejectedCreate = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(
      Number(batchAfterRejectedCreate?.quantity) === batchQuantity,
      `同一草稿订单多行共用同一库存批次超库存保存失败后原备货批次数量必须保持 ${batchQuantity}，实际 ${batchAfterRejectedCreate?.quantity}`
    );
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(
      transactionCount === 0,
      `同一草稿订单多行共用同一库存批次超库存保存失败后不得生成 InventoryTransaction，实际 ${transactionCount}`
    );
  } finally {
    await cleanupSameBatchOverAvailableCase();
    await prisma.$disconnect();
  }
}

async function assertCreateRejectsDuplicateStockSourceStrictStatusWithoutFreshManualConfirmation() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-DUP-STRICT-CONFIRM`;
  const customerCode = `${orderPrefix}-STOCK-DUP-STRICT-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-DUP-STRICT-WH`;
  const locationCode = `${orderPrefix}-STOCK-DUP-STRICT-LOC`;
  const partCode = `${materialPrefix}-STOCK-DUP-STRICT`;
  const batchNo = `${orderPrefix}-STOCK-DUP-STRICT-BATCH`;

  async function cleanupDuplicateStrictConfirmCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupDuplicateStrictConfirmCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '重复库存来源严格状态人工确认回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '重复库存来源严格状态人工确认回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '重复库存来源严格状态人工确认回归仓库',
      locationCode,
      locationName: '重复库存来源严格状态人工确认回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '重复库存来源严格状态人工确认回归零件',
        quantity: 4,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo,
          orderDate: '2026-07-04',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: '重复库存来源严格状态人工确认',
              partCode,
              partName: stockBatch.partName,
              drawingNo: `VERIFY-${runId}-STOCK-DUP-STRICT`,
              drawingVersion: 'A',
              partThickness: 1,
              partSpecification: '100mm x 100mm',
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: stockBatch.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 1,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED',
                  compatibilityReason: '同编码同单位库存来源',
                  manualConfirmedBy: 'verify-stock-duplicate-strict',
                  manualConfirmedAt: '2026-07-04T08:10:00.000Z',
                  manualConfirmRemark: '旧确认记录只覆盖 MATCHED 行，不能覆盖后续严格风险'
                },
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 1,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'NEEDS_CONFIRMATION',
                  compatibilityReason: '重复库存来源合并后需要重新人工确认'
                }
              ]
            }
          ]
        })
      },
      `已选库存批次 ${stockBatch.batchNo} 与本次订单资料不完全匹配，必须填写人工确认记录`
    );

    const rejectedOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!rejectedOrder, '重复库存来源严格状态缺少新人工确认保存失败后不得生成草稿订单');
    const orderNoReservation = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!orderNoReservation, '重复库存来源严格状态缺少新人工确认保存失败后不得占用订单号');
    const reservationCount = await prisma.inventoryReservation.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(
      reservationCount === 0,
      `重复库存来源严格状态缺少新人工确认保存失败后不得生成 InventoryReservation，实际 ${reservationCount}`
    );
    const batchAfterRejectedCreate = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(
      Number(batchAfterRejectedCreate?.quantity) === 4,
      `重复库存来源严格状态缺少新人工确认保存失败后原备货批次数量必须保持 4，实际 ${batchAfterRejectedCreate?.quantity}`
    );
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(
      transactionCount === 0,
      `重复库存来源严格状态缺少新人工确认保存失败后不得生成 InventoryTransaction，实际 ${transactionCount}`
    );
  } finally {
    await cleanupDuplicateStrictConfirmCase();
    await prisma.$disconnect();
  }
}

async function assertUpdateRejectsSameBatchStockSourcesOverAvailableAcrossLines() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-SAME-BATCH-EDIT-OVER`;
  const customerCode = `${orderPrefix}-STOCK-SAME-EDIT-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-SAME-EDIT-WH`;
  const locationCode = `${orderPrefix}-STOCK-SAME-EDIT-LOC`;
  const partCode = `${materialPrefix}-STOCK-SAME-EDIT`;
  const batchNo = `${orderPrefix}-STOCK-SAME-EDIT-BATCH`;
  const batchQuantity = 5;
  const originalLineQuantity = 2;
  const rejectedLineQuantity = 3;

  async function cleanupSameBatchEditOverAvailableCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function stockLine(quantity, confirmTime, remark) {
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel: '同批次编辑聚合校验',
      partCode,
      partName: '同批次编辑聚合校验回归零件',
      drawingNo: `VERIFY-${runId}-STOCK-SAME-EDIT`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件',
      selectedStockSources: [
        {
          batchId: stockBatch.id,
          batchNo: stockBatch.batchNo,
          partCode,
          partName: stockBatch.partName,
          quantity,
          unit: stockBatch.unit,
          compatibilityStatus: 'MATCHED',
          compatibilityReason: '同一草稿订单多行共用同一库存批次',
          manualConfirmedBy: 'verify-stock-same-batch-edit-over',
          manualConfirmedAt: confirmTime,
          manualConfirmRemark: remark
        }
      ]
    };
  }

  let stockBatch;
  try {
    await cleanupSameBatchEditOverAvailableCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '同批次编辑聚合超库存拒绝回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '同批次编辑聚合超库存拒绝回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '同批次编辑聚合超库存拒绝回归仓库',
      locationCode,
      locationName: '同批次编辑聚合超库存拒绝回归库位'
    });
    stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '同批次编辑聚合超库存拒绝回归零件',
        quantity: batchQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-07-06',
        lines: [
          stockLine(originalLineQuantity, '2026-07-06T08:00:00.000Z', '回归验证第 1 行原始合法占用'),
          stockLine(originalLineQuantity, '2026-07-06T08:01:00.000Z', '回归验证第 2 行原始合法占用')
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: { orderBy: { lineNo: 'asc' } } }
    });
    assert(draftOrder?.id, '同批次编辑聚合校验订单必须写入数据库');
    assert(draftOrder.lines.length === 2, `同批次编辑聚合校验订单应有 2 条订单行，实际 ${draftOrder.lines.length}`);
    const originalReservations = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, batchId: stockBatch.id, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(originalReservations.length === 2, `同批次编辑聚合校验初始草稿应创建 2 条 ACTIVE InventoryReservation，实际 ${originalReservations.length}`);
    assert(
      originalReservations.every((reservation) => Number(reservation.quantity) === originalLineQuantity),
      '同批次编辑聚合校验初始每条 ACTIVE InventoryReservation 数量必须为 2'
    );
    const originalReservationSnapshots = originalReservations.map((reservation) => ({
      id: reservation.id,
      orderLineId: reservation.orderLineId,
      quantity: Number(reservation.quantity),
      createdAt: reservation.createdAt.getTime()
    }));
    const releasedReservationCountBeforeRejectedEdit = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, status: 'RELEASED' }
    });

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderNo,
          lines: [
            stockLine(rejectedLineQuantity, '2026-07-06T08:10:00.000Z', '回归验证第 1 行编辑超库存失败'),
            stockLine(rejectedLineQuantity, '2026-07-06T08:11:00.000Z', '回归验证第 2 行编辑超库存失败')
          ]
        })
      },
      `已选库存批次 ${stockBatch.batchNo} 可用库存不足`
    );

    const orderAfterRejectedEdit = await prisma.customerOrder.findUnique({
      where: { id: draftOrder.id },
      include: { lines: { orderBy: { lineNo: 'asc' } } }
    });
    assert(orderAfterRejectedEdit?.status === 'DRAFT', `同批次编辑聚合超库存失败后订单必须保持 DRAFT，实际 ${orderAfterRejectedEdit?.status}`);
    assert(orderAfterRejectedEdit?.lines.length === 2, `同批次编辑聚合超库存失败后仍应保留 2 条订单行，实际 ${orderAfterRejectedEdit?.lines.length}`);
    assert(
      orderAfterRejectedEdit?.lines.every((line) => Number(line.quantity) === originalLineQuantity),
      '同批次编辑聚合超库存失败后订单行数量必须保持原始 2'
    );
    assert(
      orderAfterRejectedEdit?.lines.every((line) => {
        const sources = Array.isArray(line.stockSourceSelections) ? line.stockSourceSelections : [];
        return sources.length === 1 && sources[0].batchId === stockBatch.id && Number(sources[0].quantity) === originalLineQuantity;
      }),
      '同批次编辑聚合超库存失败后订单行库存来源必须保持原始合法选择'
    );

    const activeReservationsAfterRejectedEdit = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, batchId: stockBatch.id, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(
      activeReservationsAfterRejectedEdit.length === 2,
      `同批次编辑聚合超库存失败后必须保留原 2 条 ACTIVE InventoryReservation，实际 ${activeReservationsAfterRejectedEdit.length}`
    );
    for (const snapshot of originalReservationSnapshots) {
      const current = activeReservationsAfterRejectedEdit.find((reservation) => reservation.id === snapshot.id);
      assert(current, `同批次编辑聚合超库存失败后必须保留原 ACTIVE InventoryReservation ${snapshot.id}`);
      assert(Number(current.quantity) === snapshot.quantity, `同批次编辑聚合超库存失败后原预占数量必须保持 ${snapshot.quantity}，实际 ${current.quantity}`);
      assert(current.orderLineId === snapshot.orderLineId, `同批次编辑聚合超库存失败后原预占订单行必须保持 ${snapshot.orderLineId}，实际 ${current.orderLineId}`);
      assert(current.createdAt.getTime() === snapshot.createdAt, '同批次编辑聚合超库存失败后原预占 createdAt 不得变化');
      assert(!current.releasedAt, '同批次编辑聚合超库存失败后原预占不得写入 releasedAt');
      assert(!current.consumedAt, '同批次编辑聚合超库存失败后原预占不得写入 consumedAt');
    }
    const releasedReservationCountAfterRejectedEdit = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, status: 'RELEASED' }
    });
    assert(
      releasedReservationCountAfterRejectedEdit === releasedReservationCountBeforeRejectedEdit,
      `同批次编辑聚合超库存失败后不得提前释放预占，失败前 ${releasedReservationCountBeforeRejectedEdit}，失败后 ${releasedReservationCountAfterRejectedEdit}`
    );
    const batchAfterRejectedEdit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterRejectedEdit?.quantity) === batchQuantity, `同批次编辑聚合超库存失败后原库存批次数量必须保持 ${batchQuantity}，实际 ${batchAfterRejectedEdit?.quantity}`);
    assert(batchAfterRejectedEdit?.status === 'AVAILABLE', `同批次编辑聚合超库存失败后原库存批次必须保持 AVAILABLE，实际 ${batchAfterRejectedEdit?.status}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `同批次编辑聚合超库存失败后不得生成 InventoryTransaction，实际 ${transactionCount}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `同批次编辑聚合超库存失败后不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupSameBatchEditOverAvailableCase();
    await prisma.$disconnect();
  }
}

async function assertCreateRejectsStockSourceReservedByEarlierDraftOrder() {
  const prisma = new PrismaClient();
  const firstOrderNo = `${orderPrefix}-STOCK-PRIORITY-FIRST`;
  const secondOrderNo = `${orderPrefix}-STOCK-PRIORITY-SECOND`;
  const customerCode = `${orderPrefix}-STOCK-PRIORITY-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-PRIORITY-WH`;
  const locationCode = `${orderPrefix}-STOCK-PRIORITY-LOC`;
  const partCode = `${materialPrefix}-STOCK-PRIORITY`;
  const batchNo = `${orderPrefix}-STOCK-PRIORITY-BATCH`;
  const batchQuantity = 5;
  const firstSelectedQuantity = 4;
  const secondSelectedQuantity = 2;

  async function cleanupStockReservationPriorityCase() {
    const orderNos = [firstOrderNo, secondOrderNo];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function stockLine(stockBatch, quantity, remark) {
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel: '跨草稿预占优先级',
      partCode,
      partName: '跨草稿预占优先级回归零件',
      drawingNo: `VERIFY-${runId}-STOCK-PRIORITY`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件',
      selectedStockSources: [
        {
          batchId: stockBatch.id,
          batchNo: stockBatch.batchNo,
          partCode,
          partName: stockBatch.partName,
          quantity,
          unit: stockBatch.unit,
          compatibilityStatus: 'MATCHED',
          compatibilityReason: '同一备货库存批次，用于验证跨订单库存预占扣除',
          manualConfirmedBy: 'verify-stock-reservation-priority',
          manualConfirmedAt: '2026-07-07T08:00:00.000Z',
          manualConfirmRemark: remark
        }
      ]
    };
  }

  try {
    await cleanupStockReservationPriorityCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '跨草稿预占优先级回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '跨草稿预占优先级回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '跨草稿预占优先级回归仓库',
      locationCode,
      locationName: '跨草稿预占优先级回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '跨草稿预占优先级回归零件',
        quantity: batchQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: firstOrderNo,
        orderDate: '2026-07-07',
        lines: [stockLine(stockBatch, firstSelectedQuantity, '回归验证第一个草稿先占用库存')]
      })
    });

    const firstDraftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: firstOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(firstDraftOrder?.id, '跨草稿预占优先级第一个草稿订单必须写入数据库');
    const firstDraftLine = firstDraftOrder.lines[0];
    const firstReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: firstDraftOrder.id,
        orderLineId: firstDraftLine.id,
        batchId: stockBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(firstReservation, '跨草稿预占优先级第一个草稿必须创建 ACTIVE InventoryReservation');
    assert(Number(firstReservation.quantity) === firstSelectedQuantity, `跨草稿预占优先级第一个草稿预占数量应为 ${firstSelectedQuantity}，实际 ${firstReservation.quantity}`);
    const firstReservationCreatedAt = firstReservation.createdAt.getTime();

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: secondOrderNo,
          orderDate: '2026-07-07',
          lines: [stockLine(stockBatch, secondSelectedQuantity, '回归验证第二个草稿不能绕过前一个草稿预占')]
        })
      },
      `已选库存批次 ${stockBatch.batchNo} 可用库存不足`
    );

    const secondDraftOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: secondOrderNo, mode: 'insensitive' } } });
    assert(!secondDraftOrder, '跨草稿预占优先级第二个草稿超库存保存失败后不得生成 CustomerOrder');
    const secondOrderNoReservation = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: secondOrderNo, mode: 'insensitive' } } });
    assert(!secondOrderNoReservation, '跨草稿预占优先级第二个草稿超库存保存失败后不得占用订单号');
    const secondReservationCount = await prisma.inventoryReservation.count({ where: { orderNo: { equals: secondOrderNo, mode: 'insensitive' } } });
    assert(secondReservationCount === 0, `跨草稿预占优先级第二个草稿超库存保存失败后不得生成 InventoryReservation，实际 ${secondReservationCount}`);

    const firstOrderAfterRejectedSecondCreate = await prisma.customerOrder.findUnique({
      where: { id: firstDraftOrder.id },
      include: { lines: true }
    });
    assert(firstOrderAfterRejectedSecondCreate?.status === 'DRAFT', `跨草稿预占优先级第二个草稿失败后第一个订单必须保持 DRAFT，实际 ${firstOrderAfterRejectedSecondCreate?.status}`);
    const firstReservationAfterRejectedSecondCreate = await prisma.inventoryReservation.findUnique({ where: { id: firstReservation.id } });
    assert(firstReservationAfterRejectedSecondCreate?.status === 'ACTIVE', `跨草稿预占优先级第二个草稿失败后第一个预占必须保持 ACTIVE，实际 ${firstReservationAfterRejectedSecondCreate?.status}`);
    assert(Number(firstReservationAfterRejectedSecondCreate?.quantity) === firstSelectedQuantity, `跨草稿预占优先级第二个草稿失败后第一个预占数量必须保持 ${firstSelectedQuantity}，实际 ${firstReservationAfterRejectedSecondCreate?.quantity}`);
    assert(firstReservationAfterRejectedSecondCreate?.createdAt.getTime() === firstReservationCreatedAt, '跨草稿预占优先级第二个草稿失败后第一个预占 createdAt 不得变化');
    assert(!firstReservationAfterRejectedSecondCreate?.releasedAt, '跨草稿预占优先级第二个草稿失败后第一个预占不得释放');
    assert(!firstReservationAfterRejectedSecondCreate?.consumedAt, '跨草稿预占优先级第二个草稿失败后第一个预占不得消费');
    const stockBatchAfterRejectedSecondCreate = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(stockBatchAfterRejectedSecondCreate?.quantity) === batchQuantity, `跨草稿预占优先级第二个草稿失败后原库存批次数量必须保持 ${batchQuantity}，实际 ${stockBatchAfterRejectedSecondCreate?.quantity}`);
    assert(stockBatchAfterRejectedSecondCreate?.status === 'AVAILABLE', `跨草稿预占优先级第二个草稿失败后原库存批次必须保持 AVAILABLE，实际 ${stockBatchAfterRejectedSecondCreate?.status}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `跨草稿预占优先级第二个草稿失败后不得生成 InventoryTransaction，实际 ${transactionCount}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { in: [firstOrderNo, secondOrderNo] } } });
    assert(taskCount === 0, `跨草稿预占优先级草稿保存阶段不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupStockReservationPriorityCase();
    await prisma.$disconnect();
  }
}

async function assertLaterDraftSubmitRejectsAfterEarlierDraftReservationIncrease() {
  const prisma = new PrismaClient();
  const firstOrderNo = `${orderPrefix}-STOCK-PRIORITY-EDIT-FIRST`;
  const secondOrderNo = `${orderPrefix}-STOCK-PRIORITY-EDIT-SECOND`;
  const customerCode = `${orderPrefix}-STOCK-PRIORITY-EDIT-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-PRIORITY-EDIT-WH`;
  const locationCode = `${orderPrefix}-STOCK-PRIORITY-EDIT-LOC`;
  const partCode = `${materialPrefix}-STOCK-PRIORITY-EDIT`;
  const batchNo = `${orderPrefix}-STOCK-PRIORITY-EDIT-BATCH`;
  const batchQuantity = 5;
  const originalFirstQuantity = 2;
  const secondQuantity = 2;
  const increasedFirstQuantity = 4;

  async function cleanupStockReservationPriorityEditCase() {
    const orderNos = [firstOrderNo, secondOrderNo];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function stockLine(stockBatch, quantity, remark) {
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel: '跨草稿预占优先级编辑',
      partCode,
      partName: '跨草稿预占优先级编辑回归零件',
      drawingNo: `VERIFY-${runId}-STOCK-PRIORITY-EDIT`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件',
      selectedStockSources: [
        {
          batchId: stockBatch.id,
          batchNo: stockBatch.batchNo,
          partCode,
          partName: stockBatch.partName,
          quantity,
          unit: stockBatch.unit,
          compatibilityStatus: 'MATCHED',
          compatibilityReason: '同一备货库存批次，用于验证跨订单库存预占扣除',
          manualConfirmedBy: 'verify-stock-reservation-priority-edit',
          manualConfirmedAt: '2026-07-08T08:00:00.000Z',
          manualConfirmRemark: remark
        }
      ]
    };
  }

  try {
    await cleanupStockReservationPriorityEditCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '跨草稿预占优先级编辑回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '跨草稿预占优先级编辑回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '跨草稿预占优先级编辑回归仓库',
      locationCode,
      locationName: '跨草稿预占优先级编辑回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '跨草稿预占优先级编辑回归零件',
        quantity: batchQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: firstOrderNo,
        orderDate: '2026-07-08',
        lines: [stockLine(stockBatch, originalFirstQuantity, '回归验证第一个草稿先合法占用 2')]
      })
    });
    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: secondOrderNo,
        orderDate: '2026-07-08',
        lines: [stockLine(stockBatch, secondQuantity, '回归验证第二个草稿在剩余库存内合法占用 2')]
      })
    });

    const firstDraftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: firstOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    const secondDraftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: secondOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(firstDraftOrder?.id && secondDraftOrder?.id, '跨草稿预占优先级编辑必须先生成两个 DRAFT 订单');
    const firstDraftLine = firstDraftOrder.lines[0];
    const secondDraftLine = secondDraftOrder.lines[0];
    const firstReservationBeforeEdit = await prisma.inventoryReservation.findFirst({
      where: { orderId: firstDraftOrder.id, orderLineId: firstDraftLine.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    const secondReservationBeforeEdit = await prisma.inventoryReservation.findFirst({
      where: { orderId: secondDraftOrder.id, orderLineId: secondDraftLine.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    assert(Number(firstReservationBeforeEdit?.quantity) === originalFirstQuantity, `跨草稿预占优先级编辑前第一个草稿预占应为 ${originalFirstQuantity}，实际 ${firstReservationBeforeEdit?.quantity}`);
    assert(Number(secondReservationBeforeEdit?.quantity) === secondQuantity, `跨草稿预占优先级编辑前第二个草稿预占应为 ${secondQuantity}，实际 ${secondReservationBeforeEdit?.quantity}`);
    const secondReservationCreatedAt = secondReservationBeforeEdit.createdAt.getTime();

    await requestJson(`/orders/${encodeURIComponent(firstOrderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo: firstOrderNo,
        lines: [stockLine(stockBatch, increasedFirstQuantity, '回归验证较早草稿按优先级提高预占到 4')]
      })
    });

    const firstReservationsAfterEdit = await prisma.inventoryReservation.findMany({
      where: { orderId: firstDraftOrder.id, batchId: stockBatch.id, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const firstReservedQuantityAfterEdit = firstReservationsAfterEdit.reduce((sum, reservation) => sum + Number(reservation.quantity), 0);
    assert(firstReservedQuantityAfterEdit === increasedFirstQuantity, `较早草稿提高预占后 ACTIVE InventoryReservation 合计应为 ${increasedFirstQuantity}，实际 ${firstReservedQuantityAfterEdit}`);
    const secondReservationAfterFirstEdit = await prisma.inventoryReservation.findUnique({ where: { id: secondReservationBeforeEdit.id } });
    assert(secondReservationAfterFirstEdit?.status === 'ACTIVE', `较早草稿提高预占后较晚草稿预占仍应保持 ACTIVE，实际 ${secondReservationAfterFirstEdit?.status}`);
    assert(Number(secondReservationAfterFirstEdit?.quantity) === secondQuantity, `较早草稿提高预占后较晚草稿预占数量必须仍为 ${secondQuantity}，实际 ${secondReservationAfterFirstEdit?.quantity}`);
    assert(secondReservationAfterFirstEdit?.createdAt.getTime() === secondReservationCreatedAt, '较早草稿提高预占后较晚草稿预占 createdAt 不得变化');

    await expectRequestFailure(
      `/orders/${encodeURIComponent(secondOrderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      `已选库存批次 ${stockBatch.batchNo} 的使用数量超过当前可用库存`
    );

    const firstOrderAfterRejectedSecondSubmit = await prisma.customerOrder.findUnique({ where: { id: firstDraftOrder.id } });
    const secondOrderAfterRejectedSubmit = await prisma.customerOrder.findUnique({ where: { id: secondDraftOrder.id } });
    assert(firstOrderAfterRejectedSecondSubmit?.status === 'DRAFT', `较晚草稿提交失败后较早草稿必须保持 DRAFT，实际 ${firstOrderAfterRejectedSecondSubmit?.status}`);
    assert(secondOrderAfterRejectedSubmit?.status === 'DRAFT', `较晚草稿提交失败后自身必须保持 DRAFT，实际 ${secondOrderAfterRejectedSubmit?.status}`);
    const firstReservationsAfterRejectedSecondSubmit = await prisma.inventoryReservation.findMany({
      where: { orderId: firstDraftOrder.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    assert(
      firstReservationsAfterRejectedSecondSubmit.reduce((sum, reservation) => sum + Number(reservation.quantity), 0) === increasedFirstQuantity,
      '较晚草稿提交失败后较早草稿 ACTIVE InventoryReservation 合计必须保持提高后的数量'
    );
    const secondReservationAfterRejectedSubmit = await prisma.inventoryReservation.findUnique({ where: { id: secondReservationBeforeEdit.id } });
    assert(secondReservationAfterRejectedSubmit?.status === 'ACTIVE', `较晚草稿提交失败后自身预占必须保持 ACTIVE，实际 ${secondReservationAfterRejectedSubmit?.status}`);
    assert(Number(secondReservationAfterRejectedSubmit?.quantity) === secondQuantity, `较晚草稿提交失败后自身预占数量必须保持 ${secondQuantity}，实际 ${secondReservationAfterRejectedSubmit?.quantity}`);
    assert(!secondReservationAfterRejectedSubmit?.releasedAt, '较晚草稿提交失败后自身预占不得释放');
    assert(!secondReservationAfterRejectedSubmit?.consumedAt, '较晚草稿提交失败后自身预占不得消费');
    const batchAfterRejectedSecondSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterRejectedSecondSubmit?.quantity) === batchQuantity, `较晚草稿提交失败后原库存批次数量必须保持 ${batchQuantity}，实际 ${batchAfterRejectedSecondSubmit?.quantity}`);
    assert(batchAfterRejectedSecondSubmit?.status === 'AVAILABLE', `较晚草稿提交失败后原库存批次必须保持 AVAILABLE，实际 ${batchAfterRejectedSecondSubmit?.status}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `较晚草稿提交失败后不得生成 InventoryTransaction，实际 ${transactionCount}`);
    const orderBatchCount = await prisma.inventoryBatch.count({
      where: { sourceOrderId: secondDraftOrder.id, sourceOrderLineId: secondDraftLine.id, sourceOrderNo: secondOrderNo, partCode }
    });
    assert(orderBatchCount === 0, `较晚草稿提交失败后不得生成订单待发货库存批次，实际 ${orderBatchCount}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { in: [firstOrderNo, secondOrderNo] } } });
    assert(taskCount === 0, `较晚草稿提交失败后不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupStockReservationPriorityEditCase();
    await prisma.$disconnect();
  }
}

async function assertEarlierDraftSubmitWinsPriorityBeforeLaterDraftReservation() {
  const prisma = new PrismaClient();
  const firstOrderNo = `${orderPrefix}-STOCK-PRIORITY-SUBMIT-FIRST`;
  const secondOrderNo = `${orderPrefix}-STOCK-PRIORITY-SUBMIT-SECOND`;
  const customerCode = `${orderPrefix}-STOCK-PRIORITY-SUBMIT-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-PRIORITY-SUBMIT-WH`;
  const locationCode = `${orderPrefix}-STOCK-PRIORITY-SUBMIT-LOC`;
  const partCode = `${materialPrefix}-STOCK-PRIORITY-SUBMIT`;
  const batchNo = `${orderPrefix}-STOCK-PRIORITY-SUBMIT-BATCH`;
  const batchQuantity = 5;
  const originalFirstQuantity = 2;
  const secondQuantity = 2;
  const increasedFirstQuantity = 4;

  async function cleanupStockReservationPrioritySubmitCase() {
    const orderNos = [firstOrderNo, secondOrderNo];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function stockLine(stockBatch, quantity, remark) {
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel: '跨草稿预占优先级提交',
      partCode,
      partName: '跨草稿预占优先级提交回归零件',
      drawingNo: `VERIFY-${runId}-STOCK-PRIORITY-SUBMIT`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件',
      selectedStockSources: [
        {
          batchId: stockBatch.id,
          batchNo: stockBatch.batchNo,
          partCode,
          partName: stockBatch.partName,
          quantity,
          unit: stockBatch.unit,
          compatibilityStatus: 'MATCHED',
          compatibilityReason: '同一备货库存批次，用于验证跨订单库存预占扣除',
          manualConfirmedBy: 'verify-stock-reservation-priority-submit',
          manualConfirmedAt: '2026-07-09T08:00:00.000Z',
          manualConfirmRemark: remark
        }
      ]
    };
  }

  try {
    await cleanupStockReservationPrioritySubmitCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '跨草稿预占优先级提交回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '跨草稿预占优先级提交回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '跨草稿预占优先级提交回归仓库',
      locationCode,
      locationName: '跨草稿预占优先级提交回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '跨草稿预占优先级提交回归零件',
        quantity: batchQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: firstOrderNo,
        orderDate: '2026-07-09',
        lines: [stockLine(stockBatch, originalFirstQuantity, '回归验证较早草稿先合法占用 2')]
      })
    });
    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: secondOrderNo,
        orderDate: '2026-07-09',
        lines: [stockLine(stockBatch, secondQuantity, '回归验证较晚草稿在剩余库存内合法占用 2')]
      })
    });

    const firstDraftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: firstOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    const secondDraftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: secondOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(firstDraftOrder?.id && secondDraftOrder?.id, '跨草稿预占优先级提交必须先生成两个 DRAFT 订单');
    const firstOriginalLine = firstDraftOrder.lines[0];
    const secondDraftLine = secondDraftOrder.lines[0];
    const secondReservationBeforeFirstSubmit = await prisma.inventoryReservation.findFirst({
      where: { orderId: secondDraftOrder.id, orderLineId: secondDraftLine.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    assert(Number(secondReservationBeforeFirstSubmit?.quantity) === secondQuantity, `跨草稿预占优先级提交前较晚草稿预占应为 ${secondQuantity}，实际 ${secondReservationBeforeFirstSubmit?.quantity}`);

    await requestJson(`/orders/${encodeURIComponent(firstOrderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo: firstOrderNo,
        lines: [stockLine(stockBatch, increasedFirstQuantity, '回归验证较早草稿按优先级提高预占到 4 后提交')]
      })
    });
    const firstOrderAfterEdit = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: firstOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    const firstEditedLine = firstOrderAfterEdit.lines[0];
    const firstReservationsAfterEdit = await prisma.inventoryReservation.findMany({
      where: { orderId: firstOrderAfterEdit.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    assert(
      firstReservationsAfterEdit.reduce((sum, reservation) => sum + Number(reservation.quantity), 0) === increasedFirstQuantity,
      '较早草稿提交前 ACTIVE InventoryReservation 合计必须是提高后的 4'
    );

    await requestJson(`/orders/${encodeURIComponent(firstOrderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });

    const firstOrderAfterSubmit = await prisma.customerOrder.findUnique({ where: { id: firstOrderAfterEdit.id } });
    assert(firstOrderAfterSubmit?.status === 'PENDING_PRODUCTION', `较早草稿提交后必须进入 PENDING_PRODUCTION，实际 ${firstOrderAfterSubmit?.status}`);
    const firstActiveReservationCountAfterSubmit = await prisma.inventoryReservation.count({
      where: { orderId: firstOrderAfterEdit.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    assert(firstActiveReservationCountAfterSubmit === 0, `较早草稿提交后不得保留 ACTIVE InventoryReservation，实际 ${firstActiveReservationCountAfterSubmit}`);
    const firstConsumedReservationsAfterSubmit = await prisma.inventoryReservation.findMany({
      where: { orderId: firstOrderAfterEdit.id, batchId: stockBatch.id, status: 'CONSUMED' }
    });
    assert(
      firstConsumedReservationsAfterSubmit.reduce((sum, reservation) => sum + Number(reservation.quantity), 0) === increasedFirstQuantity &&
        firstConsumedReservationsAfterSubmit.every((reservation) => reservation.consumedAt),
      `较早草稿提交后 CONSUMED InventoryReservation 合计必须为 ${increasedFirstQuantity}`
    );
    const secondReservationAfterFirstSubmit = await prisma.inventoryReservation.findUnique({ where: { id: secondReservationBeforeFirstSubmit.id } });
    assert(secondReservationAfterFirstSubmit?.status === 'ACTIVE', `较早草稿提交后较晚草稿预占仍应保持 ACTIVE，实际 ${secondReservationAfterFirstSubmit?.status}`);
    assert(Number(secondReservationAfterFirstSubmit?.quantity) === secondQuantity, `较早草稿提交后较晚草稿预占数量必须保持 ${secondQuantity}，实际 ${secondReservationAfterFirstSubmit?.quantity}`);
    const batchAfterFirstSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterFirstSubmit?.quantity) === batchQuantity - increasedFirstQuantity, `较早草稿提交后原库存批次数量应剩余 ${batchQuantity - increasedFirstQuantity}，实际 ${batchAfterFirstSubmit?.quantity}`);
    assert(batchAfterFirstSubmit?.status === 'AVAILABLE', `较早草稿提交后原库存批次仍应为 AVAILABLE，实际 ${batchAfterFirstSubmit?.status}`);
    const firstOrderBatch = await prisma.inventoryBatch.findUnique({ where: { batchNo: `IB-ALLOC-${firstOrderNo}-001-01` } });
    assert(firstOrderBatch?.sourceOrderLineId === firstEditedLine.id, `较早草稿提交后订单库存批次必须关联较早订单行，实际 ${firstOrderBatch?.sourceOrderLineId}`);
    assert(Number(firstOrderBatch?.quantity) === increasedFirstQuantity, `较早草稿提交后订单库存批次数量应为 ${increasedFirstQuantity}，实际 ${firstOrderBatch?.quantity}`);
    const firstOutTransaction = await prisma.inventoryTransaction.findFirst({
      where: { partCode, transactionType: 'OUT', orderLineId: firstEditedLine.id }
    });
    assert(Number(firstOutTransaction?.quantity) === increasedFirstQuantity, `较早草稿提交后 OUT InventoryTransaction 数量应为 ${increasedFirstQuantity}，实际 ${firstOutTransaction?.quantity}`);

    await expectRequestFailure(
      `/orders/${encodeURIComponent(secondOrderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      `已选库存批次 ${stockBatch.batchNo} 的使用数量超过当前可用库存`
    );

    const secondOrderAfterRejectedSubmit = await prisma.customerOrder.findUnique({ where: { id: secondDraftOrder.id } });
    assert(secondOrderAfterRejectedSubmit?.status === 'DRAFT', `较晚草稿提交失败后自身必须保持 DRAFT，实际 ${secondOrderAfterRejectedSubmit?.status}`);
    const secondReservationAfterRejectedSubmit = await prisma.inventoryReservation.findUnique({ where: { id: secondReservationBeforeFirstSubmit.id } });
    assert(secondReservationAfterRejectedSubmit?.status === 'ACTIVE', `较晚草稿提交失败后自身预占必须保持 ACTIVE，实际 ${secondReservationAfterRejectedSubmit?.status}`);
    assert(Number(secondReservationAfterRejectedSubmit?.quantity) === secondQuantity, `较晚草稿提交失败后自身预占数量必须保持 ${secondQuantity}，实际 ${secondReservationAfterRejectedSubmit?.quantity}`);
    assert(!secondReservationAfterRejectedSubmit?.releasedAt, '较晚草稿提交失败后自身预占不得释放');
    assert(!secondReservationAfterRejectedSubmit?.consumedAt, '较晚草稿提交失败后自身预占不得消费');
    const batchAfterRejectedSecondSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterRejectedSecondSubmit?.quantity) === batchQuantity - increasedFirstQuantity, `较晚草稿提交失败后原库存批次数量必须仍为 ${batchQuantity - increasedFirstQuantity}，实际 ${batchAfterRejectedSecondSubmit?.quantity}`);
    const secondOrderBatchCount = await prisma.inventoryBatch.count({
      where: { sourceOrderId: secondDraftOrder.id, sourceOrderLineId: secondDraftLine.id, sourceOrderNo: secondOrderNo, partCode }
    });
    assert(secondOrderBatchCount === 0, `较晚草稿提交失败后不得生成第二订单待发货库存批次，实际 ${secondOrderBatchCount}`);
    const transactionCountAfterRejectedSecondSubmit = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCountAfterRejectedSecondSubmit === 2, `较晚草稿提交失败后只能保留较早草稿的 OUT/IN InventoryTransaction，实际 ${transactionCountAfterRejectedSecondSubmit}`);
    const secondTaskCount = await prisma.productionTask.count({ where: { orderNo: { equals: secondOrderNo, mode: 'insensitive' } } });
    assert(secondTaskCount === 0, `较晚草稿提交失败后不得生成 ProductionTask，实际 ${secondTaskCount}`);
  } finally {
    await cleanupStockReservationPrioritySubmitCase();
    await prisma.$disconnect();
  }
}

async function assertLaterDraftSubmitSucceedsAfterEarlierDraftConsumesStock() {
  const prisma = new PrismaClient();
  const firstOrderNo = `${orderPrefix}-STOCK-PRIORITY-CHAIN-FIRST`;
  const secondOrderNo = `${orderPrefix}-STOCK-PRIORITY-CHAIN-SECOND`;
  const customerCode = `${orderPrefix}-STOCK-PRIORITY-CHAIN-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-PRIORITY-CHAIN-WH`;
  const locationCode = `${orderPrefix}-STOCK-PRIORITY-CHAIN-LOC`;
  const partCode = `${materialPrefix}-STOCK-PRIORITY-CHAIN`;
  const batchNo = `${orderPrefix}-STOCK-PRIORITY-CHAIN-BATCH`;
  const batchQuantity = 5;
  const firstQuantity = 4;
  const secondQuantity = 1;

  async function cleanupStockReservationPriorityChainCase() {
    const orderNos = [firstOrderNo, secondOrderNo];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function stockLine(stockBatch, quantity, remark) {
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel: '跨草稿预占顺序提交',
      partCode,
      partName: '跨草稿预占顺序提交回归零件',
      drawingNo: `VERIFY-${runId}-STOCK-PRIORITY-CHAIN`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件',
      selectedStockSources: [
        {
          batchId: stockBatch.id,
          batchNo: stockBatch.batchNo,
          partCode,
          partName: stockBatch.partName,
          quantity,
          unit: stockBatch.unit,
          compatibilityStatus: 'MATCHED',
          compatibilityReason: '同一备货库存批次，用于验证跨订单库存预占扣除',
          manualConfirmedBy: 'verify-stock-reservation-priority-chain',
          manualConfirmedAt: '2026-07-10T08:00:00.000Z',
          manualConfirmRemark: remark
        }
      ]
    };
  }

  try {
    await cleanupStockReservationPriorityChainCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '跨草稿预占顺序提交回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '跨草稿预占顺序提交回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '跨草稿预占顺序提交回归仓库',
      locationCode,
      locationName: '跨草稿预占顺序提交回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '跨草稿预占顺序提交回归零件',
        quantity: batchQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: firstOrderNo,
        orderDate: '2026-07-10',
        lines: [stockLine(stockBatch, firstQuantity, '回归验证较早草稿先占用 4')]
      })
    });
    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: secondOrderNo,
        orderDate: '2026-07-10',
        lines: [stockLine(stockBatch, secondQuantity, '回归验证较晚草稿只占用剩余 1')]
      })
    });

    const firstDraftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: firstOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    const secondDraftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: secondOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(firstDraftOrder?.id && secondDraftOrder?.id, '跨草稿预占顺序提交必须先生成两个 DRAFT 订单');
    const firstLine = firstDraftOrder.lines[0];
    const secondLine = secondDraftOrder.lines[0];
    const firstReservationBeforeSubmit = await prisma.inventoryReservation.findFirst({
      where: { orderId: firstDraftOrder.id, orderLineId: firstLine.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    const secondReservationBeforeSubmit = await prisma.inventoryReservation.findFirst({
      where: { orderId: secondDraftOrder.id, orderLineId: secondLine.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    assert(Number(firstReservationBeforeSubmit?.quantity) === firstQuantity, `跨草稿顺序提交前较早草稿预占应为 ${firstQuantity}，实际 ${firstReservationBeforeSubmit?.quantity}`);
    assert(Number(secondReservationBeforeSubmit?.quantity) === secondQuantity, `跨草稿顺序提交前较晚草稿预占应为 ${secondQuantity}，实际 ${secondReservationBeforeSubmit?.quantity}`);

    await requestJson(`/orders/${encodeURIComponent(firstOrderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });

    const firstOrderAfterSubmit = await prisma.customerOrder.findUnique({ where: { id: firstDraftOrder.id } });
    assert(firstOrderAfterSubmit?.status === 'PENDING_PRODUCTION', `跨草稿顺序提交较早订单提交后必须进入 PENDING_PRODUCTION，实际 ${firstOrderAfterSubmit?.status}`);
    const firstReservationAfterSubmit = await prisma.inventoryReservation.findUnique({ where: { id: firstReservationBeforeSubmit.id } });
    assert(firstReservationAfterSubmit?.status === 'CONSUMED' && firstReservationAfterSubmit.consumedAt, `跨草稿顺序提交较早预占必须转为 CONSUMED，实际 ${firstReservationAfterSubmit?.status}`);
    const secondReservationAfterFirstSubmit = await prisma.inventoryReservation.findUnique({ where: { id: secondReservationBeforeSubmit.id } });
    assert(secondReservationAfterFirstSubmit?.status === 'ACTIVE', `较早草稿提交后较晚草稿预占必须保持 ACTIVE，实际 ${secondReservationAfterFirstSubmit?.status}`);
    assert(Number(secondReservationAfterFirstSubmit?.quantity) === secondQuantity, `较早草稿提交后较晚草稿预占数量必须保持 ${secondQuantity}，实际 ${secondReservationAfterFirstSubmit?.quantity}`);
    const batchAfterFirstSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterFirstSubmit?.quantity) === secondQuantity, `较早草稿提交后原库存批次应剩余 ${secondQuantity}，实际 ${batchAfterFirstSubmit?.quantity}`);
    assert(batchAfterFirstSubmit?.status === 'AVAILABLE', `较早草稿提交后原库存批次仍应 AVAILABLE，实际 ${batchAfterFirstSubmit?.status}`);

    await requestJson(`/orders/${encodeURIComponent(secondOrderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });

    const secondOrderAfterSubmit = await prisma.customerOrder.findUnique({ where: { id: secondDraftOrder.id } });
    assert(secondOrderAfterSubmit?.status === 'PENDING_PRODUCTION', `跨草稿顺序提交较晚订单提交后必须进入 PENDING_PRODUCTION，实际 ${secondOrderAfterSubmit?.status}`);
    const secondReservationAfterSubmit = await prisma.inventoryReservation.findUnique({ where: { id: secondReservationBeforeSubmit.id } });
    assert(secondReservationAfterSubmit?.status === 'CONSUMED' && secondReservationAfterSubmit.consumedAt, `跨草稿顺序提交较晚预占必须转为 CONSUMED，实际 ${secondReservationAfterSubmit?.status}`);
    const batchAfterSecondSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterSecondSubmit?.quantity) === 0, `较晚草稿提交后原库存批次数量必须为 0，实际 ${batchAfterSecondSubmit?.quantity}`);
    assert(batchAfterSecondSubmit?.status === 'USED', `较晚草稿提交后原库存批次必须转为 USED，实际 ${batchAfterSecondSubmit?.status}`);

    const firstOrderBatch = await prisma.inventoryBatch.findUnique({ where: { batchNo: `IB-ALLOC-${firstOrderNo}-001-01` } });
    const secondOrderBatch = await prisma.inventoryBatch.findUnique({ where: { batchNo: `IB-ALLOC-${secondOrderNo}-001-01` } });
    assert(firstOrderBatch?.sourceOrderLineId === firstLine.id, `较早草稿提交后订单库存批次必须关联较早订单行，实际 ${firstOrderBatch?.sourceOrderLineId}`);
    assert(Number(firstOrderBatch?.quantity) === firstQuantity, `较早草稿订单库存批次数量应为 ${firstQuantity}，实际 ${firstOrderBatch?.quantity}`);
    assert(secondOrderBatch?.sourceOrderLineId === secondLine.id, `较晚草稿提交后订单库存批次必须关联较晚订单行，实际 ${secondOrderBatch?.sourceOrderLineId}`);
    assert(Number(secondOrderBatch?.quantity) === secondQuantity, `较晚草稿订单库存批次数量应为 ${secondQuantity}，实际 ${secondOrderBatch?.quantity}`);

    const outTransactions = await prisma.inventoryTransaction.findMany({
      where: { partCode, transactionType: 'OUT' },
      orderBy: { transactionNo: 'asc' }
    });
    const inTransactions = await prisma.inventoryTransaction.findMany({
      where: { partCode, transactionType: 'IN' },
      orderBy: { transactionNo: 'asc' }
    });
    assert(outTransactions.length === 2, `跨草稿顺序提交应生成 2 条 OUT InventoryTransaction，实际 ${outTransactions.length}`);
    assert(inTransactions.length === 2, `跨草稿顺序提交应生成 2 条 IN InventoryTransaction，实际 ${inTransactions.length}`);
    assert(Number(outTransactions[0].quantity) === firstQuantity, `跨草稿顺序提交第 1 条 OUT 数量应为 ${firstQuantity}，实际 ${outTransactions[0].quantity}`);
    assert(Number(outTransactions[1].quantity) === secondQuantity, `跨草稿顺序提交第 2 条 OUT 数量应为 ${secondQuantity}，实际 ${outTransactions[1].quantity}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { in: [firstOrderNo, secondOrderNo] } } });
    assert(taskCount === 0, `跨草稿顺序提交全库存覆盖不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupStockReservationPriorityChainCase();
    await prisma.$disconnect();
  }
}

async function assertDraftStockReservationPriorityUsesOrderNoTieBreaker() {
  const prisma = new PrismaClient();
  const lowerOrderNo = `${orderPrefix}-STOCK-PRIORITY-TIE-A`;
  const higherOrderNo = `${orderPrefix}-STOCK-PRIORITY-TIE-B`;
  const customerCode = `${orderPrefix}-STOCK-PRIORITY-TIE-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-PRIORITY-TIE-WH`;
  const locationCode = `${orderPrefix}-STOCK-PRIORITY-TIE-LOC`;
  const partCode = `${materialPrefix}-STOCK-PRIORITY-TIE`;
  const batchNo = `${orderPrefix}-STOCK-PRIORITY-TIE-BATCH`;
  const batchQuantity = 5;
  const originalQuantity = 2;
  const lowerPriorityQuantity = 4;
  const lowerFullReservationQuantity = batchQuantity;
  const higherPriorityQuantity = 2;
  const priorityTime = new Date('2026-07-11T08:00:00.000Z');

  async function cleanupStockReservationPriorityTieCase() {
    const orderNos = [lowerOrderNo, higherOrderNo];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function stockLine(stockBatch, quantity, remark) {
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel: '同时间草稿预占优先级',
      partCode,
      partName: '同时间草稿预占优先级回归零件',
      drawingNo: `VERIFY-${runId}-STOCK-PRIORITY-TIE`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件',
      selectedStockSources: [
        {
          batchId: stockBatch.id,
          batchNo: stockBatch.batchNo,
          partCode,
          partName: stockBatch.partName,
          quantity,
          unit: stockBatch.unit,
          compatibilityStatus: 'MATCHED',
          compatibilityReason: '同一备货库存批次，用于验证 createdAt 相同时按 orderNo 稳定扣减预占',
          manualConfirmedBy: 'verify-stock-reservation-priority-tie',
          manualConfirmedAt: '2026-07-11T08:00:00.000Z',
          manualConfirmRemark: remark
        }
      ]
    };
  }

  try {
    await cleanupStockReservationPriorityTieCase();
    assert(lowerOrderNo.localeCompare(higherOrderNo) < 0, '同时间草稿预占优先级测试必须保证 A 订单号小于 B 订单号');
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '同时间草稿预占优先级回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '同时间草稿预占优先级回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '同时间草稿预占优先级回归仓库',
      locationCode,
      locationName: '同时间草稿预占优先级回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '同时间草稿预占优先级回归零件',
        quantity: batchQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: lowerOrderNo,
        orderDate: '2026-07-11',
        lines: [stockLine(stockBatch, originalQuantity, '回归验证同时间较小 orderNo 初始预占 2')]
      })
    });
    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: higherOrderNo,
        orderDate: '2026-07-11',
        lines: [stockLine(stockBatch, higherPriorityQuantity, '回归验证同时间较大 orderNo 初始预占 2')]
      })
    });

    const lowerDraftOrderBeforeTie = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: lowerOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    const higherDraftOrderBeforeTie = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: higherOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(lowerDraftOrderBeforeTie?.id && higherDraftOrderBeforeTie?.id, '同时间草稿预占优先级测试必须先生成两个 DRAFT 订单');
    await prisma.customerOrder.updateMany({
      where: { id: { in: [lowerDraftOrderBeforeTie.id, higherDraftOrderBeforeTie.id] } },
      data: { createdAt: priorityTime }
    });

    const lowerDraftOrder = await prisma.customerOrder.findUnique({
      where: { id: lowerDraftOrderBeforeTie.id },
      include: { lines: true }
    });
    const higherDraftOrder = await prisma.customerOrder.findUnique({
      where: { id: higherDraftOrderBeforeTie.id },
      include: { lines: true }
    });
    assert(
      lowerDraftOrder?.createdAt.getTime() === priorityTime.getTime() &&
        higherDraftOrder?.createdAt.getTime() === priorityTime.getTime(),
      '同时间草稿预占优先级必须把两个 DRAFT 的 createdAt 调整为完全相同'
    );
    const higherLine = higherDraftOrder.lines[0];
    const higherReservationBeforeEdit = await prisma.inventoryReservation.findFirst({
      where: { orderId: higherDraftOrder.id, orderLineId: higherLine.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    assert(Number(higherReservationBeforeEdit?.quantity) === higherPriorityQuantity, `同时间较大订单号初始预占应为 ${higherPriorityQuantity}，实际 ${higherReservationBeforeEdit?.quantity}`);

    await requestJson(`/orders/${encodeURIComponent(lowerOrderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo: lowerOrderNo,
        lines: [stockLine(stockBatch, lowerPriorityQuantity, '回归验证同时间较小 orderNo 按优先级提高预占到 4')]
      })
    });

    const lowerOrderAfterEdit = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: lowerOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    const lowerLineAfterEdit = lowerOrderAfterEdit.lines[0];
    const lowerReservationsAfterEdit = await prisma.inventoryReservation.findMany({
      where: { orderId: lowerOrderAfterEdit.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    assert(
      lowerReservationsAfterEdit.reduce((sum, reservation) => sum + Number(reservation.quantity), 0) === lowerPriorityQuantity,
      `同时间较小订单号提高预占后 ACTIVE InventoryReservation 合计必须为 ${lowerPriorityQuantity}`
    );
    const higherReservationAfterLowerEdit = await prisma.inventoryReservation.findUnique({ where: { id: higherReservationBeforeEdit.id } });
    assert(higherReservationAfterLowerEdit?.status === 'ACTIVE', `同时间较小订单号提高预占后较大订单号预占必须保持 ACTIVE，实际 ${higherReservationAfterLowerEdit?.status}`);
    assert(Number(higherReservationAfterLowerEdit?.quantity) === higherPriorityQuantity, `同时间较小订单号提高预占后较大订单号预占数量必须仍为 ${higherPriorityQuantity}，实际 ${higherReservationAfterLowerEdit?.quantity}`);

    const lowerSourceDetails = await requestJson(
      `/inventory/materials/${encodeURIComponent(partCode)}/source-details?sourceType=STOCK&excludeOrderNo=${encodeURIComponent(lowerOrderNo)}`
    );
    const lowerSourceBatch = lowerSourceDetails.sources?.find((source) => source.id === stockBatch.id);
    assert(lowerSourceBatch, '同时间较小订单号库存来源明细必须返回原备货批次');
    assert(Number(lowerSourceBatch.quantity) === batchQuantity, `同时间较小订单号库存来源明细不应扣除较大订单号预占，可用量应为 ${batchQuantity}，实际 ${lowerSourceBatch.quantity}`);
    assert(Number(lowerSourceBatch.reservedQuantity || 0) === 0, `同时间较小订单号库存来源明细 reservedQuantity 应为 0，实际 ${lowerSourceBatch.reservedQuantity}`);
    assert(Number(lowerSourceDetails.availableQuantity) === batchQuantity, `同时间较小订单号库存来源明细汇总可用量应为 ${batchQuantity}，实际 ${lowerSourceDetails.availableQuantity}`);

    const higherSourceDetails = await requestJson(
      `/inventory/materials/${encodeURIComponent(partCode)}/source-details?sourceType=STOCK&excludeOrderNo=${encodeURIComponent(higherOrderNo)}`
    );
    const higherSourceBatch = higherSourceDetails.sources?.find((source) => source.id === stockBatch.id);
    const higherReservedQuantity = (higherSourceBatch?.reservations || []).reduce((sum, reservation) => sum + Number(reservation.quantity || 0), 0);
    assert(higherSourceBatch, '同时间较大订单号库存来源明细必须返回原备货批次');
    assert(
      Number(higherSourceBatch.quantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单号库存来源明细必须扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherSourceBatch.quantity}`
    );
    assert(
      Number(higherSourceBatch.reservedQuantity || 0) === lowerPriorityQuantity,
      `同时间较大订单号库存来源明细 reservedQuantity 应为 ${lowerPriorityQuantity}，实际 ${higherSourceBatch.reservedQuantity}`
    );
    assert(
      higherReservedQuantity === lowerPriorityQuantity &&
        (higherSourceBatch.reservations || []).every((reservation) => reservation.orderNo === lowerOrderNo),
      '同时间较大订单号库存来源明细只能把较小订单号预占计入占用'
    );
    assert(
      Number(higherSourceDetails.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单号库存来源明细汇总可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherSourceDetails.availableQuantity}`
    );

    const lowerSummaryRows = pageItems(
      await requestJson(`/inventory/summary?keyword=${encodeURIComponent(partCode)}&excludeOrderNo=${encodeURIComponent(lowerOrderNo)}&includeTestFixtures=true`)
    );
    const lowerSummaryRow = lowerSummaryRows.find((row) => row.partCode === partCode);
    assert(lowerSummaryRow, '同时间较小订单号库存汇总必须返回当前零件');
    assert(Number(lowerSummaryRow.availableQuantity) === batchQuantity, `同时间较小订单号库存汇总不应扣除较大订单号预占，可用量应为 ${batchQuantity}，实际 ${lowerSummaryRow.availableQuantity}`);
    assert(Number(lowerSummaryRow.reservedQuantity || 0) === 0, `同时间较小订单号库存汇总 reservedQuantity 应为 0，实际 ${lowerSummaryRow.reservedQuantity}`);

    const higherSummaryRows = pageItems(
      await requestJson(`/inventory/summary?keyword=${encodeURIComponent(partCode)}&excludeOrderNo=${encodeURIComponent(higherOrderNo)}&includeTestFixtures=true`)
    );
    const higherSummaryRow = higherSummaryRows.find((row) => row.partCode === partCode);
    assert(higherSummaryRow, '同时间较大订单号库存汇总必须返回当前零件');
    assert(
      Number(higherSummaryRow.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单号库存汇总必须扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherSummaryRow.availableQuantity}`
    );
    assert(Number(higherSummaryRow.reservedQuantity || 0) === lowerPriorityQuantity, `同时间较大订单号库存汇总 reservedQuantity 应为 ${lowerPriorityQuantity}，实际 ${higherSummaryRow.reservedQuantity}`);

    const lowerInventoryRows = pageItems(
      await requestJson(`/inventory?keyword=${encodeURIComponent(partCode)}&excludeOrderNo=${encodeURIComponent(lowerOrderNo)}&includeTestFixtures=true`)
    );
    const lowerInventoryBatch = lowerInventoryRows.find((row) => row.id === stockBatch.id);
    assert(lowerInventoryBatch, '同时间较小订单号库存列表必须返回原备货批次');
    assert(Number(lowerInventoryBatch.availableQuantity) === batchQuantity, `同时间较小订单号库存列表不应扣除较大订单号预占，可用量应为 ${batchQuantity}，实际 ${lowerInventoryBatch.availableQuantity}`);
    assert(Number(lowerInventoryBatch.reservedQuantity || 0) === 0, `同时间较小订单号库存列表 reservedQuantity 应为 0，实际 ${lowerInventoryBatch.reservedQuantity}`);

    const higherInventoryRows = pageItems(
      await requestJson(`/inventory?keyword=${encodeURIComponent(partCode)}&excludeOrderNo=${encodeURIComponent(higherOrderNo)}&includeTestFixtures=true`)
    );
    const higherInventoryBatch = higherInventoryRows.find((row) => row.id === stockBatch.id);
    const higherInventoryReservedQuantity = (higherInventoryBatch?.reservations || []).reduce((sum, reservation) => sum + Number(reservation.quantity || 0), 0);
    assert(higherInventoryBatch, '同时间较大订单号库存列表必须返回原备货批次');
    assert(
      Number(higherInventoryBatch.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单号库存列表必须扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherInventoryBatch.availableQuantity}`
    );
    assert(Number(higherInventoryBatch.reservedQuantity || 0) === lowerPriorityQuantity, `同时间较大订单号库存列表 reservedQuantity 应为 ${lowerPriorityQuantity}，实际 ${higherInventoryBatch.reservedQuantity}`);
    assert(
      higherInventoryReservedQuantity === lowerPriorityQuantity &&
        (higherInventoryBatch.reservations || []).every((reservation) => reservation.orderNo === lowerOrderNo),
      '同时间较大订单号库存列表只能把较小订单号预占计入占用'
    );

    const lowerMaterialSuggestions = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&sourceType=STOCK&excludeOrderNo=${encodeURIComponent(lowerOrderNo)}`
    );
    const lowerMaterialSuggestion = lowerMaterialSuggestions.find((row) => row.partCode === partCode);
    assert(lowerMaterialSuggestion, '同时间较小订单号物料建议必须返回当前零件');
    assert(Number(lowerMaterialSuggestion.availableQuantity) === batchQuantity, `同时间较小订单号物料建议不应扣除较大订单号预占，可用量应为 ${batchQuantity}，实际 ${lowerMaterialSuggestion.availableQuantity}`);
    assert(Number(lowerMaterialSuggestion.stockInventoryQuantity || 0) === batchQuantity, `同时间较小订单号物料建议备货库存应为 ${batchQuantity}，实际 ${lowerMaterialSuggestion.stockInventoryQuantity}`);
    assert(Number(lowerMaterialSuggestion.orderInventoryQuantity || 0) === 0, `同时间较小订单号物料建议订单库存应为 0，实际 ${lowerMaterialSuggestion.orderInventoryQuantity}`);

    const higherMaterialSuggestions = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&sourceType=STOCK&excludeOrderNo=${encodeURIComponent(higherOrderNo)}`
    );
    const higherMaterialSuggestion = higherMaterialSuggestions.find((row) => row.partCode === partCode);
    assert(higherMaterialSuggestion, '同时间较大订单号物料建议必须返回当前零件');
    assert(
      Number(higherMaterialSuggestion.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单号物料建议必须扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherMaterialSuggestion.availableQuantity}`
    );
    assert(
      Number(higherMaterialSuggestion.stockInventoryQuantity || 0) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单号物料建议备货库存应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherMaterialSuggestion.stockInventoryQuantity}`
    );
    assert(Number(higherMaterialSuggestion.orderInventoryQuantity || 0) === 0, `同时间较大订单号物料建议订单库存应为 0，实际 ${higherMaterialSuggestion.orderInventoryQuantity}`);

    const higherSourceDetailsById = await requestJson(
      `/inventory/materials/${encodeURIComponent(partCode)}/source-details?sourceType=STOCK&excludeOrderId=${encodeURIComponent(higherDraftOrder.id)}`
    );
    const higherSourceBatchById = higherSourceDetailsById.sources?.find((source) => source.id === stockBatch.id);
    assert(higherSourceBatchById, '同时间较大订单 id 库存来源明细必须返回原备货批次');
    assert(
      Number(higherSourceBatchById.quantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单 id 库存来源明细必须扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherSourceBatchById.quantity}`
    );
    assert(
      Number(higherSourceBatchById.reservedQuantity || 0) === lowerPriorityQuantity,
      `同时间较大订单 id 库存来源明细 reservedQuantity 应为 ${lowerPriorityQuantity}，实际 ${higherSourceBatchById.reservedQuantity}`
    );

    const higherSummaryRowsById = pageItems(
      await requestJson(`/inventory/summary?keyword=${encodeURIComponent(partCode)}&excludeOrderId=${encodeURIComponent(higherDraftOrder.id)}&includeTestFixtures=true`)
    );
    const higherSummaryRowById = higherSummaryRowsById.find((row) => row.partCode === partCode);
    assert(higherSummaryRowById, '同时间较大订单 id 库存汇总必须返回当前零件');
    assert(
      Number(higherSummaryRowById.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单 id 库存汇总必须扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherSummaryRowById.availableQuantity}`
    );
    assert(Number(higherSummaryRowById.reservedQuantity || 0) === lowerPriorityQuantity, `同时间较大订单 id 库存汇总 reservedQuantity 应为 ${lowerPriorityQuantity}，实际 ${higherSummaryRowById.reservedQuantity}`);

    const higherInventoryRowsById = pageItems(
      await requestJson(`/inventory?keyword=${encodeURIComponent(partCode)}&excludeOrderId=${encodeURIComponent(higherDraftOrder.id)}&includeTestFixtures=true`)
    );
    const higherInventoryBatchById = higherInventoryRowsById.find((row) => row.id === stockBatch.id);
    assert(higherInventoryBatchById, '同时间较大订单 id 库存列表必须返回原备货批次');
    assert(
      Number(higherInventoryBatchById.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单 id 库存列表必须扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherInventoryBatchById.availableQuantity}`
    );
    assert(Number(higherInventoryBatchById.reservedQuantity || 0) === lowerPriorityQuantity, `同时间较大订单 id 库存列表 reservedQuantity 应为 ${lowerPriorityQuantity}，实际 ${higherInventoryBatchById.reservedQuantity}`);
    assert(
      (higherInventoryBatchById.reservations || []).every((reservation) => reservation.orderNo === lowerOrderNo),
      '同时间较大订单 id 库存列表只能把较小订单号预占计入占用'
    );

    const higherMaterialSuggestionsById = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&sourceType=STOCK&excludeOrderId=${encodeURIComponent(higherDraftOrder.id)}`
    );
    const higherMaterialSuggestionById = higherMaterialSuggestionsById.find((row) => row.partCode === partCode);
    assert(higherMaterialSuggestionById, '同时间较大订单 id 物料建议必须返回当前零件');
    assert(
      Number(higherMaterialSuggestionById.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单 id 物料建议必须扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherMaterialSuggestionById.availableQuantity}`
    );
    assert(
      Number(higherMaterialSuggestionById.stockInventoryQuantity || 0) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单 id 物料建议备货库存应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherMaterialSuggestionById.stockInventoryQuantity}`
    );

    const conflictingCurrentOrderQuery = `excludeOrderId=${encodeURIComponent(higherDraftOrder.id)}&excludeOrderNo=${encodeURIComponent(lowerOrderNo)}`;
    const higherSourceDetailsByConflictingId = await requestJson(
      `/inventory/materials/${encodeURIComponent(partCode)}/source-details?sourceType=STOCK&${conflictingCurrentOrderQuery}`
    );
    const higherSourceBatchByConflictingId = higherSourceDetailsByConflictingId.sources?.find((source) => source.id === stockBatch.id);
    assert(higherSourceBatchByConflictingId, '同时间较大订单 id 冲突参数库存来源明细必须返回原备货批次');
    assert(
      Number(higherSourceBatchByConflictingId.quantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单 id 冲突参数库存来源明细必须优先按 id 扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherSourceBatchByConflictingId.quantity}`
    );
    assert(
      Number(higherSourceBatchByConflictingId.reservedQuantity || 0) === lowerPriorityQuantity,
      `同时间较大订单 id 冲突参数库存来源明细 reservedQuantity 应为 ${lowerPriorityQuantity}，实际 ${higherSourceBatchByConflictingId.reservedQuantity}`
    );

    const higherSummaryRowsByConflictingId = pageItems(
      await requestJson(`/inventory/summary?keyword=${encodeURIComponent(partCode)}&${conflictingCurrentOrderQuery}&includeTestFixtures=true`)
    );
    const higherSummaryRowByConflictingId = higherSummaryRowsByConflictingId.find((row) => row.partCode === partCode);
    assert(higherSummaryRowByConflictingId, '同时间较大订单 id 冲突参数库存汇总必须返回当前零件');
    assert(
      Number(higherSummaryRowByConflictingId.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单 id 冲突参数库存汇总必须优先按 id 扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherSummaryRowByConflictingId.availableQuantity}`
    );

    const higherInventoryRowsByConflictingId = pageItems(
      await requestJson(`/inventory?keyword=${encodeURIComponent(partCode)}&${conflictingCurrentOrderQuery}&includeTestFixtures=true`)
    );
    const higherInventoryBatchByConflictingId = higherInventoryRowsByConflictingId.find((row) => row.id === stockBatch.id);
    assert(higherInventoryBatchByConflictingId, '同时间较大订单 id 冲突参数库存列表必须返回原备货批次');
    assert(
      Number(higherInventoryBatchByConflictingId.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单 id 冲突参数库存列表必须优先按 id 扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherInventoryBatchByConflictingId.availableQuantity}`
    );
    assert(
      (higherInventoryBatchByConflictingId.reservations || []).every((reservation) => reservation.orderNo === lowerOrderNo),
      '同时间较大订单 id 冲突参数库存列表只能把较小订单号预占计入占用'
    );

    const higherMaterialSuggestionsByConflictingId = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&sourceType=STOCK&${conflictingCurrentOrderQuery}`
    );
    const higherMaterialSuggestionByConflictingId = higherMaterialSuggestionsByConflictingId.find((row) => row.partCode === partCode);
    assert(higherMaterialSuggestionByConflictingId, '同时间较大订单 id 冲突参数物料建议必须返回当前零件');
    assert(
      Number(higherMaterialSuggestionByConflictingId.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `同时间较大订单 id 冲突参数物料建议必须优先按 id 扣除较小订单号预占，可用量应为 ${batchQuantity - lowerPriorityQuantity}，实际 ${higherMaterialSuggestionByConflictingId.availableQuantity}`
    );

    const staleCurrentOrderQuery = `excludeOrderId=${encodeURIComponent('00000000-0000-4000-8000-000000000000')}&excludeOrderNo=${encodeURIComponent(higherOrderNo)}`;
    const higherSourceDetailsByStaleId = await requestJson(
      `/inventory/materials/${encodeURIComponent(partCode)}/source-details?sourceType=STOCK&${staleCurrentOrderQuery}`
    );
    const higherSourceBatchByStaleId = higherSourceDetailsByStaleId.sources?.find((source) => source.id === stockBatch.id);
    assert(higherSourceBatchByStaleId, 'same-time higher order stale id source-details must fall back to excludeOrderNo');
    assert(
      Number(higherSourceBatchByStaleId.quantity) === batchQuantity - lowerPriorityQuantity,
      `same-time higher order stale id source-details must fall back to orderNo and reserve only lower order quantity, expected ${batchQuantity - lowerPriorityQuantity}, actual ${higherSourceBatchByStaleId.quantity}`
    );
    assert(
      Number(higherSourceBatchByStaleId.reservedQuantity || 0) === lowerPriorityQuantity,
      `same-time higher order stale id source-details reservedQuantity should be ${lowerPriorityQuantity}, actual ${higherSourceBatchByStaleId.reservedQuantity}`
    );

    const higherSummaryRowsByStaleId = pageItems(
      await requestJson(`/inventory/summary?keyword=${encodeURIComponent(partCode)}&${staleCurrentOrderQuery}&includeTestFixtures=true`)
    );
    const higherSummaryRowByStaleId = higherSummaryRowsByStaleId.find((row) => row.partCode === partCode);
    assert(higherSummaryRowByStaleId, 'same-time higher order stale id inventory summary must fall back to excludeOrderNo');
    assert(
      Number(higherSummaryRowByStaleId.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `same-time higher order stale id inventory summary must fall back to orderNo, expected ${batchQuantity - lowerPriorityQuantity}, actual ${higherSummaryRowByStaleId.availableQuantity}`
    );

    const higherInventoryRowsByStaleId = pageItems(
      await requestJson(`/inventory?keyword=${encodeURIComponent(partCode)}&${staleCurrentOrderQuery}&includeTestFixtures=true`)
    );
    const higherInventoryBatchByStaleId = higherInventoryRowsByStaleId.find((row) => row.id === stockBatch.id);
    assert(higherInventoryBatchByStaleId, 'same-time higher order stale id inventory list must fall back to excludeOrderNo');
    assert(
      Number(higherInventoryBatchByStaleId.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `same-time higher order stale id inventory list must fall back to orderNo, expected ${batchQuantity - lowerPriorityQuantity}, actual ${higherInventoryBatchByStaleId.availableQuantity}`
    );
    assert(
      (higherInventoryBatchByStaleId.reservations || []).every((reservation) => reservation.orderNo === lowerOrderNo),
      'same-time higher order stale id inventory list must only count lower order reservations after fallback'
    );

    const higherMaterialSuggestionsByStaleId = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&sourceType=STOCK&${staleCurrentOrderQuery}`
    );
    const higherMaterialSuggestionByStaleId = higherMaterialSuggestionsByStaleId.find((row) => row.partCode === partCode);
    assert(higherMaterialSuggestionByStaleId, 'same-time higher order stale id material suggestions must fall back to excludeOrderNo');
    assert(
      Number(higherMaterialSuggestionByStaleId.availableQuantity) === batchQuantity - lowerPriorityQuantity,
      `same-time higher order stale id material suggestions must fall back to orderNo, expected ${batchQuantity - lowerPriorityQuantity}, actual ${higherMaterialSuggestionByStaleId.availableQuantity}`
    );

    await expectRequestFailure(
      `/orders/${encodeURIComponent(higherOrderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      `已选库存批次 ${stockBatch.batchNo} 的使用数量超过当前可用库存`
    );

    const lowerOrderAfterRejectedHigherSubmit = await prisma.customerOrder.findUnique({ where: { id: lowerOrderAfterEdit.id } });
    const higherOrderAfterRejectedSubmit = await prisma.customerOrder.findUnique({ where: { id: higherDraftOrder.id } });
    assert(lowerOrderAfterRejectedHigherSubmit?.status === 'DRAFT', `同时间较大订单号提交失败后较小订单号必须保持 DRAFT，实际 ${lowerOrderAfterRejectedHigherSubmit?.status}`);
    assert(higherOrderAfterRejectedSubmit?.status === 'DRAFT', `同时间较大订单号提交失败后自身必须保持 DRAFT，实际 ${higherOrderAfterRejectedSubmit?.status}`);
    const higherReservationAfterRejectedSubmit = await prisma.inventoryReservation.findUnique({ where: { id: higherReservationBeforeEdit.id } });
    assert(higherReservationAfterRejectedSubmit?.status === 'ACTIVE', `同时间较大订单号提交失败后自身预占必须保持 ACTIVE，实际 ${higherReservationAfterRejectedSubmit?.status}`);
    const transactionCountAfterRejectedSubmit = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCountAfterRejectedSubmit === 0, `同时间较大订单号提交失败后不得生成 InventoryTransaction，实际 ${transactionCountAfterRejectedSubmit}`);
    const orderBatchCountAfterRejectedSubmit = await prisma.inventoryBatch.count({
      where: { sourceOrderId: higherDraftOrder.id, sourceOrderLineId: higherLine.id, sourceOrderNo: higherOrderNo, partCode }
    });
    assert(orderBatchCountAfterRejectedSubmit === 0, `同时间较大订单号提交失败后不得生成订单待发货库存批次，实际 ${orderBatchCountAfterRejectedSubmit}`);

    await requestJson(`/orders/${encodeURIComponent(lowerOrderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo: lowerOrderNo,
        lines: [stockLine(stockBatch, lowerFullReservationQuantity, '回归验证同时间较小 orderNo 占满整批备货库存')]
      })
    });
    const lowerOrderAfterFullEdit = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: lowerOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    const lowerLineAfterFullEdit = lowerOrderAfterFullEdit.lines[0];
    const lowerReservationsAfterFullEdit = await prisma.inventoryReservation.findMany({
      where: { orderId: lowerOrderAfterFullEdit.id, batchId: stockBatch.id, status: 'ACTIVE' }
    });
    assert(
      lowerReservationsAfterFullEdit.reduce((sum, reservation) => sum + Number(reservation.quantity), 0) === lowerFullReservationQuantity,
      `同时间较小订单号占满整批后 ACTIVE InventoryReservation 合计必须为 ${lowerFullReservationQuantity}`
    );
    const higherZeroStockSuggestions = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&sourceType=STOCK&excludeOrderNo=${encodeURIComponent(higherOrderNo)}`
    );
    assert(
      !higherZeroStockSuggestions.some((row) => row.partCode === partCode),
      '同时间较大订单号物料建议在较小订单号占满库存后不得继续返回 STOCK 候选'
    );
    const higherZeroStockSuggestionsById = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&sourceType=STOCK&excludeOrderId=${encodeURIComponent(higherDraftOrder.id)}`
    );
    assert(
      !higherZeroStockSuggestionsById.some((row) => row.partCode === partCode),
      '同时间较大订单 id 物料建议在较小订单号占满库存后不得继续返回 STOCK 候选'
    );
    const higherZeroAllSuggestions = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&sourceType=ALL&excludeOrderNo=${encodeURIComponent(higherOrderNo)}`
    );
    const higherZeroAllSuggestion = higherZeroAllSuggestions.find((row) => row.partCode === partCode);
    assert(higherZeroAllSuggestion, '同时间较大订单号物料建议 sourceType=ALL 应保留零可用量物料用于人工核对');
    assert(Number(higherZeroAllSuggestion.availableQuantity || 0) === 0, `同时间较大订单号物料建议 sourceType=ALL 零可用量应为 0，实际 ${higherZeroAllSuggestion.availableQuantity}`);
    assert(Number(higherZeroAllSuggestion.stockInventoryQuantity || 0) === 0, `同时间较大订单号物料建议 sourceType=ALL 备货库存应为 0，实际 ${higherZeroAllSuggestion.stockInventoryQuantity}`);
    const higherZeroAllSuggestionsById = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&sourceType=ALL&excludeOrderId=${encodeURIComponent(higherDraftOrder.id)}`
    );
    const higherZeroAllSuggestionById = higherZeroAllSuggestionsById.find((row) => row.partCode === partCode);
    assert(higherZeroAllSuggestionById, '同时间较大订单 id 物料建议 sourceType=ALL 应保留零可用量物料用于人工核对');
    assert(Number(higherZeroAllSuggestionById.availableQuantity || 0) === 0, `同时间较大订单 id 物料建议 sourceType=ALL 零可用量应为 0，实际 ${higherZeroAllSuggestionById.availableQuantity}`);
    assert(Number(higherZeroAllSuggestionById.stockInventoryQuantity || 0) === 0, `同时间较大订单 id 物料建议 sourceType=ALL 备货库存应为 0，实际 ${higherZeroAllSuggestionById.stockInventoryQuantity}`);

    await requestJson(`/orders/${encodeURIComponent(lowerOrderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });

    const lowerOrderAfterSubmit = await prisma.customerOrder.findUnique({ where: { id: lowerOrderAfterFullEdit.id } });
    assert(lowerOrderAfterSubmit?.status === 'PENDING_PRODUCTION', `同时间较小订单号提交后必须进入 PENDING_PRODUCTION，实际 ${lowerOrderAfterSubmit?.status}`);
    const lowerConsumedReservations = await prisma.inventoryReservation.findMany({
      where: { orderId: lowerOrderAfterFullEdit.id, batchId: stockBatch.id, status: 'CONSUMED' }
    });
    assert(
      lowerConsumedReservations.reduce((sum, reservation) => sum + Number(reservation.quantity), 0) === lowerFullReservationQuantity &&
        lowerConsumedReservations.every((reservation) => reservation.consumedAt),
      `同时间较小订单号提交后 CONSUMED InventoryReservation 合计必须为 ${lowerFullReservationQuantity}`
    );
    const higherReservationAfterLowerSubmit = await prisma.inventoryReservation.findUnique({ where: { id: higherReservationBeforeEdit.id } });
    assert(higherReservationAfterLowerSubmit?.status === 'ACTIVE', `同时间较小订单号提交后较大订单号预占必须保持 ACTIVE，实际 ${higherReservationAfterLowerSubmit?.status}`);
    const batchAfterLowerSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterLowerSubmit?.quantity) === 0, `同时间较小订单号占满整批提交后原库存批次数量必须为 0，实际 ${batchAfterLowerSubmit?.quantity}`);
    assert(batchAfterLowerSubmit?.status === 'USED', `同时间较小订单号占满整批提交后原库存批次必须转为 USED，实际 ${batchAfterLowerSubmit?.status}`);
    const lowerOrderBatch = await prisma.inventoryBatch.findUnique({ where: { batchNo: `IB-ALLOC-${lowerOrderNo}-001-01` } });
    assert(lowerOrderBatch?.sourceOrderLineId === lowerLineAfterFullEdit.id, `同时间较小订单号提交后订单库存批次必须关联较小订单号订单行，实际 ${lowerOrderBatch?.sourceOrderLineId}`);
    assert(Number(lowerOrderBatch?.quantity) === lowerFullReservationQuantity, `同时间较小订单号提交后订单库存批次数量应为 ${lowerFullReservationQuantity}，实际 ${lowerOrderBatch?.quantity}`);
    const finalTransactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(finalTransactionCount === 2, `同时间较小订单号提交后只能生成 OUT/IN 两条 InventoryTransaction，实际 ${finalTransactionCount}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { in: [lowerOrderNo, higherOrderNo] } } });
    assert(taskCount === 0, `同时间草稿预占优先级全库存覆盖不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupStockReservationPriorityTieCase();
    await prisma.$disconnect();
  }
}

async function assertSubmitConsumesSameBatchStockSourcesAcrossLines() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-SAME-BATCH-OK`;
  const customerCode = `${orderPrefix}-STOCK-SAME-OK-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-SAME-OK-WH`;
  const locationCode = `${orderPrefix}-STOCK-SAME-OK-LOC`;
  const partCode = `${materialPrefix}-STOCK-SAME-OK`;
  const batchNo = `${orderPrefix}-STOCK-SAME-OK-BATCH`;
  const firstLineQuantity = 2;
  const secondLineQuantity = 3;
  const batchQuantity = firstLineQuantity + secondLineQuantity;

  async function cleanupSameBatchStockSubmitCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function stockLine(index, quantity) {
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel: '同批次合法共用',
      partCode,
      partName: '同批次合法共用提交回归零件',
      drawingNo: `VERIFY-${runId}-STOCK-SAME-OK`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件'
    };
  }

  try {
    await cleanupSameBatchStockSubmitCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '同批次合法共用提交回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '同批次合法共用提交回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '同批次合法共用提交回归仓库',
      locationCode,
      locationName: '同批次合法共用提交回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '同批次合法共用提交回归零件',
        quantity: batchQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-07-05',
        lines: [
          {
            ...stockLine(1, firstLineQuantity),
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: firstLineQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同一草稿订单多行合法共用同一库存批次',
                manualConfirmedBy: 'verify-stock-same-batch-ok',
                manualConfirmedAt: '2026-07-05T08:00:00.000Z',
                manualConfirmRemark: '回归验证第 1 行合法占用同一批次'
              }
            ]
          },
          {
            ...stockLine(2, secondLineQuantity),
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: secondLineQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同一草稿订单多行合法共用同一库存批次',
                manualConfirmedBy: 'verify-stock-same-batch-ok',
                manualConfirmedAt: '2026-07-05T08:00:00.000Z',
                manualConfirmRemark: '回归验证第 2 行合法占用同一批次'
              }
            ]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: { orderBy: { lineNo: 'asc' } } }
    });
    assert(draftOrder?.id, '同一草稿订单多行合法共用同一库存批次必须生成 DRAFT 订单');
    assert(draftOrder.status === 'DRAFT', `同一草稿订单多行合法共用同一库存批次保存后订单必须保持 DRAFT，实际 ${draftOrder.status}`);
    const [firstLine, secondLine] = draftOrder.lines;
    assert(firstLine?.id && secondLine?.id, '同一草稿订单多行合法共用同一库存批次必须生成 2 条订单行');
    assert(Number(firstLine.productionPlanQuantity) === 0, `同批次合法共用第 1 行 productionPlanQuantity 应为 0，实际 ${firstLine.productionPlanQuantity}`);
    assert(Number(secondLine.productionPlanQuantity) === 0, `同批次合法共用第 2 行 productionPlanQuantity 应为 0，实际 ${secondLine.productionPlanQuantity}`);

    const draftReservations = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, batchId: stockBatch.id, status: 'ACTIVE' },
      orderBy: [{ orderLineId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(draftReservations.length === 2, `同一草稿订单多行合法共用同一库存批次保存后应创建 2 条 ACTIVE InventoryReservation，实际 ${draftReservations.length}`);
    const firstLineReservation = draftReservations.find((reservation) => reservation.orderLineId === firstLine.id);
    const secondLineReservation = draftReservations.find((reservation) => reservation.orderLineId === secondLine.id);
    assert(Number(firstLineReservation?.quantity) === firstLineQuantity, `同批次合法共用第 1 行预占数量应为 ${firstLineQuantity}，实际 ${firstLineReservation?.quantity}`);
    assert(Number(secondLineReservation?.quantity) === secondLineQuantity, `同批次合法共用第 2 行预占数量应为 ${secondLineQuantity}，实际 ${secondLineReservation?.quantity}`);
    const batchAfterDraft = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterDraft?.quantity) === batchQuantity, `同批次合法共用保存草稿不得扣减原库存批次数量，实际 ${batchAfterDraft?.quantity}`);
    const transactionCountAfterDraft = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCountAfterDraft === 0, `同批次合法共用保存草稿不得生成 InventoryTransaction，实际 ${transactionCountAfterDraft}`);

    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });

    const submittedOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(submittedOrder?.status === 'PENDING_PRODUCTION', `同批次合法共用提交后订单必须进入 PENDING_PRODUCTION，实际 ${submittedOrder?.status}`);
    const consumedReservations = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, batchId: stockBatch.id },
      orderBy: [{ orderLineId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(
      consumedReservations.length === 2 && consumedReservations.every((reservation) => reservation.status === 'CONSUMED' && reservation.consumedAt),
      '同一草稿订单多行合法共用同一库存批次提交后所有预占必须转为 CONSUMED'
    );
    const batchAfterSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterSubmit?.quantity) === 0, `同批次合法共用提交后原库存批次数量必须扣为 0，实际 ${batchAfterSubmit?.quantity}`);
    assert(batchAfterSubmit?.status === 'USED', `同批次合法共用提交后原库存批次必须转为 USED，实际 ${batchAfterSubmit?.status}`);

    const outTransactions = await prisma.inventoryTransaction.findMany({
      where: { partCode, transactionType: 'OUT' },
      orderBy: { transactionNo: 'asc' }
    });
    assert(outTransactions.length === 2, `同批次合法共用提交后应生成 2 条 OUT InventoryTransaction，实际 ${outTransactions.length}`);
    assert(outTransactions[0].batchId === stockBatch.id, '同批次合法共用第 1 条 OUT 必须来自同一原库存批次');
    assert(outTransactions[0].transactionNo.endsWith('-001-01'), `同批次合法共用第 1 条 OUT 编号应以 -001-01 结尾，实际 ${outTransactions[0].transactionNo}`);
    assert(Number(outTransactions[0].quantity) === firstLineQuantity, `同批次合法共用第 1 条 OUT 数量应为 ${firstLineQuantity}，实际 ${outTransactions[0].quantity}`);
    assert(outTransactions[1].batchId === stockBatch.id, '同批次合法共用第 2 条 OUT 必须来自同一原库存批次');
    assert(outTransactions[1].transactionNo.endsWith('-002-01'), `同批次合法共用第 2 条 OUT 编号应以 -002-01 结尾，实际 ${outTransactions[1].transactionNo}`);
    assert(Number(outTransactions[1].quantity) === secondLineQuantity, `同批次合法共用第 2 条 OUT 数量应为 ${secondLineQuantity}，实际 ${outTransactions[1].quantity}`);

    const firstOrderBatch = await prisma.inventoryBatch.findUnique({ where: { batchNo: `IB-ALLOC-${orderNo}-001-01` } });
    const secondOrderBatch = await prisma.inventoryBatch.findUnique({ where: { batchNo: `IB-ALLOC-${orderNo}-002-01` } });
    assert(firstOrderBatch?.sourceOrderLineId === firstLine.id, `同批次合法共用第 1 个订单库存批次必须关联第 1 行，实际 ${firstOrderBatch?.sourceOrderLineId}`);
    assert(Number(firstOrderBatch?.quantity) === firstLineQuantity, `同批次合法共用第 1 个订单库存批次数量应为 ${firstLineQuantity}，实际 ${firstOrderBatch?.quantity}`);
    assert(secondOrderBatch?.sourceOrderLineId === secondLine.id, `同批次合法共用第 2 个订单库存批次必须关联第 2 行，实际 ${secondOrderBatch?.sourceOrderLineId}`);
    assert(Number(secondOrderBatch?.quantity) === secondLineQuantity, `同批次合法共用第 2 个订单库存批次数量应为 ${secondLineQuantity}，实际 ${secondOrderBatch?.quantity}`);
    const inTransactions = await prisma.inventoryTransaction.findMany({
      where: { partCode, transactionType: 'IN' },
      orderBy: { transactionNo: 'asc' }
    });
    assert(inTransactions.length === 2, `同批次合法共用提交后应生成 2 条 IN InventoryTransaction，实际 ${inTransactions.length}`);
    assert(inTransactions[0].batchId === firstOrderBatch?.id, '同批次合法共用第 1 条 IN 必须写入第 1 行订单库存批次');
    assert(inTransactions[1].batchId === secondOrderBatch?.id, '同批次合法共用第 2 条 IN 必须写入第 2 行订单库存批次');
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `同批次合法共用全库存覆盖不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupSameBatchStockSubmitCase();
    await prisma.$disconnect();
  }
}

async function assertCreateRejectsReworkStockSourceOverPlan() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-REWORK-OVER-PLAN`;
  const customerCode = `${orderPrefix}-REWORK-OVER-CUST`;
  const warehouseCode = `${orderPrefix}-REWORK-OVER-WH`;
  const locationCode = `${orderPrefix}-REWORK-OVER-LOC`;
  const partCode = `${materialPrefix}-REWORK-OVER`;
  const batchNo = `${orderPrefix}-REWORK-OVER-BATCH`;
  const productionQuantity = 4;
  const selectedQuantity = 5;

  async function cleanupReworkOverPlanCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupReworkOverPlanCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '库存再加工来源超计划拒绝保存回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '库存再加工来源超计划拒绝保存回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '库存再加工来源超计划拒绝保存回归仓库',
      locationCode,
      locationName: '库存再加工来源超计划拒绝保存回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '库存再加工来源超计划拒绝保存回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo,
          orderDate: '2026-07-04',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: '库存再加工来源超计划',
              partCode,
              partName: '库存再加工来源超计划拒绝保存回归零件',
              drawingNo: `VERIFY-${runId}-REWORK-OVER`,
              drawingVersion: 'A',
              partThickness: 1,
              partSpecification: '100mm x 100mm',
              quantity: 4,
              productionPlanQuantity: productionQuantity,
              fulfillmentMode: 'REWORK',
              unit: '件',
              processSteps: [{ processName: '激光切割' }],
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: selectedQuantity,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED',
                  compatibilityReason: '库存再加工领用来源超计划',
                  manualConfirmedBy: 'verify-rework-over-plan',
                  manualConfirmedAt: '2026-07-04T08:00:00.000Z',
                  manualConfirmRemark: '回归验证库存再加工来源超计划不能保存草稿'
                }
              ]
            }
          ]
        })
      },
      `第 1 个零件已选库存数量超过本次需要数量：需要 ${productionQuantity}，已选 ${selectedQuantity}`
    );

    const rejectedOrder = await prisma.customerOrder.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!rejectedOrder, '库存再加工来源超计划保存失败后不得生成草稿订单');
    const orderNoReservation = await prisma.orderNoReservation.findFirst({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(!orderNoReservation, '库存再加工来源超计划保存失败后不得占用订单号');
    const reservationCount = await prisma.inventoryReservation.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(reservationCount === 0, `库存再加工来源超计划保存失败后不得生成 InventoryReservation，实际 ${reservationCount}`);
    const batchAfterRejectedCreate = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterRejectedCreate?.quantity) === 6, `库存再加工来源超计划保存失败后原备货批次数量必须保持 6，实际 ${batchAfterRejectedCreate?.quantity}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `库存再加工来源超计划保存失败后不得生成 InventoryTransaction，实际 ${transactionCount}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `库存再加工来源超计划保存失败后不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupReworkOverPlanCase();
    await prisma.$disconnect();
  }
}

async function assertSubmitRejectsReworkWithoutStockSources() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-REWORK-NO-SOURCE`;
  const customerCode = `${orderPrefix}-REWORK-NO-SOURCE-CUST`;
  const partCode = `${materialPrefix}-REWORK-NO-SOURCE`;
  const productionQuantity = 4;

  async function cleanupReworkNoSourceCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupReworkNoSourceCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '库存再加工未选来源拒绝提交回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '库存再加工未选来源拒绝提交回归地址'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-07-05',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '库存再加工未选来源',
            partCode,
            partName: '库存再加工未选来源拒绝提交回归零件',
            drawingNo: `VERIFY-${runId}-REWORK-NO-SOURCE`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: 4,
            productionPlanQuantity: productionQuantity,
            fulfillmentMode: 'REWORK',
            unit: '件',
            processSteps: [{ processName: '激光切割' }]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: { include: { processSteps: true } } }
    });
    assert(draftOrder?.id, '库存再加工未选来源草稿订单必须写入数据库');
    const draftLine = draftOrder.lines[0];
    assert(draftLine.fulfillmentMode === 'REWORK', `库存再加工未选来源订单行履约方式必须是 REWORK，实际 ${draftLine.fulfillmentMode}`);
    assert(draftLine.processSteps.length === 1, `库存再加工未选来源草稿必须保留工序，实际 ${draftLine.processSteps.length}`);
    const reservationCountBeforeSubmit = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, orderNo: { equals: orderNo, mode: 'insensitive' } }
    });
    assert(reservationCountBeforeSubmit === 0, `库存再加工未选来源草稿不得生成 InventoryReservation，实际 ${reservationCountBeforeSubmit}`);

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      '第 1 个零件必须先选择库存批次并完成来源核对'
    );

    const orderAfterRejectedSubmit = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(orderAfterRejectedSubmit?.status === 'DRAFT', `库存再加工未选来源提交失败后订单必须保持 DRAFT，实际 ${orderAfterRejectedSubmit?.status}`);
    const reservationCountAfterSubmit = await prisma.inventoryReservation.count({
      where: { orderId: draftOrder.id, orderNo: { equals: orderNo, mode: 'insensitive' } }
    });
    assert(reservationCountAfterSubmit === 0, `库存再加工未选来源提交失败后不得生成 InventoryReservation，实际 ${reservationCountAfterSubmit}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `库存再加工未选来源提交失败后不得生成 InventoryTransaction，实际 ${transactionCount}`);
    const orderBatchCount = await prisma.inventoryBatch.count({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderLineId: draftLine.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(orderBatchCount === 0, `库存再加工未选来源提交失败后不得生成订单待发货库存批次，实际 ${orderBatchCount}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `库存再加工未选来源提交失败后不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupReworkNoSourceCase();
    await prisma.$disconnect();
  }
}

async function assertSubmitConsumesSelectedStockSourcesInManualOrder() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-MANUAL-ORDER`;
  const customerCode = `${orderPrefix}-STOCK-MANUAL-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-MANUAL-WH`;
  const locationCode = `${orderPrefix}-STOCK-MANUAL-LOC`;
  const partCode = `${materialPrefix}-STOCK-MANUAL`;
  const firstBatchNo = `${orderPrefix}-STOCK-MANUAL-A`;
  const secondBatchNo = `${orderPrefix}-STOCK-MANUAL-B`;
  const firstSelectedQuantity = 3;
  const secondSelectedQuantity = 2;
  const orderQuantity = firstSelectedQuantity + secondSelectedQuantity;

  async function cleanupManualStockOrderCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupManualStockOrderCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '人工库存批次顺序提交回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '人工库存批次顺序提交回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '人工库存批次顺序提交回归仓库',
      locationCode,
      locationName: '人工库存批次顺序提交回归库位'
    });
    const firstBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: firstBatchNo,
        partCode,
        partName: '人工库存批次顺序提交回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });
    const secondBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: secondBatchNo,
        partCode,
        partName: '人工库存批次顺序提交回归零件',
        quantity: 4,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-06-29',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '人工库存批次顺序',
            partCode,
            partName: '人工库存批次顺序提交回归零件',
            drawingNo: `VERIFY-${runId}-STOCK-MANUAL`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: orderQuantity,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            unit: '件',
            selectedStockSources: [
              {
                batchId: secondBatch.id,
                batchNo: secondBatch.batchNo,
                partCode,
                partName: secondBatch.partName,
                quantity: secondSelectedQuantity,
                unit: secondBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '人工指定先使用 B 批次',
                manualConfirmedBy: 'verify-stock-manual-order',
                manualConfirmedAt: '2026-06-29T08:00:00.000Z',
                manualConfirmRemark: '回归验证先使用 B 批次'
              },
              {
                batchId: firstBatch.id,
                batchNo: firstBatch.batchNo,
                partCode,
                partName: firstBatch.partName,
                quantity: firstSelectedQuantity,
                unit: firstBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: `未优先使用较小库存批次 ${secondBatch.batchNo}`,
                manualConfirmedBy: 'verify-stock-manual-order',
                manualConfirmedAt: '2026-06-29T08:00:00.000Z',
                manualConfirmRemark: `未优先使用较小库存批次 ${secondBatch.batchNo}，回归验证后使用 A 批次`
              }
            ]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(draftOrder?.id, '人工库存批次顺序订单必须写入数据库');
    const draftLine = draftOrder.lines[0];
    assert(Number(draftLine.productionPlanQuantity) === 0, `人工库存批次顺序订单生产计划应为 0，实际 ${draftLine.productionPlanQuantity}`);
    const draftReservations = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, orderLineId: draftLine.id, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(draftReservations.length === 2, `人工库存批次顺序草稿应创建 2 条 ACTIVE InventoryReservation，实际 ${draftReservations.length}`);

    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });

    const consumedReservations = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, orderLineId: draftLine.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(
      consumedReservations.every((reservation) => reservation.status === 'CONSUMED'),
      '人工库存批次顺序提交后所有草稿预占必须转为 CONSUMED'
    );
    const firstBatchAfterSubmit = await prisma.inventoryBatch.findUnique({ where: { id: firstBatch.id } });
    const secondBatchAfterSubmit = await prisma.inventoryBatch.findUnique({ where: { id: secondBatch.id } });
    assert(Number(secondBatchAfterSubmit?.quantity) === 2, `人工库存批次顺序先选 B 批次后应剩余 2，实际 ${secondBatchAfterSubmit?.quantity}`);
    assert(Number(firstBatchAfterSubmit?.quantity) === 3, `人工库存批次顺序后选 A 批次后应剩余 3，实际 ${firstBatchAfterSubmit?.quantity}`);

    const outTransactions = await prisma.inventoryTransaction.findMany({
      where: { partCode, transactionType: 'OUT' },
      orderBy: { transactionNo: 'asc' }
    });
    assert(outTransactions.length === 2, `人工库存批次顺序提交后应生成 2 条 OUT InventoryTransaction，实际 ${outTransactions.length}`);
    assert(outTransactions[0].batchId === secondBatch.id, '人工库存批次顺序第 1 条 OUT 必须来自先选的 B 批次');
    assert(outTransactions[0].transactionNo.endsWith('-001-01'), `人工库存批次顺序第 1 条 OUT 编号应以 -001-01 结尾，实际 ${outTransactions[0].transactionNo}`);
    assert(Number(outTransactions[0].quantity) === secondSelectedQuantity, `人工库存批次顺序第 1 条 OUT 数量应为 ${secondSelectedQuantity}，实际 ${outTransactions[0].quantity}`);
    assert(outTransactions[1].batchId === firstBatch.id, '人工库存批次顺序第 2 条 OUT 必须来自后选的 A 批次');
    assert(outTransactions[1].transactionNo.endsWith('-001-02'), `人工库存批次顺序第 2 条 OUT 编号应以 -001-02 结尾，实际 ${outTransactions[1].transactionNo}`);
    assert(Number(outTransactions[1].quantity) === firstSelectedQuantity, `人工库存批次顺序第 2 条 OUT 数量应为 ${firstSelectedQuantity}，实际 ${outTransactions[1].quantity}`);

    const firstOrderBatchNo = `IB-ALLOC-${orderNo}-001-01`;
    const secondOrderBatchNo = `IB-ALLOC-${orderNo}-001-02`;
    const firstOrderBatch = await prisma.inventoryBatch.findUnique({ where: { batchNo: firstOrderBatchNo } });
    const secondOrderBatch = await prisma.inventoryBatch.findUnique({ where: { batchNo: secondOrderBatchNo } });
    assert(firstOrderBatch?.sourceOrderLineId === draftLine.id, `人工库存批次顺序第 1 个订单库存批次必须关联订单行，实际 ${firstOrderBatch?.sourceOrderLineId}`);
    assert(Number(firstOrderBatch?.quantity) === secondSelectedQuantity, `人工库存批次顺序第 1 个订单库存批次数量应为 ${secondSelectedQuantity}，实际 ${firstOrderBatch?.quantity}`);
    assert(secondOrderBatch?.sourceOrderLineId === draftLine.id, `人工库存批次顺序第 2 个订单库存批次必须关联订单行，实际 ${secondOrderBatch?.sourceOrderLineId}`);
    assert(Number(secondOrderBatch?.quantity) === firstSelectedQuantity, `人工库存批次顺序第 2 个订单库存批次数量应为 ${firstSelectedQuantity}，实际 ${secondOrderBatch?.quantity}`);

    const inTransactions = await prisma.inventoryTransaction.findMany({
      where: { partCode, transactionType: 'IN' },
      orderBy: { transactionNo: 'asc' }
    });
    assert(inTransactions.length === 2, `人工库存批次顺序提交后应生成 2 条 IN InventoryTransaction，实际 ${inTransactions.length}`);
    assert(inTransactions[0].batchId === firstOrderBatch?.id, '人工库存批次顺序第 1 条 IN 必须写入第 1 个订单库存批次');
    assert(inTransactions[1].batchId === secondOrderBatch?.id, '人工库存批次顺序第 2 条 IN 必须写入第 2 个订单库存批次');
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `人工库存批次顺序全库存覆盖不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupManualStockOrderCase();
    await prisma.$disconnect();
  }
}

async function assertEarlierDraftManualSelectionSeesSmallerBatchReservedByLaterDraft() {
  const prisma = new PrismaClient();
  const earlierOrderNo = `${orderPrefix}-STOCK-MANUAL-PRIORITY-EARLY`;
  const laterOrderNo = `${orderPrefix}-STOCK-MANUAL-PRIORITY-LATE`;
  const customerCode = `${orderPrefix}-STOCK-MANUAL-PRIORITY-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-MANUAL-PRIORITY-WH`;
  const locationCode = `${orderPrefix}-STOCK-MANUAL-PRIORITY-LOC`;
  const partCode = `${materialPrefix}-STOCK-MANUAL-PRIORITY`;
  const smallerBatchNo = `${orderPrefix}-STOCK-MANUAL-PRIORITY-A`;
  const largerBatchNo = `${orderPrefix}-STOCK-MANUAL-PRIORITY-B`;
  const earlierQuantity = 3;
  const laterQuantity = 2;

  async function cleanupManualPriorityCase() {
    const orderNos = [earlierOrderNo, laterOrderNo];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function stockLine(stockBatch, quantity, remark, manualConfirmed = true) {
    const source = {
      batchId: stockBatch.id,
      batchNo: stockBatch.batchNo,
      partCode,
      partName: stockBatch.partName,
      quantity,
      unit: stockBatch.unit,
      compatibilityStatus: 'MATCHED',
      compatibilityReason: 'same part stock source for manual priority regression'
    };
    if (manualConfirmed) {
      Object.assign(source, {
        manualConfirmedBy: 'verify-stock-manual-priority',
        manualConfirmedAt: '2026-07-12T08:00:00.000Z',
        manualConfirmRemark: remark
      });
    }
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel: '人工库存批次优先级',
      partCode,
      partName: '人工库存批次优先级回归零件',
      drawingNo: `VERIFY-${runId}-STOCK-MANUAL-PRIORITY`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件',
      selectedStockSources: [source]
    };
  }

  try {
    await cleanupManualPriorityCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '人工库存批次优先级回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '人工库存批次优先级回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '人工库存批次优先级回归仓库',
      locationCode,
      locationName: '人工库存批次优先级回归库位'
    });
    const smallerBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: smallerBatchNo,
        partCode,
        partName: '人工库存批次优先级回归零件',
        quantity: laterQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });
    const largerBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: largerBatchNo,
        partCode,
        partName: '人工库存批次优先级回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: earlierOrderNo,
        orderDate: '2026-07-12',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '人工库存批次优先级',
            partCode,
            partName: '人工库存批次优先级回归零件',
            drawingNo: `VERIFY-${runId}-STOCK-MANUAL-PRIORITY`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: earlierQuantity,
            productionPlanQuantity: earlierQuantity,
            fulfillmentMode: 'PRODUCTION',
            unit: '件'
          }
        ]
      })
    });
    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo: laterOrderNo,
        orderDate: '2026-07-12',
        lines: [stockLine(smallerBatch, laterQuantity, 'later draft reserves smaller batch')]
      })
    });

    const earlierDraftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: earlierOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    const laterDraftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: laterOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(earlierDraftOrder?.id && laterDraftOrder?.id, 'manual stock priority regression must create both draft orders');
    await prisma.customerOrder.update({
      where: { id: earlierDraftOrder.id },
      data: { createdAt: new Date('2026-07-12T08:00:00.000Z') }
    });
    await prisma.customerOrder.update({
      where: { id: laterDraftOrder.id },
      data: { createdAt: new Date('2026-07-12T09:00:00.000Z') }
    });
    const laterReservation = await prisma.inventoryReservation.findFirst({
      where: { orderId: laterDraftOrder.id, batchId: smallerBatch.id, status: 'ACTIVE' }
    });
    assert(Number(laterReservation?.quantity) === laterQuantity, `later draft must reserve the smaller batch, actual=${laterReservation?.quantity}`);

    await expectRequestFailure(
      `/orders/${encodeURIComponent(earlierOrderNo)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderNo: earlierOrderNo,
          lines: [stockLine(largerBatch, earlierQuantity, 'missing manual priority confirmation', false)]
        })
      },
      '未优先使用较小库存批次'
    );

    const earlierReservationCountAfterRejectedEdit = await prisma.inventoryReservation.count({
      where: { orderId: earlierDraftOrder.id, status: 'ACTIVE' }
    });
    assert(
      earlierReservationCountAfterRejectedEdit === 0,
      `earlier draft rejected manual priority edit must not create InventoryReservation, actual=${earlierReservationCountAfterRejectedEdit}`
    );
    const laterReservationAfterRejectedEdit = await prisma.inventoryReservation.findUnique({ where: { id: laterReservation.id } });
    assert(laterReservationAfterRejectedEdit?.status === 'ACTIVE', `later draft reservation must stay ACTIVE after earlier edit rejection, actual=${laterReservationAfterRejectedEdit?.status}`);

    await expectRequestFailure(
      `/orders/${encodeURIComponent(earlierOrderNo)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderNo: earlierOrderNo,
          lines: [stockLine(largerBatch, earlierQuantity, 'stale manual priority confirmation')]
        })
      },
      '未优先使用较小库存批次'
    );

    const earlierReservationCountAfterStaleConfirmedEdit = await prisma.inventoryReservation.count({
      where: { orderId: earlierDraftOrder.id, status: 'ACTIVE' }
    });
    assert(
      earlierReservationCountAfterStaleConfirmedEdit === 0,
      `earlier draft stale manual priority edit must not create InventoryReservation, actual=${earlierReservationCountAfterStaleConfirmedEdit}`
    );
    const laterReservationAfterStaleConfirmedEdit = await prisma.inventoryReservation.findUnique({ where: { id: laterReservation.id } });
    assert(laterReservationAfterStaleConfirmedEdit?.status === 'ACTIVE', `later draft reservation must stay ACTIVE after stale earlier edit rejection, actual=${laterReservationAfterStaleConfirmedEdit?.status}`);

    await requestJson(`/orders/${encodeURIComponent(earlierOrderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo: earlierOrderNo,
        lines: [
          stockLine(
            largerBatch,
            earlierQuantity,
            `未优先使用较小库存批次 ${smallerBatch.batchNo} manual confirmation for skipping smaller batch`
          )
        ]
      })
    });
    const earlierDraftAfterConfirmedEdit = await prisma.customerOrder.findUnique({
      where: { id: earlierDraftOrder.id },
      include: { lines: true }
    });
    const earlierLineAfterConfirmedEdit = earlierDraftAfterConfirmedEdit.lines[0];
    const earlierReservationAfterConfirmedEdit = await prisma.inventoryReservation.findFirst({
      where: { orderId: earlierDraftOrder.id, orderLineId: earlierLineAfterConfirmedEdit.id, batchId: largerBatch.id, status: 'ACTIVE' }
    });
    assert(Number(earlierReservationAfterConfirmedEdit?.quantity) === earlierQuantity, `earlier draft confirmed edit must reserve larger batch, actual=${earlierReservationAfterConfirmedEdit?.quantity}`);

    await requestJson(`/orders/${encodeURIComponent(earlierOrderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
    const earlierReservationAfterSubmit = await prisma.inventoryReservation.findUnique({ where: { id: earlierReservationAfterConfirmedEdit.id } });
    assert(earlierReservationAfterSubmit?.status === 'CONSUMED', `earlier draft confirmed reservation must become CONSUMED after submit, actual=${earlierReservationAfterSubmit?.status}`);
    const laterReservationAfterSubmit = await prisma.inventoryReservation.findUnique({ where: { id: laterReservation.id } });
    assert(laterReservationAfterSubmit?.status === 'ACTIVE', `later draft smaller-batch reservation must remain ACTIVE after earlier submit, actual=${laterReservationAfterSubmit?.status}`);
    const largerBatchAfterSubmit = await prisma.inventoryBatch.findUnique({ where: { id: largerBatch.id } });
    const smallerBatchAfterSubmit = await prisma.inventoryBatch.findUnique({ where: { id: smallerBatch.id } });
    assert(Number(largerBatchAfterSubmit?.quantity) === 3, `earlier submit should consume only larger batch, actual larger quantity=${largerBatchAfterSubmit?.quantity}`);
    assert(Number(smallerBatchAfterSubmit?.quantity) === laterQuantity, `earlier submit must not consume later draft smaller batch, actual smaller quantity=${smallerBatchAfterSubmit?.quantity}`);
  } finally {
    await cleanupManualPriorityCase();
    await prisma.$disconnect();
  }
}

async function assertSubmitRejectsStaleManualSelectionWhenSmallerBatchAppearsAfterDraftSave() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-MANUAL-PRIORITY-STALE-SUBMIT`;
  const customerCode = `${orderPrefix}-STOCK-MANUAL-PRIORITY-STALE-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-MANUAL-PRIORITY-STALE-WH`;
  const locationCode = `${orderPrefix}-STOCK-MANUAL-PRIORITY-STALE-LOC`;
  const partCode = `${materialPrefix}-STOCK-MANUAL-PRIORITY-STALE`;
  const largerBatchNo = `${orderPrefix}-STOCK-MANUAL-PRIORITY-STALE-B`;
  const smallerBatchNo = `${orderPrefix}-STOCK-MANUAL-PRIORITY-STALE-A`;
  const selectedQuantity = 3;
  const smallerQuantity = 2;

  async function cleanupStaleManualPrioritySubmitCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo } });
    await prisma.productionTask.deleteMany({ where: { orderNo } });
    await prisma.customerOrder.deleteMany({ where: { orderNo } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function stockLine(stockBatch, quantity, reason = '保存草稿时仅存在较大库存批次') {
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel: '人工库存批次优先级提交重算',
      partCode,
      partName: '人工库存批次优先级提交重算零件',
      drawingNo: `VERIFY-${runId}-STOCK-MANUAL-PRIORITY-STALE`,
      drawingVersion: 'A',
      drawingDate: '2026-07-13',
      drawingStatus: 'VALID',
      drawingFileName: 'stale-submit-priority.pdf',
      drawingFileUrl: '/files/stale-submit-priority.pdf',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件',
      selectedStockSources: [
        {
          batchId: stockBatch.id,
          batchNo: stockBatch.batchNo,
          partCode,
          partName: stockBatch.partName,
          quantity,
          unit: stockBatch.unit,
          compatibilityStatus: 'MATCHED',
          compatibilityReason: reason,
          manualConfirmedBy: 'verify-stock-manual-priority-stale-submit',
          manualConfirmedAt: '2026-07-13T08:00:00.000Z',
          manualConfirmRemark: '保存草稿时已人工确认裸库存批次来源资料'
        }
      ]
    };
  }

  try {
    await cleanupStaleManualPrioritySubmitCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '人工库存批次优先级提交重算客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '人工库存批次优先级提交重算地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '人工库存批次优先级提交重算仓库',
      locationCode,
      locationName: '人工库存批次优先级提交重算库位'
    });
    const largerBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: largerBatchNo,
        partCode,
        partName: '人工库存批次优先级提交重算零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-07-13',
        lines: [stockLine(largerBatch, selectedQuantity)]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(draftOrder?.id, 'stale manual priority submit regression must create draft order first');
    const draftLine = draftOrder.lines[0];
    const originalReservation = await prisma.inventoryReservation.findFirst({
      where: { orderId: draftOrder.id, orderLineId: draftLine.id, batchId: largerBatch.id, status: 'ACTIVE' }
    });
    assert(Number(originalReservation?.quantity) === selectedQuantity, `stale manual priority submit must reserve larger batch first, actual=${originalReservation?.quantity}`);

    const smallerBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: smallerBatchNo,
        partCode,
        partName: '人工库存批次优先级提交重算零件',
        quantity: smallerQuantity,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      `未优先使用较小库存批次 ${smallerBatch.batchNo}`
    );

    const orderAfterRejectedSubmit = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(orderAfterRejectedSubmit?.status === 'DRAFT', `stale manual priority submit rejection must keep order DRAFT, actual=${orderAfterRejectedSubmit?.status}`);
    const reservationAfterRejectedSubmit = await prisma.inventoryReservation.findUnique({ where: { id: originalReservation.id } });
    assert(reservationAfterRejectedSubmit?.status === 'ACTIVE', `stale manual priority submit rejection must keep original reservation ACTIVE, actual=${reservationAfterRejectedSubmit?.status}`);
    assert(Number(reservationAfterRejectedSubmit?.quantity) === selectedQuantity, `stale manual priority submit rejection must keep reservation quantity ${selectedQuantity}, actual=${reservationAfterRejectedSubmit?.quantity}`);
    const largerBatchAfterRejectedSubmit = await prisma.inventoryBatch.findUnique({ where: { id: largerBatch.id } });
    const smallerBatchAfterRejectedSubmit = await prisma.inventoryBatch.findUnique({ where: { id: smallerBatch.id } });
    assert(Number(largerBatchAfterRejectedSubmit?.quantity) === 6, `stale manual priority submit rejection must not consume larger batch, actual=${largerBatchAfterRejectedSubmit?.quantity}`);
    assert(Number(smallerBatchAfterRejectedSubmit?.quantity) === smallerQuantity, `stale manual priority submit rejection must not consume smaller batch, actual=${smallerBatchAfterRejectedSubmit?.quantity}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `stale manual priority submit rejection must not create InventoryTransaction, actual=${transactionCount}`);
    const orderBatchCount = await prisma.inventoryBatch.count({
      where: { sourceOrderId: draftOrder.id, sourceOrderLineId: draftLine.id, sourceOrderNo: orderNo, partCode }
    });
    assert(orderBatchCount === 0, `stale manual priority submit rejection must not create order inventory batch, actual=${orderBatchCount}`);
  } finally {
    await cleanupStaleManualPrioritySubmitCase();
    await prisma.$disconnect();
  }
}

async function assertCreateRejectsStockSourceDrawingSnapshotMismatchWithoutManualConfirmation() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-DRAWING-MISMATCH`;
  const fileNameMismatchOrderNo = `${orderPrefix}-STOCK-DRAWING-FILENAME-MISMATCH`;
  const fileMismatchOrderNo = `${orderPrefix}-STOCK-DRAWING-FILE-MISMATCH`;
  const missingFileNameOrderNo = `${orderPrefix}-STOCK-DRAWING-FILENAME-MISSING`;
  const missingFileOrderNo = `${orderPrefix}-STOCK-DRAWING-FILE-MISSING`;
  const missingSourceDrawingOrderNo = `${orderPrefix}-STOCK-SOURCE-DRAWING-MISSING`;
  const reworkMissingFileOrderNo = `${orderPrefix}-REWORK-DRAWING-FILE-MISSING`;
  const partNameMismatchOrderNo = `${orderPrefix}-STOCK-PARTNAME-MISMATCH`;
  const unitMismatchOrderNo = `${orderPrefix}-STOCK-UNIT-MISMATCH`;
  const projectModelMismatchOrderNo = `${orderPrefix}-STOCK-PROJECT-MISMATCH`;
  const partCategoryMismatchOrderNo = `${orderPrefix}-STOCK-CATEGORY-MISMATCH`;
  const sourceOrderNo = `${orderPrefix}-STOCK-DRAWING-MISMATCH-SOURCE`;
  const missingSourceDrawingSourceOrderNo = `${orderPrefix}-STOCK-SOURCE-DRAWING-MISSING-SOURCE`;
  const customerCode = `${orderPrefix}-STOCK-DRAWING-MISMATCH-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-DRAWING-MISMATCH-WH`;
  const locationCode = `${orderPrefix}-STOCK-DRAWING-MISMATCH-LOC`;
  const partCode = `${materialPrefix}-STOCK-DRAWING-MISMATCH`;
  const batchNo = `${orderPrefix}-STOCK-DRAWING-MISMATCH-BATCH`;
  const missingSourceDrawingBatchNo = `${orderPrefix}-STOCK-SOURCE-DRAWING-MISSING-BATCH`;

  async function cleanupDrawingMismatchCase() {
    const orderNos = [
      orderNo,
      fileNameMismatchOrderNo,
      fileMismatchOrderNo,
      missingFileNameOrderNo,
      missingFileOrderNo,
      missingSourceDrawingOrderNo,
      reworkMissingFileOrderNo,
      partNameMismatchOrderNo,
      unitMismatchOrderNo,
      projectModelMismatchOrderNo,
      partCategoryMismatchOrderNo,
      sourceOrderNo,
      missingSourceDrawingSourceOrderNo
    ];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { OR: [{ orderNo: { in: orderNos } }, { partCode }] } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupDrawingMismatchCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '库存来源图纸快照不一致回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '库存来源图纸快照不一致回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '库存来源图纸快照不一致回归仓库',
      locationCode,
      locationName: '库存来源图纸快照不一致回归库位'
    });
    const sourceOrder = await prisma.customerOrder.create({
      data: {
        orderNo: sourceOrderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-07-14T00:00:00.000Z'),
        status: 'COMPLETED',
        lines: {
          create: [
            {
              lineNo: 1,
              partCategory: '通用件',
              partCode,
              partName: '库存来源图纸快照不一致回归零件',
              drawingNo: `VERIFY-${runId}-STOCK-DRAWING-MISMATCH`,
              drawingVersion: 'A',
              drawingDate: new Date('2026-07-14T00:00:00.000Z'),
              drawingStatus: '旧图',
              drawingFileName: 'drawing-mismatch-source.pdf',
              drawingFileUrl: '/verify/drawing-mismatch-source.pdf',
              partThickness: 1,
              partSpecification: '100mm x 100mm',
              projectModel: '库存来源项目型号来源',
              quantity: 4,
              productionPlanQuantity: 4,
              fulfillmentMode: 'PRODUCTION',
              unit: '件'
            }
          ]
        }
      },
      include: { lines: true }
    });
    const sourceLine = sourceOrder.lines[0];
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: sourceLine.partName,
        sourceOrderLineId: sourceLine.id,
        sourceOrderNo: sourceOrder.orderNo,
        sourceCustomerName: sourceOrder.customerName,
        quantity: 4,
        unit: sourceLine.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });
    const missingSourceDrawingOrder = await prisma.customerOrder.create({
      data: {
        orderNo: missingSourceDrawingSourceOrderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-07-14T00:00:00.000Z'),
        status: 'COMPLETED',
        lines: {
          create: [
            {
              lineNo: 1,
              partCategory: sourceLine.partCategory,
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: null,
              drawingStatus: null,
              drawingFileName: sourceLine.drawingFileName,
              drawingFileUrl: sourceLine.drawingFileUrl,
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              projectModel: sourceLine.projectModel,
              quantity: 4,
              productionPlanQuantity: 4,
              fulfillmentMode: 'PRODUCTION',
              unit: sourceLine.unit
            }
          ]
        }
      },
      include: { lines: true }
    });
    const missingSourceDrawingLine = missingSourceDrawingOrder.lines[0];
    const missingSourceDrawingBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: missingSourceDrawingBatchNo,
        partCode,
        partName: missingSourceDrawingLine.partName,
        sourceOrderLineId: missingSourceDrawingLine.id,
        sourceOrderNo: missingSourceDrawingOrder.orderNo,
        sourceCustomerName: missingSourceDrawingOrder.customerName,
        quantity: 4,
        unit: missingSourceDrawingLine.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: '库存来源图纸快照不一致',
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-15',
              drawingStatus: '新图',
              drawingFileName: 'drawing-mismatch-target.pdf',
              drawingFileUrl: '/verify/drawing-mismatch-target.pdf',
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '库存来源与订单不一致'
    );

    const rejectedOrderCount = await prisma.customerOrder.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(rejectedOrderCount === 0, `库存来源图纸快照不一致保存失败后不得生成 CustomerOrder，实际 ${rejectedOrderCount}`);
    const rejectedReservationCount = await prisma.inventoryReservation.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(rejectedReservationCount === 0, `库存来源图纸快照不一致保存失败后不得生成 InventoryReservation，实际 ${rejectedReservationCount}`);

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: fileNameMismatchOrderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: sourceLine.partCategory,
              projectModel: sourceLine.projectModel,
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-14',
              drawingStatus: sourceLine.drawingStatus,
              drawingFileName: `${sourceLine.drawingFileName}-renamed.pdf`,
              drawingFileUrl: sourceLine.drawingFileUrl,
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '图纸文件名不同'
    );

    const rejectedFileNameOrderCount = await prisma.customerOrder.count({
      where: { orderNo: { equals: fileNameMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedFileNameOrderCount === 0,
      `库存来源图纸文件名不一致保存失败后不得生成 CustomerOrder，实际 ${rejectedFileNameOrderCount}`
    );
    const rejectedFileNameReservationCount = await prisma.inventoryReservation.count({
      where: { orderNo: { equals: fileNameMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedFileNameReservationCount === 0,
      `库存来源图纸文件名不一致保存失败后不得生成 InventoryReservation，实际 ${rejectedFileNameReservationCount}`
    );

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: fileMismatchOrderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: '库存来源图纸文件不一致',
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-14',
              drawingStatus: sourceLine.drawingStatus,
              drawingFileName: 'drawing-file-mismatch-target.pdf',
              drawingFileUrl: '/verify/drawing-file-mismatch-target.pdf',
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '图纸文件不同'
    );

    const rejectedFileOrderCount = await prisma.customerOrder.count({ where: { orderNo: { equals: fileMismatchOrderNo, mode: 'insensitive' } } });
    assert(rejectedFileOrderCount === 0, `库存来源图纸文件不一致保存失败后不得生成 CustomerOrder，实际 ${rejectedFileOrderCount}`);
    const rejectedFileReservationCount = await prisma.inventoryReservation.count({
      where: { orderNo: { equals: fileMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(rejectedFileReservationCount === 0, `库存来源图纸文件不一致保存失败后不得生成 InventoryReservation，实际 ${rejectedFileReservationCount}`);

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: missingFileOrderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: '库存来源本次订单缺图纸文件',
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-14',
              drawingStatus: sourceLine.drawingStatus,
              drawingFileName: '',
              drawingFileUrl: '',
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '本次订单资料不完整'
    );

    const rejectedMissingFileOrderCount = await prisma.customerOrder.count({ where: { orderNo: { equals: missingFileOrderNo, mode: 'insensitive' } } });
    assert(rejectedMissingFileOrderCount === 0, `库存来源本次订单缺图纸文件保存失败后不得生成 CustomerOrder，实际 ${rejectedMissingFileOrderCount}`);
    const rejectedMissingFileReservationCount = await prisma.inventoryReservation.count({
      where: { orderNo: { equals: missingFileOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedMissingFileReservationCount === 0,
      `库存来源本次订单缺图纸文件保存失败后不得生成 InventoryReservation，实际 ${rejectedMissingFileReservationCount}`
    );

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: missingFileNameOrderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: sourceLine.partCategory,
              projectModel: sourceLine.projectModel,
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-14',
              drawingStatus: sourceLine.drawingStatus,
              drawingFileName: '',
              drawingFileUrl: sourceLine.drawingFileUrl,
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '本次订单资料不完整'
    );

    const rejectedMissingFileNameOrderCount = await prisma.customerOrder.count({
      where: { orderNo: { equals: missingFileNameOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedMissingFileNameOrderCount === 0,
      `库存来源本次订单缺图纸文件名保存失败后不得生成 CustomerOrder，实际 ${rejectedMissingFileNameOrderCount}`
    );
    const rejectedMissingFileNameReservationCount = await prisma.inventoryReservation.count({
      where: { orderNo: { equals: missingFileNameOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedMissingFileNameReservationCount === 0,
      `库存来源本次订单缺图纸文件名保存失败后不得生成 InventoryReservation，实际 ${rejectedMissingFileNameReservationCount}`
    );

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: missingSourceDrawingOrderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: sourceLine.partCategory,
              projectModel: sourceLine.projectModel,
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-14',
              drawingStatus: sourceLine.drawingStatus,
              drawingFileName: sourceLine.drawingFileName,
              drawingFileUrl: sourceLine.drawingFileUrl,
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: missingSourceDrawingBatch.id,
                  batchNo: missingSourceDrawingBatch.batchNo,
                  partCode,
                  partName: missingSourceDrawingBatch.partName,
                  quantity: 2,
                  unit: missingSourceDrawingBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '库存来源资料不完整：图纸日期、图纸状态'
    );

    const rejectedMissingSourceDrawingOrderCount = await prisma.customerOrder.count({
      where: { orderNo: { equals: missingSourceDrawingOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedMissingSourceDrawingOrderCount === 0,
      `库存来源批次缺图纸日期和状态保存失败后不得生成 CustomerOrder，实际 ${rejectedMissingSourceDrawingOrderCount}`
    );
    const rejectedMissingSourceDrawingReservationCount = await prisma.inventoryReservation.count({
      where: { orderNo: { equals: missingSourceDrawingOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedMissingSourceDrawingReservationCount === 0,
      `库存来源批次缺图纸日期和状态保存失败后不得生成 InventoryReservation，实际 ${rejectedMissingSourceDrawingReservationCount}`
    );

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: reworkMissingFileOrderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: '库存再加工本次订单缺图纸文件',
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-14',
              drawingStatus: sourceLine.drawingStatus,
              drawingFileName: '',
              drawingFileUrl: '',
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 2,
              fulfillmentMode: 'REWORK',
              unit: sourceLine.unit,
              processSteps: [{ processName: '激光切割' }],
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '需要填写人工确认记录'
    );

    const rejectedReworkMissingFileOrderCount = await prisma.customerOrder.count({
      where: { orderNo: { equals: reworkMissingFileOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedReworkMissingFileOrderCount === 0,
      `库存再加工本次订单缺图纸文件保存失败后不得生成 CustomerOrder，实际 ${rejectedReworkMissingFileOrderCount}`
    );
    const rejectedReworkMissingFileReservationCount = await prisma.inventoryReservation.count({
      where: { orderNo: { equals: reworkMissingFileOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedReworkMissingFileReservationCount === 0,
      `库存再加工本次订单缺图纸文件保存失败后不得生成 InventoryReservation，实际 ${rejectedReworkMissingFileReservationCount}`
    );

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: partNameMismatchOrderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: '库存来源零件名称不一致',
              partCode,
              partName: `${sourceLine.partName}-目标名称不同`,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-14',
              drawingStatus: sourceLine.drawingStatus,
              drawingFileName: sourceLine.drawingFileName,
              drawingFileUrl: sourceLine.drawingFileUrl,
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '需要填写人工确认记录'
    );

    const rejectedPartNameOrderCount = await prisma.customerOrder.count({
      where: { orderNo: { equals: partNameMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(rejectedPartNameOrderCount === 0, `库存来源零件名称不一致保存失败后不得生成 CustomerOrder，实际 ${rejectedPartNameOrderCount}`);
    const rejectedPartNameReservationCount = await prisma.inventoryReservation.count({
      where: { orderNo: { equals: partNameMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedPartNameReservationCount === 0,
      `库存来源零件名称不一致保存失败后不得生成 InventoryReservation，实际 ${rejectedPartNameReservationCount}`
    );

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: unitMismatchOrderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: '库存来源单位不一致',
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-14',
              drawingStatus: sourceLine.drawingStatus,
              drawingFileName: sourceLine.drawingFileName,
              drawingFileUrl: sourceLine.drawingFileUrl,
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: `${sourceLine.unit}-不一致`,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '单位'
    );

    const rejectedUnitOrderCount = await prisma.customerOrder.count({
      where: { orderNo: { equals: unitMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(rejectedUnitOrderCount === 0, `库存来源单位不一致保存失败后不得生成 CustomerOrder，实际 ${rejectedUnitOrderCount}`);
    const rejectedUnitReservationCount = await prisma.inventoryReservation.count({
      where: { orderNo: { equals: unitMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedUnitReservationCount === 0,
      `库存来源单位不一致保存失败后不得生成 InventoryReservation，实际 ${rejectedUnitReservationCount}`
    );

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: projectModelMismatchOrderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: `${sourceLine.projectModel}-不一致`,
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-14',
              drawingStatus: sourceLine.drawingStatus,
              drawingFileName: sourceLine.drawingFileName,
              drawingFileUrl: sourceLine.drawingFileUrl,
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '需要填写人工确认记录'
    );

    const rejectedProjectOrderCount = await prisma.customerOrder.count({
      where: { orderNo: { equals: projectModelMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(rejectedProjectOrderCount === 0, `库存来源项目型号不一致保存失败后不得生成 CustomerOrder，实际 ${rejectedProjectOrderCount}`);
    const rejectedProjectReservationCount = await prisma.inventoryReservation.count({
      where: { orderNo: { equals: projectModelMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedProjectReservationCount === 0,
      `库存来源项目型号不一致保存失败后不得生成 InventoryReservation，实际 ${rejectedProjectReservationCount}`
    );

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo: partCategoryMismatchOrderNo,
          orderDate: '2026-07-14',
          lines: [
            {
              lineType: 'PART',
              partCategory: '外协件',
              projectModel: sourceLine.projectModel,
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-14',
              drawingStatus: sourceLine.drawingStatus,
              drawingFileName: sourceLine.drawingFileName,
              drawingFileUrl: sourceLine.drawingFileUrl,
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '需要填写人工确认记录'
    );

    const rejectedPartCategoryOrderCount = await prisma.customerOrder.count({
      where: { orderNo: { equals: partCategoryMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedPartCategoryOrderCount === 0,
      `库存来源零件类型不一致保存失败后不得生成 CustomerOrder，实际 ${rejectedPartCategoryOrderCount}`
    );
    const rejectedPartCategoryReservationCount = await prisma.inventoryReservation.count({
      where: { orderNo: { equals: partCategoryMismatchOrderNo, mode: 'insensitive' } }
    });
    assert(
      rejectedPartCategoryReservationCount === 0,
      `库存来源零件类型不一致保存失败后不得生成 InventoryReservation，实际 ${rejectedPartCategoryReservationCount}`
    );
  } finally {
    await cleanupDrawingMismatchCase();
    await prisma.$disconnect();
  }
}

async function assertCreateRejectsStockSourceLineTypeMismatchWithoutManualConfirmation() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-LINETYPE-MISMATCH`;
  const sourceOrderNo = `${orderPrefix}-STOCK-LINETYPE-MISMATCH-SOURCE`;
  const customerCode = `${orderPrefix}-STOCK-LINETYPE-MISMATCH-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-LINETYPE-MISMATCH-WH`;
  const locationCode = `${orderPrefix}-STOCK-LINETYPE-MISMATCH-LOC`;
  const partCode = `${materialPrefix}-STOCK-LINETYPE-MISMATCH`;
  const batchNo = `${orderPrefix}-STOCK-LINETYPE-MISMATCH-BATCH`;

  async function cleanupLineTypeMismatchCase() {
    const orderNos = [orderNo, sourceOrderNo];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { OR: [{ orderNo: { in: orderNos } }, { partCode }] } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupLineTypeMismatchCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '库存来源行类型不一致回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '库存来源行类型不一致回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '库存来源行类型不一致回归仓库',
      locationCode,
      locationName: '库存来源行类型不一致回归库位'
    });
    const sourceOrder = await prisma.customerOrder.create({
      data: {
        orderNo: sourceOrderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-07-15T00:00:00.000Z'),
        status: 'COMPLETED',
        lines: {
          create: [
            {
              lineNo: 1,
              lineType: 'PART',
              partCode,
              partName: '库存来源行类型不一致回归零件',
              drawingNo: `VERIFY-${runId}-STOCK-LINETYPE-MISMATCH`,
              drawingVersion: 'A',
              drawingDate: new Date('2026-07-15T00:00:00.000Z'),
              drawingStatus: '新图',
              drawingFileName: 'line-type-mismatch.pdf',
              drawingFileUrl: '/verify/line-type-mismatch.pdf',
              partThickness: 1,
              partSpecification: '100mm x 100mm',
              quantity: 4,
              productionPlanQuantity: 4,
              fulfillmentMode: 'PRODUCTION',
              unit: '件'
            }
          ]
        }
      },
      include: { lines: true }
    });
    const sourceLine = sourceOrder.lines[0];
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: sourceLine.partName,
        sourceOrderLineId: sourceLine.id,
        sourceOrderNo: sourceOrder.orderNo,
        sourceCustomerName: sourceOrder.customerName,
        quantity: 4,
        unit: sourceLine.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo,
          orderDate: '2026-07-15',
          lines: [
            {
              lineType: 'COMPONENT',
              componentNo: 'C001',
              partCategory: '通用件',
              projectModel: '库存来源行类型不一致',
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-15',
              drawingStatus: '新图',
              drawingFileName: sourceLine.drawingFileName,
              drawingFileUrl: sourceLine.drawingFileUrl,
              partThickness: 0,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '需要填写人工确认记录'
    );

    const rejectedOrderCount = await prisma.customerOrder.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(rejectedOrderCount === 0, `库存来源行类型不一致保存失败后不得生成 CustomerOrder，实际 ${rejectedOrderCount}`);
    const rejectedReservationCount = await prisma.inventoryReservation.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(rejectedReservationCount === 0, `库存来源行类型不一致保存失败后不得生成 InventoryReservation，实际 ${rejectedReservationCount}`);
  } finally {
    await cleanupLineTypeMismatchCase();
    await prisma.$disconnect();
  }
}

async function assertCreateRejectsStockSourceStructureMismatchWithoutManualConfirmation() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-STRUCTURE-MISMATCH`;
  const sourceOrderNo = `${orderPrefix}-STOCK-STRUCTURE-MISMATCH-SOURCE`;
  const customerCode = `${orderPrefix}-STOCK-STRUCTURE-MISMATCH-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-STRUCTURE-MISMATCH-WH`;
  const locationCode = `${orderPrefix}-STOCK-STRUCTURE-MISMATCH-LOC`;
  const partCode = `${materialPrefix}-STOCK-STRUCTURE-MISMATCH`;
  const componentPartCode = `${materialPrefix}-STOCK-STRUCTURE-COMP`;
  const batchNo = `${orderPrefix}-STOCK-STRUCTURE-MISMATCH-BATCH`;

  async function cleanupStructureMismatchCase() {
    const orderNos = [orderNo, sourceOrderNo];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode: { in: [partCode, componentPartCode] } } });
    await prisma.inventoryReservation.deleteMany({ where: { OR: [{ orderNo: { in: orderNos } }, { partCode: { in: [partCode, componentPartCode] } }] } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode: { in: [partCode, componentPartCode] } } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupStructureMismatchCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '库存来源组件结构不一致回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '库存来源组件结构不一致回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '库存来源组件结构不一致回归仓库',
      locationCode,
      locationName: '库存来源组件结构不一致回归库位'
    });
    const sourceOrder = await prisma.customerOrder.create({
      data: {
        orderNo: sourceOrderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-07-16T00:00:00.000Z'),
        status: 'COMPLETED',
        lines: {
          create: [
            {
              lineNo: 1,
              lineType: 'COMPONENT',
              componentNo: 'C001',
              partCode: componentPartCode,
              partName: '库存来源组件结构不一致回归组件',
              drawingNo: `VERIFY-${runId}-STOCK-STRUCTURE-COMP`,
              drawingVersion: 'A',
              drawingDate: new Date('2026-07-16T00:00:00.000Z'),
              drawingStatus: '新图',
              drawingFileName: 'structure-component.pdf',
              drawingFileUrl: '/verify/structure-component.pdf',
              partThickness: 0,
              partSpecification: 'COMP',
              quantity: 1,
              productionPlanQuantity: 1,
              fulfillmentMode: 'PRODUCTION',
              unit: '件'
            },
            {
              lineNo: 2,
              lineType: 'PART',
              parentComponentNo: 'C001',
              partCode,
              partName: '库存来源组件结构不一致回归子零件',
              drawingNo: `VERIFY-${runId}-STOCK-STRUCTURE-MISMATCH`,
              drawingVersion: 'A',
              drawingDate: new Date('2026-07-16T00:00:00.000Z'),
              drawingStatus: '新图',
              drawingFileName: 'structure-child.pdf',
              drawingFileUrl: '/verify/structure-child.pdf',
              partThickness: 1,
              partSpecification: '100mm x 100mm',
              quantity: 4,
              productionPlanQuantity: 4,
              fulfillmentMode: 'PRODUCTION',
              unit: '件'
            }
          ]
        }
      },
      include: { lines: true }
    });
    const sourceLine = sourceOrder.lines.find((line) => line.partCode === partCode);
    assert(sourceLine, '库存来源组件结构不一致回归必须创建子零件来源行');
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: sourceLine.partName,
        sourceOrderLineId: sourceLine.id,
        sourceOrderNo: sourceOrder.orderNo,
        sourceCustomerName: sourceOrder.customerName,
        quantity: 4,
        unit: sourceLine.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await expectRequestFailure(
      '/orders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          orderNo,
          orderDate: '2026-07-16',
          lines: [
            {
              lineType: 'PART',
              partCategory: '通用件',
              projectModel: '库存来源组件结构不一致',
              partCode,
              partName: sourceLine.partName,
              drawingNo: sourceLine.drawingNo,
              drawingVersion: sourceLine.drawingVersion,
              drawingDate: '2026-07-16',
              drawingStatus: '新图',
              drawingFileName: sourceLine.drawingFileName,
              drawingFileUrl: sourceLine.drawingFileUrl,
              partThickness: 1,
              partSpecification: sourceLine.partSpecification,
              quantity: 2,
              productionPlanQuantity: 0,
              fulfillmentMode: 'STOCK',
              unit: sourceLine.unit,
              selectedStockSources: [
                {
                  batchId: stockBatch.id,
                  batchNo: stockBatch.batchNo,
                  partCode,
                  partName: stockBatch.partName,
                  quantity: 2,
                  unit: stockBatch.unit,
                  compatibilityStatus: 'MATCHED'
                }
              ]
            }
          ]
        })
      },
      '需要填写人工确认记录'
    );

    const rejectedOrderCount = await prisma.customerOrder.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(rejectedOrderCount === 0, `库存来源组件结构不一致保存失败后不得生成 CustomerOrder，实际 ${rejectedOrderCount}`);
    const rejectedReservationCount = await prisma.inventoryReservation.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(rejectedReservationCount === 0, `库存来源组件结构不一致保存失败后不得生成 InventoryReservation，实际 ${rejectedReservationCount}`);
  } finally {
    await cleanupStructureMismatchCase();
    await prisma.$disconnect();
  }
}

async function assertSameOrderOtherLineSelectionSatisfiesSmallerBatchPriority() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-CROSSLINE-PRIORITY`;
  const sourceOrderNo = `${orderPrefix}-STOCK-CROSSLINE-SOURCE`;
  const customerCode = `${orderPrefix}-STOCK-CROSSLINE-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-CROSSLINE-WH`;
  const locationCode = `${orderPrefix}-STOCK-CROSSLINE-LOC`;
  const partCode = `${materialPrefix}-STOCK-CROSSLINE-PRIORITY`;
  const smallerBatchNo = `${orderPrefix}-STOCK-CROSSLINE-A`;
  const largerBatchNo = `${orderPrefix}-STOCK-CROSSLINE-B`;
  const smallerQuantity = 2;
  const largerSelectedQuantity = 3;

  async function cleanupCrossLinePriorityCase() {
    const orderNos = [orderNo, sourceOrderNo];
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { OR: [{ orderNo: { in: orderNos } }, { partCode }] } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { in: orderNos } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { in: orderNos } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  function sourceSelection(stockBatch, quantity) {
    return {
      batchId: stockBatch.id,
      batchNo: stockBatch.batchNo,
      partCode,
      partName: stockBatch.partName,
      quantity,
      unit: stockBatch.unit,
      compatibilityStatus: 'MATCHED'
    };
  }

  function stockLine(stockBatch, quantity, projectModel) {
    return {
      lineType: 'PART',
      partCategory: '通用件',
      projectModel,
      partCode,
      partName: '同订单跨行小批次优先回归零件',
      drawingNo: `VERIFY-${runId}-STOCK-CROSSLINE`,
      drawingVersion: 'A',
      drawingDate: '2026-07-13',
      drawingStatus: '新图',
      drawingFileName: 'crossline-priority.pdf',
      drawingFileUrl: '/verify/crossline-priority.pdf',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity,
      productionPlanQuantity: 0,
      fulfillmentMode: 'STOCK',
      unit: '件',
      selectedStockSources: [sourceSelection(stockBatch, quantity)]
    };
  }

  try {
    await cleanupCrossLinePriorityCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '同订单跨行小批次优先回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '同订单跨行小批次优先回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '同订单跨行小批次优先回归仓库',
      locationCode,
      locationName: '同订单跨行小批次优先回归库位'
    });
    const sourceOrder = await prisma.customerOrder.create({
      data: {
        orderNo: sourceOrderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-07-13T00:00:00.000Z'),
        status: 'COMPLETED',
        lines: {
          create: [
            {
              lineNo: 1,
              partCategory: '通用件',
              partCode,
              partName: '同订单跨行小批次优先回归零件',
              projectModel: '同订单跨行小批次优先',
              drawingNo: `VERIFY-${runId}-STOCK-CROSSLINE`,
              drawingVersion: 'A',
              drawingDate: new Date('2026-07-13T00:00:00.000Z'),
              drawingStatus: '新图',
              drawingFileName: 'crossline-priority.pdf',
              drawingFileUrl: '/verify/crossline-priority.pdf',
              partThickness: 1,
              partSpecification: '100mm x 100mm',
              quantity: 8,
              productionPlanQuantity: 8,
              fulfillmentMode: 'PRODUCTION',
              unit: '件'
            }
          ]
        }
      },
      include: { lines: true }
    });
    const sourceLine = sourceOrder.lines[0];
    const smallerBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: smallerBatchNo,
        partCode,
        partName: sourceLine.partName,
        sourceOrderLineId: sourceLine.id,
        sourceOrderNo: sourceOrder.orderNo,
        sourceCustomerName: sourceOrder.customerName,
        quantity: smallerQuantity,
        unit: sourceLine.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });
    const largerBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo: largerBatchNo,
        partCode,
        partName: sourceLine.partName,
        sourceOrderLineId: sourceLine.id,
        sourceOrderNo: sourceOrder.orderNo,
        sourceCustomerName: sourceOrder.customerName,
        quantity: 6,
        unit: sourceLine.unit,
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-07-13',
        lines: [
          stockLine(largerBatch, largerSelectedQuantity, '同订单跨行小批次优先'),
          stockLine(smallerBatch, smallerQuantity, '同订单跨行小批次优先')
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: { orderBy: { lineNo: 'asc' } } }
    });
    assert(draftOrder?.id, '同订单跨行小批次优先草稿必须写入数据库');
    const reservations = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, status: 'ACTIVE' },
      orderBy: [{ orderLineId: 'asc' }, { createdAt: 'asc' }]
    });
    assert(reservations.length === 2, `同订单跨行小批次优先草稿应创建 2 条 ACTIVE InventoryReservation，实际 ${reservations.length}`);
    assert(
      reservations.some((reservation) => reservation.batchId === smallerBatch.id && Number(reservation.quantity) === smallerQuantity),
      '同订单跨行小批次优先草稿必须预占已用满的小批次'
    );
    assert(
      reservations.some((reservation) => reservation.batchId === largerBatch.id && Number(reservation.quantity) === largerSelectedQuantity),
      '同订单跨行小批次优先草稿必须预占较大批次'
    );

    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });

    const largerBatchAfterSubmit = await prisma.inventoryBatch.findUnique({ where: { id: largerBatch.id } });
    const smallerBatchAfterSubmit = await prisma.inventoryBatch.findUnique({ where: { id: smallerBatch.id } });
    assert(Number(largerBatchAfterSubmit?.quantity) === 3, `同订单跨行小批次优先提交后较大批次应剩余 3，实际 ${largerBatchAfterSubmit?.quantity}`);
    assert(Number(smallerBatchAfterSubmit?.quantity) === 0, `同订单跨行小批次优先提交后较小批次应被用完，实际 ${smallerBatchAfterSubmit?.quantity}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `同订单跨行小批次优先全库存覆盖不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupCrossLinePriorityCase();
    await prisma.$disconnect();
  }
}

async function assertSubmittedStockOrderCannotBeSubmittedAgain() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-RESUBMIT`;
  const customerCode = `${orderPrefix}-STOCK-RESUBMIT-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-RESUBMIT-WH`;
  const locationCode = `${orderPrefix}-STOCK-RESUBMIT-LOC`;
  const partCode = `${materialPrefix}-STOCK-RESUBMIT`;
  const batchNo = `${orderPrefix}-STOCK-RESUBMIT-BATCH`;
  const selectedQuantity = 4;

  async function cleanupResubmitStockOrderCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupResubmitStockOrderCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '库存订单重复提交保护回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '库存订单重复提交保护回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '库存订单重复提交保护回归仓库',
      locationCode,
      locationName: '库存订单重复提交保护回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '库存订单重复提交保护回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-06-30',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '库存订单重复提交保护',
            partCode,
            partName: '库存订单重复提交保护回归零件',
            drawingNo: `VERIFY-${runId}-STOCK-RESUBMIT`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: selectedQuantity,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            unit: '件',
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: selectedQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同编码同单位库存来源',
                manualConfirmedBy: 'verify-stock-resubmit',
                manualConfirmedAt: '2026-06-30T08:00:00.000Z',
                manualConfirmRemark: '回归验证人工确认库存来源可用于本订单'
              }
            ]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(draftOrder?.id, '库存订单重复提交保护订单必须写入数据库');
    const draftLine = draftOrder.lines[0];

    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });

    const orderAfterFirstSubmit = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(orderAfterFirstSubmit?.status === 'PENDING_PRODUCTION', `库存订单首次提交后必须是 PENDING_PRODUCTION，实际 ${orderAfterFirstSubmit?.status}`);
    const sourceBatchAfterFirstSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(sourceBatchAfterFirstSubmit?.quantity) === 2, `库存订单首次提交后原备货批次应剩余 2，实际 ${sourceBatchAfterFirstSubmit?.quantity}`);
    const reservationsAfterFirstSubmit = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, orderLineId: draftLine.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(
      reservationsAfterFirstSubmit.length === 1 && reservationsAfterFirstSubmit.every((reservation) => reservation.status === 'CONSUMED'),
      `库存订单首次提交后草稿预占必须转为 1 条 CONSUMED，实际 ${reservationsAfterFirstSubmit.map((reservation) => reservation.status).join(',')}`
    );
    const transactionCountAfterFirstSubmit = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCountAfterFirstSubmit === 2, `库存订单首次提交后必须生成 2 条 InventoryTransaction，实际 ${transactionCountAfterFirstSubmit}`);
    const orderBatchCountAfterFirstSubmit = await prisma.inventoryBatch.count({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderLineId: draftLine.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(orderBatchCountAfterFirstSubmit === 1, `库存订单首次提交后必须生成 1 个订单待发货库存批次，实际 ${orderBatchCountAfterFirstSubmit}`);
    const taskCountAfterFirstSubmit = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCountAfterFirstSubmit === 0, `库存订单首次全库存覆盖不得生成 ProductionTask，实际 ${taskCountAfterFirstSubmit}`);

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      '只有待提交生产订单可以提交生产'
    );

    const orderAfterSecondSubmit = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(orderAfterSecondSubmit?.status === 'PENDING_PRODUCTION', `重复提交库存订单后订单状态必须保持 PENDING_PRODUCTION，实际 ${orderAfterSecondSubmit?.status}`);
    const sourceBatchAfterSecondSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(sourceBatchAfterSecondSubmit?.quantity) === 2, `重复提交库存订单后原备货批次数量不得继续减少，实际 ${sourceBatchAfterSecondSubmit?.quantity}`);
    const reservationsAfterSecondSubmit = await prisma.inventoryReservation.findMany({
      where: { orderId: draftOrder.id, orderLineId: draftLine.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    assert(
      reservationsAfterSecondSubmit.length === reservationsAfterFirstSubmit.length &&
        reservationsAfterSecondSubmit.every((reservation) => reservation.status === 'CONSUMED'),
      '重复提交库存订单后不得新增或回退 InventoryReservation'
    );
    const transactionCountAfterSecondSubmit = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(
      transactionCountAfterSecondSubmit === transactionCountAfterFirstSubmit,
      `重复提交库存订单后不得新增 InventoryTransaction，实际 ${transactionCountAfterSecondSubmit}`
    );
    const orderBatchCountAfterSecondSubmit = await prisma.inventoryBatch.count({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderLineId: draftLine.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(
      orderBatchCountAfterSecondSubmit === orderBatchCountAfterFirstSubmit,
      `重复提交库存订单后不得新增订单待发货库存批次，实际 ${orderBatchCountAfterSecondSubmit}`
    );
    const taskCountAfterSecondSubmit = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCountAfterSecondSubmit === taskCountAfterFirstSubmit, `重复提交库存订单后不得生成 ProductionTask，实际 ${taskCountAfterSecondSubmit}`);
  } finally {
    await cleanupResubmitStockOrderCase();
    await prisma.$disconnect();
  }
}

async function assertSubmitRejectsMismatchedDraftStockReservation() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-RESERVATION-MISMATCH`;
  const customerCode = `${orderPrefix}-STOCK-MISMATCH-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-MISMATCH-WH`;
  const locationCode = `${orderPrefix}-STOCK-MISMATCH-LOC`;
  const partCode = `${materialPrefix}-STOCK-MISMATCH`;
  const batchNo = `${orderPrefix}-STOCK-MISMATCH-BATCH`;
  const selectedQuantity = 4;

  async function cleanupSubmitStockMismatchCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupSubmitStockMismatchCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '提交生产库存预占异常回滚回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '提交生产库存预占异常回滚回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '提交生产库存预占异常回滚回归仓库',
      locationCode,
      locationName: '提交生产库存预占异常回滚回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '提交生产库存预占异常回滚回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-06-26',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '库存预占异常回滚',
            partCode,
            partName: '提交生产库存预占异常回滚回归零件',
            drawingNo: `VERIFY-${runId}-STOCK-MISMATCH`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: selectedQuantity,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            unit: '件',
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: selectedQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同编码同单位库存来源',
                manualConfirmedBy: 'verify-stock-reservation-mismatch',
                manualConfirmedAt: '2026-06-26T08:00:00.000Z',
                manualConfirmRemark: '回归验证人工确认库存来源可用于本订单'
              }
            ]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(draftOrder?.id, '库存预占异常回滚订单必须写入数据库');
    const draftLine = draftOrder.lines[0];
    const activeReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: draftLine.id,
        batchId: stockBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(activeReservation, '库存预占异常回滚草稿必须先创建 ACTIVE InventoryReservation');
    await prisma.inventoryReservation.update({
      where: { id: activeReservation.id },
      data: { quantity: 3, statusReason: 'VERIFY_MISMATCH_ACTIVE_RESERVATION' }
    });

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      '草稿预占数量异常'
    );

    const orderAfterRejectedSubmit = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(orderAfterRejectedSubmit?.status === 'DRAFT', `库存预占异常提交失败后订单必须保持 DRAFT，实际 ${orderAfterRejectedSubmit?.status}`);
    const reservationAfterRejectedSubmit = await prisma.inventoryReservation.findUnique({ where: { id: activeReservation.id } });
    assert(reservationAfterRejectedSubmit?.status === 'ACTIVE', `库存预占异常提交失败后预占必须保持 ACTIVE，实际 ${reservationAfterRejectedSubmit?.status}`);
    assert(Number(reservationAfterRejectedSubmit?.quantity) === 3, `库存预占异常提交失败后预占数量必须保持 3，实际 ${reservationAfterRejectedSubmit?.quantity}`);
    assert(!reservationAfterRejectedSubmit?.consumedAt, '库存预占异常提交失败后不得写入 consumedAt');
    assert(!reservationAfterRejectedSubmit?.releasedAt, '库存预占异常提交失败后不得写入 releasedAt');
    const batchAfterRejectedSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterRejectedSubmit?.quantity) === 6, `库存预占异常提交失败后原备货批次数量必须保持 6，实际 ${batchAfterRejectedSubmit?.quantity}`);
    assert(batchAfterRejectedSubmit?.status === 'AVAILABLE', `库存预占异常提交失败后原备货批次必须保持 AVAILABLE，实际 ${batchAfterRejectedSubmit?.status}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `库存预占异常提交失败后不得残留 InventoryTransaction，实际 ${transactionCount}`);
    const orderBatchCount = await prisma.inventoryBatch.count({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderLineId: draftLine.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(orderBatchCount === 0, `库存预占异常提交失败后不得生成订单待发货库存批次，实际 ${orderBatchCount}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `库存预占异常提交失败后不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupSubmitStockMismatchCase();
    await prisma.$disconnect();
  }
}

async function assertSubmitRejectsMissingDraftStockReservation() {
  const prisma = new PrismaClient();
  const orderNo = `${orderPrefix}-STOCK-RESERVATION-MISSING`;
  const customerCode = `${orderPrefix}-STOCK-MISSING-CUST`;
  const warehouseCode = `${orderPrefix}-STOCK-MISSING-WH`;
  const locationCode = `${orderPrefix}-STOCK-MISSING-LOC`;
  const partCode = `${materialPrefix}-STOCK-MISSING`;
  const batchNo = `${orderPrefix}-STOCK-MISSING-BATCH`;
  const selectedQuantity = 4;

  async function cleanupSubmitStockMissingCase() {
    await prisma.inventoryTransaction.deleteMany({ where: { partCode } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryBatch.deleteMany({ where: { partCode } });
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode);
    await softDisableCustomerByCode(prisma, customerCode);
  }

  try {
    await cleanupSubmitStockMissingCase();
    const customer = await createRegressionCustomerRecord(prisma, {
      data: {
        customerCode,
        customerName: '提交生产库存预占缺失回滚回归客户',
        regionType: 'CHINA',
        country: '中国',
        province: '江苏省',
        city: '苏州市',
        detailAddress: '提交生产库存预占缺失回滚回归地址'
      }
    });
    const { warehouse, location } = await upsertOrderImportWarehouseWithLocation(prisma, {
      warehouseCode,
      warehouseName: '提交生产库存预占缺失回滚回归仓库',
      locationCode,
      locationName: '提交生产库存预占缺失回滚回归库位'
    });
    const stockBatch = await prisma.inventoryBatch.create({
      data: {
        batchNo,
        partCode,
        partName: '提交生产库存预占缺失回滚回归零件',
        quantity: 6,
        unit: '件',
        warehouseId: warehouse.id,
        locationId: location.id,
        status: 'AVAILABLE'
      }
    });

    await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-06-27',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '库存预占缺失回滚',
            partCode,
            partName: '提交生产库存预占缺失回滚回归零件',
            drawingNo: `VERIFY-${runId}-STOCK-MISSING`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: selectedQuantity,
            productionPlanQuantity: 0,
            fulfillmentMode: 'STOCK',
            unit: '件',
            selectedStockSources: [
              {
                batchId: stockBatch.id,
                batchNo: stockBatch.batchNo,
                partCode,
                partName: stockBatch.partName,
                quantity: selectedQuantity,
                unit: stockBatch.unit,
                compatibilityStatus: 'MATCHED',
                compatibilityReason: '同编码同单位库存来源',
                manualConfirmedBy: 'verify-stock-reservation-missing',
                manualConfirmedAt: '2026-06-27T08:00:00.000Z',
                manualConfirmRemark: '回归验证人工确认库存来源可用于本订单'
              }
            ]
          }
        ]
      })
    });

    const draftOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    assert(draftOrder?.id, '库存预占缺失回滚订单必须写入数据库');
    const draftLine = draftOrder.lines[0];
    const activeReservation = await prisma.inventoryReservation.findFirst({
      where: {
        orderId: draftOrder.id,
        orderLineId: draftLine.id,
        batchId: stockBatch.id,
        status: 'ACTIVE'
      }
    });
    assert(activeReservation, '库存预占缺失回滚草稿必须先创建 ACTIVE InventoryReservation');
    await prisma.inventoryReservation.delete({ where: { id: activeReservation.id } });

    await expectRequestFailure(
      `/orders/${encodeURIComponent(orderNo)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submittedByCode: 'PLAN-001' })
      },
      '缺少草稿库存预占记录'
    );

    const orderAfterRejectedSubmit = await prisma.customerOrder.findUnique({ where: { id: draftOrder.id } });
    assert(orderAfterRejectedSubmit?.status === 'DRAFT', `库存预占缺失提交失败后订单必须保持 DRAFT，实际 ${orderAfterRejectedSubmit?.status}`);
    const batchAfterRejectedSubmit = await prisma.inventoryBatch.findUnique({ where: { id: stockBatch.id } });
    assert(Number(batchAfterRejectedSubmit?.quantity) === 6, `库存预占缺失提交失败后原备货批次数量必须保持 6，实际 ${batchAfterRejectedSubmit?.quantity}`);
    assert(batchAfterRejectedSubmit?.status === 'AVAILABLE', `库存预占缺失提交失败后原备货批次必须保持 AVAILABLE，实际 ${batchAfterRejectedSubmit?.status}`);
    const transactionCount = await prisma.inventoryTransaction.count({ where: { partCode } });
    assert(transactionCount === 0, `库存预占缺失提交失败后不得残留 InventoryTransaction，实际 ${transactionCount}`);
    const orderBatchCount = await prisma.inventoryBatch.count({
      where: {
        sourceOrderId: draftOrder.id,
        sourceOrderLineId: draftLine.id,
        sourceOrderNo: orderNo,
        partCode
      }
    });
    assert(orderBatchCount === 0, `库存预占缺失提交失败后不得生成订单待发货库存批次，实际 ${orderBatchCount}`);
    const taskCount = await prisma.productionTask.count({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    assert(taskCount === 0, `库存预占缺失提交失败后不得生成 ProductionTask，实际 ${taskCount}`);
  } finally {
    await cleanupSubmitStockMissingCase();
    await prisma.$disconnect();
  }
}

async function assertImportMissingThicknessDraftRequiresReview(customerName) {
  const orderNo = `${orderPrefix}-MISSING-THICKNESS`;
  const partCode = `${materialPrefix}-MISSING-THICKNESS`;
  const session = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: `verify-missing-thickness-${runId}` })
  });
  importSessionIds.push(session.id);

  const upload = await uploadWorkbook(
    session.id,
    await buildWorkbookBufferFromRows([
      [
        1,
        orderNo,
        '2026/6/23',
        customerName,
        '缺厚度提交拦截',
        '零件',
        1,
        '通用件',
        '',
        '',
        partCode,
        `VERIFY-${runId}-MISSING-THICKNESS`,
        '缺厚度待核对零件',
        '100mm x 100mm',
        '',
        1,
        '',
        1,
        '件',
        '',
        '缺厚度应保存为草稿待核对',
        '',
        '旧图'
      ]
    ]),
    `order-import-missing-thickness-${runId}.xlsx`
  );
  assert(upload.summary.orderCount === 1, `缺厚度回归应只预览 1 个订单，实际 ${upload.summary.orderCount}`);
  assert(upload.summary.selectableOrderCount === 1, `缺厚度订单应允许导入草稿，实际可导入 ${upload.summary.selectableOrderCount}`);
  assert(upload.summary.errorCount === 0, `缺厚度订单不应在导入预览阶段变成错误订单，实际错误 ${upload.summary.errorCount}`);
  assert(upload.summary.warningCount > 0, '缺厚度订单应在导入预览阶段产生待核对警告');
  const previewLine = upload.orders?.[0]?.rows?.find((row) => row.partCode === partCode);
  assert(previewLine, '缺厚度回归订单必须返回预览零件行');
  assert(Number(previewLine.partThickness || 0) === 0, `缺厚度预览行必须保留为 0 待核对，实际 ${previewLine.partThickness}`);
  assert(
    previewLine.issues?.some((issue) => issue.code === 'THICKNESS_DEFAULTED' && issue.message.includes('待核对')),
    '缺厚度预览行必须带 THICKNESS_DEFAULTED 待核对警告'
  );

  const commit = await requestJson(`/orders/import-sessions/${session.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allSelectable: true, previewToken: upload.previewToken })
  });
  assert(commit.createdCount === 1, `缺厚度草稿应能创建 1 个订单，实际 ${commit.createdCount}`);
  assert(commit.committedOrderNos?.includes(orderNo), '缺厚度草稿提交响应必须返回创建的订单号');
  createdOrderNos.push(orderNo);

  const createdOrder = await requestJson(`/orders/${encodeURIComponent(orderNo)}`);
  const createdLine = createdOrder.lines?.find((line) => line.partCode === partCode);
  assert(createdOrder.status === 'DRAFT', `缺厚度导入只能创建 DRAFT 草稿，实际 ${createdOrder.status}`);
  assert(Number(createdLine?.partThickness || 0) === 0, `缺厚度导入后数据库草稿必须保留 0 待核对，实际 ${createdLine?.partThickness}`);

  let rejected = false;
  try {
    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
  } catch (error) {
    rejected = true;
    assert(
      String(error.message || '').includes('厚度必须大于 0'),
      `缺厚度草稿提交生产必须被厚度校验拦截，实际错误：${error.message}`
    );
  }
  assert(rejected, '缺厚度草稿不得绕过待核对直接提交生产');
}

async function assertOrderImportDrawingVersionSnapshot(customerName) {
  const versionSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-order-import-drawing-version' })
  });
  importSessionIds.push(versionSession.id);
  const upload = await uploadWorkbook(
    versionSession.id,
    await buildDrawingVersionWorkbookBuffer(customerName),
    `order-import-drawing-version-${runId}.xlsx`
  );
  const previewLine = upload.orders?.[0]?.rows?.find((row) => row.partCode === `${materialPrefix}-DRAWING-VERSION`);
  assert(previewLine?.drawingVersion === 'B', `订单导入预览必须保留图纸版本 B，实际 ${previewLine?.drawingVersion}`);
  const commit = await requestJson(`/orders/import-sessions/${versionSession.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allSelectable: true, previewToken: upload.previewToken })
  });
  assert(commit.createdCount === 1, `图纸版本导入应创建 1 个草稿订单，实际 ${commit.createdCount}`);
  createdOrderNos.push(`${orderPrefix}-DRAWING-VERSION`);
  const order = await requestJson(`/orders/${encodeURIComponent(`${orderPrefix}-DRAWING-VERSION`)}`);
  const line = order.lines.find((item) => item.partCode === `${materialPrefix}-DRAWING-VERSION`);
  assert(line?.drawingVersion === 'B', `订单行图纸版本快照必须保留 B，实际 ${line?.drawingVersion}`);
  await assertImportSourcePreview(order);
}

async function assertSubmitRejectsUnconfirmedMaterialIdentityConflict(customerName) {
  const orderNo = `${orderPrefix}-IDENTITY-BLOCK`;
  const partCode = `${materialPrefix}-IDENTITY-001`;
  const prisma = new PrismaClient();
  try {
    const customer = await prisma.customer.findFirst({
      where: { customerName },
      orderBy: { createdAt: 'asc' }
    });
    assert(customer, `未找到客户 ${customerName}，无法验证同编码多套历史资料提交拦截`);
    await prisma.customerOrder.deleteMany({ where: { orderNo } });
    await prisma.customerOrder.create({
      data: {
        orderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-06-22T00:00:00.000Z'),
        status: 'DRAFT',
        lines: {
          create: [
            {
              lineNo: 1,
              partCode,
              partName: '身份冲突验证件A',
              drawingNo: `IDENTITY-${runId}-A`,
              drawingVersion: 'A',
              partThickness: 1,
              partSpecification: '100mm x 100mm',
              quantity: 1,
              productionPlanQuantity: 1,
              fulfillmentMode: 'PRODUCTION',
              unit: '件',
              lineType: 'PART',
              projectModel: '身份冲突A'
            },
            {
              lineNo: 2,
              partCode,
              partName: '身份冲突验证件B',
              drawingNo: `IDENTITY-${runId}-B`,
              drawingVersion: 'B',
              partThickness: 2,
              partSpecification: '200mm x 200mm',
              quantity: 1,
              productionPlanQuantity: 1,
              fulfillmentMode: 'PRODUCTION',
              unit: '件',
              lineType: 'PART',
              projectModel: '身份冲突B'
            }
          ]
        }
      }
    });
    createdOrderNos.push(orderNo);
  } finally {
    await prisma.$disconnect();
  }

  let rejectedWithoutConfirmation = false;
  try {
    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
  } catch (error) {
    rejectedWithoutConfirmation = true;
    assert(
      String(error.message || '').includes('发现同编码多套历史资料零件，提交生产前必须确认已核对'),
      `提交生产必须先拦截未确认的同编码多套历史资料风险，实际错误：${error.message}`
    );
  }
  assert(rejectedWithoutConfirmation, '提交生产必须拒绝未确认的同编码多套历史资料风险');

  let rejectedAfterConfirmation = false;
  try {
    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001', materialIdentityConfirmed: true })
    });
  } catch (error) {
    rejectedAfterConfirmation = true;
    assert(
      !String(error.message || '').includes('同编码多套历史资料'),
      `带 materialIdentityConfirmed 后不应继续被同编码资料风险拦截，实际错误：${error.message}`
    );
  }
  assert(rejectedAfterConfirmation, '带确认标记后仍应继续执行后续提交校验，而不是绕过所有校验');
}

async function assertSelectedCommitSupportsUnloadedOrders(customerName) {
  const uploadDir = await orderImportUploadDir();
  const selectedSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-selected-unloaded-order' })
  });
  importSessionIds.push(selectedSession.id);
  await uploadWorkbook(
    selectedSession.id,
    await buildSelectedCommitWorkbookBuffer(customerName),
    `order-import-selected-${runId}.xlsx`
  );
  const firstPage = await requestJson(`/orders/import-sessions/${selectedSession.id}?orderLimit=1&orderOffset=0`);
  assert(firstPage.orders.length === 1, `分页预览应只加载 1 个订单，实际 ${firstPage.orders.length}`);
  assert(firstPage.orderPage?.hasMore === true, '分页预览应提示还有未加载订单');
  assert(
    !firstPage.orders.some((order) => order.orderNo === `${orderPrefix}-PAGE-003`),
    '分页外订单不应出现在第一页预览中'
  );
  const selectedCommit = await requestJson(`/orders/import-sessions/${selectedSession.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderNos: [`${orderPrefix}-PAGE-003`], previewToken: firstPage.previewToken })
  });
  assert(selectedCommit.createdCount === 1, `只创建分页外已选订单时应创建 1 个草稿，实际 ${selectedCommit.createdCount}`);
  assert(selectedCommit.materialSyncCount === 1, `分页外已选订单应补建 1 个缺失零件搜索记忆，实际 ${selectedCommit.materialSyncCount}`);
  assert(
    selectedCommit.materialSyncPreview?.[0] === `${materialPrefix}-PAGE-003`,
    `分页外已选订单应返回零件编码示例 ${materialPrefix}-PAGE-003，实际 ${selectedCommit.materialSyncPreview}`
  );
  assert(
    selectedCommit.committedOrderNos?.[0] === `${orderPrefix}-PAGE-003`,
    '后端必须支持创建未加载预览页中的已选订单号'
  );
  createdOrderNos.push(`${orderPrefix}-PAGE-003`);

  const committedRejectedFileName = `order-import-committed-reject-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    selectedSession.id,
    await buildSelectedCommitWorkbookBuffer(customerName),
    '400 Bad Request',
    committedRejectedFileName
  );
  assertNoStoredImportFilesMatching(
    uploadDir,
    committedRejectedFileName.replace(/\.xlsx$/i, ''),
    'committed import session rejected upload'
  );
}

async function assertAllSelectableCommitSupportsExcludedOrders(customerName) {
  const excludedSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-all-selectable-excluded' })
  });
  importSessionIds.push(excludedSession.id);

  const preview = await uploadWorkbook(
    excludedSession.id,
    await buildExcludedCommitWorkbookBuffer(customerName),
    `order-import-excluded-${runId}.xlsx`
  );
  const selectable = await requestJson(`/orders/import-sessions/${excludedSession.id}/selectable-order-nos`);
  assert(selectable.orderNos.length === 3, `排除提交验证应有 3 个可导入订单，实际 ${selectable.orderNos.length}`);
  assert(
    selectable.orders?.some((order) => order.orderNo === `${orderPrefix}-EXCLUDE-002` && order.warningCount > 0),
    '可选订单号接口必须返回每个可导入订单的警告数量，便于前端按实际勾选范围确认'
  );
  await commitImportSessionExpectFailure(
    excludedSession.id,
    {
      orderNos: [`${orderPrefix}-EXCLUDE-001`],
      excludedOrderNos: [`${orderPrefix}-EXCLUDE-002`],
      previewToken: preview.previewToken
    },
    '只有全部可导入模式'
  );
  await commitImportSessionExpectFailure(
    excludedSession.id,
    {
      allSelectable: true,
      excludedOrderNos: [`${orderPrefix}-EXCLUDE-002`, `${orderPrefix}-EXCLUDE-002`],
      previewToken: preview.previewToken
    },
    '排除的订单编号存在空值或重复'
  );
  await commitImportSessionExpectFailure(
    excludedSession.id,
    {
      allSelectable: true,
      excludedOrderNos: [`${orderPrefix}-EXCLUDE-MISSING`],
      previewToken: preview.previewToken
    },
    '排除的订单不存在或已不可导入'
  );

  const commit = await requestJson(`/orders/import-sessions/${excludedSession.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      allSelectable: true,
      excludedOrderNos: [`${orderPrefix}-EXCLUDE-002`],
      previewToken: preview.previewToken
    })
  });
  assert(commit.createdCount === 2, `全部可导入排除 1 个订单后应创建 2 个草稿，实际 ${commit.createdCount}`);
  assert(commit.materialSyncCount === 2, `全部可导入排除 1 个订单后应补建 2 个缺失零件搜索记忆，实际 ${commit.materialSyncCount}`);
  assert(
    commit.materialSyncPreview?.includes(`${materialPrefix}-EXCLUDE-001`) &&
      !commit.materialSyncPreview?.includes(`${materialPrefix}-EXCLUDE-002`),
    `排除提交的零件编码示例不应包含被排除订单零件，实际 ${commit.materialSyncPreview}`
  );
  assert(commit.excludedOrderCount === 1, `全部可导入排除提交应返回 excludedOrderCount=1，实际 ${commit.excludedOrderCount}`);
  assert(
    commit.skippedSelectableCount === 1,
    `全部可导入排除提交应返回 skippedSelectableCount=1，实际 ${commit.skippedSelectableCount}`
  );
  assert(
    commit.committedOrderNos.includes(`${orderPrefix}-EXCLUDE-001`) &&
      commit.committedOrderNos.includes(`${orderPrefix}-EXCLUDE-003`) &&
      !commit.committedOrderNos.includes(`${orderPrefix}-EXCLUDE-002`),
    'allSelectable + excludedOrderNos 必须只创建未排除的可导入订单'
  );
  createdOrderNos.push(`${orderPrefix}-EXCLUDE-001`, `${orderPrefix}-EXCLUDE-003`);
}

async function assertStaleImportPreviewTokenRejectsCommit(customerName) {
  const staleSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-stale-preview-token' })
  });
  importSessionIds.push(staleSession.id);

  const firstPreview = await uploadWorkbook(
    staleSession.id,
    await buildSelectedCommitWorkbookBuffer(customerName),
    `order-import-stale-token-a-${runId}.xlsx`
  );
  assert(firstPreview.previewToken, '导入预览必须返回 previewToken');

  await commitImportSessionExpectFailure(
    staleSession.id,
    { allSelectable: true },
    'previewToken'
  );

  await uploadWorkbook(
    staleSession.id,
    await buildSplitWorkbookBuffer(customerName, [
      ['组件', 1, '定制件', 'C001', '', `${materialPrefix}-STALE-001`, `VERIFY-${runId}-STALE-00`, '旧预览令牌验证组件', '', '2mm', 3, 1, 3, '套', '装配', '新增文件后旧预览必须失效', '', '旧图']
    ]),
    `order-import-stale-token-b-${runId}.xlsx`
  );

  await commitImportSessionExpectFailure(
    staleSession.id,
    { allSelectable: true, previewToken: firstPreview.previewToken },
    '导入预览已变化'
  );
  const afterRejectedCommit = await requestJson(`/orders/import-sessions/${staleSession.id}`);
  assert(afterRejectedCommit.status === 'DRAFT', '旧 previewToken 被拒绝后导入会话必须仍保持 DRAFT，允许刷新后重新提交');
  assert(
    afterRejectedCommit.previewToken && afterRejectedCommit.previewToken !== firstPreview.previewToken,
    '新增上传文件后刷新预览必须生成新的 previewToken'
  );
}

async function assertRejectedAndDuplicateUploadsStayClean(customerName) {
  const uploadDir = await orderImportUploadDir();
  const rejectedSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-rejected-upload-cleanup' })
  });
  importSessionIds.push(rejectedSession.id);
  const missingSheetFileName = `order-import-no-upload-sheet-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    rejectedSession.id,
    await buildWorkbookWithoutUploadSheetBuffer(),
    'ERP上传净表',
    missingSheetFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, missingSheetFileName.replace(/\.xlsx$/i, ''), '缺少 ERP上传净表 的失败上传');
  const blankRowFileName = `order-import-blank-row-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    rejectedSession.id,
    await buildWorkbookWithBlankRowInMiddleBuffer(customerName),
    '必须连续填写',
    blankRowFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, blankRowFileName.replace(/\.xlsx$/i, ''), '中间空行的失败上传');
  const orderHeadFileName = `order-import-order-head-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    rejectedSession.id,
    await buildWorkbookWithOrderHeadRowBuffer(customerName),
    '不允许包含订单头行',
    orderHeadFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, orderHeadFileName.replace(/\.xlsx$/i, ''), '订单头行的失败上传');
  const missingHeaderFileName = `order-import-missing-header-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    rejectedSession.id,
    await buildWorkbookWithMissingRequiredHeaderBuffer(customerName),
    '缺少表头',
    missingHeaderFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, missingHeaderFileName.replace(/\.xlsx$/i, ''), '缺少必填表头的失败上传');
  const emptyUploadSheetFileName = `order-import-empty-upload-sheet-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    rejectedSession.id,
    await buildWorkbookWithEmptyUploadSheetBuffer(),
    '没有可导入',
    emptyUploadSheetFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, emptyUploadSheetFileName.replace(/\.xlsx$/i, ''), '空 ERP上传净表 的失败上传');
  const rejectedPreview = await requestJson(`/orders/import-sessions/${rejectedSession.id}`);
  assert(rejectedPreview.summary.fileCount === 0, `失败上传后不应留下导入文件记录，实际 ${rejectedPreview.summary.fileCount}`);
  assert(rejectedPreview.summary.rowCount === 0, `失败上传后不应留下导入行，实际 ${rejectedPreview.summary.rowCount}`);

  const duplicateSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-duplicate-upload' })
  });
  importSessionIds.push(duplicateSession.id);
  const buffer = await buildSelectedCommitWorkbookBuffer(customerName);
  const firstUpload = await uploadWorkbook(duplicateSession.id, buffer, `order-import-duplicate-a-${runId}.xlsx`);
  assert(firstUpload.summary.fileCount === 1, `首次上传后应只有 1 个文件，实际 ${firstUpload.summary.fileCount}`);
  assert(firstUpload.summary.rowCount === 3, `首次上传后应读取 3 行，实际 ${firstUpload.summary.rowCount}`);
  const duplicateRejectedFileName = `order-import-duplicate-b-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    duplicateSession.id,
    buffer,
    '已上传到当前导入会话',
    duplicateRejectedFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, duplicateRejectedFileName.replace(/\.xlsx$/i, ''), '重复上传被拒绝的文件');
  const duplicatePreview = await requestJson(`/orders/import-sessions/${duplicateSession.id}`);
  assert(duplicatePreview.summary.fileCount === 1, `重复上传后文件记录仍应为 1，实际 ${duplicatePreview.summary.fileCount}`);
  assert(duplicatePreview.summary.rowCount === 3, `重复上传后导入行仍应为 3，实际 ${duplicatePreview.summary.rowCount}`);
}

async function firstStoredImportFile(sessionIdForLookup) {
  const prisma = new PrismaClient();
  try {
    const file = await prisma.orderImportFile.findFirst({
      where: { sessionId: sessionIdForLookup },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, storedFileName: true }
    });
    assert(file?.storedFileName, `导入会话 ${sessionIdForLookup} 必须存在已落盘的上传文件`);
    return file;
  } finally {
    await prisma.$disconnect();
  }
}

async function assertImportFileDeletionRemovesStoredFile(customerName) {
  const uploadDir = await orderImportUploadDir();
  const fileDeleteSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-delete-import-file-cleanup' })
  });
  importSessionIds.push(fileDeleteSession.id);
  await uploadWorkbook(
    fileDeleteSession.id,
    await buildSelectedCommitWorkbookBuffer(customerName),
    `order-import-file-delete-${runId}.xlsx`
  );
  const storedFile = await firstStoredImportFile(fileDeleteSession.id);
  const storedPath = join(uploadDir, storedFile.storedFileName);
  assert(existsSync(storedPath), `删除上传文件前服务器端 Excel 必须存在：${storedPath}`);
  const afterDelete = await requestJson(`/orders/import-sessions/${fileDeleteSession.id}/files/${storedFile.id}`, { method: 'DELETE' });
  assert(afterDelete.deletedFileCount === 1, `删除上传文件应返回 deletedFileCount=1，实际 ${afterDelete.deletedFileCount}`);
  assert(afterDelete.summary.fileCount === 0, `删除上传文件后文件记录应为 0，实际 ${afterDelete.summary.fileCount}`);
  assert(afterDelete.summary.rowCount === 0, `删除上传文件后导入行应为 0，实际 ${afterDelete.summary.rowCount}`);
  assert(!existsSync(storedPath), `删除上传文件后服务器端 Excel 必须同步删除：${storedPath}`);

  const discardSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-discard-import-file-cleanup' })
  });
  importSessionIds.push(discardSession.id);
  await uploadWorkbook(
    discardSession.id,
    await buildSelectedCommitWorkbookBuffer(customerName),
    `order-import-discard-${runId}.xlsx`
  );
  const discardStoredFile = await firstStoredImportFile(discardSession.id);
  const discardStoredPath = join(uploadDir, discardStoredFile.storedFileName);
  assert(existsSync(discardStoredPath), `放弃导入前服务器端 Excel 必须存在：${discardStoredPath}`);
  const discardResult = await requestJson(`/orders/import-sessions/${discardSession.id}`, { method: 'DELETE' });
  assert(discardResult.deletedFileCount === 1, `放弃导入应删除 1 个服务器端 Excel，实际 ${discardResult.deletedFileCount}`);
  assert(!existsSync(discardStoredPath), `放弃导入后服务器端 Excel 必须同步删除：${discardStoredPath}`);
}

async function main() {
  try {
    await requestJson('/health');
    await activateOrderImportMaterialFixtures();
    await assertCustomerSearchRanking();
    await assertDraftStockReservationReleasedOnCancel();
    await assertDraftStockReservationRemovedOnDelete();
    await assertDraftStockReservationReplacedOnEdit();
    await assertDraftStockReservationOrderNoRenumberedOnEdit();
    await assertDraftWithInventoryCannotBeDeleted();
    await assertSubmittedOrderCannotBeDeleted();
    await assertDraftWithProductionTaskCannotBeDeleted();
    await assertDraftWithInventoryTransactionCannotBeDeleted();
    const customerName = await createOrderImportRegressionCustomers();
    await assertTemplateWorkbook(await downloadTemplate());
    await verifyBundledWorkbookUploadPreviews();
    await assertRejectedAndDuplicateUploadsStayClean(customerName);
    await assertImportFileDeletionRemovesStoredFile(customerName);
    await assertSelectedCommitSupportsUnloadedOrders(customerName);
    await assertAllSelectableCommitSupportsExcludedOrders(customerName);
    await assertStaleImportPreviewTokenRejectsCommit(customerName);
    await assertOrderImportDoesNotOverwriteExistingMaterial(customerName);
    await assertImportMissingThicknessDraftRequiresReview(customerName);
    await assertOrderImportDrawingVersionSnapshot(customerName);
    await assertSubmitConsumesDraftStockReservation();
    await assertSubmitPartiallyConsumesStockAndCreatesProductionTask();
    await assertSubmitRejectsPartialStockWithoutProcessSteps();
    await assertSubmitConsumesReworkStockAndCreatesProductionTask();
    await assertSubmitRejectsReworkStockSourceShortage();
    await assertCreateRejectsStockSourceOverAvailable();
    await assertCreateRejectsSameBatchStockSourcesOverAvailableAcrossLines();
    await assertCreateRejectsDuplicateStockSourceStrictStatusWithoutFreshManualConfirmation();
    await assertUpdateRejectsSameBatchStockSourcesOverAvailableAcrossLines();
    await assertCreateRejectsStockSourceReservedByEarlierDraftOrder();
    await assertLaterDraftSubmitRejectsAfterEarlierDraftReservationIncrease();
    await assertEarlierDraftSubmitWinsPriorityBeforeLaterDraftReservation();
    await assertLaterDraftSubmitSucceedsAfterEarlierDraftConsumesStock();
    await assertDraftStockReservationPriorityUsesOrderNoTieBreaker();
    await assertSubmitConsumesSameBatchStockSourcesAcrossLines();
    await assertCreateRejectsReworkStockSourceOverPlan();
    await assertSubmitRejectsReworkWithoutStockSources();
    await assertSubmitConsumesSelectedStockSourcesInManualOrder();
    await assertEarlierDraftManualSelectionSeesSmallerBatchReservedByLaterDraft();
    await assertSubmitRejectsStaleManualSelectionWhenSmallerBatchAppearsAfterDraftSave();
    await assertCreateRejectsStockSourceDrawingSnapshotMismatchWithoutManualConfirmation();
    await assertCreateRejectsStockSourceLineTypeMismatchWithoutManualConfirmation();
    await assertCreateRejectsStockSourceStructureMismatchWithoutManualConfirmation();
    await assertSameOrderOtherLineSelectionSatisfiesSmallerBatchPriority();
    await assertSubmittedStockOrderCannotBeSubmittedAgain();
    await assertSubmitRejectsMismatchedDraftStockReservation();
    await assertSubmitRejectsMissingDraftStockReservation();
    const session = await requestJson('/orders/import-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ createdBy: 'verify-order-import-api' })
    });
    sessionId = session.id;
    importSessionIds.push(session.id);

    const mainUploadFileName = `组件零件导入验证-${runId}.xlsx`;
    let upload = await uploadWorkbook(sessionId, await buildWorkbookBuffer(customerName), mainUploadFileName);
    assert(upload.summary.orderCount === 4, `期望 4 个订单，实际 ${upload.summary.orderCount}`);
    assert(upload.summary.rowCount === 9, `期望 9 行明细，实际 ${upload.summary.rowCount}`);
    assert(upload.summary.selectableOrderCount === 3, `期望 3 个可导入订单，实际 ${upload.summary.selectableOrderCount}`);
    assert(upload.summary.blockedOrderCount === 1, `期望 1 个被拦截订单，实际 ${upload.summary.blockedOrderCount}`);
    assert(upload.summary.materialSyncCount === 5, `预览应统计 5 个非组件零件编码，实际 ${upload.summary.materialSyncCount}`);
    assert(
      upload.summary.materialSyncPreview?.includes(`${materialPrefix}-001`) &&
        !upload.summary.materialSyncPreview?.includes(`${materialPrefix}-002`) &&
        !upload.summary.materialSyncPreview?.includes(`${materialPrefix}-BAD`),
      `预览零件编码示例应来自可导入订单且排除错误订单，实际 ${upload.summary.materialSyncPreview}`
    );
    assert(upload.summary.errorCount > 0, '错误订单应在预览阶段产生错误');
    const invalidOrder = upload.orders.find((order) => order.orderNo === `${orderPrefix}-BAD`);
    assert(invalidOrder?.orderDate === '', `缺少制单日期的错误订单预览不应显示占位日期，实际 ${invalidOrder?.orderDate}`);
    const invalidThicknessLine = invalidOrder?.rows?.find((row) => row.partCode === `${materialPrefix}-BAD`);
    assert(
      Number(invalidThicknessLine?.partThickness || 0) === 0,
      `订单导入缺厚度零件必须保留为 0 待核对，实际 ${invalidThicknessLine?.partThickness}`
    );
    assert(
      invalidThicknessLine?.issues?.some((issue) => issue.code === 'THICKNESS_DEFAULTED' && issue.message.includes('待核对')),
      '订单导入缺厚度零件必须产生 THICKNESS_DEFAULTED 待核对警告'
    );
    const previewComponentLine = upload.orders
      .flatMap((order) => order.rows || [])
      .find((row) => row.lineType === 'COMPONENT' && row.componentNo === 'C001');
    assert(previewComponentLine, '订单导入预览必须识别父级组件行');
    assert(
      Number(previewComponentLine.partThickness || 0) === 0,
      `订单导入父级组件行厚度必须按不适用处理为 0，实际 ${previewComponentLine.partThickness}`
    );
    assert(
      !previewComponentLine.issues?.some((issue) => issue.code === 'THICKNESS_DEFAULTED'),
      '订单导入父级组件行不应产生 THICKNESS_DEFAULTED 厚度待核对警告'
    );
    assert(
      invalidOrder?.rows?.some((row) => row.issues?.some((issue) => issue.code === 'PART_COMPONENT_NO_NOT_ALLOWED')),
      '零件行误填组件编号必须在预览阶段拦截'
    );
    await assertImportSessionFilePreview(sessionId, upload.files[0].id, mainUploadFileName);
    await assertIssueReportWorkbook(await downloadIssueReport(sessionId), {
      requiredCodes: ['PART_COMPONENT_NO_NOT_ALLOWED'],
      requiredDrawingVersions: [{ code: 'PART_COMPONENT_NO_NOT_ALLOWED', version: 'B' }],
      requiredDrawingDates: [{ code: 'PART_COMPONENT_NO_NOT_ALLOWED', date: '2026-05-30' }],
      requiredDrawingStatuses: [{ code: 'PART_COMPONENT_NO_NOT_ALLOWED', status: '旧图' }]
    });
    assert(upload.orders.every((order) => order.rows.length > 0), '分页预览应返回当前页订单明细');

    await uploadWorkbook(
      sessionId,
      await buildSplitWorkbookBuffer(customerName, [
        ['组件', 1, '定制件', 'C001', '', `${materialPrefix}-SPLIT-001`, `VERIFY-${runId}-SPLIT-00`, '跨文件组件', '', '2mm', 5, 1, 5, '套', '装配', '第一份文件只有组件', '', '旧图']
      ])
    );
    upload = await uploadWorkbook(
      sessionId,
      await buildSplitWorkbookBuffer(customerName, [
        ['零件', '', '定制件', '', '', `${materialPrefix}-SPLIT-002`, `VERIFY-${runId}-SPLIT-A`, '跨文件自动绑定子件', '', '1mm', '', 3, '', '件', '激光切割', '第二份文件缺少所属组件，后端应按会话兜底绑定', '', '旧图']
      ])
    );
    assert(upload.summary.orderCount === 5, `连续上传后期望 5 个订单，实际 ${upload.summary.orderCount}`);
    assert(upload.summary.rowCount === 11, `连续上传后期望 11 行明细，实际 ${upload.summary.rowCount}`);
    assert(upload.summary.selectableOrderCount === 4, `连续上传后期望 4 个可导入订单，实际 ${upload.summary.selectableOrderCount}`);
    assert(upload.summary.materialSyncCount === 6, `连续上传后应统计 6 个非组件零件编码，实际 ${upload.summary.materialSyncCount}`);
    const splitOrder = upload.orders.find((order) => order.orderNo === `${orderPrefix}-SPLIT`);
    assert(splitOrder?.errorCount === 0, '跨文件连续上传的同一订单应能通过会话级组件兜底绑定');
    assert(
      splitOrder?.rows?.some((row) => row.parentComponentNo === 'C001' && Number(row.demandQuantity) === 15),
      '跨文件子零件应自动绑定到上一文件的组件，并按父组件需求数量×单套用量计算'
    );
    await assertIssueReportWorkbook(await downloadIssueReport(sessionId), {
      requiredCodes: ['PART_COMPONENT_NO_NOT_ALLOWED'],
      forbiddenOrderCodePairs: [{ orderNo: `${orderPrefix}-SPLIT`, code: 'DEMAND_QUANTITY_REQUIRED' }]
    });
    const historyAfterSplit = await requestJson('/orders/import-sessions?limit=20&offset=0');
    const historySession = historyAfterSplit.items?.find((item) => item.id === sessionId);
    assert(historySession, '导入记录列表必须包含刚创建的导入会话');
    assert(
      historySession.selectableOrderCount === 4,
      `导入记录列表必须按跨文件组件关系统计 4 个可导入订单，实际 ${historySession.selectableOrderCount}`
    );
    assert(
      historySession.blockedOrderCount === 1,
      `导入记录列表必须按跨文件组件关系统计 1 个不可导入订单，实际 ${historySession.blockedOrderCount}`
    );
    assert(
      historySession.materialSyncCount === 6,
      `导入记录列表必须统计 6 个非组件零件编码，实际 ${historySession.materialSyncCount}`
    );
    assert(
      historySession.materialSyncPreview?.includes(`${materialPrefix}-001`) &&
        !historySession.materialSyncPreview?.includes(`${materialPrefix}-002`) &&
        !historySession.materialSyncPreview?.includes(`${materialPrefix}-BAD`),
      `导入记录列表零件编码示例应来自可导入订单且排除错误订单，实际 ${historySession.materialSyncPreview}`
    );

    const selectable = await requestJson(`/orders/import-sessions/${sessionId}/selectable-order-nos`);
    assert(selectable.orderNos.length === 4, `期望 4 个可选订单号，实际 ${selectable.orderNos.length}`);
    assert(selectable.orders?.length === 4, `可选订单号接口应返回 4 个轻量订单摘要，实际 ${selectable.orders?.length}`);

    const commit = await requestJson(`/orders/import-sessions/${sessionId}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allSelectable: true, previewToken: upload.previewToken })
  });
    assert(commit.createdCount === 4, `期望创建 4 个草稿订单，实际 ${commit.createdCount}`);
    assert(commit.materialSyncCount === 6, `期望补建 6 个非组件零件搜索记忆，实际 ${commit.materialSyncCount}`);
    assert(
      commit.materialSyncPreview?.includes(`${materialPrefix}-001`) &&
        !commit.materialSyncPreview?.includes(`${materialPrefix}-002`) &&
        !commit.materialSyncPreview?.includes(`${materialPrefix}-BAD`),
      `提交响应零件编码示例应来自已创建草稿，实际 ${commit.materialSyncPreview}`
    );
    assert(commit.skippedBlockedCount === 1, `期望跳过 1 个错误订单，实际 ${commit.skippedBlockedCount}`);
    assert(commit.skippedSelectableCount === 0, `整批创建不应跳过可导入订单，实际 ${commit.skippedSelectableCount}`);
    const mainCreatedOrderNos = [];
    for (const order of commit.createdOrders || []) {
      mainCreatedOrderNos.push(order.orderNo);
      createdOrderNos.push(order.orderNo);
    }
    assert(mainCreatedOrderNos.length === 4, '提交响应应返回 4 个创建订单摘要');
    assert(
      Array.isArray(commit.committedOrderNos) && commit.committedOrderNos.length === 4,
      '提交响应必须返回实际生成的订单号列表'
    );
    assert(
      !commit.committedOrderNos.includes(`${orderPrefix}-BAD`),
      '实际生成订单号列表不得包含被预览错误阻断的订单'
    );

    const committedImportSession = await requestJson(`/orders/import-sessions/${sessionId}`);
    assert(committedImportSession.status === 'COMMITTED', '提交后的导入会话状态必须是 COMMITTED');
    assert(
      committedImportSession.summary.committedOrderCount === 4,
      `提交后的导入会话必须记录 4 个实际生成订单，实际 ${committedImportSession.summary.committedOrderCount}`
    );
    assert(
      committedImportSession.committedOrderNos.includes(`${orderPrefix}-SPLIT`) &&
        !committedImportSession.committedOrderNos.includes(`${orderPrefix}-BAD`),
      '导入会话只应保存实际生成的订单号，不能混入错误订单'
    );
    await assertImportedMaterialsUpserted(
      [
        `${materialPrefix}-001`,
        `${materialPrefix}-003`,
        `${materialPrefix}-004`,
        `${materialPrefix}-006`,
        `${materialPrefix}-008`,
        `${materialPrefix}-SPLIT-002`
      ],
      [
        `${materialPrefix}-BAD`,
        `${materialPrefix}-002`,
        `${materialPrefix}-005`,
        `${materialPrefix}-007`,
        `${materialPrefix}-SPLIT-001`
      ]
    );
    await assertMaterialSuggestionCustomerCodeSearch(`${orderPrefix}-001`, `${materialPrefix}-001`);
    await assertMaterialSuggestionRecentCustomerHistorySort(`${orderPrefix}-002`, `${materialPrefix}-004`);
    await assertMaterialSuggestionLastOrderScopedToCustomer(`${orderPrefix}-001`, `${materialPrefix}-001`);
    await assertMaterialSuggestionCodeAbbreviationSearch('mat001', `${materialPrefix}-001`);
    await assertMaterialSuggestionPinyinInitialSearch('yzdg', `${materialPrefix}-001`, '名称拼音匹配');
    await assertMaterialSuggestionPinyinInitialSearch('yz', `${materialPrefix}-001`, '名称拼音匹配');

    const createdOrder = await requestJson(`/orders/${encodeURIComponent(mainCreatedOrderNos[0])}`);
    assert(createdOrder.status === 'DRAFT', 'Excel 导入只能创建 DRAFT 草稿订单');
    const longRemarkLine = createdOrder.lines.find((line) => line.partCode === `${materialPrefix}-001`);
    assert(
      longRemarkLine?.remark?.includes(longProcessRemark),
      'Excel 长工艺备注导入后必须完整保留，不能设置业务字数截断'
    );
    assert(longRemarkLine?.drawingNo, '导入验证零件必须保留图号，才能验证图号快速检索');
    assert(longRemarkLine?.drawingDate, '导入验证零件必须保留图纸日期，才能验证图纸日期快速检索');
    assert(longRemarkLine?.projectModel, '导入验证零件必须保留项目型号，才能验证项目型号快速检索');
    assert(longRemarkLine?.partThickness, '导入验证零件必须保留厚度，才能验证厚度快速检索');
    await assertMaterialMemoryHistorySearch(createdOrder.orderNo, longRemarkLine.partCode, longRemarkLine.drawingNo);
    await assertMaterialSuggestionHistoryFieldSearch(longRemarkLine.drawingNo, longRemarkLine.partCode, '图纸资料匹配', '图号');
    await assertMaterialSuggestionHistoryFieldSearch(longRemarkLine.drawingDate, longRemarkLine.partCode, '图纸资料匹配', '图纸日期');
    await assertMaterialSuggestionHistoryFieldSearch(
      longRemarkLine.drawingDate.replace(/-0/g, '-'),
      longRemarkLine.partCode,
      '图纸资料匹配',
      '不补零图纸日期'
    );
    await assertMaterialSuggestionHistoryFieldSearch(longRemarkLine.projectModel, longRemarkLine.partCode, '图纸资料匹配', '项目型号');
    await assertMaterialSuggestionHistoryFieldSearch(`${longRemarkLine.partThickness}mm`, longRemarkLine.partCode, '图纸资料匹配', '厚度');
    await assertMaterialSuggestionHistoryFieldSearch(
      `${Number(longRemarkLine.partThickness).toFixed(1)}mm`,
      longRemarkLine.partCode,
      '图纸资料匹配',
      '厚度带小数'
    );
    await assertMaterialSuggestionHistoryFieldSearch(createdOrder.orderNo, longRemarkLine.partCode, '历史订单匹配', '历史订单号');
    await assertStockOnlySuggestionsExcludeNoStockHistory(longRemarkLine.partCode, longRemarkLine.partCode);
    await assertSubmitRejectsUnconfirmedMaterialIdentityConflict(customerName);
    await assertDisabledMaterialMemoryExcludedFromSuggestions(`${materialPrefix}-SPLIT-002`, `${orderPrefix}-SPLIT`);
    const componentLine = createdOrder.lines.find((line) => line.lineType === 'COMPONENT' && line.componentNo === 'C001');
    assert(componentLine, '导入订单应保留组件行和组件编号');
    assert(Number(componentLine.partThickness || 0) === 0, `导入订单组件行厚度必须保存为 0，实际 ${componentLine.partThickness}`);
    const childLine = createdOrder.lines.find((line) => line.parentComponentNo === 'C001');
    assert(childLine, '导入订单应保留子零件所属组件编号');
    assert(Number(childLine.quantity) === 80, `子零件需求数量应为父组件需求数量×单套用量，实际 ${childLine.quantity}`);
    assert(
      createdOrder.lines.some((line) => line.sourceImportSessionId === sessionId),
      '导入草稿订单必须保留来源导入会话，便于追查 Excel 来源'
    );
    await assertImportSourcePreview(createdOrder);

    const editableOrderNo = `${createdOrder.orderNo}-EDIT`;
    const updatedOrder = await requestJson(`/orders/${encodeURIComponent(createdOrder.orderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo: editableOrderNo,
        deliveryDate: createdOrder.deliveryDate,
        remark: 'API 回归：导入草稿可编辑',
        lines: createdOrder.lines.map((line, index) =>
          toOrderUpdateLine(line, index === 0 ? { remark: '导入后编辑保留组件结构和来源信息' } : {})
        )
      })
    });
    mainCreatedOrderNos[0] = editableOrderNo;
    const createdOrderCleanupIndex = createdOrderNos.indexOf(createdOrder.orderNo);
    if (createdOrderCleanupIndex >= 0) {
      createdOrderNos[createdOrderCleanupIndex] = editableOrderNo;
    } else {
      createdOrderNos.push(editableOrderNo);
    }
    assert(updatedOrder.orderNo === editableOrderNo, '导入草稿订单应允许编辑订单号');
    assertNoBlankOptionalOrderLineText(updatedOrder, '导入草稿编辑后');
    assert(
      updatedOrder.lines.some((line) => line.lineType === 'COMPONENT' && line.componentNo === 'C001'),
      '导入草稿编辑后必须保留组件编号'
    );
    assert(
      updatedOrder.lines.some((line) => line.parentComponentNo === 'C001' && Number(line.quantity) === 80),
      '导入草稿编辑后必须保留子零件所属组件和需求数量'
    );
    assert(
      updatedOrder.lines.some((line) => line.sourceImportSessionId === sessionId),
      '导入草稿编辑后必须保留来源导入会话'
    );
    await assertImportSourcePreview(updatedOrder);
    const staleImportSourceOrder = await requestJson(`/orders/${encodeURIComponent(editableOrderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo: editableOrderNo,
        deliveryDate: updatedOrder.deliveryDate,
        remark: 'API 回归：导入来源文件 ID 失效时仍可编辑草稿',
        lines: updatedOrder.lines.map((line, index) =>
          toOrderUpdateLine(line, index === 0 ? { sourceImportFileId: '00000000-0000-0000-0000-000000000000' } : {})
        )
      })
    });
    assert(
      staleImportSourceOrder.lines.length === updatedOrder.lines.length,
      '导入来源文件 ID 失效时，草稿编辑不能因为外键错误失败'
    );
    assertNoBlankOptionalOrderLineText(staleImportSourceOrder, '导入来源失效编辑后');
    const recoveredImportSourceLine = staleImportSourceOrder.lines.find((line) => line.partCode === updatedOrder.lines[0].partCode);
    assert(
      recoveredImportSourceLine?.sourceImportFileId &&
        recoveredImportSourceLine.sourceImportFileId !== '00000000-0000-0000-0000-000000000000',
      '导入来源文件 ID 失效时，订单详情应通过来源会话和 Excel 行号重新找回正确文件'
    );
    await assertImportSourcePreview(staleImportSourceOrder);
    const renamedImportSession = await requestJson(`/orders/import-sessions/${sessionId}`);
    assert(
      renamedImportSession.currentCommittedOrderNos.includes(editableOrderNo),
      '导入记录现存订单号应跟随订单编辑结果'
    );
    assert(
      !renamedImportSession.currentCommittedOrderNos.includes(createdOrder.orderNo),
      '导入记录现存订单号不应继续显示编辑前订单号'
    );
    assert(
      renamedImportSession.committedOrderNos.includes(createdOrder.orderNo),
      '导入记录提交时生成订单号应保留原始提交清单'
    );
    const deleteEdited = await requestJson(`/orders/${encodeURIComponent(editableOrderNo)}`, { method: 'DELETE' });
    assert(deleteEdited.deleted === true, '导入错误的草稿订单应允许删除');
    mainCreatedOrderNos.splice(0, 1);
    const deletedOrderCleanupIndex = createdOrderNos.indexOf(editableOrderNo);
    if (deletedOrderCleanupIndex >= 0) {
      createdOrderNos.splice(deletedOrderCleanupIndex, 1);
    }
    const afterDeleteImportSession = await requestJson(`/orders/import-sessions/${sessionId}`);
    assert(
      afterDeleteImportSession.summary.currentCommittedOrderCount === 3,
      `删除导入订单后现存订单数量应变为 3，实际 ${afterDeleteImportSession.summary.currentCommittedOrderCount}`
    );
    assert(
      !afterDeleteImportSession.currentCommittedOrderNos.includes(editableOrderNo),
      '删除导入订单后导入记录现存订单列表不应继续显示已删除订单'
    );
    assert(
      afterDeleteImportSession.summary.committedOrderCount === 4,
      '删除导入草稿后提交时生成订单统计仍应保留原始 4 个记录'
    );

    const customComponentOrder = await requestJson(`/orders/${encodeURIComponent(`${orderPrefix}-003`)}`);
    assert(
      customComponentOrder.lines.some((line) => line.lineType === 'COMPONENT' && line.componentNo === 'ASM-X1'),
      '导入订单应允许非 C001-C9999 的自定义组件编号'
    );
    assert(
      customComponentOrder.lines.some((line) => line.parentComponentNo === 'ASM-X1' && Number(line.quantity) === 12),
      '自定义组件编号的子零件必须按父组件需求数量计算需求数量'
    );

    const splitCreatedOrder = await requestJson(`/orders/${encodeURIComponent(`${orderPrefix}-SPLIT`)}`);
    assert(
      splitCreatedOrder.lines.some((line) => line.parentComponentNo === 'C001' && Number(line.quantity) === 15),
      '跨文件连续上传创建草稿后必须保留自动绑定的所属组件和需求数量'
    );
    await assertSubmitRejectsInvalidPersistedComponentStructure(`${orderPrefix}-SPLIT`);
    await assertSubmitReturnsPendingProductionStatus(customerName);

    const committedStoredFile = await firstStoredImportFile(sessionId);
    const committedStoredPath = join(await orderImportUploadDir(), committedStoredFile.storedFileName);
    assert(existsSync(committedStoredPath), `删除已提交导入记忆前服务器端 Excel 必须存在：${committedStoredPath}`);
    const memoryDeleteResult = await requestJson(`/orders/import-sessions/${sessionId}`, { method: 'DELETE' });
    assert(memoryDeleteResult.deletedMemory === true, '已提交导入记录删除时必须标记为删除导入记忆');
    assert(memoryDeleteResult.deletedFileCount >= 1, '删除导入记忆必须同步删除服务器端上传 Excel 文件');
    assert(!existsSync(committedStoredPath), `删除导入记忆后服务器端 Excel 必须同步删除：${committedStoredPath}`);
    const orderAfterMemoryDelete = await requestJson(`/orders/${encodeURIComponent(mainCreatedOrderNos[0])}`);
    assert(orderAfterMemoryDelete?.orderNo === mainCreatedOrderNos[0], '删除导入记忆不得删除已经生成的订单草稿');
    const importTraceLinesAfterMemoryDelete = orderAfterMemoryDelete.lines.filter((line) => line.sourceImportFileName);
    assert(importTraceLinesAfterMemoryDelete.length > 0, '删除导入记忆后订单明细必须保留来源 Excel 文件名文字追溯');
    assert(
      importTraceLinesAfterMemoryDelete.every((line) => !line.sourceImportFileId && !line.sourceImportFileAvailable),
      '删除导入记忆后订单明细不能继续保留可预览的来源文件 ID'
    );

    await cleanup();
    console.log(
      JSON.stringify(
        {
          ok: true,
          apiBaseUrl,
          sessionId,
          customerName,
          createdOrderNos
        },
        null,
        2
      )
    );
  } catch (error) {
    await cleanup();
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

main();
