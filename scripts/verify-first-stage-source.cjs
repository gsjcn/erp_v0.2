#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const failures = [];

const toProjectPath = (target) => path.relative(rootDir, target).replace(/\\/g, '/');
const resolveProjectPath = (target) => path.join(rootDir, target);

function addFailure(message) {
  failures.push(message);
}

function fileExists(projectPath) {
  return fs.existsSync(resolveProjectPath(projectPath));
}

function readFile(projectPath) {
  return fs.readFileSync(resolveProjectPath(projectPath), 'utf8');
}

function walkFiles(dir, output = []) {
  if (!fs.existsSync(dir)) {
    return output;
  }

  const ignoredDirs = new Set(['.git', '.vite', 'coverage', 'dist', 'node_modules']);
  const allowedExts = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx', '.vue']);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        walkFiles(fullPath, output);
      }
      continue;
    }

    if (entry.isFile() && allowedExts.has(path.extname(entry.name))) {
      output.push(fullPath);
    }
  }

  return output;
}

function sourceLineForIndex(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function verifyNoMojibakeInUserFacingSources() {
  const sourceFiles = [
    resolveProjectPath('README.md'),
    resolveProjectPath('AGENTS.md'),
    ...walkFiles(resolveProjectPath('backend/src')),
    ...walkFiles(resolveProjectPath('frontend/src'))
  ];
  const mojibakePattern =
    /[ÃÂ�]|锟|脙|脗|鈥|绗|\u95c3\u8235|\u95c3\u8236|寮€|涓€|瀵煎|璁㈠崟|鏂囦欢|缂栫爜|鍚嶇О|绮剧‘|鍖归厤|鍓嶇紑|鎷奸煶|鍥剧焊|瀹㈡埛|鍘嗗彶|搴撳瓨|鏉ユ簮|涔辩爜|淇|楠岃瘉|鏃犳硶|鏈壘|鎵惧埌|涓|尮閰|墿鏂|璇蜂粠|嬫媺|閫夋嫨|鏌ヨ|澶辫触|宸ヨ緭|闃绘柇/;
  for (const filePath of sourceFiles) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const match = mojibakePattern.exec(source);
    if (match) {
      addFailure(`User-facing source must not contain mojibake text: ${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)}`);
    }
  }
}

function verifyRequiredFiles() {
  const requiredFiles = [
    'frontend/src/components/CustomerSelect.vue',
    'frontend/src/components/DateRangeFilter.vue',
    'frontend/src/components/DrawingPreviewLink.vue',
    'frontend/src/components/NoticeAcknowledgeDialog.vue',
    'frontend/src/components/OrderNoLink.vue',
    'frontend/src/components/OrderSelect.vue',
    'frontend/src/config/navigation.ts',
    'frontend/src/layout/AppLayout.vue',
    'frontend/src/styles.css'
  ];

  for (const projectPath of requiredFiles) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing required first-stage source file: ${projectPath}`);
    }
  }
}

function verifyNavigation() {
  const navPath = 'frontend/src/config/navigation.ts';
  if (!fileExists(navPath)) {
    return;
  }

  const expectedLabels = ['客户', '订单', '生产流程', '流程记忆', '生产', '统计', '仓库', '库存'];
  const source = readFile(navPath);
  const labels = [...source.matchAll(/label:\s*['"`]([^'"`]+)['"`]/g)].map((match) => match[1]);

  if (labels.length !== expectedLabels.length) {
    addFailure(`Navigation should expose exactly ${expectedLabels.length} first-stage entries, found ${labels.length}.`);
    return;
  }

  for (let index = 0; index < expectedLabels.length; index += 1) {
    if (labels[index] !== expectedLabels[index]) {
      addFailure(`Navigation entry ${index + 1} should be "${expectedLabels[index]}", found "${labels[index]}".`);
    }
  }
}

function verifyResponsiveMobileBaseline() {
  const stylesPath = 'frontend/src/styles.css';
  const layoutPath = 'frontend/src/layout/AppLayout.vue';
  const dateRangePath = 'frontend/src/components/DateRangeFilter.vue';
  if (!fileExists(stylesPath)) {
    addFailure(`Missing global styles file: ${stylesPath}`);
    return;
  }
  if (!fileExists(layoutPath)) {
    addFailure(`Missing app layout file: ${layoutPath}`);
    return;
  }
  if (!fileExists(dateRangePath)) {
    addFailure(`Missing shared date range filter file: ${dateRangePath}`);
    return;
  }

  const stylesSource = readFile(stylesPath);
  const layoutSource = readFile(layoutPath);
  const dateRangeSource = readFile(dateRangePath);
  const requiredStyleSnippets = [
    'min-height: 100dvh',
    'env(safe-area-inset-left)',
    'env(safe-area-inset-right)',
    'env(safe-area-inset-top)',
    'env(safe-area-inset-bottom)',
    '@media (max-width: 900px)',
    '.mobile-nav-list',
    'overflow-x: auto',
    '-webkit-overflow-scrolling: touch',
    'scrollbar-width: none',
    '.filter-bar',
    'grid-template-columns: 1fr',
    '.filter-field .el-select',
    '.filter-field .el-date-editor',
    '.filter-field .el-input-number',
    'min-height: 44px',
    'font-size: 16px !important',
    '.desktop-table',
    'display: none',
    '.mobile-section',
    '.mobile-empty',
    'overflow-wrap: anywhere',
    '.el-dialog',
    'width: calc(100vw - 24px) !important',
    '.el-dialog__footer .el-button',
    '.el-popover.el-popper',
    'width: min(430px, calc(100vw - 24px)) !important',
    '.el-message .el-message__content',
    '.el-message-box__message',
    ".el-popper[role='tooltip']",
    'white-space: normal',
    '.el-select-dropdown__item',
    '.el-select-dropdown__item span',
    'height: auto',
    'line-height: 20px',
    '@media (hover: none) and (pointer: coarse)'
  ];
  for (const snippet of requiredStyleSnippets) {
    if (!stylesSource.includes(snippet)) {
      addFailure(`styles.css must keep first-stage mobile/responsive baseline snippet: ${snippet}`);
    }
  }

  if (!/\.table-card\s*{[\s\S]*overflow-x:\s*auto;[\s\S]*-webkit-overflow-scrolling:\s*touch;[\s\S]*}/.test(stylesSource)) {
    addFailure('styles.css must keep horizontal scrolling enabled for table-card on narrow screens.');
  }
  if (!/\.mobile-nav-item\s*{[\s\S]*min-height:\s*44px;[\s\S]*}/.test(stylesSource)) {
    addFailure('styles.css must keep mobile navigation items at least 44px high.');
  }
  if (!/\.el-input__wrapper,[\s\S]*\.el-select__wrapper,[\s\S]*min-height:\s*44px;/.test(stylesSource)) {
    addFailure('styles.css must keep Element Plus mobile input/select wrappers at least 44px high.');
  }

  const dateRangeSnippets = [
    'class="date-range-filter"',
    'min-height: 44px',
    '@media (max-width: 900px)',
    'font-size: 16px'
  ];
  for (const snippet of dateRangeSnippets) {
    if (!dateRangeSource.includes(snippet)) {
      addFailure(`DateRangeFilter.vue must keep mobile-friendly date range snippet: ${snippet}`);
    }
  }

  const requiredLayoutSnippets = [
    '<header class="mobile-header">',
    'class="mobile-nav-list"',
    'aria-label="移动端导航"',
    'scrollActiveMobileNavIntoView',
    "activeItem?.scrollIntoView({ block: 'nearest', inline: 'center' })"
  ];
  for (const snippet of requiredLayoutSnippets) {
    if (!layoutSource.includes(snippet)) {
      addFailure(`AppLayout.vue must keep mobile navigation baseline snippet: ${snippet}`);
    }
  }
}

function verifyNoNativeBrowserDialogs() {
  const scanRoots = ['frontend/src', 'backend/src', 'database/prisma']
    .map(resolveProjectPath)
    .filter((dir) => fs.existsSync(dir));

  const checks = [
    { name: 'window.prompt', pattern: /window\s*\.\s*prompt\s*\(/ },
    { name: 'window.confirm', pattern: /window\s*\.\s*confirm\s*\(/ },
    { name: 'window.alert', pattern: /window\s*\.\s*alert\s*\(/ },
    { name: 'prompt', pattern: /(^|[^\w$.])prompt\s*\(/ },
    { name: 'confirm', pattern: /(^|[^\w$.])confirm\s*\(/ },
    { name: 'alert', pattern: /(^|[^\w$.])alert\s*\(/ }
  ];

  for (const filePath of scanRoots.flatMap((dir) => walkFiles(dir))) {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const check of checks) {
        if (check.pattern.test(line)) {
          addFailure(
            `Native browser dialog "${check.name}" is not allowed: ${toProjectPath(filePath)}:${index + 1}`
          );
        }
      }
    });
  }
}

function verifyResponsiveElementPlusDialogs() {
  const frontendDir = resolveProjectPath('frontend/src');
  if (!fs.existsSync(frontendDir)) {
    return;
  }

  const dialogPattern = /<el-dialog\b[\s\S]*?>/g;
  for (const filePath of walkFiles(frontendDir)) {
    if (path.extname(filePath) !== '.vue') {
      continue;
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const lineStarts = [0];
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === '\n') {
        lineStarts.push(index + 1);
      }
    }

    for (const match of source.matchAll(dialogPattern)) {
      const dialogTag = match[0];
      if (dialogTag.includes('responsive-dialog')) {
        continue;
      }
      const lineNumber = lineStarts.filter((lineStart) => lineStart <= match.index).length;
      addFailure(`Element Plus dialog must include responsive-dialog class: ${toProjectPath(filePath)}:${lineNumber}`);
    }
  }
}

function verifyCustomerSelectOnlyShowsName() {
  const componentPath = 'frontend/src/components/CustomerSelect.vue';
  const servicePath = 'backend/src/modules/customers/customers.service.ts';
  if (!fileExists(componentPath)) {
    return;
  }

  const source = readFile(componentPath);
  const serviceSource = readFile(servicePath);
  const forbiddenDetails = ['customerCode', 'contactName', 'phone', 'mobile', 'province', 'city', 'address'];

  if (!/function\s+customerLabel\s*\([^)]*\)\s*{[\s\S]*return\s+customer\.customerName\s*;[\s\S]*}/.test(source)) {
    addFailure('CustomerSelect.vue should use customer.customerName as the option label.');
  }

  const template = source.match(/<template>([\s\S]*?)<\/template>/)?.[1] || '';
  if (template.includes('default-first-option')) {
    addFailure('CustomerSelect.vue must not enable default-first-option; similar customer names require explicit operator selection.');
  }
  for (const field of forbiddenDetails) {
    if (template.includes(field)) {
      addFailure(`CustomerSelect.vue option template should not expose customer detail field "${field}".`);
    }
  }

  const mobileTouchSnippets = ['min-height: 44px', 'class="customer-option"', '.customer-option strong', 'text-overflow: clip'];
  for (const snippet of mobileTouchSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`CustomerSelect.vue must keep mobile-friendly customer option snippet: ${snippet}`);
    }
  }

  const agentsSource = readFile('AGENTS.md');
  if (!agentsSource.includes('不得启用 `default-first-option`')) {
    addFailure('AGENTS.md must document CustomerSelect default-first-option safety rule.');
  }
  const customerSearchRankSnippets = [
    'compareCustomerSearchResults',
    'customerSearchRank',
    'customerCode === keyword',
    'customerName === keyword',
    'customerCode.startsWith(keyword)',
    'customerName.startsWith(keyword)',
    'pinyinSearchMatches([customer.customerName], keyword)'
  ];
  for (const snippet of customerSearchRankSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`CustomersService must keep ranked customer search snippet: ${snippet}`);
    }
  }
  if (!agentsSource.includes('客户搜索结果必须按命中强度排序')) {
    addFailure('AGENTS.md must document ranked customer search behavior.');
  }
}

function verifyOrderSelectDisplayContract() {
  const componentPath = 'frontend/src/components/OrderSelect.vue';
  if (!fileExists(componentPath)) {
    addFailure(`Missing shared order selector: ${componentPath}`);
    return;
  }

  const source = readFile(componentPath);
  const requiredSnippets = [
    ':label="order.orderNo"',
    'class="order-select-summary"',
    '{{ selectedOrder.customerName }}',
    'order.customerName',
    'order.customerSearchText',
    '@media (max-width: 900px)',
    'overflow-wrap: anywhere',
    'min-height: 64px',
    'return props.orders.filter((order) => orderMatchesKeyword(order, normalizedKeyword));'
  ];
  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`OrderSelect.vue must keep order selector display/search contract snippet: ${snippet}`);
    }
  }

  if (/:label="[^"]*customerName/.test(source)) {
    addFailure('OrderSelect.vue selected input label must stay orderNo-only; customer details belong in summary/options.');
  }
}

function verifyOrderFilterOrder() {
  const orderRelatedViews = [
    'frontend/src/views/OrdersListView.vue',
    'frontend/src/views/ProcessSelectionView.vue',
    'frontend/src/views/ProductionView.vue',
    'frontend/src/views/WarehouseView.vue'
  ];
  const requiredFilterImports = [
    {
      component: 'DateRangeFilter',
      pattern: /import\s+DateRangeFilter\s+from\s+['"]\.\.\/components\/DateRangeFilter\.vue['"]/
    },
    {
      component: 'CustomerSelect',
      pattern: /import\s+CustomerSelect\s+from\s+['"]\.\.\/components\/CustomerSelect\.vue['"]/
    },
    {
      component: 'OrderSelect',
      pattern: /import\s+OrderSelect\s+from\s+['"]\.\.\/components\/OrderSelect\.vue['"]/
    }
  ];

  for (const viewPath of orderRelatedViews) {
    if (!fileExists(viewPath)) {
      addFailure(`Missing order-related view: ${viewPath}`);
      continue;
    }

    const source = readFile(viewPath);
    for (const requiredImport of requiredFilterImports) {
      if (!requiredImport.pattern.test(source)) {
        addFailure(`${viewPath} must import shared ${requiredImport.component}.vue for order scope filters.`);
      }
    }

    const dateIndex = source.indexOf('<DateRangeFilter');
    const customerIndex = source.indexOf('<CustomerSelect');
    const orderIndex = source.indexOf('<OrderSelect');

    if (dateIndex === -1 || customerIndex === -1 || orderIndex === -1) {
      addFailure(`${viewPath} should use DateRangeFilter, CustomerSelect, and OrderSelect for order scope filters.`);
      continue;
    }

    if (!(dateIndex < customerIndex && customerIndex < orderIndex)) {
      addFailure(`${viewPath} filter order should be: 订单日期 -> 客户 -> 订单.`);
    }
  }
}

function readMigrationSqlSource() {
  const migrationsDir = resolveProjectPath('database/prisma/migrations');
  if (!fs.existsSync(migrationsDir)) {
    addFailure('Missing Prisma migrations directory: database/prisma/migrations');
    return '';
  }

  const migrationSqlFiles = [];
  for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const migrationPath = path.join(migrationsDir, entry.name, 'migration.sql');
    if (fs.existsSync(migrationPath)) {
      migrationSqlFiles.push(migrationPath);
    }
  }

  return migrationSqlFiles
    .sort()
    .map((migrationPath) => fs.readFileSync(migrationPath, 'utf8'))
    .join('\n');
}

function verifyCaseInsensitiveBusinessKeyContracts() {
  const customerServicePath = 'backend/src/modules/customers/customers.service.ts';
  const ordersServicePath = 'backend/src/modules/orders/orders.service.ts';
  const warehousesServicePath = 'backend/src/modules/warehouses/warehouses.service.ts';
  const schemaPath = 'database/prisma/schema.prisma';

  for (const projectPath of [customerServicePath, ordersServicePath, warehousesServicePath, schemaPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing business key contract source file: ${projectPath}`);
      return;
    }
  }

  const customerSource = readFile(customerServicePath);
  const ordersSource = readFile(ordersServicePath);
  const warehousesSource = readFile(warehousesServicePath);
  const schemaSource = readFile(schemaPath);
  const migrationSqlSource = readMigrationSqlSource();

  const customerSnippets = [
    "customerName: { equals: customerName, mode: 'insensitive' }",
    "customerCode: { equals: customerCode, mode: 'insensitive' }",
    'isDuplicateCustomerNameError',
    'isDuplicateCustomerCodeError',
    'Customer_customerName_lower_key',
    'Customer_customerCode_lower_key'
  ];
  for (const snippet of customerSnippets) {
    if (!customerSource.includes(snippet)) {
      addFailure(`CustomersService must keep case-insensitive customer key contract snippet: ${snippet}`);
    }
  }

  const orderSnippets = [
    'private normalizeOrderNo',
    'orderNo.trim().toUpperCase()',
    'tx.orderNoReservation.create',
    'tx.orderNoReservation.upsert',
    'orderNoNormalized',
    "orderNo: { equals: normalizedOrderNo, mode: 'insensitive' }",
    'isDuplicateOrderNoError',
    'isDuplicateOrderNoReservationError',
    'CustomerOrder_orderNo_lower_key',
    'OrderNoReservation_orderNoNormalized_key'
  ];
  for (const snippet of orderSnippets) {
    if (!ordersSource.includes(snippet)) {
      addFailure(`OrdersService must keep case-insensitive/permanent orderNo contract snippet: ${snippet}`);
    }
  }

  const warehouseSnippets = [
    'normalizeBusinessCode',
    'value?.trim().toUpperCase()',
    "warehouseCode: { equals: warehouseCode, mode: 'insensitive' }",
    "locationCode: { equals: locationCode, mode: 'insensitive' }",
    'isDuplicateWarehouseCodeError',
    'isDuplicateLocationCodeError',
    'Warehouse_warehouseCode_lower_key',
    'WarehouseLocation_warehouseId_locationCode_lower_key'
  ];
  for (const snippet of warehouseSnippets) {
    if (!warehousesSource.includes(snippet)) {
      addFailure(`WarehousesService must keep case-insensitive warehouse/location key contract snippet: ${snippet}`);
    }
  }

  const schemaSnippets = ['model OrderNoReservation', 'orderNoNormalized String   @unique'];
  for (const snippet of schemaSnippets) {
    if (!schemaSource.includes(snippet)) {
      addFailure(`schema.prisma must keep permanent order number reservation snippet: ${snippet}`);
    }
  }

  const migrationSnippets = [
    'Customer_customerName_lower_key',
    'LOWER("customerName")',
    'Customer_customerCode_lower_key',
    'LOWER("customerCode")',
    'CustomerOrder_orderNo_lower_key',
    'LOWER("orderNo")',
    'Warehouse_warehouseCode_lower_key',
    'LOWER("warehouseCode")',
    'WarehouseLocation_warehouseId_locationCode_lower_key',
    'LOWER("locationCode")',
    'OrderNoReservation_orderNoNormalized_key'
  ];
  for (const snippet of migrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep case-insensitive business key index/reservation snippet: ${snippet}`);
    }
  }
}

function verifyProductionTabOrder() {
  const viewPath = 'frontend/src/views/ProductionView.vue';
  if (!fileExists(viewPath)) {
    return;
  }

  const source = readFile(viewPath);
  const orderSummaryTabs = source.match(/<el-tabs\s+v-model="activeOrderStatus"[\s\S]*?<\/el-tabs>/)?.[0] || '';
  if (!orderSummaryTabs) {
    addFailure('ProductionView.vue should keep order summary status tabs with activeOrderStatus.');
    return;
  }

  const allIndex = orderSummaryTabs.indexOf('label="全部"');
  const activeIndex = orderSummaryTabs.indexOf('label="待处理"');
  if (allIndex === -1 || activeIndex === -1) {
    addFailure('ProductionView.vue order summary tabs should include both "全部" and "待处理".');
    return;
  }
  if (allIndex > activeIndex) {
    addFailure('ProductionView.vue order summary tabs should place "全部" before "待处理".');
  }
}

function verifyProductionOrderSummaryWorkflow() {
  const controllerPath = 'backend/src/modules/production/production.controller.ts';
  const servicePath = 'backend/src/modules/production/production.service.ts';
  const dtoPath = 'backend/src/modules/production/dto.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const typesPath = 'frontend/src/types/erp.ts';
  const viewPath = 'frontend/src/views/ProductionView.vue';

  for (const projectPath of [controllerPath, servicePath, dtoPath, apiPath, typesPath, viewPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing production order summary workflow file: ${projectPath}`);
      return;
    }
  }

  const controllerSource = readFile(controllerPath);
  if (!controllerSource.includes("@Get('order-summary')") || !controllerSource.includes('return this.productionService.orderSummary(query);')) {
    addFailure('ProductionController must expose GET /production/tasks/order-summary backed by ProductionService.orderSummary(query).');
  }
  if (!controllerSource.includes("@Post('batch-start')") || !controllerSource.includes('return this.productionService.batchStart(dto);')) {
    addFailure('ProductionController must expose POST /production/tasks/batch-start backed by ProductionService.batchStart(dto).');
  }

  const dtoSource = readFile(dtoPath);
  const batchDtoSnippets = [
    'export class BatchStartProductionDto',
    '@ArrayMinSize(1)',
    'taskIds!: string[]',
    'supervisorCode!: string'
  ];
  for (const snippet of batchDtoSnippets) {
    if (!dtoSource.includes(snippet)) {
      addFailure(`BatchStartProductionDto must keep batch start validation snippet: ${snippet}`);
    }
  }

  const serviceSource = readFile(servicePath);
  const orderSummarySnippets = [
    'async orderSummary(query: ProductionTaskQueryDto)',
    'where: this.buildTaskWhere(query)',
    'pendingTasks: []',
    'quantityByUnit: new Map',
    'progressItems: Array.from',
    'pendingTaskIds: summary.pendingTaskIds',
    'pendingTasks: summary.pendingTasks',
    'this.resolveOrderSummaryStatus(summary)',
    'private productionDisplayStatus',
    'private orderSummaryProgressLabel'
  ];
  for (const snippet of orderSummarySnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`ProductionService.orderSummary must keep first-stage order aggregation snippet: ${snippet}`);
    }
  }

  const batchStartSnippets = [
    'async batchStart(dto: BatchStartProductionDto)',
    'resolveWorkshopSupervisor(dto.supervisorCode)',
    'runSerializableTransaction',
    'orderIds.size !== 1',
    'task.order.status === OrderStatus.CANCELLED',
    'task.inventoryBatch',
    'task.status !== ProductionStatus.PENDING',
    'status: ProductionStatus.IN_PROGRESS',
    'await this.markOrderInProduction(tx, tasks[0].orderId)'
  ];
  for (const snippet of batchStartSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`ProductionService.batchStart must keep supervisor, transaction, and task-state validation snippet: ${snippet}`);
    }
  }

  const apiSource = readFile(apiPath);
  if (!apiSource.includes('productionOrderSummaries(filters: ProductionTaskFilters = {})') || !apiSource.includes('/production/tasks/order-summary')) {
    addFailure('frontend api must expose productionOrderSummaries() for the order summary homepage.');
  }
  if (!apiSource.includes('batchStartProduction(payload: BatchStartProductionPayload)') || !apiSource.includes('/production/tasks/batch-start')) {
    addFailure('frontend api must expose batchStartProduction() for batch starting order tasks.');
  }

  const typesSource = readFile(typesPath);
  const typeSnippets = [
    'export interface ProductionOrderSummary',
    'pendingTaskIds: string[]',
    'pendingTasks: ProductionOrderSummaryTask[]',
    'progressItems?: ProductionOrderSummaryProgressItem[]',
    "export type ProductionOrderSummaryStatus = ProductionStatus | 'READY_TO_COMPLETE' | 'RECEIVED'"
  ];
  for (const snippet of typeSnippets) {
    if (!typesSource.includes(snippet)) {
      addFailure(`frontend production summary types must keep snippet: ${snippet}`);
    }
  }

  const viewSource = readFile(viewPath);
  const viewSnippets = [
    "const viewMode = ref<ProductionViewMode>('ORDER_SUMMARY')",
    '<el-radio-button value="ORDER_SUMMARY">订单汇总</el-radio-button>',
    '<el-radio-button value="TASK_DETAIL">零件任务明细</el-radio-button>',
    'orderSummaries.value = await erpApi.productionOrderSummaries(taskQueryParams())',
    'v-model="batchStartVisible"',
    'v-model="batchStartSupervisorCode"',
    'v-model="batchStartSelectedTaskIds"',
    'openBatchStartForOrder',
    'openBatchStartForCurrentOrder',
    'openBatchStartForSelected',
    'erpApi.batchStartProduction',
    'Promise.all([loadTasks(), loadOrderSummaries()])'
  ];
  for (const snippet of viewSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`ProductionView.vue must keep order summary and batch start UI snippet: ${snippet}`);
    }
  }
}

function verifyProductionOperatorSearchWorkflow() {
  const controllerPath = 'backend/src/modules/production/production.controller.ts';
  const servicePath = 'backend/src/modules/production/production.service.ts';
  const viewPath = 'frontend/src/views/ProductionView.vue';
  const apiPath = 'frontend/src/api/erp.ts';
  const seedPath = 'database/prisma/seed.ts';

  for (const projectPath of [controllerPath, servicePath, viewPath, apiPath, seedPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing production operator workflow file: ${projectPath}`);
      return;
    }
  }

  const controllerSource = readFile(controllerPath);
  if (!controllerSource.includes("@Get('operators')") || !controllerSource.includes('return this.productionService.operators(query);')) {
    addFailure('ProductionController must expose GET /production/tasks/operators backed by ProductionService.operators(query).');
  }

  const serviceSource = readFile(servicePath);
  const backendSnippets = [
    'async operators(query: ProductionOperatorQueryDto = {})',
    'await this.loadProductionOperators()',
    'this.normalizeOperatorKeyword(query.keyword || \'\')',
    'operators.filter((operator) => this.operatorMatchesKeyword(operator, keyword))',
    'this.prisma.productionOperator.findMany',
    "where: { status: 'ENABLED' }",
    'fallbackProductionOperators',
    'operator.pinyin',
    'operator.pinyinInitials',
    '...(operator.keywords || [])',
    '逐字段匹配，避免把多个字段拼接后产生跨字段误命中；例如 zm 不应命中顾胜钧',
    'role.includes(\'车间主任\')',
    'role.includes(\'车间主管\')',
    '开始生产和确认生产只能由车间主任操作',
    '已完成发货订单不能开始新的生产任务'
  ];
  for (const snippet of backendSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`ProductionService must keep operator search/role guard snippet: ${snippet}`);
    }
  }

  const apiSource = readFile(apiPath);
  if (!apiSource.includes('productionOperators(keyword?: string)') || !apiSource.includes('/production/tasks/operators')) {
    addFailure('frontend api must expose productionOperators(keyword) backed by /production/tasks/operators.');
  }

  const viewSource = readFile(viewPath);
  const frontendSnippets = [
    'operatorOptionsByScope',
    'operatorKeywordByScope',
    'operatorSearchRequestByScope',
    'operatorMatchesLocalKeyword',
    'operatorOptionRowsWithSelectedCodes',
    'supervisorOptionRowsWithSelectedCode',
    'searchOperatorsForScope',
    'erpApi.productionOperators(keyword.trim())',
    'setOperatorOptionsForScope(',
    '远程搜索返回前先用本地缓存做一次精确过滤，避免下拉框短暂显示不匹配的旧候选',
    '未输入关键字时补齐已选人员，确保下拉重新打开仍能显示已选账号的完整名称和角色',
    'handleBatchStartSupervisorSelectVisible'
  ];
  for (const snippet of frontendSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`ProductionView.vue must keep remote operator search/cache snippet: ${snippet}`);
    }
  }

  const seedSource = readFile(seedPath);
  const seedSnippets = [
    'productionOperatorSeeds',
    "accountId: 'PLAN-001'",
    "role: '生产计划员'",
    "accountId: 'ORDER-001'",
    "role: '下单管理员'",
    "accountId: 'WS-001'",
    "role: '车间主任'",
    "accountId: 'TECH-001'",
    "role: '技术工艺员'",
    "pinyinInitials: 'gsj'",
    "idCardMasked: '3204********1234'",
    'seedProductionOperators'
  ];
  for (const snippet of seedSnippets) {
    if (!seedSource.includes(snippet)) {
      addFailure(`seed.ts must keep first-stage production operator seed snippet: ${snippet}`);
    }
  }
}

