#!/usr/bin/env node

const apiBaseUrl = (
  process.env.NOTICE_CENTER_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  process.env.NOTICE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const fixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

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

async function readJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && payload.message ? payload.message : text;
    throw new Error(`${response.status} ${response.statusText}: ${Array.isArray(message) ? message.join('; ') : message}`);
  }
  return payload;
}

function assertNoFixtureText(payload, label) {
  const text = JSON.stringify(payload);
  const leakedPrefix = fixturePrefixes.find((prefix) => text.includes(prefix));
  assert(!leakedPrefix, `${label} must hide regression fixture data by default; leaked prefix=${leakedPrefix}`);
}

function assertPage(payload, label, expectedLimit = 5, expectedOffset = 0) {
  assert(payload && typeof payload === 'object' && !Array.isArray(payload), `${label} must return a paged response object`);
  assert(Array.isArray(payload.items), `${label} must include items array`);
  assert(Number.isInteger(payload.totalCount), `${label} must include numeric totalCount`);
  assert(Number.isInteger(payload.limit), `${label} must include numeric limit`);
  assert(Number.isInteger(payload.offset), `${label} must include numeric offset`);
  assert(typeof payload.hasMore === 'boolean', `${label} must include boolean hasMore`);
  assert(payload.limit === expectedLimit, `${label} limit must be ${expectedLimit}, actual=${payload.limit}`);
  assert(payload.offset === expectedOffset, `${label} offset must be ${expectedOffset}, actual=${payload.offset}`);
  assertNoFixtureText(payload, label);
  return payload.items;
}

function assertNoticeRow(notice, label) {
  assert(notice && typeof notice === 'object', `${label} row must be an object`);
  for (const field of ['id', 'noticeNo', 'noticeType', 'target', 'status', 'createdAt']) {
    assert(typeof notice[field] === 'string' && notice[field].trim(), `${label} row must include ${field}`);
  }
  assert(['PRODUCTION', 'WAREHOUSE'].includes(notice.target), `${label} row target must be PRODUCTION or WAREHOUSE, actual=${notice.target}`);
  assert(['PENDING', 'ACKNOWLEDGED'].includes(notice.status), `${label} row status must be PENDING or ACKNOWLEDGED, actual=${notice.status}`);
  if (notice.status === 'ACKNOWLEDGED') {
    assert(typeof notice.acknowledgedBy === 'string' && notice.acknowledgedBy.trim(), `${label} acknowledged row must keep acknowledgedBy`);
    assert(typeof notice.acknowledgedAt === 'string' && notice.acknowledgedAt.trim(), `${label} acknowledged row must keep acknowledgedAt`);
  }
}

function assertTargetOnly(items, expectedTarget, label) {
  for (const notice of items) {
    assertNoticeRow(notice, label);
    assert(notice.target === expectedTarget, `${label} must only return ${expectedTarget} notices, actual=${notice.target}`);
  }
}

function assertStatusOnly(items, expectedStatus, label) {
  for (const notice of items) {
    assertNoticeRow(notice, label);
    assert(notice.status === expectedStatus, `${label} must only return ${expectedStatus} notices, actual=${notice.status}`);
  }
}

function firstNoticeWithValue(items, fields) {
  return items.find((notice) => fields.some((field) => typeof notice[field] === 'string' && notice[field].trim()));
}

function noticeSearchKeyword(notice) {
  for (const field of ['orderNo', 'partCode', 'partName', 'customerName', 'noticeNo']) {
    if (typeof notice[field] === 'string' && notice[field].trim()) {
      return notice[field];
    }
  }
  return '';
}

function assertContainsNotice(items, notice, label) {
  assert(items.some((item) => item.id === notice.id), `${label} must include notice ${notice.noticeNo}`);
}

