#!/usr/bin/env node

const ExcelJS = require('exceljs');

const apiBaseUrl = (
  process.env.BUSINESS_FIXTURE_VISIBILITY_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

const fixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

function currentBusinessDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BUSINESS_TIME_ZONE || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value || '0');
  const month = Number(parts.find((part) => part.type === 'month')?.value || '0');
  return {
    year,
    month,
    quarter: Math.floor((month - 1) / 3) + 1
  };
}

const currentBusinessDate = currentBusinessDateParts();

const endpoints = [
  '/customers?limit=200&offset=0',
  '/customers/export',
  '/materials/dashboard?limit=200&offset=0',
  '/materials/dashboard/export',
  '/materials/project-models',
  '/materials/common-project-models',
  '/inventory/materials?limit=200&offset=0',
  '/inventory/materials/export',
  '/inventory/model-boms?status=ALL&limit=200&offset=0',
  '/inventory/model-boms/export?status=ALL',
  '/inventory/model-bom-scope-approval-requests?status=ALL&limit=200&offset=0',
  '/inventory/material-transform-rules?status=ALL&limit=200&offset=0',
  '/inventory/material-transform-rules/export?status=ALL',
  '/orders?limit=200&offset=0',
  '/orders/export',
  '/orders/import-sessions?limit=200&offset=0',
  '/production/tasks?limit=200&offset=0',
  '/production/tasks/order-summary?limit=200&offset=0',
  '/production/tasks/export',
  `/production/tasks/annual-summary?year=${currentBusinessDate.year}`,
  '/production/tasks/notices?limit=200&offset=0',
  '/production/tasks/notices/export',
  '/production/tasks/notices/admin?limit=200&offset=0',
  '/production/tasks/notices/admin/export',
  '/production/tasks/replenishment-requests?limit=200&offset=0',
  '/production/tasks/replenishment-requests/export',
  '/production/tasks/scrap-records?limit=200&offset=0',
  '/production/tasks/scrap-records/export',
  '/warehouses?status=ALL&locationStatus=ALL',
  '/warehouses/export?status=ALL&locationStatus=ALL',
  '/warehouse/notices?limit=200&offset=0',
  '/warehouse/notices/export',
  '/warehouse/receipts/pending',
  '/warehouse/shipments/pending',
  '/warehouse/work/export',
  '/warehouse/transactions?limit=200&offset=0',
  '/warehouse/transactions/export',
  '/inventory?limit=200&offset=0',
  '/inventory/export',
  '/inventory/summary?limit=200&offset=0',
  '/statistics/options',
  `/statistics/orders?period=year&year=${currentBusinessDate.year}`,
  `/statistics/orders?period=quarter&year=${currentBusinessDate.year}&quarter=${currentBusinessDate.quarter}`,
  `/statistics/orders?period=month&year=${currentBusinessDate.year}&month=${currentBusinessDate.month}`,
  `/statistics/orders/export?period=year&year=${currentBusinessDate.year}`,
  `/statistics/orders/export?period=quarter&year=${currentBusinessDate.year}&quarter=${currentBusinessDate.quarter}`,
  `/statistics/orders/export?period=month&year=${currentBusinessDate.year}&month=${currentBusinessDate.month}`,
  '/process-definitions?status=ALL&limit=200&offset=0',
  '/process-definitions/export?status=ALL',
  '/process-templates?status=ALL&limit=200&offset=0',
  '/process-templates/export?status=ALL'
];

async function responseText(response) {
  const contentType = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!contentType.includes('spreadsheetml.sheet')) {
    return buffer.toString('utf8');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
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

function leakSample(text, prefix) {
  const index = text.indexOf(prefix);
  if (index < 0) {
    return '';
  }
  return text.slice(Math.max(0, index - 120), index + 240);
}

async function main() {
  const failures = [];
  const leaks = [];

  for (const endpoint of endpoints) {
    const response = await fetch(`${apiBaseUrl}${endpoint}`);
    const text = await responseText(response);
    if (!response.ok) {
      failures.push({ endpoint, status: response.status, reason: text.slice(0, 240) });
      continue;
    }

    const prefix = fixturePrefixes.find((item) => text.includes(item));
    if (prefix) {
      leaks.push({
        endpoint,
        status: response.status,
        prefix,
        sample: leakSample(text, prefix)
      });
    }
  }

  if (failures.length > 0 || leaks.length > 0) {
    console.error(JSON.stringify({ ok: false, apiBaseUrl, checked: endpoints.length, failures, leaks }, null, 2));
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: endpoints.length,
        currentBusinessDate,
        fixturePrefixes
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
