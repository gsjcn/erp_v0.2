#!/usr/bin/env node

const apiBaseUrl = (
  process.env.MATERIAL_TRANSFORM_MANAGEMENT_API_BASE_URL ||
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
  assert(page && !Array.isArray(page), `${label} must return a paginated object when withPage=true.`);
  assert(Array.isArray(page.items), `${label} must return items[].`);
  assert(page.limit === expectedLimit, `${label} must echo limit=${expectedLimit}; got ${page.limit}.`);
  assert(page.offset === expectedOffset, `${label} must echo offset=${expectedOffset}; got ${page.offset}.`);
  assert(Number.isInteger(page.totalCount), `${label} must return integer totalCount.`);
  assert(typeof page.hasMore === 'boolean', `${label} must return boolean hasMore.`);
  assert(page.items.length <= expectedLimit, `${label} must not return more than limit rows.`);
  assert(page.hasMore === expectedOffset + page.items.length < page.totalCount, `${label} hasMore does not match pagination math.`);
  assertNoFixtureText(label, page);
}

function assertTransformRule(row) {
  assert(String(row.id || '').trim(), 'material transform rule row must include id.');
  assert(String(row.sourceMaterialId || '').trim(), `transform rule ${row.id || '-'} must include sourceMaterialId.`);
  assert(String(row.targetMaterialId || '').trim(), `transform rule ${row.id || '-'} must include targetMaterialId.`);
  assert(row.sourceMaterialId !== row.targetMaterialId, `transform rule ${row.id || '-'} must not use the same source and target material.`);
  assert(String(row.sourcePartCode || '').trim(), `transform rule ${row.id || '-'} must include sourcePartCode.`);
  assert(String(row.sourcePartName || '').trim(), `transform rule ${row.id || '-'} must include sourcePartName.`);
  assert(String(row.sourceUnit || '').trim(), `transform rule ${row.id || '-'} must include sourceUnit.`);
  assert(String(row.sourceMaterialStatus || '').trim(), `transform rule ${row.id || '-'} must include sourceMaterialStatus.`);
  assert(Number(row.sourceAvailableQuantity || 0) >= 0, `transform rule ${row.id || '-'} must include non-negative sourceAvailableQuantity.`);
  assert(Number(row.sourceAvailableBatchCount || 0) >= 0, `transform rule ${row.id || '-'} must include non-negative sourceAvailableBatchCount.`);
  assert(String(row.targetPartCode || '').trim(), `transform rule ${row.id || '-'} must include targetPartCode.`);
  assert(String(row.targetPartName || '').trim(), `transform rule ${row.id || '-'} must include targetPartName.`);
  assert(String(row.targetUnit || '').trim(), `transform rule ${row.id || '-'} must include targetUnit.`);
  assert(String(row.targetMaterialStatus || '').trim(), `transform rule ${row.id || '-'} must include targetMaterialStatus.`);
  assert(Number(row.targetAvailableQuantity || 0) >= 0, `transform rule ${row.id || '-'} must include non-negative targetAvailableQuantity.`);
  assert(Number(row.targetAvailableBatchCount || 0) >= 0, `transform rule ${row.id || '-'} must include non-negative targetAvailableBatchCount.`);
  assert(String(row.customerScopeKey || '').trim(), `transform rule ${row.id || '-'} must include customerScopeKey.`);
  assert(String(row.projectModelScopeKey || '').trim(), `transform rule ${row.id || '-'} must include projectModelScopeKey.`);
  assert(String(row.scopeLabel || '').trim(), `transform rule ${row.id || '-'} must include scopeLabel.`);
  assert(Number(row.multiplier || 0) > 0, `transform rule ${row.id || '-'} must include positive multiplier.`);
  assert(Number(row.lossRate || 0) >= 0, `transform rule ${row.id || '-'} must include non-negative lossRate.`);
  assert(String(row.status || '').trim(), `transform rule ${row.id || '-'} must include status.`);
}

async function assertTransformPage(endpoint, label, expectedLimit = 5, expectedOffset = 0) {
  const page = await readJson(endpoint);
  assertPageShape(label, page, expectedLimit, expectedOffset);
  page.items.forEach(assertTransformRule);
  checks.push({ label, endpoint, totalCount: page.totalCount, itemCount: page.items.length });
  return page;
}

