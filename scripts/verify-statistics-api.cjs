#!/usr/bin/env node

const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
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
  process.env.STATISTICS_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const prisma = new PrismaClient();
const statisticsFixturePrefix = 'COD-STATS-STABLE';
const statisticsFixtureOrderNo = `${statisticsFixturePrefix}-ORDER`;
const statisticsFixturePartCode = `${statisticsFixturePrefix}-PART`;
const statisticsFixtureCustomerCode = `${statisticsFixturePrefix}-CUST`;
const statisticsFixtureCustomerName = `${statisticsFixturePrefix} 客户`;
const eventAttributionFixturePrefix = 'VERIFY-STATS-EVENT';
const eventAttributionFixtureOrderNo = `${eventAttributionFixturePrefix}-ORDER`;
const eventAttributionFixtureTaskNo = `${eventAttributionFixturePrefix}-TASK`;
const eventAttributionFixturePartCode = `${eventAttributionFixturePrefix}-PART`;
const eventAttributionFixtureCustomerCode = `${eventAttributionFixturePrefix}-CUST`;
const eventAttributionFixtureCustomerName = `${eventAttributionFixturePrefix} 客户`;
const testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function businessDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BUSINESS_TIME_ZONE || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';
  return {
    year: Number(year),
    month: Number(month),
    quarter: Math.floor((Number(month) - 1) / 3) + 1,
    dateText: `${year}-${month}-${day}`
  };
}

async function requestJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

function hasTestFixtureText(value) {
  const text = String(value || '');
  return testFixturePrefixes.some((prefix) => text.includes(prefix));
}

function assertStatisticsDoesNotExposeTestFixtures(statistics) {
  assert(
    !hasTestFixtureText(JSON.stringify(statistics)),
    'statistics default response must hide reusable test fixture orders, parts, inventory and customers'
  );
}

function utcDateFromBusinessText(dateText, hour = 0) {
  return new Date(`${dateText}T${String(hour).padStart(2, '0')}:00:00.000Z`);
}

function previousMonthOrderDate(currentBusinessDate) {
  const firstDayOfCurrentMonth = new Date(Date.UTC(currentBusinessDate.year, currentBusinessDate.month - 1, 1));
  return new Date(Date.UTC(
    firstDayOfCurrentMonth.getUTCFullYear(),
    firstDayOfCurrentMonth.getUTCMonth(),
    firstDayOfCurrentMonth.getUTCDate() - 3
  ));
}

function monthPeriodKey(currentBusinessDate) {
  return `${currentBusinessDate.year}-${String(currentBusinessDate.month).padStart(2, '0')}`;
}

function workbookHasFixturePrefix(workbook) {
  let matched = false;
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (hasTestFixtureText(cell.text || cell.value)) {
          matched = true;
        }
      });
    });
  });
  return matched;
}

async function upsertStatisticsWarehouse() {
  const warehouse = await prisma.warehouse.upsert({
    where: { warehouseCode: `${statisticsFixturePrefix}-WH` },
    update: {
      warehouseName: `${statisticsFixturePrefix} 仓库`,
      status: 'ENABLED'
    },
    create: {
      warehouseCode: `${statisticsFixturePrefix}-WH`,
      warehouseName: `${statisticsFixturePrefix} 仓库`,
      status: 'ENABLED'
    }
  });
  const existingLocation = await prisma.warehouseLocation.findFirst({
    where: { warehouseId: warehouse.id, locationCode: `${statisticsFixturePrefix}-LOC` },
    orderBy: { createdAt: 'asc' }
  });
  const location = existingLocation
    ? await prisma.warehouseLocation.update({
        where: { id: existingLocation.id },
        data: {
          locationName: `${statisticsFixturePrefix} 库位`,
          status: 'ENABLED'
        }
      })
    : await prisma.warehouseLocation.create({
        data: {
          warehouseId: warehouse.id,
          locationCode: `${statisticsFixturePrefix}-LOC`,
          locationName: `${statisticsFixturePrefix} 库位`,
          status: 'ENABLED'
        }
      });
  return { warehouse, location };
}

