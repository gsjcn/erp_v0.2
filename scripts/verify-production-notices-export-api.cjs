#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.PRODUCTION_NOTICES_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertNoticeExport(path, expectedFileName, expectedSheetName, expectedTitle, expectedScopeTexts) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `通知导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes(expectedFileName), `通知导出缺少固定响应文件名 ${expectedFileName}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '通知导出必须是 .xlsx zip 文件');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet(expectedSheetName);
  assert(sheet, `通知导出缺少 ${expectedSheetName} 工作表：${workbook.worksheets.map((worksheet) => worksheet.name).join(', ')}`);
  assert(sheet.getCell('A1').text === expectedTitle, `通知导出标题不正确：${sheet.getCell('A1').text}`);
  for (const expectedScopeText of expectedScopeTexts) {
    assert(sheet.getCell('A2').text.includes(expectedScopeText), `通知导出范围说明缺少 ${expectedScopeText}`);
  }

  const headers = sheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of [
    '序号',
    '通知号',
    '归类',
    '状态',
    '通知类型',
    '订单号',
    '客户',
    '生产任务',
    '零件编码',
    '原因',
    '确认人',
    '通知时间'
  ]) {
    assert(headers.includes(header), `通知导出缺少表头 ${header}`);
  }

  return { byteLength: buffer.length, sheetName: sheet.name, rowCount: sheet.rowCount };
}

async function main() {
  const productionListResponse = await fetch(`${apiBaseUrl}/production/tasks/notices?target=PRODUCTION&limit=1&offset=0`);
  if (!productionListResponse.ok) {
    throw new Error(`${productionListResponse.status} ${productionListResponse.statusText}: ${await productionListResponse.text()}`);
  }
  const productionListPayload = await productionListResponse.json();
  assert(!Array.isArray(productionListPayload), 'production notices public list must return explicit pagination object, not full-list array');
  assert(Array.isArray(productionListPayload.items), 'production notices pagination response must include items array');
  assert(Number.isInteger(productionListPayload.totalCount), 'production notices pagination response must include totalCount');
  assert(productionListPayload.limit === 1, `production notices pagination response limit must be 1, actual ${productionListPayload.limit}`);
  assert(productionListPayload.offset === 0, `production notices pagination response offset must be 0, actual ${productionListPayload.offset}`);
  assert(typeof productionListPayload.hasMore === 'boolean', 'production notices pagination response must include hasMore');

  const adminListResponse = await fetch(`${apiBaseUrl}/production/tasks/notices/admin?limit=1&offset=0`);
  if (!adminListResponse.ok) {
    throw new Error(`${adminListResponse.status} ${adminListResponse.statusText}: ${await adminListResponse.text()}`);
  }
  const adminListPayload = await adminListResponse.json();
  assert(!Array.isArray(adminListPayload), '管理员通知公开列表必须返回显式分页对象，不能返回全量数组');
  assert(Array.isArray(adminListPayload.items), '管理员通知分页响应必须包含 items 数组');
  assert(Number.isInteger(adminListPayload.totalCount), '管理员通知分页响应必须包含 totalCount');
  assert(adminListPayload.limit === 1, `管理员通知分页响应 limit 应为 1，实际 ${adminListPayload.limit}`);
  assert(adminListPayload.offset === 0, `管理员通知分页响应 offset 应为 0，实际 ${adminListPayload.offset}`);
  assert(typeof adminListPayload.hasMore === 'boolean', '管理员通知分页响应必须包含 hasMore');
  const productionExport = await assertNoticeExport(
    '/production/tasks/notices/export?status=PENDING&orderNo=NO_MATCH_FOR_EXPORT&partCode=NO_PART&dateFrom=2026-01-01&dateTo=2026-12-31',
    'production-notices-export.xlsx',
    '生产通知',
    '生产通知历史导出',
    ['归类：生产通知', '状态：待确认', '订单：NO_MATCH_FOR_EXPORT', '零件：NO_PART', '通知时间：2026-01-01 至 2026-12-31']
  );
  const adminExport = await assertNoticeExport(
    '/production/tasks/notices/admin/export?target=WAREHOUSE&status=ACKNOWLEDGED&keyword=NO_MATCH_NOTICE&dateFrom=2026-01-01&dateTo=2026-12-31',
    'admin-notices-export.xlsx',
    '管理员通知',
    '管理员通知历史导出',
    ['归类：仓库通知', '状态：已确认', '关键词：NO_MATCH_NOTICE', '通知时间：2026-01-01 至 2026-12-31']
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'production-notices-public-list-pagination',
          'admin-production-notices-public-list-pagination',
          'production-notices-export-xlsx',
          'admin-notices-export-xlsx',
          'notice-export-scope',
          'notice-export-columns'
        ],
        productionExport,
        adminExport
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
