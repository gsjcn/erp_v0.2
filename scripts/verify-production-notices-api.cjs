#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

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
  process.env.NOTICE_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  process.env.ORDER_IMPORT_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(
  /\/$/,
  ''
);
const runId = 'STABLE';
const testPrefix = 'COD-NOTICE-STABLE';
const productionNoticeNo = `${testPrefix}-P`;
const warehouseNoticeNo = `${testPrefix}-W`;
const orderNo = `${testPrefix}-ORDER`;
const shortageOrderNo = `${testPrefix}-SHORTAGE`;
const shortageTaskNo = `${testPrefix}-SHORTAGE-TASK`;
const processStepShortageOrderNo = `${testPrefix}-PROCESS-SHORTAGE`;
const processStepShortageTaskNo = `${testPrefix}-PROCESS-SHORTAGE-TASK`;
const customerCode = `${testPrefix}-CUSTOMER`;
const productionPartCode = `${testPrefix}-PART-P`;
const warehousePartCode = `${testPrefix}-PART-W`;
const shortagePartCode = `${testPrefix}-PART-SHORTAGE`;
const processStepShortagePartCode = `${testPrefix}-PART-PROCESS-SHORTAGE`;
const customerName = `Notice Filter Customer ${runId}`;
const prisma = new PrismaClient();

function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

async function expectRequestFailure(label, action, expectedMessage) {
  let failed = false;
  try {
    await action();
  } catch (error) {
    failed = true;
    assert(
      String(error.message || '').includes(expectedMessage),
      `${label} failure should include "${expectedMessage}", actual: ${error.message}`
    );
  }
  assert(failed, `${label} should fail`);
}

function query(params, options = {}) {
  const search = new URLSearchParams();
  const values = { ...params };
  if (options.includeTestFixtures !== false) {
    values.includeTestFixtures = 'true';
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function noticeListItems(payload, label) {
  if (Array.isArray(payload)) {
    return payload;
  }
  assert(payload && typeof payload === 'object', `${label} must return a paged response object`);
  assert(Array.isArray(payload.items), `${label} paged response must include items array`);
  assert(Number.isInteger(payload.totalCount), `${label} paged response must include totalCount`);
  assert(Number.isInteger(payload.limit), `${label} paged response must include limit`);
  assert(Number.isInteger(payload.offset), `${label} paged response must include offset`);
  assert(typeof payload.hasMore === 'boolean', `${label} paged response must include hasMore`);
  return payload.items;
}

function assertNoticeListContainsOnly(payload, noticeNo, label) {
  const list = noticeListItems(payload, label);
  assert(list.some((notice) => notice.noticeNo === noticeNo), `${label} must include ${noticeNo}`);
  assert(
    list.every((notice) => notice.noticeNo === noticeNo),
    `${label} must not include unrelated notices: ${list.map((notice) => notice.noticeNo).join(', ')}`
  );
}

async function assertDefaultBusinessListsHideFixtures() {
  const endpoints = [
    '/production/tasks?displayStatus=ALL&withPage=true&limit=100&offset=0',
    '/production/tasks/notices?withPage=true&limit=100&offset=0',
    '/production/tasks/notices/admin?withPage=true&limit=100&offset=0',
    '/production/tasks/replenishment-requests?withPage=true&limit=100&offset=0',
    '/production/tasks/scrap-records?withPage=true&limit=100&offset=0',
    '/warehouse/notices?withPage=true&limit=100&offset=0'
  ];
  for (const endpoint of endpoints) {
    const payload = await requestJson(endpoint);
    assert(
      !JSON.stringify(payload).includes(testPrefix),
      `${endpoint} must hide stable production notice test fixtures unless includeTestFixtures=true`
    );
  }
}

async function cleanup() {
  await prisma.productionReplenishmentRequest.deleteMany({ where: { orderNo: { startsWith: testPrefix } } });
  await prisma.productionScrapRecord.deleteMany({ where: { orderNo: { startsWith: testPrefix } } });
  await prisma.productionNotice.deleteMany({ where: { noticeNo: { startsWith: testPrefix } } });
  await prisma.productionTask.deleteMany({ where: { orderNo: { startsWith: testPrefix } } });
  await prisma.customerOrder.deleteMany({ where: { orderNo: { startsWith: testPrefix } } });
  let customer = await prisma.customer.findUnique({ where: { customerCode } });
  if (!customer) {
    customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { customerCode: { startsWith: `${customerCode}__DISABLED__` } },
          { customerName: { startsWith: `${customerName}__DISABLED__` } }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });
  }
  if (customer?.id) {
    const archiveSuffix = `__DISABLED__${customer.id.slice(0, 8)}`;
    await prisma.customerContact.updateMany({
      where: { customerId: customer.id, status: 'ENABLED' },
      data: { status: 'DISABLED', isPrimary: false }
    });
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        customerCode: `${customerCode}${archiveSuffix}`,
        customerName: `${customerName}${archiveSuffix}`,
        contactName: null,
        contactPhone: null,
        status: 'DISABLED'
      }
    });
  }
}