function verifyPlannerProcessAndSubmitGuard() {
  const dtoPath = 'backend/src/modules/orders/dto.ts';
  const controllerPath = 'backend/src/modules/orders/orders.controller.ts';
  const servicePath = 'backend/src/modules/orders/orders.service.ts';
  const processViewPath = 'frontend/src/views/ProcessSelectionView.vue';
  const orderDetailPath = 'frontend/src/views/OrderDetailView.vue';
  const apiPath = 'frontend/src/api/erp.ts';
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  const seedPath = 'database/prisma/seed.ts';

  for (const projectPath of [dtoPath, controllerPath, servicePath, processViewPath, orderDetailPath, apiPath, verifierPath, seedPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing planner process/submit guard file: ${projectPath}`);
      return;
    }
  }

  const dtoSource = readFile(dtoPath);
  const dtoSnippets = [
    'export class UpdateLineProcessDto',
    'configuredByCode!: string',
    'export class SubmitOrderDto',
    'submittedByCode!: string'
  ];
  for (const snippet of dtoSnippets) {
    if (!dtoSource.includes(snippet)) {
      addFailure(`orders dto must keep planner/process operator payload snippet: ${snippet}`);
    }
  }

  const controllerSource = readFile(controllerPath);
  const controllerSnippets = [
    "@Patch(':orderNo/lines/:lineId/process')",
    'return this.ordersService.updateLineProcess(orderNo, lineId, dto)',
    "@Post(':orderNo/submit')",
    'return this.ordersService.submit(orderNo, dto)'
  ];
  for (const snippet of controllerSnippets) {
    if (!controllerSource.includes(snippet)) {
      addFailure(`OrdersController must keep planner-only process/submit endpoint snippet: ${snippet}`);
    }
  }

  const serviceSource = readFile(servicePath);
  const serviceSnippets = [
    'async updateLineProcess(orderNo: string, lineId: string, dto: UpdateLineProcessDto)',
    'const processEditor = await this.resolveProcessEditorOperator(dto.configuredByCode);',
    '只有待提交生产订单可以修改生产流程',
    '生产流程填写：${processEditor.name}',
    'async submit(orderNo: string, dto: SubmitOrderDto)',
    "const submitOperator = await this.resolveSubmitPlanOperatorFromClient(tx, dto.submittedByCode, '下单/计划操作员');",
    '只有待提交生产订单可以提交生产',
    '提交生产：${submitOperator.name}',
    'submitMaterialIdentityConfirmationRemark',
    '同编码多套历史资料已核对',
    'private async resolveSubmitPlanOperatorFromClient',
    '车间人员只能查看生产流程',
    'private async resolveProcessEditorOperator',
    '生产流程只能由下单/计划管理人员填写，车间人员只能查看生产流程',
    'private isSubmitPlanOperatorRole',
    'return /计划|下单|订单/.test(value) && !/车间|主任|技术|工艺/.test(value);',
    'private isProcessEditorRole',
    'return /计划|下单|订单/.test(value) && !/车间|主任|技术|工艺|操作员/.test(value);'
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`OrdersService must keep planner-only process/submit guard snippet: ${snippet}`);
    }
  }
  if (
    !/async\s+updateLineProcess\s*\([^)]*\)\s*{[\s\S]*order\.status !== OrderStatus\.DRAFT[\s\S]*normalizeProcessSteps\(dto\.steps,\s*true\)[\s\S]*resolveProcessEditorOperator\(dto\.configuredByCode\)/.test(
      serviceSource
    )
  ) {
    addFailure('OrdersService.updateLineProcess must reject non-draft orders before validating process steps or the process editor operator.');
  }
  if (
    !/async\s+submit\s*\([^)]*\)\s*{[\s\S]*order\.status !== OrderStatus\.DRAFT[\s\S]*resolveSubmitPlanOperatorFromClient\(tx,\s*dto\.submittedByCode,\s*'下单\/计划操作员'\)/.test(
      serviceSource
    )
  ) {
    addFailure('OrdersService.submit must reject non-draft orders before validating the submit operator.');
  }

  const processViewSource = readFile(processViewPath);
  const processViewSnippets = [
    'const processEditorCode = ref(\'\');',
    'placeholder="选择下单/计划人员，车间人员只能查看"',
    'const canEditProcessBase = computed(() => order.value?.status === \'DRAFT\'',
    'const canEditProcess = computed(() => canEditProcessBase.value && Boolean(processEditorCode.value))',
    '请先选择下单/计划流程填写人员，选择后才可编辑工序。',
    'configuredByCode: processEditorCode.value',
    'submittedByCode: submitPlanOperatorCode.value',
    'processEditorOperators.value = operators.filter(isProcessEditorOperator)',
    'submitPlanOperators.value = operators.filter(isSubmitPlanOperator)',
    'function isSubmitPlanOperator(operator: ProductionOperator)',
    'return /计划|下单|订单/.test(role) && !/车间|主任|技术|工艺/.test(role);',
    'function isProcessEditorOperator(operator: ProductionOperator)',
    'return /计划|下单|订单/.test(role) && !/车间|主任|技术|工艺|操作员/.test(role);'
  ];
  for (const snippet of processViewSnippets) {
    if (!processViewSource.includes(snippet)) {
      addFailure(`ProcessSelectionView.vue must keep planner-only process/submit UI guard snippet: ${snippet}`);
    }
  }

  const orderDetailSource = readFile(orderDetailPath);
  const orderDetailSnippets = [
    'submitPlanOperators.value = operators.filter(isSubmitPlanOperator)',
    'submittedByCode: submitPlanOperatorCode.value',
    'function isSubmitPlanOperator(operator: ProductionOperator)',
    'return /计划|下单|订单/.test(role) && !/车间|主任|技术|工艺/.test(role);',
    '只有待提交生产订单允许提交生产'
  ];
  for (const snippet of orderDetailSnippets) {
    if (!orderDetailSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must keep planner-only submit UI guard snippet: ${snippet}`);
    }
  }

  const apiSource = readFile(apiPath);
  const apiSnippets = [
    'export interface UpdateLineProcessPayload',
    'configuredByCode: string',
    'export interface SubmitOrderPayload',
    'submittedByCode: string',
    'updateLineProcess(orderNo: string, lineId: string, payload: UpdateLineProcessPayload)',
    'submitOrder(orderNo: string, payload: SubmitOrderPayload)'
  ];
  for (const snippet of apiSnippets) {
    if (!apiSource.includes(snippet)) {
      addFailure(`frontend api must keep planner-only process/submit payload snippet: ${snippet}`);
    }
  }

  const verifierSource = readFile(verifierPath);
  const verifierSnippets = [
    'PRODUCTION_OPERATOR_PLANNER_MISSING',
    'PLAN_OVERRIDE_OPERATOR_ROLE_INVALID',
    'isSubmitPlanOperatorRole(operator.role)'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep planner role verification snippet: ${snippet}`);
    }
  }

  const seedSource = readFile(seedPath);
  const seedSnippets = [
    "role: '生产计划员'",
    "role: '下单管理员'",
    "role: '车间主任'",
    "role: '技术工艺员'"
  ];
  for (const snippet of seedSnippets) {
    if (!seedSource.includes(snippet)) {
      addFailure(`seed.ts must keep planner/workshop operator seed role snippet: ${snippet}`);
    }
  }
}

function verifyProcessPinyinSearchWorkflow() {
  const frontendPinyinPath = 'frontend/src/utils/pinyinSearch.ts';
  const processViewPath = 'frontend/src/views/ProcessSelectionView.vue';
  const templateManagerPath = 'frontend/src/components/ProcessTemplateManager.vue';
  const processDefinitionsServicePath = 'backend/src/modules/process-definitions/process-definitions.service.ts';
  const processTemplatesServicePath = 'backend/src/modules/process-templates/process-templates.service.ts';
  const backendPinyinPath = 'backend/src/common/pinyin-search.ts';

  for (const projectPath of [
    frontendPinyinPath,
    processViewPath,
    templateManagerPath,
    processDefinitionsServicePath,
    processTemplatesServicePath,
    backendPinyinPath
  ]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing process pinyin search workflow file: ${projectPath}`);
      return;
    }
  }

  const frontendPinyinSource = readFile(frontendPinyinPath);
  const backendPinyinSource = readFile(backendPinyinPath);
  const pinyinSnippets = [
    "type PinyinSearchEntryType = 'raw' | 'fullPinyin' | 'initials' | 'syllable'",
    "toPinyinTokens(value, 'first')",
    "entry.type === 'syllable'",
    'keyword.length <= 3',
    'isCodeLikeKeyword(keyword)',
    'isSubsequenceSearchMatch(entry.value, keyword)',
    'export function pinyinSearchMatches'
  ];
  for (const snippet of pinyinSnippets) {
    if (!frontendPinyinSource.includes(snippet)) {
      addFailure(`frontend pinyinSearch.ts must keep process/customer pinyin search snippet: ${snippet}`);
    }
    if (!backendPinyinSource.includes(snippet)) {
      addFailure(`backend pinyin-search.ts must keep process/customer pinyin search snippet: ${snippet}`);
    }
  }

  const processViewSource = readFile(processViewPath);
  const processViewSnippets = [
    "import { filterPinyinSearchOptions } from '../utils/pinyinSearch';",
    'const filteredQuickProcessOptions = computed(() => filterPinyinSearchOptions(processOptions.value, quickProcessFilterKeyword.value))',
    'const filteredProcessOptions = computed(() => filterPinyinSearchOptions(processOptions.value, draftProcessFilterKeyword.value))',
    ':filter-method="handleDraftProcessFilter"',
    'quickProcessFilterKeyword'
  ];
  for (const snippet of processViewSnippets) {
    if (!processViewSource.includes(snippet)) {
      addFailure(`ProcessSelectionView.vue must keep process pinyin/initial search snippet: ${snippet}`);
    }
  }

  const templateManagerSource = readFile(templateManagerPath);
  const templateManagerSnippets = [
    "import { filterPinyinSearchOptions } from '../utils/pinyinSearch';",
    'const filteredDynamicProcessOptions = computed(() => filterPinyinSearchOptions(dynamicProcessOptions.value, templateProcessFilterKeyword.value))',
    'const filteredNewStepOptions = computed(() => filterPinyinSearchOptions(availableNewStepOptions.value, newStepProcessFilterKeyword.value))',
    ':filter-method="handleTemplateProcessFilter"',
    ':filter-method="handleNewStepProcessFilter"',
    'erpApi.processTemplates(keyword.value.trim() || undefined)'
  ];
  for (const snippet of templateManagerSnippets) {
    if (!templateManagerSource.includes(snippet)) {
      addFailure(`ProcessTemplateManager.vue must keep process/template pinyin search snippet: ${snippet}`);
    }
  }

  const processDefinitionsSource = readFile(processDefinitionsServicePath);
  const processDefinitionsSnippets = [
    'import { buildPinyinSearchText, normalizeSearchKeyword, pinyinSearchMatches }',
    'rows.filter((row) => pinyinSearchMatches([row.processName, row.remark], keyword))',
    'searchText: this.buildSearchText(processName, remark)',
    'return buildPinyinSearchText([processName, remark]);'
  ];
  for (const snippet of processDefinitionsSnippets) {
    if (!processDefinitionsSource.includes(snippet)) {
      addFailure(`ProcessDefinitionsService must keep process pinyin search snippet: ${snippet}`);
    }
  }

  const processTemplatesSource = readFile(processTemplatesServicePath);
  const processTemplatesSnippets = [
    'import { buildPinyinSearchText, normalizeSearchKeyword, pinyinSearchMatches }',
    'templates.filter((template) => this.templateMatchesKeyword(template, keyword))',
    'searchText: this.buildSearchText(templateName, steps, remark)',
    '...steps.flatMap((step) => [step.processName, step.processRemark])',
    'return pinyinSearchMatches('
  ];
  for (const snippet of processTemplatesSnippets) {
    if (!processTemplatesSource.includes(snippet)) {
      addFailure(`ProcessTemplatesService must keep template pinyin search snippet: ${snippet}`);
    }
  }
}

