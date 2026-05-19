#!/usr/bin/env node

const apiBaseUrl = (
  process.env.MATERIAL_MANAGEMENT_API_BASE_URL ||
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
  assert(!matchedPrefix, `${label} must hide reusable test fixture prefix ${matchedPrefix} by default.`);
}

function assertPageShape(label, page, expectedLimit = 5, expectedOffset = 0) {
  assert(page && !Array.isArray(page), `${label} must return a paginated object.`);
  assert(Array.isArray(page.items), `${label} must return items[].`);
  assert(page.limit === expectedLimit, `${label} must echo limit=${expectedLimit}; got ${page.limit}.`);
  assert(page.offset === expectedOffset, `${label} must echo offset=${expectedOffset}; got ${page.offset}.`);
  assert(Number.isInteger(page.totalCount), `${label} must return integer totalCount.`);
  assert(typeof page.hasMore === 'boolean', `${label} must return boolean hasMore.`);
  assert(page.items.length <= expectedLimit, `${label} must not return more than limit rows.`);
  assert(page.hasMore === expectedOffset + page.items.length < page.totalCount, `${label} hasMore does not match pagination math.`);
  assertNoFixtureText(label, page);
}

function assertSummary(summary, totalCount) {
  assert(summary && typeof summary === 'object', 'material dashboard must include summary.');
  assert(summary.totalCount === totalCount, 'material dashboard summary.totalCount must match page totalCount.');
  assert(Number(summary.enabledCount || 0) + Number(summary.disabledCount || 0) === Number(summary.totalCount || 0), 'material dashboard enabled/disabled counts must add up to totalCount.');
  assert(Number(summary.commonCount || 0) + Number(summary.customCount || 0) === Number(summary.totalCount || 0), 'material dashboard common/custom counts must add up to totalCount.');
  assert(Number(summary.withBomCount || 0) + Number(summary.withoutBomCount || 0) === Number(summary.totalCount || 0), 'material dashboard BOM presence counts must add up to totalCount.');
  assert(summary.relationCounts && typeof summary.relationCounts === 'object', 'material dashboard summary must include relationCounts.');
  assert(summary.bomStructureCounts && typeof summary.bomStructureCounts === 'object', 'material dashboard summary must include bomStructureCounts.');
  assert(summary.drawingSourceCounts && typeof summary.drawingSourceCounts === 'object', 'material dashboard summary must include drawingSourceCounts.');
}

function assertMaterialDashboardRow(row) {
  assert(String(row.id || '').trim(), 'material dashboard row must include id.');
  assert(String(row.partCode || '').trim(), 'material dashboard row must include partCode.');
  assert(String(row.partName || '').trim(), `material ${row.partCode || '-'} must include partName.`);
  assert(String(row.status || '').trim(), `material ${row.partCode || '-'} must include status.`);
  assert(String(row.scopeType || '').trim(), `material ${row.partCode || '-'} must include scopeType.`);
  assert(String(row.currentRelationType || '').trim(), `material ${row.partCode || '-'} must include currentRelationType.`);
  assert(String(row.customerScopeLabel || '').trim(), `material ${row.partCode || '-'} must include customerScopeLabel summary.`);
  assert(Number(row.customerNameCount || 0) >= 0, `material ${row.partCode || '-'} must include customerNameCount.`);
  assert(Number(row.bomStructureDetailCount || 0) >= 0, `material ${row.partCode || '-'} must include bomStructureDetailCount.`);
  assert(Array.isArray(row.customerNames), `material ${row.partCode || '-'} must include customerNames preview array.`);
  assert(Array.isArray(row.historyCustomerNames), `material ${row.partCode || '-'} must include historyCustomerNames preview array.`);
  assert(Array.isArray(row.projectModels), `material ${row.partCode || '-'} must include projectModels preview array.`);
  assert(Array.isArray(row.bomNames), `material ${row.partCode || '-'} must include bomNames preview array.`);
  assert(Array.isArray(row.bomStructureLabels), `material ${row.partCode || '-'} must include bomStructureLabels preview array.`);
  assert(Array.isArray(row.bomStructureDetails), `material ${row.partCode || '-'} must include bomStructureDetails preview array.`);
  assert(
    Number(row.bomStructureDetailCount || 0) >= row.bomStructureDetails.length,
    `material ${row.partCode || '-'} bomStructureDetailCount must be greater than or equal to preview length.`
  );
  assert(row.customerNames.length <= 10, `material ${row.partCode || '-'} customerNames preview must stay compact.`);
  assert(row.historyCustomerNames.length <= 10, `material ${row.partCode || '-'} historyCustomerNames preview must stay compact.`);
  assert(row.bomStructureDetails.length <= 10, `material ${row.partCode || '-'} bomStructureDetails preview must stay compact.`);
}