async function seedNotices() {
  await cleanup();
  const customerData = {
    customerCode,
    customerName,
    contactName: 'Notice Tester',
    contactPhone: '13800000000',
    regionType: 'CHINA',
    country: 'China',
    province: 'Jiangsu',
    city: 'Suzhou',
    detailAddress: 'Notice filter test address',
    status: 'ENABLED'
  };
  let existingCustomer = await prisma.customer.findUnique({ where: { customerCode } });
  if (!existingCustomer) {
    existingCustomer = await prisma.customer.findFirst({
      where: {
        OR: [
          { customerCode: { startsWith: `${customerCode}__DISABLED__` } },
          { customerName: { startsWith: `${customerName}__DISABLED__` } }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });
  }
  const customer = existingCustomer
    ? await prisma.customer.update({ where: { id: existingCustomer.id }, data: customerData })
    : await prisma.customer.create({ data: customerData });
  const order = await prisma.customerOrder.create({
    data: {
      orderNo,
      customerId: customer.id,
      customerCode,
      customerName,
      customerSnapshot: {
        customerCode,
        customerName,
        contactName: 'Notice Tester',
        contactPhone: '13800000000'
      },
      orderDate: new Date(),
      status: 'IN_PRODUCTION',
      remark: 'Temporary notice filter API regression order'
    }
  });

  await prisma.productionNotice.createMany({
    data: [
      {
        noticeNo: productionNoticeNo,
        noticeType: 'QUANTITY_INCREASE',
        target: 'PRODUCTION',
        status: 'PENDING',
        orderId: order.id,
        orderNo,
        partCode: productionPartCode,
        partName: 'Production Notice Part',
        beforeQuantity: 1,
        afterQuantity: 2,
        deltaQuantity: 1,
        unit: 'pcs',
        reason: `production notice filter reason ${runId}`,
        managerName: 'Notice Manager'
      },
      {
        noticeNo: warehouseNoticeNo,
        noticeType: 'ORDER_CANCELLED',
        target: 'WAREHOUSE',
        status: 'PENDING',
        orderId: order.id,
        orderNo,
        partCode: warehousePartCode,
        partName: 'Warehouse Notice Part',
        beforeQuantity: 2,
        afterQuantity: 0,
        deltaQuantity: -2,
        unit: 'pcs',
        reason: `warehouse notice filter reason ${runId}`,
        managerName: 'Notice Manager',
        handlingPlan: {
          handlingMode: 'NONE',
          handlingQuantity: 0,
          remark: 'No physical stock for API regression',
          plannedBy: 'Notice Manager',
          plannedAt: new Date().toISOString()
        }
      }
    ]
  });

  return { customer, order };
}

async function seedShortageTask(customer) {
  const order = await prisma.customerOrder.create({
    data: {
      orderNo: shortageOrderNo,
      customerId: customer.id,
      customerCode,
      customerName,
      customerSnapshot: {
        customerCode,
        customerName,
        contactName: 'Notice Tester',
        contactPhone: '13800000000'
      },
      orderDate: new Date(),
      status: 'PENDING_PRODUCTION',
      remark: 'Temporary production shortage API regression order'
    }
  });
  const line = await prisma.orderLine.create({
    data: {
      orderId: order.id,
      lineNo: 1,
      partCode: shortagePartCode,
      partName: 'Production Shortage Regression Part',
      drawingNo: `${testPrefix}-DRW-SHORTAGE`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity: 10,
      productionPlanQuantity: 10,
      productionPlanSuggestedQuantity: 10,
      fulfillmentMode: 'PRODUCTION',
      unit: 'pcs',
      processSnapshot: [{ processName: '激光切割' }],
      lineType: 'PART'
    }
  });
  await prisma.orderLineProcessStep.create({
    data: {
      orderLineId: line.id,
      stepNo: 1,
      processName: '激光切割'
    }
  });
  return prisma.productionTask.create({
    data: {
      productionTaskNo: shortageTaskNo,
      orderId: order.id,
      orderLineId: line.id,
      orderNo: shortageOrderNo,
      customerName,
      partCode: shortagePartCode,
      partName: 'Production Shortage Regression Part',
      plannedQuantity: 10,
      unit: 'pcs',
      processSnapshot: [{ processName: '激光切割' }],
      status: 'PENDING'
    }
  });
}

async function assertProductionShortageCompletionRequiresHandling(customer) {
  const task = await seedShortageTask(customer);
  await requestJson(`/production/tasks/${task.id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supervisorCode: 'WS-001' })
  });
  await requestJson(`/production/tasks/${task.id}/process-completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      processName: '激光切割',
      isCompleted: true,
      completedQuantity: 8,
      operatorCodes: ['OP-001']
    })
  });

  let rejectedWithoutHandling = false;
  try {
    await requestJson(`/production/tasks/${task.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supervisorCode: 'WS-001',
        completedQuantity: 8,
        operatorCodes: ['OP-001']
      })
    });
  } catch (error) {
    rejectedWithoutHandling = true;
    assert(
      String(error.message || '').includes('最终完成数量小于计划数量时，必须填写报废数量'),
      `shortage completion without handling must be rejected by scrap quantity guard, actual=${error.message}`
    );
  }
  assert(rejectedWithoutHandling, 'shortage completion without handling must be rejected');

  const completedTask = await requestJson(`/production/tasks/${task.id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      supervisorCode: 'WS-001',
      completedQuantity: 8,
      operatorCodes: ['OP-001'],
      scrapQuantity: 0,
      shortageMode: 'MANAGER_APPROVED',
      managerName: 'Notice Manager',
      shortageReason: 'API regression manager approved shortage completion'
    })
  });
  assert(completedTask.status === 'COMPLETED', `shortage completion with manager approval must complete task, actual=${completedTask.status}`);

  const savedTask = await prisma.productionTask.findUnique({
    where: { id: task.id },
    include: { processCompletions: { orderBy: { stepNo: 'asc' } } }
  });
  const finalCompletion = savedTask?.processCompletions?.[0];
  assert(Number(savedTask?.completedQuantity || 0) === 8, `shortage task completed quantity must be 8, actual=${savedTask?.completedQuantity}`);
  assert(Number(finalCompletion?.shortageQuantity || 0) === 2, `shortage completion must record shortageQuantity=2, actual=${finalCompletion?.shortageQuantity}`);
  assert(finalCompletion?.shortageMode === 'MANAGER_APPROVED', `shortage completion must record MANAGER_APPROVED, actual=${finalCompletion?.shortageMode}`);
  assert(finalCompletion?.managerName === 'Notice Manager', 'shortage completion must keep managerName');
  assert(
    finalCompletion?.shortageReason === 'API regression manager approved shortage completion',
    'shortage completion must keep shortageReason'
  );
}

