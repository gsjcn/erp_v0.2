#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const { existsSync, readFileSync } = require('node:fs');
const { unlink } = require('node:fs/promises');
const { isAbsolute, join, resolve } = require('node:path');

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
  process.env.INVENTORY_ADJUSTMENT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  process.env.ORDER_IMPORT_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const prisma = new PrismaClient();
const runId = 'STABLE';
const testPrefix = 'COD-INV-ADJ-STABLE';
const uploadedAdjustmentFiles = [];

function uploadRootPath() {
  const configuredPath = process.env.UPLOAD_DIR?.trim();
  if (!configuredPath) {
    return resolve(rootDir, 'storage/uploads');
  }
  return isAbsolute(configuredPath) ? resolve(configuredPath) : resolve(rootDir, configuredPath);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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

async function expectRequestFailure(path, options, expectedMessage) {
  try {
    await requestJson(path, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expectedMessage), `expected request failure message to include ${expectedMessage}, actual=${message}`);
    return;
  }
  throw new Error(`expected request to fail with message: ${expectedMessage}`);
}

async function uploadAdjustmentAttachment(fileName) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(`inventory adjustment regression ${runId}`)], { type: 'image/png' }), fileName);
  const result = await requestJson('/inventory/adjustments/upload', {
    method: 'POST',
    body: form
  });
  uploadedAdjustmentFiles.push(result.storedFileName);
  return result;
}

