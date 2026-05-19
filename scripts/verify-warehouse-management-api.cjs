#!/usr/bin/env node

const apiBaseUrl = (
  process.env.WAREHOUSE_MANAGEMENT_API_BASE_URL ||
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

function textContainsFixturePrefix(value) {
  const text = JSON.stringify(value || {});
  return fixturePrefixes.find((prefix) => text.includes(prefix));
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
  checks.push({ label, endpoint, totalCount: page.totalCount, itemCount: page.items.length });
}

function assertWarehouseList(label, endpoint, rows, minimumTotal = 1) {
  assert(Array.isArray(rows), `${label} must return a warehouse array.`);
  assert(rows.length >= minimumTotal, `${label} must contain at least ${minimumTotal} warehouse rows; got ${rows.length}.`);
  const fixturePrefix = textContainsFixturePrefix(rows);
  assert(!fixturePrefix, `${label} must hide reusable test fixture prefix ${fixturePrefix} by default.`);
  checks.push({ label, endpoint, totalCount: rows.length });
}

function assertEnabledWarehouseWithLocation(rows) {
  assert(
    rows.some(
      (warehouse) =>
        warehouse.status === 'ENABLED' &&
        Array.isArray(warehouse.locations) &&
        warehouse.locations.some((location) => location.status === 'ENABLED')
    ),
    'warehouse management default config must include at least one enabled warehouse with an enabled location.'
  );
}

function assertWarehouseWorkRows(label, endpoint, rows, minimumTotal = 0) {
  assert(Array.isArray(rows), `${label} must return an array.`);
  assert(rows.length >= minimumTotal, `${label} must contain at least ${minimumTotal} business rows; got ${rows.length}.`);
  const fixturePrefix = textContainsFixturePrefix(rows);
  assert(!fixturePrefix, `${label} must hide reusable test fixture prefix ${fixturePrefix} by default.`);
  if (rows.length > 0) {
    const row = rows[0];
    assert(String(row.orderNo || '').trim(), `${label} row must include orderNo.`);
    assert(String(row.customerName || '').trim(), `${label} row must include customerName.`);
    assert(String(row.partCode || '').trim(), `${label} row must include partCode.`);
    assert(String(row.partName || '').trim(), `${label} row must include partName.`);
    assert(Number(row.quantity ?? row.suggestedShipmentQuantity ?? row.orderReceiptQuantity ?? 0) >= 0, `${label} row must include quantity.`);
  }
  checks.push({ label, endpoint, totalCount: rows.length });
}

function assertTransactionRow(row) {
  assert(String(row.transactionNo || '').trim(), 'warehouse transaction row must include transactionNo.');
  assert(String(row.transactionType || '').trim(), `warehouse transaction ${row.transactionNo || '-'} must include transactionType.`);
  assert(String(row.partCode || '').trim(), `warehouse transaction ${row.transactionNo || '-'} must include partCode.`);
  assert(String(row.partName || '').trim(), `warehouse transaction ${row.transactionNo || '-'} must include partName.`);
  assert(String(row.warehouseName || '').trim(), `warehouse transaction ${row.transactionNo || '-'} must include warehouseName.`);
  assert(Number(row.quantity || 0) > 0, `warehouse transaction ${row.transactionNo || '-'} must include quantity > 0.`);
}

async function main() {
  const allWarehousesEndpoint = '/warehouses?status=ALL&locationStatus=ALL';
  const allWarehouses = await readJson(allWarehousesEndpoint);
  assertWarehouseList('warehouse config default list', allWarehousesEndpoint, allWarehouses, 1);
  assertEnabledWarehouseWithLocation(allWarehouses);

  const enabledWarehousesEndpoint = '/warehouses?status=ENABLED&locationStatus=ENABLED';
  const enabledWarehouses = await readJson(enabledWarehousesEndpoint);
  assertWarehouseList('warehouse config enabled list', enabledWarehousesEndpoint, enabledWarehouses, 1);
  assertEnabledWarehouseWithLocation(enabledWarehouses);

  const pendingReceiptsEndpoint = '/warehouse/receipts/pending';
  const pendingReceipts = await readJson(pendingReceiptsEndpoint);
  assertWarehouseWorkRows('warehouse pending receipts', pendingReceiptsEndpoint, pendingReceipts, 0);

  const pendingShipmentsEndpoint = '/warehouse/shipments/pending';
  const pendingShipments = await readJson(pendingShipmentsEndpoint);
  assertWarehouseWorkRows('warehouse pending shipments', pendingShipmentsEndpoint, pendingShipments, 1);

  const transactionsEndpoint = '/warehouse/transactions?limit=5&offset=0';
  const transactionsPage = await readJson(transactionsEndpoint);
  assertPageShape('warehouse transactions', transactionsEndpoint, transactionsPage);
  assert(transactionsPage.totalCount > 0, 'warehouse management transactions must show inventory movement rows.');
  if (transactionsPage.items.length > 0) {
    assertTransactionRow(transactionsPage.items[0]);
  }

  const noticesEndpoint = '/warehouse/notices?limit=5&offset=0';
  const noticesPage = await readJson(noticesEndpoint);
  assertPageShape('warehouse notices', noticesEndpoint, noticesPage);

  console.log(JSON.stringify({ ok: true, apiBaseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
