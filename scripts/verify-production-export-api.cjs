#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.PRODUCTION_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];
const checked = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasTestFixtureText(value) {
  const text = String(value || '');
  return testFixturePrefixes.some((prefix) => text.includes(prefix));
}

function currentBusinessDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BUSINESS_TIME_ZONE || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value || '0');
  const month = Number(parts.find((part) => part.type === 'month')?.value || '0');
  return {
    year,
    month,
    quarter: Math.floor((month - 1) / 3) + 1
  };
}

async function requestJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  return response.json();
}

async function assertProductionExport(path, expectedTitle, expectedHeaders, expectedScopeText) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `${expectedTitle} content-type must be real .xlsx, actual=${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('production-export.xlsx'), `${expectedTitle} must use production-export.xlsx filename`);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', `${expectedTitle} must return a .xlsx zip payload`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert(workbook.worksheets.length === 1, `${expectedTitle} must export exactly one worksheet`);
  assert(!hasTestFixtureText(JSON.stringify(workbook.model || {})), `${expectedTitle} must hide reusable test fixture rows`);

  const worksheet = workbook.worksheets[0];
  assert(worksheet.getCell('A1').text === expectedTitle, `${expectedTitle} title is incorrect`);
  assert(worksheet.getCell('A2').text.includes(expectedScopeText), `${expectedTitle} scope must include ${expectedScopeText}`);

  const headerValues = worksheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of expectedHeaders) {
    assert(headerValues.includes(header), `${expectedTitle} must include header ${header}`);
  }
  checked.push({
    label: expectedTitle,
    path,
    rowCount: worksheet.rowCount,
    byteLength: buffer.length
  });
}

async function assertPaginatedList(path, expectedLabel) {
  const body = await requestJson(path);
  assert(body && typeof body === 'object' && !Array.isArray(body), `${expectedLabel} must return an explicit page object, not a bare array`);
  assert(Array.isArray(body.items), `${expectedLabel} must return items[]`);
  assert(body.limit === 1, `${expectedLabel} must echo limit=1`);
  assert(body.offset === 0, `${expectedLabel} must echo offset=0`);
  assert(Number.isInteger(body.totalCount), `${expectedLabel} must return totalCount`);
  assert(typeof body.hasMore === 'boolean', `${expectedLabel} must return hasMore`);
  assert(!hasTestFixtureText(JSON.stringify(body)), `${expectedLabel} must hide reusable test fixture rows`);
  checked.push({ label: expectedLabel, path, totalCount: body.totalCount, itemCount: body.items.length });
}

async function assertBusinessProductionTasksNotHiddenByNullableFixtureFilter() {
  const includeRows = await requestJson('/production/tasks?limit=100&offset=0&includeTestFixtures=true');
  const candidate = includeRows.items?.find(
    (row) => String(row.productionTaskNo || '').startsWith('PT-SO-') && String(row.orderNo || '').startsWith('SO-')
  );
  if (!candidate) {
    return;
  }

  const defaultRows = await requestJson('/production/tasks?limit=100&offset=0');
  assert(
    defaultRows.items?.some((row) => row.productionTaskNo === candidate.productionTaskNo),
    'production task nullable fixture filter must not hide normal SO business tasks by default'
  );
  checked.push({
    label: 'production-task-nullable-fixture-filter-business-visibility',
    productionTaskNo: candidate.productionTaskNo
  });
}

async function assertAnnualSummaryReadOnly(currentBusinessDate) {
  const rows = await requestJson(`/production/tasks/annual-summary?year=${currentBusinessDate.year}`);
  assert(Array.isArray(rows), 'production annual summary default response must be an array');
  assert(!hasTestFixtureText(JSON.stringify(rows)), 'production annual summary default response must hide reusable test fixture rows');
  assert(rows.length > 0, 'production annual summary default response must show business rows');
  const row = rows[0];
  for (const field of ['partCode', 'partName', 'unit']) {
    assert(String(row[field] || '').trim(), `production annual summary row must include ${field}`);
  }
  for (const field of ['customerOrderQuantity', 'productionPlanQuantity', 'completedProductionQuantity', 'shippedOrderQuantity', 'stockQuantity']) {
    assert(Number(row[field] || 0) >= 0, `production annual summary row ${field} must be non-negative`);
  }

  const fixtureRows = await requestJson(`/production/tasks/annual-summary?year=${currentBusinessDate.year}&includeTestFixtures=true`);
  assert(Array.isArray(fixtureRows), 'production annual summary includeTestFixtures response must be an array');
  assert(fixtureRows.length >= rows.length, 'production annual summary includeTestFixtures=true must not reduce normal business rows');
  checked.push({
    label: 'production-annual-summary-read-only',
    year: currentBusinessDate.year,
    totalRows: rows.length
  });
}

async function main() {
  const currentBusinessDate = currentBusinessDateParts();
  await assertPaginatedList('/production/tasks?limit=1&offset=0', 'production-tasks-public-list-pagination');
  await assertPaginatedList('/production/tasks/order-summary?limit=1&offset=0', 'production-order-summary-public-list-pagination');
  await assertPaginatedList(
    '/production/tasks?displayStatus=READY_TO_COMPLETE&limit=1&offset=0',
    'production-tasks-display-status-pagination'
  );
  await assertPaginatedList(
    '/production/tasks/order-summary?displayStatus=ACTIVE&limit=1&offset=0',
    'production-order-summary-display-status-pagination'
  );
  await assertProductionExport(
    '/production/tasks/export?viewMode=ORDER_SUMMARY&displayStatus=ACTIVE',
    '生产订单汇总表',
    ['序号', '订单号', '客户', '生产数量', '订单状态'],
    '状态：待处理'
  );
  await assertProductionExport(
    '/production/tasks/export?viewMode=TASK_DETAIL&displayStatus=ALL',
    '生产计划表',
    ['序号', '任务号', '订单号', '完成/生产计划', '状态'],
    '状态：全部'
  );
  await assertBusinessProductionTasksNotHiddenByNullableFixtureFilter();
  await assertAnnualSummaryReadOnly(currentBusinessDate);
  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'production-export-read-only',
          'production-tasks-public-list-pagination',
          'production-order-summary-public-list-pagination',
          'production-tasks-display-status-pagination',
          'production-order-summary-display-status-pagination',
          'production-order-summary-export',
          'production-task-detail-export',
          'production-task-nullable-fixture-filter-business-visibility',
          'production-annual-summary-read-only',
          ...checked.map((item) => item.label)
        ]
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
