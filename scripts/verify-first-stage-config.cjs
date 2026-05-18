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

function readRequiredJson(projectPath) {
  const source = readRequiredFile(projectPath);
  if (!source) {
    return {};
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    addFailure(`${projectPath} should be valid JSON: ${error.message}`);
    return {};
  }
}

function dependencyNames(packageJson) {
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((section) => Object.keys(packageJson[section] || {}));
}

function verifyApiRegressionScriptCoverage() {
  const rootPackageJson = readRequiredJson('package.json');
  const firstStageApiSource = readRequiredFile('scripts/verify-first-stage-api.cjs');
  const scriptsDir = path.join(rootDir, 'scripts');
  if (!fs.existsSync(scriptsDir)) {
    addFailure('Missing scripts directory for first-stage API regression checks.');
    return;
  }

  const apiScriptFiles = fs
    .readdirSync(scriptsDir)
    .filter((fileName) => /^verify-.*-api\.cjs$/.test(fileName) && fileName !== 'verify-first-stage-api.cjs')
    .sort();
  const expectedScriptNames = new Map(
    apiScriptFiles.map((fileName) => {
      const scriptName = `verify:${fileName.replace(/^verify-/, '').replace(/\.cjs$/, '')}`;
      return [scriptName, `node scripts/${fileName}`];
    })
  );
  const packageScripts = rootPackageJson.scripts || {};
  const aggregateScriptNames = new Set(
    [...firstStageApiSource.matchAll(/['"`](verify:[^'"`]+)['"`]/g)]
      .map((match) => match[1])
      .filter((scriptName) => !scriptName.includes('${'))
  );
  const firstStageApiSnippets = [
    'function parseVerifyScriptFilter()',
    'FIRST_STAGE_API_SCRIPTS',
    '--scripts=',
    'const selectedVerifyScripts = parseVerifyScriptFilter();',
    'Running ${selectedVerifyScripts.length}/${verifyScripts.length} first-stage API regression scripts.'
  ];
  for (const snippet of firstStageApiSnippets) {
    assertIncludes(firstStageApiSource, snippet, 'scripts/verify-first-stage-api.cjs');
  }

  for (const [scriptName, command] of expectedScriptNames) {
    if (packageScripts[scriptName] !== command) {
      addFailure(`package.json should expose ${scriptName} as: ${command}`);
    }
    if (!aggregateScriptNames.has(scriptName)) {
      addFailure(`scripts/verify-first-stage-api.cjs should include API regression script: ${scriptName}`);
    }
  }

  for (const [scriptName, command] of Object.entries(packageScripts)) {
    if (
      /^verify:/.test(scriptName) &&
      /^node scripts\/verify-.*-api\.cjs$/.test(command) &&
      command !== 'node scripts/verify-first-stage-api.cjs' &&
      !aggregateScriptNames.has(scriptName)
    ) {
      addFailure(`API regression script ${scriptName} is defined in package.json but missing from verify:first-stage:api.`);
    }
  }

  for (const scriptName of aggregateScriptNames) {
    if (scriptName === 'verify:first-stage:api' || scriptName === 'verify:first-stage:api:after-build') {
      continue;
    }
    if (!expectedScriptNames.has(scriptName)) {
      addFailure(`scripts/verify-first-stage-api.cjs references missing API regression script: ${scriptName}`);
    }
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
  const normalizedSource = composeSource.replace(/\r\n/g, '\n');
  const pattern = new RegExp(`\\n  ${serviceName}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|\\nnetworks:|$)`);
  const match = normalizedSource.match(pattern);
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
    'POSTGRES_HOST_BIND',
    'POSTGRES_HOST_PORT',
    'BACKEND_PORT',
    'FRONTEND_PORT',
    'CORS_ORIGIN',
    'POSTGRES_DATA_DIR',
    'POSTGRES_BACKUP_DIR',
    'UPLOAD_DIR',
    'EXPORT_DIR',
    'API_BODY_LIMIT',
    'ORDER_IMPORT_UPLOAD_MAX_MB',
    'MATERIAL_IMPORT_UPLOAD_MAX_MB'
  ];

  for (const key of requiredEnvKeys) {
    if (!new RegExp(`^${key}=`, 'm').test(envExample)) {
      addFailure(`.env.example should define ${key}.`);
    }
  }
  assertIncludes(envExample, 'FRONTEND_PORT=5176', '.env.example frontend port');
  assertIncludes(envExample, 'BACKEND_PORT=3000', '.env.example backend port');
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
    'logs',
    '.codex-logs',
    '.codex-screens',
    '.runtime-logs',
    'database/postgres-data',
    'database/backups',
    'storage/uploads',
    'storage/exports',
    'outputs/logs',
    'outputs/*.log'
  ];

  for (const pattern of requiredPatterns) {
    assertIncludes(dockerIgnore, pattern, '.dockerignore');
  }
}

function verifyGitIgnore() {
  const gitIgnore = readRequiredFile('.gitignore');
  const requiredPatterns = [
    'node_modules',
    'dist',
    '.env',
    '*.log',
    'logs/',
    '.codex-logs',
    '.codex-screens',
    '.runtime-logs',
    'database/postgres-data',
    'database/backups',
    'storage/uploads',
    'storage/exports',
    'outputs/logs',
    'outputs/*.log',
    'frontend/dist',
    'backend/dist'
  ];

  for (const pattern of requiredPatterns) {
    assertIncludes(gitIgnore, pattern, '.gitignore');
  }
}

function verifyAgentsFileSafetyRules() {
  const agentsSource = readRequiredFile('AGENTS.md');
  const requiredSnippets = [
    '文件安全限制',
    '项目根目录为 `G:\\codex\\百胜企业系统\\erp_v0.2`',
    '不得删除、移动、重命名、覆盖项目根目录以外的任何文件',
    '不得对项目根目录以外执行 `Remove-Item`、`del`、`rm`、`rmdir`、`Move-Item`、`git clean` 等破坏性命令',
    '任何递归删除或移动前，必须先解析绝对路径，并确认目标路径仍在项目根目录内',
    '涉及数据库目录、上传目录、导出目录、备份目录、`.env`、`node_modules` 的删除，必须先征求用户确认'
  ];

  // 文件安全规则是协作底线，自检中固定校验，避免后续文档整理时误删。
  for (const snippet of requiredSnippets) {
    assertIncludes(agentsSource, snippet, 'AGENTS.md file safety rules');
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
  assertIncludes(postgres, '${POSTGRES_HOST_BIND:-127.0.0.1}:${POSTGRES_HOST_PORT:-55432}:5432', 'postgres service local-only port');
  assertIncludes(postgres, 'healthcheck:', 'postgres service');
  assertIncludes(postgres, 'pg_isready', 'postgres healthcheck');
  if (/0\.0\.0\.0|\$\{POSTGRES_HOST_BIND:-0\.0\.0\.0\}|\b5432\s*:\s*5432\b/.test(postgres)) {
    addFailure('postgres service must only publish PostgreSQL to 127.0.0.1 for local development.');
  }
  if (/^\s+network_mode\s*:\s*host\b/m.test(postgres)) {
    addFailure('postgres service must not use host networking; PostgreSQL should stay inside the Docker network.');
  }
  assertIncludes(postgres, 'networks:', 'postgres service network');
  assertIncludes(postgres, '- erp-net', 'postgres service network');

  assertIncludes(backend, 'DATABASE_URL:', 'backend service environment');
  assertIncludes(backend, '@postgres:5432', 'backend service DATABASE_URL');
  assertIncludes(backend, 'UPLOAD_DIR: /app/storage/uploads', 'backend service environment');
  assertIncludes(backend, 'EXPORT_DIR: /app/storage/exports', 'backend service environment');
  assertIncludes(backend, 'API_BODY_LIMIT: ${API_BODY_LIMIT:-10mb}', 'backend service environment');
  assertIncludes(backend, 'ORDER_IMPORT_UPLOAD_MAX_MB: ${ORDER_IMPORT_UPLOAD_MAX_MB:-100}', 'backend service environment');
  assertIncludes(backend, 'MATERIAL_IMPORT_UPLOAD_MAX_MB: ${MATERIAL_IMPORT_UPLOAD_MAX_MB:-100}', 'backend service environment');
  assertIncludes(backend, '${UPLOAD_DIR:-./storage/uploads}:/app/storage/uploads', 'backend service volumes');
  assertIncludes(backend, '${EXPORT_DIR:-./storage/exports}:/app/storage/exports', 'backend service volumes');
  assertIncludes(backend, 'condition: service_healthy', 'backend service depends_on');
  assertIncludes(backend, 'healthcheck:', 'backend service');
  assertIncludes(backend, '/api/health', 'backend healthcheck');

  assertIncludes(frontend, 'condition: service_healthy', 'frontend service depends_on');
  assertIncludes(frontend, '${FRONTEND_PORT:-5176}:80', 'frontend service ports');
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

function verifyFrontendDockerAndNginxProxy() {
  const dockerfile = readRequiredFile('frontend/Dockerfile');
  const nginxConfig = readRequiredFile('frontend/nginx.conf');

  assertIncludes(dockerfile, 'ARG VITE_API_BASE_URL=/api', 'frontend Dockerfile build args');
  assertIncludes(dockerfile, 'COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf', 'frontend Dockerfile runtime stage');
  assertIncludes(dockerfile, 'COPY --from=build /app/frontend/dist /usr/share/nginx/html', 'frontend Dockerfile runtime stage');
  assertIncludes(nginxConfig, 'client_max_body_size 100m;', 'frontend nginx upload limit');
  assertIncludes(nginxConfig, 'location /api/', 'frontend nginx API proxy');
  assertIncludes(nginxConfig, 'proxy_pass http://backend:3000/api/;', 'frontend nginx API proxy');
  assertIncludes(nginxConfig, 'location /uploads/', 'frontend nginx uploads proxy');
  assertIncludes(nginxConfig, 'proxy_pass http://backend:3000/uploads/;', 'frontend nginx uploads proxy');
  assertIncludes(nginxConfig, 'try_files $uri $uri/ /index.html;', 'frontend nginx SPA fallback');
}

function verifyBackendDockerfileMigrationDeploy() {
  const dockerfile = readRequiredFile('backend/Dockerfile');
  assertIncludes(dockerfile, 'RUN npm --workspace backend run db:generate', 'backend Dockerfile build stage');
  assertIncludes(dockerfile, 'COPY --from=build /app/backend/scripts ./backend/scripts', 'backend Dockerfile runtime stage');
  assertIncludes(dockerfile, 'COPY --from=build /app/database/prisma ./database/prisma', 'backend Dockerfile runtime stage');
  assertIncludes(
    dockerfile,
    'node scripts/prisma-with-root-env.cjs migrate deploy --schema ../database/prisma/schema.prisma && node dist/main.js',
    'backend Dockerfile runtime CMD'
  );
}

function verifyPostgreSqlPrismaPrimaryDatabase() {
  const schema = readRequiredFile('database/prisma/schema.prisma');
  const envExample = readRequiredFile('.env.example');
  const rootPackageJson = readRequiredJson('package.json');
  const backendPackageJson = readRequiredJson('backend/package.json');
  const frontendPackageJson = readRequiredJson('frontend/package.json');

  const datasourceMatch = schema.match(/datasource\s+db\s*\{([\s\S]*?)\}/);
  if (!datasourceMatch) {
    addFailure('database/prisma/schema.prisma should define datasource db.');
  } else {
    const datasourceBlock = datasourceMatch[1];
    if (!/provider\s*=\s*"postgresql"/.test(datasourceBlock)) {
      addFailure('Prisma datasource db should use provider = "postgresql".');
    }
    if (!/url\s*=\s*env\("DATABASE_URL"\)/.test(datasourceBlock)) {
      addFailure('Prisma datasource db should read url from env("DATABASE_URL").');
    }
  }

  if (!/generator\s+client\s*\{[\s\S]*?provider\s*=\s*"prisma-client-js"[\s\S]*?\}/.test(schema)) {
    addFailure('database/prisma/schema.prisma should generate prisma-client-js.');
  }

  if (/provider\s*=\s*"(sqlite|mongodb)"/i.test(schema)) {
    addFailure('Prisma schema must not use sqlite or mongodb as a datasource provider.');
  }

  const databaseUrlLine = envExample.match(/^DATABASE_URL=(.*)$/m);
  if (databaseUrlLine && !/^"?postgresql:\/\//.test(databaseUrlLine[1].trim())) {
    addFailure('.env.example DATABASE_URL should use a postgresql:// connection string.');
  }

  const backendDependencies = dependencyNames(backendPackageJson);
  if (!backendDependencies.includes('@prisma/client')) {
    addFailure('backend/package.json should depend on @prisma/client.');
  }
  if (!backendDependencies.includes('prisma')) {
    addFailure('backend/package.json should include prisma for schema generation and migrations.');
  }

  const forbiddenDatabasePackages = new Set([
    '@libsql/client',
    'better-sqlite3',
    'lokijs',
    'lowdb',
    'mongodb',
    'mongoose',
    'nedb',
    'nedb-promises',
    'sql.js',
    'sqlite',
    'sqlite3'
  ]);
  const packageFiles = [
    ['package.json', rootPackageJson],
    ['backend/package.json', backendPackageJson],
    ['frontend/package.json', frontendPackageJson]
  ];

  for (const [projectPath, packageJson] of packageFiles) {
    for (const dependencyName of dependencyNames(packageJson)) {
      const normalizedName = dependencyName.toLowerCase();
      if (
        forbiddenDatabasePackages.has(normalizedName) ||
        normalizedName.includes('sqlite') ||
        normalizedName.includes('mongodb')
      ) {
        addFailure(`${projectPath} must not include forbidden primary database dependency: ${dependencyName}`);
      }
    }
  }
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
    '"verify:prisma-client-enums": "node scripts/verify-prisma-client-enums.cjs"',
    '"verify:first-stage:api": "node scripts/verify-first-stage-api.cjs"',
    '"verify:first-stage:api:after-build": "node scripts/verify-first-stage-api.cjs --skip-build"',
    '"verify:first-stage:strict"',
    'npm run backend:db:generate && npm run verify:prisma-client-enums && npm run backend:verify:first-stage',
    'npm run verify:first-stage:api:after-build && npm run frontend:build',
    '"docker:up": "docker compose up -d --build"',
    '"docker:down": "docker compose down"',
    '"docker:ps": "docker compose ps"',
    '"docker:logs:backend": "docker compose logs backend"',
    '"docker:logs:frontend": "docker compose logs frontend"',
    '"docker:db:deploy": "docker compose exec backend npm run db:deploy"',
    '"docker:db:backup": "node scripts/docker-db.cjs backup"',
    '"docker:db:status": "node scripts/docker-db.cjs status"',
    '"docker:db:verify-backups": "node scripts/docker-db.cjs verify-backups"',
    '"docker:db:restore-plan": "node scripts/docker-db.cjs restore-plan"',
    '"docker:db:seed": "node scripts/docker-db.cjs seed"'
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

function verifyReadmeDockerDatabaseCommands() {
  const readme = readRequiredFile('README.md');
  const requiredSnippets = [
    'npm run docker:db:deploy',
    'npm run docker:db:seed',
    'npm run docker:db:status',
    'npm run docker:db:backup',
    'npm run docker:db:verify-backups',
    'npm run docker:db:restore-plan',
    '--file=baisheng_erp_YYYYMMDD_HHMMSS.dump',
    '--write-missing',
    'baisheng-erp-postgres',
    'POSTGRES_DATA_DIR',
    'POSTGRES_BACKUP_DIR',
    '测试阶段只认这一套项目库'
  ];

  for (const snippet of requiredSnippets) {
    assertIncludes(readme, snippet, 'README Docker database commands');
  }

  if (readme.includes('docker compose exec backend npm run db:seed')) {
    addFailure('README should use docker:db:seed so test data resets are backed up first.');
  }
}

function verifyDockerDbUtility() {
  const source = readRequiredFile('scripts/docker-db.cjs');
  const requiredSnippets = [
    "const currentPostgresContainer = 'baisheng-erp-postgres'",
    "const postgresHostPort = env.POSTGRES_HOST_PORT || '55432'",
    "const postgresDataDir = resolveProjectPath(env.POSTGRES_DATA_DIR || './database/postgres-data')",
    "command === 'verify-backups'",
    "command === 'restore-plan'",
    'function commandOptionValue',
    "commandOptionValue('--file') || commandOptionValue('--backup')",
    'verifyDatabaseBackups({ writeMissing: commandOptions.has',
    'status|backup|seed|verify-backups [--write-missing]|restore-plan [--file=BACKUP.dump]',
    'function printCurrentDatabaseSummary()',
    'function latestDatabaseBackupInfo()',
    'function listDatabaseBackups()',
    'function verifyDatabaseBackups',
    'function printRestorePlan',
    'function selectedRestoreBackupInfo',
    'function normalizeBackupFileName',
    'restore-plan --file only accepts a backup file name',
    'restore-plan --file must use a',
    'function backupContainerPath',
    'function writeBackupChecksum',
    'Database backup verification passed',
    'Database backup verification failed',
    'archive ok',
    'archive failed',
    'checksum or archive issues',
    'Latest verified PostgreSQL restore plan',
    'Selected verified PostgreSQL restore plan',
    'Restore command, not executed by this plan',
    'Run npm run docker:db:backup first',
    'backup files: ${backupInfo.count}, latest:',
    'Database backup checksum created',
    'Database backup checksum verified',
    'Database backup checksum verification failed',
    'Database backup archive verified',
    'function verifyBackupArchive',
    "'pg_restore', '--list'",
    'pg_restore --list returned no entries',
    'function backupChecksumInfo',
    'function backupChecksumSummary',
    'function latestBackupArchiveSummary',
    'not checked until checksum is ok',
    'backup archive:',
    'function sha256File',
    'function shortHash',
    'backup checksum:',
    'missing .sha256 file',
    "createHash('sha256')",
    'run npm run docker:db:backup before risky resets',
    'function formatBytes',
    'function formatLocalDateTime',
    'Current ERP PostgreSQL target',
    'this ERP project uses only the container and data directory above',
    'function warnAboutExtraPostgresResources()',
    'Extra PostgreSQL containers detected',
    'Extra Docker volumes that may contain PostgreSQL data',
    "dockerOutput(['ps', '-a', '--format'",
    "dockerOutput(['volume', 'ls', '--format'",
    "dockerOutput(['volume', 'inspect', volumeName"
  ];

  for (const snippet of requiredSnippets) {
    assertIncludes(source, snippet, 'scripts/docker-db.cjs legacy database warnings');
  }
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
verifyGitIgnore();
verifyAgentsFileSafetyRules();
verifyDockerCompose();
verifyBackendHealthcheck();
verifyFrontendDevServer();
verifyFrontendDockerAndNginxProxy();
verifyBackendDockerfileMigrationDeploy();
verifyPostgreSqlPrismaPrimaryDatabase();
verifyBackendEnvBootstrapAndPrismaScripts();
verifyReadmeDockerDatabaseCommands();
verifyDockerDbUtility();
verifyApiRegressionScriptCoverage();
verifyDatabaseSafetyMigrations();

if (failures.length > 0) {
  console.error('First-stage config verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('First-stage config verification passed.');