function verifyMaterialSuggestionSearchWorkflow() {
  const dtoPath = 'backend/src/modules/inventory/dto.ts';
  const orderDtoPath = 'backend/src/modules/orders/dto.ts';
  const servicePath = 'backend/src/modules/inventory/inventory.service.ts';
  const controllerPath = 'backend/src/modules/inventory/inventory.controller.ts';
  const editorPath = 'frontend/src/components/OrderLineEditor.vue';
  const inventorySourceDetailsPath = 'frontend/src/components/InventorySourceDetailsDialog.vue';
  const inventoryViewPath = 'frontend/src/views/InventoryView.vue';
  const materialSuggestionOptionPath = 'frontend/src/components/MaterialSuggestionOption.vue';
  const apiPath = 'frontend/src/api/erp.ts';
  const typesPath = 'frontend/src/types/erp.ts';
  const ordersViewPath = 'frontend/src/views/OrdersListView.vue';
  const orderDetailPath = 'frontend/src/views/OrderDetailView.vue';
  const orderServicePath = 'backend/src/modules/orders/orders.service.ts';
  const agentsPath = 'AGENTS.md';
  const orderImportApiVerifyPath = 'scripts/verify-order-import-api.cjs';

  for (const projectPath of [
    dtoPath,
    orderDtoPath,
    servicePath,
    controllerPath,
    editorPath,
    inventorySourceDetailsPath,
    inventoryViewPath,
    materialSuggestionOptionPath,
    apiPath,
    typesPath,
    ordersViewPath,
    orderDetailPath,
    orderServicePath,
    agentsPath,
    orderImportApiVerifyPath
  ]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing material suggestion search workflow file: ${projectPath}`);
      return;
    }
  }

  const dtoSource = readFile(dtoPath);
  const orderDtoSource = readFile(orderDtoPath);
  const serviceSource = readFile(servicePath);
  const controllerSource = readFile(controllerPath);
  const editorSource = readFile(editorPath);
  const inventorySourceDetailsSource = readFile(inventorySourceDetailsPath);
  const inventoryViewSource = readFile(inventoryViewPath);
  const materialSuggestionOptionSource = readFile(materialSuggestionOptionPath);
  const apiSource = readFile(apiPath);
  const typesSource = readFile(typesPath);
  const ordersViewSource = readFile(ordersViewPath);
  const orderDetailSource = readFile(orderDetailPath);
  const orderServiceSource = readFile(orderServicePath);
  const agentsSource = readFile(agentsPath);
  const orderImportApiVerifySource = readFile(orderImportApiVerifyPath);

  const requiredSnippets = [
    { source: dtoSource, file: dtoPath, snippet: 'customerId?: string;' },
    { source: dtoSource, file: dtoPath, snippet: 'export class MaterialQueryDto' },
    { source: dtoSource, file: dtoPath, snippet: 'export class UpdateMaterialDto' },
    { source: orderDtoSource, file: orderDtoPath, snippet: 'materialIdentityConfirmed?: boolean;' },
    { source: controllerSource, file: controllerPath, snippet: "@Get('materials')" },
    { source: controllerSource, file: controllerPath, snippet: "@Patch('materials/:materialId')" },
    { source: controllerSource, file: controllerPath, snippet: "@Delete('materials/:materialId')" },
    { source: serviceSource, file: servicePath, snippet: 'private async findMaterialSuggestionHistory' },
    { source: serviceSource, file: servicePath, snippet: 'private materialHistoryLineMatchesKeyword' },
    { source: serviceSource, file: servicePath, snippet: 'private materialSuggestionSearchMatch' },
    { source: serviceSource, file: servicePath, snippet: 'searchMatchRank' },
    { source: serviceSource, file: servicePath, snippet: "searchMatchText: '编码缩写匹配'" },
    { source: serviceSource, file: servicePath, snippet: "searchMatchText: '名称前缀匹配'" },
    { source: serviceSource, file: servicePath, snippet: "searchMatchText: '名称包含匹配'" },
    { source: serviceSource, file: servicePath, snippet: 'where: !normalizedKeyword && customerId ? { order: { customerId } } : {}' },
    { source: serviceSource, file: servicePath, snippet: 'customerUsageCount' },
    { source: serviceSource, file: servicePath, snippet: 'lastCustomerOrderDateDiff' },
    { source: serviceSource, file: servicePath, snippet: 'private sortableDateValue' },
    { source: serviceSource, file: servicePath, snippet: 'hasQueryCustomerHistory' },
    { source: serviceSource, file: servicePath, snippet: 'lastCustomerOrderBelongsToQueryCustomer' },
    { source: serviceSource, file: servicePath, snippet: 'queryCustomerSnapshotOrderDate' },
    { source: serviceSource, file: servicePath, snippet: 'identityKeys: new Set<string>()' },
    { source: serviceSource, file: servicePath, snippet: 'identityFieldValues: new Map<string, Set<string>>()' },
    { source: serviceSource, file: servicePath, snippet: 'identityVariantCount: history?.identityVariantCount || 0' },
    { source: serviceSource, file: servicePath, snippet: 'hasIdentityConflict: Boolean((history?.identityVariantCount || 0) > 1)' },
    { source: serviceSource, file: servicePath, snippet: 'identityConflictFields: this.materialSuggestionIdentityConflictFields(history)' },
    { source: serviceSource, file: servicePath, snippet: 'const materialSuggestionIdentityFieldLabels' },
    { source: serviceSource, file: servicePath, snippet: 'private materialSuggestionIdentityConflictFields' },
    { source: serviceSource, file: servicePath, snippet: 'lineBelongsToQueryCustomer' },
    { source: serviceSource, file: servicePath, snippet: 'const useQueryCustomerSnapshot = Boolean(customerId && history?.hasQueryCustomerHistory)' },
    { source: serviceSource, file: servicePath, snippet: 'private recordMaterialSuggestionIdentity' },
    { source: serviceSource, file: servicePath, snippet: 'private materialSuggestionIdentityValues' },
    { source: serviceSource, file: servicePath, snippet: 'existing.identityVariantCount = this.recordMaterialSuggestionIdentity(existing, line)' },
    { source: serviceSource, file: servicePath, snippet: 'private applyMaterialSuggestionHistorySnapshot' },
    { source: serviceSource, file: servicePath, snippet: 'private isMaterialSuggestionHistorySnapshotNewer' },
    { source: serviceSource, file: servicePath, snippet: 'this.applyMaterialSuggestionHistorySnapshot(existing, line)' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'type OrderLineMaterialIdentityInfo' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'private async getOrderLineMaterialIdentityInfoByPartCode' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'private recordOrderLineMaterialIdentity' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'private orderLineMaterialIdentityValues' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'materialIdentityInfoByPartCode' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'materialHasIdentityConflict' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'materialIdentityConflictFields' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'private assertSubmitMaterialIdentityConfirmed' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'private submitMaterialIdentityConfirmationRemark' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'dto.materialIdentityConfirmed' },
    { source: orderServiceSource, file: orderServicePath, snippet: '发现同编码多套历史资料零件，提交生产前必须确认已核对' },
    { source: orderServiceSource, file: orderServicePath, snippet: '同编码多套历史资料已核对' },
    { source: orderServiceSource, file: orderServicePath, snippet: 'submitOperator.name}（${submitOperator.accountId} / ${submitOperator.role}）；' },
    { source: serviceSource, file: servicePath, snippet: 'customerCode: true' },
    { source: serviceSource, file: servicePath, snippet: 'matchedCustomerCode' },
    { source: serviceSource, file: servicePath, snippet: 'matchedCustomerName' },
    { source: serviceSource, file: servicePath, snippet: 'matchedHistoryOrderNo' },
    { source: serviceSource, file: servicePath, snippet: 'historyCustomerNames' },
    { source: serviceSource, file: servicePath, snippet: 'hasCurrentCustomerHistory: Boolean(history?.hasQueryCustomerHistory)' },
    { source: serviceSource, file: servicePath, snippet: 'line.drawingNo' },
    { source: serviceSource, file: servicePath, snippet: 'line.projectModel' },
    { source: serviceSource, file: servicePath, snippet: 'line.order.orderNo' },
    { source: serviceSource, file: servicePath, snippet: 'material.drawingNo' },
    { source: serviceSource, file: servicePath, snippet: 'private materialDateSearchValues' },
    { source: serviceSource, file: servicePath, snippet: '...this.materialDateSearchValues(line.drawingDate)' },
    { source: serviceSource, file: servicePath, snippet: '...this.materialDateSearchValues(material.drawingDate)' },
    { source: serviceSource, file: servicePath, snippet: 'material.projectModel' },
    { source: serviceSource, file: servicePath, snippet: 'private materialThicknessSearchValues' },
    { source: serviceSource, file: servicePath, snippet: 'for (const precision of [0, 1, 2, 3, 4])' },
    { source: serviceSource, file: servicePath, snippet: 'values.add(`${text}mm`)' },
    { source: serviceSource, file: servicePath, snippet: '...this.materialThicknessSearchValues(line.partThickness)' },
    { source: serviceSource, file: servicePath, snippet: '...this.materialThicknessSearchValues(material.partThickness)' },
    { source: serviceSource, file: servicePath, snippet: "searchMatchText: '图纸资料匹配'" },
    { source: serviceSource, file: servicePath, snippet: "searchMatchText: '历史订单匹配'" },
    { source: serviceSource, file: servicePath, snippet: 'if (!keyword && !customerId)' },
    { source: serviceSource, file: servicePath, snippet: 'const shouldSeedMaterialMaster = Boolean(keyword);' },
    { source: serviceSource, file: servicePath, snippet: 'disabledMaterialCodes.has(key)' },
    { source: serviceSource, file: servicePath, snippet: 'const suggestionMaterials = [...materialRows.values()].filter' },
    { source: serviceSource, file: servicePath, snippet: "sourceType === 'ALL' || item.availableQuantity > 0" },
    { source: serviceSource, file: servicePath, snippet: 'partThickness: line.partThickness ? decimalToNumber(line.partThickness) : null' },
    { source: serviceSource, file: servicePath, snippet: 'drawingDate: this.formatDateOnly(drawingDate)' },
    { source: serviceSource, file: servicePath, snippet: 'async materials(query: MaterialQueryDto)' },
    { source: serviceSource, file: servicePath, snippet: 'const historyByCode = normalizedKeyword' },
    { source: serviceSource, file: servicePath, snippet: 'historyByCode.has(material.partCode.trim().toLocaleLowerCase())' },
    { source: serviceSource, file: servicePath, snippet: 'async updateMaterial(materialId: string, dto: UpdateMaterialDto)' },
    { source: serviceSource, file: servicePath, snippet: "data: { status: 'DISABLED' }" },
    { source: editorSource, file: editorPath, snippet: 'placeholder="编码/名称/拼音/图号/厚度/客户"' },
    { source: editorSource, file: editorPath, snippet: 'placeholder="名称/编码/拼音/图号/厚度/客户"' },
    { source: editorSource, file: editorPath, snippet: 'value-key="partName"' },
    { source: editorSource, file: editorPath, snippet: ':debounce="250"' },
    { source: editorSource, file: editorPath, snippet: ':trigger-on-focus="true"' },
    { source: editorSource, file: editorPath, snippet: 'if (!normalizedKeyword && !props.customerId?.trim())' },
    { source: editorSource, file: editorPath, snippet: "import MaterialSuggestionOption from './MaterialSuggestionOption.vue';" },
    { source: editorSource, file: editorPath, snippet: '<MaterialSuggestionOption :item="item" />' },
    { source: editorSource, file: editorPath, snippet: 'function handlePartNameInput' },
    { source: editorSource, file: editorPath, snippet: 'function fillExactMaterialFromInput' },
    { source: editorSource, file: editorPath, snippet: "normalizeMaterialSuggestionValue(line[field]) !== normalizeMaterialSuggestionValue(keyword)" },
    { source: editorSource, file: editorPath, snippet: 'const exactMatches = suggestions.filter' },
    { source: editorSource, file: editorPath, snippet: 'exactMatches.length === 1' },
    { source: editorSource, file: editorPath, snippet: 'function canAutoFillMaterialSuggestion' },
    { source: editorSource, file: editorPath, snippet: 'return !item.hasIdentityConflict;' },
    { source: editorSource, file: editorPath, snippet: 'function warnMaterialSuggestionNeedsManualPick' },
    { source: editorSource, file: editorPath, snippet: 'const materialIdentityWarnings = new WeakMap' },
    { source: editorSource, file: editorPath, snippet: 'function materialIdentityWarningText' },
    { source: editorSource, file: editorPath, snippet: 'function materialIdentityConflictFieldsText' },
    { source: editorSource, file: editorPath, snippet: 'function setMaterialIdentityWarning' },
    { source: editorSource, file: editorPath, snippet: 'function clearMaterialIdentityWarningWhenMaterialIdentityChanges' },
    { source: editorSource, file: editorPath, snippet: 'class="material-identity-warning"' },
    { source: editorSource, file: editorPath, snippet: '同编码 ${item.identityVariantCount || \'多\'} 套历史资料，核对${materialIdentityConflictFieldsText(item, \'/\')}' },
    { source: editorSource, file: editorPath, snippet: '请核对${materialIdentityConflictFieldsText(item)}，并从下拉候选中人工确认后再套用' },
    { source: editorSource, file: editorPath, snippet: '已按当前候选套用，请核对${materialIdentityConflictFieldsText(item)}' },
    { source: editorSource, file: editorPath, snippet: 'const exactFieldMatches = exactMatches.filter' },
    { source: editorSource, file: editorPath, snippet: 'exactFieldMatches.length === 1' },
    { source: editorSource, file: editorPath, snippet: 'exactFieldMatches.length === 0 && exactPartCodeMatches.length === 1' },
    { source: editorSource, file: editorPath, snippet: 'exactPartCodeMatches.length === 1' },
    { source: editorSource, file: editorPath, snippet: '请从下拉列表选择具体零件' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'const exactMatches = lastInventorySuggestions.value.filter' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'exactMatches.length === 1' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'exactMatches.length > 1' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '匹配到多个精确物料，请从下拉列表中选择具体零件' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'sourceSearchManualPickRequired' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'exactSuggestions.length === 1' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'function canAutoSwitchInventorySuggestion' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'return !item.hasIdentityConflict;' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'function warnInventorySuggestionNeedsManualPick' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'function materialIdentityConflictFieldsText' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'function keepInventorySuggestionManualPick' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'const sourceSearchResultHint = computed' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '同编码存在多套历史资料，请点击候选项确认' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '请核对${materialIdentityConflictFieldsText(item)}，并点击候选项人工确认后再切换库存来源' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '已按当前候选切换库存来源，请核对${materialIdentityConflictFieldsText(item)}' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '找到 1 个相似物料，请点击结果确认后再切换库存来源' },
    { source: editorSource, file: editorPath, snippet: 'lineHadDrawingInfo' },
    { source: editorSource, file: editorPath, snippet: 'const autoMaterialSnapshots = new WeakMap<CreateOrderLinePayload, AutoMaterialSnapshot>();' },
    { source: editorSource, file: editorPath, snippet: 'function clearAutoMaterialFieldsWhenMaterialIdentityChanges' },
    { source: editorSource, file: editorPath, snippet: 'clearAutoMaterialFieldsWhenMaterialIdentityChanges(line)' },
    { source: editorSource, file: editorPath, snippet: 'partName: item.partName,' },
    { source: editorSource, file: editorPath, snippet: 'const partCodeMatches =' },
    { source: editorSource, file: editorPath, snippet: 'const partNameMatches =' },
    { source: editorSource, file: editorPath, snippet: 'autoMaterialSnapshots.set(line' },
    { source: editorSource, file: editorPath, snippet: 'function applyDefaultParentComponent' },
    { source: editorSource, file: editorPath, snippet: 'function inheritedParentComponentNoForLine' },
    { source: editorSource, file: editorPath, snippet: 'line.parentComponentNo = inheritedParentComponentNoForLine(line);' },
    { source: editorSource, file: editorPath, snippet: 'const lineIndex = props.lines.indexOf(line);' },
    { source: editorSource, file: editorPath, snippet: 'const componentNoEditSnapshots = new WeakMap<CreateOrderLinePayload, string>();' },
    { source: editorSource, file: editorPath, snippet: 'function captureComponentNoBeforeEdit' },
    { source: editorSource, file: editorPath, snippet: 'function syncChildParentComponentNo' },
    { source: editorSource, file: editorPath, snippet: 'function clearChildParentComponentNo' },
    { source: editorSource, file: editorPath, snippet: '@focus="captureComponentNoBeforeEdit(row)"' },
    { source: editorSource, file: editorPath, snippet: '@focus="captureComponentNoBeforeEdit(line)"' },
    { source: editorSource, file: editorPath, snippet: 'line.parentComponentNo = nextComponentNoValue;' },
    { source: editorSource, file: editorPath, snippet: 'clearChildParentComponentNo(previousComponentNo);' },
    { source: editorSource, file: editorPath, snippet: '@blur="() => fillExactMaterialFromInput(row, \'partCode\')"' },
    { source: editorSource, file: editorPath, snippet: '@blur="() => fillExactMaterialFromInput(row, \'partName\')"' },
    { source: editorSource, file: editorPath, snippet: ':customer-id="customerId"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '物料基础库' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '删除只停用记忆' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '编码 / 名称 / 拼音 / 规格 / 客户 / 订单 / 图号' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'function disableMaterialMemory' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "import MaterialSuggestionOption from '../components/MaterialSuggestionOption.vue';" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'show-available' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: ':available-scope-label="selectedWarehouseName || \'全部仓库\'"' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: "import MaterialSuggestionOption from './MaterialSuggestionOption.vue';" },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '<MaterialSuggestionOption :item="item" />' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'customerId?: string;' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'props.customerId' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'placeholder="编码/名称/拼音/图号/客户/库存来源"' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'defineProps<{' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'InventoryMaterialSuggestion' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'showAvailable?: boolean' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'availableScopeLabel?: string' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'material-suggestion-identity' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '<small v-if="drawingText" class="material-suggestion-identity">{{ drawingText }}</small>' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '<small v-if="identityWarningText" class="material-suggestion-warning">{{ identityWarningText }}</small>' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: "props.item.identityConflictFields.join('/')" },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '同编码 ${props.item.identityVariantCount || \'多\'} 套历史资料，请核对${fields}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '订单库存 ${formatQuantity(props.item.orderInventoryQuantity, props.item.unit)}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '历史使用 ${props.item.historyUsageCount} 次' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '客户 ${props.item.matchedCustomerName}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '历史订单 ${props.item.matchedHistoryOrderNo}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '来源订单 ${props.item.matchedSourceOrderNo}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '当前客户用过 ${props.item.customerUsageCount} 次' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: "props.item.hasCurrentCustomerHistory ? '当前客户历史' : ''" },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '最近订单 ${props.item.lastCustomerOrderNo}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'const historyCustomerText = computed' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'if (visibleNames.length >= 3)' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '历史客户 ${visibleNames.join' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '图号 ${props.item.drawingNo}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '型号 ${props.item.projectModel}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '日期 ${props.item.drawingDate}' },
    { source: editorSource, file: editorPath, snippet: 'props.customerId' },
    { source: apiSource, file: apiPath, snippet: 'customerId?: string' },
    { source: apiSource, file: apiPath, snippet: 'materialIdentityConfirmed?: boolean;' },
    { source: apiSource, file: apiPath, snippet: 'inventoryMaterials(filters: MaterialMemoryFilters = {})' },
    { source: apiSource, file: apiPath, snippet: 'disableInventoryMaterial(materialId: string)' },
    { source: apiSource, file: apiPath, snippet: 'customerId,' },
    { source: typesSource, file: typesPath, snippet: 'customerUsageCount?: number;' },
    { source: typesSource, file: typesPath, snippet: 'searchMatchText?: string;' },
    { source: typesSource, file: typesPath, snippet: 'matchedCustomerCode?: string;' },
    { source: typesSource, file: typesPath, snippet: 'matchedHistoryOrderNo?: string;' },
    { source: typesSource, file: typesPath, snippet: 'export interface MaterialMemory' },
    { source: typesSource, file: typesPath, snippet: 'partThickness?: number | null;' },
    { source: typesSource, file: typesPath, snippet: 'identityConflictFields?: string[];' },
    { source: typesSource, file: typesPath, snippet: 'historyCustomerNames?: string[];' },
    { source: typesSource, file: typesPath, snippet: 'hasCurrentCustomerHistory?: boolean;' },
    { source: typesSource, file: typesPath, snippet: 'identityVariantCount?: number;' },
    { source: typesSource, file: typesPath, snippet: 'hasIdentityConflict?: boolean;' },
    { source: typesSource, file: typesPath, snippet: 'materialIdentityVariantCount?: number;' },
    { source: typesSource, file: typesPath, snippet: 'materialHasIdentityConflict?: boolean;' },
    { source: typesSource, file: typesPath, snippet: 'materialIdentityConflictFields?: string[];' },
    { source: ordersViewSource, file: ordersViewPath, snippet: ':customer-id="orderForm.customerId"' },
    { source: orderDetailSource, file: orderDetailPath, snippet: ':customer-id="order?.customerId || \'\'"' },
    { source: orderDetailSource, file: orderDetailPath, snippet: 'function materialIdentityConflictText' },
    { source: orderDetailSource, file: orderDetailPath, snippet: 'detailLine.materialIdentityConflictFields.join' },
    { source: orderDetailSource, file: orderDetailPath, snippet: 'class="material-identity-warning"' },
    { source: orderDetailSource, file: orderDetailPath, snippet: 'const submitOrderMaterialIdentityWarnings = computed' },
    { source: orderDetailSource, file: orderDetailPath, snippet: 'const submitOrderMaterialIdentityConfirmRequired = computed' },
    { source: orderDetailSource, file: orderDetailPath, snippet: 'submitMaterialIdentityConfirmed' },
    { source: orderDetailSource, file: orderDetailPath, snippet: 'materialIdentityConfirmed: submitMaterialIdentityConfirmed.value' },
    { source: orderDetailSource, file: orderDetailPath, snippet: '已核对同编码多套历史资料零件的图号、规格、厚度和项目型号' },
    { source: orderDetailSource, file: orderDetailPath, snippet: '请先确认已核对同编码多套历史资料零件' },
    { source: agentsSource, file: agentsPath, snippet: '历史客户名称 / 客户名称片段 / 客户拼音首字母 / `customerCode` / 历史订单' },
    { source: agentsSource, file: agentsPath, snippet: '最近订单、历史客户和当前客户使用次数' },
    { source: agentsSource, file: agentsPath, snippet: '当前客户最近订单日期' },
    { source: agentsSource, file: agentsPath, snippet: '`lastCustomerOrderNo` / `lastCustomerOrderDate` 必须优先代表当前客户的最近使用记录' },
    { source: agentsSource, file: agentsPath, snippet: '基础名称、规格、图号、版本、厚度和项目型号必须优先采用当前客户最近一次使用记录' },
    { source: agentsSource, file: agentsPath, snippet: '新增 / 编辑订单、库存搜索和库存来源核对里的物料建议项' },
    { source: agentsSource, file: agentsPath, snippet: '物料建议项可以摘要展示历史客户列表' },
    { source: agentsSource, file: agentsPath, snippet: '物料建议项有图纸日期时必须展示图纸日期' },
    { source: agentsSource, file: agentsPath, snippet: '以及 `2026-05-30`、`2026/5/30`、`2026530` 这类图纸日期关键词查找历史零件' },
    { source: agentsSource, file: agentsPath, snippet: '同一 `partCode` 在历史订单中出现多个名称、规格、图号、版本、厚度或项目型号组合时' },
    { source: agentsSource, file: agentsPath, snippet: '核对图号、规格、厚度和项目型号后再选择' },
    { source: agentsSource, file: agentsPath, snippet: '必须返回并展示具体冲突字段' },
    { source: agentsSource, file: agentsPath, snippet: '不得在失焦时自动套用物料资料' },
    { source: agentsSource, file: agentsPath, snippet: '当前订单行必须持续显示核对提醒' },
    { source: agentsSource, file: agentsPath, snippet: '订单详情页必须根据历史订单行重新计算并显示同编码多套历史资料风险' },
    { source: agentsSource, file: agentsPath, snippet: '提交生产弹窗必须汇总同编码多套历史资料零件' },
    { source: agentsSource, file: agentsPath, snippet: '后端提交生产接口也必须在事务内重新计算同编码多套历史资料风险' },
    { source: agentsSource, file: agentsPath, snippet: '摘要本身必须包含提交人员和前几条风险行' },
    { source: agentsSource, file: agentsPath, snippet: '库存来源核对弹窗里的可替代物料搜索也必须接收当前 `customerId`' },
    { source: agentsSource, file: agentsPath, snippet: '`sourceType=STOCK` 或 `sourceType=ORDER` 的物料建议只能返回当前范围内有可用数量的物料' },
    { source: agentsSource, file: agentsPath, snippet: '库存页的 `Material` 物料基础库搜索也必须支持历史客户、历史订单、图号和项目型号命中' },
    { source: agentsSource, file: agentsPath, snippet: '备货库存、订单库存、单位、规格、历史使用次数和命中原因' },
    { source: agentsSource, file: agentsPath, snippet: '不得一次返回全部物料' },
    { source: agentsSource, file: agentsPath, snippet: '输入关键词后返回全部命中结果，不得静默截断' },
    { source: agentsSource, file: agentsPath, snippet: '只能在唯一精确命中时自动带出物料资料' },
    { source: agentsSource, file: agentsPath, snippet: '库存来源核对弹窗的替代物料搜索也必须遵守唯一精确命中规则' },
    { source: agentsSource, file: agentsPath, snippet: '库存来源替代物料搜索中同一 `partCode` 存在多套历史识别资料时' },
    { source: agentsSource, file: agentsPath, snippet: '即使接口只返回 1 个模糊命中物料，也不能自动切换库存来源' },
    { source: agentsSource, file: agentsPath, snippet: '多个物料同名或多个结果精确命中' },
    { source: agentsSource, file: agentsPath, snippet: '优先按当前输入字段判断唯一命中' },
    { source: agentsSource, file: agentsPath, snippet: '当前输入值仍等于发起查询时的值' },
    { source: agentsSource, file: agentsPath, snippet: '订单行尚未填写图纸资料' },
    { source: agentsSource, file: agentsPath, snippet: '选中历史物料后若操作员又手工修改 `partCode` 或 `partName`' },
    { source: agentsSource, file: agentsPath, snippet: '删除只能软停用 `Material`' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertMaterialSuggestionCustomerCodeSearch' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertCustomerSearchRanking' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'Customer search must rank exact customerName first' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'Customer search must rank exact customerCode first' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertCustomerSearchRanking' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'matched.matchedCustomerCode === order.customerCode' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'const customerNameSuggestions = await requestJson' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'matchedByName.matchedCustomerName === order.customerName' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'const customerNameFragment = order.customerName.slice' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'matchedByFragment.matchedCustomerName === order.customerName' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'const customerInitials = pinyinInitials(order.customerName)' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'matchedByInitials.matchedCustomerName === order.customerName' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertMaterialMemoryHistorySearch' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'Material memory search by historical customerCode must find' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertMaterialMemoryHistorySearch' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: '客户已选但未输入关键字时，必须能推荐当前客户历史用料' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: "const globalEmptySuggestions = await requestJson('/inventory/materials/suggestions')" },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertMaterialSuggestionCustomerCodeSearch' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertMaterialSuggestionRecentCustomerHistorySort' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertMaterialSuggestionRecentCustomerHistorySort' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'must sort tied history by recent order date' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertMaterialSuggestionLastOrderScopedToCustomer' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertMaterialSuggestionLastOrderScopedToCustomer' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'lastCustomerOrderNo must stay scoped to current customer' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'partName must prefer current customer history' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'drawingNo must prefer current customer history' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'must flag same-code identity conflicts' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'matched.identityConflictFields || []' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: "for (const field of ['名称', '图号', '厚度'])" },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertMaterialSuggestionCodeAbbreviationSearch' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: "await assertMaterialSuggestionCodeAbbreviationSearch('mat001'" },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertMaterialSuggestionPinyinInitialSearch' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: "await assertMaterialSuggestionPinyinInitialSearch('yzdg'" },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: "await assertMaterialSuggestionPinyinInitialSearch('yz'" },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertMaterialSuggestionHistoryFieldSearch' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertStockOnlySuggestionsExcludeNoStockHistory' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'sourceType=STOCK must not return history-only Material' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertMaterialSuggestionHistoryFieldSearch(longRemarkLine.drawingNo' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertMaterialSuggestionHistoryFieldSearch(longRemarkLine.drawingDate' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: "longRemarkLine.drawingDate.replace(/-0/g, '-')" },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertMaterialSuggestionHistoryFieldSearch(longRemarkLine.projectModel' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertMaterialSuggestionHistoryFieldSearch(`${longRemarkLine.partThickness}mm`' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'Number(longRemarkLine.partThickness).toFixed(1)' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertMaterialSuggestionHistoryFieldSearch(createdOrder.orderNo' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertStockOnlySuggestionsExcludeNoStockHistory' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'matched.matchedHistoryOrderNo === keyword' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertDisabledMaterialMemoryExcludedFromSuggestions' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'status=DISABLED' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertDisabledMaterialMemoryExcludedFromSuggestions' }
  ];

  for (const item of requiredSnippets) {
    if (!item.source.includes(item.snippet)) {
      addFailure(`${item.file} must keep material suggestion search snippet: ${item.snippet}`);
    }
  }

  if (
    !/function handlePartCodeInput[\s\S]*?clearAutoMaterialFieldsWhenMaterialIdentityChanges\(line\)/.test(editorSource) ||
    !/function handlePartNameInput[\s\S]*?clearAutoMaterialFieldsWhenMaterialIdentityChanges\(line\)/.test(editorSource)
  ) {
    addFailure('OrderLineEditor.vue must clear auto-filled material fields when either partCode or partName is manually changed.');
  }

  const parentComponentSelectBlocks =
    editorSource.match(/<el-select(?=[^>]*v-model="(?:row|line)\.parentComponentNo")[^>]*>/g) || [];
  if (parentComponentSelectBlocks.length < 2) {
    addFailure('OrderLineEditor.vue must keep desktop and mobile parent component selects.');
  }
  if (parentComponentSelectBlocks.some((block) => block.includes('allow-create') || block.includes('default-first-option'))) {
    addFailure('OrderLineEditor.vue parent component selects must not allow creating or default-picking nonexistent parent components.');
  }
  const partCategorySelectBlocks =
    editorSource.match(/<el-select(?=[^>]*v-model="(?:row|line)\.partCategory")[^>]*>/g) || [];
  if (partCategorySelectBlocks.length < 2) {
    addFailure('OrderLineEditor.vue must keep desktop and mobile part category selects.');
  }
  if (partCategorySelectBlocks.some((block) => block.includes('allow-create') || block.includes('default-first-option'))) {
    addFailure('OrderLineEditor.vue part category selects must use fixed options and avoid default-picking the first option.');
  }
  const partSpecificationSelectBlocks =
    editorSource.match(/<el-select(?=[^>]*v-model="(?:row|line)\.partSpecification")[^>]*>/g) || [];
  if (partSpecificationSelectBlocks.length < 2) {
    addFailure('OrderLineEditor.vue must keep desktop and mobile part specification inputs/selects.');
  }
  if (partSpecificationSelectBlocks.some((block) => block.includes('default-first-option'))) {
    addFailure('OrderLineEditor.vue part specification controls must not default-pick the first option while operators type a custom specification.');
  }
  if (!agentsSource.includes('所属组件下拉只能选择当前订单已有组件编号')) {
    addFailure('AGENTS.md must document that parent component selection cannot create nonexistent component numbers.');
  }
  if (!agentsSource.includes('仍指向旧组件编号的子零件必须自动同步到新组件编号')) {
    addFailure('AGENTS.md must document child parent component synchronization after component number edits.');
  }
  if (!agentsSource.includes('如果组件行被切换为零件行')) {
    addFailure('AGENTS.md must document child parent component cleanup after a component line is changed to a part line.');
  }
  if (!agentsSource.includes('零件类型只能从固定类型中选择')) {
    addFailure('AGENTS.md must document fixed part category selection and default-first-option safety.');
  }
  if (!agentsSource.includes('成品规格可以手工输入')) {
    addFailure('AGENTS.md must document custom specification input without default-first-option.');
  }

  if (/materialSuggestionLimit\s*=/.test(serviceSource) || /\.slice\(0,\s*materialSuggestionLimit\)/.test(serviceSource)) {
    addFailure('inventory.service.ts material suggestions must not silently truncate search results.');
  }
}

function verifyProcessEditDisabledReasonWorkflow() {
  const processViewPath = 'frontend/src/views/ProcessSelectionView.vue';
  if (!fileExists(processViewPath)) {
    addFailure(`Missing process edit disabled reason workflow file: ${processViewPath}`);
    return;
  }

  const processViewSource = readFile(processViewPath);
  const snippets = [
    'const processEditDisabledReason = computed',
    'const processSaveDisabledReason = computed',
    'const submitOrderDisabledReason = computed',
    'const orderDetailDisabledReason = computed',
    'const processReadOnlyText = computed',
    'function processOrderReadOnlyReason',
    'function stepMoveUpDisabledReason(index: number)',
    'function stepMoveDownDisabledReason(index: number)',
    ':content="processSaveDisabledReason"',
    ':content="submitOrderDisabledReason"',
    ':content="processEditDisabledReason"',
    '请先选择下单/计划流程填写人员',
    '当前订单已取消，生产流程只能查看，不能编辑工序。',
    '当前订单已完成发货，生产流程只能查看，不能编辑工序。',
    '当前零件流程有未保存修改，请先保存。',
    '.action-tooltip-wrap'
  ];
  for (const snippet of snippets) {
    if (!processViewSource.includes(snippet)) {
      addFailure(`ProcessSelectionView.vue must keep disabled operation reason snippet: ${snippet}`);
    }
  }
}

function verifyProcessStepDragSortWorkflow() {
  const processViewPath = 'frontend/src/views/ProcessSelectionView.vue';
  const templateManagerPath = 'frontend/src/components/ProcessTemplateManager.vue';
  const orderDetailPath = 'frontend/src/views/OrderDetailView.vue';
  const agentsPath = 'AGENTS.md';
  for (const projectPath of [processViewPath, templateManagerPath, orderDetailPath, agentsPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing process step drag sort workflow file: ${projectPath}`);
      return;
    }
  }

  const processViewSource = readFile(processViewPath);
  const templateManagerSource = readFile(templateManagerPath);
  const orderDetailSource = readFile(orderDetailPath);
  const agentsSource = readFile(agentsPath);
  const processViewSnippets = [
    ':key="draftStepKey(step)"',
    'const draftStepKeys = new WeakMap<ProcessStepDetail, string>()',
    'function draftStepKey(step: ProcessStepDetail)',
    "import { Rank } from '@element-plus/icons-vue'",
    'class="step-drag-handle"',
    'aria-label="拖拽调整顺序"',
    '<el-icon><Rank /></el-icon>',
    ':draggable="canEditProcess"',
    '@dragstart.stop="startStepDrag($event, index)"',
    '@dragover.self.prevent="handleStepListDragOverEnd"',
    '@dragleave="handleStepListDragLeave"',
    '@drop.self.prevent="dropStepAtEnd"',
    '@drop.prevent="dropStep($event, index)"',
    'function reorderDraftStep',
    'function handleStepListDragOverEnd',
    'function dropStepAtEnd',
    'function handleStepListDragLeave',
    'isDragAfterRowMiddle(event)',
    'selected-steps-title',
    '拖动“拖拽”手柄调整顺序；上移 / 下移可作为备用操作。'
  ];
  for (const snippet of processViewSnippets) {
    if (!processViewSource.includes(snippet)) {
      addFailure(`ProcessSelectionView.vue must keep process step drag sort snippet: ${snippet}`);
    }
  }
  const endStepDragStart = processViewSource.indexOf('function endStepDrag');
  const endStepDragEnd = processViewSource.indexOf('function isDragAfterRowMiddle', endStepDragStart);
  const endStepDragSource =
    endStepDragStart >= 0 && endStepDragEnd > endStepDragStart
      ? processViewSource.slice(endStepDragStart, endStepDragEnd)
      : '';
  if (!endStepDragSource.includes("draftProcessFilterKeyword.value = '';")) {
    addFailure('ProcessSelectionView.vue must clear process select filter keyword when drag sorting ends.');
  }

  const templateManagerSnippets = [
    ':key="templateStepKey(step)"',
    'const templateStepKeys = new WeakMap<ProcessStepDetail, string>()',
    'function templateStepKey(step: ProcessStepDetail)',
    "import { Rank } from '@element-plus/icons-vue'",
    'class="template-step-drag-handle"',
    'aria-label="拖拽调整顺序"',
    '<el-icon><Rank /></el-icon>',
    '@dragstart.stop="startTemplateStepDrag($event, index)"',
    '@dragover.self.prevent="handleTemplateStepListDragOverEnd"',
    '@dragleave="handleTemplateStepListDragLeave"',
    '@drop.self.prevent="dropTemplateStepAtEnd"',
    '@drop.prevent="dropTemplateStep($event, index)"',
    'function reorderTemplateStep',
    'function handleTemplateStepListDragOverEnd',
    'function dropTemplateStepAtEnd',
    'function handleTemplateStepListDragLeave',
    'isTemplateStepDragAfterRowMiddle(event)',
    'template-step-help',
    '拖动“拖拽”手柄调整顺序；上移 / 下移可作为备用操作。'
  ];
  for (const snippet of templateManagerSnippets) {
    if (!templateManagerSource.includes(snippet)) {
      addFailure(`ProcessTemplateManager.vue must keep process template step drag sort snippet: ${snippet}`);
    }
  }
  const endTemplateStepDragStart = templateManagerSource.indexOf('function endTemplateStepDrag');
  const endTemplateStepDragEnd = templateManagerSource.indexOf(
    'function isTemplateStepDragAfterRowMiddle',
    endTemplateStepDragStart
  );
  const endTemplateStepDragSource =
    endTemplateStepDragStart >= 0 && endTemplateStepDragEnd > endTemplateStepDragStart
      ? templateManagerSource.slice(endTemplateStepDragStart, endTemplateStepDragEnd)
      : '';
  if (!endTemplateStepDragSource.includes("templateProcessFilterKeyword.value = '';")) {
    addFailure('ProcessTemplateManager.vue must clear template process select filter keyword when drag sorting ends.');
  }

  const orderDetailSnippets = [
    ':key="additionalMaterialProcessStepKey(step)"',
    'const additionalMaterialProcessStepKeys = new WeakMap<ProcessStepDetail, string>()',
    'function additionalMaterialProcessStepKey(step: ProcessStepDetail)',
    "import { Rank, WarningFilled } from '@element-plus/icons-vue'",
    'class="additional-process-drag-handle"',
    'aria-label="拖拽调整顺序"',
    '<el-icon><Rank /></el-icon>',
    '@dragstart.stop="startAdditionalProcessDrag($event, index)"',
    '@dragover.self.prevent="handleAdditionalProcessListDragOverEnd"',
    '@dragleave="handleAdditionalProcessListDragLeave"',
    '@drop.self.prevent="dropAdditionalMaterialProcessAtEnd"',
    '@drop.prevent="dropAdditionalMaterialProcess($event, index)"',
    'function reorderAdditionalMaterialProcess',
    'function handleAdditionalProcessListDragOverEnd',
    'function dropAdditionalMaterialProcessAtEnd',
    'function handleAdditionalProcessListDragLeave',
    'isAdditionalProcessDragAfterRowMiddle(event)'
  ];
  for (const snippet of orderDetailSnippets) {
    if (!orderDetailSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must keep additional material process drag sort snippet: ${snippet}`);
    }
  }
  const endAdditionalProcessDragStart = orderDetailSource.indexOf('function endAdditionalProcessDrag');
  const endAdditionalProcessDragEnd = orderDetailSource.indexOf(
    'function isAdditionalProcessDragAfterRowMiddle',
    endAdditionalProcessDragStart
  );
  const endAdditionalProcessDragSource =
    endAdditionalProcessDragStart >= 0 && endAdditionalProcessDragEnd > endAdditionalProcessDragStart
      ? orderDetailSource.slice(endAdditionalProcessDragStart, endAdditionalProcessDragEnd)
      : '';
  if (!endAdditionalProcessDragSource.includes("additionalProcessFilterKeyword.value = '';")) {
    addFailure('OrderDetailView.vue must clear additional material process select filter keyword when drag sorting ends.');
  }

  if (!agentsSource.includes('生产流程选择页、流程记忆编辑页和订单补单物料流程编辑页的工序排序必须支持拖拽调整')) {
    addFailure('AGENTS.md must document process step drag sorting requirement.');
  }
  if (!agentsSource.includes('拖拽排序手柄必须使用图标按钮')) {
    addFailure('AGENTS.md must document process step drag handle icon button requirement.');
  }
  if (!agentsSource.includes('拖拽排序结束后必须清理工序下拉筛选关键字')) {
    addFailure('AGENTS.md must document process step drag filter cleanup requirement.');
  }
}

function verifyMobileCompactOrderCards() {
  const files = [
    'frontend/src/views/OrdersListView.vue',
    'frontend/src/views/ProcessSelectionView.vue',
    'frontend/src/views/ProductionView.vue',
    'frontend/src/views/WarehouseView.vue',
    'frontend/src/views/InventoryView.vue',
    'frontend/src/views/CustomersView.vue',
    'frontend/src/views/StatisticsView.vue',
    'frontend/src/views/OrderDetailView.vue',
    'frontend/src/views/ProcessTemplatesView.vue',
    'frontend/src/components/InventorySourceDetailsDialog.vue',
    'frontend/src/components/OrderLineEditor.vue',
    'frontend/src/components/ProcessDefinitionManager.vue',
    'frontend/src/components/ProcessTemplateManager.vue',
    'frontend/src/styles.css'
  ];
  for (const projectPath of files) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing mobile compact order card file: ${projectPath}`);
      return;
    }
  }

  const ordersSource = readFile('frontend/src/views/OrdersListView.vue');
  const processSource = readFile('frontend/src/views/ProcessSelectionView.vue');
  const productionSource = readFile('frontend/src/views/ProductionView.vue');
  const warehouseSource = readFile('frontend/src/views/WarehouseView.vue');
  const inventorySource = readFile('frontend/src/views/InventoryView.vue');
  const customersSource = readFile('frontend/src/views/CustomersView.vue');
  const statisticsSource = readFile('frontend/src/views/StatisticsView.vue');
  const orderDetailSource = readFile('frontend/src/views/OrderDetailView.vue');
  const processTemplatesViewSource = readFile('frontend/src/views/ProcessTemplatesView.vue');
  const inventorySourceDialogSource = readFile('frontend/src/components/InventorySourceDetailsDialog.vue');
  const orderLineEditorSource = readFile('frontend/src/components/OrderLineEditor.vue');
  const processDefinitionSource = readFile('frontend/src/components/ProcessDefinitionManager.vue');
  const processTemplateSource = readFile('frontend/src/components/ProcessTemplateManager.vue');
  const styleSource = readFile('frontend/src/styles.css');
  const componentSnippets = [
    'mobile-card-compact-summary',
    'mobile-card-header-actions',
    'toggleMobileOrderCard',
    'isMobileOrderExpanded'
  ];
  for (const snippet of componentSnippets) {
    if (!ordersSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must keep compact mobile order card snippet: ${snippet}`);
    }
    if (!processSource.includes(snippet)) {
      addFailure(`ProcessSelectionView.vue must keep compact mobile process-order card snippet: ${snippet}`);
    }
  }
  const ordersMobilePauseSnippets = [
    'orders-page-header-actions',
    'requireDesktopOrderListMutation',
    '手机端订单列表仅用于查看明细'
  ];
  for (const snippet of ordersMobilePauseSnippets) {
    if (!ordersSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must keep mobile order list read-only snippet: ${snippet}`);
    }
  }
  const forbiddenMobileOrderListActions = [
    '@click="goShortageDetail(order)"',
    '@click="goProcess(order)"',
    '@click="openDeleteDraftOrder(order)"',
    '@click="openCancelOrder(order)"'
  ];
  for (const snippet of forbiddenMobileOrderListActions) {
    if (ordersSource.includes(snippet)) {
      addFailure(`OrdersListView.vue mobile order card must stay detail-only and not expose mutation action: ${snippet}`);
    }
  }
  if (/\.mobile-card-list\s*\{[\s\S]*display:\s*none/.test(ordersSource)) {
    addFailure('OrdersListView.vue mobile order list must remain visible as read-only entry to order detail.');
  }
  const productionSnippets = [
    'mobile-card-compact-summary',
    'mobile-card-header-actions',
    'expandedMobileProductionTaskIds',
    'toggleMobileProductionOrderCard',
    'isMobileProductionOrderExpanded',
    'toggleMobileProductionTaskCard',
    'isMobileProductionTaskExpanded',
    'production-task-header-actions',
    'normalizeDisplayFileName',
    'displayFileName(activeTask.drawingFileName || activeTask.drawingFileUrl)'
  ];
  for (const snippet of productionSnippets) {
    if (!productionSource.includes(snippet)) {
      addFailure(`ProductionView.vue must keep compact mobile production-order card snippet: ${snippet}`);
    }
  }
  const warehouseSnippets = [
    'mobile-card-compact-summary',
    'mobile-card-header-actions',
    'expandedMobileWarehouseCardKeys',
    'receiptCardKey',
    'shipmentOrderCardKey',
    'shipmentCardKey',
    'warehouseLocationCardKey',
    'transactionCardKey',
    'toggleMobileWarehouseCard',
    'isMobileWarehouseCardExpanded'
  ];
  for (const snippet of warehouseSnippets) {
    if (!warehouseSource.includes(snippet)) {
      addFailure(`WarehouseView.vue must keep compact mobile warehouse card snippet: ${snippet}`);
    }
  }
  const inventorySnippets = [
    'mobile-card-compact-summary',
    'mobile-card-header-actions',
    'expandedMobileInventoryCardKeys',
    'summaryCardKey',
    'batchCardKey',
    'toggleMobileInventoryCard',
    'isMobileInventoryCardExpanded'
  ];
  for (const snippet of inventorySnippets) {
    if (!inventorySource.includes(snippet)) {
      addFailure(`InventoryView.vue must keep compact mobile inventory card snippet: ${snippet}`);
    }
  }
  const customerSnippets = [
    'mobile-card-compact-summary',
    'mobile-card-header-actions',
    'expandedMobileCustomerIds',
    'primaryContactText',
    'toggleMobileCustomerCard',
    'isMobileCustomerExpanded'
  ];
  for (const snippet of customerSnippets) {
    if (!customersSource.includes(snippet)) {
      addFailure(`CustomersView.vue must keep compact mobile customer card snippet: ${snippet}`);
    }
  }
  const statisticsSnippets = [
    'mobile-card-compact-summary',
    'mobile-card-header-actions',
    'expandedMobileStatisticsCardKeys',
    'summaryMobileCardKey',
    'orderMobileCardKey',
    'toggleMobileStatisticsCard',
    'isMobileStatisticsCardExpanded'
  ];
  for (const snippet of statisticsSnippets) {
    if (!statisticsSource.includes(snippet)) {
      addFailure(`StatisticsView.vue must keep compact mobile statistics card snippet: ${snippet}`);
    }
  }
  const orderDetailSnippets = [
    'useDeviceProfile',
    'isMobileLayout',
    'line-compact-summary',
    'order-detail-line-body',
    'order-detail-line-toolbar',
    'expandedMobileOrderDetailLineIds',
    'toggleOrderDetailLine',
    'expandAllOrderDetailLines',
    'collapseAllOrderDetailLines',
    'showOrderDetailLineDetails',
    'isOrderDetailLineExpanded',
    'requireDesktopOrderMutation',
    '手机端仅用于查看订单明细',
    'v-if="!isMobileLayout" class="page-actions order-detail-page-actions"',
    '查看生产流程',
    'v-if="!isMobileLayout" class="line-actions"',
    'v-if="!isMobileLayout && lineNeedsReplenishmentAction(line)"',
    'openImportSourcePreview',
    '来源 Excel 预览',
    '预览来源Excel'
  ];
  for (const snippet of orderDetailSnippets) {
    if (!orderDetailSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must keep compact mobile order-detail line card snippet: ${snippet}`);
    }
  }
  const processTemplatesViewSnippets = [
    'process-template-page-section',
    '@media (max-width: 900px)'
  ];
  for (const snippet of processTemplatesViewSnippets) {
    if (!processTemplatesViewSource.includes(snippet)) {
      addFailure(`ProcessTemplatesView.vue must keep unframed responsive process maintenance section snippet: ${snippet}`);
    }
  }
  if (processTemplatesViewSource.includes('process-template-page-card')) {
    addFailure('ProcessTemplatesView.vue must avoid wrapping process maintenance cards inside another page card.');
  }
  const inventorySourceDialogSnippets = [
    'mobile-card-compact-summary',
    'mobile-card-header-actions',
    'expandedMobileSourceBatchKeys',
    'sourceBatchCardKey',
    'toggleMobileSourceBatch',
    'isMobileSourceBatchExpanded'
  ];
  for (const snippet of inventorySourceDialogSnippets) {
    if (!inventorySourceDialogSource.includes(snippet)) {
      addFailure(`InventorySourceDetailsDialog.vue must keep compact mobile source batch card snippet: ${snippet}`);
    }
  }
  const orderLineEditorSnippets = [
    'mobile-card-compact-summary',
    'mobile-card-header-actions',
    'order-line-mobile-toolbar',
    'expandedMobileLineIndexes',
    'length === 1 ? [0] : []',
    'expandAllMobileLineCards',
    'collapseAllMobileLineCards',
    "line.deliveryDate || defaultDeliveryDate || '-'",
    'stockSourceReviewRequired(line)',
    "isStockSourceReviewed(line) ? '已核对来源' : '未核对来源'",
    'toggleMobileLineCard',
    'isMobileLineExpanded',
    'fulfillmentModeText'
  ];
  for (const snippet of orderLineEditorSnippets) {
    if (!orderLineEditorSource.includes(snippet)) {
      addFailure(`OrderLineEditor.vue must keep compact mobile order-line editor card snippet: ${snippet}`);
    }
  }
  const mobileTextWrapSnippets = [
    { source: inventorySourceDialogSource, file: 'InventorySourceDetailsDialog.vue', snippet: '.reservation-order-link,' },
    { source: inventorySourceDialogSource, file: 'InventorySourceDetailsDialog.vue', snippet: '.order-preview-summary strong' },
    { source: warehouseSource, file: 'WarehouseView.vue', snippet: '.shipment-order-card strong,' },
    { source: productionSource, file: 'ProductionView.vue', snippet: '.empty-production-hint span' },
    { source: productionSource, file: 'ProductionView.vue', snippet: 'min-width: 0;' }
  ];
  for (const item of mobileTextWrapSnippets) {
    if (!item.source.includes(item.snippet)) {
      addFailure(`${item.file} must keep mobile text wrapping/shrinking snippet: ${item.snippet}`);
    }
  }
  const processDefinitionSnippets = [
    'expandedMobileDefinitionIds',
    'toggleMobileDefinitionCard',
    'isMobileDefinitionExpanded',
    'process-definition-detail-toggle',
    '.process-definition-card.expanded .process-definition-actions'
  ];
  for (const snippet of processDefinitionSnippets) {
    if (!processDefinitionSource.includes(snippet)) {
      addFailure(`ProcessDefinitionManager.vue must keep compact mobile process-definition card snippet: ${snippet}`);
    }
  }
  const processTemplateSnippets = [
    'expandedMobileTemplateIds',
    'toggleMobileTemplateCard',
    'isMobileTemplateExpanded',
    'process-template-detail-toggle',
    '.process-template-card.expanded .process-template-card-actions'
  ];
  for (const snippet of processTemplateSnippets) {
    if (!processTemplateSource.includes(snippet)) {
      addFailure(`ProcessTemplateManager.vue must keep compact mobile process-template card snippet: ${snippet}`);
    }
  }
  const styleSnippets = [
    '.mobile-order-card',
    '.mobile-card-compact-summary',
    '.mobile-card-header-actions',
    '.mobile-order-card:not(.expanded) .mobile-card-actions'
  ];
  for (const snippet of styleSnippets) {
    if (!styleSource.includes(snippet)) {
      addFailure(`styles.css must keep compact mobile order card style snippet: ${snippet}`);
    }
  }
}

function verifyProductionProcessCompletionSequenceWorkflow() {
  const servicePath = 'backend/src/modules/production/production.service.ts';
  const viewPath = 'frontend/src/views/ProductionView.vue';
  const apiPath = 'frontend/src/api/erp.ts';
  const verifierPath = 'database/prisma/verify-first-stage.ts';

  for (const projectPath of [servicePath, viewPath, apiPath, verifierPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing production process completion sequence file: ${projectPath}`);
      return;
    }
  }

  const serviceSource = readFile(servicePath);
  const serviceSnippets = [
    'async completeProcessStep(id: string, dto: CompleteProcessStepDto)',
    'runSerializableTransaction',
    'findTaskForMutationOrThrow(tx, id)',
    '已取消订单不能修改工序完成记录',
    '已完成发货订单不能修改工序完成记录',
    '生产任务已入库，不能修改工序完成记录',
    '生产任务必须先开始，才能确认工序完成',
    '已完成生产的工序不能改为未完成',
    '生产流程必须按已保存的顺序完成，避免跳过前道工序直接把后道工序标绿。',
    '必须先完成上一道工序',
    '后续工序已完成，不能回退当前工序',
    'resolveProcessQuantityGuard',
    'syncTaskStatusFromProcessSteps',
    'async completeProcessSteps(id: string, dto: CompleteProcessStepsDto)',
    '批量确认的工序必须连续',
    '批量确认仍必须遵守工艺顺序，只允许连续确认，不能跳过前道工序。',
    '当前生产任务正在被其他操作批量确认工序，请刷新后重试'
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`ProductionService must keep process completion sequence rule snippet: ${snippet}`);
    }
  }

  const viewSource = readFile(viewPath);
  const viewSnippets = [
    'function canOpenProcess(row: ProductionTask, processName: string)',
    "if (row.orderStatus === 'COMPLETED')",
    "return isProcessCompleted(row, processName);",
    "if (effectiveProductionStatus(row) === 'PENDING')",
    'return row.status === \'COMPLETED\' || isProcessCompleted(row, processName) || isCurrentProcess(row, processName);',
    'function processButtonTitle(row: ProductionTask, processName: string)',
    '订单已完成发货，只能查看工序记录',
    '该订单已完成发货，工序完成表只能查看，不能再修改。',
    'return \'请先开始生产\';',
    'return \'请先完成上一道工序\';',
    'function openProcessCompletion(row: ProductionTask, processName: string)',
    'if (!canOpenProcess(row, processName))',
    'selectedProcessNamesForSave()',
    'erpApi.completeProcessSteps(activeTask.value.id',
    'erpApi.completeProcessStep(activeTask.value.id',
    '该生产任务已经入库，不能再修改工序完成表',
    '所有工序已确认完成'
  ];
  for (const snippet of viewSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`ProductionView.vue must keep process completion sequence UI snippet: ${snippet}`);
    }
  }

  const apiSource = readFile(apiPath);
  const apiSnippets = [
    'completeProcessStep(id: string, payload: CompleteProcessStepPayload)',
    '/production/tasks/${id}/process-completions',
    'completeProcessSteps(id: string, payload: CompleteProcessStepsPayload)',
    '/production/tasks/${id}/process-completions/batch'
  ];
  for (const snippet of apiSnippets) {
    if (!apiSource.includes(snippet)) {
      addFailure(`frontend api must keep process completion endpoint helper snippet: ${snippet}`);
    }
  }

  const verifierSource = readFile(verifierPath);
  const verifierSnippets = [
    'shouldHaveProductionTask && normalTasks.length === 0',
    'PENDING_TASK_HAS_COMPLETED_PROCESS',
    'PROCESS_COMPLETION_SKIPPED_PREVIOUS',
    'PROCESS_COMPLETION_STEP_OUT_OF_RANGE',
    'PROCESS_COMPLETION_STEP_NAME_MISMATCH',
    'COMPLETED_TASK_PROCESS_INCOMPLETE'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep process completion sequence data verification snippet: ${snippet}`);
    }
  }
}

function verifyProductionReplenishmentAndWithdrawWorkflow() {
  const controllerPath = 'backend/src/modules/production/production.controller.ts';
  const dtoPath = 'backend/src/modules/production/dto.ts';
  const servicePath = 'backend/src/modules/production/production.service.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const typesPath = 'frontend/src/types/erp.ts';
  const viewPath = 'frontend/src/views/ProductionView.vue';
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  const seedPath = 'database/prisma/seed.ts';

  for (const projectPath of [controllerPath, dtoPath, servicePath, apiPath, typesPath, viewPath, verifierPath, seedPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing production replenishment/withdraw workflow file: ${projectPath}`);
      return;
    }
  }

  const controllerSource = readFile(controllerPath);
  const controllerSnippets = [
    "@Get('replenishment-requests')",
    'return this.productionService.replenishmentRequests(query)',
    "@Post('process-completions/:id/replenishment-request/approve')",
    'return this.productionService.approveReplenishmentRequest(id, dto)',
    "@Post('process-completions/:id/replenishment-request/reject')",
    'return this.productionService.rejectReplenishmentRequest(id, dto)',
    "@Post(':id/withdraw')",
    'return this.productionService.withdraw(id, dto)',
    "@Post('notices/:id/acknowledge')",
    'return this.productionService.acknowledgeNotice(id, dto)'
  ];
  for (const snippet of controllerSnippets) {
    if (!controllerSource.includes(snippet)) {
      addFailure(`ProductionController must keep replenishment, withdraw, and notice endpoint snippet: ${snippet}`);
    }
  }

  const dtoSource = readFile(dtoPath);
  const dtoSnippets = [
    "export const productionShortageModes = ['REPLENISHMENT_REQUEST', 'REPLENISHMENT', 'MANAGER_APPROVED'] as const",
    "export const productionWithdrawHandlingModes = ['STOCK', 'SCRAP', 'NONE'] as const",
    "export const productionReplenishmentRequestStatuses = ['PENDING', 'APPROVED', 'REJECTED'] as const",
    'export class ApproveProductionReplenishmentRequestDto',
    'managerName!: string',
    'export class RejectProductionReplenishmentRequestDto',
    'reason!: string',
    'export class ProductionReplenishmentRequestQueryDto',
    '@IsIn(productionReplenishmentRequestStatuses)',
    'export class WithdrawProductionTaskDto',
    '@IsIn(productionWithdrawHandlingModes)',
    'handlingQuantity!: number',
    'handledAt?: string'
  ];
  for (const snippet of dtoSnippets) {
    if (!dtoSource.includes(snippet)) {
      addFailure(`production dto must keep replenishment/withdraw validation snippet: ${snippet}`);
    }
  }

  const serviceSource = readFile(servicePath);
  const serviceSnippets = [
    'async replenishmentRequests(query: ProductionReplenishmentRequestQueryDto = {})',
    'this.prisma.productionReplenishmentRequest.findMany',
    'orderStatusByOrderId',
    'orderStatusByOrderNo',
    'private toProductionReplenishmentRequest(request: any, orderStatus?: OrderStatus)',
    'statusRank',
    'async withdraw(id: string, dto: WithdrawProductionTaskDto)',
    '管理人员姓名和撤回原因不能为空',
    '撤回处理方式不能为空',
    '无实物处理时，处理数量必须为 0',
    '已完成发货订单不能撤回生产任务',
    '生产任务已入库，不能撤回',
    '已有补单任务开始生产，不能自动撤回',
    'tx.productionTask.deleteMany',
    'tx.productionProcessCompletion.deleteMany',
    'status: ProductionStatus.PENDING',
    'sourceRecordType: \'ProductionTaskWithdraw\'',
    'target: ProductionNoticeTarget.PRODUCTION',
    'target: ProductionNoticeTarget.WAREHOUSE',
    '管理撤回后需要仓库确认转库存',
    'async approveReplenishmentRequest(id: string, dto: ApproveProductionReplenishmentRequestDto)',
    '没有待确认的生产报废补单申请',
    '生产报废补单申请已经生成任务',
    '已取消订单不能确认生产报废补单',
    '已完成发货订单不能确认生产报废补单',
    '生产任务已入库，不能确认生产报废补单',
    '生产报废补单必须由车间主管确认后才生成补单任务',
    "shortageMode: 'REPLENISHMENT'",
    "sourceType: 'PRODUCTION_SCRAP'",
    "status: 'APPROVED'",
    "action: 'APPROVE_REPLENISHMENT_REQUEST'",
    'toNoticesWithCustomerNames',
    'customerNameByOrderId',
    'customerNameByOrderNo',
    'async rejectReplenishmentRequest(id: string, dto: RejectProductionReplenishmentRequestDto)',
    '已取消订单不能驳回生产报废补单',
    '已完成发货订单不能驳回生产报废补单',
    '生产任务已入库，不能驳回生产报废补单',
    '已确认的生产报废补单申请不能驳回',
    "shortageMode: 'MANAGER_APPROVED'",
    "status: 'REJECTED'",
    "action: 'REJECT_REPLENISHMENT_REQUEST'",
    'syncProductionReplenishmentRequest',
    '生产人员不能直接生成补单任务，只能发起生产报废补单申请',
    '操作员在工序完成表中发现报废并选择“生产报废补单申请”时，只创建待确认申请，不直接生成生产任务',
    'sourceType 固定为 PRODUCTION_SCRAP',
    'generateNextReplenishmentRequestNo',
    'formatWithdrawRemark',
    'formatWithdrawNoticeReason',
    'withdrawHandlingText'
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`ProductionService must keep replenishment/withdraw business rule snippet: ${snippet}`);
    }
  }

  const apiSource = readFile(apiPath);
  const apiSnippets = [
    'export interface ApproveProductionReplenishmentRequestPayload',
    'export interface RejectProductionReplenishmentRequestPayload',
    'export interface WithdrawProductionTaskPayload',
    'productionReplenishmentRequests(filters: ProductionReplenishmentRequestFilters = {})',
    '/production/tasks/replenishment-requests',
    'withdrawProductionTask(id: string, payload: WithdrawProductionTaskPayload)',
    '/production/tasks/${id}/withdraw',
    'approveProductionReplenishmentRequest(completionId: string, payload: ApproveProductionReplenishmentRequestPayload)',
    '/production/tasks/process-completions/${completionId}/replenishment-request/approve',
    'rejectProductionReplenishmentRequest(completionId: string, payload: RejectProductionReplenishmentRequestPayload)',
    '/production/tasks/process-completions/${completionId}/replenishment-request/reject',
    'acknowledgeProductionNotice(id: string, acknowledgedBy: string)'
  ];
  for (const snippet of apiSnippets) {
    if (!apiSource.includes(snippet)) {
      addFailure(`frontend api must keep replenishment/withdraw helper snippet: ${snippet}`);
    }
  }

  const typesSource = readFile(typesPath);
  const typeSnippets = [
    "export type ProductionReplenishmentRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'",
    'export interface ProductionReplenishmentRequest',
    "sourceType: 'PRODUCTION_SCRAP' | string",
    'processCompletionId?: string',
    'requestQuantity: number',
    'scrapQuantity: number',
    'replenishmentTaskNo?: string',
    'replenishmentRequestNo?: string',
    'replenishmentRequestStatus?: string',
    'replenishmentApprovedBy?: string',
    'customerName?: string'
  ];
  for (const snippet of typeSnippets) {
    if (!typesSource.includes(snippet)) {
      addFailure(`frontend types must keep replenishment request field snippet: ${snippet}`);
    }
  }

  const viewSource = readFile(viewPath);
  const viewSnippets = [
    '<NoticeAcknowledgeDialog',
    '[notice.customerName, notice.orderNo, notice.partCode, notice.partName]',
    'saveNoticeAcknowledge',
    'value="REPLENISHMENT_REQUEST">生产报废补单申请',
    '保存后只生成生产报废补单申请，车间主管确认后系统才会生成补单任务。',
    'v-model="replenishmentRequestVisible"',
    'title="生产报废补单申请"',
    'loadProductionReplenishmentRequests',
    'erpApi.productionReplenishmentRequests',
    'canReviewReplenishmentRequest',
    'replenishmentRequestLockedReason',
    '订单已完成发货，不能处理生产报废补单申请',
    'openReplenishmentApprovalFromRequest',
    'openReplenishmentReject',
    'v-model="replenishmentApprovalVisible"',
    'title="主管确认生产报废补单"',
    'erpApi.approveProductionReplenishmentRequest',
    '主管已确认，系统已生成生产报废补单任务',
    'v-model="replenishmentRejectVisible"',
    'title="驳回生产报废补单申请"',
    'erpApi.rejectProductionReplenishmentRequest',
    '已驳回生产报废补单申请，并记录为管理确认缺货完成',
    'v-model="withdrawVisible"',
    'title="管理撤回"',
    '撤回会清空当前任务的工序完成记录并退回待确认生产',
    'withdrawForm.managerName',
    'withdrawForm.reason',
    'withdrawForm.handledAt',
    'withdrawForm.handlingMode',
    'withdrawForm.handlingQuantity',
    'handleWithdrawModeChange',
    'erpApi.withdrawProductionTask',
    '生产任务已撤回',
    'canWithdrawProduction(row)'
  ];
  for (const snippet of viewSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`ProductionView.vue must keep replenishment/withdraw dialog workflow snippet: ${snippet}`);
    }
  }

  const verifierSource = readFile(verifierPath);
  const verifierSnippets = [
    'await checkProductionNotices()',
    'await checkProductionReplenishmentRequests()',
    'await checkProductionScrapRecords()',
    'PRODUCTION_NOTICE_ACK_MISSING',
    'REPLENISHMENT_SOURCE_TYPE_INVALID',
    'PENDING_REPLENISHMENT_ORDER_CANCELLED',
    'PENDING_REPLENISHMENT_ORDER_COMPLETED',
    'PENDING_REPLENISHMENT_TASK_RECEIVED',
    'PENDING_REPLENISHMENT_REVIEW_FIELDS_STALE',
    'APPROVED_REPLENISHMENT_TASK_MISSING',
    'APPROVED_REPLENISHMENT_TASK_SOURCE_TYPE',
    'REJECTED_REPLENISHMENT_APPROVAL_FIELDS_STALE',
    'PENDING_REPLENISHMENT_DUPLICATE',
    'ProductionTaskWithdraw',
    'SCRAP_RECORD_WITHDRAW_SOURCE_MISMATCH'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep replenishment/withdraw data verification snippet: ${snippet}`);
    }
  }

  const seedSource = readFile(seedPath);
  const seedSnippets = [
    'async function seedReplenishmentAndNotices()',
    '这组数据用于验收生产报废补单',
    "requestNo: 'PRR-20260508-001'",
    "sourceType: 'PRODUCTION_SCRAP'",
    "status: 'PENDING'",
    'processCompletionId: savedCompletion.id',
    "sourceRecordType: 'ProductionProcessCompletion'",
    "noticeNo: 'PN-SEED-PRODUCTION-001'",
    "noticeNo: 'PN-SEED-WAREHOUSE-001'"
  ];
  for (const snippet of seedSnippets) {
    if (!seedSource.includes(snippet)) {
      addFailure(`seed.ts must keep replenishment/notice coverage snippet: ${snippet}`);
    }
  }
}

function verifyOrderChangeAndCancellationWorkflow() {
  const controllerPath = 'backend/src/modules/orders/orders.controller.ts';
  const dtoPath = 'backend/src/modules/orders/dto.ts';
  const servicePath = 'backend/src/modules/orders/orders.service.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const detailViewPath = 'frontend/src/views/OrderDetailView.vue';
  const listViewPath = 'frontend/src/views/OrdersListView.vue';
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  const seedPath = 'database/prisma/seed.ts';

  for (const projectPath of [controllerPath, dtoPath, servicePath, apiPath, detailViewPath, listViewPath, verifierPath, seedPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing order change/cancellation workflow file: ${projectPath}`);
      return;
    }
  }

  const controllerSource = readFile(controllerPath);
  const controllerSnippets = [
    "@Post(':orderNo/lines/:lineId/replenishments')",
    'return this.ordersService.createLineReplenishment(orderNo, lineId, dto)',
    "@Post(':orderNo/replenishments/:productionTaskNo/cancel')",
    'return this.ordersService.cancelReplenishment(orderNo, productionTaskNo, dto)',
    "@Post(':orderNo/lines/additional-materials')",
    'return this.ordersService.createAdditionalMaterial(orderNo, dto)',
    "@Patch(':orderNo/lines/:lineId/quantity-change')",
    'return this.ordersService.updateLineQuantityAfterProductionStarted(orderNo, lineId, dto)',
    "@Post(':orderNo/cancel')",
    'return this.ordersService.cancelOrder(orderNo, dto)',
    "@Post(':orderNo/cancel-after-production-started')",
    'return this.ordersService.cancelAfterProductionStarted(orderNo, dto)'
  ];
  for (const snippet of controllerSnippets) {
    if (!controllerSource.includes(snippet)) {
      addFailure(`OrdersController must keep order change/cancellation endpoint snippet: ${snippet}`);
    }
  }

  const dtoSource = readFile(dtoPath);
  const dtoSnippets = [
    'export class CreateLineReplenishmentDto',
    'quantity!: number',
    'reason!: string',
    'export class CreateAdditionalMaterialDto extends CreateOrderLineDto',
    'export class UpdateLineQuantityDto',
    'productionPlanQuantity?: number',
    'productionPlanOverrideByCode?: string',
    'productionPlanOverrideReason?: string',
    'export class CancelOrderHandlingPlanItemDto',
    "@IsIn(['STOCK', 'SCRAP', 'NONE'])",
    "handlingMode!: 'STOCK' | 'SCRAP' | 'NONE'",
    'handlingQuantity?: number',
    'export class CancelOrderDto',
    "productionCancelState?: 'NOT_PRODUCED' | 'PRODUCED'",
    'handlingPlan?: CancelOrderHandlingPlanItemDto[]',
    'export class CancelStartedOrderDto extends CancelOrderDto',
    'export class CancelReplenishmentDto extends CancelOrderDto'
  ];
  for (const snippet of dtoSnippets) {
    if (!dtoSource.includes(snippet)) {
      addFailure(`orders dto must keep order change/cancellation validation snippet: ${snippet}`);
    }
  }

  const serviceSource = readFile(servicePath);
  if (
    !/async\s+update\(orderNo:\s*string,\s*dto:\s*UpdateOrderDto\)\s*{[\s\S]*order\.status !== OrderStatus\.DRAFT[\s\S]*const lines = this\.normalizeEditableOrderLineComponentFields\(await this\.normalizeOrderLineImportReferences\(dto\.lines\)\)[\s\S]*this\.validateOrderLines\(lines,\s*\{\s*requireStockSources:\s*false\s*\}\)/.test(
      serviceSource
    )
  ) {
    addFailure('OrdersService.update must reject non-draft orders before validating replacement order lines.');
  }
  const serviceSnippets = [
    'async createLineReplenishment(orderNo: string, lineId: string, dto: CreateLineReplenishmentDto)',
    'findStartedOrderLineTask(tx, normalizedOrderNo, lineId)',
    '补单原因不能为空',
    "noticeType: 'QUANTITY_INCREASE'",
    'async cancelReplenishment(orderNo: string, productionTaskNo: string, dto: CancelReplenishmentDto)',
    '这里只能取消补单任务',
    '已开始生产的补单不能直接取消，请走生产撤回流程',
    'tx.productionNotice.deleteMany',
    'tx.productionTask.delete({ where: { id: task.id } })',
    '取消补单',
    'async createAdditionalMaterial(orderNo: string, dto: CreateAdditionalMaterialDto)',
    '待提交生产订单请直接编辑订单，不要创建补单物料',
    '订单尚未开始生产，不能新增补单物料，请直接修改订单',
    '新增补单物料必须使用重新生产方式',
    "isReplenishment: true",
    "replenishmentSourceType: 'ORDER_CHANGE'",
    "noticeType: 'MATERIAL_ADDED'",
    'async updateLineQuantityAfterProductionStarted(orderNo: string, lineId: string, dto: UpdateLineQuantityDto)',
    '生产数量变更原因不能为空',
    'planDiffersFromSuggestion',
    'createReplenishmentTaskForLine',
    "nextQuantity === 0 ? 'ORDER_CANCELLED' : deltaQuantity > 0 ? 'QUANTITY_INCREASE' : 'QUANTITY_DECREASE'",
    'target: ProductionNoticeTarget.WAREHOUSE',
    'async cancelOrder(orderNo: string, dto: CancelOrderDto)',
    '订单已经有生产进度，请选择已生产取消',
    '订单没有生产进度，请选择未生产取消',
    'normalizeCancelHandlingPlan(',
    '订单已有发货库存，不能直接取消',
    "releaseOrderInventoryReservations(tx, order.id, 'ORDER_CANCELLED')",
    'releaseUnstartedLineStock',
    "noticeType: 'ORDER_CANCELLED'",
    'handlingPlan: handlingPlanJson',
    'async cancelAfterProductionStarted(orderNo: string, dto: CancelStartedOrderDto)',
    'return this.cancelOrder(orderNo, dto)',
    'private isStartedProductionTask',
    'private hasEffectiveProcessProgress',
    'private normalizeCancelHandlingPlan',
    '已生产取消必须填写已生产零件的处理方案',
    '选择无实物处理时必须填写说明',
    '取消处理方案缺少任务',
    'private async createProductionNotice',
    'existingPendingNotice',
    'private async releaseUnstartedLineStock',
    "sourceRecordType: 'OrderCancellationReleaseStock'"
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`OrdersService must keep order change/cancellation business rule snippet: ${snippet}`);
    }
  }

  const apiSource = readFile(apiPath);
  const apiSnippets = [
    'export interface CreateLineReplenishmentPayload',
    'export interface CreateAdditionalMaterialPayload extends CreateOrderLinePayload',
    'export interface UpdateLineQuantityPayload',
    'export interface CancelStartedOrderPayload',
    'export interface CancelOrderHandlingPlanItemPayload',
    "productionCancelState?: 'NOT_PRODUCED' | 'PRODUCED'",
    "handlingMode: 'STOCK' | 'SCRAP' | 'NONE'",
    'createLineReplenishment(orderNo: string, lineId: string, payload: CreateLineReplenishmentPayload)',
    '/orders/${orderNo}/lines/${lineId}/replenishments',
    'createAdditionalMaterial(orderNo: string, payload: CreateAdditionalMaterialPayload)',
    '/orders/${orderNo}/lines/additional-materials',
    'updateLineQuantityAfterProductionStarted(orderNo: string, lineId: string, payload: UpdateLineQuantityPayload)',
    '/orders/${orderNo}/lines/${lineId}/quantity-change',
    'cancelOrder(orderNo: string, payload: CancelStartedOrderPayload)',
    '/orders/${orderNo}/cancel',
    'cancelReplenishment(orderNo: string, productionTaskNo: string, payload: CancelStartedOrderPayload)',
    '/orders/${orderNo}/replenishments/${productionTaskNo}/cancel',
    'cancelOrderAfterProductionStarted(orderNo: string, payload: CancelStartedOrderPayload)'
  ];
  for (const snippet of apiSnippets) {
    if (!apiSource.includes(snippet)) {
      addFailure(`frontend api must keep order change/cancellation helper snippet: ${snippet}`);
    }
  }

  const detailViewSource = readFile(detailViewPath);
  const detailViewSnippets = [
    '新增补单物料',
    '创建订单补单',
    '取消补单',
    '客户数量变更',
    '取消订单',
    '已开始生产的订单不能再按待提交生产状态修改',
    '生产计划数量与建议数量不一致，请填写操作人员账号',
    '生产计划数量与建议数量不一致，请填写调整说明',
    'cancelReplenishmentVisible',
    'orderChangeReplenishmentTasks(',
    'canCancelReplenishmentTask(task)',
    'cancelReplenishmentDisabledReason(task)',
    '补单已经开始生产或已完成，请到生产页面使用管理撤回',
    'cancelOrderVisible',
    'cancelHandlingPlanRows',
    'buildCancelHandlingPlanRows',
    'taskHasProductionProgress',
    'collectCancelHandlingPlan',
    'handleCancelHandlingModeChange',
    'erpApi.createAdditionalMaterial',
    'erpApi.createLineReplenishment',
    'erpApi.cancelReplenishment',
    'erpApi.updateLineQuantityAfterProductionStarted',
    'erpApi.cancelOrder',
    '订单已取消；如有已开工任务，通知已同步生产和仓库'
  ];
  for (const snippet of detailViewSnippets) {
    if (!detailViewSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must keep order change/cancellation dialog workflow snippet: ${snippet}`);
    }
  }

  const listViewSource = readFile(listViewPath);
  const listViewSnippets = [
    '<el-dialog v-model="cancelOrderVisible" title="取消订单"',
    '正常订单和补单订单都可以取消',
    'activeCancelOrderDetail',
    'activeCancelOrderDetail.value = await erpApi.order(row.orderNo)',
    'cancelHandlingPlanRows.value = buildCancelHandlingPlanRows(activeCancelOrderDetail.value)',
    "cancelOrderForm.productionCancelState = 'PRODUCED'",
    'taskHasProductionProgress',
    'buildCancelHandlingPlanRows',
    'collectCancelHandlingPlan',
    'handleCancelHandlingModeChange',
    'await erpApi.cancelOrder(activeCancelOrder.value.orderNo',
    'handlingPlan'
  ];
  for (const snippet of listViewSnippets) {
    if (!listViewSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must keep cancel order dialog workflow snippet: ${snippet}`);
    }
  }
  const planOverrideClearSnippets = [
    { source: listViewSource, file: 'OrdersListView.vue', snippet: 'function clearProductionPlanOverride(line: CreateOrderLinePayload)' },
    { source: listViewSource, file: 'OrdersListView.vue', snippet: 'line.productionPlanOverrideByName = \'\';' },
    { source: listViewSource, file: 'OrdersListView.vue', snippet: 'line.productionPlanOverrideByRole = \'\';' },
    { source: listViewSource, file: 'OrdersListView.vue', snippet: 'line.productionPlanOverrideAt = \'\';' },
    { source: detailViewSource, file: 'OrderDetailView.vue', snippet: 'function clearLineProductionPlanOverride(line: CreateOrderLinePayload)' },
    { source: detailViewSource, file: 'OrderDetailView.vue', snippet: 'line.productionPlanOverrideByName = \'\';' },
    { source: detailViewSource, file: 'OrderDetailView.vue', snippet: 'line.productionPlanOverrideByRole = \'\';' },
    { source: detailViewSource, file: 'OrderDetailView.vue', snippet: 'line.productionPlanOverrideAt = \'\';' }
  ];
  for (const item of planOverrideClearSnippets) {
    if (!item.source.includes(item.snippet)) {
      addFailure(`${item.file} must clear full production plan override snapshot when plan follows suggestion: ${item.snippet}`);
    }
  }

  const verifierSource = readFile(verifierPath);
  const verifierSnippets = [
    'await checkProductionNotices()',
    'PRODUCTION_NOTICE_DELTA_MISMATCH',
    'PRODUCTION_NOTICE_HANDLING_PLAN_INVALID',
    'PRODUCTION_NOTICE_HANDLING_PLAN_MODE_INVALID',
    'PRODUCTION_NOTICE_HANDLING_PLAN_QUANTITY_INVALID',
    'PRODUCTION_NOTICE_HANDLING_PLAN_NONE_QUANTITY_INVALID',
    'PRODUCTION_NOTICE_HANDLING_PLAN_OPERATOR_MISSING',
    'PRODUCTION_NOTICE_HANDLING_PLAN_MISSING',
    'CustomerChangeWarehouseScrap',
    "['QUANTITY_DECREASE', 'ORDER_CANCELLED'].includes(notice.noticeType)"
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep order change/cancellation data verification snippet: ${snippet}`);
    }
  }

  const seedSource = readFile(seedPath);
  const seedSnippets = [
    'async function seedReplenishmentAndNotices()',
    "noticeType: 'QUANTITY_INCREASE'",
    "reason: '种子数据：客户数量增加，等待生产确认'",
    "noticeType: 'MATERIAL_ADDED'",
    "noticeNo: 'PN-SEED-PRODUCTION-001'",
    "noticeNo: 'PN-SEED-WAREHOUSE-001'"
  ];
  for (const snippet of seedSnippets) {
    if (!seedSource.includes(snippet)) {
      addFailure(`seed.ts must keep order change/notice coverage snippet: ${snippet}`);
    }
  }
}

function verifyShortageReplenishmentClosureWorkflow() {
  const servicePath = 'backend/src/modules/orders/orders.service.ts';
  const detailViewPath = 'frontend/src/views/OrderDetailView.vue';
  const verifierPath = 'database/prisma/verify-first-stage.ts';

  for (const projectPath of [servicePath, detailViewPath, verifierPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing shortage replenishment closure workflow file: ${projectPath}`);
      return;
    }
  }

  const serviceSource = readFile(servicePath);
  const serviceSnippets = [
    'private toOrderUnresolvedShortageInfo(tasks: any[])',
    'const records = this.toEffectiveUnresolvedShortageRecords(tasks);',
    'needsReplenishmentAction: records.length > 0',
    'private toEffectiveUnresolvedShortageRecords(tasks: any[])',
    'const completedReplenishmentQuantityByLine = this.toCompletedReplenishmentQuantityByLine(tasks);',
    'const coveringQuantity = completedReplenishmentQuantityByLine.get(key) || 0;',
    'const usedQuantity = Math.min(record.shortageQuantity, coveringQuantity);',
    'const remainingQuantity = this.roundQuantity(record.shortageQuantity - usedQuantity);',
    'if (remainingQuantity <= 0)',
    'private toCompletedReplenishmentQuantityByLine(tasks: any[])',
    'this.toEffectiveTaskProductionStatus(task) !== ProductionStatus.COMPLETED',
    'this.toEffectiveTaskCompletedQuantity(task) || decimalToNumber(task.plannedQuantity)'
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`OrdersService must keep completed replenishment closing pending shortage snippet: ${snippet}`);
    }
  }

  const detailViewSource = readFile(detailViewPath);
  const detailViewSnippets = [
    'const linesNeedingReplenishmentAction = computed(() =>',
    'const orderNeedsReplenishmentAction = computed(() => linesNeedingReplenishmentAction.value.length > 0)',
    'const linesWithShortageRecords = computed(() =>',
    'const orderHasShortageRecords = computed(() => linesWithShortageRecords.value.length > 0)',
    '已处理短缺记录',
    'class="pending-shortage-panel resolved-shortage-panel',
    '已完成补单、客户数量调整或无需补单说明后，不再列入待处理提醒',
    'function lineCompletedReplenishmentText(line: OrderLine)',
    'return `补单已完成 ${formatQuantity(quantity, line.unit)}',
    'function lineNeedsReplenishmentAction(line: OrderLine)',
    'return Boolean(line.unresolvedShortageQuantity && line.unresolvedShortageQuantity > 0)',
    'linesNeedingReplenishmentAction.value[0] || linesWithShortageRecords.value[0]',
    'createReplenishmentFromShortage',
    'saveShortageNoReplenishment'
  ];
  for (const snippet of detailViewSnippets) {
    if (!detailViewSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must keep shortage replenishment closure UI snippet: ${snippet}`);
    }
  }

  const verifierSource = readFile(verifierPath);
  const verifierSnippets = [
    'checkProductionShortageResolutions',
    'completedReplenishmentQuantityByLineId',
    'completedReplenishmentCoveredCompletionIds',
    'task.status === ProductionStatus.COMPLETED || Boolean(task.inventoryBatch)',
    '!completedReplenishmentCoveredCompletionIds.has(completion.id)',
    'PRODUCTION_SHORTAGE_RESOLUTION_MODE_INVALID',
    'PRODUCTION_SHORTAGE_RESOLUTION_REASON_MISSING',
    'ORDER_REPLENISHMENT'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep shortage replenishment closure data verification snippet: ${snippet}`);
    }
  }
}

