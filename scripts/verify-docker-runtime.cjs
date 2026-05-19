#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const frontendBaseUrl = (process.env.DOCKER_RUNTIME_FRONTEND_BASE_URL || 'http://127.0.0.1:5176').replace(/\/$/, '');
const apiBaseUrl = (
  process.env.DOCKER_RUNTIME_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const expectedProjectRoot = normalizePath(rootDir);
const expectedContainers = new Map([
  ['postgres', { name: 'baisheng-erp-postgres', imagePrefix: 'postgres:16', requiredHostPort: 55432, requiredHostIp: '127.0.0.1' }],
  ['backend', { name: 'baisheng-erp-backend', requiredHostPort: 3000 }],
  ['frontend', { name: 'baisheng-erp-frontend', requiredHostPort: 5176 }]
]);

const failures = [];
const checks = [];

function addFailure(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) {
    addFailure(message);
  }
}

function normalizePath(value) {
  return path.resolve(String(value || '')).replace(/\\/g, '/').toLowerCase();
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return String(result.stdout || '');
}

function parseComposePsJson(source) {
  return parseJsonLines(source);
}

function parseJsonLines(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function inspectContainers(containerNames) {
  if (containerNames.length === 0) {
    return [];
  }
  const source = run('docker', ['inspect', ...containerNames]);
  return JSON.parse(source);
}

function runningContainerNames() {
  return parseJsonLines(run('docker', ['ps', '--format', 'json'])).flatMap((row) =>
    String(row.Names || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
  );
}

function findPortBinding(inspect, targetPort) {
  const key = `${targetPort}/tcp`;
  return inspect.NetworkSettings?.Ports?.[key] || [];
}

function publishedPortsFromInspect(inspect, targetPort) {
  return findPortBinding(inspect, targetPort).map((binding) => ({
    hostIp: binding.HostIp,
    hostPort: Number(binding.HostPort)
  }));
}

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return text;
}

async function verifyHttpRuntime() {
  const health = JSON.parse(await fetchText(`${apiBaseUrl}/health`));
  assert(health.status === 'ok', `backend health status should be ok, got ${health.status || '-'}.`);
  assert(health.database === 'ok', `backend health database should be ok, got ${health.database || '-'}.`);
  checks.push({ label: 'backend health', url: `${apiBaseUrl}/health`, status: health.status, database: health.database });

  const frontendHtml = await fetchText(`${frontendBaseUrl}/`);
  assert(frontendHtml.includes('id="app"'), 'frontend root should return the Vue app shell.');
  checks.push({ label: 'frontend root', url: `${frontendBaseUrl}/` });
}

function verifySingleProjectRuntime(allInspectRows) {
  const expectedNames = new Set([...expectedContainers.values()].map((item) => item.name));
  const sameProjectContainers = allInspectRows.filter(
    (row) => normalizePath(row.Config?.Labels?.['com.docker.compose.project.working_dir']) === expectedProjectRoot
  );
  const sameProjectNames = sameProjectContainers.map((row) => String(row.Name || '').replace(/^\//, '')).sort();
  const unexpectedSameProjectNames = sameProjectNames.filter((name) => !expectedNames.has(name));
  assert(
    unexpectedSameProjectNames.length === 0,
    `Only the current ERP compose services should share this project working_dir; unexpected containers: ${
      unexpectedSameProjectNames.join(', ') || '-'
    }.`
  );

  for (const [serviceName, expected] of expectedContainers) {
    const serviceMatches = sameProjectContainers.filter(
      (row) => row.Config?.Labels?.['com.docker.compose.service'] === serviceName
    );
    assert(
      serviceMatches.length === 1,
      `Current project should have exactly one ${serviceName} container, got ${serviceMatches.length}.`
    );
    if (serviceMatches.length === 1) {
      const actualName = String(serviceMatches[0].Name || '').replace(/^\//, '');
      assert(actualName === expected.name, `${serviceName} container should be ${expected.name}, got ${actualName || '-'}.`);
    }
  }

  const projectPostgresContainers = sameProjectContainers.filter(
    (row) =>
      row.Config?.Labels?.['com.docker.compose.service'] === 'postgres' ||
      String(row.Config?.Image || '').startsWith('postgres:')
  );
  assert(
    projectPostgresContainers.length === 1 &&
      String(projectPostgresContainers[0]?.Name || '').replace(/^\//, '') === 'baisheng-erp-postgres',
    'Current project should use exactly one PostgreSQL container: baisheng-erp-postgres.'
  );

  checks.push({
    label: 'project runtime uniqueness',
    sameProjectContainers: sameProjectNames,
    postgresContainers: projectPostgresContainers.map((row) => String(row.Name || '').replace(/^\//, '')).sort()
  });
}

async function main() {
  const psRows = parseComposePsJson(run('docker', ['compose', 'ps', '--format', 'json']));
  const rowsByService = new Map(psRows.map((row) => [row.Service, row]));
  const allInspectRows = inspectContainers(runningContainerNames());
  verifySingleProjectRuntime(allInspectRows);
  const inspectRows = inspectContainers([...expectedContainers.values()].map((item) => item.name));
  const inspectByName = new Map(inspectRows.map((row) => [String(row.Name || '').replace(/^\//, ''), row]));

  for (const [serviceName, expected] of expectedContainers) {
    const psRow = rowsByService.get(serviceName);
    assert(Boolean(psRow), `docker compose ps should include service ${serviceName}.`);
    if (psRow) {
      assert(psRow.Name === expected.name, `${serviceName} container should be ${expected.name}, got ${psRow.Name || '-'}.`);
      assert(psRow.State === 'running', `${expected.name} should be running, got ${psRow.State || '-'}.`);
      assert(psRow.Health === 'healthy', `${expected.name} should be healthy, got ${psRow.Health || '-'}.`);
    }

    const inspect = inspectByName.get(expected.name);
    assert(Boolean(inspect), `docker inspect should find ${expected.name}.`);
    if (!inspect) {
      continue;
    }

    assert(inspect.State?.Status === 'running', `${expected.name} inspect status should be running.`);
    assert(inspect.State?.Health?.Status === 'healthy', `${expected.name} inspect health should be healthy.`);
    assert(
      normalizePath(inspect.Config?.Labels?.['com.docker.compose.project.working_dir']) === expectedProjectRoot,
      `${expected.name} should belong to this project working directory.`
    );
    assert(
      inspect.Config?.Labels?.['com.docker.compose.service'] === serviceName,
      `${expected.name} should have compose service label ${serviceName}.`
    );

    if (expected.imagePrefix) {
      assert(
        String(inspect.Config?.Image || '').startsWith(expected.imagePrefix),
        `${expected.name} should use image ${expected.imagePrefix}*, got ${inspect.Config?.Image || '-'}.`
      );
    }

    const targetPort = serviceName === 'frontend' ? 80 : serviceName === 'postgres' ? 5432 : 3000;
    const ports = publishedPortsFromInspect(inspect, targetPort);
    assert(
      ports.some((port) => port.hostPort === expected.requiredHostPort),
      `${expected.name} should publish ${targetPort}/tcp on host port ${expected.requiredHostPort}.`
    );
    if (expected.requiredHostIp) {
      assert(
        ports.some((port) => port.hostPort === expected.requiredHostPort && port.hostIp === expected.requiredHostIp),
        `${expected.name} should publish ${targetPort}/tcp only on ${expected.requiredHostIp}:${expected.requiredHostPort}.`
      );
      assert(
        !ports.some((port) => port.hostPort === expected.requiredHostPort && port.hostIp !== expected.requiredHostIp),
        `${expected.name} must not expose PostgreSQL on a non-localhost host IP.`
      );
    }

    checks.push({
      label: 'container runtime',
      service: serviceName,
      name: expected.name,
      status: inspect.State?.Status,
      health: inspect.State?.Health?.Status,
      ports
    });
  }

  await verifyHttpRuntime();

  if (failures.length > 0) {
    console.error(JSON.stringify({ ok: false, projectRoot: rootDir, frontendBaseUrl, apiBaseUrl, checks, failures }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, projectRoot: rootDir, frontendBaseUrl, apiBaseUrl, checks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
