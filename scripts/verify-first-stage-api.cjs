#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { createServer } = require('node:net');
const { relative, resolve } = require('node:path');

const rootDir = resolve(__dirname, '..');
const npmCommand = 'npm';
const skipBackendBuild = process.argv.includes('--skip-build') || process.env.FIRST_STAGE_API_SKIP_BUILD === '1';
const defaultCommandTimeoutMs = Math.max(Number(process.env.FIRST_STAGE_API_SCRIPT_TIMEOUT_MS || 180000), 30000);
const backendBuildEntry = resolve(rootDir, 'backend/dist/main.js');
const backendBuildStamp = resolve(rootDir, 'backend/dist/tsconfig.tsbuildinfo');
const backendBuildInputPaths = [
  resolve(rootDir, 'backend/src'),
  resolve(rootDir, 'backend/nest-cli.json'),
  resolve(rootDir, 'backend/tsconfig.json')
];
const verifyScripts = [
  'verify:customer-management-api',
  'verify:customer-contact-management-api',
  'verify:customers-export-api',
  'verify:order-management-api',
  'verify:orders-export-api',
  'verify:material-import-api',
  'verify:inventory-adjustment-api',
  'verify:inventory-summary-api',
  'verify:inventory-management-api',
  'verify:inventory-export-api',
  'verify:inventory-materials-export-api',
  'verify:material-suggestions-api',
  'verify:material-management-api',
  'verify:material-drawing-management-api',
  'verify:material-drawing-revisions-export-api',
  'verify:material-applicabilities-export-api',
  'verify:material-dashboard-export-api',
  'verify:model-bom-management-api',
  'verify:model-boms-export-api',
  'verify:model-bom-scope-approval-api',
  'verify:model-bom-diff-reviews-export-api',
  'verify:material-transform-management-api',
  'verify:material-transform-rules-export-api',
  'verify:statistics-api',
  'verify:statistics-management-api',
  'verify:business-data-baseline-api',
  'verify:business-fixture-visibility-api',
  'verify:order-import-api',
  'verify:notice-center-api',
  'verify:production-notices-api',
  'verify:production-notices-export-api',
  'verify:production-exception-management-api',
  'verify:production-replenishment-requests-export-api',
  'verify:production-scrap-records-export-api',
  'verify:production-management-api',
  'verify:production-export-api',
  'verify:process-management-api',
  'verify:process-exports-api',
  'verify:warehouse-config-api',
  'verify:warehouse-management-api',
  'verify:warehouse-work-management-api',
  'verify:warehouse-work-export-api',
  'verify:warehouse-notices-export-api',
  'verify:warehouse-transactions-export-api',
  'verify:upload-filenames-api'
];

function parseVerifyScriptFilter() {
  const scriptsArg = process.argv.find((arg) => arg.startsWith('--scripts='));
  const rawScripts = String(process.env.FIRST_STAGE_API_SCRIPTS || scriptsArg?.slice('--scripts='.length) || '').trim();
  if (!rawScripts) {
    return verifyScripts;
  }

  const requestedScripts = rawScripts
    .split(/[,\s]+/)
    .map((scriptName) => scriptName.trim())
    .filter(Boolean)
    .map((scriptName) => (scriptName.startsWith('verify:') ? scriptName : `verify:${scriptName}`));
  if (requestedScripts.length === 0) {
    throw new Error('FIRST_STAGE_API_SCRIPTS/--scripts resolved to no API regression scripts.');
  }

  const knownScripts = new Set(verifyScripts);
  const unknownScripts = requestedScripts.filter((scriptName) => !knownScripts.has(scriptName));
  if (unknownScripts.length > 0) {
    throw new Error(`Unknown first-stage API regression script: ${unknownScripts.join(', ')}`);
  }

  const requestedSet = new Set(requestedScripts);
  return verifyScripts.filter((scriptName) => requestedSet.has(scriptName));
}

