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

const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const knownPrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];
const previewLimit = resolvePreviewLimit();

function cliArgValue(name) {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) {
    return equalsArg.slice(name.length + 1);
  }
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1];
  }
  return undefined;
}

function resolvePreviewLimit() {
  const rawValue = cliArgValue('--preview-limit') ?? process.env.CLEANUP_TEST_DATA_PREVIEW_LIMIT ?? '8';
  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.max(Math.floor(parsedValue), 1) : 8;
}

function startsWithKnownPrefix(field) {
  return knownPrefixes.map((prefix) => ({ [field]: { startsWith: prefix } }));
}

function startsWithKnownPrefixAny(fields) {
  return fields.flatMap((field) => startsWithKnownPrefix(field));
}

function compactIds(rows) {
  return rows.map((row) => row.id);
}

function cleanupTargetSummary(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    return 'DATABASE_URL is not set';
  }
  try {
    const url = new URL(databaseUrl);
    const databaseName = url.pathname.replace(/^\//, '') || '-';
    const schemaName = url.searchParams.get('schema') || '-';
    const hostText = `${url.hostname}${url.port ? `:${url.port}` : ''}`;
    const userText = url.username || '-';
    const localText = isLocalCleanupDatabaseUrl(databaseUrl) ? 'local' : 'non-local';
    return `${url.protocol}//${userText}:***@${hostText}/${databaseName}?schema=${schemaName} (${localText})`;
  } catch {
    return 'DATABASE_URL is not a valid URL';
  }
}

function expectedCleanupTargetSummary() {
  const expectedHost = process.env.POSTGRES_HOST_BIND || '127.0.0.1';
  const expectedPort = process.env.POSTGRES_HOST_PORT || '55432';
  const expectedUser = process.env.POSTGRES_USER || 'baisheng';
  const expectedDb = process.env.POSTGRES_DB || 'baisheng_erp';
  return `postgresql://${expectedUser}:***@${expectedHost}:${expectedPort}/${expectedDb}?schema=public`;
}

function cleanupTargetMatchesProjectDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    return false;
  }
  try {
    const url = new URL(databaseUrl);
    const expectedPort = process.env.POSTGRES_HOST_PORT || '55432';
    const expectedUser = process.env.POSTGRES_USER || 'baisheng';
    const expectedDb = process.env.POSTGRES_DB || 'baisheng_erp';
    const databaseName = url.pathname.replace(/^\//, '');
    const port = url.port || (url.protocol === 'postgresql:' ? '5432' : '');
    return (
      isLocalCleanupDatabaseUrl(databaseUrl) &&
      port === expectedPort &&
      databaseName === expectedDb &&
      (!url.username || url.username === expectedUser)
    );
  } catch {
    return false;
  }
}

function printCleanupTarget() {
  console.log(`Target database: ${cleanupTargetSummary()}`);
  console.log(`Expected project database: ${expectedCleanupTargetSummary()}`);
  console.log(
    applyChanges
      ? 'Mode: apply soft-disable changes after safety checks.'
      : 'Mode: dry-run only; no database rows are changed.'
  );
  console.log(`Preview limit: ${previewLimit}`);
}

function statusCounts(rows) {
  const enabled = rows.filter((row) => row.status === 'ENABLED').length;
  const disabled = rows.filter((row) => row.status === 'DISABLED').length;
  return { total: rows.length, enabled, disabled };
}

function statusSummary(counts) {
  return `${counts.total} total, ${counts.enabled} enabled, ${counts.disabled} disabled`;
}

function archivedCustomerIdentity(value, customerId) {
  const marker = `__DISABLED__${String(customerId).slice(0, 8)}`;
  const text = String(value || 'TEST-CUSTOMER');
  if (text.endsWith(marker)) {
    return text;
  }
  return `${text.slice(0, 120)}${marker}`;
}

function customerNeedsIdentityArchive(customer) {
  return (
    customer.customerCode !== archivedCustomerIdentity(customer.customerCode, customer.id) ||
    customer.customerName !== archivedCustomerIdentity(customer.customerName, customer.id)
  );
}

