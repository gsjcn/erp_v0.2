#!/usr/bin/env node

const apiBaseUrl = (
  process.env.STATISTICS_MANAGEMENT_API_BASE_URL ||
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

function assertStatisticsRows(label, endpoint, data, expected) {
  assert(data.period === expected.period, `${label} must echo period=${expected.period}; got ${data.period || '-'}.`);
  assert(data.year === expected.year, `${label} must echo year=${expected.year}; got ${data.year || '-'}.`);
  if (expected.quarter === undefined) {
    assert(data.quarter === undefined, `${label} must not echo quarter when all quarters are selected.`);
  } else {
    assert(data.quarter === expected.quarter, `${label} must echo quarter=${expected.quarter}; got ${data.quarter || '-'}.`);
  }
  if (expected.month === undefined) {
    assert(data.month === undefined, `${label} must not echo month when all months are selected.`);
  } else {
    assert(data.month === expected.month, `${label} must echo month=${expected.month}; got ${data.month || '-'}.`);
  }
  assert(Array.isArray(data.summaryRows), `${label} must return summaryRows[].`);
  assert(Array.isArray(data.customerRows), `${label} must return customerRows[].`);
  assert(Array.isArray(data.orderRows), `${label} must return orderRows[].`);
  assert(Array.isArray(data.inventorySnapshotRows), `${label} must return inventorySnapshotRows[].`);
  assert(Number(data.inventorySnapshotTotal || 0) >= data.inventorySnapshotRows.length, `${label} inventorySnapshotTotal is invalid.`);
  assertNoFixtureText(label, data);

  checks.push({
    label,
    endpoint,
    period: data.period,
    year: data.year,
    quarter: data.quarter,
    month: data.month,
    summaryRows: data.summaryRows.length,
    customerRows: data.customerRows.length,
    orderRows: data.orderRows.length,
    inventorySnapshotTotal: data.inventorySnapshotTotal || 0
  });
}

async function main() {
  const options = await readJson('/statistics/options');
  assert(Array.isArray(options.years) && options.years.length > 0, 'statistics/options must return selectable years.');
  assert(Number.isInteger(options.currentBusinessYear), 'statistics/options must return currentBusinessYear.');
  assert(Number.isInteger(options.currentBusinessQuarter), 'statistics/options must return currentBusinessQuarter.');
  assert(Number.isInteger(options.currentBusinessMonth), 'statistics/options must return currentBusinessMonth.');
  assert(options.years.includes(options.currentBusinessYear), 'statistics/options years must include currentBusinessYear.');
  assert(
    options.years.every((year, index, rows) => Number.isInteger(year) && year >= 2000 && year <= 2100 && (index === 0 || rows[index - 1] > year)),
    'statistics/options years must be sorted descending and stay within business range.'
  );
  assert(options.currentBusinessQuarter >= 1 && options.currentBusinessQuarter <= 4, 'currentBusinessQuarter must be 1-4.');
  assert(options.currentBusinessMonth >= 1 && options.currentBusinessMonth <= 12, 'currentBusinessMonth must be 1-12.');
  assertNoFixtureText('statistics options', options);
  checks.push({
    label: 'statistics options',
    endpoint: '/statistics/options',
    years: options.years,
    currentBusinessYear: options.currentBusinessYear,
    currentBusinessQuarter: options.currentBusinessQuarter,
    currentBusinessMonth: options.currentBusinessMonth
  });

  const year = options.currentBusinessYear;
  const quarter = options.currentBusinessQuarter;
  const month = options.currentBusinessMonth;

  const yearStatisticsEndpoint = `/statistics/orders?period=year&year=${year}`;
  const yearStatistics = await readJson(yearStatisticsEndpoint);
  assertStatisticsRows('statistics year filter', yearStatisticsEndpoint, yearStatistics, { period: 'year', year });
  assert(yearStatistics.isFuturePeriod === false, 'current year statistics must not be marked as future.');
  assert(yearStatistics.statisticsEndDate === options.currentBusinessDate, 'current year statistics must stop at currentBusinessDate.');
  assert(yearStatistics.summaryRows.length > 0, 'current year statistics must show business summary rows.');
  assert(yearStatistics.orderRows.length > 0, 'current year statistics must show business order rows.');

  const allQuarterEndpoint = `/statistics/orders?period=quarter&year=${year}`;
  const allQuarterStatistics = await readJson(allQuarterEndpoint);
  assertStatisticsRows('statistics all-quarter filter', allQuarterEndpoint, allQuarterStatistics, { period: 'quarter', year });

  const quarterEndpoint = `/statistics/orders?period=quarter&year=${year}&quarter=${quarter}`;
  const quarterStatistics = await readJson(quarterEndpoint);
  assertStatisticsRows('statistics selected-quarter filter', quarterEndpoint, quarterStatistics, { period: 'quarter', year, quarter });
  assert(quarterStatistics.month === undefined, 'selected-quarter statistics must ignore month filter.');

  const allMonthEndpoint = `/statistics/orders?period=month&year=${year}`;
  const allMonthStatistics = await readJson(allMonthEndpoint);
  assertStatisticsRows('statistics all-month filter', allMonthEndpoint, allMonthStatistics, { period: 'month', year });

  const monthEndpoint = `/statistics/orders?period=month&year=${year}&month=${month}`;
  const monthStatistics = await readJson(monthEndpoint);
  assertStatisticsRows('statistics selected-month filter', monthEndpoint, monthStatistics, { period: 'month', year, month });
  assert(monthStatistics.quarter === undefined, 'selected-month statistics must ignore quarter filter.');

  const conflictingQuarterEndpoint = `/statistics/orders?period=quarter&year=${year}&quarter=${quarter}&month=${month}`;
  const conflictingQuarterStatistics = await readJson(conflictingQuarterEndpoint);
  assertStatisticsRows('statistics quarter ignores stray month', conflictingQuarterEndpoint, conflictingQuarterStatistics, {
    period: 'quarter',
    year,
    quarter
  });

  const conflictingMonthEndpoint = `/statistics/orders?period=month&year=${year}&quarter=${quarter}&month=${month}`;
  const conflictingMonthStatistics = await readJson(conflictingMonthEndpoint);
  assertStatisticsRows('statistics month ignores stray quarter', conflictingMonthEndpoint, conflictingMonthStatistics, {
    period: 'month',
    year,
    month
  });

  const futureYear = year + 1;
  const futureEndpoint = `/statistics/orders?period=month&year=${futureYear}&month=1`;
  const futureStatistics = await readJson(futureEndpoint);
  assertStatisticsRows('statistics future month filter', futureEndpoint, futureStatistics, { period: 'month', year: futureYear, month: 1 });
  assert(futureStatistics.isFuturePeriod === true, 'future month statistics must be marked as future.');
  assert(futureStatistics.summaryRows.length === 0, 'future month statistics must not show happened summary rows.');
  assert(futureStatistics.orderRows.length === 0, 'future month statistics must not show happened order rows.');

  console.log(JSON.stringify({ ok: true, apiBaseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