for (const envPath of [resolve(rootDir, '.env'), resolve(rootDir, 'backend/.env')]) {
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

const selectedVerifyScripts = parseVerifyScriptFilter();
const explicitApiBaseUrl = process.env.FIRST_STAGE_API_BASE_URL || process.env.ORDER_IMPORT_API_BASE_URL || '';
let apiPort = String(process.env.FIRST_STAGE_API_PORT || '3100');
let apiBaseUrl = (explicitApiBaseUrl || `http://127.0.0.1:${apiPort}/api`).replace(/\/$/, '');

function runCommand(args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const command = npmSpawnCommand(args);
    const timeoutMs = Math.max(Number(options.timeoutMs || defaultCommandTimeoutMs), 30000);
    let settled = false;
    const child = spawn(command.file, command.args, {
      cwd: rootDir,
      env: options.env || process.env,
      stdio: 'inherit',
      windowsHide: true
    });
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      stopProcessTree(child);
      rejectRun(new Error(`${npmCommand} ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      rejectRun(error);
    });
    child.on('exit', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${npmCommand} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function npmSpawnCommand(args) {
  if (process.platform !== 'win32') {
    return { file: npmCommand, args };
  }
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', [npmCommand, ...args].join(' ')] };
}

function projectPath(target) {
  return relative(rootDir, target).replace(/\\/g, '/');
}

function latestFileMtime(targetPath) {
  if (!existsSync(targetPath)) {
    return { path: targetPath, mtimeMs: 0 };
  }

  const stat = statSync(targetPath);
  if (stat.isFile()) {
    return { path: targetPath, mtimeMs: stat.mtimeMs };
  }
  if (!stat.isDirectory()) {
    return { path: targetPath, mtimeMs: stat.mtimeMs };
  }

  let latest = { path: targetPath, mtimeMs: stat.mtimeMs };
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') {
      continue;
    }
    const childLatest = latestFileMtime(resolve(targetPath, entry.name));
    if (childLatest.mtimeMs > latest.mtimeMs) {
      latest = childLatest;
    }
  }
  return latest;
}

function assertBackendBuildCurrent() {
  if (!existsSync(backendBuildEntry)) {
    throw new Error(
      `FIRST_STAGE_API_SKIP_BUILD/--skip-build requires an existing backend build at ${backendBuildEntry}. Run npm run backend:build first, or run npm run verify:first-stage:api without --skip-build.`
    );
  }
  if (!existsSync(backendBuildStamp)) {
    throw new Error(
      `FIRST_STAGE_API_SKIP_BUILD/--skip-build requires an existing backend build stamp at ${backendBuildStamp}. Run npm run backend:build first, or run npm run verify:first-stage:api without --skip-build.`
    );
  }

  const buildMtimeMs = statSync(backendBuildStamp).mtimeMs;
  const latestInput = backendBuildInputPaths
    .map((inputPath) => latestFileMtime(inputPath))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (latestInput && latestInput.mtimeMs > buildMtimeMs + 1000) {
    throw new Error(
      `FIRST_STAGE_API_SKIP_BUILD/--skip-build found backend build older than ${projectPath(
        latestInput.path
      )}. Run npm run backend:build first, or run npm run verify:first-stage:api without --skip-build.`
    );
  }
}

function portAvailable(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once('error', () => resolvePort(false));
    server.once('listening', () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(preferredPort) {
  const firstPort = Number.isInteger(Number(preferredPort)) && Number(preferredPort) > 0 ? Number(preferredPort) : 3100;
  for (let port = firstPort; port < firstPort + 20; port += 1) {
    if (await portAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available local API port found from ${firstPort} to ${firstPort + 19}.`);
}

async function isHealthy() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${apiBaseUrl}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(backend) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const exitStatus = backend.exited();
    if (exitStatus) {
      const statusText = exitStatus.error
        ? `error=${exitStatus.error}`
        : `code=${exitStatus.code ?? 'null'}, signal=${exitStatus.signal ?? 'null'}`;
      throw new Error(`Temporary API server exited before health check passed at ${apiBaseUrl}/health (${statusText}).\n${backend.output()}`);
    }
    if (await isHealthy()) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`API health check failed at ${apiBaseUrl}/health\n${backend.output()}`);
}