function verifyWarehouseWorkflow() {
  const controllerPath = 'backend/src/modules/warehouses/warehouses.controller.ts';
  const servicePath = 'backend/src/modules/warehouses/warehouses.service.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const viewPath = 'frontend/src/views/WarehouseView.vue';

  for (const projectPath of [controllerPath, servicePath, apiPath, viewPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing warehouse workflow file: ${projectPath}`);
      return;
    }
  }

  const controllerSource = readFile(controllerPath);
  const controllerSnippets = [
    "@Get('warehouse/notices')",
    "@Post('warehouse/notices/:id/acknowledge')",
    "@Get('warehouse/receipts/pending')",
    "@Post('warehouse/receipts/:productionTaskId/confirm')",
    "@Get('warehouse/shipments/pending')",
    "@Post('warehouse/shipments/:batchId/confirm')",
    "@Post('warehouse/shipments/batch-confirm')",
    "@Post('warehouse/shipments/orders/:orderNo/confirm')",
    "@Get('warehouse/transactions')"
  ];
  for (const snippet of controllerSnippets) {
    if (!controllerSource.includes(snippet)) {
      addFailure(`WarehousesController must keep first-stage warehouse endpoint: ${snippet}`);
    }
  }

  const serviceSource = readFile(servicePath);
  const serviceSnippets = [
    'async warehouseNotices(query: WarehouseNoticeQueryDto = {})',
    'target: ProductionNoticeTarget.WAREHOUSE',
    'async acknowledgeWarehouseNotice',
    'runSerializableTransaction',
    'async pendingReceipts(query: WarehouseWorkQueryDto)',
    'status: ProductionStatus.COMPLETED',
    'inventoryBatch: null',
    'async confirmReceipt(productionTaskId: string, dto: ConfirmReceiptDto)',
    'sourceRecordType: \'ProductionTask\'',
    'sourceRecordType: \'ProductionTaskOverage\'',
    'async pendingShipments(query: WarehouseWorkQueryDto)',
    'sourceOrderId: { not: null }',
    'quantity: { gt: 0 }',
    'async confirmShipment(batchId: string, dto: ConfirmShipmentDto)',
    'async confirmBatchShipment(dto: ConfirmBatchShipmentDto)',
    '批量发货只能选择同一个订单的库存批次',
    'async confirmOrderShipment(orderNo: string, dto: ConfirmShipmentDto)',
    'await this.refreshOrderShipmentStatus(tx, order.id)',
    'private async refreshOrderShipmentStatus',
    '只有全部订单库存发货完成后，订单才允许进入 COMPLETED。',
    'private toLineShippedQuantity',
    'sourceRecordType !== \'InventoryBatch\'',
    'async findTransactions(query: WarehouseTransactionQueryDto)',
    'buildWarehouseTransactionScopeWhere',
    '仓库流水可能是订单库存、备货库存、补单库存或订单库存发货，来源订单必须多字段兜底。'
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`WarehousesService must keep first-stage receipt/shipment/transaction snippet: ${snippet}`);
    }
  }

  const apiSource = readFile(apiPath);
  const apiSnippets = [
    'pendingReceipts(filters: WarehouseWorkFilters = {})',
    '/warehouse/receipts/pending',
    'confirmReceipt(productionTaskId: string, warehouseId: string, locationId: string, remark?: string)',
    'pendingShipments(filters: WarehouseWorkFilters = {})',
    '/warehouse/shipments/pending',
    'confirmShipment(batchId: string, remark?: string)',
    'confirmBatchShipment(batchIds: string[], remark?: string)',
    'confirmOrderShipment(orderNo: string, remark?: string)',
    'warehouseNotices(status?: ProductionNoticeStatus)',
    'acknowledgeWarehouseNotice(id: string, payload: AcknowledgeWarehouseNoticePayload | string)',
    'warehouseTransactions(filters: WarehouseTransactionFilters = {})'
  ];
  for (const snippet of apiSnippets) {
    if (!apiSource.includes(snippet)) {
      addFailure(`frontend api must keep warehouse workflow helper: ${snippet}`);
    }
  }

  const viewSource = readFile(viewPath);
  const viewSnippets = [
    '<DateRangeFilter',
    '<CustomerSelect',
    '<OrderSelect',
    'erpApi.pendingReceipts(warehouseWorkParams())',
    'erpApi.pendingShipments(warehouseWorkParams())',
    'erpApi.warehouseNotices()',
    'erpApi.warehouseTransactions',
    'function acknowledgeWarehouseNotice',
    'erpApi.acknowledgeWarehouseNotice',
    'async function confirmReceipt()',
    'erpApi.confirmReceipt',
    'async function confirmShipment()',
    'erpApi.confirmShipment',
    'async function confirmBatchShipment()',
    'erpApi.confirmBatchShipment',
    'erpApi.confirmOrderShipment',
    'shipmentSourceFocusBatchId',
    'DrawingPreviewLink',
    'OrderNoLink',
    ':file-name="activeReceipt.drawingFileName"',
    ':file-url="activeReceipt.drawingFileUrl"',
    'activeReceipt.partSpecification ||',
    ':file-name="activeShipment.drawingFileName"',
    ':file-url="activeShipment.drawingFileUrl"',
    'activeShipment ? partSpecText(activeShipment) :',
    '@click="openShipmentSourceDetails(activeShipment)"',
    '<el-table-column label="来源/图纸"',
    '@click="openShipmentSourceDetails(row)"',
    'function drawingTitle(row',
    'function partSpecText(row',
    'await queryWarehouseWork()'
  ];
  for (const snippet of viewSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`WarehouseView.vue must keep first-stage warehouse UI workflow snippet: ${snippet}`);
    }
  }
}

function verifyNoticeCustomerNameDisplay() {
  const productionServicePath = 'backend/src/modules/production/production.service.ts';
  const warehouseServicePath = 'backend/src/modules/warehouses/warehouses.service.ts';
  const typesPath = 'frontend/src/types/erp.ts';
  const productionViewPath = 'frontend/src/views/ProductionView.vue';
  const warehouseViewPath = 'frontend/src/views/WarehouseView.vue';
  const noticeDialogPath = 'frontend/src/components/NoticeAcknowledgeDialog.vue';

  for (const projectPath of [
    productionServicePath,
    warehouseServicePath,
    typesPath,
    productionViewPath,
    warehouseViewPath,
    noticeDialogPath
  ]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing notice customer display source file: ${projectPath}`);
      return;
    }
  }

  const serviceSnippets = [
    [productionServicePath, 'return this.toNoticesWithCustomerNames(notices);'],
    [productionServicePath, 'const customerNameByOrderId = new Map(orders.map((order) => [order.id, order.customerName]));'],
    [productionServicePath, 'customerNameByOrderId.get(notice.orderId) || customerNameByOrderNo.get(notice.orderNo) || undefined'],
    [warehouseServicePath, 'return this.toNoticesWithCustomerNames(notices);'],
    [warehouseServicePath, 'const customerNameByOrderId = new Map(orders.map((order) => [order.id, order.customerName]));'],
    [warehouseServicePath, 'customerNameByOrderId.get(notice.orderId) || customerNameByOrderNo.get(notice.orderNo) || undefined']
  ];

  for (const [projectPath, snippet] of serviceSnippets) {
    if (!readFile(projectPath).includes(snippet)) {
      addFailure(`${projectPath} must enrich production notices with customerName before returning them.`);
    }
  }

  const typesSource = readFile(typesPath);
  if (!/export\s+interface\s+ProductionNotice[\s\S]*customerName\?:\s*string;/.test(typesSource)) {
    addFailure('frontend ProductionNotice type must expose customerName for production and warehouse notice titles.');
  }

  const noticeDialogSource = readFile(noticeDialogPath);
  if (!noticeDialogSource.includes("<strong>{{ noticeTitle || '-' }}</strong>")) {
    addFailure('NoticeAcknowledgeDialog.vue must display the full noticeTitle passed by production/warehouse views.');
  }
  const noticeDialogResponsiveSnippets = [
    'class="responsive-dialog notice-acknowledge-dialog"',
    'overflow-wrap: anywhere'
  ];
  for (const snippet of noticeDialogResponsiveSnippets) {
    if (!noticeDialogSource.includes(snippet)) {
      addFailure(`NoticeAcknowledgeDialog.vue must keep responsive notice dialog snippet: ${snippet}`);
    }
  }

  const productionViewSource = readFile(productionViewPath);
  const productionViewSnippets = [
    'function productionNoticeTitle(notice: ProductionNotice)',
    '[notice.customerName, notice.orderNo, notice.partCode, notice.partName]',
    ':notice-title="activeProductionNotice ? productionNoticeTitle(activeProductionNotice) : \'\'"'
  ];
  for (const snippet of productionViewSnippets) {
    if (!productionViewSource.includes(snippet)) {
      addFailure(`ProductionView.vue must keep customerName in production notice title snippet: ${snippet}`);
    }
  }

  const warehouseViewSource = readFile(warehouseViewPath);
  const warehouseViewSnippets = [
    'function warehouseNoticeTitle(notice: ProductionNotice)',
    '[notice.customerName, notice.orderNo, notice.partCode, notice.partName]',
    ':notice-title="activeWarehouseNotice ? warehouseNoticeTitle(activeWarehouseNotice) : \'\'"'
  ];
  for (const snippet of warehouseViewSnippets) {
    if (!warehouseViewSource.includes(snippet)) {
      addFailure(`WarehouseView.vue must keep customerName in warehouse notice title snippet: ${snippet}`);
    }
  }
}

