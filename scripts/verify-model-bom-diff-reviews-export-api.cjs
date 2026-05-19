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
  process.env.MODEL_BOM_DIFF_REVIEWS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function findSourceBasedBom() {
  let offset = 0;
  while (offset < 1000) {
    const page = await requestJson(`/inventory/model-boms?status=ALL&withPage=true&limit=100&offset=${offset}`);
    assert(Array.isArray(page.items), 'model BOM list must return paged items');
    const candidate = page.items.find((bom) => bom.status === 'ENABLED' && bom.sourceBomId);
    if (candidate) {
      return candidate;
    }
    if (!page.hasMore) {
      break;
    }
    offset += page.limit;
  }
  throw new Error('Need at least one enabled customer BOM copied from a source BOM to verify diff review export read-only.');
}

function assertDiffReviewPage(payload, expectedLimit, expectedOffset) {
  assert(!Array.isArray(payload), 'model BOM diff review public list must return an explicit paged object');
  assert(Array.isArray(payload.items), 'model BOM diff review paginated list must return items');
  assert(Number.isInteger(payload.totalCount), 'model BOM diff review paginated list must return totalCount');
  assert(payload.limit === expectedLimit, 'model BOM diff review paginated list must echo limit');
  assert(payload.offset === expectedOffset, 'model BOM diff review paginated list must echo offset');
  assert(typeof payload.hasMore === 'boolean', 'model BOM diff review paginated list must include hasMore');
  assert(Array.isArray(payload.reviewKeys), 'model BOM diff review paginated list must return all reviewKeys');
  for (const review of payload.items) {
    assert(!Object.prototype.hasOwnProperty.call(review, 'createdAt'), 'model BOM diff review list must not expose createdAt');
    assert(!Object.prototype.hasOwnProperty.call(review, 'updatedAt'), 'model BOM diff review list must not expose updatedAt');
    assert(review.status === 'ENABLED', 'model BOM diff review list must only show enabled review rows');
  }
}

async function requestWorkbook(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `BOM diff review export content-type must be real .xlsx, actual: ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(
    contentDisposition.includes('model-bom-diff-reviews-export.xlsx'),
    'BOM diff review export must use the stable .xlsx filename'
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', 'BOM diff review export must be a .xlsx zip file');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('差异核对记录');
  assert(sheet, 'BOM diff review export must include 差异核对记录 worksheet');
  return { buffer, sheet };
}

function assertWorkbookContent(sheet, targetBom, reviewCount) {
  assert(sheet.getCell('A1').text === 'BOM 差异核对记录导出', 'BOM diff review export title is incorrect');
  const scopeText = sheet.getCell('A2').text;
  assert(scopeText.includes(`客户BOM：${targetBom.bomName}`), 'BOM diff review export scope must include target BOM name');
  assert(
    scopeText.includes(`来源BOM：${targetBom.sourceBomNameSnapshot || targetBom.sourceBomId}`),
    'BOM diff review export scope must include source BOM name'
  );

  const headers = sheet
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map(String);
  for (const header of ['序号', '客户BOM', '来源BOM', '客户', '机型/项目', '差异类型', '差异项', '差异说明', '核对人', '核对备注', '核对时间', '状态']) {
    assert(headers.includes(header), `BOM diff review export must include header: ${header}`);
  }
  if (reviewCount === 0) {
    assert(
      sheet.getCell('A5').text.includes('当前 BOM 没有已确认的来源差异核对记录'),
      'BOM diff review export must show a clear empty-state row when no review exists'
    );
  } else {
    assert(sheet.getCell('B5').text === targetBom.bomName, 'BOM diff review export must include target BOM rows');
  }
}

async function main() {
  const targetBom = await findSourceBasedBom();
  const query = `sourceBomId=${encodeURIComponent(targetBom.sourceBomId)}`;
  const reviewList = await requestJson(
    `/inventory/model-boms/${encodeURIComponent(targetBom.id)}/diff-reviews?${query}&withPage=true&limit=10&offset=0`
  );
  assertDiffReviewPage(reviewList, 10, 0);

  const defaultList = await requestJson(
    `/inventory/model-boms/${encodeURIComponent(targetBom.id)}/diff-reviews?${query}&limit=10&offset=0`
  );
  assertDiffReviewPage(defaultList, 10, 0);

  const { buffer, sheet } = await requestWorkbook(
    `/inventory/model-boms/${encodeURIComponent(targetBom.id)}/diff-reviews/export?${query}`
  );
  assertWorkbookContent(sheet, targetBom, reviewList.totalCount);

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          'model-bom-diff-reviews-read-only',
          'model-bom-diff-reviews-public-list-pagination',
          'model-bom-diff-reviews-public-list-default-pagination',
          'model-bom-diff-reviews-list-review-keys',
          'model-bom-diff-reviews-list-no-maintenance-timestamps',
          'model-bom-diff-reviews-export-xlsx',
          'model-bom-diff-reviews-export-scope',
          'model-bom-diff-reviews-export-columns'
        ],
        targetBomId: targetBom.id,
        sourceBomId: targetBom.sourceBomId,
        reviewCount: reviewList.totalCount,
        byteLength: buffer.length,
        rowCount: sheet.rowCount
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
