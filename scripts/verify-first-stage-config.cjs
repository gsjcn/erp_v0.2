#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const failures = [];

function addFailure(message) {
  failures.push(message);
}

function readRequiredFile(projectPath) {
  const fullPath = path.join(rootDir, projectPath);
  if (!fs.existsSync(fullPath)) {
    addFailure(`Missing required config file: ${projectPath}`);
    return '';
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    addFailure(`${label} should include: ${expected}`);
  }
}

function readMigrationSources() {
  const migrationsDir = path.join(rootDir, 'database/prisma/migrations');
  if (!fs.existsSync(migrationsDir)) {
    addFailure('Missing Prisma migrations directory: database/prisma/migrations');
    return '';
  }

  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const migrationPath = path.join(migrationsDir, entry.name, 'migration.sql');
      return fs.existsSync(migrationPath) ? [fs.readFileSync(migrationPath, 'utf8')] : [];
    })
    .join('\n');
}

function serviceBlock(composeSource, serviceName) {
  const pattern = new RegExp(`\\n  ${serviceName}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|\\nnetworks:|$)`);
  const match = composeSource.match(pattern);
  if (!match) {
    addFailure(`docker-compose.yml should define service: ${serviceName}`);
    return '';
  }
  return match[1];
}

function verifyEnvExample() {
  const envExample = readRequiredFile('.env.example');
  const requiredEnvKeys = [
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'DATABASE_URL',
    'BACKEND_PORT',
    'FRONTEND_PORT',
    'CORS_ORIGIN',
    'POSTGRES_DATA_DIR',
    'POSTGRES_BACKUP_DIR',
    'UPLOAD_DIR',
    'EXPORT_DIR'
  ];

  for (const key of requiredEnvKeys) {
    if (!new RegExp(`^${key}=`, 'm').test(envExample)) {
      addFailure(`.env.example should define ${key}.`);
    }
  }
}

function verifyDockerIgnore() {
  const dockerIgnore = readRequiredFile('.dockerignore');
  const requiredPatterns = [
    'node_modules',
    'frontend/node_modules',
    'backend/node_modules',
    'frontend/dist',
    'backend/dist',
    '.env',
    '*.log',
    'database/postgres-data',
    'database/backups',
    'storage/uploads',
    'storage/exports'
  ];

  for (const pattern of requiredPatterns) {
    assertIncludes(dockerIgnore, pattern, '.dockerignore');
  }
}

function verifyDockerCompose() {
  const compose = readRequiredFile('docker-compose.yml');
  const postgres = serviceBlock(compose, 'postgres');
  const backend = serviceBlock(compose, 'backend');
  const frontend = serviceBlock(compose, 'frontend');

  assertIncludes(postgres, 'postgres:16', 'postgres service');
  assertIncludes(postgres, '${POSTGRES_DATA_DIR:-./database/postgres-data}', 'postgres service volumes');
  assertIncludes(postgres, '${POSTGRES_BACKUP_DIR:-./database/backups}', 'postgres service volumes');
  assertIncludes(postgres, 'healthcheck:', 'postgres service');
  assertIncludes(postgres, 'pg_isready', 'postgres healthcheck');

  assertIncludes(backend, 'DATABASE_URL:', 'backend service environment');
  assertIncludes(backend, 'UPLOAD_DIR: /app/storage/uploads', 'backend service environment');
  assertIncludes(backend, 'EXPORT_DIR: /app/storage/exports', 'backend service environment');
  assertIncludes(backend, '${UPLOAD_DIR:-./storage/uploads}:/app/storage/uploads', 'backend service volumes');
  assertIncludes(backend, '${EXPORT_DIR:-./storage/exports}:/app/storage/exports', 'backend service volumes');
  assertIncludes(backend, 'condition: service_healthy', 'backend service depends_on');
  assertIncludes(backend, 'healthcheck:', 'backend service');
  assertIncludes(backend, '/api/health', 'backend healthcheck');

  assertIncludes(frontend, 'condition: service_healthy', 'frontend service depends_on');
  assertIncludes(frontend, 'healthcheck:', 'frontend service');
  assertIncludes(frontend, 'http://127.0.0.1/', 'frontend healthcheck');
}

function verifyBackendHealthcheck() {
  const healthController = readRequiredFile('backend/src/health.controller.ts');
  assertIncludes(healthController, 'SELECT 1', 'backend health controller');
  assertIncludes(healthController, 'uploadRootPath', 'backend health controller');
  assertIncludes(healthController, 'exportRootPath', 'backend health controller');
  assertIncludes(healthController, 'assertWritableDirectory', 'backend health controller');
}