async function seedProcessStepShortageTask(customer) {
  const processName = 'Final Assembly';
  const order = await prisma.customerOrder.create({
    data: {
      orderNo: processStepShortageOrderNo,
      customerId: customer.id,
      customerCode,
      customerName,
      customerSnapshot: {
        customerCode,
        customerName,
        contactName: 'Notice Tester',
        contactPhone: '13800000000'
      },
      orderDate: new Date(),
      status: 'PENDING_PRODUCTION',
      remark: 'Temporary final process step shortage API regression order'
    }
  });
  const line = await prisma.orderLine.create({
    data: {
      orderId: order.id,
      lineNo: 1,
      partCode: processStepShortagePartCode,
      partName: 'Final Process Step Shortage Regression Part',
      drawingNo: `${testPrefix}-DRW-PROCESS-SHORTAGE`,
      drawingVersion: 'A',
      partThickness: 1,
      partSpecification: '100mm x 100mm',
      quantity: 10,
      productionPlanQuantity: 10,
      productionPlanSuggestedQuantity: 10,
      fulfillmentMode: 'PRODUCTION',
      unit: 'pcs',
      processSnapshot: [{ processName }],
      lineType: 'PART'
    }
  });
  await prisma.orderLineProcessStep.create({
    data: {
      orderLineId: line.id,
      stepNo: 1,
      processName
    }
  });
  const task = await prisma.productionTask.create({
    data: {
      productionTaskNo: processStepShortageTaskNo,
      orderId: order.id,
      orderLineId: line.id,
      orderNo: processStepShortageOrderNo,
      customerName,
      partCode: processStepShortagePartCode,
      partName: 'Final Process Step Shortage Regression Part',
      plannedQuantity: 10,
      unit: 'pcs',
      processSnapshot: [{ processName }],
      status: 'PENDING'
    }
  });
  return { task, processName };
}

