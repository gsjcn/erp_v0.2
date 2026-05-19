#!/usr/bin/env node

const apiBaseUrl = (
  process.env.INVENTORY_SUMMARY_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNumberEqual(actual, expected, label) {
  assert(Number(actual) === expected, `${label} expected ${expected}, actual ${actual}`);
}

function assertFiniteNumber(value, label) {
  assert(typeof value === 'number' && Number.isFinite(value), `${label} must be a finite number`);
}

function assertNonNegativeNumber(value, label) {
  assertFiniteNumber(value, label);
  assert(value >= 0, `${label} must be non-negative`);
}

function startsWithTestFixturePrefix(value) {
  if (value === null || value === undefined) {
    return false;
  }
  const text = String(value).trim();
  return testFixturePrefixes.some((prefix) => text.startsWith(prefix));
}

function collectPotentialFixtureStrings(value, results = []) {
  if (value === null || value === undefined) {
    return results;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    results.push(String(value));
    return results;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPotentialFixtureStrings(item, results);
    }
    return results;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectPotentialFixtureStrings(item, results);
    }
  }
  return results;
}

function assertNoTestFixtureRows(rows, label) {
  for (const row of rows) {
    const fixtureValue = collectPotentialFixtureStrings(row).find(startsWithTestFixturePrefix);
    assert(!fixtureValue, `${label} must hide reusable test fixture value ${fixtureValue}`);
  }
}

async function requestJson(path, options = {}) {
  const headers = {
    ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && body.message ? body.message : text;
    throw new Error(`${response.status} ${response.statusText}: ${Array.isArray(message) ? message.join('; ') : message}`);
  }
  return body;
}

function assertSummaryRowRelationships(row) {
  for (const field of [
    'batchCount',
    'warehouseCount',
    'physicalQuantity',
    'reservedQuantity',
    'availableQuantity',
    'usedQuantity',
    'totalQuantity',
    'orderInventoryQuantity',
    'stockInventoryQuantity',
    'normalOrderStockQuantity',
    'cancelledOrderStockQuantity',
    'customerChangeStockQuantity'
  ]) {
    assertNonNegativeNumber(row[field], `${row.partCode}.${field}`);
  }
  assert(row.partCode && typeof row.partCode === 'string', 'summary row must include partCode');
  assert(row.partName && typeof row.partName === 'string', `${row.partCode}.partName must be present`);
  assert(row.unit && typeof row.unit === 'string', `${row.partCode}.unit must be present`);
  assert(Array.isArray(row.warehouses), `${row.partCode}.warehouses must be an array`);
  assertNumberEqual(row.totalQuantity, row.physicalQuantity, `${row.partCode}.totalQuantity`);
  assert(row.physicalQuantity >= row.reservedQuantity, `${row.partCode}.physicalQuantity must cover reservedQuantity`);
  assertNumberEqual(row.availableQuantity, row.physicalQuantity - row.reservedQuantity, `${row.partCode}.availableQuantity`);
  assertNumberEqual(
    row.stockInventoryQuantity,
    row.normalOrderStockQuantity + row.cancelledOrderStockQuantity + row.customerChangeStockQuantity,
    `${row.partCode}.stockInventoryQuantity`
  );
  assertNumberEqual(row.availableQuantity, row.orderInventoryQuantity + row.stockInventoryQuantity, `${row.partCode}.availableQuantity split`);
  assertNumberEqual(row.warehouseCount, row.warehouses.length, `${row.partCode}.warehouseCount`);
  const warehouseBatchCount = row.warehouses.reduce((sum, warehouse) => {
    assertNonNegativeNumber(warehouse.reservedQuantity, `${row.partCode}.${warehouse.warehouseName}.reservedQuantity`);
    assertNonNegativeNumber(warehouse.availableQuantity, `${row.partCode}.${warehouse.warehouseName}.availableQuantity`);
    assertNonNegativeNumber(warehouse.batchCount, `${row.partCode}.${warehouse.warehouseName}.batchCount`);
    return sum + warehouse.batchCount;
  }, 0);
  assertNumberEqual(warehouseBatchCount, row.batchCount, `${row.partCode}.warehouse batchCount`);

  if (row.stockAlertEnabled) {
    assertFiniteNumber(row.stockAlertQuantity, `${row.partCode}.stockAlertQuantity`);
    assert(
      row.stockAlertTriggered === (row.availableQuantity <= row.stockAlertQuantity),
      `${row.partCode}.stockAlertTriggered must follow availableQuantity <= stockAlertQuantity`
    );
  } else {
    assert(row.stockAlertTriggered === false, `${row.partCode}.stockAlertTriggered must be false when disabled`);
  }
}

