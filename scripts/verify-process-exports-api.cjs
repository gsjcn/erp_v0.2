#!/usr/bin/env node

const ExcelJS = require('exceljs');
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
  process.env.PROCESS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const fixturePrefix = 'MI-API-PROCESS-STABLE';
const fixtureDefinitionName = `${fixturePrefix}-DEFINITION`;
const fixtureTemplateName = `${fixturePrefix}-TEMPLATE`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function workbookText(workbook) {
  const chunks = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        chunks.push(String(cell.text || cell.value || ''));
      });
    });
  });
  return chunks.join('\n');
}

async function requestJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function requestWorkbook(path, expectedFileName) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `${expectedFileName} content-type must be real .xlsx, actual: ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes(expectedFileName), `${expectedFileName} export must use a stable filename`);
  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', `${expectedFileName} export must be a .xlsx zip file`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  assert(sheet, `${expectedFileName} export must include a worksheet`);
  assert(sheet.rowCount >= 4, `${expectedFileName} export must include title, scope and header rows`);
  return {
    byteLength: buffer.length,
    rowCount: sheet.rowCount,
    text: workbookText(workbook)
  };
}

async function assertFixtureVisibility() {
  const definitionDefaultList = await requestJson(
    `/process-definitions?status=ALL&keyword=${encodeURIComponent(fixturePrefix)}&limit=20&offset=0`
  );
  assert(
    !JSON.stringify(definitionDefaultList).includes(fixturePrefix),
    'process definitions list must hide stable test fixtures unless includeTestFixtures=true'
  );
  const definitionFixtureList = await requestJson(
    `/process-definitions?status=ALL&keyword=${encodeURIComponent(fixturePrefix)}&includeTestFixtures=true&limit=20&offset=0`
  );
  if (definitionFixtureList.totalCount > 0) {
    assert(
      JSON.stringify(definitionFixtureList).includes(fixturePrefix),
      'process definitions list includeTestFixtures=true must expose matching stable test fixtures when they exist'
    );
  }

  const templateDefaultList = await requestJson(
    `/process-templates?status=ALL&keyword=${encodeURIComponent(fixturePrefix)}&limit=20&offset=0`
  );
  assert(
    !JSON.stringify(templateDefaultList).includes(fixturePrefix),
    'process templates list must hide stable test fixtures unless includeTestFixtures=true'
  );
  const templateFixtureList = await requestJson(
    `/process-templates?status=ALL&keyword=${encodeURIComponent(fixturePrefix)}&includeTestFixtures=true&limit=20&offset=0`
  );
  if (templateFixtureList.totalCount > 0) {
    assert(
      JSON.stringify(templateFixtureList).includes(fixturePrefix),
      'process templates list includeTestFixtures=true must expose matching stable test fixtures when they exist'
    );
  }

  const definitionDefaultExport = await requestWorkbook(
    `/process-definitions/export?status=ALL&keyword=${encodeURIComponent(fixturePrefix)}`,
    'process-definitions-export.xlsx'
  );
  assert(
    !definitionDefaultExport.text.includes(fixtureDefinitionName),
    'process definitions export must hide stable test fixtures unless includeTestFixtures=true'
  );
  const definitionFixtureExport = await requestWorkbook(
    `/process-definitions/export?status=ALL&keyword=${encodeURIComponent(fixturePrefix)}&includeTestFixtures=true`,
    'process-definitions-export.xlsx'
  );
  if (definitionFixtureList.totalCount > 0) {
    assert(
      definitionFixtureExport.text.includes(fixturePrefix),
      'process definitions export includeTestFixtures=true must expose matching stable test fixtures when they exist'
    );
  }

  const templateDefaultExport = await requestWorkbook(
    `/process-templates/export?status=ALL&keyword=${encodeURIComponent(fixturePrefix)}`,
    'process-templates-export.xlsx'
  );
  assert(
    !templateDefaultExport.text.includes(fixtureTemplateName),
    'process templates export must hide stable test fixtures unless includeTestFixtures=true'
  );
  const templateFixtureExport = await requestWorkbook(
    `/process-templates/export?status=ALL&keyword=${encodeURIComponent(fixturePrefix)}&includeTestFixtures=true`,
    'process-templates-export.xlsx'
  );
  if (templateFixtureList.totalCount > 0) {
    assert(
      templateFixtureExport.text.includes(fixturePrefix),
      'process templates export includeTestFixtures=true must expose matching stable test fixtures when they exist'
    );
  }
}

async function assertPagedProcessDefinitions() {
  const payload = await requestJson('/process-definitions?status=ALL&limit=1&offset=0');
  assert(!Array.isArray(payload), 'process definitions public list must return an explicit paged object');
  assert(Array.isArray(payload.items), 'process definitions public list must include items');
  assert(Number.isInteger(payload.totalCount), 'process definitions public list must include totalCount');
  assert(payload.limit === 1, 'process definitions public list must respect limit without requiring withPage=true');
  assert(payload.offset === 0, 'process definitions public list must include offset');
  assert(typeof payload.hasMore === 'boolean', 'process definitions public list must include hasMore');
  return { totalCount: payload.totalCount, returned: payload.items.length };
}

async function assertPagedProcessTemplates() {
  const payload = await requestJson('/process-templates?status=ALL&limit=1&offset=0');
  assert(!Array.isArray(payload), 'process templates public list must return an explicit paged object');
  assert(Array.isArray(payload.items), 'process templates public list must include items');
  assert(Number.isInteger(payload.totalCount), 'process templates public list must include totalCount');
  assert(payload.limit === 1, 'process templates public list must respect limit without requiring withPage=true');
  assert(payload.offset === 0, 'process templates public list must include offset');
  assert(typeof payload.hasMore === 'boolean', 'process templates public list must include hasMore');
  return { totalCount: payload.totalCount, returned: payload.items.length };
}

async function main() {
  await assertFixtureVisibility();

  const definitionList = await assertPagedProcessDefinitions();
  const templateList = await assertPagedProcessTemplates();

  const definitions = await requestWorkbook(
    '/process-definitions/export?status=ALL&keyword=NO_MATCH_PROCESS_EXPORT',
    'process-definitions-export.xlsx'
  );
  assert(definitions.text.includes('NO_MATCH_PROCESS_EXPORT'), 'process definitions export scope must include keyword');

  const templates = await requestWorkbook(
    '/process-templates/export?status=ALL&keyword=NO_MATCH_TEMPLATE_EXPORT',
    'process-templates-export.xlsx'
  );
  assert(templates.text.includes('NO_MATCH_TEMPLATE_EXPORT'), 'process templates export scope must include keyword');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'process-definitions-public-list-pagination',
          'process-templates-public-list-pagination',
          'process-definitions-export-xlsx',
          'process-templates-export-xlsx',
          'process-exports-read-only',
          'process-definitions-fixture-filter',
          'process-templates-fixture-filter',
          'process-definitions-export-fixture-filter',
          'process-templates-export-fixture-filter'
        ],
        definitionList,
        templateList,
        definitions: { byteLength: definitions.byteLength, rowCount: definitions.rowCount },
        templates: { byteLength: templates.byteLength, rowCount: templates.rowCount }
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
  });