async function cleanupUploadedFiles() {
  const uploadDir = join(uploadRootPath(), 'inventory-adjustments');
  for (const fileName of uploadedAdjustmentFiles) {
    if (!fileName) {
      continue;
    }
    await unlink(join(uploadDir, fileName)).catch(() => undefined);
  }
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
  await prisma.customerOrder.deleteMany({ where: { orderNo: { startsWith: testPrefix } } });
  const customer = await prisma.customer.findFirst({
    where: {
      OR: [
        { customerCode: `${testPrefix}-CUST` },
        { customerCode: { startsWith: `${testPrefix}-CUST__DISABLED__` } },
        { customerName: { startsWith: `Inventory Adjustment Reservation Customer ${runId}__DISABLED__` } }
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
        customerName: `Inventory Adjustment Reservation Customer ${runId}${archiveSuffix}`,
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

async function seedInventoryBatch(batchNoSuffix = 'BATCH', quantity = 5) {
  const warehouse = await upsertRegressionWarehouse(
    `${testPrefix}-${batchNoSuffix}-WH`,
    `Inventory Adjustment API Warehouse ${batchNoSuffix}`
  );
  const location = await upsertRegressionWarehouseLocation(
    warehouse.id,
    `${testPrefix}-${batchNoSuffix}-LOC`,
    `Inventory Adjustment API Location ${batchNoSuffix}`
  );
  const batch = await prisma.inventoryBatch.create({
    data: {
      batchNo: `${testPrefix}-${batchNoSuffix}`,
      partCode: `${testPrefix}-PART-${batchNoSuffix}`,
      partName: `Inventory Adjustment API Part ${batchNoSuffix}`,
      quantity,
      unit: '件',
      warehouseId: warehouse.id,
      locationId: location.id,
      status: 'AVAILABLE'
    }
  });
  return { warehouse, location, batch };
}

async function seedActiveReservation(batch, reservedQuantity = 4) {
  const customerName = `Inventory Adjustment Reservation Customer ${runId}`;
  const customerCode = `${testPrefix}-CUST`;
  const customerData = {
    customerCode,
    customerName,
    regionType: 'CHINA',
    country: 'China',
    province: 'Jiangsu',
    city: 'Suzhou',
    detailAddress: 'Inventory adjustment reservation regression address',
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
      orderNo: `${testPrefix}-RESERVED-ORDER`,
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      customerSnapshot: {
        customerCode: customer.customerCode,
        customerName: customer.customerName
      },
      orderDate: new Date(),
      status: 'DRAFT'
    }
  });
  const line = await prisma.orderLine.create({
    data: {
      orderId: order.id,
      lineNo: 1,
      partCode: batch.partCode,
      partName: batch.partName,
      partThickness: 1,
      quantity: reservedQuantity,
      productionPlanQuantity: reservedQuantity,
      fulfillmentMode: 'STOCK',
      unit: batch.unit,
      stockSourceSelections: [{ batchId: batch.id, quantity: reservedQuantity }]
    }
  });
  const reservation = await prisma.inventoryReservation.create({
    data: {
      batchId: batch.id,
      orderId: order.id,
      orderLineId: line.id,
      orderNo: order.orderNo,
      partCode: batch.partCode,
      partName: batch.partName,
      quantity: reservedQuantity,
      unit: batch.unit,
      status: 'ACTIVE',
      statusReason: 'VERIFY_ACTIVE_RESERVATION_GUARD'
    }
  });
  return { customer, order, line, reservation };
}

async function submitAdjustment(batchId, afterQuantity, fileName, remark, targetStatus) {
  const attachment = await uploadAdjustmentAttachment(fileName);
  return requestJson(`/inventory/batches/${batchId}/adjust`, {
    method: 'POST',
    body: JSON.stringify({
      afterQuantity,
      ...(targetStatus ? { targetStatus } : {}),
      countedBy: 'Inventory API Counter',
      countedAt: new Date().toISOString(),
      signatureName: 'Inventory API Signature',
      attachmentFileName: attachment.fileName,
      attachmentFileUrl: attachment.fileUrl,
      attachmentMimeType: attachment.mimeType,
      attachmentSize: attachment.size,
      remark
    })
  });
}

async function expectAdjustmentFailure(batchId, afterQuantity, fileName, remark, targetStatus, expectedMessage) {
  const attachment = await uploadAdjustmentAttachment(fileName);
  await expectRequestFailure(
    `/inventory/batches/${batchId}/adjust`,
    {
      method: 'POST',
      body: JSON.stringify({
        afterQuantity,
        ...(targetStatus ? { targetStatus } : {}),
        countedBy: 'Inventory API Counter',
        countedAt: new Date().toISOString(),
        signatureName: 'Inventory API Signature',
        attachmentFileName: attachment.fileName,
        attachmentFileUrl: attachment.fileUrl,
        attachmentMimeType: attachment.mimeType,
        attachmentSize: attachment.size,
        remark
      })
    },
    expectedMessage
  );
}

async function expectForgedAttachmentFailure(batchId, attachmentFileUrl, expectedMessage) {
  await expectRequestFailure(
    `/inventory/batches/${batchId}/adjust`,
    {
      method: 'POST',
      body: JSON.stringify({
        afterQuantity: 4,
        countedBy: 'Inventory API Counter',
        countedAt: new Date().toISOString(),
        signatureName: 'Inventory API Signature',
        attachmentFileName: 'forged-adjustment.png',
        attachmentFileUrl,
        attachmentMimeType: 'image/png',
        attachmentSize: 128,
        remark: '伪造库存盘点附件必须被拦截'
      })
    },
    expectedMessage
  );
}

async function assertAdjustmentTransaction(adjustment, expectedType, expectedQuantity) {
  const transaction = await prisma.inventoryTransaction.findFirst({
    where: {
      sourceRecordType: 'InventoryAdjustment',
      sourceRecordId: adjustment.id
    }
  });
  assert(transaction, `inventory adjustment ${adjustment.adjustmentNo} should create InventoryTransaction`);
  assert(transaction.transactionType === expectedType, `adjustment transaction should be ${expectedType}, actual=${transaction.transactionType}`);
  assert(Number(transaction.quantity) === expectedQuantity, `adjustment transaction quantity should be ${expectedQuantity}, actual=${transaction.quantity}`);
}

async function main() {
  await cleanupDatabase();
  try {
    const { batch } = await seedInventoryBatch();

    const zeroAdjustment = await submitAdjustment(
      batch.id,
      0,
      `盘点归零-${runId}.png`,
      '盘点到 0 时批次必须转 USED'
    );
    assert(Number(zeroAdjustment.beforeQuantity) === 5, `zero adjustment beforeQuantity should be 5, actual=${zeroAdjustment.beforeQuantity}`);
    assert(Number(zeroAdjustment.afterQuantity) === 0, `zero adjustment afterQuantity should be 0, actual=${zeroAdjustment.afterQuantity}`);
    assert(Number(zeroAdjustment.deltaQuantity) === -5, `zero adjustment deltaQuantity should be -5, actual=${zeroAdjustment.deltaQuantity}`);
    const usedBatch = await prisma.inventoryBatch.findUnique({ where: { id: batch.id } });
    assert(usedBatch?.status === 'USED', `batch should become USED after zero adjustment, actual=${usedBatch?.status}`);
    assert(Number(usedBatch.quantity) === 0, `batch quantity should become 0, actual=${usedBatch.quantity}`);
    await assertAdjustmentTransaction(zeroAdjustment, 'OUT', 5);

    const restoreAdjustment = await submitAdjustment(
      batch.id,
      3,
      `盘点恢复-${runId}.png`,
      '0 数量批次重新盘点为正数时必须恢复 AVAILABLE'
    );
    assert(Number(restoreAdjustment.beforeQuantity) === 0, `restore adjustment beforeQuantity should be 0, actual=${restoreAdjustment.beforeQuantity}`);
    assert(Number(restoreAdjustment.afterQuantity) === 3, `restore adjustment afterQuantity should be 3, actual=${restoreAdjustment.afterQuantity}`);
    assert(Number(restoreAdjustment.deltaQuantity) === 3, `restore adjustment deltaQuantity should be 3, actual=${restoreAdjustment.deltaQuantity}`);
    const restoredBatch = await prisma.inventoryBatch.findUnique({ where: { id: batch.id } });
    assert(restoredBatch?.status === 'AVAILABLE', `batch should become AVAILABLE after positive adjustment, actual=${restoredBatch?.status}`);
    assert(Number(restoredBatch.quantity) === 3, `batch quantity should become 3, actual=${restoredBatch.quantity}`);
    await assertAdjustmentTransaction(restoreAdjustment, 'IN', 3);

    const history = await requestJson(`/inventory/batches/${batch.id}/adjustments`);
    assert(Array.isArray(history) && history.length === 2, `adjustment history should keep 2 records, actual=${history.length}`);

    const { batch: scrapBatch } = await seedInventoryBatch('SCRAP-BATCH', 7);
    await expectAdjustmentFailure(
      scrapBatch.id,
      1,
      `盘点报废错误-${runId}.png`,
      '报废盘点必须清零，不能保留数量',
      'SCRAPPED',
      '报废或销毁清零后数量必须为 0'
    );
    const scrapAdjustment = await submitAdjustment(
      scrapBatch.id,
      0,
      `盘点报废-${runId}.png`,
      '报废盘点必须清零并转 SCRAPPED',
      'SCRAPPED'
    );
    assert(Number(scrapAdjustment.beforeQuantity) === 7, `scrap adjustment beforeQuantity should be 7, actual=${scrapAdjustment.beforeQuantity}`);
    assert(Number(scrapAdjustment.afterQuantity) === 0, `scrap adjustment afterQuantity should be 0, actual=${scrapAdjustment.afterQuantity}`);
    assert(Number(scrapAdjustment.deltaQuantity) === -7, `scrap adjustment deltaQuantity should be -7, actual=${scrapAdjustment.deltaQuantity}`);
    const scrappedBatch = await prisma.inventoryBatch.findUnique({ where: { id: scrapBatch.id } });
    assert(scrappedBatch?.status === 'SCRAPPED', `batch should become SCRAPPED after scrap adjustment, actual=${scrappedBatch?.status}`);
    assert(Number(scrappedBatch.quantity) === 0, `scrapped batch quantity should become 0, actual=${scrappedBatch.quantity}`);
    await assertAdjustmentTransaction(scrapAdjustment, 'OUT', 7);
    const scrapHistory = await requestJson(`/inventory/batches/${scrapBatch.id}/adjustments`);
    assert(Array.isArray(scrapHistory) && scrapHistory.length === 1, `scrap adjustment history should keep 1 record, actual=${scrapHistory.length}`);

    const { batch: reservedBatch } = await seedInventoryBatch('RESERVED-BATCH', 6);
    const { reservation } = await seedActiveReservation(reservedBatch, 4);
    await expectAdjustmentFailure(
      reservedBatch.id,
      3,
      `盘点预占拦截-${runId}.png`,
      '盘点后数量不能低于已预占数量',
      undefined,
      '盘点后数量不能小于已预占数量'
    );
    const reservedBatchAfterFailure = await prisma.inventoryBatch.findUnique({ where: { id: reservedBatch.id } });
    assert(
      reservedBatchAfterFailure?.status === 'AVAILABLE',
      `reserved batch status should remain AVAILABLE after failed adjustment, actual=${reservedBatchAfterFailure?.status}`
    );
    assert(
      Number(reservedBatchAfterFailure.quantity) === 6,
      `reserved batch quantity should remain 6 after failed adjustment, actual=${reservedBatchAfterFailure.quantity}`
    );
    const activeReservation = await prisma.inventoryReservation.findUnique({ where: { id: reservation.id } });
    assert(activeReservation?.status === 'ACTIVE', `reservation should remain ACTIVE after failed adjustment, actual=${activeReservation?.status}`);
    const reservedAdjustmentCount = await prisma.inventoryAdjustment.count({ where: { partCode: reservedBatch.partCode } });
    assert(reservedAdjustmentCount === 0, `failed reserved adjustment must not create InventoryAdjustment, actual=${reservedAdjustmentCount}`);

    const { batch: forgedAttachmentBatch } = await seedInventoryBatch('FORGED-ATTACHMENT-BATCH', 5);
    await expectForgedAttachmentFailure(
      forgedAttachmentBatch.id,
      `/uploads/not-inventory-adjustments/${testPrefix}-forged.png`,
      '库存盘点附件必须通过系统上传接口上传'
    );
    await expectForgedAttachmentFailure(
      forgedAttachmentBatch.id,
      `/uploads/inventory-adjustments/${testPrefix}-missing.png`,
      '库存盘点附件文件不存在'
    );
    const forgedAttachmentBatchAfterFailure = await prisma.inventoryBatch.findUnique({ where: { id: forgedAttachmentBatch.id } });
    assert(
      forgedAttachmentBatchAfterFailure?.status === 'AVAILABLE',
      `forged attachment batch status should remain AVAILABLE after failed adjustment, actual=${forgedAttachmentBatchAfterFailure?.status}`
    );
    assert(
      Number(forgedAttachmentBatchAfterFailure.quantity) === 5,
      `forged attachment batch quantity should remain 5 after failed adjustment, actual=${forgedAttachmentBatchAfterFailure.quantity}`
    );
    const forgedAttachmentAdjustmentCount = await prisma.inventoryAdjustment.count({ where: { partCode: forgedAttachmentBatch.partCode } });
    assert(
      forgedAttachmentAdjustmentCount === 0,
      `forged attachment adjustment must not create InventoryAdjustment, actual=${forgedAttachmentAdjustmentCount}`
    );

    console.log('Inventory adjustment API verification passed.');
  } finally {
    await cleanupDatabase();
    await cleanupUploadedFiles();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanupDatabase().catch(() => undefined);
  await cleanupUploadedFiles().catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