function verifyInventoryTransactionOrderLineTraceability() {
  const schemaPath = 'database/prisma/schema.prisma';
  const warehousesServicePath = 'backend/src/modules/warehouses/warehouses.service.ts';
  const warehousesDtoPath = 'backend/src/modules/warehouses/dto.ts';
  const statisticsServicePath = 'backend/src/modules/statistics/statistics.service.ts';
  const seedPath = 'database/prisma/seed.ts';
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  const repairPath = 'database/prisma/repair-first-stage.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const warehouseViewPath = 'frontend/src/views/WarehouseView.vue';

  for (const projectPath of [
    schemaPath,
    warehousesServicePath,
    warehousesDtoPath,
    statisticsServicePath,
    seedPath,
    verifierPath,
    repairPath,
    apiPath,
    warehouseViewPath
  ]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing inventory transaction order-line traceability file: ${projectPath}`);
      return;
    }
  }

  const requiredByFile = [
    [
      schemaPath,
      [
        'orderLineId            String?',
        'orderLine              OrderLine?',
        '@@index([orderLineId])'
      ]
    ],
    [
      warehousesDtoPath,
      [
        'shipmentQuantity!: number',
        'batchShipments?: ConfirmShipmentItemDto[]',
        'warehouseConfirmedBy?: string',
        'salesConfirmedBy?: string',
        'overShipmentReason?: string'
      ]
    ],
    [
      warehousesServicePath,
      [
        'orderLineId: batch.sourceOrderLineId || targetOrderLine?.id',
        'getShippedQuantityForTargetOrderLine',
        'getShippedOrderQuantityMap',
        'salesConfirmedBy?.trim()',
        'overShipmentReason?.trim()',
        'for (const item of dto.batchShipments || [])',
        'sourceOrderId: null',
        'sourceRecordType: \'InventoryBatch\''
      ]
    ],
    [
      statisticsServicePath,
      [
        'shippedQuantityByOrderLineId',
        'completedFulfillmentQuantityByOrderLineId',
        'transaction.orderLineId || transaction.batch?.sourceOrderLineId',
        'allLinesReached(lines, shippedQuantityByLineId)',
        'hasLineShipmentData',
        'hasLineFulfillmentData'
      ]
    ],
    [
      seedPath,
      [
        'orderLineId: savedLine.id',
        'orderLineId: batch.sourceOrderLineId',
        'sourceRecordType: \'OrderLineStockAllocation\''
      ]
    ],
    [
      verifierPath,
      [
        'checkInventoryTransactionOrderLineLinks',
        'INVENTORY_TRANSACTION_ORDER_LINE_MISSING',
        'INVENTORY_TRANSACTION_ORDER_LINE_ORDER_MISMATCH',
        'sourceRecordType: \'InventoryBatch\''
      ]
    ],
    [
      repairPath,
      [
        'collectShipmentStatusRepairs',
        'shippedQuantityByLineUnit',
        'transaction.orderLineId || transaction.batch?.sourceOrderLineId',
        'lineShippedQuantity'
      ]
    ],
    [
      apiPath,
      [
        'shipmentQuantity: number',
        'batchShipments?: ConfirmShipmentItemPayload[]',
        'salesConfirmedBy?: string',
        'overShipmentReason?: string'
      ]
    ],
    [
      warehouseViewPath,
      [
        'isStockOverShipment',
        'batchShipmentRows',
        'batchShipments',
        'salesConfirmedBy',
        'overShipmentReason',
        'currentShipmentQuantity',
        'orderLineId: row.isStockOverShipment ? row.targetOrderLineId || row.orderLineId : row.orderLineId'
      ]
    ]
  ];

  for (const [projectPath, snippets] of requiredByFile) {
    const source = readFile(projectPath);
    for (const snippet of snippets) {
      if (!source.includes(snippet)) {
        addFailure(`${projectPath} must keep inventory transaction order-line traceability snippet: ${snippet}`);
      }
    }
  }
}

function verifyPartialShipmentWorkflow() {
  const dtoPath = 'backend/src/modules/warehouses/dto.ts';
  const servicePath = 'backend/src/modules/warehouses/warehouses.service.ts';
  const viewPath = 'frontend/src/views/WarehouseView.vue';
  const orderStatusPath = 'frontend/src/utils/orderStatus.ts';
  const statusTagPath = 'frontend/src/components/StatusTag.vue';
  const seedPath = 'database/prisma/seed.ts';
  const verifierPath = 'database/prisma/verify-first-stage.ts';

  for (const projectPath of [dtoPath, servicePath, viewPath, orderStatusPath, statusTagPath, seedPath, verifierPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing partial shipment workflow file: ${projectPath}`);
      return;
    }
  }

  const dtoSource = readFile(dtoPath);
  const dtoSnippets = [
    'export class ConfirmShipmentItemDto',
    'shipmentQuantity!: number',
    'export class ConfirmShipmentDto',
    'warehouseConfirmedBy?: string',
    'salesConfirmedBy?: string',
    'overShipmentReason?: string',
    'shipmentQuantity?: number',
    'batchShipments?: ConfirmShipmentItemDto[]'
  ];
  for (const snippet of dtoSnippets) {
    if (!dtoSource.includes(snippet)) {
      addFailure(`warehouses dto must keep editable partial shipment payload snippet: ${snippet}`);
    }
  }

  const serviceSource = readFile(servicePath);
  const serviceSnippets = [
    'async confirmShipment(batchId: string, dto: ConfirmShipmentDto)',
    "await this.assertOrderHasNoPendingShortage(tx, batch.sourceOrderId, '单批发货');",
    'async confirmOrderShipment(orderNo: string, dto: ConfirmShipmentDto)',
    '待提交生产订单不能发货，请先提交生产并形成待发货库存',
    '已完成发货订单不能再次发货',
    'const orderShipmentRequest = this.normalizeShipmentItems(dto);',
    'async confirmBatchShipment(dto: ConfirmBatchShipmentDto)',
    "await this.assertOrderHasNoPendingShortage(tx, orderIds[0], '批量发货');",
    "await this.assertOrderHasNoPendingShortage(tx, order.id, '整单发货');",
    'shipmentQuantity: batchShipmentRequest.quantityByBatchId.get(batchId) ?? dto.shipmentQuantity',
    'const requestedBatchIds = Array.from(new Set(dto.batchIds.map((item) => item.trim()).filter(Boolean)))',
    '批量发货数量明细包含未勾选的库存批次',
    'private normalizeShipmentItems(dto: ConfirmShipmentDto)',
    'for (const item of dto.batchShipments || [])',
    'if (shipmentQuantity <= 0)',
    'if (quantityByBatchId.has(batchId))',
    '同一个库存批次不能重复填写发货数量',
    'hasExplicitQuantities: Boolean(dto.batchShipments && dto.batchShipments.length > 0)',
    'if (orderShipmentRequest.hasExplicitQuantities && orderShipmentRequest.batchIds.length === 0)',
    'if (batchIds.length === 0)',
    'shipmentQuantity > availableQuantity + 0.0001',
    'sourceOrder: { select: { status: true } }',
    '已取消订单库存不能发货',
    '已完成发货订单库存不能再次发货',
    'const remainingOrderQuantity =',
    'const overShipmentQuantity = this.roundQuantity(Math.max(shipmentQuantity - remainingOrderQuantity, 0));',
    '本次发货超过订单未发货数量，必须填写销售确认人',
    '本次发货超过订单未发货数量，必须填写超发说明',
    'orderLineId: batch.sourceOrderLineId || targetOrderLine?.id',
    "sourceRecordType: 'InventoryBatch'",
    'await this.refreshOrderShipmentStatus(tx, order.id);',
    'private async isOrderShipmentClosed',
    'getShippedOrderQuantityMap',
    'status: { notIn: [OrderStatus.DRAFT, OrderStatus.CANCELLED, OrderStatus.COMPLETED] }',
    'orderStatus: batch.sourceOrder?.status',
    'const remainingSuggestionQuantityByLine = new Map<string, number>();',
    'this.toShipment(batch, shippedQuantityByLine, remainingSuggestionQuantityByLine)',
    'const suggestedShipmentQuantity = Math.min(availableQuantity, Math.max(suggestionRemaining, 0));',
    'remainingSuggestionQuantityByLine.set(',
    'this.roundQuantity(Math.max(suggestionRemaining - suggestedShipmentQuantity, 0))'
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`WarehousesService must keep partial shipment/over-shipment business rule snippet: ${snippet}`);
    }
  }

  const viewSource = readFile(viewPath);
  const viewSnippets = [
    'label="已发货"',
    'label="未发货"',
    'label="本次发货"',
    'v-model="shipmentForm.shipmentQuantity"',
    'const activeShipmentQuantityAdjustmentText = computed',
    'v-model="row.currentShipmentQuantity"',
    'class="shipment-adjustment-note"',
    'function shipmentQuantityAdjustmentText(row: EditableWarehouseShipment)',
    'const activeShipmentShortageText = computed(() => shipmentShortageText(activeShipment.value));',
    'function shipmentShortageText(row?: WarehouseShipment)',
    'function shipmentLockedText(row?: WarehouseShipment)',
    'function canShipWarehouseShipment(row?: WarehouseShipment)',
    ':selectable="shipmentRowSelectable"',
    'function shipmentRowSelectable(row: WarehouseShipment)',
    'selectedShipments.value = rows.filter(canShipWarehouseShipment);',
    '.filter((item) => item.orderNo === orderNo && canShipWarehouseShipment(item))',
    'const selectedShipmentLockedText = computed',
    'const batchShipmentLockedText = computed',
    '订单已完成发货，不能再次发货',
    'const lockedText = shipmentLockedText(activeShipment.value);',
    'const lockedRow = batchShipmentRows.value.find((row) => !canShipWarehouseShipment(row));',
    ':disabled="Boolean(batchShipmentLockedText) || Boolean(batchShipmentShortageText)"',
    '该订单仍有待补单短缺，暂不能单批发货',
    'goActiveShipmentShortageDetail',
    ':disabled="Boolean(activeShipmentShortageText)"',
    'function defaultShipmentQuantity(row: WarehouseShipment)',
    'const suggestedQuantity = Number(row.suggestedShipmentQuantity || 0)',
    'return remainingQuantity > 0 ? Math.min(Number(row.quantity || 0), remainingQuantity) : 0',
    'function formatShipmentLineTotal(rows: EditableWarehouseShipment[], field: keyof EditableWarehouseShipment)',
    'const seenLineKeys = new Set<string>();',
    'if (seenLineKeys.has(lineKey))',
    'function formatBatchShipmentOverText(rows: EditableWarehouseShipment[])',
    'const lineMap = new Map<string, { current: number; remaining: number; unit: string }>();',
    'existing.current += current',
    'const overQuantity = Math.max(item.current - item.remaining, 0);',
    'row.isStockOverShipment && Number(row.currentShipmentQuantity || 0) > 0',
    'const batchShipmentRequiresSalesConfirmation = computed',
    'activeShipmentOverQuantity > 0',
    '本次发货超过订单未发货数量或使用备货库存，必须填写销售确认人',
    '本次发货超过订单未发货数量或使用备货库存，必须填写超发说明',
    'appendStockOverShipment',
    'isStockOverShipment',
    'orderLineId: row.isStockOverShipment ? row.targetOrderLineId || row.orderLineId : row.orderLineId',
    'ElMessage.success(\'本次发货已确认，订单状态已重新计算\')'
  ];
  for (const snippet of viewSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`WarehouseView.vue must keep partial shipment UI snippet: ${snippet}`);
    }
  }

  const orderStatusSource = readFile(orderStatusPath);
  const orderStatusSnippets = [
    "order.warehouseStage === 'PARTIAL_SHIPPED'",
    "return 'PARTIAL_SHIPPED'",
    "order.warehouseStage === 'SHIPPED'",
    "return 'ORDER_SHIPPED_COMPLETED'"
  ];
  for (const snippet of orderStatusSnippets) {
    if (!orderStatusSource.includes(snippet)) {
      addFailure(`orderStatus.ts must keep partial shipment display rule: ${snippet}`);
    }
  }

  const statusTagSource = readFile(statusTagPath);
  if (!/PARTIAL_SHIPPED:\s*['"`]部分发货['"`]/.test(statusTagSource)) {
    addFailure('StatusTag.vue must render PARTIAL_SHIPPED as "部分发货".');
  }

  const seedSource = readFile(seedPath);
  const seedSnippets = [
    "await seedOrderShipment('SO-20260506-003', 'PARTIAL'",
    "await seedOrderShipment('SO-20260506-006', 'FULL'",
    "orderNo: 'SO-20260506-003'",
    '用于验证已完成未发货状态'
  ];
  for (const snippet of seedSnippets) {
    if (!seedSource.includes(snippet)) {
      addFailure(`seed.ts must keep partial/full shipment verification data snippet: ${snippet}`);
    }
  }

  const verifierSource = readFile(verifierPath);
  const verifierSnippets = [
    'FULLY_SHIPPED_ORDER_STATUS_STALE',
    'COMPLETED_ORDER_NOT_FULLY_SHIPPED',
    'COMPLETED_ORDER_HAS_AVAILABLE_SHIPMENT_BATCH',
    'CANCELLED_ORDER_HAS_AVAILABLE_SHIPMENT_BATCH',
    'DRAFT_ORDER_HAS_AVAILABLE_SHIPMENT_BATCH',
    'ORDER_COMPLETED_UNSHIPPED',
    'ORDER_SHIPPED_COMPLETED',
    'sourceRecordType: \'InventoryBatch\'',
    'INVENTORY_TRANSACTION_ORDER_LINE_MISSING',
    'transaction.batch?.sourceOrderLineId && transaction.batch.sourceOrderLineId !== transaction.orderLineId'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep partial shipment status verification snippet: ${snippet}`);
    }
  }
}

function verifySharedLinkComponents() {
  const orderNoLinkPath = 'frontend/src/components/OrderNoLink.vue';
  const drawingPreviewLinkPath = 'frontend/src/components/DrawingPreviewLink.vue';
  if (!fileExists(orderNoLinkPath) || !fileExists(drawingPreviewLinkPath)) {
    return;
  }

  const orderNoLinkSource = readFile(orderNoLinkPath);
  const orderNoLinkRequiredSnippets = ['<RouterLink', 'normalizeReturnTo', "path.startsWith('//')", 'max-width: 100%', 'overflow-wrap: anywhere'];
  for (const snippet of orderNoLinkRequiredSnippets) {
    if (!orderNoLinkSource.includes(snippet)) {
      addFailure(`OrderNoLink.vue must keep internal RouterLink navigation and sanitized returnTo handling: missing ${snippet}`);
    }
  }

  const drawingPreviewSource = readFile(drawingPreviewLinkPath);
  const drawingPreviewRequiredSnippets = [
    '<el-dialog',
    'responsive-dialog',
    'isImageDrawing',
    'isPdfDrawing',
    'normalizeDisplayFileName',
    'displayFileName',
    'fileNameFromUrl',
    'props.fileName || fileNameFromUrl(props.fileUrl)',
    'split(/[?#]/)',
    '@media (max-width: 900px)',
    'min-height: 44px',
    'overflow-wrap: anywhere',
    '打开或下载图纸'
  ];
  for (const snippet of drawingPreviewRequiredSnippets) {
    if (!drawingPreviewSource.includes(snippet)) {
      addFailure(`DrawingPreviewLink.vue must keep shared preview/open behavior: missing ${snippet}`);
    }
  }

  const orderNoLinkConsumers = [
    'frontend/src/views/OrdersListView.vue',
    'frontend/src/views/ProcessSelectionView.vue',
    'frontend/src/views/ProductionView.vue',
    'frontend/src/views/WarehouseView.vue',
    'frontend/src/views/InventoryView.vue',
    'frontend/src/views/StatisticsView.vue'
  ];

  for (const viewPath of orderNoLinkConsumers) {
    if (!fileExists(viewPath)) {
      addFailure(`Missing order link consumer view: ${viewPath}`);
      continue;
    }

    const source = readFile(viewPath);
    if (!source.includes('<OrderNoLink') || !source.includes('OrderNoLink from')) {
      addFailure(`${viewPath} must reuse OrderNoLink.vue for orderNo/sourceOrderNo navigation.`);
    }
  }

  const drawingPreviewConsumers = [
    'frontend/src/views/OrderDetailView.vue',
    'frontend/src/views/ProductionView.vue',
    'frontend/src/views/WarehouseView.vue',
    'frontend/src/views/InventoryView.vue',
    'frontend/src/components/OrderLineEditor.vue',
    'frontend/src/components/InventorySourceDetailsDialog.vue'
  ];

  for (const viewPath of drawingPreviewConsumers) {
    if (!fileExists(viewPath)) {
      addFailure(`Missing drawing preview consumer: ${viewPath}`);
      continue;
    }

    const source = readFile(viewPath);
    if (!source.includes('<DrawingPreviewLink') || !source.includes('DrawingPreviewLink from')) {
      addFailure(`${viewPath} must reuse DrawingPreviewLink.vue for drawing preview/open entries.`);
    }
  }
}

function verifyDrawingDuplicateConfirmationWorkflow() {
  const duplicateUtilPath = 'frontend/src/utils/orderLineDuplicateChecks.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const ordersListPath = 'frontend/src/views/OrdersListView.vue';
  const orderDetailPath = 'frontend/src/views/OrderDetailView.vue';
  const orderLineEditorPath = 'frontend/src/components/OrderLineEditor.vue';
  const controllerPath = 'backend/src/modules/orders/orders.controller.ts';
  const servicePath = 'backend/src/modules/orders/orders.service.ts';
  const requiredFiles = [
    duplicateUtilPath,
    apiPath,
    ordersListPath,
    orderDetailPath,
    orderLineEditorPath,
    controllerPath,
    servicePath
  ];

  for (const projectPath of requiredFiles) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing drawing duplicate confirmation workflow file: ${projectPath}`);
    }
  }
  if (requiredFiles.some((projectPath) => !fileExists(projectPath))) {
    return;
  }

  const duplicateSource = readFile(duplicateUtilPath);
  const noConflictText =
    '\u4e0d\u540c\u96f6\u4ef6\u7f16\u53f7\uff0c\u56fe\u53f7\u51b2\u7a81\uff0c\u8bf7\u786e\u8ba4\u662f\u5426\u7ee7\u7eed\u4f7f\u7528\u76f8\u540c\u56fe\u53f7';
  const conflictTitle = '\u56fe\u53f7\u6216\u7248\u672c\u53f7\u51b2\u7a81';
  const continueUseText = '\u7ee7\u7eed\u4f7f\u7528';
  const duplicateUtilSnippets = [
    'function renderDrawingNoConflictHtml',
    noConflictText,
    conflictTitle,
    `confirmText: '${continueUseText}'`,
    '\u96f6\u4ef6 ${escapeHtml(partCode)} \u56fe\u53f7\uff1a${escapeHtml(drawingNo)}, \u7248\u672c\u53f7${escapeHtml(drawingVersion)}',
    'export async function confirmDuplicateDrawingNos',
    'export async function confirmDuplicateDrawingFiles',
    'export async function confirmExistingDrawingNos',
    'export async function confirmExistingDrawingFiles',
    'export async function confirmUploadDrawingFileName',
    'confirmDrawingDuplicateDialog',
    'normalizeDisplayFileName',
    'displayDrawingFileName',
    'ElDialog',
    'innerHTML: options.html',
    'closeOnClickModal: false',
    'renderExistingDrawingPreview(match)',
    'renderSelectedDrawingPreview(file, selectedFileUrl)',
    'URL.revokeObjectURL(selectedFileUrl)'
  ];
  for (const snippet of duplicateUtilSnippets) {
    if (!duplicateSource.includes(snippet)) {
      addFailure(`orderLineDuplicateChecks.ts must keep drawing duplicate confirmation snippet: ${snippet}`);
    }
  }
  if (/window\s*\.\s*(alert|confirm|prompt)\s*\(/.test(duplicateSource)) {
    addFailure('orderLineDuplicateChecks.ts must use Element Plus dialogs, not native window dialogs.');
  }

  const apiSource = readFile(apiPath);
  const apiSnippets = [
    'export interface DrawingDuplicateMatch',
    'duplicateDrawingNos(value: string, excludeOrderNo?: string)',
    '/orders/drawings/duplicate-nos',
    'duplicateDrawingFiles(value: string, excludeOrderNo?: string)',
    '/orders/drawings/duplicate-files'
  ];
  for (const snippet of apiSnippets) {
    if (!apiSource.includes(snippet)) {
      addFailure(`erp.ts must keep drawing duplicate API contract snippet: ${snippet}`);
    }
  }

  const controllerSource = readFile(controllerPath);
  const controllerSnippets = [
    "@Get('drawings/duplicate-nos')",
    'return this.ordersService.findDuplicateDrawingNos(query.value, query.excludeOrderNo)',
    "@Get('drawings/duplicate-files')",
    'return this.ordersService.findDuplicateDrawingFiles(query.value, query.excludeOrderNo)'
  ];
  for (const snippet of controllerSnippets) {
    if (!controllerSource.includes(snippet)) {
      addFailure(`orders.controller.ts must keep drawing duplicate endpoint snippet: ${snippet}`);
    }
  }

  const serviceSource = readFile(servicePath);
  const serviceSnippets = [
    'async findDuplicateDrawingNos(value: string, excludeOrderNo?: string)',
    "return this.findDuplicateOrderLines('drawingNo', value, excludeOrderNo);",
    'async findDuplicateDrawingFiles(value: string, excludeOrderNo?: string)',
    "return this.findDuplicateOrderLines('drawingFileName', value, excludeOrderNo);",
    "private async findDuplicateOrderLines(field: 'drawingNo' | 'drawingFileName', value: string, excludeOrderNo?: string)",
    "mode: 'insensitive'",
    'where.order = { orderNo: { not: this.normalizeOrderNo(excludeOrderNo) } };',
    'customerName: true',
    'drawingVersion: line.drawingVersion',
    'drawingFileUrl: line.drawingFileUrl'
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`orders.service.ts must keep drawing duplicate backend fallback snippet: ${snippet}`);
    }
  }

  const ordersListSource = readFile(ordersListPath);
  const ordersListSnippets = [
    'WarningFilled',
    'class="duplicate-help-button"',
    'aria-label="\u56fe\u7eb8\u91cd\u590d\u89c4\u5219\u8bf4\u660e"',
    '\u56fe\u7eb8\u4e0e\u56fe\u53f7\u4f7f\u7528\u8bf4\u660e',
    '\u56fe\u53f7\u53ef\u80fd\u8de8\u96f6\u4ef6\u590d\u7528',
    '\u4fdd\u5b58\u65f6\u4f1a\u540c\u65f6\u68c0\u67e5\u5f53\u524d\u8ba2\u5355\u548c\u5386\u53f2\u8ba2\u5355\u4e2d\u7684\u56fe\u53f7\u3001\u56fe\u7eb8\u6587\u4ef6\u540d',
    'confirmDuplicateDrawingNos(orderForm.lines)',
    'confirmDuplicateDrawingFiles(orderForm.lines)',
    'confirmExistingDrawingNos(orderForm.lines)',
    'confirmExistingDrawingFiles(orderForm.lines)'
  ];
  for (const snippet of ordersListSnippets) {
    if (!ordersListSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must confirm duplicate drawing data before saving new orders: ${snippet}`);
    }
  }

  const orderDetailSource = readFile(orderDetailPath);
  const orderDetailSnippets = [
    'WarningFilled',
    'class="duplicate-help-button"',
    'aria-label="\u56fe\u7eb8\u91cd\u590d\u89c4\u5219\u8bf4\u660e"',
    '\u56fe\u7eb8\u4e0e\u56fe\u53f7\u4f7f\u7528\u8bf4\u660e',
    '\u56fe\u53f7\u53ef\u80fd\u8de8\u96f6\u4ef6\u590d\u7528',
    '\u4fdd\u5b58\u65f6\u4f1a\u540c\u65f6\u68c0\u67e5\u5f53\u524d\u8ba2\u5355\u548c\u5386\u53f2\u8ba2\u5355\u4e2d\u7684\u56fe\u53f7\u3001\u56fe\u7eb8\u6587\u4ef6\u540d',
    'confirmDuplicateDrawingNos(editForm.value.lines)',
    'confirmDuplicateDrawingFiles(editForm.value.lines)',
    'confirmExistingDrawingNos(editForm.value.lines, order.value.orderNo)',
    'confirmExistingDrawingFiles(editForm.value.lines, order.value.orderNo)',
    'confirmDuplicateDrawingNos([payload])',
    'confirmDuplicateDrawingFiles([payload])',
    'confirmExistingDrawingNos([payload], order.value.orderNo)',
    'confirmExistingDrawingFiles([payload], order.value.orderNo)'
  ];
  for (const snippet of orderDetailSnippets) {
    if (!orderDetailSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must confirm duplicate drawing data before saving edited or added lines: ${snippet}`);
    }
  }

  const orderLineEditorSource = readFile(orderLineEditorPath);
  const orderLineEditorSnippets = [
    'confirmUploadDrawingFileName',
    'await confirmUploadDrawingFileName(file, props.lines, line, props.excludeOrderNo)',
    'line.drawingFileName = result.fileName',
    'line.drawingFileUrl = result.fileUrl'
  ];
  for (const snippet of orderLineEditorSnippets) {
    if (!orderLineEditorSource.includes(snippet)) {
      addFailure(`OrderLineEditor.vue must confirm duplicate drawing file names before upload: ${snippet}`);
    }
  }
}

