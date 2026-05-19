#!/usr/bin/env node

const apiBaseUrl = (
  process.env.PRODUCTION_MANAGEMENT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const filteredDisplayStatuses = ['ACTIVE', 'PENDING', 'IN_PROGRESS', 'READY_TO_COMPLETE', 'COMPLETED', 'RECEIVED'];
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

function assertProductionTaskRow(row) {
  assert(row && typeof row === 'object', 'production task row must be an object.');
  assert(String(row.id || '').trim(), 'production task row must include id.');
  assert(String(row.productionTaskNo || '').trim(), 'production task row must include productionTaskNo.');
  assert(String(row.orderNo || '').trim(), 'production task row must include orderNo.');
  assert(String(row.customerName || '').trim(), `production task ${row.productionTaskNo || '-'} must include customerName.`);
  assert(String(row.partCode || '').trim(), `production task ${row.productionTaskNo || '-'} must include partCode.`);
  assert(String(row.partName || '').trim(), `production task ${row.productionTaskNo || '-'} must include partName.`);
  assert(Number(row.plannedQuantity || 0) > 0, `production task ${row.productionTaskNo || '-'} must have plannedQuantity > 0.`);
  assert(String(row.status || '').trim(), `production task ${row.productionTaskNo || '-'} must include status.`);
}

function assertProductionSummaryRow(row) {
  assert(row && typeof row === 'object', 'production order summary row must be an object.');
  assert(String(row.orderId || '').trim(), 'production order summary row must include orderId.');
  assert(String(row.orderNo || '').trim(), 'production order summary row must include orderNo.');
  assert(String(row.customerName || '').trim(), `production order summary ${row.orderNo || '-'} must include customerName.`);
  assert(Number(row.taskCount || 0) > 0, `production order summary ${row.orderNo || '-'} must have taskCount > 0.`);
  assert(Number(row.partCount || 0) > 0, `production order summary ${row.orderNo || '-'} must have partCount > 0.`);
  assert(
    Number(row.totalPlannedQuantity || 0) > 0,
    `production order summary ${row.orderNo || '-'} must have totalPlannedQuantity > 0.`
  );
  assert(String(row.status || '').trim(), `production order summary ${row.orderNo || '-'} must include status.`);
}

async function assertProductionEndpoint(endpoint, label, rowAssert) {
  const page = await readJson(endpoint);
  assertPageShape(label, endpoint, page);
  if (page.items.length > 0) {
    rowAssert(page.items[0]);
  }
  return page;
}

async function main() {
  const allTasks = await assertProductionEndpoint('/production/tasks?displayStatus=ALL&limit=5&offset=0', 'production tasks ALL', assertProductionTaskRow);
  const allSummaries = await assertProductionEndpoint(
    '/production/tasks/order-summary?displayStatus=ALL&limit=5&offset=0',
    'production order summaries ALL',
    assertProductionSummaryRow
  );

  assert(allTasks.totalCount > 0, 'production management task detail tab must show business rows by default.');
  assert(allSummaries.totalCount > 0, 'production management order summary tab must show business rows by default.');

  const statusChecks = [{ status: 'ALL', summaryTotal: allSummaries.totalCount, taskTotal: allTasks.totalCount }];
  for (const status of filteredDisplayStatuses) {
    const summaryEndpoint = `/production/tasks/order-summary?displayStatus=${status}&limit=5&offset=0`;
    const taskEndpoint = `/production/tasks?displayStatus=${status}&limit=5&offset=0`;
    const [summaryPage, taskPage] = await Promise.all([
      assertProductionEndpoint(summaryEndpoint, `production order summaries ${status}`, assertProductionSummaryRow),
      assertProductionEndpoint(taskEndpoint, `production tasks ${status}`, assertProductionTaskRow)
    ]);
    statusChecks.push({ status, summaryTotal: summaryPage.totalCount, taskTotal: taskPage.totalCount });
  }

  const activeStatusRows = statusChecks.filter((row) => row.status !== 'ALL' && (row.summaryTotal > 0 || row.taskTotal > 0));
  assert(
    activeStatusRows.length > 0,
    'production management status cards must not all be zero when ALL has production data.'
  );

  const customerScopedOrder = allSummaries.items.find((row) => row.customerId && row.orderNo);
  if (customerScopedOrder) {
    const scopedSummaryEndpoint = `/production/tasks/order-summary?customerId=${encodeURIComponent(
      customerScopedOrder.customerId
    )}&orderNo=${encodeURIComponent(customerScopedOrder.orderNo)}&displayStatus=ALL&limit=5&offset=0`;
    const scopedTaskEndpoint = `/production/tasks?customerId=${encodeURIComponent(
      customerScopedOrder.customerId
    )}&orderNo=${encodeURIComponent(customerScopedOrder.orderNo)}&displayStatus=ALL&limit=5&offset=0`;
    const [scopedSummaryPage, scopedTaskPage] = await Promise.all([
      assertProductionEndpoint(scopedSummaryEndpoint, 'production order summary scoped by customer and order', assertProductionSummaryRow),
      assertProductionEndpoint(scopedTaskEndpoint, 'production tasks scoped by customer and order', assertProductionTaskRow)
    ]);
    assert(scopedSummaryPage.totalCount > 0, 'production scoped order summary should still contain the selected business order.');
    assert(scopedTaskPage.totalCount > 0, 'production scoped task list should still contain the selected business order.');
  }

  console.log(JSON.stringify({ ok: true, apiBaseUrl, checks, statusChecks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