function isLocalCleanupDatabaseUrl(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    return false;
  }
  try {
    const host = new URL(databaseUrl).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

function assertCleanupApplyAllowed() {
  if (!applyChanges) {
    return;
  }
  const isProduction = process.env.NODE_ENV === 'production';
  const cleanupConfirmed = process.env.CLEANUP_TEST_DATA_CONFIRMED === 'true';
  const allowTestDataCleanup = process.env.ALLOW_TEST_DATA_CLEANUP === 'true';
  if (isProduction && !allowTestDataCleanup) {
    throw new Error(
      'cleanup:test-data --apply is blocked in production. Set ALLOW_TEST_DATA_CLEANUP=true only when you intentionally soft-disable test fixtures.'
    );
  }
  if (cleanupConfirmed || allowTestDataCleanup || (!isProduction && cleanupTargetMatchesProjectDatabase())) {
    return;
  }
  throw new Error(
    `cleanup:test-data --apply is blocked. Default apply is only allowed for the current project database (${expectedCleanupTargetSummary()}); set CLEANUP_TEST_DATA_CONFIRMED=true only after confirming the target database.`
  );
}

async function count(model, where) {
  return prisma[model].count({ where });
}

async function updateMany(model, where, data) {
  if (!applyChanges) {
    return { count: await count(model, where) };
  }
  return prisma[model].updateMany({ where, data });
}

async function archiveCustomerIdentities(customers) {
  const rows = customers.filter(customerNeedsIdentityArchive);
  if (!applyChanges) {
    return { count: rows.length };
  }
  for (const customer of rows) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        customerCode: archivedCustomerIdentity(customer.customerCode, customer.id),
        customerName: archivedCustomerIdentity(customer.customerName, customer.id),
        status: 'DISABLED',
        contactName: null,
        contactPhone: null
      }
    });
  }
  return { count: rows.length };
}

function printSection(title, rows) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('- none');
    return;
  }
  for (const row of rows) {
    console.log(`- ${row.label}: ${row.count}`);
  }
}

function previewText(value) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function previewDecimal(value) {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'object' && typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value);
}

function previewDate(value) {
  if (!value) {
    return '-';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return previewText(value);
}

function printRecordPreview(title, rows, formatter, totalCount = rows.length) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('- none');
    return;
  }
  const visibleRows = rows.slice(0, previewLimit);
  visibleRows.forEach((row, index) => {
    console.log(`- ${index + 1}. ${formatter(row)}`);
  });
  if (totalCount > visibleRows.length) {
    console.log(`- ... ${totalCount - visibleRows.length} more`);
  }
}

function printBlockingRecordPreviews(previews) {
  for (const preview of previews) {
    if (preview.rows.length === 0) {
      continue;
    }
    printRecordPreview(preview.title, preview.rows, preview.formatter, preview.count);
  }
}

function numericCount(row) {
  return typeof row.count === 'number' && Number.isFinite(row.count) ? row.count : 0;
}

function sumCounts(rows) {
  return rows.reduce((sum, row) => sum + numericCount(row), 0);
}

function printCleanupRecommendation(masterCleanupResults, activeBusinessData) {
  const pendingActionCount = sumCounts(masterCleanupResults);
  const manualReviewCount = sumCounts(activeBusinessData);
  console.log('\nCleanup recommendation');
  console.log(`- Pending soft-clean actions: ${pendingActionCount}`);
  console.log(`- Business records requiring manual review: ${manualReviewCount}`);
  if (manualReviewCount > 0) {
    console.log('- Next step: review the business records above before running npm run cleanup:test-data -- --apply.');
    return;
  }
  if (pendingActionCount > 0) {
    console.log('- Next step: run npm run cleanup:test-data -- --apply when the target database is confirmed.');
    return;
  }
  console.log('- Next step: no cleanup apply is needed.');
}

function assertNoActiveBusinessDataForApply(activeBusinessData) {
  if (!applyChanges) {
    return;
  }
  const blockingRows = activeBusinessData.filter((row) => numericCount(row) > 0);
  if (blockingRows.length === 0) {
    return;
  }
  const details = blockingRows.map((row) => `${row.label}: ${row.count}`).join('; ');
  throw new Error(`cleanup:test-data --apply is blocked because matching business records require manual review first: ${details}`);
}