function assertSourceDetailsRelationships(details) {
  assert(details.partCode && typeof details.partCode === 'string', 'source details must include partCode');
  assert(details.unit && typeof details.unit === 'string', `${details.partCode}.unit must be present`);
  assertNonNegativeNumber(details.availableQuantity, `${details.partCode}.availableQuantity`);
  assertNonNegativeNumber(details.batchCount, `${details.partCode}.batchCount`);
  assertNonNegativeNumber(details.orderSourceCount, `${details.partCode}.orderSourceCount`);
  assertNonNegativeNumber(details.stockSourceCount, `${details.partCode}.stockSourceCount`);
  assert(Array.isArray(details.sources), `${details.partCode}.sources must be an array`);
  assertNumberEqual(details.batchCount, details.orderSourceCount + details.stockSourceCount, `${details.partCode}.source count split`);
  const availableFromSources = details.sources.reduce((sum, source) => {
    assert(source.batchNo && typeof source.batchNo === 'string', `${details.partCode}.source.batchNo must be present`);
    assertNonNegativeNumber(source.quantity, `${source.batchNo}.quantity`);
    assertNonNegativeNumber(source.physicalQuantity, `${source.batchNo}.physicalQuantity`);
    assertNonNegativeNumber(source.reservedQuantity, `${source.batchNo}.reservedQuantity`);
    assertNumberEqual(source.quantity, source.physicalQuantity - source.reservedQuantity, `${source.batchNo}.quantity`);
    assert(Array.isArray(source.reservations), `${source.batchNo}.reservations must be an array`);
    for (const reservation of source.reservations) {
      assert(reservation.orderNo && typeof reservation.orderNo === 'string', `${source.batchNo}.reservation.orderNo must be present`);
      assertNonNegativeNumber(reservation.quantity, `${source.batchNo}.${reservation.orderNo}.reservation.quantity`);
    }
    return sum + source.quantity;
  }, 0);
  if (!Object.prototype.hasOwnProperty.call(details, 'totalSourceCount')) {
    assertNumberEqual(details.sources.length, details.batchCount, `${details.partCode}.legacy source count`);
    assertNumberEqual(availableFromSources, details.availableQuantity, `${details.partCode}.legacy availableQuantity`);
  }
}

function assertPagedObject(page, label) {
  assert(page && typeof page === 'object' && !Array.isArray(page), `${label} must be an explicit paged object`);
  assert(Array.isArray(page.items), `${label}.items must be an array`);
  assertNonNegativeNumber(page.totalCount, `${label}.totalCount`);
  assertNonNegativeNumber(page.limit, `${label}.limit`);
  assertNonNegativeNumber(page.offset, `${label}.offset`);
  assert(typeof page.hasMore === 'boolean', `${label}.hasMore must be a boolean`);
  assert(page.items.length <= page.limit, `${label}.items must respect limit`);
  assert(page.hasMore === page.offset + page.items.length < page.totalCount, `${label}.hasMore must match paging metadata`);
}

function findSummaryRowForSourceDetails(rows) {
  return (
    rows.find((row) => row.reservedQuantity > 0 && row.batchCount > 0) ||
    rows.find((row) => row.batchCount > 1) ||
    rows.find((row) => row.batchCount > 0)
  );
}

async function assertInventorySummaryReadOnly() {
  const summaryRows = await requestJson('/inventory/summary?status=AVAILABLE&stockAlert=ALL');
  assert(Array.isArray(summaryRows), 'inventory summary response must be an array');
  assert(summaryRows.length > 0, 'inventory summary read-only regression requires business inventory baseline rows');
  assertNoTestFixtureRows(summaryRows, 'inventory summary default response');
  for (const row of summaryRows) {
    assertSummaryRowRelationships(row);
  }

  const summaryWithFixtures = await requestJson('/inventory/summary?status=AVAILABLE&stockAlert=ALL&includeTestFixtures=true');
  assert(Array.isArray(summaryWithFixtures), 'inventory summary includeTestFixtures response must be an array');
  assert(summaryWithFixtures.length >= summaryRows.length, 'inventory summary includeTestFixtures must not hide business rows');

  const summaryPage = await requestJson('/inventory/summary?status=AVAILABLE&stockAlert=ALL&withPage=true&limit=3&offset=0');
  assertPagedObject(summaryPage, 'paged inventory summary');
  assertNumberEqual(summaryPage.totalCount, summaryRows.length, 'paged inventory summary totalCount');
  for (const row of summaryPage.items) {
    assertSummaryRowRelationships(row);
  }
  const summaryLastPage = await requestJson(
    `/inventory/summary?status=AVAILABLE&stockAlert=ALL&withPage=true&limit=1&offset=${Math.max(summaryPage.totalCount - 1, 0)}`
  );
  assertPagedObject(summaryLastPage, 'paged inventory summary last page');
  assertNumberEqual(summaryLastPage.totalCount, summaryRows.length, 'paged inventory summary last page totalCount');
  assert(summaryLastPage.hasMore === false, 'paged inventory summary last page should not have more rows');

  return summaryRows;
}

