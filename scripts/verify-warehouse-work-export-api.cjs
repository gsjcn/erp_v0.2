#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.WAREHOUSE_WORK_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertWarehouseWorkExport(path, expectedScopeTexts) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `仓库待处理导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('warehouse-work-export.xlsx'), '仓库待处理导出缺少固定响应文件名');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '仓库待处理导出必须是 .xlsx zip 文件');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  assert(sheetNames.includes('待入库'), `仓库待处理导出缺少 待入库 工作表：${sheetNames.join(', ')}`);
  assert(sheetNames.includes('待发货库存'), `仓库待处理导出缺少 待发货库存 工作表：${sheetNames.join(', ')}`);

  const receiptSheet = workbook.getWorksheet('待入库');
  const shipmentSheet = workbook.getWorksheet('待发货库存');
  assert(receiptSheet.getCell('A1').text === '仓库待入库导出', '仓库待入库导出标题不正确');
  assert(shipmentSheet.getCell('A1').text === '仓库待发货导出', '仓库待发货导出标题不正确');
  for (const expectedScopeText of expectedScopeTexts) {
    assert(receiptSheet.getCell('A2').text.includes(expectedScopeText), `仓库待入库范围说明缺少 ${expectedScopeText}`);
    assert(shipmentSheet.getCell('A2').text.includes(expectedScopeText), `仓库待发货范围说明缺少 ${expectedScopeText}`);
  }

  const receiptHeaders = receiptSheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '完成任务号', '订单号', '客户', '零件编码', '本次入订单库存', '本次转备货', '完成数量', '状态']) {
    assert(receiptHeaders.includes(header), `仓库待入库导出缺少表头 ${header}`);
  }

  const shipmentHeaders = shipmentSheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '批次号', '订单号', '客户', '零件编码', '账面库存', '建议发货', '剩余未发', '仓库', '库位', '状态']) {
    assert(shipmentHeaders.includes(header), `仓库待发货导出缺少表头 ${header}`);
  }

  return { byteLength: buffer.length, sheetNames, receiptRowCount: receiptSheet.rowCount, shipmentRowCount: shipmentSheet.rowCount };
}

async function main() {
  const exportInfo = await assertWarehouseWorkExport(
    '/warehouse/work/export?orderNo=NO_MATCH_FOR_EXPORT&dateFrom=2026-01-01&dateTo=2026-12-31',
    ['订单：NO_MATCH_FOR_EXPORT', '订单日期：2026-01-01 至 2026-12-31']
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: ['warehouse-work-export-xlsx', 'warehouse-work-export-receipt-sheet', 'warehouse-work-export-shipment-sheet'],
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
