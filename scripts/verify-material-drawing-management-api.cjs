#!/usr/bin/env node

const apiBaseUrl = (
  process.env.MATERIAL_DRAWING_MANAGEMENT_API_BASE_URL ||
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
  assert(!matchedPrefix, `${label} must hide reusable regression fixture prefix ${matchedPrefix} by default.`);
}

function assertPageShape(label, page, expectedLimit = 50, expectedOffset = 0) {
  assert(page && typeof page === 'object' && !Array.isArray(page), `${label} must return a paginated object.`);
  assert(Array.isArray(page.items), `${label} must return items[].`);
  assert(page.limit === expectedLimit, `${label} must echo limit=${expectedLimit}; got ${page.limit}.`);
  assert(page.offset === expectedOffset, `${label} must echo offset=${expectedOffset}; got ${page.offset}.`);
  assert(Number.isInteger(page.totalCount), `${label} must return integer totalCount.`);
  assert(typeof page.hasMore === 'boolean', `${label} must return boolean hasMore.`);
  assertNoFixtureText(label, page);
}

function assertMaterialRow(row) {
  assert(String(row.id || '').trim(), 'material row must include id.');
  assert(String(row.partCode || '').trim(), 'material row must include partCode.');
  assert(String(row.partName || '').trim(), `material ${row.partCode || '-'} must include partName.`);
  assert(String(row.status || '').trim(), `material ${row.partCode || '-'} must include status.`);
}

function assertDrawingRevision(row, material) {
  assert(String(row.id || '').trim(), `material ${material.partCode} drawing revision must include id.`);
  assert(row.materialId === material.id, `material ${material.partCode} drawing revision must belong to selected material.`);
  assert(String(row.drawingNo || '').trim(), `material ${material.partCode} drawing revision must include drawingNo.`);
  assert(String(row.drawingVersion || '').trim(), `material ${material.partCode} drawing revision must include drawingVersion.`);
  assert(typeof row.isDefault === 'boolean', `material ${material.partCode} drawing revision must include boolean isDefault.`);
  assert(['ENABLED', 'DISABLED'].includes(row.status), `material ${material.partCode} drawing revision status must be known, actual=${row.status}.`);
  if (row.isDefault) {
    assert(row.status === 'ENABLED', `material ${material.partCode} default drawing revision must be ENABLED.`);
    assert(String(row.defaultChangedBy || '').trim(), `material ${material.partCode} default drawing revision must keep defaultChangedBy.`);
    assert(String(row.defaultChangedAt || '').trim(), `material ${material.partCode} default drawing revision must keep defaultChangedAt.`);
  }
}

async function findMaterialWithDefaultDrawing() {
  const page = await readJson('/inventory/materials?status=ENABLED&limit=50&offset=0');
  assertPageShape('inventory materials enabled page for drawing regression', page);
  assert(page.totalCount > 0, 'inventory materials enabled page must show business materials.');
  for (const material of page.items) {
    assertMaterialRow(material);
    const endpoint = `/inventory/materials/${encodeURIComponent(material.id)}/drawing-revisions`;
    const drawingPayload = await readJson(endpoint);
    assert(drawingPayload && typeof drawingPayload === 'object' && !Array.isArray(drawingPayload), 'material drawing revisions must return an object.');
    assert(Array.isArray(drawingPayload.items), 'material drawing revisions response must include items[].');
    assertNoFixtureText(`material ${material.partCode} drawing revisions`, drawingPayload);
    if (drawingPayload.items.some((row) => row.status === 'ENABLED' && row.isDefault === true)) {
      return { material, drawingPayload, endpoint };
    }
  }
  throw new Error('material drawing management regression needs at least one enabled material with an enabled default drawing revision.');
}

async function assertExportResponse(material) {
  const endpoint = `/inventory/materials/${encodeURIComponent(material.id)}/drawing-revisions/export`;
  const response = await fetch(`${apiBaseUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `material drawing revisions export content-type must be real .xlsx, actual=${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('material-drawing-revisions-export.xlsx'), 'material drawing revisions export must use fixed .xlsx filename.');
  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', 'material drawing revisions export must return a .xlsx zip payload.');
  checks.push({ label: 'material drawing revisions export response', endpoint, byteLength: buffer.length });
}

async function main() {
  const { material, drawingPayload, endpoint } = await findMaterialWithDefaultDrawing();
  const enabledRows = drawingPayload.items.filter((row) => row.status === 'ENABLED');
  const defaultRows = enabledRows.filter((row) => row.isDefault);
  assert(enabledRows.length > 0, `material ${material.partCode} must have enabled drawing revisions.`);
  assert(defaultRows.length === 1, `material ${material.partCode} must have exactly one enabled default drawing revision.`);
  drawingPayload.items.forEach((row) => assertDrawingRevision(row, material));
  checks.push({
    label: 'material drawing revisions list',
    endpoint,
    partCode: material.partCode,
    revisionCount: drawingPayload.items.length,
    defaultDrawingNo: defaultRows[0].drawingNo,
    defaultDrawingVersion: defaultRows[0].drawingVersion
  });

  await assertExportResponse(material);

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'material drawing revisions list must return existing business drawing versions',
          'material drawing revisions must keep exactly one enabled default drawing',
          'material drawing revisions default metadata must keep changedBy and changedAt',
          'material drawing revisions export response must stay real xlsx'
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
