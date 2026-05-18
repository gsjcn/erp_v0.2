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
  process.env.INVENTORY_MATERIALS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const prisma = new PrismaClient();
const materialFixturePartCode = 'MAT-STABLE-INVENTORY-MATERIAL';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function isTestFixtureMaterial(row) {
  const partCode = String(row?.partCode || '');
  const partName = String(row?.partName || '');
  return testFixturePrefixes.some((prefix) => partCode.startsWith(prefix) || partName.startsWith(prefix));
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
    `零件基础库导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('inventory-materials-export.xlsx'), '零件基础库导出缺少固定响应文件名');
  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '零件基础库导出必须是 .xlsx zip 文件');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return { buffer, workbook };
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

async function seedMaterialFixture() {
  await prisma.material.upsert({
    where: { partCode: materialFixturePartCode },
    update: {
      partName: 'MAT-STABLE 库存基础库验证零件',
      unit: '件',
      partSpecification: 'inventory-materials-fixture',
      stockAlertEnabled: true,
      stockAlertQuantity: 99,
      status: 'ENABLED'
    },
    create: {
      partCode: materialFixturePartCode,
      partName: 'MAT-STABLE 库存基础库验证零件',
      unit: '件',
      partSpecification: 'inventory-materials-fixture',
      stockAlertEnabled: true,
      stockAlertQuantity: 99,
      status: 'ENABLED'
    }
  });
}

async function main() {
  await seedMaterialFixture();
  const listPayload = await fetchJson('/inventory/materials?status=ENABLED&stockAlert=ALL&limit=1&offset=0');
  assert(!Array.isArray(listPayload), 'public inventory material list API must return an explicit paged response object');
  assert(Array.isArray(listPayload.items), 'public inventory material list API must return items array');
  assert(Number.isInteger(listPayload.totalCount), 'public inventory material list API must return totalCount');
  assert(listPayload.limit === 1, 'public inventory material list API must respect limit without requiring withPage=true');
  assert(listPayload.offset === 0, 'public inventory material list API must return offset');
  assert(typeof listPayload.hasMore === 'boolean', 'public inventory material list API must return hasMore');

  const materials = await fetchJson('/inventory/materials?status=ENABLED&stockAlert=ALL&limit=200&offset=0');
  const materialsWithFixtures = await fetchJson('/inventory/materials?status=ENABLED&stockAlert=ALL&includeTestFixtures=true&limit=200&offset=0');
  assert(
    materials.items.every((row) => !isTestFixtureMaterial(row)),
    '零件基础库列表默认必须隐藏回归测试零件'
  );
  assert(
    materialsWithFixtures.totalCount >= materials.totalCount &&
      materialsWithFixtures.items.some((row) => row.partCode === materialFixturePartCode),
    'includeTestFixtures=true 只能扩大或保持零件基础库结果，不能减少正常零件'
  );

  const { buffer, workbook } = await fetchWorkbook('/inventory/materials/export?keyword=NO_MATCH_MATERIAL_EXPORT&status=ENABLED&stockAlert=ALL');
  const sheet = workbook.getWorksheet('零件基础资料');
  assert(sheet, '零件基础库导出缺少 零件基础资料 工作表');
  assert(sheet.getCell('A1').text === '零件基础库导出', '零件基础库导出标题不正确');
  assert(sheet.getCell('A2').text.includes('关键词：NO_MATCH_MATERIAL_EXPORT'), '零件基础库导出范围说明缺少关键字');
  assert(sheet.getCell('A2').text.includes('状态：启用'), '零件基础库导出范围说明缺少状态');
  assert(sheet.getCell('A2').text.includes('库存报警：全部'), '零件基础库导出范围说明缺少库存报警');

  const headers = sheet
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map(String);
  for (const header of [
    '序号',
    '零件编码',
    '零件名称',
    '单位',
    '成品规格',
    '默认工艺',
    '可用库存',
    '订单库存',
    '备货库存',
    '库存报警',
    '最小库存',
    '订单使用次数',
    '最近订单号',
    '状态'
  ]) {
    assert(headers.includes(header), `零件基础库导出缺少表头 ${header}`);
  }
  assert(!headers.includes('创建时间'), '零件基础库导出当前不应展示资料创建时间');
  assert(!headers.includes('更新时间'), '零件基础库导出当前不应展示资料更新时间');
  assert(sheet.getCell('A5').text.includes('当前筛选范围没有零件基础资料'), '空筛选导出必须保留可读提示行');

  const { workbook: disabledWorkbook } = await fetchWorkbook('/inventory/materials/export?status=DISABLED&stockAlert=ALL');
  const disabledSheet = disabledWorkbook.getWorksheet('零件基础资料');
  assert(disabledSheet, '停用零件导出缺少 零件基础资料 工作表');
  assert(!worksheetTextHasTestFixturePrefix(disabledSheet), '停用零件导出默认不得包含 cleanup:test-data 测试零件');
  const { workbook: defaultWorkbook } = await fetchWorkbook('/inventory/materials/export?status=ENABLED&stockAlert=ALL');
  const defaultSheet = defaultWorkbook.getWorksheet('零件基础资料');
  assert(defaultSheet, '启用零件导出缺少 零件基础资料 工作表');
  assert(!worksheetTextHasTestFixturePrefix(defaultSheet), '零件基础库导出默认不得包含回归测试零件');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'inventory-materials-public-list-pagination',
          'inventory-materials-test-fixture-filter',
          'inventory-materials-export-test-fixture-filter',
          'inventory-materials-export-xlsx',
          'inventory-materials-export-scope',
          'inventory-materials-export-columns'
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