async function main() {
  assertCleanupApplyAllowed();

  const testCustomers = await prisma.customer.findMany({
    where: { OR: startsWithKnownPrefixAny(['customerCode', 'customerName']) },
    select: { id: true, customerCode: true, customerName: true, status: true }
  });
  const testMaterials = await prisma.material.findMany({
    where: { OR: startsWithKnownPrefix('partCode') },
    select: { id: true, partCode: true, partName: true, status: true }
  });
  const testWarehouses = await prisma.warehouse.findMany({
    where: { OR: startsWithKnownPrefix('warehouseCode') },
    select: { id: true, warehouseCode: true, warehouseName: true, status: true }
  });
  const testCommonProjectModels = await prisma.materialCommonProjectModel.findMany({
    where: { OR: startsWithKnownPrefix('projectModel') },
    select: { id: true, projectModel: true, sortOrder: true, status: true }
  });

  const customerIds = compactIds(testCustomers);
  const materialIds = compactIds(testMaterials);
  const warehouseIds = compactIds(testWarehouses);
  const now = new Date();
  const customerIdentityArchiveRows = testCustomers.filter(customerNeedsIdentityArchive);

  const testModelBoms = await prisma.modelBom.findMany({
    where: {
      OR: [
        ...startsWithKnownPrefix('bomName'),
        ...startsWithKnownPrefix('projectModel'),
        { customerId: { in: customerIds } },
        { lines: { some: { materialId: { in: materialIds } } } }
      ]
    },
    select: { id: true, bomName: true, status: true }
  });
  const modelBomIds = compactIds(testModelBoms);

  const activeCustomerOrderWhere = {
    OR: [{ customerId: { in: customerIds } }, ...startsWithKnownPrefix('orderNo')],
    status: { not: 'CANCELLED' }
  };
  const activeProductionTaskWhere = {
    OR: [...startsWithKnownPrefix('orderNo'), ...startsWithKnownPrefix('partCode')],
    status: { notIn: ['CANCELLED', 'STORED'] }
  };
  const pendingProductionNoticeWhere = {
    OR: [...startsWithKnownPrefix('orderNo'), ...startsWithKnownPrefix('noticeNo')],
    status: 'PENDING'
  };
  const activeInventoryReservationWhere = {
    OR: [...startsWithKnownPrefix('orderNo'), ...startsWithKnownPrefix('partCode')],
    status: 'ACTIVE'
  };
  const availableInventoryBatchWhere = {
    OR: [
      ...startsWithKnownPrefix('sourceOrderNo'),
      ...startsWithKnownPrefix('sourceProductionTaskNo'),
      ...startsWithKnownPrefix('partCode')
    ],
    status: { in: ['AVAILABLE', 'RESERVED'] }
  };

  const activeBusinessData = [
    {
      label: 'CustomerOrder not CANCELLED',
      count: await count('customerOrder', activeCustomerOrderWhere)
    },
    {
      label: 'ProductionTask not CANCELLED/STORED',
      count: await count('productionTask', activeProductionTaskWhere)
    },
    {
      label: 'ProductionNotice PENDING',
      count: await count('productionNotice', pendingProductionNoticeWhere)
    },
    {
      label: 'InventoryReservation ACTIVE',
      count: await count('inventoryReservation', activeInventoryReservationWhere)
    },
    {
      label: 'InventoryBatch AVAILABLE/RESERVED',
      count: await count('inventoryBatch', availableInventoryBatchWhere)
    }
  ];
  const activeBusinessCount = (label) => activeBusinessData.find((row) => row.label === label)?.count || 0;
  const activeBusinessPreviews = [
    {
      title: 'CustomerOrder not CANCELLED preview',
      count: activeBusinessCount('CustomerOrder not CANCELLED'),
      rows: await prisma.customerOrder.findMany({
        where: activeCustomerOrderWhere,
        select: { id: true, orderNo: true, customerName: true, status: true, orderDate: true },
        orderBy: { createdAt: 'desc' },
        take: previewLimit + 1
      }),
      formatter: (row) =>
        `${previewText(row.orderNo)} | ${previewText(row.customerName)} | ${row.status} | ${previewDate(row.orderDate)} | ${row.id}`
    },
    {
      title: 'ProductionTask not CANCELLED/STORED preview',
      count: activeBusinessCount('ProductionTask not CANCELLED/STORED'),
      rows: await prisma.productionTask.findMany({
        where: activeProductionTaskWhere,
        select: {
          id: true,
          productionTaskNo: true,
          orderNo: true,
          customerName: true,
          partCode: true,
          partName: true,
          plannedQuantity: true,
          unit: true,
          status: true
        },
        orderBy: { createdAt: 'desc' },
        take: previewLimit + 1
      }),
      formatter: (row) =>
        `${previewText(row.productionTaskNo)} | ${previewText(row.orderNo)} | ${previewText(row.customerName)} | ${previewText(row.partCode)} ${previewText(row.partName)} | ${row.status} | ${previewDecimal(row.plannedQuantity)} ${previewText(row.unit)}`
    },
    {
      title: 'ProductionNotice PENDING preview',
      count: activeBusinessCount('ProductionNotice PENDING'),
      rows: await prisma.productionNotice.findMany({
        where: pendingProductionNoticeWhere,
        select: {
          id: true,
          noticeNo: true,
          noticeType: true,
          target: true,
          orderNo: true,
          productionTaskNo: true,
          partCode: true,
          status: true
        },
        orderBy: { createdAt: 'desc' },
        take: previewLimit + 1
      }),
      formatter: (row) =>
        `${previewText(row.noticeNo)} | ${row.noticeType}/${row.target} | ${previewText(row.orderNo)} | ${previewText(row.productionTaskNo)} | ${previewText(row.partCode)} | ${row.status}`
    },
    {
      title: 'InventoryReservation ACTIVE preview',
      count: activeBusinessCount('InventoryReservation ACTIVE'),
      rows: await prisma.inventoryReservation.findMany({
        where: activeInventoryReservationWhere,
        select: { id: true, orderNo: true, partCode: true, partName: true, quantity: true, unit: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: previewLimit + 1
      }),
      formatter: (row) =>
        `${previewText(row.orderNo)} | ${previewText(row.partCode)} ${previewText(row.partName)} | ${row.status} | ${previewDecimal(row.quantity)} ${previewText(row.unit)} | ${row.id}`
    },
    {
      title: 'InventoryBatch AVAILABLE/RESERVED preview',
      count: activeBusinessCount('InventoryBatch AVAILABLE/RESERVED'),
      rows: await prisma.inventoryBatch.findMany({
        where: availableInventoryBatchWhere,
        select: {
          id: true,
          batchNo: true,
          partCode: true,
          partName: true,
          sourceOrderNo: true,
          sourceProductionTaskNo: true,
          quantity: true,
          unit: true,
          status: true
        },
        orderBy: { createdAt: 'desc' },
        take: previewLimit + 1
      }),
      formatter: (row) =>
        `${previewText(row.batchNo)} | ${previewText(row.partCode)} ${previewText(row.partName)} | ${previewText(row.sourceOrderNo)} | ${previewText(row.sourceProductionTaskNo)} | ${row.status} | ${previewDecimal(row.quantity)} ${previewText(row.unit)}`
    }
  ];
  assertNoActiveBusinessDataForApply(activeBusinessData);

  const masterCleanupResults = [
    {
      label: 'Customer ENABLED -> DISABLED',
      ...(await updateMany(
        'customer',
        { id: { in: customerIds }, status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'CustomerContact ENABLED -> DISABLED',
      ...(await updateMany(
        'customerContact',
        { customerId: { in: customerIds }, status: 'ENABLED' },
        { status: 'DISABLED', isPrimary: false }
      ))
    },
    {
      label: 'Customer contact snapshot -> NULL',
      ...(await updateMany(
        'customer',
        { id: { in: customerIds }, OR: [{ contactName: { not: null } }, { contactPhone: { not: null } }] },
        { contactName: null, contactPhone: null }
      ))
    },
    {
      label: 'Customer identity -> archived disabled key',
      ...(await archiveCustomerIdentities(testCustomers))
    },
    {
      label: 'Material ENABLED -> DISABLED',
      ...(await updateMany(
        'material',
        { id: { in: materialIds }, status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'Material test defaultProcessRoute -> NULL',
      ...(await updateMany(
        'material',
        { id: { in: materialIds }, defaultProcessRoute: { not: null } },
        { defaultProcessRoute: null }
      ))
    },
    {
      label: 'MaterialDrawingRevision ENABLED -> DISABLED',
      ...(await updateMany(
        'materialDrawingRevision',
        { materialId: { in: materialIds }, status: 'ENABLED' },
        { status: 'DISABLED', isDefault: false, defaultChangedAt: now, defaultChangedBy: 'cleanup:test-data' }
      ))
    },
    {
      label: 'MaterialApplicability ENABLED -> DISABLED',
      ...(await updateMany(
        'materialApplicability',
        { materialId: { in: materialIds }, status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'MaterialTransformRule ENABLED -> DISABLED',
      ...(await updateMany(
        'materialTransformRule',
        {
          OR: [{ sourceMaterialId: { in: materialIds } }, { targetMaterialId: { in: materialIds } }, { customerId: { in: customerIds } }],
          status: 'ENABLED'
        },
        { status: 'DISABLED' }
      ))
    }
  ];

  masterCleanupResults.push(
    {
      label: 'ModelBom ENABLED -> DISABLED',
      ...(await updateMany(
        'modelBom',
        { id: { in: modelBomIds }, status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'ModelBomLine ENABLED -> DISABLED',
      ...(await updateMany(
        'modelBomLine',
        { bomId: { in: modelBomIds }, status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'ModelBomCustomerScope ENABLED -> DISABLED',
      ...(await updateMany(
        'modelBomCustomerScope',
        { OR: [{ bomId: { in: modelBomIds } }, { customerId: { in: customerIds } }], status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'ModelBomDiffReview ENABLED -> DISABLED',
      ...(await updateMany(
        'modelBomDiffReview',
        { OR: [{ targetBomId: { in: modelBomIds } }, { sourceBomId: { in: modelBomIds } }], status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'ModelBomScopeApprovalRequest PENDING/APPROVED/REJECTED -> USED',
      ...(await updateMany(
        'modelBomScopeApprovalRequest',
        { bomId: { in: modelBomIds }, status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } },
        { status: 'USED', usedAt: now }
      ))
    },
    {
      label: 'Warehouse ENABLED -> DISABLED',
      ...(await updateMany(
        'warehouse',
        { id: { in: warehouseIds }, status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'WarehouseLocation ENABLED -> DISABLED',
      ...(await updateMany(
        'warehouseLocation',
        { OR: [{ warehouseId: { in: warehouseIds } }, ...startsWithKnownPrefix('locationCode')], status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'ProcessDefinition ENABLED -> DISABLED',
      ...(await updateMany(
        'processDefinition',
        { OR: startsWithKnownPrefix('processName'), status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'ProcessTemplate ENABLED -> DISABLED',
      ...(await updateMany(
        'processTemplate',
        { OR: startsWithKnownPrefix('templateName'), status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'ProductionOperator ENABLED -> DISABLED',
      ...(await updateMany(
        'productionOperator',
        { OR: startsWithKnownPrefix('accountId'), status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    },
    {
      label: 'MaterialCommonProjectModel ENABLED -> DISABLED',
      ...(await updateMany(
        'materialCommonProjectModel',
        { OR: startsWithKnownPrefix('projectModel'), status: 'ENABLED' },
        { status: 'DISABLED' }
      ))
    }
  );

  console.log(applyChanges ? 'cleanup:test-data applied.' : 'cleanup:test-data dry run. Pass --apply to soft-disable matching test master data.');
  printCleanupTarget();
  console.log(`Known prefixes: ${knownPrefixes.join(', ')}`);
  printSection('Matched master records', [
    { label: 'Customer', count: statusSummary(statusCounts(testCustomers)) },
    { label: 'Material', count: statusSummary(statusCounts(testMaterials)) },
    { label: 'ModelBom', count: statusSummary(statusCounts(testModelBoms)) },
    { label: 'Warehouse', count: statusSummary(statusCounts(testWarehouses)) },
    { label: 'MaterialCommonProjectModel', count: statusSummary(statusCounts(testCommonProjectModels)) }
  ]);
  printRecordPreview('Matched customer preview', testCustomers, (row) =>
    `${previewText(row.customerCode)} | ${previewText(row.customerName)} | ${row.status} | ${row.id}`
  );
  printRecordPreview('Matched material preview', testMaterials, (row) =>
    `${previewText(row.partCode)} | ${previewText(row.partName)} | ${row.status} | ${row.id}`
  );
  printRecordPreview('Matched BOM preview', testModelBoms, (row) =>
    `${previewText(row.bomName)} | ${row.status} | ${row.id}`
  );
  printRecordPreview('Matched common project model preview', testCommonProjectModels, (row) =>
    `${previewText(row.projectModel)} | sort ${row.sortOrder} | ${row.status} | ${row.id}`
  );
  printRecordPreview('Customer identity archive preview', customerIdentityArchiveRows, (row) =>
    `${previewText(row.customerCode)} -> ${archivedCustomerIdentity(row.customerCode, row.id)} | ${previewText(row.customerName)} -> ${archivedCustomerIdentity(row.customerName, row.id)}`
  );
  printSection('Soft-disable actions', masterCleanupResults);
  printSection('Business records requiring manual review', activeBusinessData.filter((row) => row.count > 0));
  printBlockingRecordPreviews(activeBusinessPreviews);
  printCleanupRecommendation(masterCleanupResults, activeBusinessData);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
