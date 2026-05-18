#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const rootDir = resolve(__dirname, '..');

for (const envPath of [resolve(rootDir, '.env'), resolve(rootDir, 'backend/.env')]) {
  if (!existsSync(envPath)) {
    continue;
  }
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const apiBaseUrl = (
  process.env.INVENTORY_SUMMARY_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const prisma = new PrismaClient();
const runId = 'STABLE';
const testPrefix = 'COD-INV-SUM-STABLE';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNumberEqual(actual, expected, label) {
  assert(Number(actual) === expected, `${label} expected ${expected}, actual ${actual}`);
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

async function cleanupDatabase() {
  await prisma.inventoryReservation.deleteMany({ where: { partCode: { startsWith: testPrefix } } });
  await prisma.inventoryTransaction.deleteMany({
    where: {
      OR: [{ transactionNo: { startsWith: testPrefix } }, { partCode: { startsWith: testPrefix } }]
    }
  });
  await prisma.inventoryAdjustment.deleteMany({ where: { partCode: { startsWith: testPrefix } } });
  await prisma.inventoryBatch.deleteMany({ where: { partCode: { startsWith: testPrefix } } });
  await prisma.orderLine.deleteMany({ where: { partCode: { startsWith: testPrefix } } });
  await prisma.customerOrder.deleteMany({ where: { orderNo: { startsWith: testPrefix } } });
  await prisma.orderNoReservation.deleteMany({ where: { orderNo: { startsWith: testPrefix } } });
  await prisma.material.updateMany({
    where: { partCode: { startsWith: testPrefix } },
    data: { status: 'DISABLED' }
  });
  const customer = await prisma.customer.findFirst({
    where: {
      OR: [
        { customerCode: `${testPrefix}-CUST` },
        { customerCode: { startsWith: `${testPrefix}-CUST__DISABLED__` } },
        { customerName: { startsWith: `Inventory Summary Regression Customer ${runId}__DISABLED__` } }
      ]
    },
    orderBy: { createdAt: 'asc' }
  });
  if (customer?.id) {
    const archiveSuffix = `__DISABLED__${customer.id.slice(0, 8)}`;
    await prisma.customerContact.updateMany({
      where: { customerId: customer.id, status: 'ENABLED' },
      data: { status: 'DISABLED', isPrimary: false }
    });
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        customerCode: `${testPrefix}-CUST${archiveSuffix}`,
        customerName: `Inventory Summary Regression Customer ${runId}${archiveSuffix}`,
        contactName: null,
        contactPhone: null,
        status: 'DISABLED'
      }
    });
  }
  await prisma.warehouseLocation.updateMany({
    where: { locationCode: { startsWith: testPrefix } },
    data: { status: 'DISABLED' }
  });
  await prisma.warehouse.updateMany({
    where: { warehouseCode: { startsWith: testPrefix } },
    data: { status: 'DISABLED' }
  });
}

async function upsertRegressionWarehouse(warehouseCode, warehouseName) {
  return prisma.warehouse.upsert({
    where: { warehouseCode },
    update: {
      warehouseName,
      status: 'ENABLED'
    },
    create: {
      warehouseCode,
      warehouseName,
      status: 'ENABLED'
    }
  });
}

async function upsertRegressionWarehouseLocation(warehouseId, locationCode, locationName) {
  const existingLocation = await prisma.warehouseLocation.findFirst({
    where: { warehouseId, locationCode },
    orderBy: { createdAt: 'asc' }
  });
  if (existingLocation) {
    return prisma.warehouseLocation.update({
      where: { id: existingLocation.id },
      data: {
        locationName,
        status: 'ENABLED'
      }
    });
  }
  return prisma.warehouseLocation.create({
    data: {
      warehouseId,
      locationCode,
      locationName,
      status: 'ENABLED'
    }
  });
}

