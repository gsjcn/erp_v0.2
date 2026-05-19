#!/usr/bin/env node

const apiBaseUrl = (
  process.env.WAREHOUSE_WORK_MANAGEMENT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const fixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];
const transactionTypes = new Set(['IN', 'OUT', 'ADJUSTMENT']);
const checks = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && String(value).trim()) {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
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

function assertNoFixtureText(payload, label) {
  const text = JSON.stringify(payload || {});
  const leakedPrefix = fixturePrefixes.find((prefix) => text.includes(prefix));
  assert(!leakedPrefix, `${label} must hide reusable regression fixture data by default; leaked prefix=${leakedPrefix}`);
}

function assertArrayResponse(label, endpoint, rows) {
  assert(Array.isArray(rows), `${label} must return an array.`);
  assertNoFixtureText(rows, label);
  checks.push({ label, endpoint, totalCount: rows.length });
}

function assertPageShape(label, endpoint, page, expectedLimit = 5, expectedOffset = 0) {
  assert(page && typeof page === 'object' && !Array.isArray(page), `${label} must return a paginated object.`);
  assert(Array.isArray(page.items), `${label} must return items[].`);
  assert(page.limit === expectedLimit, `${label} must echo limit=${expectedLimit}; got ${page.limit}.`);
  assert(page.offset === expectedOffset, `${label} must echo offset=${expectedOffset}; got ${page.offset}.`);
  assert(Number.isInteger(page.totalCount), `${label} must return integer totalCount.`);
  assert(typeof page.hasMore === 'boolean', `${label} must return boolean hasMore.`);
  assert(page.items.length <= expectedLimit, `${label} must not return more than limit rows.`);
  assert(page.hasMore === expectedOffset + page.items.length < page.totalCount, `${label} hasMore does not match pagination math.`);
  assertNoFixtureText(page, label);
  checks.push({ label, endpoint, totalCount: page.totalCount, itemCount: page.items.length });
}

function positive(value, label) {
  assert(Number(value || 0) > 0, `${label} must be a positive number; actual=${value}.`);
}

function nonNegative(value, label) {
  assert(Number(value || 0) >= 0, `${label} must be >= 0; actual=${value}.`);
}

function assertReceiptRow(row) {
  for (const field of ['id', 'productionTaskNo', 'orderNo', 'customerName', 'partCode', 'partName', 'unit', 'status']) {
    assert(String(row[field] || '').trim(), `warehouse receipt row must include ${field}.`);
  }
  positive(row.completedQuantity ?? row.quantity, `warehouse receipt ${row.productionTaskNo} completed quantity`);
  nonNegative(row.receivedOrderQuantity, `warehouse receipt ${row.productionTaskNo} receivedOrderQuantity`);
  nonNegative(row.orderReceiptQuantity, `warehouse receipt ${row.productionTaskNo} orderReceiptQuantity`);
  nonNegative(row.stockQuantity, `warehouse receipt ${row.productionTaskNo} stockQuantity`);
}

function assertShipmentRow(row) {
  for (const field of [
    'id',
    'batchNo',
    'orderLineId',
    'orderNo',
    'customerName',
    'partCode',
    'partName',
    'unit',
    'warehouseId',
    'warehouseName',
    'locationId',
    'locationName',
    'inventorySourceType',
    'sourceKind',
    'status'
  ]) {
    assert(String(row[field] || '').trim(), `warehouse shipment row must include ${field}.`);
  }
  positive(row.quantity, `warehouse shipment ${row.batchNo} inventory quantity`);
  positive(row.customerOrderQuantity, `warehouse shipment ${row.batchNo} customerOrderQuantity`);
  positive(row.remainingQuantity, `warehouse shipment ${row.batchNo} remainingQuantity`);
  positive(row.suggestedShipmentQuantity, `warehouse shipment ${row.batchNo} suggestedShipmentQuantity`);
  assert(Number(row.suggestedShipmentQuantity) <= Number(row.quantity), `warehouse shipment ${row.batchNo} suggested quantity must not exceed batch quantity.`);
  assert(
    Number(row.suggestedShipmentQuantity) <= Number(row.remainingQuantity),
    `warehouse shipment ${row.batchNo} suggested quantity must not exceed remaining order quantity.`
  );
}

function assertTransactionRow(row) {
  for (const field of ['id', 'transactionNo', 'transactionType', 'partCode', 'partName', 'batchId', 'batchNo', 'quantity', 'unit', 'warehouseName', 'transactionTime']) {
    assert(String(row[field] || '').trim(), `warehouse transaction row must include ${field}.`);
  }
  assert(transactionTypes.has(row.transactionType), `warehouse transaction ${row.transactionNo} type must be known, actual=${row.transactionType}.`);
  positive(row.quantity, `warehouse transaction ${row.transactionNo} quantity`);
  if (row.batchStatus === 'AVAILABLE') {
    nonNegative(row.physicalQuantity, `warehouse transaction ${row.transactionNo} physicalQuantity`);
    nonNegative(row.reservedQuantity, `warehouse transaction ${row.transactionNo} reservedQuantity`);
    nonNegative(row.availableQuantity, `warehouse transaction ${row.transactionNo} availableQuantity`);
  }
}

function assertContainsId(rows, row, label) {
  assert(rows.some((item) => item.id === row.id), `${label} must include ${row.id}.`);
}

function dateKey(value) {
  return String(value || '').slice(0, 10);
}

async function main() {
  const receiptsEndpoint = '/warehouse/receipts/pending';
  const receipts = await readJson(receiptsEndpoint);
  assertArrayResponse('warehouse pending receipts', receiptsEndpoint, receipts);
  receipts.forEach(assertReceiptRow);

  const shipmentsEndpoint = '/warehouse/shipments/pending';
  const shipments = await readJson(shipmentsEndpoint);
  assertArrayResponse('warehouse pending shipments', shipmentsEndpoint, shipments);
  assert(shipments.length > 0, 'warehouse pending shipments must show current business rows.');
  shipments.forEach(assertShipmentRow);
  const shipmentSample = shipments[0];

  const shipmentOrderEndpoint = `/warehouse/shipments/pending${query({ orderNo: shipmentSample.orderNo })}`;
  const shipmentOrderRows = await readJson(shipmentOrderEndpoint);
  assertArrayResponse('warehouse pending shipment orderNo filter', shipmentOrderEndpoint, shipmentOrderRows);
  assertContainsId(shipmentOrderRows, shipmentSample, 'warehouse pending shipment orderNo filter');

  if (shipmentSample.customerId) {
    const shipmentCustomerEndpoint = `/warehouse/shipments/pending${query({ customerId: shipmentSample.customerId })}`;
    const shipmentCustomerRows = await readJson(shipmentCustomerEndpoint);
    assertArrayResponse('warehouse pending shipment customer filter', shipmentCustomerEndpoint, shipmentCustomerRows);
    assertContainsId(shipmentCustomerRows, shipmentSample, 'warehouse pending shipment customer filter');
  }

  if (shipmentSample.orderDate) {
    const shipmentDateEndpoint = `/warehouse/shipments/pending${query({
      dateFrom: dateKey(shipmentSample.orderDate),
      dateTo: dateKey(shipmentSample.orderDate)
    })}`;
    const shipmentDateRows = await readJson(shipmentDateEndpoint);
    assertArrayResponse('warehouse pending shipment order date filter', shipmentDateEndpoint, shipmentDateRows);
    assertContainsId(shipmentDateRows, shipmentSample, 'warehouse pending shipment order date filter');
  }

  const transactionsEndpoint = '/warehouse/transactions?limit=5&offset=0';
  const transactionsPage = await readJson(transactionsEndpoint);
  assertPageShape('warehouse transactions default page', transactionsEndpoint, transactionsPage);
  assert(transactionsPage.totalCount > 0, 'warehouse transactions default page must show current inventory movement rows.');
  transactionsPage.items.forEach(assertTransactionRow);

  const transactionSample = transactionsPage.items.find((row) => row.orderNo || row.sourceOrderNo || row.productionSourceOrderNo) || transactionsPage.items[0];
  const transactionTypeEndpoint = `/warehouse/transactions${query({
    transactionType: transactionSample.transactionType,
    limit: 20,
    offset: 0
  })}`;
  const transactionTypePage = await readJson(transactionTypeEndpoint);
  assertPageShape('warehouse transaction type filter', transactionTypeEndpoint, transactionTypePage, 20);
  assert(
    transactionTypePage.items.every((row) => row.transactionType === transactionSample.transactionType),
    'warehouse transaction type filter must only return matching transactionType.'
  );
  assertContainsId(transactionTypePage.items, transactionSample, 'warehouse transaction type filter');

  const scopedOrderNo = transactionSample.orderNo || transactionSample.sourceOrderNo || transactionSample.productionSourceOrderNo;
  if (scopedOrderNo) {
    const transactionOrderEndpoint = `/warehouse/transactions${query({ orderNo: scopedOrderNo, limit: 20, offset: 0 })}`;
    const transactionOrderPage = await readJson(transactionOrderEndpoint);
    assertPageShape('warehouse transaction order scope filter', transactionOrderEndpoint, transactionOrderPage, 20);
    assertContainsId(transactionOrderPage.items, transactionSample, 'warehouse transaction order scope filter');
  }

  const noMatchShipmentsEndpoint = '/warehouse/shipments/pending?orderNo=NO_MATCH_WAREHOUSE_WORK';
  const noMatchShipments = await readJson(noMatchShipmentsEndpoint);
  assertArrayResponse('warehouse pending shipment no-match filter', noMatchShipmentsEndpoint, noMatchShipments);
  assert(noMatchShipments.length === 0, 'warehouse pending shipment no-match filter must return zero rows.');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'warehouse pending receipts read-only structure',
          'warehouse pending shipments must show current business rows',
          'warehouse pending shipment order/customer/date filters',
          'warehouse transactions default page must show current inventory movement rows',
          'warehouse transaction type/order filters',
          'warehouse work lists hide reusable regression fixtures'
        ],
        checks
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
