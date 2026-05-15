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

function verifyOrderStatusEnumContract() {
  const schemaSource = readFile('database/prisma/schema.prisma');
  const orderStatusBlock = schemaSource.match(/enum\s+OrderStatus\s*\{([\s\S]*?)\}/)?.[1] || '';
  if (!orderStatusBlock.includes('PENDING_PRODUCTION')) {
    addFailure('schema.prisma OrderStatus must include PENDING_PRODUCTION for the first-stage submitted order state.');
  }
  if (orderStatusBlock.includes('SUBMITTED')) {
    addFailure('schema.prisma OrderStatus must not keep SUBMITTED; use PENDING_PRODUCTION to match AGENTS.md.');
  }

  const runtimeFiles = [
    'backend/src/modules/orders/orders.service.ts',
    'backend/src/modules/statistics/statistics.service.ts',
    'database/prisma/seed.ts',
    'database/prisma/verify-first-stage.ts',
    'frontend/src/components/StatusTag.vue',
    'frontend/src/types/erp.ts',
    'frontend/src/utils/orderStatus.ts',
    'frontend/src/views/OrdersListView.vue'
  ];
  for (const projectPath of runtimeFiles) {
    const source = readFile(projectPath);
    if (/OrderStatus\.SUBMITTED|status\s*===\s*['"`]SUBMITTED['"`]|value:\s*['"`]SUBMITTED['"`]|SUBMITTED:\s*['"`]/.test(source)) {
      addFailure(`${projectPath} must use PENDING_PRODUCTION instead of the old SUBMITTED order status.`);
    }
  }

  const migrationSource = readFile('database/prisma/migrations/20260515242000_order_status_pending_production/migration.sql');
  const migrationSnippets = [
    'ALTER TYPE "OrderStatus" RENAME VALUE \'SUBMITTED\' TO \'PENDING_PRODUCTION\'',
    'SET "status" = \'PENDING_PRODUCTION\'::"OrderStatus"',
    'WHERE "status"::text = \'SUBMITTED\''
  ];
  for (const snippet of migrationSnippets) {
    if (!migrationSource.includes(snippet)) {
      addFailure(`Order status migration must keep compatibility snippet: ${snippet}`);
    }
  }
}

function verifyNavigation() {
  const navPath = 'frontend/src/config/navigation.ts';
  if (!fileExists(navPath)) {
    return;
  }

  const expectedLabels = ['客户', '零件管理', '订单', '生产流程', '流程记忆', '生产', '统计', '仓库', '库存'];
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

function verifyNoElementPlusConfirmDialogs() {
  const frontendDir = resolveProjectPath('frontend/src');
  if (!fs.existsSync(frontendDir)) {
    return;
  }

  for (const filePath of walkFiles(frontendDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes('ElMessageBox.confirm')) {
      addFailure(
        `Element Plus confirm is not allowed for key operations; use el-dialog instead: ${toProjectPath(filePath)}`
      );
    }
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

function verifyElementPlusChineseLocale() {
  const mainPath = 'frontend/src/main.ts';
  if (!fileExists(mainPath)) {
    addFailure(`Missing frontend entry file: ${mainPath}`);
    return;
  }

  const mainSource = readFile(mainPath);
  const snippets = [
    "import zhCn from 'element-plus/es/locale/lang/zh-cn';",
    '.use(ElementPlus, { locale: zhCn })'
  ];
  for (const snippet of snippets) {
    if (!mainSource.includes(snippet)) {
      addFailure(`frontend/src/main.ts must configure Element Plus zh-cn locale to avoid English default UI text: ${snippet}`);
    }
  }
}

function verifyCustomerSelectOnlyShowsName() {
  const componentPath = 'frontend/src/components/CustomerSelect.vue';
  const customersViewPath = 'frontend/src/views/CustomersView.vue';
  const ordersListViewPath = 'frontend/src/views/OrdersListView.vue';
  const productionViewPath = 'frontend/src/views/ProductionView.vue';
  const servicePath = 'backend/src/modules/customers/customers.service.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const typesPath = 'frontend/src/types/erp.ts';
  if (!fileExists(componentPath)) {
    return;
  }

  const source = readFile(componentPath);
  const customersViewSource = fileExists(customersViewPath) ? readFile(customersViewPath) : '';
  const ordersListViewSource = fileExists(ordersListViewPath) ? readFile(ordersListViewPath) : '';
  const productionViewSource = fileExists(productionViewPath) ? readFile(productionViewPath) : '';
  const serviceSource = readFile(servicePath);
  const apiSource = readFile(apiPath);
  const typesSource = readFile(typesPath);
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

  const mobileTouchSnippets = [
    'min-height: 44px',
    'class="customer-option"',
    '.customer-option strong',
    'text-overflow: clip',
    ':no-data-text="customerEmptyText"',
    ':no-match-text="customerEmptyText"',
    'loadErrorText',
    'loadCustomerById',
    'erpApi.customer(id)',
    'options.value = [customer, ...options.value.filter',
    'selected-customer-change',
    'emitSelectedCustomer',
    'erpApi.customersPage',
    'customerPageSummary',
    'loadMoreCustomers',
    'customerTotalCount',
    'customerHasMore',
    '加载更多客户',
    '暂无客户，请先在客户模块维护或执行 seed 测试数据'
  ];
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
    'async findOne(id: string)',
    '客户下拉和跨页面跳转按 id 回填客户名称',
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
  const customerPaginationSnippets = [
    "query.withPage === 'true'",
    'const totalCount = matchedCustomers.length;',
    'hasMore: offset + items.length < totalCount',
    '客户搜索分页必须把总数和是否还有更多返回给前端',
    'customersPage(',
    'CustomerListResponse',
    'customerPagination',
    'handleCustomerPageChange',
    '个客户'
  ];
  const customerPaginationSources = [serviceSource, apiSource, typesSource, customersViewSource].join('\n');
  for (const snippet of customerPaginationSnippets) {
    if (!customerPaginationSources.includes(snippet)) {
      addFailure(`Customer search pagination must keep visible count/load-more contract snippet: ${snippet}`);
    }
  }
  const frontendSources = walkFiles(resolveProjectPath('frontend/src'))
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
  if (/customers\s*\(\s*keyword\?:\s*string/.test(apiSource) || /erpApi\.customers\(/.test(frontendSources)) {
    addFailure('Frontend customer dropdowns must use customersPage() with visible total/hasMore instead of the legacy unpaged customers() API.');
  }
  if (!agentsSource.includes('客户搜索结果必须按命中强度排序')) {
    addFailure('AGENTS.md must document ranked customer search behavior.');
  }
  if (customersViewSource.includes('default-first-option')) {
    addFailure('CustomersView.vue customer region selects must not enable default-first-option; city/country require explicit confirmation or typed value.');
  }
  const customerSuggestionPaginationSnippets = [
    'customerSuggestionLimit',
    'customerSuggestionKeyword',
    'erpApi.customersPage(',
    '已显示 ${result.items.length} / ${result.totalCount} 个客户，按 Enter 查询完整列表',
    'customer.isMoreHint'
  ];
  for (const snippet of customerSuggestionPaginationSnippets) {
    if (!customersViewSource.includes(snippet)) {
      addFailure(`CustomersView.vue must keep paged customer autocomplete suggestion snippet: ${snippet}`);
    }
  }
  if (/erpApi\.customers\([^)]*queryString/.test(customersViewSource)) {
    addFailure('CustomersView.vue autocomplete must use customersPage with visible total instead of the legacy customers endpoint.');
  }
  const orderCustomerSelectionSnippets = [
    '订单新增必须由操作员在 CustomerSelect 中明确选择客户',
    "orderForm.customerId = '';"
  ];
  for (const snippet of orderCustomerSelectionSnippets) {
    if (!ordersListViewSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must keep explicit customer selection for new orders snippet: ${snippet}`);
    }
  }
  if (ordersListViewSource.includes('activeCustomers.value[0]') || /erpApi\.customers\(\)/.test(ordersListViewSource)) {
    addFailure('OrdersListView.vue must not default new orders to the first customer or load all customers for selection.');
  }
  const productionCustomerNameSnippets = [
    'selectedCustomerName',
    '生产页只按当前筛选客户回填名称',
    'erpApi.customer(customerId)'
  ];
  for (const snippet of productionCustomerNameSnippets) {
    if (!productionViewSource.includes(snippet)) {
      addFailure(`ProductionView.vue must keep single-customer name lookup snippet: ${snippet}`);
    }
  }
  if (/erpApi\.customers\(\)/.test(productionViewSource)) {
    addFailure('ProductionView.vue must not load all customers just to render filter labels.');
  }
}

function verifyCustomerContactSoftDisableWorkflow() {
  const schemaPath = 'database/prisma/schema.prisma';
  const migrationPath = 'database/prisma/migrations/20260515114500_customer_contact_status/migration.sql';
  const servicePath = 'backend/src/modules/customers/customers.service.ts';
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  const typesPath = 'frontend/src/types/erp.ts';

  for (const projectPath of [schemaPath, migrationPath, servicePath, verifierPath, typesPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing customer contact soft-disable file: ${projectPath}`);
      return;
    }
  }

  const requiredSnippets = [
    [schemaPath, readFile(schemaPath), 'status       CommonStatus @default(ENABLED)'],
    [schemaPath, readFile(schemaPath), '@@index([customerId, status])'],
    [migrationPath, readFile(migrationPath), '客户多联系人改为软停用旧记录'],
    [migrationPath, readFile(migrationPath), 'ALTER TABLE "CustomerContact" ADD COLUMN IF NOT EXISTS "status" "CommonStatus"'],
    [servicePath, readFile(servicePath), 'customerContact.updateMany'],
    [servicePath, readFile(servicePath), '多联系人编辑只软停用旧联系人'],
    [servicePath, readFile(servicePath), 'data: { status: CommonStatus.DISABLED, isPrimary: false }'],
    [servicePath, readFile(servicePath), 'where: { status: CommonStatus.ENABLED }'],
    [verifierPath, readFile(verifierPath), 'CUSTOMER_DISABLED_CONTACT_PRIMARY'],
    [verifierPath, readFile(verifierPath), 'where: { status: CommonStatus.ENABLED }'],
    [typesPath, readFile(typesPath), 'status?: CommonStatus;']
  ];
  for (const [projectPath, source, snippet] of requiredSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`${projectPath} must keep customer contact soft-disable snippet: ${snippet}`);
    }
  }

  const verifierSource = readFile(verifierPath);
  const migrationSqlSource = readMigrationSqlSource();
  const customerCoreVerifierSnippets = [
    'CUSTOMER_IDENTITY_MISSING',
    'CUSTOMER_OPTIONAL_TEXT_BLANK',
    'CUSTOMER_CONTACT_SNAPSHOT_PHONE_WITHOUT_NAME',
    'CUSTOMER_CONTACT_IDENTITY_MISSING',
    'CUSTOMER_CONTACT_OPTIONAL_TEXT_BLANK'
  ];
  for (const snippet of customerCoreVerifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep customer core data verification snippet: ${snippet}`);
    }
  }

  const customerCoreDatabaseSnippets = [
    'Customer_identity_not_blank',
    'Customer_optional_text_not_blank',
    'Customer_region_fields_valid',
    'Customer_contact_snapshot_valid',
    'CustomerContact_identity_not_blank',
    'CustomerContact_optional_text_not_blank',
    'CustomerContact_disabled_not_primary',
    'CustomerContact_one_enabled_primary_per_customer'
  ];
  for (const snippet of customerCoreDatabaseSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep customer core database guard snippet: ${snippet}`);
    }
  }

  const serviceSource = readFile(servicePath);
  if (serviceSource.includes('customerContact.deleteMany')) {
    addFailure('CustomersService must soft-disable old CustomerContact rows instead of deleting multi-contact history.');
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
  if (source.includes('default-first-option')) {
    addFailure('OrderSelect.vue must not enable default-first-option; operators should explicitly pick the target order.');
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
  const verifierPath = 'database/prisma/verify-first-stage.ts';

  for (const projectPath of [customerServicePath, ordersServicePath, warehousesServicePath, schemaPath, verifierPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing business key contract source file: ${projectPath}`);
      return;
    }
  }

  const customerSource = readFile(customerServicePath);
  const ordersSource = readFile(ordersServicePath);
  const warehousesSource = readFile(warehousesServicePath);
  const schemaSource = readFile(schemaPath);
  const verifierSource = readFile(verifierPath);
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
    'OrderNoReservation_orderNoNormalized_key',
    'OrderNoReservation_identity_not_blank',
    'OrderNoReservation_order_no_normalized',
    'OrderNoReservation_reason_valid'
  ];
  for (const snippet of migrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep case-insensitive business key index/reservation snippet: ${snippet}`);
    }
  }

  const orderNoVerifierSnippets = [
    'ORDER_NO_RESERVATION_IDENTITY_MISSING',
    'ORDER_NO_RESERVATION_REASON_HAS_SPACES',
    'ORDER_NO_RESERVATION_REASON_INVALID',
    'DRAFT_ORDER_RENUMBERED',
    'SEED_DRAFT_STOCK_RESERVED',
    'ORDER_NO_RESERVATION_NORMALIZED_MISMATCH'
  ];
  for (const snippet of orderNoVerifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep order number reservation data verification snippet: ${snippet}`);
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
  const productionOrderSummaryZeroFallbackSnippets = [
    'Number(task.customerOrderQuantity || 0)',
    'Number(task.plannedQuantity || 0)',
    'Number(task.completedQuantity || 0)',
    'Number(task.unresolvedShortageQuantity || 0)',
    'Number(task.pendingProductionReplenishmentQuantity || 0)',
    'current.unresolvedShortageQuantityByUnit.get(shortageUnit) || 0',
    'current.pendingProductionReplenishmentQuantityByUnit.get(shortageUnit) || 0',
    'current.progressBuckets.get(progressLabel) || 0',
    'orderReceiptQuantityByTaskNo.get(transaction.productionTaskNo) || 0',
    'stockQuantityByTaskNo.get(transaction.productionTaskNo) || 0',
    'stockQuantityByTaskNo.get(task.productionTaskNo) || 0',
    'orderReceiptQuantityByTaskNo.get(task.productionTaskNo) || 0',
    'Number(left.stepNo || 0)',
    'Number(right.stepNo || 0)',
    'orderReceiptQuantity || (task.inventoryBatch ? decimalToNumber(task.inventoryBatch.quantity) : 0)',
    'quantityByLine.get(key) || 0',
    'completedReplenishmentQuantityByLine.get(key) || 0'
  ];
  for (const snippet of productionOrderSummaryZeroFallbackSnippets) {
    if (serviceSource.includes(snippet)) {
      addFailure(`ProductionService.orderSummary must use ?? for quantity fallback so explicit 0 quantities remain stable: ${snippet}`);
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
    ':before-close="handleStartDialogClose"',
    ':before-close="handleBatchStartDialogClose"',
    ':before-close="handleFinalConfirmDialogClose"',
    '开始生产正在保存，请等待保存完成',
    '批量开始生产正在保存，请等待保存完成',
    '生产完成确认正在保存，请等待保存完成',
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
  const verifierPath = 'database/prisma/verify-first-stage.ts';

  for (const projectPath of [controllerPath, servicePath, viewPath, apiPath, seedPath, verifierPath]) {
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
    "accountId: 'WH-001'",
    "role: '仓库管理员'",
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

  const verifierSource = readFile(verifierPath);
  const verifierSnippets = [
    'PRODUCTION_OPERATOR_OPTIONAL_TEXT_BLANK',
    'PRODUCTION_OPERATOR_ID_CARD_MASK_STALE',
    'PRODUCTION_OPERATOR_ID_CARD_EXPOSED',
    'PRODUCTION_OPERATOR_PINYIN_NOT_NORMALIZED',
    'PRODUCTION_OPERATOR_KEYWORDS_EMPTY',
    'PRODUCTION_OPERATOR_INITIALS_UNSEARCHABLE'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep production operator data verification snippet: ${snippet}`);
    }
  }

  const migrationSqlSource = readMigrationSqlSource();
  const migrationSnippets = [
    'ProductionOperator_accountId_lower_key',
    'ProductionOperator_identity_not_blank',
    'ProductionOperator_optional_text_not_blank',
    'ProductionOperator_enabled_search_fields_valid',
    'ProductionOperator_id_card_mask_valid',
    'CARDINALITY("keywords") > 0',
    '"idCardMasked" !~ \'\\d{8,}\''
  ];
  for (const snippet of migrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep production operator database guard snippet: ${snippet}`);
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
  const migrationSqlSource = readMigrationSqlSource();
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
  const submitQuantityZeroFallbackSnippets = [
    'effectivePlanQuantityByLineId.get(line.id) || 0',
    'effectivePlanQuantityByLineId.get(insufficientReworkSourceLine.id) || 0',
    'Number(record.shortageQuantity || 0)'
  ];
  for (const snippet of submitQuantityZeroFallbackSnippets) {
    if (serviceSource.includes(snippet)) {
      addFailure(`OrdersService submit and shortage quantity checks must use ?? fallback so explicit 0 quantities remain stable: ${snippet}`);
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
    'const canEditProcess = computed(() => canEditProcessBase.value && !isMobileLayout.value && Boolean(processEditorCode.value))',
    '请先选择下单/计划流程填写人员，选择后才可编辑工序。',
    'configuredByCode: processEditorCode.value',
    'submittedByCode: submitPlanOperatorCode.value',
    ':before-close="handleSubmitOrderDialogClose"',
    'function handleSubmitOrderDialogClose',
    'if (saving.value) {',
    'if (submitting.value) {',
    '订单正在提交生产，请等待提交完成',
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
    ':before-close="handleSubmitOrderDialogClose"',
    'function handleSubmitOrderDialogClose',
    'if (saving.value) {',
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
    'erpApi.processTemplates(keyword.value.trim() || undefined, props.showStatusFilter ? statusFilter.value : \'ENABLED\')'
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
    "const status = query.status === 'ALL' ? undefined : query.status || CommonStatus.ENABLED;",
    'where: status ? { status } : undefined',
    'templates.filter((template) => this.templateMatchesKeyword(template, keyword))',
    'searchText: this.buildSearchText(templateName, steps, remark)',
    '...steps.flatMap((step) => [step.processName, step.processRemark])',
    'return pinyinSearchMatches(',
    'status: CommonStatus.DISABLED',
    'disabledTemplateNameKey(existing.templateNameNormalized, id)',
    '流程记忆属于可复用基础资料，只软停用并释放名称查重键，不物理删除历史记录',
    'async restore(id: string)',
    '恢复流程记忆时重新校验标准工序仍启用'
  ];
  for (const snippet of processTemplatesSnippets) {
    if (!processTemplatesSource.includes(snippet)) {
      addFailure(`ProcessTemplatesService must keep template pinyin search snippet: ${snippet}`);
    }
  }
  if (processTemplatesSource.includes('prisma.processTemplate.delete')) {
    addFailure('ProcessTemplatesService must soft-disable process templates instead of physically deleting reusable process memory.');
  }
}

function verifyProcessMemoryCoreDataGuards() {
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  if (!fileExists(verifierPath)) {
    addFailure(`Missing process memory data verifier: ${verifierPath}`);
    return;
  }

  const verifierSource = readFile(verifierPath);
  const migrationSqlSource = readMigrationSqlSource();
  const verifierSnippets = [
    'PROCESS_DEFINITION_OPTIONAL_TEXT_BLANK',
    'PROCESS_DEFINITION_SEARCH_TEXT_EMPTY',
    'PROCESS_DEFINITION_SEARCH_TEXT_HAS_SPACES',
    'PROCESS_TEMPLATE_OPTIONAL_TEXT_BLANK',
    'PROCESS_TEMPLATE_STATUS_SEARCH_MISMATCH',
    'PROCESS_TEMPLATE_DISABLED_KEY_INVALID',
    'PROCESS_TEMPLATE_ENABLED_KEY_DISABLED',
    'PROCESS_TEMPLATE_SEARCH_TEXT_EMPTY',
    'PROCESS_TEMPLATE_SEARCH_TEXT_HAS_SPACES',
    'PROCESS_TEMPLATE_STEPS_NOT_ARRAY',
    'template.status === CommonStatus.ENABLED && template.searchText !== expectedSearchText'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep process memory core data verification snippet: ${snippet}`);
    }
  }

  const migrationSnippets = [
    'ProcessDefinition_identity_not_blank',
    'ProcessDefinition_optional_text_not_blank',
    'ProcessTemplate_identity_not_blank',
    'ProcessTemplate_status_search_consistent',
    'ProcessTemplate_steps_array_not_empty',
    'ProcessTemplate_optional_text_not_blank',
    '"templateNameNormalized" LIKE (\'disabled:\' || "id" || \':%\')',
    'jsonb_typeof("steps") = \'array\' AND jsonb_array_length("steps") > 0'
  ];
  for (const snippet of migrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep process memory core database guard snippet: ${snippet}`);
    }
  }

  const processTextLimitChecks = [
    {
      path: 'backend/src/modules/process-templates/dto.ts',
      tokens: ['MaxLength', '@MaxLength']
    },
    {
      path: 'backend/src/modules/process-templates/process-templates.service.ts',
      tokens: [
        'normalized.length > 60',
        'remark && remark.length > 300',
        'step.processRemark && step.processRemark.length > 120',
        '流程记忆名称不能超过 60 个字符',
        '流程记忆备注不能超过 300 个字符',
        '参数备注不能超过 120 个字符'
      ]
    },
    {
      path: 'backend/src/modules/process-definitions/dto.ts',
      tokens: ['MaxLength', '@MaxLength']
    },
    {
      path: 'backend/src/modules/process-definitions/process-definitions.service.ts',
      tokens: [
        'normalized.length > 30',
        'remark && remark.length > 200',
        '标准工序名称不能超过 30 个字符',
        '标准工序备注不能超过 200 个字符'
      ]
    },
    {
      path: 'frontend/src/components/ProcessTemplateManager.vue',
      tokens: [
        'templateNameMaxLength',
        'templateRemarkMaxLength',
        'processRemarkMaxLength',
        'show-word-limit',
        'maxlength="30"',
        'truncateTemplateName',
        'slice(0, templateNameMaxLength'
      ]
    }
  ];

  for (const check of processTextLimitChecks) {
    const source = readFile(check.path);
    for (const token of check.tokens) {
      if (source.includes(token)) {
        addFailure(`Process memory business text must not be truncated by hard length limits: ${check.path} contains ${token}`);
      }
    }
  }

  const removedVerifierTokens = ['PROCESS_TEMPLATE_STEP_REMARK_TOO_LONG', 'ORDER_LINE_PROCESS_STEP_REMARK_TOO_LONG'];
  for (const token of removedVerifierTokens) {
    if (verifierSource.includes(token)) {
      addFailure(`verify-first-stage.ts must not reject long process remarks with removed guard: ${token}`);
    }
  }
}

function verifyNoBusinessTextHardMaxLength() {
  const businessTextFiles = [
    'backend/src/modules/process-definitions/dto.ts',
    'backend/src/modules/process-templates/dto.ts',
    'frontend/src/components/NoticeAcknowledgeDialog.vue',
    'frontend/src/components/ProcessDefinitionManager.vue',
    'frontend/src/components/ProcessTemplateManager.vue',
    'frontend/src/views/OrderDetailView.vue',
    'frontend/src/views/OrdersListView.vue',
    'frontend/src/views/ProcessSelectionView.vue',
    'frontend/src/views/WarehouseView.vue'
  ];

  for (const projectPath of businessTextFiles) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing business text length guard file: ${projectPath}`);
      continue;
    }
    const source = readFile(projectPath);
    if (/\bMaxLength\b|@MaxLength|maxlength=|:maxlength=|show-word-limit/.test(source)) {
      addFailure(`Business text inputs and DTOs must not add hard max length truncation: ${projectPath}`);
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
    { source: dtoSource, file: dtoPath, snippet: 'projectModel?: string;' },
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
    { source: serviceSource, file: servicePath, snippet: 'if (!keyword && !customerId && !projectModel)' },
    { source: serviceSource, file: servicePath, snippet: 'private async findEnabledMaterialMastersByCodes' },
    { source: serviceSource, file: servicePath, snippet: 'materialId: material.materialId || materialMasterByCode.get(materialKey)?.id' },
    { source: serviceSource, file: servicePath, snippet: "projectModel: { contains: requestedProjectModel, mode: 'insensitive' }" },
    { source: serviceSource, file: servicePath, snippet: 'preferredProjectModel = \'\'' },
    { source: serviceSource, file: servicePath, snippet: 'customerUsageCount' },
    { source: serviceSource, file: servicePath, snippet: 'lastCustomerOrderDateDiff' },
    { source: serviceSource, file: servicePath, snippet: 'private sortableDateValue' },
    { source: serviceSource, file: servicePath, snippet: 'hasQueryCustomerHistory' },
    { source: serviceSource, file: servicePath, snippet: 'lastCustomerOrderBelongsToQueryCustomer' },
    { source: serviceSource, file: servicePath, snippet: 'queryCustomerSnapshotOrderDate' },
    { source: serviceSource, file: servicePath, snippet: 'identityKeys: new Set<string>()' },
    { source: serviceSource, file: servicePath, snippet: 'identityFieldValues: new Map<string, Set<string>>()' },
    { source: serviceSource, file: servicePath, snippet: 'identityVariantCount: history?.identityVariantCount ?? 0' },
    { source: serviceSource, file: servicePath, snippet: 'hasIdentityConflict: Boolean((history?.identityVariantCount ?? 0) > 1)' },
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
    { source: serviceSource, file: servicePath, snippet: 'const isoDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();' },
    { source: serviceSource, file: servicePath, snippet: 'const looseIsoDate = `${looseDate}T00:00:00.000Z`;' },
    { source: serviceSource, file: servicePath, snippet: 'material.projectModel' },
    { source: serviceSource, file: servicePath, snippet: 'private materialThicknessSearchValues' },
    { source: serviceSource, file: servicePath, snippet: 'for (const precision of [0, 1, 2, 3, 4])' },
    { source: serviceSource, file: servicePath, snippet: 'values.add(`${text}mm`)' },
    { source: serviceSource, file: servicePath, snippet: '...this.materialThicknessSearchValues(line.partThickness)' },
    { source: serviceSource, file: servicePath, snippet: '...this.materialThicknessSearchValues(material.partThickness)' },
    { source: serviceSource, file: servicePath, snippet: "searchMatchText: '图纸资料匹配'" },
    { source: serviceSource, file: servicePath, snippet: "searchMatchText: '历史订单匹配'" },
    { source: serviceSource, file: servicePath, snippet: 'const shouldSeedMaterialMaster = Boolean(keyword);' },
    { source: serviceSource, file: servicePath, snippet: 'disabledMaterialCodes.has(key)' },
    { source: serviceSource, file: servicePath, snippet: 'const suggestionMaterials = [...materialRows.values()].filter' },
    { source: serviceSource, file: servicePath, snippet: "sourceType === 'ALL' || item.availableQuantity > 0" },
    { source: serviceSource, file: servicePath, snippet: 'partThickness: line.partThickness === null || line.partThickness === undefined ? null : decimalToNumber(line.partThickness)' },
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
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '匹配到多个精确零件，请从下拉列表中选择具体零件' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'sourceSearchManualPickRequired' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'transformRulePanelVisible' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'transformRuleEmptyVisible' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'transformRuleSuggestionSummary' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'erpApi.materialTransformRulesPage' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '加载更多来源加工建议' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '已显示 ${transformRuleSuggestions.value.length} / ${transformRuleSuggestionTotal.value} 条来源加工建议' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '查来源库存不会选中批次、不会扣库存' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '只切换搜索，不自动选用库存' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '系统未自动选用批次，请逐批勾选并人工确认' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'openTransformRulesPage' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: "router.push({ path: '/inventory/material-transforms', query })" },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '本次订单零件暂无匹配的来源加工建议' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'exactSuggestions.length === 1' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'function canAutoSwitchInventorySuggestion' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: "matchKind: 'EXACT' | 'FUZZY'" },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: "matchKind === 'EXACT' && !item.hasIdentityConflict" },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '唯一模糊命中也必须人工点击候选项' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'function warnInventorySuggestionNeedsManualPick' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'function materialIdentityConflictFieldsText' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'function keepInventorySuggestionManualPick' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'const sourceSearchResultHint = computed' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '@input="handleSourceSearchKeywordInput"' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'sourceSearchSelectedLabel' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'function handleSourceSearchKeywordInput' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '手工改动库存来源搜索词后清理旧候选和批次聚焦' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '同编码存在多套历史资料，请点击候选项确认' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '请核对${materialIdentityConflictFieldsText(item)}，并点击候选项人工确认后再切换库存来源' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '已按当前候选切换库存来源，请核对${materialIdentityConflictFieldsText(item)}' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '找到 1 个相似零件，请点击结果确认后再切换库存来源' },
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
    { source: editorSource, file: editorPath, snippet: '当前订单 C001-C9999 自动组件编号已用完' },
    { source: editorSource, file: editorPath, snippet: 'line.componentNo = componentNo;' },
    { source: editorSource, file: editorPath, snippet: '@focus="captureComponentNoBeforeEdit(row)"' },
    { source: editorSource, file: editorPath, snippet: '@focus="captureComponentNoBeforeEdit(line)"' },
    { source: editorSource, file: editorPath, snippet: 'line.parentComponentNo = nextComponentNoValue;' },
    { source: editorSource, file: editorPath, snippet: 'clearChildParentComponentNo(previousComponentNo);' },
    { source: editorSource, file: editorPath, snippet: '@blur="() => fillExactMaterialFromInput(row, \'partCode\')"' },
    { source: editorSource, file: editorPath, snippet: '@blur="() => fillExactMaterialFromInput(row, \'partName\')"' },
    { source: editorSource, file: editorPath, snippet: ':customer-id="customerId"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '查看库存使用率、零件库存汇总和逐批库存溯源' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'to="/inventory/materials"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '库存使用总览' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '查看零件搜索记忆、订单使用和库存参考' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '编辑只改搜索记忆，停用只影响后续搜索推荐' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'materialMemoryPagination' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'handleMaterialMemoryPageChange' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '条零件搜索记忆' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'label="零件编码" min-width="160"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'label="零件名称" min-width="180"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'title="编辑零件搜索记忆"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '库存使用总览加载失败，请确认后端服务和筛选条件' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '零件库存汇总' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'label="库存来源/图纸" width="140"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '按零件汇总使用率、可用、预占、订单库存、备货库存和仓库分布' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '库存使用率' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'function formatInventoryUsageRate' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'Number(row.usedQuantity ?? 0) / totalQuantity' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'function isZeroInventorySummaryRow' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '当前范围 0 库存' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'function summarySourceDetailsButtonText' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'function openSummarySourceDetails' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '零件资料详情' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'const sourceDetailsReferenceOnly = ref(false)' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: ':reference-only="sourceDetailsReferenceOnly"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'const inventorySummaryByPartCode = computed' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'function formatMaterialMemoryUsageRate' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '无库存记录' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '平均使用率' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'const averageInventoryUsageRateText = computed' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '库存溯源' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '逐批查看库存来源、占用记录、仓库库位，并进行盘点调整' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '库存来源/图纸' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '手机端只查看库存来源和预占记录' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'label="生产日期"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'formatDate(row.productionDate)' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'formatDate(batch.productionDate)' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'label="盘点备注"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "{{ row.remark || '-' }}" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '编码 / 名称 / 拼音 / 规格 / 客户 / 订单 / 图号' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'function disableMaterialMemory' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "import MaterialSuggestionOption from '../components/MaterialSuggestionOption.vue';" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'show-available' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: ':available-scope-label="selectedWarehouseName || \'全部仓库\'"' },
    {
      source: inventoryViewSource,
      file: inventoryViewPath,
      snippet: 'erpApi.inventoryMaterialSuggestions(\n      normalizedKeyword,\n      filters.warehouseId,\n      undefined,\n      undefined,\n      undefined,\n      filters.customerId'
    },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: "import MaterialSuggestionOption from './MaterialSuggestionOption.vue';" },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: ":title=\"title || '库存来源详情'\"" },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '允许选择可替代零件，但必须逐批确认数量' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'title?: string;' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'referenceOnly?: boolean;' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'const sourceGuardAlertTitle = computed' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '当前仅用于核对零件基础资料、图纸和历史来源' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'const sourceAvailableSummaryLabel = computed' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '当前范围可用' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'const sourceBatchSummaryLabel = computed' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '当前范围批次' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'const sourceCompositionSummaryLabel = computed' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '资料状态' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'const sourceCompositionSummaryText = computed' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '无可用库存批次' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'const sourceKindSummaryVisible = computed' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'const sourceEmptyDescription = computed' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: '当前范围没有库存批次，仅展示零件基础资料和历史来源核对结果' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: ':description="sourceEmptyDescription"' },
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
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'const historyCustomerTitle = computed' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '全部历史客户：${names.join' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: ':title="historyTooltipText"' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'if (visibleNames.length >= 3)' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '历史客户 ${visibleNames.join' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '图号 ${props.item.drawingNo}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '型号 ${props.item.projectModel}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '日期 ${props.item.drawingDate}' },
    { source: editorSource, file: editorPath, snippet: 'props.customerId' },
    { source: apiSource, file: apiPath, snippet: 'customerId?: string' },
    { source: apiSource, file: apiPath, snippet: 'projectModel?: string' },
    { source: apiSource, file: apiPath, snippet: 'materialIdentityConfirmed?: boolean;' },
    { source: apiSource, file: apiPath, snippet: 'inventoryMaterials(filters: MaterialMemoryFilters = {})' },
    { source: apiSource, file: apiPath, snippet: 'inventoryMaterialsPage(filters: MaterialMemoryFilters = {})' },
    { source: serviceSource, file: servicePath, snippet: "query.withPage === 'true'" },
    { source: serviceSource, file: servicePath, snippet: 'serializeMaterialMemoryRow' },
    { source: apiSource, file: apiPath, snippet: 'disableInventoryMaterial(materialId: string)' },
    { source: apiSource, file: apiPath, snippet: 'customerId,' },
    { source: typesSource, file: typesPath, snippet: 'customerUsageCount?: number;' },
    { source: typesSource, file: typesPath, snippet: 'materialId?: string;' },
    { source: typesSource, file: typesPath, snippet: 'searchMatchText?: string;' },
    { source: typesSource, file: typesPath, snippet: 'matchedCustomerCode?: string;' },
    { source: typesSource, file: typesPath, snippet: 'matchedHistoryOrderNo?: string;' },
    { source: typesSource, file: typesPath, snippet: 'export interface MaterialMemory' },
    { source: typesSource, file: typesPath, snippet: 'export interface MaterialMemoryListResponse' },
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
    { source: editorSource, file: editorPath, snippet: '请先选择零件编码' },
    { source: editorSource, file: editorPath, snippet: '零件编码 ${item.partCode} 存在多套历史资料' },
    { source: editorSource, file: editorPath, snippet: '精确匹配零件' },
    { source: editorSource, file: editorPath, snippet: '避免阻断新零件下单' },
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
  const materialSuggestionZeroThicknessSnippets = [
    'partThickness: line.partThickness ? decimalToNumber(line.partThickness) : null',
    'existing.partThickness = line.partThickness ? decimalToNumber(line.partThickness) : null',
    'partThickness: row.partThickness ? decimalToNumber(row.partThickness) : null'
  ];
  for (const snippet of materialSuggestionZeroThicknessSnippets) {
    if (serviceSource.includes(snippet)) {
      addFailure(`inventory.service.ts must preserve explicit 0 partThickness during material suggestion/import serialization: ${snippet}`);
    }
  }
  const inventoryQuantityZeroFallbackSnippets = [
    'Number(row.availableQuantity || 0)',
    'reservedQuantityByBatchId.get(batch.id) || 0',
    '_max.commonSortOrder || 0',
    'Number(dto.defaultQuantity || 0)',
    '_max.sortOrder || 0',
    'history?.customerUsageCount || 0',
    'history?.usageCount || 0',
    'identityVariantCount: history?.identityVariantCount || 0',
    '(history?.identityVariantCount || 0)',
    'right.searchMatchRank || 0',
    'left.searchMatchRank || 0',
    'right.customerUsageCount || 0',
    'left.customerUsageCount || 0',
    'right.historyUsageCount || 0',
    'left.historyUsageCount || 0',
    'right.availableQuantity || 0',
    'left.availableQuantity || 0',
    'quantityByBatchId.get(row.batchId) || 0',
    '_sum.errorCount || 0',
    '_sum.warningCount || 0',
    '_sum.duplicateRowCount || 0'
  ];
  for (const snippet of inventoryQuantityZeroFallbackSnippets) {
    if (serviceSource.includes(snippet)) {
      addFailure(`inventory.service.ts must use ?? for inventory/material quantity fallback so a valid 0 is not treated as missing: ${snippet}`);
    }
  }

  const upsertMaterialsStart = orderServiceSource.indexOf('private async upsertMaterials');
  const upsertMaterialsEnd = orderServiceSource.indexOf('private async generateOrderNo', upsertMaterialsStart);
  const upsertMaterialsSource =
    upsertMaterialsStart >= 0 && upsertMaterialsEnd > upsertMaterialsStart
      ? orderServiceSource.slice(upsertMaterialsStart, upsertMaterialsEnd)
      : '';
  if (!upsertMaterialsSource.includes('existingMaterialCodes')) {
    addFailure('orders.service.ts upsertMaterials must detect existing Material rows by code before syncing order-created parts.');
  }
  if (!upsertMaterialsSource.includes('this.isComponentLineType(line.lineType)')) {
    addFailure('orders.service.ts upsertMaterials must skip COMPONENT rows so parent assemblies do not become global Material search memory.');
  }
  if (!upsertMaterialsSource.includes('不能静默覆盖全局 Material 搜索记忆')) {
    addFailure('orders.service.ts upsertMaterials must document that order lines cannot overwrite global Material search memory.');
  }
  if (upsertMaterialsSource.includes('tx.material.update') || upsertMaterialsSource.includes("status: 'ENABLED'")) {
    addFailure('orders.service.ts upsertMaterials must not update existing Material rows or auto-enable disabled materials from order save/import.');
  }

  if (
    !/function handlePartCodeInput[\s\S]*?clearAutoMaterialFieldsWhenMaterialIdentityChanges\(line\)/.test(editorSource) ||
    !/function handlePartNameInput[\s\S]*?clearAutoMaterialFieldsWhenMaterialIdentityChanges\(line\)/.test(editorSource)
  ) {
    addFailure('OrderLineEditor.vue must clear auto-filled material fields when either partCode or partName is manually changed.');
  }
  if (!/snapshot\.autoFields\.partThickness[\s\S]*?line\.partThickness = 0;/.test(editorSource)) {
    addFailure('OrderLineEditor.vue must clear auto-filled partThickness to 0 after material identity changes so operators re-check thickness.');
  }
  if (!editorSource.includes('组件不适用') || !editorSource.includes('父级组件由子零件分别维护厚度')) {
    addFailure('OrderLineEditor.vue must clearly show COMPONENT thickness as not applicable and explain it is maintained by child parts.');
  }
  if (!editorSource.includes('厚度不适用（父级组件由子零件维护）')) {
    addFailure('OrderLineEditor.vue fixed-format text must explain parent component thickness is maintained by child parts.');
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
    ':draggable="canEditProcess && !isMobileLayout"',
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

function verifyPartComponentStructureWorkflow() {
  const requiredFiles = [
    'frontend/src/components/OrderLineEditor.vue',
    'frontend/src/views/ModelBomsView.vue',
    'frontend/src/views/MaterialsManagementView.vue',
    'frontend/src/views/MaterialsView.vue',
    'frontend/src/views/MaterialTransformsView.vue',
    'frontend/src/views/OrdersListView.vue',
    'frontend/src/views/OrderDetailView.vue',
    'frontend/src/views/ProcessSelectionView.vue',
    'frontend/src/views/ProductionView.vue',
    'frontend/src/views/WarehouseView.vue',
    'frontend/src/views/InventoryView.vue',
    'frontend/src/components/InventorySourceDetailsDialog.vue',
    'frontend/src/api/erp.ts',
    'backend/src/modules/materials/materials.service.ts',
    'backend/src/modules/inventory/dto.ts',
    'backend/src/modules/inventory/inventory.controller.ts',
    'backend/src/modules/orders/orders.service.ts',
    'backend/src/modules/inventory/inventory.service.ts',
    'database/prisma/verify-first-stage.ts',
    'database/prisma/schema.prisma',
    'database/prisma/seed.ts'
  ];
  for (const projectPath of requiredFiles) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing part component structure workflow file: ${projectPath}`);
      return;
    }
  }

  const orderLineEditorSource = readFile('frontend/src/components/OrderLineEditor.vue');
  const modelBomSource = readFile('frontend/src/views/ModelBomsView.vue');
  const materialDashboardSource = readFile('frontend/src/views/MaterialsManagementView.vue');
  const materialsViewSource = readFile('frontend/src/views/MaterialsView.vue');
  const materialTransformsSource = readFile('frontend/src/views/MaterialTransformsView.vue');
  const ordersListSource = readFile('frontend/src/views/OrdersListView.vue');
  const orderDetailSource = readFile('frontend/src/views/OrderDetailView.vue');
  const processSelectionSource = readFile('frontend/src/views/ProcessSelectionView.vue');
  const productionSource = readFile('frontend/src/views/ProductionView.vue');
  const warehouseSource = readFile('frontend/src/views/WarehouseView.vue');
  const inventorySource = readFile('frontend/src/views/InventoryView.vue');
  const inventorySourceDialogSource = readFile('frontend/src/components/InventorySourceDetailsDialog.vue');
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  const materialsServiceSource = readFile('backend/src/modules/materials/materials.service.ts');
  const inventoryDtoSource = readFile('backend/src/modules/inventory/dto.ts');
  const inventoryControllerSource = readFile('backend/src/modules/inventory/inventory.controller.ts');
  const ordersServiceSource = readFile('backend/src/modules/orders/orders.service.ts');
  const inventoryServiceSource = readFile('backend/src/modules/inventory/inventory.service.ts');
  const dataVerifierSource = readFile('database/prisma/verify-first-stage.ts');
  const prismaSchemaSource = readFile('database/prisma/schema.prisma');
  const seedSource = readFile('database/prisma/seed.ts');
  const migrationSqlSource = readMigrationSqlSource();

  const orderLineSnippets = [
    'class="line-drag-handle"',
    ':draggable="!readOnly && lines.length > 1"',
    '@dragstart.stop="startLineDrag($event, $index)"',
    '@dragover.prevent="handleLineDragOver($event, $index)"',
    '@drop.prevent="dropLineDrag($index)"',
    '<el-icon><Rank /></el-icon>',
    'props.lines.splice(0, props.lines.length, ...ordered);',
    'buildRootDraggedLineOrder',
    'buildChildDraggedLineOrder',
    'isAttachedLocalChildLine',
    '子零件只能在同一父组件内拖拽排序',
    '组件和单独零件请拖到顶层行之间排序',
    'orderLineFixedTextDialogVisible',
    'orderLineFixedTextLines',
    'orderLineFixedTextLineCount',
    'isBlankOrderLineForFixedText',
    ':disabled="orderLineFixedTextLineCount === 0"',
    '<el-button size="small" :disabled="orderLineFixedTextLineCount === 0" @click="openOrderLineFixedTextDialog">固定格式</el-button>',
    'buildOrderLineDragGroups(orderLineFixedTextLines.value)',
    'orderLineFixedText',
    'buildOrderLineFixedText',
    'openOrderLineFixedTextDialog',
    'copyOrderLineFixedText',
    '订单零件固定格式清单',
    'class="order-line-fixed-textarea"',
    'hasAvailableComponentNo',
    'hasSourceComponentNo',
    'isMissingParentComponentLine',
    'parentComponentScopeText',
    '已有订单组件',
    '当前明细组件',
    '未匹配父级',
    '所属组件不存在',
    'is-structure-orphan',
    'orderLineStructureLabel',
    'orderLineStructureHint',
    'is-order-line-child',
    '子零件 ->',
    '单独零件',
    'function syncChildParentComponentNo',
    'function clearChildParentComponentNo',
    'line.parentComponentNo = inheritedParentComponentNoForLine(line);',
    'isComponentNoOutOfRange',
    '组件编号只支持 C001-C9999'
  ];
  for (const snippet of orderLineSnippets) {
    if (!orderLineEditorSource.includes(snippet)) {
      addFailure(`OrderLineEditor.vue must keep order line component drag/parent-child snippet: ${snippet}`);
    }
  }

  const modelBomSnippets = [
    'activeBomStructureGroups',
    'class="bom-line-drag-handle"',
    '@dragstart.stop="startLineDrag($event, index)"',
    '@drop.prevent="dropLineDrag"',
    '@drop.self.prevent="dropLineDragAtEnd"',
    'buildRootDraggedLineOrder',
    'buildChildDraggedLineOrder',
    'isAttachedChildLine',
    '子零件只能在同一父组件内拖拽排序',
    '组件和单独零件请拖到顶层行之间排序',
    'bomStructureTextDialogVisible',
    'function openBomStructureTextDialog',
    'BOM 固定格式清单',
    'class="fixed-format-textarea"',
    'function copyBomStructureText',
    'formatLineOrderText',
    'formatLineStatusText',
    'formatLineThicknessForText',
    '不适用（父级组件由子零件维护）',
    'formatModelBomStatusText',
    ':disabled="!bomStructureText"',
    '适用范围：客户 ${activeBom.value.customerName',
    '结构统计：组件 ${summary.componentCount}',
    '厚度核对 ${summary.missingThicknessCount}',
    '来源 BOM：${activeBom.value.sourceBomNameSnapshot',
    '明细：',
    '暂无明细，仍可查看零件包固定格式头部信息',
    "lines.push('暂无有效明细')",
    'class="default-process-drag-handle"',
    '@dragstart.stop="startDefaultProcessDrag($event, index)"',
    '@drop.self.prevent="dropDefaultProcessAtEnd"',
    'function dropDefaultProcessAtEnd',
    'lineDefaultProcessFilterKeyword.value = \'\'',
    'normalizeLineDefaultProcessSteps',
    '默认工艺只作为下单初始建议',
    'lineStructureHint',
    'lineStructureTagType',
    '子零件 ->',
    '单独零件',
    'MATERIAL_LATEST',
    '零件最新',
    '结构 ${formatLineStructure(row)}',
    '固定格式清单已复制',
    '未匹配父级',
    '单独零件',
    '暂无包内明细，请添加组件或单独零件',
    '添加第一个组件',
    '添加子零件',
    '添加单独零件',
    "openLineCreateDialog('CHILD_PART', normalizeComponentNo(group.line.componentNo))",
    "openLineCreateDialog('CHILD_PART', normalizeComponentNo(row.componentNo))",
    'bom-structure-actions',
    'bom-structure-meta',
    'preferredParentComponentNo',
    'matchedParent',
    'empty-line-actions',
    '组件 ${group.line.componentNo',
    'bom-source-diff-panel',
    'sourceBomForDiff',
    'sourceBomDiffText',
    'copySourceBomDiffText',
    'bom-source-diff-actions',
    'sourceBomReviewDialogVisible',
    'selectedSourceBomDiffIssue',
    'sourceBomReviewListDialogVisible',
    'BOM 差异核对',
    'BOM 差异核对记录',
    '点击核对会在当前页面弹出对比窗口',
    'sourceBomReviewedDiffKeys',
    'sourceBomDiffReviews',
    'sourceBomReviewForm',
    'sourceBomDiffReviewedCount',
    'sourceBomDiffStatusLabel',
    'sourceBomDiffStatusTagType',
    'sourceBomDiffFingerprint',
    'sourceBomDiffReviewRecordText',
    'formatSourceBomReviewAt',
    'modelBomDiffReviews',
    'confirmModelBomDiffReview',
    'disableModelBomDiffReview',
    'confirmSourceBomDiffReviewed',
    'revokeSourceBomDiffReviewed',
    'revokeSourceBomDiffReviewRow',
    '确认保留差异',
    '撤销核对',
    '核对人',
    ':disabled="!sourceBomReviewForm.reviewedBy.trim()"',
    'BOM 差异核对记录已保存',
    'BOM 差异核对已撤销',
    'openSourceBomDiffReviewDialog',
    'sourceBomReviewLineText',
    'source-bom-review-table',
    'bom-source-diff-action-hint',
    '{{ issue.suggestedAction }}',
    '建议：${issue.suggestedAction}',
    '按来源行补入',
    'createCustomerLineFromSourceBomReview',
    'editSourceBomReviewTargetLine',
    'focusSourceBomReviewTargetLine',
    'openSourceBomFromReview',
    'suggestedAction',
    'BomDiffField',
    'bomLineReviewFields',
    'source-bom-review-changed',
    'routeTargetBomId',
    'routeTargetLineId',
    'routeTargetMaterialId',
    'routeTargetMaterialKeyword',
    'routeTargetMaterialStatus',
    'routeTargetLineStructure',
    'routeTargetParentComponentNo',
    'routeTargetAction',
    'highlightedBomLineId',
    'route.query.bomId',
    'route.query.lineId',
    'route.query.bomName',
    'route.query.lineStructure',
    'route.query.parentComponentNo',
    'route.query.materialId',
    'route.query.materialKeyword',
    'route.query.materialStatus',
    'route.query.action',
    'route.query.returnTo',
    'modelBomReturnPath',
    'modelBomReturnButtonText',
    'returnFromModelBom',
    "routeQueryText(route.query.returnTo) === '/orders' ? '/orders' : '/materials'",
    "modelBomReturnPath.value === '/orders' ? '返回订单' : '返回零件管理'",
    '只接受白名单返回路径',
    "routeTargetAction.value !== 'editLine'",
    "routeTargetAction.value !== 'createBom'",
    "routeTargetAction.value !== 'copyBom'",
    "routeTargetAction.value !== 'createLine'",
    'openRouteTargetLineEditDialog',
    'openRouteTargetCreateBomDialog',
    'openRouteTargetCopyBomDialog',
    'openRouteTargetCreateLineDialog',
    'applyRouteTargetMaterialToLineForm',
    'routeLineStructure',
    'routeTargetLineStructure.value = routeLineStructure(lineStructure)',
    'routeTargetParentComponentNo.value = normalizeComponentNo(parentComponentNo)',
    'routeTargetLineNotice',
    'routeTargetLineEditNotice',
    'routeTargetLineStructureLabel',
    '来自零件管理：已带入',
    '来自订单 BOM 预览：',
    '保存后请回到订单页点击“刷新 BOM 预览”',
    'shouldPromptOrderPreviewRefresh',
    'BOM 明细已保存，请回到订单页点击“刷新 BOM 预览”后再确认带入草稿',
    '已定位到指定 BOM 明细',
    '未找到要核对的 BOM 明细',
    'route-target-line-alert',
    'prefillBomCreateFormFromRoute',
    'prefillBomCreateFormFromCurrentFilters',
    'routeCreateBomDefaultCommon',
    'bomForm.bomName = bomName.trim() || defaultRouteBomName',
    'bomForm.isCommon = defaultCommon',
    '留空表示全部机型/项目',
    "return isCustomerBom ? '客户通用零件包' : '百胜通用零件包';",
    "ElMessage.warning('请填写零件包名称')",
    'projectModel: payloadProjectModel || undefined',
    "ElMessage.warning('请填写客户零件包名')",
    'projectModel: copyForm.projectModel.trim() || undefined',
    "bomForm.customerScope = filters.customerId ? 'PRIVATE' : 'ALL'",
    'defaultRouteBomName',
    'prefillCopyFormFromSourceBom',
    'await loadModelBoms();',
    ':data-bom-line-id="row.id"',
    'appendRouteTargetBom',
    'focusRouteTargetLine',
    'focusBomLine',
    'activeBomHasRouteTargetLine',
    'routeTargetActionApplied',
    'ensureModelBomVisible',
    'syncModelBomFiltersToSavedBom',
    'modelBomFilterSummaryVisible',
    'model-bom-filter-summary',
    '@selected-customer-change="handleSelectedCustomerChange"',
    'selectedCustomerName',
    'selectedCustomerFilterLabel',
    'modelBomKeywordFilterLabel',
    'modelBomStatusFilterLabel',
    'model-bom-name-cell',
    'model-bom-name-tags',
    '查看明细',
    '编辑表头',
    'setBomCommon',
    'setModelBomCommon',
    'modelBomOperationSavingKey',
    'modelBomOperationKey',
    ':loading="modelBomOperationSavingKey === modelBomOperationKey(row, \'common\')"',
    ':loading="modelBomOperationSavingKey === modelBomOperationKey(row, \'disable\')"',
    ':loading="modelBomOperationSavingKey === modelBomOperationKey(row, \'enable\')"',
    ':loading="modelBomOperationSavingKey === modelBomOperationKey(row, \'delete\')"',
    'if (modelBomOperationSavingKey.value) {',
    'modelBomOperationSavingKey.value = operationKey',
    'modelBomLineOperationSavingKey',
    'modelBomLineOperationKey',
    "type ModelBomLineOperationAction = 'disable' | 'enable' | 'reorder'",
    ':close-on-click-modal="!saving"',
    ':close-on-press-escape="!saving"',
    ':before-close="handleSavingDialogClose"',
    'warnSavingDialogClose',
    'closeBomDialog',
    'closeCopyDialog',
    'closeLineDialog',
    'BOM 正在保存，请等待保存完成',
    ':loading="modelBomLineOperationSavingKey === modelBomLineOperationKey(row, \'disable\')"',
    ':loading="modelBomLineOperationSavingKey === modelBomLineOperationKey(row, \'enable\')"',
    'if (saving.value || modelBomLineOperationSavingKey.value) {',
    'modelBomLineOperationKey(operationSource, \'reorder\')',
    'row.isCommon',
    'v-model="bomForm.isCommon"',
    "status === 'DISABLED' && bomForm.isCommon",
    "isCommon: bomForm.status === 'DISABLED' ? false : bomForm.isCommon",
    '停用 BOM 会自动取消常用排序',
    '恢复启用时可重新勾选常用',
    'v-model="copyForm.isCommon"',
    'copyForm.isCommon = Boolean(row.isCommon)',
    'isCommon: copyForm.isCommon',
    '复制时设为常用只影响目标客户/机型范围内的显示顺序和下单推荐优先级',
    '常用只影响当前范围内的显示顺序和下单推荐优先级，不修改 BOM 明细、适用客户、订单、生产任务或库存。',
    '常用说明：常用 BOM 只影响同一客户/机型范围内的显示顺序和下单推荐优先级，不修改 BOM 明细、适用客户、订单、生产任务或库存。',
    '普通可用说明：非常用 BOM 仍可维护、复制和手动用于下单，只是不参与常用优先排序。',
    'modelBomCommonDisplayOrder(row)',
    'common-bom-sort-cell',
    '常用显示顺序 ${modelBomCommonDisplayOrder(row) || \'-\'}',
    'filters.commonOnly',
    'filters.excludeGlobalAllProject',
    'modelBomCommonFilterLabel',
    'modelBomGlobalAllProjectFilterLabel',
    'applyModelBomCommonFilter',
    'modelBomCommonDragRows',
    'startCommonBomDrag',
    'dropCommonBom',
    'modelBomCommonScopeKey',
    'modelBomCommonDragRowsForScope',
    'draggedCommonBomScopeKey',
    'v-if="row.status === \'ENABLED\' && row.isCommon"',
    'v-if="!isMobileLayout"',
    'common-bom-drag-handle',
    'aria-label="拖拽调整常用 BOM 顺序"',
    '<el-icon><Rank /></el-icon>',
    'reorderModelBomCommon',
    'route.query.commonOnly',
    'route.query.isCommon',
    'route.query.excludeGlobalAllProject',
    "filters.commonOnly = commonOnly === 'true'",
    "filters.excludeGlobalAllProject = excludeGlobalAllProject === 'true'",
    'excludeGlobalAllProject: filters.excludeGlobalAllProject || undefined',
    'modelBomScopeSummaryTotals',
    'BOM 范围固定格式清单',
    'modelBomListText',
    'formatModelBomListLineSummary',
    '有效推荐行',
    '停用/基础停用行',
    '结构统计',
    '核对项',
    '停用统计',
    '只统计启用且基础零件未停用的 BOM 明细；停用内容不参与后续下单推荐。',
    '基础零件停用 {{ modelBomLineSummary(row).materialDisabledCount }}',
    'const effectiveCount = (row.lines || []).filter(lineCountsAsActiveBomContent).length;',
    '厚度已确认 ${confirmedThicknessCount} / 历史参考 ${historyThicknessCount} / 无厚度 ${noThicknessCount} / 需核对 ${summary.missingThicknessCount}',
    '厚度说明：固定格式中只有“来源 当前BOM明细”表示该厚度已经保存到当前 BOM',
    '停用 ${summary.disabledCount} / 基础零件停用 ${summary.materialDisabledCount}',
    'openModelBomListTextDialog',
    'copyModelBomListText',
    'modelBomCustomerText',
    'BOM 范围固定格式清单已复制',
    '恢复启用',
    'active-bom-disabled-alert',
    "activeBom?.status === 'DISABLED'",
    ":disabled=\"activeBom.status === 'DISABLED'\"",
    ":disabled=\"activeBom?.status === 'DISABLED' || saving || Boolean(modelBomLineOperationSavingKey)\"",
    "!lineForm.id && activeBom.value.status === 'DISABLED'",
    '当前零件包已停用；不会参与下单推荐。恢复启用后才允许新增包内明细，已有明细仍可查看和编辑。',
    '当前零件包已停用，请先恢复启用后再新增包内明细',
    'activeBomLineSummary',
    'enabledComponentNosForLines',
    'summarizeModelBomLines',
    'modelBomLineSummary(row).componentCount',
    'model-bom-structure-tags',
    '未匹配父级 ->',
    '所属组件 ${parentComponentNo} 不存在或已停用',
    'bom-summary-tags',
    'modelBomConfirmDialogVisible',
    'openModelBomConfirmDialog',
    'handleModelBomConfirmDialogClose',
    'class="model-bom-confirm-panel"',
    'modelBomConfirmButtonText',
    'modelBomConfirmButtonType',
    '@change="searchModelBoms"',
    '@clear="searchModelBoms"',
    '<el-option label="全部" value="ALL" />',
    'status: CommonStatus | \'ALL\'',
    'status: filters.status',
    "filters.status === 'ALL'",
    'confirmCopyBom',
    '当前阶段只允许从全部客户通用零件包复制为客户私有 BOM',
    '复制后独立维护',
    '复制后客户 BOM 独立维护，不会反向修改来源 BOM',
    'confirmDisableBom',
    'confirmDisableLine',
    'enabledChildLinesForComponentLine',
    '停用只影响后续推荐，不会删除历史订单、客户 BOM 副本或包内明细',
    '该组件下 ${enabledChildLines.length} 个启用子零件会同步软停用，历史订单不受影响',
    '该组件下没有启用子零件需要同步停用，历史订单不受影响',
    '组件 {{ activeBomLineSummary.componentCount }}',
    '子零件 {{ activeBomLineSummary.childPartCount }}',
    '单独零件 {{ activeBomLineSummary.standalonePartCount }}',
    '未匹配父级 {{ activeBomLineSummary.orphanPartCount }}',
    '厚度核对 {{ activeBomLineSummary.missingThicknessCount }}',
    '厚度核对 {{ modelBomLineSummary(row).missingThicknessCount }}',
    'missingThicknessCount',
    'formatLineThickness',
    'function formatLineThicknessSourceForText(row: ModelBomLine)',
    "return '当前BOM明细';",
    "return '历史订单参考';",
    '来源 ${formatLineThicknessSourceForText(row)}',
    'function formatLineThicknessSourceLabel(row: ModelBomLine)',
    'function lineThicknessSourceTagType(row: ModelBomLine)',
    'function formatLineThicknessReviewReason(row: ModelBomLine)',
    'function lineThicknessReviewTitle(row: ModelBomLine)',
    'const thicknessReviewSummary = computed(() => summarizeThicknessReviewLines(thicknessReviewBom.value?.lines || []));',
    'const thicknessReviewText = computed(() => {',
    'BOM 厚度核对清单',
    '确认厚度只写入当前 BOM 明细，不改历史订单、库存或生产记录。',
    '序号\\tBOM顺序\\t结构\\t零件编码\\t零件名称\\t当前厚度\\t厚度来源\\t核对原因\\t默认图纸\\t规格',
    'BOM 顺序与下方明细表连续编号一致',
    '<el-table-column label="BOM 顺序" width="90">',
    'displayBomLineOrder(line) || \'-\'',
    'copyThicknessReviewText',
    '暂无可复制的厚度核对清单',
    '厚度核对清单已复制',
    'function summarizeThicknessReviewLines(lines: ModelBomLine[])',
    'function formatThicknessReviewBreakdown(lines: ModelBomLine[])',
    '点击打开当前 BOM 厚度核对：需核对 ${summary.totalCount}，未填写 ${summary.noThicknessCount}，历史参考 ${summary.historyReferenceCount}，来源未确认 ${summary.unconfirmedSourceCount}',
    'historyReferenceCount',
    'unconfirmedSourceCount',
    '需核对 {{ thicknessReviewSummary.totalCount }}',
    '未填写 {{ thicknessReviewSummary.noThicknessCount }}',
    '历史参考 {{ thicknessReviewSummary.historyReferenceCount }}',
    '来源未确认 {{ thicknessReviewSummary.unconfirmedSourceCount }}',
    '手机端仅查看厚度核对清单，核对并保存厚度请在电脑端操作。',
    '手机端仅查看厚度核对清单，核对并保存厚度请在电脑端操作',
    '保存后会继续提示剩余厚度核对项',
    '当前 BOM 明细未填写厚度，请核对后保存',
    '当前值来自历史订单，只是预填参考；保存后才写入当前 BOM 明细',
    '厚度来源未确认，请核对后保存到当前 BOM 明细',
    '核对原因',
    "return '不适用（父级组件由子零件维护）';",
    '@click.stop="openBomThicknessReview(row)"',
    '@click.stop="openBomThicknessReview(activeBom)"',
    '<el-button :disabled="!thicknessReviewText" @click="copyThicknessReviewText">复制核对清单</el-button>',
    '@row-click="handleThicknessReviewLineAction"',
    ':row-class-name="thicknessReviewRowClassName"',
    'async function handleThicknessReviewLineAction(row: ModelBomLine)',
    "guardDesktopOperation('核对并保存 BOM 明细厚度')",
    'function lineThicknessReviewActionTitle(row: ModelBomLine)',
    'function thicknessReviewRowClassName({ row }: { row: ModelBomLine })',
    '!isMobileLayout.value && lineNeedsThicknessReview(row)',
    'bom-thickness-review-table__row',
    ':title="formatThicknessReviewBreakdown(row.lines || [])"',
    ':title="formatThicknessReviewBreakdown(activeBomDisplayLines)"',
    '@keydown.enter.prevent.stop="openBomThicknessReview(row)"',
    '@keydown.space.prevent.stop="openBomThicknessReview(activeBom)"',
    ':class="{ \'clickable-review-tag\': lineNeedsThicknessReview(row) && !isMobileLayout }"',
    ':role="lineNeedsThicknessReview(row) && !isMobileLayout ? \'button\' : undefined"',
    'lineThicknessReviewActionTitle(row)',
    '@click.stop="handleThicknessReviewLineAction(row)"',
    '@keydown.enter.prevent.stop="handleThicknessReviewLineAction(row)"',
    '@keydown.space.prevent.stop="handleThicknessReviewLineAction(row)"',
    'function lineCountsAsActiveBomContent(line: ModelBomLine)',
    "return line.status === 'ENABLED' && line.materialStatus !== 'DISABLED';",
    'const activeContentLines = lines.filter(lineCountsAsActiveBomContent);',
    "line.partThicknessSource !== 'BOM_LINE'",
    '历史订单厚度也必须人工保存到当前 BOM 后才算已核对',
    '当前值来自历史订单，只作为预填建议',
    '历史厚度 ${String(row.partThickness)}（需核对）',
    'lineFormOriginalPartThicknessSource',
    '普通编辑保存不会把未改动的历史厚度确认为 BOM 厚度',
    'function formatLineFormThicknessStatusText()',
    '历史订单参考厚度 ${lineForm.partThickness}，尚未保存到当前 BOM',
    '已手工改为 ${lineForm.partThickness}，保存后写入当前 BOM 明细',
    'function shouldSubmitLinePartThickness(lineThickness: number)',
    '历史订单厚度只做普通编辑的参考值',
    'shouldKeepHistoryThicknessPending',
    '历史厚度仍需核对，点击“厚度核对”后才会写入当前 BOM',
    'const payloadPartThickness = shouldSubmitPartThickness ? lineThickness : undefined;',
    '父级组件由子零件拼接不提交厚度',
    'function buildBomStructureGroups(lines: ModelBomLine[])',
    'function appendBomStructureTextGroups(lines: string[], groups: BomStructureGroup[])',
    'const effectiveGroups = buildBomStructureGroups(activeBomDisplayLines.value.filter(lineCountsAsActiveBomContent));',
    '有效明细（用于后续推荐）',
    '停用/基础零件停用明细（不参与后续推荐）',
    '固定格式清单把停用内容单独列出',
    'await openThicknessReviewLineEdit(lines[0]);',
    'function remainingThicknessReviewLinesForBom(bomId: string, ignoredLineId = \'\')',
    'function continueThicknessReviewAfterSave(bomId: string, savedLineId: string)',
    '当前明细厚度仍未确认，请填写厚度并通过“厚度核对”保存到当前 BOM 明细',
    '还有 1 条 BOM 厚度核对项，已打开下一条',
    '还有 ${remainingLines.length} 条 BOM 厚度核对项',
    'const savedFromThicknessReview = Boolean(lineForm.id && lineForm.id === thicknessReviewLineId.value);',
    'await continueThicknessReviewAfterSave(thicknessReviewBomIdBeforeSave, savedLine.id);',
    ':title="lineDialogTitle"',
    '核对 BOM 明细厚度',
    'thicknessReviewLineNotice',
    '正在核对 ${lineForm.materialKeyword || \'当前 BOM 明细\'} 的默认厚度',
    'await openLineEditDialog(row, { thicknessReview: true });',
    'thicknessReviewLineId.value = \'\';',
    '停用 {{ activeBomLineSummary.disabledCount }}',
    '基础零件停用 {{ activeBomLineSummary.materialDisabledCount }}',
    'row.materialStatus === \'DISABLED\'',
    'lineForm.materialStatus',
    'selectedMaterialKeyword',
    'clearable',
    'placeholder="编码 / 名称 / 拼音 / 图号 / 厚度 / 客户 / 订单"',
    ':trigger-on-focus="true"',
    ':debounce="250"',
    '@clear="handleLineMaterialClear"',
    '@input="handleLineMaterialKeywordInput"',
    'InventoryMaterialSuggestion',
    "import MaterialSuggestionOption from '../components/MaterialSuggestionOption.vue';",
    '<MaterialSuggestionOption :item="item" />',
    'erpApi.inventoryMaterialSuggestions(',
    'activeBom.value?.customerId || filters.customerId',
    'activeBom.value?.projectModel || filters.projectModel.trim()',
    'resolveSuggestionMaterialId',
    '该建议未匹配到启用的零件基础资料',
    'lineFormMaterialSelectionRisk',
    '请从搜索结果中选择零件，不能只输入关键词',
    '零件关键词已被修改，请重新从搜索结果中选择零件',
    'lineFormDuplicateLineRisk',
    '该零件已经存在于当前零件包的相同结构位置：${structureText}',
    'ElMessage.warning(lineFormDuplicateLineRisk.value)',
    'function clearLineMaterialSelection',
    'function handleLineMaterialKeywordInput',
    '避免显示新关键词但保存旧 materialId',
    ':disabled="lineFormEnableStatusDisabled"',
    '当前基础零件已停用，只能保存为停用 BOM 明细',
    '当前基础零件已停用，请先在零件管理中启用基础资料，或将 BOM 明细保存为停用',
    'lineFormParentComponent',
    'lineFormParentComponentNotice',
    'lineFormParentComponentRisk',
    'lineFormEnableStatusDisabled',
    'lineFormEnableStatusDisabledReason',
    'lineForm.status = \'DISABLED\'',
    '所属组件 ${parentComponentNo} 不存在，请先维护组件行',
    '所属组件 ${parentComponentNo} 已停用，请先启用组件行，或将子零件保存为停用',
    '所属组件 ${parentComponentNo} 已停用，当前子零件只能保存为停用；如需启用推荐，请先启用组件行',
    'ElMessage.warning(lineFormParentComponentRisk.value)',
    ':type="row.materialStatus === \'DISABLED\' ? \'info\' : \'success\'"',
    ':title="row.materialStatus === \'DISABLED\' ? \'请先启用零件基础资料\' : \'启用包内明细\'"',
    'bom-line-status-tags',
    '基础零件停用',
    '基础零件已停用，请先在零件管理中启用基础资料，再启用 BOM 明细',
    'placeholder="选择客户" status="ENABLED"',
    '@click="saveBom(true)"',
    'saveBom(addFirstLineAfterSave = false)',
    "routeTargetAction.value === 'createLine' && Boolean(routeTargetMaterialId.value)",
    'selectRouteCreateLineTargetBom',
    'isExactRouteCreateLineBom',
    'routeCreateLineNeedsNewScopedBom',
    'routeCreateLineNewBomMessage',
    '当前是客户范围，需先保存客户独立 BOM，避免把客户零件写入百胜通用 BOM',
    'if (shouldOpenFirstLineDialog)',
    "openLineCreateDialog(routeTargetMaterialId.value ? routeTargetLineStructure.value : 'COMPONENT', routeTargetParentComponentNo.value);",
    'currentCustomerBomForSource',
    'canCopyModelBomToCurrentCustomer',
    'openCurrentCustomerBom',
    'findExistingCustomerBomForCopy',
    'findExistingModelBomForScope',
    "erpApi.modelBoms({ customerId: customerId || undefined, projectModel, status: 'ALL' })",
    'guardDuplicateCustomerBomCopy',
    'guardExistingBomBeforeRouteCreateLine',
    'guardDuplicateBomScopeBeforeSave',
    'existing.id === currentBomId',
    '当前客户/机型范围已存在 BOM，已定位到现有 BOM，请直接维护现有零件包',
    '当前客户和机型已存在客户 BOM，已定位到现有 BOM，请继续维护，避免重复复制',
    '当前范围已有停用 BOM，已定位到现有 BOM；请先启用后再添加明细，避免重复新建',
    '当前范围已存在 BOM，已定位并继续添加当前零件明细',
    '当前 BOM 已停用，请先启用后再添加明细',
    '打开客户 BOM',
    'defaultLinePartCategory',
    "return '百胜通用件';",
    "return activeBom.value.projectModel ? '客户定制件' : '客户通用件';",
    'lineForm.partCategory = defaultLinePartCategory();',
    '新增零件包已保存，可继续添加包内明细',
    '机型零件包已保存并已定位到当前筛选',
    '机型零件包保存失败，请确认后端服务和客户数据',
    "客户零件包已复制生成${copyForm.isCommon ? '，并已设为常用' : ''}，可继续维护包内明细",
    '包内零件保存失败，请检查组件关系、默认数量和后端服务',
    '包内零件启用失败，请确认所属组件和零件基础资料状态',
    '机型零件包启用失败，请确认客户和机型范围没有冲突',
    'buildSourceBomDiffIssues',
    'sourceActiveLines',
    'targetActiveLines',
    'modelBomScopeSummaryTotals',
    'modelBomScopeSummary',
    'modelBomScopeSummaryVisible',
    'modelBomPagination',
    'handleModelBomPageChange',
    'searchModelBoms',
    'modelBomsPage',
    '个零件包',
    '机型零件包加载失败，请确认后端服务和筛选条件',
    'sourceBomDiffRequestSeq',
    'sourceBomDiffReviewRequestSeq',
    '避免快速切换时旧响应覆盖当前差异',
    'activeBom.value?.sourceBomId === sourceBomId',
    'activeBom.value?.id === bom.id',
    '来源 BOM 差异加载失败，请确认来源 BOM 和后端服务',
    'BOM 差异核对记录加载失败，请确认当前 BOM 和后端服务',
    '标准工序加载失败，BOM 行默认工艺暂不可选',
    '客户选项加载失败，请确认后端服务',
    'BOM 行图纸版本加载失败，请确认零件基础资料和后端服务',
    'BomCustomerScope',
    'originalBomCustomerScope',
    'originalBomScopeCustomerIds',
    'confirmedBomCustomerScope',
    'bomCustomerScopeChangeConfirmed',
    'bomScopeReviewDialogVisible',
    'BOM 适用范围核对',
    'bomScopeReviewRows',
    'bomScopeReviewAlertText',
    'openBomScopeChangeReviewDialog',
    'resolveBomScopeReview',
    'bomScopeChangeNeedsReview',
    'bomScopeChangeBroadens',
    'bomProjectScopeBroadens',
    'normalizedBomCustomerIds',
    'bomSelectedCustomerScopeAdds',
    'bomCustomerScopeExpansionNeedsConfirmation',
    'addedBomScopeCustomerNames',
    'removedBomScopeCustomerNames',
    'bomScopeVisibilityText',
    'bomScopeNarrowingText',
    '范围缩小',
    '不会删除 BOM 明细、历史订单、生产任务或库存记录',
    '只修改 BOM 后续可见范围和推荐范围',
    'bom-scope-help--warning',
    'bom-scope-review',
    'bomScopeCustomerSelectionText',
    'bomScopeSelectedCustomerCountText',
    'bomScopeCustomerKeyword',
    'customerOptionsLoading',
    'customerOptionsTotal',
    'bomScopeCustomerOptionLoadText',
    '客户选项已加载',
    'BOM 指定客户范围需要支持全选客户',
    "erpApi.customersPage(undefined, 'ENABLED', customerOptionBatchLimit, offset)",
    'bomScopeFilteredCustomerOptions',
    'bomScopeCustomerDisplayOptions',
    'customerSearchParts',
    'pinyinSearchMatches(customerSearchParts(customer), keyword)',
    ':filter-method="handleBomScopeCustomerSelectFilter"',
    'handleBomScopeCustomerSelectFilter',
    'selectFilteredBomScopeCustomers',
    'removeFilteredBomScopeCustomers',
    '勾选搜索结果',
    '移除搜索结果',
    'bomCustomerScopeBroadens',
    'scopeChangeConfirmed',
    '全部客户通用：任意客户下单时都可以看到该 BOM',
    '已勾选 ${bomForm.customerIds.length} / ${total} 个客户',
    'class="model-bom-scope-summary"',
    'class="model-bom-scope-guide"',
    'BOM 范围筛选或上方统计可直接区分通用 BOM、指定客户可用 BOM 和客户私有 BOM',
    'modelBomScopeGuideItems',
    '任意客户下单时都可见，只适合真正标准的百胜通用 BOM。',
    '只对勾选客户可见，可在编辑表头里单选、多选或一次性全选客户。',
    '只属于所属客户，不会显示在其他客户界面。',
    'applyModelBomScopeFilter',
    '统计基于当前关键字、客户、机型和状态，不受 BOM 范围和常用筛选影响。',
    'modelBomScopeSummaryTotals.value = result.scopeSummary',
    'erpApi.modelBomsPage(listFilters)',
    "line.status === 'ENABLED' && line.materialStatus !== 'DISABLED'",
    'normalizeComponentNo(line.parentComponentNo)',
    'childrenByParent.get(componentNo) || []',
    'normalizeComponentNo(line.componentNo));',
    'componentNo: normalizeComponentNo(row.componentNo) || undefined',
    'lineFormComponentNoRisk',
    '组件编号 ${componentNo} 已存在，请换一个编号',
    'ElMessage.warning(lineFormComponentNoRisk.value)',
    'lineFormExistingComponentChildLines',
    'lineFormExistingComponentEnabledChildLines',
    'formatComponentMutationChildSummary',
    'lineFormComponentMutationChildSummary',
    'lineFormComponentDisableChildSummary',
    'lineFormComponentMutationNotice',
    'confirmLineComponentMutation',
    '确认组件结构变更',
    '涉及子零件：${preview}${remainingCount}',
    '保存后这些子零件会改为单独零件',
    '仍指向 ${existingComponentNo} 的子零件会同步改挂到 ${nextComponentNo}',
    '其中 ${enabledChildCount} 个启用子零件会同步停用',
    '停用组件会同步停用仍挂靠的启用子零件',
    'seenComponentNos',
    ':value="normalizeComponentNo(item.componentNo)"',
    '当前零件包 C001-C9999 自动组件编号已用完',
    'isComponentNoOutOfRange',
    '组件编号只支持 C001-C9999',
    'Number(matched[1]) < 1 || Number(matched[1]) > 9999',
    '客户 BOM 缺少',
    '后续来源更新只提示差异，不自动覆盖客户 BOM',
    'erpApi.reorderModelBomLines(activeBom.value.id, { items })',
    'return activeBomLineDisplayOrderMap.value.get(row.id) ?? row.displayOrder ?? 0;',
    'formatLineOrderTitle(row)',
    'BOM 明细顺序 ${displayBomLineOrder(row) || \'-\'}',
    '顺序列显示连续编号 1、2、3；拖拽保存后仍按连续编号查看。',
    'grid-template-columns: minmax(0, 1fr)',
    'min-width: 2220px',
    'overflow-wrap: anywhere',
    'resize: vertical',
    'scrollbar-gutter: stable both-edges',
    'confirmSetBomCommon',
    '常用 BOM 只影响当前范围内的显示顺序和下单推荐优先级',
    'result.customerScopeCount',
    'result.diffReviewCount',
    '仅允许删除已停用、无包内明细、无适用客户、无差异核对记录且没有客户副本引用的无效空 BOM。',
    '有明细、客户范围、差异核对记录或客户副本引用时，后端会阻断物理删除，请改为停用。',
    'useDeviceProfile',
    'v-if="!isMobileLayout" type="primary" @click="openBomCreateDialog"',
    "v-if=\"row.status === 'ENABLED' && row.isCommon\"",
    'common-bom-sort-cell',
    '常用显示顺序 ${modelBomCommonDisplayOrder(row) || \'-\'}',
    'v-if="!isMobileLayout && row.status === \'ENABLED\' && !row.isCommon"',
    "modelBoms.value.filter((row) => row.status === 'ENABLED' && row.isCommon)",
    "row.status !== 'ENABLED'",
    '已停用 BOM 不能设为常用，请先恢复启用',
    ':draggable="!saving && !modelBomLineOperationSavingKey && !isMobileLayout"',
    'v-if="!isMobileLayout && selectedSourceBomDiffIssue',
    '手机端只读',
    '手机端仅查看机型零件包，${actionLabel}请在电脑端操作'
  ];
  for (const snippet of modelBomSnippets) {
    if (!modelBomSource.includes(snippet)) {
      addFailure(`ModelBomsView.vue must keep BOM component structure snippet: ${snippet}`);
    }
  }
  if (modelBomSource.includes('↕')) {
    addFailure('ModelBomsView.vue must use Rank icon buttons for drag handles instead of the text arrow character.');
  }
  if (modelBomSource.includes('ElMessageBox.confirm')) {
    addFailure('ModelBomsView.vue BOM key operations must use el-dialog instead of ElMessageBox.confirm.');
  }
  if (modelBomSource.includes("reviewedBy: '系统操作员'") || modelBomSource.includes("|| '系统操作员'")) {
    addFailure('ModelBomsView.vue BOM diff review must require an explicit reviewer instead of falling back to 系统操作员.');
  }
  if (modelBomSource.includes('<el-button link type="primary" @click="openThicknessReviewLineEdit(row)">填写厚度</el-button>')) {
    addFailure('ModelBomsView.vue thickness review should open by clicking the 厚度核对 tag, not by adding a separate 填写厚度 button.');
  }

  const modelBomDeleteSafetySnippets = [
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, "existing.status !== 'DISABLED'"],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '只有已停用的无效空 BOM 才能永久删除'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, 'BOM 行删除必须软停用以保留历史维护记录'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '该 BOM 仍有 ${existing.customerScopes.length} 个适用客户范围，只能停用，不能物理删除'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '该 BOM 仍有 ${diffReviewCount} 条差异核对记录，只能停用，不能物理删除'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, 'BOM 永久删除正在被其他业务写入，请刷新后重新删除'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '永久删除必须在事务内重新确认 BOM 仍为空'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '不能在永久删除时清理 BOM 行、适用范围或差异记录'],
    ['ModelBomsView.vue', modelBomSource, '已删除无效空 BOM'],
    ['MaterialsManagementView.vue', materialDashboardSource, '已删除无效空 BOM'],
    ['MaterialsManagementView.vue', materialDashboardSource, '误操作创建且没有明细、适用客户或差异记录的无效空 BOM 可永久删除']
  ];
  for (const [file, source, snippet] of modelBomDeleteSafetySnippets) {
    if (!source.includes(snippet)) {
      addFailure(`${file} must keep safe physical delete boundary for invalid empty BOM: ${snippet}`);
    }
  }
  const deleteModelBomBlock = inventoryServiceSource.match(/async deleteModelBom\(bomId: string\) \{[\s\S]*?\n  private handleModelBomScopeUniqueError/);
  if (!deleteModelBomBlock) {
    addFailure('InventoryService.deleteModelBom must keep a dedicated permanent-delete boundary.');
  } else {
    if (!deleteModelBomBlock[0].includes('return runSerializableTransaction(')) {
      addFailure('InventoryService.deleteModelBom must re-check empty BOM state inside a serializable transaction.');
    }
    for (const forbidden of ['modelBomLine.deleteMany', 'modelBomCustomerScope.deleteMany', 'modelBomDiffReview.deleteMany']) {
      if (deleteModelBomBlock[0].includes(forbidden)) {
        addFailure(`InventoryService.deleteModelBom must not physically clean BOM child history during permanent delete: ${forbidden}`);
      }
    }
  }

  const modelBomSeedSnippets = [
    'async function seedModelBoms()',
    'await prisma.modelBomDiffReview.deleteMany()',
    'await prisma.modelBomCustomerScope.deleteMany()',
    'await prisma.modelBomLine.deleteMany()',
    'await prisma.modelBom.deleteMany()',
    'B3 百胜通用零件包',
    '百胜全部机型通用零件包',
    '常州客户通用零件包',
    "projectModelScopeKey: 'ALL'",
    'B3 常州客户零件包',
    'B5 无锡客户零件包',
    'componentNo: \'C001\'',
    'parentComponentNo: \'C001\'',
    'BOM seed 只写基础资料和推荐清单，不生成订单、生产任务或库存流水',
    'await seedModelBoms();'
  ];
  for (const snippet of modelBomSeedSnippets) {
    if (!seedSource.includes(snippet)) {
      addFailure(`seed.ts must keep model BOM verification data snippet: ${snippet}`);
    }
  }

  const dashboardSnippets = [
    'dashboardTextDialogVisible',
    'dashboardFixedText',
    'openDashboardTextDialog',
    'copyDashboardText',
    'contextBomPanelVisible',
    'contextBomLoading',
    'contextBoms',
    'contextBomScopeText',
    'contextBomActiveCount',
    'contextBomVisibleRows',
    'contextBomCommonCount',
    'contextBomCommonOnly',
    'contextBomScopeFilter',
    'toggleContextBomCommonOnly',
    'toggleContextBomScopeFilter',
    'contextBomAllCustomerCount',
    'contextBomSelectedCustomerCount',
    'contextBomPrivateCount',
    'openContextBomMaintainByScope',
    '维护当前范围',
    '当前范围暂无匹配的常用 BOM',
    '全部客户通用 {{ contextBomAllCustomerCount }}',
    '指定客户可用 {{ contextBomSelectedCustomerCount }}',
    '客户私有 {{ contextBomPrivateCount }}',
    'scopeMode: contextBomScopeMode(bom)',
    'loadContextBoms',
    'erpApi.modelBoms({',
    'contextBomSummary',
    'contextBomPreviewLines',
    'compareContextBomLinesByStoredOrder',
    'normalizeContextBomComponentNo',
    'childrenByParent',
    'const orderedLines = contextBomActiveLines(bom);',
    '零件管理当前适用 BOM 预览顺序跟机型 BOM 页一致',
    'contextBomTotalCount',
    'contextBomStructureLabel',
    'context-bom-panel',
    'context-bom-grid',
    'openContextBomMaintain',
    'openContextBomCreate',
    'openContextCommonBomCreate',
    'pushContextBomCreate',
    ':disabled="Boolean(bomOperationSavingKey)" @click="openContextBomCreate"',
    ':disabled="Boolean(bomOperationSavingKey)" @click="openContextCommonBomCreate"',
    'openContextBomCopy',
    'contextCustomerBomForSource',
    'canCopyContextBomToCustomer',
    'openContextCustomerBomDetail',
    '已有客户 BOM',
    '当前客户和机型已存在客户 BOM，请打开客户 BOM 继续维护，避免重复复制',
    "status: 'ALL'",
    "status: bom.status === 'DISABLED' ? 'ALL' : 'ENABLED'",
    "action: shouldCreateLine ? 'createLine' : undefined",
    "lineStructure: shouldCreateLine ? 'STANDALONE_PART' : undefined",
    'targetProjectModel',
    'bomMaintainProjectOptions',
    'bomMaintainTargetProjectModel',
    'normalizeBomScopeText',
    'rowHasBomLineForCurrentScope',
    'projectOptions.length === 1 ? projectOptions[0] :',
    'Boolean(targetProjectModel) && !rowHasBomLineForCurrentScope(row)',
    'canCreateBomLineForCurrentScope',
    'bomMaintainActionLabel',
    'bomCurrentScopeEmptyText',
    '加入当前范围 BOM',
    '先选择机型/项目后加入 BOM',
    '当前客户/机型 BOM 未包含',
    '当前范围未进 BOM',
    '选择客户或机型后可加入 BOM',
    'dashboard-bom-empty',
    'materialRouteKeyword',
    'keyword: shouldCreateLine ? undefined : row.partCode',
    'materialId: shouldCreateLine ? row.id : undefined',
    "action: 'createBom'",
    "action: 'copyBom'",
    'contextBomCreateName',
    'contextBomCopyName',
    "const commonText = isCommon ? '常用' : '';",
    '客户${commonText}通用零件包',
    '百胜${commonText}通用零件包',
    '客户${commonText}零件包',
    "return projectModel ? `${projectModel} 客户零件包` : '客户通用零件包';",
    'openContextBomDetail',
    'openProjectBomMaintain',
    'disableProjectBom',
    'loadProjectBomsForAction',
    'exactProjectBomForCurrentScope',
    'disableContextBom',
    'deleteProjectBom',
    'deleteContextBom',
    'bomOperationSavingKey',
    'projectBomOperationKey',
    'contextBomOperationKey',
    ':loading="bomOperationSavingKey === projectBomOperationKey(item, \'delete\')"',
    ':loading="bomOperationSavingKey === contextBomOperationKey(bom, \'delete\')"',
    'BOM 停用失败，请确认后端服务和当前 BOM 状态',
    '后端会阻断仍有明细、适用客户、差异记录或客户副本引用的 BOM',
    'project-quick-item',
    '查看/编辑BOM',
    '停用BOM',
    '删除BOM',
    '查看/编辑会进入机型零件包页维护表头、明细和拖拽顺序',
    '误操作创建且没有明细、适用客户或差异记录的无效空 BOM 可永久删除',
    'result.customerScopeCount',
    'result.diffReviewCount',
    'erpApi.disableModelBom(bom.id)',
    'erpApi.deleteModelBom(bom.id)',
    '@selected-customer-change="handleSelectedCustomerChange"',
    'selectedCustomerName',
    'selectedCustomerFilterLabel',
    'materialProjectScopeValues(row)',
    '查看固定格式',
    '零件管理固定格式清单',
    'class="fixed-format-textarea"',
    'row.drawingSourceLabel',
    '零件最新图纸',
    'row.bomStructureLabel',
    'row.bomStructureLabels',
    'row.bomStructureDetails',
    'dashboardBomStructureSummary',
    'dashboardBomStructureDetailText',
    'dashboardBomStructureTagType',
    'openBomStructureDetail',
    'lineId: detail.lineId',
    "action: 'editLine'",
    'dashboard-bom-structure-list',
    'v-model="filters.drawingSource"',
    'v-model="filters.bomStructureType"',
    'v-model="filters.bomPresence"',
    'v-model="filters.recentOrderPresence"',
    'v-model="filters.sortBy"',
    'v-model="filters.sortOrder"',
    'drawingSourceSummaryItems',
    'bomStructureSummaryItems',
    'applyScopeTypeFilter',
    'applyBomPresenceFilter',
    'applyRecentOrderPresenceFilter',
    'handleBomPresenceChange',
    'handleLastOrderDateRangeChange',
    'applyDrawingSourceFilter',
    'applyBomStructureFilter',
    'activeFilterItems',
    'clearActiveFilter',
    'active-filter-bar',
    'active-filter-chip',
    '清除全部',
    'formatRangeText',
    'summary-filter-chip',
    'relation-boundary-alert',
    '订单历史不等于正式适用范围',
    '不会自动变成全部客户通用、客户私有 BOM 或正式适用范围',
    "drawingSource: filters.drawingSource || undefined",
    "bomStructureType: filters.bomStructureType || undefined",
    "bomPresence: filters.bomPresence || undefined",
    "recentOrderPresence: filters.recentOrderPresence || undefined",
    'sortBy: filters.sortBy',
    'sortOrder: filters.sortOrder',
    '零件控制面板加载失败，请确认后端服务',
    '机型 / 项目选项加载失败，请确认客户筛选和后端服务',
    '当前适用零件包加载失败，请确认客户、机型和后端服务',
    'drawingSourceFilterLabel',
    'bomStructureFilterLabel',
    'bomPresenceFilterLabel',
    'recentOrderPresenceFilterLabel',
    'dashboardSortByLabel',
    'dashboardSortOrderLabel',
    'BOM 结构',
    'BOM 状态',
    'withoutBomCount',
    '下单记录',
    'withoutRecentOrderCount',
    '排序字段',
    '来源：${row.drawingSourceLabel',
    '结构：${dashboardBomStructureSummary(row)}',
    'detail.structureLabel} @ ${detail.bomName}',
    "openMaterialMaintain(row, 'drawing')",
    "openMaterialMaintain(row, 'applicability')",
    'openMaterialDrawingMaintain(row)',
    'openMaterialApplicabilityMaintain(row)',
    'openBomMaintain(row)',
    'openSourceDetails(row)',
    'sourceDetailsRequestSeq',
    '库存来源查询失败，请确认零件和后端服务',
    'InventorySourceDetailsDialog',
    'useDeviceProfile',
    'guardDesktopOperation',
    '手机端仅查看零件管理信息，${actionLabel}请在电脑端操作',
    'mobile-readonly-note',
    '手机端只保留库存来源查看入口',
    '手机端只查看常用机型',
    '手机端只查看零件包',
    'mobile-pagination-bar',
    'dashboard.hasMore',
    'loadMobileNextPage',
    '继续加载',
    'commonProjectCandidate',
    'commonProjectSelectOptions',
    'addCommonProjectFromSelect',
    'removeCommonProject',
    'resetCommonProjectsToDefault',
    'project-quick-drag-handle',
    'startCommonProjectDrag',
    'handleCommonProjectDragOver',
    'dropCommonProject',
    'buildCommonProjectDragOrder',
    'aria-label="拖拽调整常用机型顺序"',
    '常用机型顺序已保存',
    '拖拽手柄调整顺序',
    'commonProjectSyncSource',
    'commonProjectSyncText',
    'commonProjectSyncTagType',
    'commonProjectSaving',
    'commonProjectBusy',
    ':disabled="commonProjectBusy"',
    'if (commonProjectBusy.value) {',
    ':close-on-click-modal="!saving"',
    ':close-on-press-escape="!saving"',
    ':before-close="handleMaterialDialogClose"',
    'closeMaterialDialog',
    'managementConfirmDialogVisible',
    'openManagementConfirmDialog',
    'handleManagementConfirmDialogClose',
    'class="management-confirm-panel"',
    '下单前维护零件搜索记忆、适用范围、机型 BOM 和最近历史用料；库存数量由 InventoryBatch 独立计算。',
    '这里只维护零件搜索记忆，方便后续下单搜索和 0 库存查看；编辑已有零件时状态请使用列表里的启用/停用动作，不会修改历史订单、库存批次、库存数量、BOM 明细或生产记录。',
    '仅搜索记忆',
    '编辑零件搜索记忆',
    '新增零件搜索记忆',
    '零件搜索记忆正在保存，请等待保存完成',
    '零件搜索记忆已保存',
    '零件搜索记忆已新增',
    '停用零件搜索记忆',
    '零件搜索记忆已停用',
    '零件搜索记忆已启用',
    'project-quick-state',
    '数据库已保存',
    '读取失败，显示默认值',
    '常用机型设置保存失败，未写入数据库',
    'refreshCommonProjects',
    '常用机型已从数据库刷新',
    'materialCommonProjectModels',
    'saveMaterialCommonProjectModels',
    'setContextBomCommon',
    'confirmSetContextBomCommon',
    "contextBomOperationKey(bom, 'common')",
    'enableProjectBom',
    'enableContextBom',
    "exactProjectBomForCurrentScope(rows, targetProjectModel, 'ANY')",
    '恢复启用',
    '是否设为常用需要单独人工设置',
    '不自动恢复常用排序',
    "bom.status === 'ENABLED' && !bom.isCommon",
    "v-if=\"bom.status === 'ENABLED' && bom.isCommon && !isMobileLayout\"",
    "contextBomVisibleRows.value.filter((bom) => bom.status === 'ENABLED' && bom.isCommon)",
    "bom.status !== 'ENABLED'",
    '已停用 BOM 不能设为常用，请先恢复启用',
    '客户零件包也可以设为常用；常用只影响当前范围的显示顺序和下单推荐优先级，不修改 BOM 明细、适用客户、订单、生产任务或库存。',
    '系统只会停用零件搜索记忆，不会删除历史订单、库存批次、库存数量或生产记录。',
    '当前适用零件包范围清单',
    'contextBomFixedText',
    '常用说明：常用 BOM 只影响同一客户/机型范围内的显示顺序和下单推荐优先级，不修改 BOM 明细、适用客户、订单、生产任务或库存。',
    '普通可用说明：非常用 BOM 仍可维护、复制和手动用于下单，只是不参与常用优先排序。',
    'contextBomCommonDisplayOrder(bom)',
    '常用 {{ contextBomCommonDisplayOrder(bom) }}',
    '常用显示顺序 ${contextBomCommonDisplayOrder(bom) || \'-\'}',
    'openContextBomTextDialog',
    'copyContextBomText',
    'contextBomCustomerText',
    '当前适用零件包范围清单已复制',
    'contextBomCommonDragRows',
    'contextBomCommonScopeKey',
    'contextBomCommonDragRowsForScope',
    'context-bom-common-drag-handle',
    'aria-label="拖拽调整常用 BOM 顺序"',
    '<el-icon><Rank /></el-icon>',
    'startContextBomDrag',
    'dropContextBom',
    'reorderModelBomCommon',
    '当前适用常用 BOM 顺序已保存',
    'scopeMode: contextBomScopeFilter.value || undefined',
    "commonOnly: contextBomCommonOnly.value ? 'true' : undefined",
    "isCommon: createAsCommon ? 'true' : undefined",
    'const createAsCommon = defaultCommon || contextBomCommonOnly.value',
    '新建常用零件包仍只维护 BOM 表头和明细',
    '设为常用',
    '取消常用',
    '搜索机型加入常用',
    'allow-create',
    '默认 B3/B5',
    'useRoute',
    'applyRouteQueryFilters',
    'routeStatusFilter',
    'route.query.customerId',
    'route.query.excludeGlobalAllProject',
    'customerContextExcludesGlobalAllProject',
    'excludeGlobalAllProject: Boolean(scopedCustomerId)',
    "openDesktopMaintenancePage('/inventory/materials'",
    "path: '/inventory/materials'",
    "path: '/inventory/model-boms'"
  ];
  for (const snippet of dashboardSnippets) {
    if (!materialDashboardSource.includes(snippet)) {
      addFailure(`MaterialsManagementView.vue must keep control panel quick action snippet: ${snippet}`);
    }
  }
  if (materialDashboardSource.includes('↕')) {
    addFailure('MaterialsManagementView.vue must use Rank icon buttons for drag handles instead of the text arrow character.');
  }
  if (materialDashboardSource.includes('ElMessageBox.confirm')) {
    addFailure('MaterialsManagementView.vue material and BOM key operations must use el-dialog instead of ElMessageBox.confirm.');
  }

  const materialProjectModelSnippets = [
    'scoreByProject',
    '客户常用机型按历史下单和 BOM/适用范围热度排序',
    "customerScopeMode: 'ALL'",
    "customerScopeMode: 'SELECTED', customerScopes: { some: { customerId, status: 'ENABLED' } }",
    'commonProjectModels',
    'saveCommonProjectModels',
    'materialCommonProjectModel',
    "label: '仅搜索记忆'",
    '仅存在于零件搜索记忆，尚未确认客户适用范围或 BOM，不代表库存可用。',
    'score.orderCount += 1',
    'latestOrderTime',
    'latestMasterTime',
    'return b.orderCount - a.orderCount'
  ];
  for (const snippet of materialProjectModelSnippets) {
    if (!materialsServiceSource.includes(snippet)) {
      addFailure(`materials.service.ts must keep customer project/model relevance sort snippet: ${snippet}`);
    }
  }
  const materialsServiceZeroFallbackSnippets = [
    'reservedQuantityByBatchId.get(batch.id) || 0',
    'a.sortOrder || 0',
    'b.sortOrder || 0',
    'line.sortOrder || 0',
    'left.sortOrder || 0',
    'right.sortOrder || 0',
    'drawingDate?.getTime() || 0'
  ];
  for (const snippet of materialsServiceZeroFallbackSnippets) {
    if (materialsServiceSource.includes(snippet)) {
      addFailure(`materials.service.ts must use ?? for inventory/dashboard numeric fallback so explicit 0 values remain stable: ${snippet}`);
    }
  }

  const materialDashboardStructureSnippets = [
    'dashboardDrawingSource',
    'dashboardDrawingSourceLabel',
    'BOM 指定图纸',
    '零件默认图纸',
    '零件最新图纸',
    '历史订单图纸',
    "return materialDrawing.isDefault ? 'MATERIAL_DEFAULT' : 'MATERIAL_LATEST';",
    'dashboardBomStructureType',
    'dashboardBomStructureLabel',
    'dashboardBomStructureDetails',
    'dashboardBomOrderedDisplayLines',
    'normalizeDashboardBomLineType',
    'normalizeDashboardBomComponentNo',
    "line.material?.status !== 'DISABLED'",
    "this.dashboardBomLineDisplayOrder(a) - this.dashboardBomLineDisplayOrder(b)",
    "lineType: true",
    "componentNo: true",
    "parentComponentNo: true",
    "material: {",
    'bomLinesMatchingContext',
    'lineId: line.id',
    'bomStructureTypes',
    'bomStructureLabels',
    'bomStructureDetails',
    'drawingSourceCounts',
    'bomStructureCounts',
    'withoutBomCount',
    'withoutRecentOrderCount',
    'dashboardCountMap',
    'compareDashboardRows',
    'compareDashboardDefault',
    'compareDashboardNullableTime',
    'compareDashboardText',
    'compareDashboardNumber',
    'rowMatchesDrawingSource',
    'rowMatchesBomStructure',
    'rowMatchesBomPresence',
    'rowMatchesRecentOrderPresence',
    'searchParts,',
    'pinyinSearchMatches(row.searchParts, keyword)',
    '零件管理关键字搜索必须逐字段匹配',
    '子零件 ->',
    'projectScopeEntries',
    'projectScopeMatchesCustomer',
    '项目筛选必须按当前客户识别“全部机型/项目”',
    'hasScopedDashboardContext',
    'displayHistoryRows',
    '只代表该客户曾使用，不会自动面向全部客户，也不等于正式适用范围或客户私有 BOM',
    'displayApplicabilities',
    'applicabilitiesMatchingContext',
    'customerScopedBomLines',
    'bomLineMatchesCustomerScope',
    'excludeGlobalAllProject',
    "line.bom.customerScopeMode === 'SELECTED'",
    'line.bom.customerScopes.some',
    'bomCustomerScopeIds',
    'bomLineHasGlobalCustomerScope',
    'searchParts = this.searchParts(material, displayHistoryRows, displayApplicabilities, displayBomLines)',
    'BOM 展示只看当前上下文',
    "line.bom.projectModelScopeKey === 'ALL'"
  ];
  for (const snippet of materialDashboardStructureSnippets) {
    if (!materialsServiceSource.includes(snippet)) {
      addFailure(`materials.service.ts must keep material dashboard drawing source and BOM structure snippet: ${snippet}`);
    }
  }

  const materialDashboardDtoSnippets = [
    "drawingSource?: 'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST' | 'ORDER_HISTORY' | 'NONE'",
    "bomStructureType?: 'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART' | 'NONE'",
    "bomPresence?: 'WITH_BOM' | 'WITHOUT_BOM'",
    "recentOrderPresence?: 'WITH_RECENT_ORDER' | 'WITHOUT_RECENT_ORDER'",
    "sortBy?: 'LAST_ORDER_DATE' | 'DRAWING_DATE' | 'BOM_STATUS' | 'PART_CODE' | 'UPDATED_AT'",
    "sortOrder?: 'ASC' | 'DESC'"
  ];
  const materialsDtoSource = readFile('backend/src/modules/materials/dto.ts');
  const frontendTypesSource = readFile('frontend/src/types/erp.ts');
  const frontendApiSourceForDashboard = readFile('frontend/src/api/erp.ts');
  for (const snippet of materialDashboardDtoSnippets) {
    if (!materialsDtoSource.includes(snippet) || !frontendApiSourceForDashboard.includes(snippet)) {
      addFailure(`Material dashboard filter DTO/API must keep snippet: ${snippet}`);
    }
  }
  if (!frontendTypesSource.includes("drawingSource?: 'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST' | 'ORDER_HISTORY' | null")) {
    addFailure('MaterialDashboardRow must keep drawingSource response field.');
  }
  if (!frontendTypesSource.includes('hasGlobalProjectScope?: boolean')) {
    addFailure('MaterialDashboardRow must expose global project scope for dashboard display.');
  }
  if (!frontendTypesSource.includes("drawingSource?: 'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST'")) {
    addFailure('ModelBomLine must distinguish BOM line, material default, and material latest drawing sources.');
  }
  if (!frontendTypesSource.includes("bomStructureType?: 'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART' | null")) {
    addFailure('MaterialDashboardRow must keep bomStructureType response field.');
  }
  if (!frontendTypesSource.includes("bomStructureTypes?: Array<'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART'>")) {
    addFailure('MaterialDashboardRow must keep bomStructureTypes response field.');
  }
  if (!frontendTypesSource.includes('bomStructureLabels?: string[]')) {
    addFailure('MaterialDashboardRow must keep bomStructureLabels response field.');
  }
  if (!frontendTypesSource.includes('export interface MaterialDashboardBomStructureDetail')) {
    addFailure('MaterialDashboardRow must keep BOM structure detail response type.');
  }
  if (!frontendTypesSource.includes('lineId: string')) {
    addFailure('MaterialDashboardBomStructureDetail must keep lineId for direct BOM line maintenance.');
  }
  if (!frontendTypesSource.includes('customerId?: string | null')) {
    addFailure('MaterialDashboardBomStructureDetail must keep customerId for exact customer BOM scope checks.');
  }
  if (!frontendTypesSource.includes('bomStructureDetails?: MaterialDashboardBomStructureDetail[]')) {
    addFailure('MaterialDashboardRow must keep bomStructureDetails response field.');
  }
  if (!materialsServiceSource.includes('customerId: line.bom.customerId')) {
    addFailure('materials.service.ts must include BOM customerId in dashboard BOM structure details.');
  }
  if (!frontendTypesSource.includes("drawingSourceCounts: Partial<Record<'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST' | 'ORDER_HISTORY' | 'NONE', number>>")) {
    addFailure('MaterialDashboardSummary must keep drawingSourceCounts summary field.');
  }
  if (!frontendTypesSource.includes("bomStructureCounts: Partial<Record<'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART' | 'NONE', number>>")) {
    addFailure('MaterialDashboardSummary must keep bomStructureCounts summary field.');
  }
  if (!frontendTypesSource.includes('withoutBomCount: number')) {
    addFailure('MaterialDashboardSummary must keep withoutBomCount summary field.');
  }
  if (!frontendTypesSource.includes('withoutRecentOrderCount: number')) {
    addFailure('MaterialDashboardSummary must keep withoutRecentOrderCount summary field.');
  }

  const materialLibraryRouteActionSnippets = [
    'const routeActionApplied = ref(false)',
    'applyRouteActionAfterLoad',
    "action !== 'drawing' && action !== 'applicability'",
    'openDrawingDialog(matchedMaterial)',
    'openApplicabilityDialog(matchedMaterial)',
    'materialPagination',
    'handleMaterialPageChange',
    '条零件基础资料',
    'erpApi.inventoryMaterialsPage',
    'guardDesktopOperation',
    '手机端仅查看零件基础资料，${actionLabel}请在电脑端操作',
    'useDeviceProfile',
    'mobile-readonly-note',
    '手机端只展示零件基础资料',
    "openDesktopMaintenancePage('/inventory/model-boms'",
    'materialOperationSavingId',
    ':loading="materialOperationSavingId === row.id"',
    'if (materialOperationSavingId.value) {',
    'applicabilityOperationSavingId',
    ':loading="applicabilityOperationSavingId === row.id"',
    'if (applicabilityOperationSavingId.value) {',
    'drawingOperationSavingId',
    ':loading="drawingOperationSavingId === row.id"',
    'if (drawingOperationSavingId.value) {',
    'materialImportBusy',
    'materialImportTemplateDownloading',
    ':loading="materialImportTemplateDownloading"',
    'downloadMaterialImportTemplate',
    '零件库导入模板已下载',
    'importRefreshing',
    'importDiscarding',
    'importDeletingFileId',
    ':close-on-click-modal="!saving"',
    ':close-on-press-escape="!saving"',
    ':before-close="handleMaterialDialogClose"',
    'closeMaterialDialog',
    ':before-close="handleApplicabilityDialogClose"',
    'applicabilitySaving.value',
    ':before-close="handleDrawingDialogClose"',
    'drawingSaving.value',
    '零件基础库加载失败，请确认后端服务和筛选条件',
    '零件适用范围加载失败，请确认后端服务和当前零件状态',
    '零件图纸版本加载失败，请确认后端服务和当前零件状态',
    '零件基础资料正在保存，请等待保存完成',
    '零件库导入会话创建失败，请确认后端服务和上传目录配置',
    '零件库导入预览刷新失败，请确认导入会话和后端服务',
    'importDialogVisible.value = false;',
    'materialImportSession.value = undefined;',
    'materialImportConfirmDialogVisible',
    'confirmMaterialImportAction',
    'materialImportCommitSummaryText',
    'materialStatusDialogVisible',
    'materialStatusAction',
    'confirmMaterialStatusChange',
    'class="material-confirm-panel"',
    '写入前仍以后端重新校验和当前 `previewToken` 为准。',
    '零件库文件上传失败',
    '导入文件已删除，预览已刷新',
    '零件库导入写入失败',
    '零件库导入可预览写入零件基础资料、适用范围和来源加工关系；必须人工确认，不会创建订单、库存或生产任务。',
    '维护下单可搜索的零件搜索记忆',
    '库存数量从 InventoryBatch 实时汇总；停用只影响后续搜索和推荐，不删除历史订单、库存批次、库存数量或生产记录。',
    '这里只维护 `Material` 搜索记忆。编辑已有零件时状态请使用列表里的启用/停用动作；保存不会改写历史订单、库存批次、BOM、默认图纸或来源加工关系。',
    '系统只会停用 `Material` 搜索记忆',
    '不会删除历史订单、库存批次、库存数量、生产记录或导入追溯。'
  ];
  for (const snippet of materialLibraryRouteActionSnippets) {
    if (!materialsViewSource.includes(snippet)) {
      addFailure(`MaterialsView.vue must keep control-panel route action snippet: ${snippet}`);
    }
  }
  if (materialsViewSource.includes('ElMessageBox.confirm')) {
    addFailure('MaterialsView.vue material library key operations must use el-dialog instead of ElMessageBox.confirm');
  }

  const materialTransformMobileSnippets = [
    '手机端仅查看来源加工关系',
    '手机端仅查看来源加工关系，${actionLabel}请在电脑端操作',
    'mobile-readonly-note',
    '手机端只保留库存查看入口',
    'useDeviceProfile',
    'v-if="!isMobileLayout"',
    ':loading="prefillLoading"',
    ':disabled="transformOperationBusy"',
    '@click="openCreateDialog"',
    'guardDesktopOperation',
    '新增、编辑、停用和启用来源加工关系请在电脑端操作'
  ];
  for (const snippet of materialTransformMobileSnippets) {
    if (!materialTransformsSource.includes(snippet)) {
      addFailure(`MaterialTransformsView.vue must keep mobile read-only guard snippet: ${snippet}`);
    }
  }

  const materialTransformProcessSnippets = [
    'defaultProcessRouteSteps',
    "import { Rank } from '@element-plus/icons-vue'",
    '<el-icon><Rank /></el-icon>',
    "erpApi.processDefinitions(undefined, 'ENABLED')",
    'handleDefaultProcessRouteChange',
    'startTransformProcessDrag',
    'dropTransformProcess',
    'reorderTransformProcessStep',
    'removeTransformProcessStep',
    'transform-process-drag-handle',
    '建议工艺只作为下单和库存来源核对的初始建议',
    '.split(/(?:->|→|[、,，;；\\n\\r]+)/)',
    "splitDefaultProcessRoute(row.defaultProcessRoute || '')",
    "defaultProcessRoute: form.defaultProcessRouteSteps.join('、') || undefined"
  ];
  for (const snippet of materialTransformProcessSnippets) {
    if (!materialTransformsSource.includes(snippet)) {
      addFailure(`MaterialTransformsView.vue must keep standard process selection for transform default route snippet: ${snippet}`);
    }
  }

  const materialTransformUsageSnippets = [
    '来源加工关系使用逻辑',
    '来源加工关系加载失败，请确认后端服务和筛选条件',
    '标准工序加载失败，来源加工关系默认工艺暂不可选',
    '提交生产时提示',
    '人工选择库存',
    '不自动影响库存',
    '不会生成订单、不会创建生产任务、不会扣减来源库存',
    '保存后仍不会自动扣库存或提交生产',
    'targetPartCode: filters.targetPartCode.trim() || undefined',
    'applyRouteFilters',
    'route.query.targetPartCode',
    'prefillTargetMaterialFromFilter',
    "erpApi.inventoryMaterials({ keyword: targetPartCode, status: 'ENABLED' })",
    'normalizeMaterialCode(item.partCode) === normalizeMaterialCode(targetPartCode)',
    'handleSourceMaterialKeywordInput',
    'handleTargetMaterialKeywordInput',
    'sourceMaterialSelectedLabel',
    'targetMaterialSelectedLabel',
    '必须清理旧 id',
    'watch(',
    'openTransformSourceDetails',
    'openTransformTargetDetails',
    'openTransformInventoryDetails',
    'sourceDetailsRequestSeq',
    '库存查询失败，请确认零件和后端服务',
    'ruleStatusDialogVisible',
    'ruleStatusTarget',
    'ruleStatusAction',
    'ruleStatusActionText',
    'ruleStatusDialogTitle',
    'class="transform-status-confirm"',
    'openRuleStatusDialog',
    'handleRuleStatusDialogClose',
    'closeRuleStatusDialog',
    'confirmRuleStatusChange',
    '来源加工关系状态正在保存，请等待操作完成',
    '本操作不会自动扣减来源库存、提交生产或生成订单。',
    'operationSavingId',
    'transformOperationBusy',
    ':disabled="transformOperationBusy"',
    'if (transformOperationBusy.value) {',
    ':close-on-click-modal="!saving"',
    ':close-on-press-escape="!saving"',
    ':before-close="handleRuleDialogClose"',
    'closeRuleDialog',
    '来源加工关系正在保存，请等待保存完成',
    ':disabled="sourceDetailsLoading"',
    'operationSavingId.value === row.id',
    ':loading="operationSavingId === row.id"',
    '来源加工关系停用失败',
    '来源加工关系启用失败',
    '停用只关闭后续建议入口',
    '启用后只恢复建议展示',
    '不删除关系记录，也不改订单、生产任务、库存批次或库存流水',
    '是否使用库存仍必须在库存来源核对中人工确认',
    'transform-dialog-hint',
    '这里只保存来源加工建议，用于后续订单选料和库存来源核对提示。',
    '保存、启用或停用关系都不会生成订单、不会创建生产任务、不会扣减来源库存。',
    '建议工艺只作为初始建议；订单保存后每个订单零件仍会保留自己的流程快照。',
    '是否使用目标库存、来源库存再加工或重新生产，仍由提交生产时人工核对确认。',
    '来源库存',
    '目标库存',
    '库存概况',
    '库存判断',
    '查看固定格式',
    '复制当前结果',
    'transformRulesFixedText',
    '业务边界：只作为下单和库存来源核对建议；不会自动扣库存、不会自动提交生产、不会自动生成订单或生产任务。',
    '当前筛选：${filterText}',
    '库存判断汇总：先核对目标库存 ${decisionSummary.targetStock}；可核对来源再加工 ${decisionSummary.sourceRework}；暂无库存需生产 ${decisionSummary.noStock}',
    'transformRulesTextDialogVisible',
    'openTransformRulesTextDialog',
    '暂无可查看的来源加工关系清单',
    'class="fixed-format-textarea"',
    'copyTransformRulesText',
    '来源加工关系固定格式清单已复制',
    '来源加工关系当前结果库存判断汇总',
    'transformDecisionSummary',
    'transformCustomerFilterLabel',
    'transformCustomerFilterLabel.value',
    'setInventoryDecisionFilter',
    '暂无库存需生产',
    'transformInventoryDecision',
    'transformInventoryDecisionReason',
    '判断依据',
    '目标零件有 ${formatQuantity(targetQuantity, row.targetUnit)} 可用库存',
    '目标零件暂无可用库存，来源零件有 ${formatQuantity(sourceQuantity, row.sourceUnit)} 可用库存',
    '来源零件和目标零件都暂无可用库存，提交生产时仍需人工确认重新生产。',
    '先核对目标库存',
    '可核对来源再加工',
    '暂无库存，考虑生产',
    '来源库存',
    '目标库存',
    '有可用库存',
    'sourceStockStatus',
    'targetStockStatus',
    'inventoryDecision',
    '<el-option label="全部" value="ALL" />',
    "status: CommonStatus | 'ALL'",
    'sourceAvailableQuantity',
    'sourceAvailableBatchCount',
    'InventorySourceDetailsDialog',
    "erpApi.inventoryMaterialSourceDetails(partCode"
  ];
  for (const snippet of materialTransformUsageSnippets) {
    if (!materialTransformsSource.includes(snippet)) {
      addFailure(`MaterialTransformsView.vue must keep source-transform usage boundary snippet: ${snippet}`);
    }
  }
  if (materialTransformsSource.includes('ElMessageBox.confirm')) {
    addFailure('MaterialTransformsView.vue source-transform status changes must use el-dialog instead of ElMessageBox.confirm');
  }

  const materialMemoryRestoreSnippets = [
    ['MaterialsView.vue', materialsViewSource, 'erpApi.restoreInventoryMaterial(row.id)'],
    ['MaterialsView.vue', materialsViewSource, '恢复零件搜索记忆只恢复 Material 后续可选状态，不自动恢复适用范围、BOM 行、默认图纸或来源加工关系'],
    ['MaterialsView.vue', materialsViewSource, '<el-select v-model="form.status" :disabled="Boolean(editingMaterialId)"'],
    ['MaterialsView.vue', materialsViewSource, '编辑已有零件时状态请使用列表里的启用/停用动作'],
    ['MaterialsView.vue', materialsViewSource, 'await erpApi.createInventoryMaterial({ ...payload, status: form.status })'],
    ['MaterialsManagementView.vue', materialDashboardSource, 'erpApi.restoreInventoryMaterial(row.id)'],
    ['MaterialsManagementView.vue', materialDashboardSource, '恢复零件搜索记忆只恢复 Material 后续可选状态；适用范围、BOM 行和来源加工关系需单独人工恢复'],
    ['MaterialsManagementView.vue', materialDashboardSource, '<el-select v-model="form.status" :disabled="Boolean(editingMaterialId)"'],
    ['MaterialsManagementView.vue', materialDashboardSource, '编辑已有零件时状态请使用列表里的启用/停用动作'],
    ['MaterialsManagementView.vue', materialDashboardSource, 'await erpApi.createInventoryMaterial({ ...payload, status: form.status })'],
    ['InventoryView.vue', inventorySource, 'erpApi.restoreInventoryMaterial(target.id)'],
    ['InventoryView.vue', inventorySource, '恢复搜索记忆只恢复后续可选状态，不自动恢复已停用的适用范围、BOM、默认图纸或来源加工关系'],
    ['InventoryView.vue', inventorySource, '<el-select v-model="materialMemoryForm.status" disabled'],
    ['InventoryView.vue', inventorySource, '状态请使用表格右侧的启用/停用动作，避免编辑保存时绕过专用状态流程。'],
    ['frontend/src/api/erp.ts', frontendApiSource, 'export interface UpdateMaterialMemoryPayload {'],
    ['frontend/src/api/erp.ts', frontendApiSource, 'updateInventoryMaterial(materialId: string, payload: UpdateMaterialMemoryPayload)'],
    ['frontend/src/api/erp.ts', frontendApiSource, 'restoreInventoryMaterial(materialId: string)'],
    ['frontend/src/api/erp.ts', frontendApiSource, "`/inventory/materials/${materialId}/restore`"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, "@Patch('materials/:materialId/restore')"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, 'return this.inventoryService.restoreMaterial(materialId);'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, 'async restoreMaterial(materialId: string)'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, 'dto.status !== undefined && dto.status !== existing.status'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '零件基础资料状态变更必须走 disableMaterial / restoreMaterial'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '零件基础资料状态请使用专用启用/停用接口'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '恢复零件搜索记忆只恢复 Material 后续可选状态，不自动恢复适用范围、BOM 行、默认图纸或来源加工关系']
  ];
  for (const [file, source, snippet] of materialMemoryRestoreSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`${file} must keep dedicated material memory restore contract snippet: ${snippet}`);
    }
  }
  const updateMaterialMemoryPayloadMatch = frontendApiSource.match(/export interface UpdateMaterialMemoryPayload\s*{([\s\S]*?)}/);
  if (!updateMaterialMemoryPayloadMatch || updateMaterialMemoryPayloadMatch[1].includes('status?:')) {
    addFailure('frontend/src/api/erp.ts UpdateMaterialMemoryPayload must not include status; material memory status changes must use dedicated restore/disable APIs');
  }

  const materialScopeAndDrawingRestoreSnippets = [
    ['MaterialsView.vue', materialsViewSource, 'materialMaintenanceStatusDialogVisible'],
    ['MaterialsView.vue', materialsViewSource, 'activeMaterialMaintenanceStatusTarget'],
    ['MaterialsView.vue', materialsViewSource, 'confirmMaterialMaintenanceStatusChange'],
    ['MaterialsView.vue', materialsViewSource, 'erpApi.restoreMaterialApplicability(target.id)'],
    ['MaterialsView.vue', materialsViewSource, '恢复适用范围只恢复推荐入口，不重写原客户范围、机型范围或备注'],
    ['MaterialsView.vue', materialsViewSource, '<el-select v-model="applicabilityForm.status" :disabled="Boolean(applicabilityForm.id)"'],
    ['MaterialsView.vue', materialsViewSource, 'await erpApi.saveMaterialApplicability(activeMaterial.value.id, { ...payload, status: applicabilityForm.status })'],
    ['MaterialsView.vue', materialsViewSource, 'erpApi.restoreMaterialDrawingRevision(target.id)'],
    ['MaterialsView.vue', materialsViewSource, '恢复图纸版本只恢复可选状态，不自动设为默认，也不覆盖历史订单图纸快照'],
    ['MaterialsView.vue', materialsViewSource, 'defaultDrawingDialogVisible'],
    ['MaterialsView.vue', materialsViewSource, '默认变更人'],
    ['MaterialsView.vue', materialsViewSource, 'confirmDefaultDrawingRevision'],
    ['MaterialsView.vue', materialsViewSource, '设置默认图纸必须填写操作人员'],
    ['MaterialsView.vue', materialsViewSource, '<el-select v-model="drawingForm.status" :disabled="Boolean(drawingForm.id)"'],
    ['MaterialsView.vue', materialsViewSource, 'await erpApi.saveMaterialDrawingRevision(activeMaterial.value.id, { ...payload, status: drawingForm.status })'],
    ['frontend/src/api/erp.ts', frontendApiSource, 'restoreMaterialApplicability(applicabilityId: string)'],
    ['frontend/src/api/erp.ts', frontendApiSource, "export type UpdateMaterialApplicabilityPayload = Omit<SaveMaterialApplicabilityPayload, 'status'>"],
    ['frontend/src/api/erp.ts', frontendApiSource, 'updateMaterialApplicability(applicabilityId: string, payload: UpdateMaterialApplicabilityPayload)'],
    ['frontend/src/api/erp.ts', frontendApiSource, "`/inventory/material-applicabilities/${applicabilityId}/restore`"],
    ['frontend/src/api/erp.ts', frontendApiSource, 'restoreMaterialDrawingRevision(revisionId: string)'],
    ['frontend/src/api/erp.ts', frontendApiSource, "export type UpdateMaterialDrawingRevisionPayload = Omit<SaveMaterialDrawingRevisionPayload, 'status'>"],
    ['frontend/src/api/erp.ts', frontendApiSource, 'updateMaterialDrawingRevision(revisionId: string, payload: UpdateMaterialDrawingRevisionPayload)'],
    ['MaterialsView.vue', materialsViewSource, 'type UpdateMaterialDrawingRevisionPayload'],
    ['MaterialsView.vue', materialsViewSource, 'function drawingRevisionPayload(overrides: Partial<UpdateMaterialDrawingRevisionPayload> = {}): UpdateMaterialDrawingRevisionPayload'],
    ['frontend/src/api/erp.ts', frontendApiSource, "`/inventory/material-drawing-revisions/${revisionId}/restore`"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, "@Patch('material-applicabilities/:applicabilityId/restore')"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, 'return this.inventoryService.restoreMaterialApplicability(applicabilityId);'],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, "@Patch('material-drawing-revisions/:revisionId/restore')"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, 'return this.inventoryService.restoreMaterialDrawingRevision(revisionId);'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, 'async restoreMaterialApplicability(applicabilityId: string)'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '零件适用范围状态变更必须走 disableMaterialApplicability / restoreMaterialApplicability'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '零件适用范围状态请使用专用启用/停用接口'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '恢复适用范围只恢复后续推荐入口，不重写客户范围、机型范围，也不生成订单、库存或生产任务'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '恢复适用范围前，所属零件基础资料必须是启用状态'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, 'async restoreMaterialDrawingRevision(revisionId: string)'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, 'requireDefaultDrawingChangedBy'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '设置默认图纸必须填写操作人员'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '图纸版本状态变更必须走 disableMaterialDrawingRevision / restoreMaterialDrawingRevision'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '图纸版本状态请使用专用启用/停用接口'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '恢复图纸版本只恢复后续可选状态，不自动设为默认图纸，也不覆盖历史订单图纸快照'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '恢复图纸版本前，所属零件基础资料必须是启用状态']
  ];
  for (const [file, source, snippet] of materialScopeAndDrawingRestoreSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`${file} must keep dedicated material scope/drawing restore contract snippet: ${snippet}`);
    }
  }
  if (materialsViewSource.includes("defaultChangedBy: '系统操作员'") || inventoryServiceSource.includes("|| '系统操作员'")) {
    addFailure('Default drawing changes must record an explicit operator instead of silently falling back to 系统操作员.');
  }
  const materialDrawingDatabaseSnippets = [
    'MaterialDrawingRevision_enabled_default_unique',
    'ON "MaterialDrawingRevision"("materialId")',
    `WHERE "isDefault" = true AND "status" = 'ENABLED'`,
    'MaterialDrawingRevision_materialId_drawingNo_drawingVersion_lower_key',
    'LOWER("drawingNo")',
    'LOWER("drawingVersion")',
    'MaterialDrawingRevision_identity_not_blank',
    'MaterialDrawingRevision_disabled_not_default',
    'MaterialDrawingRevision_default_operator_required',
    'BTRIM("defaultChangedBy")'
  ];
  for (const snippet of materialDrawingDatabaseSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`MaterialDrawingRevision default drawing database contract must keep migration snippet: ${snippet}`);
    }
  }

  const materialTransformRestoreSnippets = [
    ['MaterialTransformsView.vue', materialTransformsSource, 'erpApi.restoreMaterialTransformRule(row.id)'],
    ['MaterialTransformsView.vue', materialTransformsSource, '恢复启用只恢复建议展示，不重写原来的客户范围、机型范围、倍率、损耗和工艺建议'],
    ['MaterialTransformsView.vue', materialTransformsSource, '<el-select v-model="form.status" :disabled="Boolean(form.id)"'],
    ['MaterialTransformsView.vue', materialTransformsSource, '...(form.id ? {} : { status: form.status })'],
    ['MaterialTransformsView.vue', materialTransformsSource, 'const updatePayload: UpdateMaterialTransformRulePayload = {'],
    ['MaterialTransformsView.vue', materialTransformsSource, '来源加工关系状态必须走 restoreMaterialTransformRule / disableMaterialTransformRule，普通编辑不携带 status。'],
    ['frontend/src/api/erp.ts', frontendApiSource, 'restoreMaterialTransformRule(ruleId: string)'],
    ['frontend/src/api/erp.ts', frontendApiSource, "export type UpdateMaterialTransformRulePayload = Omit<SaveMaterialTransformRulePayload, 'status'>"],
    ['frontend/src/api/erp.ts', frontendApiSource, 'updateMaterialTransformRule(ruleId: string, payload: UpdateMaterialTransformRulePayload)'],
    ['frontend/src/api/erp.ts', frontendApiSource, "`/inventory/material-transform-rules/${ruleId}/restore`"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, "@Patch('material-transform-rules/:ruleId/restore')"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, 'return this.inventoryService.restoreMaterialTransformRule(ruleId);'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, 'async restoreMaterialTransformRule(ruleId: string)'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '来源加工关系状态变更必须走 disableMaterialTransformRule / restoreMaterialTransformRule'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '来源加工关系状态请使用专用启用/停用接口'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '恢复启用只恢复后续建议展示，不重写客户范围、机型范围、工艺建议，也不改订单、生产任务或库存'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, '恢复来源加工关系前，来源零件和目标零件都必须是启用状态']
  ];
  for (const [file, source, snippet] of materialTransformRestoreSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`${file} must keep dedicated source-transform restore contract snippet: ${snippet}`);
    }
  }

  const materialTransformPaginationSnippets = [
    ['MaterialTransformsView.vue', materialTransformsSource, 'rulePagination'],
    ['MaterialTransformsView.vue', materialTransformsSource, 'handleRulePageChange'],
    ['MaterialTransformsView.vue', materialTransformsSource, 'searchRules'],
    ['MaterialTransformsView.vue', materialTransformsSource, '条来源加工关系'],
    ['MaterialTransformsView.vue', materialTransformsSource, 'erpApi.materialTransformRulesPage'],
    ['frontend/src/api/erp.ts', frontendApiSource, 'materialTransformRulesPage(filters: MaterialTransformRuleFilters = {})'],
    ['frontend/src/api/erp.ts', frontendApiSource, "withPage: 'true'"],
    ['frontend/src/types/erp.ts', frontendTypesSource, 'export interface MaterialTransformRuleListResponse'],
    ['backend/src/modules/inventory/dto.ts', inventoryDtoSource, 'withPage?: string'],
    ['backend/src/modules/inventory/dto.ts', inventoryDtoSource, 'limit?: number'],
    ['backend/src/modules/inventory/dto.ts', inventoryDtoSource, 'offset?: number'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, "const withPage = query.withPage === 'true'"],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, 'const totalCount = serialized.length'],
    ['backend/src/modules/inventory/inventory.service.ts', inventoryServiceSource, 'hasMore: offset + items.length < totalCount']
  ];
  for (const [file, source, snippet] of materialTransformPaginationSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`${file} must keep paginated source-transform rule loading snippet: ${snippet}`);
    }
  }
  if (materialTransformsSource.includes('form.multiplier = row.multiplier || 1')) {
    addFailure('MaterialTransformsView.vue must preserve an invalid persisted multiplier while editing so validation can block it instead of silently replacing it with 1.');
  }
  if (!materialTransformsSource.includes('form.multiplier = row.multiplier ?? 1')) {
    addFailure('MaterialTransformsView.vue must only default missing transform multiplier values with ?? 1.');
  }

  const fixedFormatStructureFiles = [
    ['OrdersListView.vue', ordersListSource],
    ['OrderDetailView.vue', orderDetailSource],
    ['ProcessSelectionView.vue', processSelectionSource]
  ];
  for (const [label, source] of fixedFormatStructureFiles) {
    const snippets = ['component', 'standalone', 'orphan', '复制清单', '未匹配父级', '单独零件'];
    for (const snippet of snippets) {
      if (!source.includes(snippet)) {
        addFailure(`${label} must keep fixed-format component structure snippet: ${snippet}`);
      }
    }
  }
  const orderDetailFixedFormatSnippets = [
    'orderStructureTextDialogVisible',
    'openOrderStructureTextDialog',
    '订单固定格式清单',
    'class="order-structure-textarea"',
    'orderStructureText',
    '`结构 ${orderLineStructureLabel(line)}`',
    '`父级 ${orderLineStructureHint(line)}`',
    '`项目 ${line.projectModel || \'-\'}`',
    '`厚度 ${formatOrderLineThickness(line)}`',
    '`履约 ${fulfillmentModeLabel(line.fulfillmentMode)}`',
    '组件不适用',
    '父级组件由子零件分别维护厚度',
    '不适用（父级组件由子零件维护）',
    '序号 | 结构 | 父级 | 编码 | 名称 | 类型 | 项目 | 厚度 | 规格 | 订单 | 计划 | 交期 | 图纸 | 工艺 | 履约'
  ];
  for (const snippet of orderDetailFixedFormatSnippets) {
    if (!orderDetailSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must keep fixed-format order detail dialog snippet: ${snippet}`);
    }
  }
  const processSelectionFixedFormatSnippets = [
    'processStructureTextDialogVisible',
    'openProcessStructureTextDialog',
    '流程固定格式清单',
    'class="process-structure-textarea"',
    'processComponentNoSet',
    'isProcessLineMissingParentComponent',
    'processLineStructureLabel',
    'processLineStructureHint',
    'processLineStructureTagType',
    'formatProcessStructureTextLine',
    '`结构 ${processLineStructureLabel(line)}`',
    '`父级 ${processLineStructureHint(line)}`',
    '`项目 ${line.projectModel || \'-\'}`',
    '`厚度 ${formatProcessLineThickness(line)}`',
    '不适用（父级组件由子零件维护）',
    '序号 | 结构 | 父级 | 编码 | 名称 | 类型 | 项目 | 厚度 | 规格 | 订单 | 计划 | 交期 | 图纸 | 履约 | 流程',
    '未匹配父级',
    '所属组件不存在'
  ];
  for (const snippet of processSelectionFixedFormatSnippets) {
    if (!processSelectionSource.includes(snippet)) {
      addFailure(`ProcessSelectionView.vue must keep fixed-format process structure dialog snippet: ${snippet}`);
    }
  }

  const orderBomRecommendationSnippets = [
    '零件包推荐',
    'modelBomRecommendationVisible',
    'loadModelBomRecommendations',
    'modelBomStructureGroups',
    'createLineFromModelBomLine',
    'buildBomComponentNoMap',
    'nextAvailableOrderComponentNo',
    'orderImportableModelBomLines',
    'modelBomProjectScopeText',
    'modelBomImportProjectModel',
    '全部机型/项目（带入 ${importProjectModel}）',
    'targetProjectModel = modelBomImportProjectModel(bom)',
    'line.projectModel = targetProjectModel',
    "line.partThickness = bomLine.lineType === 'COMPONENT' ? 0 : materialThickness > 0 ? materialThickness : 0",
    'orderLineNeedsThicknessReview',
    'isModelBomLineMissingThickness',
    'missingThicknessText',
    '厚度需核对',
    '厚度 ${thicknessText}',
    'lineStructureLabel',
    'lineStructureHint',
    'lineStructureTagType',
    '子零件 ->',
    '单独零件',
    'import-line-structure-cell',
    'childrenByParent.get(normalizeComponentNo(line.componentNo))',
    'let componentNoMap: Map<string, string>;',
    'error instanceof Error ? error.message',
    'componentNoMap.get(sourceParentComponentNo)',
    'MATERIAL_LATEST',
    '零件最新',
    '组件编号已避让当前草稿',
    '父组件缺失或组件编号无效的 BOM 行',
    'openModelBomApplyDialog',
    'modelBomApplyDialogVisible',
    'modelBomApplyRefreshLoading',
    'modelBomApplySourceOpened',
    'modelBomApplyRefreshReminderShown',
    'modelBomApplyQuantityMultiplier',
    'modelBomApplyPreviewOrderLines',
    'modelBomApplyMissingThicknessLines',
    'modelBomApplyMissingThicknessSourceLines',
    'modelBomApplySourceBomActionText',
    'modelBomApplyRequiresRefresh',
    "line.lineType === 'COMPONENT' ? '不适用（父级组件由子零件维护）'",
    'buildModelBomApplyPreview',
    'refreshModelBomApplyPreview',
    '刷新 BOM 预览',
    'await erpApi.modelBom(preview.bom.id)',
    'BOM 预览已刷新，厚度需核对已清除',
    'handleModelBomApplyWindowFocus',
    "window.addEventListener('focus', handleModelBomApplyWindowFocus)",
    "window.removeEventListener('focus', handleModelBomApplyWindowFocus)",
    '如果已在 BOM 维护页补齐厚度，请点击“刷新 BOM 预览”读取最新 BOM。',
    '刷新前不会把旧预览带入草稿',
    'modelBomApplyPreviewOrderLines.length === 0 || modelBomApplyRequiresRefresh',
    '需核对厚度明细',
    '打开 BOM 维护补厚度',
    'openModelBomApplySourceBom',
    "path: '/inventory/model-boms'",
    "query.action = 'editLine'",
    'const routeTarget = router.resolve',
    "window.open(routeTarget.href, '_blank')",
    'openedWindow.opener = null',
    '避免丢失当前未保存的订单草稿',
    '浏览器阻止了新标签页',
    'formatModelBomApplyMissingThicknessLine',
    'confirmApplyModelBomToOrder',
    '零件包推荐只写入当前未保存的草稿明细',
    '确认带入草稿',
    'BOM 默认工艺只作为下单初始建议',
    '已带入 ${importedLines.length} 行零件包明细',
    '只带入当前草稿明细，不提交生产、不占库存。'
  ];
  for (const snippet of orderBomRecommendationSnippets) {
    if (!ordersListSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must keep order BOM recommendation snippet: ${snippet}`);
    }
  }

  const componentTraceFiles = [
    ['ProductionView.vue', productionSource, 'productionComponentText'],
    ['WarehouseView.vue', warehouseSource, 'warehouseComponentText'],
    ['InventoryView.vue', inventorySource, 'inventoryComponentText'],
    ['InventorySourceDetailsDialog.vue', inventorySourceDialogSource, 'sourceComponentText']
  ];
  for (const [label, source, functionName] of componentTraceFiles) {
    const snippets = [functionName, '子零件 ->', '单独零件'];
    for (const snippet of snippets) {
      if (!source.includes(snippet)) {
        addFailure(`${label} must keep component traceability display snippet: ${snippet}`);
      }
    }
  }

  const componentThicknessDisplayFiles = [
    ['ProductionView.vue', productionSource, 'formatProductionTaskThickness'],
    ['WarehouseView.vue', warehouseSource, 'partThicknessText'],
    ['InventorySourceDetailsDialog.vue', inventorySourceDialogSource, 'expectedThicknessText']
  ];
  for (const [label, source, functionName] of componentThicknessDisplayFiles) {
    const snippets = [functionName, "return '不适用（父级组件由子零件维护）';"];
    for (const snippet of snippets) {
      if (!source.includes(snippet)) {
        addFailure(`${label} must explain COMPONENT thickness as maintained by child parts: ${snippet}`);
      }
    }
  }

  const orderFormComponentSnippets = [
    'clearParentComponentNoAfterRemovingLine',
    'const [removedLine] = orderForm.lines.splice(index, 1);',
    'clearParentComponentNoAfterRemovingLine(removedLine);',
    'normalizeComponentNo(line.parentComponentNo) === removedComponentNo',
    'validateOrderFormComponentStructure',
    'componentStructureMessage',
    'isComponentNoOutOfRange',
    'componentNos.has(componentNo)',
    '!componentNos.has(parentComponentNo)',
    'structureTextDialogVisible',
    'openStructureTextDialog',
    'openOrderFormStructureTextDialog',
    'openImportOrderStructureTextDialog',
    'openImportFileStructureTextDialog',
    'copyStructureTextDialogContent',
    'class="structure-textarea"',
    'structure-header-actions',
    '查看固定格式',
    'groupStructureLabel',
    'groupStructureHint',
    'groupStructureTagType',
    'LineStructureTagType = \'success\' | \'warning\' | \'info\' | \'danger\'',
    ':type="groupStructureTagType(group.type, group.line)"',
    ':type="groupStructureTagType(\'standalone\', child)"',
    'formatOrderFormStructureTextLine',
    'formatImportStructureTextLine',
    '`结构 ${groupStructureLabel(type, line)}`',
    '`父级 ${groupStructureHint(type, line)}`',
    '`项目 ${line.projectModel || \'-\'}`',
    '`厚度 ${formatStructureLineThickness(line)}`',
    '不适用（父级组件由子零件维护）',
    '序号 | 结构 | 父级 | 编码 | 名称 | 类型 | 项目 | 厚度 | 规格 | 订单 | 计划 | 交期 | 图纸 | 工艺',
    '序号 | 结构 | 父级 | 编码 | 名称 | 类型 | 项目 | 厚度 | 规格 | 需求 | 订单 | 单套 | 图纸 | 工艺'
  ];
  for (const snippet of orderFormComponentSnippets) {
    if (!ordersListSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must keep component parent cleanup after deleting a component row snippet: ${snippet}`);
    }
  }

  const orderDetailComponentSnippets = [
    'clearParentComponentNoAfterRemovingLine(editForm.value.lines, removedLine);',
    'validateEditableComponentStructure(filledLines)',
    'validateEditableComponentStructure(additionalMaterialLines.value, existingOrderComponentLines.value)',
    'orderLineStructureLabel',
    'orderLineStructureHint',
    'orderLineStructureTagType',
    'orderComponentNoSet',
    'isOrderLineMissingParentComponent',
    '未匹配父级',
    '所属组件不存在',
    'import-source-structure-cell',
    '子零件 ->',
    '单独零件',
    'isComponentNoOutOfRange',
    'componentNos.has(componentNo)',
    '!componentNos.has(parentComponentNo)'
  ];
  for (const snippet of orderDetailComponentSnippets) {
    if (!orderDetailSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must keep edit/additional material component validation snippet: ${snippet}`);
    }
  }

  const orderBackendSnippets = [
    'validateOrderLineComponentStructure',
    '同一订单内组件编号重复',
    '不能填写所属组件',
    '不能填写组件编号；如属于组件，请填写所属组件',
    '所属组件 ${parentComponentNo} 在当前订单内不存在',
    'normalizeEditableOrderLineComponentFields',
    'normalizeEditableLineType',
    '只能是 COMPONENT 或 PART',
    'lineType: this.normalizeEditableLineType(line.lineType)',
    'componentNo: this.normalizeEditableComponentNo(line.componentNo) || null',
    'parentComponentNo: this.normalizeEditableComponentNo(line.parentComponentNo) || null',
    'nextAutoImportComponentNo',
    'COMPONENT_NO_AUTO_RANGE_EXCEEDED',
    'componentIndex <= 9999',
    'ensureEditableComponentNoRange',
    'isEditableComponentNoOutOfRange',
    '新增补单零件组件编号',
    'COMPONENT_NO_RANGE_INVALID',
    '组件编号只支持 C001-C9999'
  ];
  for (const snippet of orderBackendSnippets) {
    if (!ordersServiceSource.includes(snippet)) {
      addFailure(`orders.service.ts must keep component structure backend validation snippet: ${snippet}`);
    }
  }

  const bomBackendSnippets = [
    'async modelBom(bomId: string)',
    'resolveModelBomLineStructure',
    'nextModelBomComponentNo',
    '当前零件包内组件编号已存在',
    '所属组件不存在，请先维护组件行',
    'sortModelBomRows',
    '客户专属清单优先于百胜通用清单',
    'async setModelBomCommon',
    'async setModelBomsCommonBatch',
    '批量常用状态在事务内保存；只调整显示和推荐优先级，不修改 BOM 明细、适用客户、订单、生产任务或库存。',
    '批量常用设置包含不存在的 BOM，请刷新后重试',
    '停用 BOM 同时取消常用优先级',
    "data: { status: 'DISABLED', isCommon: false, commonSortOrder: null }",
    '已停用 BOM 不能设为常用 BOM，请先启用后再设置',
    "if (dto.isCommon && scopeData.status === 'DISABLED')",
    '已停用 BOM 不能进入常用推荐',
    'async reorderModelBomCommon',
    '已停用，不能参与常用排序',
    'modelBomCommonSaveData',
    '表头保存常用状态只影响同范围内显示和推荐顺序；停用表头会强制清理常用排序，不生成订单、生产任务或库存数据。',
    '停用表头会强制清理常用排序',
    '编辑表头时同步保存常用状态；停用表头会强制清理常用排序，不修改 BOM 明细、订单、生产或库存。',
    'copiedAsCommon',
    "const copiedStatus = dto.status || 'ENABLED'",
    "const copiedAsCommon = dto.isCommon === true && copiedStatus !== 'DISABLED'",
    'commonSortOrder: copiedCommonSortOrder',
    '常用排序只影响推荐和列表显示优先级',
    'customerScopeKey: existing.customerScopeKey',
    'projectModelScopeKey: existing.projectModelScopeKey',
    'modelBomCustomerScopeModeFromRow',
    'modelBomCustomerScopeBroadens',
    'modelBomProjectScopeBroadens',
    'modelBomSelectedCustomerScopeAdds',
    'projectModel: true',
    'nextScopeCustomerIds',
    'scopeBroadens',
    'this.modelBomProjectScopeBroadens(existing.projectModel, scopeData.projectModel)',
    'dto.scopeChangeConfirmed !== true',
    'BOM 适用客户范围将被扩大',
    '后端兜底要求扩大 BOM 可见客户范围前必须人工确认',
    '常用 BOM 只能在同一客户范围和同一机型/项目范围内拖拽排序',
    '常用 BOM 只提升同一客户/机型范围内的显示优先级',
    'commonSortOrder',
    'isCommon: Boolean(row.isCommon)',
    "query.commonOnly === 'true'",
    "query.status === 'ALL' ? undefined : query.status || 'ENABLED'",
    "const projectModel = String(dto.projectModel || '').trim();",
    "OR: [{ projectModel: { contains: projectModel, mode: 'insensitive' } }, { projectModelScopeKey: 'ALL' }]",
    "leftProjectScopeKey === requestedProjectModel ? 0 : leftProjectScopeKey === 'ALL' ? 1 : 2",
    "const projectModel = String(dto.projectModel ?? source.projectModel).trim();",
    "const projectScopeLabel = row.projectModel || '全部机型/项目';",
    'modelBomLinePartCodes',
    'modelBomThicknessKey',
    'latestOrderLineThicknessByScopeKey',
    'order: { select: { customerId: true, orderDate: true } }',
    '客户/机型匹配优先',
    'partThicknessByScopeKey.get(this.modelBomThicknessKey(partCode, scope.customerId, scope.projectModel))',
    'const materialDrawingRevision = line.material?.drawingRevisions?.[0] || null;',
    "materialDrawingRevision?.isDefault ? 'MATERIAL_DEFAULT' : materialDrawingRevision ? 'MATERIAL_LATEST'",
    '...(status ? { status } : {})',
    'async reorderModelBomLines(bomId: string',
    'BOM 拖拽排序必须事务化保存',
    'modelBomLineDisplayOrderMap',
    'displayOrder 是页面查看用连续序号',
    'const sortedLines = [...lines].sort(',
    'return new Map(ordered.map((line, index) => [line.id, index + 1]))',
    'copyableSourceLines',
    'copyableSourceLines.length === 0',
    'scopedDuplicate',
    'handleModelBomScopeUniqueError',
    'isModelBomScopeUniqueError',
    "error.code !== 'P2002'",
    'Prisma.PrismaClientKnownRequestError',
    'ModelBom_customerScopeKey_projectModelScopeKey_key',
    'this.handleModelBomScopeUniqueError(error,',
    '当前客户/机型范围已存在 BOM，请直接维护现有零件包，避免重复新建',
    '当前客户/机型范围已存在 BOM，请直接维护现有零件包，避免编辑覆盖其他 BOM 范围',
    '当前客户和机型/项目已存在客户零件包，请打开现有客户 BOM 继续维护，避免重复复制',
    "if (line.lineType === 'COMPONENT')",
    'return !!this.normalizeModelBomComponentNo(line.componentNo);',
    'if (this.normalizeModelBomComponentNo(line.componentNo))',
    'const componentNo = this.normalizeModelBomComponentNo(line.componentNo) || null;',
    'const parentComponentNo = this.normalizeModelBomComponentNo(line.parentComponentNo) || null;',
    "componentNo: line.lineType === 'COMPONENT' ? componentNo : null",
    "parentComponentNo: line.lineType === 'COMPONENT' ? null : parentComponentNo",
    '复制 BOM 只复制当前启用明细并生成客户独立副本',
    "line.status === 'ENABLED' && line.material.status === 'ENABLED'",
    "status: 'ENABLED'",
    'const existingComponentNo = this.normalizeModelBomComponentNo(existing.componentNo) ||',
    'const nextComponentNo = this.normalizeModelBomComponentNo(structure.componentNo) ||',
    'modelBomComponentNoCandidates',
    'findModelBomComponentByNo',
    'maxNo >= 9999',
    'ensureModelBomComponentNoRange',
    '当前零件包 C001-C9999 自动组件编号已用完',
    '组件编号只支持 C001-C9999',
    'Number(matched[1]) < 1 || Number(matched[1]) > 9999',
    'this.normalizeModelBomComponentNo(row.componentNo) ||',
    'const duplicateCandidates = await this.prisma.modelBomLine.findMany',
    'const componentNoCandidates = this.modelBomComponentNoCandidates(line.componentNo);',
    'parentComponentNo: { in: existingComponentNoCandidates }',
    'parentComponentNo: { in: activeComponentNoCandidates }, status: \'ENABLED\'',
    "parentComponentNo: { in: componentNoCandidates }, status: 'ENABLED'",
    'BOM 组件编号变更时，仅同步仍指向旧组件编号的子零件',
    '组件行改成普通零件后，原子零件不再挂靠已经不存在的组件',
    '所属组件已停用，请先启用组件行再维护子零件',
    '停用组件行时，所属子零件同步软停用',
    '组件停用后子零件也必须停用',
    "select: { id: true, customerId: true, projectModel: true, status: true }",
    '停用零件包不能新增 BOM 明细，请先恢复启用后再维护',
    '停用零件包不能编辑 BOM 明细，请先恢复启用后再维护',
    'BOM 明细编辑必须在事务内复核表头状态',
    '停用零件包不能拖拽排序 BOM 明细，请先恢复启用后再维护',
    'BOM 拖拽排序必须事务化保存，并在同一事务内复核表头状态',
    'BOM 明细排序正在被其他业务写入，请刷新后重新排序',
    'const hasBomLinePartThickness = bomLinePartThickness > 0;',
    'const hasHistoryPartThickness = Number(historyPartThickness || 0) > 0;',
    '历史订单厚度只作为 BOM 核对预填',
    "hasBomLinePartThickness ? 'BOM_LINE' : hasHistoryPartThickness ? 'ORDER_HISTORY' : null",
    'async modelBomDiffReviews',
    'async confirmModelBomDiffReview',
    'async disableModelBomDiffReview',
    'serializeModelBomDiffReview',
    '只有复制自来源 BOM 的客户 BOM 才需要差异核对',
    '差异核对来源 BOM 与当前客户 BOM 的复制来源不一致',
    'BOM 差异核对必须填写核对人员',
    'reviewKey.startsWith(`${bom.id}|${bom.sourceBomId}|`)',
    "['MISSING_IN_CUSTOMER', 'CHANGED', 'CUSTOMER_EXTRA'].includes(issueKind)",
    '差异核对行引用与差异类型不一致',
    '差异核对标题不能为空',
    "const reviewedBy = dto.reviewedBy?.trim() || '';",
    '只记录人工核对结果；不会自动覆盖来源 BOM 或客户 BOM 明细',
    '核对记录撤销只停用人工确认，不会删除或覆盖任何 BOM 明细',
    "where: { sourceBomId: bomId }",
    '作为来源引用',
    '永久删除不会自动覆盖客户 BOM',
    'customerScopes: { select: { id: true } }',
    'BOM 永久删除正在被其他业务写入，请刷新后重新删除',
    'await tx.modelBom.delete({ where: { id: bomId } })',
    'customerScopeCount: existing.customerScopes.length',
    '永久删除必须在事务内重新确认 BOM 仍为空',
    '不能在永久删除时清理 BOM 行、适用范围或差异记录',
    'ensureMaterialDrawingRevisionCanBeDisabled',
    "defaultDrawingRevision?.status === 'ENABLED'",
    '该图纸版本已被启用 BOM 行指定为默认图纸',
    'disableMaterialRecommendationLinks',
    '零件软停用只影响后续推荐',
    '停用零件不能加入启用 BOM 行',
    'materialApplicability.updateMany',
    'materialTransformRule.updateMany'
  ];
  for (const snippet of bomBackendSnippets) {
    if (!inventoryServiceSource.includes(snippet)) {
      addFailure(`inventory.service.ts must keep BOM component structure backend validation snippet: ${snippet}`);
    }
  }
  if (!inventoryDtoSource.includes("@IsIn(['ENABLED', 'DISABLED', 'ALL'])") || !inventoryDtoSource.includes("status?: CommonStatus | 'ALL'")) {
    addFailure('ModelBomQueryDto must keep explicit ALL status filter for BOM list.');
  }
  if (!inventoryDtoSource.includes('commonOnly?: string')) {
    addFailure('ModelBomQueryDto must keep commonOnly filter for common BOM list.');
  }
  if (!frontendApiSource.includes("status?: CommonStatus | 'ALL'")) {
    addFailure('ModelBomFilters must keep explicit ALL status filter type.');
  }
  if (!frontendApiSource.includes('commonOnly?: boolean') || !frontendApiSource.includes("commonOnly: filters.commonOnly ? 'true' : undefined")) {
    addFailure('ModelBomFilters must keep commonOnly query parameter mapping.');
  }

  const bomDataVerifierSnippets = [
    'checkModelBomData',
    'await checkMaterialDrawingRevisions();',
    'async function checkMaterialDrawingRevisions()',
    'checkFirstStageVerificationFixtures',
    'FIRST_STAGE_SEED_CUSTOMER_COVERAGE_MISSING',
    'FIRST_STAGE_SEED_GLOBAL_BOM_MISSING',
    'FIRST_STAGE_SEED_BAISHENG_ALL_PROJECT_BOM_MISSING',
    'FIRST_STAGE_SEED_CUSTOMER_BOM_MISSING',
    'FIRST_STAGE_SEED_CUSTOMER_ALL_PROJECT_BOM_MISSING',
    'FIRST_STAGE_SEED_CUSTOMER_BOM_CUSTOMER_COVERAGE_MISSING',
    'FIRST_STAGE_SEED_COPIED_CUSTOMER_BOM_MISSING',
    'FIRST_STAGE_SEED_PROJECT_MODEL_COVERAGE_MISSING',
    'FIRST_STAGE_SEED_BOM_STRUCTURE_COVERAGE_MISSING',
    'FIRST_STAGE_SEED_MATERIAL_TRANSFORM_RULE_MISSING',
    'checkOrderLineComponentStructure',
    'checkCommittedOrderImportRowComponentStructure',
    'committedOrderNoSet',
    'normalizeComponentNo',
    'isComponentNoRangeInvalid',
    'MODEL_BOM_IDENTITY_MISSING',
    'MODEL_BOM_SCOPE_MODE_INVALID',
    'MODEL_BOM_COMMON_SORT_INVALID',
    'MODEL_BOM_CUSTOMER_SCOPE_ROW_IDENTITY_MISSING',
    'MODEL_BOM_LINE_IDENTITY_MISSING',
    'MODEL_BOM_LINE_DEFAULT_QUANTITY_INVALID',
    'MODEL_BOM_LINE_OPTIONAL_TEXT_BLANK',
    'MODEL_BOM_CHILD_PARENT_DISABLED_OR_MISSING',
    'MODEL_BOM_CUSTOMER_SCOPE_KEY_MISMATCH',
    'MODEL_BOM_COMPONENT_NO_DUPLICATE',
    'MODEL_BOM_COMPONENT_NO_RANGE_INVALID',
    'MODEL_BOM_COMPONENT_THICKNESS_SNAPSHOT_NOT_ALLOWED',
    'MODEL_BOM_PROJECT_SCOPE_KEY_MISMATCH',
    'MODEL_BOM_SCOPE_DUPLICATE',
    '厚度只核对子零件和单独零件',
    "bom.customerScopeMode === 'SELECTED'",
    "const expectedProjectModelScopeKey = stringValue(bom.projectModel).toLocaleUpperCase() || 'ALL';",
    'const bomsByScope = new Map',
    'ORDER_LINE_COMPONENT_NO_DUPLICATE',
    'ORDER_LINE_COMPONENT_NO_RANGE_INVALID',
    'ORDER_LINE_CHILD_PARENT_MISSING',
    'ORDER_IMPORT_COMMITTED_ROW_HAS_ERROR',
    'ORDER_IMPORT_COMPONENT_NO_RANGE_INVALID',
    'ORDER_IMPORT_CHILD_PARENT_MISSING',
    'MODEL_BOM_LINE_DISABLED_MATERIAL_ENABLED',
    'MODEL_BOM_DEFAULT_DRAWING_DISABLED',
    'MODEL_BOM_DEFAULT_DRAWING_MATERIAL_MISMATCH',
    'MATERIAL_DRAWING_DEFAULT_DUPLICATE',
    'MATERIAL_DRAWING_DISABLED_IS_DEFAULT',
    'MATERIAL_DRAWING_DEFAULT_OPERATOR_MISSING',
    'MATERIAL_DRAWING_DEFAULT_TIME_MISSING',
    'MATERIAL_DRAWING_REVISION_IDENTITY_MISSING',
    'MATERIAL_DRAWING_REVISION_IDENTITY_HAS_SPACES',
    'MATERIAL_DRAWING_REVISION_OPTIONAL_TEXT_BLANK',
    'MATERIAL_DRAWING_REVISION_OPTIONAL_TEXT_HAS_SPACES',
    'MATERIAL_DRAWING_REVISION_DUPLICATE',
    'MODEL_BOM_DIFF_REVIEW_SOURCE_MISMATCH',
    'MODEL_BOM_DIFF_REVIEW_SOURCE_LINE_MISMATCH',
    'MODEL_BOM_DIFF_REVIEW_TARGET_LINE_MISMATCH',
    'MODEL_BOM_DIFF_REVIEW_FINGERPRINT_MISSING',
    'MODEL_BOM_DIFF_REVIEW_IDENTITY_MISSING',
    'MODEL_BOM_DIFF_REVIEW_OPTIONAL_TEXT_BLANK',
    'MODEL_BOM_DIFF_REVIEW_SOURCE_TARGET_SAME',
    'MODEL_BOM_DIFF_REVIEW_KIND_INVALID',
    'MODEL_BOM_DIFF_REVIEW_KEY_SCOPE_INVALID',
    'MODEL_BOM_DIFF_REVIEW_LINE_SHAPE_INVALID',
    'MODEL_BOM_DIFF_REVIEW_FIELDS_JSON_INVALID',
    'checkMaterialTransformRuleData',
    'MATERIAL_TRANSFORM_RULE_IDENTITY_MISSING',
    'MATERIAL_TRANSFORM_RULE_SOURCE_TARGET_SAME',
    'MATERIAL_TRANSFORM_RULE_MULTIPLIER_INVALID',
    'MATERIAL_TRANSFORM_RULE_PROJECT_SCOPE_KEY_MISMATCH',
    'MATERIAL_TRANSFORM_RULE_OPTIONAL_TEXT_BLANK',
    'MATERIAL_TRANSFORM_RULE_DISABLED_MATERIAL_ENABLED',
    '启用子零件所属组件 ${parentComponentNo} 不存在或已停用'
  ];
  for (const snippet of bomDataVerifierSnippets) {
    if (!dataVerifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep BOM component data verification snippet: ${snippet}`);
    }
  }
  const bomScopeDatabaseSnippets = [
    '@@unique([customerScopeKey, projectModelScopeKey])',
    'model ModelBomDiffReview',
    'ModelBomDiffReviewTarget',
    'ModelBomDiffReviewSource',
    'ModelBomDiffReview_sourceLineId_fkey',
    'ModelBomDiffReview_targetLineId_fkey',
    'model MaterialCommonProjectModel',
    'MaterialCommonProjectModel_projectModelNormalized_key',
    'isCommon              Boolean                 @default(false)',
    'ModelBom_isCommon_commonSortOrder_idx',
    'ModelBom_customerScopeKey_projectModelScopeKey_key',
    'ON "ModelBom"("customerScopeKey", "projectModelScopeKey")',
    'GROUP BY "customerScopeKey", "projectModelScopeKey"',
    "RAISE EXCEPTION 'ModelBom has duplicate customerScopeKey/projectModelScopeKey scopes."
  ];
  for (const snippet of bomScopeDatabaseSnippets) {
    if (!prismaSchemaSource.includes(snippet) && !migrationSqlSource.includes(snippet)) {
      addFailure(`ModelBom scope uniqueness must keep schema/migration snippet: ${snippet}`);
    }
  }

  const modelBomCoreDatabaseSnippets = [
    'ModelBom_identity_not_blank',
    'ModelBom_scope_mode_valid',
    'ModelBom_scope_keys_valid',
    'ModelBom_common_sort_valid',
    'ModelBomCustomerScope_identity_not_blank',
    'ModelBomLine_identity_not_blank',
    'ModelBomLine_type_valid',
    'ModelBomLine_quantities_valid',
    'ModelBomLine_component_shape_valid'
  ];
  for (const snippet of modelBomCoreDatabaseSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`ModelBom core database guards must keep migration snippet: ${snippet}`);
    }
  }

  const materialDrawingRevisionDatabaseSnippets = [
    'MaterialDrawingRevision_identity_not_blank',
    'MaterialDrawingRevision_identity_trimmed',
    'MaterialDrawingRevision_optional_text_not_blank',
    'MaterialDrawingRevision_default_operator_required',
    'MaterialDrawingRevision_enabled_default_unique',
    'MaterialDrawingRevision_materialId_drawingNo_drawingVersion_lower_key'
  ];
  for (const snippet of materialDrawingRevisionDatabaseSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`MaterialDrawingRevision database guards must keep migration snippet: ${snippet}`);
    }
  }

  const modelBomDiffReviewDatabaseSnippets = [
    'ModelBomDiffReview_identity_not_blank',
    'ModelBomDiffReview_source_target_distinct',
    'ModelBomDiffReview_issue_kind_valid',
    'ModelBomDiffReview_issue_line_shape_valid',
    'ModelBomDiffReview_review_key_scope_valid',
    'ModelBomDiffReview_reviewed_by_required',
    'ModelBomDiffReview_optional_text_not_blank',
    'ModelBomDiffReview_fields_json_shape'
  ];
  for (const snippet of modelBomDiffReviewDatabaseSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`ModelBomDiffReview database guards must keep migration snippet: ${snippet}`);
    }
  }

  const materialTransformRuleDatabaseSnippets = [
    'MaterialTransformRule_identity_not_blank',
    'MaterialTransformRule_source_target_distinct',
    'MaterialTransformRule_quantities_valid',
    'MaterialTransformRule_optional_text_not_blank',
    'MaterialTransformRule_scope_keys_valid'
  ];
  for (const snippet of materialTransformRuleDatabaseSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`MaterialTransformRule database guards must keep migration snippet: ${snippet}`);
    }
  }

  const seedBomFixtureSnippets = [
    'async function seedCustomers()',
    "customerCode: 'C-001'",
    "customerCode: 'C-002'",
    "customerCode: 'C-004'",
    'async function seedCommonProjectModels()',
    'materialCommonProjectModel.upsert',
    'async function seedModelBoms()',
    "bomName: 'B3",
    "bomName: 'B5",
    "bomName: '百胜全部机型通用零件包'",
    "bomName: '常州客户通用零件包'",
    "projectModel: 'B3'",
    "projectModel: 'B5'",
    "projectModel: ''",
    "projectModelScopeKey: 'ALL'",
    "projectModelScopeKey: 'B3'",
    "projectModelScopeKey: 'B5'",
    'isCommon: true',
    'commonSortOrder:',
    'sourceBomId: globalB3.id',
    "lineType: 'COMPONENT'",
    "lineType: options.lineType || 'PART'",
    "parentComponentNo: 'C001'",
    'async function seedMaterialTransformRules()',
    'await seedMaterialTransformRules();',
    '来源加工关系只写建议规则，不生成订单、生产任务、库存批次或库存流水',
    '库存来源核对弹窗展示来源加工建议',
    'await seedCustomers();',
    'await seedCommonProjectModels();',
    'await seedModelBoms();'
  ];
  for (const snippet of seedBomFixtureSnippets) {
    if (!seedSource.includes(snippet)) {
      addFailure(`seed.ts must keep customer and BOM fixture snippet for model BOM verification: ${snippet}`);
    }
  }

  const transformBackendSnippets = [
    'const processNames = this.splitDefaultProcessRoute(dto.defaultProcessRoute);',
    '来源加工关系只作为库存来源建议',
    'validateMaterialTransformImportDefaultProcessRoute',
    'INVALID_DEFAULT_PROCESS_ROUTE',
    '预览后标准工序被停用',
    '.split(/(?:->|→|[、,，;；\\n\\r]+)/)',
    'await this.processDefinitionsService.ensureActiveNames(processNames);',
    "defaultProcessRoute: processNames.length > 0 ? processNames.join('、') : null",
    '来源加工关系启用时，来源零件和目标零件都必须是启用状态',
    "sourceMaterial: { status: 'ENABLED' }",
    "targetMaterial: { status: 'ENABLED' }",
    'findTransformMaterialInventorySummary',
    'sourceAvailableQuantity',
    'targetAvailableQuantity',
    "query.sourceStockStatus === 'WITH_STOCK'",
    "query.sourceStockStatus === 'NO_STOCK'",
    "query.targetStockStatus === 'WITH_STOCK'",
    "query.targetStockStatus === 'NO_STOCK'",
    "query.inventoryDecision === 'TARGET_STOCK'",
    "query.inventoryDecision === 'SOURCE_REWORK'",
    "query.inventoryDecision === 'NO_STOCK'",
    "const and: Prisma.MaterialTransformRuleWhereInput[] = status === 'ALL' ? [] : [{ status }]",
    '是否使用库存仍由库存来源核对弹窗人工确认'
  ];
  for (const snippet of transformBackendSnippets) {
    if (!inventoryServiceSource.includes(snippet)) {
      addFailure(`inventory.service.ts must keep transform-rule default process validation snippet: ${snippet}`);
    }
  }

  const bomApiSnippets = [
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'export class SetModelBomsCommonBatchDto'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'export class ReorderModelBomCommonDto'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'export class ReorderModelBomCommonItemDto'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'export class ReorderModelBomLinesDto'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'export class ReorderModelBomLineItemDto'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'modelBom(bomId: string)'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'modelBomsPage(filters: ModelBomFilters = {})'],
    ["frontend/src/types/erp.ts", frontendTypesSource, 'export interface ModelBomListResponse'],
    ["frontend/src/types/erp.ts", frontendTypesSource, 'export interface ModelBomScopeSummary'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'withPage?: string'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, "const withPage = query.withPage === 'true'"],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'modelBomScopeSummary(filtered)'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'hasMore: offset + items.length < totalCount'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'customerScopeCount: number'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'setModelBomsCommonBatch(payload: SetModelBomsCommonBatchPayload)'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'reorderModelBomCommon(payload: ReorderModelBomCommonPayload)'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'reorderModelBomLines(bomId: string'],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, "@Get('model-boms/:bomId')"],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, 'return this.inventoryService.modelBom(bomId);'],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, "@Patch('model-boms/common/reorder')"],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, "@Patch('model-boms/common/batch')"],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, 'return this.inventoryService.setModelBomsCommonBatch(dto);'],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, 'return this.inventoryService.reorderModelBomCommon(dto);'],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, "@Patch('model-boms/:bomId/lines/reorder')"],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, 'return this.inventoryService.reorderModelBomLines(bomId, dto);']
  ];
  for (const [label, source, snippet] of bomApiSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`${label} must keep single BOM query snippet for source diff: ${snippet}`);
    }
  }
}

function verifyMaterialImportIssueReportWorkflow() {
  const requiredFiles = [
    'backend/src/modules/inventory/inventory.service.ts',
    'backend/src/modules/inventory/inventory.controller.ts',
    'frontend/src/api/erp.ts',
    'frontend/src/views/MaterialsView.vue',
    'database/prisma/schema.prisma',
    'database/prisma/verify-first-stage.ts',
    'database/prisma/migrations/20260515233000_material_import_preview_error_rows/migration.sql',
    'scripts/verify-material-import-api.cjs',
    'package.json'
  ];
  for (const projectPath of requiredFiles) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing material import issue report file: ${projectPath}`);
      return;
    }
  }

  const inventoryServiceSource = readFile('backend/src/modules/inventory/inventory.service.ts');
  const inventoryControllerSource = readFile('backend/src/modules/inventory/inventory.controller.ts');
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  const materialsViewSource = readFile('frontend/src/views/MaterialsView.vue');
  const schemaSource = readFile('database/prisma/schema.prisma');
  const dataVerifierSource = readFile('database/prisma/verify-first-stage.ts');
  const materialImportPreviewErrorMigrationSource = readFile(
    'database/prisma/migrations/20260515233000_material_import_preview_error_rows/migration.sql'
  );
  const materialImportApiVerifySource = readFile('scripts/verify-material-import-api.cjs');
  const packageSource = readFile('package.json');
  const migrationSqlSource = readMigrationSqlSource();

  const serviceSnippets = [
    'async buildMaterialImportIssueReport(sessionId: string)',
    'businessDateTimeText(value = new Date())',
    'const stamp = businessDateTimeKey(value);',
    "return stamp.replace(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/, '$1-$2-$3 $4:$5:$6');",
    "['生成时间', this.businessDateTimeText(), '说明', '仅用于修正 Excel；提交前后端仍会重新校验']",
    "workbook.addWorksheet('问题明细'",
    '零件库导入问题导出只输出校验明细，不写入正式零件库。',
    'materialImportIssueArray(row.issues)',
    '当前零件库导入预览没有错误或警告',
    'loadedCount: previewRows.length + previewApplicabilityRows.length + previewTransformRows.length',
    'rowOffset + rowLimit < materialRowCount',
    'rowOffset + rowLimit < scopeRowCount',
    'rowOffset + rowLimit < transformRowCount',
    'refreshMaterialImportSessionIssues(sessionId)',
    'buildMaterialImportPreviewTokenSnapshot(sessionId, tx)',
    'materialImportPreviewToken({',
    'const deletedFile = await runSerializableTransaction(',
    'const discardedFileNames = await runSerializableTransaction(',
    '文件记录先满足数据库计数约束，实际重复行数在写入预览行后立即回填。',
    'acceptedRowCount: parsedRowCount',
    'INVALID_PART_THICKNESS',
    '多文件导入会话必须在每次文件变化后重新合并校验',
    'materialImportSessionMaterialIssueCodes',
    'applyMaterialDrawingImportDuplicateConflicts(rows)',
    'DUPLICATE_DRAWING_REVISION_CONFLICT',
    'EXISTING_DRAWING_REVISION_DIFFERENT',
    'materialImportImportIdentitySignature',
    '同一导入会话内相同零件编码的名称、单位、规格、厚度或项目型号不一致',
    '同一导入会话内相同零件编码、图号和图纸版本的图纸日期、状态或备注不一致'
  ];
  for (const snippet of serviceSnippets) {
    if (!inventoryServiceSource.includes(snippet)) {
      addFailure(`inventory.service.ts must keep material import issue report snippet: ${snippet}`);
    }
  }
  if (inventoryServiceSource.includes("['生成时间', new Date().toISOString()")) {
    addFailure('inventory.service.ts material import issue report must use businessDateTimeText() instead of UTC toISOString().');
  }

  const controllerSnippets = [
    "@Get('material-import-sessions/:sessionId/error-report')",
    'downloadMaterialImportIssueReport',
    'buildMaterialImportIssueReport(sessionId)'
  ];
  for (const snippet of controllerSnippets) {
    if (!inventoryControllerSource.includes(snippet)) {
      addFailure(`inventory.controller.ts must keep material import issue report API snippet: ${snippet}`);
    }
  }

  const frontendSnippets = [
    'downloadMaterialImportIssueReport(sessionId: string)',
    '/inventory/material-import-sessions/${sessionId}/error-report',
    '零件库导入问题明细.xlsx',
    '下载问题明细',
    'importIssueReportDownloading',
    "materialImportConfirmAction.value === 'deleteFile'",
    'executeDeleteMaterialImportFile',
    'materialImportHasIssues',
    '继续加载预览',
    'materialImportPreviewProgressText',
    'loadMoreMaterialImportRows',
    '未显示的行不会被静默忽略'
  ];
  for (const snippet of frontendSnippets) {
    if (!frontendApiSource.includes(snippet) && !materialsViewSource.includes(snippet)) {
      addFailure(`Frontend must keep material import issue report UI/API snippet: ${snippet}`);
    }
  }

  const schemaSnippets = [
    'model MaterialImportSession',
    'model MaterialImportRow',
    'model MaterialApplicabilityImportRow',
    'model MaterialTransformImportRow',
    'issues            Json?',
    'errorCount         Int                   @default(0)',
    'warningCount       Int                   @default(0)'
  ];
  for (const snippet of schemaSnippets) {
    if (!schemaSource.includes(snippet)) {
      addFailure(`Prisma schema must keep material import issue persistence snippet: ${snippet}`);
    }
  }

  const dataVerifierSnippets = [
    'await checkMaterialImportData();',
    'async function checkMaterialImportData()',
    'MATERIAL_IMPORT_SESSION_STATUS_INVALID',
    'MATERIAL_IMPORT_FILE_ROW_COUNT_MISMATCH',
    'MATERIAL_IMPORT_FILE_ACCEPTED_ROW_COUNT_MISMATCH',
    'MATERIAL_IMPORT_ROW_REQUIRED_FIELD_MISSING_WITHOUT_ISSUE',
    'MATERIAL_IMPORT_ROW_STOCK_ALERT_QUANTITY_MISSING',
    'MATERIAL_IMPORT_ROW_ISSUE_COUNT_MISMATCH',
    'MATERIAL_APPLICABILITY_IMPORT_ROW_REQUIRED_FIELD_MISSING_WITHOUT_ISSUE',
    'MATERIAL_APPLICABILITY_IMPORT_ROW_STATUS_INVALID',
    'MATERIAL_TRANSFORM_IMPORT_ROW_REQUIRED_FIELD_MISSING_WITHOUT_ISSUE',
    'MATERIAL_TRANSFORM_IMPORT_ROW_SOURCE_TARGET_SAME',
    'MATERIAL_TRANSFORM_IMPORT_ROW_ISSUE_COUNT_MISMATCH'
  ];
  for (const snippet of dataVerifierSnippets) {
    if (!dataVerifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep material import data verification snippet: ${snippet}`);
    }
  }

  const databaseGuardSnippets = [
    'MaterialImportSession_status_valid',
    'MaterialImportSession_commit_fields_valid',
    'MaterialImportFile_identity_not_blank',
    'MaterialImportFile_counts_valid',
    'MaterialImportRow_identity_not_blank',
    'MaterialImportRow_values_valid',
    'MaterialApplicabilityImportRow_identity_not_blank',
    'MaterialApplicabilityImportRow_values_valid',
    'MaterialTransformImportRow_identity_not_blank',
    'MaterialTransformImportRow_values_valid'
  ];
  for (const snippet of databaseGuardSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Material import database guards must keep migration snippet: ${snippet}`);
    }
  }
  const previewErrorRowMigrationSnippets = [
    'DROP CONSTRAINT IF EXISTS "MaterialImportRow_identity_not_blank"',
    'MaterialImportRow_trace_identity_not_blank',
    'DROP CONSTRAINT IF EXISTS "MaterialApplicabilityImportRow_identity_not_blank"',
    'MaterialApplicabilityImportRow_trace_identity_not_blank',
    'DROP CONSTRAINT IF EXISTS "MaterialTransformImportRow_identity_not_blank"',
    'MaterialTransformImportRow_trace_identity_not_blank',
    '"MaterialTransformImportRow_values_valid"'
  ];
  for (const snippet of previewErrorRowMigrationSnippets) {
    if (!materialImportPreviewErrorMigrationSource.includes(snippet)) {
      addFailure(`Material import preview error-row migration must keep snippet: ${snippet}`);
    }
  }

  const regressionScriptSnippets = [
    'verify-material-import-api',
    '零件库导入模板',
    '/inventory/material-import-template',
    '/inventory/material-import-config',
    '/inventory/material-import-sessions',
    'uploadWorkbook',
    'issueMaterialImportWorkbook',
    'missingRequiredMaterialImportWorkbook',
    'REQUIRED_PART_NAME',
    'REQUIRED_UNIT',
    'STOCK_ALERT_QUANTITY_REQUIRED',
    'required-field-preview-errors',
    '旧 previewToken 提交',
    'assertCommittedMaterialData',
    'assertNoOrderProductionInventorySideEffects',
    'sourceTransformRules',
    'targetTransformRules',
    '来源加工关系只作为建议，不自动扣库存'
  ];
  for (const snippet of regressionScriptSnippets) {
    if (!materialImportApiVerifySource.includes(snippet) && !packageSource.includes(snippet)) {
      addFailure(`verify-material-import-api.cjs/package.json must keep material import API regression snippet: ${snippet}`);
    }
  }
  if (!packageSource.includes('"verify:material-import-api": "node scripts/verify-material-import-api.cjs"')) {
    addFailure('package.json must expose verify:material-import-api for material Excel import regression testing.');
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
  const processMobileReadonlySnippets = [
    'useDeviceProfile',
    'guardDesktopProcessMutation',
    '手机端仅查看生产流程，${actionLabel}请在电脑端操作',
    '手机端只查看流程配置',
    '手机端只查看已保存流程，流程填写、模板维护和标准工序维护请在电脑端操作。',
    '手机端只查看补单状态',
    'v-if="!isMobileLayout"',
    ':disabled="!canEditProcessBase || isMobileLayout"',
    ':draggable="canEditProcess && !isMobileLayout"',
    '标准工序加载失败，请确认后端服务',
    '订单列表加载失败，请确认后端服务和筛选条件',
    '订单明细加载失败，请确认订单状态和后端服务',
    '下单/计划操作员加载失败，请确认后端服务',
    '流程填写人员加载失败，请确认后端服务'
  ];
  for (const snippet of processMobileReadonlySnippets) {
    if (!processSource.includes(snippet)) {
      addFailure(`ProcessSelectionView.vue must keep mobile read-only process-selection snippet: ${snippet}`);
    }
  }
  const ordersMobilePauseSnippets = [
    'orders-page-header-actions',
    'requireDesktopOrderListMutation',
    'useDeviceProfile',
    'v-if="!isMobileLayout" @click="openImportDialog"',
    'v-if="!isMobileLayout" type="primary" @click="openCreate"',
    ':read-only="isMobileLayout"',
    '手机端订单列表仅用于查看明细',
    ':before-close="handleOrderSavingDialogClose"',
    'closeCreateOrderDialog',
    'closeCancelOrderDialog',
    'closeDeleteDraftDialog',
    '订单操作正在保存，请等待保存完成'
  ];
  for (const snippet of ordersMobilePauseSnippets) {
    if (!ordersSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must keep mobile order list read-only snippet: ${snippet}`);
    }
  }
  const ordersListLoadFailureSnippets = [
    '订单新增必须由操作员在 CustomerSelect 中明确选择客户',
    'orders.value = [];',
    'expandedMobileOrderIds.value = [];',
    '订单列表加载失败，请确认后端服务和筛选条件',
    'inventorySummary.value = [];',
    '库存汇总加载失败，请确认后端服务和库存状态',
    'orderOptions.value = [];',
    '订单选项加载失败，请确认后端服务和筛选条件',
    'importConfig.value = undefined;',
    '导入配置读取失败，请确认后端服务和上传配置',
    'importSessionHistory.value = [];',
    'importSessionHistoryTotal.value = 0;',
    'importSessionHistoryHasMore.value = false;',
    '导入记录加载失败，请确认后端服务和导入记忆',
    '导入预览刷新失败，请确认导入记忆和后端服务',
    '订单预览加载失败，请确认导入记忆和后端服务',
    '上传文件预览失败，请确认导入文件和后端服务',
    '上传文件预览加载失败，请确认导入文件和后端服务',
    '删除导入记忆',
    '正式订单与订单来源文字追溯必须保留',
    '系统只会删除上传文件、预览行和会话记录，不会删除已经生成的订单',
    '删除后订单仍保留来源文字，但原 Excel 文件不可再预览',
    'formatDateInputValue',
    '订单制单日期必须按本地业务日期生成，避免 UTC 日期在凌晨回退到前一天',
    'const date = orderDate ? toDateOnly(orderDate) : new Date();'
  ];
  for (const snippet of ordersListLoadFailureSnippets) {
    if (!ordersSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must clear stale order/import state after load failure: ${snippet}`);
    }
  }
  if (ordersSource.includes('new Date().toISOString().slice(0, 10)')) {
    addFailure('OrdersListView.vue must not generate order date defaults with UTC toISOString().slice(0, 10); use local business date formatting.');
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
    'useDeviceProfile',
    'showMobileScanReserved',
    'v-if="isMobileLayout" :icon="Camera"',
    'guardDesktopProductionMutation',
    '生产页属于现场执行端：手机端允许开始生产、工序确认、完成确认、生产通知和补单审核。',
    '订单提交生产仍由订单页控制，手机端不开放下单、导入或提交生产。',
    'v-if="selectedProductionOrderNo && shouldShowStartAction(task)"',
    ':disabled="!canOpenProcess(task, step)"',
    'openReplenishmentApprovalFromRequest(request)',
    '客户名称加载失败，请确认客户筛选和后端服务',
    'clearOperatorOptions',
    '操作人员列表加载失败，请确认后端服务和人员资料',
    '订单选项加载失败，请确认后端服务和筛选条件',
    '生产任务加载失败，请确认后端服务和筛选条件',
    '生产订单汇总加载失败，请确认后端服务和筛选条件',
    '生产通知加载失败，请确认后端服务',
    '生产报废补单申请加载失败，请确认后端服务和筛选条件',
    '补单申请关联任务加载失败，请确认订单、任务和后端服务',
    'activeReplenishmentApprovalTask.value = undefined;',
    'activeReplenishmentApprovalCompletion.value = undefined;',
    '报废统计加载失败，请确认后端服务和筛选条件',
    '报废统计订单选项加载失败，请确认后端服务和筛选条件',
    'label="零件编码"',
    'label="零件名称"',
    '零件图号',
    '客户取消零件',
    '客户新增零件',
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
    'isMobileWarehouseCardExpanded',
    'useDeviceProfile',
    'showMobileScanReserved',
    'v-if="isMobileLayout" :icon="Camera"',
    'guardDesktopWarehouseMutation',
    '手机端可处理入库、发货和仓库通知，${actionLabel}请在电脑端操作',
    '@click="openConfirm(receipt)"',
    '@click="openOrderShipmentConfirm(group.rows[0])"',
    '@click="openShipmentConfirm(shipment)"',
    '客户变更零件处理',
    '客户取消零件',
    '客户新增零件',
    '零件已转入备货库存'
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
    'isMobileInventoryCardExpanded',
    'useDeviceProfile',
    '手机端只查看库存来源和预占记录',
    '手机端仅查看库存和来源，盘点调整请在电脑端操作',
    'materialMemoryOperationSavingId',
    ':loading="materialMemoryDisableSaving && materialMemoryOperationSavingId === row.id"',
    'if (materialMemoryOperationSavingId.value) {',
    ':before-close="handleMaterialMemoryDialogBeforeClose"',
    'closeMaterialMemoryDialog',
    'materialMemorySaving.value',
    '编辑搜索记忆',
    '启用记忆',
    '保存影响',
    '只维护下单搜索记忆，用于后续订单选料、库存搜索和 0 库存零件展示。',
    '状态请使用表格右侧的启用/停用动作，避免编辑保存时绕过专用状态流程。',
    '不会修改库存数量；库存仍然只从 InventoryBatch 实时计算。',
    '不会覆盖历史订单、BOM 明细、库存批次、库存流水或生产记录。',
    '需要修改库存数量时，请到库存溯源里做盘点调整，系统会追加 InventoryTransaction。',
    '需要维护客户适用范围、机型 BOM 或默认图纸时，请到零件基础库或机型零件包维护。',
    '0 库存行来自零件搜索记忆匹配，表示当前筛选范围没有可用库存或历史批次。',
    'materialMemoryDisableDialogVisible',
    'materialMemoryDisableTarget',
    'materialMemoryStatusAction',
    'materialMemoryStatusDialogTitle',
    '不会删除历史订单、库存批次、库存数量、库存流水和生产记录。',
    '启用后只恢复 Material 后续可选状态，不会自动恢复已停用的适用范围、BOM、默认图纸或来源加工关系。',
    'confirmDisableMaterialMemory',
    'materialMemoryStatusSavingText',
    '零件搜索记忆正在保存，请等待保存完成',
    '零件搜索记忆已保存',
    '零件搜索记忆停用失败',
    '零件搜索记忆启用失败',
    '仓库列表加载失败，请确认后端服务',
    'inventorySummary.value = [];',
    'inventory.value = [];',
    'expandedMobileInventoryCardKeys.value = [];',
    '库存数据加载失败，请确认后端服务和筛选条件',
    'materialMemory.value = [];',
    '库存使用总览加载失败，请确认后端服务和筛选条件',
    'sourceDetails.value = null;',
    'sourceDetailsRequestSeq',
    'customerId: filters.customerId',
    '库存来源查询失败，请确认零件和后端服务',
    'reservationHistory.value = [];',
    '预占记录加载失败，请确认库存批次和后端服务',
    'adjustmentHistory.value = [];',
    '盘点记录加载失败，请确认库存批次和后端服务'
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
    'isMobileCustomerExpanded',
    'useDeviceProfile',
    'requireDesktopCustomerMutation',
    '手机端仅查看客户资料，${actionLabel}请在电脑端操作',
    ':close-on-click-modal="!saving"',
    ':close-on-press-escape="!saving"',
    ':before-close="handleCustomerDialogClose"',
    'closeCustomerDialog',
    '客户资料正在保存，请等待保存完成',
    'mobile-readonly-note',
    '手机端只保留资料和 BOM 查看入口',
    'openCustomerPrivateBoms',
    'openCustomerMaterials',
    'openCustomerAvailableBoms',
    'openCustomerCommonBoms',
    'openCustomerBomCreate',
    'openCustomerCommonBomCreate',
    'openCustomerCommonSetup',
    'loadCustomerCommonRows',
    'setCustomerBomCommon',
    'bomCommonBusy',
    ':disabled="bomCommonBusy',
    'if (bomCommonBusy.value) {',
    'erpApi.setModelBomCommon',
    'await loadCustomerCommonRows();',
    '常用排序由后端按 BOM 所属范围重新计算',
    'customerBomCommonSummary',
    'filteredCustomerBomCommonRows',
    'customerBomCommonFixedText',
    'customerBomCommonTextDialogVisible',
    'openCustomerBomCommonTextDialog',
    'copyCustomerBomCommonText',
    'customerBomCommonBatchSetRows',
    'customerBomCommonBatchCancelRows',
    'customerBomCommonBatchPreviewText',
    'bomCommonBatchDialogVisible',
    'bomCommonBatchTargetIsCommon',
    'bomCommonBatchRows',
    'bomCommonBatchActionText',
    'handleBomCommonBatchDialogClose',
    'confirmFilteredCustomerBomsCommon',
    '客户常用 BOM 批量设置正在保存，请等待操作完成',
    'class="customer-common-bom-batch-preview"',
    '变更预览：',
    '常用，顺序由后端重新计算',
    '${beforeText} -> ${afterText}',
    'setFilteredCustomerBomsCommon',
    '筛选设为常用',
    '取消筛选常用',
    'erpApi.setModelBomsCommonBatch',
    '批量常用只提交当前筛选结果的 BOM id；后端事务内保存常用状态和顺序',
    '业务边界：只修改 BOM 常用状态和显示顺序，不修改 BOM 明细、适用范围、订单、生产任务或库存。',
    '客户常用 BOM 固定格式清单',
    '查看固定格式',
    '复制当前筛选',
    'bomCommonOwnershipFilter',
    'customerBomOwnershipFilterMatches',
    '全部归属',
    'bomCommonKeyword',
    'customerBomCommonKeywordMatches',
    '搜索 BOM 名称 / 适用范围 / 机型 / 客户',
    '客户常用 BOM 弹窗只做本地过滤，不改变后端适用范围',
    'customer-common-bom-drag-handle',
    'aria-label="拖拽调整客户常用 BOM 顺序"',
    '<el-icon><Rank /></el-icon>',
    'customerBomCommonDisplayOrder(row)',
    'customer-common-bom-sort-cell',
    '常用 {{ customerBomCommonDisplayOrder(row) }}',
    '常用显示顺序 ${customerBomCommonDisplayOrder(row) || \'-\'}',
    "item.status === 'ENABLED' && item.isCommon",
    '停用 BOM 不参与常用排序，请先恢复启用',
    '已停用 BOM 不能设为常用，请先恢复启用',
    'canDragCustomerCommonBom',
    'startCustomerCommonBomDrag',
    'dropCustomerCommonBom',
    'erpApi.reorderModelBomCommon',
    '客户页只调整常用 BOM 显示顺序；不会修改 BOM 明细、适用范围、订单、生产任务或库存',
    'customerBomOwnershipLabel',
    'customerBomOwnershipTagType',
    '客户私有 {{ customerBomCommonSummary.private }}',
    '指定客户可用 {{ customerBomCommonSummary.selected }}',
    '全部客户机型通用 {{ customerBomCommonSummary.allCustomer }}',
    'customerBomCommonRows',
    'bomCommonDialogVisible',
    '客户私有 BOM 只影响当前客户，全部客户或指定客户可用 BOM 会影响对应可见范围',
    "requireDesktopCustomerMutation('新建客户 BOM')",
    "requireDesktopCustomerMutation('设置客户常用 BOM')",
    "path: '/materials'",
    "path: '/inventory/model-boms'",
    "scopeMode: 'PRIVATE'",
    "commonOnly: 'true'",
    "isCommon: 'true'",
    "excludeGlobalAllProject: 'true'",
    "action: 'createBom'",
    'class="customer-bom-guide"',
    '客户零件包：只看客户私有 BOM。',
    '可用BOM：查看该客户可用的客户私有、指定客户可用和机型级通用 BOM。',
    '常用BOM：只看当前客户范围内人工设为常用的 BOM。',
    '新建常用BOM',
    '新建常用BOM：创建客户私有 BOM，并默认设为常用；不创建订单、生产任务或库存。',
    '客户页默认排除全部客户 / 全部机型泛用 BOM',
    '客户界面只进入客户私有 BOM',
    '客户常用 BOM 包含客户私有、指定客户可用和机型级通用 BOM 中人工设为常用的零件包',
    '客户资料加载失败，请确认后端服务和筛选条件',
    '客户可用 BOM 加载失败，请确认客户筛选和后端服务',
    '客户ID自动生成失败，请手工填写客户ID'
  ];
  for (const snippet of customerSnippets) {
    if (!customersSource.includes(snippet)) {
      addFailure(`CustomersView.vue must keep compact mobile customer card snippet: ${snippet}`);
    }
  }
  if (customersSource.includes('ElMessageBox.confirm')) {
    addFailure('CustomersView.vue customer and customer BOM key operations must use el-dialog instead of ElMessageBox.confirm.');
  }
  if (customersSource.includes('↕')) {
    addFailure('CustomersView.vue must use Rank icon buttons for customer common BOM drag handles instead of the text arrow character.');
  }
  const statisticsSnippets = [
    'mobile-card-compact-summary',
    'mobile-card-header-actions',
    'expandedMobileStatisticsCardKeys',
    'summaryMobileCardKey',
    'orderMobileCardKey',
    'toggleMobileStatisticsCard',
    'isMobileStatisticsCardExpanded',
    'emptyStatisticsResponse',
    '统计数据加载失败，请确认后端服务和筛选条件'
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
    ':read-only="isMobileLayout"',
    'openImportSourcePreview',
    '来源 Excel 预览',
    '预览来源Excel',
    '订单明细加载失败，请确认订单状态和后端服务',
    '标准工序加载失败，请确认后端服务',
    '来源 Excel 预览失败，请确认导入记忆和后端服务',
    '来源 Excel 预览加载失败，请确认导入记忆和后端服务',
    '库存汇总加载失败，请确认后端服务和库存状态',
    '下单/计划操作员加载失败，请确认后端服务'
  ];
  for (const snippet of orderDetailSnippets) {
    if (!orderDetailSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must keep compact mobile order-detail line card snippet: ${snippet}`);
    }
  }
  const processTemplatesViewSnippets = [
    'process-template-page-section',
    'useDeviceProfile',
    ':read-only="isMobileLayout"',
    ':show-status-filter="true"',
    '手机端只查看标准工序；新建、编辑和删除请在电脑端操作。',
    '手机端只查看流程记忆；新建、编辑、复制和停用请在电脑端操作。',
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
    'readOnly?: boolean',
    'const readOnly = computed(() => props.readOnly)',
    'guardReadOnlyOrderLineMutation',
    '订单明细只读',
    ':disabled="readOnly ||',
    ':review-mode="!readOnly"',
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
    'readOnly?: boolean',
    'guardReadOnlyDefinitionMutation',
    '手机端仅查看标准工序，${actionLabel}请在电脑端操作',
    ':before-close="handleDefinitionDialogClose"',
    'closeDefinitionDialog',
    '标准工序正在保存，请等待保存完成',
    ':before-close="handleDeleteDialogClose"',
    'closeDeleteDialog',
    '标准工序正在停用，请等待保存完成',
    'statusFilter',
    'restoringDefinitionId',
    'restoreDefinition',
    '标准工序已恢复启用',
    '已停用的标准工序需先恢复启用后再编辑',
    '停用后不再出现在新增流程、BOM 和来源加工关系的工序下拉中',
    '工序已停用，历史订单和生产任务不受影响',
    '手机端只查看标准工序',
    '标准工序加载失败，请确认后端服务和筛选条件',
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
    'readOnly?: boolean',
    'guardReadOnlyTemplateMutation',
    '手机端仅查看流程记忆，${actionLabel}请在电脑端操作',
    ':before-close="handleTemplateDialogClose"',
    'closeTemplateDialog',
    'templateDialogBusy',
    '流程记忆正在保存，请等待保存完成',
    '标准工序正在创建，请等待创建完成',
    ':before-close="handleDeleteDialogClose"',
    'closeDeleteDialog',
    '流程记忆正在停用，请等待停用完成',
    'statusFilter',
    'restoringTemplateId',
    'restoreTemplate',
    '恢复启用',
    '流程记忆已恢复启用',
    'templateCanApply',
    '已停用的流程记忆需先恢复启用后再应用',
    '手机端只查看流程记忆',
    '标准工序加载失败，流程记忆暂不可编辑新工序',
    '流程记忆加载失败，请确认后端服务和筛选条件',
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
  const migrationSqlSource = readMigrationSqlSource();
  const serviceSnippets = [
    'async completeProcessStep(id: string, dto: CompleteProcessStepDto)',
    'runSerializableTransaction',
    'findTaskForMutationOrThrow(tx, id)',
    '已取消订单不能修改工序完成记录',
    '已完成发货订单不能修改工序完成记录',
    '生产任务已入库，不能修改工序完成记录',
    '生产任务必须先开始，才能确认工序完成',
    '请选择工序操作人员',
    'required: dto.isCompleted',
    '已完成生产的工序不能改为未完成',
    '生产流程必须按已保存的顺序完成，避免跳过前道工序直接把后道工序标绿。',
    '必须先完成上一道工序',
    '后续工序已完成，不能回退当前工序',
    'resolveProcessQuantityGuard',
    'syncTaskStatusFromProcessSteps',
    'ProductionStatus.WAITING_CONFIRMATION',
    '工序全完成只进入待最终确认',
    '最终生产确认只更新最后一道工序记录，不能用系统操作员覆盖已人工确认的前序工序。',
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
  if (
    serviceSource.includes('markAllProcessStepsCompleted') ||
    serviceSource.includes("operatorCode: 'SYSTEM'") ||
    serviceSource.includes("operatorName: '系统完成'")
  ) {
    addFailure('ProductionService final completion must not overwrite manual process completion operators with SYSTEM / 系统完成.');
  }

  const viewSource = readFile(viewPath);
  const viewSnippets = [
    'function canOpenProcess(row: ProductionTask, processName: string)',
    'const status = effectiveProductionStatus(row);',
    "if (row.orderStatus === 'COMPLETED')",
    "return isProcessCompleted(row, processName);",
    "if (status === 'PENDING' || status === 'CANCELLED')",
    'return row.status === \'COMPLETED\' || isProcessCompleted(row, processName) || isCurrentProcess(row, processName);',
    'function processButtonTitle(row: ProductionTask, processName: string)',
    '生产任务已取消，只能查看历史记录',
    '订单已完成发货，只能查看工序记录',
    '该订单已完成发货，工序完成表只能查看，不能再修改。',
    'return \'请先开始生产\';',
    'return \'请先完成上一道工序\';',
    'function openProcessCompletion(row: ProductionTask, processName: string)',
    'if (!canOpenProcess(row, processName))',
    ':before-close="handleProcessDialogClose"',
    'closeProcessDialog',
    '工序完成表正在保存，请等待保存完成',
    'selectedProcessNamesForSave()',
    'missingOperatorProcessNames',
    '确认工序完成时必须选择操作人员',
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
    'COMPLETED_TASK_PROCESS_INCOMPLETE',
    'WAITING_CONFIRMATION_TASK_PROCESS_INCOMPLETE',
    'processCompletionLogActions',
    'checkProductionProcessCompletionLogs',
    'PROCESS_COMPLETION_LOG_ACTION_INVALID',
    'PROCESS_COMPLETION_LOG_AFTER_SNAPSHOT_INVALID'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep process completion sequence data verification snippet: ${snippet}`);
    }
  }

  const migrationSnippets = [
    'ProductionProcessCompletionLog_identity_not_blank',
    'ProductionProcessCompletionLog_action_valid',
    'ProductionProcessCompletionLog_snapshot_shape',
    'TASK_WITHDRAWN',
    'APPROVE_REPLENISHMENT_REQUEST',
    'REJECT_REPLENISHMENT_REQUEST'
  ];
  for (const snippet of migrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep process completion log guard snippet: ${snippet}`);
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
    '已有生产报废补单申请',
    'withdrawHandlingQuantityLimit',
    '当前生产任务没有已记录产出数量，不能转库存或报废',
    '撤回处理数量不能超过已记录产出数量',
    '管理撤回只能处理已经记录的生产产出，不能凭撤回操作生成超量库存或报废记录。',
    'formatWithdrawProcessSummary',
    '撤回前工序',
    'cancelPendingReplenishmentTasksForWithdraw',
    '管理撤回取消未开始补单',
    'status: ProductionStatus.CANCELLED',
    'archiveWithdrawProcessScrapRecords',
    'ProductionProcessCompletionWithdrawSnapshot',
    'ProductionProcessCompletionScrapCancelled',
    '工序报废数量改回 0 时归档旧报废记录',
    "import { businessDateKey, businessDateTimeKey } from '../../common/business-date';",
    'businessDateTimeText(value: Date)',
    'const stamp = businessDateTimeKey(value);',
    "return stamp.replace(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/, '$1-$2-$3 $4:$5:$6');",
    '`处理日期：${this.businessDateTimeText(handledAt)}`',
    "sourceRecordId: `${sourceRecordId}:scrap-cancel:${businessDateTimeKey()}-${randomUUID().slice(0, 8).toUpperCase()}:${record.id}`",
    "sourceRecordId: `${task.id}:withdraw:${businessDateTimeKey(handledAt)}-${randomUUID().slice(0, 8).toUpperCase()}`",
    "sourceRecordId: `${record.sourceRecordId}:withdraw:${businessDateTimeKey(handledAt)}-${randomUUID().slice(0, 8).toUpperCase()}:${record.id}`",
    'resetWithdrawProcessCompletions',
    '撤回保留工序完成表和日志',
    "action: 'TASK_WITHDRAWN'",
    'status: ProductionStatus.PENDING',
    'sourceRecordType: \'ProductionTaskWithdraw\'',
    'beforeQuantity: 0',
    'deltaQuantity: handlingQuantity',
    'target: ProductionNoticeTarget.PRODUCTION',
    'target: ProductionNoticeTarget.WAREHOUSE',
    '通知确认只允许把生产端 PENDING 改为 ACKNOWLEDGED',
    'status: ProductionNoticeStatus.PENDING',
    '生产通知已确认，不能重复确认',
    '管理撤回后需要仓库确认转库存',
    'async approveReplenishmentRequest(id: string, dto: ApproveProductionReplenishmentRequestDto)',
    '没有待确认的生产报废补单申请',
    '生产报废补单申请已经生成任务',
    '生产报废补单申请必须填写大于 0 的报废数量',
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
    'hasSubmittedShortageHandling(dto)',
    'dto.isCompleted && isFinalStep && (this.hasSubmittedShortageHandling(dto) || existingShortageHandling.shortageQuantity > 0)',
    '批量确认连续工序时，只允许最后一道工序登记缺货处理。',
    'await this.upsertProductionScrapRecord(tx, task, saved, shortageHandling.scrapQuantity)',
    'syncProductionReplenishmentRequest',
    '生产人员不能直接生成补单任务，只能发起生产报废补单申请',
    'rejectPendingProductionReplenishmentRequest',
    '操作员取消生产报废补单申请',
    '操作员修改短缺处理方式时保留原生产报废补单申请',
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
  if (serviceSource.includes('productionProcessCompletion.deleteMany')) {
    addFailure('ProductionService withdraw must reset process completions and keep logs instead of deleting ProductionProcessCompletion rows');
  }
  if (serviceSource.includes('productionTask.deleteMany')) {
    addFailure('ProductionService must cancel pending replenishment tasks with ProductionStatus.CANCELLED instead of deleting ProductionTask history.');
  }
  if (serviceSource.includes('productionReplenishmentRequest.delete')) {
    addFailure('ProductionService must reject pending ProductionReplenishmentRequest rows instead of deleting request history.');
  }
  if (serviceSource.includes('productionScrapRecord.deleteMany')) {
    addFailure('ProductionService must archive ProductionScrapRecord rows instead of deleting production scrap history.');
  }
  if (serviceSource.includes(':scrap-cancel:${Date.now()}')) {
    addFailure('ProductionService archived scrap sourceRecordId must use businessDateTimeKey and random suffix instead of Date.now().');
  }
  if (serviceSource.includes('sourceRecordId: `${task.id}:${handledAt.getTime()}`')) {
    addFailure('ProductionService withdraw scrap sourceRecordId must use businessDateTimeKey(handledAt) and random suffix instead of handledAt.getTime().');
  }
  if (serviceSource.includes(':withdraw:${handledAt.getTime()}')) {
    addFailure('ProductionService archived withdraw scrap sourceRecordId must use businessDateTimeKey(handledAt) and random suffix instead of handledAt.getTime().');
  }
  if (serviceSource.includes('handledAt.toISOString()') || serviceSource.includes("handledAt.toLocaleString('zh-CN', { hour12: false })")) {
    addFailure('ProductionService withdraw remarks and notices must use businessDateTimeText(handledAt) instead of server/UTC time formatting.');
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
    'const shouldShowShortagePanel = computed(() => shortageQuantity.value > 0)',
    'buildShortagePayloadFromForm',
    'value="REPLENISHMENT_REQUEST">生产报废补单申请',
    '保存后只生成生产报废补单申请，车间主管确认后系统才会生成补单任务。',
    '生产报废补单申请必须填写大于 0 的报废数量',
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
    ':before-close="handleReplenishmentApprovalDialogClose"',
    'closeReplenishmentApprovalDialog',
    '生产报废补单确认正在保存，请等待保存完成',
    'erpApi.approveProductionReplenishmentRequest',
    '主管已确认，系统已生成生产报废补单任务',
    'v-model="replenishmentRejectVisible"',
    'title="驳回生产报废补单申请"',
    ':before-close="handleReplenishmentRejectDialogClose"',
    'closeReplenishmentRejectDialog',
    '生产报废补单驳回正在保存，请等待保存完成',
    'erpApi.rejectProductionReplenishmentRequest',
    '已驳回生产报废补单申请，并记录为管理确认缺货完成',
    'v-model="withdrawVisible"',
    'title="管理撤回"',
    ':before-close="handleWithdrawDialogClose"',
    'closeWithdrawDialog',
    '生产撤回正在保存，请等待保存完成',
    '撤回会重置当前任务的工序完成状态并退回待确认生产',
    '系统会保留撤回前工序摘要和日志',
    'withdrawForm.managerName',
    'withdrawForm.reason',
    'withdrawForm.handledAt',
    'withdrawForm.handlingMode',
    'withdrawForm.handlingQuantity',
    'withdrawHandlingQuantityMax',
    ':max="withdrawHandlingQuantityMax || undefined"',
    '当前生产任务没有已记录产出数量，不能转库存或报废',
    '撤回处理数量不能超过已记录产出数量',
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
  const migrationSqlSource = readMigrationSqlSource();
  const verifierSnippets = [
    'await checkProductionNotices()',
    'await checkProductionReplenishmentRequests()',
    'await checkProductionScrapRecords()',
    'PRODUCTION_NOTICE_ACK_MISSING',
    'PRODUCTION_NOTICE_IDENTITY_MISSING',
    'PRODUCTION_NOTICE_OPTIONAL_TEXT_BLANK',
    'PRODUCTION_NOTICE_PENDING_ACK_STALE',
    'PRODUCTION_NOTICE_QUANTITY_FIELDS_INCOMPLETE',
    'PRODUCTION_NOTICE_QUANTITY_NEGATIVE',
    'PRODUCTION_NOTICE_QUANTITY_UNIT_MISSING',
    'REPLENISHMENT_IDENTITY_BLANK',
    'REPLENISHMENT_SOURCE_TYPE_INVALID',
    'REPLENISHMENT_SCRAP_NON_POSITIVE',
    'PENDING_REPLENISHMENT_ORDER_CANCELLED',
    'PENDING_REPLENISHMENT_ORDER_COMPLETED',
    'PENDING_REPLENISHMENT_TASK_RECEIVED',
    'PENDING_REPLENISHMENT_REVIEW_FIELDS_STALE',
    'APPROVED_REPLENISHMENT_TASK_MISSING',
    'APPROVED_REPLENISHMENT_TASK_SOURCE_TYPE',
    'REJECTED_REPLENISHMENT_APPROVAL_FIELDS_STALE',
    'REJECTED_REPLENISHMENT_COMPLETION_MODE',
    'PENDING_REPLENISHMENT_DUPLICATE',
    'ProductionProcessCompletionWithdrawSnapshot',
    'ProductionProcessCompletionScrapCancelled',
    'SCRAP_RECORD_IDENTITY_BLANK',
    'SCRAP_RECORD_SOURCE_TYPE_UNKNOWN',
    'SCRAP_RECORD_CANCELLED_SOURCE_MISMATCH',
    'SCRAP_RECORD_WITHDRAW_ARCHIVE_SOURCE_MISMATCH',
    'ProductionTaskWithdraw',
    'SCRAP_RECORD_WITHDRAW_SOURCE_MISMATCH'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep replenishment/withdraw data verification snippet: ${snippet}`);
    }
  }
  const noticeMigrationSnippets = [
    'ProductionNotice_identity_not_blank',
    'ProductionNotice_optional_text_not_blank',
    'ProductionNotice_ack_status_consistent',
    'ProductionNotice_quantity_fields_consistent'
  ];
  for (const snippet of noticeMigrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep production notice database guard snippet: ${snippet}`);
    }
  }
  const replenishmentRequestMigrationSnippets = [
    'ProductionReplenishmentRequest_identity_not_blank',
    'ProductionReplenishmentRequest_source_status_valid',
    'ProductionReplenishmentRequest_quantities_valid',
    'ProductionReplenishmentRequest_status_fields_consistent'
  ];
  for (const snippet of replenishmentRequestMigrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep production replenishment request database guard snippet: ${snippet}`);
    }
  }
  const scrapRecordMigrationSnippets = [
    'ProductionScrapRecord_identity_not_blank',
    'ProductionScrapRecord_quantity_positive',
    'ProductionScrapRecord_source_type_valid',
    'ProductionScrapRecord_archive_source_marker_valid'
  ];
  for (const snippet of scrapRecordMigrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep production scrap record database guard snippet: ${snippet}`);
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

function verifyProductionTaskCancelledStatusWorkflow() {
  const schemaPath = 'database/prisma/schema.prisma';
  const migrationPath = 'database/prisma/migrations/20260515103000_production_task_cancelled_status/migration.sql';
  const statusFlowMigrationPath = 'database/prisma/migrations/20260515133000_production_status_waiting_stored/migration.sql';
  const statusBackfillMigrationPath = 'database/prisma/migrations/20260515141000_backfill_stored_production_tasks/migration.sql';
  const productionServicePath = 'backend/src/modules/production/production.service.ts';
  const ordersServicePath = 'backend/src/modules/orders/orders.service.ts';
  const frontendTypesPath = 'frontend/src/types/erp.ts';
  const productionViewPath = 'frontend/src/views/ProductionView.vue';
  const orderDetailViewPath = 'frontend/src/views/OrderDetailView.vue';
  const ordersListViewPath = 'frontend/src/views/OrdersListView.vue';
  const verifierPath = 'database/prisma/verify-first-stage.ts';

  for (const projectPath of [
    schemaPath,
    migrationPath,
    statusFlowMigrationPath,
    statusBackfillMigrationPath,
    productionServicePath,
    ordersServicePath,
    frontendTypesPath,
    productionViewPath,
    orderDetailViewPath,
    ordersListViewPath,
    verifierPath
  ]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing production task cancelled status file: ${projectPath}`);
      return;
    }
  }

  const migrationSqlSource = readMigrationSqlSource();
  const checks = [
    [schemaPath, readFile(schemaPath), 'CANCELLED'],
    [schemaPath, readFile(schemaPath), 'WAITING_CONFIRMATION'],
    [schemaPath, readFile(schemaPath), 'STORED'],
    [migrationPath, readFile(migrationPath), "ALTER TYPE \"ProductionStatus\" ADD VALUE IF NOT EXISTS 'CANCELLED'"],
    [statusFlowMigrationPath, readFile(statusFlowMigrationPath), "ALTER TYPE \"ProductionStatus\" ADD VALUE IF NOT EXISTS 'WAITING_CONFIRMATION'"],
    [statusFlowMigrationPath, readFile(statusFlowMigrationPath), "ALTER TYPE \"ProductionStatus\" ADD VALUE IF NOT EXISTS 'STORED'"],
    [statusBackfillMigrationPath, readFile(statusBackfillMigrationPath), 'UPDATE "ProductionTask" AS task'],
    [statusBackfillMigrationPath, readFile(statusBackfillMigrationPath), 'SET "status" = \'STORED\''],
    [statusBackfillMigrationPath, readFile(statusBackfillMigrationPath), 'WHERE task."status" = \'COMPLETED\''],
    [statusBackfillMigrationPath, readFile(statusBackfillMigrationPath), 'batch."productionTaskId" = task."id"'],
    ['database/prisma/migrations/*/migration.sql', migrationSqlSource, 'ProductionTask_quantities_valid'],
    ['database/prisma/migrations/*/migration.sql', migrationSqlSource, 'ProductionTask_identity_not_blank'],
    ['database/prisma/migrations/*/migration.sql', migrationSqlSource, 'ProductionTask_completed_time_order'],
    ['database/prisma/migrations/*/migration.sql', migrationSqlSource, 'ProductionTask_status_fields_consistent'],
    [productionServicePath, readFile(productionServicePath), 'where.status = { not: ProductionStatus.CANCELLED }'],
    [productionServicePath, readFile(productionServicePath), 'status: nextStatus'],
    [productionServicePath, readFile(productionServicePath), 'ProductionStatus.STORED'],
    [productionServicePath, readFile(productionServicePath), 'private assertTaskNotStored(task: { status: ProductionStatus }, message: string)'],
    [productionServicePath, readFile(productionServicePath), '已入库状态本身就是写保护'],
    [productionServicePath, readFile(productionServicePath), "this.assertTaskNotStored(task, '生产任务已入库，不能修改工序完成记录')"],
    [productionServicePath, readFile(productionServicePath), 'task.status === ProductionStatus.WAITING_CONFIRMATION'],
    [productionServicePath, readFile(productionServicePath), 'cancelPendingReplenishmentTasksForWithdraw'],
    [productionServicePath, readFile(productionServicePath), '已取消任务只保留历史，不能通过管理撤回重新改回待生产'],
    [productionServicePath, readFile(productionServicePath), '生产任务已取消，不能管理撤回'],
    [productionServicePath, readFile(productionServicePath), '已取消任务只保留历史，不能再写入最终完成数量'],
    [productionServicePath, readFile(productionServicePath), '生产任务已取消，不能确认生产完成'],
    [productionServicePath, readFile(productionServicePath), '已取消任务只保留历史，不能再改写工序完成表'],
    [productionServicePath, readFile(productionServicePath), '生产任务已取消，不能修改工序完成记录'],
    [productionServicePath, readFile(productionServicePath), '已取消任务只保留历史，不能再确认生成新的生产报废补单'],
    [productionServicePath, readFile(productionServicePath), '生产任务已取消，不能确认生产报废补单'],
    [productionServicePath, readFile(productionServicePath), '已取消任务只保留历史，不能再驳回并改写短缺处理记录'],
    [productionServicePath, readFile(productionServicePath), '生产任务已取消，不能驳回生产报废补单'],
    [ordersServicePath, readFile(ordersServicePath), 'cancelPendingProductionTasks'],
    [ordersServicePath, readFile(ordersServicePath), 'activeProductionTasks'],
    [ordersServicePath, readFile(ordersServicePath), 'ProductionStatus.CANCELLED'],
    [ordersServicePath, readFile(ordersServicePath), 'ProductionStatus.WAITING_CONFIRMATION'],
    [ordersServicePath, readFile(ordersServicePath), 'ProductionStatus.STORED'],
    [ordersServicePath, readFile(ordersServicePath), '待最终确认、已完成、已入库或已取消的任务历史不得被后续编辑改写'],
    [ordersServicePath, readFile(ordersServicePath), 'private isTaskWaitingReceipt(task: any)'],
    [ordersServicePath, readFile(ordersServicePath), '待入库只代表生产已最终确认但尚未生成库存批次；STORED 必须已经入库，不能再回到待入库。'],
    [frontendTypesPath, readFile(frontendTypesPath), "'CANCELLED'"],
    [frontendTypesPath, readFile(frontendTypesPath), "'WAITING_CONFIRMATION'"],
    [frontendTypesPath, readFile(frontendTypesPath), "'STORED'"],
    [productionViewPath, readFile(productionViewPath), "CANCELLED: '已取消'"],
    [productionViewPath, readFile(productionViewPath), "row.status === 'CANCELLED'"],
    [productionViewPath, readFile(productionViewPath), '已取消任务只保留历史状态，不能因工序完成或历史无工序快照被重新算成待确认完成'],
    [productionViewPath, readFile(productionViewPath), "activeTask.value?.status === 'STORED'"],
    [productionViewPath, readFile(productionViewPath), "status !== 'RECEIVED'"],
    [productionViewPath, readFile(productionViewPath), "if (status === 'RECEIVED')"],
    [productionViewPath, readFile(productionViewPath), '已取消任务只保留历史，不允许从生产端再次管理撤回'],
    [productionViewPath, readFile(productionViewPath), '生产任务已取消，只能查看历史记录'],
    [orderDetailViewPath, readFile(orderDetailViewPath), "task.status !== 'CANCELLED' && (task.status !== 'PENDING' || task.completedQuantity > 0)"],
    [orderDetailViewPath, readFile(orderDetailViewPath), '已取消任务只保留历史，不参与订单取消时的已生产处理计划'],
    [orderDetailViewPath, readFile(orderDetailViewPath), 'function lineHasStartedProductionProgress(line: OrderLine)'],
    [orderDetailViewPath, readFile(orderDetailViewPath), "line.productionStatus !== 'PENDING' && line.productionStatus !== 'CANCELLED'"],
    [orderDetailViewPath, readFile(orderDetailViewPath), '已取消生产任务只保留历史，不参与“已开始生产”判断，也不能作为订单变更入口。'],
    [orderDetailViewPath, readFile(orderDetailViewPath), '该零件生产任务已取消，只保留历史，不能创建补单或生产数量变更'],
    [orderDetailViewPath, readFile(orderDetailViewPath), '补单任务已取消，只保留历史'],
    [ordersListViewPath, readFile(ordersListViewPath), "task.status !== 'CANCELLED' && (task.status !== 'PENDING' || task.completedQuantity > 0)"],
    [ordersListViewPath, readFile(ordersListViewPath), '已取消任务只保留历史，不参与订单取消时的已生产处理计划'],
    [verifierPath, readFile(verifierPath), 'CANCELLED_TASK_HAS_PRODUCTION_PROGRESS'],
    [verifierPath, readFile(verifierPath), 'PRODUCTION_TASK_IDENTITY_MISSING'],
    [verifierPath, readFile(verifierPath), 'PRODUCTION_TASK_COMPLETED_BEFORE_STARTED'],
    [verifierPath, readFile(verifierPath), 'CANCELLED_TASK_REMARK_MISSING'],
    [verifierPath, readFile(verifierPath), 'WAITING_CONFIRMATION_TASK_PROCESS_INCOMPLETE'],
    [verifierPath, readFile(verifierPath), 'COMPLETED_TASK_HAS_INVENTORY_BATCH'],
    [verifierPath, readFile(verifierPath), '已有入库批次的任务必须进入 STORED'],
    [verifierPath, readFile(verifierPath), 'STORED_TASK_FINAL_FIELDS_MISSING'],
    [verifierPath, readFile(verifierPath), 'STORED_TASK_MISSING_INVENTORY_BATCH'],
    [verifierPath, readFile(verifierPath), 'STORED_TASK_PROCESS_INCOMPLETE']
  ];
  for (const [projectPath, source, snippet] of checks) {
    if (!source.includes(snippet)) {
      addFailure(`${projectPath} must keep ProductionTask CANCELLED status snippet: ${snippet}`);
    }
  }
  if (readFile(ordersServicePath).includes("status: { not: 'COMPLETED' }")) {
    addFailure('OrdersService must not update cancelled production tasks through legacy status != COMPLETED checks.');
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
    'acknowledgePendingProductionNotices',
    '取消补单同步关闭待处理通知',
    '订单取消同步关闭未开始生产任务通知',
    '通知历史不得删除',
    'cancelPendingProductionTasks',
    '未开始生产任务取消后保留 ProductionTask 历史',
    'status: ProductionStatus.CANCELLED',
    '取消新增补单零件',
    'productionPlanQuantity: 0',
    '取消补单',
    'async createAdditionalMaterial(orderNo: string, dto: CreateAdditionalMaterialDto)',
    '待提交生产订单请直接编辑订单，不要创建补单零件',
    '订单尚未开始生产，不能新增补单零件，请直接修改订单',
    '新增补单零件必须使用重新生产方式',
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
  if (serviceSource.includes('productionNotice.deleteMany')) {
    addFailure('OrdersService must acknowledge stale pending ProductionNotice rows instead of deleting notification history.');
  }
  if (serviceSource.includes('productionTask.deleteMany')) {
    addFailure('OrdersService must mark pending ProductionTask rows as CANCELLED instead of bulk deleting task history.');
  }
  if (serviceSource.includes('productionTask.delete(')) {
    addFailure('OrdersService must mark pending ProductionTask rows as CANCELLED instead of deleting task history.');
  }
  if (serviceSource.includes('orderLine.delete({ where: { id: task.orderLineId } })')) {
    addFailure('OrdersService cancelReplenishment must keep added order lines for traceability and zero their quantities instead of deleting them.');
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
    '新增补单零件',
    '生成新增零件补单',
    '新增零件都会同步通知生产',
    '请补齐新增零件、厚度、数量等必填信息',
    '已生产零件转库存或销毁',
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
    '订单已取消；如有已开工任务，通知已同步生产和仓库',
    '未开始的生产任务会标记为已取消并保留历史',
    '未开工生产任务标记为已取消并保留历史',
    ':before-close="handleOrderDetailSavingDialogClose"',
    'closeEditDialog',
    'closeDeleteDraftDialog',
    'closeAdditionalMaterialDialog',
    'closeShortageResolutionDialog',
    'closeReplenishmentDialog',
    'closeCancelReplenishmentDialog',
    'closeQuantityChangeDialog',
    'closeCancelOrderDialog',
    '订单明细操作正在保存，请等待保存完成'
  ];
  for (const snippet of detailViewSnippets) {
    if (!detailViewSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must keep order change/cancellation dialog workflow snippet: ${snippet}`);
    }
  }

  const listViewSource = readFile(listViewPath);
  const listViewSnippets = [
    'v-model="cancelOrderVisible"',
    ':before-close="handleOrderSavingDialogClose"',
    '订单操作正在保存，请等待保存完成',
    '正常订单和补单订单都可以取消',
    '未开始生产任务会标记为已取消并保留历史',
    '处理已生产零件',
    '零件包、零件、客户关键字',
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
  if (
    detailViewSource.includes('生产任务会删除') ||
    detailViewSource.includes('删除未开工生产任务') ||
    listViewSource.includes('删除未开工任务')
  ) {
    addFailure('Order cancellation UI must explain that unstarted ProductionTask rows are marked CANCELLED and kept for history, not deleted.');
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
    'const coveringQuantity = completedReplenishmentQuantityByLine.get(key) ?? 0;',
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
  const shortageClosureZeroFallbackSnippets = [
    'completedReplenishmentQuantityByLine.get(key) || 0',
    'quantityByLine.get(key) || 0'
  ];
  for (const snippet of shortageClosureZeroFallbackSnippets) {
    if (serviceSource.includes(snippet)) {
      addFailure(`OrdersService shortage replenishment closure must use ?? fallback so explicit 0 quantities remain stable: ${snippet}`);
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
    "['COMPLETED', 'STORED'].includes(task.status)",
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
    'task.status === ProductionStatus.COMPLETED || task.status === ProductionStatus.STORED || Boolean(task.inventoryBatch)',
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
  const verifierPath = 'database/prisma/verify-first-stage.ts';

  for (const projectPath of [controllerPath, servicePath, apiPath, viewPath, verifierPath]) {
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
  const verifierSource = readFile(verifierPath);
  const migrationSqlSource = readMigrationSqlSource();
  const serviceSnippets = [
    'async warehouseNotices(query: WarehouseNoticeQueryDto = {})',
    'target: ProductionNoticeTarget.WAREHOUSE',
    'async acknowledgeWarehouseNotice',
    'resolveWarehouseOperatorSnapshot(dto.acknowledgedByCode, dto.acknowledgedBy, \'通知\')',
    '仓库通知已确认，不能重复确认',
    'formatWarehouseNoticeHandlingRemark',
    'customerChangeHandlingQuantityLimit',
    '处理数量不能超过本次客户变更数量',
    '确认无实物处理时必须填写备注说明',
    '转入库存数量必须大于 0',
    'runSerializableTransaction',
    'async pendingReceipts(query: WarehouseWorkQueryDto)',
    'status: ProductionStatus.COMPLETED',
    'status: ProductionStatus.STORED',
    'inventoryBatch: null',
    'async confirmReceipt(productionTaskId: string, dto: ConfirmReceiptDto)',
    'dto.warehouseConfirmedByCode',
    'private formatReceiptRemark',
    'private async resolveWarehouseOperatorSnapshot',
    'sourceRecordType: \'ProductionTask\'',
    'sourceRecordType: \'ProductionTaskOverage\'',
    'async pendingShipments(query: WarehouseWorkQueryDto)',
    'sourceOrderId: { not: null }',
    'quantity: { gt: 0 }',
    'tx.inventoryBatch.count({ where: { warehouseId } })',
    'tx.inventoryTransaction.count({ where: { warehouseId } })',
    'tx.inventoryBatch.count({ where: { locationId: { in: locationIds } } })',
    'tx.inventoryTransaction.count({ where: { locationId: { in: locationIds } } })',
    'tx.warehouseLocation.updateMany',
    "where: { warehouseId, status: 'ENABLED' }",
    "data: { status: 'DISABLED' }",
    '仓库状态正在被其他业务修改，请刷新后重新停用',
    '该仓库已有库存批次或库存流水，只能停用，不能删除',
    '只有完全没有库存批次和库存流水历史的空仓库允许物理删除',
    'tx.inventoryBatch.count({ where: { locationId } })',
    'tx.inventoryTransaction.count({ where: { locationId } })',
    '该库位已有库存批次或库存流水，只能停用，不能删除',
    '只有完全没有库存批次和库存流水历史的空库位允许物理删除',
    '仓库正在被其他业务写入，请刷新后重新删除',
    '库位正在被其他业务写入，请刷新后重新删除',
    '停用仓库不能新增库位，请先启用仓库',
    '停用仓库下的库位不能启用，请先启用所属仓库',
    '停用仓库不允许新增后续可选库位',
    '库位恢复启用前必须先启用所属仓库',
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

  const verifierSnippets = [
    'WAREHOUSE_IDENTITY_MISSING',
    'WAREHOUSE_LOCATION_IDENTITY_MISSING',
    'WAREHOUSE_LOCATION_ENABLED_UNDER_DISABLED_WAREHOUSE',
    'WAREHOUSE_CODE_NOT_NORMALIZED',
    'LOCATION_CODE_NOT_NORMALIZED'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep warehouse master-data verification snippet: ${snippet}`);
    }
  }

  const migrationSnippets = [
    'Warehouse_identity_not_blank',
    'Warehouse_code_normalized',
    'WarehouseLocation_identity_not_blank',
    'WarehouseLocation_code_normalized'
  ];
  for (const snippet of migrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep warehouse master-data database guard snippet: ${snippet}`);
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
    'warehouseNotices(status?: ProductionNoticeStatus, filters: Omit<ProductionNoticeFilters',
    'noticeType: filters.noticeType',
    'customerKeyword: filters.customerKeyword?.trim() || undefined',
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
    'warehouseOperatorOptions',
    'searchWarehouseOperators',
    'warehouseConfirmedByCode',
    'warehouseConfirmedByCode: warehouseOperator.code',
    'acknowledgedByCode',
    'acknowledgedByCode: warehouseOperator.code',
    'stockNoticeHandlingQuantityMax',
    'stockNoticeQuantityText',
    ':max="stockNoticeHandlingQuantityMax || undefined"',
    '处理数量不能超过本次客户变更数量',
    '确认无实物处理时请填写备注说明',
    'warehouseOperatorSelectOptions',
    'warehouseOperatorSnapshot',
    'async function confirmShipment()',
    'erpApi.confirmShipment',
    'async function confirmBatchShipment()',
    'erpApi.confirmBatchShipment',
    'erpApi.confirmOrderShipment',
    ':close-on-press-escape="!saving"',
    ':close-on-press-escape="!stockNoticeSaving"',
    'warehouseStatusVisible',
    'activeWarehouseStatusTarget',
    'confirmWarehouseStatusTarget',
    '已随仓库停用的库位不会自动恢复，需要逐个启用',
    '停用仓库会同步停用该仓库下仍启用的库位',
    '仓库业务正在保存，请等待保存完成',
    '仓库通知正在处理，请等待保存完成',
    'if (stockNoticeSaving.value) {',
    '订单选项加载失败，请确认后端服务和筛选条件',
    '仓库数据加载失败，请确认后端服务和筛选条件',
    '库存流水加载失败，请确认后端服务和筛选条件',
    '仓库通知加载失败，请确认后端服务',
    'shipmentSourceFocusBatchId',
    'shipmentSourceDetailsRequestSeq',
    '库存来源查询失败，请确认零件和后端服务',
    'DrawingPreviewLink',
    'OrderNoLink',
    ':file-name="activeReceipt.drawingFileName"',
    ':file-url="activeReceipt.drawingFileUrl"',
    'partSpecText(activeReceipt)',
    ':file-name="activeShipment.drawingFileName"',
    ':file-url="activeShipment.drawingFileUrl"',
    'activeShipment ? partSpecText(activeShipment) :',
    '@click="openShipmentSourceDetails(activeShipment)"',
    '<el-table-column label="库存来源/图纸"',
    '库存来源/图纸</el-button>',
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
  const productionControllerPath = 'backend/src/modules/production/production.controller.ts';
  const warehouseServicePath = 'backend/src/modules/warehouses/warehouses.service.ts';
  const typesPath = 'frontend/src/types/erp.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const productionViewPath = 'frontend/src/views/ProductionView.vue';
  const warehouseViewPath = 'frontend/src/views/WarehouseView.vue';
  const adminNoticesViewPath = 'frontend/src/views/AdminNoticesView.vue';
  const routerPath = 'frontend/src/router.ts';
  const layoutPath = 'frontend/src/layout/AppLayout.vue';
  const noticeDialogPath = 'frontend/src/components/NoticeAcknowledgeDialog.vue';
  const noticeApiScriptPath = 'scripts/verify-production-notices-api.cjs';
  const packagePath = 'package.json';

  for (const projectPath of [
    productionServicePath,
    productionControllerPath,
    warehouseServicePath,
    typesPath,
    apiPath,
    productionViewPath,
    warehouseViewPath,
    adminNoticesViewPath,
    routerPath,
    layoutPath,
    noticeDialogPath,
    noticeApiScriptPath,
    packagePath
  ]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing notice customer display source file: ${projectPath}`);
      return;
    }
  }

  const serviceSnippets = [
    [productionServicePath, 'return this.toNoticesWithCustomerNames(notices);'],
    [productionServicePath, 'async adminNotices(query: ProductionNoticeQueryDto = {})'],
    [productionServicePath, 'buildProductionNoticeWhere(query, query.target)'],
    [productionServicePath, 'buildProductionNoticeWhere'],
    [productionServicePath, 'const where: Prisma.ProductionNoticeWhereInput = target ? { target } : {};'],
    [productionServicePath, 'productionNoticeCustomerScope'],
    [productionServicePath, '通知历史筛选必须覆盖订单、客户、零件、通知原因和任务号'],
    [productionServicePath, 'const customerNameByOrderId = new Map(orders.map((order) => [order.id, order.customerName]));'],
    [productionServicePath, 'customerNameByOrderId.get(notice.orderId) || customerNameByOrderNo.get(notice.orderNo) || undefined'],
    [productionControllerPath, "@Get('notices/admin')"],
    [productionControllerPath, 'return this.productionService.adminNotices(query);'],
    [warehouseServicePath, 'return this.toNoticesWithCustomerNames(notices);'],
    [warehouseServicePath, 'buildWarehouseNoticeWhere'],
    [warehouseServicePath, 'warehouseNoticeCustomerScope'],
    [warehouseServicePath, '仓库历史通知筛选必须支持订单、客户、零件、通知类型和时间组合查询'],
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
    'overflow-wrap: anywhere',
    'useSelect',
    "emit('search', keyword)",
    "emit('visibleChange', visible)"
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
    'productionNoticeFilters',
    'resetProductionNoticeFilters',
    'noticeType: productionNoticeFilters.noticeType === \'ALL\' ? undefined : productionNoticeFilters.noticeType',
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
    'warehouseNoticeFilters',
    'resetWarehouseNoticeFilters',
    'noticeType: warehouseNoticeFilters.noticeType === \'ALL\' ? undefined : warehouseNoticeFilters.noticeType',
    ':notice-title="activeWarehouseNotice ? warehouseNoticeTitle(activeWarehouseNotice) : \'\'"'
  ];
  for (const snippet of warehouseViewSnippets) {
    if (!warehouseViewSource.includes(snippet)) {
      addFailure(`WarehouseView.vue must keep customerName in warehouse notice title snippet: ${snippet}`);
    }
  }

  const apiSource = readFile(apiPath);
  const apiSnippets = [
    'adminProductionNotices(filters: ProductionNoticeFilters = {})',
    '`/production/tasks/notices/admin${toQuery({',
    'target: filters.target'
  ];
  for (const snippet of apiSnippets) {
    if (!apiSource.includes(snippet)) {
      addFailure(`frontend erpApi must keep admin notice API snippet: ${snippet}`);
    }
  }

  const adminNoticesViewSource = readFile(adminNoticesViewPath);
  const adminNoticesViewSnippets = [
    'erpApi.adminProductionNotices',
    "targetFilter.value === 'ALL' ? undefined : targetFilter.value",
    "statusFilter.value === 'ALL' ? undefined : statusFilter.value",
    "noticeTypeFilter.value === 'ALL' ? undefined : noticeTypeFilter.value",
    'noticeTargetLabel',
    'noticeStatusLabel',
    '管理员通知中心只读拉取历史消息'
  ];
  for (const snippet of adminNoticesViewSnippets) {
    if (!adminNoticesViewSource.includes(snippet)) {
      addFailure(`AdminNoticesView.vue must keep read-only admin notice center snippet: ${snippet}`);
    }
  }

  const routerSource = readFile(routerPath);
  if (!routerSource.includes("path: '/notices'") || !routerSource.includes('AdminNoticesView.vue')) {
    addFailure('router.ts must expose the read-only admin notice center route.');
  }

  const layoutSource = readFile(layoutPath);
  if (!layoutSource.includes("router.push('/notices')") || !layoutSource.includes('全部通知')) {
    addFailure('AppLayout.vue must keep the topbar entry for admin all notices.');
  }

  const noticeApiScriptSource = readFile(noticeApiScriptPath);
  const noticeApiScriptSnippets = [
    '/production/tasks/notices',
    '/production/tasks/notices/admin',
    '/warehouse/notices',
    "noticeType: 'QUANTITY_INCREASE'",
    "noticeType: 'ORDER_CANCELLED'",
    "status: 'ACKNOWLEDGED'",
    'customerKeyword',
    'seedShortageTask',
    'assertProductionShortageCompletionRequiresHandling',
    'assertFinalProcessStepShortageRequestCreatesPendingReview',
    'final process step shortage request must wait for supervisor review',
    "shortageMode: 'REPLENISHMENT_REQUEST'",
    "request?.sourceType === 'PRODUCTION_SCRAP'",
    'shortage completion without handling must be rejected',
    "shortageMode: 'MANAGER_APPROVED'",
    'shortage completion must record shortageQuantity=2',
    'Production and warehouse notice API filter verification passed.'
  ];
  for (const snippet of noticeApiScriptSnippets) {
    if (!noticeApiScriptSource.includes(snippet)) {
      addFailure(`verify-production-notices-api.cjs must keep notice API filter regression snippet: ${snippet}`);
    }
  }
  if (!readFile(packagePath).includes('"verify:production-notices-api": "node scripts/verify-production-notices-api.cjs"')) {
    addFailure('package.json must expose verify:production-notices-api for real API notice filter regression checks.');
  }
}

function verifyInventoryTransactionOrderLineTraceability() {
  const schemaPath = 'database/prisma/schema.prisma';
  const inventoryServicePath = 'backend/src/modules/inventory/inventory.service.ts';
  const warehousesServicePath = 'backend/src/modules/warehouses/warehouses.service.ts';
  const warehousesDtoPath = 'backend/src/modules/warehouses/dto.ts';
  const statisticsServicePath = 'backend/src/modules/statistics/statistics.service.ts';
  const seedPath = 'database/prisma/seed.ts';
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  const repairPath = 'database/prisma/repair-first-stage.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const typesPath = 'frontend/src/types/erp.ts';
  const statusTagPath = 'frontend/src/components/StatusTag.vue';
  const inventoryViewPath = 'frontend/src/views/InventoryView.vue';
  const warehouseViewPath = 'frontend/src/views/WarehouseView.vue';

  for (const projectPath of [
    schemaPath,
    inventoryServicePath,
    warehousesServicePath,
    warehousesDtoPath,
    statisticsServicePath,
    seedPath,
    verifierPath,
    repairPath,
    apiPath,
    typesPath,
    statusTagPath,
    inventoryViewPath,
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
        'enum InventoryStatus',
        'RESERVED',
        'SCRAPPED',
        'orderLineId  String?',
        'orderLine    OrderLine?',
        '@@index([orderLineId])'
      ]
    ],
    [
      typesPath,
      [
        "export type InventoryStatus = 'AVAILABLE' | 'RESERVED' | 'USED' | 'SCRAPPED'"
      ]
    ],
    [
      statusTagPath,
      [
        "RESERVED: '已预占'",
        "SCRAPPED: '已报废'",
        "RESERVED: 'warning'",
        "SCRAPPED: 'danger'"
      ]
    ],
    [
      inventoryServicePath,
      [
        "query.status && query.status !== 'USED'",
        "query.status && query.status !== 'AVAILABLE'",
        'private isPhysicalInventoryBatchStatus',
        "status === 'AVAILABLE' || status === 'RESERVED'",
        'private inventoryBatchReservedQuantity',
        "status === 'RESERVED' ? storedQuantity : activeReservationQuantity",
        'quantity: storedQuantity'
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
      inventoryViewPath,
      [
        'value="RESERVED"',
        'value="SCRAPPED"'
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
        'INVENTORY_BATCH_WAREHOUSE_MISSING',
        'INVENTORY_BATCH_LOCATION_MISSING',
        'INVENTORY_TRANSACTION_WAREHOUSE_MISSING',
        'INVENTORY_TRANSACTION_LOCATION_MISSING',
        'INVENTORY_TRANSACTION_ORDER_LINE_MISSING',
        'INVENTORY_TRANSACTION_ORDER_LINE_ORDER_MISMATCH',
        'prisma.$queryRaw<Array<{ transactionNo: string }>>',
        'WHERE "batchId" IS NULL',
        'INVENTORY_BATCH_STATUS_INVALID',
        'RESERVED_BATCH_ZERO_QUANTITY',
        'RESERVED_BATCH_WITHOUT_ACTIVE_RESERVATION',
        'RESERVED_BATCH_QUANTITY_MISMATCH',
        'SCRAPPED_BATCH_HAS_QUANTITY',
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
  const verifierSource = readFile(verifierPath);
  if (verifierSource.includes('where: { batchId: null }')) {
    addFailure('verify-first-stage.ts must use raw SQL for InventoryTransaction.batchId null drift checks because Prisma schema marks batchId as required.');
  }

  const migrationSqlSource = readMigrationSqlSource();
  const inventoryCheckSnippets = [
    'InventoryTransaction" ALTER COLUMN "batchId" SET NOT NULL',
    'InventoryBatch_quantity_non_negative',
    'InventoryBatch_identity_not_blank',
    'InventoryBatch_status_quantity_consistent',
    'ADD VALUE IF NOT EXISTS \'RESERVED\'',
    'ADD VALUE IF NOT EXISTS \'SCRAPPED\'',
    '"status" = \'RESERVED\'',
    '"status" IN (\'USED\', \'SCRAPPED\')',
    'InventoryTransaction_quantity_positive',
    'InventoryTransaction_identity_not_blank'
  ];
  for (const snippet of inventoryCheckSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep inventory batch/transaction database guard snippet: ${snippet}`);
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
  const warehouseShipmentServiceZeroThicknessSnippets = [
    'partThickness: task.orderLine?.partThickness ? decimalToNumber(task.orderLine.partThickness) : null',
    'partThickness: batch.productionTask?.orderLine?.partThickness\n        ? decimalToNumber(batch.productionTask.orderLine.partThickness)\n        : batch.sourceOrderLine?.partThickness'
  ];
  for (const snippet of warehouseShipmentServiceZeroThicknessSnippets) {
    if (serviceSource.includes(snippet)) {
      addFailure(`WarehousesService must preserve explicit 0 partThickness in warehouse source/shipment serialization: ${snippet}`);
    }
  }
  const warehouseShipmentServiceZeroFallbackSnippets = [
    'receivedQuantityMap.get(task.orderLineId) || 0',
    'receivedMap.get(orderLineId) || 0',
    'receivedMap.get(orderLineId) || 0) + decimalToNumber(transaction.quantity)',
    'shippedMap.get(orderLineId) || 0',
    'shippedQuantityByLine.get(batch.sourceOrderLineId) || 0',
    'shippedQuantityMap.get(batch.sourceOrderLineId) || 0',
    'shippedQuantityByLine.get(line.id) || 0'
  ];
  for (const snippet of warehouseShipmentServiceZeroFallbackSnippets) {
    if (serviceSource.includes(snippet)) {
      addFailure(`WarehousesService must preserve zero receipt/shipment quantities with ?? fallback, found: ${snippet}`);
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
    'const suggestedQuantity = Number(row.suggestedShipmentQuantity ?? 0)',
    'return remainingQuantity > 0 ? Math.min(Number(row.quantity ?? 0), remainingQuantity) : 0',
    'function formatShipmentLineTotal(rows: EditableWarehouseShipment[], field: keyof EditableWarehouseShipment)',
    'const seenLineKeys = new Set<string>();',
    'if (seenLineKeys.has(lineKey))',
    'function formatBatchShipmentOverText(rows: EditableWarehouseShipment[])',
    'const lineMap = new Map<string, { current: number; remaining: number; unit: string }>();',
    'existing.current += current',
    'const overQuantity = Math.max(item.current - item.remaining, 0);',
    'row.isStockOverShipment && Number(row.currentShipmentQuantity ?? 0) > 0',
    'const batchShipmentRequiresSalesConfirmation = computed',
    'activeShipmentOverQuantity > 0',
    '本次发货超过订单未发货数量或使用备货库存，必须填写销售确认人',
    '本次发货超过订单未发货数量或使用备货库存，必须填写超发说明',
    'appendStockOverShipment',
    'stockSourceRequestSeq',
    '备货库存正在查询，请等待当前查询完成',
    '备货超发只允许把最新查询到的可用备货批次追加到当前发货明细',
    '备货库存查询失败，请确认零件、客户和后端服务',
    'isStockOverShipment',
    'orderLineId: row.isStockOverShipment ? row.targetOrderLineId || row.orderLineId : row.orderLineId',
    'ElMessage.success(\'本次发货已确认，订单状态已重新计算\')'
  ];
  for (const snippet of viewSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`WarehouseView.vue must keep partial shipment UI snippet: ${snippet}`);
    }
  }
  const warehouseShipmentZeroFallbackSnippets = [
    'Number(row.suggestedShipmentQuantity || 0)',
    'Number(row.currentShipmentQuantity || 0)',
    'Number(row.remainingQuantity || 0)',
    'Number(row.quantity || 0)',
    'Number(source.quantity || 0)',
    'Number(a.quantity || 0)',
    'Number(b.quantity || 0)',
    'Number(shipmentForm.shipmentQuantity || 0)',
    'Number(activeShipment.value.remainingQuantity || 0)',
    'Number(stockNoticeForm.handlingQuantity || 0)',
    'quantityByUnit.get(row.unit) || 0',
    'overByUnit.get(item.unit) || 0',
    'activeShipment?.quantity || 0',
    '(row.reservedQuantity || 0) > 0',
    '(transaction.reservedQuantity || 0) > 0'
  ];
  for (const snippet of warehouseShipmentZeroFallbackSnippets) {
    if (viewSource.includes(snippet)) {
      addFailure(`WarehouseView.vue must preserve zero shipment quantities with ?? fallback, found: ${snippet}`);
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
    'confirmDuplicateDrawingNos(filledLines)',
    'confirmDuplicateDrawingFiles(filledLines)',
    'confirmExistingDrawingNos(filledLines)',
    'confirmExistingDrawingFiles(filledLines)'
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
    'confirmDuplicateDrawingNos(filledLines)',
    'confirmDuplicateDrawingFiles(filledLines)',
    'confirmExistingDrawingNos(filledLines, order.value.orderNo)',
    'confirmExistingDrawingFiles(filledLines, order.value.orderNo)',
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
    if (
      toProjectPath(filePath) === 'frontend/src/views/ModelBomsView.vue' &&
      source.includes('bom-scope-customer-picker') &&
      source.includes('selectAllBomScopeCustomers')
    ) {
      continue;
    }
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
  const statisticsServiceZeroFallbackSnippets = [
    'orderReceiptQuantityByTaskNo.get(transaction.productionTaskNo) || 0',
    'stockQuantityByTaskNo.get(transaction.productionTaskNo) || 0',
    'unitMap.get(normalizedUnit) || 0',
    'target.get(orderLineId) || 0',
    'Number(row.totalProductionPlanQuantity || 0)',
    'Number(row.totalQuantity || 0)',
    'Number(row[field] || 0)',
    'actualQuantityByUnit.get(row.unit || \'件\') || 0',
    'quantityByLineId.get(line.id) || 0',
    'orderReceiptQuantity || (task.inventoryBatch ? decimalToNumber(task.inventoryBatch.quantity) : 0)'
  ];
  for (const snippet of statisticsServiceZeroFallbackSnippets) {
    if (statisticsServiceSource.includes(snippet)) {
      addFailure(`StatisticsService must use ?? for read-only quantity fallback so explicit 0 quantities remain stable: ${snippet}`);
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
    { name: 'pending production order', pattern: /order\.status === 'PENDING_PRODUCTION'[\s\S]*?return 'WAITING_PRODUCTION'/ }
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

function verifySharedDateFormattingContract() {
  const formatPath = 'frontend/src/utils/format.ts';
  if (!fileExists(formatPath)) {
    addFailure(`Missing shared date formatting utility: ${formatPath}`);
    return;
  }
  const source = readFile(formatPath);
  const snippets = [
    'function dateOnlyBusinessDate(value: string)',
    'export function formatDateInputText(value?: Date | string | null)',
    'export function formatDate(value?: Date | string | null)',
    'export function formatDateTime(value?: Date | string | null)',
    'const date = value instanceof Date ? value : new Date(value);',
    'export function formatDateTimeInputValue(value: Date)',
    'datetime-local',
    'return formatDateInputValue(businessDate);',
    '业务日期只取日期字段，避免浏览器时区把 UTC 零点显示成前一天',
    'T00:00:00(?:\\.000)?Z',
    'function formatDateParts(value: Date)',
    'function isValidDate(value: Date)',
    'function pad2(value: number)',
    'export function formatDateInputValue(value: Date) {\n  if (!isValidDate(value)) {\n    return \'\';\n  }',
    'export function formatDateTimeInputValue(value: Date) {\n  // datetime-local 需要浏览器本地墙钟时间，不能用 toISOString 直接生成 UTC 时间。\n  if (!isValidDate(value)) {\n    return \'\';\n  }',
    'export function formatQuantity(value?: number | null, unit?: string | null)',
    'export function formatNumber(value?: number | null, fractionDigits = 3)',
    "if (typeof value !== 'number' || !Number.isFinite(value))",
    'return `${formatDateParts(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;'
  ];
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      addFailure(`format.ts must keep timezone-safe business date formatting snippet: ${snippet}`);
    }
  }
  if (/toLocale(?:Date)?String\s*\(/.test(source)) {
    addFailure('format.ts must render visible business dates with explicit YYYY-MM-DD / YYYY-MM-DD HH:mm:ss formatting, not browser locale output.');
  }
  if (
    !/export function formatDateTime\(value\?: Date \| string \| null\) \{[\s\S]*const date = value instanceof Date \? value : new Date\(value\);[\s\S]*!isValidDate\(date\)[\s\S]*return '-';[\s\S]*formatDateParts\(date\)[\s\S]*pad2\(date\.getHours\(\)\)/.test(
      source
    )
  ) {
    addFailure('format.ts formatDateTime must return "-" for invalid dates and render through explicit validated local date parts.');
  }
  if (/export function formatQuantity\(value: number[\s\S]*value\.toString\(\)/.test(source)) {
    addFailure('format.ts formatQuantity must tolerate null, undefined, NaN and Infinity before calling toString().');
  }
  if (!source.includes('const number = formatNumber(value);')) {
    addFailure('format.ts formatQuantity must delegate numeric rendering to shared formatNumber().');
  }

  const tableExportSource = readFile('frontend/src/utils/tableExport.ts');
  if (!tableExportSource.includes('const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;')) {
    addFailure('tableExport.ts formatFileDateTime must avoid NaN filenames when an invalid Date is passed.');
  }
  if (!tableExportSource.includes('safeDate.getFullYear()') || !tableExportSource.includes('safeDate.getMinutes()')) {
    addFailure('tableExport.ts formatFileDateTime must build export filenames from the validated safeDate value.');
  }

  const orderDetailSource = readFile('frontend/src/views/OrderDetailView.vue');
  if (!orderDetailSource.includes('drawingDate: formatDateInputText(line.drawingDate) || undefined')) {
    addFailure('OrderDetailView.vue must normalize drawingDate with formatDateInputText before editing order lines.');
  }
  if (orderDetailSource.includes('line.drawingDate ? line.drawingDate.substring(0, 10) : undefined')) {
    addFailure('OrderDetailView.vue must not prepare drawingDate by substring(0, 10); use formatDateInputText to avoid timezone date shifts.');
  }
  if (orderDetailSource.includes('partThickness: line.lineType === \'COMPONENT\' ? 0 : line.partThickness || 1')) {
    addFailure('OrderDetailView.vue must use ?? when preparing editable partThickness so a valid 0 is not replaced with 1.');
  }
  if (!orderDetailSource.includes('partThickness: line.lineType === \'COMPONENT\' ? 0 : (line.partThickness ?? 1)')) {
    addFailure('OrderDetailView.vue must preserve existing partThickness values when opening the edit dialog.');
  }

  const inventorySource = readFile('frontend/src/views/InventoryView.vue');
  if (!inventorySource.includes("import { formatDate, formatDateTime, formatDateTimeInputValue, formatQuantity } from '../utils/format';")) {
    addFailure('InventoryView.vue must use shared date/time formatting utilities.');
  }
  if (!inventorySource.includes('return formatDateTimeInputValue(new Date());')) {
    addFailure('InventoryView.vue inventory adjustment countedAt default must use local datetime-local formatting.');
  }
  if (inventorySource.includes('toISOString().slice(0, 19)')) {
    addFailure('InventoryView.vue must not generate datetime-local values through toISOString().slice(0, 19).');
  }

  const productionSource = readFile('frontend/src/views/ProductionView.vue');
  const warehouseSource = readFile('frontend/src/views/WarehouseView.vue');
  const modelBomsSource = readFile('frontend/src/views/ModelBomsView.vue');
  const materialsSource = readFile('frontend/src/views/MaterialsView.vue');
  const materialsManagementSource = readFile('frontend/src/views/MaterialsManagementView.vue');
  const materialTransformsSource = readFile('frontend/src/views/MaterialTransformsView.vue');
  const ordersListSource = readFile('frontend/src/views/OrdersListView.vue');
  const processSelectionSource = readFile('frontend/src/views/ProcessSelectionView.vue');
  const statisticsSource = readFile('frontend/src/views/StatisticsView.vue');
  const inventorySourceDialogSource = readFile('frontend/src/components/InventorySourceDetailsDialog.vue');
  if (!productionSource.includes("import { formatDate, formatDateTime, formatQuantity } from '../utils/format';")) {
    addFailure('ProductionView.vue must use shared formatDateTime for production notices, logs, and print timestamps.');
  }
  if (!warehouseSource.includes("import { formatDate, formatDateTime, formatQuantity } from '../utils/format';")) {
    addFailure('WarehouseView.vue must use shared formatDateTime for warehouse notices and confirmation timestamps.');
  }
  if (!/import\s+\{[^}]*formatDateTime[^}]*formatQuantity[^}]*\}\s+from '\.\.\/utils\/format';/.test(modelBomsSource)) {
    addFailure('ModelBomsView.vue must use shared formatDateTime for BOM diff review timestamps.');
  }
  if (!/import\s+\{[^}]*formatDateTime[^}]*formatQuantity[^}]*\}\s+from '\.\.\/utils\/format';/.test(materialsSource)) {
    addFailure('MaterialsView.vue must use shared formatDateTime for material updatedAt timestamps.');
  }
  if (!inventorySourceDialogSource.includes("import { formatDate, formatDateTime, formatDateTimeInputValue, formatQuantity } from '../utils/format';")) {
    addFailure('InventorySourceDetailsDialog.vue must use shared formatDateTime for manual stock-source confirmation timestamps.');
  }
  const zeroSafeQuantityFallbacks = [
    ['WarehouseView.vue', warehouseSource, 'completedQuantity || row.quantity'],
    ['WarehouseView.vue', warehouseSource, 'plannedQuantity || row.quantity'],
    ['WarehouseView.vue', warehouseSource, 'customerOrderQuantity || row.quantity'],
    ['WarehouseView.vue', warehouseSource, 'completedQuantity || receipt.quantity'],
    ['WarehouseView.vue', warehouseSource, 'plannedQuantity || receipt.quantity'],
    ['WarehouseView.vue', warehouseSource, 'customerOrderQuantity || receipt.quantity'],
    ['WarehouseView.vue', warehouseSource, 'stockNoticeHandlingQuantityMax.value || Number(notice.afterQuantity || 0)'],
    ['WarehouseView.vue', warehouseSource, 'handlingPlan?.handlingQuantity || 0'],
    ['WarehouseView.vue', warehouseSource, 'stockQuantity || 0'],
    ['WarehouseView.vue', warehouseSource, 'row.stockQuantity ? formatQuantity'],
    ['WarehouseView.vue', warehouseSource, 'receipt.stockQuantity ? formatQuantity'],
    ['WarehouseView.vue', warehouseSource, 'pendingProductionReplenishmentLineCount || 0'],
    ['WarehouseView.vue', warehouseSource, 'unresolvedShortageLineCount || 0'],
    ['ProductionView.vue', productionSource, 'customerOrderQuantity || row.plannedQuantity'],
    ['ProductionView.vue', productionSource, 'customerOrderQuantity || activeFinalTask.value.plannedQuantity'],
    ['ProductionView.vue', productionSource, 'finalCompletion?.completedQuantity || row.completedQuantity || row.plannedQuantity'],
    ['ProductionView.vue', productionSource, 'activeReplenishmentApprovalCompletion.scrapQuantity || 0'],
    ['ProductionView.vue', productionSource, 'activeReplenishmentApprovalCompletion.shortageQuantity || 0'],
    ['ProductionView.vue', productionSource, 'completion?.scrapQuantity || 0'],
    ['ProductionView.vue', productionSource, 'finalCompletion?.scrapQuantity || 0'],
    ['ProductionView.vue', productionSource, 'completion.scrapQuantity || 0'],
    ['ProductionView.vue', productionSource, 'snapshot.shortageQuantity || 0'],
    ['ProductionView.vue', productionSource, 'snapshot.scrapQuantity || 0'],
    ['ProductionView.vue', productionSource, 'processForm.completedQuantity || 0'],
    ['ProductionView.vue', productionSource, 'finalForm.completedQuantity || 0'],
    ['ProductionView.vue', productionSource, 'row.plannedQuantity || 0'],
    ['ProductionView.vue', productionSource, 'previousCompletion.completedQuantity || 0'],
    ['ProductionView.vue', productionSource, 'item.completedQuantity || 0'],
    ['ProductionView.vue', productionSource, 'task.customerOrderQuantity || 0'],
    ['ProductionView.vue', productionSource, 'task.plannedQuantity || 0'],
    ['ProductionView.vue', productionSource, 'task.completedQuantity || 0'],
    ['ProductionView.vue', productionSource, 'task.unresolvedShortageQuantity || 0'],
    ['ProductionView.vue', productionSource, 'task.pendingProductionReplenishmentQuantity || 0'],
    ['ProductionView.vue', productionSource, 'pendingProductionReplenishmentLineCount || 0'],
    ['ProductionView.vue', productionSource, 'unresolvedShortageLineCount || 0'],
    ['ProductionView.vue', productionSource, 'unresolvedShortageQuantityByUnit.get(unit) || 0'],
    ['ProductionView.vue', productionSource, 'pendingProductionReplenishmentQuantityByUnit.get(unit) || 0'],
    ['ProductionView.vue', productionSource, 'buckets.get(label) || 0'],
    ['OrderDetailView.vue', orderDetailSource, 'completedQuantity || task.plannedQuantity || 0'],
    ['OrderDetailView.vue', orderDetailSource, 'row.completedQuantity ? formatQuantity'],
    ['OrderDetailView.vue', orderDetailSource, 'fallbackQuantity || 0'],
    ['OrderDetailView.vue', orderDetailSource, 'record.scrapQuantity || 0'],
    ['OrderDetailView.vue', orderDetailSource, 'Number(quantityChangeForm.value.quantity || 0)'],
    ['OrderDetailView.vue', orderDetailSource, 'Number(quantityChangeForm.value.productionPlanQuantity || 0)'],
    ['OrderDetailView.vue', orderDetailSource, 'Number(source.quantity || 0)'],
    ['OrderDetailView.vue', orderDetailSource, 'Number(line.productionPlanQuantity || 0)'],
    ['OrderDetailView.vue', orderDetailSource, 'Number(line.partThickness || 0)'],
    ['OrderDetailView.vue', orderDetailSource, 'Number(line.quantity || 0)'],
    ['OrderDetailView.vue', orderDetailSource, 'Number(line.unresolvedShortageQuantity || 0)'],
    ['OrdersListView.vue', ordersListSource, 'pendingProductionReplenishmentQuantity || 0'],
    ['OrdersListView.vue', ordersListSource, 'unresolvedShortageQuantity || 0'],
    ['OrdersListView.vue', ordersListSource, 'pendingProductionReplenishmentLineCount || 0'],
    ['OrdersListView.vue', ordersListSource, 'unresolvedShortageLineCount || 0'],
    ['OrdersListView.vue', ordersListSource, 'formatQuantity(line.quantity || 0'],
    ['OrdersListView.vue', ordersListSource, 'formatQuantity(line.productionPlanQuantity || 0'],
    ['OrdersListView.vue', ordersListSource, 'line.orderQuantity || line.unitUsage'],
    ['OrdersListView.vue', ordersListSource, 'bomLine.defaultQuantity || 1'],
    ['OrdersListView.vue', ordersListSource, 'line.quantity = quantity > 0 ? quantity : 1'],
    ['OrdersListView.vue', ordersListSource, 'Number(line.partThickness || 0)'],
    ['OrdersListView.vue', ordersListSource, 'Number(bomLine.partThickness || 0)'],
    ['ProcessSelectionView.vue', processSelectionSource, 'pendingProductionReplenishmentQuantity || 0'],
    ['ProcessSelectionView.vue', processSelectionSource, 'unresolvedShortageQuantity || 0'],
    ['ProcessSelectionView.vue', processSelectionSource, 'pendingProductionReplenishmentLineCount || 0'],
    ['ProcessSelectionView.vue', processSelectionSource, 'unresolvedShortageLineCount || 0'],
    ['ProcessSelectionView.vue', processSelectionSource, 'line.productionPlanQuantity || 0'],
    ['OrderLineEditor.vue', readFile('frontend/src/components/OrderLineEditor.vue'), 'formatQuantity(line.quantity || 0'],
    ['OrderLineEditor.vue', readFile('frontend/src/components/OrderLineEditor.vue'), 'Number(line.quantity || 0'],
    ['OrderLineEditor.vue', readFile('frontend/src/components/OrderLineEditor.vue'), 'Number(line.productionPlanQuantity || 0'],
    ['OrderLineEditor.vue', readFile('frontend/src/components/OrderLineEditor.vue'), 'line.productionPlanQuantity = line.quantity || 1'],
    ['InventoryView.vue', inventorySource, 'formatQuantity(row.reservedQuantity || 0'],
    ['InventoryView.vue', inventorySource, 'formatQuantity(row.normalOrderStockQuantity || 0'],
    ['InventoryView.vue', inventorySource, 'formatQuantity(row.cancelledOrderStockQuantity || 0'],
    ['InventoryView.vue', inventorySource, 'formatQuantity(row.customerChangeStockQuantity || 0'],
    ['InventoryView.vue', inventorySource, 'Number(selectedBatch.value?.reservedQuantity || 0)'],
    ['InventoryView.vue', inventorySource, 'totalByUnit.get(unit) || 0'],
    ['InventoryView.vue', inventorySource, 'Number(row[field] || 0)'],
    ['InventoryView.vue', inventorySource, 'Number(row.quantity || 0)'],
    ['InventoryView.vue', inventorySource, 'Number(row.reservedQuantity || 0)'],
    ['InventoryView.vue', inventorySource, 'Number(row.totalQuantity || 0)'],
    ['InventoryView.vue', inventorySource, 'Number(row.usedQuantity || 0)'],
    ['InventoryView.vue', inventorySource, 'Number(row.batchCount || 0)'],
    ['InventoryView.vue', inventorySource, 'Number(row.availableQuantity || 0)'],
    ['StatisticsView.vue', statisticsSource, 'totalByUnit.get(unit) || 0'],
    ['StatisticsView.vue', statisticsSource, 'Number(row[field] || 0)'],
    ['ModelBomsView.vue', modelBomsSource, 'Number(line.partThickness || 0)'],
    ['ModelBomsView.vue', modelBomsSource, 'Number(row.partThickness || 0)'],
    ['ModelBomsView.vue', modelBomsSource, 'Number(sourceLine.partThickness || 0)'],
    ['ModelBomsView.vue', modelBomsSource, 'Number(item.partThickness || 0)'],
    ['ModelBomsView.vue', modelBomsSource, 'Number(lineForm.partThickness || 0)'],
    ['ModelBomsView.vue', modelBomsSource, 'Number(lineFormOriginalPartThickness.value || 0)'],
    ['ModelBomsView.vue', modelBomsSource, 'left.displayOrder || 0'],
    ['ModelBomsView.vue', modelBomsSource, 'right.displayOrder || 0'],
    ['ModelBomsView.vue', modelBomsSource, 'activeBomLineDisplayOrderMap.value.get(row.id) || row.displayOrder || 0'],
    ['ModelBomsView.vue', modelBomsSource, 'left.sortOrder || 0'],
    ['ModelBomsView.vue', modelBomsSource, 'right.sortOrder || 0'],
    ['ModelBomsView.vue', modelBomsSource, 'item.sortOrder || 0'],
    ['ModelBomsView.vue', modelBomsSource, 'row.sortOrder || 0'],
    ['MaterialsView.vue', materialsSource, 'drawingRevisionUpsertCount || 0'],
    ['MaterialsView.vue', materialsSource, 'applicabilityUpsertCount || 0'],
    ['MaterialsView.vue', materialsSource, 'transformRuleUpsertCount || 0'],
    ['MaterialsView.vue', materialsSource, 'file.materialRowCount || 0'],
    ['MaterialsView.vue', materialsSource, 'file.scopeRowCount || 0'],
    ['MaterialsView.vue', materialsSource, 'file.transformRowCount || 0'],
    ['MaterialsView.vue', materialsSource, 'materialImportSession.summary.materialRowCount || 0'],
    ['MaterialsView.vue', materialsSource, 'materialImportSession.summary.applicabilityRowCount || 0'],
    ['MaterialsView.vue', materialsSource, 'materialImportSession.summary.transformRowCount || 0'],
    ['MaterialsView.vue', materialsSource, 'materialImportSession.value?.summary.rowCount || 0'],
    ['MaterialsView.vue', materialsSource, 'session?.summary.errorCount || 0'],
    ['MaterialsView.vue', materialsSource, 'session?.summary.warningCount || 0'],
    ['MaterialsView.vue', materialsSource, 'session.summary.materialRowCount || 0'],
    ['MaterialsView.vue', materialsSource, 'session.summary.applicabilityRowCount || 0'],
    ['MaterialsView.vue', materialsSource, 'session.summary.transformRowCount || 0'],
    ['MaterialsView.vue', materialsSource, 'materialImportSession.applicabilityRows || []'],
    ['MaterialsView.vue', materialsSource, 'materialImportSession.transformRows || []'],
    ['MaterialsView.vue', materialsSource, 'session.applicabilityRows || []'],
    ['MaterialsView.vue', materialsSource, 'session.transformRows || []'],
    ['MaterialsView.vue', materialsSource, 'totals.get(item.unit) || 0'],
    ['MaterialsView.vue', materialsSource, 'item.availableQuantity || 0'],
    ['MaterialTransformsView.vue', materialTransformsSource, 'formatQuantity(row.sourceAvailableQuantity || 0'],
    ['MaterialTransformsView.vue', materialTransformsSource, 'formatQuantity(row.targetAvailableQuantity || 0'],
    ['MaterialTransformsView.vue', materialTransformsSource, 'row.sourceAvailableQuantity || 0'],
    ['MaterialTransformsView.vue', materialTransformsSource, 'row.targetAvailableQuantity || 0'],
    ['MaterialTransformsView.vue', materialTransformsSource, 'row.sourceAvailableBatchCount || 0'],
    ['MaterialTransformsView.vue', materialTransformsSource, 'row.targetAvailableBatchCount || 0'],
    ['InventorySourceDetailsDialog.vue', inventorySourceDialogSource, 'expected.requiredQuantity ? formatQuantity'],
    ['MaterialsManagementView.vue', materialsManagementSource, 'row.defaultQuantity ? formatQuantity']
  ];
  for (const [viewName, viewSource, snippet] of zeroSafeQuantityFallbacks) {
    if (viewSource.includes(snippet)) {
      addFailure(`${viewName} must use ?? for quantity fallback so a valid 0 quantity is not replaced by another business quantity.`);
    }
  }
  if (!warehouseSource.includes('function stockNoticeDisplayQuantity(notice: ProductionNotice)')) {
    addFailure('WarehouseView.vue must centralize warehouse notice display quantity so customer-change notices show handling quantity, not afterQuantity.');
  }
  if (!warehouseSource.includes('return stockNoticeHandlingQuantityMax.value;')) {
    addFailure('WarehouseView.vue customer-change and withdraw notices must display stockNoticeHandlingQuantityMax as the business handling quantity.');
  }
  for (const [viewName, viewSource] of [
    ['MaterialsView.vue', materialsSource],
    ['MaterialsManagementView.vue', materialsManagementSource],
    ['ModelBomsView.vue', modelBomsSource]
  ]) {
    if (/function\s+formatQuantity\s*\(/.test(viewSource) || /function\s+formatNumber\s*\(/.test(viewSource)) {
      addFailure(`${viewName} must use shared formatQuantity() so missing quantities are not silently displayed as 0.`);
    }
  }
  if (!inventorySourceDialogSource.includes('manualConfirmedAt: formatDateTimeInputValue(form.confirmedAt || confirmedAt)')) {
    addFailure('InventorySourceDetailsDialog.vue must store manual stock-source confirmation time as local business datetime text.');
  }
  if (inventorySourceDialogSource.includes('manualConfirmedAt: (form.confirmedAt || confirmedAt).toISOString()')) {
    addFailure('InventorySourceDetailsDialog.vue must not store manual stock-source confirmation time through UTC toISOString().');
  }
  for (const [viewName, viewSource] of [
    ['ProductionView.vue', productionSource],
    ['WarehouseView.vue', warehouseSource],
    ['ModelBomsView.vue', modelBomsSource],
    ['MaterialsView.vue', materialsSource],
    ['InventorySourceDetailsDialog.vue', inventorySourceDialogSource]
  ]) {
    if (viewSource.includes("toLocaleString('zh-CN', { hour12: false })") || viewSource.includes("new Date().toLocaleString('zh-CN'")) {
      addFailure(`${viewName} must not bypass shared formatDateTime for visible timestamps.`);
    }
    if (/function\s+formatDateTime\s*\(/.test(viewSource)) {
      addFailure(`${viewName} must not define a local formatDateTime helper; use frontend/src/utils/format.ts.`);
    }
  }
  for (const [viewName, viewSource] of [
    ['WarehouseView.vue', warehouseSource],
    ['OrdersListView.vue', ordersListSource],
    ['OrderDetailView.vue', orderDetailSource]
  ]) {
    if (viewSource.includes('formatDateTime(new Date().toISOString())')) {
      addFailure(`${viewName} must not create local UI timestamps through new Date().toISOString().`);
    }
  }
  for (const [viewName, viewSource] of [
    ['OrdersListView.vue', ordersListSource],
    ['OrderDetailView.vue', orderDetailSource]
  ]) {
    if (viewSource.includes('Date.now().toString().slice(-4)')) {
      addFailure(`${viewName} must not generate temporary visible partCode values from Date.now(); require a real selected or typed partCode.`);
    }
    if (viewSource.includes('isGeneratedPlaceholderPartCode')) {
      addFailure(`${viewName} must not keep legacy placeholder partCode recognition; blank new rows should require a real partCode.`);
    }
    if (!/function\s+newLine\s*\([^)]*\)\s*:\s*CreateOrderLinePayload\s*{[\s\S]*partCode:\s*''/.test(viewSource)) {
      addFailure(`${viewName} newLine() must initialize partCode as blank so operators choose or type a real partCode.`);
    }
  }
  if (
    !ordersListSource.includes('function filledOrderFormLines()') ||
    !ordersListSource.includes('const orderFormFilledLines = computed(() => filledOrderFormLines());') ||
    !ordersListSource.includes('const orderFormFilledLineCount = computed(() => orderFormFilledLines.value.length);') ||
    !ordersListSource.includes(':disabled="orderFormFilledLineCount === 0"') ||
    !ordersListSource.includes('buildOrderFormStructureGroups(orderFormFilledLines.value)') ||
    !ordersListSource.includes('if (orderFormStructureGroups.value.length === 0)') ||
    !ordersListSource.includes('const filledLines = filledOrderFormLines();') ||
    !ordersListSource.includes('lines: normalizedLines(filledLines)')
  ) {
    addFailure('OrdersListView.vue must filter pure blank spare rows before rendering fixed-format preview, validating, and saving a new order.');
  }
  if (
    !orderDetailSource.includes('function isBlankEditableOrderLine') ||
    !orderDetailSource.includes('function editableOrderLines()') ||
    !orderDetailSource.includes('const filledLines = editableOrderLines();') ||
    !orderDetailSource.includes('lines: normalizedLines(filledLines)')
  ) {
    addFailure('OrderDetailView.vue must filter pure blank spare rows before validating and saving edited draft order lines.');
  }
}

function verifyBackendBusinessDateKeyContract() {
  const businessDatePath = 'backend/src/common/business-date.ts';
  if (!fileExists(businessDatePath)) {
    addFailure(`Missing backend business date utility: ${businessDatePath}`);
    return;
  }
  const businessDateSource = readFile(businessDatePath);
  const requiredUtilitySnippets = [
    "process.env.BUSINESS_TIME_ZONE || 'Asia/Shanghai'",
    '业务编号按公司业务日期生成，避免 Docker / NAS 时区为 UTC 时凌晨编号落到前一天',
    'export function businessDateTimeKey(value: Date = new Date(), timeZone = defaultBusinessTimeZone)',
    '盘点等流水编号需要日期和时间都按公司业务时区生成，避免 Docker / NAS 默认 UTC',
    'formatToParts(value)',
    'return `${year}${month}${day}`;',
    'return `${year}${month}${day}${hour}${minute}${second}`;'
  ];
  for (const snippet of requiredUtilitySnippets) {
    if (!businessDateSource.includes(snippet)) {
      addFailure(`business-date.ts must keep business date key snippet: ${snippet}`);
    }
  }

  const services = [
    'backend/src/modules/orders/orders.service.ts',
    'backend/src/modules/production/production.service.ts',
    'backend/src/modules/warehouses/warehouses.service.ts'
  ];
  for (const servicePath of services) {
    const source = readFile(servicePath);
    if (!/import\s+\{[^}]*\bbusinessDateKey\b[^}]*\}\s+from\s+'..\/..\/common\/business-date';/.test(source)) {
      addFailure(`${servicePath} must import businessDateKey for date-based business numbers.`);
    }
    if (source.includes("new Date().toISOString().slice(0, 10).replace(/-/g, '')")) {
      addFailure(`${servicePath} must not generate business number date keys from UTC toISOString().slice(0, 10).`);
    }
  }

  const ordersSource = readFile('backend/src/modules/orders/orders.service.ts');
  if (!ordersSource.includes('const dateKey = businessDateKey(orderDate);')) {
    addFailure('OrdersService.generateOrderNo must use businessDateKey(orderDate).');
  }
  if (
    !ordersSource.includes('deliveryDate: line.deliveryDate ? this.formatDateOnly(line.deliveryDate) || undefined : undefined') ||
    !ordersSource.includes('drawingDate: line.drawingDate ? this.formatDateOnly(line.drawingDate) || undefined : undefined')
  ) {
    addFailure('OrdersService persisted order-line validation DTO must preserve deliveryDate and drawingDate through formatDateOnly.');
  }
  if (ordersSource.includes('new Date(line.deliveryDate).toISOString().slice(0, 10)')) {
    addFailure('OrdersService must not convert order-line deliveryDate through UTC toISOString().slice(0, 10).');
  }
  if (ordersSource.includes('new Date(line.drawingDate).toISOString().slice(0, 10)')) {
    addFailure('OrdersService must not convert order-line drawingDate through UTC toISOString().slice(0, 10).');
  }
  if (ordersSource.includes('const record = `${new Date().toISOString()} ${line}`;')) {
    addFailure('OrdersService.appendOrderRemark must use businessRemarkTimestamp() instead of UTC toISOString().');
  }
  if (
    !ordersSource.includes('businessDateTimeText(value = new Date())') ||
    !ordersSource.includes('businessRemarkTimestamp(value = new Date())') ||
    !ordersSource.includes('const stamp = businessDateTimeKey(value);') ||
    !ordersSource.includes("return stamp.replace(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/, '$1-$2-$3 $4:$5:$6');") ||
    !ordersSource.includes('return this.businessDateTimeText(value);') ||
    !ordersSource.includes('const record = `${this.businessRemarkTimestamp()} ${line}`;')
  ) {
    addFailure('OrdersService.appendOrderRemark must keep business-time order remark timestamp formatting.');
  }
  if (ordersSource.includes("['生成时间', this.formatDateTime(new Date()), '说明', '仅用于修正 Excel；创建草稿前后端仍会重新校验']")) {
    addFailure('OrdersService order import issue report must use businessDateTimeText() instead of server local formatDateTime(new Date()).');
  }
  if (!ordersSource.includes("['生成时间', this.businessDateTimeText(), '说明', '仅用于修正 Excel；创建草稿前后端仍会重新校验']")) {
    addFailure('OrdersService order import issue report must keep business-time 生成时间 in Excel issue report.');
  }
  if (ordersSource.includes('this.formatDateTime(file.createdAt)') || ordersSource.includes('private formatDateTime(value?: Date | string | null)')) {
    addFailure('OrdersService order import issue report upload time must use businessDateTimeText(file.createdAt), not server-local formatDateTime().');
  }
  if (!ordersSource.includes('this.businessDateTimeText(file.createdAt)')) {
    addFailure('OrdersService order import issue report must render uploaded file time with businessDateTimeText(file.createdAt).');
  }

  const uploadControllers = [
    'backend/src/modules/orders/orders.controller.ts',
    'backend/src/modules/inventory/inventory.controller.ts'
  ];
  for (const controllerPath of uploadControllers) {
    const source = readFile(controllerPath);
    if (!source.includes("import { businessDateTimeKey } from '../../common/business-date';")) {
      addFailure(`${controllerPath} must import businessDateTimeKey for uploaded file names.`);
    }
    if (source.includes('Date.now()')) {
      addFailure(`${controllerPath} must not use Date.now() in uploaded file names; use businessDateTimeKey().`);
    }
    if (!source.includes('businessDateTimeKey()')) {
      addFailure(`${controllerPath} must use businessDateTimeKey() for uploaded file names.`);
    }
  }

  const uploadFileNameContracts = [
    {
      controllerPath: 'backend/src/modules/orders/orders.controller.ts',
      functionName: 'safeDrawingFileName',
      expectedFileName: "`${businessDateTimeKey()}-${uniqueSuffix}-${baseName || 'drawing'}${extension}`"
    },
    {
      controllerPath: 'backend/src/modules/orders/orders.controller.ts',
      functionName: 'safeOrderImportFileName',
      expectedFileName: "`${businessDateTimeKey()}-${uniqueSuffix}-${baseName || 'order-import'}${extension}`"
    },
    {
      controllerPath: 'backend/src/modules/inventory/inventory.controller.ts',
      functionName: 'safeAdjustmentFileName',
      expectedFileName:
        "`${businessDateTimeKey()}-${uniqueSuffix}-${baseName || 'inventory-adjustment'}${extension}`"
    },
    {
      controllerPath: 'backend/src/modules/inventory/inventory.controller.ts',
      functionName: 'safeMaterialImportFileName',
      expectedFileName: "`${businessDateTimeKey()}-${uniqueSuffix}-${baseName || 'material-import'}${extension}`"
    }
  ];
  for (const contract of uploadFileNameContracts) {
    const source = readFile(contract.controllerPath);
    const functionStart = source.indexOf(`function ${contract.functionName}`);
    if (functionStart === -1) {
      addFailure(`${contract.controllerPath} must keep ${contract.functionName}.`);
      continue;
    }
    const nextFunctionStart = source.indexOf('\nfunction ', functionStart + 1);
    const functionSource =
      nextFunctionStart === -1 ? source.slice(functionStart) : source.slice(functionStart, nextFunctionStart);
    if (!functionSource.includes('const uniqueSuffix = randomUUID().slice(0, 8);')) {
      addFailure(`${contract.controllerPath} ${contract.functionName} must add randomUUID short suffix.`);
    }
    if (!functionSource.includes(contract.expectedFileName)) {
      addFailure(`${contract.controllerPath} ${contract.functionName} must include business time plus unique suffix.`);
    }
  }
}

function verifyStockSourcePayloadSanitizer() {
  const stockSourceReviewPath = 'frontend/src/utils/stockSourceReview.ts';
  const orderLineStockChecksPath = 'frontend/src/utils/orderLineStockChecks.ts';
  const orderDtoPath = 'backend/src/modules/orders/dto.ts';
  const orderServicePath = 'backend/src/modules/orders/orders.service.ts';
  if (!fileExists(stockSourceReviewPath)) {
    addFailure(`Missing stock source review utility: ${stockSourceReviewPath}`);
    return;
  }
  if (!fileExists(orderLineStockChecksPath)) {
    addFailure(`Missing stock line check utility: ${orderLineStockChecksPath}`);
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
  const orderLineStockChecksSource = readFile(orderLineStockChecksPath);
  const orderDtoSource = readFile(orderDtoPath);
  const orderServiceSource = readFile(orderServicePath);
  if (!/function\s+normalizeSelectedStockSources\s*\([^)]*\)\s*{[\s\S]*const\s+quantity\s*=\s*Number\(source\.quantity\s*\?\?\s*0\)[\s\S]*if\s*\(!batchId\s*\|\|\s*quantity\s*<=\s*0\)\s*{[\s\S]*continue;[\s\S]*}/.test(source)) {
    addFailure('stockSourceReview.ts must keep zero-quantity queue placeholders out of normalized selectedStockSources.');
  }
  const stockSourceUtilityZeroFallbacks = [
    [stockSourceReviewPath, source, 'Number(line.quantity || 0)'],
    [stockSourceReviewPath, source, 'Number(source.quantity || 0)'],
    [stockSourceReviewPath, source, 'Number(source.availableQuantity || 0)'],
    [stockSourceReviewPath, source, 'current?.quantity || 0'],
    [stockSourceReviewPath, source, 'Number(required || 0)'],
    [stockSourceReviewPath, source, 'Number(actual || 0)'],
    [stockSourceReviewPath, source, 'Number(line.partThickness || 0)'],
    ['frontend/src/components/OrderLineEditor.vue', readFile('frontend/src/components/OrderLineEditor.vue'), 'Number(line.partThickness || 0)'],
    ['frontend/src/components/OrderLineEditor.vue', readFile('frontend/src/components/OrderLineEditor.vue'), 'Number(snapshot.autoFields.partThickness || 0)'],
    [orderLineStockChecksPath, orderLineStockChecksSource, 'stockInventoryQuantity || 0'],
    [orderLineStockChecksPath, orderLineStockChecksSource, 'Number(source.quantity || 0)'],
    [orderServicePath, orderServiceSource, 'Number(source.quantity || 0)'],
    [orderServicePath, orderServiceSource, 'selectedSourceMap.get(batch.id)?.quantity || 0'],
    [orderServicePath, orderServiceSource, 'reservedQuantityByBatchId.get(batch.id) || 0'],
    [orderServicePath, orderServiceSource, 'Number(batch.selectedQuantity || 0)'],
    [orderServicePath, orderServiceSource, 'selectedQuantityByBatchId.get(source.batchId) || 0'],
    [orderServicePath, orderServiceSource, 'reservedQuantityByBatchId.get(batchId) || 0'],
    [orderServicePath, orderServiceSource, 'reservedQuantityByBatchId.get(row.batchId) || 0'],
    [orderServicePath, orderServiceSource, 'Number(selection.quantity || 0)'],
    [orderServicePath, orderServiceSource, 'current?.quantity || 0'],
    [orderServicePath, orderServiceSource, 'Number(row.quantity || 0)'],
    [orderServicePath, orderServiceSource, 'Number(batch.reservedByOtherOrders || 0)'],
    [orderServicePath, orderServiceSource, 'selectedQuantityMap.get(candidate.id) || 0']
  ];
  for (const [projectPath, projectSource, snippet] of stockSourceUtilityZeroFallbacks) {
    if (projectSource.includes(snippet)) {
      addFailure(`${projectPath} must use ?? for stock-source quantity fallback so a valid 0 is not treated as missing: ${snippet}`);
    }
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
  if (!source.includes('零件编码不同，属于替代库存')) {
    addFailure('stockSourceReview.ts must describe replacement stock mismatches as 零件编码不同.');
  }
  if (!/class\s+StockSourceSelectionDto[\s\S]*@Min\(0\.001\)[\s\S]*quantity!:\s*number;/.test(orderDtoSource)) {
    addFailure('StockSourceSelectionDto.quantity must require @Min(0.001) so UI queue placeholders cannot be submitted as real stock sources.');
  }
  if (!/private\s+normalizeStockSourceSelections\s*\([^)]*\)\s*{[\s\S]*const\s+quantity\s*=\s*this\.roundQuantity\(Number\(selection\.quantity\s*\?\?\s*0\)\)[\s\S]*if\s*\(!batchId\s*\|\|\s*quantity\s*<=\s*0\)\s*{[\s\S]*continue;[\s\S]*}/.test(orderServiceSource)) {
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
    'const orderPreviewRequestSeq = ref(0)',
    '库存查询失败，请确认零件关键字和后端服务',
    '订单信息查询失败，请确认订单号和后端服务',
    'for (const source of props.draftReservedSources || [])',
    'const adjustedSourceRows = computed<SourceRow[]>(() =>',
    'const backendAvailableQuantity = row.quantity',
    'const draftReservedQuantity = draftReservedQuantityByBatchId.value.get(row.id) ?? 0',
    'quantity: Math.max(Math.round((backendAvailableQuantity - draftReservedQuantity + Number.EPSILON) * 1000) / 1000, 0)',
    'reservedQuantity: Number(row.reservedQuantity ?? 0) + draftReservedQuantity',
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
    'sources.reduce((sum, source) => sum + Number(source.quantity ?? 0), 0)',
    'function shouldRefillSelectedSourceQueue(sources: StockSourceSelectionPayload[], explicitRefill?: boolean)',
    'const nextQueueQuantity = sources.reduce((sum, source) => sum + Number(source.quantity ?? 0), 0)',
    'const queueAlreadyCoveredNeed = Math.max(selectedQuantityTotal.value, nextQueueQuantity) >= requiredQuantity.value - 0.0001',
    'const hasQueuePlaceholder = sources.some((source) => Number(source.quantity ?? 0) <= 0)',
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
    'selectedSourceRows.value.filter((source) => Number(source.quantity ?? 0) > 0 && sourceNeedsManualConfirmation(source))',
    'selectedSourceRows.value.find((source) => Number(source.quantity ?? 0) > 0 && !source.compatibilityStatus)',
    'rebalanceSelectedSourceQueue(rows, {',
    'excludedBatchIds: new Set([batchId])',
    'removeSelectedSource(row.id);',
    'distributeByQueue: true',
    'selectedSourceRows.value.filter((source) => Number(source.quantity ?? 0) > 0 && sourceNeedsManualConfirmation(source))',
    'function autoSelectSources()',
    'function bulkSelectSourcesByQuantity()',
    'function rebalanceCurrentSelectedSourcesByQueue()',
    '@click="rebalanceCurrentSelectedSourcesByQueue"',
    'function moveSelectedSource',
    '拖动左侧手柄调整扣库顺序；提交生产会按当前顺序消耗库存',
    '跨零件搜索后选中的批次',
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
  const dialogZeroFallbackSnippets = [
    'Number(source.quantity || 0)',
    'Number(row.reservedQuantity || 0)',
    'Number(expected.value?.requiredQuantity || 0)',
    'Number(row.partThickness || 0)',
    'selectedSourceMap.value.get(row.id)?.quantity || 0',
    "find((source) => source.batchId === batchId)?.quantity || 0",
    'Number(value || 0)',
    'Number(options.lockQuantity || 0)',
    'Number(requestedQuantity || 0)',
    'current?.quantity || 0',
    'Number((row as SourceRow).draftReservedQuantity || 0)'
  ];
  for (const snippet of dialogZeroFallbackSnippets) {
    if (dialogSource.includes(snippet)) {
      addFailure(`InventorySourceDetailsDialog.vue must preserve zero stock source quantities with ?? fallback, found: ${snippet}`);
    }
  }
  if (!readFile('AGENTS.md').includes('操作人员可以拖拽调整已选库存使用顺序')) {
    addFailure('AGENTS.md must document that selected stock source order supports drag sorting.');
  }

  const editorSnippets = [
    ':draft-reserved-sources="otherLineSelectedStockSources"',
    'const sourceDetailsRequestSeq = ref(0)',
    '库存来源查询失败，请确认零件和后端服务',
    'customerId: props.customerId',
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
  const verifierSource = readFile('database/prisma/verify-first-stage.ts');
  const migrationSqlSource = readMigrationSqlSource();
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
  if (!/const\s+candidateBatches\s*=\s*hasManualSelections\s*\?[\s\S]*sortedStockBatches\.map\(\(batch\)\s*=>\s*\(\{[\s\S]*selectedQuantity:\s*selectedSourceMap\.get\(batch\.id\)\?\.quantity\s*\?\?\s*0/.test(source)) {
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

  const reservationMigrationSnippets = [
    'InventoryReservation_quantity_positive',
    'InventoryReservation_identity_not_blank',
    'InventoryReservation_status_time_consistent'
  ];
  for (const snippet of reservationMigrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep inventory reservation database guard snippet: ${snippet}`);
    }
  }
  const reservationVerifierSnippets = [
    'RESERVATION_IDENTITY_MISSING',
    'CONSUMED_RESERVATION_HAS_RELEASE_TIME',
    'RELEASED_RESERVATION_HAS_CONSUMED_TIME'
  ];
  for (const snippet of reservationVerifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep inventory reservation verification snippet: ${snippet}`);
    }
  }
}

function verifyInventorySourcePriority() {
  const servicePath = 'backend/src/modules/inventory/inventory.service.ts';
  const dtoPath = 'backend/src/modules/inventory/dto.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const editorPath = 'frontend/src/components/OrderLineEditor.vue';
  for (const projectPath of [servicePath, dtoPath, apiPath, editorPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing inventory source priority file: ${projectPath}`);
      return;
    }
  }

  const source = readFile(servicePath);
  const dtoSource = readFile(dtoPath);
  const apiSource = readFile(apiPath);
  const editorSource = readFile(editorPath);
  if (!/class\s+InventorySourceDetailQueryDto[\s\S]*customerId\?:\s*string/.test(dtoSource)) {
    addFailure('InventorySourceDetailQueryDto must accept customerId for stock source context.');
  }
  if (!/interface\s+InventorySourceDetailFilters[\s\S]*customerId\?:\s*string/.test(apiSource) || !apiSource.includes('customerId: filters.customerId')) {
    addFailure('erpApi.inventoryMaterialSourceDetails must send customerId to source-details.');
  }
  if (!editorSource.includes('customerId: props.customerId')) {
    addFailure('OrderLineEditor.vue must pass current customerId into inventory source-details.');
    return;
  }
  if (!source.includes('resolveStockReservationPriorityOrder') || !source.includes('stockReservationConsumesAvailability')) {
    addFailure('InventoryService must calculate stock source available quantity by current draft order priority.');
  }
  if (!source.includes('inventoryBatchMatchesCustomerScope') || !source.includes('不过滤全局备货，避免新客户无法使用可用库存')) {
    addFailure('InventoryService source-details must prioritize current-customer stock source batches without hiding global backup stock.');
  }
  if (!source.includes('Material 搜索记忆再次过滤')) {
    addFailure('InventoryService source-details must describe Material filtering as search memory, not master-data stock quantity.');
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
    "targetStatus?: 'SCRAPPED'",
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
    "const targetStatus = dto.targetStatus",
    '报废或销毁清零后数量必须为 0',
    'tx.inventoryAdjustment.create',
    'tx.inventoryBatch.update',
    "status: targetStatus === 'SCRAPPED' ? 'SCRAPPED' : afterQuantity > 0 ? 'AVAILABLE' : 'USED'",
    'tx.inventoryTransaction.create',
    "transactionType: deltaQuantity > 0 ? 'IN' : 'OUT'",
    "sourceRecordType: 'InventoryAdjustment'",
    'sourceRecordId: adjustment.id',
    "import { businessDateTimeKey } from '../../common/business-date';",
    'const stamp = businessDateTimeKey();',
    'IT-ADJ-${stamp}',
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
  if (serviceSource.includes('IT-ADJ-${Date.now()}')) {
    addFailure('InventoryService inventory adjustment transactionNo must use businessDateTimeKey instead of Date.now().');
  }

  const apiSource = readFile(apiPath);
  const apiSnippets = [
    'export interface AdjustInventoryBatchPayload',
    "targetStatus?: 'SCRAPPED'",
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
    ':close-on-press-escape="!adjustSaving"',
    ':before-close="handleAdjustDialogBeforeClose"',
    'adjustmentReservedQuantity',
    "targetStatus: undefined as 'SCRAPPED' | undefined",
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
    'function closeAdjustDialog()',
    '库存盘点正在保存，请等待保存完成',
    'async function submitAdjustment()',
    '请填写清点人',
    '请填写签字人',
    '请上传盘点工单、照片或 PDF 附件',
    '盘点后数量不能低于已预占数量',
    "adjustForm.targetStatus = 'SCRAPPED'",
    '报废或销毁清零后数量必须为 0',
    'const attachment = await erpApi.uploadInventoryAdjustmentFile(adjustmentFile.value)',
    'await erpApi.adjustInventoryBatch(selectedBatch.value.id',
    'targetStatus: adjustForm.targetStatus',
    'attachmentFileUrl: attachment?.fileUrl',
    'await loadInventory()'
  ];
  for (const snippet of viewSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`InventoryView.vue must keep inventory adjustment dialog/upload snippet: ${snippet}`);
    }
  }

  const verifierSource = readFile(verifierPath);
  const migrationSqlSource = readMigrationSqlSource();
  const verifierSnippets = [
    'await checkInventoryAdjustments()',
    'async function checkInventoryAdjustments()',
    'prisma.inventoryAdjustment.findMany',
    "where: { sourceRecordType: 'InventoryAdjustment', sourceRecordId: { in: adjustmentIds } }",
    'INVENTORY_ADJUSTMENT_NEGATIVE_QUANTITY',
    'INVENTORY_ADJUSTMENT_DELTA_MISMATCH',
    'INVENTORY_ADJUSTMENT_TRANSACTION_MISSING',
    'INVENTORY_ADJUSTMENT_TRANSACTION_MISMATCH',
    'INVENTORY_ADJUSTMENT_ZERO_DELTA_HAS_TRANSACTION',
    'INVENTORY_ADJUSTMENT_SIGN_MISSING',
    'INVENTORY_ADJUSTMENT_ATTACHMENT_MISSING',
    'INVENTORY_ADJUSTMENT_ATTACHMENT_SIZE_INVALID',
    'INVENTORY_ADJUSTMENT_ATTACHMENT_FILE_MISSING',
    "const inventoryAdjustmentPrefix = '/uploads/inventory-adjustments/'",
    "resolve(uploadRoot, 'inventory-adjustments', storedFileName)"
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep inventory adjustment data verification snippet: ${snippet}`);
    }
  }
  const migrationSnippets = [
    'InventoryAdjustment_quantities_valid',
    '"deltaQuantity" = "afterQuantity" - "beforeQuantity"',
    'InventoryAdjustment_identity_not_blank',
    'InventoryAdjustment_attachment_required'
  ];
  for (const snippet of migrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep inventory adjustment database guard snippet: ${snippet}`);
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
  if (
    !source.includes('findProcessDefinitionReferences') ||
    !source.includes('orderLineProcessStep.findMany') ||
    !source.includes('processTemplate.findMany') ||
    !source.includes('modelBomLine.findMany') ||
    !source.includes('materialTransformRule.findMany')
  ) {
    addFailure('ProcessDefinitionsService must check order process, process template, BOM, and transform-rule references before disabling or renaming a process definition.');
  }
  if (!source.includes('processSnapshotToDetails') || !source.includes("action: '停用' | '改名'") || !source.includes('不能${action}')) {
    addFailure('ProcessDefinitionsService must parse process template steps and reject disabling or renaming referenced process definitions with a clear message.');
  }
  const processReferenceSnippets = [
    'splitDefaultProcessRoute',
    '.split(/(?:->|→|[、,，;；\\n\\r]+)/)',
    '来源加工关系 ${rule.sourceMaterial.partCode} -> ${rule.targetMaterial.partCode}',
    '订单流程、流程记忆、BOM 或来源加工关系'
  ];
  for (const snippet of processReferenceSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`ProcessDefinitionsService must keep default-process reference guard snippet: ${snippet}`);
    }
  }
  const processStatusBoundarySnippets = [
    '同名停用工序必须走 restore',
    '已停用，请在状态筛选中查看停用工序并恢复启用',
    'dto.status !== undefined',
    '标准工序状态变更必须走 delete / restore',
    '标准工序状态请使用专用启用/停用接口',
    'existing.status !== CommonStatus.ENABLED',
    '已停用的标准工序需先恢复启用后再编辑'
  ];
  for (const snippet of processStatusBoundarySnippets) {
    if (!source.includes(snippet)) {
      addFailure(`ProcessDefinitionsService must keep dedicated process-definition status boundary snippet: ${snippet}`);
    }
  }
  const processDuplicateGuardSnippets = ['const normalizedRows = processNames', 'seenKeys.has(row.key)', '请把次数或参数写入工序备注'];
  for (const snippet of processDuplicateGuardSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`ProcessDefinitionsService.ensureActiveNames must reject duplicate process names: ${snippet}`);
    }
  }
  if (!/async\s+update\s*\([^)]*\)\s*{[\s\S]*findProcessDefinitionReferences\(existing\.processNameNormalized\)[\s\S]*referencedProcessDefinitionError/.test(source)) {
    addFailure('ProcessDefinitionsService.update must reject renaming referenced process definitions.');
  }
  if (!/async\s+delete\s*\([^)]*\)\s*{[\s\S]*findProcessDefinitionReferences\(existing\.processNameNormalized\)[\s\S]*referencedProcessDefinitionError/.test(source)) {
    addFailure('ProcessDefinitionsService.delete must reject disabling referenced process definitions.');
  }
  if (!source.includes('data: { status: CommonStatus.DISABLED }') || source.includes('prisma.processDefinition.delete')) {
    addFailure('ProcessDefinitionsService.delete must soft-disable unused process definitions instead of physically deleting them.');
  }
  if (!source.includes('async restore(id: string)') || !source.includes('恢复标准工序只恢复后续下拉可选')) {
    addFailure('ProcessDefinitionsService.restore must explicitly restore disabled process definitions without mutating historical orders, BOM, or transform rules.');
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
  const migrationSqlSource = readMigrationSqlSource();
  const repairSnippets = [
    'collectMissingProcessDefinitionRepairs',
    'printMissingProcessDefinitionRepairs',
    '标准工序补录',
    'prisma.processDefinition.findMany',
    'prisma.processTemplate.findMany',
    'prisma.orderLineProcessStep.findMany',
    'prisma.modelBomLine.findMany',
    'prisma.materialTransformRule.findMany',
    'splitDefaultProcessRoute',
    '来源加工关系 ${rule.sourceMaterial.partCode} -> ${rule.targetMaterial.partCode}',
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
    'ORDER_LINE_PROCESS_STEP_DUPLICATE',
    'ORDER_LINE_PROCESS_DEFINITION_MISSING',
    'MODEL_BOM_DEFAULT_PROCESS_DUPLICATE',
    'MODEL_BOM_DEFAULT_PROCESS_DEFINITION_MISSING',
    'MATERIAL_TRANSFORM_DEFAULT_PROCESS_DUPLICATE',
    'MATERIAL_TRANSFORM_DEFAULT_PROCESS_DEFINITION_MISSING',
    'PRODUCTION_TASK_PROCESS_STEP_DUPLICATE',
    'PRODUCTION_TASK_PROCESS_DEFINITION_MISSING',
    'prisma.modelBomLine.findMany',
    'prisma.materialTransformRule.findMany',
    'splitDefaultProcessRoute',
    '没有对应的启用标准工序'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep missing process definition verification snippet: ${snippet}`);
    }
  }
  const processStepUniqueIndexSnippets = [
    'OrderLineProcessStep_orderLineId_processName_lower_key',
    'ON "OrderLineProcessStep"("orderLineId", LOWER("processName"))',
    'ProductionProcessCompletion_productionTaskId_processName_lower_key',
    'ON "ProductionProcessCompletion"("productionTaskId", LOWER("processName"))',
    'OrderLineProcessStep_stepNo_positive',
    'OrderLineProcessStep_processName_not_blank',
    'ProductionProcessCompletion_stepNo_positive',
    'ProductionProcessCompletion_processName_not_blank',
    'ProductionProcessCompletion_quantities_non_negative',
    'ProductionProcessCompletion_completed_quantity_positive'
  ];
  for (const snippet of processStepUniqueIndexSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep process-step duplicate guard index snippet: ${snippet}`);
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
  if (!source.includes('collectComponentStructureBlocks') || !source.includes('printComponentStructureBlocks')) {
    addFailure('repair-first-stage.ts must report component parent-child structure blocks before write mode.');
  }
  if (
    !source.includes('collectModelBomComponentThicknessRepairs') ||
    !source.includes('printModelBomComponentThicknessRepairs') ||
    !source.includes('BOM 父级组件厚度快照') ||
    !source.includes('data: { partThicknessSnapshot: null }')
  ) {
    addFailure('repair-first-stage.ts must clean stale ModelBom component thickness snapshots without touching orders, production or inventory.');
  }
  if (
    !source.includes('collectWarehouseLocationStatusRepairs') ||
    !source.includes('printWarehouseLocationStatusRepairs') ||
    !source.includes('warehouse: { status: CommonStatus.DISABLED }') ||
    !source.includes('tx.warehouseLocation.update') ||
    !source.includes('data: { status: CommonStatus.DISABLED }')
  ) {
    addFailure('repair-first-stage.ts must repair enabled locations under disabled warehouses without touching inventory history.');
  }
  if (
    !source.includes('collectModelBomScopeBlocks') ||
    !source.includes('printModelBomScopeBlocks') ||
    !source.includes('ModelBomScopeBlock') ||
    !source.includes('BOM 范围重复')
  ) {
    addFailure('repair-first-stage.ts must report and block duplicate ModelBom customer/project scopes before migration or write mode.');
  }
  if (
    !source.includes('collectModelBomComponentStructureBlocks') ||
    !source.includes('collectOrderLineComponentStructureBlocks') ||
    !source.includes('collectCommittedImportComponentStructureBlocks')
  ) {
    addFailure('repair-first-stage.ts must block BOM, order line, and committed import component structure issues.');
  }
  if (!source.includes('componentLineBlockedReasons') || !source.includes('isComponentNoRangeInvalid')) {
    addFailure('repair-first-stage.ts must reuse component structure range and blocking helpers.');
  }
  if (!source.includes('overrideRepairReason') || !source.includes('isSubmitPlanOperatorRole')) {
    addFailure('repair-first-stage.ts must repair invalid production plan override operator snapshots and roles.');
  }
  const blockedPreflightPattern =
    /assertNoBlockedRepairs\s*\(\s*stockSourceReviewStatusRepairs\s*,\s*draftReservationSyncRepairs\s*,\s*consumedReservationRepairs\s*,\s*stockAllocationRepairs\s*,\s*componentStructureBlocks\s*,\s*modelBomScopeBlocks\s*\)/;
  if (!blockedPreflightPattern.test(source)) {
    addFailure('repair-first-stage.ts write mode must run a full blocked-repair preflight before any repair write.');
  }
  const preflightIndex = source.search(blockedPreflightPattern);
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
  const migrationSqlSource = readMigrationSqlSource();
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
  const orderVerifierSnippets = [
    'CUSTOMER_ORDER_IDENTITY_MISSING',
    'CUSTOMER_ORDER_SNAPSHOT_INVALID',
    'ORDER_LINE_IDENTITY_MISSING',
    'ORDER_LINE_QUANTITY_INVALID',
    'ORDER_LINE_PART_THICKNESS_MISSING',
    'isImportDraftMissingThickness',
    'ORDER_LINE_OPTIONAL_TEXT_BLANK'
  ];
  for (const snippet of orderVerifierSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep order core data verification snippet: ${snippet}`);
    }
  }
  const orderMigrationSnippets = [
    'CustomerOrder_identity_not_blank',
    'CustomerOrder_order_no_normalized',
    'CustomerOrder_customer_snapshot_shape',
    'OrderLine_required_text_not_blank',
    'OrderLine_quantities_valid',
    'OrderLine_optional_text_not_blank',
    'OrderLine_component_shape_valid',
    "!~ '^C[0-9]+$'",
    '缺厚度零件允许先保存为 0 待人工核对'
  ];
  for (const snippet of orderMigrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep order core database guard snippet: ${snippet}`);
    }
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
  const dataVerifierPath = 'database/prisma/verify-first-stage.ts';
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
  const apiAggregateRegressionScriptPath = 'scripts/verify-first-stage-api.cjs';

  for (const projectPath of [
    servicePath,
    controllerPath,
    dtoPath,
    schemaPath,
    dataVerifierPath,
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
    workbookRegressionScriptPath,
    apiAggregateRegressionScriptPath
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
  const dataVerifierSource = readFile(dataVerifierPath);
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
  const apiAggregateRegressionScriptSource = readFile(apiAggregateRegressionScriptPath);
  const migrationSqlSource = readMigrationSqlSource();

  const serviceSnippets = [
    "workbook.getWorksheet('ERP上传净表')",
    'Excel 文件必须包含名为 ERP上传净表 的工作表',
    'ERP上传净表必须连续填写',
    'ERP上传净表不允许包含订单头行',
    "const lineType = parsedLineType || 'PART'",
    "partThickness: lineType === 'COMPONENT' ? 0 : partThickness && partThickness > 0 ? partThickness : 0",
    "partThickness: row.lineType === 'COMPONENT' ? 0 : partThickness > 0 ? partThickness : 0",
    'allowMissingThickness?: boolean',
    'this.validateOrderLines(lines, { requireStockSources: false, allowMissingThickness: true })',
    '!allowMissingThickness',
    '厚度为空，导入草稿保留为待核对，请在 ERP 中补齐后再提交生产',
    "const isComponentLine = row.lineType === 'COMPONENT'",
    '!hasThickness && !isOutsourcedPart && !isComponentLine',
    'this.applyOrderImportAutomaticFields(rows)',
    'normalizeImportRowsForSessionPreview',
    'lineType: row.lineType',
    'componentNo: row.componentNo || undefined',
    'parentComponentNo: row.parentComponentNo || undefined',
    'normalizeEditableOrderLineComponentFields',
    "partThickness: lineType === 'COMPONENT' ? 0 : line.partThickness",
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
    '订单导入会话正在被其他操作修改，请刷新后重新放弃或删除记忆',
    '订单导入会话正在被其他操作修改，请刷新后重新删除文件',
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
  if (!serviceSource.includes('零件编码不能为空（Excel 物料号列）')) {
    addFailure('Order import preview issues must use 零件编码 wording while pointing back to the Excel 物料号 column.');
  }
  if (serviceSource.includes("message: '物料号不能为空'")) {
    addFailure('Order import preview issues must not show stale UI wording: 物料号不能为空.');
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
    'sourceImportFile                OrderImportFile?         @relation("OrderLineSourceImportFile"',
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

  const dataVerifierSnippets = [
    'await checkOrderImportData();',
    'async function checkOrderImportData()',
    'ORDER_IMPORT_SESSION_STATUS_INVALID',
    'ORDER_IMPORT_DRAFT_COMMIT_FIELDS_STALE',
    'ORDER_IMPORT_FILE_COUNT_MISMATCH',
    'ORDER_IMPORT_FILE_ACCEPTED_ROW_COUNT_MISMATCH',
    'ORDER_IMPORT_ROW_QUANTITY_INVALID',
    'ORDER_IMPORT_ROW_ISSUE_COUNT_MISMATCH',
    'ORDER_IMPORT_CLEAN_COMPONENT_SHAPE_INVALID'
  ];
  for (const snippet of dataVerifierSnippets) {
    if (!dataVerifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep Excel import data verification snippet: ${snippet}`);
    }
  }

  const orderImportDatabaseSnippets = [
    'OrderImportSession_status_valid',
    'OrderImportSession_commit_fields_valid',
    'OrderImportFile_identity_not_blank',
    'OrderImportFile_counts_valid',
    'OrderImportRow_identity_not_blank',
    'OrderImportRow_line_type_valid',
    'OrderImportRow_quantities_valid',
    'OrderImportRow_json_shape_valid',
    'OrderImportRow_clean_required_fields',
    'OrderImportRow_clean_component_shape'
  ];
  for (const snippet of orderImportDatabaseSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Order import database guards must keep migration snippet: ${snippet}`);
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
    '只会补建缺失的零件搜索记忆',
    '不覆盖已存在或已停用零件搜索记忆',
    '不会创建客户 BOM、全局适用范围或库存数量',
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
    'orderConfirmDialogVisible',
    'openOrderConfirmDialog',
    'handleOrderConfirmDialogClose',
    'class="order-confirm-panel"',
    '导入警告复核',
    'visibleSelectableCovered',
    'useAllSelectableCommit ? [] : orderNos',
    'useAllSelectableCommit ? excludedOrderNos : []',
    '未创建 ${result.skippedSelectableCount} 个可导入订单',
    'result.materialSyncCount',
    'result.materialSyncPreview',
    'importPreview.summary.materialSyncCount',
    'importPreview.summary.materialSyncPreview',
    '涉及零件编码',
    'session.materialSyncCount',
    'session.materialSyncPreview',
    'materialSyncPreviewSuffix',
    '仅补建缺失的零件搜索记忆',
    '已有零件搜索记忆不会被订单覆盖',
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
    'selectableOrderCount || 0) > 1000',
    '只会补建缺失的 Material 基础资料',
    '已有基础资料不会被订单覆盖',
    '已有 Material 不会被订单覆盖'
  ];
  for (const snippet of forbiddenFrontendSnippets) {
    if (ordersViewSource.includes(snippet)) {
      addFailure(`Frontend must not add stale or misleading Excel import wording: ${snippet}`);
    }
  }
  if (ordersViewSource.includes('label="物料号"') || orderDetailSource.includes('label="物料号"')) {
    addFailure('Order import/source preview tables must show 零件编码 instead of 物料号 in the UI; keep 物料号 only for Excel source/export fields.');
  }
  if (ordersViewSource.includes('ElMessageBox.confirm')) {
    addFailure('OrdersListView.vue order and import key operations must use el-dialog instead of ElMessageBox.confirm.');
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
    '缺失零件搜索记忆补建',
    '涉及零件编码',
    '前 5 个零件编码示例',
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
  if (!packageSource.includes('"verify:prisma-client-enums": "node scripts/verify-prisma-client-enums.cjs"')) {
    addFailure('package.json must expose verify:prisma-client-enums to catch stale generated Prisma Client enum values.');
  }
  if (!packageSource.includes('"verify:first-stage:api": "node scripts/verify-first-stage-api.cjs"')) {
    addFailure('package.json must expose verify:first-stage:api for self-contained first-stage API regression checks.');
  }
  if (
    !packageSource.includes(
      'npm run verify:file-name-normalizers && npm run verify:prisma-client-enums && npm run verify:order-import-workbooks && npm run backend:verify:first-stage'
    )
  ) {
    addFailure('verify:first-stage must check generated Prisma Client enums and workbook artifacts before backend/frontend builds.');
  }
  if (!packageSource.includes('npm run backend:build && npm run verify:first-stage:api && npm run frontend:build')) {
    addFailure('verify:first-stage:strict must include self-contained API regressions after backend build and before frontend build.');
  }

  const apiAggregateRegressionSnippets = [
    'FIRST_STAGE_API_BASE_URL',
    'FIRST_STAGE_API_PORT',
    'verify:material-import-api',
    'verify:order-import-api',
    'verify:production-notices-api',
    'verify:upload-filenames-api',
    "ORDER_IMPORT_API_BASE_URL: apiBaseUrl",
    "MATERIAL_IMPORT_API_BASE_URL: apiBaseUrl",
    "NOTICE_API_BASE_URL: apiBaseUrl",
    "await runCommand(['run', 'backend:build'])",
    "spawn(command.file, command.args",
    "spawnSync('taskkill'",
    'await waitForHealth(backend.output)'
  ];
  for (const snippet of apiAggregateRegressionSnippets) {
    if (!apiAggregateRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-first-stage-api.cjs must keep self-contained API regression snippet: ${snippet}`);
    }
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
    'historySession.materialSyncCount === 6',
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
    'upload.summary.materialSyncCount === 6',
    'upload.summary.materialSyncPreview?.includes',
    '订单导入父级组件行厚度必须按不适用处理为 0',
    'THICKNESS_DEFAULTED',
    '订单导入父级组件行不应产生 THICKNESS_DEFAULTED 厚度待核对警告',
    'assertImportMissingThicknessDraftRequiresReview',
    '缺厚度订单应允许导入草稿',
    '缺厚度草稿提交生产必须被厚度校验拦截',
    '厚度必须大于 0',
    'commit.skippedBlockedCount === 1',
    'commit.committedOrderNos',
    'materialSyncCount',
    'materialSyncPreview',
    'commit.materialSyncCount === 6',
    'commit.materialSyncPreview?.includes',
    'committedImportSession.summary.committedOrderCount === 4',
    '导入订单组件行厚度必须保存为 0',
    'assertImportedMaterialsUpserted',
    'Imported order lines must be upserted into Material library',
    'Blocked import rows must not be upserted into Material library',
    "material.status === 'ENABLED'",
    'assertOrderImportDoesNotOverwriteExistingMaterial',
    "material?.status === 'DISABLED'",
    '订单导入不得覆盖已有 Material',
    '订单导入不得把已停用 Material 自动恢复启用',
    '订单行应保留导入快照 partName',
    'renamedImportSession.currentCommittedOrderNos.includes(editableOrderNo)',
    'afterDeleteImportSession.summary.currentCommittedOrderCount === 3',
    'assertSubmitRejectsUnconfirmedMaterialIdentityConflict',
    'materialIdentityConfirmed: true',
    '发现同编码多套历史资料零件，提交生产前必须确认已核对',
    'assertSubmitReturnsPendingProductionStatus',
    'deleteSubmittedOrderStatusRegressionData',
    "submittedOrder.status === 'PENDING_PRODUCTION'",
    '订单提交生产后必须返回 PENDING_PRODUCTION',
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
  const forbiddenRegressionScriptSnippets = [
    '预计同步物料',
    '同步物料',
    '物料基础资料',
    '物料示例',
    '涉及物料号'
  ];
  for (const snippet of forbiddenRegressionScriptSnippets) {
    if (regressionScriptSource.includes(snippet)) {
      addFailure(`verify-order-import-api.cjs must use 零件搜索记忆 wording instead of stale import wording: ${snippet}`);
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

function verifyMaterialStockAlertWorkflow() {
  const schemaPath = 'database/prisma/schema.prisma';
  const dtoPath = 'backend/src/modules/inventory/dto.ts';
  const servicePath = 'backend/src/modules/inventory/inventory.service.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const typesPath = 'frontend/src/types/erp.ts';
  const inventoryViewPath = 'frontend/src/views/InventoryView.vue';
  const materialsViewPath = 'frontend/src/views/MaterialsView.vue';
  const dashboardViewPath = 'frontend/src/views/MaterialsManagementView.vue';
  const dataVerifierPath = 'database/prisma/verify-first-stage.ts';
  const seedPath = 'database/prisma/seed.ts';

  for (const projectPath of [
    schemaPath,
    dtoPath,
    servicePath,
    apiPath,
    typesPath,
    inventoryViewPath,
    materialsViewPath,
    dashboardViewPath,
    dataVerifierPath,
    seedPath
  ]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing material stock alert source file: ${projectPath}`);
      return;
    }
  }

  const schemaSource = readFile(schemaPath);
  const dtoSource = readFile(dtoPath);
  const serviceSource = readFile(servicePath);
  const apiSource = readFile(apiPath);
  const typesSource = readFile(typesPath);
  const inventoryViewSource = readFile(inventoryViewPath);
  const materialsViewSource = readFile(materialsViewPath);
  const dashboardViewSource = readFile(dashboardViewPath);
  const dataVerifierSource = readFile(dataVerifierPath);
  const seedSource = readFile(seedPath);
  const migrationSqlSource = readMigrationSqlSource();

  const requiredSnippets = [
    [schemaPath, schemaSource, 'stockAlertEnabled    Boolean'],
    [schemaPath, schemaSource, 'stockAlertQuantity Decimal?'],
    [schemaPath, schemaSource, 'stockAlertEnabled  Boolean?'],
    [dtoPath, dtoSource, "export const stockAlertFilterValues = ['ALL', 'ENABLED', 'TRIGGERED', 'DISABLED'] as const"],
    [dtoPath, dtoSource, 'stockAlert?: StockAlertFilter'],
    [servicePath, serviceSource, 'private normalizeStockAlertQuantity(value: unknown)'],
    [servicePath, serviceSource, '启用库存报警时必须填写最小库存数量'],
    [servicePath, serviceSource, '库存报警筛选必须覆盖没有库存批次的零件'],
    [servicePath, serviceSource, '库存报警导入只写 Material 基础资料提醒，不创建订单、生产任务或库存流水。'],
    [servicePath, serviceSource, 'parseMaterialImportBoolean'],
    [servicePath, serviceSource, 'DUPLICATE_STOCK_ALERT_CONFLICT'],
    [servicePath, serviceSource, 'STOCK_ALERT_QUANTITY_REQUIRED'],
    [servicePath, serviceSource, 'stockAlertTriggered: stockAlertEnabled && stockAlertQuantity !== null && row.availableQuantity <= stockAlertQuantity'],
    [apiPath, apiSource, 'export type StockAlertFilter'],
    [typesPath, typesSource, 'stockAlertTriggered: boolean'],
    [typesPath, typesSource, 'stockAlertEnabled?: boolean | null'],
    [typesPath, typesSource, 'stockAlertQuantity?: number | null'],
    [inventoryViewPath, inventoryViewSource, '低库存报警'],
    [inventoryViewPath, inventoryViewSource, '需要修改库存数量时，请到库存溯源里做盘点调整，系统会追加 InventoryTransaction。'],
    [materialsViewPath, materialsViewSource, '库存报警仅用于基础资料提醒和筛选，不会自动生成订单、生产任务或库存流水。'],
    [materialsViewPath, materialsViewSource, 'row.stockAlertEnabled === true'],
    [dashboardViewPath, dashboardViewSource, 'stockAlertCounts'],
    [dashboardViewPath, dashboardViewSource, '库存报警快捷筛选只切换列表视图，不自动补单、下单、提交生产或扣库存。'],
    [dataVerifierPath, dataVerifierSource, 'await checkMaterialMasterData();'],
    [dataVerifierPath, dataVerifierSource, 'async function checkMaterialMasterData()'],
    [dataVerifierPath, dataVerifierSource, 'MATERIAL_IDENTITY_MISSING'],
    [dataVerifierPath, dataVerifierSource, 'MATERIAL_APPLICABILITY_PROJECT_SCOPE_KEY_MISMATCH'],
    [dataVerifierPath, dataVerifierSource, 'MATERIAL_APPLICABILITY_ENABLED_MATERIAL_DISABLED'],
    [dataVerifierPath, dataVerifierSource, 'await checkMaterialStockAlerts();'],
    [dataVerifierPath, dataVerifierSource, 'async function checkMaterialStockAlerts()'],
    [dataVerifierPath, dataVerifierSource, 'MATERIAL_STOCK_ALERT_TRANSACTION_NOT_ALLOWED'],
    [dataVerifierPath, dataVerifierSource, 'MATERIAL_STOCK_ALERT_RESERVED_OVER_AVAILABLE'],
    [dataVerifierPath, dataVerifierSource, '库存报警只能提醒和筛选，不能生成 InventoryTransaction'],
    [seedPath, seedSource, 'const stockAlertFixtures = ['],
    [seedPath, seedSource, '库存报警 seed 只写 Material 基础资料的提醒线，不自动补单、下单、提交生产或扣库存。']
  ];

  for (const [projectPath, source, snippet] of requiredSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`${projectPath} must keep first-stage material stock alert snippet: ${snippet}`);
    }
  }
  const migrationSnippets = [
    'Material_identity_not_blank',
    'Material_optional_text_not_blank',
    'Material_stock_alert_valid',
    'MaterialApplicability_identity_not_blank',
    'MaterialApplicability_optional_text_not_blank',
    'MaterialApplicability_scope_keys_valid'
  ];
  for (const snippet of migrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep material master-data database guard snippet: ${snippet}`);
    }
  }
  if (!/stockAlertEnabled\s+Boolean\s+@default\(false\)/.test(schemaSource)) {
    addFailure('schema.prisma Material.stockAlertEnabled must default to false.');
  }
  if (!/stockAlertQuantity\s+Decimal\?\s+@db\.Decimal\(18,\s*3\)/.test(schemaSource)) {
    addFailure('schema.prisma Material.stockAlertQuantity must use Decimal(18, 3).');
  }
  const materialImportRowBlock = schemaSource.match(/model MaterialImportRow \{[\s\S]*?\n\}/);
  if (!materialImportRowBlock) {
    addFailure('schema.prisma must keep MaterialImportRow for material Excel import preview rows.');
  } else {
    if (!/stockAlertEnabled\s+Boolean\?/.test(materialImportRowBlock[0])) {
      addFailure('MaterialImportRow must store nullable stockAlertEnabled import preview value.');
    }
    if (!/stockAlertQuantity\s+Decimal\?\s+@db\.Decimal\(18,\s*3\)/.test(materialImportRowBlock[0])) {
      addFailure('MaterialImportRow.stockAlertQuantity must store Decimal(18, 3) import preview value.');
    }
  }

  const zeroInventoryAlertBlock = serviceSource.match(/private async findZeroInventoryMaterialRows\([\s\S]*?\n  private inventoryBatchSourceSearchValues/);
  if (!zeroInventoryAlertBlock) {
    addFailure('InventoryService must keep findZeroInventoryMaterialRows for zero-stock material search and stock alert rows.');
    return;
  }
  const forbiddenStockMutationSnippets = ['inventoryTransaction', 'inventoryBatch.create', 'inventoryBatch.upsert', 'productionTask.create', 'customerOrder.create'];
  for (const snippet of forbiddenStockMutationSnippets) {
    if (zeroInventoryAlertBlock[0].includes(snippet)) {
      addFailure(`findZeroInventoryMaterialRows must only return display rows and must not mutate stock/order/production data: ${snippet}`);
    }
  }
}

function verifyMaterialCommonProjectModelGuards() {
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  const servicePath = 'backend/src/modules/materials/materials.service.ts';
  if (!fileExists(verifierPath) || !fileExists(servicePath)) {
    addFailure('Missing material common project model guard source files.');
    return;
  }

  const verifierSource = readFile(verifierPath);
  const serviceSource = readFile(servicePath);
  const migrationSqlSource = readMigrationSqlSource();
  const verifierSnippets = [
    'await checkMaterialCommonProjectModels();',
    'async function checkMaterialCommonProjectModels()',
    'MATERIAL_COMMON_PROJECT_MODEL_EMPTY',
    'MATERIAL_COMMON_PROJECT_MODEL_KEY_STALE',
    'MATERIAL_COMMON_PROJECT_MODEL_SORT_INVALID',
    'MATERIAL_COMMON_PROJECT_MODEL_SORT_DUPLICATE',
    '常用机型只控制零件管理快捷入口顺序'
  ];
  for (const snippet of verifierSnippets) {
    if (!verifierSource.includes(snippet)) {
      addFailure(`verify-first-stage.ts must keep material common project model verification snippet: ${snippet}`);
    }
  }

  const migrationSnippets = [
    'MaterialCommonProjectModel_identity_not_blank',
    'MaterialCommonProjectModel_normalized_key_valid',
    'MaterialCommonProjectModel_sort_order_positive',
    'MaterialCommonProjectModel_enabled_sortOrder_key',
    'WHERE "status" = \'ENABLED\''
  ];
  for (const snippet of migrationSnippets) {
    if (!migrationSqlSource.includes(snippet)) {
      addFailure(`Prisma migrations must keep material common project model database guard snippet: ${snippet}`);
    }
  }

  const serviceSnippets = [
    'async saveCommonProjectModels',
    '只控制零件管理快捷入口',
    'await tx.materialCommonProjectModel.updateMany',
    'this.commonProjectModelKey(projectModel)',
    'projectModel.trim().toLocaleLowerCase(\'zh-CN\')'
  ];
  for (const snippet of serviceSnippets) {
    if (!serviceSource.includes(snippet)) {
      addFailure(`MaterialsService must keep common project model safety snippet: ${snippet}`);
    }
  }
  const dashboardSource = readFile('frontend/src/views/MaterialsManagementView.vue');
  if (/localStorage|commonProjectStorageKey|saveCommonProjectModelsToCache|本机缓存/.test(dashboardSource)) {
    addFailure('MaterialsManagementView.vue must not store common project model business configuration in browser localStorage.');
  }
}

function verifyRuntimeStorageIgnored() {
  const ignoreContracts = [
    { path: '.gitignore', label: 'Git ignore' },
    { path: '.dockerignore', label: 'Docker ignore' }
  ];

  for (const contract of ignoreContracts) {
    if (!fileExists(contract.path)) {
      addFailure(`Missing ${contract.path}; runtime uploads and exports must not be committed or packaged.`);
      continue;
    }
    const source = readFile(contract.path);
    if (!/(^|\r?\n)storage\/?(\r?\n|$)/.test(source)) {
      addFailure(`${contract.label} must ignore the storage runtime directory, including uploads, exports, logs and temp files.`);
    }
  }
}

verifyRequiredFiles();
verifyOrderStatusEnumContract();
verifyNoMojibakeInUserFacingSources();
verifyNavigation();
verifyResponsiveMobileBaseline();
verifyNoNativeBrowserDialogs();
verifyNoElementPlusConfirmDialogs();
verifyResponsiveElementPlusDialogs();
verifyElementPlusChineseLocale();
verifyCustomerSelectOnlyShowsName();
verifyCustomerContactSoftDisableWorkflow();
verifyOrderSelectDisplayContract();
verifyOrderFilterOrder();
verifyCaseInsensitiveBusinessKeyContracts();
verifyProductionTabOrder();
verifyProductionOrderSummaryWorkflow();
verifyProductionOperatorSearchWorkflow();
verifyPlannerProcessAndSubmitGuard();
verifyProcessPinyinSearchWorkflow();
verifyProcessMemoryCoreDataGuards();
verifyNoBusinessTextHardMaxLength();
verifyMaterialSuggestionSearchWorkflow();
verifyProcessEditDisabledReasonWorkflow();
verifyProcessStepDragSortWorkflow();
verifyPartComponentStructureWorkflow();
verifyMaterialImportIssueReportWorkflow();
verifyMobileCompactOrderCards();
verifyProductionProcessCompletionSequenceWorkflow();
verifyProductionReplenishmentAndWithdrawWorkflow();
verifyProductionTaskCancelledStatusWorkflow();
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
verifySharedDateFormattingContract();
verifyBackendBusinessDateKeyContract();
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
verifyMaterialCommonProjectModelGuards();
verifyMaterialStockAlertWorkflow();
verifyRuntimeStorageIgnored();

if (failures.length > 0) {
  console.error('First-stage source verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('First-stage source verification passed.');