async function assertFinalProcessStepShortageRequestCreatesPendingReview(customer) {
  const { task, processName } = await seedProcessStepShortageTask(customer);
  await requestJson(`/production/tasks/${task.id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supervisorCode: 'WS-001' })
  });
  const updatedTask = await requestJson(`/production/tasks/${task.id}/process-completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      processName,
      isCompleted: true,
      completedQuantity: 8,
      operatorCodes: ['OP-001'],
      scrapQuantity: 2,
      shortageMode: 'REPLENISHMENT_REQUEST',
      remark: 'API regression final process step shortage request'
    })
  });
  assert(
    updatedTask.status === 'WAITING_CONFIRMATION',
    `final process step shortage save must move task to WAITING_CONFIRMATION, actual=${updatedTask.status}`
  );

  const savedTask = await prisma.productionTask.findUnique({
    where: { id: task.id },
    include: { processCompletions: { include: { replenishmentRequests: true } } }
  });
  const finalCompletion = savedTask?.processCompletions?.[0];
  assert(finalCompletion, 'final process step shortage save must create a process completion row');
  assert(finalCompletion?.shortageMode === 'REPLENISHMENT_REQUEST', `final process step must keep shortage request mode, actual=${finalCompletion?.shortageMode}`);
  assert(Number(finalCompletion?.shortageQuantity || 0) === 2, `final process step must record shortageQuantity=2, actual=${finalCompletion?.shortageQuantity}`);
  assert(Number(finalCompletion?.scrapQuantity || 0) === 2, `final process step must record scrapQuantity=2, actual=${finalCompletion?.scrapQuantity}`);

  const request = await prisma.productionReplenishmentRequest.findUnique({
    where: { processCompletionId: finalCompletion.id }
  });
  assert(request?.status === 'PENDING', `final process step shortage request must wait for supervisor review, actual=${request?.status}`);
  assert(request?.sourceType === 'PRODUCTION_SCRAP', `final process step shortage request source must be PRODUCTION_SCRAP, actual=${request?.sourceType}`);
  assert(Number(request?.requestQuantity || 0) === 2, `final process step shortage request quantity must be 2, actual=${request?.requestQuantity}`);
  assert(Number(request?.scrapQuantity || 0) === 2, `final process step shortage request scrap quantity must be 2, actual=${request?.scrapQuantity}`);

  const scrapRecord = await prisma.productionScrapRecord.findUnique({
    where: {
      sourceRecordType_sourceRecordId: {
        sourceRecordType: 'ProductionProcessCompletion',
        sourceRecordId: finalCompletion.id
      }
    }
  });
  assert(Number(scrapRecord?.quantity || 0) === 2, `final process step shortage scrap record quantity must be 2, actual=${scrapRecord?.quantity}`);
}

