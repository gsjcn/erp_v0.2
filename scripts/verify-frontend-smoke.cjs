#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const frontendDistDir = path.join(rootDir, 'frontend', 'dist');
const frontendAssetsDir = path.join(frontendDistDir, 'assets');
const frontendBaseUrl = (process.env.FRONTEND_SMOKE_BASE_URL || 'http://127.0.0.1:5176').replace(/\/$/, '');
const apiBaseUrl = (
  process.env.FRONTEND_SMOKE_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const timeoutMs = Math.max(Number(process.env.FRONTEND_SMOKE_TIMEOUT_MS || 5000), 1000);
const requireLive = process.env.FRONTEND_SMOKE_REQUIRE_LIVE === '1';
const frontendBuildInputPaths = [
  path.join(rootDir, 'frontend', 'src'),
  path.join(rootDir, 'frontend', 'index.html'),
  path.join(rootDir, 'frontend', 'package.json'),
  path.join(rootDir, 'frontend', 'tsconfig.json'),
  path.join(rootDir, 'frontend', 'vite.config.ts')
];
const fixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

const failures = [];
const checks = [];
const skipped = [];
const distChunkFilesCache = new Map();
const distChunkCache = new Map();

function addFailure(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) {
    addFailure(message);
  }
}

function check(label, detail = {}) {
  checks.push({ label, ...detail });
}

function skip(label, reason) {
  skipped.push({ label, reason });
}

function readFile(projectPath) {
  const filePath = path.join(rootDir, projectPath);
  if (!fs.existsSync(filePath)) {
    addFailure(`Missing required file: ${projectPath}`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function latestMtime(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return { path: targetPath, mtimeMs: 0 };
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return { path: targetPath, mtimeMs: stat.mtimeMs };
  }
  if (!stat.isDirectory()) {
    return { path: targetPath, mtimeMs: stat.mtimeMs };
  }

  let latest = { path: targetPath, mtimeMs: stat.mtimeMs };
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') {
      continue;
    }
    const childLatest = latestMtime(path.join(targetPath, entry.name));
    if (childLatest.mtimeMs > latest.mtimeMs) {
      latest = childLatest;
    }
  }
  return latest;
}

function projectPath(targetPath) {
  return path.relative(rootDir, targetPath).replace(/\\/g, '/');
}

function verifyFrontendBuildCurrent() {
  const indexPath = path.join(frontendDistDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    addFailure('Missing frontend/dist/index.html. Run npm run frontend:build first.');
    return;
  }

  const buildMtimeMs = fs.statSync(indexPath).mtimeMs;
  const latestInput = frontendBuildInputPaths.map(latestMtime).sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (latestInput && latestInput.mtimeMs > buildMtimeMs + 1000) {
    addFailure(`frontend/dist is older than ${projectPath(latestInput.path)}. Run npm run frontend:build before smoke verification.`);
  }
  check('dist freshness', { latestInput: latestInput ? projectPath(latestInput.path) : null });
}

function distAssetFiles(prefix) {
  if (distChunkFilesCache.has(prefix)) {
    return distChunkFilesCache.get(prefix);
  }

  if (!fs.existsSync(frontendAssetsDir)) {
    addFailure('Missing frontend build assets directory: frontend/dist/assets. Run npm run frontend:build first.');
    return [];
  }

  const fileNames = fs
    .readdirSync(frontendAssetsDir)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith('.js'))
    .sort();
  if (fileNames.length === 0) {
    addFailure(`Missing frontend build chunk for ${prefix} in frontend/dist/assets.`);
    return '';
  }

  check('dist chunk', { prefix, files: fileNames });
  distChunkFilesCache.set(prefix, fileNames);
  return fileNames;
}

function distAssetSource(prefix) {
  if (distChunkCache.has(prefix)) {
    return distChunkCache.get(prefix);
  }
  const source = distAssetFiles(prefix)
    .map((fileName) => fs.readFileSync(path.join(frontendAssetsDir, fileName), 'utf8'))
    .join('\n');
  distChunkCache.set(prefix, source);
  return source;
}

