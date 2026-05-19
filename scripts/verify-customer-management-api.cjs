#!/usr/bin/env node

const apiBaseUrl = (
  process.env.CUSTOMER_MANAGEMENT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const fixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];
const checks = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function assertNoFixtureText(label, value) {
  const text = JSON.stringify(value || {});
  const matchedPrefix = fixturePrefixes.find((prefix) => text.includes(prefix));
  assert(!matchedPrefix, `${label} must hide reusable test fixture prefix ${matchedPrefix} by default.`);
}

function assertPageShape(label, page, expectedLimit = 5, expectedOffset = 0) {
  assert(page && !Array.isArray(page), `${label} must return a paginated object.`);
  assert(Array.isArray(page.items), `${label} must return items[].`);
  assert(page.limit === expectedLimit, `${label} must echo limit=${expectedLimit}; got ${page.limit}.`);
  assert(page.offset === expectedOffset, `${label} must echo offset=${expectedOffset}; got ${page.offset}.`);
  assert(Number.isInteger(page.totalCount), `${label} must return integer totalCount.`);
  assert(typeof page.hasMore === 'boolean', `${label} must return boolean hasMore.`);
  assert(page.items.length <= expectedLimit, `${label} must not return more than limit rows.`);
  assert(page.hasMore === expectedOffset + page.items.length < page.totalCount, `${label} hasMore does not match pagination math.`);
  assertNoFixtureText(label, page);
}

function assertCustomerRow(row) {
  assert(String(row.id || '').trim(), 'customer row must include id.');
  assert(String(row.customerCode || '').trim(), 'customer row must include customerCode.');
  assert(String(row.customerName || '').trim(), `customer ${row.customerCode || '-'} must include customerName.`);
  assert(String(row.status || '').trim(), `customer ${row.customerCode || '-'} must include status.`);
  assert(Array.isArray(row.contacts), `customer ${row.customerCode || '-'} must include contacts[].`);
}

async function assertCustomerSearch(endpoint, expectedCustomerId, label) {
  const page = await readJson(endpoint);
  assertPageShape(label, page);
  assert(
    page.items.some((row) => row.id === expectedCustomerId),
    `${label} must include the expected customer.`
  );
  checks.push({ label, endpoint, totalCount: page.totalCount, itemCount: page.items.length });
}

async function main() {
  const defaultEndpoint = '/customers?limit=5&offset=0';
  const defaultPage = await readJson(defaultEndpoint);
  assertPageShape('customer default list', defaultPage);
  assert(defaultPage.totalCount > 0, 'customer default list must show usable business customers.');
  assertCustomerRow(defaultPage.items[0]);
  checks.push({
    label: 'customer default list',
    endpoint: defaultEndpoint,
    totalCount: defaultPage.totalCount,
    itemCount: defaultPage.items.length
  });

  const enabledEndpoint = '/customers?status=ENABLED&limit=5&offset=0';
  const enabledPage = await readJson(enabledEndpoint);
  assertPageShape('customer enabled filter', enabledPage);
  assert(enabledPage.totalCount > 0, 'customer enabled filter must show enabled customers.');
  assert(enabledPage.items.every((row) => row.status === 'ENABLED'), 'customer enabled filter must only return ENABLED rows.');
  checks.push({
    label: 'customer enabled filter',
    endpoint: enabledEndpoint,
    totalCount: enabledPage.totalCount,
    itemCount: enabledPage.items.length
  });

  const sampleCustomer = enabledPage.items[0];
  assertCustomerRow(sampleCustomer);

  const detailEndpoint = `/customers/${encodeURIComponent(sampleCustomer.id)}`;
  const detail = await readJson(detailEndpoint);
  assertCustomerRow(detail);
  assert(detail.id === sampleCustomer.id, 'customer detail must return the requested customer.');
  assertNoFixtureText('customer detail', detail);
  checks.push({ label: 'customer detail', endpoint: detailEndpoint, customerCode: detail.customerCode });

  await assertCustomerSearch(
    `/customers?keyword=${encodeURIComponent(sampleCustomer.customerCode)}&limit=5&offset=0`,
    sampleCustomer.id,
    'customer code keyword search'
  );
  await assertCustomerSearch(
    `/customers?keyword=${encodeURIComponent(sampleCustomer.customerName.slice(0, 2))}&limit=5&offset=0`,
    sampleCustomer.id,
    'customer name keyword search'
  );
  if (sampleCustomer.contactName) {
    await assertCustomerSearch(
      `/customers?keyword=${encodeURIComponent(sampleCustomer.contactName)}&limit=5&offset=0`,
      sampleCustomer.id,
      'customer contact keyword search'
    );
  }

  const existingCodeCheck = await readJson(`/customers/check-code?customerCode=${encodeURIComponent(sampleCustomer.customerCode.toLowerCase())}`);
  assert(existingCodeCheck.exists === true, 'customer code duplicate check must be case-insensitive.');
  assert(existingCodeCheck.available === false, 'customer code duplicate check must mark existing code unavailable.');
  checks.push({ label: 'customer code duplicate check', customerCode: existingCodeCheck.customerCode });

  const availableCodeCheck = await readJson('/customers/check-code?customerCode=C-999999-NEW');
  assert(availableCodeCheck.exists === false, 'customer code available check must mark unused code as not existing.');
  assert(availableCodeCheck.available === true, 'customer code available check must mark unused code available.');
  checks.push({ label: 'customer code available check', customerCode: availableCodeCheck.customerCode });

  const existingNameCheck = await readJson(`/customers/check-name?customerName=${encodeURIComponent(sampleCustomer.customerName)}`);
  assert(existingNameCheck.exists === true, 'customer name duplicate check must detect existing names.');
  assert(existingNameCheck.available === false, 'customer name duplicate check must mark existing name unavailable.');
  checks.push({ label: 'customer name duplicate check', customerName: existingNameCheck.customerName });

  const nextCode = await readJson('/customers/next-code');
  assert(/^C-\d+$/.test(String(nextCode.customerCode || '')), `customer next-code must return C-number format; got ${nextCode.customerCode || '-'}.`);
  checks.push({ label: 'customer next-code', customerCode: nextCode.customerCode });

  console.log(JSON.stringify({ ok: true, apiBaseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
