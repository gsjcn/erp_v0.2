#!/usr/bin/env node

const apiBaseUrl = (
  process.env.PROCESS_MANAGEMENT_API_BASE_URL ||
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

function assertProcessDefinition(row) {
  assert(String(row.id || '').trim(), 'process definition row must include id.');
  assert(String(row.processName || '').trim(), `process definition ${row.id || '-'} must include processName.`);
  assert(String(row.status || '').trim(), `process definition ${row.processName || '-'} must include status.`);
}

function assertProcessTemplate(row) {
  assert(String(row.id || '').trim(), 'process template row must include id.');
  assert(String(row.templateName || '').trim(), `process template ${row.id || '-'} must include templateName.`);
  assert(String(row.status || '').trim(), `process template ${row.templateName || '-'} must include status.`);
  assert(Array.isArray(row.steps), `process template ${row.templateName || '-'} must include steps[].`);
  assert(row.steps.length > 0, `process template ${row.templateName || '-'} must include at least one step.`);
  for (const step of row.steps) {
    assert(String(step.processName || '').trim(), `process template ${row.templateName || '-'} step must include processName.`);
  }
}

async function main() {
  const definitionsEndpoint = '/process-definitions?status=ALL&limit=5&offset=0';
  const definitionsPage = await readJson(definitionsEndpoint);
  assertPageShape('process definitions page', definitionsPage);
  assert(definitionsPage.totalCount > 0, 'process definitions page must show standard process rows.');
  definitionsPage.items.forEach(assertProcessDefinition);
  checks.push({
    label: 'process definitions page',
    endpoint: definitionsEndpoint,
    totalCount: definitionsPage.totalCount,
    itemCount: definitionsPage.items.length
  });

  const enabledDefinitionsEndpoint = '/process-definitions?status=ENABLED&limit=200&offset=0';
  const enabledDefinitionsPage = await readJson(enabledDefinitionsEndpoint);
  assertPageShape('enabled process definitions page', enabledDefinitionsPage, 200, 0);
  assert(enabledDefinitionsPage.totalCount > 0, 'enabled process definitions page must show selectable standard process rows.');
  assert(enabledDefinitionsPage.items.every((row) => row.status === 'ENABLED'), 'enabled process definitions page must only return ENABLED rows.');
  enabledDefinitionsPage.items.forEach(assertProcessDefinition);
  const enabledProcessNames = new Set(enabledDefinitionsPage.items.map((row) => row.processName));
  checks.push({
    label: 'enabled process definitions page',
    endpoint: enabledDefinitionsEndpoint,
    totalCount: enabledDefinitionsPage.totalCount,
    itemCount: enabledDefinitionsPage.items.length
  });

  const sampleDefinition = enabledDefinitionsPage.items[0];
  const definitionKeywordEndpoint = `/process-definitions?status=ENABLED&keyword=${encodeURIComponent(sampleDefinition.processName)}&limit=5&offset=0`;
  const definitionKeywordPage = await readJson(definitionKeywordEndpoint);
  assertPageShape('process definition keyword search', definitionKeywordPage);
  assert(
    definitionKeywordPage.items.some((row) => row.id === sampleDefinition.id),
    'process definition keyword search must include the selected process.'
  );
  checks.push({
    label: 'process definition keyword search',
    endpoint: definitionKeywordEndpoint,
    totalCount: definitionKeywordPage.totalCount,
    itemCount: definitionKeywordPage.items.length
  });

  const templatesEndpoint = '/process-templates?status=ALL&limit=5&offset=0';
  const templatesPage = await readJson(templatesEndpoint);
  assertPageShape('process templates page', templatesPage);
  assert(templatesPage.totalCount > 0, 'process templates page must show reusable process templates.');
  templatesPage.items.forEach(assertProcessTemplate);
  checks.push({
    label: 'process templates page',
    endpoint: templatesEndpoint,
    totalCount: templatesPage.totalCount,
    itemCount: templatesPage.items.length
  });

  const enabledTemplatesEndpoint = '/process-templates?status=ENABLED&limit=200&offset=0';
  const enabledTemplatesPage = await readJson(enabledTemplatesEndpoint);
  assertPageShape('enabled process templates page', enabledTemplatesPage, 200, 0);
  assert(enabledTemplatesPage.totalCount > 0, 'enabled process templates page must show selectable reusable process templates.');
  assert(enabledTemplatesPage.items.every((row) => row.status === 'ENABLED'), 'enabled process templates page must only return ENABLED rows.');
  enabledTemplatesPage.items.forEach(assertProcessTemplate);
  for (const template of enabledTemplatesPage.items) {
    for (const step of template.steps) {
      assert(
        enabledProcessNames.has(step.processName),
        `enabled process template ${template.templateName} references missing or disabled process step ${step.processName}.`
      );
    }
  }
  checks.push({
    label: 'enabled process templates page',
    endpoint: enabledTemplatesEndpoint,
    totalCount: enabledTemplatesPage.totalCount,
    itemCount: enabledTemplatesPage.items.length
  });

  const sampleTemplate = enabledTemplatesPage.items[0];
  const templateKeywordEndpoint = `/process-templates?status=ENABLED&keyword=${encodeURIComponent(sampleTemplate.templateName)}&limit=5&offset=0`;
  const templateKeywordPage = await readJson(templateKeywordEndpoint);
  assertPageShape('process template keyword search', templateKeywordPage);
  assert(
    templateKeywordPage.items.some((row) => row.id === sampleTemplate.id),
    'process template keyword search must include the selected template.'
  );
  checks.push({
    label: 'process template keyword search',
    endpoint: templateKeywordEndpoint,
    totalCount: templateKeywordPage.totalCount,
    itemCount: templateKeywordPage.items.length
  });

  console.log(JSON.stringify({ ok: true, apiBaseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
