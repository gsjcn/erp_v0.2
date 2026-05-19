#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.ORDERS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

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
    throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  return response.json();
}

async function loadWorkbookFromResponse(response, label, expectedFileName) {
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `${label} content-type must be real .xlsx, actual=${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes(expectedFileName), `${label} must use ${expectedFileName} filename`);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', `${label} must return a .xlsx zip payload`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return { workbook, buffer };
}

function rowValues(row) {
  return row.values.filter((value) => value !== undefined).map((value) => String(value));
}

function assertHeaders(sheet, headers, label) {
  const actualHeaders = rowValues(sheet.getRow(4));
  for (const header of headers) {
    assert(actualHeaders.includes(header), `${label} must include header ${header}`);
  }
}

async function main() {
  const currentBusinessDate = businessDateParts();
  const orders = await requestJson('/orders');
  assert(Array.isArray(orders), 'orders default list response must be an array.');
  assert(!hasTestFixtureText(JSON.stringify(orders)), 'orders default list must hide reusable test fixture orders');
  assert(orders.length > 0, 'orders default list must show business orders for export regression.');

  const ordersWithFixtures = await requestJson('/orders?includeTestFixtures=true');
  assert(
    Array.isArray(ordersWithFixtures) && ordersWithFixtures.length >= orders.length,
    'orders includeTestFixtures=true must not reduce normal order list results'
  );

  const exportUrl = `${apiBaseUrl}/orders/export?dateFrom=2026-01-01&dateTo=2026-12-31&orderNo=NO_MATCH_ORDER_EXPORT`;
  const { workbook, buffer } = await loadWorkbookFromResponse(await fetch(exportUrl), 'orders export', 'orders-export.xlsx');
  const listSheet = workbook.getWorksheet('订单列表');
  const lineSheet = workbook.getWorksheet('订单明细');
  assert(listSheet, 'orders export must include 订单列表 worksheet');
  assert(lineSheet, 'orders export must include 订单明细 worksheet');
  assert(listSheet.getCell('A1').text === '订单筛选结果导出', 'orders export list title is incorrect');
  assert(lineSheet.getCell('A1').text === '订单明细快照导出', 'orders export line title is incorrect');
  assert(listSheet.getCell('A2').text.includes('订单号：NO_MATCH_ORDER_EXPORT'), 'orders export scope must include orderNo');
  assert(listSheet.getCell('A2').text.includes('订单日期：2026-01-01 至 2026-12-31'), 'orders export scope must include order date range');

  assertHeaders(
    listSheet,
    ['序号', '订单号', '客户ID', '客户名称', '订单状态', '生产状态', '客户订单数量', '生产计划数量'],
    'orders export list sheet'
  );
  assertHeaders(
    lineSheet,
    ['行号', '行类型', '组件编号', '所属组件', '零件编码', '图号', '图纸日期', '履约方式', '工艺路线'],
    'orders export line sheet'
  );

  const fixtureFilterExportResponse = await fetch(
    `${apiBaseUrl}/orders/export?dateFrom=${currentBusinessDate.year}-01-01&dateTo=${currentBusinessDate.year}-12-31`
  );
  const fixtureFilterExport = await loadWorkbookFromResponse(fixtureFilterExportResponse, 'orders default export', 'orders-export.xlsx');
  assert(!workbookHasFixturePrefix(fixtureFilterExport.workbook), 'orders default export must hide reusable test fixture orders');

  const checked = [
    'orders-export-read-only',
    'orders-list-test-fixture-filter',
    'orders-export-test-fixture-filter',
    'orders-export-xlsx',
    'orders-export-scope',
    'orders-export-list-columns',
    'orders-export-line-columns'
  ];
  let detailExport = { checked: false, rowCount: 0, byteLength: 0 };
  const firstOrder = orders.find((order) => order?.orderNo);
  if (firstOrder) {
    const detailResponse = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(firstOrder.orderNo)}/export`);
    const detail = await loadWorkbookFromResponse(detailResponse, 'order detail export', 'order-detail-export.xlsx');
    const overviewSheet = detail.workbook.getWorksheet('订单概览');
    const detailLineSheet = detail.workbook.getWorksheet('订单零件');
    const taskSheet = detail.workbook.getWorksheet('生产任务');
    assert(overviewSheet, 'order detail export must include 订单概览 worksheet');
    assert(detailLineSheet, 'order detail export must include 订单零件 worksheet');
    assert(taskSheet, 'order detail export must include 生产任务 worksheet');
    assert(overviewSheet.getCell('A1').text.includes(firstOrder.orderNo), 'order detail export title must include orderNo');

    assertHeaders(
      detailLineSheet,
      ['行号', '零件编码', '零件名称', '库存来源', '工艺路线', '生产任务', '来源 Excel'],
      'order detail line sheet'
    );
    assertHeaders(taskSheet, ['生产任务号', '订单行号', '任务类型', '计划数量', '完成数量', '状态'], 'order detail task sheet');
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