async function main() {
  const defaultPage = await assertTransformPage(
    '/inventory/material-transform-rules?status=ALL&withPage=true&limit=5&offset=0',
    'material transform default page'
  );
  assert(defaultPage.totalCount > 0, 'material transform default page must show source processing relation rows.');

  const enabledPage = await assertTransformPage(
    '/inventory/material-transform-rules?status=ENABLED&withPage=true&limit=5&offset=0',
    'material transform enabled page'
  );
  assert(enabledPage.totalCount > 0, 'material transform enabled page must show enabled source processing relation rows.');
  assert(enabledPage.items.every((row) => row.status === 'ENABLED'), 'material transform enabled page must only return ENABLED rows.');
  assert(enabledPage.items.every((row) => row.sourceMaterialStatus === 'ENABLED' && row.targetMaterialStatus === 'ENABLED'), 'enabled transform rules must reference enabled source and target materials.');

  const sampleRule = enabledPage.items[0];

  const keywordPage = await assertTransformPage(
    `/inventory/material-transform-rules?keyword=${encodeURIComponent(sampleRule.sourcePartCode)}&status=ALL&withPage=true&limit=5&offset=0`,
    'material transform keyword search'
  );
  assert(keywordPage.items.some((row) => row.id === sampleRule.id), 'material transform keyword search must include the selected rule.');

  const sourceCodePage = await assertTransformPage(
    `/inventory/material-transform-rules?sourcePartCode=${encodeURIComponent(sampleRule.sourcePartCode.toLowerCase())}&status=ALL&withPage=true&limit=5&offset=0`,
    'material transform sourcePartCode filter'
  );
  assert(
    sourceCodePage.items.every((row) => row.sourcePartCode === sampleRule.sourcePartCode),
    'material transform sourcePartCode filter must be case-insensitive and exact.'
  );

  const targetCodePage = await assertTransformPage(
    `/inventory/material-transform-rules?targetPartCode=${encodeURIComponent(sampleRule.targetPartCode.toLowerCase())}&status=ALL&withPage=true&limit=5&offset=0`,
    'material transform targetPartCode filter'
  );
  assert(
    targetCodePage.items.every((row) => row.targetPartCode === sampleRule.targetPartCode),
    'material transform targetPartCode filter must be case-insensitive and exact.'
  );

  if (sampleRule.customerId) {
    const customerPage = await assertTransformPage(
      `/inventory/material-transform-rules?customerId=${encodeURIComponent(sampleRule.customerId)}&status=ALL&withPage=true&limit=5&offset=0`,
      'material transform customer filter'
    );
    assert(
      customerPage.items.every((row) => row.customerId === sampleRule.customerId),
      'material transform customer filter must only return selected customer rows.'
    );
  }

  if (sampleRule.projectModel) {
    const projectPage = await assertTransformPage(
      `/inventory/material-transform-rules?projectModel=${encodeURIComponent(sampleRule.projectModel)}&status=ALL&withPage=true&limit=5&offset=0`,
      'material transform projectModel filter'
    );
    assert(
      projectPage.items.every((row) => row.projectModel === sampleRule.projectModel),
      'material transform projectModel filter must only return selected model/project rows.'
    );
  }

  const sourceStockPage = await assertTransformPage(
    '/inventory/material-transform-rules?sourceStockStatus=WITH_STOCK&status=ALL&withPage=true&limit=5&offset=0',
    'material transform source stock filter'
  );
  assert(
    sourceStockPage.items.every((row) => row.sourceAvailableQuantity > 0),
    'material transform sourceStockStatus=WITH_STOCK must only return rows with source stock.'
  );

  const targetNoStockPage = await assertTransformPage(
    '/inventory/material-transform-rules?targetStockStatus=NO_STOCK&status=ALL&withPage=true&limit=5&offset=0',
    'material transform target no-stock filter'
  );
  assert(
    targetNoStockPage.items.every((row) => row.targetAvailableQuantity <= 0),
    'material transform targetStockStatus=NO_STOCK must only return rows without target stock.'
  );

  const sourceReworkPage = await assertTransformPage(
    '/inventory/material-transform-rules?inventoryDecision=SOURCE_REWORK&status=ALL&withPage=true&limit=5&offset=0',
    'material transform source rework decision filter'
  );
  assert(
    sourceReworkPage.items.every((row) => row.targetAvailableQuantity <= 0 && row.sourceAvailableQuantity > 0),
    'material transform inventoryDecision=SOURCE_REWORK must only suggest source rework rows.'
  );

  console.log(JSON.stringify({ ok: true, apiBaseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