function verifyNoInlineCustomerDropdowns() {
  const allowedPath = resolveProjectPath('frontend/src/components/CustomerSelect.vue');
  const viewRoot = resolveProjectPath('frontend/src');
  const suspiciousPatterns = [/customerOptions/, /<el-option[^\n]+customer/i];

  for (const filePath of walkFiles(viewRoot)) {
    if (filePath === allowedPath) {
      continue;
    }

    const source = fs.readFileSync(filePath, 'utf8');
    if (suspiciousPatterns.some((pattern) => pattern.test(source))) {
      addFailure(`Customer dropdowns should reuse CustomerSelect.vue: ${toProjectPath(filePath)}`);
    }
  }
}

function isAllowedSliceLimit(filePath, lines, index) {
  const projectPath = toProjectPath(filePath);
  const line = lines[index];
  const context = lines.slice(Math.max(0, index - 4), Math.min(lines.length, index + 5)).join('\n');

  if (/toISOString\(\)\.slice\(0,\s*(10|19)\)/.test(line)) {
    return true;
  }
  if (/deliveryDate.*\.slice\(0,\s*10\)/.test(line) || /default-delivery-date=.*\.slice\(0,\s*10\)/.test(line)) {
    return true;
  }
  if (/randomUUID\(\)\.slice\(0,\s*\d+\)/.test(line) || /randomUUID\(\)[\s\S]*\.slice\(0,\s*\d+\)/.test(context)) {
    return true;
  }
  if (/order\.inventoryBatches\.slice\(0,\s*1\)/.test(line) && projectPath === 'database/prisma/seed.ts') {
    return true;
  }
  if (/\.slice\(0,\s*3\)/.test(line) && /reservationRows|batch\.reservations/.test(context)) {
    return true;
  }
  if (/\.slice\(0,\s*4\)/.test(line) && /orderProgressHint|visibleLines|startedLines/.test(context)) {
    return true;
  }
  if (/\.slice\(0,\s*60\)/.test(line) && /safe.*FileName|file\.originalname|baseName/.test(context)) {
    return true;
  }
  if (/name\.slice\(0,\s*templateNameMaxLength\)/.test(line) || /baseName\.slice\(0,\s*templateNameMaxLength/.test(line)) {
    return true;
  }
  if (/\.slice\(0,\s*2\)/.test(line) && /limitedReservations|row\.reservations/.test(context)) {
    return true;
  }

  return false;
}

function verifyNoSilentSearchResultLimits() {
  const scanRoots = ['frontend/src', 'backend/src', 'database/prisma']
    .map(resolveProjectPath)
    .filter((dir) => fs.existsSync(dir));

  const checks = [
    { name: 'Prisma take', pattern: /\btake\s*:\s*\d+/ },
    { name: 'result limit', pattern: /\blimit\s*:\s*\d+/ },
    { name: 'pageSize', pattern: /\bpageSize\s*[:=]\s*\d+/ },
    { name: 'array slice', pattern: /\.slice\s*\(\s*0\s*,\s*\d+/ }
  ];

  for (const filePath of scanRoots.flatMap((dir) => walkFiles(dir))) {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const check of checks) {
        if (!check.pattern.test(line)) {
          continue;
        }
        if (check.name === 'array slice' && isAllowedSliceLimit(filePath, lines, index)) {
          continue;
        }
        addFailure(
          `Search/filter/autocomplete results must not be silently limited with ${check.name}: ${toProjectPath(filePath)}:${index + 1}`
        );
      }
    });
  }
}

function verifyStatisticsDisplayContract() {
  const statusTagPath = 'frontend/src/components/StatusTag.vue';
  const statisticsViewPath = 'frontend/src/views/StatisticsView.vue';
  const statisticsServicePath = 'backend/src/modules/statistics/statistics.service.ts';

  if (!fileExists(statusTagPath)) {
    addFailure(`Missing StatusTag component: ${statusTagPath}`);
    return;
  }
  if (!fileExists(statisticsViewPath)) {
    addFailure(`Missing statistics view: ${statisticsViewPath}`);
    return;
  }
  if (!fileExists(statisticsServicePath)) {
    addFailure(`Missing statistics service: ${statisticsServicePath}`);
    return;
  }

  const statusTagSource = readFile(statusTagPath);
  const statisticsViewSource = readFile(statisticsViewPath);
  const statisticsServiceSource = readFile(statisticsServicePath);

  const requiredLabels = [
    { status: 'ORDER_SHIPPED_COMPLETED', label: '已完成发货' },
    { status: 'ORDER_COMPLETED_UNSHIPPED', label: '已完成未发货' },
    { status: 'ORDER_IN_PRODUCTION', label: '生产中' },
    { status: 'WAITING_PRODUCTION', label: '待确认生产' },
    { status: 'ORDER_DRAFT', label: '待提交生产' }
  ];

  for (const item of requiredLabels) {
    const pattern = new RegExp(`${item.status}:\\s*['"\`]${item.label}['"\`]`);
    if (!pattern.test(statusTagSource)) {
      addFailure(`StatusTag.vue must map ${item.status} to "${item.label}".`);
    }
  }

  if (!/function\s+statisticsOrderStatus\s*\([^)]*\)\s*{[\s\S]*return\s+row\.statisticsStatus\s*\|\|\s*orderDisplayStatus\(row\);[\s\S]*}/.test(statisticsViewSource)) {
    addFailure('StatisticsView.vue must prefer backend row.statisticsStatus before frontend fallback orderDisplayStatus(row).');
  }

  const requiredStatisticsViewSnippets = [
    "import CustomerSelect from '../components/CustomerSelect.vue';",
    '<CustomerSelect v-model="customerId"',
    'customerId: customerId.value || undefined'
  ];
  for (const snippet of requiredStatisticsViewSnippets) {
    if (!statisticsViewSource.includes(snippet)) {
      addFailure(`StatisticsView.vue must keep first-stage customerId filter contract snippet: ${snippet}`);
    }
  }

  const statisticsApiCalls = [...statisticsViewSource.matchAll(/erpApi\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const unexpectedStatisticsApiCalls = statisticsApiCalls.filter((methodName) => methodName !== 'orderStatistics');
  if (unexpectedStatisticsApiCalls.length > 0) {
    addFailure(
      `StatisticsView.vue must remain read-only and only call erpApi.orderStatistics; found erpApi.${[
        ...new Set(unexpectedStatisticsApiCalls)
      ].join(', erpApi.')}.`
    );
  }
  if (!statisticsViewSource.includes('统计页为只读页面，筛选只限制展示范围，不提供任何订单、生产、仓库操作。')) {
    addFailure('StatisticsView.vue must keep a first-stage read-only comment for the statistics page.');
  }

  const requiredServiceSnippets = [
    "sourceRecordType: 'InventoryBatch'",
    "sourceRecordType: 'OrderLineStockAllocation'",
    "sourceRecordType: 'ProductionTask'",
    "return 'ORDER_SHIPPED_COMPLETED'",
    "return 'ORDER_COMPLETED_UNSHIPPED'",
    "return 'ORDER_IN_PRODUCTION'"
  ];

  for (const snippet of requiredServiceSnippets) {
    if (!statisticsServiceSource.includes(snippet)) {
      addFailure(`StatisticsService must keep first-stage statistics contract snippet: ${snippet}`);
    }
  }

  const statisticsWritePattern = /this\.prisma\.[A-Za-z0-9_]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
  if (statisticsWritePattern.test(statisticsServiceSource)) {
    addFailure('StatisticsService must remain read-only and must not write through Prisma models.');
  }
}

function verifySharedOrderDisplayStatus() {
  const orderStatusPath = 'frontend/src/utils/orderStatus.ts';
  if (!fileExists(orderStatusPath)) {
    addFailure(`Missing shared order display status utility: ${orderStatusPath}`);
    return;
  }

  const source = readFile(orderStatusPath);
  if (!source.includes('export function orderDisplayStatus')) {
    addFailure('orderStatus.ts must export shared orderDisplayStatus utility.');
  }
  const requiredStatusRules = [
    { name: 'draft order', pattern: /order\.status === 'DRAFT'[\s\S]*?return 'ORDER_DRAFT'/ },
    { name: 'cancelled order', pattern: /order\.status === 'CANCELLED'[\s\S]*?return 'ORDER_CANCELLED'/ },
    { name: 'shipped warehouse stage', pattern: /order\.warehouseStage === 'SHIPPED'[\s\S]*?return 'ORDER_SHIPPED_COMPLETED'/ },
    {
      name: 'completed order means shipped',
      pattern: /!order\.warehouseStage && order\.status === 'COMPLETED'[\s\S]*?return 'ORDER_SHIPPED_COMPLETED'/
    },
    {
      name: 'completed production before shipment',
      pattern: /order\.productionStatus === 'COMPLETED'[\s\S]*?return 'ORDER_COMPLETED_UNSHIPPED'/
    },
    { name: 'in production order', pattern: /order\.status === 'IN_PRODUCTION'[\s\S]*?return 'ORDER_IN_PRODUCTION'/ },
    { name: 'submitted order', pattern: /order\.status === 'SUBMITTED'[\s\S]*?return 'WAITING_PRODUCTION'/ }
  ];

  for (const rule of requiredStatusRules) {
    if (!rule.pattern.test(source)) {
      addFailure(`orderStatus.ts must keep shared order display status rule: ${rule.name}.`);
    }
  }

  const orderStatusConsumers = [
    'frontend/src/views/OrdersListView.vue',
    'frontend/src/views/ProcessSelectionView.vue',
    'frontend/src/views/OrderDetailView.vue',
    'frontend/src/components/OrderSelect.vue',
    'frontend/src/components/InventorySourceDetailsDialog.vue'
  ];

  for (const consumerPath of orderStatusConsumers) {
    if (!fileExists(consumerPath)) {
      addFailure(`Missing order display status consumer: ${consumerPath}`);
      continue;
    }

    const consumerSource = readFile(consumerPath);
    if (!consumerSource.includes("import { orderDisplayStatus } from '../utils/orderStatus'")) {
      addFailure(`${consumerPath} must import shared orderDisplayStatus utility.`);
    }
    if (!/<StatusTag[\s\S]*:value="orderDisplayStatus\(/.test(consumerSource)) {
      addFailure(`${consumerPath} must render order status through shared orderDisplayStatus(row).`);
    }
  }

  const ordersListSource = fileExists('frontend/src/views/OrdersListView.vue')
    ? readFile('frontend/src/views/OrdersListView.vue')
    : '';
  const requiredProductionFilterStatuses = [
    'ORDER_DRAFT',
    'WAITING_PRODUCTION',
    'ORDER_IN_PRODUCTION',
    'ORDER_COMPLETED_UNSHIPPED',
    'ORDER_SHIPPED_COMPLETED'
  ];
  for (const status of requiredProductionFilterStatuses) {
    if (!ordersListSource.includes(`value: '${status}'`)) {
      addFailure(`OrdersListView.vue production status filters must include ${status}.`);
    }
  }
}

function verifyStockSourcePayloadSanitizer() {
  const stockSourceReviewPath = 'frontend/src/utils/stockSourceReview.ts';
  const orderDtoPath = 'backend/src/modules/orders/dto.ts';
  const orderServicePath = 'backend/src/modules/orders/orders.service.ts';
  if (!fileExists(stockSourceReviewPath)) {
    addFailure(`Missing stock source review utility: ${stockSourceReviewPath}`);
    return;
  }
  if (!fileExists(orderDtoPath)) {
    addFailure(`Missing order DTO: ${orderDtoPath}`);
    return;
  }
  if (!fileExists(orderServicePath)) {
    addFailure(`Missing orders service: ${orderServicePath}`);
    return;
  }

  const source = readFile(stockSourceReviewPath);
  const orderDtoSource = readFile(orderDtoPath);
  const orderServiceSource = readFile(orderServicePath);
  if (!/function\s+normalizeSelectedStockSources\s*\([^)]*\)\s*{[\s\S]*const\s+quantity\s*=\s*Number\(source\.quantity\s*\|\|\s*0\)[\s\S]*if\s*\(!batchId\s*\|\|\s*quantity\s*<=\s*0\)\s*{[\s\S]*continue;[\s\S]*}/.test(source)) {
    addFailure('stockSourceReview.ts must keep zero-quantity queue placeholders out of normalized selectedStockSources.');
  }
  if (!/function\s+normalizeSelectedStockSourcesForPayload\s*\([^)]*\)\s*{[\s\S]*const\s*{\s*availableQuantity\s*,\s*\.\.\.payload\s*}\s*=\s*source;[\s\S]*return\s+payload;[\s\S]*}/.test(source)) {
    addFailure('stockSourceReview.ts must strip availableQuantity before building selectedStockSources payload.');
  }
  if (!/selectedStockSources:\s*stockSourceReviewRequired\(line\)\s*\?\s*normalizeSelectedStockSourcesForPayload\(line\)\s*:\s*\[\]/.test(source)) {
    addFailure('sanitizeOrderLinePayload must use normalizeSelectedStockSourcesForPayload(line), not normalizeSelectedStockSources(line).');
  }
  if (!/function\s+findDirectStockSourceBlockedIssue\s*\([^)]*\)\s*{[\s\S]*compatibilityStatus[\s\S]*缺少库存来源核对结果[\s\S]*}/.test(source)) {
    addFailure('stockSourceReview.ts must block stale selectedStockSources that lack compatibilityStatus.');
  }
  if (!/class\s+StockSourceSelectionDto[\s\S]*@Min\(0\.001\)[\s\S]*quantity!:\s*number;/.test(orderDtoSource)) {
    addFailure('StockSourceSelectionDto.quantity must require @Min(0.001) so UI queue placeholders cannot be submitted as real stock sources.');
  }
  if (!/private\s+normalizeStockSourceSelections\s*\([^)]*\)\s*{[\s\S]*const\s+quantity\s*=\s*this\.roundQuantity\(Number\(selection\.quantity\s*\|\|\s*0\)\)[\s\S]*if\s*\(!batchId\s*\|\|\s*quantity\s*<=\s*0\)\s*{[\s\S]*continue;[\s\S]*}/.test(orderServiceSource)) {
    addFailure('OrdersService.normalizeStockSourceSelections must ignore zero-quantity queue placeholders before saving or reserving stock.');
  }
  if (
    !orderServiceSource.includes('private stockSourceSelectionsToJson') ||
    !orderServiceSource.includes('const normalized = this.normalizeStockSourceSelections(selections);') ||
    !orderServiceSource.includes('return normalized.length > 0 ? (normalized as Prisma.InputJsonValue) : undefined;')
  ) {
    addFailure('OrdersService.stockSourceSelectionsToJson must persist only normalized positive-quantity stock sources.');
  }
  if (
    !orderServiceSource.includes('return this.jsonToStockSourceSelections(line.stockSourceSelections).map((source) => ({ line, source }));') ||
    !orderServiceSource.includes('const reservationRows = selectedRows.flatMap(({ line, source }) =>') ||
    !orderServiceSource.includes('this.buildReservationCreateRows(order, line, source, reservationCarryovers)')
  ) {
    addFailure('OrdersService.syncOrderInventoryReservations must build draft reservations from normalized selectedStockSources only.');
  }

  const seedPath = 'database/prisma/seed.ts';
  if (fileExists(seedPath) && /\bavailableQuantity\s*:/.test(readFile(seedPath))) {
    addFailure('seed.ts must not persist availableQuantity into stockSourceSelections; available stock must be calculated at runtime.');
  }
}

function verifyInventorySourceDialogReviewGuard() {
  const dialogPath = 'frontend/src/components/InventorySourceDetailsDialog.vue';
  if (!fileExists(dialogPath)) {
    addFailure(`Missing inventory source dialog: ${dialogPath}`);
    return;
  }

  const source = readFile(dialogPath);
  if (!/const\s+directStockBlockedIssue\s*=\s*computed\(\(\)\s*=>\s*{[\s\S]*compatibilityStatus[\s\S]*缺少库存来源核对结果[\s\S]*}\);/.test(source)) {
    addFailure('InventorySourceDetailsDialog.vue must block review confirmation when selected stock sources lack compatibilityStatus.');
  }
}

function verifyInventorySourceCurrentOrderReservationUi() {
  const dialogPath = 'frontend/src/components/InventorySourceDetailsDialog.vue';
  const editorPath = 'frontend/src/components/OrderLineEditor.vue';
  if (!fileExists(dialogPath)) {
    addFailure(`Missing inventory source dialog: ${dialogPath}`);
    return;
  }
  if (!fileExists(editorPath)) {
    addFailure(`Missing order line editor: ${editorPath}`);
    return;
  }

  const dialogSource = readFile(dialogPath);
  const editorSource = readFile(editorPath);
  const dialogSnippets = [
    'draftReservedSources?: StockSourceSelectionPayload[]',
    'const draftReservedQuantityByBatchId = computed(() => {',
    'for (const source of props.draftReservedSources || [])',
    'const adjustedSourceRows = computed<SourceRow[]>(() =>',
    'const backendAvailableQuantity = row.quantity',
    'const draftReservedQuantity = draftReservedQuantityByBatchId.value.get(row.id) || 0',
    'quantity: Math.max(Math.round((backendAvailableQuantity - draftReservedQuantity + Number.EPSILON) * 1000) / 1000, 0)',
    'reservedQuantity: Number(row.reservedQuantity || 0) + draftReservedQuantity',
    'currentAvailableQuantity: row.quantity',
    'selectedSourceCurrentAvailableQuantity(source)',
    'sourceMaxSelectableQuantity(row)',
    'selectedSourceMaxQuantity(source)',
    'selectedSourceAvailabilityText(source)',
    'sourceBackendAvailableQuantity(row)',
    'availableQuantity 保存后端扣除其他订单预占后的批次总可用；currentAvailableQuantity 才扣除本订单其他零件已选数量。',
    '本订单其他零件已选',
    '默认优先使用数量少的库存批次',
    '取消勾选某批次后，系统会从后续批次自动补足，不会再选回该批次',
    'function defaultSelectableRows()',
    'left.row.quantity - right.row.quantity',
    'function roundSelectionQuantity(value: number)',
    'function selectedQueueTargetQuantity(sources: StockSourceSelectionPayload[], refillToRequired: boolean)',
    'sources.reduce((sum, source) => sum + Number(source.quantity || 0), 0)',
    'function shouldRefillSelectedSourceQueue(sources: StockSourceSelectionPayload[], explicitRefill?: boolean)',
    'const nextQueueQuantity = sources.reduce((sum, source) => sum + Number(source.quantity || 0), 0)',
    'const queueAlreadyCoveredNeed = Math.max(selectedQuantityTotal.value, nextQueueQuantity) >= requiredQuantity.value - 0.0001',
    'const hasQueuePlaceholder = sources.some((source) => Number(source.quantity || 0) <= 0)',
    'return queueAlreadyCoveredNeed || hasQueuePlaceholder',
    'function rebalanceSelectedSourceQueue(',
    'lockIndex?: number',
    'refillToRequired?: boolean',
    'distributeByQueue?: boolean',
    'excludedBatchIds?: Set<string>',
    'options.distributeByQueue',
    'options.excludedBatchIds?.has(row.id)',
    'keepQueuedWhenZero?: boolean',
    'function selectedSourceQueuePlaceholder(source: StockSourceSelectionPayload)',
    '队列占位',
    'selectedSourceRows.value.filter((source) => Number(source.quantity || 0) > 0 && sourceNeedsManualConfirmation(source))',
    'selectedSourceRows.value.find((source) => Number(source.quantity || 0) > 0 && !source.compatibilityStatus)',
    'rebalanceSelectedSourceQueue(rows, {',
    'excludedBatchIds: new Set([batchId])',
    'removeSelectedSource(row.id);',
    'distributeByQueue: true',
    'selectedSourceRows.value.filter((source) => Number(source.quantity || 0) > 0 && sourceNeedsManualConfirmation(source))',
    'function autoSelectSources()',
    'function bulkSelectSourcesByQuantity()',
    'function rebalanceCurrentSelectedSourcesByQueue()',
    '@click="rebalanceCurrentSelectedSourcesByQueue"',
    'function moveSelectedSource',
    "import { Rank } from '@element-plus/icons-vue'",
    'class="selected-source-drag-handle"',
    'aria-label="拖拽调整使用顺序"',
    '<el-icon><Rank /></el-icon>',
    '@dragstart.stop="startSelectedSourceDrag($event, index)"',
    '@dragover.self.prevent="handleSelectedSourceListDragOverEnd"',
    '@dragleave="handleSelectedSourceListDragLeave"',
    '@drop.self.prevent="dropSelectedSourceAtEnd"',
    '@drop.prevent="dropSelectedSource($event, index)"',
    'function reorderSelectedSource',
    'function handleSelectedSourceListDragOverEnd',
    'function dropSelectedSourceAtEnd',
    'function handleSelectedSourceListDragLeave',
    'isSelectedSourceDragAfterRowMiddle(event)',
    'function handleSelectedSourceQuantityChange(source: StockSourceSelectionPayload, value: number | undefined)',
    'const rows = selectedSourceRows.value.map((item) => (item.batchId === source.batchId ? { ...item, quantity: nextQuantity } : item))',
    'const lockIndex = rows.findIndex((item) => item.batchId === source.batchId)',
    'lockQuantity: nextQuantity',
    'refillToRequired: shouldRefillSelectedSourceQueue(rows)',
    'const [current] = rows.splice(index, 1)',
    'rows.splice(target, 0, current)',
    'function sourceUsageOrderIssue',
    '未优先使用较小库存批次'
  ];
  for (const snippet of dialogSnippets) {
    if (!dialogSource.includes(snippet)) {
      addFailure(`InventorySourceDetailsDialog.vue must keep current-order stock reservation UI snippet: ${snippet}`);
    }
  }
  if (!readFile('AGENTS.md').includes('操作人员可以拖拽调整已选库存使用顺序')) {
    addFailure('AGENTS.md must document that selected stock source order supports drag sorting.');
  }

  const editorSnippets = [
    ':draft-reserved-sources="otherLineSelectedStockSources"',
    'const otherLineSelectedStockSources = computed(() =>',
    '.filter((line) => line !== currentSourceLine.value)',
    '.flatMap((line) => line.selectedStockSources || [])'
  ];
  for (const snippet of editorSnippets) {
    if (!editorSource.includes(snippet)) {
      addFailure(`OrderLineEditor.vue must pass other line selected stock sources into the inventory source dialog: ${snippet}`);
    }
  }
}