async function seedInventorySummaryRows() {
  await cleanupDatabase();
  const partCode = `${testPrefix}-PART`;
  const zeroPartCode = `${testPrefix}-ZERO`;
  const customerName = `Inventory Summary Regression Customer ${runId}`;
  const unit = 'pcs';

  await prisma.material.upsert({
    where: { partCode },
    update: {
      partName: 'Inventory Summary Source Split Part',
      unit,
      stockAlertEnabled: true,
      stockAlertQuantity: 100,
      status: 'ENABLED'
    },
    create: {
      partCode,
      partName: 'Inventory Summary Source Split Part',
      unit,
      stockAlertEnabled: true,
      stockAlertQuantity: 100,
      status: 'ENABLED'
    }
  });
  await prisma.material.upsert({
    where: { partCode: zeroPartCode },
    update: {
      partName: 'Inventory Summary Zero Stock Part',
      unit,
      stockAlertEnabled: true,
      stockAlertQuantity: 1,
      status: 'ENABLED'
    },
    create: {
      partCode: zeroPartCode,
      partName: 'Inventory Summary Zero Stock Part',
      unit,
      stockAlertEnabled: true,
      stockAlertQuantity: 1,
      status: 'ENABLED'
    }
  });

  const customerCode = `${testPrefix}-CUST`;
  const existingCustomer = await prisma.customer.findFirst({
    where: {
      OR: [
        { customerCode },
        { customerCode: { startsWith: `${customerCode}__DISABLED__` } },
        { customerName: { startsWith: `${customerName}__DISABLED__` } }
      ]
    },
    orderBy: { createdAt: 'asc' }
  });
  const customerData = {
    customerCode,
    customerName,
    regionType: 'CHINA',
    province: 'Jiangsu',
    city: 'Suzhou',
    detailAddress: 'Inventory summary regression address',
    status: 'ENABLED'
  };
  const customer = existingCustomer
    ? await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: customerData
      })
    : await prisma.customer.create({
        data: customerData
      });
  const sourceOrder = await prisma.customerOrder.create({
    data: {
      orderNo: `${testPrefix}-ORDER`,
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      customerSnapshot: {
        customerCode: customer.customerCode,
        customerName: customer.customerName
      },
      orderDate: new Date('2026-05-16T00:00:00.000Z'),
      status: 'PENDING_PRODUCTION'
    }
  });
  const sourceLine = await prisma.orderLine.create({
    data: {
      orderId: sourceOrder.id,
      lineNo: 1,
      partCode,
      partName: 'Inventory Summary Source Split Part',
      partThickness: 1,
      quantity: 20,
      productionPlanQuantity: 20,
      unit
    }
  });
  const reservedOrder = await prisma.customerOrder.create({
    data: {
      orderNo: `${testPrefix}-RESERVED-ORDER`,
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      customerSnapshot: {
        customerCode: customer.customerCode,
        customerName: customer.customerName
      },
      orderDate: new Date('2026-05-17T00:00:00.000Z'),
      status: 'DRAFT'
    }
  });
  const reservedLine = await prisma.orderLine.create({
    data: {
      orderId: reservedOrder.id,
      lineNo: 1,
      partCode,
      partName: 'Inventory Summary Source Split Part',
      partThickness: 1,
      quantity: 5,
      productionPlanQuantity: 5,
      fulfillmentMode: 'STOCK',
      unit
    }
  });

  const warehouseA = await upsertRegressionWarehouse(`${testPrefix}-WH-A`, 'Inventory Summary Warehouse A');
  const warehouseB = await upsertRegressionWarehouse(`${testPrefix}-WH-B`, 'Inventory Summary Warehouse B');
  const locationA = await upsertRegressionWarehouseLocation(warehouseA.id, `${testPrefix}-LOC-A`, 'Inventory Summary Location A');
  const locationB = await upsertRegressionWarehouseLocation(warehouseB.id, `${testPrefix}-LOC-B`, 'Inventory Summary Location B');

  const baseBatch = {
    partCode,
    partName: 'Inventory Summary Source Split Part',
    unit,
    status: 'AVAILABLE'
  };
  const reservedBatch = await prisma.inventoryBatch.create({
    data: {
      ...baseBatch,
      batchNo: `${testPrefix}-RESERVED-STOCK`,
      quantity: 7,
      warehouseId: warehouseA.id,
      locationId: locationA.id,
      sourceOrderNo: `${testPrefix}-RESERVED-SOURCE`,
      sourceCustomerName: customer.customerName,
      sourceKind: 'NORMAL_ORDER'
    }
  });
  await prisma.inventoryBatch.createMany({
    data: [
      {
        ...baseBatch,
        batchNo: `${testPrefix}-ORDER-BATCH`,
        quantity: 4,
        warehouseId: warehouseA.id,
        locationId: locationA.id,
        sourceOrderId: sourceOrder.id,
        sourceOrderLineId: sourceLine.id,
        sourceOrderNo: sourceOrder.orderNo,
        sourceCustomerName: customer.customerName,
        sourceKind: 'NORMAL_ORDER'
      },
      {
        ...baseBatch,
        batchNo: `${testPrefix}-NORMAL-STOCK`,
        quantity: 8,
        warehouseId: warehouseA.id,
        locationId: locationA.id,
        sourceOrderNo: `${testPrefix}-NORMAL-SOURCE`,
        sourceCustomerName: customer.customerName,
        sourceKind: 'NORMAL_ORDER'
      },
      {
        ...baseBatch,
        batchNo: `${testPrefix}-CANCELLED-STOCK`,
        quantity: 3,
        warehouseId: warehouseB.id,
        locationId: locationB.id,
        sourceOrderNo: `${testPrefix}-CANCELLED-SOURCE`,
        sourceCustomerName: customer.customerName,
        sourceKind: 'CANCELLED_ORDER'
      },
      {
        ...baseBatch,
        batchNo: `${testPrefix}-CHANGE-STOCK`,
        quantity: 2,
        warehouseId: warehouseB.id,
        locationId: locationB.id,
        sourceOrderNo: `${testPrefix}-CHANGE-SOURCE`,
        sourceCustomerName: customer.customerName,
        sourceKind: 'CUSTOMER_CHANGE'
      }
    ]
  });
  await prisma.inventoryReservation.create({
    data: {
      batchId: reservedBatch.id,
      orderId: reservedOrder.id,
      orderLineId: reservedLine.id,
      orderNo: reservedOrder.orderNo,
      partCode,
      partName: 'Inventory Summary Source Split Part',
      quantity: 5,
      unit,
      status: 'ACTIVE',
      statusReason: 'VERIFY_INVENTORY_SUMMARY_RESERVATION'
    }
  });

  return {
    partCode,
    zeroPartCode,
    reservedOrderNo: reservedOrder.orderNo,
    expected: {
      batchCount: 5,
      warehouseCount: 2,
      physicalQuantity: 24,
      reservedQuantity: 5,
      availableQuantity: 19,
      usedQuantity: 0,
      totalQuantity: 24,
      orderInventoryQuantity: 4,
      stockInventoryQuantity: 15,
      normalOrderStockQuantity: 10,
      cancelledOrderStockQuantity: 3,
      customerChangeStockQuantity: 2
    }
  };
}