function verifyFrontendDevServer() {
  const viteConfig = readRequiredFile('frontend/vite.config.ts');
  assertIncludes(viteConfig, "host: '0.0.0.0'", 'frontend Vite dev server');
  assertIncludes(viteConfig, 'port: 5176', 'frontend Vite dev server');
  assertIncludes(viteConfig, 'strictPort: true', 'frontend Vite dev server');
  assertIncludes(viteConfig, "target: 'http://localhost:3000'", 'frontend Vite proxy');
  assertIncludes(viteConfig, "'/uploads':", 'frontend Vite upload proxy');
  assertIncludes(viteConfig, "chunkSizeWarningLimit: 900", 'frontend build config');
  assertIncludes(viteConfig, 'manualChunks', 'frontend build config');
  assertIncludes(viteConfig, "vue: ['vue', 'vue-router']", 'frontend build chunks');
  assertIncludes(viteConfig, "elementPlus: ['element-plus']", 'frontend build chunks');
  assertIncludes(viteConfig, "elementPlusIcons: ['@element-plus/icons-vue']", 'frontend build chunks');
  assertIncludes(viteConfig, "pinyin: ['pinyin-pro']", 'frontend build chunks');
}

function verifyBackendEnvBootstrapAndPrismaScripts() {
  const rootPackageJson = readRequiredFile('package.json');
  const mainSource = readRequiredFile('backend/src/main.ts');
  const packageJson = readRequiredFile('backend/package.json');
  const prismaWrapper = readRequiredFile('backend/scripts/prisma-with-root-env.cjs');

  const rootScriptSnippets = [
    '"backend:db:generate": "npm --workspace backend run db:generate"',
    '"backend:db:migrate": "npm --workspace backend run db:migrate"',
    '"backend:db:deploy": "npm --workspace backend run db:deploy"',
    '"backend:db:seed": "npm --workspace backend run db:seed"',
    '"verify:first-stage:strict"',
    'npm run backend:db:generate && npm run backend:verify:first-stage'
  ];
  for (const snippet of rootScriptSnippets) {
    assertIncludes(rootPackageJson, snippet, 'root package scripts');
  }

  assertIncludes(mainSource, "import './env/bootstrap-env';", 'backend main bootstrap');
  assertIncludes(mainSource, "app.setGlobalPrefix('api')", 'backend main bootstrap');
  assertIncludes(mainSource, 'uploadRootPath()', 'backend main bootstrap');
  assertIncludes(mainSource, 'exportRootPath()', 'backend main bootstrap');

  for (const scriptName of ['db:generate', 'db:migrate', 'db:deploy', 'db:seed']) {
    const scriptPattern = new RegExp(`"${scriptName}"\\s*:\\s*"node scripts/prisma-with-root-env\\.cjs`);
    if (!scriptPattern.test(packageJson)) {
      addFailure(`backend/package.json ${scriptName} should use scripts/prisma-with-root-env.cjs.`);
    }
  }

  assertIncludes(prismaWrapper, "resolve(repoRoot, '.env')", 'Prisma env wrapper');
  assertIncludes(prismaWrapper, "resolve(backendRoot, '.env')", 'Prisma env wrapper');
  assertIncludes(prismaWrapper, 'dotenv.config', 'Prisma env wrapper');
  assertIncludes(prismaWrapper, "'prisma'", 'Prisma env wrapper');
}

function verifyDatabaseSafetyMigrations() {
  const migrations = readMigrationSources();
  const requiredMigrationSnippets = [
    'CREATE UNIQUE INDEX "Customer_customerName_lower_key" ON "Customer"(LOWER("customerName"))',
    'CREATE UNIQUE INDEX "Customer_customerCode_lower_key" ON "Customer"(LOWER("customerCode"))',
    'CREATE UNIQUE INDEX "CustomerOrder_orderNo_lower_key" ON "CustomerOrder"(LOWER("orderNo"))',
    'CREATE TABLE "OrderNoReservation"',
    'CREATE UNIQUE INDEX "OrderNoReservation_orderNoNormalized_key"',
    'CREATE UNIQUE INDEX "Warehouse_warehouseCode_lower_key" ON "Warehouse"(LOWER("warehouseCode"))',
    'CREATE UNIQUE INDEX "WarehouseLocation_warehouseId_locationCode_lower_key"',
    'ON "WarehouseLocation"("warehouseId", LOWER("locationCode"))',
    'CREATE UNIQUE INDEX "Material_partCode_lower_key"',
    'ON "Material"(LOWER("partCode"))',
    'CREATE TABLE "InventoryReservation"',
    'ADD COLUMN "productionPlanOverrideByCode" TEXT',
    'ADD COLUMN "productionPlanSuggestedQuantity"'
  ];

  for (const snippet of requiredMigrationSnippets) {
    assertIncludes(migrations, snippet, 'Prisma migrations');
  }
}

verifyEnvExample();
verifyDockerIgnore();
verifyDockerCompose();
verifyBackendHealthcheck();
verifyFrontendDevServer();
verifyBackendEnvBootstrapAndPrismaScripts();
verifyDatabaseSafetyMigrations();

if (failures.length > 0) {
  console.error('First-stage config verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('First-stage config verification passed.');