async function assertInventoryStockAlertFilters() {
  const triggeredRows = await requestJson('/inventory/summary?status=AVAILABLE&stockAlert=TRIGGERED');
  assert(Array.isArray(triggeredRows), 'stockAlert=TRIGGERED response must be an array');
  assert(triggeredRows.length > 0, 'inventory summary stock alert regression requires at least one triggered row');
  for (const row of triggeredRows) {
    assertSummaryRowRelationships(row);
    assert(row.stockAlertEnabled === true, `${row.partCode} must have stock alert enabled`);
    assert(row.stockAlertTriggered === true, `${row.partCode} must be triggered`);
  }

  const disabledRows = await requestJson('/inventory/summary?status=AVAILABLE&stockAlert=DISABLED');
  assert(Array.isArray(disabledRows), 'stockAlert=DISABLED response must be an array');
  for (const row of disabledRows) {
    assertSummaryRowRelationships(row);
    assert(row.stockAlertEnabled === false, `${row.partCode} must have stock alert disabled`);
    assert(row.stockAlertTriggered === false, `${row.partCode} must not be triggered`);
  }

  const zeroStockAlertRow = triggeredRows.find((row) => row.batchCount === 0 && row.stockAlertTriggered);
  if (zeroStockAlertRow) {
    assertNumberEqual(zeroStockAlertRow.availableQuantity, 0, 'zero stock availableQuantity');
    assertNumberEqual(zeroStockAlertRow.physicalQuantity, 0, 'zero stock physicalQuantity');
    assert(zeroStockAlertRow.stockAlertQuantity > 0, 'zero stock alert row should keep positive threshold');
  }
  return { zeroStockAlertChecked: Boolean(zeroStockAlertRow) };
}

async function assertInventoryBatchPagination(sourceRow) {
  const keyword = encodeURIComponent(sourceRow.partCode);
  const publicBatchPage = await requestJson(`/inventory?keyword=${keyword}&status=AVAILABLE&stockAlert=ALL&limit=2&offset=0`);
  assertPagedObject(publicBatchPage, 'public inventory batch response');
  assert(publicBatchPage.totalCount >= publicBatchPage.items.length, 'public inventory totalCount must cover items');
  assertNoTestFixtureRows(publicBatchPage.items, 'public inventory batch response');

  const batchPage = await requestJson(`/inventory?keyword=${keyword}&status=AVAILABLE&stockAlert=ALL&withPage=true&limit=2&offset=0`);
  assertPagedObject(batchPage, 'paged inventory batch response');
  assertNumberEqual(batchPage.totalCount, publicBatchPage.totalCount, 'paged inventory totalCount');
  assertNumberEqual(batchPage.limit, 2, 'paged inventory limit');
  assertNumberEqual(batchPage.offset, 0, 'paged inventory offset');
  assertNoTestFixtureRows(batchPage.items, 'paged inventory batch response');

  const batchLastPage = await requestJson(
    `/inventory?keyword=${keyword}&status=AVAILABLE&stockAlert=ALL&withPage=true&limit=1&offset=${Math.max(batchPage.totalCount - 1, 0)}`
  );
  assertPagedObject(batchLastPage, 'paged inventory batch last page');
  assertNumberEqual(batchLastPage.totalCount, batchPage.totalCount, 'paged inventory last page totalCount');
  assert(batchLastPage.hasMore === false, 'paged inventory last page should not have more rows');
}

