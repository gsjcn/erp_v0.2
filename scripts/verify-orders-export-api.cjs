#!/usr/bin/env node

const ExcelJS = require('exceljs');
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
  process.env.ORDERS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const prisma = new PrismaClient();
const orderFixturePrefix = 'COD-ORDERS-STABLE';
const orderFixtureNo = `${orderFixturePrefix}-ORDER`;
const orderFixturePartCode = `${orderFixturePrefix}-PART`;
const orderFixtureCustomerCode = `${orderFixturePrefix}-CUST`;
const orderFixtureCustomerName = `${orderFixturePrefix} 客户`;
const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function businessDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BUSINESS_TIME_ZONE || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';
  return {
    year: Number(year),
    dateText: `${year}-${month}-${day}`
  };
}

function hasTestFixtureText(value) {
  const text = String(value || '');
  return testFixturePrefixes.some((prefix) => text.includes(prefix));
}

function workbookHasFixturePrefix(workbook) {
  let matched = false;
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (hasTestFixtureText(cell.text || cell.value)) {
          matched = true;
        }
      });
    });
  });
  return matched;
}

async function requestJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

async function seedOrderFixture(currentBusinessDate) {
  const orderDate = new Date(`${currentBusinessDate.dateText}T00:00:00.000Z`);
  const customer = await prisma.customer.upsert({
    where: { customerCode: orderFixtureCustomerCode },
    update: {
      customerName: orderFixtureCustomerName,
      contactName: '订单验证',
      contactPhone: '13800000000',
      regionType: 'CHINA',
      province: '江苏省',
      city: '常州市',
      detailAddress: 'orders fixture',
      status: 'ENABLED'
    },
    create: {
      customerCode: orderFixtureCustomerCode,
      customerName: orderFixtureCustomerName,
      contactName: '订单验证',
      contactPhone: '13800000000',
      regionType: 'CHINA',
      province: '江苏省',
      city: '常州市',
      detailAddress: 'orders fixture',
      status: 'ENABLED'
    }
  });
  const order = await prisma.customerOrder.upsert({
    where: { orderNo: orderFixtureNo },
    update: {
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      customerSnapshot: {
        customerCode: customer.customerCode,
        customerName: customer.customerName
      },
      orderDate,
      deliveryDate: orderDate,
      status: 'DRAFT'
    },
    create: {
      orderNo: orderFixtureNo,
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      customerSnapshot: {
        customerCode: customer.customerCode,
        customerName: customer.customerName
      },
      orderDate,
      deliveryDate: orderDate,
      status: 'DRAFT'
    }
  });
  await prisma.orderLine.upsert({
    where: { orderId_lineNo: { orderId: order.id, lineNo: 1 } },
    update: {
      partCode: orderFixturePartCode,
      partName: `${orderFixturePrefix} 零件`,
      partThickness: 1,
      quantity: 3,
      productionPlanQuantity: 3,
      unit: '件',
      projectModel: `${orderFixturePrefix}-MODEL`
    },
    create: {
      orderId: order.id,
      lineNo: 1,
      partCode: orderFixturePartCode,
      partName: `${orderFixturePrefix} 零件`,
      partThickness: 1,
      quantity: 3,
      productionPlanQuantity: 3,
      unit: '件',
      projectModel: `${orderFixturePrefix}-MODEL`
    }
  });
}

