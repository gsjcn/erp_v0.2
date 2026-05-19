#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const env = loadRootEnv();
const command = process.argv[2] || 'status';
const commandArgs = process.argv.slice(3);
const commandOptions = new Set(commandArgs);
const postgresUser = env.POSTGRES_USER || 'baisheng';
const postgresDb = env.POSTGRES_DB || 'baisheng_erp';
const postgresHostPort = env.POSTGRES_HOST_PORT || '55432';
const postgresDataDir = resolveProjectPath(env.POSTGRES_DATA_DIR || './database/postgres-data');
const backupDir = resolveProjectPath(env.POSTGRES_BACKUP_DIR || './database/backups');
const currentPostgresContainer = 'baisheng-erp-postgres';

if (command === 'backup') {
  backupDatabase();
} else if (command === 'seed') {
  seedDatabase();
} else if (command === 'status') {
  showDatabaseStatus();
} else if (command === 'verify-backups') {
  verifyDatabaseBackups({ writeMissing: commandOptions.has('--write-missing') });
} else if (command === 'restore-plan') {
  printRestorePlan({ fileName: commandOptionValue('--file') || commandOptionValue('--backup') });
} else {
  console.error(`Unknown docker database command: ${command}`);
  console.error('Usage: node scripts/docker-db.cjs status|backup|seed|verify-backups [--write-missing]|restore-plan [--file=BACKUP.dump]');
  process.exit(1);
}

function backupDatabase() {
  assertCurrentPostgresTarget();
  fs.mkdirSync(backupDir, { recursive: true });
  const fileName = `${safeFilePrefix(postgresDb)}_${timestampKey()}.dump`;
  const containerPath = `/backups/${fileName}`;
  runDocker(['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', postgresUser, '-d', postgresDb, '-F', 'c', '-f', containerPath]);

  const hostPath = path.join(backupDir, fileName);
  const stat = fs.statSync(hostPath);
  if (stat.size <= 0) {
    throw new Error(`Database backup is empty: ${hostPath}`);
  }
  const { checksumPath } = writeBackupChecksum(hostPath);
  const checksumInfo = backupChecksumInfo(hostPath);
  if (checksumInfo.status !== 'ok') {
    throw new Error(`Database backup checksum verification failed: ${backupChecksumSummary(checksumInfo)}`);
  }
  const archiveInfo = verifyBackupArchive(containerPath);

  console.log(`Database backup created: ${hostPath}`);
  console.log(`Database backup checksum created: ${checksumPath}`);
  console.log(`Database backup checksum verified: ${shortHash(checksumInfo.actual)}`);
  console.log(`Database backup archive verified: ${archiveInfo.entryCount} pg_restore list entries`);
}

function seedDatabase() {
  console.log('Creating database backup before seed...');
  backupDatabase();
  console.log('Running first-stage seed data reset...');
  runDocker(['compose', 'exec', '-T', 'backend', 'env', 'SEED_BACKUP_CONFIRMED=true', 'npm', 'run', 'db:seed']);
  console.log('Database status after seed:');
  showDatabaseStatus();
}

function showDatabaseStatus() {
  assertCurrentPostgresTarget();
  printCurrentDatabaseSummary();
  runDocker(['compose', 'ps']);
  warnAboutExtraPostgresResources();
  runPsql(`
select current_database() as database, current_user as user;
select count(*) as applied_migrations from "_prisma_migrations" where finished_at is not null and rolled_back_at is null;
select count(*) as failed_migrations from "_prisma_migrations" where finished_at is null and rolled_back_at is null;
select 'Customer' as table_name, count(*) as rows from "Customer"
union all select 'Material', count(*) from "Material"
union all select 'ModelBom', count(*) from "ModelBom"
union all select 'ModelBomLine', count(*) from "ModelBomLine"
union all select 'CustomerOrder', count(*) from "CustomerOrder"
union all select 'OrderLine', count(*) from "OrderLine"
union all select 'ProductionTask', count(*) from "ProductionTask"
union all select 'InventoryBatch', count(*) from "InventoryBatch"
union all select 'InventoryTransaction', count(*) from "InventoryTransaction"
union all select 'Warehouse', count(*) from "Warehouse"
union all select 'WarehouseLocation', count(*) from "WarehouseLocation"
union all select 'ProductionNotice', count(*) from "ProductionNotice";
`);
}

