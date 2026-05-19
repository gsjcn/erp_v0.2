#!/usr/bin/env node

const apiBaseUrl = (
  process.env.INVENTORY_MANAGEMENT_API_BASE_URL ||
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

function assertPageShape(label, endpoint, page, expectedLimit = 5, expectedOffset = 0) {
  assert(page && !Array.isArray(page), `${label} must return a paginated object.`);
  assert(Array.isArray(page.items), `${label} must return items[].`);
  assert(page.limit === expectedLimit, `${label} must echo limit=${expectedLimit}; got ${page.limit}.`);
  assert(page.offset === expectedOffset, `${label} must echo offset=${expectedOffset}; got ${page.offset}.`);
  assert(Number.isInteger(page.totalCount), `${label} must return integer totalCount.`);
  assert(typeof page.hasMore === 'boolean', `${label} must return boolean hasMore.`);
  assert(page.items.length <= expectedLimit, `${label} must not return more than limit rows.`);
  assert(
    page.hasMore === expectedOffset + page.items.length < page.totalCount,
    `${label} hasMore does not match pagination math.`
  );
  assertNoFixtureText(label, page);
  checks.push({ label, endpoint, totalCount: page.totalCount, itemCount: page.items.length });
}

function assertSummaryRow(row) {
  assert(String(row.partCode || '').trim(), 'inventory summary row must include partCode.');
  assert(String(row.partName || '').trim(), `inventory summary ${row.partCode || '-'} must include partName.`);
  assert(String(row.unit || '').trim(), `inventory summary ${row.partCode || '-'} must include unit.`);
  assert(Number(row.batchCount || 0) >= 0, `inventory summary ${row.partCode || '-'} must include batchCount.`);
  assert(Number(row.warehouseCount || 0) >= 0, `inventory summary ${row.partCode || '-'} must include warehouseCount.`);
  assert(Number(row.physicalQuantity || 0) >= 0, `inventory summary ${row.partCode || '-'} must include physicalQuantity.`);
  assert(Number(row.availableQuantity || 0) >= 0, `inventory summary ${row.partCode || '-'} must include availableQuantity.`);
  assert(Number(row.reservedQuantity || 0) >= 0, `inventory summary ${row.partCode || '-'} must include reservedQuantity.`);
  assert(
    Number(row.orderInventoryQuantity || 0) + Number(row.stockInventoryQuantity || 0) === Number(row.availableQuantity || 0),
    `inventory summary ${row.partCode || '-'} availableQuantity must equal orderInventoryQuantity + stockInventoryQuantity.`
  );
}

function assertBatchRow(row) {
  assert(String(row.batchNo || '').trim(), 'inventory batch row must include batchNo.');
  assert(String(row.partCode || '').trim(), `inventory batch ${row.batchNo || '-'} must include partCode.`);
  assert(String(row.partName || '').trim(), `inventory batch ${row.batchNo || '-'} must include partName.`);
  assert(String(row.unit || '').trim(), `inventory batch ${row.batchNo || '-'} must include unit.`);
  assert(String(row.warehouseName || '').trim(), `inventory batch ${row.batchNo || '-'} must include warehouseName.`);
  assert(Number(row.quantity || 0) >= 0, `inventory batch ${row.batchNo || '-'} must include quantity.`);
  assert(Number(row.physicalQuantity || 0) >= 0, `inventory batch ${row.batchNo || '-'} must include physicalQuantity.`);
  assert(Number(row.availableQuantity || 0) >= 0, `inventory batch ${row.batchNo || '-'} must include availableQuantity.`);
}

function assertMaterialRow(row) {
  assert(String(row.id || '').trim(), 'inventory material row must include id.');
  assert(String(row.partCode || '').trim(), 'inventory material row must include partCode.');
  assert(String(row.partName || '').trim(), `inventory material ${row.partCode || '-'} must include partName.`);
  assert(String(row.unit || '').trim(), `inventory material ${row.partCode || '-'} must include unit.`);
  assert(String(row.status || '').trim(), `inventory material ${row.partCode || '-'} must include status.`);
  assert(Number(row.availableQuantity || 0) >= 0, `inventory material ${row.partCode || '-'} must include availableQuantity.`);
}

async function main() {
  const summaryEndpoint = '/inventory/summary?status=AVAILABLE&stockAlert=ALL&withPage=true&limit=5&offset=0';
  const summaryPage = await readJson(summaryEndpoint);
  assertPageShape('inventory summary page', summaryEndpoint, summaryPage);
  assert(summaryPage.totalCount > 0, 'inventory summary page must show current InventoryBatch-derived rows.');
  if (summaryPage.items.length > 0) {
    assertSummaryRow(summaryPage.items[0]);
  }

  const batchEndpoint = '/inventory?status=AVAILABLE&stockAlert=ALL&limit=5&offset=0';
  const batchPage = await readJson(batchEndpoint);
  assertPageShape('inventory batch page', batchEndpoint, batchPage);
  assert(batchPage.totalCount > 0, 'inventory batch page must show inventory batch rows.');
  if (batchPage.items.length > 0) {
    assertBatchRow(batchPage.items[0]);
  }

  const materialsEndpoint = '/inventory/materials?status=ENABLED&stockAlert=ALL&limit=5&offset=0';
  const materialsPage = await readJson(materialsEndpoint);
  assertPageShape('inventory materials page', materialsEndpoint, materialsPage);
  assert(materialsPage.totalCount > 0, 'inventory materials page must show material memory rows.');
  if (materialsPage.items.length > 0) {
    assertMaterialRow(materialsPage.items[0]);
  }

  const sourcePart = summaryPage.items.find((row) => Number(row.availableQuantity || 0) > 0)?.partCode || summaryPage.items[0]?.partCode;
  assert(sourcePart, 'inventory source-details verification needs a visible summary partCode.');
  const sourceEndpoint = `/inventory/materials/${encodeURIComponent(sourcePart)}/source-details?sourceType=ALL&withPage=true&limit=5&offset=0`;
  const sourceDetails = await readJson(sourceEndpoint);
  assert(Array.isArray(sourceDetails.sources), 'inventory source-details must return sources[].');
  assert(Number.isInteger(sourceDetails.totalSourceCount), 'inventory source-details must return totalSourceCount when withPage=true.');
  assert(sourceDetails.sourceLimit === 5, 'inventory source-details must echo sourceLimit=5.');
  assert(sourceDetails.sourceOffset === 0, 'inventory source-details must echo sourceOffset=0.');
  assert(typeof sourceDetails.sourceHasMore === 'boolean', 'inventory source-details must return sourceHasMore.');
  assert(
    sourceDetails.sourceHasMore === sourceDetails.sourceOffset + sourceDetails.sources.length < sourceDetails.totalSourceCount,
    'inventory source-details sourceHasMore does not match pagination math.'
  );
  assert(Number(sourceDetails.availableQuantity || 0) >= 0, 'inventory source-details must include availableQuantity.');
  assert(Number(sourceDetails.batchCount || 0) >= 0, 'inventory source-details must include batchCount.');
  assert(sourceDetails.sources.length <= 5, 'inventory source-details must not return more than limit rows.');
  assertNoFixtureText('inventory source-details', sourceDetails);
  if (sourceDetails.sources.length > 0) {
    assertBatchRow(sourceDetails.sources[0]);
  }
  checks.push({
    label: 'inventory source-details',
    endpoint: sourceEndpoint,
    totalSourceCount: sourceDetails.totalSourceCount,
    itemCount: sourceDetails.sources.length,
    availableQuantity: sourceDetails.availableQuantity
  });

  console.log(JSON.stringify({ ok: true, apiBaseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