async function seedStatisticsFixture(currentBusinessDate) {
  const orderDate = new Date(`${currentBusinessDate.dateText}T00:00:00.000Z`);
  const customer = await prisma.customer.upsert({
    where: { customerCode: statisticsFixtureCustomerCode },
    update: {
      customerName: statisticsFixtureCustomerName,
      contactName: '统计验证',
      contactPhone: '13800000000',
      regionType: 'CHINA',
      province: '江苏省',
      city: '常州市',
      detailAddress: 'statistics fixture',
      status: 'ENABLED'
    },
    create: {
      customerCode: statisticsFixtureCustomerCode,
      customerName: statisticsFixtureCustomerName,
      contactName: '统计验证',
      contactPhone: '13800000000',
      regionType: 'CHINA',
      province: '江苏省',
      city: '常州市',
      detailAddress: 'statistics fixture',
      status: 'ENABLED'
    }
  });
  await prisma.material.upsert({
    where: { partCode: statisticsFixturePartCode },
    update: {
      partName: `${statisticsFixturePrefix} 零件`,
      unit: '件',
      status: 'ENABLED',
      stockAlertEnabled: true,
      stockAlertQuantity: 99
    },
    create: {
      partCode: statisticsFixturePartCode,
      partName: `${statisticsFixturePrefix} 零件`,
      unit: '件',
      status: 'ENABLED',
      stockAlertEnabled: true,
      stockAlertQuantity: 99
    }
  });
  const order = await prisma.customerOrder.upsert({
    where: { orderNo: statisticsFixtureOrderNo },
    update: {
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      customerSnapshot: {
        customerCode: customer.customerCode,
        customerName: customer.customerName
      },
      orderDate,
      deliveryDate: orderDate,
      status: 'DRAFT'
    },
    create: {
      orderNo: statisticsFixtureOrderNo,
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      customerSnapshot: {
        customerCode: customer.customerCode,
        customerName: customer.customerName
      },
      orderDate,
      deliveryDate: orderDate,
      status: 'DRAFT'
    }
  });
  const line = await prisma.orderLine.upsert({
    where: { orderId_lineNo: { orderId: order.id, lineNo: 1 } },
    update: {
      partCode: statisticsFixturePartCode,
      partName: `${statisticsFixturePrefix} 零件`,
      partThickness: 1,
      quantity: 9,
      productionPlanQuantity: 9,
      unit: '件',
      projectModel: `${statisticsFixturePrefix}-MODEL`
    },
    create: {
      orderId: order.id,
      lineNo: 1,
      partCode: statisticsFixturePartCode,
      partName: `${statisticsFixturePrefix} 零件`,
      partThickness: 1,
      quantity: 9,
      productionPlanQuantity: 9,
      unit: '件',
      projectModel: `${statisticsFixturePrefix}-MODEL`
    }
  });
  const { warehouse, location } = await upsertStatisticsWarehouse();
  await prisma.inventoryBatch.upsert({
    where: { batchNo: `${statisticsFixturePrefix}-BATCH` },
    update: {
      partCode: statisticsFixturePartCode,
      partName: `${statisticsFixturePrefix} 零件`,
      sourceOrderId: order.id,
      sourceOrderLineId: line.id,
      sourceOrderNo: order.orderNo,
      sourceCustomerName: customer.customerName,
      quantity: 7,
      unit: '件',
      warehouseId: warehouse.id,
      locationId: location.id,
      sourceKind: 'NORMAL_ORDER',
      status: 'AVAILABLE'
    },
    create: {
      batchNo: `${statisticsFixturePrefix}-BATCH`,
      partCode: statisticsFixturePartCode,
      partName: `${statisticsFixturePrefix} 零件`,
      sourceOrderId: order.id,
      sourceOrderLineId: line.id,
      sourceOrderNo: order.orderNo,
      sourceCustomerName: customer.customerName,
      quantity: 7,
      unit: '件',
      warehouseId: warehouse.id,
      locationId: location.id,
      sourceKind: 'NORMAL_ORDER',
      status: 'AVAILABLE'
    }
  });
}

async function cleanupEventAttributionFixture() {
  // statistics-event-attribution-reusable-fixture: keep one stable hidden fixture instead of deleting/recreating rows.
}

