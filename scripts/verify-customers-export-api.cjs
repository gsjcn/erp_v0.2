#!/usr/bin/env node

const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

for (const envPath of [resolve('.env'), resolve('backend/.env')]) {
  if (!existsSync(envPath)) {
    continue;
  }
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const apiBaseUrl = (
  process.env.CUSTOMERS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const prisma = new PrismaClient();
const customerFixturePrefix = 'COD-CUSTOMERS-STABLE';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isTestFixtureCustomer(row) {
  const prefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];
  const customerCode = String(row?.customerCode || '');
  const customerName = String(row?.customerName || '');
  return prefixes.some((prefix) => customerCode.startsWith(prefix) || customerName.startsWith(prefix));
}

async function fetchJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

async function fetchWorkbook(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `客户资料导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '客户资料导出必须是 .xlsx zip 文件');
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
  const prefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];
  let found = false;
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const text = String(cell.text || cell.value || '');
      if (prefixes.some((prefix) => text.includes(prefix))) {
        found = true;
      }
    });
  });
  return found;
}

async function seedCustomerFixture() {
  await prisma.customer.upsert({
    where: { customerCode: `${customerFixturePrefix}-CUST` },
    update: {
      customerName: `${customerFixturePrefix} 客户`,
      contactName: '客户验证',
      contactPhone: '13800000000',
      regionType: 'CHINA',
      province: '江苏省',
      city: '常州市',
      detailAddress: 'customers fixture',
      status: 'ENABLED'
    },
    create: {
      customerCode: `${customerFixturePrefix}-CUST`,
      customerName: `${customerFixturePrefix} 客户`,
      contactName: '客户验证',
      contactPhone: '13800000000',
      regionType: 'CHINA',
      province: '江苏省',
      city: '常州市',
      detailAddress: 'customers fixture',
      status: 'ENABLED'
    }
  });
}

async function main() {
  await seedCustomerFixture();
  const listPayload = await fetchJson('/customers?limit=1&offset=0');
  assert(!Array.isArray(listPayload), 'public customer list API must return an explicit paged response object');
  assert(Array.isArray(listPayload.items), 'public customer list API must return items array');
  assert(Number.isInteger(listPayload.totalCount), 'public customer list API must return totalCount');
  assert(listPayload.limit === 1, 'public customer list API must respect limit without requiring withPage=true');
  assert(listPayload.offset === 0, 'public customer list API must return offset');
  assert(typeof listPayload.hasMore === 'boolean', 'public customer list API must return hasMore');

  const defaultCustomers = await fetchJson('/customers?limit=200&offset=0');
  const customersWithFixtures = await fetchJson('/customers?includeTestFixtures=true&limit=200&offset=0');
  assert(
    defaultCustomers.items.every((row) => !isTestFixtureCustomer(row)),
    '客户列表默认必须隐藏回归测试客户'
  );
  assert(
    customersWithFixtures.totalCount >= defaultCustomers.totalCount &&
      customersWithFixtures.items.some((row) => row.customerCode === `${customerFixturePrefix}-CUST`),
    'includeTestFixtures=true 只能扩大或保持客户列表结果，不能减少正常客户'
  );

  const { response, buffer, workbook } = await fetchWorkbook('/customers/export?keyword=NO_MATCH_CUSTOMER_EXPORT');
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('customers-export.xlsx'), '客户资料导出缺少固定响应文件名');

  const sheet = workbook.getWorksheet('客户资料');
  assert(sheet, '客户资料导出缺少 客户资料 工作表');
  assert(sheet.getCell('A1').text === '客户资料导出', '客户资料导出标题不正确');
  assert(sheet.getCell('A2').text.includes('关键字：NO_MATCH_CUSTOMER_EXPORT'), '客户资料导出范围说明缺少关键字');

  const headers = sheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '客户ID', '客户名称', '状态', '地区范围', '主要联系人', '联系人明细', '备注']) {
    assert(headers.includes(header), `客户资料导出缺少表头 ${header}`);
  }

  const { workbook: disabledWorkbook } = await fetchWorkbook('/customers/export?status=DISABLED');
  const disabledSheet = disabledWorkbook.getWorksheet('客户资料');
  assert(disabledSheet, '停用客户导出缺少 客户资料 工作表');
  assert(!worksheetTextIncludes(disabledSheet, '__DISABLED__'), '停用客户导出默认不得包含 cleanup:test-data 归档测试客户');
  const { workbook: defaultWorkbook } = await fetchWorkbook('/customers/export');
  const defaultSheet = defaultWorkbook.getWorksheet('客户资料');
  assert(defaultSheet, '客户默认导出缺少 客户资料 工作表');
  assert(!worksheetTextHasTestFixturePrefix(defaultSheet), '客户导出默认不得包含回归测试客户');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'customers-public-list-pagination',
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

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