function printCurrentDatabaseSummary() {
  console.log('\nCurrent ERP PostgreSQL target:');
  console.log(`- container: ${currentPostgresContainer}`);
  console.log('- compose service: postgres');
  console.log(`- database: ${postgresDb}`);
  console.log(`- user: ${postgresUser}`);
  console.log(`- host port: 127.0.0.1:${postgresHostPort} -> 5432`);
  console.log(`- data directory: ${postgresDataDir}`);
  console.log(`- backup directory: ${backupDir}`);
  const backupInfo = latestDatabaseBackupInfo();
  if (backupInfo) {
    console.log(
      `- backup files: ${backupInfo.count}, latest: ${backupInfo.fileName} (${formatBytes(backupInfo.size)}, ${formatLocalDateTime(backupInfo.mtime)})`
    );
    console.log(`- backup checksum: ${backupChecksumSummary(backupInfo.checksum)}`);
    console.log(`- backup archive: ${latestBackupArchiveSummary(backupInfo)}`);
  } else {
    console.log('- backup files: 0 matching .dump files; run npm run docker:db:backup before risky resets.');
  }
  console.log('- scope: this ERP project uses only the container and data directory above.');
}

function latestDatabaseBackupInfo() {
  const backupFiles = listDatabaseBackups();
  const latest = backupFiles[0];
  return latest ? { ...latest, count: backupFiles.length } : null;
}

function listDatabaseBackups() {
  if (!fs.existsSync(backupDir)) {
    return [];
  }
  const prefix = `${safeFilePrefix(postgresDb)}_`;
  return fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.dump'))
    .map((entry) => {
      const filePath = path.join(backupDir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        fileName: entry.name,
        filePath,
        mtime: stat.mtime,
        size: stat.size,
        checksum: backupChecksumInfo(filePath)
      };
    })
    .sort((left, right) => right.mtime.getTime() - left.mtime.getTime());
}

function verifyDatabaseBackups({ writeMissing = false } = {}) {
  assertCurrentPostgresTarget();
  const backupFiles = listDatabaseBackups();
  if (backupFiles.length === 0) {
    throw new Error(`No ${safeFilePrefix(postgresDb)}_*.dump backup files found in ${backupDir}`);
  }

  let failedCount = 0;
  let writtenCount = 0;
  console.log(`Verifying ${backupFiles.length} PostgreSQL backup file(s) in ${backupDir}`);
  for (const backupFile of backupFiles) {
    let checksumInfo = backupFile.checksum;
    if (checksumInfo.status === 'missing' && writeMissing) {
      writeBackupChecksum(backupFile.filePath);
      writtenCount += 1;
      checksumInfo = backupChecksumInfo(backupFile.filePath);
    }
    let archiveInfo = null;
    let archiveError = null;
    if (checksumInfo.status === 'ok') {
      try {
        archiveInfo = verifyBackupArchive(backupContainerPath(backupFile.fileName));
      } catch (error) {
        archiveError = error instanceof Error ? error.message : String(error);
      }
    }
    const archiveSummary = archiveInfo
      ? `; archive ok (${archiveInfo.entryCount} pg_restore list entries)`
      : archiveError
        ? `; archive failed (${archiveError})`
        : '';
    const line = `- ${backupFile.fileName}: ${backupChecksumSummary(checksumInfo)}${archiveSummary}`;
    if (checksumInfo.status === 'ok') {
      if (archiveError) {
        failedCount += 1;
        console.warn(line);
      } else {
        console.log(line);
      }
    } else {
      failedCount += 1;
      console.warn(line);
    }
  }

  if (failedCount > 0) {
    throw new Error(`Database backup verification failed: ${failedCount}/${backupFiles.length} backup file(s) have checksum or archive issues.`);
  }
  console.log(`Database backup verification passed: ${backupFiles.length} backup file(s) checked, ${writtenCount} checksum file(s) written.`);
}