async function seedEventAttributionFixture(currentBusinessDate) {
  await cleanupEventAttributionFixture();
  const eventDate = utcDateFromBusinessText(currentBusinessDate.dateText, 8);
  const orderDate = previousMonthOrderDate(currentBusinessDate);
  const customerData = {
    customerName: eventAttributionFixtureCustomerName,
    contactName: '统计事件归属验证',
    contactPhone: '13800000001',
    regionType: 'CHINA',
    province: '江苏省',
    city: '常州市',
    detailAddress: 'statistics event attribution fixture',
    status: 'ENABLED'
  };
  const customer = await prisma.customer.upsert({
    where: { customerCode: eventAttributionFixtureCustomerCode },
    update: customerData,
    create: {
      customerCode: eventAttributionFixtureCustomerCode,
      ...customerData
    }
  });
  await prisma.material.upsert({
    where: { partCode: eventAttributionFixturePartCode },
    update: {
      partName: `${eventAttributionFixturePrefix} 零件`,
      unit: '件',
      status: 'ENABLED'
    },
    create: {
      partCode: eventAttributionFixturePartCode,
      partName: `${eventAttributionFixturePrefix} 零件`,
      unit: '件',
      status: 'ENABLED'
    }
  });
  const orderData = {
    customerId: customer.id,
    customerCode: customer.customerCode,
    customerName: customer.customerName,
    customerSnapshot: {
      customerCode: customer.customerCode,
      customerName: customer.customerName
    },
    orderDate,
    deliveryDate: eventDate,
    status: 'IN_PRODUCTION'
  };
  const order = await prisma.customerOrder.upsert({
    where: { orderNo: eventAttributionFixtureOrderNo },
    update: orderData,
    create: {
      orderNo: eventAttributionFixtureOrderNo,
      ...orderData
    }
  });
  const lineData = {
    partCode: eventAttributionFixturePartCode,
    partName: `${eventAttributionFixturePrefix} 零件`,
    partThickness: 1,
    quantity: 11,
    productionPlanQuantity: 11,
    unit: '件',
    projectModel: `${eventAttributionFixturePrefix}-MODEL`
  };
  const line = await prisma.orderLine.upsert({
    where: { orderId_lineNo: { orderId: order.id, lineNo: 1 } },
    update: lineData,
    create: {
      orderId: order.id,
      lineNo: 1,
      ...lineData
    }
  });
  const taskData = {
    orderId: order.id,
    orderLineId: line.id,
    orderNo: order.orderNo,
    customerName: customer.customerName,
    partCode: eventAttributionFixturePartCode,
    partName: `${eventAttributionFixturePrefix} 零件`,
    plannedQuantity: 11,
    completedQuantity: 3,
    unit: '件',
    status: 'COMPLETED',
    processSnapshot: [],
    startedAt: new Date(eventDate.getTime() - 60 * 60 * 1000),
    completedAt: eventDate
  };
  const task = await prisma.productionTask.upsert({
    where: { productionTaskNo: eventAttributionFixtureTaskNo },
    update: taskData,
    create: {
      productionTaskNo: eventAttributionFixtureTaskNo,
      ...taskData
    }
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { warehouseCode: `${eventAttributionFixturePrefix}-WH` },
    update: {
      warehouseName: `${eventAttributionFixturePrefix} 仓库`,
      status: 'ENABLED'
    },
    create: {
      warehouseCode: `${eventAttributionFixturePrefix}-WH`,
      warehouseName: `${eventAttributionFixturePrefix} 仓库`,
      status: 'ENABLED'
    }
  });
  const existingLocation = await prisma.warehouseLocation.findFirst({
    where: { warehouseId: warehouse.id, locationCode: `${eventAttributionFixturePrefix}-LOC` },
    orderBy: { createdAt: 'asc' }
  });
  const location = existingLocation
    ? await prisma.warehouseLocation.update({
        where: { id: existingLocation.id },
        data: {
          locationName: `${eventAttributionFixturePrefix} 库位`,
          status: 'ENABLED'
        }
      })
    : await prisma.warehouseLocation.create({
        data: {
          warehouseId: warehouse.id,
          locationCode: `${eventAttributionFixturePrefix}-LOC`,
          locationName: `${eventAttributionFixturePrefix} 库位`,
          status: 'ENABLED'
        }
      });
  const orderBatchData = {
    partCode: eventAttributionFixturePartCode,
    partName: `${eventAttributionFixturePrefix} 零件`,
    sourceOrderId: order.id,
    sourceOrderLineId: line.id,
    sourceOrderNo: order.orderNo,
    sourceCustomerName: customer.customerName,
    productionTaskId: null,
    sourceProductionTaskNo: null,
    quantity: 6,
    unit: '件',
    warehouseId: warehouse.id,
    locationId: location.id,
    sourceKind: 'NORMAL_ORDER',
    status: 'AVAILABLE'
  };
  const orderBatch = await prisma.inventoryBatch.upsert({
    where: { batchNo: `${eventAttributionFixturePrefix}-ORDER-BATCH` },
    update: orderBatchData,
    create: {
      batchNo: `${eventAttributionFixturePrefix}-ORDER-BATCH`,
      ...orderBatchData
    }
  });
  await prisma.inventoryTransaction.upsert({
    where: { transactionNo: `${eventAttributionFixturePrefix}-SHIP-OUT` },
    update: {
      transactionType: 'OUT',
      batchId: orderBatch.id,
      orderLineId: line.id,
      partCode: eventAttributionFixturePartCode,
      partName: `${eventAttributionFixturePrefix} 零件`,
      orderNo: order.orderNo,
      productionTaskNo: null,
      quantity: 2,
      unit: '件',
      warehouseId: warehouse.id,
      locationId: location.id,
      transactionTime: eventDate,
      sourceRecordType: 'InventoryBatch',
      sourceRecordId: orderBatch.id
    },
    create: {
      transactionNo: `${eventAttributionFixturePrefix}-SHIP-OUT`,
      transactionType: 'OUT',
      batchId: orderBatch.id,
      orderLineId: line.id,
      partCode: eventAttributionFixturePartCode,
      partName: `${eventAttributionFixturePrefix} 零件`,
      orderNo: order.orderNo,
      quantity: 2,
      unit: '件',
      warehouseId: warehouse.id,
      locationId: location.id,
      transactionTime: eventDate,
      sourceRecordType: 'InventoryBatch',
      sourceRecordId: orderBatch.id
    }
  });
  const stockBatchData = {
    partCode: eventAttributionFixturePartCode,
    partName: `${eventAttributionFixturePrefix} 零件`,
    sourceOrderId: null,
    sourceOrderLineId: null,
    sourceOrderNo: null,
    sourceCustomerName: customer.customerName,
    productionTaskId: task.id,
    sourceProductionTaskNo: task.productionTaskNo,
    sourceKind: 'NORMAL_ORDER',
    quantity: 4,
    unit: '件',
    warehouseId: warehouse.id,
    locationId: location.id,
    status: 'AVAILABLE'
  };
  const stockBatch = await prisma.inventoryBatch.upsert({
    where: { batchNo: `${eventAttributionFixturePrefix}-STOCK-BATCH` },
    update: stockBatchData,
    create: {
      batchNo: `${eventAttributionFixturePrefix}-STOCK-BATCH`,
      ...stockBatchData
    }
  });
  await prisma.inventoryTransaction.upsert({
    where: { transactionNo: `${eventAttributionFixturePrefix}-STOCK-IN` },
    update: {
      transactionType: 'IN',
      batchId: stockBatch.id,
      orderLineId: null,
      partCode: eventAttributionFixturePartCode,
      partName: `${eventAttributionFixturePrefix} 零件`,
      orderNo: null,
      productionTaskNo: task.productionTaskNo,
      quantity: 4,
      unit: '件',
      warehouseId: warehouse.id,
      locationId: location.id,
      transactionTime: eventDate,
      sourceRecordType: 'ProductionTaskOverage',
      sourceRecordId: task.id
    },
    create: {
      transactionNo: `${eventAttributionFixturePrefix}-STOCK-IN`,
      transactionType: 'IN',
      batchId: stockBatch.id,
      partCode: eventAttributionFixturePartCode,
      partName: `${eventAttributionFixturePrefix} 零件`,
      orderNo: null,
      productionTaskNo: task.productionTaskNo,
      quantity: 4,
      unit: '件',
      warehouseId: warehouse.id,
      locationId: location.id,
      transactionTime: eventDate,
      sourceRecordType: 'ProductionTaskOverage',
      sourceRecordId: task.id
    }
  });
  return { customer };
}