async function loadWorkbookFromResponse(response, label, expectedFileName) {
  if (!response.ok) {
    throw new Error(`${label} ${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `${label} content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes(expectedFileName), `${label} 缺少固定响应文件名`);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', `${label} 必须是 .xlsx zip 文件`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return { workbook, buffer };
}

async function main() {
  const currentBusinessDate = businessDateParts();
  await seedOrderFixture(currentBusinessDate);

  const orders = await requestJson('/orders');
  assert(Array.isArray(orders), '订单列表默认响应必须是数组');
  assert(!hasTestFixtureText(JSON.stringify(orders)), 'orders default list must hide reusable test fixture orders');
  const ordersWithFixtures = await requestJson('/orders?includeTestFixtures=true');
  assert(
    Array.isArray(ordersWithFixtures) && ordersWithFixtures.some((order) => order.orderNo === orderFixtureNo),
    'orders includeTestFixtures=true must expose reusable test fixture orders for regressions'
  );

  const exportUrl = `${apiBaseUrl}/orders/export?dateFrom=2026-01-01&dateTo=2026-12-31&orderNo=NO_MATCH_ORDER_EXPORT`;
  const { workbook, buffer } = await loadWorkbookFromResponse(await fetch(exportUrl), '订单列表导出', 'orders-export.xlsx');
  const listSheet = workbook.getWorksheet('订单列表');
  const lineSheet = workbook.getWorksheet('订单明细');
  assert(listSheet, '订单导出缺少 订单列表 工作表');
  assert(lineSheet, '订单导出缺少 订单明细 工作表');
  assert(listSheet.getCell('A1').text === '订单筛选结果导出', '订单列表标题不正确');
  assert(lineSheet.getCell('A1').text === '订单明细快照导出', '订单明细标题不正确');
  assert(listSheet.getCell('A2').text.includes('订单号：NO_MATCH_ORDER_EXPORT'), '订单列表范围说明缺少订单号');
  assert(listSheet.getCell('A2').text.includes('订单日期：2026-01-01 至 2026-12-31'), '订单列表范围说明缺少订单日期');

  const listHeaders = listSheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '订单号', '客户ID', '客户名称', '订单状态', '生产状态', '客户订单数量', '生产计划数量']) {
    assert(listHeaders.includes(header), `订单列表导出缺少表头 ${header}`);
  }

  const lineHeaders = lineSheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['行号', '行类型', '组件编号', '所属组件', '零件编码', '图号', '图纸日期', '履约方式', '工艺路线']) {
    assert(lineHeaders.includes(header), `订单明细导出缺少表头 ${header}`);
  }

  const fixtureFilterExportResponse = await fetch(
    `${apiBaseUrl}/orders/export?dateFrom=${currentBusinessDate.year}-01-01&dateTo=${currentBusinessDate.year}-12-31`
  );
  const fixtureFilterExport = await loadWorkbookFromResponse(fixtureFilterExportResponse, '订单列表默认导出', 'orders-export.xlsx');
  assert(!workbookHasFixturePrefix(fixtureFilterExport.workbook), 'orders default export must hide reusable test fixture orders');

  const checked = [
    'orders-list-test-fixture-filter',
    'orders-export-test-fixture-filter',
    'orders-export-xlsx',
    'orders-export-scope',
    'orders-export-list-columns',
    'orders-export-line-columns'
  ];
  let detailExport = { checked: false, rowCount: 0, byteLength: 0 };
  const firstOrder = Array.isArray(orders) ? orders.find((order) => order?.orderNo) : undefined;
  if (firstOrder) {
    const detailResponse = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(firstOrder.orderNo)}/export`);
    const detail = await loadWorkbookFromResponse(detailResponse, '订单详情导出', 'order-detail-export.xlsx');
    const overviewSheet = detail.workbook.getWorksheet('订单概览');
    const detailLineSheet = detail.workbook.getWorksheet('订单零件');
    const taskSheet = detail.workbook.getWorksheet('生产任务');
    assert(overviewSheet, '订单详情导出缺少 订单概览 工作表');
    assert(detailLineSheet, '订单详情导出缺少 订单零件 工作表');
    assert(taskSheet, '订单详情导出缺少 生产任务 工作表');
    assert(overviewSheet.getCell('A1').text.includes(firstOrder.orderNo), '订单详情导出标题缺少订单号');

    const detailHeaders = detailLineSheet
      .getRow(4)
      .values
      .filter((value) => value !== undefined)
      .map((value) => String(value));
    for (const header of ['行号', '零件编码', '零件名称', '库存来源', '工艺路线', '生产任务', '来源 Excel']) {
      assert(detailHeaders.includes(header), `订单详情零件导出缺少表头 ${header}`);
    }
    const taskHeaders = taskSheet
      .getRow(4)
      .values
      .filter((value) => value !== undefined)
      .map((value) => String(value));
    for (const header of ['生产任务号', '订单行号', '任务类型', '计划数量', '完成数量', '状态']) {
      assert(taskHeaders.includes(header), `订单详情生产任务导出缺少表头 ${header}`);
    }
    checked.push('order-detail-export-xlsx', 'order-detail-export-sheets', 'order-detail-export-columns');
    detailExport = {
      checked: true,
      orderNo: firstOrder.orderNo,
      rowCount: detailLineSheet.rowCount,
      byteLength: detail.buffer.length
    };
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked,
        byteLength: buffer.length,
        listRowCount: listSheet.rowCount,
        lineRowCount: lineSheet.rowCount,
        detailExport
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