function startBackend() {
  const outputLines = [];
  let exitStatus = null;
  const appendOutput = (chunk) => {
    const text = String(chunk || '').trimEnd();
    if (!text) {
      return;
    }
    outputLines.push(...text.split(/\r?\n/));
    while (outputLines.length > 120) {
      outputLines.shift();
    }
  };
  const command = npmSpawnCommand(['--workspace', 'backend', 'run', 'start']);
  const child = spawn(command.file, command.args, {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: apiPort
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.on('data', appendOutput);
  child.stderr.on('data', appendOutput);
  child.once('error', (error) => {
    exitStatus = { code: null, signal: null, error: error.message };
    appendOutput(error.stack || error.message);
  });
  child.once('exit', (code, signal) => {
    if (!exitStatus) {
      exitStatus = { code, signal, error: null };
    }
  });
  return {
    child,
    output: () => outputLines.join('\n'),
    exited: () => exitStatus
  };
}

function stopBackend(child) {
  stopProcessTree(child);
}

function stopProcessTree(child) {
  if (!child || child.killed) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function main() {
  let backend = null;
  try {
    if (explicitApiBaseUrl) {
      if (!(await isHealthy())) {
        throw new Error(`Explicit API health check failed at ${apiBaseUrl}/health.`);
      }
      console.log(`Using explicit API at ${apiBaseUrl}.`);
    } else {
      const selectedPort = await findAvailablePort(apiPort);
      apiPort = String(selectedPort);
      apiBaseUrl = `http://127.0.0.1:${apiPort}/api`;
      if (!skipBackendBuild) {
        console.log(`Building backend and starting a temporary API server on port ${apiPort}.`);
        await runCommand(['run', 'backend:build'], { timeoutMs: Math.max(defaultCommandTimeoutMs, 300000) });
      } else {
        assertBackendBuildCurrent();
        console.log(`Starting a temporary API server on port ${apiPort} using the existing backend build.`);
      }
      backend = startBackend();
      await waitForHealth(backend);
    }

    const verifyEnv = {
      ...process.env,
      FIRST_STAGE_API_BASE_URL: apiBaseUrl,
      CUSTOMER_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      CUSTOMER_CONTACT_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      CUSTOMERS_EXPORT_API_BASE_URL: apiBaseUrl,
      ORDER_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      ORDERS_EXPORT_API_BASE_URL: apiBaseUrl,
      ORDER_IMPORT_API_BASE_URL: apiBaseUrl,
      MATERIAL_IMPORT_API_BASE_URL: apiBaseUrl,
      INVENTORY_ADJUSTMENT_API_BASE_URL: apiBaseUrl,
      INVENTORY_SUMMARY_API_BASE_URL: apiBaseUrl,
      INVENTORY_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      INVENTORY_EXPORT_API_BASE_URL: apiBaseUrl,
      INVENTORY_MATERIALS_EXPORT_API_BASE_URL: apiBaseUrl,
      MATERIAL_SUGGESTIONS_API_BASE_URL: apiBaseUrl,
      MATERIAL_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      MATERIAL_DRAWING_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      MATERIAL_DRAWING_REVISIONS_EXPORT_API_BASE_URL: apiBaseUrl,
      MATERIAL_APPLICABILITIES_EXPORT_API_BASE_URL: apiBaseUrl,
      MATERIAL_DASHBOARD_EXPORT_API_BASE_URL: apiBaseUrl,
      MODEL_BOM_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      MODEL_BOMS_EXPORT_API_BASE_URL: apiBaseUrl,
      MODEL_BOM_SCOPE_APPROVAL_API_BASE_URL: apiBaseUrl,
      MODEL_BOM_DIFF_REVIEWS_EXPORT_API_BASE_URL: apiBaseUrl,
      MATERIAL_TRANSFORM_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      MATERIAL_TRANSFORM_RULES_EXPORT_API_BASE_URL: apiBaseUrl,
      STATISTICS_API_BASE_URL: apiBaseUrl,
      STATISTICS_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      BUSINESS_DATA_BASELINE_API_BASE_URL: apiBaseUrl,
      NOTICE_CENTER_API_BASE_URL: apiBaseUrl,
      NOTICE_API_BASE_URL: apiBaseUrl,
      PRODUCTION_NOTICES_EXPORT_API_BASE_URL: apiBaseUrl,
      PRODUCTION_EXCEPTION_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      PRODUCTION_REPLENISHMENT_REQUESTS_EXPORT_API_BASE_URL: apiBaseUrl,
      PRODUCTION_SCRAP_RECORDS_EXPORT_API_BASE_URL: apiBaseUrl,
      PRODUCTION_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      PRODUCTION_EXPORT_API_BASE_URL: apiBaseUrl,
      PROCESS_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      PROCESS_EXPORT_API_BASE_URL: apiBaseUrl,
      WAREHOUSE_CONFIG_API_BASE_URL: apiBaseUrl,
      WAREHOUSE_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      WAREHOUSE_WORK_MANAGEMENT_API_BASE_URL: apiBaseUrl,
      WAREHOUSE_WORK_EXPORT_API_BASE_URL: apiBaseUrl,
      WAREHOUSE_NOTICES_EXPORT_API_BASE_URL: apiBaseUrl,
      WAREHOUSE_TRANSACTION_EXPORT_API_BASE_URL: apiBaseUrl,
      BUSINESS_FIXTURE_VISIBILITY_API_BASE_URL: apiBaseUrl
    };

    console.log(`Running ${selectedVerifyScripts.length}/${verifyScripts.length} first-stage API regression scripts.`);
    for (const scriptName of selectedVerifyScripts) {
      await runCommand(['run', scriptName], { env: verifyEnv });
    }
  } finally {
    if (backend) {
      stopBackend(backend.child);
    }
  }
}

main()
  .then(() => {
    console.log('First-stage API regression verification passed.');
    // 子回归脚本和临时 API 可能留下 keep-alive 句柄；清理完成后显式退出，避免聚合验证挂起。
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