async function main() {
  const productionPage = await readJson('/production/tasks/notices?limit=5&offset=0');
  const productionItems = assertPage(productionPage, 'production notices page');
  assert(productionPage.totalCount > 0, 'production notices page must show current production notices');
  assertTargetOnly(productionItems, 'PRODUCTION', 'production notices page');

  const warehousePage = await readJson('/warehouse/notices?limit=5&offset=0');
  const warehouseItems = assertPage(warehousePage, 'warehouse notices page');
  assert(warehousePage.totalCount > 0, 'warehouse notices page must show current warehouse notices');
  assertTargetOnly(warehouseItems, 'WAREHOUSE', 'warehouse notices page');

  const adminPage = await readJson('/production/tasks/notices/admin?limit=10&offset=0');
  const adminItems = assertPage(adminPage, 'admin notices page', 10);
  assert(adminPage.totalCount >= productionPage.totalCount, 'admin notices page must include production-visible notices');
  assert(adminPage.totalCount >= warehousePage.totalCount, 'admin notices page must include warehouse-visible notices');
  assert(adminItems.some((notice) => notice.target === 'PRODUCTION'), 'admin notices page must include PRODUCTION notices');
  assert(adminItems.some((notice) => notice.target === 'WAREHOUSE'), 'admin notices page must include WAREHOUSE notices');
  adminItems.forEach((notice) => assertNoticeRow(notice, 'admin notices page'));

  const productionPendingPage = await readJson('/production/tasks/notices?status=PENDING&limit=5&offset=0');
  const productionPendingItems = assertPage(productionPendingPage, 'production notices pending filter');
  assertStatusOnly(productionPendingItems, 'PENDING', 'production notices pending filter');
  assertTargetOnly(productionPendingItems, 'PRODUCTION', 'production notices pending filter');

  const warehouseAcknowledgedPage = await readJson('/warehouse/notices?status=ACKNOWLEDGED&limit=5&offset=0');
  const warehouseAcknowledgedItems = assertPage(warehouseAcknowledgedPage, 'warehouse notices acknowledged filter');
  assertStatusOnly(warehouseAcknowledgedItems, 'ACKNOWLEDGED', 'warehouse notices acknowledged filter');
  assertTargetOnly(warehouseAcknowledgedItems, 'WAREHOUSE', 'warehouse notices acknowledged filter');

  const adminWarehousePage = await readJson('/production/tasks/notices/admin?target=WAREHOUSE&limit=5&offset=0');
  const adminWarehouseItems = assertPage(adminWarehousePage, 'admin notices warehouse target filter');
  assertTargetOnly(adminWarehouseItems, 'WAREHOUSE', 'admin notices warehouse target filter');
  assert(adminWarehousePage.totalCount === warehousePage.totalCount, 'admin WAREHOUSE target filter must match warehouse notice count');

  const productionSample = firstNoticeWithValue(productionItems, ['orderNo', 'partCode', 'partName', 'customerName', 'noticeNo']);
  assert(productionSample, 'production notices page must include a searchable sample notice');
  const productionKeyword = noticeSearchKeyword(productionSample);
  const productionSearchPage = await readJson(`/production/tasks/notices${query({ keyword: productionKeyword, limit: 20, offset: 0 })}`);
  const productionSearchItems = assertPage(productionSearchPage, 'production notices keyword filter', 20);
  assertTargetOnly(productionSearchItems, 'PRODUCTION', 'production notices keyword filter');
  assertContainsNotice(productionSearchItems, productionSample, 'production notices keyword filter');

  const warehouseSample = firstNoticeWithValue(warehouseItems, ['orderNo', 'partCode', 'partName', 'customerName', 'noticeNo']);
  assert(warehouseSample, 'warehouse notices page must include a searchable sample notice');
  const warehouseKeyword = noticeSearchKeyword(warehouseSample);
  const warehouseSearchPage = await readJson(`/warehouse/notices${query({ keyword: warehouseKeyword, limit: 20, offset: 0 })}`);
  const warehouseSearchItems = assertPage(warehouseSearchPage, 'warehouse notices keyword filter', 20);
  assertTargetOnly(warehouseSearchItems, 'WAREHOUSE', 'warehouse notices keyword filter');
  assertContainsNotice(warehouseSearchItems, warehouseSample, 'warehouse notices keyword filter');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'production notices page must only return PRODUCTION target rows',
          'warehouse notices page must only return WAREHOUSE target rows',
          'admin notices page must include role-visible notices',
          'notice center status filters',
          'notice center target filters',
          'notice center keyword filters'
        ],
        counts: {
          production: productionPage.totalCount,
          warehouse: warehousePage.totalCount,
          admin: adminPage.totalCount
        }
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
