#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
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
  process.env.INVENTORY_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const prisma = new PrismaClient();
const runId = 'STABLE';
const testPrefix = 'COD-INV-EXP-STABLE';
const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function headerColumnMap(sheet, rowNumber = 4) {
  const columns = new Map();
  sheet.getRow(rowNumber).eachCell((cell, columnNumber) => {
    columns.set(String(cell.text || cell.value || '').trim(), columnNumber);
  });
  return columns;
}

function numericCell(row, columnNumber, label) {
  const rawValue = row.getCell(columnNumber).value;
  const value = typeof rawValue === 'number' ? rawValue : Number(String(row.getCell(columnNumber).text || rawValue || '').replace(/,/g, ''));
  assert(Number.isFinite(value), `${label} 必须是数值，实际 ${row.getCell(columnNumber).text || rawValue || '-'}`);
  return value;
}

function assertInventoryExportSummaryRow(summarySheet, expectedSummary) {
  const headerColumns = headerColumnMap(summarySheet);
  for (const header of ['零件编码', '订单库存', '备货库存', '正常备货', '取消转备货', '客户变更转备货', '可用数量']) {
    assert(headerColumns.has(header), `库存汇总导出缺少表头 ${header}`);
  }

  const partCodeColumn = headerColumns.get('零件编码');
  const dataRow = [];
  summarySheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 4) {
      return;
    }
    if (row.getCell(partCodeColumn).text === expectedSummary.partCode) {
      dataRow.push(row);
    }
  });
  assert(dataRow.length === 1, `库存导出必须精确返回 1 行隔离测试零件 ${expectedSummary.partCode}，实际 ${dataRow.length}`);

  const row = dataRow[0];
  const orderInventoryQuantity = numericCell(row, headerColumns.get('订单库存'), '订单库存');
  const stockInventoryQuantity = numericCell(row, headerColumns.get('备货库存'), '备货库存');
  const normalOrderStockQuantity = numericCell(row, headerColumns.get('正常备货'), '正常备货');
  const cancelledOrderStockQuantity = numericCell(row, headerColumns.get('取消转备货'), '取消转备货');
  const customerChangeStockQuantity = numericCell(row, headerColumns.get('客户变更转备货'), '客户变更转备货');
  const availableQuantity = numericCell(row, headerColumns.get('可用数量'), '可用数量');
  assert(orderInventoryQuantity === expectedSummary.orderInventoryQuantity, `订单库存应为 ${expectedSummary.orderInventoryQuantity}，实际 ${orderInventoryQuantity}`);
  assert(stockInventoryQuantity === expectedSummary.stockInventoryQuantity, `备货库存应为 ${expectedSummary.stockInventoryQuantity}，实际 ${stockInventoryQuantity}`);
  assert(normalOrderStockQuantity === expectedSummary.normalOrderStockQuantity, `正常备货应为 ${expectedSummary.normalOrderStockQuantity}，实际 ${normalOrderStockQuantity}`);
  assert(cancelledOrderStockQuantity === expectedSummary.cancelledOrderStockQuantity, `取消转备货应为 ${expectedSummary.cancelledOrderStockQuantity}，实际 ${cancelledOrderStockQuantity}`);
  assert(customerChangeStockQuantity === expectedSummary.customerChangeStockQuantity, `客户变更转备货应为 ${expectedSummary.customerChangeStockQuantity}，实际 ${customerChangeStockQuantity}`);
  assert(
    stockInventoryQuantity === normalOrderStockQuantity + cancelledOrderStockQuantity + customerChangeStockQuantity,
    `备货库存必须等于三类备货来源合计，实际 ${stockInventoryQuantity} != ${normalOrderStockQuantity}+${cancelledOrderStockQuantity}+${customerChangeStockQuantity}`
  );
  assert(
    availableQuantity === orderInventoryQuantity + stockInventoryQuantity,
    `可用数量必须等于订单库存和备货库存合计，实际 ${availableQuantity} != ${orderInventoryQuantity}+${stockInventoryQuantity}`
  );
}