function verifyStockProductionPlanOverridePreserved() {
  const editorPath = 'frontend/src/components/OrderLineEditor.vue';
  const reviewPath = 'frontend/src/utils/stockSourceReview.ts';
  const servicePath = 'backend/src/modules/orders/orders.service.ts';
  const repairPath = 'database/prisma/repair-first-stage.ts';
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  if (!fileExists(editorPath)) {
    addFailure(`Missing order line editor: ${editorPath}`);
    return;
  }
  if (!fileExists(reviewPath)) {
    addFailure(`Missing stock source review utility: ${reviewPath}`);
    return;
  }
  if (!fileExists(servicePath)) {
    addFailure(`Missing orders service: ${servicePath}`);
    return;
  }
  if (!fileExists(repairPath)) {
    addFailure(`Missing first-stage repair script: ${repairPath}`);
    return;
  }
  if (!fileExists(verifierPath)) {
    addFailure(`Missing first-stage data verifier: ${verifierPath}`);
    return;
  }

  const editorSource = readFile(editorPath);
  const reviewSource = readFile(reviewPath);
  const serviceSource = readFile(servicePath);
  const repairSource = readFile(repairPath);
  const verifierSource = readFile(verifierPath);
  const stockCoverPlanSnippets = [
    'options: { forceWhenStockCovers?: boolean } = {}',
    'const stockCoversCustomerQuantity =',
    'function hasProductionPlanOverride(line: CreateOrderLinePayload)',
    'const hasExplicitProductionPlanOverride = hasProductionPlanOverride(line);',
    'if (options.forceWhenStockCovers && stockCoversCustomerQuantity && !hasExplicitProductionPlanOverride)',
    'const stockCoverAutoSyncedLines = new WeakSet<CreateOrderLinePayload>();',
    'function syncInitialStockCoveredPlanQuantity(line: CreateOrderLinePayload)',
    'stockCoverAutoSyncedLines.has(line)',
    'rows.forEach(syncInitialStockCoveredPlanQuantity);',
    'syncStockProductionPlanQuantity(currentSourceLine.value, previousSuggestedQuantity, { forceWhenStockCovers: true });',
    'syncStockProductionPlanQuantity(currentSourceLine.value, undefined, { forceWhenStockCovers: true });'
  ];
  for (const snippet of stockCoverPlanSnippets) {
    if (!editorSource.includes(snippet)) {
      addFailure(`OrderLineEditor.vue must auto-sync productionPlanQuantity to 0 when selected stock covers customer quantity: ${snippet}`);
    }
  }
  const backendStockCoverPlanSnippets = [
    'const stockCoversCustomerQuantity =',
    'const hasExplicitProductionPlanOverride = Boolean',
    'if (stockCoversCustomerQuantity && productionPlanQuantity > 0 && !hasExplicitProductionPlanOverride)',
    'productionPlanQuantity = suggestedQuantity;'
  ];
  for (const snippet of backendStockCoverPlanSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`OrdersService must auto-normalize stale STOCK productionPlanQuantity when selected stock covers customer quantity: ${snippet}`);
    }
  }
  const repairStockCoverPlanSnippets = [
    'autoNormalizedStockCover: boolean',
    'const stockCoversCustomerQuantity =',
    'const hasExplicitProductionPlanOverride = Boolean',
    'const autoNormalizedStockCover = stockCoversCustomerQuantity && planQuantity > quantityTolerance && !hasExplicitProductionPlanOverride',
    'data.productionPlanQuantity = suggestedQuantity;',
    '库存已覆盖客户数量，自动把历史生产计划数量归零'
  ];
  for (const snippet of repairStockCoverPlanSnippets) {
    if (!repairSource.includes(snippet)) {
      addFailure(`repair-first-stage.ts must auto-normalize stale fully stock-covered plan quantity: ${snippet}`);
    }
  }
  const verifierStockCoverPlanSnippets = [
    'const stockCoversCustomerQuantity =',
    'const staleFullStockPlanWithoutOverride =',
    'FULL_STOCK_LINE_PLAN_STALE',
    '应自动归零或补齐多做说明'
  ];
  for (const snippet of verifierStockCoverPlanSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must report stale fully stock-covered plan quantity clearly: ${snippet}`);
    }
  }
  if (
    !/function\s+syncStockProductionPlanQuantity\s*\([^)]*previousSuggestedQuantity\s*=\s*suggestedProductionPlanQuantity\(line\)[^)]*\)\s*{[\s\S]*const\s+planWasFollowingSuggestion\s*=[\s\S]*Math\.abs\(currentPlanQuantity\s*-\s*previousSuggestedQuantity\)[\s\S]*if\s*\(\s*planWasFollowingSuggestion\s*\)\s*{[\s\S]*line\.productionPlanQuantity\s*=\s*nextSuggestedQuantity[\s\S]*}/.test(editorSource)
  ) {
    addFailure('OrderLineEditor.vue must only auto-sync STOCK productionPlanQuantity when the plan was still following the previous suggestion.');
  }
  if (!editorSource.includes('操作人员手动多做/少做后必须保留其计划和说明')) {
    addFailure('OrderLineEditor.vue must keep the stock plan override preservation comment near syncStockProductionPlanQuantity.');
  }
  if (
    !/const\s+planOverrideRequired\s*=\s*Math\.abs\(productionPlanQuantity\s*-\s*suggestedQuantity\)\s*>\s*0\.0001/.test(reviewSource) ||
    !/productionPlanOverrideByCode:\s*planOverrideRequired\s*\?\s*line\.productionPlanOverrideByCode\?\.trim\(\)\s*:\s*undefined/.test(reviewSource) ||
    !/productionPlanOverrideReason:\s*planOverrideRequired\s*\?\s*line\.productionPlanOverrideReason\?\.trim\(\)\s*:\s*undefined/.test(reviewSource)
  ) {
    addFailure('stockSourceReview.ts must preserve production plan override operator and reason only when actual plan differs from suggested quantity.');
  }
  if (!reviewSource.includes('requireResolvedOperator') || !reviewSource.includes('productionPlanOverrideByRole?.trim()')) {
    addFailure('stockSourceReview.ts must support submit-time validation of resolved production plan override operator snapshots.');
  }
  const submitCheckPath = 'frontend/src/utils/submitStockSourceChecks.ts';
  if (!fileExists(submitCheckPath)) {
    addFailure(`Missing submit stock source checker: ${submitCheckPath}`);
    return;
  }
  const submitCheckSource = readFile(submitCheckPath);
  if (!submitCheckSource.includes('findProductionPlanOverrideIssue(line, { requireResolvedOperator: true })')) {
    addFailure('submitStockSourceChecks.ts must require resolved production plan override operator snapshots before submitting production.');
  }
}

function verifyOrderStockSourceValidationTransaction() {
  const servicePath = 'backend/src/modules/orders/orders.service.ts';
  if (!fileExists(servicePath)) {
    addFailure(`Missing orders service: ${servicePath}`);
    return;
  }

  const source = readFile(servicePath);
  const validationCalls = [...source.matchAll(/validateOrderStockSourceSelections\s*\(([^)]*)\)/g)].map((match) => match[1]);
  const runtimeCalls = validationCalls.filter((args) => !args.includes("lines: CreateOrderDto['lines']"));
  const invalidCall = runtimeCalls.find((args) => !/\btx\b/.test(args));
  if (invalidCall) {
    addFailure('OrdersService must validate selectedStockSources inside the Serializable transaction with tx.');
  }
  if (!source.includes('const batchAvailableQuantity = this.roundQuantity(Number(batch.availableQuantity ?? batchQuantity));')) {
    addFailure('OrdersService consumeAvailableStock must calculate batchAvailableQuantity from runtime availableQuantity before deducting stock.');
  }
  if (!source.includes('提交生产扣库必须严格按 selectedStockSources 顺序执行')) {
    addFailure('OrdersService must document that manual stock deduction follows selectedStockSources queue order.');
  }
  if (
    !source.includes('const sortedStockBatches = hasManualSelections') ||
    !source.includes('? selectedSources') ||
    !source.includes('.map((source) => stockBatches.find((batch) => batch.id === source.batchId))') ||
    !source.includes(': this.sortStockBatchesForOrderLine(line, stockBatches, sourceTaskMap)')
  ) {
    addFailure('OrdersService consumeAvailableStock must build sortedStockBatches from selectedStockSources order for manual stock usage.');
  }
  if (!/const\s+candidateBatches\s*=\s*hasManualSelections\s*\?[\s\S]*sortedStockBatches\.map\(\(batch\)\s*=>\s*\(\{[\s\S]*selectedQuantity:\s*selectedSourceMap\.get\(batch\.id\)\?\.quantity\s*\|\|\s*0/.test(source)) {
    addFailure('OrdersService consumeAvailableStock must carry selectedQuantity onto candidateBatches before deducting by queue.');
  }
  if (
    !source.includes('findAvailableStockUsageCandidateBatches') ||
    !source.includes('selectedBatches') ||
    !source.includes('OR: [...keys.values()].map((key) => ({') ||
    !source.includes('partCode: { equals: key.partCode, mode: \'insensitive\' }') ||
    !source.includes('for (const batch of selectedBatches)') ||
    !source.includes('rows.set(batch.id, batch)')
  ) {
    addFailure('OrdersService must include unselected same-part stock batches when checking skipped smaller-batch manual confirmation.');
  }
  if (source.includes('Math.min(batchQuantity, selectedLimit, remainingQuantity)')) {
    addFailure('OrdersService consumeAvailableStock must deduct from batchAvailableQuantity, not physical batchQuantity.');
  }
  if (!/validateSelectedStockSourceManualConfirmations\s*\([^)]*\)\s*{[\s\S]*!source\.compatibilityStatus[\s\S]*缺少库存来源核对结果[\s\S]*}/.test(source)) {
    addFailure('OrdersService must reject selectedStockSources missing compatibilityStatus before saving or submitting stock usage.');
  }
  if (!source.includes('consumeActiveInventoryReservations') || !source.includes('草稿预占数量异常')) {
    addFailure('OrdersService must consume ACTIVE InventoryReservation rows only after matching the exact selected stock batch quantity.');
  }
  if (!source.includes('stockReservationConsumesAvailability') || !source.includes('reservationOrder.createdAt.getTime()')) {
    addFailure('OrdersService must calculate active stock reservations by draft order priority, not by simply subtracting every other draft.');
  }
  if (
    source.includes(`where: {
          batchId: batch.id,
          orderLineId: line.id,
          status: InventoryReservationStatus.ACTIVE
        }`)
  ) {
    addFailure('OrdersService must not blanket-consume ACTIVE reservations by batchId/orderLineId without exact quantity validation.');
  }
  if (
    !/const\s+missingPlanOverrideLine\s*=\s*order\.lines\.find\(\(line\)\s*=>\s*{[\s\S]*resolveSuggestedProductionPlanQuantity\(line\)[\s\S]*!this\.hasProductionPlanOverrideRecord\(line\)[\s\S]*生产计划数量与建议数量不一致/.test(source)
  ) {
    addFailure('OrdersService.submit must re-check production plan override operator and reason inside the transaction before generating tasks or consuming stock.');
  }
  if (!source.includes('assertSubmittedProductionPlanOverrides(tx, order.lines, effectivePlanQuantityByLineId)')) {
    addFailure('OrdersService.submit must re-validate saved production plan override operators inside the Serializable transaction.');
  }
  if (!source.includes('resolveSubmitPlanOperatorFromClient') || !source.includes('productionPlanOverrideByRole?.trim()')) {
    addFailure('OrdersService must validate production plan override role snapshots, not only account and reason.');
  }
}

function verifyInventorySourcePriority() {
  const servicePath = 'backend/src/modules/inventory/inventory.service.ts';
  if (!fileExists(servicePath)) {
    addFailure(`Missing inventory service: ${servicePath}`);
    return;
  }

  const source = readFile(servicePath);
  if (!source.includes('resolveStockReservationPriorityOrder') || !source.includes('stockReservationConsumesAvailability')) {
    addFailure('InventoryService must calculate stock source available quantity by current draft order priority.');
  }
  if (!/toInventorySourceDetail\s*\([^)]*currentOrder[\s\S]*stockReservationConsumesAvailability\(reservation\.order,\s*currentOrder\)/.test(source)) {
    addFailure('InventoryService source-details must filter reservations by current draft order priority before calculating availableQuantity.');
  }
  if (!/async\s+summary\s*\([^)]*\)\s*{[\s\S]*resolveStockReservationPriorityOrder\(query\)[\s\S]*stockReservationConsumesAvailability\(reservation\.order,\s*currentOrder\)/.test(source)) {
    addFailure('InventoryService summary must calculate reservedQuantity by current draft order priority.');
  }
  if (!/async\s+findAll\s*\([^)]*\)\s*{[\s\S]*resolveStockReservationPriorityOrder\(query\)[\s\S]*stockReservationConsumesAvailability\(reservation\.order,\s*currentOrder\)/.test(source)) {
    addFailure('InventoryService findAll must calculate availableQuantity by current draft order priority.');
  }
}

function verifyInventoryAdjustmentWorkflow() {
  const controllerPath = 'backend/src/modules/inventory/inventory.controller.ts';
  const servicePath = 'backend/src/modules/inventory/inventory.service.ts';
  const dtoPath = 'backend/src/modules/inventory/dto.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const viewPath = 'frontend/src/views/InventoryView.vue';
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  const seedPath = 'database/prisma/seed.ts';

  for (const projectPath of [controllerPath, servicePath, dtoPath, apiPath, viewPath, verifierPath, seedPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing inventory adjustment workflow file: ${projectPath}`);
      return;
    }
  }

  const controllerSource = readFile(controllerPath);
  const controllerSnippets = [
    "@Post('adjustments/upload')",
    "FileInterceptor('file'",
    'inventoryAdjustmentUploadPath()',
    'normalizeMultipartFileName',
    'allowedAdjustmentExtensions',
    'allowedAdjustmentMimeTypes',
    'genericUploadMimeTypes',
    'const originalName = normalizeMultipartFileName(file.originalname)',
    'fileName: normalizeMultipartFileName(file.originalname)',
    "callback(new BadRequestException('库存盘点附件格式不支持'), false)",
    'fileUrl: `/uploads/inventory-adjustments/${file.filename}`',
    "@Post('batches/:batchId/adjust')",
    'return this.inventoryService.adjustBatchQuantity(batchId, dto)',
    "@Get('batches/:batchId/adjustments')",
    'return this.inventoryService.findBatchAdjustments(batchId)'
  ];
  for (const snippet of controllerSnippets) {
    if (!controllerSource.includes(snippet)) {
      addFailure(`InventoryController must keep inventory adjustment endpoint/upload snippet: ${snippet}`);
    }
  }

  const dtoSource = readFile(dtoPath);
  const dtoSnippets = [
    'export class AdjustInventoryBatchDto',
    'afterQuantity!: number',
    'countedBy!: string',
    'signatureName!: string',
    'attachmentFileName!: string',
    'attachmentFileUrl!: string',
    'attachmentMimeType?: string',
    'attachmentSize?: number'
  ];
  for (const snippet of dtoSnippets) {
    if (!dtoSource.includes(snippet)) {
      addFailure(`AdjustInventoryBatchDto must keep required inventory adjustment field: ${snippet}`);
    }
  }
  if (!/@Min\(0\)[\s\S]*afterQuantity!: number/.test(dtoSource)) {
    addFailure('AdjustInventoryBatchDto.afterQuantity must be validated with @Min(0).');
  }

  const serviceSource = readFile(servicePath);
  const serviceSnippets = [
    'async adjustBatchQuantity(batchId: string, dto: AdjustInventoryBatchDto)',
    '库存盘点必须上传统计工单或照片附件',
    'this.validateAdjustmentAttachment(attachmentFileUrl, attachmentFileName, attachmentMimeType)',
    'runSerializableTransaction',
    'status: InventoryReservationStatus.ACTIVE',
    '盘点后数量不能小于已预占数量',
    'const deltaQuantity = afterQuantity - beforeQuantity',
    'tx.inventoryAdjustment.create',
    'tx.inventoryBatch.update',
    "status: afterQuantity > 0 ? 'AVAILABLE' : 'USED'",
    'tx.inventoryTransaction.create',
    "transactionType: deltaQuantity > 0 ? 'IN' : 'OUT'",
    "sourceRecordType: 'InventoryAdjustment'",
    'sourceRecordId: adjustment.id',
    '当前库存批次正在被其他操作修改，请刷新后重新盘点',
    'private validateAdjustmentAttachment',
    "const adjustmentAttachmentPrefix = '/uploads/inventory-adjustments/'",
    "fileUrl.startsWith(adjustmentAttachmentPrefix)",
    "fileUrl.includes('..')",
    'allowedAdjustmentExtensions.has(storedExtension)',
    'allowedAdjustmentMimeTypes.has(mimeType)',
    'genericUploadMimeTypes.has(mimeType)',
    'inventoryAdjustmentUploadPath()',
    'existsSync(fullPath)',
    '库存盘点附件文件不存在',
    'private toAdjustment'
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`InventoryService must keep inventory adjustment transaction/attachment snippet: ${snippet}`);
    }
  }

  const apiSource = readFile(apiPath);
  const apiSnippets = [
    'export interface AdjustInventoryBatchPayload',
    'export interface InventoryAdjustmentUploadResponse',
    'async uploadInventoryAdjustmentFile(file: File)',
    "formData.set('file', file)",
    '/inventory/adjustments/upload',
    "throw new Error((await response.text()) || '盘点附件上传失败')",
    'adjustInventoryBatch(batchId: string, payload: AdjustInventoryBatchPayload)',
    '/inventory/batches/${batchId}/adjust',
    'inventoryBatchAdjustments(batchId: string)',
    '/inventory/batches/${batchId}/adjustments'
  ];
  for (const snippet of apiSnippets) {
    if (!apiSource.includes(snippet)) {
      addFailure(`frontend api must keep inventory adjustment helper: ${snippet}`);
    }
  }

  const viewSource = readFile(viewPath);
  const viewSnippets = [
    'v-model="adjustDialogVisible"',
    'title="库存盘点调整"',
    ':before-close="handleAdjustDialogBeforeClose"',
    'adjustmentReservedQuantity',
    ':min="adjustmentMinQuantity"',
    '该批次已有订单预占，盘点后数量不能低于',
    'v-model="adjustForm.countedBy"',
    'v-model="adjustForm.countedAt"',
    'v-model="adjustForm.signatureName"',
    'ref="adjustmentFileInput"',
    'type="file"',
    'accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff"',
    '必须上传盘点工单、现场照片或 PDF',
    'normalizeDisplayFileName',
    'adjustment-selected-file',
    'adjustment-attachment-link',
    'displayFileName(file.name).toLowerCase()',
    'adjustmentHistory.value = await erpApi.inventoryBatchAdjustments(batchId)',
    'function adjustmentDisabledReason(row?: InventoryBatch)',
    '只有可用库存或数量为 0 的历史批次可以盘点调整。',
    'function isAllowedAdjustmentFile(file: File)',
    'genericAdjustmentMimeTypes.includes(file.type)',
    'async function submitAdjustment()',
    '请填写清点人',
    '请填写签字人',
    '请上传盘点工单、照片或 PDF 附件',
    '盘点后数量不能低于已预占数量',
    'const attachment = await erpApi.uploadInventoryAdjustmentFile(adjustmentFile.value)',
    'await erpApi.adjustInventoryBatch(selectedBatch.value.id',
    'attachmentFileUrl: attachment?.fileUrl',
    'await loadInventory()'
  ];
  for (const snippet of viewSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`InventoryView.vue must keep inventory adjustment dialog/upload snippet: ${snippet}`);
    }
  }

  const verifierSource = readFile(verifierPath);
  const verifierSnippets = [
    'await checkInventoryAdjustments()',
    'async function checkInventoryAdjustments()',
    'prisma.inventoryAdjustment.findMany',
    "where: { sourceRecordType: 'InventoryAdjustment', sourceRecordId: { in: adjustmentIds } }",
    'INVENTORY_ADJUSTMENT_DELTA_MISMATCH',
    'INVENTORY_ADJUSTMENT_TRANSACTION_MISSING',
    'INVENTORY_ADJUSTMENT_TRANSACTION_MISMATCH',
    'INVENTORY_ADJUSTMENT_ZERO_DELTA_HAS_TRANSACTION',
    'INVENTORY_ADJUSTMENT_SIGN_MISSING',
    'INVENTORY_ADJUSTMENT_ATTACHMENT_MISSING',
    'INVENTORY_ADJUSTMENT_ATTACHMENT_FILE_MISSING',
    "const inventoryAdjustmentPrefix = '/uploads/inventory-adjustments/'",
    "resolve(uploadRoot, 'inventory-adjustments', storedFileName)"
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep inventory adjustment data verification snippet: ${snippet}`);
    }
  }

  const seedSource = readFile(seedPath);
  const seedSnippets = [
    'function seedInventoryAdjustmentAttachment()',
    'seed-inventory-adjustment-001.pdf',
    'async function seedInventoryAdjustment()',
    "adjustmentNo: 'IA-SEED-20260508-001'",
    'attachmentFileUrl: attachment.fileUrl',
    "sourceRecordType: 'InventoryAdjustment'",
    'sourceRecordId: adjustment.id',
    'await seedInventoryAdjustment()'
  ];
  for (const snippet of seedSnippets) {
    if (!seedSource.includes(snippet)) {
      addFailure(`seed.ts must keep first-stage inventory adjustment seed snippet: ${snippet}`);
    }
  }
}

function verifyProcessDefinitionReferenceGuard() {
  const servicePath = 'backend/src/modules/process-definitions/process-definitions.service.ts';
  if (!fileExists(servicePath)) {
    addFailure(`Missing process definitions service: ${servicePath}`);
    return;
  }

  const source = readFile(servicePath);
  if (!source.includes('findProcessDefinitionReferences') || !source.includes('orderLineProcessStep.findMany') || !source.includes('processTemplate.findMany')) {
    addFailure('ProcessDefinitionsService must check existing order process and process template references before disabling or renaming a process definition.');
  }
  if (!source.includes('processSnapshotToDetails') || !source.includes("action: '停用' | '改名'") || !source.includes('不能${action}')) {
    addFailure('ProcessDefinitionsService must parse process template steps and reject disabling or renaming referenced process definitions with a clear message.');
  }
  if (!/async\s+update\s*\([^)]*\)\s*{[\s\S]*nextStatus[\s\S]*findProcessDefinitionReferences\(existing\.processNameNormalized\)[\s\S]*referencedProcessDefinitionError/.test(source)) {
    addFailure('ProcessDefinitionsService.update must reject renaming or disabling referenced process definitions.');
  }
  if (!/async\s+delete\s*\([^)]*\)\s*{[\s\S]*findProcessDefinitionReferences\(existing\.processNameNormalized\)[\s\S]*referencedProcessDefinitionError/.test(source)) {
    addFailure('ProcessDefinitionsService.delete must reject disabling referenced process definitions.');
  }
}

function verifyMissingProcessDefinitionRepairCoverage() {
  const repairPath = 'database/prisma/repair-first-stage.ts';
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  if (!fileExists(repairPath)) {
    addFailure(`Missing first-stage repair script: ${repairPath}`);
    return;
  }
  if (!fileExists(verifierPath)) {
    addFailure(`Missing first-stage data verifier: ${verifierPath}`);
    return;
  }

  const repairSource = readFile(repairPath);
  const repairSnippets = [
    'collectMissingProcessDefinitionRepairs',
    'printMissingProcessDefinitionRepairs',
    '标准工序补录',
    'prisma.processDefinition.findMany',
    'prisma.processTemplate.findMany',
    'prisma.orderLineProcessStep.findMany',
    'processSnapshotToDetails(template.steps)',
    'normalizeSearchKeyword(processName)',
    'referencedByNormalized',
    'existingByNormalized',
    "action: 'create'",
    "action: 'enable'",
    'missingProcessDefinitionRepairs.length > 0',
    'tx.processDefinition.create',
    'tx.processDefinition.update',
    "remark: '历史订单或流程模板引用补录'",
    "searchText: buildPinyinSearchText([repair.processName, '历史订单或流程模板引用补录'])",
    'status: CommonStatus.ENABLED'
  ];
  for (const snippet of repairSnippets) {
    if (!repairSource.includes(snippet)) {
      addFailure(`repair-first-stage.ts must keep missing process definition repair snippet: ${snippet}`);
    }
  }

  if (!/const\s+missingProcessDefinitionRepairs\s*=\s*await\s+collectMissingProcessDefinitionRepairs\(\)[\s\S]*printMissingProcessDefinitionRepairs\(missingProcessDefinitionRepairs\)/.test(repairSource)) {
    addFailure('repair-first-stage.ts must collect and print missing process definition repairs during dry-run.');
  }
  if (!/if\s*\(\s*missingProcessDefinitionRepairs\.length\s*>\s*0\s*\)[\s\S]*tx\.processDefinition\.create[\s\S]*tx\.processDefinition\.update/.test(repairSource)) {
    addFailure('repair-first-stage.ts write mode must create missing process definitions and re-enable disabled referenced definitions inside the repair transaction.');
  }

  const verifierSource = readFile(verifierPath);
  const verifierSnippets = [
    'async function checkOrderLineProcessSteps()',
    'prisma.processDefinition.findMany',
    'where: { status: CommonStatus.ENABLED }',
    'enabledProcessKeys',
    'normalizeSearchKeyword(processName)',
    'ORDER_LINE_PROCESS_DEFINITION_MISSING',
    '没有对应的启用标准工序'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep missing process definition verification snippet: ${snippet}`);
    }
  }
}

