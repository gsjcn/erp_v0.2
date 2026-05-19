#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.INVENTORY_MATERIALS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];
const checks = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isTestFixtureMaterial(row) {
  const partCode = String(row?.partCode || '');
  const partName = String(row?.partName || '');
  return testFixturePrefixes.some((prefix) => partCode.startsWith(prefix) || partName.startsWith(prefix));
}

async function fetchJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} should return JSON: ${error.message}`);
  }
}

async function fetchWorkbook(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `inventory materials export content-type must be real .xlsx, actual=${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('inventory-materials-export.xlsx'), 'inventory materials export must use fixed .xlsx filename.');
  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', 'inventory materials export must return a .xlsx zip payload.');
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

function worksheetTextIncludes(sheet, expectedText) {
  let found = false;
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const text = String(cell.text || cell.value || '');
      if (text.includes(expectedText)) {
        found = true;
      }
    });
  });
  return found;
}

function worksheetColumnTexts(sheet, columnNumber, startRow = 5) {
  const values = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber >= startRow) {
      const text = row.getCell(columnNumber).text;
      if (text) {
        values.push(text);
      }
    }
  });
  return values;
}

function assertMaterialPageShape(label, payload, expectedLimit, expectedOffset) {
  assert(payload && typeof payload === 'object' && !Array.isArray(payload), `${label} must return an explicit paged response object.`);
  assert(Array.isArray(payload.items), `${label} must return items[].`);
  assert(Number.isInteger(payload.totalCount), `${label} must return integer totalCount.`);
  assert(payload.limit === expectedLimit, `${label} must echo limit=${expectedLimit}; got ${payload.limit}.`);
  assert(payload.offset === expectedOffset, `${label} must echo offset=${expectedOffset}; got ${payload.offset}.`);
  assert(typeof payload.hasMore === 'boolean', `${label} must return boolean hasMore.`);
}

async function findScopeContext() {
  const customers = await fetchJson('/customers?status=ENABLED&limit=50&offset=0');
  assert(Array.isArray(customers.items), 'customers page must return items[].');
  for (const customer of customers.items) {
    const customerId = String(customer.id || '');
    const customerName = String(customer.customerName || '');
    if (!customerId || !customerName || testFixturePrefixes.some((prefix) => customerName.startsWith(prefix) || String(customer.customerCode || '').startsWith(prefix))) {
      continue;
    }
    const projectModels = await fetchJson(`/materials/project-models?customerId=${encodeURIComponent(customerId)}`);
    if (!Array.isArray(projectModels)) {
      continue;
    }
    for (const projectModel of projectModels) {
      const modelText = String(projectModel || '').trim();
      if (!modelText || testFixturePrefixes.some((prefix) => modelText.startsWith(prefix))) {
        continue;
      }
      const scopedMaterials = await fetchJson(
        `/inventory/materials?customerId=${encodeURIComponent(customerId)}&projectModel=${encodeURIComponent(modelText)}&status=ENABLED&stockAlert=ALL&limit=200&offset=0`
      );
      assertMaterialPageShape(`inventory materials scoped page ${customerName}/${modelText}`, scopedMaterials, 200, 0);
      const businessItems = scopedMaterials.items.filter((row) => !isTestFixtureMaterial(row));
      if (businessItems.length > 0) {
        return {
          customerId,
          customerName,
          projectModel: modelText,
          scopedMaterials,
          scopedPartCodes: new Set(businessItems.map((row) => row.partCode))
        };
      }
    }
  }
  return null;
}