async function assertInventorySourceDetails(sourceRow) {
  const keyword = encodeURIComponent(sourceRow.partCode);
  const legacySourceDetails = await requestJson(`/inventory/materials/${keyword}/source-details?sourceType=ALL`);
  assertSourceDetailsRelationships(legacySourceDetails);
  assertNoTestFixtureRows(legacySourceDetails.sources, 'legacy inventory source-details response');
  assert(!Object.prototype.hasOwnProperty.call(legacySourceDetails, 'totalSourceCount'), 'legacy inventory source-details should not expose paging metadata');

  const sourceDetailsPage = await requestJson(`/inventory/materials/${keyword}/source-details?sourceType=ALL&withPage=true&limit=2&offset=0`);
  assertSourceDetailsRelationships(sourceDetailsPage);
  assertNoTestFixtureRows(sourceDetailsPage.sources, 'paged inventory source-details response');
  assertNumberEqual(sourceDetailsPage.totalSourceCount, legacySourceDetails.batchCount, 'paged inventory source-details totalSourceCount');
  assertNumberEqual(sourceDetailsPage.sourceLimit, 2, 'paged inventory source-details sourceLimit');
  assertNumberEqual(sourceDetailsPage.sourceOffset, 0, 'paged inventory source-details sourceOffset');
  assert(sourceDetailsPage.sources.length <= sourceDetailsPage.sourceLimit, 'paged inventory source-details must respect sourceLimit');
  assert(
    sourceDetailsPage.sourceHasMore === sourceDetailsPage.sourceOffset + sourceDetailsPage.sources.length < sourceDetailsPage.totalSourceCount,
    'paged inventory source-details sourceHasMore must match paging metadata'
  );
  assertNumberEqual(sourceDetailsPage.batchCount, legacySourceDetails.batchCount, 'paged inventory source-details batchCount should keep full count');

  const sourceDetailsLastPage = await requestJson(
    `/inventory/materials/${keyword}/source-details?sourceType=ALL&withPage=true&limit=1&offset=${Math.max(sourceDetailsPage.totalSourceCount - 1, 0)}`
  );
  assertSourceDetailsRelationships(sourceDetailsLastPage);
  assertNumberEqual(sourceDetailsLastPage.totalSourceCount, sourceDetailsPage.totalSourceCount, 'paged inventory source-details last page totalSourceCount');
  assert(sourceDetailsLastPage.sourceHasMore === false, 'paged inventory source-details last page should not have more rows');

  return legacySourceDetails;
}

async function assertActiveReservationReadOnly(sourceRow, sourceDetails) {
  if (sourceRow.reservedQuantity <= 0) {
    return false;
  }
  const reservedSource = sourceDetails.sources.find((source) => source.reservations.length > 0);
  const reservedOrderNo = reservedSource?.reservations?.[0]?.orderNo;
  if (!reservedOrderNo) {
    return false;
  }
  const currentOrderRows = await requestJson(
    `/inventory/summary?keyword=${encodeURIComponent(sourceRow.partCode)}&status=AVAILABLE&stockAlert=ALL&excludeOrderNo=${encodeURIComponent(reservedOrderNo)}`
  );
  assert(Array.isArray(currentOrderRows), 'current order inventory summary response must be an array');
  const currentOrderRow = currentOrderRows.find((row) => row.partCode === sourceRow.partCode);
  assert(currentOrderRow, `current order summary should include ${sourceRow.partCode}`);
  assertSummaryRowRelationships(currentOrderRow);
  assert(
    currentOrderRow.reservedQuantity <= sourceRow.reservedQuantity,
    'excludeOrderNo should not increase active reserved quantity for the same part'
  );
  assert(
    currentOrderRow.availableQuantity >= sourceRow.availableQuantity,
    'excludeOrderNo should not reduce available quantity for the same part'
  );
  return true;
}

async function main() {
  const summaryRows = await assertInventorySummaryReadOnly();
  const sourceRow = findSummaryRowForSourceDetails(summaryRows);
  assert(sourceRow, 'inventory source-details regression requires at least one available inventory batch');

  const stockAlertResult = await assertInventoryStockAlertFilters();
  await assertInventoryBatchPagination(sourceRow);
  const sourceDetails = await assertInventorySourceDetails(sourceRow);
  const activeReservationChecked = await assertActiveReservationReadOnly(sourceRow, sourceDetails);

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        samplePartCode: sourceRow.partCode,
        activeReservationChecked,
        zeroStockAlertChecked: stockAlertResult.zeroStockAlertChecked,
        checked: [
          'inventory-summary-read-only',
          'inventory-summary-source-split-read-only',
          'inventory-summary-test-fixture-filter',
          'inventory-summary-active-reservation-read-only',
          'inventory-summary-current-order-priority-read-only',
          'inventory-summary-explicit-pagination',
          'inventory-batch-public-list-pagination',
          'inventory-batch-explicit-pagination',
          'inventory-source-details-test-fixture-filter',
          'inventory-source-details-legacy-response',
          'inventory-source-details-explicit-pagination',
          'inventory-summary-stock-alert-filter',
          'inventory-summary-zero-stock-alert'
        ]
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