function printRestorePlan({ fileName = '' } = {}) {
  assertCurrentPostgresTarget();
  const backup = selectedRestoreBackupInfo(fileName);
  if (!backup) {
    throw new Error(`No ${safeFilePrefix(postgresDb)}_*.dump backup files found in ${backupDir}`);
  }
  if (backup.checksum.status !== 'ok') {
    throw new Error(`Selected backup is not restorable until checksum is fixed: ${backupChecksumSummary(backup.checksum)}`);
  }
  const archiveInfo = verifyBackupArchive(backupContainerPath(backup.fileName));
  const restoreCommand = [
    'docker compose exec postgres pg_restore',
    `-U ${postgresUser}`,
    `-d ${postgresDb}`,
    '--clean --if-exists',
    backupContainerPath(backup.fileName)
  ].join(' ');

  console.log(fileName ? '\nSelected verified PostgreSQL restore plan:' : '\nLatest verified PostgreSQL restore plan:');
  console.log(`- target container: ${currentPostgresContainer}`);
  console.log(`- target database: ${postgresDb}`);
  console.log(`- target user: ${postgresUser}`);
  console.log(`- backup file: ${backup.fileName}`);
  console.log(`- backup path: ${backup.filePath}`);
  console.log(`- backup size: ${formatBytes(backup.size)}`);
  console.log(`- backup time: ${formatLocalDateTime(backup.mtime)}`);
  console.log(`- checksum: ${backupChecksumSummary(backup.checksum)}`);
  console.log(`- archive: ok (${archiveInfo.entryCount} pg_restore list entries)`);
  console.log('\nRestore command, not executed by this plan:');
  console.log(restoreCommand);
  console.log('\nWarning: restore is destructive for the target database. Run npm run docker:db:backup first if the current data must be preserved.');
}

function selectedRestoreBackupInfo(fileName) {
  if (!fileName) {
    return latestDatabaseBackupInfo();
  }
  const normalizedFileName = normalizeBackupFileName(fileName);
  const backup = listDatabaseBackups().find((item) => item.fileName === normalizedFileName);
  if (!backup) {
    throw new Error(`Backup file is not available for ${postgresDb}: ${normalizedFileName}`);
  }
  return backup;
}

function normalizeBackupFileName(value) {
  const fileName = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || path.basename(fileName) !== fileName) {
    throw new Error('restore-plan --file only accepts a backup file name, not a path.');
  }
  const prefix = `${safeFilePrefix(postgresDb)}_`;
  if (!fileName.startsWith(prefix) || !fileName.endsWith('.dump')) {
    throw new Error(`restore-plan --file must use a ${prefix}*.dump backup file name.`);
  }
  return fileName;
}

function backupContainerPath(fileName) {
  return `/backups/${fileName}`;
}

function verifyBackupArchive(containerPath) {
  const archiveList = dockerOutput(['compose', 'exec', '-T', 'postgres', 'pg_restore', '--list', containerPath]);
  const entries = archiveList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(';'));
  if (entries.length === 0) {
    throw new Error(`Database backup archive verification failed: pg_restore --list returned no entries for ${containerPath}`);
  }
  return { entryCount: entries.length };
}

function assertCurrentPostgresTarget() {
  const composeContainerId = dockerOutput(['compose', 'ps', '-q', 'postgres']).trim();
  if (!composeContainerId) {
    throw new Error(
      `PostgreSQL compose service is not running. Start the single project database with docker compose up -d postgres, target container ${currentPostgresContainer}.`
    );
  }
  const composeContainerName = dockerOutput(['inspect', composeContainerId, '--format', '{{.Name}}']).trim().replace(/^\//, '');
  if (composeContainerName !== currentPostgresContainer) {
    throw new Error(
      `Refusing to operate on unexpected PostgreSQL container "${composeContainerName}". This ERP project only uses "${currentPostgresContainer}". Check Docker Compose project/name before backup, seed, or restore planning.`
    );
  }
}

function backupChecksumInfo(filePath) {
  const checksumPath = `${filePath}.sha256`;
  if (!fs.existsSync(checksumPath)) {
    return { status: 'missing', checksumPath };
  }
  const checksumSource = fs.readFileSync(checksumPath, 'utf8').trim();
  const expected = checksumSource.split(/\s+/)[0]?.toLowerCase() || '';
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    return { status: 'invalid', checksumPath };
  }
  const actual = sha256File(filePath);
  return {
    status: actual === expected ? 'ok' : 'mismatch',
    checksumPath,
    expected,
    actual
  };
}

function backupChecksumSummary(info) {
  if (!info || info.status === 'missing') {
    return 'missing .sha256 file';
  }
  if (info.status === 'invalid') {
    return `invalid .sha256 file (${info.checksumPath})`;
  }
  if (info.status === 'mismatch') {
    return `mismatch (expected ${shortHash(info.expected)}, actual ${shortHash(info.actual)})`;
  }
  return `ok (sha256 ${shortHash(info.actual)}, file ${path.basename(info.checksumPath)})`;
}

