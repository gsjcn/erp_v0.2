#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const rootDir = resolve(__dirname, '..');
const npmCommand = 'npm';
const apiPort = String(process.env.FIRST_STAGE_API_PORT || '3100');
const apiBaseUrl = (
  process.env.FIRST_STAGE_API_BASE_URL ||
  process.env.ORDER_IMPORT_API_BASE_URL ||
  `http://127.0.0.1:${apiPort}/api`
).replace(/\/$/, '');
const verifyScripts = [
  'verify:material-import-api',
  'verify:order-import-api',
  'verify:production-notices-api',
  'verify:upload-filenames-api'
];

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

function runCommand(args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const command = npmSpawnCommand(args);
    const child = spawn(command.file, command.args, {
      cwd: rootDir,
      env: options.env || process.env,
      stdio: 'inherit',
      windowsHide: true
    });
    child.on('error', rejectRun);
    child.on('exit', (code) => {
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

async function waitForHealth(backendOutput) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    if (await isHealthy()) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`API health check failed at ${apiBaseUrl}/health\n${backendOutput()}`);
}

function startBackend() {
  const outputLines = [];
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
  return {
    child,
    output: () => outputLines.join('\n')
  };
}

function stopBackend(child) {
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
  const existingHealthy = await isHealthy();
  if (!existingHealthy) {
    console.log(`No healthy API found at ${apiBaseUrl}; building backend and starting a temporary server on port ${apiPort}.`);
    await runCommand(['run', 'backend:build']);
    backend = startBackend();
    await waitForHealth(backend.output);
  } else {
    console.log(`Using existing API at ${apiBaseUrl}.`);
  }

  const verifyEnv = {
    ...process.env,
    ORDER_IMPORT_API_BASE_URL: apiBaseUrl,
    MATERIAL_IMPORT_API_BASE_URL: apiBaseUrl,
    NOTICE_API_BASE_URL: apiBaseUrl
  };

  try {
    for (const scriptName of verifyScripts) {
      await runCommand(['run', scriptName], { env: verifyEnv });
    }
  } finally {
    if (backend) {
      stopBackend(backend.child);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
