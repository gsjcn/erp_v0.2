#!/usr/bin/env node

const apiBaseUrl = (
  process.env.BUSINESS_DATA_BASELINE_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const failures = [];
const checks = [];
const coveredModules = new Set();

function addFailure(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) {
    addFailure(message);
  }
}

function totalCountOf(data) {
  if (typeof data?.totalCount === 'number') {
    return data.totalCount;
  }
  if (typeof data?.total === 'number') {
    return data.total;
  }
  if (Array.isArray(data)) {
    return data.length;
  }
  return 0;
}

function addCheck(row) {
  checks.push(row);
  if (row.module) {
    coveredModules.add(row.module);
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

async function runBaselineCheck(label, action) {
  try {
    await action();
  } catch (error) {
    addFailure(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkPage(label, endpoint, minimumTotal, extraCheck = () => {}) {
  const data = await readJson(endpoint);
  const totalCount = totalCountOf(data);
  assert(
    totalCount >= minimumTotal,
    `${label} should contain at least ${minimumTotal} business rows; got ${totalCount}. Run npm run backend:db:seed or inspect business fixture filters.`
  );
  await extraCheck(data, totalCount);
  addCheck({ label, endpoint, totalCount, module: label });
}

async function main() {
  let currentBusinessYear = new Date().getFullYear();

  await runBaselineCheck('API health', async () => {
    const health = await readJson('/health');
    assert(health.status === 'ok', `API health status should be ok; got ${health.status || '-'}.`);
    assert(health.database === 'ok', `API health database should be ok; got ${health.database || '-'}.`);
    addCheck({ label: 'API health', endpoint: '/health', status: health.status, database: health.database, module: 'health' });
  });

  await runBaselineCheck('statistics options', async () => {
    const options = await readJson('/statistics/options');
    currentBusinessYear = Number(options.currentBusinessYear || currentBusinessYear);
    assert(Array.isArray(options.years) && options.years.length > 0, 'statistics/options should expose at least one business year.');
    assert(
      Array.isArray(options.years) && options.years.includes(currentBusinessYear),
      `statistics/options should include current business year ${currentBusinessYear}.`
    );
    addCheck({ label: 'statistics options', endpoint: '/statistics/options', years: options.years, module: 'statistics' });
  });

  await runBaselineCheck('customers baseline', () => checkPage('customers', '/customers?limit=1&offset=0', 3));
  await runBaselineCheck('orders baseline', () => checkPage('orders', '/orders?limit=1&offset=0', 5));
  await runBaselineCheck('materials dashboard baseline', () =>
    checkPage('materials dashboard', '/materials/dashboard?limit=1&offset=0', 10, (data) => {
      assert(
        Number(data?.summary?.withBomCount || 0) > 0,
        'materials dashboard should include BOM-related materials; got withBomCount=0.'
      );
      assert(
        Number(data?.summary?.relationCounts?.ORDER_HISTORY || 0) > 0,
        'materials dashboard should include order-history materials; got ORDER_HISTORY=0.'
      );
    })
  );
  await runBaselineCheck('inventory materials baseline', () => checkPage('inventory materials', '/inventory/materials?limit=1&offset=0', 5));
  await runBaselineCheck('model BOM baseline', () => checkPage('model BOMs', '/inventory/model-boms?status=ALL&limit=1&offset=0', 1));
  await runBaselineCheck('production tasks baseline', () => checkPage('production tasks', '/production/tasks?limit=1&offset=0', 1));
  await runBaselineCheck('production order summaries baseline', () =>
    checkPage('production order summaries', '/production/tasks/order-summary?limit=1&offset=0', 1)
  );
  await runBaselineCheck('warehouse transactions baseline', () => checkPage('warehouse transactions', '/warehouse/transactions?limit=1&offset=0', 1));
  await runBaselineCheck('inventory summary baseline', () => checkPage('inventory summary', '/inventory/summary?limit=1&offset=0', 1));

  await runBaselineCheck('warehouse config baseline', async () => {
    const warehouses = await readJson('/warehouses?status=ALL&locationStatus=ALL');
    assert(Array.isArray(warehouses) && warehouses.length >= 1, 'warehouses should contain at least one configured warehouse.');
    assert(
      Array.isArray(warehouses) &&
        warehouses.some(
          (warehouse) =>
            warehouse.status === 'ENABLED' &&
            Array.isArray(warehouse.locations) &&
            warehouse.locations.some((location) => location.status === 'ENABLED')
        ),
      'warehouses should contain at least one enabled warehouse with an enabled location.'
    );
    addCheck({
      label: 'warehouse config',
      endpoint: '/warehouses?status=ALL&locationStatus=ALL',
      totalCount: warehouses.length,
      module: 'warehouses'
    });
  });

  await runBaselineCheck('year statistics baseline', async () => {
    const statistics = await readJson(`/statistics/orders?period=year&year=${currentBusinessYear}`);
    assert(Array.isArray(statistics.summaryRows) && statistics.summaryRows.length > 0, 'year statistics should include material summary rows.');
    assert(Array.isArray(statistics.orderRows) && statistics.orderRows.length > 0, 'year statistics should include order rows.');
    assert(Number(statistics.inventorySnapshotTotal || 0) > 0, 'year statistics should include inventory snapshot rows.');
    addCheck({
      label: 'year statistics baseline',
      endpoint: `/statistics/orders?period=year&year=${currentBusinessYear}`,
      summaryRows: statistics.summaryRows?.length || 0,
      orderRows: statistics.orderRows?.length || 0,
      inventorySnapshotTotal: statistics.inventorySnapshotTotal || 0,
      module: 'statistics'
    });
  });

  if (failures.length > 0) {
    console.error(JSON.stringify({ ok: false, apiBaseUrl, coveredModules: [...coveredModules].sort(), checks, failures }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, apiBaseUrl, coveredModules: [...coveredModules].sort(), checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
