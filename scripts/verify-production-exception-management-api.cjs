#!/usr/bin/env node

const apiBaseUrl = (
  process.env.PRODUCTION_EXCEPTION_MANAGEMENT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const fixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];
const replenishmentStatuses = ['PENDING', 'APPROVED', 'REJECTED'];
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

function assertPositiveQuantity(value, label) {
  assert(Number(value || 0) > 0, `${label} must be a positive quantity; got ${value}.`);
}

function assertReplenishmentRequestRow(row) {
  assert(row && typeof row === 'object', 'production replenishment request row must be an object.');
  for (const field of ['id', 'requestNo', 'sourceType', 'status', 'orderNo', 'productionTaskNo', 'partCode', 'partName', 'unit', 'createdAt']) {
    assert(String(row[field] || '').trim(), `production replenishment request row must include ${field}.`);
  }
  assert(replenishmentStatuses.includes(row.status), `production replenishment request status must be known, actual=${row.status}.`);
  assertPositiveQuantity(row.requestQuantity, `production replenishment request ${row.requestNo} requestQuantity`);
  assert(Number(row.scrapQuantity || 0) >= 0, `production replenishment request ${row.requestNo} scrapQuantity must be >= 0.`);
  assert(String(row.orderStatus || '').trim(), `production replenishment request ${row.requestNo} must include related orderStatus.`);
}

function assertScrapRecordRow(row) {
  assert(row && typeof row === 'object', 'production scrap record row must be an object.');
  for (const field of [
    'id',
    'scrapNo',
    'orderNo',
    'productionTaskNo',
    'partCode',
    'partName',
    'unit',
    'reason',
    'recordDate',
    'sourceRecordType',
    'sourceRecordId',
    'createdAt'
  ]) {
    assert(String(row[field] || '').trim(), `production scrap record row must include ${field}.`);
  }
  assertPositiveQuantity(row.quantity, `production scrap record ${row.scrapNo} quantity`);
}

function assertContainsId(page, row, label) {
  assert(page.items.some((item) => item.id === row.id), `${label} must include ${row.id}.`);
}

function dateKey(value) {
  return String(value || '').slice(0, 10);
}

async function main() {
  const replenishmentEndpoint = '/production/tasks/replenishment-requests?limit=5&offset=0';
  const replenishmentPage = await readJson(replenishmentEndpoint);
  assertPageShape('production replenishment requests default page', replenishmentEndpoint, replenishmentPage);
  assert(replenishmentPage.totalCount > 0, 'production replenishment requests default page must show current business rows.');
  const replenishmentSample = replenishmentPage.items[0];
  assertReplenishmentRequestRow(replenishmentSample);

  const replenishmentStatusEndpoint = `/production/tasks/replenishment-requests${query({
    status: replenishmentSample.status,
    limit: 5,
    offset: 0
  })}`;
  const replenishmentStatusPage = await readJson(replenishmentStatusEndpoint);
  assertPageShape('production replenishment request status filter', replenishmentStatusEndpoint, replenishmentStatusPage);
  assert(replenishmentStatusPage.items.every((row) => row.status === replenishmentSample.status), 'production replenishment request status filter must only return matching status.');
  assertContainsId(replenishmentStatusPage, replenishmentSample, 'production replenishment request status filter');

  for (const [label, params] of [
    ['keyword filter', { keyword: replenishmentSample.requestNo }],
    ['orderNo filter', { orderNo: replenishmentSample.orderNo }],
    ['productionTaskNo filter', { productionTaskNo: replenishmentSample.productionTaskNo }],
    ['partCode filter', { partCode: replenishmentSample.partCode }]
  ]) {
    const endpoint = `/production/tasks/replenishment-requests${query({ ...params, limit: 5, offset: 0 })}`;
    const page = await readJson(endpoint);
    assertPageShape(`production replenishment request ${label}`, endpoint, page);
    assertContainsId(page, replenishmentSample, `production replenishment request ${label}`);
  }

  const scrapEndpoint = '/production/tasks/scrap-records?limit=5&offset=0';
  const scrapPage = await readJson(scrapEndpoint);
  assertPageShape('production scrap records default page', scrapEndpoint, scrapPage);
  assert(scrapPage.totalCount > 0, 'production scrap records default page must show current business rows.');
  const scrapSample = scrapPage.items[0];
  assertScrapRecordRow(scrapSample);

  const scrapOrderEndpoint = `/production/tasks/scrap-records${query({ orderNo: scrapSample.orderNo, limit: 5, offset: 0 })}`;
  const scrapOrderPage = await readJson(scrapOrderEndpoint);
  assertPageShape('production scrap record orderNo filter', scrapOrderEndpoint, scrapOrderPage);
  assertContainsId(scrapOrderPage, scrapSample, 'production scrap record orderNo filter');

  const scrapDateEndpoint = `/production/tasks/scrap-records${query({
    dateFrom: dateKey(scrapSample.recordDate),
    dateTo: dateKey(scrapSample.recordDate),
    limit: 5,
    offset: 0
  })}`;
  const scrapDatePage = await readJson(scrapDateEndpoint);
  assertPageShape('production scrap record date filter', scrapDateEndpoint, scrapDatePage);
  assertContainsId(scrapDatePage, scrapSample, 'production scrap record date filter');

  const scrapNoMatchEndpoint = '/production/tasks/scrap-records?orderNo=NO_MATCH_SCRAP_RECORD&limit=5&offset=0';
  const scrapNoMatchPage = await readJson(scrapNoMatchEndpoint);
  assertPageShape('production scrap record no-match filter', scrapNoMatchEndpoint, scrapNoMatchPage);
  assert(scrapNoMatchPage.totalCount === 0, 'production scrap record no-match filter must return zero rows.');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'production replenishment requests default page must show current business rows',
          'production replenishment request status filter',
          'production replenishment request keyword/order/task/part filters',
          'production scrap records default page must show current business rows',
          'production scrap record order/date filters',
          'production exception lists hide reusable regression fixtures'
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
