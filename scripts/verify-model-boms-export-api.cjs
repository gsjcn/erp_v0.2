#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.MODEL_BOMS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function isTestFixtureModelBom(row) {
  const bomName = String(row?.bomName || '');
  const projectModel = String(row?.projectModel || '');
  return testFixturePrefixes.some((prefix) => bomName.startsWith(prefix) || projectModel.startsWith(prefix));
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
    `机型零件包导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('model-boms-export.xlsx'), '机型零件包导出缺少固定响应文件名');
  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '机型零件包导出必须是 .xlsx zip 文件');
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

async function main() {
  const listPayload = await fetchJson('/inventory/model-boms?status=ALL&limit=1&offset=0');
  assert(!Array.isArray(listPayload), 'public model BOM list API must return an explicit paged response object');
  assert(Array.isArray(listPayload.items), 'public model BOM list API must return items array');
  assert(Number.isInteger(listPayload.totalCount), 'public model BOM list API must return totalCount');
  assert(listPayload.limit === 1, 'public model BOM list API must respect limit without requiring withPage=true');
  assert(listPayload.offset === 0, 'public model BOM list API must return offset');
  assert(typeof listPayload.hasMore === 'boolean', 'public model BOM list API must return hasMore');
  assert(listPayload.scopeSummary && Number.isInteger(listPayload.scopeSummary.totalCount), 'public model BOM list API must return scopeSummary');
  assert(listPayload.items.every((row) => !isTestFixtureModelBom(row)), '机型零件包列表默认必须隐藏 cleanup:test-data 停用测试 BOM');
  const listPayloadWithFixtures = await fetchJson('/inventory/model-boms?status=ALL&includeTestFixtures=true&limit=200&offset=0');
  assert(
    listPayloadWithFixtures.totalCount >= listPayload.totalCount,
    'includeTestFixtures=true 只能扩大或保持机型零件包结果，不能减少正常 BOM'
  );
  if (listPayload.items.length > 0) {
    const listedBom = listPayload.items[0];
    assert(typeof listedBom.scopeCustomerCount === 'number', 'public model BOM list item must return scopeCustomerCount for customer-scope preview');
    assert(Array.isArray(listedBom.scopeCustomers), 'public model BOM list item must return scopeCustomers preview array');
    assert(listedBom.scopeCustomers.length <= 20, 'public model BOM list item scopeCustomers preview must not exceed 20');
    assert(
      listedBom.scopeCustomerCount >= listedBom.scopeCustomers.length,
      'public model BOM list item scopeCustomerCount must be >= scopeCustomers preview length'
    );
    assert(Array.isArray(listedBom.lines), 'public model BOM list item must return lines array');
    assert(listedBom.lines.length === 0, 'public model BOM list item must not return full BOM lines; use detail endpoint for lines');
    assert(listedBom.lineSummary && Number.isInteger(listedBom.lineSummary.effectiveCount), 'public model BOM list item must return lineSummary');
    const detailResponse = await fetch(`${apiBaseUrl}/inventory/model-boms/${encodeURIComponent(listedBom.id)}`);
    if (!detailResponse.ok) {
      throw new Error(`${detailResponse.status} ${detailResponse.statusText}: ${await detailResponse.text()}`);
    }
    const detailBom = await detailResponse.json();
    assert(
      Array.isArray(detailBom.scopeCustomerIds) && detailBom.scopeCustomerIds.length >= (listedBom.scopeCustomerIds || []).length,
      'model BOM detail endpoint must keep full scopeCustomerIds for editing selected-customer BOMs'
    );
    assert(
      typeof detailBom.scopeCustomerCount === 'number' && detailBom.scopeCustomerCount >= (detailBom.scopeCustomers || []).length,
      'model BOM detail endpoint must return scopeCustomerCount with full customer scope data'
    );
    assert(Array.isArray(detailBom.lines), 'model BOM detail endpoint must return full lines array');
    assert(detailBom.lineSummary && Number.isInteger(detailBom.lineSummary.effectiveCount), 'model BOM detail endpoint must return lineSummary');
  }

  const { buffer, workbook } = await fetchWorkbook('/inventory/model-boms/export?keyword=NO_MATCH_MODEL_BOM_EXPORT&status=ALL');
  const listSheet = workbook.getWorksheet('BOM列表');
  const detailSheet = workbook.getWorksheet('BOM明细');
  const scopeSheet = workbook.getWorksheet('BOM适用客户');
  assert(listSheet, '机型零件包导出缺少 BOM列表 工作表');
  assert(detailSheet, '机型零件包导出缺少 BOM明细 工作表');
  assert(scopeSheet, '机型零件包导出缺少 BOM适用客户 工作表');
  assert(listSheet.getCell('A1').text === '机型零件包导出', 'BOM列表标题不正确');
  assert(detailSheet.getCell('A1').text === '机型零件包明细导出', 'BOM明细标题不正确');
  assert(scopeSheet.getCell('A1').text === '机型零件包适用客户导出', 'BOM适用客户标题不正确');
  assert(listSheet.getCell('A2').text.includes('关键词：NO_MATCH_MODEL_BOM_EXPORT'), 'BOM列表范围说明缺少关键字');
  assert(listSheet.getCell('A2').text.includes('状态：全部'), 'BOM列表范围说明缺少状态');

  const listHeaders = listSheet
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map(String);
  for (const header of ['序号', 'BOM名称', 'BOM范围', '适用范围', '机型/项目', '有效推荐行', '组件', '子零件', '状态']) {
    assert(listHeaders.includes(header), `BOM列表导出缺少表头 ${header}`);
  }

  const detailHeaders = detailSheet
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map(String);
  for (const header of ['BOM名称', '结构', '组件编号', '所属组件', '零件编码', '默认数量', '图号', '版本', '图纸文件地址', '默认工艺', '明细状态']) {
    assert(detailHeaders.includes(header), `BOM明细导出缺少表头 ${header}`);
  }

  const scopeHeaders = scopeSheet
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map(String);
  for (const header of ['BOM名称', 'BOM范围', '适用范围', '客户范围类型', '客户编码', '客户名称', '说明']) {
    assert(scopeHeaders.includes(header), `BOM适用客户导出缺少表头 ${header}`);
  }

  const { workbook: allStatusWorkbook } = await fetchWorkbook('/inventory/model-boms/export?status=ALL');
  const allStatusSheets = ['BOM列表', 'BOM明细', 'BOM适用客户'].map((name) => allStatusWorkbook.getWorksheet(name)).filter(Boolean);
  assert(
    allStatusSheets.every((sheet) => !worksheetTextHasTestFixturePrefix(sheet)),
    '机型零件包导出默认不得包含 cleanup:test-data 测试 BOM'
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'model-boms-public-list-pagination',
          'model-boms-test-fixture-filter',
          'model-boms-export-test-fixture-filter',
          'model-boms-list-customer-scope-preview',
          'model-boms-list-line-summary',
          'model-boms-detail-full-customer-scope',
          'model-boms-detail-full-lines',
          'model-boms-export-xlsx',
          'model-boms-export-scope',
          'model-boms-export-columns',
          'model-boms-export-drawing-file-url-column',
          'model-boms-export-customer-scope-sheet'
        ],
        byteLength: buffer.length,
        listRowCount: listSheet.rowCount,
        detailRowCount: detailSheet.rowCount,
        customerScopeRowCount: scopeSheet.rowCount
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
