#!/usr/bin/env node

const apiBaseUrl = (
  process.env.ORDER_MANAGEMENT_API_BASE_URL ||
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

function assertOrderSummary(row) {
  assert(String(row.id || '').trim(), 'order summary row must include id.');
  assert(/^SO-\d{8}-\d+$/.test(String(row.orderNo || '')), `order summary must include stable SO orderNo; got ${row.orderNo || '-'}.`);
  assert(String(row.customerId || '').trim(), `order ${row.orderNo || '-'} must include customerId.`);
  assert(String(row.customerName || '').trim(), `order ${row.orderNo || '-'} must include customerName.`);
  assert(String(row.status || '').trim(), `order ${row.orderNo || '-'} must include status.`);
  assert(String(row.productionStatus || '').trim(), `order ${row.orderNo || '-'} must include productionStatus.`);
  assert(String(row.warehouseStage || '').trim(), `order ${row.orderNo || '-'} must include warehouseStage.`);
  assert(Number(row.partCount || 0) >= 0, `order ${row.orderNo || '-'} must include partCount.`);
  assert(Number(row.totalQuantity || 0) >= 0, `order ${row.orderNo || '-'} must include totalQuantity.`);
  assert(
    Number(row.totalProductionPlanQuantity || 0) >= 0,
    `order ${row.orderNo || '-'} must include totalProductionPlanQuantity.`
  );
  assert(Array.isArray(row.quantityByUnit), `order ${row.orderNo || '-'} must include quantityByUnit[].`);
}

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

async function assertOrderList(endpoint, label) {
  const orders = await readJson(endpoint);
  assert(Array.isArray(orders), `${label} must return an array matching the current orders list contract.`);
  assertNoFixtureText(label, orders);
  checks.push({ label, endpoint, count: orders.length });
  return orders;
}

async function main() {
  const defaultOrders = await assertOrderList('/orders', 'order default list');
  assert(defaultOrders.length > 0, 'order default list must show business orders.');
  const sampleOrder = defaultOrders[0];
  assertOrderSummary(sampleOrder);

  const statusOrders = await assertOrderList(`/orders?status=${encodeURIComponent(sampleOrder.status)}`, 'order status filter');
  assert(statusOrders.length > 0, 'order status filter must return matching orders.');
  assert(
    statusOrders.every((order) => order.status === sampleOrder.status),
    `order status filter must only return ${sampleOrder.status} orders.`
  );
  statusOrders.slice(0, 3).forEach(assertOrderSummary);

  const byOrderNo = await assertOrderList(`/orders?orderNo=${encodeURIComponent(sampleOrder.orderNo.toLowerCase())}`, 'orderNo exact filter');
  assert(byOrderNo.length === 1, 'orderNo exact filter must return a single order.');
  assert(byOrderNo[0].orderNo === sampleOrder.orderNo, 'orderNo exact filter must be case-insensitive.');

  const byCustomer = await assertOrderList(`/orders?customerId=${encodeURIComponent(sampleOrder.customerId)}`, 'order customer filter');
  assert(byCustomer.length > 0, 'order customer filter must return orders for the selected customer.');
  assert(byCustomer.every((order) => order.customerId === sampleOrder.customerId), 'order customer filter must only return selected customer orders.');

  const orderDate = dateOnly(sampleOrder.orderDate);
  assert(orderDate, 'sample order must include orderDate.');
  const byDate = await assertOrderList(
    `/orders?dateFrom=${encodeURIComponent(orderDate)}&dateTo=${encodeURIComponent(orderDate)}`,
    'order date range filter'
  );
  assert(byDate.some((order) => order.orderNo === sampleOrder.orderNo), 'order date range filter must include the sample order date.');

  const detail = await readJson(`/orders/${encodeURIComponent(sampleOrder.orderNo)}`);
  assertOrderSummary(detail);
  assert(detail.orderNo === sampleOrder.orderNo, 'order detail must return the requested order.');
  assert(detail.customer && detail.customer.id === sampleOrder.customerId, 'order detail must include the customer snapshot.');
  assert(Array.isArray(detail.lines), 'order detail must include lines[].');
  assert(detail.lines.length === detail.partCount, 'order detail lines length must match partCount.');
  assertNoFixtureText('order detail', detail);
  for (const line of detail.lines) {
    assert(String(line.partCode || '').trim(), `order ${detail.orderNo} line must include partCode.`);
    assert(String(line.partName || '').trim(), `order ${detail.orderNo} line ${line.partCode || '-'} must include partName.`);
    assert(Number(line.quantity || 0) >= 0, `order ${detail.orderNo} line ${line.partCode || '-'} must include quantity.`);
    assert(
      Number(line.productionPlanQuantity || 0) >= 0,
      `order ${detail.orderNo} line ${line.partCode || '-'} must include productionPlanQuantity.`
    );
    assert(Array.isArray(line.processSteps), `order ${detail.orderNo} line ${line.partCode || '-'} must include processSteps[].`);
  }
  checks.push({ label: 'order detail', endpoint: `/orders/${sampleOrder.orderNo}`, lineCount: detail.lines.length });

  const existingCheck = await readJson(`/orders/check-no?orderNo=${encodeURIComponent(sampleOrder.orderNo.toLowerCase())}`);
  assert(existingCheck.orderNo === sampleOrder.orderNo, 'order check-no must normalize lower-case orderNo.');
  assert(existingCheck.exists === true, 'order check-no must detect existing orderNo.');
  assert(existingCheck.available === false, 'order check-no must mark existing orderNo unavailable.');
  checks.push({ label: 'orderNo duplicate check', orderNo: existingCheck.orderNo });

  const excludeCheck = await readJson(
    `/orders/check-no?orderNo=${encodeURIComponent(sampleOrder.orderNo.toLowerCase())}&excludeOrderNo=${encodeURIComponent(sampleOrder.orderNo)}`
  );
  assert(excludeCheck.orderNo === sampleOrder.orderNo, 'order check-no with exclude must normalize lower-case orderNo.');
  assert(excludeCheck.exists === false, 'order check-no with exclude must ignore the current order.');
  assert(excludeCheck.available === true, 'order check-no with exclude must allow the current orderNo.');
  checks.push({ label: 'orderNo exclude-current check', orderNo: excludeCheck.orderNo });

  const availableCheck = await readJson('/orders/check-no?orderNo=SO-20991231-999');
  assert(availableCheck.exists === false, 'order check-no must mark unused orderNo as not existing.');
  assert(availableCheck.available === true, 'order check-no must mark unused orderNo available.');
  checks.push({ label: 'orderNo available check', orderNo: availableCheck.orderNo });

  const nextNo = await readJson(`/orders/next-no?orderDate=${encodeURIComponent(orderDate)}`);
  assert(/^SO-\d{8}-\d{3}$/.test(String(nextNo.orderNo || '')), `orders next-no must return SO-date-sequence format; got ${nextNo.orderNo || '-'}.`);
  checks.push({ label: 'orders next-no', orderNo: nextNo.orderNo });

  console.log(JSON.stringify({ ok: true, apiBaseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