function assertEventAttributionStatistics(statistics, currentBusinessDate) {
  const eventPeriodKey = monthPeriodKey(currentBusinessDate);
  const summaryRow = (statistics.summaryRows || []).find(
    (row) => row.periodKey === eventPeriodKey && row.partCode === eventAttributionFixturePartCode && row.unit === '件'
  );
  assert(summaryRow, 'statistics month filter must include event-date production/shipment/stock-transfer summary row');
  assert(Number(summaryRow.customerOrderQuantity || 0) === 0, 'event-date month row must not include previous-month customer order quantity');
  assert(Number(summaryRow.productionPlanQuantity || 0) === 0, 'event-date month row must not include previous-month production plan quantity');
  assert(Number(summaryRow.completedProductionQuantity || 0) === 3, 'completed production quantity must be attributed by ProductionTask.completedAt');
  assert(Number(summaryRow.shippedOrderQuantity || 0) === 2, 'shipment quantity must be attributed by InventoryTransaction.transactionTime');
  assert(Number(summaryRow.stockQuantity || 0) === 4, 'stock transfer quantity must count ProductionTaskOverage by transactionTime');

  const customerRow = (statistics.customerRows || []).find(
    (row) => row.periodKey === eventPeriodKey && row.customerName === eventAttributionFixtureCustomerName && row.unit === '件'
  );
  assert(customerRow, 'statistics month filter must include event-date customer summary row');
  assert(Number(customerRow.completedProductionQuantity || 0) === 3, 'customer summary completed quantity must use event date');
  assert(Number(customerRow.shippedOrderQuantity || 0) === 2, 'customer summary shipment quantity must use event date');
  assert(Number(customerRow.stockQuantity || 0) === 4, 'customer summary stock transfer quantity must use event date');
  assert(
    !(statistics.orderRows || []).some((row) => row.orderNo === eventAttributionFixtureOrderNo),
    'month order rows must still be scoped by CustomerOrder.orderDate, not event dates'
  );
}

