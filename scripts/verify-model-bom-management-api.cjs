#!/usr/bin/env node

const apiBaseUrl = (
  process.env.MODEL_BOM_MANAGEMENT_API_BASE_URL ||
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

function assertScopeSummary(summary) {
  assert(summary && typeof summary === 'object', 'model BOM page must include scopeSummary.');
  for (const key of ['totalCount', 'allCustomerCount', 'selectedCustomerCount', 'privateCount', 'commonCount']) {
    assert(Number.isInteger(summary[key]), `model BOM scopeSummary must include integer ${key}.`);
  }
  assert(
    summary.allCustomerCount + summary.selectedCustomerCount + summary.privateCount === summary.totalCount,
    'model BOM scopeSummary customer-scope counts must add up to totalCount.'
  );
  assert(summary.commonCount <= summary.totalCount, 'model BOM scopeSummary commonCount must not exceed totalCount.');
}

function assertLineSummary(row) {
  const summary = row.lineSummary;
  assert(summary && typeof summary === 'object', `BOM ${row.bomName || '-'} must include lineSummary.`);
  for (const key of [
    'componentCount',
    'childPartCount',
    'standalonePartCount',
    'orphanPartCount',
    'disabledCount',
    'materialDisabledCount',
    'effectiveCount',
    'inactiveCount'
  ]) {
    assert(Number.isInteger(summary[key]), `BOM ${row.bomName || '-'} lineSummary must include integer ${key}.`);
  }
  assert(
    summary.componentCount + summary.childPartCount + summary.standalonePartCount + summary.orphanPartCount === summary.effectiveCount,
    `BOM ${row.bomName || '-'} effective structure counts must add up.`
  );
  assert(
    summary.effectiveCount + summary.inactiveCount === Number(row.lineCount || 0),
    `BOM ${row.bomName || '-'} lineSummary effective + inactive must equal lineCount.`
  );
}

function assertModelBomRow(row, label = 'model BOM row') {
  assert(String(row.id || '').trim(), `${label} must include id.`);
  assert(String(row.bomName || '').trim(), `${label} must include bomName.`);
  assert(String(row.customerScopeMode || '').trim(), `BOM ${row.bomName || '-'} must include customerScopeMode.`);
  assert(String(row.customerScopeKey || '').trim(), `BOM ${row.bomName || '-'} must include customerScopeKey.`);
  assert(String(row.projectModelScopeKey || '').trim(), `BOM ${row.bomName || '-'} must include projectModelScopeKey.`);
  assert(String(row.scopeLabel || '').trim(), `BOM ${row.bomName || '-'} must include scopeLabel.`);
  assert(typeof row.isCommon === 'boolean', `BOM ${row.bomName || '-'} must include boolean isCommon.`);
  assert(Number.isInteger(row.lineCount), `BOM ${row.bomName || '-'} must include integer lineCount.`);
  assert(Number.isInteger(row.sameScopeBomCount), `BOM ${row.bomName || '-'} must include sameScopeBomCount.`);
  assert(Array.isArray(row.scopeCustomerIds), `BOM ${row.bomName || '-'} must include scopeCustomerIds[].`);
  assert(Array.isArray(row.scopeCustomers), `BOM ${row.bomName || '-'} must include scopeCustomers[].`);
  assert(Array.isArray(row.lines), `BOM ${row.bomName || '-'} must include lines[].`);
  assertLineSummary(row);
  if (row.isCommon) {
    assert(Number(row.commonSortOrder || 0) > 0, `common BOM ${row.bomName || '-'} must include positive commonSortOrder.`);
  } else {
    assert(row.commonSortOrder === null || row.commonSortOrder === undefined, `non-common BOM ${row.bomName || '-'} must not keep commonSortOrder.`);
  }
}

function assertModelBomLine(line, bomName) {
  assert(String(line.id || '').trim(), `BOM ${bomName} line must include id.`);
  assert(String(line.materialId || '').trim(), `BOM ${bomName} line must include materialId.`);
  assert(String(line.partCode || '').trim(), `BOM ${bomName} line must include partCode.`);
  assert(String(line.partName || '').trim(), `BOM ${bomName} line ${line.partCode || '-'} must include partName.`);
  assert(String(line.unit || '').trim(), `BOM ${bomName} line ${line.partCode || '-'} must include unit.`);
  assert(String(line.lineType || '').trim(), `BOM ${bomName} line ${line.partCode || '-'} must include lineType.`);
  assert(String(line.structureType || '').trim(), `BOM ${bomName} line ${line.partCode || '-'} must include structureType.`);
  assert(Number(line.defaultQuantity || 0) > 0, `BOM ${bomName} line ${line.partCode || '-'} must include positive defaultQuantity.`);
  assert(Number.isInteger(line.sortOrder), `BOM ${bomName} line ${line.partCode || '-'} must include sortOrder.`);
  assert(Number.isInteger(line.displayOrder), `BOM ${bomName} line ${line.partCode || '-'} must include displayOrder.`);
  assert(String(line.status || '').trim(), `BOM ${bomName} line ${line.partCode || '-'} must include status.`);
  assert(String(line.materialStatus || '').trim(), `BOM ${bomName} line ${line.partCode || '-'} must include materialStatus.`);
}

function assertModelBomDetail(detail) {
  assertModelBomRow(detail, 'model BOM detail');
  assert(detail.lines.length === detail.lineCount, `BOM ${detail.bomName} detail must return full lines matching lineCount.`);
  const componentNos = new Set(
    detail.lines
      .filter((line) => line.structureType === 'COMPONENT')
      .map((line) => String(line.componentNo || '').trim())
      .filter(Boolean)
  );
  for (const line of detail.lines) {
    assertModelBomLine(line, detail.bomName);
    if (line.structureType === 'COMPONENT') {
      assert(String(line.componentNo || '').trim(), `BOM ${detail.bomName} component line ${line.partCode} must include componentNo.`);
      assert(!line.parentComponentNo, `BOM ${detail.bomName} component line ${line.partCode} must not include parentComponentNo.`);
    }
    if (line.structureType === 'CHILD_PART') {
      assert(String(line.parentComponentNo || '').trim(), `BOM ${detail.bomName} child part ${line.partCode} must include parentComponentNo.`);
      assert(
        componentNos.has(String(line.parentComponentNo || '').trim()),
        `BOM ${detail.bomName} child part ${line.partCode} must reference an existing component.`
      );
    }
    if (line.structureType === 'STANDALONE_PART') {
      assert(!line.parentComponentNo, `BOM ${detail.bomName} standalone part ${line.partCode} must not include parentComponentNo.`);
    }
  }
}

async function assertBomPage(endpoint, label, expectedLimit = 5, expectedOffset = 0) {
  const page = await readJson(endpoint);
  assertPageShape(label, page, expectedLimit, expectedOffset);
  assertScopeSummary(page.scopeSummary);
  page.items.forEach((row) => {
    assertModelBomRow(row);
    assert(row.lines.length === 0, `BOM list row ${row.bomName} must keep lines empty; full lines belong in detail API.`);
  });
  checks.push({ label, endpoint, totalCount: page.totalCount, itemCount: page.items.length });
  return page;
}

async function main() {
  const defaultPage = await assertBomPage('/inventory/model-boms?status=ALL&limit=5&offset=0', 'model BOM default page');
  assert(defaultPage.totalCount > 0, 'model BOM default page must show model BOM rows.');
  assert(defaultPage.scopeSummary.totalCount === defaultPage.totalCount, 'model BOM default scopeSummary.totalCount must match totalCount.');

  const enabledPage = await assertBomPage('/inventory/model-boms?status=ENABLED&limit=5&offset=0', 'model BOM enabled page');
  assert(enabledPage.totalCount > 0, 'model BOM enabled page must show enabled BOM rows.');
  assert(enabledPage.items.every((row) => row.status === 'ENABLED'), 'model BOM enabled page must only return ENABLED rows.');

  const sampleBom = enabledPage.items[0];
  const keywordPage = await assertBomPage(
    `/inventory/model-boms?keyword=${encodeURIComponent(sampleBom.bomName)}&status=ALL&limit=5&offset=0`,
    'model BOM keyword search'
  );
  assert(keywordPage.items.some((row) => row.id === sampleBom.id), 'model BOM keyword search must include the selected BOM.');

  const scopeModePage = await assertBomPage(
    `/inventory/model-boms?scopeMode=${encodeURIComponent(sampleBom.customerScopeMode)}&status=ALL&limit=5&offset=0`,
    'model BOM scopeMode filter'
  );
  assert(
    scopeModePage.items.every((row) => row.customerScopeMode === sampleBom.customerScopeMode),
    `model BOM scopeMode filter must only return ${sampleBom.customerScopeMode} rows.`
  );

  if (sampleBom.projectModel) {
    const projectPage = await assertBomPage(
      `/inventory/model-boms?projectModel=${encodeURIComponent(sampleBom.projectModel)}&status=ALL&limit=5&offset=0`,
      'model BOM projectModel filter'
    );
    assert(projectPage.items.some((row) => row.id === sampleBom.id), 'model BOM projectModel filter must include the selected BOM.');
    assert(
      projectPage.items.every((row) => row.projectModel === sampleBom.projectModel || row.projectModelScopeKey === 'ALL'),
      'model BOM projectModel filter may include the selected model and all-project BOM rows only.'
    );
  }

  const commonOnlyPage = await assertBomPage('/inventory/model-boms?commonOnly=true&status=ALL&limit=5&offset=0', 'model BOM commonOnly filter');
  assert(commonOnlyPage.totalCount > 0, 'model BOM commonOnly filter must show current common BOM rows.');
  assert(commonOnlyPage.items.every((row) => row.isCommon === true), 'model BOM commonOnly filter must only return common BOM rows.');

  const detail = await readJson(`/inventory/model-boms/${encodeURIComponent(sampleBom.id)}`);
  assertModelBomDetail(detail);
  assertNoFixtureText('model BOM detail', detail);
  checks.push({ label: 'model BOM detail', endpoint: `/inventory/model-boms/${sampleBom.id}`, lineCount: detail.lines.length });

  const revisionsEndpoint = `/inventory/model-boms/${encodeURIComponent(sampleBom.id)}/revisions?limit=5&offset=0`;
  const revisions = await readJson(revisionsEndpoint);
  assertPageShape('model BOM revisions page', revisions);
  checks.push({ label: 'model BOM revisions page', endpoint: revisionsEndpoint, totalCount: revisions.totalCount, itemCount: revisions.items.length });

  const diffReviewsEndpoint = `/inventory/model-boms/${encodeURIComponent(sampleBom.id)}/diff-reviews?limit=5&offset=0`;
  const diffReviews = await readJson(diffReviewsEndpoint);
  assertPageShape('model BOM diff reviews page', diffReviews);
  assert(Array.isArray(diffReviews.reviewKeys), 'model BOM diff reviews page must include reviewKeys[].');
  checks.push({
    label: 'model BOM diff reviews page',
    endpoint: diffReviewsEndpoint,
    totalCount: diffReviews.totalCount,
    itemCount: diffReviews.items.length
  });

  const approvalEndpoint = '/inventory/model-bom-scope-approval-requests?status=ALL&limit=5&offset=0';
  const approvals = await readJson(approvalEndpoint);
  assertPageShape('model BOM scope approval page', approvals);
  checks.push({ label: 'model BOM scope approval page', endpoint: approvalEndpoint, totalCount: approvals.totalCount, itemCount: approvals.items.length });

  console.log(JSON.stringify({ ok: true, apiBaseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