async function assertDashboardPage(endpoint, label, expectedLimit = 5, expectedOffset = 0) {
  const page = await readJson(endpoint);
  assertPageShape(label, page, expectedLimit, expectedOffset);
  assertSummary(page.summary, page.totalCount);
  page.items.forEach(assertMaterialDashboardRow);
  checks.push({ label, endpoint, totalCount: page.totalCount, itemCount: page.items.length });
  return page;
}

async function main() {
  const defaultPage = await assertDashboardPage('/materials/dashboard?limit=5&offset=0', 'material dashboard default page');
  assert(defaultPage.totalCount > 0, 'material dashboard default page must show business materials.');

  const enabledPage = await assertDashboardPage('/materials/dashboard?status=ENABLED&limit=5&offset=0', 'material dashboard enabled page');
  assert(enabledPage.totalCount > 0, 'material dashboard enabled page must show enabled materials.');
  assert(enabledPage.items.every((row) => row.status === 'ENABLED'), 'material dashboard enabled page must only return ENABLED rows.');

  const sampleMaterial = enabledPage.items[0];
  const keywordPage = await assertDashboardPage(
    `/materials/dashboard?keyword=${encodeURIComponent(sampleMaterial.partCode)}&limit=5&offset=0`,
    'material dashboard keyword search'
  );
  assert(
    keywordPage.items.some((row) => row.id === sampleMaterial.id),
    'material dashboard keyword search must include the selected material.'
  );

  const bomPage = await assertDashboardPage('/materials/dashboard?relationType=BOM&limit=5&offset=0', 'material dashboard BOM relation filter');
  assert(bomPage.totalCount > 0, 'material dashboard BOM relation filter must show BOM rows.');
  assert(bomPage.items.every((row) => row.currentRelationType === 'BOM'), 'material dashboard BOM relation filter must only return BOM rows.');

  const bomStructureType = bomPage.items.find((row) => Array.isArray(row.bomStructureTypes) && row.bomStructureTypes.length > 0)?.bomStructureTypes?.[0];
  if (bomStructureType) {
    const structurePage = await assertDashboardPage(
      `/materials/dashboard?bomStructureType=${encodeURIComponent(bomStructureType)}&limit=5&offset=0`,
      'material dashboard BOM structure filter'
    );
    assert(
      structurePage.items.every((row) => Array.isArray(row.bomStructureTypes) && row.bomStructureTypes.includes(bomStructureType)),
      `material dashboard BOM structure filter must only return ${bomStructureType} rows.`
    );
  }

  const projectModels = await readJson('/materials/project-models');
  assert(Array.isArray(projectModels), 'material project-models must return an array.');
  assert(projectModels.length > 0, 'material project-models must show available project models.');
  assertNoFixtureText('material project-models', projectModels);
  checks.push({ label: 'material project-models', endpoint: '/materials/project-models', count: projectModels.length });

  const commonProjectModels = await readJson('/materials/common-project-models');
  assert(Array.isArray(commonProjectModels), 'material common-project-models must return an array.');
  assert(commonProjectModels.length > 0, 'material common-project-models must show common project models.');
  assertNoFixtureText('material common-project-models', commonProjectModels);
  checks.push({ label: 'material common-project-models', endpoint: '/materials/common-project-models', count: commonProjectModels.length });

  console.log(JSON.stringify({ ok: true, apiBaseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
