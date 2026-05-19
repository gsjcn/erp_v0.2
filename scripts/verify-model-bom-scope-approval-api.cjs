#!/usr/bin/env node

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
  process.env.MODEL_BOM_SCOPE_APPROVAL_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const customerCodePrefix = 'VERIFY-SCOPE-CUST-STABLE';
const bomName = 'VERIFY_SCOPE_APPROVAL_STABLE';
const projectModel = 'VERIFY_SCOPE_STABLE';
const projectModelScopeKey = projectModel.toUpperCase();
const prisma = new PrismaClient();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { response, payload, text };
}

async function requestOk(path, options = {}) {
  const result = await request(path, options);
  if (!result.response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${result.response.status} ${result.text}`);
  }
  return result.payload;
}

function jsonBody(payload) {
  return JSON.stringify(payload);
}

async function cleanupBom(bomId) {
  if (!bomId) {
    return;
  }
  const now = new Date();
  await prisma.modelBomScopeApprovalRequest.updateMany({
    where: { bomId },
    data: { status: 'USED', usedAt: now }
  });
  await prisma.modelBomCustomerScope.updateMany({
    where: { bomId },
    data: { status: 'DISABLED' }
  });
  await prisma.modelBom.update({
    where: { id: bomId },
    data: { status: 'DISABLED', isCommon: false, commonSortOrder: null }
  });
}

async function createScopeApprovalCustomer(suffix) {
  const customerCode = `${customerCodePrefix}-${suffix}`;
  const customerName = `BOM 范围审批验证客户 ${suffix}`;
  const customerData = {
    customerCode,
    customerName,
    contactName: '范围审批验证',
    contactPhone: '13800000000',
    regionType: 'CHINA',
    country: '中国',
    province: '江苏省',
    city: '常州市',
    detailAddress: 'BOM 范围审批验证地址',
    remark: 'verify-model-bom-scope-approval-api 稳定回归客户，脚本结束后软停用。',
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
  await prisma.customerContact.updateMany({
    where: { customerId: customer.id, status: 'ENABLED' },
    data: { status: 'DISABLED', isPrimary: false }
  });
  const existingContact = await prisma.customerContact.findFirst({
    where: {
      customerId: customer.id,
      contactName: '范围审批验证',
      contactPhone: '13800000000'
    },
    orderBy: { createdAt: 'asc' }
  });
  if (existingContact?.id) {
    await prisma.customerContact.update({
      where: { id: existingContact.id },
      data: { isPrimary: true, status: 'ENABLED' }
    });
  } else {
    await prisma.customerContact.create({
      data: {
        customerId: customer.id,
        contactName: '范围审批验证',
        contactPhone: '13800000000',
        isPrimary: true,
        status: 'ENABLED'
      }
    });
  }
  assert(customer?.id, 'scope approval regression must create its own enabled customer');
  return customer;
}

async function cleanupCustomer(customerId) {
  if (!customerId) {
    return;
  }
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return;
  }
  const archiveSuffix = `__DISABLED__${customer.id.slice(0, 8)}`;
  const baseCode = String(customer.customerCode || '').replace(/__DISABLED__.*/, '');
  const baseName = String(customer.customerName || '').replace(/__DISABLED__.*/, '');
  await prisma.customerContact.updateMany({
    where: { customerId: customer.id, status: 'ENABLED' },
    data: { status: 'DISABLED', isPrimary: false }
  });
  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      customerCode: `${baseCode}${archiveSuffix}`,
      customerName: `${baseName}${archiveSuffix}`,
      contactName: null,
      contactPhone: null,
      status: 'DISABLED'
    }
  });
}

async function prepareScopeApprovalBom(customer) {
  const existingBom = await prisma.modelBom.findFirst({
    where: { bomName },
    orderBy: { createdAt: 'asc' }
  });
  if (existingBom?.id) {
    await prisma.modelBomScopeApprovalRequest.updateMany({
      where: { bomId: existingBom.id },
      data: { status: 'USED', usedAt: new Date() }
    });
    await prisma.modelBomCustomerScope.updateMany({
      where: { bomId: existingBom.id },
      data: { status: 'DISABLED' }
    });
    return prisma.modelBom.update({
      where: { id: existingBom.id },
      data: {
        customerId: customer.id,
        customerNameSnapshot: customer.customerName,
        customerScopeMode: 'PRIVATE',
        customerScopeKey: customer.id,
        projectModel,
        projectModelScopeKey,
        sourceBomId: null,
        sourceBomNameSnapshot: null,
        status: 'ENABLED',
        isCommon: false,
        commonSortOrder: null,
        remark: 'scope approval regression fixture'
      }
    });
  }
  return prisma.modelBom.create({
    data: {
      bomName,
      customerId: customer.id,
      customerNameSnapshot: customer.customerName,
      customerScopeMode: 'PRIVATE',
      customerScopeKey: customer.id,
      projectModel,
      projectModelScopeKey,
      status: 'ENABLED',
      isCommon: false,
      commonSortOrder: null,
      remark: 'scope approval regression fixture'
    }
  });
}

async function safeCleanup(label, cleanupTask) {
  try {
    await cleanupTask();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`cleanup skipped: ${label}: ${message}`);
  }
}

async function main() {
  const customer = await createScopeApprovalCustomer('A');
  const secondCustomer = await createScopeApprovalCustomer('B');
  const created = await prepareScopeApprovalBom(customer);
  let createdBomId = '';

  try {
    createdBomId = created.id;
    assert(created.customerScopeMode === 'PRIVATE', 'created fixture BOM must start as customer private scope');

    const sameCustomerSelected = await requestOk(`/inventory/model-boms/${encodeURIComponent(createdBomId)}`, {
      method: 'PATCH',
      body: jsonBody({
        bomName,
        customerScopeMode: 'SELECTED',
        customerIds: [customer.id],
        projectModel,
        remark: 'same customer selected scope does not broaden visibility',
        status: 'ENABLED',
        isCommon: false
      })
    });
    assert(
      sameCustomerSelected.customerScopeMode === 'SELECTED',
      'private BOM changed to same single selected customer must not require admin approval'
    );

    const otherCustomerPrivate = await request(`/inventory/model-boms/${encodeURIComponent(createdBomId)}`, {
      method: 'PATCH',
      body: jsonBody({
        bomName,
        customerScopeMode: 'PRIVATE',
        customerId: secondCustomer.id,
        projectModel,
        remark: 'moving selected BOM to a different private customer must require approval',
        status: 'ENABLED',
        isCommon: false
      })
    });
    assert(!otherCustomerPrivate.response.ok, 'exposing BOM to a different customer must be rejected without approval');
    assert(otherCustomerPrivate.response.status === 400, `expected 400 for different customer visibility, got ${otherCustomerPrivate.response.status}`);

    const broadUpdatePayload = {
      bomName,
      customerScopeMode: 'ALL',
      projectModel,
      remark: 'scope approval regression expanded to all customers for same model',
      status: 'ENABLED',
      isCommon: true
    };

    const blockedUpdate = await request(`/inventory/model-boms/${encodeURIComponent(createdBomId)}`, {
      method: 'PATCH',
      body: jsonBody(broadUpdatePayload)
    });
    assert(!blockedUpdate.response.ok, 'expanding BOM scope to all customers must be rejected without approval');
    assert(blockedUpdate.response.status === 400, `expected 400 for missing scope approval, got ${blockedUpdate.response.status}`);

    const requestRow = await requestOk(`/inventory/model-boms/${encodeURIComponent(createdBomId)}/scope-approval-requests`, {
      method: 'POST',
      body: jsonBody({
        ...broadUpdatePayload,
        requestedBy: 'scope approval regression operator',
        requestReason: 'verify all-customer same-model common BOM requires admin approval'
      })
    });
    assert(requestRow.status === 'PENDING', 'new BOM scope approval request must start as PENDING');
    assert(requestRow.bomId === createdBomId, 'scope approval request must be bound to the current BOM');
    assert(requestRow.requestedCustomerScopeMode === 'ALL', 'scope approval request must record requested ALL customer scope');
    assert(requestRow.requestedProjectModel === projectModel, 'scope approval request must record requested project model');

    const defaultList = await requestOk('/inventory/model-bom-scope-approval-requests?limit=100&offset=0');
    assert(
      !defaultList.items.some((item) => item.id === requestRow.id || String(item.requestedBomName || item.bomName || '').startsWith(bomName)),
      'default BOM scope approval list must hide reusable verification fixtures'
    );

    const duplicatePendingRequest = await request(`/inventory/model-boms/${encodeURIComponent(createdBomId)}/scope-approval-requests`, {
      method: 'POST',
      body: jsonBody({
        ...broadUpdatePayload,
        requestedBy: 'scope approval regression operator',
        requestReason: 'duplicate pending request must be rejected'
      })
    });
    assert(!duplicatePendingRequest.response.ok, 'duplicate pending BOM scope approval request must be rejected');
    assert(
      duplicatePendingRequest.response.status === 400,
      `expected 400 for duplicate pending approval request, got ${duplicatePendingRequest.response.status}`
    );

    const pendingList = await requestOk(
      `/inventory/model-bom-scope-approval-requests?bomId=${encodeURIComponent(createdBomId)}&status=PENDING&requestedCustomerScopeMode=ALL&requestedScopeKey=ALL&requestedProjectModelScopeKey=${encodeURIComponent(projectModel)}&includeTestFixtures=true&limit=10&offset=0`
    );
    assert(
      pendingList.items.some((item) => item.id === requestRow.id),
      'pending approval list with requested target scope filters must include the newly submitted BOM scope request'
    );

    const approved = await requestOk(`/inventory/model-bom-scope-approval-requests/${encodeURIComponent(requestRow.id)}/approve`, {
      method: 'POST',
      body: jsonBody({
        reviewedBy: 'scope approval regression admin',
        reviewRemark: 'approved by regression script'
      })
    });
    assert(approved.status === 'APPROVED', 'admin approval must mark request as APPROVED');
    assert(approved.approvedBy === 'scope approval regression admin', 'approval must keep the admin reviewer name');

    const duplicateApprovedRequest = await request(`/inventory/model-boms/${encodeURIComponent(createdBomId)}/scope-approval-requests`, {
      method: 'POST',
      body: jsonBody({
        ...broadUpdatePayload,
        requestedBy: 'scope approval regression operator',
        requestReason: 'duplicate approved request must be rejected before it is consumed'
      })
    });
    assert(!duplicateApprovedRequest.response.ok, 'duplicate approved unused BOM scope approval request must be rejected');
    assert(
      duplicateApprovedRequest.response.status === 400,
      `expected 400 for duplicate approved approval request, got ${duplicateApprovedRequest.response.status}`
    );

    const updated = await requestOk(`/inventory/model-boms/${encodeURIComponent(createdBomId)}`, {
      method: 'PATCH',
      body: jsonBody({
        ...broadUpdatePayload,
        scopeApprovalRequestId: requestRow.id
      })
    });
    assert(updated.customerScopeMode === 'ALL', 'approved save must expand BOM to all customers');
    assert(updated.projectModel === projectModel, 'approved save must keep same-model scope');
    assert(updated.isCommon === true, 'approved save must allow same-model common BOM flag');

    const usedList = await requestOk(
      `/inventory/model-bom-scope-approval-requests?bomId=${encodeURIComponent(createdBomId)}&status=USED&requestedCustomerScopeMode=ALL&requestedScopeKey=ALL&requestedProjectModelScopeKey=${encodeURIComponent(projectModel)}&includeTestFixtures=true&limit=10&offset=0`
    );
    const usedRequest = usedList.items.find((item) => item.id === requestRow.id);
    assert(usedRequest, 'used approval list must include the approval consumed by BOM save');
    assert(usedRequest.usedAt, 'consumed BOM scope approval must keep usedAt');

    console.log(
      JSON.stringify(
        {
          ok: true,
          apiBaseUrl,
          checked: [
            'model-bom-scope-expansion-requires-approval',
            'model-bom-private-to-same-selected-no-approval',
            'model-bom-selected-to-new-private-requires-approval',
            'model-bom-scope-approval-submit',
            'model-bom-scope-approval-duplicate-pending-request-blocked',
            'model-bom-scope-approval-admin-review',
            'model-bom-scope-approval-duplicate-approved-request-blocked',
            'model-bom-scope-approval-requested-scope-query-filters',
            'model-bom-scope-approval-test-fixture-filter',
            'model-bom-scope-approval-consumed-on-save',
            'model-bom-scope-approval-temporary-customer-cleanup',
            'model-bom-scope-approval-temporary-bom-cleanup'
          ],
          bomName,
          projectModel
        },
        null,
        2
      )
    );
  } finally {
    await safeCleanup('model BOM fixture', () => cleanupBom(createdBomId));
    await safeCleanup('scope approval customer fixture', () => cleanupCustomer(customer.id));
    await safeCleanup('scope approval second customer fixture', () => cleanupCustomer(secondCustomer.id));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