function assertSummaryRow(row, expected) {
  assertNumberEqual(row.batchCount, expected.batchCount, 'batchCount');
  assertNumberEqual(row.warehouseCount, expected.warehouseCount, 'warehouseCount');
  assertNumberEqual(row.physicalQuantity, expected.physicalQuantity, 'physicalQuantity');
  assertNumberEqual(row.reservedQuantity, expected.reservedQuantity, 'reservedQuantity');
  assertNumberEqual(row.availableQuantity, expected.availableQuantity, 'availableQuantity');
  assertNumberEqual(row.usedQuantity, expected.usedQuantity, 'usedQuantity');
  assertNumberEqual(row.totalQuantity, expected.totalQuantity, 'totalQuantity');
  assertNumberEqual(row.orderInventoryQuantity, expected.orderInventoryQuantity, 'orderInventoryQuantity');
  assertNumberEqual(row.stockInventoryQuantity, expected.stockInventoryQuantity, 'stockInventoryQuantity');
  assertNumberEqual(row.normalOrderStockQuantity, expected.normalOrderStockQuantity, 'normalOrderStockQuantity');
  assertNumberEqual(row.cancelledOrderStockQuantity, expected.cancelledOrderStockQuantity, 'cancelledOrderStockQuantity');
  assertNumberEqual(row.customerChangeStockQuantity, expected.customerChangeStockQuantity, 'customerChangeStockQuantity');
  assert(row.stockInventoryQuantity === row.normalOrderStockQuantity + row.cancelledOrderStockQuantity + row.customerChangeStockQuantity, 'stock source split must add up to stockInventoryQuantity');
  assert(row.availableQuantity === row.orderInventoryQuantity + row.stockInventoryQuantity, 'availableQuantity must equal orderInventoryQuantity + stockInventoryQuantity');
  assert(row.stockAlertEnabled === true, 'stockAlertEnabled should be true');
  assertNumberEqual(row.stockAlertQuantity, 100, 'stockAlertQuantity');
  assert(row.stockAlertTriggered === true, 'stockAlertTriggered should be true');
  assert(Array.isArray(row.warehouses) && row.warehouses.length === 2, 'warehouses should contain two warehouse rows');
}