async function main() {
  const listPayload = await fetchJson('/inventory/materials?status=ENABLED&stockAlert=ALL&limit=1&offset=0');
  assertMaterialPageShape('public inventory material list API', listPayload, 1, 0);
  checks.push({ label: 'inventory-materials-public-list-pagination', totalCount: listPayload.totalCount, hasMore: listPayload.hasMore });

  const materials = await fetchJson('/inventory/materials?status=ENABLED&stockAlert=ALL&limit=200&offset=0');
  const materialsWithFixtures = await fetchJson('/inventory/materials?status=ENABLED&stockAlert=ALL&includeTestFixtures=true&limit=200&offset=0');
  assertMaterialPageShape('inventory materials default page', materials, 200, 0);
  assertMaterialPageShape('inventory materials includeTestFixtures page', materialsWithFixtures, 200, 0);
  assert(materials.items.every((row) => !isTestFixtureMaterial(row)), 'inventory materials default list must hide reusable regression fixture materials.');
  assert(
    materialsWithFixtures.totalCount >= materials.totalCount,
    'includeTestFixtures=true must not reduce inventory materials list results.'
  );
  checks.push({
    label: 'inventory-materials-test-fixture-filter-read-only',
    defaultTotalCount: materials.totalCount,
    includeFixtureTotalCount: materialsWithFixtures.totalCount
  });

  const { buffer, workbook } = await fetchWorkbook('/inventory/materials/export?keyword=NO_MATCH_MATERIAL_EXPORT&status=ENABLED&stockAlert=ALL');
  const sheet = workbook.getWorksheet('零件基础资料');
  assert(sheet, 'inventory materials export must include 零件基础资料 worksheet.');
  assert(sheet.getCell('A1').text === '零件基础库导出', 'inventory materials export title must be correct.');
  assert(sheet.getCell('A2').text.includes('关键词：NO_MATCH_MATERIAL_EXPORT'), 'inventory materials export scope must include keyword.');
  assert(sheet.getCell('A2').text.includes('状态：启用'), 'inventory materials export scope must include status.');
  assert(sheet.getCell('A2').text.includes('库存报警：全部'), 'inventory materials export scope must include stock alert filter.');

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
    '最近客户',
    '最近下单日期',
    '状态'
  ]) {
    assert(headers.includes(header), `inventory materials export must include header ${header}.`);
  }
  assert(!headers.includes('创建时间'), 'inventory materials export must not expose generic createdAt maintenance timestamp.');
  assert(!headers.includes('更新时间'), 'inventory materials export must not expose generic updatedAt maintenance timestamp.');
  assert(sheet.getCell('A5').text.includes('当前筛选范围没有零件基础资料'), 'empty inventory materials export must keep a readable empty-state row.');

  const { workbook: defaultWorkbook } = await fetchWorkbook('/inventory/materials/export?status=ENABLED&stockAlert=ALL');
  const defaultSheet = defaultWorkbook.getWorksheet('零件基础资料');
  assert(defaultSheet, 'enabled inventory materials export must include 零件基础资料 worksheet.');
  assert(!worksheetTextHasTestFixturePrefix(defaultSheet), 'inventory materials default export must hide reusable regression fixture materials.');
  checks.push({
    label: 'inventory-materials-export-test-fixture-filter-read-only',
    byteLength: buffer.length,
    emptyRowCount: sheet.rowCount,
    defaultExportRowCount: defaultSheet.rowCount
  });

  const scopeContext = await findScopeContext();
  if (scopeContext) {
    const { workbook: scopedWorkbook } = await fetchWorkbook(
      `/inventory/materials/export?customerId=${encodeURIComponent(scopeContext.customerId)}&projectModel=${encodeURIComponent(scopeContext.projectModel)}&status=ENABLED&stockAlert=ALL`
    );
    const scopedSheet = scopedWorkbook.getWorksheet('零件基础资料');
    assert(scopedSheet, 'scoped inventory materials export must include 零件基础资料 worksheet.');
    assert(scopedSheet.getCell('A2').text.includes(scopeContext.customerName), 'scoped inventory materials export scope must include customer name.');
    assert(scopedSheet.getCell('A2').text.includes(scopeContext.projectModel), 'scoped inventory materials export scope must include project model.');
    assert(!worksheetTextHasTestFixturePrefix(scopedSheet), 'scoped inventory materials export must hide reusable regression fixture materials by default.');
    const exportedPartCodes = worksheetColumnTexts(scopedSheet, 2);
    assert(exportedPartCodes.some((partCode) => scopeContext.scopedPartCodes.has(partCode)), 'scoped inventory materials export must include scoped business materials.');
    assert(
      exportedPartCodes.every((partCode) => !partCode || partCode === '当前筛选范围没有零件基础资料' || scopeContext.scopedPartCodes.has(partCode)),
      'scoped inventory materials export must match the scoped material list.'
    );
    checks.push({
      label: 'inventory-materials-scope-filter-read-only',
      customerName: scopeContext.customerName,
      projectModel: scopeContext.projectModel,
      scopedTotalCount: scopeContext.scopedMaterials.totalCount
    });
    checks.push({
      label: 'inventory-materials-export-scope-filter-read-only',
      exportedRowCount: scopedSheet.rowCount,
      exportedPartCount: exportedPartCodes.length
    });
  } else {
    checks.push({
      label: 'inventory-materials-scope-filter-read-only-skipped',
      reason: 'no existing business customer/project material scope data'
    });
  }

  assert(worksheetTextIncludes(defaultSheet, '零件基础库导出'), 'inventory materials default export must keep workbook title.');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'inventory-materials-public-list-pagination',
          'inventory-materials-test-fixture-filter-read-only',
          'inventory-materials-export-test-fixture-filter-read-only',
          'inventory-materials-scope-filter-read-only',
          'inventory-materials-export-scope-filter-read-only',
          'inventory-materials-export-xlsx',
          'inventory-materials-export-scope',
          'inventory-materials-export-columns'
        ],
        checks
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
