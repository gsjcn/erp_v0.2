#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.WAREHOUSE_TRANSACTION_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertWarehouseTransactionsExport(path, expectedScopeTexts) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }

  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `库存流水导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('warehouse-transactions-export.xlsx'), '库存流水导出缺少固定响应文件名');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '库存流水导出必须是 .xlsx zip 文件');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert(workbook.worksheets.length === 1, '库存流水导出必须只导出一个工作表');
  const worksheet = workbook.worksheets[0];
  assert(worksheet.name === '库存流水', `库存流水导出工作表名不正确：${worksheet.name}`);
  assert(worksheet.getCell('A1').text === '库存流水导出', '库存流水导出标题不正确');
  for (const expectedScopeText of expectedScopeTexts) {
    assert(worksheet.getCell('A2').text.includes(expectedScopeText), `库存流水导出范围说明缺少 ${expectedScopeText}`);
  }

  const headerValues = worksheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '流水号', '类型', '流水时间', '零件编码', '图号', '批次号', '来源订单', '生产任务', '仓库', '库位', '备注']) {
    assert(headerValues.includes(header), `库存流水导出缺少表头 ${header}`);
  }

  return { byteLength: buffer.length, rowCount: worksheet.rowCount };
}

async function main() {
  const listResponse = await fetch(`${apiBaseUrl}/warehouse/transactions?limit=1&offset=0`);
  if (!listResponse.ok) {
    throw new Error(`${listResponse.status} ${listResponse.statusText}: ${await listResponse.text()}`);
  }
  const listPayload = await listResponse.json();
  assert(!Array.isArray(listPayload), 'warehouse transactions public list must return explicit pagination object, not full-list array');
  assert(Array.isArray(listPayload.items), 'warehouse transactions pagination response must include items array');
  assert(Number.isInteger(listPayload.totalCount), 'warehouse transactions pagination response must include totalCount');
  assert(listPayload.limit === 1, `warehouse transactions pagination response limit must be 1, actual ${listPayload.limit}`);
  assert(listPayload.offset === 0, `warehouse transactions pagination response offset must be 0, actual ${listPayload.offset}`);
  assert(typeof listPayload.hasMore === 'boolean', 'warehouse transactions pagination response must include hasMore');

  const exportInfo = await assertWarehouseTransactionsExport(
    '/warehouse/transactions/export?transactionType=IN&orderNo=NO_MATCH_FOR_EXPORT&dateFrom=2026-01-01&dateTo=2026-12-31',
    ['流水类型：入库', '订单：NO_MATCH_FOR_EXPORT', '订单日期：2026-01-01 至 2026-12-31']
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'warehouse-transactions-public-list-pagination',
          'warehouse-transactions-export-xlsx',
          'warehouse-transactions-export-scope',
          'warehouse-transactions-export-columns'
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