function assertDistChunkIncludes(prefix, snippets) {
  const source = distAssetSource(prefix);
  for (const snippet of snippets) {
    assert(source.includes(snippet), `${prefix} build chunk should include: ${snippet}`);
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function canReach(url) {
  try {
    const response = await fetchWithTimeout(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function assertTextEndpoint(label, url, snippets = []) {
  const response = await fetchWithTimeout(url);
  const text = await response.text();
  assert(response.ok, `${label} should return HTTP 2xx, got ${response.status}.`);
  for (const snippet of snippets) {
    assert(text.includes(snippet), `${label} response should include: ${snippet}`);
  }
  check(label, { url, status: response.status });
  return text;
}

async function assertJsonEndpoint(label, url, validate) {
  const response = await fetchWithTimeout(url);
  const text = await response.text();
  assert(response.ok, `${label} should return HTTP 2xx, got ${response.status}: ${text.slice(0, 240)}`);
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (error) {
    addFailure(`${label} should return JSON: ${error.message}`);
    return;
  }
  assertNoFixtureText(label, data);
  validate(data);
  check(label, { url, status: response.status });
}

function assertNoFixtureText(label, value) {
  const text = JSON.stringify(value || {});
  const matchedPrefix = fixturePrefixes.find((prefix) => text.includes(prefix));
  assert(!matchedPrefix, `${label} should hide reusable test fixture prefix ${matchedPrefix} by default.`);
}

function pageTotalCount(data) {
  if (typeof data?.totalCount === 'number') {
    return data.totalCount;
  }
  if (typeof data?.total === 'number') {
    return data.total;
  }
  if (Array.isArray(data)) {
    return data.length;
  }
  return 0;
}

function pageItems(data) {
  if (Array.isArray(data?.items)) {
    return data.items;
  }
  if (Array.isArray(data)) {
    return data;
  }
  return [];
}

async function assertBusinessPage(label, endpoint, minimumTotal = 1) {
  await assertJsonEndpoint(label, `${apiBaseUrl}${endpoint}`, (data) => {
    const totalCount = pageTotalCount(data);
    assert(totalCount >= minimumTotal, `${label} should return at least ${minimumTotal} business rows; got ${totalCount}.`);
    const items = pageItems(data);
    if (!Array.isArray(data)) {
      assert(Array.isArray(data.items), `${label} should return paginated items[].`);
      assert(typeof data.totalCount === 'number', `${label} should return numeric totalCount.`);
    }
    if (minimumTotal > 0) {
      assert(items.length > 0, `${label} should return visible business items.`);
    }
  });
}

function verifyBuiltFrontend() {
  verifyFrontendBuildCurrent();

  const indexHtml = readFile('frontend/dist/index.html');
  assert(indexHtml.includes('id="app"'), 'frontend/dist/index.html should include id="app".');
  assert(indexHtml.includes('/assets/index-'), 'frontend/dist/index.html should reference the built app entry chunk.');
  check('dist index', { file: 'frontend/dist/index.html' });

  assertDistChunkIncludes('StatisticsView-', ['选择年份', '全部季度', '全部月份', '年度统计', '季度统计', '月度统计']);
  assertDistChunkIncludes('ProductionView-', ['生产管理', '订单汇总', '零件任务明细']);
  assertDistChunkIncludes('WarehouseView-', ['仓库 / 库位', '库存流水']);
  assertDistChunkIncludes('MaterialsManagementView-', ['适用客户摘要', 'BOM 使用摘要', '订单历史不等于正式适用范围']);
}

async function verifyLiveFrontend() {
  const reachable = await canReach(`${frontendBaseUrl}/`);
  if (!reachable) {
    const reason = `frontend is not reachable at ${frontendBaseUrl}`;
    if (requireLive) {
      addFailure(reason);
    } else {
      skip('live frontend', reason);
    }
    return;
  }

  const liveIndexHtml = await assertTextEndpoint('frontend root', `${frontendBaseUrl}/`, ['id="app"']);
  const localIndexHtml = readFile('frontend/dist/index.html');
  const localEntryAssets = [...localIndexHtml.matchAll(/(?:src|href)="(\/assets\/index-[^"]+\.(?:js|css))"/g)].map(
    (match) => match[1]
  );
  for (const assetPath of localEntryAssets) {
    assert(
      liveIndexHtml.includes(assetPath),
      `live frontend index should reference current built asset ${assetPath}; deploy frontend/dist to the running container.`
    );
  }

  for (const route of ['/statistics', '/production', '/warehouses', '/materials']) {
    await assertTextEndpoint(`frontend route ${route}`, `${frontendBaseUrl}${route}`, ['id="app"']);
  }

  await verifyLiveDistChunk('StatisticsView-', ['选择年份', '全部季度', '全部月份']);
  await verifyLiveDistChunk('ProductionView-', ['生产管理', '订单汇总', '零件任务明细']);
  await verifyLiveDistChunk('WarehouseView-', ['仓库 / 库位', '库存流水']);
  await verifyLiveDistChunk('MaterialsManagementView-', ['适用客户摘要', 'BOM 使用摘要']);
}

async function verifyLiveDistChunk(prefix, snippets) {
  for (const fileName of distAssetFiles(prefix)) {
    const assetUrl = `${frontendBaseUrl}/assets/${fileName}`;
    const response = await fetchWithTimeout(assetUrl);
    const text = await response.text();
    assert(response.ok, `live frontend asset ${fileName} should return HTTP 2xx, got ${response.status}.`);
    for (const snippet of snippets) {
      assert(text.includes(snippet), `live frontend asset ${fileName} should include: ${snippet}`);
    }
    check('live dist chunk', { prefix, file: fileName, status: response.status });
  }
}

async function verifyLiveApi() {
  const reachable = await canReach(`${apiBaseUrl}/health`);
  if (!reachable) {
    const reason = `API is not reachable at ${apiBaseUrl}`;
    if (requireLive) {
      addFailure(reason);
    } else {
      skip('live API', reason);
    }
    return;
  }

  await assertJsonEndpoint('API health', `${apiBaseUrl}/health`, (data) => {
    assert(data && data.status === 'ok', 'API health status should be ok.');
    assert(data && data.database === 'ok', 'API health database should be ok.');
  });
  await assertJsonEndpoint('statistics options', `${apiBaseUrl}/statistics/options`, (data) => {
    assert(Array.isArray(data.years), 'statistics/options should return a years array.');
    assert(data.years.length > 0, 'statistics/options should expose at least one selectable business year.');
  });
  await assertBusinessPage('customers business page', '/customers?limit=1&offset=0');
  await assertBusinessPage('orders business page', '/orders?limit=1&offset=0');
  await assertBusinessPage('materials dashboard business page', '/materials/dashboard?limit=1&offset=0');
  await assertBusinessPage('inventory summary business page', '/inventory/summary?withPage=true&limit=1&offset=0');
  await assertBusinessPage('production tasks business page', '/production/tasks?limit=1&offset=0');
  await assertBusinessPage('production order summaries business page', '/production/tasks/order-summary?limit=1&offset=0');
  await assertBusinessPage('warehouse transactions business page', '/warehouse/transactions?limit=1&offset=0');
  await assertBusinessPage('warehouse config business page', '/warehouses?status=ALL&locationStatus=ALL');
}

async function main() {
  verifyBuiltFrontend();
  await verifyLiveFrontend();
  await verifyLiveApi();

  const result = {
    ok: failures.length === 0,
    frontendBaseUrl,
    apiBaseUrl,
    requireLive,
    checks,
    skipped,
    failures
  };

  if (failures.length > 0) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
