#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.MATERIAL_DASHBOARD_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const verificationName = 'verify-material-dashboard-export-api';
const dashboardListLimit = 200;
const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path) {
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

function isTestFixtureDashboardRow(row) {
  const values = [
    row.partCode,
    row.partName,
    row.customerScopeLabel,
    row.lastCustomerName,
    ...(row.customerNames || []),
    ...(row.historyCustomerNames || []),
    ...(row.projectModels || []),
    ...(row.historyProjectModels || []),
    ...(row.bomNames || [])
  ].map((value) => String(value || '').trim());
  return values.some((value) => testFixturePrefixes.some((prefix) => value.startsWith(prefix)));
}

function worksheetTextHasTestFixturePrefix(worksheet) {
  let matched = false;
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      const text = String(cell.text || cell.value || '');
      if (testFixturePrefixes.some((prefix) => text.includes(prefix))) {
        matched = true;
      }
    });
  });
  return matched;
}

async function fetchDashboardWorkbook(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `material dashboard export content-type must be real .xlsx, actual=${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('material-dashboard-export.xlsx'), 'material dashboard export must use fixed .xlsx filename.');
  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', 'material dashboard export must return a .xlsx zip payload.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return { buffer, workbook };
}

function headerIndexMap(worksheet) {
  let headerRow = null;
  worksheet.eachRow((row) => {
    const values = row.values.map((value) => String(value || '').trim());
    if (values.includes('零件编码') && values.includes('BOM 结构') && values.includes('BOM 核对')) {
      headerRow = row;
    }
  });
  assert(headerRow, 'material dashboard export must include header row.');
  const result = new Map();
  headerRow.eachCell((cell, colNumber) => {
    result.set(String(cell.text || cell.value || '').trim(), colNumber);
  });
  return { headerRow, result };
}

function exportedRowsByPartCode(worksheet, headerRow, partCodeColumn) {
  const rows = new Map();
  worksheet.eachRow((row) => {
    if (row.number <= headerRow.number) {
      return;
    }
    const partCode = String(row.getCell(partCodeColumn).text || '').trim();
    if (partCode) {
      rows.set(partCode, row);
    }
  });
  return rows;
}

async function assertDashboardExport(path, expectedScopeTexts) {
  const { buffer, workbook } = await fetchDashboardWorkbook(path);
  assert(workbook.worksheets.length === 1, 'material dashboard export must include exactly one worksheet.');
  const worksheet = workbook.worksheets[0];
  assert(worksheet.name === '零件控制面板', `material dashboard export worksheet name must be 零件控制面板, actual=${worksheet.name}.`);
  assert(worksheet.getCell('A1').text === '零件管理控制面板导出', 'material dashboard export title must be correct.');
  for (const expectedScopeText of expectedScopeTexts) {
    assert(worksheet.getCell('A2').text.includes(expectedScopeText), `material dashboard export scope must include ${expectedScopeText}.`);
  }

  const headerValues = worksheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '零件编码', '零件名称', '当前关系', '库存报警', 'BOM 结构', '图纸核对', 'BOM 核对', '库存核对', '状态']) {
    assert(headerValues.includes(header), `material dashboard export must include header ${header}.`);
  }
  return { workbook, worksheet, byteLength: buffer.length, rowCount: worksheet.rowCount };
}

function assertDashboardPreviewContract(result) {
  assert(result && typeof result === 'object' && !Array.isArray(result), 'material dashboard must return a paged object.');
  assert(Array.isArray(result.items), 'material dashboard must return paged items.');
  assert(Number.isInteger(result.totalCount), 'material dashboard must return totalCount.');
  assert(result.limit === dashboardListLimit, `material dashboard must echo limit=${dashboardListLimit}; got ${result.limit}.`);
  assert(result.offset === 0, `material dashboard must echo offset=0; got ${result.offset}.`);

  let allCustomerScopeRowCount = 0;
  let allCustomerScopeHistoryRowCount = 0;
  let orderHistoryScopeRowCount = 0;
  let allProjectScopeRowCount = 0;
  let bomRowCount = 0;
  for (const row of result.items) {
    const details = row.bomStructureDetails || [];
    assert(Array.isArray(details), `material ${row.partCode || '-'} bomStructureDetails must be an array.`);
    assert(details.length <= 10, `material ${row.partCode || '-'} BOM structure preview must not exceed 10, actual ${details.length}.`);
    assert(typeof row.bomStructureDetailCount === 'number', `material ${row.partCode || '-'} must return bomStructureDetailCount.`);
    assert(row.bomStructureDetailCount >= details.length, `material ${row.partCode || '-'} bomStructureDetailCount must be >= preview length.`);
    assert(typeof row.currentScopeBomLineCount === 'number', `material ${row.partCode || '-'} must return currentScopeBomLineCount.`);

    const customerNames = row.customerNames || [];
    assert(Array.isArray(customerNames), `material ${row.partCode || '-'} customerNames must be an array.`);
    assert(customerNames.length <= 20, `material ${row.partCode || '-'} customer preview must not exceed 20, actual ${customerNames.length}.`);
    assert(typeof row.customerNameCount === 'number', `material ${row.partCode || '-'} must return customerNameCount.`);
    assert(row.customerNameCount >= customerNames.length, `material ${row.partCode || '-'} customerNameCount must be >= preview length.`);
    assert(typeof row.hasGlobalCustomerScope === 'boolean', `material ${row.partCode || '-'} must return hasGlobalCustomerScope.`);
    if (row.customerScopeKind === 'ALL') {
      allCustomerScopeRowCount += 1;
      assert(row.hasGlobalCustomerScope === true, `material ${row.partCode || '-'} ALL customer scope must set hasGlobalCustomerScope=true.`);
      assert(row.customerScopeLabel === '全部客户', `material ${row.partCode || '-'} ALL customer scope must display 全部客户.`);
      assert(row.scopeType === 'COMMON', `material ${row.partCode || '-'} ALL customer scope must remain COMMON.`);
      assert(row.scopeLabel === '通用件', `material ${row.partCode || '-'} ALL customer scope must display 通用件.`);
      assert(row.partType === '通用件', `material ${row.partCode || '-'} ALL customer scope must not inherit custom partType from order history.`);
      assert(customerNames.length === 0, `material ${row.partCode || '-'} ALL customer scope must not expand customerNames.`);
      assert(row.customerNameCount === 0, `material ${row.partCode || '-'} ALL customer scope must keep customerNameCount=0.`);
    }
    if (row.customerScopeKind === 'ORDER_HISTORY') {
      orderHistoryScopeRowCount += 1;
      assert(customerNames.length === 0, `material ${row.partCode || '-'} ORDER_HISTORY scope must not expand customerNames.`);
      assert(row.customerNameCount === 0, `material ${row.partCode || '-'} ORDER_HISTORY scope must keep customerNameCount=0.`);
      assert(row.currentScopeBomLineCount === 0, `material ${row.partCode || '-'} ORDER_HISTORY scope must not infer current BOM scope from order history.`);
    }

    const historyCustomerNames = row.historyCustomerNames || [];
    assert(Array.isArray(historyCustomerNames), `material ${row.partCode || '-'} historyCustomerNames must be an array.`);
    assert(historyCustomerNames.length <= 20, `material ${row.partCode || '-'} history customer preview must not exceed 20.`);
    assert(typeof row.historyCustomerCount === 'number', `material ${row.partCode || '-'} must return historyCustomerCount.`);
    assert(row.historyCustomerCount >= historyCustomerNames.length, `material ${row.partCode || '-'} historyCustomerCount must be >= preview length.`);
    if (row.customerScopeKind === 'ALL' && row.historyCustomerCount > 0) {
      allCustomerScopeHistoryRowCount += 1;
    }

    const projectModels = row.projectModels || [];
    assert(Array.isArray(projectModels), `material ${row.partCode || '-'} projectModels must be an array.`);
    assert(projectModels.length <= 20, `material ${row.partCode || '-'} project model preview must not exceed 20.`);
    assert(typeof row.projectModelCount === 'number', `material ${row.partCode || '-'} must return projectModelCount.`);
    assert(row.projectModelCount >= projectModels.length, `material ${row.partCode || '-'} projectModelCount must be >= preview length.`);
    const historyProjectModels = row.historyProjectModels || [];
    assert(Array.isArray(historyProjectModels), `material ${row.partCode || '-'} historyProjectModels must be an array.`);
    assert(historyProjectModels.length <= 20, `material ${row.partCode || '-'} history project model preview must not exceed 20.`);
    assert(typeof row.historyProjectModelCount === 'number', `material ${row.partCode || '-'} must return historyProjectModelCount.`);
    assert(row.historyProjectModelCount >= historyProjectModels.length, `material ${row.partCode || '-'} historyProjectModelCount must be >= preview length.`);
    assert(typeof row.hasGlobalProjectScope === 'boolean', `material ${row.partCode || '-'} must return hasGlobalProjectScope.`);
    if (row.hasGlobalProjectScope) {
      allProjectScopeRowCount += 1;
      assert(projectModels.length === 0, `material ${row.partCode || '-'} ALL project scope must not expand projectModels.`);
      assert(row.projectModelCount === 0, `material ${row.partCode || '-'} ALL project scope must keep projectModelCount=0.`);
      assert(!row.projectModel, `material ${row.partCode || '-'} ALL project scope must not expose historical projectModel as scope.`);
    }
    if (row.customerScopeKind === 'ORDER_HISTORY') {
      assert(projectModels.length === 0, `material ${row.partCode || '-'} ORDER_HISTORY scope must not expand historical projectModels as formal scope.`);
      assert(row.projectModelCount === 0, `material ${row.partCode || '-'} ORDER_HISTORY scope must keep projectModelCount=0.`);
      assert(!row.projectModel, `material ${row.partCode || '-'} ORDER_HISTORY scope must not expose historical projectModel as scope.`);
    }

    const bomNames = row.bomNames || [];
    assert(Array.isArray(bomNames), `material ${row.partCode || '-'} bomNames must be an array.`);
    assert(bomNames.length <= 20, `material ${row.partCode || '-'} BOM name preview must not exceed 20.`);
    assert(typeof row.bomNameCount === 'number', `material ${row.partCode || '-'} must return bomNameCount.`);
    assert(row.bomNameCount >= bomNames.length, `material ${row.partCode || '-'} bomNameCount must be >= preview length.`);
    if (row.bomNameCount > 0) {
      bomRowCount += 1;
    }
  }
  assert(allCustomerScopeRowCount > 0, 'material dashboard regression must include at least one 全部客户 scope row.');
  assert(allCustomerScopeHistoryRowCount > 0, 'material dashboard regression must include at least one 全部客户 row with order history.');
  assert(orderHistoryScopeRowCount > 0, 'material dashboard regression must include at least one 仅订单历史 scope row.');
  assert(allProjectScopeRowCount > 0, 'material dashboard regression must include at least one 全部机型/项目 scope row.');
  assert(bomRowCount > 0, 'material dashboard regression must include at least one BOM row.');
  return { allCustomerScopeRowCount, allCustomerScopeHistoryRowCount, orderHistoryScopeRowCount, allProjectScopeRowCount, bomRowCount };
}

function assertDashboardBomPreviewContractReadOnly(result) {
  const bomRows = result.items.filter((row) => Number(row.bomNameCount || 0) > 0 || Number(row.bomStructureDetailCount || 0) > 0);
  assert(bomRows.length > 0, 'material-dashboard-bom-preview-limit read-only regression needs existing BOM rows.');
  let checkedTruncatedBomNamePreview = false;
  let checkedTruncatedBomStructurePreview = false;
  for (const row of bomRows) {
    const bomNames = row.bomNames || [];
    const bomStructureDetails = row.bomStructureDetails || [];
    assert(bomNames.length <= 20, `material ${row.partCode} bomNames preview must keep at most 20 rows.`);
    assert(Number(row.bomNameCount || 0) >= bomNames.length, `material ${row.partCode} bomNameCount must keep real total.`);
    if (Number(row.bomNameCount || 0) > 20) {
      assert(bomNames.length === 20, `material ${row.partCode} bomNames preview must keep first 20 rows when total exceeds 20.`);
      checkedTruncatedBomNamePreview = true;
    }
    assert(bomStructureDetails.length <= 10, `material ${row.partCode} bomStructureDetails preview must keep at most 10 rows.`);
    assert(Number(row.bomStructureDetailCount || 0) >= bomStructureDetails.length, `material ${row.partCode} bomStructureDetailCount must keep real total.`);
    if (Number(row.bomStructureDetailCount || 0) > 10) {
      assert(bomStructureDetails.length === 10, `material ${row.partCode} bomStructureDetails preview must keep first 10 rows when total exceeds 10.`);
      checkedTruncatedBomStructurePreview = true;
    }
  }
  return {
    checkedBomRowCount: bomRows.length,
    checkedTruncatedBomNamePreview,
    checkedTruncatedBomStructurePreview
  };
}

async function assertDashboardBomStructureExportContractReadOnly(allDashboard) {
  const sourceRow = allDashboard.items.find((row) => Number(row.bomStructureDetailCount || 0) > 0 && (row.bomNames || []).length > 0);
  assert(sourceRow, 'material-dashboard-bom-structure-export-summary read-only regression needs an existing BOM structure row.');
  const { worksheet } = await assertDashboardExport('/materials/dashboard/export?sortBy=PART_CODE&sortOrder=ASC&status=ALL', []);
  const { headerRow, result: headers } = headerIndexMap(worksheet);
  const partCodeColumn = headers.get('零件编码');
  const bomStructureColumn = headers.get('BOM 结构');
  const bomReviewColumn = headers.get('BOM 核对');
  assert(partCodeColumn && bomStructureColumn && bomReviewColumn, 'material dashboard export must include BOM structure and review columns.');
  const row = exportedRowsByPartCode(worksheet, headerRow, partCodeColumn).get(sourceRow.partCode);
  assert(row, `material dashboard export must include BOM structure source material ${sourceRow.partCode}.`);
  const structureText = String(row.getCell(bomStructureColumn).text || '').trim();
  const reviewText = String(row.getCell(bomReviewColumn).text || '').trim();
  assert(structureText.includes(sourceRow.bomNames[0]), 'material dashboard export BOM structure must include BOM names.');
  assert(structureText.includes('顺序'), 'material dashboard export BOM structure must include line order detail.');
  assert(!reviewText.includes('结构待核对'), `material dashboard export BOM review must not mark rows with structure details as pending: ${reviewText}.`);
  return {
    bomStructureExportPartCode: sourceRow.partCode,
    bomStructureExportTextLength: structureText.length,
    bomReviewExportTextLength: reviewText.length
  };
}

async function assertDashboardCustomerScopeExportContract(allDashboard) {
  const allScopeRow =
    (allDashboard.items || []).find((row) => row.customerScopeKind === 'ALL' && Number(row.historyCustomerCount || 0) > 0) ||
    (allDashboard.items || []).find((row) => row.customerScopeKind === 'ALL');
  const historyScopeRow = (allDashboard.items || []).find(
    (row) => row.customerScopeKind === 'ORDER_HISTORY' && Number(row.historyCustomerCount || 0) > 0
  );
  assert(allScopeRow, 'material-dashboard-customer-scope-export-summary regression needs an ALL customer scope row.');
  assert(historyScopeRow, 'material-dashboard-customer-scope-export-summary regression needs an order-history customer scope row.');

  const { worksheet } = await assertDashboardExport('/materials/dashboard/export?sortBy=PART_CODE&sortOrder=ASC&status=ALL', []);
  const { headerRow, result: headers } = headerIndexMap(worksheet);
  const partCodeColumn = headers.get('零件编码');
  const customerScopeColumn = headers.get('适用客户');
  assert(partCodeColumn && customerScopeColumn, 'material dashboard export must include partCode and customer scope columns.');
  const rowsByPartCode = exportedRowsByPartCode(worksheet, headerRow, partCodeColumn);

  const allScopeExportRow = rowsByPartCode.get(allScopeRow.partCode);
  assert(allScopeExportRow, `material dashboard export must include all-scope material ${allScopeRow.partCode}.`);
  const allScopeText = String(allScopeExportRow.getCell(customerScopeColumn).text || '').trim();
  assert(allScopeText === '全部客户', `ALL customer scope export must stay summarized as 全部客户, actual=${allScopeText}.`);

  const historyScopeExportRow = rowsByPartCode.get(historyScopeRow.partCode);
  assert(historyScopeExportRow, `material dashboard export must include order-history material ${historyScopeRow.partCode}.`);
  const historyScopeText = String(historyScopeExportRow.getCell(customerScopeColumn).text || '').trim();
  assert(historyScopeText.startsWith('仅订单历史'), `ORDER_HISTORY customer scope export must stay marked as order history, actual=${historyScopeText}.`);
  return {
    customerScopeExportAllText: allScopeText,
    customerScopeExportHistoryText: historyScopeText
  };
}

async function assertDashboardTestFixtureFilter() {
  const defaultDashboard = await requestJson('/materials/dashboard?sortBy=PART_CODE&sortOrder=ASC&limit=200&offset=0');
  const defaultDashboardWithFixtures = await requestJson(
    '/materials/dashboard?includeTestFixtures=true&sortBy=PART_CODE&sortOrder=ASC&limit=200&offset=0'
  );
  assert(
    !(defaultDashboard.items || []).some(isTestFixtureDashboardRow),
    'material dashboard default list must hide reusable test fixture materials/customers/BOMs.'
  );
  assert(
    defaultDashboardWithFixtures.totalCount >= defaultDashboard.totalCount,
    'includeTestFixtures=true must not reduce material dashboard default results.'
  );
  const disabledDashboard = await requestJson('/materials/dashboard?status=DISABLED&sortBy=PART_CODE&sortOrder=ASC&limit=200&offset=0');
  const disabledDashboardWithFixtures = await requestJson(
    '/materials/dashboard?status=DISABLED&includeTestFixtures=true&sortBy=PART_CODE&sortOrder=ASC&limit=200&offset=0'
  );
  assert(
    !(disabledDashboard.items || []).some(isTestFixtureDashboardRow),
    'material dashboard default DISABLED list must hide archived test fixture materials/customers/BOMs.'
  );
  assert(
    disabledDashboardWithFixtures.totalCount >= disabledDashboard.totalCount,
    'includeTestFixtures=true must not reduce material dashboard DISABLED results.'
  );
  const { workbook } = await fetchDashboardWorkbook('/materials/dashboard/export?status=DISABLED&sortBy=PART_CODE&sortOrder=ASC');
  assert(workbook.worksheets.length > 0, 'material dashboard test fixture export regression must receive a workbook.');
  assert(
    !worksheetTextHasTestFixturePrefix(workbook.worksheets[0]),
    'material dashboard default DISABLED export must hide archived test fixture materials/customers/BOMs.'
  );
  return {
    defaultDashboardCount: defaultDashboard.totalCount,
    defaultDashboardWithFixturesCount: defaultDashboardWithFixtures.totalCount,
    disabledDashboardCount: disabledDashboard.totalCount,
    disabledDashboardWithFixturesCount: disabledDashboardWithFixtures.totalCount
  };
}

async function assertProjectModelsTestFixtureFilter() {
  const defaultProjectModels = await requestJson('/materials/project-models');
  const projectModelsWithFixtures = await requestJson('/materials/project-models?includeTestFixtures=true');
  assert(Array.isArray(defaultProjectModels), 'material project models default response must be an array.');
  assert(Array.isArray(projectModelsWithFixtures), 'material project models includeTestFixtures response must be an array.');
  assert(
    !defaultProjectModels.some((value) => testFixturePrefixes.some((prefix) => String(value || '').startsWith(prefix))),
    'material project models default list must hide archived test fixture project models.'
  );
  assert(projectModelsWithFixtures.length >= defaultProjectModels.length, 'includeTestFixtures=true must not reduce material project model options.');
  return {
    projectModelCount: defaultProjectModels.length,
    projectModelWithFixturesCount: projectModelsWithFixtures.length
  };
}

async function assertCommonProjectModelsTestFixtureFilter() {
  const defaultCommonProjectModels = await requestJson('/materials/common-project-models');
  const commonProjectModelsWithFixtures = await requestJson('/materials/common-project-models?includeTestFixtures=true');
  assert(Array.isArray(defaultCommonProjectModels), 'material common project models default response must be an array.');
  assert(Array.isArray(commonProjectModelsWithFixtures), 'material common project models includeTestFixtures response must be an array.');
  assert(
    !defaultCommonProjectModels.some((value) => testFixturePrefixes.some((prefix) => String(value || '').startsWith(prefix))),
    'material common project models default list must hide reusable test fixture project models.'
  );
  assert(
    commonProjectModelsWithFixtures.length >= defaultCommonProjectModels.length,
    'includeTestFixtures=true must not reduce material common project model options.'
  );
  return {
    commonProjectModelCount: defaultCommonProjectModels.length,
    commonProjectModelWithFixturesCount: commonProjectModelsWithFixtures.length
  };
}

async function assertCurrentScopeBomContext() {
  const customerSearch = await requestJson('/customers?keyword=常州&limit=10&offset=0');
  assert(Array.isArray(customerSearch.items) && customerSearch.items.length > 0, 'material dashboard current-scope regression needs a 常州 customer.');
  const changzhouCustomerId = encodeURIComponent(customerSearch.items[0].id);
  const b3CustomerDashboard = await requestJson(
    `/materials/dashboard?customerId=${changzhouCustomerId}&projectModel=B3&sortBy=PART_CODE&sortOrder=ASC&limit=50&offset=0`
  );
  const b3CommonPart = b3CustomerDashboard.items.find((row) => row.partCode === 'P-1001');
  assert(b3CommonPart, 'customer + B3 material dashboard regression must include P-1001.');
  assert(
    b3CommonPart.currentScopeBomLineCount > 0,
    'customer + B3 material dashboard must count BOM rows in the current customer/project scope.'
  );
  assert(
    b3CommonPart.scopeType === 'COMMON' && b3CommonPart.customerScopeKind === 'ALL',
    'customer + B3 material dashboard must keep all-customer P-1001 as common.'
  );
  return {
    currentScopeCustomerName: customerSearch.items[0].customerName,
    currentScopePartCode: b3CommonPart.partCode,
    currentScopeBomLineCount: b3CommonPart.currentScopeBomLineCount
  };
}

async function main() {
  const allDashboard = await requestJson(`/materials/dashboard?sortBy=PART_CODE&sortOrder=ASC&limit=${dashboardListLimit}&offset=0`);
  const explicitAllDashboard = await requestJson(
    `/materials/dashboard?sortBy=PART_CODE&sortOrder=ASC&stockAlert=ALL&limit=${dashboardListLimit}&offset=0`
  );
  const explicitAllStatusDashboard = await requestJson(
    `/materials/dashboard?sortBy=PART_CODE&sortOrder=ASC&status=ALL&limit=${dashboardListLimit}&offset=0`
  );
  const previewInfo = assertDashboardPreviewContract(allDashboard);
  const bomPreviewInfo = assertDashboardBomPreviewContractReadOnly(allDashboard);
  const bomStructureExportInfo = await assertDashboardBomStructureExportContractReadOnly(allDashboard);
  const customerScopeExportInfo = await assertDashboardCustomerScopeExportContract(allDashboard);
  const testFixtureFilterInfo = await assertDashboardTestFixtureFilter();
  const projectModelFilterInfo = await assertProjectModelsTestFixtureFilter();
  const commonProjectModelFilterInfo = await assertCommonProjectModelsTestFixtureFilter();
  const currentScopeInfo = await assertCurrentScopeBomContext();

  const commonDashboard = await requestJson('/materials/dashboard?sortBy=PART_CODE&sortOrder=ASC&scopeType=COMMON&limit=100&offset=0');
  const customDashboard = await requestJson('/materials/dashboard?sortBy=PART_CODE&sortOrder=ASC&scopeType=CUSTOM&limit=100&offset=0');
  assert(commonDashboard.items.every((row) => row.scopeType === 'COMMON'), 'scopeType=COMMON must only return COMMON rows.');
  assert(customDashboard.items.every((row) => row.scopeType === 'CUSTOM'), 'scopeType=CUSTOM must only return CUSTOM rows.');
  assert(commonDashboard.items.some((row) => row.customerScopeKind === 'ALL'), 'scopeType=COMMON must include 全部客户 common rows.');
  assert(customDashboard.items.every((row) => row.customerScopeKind !== 'ALL'), 'scopeType=CUSTOM must not include 全部客户 common rows.');
  assert(
    explicitAllDashboard.totalCount === allDashboard.totalCount,
    `stockAlert=ALL must equal unfiltered stock alert result, actual ${explicitAllDashboard.totalCount} / ${allDashboard.totalCount}.`
  );
  assert(
    explicitAllStatusDashboard.totalCount === allDashboard.totalCount,
    `status=ALL must equal unfiltered status result, actual ${explicitAllStatusDashboard.totalCount} / ${allDashboard.totalCount}.`
  );

  const exportInfo = await assertDashboardExport(
    '/materials/dashboard/export?sortBy=PART_CODE&sortOrder=ASC&stockAlert=ALL&status=ALL&drawingNo=DRW&drawingStatus=新图&drawingDateFrom=2026-01-01&drawingDateTo=2026-12-31&lastOrderDateFrom=2026-01-01&lastOrderDateTo=2026-12-31',
    [
      '库存报警：全部',
      '状态：全部',
      '图号：DRW',
      '图纸状态：新图',
      '图纸日期：2026-01-01 至 2026-12-31',
      '最近下单日期：2026-01-01 至 2026-12-31'
    ]
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        verificationName,
        apiBaseUrl,
        checked: [
          'material-dashboard-read-only',
          'material-dashboard-stock-alert-all',
          'material-dashboard-status-all',
          'material-dashboard-test-fixture-filter',
          'material-dashboard-export-test-fixture-filter',
          'material-project-models-test-fixture-filter',
          'material-common-project-models-test-fixture-filter',
          'material-dashboard-bom-preview-limit',
          'material-dashboard-bom-name-real-total',
          'material-dashboard-bom-structure-real-total',
          'material-dashboard-bom-structure-export-summary',
          'material-dashboard-customer-scope-export-summary',
          'material-dashboard-customer-preview-limit',
          'material-dashboard-all-customer-scope-summary',
          'material-dashboard-all-customer-scope-common-type',
          'material-dashboard-all-customer-scope-history-separation',
          'material-dashboard-order-history-scope-separation',
          'material-dashboard-scope-type-filter-common',
          'material-dashboard-scope-type-filter-custom',
          'material-dashboard-current-scope-bom-context',
          'material-dashboard-all-project-scope-summary',
          'material-dashboard-history-project-scope-separation',
          'material-dashboard-history-customer-preview-limit',
          'material-dashboard-project-model-preview-limit',
          'material-dashboard-bom-name-preview-limit',
          'material-dashboard-current-scope-bom-count',
          'material-dashboard-export-xlsx',
          'material-dashboard-export-review-columns',
          'material-dashboard-export-status-column'
        ],
        ...previewInfo,
        ...bomPreviewInfo,
        ...bomStructureExportInfo,
        ...customerScopeExportInfo,
        ...testFixtureFilterInfo,
        ...projectModelFilterInfo,
        ...commonProjectModelFilterInfo,
        ...currentScopeInfo,
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
