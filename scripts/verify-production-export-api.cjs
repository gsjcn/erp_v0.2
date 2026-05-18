#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.PRODUCTION_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertProductionExport(path, expectedTitle, expectedHeaders, expectedScopeText) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `${expectedTitle} content-type 必须是真实 xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('production-export.xlsx'), `${expectedTitle} 缺少导出文件名响应头`);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', `${expectedTitle} 必须是 xlsx zip 文件`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert(workbook.worksheets.length === 1, `${expectedTitle} 必须只导出一个工作表`);
  const worksheet = workbook.worksheets[0];
  assert(worksheet.getCell('A1').text === expectedTitle, `${expectedTitle} 标题不正确`);
  assert(worksheet.getCell('A2').text.includes(expectedScopeText), `${expectedTitle} 范围说明缺少 ${expectedScopeText}`);

  const headerValues = worksheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of expectedHeaders) {
    assert(headerValues.includes(header), `${expectedTitle} 缺少表头 ${header}`);
  }
}

async function assertPaginatedList(path, expectedLabel) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${expectedLabel} ${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const body = await response.json();
  assert(!Array.isArray(body), `${expectedLabel} must return an explicit page object, not a bare array`);
  assert(Array.isArray(body.items), `${expectedLabel} must return items[]`);
  assert(body.limit === 1, `${expectedLabel} must echo limit=1`);
  assert(body.offset === 0, `${expectedLabel} must echo offset=0`);
  assert(Number.isInteger(body.totalCount), `${expectedLabel} must return totalCount`);
  assert(typeof body.hasMore === 'boolean', `${expectedLabel} must return hasMore`);
}

async function main() {
  await assertPaginatedList('/production/tasks?limit=1&offset=0', 'production tasks public list');
  await assertPaginatedList('/production/tasks/order-summary?limit=1&offset=0', 'production order summary public list');
  await assertPaginatedList(
    '/production/tasks?displayStatus=READY_TO_COMPLETE&limit=1&offset=0',
    'production tasks display status public list'
  );
  await assertPaginatedList(
    '/production/tasks/order-summary?displayStatus=ACTIVE&limit=1&offset=0',
    'production order summary display status public list'
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
  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'production-tasks-public-list-pagination',
          'production-order-summary-public-list-pagination',
          'production-tasks-display-status-pagination',
          'production-order-summary-display-status-pagination',
          'production-order-summary-export',
          'production-task-detail-export'
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
