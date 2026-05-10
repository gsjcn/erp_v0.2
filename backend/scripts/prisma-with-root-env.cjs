const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const dotenv = require('dotenv');

const backendRoot = resolve(__dirname, '..');
const repoRoot = resolve(backendRoot, '..');
const envCandidates = [
  resolve(repoRoot, '.env'),
  resolve(backendRoot, '.env')
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Missing Prisma CLI arguments.');
  process.exit(1);
}

const prismaCli = resolve(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');
const result = spawnSync(process.execPath, [prismaCli, ...args], {
  cwd: backendRoot,
  env: process.env,
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
