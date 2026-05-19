#!/usr/bin/env node

const apiBaseUrl = (
  process.env.CUSTOMER_CONTACT_MANAGEMENT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  process.env.CUSTOMER_MANAGEMENT_API_BASE_URL ||
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
  assert(!matchedPrefix, `${label} must hide reusable regression fixture prefix ${matchedPrefix} by default.`);
}

function assertPageShape(label, page, expectedLimit = 50, expectedOffset = 0) {
  assert(page && typeof page === 'object' && !Array.isArray(page), `${label} must return a paginated object.`);
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
  assert(row.status === 'ENABLED', `customer ${row.customerCode || '-'} must be ENABLED for contact management baseline.`);
  assert(Array.isArray(row.contacts), `customer ${row.customerCode || '-'} must include contacts[].`);
}

function assertContactRow(contact, customer) {
  assert(String(contact.id || '').trim(), `customer ${customer.customerCode} contact must include id.`);
  assert(contact.customerId === customer.id, `customer ${customer.customerCode} contact must keep customerId.`);
  assert(String(contact.contactName || '').trim(), `customer ${customer.customerCode} contact must include contactName.`);
  assert(contact.status === 'ENABLED', `customer ${customer.customerCode} contact must only expose ENABLED contacts.`);
  assert(typeof contact.isPrimary === 'boolean', `customer ${customer.customerCode} contact must include boolean isPrimary.`);
}

function assertPrimaryContactInvariant(customer) {
  const contacts = customer.contacts || [];
  assert(contacts.length > 0, 'customer contact detail must keep enabled contact rows.');
  contacts.forEach((contact) => assertContactRow(contact, customer));

  const primaryContacts = contacts.filter((contact) => contact.isPrimary);
  assert(primaryContacts.length === 1, 'enabled customer must keep exactly one enabled primary contact.');
  assert(contacts[0].id === primaryContacts[0].id, 'customer contacts must return the primary contact first.');

  const primaryContact = primaryContacts[0];
  assert(customer.contactName === primaryContact.contactName, 'customer primary contact snapshot must match contacts[].contactName.');
  assert(customer.contactPhone === primaryContact.contactPhone, 'customer primary phone snapshot must match contacts[].contactPhone.');
  return primaryContact;
}

function customerInPage(page, expectedCustomerId) {
  return page.items.some((row) => row.id === expectedCustomerId);
}

async function assertCustomerSearch(keyword, expectedCustomerId, label) {
  const endpoint = `/customers?keyword=${encodeURIComponent(keyword)}&status=ENABLED&limit=50&offset=0`;
  const page = await readJson(endpoint);
  assertPageShape(label, page);
  assert(customerInPage(page, expectedCustomerId), 'customer contact keyword search must include matching customers.');
  checks.push({ label, endpoint, totalCount: page.totalCount, itemCount: page.items.length });
}

async function findCustomerWithContacts() {
  const endpoint = '/customers?status=ENABLED&limit=50&offset=0';
  const page = await readJson(endpoint);
  assertPageShape('customer enabled list for contact management', page);
  assert(page.totalCount > 0, 'customer contact management baseline must have enabled business customers.');
  page.items.forEach(assertCustomerRow);
  const customer = page.items.find((row) => row.contacts.length > 0);
  assert(customer, 'customer contact management baseline must have at least one enabled customer with contacts.');
  return { page, customer };
}

async function main() {
  const { page, customer } = await findCustomerWithContacts();
  const listPrimaryContact = assertPrimaryContactInvariant(customer);
  checks.push({
    label: 'customer list contact snapshot',
    endpoint: '/customers?status=ENABLED&limit=50&offset=0',
    customerCode: customer.customerCode,
    contactCount: customer.contacts.length
  });

  const detailEndpoint = `/customers/${encodeURIComponent(customer.id)}`;
  const detail = await readJson(detailEndpoint);
  assertCustomerRow(detail);
  assert(detail.id === customer.id, 'customer detail must return the selected customer.');
  assertNoFixtureText('customer contact detail', detail);
  const detailPrimaryContact = assertPrimaryContactInvariant(detail);
  assert(
    detail.contacts.map((contact) => contact.id).join('|') === customer.contacts.map((contact) => contact.id).join('|'),
    'customer list and detail must expose the same enabled contact order.'
  );
  assert(detailPrimaryContact.id === listPrimaryContact.id, 'customer list and detail must agree on primary contact.');
  checks.push({
    label: 'customer contact detail',
    endpoint: detailEndpoint,
    customerCode: detail.customerCode,
    primaryContactName: detailPrimaryContact.contactName
  });

  await assertCustomerSearch(detailPrimaryContact.contactName, customer.id, 'customer contact name keyword search');
  if (detailPrimaryContact.contactPhone) {
    await assertCustomerSearch(detailPrimaryContact.contactPhone, customer.id, 'customer contact phone keyword search');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'customer contact detail must keep enabled contact rows',
          'enabled customer must keep exactly one enabled primary contact',
          'customer contact keyword search must include matching customers',
          'customer list and detail must expose the same enabled contact order'
        ],
        baseline: {
          totalEnabledCustomers: page.totalCount,
          customerCode: detail.customerCode,
          primaryContactName: detailPrimaryContact.contactName
        },
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
