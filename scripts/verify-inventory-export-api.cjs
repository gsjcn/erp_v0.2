#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.INVENTORY_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasFixtureText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return testFixturePrefixes.find((prefix) => text.includes(prefix));
}

function headerColumnMap(sheet, rowNumber = 4) {
  const columns = new Map();
  sheet.getRow(rowNumber).eachCell((cell, columnNumber) => {
    columns.set(String(cell.text || cell.value || '').trim(), columnNumber);
  });
  return columns;
}

function numericCell(row, columnNumber, label) {
  const rawValue = row.getCell(columnNumber).value;
  const value = typeof rawValue === 'number' ? rawValue : Number(String(row.getCell(columnNumber).text || rawValue || '0').replace(/,/g, ''));
  assert(Number.isFinite(value), `${label} must be numeric, actual=${row.getCell(columnNumber).text || rawValue || '-'}`);
  return value;
}

function workbookDataRowsHaveTestFixturePrefix(workbook) {
  let foundPrefix = '';
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 4 || foundPrefix) {
        return;
      }
      row.eachCell((cell) => {
        const prefix = hasFixtureText(cell.text || cell.value || '');
        if (prefix) {
          foundPrefix = prefix;
        }
      });
    });
  });
  return foundPrefix;
}

function assertSummaryQuantityRelationships(summarySheet) {
  const headerColumns = headerColumnMap(summarySheet);
  for (const header of ['零件编码', '订单库存', '备货库存', '正常备货', '取消转备货', '客户变更转备货', '可用数量']) {
    assert(headerColumns.has(header), `inventory summary export must include header ${header}`);
  }

  let checkedRows = 0;
  summarySheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 4) {
      return;
    }
    const partCode = row.getCell(headerColumns.get('零件编码')).text;
    if (!partCode) {
      return;
    }
    const orderInventoryQuantity = numericCell(row, headerColumns.get('订单库存'), `${partCode} order inventory`);
    const stockInventoryQuantity = numericCell(row, headerColumns.get('备货库存'), `${partCode} stock inventory`);
    const normalOrderStockQuantity = numericCell(row, headerColumns.get('正常备货'), `${partCode} normal stock`);
    const cancelledOrderStockQuantity = numericCell(row, headerColumns.get('取消转备货'), `${partCode} cancelled stock`);
    const customerChangeStockQuantity = numericCell(row, headerColumns.get('客户变更转备货'), `${partCode} customer-change stock`);
    const availableQuantity = numericCell(row, headerColumns.get('可用数量'), `${partCode} available quantity`);
    assert(
      stockInventoryQuantity === normalOrderStockQuantity + cancelledOrderStockQuantity + customerChangeStockQuantity,
      `inventory export source split must balance for ${partCode}`
    );
    assert(
      availableQuantity === orderInventoryQuantity + stockInventoryQuantity,
      `inventory export available quantity must equal order + stock inventory for ${partCode}`
    );
    checkedRows += 1;
  });
  assert(checkedRows > 0, 'inventory export quantity relationship regression needs at least one business summary row');
  return checkedRows;
}

async function assertInventoryExport(path, expectedScopeTexts, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `inventory export content-type must be real .xlsx, actual=${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('inventory-export.xlsx'), 'inventory export must use inventory-export.xlsx filename');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', 'inventory export must return a .xlsx zip payload');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  assert(sheetNames.includes('库存汇总'), `inventory export must include 库存汇总 sheet; actual=${sheetNames.join(', ')}`);
  assert(sheetNames.includes('库存批次'), `inventory export must include 库存批次 sheet; actual=${sheetNames.join(', ')}`);

  const summarySheet = workbook.getWorksheet('库存汇总');
  const batchSheet = workbook.getWorksheet('库存批次');
  assert(summarySheet.getCell('A1').text === '库存汇总导出', 'inventory summary export title is incorrect');
  assert(batchSheet.getCell('A1').text === '库存批次导出', 'inventory batch export title is incorrect');
  for (const expectedScopeText of expectedScopeTexts) {
    assert(summarySheet.getCell('A2').text.includes(expectedScopeText), `inventory summary scope must include ${expectedScopeText}`);
    assert(batchSheet.getCell('A2').text.includes(expectedScopeText), `inventory batch scope must include ${expectedScopeText}`);
  }

  const summaryHeaders = summarySheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of [
    '序号',
    '零件编码',
    '零件名称',
    '单位',
    '批次数',
    '仓库数',
    '账面数量',
    '预占数量',
    '可用数量',
    '已出库/已使用数量',
    '累计数量',
    '订单库存',
    '备货库存',
    '正常备货',
    '取消转备货',
    '客户变更转备货',
    '库存报警',
    '最小库存',
    '仓库分布'
  ]) {
    assert(summaryHeaders.includes(header), `inventory summary export must include header ${header}`);
  }

  const batchHeaders = batchSheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '批次号', '零件编码', '图号', '账面数量', '预占数量', '可用数量', '库存来源', '来源订单', '生产任务', '仓库', '库位', '状态']) {
    assert(batchHeaders.includes(header), `inventory batch export must include header ${header}`);
  }

  const checkedSummaryRows = options.checkQuantityRelationships ? assertSummaryQuantityRelationships(summarySheet) : 0;
  return {
    workbook,
    byteLength: buffer.length,
    sheetNames,
    summaryRowCount: summarySheet.rowCount,
    batchRowCount: batchSheet.rowCount,
    checkedSummaryRows
  };
}

async function main() {
  const emptyExportInfo = await assertInventoryExport(
    '/inventory/export?keyword=NO_MATCH_FOR_EXPORT&status=AVAILABLE&stockAlert=ALL',
    ['关键词：NO_MATCH_FOR_EXPORT', '状态：可用', '库存报警：全部']
  );
  assert(emptyExportInfo.summaryRowCount === 4, 'inventory no-match export should only include title, scope, blank row and header rows');
  assert(emptyExportInfo.batchRowCount === 4, 'inventory no-match batch export should only include title, scope, blank row and header rows');

  const defaultExportInfo = await assertInventoryExport('/inventory/export?status=AVAILABLE&stockAlert=ALL', ['关键词：全部', '状态：可用', '库存报警：全部'], {
    checkQuantityRelationships: true
  });
  const leakedPrefix = workbookDataRowsHaveTestFixturePrefix(defaultExportInfo.workbook);
  assert(!leakedPrefix, `inventory export default response must hide reusable test fixture inventory; leaked=${leakedPrefix}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'inventory-export-read-only',
          'inventory-export-xlsx',
          'inventory-export-summary-sheet',
          'inventory-export-batch-sheet',
          'inventory-export-source-balance-read-only',
          'inventory-export-test-fixture-filter'
        ],
        emptyExportInfo: {
          byteLength: emptyExportInfo.byteLength,
          summaryRowCount: emptyExportInfo.summaryRowCount,
          batchRowCount: emptyExportInfo.batchRowCount
        },
        defaultExportInfo: {
          byteLength: defaultExportInfo.byteLength,
          summaryRowCount: defaultExportInfo.summaryRowCount,
          batchRowCount: defaultExportInfo.batchRowCount,
          checkedSummaryRows: defaultExportInfo.checkedSummaryRows
        }
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
