#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.MATERIAL_TRANSFORM_RULES_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const fixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];
const legacyFixtureKeyword = 'VERIFY-TRANSFORM-RULE-STABLE';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNumber(value, label) {
  assert(typeof value === 'number' && Number.isFinite(value), `${label} must be a finite number`);
}

function startsWithFixturePrefix(value) {
  if (value === null || value === undefined) {
    return false;
  }
  const text = String(value).trim();
  return fixturePrefixes.some((prefix) => text.startsWith(prefix));
}

function collectStrings(value, results = []) {
  if (value === null || value === undefined) {
    return results;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    results.push(String(value));
    return results;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, results);
    }
    return results;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStrings(item, results);
    }
  }
  return results;
}

function assertNoFixtureValues(value, label) {
  const fixtureValue = collectStrings(value).find(startsWithFixturePrefix);
  assert(!fixtureValue, `${label} must hide reusable test fixture value ${fixtureValue}`);
}

async function requestJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function requestWorkbook(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }

  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `material transform rules export must be a real .xlsx workbook, got ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('material-transform-rules-export.xlsx'), 'material transform rules export must keep the fixed .xlsx filename');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', 'material transform rules export must be a zipped .xlsx file');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('来源加工关系') || workbook.worksheets[0];
  assert(sheet, 'material transform rules export must contain a worksheet');
  return { buffer, sheet };
}

function sheetText(sheet, fromRow = 1) {
  const values = [];
  for (let rowNumber = fromRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (const value of row.values) {
      if (value !== undefined && value !== null) {
        values.push(String(value));
      }
    }
  }
  return values.join('\n');
}

function sheetRowTexts(sheet, rowNumber) {
  return sheet
    .getRow(rowNumber)
    .values.filter((value) => value !== undefined && value !== null)
    .map(String);
}

function assertPagedResponse(page, label, expectedLimit, expectedOffset) {
  assert(page && typeof page === 'object' && !Array.isArray(page), `${label} must return a paged object`);
  assert(Array.isArray(page.items), `${label} must return items[]`);
  assert(Number.isInteger(page.totalCount), `${label} must return integer totalCount`);
  assert(page.limit === expectedLimit, `${label} must echo limit=${expectedLimit}; got ${page.limit}`);
  assert(page.offset === expectedOffset, `${label} must echo offset=${expectedOffset}; got ${page.offset}`);
  assert(typeof page.hasMore === 'boolean', `${label} must return boolean hasMore`);
  assert(page.items.length <= expectedLimit, `${label} must not return more than limit rows`);
  assert(page.hasMore === expectedOffset + page.items.length < page.totalCount, `${label} hasMore must match pagination math`);
}

function assertTransformRuleRow(row) {
  assert(row && typeof row === 'object', 'material transform rule row must be an object');
  for (const field of ['id', 'sourceMaterialId', 'sourcePartCode', 'sourcePartName', 'targetMaterialId', 'targetPartCode', 'targetPartName', 'customerScopeKey', 'projectModelScopeKey', 'scopeLabel', 'status']) {
    assert(String(row[field] || '').trim(), `material transform rule row must include ${field}`);
  }
  for (const field of ['sourceAvailableQuantity', 'sourceAvailableBatchCount', 'targetAvailableQuantity', 'targetAvailableBatchCount', 'multiplier', 'lossRate']) {
    assertNumber(row[field], `material transform rule ${row.id}.${field}`);
  }
  assert(row.sourcePartCode !== row.targetPartCode, `material transform rule ${row.id} must not transform a part into itself`);
  assert(row.multiplier > 0, `material transform rule ${row.id}.multiplier must be positive`);
  assert(row.lossRate >= 0, `material transform rule ${row.id}.lossRate must be non-negative`);
}

async function assertMaterialTransformRulesReadOnlyList() {
  const defaultPage = await requestJson('/inventory/material-transform-rules?withPage=true&limit=2&offset=0');
  assertPagedResponse(defaultPage, 'material transform rules default page', 2, 0);
  assert(defaultPage.totalCount > 0, 'material transform rules read-only regression requires business baseline rows');
  assertNoFixtureValues(defaultPage.items, 'material transform rules default page');
  for (const row of defaultPage.items) {
    assertTransformRuleRow(row);
  }

  const enabledPage = await requestJson('/inventory/material-transform-rules?status=ENABLED&withPage=true&limit=2&offset=0');
  assertPagedResponse(enabledPage, 'material transform rules enabled page', 2, 0);
  for (const row of enabledPage.items) {
    assertTransformRuleRow(row);
    assert(row.status === 'ENABLED', `material transform rule ${row.id} should be ENABLED`);
  }

  const fixtureHiddenPage = await requestJson(
    `/inventory/material-transform-rules?status=ALL&keyword=${encodeURIComponent(legacyFixtureKeyword)}&withPage=true&limit=20&offset=0`
  );
  assertPagedResponse(fixtureHiddenPage, 'material transform rules fixture-hidden page', 20, 0);
  assertNoFixtureValues(fixtureHiddenPage.items, 'material transform rules fixture-hidden page');

  const fixtureOptInPage = await requestJson(
    `/inventory/material-transform-rules?status=ALL&keyword=${encodeURIComponent(legacyFixtureKeyword)}&includeTestFixtures=true&withPage=true&limit=20&offset=0`
  );
  assertPagedResponse(fixtureOptInPage, 'material transform rules fixture opt-in page', 20, 0);
  assert(
    fixtureOptInPage.totalCount >= fixtureHiddenPage.totalCount,
    'material transform rules includeTestFixtures=true must not hide business rows'
  );

  return defaultPage;
}

function assertTransformWorkbookHeader(sheet) {
  assert(sheet.getCell('A1').text === '来源加工关系导出', 'material transform rules export title is wrong');
  const headers = sheetRowTexts(sheet, 4);
  for (const header of [
    '序号',
    '库存判断',
    '判断依据',
    '来源零件编码',
    '来源可用库存',
    '目标零件编码',
    '目标可用库存',
    '客户范围',
    '机型/项目',
    '适用范围',
    '换算倍率',
    '损耗率',
    '建议工艺',
    '转换说明',
    '关系状态',
    '备注'
  ]) {
    assert(headers.includes(header), `material transform rules export missing header ${header}`);
  }
}

async function assertMaterialTransformRulesReadOnlyExport(sampleRow) {
  const enabledExport = await requestWorkbook('/inventory/material-transform-rules/export?status=ENABLED');
  assertTransformWorkbookHeader(enabledExport.sheet);
  assert(enabledExport.sheet.getCell('A2').text.includes('状态：启用'), 'material transform rules export scope must include enabled status');
  const exportText = sheetText(enabledExport.sheet, 5);
  assert(exportText.includes(sampleRow.sourcePartCode), `material transform rules export must include sample source ${sampleRow.sourcePartCode}`);
  assert(exportText.includes(sampleRow.targetPartCode), `material transform rules export must include sample target ${sampleRow.targetPartCode}`);
  assertNoFixtureValues(exportText, 'material transform rules default export');

  const fixtureHiddenExport = await requestWorkbook(
    `/inventory/material-transform-rules/export?status=ALL&keyword=${encodeURIComponent(legacyFixtureKeyword)}`
  );
  assertNoFixtureValues(sheetText(fixtureHiddenExport.sheet, 5), 'material transform rules fixture-hidden export');
  await requestWorkbook(
    `/inventory/material-transform-rules/export?status=ALL&keyword=${encodeURIComponent(legacyFixtureKeyword)}&includeTestFixtures=true`
  );

  const emptyExport = await requestWorkbook(
    '/inventory/material-transform-rules/export?keyword=NO_MATCH_TRANSFORM_EXPORT&targetPartCode=NO_MATCH_TARGET&status=ALL'
  );
  assertTransformWorkbookHeader(emptyExport.sheet);
  assert(emptyExport.sheet.getCell('A2').text.includes('关键词：NO_MATCH_TRANSFORM_EXPORT'), 'empty export scope must include keyword');
  assert(emptyExport.sheet.getCell('A2').text.includes('目标零件：NO_MATCH_TARGET'), 'empty export scope must include target part');
  assert(emptyExport.sheet.getCell('A2').text.includes('状态：全部'), 'empty export scope must include ALL status');
  assert(emptyExport.sheet.getCell('A5').text.includes('当前筛选范围没有来源加工关系'), 'empty export must keep a readable empty-state row');

  return { byteLength: enabledExport.buffer.length, rowCount: enabledExport.sheet.rowCount };
}

async function main() {
  const defaultPage = await assertMaterialTransformRulesReadOnlyList();
  const exportInfo = await assertMaterialTransformRulesReadOnlyExport(defaultPage.items[0]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'material-transform-rules-read-only',
          'material-transform-rules-test-fixture-filter',
          'material-transform-rules-export-test-fixture-filter',
          'material-transform-rules-export-xlsx',
          'material-transform-rules-export-scope',
          'material-transform-rules-export-columns'
        ],
        byteLength: exportInfo.byteLength,
        rowCount: exportInfo.rowCount
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