async function run() {
  const { customer } = await seedNotices();
  const today = localDateKey();
  await assertFinalProcessStepShortageRequestCreatesPendingReview(customer);
  await assertProductionShortageCompletionRequiresHandling(customer);
  await assertDefaultBusinessListsHideFixtures();

  const productionByPart = noticeListItems(
    await requestJson(
      `/production/tasks/notices${query({
        target: 'PRODUCTION',
        partCode: productionPartCode,
        noticeType: 'QUANTITY_INCREASE',
        dateFrom: today,
        dateTo: today
      })}`
    ),
    'production notice part/type/date filter'
  );
  assertNoticeListContainsOnly(productionByPart, productionNoticeNo, 'production notice part/type/date filter');
  assert(productionByPart[0].customerName === customerName, 'production notice response must include customerName');

  const productionByKeyword = noticeListItems(
    await requestJson(
      `/production/tasks/notices${query({
        target: 'PRODUCTION',
        keyword: runId,
        customerId: customer.id,
        orderNo
      })}`
    ),
    'production notice keyword/customer/order filter'
  );
  assertNoticeListContainsOnly(productionByKeyword, productionNoticeNo, 'production notice keyword/customer/order filter');

  await requestJson(`/production/tasks/notices/${productionByPart[0].id}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledgedBy: 'Notice API Tester' })
  });
  const acknowledgedProduction = noticeListItems(
    await requestJson(
      `/production/tasks/notices${query({
        target: 'PRODUCTION',
        status: 'ACKNOWLEDGED',
        keyword: productionPartCode
      })}`
    ),
    'production acknowledged history filter'
  );
  assertNoticeListContainsOnly(acknowledgedProduction, productionNoticeNo, 'production acknowledged history filter');
  assert(acknowledgedProduction[0].acknowledgedBy === 'Notice API Tester', 'acknowledged notice must keep acknowledgedBy');
  await expectRequestFailure(
    'repeat production notice acknowledgement',
    () =>
      requestJson(`/production/tasks/notices/${productionByPart[0].id}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgedBy: 'Notice API Rewriter' })
      }),
    '不能重复确认'
  );
  const repeatedAcknowledgedProduction = noticeListItems(
    await requestJson(
      `/production/tasks/notices${query({
        target: 'PRODUCTION',
        status: 'ACKNOWLEDGED',
        keyword: productionPartCode
      })}`
    ),
    'production acknowledged history after repeat attempt'
  );
  assertNoticeListContainsOnly(repeatedAcknowledgedProduction, productionNoticeNo, 'production acknowledged history after repeat attempt');
  assert(
    repeatedAcknowledgedProduction[0].acknowledgedBy === 'Notice API Tester',
    'repeat acknowledgement must not overwrite acknowledgedBy'
  );

  const warehouseByCustomer = noticeListItems(
    await requestJson(
      `/warehouse/notices${query({
        customerKeyword: customerName.slice(0, 12),
        partCode: warehousePartCode,
        noticeType: 'ORDER_CANCELLED',
        dateFrom: today,
        dateTo: today
      })}`
    ),
    'warehouse notice customer/part/type/date filter'
  );
  assertNoticeListContainsOnly(warehouseByCustomer, warehouseNoticeNo, 'warehouse notice customer/part/type/date filter');
  assert(warehouseByCustomer[0].customerName === customerName, 'warehouse notice response must include customerName');

  const warehouseByKeyword = noticeListItems(
    await requestJson(`/warehouse/notices${query({ keyword: `warehouse notice filter reason ${runId}` })}`),
    'warehouse notice keyword filter'
  );
  assertNoticeListContainsOnly(warehouseByKeyword, warehouseNoticeNo, 'warehouse notice keyword filter');
  await requestJson(`/warehouse/notices/${warehouseByCustomer[0].id}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      acknowledgedByCode: 'WH-001',
      acknowledgedBy: 'WH-001',
      handlingMode: 'NONE',
      handlingQuantity: 0,
      remark: 'No physical stock for warehouse notice API regression'
    })
  });
  const acknowledgedWarehouse = noticeListItems(
    await requestJson(
      `/warehouse/notices${query({
        status: 'ACKNOWLEDGED',
        keyword: warehousePartCode
      })}`
    ),
    'warehouse acknowledged history filter'
  );
  assertNoticeListContainsOnly(acknowledgedWarehouse, warehouseNoticeNo, 'warehouse acknowledged history filter');
  assert(
    String(acknowledgedWarehouse[0].acknowledgedBy || '').includes('WH-001'),
    'warehouse acknowledged notice must keep warehouse operator snapshot'
  );
  await expectRequestFailure(
    'repeat warehouse notice acknowledgement',
    () =>
      requestJson(`/warehouse/notices/${warehouseByCustomer[0].id}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acknowledgedByCode: 'WH-001',
          acknowledgedBy: 'Warehouse API Rewriter',
          handlingMode: 'NONE',
          handlingQuantity: 0,
          remark: 'Repeat acknowledgement should not rewrite warehouse notice history'
        })
      }),
    '不能重复确认'
  );
  const repeatedAcknowledgedWarehouse = noticeListItems(
    await requestJson(
      `/warehouse/notices${query({
        status: 'ACKNOWLEDGED',
        keyword: warehousePartCode
      })}`
    ),
    'warehouse acknowledged history after repeat attempt'
  );
  assertNoticeListContainsOnly(repeatedAcknowledgedWarehouse, warehouseNoticeNo, 'warehouse acknowledged history after repeat attempt');
  assert(
    !String(repeatedAcknowledgedWarehouse[0].acknowledgedBy || '').includes('Warehouse API Rewriter'),
    'repeat warehouse acknowledgement must not overwrite acknowledgedBy'
  );

  const adminAllByKeyword = noticeListItems(
    await requestJson(
      `/production/tasks/notices/admin${query({
        keyword: runId,
        customerId: customer.id,
        dateFrom: today,
        dateTo: today
      })}`
    ),
    'admin notice center keyword/customer/date filter'
  );
  assert(adminAllByKeyword.some((notice) => notice.noticeNo === productionNoticeNo), 'admin notice center must include production notice');
  assert(adminAllByKeyword.some((notice) => notice.noticeNo === warehouseNoticeNo), 'admin notice center must include warehouse notice');
  assert(
    adminAllByKeyword.every((notice) => [productionNoticeNo, warehouseNoticeNo].includes(notice.noticeNo)),
    `admin notice center must not include unrelated notices: ${adminAllByKeyword.map((notice) => notice.noticeNo).join(', ')}`
  );

  const adminWarehouseByTarget = noticeListItems(
    await requestJson(
      `/production/tasks/notices/admin${query({
        target: 'WAREHOUSE',
        keyword: warehousePartCode
      })}`
    ),
    'admin notice target filter'
  );
  assertNoticeListContainsOnly(adminWarehouseByTarget, warehouseNoticeNo, 'admin notice target filter');

  console.log('Production and warehouse notice API filter verification passed.');
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
