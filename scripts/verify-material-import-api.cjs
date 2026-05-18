#!/usr/bin/env node

const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { unlink } = require('node:fs/promises');
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

const apiBaseUrl = (
  process.env.MATERIAL_IMPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  process.env.ORDER_IMPORT_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const runId = 'STABLE';
const materialPrefix = 'MI-API-STABLE';
const orderExtractPrefix = `${materialPrefix}-ORD-DRAFT`;
const orderExtractCustomerCode = `${orderExtractPrefix}-CUST`;
const orderExtractCustomerName = `${orderExtractPrefix} customer`;
const createdSessionIds = new Set();
const mojibakePattern =
  /[ÃÂ�]|锟|脙|脗|鈥|绗|\u95c3\u8235|\u95c3\u8236|寮€|涓€|瀵煎|璁㈠崟|鏂囦欢|缂栫爜|鍚嶇О|绮剧‘|鍖归厤|鍓嶇紑|鎷奸煶|鍥剧焊|瀹㈡埛|鍘嗗彶|搴撳瓨|鏉ユ簮|涔辩爜|淇|楠岃瘉|鏃犳硶|鏈壘|鎵惧埌|涓|尮閰|墿鏂|璇蜂粠|嬫媺|閫夋嫨|鏌ヨ|澶辫触|宸ヨ緭|闃绘柇/;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = String(value || '');
  assert(!mojibakePattern.test(text), `${label} 不能出现乱码：${text}`);
}

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

async function requestBuffer(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${buffer.toString('utf8')}`);
  }
  return buffer;
}

async function expectRequestFailure(label, action, expectedMessage) {
  let failed = false;
  try {
    await action();
  } catch (error) {
    failed = true;
    assert(
      String(error.message || '').includes(expectedMessage),
      `${label} 失败原因应包含“${expectedMessage}”，实际：${error.message}`
    );
  }
  assert(failed, `${label} 应该失败`);
}

function assertXlsxBuffer(buffer, label) {
  assert(buffer.slice(0, 2).toString('utf8') === 'PK', `${label} 必须是 xlsx zip 文件`);
}

function addRow(sheet, rowNo, values) {
  values.forEach((value, index) => {
    sheet.getCell(rowNo, index + 1).value = value;
  });
}

const materialHeaders = [
  '零件编码',
  '零件名称',
  '单位',
  '成品规格',
  '默认工艺',
  '图号',
  '图纸版本',
  '图纸日期',
  '图纸状态',
  '厚度',
  '项目型号',
  '库存报警',
  '最小库存',
  '备注'
];

const applicabilityHeaders = ['零件编码', '客户编码', '客户名称', '项目型号', '状态', '备注'];
const transformHeaders = [
  '来源零件编码',
  '目标零件编码',
  '客户编码',
  '客户名称',
  '项目型号',
  '倍率',
  '损耗率',
  '默认工艺',
  '转换说明',
  '状态',
  '备注'
];

async function workbookBuffer({ materialRows = [], applicabilityRows = [], transformRows = [] }) {
  const workbook = new ExcelJS.Workbook();
  const materialSheet = workbook.addWorksheet('零件基础库');
  addRow(materialSheet, 1, materialHeaders);
  materialRows.forEach((row, index) => addRow(materialSheet, index + 2, row));

  const applicabilitySheet = workbook.addWorksheet('适用范围');
  addRow(applicabilitySheet, 1, applicabilityHeaders);
  applicabilityRows.forEach((row, index) => addRow(applicabilitySheet, index + 2, row));

  const transformSheet = workbook.addWorksheet('来源加工关系');
  addRow(transformSheet, 1, transformHeaders);
  transformRows.forEach((row, index) => addRow(transformSheet, index + 2, row));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function validMaterialImportWorkbook() {
  return workbookBuffer({
    materialRows: [
      [
        `${materialPrefix}-SRC`,
        'API验证来源半成品',
        '件',
        '200x300',
        '激光切割',
        `${materialPrefix}-DWG-SRC`,
        'A',
        '2026/5/30',
        '旧图',
        2,
        'B5',
        '启用',
        12,
        'API 回归来源零件'
      ],
      [
        `${materialPrefix}-TGT`,
        'API验证目标零件',
        '件',
        '200x300-加工',
        '折弯',
        `${materialPrefix}-DWG-TGT`,
        'A',
        '2026/5/31',
        '新图',
        2,
        'B5',
        '停用',
        '',
        'API 回归目标零件'
      ]
    ],
    applicabilityRows: [[`${materialPrefix}-TGT`, '', '', 'B5', '启用', '全部客户 B5 适用']],
    transformRows: [[`${materialPrefix}-SRC`, `${materialPrefix}-TGT`, '', '', 'B5', 1, 0, '', '来源加工关系只作为建议，不自动扣库存', '启用', 'API 回归来源关系']]
  });
}

async function issueMaterialImportWorkbook() {
  return workbookBuffer({
    materialRows: [
      [`${materialPrefix}-ISSUE`, '问题明细验证零件', '件', '', '', '', '', '', '', '', '', '停用', 3, '停用库存报警仍填写最小库存，应生成可持久化警告']
    ],
    applicabilityRows: [[`${materialPrefix}-MISSING-SCOPE`, '', '', 'B5', '启用', '引用不存在零件']],
    transformRows: [[`${materialPrefix}-MISSING-SRC`, `${materialPrefix}-MISSING-TGT`, '', '', 'B5', 1, 0, `不存在工序${runId}`, '引用不存在来源和目标，并使用无效默认工艺', '启用', '']]
  });
}

async function missingRequiredMaterialImportWorkbook() {
  return workbookBuffer({
    materialRows: [
      [
        `${materialPrefix}-REQUIRED`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        -1,
        '',
        '启用',
        '',
        '缺少零件名称、单位和最小库存，同时厚度为负数，必须进入预览错误'
      ]
    ],
    applicabilityRows: [['', '', '', 'B5', '启用', '缺少零件编码，必须进入适用范围预览错误']],
    transformRows: [
      [
        `${materialPrefix}-REQUIRED`,
        `${materialPrefix}-REQUIRED`,
        '',
        '',
        'B5',
        -1,
        -0.1,
        '',
        '来源和目标相同，同时倍率和损耗无效，必须进入来源加工关系预览错误',
        '启用',
        ''
      ]
    ]
  });
}

async function createSession(createdBy) {
  const session = await requestJson('/inventory/material-import-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ createdBy })
  });
  createdSessionIds.add(session.id);
  return session;
}

async function uploadWorkbook(sessionId, buffer, fileName) {
  const form = new FormData();
  form.set(
    'file',
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName
  );
  const response = await fetch(`${apiBaseUrl}/inventory/material-import-sessions/${sessionId}/files`, {
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

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function archivedCustomerIdentity(value, customerId) {
  return `${String(value || 'TEST-CUSTOMER').slice(0, 120)}__DISABLED__${customerId.slice(0, 8)}`;
}

function archivedFixtureIdentity(value, id) {
  const text = String(value || 'TEST-FIXTURE');
  if (text.includes('__DISABLED__')) {
    return text;
  }
  return `${text.slice(0, 120)}__DISABLED__${id.slice(0, 8)}`;
}

function processNameKey(processName) {
  return String(processName || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\-_./\\]+/g, '');
}

async function findOrderExtractCustomer(prisma) {
  let customer = await prisma.customer.findUnique({ where: { customerCode: orderExtractCustomerCode } });
  if (!customer) {
    customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { customerCode: { startsWith: `${orderExtractCustomerCode}__DISABLED__` } },
          { customerName: { startsWith: `${orderExtractCustomerName}__DISABLED__` } }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });
  }
  return customer;
}

async function prepareOrderExtractCustomer(prisma) {
  const customerData = {
    customerCode: orderExtractCustomerCode,
    customerName: orderExtractCustomerName,
    contactName: 'API verify',
    regionType: 'CHINA',
    country: 'China',
    province: 'Jiangsu',
    city: 'Suzhou',
    status: 'ENABLED'
  };
  const customer = await findOrderExtractCustomer(prisma);
  return customer
    ? prisma.customer.update({ where: { id: customer.id }, data: customerData })
    : prisma.customer.create({ data: customerData });
}

async function archiveOrderExtractCustomer(prisma) {
  const customer = await findOrderExtractCustomer(prisma);
  if (!customer?.id) {
    return;
  }
  await prisma.customerContact.updateMany({
    where: { customerId: customer.id, status: 'ENABLED' },
    data: { status: 'DISABLED', isPrimary: false }
  });
  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      customerCode: archivedCustomerIdentity(orderExtractCustomerCode, customer.id),
      customerName: archivedCustomerIdentity(orderExtractCustomerName, customer.id),
      status: 'DISABLED',
      contactName: null,
      contactPhone: null
    }
  });
}

async function ensureProcessDefinitionFixture(processName, remark) {
  const prisma = new PrismaClient();
  let existing = null;
  try {
    const processNameNormalized = processNameKey(processName);
    const existingRows = await prisma.processDefinition.findMany({
      where: {
        OR: [{ processNameNormalized }, { processName }]
      },
      orderBy: { createdAt: 'asc' }
    });
    existing = existingRows.find((row) => row.processNameNormalized === processNameNormalized) || existingRows[0] || null;
  } finally {
    await prisma.$disconnect();
  }
  if (!existing) {
    return requestJson('/process-definitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processName, remark })
    });
  }
  if (existing.status !== 'ENABLED') {
    await requestJson(`/process-definitions/${existing.id}/restore`, { method: 'PATCH' });
  }
  return requestJson(`/process-definitions/${existing.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ processName, remark })
  });
}

