#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.CUSTOMERS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isTestFixtureCustomer(row) {
  const customerCode = String(row?.customerCode || '');
  const customerName = String(row?.customerName || '');
  return testFixturePrefixes.some((prefix) => customerCode.startsWith(prefix) || customerName.startsWith(prefix));
}

async function fetchJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  return response.json();
}

async function fetchWorkbook(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `customers export content-type must be real .xlsx, actual=${contentType || '-'}`
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', 'customers export must return a .xlsx zip payload');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return { response, buffer, workbook };
}

function worksheetTextIncludes(sheet, keyword) {
  let found = false;
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (String(cell.text || cell.value || '').includes(keyword)) {
        found = true;
      }
    });
  });
  return found;
}

function worksheetTextHasTestFixturePrefix(sheet) {
  let found = false;
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const text = String(cell.text || cell.value || '');
      if (testFixturePrefixes.some((prefix) => text.includes(prefix))) {
        found = true;
      }
    });
  });
  return found;
}

function rowValues(row) {
  return row.values.filter((value) => value !== undefined).map((value) => String(value));
}

async function main() {
  const listPayload = await fetchJson('/customers?limit=1&offset=0');
  assert(!Array.isArray(listPayload), 'public customer list API must return an explicit paged response object');
  assert(Array.isArray(listPayload.items), 'public customer list API must return items array');
  assert(Number.isInteger(listPayload.totalCount), 'public customer list API must return totalCount');
  assert(listPayload.limit === 1, 'public customer list API must respect limit without requiring withPage=true');
  assert(listPayload.offset === 0, 'public customer list API must return offset');
  assert(typeof listPayload.hasMore === 'boolean', 'public customer list API must return hasMore');

  const defaultCustomers = await fetchJson('/customers?limit=200&offset=0');
  assert(
    defaultCustomers.items.every((row) => !isTestFixtureCustomer(row)),
    'customers default list must hide reusable regression fixture customers'
  );
  const customersWithFixtures = await fetchJson('/customers?includeTestFixtures=true&limit=200&offset=0');
  assert(
    customersWithFixtures.totalCount >= defaultCustomers.totalCount,
    'includeTestFixtures=true must not reduce normal customer list results'
  );

  const { response, buffer, workbook } = await fetchWorkbook('/customers/export?keyword=NO_MATCH_CUSTOMER_EXPORT');
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('customers-export.xlsx'), 'customers export must use customers-export.xlsx filename');

  const sheet = workbook.getWorksheet('客户资料');
  assert(sheet, 'customers export must include 客户资料 worksheet');
  assert(sheet.getCell('A1').text === '客户资料导出', 'customers export title is incorrect');
  assert(sheet.getCell('A2').text.includes('关键字：NO_MATCH_CUSTOMER_EXPORT'), 'customers export scope must include keyword');

  const headers = rowValues(sheet.getRow(4));
  for (const header of ['序号', '客户ID', '客户名称', '状态', '地区范围', '主要联系人', '联系人明细', '备注']) {
    assert(headers.includes(header), `customers export must include header ${header}`);
  }

  const { workbook: disabledWorkbook } = await fetchWorkbook('/customers/export?status=DISABLED');
  const disabledSheet = disabledWorkbook.getWorksheet('客户资料');
  assert(disabledSheet, 'disabled customers export must include 客户资料 worksheet');
  assert(!worksheetTextIncludes(disabledSheet, '__DISABLED__'), 'disabled customers export must hide cleanup archived fixture customers by default');

  const { workbook: defaultWorkbook } = await fetchWorkbook('/customers/export');
  const defaultSheet = defaultWorkbook.getWorksheet('客户资料');
  assert(defaultSheet, 'customers default export must include 客户资料 worksheet');
  assert(!worksheetTextHasTestFixturePrefix(defaultSheet), 'customers default export must hide reusable regression fixture customers');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'customers-public-list-pagination',
          'customers-export-read-only',
          'customers-test-fixture-filter',
          'customers-export-test-fixture-filter',
          'customers-export-xlsx',
          'customers-export-scope',
          'customers-export-columns'
        ],
        byteLength: buffer.length,
        rowCount: sheet.rowCount
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
