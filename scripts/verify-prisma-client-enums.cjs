const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..');
const schemaPath = resolve(repoRoot, 'database/prisma/schema.prisma');
const clientJsPath = resolve(repoRoot, 'node_modules/.prisma/client/index.js');
const clientDtsPath = resolve(repoRoot, 'node_modules/.prisma/client/index.d.ts');

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (const filePath of [schemaPath, clientJsPath, clientDtsPath]) {
  if (!existsSync(filePath)) {
    fail(`Missing required Prisma enum verification file: ${filePath}`);
  }
}

const schemaSource = readFileSync(schemaPath, 'utf8');
const clientJsSource = readFileSync(clientJsPath, 'utf8');
const clientDtsSource = readFileSync(clientDtsPath, 'utf8');
const enumBlocks = [...schemaSource.matchAll(/enum\s+(\w+)\s*\{([\s\S]*?)\}/g)];
const missing = [];

for (const [, enumName, enumBody] of enumBlocks) {
  const values = enumBody
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line && !line.startsWith('@@'))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);

  for (const value of values) {
    const jsSnippet = `${value}: '${value}'`;
    const dtsSnippet = `${value}: '${value}'`;
    if (!clientJsSource.includes(jsSnippet) || !clientDtsSource.includes(dtsSnippet)) {
      missing.push(`${enumName}.${value}`);
    }
  }
}

if (missing.length > 0) {
  fail(
    `Prisma Client enum is stale: ${missing.join(', ')}. Stop any running backend process, then run npm run backend:db:generate.`
  );
}

console.log(`Prisma Client enum verification passed: ${enumBlocks.length} enums`);