function workbookDataRowsHaveTestFixturePrefix(workbook) {
  let found = false;
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 4) {
        return;
      }
      row.eachCell((cell) => {
        const text = String(cell.text || cell.value || '');
        if (testFixturePrefixes.some((prefix) => text.includes(prefix))) {
          found = true;
        }
      });
    });
  });
  return found;
}

async function assertInventoryExport(path, expectedScopeTexts, expectedSummary) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }

  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `库存导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('inventory-export.xlsx'), '库存导出缺少固定响应文件名');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '库存导出必须是 .xlsx zip 文件');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  assert(sheetNames.includes('库存汇总'), `库存导出缺少 库存汇总 工作表：${sheetNames.join(', ')}`);
  assert(sheetNames.includes('库存批次'), `库存导出缺少 库存批次 工作表：${sheetNames.join(', ')}`);

  const summarySheet = workbook.getWorksheet('库存汇总');
  const batchSheet = workbook.getWorksheet('库存批次');
  assert(summarySheet.getCell('A1').text === '库存汇总导出', '库存汇总导出标题不正确');
  assert(batchSheet.getCell('A1').text === '库存批次导出', '库存批次导出标题不正确');
  for (const expectedScopeText of expectedScopeTexts) {
    assert(summarySheet.getCell('A2').text.includes(expectedScopeText), `库存汇总范围说明缺少 ${expectedScopeText}`);
    assert(batchSheet.getCell('A2').text.includes(expectedScopeText), `库存批次范围说明缺少 ${expectedScopeText}`);
  }

  const summaryHeaders = summarySheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of [
    '序号',
    '零件编码',
    '零件名称',
    '单位',
    '批次数',
    '仓库数',
    '账面数量',
    '预占数量',
    '可用数量',
    '已出库/已使用数量',
    '累计数量',
    '订单库存',
    '备货库存',
    '正常备货',
    '取消转备货',
    '客户变更转备货',
    '库存报警',
    '最小库存',
    '仓库分布'
  ]) {
    assert(summaryHeaders.includes(header), `库存汇总导出缺少表头 ${header}`);
  }

  const batchHeaders = batchSheet
    .getRow(4)
    .values
    .filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '批次号', '零件编码', '图号', '账面数量', '预占数量', '可用数量', '库存来源', '来源订单', '生产任务', '仓库', '库位', '状态']) {
    assert(batchHeaders.includes(header), `库存批次导出缺少表头 ${header}`);
  }
  if (expectedSummary) {
    assertInventoryExportSummaryRow(summarySheet, expectedSummary);
  }

  return { byteLength: buffer.length, sheetNames, summaryRowCount: summarySheet.rowCount, batchRowCount: batchSheet.rowCount };
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
  const customer = await prisma.customer.findFirst({
    where: {
      OR: [
        { customerCode: `${testPrefix}-CUST` },
        { customerCode: { startsWith: `${testPrefix}-CUST__DISABLED__` } },
        { customerName: { startsWith: `Inventory Export Source Split Customer ${runId}__DISABLED__` } }
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
        customerName: `Inventory Export Source Split Customer ${runId}${archiveSuffix}`,
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

async function seedInventoryExportRows() {
  await cleanupDatabase();
  const customerName = `Inventory Export Source Split Customer ${runId}`;
  const customerCode = `${testPrefix}-CUST`;
  const customerData = {
    customerCode,
    customerName,
    regionType: 'CHINA',
    country: 'China',
    province: 'Jiangsu',
    city: 'Suzhou',
    detailAddress: 'Inventory export regression address',
    status: 'ENABLED'
  };
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
  const customer = existingCustomer
    ? await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: customerData
      })
    : await prisma.customer.create({
        data: customerData
      });
  const order = await prisma.customerOrder.create({
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
  const line = await prisma.orderLine.create({
    data: {
      orderId: order.id,
      lineNo: 1,
      partCode: `${testPrefix}-PART`,
      partName: 'Inventory Export Source Split Part',
      partThickness: 1,
      quantity: 14,
      productionPlanQuantity: 14,
      unit: '件'
    }
  });
  const warehouse = await upsertRegressionWarehouse(`${testPrefix}-WH`, 'Inventory Export Regression Warehouse');
  const location = await upsertRegressionWarehouseLocation(warehouse.id, `${testPrefix}-LOC`, 'Inventory Export Regression Location');
  const baseBatch = {
    partCode: line.partCode,
    partName: line.partName,
    unit: line.unit,
    warehouseId: warehouse.id,
    locationId: location.id,
    status: 'AVAILABLE'
  };
  // 库存导出必须区分订单库存和三类备货来源，不能只导出一个合并库存数。
  await prisma.inventoryBatch.createMany({
    data: [
      {
        ...baseBatch,
        batchNo: `${testPrefix}-ORDER-BATCH`,
        quantity: 3,
        sourceOrderId: order.id,
        sourceOrderLineId: line.id,
        sourceOrderNo: order.orderNo,
        sourceCustomerName: customer.customerName,
        sourceKind: 'NORMAL_ORDER'
      },
      {
        ...baseBatch,
        batchNo: `${testPrefix}-NORMAL-STOCK`,
        quantity: 5,
        sourceOrderNo: `${testPrefix}-NORMAL-SOURCE`,
        sourceCustomerName: customer.customerName,
        sourceKind: 'NORMAL_ORDER'
      },
      {
        ...baseBatch,
        batchNo: `${testPrefix}-CANCELLED-STOCK`,
        quantity: 2,
        sourceOrderNo: `${testPrefix}-CANCELLED-SOURCE`,
        sourceCustomerName: customer.customerName,
        sourceKind: 'CANCELLED_ORDER'
      },
      {
        ...baseBatch,
        batchNo: `${testPrefix}-CHANGE-STOCK`,
        quantity: 4,
        sourceOrderNo: `${testPrefix}-CHANGE-SOURCE`,
        sourceCustomerName: customer.customerName,
        sourceKind: 'CUSTOMER_CHANGE'
      }
    ]
  });

  return {
    partCode: line.partCode,
    orderInventoryQuantity: 3,
    stockInventoryQuantity: 11,
    normalOrderStockQuantity: 5,
    cancelledOrderStockQuantity: 2,
    customerChangeStockQuantity: 4
  };
}

async function main() {
  try {
    const emptyExportInfo = await assertInventoryExport(
      '/inventory/export?keyword=NO_MATCH_FOR_EXPORT&status=AVAILABLE&stockAlert=ALL',
      ['关键词：NO_MATCH_FOR_EXPORT', '状态：可用', '库存报警：全部']
    );
    const fixture = await seedInventoryExportRows();
    const sourceSplitExportInfo = await assertInventoryExport(
      `/inventory/export?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=ALL&includeTestFixtures=true`,
      [`关键词：${fixture.partCode}`, '状态：可用', '库存报警：全部'],
      fixture
    );
    const defaultExportInfo = await assertInventoryExport(
      `/inventory/export?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=ALL`,
      [`关键词：${fixture.partCode}`, '状态：可用', '库存报警：全部']
    );
    const defaultExportResponse = await fetch(
      `${apiBaseUrl}/inventory/export?keyword=${encodeURIComponent(fixture.partCode)}&status=AVAILABLE&stockAlert=ALL`
    );
    const defaultWorkbook = new ExcelJS.Workbook();
    await defaultWorkbook.xlsx.load(Buffer.from(await defaultExportResponse.arrayBuffer()));
    assert(!workbookDataRowsHaveTestFixturePrefix(defaultWorkbook), 'inventory export default response must hide reusable test fixture inventory');
    console.log(
      JSON.stringify(
        {
          ok: true,
          apiBaseUrl,
          checked: [
            'inventory-export-xlsx',
            'inventory-export-summary-sheet',
            'inventory-export-batch-sheet',
            'inventory-export-stock-source-split',
            'inventory-export-test-fixture-filter'
          ],
          emptyExportInfo,
          sourceSplitExportInfo,
          defaultExportInfo
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
