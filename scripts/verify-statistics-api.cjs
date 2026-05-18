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

async function assertStatisticsExport(path) {
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
  assert(workbook.getWorksheet('客户汇总').getCell('A2').text.includes('统计截止'), '统计导出范围说明必须包含统计截止日期');
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
  return { byteLength: buffer.length, sheetNames };
}

async function main() {
  const currentBusinessDate = businessDateParts();
  const currentYear = currentBusinessDate.year;
  const futureYear = currentYear + 1;
  await seedStatisticsFixture(currentBusinessDate);

  const currentYearStatistics = await requestJson(`/statistics/orders?period=month&year=${currentYear}`);
  assertStatisticsDoesNotExposeTestFixtures(currentYearStatistics);
  assert(currentYearStatistics.period === 'month', '统计接口必须回显请求的 period=month');
  assert(currentYearStatistics.year === currentYear, '统计接口必须回显当前业务年份');
  assert(currentYearStatistics.currentBusinessDate === currentBusinessDate.dateText, '统计接口必须按业务时区返回当前真实日期');
  assert(currentYearStatistics.statisticsEndDate === currentBusinessDate.dateText, '当前年份统计必须截止到当前真实业务日期');
  assert(currentYearStatistics.isFuturePeriod === false, '当前年份不能标记为未来期间');
  assert(currentYearStatistics.isCurrentPeriodPartial === true, '当前年份必须标记为截止当前日期的部分期间');
  assert(
    String(currentYearStatistics.cutoffNotice || '').includes('未来日期不纳入已发生数据'),
    '当前年份统计必须提示未来日期不纳入已发生数据'
  );
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
  const exportInfo = await assertStatisticsExport(`/statistics/orders/export?period=month&year=${currentYear}`);

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

  const completedYear = currentYear - 1;
  const completedYearStatistics = await requestJson(`/statistics/orders?period=quarter&year=${completedYear}`);
  assert(completedYearStatistics.period === 'quarter', '历史年份统计必须回显 period=quarter');
  assert(completedYearStatistics.year === completedYear, '历史年份统计必须回显请求年份');
  assert(completedYearStatistics.statisticsEndDate === `${completedYear}-12-31`, '历史年份统计截止日期必须是当年年末');
  assert(completedYearStatistics.isFuturePeriod === false, '历史年份不能标记为未来期间');
  assert(completedYearStatistics.isCurrentPeriodPartial === false, '历史年份不能标记为当前部分期间');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'statistics-current-year-cutoff',
          'statistics-test-fixture-filter',
          'statistics-export-test-fixture-filter',
          'statistics-current-inventory-and-scrap-fields',
          'statistics-current-inventory-source-split-fields',
          'statistics-current-inventory-snapshot-rows',
          'statistics-inventory-snapshot-pagination',
          'statistics-customer-summary-fields',
          'statistics-total-summary-export',
          'statistics-export-xlsx',
          'statistics-future-year-empty',
          'statistics-completed-year-end-date'
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
