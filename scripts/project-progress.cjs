#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

function resolveProjectPath(relativePath) {
  return path.join(rootDir, relativePath);
}

function fileExists(relativePath) {
  return fs.existsSync(resolveProjectPath(relativePath));
}

function readFile(relativePath) {
  const targetPath = resolveProjectPath(relativePath);
  return fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
}

function hasEvery(relativePath, snippets) {
  const source = readFile(relativePath);
  return snippets.every((snippet) => source.includes(snippet));
}

function createCheck(label, relativePath, snippets = []) {
  const ok = fileExists(relativePath) && hasEvery(relativePath, snippets);
  return {
    label,
    ok,
    file: relativePath
  };
}

function createAnyCheck(label, candidates) {
  const ok = candidates.some((candidate) => fileExists(candidate.file) && hasEvery(candidate.file, candidate.snippets || []));
  return {
    label,
    ok,
    file: candidates.map((candidate) => candidate.file).join(' | ')
  };
}

function scorePhase(phase) {
  const completed = phase.checks.filter((check) => check.ok).length;
  const total = phase.checks.length;
  return {
    ...phase,
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100)
  };
}

const phases = [
  {
    key: 'P0',
    title: '稳定性和数据安全',
    checks: [
      createCheck('Docker Compose contains PostgreSQL/backend/frontend', 'docker-compose.yml', ['postgres', 'backend', 'frontend']),
      createCheck('root verify:first-stage covers source/config/API/build', 'package.json', [
        'verify:first-stage:source',
        'verify:first-stage:config',
        'verify:first-stage:api:after-build',
        'backend:build',
        'frontend:build'
      ]),
      createCheck('Prisma first-stage verification exists', 'database/prisma/verify-first-stage.ts', ['InventoryTransaction', 'OrderStatus']),
      createCheck('safe test-data cleanup exists', 'scripts/cleanup-test-data.cjs', [
        'cleanupTargetMatchesProjectDatabase',
        'assertNoActiveBusinessDataForApply',
        'WarehouseLocation ENABLED -> DISABLED'
      ]),
      createCheck('cleanup dry-run regression exists', 'scripts/verify-test-data-cleanup.cjs', [
        'Mode: dry-run only; no database rows are changed.',
        'Preview limit: 1'
      ]),
      createCheck('business fixture visibility regression exists', 'scripts/verify-business-fixture-visibility-api.cjs', [
        'fixturePrefixes',
        'currentBusinessDate'
      ]),
      createCheck('business data baseline regression exists', 'scripts/verify-business-data-baseline-api.cjs', [
        'production tasks',
        'warehouse config',
        'year statistics baseline'
      ]),
      createCheck('customer management data regression exists', 'scripts/verify-customer-management-api.cjs', [
        'customer default list must show usable business customers',
        'customer code duplicate check must be case-insensitive',
        'customer next-code'
      ]),
      createCheck('customer contact management data regression exists', 'scripts/verify-customer-contact-management-api.cjs', [
        'customer contact detail must keep enabled contact rows',
        'enabled customer must keep exactly one enabled primary contact',
        'customer contact keyword search must include matching customers'
      ]),
      createCheck('order management data regression exists', 'scripts/verify-order-management-api.cjs', [
        'order default list must show business orders',
        'order check-no must detect existing orderNo',
        'orders next-no'
      ]),
      createCheck('inventory management data regression exists', 'scripts/verify-inventory-management-api.cjs', [
        'inventory summary page must show current InventoryBatch-derived rows',
        'availableQuantity must equal orderInventoryQuantity + stockInventoryQuantity',
        'inventory source-details'
      ]),
      createCheck('material management data regression exists', 'scripts/verify-material-management-api.cjs', [
        'material dashboard default page must show business materials',
        'material dashboard BOM relation filter must show BOM rows',
        'customerNames preview must stay compact'
      ]),
      createCheck('model BOM management data regression exists', 'scripts/verify-model-bom-management-api.cjs', [
        'model BOM default page must show model BOM rows',
        'BOM list row',
        'child part'
      ]),
      createCheck('material transform management data regression exists', 'scripts/verify-material-transform-management-api.cjs', [
        'material transform default page must show source processing relation rows',
        'must not use the same source and target material',
        'inventoryDecision=SOURCE_REWORK'
      ]),
      createCheck('production management data regression exists', 'scripts/verify-production-management-api.cjs', [
        'production order summaries ALL',
        'production management status cards must not all be zero',
        'customerId'
      ]),
      createCheck('process management data regression exists', 'scripts/verify-process-management-api.cjs', [
        'process definitions page must show standard process rows',
        'process templates page must show reusable process templates',
        'references missing or disabled process step'
      ]),
      createCheck('statistics management filter regression exists', 'scripts/verify-statistics-management-api.cjs', [
        'statistics selected-quarter filter',
        'statistics selected-month filter',
        'statistics/options must return selectable years'
      ]),
      createCheck('warehouse management data regression exists', 'scripts/verify-warehouse-management-api.cjs', [
        'warehouse config default list',
        'warehouse pending shipments',
        'warehouse management transactions must show inventory movement rows'
      ]),
      createCheck('notice center data regression exists', 'scripts/verify-notice-center-api.cjs', [
        'production notices page must only return PRODUCTION target rows',
        'warehouse notices page must only return WAREHOUSE target rows',
        'admin notices page must include role-visible notices'
      ]),
      createCheck('production exception management data regression exists', 'scripts/verify-production-exception-management-api.cjs', [
        'production replenishment requests default page must show current business rows',
        'production scrap records default page must show current business rows',
        'production exception lists hide reusable regression fixtures'
      ]),
      createCheck('warehouse work management data regression exists', 'scripts/verify-warehouse-work-management-api.cjs', [
        'warehouse pending shipments must show current business rows',
        'warehouse transactions default page must show current inventory movement rows',
        'warehouse work lists hide reusable regression fixtures'
      ]),
      createCheck('frontend deployment smoke regression exists', 'scripts/verify-frontend-smoke.cjs', [
        'verifyFrontendBuildCurrent',
        'assertBusinessPage',
        'fixturePrefixes',
        'production tasks business page',
        'warehouse transactions business page',
        'StatisticsView-'
      ]),
      createCheck('Docker DB backup/status tooling exists', 'scripts/docker-db.cjs', ['backup', 'restore-plan', 'verify-backups']),
      createCheck('Docker runtime verification exists', 'scripts/verify-docker-runtime.cjs', [
        'baisheng-erp-postgres',
        'baisheng-erp-backend',
        'baisheng-erp-frontend',
        'PostgreSQL',
        'project runtime uniqueness',
        'sameProjectContainers',
        'Current project should use exactly one PostgreSQL container'
      ]),
      createCheck('local runtime health command exists', 'package.json', [
        'verify:local-runtime',
        'verify:docker-runtime',
        'verify:frontend-smoke',
        'verify:business-data-baseline-api',
        'verify:business-fixture-visibility-api'
      ]),
      createCheck('dockerignore protects generated/runtime data', '.dockerignore', ['node_modules', 'database/postgres-data', 'storage', 'logs']),
      createCheck('frontend avoids prompt/confirm through source verifier', 'scripts/verify-first-stage-source.cjs', ['window.prompt', 'window.confirm']),
      createCheck('official DB is PostgreSQL/Prisma', 'database/prisma/schema.prisma', ['provider = "postgresql"', 'model InventoryTransaction'])
    ]
  },
  {
    key: 'P1',
    title: '零件管理控制面板',
    checks: [
      createCheck('materials main route exists between customer/order', 'frontend/src/router.ts', ['/materials', 'MaterialsManagementView.vue']),
      createCheck('materials dashboard view exists', 'frontend/src/views/MaterialsManagementView.vue', ['零件控制面板', '适用客户', 'BOM']),
      createCheck('materials dashboard API exists', 'backend/src/modules/materials/materials.controller.ts', ['dashboard', 'project-models', 'common-project-models']),
      createCheck('Material model exists', 'database/prisma/schema.prisma', ['model Material {', 'partCode', 'partName']),
      createCheck('MaterialApplicability model exists', 'database/prisma/schema.prisma', ['model MaterialApplicability', 'customerId', 'projectModel']),
      createCheck('material add/edit/disable service exists', 'backend/src/modules/inventory/inventory.service.ts', [
        'createMaterial',
        'updateMaterial',
        "status: 'DISABLED'"
      ]),
      createCheck('dashboard supports customer/project filters', 'backend/src/modules/materials/dto.ts', ['customerId?: string', 'projectModel?: string']),
      createCheck('dashboard export regression exists', 'scripts/verify-material-dashboard-export-api.cjs', [
        'material-dashboard-export',
        'material-project-models-test-fixture-filter'
      ]),
      createCheck('dashboard summary avoids long customer/BOM table text', 'frontend/src/views/MaterialsManagementView.vue', [
        'customerScopeLabel',
        'materialDashboardBomStructureDetails',
        'openBomStructureDetail'
      ]),
      createCheck('inventory material maintenance page exists', 'frontend/src/views/MaterialsView.vue', ['零件基础库', '新增零件'])
    ]
  },
  {
    key: 'P2',
    title: '零件包 / BOM',
    checks: [
      createCheck('ModelBom models exist', 'database/prisma/schema.prisma', ['model ModelBom', 'model ModelBomLine', 'model ModelBomCustomerScope']),
      createCheck('BOM revision snapshot model exists', 'database/prisma/schema.prisma', ['model ModelBomRevision']),
      createCheck('BOM scope approval model exists', 'database/prisma/schema.prisma', ['model ModelBomScopeApprovalRequest', 'usedAt']),
      createCheck('BOM diff review model exists', 'database/prisma/schema.prisma', ['model ModelBomDiffReview']),
      createCheck('BOM maintenance view exists', 'frontend/src/views/ModelBomsView.vue', ['机型零件包', 'BOM']),
      createCheck('BOM APIs exist', 'backend/src/modules/inventory/inventory.controller.ts', [
        'model-boms',
        'scope-approval-requests',
        'diff-reviews'
      ]),
      createCheck('BOM lines carry defaults', 'database/prisma/schema.prisma', ['defaultProcessRoute', 'defaultDrawingRevisionId', 'quantity']),
      createCheck('BOM common priority fields exist', 'database/prisma/schema.prisma', ['isCommon', 'commonSortOrder']),
      createCheck('BOM approval regression exists', 'scripts/verify-model-bom-scope-approval-api.cjs', ['includeTestFixtures=true', 'approve']),
      createCheck('BOM diff export regression exists', 'scripts/verify-model-bom-diff-reviews-export-api.cjs', ['diff-reviews', 'export'])
    ]
  },
  {
    key: 'P3',
    title: '订单和 Excel 接入',
    checks: [
      createCheck('orders service exists', 'backend/src/modules/orders/orders.service.ts', ['async create(dto: CreateOrderDto)', 'OrderStatus.DRAFT']),
      createCheck('order line editor uses material suggestions', 'frontend/src/components/OrderLineEditor.vue', ['MaterialSuggestionOption', 'customerId']),
      createCheck('order import sessions exist', 'database/prisma/schema.prisma', ['model OrderImportSession', 'model OrderImportFile']),
      createCheck('order import uses preview token/session', 'backend/src/modules/orders/orders.service.ts', ['previewToken', 'importSession']),
      createCheck('order import regression exists', 'scripts/verify-order-import-api.cjs', ['ERP上传净表', 'previewToken']),
      createCheck('material import session exists', 'database/prisma/schema.prisma', ['model MaterialImportSession', 'model MaterialImportRow']),
      createCheck('material import regression exists', 'scripts/verify-material-import-api.cjs', ['零件基础库', '适用范围']),
      createCheck('DRAFT order import does not submit production', 'backend/src/modules/orders/orders.service.ts', [
        'Excel 导入只保存 DRAFT 草稿',
        '不生成生产任务或库存扣减'
      ]),
      createCheck('BOM recommendation/API is connected to frontend API', 'frontend/src/api/erp.ts', ['modelBomsPage', '/inventory/materials/suggestions']),
      createCheck('Excel export format regression exists', 'scripts/verify-excel-export-format.cjs', [
        'xlsxFilename',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ])
    ]
  },
  {
    key: 'P4',
    title: '图纸版本和工序关系',
    checks: [
      createCheck('MaterialDrawingRevision model exists', 'database/prisma/schema.prisma', ['model MaterialDrawingRevision', 'drawingFileUrl']),
      createCheck('drawing upload API exists', 'backend/src/modules/inventory/inventory.controller.ts', ['material-drawings/upload']),
      createCheck('drawing management data regression exists', 'scripts/verify-material-drawing-management-api.cjs', [
        'material drawing revisions list must return existing business drawing versions',
        'material drawing revisions must keep exactly one enabled default drawing',
        'material drawing revisions export response must stay real xlsx'
      ]),
      createCheck('drawing revision export regression exists', 'scripts/verify-material-drawing-revisions-export-api.cjs', ['drawing-revisions', 'export']),
      createCheck('BOM line can specify drawing revision', 'database/prisma/schema.prisma', ['defaultDrawingRevisionId']),
      createCheck('order line keeps drawing snapshot', 'database/prisma/schema.prisma', ['drawingNo', 'drawingVersion', 'drawingDate']),
      createCheck('process definitions/templates exist', 'frontend/src/components/ProcessDefinitionManager.vue', ['标准工序']),
      createCheck('process drag-sort regression exists', 'scripts/verify-first-stage-source.cjs', ['verifyProcessStepDragSortWorkflow']),
      createCheck('order line process step snapshot exists', 'database/prisma/schema.prisma', ['model OrderLineProcessStep']),
      createCheck('inventory source details exist', 'backend/src/modules/inventory/inventory.controller.ts', ['source-details']),
      createCheck('drawing duplicate confirmation guard exists', 'scripts/verify-first-stage-source.cjs', ['verifyDrawingDuplicateConfirmationWorkflow'])
    ]
  },
  {
    key: 'P5',
    title: '体验优化和自动建议',
    checks: [
      createCheck('table height controls are guarded', 'scripts/verify-first-stage-source.cjs', ['verifyTableHeightButtonsHaveTitles']),
      createCheck('button accessibility guards exist', 'scripts/verify-first-stage-source.cjs', ['verifyIconOnlyButtonsHaveAccessibleNames']),
      createCheck('statistics month/quarter filters exist', 'frontend/src/views/StatisticsView.vue', ['selectedStatisticsQuarter', 'selectedStatisticsMonth']),
      createCheck('mobile read-only order detail cards exist', 'frontend/src/views/OrderDetailView.vue', ['line-card order-detail-line-card', 'isMobileLayout']),
      createCheck('mobile production workflow exists', 'frontend/src/views/ProductionView.vue', ['mobile-card']),
      createCheck('mobile warehouse workflow exists', 'frontend/src/views/WarehouseView.vue', ['mobile-card']),
      createCheck('source transform rule exists', 'database/prisma/schema.prisma', ['model MaterialTransformRule']),
      createCheck('material transform view/API exists', 'frontend/src/views/MaterialTransformsView.vue', ['来源加工关系']),
      createCheck('automatic suggestions remain opt-in/manual', 'AGENTS.md', ['自动建议排最后', '不得自动保存正式规则']),
      createCheck('fixture opt-in hidden from business UI', 'scripts/verify-first-stage-source.cjs', ['verifyFrontendDoesNotExposeTestFixtureOptIn'])
    ]
  }
];

const scoredPhases = phases.map(scorePhase);
const overallPercent = Math.round(scoredPhases.reduce((sum, phase) => sum + phase.percent, 0) / scoredPhases.length);
const outputJson = process.argv.includes('--json');

if (outputJson) {
  console.log(
    JSON.stringify(
      {
        overallPercent,
        phases: scoredPhases.map((phase) => ({
          key: phase.key,
          title: phase.title,
          percent: phase.percent,
          completed: phase.completed,
          total: phase.total,
          missing: phase.checks.filter((check) => !check.ok).map((check) => ({ label: check.label, file: check.file }))
        })),
        note: 'Progress is calculated from first-stage source checklist coverage, not final business acceptance.'
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(`百胜 ERP v0.2 第一阶段源码进度：${overallPercent}%`);
console.log('说明：该百分比来自源码 checklist 覆盖度，用于开发跟踪，不等同于最终业务验收。');
for (const phase of scoredPhases) {
  console.log(`- ${phase.key} ${phase.title}: ${phase.percent}% (${phase.completed}/${phase.total})`);
  const missing = phase.checks.filter((check) => !check.ok);
  if (missing.length > 0) {
    console.log(`  未覆盖：${missing.map((check) => check.label).join('；')}`);
  }
}
