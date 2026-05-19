#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.WAREHOUSE_WORK_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const fixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} should return JSON: ${error.message}`);
  }
}

function hasFixtureText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return fixturePrefixes.find((prefix) => text.includes(prefix));
}

function assertNoFixtureText(label, payload) {
  const prefix = hasFixtureText(payload);
  assert(!prefix, `${label} must hide reusable warehouse work fixture prefix ${prefix}`);
}

function rowValues(row) {
  return row.values.filter((value) => value !== undefined).map((value) => String(value));
}

function workbookText(workbook) {
  const chunks = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        chunks.push(String(cell.text || cell.value || ''));
      });
    });
  });
  return chunks.join('\n');
}

async function assertWarehouseWorkExport(path, expectedScopeTexts) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `warehouse work export content-type must be real .xlsx, actual=${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('warehouse-work-export.xlsx'), 'warehouse work export must use warehouse-work-export.xlsx filename');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', 'warehouse work export must return a .xlsx zip payload');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  assert(sheetNames.includes('待入库'), `warehouse work export must include 待入库 sheet; actual=${sheetNames.join(', ')}`);
  assert(sheetNames.includes('待发货库存'), `warehouse work export must include 待发货库存 sheet; actual=${sheetNames.join(', ')}`);

  const receiptSheet = workbook.getWorksheet('待入库');
  const shipmentSheet = workbook.getWorksheet('待发货库存');
  assert(receiptSheet.getCell('A1').text === '仓库待入库导出', 'warehouse receipt export title is incorrect');
  assert(shipmentSheet.getCell('A1').text === '仓库待发货导出', 'warehouse shipment export title is incorrect');
  for (const expectedScopeText of expectedScopeTexts) {
    assert(receiptSheet.getCell('A2').text.includes(expectedScopeText), `warehouse receipt export scope must include ${expectedScopeText}`);
    assert(shipmentSheet.getCell('A2').text.includes(expectedScopeText), `warehouse shipment export scope must include ${expectedScopeText}`);
  }

  const receiptHeaders = rowValues(receiptSheet.getRow(4));
  for (const header of ['序号', '完成任务号', '订单号', '客户', '零件编码', '本次入订单库存', '本次转备货', '完成数量', '状态']) {
    assert(receiptHeaders.includes(header), `warehouse receipt export must include header ${header}`);
  }

  const shipmentHeaders = rowValues(shipmentSheet.getRow(4));
  for (const header of ['序号', '批次号', '订单号', '客户', '零件编码', '账面库存', '建议发货', '剩余未发', '仓库', '库位', '状态']) {
    assert(shipmentHeaders.includes(header), `warehouse shipment export must include header ${header}`);
  }

  return {
    byteLength: buffer.length,
    sheetNames,
    receiptRowCount: receiptSheet.rowCount,
    shipmentRowCount: shipmentSheet.rowCount,
    text: workbookText(workbook)
  };
}

async function assertIncludeTestFixturesDoesNotReduceRows() {
  const [defaultReceipts, fixtureReceipts, defaultShipments, fixtureShipments] = await Promise.all([
    requestJson('/warehouse/receipts/pending'),
    requestJson('/warehouse/receipts/pending?includeTestFixtures=true'),
    requestJson('/warehouse/shipments/pending'),
    requestJson('/warehouse/shipments/pending?includeTestFixtures=true')
  ]);
  assert(Array.isArray(defaultReceipts), 'warehouse pending receipts default response must be an array');
  assert(Array.isArray(fixtureReceipts), 'warehouse pending receipts fixture response must be an array');
  assert(Array.isArray(defaultShipments), 'warehouse pending shipments default response must be an array');
  assert(Array.isArray(fixtureShipments), 'warehouse pending shipments fixture response must be an array');
  assertNoFixtureText('warehouse pending receipts default list', defaultReceipts);
  assertNoFixtureText('warehouse pending shipments default list', defaultShipments);
  assert(
    fixtureReceipts.length >= defaultReceipts.length,
    'warehouse pending receipts includeTestFixtures=true must not reduce normal business rows'
  );
  assert(
    fixtureShipments.length >= defaultShipments.length,
    'warehouse pending shipments includeTestFixtures=true must not reduce normal business rows'
  );
  assert(defaultShipments.length > 0, 'warehouse pending shipments default list must show current business rows');
  return {
    defaultReceiptCount: defaultReceipts.length,
    fixtureReceiptCount: fixtureReceipts.length,
    defaultShipmentCount: defaultShipments.length,
    fixtureShipmentCount: fixtureShipments.length
  };
}

async function main() {
  const scopedExportInfo = await assertWarehouseWorkExport(
    '/warehouse/work/export?orderNo=NO_MATCH_FOR_EXPORT&dateFrom=2026-01-01&dateTo=2026-12-31',
    ['订单：NO_MATCH_FOR_EXPORT', '订单日期：2026-01-01 至 2026-12-31']
  );
  const defaultExportInfo = await assertWarehouseWorkExport('/warehouse/work/export', ['订单：全部']);
  assertNoFixtureText('warehouse work default export', defaultExportInfo.text);

  const fixtureExportInfo = await assertWarehouseWorkExport('/warehouse/work/export?includeTestFixtures=true', ['订单：全部']);
  assert(
    fixtureExportInfo.receiptRowCount >= defaultExportInfo.receiptRowCount,
    'warehouse work export includeTestFixtures=true must not reduce receipt sheet rows'
  );
  assert(
    fixtureExportInfo.shipmentRowCount >= defaultExportInfo.shipmentRowCount,
    'warehouse work export includeTestFixtures=true must not reduce shipment sheet rows'
  );
  const fixtureListCounts = await assertIncludeTestFixturesDoesNotReduceRows();

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'warehouse-work-export-read-only',
          'warehouse-work-export-xlsx',
          'warehouse-work-export-receipt-sheet',
          'warehouse-work-export-shipment-sheet',
          'warehouse-work-default-fixture-filter',
          'warehouse-work-include-test-fixtures-does-not-reduce-results'
        ],
        scopedExport: {
          byteLength: scopedExportInfo.byteLength,
          receiptRowCount: scopedExportInfo.receiptRowCount,
          shipmentRowCount: scopedExportInfo.shipmentRowCount
        },
        defaultExport: {
          receiptRowCount: defaultExportInfo.receiptRowCount,
          shipmentRowCount: defaultExportInfo.shipmentRowCount
        },
        includeTestFixturesExport: {
          receiptRowCount: fixtureExportInfo.receiptRowCount,
          shipmentRowCount: fixtureExportInfo.shipmentRowCount
        },
        fixtureListCounts
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
