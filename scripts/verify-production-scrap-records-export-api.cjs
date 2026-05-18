#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.PRODUCTION_SCRAP_RECORDS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertScrapRecordsExport(path, expectedScopeTexts) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `生产报废统计导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('production-scrap-records-export.xlsx'), '生产报废统计导出缺少固定响应文件名');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '生产报废统计导出必须是 .xlsx zip 文件');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('生产报废记录');
  assert(sheet, `生产报废统计导出缺少 生产报废记录 工作表：${workbook.worksheets.map((worksheet) => worksheet.name).join(', ')}`);
  assert(sheet.getCell('A1').text === '生产报废统计导出', '生产报废统计导出标题不正确');
  for (const expectedScopeText of expectedScopeTexts) {
    assert(sheet.getCell('A2').text.includes(expectedScopeText), `生产报废统计导出范围说明缺少 ${expectedScopeText}`);
  }

  const headers = sheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of [
    '序号',
    '报废记录号',
    '订单号',
    '生产任务',
    '零件编码',
    '零件名称',
    '报废数量',
    '单位',
    '报废原因',
    '报废日期',
    '来源类型',
    '来源记录',
    '创建时间'
  ]) {
    assert(headers.includes(header), `生产报废统计导出缺少表头 ${header}`);
  }

  return { byteLength: buffer.length, sheetName: sheet.name, rowCount: sheet.rowCount };
}

async function main() {
  const listResponse = await fetch(`${apiBaseUrl}/production/tasks/scrap-records?limit=1&offset=0`);
  if (!listResponse.ok) {
    throw new Error(`${listResponse.status} ${listResponse.statusText}: ${await listResponse.text()}`);
  }
  const listPayload = await listResponse.json();
  assert(!Array.isArray(listPayload), 'production scrap records public list must return explicit pagination object, not full-list array');
  assert(Array.isArray(listPayload.items), 'production scrap records pagination response must include items array');
  assert(Number.isInteger(listPayload.totalCount), 'production scrap records pagination response must include totalCount');
  assert(listPayload.limit === 1, `production scrap records pagination response limit must be 1, actual ${listPayload.limit}`);
  assert(listPayload.offset === 0, `production scrap records pagination response offset must be 0, actual ${listPayload.offset}`);
  assert(typeof listPayload.hasMore === 'boolean', 'production scrap records pagination response must include hasMore');

  const exportInfo = await assertScrapRecordsExport(
    '/production/tasks/scrap-records/export?orderNo=NO_MATCH_FOR_EXPORT&dateFrom=2026-01-01&dateTo=2026-12-31',
    ['客户：全部客户', '订单：NO_MATCH_FOR_EXPORT', '报废日期：2026-01-01 至 2026-12-31']
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'production-scrap-records-public-list-pagination',
          'production-scrap-records-export-xlsx',
          'production-scrap-records-export-scope',
          'production-scrap-records-export-columns'
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