async function ensureMaterialDefaultProcessFixture({ partCode, partName, unit, defaultProcessRoute }) {
  const prisma = new PrismaClient();
  try {
    return prisma.material.upsert({
      where: { partCode },
      update: {
        partName,
        unit,
        defaultProcessRoute,
        status: 'ENABLED'
      },
      create: {
        partCode,
        partName,
        unit,
        defaultProcessRoute,
        status: 'ENABLED'
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

function orderImportPreviewToken(input) {
  return sha256Json({
    sessionId: input.sessionId,
    status: input.status,
    files: input.files.map((file) => ({
      id: file.id,
      fileHash: file.fileHash,
      rowCount: file.rowCount,
      acceptedRowCount: file.acceptedRowCount,
      duplicateRowCount: file.duplicateRowCount,
      createdAt: file.createdAt.toISOString()
    }))
  });
}

async function createOrderImportSourceSession(options = {}) {
  const sourceLabel = options.sourceLabel || 'order-source';
  const rows =
    options.rows ||
    [
      {
        sourceRowNo: 2,
        orderNo: `${orderExtractPrefix}-001`,
        partCode: `${orderExtractPrefix}-PART-A`,
        partName: 'Order import material draft A',
        drawingNo: `${orderExtractPrefix}-DWG-A`,
        projectModel: 'B5',
        lineType: 'COMPONENT',
        componentNo: 'C001',
        parentComponentNo: null,
        unitUsage: null
      },
      {
        sourceRowNo: 3,
        orderNo: `${orderExtractPrefix}-001`,
        partCode: `${orderExtractPrefix}-PART-B`,
        partName: 'Order import material draft B',
        drawingNo: `${orderExtractPrefix}-DWG-B`,
        projectModel: 'B5',
        lineType: 'PART',
        componentNo: null,
        parentComponentNo: 'C001',
        unitUsage: '2'
      }
    ];
  const prisma = new PrismaClient();
  try {
    await prepareOrderExtractCustomer(prisma);
    const session = await prisma.orderImportSession.create({
      data: { createdBy: `verify-material-import-api-${runId}-${sourceLabel}` }
    });
    const file = await prisma.orderImportFile.create({
      data: {
        sessionId: session.id,
        fileName: `order-import-source-${sourceLabel}-${runId}.xlsx`,
        storedFileName: null,
        fileHash: sha256Json({ runId, source: sourceLabel }),
        sheetName: 'ERP upload clean sheet',
        rowCount: rows.length,
        acceptedRowCount: rows.length,
        duplicateRowCount: 0
      }
    });
    await prisma.orderImportRow.createMany({
      data: rows.map((row) => ({
        sessionId: session.id,
        fileId: file.id,
        sourceRowNo: row.sourceRowNo,
        rowHash: sha256Json({ runId, sourceLabel, row }),
        orderBlock: null,
        orderNo: row.orderNo,
        orderDate: new Date('2026-05-30T00:00:00.000Z'),
        customerName: orderExtractCustomerName,
        projectModel: row.projectModel,
        lineType: row.lineType,
        importSequence: null,
        partCategory: null,
        componentNo: row.componentNo,
        parentComponentNo: row.parentComponentNo,
        partCode: row.partCode,
        drawingNo: row.drawingNo,
        partName: row.partName,
        partSpecification: '200x300',
        partThickness: '2',
        orderQuantity: '10',
        unitUsage: row.unitUsage,
        demandQuantity: '10',
        unit: 'pcs',
        processRoute: null,
        processRemark: null,
        drawingDate: new Date('2026-05-30T00:00:00.000Z'),
        drawingStatus: 'new',
        raw: { source: 'verify-material-import-api', sourceLabel, rowNo: row.sourceRowNo },
        issues: [],
        errorCount: 0,
        warningCount: 0
      }))
    });
    const sourceSession = await prisma.orderImportSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { files: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }
    });
    return {
      session: sourceSession,
      previewToken: orderImportPreviewToken({
        sessionId: sourceSession.id,
        status: sourceSession.status,
        files: sourceSession.files
      })
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function assertExtractedOrderImportDraftOnly(preview) {
  assert(preview.status === 'DRAFT', `from-order-import preview must stay DRAFT, actual ${preview.status}`);
  assert(preview.previewToken, 'from-order-import preview must return previewToken');
  assert(preview.summary.fileCount === 1, `from-order-import preview file count must be 1, actual ${preview.summary.fileCount}`);
  assert(preview.summary.materialRowCount === 2, `from-order-import preview material rows must be 2, actual ${preview.summary.materialRowCount}`);
  assert(
    preview.summary.applicabilityRowCount === 2,
    `from-order-import preview applicability rows must be 2, actual ${preview.summary.applicabilityRowCount}`
  );
  assert(preview.summary.transformRowCount === 0, 'from-order-import preview must not create transform rows');
  assert(preview.summary.errorCount === 0, `from-order-import preview should be importable, actual errors ${preview.summary.errorCount}`);
  assert(preview.rows.every((row) => String(row.partCode || '').startsWith(orderExtractPrefix)), 'from-order-import rows must keep source part codes');
  assert(preview.rows.every((row) => !row.projectModel), 'from-order-import material rows must not store project scope on base Material draft rows');
  assert(
    preview.rows.every((row) => row.raw && JSON.stringify(row.raw).includes(orderExtractPrefix)),
    'from-order-import preview rows must expose raw source trace fields'
  );
  assert(
    preview.applicabilityRows.every(
      (row) =>
        String(row.partCode || '').startsWith(orderExtractPrefix) &&
        row.customerName === orderExtractCustomerName &&
        ['B5', 'B3'].includes(row.projectModel) &&
        row.raw &&
        JSON.stringify(row.raw).includes(orderExtractPrefix)
    ),
    'from-order-import preview must expose customer/project applicability draft rows with raw source trace fields'
  );

  const prisma = new PrismaClient();
  try {
    const [materialSession, materials, applicabilities, orders, orderLines, productionTasks, batches, transactions] = await Promise.all([
      prisma.materialImportSession.findUnique({
        where: { id: preview.id },
        include: { files: true, rows: true, applicabilityRows: true, transformRows: true }
      }),
      prisma.material.count({ where: { partCode: { startsWith: orderExtractPrefix }, status: 'ENABLED' } }),
      prisma.materialApplicability.count({ where: { customerNameSnapshot: orderExtractCustomerName, status: 'ENABLED' } }),
      prisma.customerOrder.count({ where: { orderNo: { startsWith: orderExtractPrefix } } }),
      prisma.orderLine.count({ where: { partCode: { startsWith: orderExtractPrefix } } }),
      prisma.productionTask.count({ where: { partCode: { startsWith: orderExtractPrefix } } }),
      prisma.inventoryBatch.count({ where: { partCode: { startsWith: orderExtractPrefix } } }),
      prisma.inventoryTransaction.count({ where: { partCode: { startsWith: orderExtractPrefix } } })
    ]);
    assert(materialSession, 'from-order-import material import session must be persisted');
    assert(materialSession.files.length === 1, `from-order-import must persist 1 virtual material import file, actual ${materialSession.files.length}`);
    assert(materialSession.files[0].storedFileName === null, 'from-order-import virtual material import file must not create stored Excel file');
    assert(materialSession.files[0].sheetName.includes('ERP'), 'from-order-import virtual sheet must keep ERP source label');
    assert(materialSession.rows.length === 2, `from-order-import must persist 2 material preview rows, actual ${materialSession.rows.length}`);
    assert(
      materialSession.applicabilityRows.length === 2,
      `from-order-import must persist 2 applicability preview rows, actual ${materialSession.applicabilityRows.length}`
    );
    assert(materialSession.transformRows.length === 0, 'from-order-import must not persist transform preview rows');
    assert(materials === 0, `from-order-import must not create Material rows before commit, actual ${materials}`);
    assert(applicabilities === 0, `from-order-import must not create MaterialApplicability rows before commit, actual ${applicabilities}`);
    assert(orders === 0, `from-order-import must not create CustomerOrder rows, actual ${orders}`);
    assert(orderLines === 0, `from-order-import must not create OrderLine rows, actual ${orderLines}`);
    assert(productionTasks === 0, `from-order-import must not create ProductionTask rows, actual ${productionTasks}`);
    assert(batches === 0, `from-order-import must not create InventoryBatch rows, actual ${batches}`);
    assert(transactions === 0, `from-order-import must not create InventoryTransaction rows, actual ${transactions}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function assertExtractedOrderImportModelBomDraftPreviewOnly(preview) {
  assert(preview.sourceOrderImportSessionId, 'model BOM draft preview must keep source order import session id');
  assert(preview.previewToken, 'model BOM draft preview must return previewToken');
  assert(preview.summary.draftCount === 1, `model BOM draft preview must create 1 draft, actual ${preview.summary.draftCount}`);
  assert(preview.summary.lineCount === 2, `model BOM draft preview must include 2 lines, actual ${preview.summary.lineCount}`);
  assert(preview.summary.componentCount === 1, `model BOM draft preview component count must be 1, actual ${preview.summary.componentCount}`);
  assert(preview.summary.childPartCount === 1, `model BOM draft preview child part count must be 1, actual ${preview.summary.childPartCount}`);
  assert(preview.summary.standalonePartCount === 0, `model BOM draft preview standalone part count must be 0, actual ${preview.summary.standalonePartCount}`);
  assert(preview.summary.missingMaterialCount === 2, `model BOM draft preview must flag 2 missing material rows before material commit, actual ${preview.summary.missingMaterialCount}`);
  assert(preview.summary.existingBomScopeCount === 0, `model BOM draft preview must not find existing formal BOM, actual ${preview.summary.existingBomScopeCount}`);
  assert(preview.summary.errorCount === 0, `model BOM draft preview should not have structure errors, actual ${preview.summary.errorCount}`);
  assert(preview.summary.warningCount >= 2, `model BOM draft preview should warn about missing materials, actual ${preview.summary.warningCount}`);
  const draft = preview.drafts[0];
  assert(draft.customerName === orderExtractCustomerName, `model BOM draft customer must come from order import rows, actual ${draft.customerName}`);
  assert(draft.projectModel === 'B5', `model BOM draft projectModel must be B5, actual ${draft.projectModel}`);
  assert(draft.existingBom === null, 'model BOM draft preview must not invent existing formal BOM');
  assert(draft.lines.some((line) => line.lineType === 'COMPONENT' && line.componentNo === 'C001'), 'model BOM draft preview must keep component row');
  assert(draft.lines.some((line) => line.lineType === 'PART' && line.parentComponentNo === 'C001'), 'model BOM draft preview must keep child part relation');
  assert(
    draft.lines.every((line) => line.raw && JSON.stringify(line.raw).includes('verify-material-import-api')),
    'model BOM draft preview lines must keep raw source trace fields'
  );

  const prisma = new PrismaClient();
  try {
    const [formalBoms, formalBomLines, orders, productionTasks, batches, transactions] = await Promise.all([
      prisma.modelBom.count({ where: { customerNameSnapshot: orderExtractCustomerName, status: 'ENABLED' } }),
      prisma.modelBomLine.count({ where: { partCodeSnapshot: { startsWith: orderExtractPrefix }, status: 'ENABLED' } }),
      prisma.customerOrder.count({ where: { orderNo: { startsWith: orderExtractPrefix } } }),
      prisma.productionTask.count({ where: { partCode: { startsWith: orderExtractPrefix } } }),
      prisma.inventoryBatch.count({ where: { partCode: { startsWith: orderExtractPrefix } } }),
      prisma.inventoryTransaction.count({ where: { partCode: { startsWith: orderExtractPrefix } } })
    ]);
    assert(formalBoms === 0, `model BOM draft preview must not create ModelBom rows, actual ${formalBoms}`);
    assert(formalBomLines === 0, `model BOM draft preview must not create ModelBomLine rows, actual ${formalBomLines}`);
    assert(orders === 0, `model BOM draft preview must not create CustomerOrder rows, actual ${orders}`);
    assert(productionTasks === 0, `model BOM draft preview must not create ProductionTask rows, actual ${productionTasks}`);
    assert(batches === 0, `model BOM draft preview must not create InventoryBatch rows, actual ${batches}`);
    assert(transactions === 0, `model BOM draft preview must not create InventoryTransaction rows, actual ${transactions}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function assertDuplicateComponentModelBomDraftBlocked() {
  const duplicateComponentSource = await createOrderImportSourceSession({
    sourceLabel: 'duplicate-component',
    rows: [
      {
        sourceRowNo: 2,
        orderNo: `${orderExtractPrefix}-DUP-001`,
        partCode: `${orderExtractPrefix}-DUP-COMP-A`,
        partName: 'Duplicate component A',
        drawingNo: `${orderExtractPrefix}-DUP-DWG-A`,
        projectModel: 'B3',
        lineType: 'COMPONENT',
        componentNo: 'C001',
        parentComponentNo: null,
        unitUsage: null
      },
      {
        sourceRowNo: 3,
        orderNo: `${orderExtractPrefix}-DUP-001`,
        partCode: `${orderExtractPrefix}-DUP-COMP-B`,
        partName: 'Duplicate component B',
        drawingNo: `${orderExtractPrefix}-DUP-DWG-B`,
        projectModel: 'B3',
        lineType: 'COMPONENT',
        componentNo: 'C001',
        parentComponentNo: null,
        unitUsage: null
      },
      {
        sourceRowNo: 4,
        orderNo: `${orderExtractPrefix}-DUP-001`,
        partCode: `${orderExtractPrefix}-DUP-PART-C`,
        partName: 'Duplicate component child',
        drawingNo: `${orderExtractPrefix}-DUP-DWG-C`,
        projectModel: 'B3',
        lineType: 'PART',
        componentNo: null,
        parentComponentNo: 'C001',
        unitUsage: '1'
      }
    ]
  });
  const preview = await requestJson(`/inventory/model-bom-drafts/from-order-import/${duplicateComponentSource.session.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken: duplicateComponentSource.previewToken })
  });
  assert(preview.summary.draftCount === 1, `duplicate component preview must create 1 draft, actual ${preview.summary.draftCount}`);
  assert(preview.summary.errorCount >= 2, `duplicate component preview must surface structure errors, actual ${preview.summary.errorCount}`);
  const issueCodes = preview.drafts.flatMap((draft) => [
    ...draft.issues.map((issue) => issue.code),
    ...draft.lines.flatMap((line) => line.issues.map((issue) => issue.code))
  ]);
  assert(issueCodes.includes('DUPLICATE_COMPONENT_NO'), 'duplicate component preview must flag DUPLICATE_COMPONENT_NO');
  await expectRequestFailure(
    'model-bom-draft commit duplicate componentNo',
    () =>
      requestJson(`/inventory/model-bom-drafts/from-order-import/${duplicateComponentSource.session.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewToken: duplicateComponentSource.previewToken,
          draftKey: preview.drafts[0].draftKey,
          confirmedBy: `verify-material-import-api-${runId}`
        })
      }),
    '400 Bad Request'
  );
}

async function seedOrderExtractMaterialsForBomCommit() {
  const prisma = new PrismaClient();
  try {
    const materialA = await prisma.material.upsert({
      where: { partCode: `${orderExtractPrefix}-PART-A` },
      create: {
        partCode: `${orderExtractPrefix}-PART-A`,
        partName: 'Order import material draft A',
        unit: 'pcs',
        partSpecification: '200x300',
        status: 'ENABLED'
      },
      update: {
        partName: 'Order import material draft A',
        unit: 'pcs',
        partSpecification: '200x300',
        status: 'ENABLED'
      }
    });
    const materialB = await prisma.material.upsert({
      where: { partCode: `${orderExtractPrefix}-PART-B` },
      create: {
        partCode: `${orderExtractPrefix}-PART-B`,
        partName: 'Order import material draft B',
        unit: 'pcs',
        partSpecification: '200x300',
        status: 'ENABLED'
      },
      update: {
        partName: 'Order import material draft B',
        unit: 'pcs',
        partSpecification: '200x300',
        status: 'ENABLED'
      }
    });
    for (const [material, suffix] of [
      [materialA, 'A'],
      [materialB, 'B']
    ]) {
      await prisma.materialDrawingRevision.upsert({
        where: {
          materialId_drawingNo_drawingVersion: {
            materialId: material.id,
            drawingNo: `${orderExtractPrefix}-UNRELATED-DWG-${suffix}`,
            drawingVersion: 'A'
          }
        },
        create: {
          materialId: material.id,
          drawingNo: `${orderExtractPrefix}-UNRELATED-DWG-${suffix}`,
          drawingVersion: 'A',
          drawingDate: new Date('2026-05-01T00:00:00.000Z'),
          drawingStatus: 'old',
          isDefault: true,
          defaultChangedBy: `verify-material-import-api-${runId}`,
          defaultChangedAt: new Date(),
          status: 'ENABLED'
        },
        update: {
          drawingDate: new Date('2026-05-01T00:00:00.000Z'),
          drawingStatus: 'old',
          isDefault: true,
          defaultChangedBy: `verify-material-import-api-${runId}`,
          defaultChangedAt: new Date(),
          status: 'ENABLED'
        }
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function createConcurrentOrderImportModelBom(label) {
  const prisma = new PrismaClient();
  try {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { customerCode: orderExtractCustomerCode } });
    return prisma.modelBom.create({
      data: {
        bomName: `${orderExtractPrefix}-CONCURRENT-${label}-${runId}`,
        customerId: customer.id,
        customerNameSnapshot: customer.customerName,
        projectModel: 'B5',
        customerScopeMode: 'PRIVATE',
        customerScopeKey: customer.id,
        projectModelScopeKey: 'B5',
        isCommon: false,
        remark: 'verify stale order-import BOM draft review guard',
        status: 'ENABLED'
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

function assertModelBomDraftCommitReadyPreview(preview) {
  assert(preview.summary.draftCount === 1, `commit-ready model BOM preview must keep 1 draft, actual ${preview.summary.draftCount}`);
  assert(preview.summary.lineCount === 2, `commit-ready model BOM preview must keep 2 lines, actual ${preview.summary.lineCount}`);
  assert(preview.summary.missingMaterialCount === 0, `commit-ready model BOM preview must not have missing Material rows, actual ${preview.summary.missingMaterialCount}`);
  assert(preview.summary.existingBomScopeCount === 0, `commit-ready model BOM preview must not have existing BOM scope, actual ${preview.summary.existingBomScopeCount}`);
  assert(preview.summary.errorCount === 0, `commit-ready model BOM preview must not have errors, actual ${preview.summary.errorCount}`);
  assert(
    preview.summary.warningCount >= 2,
    `commit-ready model BOM preview should warn when order-import drawingNo has no matching MaterialDrawingRevision, actual ${preview.summary.warningCount}`
  );
  const draft = preview.drafts[0];
  assert(draft.draftKey, 'commit-ready model BOM preview must expose draftKey for manual confirmation');
  assert(draft.customerId, 'commit-ready model BOM preview must resolve customerId');
  assert(draft.lines.every((line) => line.materialId), 'commit-ready model BOM preview must resolve every line Material');
  assert(draft.lines.every((line) => line.materialStatus === 'ENABLED'), 'commit-ready model BOM preview must only use enabled Materials');
  const issueCodes = draft.lines.flatMap((line) => line.issues.map((issue) => issue.code));
  assert(issueCodes.includes('DRAWING_REVISION_NOT_FOUND'), 'commit-ready model BOM preview must flag missing matching drawing revision');
  return draft;
}

async function assertCommittedOrderImportModelBomDraft(savedBom) {
  assert(savedBom && savedBom.id, 'model BOM draft commit must return saved ModelBom');
  assert(savedBom.customerName === orderExtractCustomerName, `saved ModelBom customerName mismatch: ${savedBom.customerName}`);
  assert(savedBom.projectModel === 'B5', `saved ModelBom projectModel mismatch: ${savedBom.projectModel}`);
  assert(savedBom.customerScopeMode === 'PRIVATE', `saved ModelBom must use PRIVATE scope, actual ${savedBom.customerScopeMode}`);
  assert(savedBom.lineCount === 2, `saved ModelBom lineCount must be 2, actual ${savedBom.lineCount}`);
  assert(savedBom.lines.some((line) => line.lineType === 'COMPONENT' && line.componentNo === 'C001'), 'saved ModelBom must keep component C001 line');
  assert(savedBom.lines.some((line) => line.lineType === 'PART' && line.parentComponentNo === 'C001'), 'saved ModelBom must keep child part parentComponentNo C001');

  const prisma = new PrismaClient();
  try {
    const [boms, revisions, bomLines, orders, orderLines, productionTasks, batches, transactions] = await Promise.all([
      prisma.modelBom.findMany({
        where: { customerNameSnapshot: orderExtractCustomerName, status: 'ENABLED' },
        include: { lines: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } }
      }),
      prisma.modelBomRevision.findMany({
        where: { bomId: savedBom.id },
        orderBy: [{ revisionNo: 'asc' }]
      }),
      prisma.modelBomLine.count({ where: { partCodeSnapshot: { startsWith: orderExtractPrefix }, status: 'ENABLED' } }),
      prisma.customerOrder.count({ where: { orderNo: { startsWith: orderExtractPrefix } } }),
      prisma.orderLine.count({ where: { partCode: { startsWith: orderExtractPrefix } } }),
      prisma.productionTask.count({ where: { partCode: { startsWith: orderExtractPrefix } } }),
      prisma.inventoryBatch.count({ where: { partCode: { startsWith: orderExtractPrefix } } }),
      prisma.inventoryTransaction.count({ where: { partCode: { startsWith: orderExtractPrefix } } })
    ]);
    assert(boms.length === 1, `model BOM draft commit must create exactly 1 ModelBom, actual ${boms.length}`);
    assert(boms[0].id === savedBom.id, 'persisted ModelBom id must match API response');
    assert(boms[0].lines.length === 2, `model BOM draft commit must create 2 ModelBomLine rows, actual ${boms[0].lines.length}`);
    assert(
      boms[0].lines.every((line) => line.defaultDrawingRevisionId === null),
      'model BOM draft commit must not bind an unrelated default drawing revision when imported drawingNo has no exact match'
    );
    assert(revisions.length === 1, `model BOM draft commit must create 1 ModelBomRevision snapshot, actual ${revisions.length}`);
    assert(revisions[0].revisionNo === 1, `model BOM draft commit revisionNo must be 1, actual ${revisions[0].revisionNo}`);
    assert(revisions[0].action === 'ORDER_IMPORT_DRAFT_COMMIT', `model BOM draft commit revision action mismatch: ${revisions[0].action}`);
    assert(
      revisions[0].changeRemark === '订单净表 BOM 草稿人工确认创建',
      `model BOM draft commit revision remark mismatch: ${revisions[0].changeRemark}`
    );
    const snapshot = revisions[0].snapshotJson || {};
    assert(snapshot.bom?.id === savedBom.id, 'model BOM draft commit revision snapshot must reference saved BOM id');
    assert(Array.isArray(snapshot.lines) && snapshot.lines.length === 2, 'model BOM draft commit revision snapshot must keep 2 BOM lines');
    assert(
      snapshot.lines.some((line) => line.lineType === 'COMPONENT' && line.componentNo === 'C001') &&
        snapshot.lines.some((line) => line.lineType === 'PART' && line.parentComponentNo === 'C001'),
      'model BOM draft commit revision snapshot must keep component and child-part structure'
    );
    assert(bomLines === 2, `model BOM draft commit must persist 2 matching ModelBomLine rows, actual ${bomLines}`);
    assert(orders === 0, `model BOM draft commit must not create CustomerOrder rows, actual ${orders}`);
    assert(orderLines === 0, `model BOM draft commit must not create OrderLine rows, actual ${orderLines}`);
    assert(productionTasks === 0, `model BOM draft commit must not create ProductionTask rows, actual ${productionTasks}`);
    assert(batches === 0, `model BOM draft commit must not create InventoryBatch rows, actual ${batches}`);
    assert(transactions === 0, `model BOM draft commit must not create InventoryTransaction rows, actual ${transactions}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function assertReviewedExistingBomCommitAudit(savedBom, reviewedBom) {
  const prisma = new PrismaClient();
  try {
    const row = await prisma.modelBom.findUnique({
      where: { id: savedBom.id },
      include: { revisions: { orderBy: [{ revisionNo: 'asc' }] } }
    });
    assert(row, 'reviewedExistingBomIds commit must persist ModelBom row');
    assert(
      String(row.remark || '').includes('已核对已有 BOM') && String(row.remark || '').includes(reviewedBom.bomName),
      `reviewedExistingBomIds commit remark must record reviewed BOM name, actual ${row.remark}`
    );
    assert(row.revisions.length === 1, `reviewedExistingBomIds commit must create 1 revision, actual ${row.revisions.length}`);
    assert(
      row.revisions[0].action === 'ORDER_IMPORT_DRAFT_COMMIT',
      `reviewedExistingBomIds commit revision action mismatch: ${row.revisions[0].action}`
    );
    assert(
      String(row.revisions[0].changeRemark || '').includes('已核对已有 BOM') &&
        String(row.revisions[0].changeRemark || '').includes(reviewedBom.bomName),
      `reviewedExistingBomIds commit revision remark must record reviewed BOM name, actual ${row.revisions[0].changeRemark}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

function assertModelBomDraftRequiresExistingBomReview(preview, expectedBomIds) {
  assert(preview.summary.draftCount === 1, `existing-BOM review preview must keep 1 draft, actual ${preview.summary.draftCount}`);
  assert(
    preview.summary.existingBomScopeCount === 1,
    `existing-BOM review preview must flag existing BOM scope, actual ${preview.summary.existingBomScopeCount}`
  );
  const draft = preview.drafts[0];
  const existingBoms = draft.existingBoms || (draft.existingBom ? [draft.existingBom] : []);
  const existingIds = new Set(existingBoms.map((bom) => bom.id));
  for (const expectedBomId of expectedBomIds) {
    assert(existingIds.has(expectedBomId), `existing-BOM review preview must expose existing BOM ${expectedBomId}`);
  }
  assert(
    draft.issues.some((issue) => issue.code === 'EXISTING_BOM_SCOPE'),
    'existing-BOM review preview must warn that commit creates another independent BOM'
  );
  return draft;
}

async function materialImportUploadDir() {
  const health = await requestJson('/health');
  const uploadRoot = health?.storage?.uploads?.path;
  assert(uploadRoot, '健康检查必须返回上传目录，用于验证零件库导入临时文件清理');
  return join(uploadRoot, 'material-imports');
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

async function assertNoOrderProductionInventorySideEffects() {
  const prisma = new PrismaClient();
  try {
    const [orderLines, orders, productionTasks, batches, transactions] = await Promise.all([
      prisma.orderLine.count({ where: { partCode: { startsWith: materialPrefix } } }),
      prisma.customerOrder.count({ where: { orderNo: { startsWith: materialPrefix } } }),
      prisma.productionTask.count({ where: { partCode: { startsWith: materialPrefix } } }),
      prisma.inventoryBatch.count({ where: { partCode: { startsWith: materialPrefix } } }),
      prisma.inventoryTransaction.count({ where: { partCode: { startsWith: materialPrefix } } })
    ]);
    assert(orderLines === 0, `零件库导入不得创建订单明细，实际 ${orderLines}`);
    assert(orders === 0, `零件库导入不得创建订单，实际 ${orders}`);
    assert(productionTasks === 0, `零件库导入不得创建生产任务，实际 ${productionTasks}`);
    assert(batches === 0, `零件库导入不得创建库存批次，实际 ${batches}`);
    assert(transactions === 0, `零件库导入不得创建库存流水，实际 ${transactions}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function assertCommittedMaterialData() {
  const prisma = new PrismaClient();
  try {
    const expectedImportPartCodes = [`${materialPrefix}-SRC`, `${materialPrefix}-TGT`];
    const materials = await prisma.material.findMany({
      where: { partCode: { in: expectedImportPartCodes } },
      include: {
        drawingRevisions: true,
        applicabilities: true,
        sourceTransformRules: true,
        targetTransformRules: true
      },
      orderBy: { partCode: 'asc' }
    });
    assert(materials.length === 2, `提交后应只写入 2 个 Material，实际 ${materials.length}`);
    const source = materials.find((item) => item.partCode.endsWith('-SRC'));
    const target = materials.find((item) => item.partCode.endsWith('-TGT'));
    assert(source && target, '提交后必须能找到来源和目标零件');
    assert(source.stockAlertEnabled === true, '来源零件应启用库存报警');
    assert(Number(source.stockAlertQuantity) === 12, `来源零件最小库存应为 12，实际 ${source.stockAlertQuantity}`);
    assert(target.stockAlertEnabled === false, '目标零件应停用库存报警');
    assert(source.defaultProcessRoute === '激光切割', `来源零件默认工艺应写入标准工序，实际 ${source.defaultProcessRoute}`);
    assert(target.defaultProcessRoute === '折弯', `目标零件默认工艺应写入标准工序，实际 ${target.defaultProcessRoute}`);
    assert(source.drawingRevisions.length === 1 && target.drawingRevisions.length === 1, '每个导入零件都应写入图纸版本');
    assert(target.applicabilities.length === 1, '目标零件应写入 1 条适用范围');
    assert(source.sourceTransformRules.length === 1, '来源零件应写入 1 条来源加工关系');
    assert(target.targetTransformRules.length === 1, '目标零件应写入 1 条目标来源加工关系');
  } finally {
    await prisma.$disconnect();
  }
}

async function assertModelBomUsesMaterialDefaultProcessFallback() {
  const projectModel = `${materialPrefix}-PROJECT`;
  let bomId = '';
  const prisma = new PrismaClient();
  try {
    const material = await prisma.material.findUniqueOrThrow({ where: { partCode: `${materialPrefix}-SRC` } });
    const bom = await prisma.modelBom.create({
      data: {
        bomName: `${materialPrefix}-BOM-FALLBACK`,
        customerScopeMode: 'ALL',
        customerScopeKey: 'ALL',
        projectModel,
        projectModelScopeKey: projectModel.toUpperCase(),
        remark: '验证 BOM 行未填默认工艺时回退零件基础库默认工艺',
        lines: {
          create: {
            materialId: material.id,
            partCodeSnapshot: material.partCode,
            partNameSnapshot: material.partName,
            unitSnapshot: material.unit,
            partSpecificationSnapshot: material.partSpecification,
            lineType: 'PART',
            defaultProcessRoute: null,
            defaultQuantity: 1,
            sortOrder: 10,
            status: 'ENABLED'
          }
        }
      },
      select: { id: true }
    });
    bomId = bom.id;
  } finally {
    await prisma.$disconnect();
  }

  const bom = await requestJson(`/inventory/model-boms/${bomId}`);
  const line = bom.lines.find((item) => item.partCode === `${materialPrefix}-SRC`);
  assert(line, 'BOM 默认工艺 fallback 验证必须返回目标 BOM 行');
  assert(
    line.defaultProcessRoute === '激光切割',
    `BOM 行未维护默认工艺时应回退零件默认工艺，实际 ${line.defaultProcessRoute}`
  );
  assert(line.defaultProcessRouteSource === 'MATERIAL', `BOM 行默认工艺来源应标记为 MATERIAL，实际 ${line.defaultProcessRouteSource}`);
  assert(
    line.bomLineDefaultProcessRoute === null,
    `BOM 行自身默认工艺应保持空，不能把零件默认工艺静默保存成 BOM 覆盖值，实际 ${line.bomLineDefaultProcessRoute}`
  );
}

async function assertMaterialDefaultProcessProtectsDefinition() {
  const processName = `${materialPrefix}-PROC-DEFAULT`;
  const definition = await ensureProcessDefinitionFixture(processName, '零件默认工艺引用保护 API 回归');
  const material = await ensureMaterialDefaultProcessFixture({
    partCode: `${materialPrefix}-PROC-MAT`,
    partName: '零件默认工艺引用保护',
    unit: '件',
    defaultProcessRoute: processName
  });
  assert(material.defaultProcessRoute === processName, `零件默认工艺应保存为 ${processName}，实际 ${material.defaultProcessRoute}`);
  await expectRequestFailure(
    '零件默认工艺引用标准工序停用保护',
    () => requestJson(`/process-definitions/${definition.id}`, { method: 'DELETE' }),
    '零件默认工艺'
  );
  await expectRequestFailure(
    '零件默认工艺引用标准工序改名保护',
    () =>
      requestJson(`/process-definitions/${definition.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processName: `${processName}-RENAMED` })
      }),
    '零件默认工艺'
  );
}

async function cleanup() {
  const prisma = new PrismaClient();
  try {
    const sessions = await prisma.materialImportSession.findMany({
      where: {
        OR: [{ id: { in: [...createdSessionIds] } }, { createdBy: { contains: `verify-material-import-api-${runId}` } }]
      },
      include: { files: { select: { storedFileName: true } } }
    });
    for (const session of sessions) {
      for (const file of session.files) {
        if (!file.storedFileName) {
          continue;
        }
        try {
          await unlink(join(await materialImportUploadDir(), file.storedFileName));
        } catch {
          // 回归验证清理尽力执行；最终错误仍由主流程抛出。
        }
      }
    }
    if (sessions.length > 0) {
      await prisma.materialImportSession.deleteMany({ where: { id: { in: sessions.map((session) => session.id) } } });
    }
    const modelBoms = await prisma.modelBom.findMany({
      where: {
        OR: [
          { customerNameSnapshot: orderExtractCustomerName },
          { lines: { some: { partCodeSnapshot: { startsWith: materialPrefix } } } }
        ]
      },
      select: { id: true, bomName: true }
    });
    if (modelBoms.length > 0) {
      const modelBomIds = modelBoms.map((bom) => bom.id);
      await prisma.modelBomDiffReview.updateMany({
        where: { OR: [{ targetBomId: { in: modelBomIds } }, { sourceBomId: { in: modelBomIds } }] },
        data: { status: 'DISABLED' }
      });
      await prisma.modelBomCustomerScope.updateMany({
        where: { bomId: { in: modelBomIds } },
        data: { status: 'DISABLED' }
      });
      await prisma.modelBomLine.updateMany({
        where: { bomId: { in: modelBomIds } },
        data: { status: 'DISABLED' }
      });
      for (const bom of modelBoms) {
        await prisma.modelBom.update({
          where: { id: bom.id },
          data: {
            bomName: archivedFixtureIdentity(bom.bomName, bom.id),
            status: 'DISABLED',
            isCommon: false,
            commonSortOrder: null
          }
        });
      }
    }
    await prisma.orderImportSession.deleteMany({
      where: { createdBy: { contains: `verify-material-import-api-${runId}` } }
    });
    await archiveOrderExtractCustomer(prisma);

    const materials = await prisma.material.findMany({
      where: { partCode: { startsWith: materialPrefix } },
      select: { id: true }
    });
    const materialIds = materials.map((material) => material.id);
    if (materialIds.length > 0) {
      await prisma.materialTransformRule.updateMany({
        where: { OR: [{ sourceMaterialId: { in: materialIds } }, { targetMaterialId: { in: materialIds } }] },
        data: { status: 'DISABLED' }
      });
      await prisma.materialApplicability.updateMany({
        where: { materialId: { in: materialIds } },
        data: { status: 'DISABLED' }
      });
      await prisma.materialDrawingRevision.updateMany({
        where: { materialId: { in: materialIds } },
        data: { status: 'DISABLED', isDefault: false, defaultChangedBy: null, defaultChangedAt: null }
      });
      await prisma.material.updateMany({
        where: { id: { in: materialIds } },
        data: { status: 'DISABLED', defaultProcessRoute: null }
      });
    }
    await prisma.processDefinition.updateMany({
      where: { processName: { startsWith: `${materialPrefix}-PROC` } },
      data: { status: 'DISABLED' }
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await cleanup();
  await assertNoOrderProductionInventorySideEffects();
  const uploadDir = await materialImportUploadDir();

  const template = await requestBuffer('/inventory/material-import-template');
  assertXlsxBuffer(template, '零件库导入模板');
  const config = await requestJson('/inventory/material-import-config');
  assert(Array.isArray(config.allowedExtensions) && config.allowedExtensions.includes('.xlsx'), '零件库导入配置必须允许 .xlsx');

  const orderImportSource = await createOrderImportSourceSession();
  await expectRequestFailure(
    'from-order-import stale previewToken',
    () =>
      requestJson(`/inventory/material-import-sessions/from-order-import/${orderImportSource.session.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewToken: `${orderImportSource.previewToken}-stale`,
          createdBy: `verify-material-import-api-${runId}-from-order-import`
        })
      }),
    '400 Bad Request'
  );
  const extractedPreview = await requestJson(`/inventory/material-import-sessions/from-order-import/${orderImportSource.session.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      previewToken: orderImportSource.previewToken,
      createdBy: `verify-material-import-api-${runId}-from-order-import`
    })
  });
  createdSessionIds.add(extractedPreview.id);
  await assertExtractedOrderImportDraftOnly(extractedPreview);
  await requestJson(`/inventory/material-import-sessions/${extractedPreview.id}`, { method: 'DELETE' });

  await expectRequestFailure(
    'model-bom-draft stale previewToken',
    () =>
      requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewToken: `${orderImportSource.previewToken}-stale` })
      }),
    '400 Bad Request'
  );
  const bomDraftPreview = await requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken: orderImportSource.previewToken })
  });
  await assertExtractedOrderImportModelBomDraftPreviewOnly(bomDraftPreview);
  await assertDuplicateComponentModelBomDraftBlocked();
  await expectRequestFailure(
    'model-bom-draft commit stale previewToken',
    () =>
      requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewToken: `${orderImportSource.previewToken}-stale`,
          draftKey: bomDraftPreview.drafts[0].draftKey,
          confirmedBy: `verify-material-import-api-${runId}`
        })
      }),
    '400 Bad Request'
  );
  await expectRequestFailure(
    'model-bom-draft commit missing Material',
    () =>
      requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewToken: orderImportSource.previewToken,
          draftKey: bomDraftPreview.drafts[0].draftKey,
          confirmedBy: `verify-material-import-api-${runId}`
        })
      }),
    '400 Bad Request'
  );
  await seedOrderExtractMaterialsForBomCommit();
  const commitReadyBomDraftPreview = await requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken: orderImportSource.previewToken })
  });
  const commitReadyDraft = assertModelBomDraftCommitReadyPreview(commitReadyBomDraftPreview);
  await expectRequestFailure(
    'model-bom-draft commit unrelated reviewedExistingBomIds without existing BOM',
    () =>
      requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewToken: orderImportSource.previewToken,
          draftKey: commitReadyDraft.draftKey,
          bomName: `${commitReadyDraft.bomName} unrelated-reviewed-${runId}`,
          confirmedBy: `verify-material-import-api-${runId}`,
          reviewedExistingBomIds: [`not-current-${runId}`]
        })
      }),
    '当前草稿范围'
  );
  const committedBom = await requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      previewToken: orderImportSource.previewToken,
      draftKey: commitReadyDraft.draftKey,
      confirmedBy: `verify-material-import-api-${runId}`
    })
  });
  await assertCommittedOrderImportModelBomDraft(committedBom);
  const existingBomReviewPreview = await requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken: orderImportSource.previewToken })
  });
  const existingBomReviewDraft = assertModelBomDraftRequiresExistingBomReview(existingBomReviewPreview, [committedBom.id]);
  await expectRequestFailure(
    'model-bom-draft commit existing BOM without reviewedExistingBomIds',
    () =>
      requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewToken: orderImportSource.previewToken,
          draftKey: existingBomReviewDraft.draftKey,
          bomName: `${existingBomReviewDraft.bomName} reviewed-missing-${runId}`,
          confirmedBy: `verify-material-import-api-${runId}`
        })
      }),
    '差异核对'
  );
  const concurrentBom = await createConcurrentOrderImportModelBom('STALE-SCOPE');
  await expectRequestFailure(
    'model-bom-draft commit stale existing BOM review',
    () =>
      requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewToken: orderImportSource.previewToken,
          draftKey: existingBomReviewDraft.draftKey,
          bomName: `${existingBomReviewDraft.bomName} stale-reviewed-${runId}`,
          confirmedBy: `verify-material-import-api-${runId}`,
          reviewedExistingBomIds: [committedBom.id]
        })
      }),
    '逐个完成差异核对'
  );
  const refreshedExistingBomReviewPreview = await requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken: orderImportSource.previewToken })
  });
  const refreshedExistingBomReviewDraft = assertModelBomDraftRequiresExistingBomReview(refreshedExistingBomReviewPreview, [
    committedBom.id,
    concurrentBom.id
  ]);
  const reviewedExistingBom = await requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      previewToken: orderImportSource.previewToken,
      draftKey: refreshedExistingBomReviewDraft.draftKey,
      bomName: `${refreshedExistingBomReviewDraft.bomName} reviewed-${runId}`,
      confirmedBy: `verify-material-import-api-${runId}`,
      reviewedExistingBomIds: [committedBom.id, concurrentBom.id]
    })
  });
  assert(reviewedExistingBom.id !== committedBom.id, 'reviewedExistingBomIds commit must create a second independent ModelBom');
  assert(reviewedExistingBom.lineCount === 2, `reviewedExistingBomIds commit must keep 2 lines, actual ${reviewedExistingBom.lineCount}`);
  await assertReviewedExistingBomCommitAudit(reviewedExistingBom, committedBom);
  const multiExistingBomReviewPreview = await requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken: orderImportSource.previewToken })
  });
  const multiExistingBomReviewDraft = assertModelBomDraftRequiresExistingBomReview(multiExistingBomReviewPreview, [
    committedBom.id,
    concurrentBom.id,
    reviewedExistingBom.id
  ]);
  await expectRequestFailure(
    'model-bom-draft commit partial reviewedExistingBomIds',
    () =>
      requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewToken: orderImportSource.previewToken,
          draftKey: multiExistingBomReviewDraft.draftKey,
          bomName: `${multiExistingBomReviewDraft.bomName} partial-reviewed-${runId}`,
          confirmedBy: `verify-material-import-api-${runId}`,
          reviewedExistingBomIds: [committedBom.id, concurrentBom.id]
        })
      }),
    '差异核对'
  );
  await expectRequestFailure(
    'model-bom-draft commit duplicate formal BOM name scope',
    () =>
      requestJson(`/inventory/model-bom-drafts/from-order-import/${orderImportSource.session.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewToken: orderImportSource.previewToken,
          draftKey: commitReadyDraft.draftKey,
          confirmedBy: `verify-material-import-api-${runId}`,
          reviewedExistingBomIds: [committedBom.id, concurrentBom.id, reviewedExistingBom.id]
        })
      }),
    '400 Bad Request'
  );

  const deleteSession = await createSession(`verify-material-import-api-${runId}-delete`);
  const deleteToken = `material-import-api-delete-${runId}`;
  const deletePreview = await uploadWorkbook(deleteSession.id, await validMaterialImportWorkbook(), `${deleteToken}.xlsx`);
  assert(deletePreview.files.length === 1, '删除文件验证会话应有 1 个上传文件');
  const afterDelete = await requestJson(`/inventory/material-import-sessions/${deleteSession.id}/files/${deletePreview.files[0].id}`, {
    method: 'DELETE'
  });
  assert(afterDelete.summary.rowCount === 0 && afterDelete.files.length === 0, '删除零件库导入文件后预览必须清空');
  assertNoStoredImportFilesMatching(uploadDir, deleteToken, '删除零件库导入文件');
  await requestJson(`/inventory/material-import-sessions/${deleteSession.id}`, { method: 'DELETE' });

  const issueSession = await createSession(`verify-material-import-api-${runId}-issues`);
  const issuePreview = await uploadWorkbook(issueSession.id, await issueMaterialImportWorkbook(), `material-import-api-issues-${runId}.xlsx`);
  assert(issuePreview.summary.errorCount > 0, '问题明细验证会话必须产生错误');
  const issueReport = await requestBuffer(`/inventory/material-import-sessions/${issueSession.id}/error-report`);
  assertXlsxBuffer(issueReport, '零件库导入问题明细');
  await requestJson(`/inventory/material-import-sessions/${issueSession.id}`, { method: 'DELETE' });

  const requiredSession = await createSession(`verify-material-import-api-${runId}-required-fields`);
  const requiredPreview = await uploadWorkbook(
    requiredSession.id,
    await missingRequiredMaterialImportWorkbook(),
    `material-import-api-required-fields-${runId}.xlsx`
  );
  const requiredIssueCodes = new Set([
    ...requiredPreview.rows.flatMap((row) => (Array.isArray(row.issues) ? row.issues.map((issue) => issue.code) : [])),
    ...requiredPreview.applicabilityRows.flatMap((row) =>
      Array.isArray(row.issues) ? row.issues.map((issue) => issue.code) : []
    ),
    ...requiredPreview.transformRows.flatMap((row) => (Array.isArray(row.issues) ? row.issues.map((issue) => issue.code) : []))
  ]);
  for (const issueCode of [
    'REQUIRED_PART_NAME',
    'REQUIRED_UNIT',
    'STOCK_ALERT_QUANTITY_REQUIRED',
    'INVALID_PART_THICKNESS',
    'REQUIRED_PART_CODE',
    'SAME_SOURCE_TARGET',
    'INVALID_MULTIPLIER',
    'INVALID_LOSS_RATE'
  ]) {
    assert(requiredIssueCodes.has(issueCode), `缺少业务错误行必须保留预览 issue：${issueCode}`);
  }
  assert(requiredPreview.summary.errorCount >= 8, `缺少业务字段预览必须产生错误，实际 ${requiredPreview.summary.errorCount}`);
  const requiredIssueReport = await requestBuffer(`/inventory/material-import-sessions/${requiredSession.id}/error-report`);
  assertXlsxBuffer(requiredIssueReport, '缺少业务字段的零件库导入问题明细');
  await requestJson(`/inventory/material-import-sessions/${requiredSession.id}`, { method: 'DELETE' });

  const staleSession = await createSession(`verify-material-import-api-${runId}-stale-token`);
  const firstStalePreview = await uploadWorkbook(staleSession.id, await validMaterialImportWorkbook(), `material-import-api-stale-a-${runId}.xlsx`);
  await uploadWorkbook(
    staleSession.id,
    await workbookBuffer({
      materialRows: [[`${materialPrefix}-STALE`, '预览变化零件', '件', '', '', '', '', '', '', '', '', '', '刷新 previewToken 验证']]
    }),
    `material-import-api-stale-b-${runId}.xlsx`
  );
  await expectRequestFailure(
    '旧 previewToken 提交',
    () =>
      requestJson(`/inventory/material-import-sessions/${staleSession.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewToken: firstStalePreview.previewToken })
      }),
    '导入预览已变化'
  );
  await requestJson(`/inventory/material-import-sessions/${staleSession.id}`, { method: 'DELETE' });

  const commitSession = await createSession(`verify-material-import-api-${runId}-commit`);
  const preview = await uploadWorkbook(commitSession.id, await validMaterialImportWorkbook(), `零件库导入验证-${runId}.xlsx`);
  assert(preview.status === 'DRAFT', `上传后会话应保持 DRAFT，实际 ${preview.status}`);
  assert(preview.previewToken, '零件库导入提交必须返回 previewToken');
  assert(preview.summary.fileCount === 1, `上传后文件数应为 1，实际 ${preview.summary.fileCount}`);
  assert(preview.summary.materialRowCount === 2, `基础零件预览应为 2 行，实际 ${preview.summary.materialRowCount}`);
  assert(preview.summary.applicabilityRowCount === 1, `适用范围预览应为 1 行，实际 ${preview.summary.applicabilityRowCount}`);
  assert(preview.summary.transformRowCount === 1, `来源加工关系预览应为 1 行，实际 ${preview.summary.transformRowCount}`);
  assert(preview.summary.errorCount === 0, `可提交预览不应有错误，实际 ${preview.summary.errorCount}`);
  assertNoMojibake(preview.files[0]?.fileName, '零件库导入来源文件名');
  assertNoMojibake(preview.rows[0]?.partName, '零件库导入中文零件名称');
  const result = await requestJson(`/inventory/material-import-sessions/${commitSession.id}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken: preview.previewToken })
  });
  assert(
    Number(result.createdCount || 0) + Number(result.updatedCount || 0) === 2,
    `零件库导入应写入 2 个 Material，新增 ${result.createdCount}，更新 ${result.updatedCount}`
  );
  assert(result.drawingRevisionUpsertCount === 2, `零件库导入应写入 2 条图纸版本，实际 ${result.drawingRevisionUpsertCount}`);
  assert(result.applicabilityUpsertCount === 1, `零件库导入应写入 1 条适用范围，实际 ${result.applicabilityUpsertCount}`);
  assert(result.transformRuleUpsertCount === 1, `零件库导入应写入 1 条来源加工关系，实际 ${result.transformRuleUpsertCount}`);

  await assertCommittedMaterialData();
  await assertModelBomUsesMaterialDefaultProcessFallback();
  await assertMaterialDefaultProcessProtectsDefinition();
  await assertNoOrderProductionInventorySideEffects();
}

main()
  .then(async () => {
    await cleanup();
    console.log(
      JSON.stringify(
        {
          ok: true,
          runId,
          checked: [
            'template',
            'config',
            'from-order-import-draft-preview',
            'from-order-import-model-bom-draft-preview',
            'from-order-import-model-bom-draft-duplicate-component',
            'from-order-import-model-bom-draft-commit',
            'from-order-import-model-bom-draft-unrelated-existing-review',
            'from-order-import-model-bom-draft-revision-snapshot',
            'from-order-import-model-bom-draft-existing-review',
            'from-order-import-model-bom-draft-existing-review-audit',
            'from-order-import-model-bom-draft-partial-existing-review',
            'from-order-import-model-bom-draft-stale-existing-review',
            'upload-preview',
            'delete-file-cleanup',
            'issue-report',
            'required-field-preview-errors',
            'stale-preview-token',
            'commit-material-drawing-applicability-transform',
            'model-bom-material-default-process-fallback',
            'material-default-process-definition-reference-guard',
            'no-order-production-inventory-side-effects'
          ]
        },
        null,
        2
      )
    );
  })
  .catch(async (error) => {
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error('零件库导入 API 回归验证清理失败:', cleanupError);
    }
    console.error(error);
    process.exitCode = 1;
  });
