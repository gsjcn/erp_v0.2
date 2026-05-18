#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.WAREHOUSE_NOTICES_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertWarehouseNoticesExport(path, expectedScopeTexts) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `仓库通知导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('warehouse-notices-export.xlsx'), '仓库通知导出缺少固定响应文件名');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '仓库通知导出必须是 .xlsx zip 文件');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('仓库通知');
  assert(sheet, `仓库通知导出缺少 仓库通知 工作表：${workbook.worksheets.map((worksheet) => worksheet.name).join(', ')}`);
  assert(sheet.getCell('A1').text === '仓库通知历史导出', '仓库通知导出标题不正确');
  for (const expectedScopeText of expectedScopeTexts) {
    assert(sheet.getCell('A2').text.includes(expectedScopeText), `仓库通知导出范围说明缺少 ${expectedScopeText}`);
  }

  const headers = sheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of [
    '序号',
    '通知号',
    '状态',
    '通知类型',
    '订单号',
    '客户',
    '生产任务',
    '零件编码',
    '处理建议',
    '确认人',
    '通知时间'
  ]) {
    assert(headers.includes(header), `仓库通知导出缺少表头 ${header}`);
  }

  return { byteLength: buffer.length, sheetName: sheet.name, rowCount: sheet.rowCount };
}

async function main() {
  const listResponse = await fetch(`${apiBaseUrl}/warehouse/notices?limit=1&offset=0`);
  if (!listResponse.ok) {
    throw new Error(`${listResponse.status} ${listResponse.statusText}: ${await listResponse.text()}`);
  }
  const listPayload = await listResponse.json();
  assert(!Array.isArray(listPayload), '仓库通知公开列表必须返回显式分页对象，不能返回全量数组');
  assert(Array.isArray(listPayload.items), '仓库通知分页响应必须包含 items 数组');
  assert(Number.isInteger(listPayload.totalCount), '仓库通知分页响应必须包含 totalCount');
  assert(listPayload.limit === 1, `仓库通知分页响应 limit 应为 1，实际 ${listPayload.limit}`);
  assert(listPayload.offset === 0, `仓库通知分页响应 offset 应为 0，实际 ${listPayload.offset}`);
  assert(typeof listPayload.hasMore === 'boolean', '仓库通知分页响应必须包含 hasMore');
  const exportInfo = await assertWarehouseNoticesExport(
    '/warehouse/notices/export?status=PENDING&orderNo=NO_MATCH_FOR_EXPORT&partCode=NO_PART&dateFrom=2026-01-01&dateTo=2026-12-31',
    ['状态：待处理', '订单：NO_MATCH_FOR_EXPORT', '零件：NO_PART', '通知时间：2026-01-01 至 2026-12-31']
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'warehouse-notices-public-list-pagination',
          'warehouse-notices-export-xlsx',
          'warehouse-notices-export-scope',
          'warehouse-notices-export-columns'
        ],
        ...exportInfo
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
