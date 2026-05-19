#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const rootDir = resolve(__dirname, '..');
const cleanupScriptPath = resolve(rootDir, 'scripts/cleanup-test-data.cjs');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCleanupDryRun(args = []) {
  return execFileSync(process.execPath, [cleanupScriptPath, ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLEANUP_TEST_DATA_PREVIEW_LIMIT: process.env.CLEANUP_TEST_DATA_PREVIEW_LIMIT || '2'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function main() {
  const output = runCleanupDryRun();

  const requiredSnippets = [
    'cleanup:test-data dry run. Pass --apply',
    'Target database:',
    'Expected project database:',
    'Mode: dry-run only; no database rows are changed.',
    'Preview limit: 2',
    'Known prefixes: VERIFY-, VERIFY_, COD-, MI-API-, MAT-STABLE, UPLOAD-FILENAME, CUST-SEARCH-, TEST-CUSTOMER',
    'Matched master records',
    '- Customer:',
    '- Material:',
    '- ModelBom:',
    '- Warehouse:',
    '- MaterialCommonProjectModel:',
    'Matched customer preview',
    'Matched material preview',
    'Matched BOM preview',
    'Matched common project model preview',
    'Customer identity archive preview',
    'Soft-disable actions',
    'Warehouse ENABLED -> DISABLED',
    'WarehouseLocation ENABLED -> DISABLED',
    'Business records requiring manual review',
    'Cleanup recommendation',
    'Pending soft-clean actions:',
    'Next step:'
  ];

  for (const snippet of requiredSnippets) {
    assert(output.includes(snippet), `cleanup:test-data dry-run output missing required snippet: ${snippet}`);
  }

  const cliPreviewOutput = runCleanupDryRun(['--preview-limit=1']);
  assert(cliPreviewOutput.includes('Preview limit: 1'), 'cleanup:test-data --preview-limit must override CLEANUP_TEST_DATA_PREVIEW_LIMIT.');
  assert(
    !output.includes('cleanup:test-data applied.'),
    'verify:test-data-cleanup must only run cleanup:test-data dry-run, never apply changes.'
  );
  assert(
    !cliPreviewOutput.includes('cleanup:test-data applied.'),
    'verify:test-data-cleanup preview-limit check must only run cleanup:test-data dry-run, never apply changes.'
  );
  assert(!process.argv.includes('--apply'), 'verify:test-data-cleanup does not accept --apply.');

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: 'cleanup:test-data dry-run safety output',
        previewLimit: Number(process.env.CLEANUP_TEST_DATA_PREVIEW_LIMIT || 2)
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
