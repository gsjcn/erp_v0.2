#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

for (const envPath of [resolve('.env'), resolve('backend/.env')]) {
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
  process.env.WAREHOUSE_CONFIG_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  process.env.ORDER_IMPORT_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const prisma = new PrismaClient();
const runId = 'STABLE';
const testPrefix = 'COD-WH-STABLE';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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

async function requestBuffer(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${buffer.toString('utf8')}`);
  }
  return {
    buffer,
    contentType: response.headers.get('content-type') || '',
    contentDisposition: response.headers.get('content-disposition') || ''
  };
}

async function expectRequestFailure(label, action, expectedMessage) {
  let failed = false;
  try {
    await action();
  } catch (error) {
    failed = true;
    assert(
      String(error.message || '').includes(expectedMessage),
      `${label} failure should include "${expectedMessage}", actual: ${error.message}`
    );
  }
  assert(failed, `${label} should fail`);
}

async function cleanup() {
  await prisma.inventoryTransaction.deleteMany({ where: { transactionNo: { startsWith: testPrefix } } });
  await prisma.inventoryBatch.deleteMany({ where: { batchNo: { startsWith: testPrefix } } });
  await prisma.warehouseLocation.updateMany({
    where: { locationCode: { startsWith: testPrefix } },
    data: { status: 'DISABLED' }
  });
  await prisma.warehouse.updateMany({
    where: { warehouseCode: { startsWith: testPrefix } },
    data: { status: 'DISABLED' }
  });
}

async function cleanupEmptyWarehouseFixture() {
  const warehouse = await prisma.warehouse.findUnique({
    where: { warehouseCode: `${testPrefix}-EMPTY` },
    include: {
      _count: {
        select: {
          inventoryBatches: true,
          inventoryTransactions: true,
          locations: true
        }
      }
    }
  });
  if (!warehouse) {
    return;
  }

  const locationHistoryCount = await prisma.warehouseLocation.count({
    where: {
      warehouseId: warehouse.id,
      OR: [{ inventoryBatches: { some: {} } }, { inventoryTransactions: { some: {} } }]
    }
  });
  const hasInventoryHistory =
    warehouse._count.inventoryBatches > 0 ||
    warehouse._count.inventoryTransactions > 0 ||
    locationHistoryCount > 0;
  if (hasInventoryHistory) {
    await prisma.warehouseLocation.updateMany({
      where: { warehouseId: warehouse.id },
      data: { status: 'DISABLED' }
    });
    await prisma.warehouse.update({
      where: { id: warehouse.id },
      data: { status: 'DISABLED' }
    });
    throw new Error(`${testPrefix}-EMPTY has inventory history and cannot be physically reset.`);
  }

  // 空仓库删除是单独业务边界验证；只清理无历史的测试夹具，避免破坏仓库主数据。
  await prisma.warehouseLocation.deleteMany({ where: { warehouseId: warehouse.id } });
  await prisma.warehouse.delete({ where: { id: warehouse.id } });
}

async function createTemporaryWarehouseWithLocation(suffix) {
  const warehouse = await requestJson('/warehouses', {
    method: 'POST',
    body: JSON.stringify({
      warehouseCode: `${testPrefix}-${suffix}`,
      warehouseName: `Warehouse Config Verify ${suffix}`
    })
  });
  const location = await requestJson(`/warehouses/${warehouse.id}/locations`, {
    method: 'POST',
    body: JSON.stringify({
      locationCode: `${testPrefix}-${suffix}-L1`,
      locationName: `Warehouse Config Verify ${suffix} Location`
    })
  });
  assert(warehouse.id, `${suffix} warehouse should be created`);
  assert(location.id, `${suffix} location should be created`);
  return { warehouse, location };
}

async function upsertRegressionWarehouseWithLocation(suffix) {
  const warehouseCode = `${testPrefix}-${suffix}`;
  const locationCode = `${testPrefix}-${suffix}-L1`;
  const warehouseName = `Warehouse Config Verify ${suffix}`;
  const locationName = `Warehouse Config Verify ${suffix} Location`;

  const warehouse = await prisma.warehouse.upsert({
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

  const existingLocation = await prisma.warehouseLocation.findFirst({
    where: {
      warehouseId: warehouse.id,
      locationCode
    }
  });
  const location = existingLocation
    ? await prisma.warehouseLocation.update({
        where: { id: existingLocation.id },
        data: {
          locationName,
          status: 'ENABLED'
        }
      })
    : await prisma.warehouseLocation.create({
        data: {
          warehouseId: warehouse.id,
          locationCode,
          locationName,
          status: 'ENABLED'
        }
      });

  assert(warehouse.id, `${suffix} warehouse should be available`);
  assert(location.id, `${suffix} location should be available`);
  return { warehouse, location };
}

async function assertEmptyWarehouseCanBeDeleted() {
  await cleanupEmptyWarehouseFixture();
  const { warehouse, location } = await createTemporaryWarehouseWithLocation('EMPTY');
  const deletedLocation = await requestJson(`/warehouses/${warehouse.id}/locations/${location.id}`, { method: 'DELETE' });
  assert(deletedLocation?.deleted === true, 'empty warehouse location should be physically deletable');
  const deletedWarehouse = await requestJson(`/warehouses/${warehouse.id}`, { method: 'DELETE' });
  assert(deletedWarehouse?.deleted === true, 'empty warehouse should be physically deletable');

  const remainingWarehouse = await prisma.warehouse.findUnique({ where: { id: warehouse.id } });
  const remainingLocation = await prisma.warehouseLocation.findUnique({ where: { id: location.id } });
  assert(!remainingWarehouse, 'empty deleted warehouse should not remain in database');
  assert(!remainingLocation, 'empty deleted location should not remain in database');
}

async function seedInventoryHistory(warehouse, location) {
  const batch = await prisma.inventoryBatch.create({
    data: {
      batchNo: `${testPrefix}-BATCH`,
      partCode: `${testPrefix}-PART`,
      partName: 'Warehouse Config Verify Part',
      quantity: 1,
      unit: '件',
      warehouseId: warehouse.id,
      locationId: location.id,
      status: 'AVAILABLE'
    }
  });
  await prisma.inventoryTransaction.create({
    data: {
      transactionNo: `${testPrefix}-TX`,
      transactionType: 'IN',
      batchId: batch.id,
      partCode: batch.partCode,
      partName: batch.partName,
      quantity: 1,
      unit: batch.unit,
      warehouseId: warehouse.id,
      locationId: location.id,
      remark: 'Warehouse config delete boundary verification',
      sourceRecordType: 'WarehouseConfigVerify',
      sourceRecordId: batch.id
    }
  });
  return batch;
}

async function assertWarehouseWithHistoryCanOnlyBeDisabled() {
  const { warehouse, location } = await upsertRegressionWarehouseWithLocation('HISTORY');
  const batch = await seedInventoryHistory(warehouse, location);

  await expectRequestFailure('delete location with inventory history', () =>
    requestJson(`/warehouses/${warehouse.id}/locations/${location.id}`, { method: 'DELETE' }), '只能停用'
  );
  await expectRequestFailure('delete warehouse with inventory history', () =>
    requestJson(`/warehouses/${warehouse.id}`, { method: 'DELETE' }), '只能停用'
  );

  const disabledLocation = await requestJson(`/warehouses/${warehouse.id}/locations/${location.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DISABLED' })
  });
  assert(disabledLocation.status === 'DISABLED', 'location with inventory history should be soft-disabled');

  const disabledWarehouse = await requestJson(`/warehouses/${warehouse.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DISABLED' })
  });
  assert(disabledWarehouse.status === 'DISABLED', 'warehouse with inventory history should be soft-disabled');
  assert(
    disabledWarehouse.locations.every((item) => item.status === 'DISABLED'),
    'disabling a warehouse should also disable its enabled locations'
  );

  const [remainingBatch, remainingTransaction] = await Promise.all([
    prisma.inventoryBatch.findUnique({ where: { id: batch.id } }),
    prisma.inventoryTransaction.findFirst({ where: { transactionNo: `${testPrefix}-TX` } })
  ]);
  assert(remainingBatch, 'soft-disabling warehouse must keep inventory batch history');
  assert(remainingTransaction, 'soft-disabling warehouse must keep inventory transaction history');
}

async function assertWarehouseConfigExport() {
  const enabledWarehouseWithDisabledLocation = await upsertRegressionWarehouseWithLocation('LOC-DISABLED');
  await upsertRegressionWarehouseWithLocation('LOC-ENABLED');
  await requestJson(`/warehouses/${enabledWarehouseWithDisabledLocation.warehouse.id}/locations/${enabledWarehouseWithDisabledLocation.location.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DISABLED' })
  });

  const defaultWarehouses = await requestJson('/warehouses?status=ALL&locationStatus=ALL');
  assert(
    !JSON.stringify(defaultWarehouses).includes(testPrefix),
    'warehouse config list must hide reusable test fixtures unless includeTestFixtures=true'
  );
  const fixtureWarehouses = await requestJson('/warehouses?status=ALL&locationStatus=ALL&includeTestFixtures=true');
  assert(
    JSON.stringify(fixtureWarehouses).includes(`${testPrefix}-LOC-DISABLED`),
    'warehouse config list should expose reusable test fixtures only when includeTestFixtures=true'
  );
  const fixtureListText = JSON.stringify(fixtureWarehouses);
  assert(
    fixtureListText.includes(`${testPrefix}-LOC-DISABLED-L1`),
    'warehouse config list locationStatus=ALL should include disabled locations under enabled warehouses'
  );

  const disabledLocationList = await requestJson('/warehouses?status=ALL&locationStatus=DISABLED&includeTestFixtures=true');
  const disabledLocationListText = JSON.stringify(disabledLocationList);
  assert(
    disabledLocationListText.includes(`${testPrefix}-LOC-DISABLED-L1`),
    'warehouse config list locationStatus=DISABLED should include disabled locations'
  );
  assert(
    !disabledLocationListText.includes(`${testPrefix}-LOC-ENABLED-L1`),
    'warehouse config list locationStatus=DISABLED must exclude enabled locations'
  );

  const enabledLocationList = await requestJson('/warehouses?status=ALL&locationStatus=ENABLED&includeTestFixtures=true');
  const enabledLocationListText = JSON.stringify(enabledLocationList);
  assert(
    enabledLocationListText.includes(`${testPrefix}-LOC-ENABLED-L1`),
    'warehouse config list locationStatus=ENABLED should include enabled locations'
  );
  assert(
    !enabledLocationListText.includes(`${testPrefix}-LOC-DISABLED-L1`),
    'warehouse config list locationStatus=ENABLED must exclude disabled locations'
  );

  const defaultExportResponse = await requestBuffer('/warehouses/export?status=ALL&locationStatus=ALL');
  const defaultExportWorkbook = new ExcelJS.Workbook();
  await defaultExportWorkbook.xlsx.load(defaultExportResponse.buffer);
  assert(
    !JSON.stringify(defaultExportWorkbook.model).includes(testPrefix),
    'warehouse config export must hide reusable test fixtures unless includeTestFixtures=true'
  );

  const exportResponse = await requestBuffer('/warehouses/export?status=ALL&includeTestFixtures=true');
  assert(
    exportResponse.contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `warehouse config export should return real xlsx content-type, actual: ${exportResponse.contentType || '-'}`
  );
  assert(exportResponse.contentDisposition.includes('warehouse-config-export.xlsx'), 'warehouse config export should keep fixed filename');
  assert(exportResponse.buffer.subarray(0, 2).toString('utf8') === 'PK', 'warehouse config export must be a real .xlsx zip file');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exportResponse.buffer);
  const warehouseSheet = workbook.getWorksheet('仓库配置');
  const locationSheet = workbook.getWorksheet('库位配置');
  assert(warehouseSheet, 'warehouse config export must include 仓库配置 sheet');
  assert(locationSheet, 'warehouse config export must include 库位配置 sheet');
  assert(warehouseSheet.getCell('A1').text === '仓库配置导出', 'warehouse config title mismatch');
  assert(locationSheet.getCell('A1').text === '库位配置导出', 'warehouse location config title mismatch');
  assert(warehouseSheet.getCell('A2').text.includes('仓库状态：全部'), 'warehouse config export scope should include warehouse status=ALL');
  assert(warehouseSheet.getCell('A2').text.includes('库位状态：全部'), 'warehouse config export scope should include location status=ALL');

  const warehouseHeaders = warehouseSheet
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map(String);
  for (const header of ['序号', '仓库编码', '仓库名称', '仓库状态', '库位数量', '启用库位', '停用库位', '库存批次', '库存流水']) {
    assert(warehouseHeaders.includes(header), `warehouse config export missing header ${header}`);
  }

  const locationHeaders = locationSheet
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map(String);
  for (const header of ['序号', '仓库编码', '仓库名称', '仓库状态', '库位编码', '库位名称', '库位状态', '库存批次', '库存流水']) {
    assert(locationHeaders.includes(header), `warehouse location config export missing header ${header}`);
  }

  let foundHistoryWarehouse = false;
  let foundHistoryLocation = false;
  let foundEnabledWarehouseDisabledLocation = false;
  warehouseSheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.text.includes(`${testPrefix}-HISTORY`)) {
        foundHistoryWarehouse = true;
      }
    });
  });
  locationSheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.text.includes(`${testPrefix}-HISTORY-L1`)) {
        foundHistoryLocation = true;
      }
      if (cell.text.includes(`${testPrefix}-LOC-DISABLED-L1`)) {
        foundEnabledWarehouseDisabledLocation = true;
      }
    });
  });
  assert(foundHistoryWarehouse, 'warehouse config export should include disabled warehouse with inventory history when status=ALL');
  assert(foundHistoryLocation, 'warehouse config export should include disabled location with inventory history when status=ALL');
  assert(foundEnabledWarehouseDisabledLocation, 'warehouse config export should include disabled location under enabled warehouse when status=ALL');

  const enabledOnlyResponse = await requestBuffer('/warehouses/export?status=ENABLED&includeTestFixtures=true');
  const enabledWorkbook = new ExcelJS.Workbook();
  await enabledWorkbook.xlsx.load(enabledOnlyResponse.buffer);
  const enabledWarehouseSheet = enabledWorkbook.getWorksheet('仓库配置');
  const enabledLocationSheet = enabledWorkbook.getWorksheet('库位配置');
  assert(enabledWarehouseSheet, 'enabled warehouse config export must include 仓库配置 sheet');
  assert(enabledLocationSheet, 'enabled warehouse config export must include 库位配置 sheet');
  assert(enabledWarehouseSheet.getCell('A2').text.includes('仓库状态：启用'), 'enabled warehouse config export scope should include warehouse status=ENABLED');
  assert(enabledWarehouseSheet.getCell('A2').text.includes('库位状态：启用'), 'enabled warehouse config export scope should include location status=ENABLED');

  let enabledExportIncludesDisabledWarehouse = false;
  let enabledExportIncludesDisabledLocation = false;
  let enabledExportIncludesEnabledWarehouseDisabledLocation = false;
  let enabledExportIncludesEnabledWarehouse = false;
  enabledWarehouseSheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.text.includes(`${testPrefix}-HISTORY`)) {
        enabledExportIncludesDisabledWarehouse = true;
      }
      if (cell.text.includes(`${testPrefix}-LOC-DISABLED`)) {
        enabledExportIncludesEnabledWarehouse = true;
      }
    });
  });
  enabledLocationSheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.text.includes(`${testPrefix}-HISTORY-L1`)) {
        enabledExportIncludesDisabledLocation = true;
      }
      if (cell.text.includes(`${testPrefix}-LOC-DISABLED-L1`)) {
        enabledExportIncludesEnabledWarehouseDisabledLocation = true;
      }
    });
  });
  assert(!enabledExportIncludesDisabledWarehouse, 'warehouse config export status=ENABLED must exclude disabled warehouses');
  assert(!enabledExportIncludesDisabledLocation, 'warehouse config export status=ENABLED must exclude locations under disabled warehouses');
  assert(enabledExportIncludesEnabledWarehouse, 'warehouse config export status=ENABLED should keep enabled warehouses even if some locations are disabled');
  assert(!enabledExportIncludesEnabledWarehouseDisabledLocation, 'warehouse config export status=ENABLED must exclude disabled locations under enabled warehouses');

  const enabledWarehousesAllLocationsResponse = await requestBuffer('/warehouses/export?status=ENABLED&locationStatus=ALL&includeTestFixtures=true');
  const enabledWarehousesAllLocationsWorkbook = new ExcelJS.Workbook();
  await enabledWarehousesAllLocationsWorkbook.xlsx.load(enabledWarehousesAllLocationsResponse.buffer);
  const enabledWarehousesAllLocationsWarehouseSheet = enabledWarehousesAllLocationsWorkbook.getWorksheet('仓库配置');
  const enabledWarehousesAllLocationsLocationSheet = enabledWarehousesAllLocationsWorkbook.getWorksheet('库位配置');
  assert(
    enabledWarehousesAllLocationsWarehouseSheet.getCell('A2').text.includes('库位状态：全部'),
    'warehouse config export should allow status=ENABLED with locationStatus=ALL'
  );
  let enabledWarehousesAllLocationsIncludesDisabledLocation = false;
  enabledWarehousesAllLocationsLocationSheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.text.includes(`${testPrefix}-LOC-DISABLED-L1`)) {
        enabledWarehousesAllLocationsIncludesDisabledLocation = true;
      }
    });
  });
  assert(
    enabledWarehousesAllLocationsIncludesDisabledLocation,
    'warehouse config export locationStatus=ALL should include disabled locations under enabled warehouses'
  );

  const disabledLocationsResponse = await requestBuffer('/warehouses/export?status=ALL&locationStatus=DISABLED&includeTestFixtures=true');
  const disabledLocationsWorkbook = new ExcelJS.Workbook();
  await disabledLocationsWorkbook.xlsx.load(disabledLocationsResponse.buffer);
  const disabledLocationsWarehouseSheet = disabledLocationsWorkbook.getWorksheet('仓库配置');
  const disabledLocationsSheet = disabledLocationsWorkbook.getWorksheet('库位配置');
  assert(
    disabledLocationsWarehouseSheet.getCell('A2').text.includes('仓库状态：全部') &&
      disabledLocationsWarehouseSheet.getCell('A2').text.includes('库位状态：停用'),
    'warehouse config export should allow status=ALL with locationStatus=DISABLED'
  );
  let disabledLocationsIncludesDisabledLocation = false;
  let disabledLocationsIncludesEnabledLocation = false;
  disabledLocationsSheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.text.includes(`${testPrefix}-LOC-DISABLED-L1`)) {
        disabledLocationsIncludesDisabledLocation = true;
      }
      if (cell.text.includes(`${testPrefix}-HISTORY-L1`)) {
        disabledLocationsIncludesDisabledLocation = true;
      }
      if (cell.text.includes(`${testPrefix}-LOC-ENABLED-L1`)) {
        disabledLocationsIncludesEnabledLocation = true;
      }
    });
  });
  assert(disabledLocationsIncludesDisabledLocation, 'warehouse config export locationStatus=DISABLED should include disabled locations');
  assert(!disabledLocationsIncludesEnabledLocation, 'warehouse config export locationStatus=DISABLED must exclude enabled locations');
}

async function main() {
  await cleanup();
  try {
    await assertEmptyWarehouseCanBeDeleted();
    await assertWarehouseWithHistoryCanOnlyBeDisabled();
    await assertWarehouseConfigExport();
    console.log('Warehouse config API verification passed.');
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