async function main() {
  try {
    const fixture = await seedInventorySummaryRows();
    const hiddenFixtureSummaryRows = await requestJson(
      `/inventory/summary?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=ALL`
    );
    assert(
      !hiddenFixtureSummaryRows.some((row) => row.partCode === fixture.partCode),
      'inventory summary default response must hide reusable test fixture inventory'
    );
    const summaryRows = await requestJson(`/inventory/summary?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=ALL&includeTestFixtures=true`);
    assert(Array.isArray(summaryRows), 'inventory summary response must be an array');
    const summaryRow = summaryRows.find((row) => row.partCode === fixture.partCode);
    assert(summaryRow, `inventory summary should include ${fixture.partCode}`);
    assertSummaryRow(summaryRow, fixture.expected);

    const summaryPage = await requestJson(
      `/inventory/summary?keyword=${encodeURIComponent(testPrefix)}&status=AVAILABLE&stockAlert=ALL&withPage=true&includeTestFixtures=true&limit=1&offset=0`
    );
    assert(Array.isArray(summaryPage.items), 'paged inventory summary response should include items');
    assertNumberEqual(summaryPage.totalCount, 2, 'paged inventory summary totalCount');
    assertNumberEqual(summaryPage.items.length, 1, 'paged inventory summary first page item count');
    assertNumberEqual(summaryPage.limit, 1, 'paged inventory summary limit');
    assertNumberEqual(summaryPage.offset, 0, 'paged inventory summary offset');
    assert(summaryPage.hasMore === true, 'paged inventory summary first page should have more rows');
    const summaryLastPage = await requestJson(
      `/inventory/summary?keyword=${encodeURIComponent(testPrefix)}&status=AVAILABLE&stockAlert=ALL&withPage=true&includeTestFixtures=true&limit=1&offset=1`
    );
    assertNumberEqual(summaryLastPage.totalCount, 2, 'paged inventory summary last page totalCount');
    assertNumberEqual(summaryLastPage.items.length, 1, 'paged inventory summary last page item count');
    assert(summaryLastPage.hasMore === false, 'paged inventory summary last page should not have more rows');

    const triggeredRows = await requestJson(`/inventory/summary?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=TRIGGERED&includeTestFixtures=true`);
    assert(triggeredRows.some((row) => row.partCode === fixture.partCode), 'stockAlert=TRIGGERED should include low stock row');
    const disabledRows = await requestJson(`/inventory/summary?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=DISABLED&includeTestFixtures=true`);
    assert(!disabledRows.some((row) => row.partCode === fixture.partCode), 'stockAlert=DISABLED should exclude enabled stock alert row');

    const currentOrderRows = await requestJson(
      `/inventory/summary?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=ALL&includeTestFixtures=true&excludeOrderNo=${encodeURIComponent(fixture.reservedOrderNo)}`
    );
    const currentOrderRow = currentOrderRows.find((row) => row.partCode === fixture.partCode);
    assert(currentOrderRow, `current order summary should include ${fixture.partCode}`);
    assertNumberEqual(currentOrderRow.reservedQuantity, 0, 'current order reservedQuantity');
    assertNumberEqual(currentOrderRow.availableQuantity, 24, 'current order availableQuantity');

    const publicBatchPage = await requestJson(`/inventory?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=ALL&includeTestFixtures=true&limit=2&offset=0`);
    assert(!Array.isArray(publicBatchPage), 'public inventory batch response must be an explicit paged object');
    assert(Array.isArray(publicBatchPage.items), 'public inventory batch response should include items');
    assertNumberEqual(publicBatchPage.totalCount, 5, 'public inventory totalCount');
    assertNumberEqual(publicBatchPage.items.length, 2, 'public inventory first page item count');
    assertNumberEqual(publicBatchPage.limit, 2, 'public inventory limit');
    assertNumberEqual(publicBatchPage.offset, 0, 'public inventory offset');
    assert(publicBatchPage.hasMore === true, 'public inventory first page should have more rows');
    const batchPage = await requestJson(
      `/inventory?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=ALL&withPage=true&includeTestFixtures=true&limit=2&offset=0`
    );
    assert(Array.isArray(batchPage.items), 'paged inventory batch response should include items');
    assertNumberEqual(batchPage.totalCount, 5, 'paged inventory totalCount');
    assertNumberEqual(batchPage.items.length, 2, 'paged inventory first page item count');
    assertNumberEqual(batchPage.limit, 2, 'paged inventory limit');
    assertNumberEqual(batchPage.offset, 0, 'paged inventory offset');
    assert(batchPage.hasMore === true, 'paged inventory first page should have more rows');
    const batchLastPage = await requestJson(
      `/inventory?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=ALL&withPage=true&includeTestFixtures=true&limit=2&offset=4`
    );
    assertNumberEqual(batchLastPage.totalCount, 5, 'paged inventory last page totalCount');
    assertNumberEqual(batchLastPage.items.length, 1, 'paged inventory last page item count');
    assert(batchLastPage.hasMore === false, 'paged inventory last page should not have more rows');

    const legacySourceDetails = await requestJson(
      `/inventory/materials/${encodeURIComponent(fixture.partCode)}/source-details?sourceType=ALL`
    );
    assert(Array.isArray(legacySourceDetails.sources), 'legacy inventory source-details response should include sources');
    assertNumberEqual(legacySourceDetails.sources.length, 5, 'legacy inventory source-details source count');
    assert(!Object.prototype.hasOwnProperty.call(legacySourceDetails, 'totalSourceCount'), 'legacy inventory source-details should not expose paging metadata');
    const sourceDetailsPage = await requestJson(
      `/inventory/materials/${encodeURIComponent(fixture.partCode)}/source-details?sourceType=ALL&withPage=true&limit=2&offset=0`
    );
    assert(Array.isArray(sourceDetailsPage.sources), 'paged inventory source-details response should include sources');
    assertNumberEqual(sourceDetailsPage.totalSourceCount, 5, 'paged inventory source-details totalSourceCount');
    assertNumberEqual(sourceDetailsPage.sources.length, 2, 'paged inventory source-details first page item count');
    assertNumberEqual(sourceDetailsPage.sourceLimit, 2, 'paged inventory source-details sourceLimit');
    assertNumberEqual(sourceDetailsPage.sourceOffset, 0, 'paged inventory source-details sourceOffset');
    assert(sourceDetailsPage.sourceHasMore === true, 'paged inventory source-details first page should have more rows');
    assertNumberEqual(sourceDetailsPage.batchCount, 5, 'paged inventory source-details batchCount should keep full count');
    const sourceDetailsLastPage = await requestJson(
      `/inventory/materials/${encodeURIComponent(fixture.partCode)}/source-details?sourceType=ALL&withPage=true&limit=2&offset=4`
    );
    assertNumberEqual(sourceDetailsLastPage.totalSourceCount, 5, 'paged inventory source-details last page totalSourceCount');
    assertNumberEqual(sourceDetailsLastPage.sources.length, 1, 'paged inventory source-details last page item count');
    assert(sourceDetailsLastPage.sourceHasMore === false, 'paged inventory source-details last page should not have more rows');

    const zeroRows = await requestJson(`/inventory/summary?keyword=${encodeURIComponent(fixture.zeroPartCode)}&status=AVAILABLE&stockAlert=TRIGGERED&includeTestFixtures=true`);
    const zeroRow = zeroRows.find((row) => row.partCode === fixture.zeroPartCode);
    assert(zeroRow, `inventory summary should include zero stock material ${fixture.zeroPartCode}`);
    assertNumberEqual(zeroRow.batchCount, 0, 'zero stock batchCount');
    assertNumberEqual(zeroRow.availableQuantity, 0, 'zero stock availableQuantity');
    assert(zeroRow.stockAlertEnabled === true, 'zero stock material should keep stockAlertEnabled');
    assertNumberEqual(zeroRow.stockAlertQuantity, 1, 'zero stock stockAlertQuantity');
    assert(zeroRow.stockAlertTriggered === true, 'zero stock material should trigger stock alert');

    console.log(
      JSON.stringify(
        {
          ok: true,
          apiBaseUrl,
          checked: [
            'inventory-summary-source-split',
            'inventory-summary-test-fixture-filter',
            'inventory-summary-active-reservation',
            'inventory-summary-current-order-priority',
            'inventory-summary-explicit-pagination',
            'inventory-batch-public-list-pagination',
            'inventory-batch-explicit-pagination',
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
  } finally {
    await cleanupDatabase().catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
