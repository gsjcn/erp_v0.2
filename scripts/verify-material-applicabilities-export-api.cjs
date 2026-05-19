#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.MATERIAL_APPLICABILITIES_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const fixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];
const checks = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(endpoint) {
  const response = await fetch(`${apiBaseUrl}${endpoint}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${endpoint} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${endpoint} should return JSON: ${error.message}`);
  }
}

function assertNoFixtureText(label, value) {
  const text = JSON.stringify(value || {});
  const matchedPrefix = fixturePrefixes.find((prefix) => text.includes(prefix));
  assert(!matchedPrefix, `${label} must hide reusable regression fixture prefix ${matchedPrefix} by default.`);
}

function assertPageShape(label, page, expectedLimit = 50, expectedOffset = 0) {
  assert(page && typeof page === 'object' && !Array.isArray(page), `${label} must return a paginated object.`);
  assert(Array.isArray(page.items), `${label} must return items[].`);
  assert(page.limit === expectedLimit, `${label} must echo limit=${expectedLimit}; got ${page.limit}.`);
  assert(page.offset === expectedOffset, `${label} must echo offset=${expectedOffset}; got ${page.offset}.`);
  assert(Number.isInteger(page.totalCount), `${label} must return integer totalCount.`);
  assert(typeof page.hasMore === 'boolean', `${label} must return boolean hasMore.`);
  assertNoFixtureText(label, page);
}

function assertMaterialRow(row) {
  assert(String(row.id || '').trim(), 'material row must include id.');
  assert(String(row.partCode || '').trim(), 'material row must include partCode.');
  assert(String(row.partName || '').trim(), `material ${row.partCode || '-'} must include partName.`);
  assert(String(row.status || '').trim(), `material ${row.partCode || '-'} must include status.`);
}

function assertApplicabilityRow(row, material) {
  assert(String(row.id || '').trim(), `material ${material.partCode} applicability must include id.`);
  assert(row.materialId === material.id, `material ${material.partCode} applicability must belong to selected material.`);
  assert(['ALL', 'CUSTOMER'].includes(row.customerScopeKey), `material ${material.partCode} applicability customerScopeKey must be valid.`);
  assert(['ALL', 'PROJECT'].includes(row.projectModelScopeKey), `material ${material.partCode} applicability projectModelScopeKey must be valid.`);
  assert(String(row.scopeLabel || '').trim(), `material ${material.partCode} applicability must include scopeLabel.`);
  assert(['ENABLED', 'DISABLED'].includes(row.status), `material ${material.partCode} applicability status must be known, actual=${row.status}.`);
}

async function findMaterialForApplicabilityExport() {
  const page = await readJson('/inventory/materials?status=ENABLED&limit=50&offset=0');
  assertPageShape('inventory materials enabled page for applicability export regression', page);
  assert(page.totalCount > 0, 'inventory materials enabled page must show business materials.');

  let fallback = null;
  for (const material of page.items) {
    assertMaterialRow(material);
    const endpoint = `/inventory/materials/${encodeURIComponent(material.id)}/applicabilities`;
    const applicabilityPayload = await readJson(endpoint);
    assert(applicabilityPayload && typeof applicabilityPayload === 'object' && !Array.isArray(applicabilityPayload), 'material applicabilities must return an object.');
    assert(Array.isArray(applicabilityPayload.items), 'material applicabilities response must include items[].');
    assertNoFixtureText(`material ${material.partCode} applicabilities`, applicabilityPayload);
    if (!fallback) {
      fallback = { material, applicabilityPayload, endpoint };
    }
    if (applicabilityPayload.items.length > 0) {
      return { material, applicabilityPayload, endpoint };
    }
  }

  return fallback;
}

function worksheetRows(sheet) {
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    rows.push({
      rowNumber,
      values: Array.from({ length: 13 }, (_, index) => row.getCell(index + 1).text)
    });
  });
  return rows;
}

async function assertExportWorkbook(material, applicabilityPayload) {
  const endpoint = `/inventory/materials/${encodeURIComponent(material.id)}/applicabilities/export`;
  const response = await fetch(`${apiBaseUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `material applicabilities export content-type must be real .xlsx, actual=${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('material-applicabilities-export.xlsx'), 'material applicabilities export must use fixed .xlsx filename.');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', 'material applicabilities export must return a .xlsx zip payload.');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('适用范围');
  assert(sheet, 'material applicabilities export must include 适用范围 worksheet.');
  assert(sheet.getCell('A1').text === '零件适用范围导出', 'material applicabilities export title must be correct.');
  assert(sheet.getCell('A2').text.includes(`零件：${material.partCode} / ${material.partName}`), 'material applicabilities export scope must include selected material.');
  assert(sheet.getCell('A2').text.includes('零件状态：启用'), 'material applicabilities export scope must include material status.');

  const headers = sheet
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map(String);
  for (const header of ['序号', '零件编码', '零件名称', '单位', '成品规格', '客户范围', '客户编码', '客户名称', '机型/项目范围', '机型/项目', '适用范围', '状态', '备注']) {
    assert(headers.includes(header), `material applicabilities export must include header ${header}.`);
  }

  const rows = worksheetRows(sheet).filter((row) => row.rowNumber >= 5);
  if (applicabilityPayload.items.length === 0) {
    assert(rows.length === 1, 'material applicabilities export without rules must keep one empty-state row.');
    assert(rows[0].values[0] === '当前零件没有维护适用范围', 'material applicabilities export without rules must show empty-state text.');
  } else {
    for (const applicability of applicabilityPayload.items) {
      assertApplicabilityRow(applicability, material);
      const matchingRow = rows.find((row) => row.values[1] === material.partCode && row.values[10] === applicability.scopeLabel);
      assert(matchingRow, `material applicabilities export must include scope ${applicability.scopeLabel}.`);
    }
  }

  checks.push({
    label: 'material-applicabilities-export-read-only',
    endpoint,
    partCode: material.partCode,
    applicabilityCount: applicabilityPayload.items.length,
    byteLength: buffer.length,
    rowCount: sheet.rowCount
  });
}

async function main() {
  const selected = await findMaterialForApplicabilityExport();
  assert(selected, 'material applicabilities export regression needs at least one enabled material.');
  const { material, applicabilityPayload, endpoint } = selected;
  checks.push({
    label: 'material-applicabilities-existing-business-data',
    endpoint,
    partCode: material.partCode,
    applicabilityCount: applicabilityPayload.items.length
  });

  await assertExportWorkbook(material, applicabilityPayload);

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'material-applicabilities-export-read-only',
          'material-applicabilities-export-xlsx',
          'material-applicabilities-export-scope',
          'material-applicabilities-export-columns',
          'material-applicabilities-export-empty-state'
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