function latestBackupArchiveSummary(backupInfo) {
  if (!backupInfo || backupInfo.checksum?.status !== 'ok') {
    return 'not checked until checksum is ok';
  }
  try {
    const archiveInfo = verifyBackupArchive(backupContainerPath(backupInfo.fileName));
    return `ok (${archiveInfo.entryCount} pg_restore list entries)`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `failed (${message})`;
  }
}

function warnAboutExtraPostgresResources() {
  const containers = dockerOutput(['ps', '-a', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, image, status, ports] = line.split('\t');
      return { name, image, status, ports };
    })
    .filter((container) => container.image?.toLowerCase().includes('postgres') && container.name !== currentPostgresContainer);

  if (containers.length > 0) {
    console.warn('\nExtra PostgreSQL containers detected. They are not used by this ERP project:');
    for (const container of containers) {
      console.warn(`- ${container.name} (${container.image}, ${container.status}, ${container.ports || 'no published ports'})`);
    }
  }

  const volumes = dockerOutput(['volume', 'ls', '--format', '{{.Name}}'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name, labels: dockerVolumeLabels(name) }))
    .filter((volume) => {
      const volumeName = volume.name.toLowerCase();
      const labelText = JSON.stringify(volume.labels || {}).toLowerCase();
      return volumeName.includes('postgres') || labelText.includes('postgres');
    });

  if (volumes.length > 0) {
    console.warn('\nExtra Docker volumes that may contain PostgreSQL data:');
    for (const volume of volumes) {
      const project = volume.labels?.['com.docker.compose.project'];
      const volumeLabel = volume.labels?.['com.docker.compose.volume'];
      const suffix = [project ? `project=${project}` : '', volumeLabel ? `volume=${volumeLabel}` : ''].filter(Boolean).join(', ');
      console.warn(`- ${volume.name}${suffix ? ` (${suffix})` : ''}`);
    }
  }
}

function runPsql(sql) {
  runDocker(['compose', 'exec', '-T', 'postgres', 'psql', '-U', postgresUser, '-d', postgresDb], sql);
}

function runDocker(args, input) {
  const result = spawnSync('docker', args, {
    cwd: rootDir,
    input,
    encoding: 'utf8',
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit']
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function dockerOutput(args) {
  const result = spawnSync('docker', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `docker ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function dockerVolumeLabels(volumeName) {
  const source = dockerOutput(['volume', 'inspect', volumeName, '--format', '{{json .Labels}}']).trim();
  if (!source || source === 'null') {
    return {};
  }
  try {
    return JSON.parse(source);
  } catch {
    return {};
  }
}

function loadRootEnv() {
  const values = {};
  for (const fileName of ['.env', '.env.example']) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!(key in values)) {
        values[key] = unquoteEnvValue(rawValue);
      }
    }
  }
  return values;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveProjectPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function commandOptionValue(name) {
  const prefix = `${name}=`;
  const inlineValue = commandArgs.find((arg) => arg.startsWith(prefix));
  if (inlineValue) {
    return inlineValue.slice(prefix.length);
  }
  const index = commandArgs.indexOf(name);
  if (index >= 0 && commandArgs[index + 1] && !commandArgs[index + 1].startsWith('--')) {
    return commandArgs[index + 1];
  }
  return '';
}

function timestampKey() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ];
  return parts.join('');
}

function safeFilePrefix(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'postgres';
}

function writeBackupChecksum(filePath) {
  const checksum = sha256File(filePath);
  const checksumPath = `${filePath}.sha256`;
  fs.writeFileSync(checksumPath, `${checksum}  ${path.basename(filePath)}\n`, 'utf8');
  return { checksum, checksumPath };
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function shortHash(value) {
  return String(value || '').slice(0, 12);
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatLocalDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = [
    date.getFullYear(),
    '-',
    String(date.getMonth() + 1).padStart(2, '0'),
    '-',
    String(date.getDate()).padStart(2, '0'),
    ' ',
    String(date.getHours()).padStart(2, '0'),
    ':',
    String(date.getMinutes()).padStart(2, '0'),
    ':',
    String(date.getSeconds()).padStart(2, '0')
  ];
  return parts.join('');
}