function verifyRepairDraftReservationPriority() {
  const repairPath = 'database/prisma/repair-first-stage.ts';
  if (!fileExists(repairPath)) {
    addFailure(`Missing first-stage repair script: ${repairPath}`);
    return;
  }

  const source = readFile(repairPath);
  if (!source.includes('expectedBeforeQuantityByOrderBatchKey') || !source.includes('runningExpectedQuantityByBatchId')) {
    addFailure('repair-first-stage.ts must calculate draft stock reservations by draft order priority before write mode.');
  }
  if (!source.includes('前序草稿应预占')) {
    addFailure('repair-first-stage.ts must report prior draft reservations when blocking stock reservation repair.');
  }
  if (!source.includes('repairStockSourceReviewStatuses') || !source.includes('blockedStockSourceReviewRepairs')) {
    addFailure('repair-first-stage.ts must repair or block missing stock source compatibilityStatus safely.');
  }
  if (
    !source.includes('collectStockAllocationRepairs') ||
    !source.includes('printStockAllocationRepairs') ||
    !source.includes('使用库存转订单待发货')
  ) {
    addFailure('repair-first-stage.ts must report and block unsafe STOCK allocation-to-order-inventory gaps.');
  }
  if (!source.includes('overrideRepairReason') || !source.includes('isSubmitPlanOperatorRole')) {
    addFailure('repair-first-stage.ts must repair invalid production plan override operator snapshots and roles.');
  }
  if (!source.includes('assertNoBlockedRepairs(stockSourceReviewStatusRepairs, draftReservationSyncRepairs, consumedReservationRepairs, stockAllocationRepairs)')) {
    addFailure('repair-first-stage.ts write mode must run a full blocked-repair preflight before any repair write.');
  }
  const preflightIndex = source.indexOf('assertNoBlockedRepairs(stockSourceReviewStatusRepairs, draftReservationSyncRepairs, consumedReservationRepairs, stockAllocationRepairs)');
  const firstWriteIndex = source.indexOf('if (planRepairs.length > 0)');
  if (preflightIndex === -1 || firstWriteIndex === -1 || preflightIndex > firstWriteIndex) {
    addFailure('repair-first-stage.ts blocked-repair preflight must happen before the first write transaction.');
  }
  const writeTransactionMatches = source.match(/prisma\.\$transaction\s*\(\s*async\s*\(\s*tx\s*\)/g) || [];
  if (writeTransactionMatches.length !== 1) {
    addFailure('repair-first-stage.ts write mode must apply all repair writes inside one atomic transaction.');
  }
  const retryTransactionIndex = source.search(/await\s+runSerializableRepairWrite\s*\(\s*\(\)\s*=>\s*[\s\S]*?prisma\.\$transaction\s*\(\s*async\s*\(\s*tx\s*\)\s*=>\s*{/);
  const writeTransactionIndex = source.search(/prisma\.\$transaction\s*\(\s*async\s*\(\s*tx\s*\)\s*=>\s*{/);
  if (writeTransactionIndex === -1 || writeTransactionIndex < preflightIndex || writeTransactionIndex > firstWriteIndex) {
    addFailure('repair-first-stage.ts atomic write transaction must start after blocked preflight and before the first repair write.');
  }
  if (retryTransactionIndex === -1) {
    addFailure('repair-first-stage.ts Serializable repair write transaction must be wrapped with retry handling.');
  }
  if (!source.includes('isolationLevel: Prisma.TransactionIsolationLevel.Serializable')) {
    addFailure('repair-first-stage.ts atomic repair write transaction must use Serializable isolation.');
  }
  if (!source.includes('serializableRepairRetryCount') || !source.includes("error.code === 'P2034'")) {
    addFailure('repair-first-stage.ts must retry Prisma P2034 Serializable conflicts before failing repair write mode.');
  }
}

function verifyDataVerifierStockSourceReviewStatus() {
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  if (!fileExists(verifierPath)) {
    addFailure(`Missing first-stage data verifier: ${verifierPath}`);
    return;
  }

  const source = readFile(verifierPath);
  if (!source.includes('STOCK_SOURCE_REVIEW_STATUS_MISSING') || !source.includes('STOCK_SOURCE_REVIEW_STATUS_INVALID')) {
    addFailure('verify-first-stage.ts must report missing or invalid stock source compatibilityStatus.');
  }
  if (!source.includes('STOCK_SOURCE_OVER_ORDER_QUANTITY') || !source.includes('REWORK_SOURCE_OVER_PLAN_QUANTITY')) {
    addFailure('verify-first-stage.ts must reject selected stock sources that exceed customer order quantity or rework plan quantity.');
  }
  if (!source.includes('STOCK_SOURCE_USAGE_ORDER_CONFIRMATION_MISSING') || !source.includes('stockSourceUsageOrderIssue')) {
    addFailure('verify-first-stage.ts must verify draft stock source usage order manual confirmation.');
  }
  if (!source.includes('STOCK_OUT_TRANSACTION_BATCH_MISMATCH') || !source.includes('STOCK_OUT_TRANSACTION_STALE_BATCH')) {
    addFailure('verify-first-stage.ts must verify stock source OUT transactions per selected inventory batch.');
  }
  if (!source.includes('FULL_STOCK_LINE_ORDER_BATCH_MISSING') || !source.includes('fullStockCoveredLine')) {
    addFailure('verify-first-stage.ts must verify fully stock-covered submitted lines are converted to order-bound shipment inventory.');
  }
  if (!source.includes('PLAN_OVERRIDE_OPERATOR_MISSING') || !source.includes('PLAN_OVERRIDE_OPERATOR_ROLE_INVALID')) {
    addFailure('verify-first-stage.ts must verify production plan override operators exist and use a submit/plan role.');
  }
  if (!source.includes('PLAN_OVERRIDE_OPERATOR_SNAPSHOT_STALE') || !source.includes('historyBackfillOperatorCode')) {
    addFailure('verify-first-stage.ts must verify production plan override operator snapshots while allowing explicit history backfill records.');
  }
  if (/const\s+shouldHaveProcessSteps\s*=\s*[^;]*line\.fulfillmentMode\s*!==\s*OrderLineFulfillmentMode\.STOCK[^;]*;/.test(source)) {
    addFailure('verify-first-stage.ts must require process steps for any submitted line with productionPlanQuantity > 0, including partial STOCK lines.');
  }
  if (!source.includes('draftReservationPriorityRows') || !source.includes('按草稿订单创建先后扣减后')) {
    addFailure('verify-first-stage.ts must validate draft stock reservation priority by draft order creation order.');
  }
  if (!source.includes('async function runMain()') || !source.includes('finally') || !source.includes('await prisma.$disconnect();')) {
    addFailure('verify-first-stage.ts must disconnect Prisma in a shared runMain finally block.');
  }
  if (source.includes('process.exit(1)')) {
    addFailure('verify-first-stage.ts should set process.exitCode instead of calling process.exit(1).');
  }
}

function verifyRepairScriptEntrypoint() {
  const repairPath = 'database/prisma/repair-first-stage.ts';
  if (!fileExists(repairPath)) {
    addFailure(`Missing first-stage repair script: ${repairPath}`);
    return;
  }

  const source = readFile(repairPath);
  if (!source.includes('async function runMain()') || !source.includes('finally') || !source.includes('await prisma.$disconnect();')) {
    addFailure('repair-first-stage.ts must disconnect Prisma in a shared runMain finally block.');
  }
  if (source.includes('process.exit(1)')) {
    addFailure('repair-first-stage.ts should set process.exitCode instead of calling process.exit(1).');
  }
}

function verifyReadmeRepairSafetyDocs() {
  const readmePath = 'README.md';
  if (!fileExists(readmePath)) {
    addFailure(`Missing README: ${readmePath}`);
    return;
  }

  const source = readFile(readmePath);
  const requiredSnippets = [
    '执行 `--write` 前必须先备份数据库',
    '阻断检查',
    '不写入任何修复',
    '流程搜索字段',
    '标准工序补录',
    '历史订单 / 流程模板引用',
    '生产操作人员基础资料',
    '已消耗库存来源缺失的 `InventoryReservation`',
    '使用库存转订单待发货',
    'Serializable',
    'P2034',
    '整次修复回滚'
  ];

  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`README.md must document first-stage repair safety rule: ${snippet}`);
    }
  }
}

function verifyOrderExcelImportWorkflow() {
  const servicePath = 'backend/src/modules/orders/orders.service.ts';
  const controllerPath = 'backend/src/modules/orders/orders.controller.ts';
  const dtoPath = 'backend/src/modules/orders/dto.ts';
  const schemaPath = 'database/prisma/schema.prisma';
  const ordersViewPath = 'frontend/src/views/OrdersListView.vue';
  const orderDetailPath = 'frontend/src/views/OrderDetailView.vue';
  const lineEditorPath = 'frontend/src/components/OrderLineEditor.vue';
  const apiPath = 'frontend/src/api/erp.ts';
  const typesPath = 'frontend/src/types/erp.ts';
  const uploadFileNamePath = 'backend/src/common/upload-filenames.ts';
  const frontendFileNamePath = 'frontend/src/utils/fileNames.ts';
  const mainPath = 'backend/src/main.ts';
  const readmePath = 'README.md';
  const packagePath = 'package.json';
  const regressionScriptPath = 'scripts/verify-order-import-api.cjs';
  const uploadFileNameRegressionScriptPath = 'scripts/verify-upload-filenames-api.cjs';
  const fileNameNormalizerRegressionScriptPath = 'scripts/verify-file-name-normalizers.cjs';
  const workbookRegressionScriptPath = 'scripts/verify-order-import-workbooks.cjs';

  for (const projectPath of [
    servicePath,
    controllerPath,
    dtoPath,
    schemaPath,
    ordersViewPath,
    orderDetailPath,
    lineEditorPath,
    apiPath,
    typesPath,
    uploadFileNamePath,
    frontendFileNamePath,
    mainPath,
    readmePath,
    packagePath,
    regressionScriptPath,
    uploadFileNameRegressionScriptPath,
    fileNameNormalizerRegressionScriptPath,
    workbookRegressionScriptPath
  ]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing Excel order import source file: ${projectPath}`);
      return;
    }
  }

  const serviceSource = readFile(servicePath);
  const controllerSource = readFile(controllerPath);
  const dtoSource = readFile(dtoPath);
  const schemaSource = readFile(schemaPath);
  const ordersViewSource = readFile(ordersViewPath);
  const orderDetailSource = readFile(orderDetailPath);
  const lineEditorSource = readFile(lineEditorPath);
  const apiSource = readFile(apiPath);
  const typesSource = readFile(typesPath);
  const uploadFileNameSource = readFile(uploadFileNamePath);
  const frontendFileNameSource = readFile(frontendFileNamePath);
  const mainSource = readFile(mainPath);
  const readmeSource = readFile(readmePath);
  const packageSource = readFile(packagePath);
  const regressionScriptSource = readFile(regressionScriptPath);
  const uploadFileNameRegressionScriptSource = readFile(uploadFileNameRegressionScriptPath);
  const fileNameNormalizerRegressionScriptSource = readFile(fileNameNormalizerRegressionScriptPath);
  const workbookRegressionScriptSource = readFile(workbookRegressionScriptPath);

  const serviceSnippets = [
    "workbook.getWorksheet('ERP上传净表')",
    'Excel 文件必须包含名为 ERP上传净表 的工作表',
    'ERP上传净表必须连续填写',
    'ERP上传净表不允许包含订单头行',
    'this.applyOrderImportAutomaticFields(rows)',
    'normalizeImportRowsForSessionPreview',
    'lineType: row.lineType',
    'componentNo: row.componentNo || undefined',
    'parentComponentNo: row.parentComponentNo || undefined',
    'normalizeEditableOrderLineComponentFields',
    'this.normalizeEditableOrderLineComponentFields(await this.normalizeOrderLineImportReferences(dto.lines))',
    'this.normalizeEditableOrderLineComponentFields(await this.normalizeOrderLineImportReferences([dto]))[0]',
    'componentNo: this.normalizeEditableComponentNo(line.componentNo) || undefined',
    'parentComponentNo: this.normalizeEditableComponentNo(line.parentComponentNo) || undefined',
    'quantity: row.demandQuantity',
    'productionPlanQuantity: row.demandQuantity',
    'status: OrderStatus.DRAFT',
    'Excel 导入只保存 DRAFT 草稿，不触发 submit，也不生成生产任务或库存扣减',
    'commitImportSession',
    'const orderImportRowPreviewSelect',
    'select: orderImportRowPreviewSelect',
    'file: { select: { id: true, createdAt: true } }',
    "files: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }",
    "const fileIdCompare = String(left.file?.id || left.fileId || '')",
    'buildImportPreviewToken',
    '导入提交必须携带 previewToken',
    '导入预览已变化，请刷新预览后重新提交',
    'submitValidationLines',
    'this.validateOrderLineComponentStructure(submitValidationLines)',
    'buildOrderImportIssueReport',
    'formatImportDateOnly',
    "mode: 'insensitive' as const",
    'allSelectable',
    'excludedOrderNos',
    'orders: selectableOrders.map',
    'selectedOrderNos.has(this.normalizeOrderNo(order.orderNo))',
    'excludedOrderNos.has(this.normalizeOrderNo(order.orderNo))',
    'deleteDraft(orderNo: string)',
    'orderNoReservation.deleteMany',
    'sourceImportSessionId',
    'sourceImportFileName',
    'sourceImportRowNo',
    'findCurrentImportCommittedOrderNosBySessionIds',
    'findCurrentImportCommittedOrderNoSummariesBySessionIds',
    'ROW_NUMBER() OVER (PARTITION BY "sourceImportSessionId" ORDER BY "orderNo" ASC)',
    'jsonb_array_length("committedOrderNos")',
    'committedOrderNos: created.map((order) => order.orderNo)',
    'skippedSelectableCount',
    'excludedOrderCount',
    'committedOrderCount: committedOrderNos.length',
    'currentCommittedOrderCount: currentCommittedOrderNos.length',
    'committedOrderNos: committedOrderNosPreview',
    'currentCommittedOrderNos: currentCommittedOrderNosPreview',
    'materialSyncCount',
    'materialSyncPreview',
    'selectableOrderNos',
    'importDisplayFileName',
    'normalizeMultipartFileName',
    'sourceFileName: this.importDisplayFileName',
    'sourceImportFileId: row.sourceImportFileId || row.fileId',
    'sourceImportFileId: line.sourceImportFileId?.trim() || null',
    'sourceImportFileId: line.sourceImportFileId || importSourceFile?.id',
    'sourceImportFileName: this.importDisplayFileName(line.sourceImportFileName)',
    'importSessionFilePreview(sessionId: string, fileId: string',
    'const targetOrderKeys = new Set<string>()',
    'importSourceFilePreview(orderNo: string, fileId: string, query: GetOrderImportFilePreviewQueryDto',
    'sourceRowNo: { in: sourceRowNos }',
    'sourceImportFileId || (line.sourceImportSessionId && line.sourceImportRowNo)',
    'filesById',
    'normalizeOrderLineImportReferences',
    'dto = this.normalizeEditableOrderLineComponentFields(await this.normalizeOrderLineImportReferences([dto]))[0]',
    'file.sessionId !== sourceImportSessionId',
    'sourceImportFileName && sourceImportFileName !== fileDisplayName',
    "basename(storedFileName?.trim() || '')",
    'importRowPageOptions(query: GetOrderImportFilePreviewQueryDto',
    'getImportSourceFileInfoByLineId',
    'toImportSourceFileInfo',
    'sourceImportFileUrl',
    'sourceImportSheetName'
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`orders.service.ts must keep Excel import workflow snippet: ${snippet}`);
    }
  }

  const uploadFileNameSnippets = [
    'normalizeMultipartFileName',
    'const parts = sanitizedName.split(/[\\\\/]+/)',
    'decodePercentFileName',
    'decodeURIComponent(encodedName)',
    'attempt < 3',
    "Buffer.from(candidateName, 'latin1').toString('utf8')"
  ];
  for (const snippet of uploadFileNameSnippets) {
    if (!uploadFileNameSource.includes(snippet)) {
      addFailure(`upload-filenames.ts must keep Chinese upload filename normalization snippet: ${snippet}`);
    }
  }

  const frontendFileNameSnippets = [
    'normalizeDisplayFileName',
    'cleanDisplayFileName',
    'decodePercentFileName',
    'decodeURIComponent(encodedName)',
    'decodeLatin1Mojibake',
    "new TextDecoder('utf-8').decode(bytes)",
    'attempt < 3'
  ];
  for (const snippet of frontendFileNameSnippets) {
    if (!frontendFileNameSource.includes(snippet)) {
      addFailure(`fileNames.ts must keep frontend Chinese filename display normalization snippet: ${snippet}`);
    }
  }

  const mainSnippets = [
    'API_BODY_LIMIT',
    'bodyParser: false',
    "app.useBodyParser('json'",
    "app.useBodyParser('urlencoded'",
    'UploadExceptionFilter',
    'app.useGlobalFilters(new UploadExceptionFilter())'
  ];
  for (const snippet of mainSnippets) {
    if (!mainSource.includes(snippet)) {
      addFailure(`main.ts must keep large import request body handling snippet: ${snippet}`);
    }
  }

  const uploadExceptionFilterSource = readFile('backend/src/common/upload-exception.filter.ts');
  const uploadExceptionFilterSnippets = [
    '@Catch(multer.MulterError)',
    "exception.code === 'LIMIT_FILE_SIZE'",
    '上传文件超过大小限制',
    'code: exception.code'
  ];
  for (const snippet of uploadExceptionFilterSnippets) {
    if (!uploadExceptionFilterSource.includes(snippet)) {
      addFailure(`upload-exception.filter.ts must keep clear upload error handling snippet: ${snippet}`);
    }
  }

  const commitStart = serviceSource.indexOf('async commitImportSession');
  const commitEnd = serviceSource.indexOf('private async removeOrderImportStoredFile', commitStart);
  const commitSource = commitStart >= 0 && commitEnd > commitStart ? serviceSource.slice(commitStart, commitEnd) : '';
  const forbiddenCommitSnippets = ['this.submit(', 'productionTask.create', 'ProductionTask'];
  for (const snippet of forbiddenCommitSnippets) {
    if (commitSource.includes(snippet)) {
      addFailure(`Excel import commit must not submit production or create production tasks: ${snippet}`);
    }
  }

  const controllerSnippets = [
    "@Post('import-sessions')",
    "@Get('import-template')",
    "@Get('import-sessions/:sessionId/error-report')",
    "@Get('import-config')",
    "@Post('import-sessions/:sessionId/files')",
    "@Get('import-sessions/:sessionId/files/:fileId/preview')",
    "@Post('import-sessions/:sessionId/commit')",
    "@Delete('import-sessions/:sessionId/files/:fileId')",
    "@Delete('import-sessions/:sessionId')",
    "@Get(':orderNo/import-source-files/:fileId/preview')",
    "@Delete(':orderNo')",
    'orderImportUploadMaxBytes()',
    'normalizeMultipartFileName',
    'randomUUID().slice(0, 8)',
    "const allowedOrderImportExtensions = new Set(['.xlsx'])"
  ];
  for (const snippet of controllerSnippets) {
    if (!controllerSource.includes(snippet)) {
      addFailure(`orders.controller.ts must keep Excel import API snippet: ${snippet}`);
    }
  }

  const dtoSnippets = [
    'CreateOrderImportSessionDto',
    'GetOrderImportSessionQueryDto',
    'CommitOrderImportSessionDto',
    'sourceImportFileId?: string',
    'allSelectable',
    'orderNos',
    'excludedOrderNos',
    'previewToken'
  ];
  for (const snippet of dtoSnippets) {
    if (!dtoSource.includes(snippet)) {
      addFailure(`orders dto must keep Excel import DTO snippet: ${snippet}`);
    }
  }
  if (dtoSource.includes('MaxLength')) {
    addFailure('orders dto must not add MaxLength to order/import fields; Excel uploaded business text must not be artificially truncated.');
  }

  const schemaSnippets = [
    'model OrderImportSession',
    'model OrderImportFile',
    'model OrderImportRow',
    '@@unique([sessionId, fileHash])',
    '@@unique([sessionId, rowHash])',
    '@@index([sessionId, orderNo, sourceRowNo])',
    'sourceImportSessionId',
    'sourceImportFileId',
    'sourceImportFile OrderImportFile? @relation("OrderLineSourceImportFile"',
    '@@index([sourceImportFileId])',
    'sourceImportFileName',
    'sourceImportRowNo',
    'committedOrderNos',
    'componentNo',
    'parentComponentNo'
  ];
  for (const snippet of schemaSnippets) {
    if (!schemaSource.includes(snippet)) {
      addFailure(`Prisma schema must keep Excel import persistence snippet: ${snippet}`);
    }
  }
  const orderSchemaStart = schemaSource.indexOf('model CustomerOrder');
  const productionTaskSchemaStart = schemaSource.indexOf('model ProductionTask');
  const orderSchemaSource =
    orderSchemaStart >= 0 && productionTaskSchemaStart > orderSchemaStart
      ? schemaSource.slice(orderSchemaStart, productionTaskSchemaStart)
      : '';
  if (orderSchemaSource.includes('@db.VarChar')) {
    addFailure('Order import/order line text fields must stay unbounded text in Prisma; do not use @db.VarChar for uploaded Excel business text.');
  }

  const frontendSnippets = [
    '导入订单',
    '上传 ERP上传净表',
    '创建全部可导入草稿',
    '不会自动提交生产、不会占用库存、不会生成生产任务',
    '同步物料基础资料',
    '台账页不能直接上传',
    'import-drop-zone',
    'is-drag-over',
    'handleImportDragEnter',
    "event.dataTransfer.dropEffect = importUploading.value || importSessionCreating.value ? 'none' : 'copy'",
    'handleImportFileDrop',
    'Array.from(event.dataTransfer?.files || [])',
    'uploadImportFiles',
    'normalizeDisplayFileName',
    'displayImportFileName',
    "displayImportFileName(file.name).toLowerCase().endsWith('.xlsx')",
    'displayImportFileName(firstSkipped.name)',
    'displayImportSourceFileName',
    'mobile-order-paused',
    'isMobileOrderWorkspacePaused',
    'multiple class="hidden-file-input"',
    'uploadSummaries',
    'importCurrentCommittedOrderNosSummary',
    'orderImportConfig',
    'downloadOrderImportIssueReport',
    'orderImportSelectableOrderNos',
    'allSelectableImportOrderNos',
    'allSelectableImportOrderWarnings',
    'syncImportSelectionAgainstSelectableOrders',
    'confirmImportWarnings',
    '导入警告复核',
    'visibleSelectableCovered',
    'useAllSelectableCommit ? [] : orderNos',
    'useAllSelectableCommit ? excludedOrderNos : []',
    '未创建 ${result.skippedSelectableCount} 个可导入订单',
    'result.materialSyncCount',
    'result.materialSyncPreview',
    'importPreview.summary.materialSyncCount',
    'importPreview.summary.materialSyncPreview',
    '预计同步物料',
    'session.materialSyncCount',
    'session.materialSyncPreview',
    'materialSyncPreviewSuffix',
    '个物料基础资料',
    'commitOrderImportSession(importPreview.value.id, [], previewToken, true)',
    '导入预览已过期，请刷新预览后再创建草稿',
    'importPreview.value.previewToken',
    'deleteDraftOrder',
    '组件编号',
    '所属组件',
    'orderImportSourceFilePreview',
    'orderImportFilePreview',
    'OrderImportFilePreview',
    'openImportFilePreview',
    '上传文件预览',
    'OrderImportSourceFilePreview',
    'loadMoreImportSourcePreviewRows',
    '当前订单已加载',
    '手机端仅用于查看订单明细',
    '编辑订单、删除草稿、补单、取消订单和提交生产请在电脑端操作',
    'formatQuantity(row.demandQuantity, row.unit)',
    'sourceImportFileId',
    'sourceImportFileUrl',
    'sourceImportSheetName'
  ];
  for (const snippet of frontendSnippets) {
    if (
      !ordersViewSource.includes(snippet) &&
      !orderDetailSource.includes(snippet) &&
      !apiSource.includes(snippet) &&
      !typesSource.includes(snippet) &&
      !lineEditorSource.includes(snippet)
    ) {
      addFailure(`Frontend must keep Excel import UI/API snippet: ${snippet}`);
    }
  }
  const forbiddenFrontendSnippets = [
    '可导入订单较多，请直接使用“创建全部可导入草稿”',
    'selectableOrderCount || 0) > 1000'
  ];
  for (const snippet of forbiddenFrontendSnippets) {
    if (ordersViewSource.includes(snippet)) {
      addFailure(`Frontend must not add business quantity limits to Excel import selection: ${snippet}`);
    }
  }

  const readmeSnippets = [
    'Excel 订单导入',
    '正式导入只读取 `ERP上传净表` 工作表',
    '台账页只用于录入和复核，不能直接上传',
    '不会自动提交生产',
    '同一个导入会话可以一次多选或连续上传多个 `.xlsx` 文件',
    '同一订单拆成多个文件连续上传',
    'allSelectable + excludedOrderNos',
    '下载“问题明细”Excel',
    '实际生成的订单号',
    '当前仍存在的订单',
    '全部可导入排除提交',
    '旧预览拦截',
    '上传文件级预览',
    '文件名和 Excel 单元格中文必须保持不乱码',
    '分页只影响界面显示，不限制实际上传、解析和创建草稿的数据量',
    '订单导入字段不设置业务字数上限',
    '手机端订单界面只保留查看入口',
    '预览来源Excel',
    '删除导入记忆后只保留文字追溯',
    '物料基础库同步',
    '预计同步物料',
    '前 5 个物料号示例',
    '草稿编辑删除',
    '导入记忆删除',
    'API_BODY_LIMIT',
    'ORDER_IMPORT_UPLOAD_MAX_MB',
    'npm run verify:order-import-api',
    'npm run verify:upload-filenames-api',
    'npm run verify:file-name-normalizers',
    'npm run verify:order-import-workbooks'
  ];
  for (const snippet of readmeSnippets) {
    if (!readmeSource.includes(snippet)) {
      addFailure(`README.md must document Excel import rule: ${snippet}`);
    }
  }

  if (!packageSource.includes('"verify:order-import-api": "node scripts/verify-order-import-api.cjs"')) {
    addFailure('package.json must expose verify:order-import-api for Excel import regression testing.');
  }
  if (!packageSource.includes('"verify:upload-filenames-api": "node scripts/verify-upload-filenames-api.cjs"')) {
    addFailure('package.json must expose verify:upload-filenames-api for upload filename regression testing.');
  }
  if (!packageSource.includes('"verify:file-name-normalizers": "node scripts/verify-file-name-normalizers.cjs"')) {
    addFailure('package.json must expose verify:file-name-normalizers for frontend/backend filename normalizer regression testing.');
  }
  if (!packageSource.includes('"verify:order-import-workbooks": "node scripts/verify-order-import-workbooks.cjs"')) {
    addFailure('package.json must expose verify:order-import-workbooks for Excel workbook artifact validation.');
  }
  if (!packageSource.includes('npm run verify:file-name-normalizers && npm run verify:order-import-workbooks && npm run backend:verify:first-stage')) {
    addFailure('verify:first-stage must run workbook artifact validation before backend/frontend builds.');
  }

  const regressionSnippets = [
    "workbook.addWorksheet('ERP上传净表')",
    '/orders/import-sessions',
    'downloadTemplate',
    'assertTemplateWorkbook',
    "optionsSheet.getCell('E10000').text === 'C9999'",
    "dataValidation?.errorStyle === 'warning'",
    'assertIssueReportWorkbook',
    'toOrderUpdateLine',
    '/selectable-order-nos',
    '/error-report',
    'allSelectable: true',
    "createdOrder.status === 'DRAFT'",
    'sourceImportSessionId === sessionId',
    'sourceImportFileId: line.sourceImportFileId ||',
    'sourceImportFileId: \'00000000-0000-0000-0000-000000000000\'',
    '导入来源文件 ID 失效时，草稿编辑不能因为外键错误失败',
    '订单详情应通过来源会话和 Excel 行号重新找回正确文件',
    '导入草稿订单应允许编辑订单号',
    'await assertImportSourcePreview(updatedOrder)',
    '导入错误的草稿订单应允许删除',
    "line.lineType === 'COMPONENT'",
    "line.parentComponentNo === 'C001'",
    "line.componentNo === 'ASM-X1'",
    "line.parentComponentNo === 'ASM-X1'",
    "issue.code === 'PART_COMPONENT_NO_NOT_ALLOWED'",
    "invalidOrder?.orderDate === ''",
    '-SPLIT',
    'verifyBundledWorkbookUploadPreviews',
    'assertRejectedAndDuplicateUploadsStayClean',
    'assertNoStoredImportFilesMatching',
    'buildWorkbookWithoutUploadSheetBuffer',
    'buildWorkbookWithBlankRowInMiddleBuffer',
    'buildWorkbookWithOrderHeadRowBuffer',
    'buildWorkbookWithMissingRequiredHeaderBuffer',
    'buildWorkbookWithEmptyUploadSheetBuffer',
    'missingHeaderFileName',
    'emptyUploadSheetFileName',
    'duplicatePreview.summary.fileCount === 1',
    'duplicateRejectedFileName',
    'assertImportFileDeletionRemovesStoredFile',
    'afterDelete.deletedFileCount === 1',
    'discardResult.deletedFileCount === 1',
    '删除导入记忆后订单明细必须保留来源 Excel 文件名文字追溯',
    '删除导入记忆后订单明细不能继续保留可预览的来源文件 ID',
    'historySession.selectableOrderCount === 4',
    'historySession.materialSyncCount === 10',
    'historySession.materialSyncPreview?.includes',
    'assertSelectedCommitSupportsUnloadedOrders',
    'assertAllSelectableCommitSupportsExcludedOrders',
    'excludedOrderNos',
    'commit.excludedOrderCount === 1',
    'commit.skippedSelectableCount === 1',
    '只有全部可导入模式',
    '排除的订单编号存在空值或重复',
    '排除的订单不存在或已不可导入',
    'allSelectable + excludedOrderNos',
    '可选订单号接口必须返回每个可导入订单的警告数量',
    'assertImportSourcePreview',
    'assertImportSessionFilePreview',
    'assertNoMojibake',
    '上传文件预览必须保留中文文件名',
    '上传文件预览产品名称',
    '/import-source-files/',
    'sourceImportFileId',
    '来源 Excel 预览必须保留中文文件名',
    '来源 Excel 预览必须按 limit 分页返回',
    '来源 Excel 预览产品名称',
    'Material ${material.partCode} 产品名称',
    'assertStaleImportPreviewTokenRejectsCommit',
    'commitImportSessionExpectFailure',
    'firstPreview.previewToken',
    "{ allSelectable: true },",
    '导入预览已变化',
    'orderLimit=1&orderOffset=0',
    'committedRejectedFileName',
    'committed import session rejected upload',
    'outputs/component-order-template',
    'readFileSync(join(workbookDir, fileName))',
    "upload.files?.[0]?.sheetName",
    "upload.files?.[0]?.fileName === fileName",
    "sourceFileName === fileName",
    'upload.summary.materialSyncCount === 10',
    'upload.summary.materialSyncPreview?.includes',
    'commit.skippedBlockedCount === 1',
    'commit.committedOrderNos',
    'materialSyncCount',
    'materialSyncPreview',
    'commit.materialSyncCount === 10',
    'commit.materialSyncPreview?.includes',
    'committedImportSession.summary.committedOrderCount === 4',
    'assertImportedMaterialsUpserted',
    'Imported order lines must be upserted into Material library',
    'Blocked import rows must not be upserted into Material library',
    "material.status === 'ENABLED'",
    'renamedImportSession.currentCommittedOrderNos.includes(editableOrderNo)',
    'afterDeleteImportSession.summary.currentCommittedOrderCount === 3',
    'assertSubmitRejectsUnconfirmedMaterialIdentityConflict',
    'materialIdentityConfirmed: true',
    '发现同编码多套历史资料零件，提交生产前必须确认已核对',
    'assertSubmitRejectsInvalidPersistedComponentStructure',
    '所属组件 MISSING-COMPONENT 在当前订单内不存在',
    'await cleanup()',
    'new PrismaClient()',
    'prisma.material.deleteMany',
    'partCode: { startsWith: materialPrefix }'
  ];
  for (const snippet of regressionSnippets) {
    if (!regressionScriptSource.includes(snippet)) {
      addFailure(`verify-order-import-api.cjs must keep regression coverage snippet: ${snippet}`);
    }
  }

  const uploadFileNameRegressionSnippets = [
    '/orders/drawings/upload',
    '/orders/import-sessions',
    '/files',
    '/inventory/adjustments/upload',
    '订单导入-乱码修复验证.xlsx',
    '订单导入-percent编码验证.xlsx',
    '订单导入-路径清理验证.xlsx',
    '订单图纸-中文验证.png',
    '订单图纸-乱码修复验证.png',
    '订单图纸-percent编码验证.png',
    '订单图纸-路径清理验证.png',
    '库存盘点照片-中文验证.png',
    '库存盘点工单-乱码修复验证.png',
    '库存盘点-percent编码验证.png',
    '库存盘点-路径清理验证.png',
    'mojibakeLatin1',
    'utf8PercentFileName',
    'windowsFakePath',
    'posixPathName',
    'assertNoMojibake',
    '订单导入 mojibake 文件名必须修复为中文',
    '订单导入 percent-encoded 文件名必须修复为中文',
    '订单导入路径文件名必须只保留 basename',
    '订单图纸 mojibake 文件名必须修复为中文',
    '订单图纸 percent-encoded 文件名必须修复为中文',
    '订单图纸路径文件名必须只保留 basename',
    '库存附件 mojibake 文件名必须修复为中文',
    '库存附件 percent-encoded 文件名必须修复为中文',
    '库存附件路径文件名必须只保留 basename',
    "join(uploadRoot, 'drawings', fileName)",
    "join(uploadRoot, 'inventory-adjustments', fileName)"
  ];
  for (const snippet of uploadFileNameRegressionSnippets) {
    if (!uploadFileNameRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-upload-filenames-api.cjs must keep upload filename regression snippet: ${snippet}`);
    }
  }

  const fileNameNormalizerRegressionSnippets = [
    "loadTsExports('frontend/src/utils/fileNames.ts')",
    "loadTsExports('backend/src/common/upload-filenames.ts')",
    'normalizeDisplayFileName',
    'normalizeMultipartFileName',
    '订单导入-乱码修复验证.xlsx',
    '示例订单来源 ERP净表.xlsx',
    'mojibakeLatin1',
    '百分号编码文件名',
    '带路径中文文件名',
    'assertNoMojibake'
  ];
  for (const snippet of fileNameNormalizerRegressionSnippets) {
    if (!fileNameNormalizerRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-file-name-normalizers.cjs must keep frontend/backend filename normalizer regression snippet: ${snippet}`);
    }
  }

  const workbookRegressionSnippets = [
    'outputs',
    'component-order-template',
    '组件零件清单下单台账模板-最终版.xlsx',
    'ERP上传净表',
    'ERP导入清单',
    'veryHidden',
    '订单编号',
    '需求数量(自动)',
    'erpordertest.xlsx',
    'erpordertest-',
    '#REF',
    '可见工作表仍在说明旧中间表'
  ];
  for (const snippet of workbookRegressionSnippets) {
    if (!workbookRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-order-import-workbooks.cjs must keep workbook artifact validation snippet: ${snippet}`);
    }
  }
}

function verifySeedStockReservationCoverage() {
  const seedPath = 'database/prisma/seed.ts';
  if (!fileExists(seedPath)) {
    addFailure(`Missing Prisma seed file: ${seedPath}`);
    return;
  }

  const source = readFile(seedPath);
  const requiredSnippets = [
    'seedDraftInventoryReservationOrder',
    'seedStockFulfillmentOrder',
    'SO-20260508-002',
    'SO-20260508-900',
    'SO-20260508-901',
    'IB-STOCK-DEMO-P4102',
    'OrderLineStockAllocation',
    'if (productionPlanQuantity <= 0)',
    "productionPlanOverrideByCode: planDiffers ? 'PLAN-001' : null",
    "productionPlanOverrideByName: planDiffers ? '刘计划' : null",
    "productionPlanOverrideByRole: planDiffers ? '生产计划员' : null",
    'InventoryReservationStatus.ACTIVE',
    "compatibilityStatus: 'NEEDS_CONFIRMATION'",
    '跳过较小库存批次',
    '备货库存转订单待发货库存',
    '同一库存批次被同一草稿订单的两条零件预占',
    '同一备货库存批次，用于验证跨订单库存预占扣除'
  ];

  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`seed.ts must keep first-stage stock reservation coverage snippet: ${snippet}`);
    }
  }
}

verifyRequiredFiles();
verifyNoMojibakeInUserFacingSources();
verifyNavigation();
verifyResponsiveMobileBaseline();
verifyNoNativeBrowserDialogs();
verifyResponsiveElementPlusDialogs();
verifyCustomerSelectOnlyShowsName();
verifyOrderSelectDisplayContract();
verifyOrderFilterOrder();
verifyCaseInsensitiveBusinessKeyContracts();
verifyProductionTabOrder();
verifyProductionOrderSummaryWorkflow();
verifyProductionOperatorSearchWorkflow();
verifyPlannerProcessAndSubmitGuard();
verifyProcessPinyinSearchWorkflow();
verifyMaterialSuggestionSearchWorkflow();
verifyProcessEditDisabledReasonWorkflow();
verifyProcessStepDragSortWorkflow();
verifyMobileCompactOrderCards();
verifyProductionProcessCompletionSequenceWorkflow();
verifyProductionReplenishmentAndWithdrawWorkflow();
verifyOrderChangeAndCancellationWorkflow();
verifyShortageReplenishmentClosureWorkflow();
verifyWarehouseWorkflow();
verifyNoticeCustomerNameDisplay();
verifyInventoryTransactionOrderLineTraceability();
verifyPartialShipmentWorkflow();
verifySharedLinkComponents();
verifyDrawingDuplicateConfirmationWorkflow();
verifyNoInlineCustomerDropdowns();
verifyNoSilentSearchResultLimits();
verifyStatisticsDisplayContract();
verifySharedOrderDisplayStatus();
verifyStockSourcePayloadSanitizer();
verifyInventorySourceDialogReviewGuard();
verifyInventorySourceCurrentOrderReservationUi();
verifyStockProductionPlanOverridePreserved();
verifyOrderStockSourceValidationTransaction();
verifyInventorySourcePriority();
verifyInventoryAdjustmentWorkflow();
verifyProcessDefinitionReferenceGuard();
verifyMissingProcessDefinitionRepairCoverage();
verifyRepairDraftReservationPriority();
verifyDataVerifierStockSourceReviewStatus();
verifyRepairScriptEntrypoint();
verifyReadmeRepairSafetyDocs();
verifyOrderExcelImportWorkflow();
verifySeedStockReservationCoverage();

if (failures.length > 0) {
  console.error('First-stage source verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('First-stage source verification passed.');