async function assertStatisticsExport(path, expectedScopeSnippets = []) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `统计导出 content-type 必须是真实 xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('order-statistics-export.xlsx'), '统计导出缺少固定响应文件名');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '统计导出必须是 xlsx zip 文件');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  for (const sheetName of ['总汇总', '客户汇总', '零件汇总', '订单展示', '库存快照']) {
    assert(sheetNames.includes(sheetName), `统计导出缺少工作表 ${sheetName}`);
  }
  assert(workbook.getWorksheet('总汇总').getCell('A1').text === '订单统计表 - 总汇总', '统计总汇总导出标题不正确');
  assert(workbook.getWorksheet('客户汇总').getCell('A1').text === '订单统计表 - 客户汇总', '统计客户汇总导出标题不正确');
  assert(workbook.getWorksheet('零件汇总').getCell('A1').text === '订单统计表 - 零件汇总', '统计零件汇总导出标题不正确');
  assert(workbook.getWorksheet('订单展示').getCell('A1').text === '订单统计表 - 订单展示', '统计订单展示导出标题不正确');
  assert(workbook.getWorksheet('库存快照').getCell('A1').text === '订单统计表 - 库存快照', '统计库存快照导出标题不正确');
  const exportScopeText = workbook.getWorksheet('客户汇总').getCell('A2').text;
  assert(exportScopeText.includes('统计截止'), '统计导出范围说明必须包含统计截止日期');
  for (const snippet of expectedScopeSnippets) {
    assert(exportScopeText.includes(snippet), `统计导出范围说明缺少筛选条件：${snippet}`);
  }
  assert(!workbookHasFixturePrefix(workbook), 'statistics default export must hide reusable test fixture orders, parts, inventory and customers');

  const totalHeaders = workbook
    .getWorksheet('总汇总')
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '统计范围', '指标', '数量', '单位']) {
    assert(totalHeaders.includes(header), `统计总汇总导出缺少表头 ${header}`);
  }
  const totalMetricText = workbook
    .getWorksheet('总汇总')
    .getColumn(3)
    .values.map((value) => String(value || ''))
    .join('\n');
  for (const metric of [
    '订单数',
    '客户订单数量',
    '生产计划数量',
    '实际完成数量',
    '订单发货数量',
    '转库存数量',
    '当前库存数量',
    '当前订单库存数量',
    '当前备货库存数量',
    '报废数量'
  ]) {
    assert(totalMetricText.includes(metric), `统计总汇总导出缺少指标 ${metric}`);
  }

  const customerHeaders = workbook
    .getWorksheet('客户汇总')
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '统计周期', '客户', '订单数', '当前库存数量', '当前订单库存数量', '当前备货库存数量', '报废数量', '单位']) {
    assert(customerHeaders.includes(header), `统计客户汇总导出缺少表头 ${header}`);
  }
  const inventorySnapshotHeaders = workbook
    .getWorksheet('库存快照')
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map((value) => String(value));
  for (const header of ['序号', '零件编码', '零件名称', '批次数', '仓库数', '账面数量', '预占数量', '可用数量', '订单库存', '备货库存', '库存报警', '单位']) {
    assert(inventorySnapshotHeaders.includes(header), `统计库存快照导出缺少表头 ${header}`);
  }
  let inventorySnapshotRowCount = 0;
  workbook.getWorksheet('库存快照').eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > 4 && row.getCell(1).text.trim()) {
      inventorySnapshotRowCount += 1;
    }
  });
  return { byteLength: buffer.length, sheetNames, inventorySnapshotRowCount };
}

async function main() {
  const currentBusinessDate = businessDateParts();
  const currentYear = currentBusinessDate.year;
  const futureYear = currentYear + 1;
  await seedStatisticsFixture(currentBusinessDate);
  const eventAttributionFixture = await seedEventAttributionFixture(currentBusinessDate);

  const statisticsOptions = await requestJson('/statistics/options');
  assert(Array.isArray(statisticsOptions.years), 'statistics options must return selectable years');
  assert(statisticsOptions.years.includes(currentYear), 'statistics options must include current business year');
  assert(statisticsOptions.currentBusinessDate === currentBusinessDate.dateText, 'statistics options must return current business date');
  assert(statisticsOptions.currentBusinessYear === currentYear, 'statistics options must return current business year');
  assert(statisticsOptions.currentBusinessQuarter === currentBusinessDate.quarter, 'statistics options must return current business quarter');
  assert(statisticsOptions.currentBusinessMonth === currentBusinessDate.month, 'statistics options must return current business month');
  assert(statisticsOptions.years.every((item, index, rows) => index === 0 || rows[index - 1] > item), 'statistics options years must be sorted descending');
  const statisticsOptionsWithFixtures = await requestJson('/statistics/options?includeTestFixtures=true');
  assert(
    statisticsOptionsWithFixtures.years.length >= statisticsOptions.years.length,
    'statistics options includeTestFixtures=true must not reduce selectable years'
  );

  const currentYearStatistics = await requestJson(`/statistics/orders?period=month&year=${currentYear}`);
  assertStatisticsDoesNotExposeTestFixtures(currentYearStatistics);
  assert(currentYearStatistics.period === 'month', '统计接口必须回显请求的 period=month');
  assert(currentYearStatistics.year === currentYear, '统计接口必须回显当前业务年份');
  assert(currentYearStatistics.month === undefined, '未选择月份时统计接口不得强行回显月份筛选');
  assert(currentYearStatistics.quarter === undefined, '未选择季度时统计接口不得强行回显季度筛选');
  assert(currentYearStatistics.currentBusinessDate === currentBusinessDate.dateText, '统计接口必须按业务时区返回当前真实日期');
  assert(currentYearStatistics.statisticsEndDate === currentBusinessDate.dateText, '当前年份统计必须截止到当前真实业务日期');
  assert(currentYearStatistics.isFuturePeriod === false, '当前年份不能标记为未来期间');
  assert(currentYearStatistics.isCurrentPeriodPartial === true, '当前年份必须标记为截止当前日期的部分期间');
  assert(
    String(currentYearStatistics.cutoffNotice || '').includes('未来日期不纳入已发生数据'),
    '当前年份统计必须提示未来日期不纳入已发生数据'
  );

  const monthFilteredStatistics = await requestJson(
    `/statistics/orders?period=month&year=${currentYear}&month=${currentBusinessDate.month}`
  );
  assertStatisticsDoesNotExposeTestFixtures(monthFilteredStatistics);
  assert(monthFilteredStatistics.period === 'month', '月份筛选统计必须保留 period=month');
  assert(monthFilteredStatistics.year === currentYear, '月份筛选统计必须回显年份');
  assert(monthFilteredStatistics.month === currentBusinessDate.month, '月份筛选统计必须回显所选月份');
  assert(monthFilteredStatistics.quarter === undefined, '月份筛选优先时不得同时回显季度筛选');
  assert(monthFilteredStatistics.statisticsEndDate === currentBusinessDate.dateText, '当前月份筛选必须截止到当前真实业务日期');
  assert(monthFilteredStatistics.isCurrentPeriodPartial === true, '当前月份筛选必须标记为当前部分期间');
  assert(
    !(monthFilteredStatistics.summaryRows || []).some((row) => row.partCode === eventAttributionFixturePartCode),
    'statistics default month filter must hide event attribution test fixture rows'
  );

  const monthFilteredStatisticsWithFixtures = await requestJson(
    `/statistics/orders?period=month&year=${currentYear}&month=${currentBusinessDate.month}&includeTestFixtures=true`
  );
  assertEventAttributionStatistics(monthFilteredStatisticsWithFixtures, currentBusinessDate);

  const customerFilteredEventStatistics = await requestJson(
    `/statistics/orders?period=month&year=${currentYear}&month=${currentBusinessDate.month}&customerId=${encodeURIComponent(
      eventAttributionFixture.customer.id
    )}&includeTestFixtures=true`
  );
  assertEventAttributionStatistics(customerFilteredEventStatistics, currentBusinessDate);

  const quarterFilteredStatistics = await requestJson(
    `/statistics/orders?period=quarter&year=${currentYear}&quarter=${currentBusinessDate.quarter}`
  );
  assertStatisticsDoesNotExposeTestFixtures(quarterFilteredStatistics);
  assert(quarterFilteredStatistics.period === 'quarter', '季度筛选统计必须保留 period=quarter');
  assert(quarterFilteredStatistics.year === currentYear, '季度筛选统计必须回显年份');
  assert(quarterFilteredStatistics.quarter === currentBusinessDate.quarter, '季度筛选统计必须回显所选季度');
  assert(quarterFilteredStatistics.month === undefined, '季度筛选统计不得同时回显月份筛选');
  assert(quarterFilteredStatistics.statisticsEndDate === currentBusinessDate.dateText, '当前季度筛选必须截止到当前真实业务日期');
  assert(quarterFilteredStatistics.isCurrentPeriodPartial === true, '当前季度筛选必须标记为当前部分期间');
  const yearWithNarrowFiltersStatistics = await requestJson(
    `/statistics/orders?period=year&year=${currentYear}&quarter=${currentBusinessDate.quarter}&month=${currentBusinessDate.month}`
  );
  assert(yearWithNarrowFiltersStatistics.period === 'year', 'period=year must remain year even when quarter/month are sent');
  assert(yearWithNarrowFiltersStatistics.quarter === undefined, 'period=year must ignore direct quarter filters');
  assert(yearWithNarrowFiltersStatistics.month === undefined, 'period=year must ignore direct month filters');
  assert(
    yearWithNarrowFiltersStatistics.statisticsEndDate === currentBusinessDate.dateText,
    'period=year with stray quarter/month filters must still use the year window'
  );
  const quarterWithConflictingMonthStatistics = await requestJson(
    `/statistics/orders?period=quarter&year=${currentYear}&quarter=${currentBusinessDate.quarter}&month=${currentBusinessDate.month}`
  );
  assert(
    quarterWithConflictingMonthStatistics.quarter === currentBusinessDate.quarter,
    'period=quarter must keep the requested quarter when a stray month is sent'
  );
  assert(quarterWithConflictingMonthStatistics.month === undefined, 'period=quarter must ignore direct month filters');
  const monthWithConflictingQuarterStatistics = await requestJson(
    `/statistics/orders?period=month&year=${currentYear}&quarter=${currentBusinessDate.quarter}&month=${currentBusinessDate.month}`
  );
  assert(monthWithConflictingQuarterStatistics.month === currentBusinessDate.month, 'period=month must keep the requested month');
  assert(monthWithConflictingQuarterStatistics.quarter === undefined, 'period=month must ignore direct quarter filters');
  assert(Array.isArray(currentYearStatistics.summaryRows), '当前年份统计必须返回 summaryRows 数组');
  assert(Array.isArray(currentYearStatistics.customerRows), '当前年份统计必须返回 customerRows 数组');
  assert(Array.isArray(currentYearStatistics.orderRows), '当前年份统计必须返回 orderRows 数组');
  assert(Array.isArray(currentYearStatistics.inventorySnapshotRows), '当前年份统计必须返回库存快照 inventorySnapshotRows 数组');
  assert(
    Number.isInteger(currentYearStatistics.inventorySnapshotTotal),
    'statistics inventory snapshot must return inventorySnapshotTotal'
  );
  assert(
    Number.isInteger(currentYearStatistics.inventorySnapshotOffset),
    'statistics inventory snapshot must return inventorySnapshotOffset'
  );
  assert(
    Number.isInteger(currentYearStatistics.inventorySnapshotLimit),
    'statistics inventory snapshot must return inventorySnapshotLimit'
  );
  assert(
    typeof currentYearStatistics.inventorySnapshotHasMore === 'boolean',
    'statistics inventory snapshot must return inventorySnapshotHasMore'
  );
  for (const row of currentYearStatistics.inventorySnapshotRows || []) {
    for (const field of [
      'partCode',
      'partName',
      'unit',
      'batchCount',
      'warehouseCount',
      'physicalQuantity',
      'reservedQuantity',
      'availableQuantity',
      'orderInventoryQuantity',
      'stockInventoryQuantity',
      'stockAlertEnabled',
      'stockAlertTriggered'
    ]) {
      assert(Object.prototype.hasOwnProperty.call(row, field), `库存快照行必须返回 ${field} 字段`);
    }
    assert(
      Number(row.orderInventoryQuantity || 0) + Number(row.stockInventoryQuantity || 0) === Number(row.availableQuantity || 0),
      '库存快照行可用数量必须等于订单库存与备货库存之和'
    );
  }
  const pagedInventorySnapshotStatistics = await requestJson(
    `/statistics/orders?period=month&year=${currentYear}&inventorySnapshotLimit=1&inventorySnapshotOffset=0`
  );
  assert(
    pagedInventorySnapshotStatistics.inventorySnapshotRows.length <= 1,
    'statistics inventory snapshot page must respect inventorySnapshotLimit'
  );
  assert(
    pagedInventorySnapshotStatistics.inventorySnapshotLimit === 1,
    'statistics inventory snapshot page must echo inventorySnapshotLimit'
  );
  assert(
    pagedInventorySnapshotStatistics.inventorySnapshotOffset === 0,
    'statistics inventory snapshot page must echo inventorySnapshotOffset'
  );
  assert(
    pagedInventorySnapshotStatistics.inventorySnapshotTotal === currentYearStatistics.inventorySnapshotTotal,
    'statistics inventory snapshot pagination must keep full total count'
  );
  const paginatedExportInfo = await assertStatisticsExport(
    `/statistics/orders/export?period=month&year=${currentYear}&inventorySnapshotLimit=1&inventorySnapshotOffset=0`,
    ['统计周期：月度', `年份：${currentYear}`]
  );
  assert(
    paginatedExportInfo.inventorySnapshotRowCount === currentYearStatistics.inventorySnapshotTotal,
    'statistics export must ignore inventorySnapshotLimit and export the full inventory snapshot'
  );
  for (const row of currentYearStatistics.summaryRows || []) {
    assert(Object.prototype.hasOwnProperty.call(row, 'currentInventoryQuantity'), '统计汇总行必须返回当前库存数量字段');
    assert(Object.prototype.hasOwnProperty.call(row, 'currentOrderInventoryQuantity'), '统计汇总行必须返回当前订单库存数量字段');
    assert(Object.prototype.hasOwnProperty.call(row, 'currentStockInventoryQuantity'), '统计汇总行必须返回当前备货库存数量字段');
    assert(Object.prototype.hasOwnProperty.call(row, 'scrapQuantity'), '统计汇总行必须返回报废数量字段');
    assert(
      Number(row.currentOrderInventoryQuantity || 0) + Number(row.currentStockInventoryQuantity || 0) === Number(row.currentInventoryQuantity || 0),
      '统计汇总行当前库存数量必须等于订单库存与备货库存之和'
    );
  }
  for (const row of currentYearStatistics.customerRows || []) {
    assert(Object.prototype.hasOwnProperty.call(row, 'customerName'), '客户汇总行必须返回 customerName 字段');
    assert(Object.prototype.hasOwnProperty.call(row, 'orderCount'), '客户汇总行必须返回 orderCount 字段');
    assert(Object.prototype.hasOwnProperty.call(row, 'currentInventoryQuantity'), '客户汇总行必须返回当前库存数量字段');
    assert(Object.prototype.hasOwnProperty.call(row, 'currentOrderInventoryQuantity'), '客户汇总行必须返回当前订单库存数量字段');
    assert(Object.prototype.hasOwnProperty.call(row, 'currentStockInventoryQuantity'), '客户汇总行必须返回当前备货库存数量字段');
    assert(Object.prototype.hasOwnProperty.call(row, 'scrapQuantity'), '客户汇总行必须返回报废数量字段');
    assert(
      Number(row.currentOrderInventoryQuantity || 0) + Number(row.currentStockInventoryQuantity || 0) === Number(row.currentInventoryQuantity || 0),
      '客户汇总行当前库存数量必须等于订单库存与备货库存之和'
    );
  }
  const exportInfo = await assertStatisticsExport(
    `/statistics/orders/export?period=month&year=${currentYear}&month=${currentBusinessDate.month}`,
    ['统计周期：月度', `年份：${currentYear}`, `月份：${currentBusinessDate.month}月`]
  );
  await assertStatisticsExport(
    `/statistics/orders/export?period=quarter&year=${currentYear}&quarter=${currentBusinessDate.quarter}`,
    ['统计周期：季度', `年份：${currentYear}`, `季度：第${currentBusinessDate.quarter}季度`]
  );

  const futureStatistics = await requestJson(`/statistics/orders?period=year&year=${futureYear}`);
  assert(futureStatistics.period === 'year', '未来年份统计必须回显 period=year');
  assert(futureStatistics.year === futureYear, '未来年份统计必须回显请求年份');
  assert(futureStatistics.currentBusinessDate === currentBusinessDate.dateText, '未来年份统计必须返回当前真实业务日期');
  assert(futureStatistics.statisticsEndDate === currentBusinessDate.dateText, '未来年份统计截止日期必须保持当前真实业务日期');
  assert(futureStatistics.isFuturePeriod === true, '未来年份必须标记为未来期间');
  assert(futureStatistics.isCurrentPeriodPartial === false, '未来年份不能标记为当前部分期间');
  assert(Array.isArray(futureStatistics.summaryRows) && futureStatistics.summaryRows.length === 0, '未来年份不能返回汇总行');
  assert(Array.isArray(futureStatistics.customerRows) && futureStatistics.customerRows.length === 0, '未来年份不能返回客户汇总行');
  assert(Array.isArray(futureStatistics.orderRows) && futureStatistics.orderRows.length === 0, '未来年份不能返回订单行');
  assert(Array.isArray(futureStatistics.inventorySnapshotRows), '未来年份仍必须返回当前库存快照数组');
  assert(
    String(futureStatistics.cutoffNotice || '').includes('未来期间'),
    '未来年份统计必须明确提示未来期间不作为已发生数据'
  );

  const futureMonthStatistics = await requestJson(`/statistics/orders?period=month&year=${futureYear}&month=1`);
  assert(futureMonthStatistics.month === 1, '未来月份统计必须回显所选月份');
  assert(futureMonthStatistics.isFuturePeriod === true, '未来月份统计必须标记为未来期间');
  assert(Array.isArray(futureMonthStatistics.summaryRows) && futureMonthStatistics.summaryRows.length === 0, '未来月份不能返回汇总行');

  const completedYear = currentYear - 1;
  const completedYearStatistics = await requestJson(`/statistics/orders?period=quarter&year=${completedYear}`);
  assert(completedYearStatistics.period === 'quarter', '历史年份统计必须回显 period=quarter');
  assert(completedYearStatistics.year === completedYear, '历史年份统计必须回显请求年份');
  assert(completedYearStatistics.statisticsEndDate === `${completedYear}-12-31`, '历史年份统计截止日期必须是当年年末');
  assert(completedYearStatistics.isFuturePeriod === false, '历史年份不能标记为未来期间');
  assert(completedYearStatistics.isCurrentPeriodPartial === false, '历史年份不能标记为当前部分期间');

  const completedQuarterStatistics = await requestJson(`/statistics/orders?period=quarter&year=${completedYear}&quarter=4`);
  assert(completedQuarterStatistics.quarter === 4, '历史季度统计必须回显所选季度');
  assert(completedQuarterStatistics.statisticsEndDate === `${completedYear}-12-31`, '历史第四季度统计截止日期必须是第四季度末');
  assert(completedQuarterStatistics.isCurrentPeriodPartial === false, '历史季度不能标记为当前部分期间');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'statistics-current-year-cutoff',
          'statistics-options-years',
          'statistics-month-filter',
          'statistics-quarter-filter',
          'statistics-event-date-attribution',
          'statistics-event-date-customer-filter',
          'statistics-period-filter-normalization',
          'statistics-test-fixture-filter',
          'statistics-export-test-fixture-filter',
          'statistics-current-inventory-and-scrap-fields',
          'statistics-current-inventory-source-split-fields',
          'statistics-current-inventory-snapshot-rows',
          'statistics-inventory-snapshot-pagination',
          'statistics-customer-summary-fields',
          'statistics-export-full-inventory-snapshot',
          'statistics-total-summary-export',
          'statistics-export-xlsx',
          'statistics-month-export-scope',
          'statistics-quarter-export-scope',
          'statistics-future-year-empty',
          'statistics-future-month-empty',
          'statistics-completed-year-end-date',
          'statistics-completed-quarter-end-date'
        ],
        ...exportInfo,
        currentBusinessDate: currentBusinessDate.dateText,
        currentYear,
        futureYear
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
