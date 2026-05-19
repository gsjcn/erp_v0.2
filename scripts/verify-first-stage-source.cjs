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

function verifyFrontendDoesNotExposeTestFixtureOptIn() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  const allowedFixtureOptInFiles = new Set(['frontend/src/api/erp.ts']);
  for (const filePath of walkFiles(frontendSourceDir)) {
    const projectPath = toProjectPath(filePath);
    if (allowedFixtureOptInFiles.has(projectPath)) {
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const match = source.match(/\bincludeTestFixtures\b/);
    if (match) {
      addFailure(
        `${projectPath}:${sourceLineForIndex(source, match.index)} must not expose includeTestFixtures in business UI code; reusable regression fixtures are opt-in for API helpers and scripts only.`
      );
    }
  }
}

function verifyTableHeightButtonsHaveTitles() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  const heightButtonPattern = /<el-button[\s\S]*?\/>/g;
  const heightLabelPattern = /aria-label="([^"]*高度[^"]*)"/;
  for (const filePath of walkFiles(frontendSourceDir).filter((target) => target.endsWith('.vue'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = heightButtonPattern.exec(source))) {
      const tag = match[0];
      const label = tag.match(heightLabelPattern)?.[1];
      if (label && !/\btitle=/.test(tag)) {
        addFailure(
          `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} height control button "${label}" must include title for hover explanation.`
        );
      }
    }
  }
}

function verifyNativeButtonsHaveAccessibleNames() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  const nativeButtonPattern = /<button\b[\s\S]*?>[\s\S]*?<\/button>/g;
  for (const filePath of walkFiles(frontendSourceDir).filter((target) => target.endsWith('.vue'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = nativeButtonPattern.exec(source))) {
      const buttonSource = match[0];
      if (/(?:^|\s|:)title\s*=|(?:^|\s|:)aria-label\s*=/.test(buttonSource)) {
        continue;
      }

      const innerSource = buttonSource.replace(/^[\s\S]*?>/, '').replace(/<\/button>$/, '');
      const visibleText = innerSource.replace(/<[^>]*>/g, '').replace(/{{[\s\S]*?}}/g, 'value').trim();
      const iconLike = /<(?:el-icon|Icon|svg)\b|(?:^|\s|:)icon\s*=/.test(buttonSource);
      if (visibleText.length > 0 && !iconLike) {
        continue;
      }

      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} native button must include title or aria-label when it has no plain visible text.`
      );
    }
  }
}

function verifyIconOnlyButtonsHaveAccessibleNames() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  const buttonPattern = /<el-button\b[\s\S]*?(?:\/>|>[\s\S]*?<\/el-button>)/g;
  for (const filePath of walkFiles(frontendSourceDir).filter((target) => target.endsWith('.vue'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = buttonPattern.exec(source))) {
      const buttonSource = match[0];
      if (!/(?:^|\s|:)icon\s*=/.test(buttonSource)) {
        continue;
      }
      if (/(?:^|\s|:)title\s*=|(?:^|\s|:)aria-label\s*=/.test(buttonSource)) {
        continue;
      }

      const innerSource = buttonSource.includes('</el-button>')
        ? buttonSource.replace(/^[\s\S]*?>/, '').replace(/<\/el-button>$/, '')
        : '';
      const visibleText = innerSource.replace(/<[^>]*>/g, '').replace(/{{[\s\S]*?}}/g, 'value').trim();
      if (visibleText.length > 0) {
        continue;
      }

      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} icon-only el-button must include title or aria-label.`
      );
    }
  }
}

function verifyRiskButtonsHaveTitles() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  const buttonPattern = /<el-button\b[\s\S]*?(?:\/>|>[\s\S]*?<\/el-button>)/g;
  for (const filePath of walkFiles(frontendSourceDir).filter((target) => target.endsWith('.vue'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = buttonPattern.exec(source))) {
      const buttonSource = match[0];
      if (!/\btype=(?:"danger"|'danger'|"warning"|'warning')/.test(buttonSource)) {
        continue;
      }
      if (/(?:^|\s|:)title\s*=/.test(buttonSource)) {
        continue;
      }

      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} danger/warning el-button must include title explaining the risky action.`
      );
    }
  }
}

function verifyImportantActionButtonsHaveAccessibleNames() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  const buttonPattern = /<el-button\b[\s\S]*?(?:\/>|>[\s\S]*?<\/el-button>)/g;
  const importantActionTextPattern =
    /(?:确认|提交|保存|创建|新建|导入|导出|带入|发货|入库|出库|开始|完成|启用|停用|删除|取消筛选常用|筛选设为常用)/;
  const actionTypePattern =
    /\btype=(?:"primary"|'primary'|"success"|'success'|"warning"|'warning'|"danger"|'danger')|(?::type|v-bind:type)=/;
  for (const filePath of walkFiles(frontendSourceDir).filter((target) => target.endsWith('.vue'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = buttonPattern.exec(source))) {
      const buttonSource = match[0];
      const hasClickHandler = /(?:@click|v-on:click)\s*=/.test(buttonSource);
      if (!hasClickHandler || !actionTypePattern.test(buttonSource)) {
        continue;
      }

      const innerSource = buttonSource.includes('</el-button>')
        ? buttonSource.replace(/^[\s\S]*?>/, '').replace(/<\/el-button>$/, '')
        : '';
      const visibleText = innerSource
        .replace(/<[^>]*>/g, '')
        .replace(/{{[\s\S]*?}}/g, 'value')
        .replace(/\s+/g, '');
      if (!importantActionTextPattern.test(visibleText)) {
        continue;
      }
      if (/(?:^|\s|:)title\s*=|(?:^|\s|:)aria-label\s*=/.test(buttonSource)) {
        continue;
      }

      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} important action el-button "${visibleText}" must include title or aria-label for clear hover/accessibility text.`
      );
    }
  }
}

function verifySecondaryActionButtonsHaveAccessibleNames() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  const buttonPattern = /<el-button\b[\s\S]*?(?:\/>|>[\s\S]*?<\/el-button>)/g;
  const secondaryActionTextPattern = /(?:查询|重置|刷新|导出|复制|查看固定格式|下载|上传|更多|继续加载|清空|返回|关闭)/;
  for (const filePath of walkFiles(frontendSourceDir).filter((target) => target.endsWith('.vue'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = buttonPattern.exec(source))) {
      const buttonSource = match[0];
      if (!/(?:@click|v-on:click)\s*=/.test(buttonSource) || /\blink\b/.test(buttonSource)) {
        continue;
      }

      const innerSource = buttonSource.includes('</el-button>')
        ? buttonSource.replace(/^[\s\S]*?>/, '').replace(/<\/el-button>$/, '')
        : '';
      const visibleText = innerSource
        .replace(/<[^>]*>/g, '')
        .replace(/{{[\s\S]*?}}/g, 'value')
        .replace(/\s+/g, '');
      if (!secondaryActionTextPattern.test(visibleText)) {
        continue;
      }
      if (/(?:^|\s|:)title\s*=|(?:^|\s|:)aria-label\s*=/.test(buttonSource)) {
        continue;
      }

      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} secondary action el-button "${visibleText}" must include title or aria-label for hover/accessibility text.`
      );
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
  const routerPath = 'frontend/src/router.ts';
  if (!fileExists(navPath)) {
    return;
  }

  const expectedEntries = [
    { label: '客户', path: '/customers' },
    { label: '零件管理', path: '/materials' },
    { label: '订单', path: '/orders' },
    { label: '生产流程', path: '/processes' },
    { label: '流程记忆', path: '/process-templates' },
    { label: '生产', path: '/production' },
    { label: '统计', path: '/statistics' },
    { label: '仓库', path: '/warehouses' },
    { label: '库存', path: '/inventory' }
  ];
  const source = readFile(navPath);
  const labels = [...source.matchAll(/label:\s*['"`]([^'"`]+)['"`]/g)].map((match) => match[1]);
  const paths = [...source.matchAll(/path:\s*['"`]([^'"`]+)['"`]/g)].map((match) => match[1]);

  if (labels.length !== expectedEntries.length) {
    addFailure(`Navigation should expose exactly ${expectedEntries.length} first-stage entries, found ${labels.length}.`);
    return;
  }

  if (paths.length !== expectedEntries.length) {
    addFailure(`Navigation should expose exactly ${expectedEntries.length} first-stage paths, found ${paths.length}.`);
    return;
  }

  for (let index = 0; index < expectedEntries.length; index += 1) {
    if (labels[index] !== expectedEntries[index].label) {
      addFailure(`Navigation entry ${index + 1} should be "${expectedEntries[index].label}", found "${labels[index]}".`);
    }
    if (paths[index] !== expectedEntries[index].path) {
      addFailure(`Navigation path ${index + 1} should be "${expectedEntries[index].path}", found "${paths[index]}".`);
    }
  }

  if (!fileExists(routerPath)) {
    addFailure(`Missing router source file: ${routerPath}`);
    return;
  }

  const routerSource = readFile(routerPath);
  const customerRouteIndex = routerSource.indexOf("path: '/customers'");
  const materialsRouteIndex = routerSource.indexOf("path: '/materials'");
  const ordersRouteIndex = routerSource.indexOf("path: '/orders'");
  if (customerRouteIndex < 0 || materialsRouteIndex < 0 || ordersRouteIndex < 0) {
    addFailure('router.ts must keep customer, material management and order routes.');
  } else if (!(customerRouteIndex < materialsRouteIndex && materialsRouteIndex < ordersRouteIndex)) {
    addFailure('router.ts must keep 零件管理 route between 客户 and 订单.');
  }
  if (!routerSource.includes("path: '/materials'") || !routerSource.includes("import('./views/MaterialsManagementView.vue')")) {
    addFailure('router.ts /materials must load MaterialsManagementView.vue for the part management control panel.');
  }

  const readmeSource = fileExists('README.md') ? readFile('README.md') : '';
  const readmeSnippets = [
    '客户、零件管理、订单',
    '第一阶段页面入口固定为 9 个',
    '- 零件管理',
    '用于检查第一阶段 9 个页面入口'
  ];
  for (const snippet of readmeSnippets) {
    if (!readmeSource.includes(snippet)) {
      addFailure(`README.md must document the current first-stage navigation entry: ${snippet}`);
    }
  }
}

function verifyNoForbiddenSecondStageEntrypoints() {
  const forbiddenModulePattern =
    /(quality|inspection|iatf|apqp|ppap|fmea|msa|spc|capa|finance|financial|purchase|procurement|supplier|approval|invoice|cost|report-center|cockpit|permission|rbac|role-management|scanner|barcode)/i;
  const forbiddenRouteSegmentPattern =
    /(^|\/)(quality|inspection|iatf|apqp|ppap|fmea|msa|spc|capa|finance|financial|purchase|procurement|supplier|approval|invoice|cost|report-center|cockpit|permission|rbac|role-management|scanner|barcode)(\/|$)/i;
  const forbiddenSchemaPattern =
    /^\s*(model|enum)\s+(Quality|Inspection|Iatf|Apqp|Ppap|Fmea|Msa|Spc|Capa|Finance|Financial|Purchase|Procurement|Supplier|Approval|Invoice|Cost|ReportCenter|Cockpit|Permission|Rbac|RoleManagement|Scanner|Barcode)\b/m;
  const forbiddenSqlObjectPattern =
    /^\s*(CREATE\s+(?:TABLE|TYPE|VIEW)|ALTER\s+TABLE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:"[^"]+"\.)?"(Quality|Inspection|Iatf|Apqp|Ppap|Fmea|Msa|Spc|Capa|Finance|Financial|Purchase|Procurement|Supplier|Approval|Invoice|Cost|ReportCenter|Cockpit|Permission|Rbac|RoleManagement|Scanner|Barcode)[^"]*"/gim;

  const routerPath = 'frontend/src/router.ts';
  if (fileExists(routerPath)) {
    const routerSource = readFile(routerPath);
    const routePathPattern = /path:\s*['"`]([^'"`]+)['"`]/g;
    for (const match of routerSource.matchAll(routePathPattern)) {
      const routePath = match[1];
      if (forbiddenRouteSegmentPattern.test(routePath)) {
        addFailure(`First-stage router must not expose forbidden next-stage route "${routePath}" in ${routerPath}.`);
      }
    }

    const routeImportPattern = /import\s*\(\s*['"`]\.\/views\/([^'"`]+)['"`]\s*\)/g;
    for (const match of routerSource.matchAll(routeImportPattern)) {
      const viewPath = match[1];
      if (forbiddenModulePattern.test(viewPath)) {
        addFailure(`First-stage router must not lazy-load forbidden next-stage view "${viewPath}" in ${routerPath}.`);
      }
    }
  }

  const frontendViewDir = resolveProjectPath('frontend/src/views');
  if (fs.existsSync(frontendViewDir)) {
    for (const filePath of walkFiles(frontendViewDir)) {
      const relativePath = toProjectPath(filePath);
      if (forbiddenModulePattern.test(path.basename(relativePath))) {
        addFailure(`First-stage frontend views must not add forbidden next-stage module file: ${relativePath}`);
      }
    }
  }

  const backendModulesDir = resolveProjectPath('backend/src/modules');
  if (fs.existsSync(backendModulesDir)) {
    for (const entry of fs.readdirSync(backendModulesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && forbiddenModulePattern.test(entry.name)) {
        addFailure(`First-stage backend modules must not add forbidden next-stage module directory: backend/src/modules/${entry.name}`);
      }
    }
  }

  const backendSourceDir = resolveProjectPath('backend/src');
  if (fs.existsSync(backendSourceDir)) {
    const controllerRoutePattern = /@(Controller|Get|Post|Put|Patch|Delete)\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/g;
    for (const filePath of walkFiles(backendSourceDir)) {
      if (!filePath.endsWith('.controller.ts')) {
        continue;
      }
      const source = fs.readFileSync(filePath, 'utf8');
      for (const match of source.matchAll(controllerRoutePattern)) {
        const routePath = match[2];
        if (forbiddenRouteSegmentPattern.test(routePath)) {
          addFailure(
            `First-stage backend controller must not expose forbidden next-stage route "${routePath}": ${toProjectPath(filePath)}:${sourceLineForIndex(
              source,
              match.index || 0
            )}`
          );
        }
      }
    }
  }

  const frontendApiDir = resolveProjectPath('frontend/src/api');
  if (fs.existsSync(frontendApiDir)) {
    const apiPathPattern = /['"`](?:\$\{apiBaseUrl\})?(\/[^'"`]*?)['"`]/g;
    for (const filePath of walkFiles(frontendApiDir)) {
      const source = fs.readFileSync(filePath, 'utf8');
      for (const match of source.matchAll(apiPathPattern)) {
        const apiPath = match[1];
        if (forbiddenRouteSegmentPattern.test(apiPath)) {
          addFailure(
            `First-stage frontend API must not call forbidden next-stage path "${apiPath}": ${toProjectPath(filePath)}:${sourceLineForIndex(
              source,
              match.index || 0
            )}`
          );
        }
      }
    }
  }

  const schemaPath = 'database/prisma/schema.prisma';
  if (fileExists(schemaPath)) {
    const schemaSource = readFile(schemaPath);
    const schemaMatch = forbiddenSchemaPattern.exec(schemaSource);
    if (schemaMatch) {
      addFailure(`First-stage Prisma schema must not add forbidden next-stage ${schemaMatch[1]} ${schemaMatch[2]}.`);
    }
  }

  const migrationsDir = resolveProjectPath('database/prisma/migrations');
  if (fs.existsSync(migrationsDir)) {
    const migrationSqlFiles = [];
    const pendingDirs = [migrationsDir];
    while (pendingDirs.length > 0) {
      const currentDir = pendingDirs.pop();
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          pendingDirs.push(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.sql')) {
          migrationSqlFiles.push(fullPath);
        }
      }
    }

    for (const filePath of migrationSqlFiles) {
      const source = fs.readFileSync(filePath, 'utf8');
      forbiddenSqlObjectPattern.lastIndex = 0;
      for (const match of source.matchAll(forbiddenSqlObjectPattern)) {
        addFailure(
          `First-stage migration SQL must not add or alter forbidden next-stage ${match[1]} object "${match[2]}...": ${toProjectPath(
            filePath
          )}:${sourceLineForIndex(source, match.index || 0)}`
        );
      }
    }
  }
}

function verifyNoJsonFilePrimaryDatabase() {
  const backendSourceDir = resolveProjectPath('backend/src');
  if (!fs.existsSync(backendSourceDir)) {
    return;
  }

  const suspiciousJsonDataPathPattern =
    /['"`]([^'"`]*(?:data|db|database|store|storage|customer|customers|order|orders|material|materials|inventory|warehouse|production)[^'"`]*\.(?:json|jsonl))['"`]/gi;
  const jsonFileDatabaseAdapterPattern =
    /\b(?:JSONFile|LowSync|Low|lowdb|NeDB|nedb)\b|require\s*\(\s*['"`](?:lowdb|nedb|nedb-promises)['"`]\s*\)|from\s+['"`](?:lowdb|nedb|nedb-promises)['"`]/;

  for (const filePath of walkFiles(backendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    suspiciousJsonDataPathPattern.lastIndex = 0;
    for (const match of source.matchAll(suspiciousJsonDataPathPattern)) {
      addFailure(
        `Backend runtime must not use JSON/JSONL files as a primary data store; use Prisma/PostgreSQL instead: ${toProjectPath(
          filePath
        )}:${sourceLineForIndex(source, match.index || 0)} (${match[1]})`
      );
    }

    if (jsonFileDatabaseAdapterPattern.test(source)) {
      addFailure(
        `Backend runtime must not use JSON file database adapters; use Prisma/PostgreSQL instead: ${toProjectPath(filePath)}`
      );
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

function verifyBusinessTablesHaveHorizontalScroll() {
  const frontendRoots = ['frontend/src/views', 'frontend/src/components']
    .map(resolveProjectPath)
    .filter((dir) => fs.existsSync(dir));
  const allowedTableContextSnippets = [
    'table-card',
    'table-section',
    'desktop-table',
    'import-preview-table',
    'import-line-table',
    'bom-scope-review-table',
    'source-bom-review-table',
    'batch-shipment-table'
  ];

  for (const filePath of frontendRoots.flatMap((dir) => walkFiles(dir))) {
    if (path.extname(filePath) !== '.vue') {
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split(/\r?\n/);
    for (const match of source.matchAll(/<el-table(?=[\s>]|$)/g)) {
      const lineNumber = sourceLineForIndex(source, match.index);
      const context = lines
        .slice(Math.max(0, lineNumber - 13), Math.min(lines.length, lineNumber + 8))
        .join('\n');
      const hasKnownScrollableContext = allowedTableContextSnippets.some((snippet) => context.includes(snippet));
      const hasExplicitTableHeight = /max-height\s*=|height\s*=/.test(context);
      if (!hasKnownScrollableContext && !hasExplicitTableHeight) {
        addFailure(
          `Business el-table must keep a horizontal-scroll wrapper or explicit table height: ${toProjectPath(filePath)}:${lineNumber}`
        );
      }
    }
  }
}

function verifyNoElementPlusShowOverflowTooltip() {
  const frontendRoots = ['frontend/src/views', 'frontend/src/components']
    .map(resolveProjectPath)
    .filter((dir) => fs.existsSync(dir));

  for (const filePath of frontendRoots.flatMap((dir) => walkFiles(dir))) {
    if (path.extname(filePath) !== '.vue') {
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const match = source.match(/\bshow-overflow-tooltip\b/);
    if (match) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use explicit preview/title helpers instead of Element Plus show-overflow-tooltip.`
      );
    }
  }
}

function verifyNoRawLongTextTableColumns() {
  const frontendRoots = ['frontend/src/views', 'frontend/src/components']
    .map(resolveProjectPath)
    .filter((dir) => fs.existsSync(dir));
  const rawLongTextColumnPattern =
    /<el-table-column\b(?=[^>]*\bprop=["'](?:reason|remark|statusReason|reviewRemark|scopeLabel|issueDetail|defaultProcessRoute)["'])[^>]*\/>/g;

  for (const filePath of frontendRoots.flatMap((dir) => walkFiles(dir))) {
    if (path.extname(filePath) !== '.vue') {
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    rawLongTextColumnPattern.lastIndex = 0;
    for (const match of source.matchAll(rawLongTextColumnPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must render long text table fields through an explicit preview/title template instead of a raw prop column.`
      );
    }
  }
}

function verifyNoNativeBrowserDialogs() {
  const scanRoots = ['frontend/src', 'backend/src', 'database/prisma']
    .map(resolveProjectPath)
    .filter((dir) => fs.existsSync(dir));

  const checks = [
    { name: 'window dialog reference', pattern: /window\s*(?:\?\.|\.)\s*(?:prompt|confirm|alert)\b/ },
    { name: 'window dialog bracket reference', pattern: /window\s*(?:\?\.|\.)?\s*\[\s*['"`](?:prompt|confirm|alert)['"`]\s*\]/ },
    { name: 'globalThis dialog reference', pattern: /globalThis\s*(?:\?\.|\.)\s*(?:prompt|confirm|alert)\b/ },
    { name: 'globalThis dialog bracket reference', pattern: /globalThis\s*(?:\?\.|\.)?\s*\[\s*['"`](?:prompt|confirm|alert)['"`]\s*\]/ },
    { name: 'self dialog reference', pattern: /self\s*(?:\?\.|\.)\s*(?:prompt|confirm|alert)\b/ },
    { name: 'self dialog bracket reference', pattern: /self\s*(?:\?\.|\.)?\s*\[\s*['"`](?:prompt|confirm|alert)['"`]\s*\]/ },
    { name: 'browser dialog destructuring', pattern: /\{[^}]*\b(?:prompt|confirm|alert)\b[^}]*}\s*=\s*(?:window|globalThis|self)\b/ },
    { name: 'window.prompt', pattern: /window\s*(?:\?\.|\.)\s*prompt\s*\(/ },
    { name: 'window.confirm', pattern: /window\s*(?:\?\.|\.)\s*confirm\s*\(/ },
    { name: 'window.alert', pattern: /window\s*(?:\?\.|\.)\s*alert\s*\(/ },
    { name: 'window prompt bracket', pattern: /window\s*(?:\?\.|\.)?\s*\[\s*['"`]prompt['"`]\s*\]\s*\(/ },
    { name: 'window confirm bracket', pattern: /window\s*(?:\?\.|\.)?\s*\[\s*['"`]confirm['"`]\s*\]\s*\(/ },
    { name: 'window alert bracket', pattern: /window\s*(?:\?\.|\.)?\s*\[\s*['"`]alert['"`]\s*\]\s*\(/ },
    { name: 'globalThis.prompt', pattern: /globalThis\s*(?:\?\.|\.)\s*prompt\s*\(/ },
    { name: 'globalThis.confirm', pattern: /globalThis\s*(?:\?\.|\.)\s*confirm\s*\(/ },
    { name: 'globalThis.alert', pattern: /globalThis\s*(?:\?\.|\.)\s*alert\s*\(/ },
    { name: 'globalThis prompt bracket', pattern: /globalThis\s*(?:\?\.|\.)?\s*\[\s*['"`]prompt['"`]\s*\]\s*\(/ },
    { name: 'globalThis confirm bracket', pattern: /globalThis\s*(?:\?\.|\.)?\s*\[\s*['"`]confirm['"`]\s*\]\s*\(/ },
    { name: 'globalThis alert bracket', pattern: /globalThis\s*(?:\?\.|\.)?\s*\[\s*['"`]alert['"`]\s*\]\s*\(/ },
    { name: 'self.prompt', pattern: /self\s*(?:\?\.|\.)\s*prompt\s*\(/ },
    { name: 'self.confirm', pattern: /self\s*(?:\?\.|\.)\s*confirm\s*\(/ },
    { name: 'self.alert', pattern: /self\s*(?:\?\.|\.)\s*alert\s*\(/ },
    { name: 'self prompt bracket', pattern: /self\s*(?:\?\.|\.)?\s*\[\s*['"`]prompt['"`]\s*\]\s*\(/ },
    { name: 'self confirm bracket', pattern: /self\s*(?:\?\.|\.)?\s*\[\s*['"`]confirm['"`]\s*\]\s*\(/ },
    { name: 'self alert bracket', pattern: /self\s*(?:\?\.|\.)?\s*\[\s*['"`]alert['"`]\s*\]\s*\(/ },
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

  const forbiddenConfirmPatterns = [
    { name: 'ElMessageBox import', pattern: /import\s+{[^}]*\bElMessageBox\b[^}]*}\s+from\s+['"`]element-plus(?:\/[^'"`]*)?['"`]/ },
    { name: 'ElPopconfirm import', pattern: /import\s+{[^}]*\bElPopconfirm\b[^}]*}\s+from\s+['"`]element-plus(?:\/[^'"`]*)?['"`]/ },
    { name: 'Element Plus message-box module import', pattern: /from\s+['"`]element-plus\/[^'"`]*message-box[^'"`]*['"`]/ },
    { name: 'Element Plus popconfirm module import', pattern: /from\s+['"`]element-plus\/[^'"`]*popconfirm[^'"`]*['"`]/ },
    { name: 'Element Plus message-box dynamic import', pattern: /import\s*\(\s*['"`]element-plus\/[^'"`]*message-box[^'"`]*['"`]\s*\)/ },
    { name: 'Element Plus popconfirm dynamic import', pattern: /import\s*\(\s*['"`]element-plus\/[^'"`]*popconfirm[^'"`]*['"`]\s*\)/ },
    { name: 'Element Plus message-box require', pattern: /require\s*\(\s*['"`]element-plus\/[^'"`]*message-box[^'"`]*['"`]\s*\)/ },
    { name: 'Element Plus popconfirm require', pattern: /require\s*\(\s*['"`]element-plus\/[^'"`]*popconfirm[^'"`]*['"`]\s*\)/ },
    { name: 'ElMessageBox dynamic import', pattern: /import\s*\(\s*['"`]element-plus(?:\/[^'"`]*)?['"`]\s*\)[\s\S]{0,200}\bElMessageBox\b/ },
    { name: 'ElPopconfirm dynamic import', pattern: /import\s*\(\s*['"`]element-plus(?:\/[^'"`]*)?['"`]\s*\)[\s\S]{0,200}\bElPopconfirm\b/ },
    { name: 'ElMessageBox require', pattern: /require\s*\(\s*['"`]element-plus(?:\/[^'"`]*)?['"`]\s*\)[\s\S]{0,200}\bElMessageBox\b/ },
    { name: 'ElPopconfirm require', pattern: /require\s*\(\s*['"`]element-plus(?:\/[^'"`]*)?['"`]\s*\)[\s\S]{0,200}\bElPopconfirm\b/ },
    { name: 'Element Plus global message box call', pattern: /(?:^|[^\w$])\$(?:confirm|alert|prompt|msgbox)\s*\(/ },
    { name: 'Element Plus globalProperties message box', pattern: /globalProperties\s*(?:\?\.|\.)\s*\$(?:confirm|alert|prompt|msgbox)\b/ },
    {
      name: 'Element Plus globalProperties message box bracket',
      pattern: /globalProperties\s*(?:\?\.|\.)?\s*\[\s*['"`]\$(?:confirm|alert|prompt|msgbox)['"`]\s*\]/
    },
    { name: 'ElMessageBox.confirm', pattern: /ElMessageBox\s*(?:\?\.|\.)\s*confirm\s*\(/ },
    { name: 'ElMessageBox.alert', pattern: /ElMessageBox\s*(?:\?\.|\.)\s*alert\s*\(/ },
    { name: 'ElMessageBox.prompt', pattern: /ElMessageBox\s*(?:\?\.|\.)\s*prompt\s*\(/ },
    { name: 'ElMessageBox direct call', pattern: /ElMessageBox\s*\(/ },
    { name: 'ElMessageBox confirm bracket', pattern: /ElMessageBox\s*(?:\?\.|\.)?\s*\[\s*['"`]confirm['"`]\s*\]\s*\(/ },
    { name: 'ElMessageBox alert bracket', pattern: /ElMessageBox\s*(?:\?\.|\.)?\s*\[\s*['"`]alert['"`]\s*\]\s*\(/ },
    { name: 'ElMessageBox prompt bracket', pattern: /ElMessageBox\s*(?:\?\.|\.)?\s*\[\s*['"`]prompt['"`]\s*\]\s*\(/ },
    { name: 'el-popconfirm', pattern: /<\s*el-popconfirm\b/ },
    { name: 'ElPopconfirm', pattern: /\bElPopconfirm\b/ }
  ];

  for (const filePath of walkFiles(frontendDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const check of forbiddenConfirmPatterns) {
      const match = check.pattern.exec(source);
      if (match) {
        addFailure(
          `Element Plus inline confirmation "${check.name}" is not allowed for first-stage key operations; use el-dialog instead: ${toProjectPath(
            filePath
          )}:${sourceLineForIndex(source, match.index || 0)}`
        );
      }
    }
  }
}

function verifyNoDefaultFirstOption() {
  const frontendDir = resolveProjectPath('frontend/src');
  if (!fs.existsSync(frontendDir)) {
    return;
  }

  for (const filePath of walkFiles(frontendDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const match = source.match(/\bdefault-first-option\b|\bdefaultFirstOption\b/);
    if (match) {
      addFailure(
        `Element Plus selects/autocomplete must not enable default-first-option; operators must explicitly choose matches: ${toProjectPath(
          filePath
        )}:${sourceLineForIndex(source, match.index || 0)}`
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
  const controllerPath = 'backend/src/modules/customers/customers.controller.ts';
  const servicePath = 'backend/src/modules/customers/customers.service.ts';
  const dtoPath = 'backend/src/modules/customers/dto.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const typesPath = 'frontend/src/types/erp.ts';
  const customersExportRegressionPath = 'scripts/verify-customers-export-api.cjs';
  if (!fileExists(componentPath)) {
    return;
  }

  const source = readFile(componentPath);
  const customersViewSource = fileExists(customersViewPath) ? readFile(customersViewPath) : '';
  const ordersListViewSource = fileExists(ordersListViewPath) ? readFile(ordersListViewPath) : '';
  const productionViewSource = fileExists(productionViewPath) ? readFile(productionViewPath) : '';
  const controllerSource = readFile(controllerPath);
  const serviceSource = readFile(servicePath);
  const dtoSource = readFile(dtoPath);
  const apiSource = readFile(apiPath);
  const typesSource = readFile(typesPath);
  const customersExportRegressionSource = readFile(customersExportRegressionPath);
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
    "props.status || 'ENABLED'",
    '加载更多客户',
    '暂无可用客户，请先在客户模块维护启用客户'
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
    "return this.customersService.findAll({ ...query, withPage: 'true' });",
    'customers-public-list-pagination',
    '客户搜索分页必须把总数和是否还有更多返回给前端',
    'customersPage(',
    'CustomerListResponse',
    'includeTestFixtures?: string',
    "const includeTestFixtures = query.includeTestFixtures === 'true';",
    'isTestFixtureCustomer',
    'testFixtureCustomerPrefixes',
    "includeTestFixtures: includeTestFixtures ? 'true' : undefined",
    'customers-export-read-only',
    'customers-test-fixture-filter',
    'customers-export-test-fixture-filter',
    'customerPagination',
    'handleCustomerPageChange',
    '个客户'
  ];
  const customerPaginationSources = [controllerSource, serviceSource, dtoSource, apiSource, typesSource, customersViewSource, customersExportRegressionSource].join('\n');
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
  const customersViewDefaultStatusSnippets = [
    "const statusFilter = ref<CommonStatus>('ENABLED');",
    "statusFilter.value = 'ENABLED';"
  ];
  for (const snippet of customersViewDefaultStatusSnippets) {
    if (!customersViewSource.includes(snippet)) {
      addFailure(`CustomersView.vue must default customer maintenance list to enabled customers while keeping the disabled-status filter available: ${snippet}`);
    }
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

function verifyCustomerTableHeightControls() {
  const viewPath = 'frontend/src/views/CustomersView.vue';
  if (!fileExists(viewPath)) {
    addFailure(`Missing customer table height control file: ${viewPath}`);
    return;
  }

  const viewSource = readFile(viewPath);
  const requiredSnippets = [
    "import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';",
    "type CustomerWorkTableKey = 'customers' | 'commonBoms'",
    'customerWorkTableHeightLimits',
    'customerWorkTableDefaultHeights',
    'baisheng.erp.customerWorkTableHeights.v1',
    '客户页面表格高度只保存为本机 UI 偏好，不写入客户、多联系人、BOM、订单、生产或库存业务数据。',
    'customerWorkTableHeights = reactive<Record<CustomerWorkTableKey, number>>',
    'function adjustCustomerWorkTableHeight',
    'function resetCustomerWorkTableHeight',
    'function restoreCustomerWorkTableHeights',
    'function saveCustomerWorkTableHeights',
    'window.localStorage.getItem(customerWorkTableHeightStorageKey)',
    'window.localStorage.setItem(customerWorkTableHeightStorageKey',
    'aria-label="客户资料表格高度"',
    'aria-label="降低客户资料表格高度"',
    'title="降低客户资料表格高度"',
    'aria-label="提高客户资料表格高度"',
    'title="提高客户资料表格高度"',
    'aria-label="恢复客户资料表格默认高度"',
    'title="恢复客户资料表格默认高度"',
    'aria-label="客户常用 BOM 表格高度"',
    'aria-label="降低客户常用 BOM 表格高度"',
    'title="降低客户常用 BOM 表格高度"',
    'aria-label="提高客户常用 BOM 表格高度"',
    'title="提高客户常用 BOM 表格高度"',
    'aria-label="恢复客户常用 BOM 表格默认高度"',
    'title="恢复客户常用 BOM 表格默认高度"',
    "isMobileCustomerExpanded(customer.id) ? '收起客户资料详情' : '查看客户资料详情'",
    ':max-height="customerWorkTableHeights.customers"',
    ':max-height="customerWorkTableHeights.commonBoms"',
    'restoreCustomerWorkTableHeights();',
    'customer-table-height-actions',
    'customer-table-height-toolbar'
  ];
  for (const snippet of requiredSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`CustomersView.vue must keep adjustable customer table height control snippet: ${snippet}`);
    }
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

function verifyOrderTestFixtureFilter() {
  const dtoSource = readFile('backend/src/modules/orders/dto.ts');
  const serviceSource = readFile('backend/src/modules/orders/orders.service.ts');
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  const regressionSource = readFile('scripts/verify-orders-export-api.cjs');
  const snippets = [
    [dtoSource, 'includeTestFixtures?: string;'],
    [serviceSource, 'ORDER_TEST_FIXTURE_PREFIXES'],
    [serviceSource, 'isOrderTestFixture'],
    [serviceSource, 'nullableOrderFixtureStartsWith'],
    [serviceSource, 'orderImportSessionFixtureWhere'],
    [serviceSource, "this.nullableOrderFixtureStartsWith('createdBy', prefix)"],
    [serviceSource, "this.nullableOrderFixtureStartsWith('projectModel', prefix)"],
    [serviceSource, "this.nullableOrderFixtureStartsWith('storedFileName', prefix)"],
    [serviceSource, 'const visibleOrders = includeTestFixtures ? orders : orders.filter'],
    [serviceSource, "const where: Prisma.OrderImportSessionWhereInput = includeTestFixtures ? {} : { NOT: this.orderImportSessionFixtureWhere() };"],
    [frontendApiSource, 'includeTestFixtures?: boolean;'],
    [frontendApiSource, "includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined"],
    [frontendApiSource, 'orderImportSessions(limit = 20, offset = 0, includeTestFixtures = false)'],
    [regressionSource, 'orders-export-read-only'],
    [readFile('scripts/verify-order-import-api.cjs'), 'order-import-session-history-test-fixture-filter'],
    [regressionSource, 'orders default list must hide reusable test fixture orders'],
    [regressionSource, 'orders default export must hide reusable test fixture orders'],
    [regressionSource, 'orders-list-test-fixture-filter'],
    [regressionSource, 'orders-export-test-fixture-filter']
  ];
  for (const [source, snippet] of snippets) {
    if (!source.includes(snippet)) {
      addFailure(`Order list/export must keep reusable test-fixture filter contract snippet: ${snippet}`);
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
  if (
    !controllerSource.includes("@Get('order-summary')") ||
    !controllerSource.includes("return this.productionService.orderSummary({ ...query, withPage: 'true' });")
  ) {
    addFailure('ProductionController must expose GET /production/tasks/order-summary as an explicit paginated response.');
  }
  if (
    !controllerSource.includes('@Get()') ||
    !controllerSource.includes("return this.productionService.findTasks({ ...query, withPage: 'true' });")
  ) {
    addFailure('ProductionController must expose GET /production/tasks as an explicit paginated response.');
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
  const productionTaskPaginationDtoSnippets = [
    'export class ProductionTaskQueryDto',
    'displayStatus?: (typeof productionExportStatuses)[number]',
    '@Max(200)',
    '@Max(100000)',
    'withPage?: string'
  ];
  for (const snippet of productionTaskPaginationDtoSnippets) {
    if (!dtoSource.includes(snippet)) {
      addFailure(`ProductionTaskQueryDto must keep production task public list pagination snippet: ${snippet}`);
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
    'const summaryRows = Array.from(summaries.values()).map',
    'const visibleSummaryRows = this.filterProductionExportSummaries(summaryRows, query.displayStatus)',
    'totalCount: visibleSummaryRows.length',
    'const visibleTasks = this.filterProductionExportTasks(mappedTasks, query.displayStatus)',
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
  if (!apiSource.includes('productionOrderSummariesPage(filters: ProductionTaskFilters = {})') || !apiSource.includes('/production/tasks/order-summary')) {
    addFailure('frontend api must expose productionOrderSummariesPage() for the order summary homepage.');
  }
  if (apiSource.includes('productionOrderSummaries(filters: ProductionTaskFilters = {})')) {
    addFailure('frontend api must not expose legacy productionOrderSummaries() full-list helper; use productionOrderSummariesPage().');
  }
  if (apiSource.includes('productionTasks(filters: ProductionTaskFilters = {})')) {
    addFailure('frontend api must not expose legacy productionTasks() full-list helper; use productionTasksPage().');
  }
  const productionListApiSnippets = [
    'productionTasksPage(filters: ProductionTaskFilters = {})',
    'productionOrderSummariesPage(filters: ProductionTaskFilters = {})',
    'return request<ProductionTaskListResponse>',
    'return request<ProductionOrderSummaryListResponse>',
    'displayStatus: filters.displayStatus',
    "withPage: 'true'"
  ];
  for (const snippet of productionListApiSnippets) {
    if (!apiSource.includes(snippet)) {
      addFailure(`frontend api must keep production public list pagination snippet: ${snippet}`);
    }
  }
  if (!apiSource.includes('batchStartProduction(payload: BatchStartProductionPayload)') || !apiSource.includes('/production/tasks/batch-start')) {
    addFailure('frontend api must expose batchStartProduction() for batch starting order tasks.');
  }

  const typesSource = readFile(typesPath);
  const typeSnippets = [
    'export interface ProductionOrderSummary',
    'export interface ProductionTaskListResponse',
    'export interface ProductionOrderSummaryListResponse',
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
    'erpApi.productionOrderSummariesPage({',
    'findProductionTaskForReplenishmentRequest',
    'orderSummaryPagination.totalCount = result.totalCount',
    'taskPagination.totalCount = result.totalCount',
    '@current-change="handleOrderSummaryPageChange"',
    '@current-change="handleTaskPageChange"',
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

function verifyProductionTableHeightControls() {
  const viewPath = 'frontend/src/views/ProductionView.vue';
  if (!fileExists(viewPath)) {
    addFailure(`Missing production table height control file: ${viewPath}`);
    return;
  }

  const viewSource = readFile(viewPath);
  const requiredSnippets = [
    "import { Bell, Camera, Document, Download, Minus, Plus, Printer, Refresh, RefreshLeft } from '@element-plus/icons-vue';",
    'type ProductionWorkTableKey =',
    "| 'productionNotices'",
    "| 'replenishmentRequests'",
    'productionWorkTableHeightLimits',
    'productionWorkTableDefaultHeights',
    'baisheng.erp.productionWorkTableHeights.v1',
    '生产页面表格、通知和现场任务列表高度只保存为本机 UI 偏好，不写入订单、生产任务、通知状态或库存业务数据。',
    'productionWorkTableHeights = reactive<Record<ProductionWorkTableKey, number>>',
    'activeProductionWorkTableHeight',
    'productionWorkTableHeightLabel',
    'productionWorkTableResetLabel',
    'function adjustProductionWorkTableHeight',
    'function adjustActiveProductionWorkTableHeight',
    'function resetProductionWorkTableHeight',
    'function resetActiveProductionWorkTableHeight',
    'function productionWorkTableHeightStyle',
    'function restoreProductionWorkTableHeights',
    'function saveProductionWorkTableHeights',
    'window.localStorage.getItem(productionWorkTableHeightStorageKey)',
    'window.localStorage.setItem(productionWorkTableHeightStorageKey',
    ':aria-label="productionWorkTableHeightLabel"',
    ':aria-label="`降低${productionWorkTableHeightLabel}`"',
    ':title="`降低${productionWorkTableHeightLabel}`"',
    ':aria-label="`提高${productionWorkTableHeightLabel}`"',
    ':title="`提高${productionWorkTableHeightLabel}`"',
    ':aria-label="productionWorkTableResetLabel"',
    ':title="productionWorkTableResetLabel"',
    'aria-label="生产报废统计表格高度"',
    'aria-label="降低生产报废统计表格高度"',
    'title="降低生产报废统计表格高度"',
    'aria-label="提高生产报废统计表格高度"',
    'title="提高生产报废统计表格高度"',
    'aria-label="恢复生产报废统计表格默认高度"',
    'title="恢复生产报废统计表格默认高度"',
    'aria-label="批量开始生产任务列表高度"',
    'aria-label="降低批量开始生产任务列表高度"',
    'title="降低批量开始生产任务列表高度"',
    'aria-label="提高批量开始生产任务列表高度"',
    'title="提高批量开始生产任务列表高度"',
    'aria-label="恢复批量开始生产任务列表默认高度"',
    'title="恢复批量开始生产任务列表默认高度"',
    'aria-label="生产通知列表高度"',
    'aria-label="降低生产通知列表高度"',
    'title="降低生产通知列表高度"',
    'aria-label="提高生产通知列表高度"',
    'title="提高生产通知列表高度"',
    'aria-label="恢复生产通知列表默认高度"',
    'title="恢复生产通知列表默认高度"',
    'aria-label="生产报废补单申请列表高度"',
    'aria-label="降低生产报废补单申请列表高度"',
    'title="降低生产报废补单申请列表高度"',
    'aria-label="提高生产报废补单申请列表高度"',
    'title="提高生产报废补单申请列表高度"',
    'aria-label="恢复生产报废补单申请列表默认高度"',
    'title="恢复生产报废补单申请列表默认高度"',
    ':max-height="productionWorkTableHeights.orderSummary"',
    ':max-height="productionWorkTableHeights.taskDetail"',
    ':max-height="productionWorkTableHeights.scrapRecords"',
    ":style=\"{ maxHeight: productionWorkTableHeightStyle('batchStartTasks') }\"",
    ":style=\"{ maxHeight: productionWorkTableHeightStyle('productionNotices') }\"",
    ":style=\"{ maxHeight: productionWorkTableHeightStyle('replenishmentRequests') }\"",
    'restoreProductionWorkTableHeights();',
    'batch-start-height-toolbar',
    'production-dialog-list-toolbar',
    'notice-scroll-list',
    'production-table-height-actions',
    'production-dialog-table-toolbar'
  ];
  for (const snippet of requiredSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`ProductionView.vue must keep adjustable production table height control snippet: ${snippet}`);
    }
  }
}

function verifyProductionExcelExportWorkflow() {
  const controllerPath = 'backend/src/modules/production/production.controller.ts';
  const servicePath = 'backend/src/modules/production/production.service.ts';
  const dtoPath = 'backend/src/modules/production/dto.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const viewPath = 'frontend/src/views/ProductionView.vue';
  const apiVerifierPath = 'scripts/verify-production-export-api.cjs';

  for (const projectPath of [controllerPath, servicePath, dtoPath, apiPath, viewPath, apiVerifierPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing production Excel export workflow file: ${projectPath}`);
      return;
    }
  }

  const controllerSource = readFile(controllerPath);
  const dtoSource = readFile(dtoPath);
  const serviceSource = readFile(servicePath);
  const apiSource = readFile(apiPath);
  const viewSource = readFile(viewPath);
  const apiVerifierSource = readFile(apiVerifierPath);

  const requiredContracts = [
    {
      label: 'ProductionController',
      source: controllerSource,
      snippets: [
        "@Get('export')",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        'new StreamableFile(await this.productionService.buildProductionExport(query))'
      ]
    },
    {
      label: 'ProductionExportQueryDto',
      source: dtoSource,
      snippets: ['productionExportViewModes', 'productionExportStatuses', 'export class ProductionExportQueryDto']
    },
    {
      label: 'ProductionService',
      source: serviceSource,
      snippets: [
        'async buildProductionExport(query: ProductionExportQueryDto): Promise<Uint8Array>',
        'new ExcelJS.Workbook()',
        'await workbook.xlsx.writeBuffer()',
        'filterProductionExportTasks',
        'filterProductionExportSummaries',
        'nullableFixtureStartsWith',
        "this.nullableFixtureStartsWith('replenishmentSourceRequestNo', prefix)",
        "this.nullableFixtureStartsWith('projectModel', prefix)",
        'return this.formatQuantity(Number(task.completedQuantity ?? 0), task.unit);'
      ]
    },
    {
      label: 'frontend production export API',
      source: apiSource,
      snippets: [
        'downloadProductionExport',
        '/production/tasks/export',
        "filename.toLowerCase().endsWith('.xlsx')"
      ]
    },
    {
      label: 'ProductionView.vue',
      source: viewSource,
      snippets: [
        'await erpApi.downloadProductionExport',
        "viewMode.value === 'ORDER_SUMMARY' ? activeOrderStatus.value : activeStatus.value",
        '`${printDocumentTitle.value}_${formatFileDateTime()}.xlsx`',
        "ElMessage.error(error instanceof Error ? error.message : '生产 Excel 导出失败，请稍后重试')"
      ]
    },
    {
      label: 'verify-production-export-api.cjs',
      source: apiVerifierSource,
      snippets: [
        'assertPaginatedList',
        'production-export-read-only',
        'assertAnnualSummaryReadOnly',
        'production-tasks-public-list-pagination',
        'production-order-summary-public-list-pagination',
        'production-tasks-display-status-pagination',
        'production-order-summary-display-status-pagination',
        'production-task-nullable-fixture-filter-business-visibility',
        'production-annual-summary-read-only',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'production-export.xlsx',
        '状态：待处理',
        '完成/生产计划'
      ]
    }
  ];

  for (const contract of requiredContracts) {
    for (const snippet of contract.snippets) {
      if (!contract.source.includes(snippet)) {
        addFailure(`${contract.label} must keep production Excel export contract snippet: ${snippet}`);
      }
    }
  }

  if (/Number\(task\.completedQuantity\)\s*===\s*0/.test(serviceSource)) {
    addFailure('ProductionService production Excel export must display zero completed quantity as 0 + unit, not only the unit text.');
  }
  if (viewSource.includes('downloadHtmlAsExcel') || viewSource.includes('application/vnd.ms-excel')) {
    addFailure('ProductionView.vue must export production Excel through backend real .xlsx API, not HTML disguised as Excel.');
  }
}

function verifyRealXlsxExportFormatContract() {
  const scanFiles = [
    ...walkFiles(resolveProjectPath('backend/src')),
    ...walkFiles(resolveProjectPath('frontend/src'))
  ];
  const bannedPatterns = [
    {
      pattern: /application\/vnd\.ms-excel/i,
      message: 'must not use application/vnd.ms-excel for ERP Excel exports.'
    },
    {
      pattern: /\bdownloadHtmlAsExcel\b/,
      message: 'must not use HTML-as-Excel download helpers.'
    },
    {
      pattern: /new\s+Blob\s*\(\s*\[[\s\S]{0,180}(?:<!doctype\s+html|<html|\\ufeff)/i,
      message: 'must not wrap HTML/text blobs as Excel files.'
    },
    {
      pattern: /download\s*=\s*['"`][^'"`]*\.xls(?!x)\b/i,
      message: 'must not assign .xls download filenames.'
    },
    {
      pattern: /[`'"][^`'"]*\.xls(?!x)\b[^`'"]*[`'"]/i,
      message: 'must not generate .xls export filenames.'
    }
  ];

  for (const filePath of scanFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const banned of bannedPatterns) {
      const match = banned.pattern.exec(source);
      if (match) {
        addFailure(`${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} ${banned.message}`);
      }
    }
  }

  verifyBackendXlsxExportHeaders();
  verifyFrontendXlsxDownloadHelper();
}

function verifyBackendXlsxExportHeaders() {
  const controllerFiles = walkFiles(resolveProjectPath('backend/src')).filter((filePath) => filePath.endsWith('.controller.ts'));
  const excelRoutePattern = /(^|\/|-)export($|\/|-)|(^|\/|-)template($|\/|-)|(^|\/|-)error-report($|\/|-)/;

  for (const filePath of controllerFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      const routeMatch = line.match(/@Get\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/);
      if (!routeMatch || !excelRoutePattern.test(routeMatch[1])) {
        return;
      }

      const headerWindow = lines.slice(index, index + 9).join('\n');
      if (!headerWindow.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
        addFailure(`${toProjectPath(filePath)}:${index + 1} Excel endpoint "${routeMatch[1]}" must declare real .xlsx Content-Type.`);
      }
      if (!/@Header\s*\(\s*['"`]Content-Disposition['"`][\s\S]*?\.xlsx/.test(headerWindow)) {
        addFailure(`${toProjectPath(filePath)}:${index + 1} Excel endpoint "${routeMatch[1]}" must declare a .xlsx Content-Disposition filename.`);
      }
    });
  }
}

function verifyFrontendXlsxDownloadHelper() {
  const apiPath = 'frontend/src/api/erp.ts';
  if (!fileExists(apiPath)) {
    addFailure('frontend/src/api/erp.ts must exist for Excel download helper verification.');
    return;
  }

  const source = readFile(apiPath);
  const helperDefinitions = [...source.matchAll(/\basync\s+function\s+downloadXlsxResponse\s*\(/g)];
  const helperCalls = [...source.matchAll(/\bdownloadXlsxResponse\s*\(/g)];
  if (helperDefinitions.length !== 1) {
    addFailure('frontend/src/api/erp.ts must keep exactly one downloadXlsxResponse helper for ERP Excel downloads.');
  }
  if (helperCalls.length - helperDefinitions.length <= 0) {
    addFailure('frontend/src/api/erp.ts export APIs must use downloadXlsxResponse.');
  }
  if (!/function\s+xlsxFilename\s*\(\s*filename\s*:\s*string\s*\)/.test(source)) {
    addFailure('frontend/src/api/erp.ts must keep xlsxFilename to normalize exported filenames.');
  }
  if ((source.match(/\bURL\.createObjectURL\s*\(/g) || []).length !== 1) {
    addFailure('frontend/src/api/erp.ts must create object URLs only inside downloadXlsxResponse.');
  }
  if ((source.match(/document\.createElement\s*\(\s*['"`]a['"`]\s*\)/g) || []).length !== 1) {
    addFailure('frontend/src/api/erp.ts must create download anchors only inside downloadXlsxResponse.');
  }
  if (!/link\.download\s*=\s*xlsxFilename\(filename\);/.test(source)) {
    addFailure('frontend/src/api/erp.ts must assign link.download through xlsxFilename(filename).');
  }
}

function verifyExportConcurrencyGuards() {
  const contracts = [
    {
      path: 'frontend/src/views/ProductionView.vue',
      label: 'ProductionView.vue',
      snippets: [
        ':loading="productionExporting"',
        'const productionExporting = ref(false);',
        'if (productionExporting.value) {',
        'if (productionNoticeExporting.value) {',
        'if (replenishmentRequestExporting.value) {',
        'if (scrapExporting.value) {',
        'productionExporting.value = true;',
        'productionExporting.value = false;'
      ]
    },
    {
      path: 'frontend/src/views/WarehouseView.vue',
      label: 'WarehouseView.vue',
      snippets: [
        'if (warehouseWorkExporting.value) {',
        'if (warehouseConfigExporting.value) {',
        'if (transactionExporting.value) {',
        'if (warehouseNoticeExporting.value) {'
      ]
    },
    {
      path: 'frontend/src/views/StatisticsView.vue',
      label: 'StatisticsView.vue',
      snippets: ['if (statisticsExporting.value) {']
    },
    {
      path: 'frontend/src/views/AdminNoticesView.vue',
      label: 'AdminNoticesView.vue',
      snippets: ['if (adminNoticeExporting.value) {']
    },
    {
      path: 'frontend/src/views/MaterialsManagementView.vue',
      label: 'MaterialsManagementView.vue',
      snippets: ['if (dashboardExporting.value) {']
    },
    {
      path: 'frontend/src/views/CustomersView.vue',
      label: 'CustomersView.vue',
      snippets: ['if (customerExporting.value) {']
    },
    {
      path: 'frontend/src/views/InventoryView.vue',
      label: 'InventoryView.vue',
      snippets: ['if (inventoryExporting.value) {']
    },
    {
      path: 'frontend/src/views/OrderDetailView.vue',
      label: 'OrderDetailView.vue',
      snippets: ['if (!order.value || orderExporting.value) {']
    },
    {
      path: 'frontend/src/views/OrdersListView.vue',
      label: 'OrdersListView.vue',
      snippets: ['if (orderExporting.value) {', 'if (importTemplateDownloading.value) {', 'if (importIssueReportDownloading.value) {']
    },
    {
      path: 'frontend/src/views/ModelBomsView.vue',
      label: 'ModelBomsView.vue',
      snippets: ['if (modelBomExporting.value) {', 'if (sourceBomDiffReviewExporting.value || !bom?.id || !sourceBomId) {']
    },
    {
      path: 'frontend/src/views/MaterialsView.vue',
      label: 'MaterialsView.vue',
      snippets: [
        'if (materialExporting.value) {',
        'if (applicabilityExporting.value || !activeMaterial.value) {',
        'if (drawingExporting.value || !activeMaterial.value) {',
        "guardDesktopOperation('下载零件库导入问题明细')",
        'if (materialImportTemplateDownloading.value) {',
        'if (importIssueReportDownloading.value) {'
      ]
    },
    {
      path: 'frontend/src/views/MaterialTransformsView.vue',
      label: 'MaterialTransformsView.vue',
      snippets: ['if (exporting.value) {']
    },
    {
      path: 'frontend/src/components/ProcessDefinitionManager.vue',
      label: 'ProcessDefinitionManager.vue',
      snippets: ['if (exporting.value) {']
    },
    {
      path: 'frontend/src/components/ProcessTemplateManager.vue',
      label: 'ProcessTemplateManager.vue',
      snippets: ['if (exporting.value) {']
    }
  ];

  for (const contract of contracts) {
    if (!fileExists(contract.path)) {
      addFailure(`Missing first-stage export concurrency guard file: ${contract.path}`);
      continue;
    }
    const source = readFile(contract.path);
    for (const snippet of contract.snippets) {
      if (!source.includes(snippet)) {
        addFailure(`${contract.label} must keep Excel export concurrency guard snippet: ${snippet}`);
      }
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
    'formatProcessLineNamePreview',
    '等 ${filtered.length} 个零件',
    'formatProcessNamePreview',
    '等 ${filtered.length} 个工序',
    'formatProcessNamePreview(line.processSteps)',
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
  if (
    processViewSource.includes("missingLineNames.value.join('、')") ||
    processViewSource.includes("missingStockSourceLineNames.value.join('、')") ||
    processViewSource.includes("insufficientReworkSourceLineNames.value.join('、')")
  ) {
    addFailure('ProcessSelectionView.vue must summarize missing process/stock-source line names instead of listing every line in warnings.');
  }
  if (processViewSource.includes("duplicates.join('、')") || processViewSource.includes("line.processSteps.join('、')")) {
    addFailure('ProcessSelectionView.vue must summarize duplicate/process step names instead of listing every item in warnings or rows.');
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

function verifyProcessSelectionTableHeightControls() {
  const viewPath = 'frontend/src/views/ProcessSelectionView.vue';
  if (!fileExists(viewPath)) {
    addFailure(`Missing process selection table height control file: ${viewPath}`);
    return;
  }

  const viewSource = readFile(viewPath);
  const requiredSnippets = [
    "import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';",
    'processOrderTableHeightLimits',
    'processOrderTableDefaultHeight',
    'baisheng.erp.processSelectionOrderTableHeight.v1',
    '生产流程选择页订单列表高度只保存为本机 UI 偏好，不写入订单、流程、生产或库存业务数据。',
    'processOrderTableHeight = ref(processOrderTableDefaultHeight)',
    'processWorkListHeightLimits',
    'processWorkListDefaultHeights',
    'baisheng.erp.processSelectionWorkListHeights.v1',
    '生产流程结构和提交明细列表高度只保存为本机 UI 偏好，不写入订单流程、生产任务或库存业务数据。',
    'processWorkListHeights = reactive<Record<ProcessWorkListHeightKey, number>>',
    'function adjustProcessOrderTableHeight',
    'function resetProcessOrderTableHeight',
    'function restoreProcessOrderTableHeight',
    'function saveProcessOrderTableHeight',
    'function adjustProcessWorkListHeight',
    'function resetProcessWorkListHeight',
    'function processWorkListHeightStyle',
    'function restoreProcessWorkListHeights',
    'function saveProcessWorkListHeights',
    'window.localStorage.getItem(processOrderTableHeightStorageKey)',
    'window.localStorage.setItem(processOrderTableHeightStorageKey',
    'window.localStorage.getItem(processWorkListHeightStorageKey)',
    'window.localStorage.setItem(processWorkListHeightStorageKey',
    'aria-label="生产流程订单列表表格高度"',
    'aria-label="降低生产流程订单列表表格高度"',
    'aria-label="提高生产流程订单列表表格高度"',
    'aria-label="恢复生产流程订单列表表格默认高度"',
    'aria-label="流程固定格式清单高度"',
    'aria-label="降低流程固定格式清单高度"',
    'aria-label="提高流程固定格式清单高度"',
    'aria-label="恢复流程固定格式清单默认高度"',
    'aria-label="提交生产零件明细高度"',
    'aria-label="降低提交生产零件明细高度"',
    'aria-label="提高提交生产零件明细高度"',
    'aria-label="恢复提交生产零件明细默认高度"',
    ':max-height="processOrderTableHeight"',
    ":style=\"{ maxHeight: processWorkListHeightStyle('structure') }\"",
    ":style=\"{ maxHeight: processWorkListHeightStyle('submitLines') }\"",
    'restoreProcessOrderTableHeight();',
    'restoreProcessWorkListHeights();',
    'process-table-height-actions',
    'process-table-height-toolbar',
    'process-list-height-actions',
    'process-list-height-toolbar'
  ];
  for (const snippet of requiredSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`ProcessSelectionView.vue must keep adjustable process selection table height control snippet: ${snippet}`);
    }
  }
  const forbiddenFixedListHeightSnippets = [
    '.process-structure-list {\n  display: grid;\n  gap: 8px;\n  max-height:',
    '.submit-production-lines {\n  display: grid;\n  gap: 8px;\n  max-height:'
  ];
  for (const snippet of forbiddenFixedListHeightSnippets) {
    if (viewSource.includes(snippet)) {
      addFailure('ProcessSelectionView.vue must not keep fixed CSS max-height on process structure or submit production lists; use processWorkListHeights only.');
    }
  }
}

function verifyMaterialTransformTableHeightControls() {
  const viewPath = 'frontend/src/views/MaterialTransformsView.vue';
  if (!fileExists(viewPath)) {
    addFailure(`Missing material transform table height control file: ${viewPath}`);
    return;
  }

  const viewSource = readFile(viewPath);
  const requiredSnippets = [
    "import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';",
    'transformRuleTableHeightLimits',
    'transformRuleTableDefaultHeight',
    'baisheng.erp.materialTransformRuleTableHeight.v1',
    '来源加工关系表格高度只保存为本机 UI 偏好，不写入来源规则、订单、生产或库存业务数据。',
    'transformRuleTableHeight = ref(transformRuleTableDefaultHeight)',
    'function adjustTransformRuleTableHeight',
    'function resetTransformRuleTableHeight',
    'function restoreTransformRuleTableHeight',
    'function saveTransformRuleTableHeight',
    'window.localStorage.getItem(transformRuleTableHeightStorageKey)',
    'window.localStorage.setItem(transformRuleTableHeightStorageKey',
    'aria-label="来源加工关系表格高度"',
    'aria-label="降低来源加工关系表格高度"',
    'aria-label="提高来源加工关系表格高度"',
    'aria-label="恢复来源加工关系表格默认高度"',
    ':max-height="transformRuleTableHeight"',
    'restoreTransformRuleTableHeight();',
    'transform-table-height-actions',
    'transform-table-height-toolbar'
  ];
  for (const snippet of requiredSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`MaterialTransformsView.vue must keep adjustable source transform table height control snippet: ${snippet}`);
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
    'erpApi.processTemplatesPage({'
  ];
  for (const snippet of templateManagerSnippets) {
    if (!templateManagerSource.includes(snippet)) {
      addFailure(`ProcessTemplateManager.vue must keep process/template pinyin search snippet: ${snippet}`);
    }
  }

  const processDefinitionsSource = readFile(processDefinitionsServicePath);
  const processDefinitionsSnippets = [
    'import { buildPinyinSearchText, normalizeSearchKeyword, pinyinSearchMatches }',
    'visibleRows.filter((row) => pinyinSearchMatches([row.processName, row.remark], keyword))',
    'searchText: this.buildSearchText(processName, remark)',
    'searchText: this.buildSearchText(existing.processName, existing.remark)',
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
    'visibleTemplates.filter((template) => this.templateMatchesKeyword(template, keyword))',
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
    'definition.status === CommonStatus.ENABLED && !definition.searchText.trim()',
    'definition.status === CommonStatus.ENABLED && definition.searchText !== expectedSearchText',
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

function verifyNoPrismaBusinessTextNativeLengthLimits() {
  const schemaPath = 'database/prisma/schema.prisma';
  if (!fileExists(schemaPath)) {
    addFailure(`Missing Prisma schema for business text length guard: ${schemaPath}`);
    return;
  }

  const businessTextFieldPattern =
    /(?:Name|Code|No|Remark|Address|Country|Province|State|District|City|Specification|ProjectModel|Drawing|Version|Status|FileName|FileUrl|Process|Route|Snapshot|Description|Reason|Operator|CreatedBy|ChangedBy|HandledBy|AcknowledgedBy|Source|Target)/i;
  const schemaSource = readFile(schemaPath);
  const lines = schemaSource.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fieldName = line.trim().split(/\s+/)[0] || '';
    if (
      /^\w+$/.test(fieldName) &&
      businessTextFieldPattern.test(fieldName) &&
      /@db\.(?:VarChar|Char)\s*\(/.test(line)
    ) {
      addFailure(
        `Prisma business text field must not use fixed native string length; Excel remarks, specs and process text must not be truncated: ${schemaPath}:${
          index + 1
        } (${fieldName})`
      );
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
  const materialSuggestionsApiVerifyPath = 'scripts/verify-material-suggestions-api.cjs';

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
    orderImportApiVerifyPath,
    materialSuggestionsApiVerifyPath
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
  const materialSuggestionsApiVerifySource = readFile(materialSuggestionsApiVerifyPath);

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
    { source: serviceSource, file: servicePath, snippet: 'MATERIAL_SUGGESTION_HISTORY_CUSTOMER_PREVIEW_LIMIT' },
    { source: serviceSource, file: servicePath, snippet: 'historyCustomerNames: historyCustomerNames.slice(0, MATERIAL_SUGGESTION_HISTORY_CUSTOMER_PREVIEW_LIMIT)' },
    { source: serviceSource, file: servicePath, snippet: 'historyCustomerCount: historyCustomerNames.length' },
    { source: serviceSource, file: servicePath, snippet: 'hasCurrentCustomerHistory: Boolean(history?.hasQueryCustomerHistory)' },
    { source: serviceSource, file: servicePath, snippet: 'line.drawingNo' },
    { source: serviceSource, file: servicePath, snippet: 'line.drawingFileName' },
    { source: serviceSource, file: servicePath, snippet: 'line.projectModel' },
    { source: serviceSource, file: servicePath, snippet: 'line.order.orderNo' },
    { source: serviceSource, file: servicePath, snippet: 'material.drawingNo' },
    { source: serviceSource, file: servicePath, snippet: 'drawingFileName: drawingRevision?.drawingFileName ?? null' },
    { source: serviceSource, file: servicePath, snippet: 'drawingFileUrl: drawingRevision?.drawingFileUrl ?? null' },
    { source: serviceSource, file: servicePath, snippet: 'const drawingFileName = useQueryCustomerSnapshot' },
    { source: serviceSource, file: servicePath, snippet: 'const drawingFileUrl = useQueryCustomerSnapshot' },
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
    { source: serviceSource, file: servicePath, snippet: 'private async findMaterialMemoryScopePartCodes' },
    { source: serviceSource, file: servicePath, snippet: 'const scopePartCodes = await this.findMaterialMemoryScopePartCodes(query);' },
    { source: serviceSource, file: servicePath, snippet: 'const historyByCode = normalizedKeyword || scopePartCodes' },
    { source: serviceSource, file: servicePath, snippet: 'historyByCode.has(partCodeKey)' },
    { source: serviceSource, file: servicePath, snippet: 'const materialMatchesScope = !scopePartCodes || scopePartCodes.has(partCodeKey);' },
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
    { source: editorSource, file: editorPath, snippet: 'autoFields.drawingFileName = item.drawingFileName' },
    { source: editorSource, file: editorPath, snippet: 'autoFields.drawingFileUrl = item.drawingFileUrl' },
    { source: editorSource, file: editorPath, snippet: 'function ensureDrawingRevisionsLoaded' },
    { source: editorSource, file: editorPath, snippet: 'function applyDrawingRevisionToLine' },
    { source: editorSource, file: editorPath, snippet: 'function selectLineDrawingRevision' },
    { source: editorSource, file: editorPath, snippet: 'await erpApi.materialDrawingRevisions(materialId)' },
    { source: editorSource, file: editorPath, snippet: 'line.selectedMaterialId = item.materialId ||' },
    { source: editorSource, file: editorPath, snippet: 'line.selectedDrawingRevisionId = revision.id' },
    { source: editorSource, file: editorPath, snippet: 'clearSelectedMaterialDrawingRevisions(line)' },
    { source: editorSource, file: editorPath, snippet: '@visible-change="(visible: boolean) => handleDrawingRevisionVisibleChange(row, visible)"' },
    { source: editorSource, file: editorPath, snippet: '@change="(revisionId: string) => selectLineDrawingRevision(row, revisionId)"' },
    { source: editorSource, file: editorPath, snippet: "clearTextField('drawingFileName')" },
    { source: editorSource, file: editorPath, snippet: "clearTextField('drawingFileUrl')" },
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
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '<el-table-column label="操作" width="170" fixed="right">' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'inventory-memory-actions' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'inventory-memory-action-group' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'inventory-memory-action-label' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'title="编辑零件搜索记忆"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'title="启用零件搜索记忆"' },
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
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '累计数量' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '已出库 / 已使用' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "const totalQuantityText = computed(() => formatInventoryTotalByUnit('totalQuantity'))" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "const usedQuantityText = computed(() => formatInventoryTotalByUnit('usedQuantity'))" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '已预占数量' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "const reservedQuantityText = computed(() => formatInventoryTotalByUnit('reservedQuantity'))" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '订单库存数量' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '备货库存数量' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '备货来源构成' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "const orderInventoryQuantityText = computed(() => formatInventoryTotalByUnit('orderInventoryQuantity'))" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "const stockInventoryQuantityText = computed(() => formatInventoryTotalByUnit('stockInventoryQuantity'))" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'const stockSourceBreakdownTotalText = computed' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "formatInventoryTotalByUnit('normalOrderStockQuantity')" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "formatInventoryTotalByUnit('cancelledOrderStockQuantity')" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "formatInventoryTotalByUnit('customerChangeStockQuantity')" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'inventory-stat-value-compact' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'title="刷新整页库存数据"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'const inventoryPageRefreshing = ref(false)' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'async function refreshInventoryPage()' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'Promise.all([loadWarehouses(), loadInventory(), loadMaterialMemory()])' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "| 'normalOrderStockQuantity'" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "| 'cancelledOrderStockQuantity'" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: "| 'customerChangeStockQuantity'" },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '库存溯源' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '逐批查看库存来源、占用记录、仓库库位，并进行盘点调整' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '库存来源/图纸' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '<el-table-column label="操作" width="210" fixed="right">' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'inventory-batch-actions' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'inventory-batch-action-group' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'inventory-batch-action-label' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'title="库存来源详情"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'title="预占记录"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: '手机端只查看库存来源和预占记录' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'label="生产日期"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'formatDate(row.productionDate)' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'formatDate(batch.productionDate)' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'label="盘点备注"' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'formatLongTextPreview(row.remark)' },
    { source: inventoryViewSource, file: inventoryViewPath, snippet: 'longTextTooltipText(row.remark)' },
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
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'source-bulk-action-group' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'source-bulk-action-label' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'source-bulk-note' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'selected-source-action-group' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'selected-source-action-label' },
    { source: inventorySourceDetailsSource, file: inventorySourceDetailsPath, snippet: 'selected-source-row-actions' },
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
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'const count = props.item.historyCustomerCount ?? names.length' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: "formatCustomerNamePreview(names, '-', count)" },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: ':title="historyTooltipText"' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'totalCount?: number' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '等 ${count} 个客户' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '图号 ${props.item.drawingNo}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '型号 ${props.item.projectModel}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: '日期 ${props.item.drawingDate}' },
    { source: materialSuggestionOptionSource, file: materialSuggestionOptionPath, snippet: 'props.item.drawingFileName ? `文件 ${props.item.drawingFileName}`' },
    { source: editorSource, file: editorPath, snippet: 'props.customerId' },
    { source: apiSource, file: apiPath, snippet: 'customerId?: string' },
    { source: apiSource, file: apiPath, snippet: 'projectModel?: string' },
    { source: apiSource, file: apiPath, snippet: 'materialIdentityConfirmed?: boolean;' },
    { source: apiSource, file: apiPath, snippet: 'inventoryMaterialsPage(filters: MaterialMemoryFilters = {})' },
    { source: apiSource, file: apiPath, snippet: 'inventoryMaterialsAllPages(filters: MaterialMemoryFilters = {})' },
    { source: apiSource, file: apiPath, snippet: 'inventoryMaterialByPartCode(partCode: string' },
    { source: apiSource, file: apiPath, snippet: 'materialPartCodeKey(row.partCode) === exactKey' },
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
    { source: typesSource, file: typesPath, snippet: 'drawingFileName?: string;' },
    { source: typesSource, file: typesPath, snippet: 'drawingFileUrl?: string;' },
    { source: apiSource, file: apiPath, snippet: 'selectedMaterialId?: string;' },
    { source: apiSource, file: apiPath, snippet: 'selectedDrawingRevisionId?: string;' },
    { source: typesSource, file: typesPath, snippet: 'identityConflictFields?: string[];' },
    { source: typesSource, file: typesPath, snippet: 'historyCustomerNames?: string[];' },
    { source: typesSource, file: typesPath, snippet: 'historyCustomerCount?: number;' },
    { source: typesSource, file: typesPath, snippet: 'hasCurrentCustomerHistory?: boolean;' },
    { source: typesSource, file: typesPath, snippet: 'identityVariantCount?: number;' },
    { source: typesSource, file: typesPath, snippet: 'hasIdentityConflict?: boolean;' },
    { source: typesSource, file: typesPath, snippet: 'materialIdentityVariantCount?: number;' },
    { source: typesSource, file: typesPath, snippet: 'materialHasIdentityConflict?: boolean;' },
    { source: typesSource, file: typesPath, snippet: 'materialIdentityConflictFields?: string[];' },
    { source: ordersViewSource, file: ordersViewPath, snippet: ':customer-id="orderForm.customerId"' },
    { source: orderDetailSource, file: orderDetailPath, snippet: ':customer-id="order?.customerId || \'\'"' },
    { source: orderDetailSource, file: orderDetailPath, snippet: 'function materialIdentityConflictText' },
    { source: orderDetailSource, file: orderDetailPath, snippet: "formatOrderDetailListPreview(detailLine.materialIdentityConflictFields, '字段')" },
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
    { source: agentsSource, file: agentsPath, snippet: '订单行图纸快照' },
    { source: agentsSource, file: agentsPath, snippet: '从该零件当前启用的图纸版本中选择 A、B、C、D 或更多版本' },
    { source: agentsSource, file: agentsPath, snippet: '选中历史物料后若操作员又手工修改 `partCode` 或 `partName`' },
    { source: agentsSource, file: agentsPath, snippet: '删除只能软停用 `Material`' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertMaterialSuggestionCustomerCodeSearch' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: "const customerPrefix = 'VERIFY-SUG-CUST-STABLE';" },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: "const partCode = 'VERIFY-SUG-PART-STABLE';" },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'prisma.material.upsert' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'prisma.customer.findFirst' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'prisma.customer.update' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'prisma.customer.create' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'prisma.customerContact.updateMany' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'material-suggestions-reusable-history-fixture' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'prisma.customerOrder.upsert' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'prisma.orderLine.upsert' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'historyCustomerNames.length <= 20' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'matched.historyCustomerCount === 25' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'await cleanup();' },
    { source: materialSuggestionsApiVerifySource, file: materialSuggestionsApiVerifyPath, snippet: 'verify-material-suggestions-api' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function assertCustomerSearchRanking' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: "createOrderImportRegressionCustomer('RANK-PREFIX'" },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: "createOrderImportRegressionCustomer('RANK-EXACT'" },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'createdRegressionCustomerIds.push(customer.id)' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'isPrimary: true' },
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
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await assertDisabledMaterialMemoryExcludedFromSuggestions' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function softDisableRegressionWarehouse' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function upsertOrderImportWarehouseWithLocation' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await softDisableRegressionWarehouse(prisma, warehouseCode, locationCode)' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await upsertOrderImportWarehouseWithLocation(prisma, {' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'async function activateOrderImportMaterialFixtures' },
    { source: orderImportApiVerifySource, file: orderImportApiVerifyPath, snippet: 'await activateOrderImportMaterialFixtures();' }
  ];

  for (const item of requiredSnippets) {
    if (!item.source.includes(item.snippet)) {
      addFailure(`${item.file} must keep material suggestion search snippet: ${item.snippet}`);
    }
  }
  if (materialSuggestionOptionSource.includes('全部历史客户：${names.join')) {
    addFailure('MaterialSuggestionOption.vue history customer tooltip must summarize customer names instead of listing every historical customer.');
  }
  if (
    materialSuggestionsApiVerifySource.includes('new Date().toISOString().replace') ||
    materialSuggestionsApiVerifySource.includes('prisma.customer.deleteMany') ||
    materialSuggestionsApiVerifySource.includes('prisma.material.deleteMany') ||
    materialSuggestionsApiVerifySource.includes('prisma.orderLine.deleteMany') ||
    materialSuggestionsApiVerifySource.includes('prisma.customerOrder.deleteMany') ||
    materialSuggestionsApiVerifySource.includes('prisma.customerOrder.create')
  ) {
    addFailure('scripts/verify-material-suggestions-api.cjs must reuse stable customer/material/order records and must not delete or recreate order history.');
  }
  if (
    orderImportApiVerifySource.includes('prisma.warehouse.deleteMany') ||
    orderImportApiVerifySource.includes('prisma.warehouseLocation.deleteMany') ||
    orderImportApiVerifySource.includes('prisma.warehouse.create({')
  ) {
    addFailure('scripts/verify-order-import-api.cjs must reuse and soft-disable stable warehouse fixtures instead of creating/deleting warehouse master data.');
  }
  const materialSuggestionProcessRouteSnippets = [
    'baseInfoTooltipText',
    'formatProcessRoutePreview(props.item.defaultProcessRoute)',
    'function formatProcessRoutePreview',
    '等 ${steps.length} 个工序'
  ];
  for (const snippet of materialSuggestionProcessRouteSnippets) {
    if (!materialSuggestionOptionSource.includes(snippet)) {
      addFailure(`MaterialSuggestionOption.vue must summarize default process routes in suggestion options: ${snippet}`);
    }
  }
  if (materialSuggestionOptionSource.includes('默认工艺 ${props.item.defaultProcessRoute}')) {
    addFailure('MaterialSuggestionOption.vue must not render full defaultProcessRoute text directly in compact suggestion rows.');
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
    "import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';",
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
    'formatProcessNamePreview',
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
    "import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue'",
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
    'formatProcessNamePreview',
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
  if (templateManagerSource.includes("duplicates.join('、')")) {
    addFailure('ProcessTemplateManager.vue must summarize duplicate process names instead of listing every duplicate in warnings.');
  }

  const orderDetailSnippets = [
    ':key="additionalMaterialProcessStepKey(step)"',
    'const additionalMaterialProcessStepKeys = new WeakMap<ProcessStepDetail, string>()',
    'function additionalMaterialProcessStepKey(step: ProcessStepDetail)',
    "import { Minus, Plus, Rank, RefreshLeft, WarningFilled } from '@element-plus/icons-vue';",
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
    'isAdditionalProcessDragAfterRowMiddle(event)',
    "formatOrderDetailListPreview(duplicates, '工序')",
    "formatOrderDetailListPreview(duplicateProcesses, '工序')"
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
  if (orderDetailSource.includes("duplicates.join('、')") || orderDetailSource.includes("duplicateProcesses.join('、')")) {
    addFailure('OrderDetailView.vue must summarize duplicate additional-material process names instead of listing every duplicate in warnings.');
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

function verifyMaterialLibraryTableHeightControls() {
  const viewPath = 'frontend/src/views/MaterialsView.vue';
  if (!fileExists(viewPath)) {
    addFailure(`Missing material library table height control file: ${viewPath}`);
    return;
  }

  const viewSource = readFile(viewPath);
  const requiredSnippets = [
    "import { Minus, Plus, RefreshLeft } from '@element-plus/icons-vue';",
    "type MaterialLibraryWorkTableKey = 'materials' | 'importPreview' | 'applicability' | 'drawing'",
    'materialLibraryWorkTableHeightLimits',
    'materialLibraryWorkTableDefaultHeights',
    'baisheng.erp.materialLibraryWorkTableHeights.v1',
    '零件基础库表格高度只保存为本机 UI 偏好，不写入 Material、适用范围、图纸版本、导入或库存业务数据。',
    'materialLibraryWorkTableHeights = reactive<Record<MaterialLibraryWorkTableKey, number>>',
    'function adjustMaterialLibraryWorkTableHeight',
    'function resetMaterialLibraryWorkTableHeight',
    'function restoreMaterialLibraryWorkTableHeights',
    'function saveMaterialLibraryWorkTableHeights',
    'window.localStorage.getItem(materialLibraryWorkTableHeightStorageKey)',
    'window.localStorage.setItem(',
    'materialLibraryWorkTableHeightStorageKey',
    'aria-label="零件基础资料表格高度"',
    'aria-label="降低零件基础资料表格高度"',
    'aria-label="提高零件基础资料表格高度"',
    'aria-label="恢复零件基础资料表格默认高度"',
    'aria-label="零件库导入预览表格高度"',
    'aria-label="降低零件库导入预览表格高度"',
    'aria-label="提高零件库导入预览表格高度"',
    'aria-label="恢复零件库导入预览表格默认高度"',
    'aria-label="适用范围维护表格高度"',
    'aria-label="降低适用范围维护表格高度"',
    'aria-label="提高适用范围维护表格高度"',
    'aria-label="恢复适用范围维护表格默认高度"',
    'aria-label="图纸版本维护表格高度"',
    'aria-label="降低图纸版本维护表格高度"',
    'aria-label="提高图纸版本维护表格高度"',
    'aria-label="恢复图纸版本维护表格默认高度"',
    ':max-height="materialLibraryWorkTableHeights.materials"',
    ':max-height="materialLibraryWorkTableHeights.importPreview"',
    ':max-height="materialLibraryWorkTableHeights.applicability"',
    ':max-height="materialLibraryWorkTableHeights.drawing"',
    'restoreMaterialLibraryWorkTableHeights();',
    'material-library-table-height-actions',
    'material-library-import-height-toolbar',
    'material-library-dialog-table-header'
  ];
  for (const snippet of requiredSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`MaterialsView.vue must keep adjustable material library table height control snippet: ${snippet}`);
    }
  }
}

function verifyInventorySourceDialogTableHeightControls() {
  const componentPath = 'frontend/src/components/InventorySourceDetailsDialog.vue';
  if (!fileExists(componentPath)) {
    addFailure(`Missing inventory source dialog table height control file: ${componentPath}`);
    return;
  }

  const source = readFile(componentPath);
  const requiredSnippets = [
    "import { computed, reactive, ref, watch } from 'vue';",
    "import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';",
    "type InventorySourceDialogTableKey = 'sources' | 'searchResults' | 'orderPreview'",
    'inventorySourceDialogTableHeightLimits',
    'inventorySourceDialogTableDefaultHeights',
    'baisheng.erp.inventorySourceDialogTableHeights.v1',
    '库存来源弹窗表格和搜索结果高度只保存为本机 UI 偏好，不写入库存批次、预占、订单、生产或库存流水业务数据。',
    'inventorySourceDialogTableHeights = reactive<Record<InventorySourceDialogTableKey, number>>',
    'function adjustInventorySourceDialogTableHeight',
    'function resetInventorySourceDialogTableHeight',
    'function restoreInventorySourceDialogTableHeights',
    'function saveInventorySourceDialogTableHeights',
    'window.localStorage.getItem(inventorySourceDialogTableHeightStorageKey)',
    'window.localStorage.setItem(',
    'inventorySourceDialogTableHeightStorageKey',
    'aria-label="库存来源批次表格高度"',
    'aria-label="降低库存来源批次表格高度"',
    'aria-label="提高库存来源批次表格高度"',
    'aria-label="恢复库存来源批次表格默认高度"',
    'aria-label="替代物料搜索结果高度"',
    'aria-label="降低替代物料搜索结果高度"',
    'aria-label="提高替代物料搜索结果高度"',
    'aria-label="恢复替代物料搜索结果默认高度"',
    'aria-label="订单信息预览表格高度"',
    'aria-label="降低订单信息预览表格高度"',
    'aria-label="提高订单信息预览表格高度"',
    'aria-label="恢复订单信息预览表格默认高度"',
    ':max-height="inventorySourceDialogTableHeights.sources"',
    ':style="{ maxHeight: `${inventorySourceDialogTableHeights.searchResults}px` }"',
    ':max-height="inventorySourceDialogTableHeights.orderPreview"',
    'restoreInventorySourceDialogTableHeights();',
    'inventory-source-table-height-toolbar',
    'inventory-source-table-height-actions',
    'order-preview-table-height-toolbar'
  ];
  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`InventorySourceDetailsDialog.vue must keep adjustable table height control snippet: ${snippet}`);
    }
  }
  const transformSuggestionProcessSnippets = [
    'formatProcessRoutePreview(rule.defaultProcessRoute)',
    ':title="rule.defaultProcessRoute"',
    'function formatProcessRoutePreview',
    '等 ${steps.length} 个工序',
    'transformRuleScopePreview(rule)',
    'transformRuleScopeTitle(rule)',
    'transformRuleDescriptionPreview(rule)',
    'function transformRuleScopeTitle(rule: MaterialTransformRule)',
    'function formatLongTextPreview',
    '完整范围请进入来源加工关系详情核对',
    'class="transform-suggestion-meta"'
  ];
  for (const snippet of transformSuggestionProcessSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`InventorySourceDetailsDialog.vue must summarize transform suggestion process routes: ${snippet}`);
    }
  }
  if (source.includes('建议工艺：{{ rule.defaultProcessRoute }}')) {
    addFailure('InventorySourceDetailsDialog.vue must not render full transform suggestion defaultProcessRoute directly.');
  }
  if (source.includes('{{ rule.scopeLabel }} / 倍率 {{ rule.multiplier }} / 损耗 {{ rule.lossRate ?? \'-\' }}')) {
    addFailure('InventorySourceDetailsDialog.vue must summarize transform suggestion scope labels with tooltip instead of rendering raw scopeLabel in the card.');
  }
  if (source.includes("`适用范围：${rule.scopeLabel || '未设置范围'}`")) {
    addFailure('InventorySourceDetailsDialog.vue transform suggestion tooltip must summarize scopeLabel instead of showing long selected-customer ranges.');
  }
  if (source.includes('<small v-if="rule.conversionDescription">{{ rule.conversionDescription }}</small>')) {
    addFailure('InventorySourceDetailsDialog.vue must summarize transform suggestion conversion descriptions with tooltip instead of rendering full text directly.');
  }
  const manualConfirmationSummarySnippets = [
    'manualConfirmationRemarkPreview(source)',
    'manualConfirmationRemarkTitle(source)',
    'manualConfirmationReasonPreview(source)',
    'manualConfirmationReasonTitle(source)',
    'manualConfirmationReasonPreview(item.source, 42)',
    'compatibilityReasonPreview(row)',
    'compatibilityReasonTitle(row)',
    'function manualConfirmationReasonPreview(source: StockSourceSelectionPayload',
    'function manualConfirmationRemarkPreview(source: Pick<StockSourceSelectionPayload',
    'function compatibilityReasonPreview(row: SourceRow'
  ];
  for (const snippet of manualConfirmationSummarySnippets) {
    if (!source.includes(snippet)) {
      addFailure(`InventorySourceDetailsDialog.vue must summarize manual confirmation and compatibility reasons: ${snippet}`);
    }
  }
  if (source.includes('<template v-if="source.manualConfirmRemark"> / {{ source.manualConfirmRemark }}</template>')) {
    addFailure('InventorySourceDetailsDialog.vue must not render full selected source manual confirmation remark directly.');
  }
  if (source.includes('<span>{{ manualConfirmationReason(item.source) }}</span>')) {
    addFailure('InventorySourceDetailsDialog.vue must summarize manual confirmation reasons in list rows.');
  }
  if (source.includes('{{ compatibilityResult(row).reason }}')) {
    addFailure('InventorySourceDetailsDialog.vue must summarize compatibility reasons in table and mobile list rows.');
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
    'frontend/src/types/erp.ts',
    'backend/src/modules/materials/materials.service.ts',
    'backend/src/modules/inventory/dto.ts',
    'backend/src/modules/inventory/inventory.controller.ts',
    'backend/src/modules/orders/orders.service.ts',
    'backend/src/modules/inventory/inventory.service.ts',
    'database/prisma/verify-first-stage.ts',
    'database/prisma/schema.prisma',
    'database/prisma/seed.ts',
    'scripts/verify-model-bom-scope-approval-api.cjs',
    'scripts/verify-first-stage-api.cjs',
    'package.json'
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
  const modelBomScopeApprovalRegressionSource = readFile('scripts/verify-model-bom-scope-approval-api.cjs');
  const firstStageApiRegressionSource = readFile('scripts/verify-first-stage-api.cjs');
  const packageSource = readFile('package.json');
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
    'bom-line-action-group',
    'bom-line-action-label',
    '组件 ${group.line.componentNo',
    'bom-source-diff-panel',
    'sourceBomForDiff',
    'sourceBomDiffText',
    'copySourceBomDiffText',
    'bom-source-diff-actions',
    'sourceBomReviewDialogVisible',
    'selectedSourceBomDiffIssue',
    'sourceBomReviewListDialogVisible',
    'bom-source-diff-action-group',
    'bom-source-diff-action-label',
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
    'sourceBomReviewLinePreview',
    'sourceBomReviewLineTitle',
    'formatModelBomLongTextPreview(sourceBomReviewLineText(line), 44, \'无对应行\')',
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
    '<el-table-column label="操作" width="300" fixed="right">',
    'model-bom-row-actions',
    'model-bom-row-action-group',
    'model-bom-row-action-label',
    'title="复制给客户"',
    'title="删除误建空 BOM"',
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
    'effectiveCount: summary.effectiveCount',
    '厚度已确认 ${summary.confirmedThicknessCount} / 历史参考 ${summary.historyThicknessCount} / 无厚度 ${summary.noThicknessCount} / 需核对 ${summary.missingThicknessCount}',
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
    'formatLineThicknessReviewReasonPreview(row)',
    'function formatLineThicknessReviewReasonPreview(row: ModelBomLine)',
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
    '<el-button title="复制核对清单" :disabled="!thicknessReviewText" @click="copyThicknessReviewText">复制核对清单</el-button>',
    '@row-click="handleThicknessReviewLineAction"',
    'table-card bom-thickness-review-table-card',
    ':row-class-name="thicknessReviewRowClassName"',
    'async function handleThicknessReviewLineAction(row: ModelBomLine)',
    "guardDesktopOperation('核对并保存 BOM 明细厚度')",
    'function lineThicknessReviewActionTitle(row: ModelBomLine)',
    'function thicknessReviewRowClassName({ row }: { row: ModelBomLine })',
    '!isMobileLayout.value && lineNeedsThicknessReview(row)',
    'bom-thickness-review-table__row',
    ':title="modelBomListThicknessReviewTitle(row)"',
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
    'routeTargetBomManuallySelected',
    'routeTargetMultipleBomChoiceWarned',
    'selectRouteCreateLineTargetBom',
    'isExactRouteCreateLineBom',
    'routeCreateLineExactBoms',
    'routeCreateLineNeedsManualBomChoice',
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
    "loadModelBomScopePages({ customerId: customerId || undefined, projectModel, status: 'ALL' })",
    'guardDuplicateCustomerBomCopy',
    'guardExistingBomBeforeRouteCreateLine',
    'guardDuplicateBomScopeBeforeSave',
    '同一客户同一机型允许保留多个不同用途 BOM',
    '同一客户同一机型可以保存多个 BOM',
    '后端仍按同名 + 范围查重',
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
    '当前客户/机型范围存在多个 BOM',
    '系统不会自动选择，避免加错 BOM',
    '机型零件包启用失败，请确认后端服务、BOM 状态或同名范围重复',
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
    'bomVisibleCustomerIds',
    'bomCustomerScopeExposesNewCustomers',
    'bomCustomerScopeExpansionNeedsConfirmation',
    'bomCustomerScopeTypeImpactText',
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
    'modelBomScopeText(row)',
    'modelBomScopeTitle(row)',
    'class="model-bom-scope-cell"',
    'function modelBomScopeTitle(row: ModelBom)',
    '完整客户范围请进入 BOM 详情核对',
    'formatCustomerNamePreview',
    'row.scopeCustomerCount',
    'displayTotal',
    '等 ${displayTotal} 个客户',
    'activeBomDetail',
    'loadActiveBomDetail',
    'activeBomDetailLoading',
    '列表只显示摘要；需核对',
    'row.lineSummary || summarizeModelBomLines(row.lines || [])',
    'await erpApi.modelBom(row.id)',
    '列表只展示客户范围摘要；编辑前重新读取完整 BOM',
    'formatCustomerNamePreview(selectedNames)',
    "formatCustomerNamePreview(scopeCustomerNames, '指定客户', row.scopeCustomerCount)",
    "formatCustomerNamePreview(customerNames, '指定客户')",
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
    'modelBomScopeGuideDescriptionPreview(item.description)',
    'function modelBomScopeGuideDescriptionPreview(description: string)',
    'modelBomRevisionChangeRemarkPreview(row)',
    'modelBomRevisionChangeRemarkTitle(row)',
    'modelBomRevisionChangedByPreview(row)',
    'modelBomRevisionChangedByTitle(row)',
    'modelBomRevisionChangeRemarkPreview(selectedBomRevision)',
    'sourceBomDiffReviewRemarkPreview(row)',
    'sourceBomDiffReviewRemarkTitle(row)',
    'sourceBomDiffReviewIssuePreview(row)',
    'sourceBomDiffReviewIssueTitle(row)',
    'sourceBomDiffReviewLoading',
    'sourceBomDiffReviewPagination',
    'sourceBomDiffReviewHasMore',
    ':loading="sourceBomDiffReviewLoading"',
    'v-loading="sourceBomDiffReviewLoading"',
    '@click="loadSourceBomDiffReviews()"',
    'loadMoreSourceBomDiffReviews',
    '已显示 {{ sourceBomDiffReviews.length }} / {{ sourceBomDiffReviewPagination.total }} 条核对记录',
    'const result = await erpApi.modelBomDiffReviewsPage',
    'sourceBomReviewedDiffKeys.value = new Set(result.reviewKeys)',
    'await loadSourceBomDiffReviews();',
    '查看核对记录 {{ sourceBomDiffReviews.length }} 条',
    'formatBomScopeReviewCellPreview(row.before)',
    'formatBomScopeReviewCellTitle(row.before)',
    'formatBomScopeApprovalRequestedScopePreview(row)',
    'formatBomScopeApprovalRequestedScopeTitle(row)',
    'formatBomScopeApprovalReasonPreview(row)',
    'formatBomScopeApprovalReasonTitle(row)',
    'formatBomScopeApprovalReviewPreview(row)',
    'formatBomScopeApprovalReviewTitle(row)',
    'bomScopeApprovalHasMore',
    'refreshBomScopeApprovalRequests',
    '@change="refreshBomScopeApprovalRequests()"',
    '@click="refreshBomScopeApprovalRequests()"',
    'loadMoreBomScopeApprovalRequests',
    'loadBomScopeApprovalRequests(options: { append?: boolean } = {})',
    'const offset = options.append ? bomScopeApprovalRequests.value.length : 0;',
    'options.append ? [...bomScopeApprovalRequests.value, ...result.items] : result.items',
    '加载更多',
    'scope-approval-actions',
    'scope-approval-action-group',
    'scope-approval-row-actions',
    'scope-approval-action-label',
    'function modelBomRevisionChangeRemarkPreview(revision?: ModelBomRevision | null)',
    'function modelBomRevisionChangedByPreview(revision?: ModelBomRevision | null)',
    'function sourceBomDiffReviewRemarkPreview(review: ModelBomDiffReview)',
    'function sourceBomDiffReviewIssuePreview(review: ModelBomDiffReview)',
    'function formatBomScopeApprovalReasonPreview(row: ModelBomScopeApprovalRequest)',
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
    'explicitBomLineDefaultProcessRoute',
    "row.defaultProcessRouteSource === 'BOM_LINE'",
    'row.bomLineDefaultProcessRoute',
    'formatLineDefaultProcessRoute',
    'formatLineDefaultProcessRouteFull',
    'function formatProcessRoutePreview',
    'formatProcessRoutePreview(row.defaultProcessRoute)',
    'formatBomRevisionLineDefaultProcessRoute',
    'formatBomRevisionLineDefaultProcessRouteTitle',
    'function formatBomRevisionLineDefaultProcessRouteTitle(row: ModelBomRevisionSnapshotLine)',
    'formatBomRevisionLinePartCode(row)',
    'formatBomRevisionLinePartName(row)',
    'formatBomRevisionLineDrawingTitle(row)',
    'formatBomRevisionLineSpecification(row)',
    'function formatBomRevisionLinePartCode(row: ModelBomRevisionSnapshotLine)',
    'function formatBomRevisionLineDrawingText(row: ModelBomRevisionSnapshotLine)',
    '等 ${steps.length} 个工序',
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
    "import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';",
    "type ModelBomWorkTableKey = 'list' | 'lines' | 'scopeReview' | 'thicknessReview' | 'sourceDiffFields' | 'sourceDiffReviews';",
    'const modelBomWorkTableKeys: ModelBomWorkTableKey[]',
    'modelBomWorkTableHeightLimits',
    'modelBomWorkTableDefaultHeights',
    'modelBomWorkTableHeightStorageKey',
    '机型零件包维护和核对弹窗表格高度只作为本机 UI 偏好，不写入 BOM、订单、生产或库存业务资料。',
    'const modelBomWorkTableHeights = reactive<Record<ModelBomWorkTableKey, number>>',
    'function adjustModelBomWorkTableHeight',
    'function resetModelBomWorkTableHeight',
    'function restoreModelBomWorkTableHeights',
    'function saveModelBomWorkTableHeights',
    'localStorage.getItem(modelBomWorkTableHeightStorageKey)',
    ':max-height="modelBomWorkTableHeights.list"',
    'modelBomWorkTableHeights.lines',
    ':max-height="modelBomWorkTableHeights.scopeReview"',
    ':max-height="modelBomWorkTableHeights.thicknessReview"',
    ':max-height="modelBomWorkTableHeights.sourceDiffFields"',
    ':max-height="modelBomWorkTableHeights.sourceDiffReviews"',
    'scopeReview: modelBomWorkTableHeights.scopeReview',
    'thicknessReview: modelBomWorkTableHeights.thicknessReview',
    'sourceDiffFields: modelBomWorkTableHeights.sourceDiffFields',
    'sourceDiffReviews: modelBomWorkTableHeights.sourceDiffReviews',
    'aria-label="降低零件包列表表格高度"',
    'title="降低零件包列表表格高度"',
    'aria-label="提高 BOM 明细表格高度"',
    'title="提高 BOM 明细表格高度"',
    'aria-label="恢复 BOM 明细表格默认高度"',
    'title="恢复 BOM 明细表格默认高度"',
    'aria-label="BOM 适用范围核对表格高度"',
    'aria-label="降低 BOM 适用范围核对表格高度"',
    'title="降低 BOM 适用范围核对表格高度"',
    'aria-label="提高 BOM 适用范围核对表格高度"',
    'title="提高 BOM 适用范围核对表格高度"',
    'aria-label="BOM 厚度核对表格高度"',
    'aria-label="降低 BOM 厚度核对表格高度"',
    'title="降低 BOM 厚度核对表格高度"',
    'aria-label="提高 BOM 厚度核对表格高度"',
    'title="提高 BOM 厚度核对表格高度"',
    'aria-label="来源 BOM 差异字段表格高度"',
    'aria-label="降低来源 BOM 差异字段表格高度"',
    'title="降低来源 BOM 差异字段表格高度"',
    'aria-label="提高来源 BOM 差异字段表格高度"',
    'title="恢复来源 BOM 差异字段表格默认高度"',
    'aria-label="来源 BOM 差异核对记录表格高度"',
    'aria-label="降低来源 BOM 差异核对记录表格高度"',
    'title="导出来源 BOM 差异核对记录"',
    'title="刷新来源 BOM 差异核对记录"',
    'title="降低来源 BOM 差异核对记录表格高度"',
    'aria-label="提高来源 BOM 差异核对记录表格高度"',
    'title="提高来源 BOM 差异核对记录表格高度"',
    'title="恢复来源 BOM 差异核对记录表格默认高度"',
    'model-bom-table-height-actions',
    'model-bom-dialog-table-toolbar',
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
  if (modelBomSource.includes("{{ row.defaultProcessRoute || '-' }}") || modelBomSource.includes("row.defaultProcessRoute || '-',")) {
    addFailure('ModelBomsView.vue must summarize default process routes instead of rendering full process route text in BOM tables or snapshots.');
  }
  if (/<el-table-column\s+prop="defaultProcessRoute"\s+label="[^"]*"\s+min-width="180"\s+show-overflow-tooltip\s*>/.test(modelBomSource)) {
    addFailure('ModelBomsView.vue must use explicit defaultProcessRoute preview/title in BOM revision snapshots instead of raw show-overflow-tooltip.');
  }
  if (/<el-table-column\s+prop="part(?:Code|Name|Specification)Snapshot"\s+label="[^"]*"\s+min-width="(?:150|160|180)"\s+show-overflow-tooltip\s*\/>/.test(modelBomSource)) {
    addFailure('ModelBomsView.vue must summarize BOM revision snapshot part fields with explicit title text instead of raw show-overflow-tooltip.');
  }
  if (/<el-table-column\s+label="默认图纸"\s+min-width="180"\s+show-overflow-tooltip\s*>/.test(modelBomSource)) {
    addFailure('ModelBomsView.vue must summarize BOM revision snapshot drawing text with explicit title text instead of raw show-overflow-tooltip.');
  }
  if (/<el-table-column\s+prop="(before|after|impact)"\s+label="[^"]*"\s+min-width="(?:170|220)"\s+show-overflow-tooltip\s*\/>/.test(modelBomSource)) {
    addFailure('ModelBomsView.vue must summarize BOM scope review before/after/impact cells with explicit title text.');
  }
  if (/<el-table-column\s+prop="issueTitle"\s+label="[^"]*"\s+min-width="260"\s+show-overflow-tooltip\s*\/>/.test(modelBomSource)) {
    addFailure('ModelBomsView.vue must summarize source BOM diff review issue titles instead of raw show-overflow-tooltip.');
  }
  if (/<el-table-column\s+prop="(requestNo|bomName|reason)"\s+label="[^"]*"\s+min-width="(?:180|210|220)"\s+show-overflow-tooltip\s*\/>/.test(modelBomSource)) {
    addFailure('ModelBomsView.vue must summarize BOM scope approval request text columns instead of raw show-overflow-tooltip.');
  }
  if (modelBomSource.includes('<el-table-column prop="scopeLabel" label="适用范围"')) {
    addFailure('ModelBomsView.vue must render BOM scope through summarized text plus tooltip instead of raw scopeLabel column.');
  }
  if (modelBomSource.includes('return row.scopeLabel || `${modelBomScopeTypeLabel(row)}')) {
    addFailure('ModelBomsView.vue modelBomScopeText must build a compact scope summary instead of returning raw scopeLabel.');
  }
  if (/row\.bomName,\s*row\.scopeLabel,\s*modelBomCustomerText/.test(modelBomSource)) {
    addFailure('ModelBomsView.vue fixed-format BOM copy must use modelBomScopeText(row) instead of raw scopeLabel.');
  }
  if (modelBomSource.includes("formatCustomerNameDetail(scopeCustomerNames, '指定客户')")) {
    addFailure('ModelBomsView.vue selected-customer scope tooltip must use the compact customer preview, not the longer detail list.');
  }
  if (/modelBomScope(?:Text|Title|CustomerText)[\s\S]{0,600}formatCustomerNameDetail/.test(modelBomSource)) {
    addFailure('ModelBomsView.vue BOM list scope text and tooltip must not call formatCustomerNameDetail because selected-customer ranges can become very long.');
  }
  if (modelBomSource.includes('scopeRank[nextScope] > scopeRank[previousScope]')) {
    addFailure('ModelBomsView.vue must not treat every PRIVATE -> SELECTED change as visibility expansion; expansion depends on newly visible customers.');
  }
  if (/\/\/[^\n]*return nextVisibleCustomerIds\.some/.test(inventoryServiceSource)) {
    addFailure('inventory.service.ts must not leave modelBomCustomerScopeExposesNewCustomers return inside a line comment.');
  }
  if (!inventoryServiceSource.includes('return nextVisibleCustomerIds.some((customerId) => !previousCustomerIds.has(customerId));')) {
    addFailure('inventory.service.ts must actively return whether BOM scope exposes any newly visible customer.');
  }
  if (!modelBomSource.includes('impact: bomCustomerScopeTypeImpactText()')) {
    addFailure('ModelBomsView.vue BOM scope review rows must use bomCustomerScopeTypeImpactText for customer scope type impact.');
  }
  if (!modelBomSource.includes("return removedCustomerNames.length ? '可见客户减少' : '可见客户不变';")) {
    addFailure('ModelBomsView.vue BOM scope type impact must distinguish same-customer scope changes from customer removals.');
  }
  if (!modelBomSource.includes('sourceBomDiffIssueDetailPreview(issue)') || !modelBomSource.includes('function sourceBomDiffIssueDetailPreview(issue: BomDiffIssue')) {
    addFailure('ModelBomsView.vue must summarize source BOM diff issue details in the list and review dialog.');
  }
  if (modelBomSource.includes('<span>{{ issue.detail }}</span>') || modelBomSource.includes('<span>{{ selectedSourceBomDiffIssue.detail }}</span>')) {
    addFailure('ModelBomsView.vue must not render full source BOM diff issue details directly.');
  }
  if (modelBomSource.includes('${sourceBomDiffStatusLabel(issue)} | ${issue.title} | ${issue.detail} |')) {
    addFailure('ModelBomsView.vue fixed-format source BOM diff copy must use sourceBomDiffIssueDetailPreview instead of raw issue.detail.');
  }
  if (modelBomSource.includes('<span>{{ item.description }}</span>')) {
    addFailure('ModelBomsView.vue must summarize BOM scope guide descriptions with tooltip.');
  }
  if (modelBomSource.includes('<span class="thickness-review-reason">{{ formatLineThicknessReviewReason(row) }}</span>')) {
    addFailure('ModelBomsView.vue must summarize BOM thickness review reasons in the review list.');
  }
  if (modelBomSource.includes('<el-descriptions-item label="备注">{{ selectedBomRevision.changeRemark || \'-\' }}</el-descriptions-item>')) {
    addFailure('ModelBomsView.vue must summarize BOM revision change remarks instead of rendering full text directly.');
  }
  if (/<el-table-column\s+prop="changedBy"\s+label="[^"]*"\s+min-width="130"\s+show-overflow-tooltip\s*\/>/.test(modelBomSource)) {
    addFailure('ModelBomsView.vue must summarize BOM revision changedBy text with explicit title text instead of raw show-overflow-tooltip.');
  }
  if (modelBomSource.includes("<template #default=\"{ row }\">{{ row.reviewRemark || '保留为客户 BOM 差异' }}</template>")) {
    addFailure('ModelBomsView.vue must summarize source BOM diff review remarks instead of rendering full text directly.');
  }
  if (
    modelBomSource.includes('<p>{{ sourceBomReviewLineText(selectedSourceBomDiffIssue.sourceLine) }}</p>') ||
    modelBomSource.includes('<p>{{ sourceBomReviewLineText(selectedSourceBomDiffIssue.targetLine) }}</p>')
  ) {
    addFailure('ModelBomsView.vue must summarize source BOM review line text in the comparison dialog.');
  }
  if (modelBomSource.includes("reviewedBy: '系统操作员'") || modelBomSource.includes("|| '系统操作员'")) {
    addFailure('ModelBomsView.vue BOM diff review must require an explicit reviewer instead of falling back to 系统操作员.');
  }
  if (
    modelBomSource.includes('sourceBomDiffReviewPagination.total + 1') ||
    modelBomSource.includes('sourceBomDiffReviewPagination.total - 1')
  ) {
    addFailure('ModelBomsView.vue must reload BOM diff review pagination after confirm/revoke instead of locally shifting totalCount.');
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
  const deleteModelBomBlock = inventoryServiceSource.match(/async deleteModelBom\(bomId: string\) \{[\s\S]*?\n  private handleModelBomNameUniqueError/);
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
    'loadModelBomPages({',
    'contextBomSummary',
    'bom.lineSummary.effectiveCount',
    '列表仅显示摘要；查看/编辑时读取完整 BOM 明细。',
    'contextBomPreviewLines',
    'contextBomScopePreview(bom)',
    'contextBomScopeTitle(bom)',
    'function contextBomScopeTitle(bom: ModelBom)',
    '完整范围请进入 BOM 详情核对；常用只影响当前范围的显示顺序和下单推荐优先级',
    'class="context-bom-scope-text"',
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
    '复制范围链接',
    'copyContextBomFilterLink',
    '范围链接：${dashboardFilterLink()}',
    '当前适用零件包范围链接只用于复现 BOM 范围视图，不新增、覆盖或停用任何 BOM 明细。',
    'pushContextBomCreate',
    'title="新建当前范围零件包" @click="openContextBomCreate"',
    'title="新建当前范围常用零件包" @click="openContextCommonBomCreate"',
    'openContextBomCopy',
    'contextCustomerBomForSource',
    'canCopyContextBomToCustomer',
    'openContextCustomerBomDetail',
    '已有客户 BOM，可新建副本',
    '请选择客户，并从百胜通用 BOM 复制生成客户 BOM',
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
    'materialBomNameValues(row)',
    'materialBomCount(row)',
    'materialBomStructureCount(row)',
    'materialRowHasBomUsage(row)',
    'materialBomUsageText(row)',
    'materialBomUsageTitle(row)',
    'materialTypeText(row)',
    'materialScopeText(row)',
    'function materialScopeText(row: MaterialDashboardRow)',
    'materialTypeTitle(row)',
    'function materialTypeTitle(row: MaterialDashboardRow)',
    'materialRelationText(row)',
    'materialRelationDescriptionTitle(row)',
    'function materialRelationText(row: MaterialDashboardRow)',
    'function materialRelationDescriptionTitle(row: MaterialDashboardRow)',
    'function formatLongTextPreview',
    'materialBomStructurePreviewText',
    'formatBomNamePreview',
    "function joinPreview(values: string[], emptyText = '-', totalCount?: number)",
    'const displayCount = Math.max(totalCount || 0, filtered.length);',
    'BOM：${materialBomUsageText(row)}',
    "formatBomNamePreview(bomNames, '-', bomCount)",
    "function formatBomNamePreview(names: Array<string | null | undefined>, emptyText = '-', totalCount?: number)",
    '等 ${displayCount} 个 BOM',
    '等 ${totalCount} 条',
    'formatProcessRoutePreview(row.defaultProcessRoute)',
    'function formatProcessRoutePreview',
    '等 ${steps.length} 个工序',
    "formatCustomerNamePreview(scopeNames, '-', scopeTotal)",
    "formatCustomerNamePreview(historyNames, '-', historyTotal)",
    "formatCustomerNamePreview(names, '指定客户', bom.scopeCustomerCount)",
    "function formatCustomerNamePreview(names: Array<string | null | undefined>, emptyText = '-', totalCount?: number)",
    'const displayCount = Math.max(totalCount || 0, filtered.length);',
    'RELATION_DETAIL_TAG_PREVIEW_LIMIT',
    'relationDetailVisibleCustomerNames',
    'relationDetailCustomerTotalCount',
    'relationDetailHiddenCustomerNameCount',
    'relationDetailVisibleHistoryCustomerNames',
    'relationDetailHiddenHistoryCustomerNameCount',
    'relationDetailVisibleBomNames',
    'relationDetailBomTotalCount',
    'relationDetailHiddenBomNameCount',
    'relationDetailBomTotalCount.value - relationDetailVisibleBomNames.value.length',
    '还有 {{ relationDetailHiddenBomNameCount }} 个 BOM 名称未在弹窗中展开',
    '等 ${displayCount} 个客户',
    'materialDashboardStringValues',
    'materialDashboardBomStructureDetails',
    'materialDashboardBomStructureLabels',
    'relationDetailRow.value ? materialBomNameValues(relationDetailRow.value) : []',
    '...materialDashboardBomStructureDetails(row).map((detail) => detail.bomName)',
    ':content="materialBomUsageTitle(row)"',
    'openRelationDetail(row, \'customer\')',
    'openRelationDetail(row, \'bom\')',
    'relationDetailDialogVisible',
    'relationDetailCustomerNames',
    'relationDetailBomStructures',
    'relationDetailVisibleBomStructures',
    'relationDetailHiddenBomStructureCount',
    'relationDetailRow.value?.bomStructureDetailCount',
    '还有 {{ relationDetailHiddenBomStructureCount }} 条 BOM 结构明细未在弹窗中展开',
    'relation-detail-scroll',
    'max-height: min(42vh, 360px);',
    '<el-table-column label="操作" width="280" fixed="right">',
    'material-dashboard-actions',
    'material-dashboard-action-group',
    'material-dashboard-action-label',
    'title="维护图纸版本"',
    'title="维护适用范围"',
    'title="编辑零件资料"',
    ':title="bomMaintainActionTitle(row)"',
    'function bomMaintainActionTitle(row: MaterialDashboardRow)',
    '加入当前客户/机型 BOM',
    '查看或维护 BOM 使用情况',
    'title="查看库存来源"',
    'title="停用零件搜索记忆"',
    'title="启用零件搜索记忆"',
    'inline-detail-button',
    '先选择机型/项目后加入 BOM',
    '当前客户/机型 BOM 未包含',
    '当前范围未进 BOM',
    '选择客户或机型后可加入 BOM',
    'row.currentScopeBomLineCount !== undefined',
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
    'materialProjectScopeText(row)',
    'materialProjectScopeTitle(row)',
    'function materialProjectScopeTitle(row: MaterialDashboardRow)',
    "joinPreview(values, '全部机型/项目')",
    'row.historyProjectModelCount',
    '仅订单历史 ${historyCount} 个机型',
    '仅有订单历史机型 / 项目：${joinPreview(historyModels',
    '适用机型 / 项目：${totalCount} 个，列表未展开预览',
    '查看固定格式',
    '复制筛选链接',
    '零件管理固定格式清单',
    'class="fixed-format-textarea"',
    'row.drawingSourceLabel',
    '零件最新图纸',
    'row.bomStructureLabel',
    'row.bomStructureLabels',
    'row.bomStructureDetails',
    'dashboardBomStructureSummary',
    'dashboardBomStructureDetailText',
    'materialBomStructurePreviewText(details, totalCount, dashboardBomStructureDetailText)',
    'detailText = relationBomStructureDetailText',
    'map(detailText)',
    'BOM 名称预览未展开',
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
    "'contextBomScope'",
    "'contextBomCommonOnly'",
    'BOM 范围：${contextBomScopeFilterLabel(contextBomScopeFilter.value)}',
    '状态：${statusFilterLabel(filters.status)}',
    "label: 'BOM：只看常用'",
    'routeEnumFilter',
    'routeDateRange',
    'routeBooleanFilter',
    'route.query.drawingNo',
    'route.query.drawingDateFrom',
    'route.query.bomStructureType',
    'route.query.recentOrderPresence',
    'route.query.lastOrderDateTo',
    'route.query.sortBy',
    'route.query.contextBomScope',
    'route.query.contextBomCommonOnly',
    'contextBomScope: contextBomScopeFilter.value || undefined',
    "contextBomCommonOnly: contextBomCommonOnly.value ? 'true' : undefined",
    'title="刷新整页零件管理数据"',
    'const materialDashboardRefreshing = ref(false)',
    'async function refreshMaterialsManagementPage()',
    'Promise.all([loadCommonProjectModels(), loadProjectOptions(), loadDashboard(), loadContextBoms()])',
    'filters.keyword = keyword;',
    "filters.scopeType = scopeType || '';",
    "filters.status = status ?? 'ENABLED';",
    'drawingDateRange.value = routeDateRange(route.query.drawingDateFrom, route.query.drawingDateTo);',
    "contextBomScopeFilter.value = contextBomScope || '';",
    'contextBomCommonOnly.value = contextBomCommon ?? false;',
    'normalizeBomPresenceFilters();',
    'active-filter-bar',
    'active-filter-chip',
    '清除全部',
    'formatRangeText',
    'summary-filter-chip',
    'relation-boundary-alert',
    '订单历史不等于正式适用范围',
    '不会自动变成全部客户通用、客户私有 BOM 或正式适用范围',
    'relationBomStructureDetailText(detail)',
    'relationDetailCustomerTotalCount === 0',
    'relationDetailHistoryCustomerTotalCount === 0',
    'relationDetailBomTotalCount === 0',
    'relationDetailBomStructureTotalCount > 0',
    "drawingSource: filters.drawingSource || undefined",
    "bomStructureType: filters.bomStructureType || undefined",
    "bomPresence: filters.bomPresence || undefined",
    "recentOrderPresence: filters.recentOrderPresence || undefined",
    'sortBy: filters.sortBy',
    'sortOrder: filters.sortOrder',
    '零件控制面板加载失败，请确认后端服务',
    '机型 / 项目选项加载失败，请确认客户筛选和后端服务',
    '当前适用零件包加载失败，请确认客户、机型和后端服务',
    'scopeTypeFilterLabel',
    'drawingSourceFilterLabel',
    'bomStructureFilterLabel',
    'bomPresenceFilterLabel',
    'recentOrderPresenceFilterLabel',
    'statusFilterLabel',
    'dashboardSortByLabel',
    'dashboardSortOrderLabel',
    'dashboardFilterRouteQuery',
    'dashboardFilterLink',
    'copyDashboardFilterLink',
    '筛选链接：${dashboardFilterLink()}',
    '筛选链接只用于复现控制面板视图，不写入零件、BOM、订单、生产任务或库存流水。',
    "import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';",
    'materialDashboardTableHeightLimits',
    'materialDashboardTableDefaultHeight',
    'materialDashboardTableHeightStorageKey',
    'materialDashboardTableHeight',
    'function adjustMaterialDashboardTableHeight',
    'function resetMaterialDashboardTableHeight',
    'function restoreMaterialDashboardTableHeight',
    'function saveMaterialDashboardTableHeight',
    'localStorage.getItem(materialDashboardTableHeightStorageKey)',
    ':max-height="materialDashboardTableHeight"',
    'aria-label="降低零件控制面板表格高度"',
    'aria-label="提高零件控制面板表格高度"',
    'aria-label="恢复零件控制面板表格默认高度"',
    'material-dashboard-table-height-actions',
    "status: filters.status || 'ALL'",
    "sortBy: filters.sortBy !== 'LAST_ORDER_DATE' ? filters.sortBy : undefined",
    "sortOrder: filters.sortOrder !== 'DESC' ? filters.sortOrder : undefined",
    'BOM 结构',
    'BOM 状态',
    'withoutBomCount',
    '下单记录',
    'withoutRecentOrderCount',
    '排序字段',
    '通用 / 定制 ${scopeTypeFilterLabel(filters.scopeType)}',
    '类型：${materialTypeText(row)}；状态：${statusFilterLabel(row.status)}',
    '来源：${row.drawingSourceLabel',
    '结构：${dashboardBomStructureSummary(row)}',
    '状态 ${statusFilterLabel(filters.status)}',
    '核对说明：固定格式清单只用于人工复核，不会写入零件、BOM、订单、生产任务或库存流水。',
    '核对：图纸 ${dashboardDrawingReviewText(row)}；BOM ${dashboardBomReviewText(row)}；库存 ${dashboardInventoryReviewText(row)}',
    'dashboardDrawingReviewText',
    'dashboardBomReviewText',
    'dashboardInventoryReviewText',
    '固定格式库存核对只提示人工复核，不自动补单、提交生产、扣库存或写入 InventoryTransaction。',
    "return joinPreview(materialDashboardBomStructureLabels(row), row.bomStructureLabel || '-')",
    'materialBomStructurePreviewText(details, totalCount, dashboardBomStructureDetailText)',
    'detailText = relationBomStructureDetailText',
    'map(detailText)',
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
  if (materialDashboardSource.includes("names.join('、')")) {
    addFailure('MaterialsManagementView.vue customer scope text must summarize customer names instead of listing every selected customer.');
  }
  if (/function materialCustomerScopeText[\s\S]*?return row\.customerScopeLabel/.test(materialDashboardSource)) {
    addFailure('MaterialsManagementView.vue customer scope list cell must derive a compact summary from scope kind/count instead of rendering raw customerScopeLabel.');
  }
  if (materialDashboardSource.includes("row.defaultProcessRoute || '-'")) {
    addFailure('MaterialsManagementView.vue must summarize default process routes instead of rendering the full route in table/fixed text.');
  }
  if (materialDashboardSource.includes("row.bomStructureDetails.map((detail) => `${detail.structureLabel} @ ${detail.bomName}`).join('；')")) {
    addFailure('MaterialsManagementView.vue BOM structure summary must use joinPreview instead of listing every BOM structure detail.');
  }
  if (materialDashboardSource.includes('`${detail.structureLabel} @ ${detail.bomName}`')) {
    addFailure('MaterialsManagementView.vue BOM structure summaries must use relationBomStructureDetailText instead of short structure @ bomName strings.');
  }
  if (materialDashboardSource.includes('dashboardBomStructureTextLines(row)') || materialDashboardSource.includes('function dashboardBomStructureTextLines')) {
    addFailure('MaterialsManagementView.vue fixed-format dashboard text must keep BOM usage summarized; full BOM details belong in the BOM usage dialog or export.');
  }
  if (materialDashboardSource.includes('<span>{{ dashboardBomStructureDetailText(detail) }}</span>')) {
    addFailure('MaterialsManagementView.vue BOM usage detail dialog must use relationBomStructureDetailText so bomName is not repeated in the same row.');
  }
  if (!/function materialBomStructurePreviewText[\s\S]*?detailText = relationBomStructureDetailText[\s\S]*?map\(detailText\)/.test(materialDashboardSource)) {
    addFailure('MaterialsManagementView.vue BOM usage tooltip must use relationBomStructureDetailText to keep structure previews compact.');
  }
  if (
    materialDashboardSource.includes('!relationDetailCustomerNames.length') ||
    materialDashboardSource.includes('!relationDetailHistoryCustomerNames.length') ||
    materialDashboardSource.includes('!relationDetailBomNames.length')
  ) {
    addFailure('MaterialsManagementView.vue relation detail empty states must use total counts instead of preview array length.');
  }
  if (materialDashboardSource.includes('if (!row.bomNames.length)')) {
    addFailure('MaterialsManagementView.vue BOM checks must use materialBomCount(row), because bomNames can be only a truncated preview.');
  }
  if (materialDashboardSource.includes('<span>{{ bom.scopeLabel }}</span>')) {
    addFailure('MaterialsManagementView.vue context BOM cards must summarize scopeLabel with tooltip instead of rendering raw scope text.');
  }
  if (/function contextBomScopeTitle[\s\S]*bom\.scopeLabel \|\| contextBomScopePreview/.test(materialDashboardSource)) {
    addFailure('MaterialsManagementView.vue context BOM tooltip must use the compact scope preview instead of raw scopeLabel.');
  }
  if (materialDashboardSource.includes('{{ row.partType || row.scopeLabel }}')) {
    addFailure('MaterialsManagementView.vue material type chips must not fall back to raw scopeLabel in list cells.');
  }
  if (materialDashboardSource.includes("`范围摘要：${row.scopeLabel || '-'}`")) {
    addFailure('MaterialsManagementView.vue material type tooltip must use compact customer/project scope text instead of raw scopeLabel.');
  }
  if (materialDashboardSource.includes("<span>{{ row.currentRelationLabel || '-' }}</span>")) {
    addFailure('MaterialsManagementView.vue mobile relation cells must use materialRelationText and materialRelationDescriptionTitle instead of raw relation text.');
  }
  if (materialDashboardSource.includes("return `适用机型 / 项目：${values.join('、')}`")) {
    addFailure('MaterialsManagementView.vue material project scope title must use joinPreview instead of listing every project/model.');
  }
  if (materialDashboardSource.includes("return values[0] || '全部机型';")) {
    addFailure('MaterialsManagementView.vue material project scope text must not treat missing preview values as 全部机型 when total count is positive.');
  }
  if (/function materialProjectScopeTitle[\s\S]*if \(values\.length === 0\)\s*{\s*return '全部机型\/项目';/.test(materialDashboardSource)) {
    addFailure('MaterialsManagementView.vue material project scope title must use total count before preview array length.');
  }
  if (materialDashboardSource.includes("row.bomStructureDetails?.length ? '当前客户/机型 BOM 未包含' : '当前范围未进 BOM'")) {
    addFailure('MaterialsManagementView.vue BOM empty text must use bomStructureDetailCount instead of preview array length.');
  }
  if (materialDashboardSource.includes('bomCount || structureCount')) {
    addFailure('MaterialsManagementView.vue BOM usage summary must not report structure line count as BOM count.');
  }
  if (/function dashboardBomReviewText[\s\S]*?if \(materialBomCount\(row\) <= 0\)/.test(materialDashboardSource)) {
    addFailure('MaterialsManagementView.vue fixed-format BOM review must use materialRowHasBomUsage so structure-only rows are not marked as 未进 BOM.');
  }
  if (materialDashboardSource.includes("BOM：${joinPreview(materialBomNameValues(row), '-', materialBomCount(row))}")) {
    addFailure('MaterialsManagementView.vue fixed-format BOM line must use materialBomUsageText so structure-only rows are summarized correctly.');
  }
  if (materialDashboardSource.includes('另有 ${totalCount - visibleCount} 条未展开')) {
    addFailure('MaterialsManagementView.vue fixed BOM structure summary must not double-count hidden rows after materialBomStructurePreviewText already includes the total.');
  }
  const materialDashboardServiceDefaultSort = materialsServiceSource.match(
    /private compareDashboardDefault[\s\S]*?\n  private compareDashboardNullableTime/
  )?.[0] || '';
  if (materialDashboardServiceDefaultSort.includes('updatedAt')) {
    addFailure('materials.service.ts compareDashboardDefault must not use updatedAt; first stage does not use material maintenance time as business ranking.');
  }
  if (materialsServiceSource.includes("orderBy: [{ updatedAt: 'desc' }, { partCode: 'asc' }]")) {
    addFailure('materials.service.ts material dashboard query must not use updatedAt as the default material ranking.');
  }
  if (!materialsServiceSource.includes("orderBy: [{ partCode: 'asc' }, { id: 'asc' }]")) {
    addFailure('materials.service.ts material dashboard query must keep stable partCode/id ordering before in-memory business sorting.');
  }
  if (materialsServiceSource.includes('updatedAt: material.updatedAt') || materialsServiceSource.includes('createdAt: material.createdAt')) {
    addFailure('materials.service.ts material dashboard response must not expose Material maintenance timestamps.');
  }
  if (materialsServiceSource.includes("row.customerScopeLabel || this.joinDashboardExportValues(row.customerNames, '未设置适用客户'")) {
    addFailure('materials.service.ts dashboard export must use dashboardExportCustomerScopeText so formal customer scope and order history stay separated.');
  }
  if (/const projectModels = this\.uniqueList\(\[\.\.\.formalProjectModels,\s*\.\.\.historyProjectModels\]\)/.test(materialsServiceSource)) {
    addFailure('materials.service.ts must not merge historyProjectModels into projectModels; formal project scope and order history must stay separate.');
  }
  const materialDashboardTypesSource = readFile('frontend/src/types/erp.ts');
  const materialDashboardRowType = materialDashboardTypesSource.match(/export interface MaterialDashboardRow[\s\S]*?\n}/)?.[0] || '';
  if (materialDashboardRowType.includes('updatedAt') || materialDashboardRowType.includes('createdAt')) {
    addFailure('frontend/src/types/erp.ts MaterialDashboardRow must not expose maintenance timestamps.');
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
    'bomStructureDetailCount',
    'currentScopeBomLineCount',
    'MATERIAL_DASHBOARD_CUSTOMER_PREVIEW_LIMIT',
    'const publicScopeCustomerNames = hasGlobalCustomerScope ? [] : scopeCustomerNames;',
    'const publicScopeCustomerNameCount = hasGlobalCustomerScope ? 0 : scopeCustomerNames.length;',
    'const hasFormalScope = displayApplicabilities.length > 0 || displayBomLines.length > 0;',
    'const hasCustomerSpecificScope =',
    '!hasGlobalCustomerScope &&',
    "line.bom.customerId || line.bom.customerScopeMode === 'SELECTED'",
    'const hasHistoryCustomScope = !hasFormalScope',
    'const displayPartType = hasFormalScope',
    'partType: displayPartType',
    'customerNames: publicScopeCustomerNames',
    'customerNameCount: publicScopeCustomerNameCount',
    'MATERIAL_DASHBOARD_PROJECT_MODEL_PREVIEW_LIMIT',
    'dashboardExportCustomerScopeText',
    'const formalProjectModels = this.uniqueList',
    'const historyProjectModels = this.uniqueList',
    "const targetBomProjectModel = query.projectModel?.trim() || (formalProjectModels.length === 1 ? formalProjectModels[0] : '');",
    'const hasGlobalProjectScope = projectScopeEntries.some',
    'const publicProjectModels = hasGlobalProjectScope ? [] : formalProjectModels;',
    'const publicProjectModelCount = hasGlobalProjectScope ? 0 : formalProjectModels.length;',
    'projectModels: publicProjectModels',
    'projectModelCount: publicProjectModelCount',
    'historyProjectModels',
    'historyProjectModelCount: historyProjectModels.length',
    'projectModel: hasGlobalProjectScope ? null : formalProjectModels[0] || null',
    'Number(row.projectModelCount || 0)',
    'MATERIAL_DASHBOARD_BOM_NAME_PREVIEW_LIMIT',
    'bomNameCount: bomNames.length',
    '? displayBomLines.filter((line) => {',
    'this.bomLineMatchesCustomerScope(line, selectedCustomerId)',
    'this.bomLineHasGlobalCustomerScope(line)',
    "line.bom.projectModelScopeKey === 'ALL'",
    'MATERIAL_DASHBOARD_BOM_STRUCTURE_PREVIEW_LIMIT',
    'customerNames: customerNames.slice(0, MATERIAL_DASHBOARD_CUSTOMER_PREVIEW_LIMIT)',
    'historyCustomerNames: historyCustomerNames.slice(0, MATERIAL_DASHBOARD_CUSTOMER_PREVIEW_LIMIT)',
    'projectModels: projectModels.slice(0, MATERIAL_DASHBOARD_PROJECT_MODEL_PREVIEW_LIMIT)',
    'historyProjectModels: historyProjectModels.slice(0, MATERIAL_DASHBOARD_PROJECT_MODEL_PREVIEW_LIMIT)',
    'bomNames: bomNames.slice(0, MATERIAL_DASHBOARD_BOM_NAME_PREVIEW_LIMIT)',
    'bomStructureDetails.slice(0, MATERIAL_DASHBOARD_BOM_STRUCTURE_PREVIEW_LIMIT)',
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
    "sortBy?: 'LAST_ORDER_DATE' | 'DRAWING_DATE' | 'BOM_STATUS' | 'PART_CODE'",
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
  if (!frontendTypesSource.includes('hasGlobalCustomerScope?: boolean')) {
    addFailure('MaterialDashboardRow must expose global customer scope for dashboard relation detail display.');
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
  if (!frontendTypesSource.includes('bomStructureDetailCount?: number')) {
    addFailure('MaterialDashboardRow must expose full BOM structure detail count for truncated dashboard previews.');
  }
  if (!frontendTypesSource.includes('currentScopeBomLineCount?: number')) {
    addFailure('MaterialDashboardRow must expose current scope BOM line count for safe add-to-BOM decisions.');
  }
  if (!frontendTypesSource.includes('projectModelCount?: number')) {
    addFailure('MaterialDashboardRow must expose full project model count for truncated dashboard previews.');
  }
  if (!frontendTypesSource.includes('historyProjectModels?: string[]')) {
    addFailure('MaterialDashboardRow must separate order-history project models from formal project scope.');
  }
  if (!frontendTypesSource.includes('historyProjectModelCount?: number')) {
    addFailure('MaterialDashboardRow must expose full history project model count for truncated dashboard previews.');
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
    '<CustomerSelect v-model="filters.customerId"',
    'v-model="filters.projectModel"',
    'customerId: filters.customerId || undefined',
    'projectModel: filters.projectModel.trim() || undefined',
    '<el-table-column label="操作" width="240" fixed="right">',
    'material-library-actions',
    'material-library-action-group',
    'material-library-action-label',
    'material-maintenance-row-actions',
    'material-maintenance-row-action-group',
    'material-maintenance-row-action-label',
    'title="编辑适用范围"',
    'title="编辑图纸版本"',
    'title="设为默认图纸"',
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
    'formatProcessRoutePreview(row.defaultProcessRoute)',
    'function formatProcessRoutePreview',
    'processRouteTooltipText(row.defaultProcessRoute)',
    '等 ${steps.length} 个工序',
    'formatLongTextPreview(row.remark)',
    'longTextTooltipText(row.remark)',
    'function formatLongTextPreview',
    'materialImportSourceFilePreview(row)',
    'materialImportSourceSheetPreview(row)',
    'materialImportSourceFileTitle(row)',
    'function materialImportSourceFilePreview(row: { sourceFileName?: string | null })',
    'materialApplicabilityScopePreview(row)',
    'materialApplicabilityScopeTitle(row)',
    'class="material-scope-cell"',
    'function materialApplicabilityScopeTitle(row: MaterialApplicability)',
    'formatMaterialImportIssuePreview(issues)',
    'formatMaterialImportIssueTitle(issues)',
    'function formatMaterialImportIssuePreview',
    'materialImportTraceRemarkPreview(activeMaterialImportTraceRow)',
    'materialImportTraceRemarkTitle(activeMaterialImportTraceRow)',
    'function materialImportTraceRemarkPreview(row: MaterialImportTraceRow)',
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
  if (materialsViewSource.includes("{{ row.defaultProcessRoute || '-' }}")) {
    addFailure('MaterialsView.vue must summarize default process routes instead of rendering full route text in tables.');
  }
  if (materialsViewSource.includes("{{ row.remark || '-' }}")) {
    addFailure('MaterialsView.vue must summarize long remarks instead of rendering full remark text in tables.');
  }
  if (/<el-table-column\s+label="来源文件"\s+min-width="180"\s+show-overflow-tooltip\s*>/.test(materialsViewSource)) {
    addFailure('MaterialsView.vue must summarize material import source file cells with explicit title text instead of raw show-overflow-tooltip.');
  }
  if (/<el-table-column\s+prop="remark"\s+label="备注"\s+min-width="220"\s+show-overflow-tooltip\s*>/.test(materialsViewSource)) {
    addFailure('MaterialsView.vue must summarize material import remark cells with explicit title text instead of raw show-overflow-tooltip.');
  }
  if (materialsViewSource.includes('<p>{{ activeMaterialImportTraceRow.remark }}</p>')) {
    addFailure('MaterialsView.vue must summarize material import trace remarks instead of rendering full trace remark text directly.');
  }
  if (materialsViewSource.includes('<el-table-column prop="scopeLabel" label="适用范围"')) {
    addFailure('MaterialsView.vue must summarize material applicability scope labels with tooltip instead of rendering raw scopeLabel in table cells.');
  }
  if (/function materialApplicabilityScopeTitle[\s\S]*row\.scopeLabel \|\|/.test(materialsViewSource)) {
    addFailure('MaterialsView.vue material applicability tooltip must use the compact scope preview instead of raw scopeLabel.');
  }
  if (materialsViewSource.includes('name: row.scopeLabel,')) {
    addFailure('MaterialsView.vue material applicability status dialogs must use materialApplicabilityScopePreview(row) instead of raw scopeLabel.');
  }
  if (materialsViewSource.includes('props.issues.map((issue) =>')) {
    addFailure('MaterialsView.vue must summarize import issues instead of rendering every issue tag in table cells.');
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
    "import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';",
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
    "defaultProcessRoute: form.defaultProcessRouteSteps.join('、') || undefined",
    'formatProcessRoutePreview(row.defaultProcessRoute)',
    'processRouteTooltipText(row.defaultProcessRoute)',
    'function formatProcessRoutePreview',
    '等 ${steps.length} 个工序',
    'formatLongTextPreview(row.conversionDescription)',
    'longTextTooltipText(row.conversionDescription)',
    'function formatLongTextPreview',
    'transformScopePreview(row)',
    'transformScopeTitle(row)',
    'class="transform-scope-cell"',
    'function transformScopeTitle(row: MaterialTransformRule)',
    'transformInventoryDecisionReasonPreview(row)',
    'transformInventoryDecisionReasonTitle(row)',
    'function transformInventoryDecisionReasonPreview(row: MaterialTransformRule'
  ];
  for (const snippet of materialTransformProcessSnippets) {
    if (!materialTransformsSource.includes(snippet)) {
      addFailure(`MaterialTransformsView.vue must keep standard process selection for transform default route snippet: ${snippet}`);
    }
  }
  if (materialTransformsSource.includes("{{ row.defaultProcessRoute || '-' }}")) {
    addFailure('MaterialTransformsView.vue must summarize transform default process routes instead of rendering full text in the table.');
  }
  if (materialTransformsSource.includes("{{ row.conversionDescription || '-' }}")) {
    addFailure('MaterialTransformsView.vue must summarize conversion descriptions instead of rendering full text in the table.');
  }
  if (materialTransformsSource.includes('<el-table-column prop="scopeLabel" label="适用范围"')) {
    addFailure('MaterialTransformsView.vue must summarize transform scope labels with tooltip instead of rendering raw scopeLabel in table cells.');
  }
  if (/function transformScopeTitle[\s\S]*row\.scopeLabel \|\|/.test(materialTransformsSource)) {
    addFailure('MaterialTransformsView.vue transform scope tooltip must use the compact scope preview instead of raw scopeLabel.');
  }
  if (/row\.targetPartName,\s*`\$\{formatQuantity\(row\.targetAvailableQuantity[\s\S]*?row\.scopeLabel,\s*row\.multiplier/.test(materialTransformsSource)) {
    addFailure('MaterialTransformsView.vue fixed-format transform copy must use transformScopePreview(row) instead of raw scopeLabel.');
  }
  if (materialTransformsSource.includes('<div class="inventory-decision-reason">{{ transformInventoryDecisionReason(row) }}</div>')) {
    addFailure('MaterialTransformsView.vue must summarize source-transform inventory decision reasons in table rows.');
  }
  if (materialTransformsSource.includes('<p>{{ transformInventoryDecisionReason(row) }}</p>')) {
    addFailure('MaterialTransformsView.vue must summarize source-transform inventory decision reasons in mobile rows.');
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
    "erpApi.inventoryMaterialByPartCode(targetPartCode, 'ENABLED')",
    "erpApi.inventoryMaterialsAllPages({ keyword: normalizedKeyword, status: 'ENABLED' })",
    'normalizeMaterialCode(value: string)',
    'handleSourceMaterialKeywordInput',
    'handleTargetMaterialKeywordInput',
    'sourceMaterialSelectedLabel',
    'targetMaterialSelectedLabel',
    '必须清理旧 id',
    'watch(',
    'openTransformSourceDetails',
    'openTransformTargetDetails',
    '<el-table-column label="操作" width="240" fixed="right">',
    'transform-row-actions',
    'transform-row-action-group',
    'transform-row-action-label',
    'title="来源库存"',
    'title="启用来源加工关系"',
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
  const materialMemoryListBlock = inventoryServiceSource.match(/async materials\(query: MaterialQueryDto\) \{[\s\S]*?\n  private serializeMaterialMemoryRow/)?.[0] || '';
  const serializeMaterialMemoryBlock = inventoryServiceSource.match(/private serializeMaterialMemoryRow\([\s\S]*?\n  async buildMaterialMemoryExport/)?.[0] || '';
  const materialMemoryTypeBlock = frontendTypesSource.match(/export interface MaterialMemory[\s\S]*?\n}/)?.[0] || '';
  if (!materialMemoryListBlock.includes("orderBy: [{ partCode: 'asc' }, { id: 'asc' }]")) {
    addFailure('inventory.service.ts material memory list must use stable partCode/id ordering instead of Material maintenance time.');
  }
  if (materialMemoryListBlock.includes("orderBy: [{ updatedAt: 'desc' }, { partCode: 'asc' }]")) {
    addFailure('inventory.service.ts material memory list must not sort by updatedAt; current stage does not use material maintenance time as business ranking.');
  }
  if (serializeMaterialMemoryBlock.includes('updatedAt: material.updatedAt') || serializeMaterialMemoryBlock.includes('createdAt: material.createdAt')) {
    addFailure('inventory.service.ts material memory API response must not expose Material maintenance timestamps for the main material library list.');
  }
  if (materialMemoryTypeBlock.includes('updatedAt') || materialMemoryTypeBlock.includes('createdAt')) {
    addFailure('frontend/src/types/erp.ts MaterialMemory must not expose maintenance timestamps for the main material library list.');
  }
  const materialApplicabilityExportBlock =
    inventoryServiceSource.match(/async buildMaterialApplicabilitiesExport\(materialId: string\)[\s\S]*?\n  async saveMaterialApplicability/)?.[0] || '';
  const materialApplicabilitySerializeBlock =
    inventoryServiceSource.match(/private serializeMaterialApplicability\([\s\S]*?\n  private resolveModelBomScope/)?.[0] || '';
  const materialApplicabilityTypeBlock = frontendTypesSource.match(/export interface MaterialApplicability[\s\S]*?\n}/)?.[0] || '';
  if (
    materialApplicabilityExportBlock.includes("'创建时间'") ||
    materialApplicabilityExportBlock.includes("'更新时间'") ||
    materialApplicabilityExportBlock.includes('item.createdAt') ||
    materialApplicabilityExportBlock.includes('item.updatedAt')
  ) {
    addFailure('inventory.service.ts material applicability export must not include maintenance timestamps; applicability is a business scope rule, not an audit report.');
  }
  if (
    materialApplicabilitySerializeBlock.includes('createdAt: item.createdAt') ||
    materialApplicabilitySerializeBlock.includes('updatedAt: item.updatedAt') ||
    materialApplicabilitySerializeBlock.includes('createdAt: Date') ||
    materialApplicabilitySerializeBlock.includes('updatedAt: Date')
  ) {
    addFailure('inventory.service.ts material applicability API response must not expose maintenance timestamps in the scope rule list.');
  }
  if (materialApplicabilityTypeBlock.includes('createdAt') || materialApplicabilityTypeBlock.includes('updatedAt')) {
    addFailure('frontend/src/types/erp.ts MaterialApplicability must not expose maintenance timestamps for the scope rule list.');
  }
  const materialDrawingRevisionExportBlock =
    inventoryServiceSource.match(/async buildMaterialDrawingRevisionsExport\(materialId: string\)[\s\S]*?\n  async saveMaterialDrawingRevision/)?.[0] || '';
  const materialDrawingRevisionSerializeBlock =
    inventoryServiceSource.match(/private serializeMaterialDrawingRevision\([\s\S]*?\n  async buildMaterialImportTemplate/)?.[0] || '';
  const materialDrawingRevisionTypeBlock = frontendTypesSource.match(/export interface MaterialDrawingRevision[\s\S]*?\n}/)?.[0] || '';
  if (
    materialDrawingRevisionExportBlock.includes("'创建时间'") ||
    materialDrawingRevisionExportBlock.includes("'更新时间'") ||
    materialDrawingRevisionExportBlock.includes('row.createdAt') ||
    materialDrawingRevisionExportBlock.includes('row.updatedAt')
  ) {
    addFailure('inventory.service.ts material drawing revision export must keep defaultChangedAt audit fields but omit generic maintenance timestamps.');
  }
  if (
    materialDrawingRevisionSerializeBlock.includes('createdAt: row.createdAt') ||
    materialDrawingRevisionSerializeBlock.includes('updatedAt: row.updatedAt') ||
    materialDrawingRevisionSerializeBlock.includes('createdAt: Date') ||
    materialDrawingRevisionSerializeBlock.includes('updatedAt: Date')
  ) {
    addFailure('inventory.service.ts material drawing revision API response must not expose generic maintenance timestamps.');
  }
  if (materialDrawingRevisionTypeBlock.includes('createdAt') || materialDrawingRevisionTypeBlock.includes('updatedAt')) {
    addFailure('frontend/src/types/erp.ts MaterialDrawingRevision must not expose generic maintenance timestamps.');
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
    ['MaterialsView.vue', materialsViewSource, 'uploadMaterialDrawingFile'],
    ['MaterialsView.vue', materialsViewSource, 'await erpApi.uploadMaterialDrawing(file)'],
    ['MaterialsView.vue', materialsViewSource, 'drawingForm.drawingFileName = result.fileName'],
    ['MaterialsView.vue', materialsViewSource, 'drawingForm.drawingFileUrl = result.fileUrl'],
    ['MaterialsView.vue', materialsViewSource, '图纸文件正在上传，请等待上传完成'],
    ['MaterialsView.vue', materialsViewSource, 'DrawingPreviewLink'],
    ['MaterialsView.vue', materialsViewSource, '<el-select v-model="drawingForm.status" :disabled="Boolean(drawingForm.id)"'],
    ['MaterialsView.vue', materialsViewSource, 'await erpApi.saveMaterialDrawingRevision(activeMaterial.value.id, { ...payload, status: drawingForm.status })'],
    ['frontend/src/api/erp.ts', frontendApiSource, 'restoreMaterialApplicability(applicabilityId: string)'],
    ['frontend/src/api/erp.ts', frontendApiSource, "export type UpdateMaterialApplicabilityPayload = Omit<SaveMaterialApplicabilityPayload, 'status'>"],
    ['frontend/src/api/erp.ts', frontendApiSource, 'updateMaterialApplicability(applicabilityId: string, payload: UpdateMaterialApplicabilityPayload)'],
    ['frontend/src/api/erp.ts', frontendApiSource, "`/inventory/material-applicabilities/${applicabilityId}/restore`"],
    ['frontend/src/api/erp.ts', frontendApiSource, 'restoreMaterialDrawingRevision(revisionId: string)'],
    ['frontend/src/api/erp.ts', frontendApiSource, 'uploadMaterialDrawing(file: File)'],
    ['frontend/src/api/erp.ts', frontendApiSource, '/inventory/material-drawings/upload'],
    ['frontend/src/api/erp.ts', frontendApiSource, "export type UpdateMaterialDrawingRevisionPayload = Omit<SaveMaterialDrawingRevisionPayload, 'status'>"],
    ['frontend/src/api/erp.ts', frontendApiSource, 'updateMaterialDrawingRevision(revisionId: string, payload: UpdateMaterialDrawingRevisionPayload)'],
    ['MaterialsView.vue', materialsViewSource, 'type UpdateMaterialDrawingRevisionPayload'],
    ['MaterialsView.vue', materialsViewSource, 'function drawingRevisionPayload(overrides: Partial<UpdateMaterialDrawingRevisionPayload> = {}): UpdateMaterialDrawingRevisionPayload'],
    ['frontend/src/api/erp.ts', frontendApiSource, "`/inventory/material-drawing-revisions/${revisionId}/restore`"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, "@Patch('material-applicabilities/:applicabilityId/restore')"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, 'return this.inventoryService.restoreMaterialApplicability(applicabilityId);'],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, "@Patch('material-drawing-revisions/:revisionId/restore')"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, 'return this.inventoryService.restoreMaterialDrawingRevision(revisionId);'],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, "@Post('material-drawings/upload')"],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, 'allowedMaterialDrawingExtensions'],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, 'safeMaterialDrawingFileName'],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, 'destination: drawingUploadPath()'],
    ['backend/src/modules/inventory/inventory.controller.ts', inventoryControllerSource, "fileUrl: `/uploads/drawings/${file.filename}`"],
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
    ['frontend/src/api/erp.ts', frontendApiSource, "includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined"],
    ['frontend/src/types/erp.ts', frontendTypesSource, 'export interface MaterialTransformRuleListResponse'],
    ['backend/src/modules/inventory/dto.ts', inventoryDtoSource, 'withPage?: string'],
    ['backend/src/modules/inventory/dto.ts', inventoryDtoSource, 'includeTestFixtures?: string'],
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
  const materialTransformListBlock = inventoryServiceSource.match(/async materialTransformRules\(query: MaterialTransformRuleQueryDto\) \{[\s\S]*?\n  async buildMaterialTransformRulesExport/)?.[0] || '';
  const materialTransformSerializeBlock = inventoryServiceSource.match(/private serializeMaterialTransformRule\([\s\S]*?\n  private modelBomDiffReviewLineSelect/)?.[0] || '';
  const materialTransformTypeBlock = frontendTypesSource.match(/export interface MaterialTransformRule[\s\S]*?\n}/)?.[0] || '';
  const materialTransformExportBlock = inventoryServiceSource.match(/async buildMaterialTransformRulesExport\(query: MaterialTransformRuleQueryDto\)[\s\S]*?\n  async createMaterialTransformRule/)?.[0] || '';
  const materialTransformRulesRegressionSource = readFile('scripts/verify-material-transform-rules-export-api.cjs');
  const materialTransformFixtureFilterSources = [inventoryServiceSource, inventoryDtoSource, frontendApiSource, materialTransformRulesRegressionSource].join('\n');
  for (const snippet of [
    'isTestFixtureMaterialTransformRule',
    "const includeTestFixtures = query.includeTestFixtures === 'true';",
    'const businessRows = includeTestFixtures ? rows : rows.filter',
    'includeTestFixtures?: boolean',
    'material-transform-rules-read-only',
    'material-transform-rules-test-fixture-filter',
    'material-transform-rules-export-test-fixture-filter',
    'assertMaterialTransformRulesReadOnlyList',
    'assertMaterialTransformRulesReadOnlyExport',
    'includeTestFixtures=true'
  ]) {
    if (!materialTransformFixtureFilterSources.includes(snippet)) {
      addFailure(`Source-transform list/export must keep reusable test-fixture opt-in filter snippet: ${snippet}`);
    }
  }
  for (const forbiddenSnippet of [
    "const { PrismaClient } = require('@prisma/client');",
    'new PrismaClient()',
    'fixturePrefix =',
    'upsertFixtureMaterial',
    'prepareFixtureRule',
    'prisma.material.upsert',
    'prisma.materialTransformRule.create',
    'prisma.materialTransformRule.update'
  ]) {
    if (materialTransformRulesRegressionSource.includes(forbiddenSnippet)) {
      addFailure(`scripts/verify-material-transform-rules-export-api.cjs must stay read-only and not write source-transform verification data: ${forbiddenSnippet}`);
    }
  }
  if (!materialTransformListBlock.includes("orderBy: [{ sourceMaterialId: 'asc' }, { targetMaterialId: 'asc' }, { customerScopeKey: 'asc' }, { projectModelScopeKey: 'asc' }, { id: 'asc' }]")) {
    addFailure('inventory.service.ts source-transform list must use stable scope/source/target ordering instead of updatedAt maintenance time.');
  }
  if (materialTransformsSource.includes('label="更新时间"') || materialTransformsSource.includes('formatDateTime(row.updatedAt)')) {
    addFailure('MaterialTransformsView.vue must hide source-transform updatedAt from the main list; current stage does not use maintenance timestamps as business criteria.');
  }
  if (materialTransformsSource.includes("'更新时间'") || materialTransformsSource.includes('formatDateTime(row.updatedAt)')) {
    addFailure('MaterialTransformsView.vue fixed-format source-transform copy must not include updatedAt maintenance time.');
  }
  if (materialTransformExportBlock.includes("'更新时间'") || materialTransformExportBlock.includes('row.updatedAt')) {
    addFailure('inventory.service.ts source-transform export must not include updatedAt maintenance time.');
  }
  if (materialTransformListBlock.includes("orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]")) {
    addFailure('inventory.service.ts source-transform list must not sort by updatedAt maintenance time.');
  }
  if (materialTransformSerializeBlock.includes('updatedAt: row.updatedAt') || materialTransformSerializeBlock.includes('createdAt: row.createdAt')) {
    addFailure('inventory.service.ts source-transform API response must not expose maintenance timestamps in the main rule list.');
  }
  if (materialTransformTypeBlock.includes('updatedAt') || materialTransformTypeBlock.includes('createdAt')) {
    addFailure('frontend/src/types/erp.ts MaterialTransformRule must not expose maintenance timestamps in the main rule list.');
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
    'modelBomRecommendationDetailLoadingId',
    'loadModelBomRecommendationDetail',
    'modelBomHasLoadedLines',
    'const detail = await erpApi.modelBom(bom.id)',
    'modelBomStructureGroups',
    'createLineFromModelBomLine',
    'buildBomComponentNoMap',
    'nextAvailableOrderComponentNo',
    'orderImportableModelBomLines',
    'modelBomProjectScopeText',
    'modelBomImportProjectModel',
    'modelBomScopePreview(bom)',
    'modelBomRecommendationMultiChoiceScopeCount',
    '可选 BOM {{ bom.sameScopeBomCount }} 个',
    '所在范围存在多套可选 BOM',
    'modelBomScopeTitle(bom)',
    'class="model-bom-scope-tag"',
    'function modelBomScopeTitle(bom: ModelBom)',
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
    'formatLimitedListPreview',
    'totalCount?: number',
    "formatLimitedListPreview(orderNos, '订单', 5, totalCount)",
    "formatLimitedListPreview(fileNames.map((fileName) => displayImportFileName(fileName)), '文件', 5, totalCount)",
    'filter((_, index) => index < maxCount)',
    'modelBomDuplicatePartCodesTitle',
    'modelBomDraftExistingBomsSummary',
    "formatLimitedListPreview(preview || [], '零件编码')",
    'function formatProcessRoutePreview',
    "formatLimitedListPreview(steps, '工序', 3)",
    'formatProcessRoutePreview(line.processRoute)',
    'formatProcessRoutePreview(line.defaultProcessRoute)',
    'formatProcessRoutePreview(row.defaultProcessRoute)',
    'formatFullText(row.defaultProcessRoute)',
    '<el-table-column label="默认工艺" min-width="160">',
    'formatProcessRoutePreview(row.draftLine.defaultProcessRoute, \'未维护默认工艺\')',
    'formatProcessRoutePreview(row.existingLine.defaultProcessRoute, \'未维护默认工艺\')',
    'formatImportIssuePreview(line.issues)',
    'formatImportIssuePreview(draft.issues)',
    'formatImportIssuePreview(row.issues)',
    'formatLongTextPreview(row.processRemark)',
    'modelBomRemarkPreview(bom)',
    'modelBomRemarkTitle(bom)',
    'function modelBomRemarkPreview(bom: ModelBom)',
    'formatFullText(row.processRoute)',
    'function formatImportIssuePreview',
    'function formatLongTextPreview',
    "formatLimitedListPreview(bom.diffSummary.changedFields, '字段')",
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
    "line.defaultProcessRouteSource === 'BOM_LINE' ? 'BOM指定'",
    '已带入 ${importedLines.length} 行零件包明细',
    '只带入当前草稿明细，不提交生产、不占库存。'
  ];
  for (const snippet of orderBomRecommendationSnippets) {
    if (!ordersListSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must keep order BOM recommendation snippet: ${snippet}`);
    }
  }
  if (!ordersListSource.includes('modelBomBusinessSummaryText')) {
    addFailure('OrdersListView.vue must summarize recommended BOM by scope, short ID and line count instead of maintenance time.');
  }
  if (ordersListSource.includes("`适用范围：${bom.scopeLabel || '未设置范围'}")) {
    addFailure('OrdersListView.vue recommended BOM tooltip must use the compact scope preview instead of raw scopeLabel.');
  }
  if (ordersListSource.includes('const parts = [bom.scopeLabel,')) {
    addFailure('OrdersListView.vue recommended BOM business summary must use modelBomScopePreview instead of raw scopeLabel.');
  }
  if (
    ordersListSource.includes('formatDateTime(bom.updatedAt)') ||
    ordersListSource.includes('modelBomApplyPreview.bom.updatedAt') ||
    ordersListSource.includes('短 ID、更新时间')
  ) {
    addFailure('OrdersListView.vue must not ask operators to choose BOM by updatedAt maintenance time.');
  }
  if (ordersListSource.includes("modelBomApplyPreview.duplicatePartCodes.join('、')")) {
    addFailure('OrdersListView.vue must summarize duplicate BOM part codes instead of rendering the full joined list.');
  }
  if (ordersListSource.includes('<el-tag size="small" effect="plain">{{ bom.scopeLabel }}</el-tag>')) {
    addFailure('OrdersListView.vue must summarize recommended BOM scope labels with tooltip instead of rendering raw scopeLabel in recommendation cards.');
  }
  if (ordersListSource.includes('<span v-if="bom.remark">{{ bom.remark }}</span>')) {
    addFailure('OrdersListView.vue must summarize recommended BOM remarks instead of rendering full remark text in recommendation cards.');
  }
  if (/<el-table-column\s+prop="defaultProcessRoute"\s+label="[^"]*"\s+min-width="160"\s+show-overflow-tooltip\s*>/.test(ordersListSource)) {
    addFailure('OrdersListView.vue must use explicit defaultProcessRoute preview/title instead of raw show-overflow-tooltip.');
  }
  if (ordersListSource.includes(".map((bom) => `${bom.bomName}（${bom.lineCount} 行）`).join('；')")) {
    addFailure('OrdersListView.vue must summarize existing BOM names in import draft preview instead of rendering the full joined list.');
  }
  if (ordersListSource.includes("visiblePreview.join('、')")) {
    addFailure('OrdersListView.vue must summarize material sync preview codes instead of rendering the full joined list.');
  }
  if (
    ordersListSource.includes("steps.join('、')") ||
    ordersListSource.includes("line.processRoute || '-'") ||
    ordersListSource.includes("line.defaultProcessRoute || '-'") ||
    ordersListSource.includes("row.draftLine.defaultProcessRoute || '未维护默认工艺'") ||
    ordersListSource.includes("row.existingLine.defaultProcessRoute || '未维护默认工艺'") ||
    ordersListSource.includes("bom.diffSummary.changedFields.join('、')")
  ) {
    addFailure('OrdersListView.vue must summarize process routes and BOM diff fields instead of rendering the full joined list.');
  }
  if (
    ordersListSource.includes('v-for="issue in line.issues"') ||
    ordersListSource.includes('v-for="issue in draft.issues"') ||
    ordersListSource.includes('v-for="issue in row.issues"')
  ) {
    addFailure('OrdersListView.vue must summarize import issue lists instead of rendering every issue tag in table cells.');
  }
  if (
    ordersListSource.includes("visibleOrderNos.join('、')") ||
    ordersListSource.includes("visibleFileNames.join('、')")
  ) {
    addFailure('OrdersListView.vue must summarize import session order/file lists through formatLimitedListPreview.');
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
    'this.formatLimitedList(Array.from(duplicateNos), 10)',
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
  if (ordersServiceSource.includes("Array.from(duplicateNos).join('、')")) {
    addFailure('orders.service.ts must summarize duplicate component numbers instead of listing every duplicate.');
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
    'modelBomCustomerScopeExposesNewCustomers',
    'modelBomVisibleCustomerIds',
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
    'previewScopeCustomers: withPage',
    'previewLines: withPage',
    'scopeCustomerCount',
    'visibleScopeCustomers',
    'summarizeSerializedModelBomLines',
    'lines: options.previewLines ? [] : lines',
    'lineSummary',
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
    'BOM 行默认工艺优先，其次零件基础库默认工艺',
    'const defaultProcessRoute = line.defaultProcessRoute || line.material?.defaultProcessRoute || null',
    "const defaultProcessRouteSource = line.defaultProcessRoute ? 'BOM_LINE' : line.material?.defaultProcessRoute ? 'MATERIAL' : null",
    'bomLineDefaultProcessRoute: line.defaultProcessRoute',
    'defaultProcessRouteSource',
    '...(status ? { status } : {})',
    'async reorderModelBomLines(bomId: string',
    'BOM 拖拽排序必须事务化保存',
    'modelBomLineDisplayOrderMap',
    'displayOrder 是页面查看用连续序号',
    'const sortedLines = [...lines].sort(',
    'return new Map(ordered.map((line, index) => [line.id, index + 1]))',
    'copyableSourceLines',
    'copyableSourceLines.length === 0',
    'existingBoms',
    'findModelBomNameScopeDuplicate',
    'normalizeModelBomNameScopeKey',
    ".trim().toLowerCase()",
    'handleModelBomNameUniqueError',
    'isModelBomNameUniqueError',
    "error.code !== 'P2002'",
    'Prisma.PrismaClientKnownRequestError',
    'ModelBom_bomName_ci_customerScopeKey_projectModelScopeKey_key',
    'ModelBom_bomName_customerScopeKey_projectModelScopeKey_key',
    'this.handleModelBomNameUniqueError(error,',
    '相同名称、客户范围和机型/项目的零件包已存在',
    '目标客户下已存在相同名称和机型/项目的零件包',
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
    'MODEL_BOM_NAME_SCOPE_DUPLICATE',
    '厚度只核对子零件和单独零件',
    "bom.customerScopeMode === 'SELECTED'",
    "const expectedProjectModelScopeKey = stringValue(bom.projectModel).toLocaleUpperCase() || 'ALL';",
    'const bomsByNameAndScope = new Map',
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
    '@@unique([bomName, customerScopeKey, projectModelScopeKey])',
    'model ModelBomDiffReview',
    'ModelBomDiffReviewTarget',
    'ModelBomDiffReviewSource',
    'ModelBomDiffReview_sourceLineId_fkey',
    'ModelBomDiffReview_targetLineId_fkey',
    'model MaterialCommonProjectModel',
    'MaterialCommonProjectModel_projectModelNormalized_key',
    'isCommon              Boolean                 @default(false)',
    'ModelBom_isCommon_commonSortOrder_idx',
    'ModelBom_bomName_customerScopeKey_projectModelScopeKey_key',
    'ModelBom_bomName_ci_customerScopeKey_projectModelScopeKey_key',
    'lower(trim("bomName"))',
    'duplicate case-insensitive bomName/customerScopeKey/projectModelScopeKey scopes',
    'DROP INDEX IF EXISTS "ModelBom_customerScopeKey_projectModelScopeKey_key"',
    '允许同一客户 / 同一机型保留多个不同用途的 BOM'
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
    'isTestFixtureMaterialTransformRule',
    'const businessRows = includeTestFixtures ? rows : rows.filter',
    '是否使用库存仍由库存来源核对弹窗人工确认'
  ];
  for (const snippet of transformBackendSnippets) {
    if (!inventoryServiceSource.includes(snippet)) {
      addFailure(`inventory.service.ts must keep transform-rule default process validation snippet: ${snippet}`);
    }
  }

  const bomApiSnippets = [
    ["package.json", packageSource, '"verify:model-bom-scope-approval-api": "node scripts/verify-model-bom-scope-approval-api.cjs"'],
    ["scripts/verify-first-stage-api.cjs", firstStageApiRegressionSource, "'verify:model-bom-scope-approval-api'"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'model-bom-scope-expansion-requires-approval'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'model-bom-scope-approval-consumed-on-save'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'model-bom-scope-approval-duplicate-pending-request-blocked'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'model-bom-scope-approval-duplicate-approved-request-blocked'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'model-bom-scope-approval-requested-scope-query-filters'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'model-bom-scope-approval-test-fixture-filter'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'includeTestFixtures=true'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'default BOM scope approval list must hide reusable verification fixtures'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'requestedCustomerScopeMode=ALL&requestedScopeKey=ALL&requestedProjectModelScopeKey='],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, "const customerCodePrefix = 'VERIFY-SCOPE-CUST-STABLE';"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, "const bomName = 'VERIFY_SCOPE_APPROVAL_STABLE';"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'async function prepareScopeApprovalBom(customer)'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'prisma.modelBomScopeApprovalRequest.updateMany'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'prisma.modelBomCustomerScope.updateMany'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'prisma.modelBom.update'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'prisma.customer.findFirst'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'customerCode: `${baseCode}${archiveSuffix}`'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'customerName: `${baseName}${archiveSuffix}`'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'createScopeApprovalCustomer'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'prisma.customerContact.findFirst'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'prisma.customerContact.update'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'cleanupCustomer(customer.id)'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'async function safeCleanup'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, "await safeCleanup('model BOM fixture'"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, "await safeCleanup('scope approval customer fixture'"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, "await safeCleanup('scope approval second customer fixture'"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, "customerScopeMode: 'SELECTED'"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, "private BOM changed to same single selected customer must not require admin approval"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, "exposing BOM to a different customer must be rejected without approval"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'model-bom-private-to-same-selected-no-approval'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'model-bom-selected-to-new-private-requires-approval'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, 'model-bom-scope-approval-temporary-customer-cleanup'],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, "customerScopeMode: 'ALL'"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, "isCommon: true"],
    ["scripts/verify-model-bom-scope-approval-api.cjs", modelBomScopeApprovalRegressionSource, '/inventory/model-bom-scope-approval-requests'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'export class CreateModelBomScopeApprovalRequestDto extends SaveModelBomDto'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'export class ReviewModelBomScopeApprovalRequestDto'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'scopeApprovalRequestId?: string'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'requestedCustomerScopeMode?: \'ALL\' | \'PRIVATE\' | \'SELECTED\''],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'requestedScopeKey?: string'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'requestedProjectModelScopeKey?: string'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'includeTestFixtures?: string'],
    ["database/prisma/schema.prisma", prismaSchemaSource, '@@index([bomId, status, requestedCustomerScopeMode, requestedScopeKey, requestedProjectModelScopeKey], map: "ModelBomScopeApprovalRequest_scope_query_idx")'],
    ["database/prisma/migrations", migrationSqlSource, 'CREATE INDEX "ModelBomScopeApprovalRequest_scope_query_idx"'],
    ["database/prisma/migrations", migrationSqlSource, 'CREATE UNIQUE INDEX "ModelBomScopeApprovalRequest_open_scope_unique"'],
    ["database/prisma/migrations", migrationSqlSource, 'WHERE "status" IN (\'PENDING\', \'APPROVED\') AND "usedAt" IS NULL'],
    ["database/prisma/migrations", migrationSqlSource, 'ModelBomScopeApprovalRequest has duplicate open approvals for the same BOM target scope'],
    ["database/prisma/migrations", migrationSqlSource, 'Run npm run backend:verify:first-stage and reject or consume duplicate approvals before applying this migration'],
    ["database/prisma/verify-first-stage.ts", dataVerifierSource, 'openScopeApprovalsByKey'],
    ["database/prisma/verify-first-stage.ts", dataVerifierSource, 'MODEL_BOM_SCOPE_APPROVAL_OPEN_DUPLICATE'],
    ["database/prisma/verify-first-stage.ts", dataVerifierSource, "request.status === 'PENDING' || request.status === 'APPROVED'"],
    ["database/prisma/verify-first-stage.ts", dataVerifierSource, 'MODEL_BOM_SCOPE_APPROVAL_USED_STATUS_MISMATCH'],
    ["database/prisma/verify-first-stage.ts", dataVerifierSource, 'function jsonObjectRows'],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, "@Get('model-bom-scope-approval-requests')"],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, "@Post('model-boms/:bomId/scope-approval-requests')"],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, "@Post('model-bom-scope-approval-requests/:requestId/approve')"],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, "@Post('model-bom-scope-approval-requests/:requestId/reject')"],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'modelBomCustomerScopeBroadens(previousMode'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'modelBomCustomerScopeExposesNewCustomers(existing, nextScopeMode'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, "previousMode !== 'ALL' && nextMode === 'ALL'"],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'modelBomVisibleCustomerIds(row, previousMode)'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'modelBomProjectScopeBroadens(existing.projectModel, scopeData.projectModel)'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'nullableInventoryFixtureStartsWith'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'modelBomScopeApprovalFixtureWhere'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, "this.nullableInventoryFixtureStartsWith('requestedCustomerNameSnapshot', prefix)"],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, "this.nullableInventoryFixtureStartsWith('customerNameSnapshot', prefix)"],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'const includeTestFixtures = query.includeTestFixtures === \'true\';'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'BOM 适用范围扩大需要先提交管理员审批申请'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'const duplicateApproval = await this.prisma.modelBomScopeApprovalRequest.findFirst'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, "status: { in: ['PENDING', 'APPROVED'] }"],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, "orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]"],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, '相同 BOM 范围已有未使用审批申请'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'where.requestedCustomerScopeMode = query.requestedCustomerScopeMode'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'where.requestedScopeKey = query.requestedScopeKey.trim()'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'where.requestedProjectModelScopeKey = query.requestedProjectModelScopeKey.trim()'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'handleModelBomScopeApprovalOpenUniqueError(error);'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'isModelBomScopeApprovalOpenUniqueError(error)'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'ModelBomScopeApprovalRequest_open_scope_unique'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, '相同 BOM 范围已有未使用审批申请，请刷新审批列表后继续处理'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'approvalRequest.status !== \'APPROVED\' || approvalRequest.usedAt'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, "data: { status: 'USED', usedAt: new Date() }"],
    ["frontend/src/api/erp.ts", frontendApiSource, 'createModelBomScopeApprovalRequest(bomId: string'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'approveModelBomScopeApprovalRequest(requestId: string'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'rejectModelBomScopeApprovalRequest(requestId: string'],
    ["frontend/src/types/erp.ts", frontendTypesSource, "export type ModelBomScopeApprovalRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED'"],
    ["frontend/src/types/erp.ts", frontendTypesSource, 'export interface ModelBomScopeApprovalRequest'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'requestedCustomerScopeMode: filters.requestedCustomerScopeMode'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'requestedScopeKey: filters.requestedScopeKey'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'requestedProjectModelScopeKey: filters.requestedProjectModelScopeKey'],
    ["frontend/src/views/ModelBomsView.vue", modelBomSource, '范围审批'],
    ["frontend/src/views/ModelBomsView.vue", modelBomSource, 'bomScopeChangeBroadens()'],
    ["frontend/src/views/ModelBomsView.vue", modelBomSource, 'findApprovedBomScopeApprovalForCurrentForm'],
    ["frontend/src/views/ModelBomsView.vue", modelBomSource, 'bomScopeApprovalBlocksNewRequest'],
    ["frontend/src/views/ModelBomsView.vue", modelBomSource, 'findOpenBomScopeApprovalForCurrentForm'],
    ["frontend/src/views/ModelBomsView.vue", modelBomSource, 'bomScopeApprovalCurrentFormFilters'],
    ["frontend/src/views/ModelBomsView.vue", modelBomSource, "const statuses: Array<'PENDING' | 'APPROVED'> = ['PENDING', 'APPROVED'];"],
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
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, "return this.inventoryService.modelBoms({ ...query, withPage: 'true' });"],
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
  if (
    modelBomScopeApprovalRegressionSource.includes('new Date().toISOString().replace') ||
    modelBomScopeApprovalRegressionSource.includes('Math.random()') ||
    modelBomScopeApprovalRegressionSource.includes("method: 'DELETE'") ||
    modelBomScopeApprovalRegressionSource.includes('/permanent')
  ) {
    addFailure('scripts/verify-model-bom-scope-approval-api.cjs must reuse stable fixtures and must not permanently delete BOM or customer data.');
  }
  const modelBomListBlock = inventoryServiceSource.match(/async modelBoms\(query: ModelBomQueryDto\) \{[\s\S]*?\n  private modelBomCustomerScopeModeForRow/)?.[0] || '';
  const modelBomSortBlock = inventoryServiceSource.match(/private sortModelBomRows[\s\S]*?\n  private modelBomCustomerScopeSortScore/)?.[0] || '';
  const modelBomExportBlock = inventoryServiceSource.match(/async buildModelBomsExport\(query: ModelBomQueryDto\)[\s\S]*?\n  async modelBomDiffReviews/)?.[0] || '';
  const modelBomSerializeBlock = inventoryServiceSource.match(/private serializeModelBom\([\s\S]*?\n  private serializeModelBomLine/)?.[0] || '';
  const modelBomLineSerializeBlock = inventoryServiceSource.match(/private serializeModelBomLine\([\s\S]*?\n  private modelBomLineDisplayOrderMap/)?.[0] || '';
  const modelBomTypeBlock = frontendTypesSource.match(/export interface ModelBom\s*\{[\s\S]*?\n}/)?.[0] || '';
  const modelBomLineTypeBlock = frontendTypesSource.match(/export interface ModelBomLine[\s\S]*?\n}/)?.[0] || '';
  if (!modelBomListBlock.includes("{ customerScopeKey: 'asc' }") || !modelBomListBlock.includes("{ id: 'asc' }")) {
    addFailure('inventory.service.ts modelBoms list must use stable scope/name/id ordering instead of updatedAt maintenance time.');
  }
  if (modelBomListBlock.includes("orderBy: [{ updatedAt: 'desc' }, { projectModel: 'asc' }, { bomName: 'asc' }]")) {
    addFailure('inventory.service.ts modelBoms list must not use updatedAt as initial ordering.');
  }
  if (modelBomSortBlock.includes('updatedAt') || modelBomSortBlock.includes('updatedDiff')) {
    addFailure('inventory.service.ts sortModelBomRows must not use updatedAt as recommendation or list tie-breaker.');
  }
  if (!modelBomSortBlock.includes('leftStableKey') || !modelBomSortBlock.includes('rightStableKey')) {
    addFailure('inventory.service.ts sortModelBomRows must keep stable scope/project/name/id tie-breaker.');
  }
  if (modelBomExportBlock.includes("'更新时间'") || modelBomExportBlock.includes('row.updatedAt')) {
    addFailure('inventory.service.ts model BOM export must not include updatedAt maintenance time in main BOM sheets.');
  }
  if (
    modelBomSerializeBlock.includes('createdAt: row.createdAt') ||
    modelBomSerializeBlock.includes('updatedAt: row.updatedAt') ||
    modelBomSerializeBlock.includes('createdAt: Date') ||
    modelBomSerializeBlock.includes('updatedAt: Date')
  ) {
    addFailure('inventory.service.ts model BOM API response must not expose generic maintenance timestamps.');
  }
  if (
    !modelBomSerializeBlock.includes("formatCustomerNamePreview(scopeCustomers.map((scope) => scope.customerName), '指定客户')") ||
    !modelBomSerializeBlock.includes('private formatCustomerNamePreview') ||
    !modelBomSerializeBlock.includes("formatBusinessListPreview(names, '客户', emptyText)")
  ) {
    addFailure('inventory.service.ts model BOM scopeLabel must summarize selected customers instead of returning every customer name.');
  }
  if (modelBomSerializeBlock.includes("scopeCustomers.map((scope) => scope.customerName).filter(Boolean).join('、')")) {
    addFailure('inventory.service.ts model BOM scopeLabel must not join every selected customer into the list response.');
  }
  if (
    modelBomLineSerializeBlock.includes('createdAt: line.createdAt') ||
    modelBomLineSerializeBlock.includes('updatedAt: line.updatedAt') ||
    modelBomLineSerializeBlock.includes('createdAt: Date') ||
    modelBomLineSerializeBlock.includes('updatedAt: Date')
  ) {
    addFailure('inventory.service.ts model BOM line API response must not expose generic maintenance timestamps.');
  }
  if (modelBomTypeBlock.includes('createdAt') || modelBomTypeBlock.includes('updatedAt')) {
    addFailure('frontend/src/types/erp.ts ModelBom must not expose generic maintenance timestamps.');
  }
  if (modelBomLineTypeBlock.includes('createdAt') || modelBomLineTypeBlock.includes('updatedAt')) {
    addFailure('frontend/src/types/erp.ts ModelBomLine must not expose generic maintenance timestamps.');
  }
  if (
    inventoryServiceSource.includes("{ sortOrder: 'asc' }, { createdAt: 'asc' }") ||
    inventoryServiceSource.includes('left.createdAt.getTime()')
  ) {
    addFailure('inventory.service.ts BOM line ordering must use sortOrder/id, not createdAt maintenance time.');
  }
  if (
    inventoryServiceSource.includes("orderBy: [{ isCommon: 'desc' }, { commonSortOrder: 'asc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }]") ||
    inventoryServiceSource.includes("orderBy: [{ updatedAt: 'desc' }]")
  ) {
    addFailure('inventory.service.ts BOM import/delete helper queries must not sort by updatedAt maintenance time.');
  }
  const modelBomDiffReviewListBlock = inventoryServiceSource.match(/async modelBomDiffReviews\(bomId: string[\s\S]*?\n  async buildModelBomDiffReviewsExport/)?.[0] || '';
  const modelBomDiffReviewExportBlock = inventoryServiceSource.match(/async buildModelBomDiffReviewsExport\(bomId: string[\s\S]*?\n  async confirmModelBomDiffReview/)?.[0] || '';
  const modelBomDiffReviewSerializeBlock = inventoryServiceSource.match(/private serializeModelBomDiffReview\([\s\S]*?\n  private serializeModelBom/)?.[0] || '';
  const modelBomDiffReviewTypeBlock = frontendTypesSource.match(/export interface ModelBomDiffReview[\s\S]*?\n}/)?.[0] || '';
  if (!inventoryServiceSource.includes("orderBy: [{ revisionNo: 'desc' }, { id: 'desc' }]")) {
    addFailure('inventory.service.ts BOM revision pagination must use stable revisionNo/id ordering.');
  }
  if (
    !modelBomDiffReviewListBlock.includes("orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }]") &&
    !modelBomDiffReviewListBlock.includes("const orderBy: Prisma.ModelBomDiffReviewOrderByWithRelationInput[] = [{ reviewedAt: 'desc' }, { id: 'desc' }]")
  ) {
    addFailure('inventory.service.ts BOM diff review list must use stable reviewedAt/id ordering.');
  }
  if (!modelBomDiffReviewExportBlock.includes("orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }]")) {
    addFailure('inventory.service.ts BOM diff review export must use the same stable reviewedAt/id ordering as the list.');
  }
  const modelBomDiffReviewPaginationSnippets = [
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'export class ModelBomDiffReviewQueryDto'],
    ["backend/src/modules/inventory/dto.ts", inventoryDtoSource, 'withPage?: string'],
    ["backend/src/modules/inventory/inventory.controller.ts", inventoryControllerSource, "return this.inventoryService.modelBomDiffReviews(bomId, { ...query, withPage: 'true' });"],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);'],
    ["backend/src/modules/inventory/inventory.service.ts", inventoryServiceSource, 'reviewKeys: keyRows.map((row) => row.reviewKey)'],
    ["frontend/src/types/erp.ts", frontendTypesSource, 'export interface ModelBomDiffReviewListResponse'],
    ["frontend/src/types/erp.ts", frontendTypesSource, 'reviewKeys: string[]'],
    ["frontend/src/api/erp.ts", frontendApiSource, 'modelBomDiffReviewsPage(bomId: string']
  ];
  for (const [file, source, snippet] of modelBomDiffReviewPaginationSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`${file} must keep BOM diff review pagination/reviewKey contract snippet: ${snippet}`);
    }
  }
  if (frontendApiSource.includes('modelBomDiffReviews(bomId: string, sourceBomId?: string)')) {
    addFailure('frontend/src/api/erp.ts must not expose legacy modelBomDiffReviews() full-list API; use modelBomDiffReviewsPage().');
  }
  if (modelBomDiffReviewListBlock.includes('return rows.map((row) => this.serializeModelBomDiffReview(row));')) {
    addFailure('inventory.service.ts modelBomDiffReviews must always return the paginated list contract, not a legacy full array.');
  }
  if (modelBomDiffReviewListBlock.includes("updatedAt: 'desc'")) {
    addFailure('inventory.service.ts BOM diff review list must sort by reviewedAt and stable id, not updatedAt maintenance time.');
  }
  if (
    modelBomDiffReviewExportBlock.includes("'创建时间'") ||
    modelBomDiffReviewExportBlock.includes("'更新时间'") ||
    modelBomDiffReviewExportBlock.includes('row.createdAt') ||
    modelBomDiffReviewExportBlock.includes('row.updatedAt')
  ) {
    addFailure('inventory.service.ts BOM diff review export must keep reviewedAt but omit generic maintenance timestamps.');
  }
  if (
    modelBomDiffReviewSerializeBlock.includes('createdAt: row.createdAt') ||
    modelBomDiffReviewSerializeBlock.includes('updatedAt: row.updatedAt') ||
    modelBomDiffReviewSerializeBlock.includes('createdAt: Date') ||
    modelBomDiffReviewSerializeBlock.includes('updatedAt: Date')
  ) {
    addFailure('inventory.service.ts BOM diff review API response must not expose generic maintenance timestamps.');
  }
  if (modelBomDiffReviewTypeBlock.includes('createdAt') || modelBomDiffReviewTypeBlock.includes('updatedAt')) {
    addFailure('frontend/src/types/erp.ts ModelBomDiffReview must not expose generic maintenance timestamps.');
  }
  if (modelBomScopeApprovalRegressionSource.includes('scope approval regression needs at least one enabled customer')) {
    addFailure('scripts/verify-model-bom-scope-approval-api.cjs must create and soft-disable its own customer instead of depending on existing enabled customers.');
  }
}

function verifyMaterialImportIssueReportWorkflow() {
  const requiredFiles = [
    'backend/src/modules/inventory/inventory.service.ts',
    'backend/src/modules/inventory/inventory.controller.ts',
    'backend/src/modules/inventory/dto.ts',
    'frontend/src/api/erp.ts',
    'frontend/src/types/erp.ts',
    'frontend/src/views/MaterialsView.vue',
    'frontend/src/views/OrdersListView.vue',
    'database/prisma/schema.prisma',
    'database/prisma/verify-first-stage.ts',
    'database/prisma/migrations/20260515233000_material_import_preview_error_rows/migration.sql',
    'scripts/verify-material-import-api.cjs',
    'AGENTS.md',
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
  const inventoryDtoSource = readFile('backend/src/modules/inventory/dto.ts');
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  const frontendTypesSource = readFile('frontend/src/types/erp.ts');
  const materialsViewSource = readFile('frontend/src/views/MaterialsView.vue');
  const ordersListViewSource = readFile('frontend/src/views/OrdersListView.vue');
  const schemaSource = readFile('database/prisma/schema.prisma');
  const dataVerifierSource = readFile('database/prisma/verify-first-stage.ts');
  const materialImportPreviewErrorMigrationSource = readFile(
    'database/prisma/migrations/20260515233000_material_import_preview_error_rows/migration.sql'
  );
  const materialImportApiVerifySource = readFile('scripts/verify-material-import-api.cjs');
  const agentsSource = readFile('AGENTS.md');
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
    'createMaterialImportSessionFromOrderImport(orderImportSessionId: string',
    '订单净表提取只生成零件库导入草稿，不写入正式零件、BOM、订单、生产任务或库存。',
    'orderImportPreviewToken({',
    'orderImportRowToMaterialImportRow',
    'const applicabilityRows = this.orderImportRowsToMaterialApplicabilityImportRows(sourceRows)',
    'orderImportRowsToMaterialApplicabilityImportRows',
    'createModelBomDraftsFromOrderImport(orderImportSessionId: string',
    "const enabledMaterials = existingMaterials.filter((material) => material.status === 'ENABLED');",
    'const materialByCode = new Map(enabledMaterials.map',
    'const materialIdsForDrawingLookup = [...new Set(enabledMaterials.map',
    'commitModelBomDraftFromOrderImport(',
    'reviewedExistingBomIds',
    'missingReviewBoms',
    'unrelatedReviewedBomIds',
    'currentSameScopeBoms',
    'staleReviewedBomIds',
    'unreviewedCurrentBoms',
    '核对 BOM 不属于当前草稿范围',
    'reviewedExistingBomRemark',
    '已核对已有 BOM',
    'formatBusinessListPreview',
    'formatBomNamePreview',
    'this.formatBomNamePreview(existingBoms.map((bom) => bom.bomName))',
    'unreviewedCurrentBoms.map((bom) => bom.bomName)',
    'const references = this.formatBusinessListPreview(',
    'referencingLines.map(',
    'const preview = this.formatBusinessListPreview(',
    'copiedCustomerBoms.map(',
    '当前范围已有新的正式 BOM 尚未核对',
    '创建新 BOM 前必须逐个完成差异核对',
    'normalizedLines: Array<(typeof draft.lines)[number] & { defaultProcessRoute: string | null }>',
    'modelBomDraftLineKey',
    'orderImportBomDefaultQuantity',
    'EXISTING_BOM_SCOPE',
    'DUPLICATE_COMPONENT_NO',
    '组件编号在当前 BOM 草稿中重复',
    '当前 BOM 草稿中存在相同零件和相同结构位置，请先人工合并数量后再确认正式 BOM',
    'DRAWING_REVISION_NOT_FOUND',
    'drawingNoVersionKeysForPreview',
    '零件基础库没有与导入图号和版本一致的启用图纸版本',
    '有导入图号和版本时只绑定完全一致的图纸',
    'drawingByMaterialNoAndVersion',
    'drawingVersion: row.drawingVersion || null',
    'MATERIAL_NOT_FOUND',
    'scopeRowCount: applicabilityRows.length',
    'materialApplicabilityImportRow.createMany',
    'projectModel: null',
    'raw: (row.raw || {})',
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
  if (inventoryServiceSource.includes("existingBoms.map((bom) => bom.bomName).join('、')")) {
    addFailure('inventory.service.ts must summarize reviewed existing BOM names instead of storing the full joined list.');
  }
  if (inventoryServiceSource.includes("previewRows.join('、')")) {
    addFailure('inventory.service.ts must summarize copied customer BOM references instead of joining the full list.');
  }

  const controllerSnippets = [
    "@Get('material-import-sessions/:sessionId/error-report')",
    "@Post('material-import-sessions/from-order-import/:orderImportSessionId')",
    "@Post('model-bom-drafts/from-order-import/:orderImportSessionId')",
    "@Post('model-bom-drafts/from-order-import/:orderImportSessionId/commit')",
    'CreateMaterialImportFromOrderImportDto',
    'CreateModelBomDraftFromOrderImportDto',
    'CommitModelBomDraftFromOrderImportDto',
    'materialImportUploadMaxBytes()',
    'MATERIAL_IMPORT_UPLOAD_MAX_MB',
    'const safeMb = Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : 100',
    'limits: { fileSize: materialImportUploadMaxBytes() }',
    'downloadMaterialImportIssueReport',
    'buildMaterialImportIssueReport(sessionId)'
  ];
  for (const snippet of controllerSnippets) {
    if (!inventoryControllerSource.includes(snippet)) {
      addFailure(`inventory.controller.ts must keep material import issue report API snippet: ${snippet}`);
    }
  }
  const commitModelBomDraftDtoBlock = inventoryDtoSource.match(/export class CommitModelBomDraftFromOrderImportDto[\s\S]*?\n}/)?.[0] || '';
  for (const snippet of ['reviewedExistingBomIds', '@IsArray()', '@IsString({ each: true })']) {
    if (!commitModelBomDraftDtoBlock.includes(snippet)) {
      addFailure(`inventory dto must keep BOM draft commit reviewedExistingBomIds validation snippet: ${snippet}`);
    }
  }
  if (
    !agentsSource.includes('reviewedExistingBomIds') ||
    !agentsSource.includes('不得只依赖前端按钮禁用')
  ) {
    addFailure('AGENTS.md must document backend-enforced reviewedExistingBomIds for order-import BOM draft commit.');
  }

  const frontendSnippets = [
    'downloadMaterialImportIssueReport(sessionId: string)',
    'createMaterialImportSessionFromOrderImport(orderImportSessionId: string, previewToken: string',
    'createModelBomDraftsFromOrderImport(orderImportSessionId: string, previewToken: string',
    'commitModelBomDraftFromOrderImport(',
    'reviewedExistingBomIds?: string[]',
    'reviewedExistingBomIds: modelBomDraftExistingBoms(draft)',
    '.filter((bom) => modelBomDraftDiffReviewed(draft, bom))',
    'modelBomDraftCommittingKey',
    'modelBomDraftCanCommit',
    "draft.lines.some((line) => !line.materialId || line.materialStatus !== 'ENABLED')",
    'return modelBomDraftExistingBoms(draft).length === 0 || modelBomDraftDiffReviewComplete(draft);',
    'modelBomDraftHasMissingMaterials',
    'openExistingModelBomFromDraft(draft, bom)',
    'targetBom?: ModelBomDraftExistingBomSummary',
    'bomId: saved.id',
    "scopeMode: 'PRIVATE'",
    '确认创建正式 BOM',
    'modelBomDraftPreviewVisible',
    'modelBomDraftPreviewedAt',
    'previewModelBomDraftFromOrderImport',
    '刷新 BOM 草稿',
    '重新校验，不会写入业务数据',
    '提取零件库草稿',
    'materialImportSessionId: result.id',
    "returnTo: '/orders'",
    'orderImportSessionId: importPreview.value.id',
    "previewBomDraft: '1'",
    'openOrderImportSessionFromRoute',
    'routeOrderImportOpenKey',
    'route.query.orderImportSessionId',
    'route.query.previewBomDraft',
    'openMaterialImportSessionFromRoute',
    "routeQueryText(route.query.returnTo) === '/orders'",
    'routeQueryText(route.query.orderImportSessionId)',
    'watch(',
    'route.query.materialImportSessionId',
    "guardDesktopOperation('打开零件库导入草稿')",
    'importDialogVisible.value = true;',
    'openMaterialImportTrace',
    'materialImportTraceEntries',
    '导入行追溯',
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
    if (!frontendApiSource.includes(snippet) && !materialsViewSource.includes(snippet) && !ordersListViewSource.includes(snippet)) {
      addFailure(`Frontend must keep material import issue report UI/API snippet: ${snippet}`);
    }
  }
  const modelBomDraftCanCommitBlock = ordersListViewSource.match(/function modelBomDraftCanCommit[\s\S]*?\n}/)?.[0] || '';
  if (modelBomDraftCanCommitBlock.includes('startsWith(')) {
    addFailure('OrdersListView.vue modelBomDraftCanCommit must use explicit business predicates, not localized message startsWith().');
  }
  if (!frontendTypesSource.includes('raw?: Record<string, string | number | boolean | null>;')) {
    addFailure('frontend/src/types/erp.ts must expose material import raw source trace fields.');
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
    "const runId = 'STABLE';",
    "const materialPrefix = 'MI-API-STABLE';",
    '零件库导入模板',
    '/inventory/material-import-template',
    '/inventory/material-import-config',
    '/inventory/material-import-sessions',
    '/inventory/material-import-sessions/from-order-import/',
    '/inventory/model-bom-drafts/from-order-import/',
    'createOrderImportSourceSession',
    'assertExtractedOrderImportDraftOnly',
    'assertExtractedOrderImportModelBomDraftPreviewOnly',
    'assertDuplicateComponentModelBomDraftBlocked',
    'seedOrderExtractMaterialsForBomCommit',
    'createConcurrentOrderImportModelBom',
    'assertCommittedOrderImportModelBomDraft',
    'from-order-import-draft-preview',
    'from-order-import-model-bom-draft-preview',
    'from-order-import-model-bom-draft-duplicate-component',
    'from-order-import-model-bom-draft-commit',
    'from-order-import-model-bom-draft-unrelated-existing-review',
    'from-order-import-model-bom-draft-revision-snapshot',
    'from-order-import-model-bom-draft-existing-review',
    'from-order-import-model-bom-draft-existing-review-audit',
    'from-order-import-model-bom-draft-partial-existing-review',
    'from-order-import-model-bom-draft-stale-existing-review',
    'model-bom-draft commit stale existing BOM review',
    '逐个完成差异核对',
    'reviewedExistingBomIds commit revision remark must record reviewed BOM name',
    'model BOM draft commit must create 1 ModelBomRevision snapshot',
    "revisions[0].action === 'ORDER_IMPORT_DRAFT_COMMIT'",
    'model BOM draft commit revision snapshot must keep component and child-part structure',
    'from-order-import preview applicability rows must be 2',
    'from-order-import material rows must not store project scope',
    'MaterialApplicability rows before commit',
    'model BOM draft preview must not create ModelBom rows',
    'model BOM draft preview must not create ModelBomLine rows',
    'model-bom-draft commit duplicate componentNo',
    'model BOM draft commit must not bind an unrelated default drawing revision',
    'commit-ready model BOM preview must flag missing matching drawing revision',
    'model BOM draft commit must not create CustomerOrder rows',
    'model-bom-draft commit duplicate formal BOM name scope',
    'raw source trace fields',
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
    'findOrderExtractCustomer',
    'prepareOrderExtractCustomer',
    'archiveOrderExtractCustomer',
    'archivedFixtureIdentity',
    'ensureProcessDefinitionFixture',
    'ensureMaterialDefaultProcessFixture',
    ".replace(/[\\s\\-_./\\\\]+/g, '')",
    'processNameNormalized = processNameKey(processName)',
    "requestJson('/process-definitions'",
    "`/process-definitions/${existing.id}/restore`",
    'Number(result.createdCount || 0) + Number(result.updatedCount || 0) === 2',
    'prisma.modelBom.update({',
    'prisma.material.updateMany({',
    'prisma.processDefinition.updateMany({',
    'prisma.customerContact.updateMany',
    'customerCode: archivedCustomerIdentity(orderExtractCustomerCode, customer.id)',
    'customerName: archivedCustomerIdentity(orderExtractCustomerName, customer.id)',
    "contactName: null",
    "contactPhone: null",
    '来源加工关系只作为建议，不自动扣库存'
  ];
  for (const snippet of regressionScriptSnippets) {
    if (!materialImportApiVerifySource.includes(snippet) && !packageSource.includes(snippet)) {
      addFailure(`verify-material-import-api.cjs/package.json must keep material import API regression snippet: ${snippet}`);
    }
  }
  if (
    materialImportApiVerifySource.includes('prisma.customer.deleteMany') ||
    materialImportApiVerifySource.includes('prisma.customer.upsert') ||
    materialImportApiVerifySource.includes('prisma.material.deleteMany') ||
    materialImportApiVerifySource.includes('prisma.modelBom.deleteMany') ||
    materialImportApiVerifySource.includes('prisma.processDefinition.deleteMany') ||
    materialImportApiVerifySource.includes('prisma.materialTransformRule.deleteMany') ||
    materialImportApiVerifySource.includes('prisma.materialApplicability.deleteMany') ||
    materialImportApiVerifySource.includes('prisma.materialDrawingRevision.deleteMany') ||
    materialImportApiVerifySource.includes('new Date().toISOString().replace(/[-:.TZ]/g')
  ) {
    addFailure('verify-material-import-api.cjs must reuse stable import fixtures and archive temporary customers instead of creating timestamped master data.');
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
    '<el-table-column label="操作" width="170" fixed="right">',
    'process-order-actions',
    'process-order-action-group',
    'process-order-action-label',
    ':title="processEntryActionText(row)"',
    'title="订单明细"',
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
    '<el-table-column label="操作" width="210" fixed="right">',
    'order-row-actions',
    'order-row-action-group',
    'order-row-action-label',
    ':title="orderProcessActionText(row)"',
    'title="取消订单"',
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
    'title="刷新整页订单数据"',
    'const orderPageRefreshing = ref(false)',
    'async function refreshOrdersPage()',
    '整页刷新同步订单下拉、订单列表和已打开的导入记录',
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
    '<el-table-column label="操作" width="200" fixed="right">',
    'production-order-actions',
    'production-order-action-group',
    'production-order-action-label',
    'title="进入生产详情"',
    'title="批量开始生产"',
    '<el-table-column label="操作" width="210" fixed="right">',
    'production-task-actions',
    'production-task-action-group',
    'production-task-action-label',
    'title="主管确认补单"',
    'title="管理撤回"',
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
    'title="刷新整页生产数据"',
    'const productionPageRefreshing = ref(false)',
    'async function refreshProductionPage()',
    '生产页整页刷新必须同步当前客户名、操作员缓存、任务、订单汇总、通知和补单申请。',
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
    'inventory-memory-actions',
    'inventory-batch-actions',
    '编辑零件搜索记忆',
    '启用零件搜索记忆',
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
    '<el-table-column label="操作" width="360" fixed="right">',
    'customer-row-actions',
    'customer-row-action-group',
    'customer-row-action-label',
    'title="客户零件包"',
    '设常用',
    '新常用',
    'title="新建常用BOM"',
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
    'formatCustomerNamePreview(row.scopeCustomers?.map((customer) => customer.customerName) || [], \'指定客户\', row.scopeCustomerCount)',
    'function formatCustomerNamePreview(names: Array<string | null | undefined>, emptyText = \'-\', totalCount?: number)',
    'const total = typeof totalCount === \'number\' && totalCount > filtered.length ? totalCount : filtered.length',
    '等 ${total} 个客户',
    'customerBomCommonScopePreview(row)',
    'customerBomCommonScopeTitle(row)',
    'function customerBomCommonScopeTitle(row: ModelBom)',
    '`适用范围：${customerBomCommonScopePreview(row)}`',
    '客户页只显示摘要，需要完整范围时进入 BOM 详情核对；不会修改 BOM 明细、订单、生产任务或库存',
    'customer-common-bom-actions',
    'customer-common-bom-action-group',
    'customer-common-bom-action-label',
    "'设为客户常用 BOM'",
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
    'title="刷新整页客户数据"',
    'const customerPageRefreshing = ref(false)',
    'async function refreshCustomersPage()',
    '整页刷新同步客户资料和已打开的客户常用 BOM',
    '客户资料加载失败，请确认后端服务和筛选条件',
    '客户可用 BOM 加载失败，请确认客户筛选和后端服务',
    '客户ID自动生成失败，请手工填写客户ID'
  ];
  for (const snippet of customerSnippets) {
    if (!customersSource.includes(snippet)) {
      addFailure(`CustomersView.vue must keep compact mobile customer card snippet: ${snippet}`);
    }
  }
  if (customersSource.includes("row.scopeCustomers?.map((customer) => customer.customerName).join('、')")) {
    addFailure('CustomersView.vue customer BOM scope text must summarize selected customers instead of listing every customer name.');
  }
  if (customersSource.includes('`适用范围：${row.scopeLabel || customerBomCommonScopePreview(row)}`')) {
    addFailure('CustomersView.vue customer common BOM tooltip must not reuse raw scopeLabel because selected-customer ranges can be too long.');
  }
  if (customersSource.includes('<strong>{{ row.scopeLabel }}</strong>')) {
    addFailure('CustomersView.vue customer common BOM table must summarize scope labels with tooltip instead of rendering raw scopeLabel.');
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
    'title="降低统计库存快照表格高度"',
    'title="恢复统计订单展示表格默认高度"',
    '查看当前库存快照详情',
    '查看订单展示详情',
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
    'order-line-change-actions',
    'order-line-change-action-group',
    'order-line-change-action-label',
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
    '标准工序列表高度只保存为本机 UI 偏好，不写入标准工序、流程记忆、订单、BOM、生产或库存业务数据。',
    'processDefinitionListHeightStorageKey',
    'window.localStorage.getItem(processDefinitionListHeightStorageKey)',
    'window.localStorage.setItem(processDefinitionListHeightStorageKey',
    'aria-label="标准工序列表高度"',
    'aria-label="降低标准工序列表高度"',
    'title="降低标准工序列表高度"',
    'aria-label="提高标准工序列表高度"',
    'title="提高标准工序列表高度"',
    'title="恢复标准工序列表默认高度"',
    ':style="{ maxHeight: `${processDefinitionListHeight}px` }"',
    'process-definition-list-height-actions',
    '.process-definition-card.expanded .process-definition-actions',
    'process-definition-action-group',
    'process-definition-action-label',
    ":title=\"isMobileDefinitionExpanded(definition.id) ? '收起标准工序详情' : '查看标准工序详情'\"",
    'processDefinitionRemarkPreview(definition)',
    ':title="definition.remark || \'\'"',
    'function processDefinitionRemarkPreview(definition: ProcessDefinition)',
    'function formatLongTextPreview'
  ];
  for (const snippet of processDefinitionSnippets) {
    if (!processDefinitionSource.includes(snippet)) {
      addFailure(`ProcessDefinitionManager.vue must keep compact mobile process-definition card snippet: ${snippet}`);
    }
  }
  if (processDefinitionSource.includes('<small v-if="definition.remark">{{ definition.remark }}</small>')) {
    addFailure('ProcessDefinitionManager.vue must summarize process-definition remarks in list cards instead of rendering full remark text directly.');
  }
  if (processDefinitionSource.includes("<p>{{ definition.remark || '暂无备注' }}</p>")) {
    addFailure('ProcessDefinitionManager.vue must summarize process-definition remarks in tooltip content instead of rendering full remark text directly.');
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
    '流程记忆列表高度只保存为本机 UI 偏好，不写入流程记忆、标准工序、订单、BOM、生产或库存业务数据。',
    'processTemplateListHeightStorageKey',
    'window.localStorage.getItem(processTemplateListHeightStorageKey)',
    'window.localStorage.setItem(processTemplateListHeightStorageKey',
    'aria-label="流程记忆列表高度"',
    'aria-label="降低流程记忆列表高度"',
    'title="降低流程记忆列表高度"',
    'aria-label="提高流程记忆列表高度"',
    'title="提高流程记忆列表高度"',
    'title="恢复流程记忆列表默认高度"',
    ':style="{ maxHeight: `${processTemplateListHeight}px` }"',
    'process-template-list-height-actions',
    '.process-template-card.expanded .process-template-card-actions',
    'process-template-action-group',
    'process-template-action-label',
    ":title=\"isMobileTemplateExpanded(template.id) ? '收起流程记忆详情' : '查看流程记忆详情'\"",
    'templateRemarkPreview(template)',
    'function templateRemarkPreview(template: ProcessTemplate)',
    'templateStepRemarkPreview(step)',
    'templateStepRemarkPreview(step, 28)',
    'templateStepRemarkTitle(step)',
    'function templateStepRemarkPreview(step: ProcessStepDetail',
    'function templateStepRemarkTitle(step: ProcessStepDetail)',
    'function formatLongTextPreview',
    '等 ${steps.length} 道工序'
  ];
  for (const snippet of processTemplateSnippets) {
    if (!processTemplateSource.includes(snippet)) {
      addFailure(`ProcessTemplateManager.vue must keep compact mobile process-template card snippet: ${snippet}`);
    }
  }
  if (processTemplateSource.includes('<em v-if="template.remark">{{ template.remark }}</em>')) {
    addFailure('ProcessTemplateManager.vue must summarize template remarks in list cards instead of rendering full remark text directly.');
  }
  if (processTemplateSource.includes("return steps.map((step) => (step.processRemark ? `${step.processName}(${step.processRemark})` : step.processName)).join(' → ');")) {
    addFailure('ProcessTemplateManager.vue must summarize process template step lists instead of rendering every full step remark in cards.');
  }
  if (processTemplateSource.includes('<span v-if="step.processRemark">：{{ step.processRemark }}</span>')) {
    addFailure('ProcessTemplateManager.vue must summarize process template step remarks in tooltip/detail views instead of rendering full remark text directly.');
  }
  if (processTemplateSource.includes('<p v-if="template.remark">备注：{{ template.remark }}</p>')) {
    addFailure('ProcessTemplateManager.vue must summarize process template remarks in tooltip/detail views instead of rendering full remark text directly.');
  }
  if (processTemplateSource.includes('<p v-if="previewTemplate.remark">备注：{{ previewTemplate.remark }}</p>')) {
    addFailure('ProcessTemplateManager.vue must summarize process template preview remarks instead of rendering full remark text directly.');
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
    '请先开始生产',
    '请先完成上一道工序',
    'function openProcessCompletion(row: ProductionTask, processName: string)',
    'if (!canOpenProcess(row, processName))',
    ':before-close="handleProcessDialogClose"',
    'closeProcessDialog',
    '工序完成表正在保存，请等待保存完成',
    'selectedProcessNamesForSave()',
    'missingOperatorProcessNames',
    'formatProductionListPreview',
    "formatProductionListPreview(missingOperatorProcessNames, '工序')",
    "formatProductionListPreview(selectedProcessNames, '工序')",
    'quantityOverrideReasonPreview',
    'quantityOverrideReasonTitle',
    'formatLongTextPreview(processForm.quantityOverrideReason, 42, \'-\')',
    "formatLongTextPreview(remark, 12, '')",
    'formatProcessLogPreview(log.beforeSnapshot)',
    'formatProcessLogTitle(log.beforeSnapshot)',
    'function formatProcessLogPreview(snapshot?: Record<string, unknown> | null)',
    "formatLongTextPreview(formatProcessLog(snapshot), 96, '-')",
    "function processStepTitle(row: { processStepDetails?: ProductionTask['processStepDetails'] }",
    "function processStepRemark(row: { processStepDetails?: ProductionTask['processStepDetails'] }",
    "formatProductionProcessSteps(task, '未配置生产流程', ' → ')",
    "function formatProductionProcessSteps(row: { processSteps: string[]; processStepDetails?: ProductionTask['processStepDetails'] }",
    'function orderSummaryProgressPreviewItems(row: ProductionOrderSummary)',
    'function orderSummaryProgressText(row: ProductionOrderSummary)',
    'return formatProductionListPreview(orderSummaryProgressItems(row), \'进度\');',
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
  if (
    viewSource.includes("missingOperatorProcessNames.join('、')") ||
    viewSource.includes("selectedProcessNames.join('、')") ||
    viewSource.includes("task.processSteps.map((step) => processStepDisplay(task, step)).join('、')") ||
    viewSource.includes("task.processSteps.map((step) => processStepDisplay(task, step)).join(' → ')") ||
    viewSource.includes("row.processSteps.map((step) => processStepDisplay(row, step)).join('、')") ||
    viewSource.includes("orderSummaryProgressItems(selectedOrderOverview).join('、')") ||
    viewSource.includes("orderSummaryProgressItems(summary).join('、')") ||
    viewSource.includes("orderSummaryProgressItems(row).join('、')")
  ) {
    addFailure('ProductionView.vue must summarize batch/process-step names instead of rendering every item in rows or messages.');
  }
  if (viewSource.includes('<strong>{{ processForm.quantityOverrideReason }}</strong>')) {
    addFailure('ProductionView.vue must summarize quantity override reasons in confirmation dialogs.');
  }
  if (viewSource.includes('{{ formatProcessLog(log.beforeSnapshot) }}') || viewSource.includes('{{ formatProcessLog(log.afterSnapshot) }}')) {
    addFailure('ProductionView.vue must summarize process log snapshots with formatProcessLogPreview and keep full text in title.');
  }
  if (viewSource.includes('return remark ? `${processName}（${remark}）` : processName;')) {
    addFailure('ProductionView.vue must summarize process step remarks in pills/buttons instead of rendering full remarks directly.');
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
    "return this.productionService.replenishmentRequests({ ...query, withPage: 'true' })",
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
    'withPage?: string',
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
    'productionReplenishmentRequestsPage(filters: ProductionReplenishmentRequestFilters = {})',
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
    'export interface ProductionReplenishmentRequestListResponse',
    'export interface ProductionScrapRecordListResponse',
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
    'erpApi.productionReplenishmentRequestsPage',
    'replenishmentRequestPagination',
    'handleReplenishmentRequestPageChange',
    'scrapRecordPagination',
    'handleScrapRecordPageChange',
    'productionNoticeReasonPreview(notice)',
    'function productionNoticeReasonPreview(notice: ProductionNotice)',
    'scrapRecordReasonPreview(row)',
    'scrapRecordReasonTitle(row)',
    'function scrapRecordReasonPreview(record: ProductionScrapRecord)',
    'function scrapRecordReasonTitle(record: ProductionScrapRecord)',
    'replenishmentRequestReasonPreview(request)',
    'function replenishmentRequestReasonPreview(request: ProductionReplenishmentRequest)',
    'replenishmentSupervisorRemarkPreview(request)',
    'function replenishmentSupervisorRemarkPreview(request: ProductionReplenishmentRequest)',
    'function formatLongTextPreview',
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
  if (viewSource.includes('<template v-if="request.supervisorRemark"> / 审核说明：{{ request.supervisorRemark }}</template>')) {
    addFailure('ProductionView.vue must summarize replenishment supervisor remarks instead of rendering full text in the request list.');
  }
  if (viewSource.includes('<p>{{ notice.reason }}</p>')) {
    addFailure('ProductionView.vue must summarize production notice reasons instead of rendering full text in the notice list.');
  }
  if (viewSource.includes('<p class="replenishment-request-reason">{{ request.reason }}</p>')) {
    addFailure('ProductionView.vue must summarize replenishment request reasons instead of rendering full text in the request list.');
  }
  if (/<el-table-column\s+prop="reason"\s+label="[^"]*"\s+min-width="260"\s+show-overflow-tooltip\s*\/>/.test(viewSource)) {
    addFailure('ProductionView.vue must summarize production scrap record reasons instead of rendering full reason text through raw overflow tooltip.');
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
    'formatOrderDetailListPreview',
    "formatOrderDetailListPreview(line.productionReplenishmentRequestNos || [], '补单申请')",
    "formatOrderDetailListPreview(line.productionReplenishmentTaskNos || [], '补单任务')",
    "formatOrderDetailListPreview(rows.map((row) => formatQuantity(row.quantity, row.unit)), '单位')",
    "formatOrderDetailListPreview(line.processSteps, '工序')",
    "formatOrderDetailListPreview(detailLine.materialIdentityConflictFields, '字段')",
    'formatLineShortagePreview(line)',
    'function formatLineShortagePreview(line: OrderLine',
    'shortageRecordReasonPreview(record)',
    'function shortageRecordReasonPreview(record:',
    'stockSourceSummaryPreview(line)',
    'stockSourceSummaryPreview(row, 42)',
    'function stockSourceSummaryPreview(line: OrderLine | CreateOrderLinePayload',
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
  if (
    detailViewSource.includes("line.productionReplenishmentRequestNos.join('、')") ||
    detailViewSource.includes("line.productionReplenishmentTaskNos.join('、')") ||
    detailViewSource.includes("completedTasks.map((task) => task.productionTaskNo).join('、')") ||
    detailViewSource.includes("rows.map((row) => formatQuantity(row.quantity, row.unit)).join('、')") ||
    detailViewSource.includes("line.processSteps.join('、')") ||
    detailViewSource.includes("detailLine.materialIdentityConflictFields.join('、')")
  ) {
    addFailure('OrderDetailView.vue must summarize replenishment/process/conflict lists instead of rendering the full joined list.');
  }
  if (detailViewSource.includes('<p>{{ formatLineShortageText(line) }}</p>')) {
    addFailure('OrderDetailView.vue must summarize shortage text in pending/resolved shortage lists.');
  }
  if (detailViewSource.includes('{{ formatLineShortageText(row) || \'-\' }}')) {
    addFailure('OrderDetailView.vue must summarize shortage text in the order-line table.');
  }
  if (detailViewSource.includes('<small>{{ record.managerName || \'-\' }}确认：{{ record.shortageReason || \'-\' }}</small>')) {
    addFailure('OrderDetailView.vue must summarize shortage record reasons in shortage handling dialogs.');
  }
  if (
    detailViewSource.includes('库存来源：{{ stockSourceSummary(line) }}') ||
    detailViewSource.includes('{{ stockSourceSummary(row) }}')
  ) {
    addFailure('OrderDetailView.vue must summarize selected stock source text in cards and table rows.');
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
  const dtoPath = 'backend/src/modules/warehouses/dto.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const viewPath = 'frontend/src/views/WarehouseView.vue';
  const verifierPath = 'database/prisma/verify-first-stage.ts';
  const warehouseApiScriptPath = 'scripts/verify-warehouse-config-api.cjs';
  const warehouseWorkExportApiScriptPath = 'scripts/verify-warehouse-work-export-api.cjs';
  const packagePath = 'package.json';

  for (const projectPath of [
    controllerPath,
    servicePath,
    dtoPath,
    apiPath,
    viewPath,
    verifierPath,
    warehouseApiScriptPath,
    warehouseWorkExportApiScriptPath,
    packagePath
  ]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing warehouse workflow file: ${projectPath}`);
      return;
    }
  }

  const controllerSource = readFile(controllerPath);
  const controllerSnippets = [
    "@Get('warehouses/export')",
    "@Get('warehouse/notices')",
    "@Get('warehouse/notices/export')",
    "@Post('warehouse/notices/:id/acknowledge')",
    "@Get('warehouse/receipts/pending')",
    "@Get('warehouse/work/export')",
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
  const dtoSource = readFile(dtoPath);
  const verifierSource = readFile(verifierPath);
  const migrationSqlSource = readMigrationSqlSource();
  const serviceSnippets = [
    'async findWarehouses(query: WarehouseConfigQueryDto = {})',
    'async buildWarehouseConfigExport(query: WarehouseConfigQueryDto = {})',
    "query.locationStatus === 'ALL' ? undefined : query.locationStatus || statusFilter",
    'this.warehouseConfigWhere(statusFilter, includeTestFixtures)',
    'this.warehouseLocationConfigWhere(locationStatusFilter, includeTestFixtures)',
    'const WAREHOUSE_TEST_FIXTURE_PREFIXES = [',
    "'MAT-STABLE'",
    'nullableWarehouseFixtureStartsWith',
    "this.nullableWarehouseFixtureStartsWith('replenishmentSourceRequestNo', prefix)",
    "this.nullableWarehouseFixtureStartsWith('sourceProductionTaskNo', prefix)",
    'warehouseOrderFixtureWhere',
    'warehouseProductionTaskFixtureWhere',
    'warehouseInventoryBatchFixtureWhere',
    'warehouseConfigExportScopeText(query)',
    'warehouseConfigStatusLabel(locationStatus)',
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
    "if (query.includeTestFixtures !== 'true')",
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
    'where.NOT = this.warehouseInventoryBatchFixtureWhere()',
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
  if (serviceSource.includes("'TEST-',") || serviceSource.includes('"TEST-",')) {
    addFailure('WarehousesService must not use broad TEST- fixture prefix; only documented reusable regression prefixes may be hidden from business warehouse pages.');
  }

  const dtoSnippets = [
    'export class WarehouseConfigQueryDto',
    'export class WarehouseWorkQueryDto',
    'includeTestFixtures?: string;',
    "status?: 'ALL' | CommonStatus;",
    "locationStatus?: 'ALL' | CommonStatus;"
  ];
  for (const snippet of dtoSnippets) {
    if (!dtoSource.includes(snippet)) {
      addFailure(`warehouses dto must keep warehouse config export filter snippet: ${snippet}`);
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
    'warehouses(filters: { status?: CommonStatus | \'ALL\'; locationStatus?: CommonStatus | \'ALL\'; includeTestFixtures?: boolean } = {})',
    'downloadWarehouseConfigExport(',
    'export interface WarehouseWorkFilters',
    'includeTestFixtures?: boolean',
    'locationStatus: filters.locationStatus',
    "includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined",
    'pendingReceipts(filters: WarehouseWorkFilters = {})',
    '/warehouse/receipts/pending',
    'downloadWarehouseWorkExport(filters: WarehouseWorkFilters = {}, filename: string)',
    'confirmReceipt(productionTaskId: string, warehouseId: string, locationId: string, remark?: string)',
    'pendingShipments(filters: WarehouseWorkFilters = {})',
    '/warehouse/shipments/pending',
    'confirmShipment(batchId: string, remark?: string)',
    'confirmBatchShipment(batchIds: string[], remark?: string)',
    'confirmOrderShipment(orderNo: string, remark?: string)',
    'warehouseNoticesPage(status?: ProductionNoticeStatus, filters: Omit<ProductionNoticeFilters',
    "withPage: 'true'",
    'noticeType: filters.noticeType',
    'customerKeyword: filters.customerKeyword?.trim() || undefined',
    'acknowledgeWarehouseNotice(id: string, payload: AcknowledgeWarehouseNoticePayload | string)',
    'warehouseTransactionsPage(filters: WarehouseTransactionFilters = {})'
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
    'warehouseConfigExportFilters',
    'warehouseConfigStatusOptions',
    '显示仓库',
    '显示库位',
    'visibleWarehouseLocationCount',
    '配置显示/导出范围',
    "status: 'ENABLED',\n  locationStatus: 'ENABLED'",
    'warehouse-config-export-title',
    'warehouse-config-export-filter',
    'warehouseConfigVisibleWarehouses',
    'warehouseConfigStatusMatches(item.status, warehouseConfigExportFilters.status)',
    'warehouseConfigVisibleWarehouses.value.flatMap',
    'const visibleLocations = warehouse.locations.filter',
    'warehouseConfigStatusMatches(location.status, warehouseConfigExportFilters.locationStatus)',
    'const shouldShowWarehouseWithoutVisibleLocation',
    "warehouseConfigExportFilters.locationStatus === 'ENABLED'",
    "locationName: warehouse.locations.length ? '无启用库位' : '未建库位'",
    "warehouseConfigExportFilters.locationStatus === 'ALL'",
    "function warehouseConfigStatusMatches(status: CommonStatus, filter: CommonStatus | 'ALL')",
    'locationStatus: warehouseConfigExportFilters.locationStatus',
    '<el-table-column label="操作" width="220" fixed="right">',
    'warehouse-shipment-actions',
    'warehouse-shipment-action-group',
    'warehouse-shipment-action-label',
    'title="选中订单"',
    ':title="shipmentLockedText(row) || \'订单发货\'"',
    ':title="shipmentLockedText(row) || shipmentShortageText(row) || \'确认发货\'"',
    '<el-table-column label="操作" fixed="right" width="260">',
    'warehouse-config-actions',
    'warehouse-config-action-group',
    'warehouse-config-action-label',
    'title="编辑仓库"',
    ":title=\"row.warehouseStatus === 'ENABLED' ? '停用仓库' : '启用仓库'\"",
    'title="删除仓库"',
    'title="编辑库位"',
    ":title=\"row.locationStatus === 'ENABLED' ? '停用库位' : '启用库位'\"",
    'title="删除库位"',
    'erpApi.downloadWarehouseConfigExport',
    'warehouseWorkTableHeightLimits',
    'warehouseWorkTableDefaultHeights',
    'warehouseWorkTableHeightStorageKey',
    "type WarehouseWorkTableKey = 'receipts' | 'shipments' | 'locations' | 'transactions' | 'batchShipment' | 'notices';",
    'const warehouseWorkTableKeys: WarehouseWorkTableKey[]',
    '仓库现场表格和通知列表高度只保存为本机 UI 偏好，不写入入库、发货、通知状态、库存批次或库存流水业务数据。',
    'const warehouseWorkTableHeights = reactive<Record<WarehouseWorkTableKey, number>>',
    'function clampWarehouseWorkTableHeight',
    'function adjustWarehouseWorkTableHeight',
    'function resetWarehouseWorkTableHeight',
    'function warehouseWorkTableHeightStyle',
    'function restoreWarehouseWorkTableHeights',
    'function saveWarehouseWorkTableHeights',
    'localStorage.getItem(warehouseWorkTableHeightStorageKey)',
    'localStorage.setItem(',
    'locations: warehouseWorkTableHeights.locations',
    'transactions: warehouseWorkTableHeights.transactions',
    'batchShipment: warehouseWorkTableHeights.batchShipment',
    'notices: warehouseWorkTableHeights.notices',
    'restoreWarehouseWorkTableHeights();',
    ':max-height="warehouseWorkTableHeights.receipts"',
    ':max-height="warehouseWorkTableHeights.shipments"',
    ':max-height="warehouseWorkTableHeights.locations"',
    ':max-height="warehouseWorkTableHeights.transactions"',
    ':max-height="warehouseWorkTableHeights.batchShipment"',
    'aria-label="提高待入库表格高度"',
    'title="提高待入库表格高度"',
    'title="恢复待入库表格默认高度"',
    'aria-label="提高待发货表格高度"',
    'title="提高待发货表格高度"',
    'title="恢复待发货表格默认高度"',
    'aria-label="提高仓库库位表格高度"',
    'title="提高仓库库位表格高度"',
    'title="恢复仓库库位表格默认高度"',
    'aria-label="提高库存流水表格高度"',
    'title="提高库存流水表格高度"',
    'title="恢复库存流水表格默认高度"',
    'aria-label="批量发货明细表格高度"',
    'aria-label="降低批量发货明细表格高度"',
    'title="降低批量发货明细表格高度"',
    'aria-label="提高批量发货明细表格高度"',
    'title="提高批量发货明细表格高度"',
    'aria-label="恢复批量发货明细表格默认高度"',
    'title="恢复批量发货明细表格默认高度"',
    'aria-label="仓库通知列表高度"',
    'aria-label="降低仓库通知列表高度"',
    'title="降低仓库通知列表高度"',
    'aria-label="提高仓库通知列表高度"',
    'title="提高仓库通知列表高度"',
    'aria-label="恢复仓库通知列表默认高度"',
    'title="恢复仓库通知列表默认高度"',
    ":style=\"{ maxHeight: warehouseWorkTableHeightStyle('notices') }\"",
    'aria-label="恢复待入库表格默认高度"',
    'aria-label="恢复待发货表格默认高度"',
    'aria-label="恢复仓库库位表格默认高度"',
    'aria-label="恢复库存流水表格默认高度"',
    '.warehouse-table-height-actions',
    '.warehouse-dialog-list-toolbar',
    'notice-scroll-list',
    '.batch-shipment-table-toolbar',
    "erpApi.warehouseNoticesPage('PENDING'",
    'warehouseNoticePagination',
    'handleWarehouseNoticePageChange',
    'erpApi.warehouseTransactionsPage',
    'transactionPagination',
    'handleTransactionPageChange',
    'formatLongTextPreview(row.remark)',
    'longTextTooltipText(row.remark)',
    'formatLongTextPreview(transaction.remark)',
    'function formatLongTextPreview',
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
    'title="刷新整页仓库数据"',
    'const warehousePageRefreshing = ref(false)',
    'async function refreshWarehousePage()',
    '整页刷新同步订单下拉、待入库、待发货、仓库配置、库存流水和已打开的仓库通知',
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
  if (viewSource.includes('<el-table-column prop="remark" label="备注" min-width="160" />') || viewSource.includes('{{ transaction.remark || \'-\' }}')) {
    addFailure('WarehouseView.vue must summarize warehouse transaction remarks instead of rendering full remark text directly.');
  }

  const warehouseApiScriptSource = readFile(warehouseApiScriptPath);
  const warehouseWorkExportApiScriptSource = readFile(warehouseWorkExportApiScriptPath);
  const packageSource = readFile(packagePath);
  const warehouseApiRegressionSnippets = [
    "const runId = 'STABLE';",
    "const testPrefix = 'COD-WH-STABLE';",
    "const orderImportWarehouseFixturePrefix = 'COD-IMPORT-STABLE';",
    'async function cleanupEmptyWarehouseFixture',
    'async function upsertRegressionWarehouseWithLocation(suffix)',
    'async function upsertRegressionWarehouseWithLocationForPrefix(prefix, suffix)',
    'createTemporaryWarehouseWithLocation',
    'prisma.warehouseLocation.updateMany',
    'prisma.warehouse.updateMany',
    'warehouse-config-reusable-history-fixture',
    'prisma.inventoryBatch.upsert',
    'prisma.inventoryTransaction.upsert',
    'hasInventoryHistory',
    'assertEmptyWarehouseCanBeDeleted',
    'assertWarehouseWithHistoryCanOnlyBeDisabled',
    'warehouse config list must hide reusable test fixtures unless includeTestFixtures=true',
    'warehouse config list must hide reusable order-import warehouse fixtures unless includeTestFixtures=true',
    'warehouse config export must hide reusable test fixtures unless includeTestFixtures=true',
    'warehouse config export must hide reusable order-import warehouse fixtures unless includeTestFixtures=true',
    'includeTestFixtures=true',
    'warehouse config list should expose order-import warehouse fixtures only when includeTestFixtures=true',
    'warehouse config list locationStatus=ALL should include disabled locations under enabled warehouses',
    'warehouse config list locationStatus=DISABLED must exclude enabled locations',
    'warehouse config list locationStatus=ENABLED must exclude disabled locations',
    'delete location with inventory history',
    'delete warehouse with inventory history',
    'soft-disabling warehouse must keep inventory batch history',
    'soft-disabling warehouse must keep inventory transaction history',
    'status=ENABLED&locationStatus=ALL',
    'status=ALL&locationStatus=DISABLED',
    'warehouse config export locationStatus=ALL should include disabled locations under enabled warehouses',
    'warehouse config export locationStatus=DISABLED must exclude enabled locations'
  ];
  for (const snippet of warehouseApiRegressionSnippets) {
    if (!warehouseApiScriptSource.includes(snippet)) {
      addFailure(`verify-warehouse-config-api.cjs must keep warehouse delete/disable regression snippet: ${snippet}`);
    }
  }
  if (warehouseApiScriptSource.includes('function localDateTimeStamp')) {
    addFailure('verify-warehouse-config-api.cjs must reuse a stable warehouse prefix instead of creating timestamped warehouse config data.');
  }
  for (const forbidden of [
    'prisma.inventoryTransaction.deleteMany',
    'prisma.inventoryBatch.deleteMany'
  ]) {
    if (warehouseApiScriptSource.includes(forbidden)) {
      addFailure(`verify-warehouse-config-api.cjs must reuse inventory history fixtures instead of physical cleanup: ${forbidden}`);
    }
  }
  const forbiddenWarehouseApiCleanupSnippets = [
    'await prisma.warehouseLocation.deleteMany({ where: { locationCode: { startsWith: testPrefix } } });',
    'await prisma.warehouse.deleteMany({ where: { warehouseCode: { startsWith: testPrefix } } });'
  ];
  for (const snippet of forbiddenWarehouseApiCleanupSnippets) {
    if (warehouseApiScriptSource.includes(snippet)) {
      addFailure('verify-warehouse-config-api.cjs must soft-disable reusable warehouse config fixtures instead of broad physical cleanup.');
    }
  }
  if (!packageSource.includes('"verify:warehouse-config-api": "node scripts/verify-warehouse-config-api.cjs"')) {
    addFailure('package.json must expose verify:warehouse-config-api for warehouse delete/disable regression testing.');
  }
  if (!packageSource.includes('"verify:warehouse-management-api": "node scripts/verify-warehouse-management-api.cjs"')) {
    addFailure('package.json must expose verify:warehouse-management-api for warehouse page data visibility regression testing.');
  }

  const warehouseWorkExportApiRegressionSnippets = [
    'warehouse-work-export-read-only',
    'warehouse-work-default-fixture-filter',
    'warehouse-work-include-test-fixtures-does-not-reduce-results',
    '/warehouse/receipts/pending?includeTestFixtures=true',
    '/warehouse/shipments/pending?includeTestFixtures=true',
    '/warehouse/work/export?includeTestFixtures=true',
    'assertNoFixtureText',
    'includeTestFixtures=true must not reduce'
  ];
  for (const snippet of warehouseWorkExportApiRegressionSnippets) {
    if (!warehouseWorkExportApiScriptSource.includes(snippet)) {
      addFailure(`verify-warehouse-work-export-api.cjs must keep warehouse work fixture visibility regression snippet: ${snippet}`);
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
    [productionServicePath, 'const items = await this.toNoticesWithCustomerNames(notices);'],
    [productionServicePath, 'async adminNotices(query: ProductionNoticeQueryDto = {})'],
    [productionServicePath, 'buildProductionNoticeWhere(query, query.target)'],
    [productionServicePath, 'buildProductionNoticeWhere'],
    [productionServicePath, 'const where: Prisma.ProductionNoticeWhereInput = target ? { target } : {};'],
    [productionServicePath, 'productionNoticeCustomerScope'],
    [productionServicePath, 'PRODUCTION_TEST_FIXTURE_PREFIXES'],
    [productionServicePath, 'productionNoticeFixtureWhere'],
    [productionServicePath, "query.includeTestFixtures !== 'true'"],
    [productionServicePath, '通知历史筛选必须覆盖订单、客户、零件、通知原因和任务号'],
    [productionServicePath, 'const customerNameByOrderId = new Map(orders.map((order) => [order.id, order.customerName]));'],
    [productionServicePath, 'customerNameByOrderId.get(notice.orderId) || customerNameByOrderNo.get(notice.orderNo) || undefined'],
    [productionControllerPath, "@Get('notices/admin')"],
    [productionControllerPath, "return this.productionService.notices({ ...query, withPage: 'true' });"],
    [productionControllerPath, "return this.productionService.adminNotices({ ...query, withPage: 'true' });"],
    [warehouseServicePath, 'const items = await this.toNoticesWithCustomerNames(notices);'],
    [warehouseServicePath, 'buildWarehouseNoticeWhere'],
    [warehouseServicePath, 'warehouseNoticeCustomerScope'],
    [warehouseServicePath, 'warehouseNoticeFixtureWhere'],
    [warehouseServicePath, "query.includeTestFixtures !== 'true'"],
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
  if (!noticeDialogSource.includes('<p :title="noticeReasonTitle">{{ noticeReasonPreview }}</p>')) {
    addFailure('NoticeAcknowledgeDialog.vue must summarize noticeReason in the acknowledgement dialog while preserving the full reason in title.');
  }
  if (!noticeDialogSource.includes('const noticeReasonPreview = computed(() => formatLongTextPreview(props.noticeReason, 72, \'-\'));')) {
    addFailure('NoticeAcknowledgeDialog.vue must keep a compact notice reason preview for long production/warehouse notice reasons.');
  }
  if (noticeDialogSource.includes('<p>{{ noticeReason || \'-\' }}</p>')) {
    addFailure('NoticeAcknowledgeDialog.vue must not render full noticeReason directly in the acknowledgement dialog.');
  }
  const noticeDialogResponsiveSnippets = [
    'class="responsive-dialog notice-acknowledge-dialog"',
    'overflow-wrap: anywhere',
    'function formatLongTextPreview',
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
    'warehouseNoticeReasonPreview(notice)',
    'function warehouseNoticeReasonPreview(notice: ProductionNotice)',
    'warehouseNoticeFilters',
    'resetWarehouseNoticeFilters',
    'noticeType: warehouseNoticeFilters.noticeType === \'ALL\' ? undefined : warehouseNoticeFilters.noticeType',
    ':notice-title="activeWarehouseNotice ? warehouseNoticeTitle(activeWarehouseNotice) : \'\'"',
    'warehouseNoticeReasonPreview(activeWarehouseNotice)',
    'warehouseNoticeReasonTitle(activeWarehouseNotice)'
  ];
  for (const snippet of warehouseViewSnippets) {
    if (!warehouseViewSource.includes(snippet)) {
      addFailure(`WarehouseView.vue must keep customerName in warehouse notice title snippet: ${snippet}`);
    }
  }
  if (warehouseViewSource.includes('<p>{{ notice.reason }}</p>')) {
    addFailure('WarehouseView.vue must summarize warehouse notice reasons instead of rendering full text in the notice list.');
  }
  if (warehouseViewSource.includes('<p>{{ activeWarehouseNotice.reason }}</p>')) {
    addFailure('WarehouseView.vue must summarize active warehouse notice reasons instead of rendering full text directly.');
  }

  const apiSource = readFile(apiPath);
  const apiSnippets = [
    'adminProductionNoticesPage(filters: ProductionNoticeFilters = {})',
    '`/production/tasks/notices/admin${toQuery({',
    'target: filters.target',
    "withPage: 'true'"
  ];
  for (const snippet of apiSnippets) {
    if (!apiSource.includes(snippet)) {
      addFailure(`frontend erpApi must keep admin notice API snippet: ${snippet}`);
    }
  }

  const adminNoticesViewSource = readFile(adminNoticesViewPath);
  const adminNoticesViewSnippets = [
    'erpApi.adminProductionNoticesPage',
    'adminNoticePagination',
    'handleAdminNoticePageChange',
    "targetFilter.value === 'ALL' ? undefined : targetFilter.value",
    "statusFilter.value === 'ALL' ? undefined : statusFilter.value",
    "noticeTypeFilter.value === 'ALL' ? undefined : noticeTypeFilter.value",
    'noticeTargetLabel',
    'noticeStatusLabel',
    'noticeTitlePreview(notice)',
    'noticeCustomerPreview(row)',
    'noticePartPreview(row)',
    'noticeReasonPreview(notice)',
    'noticeAcknowledgementPreview(row)',
    'function noticeReasonPreview(notice: ProductionNotice)',
    'function formatLongTextPreview',
    'const adminNoticeServerCounts = reactive',
    'const allNoticeCount = computed(() => adminNoticeServerCounts.ALL)',
    'function adminNoticeBaseFilters()',
    'erpApi.adminProductionNoticesPage({ ...baseFilters, target: \'PRODUCTION\', limit: Number(1), offset: Number(0) })',
    'erpApi.adminProductionNoticesPage({ ...baseFilters, status: \'ACKNOWLEDGED\', limit: Number(1), offset: Number(0) })',
    '管理员通知中心只读拉取历史消息'
  ];
  for (const snippet of adminNoticesViewSnippets) {
    if (!adminNoticesViewSource.includes(snippet)) {
      addFailure(`AdminNoticesView.vue must keep read-only admin notice center snippet: ${snippet}`);
    }
  }
  if (adminNoticesViewSource.includes('<span>{{ notice.reason || \'-\' }}</span>')) {
    addFailure('AdminNoticesView.vue must summarize notice reasons in mobile list rows.');
  }
  if (adminNoticesViewSource.includes('<strong>{{ noticeTitle(notice) }}</strong>')) {
    addFailure('AdminNoticesView.vue must summarize mobile notice card titles instead of rendering full title text.');
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
    'assertDefaultBusinessListsHideFixtures',
    'includeTestFixtures',
    'final process step shortage request must wait for supervisor review',
    "shortageMode: 'REPLENISHMENT_REQUEST'",
    "request?.sourceType === 'PRODUCTION_SCRAP'",
    'shortage completion without handling must be rejected',
    "shortageMode: 'MANAGER_APPROVED'",
    'shortage completion must record shortageQuantity=2',
    'repeat production notice acknowledgement',
    'repeat acknowledgement must not overwrite acknowledgedBy',
    'warehouse acknowledged notice must keep warehouse operator snapshot',
    'repeat warehouse notice acknowledgement',
    'repeat warehouse acknowledgement must not overwrite acknowledgedBy',
    '不能重复确认',
    'Production and warehouse notice API filter verification passed.',
    "const runId = 'STABLE';",
    "const testPrefix = 'COD-NOTICE-STABLE';",
    'prisma.customer.findFirst',
    'prisma.customer.update',
    'prisma.customer.create',
    'prisma.customerContact.updateMany',
    'customerCode: `${customerCode}${archiveSuffix}`',
    'customerName: `${customerName}${archiveSuffix}`',
    "contactName: null",
    "contactPhone: null"
  ];
  for (const snippet of noticeApiScriptSnippets) {
    if (!noticeApiScriptSource.includes(snippet)) {
      addFailure(`verify-production-notices-api.cjs must keep notice API filter regression snippet: ${snippet}`);
    }
  }
  if (
    noticeApiScriptSource.includes('prisma.customer.deleteMany') ||
    noticeApiScriptSource.includes('function localDateTimeStamp') ||
    noticeApiScriptSource.includes('prisma.customer.upsert')
  ) {
    addFailure('verify-production-notices-api.cjs must reuse stable customer master data and soft-disable it after verification.');
  }
  if (!readFile(packagePath).includes('"verify:production-notices-api": "node scripts/verify-production-notices-api.cjs"')) {
    addFailure('package.json must expose verify:production-notices-api for real API notice filter regression checks.');
  }
}

function verifyAdminNoticeTableHeightControls() {
  const viewPath = 'frontend/src/views/AdminNoticesView.vue';
  if (!fileExists(viewPath)) {
    addFailure(`Missing admin notice table height control file: ${viewPath}`);
    return;
  }

  const viewSource = readFile(viewPath);
  const requiredSnippets = [
    "import { Minus, Plus, RefreshLeft } from '@element-plus/icons-vue';",
    'adminNoticeTableHeightLimits',
    'adminNoticeTableDefaultHeight',
    'baisheng.erp.adminNoticeTableHeight.v1',
    '管理员通知表格高度只保存为本机 UI 偏好，不写入通知、订单、生产或仓库业务数据。',
    'adminNoticeTableHeight = ref(adminNoticeTableDefaultHeight)',
    'function adjustAdminNoticeTableHeight',
    'function resetAdminNoticeTableHeight',
    'function restoreAdminNoticeTableHeight',
    'function saveAdminNoticeTableHeight',
    'const savedHeightText = window.localStorage.getItem(adminNoticeTableHeightStorageKey)',
    'if (!savedHeightText)',
    'window.localStorage.setItem(adminNoticeTableHeightStorageKey',
    'aria-label="管理员通知表格高度"',
    'aria-label="降低管理员通知表格高度"',
    'aria-label="提高管理员通知表格高度"',
    'aria-label="恢复管理员通知表格默认高度"',
    ':max-height="adminNoticeTableHeight"',
    'noticeReasonPreview(row)',
    'noticeReasonTitle(row)',
    'noticeTitlePreview(notice)',
    'function noticeTitlePreview(notice: ProductionNotice)',
    'noticeCustomerPreview(row)',
    'noticeCustomerTitle(row)',
    'noticeTaskNoPreview(row)',
    'noticePartPreview(row)',
    'noticeAcknowledgementPreview(row)',
    'noticeAcknowledgementTitle(row)',
    'function noticeReasonPreview(notice: ProductionNotice)',
    'function noticeReasonTitle(notice: ProductionNotice)',
    'function noticeAcknowledgementPreview(notice: ProductionNotice)',
    'restoreAdminNoticeTableHeight();',
    'admin-notice-table-height-actions',
    'admin-notice-table-height-label'
  ];
  for (const snippet of requiredSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`AdminNoticesView.vue must keep adjustable admin notice table height control snippet: ${snippet}`);
    }
  }
  if (/<el-table-column\s+prop="reason"\s+label="[^"]*"\s+min-width="280"\s+show-overflow-tooltip\s*\/>/.test(viewSource)) {
    addFailure('AdminNoticesView.vue must summarize admin notice reasons instead of rendering full reason text through raw overflow tooltip.');
  }
  if (/<el-table-column\s+prop="(?:customerName|productionTaskNo)"\s+label="[^"]*"\s+(?:min-)?width="(?:150|160)"\s+show-overflow-tooltip\s*\/>/.test(viewSource)) {
    addFailure('AdminNoticesView.vue must summarize customer/task text with explicit title text instead of raw show-overflow-tooltip.');
  }
  if (/<el-table-column\s+label="(?:零件|确认信息)"\s+min-width="(?:180|210)"\s+show-overflow-tooltip\s*>/.test(viewSource)) {
    addFailure('AdminNoticesView.vue must summarize part and acknowledgement text with explicit title text instead of raw show-overflow-tooltip.');
  }
  if (viewSource.includes('<span>{{ noticeAcknowledgementText(notice) }}</span>')) {
    addFailure('AdminNoticesView.vue must summarize mobile acknowledgement text instead of rendering full text directly.');
  }
}

function verifyUiPreferenceStorageGuards() {
  const guardedPreferenceSnippets = [
    {
      path: 'frontend/src/views/AdminNoticesView.vue',
      snippets: [
        '本机 UI 偏好读取失败时使用默认高度，不影响管理员历史通知查看。',
        '本机 UI 偏好写入失败不阻断管理员历史通知查询。'
      ]
    },
    {
      path: 'frontend/src/views/CustomersView.vue',
      snippets: ['本机 UI 偏好写入失败不阻断客户资料、多联系人或常用 BOM 查看维护。']
    },
    {
      path: 'frontend/src/views/InventoryView.vue',
      snippets: [
        '本机 UI 偏好读取失败时使用默认高度，不影响库存查询和盘点。',
        '本机 UI 偏好写入失败不阻断库存查看、溯源或盘点。'
      ]
    },
    {
      path: 'frontend/src/views/MaterialTransformsView.vue',
      snippets: ['本机 UI 偏好写入失败不阻断来源加工关系查询、建议维护或库存来源核对。']
    },
    {
      path: 'frontend/src/views/MaterialsManagementView.vue',
      snippets: [
        '本机 UI 偏好读取失败时使用默认高度，不影响零件控制面板查询。',
        '本机 UI 偏好写入失败不阻断零件控制面板筛选、导出或维护。'
      ]
    },
    {
      path: 'frontend/src/views/MaterialsView.vue',
      snippets: ['本机 UI 偏好写入失败不阻断零件基础库、适用范围、图纸版本或导入预览。']
    },
    {
      path: 'frontend/src/views/ModelBomsView.vue',
      snippets: [
        '本机 UI 偏好读取失败时使用默认高度，不影响 BOM 维护。',
        '本机 UI 偏好写入失败不阻断 BOM 查询、复制或明细维护。'
      ]
    },
    {
      path: 'frontend/src/views/OrderDetailView.vue',
      snippets: ['本机 UI 偏好写入失败不阻断订单明细、来源 Excel 预览或提交生产核对。']
    },
    {
      path: 'frontend/src/views/OrdersListView.vue',
      snippets: ['本机 UI 偏好写入失败不阻断订单查询、草稿编辑、Excel 导入或 BOM 带入预览。']
    },
    {
      path: 'frontend/src/views/ProcessSelectionView.vue',
      snippets: [
        '本机 UI 偏好写入失败不阻断生产流程订单列表查看。',
        '本机 UI 偏好写入失败不阻断流程结构查看或提交生产明细核对。'
      ]
    },
    {
      path: 'frontend/src/views/ProductionView.vue',
      snippets: ['本机 UI 偏好写入失败不阻断开始生产、工序确认、完成确认、通知或补单处理。']
    },
    {
      path: 'frontend/src/views/StatisticsView.vue',
      snippets: ['本机 UI 偏好写入失败不阻断只读统计查询。']
    },
    {
      path: 'frontend/src/views/WarehouseView.vue',
      snippets: [
        '本机 UI 偏好读取失败时使用默认高度，不影响仓库业务操作。',
        '本机 UI 偏好写入失败不阻断入库、发货或通知处理。'
      ]
    },
    {
      path: 'frontend/src/components/InventorySourceDetailsDialog.vue',
      snippets: [
        '本机 UI 偏好读取失败时使用默认高度，不影响库存来源核对、替代物料搜索或订单库存预览。',
        '本机 UI 偏好写入失败不阻断库存来源核对、替代物料搜索或订单库存预览。'
      ]
    },
    {
      path: 'frontend/src/components/OrderLineEditor.vue',
      snippets: [
        '本机 UI 偏好读取失败时使用默认高度，不影响订单零件编辑。',
        '本机 UI 偏好写入失败不阻断订单零件编辑、库存来源核对或导入草稿维护。'
      ]
    },
    {
      path: 'frontend/src/components/ProcessDefinitionManager.vue',
      snippets: [
        '本机 UI 偏好读取失败时使用默认高度，不影响标准工序维护。',
        '本机 UI 偏好写入失败不阻断标准工序查询、编辑或停用。'
      ]
    },
    {
      path: 'frontend/src/components/ProcessTemplateManager.vue',
      snippets: [
        '本机 UI 偏好读取失败时使用默认高度，不影响流程记忆维护。',
        '本机 UI 偏好写入失败不阻断流程记忆查询、编辑、复制或停用。'
      ]
    }
  ];

  for (const check of guardedPreferenceSnippets) {
    if (!fileExists(check.path)) {
      addFailure(`Missing UI preference storage guard file: ${check.path}`);
      continue;
    }
    const source = readFile(check.path);
    for (const snippet of check.snippets) {
      if (!source.includes(snippet)) {
        addFailure(`${check.path} must keep localStorage UI preference failure guard: ${snippet}`);
      }
    }
  }

  const frontendFiles = walkFiles(resolveProjectPath('frontend/src'));
  const browserStorageCallPattern = /(?:window\.)?(?:localStorage|sessionStorage)\s*(?:\?\.|\.)\s*(?:getItem|setItem|removeItem|clear)\s*\(/g;
  for (const filePath of frontendFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(browserStorageCallPattern)) {
      const index = match.index ?? 0;
      const before = source.slice(Math.max(0, index - 500), index);
      const after = source.slice(index, Math.min(source.length, index + 1000));
      const lastTryIndex = before.lastIndexOf('try {');
      const lastCatchIndex = before.lastIndexOf('catch');
      const hasOpenTryBefore = lastTryIndex >= 0 && lastTryIndex > lastCatchIndex;
      const hasCatchAfter = /\}\s*catch\s*\{/.test(after);
      if (!hasOpenTryBefore || !hasCatchAfter) {
        addFailure(
          `Frontend browser storage UI preference call must stay guarded by try/catch: ${toProjectPath(filePath)}:${sourceLineForIndex(
            source,
            index
          )}`
        );
      }
    }
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

function verifyFixedFrontendLimitsExposeContinuation() {
  const frontendDir = resolveProjectPath('frontend/src');
  if (!fs.existsSync(frontendDir)) {
    return;
  }

  const limitPatterns = [
    /\b(?:limit|pageSize)\s*:\s*Number\s*\(\s*\d+\s*\)/,
    /\b(?:limit|pageSize)\s*=\s*Number\s*\(\s*\d+\s*\)/,
    /\b\w*Limit\s*=\s*Number\s*\(\s*\d+\s*\)/
  ];
  const continuationPatterns = [
    /\btotalCount\b/,
    /\bhasMore\b/,
    /\btotal\b/,
    /<el-pagination\b/,
    /continue/i,
    /loadMore/i,
    /加载更多/,
    /继续加载/,
    /已显示/
  ];

  for (const filePath of walkFiles(frontendDir)) {
    if (path.extname(filePath) !== '.vue') {
      continue;
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split(/\r?\n/);
    const hasFixedLimit = lines.some((line) => limitPatterns.some((pattern) => pattern.test(line)));
    if (!hasFixedLimit) {
      continue;
    }

    if (continuationPatterns.some((pattern) => pattern.test(source))) {
      continue;
    }

    const firstFixedLimitLine = lines.findIndex((line) => limitPatterns.some((pattern) => pattern.test(line))) + 1;
    addFailure(
      `Fixed frontend search/list limit must expose total count, pagination, hasMore, or load-more UI: ${toProjectPath(
        filePath
      )}:${firstFixedLimitLine}`
    );
  }
}

function verifyStatisticsDisplayContract() {
  const statusTagPath = 'frontend/src/components/StatusTag.vue';
  const frontendApiPath = 'frontend/src/api/erp.ts';
  const statisticsViewPath = 'frontend/src/views/StatisticsView.vue';
  const statisticsServicePath = 'backend/src/modules/statistics/statistics.service.ts';
  const statisticsApiRegressionPath = 'scripts/verify-statistics-api.cjs';
  const businessFixtureVisibilityPath = 'scripts/verify-business-fixture-visibility-api.cjs';

  if (!fileExists(statusTagPath)) {
    addFailure(`Missing StatusTag component: ${statusTagPath}`);
    return;
  }
  if (!fileExists(frontendApiPath)) {
    addFailure(`Missing frontend API file: ${frontendApiPath}`);
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
  if (!fileExists(statisticsApiRegressionPath)) {
    addFailure(`Missing statistics API regression script: ${statisticsApiRegressionPath}`);
    return;
  }
  if (!fileExists(businessFixtureVisibilityPath)) {
    addFailure(`Missing business fixture visibility API regression script: ${businessFixtureVisibilityPath}`);
    return;
  }

  const statusTagSource = readFile(statusTagPath);
  const frontendApiSource = readFile(frontendApiPath);
  const statisticsViewSource = readFile(statisticsViewPath);
  const statisticsServiceSource = readFile(statisticsServicePath);
  const statisticsApiRegressionSource = readFile(statisticsApiRegressionPath);
  const businessFixtureVisibilitySource = readFile(businessFixtureVisibilityPath);

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
    'customerId: customerId.value || undefined',
    'yearOptions',
    'statisticsOptions',
    'loadStatisticsOptions',
    'orderStatisticsOptions',
    '可选年份来自订单、生产、库存流水和报废记录',
    '<el-select v-model="year"',
    'placeholder="选择年份"',
    'title="选择统计年份"',
    '@change="handleYearChange"',
    'v-model="quarter"',
    'placeholder="全部季度"',
    ':disabled="quarterFilterDisabled"',
    ':title="quarterFilterTitle"',
    'v-model="month"',
    'placeholder="全部月份"',
    ':disabled="monthFilterDisabled"',
    ':title="monthFilterTitle"',
    'quarterOptions',
    'monthOptions',
    'const quarterFilterDisabled = computed',
    'const monthFilterDisabled = computed',
    '只有季度统计使用季度筛选',
    '只有月度统计使用月份筛选',
    'title="按当前筛选查询统计"',
    'title="重置统计筛选条件"',
    'title="按当前统计筛选导出 Excel"',
    'title="刷新年份选项和当前统计数据"',
    '@click="refreshStatistics"',
    'function selectedDefaultStatisticsYear()',
    'async function refreshStatistics()',
    'await loadStatisticsOptions();',
    'function handleYearChange()',
    "return activePeriod.value === 'quarter' ? quarter.value || undefined : undefined",
    "return activePeriod.value === 'month' ? month.value || undefined : undefined",
    'normalizeStatisticsFiltersForActivePeriod',
    'alreadyOnQuarterStatisticsTab',
    'alreadyOnMonthStatisticsTab',
    "activePeriod.value = 'quarter';",
    "activePeriod.value = 'month';",
    'quarter: selectedStatisticsQuarter()',
    'month: selectedStatisticsMonth()',
    "const statisticsBusinessTimeZone = 'Asia/Shanghai';",
    "new Intl.DateTimeFormat('en-CA'",
    'timeZone: statisticsBusinessTimeZone',
    'statisticsCutoffNotice',
    'statistics-cutoff-alert',
    "formatTotalQuantity('currentInventoryQuantity')",
    "formatTotalQuantity('currentOrderInventoryQuantity')",
    "formatTotalQuantity('currentStockInventoryQuantity')",
    "formatTotalQuantity('scrapQuantity')",
    'totalRows',
    '{{ periodTitle }}总汇总',
    'aria-label="统计总汇总表格高度"',
    ':max-height="statisticsWorkTableHeights.totals"',
    'OrderStatisticsCustomerRow',
    'customerRows',
    'customerMobileCardKey',
    'aria-label="统计客户汇总表格高度"',
    ':max-height="statisticsWorkTableHeights.customers"',
    'downloadStatisticsExport',
    '统计导出复用当前只读筛选条件',
    'statisticsExportScopeLabel',
    'statistics-filter-summary',
    'statisticsNarrowFilterHint',
    'statisticsFilterSummaryTitle',
    '订单统计表_${periodTitle.value}_${statisticsExportScopeLabel.value}_${formatFileDateTime()}.xlsx',
    '统计 Excel 已导出',
    'row.currentInventoryQuantity',
    'row.currentOrderInventoryQuantity',
    'row.currentStockInventoryQuantity',
    'row.scrapQuantity'
  ];
  for (const snippet of requiredStatisticsViewSnippets) {
    if (!statisticsViewSource.includes(snippet)) {
      addFailure(`StatisticsView.vue must keep first-stage customerId filter contract snippet: ${snippet}`);
    }
  }

  const statisticsApiCalls = [...statisticsViewSource.matchAll(/erpApi\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const allowedStatisticsApiCalls = new Set(['orderStatistics', 'orderStatisticsOptions', 'downloadStatisticsExport']);
  const unexpectedStatisticsApiCalls = statisticsApiCalls.filter((methodName) => !allowedStatisticsApiCalls.has(methodName));
  if (unexpectedStatisticsApiCalls.length > 0) {
    addFailure(
      `StatisticsView.vue must remain read-only and only call statistics query/export APIs; found erpApi.${[
        ...new Set(unexpectedStatisticsApiCalls)
      ].join(', erpApi.')}.`
    );
  }
  if (!statisticsViewSource.includes('统计页为只读页面，筛选只限制展示范围，不提供任何订单、生产、仓库操作。')) {
    addFailure('StatisticsView.vue must keep a first-stage read-only comment for the statistics page.');
  }
  const statisticsFilterApiBlock = frontendApiSource.match(/export interface OrderStatisticsFilters \{[\s\S]*?\n\}/)?.[0] || '';
  const statisticsQueryApiBlock = frontendApiSource.match(/orderStatistics\(filters: OrderStatisticsFilters\) \{[\s\S]*?\n  \},/)?.[0] || '';
  const statisticsExportApiBlock = frontendApiSource.match(/async downloadStatisticsExport\(filters: OrderStatisticsFilters, filename: string\) \{[\s\S]*?\n  \},/)?.[0] || '';
  if (statisticsFilterApiBlock.includes('includeTestFixtures')) {
    addFailure('frontend OrderStatisticsFilters must not expose includeTestFixtures; statistics test fixtures are only available to backend regression scripts.');
  }
  if (statisticsQueryApiBlock.includes('includeTestFixtures') || statisticsExportApiBlock.includes('includeTestFixtures')) {
    addFailure('frontend statistics query/export APIs must not send includeTestFixtures from business pages.');
  }

  const requiredServiceSnippets = [
    "import { businessDateKey } from '../../common/business-date';",
    'async statisticsOptions(query: OrderStatisticsQueryDto = {})',
    'currentBusinessQuarter',
    'currentBusinessMonth',
    'years.add(order.orderDate.getUTCFullYear())',
    'years.add(task.completedAt.getUTCFullYear())',
    'years.add(transaction.transactionTime.getUTCFullYear())',
    'years.add(record.recordDate.getUTCFullYear())',
    'resolveStatisticsPeriodFilters',
    'resolveStatisticsDateWindow',
    'const periodFilters = this.resolveStatisticsPeriodFilters(period, query.quarter, query.month)',
    'resolveStatisticsDateWindow(year, periodFilters.quarter, periodFilters.month)',
    'statisticsDateWindowScopeLabel',
    'normalizeStatisticsQuarter',
    'normalizeStatisticsMonth',
    'businessDateKey()',
    'isFuturePeriod',
    'isCurrentPeriodPartial',
    'statisticsEndDate',
    '未来日期不纳入已发生数据',
    'appendCurrentInventoryStatisticsRows',
    'appendCompletedProductionStatisticsRows',
    'appendShipmentStatisticsRows',
    'appendStockTransferStatisticsRows',
    'appendScrapStatisticsRows',
    'buildOrderStatisticsExport',
    'orderStatisticsTotalExportRows',
    '订单统计表 - 总汇总',
    '订单统计表 - 客户汇总',
    '订单统计表 - 零件汇总',
    '订单统计表 - 订单展示',
    'workbook.xlsx.writeBuffer()',
    'inventorySnapshotLimit: undefined',
    'inventorySnapshotOffset: undefined',
    '统计导出只复用只读统计结果生成真实 .xlsx',
    'InternalCustomerSummaryRow',
    'customerRows: customerSummaryRows',
    'getCustomerStatisticsRow',
    'findOrderCustomerMapForStatistics',
    'inventoryBatchCustomerSnapshot',
    'statisticsCustomerTransactionScope',
    'isStatisticsTestFixtureInventoryTransaction',
    'STATISTICS_STOCK_TRANSFER_SOURCE_RECORD_TYPES',
    'InventoryStatus.AVAILABLE',
    'sourceOrderId: true',
    'currentInventoryQuantity',
    'currentOrderInventoryQuantity',
    'currentStockInventoryQuantity',
    '当前订单库存数量',
    '当前备货库存数量',
    'scrapQuantity',
    '只从 InventoryBatch 实时计算',
    '报废统计只统计有效报废来源',
    'STATISTICS_TEST_FIXTURE_PREFIXES',
    "const includeTestFixtures = query.includeTestFixtures === 'true';",
    'currentInventorySnapshot(customerId, includeTestFixtures)',
    'isStatisticsTestFixtureOrder',
    'isStatisticsTestFixtureInventoryBatch',
    '!this.isStatisticsTestFixtureOrder(order)',
    '!this.hasTestFixturePrefix(record.orderNo, record.partCode, record.partName)',
    'visibleBatches',
    "sourceRecordType: 'InventoryBatch'",
    "sourceRecordType: 'OrderLineStockAllocation'",
    "sourceRecordType: 'ProductionTask'",
    "transactionTime: { gte: start, lt: end }",
    "completedAt: { gte: start, lt: end }",
    "'ProductionTaskOverage'",
    "'ProductionTaskWithdrawStock'",
    "'CustomerChangeStockHandling'",
    "return 'ORDER_SHIPPED_COMPLETED'",
    "return 'ORDER_COMPLETED_UNSHIPPED'",
    "return 'ORDER_IN_PRODUCTION'"
  ];

  for (const snippet of requiredServiceSnippets) {
    if (!statisticsServiceSource.includes(snippet)) {
      addFailure(`StatisticsService must keep first-stage statistics contract snippet: ${snippet}`);
    }
  }
  if (statisticsServiceSource.includes('所有周期均按 CustomerOrder.orderDate 归属')) {
    addFailure('StatisticsService must not group production, shipment and stock-transfer metrics by CustomerOrder.orderDate only.');
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

  const requiredStatisticsApiRegressionSnippets = [
    'STATISTICS_API_BASE_URL',
    '/statistics/options',
    '/statistics/options?includeTestFixtures=true',
    'statistics options must return selectable years',
    'statistics-options-years',
    '/statistics/orders?period=month&year=${currentYear}',
    '&month=${currentBusinessDate.month}',
    '&quarter=${currentBusinessDate.quarter}',
    "eventAttributionFixturePrefix = 'VERIFY-STATS-EVENT'",
    'seedEventAttributionFixture',
    'cleanupEventAttributionFixture',
    'statistics-event-attribution-reusable-fixture',
    'prisma.inventoryTransaction.upsert',
    'prisma.inventoryBatch.upsert',
    'prisma.productionTask.upsert',
    'assertEventAttributionStatistics',
    'includeTestFixtures=true',
    'statistics default month filter must hide event attribution test fixture rows',
    'expectedScopeSnippets',
    '统计导出范围说明缺少筛选条件',
    '统计周期：月度',
    '统计周期：季度',
    '/statistics/orders?period=year&year=${futureYear}',
    '/statistics/orders?period=quarter&year=${completedYear}',
    'statistics-current-year-cutoff',
    'statistics-month-filter',
    'statistics-quarter-filter',
    'statistics-period-filter-normalization',
    'statistics-event-date-attribution',
    'statistics-event-date-customer-filter',
    "statisticsFixturePrefix = 'COD-STATS-STABLE'",
    'seedStatisticsFixture',
    'statistics default response must hide reusable test fixture orders, parts, inventory and customers',
    'statistics default export must hide reusable test fixture orders, parts, inventory and customers',
    'statistics-test-fixture-filter',
    'statistics-export-test-fixture-filter',
    'statistics-current-inventory-and-scrap-fields',
    'statistics-current-inventory-source-split-fields',
    'statistics-current-inventory-snapshot-rows',
    'statistics-inventory-snapshot-pagination',
    'statistics-customer-summary-fields',
    'inventorySnapshotLimit=1&inventorySnapshotOffset=0',
    'statistics-export-full-inventory-snapshot',
    'statistics-total-summary-export',
    'statistics-export-xlsx',
    'statistics-month-export-scope',
    'statistics-quarter-export-scope',
    'statistics-future-year-empty',
    'statistics-future-month-empty',
    'statistics-completed-year-end-date',
    'statistics-completed-quarter-end-date',
    '未来日期不纳入已发生数据',
    '未来期间'
  ];
  for (const snippet of requiredStatisticsApiRegressionSnippets) {
    if (!statisticsApiRegressionSource.includes(snippet)) {
      addFailure(`verify-statistics-api.cjs must keep statistics cutoff API regression snippet: ${snippet}`);
    }
  }
  for (const forbiddenSnippet of [
    'prisma.inventoryTransaction.deleteMany',
    'prisma.inventoryBatch.deleteMany',
    'prisma.productionTask.deleteMany',
    'prisma.customerOrder.deleteMany',
    'prisma.material.deleteMany',
    'prisma.warehouseLocation.deleteMany',
    'prisma.warehouse.deleteMany',
    'prisma.customer.deleteMany'
  ]) {
    if (statisticsApiRegressionSource.includes(forbiddenSnippet)) {
      addFailure(`verify-statistics-api.cjs must reuse stable statistics fixtures instead of physical cleanup: ${forbiddenSnippet}`);
    }
  }

  const requiredBusinessFixtureVisibilitySnippets = [
    'BUSINESS_FIXTURE_VISIBILITY_API_BASE_URL',
    'function currentBusinessDateParts',
    "timeZone: process.env.BUSINESS_TIME_ZONE || 'Asia/Shanghai'",
    'const currentBusinessDate = currentBusinessDateParts();',
    "'/statistics/options'",
    '`/statistics/orders?period=year&year=${currentBusinessDate.year}`',
    '`/statistics/orders?period=quarter&year=${currentBusinessDate.year}&quarter=${currentBusinessDate.quarter}`',
    '`/statistics/orders?period=month&year=${currentBusinessDate.year}&month=${currentBusinessDate.month}`',
    '`/statistics/orders/export?period=year&year=${currentBusinessDate.year}`',
    '`/statistics/orders/export?period=quarter&year=${currentBusinessDate.year}&quarter=${currentBusinessDate.quarter}`',
    '`/statistics/orders/export?period=month&year=${currentBusinessDate.year}&month=${currentBusinessDate.month}`',
    '`/production/tasks/annual-summary?year=${currentBusinessDate.year}`',
    "'/materials/common-project-models'",
    "'/orders/import-sessions?limit=200&offset=0'",
    "'/production/tasks/notices/export'",
    "'/production/tasks/notices/admin/export'",
    "'/production/tasks/replenishment-requests/export'",
    "'/production/tasks/scrap-records/export'",
    "'/inventory/model-bom-scope-approval-requests?status=ALL&limit=200&offset=0'",
    "'/warehouse/notices/export'",
    "'/warehouse/receipts/pending'",
    "'/warehouse/shipments/pending'",
    "'/warehouse/work/export'",
    'fixturePrefixes.find((item) => text.includes(item))',
    'currentBusinessDate,'
  ];
  for (const snippet of requiredBusinessFixtureVisibilitySnippets) {
    if (!businessFixtureVisibilitySource.includes(snippet)) {
      addFailure(`verify-business-fixture-visibility-api.cjs must keep broad first-stage fixture visibility regression snippet: ${snippet}`);
    }
  }
}

function verifyStatisticsTableHeightControls() {
  const viewPath = 'frontend/src/views/StatisticsView.vue';
  if (!fileExists(viewPath)) {
    addFailure(`Missing statistics table height control file: ${viewPath}`);
    return;
  }

  const viewSource = readFile(viewPath);
  const requiredSnippets = [
    "import { Download, Minus, Plus, RefreshLeft } from '@element-plus/icons-vue';",
    "type StatisticsWorkTableKey = 'totals' | 'summary' | 'customers' | 'orders'",
    'statisticsWorkTableHeightLimits',
    'statisticsWorkTableDefaultHeights',
    'baisheng.erp.statisticsWorkTableHeights.v1',
    '统计页表格高度只保存为本机 UI 偏好，不写入订单、生产、仓库或库存业务数据。',
    'statisticsWorkTableHeights = reactive<Record<StatisticsWorkTableKey, number>>',
    ':max-height="statisticsWorkTableHeights.totals"',
    'function adjustStatisticsWorkTableHeight',
    'function resetStatisticsWorkTableHeight',
    'function restoreStatisticsWorkTableHeights',
    'function saveStatisticsWorkTableHeights',
    'window.localStorage.getItem(statisticsWorkTableHeightStorageKey)',
    'window.localStorage.setItem(',
    'statisticsWorkTableHeightStorageKey',
    'statisticsWorkTableHeights.totals = statisticsWorkTableDefaultHeights.totals;',
    'totals: statisticsWorkTableHeights.totals',
    'aria-label="统计汇总表格高度"',
    'aria-label="降低统计汇总表格高度"',
    'aria-label="提高统计汇总表格高度"',
    'aria-label="恢复统计汇总表格默认高度"',
    'aria-label="统计总汇总表格高度"',
    'aria-label="降低统计总汇总表格高度"',
    'aria-label="提高统计总汇总表格高度"',
    'aria-label="恢复统计总汇总表格默认高度"',
    'aria-label="统计客户汇总表格高度"',
    'aria-label="降低统计客户汇总表格高度"',
    'aria-label="提高统计客户汇总表格高度"',
    'aria-label="恢复统计客户汇总表格默认高度"',
    'aria-label="统计订单展示表格高度"',
    'aria-label="降低统计订单展示表格高度"',
    'aria-label="提高统计订单展示表格高度"',
    'aria-label="恢复统计订单展示表格默认高度"',
    ':max-height="statisticsWorkTableHeights.summary"',
    ':max-height="statisticsWorkTableHeights.customers"',
    ':max-height="statisticsWorkTableHeights.orders"',
    'restoreStatisticsWorkTableHeights();',
    'statistics-table-height-actions'
  ];
  for (const snippet of requiredSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`StatisticsView.vue must keep adjustable read-only statistics table height control snippet: ${snippet}`);
    }
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
  if (
    !orderDetailSource.includes('formatOrderDetailLineDrawingText(line)') ||
    !orderDetailSource.includes('function formatOrderDetailLineDrawingText(line: OrderLine)') ||
    !orderDetailSource.includes('<el-table-column prop="drawingDate" label="图纸日期"') ||
    !orderDetailSource.includes('<el-table-column prop="drawingStatus" label="图纸状态"')
  ) {
    addFailure('OrderDetailView.vue must show drawingNo, drawingVersion, drawingDate and drawingStatus in order detail review areas.');
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
  const stockSourceReviewSource = readFile('frontend/src/utils/stockSourceReview.ts');
  const ordersDrawingServiceSource = readFile('backend/src/modules/orders/orders.service.ts');
  if (!productionSource.includes("import { formatDate, formatDateTime, formatQuantity } from '../utils/format';")) {
    addFailure('ProductionView.vue must use shared formatDateTime for production notices, logs, and print timestamps.');
  }
  if (!warehouseSource.includes("import { formatDate, formatDateTime, formatQuantity } from '../utils/format';")) {
    addFailure('WarehouseView.vue must use shared formatDateTime for warehouse notices and confirmation timestamps.');
  }
  if (!/import\s+\{[^}]*formatDateTime[^}]*formatQuantity[^}]*\}\s+from '\.\.\/utils\/format';/.test(modelBomsSource)) {
    addFailure('ModelBomsView.vue must use shared formatDateTime for BOM diff review timestamps.');
  }
  if (materialsSource.includes('label="更新时间"') || materialsSource.includes('formatDateTime(row.updatedAt)')) {
    addFailure('MaterialsView.vue must hide material updatedAt from the main table; current stage does not use material maintenance timestamps as business criteria.');
  }
  if (!inventorySourceDialogSource.includes("import { formatDate, formatDateTime, formatDateTimeInputValue, formatQuantity } from '../utils/format';")) {
    addFailure('InventorySourceDetailsDialog.vue must use shared formatDateTime for manual stock-source confirmation timestamps.');
  }
  const productionServiceSource = readFile('backend/src/modules/production/production.service.ts');
  const productionTypesSource = readFile('frontend/src/types/erp.ts');
  if (
    !productionServiceSource.includes('drawingDate: task.orderLine?.drawingDate ? this.formatDateOnly(task.orderLine.drawingDate) || undefined : undefined') ||
    !productionServiceSource.includes('drawingStatus: task.orderLine?.drawingStatus') ||
    !productionServiceSource.includes('生产端只能展示订单行图纸快照') ||
    !productionTypesSource.includes('drawingDate?: string;') ||
    !productionTypesSource.includes('drawingStatus?: string;') ||
    !productionSource.includes('formatProductionTaskDrawingText(activeTask)') ||
    !productionSource.includes("function formatProductionTaskDrawingText(row: Pick<ProductionTask, 'drawingNo' | 'drawingVersion' | 'drawingDate' | 'drawingStatus'>)") ||
    !productionSource.includes('<label>图纸日期</label>') ||
    !productionSource.includes('<label>图纸状态</label>')
  ) {
    addFailure('Production task API and ProductionView.vue must preserve and display order-line drawingDate and drawingStatus snapshots.');
  }
  if (
    !materialsSource.includes('function formatMaterialDrawingSnapshot(row: {') ||
    !materialsSource.includes('[row.drawingNo, row.drawingVersion, row.drawingDate, row.drawingStatus]') ||
    !materialsSource.includes('formatMaterialDrawingSnapshot(activeDefaultDrawingRevision)') ||
    !materialsSource.includes('name: formatMaterialDrawingSnapshot(row)') ||
    materialsSource.includes("`${row.drawingNo} / ${row.drawingVersion}${row.drawingDate ? ` / ${row.drawingDate}` : ''}`")
  ) {
    addFailure('MaterialsView.vue must display full drawing snapshots with drawingNo, drawingVersion, drawingDate and drawingStatus in material drawing maintenance.');
  }
  const inventoryDrawingServiceSource = readFile('backend/src/modules/inventory/inventory.service.ts');
  const inventoryDrawingOrderLineEditorSource = readFile('frontend/src/components/OrderLineEditor.vue');
  if (
    !inventoryDrawingServiceSource.includes('drawingDate: this.formatDateOnly(sourceLine?.drawingDate)') ||
    !inventoryDrawingServiceSource.includes('drawingStatus: sourceLine?.drawingStatus') ||
    !inventoryDrawingServiceSource.includes('projectModel: sourceLine?.projectModel') ||
    !productionTypesSource.includes('drawingDate?: string;') ||
    !productionTypesSource.includes('drawingStatus?: string;') ||
    !productionTypesSource.includes('projectModel?: string;') ||
    !inventorySourceDialogSource.includes('图纸文件不同') ||
    !inventorySourceDialogSource.includes('图纸文件名不同') ||
    !inventorySourceDialogSource.includes('库存缺图纸文件名') ||
    !inventorySourceDialogSource.includes('库存缺零件类型') ||
    !inventorySourceDialogSource.includes('库存缺项目型号') ||
    !inventorySourceDialogSource.includes("sameText(row.partCategory, target.partCategory) ? '' : '零件类型不同'") ||
    !inventorySourceDialogSource.includes("sameText(row.projectModel, target.projectModel) ? '' : '项目型号不同'") ||
    !inventorySource.includes("[row.drawingNo || '未记录图号', row.drawingVersion, row.drawingDate, row.drawingStatus]") ||
    !inventorySourceDialogSource.includes("function drawingTitle(row: Pick<InventorySourceBatchDetail | InventorySourceExpected, 'drawingNo' | 'drawingVersion' | 'drawingDate' | 'drawingStatus'>)") ||
    !inventorySourceDialogSource.includes('库存缺图纸日期') ||
    !inventorySourceDialogSource.includes('图纸状态不同') ||
    !inventorySourceDialogSource.includes('!row.drawingNo || !row.drawingVersion || !row.drawingDate || !row.drawingStatus || !row.drawingFileName || !row.drawingFileUrl') ||
    !inventorySourceDialogSource.includes("sameText(row.lineType || 'PART', target.lineType || 'PART') ? '' : '行类型不同'") ||
    !inventorySourceDialogSource.includes("sourceStructureKind(row) === sourceStructureKind(target) ? '' : '组件结构不同'") ||
    !inventorySourceDialogSource.includes("sameText(row.partName, target.partName) ? '' : '零件名称不同'") ||
    !inventorySourceDialogSource.includes("sameText(row.unit, target.unit) ? '' : '单位不同'") ||
    !inventoryDrawingOrderLineEditorSource.includes('drawingDate: line.drawingDate') ||
    !inventoryDrawingOrderLineEditorSource.includes('drawingStatus: line.drawingStatus') ||
    !inventoryDrawingOrderLineEditorSource.includes('partCategory: line.partCategory') ||
    !inventoryDrawingOrderLineEditorSource.includes('parentComponentNo: line.parentComponentNo') ||
    !stockSourceReviewSource.includes("requiredTextMatches(line.lineType || 'PART', source.lineType || 'PART')") ||
    !stockSourceReviewSource.includes('stockSourceStructureKind(line) === stockSourceStructureKind(source)') ||
    !stockSourceReviewSource.includes('requiredTextMatches(line.partCategory, source.partCategory)') ||
    !stockSourceReviewSource.includes('requiredTextMatches(line.projectModel, source.projectModel)') ||
    !stockSourceReviewSource.includes('requiredTextMatches(line.partName, source.partName)') ||
    !stockSourceReviewSource.includes('requiredTextMatches(line.unit, source.unit)') ||
    !stockSourceReviewSource.includes('requiredTextMatches(line.drawingDate, source.drawingDate)') ||
    !stockSourceReviewSource.includes('requiredTextMatches(line.drawingStatus, source.drawingStatus)') ||
    !stockSourceReviewSource.includes('requiredTextMatches(line.drawingFileName, source.drawingFileName)') ||
    !stockSourceReviewSource.includes('requiredTextMatches(line.drawingFileUrl, source.drawingFileUrl)') ||
    !stockSourceReviewSource.includes('line.drawingFileName,') ||
    !stockSourceReviewSource.includes('line.drawingFileUrl,') ||
    !stockSourceReviewSource.includes("!String(line.drawingDate || '').trim() ? '图纸日期' : ''") ||
    !stockSourceReviewSource.includes("!String(line.drawingStatus || '').trim() ? '图纸状态' : ''") ||
    !stockSourceReviewSource.includes("!String(line.drawingFileName || '').trim() ? '图纸文件名' : ''") ||
    !stockSourceReviewSource.includes("!String(line.drawingFileUrl || '').trim() ? '图纸文件' : ''") ||
    !stockSourceReviewSource.includes("本次订单资料不完整：${formatStockSourceReviewListPreview(missingOrderInfo, '字段', 5)}") ||
    stockSourceReviewSource.includes('本次订单缺少${missingOrderInfo.join') ||
    !stockSourceReviewSource.includes('normalize(source.drawingDate) &&') ||
    !stockSourceReviewSource.includes('normalize(source.drawingStatus) &&') ||
    !stockSourceReviewSource.includes('normalize(source.drawingFileName) &&') ||
    !stockSourceReviewSource.includes('normalize(source.drawingFileUrl)') ||
    !stockSourceReviewSource.includes("Boolean((line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK') && missingOrderInfo.length > 0)") ||
    !stockSourceReviewSource.includes('export function stockSourceComparableKey(line: StockSourceComparableLine)') ||
    !stockSourceReviewSource.includes('line.partCategory,') ||
    !stockSourceReviewSource.includes('line.componentNo,') ||
    !stockSourceReviewSource.includes('line.parentComponentNo,') ||
    !stockSourceReviewSource.includes('line.projectModel,') ||
    !stockSourceReviewSource.includes('line.partName,') ||
    !stockSourceReviewSource.includes('line.drawingVersion,\n    line.drawingDate,\n    line.drawingStatus,\n    line.drawingFileName,\n    line.drawingFileUrl,') ||
    !ordersDrawingServiceSource.includes('this.normalizeEditableLineType(line.lineType) === this.normalizeEditableLineType(sourceLine.lineType)') ||
    !ordersDrawingServiceSource.includes('this.stockSourceStructureKind(line) === this.stockSourceStructureKind(sourceLine)') ||
    !ordersDrawingServiceSource.includes('private stockSourceStructureKind(row: any)') ||
    !ordersDrawingServiceSource.includes('this.requiredTextMatches(line.partCategory, sourceLine.partCategory)') ||
    !ordersDrawingServiceSource.includes('this.requiredTextMatches(line.projectModel, sourceLine.projectModel)') ||
    !ordersDrawingServiceSource.includes('this.requiredTextMatches(line.partName, sourceLine.partName || batch.partName)') ||
    !ordersDrawingServiceSource.includes('this.requiredTextMatches(line.unit, batch.unit)') ||
    !ordersDrawingServiceSource.includes('this.requiredDateMatches(line.drawingDate, sourceLine.drawingDate)') ||
    !ordersDrawingServiceSource.includes('this.requiredTextMatches(line.drawingStatus, sourceLine.drawingStatus)') ||
    !ordersDrawingServiceSource.includes('this.requiredTextMatches(line.drawingFileName, sourceLine.drawingFileName)') ||
    !ordersDrawingServiceSource.includes('this.requiredTextMatches(line.drawingFileUrl, sourceLine.drawingFileUrl)') ||
    !ordersDrawingServiceSource.includes("!this.formatDateOnly(line.drawingDate) ? '图纸日期' : ''") ||
    !ordersDrawingServiceSource.includes("!String(line.drawingStatus || '').trim() ? '图纸状态' : ''") ||
    !ordersDrawingServiceSource.includes("!String(line.drawingFileName || '').trim() ? '图纸文件名' : ''") ||
    !ordersDrawingServiceSource.includes("!String(line.drawingFileUrl || '').trim() ? '图纸文件' : ''") ||
    !ordersDrawingServiceSource.includes("!this.formatDateOnly(sourceLine.drawingDate) ? '图纸日期' : ''") ||
    !ordersDrawingServiceSource.includes("!String(sourceLine.drawingStatus || '').trim() ? '图纸状态' : ''") ||
    !ordersDrawingServiceSource.includes("!String(sourceLine.drawingFileName || '').trim() ? '图纸文件名' : ''") ||
    !ordersDrawingServiceSource.includes('this.formatDateOnly(sourceLine.drawingDate) &&') ||
    !ordersDrawingServiceSource.includes("String(sourceLine.drawingStatus || '').trim() &&") ||
    !ordersDrawingServiceSource.includes('String(sourceLine.drawingFileName || \'\').trim() &&') ||
    !ordersDrawingServiceSource.includes('private stockSourceManualConfirmationReason(line: any, batch: any, sourceTaskMap: Map<string, any>, usageOrderIssue?: string)') ||
    !ordersDrawingServiceSource.includes('本次订单资料不完整：${this.formatLimitedList(missingOrderInfo, 5)}') ||
    !ordersDrawingServiceSource.includes('库存来源资料不完整：${this.formatLimitedList(missingSourceInfo, 5)}') ||
    !ordersDrawingServiceSource.includes('库存来源与订单不一致：${this.formatLimitedList(mismatchReasons, 5)}') ||
    !ordersDrawingServiceSource.includes('this.stockSourceMissingOrderInfo(line).length > 0 ||\n              !this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap)') ||
    !ordersDrawingServiceSource.includes('private requiredDateMatches(required?: Date | string | null, actual?: Date | string | null)')
  ) {
    addFailure('Inventory pages and stock-source review must preserve and compare drawingDate and drawingStatus snapshots.');
  }
  const warehouseDrawingServiceSource = readFile('backend/src/modules/warehouses/warehouses.service.ts');
  if (
    !warehouseDrawingServiceSource.includes('drawingDate: this.formatDateOnly(task.orderLine?.drawingDate)') ||
    !warehouseDrawingServiceSource.includes('drawingStatus: task.orderLine?.drawingStatus') ||
    !warehouseDrawingServiceSource.includes('drawingDate: this.formatDateOnly(sourceLine?.drawingDate)') ||
    !warehouseDrawingServiceSource.includes('drawingStatus: sourceLine?.drawingStatus') ||
    !warehouseDrawingServiceSource.includes('drawingNo: sourceLine?.drawingNo') ||
    !warehouseDrawingServiceSource.includes('drawingVersion: sourceLine?.drawingVersion') ||
    !warehouseDrawingServiceSource.includes('drawingFileName: sourceLine?.drawingFileName') ||
    !warehouseDrawingServiceSource.includes('drawingFileUrl: sourceLine?.drawingFileUrl') ||
    !warehouseSource.includes("function drawingTitle(row: Pick<WarehouseReceipt | WarehouseShipment | WarehouseTransaction, 'drawingNo' | 'drawingVersion' | 'drawingDate' | 'drawingStatus'>)") ||
    !warehouseSource.includes('label="图纸快照"') ||
    !warehouseSource.includes('drawingTitle(transaction)') ||
    !warehouseSource.includes(':file-name="transaction.drawingFileName || undefined"') ||
    !warehouseSource.includes('drawingDate: source.drawingDate || targetLine.drawingDate') ||
    !warehouseSource.includes('drawingStatus: source.drawingStatus || targetLine.drawingStatus')
  ) {
    addFailure('Warehouse receipt/shipment/transaction APIs and WarehouseView.vue must preserve full drawing snapshots and drawing files.');
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
  const shortageQuantityPreviewSnippets = [
    ['WarehouseView.vue', warehouseSource, 'formatQuantityByUnitPreview(order.pendingProductionReplenishmentQuantityByUnit)'],
    ['WarehouseView.vue', warehouseSource, 'formatQuantityByUnitPreview(order.unresolvedShortageQuantityByUnit)'],
    ['ProductionView.vue', productionSource, 'formatQuantityByUnitPreview(row.pendingProductionReplenishmentQuantityByUnit)'],
    ['ProductionView.vue', productionSource, 'formatQuantityByUnitPreview(row.unresolvedShortageQuantityByUnit)'],
    ['OrdersListView.vue', ordersListSource, 'formatQuantityByUnitPreview(order.pendingProductionReplenishmentQuantityByUnit)'],
    ['OrdersListView.vue', ordersListSource, 'formatQuantityByUnitPreview(order.unresolvedShortageQuantityByUnit)'],
    ['ProcessSelectionView.vue', processSelectionSource, 'formatQuantityByUnitPreview(order.pendingProductionReplenishmentQuantityByUnit)'],
    ['ProcessSelectionView.vue', processSelectionSource, 'formatQuantityByUnitPreview(order.unresolvedShortageQuantityByUnit)']
  ];
  for (const [viewName, viewSource, snippet] of shortageQuantityPreviewSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`${viewName} must summarize shortage quantity-by-unit text: ${snippet}`);
    }
  }
  const shortageQuantityFullJoinSnippets = [
    'pendingProductionReplenishmentQuantityByUnit.map((row) => formatQuantity(row.quantity, row.unit)).join(\'、\')',
    'unresolvedShortageQuantityByUnit.map((row) => formatQuantity(row.quantity, row.unit)).join(\'、\')',
    'pendingProductionReplenishmentQuantityByUnit.map((item) => formatQuantity(item.quantity, item.unit)).join(\'、\')',
    'unresolvedShortageQuantityByUnit.map((item) => formatQuantity(item.quantity, item.unit)).join(\'、\')'
  ];
  for (const [viewName, viewSource] of [
    ['WarehouseView.vue', warehouseSource],
    ['ProductionView.vue', productionSource],
    ['OrdersListView.vue', ordersListSource],
    ['ProcessSelectionView.vue', processSelectionSource]
  ]) {
    for (const snippet of shortageQuantityFullJoinSnippets) {
      if (viewSource.includes(snippet)) {
        addFailure(`${viewName} must not render full shortage quantity-by-unit joins: ${snippet}`);
      }
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
  if (!ordersSource.includes("['涉及零件编码', preview.summary.materialSyncCount, '零件编码示例', this.formatLimitedList(preview.summary.materialSyncPreview || [], 5)]")) {
    addFailure('OrdersService order import issue report must summarize material sync preview codes.');
  }
  if (ordersSource.includes("(preview.summary.materialSyncPreview || []).join('、')")) {
    addFailure('OrdersService order import issue report must not render every material sync preview code in one Excel cell.');
  }
  const orderServiceLimitedListSnippets = [
    "private formatLimitedList(values: string[], limit = 20, delimiter = '、')",
    'this.formatLimitedList(missingProcessNames, 5)',
    'this.formatLimitedList(completedNames, 5)',
    'this.formatLimitedList(invalidValues, 10)',
    'this.formatLimitedList(info.conflictFields, 5)',
    'this.formatLimitedList(missingOrderInfo, 5)',
    'this.formatLimitedList(missingSourceInfo, 5)',
    'this.formatLimitedList(mismatchReasons, 5)',
    "this.formatLimitedList(summaries, 5, '；')"
  ];
  for (const snippet of orderServiceLimitedListSnippets) {
    if (!ordersSource.includes(snippet)) {
      addFailure(`OrdersService must summarize long validation/progress lists: ${snippet}`);
    }
  }
  const orderServiceForbiddenFullJoinSnippets = [
    "missingProcessNames.join('、')",
    "completedNames.join('、')",
    "invalidValues.join('、')",
    "info.conflictFields.join('、')",
    "missingOrderInfo.join('、')",
    "missingSourceInfo.join('、')",
    "mismatchReasons.join('、')",
    "summaries.join('；')"
  ];
  for (const snippet of orderServiceForbiddenFullJoinSnippets) {
    if (ordersSource.includes(snippet)) {
      addFailure(`OrdersService must not render full joined validation/progress lists: ${snippet}`);
    }
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
  if (
    !source.includes('const stockSourceCompatibilityRank: Record<StockSourceCompatibilityStatus, number>') ||
    !source.includes('function stricterStockSourceCompatibilityStatus') ||
    !source.includes('if (!incoming || !current)') ||
    !source.includes('mergeStockSourceCompatibilityReason(source.compatibilityReason, current?.compatibilityReason)') ||
    !source.includes('function stockSourceManualConfirmationSource') ||
    !source.includes('function formatStockSourceReviewListPreview') ||
    !source.includes("formatStockSourceReviewListPreview([...issue.partTexts], '零件', 5)") ||
    !source.includes("formatStockSourceReviewListPreview(missingOrderInfo, '字段', 5)") ||
    !source.includes('manualConfirmedBy: manualConfirmationSource?.manualConfirmedBy?.trim()')
  ) {
    addFailure('stockSourceReview.ts must merge duplicated selectedStockSources by the strictest compatibility status and only preserve matching manual confirmations.');
  }
  if (source.includes("[...issue.partTexts].join('、')") || source.includes("missingOrderInfo.join('、')")) {
    addFailure('stockSourceReview.ts must summarize long stock-source validation lists instead of rendering full joined lists.');
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
    !orderServiceSource.includes('const stockSourceCompatibilityRank: Record<StockSourceCompatibilityStatus, number>') ||
    !orderServiceSource.includes('private stricterStockSourceCompatibilityStatus') ||
    !orderServiceSource.includes('if (!incoming || !current)') ||
    !orderServiceSource.includes('this.mergeStockSourceCompatibilityReason(selection.compatibilityReason, current?.compatibilityReason)') ||
    !orderServiceSource.includes('private stockSourceManualConfirmationSource') ||
    !orderServiceSource.includes('manualConfirmedBy: manualConfirmationSource?.manualConfirmedBy?.trim()')
  ) {
    addFailure('OrdersService.normalizeStockSourceSelections must preserve the strictest duplicated selectedStockSources compatibility status and only preserve matching manual confirmations.');
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
  if (
    source.includes('compatibilityStatus: normalizeCompatibilityStatus(source.compatibilityStatus || current?.compatibilityStatus)') ||
    source.includes('const savedManualReason = source.manualConfirmedBy && source.compatibilityReason ? source.compatibilityReason :') ||
    !source.includes('const selectedSourceCompatibilityRank: Record<CompatibilityStatus, number>') ||
    !source.includes('function stricterSelectedSourceCompatibilityStatus') ||
    !source.includes('function selectedSourceManualConfirmationSource') ||
    !source.includes('compatibilityStatus: nextCompatibilityStatus') ||
    !source.includes('compatibilityReason: nextCompatibilityReason') ||
    !source.includes('const manualConfirmationSource = selectedSourceManualConfirmationSource(previous, undefined, compatibilityStatus, compatibilityReason)') ||
    !source.includes('manualConfirmedBy: manualConfirmationSource?.manualConfirmedBy?.trim()') ||
    !source.includes('sourceNeedsReviewMerge = quantity > 0') ||
    !source.includes('currentNeedsReviewMerge = currentQuantity > 0') ||
    !source.includes('reasonKey: string') ||
    !source.includes('function manualConfirmationReasonKey') ||
    !source.includes('current.reasonKey === manualConfirmationReasonKey(source)') ||
    !source.includes('form.reasonKey = reason.trim()')
  ) {
    addFailure('InventorySourceDetailsDialog.vue must merge duplicated selected sources by strict compatibility status while ignoring zero-quantity placeholders for review state.');
  }
  if (!source.includes("expected.value?.fulfillmentMode === 'STOCK' || expected.value?.fulfillmentMode === 'REWORK'")) {
    addFailure('InventorySourceDetailsDialog.vue must require manual confirmation for missing order drawing info in both STOCK and REWORK modes.');
  }
  if (
    !source.includes('expectedOrderInfoReasons.value.length > 0') ||
    source.includes('orderDrawingInfoComplete') ||
    source.includes('expectedFileMissing.value')
  ) {
    addFailure('InventorySourceDetailsDialog.vue must base missing-order-info manual confirmation on expectedOrderInfoReasons only.');
  }
  if (
    !source.includes('const expectedFileMissingReasons = computed(() => {') ||
    !source.includes("!normalizeValue(row.drawingDate) ? '缺图纸日期' : ''") ||
    !source.includes("!normalizeValue(row.drawingStatus) ? '缺图纸状态' : ''") ||
    !source.includes("!normalizeValue(row.drawingFileName) ? '缺图纸文件名' : ''") ||
    !source.includes("!normalizeValue(row.drawingFileUrl) ? '缺图纸文件' : ''") ||
    !source.includes('const expectedOrderInfoReasons = computed(() => [...expectedMissingInfoReasons.value, ...expectedFileMissingReasons.value]') ||
    !source.includes("formatDialogReasonPreview(expectedOrderInfoReasons, '字段')") ||
    !source.includes("formatDialogReasonPreview(expectedOrderInfoReasons.value, '字段')")
  ) {
    addFailure('InventorySourceDetailsDialog.vue must show specific missing order drawing/file fields in manual confirmation reasons.');
  }
  if (
    source.includes("expectedOrderInfoReasons.join('、')") ||
    source.includes("expectedOrderInfoReasons.value.join('、')") ||
    source.includes("missingReasons.join('、')") ||
    source.includes("mismatchReasons.join('、')") ||
    source.includes("item.identityConflictFields.join('、')")
  ) {
    addFailure('InventorySourceDetailsDialog.vue must summarize missing/mismatch/identity reason lists instead of rendering every field.');
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
    "import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';",
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
  const submitPayloadFields = [
    'lineType: line.lineType',
    'partCategory: line.partCategory',
    'componentNo: line.componentNo',
    'parentComponentNo: line.parentComponentNo',
    'projectModel: line.projectModel',
    'drawingDate: line.drawingDate',
    'drawingStatus: line.drawingStatus'
  ];
  for (const snippet of submitPayloadFields) {
    if (!submitCheckSource.includes(snippet)) {
      addFailure(`submitStockSourceChecks.ts must preserve order-line stock source comparison field: ${snippet}`);
    }
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
    !source.includes('rows.set(batch.id, batch)') ||
    !source.includes('findAvailableStockUsageCandidateBatches(tx, stockBatches, order)') ||
    !source.includes('findAvailableStockUsageCandidateBatches(client, batches, currentOrder)') ||
    !source.includes('const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(') ||
    !source.includes('候选批次也必须按当前草稿优先级计算预占') ||
    !source.includes('reservedByOtherOrders: reservedQuantity') ||
    !source.includes('availableQuantity: Math.max(this.roundQuantity(decimalToNumber(batch.quantity) - reservedQuantity), 0)')
  ) {
    addFailure('OrdersService must include unselected same-part stock batches and calculate their availability by draft priority when checking skipped smaller-batch manual confirmation.');
  }
  if (
    !source.includes('const orderSelectedSources = (order.lines || [])') ||
    !source.includes('const allSelectedSources = selectedRows.map((row) => row.source)') ||
    !source.includes('allSelectedSources: ReturnType<OrdersService[\'jsonToStockSourceSelections\']> = selectedSources') ||
    !source.includes('同一张草稿订单的其它零件行可能已经占用了小批次') ||
    !source.includes('for (const source of allSelectedSources)') ||
    !/currentOrder\?\.id,\s*allSelectedSources/.test(source)
  ) {
    addFailure('OrdersService skipped-smaller-batch validation must subtract stock sources selected by other lines in the same draft order.');
  }
  if (
    !source.includes('private stockSourceManualConfirmationCoversUsageOrderIssue') ||
    !source.includes('compatibilityReason.includes(issue) || manualRemark.includes(issue)') ||
    !source.includes('!this.stockSourceManualConfirmationCoversUsageOrderIssue(selectedSource, usageOrderIssue)') ||
    !source.includes('!this.stockSourceManualConfirmationCoversUsageOrderIssue(source, usageOrderIssue)')
  ) {
    addFailure('OrdersService must reject stale manual confirmations when the recalculated stock source usage-order issue changes.');
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
  const consumeReservationSource = source.slice(source.indexOf('private async consumeActiveInventoryReservations'), source.indexOf('private stockAvailabilitySummary'));
  if (
    consumeReservationSource.indexOf('缺少草稿库存预占记录') < 0 ||
    consumeReservationSource.indexOf('缺少草稿库存预占记录') > consumeReservationSource.indexOf('草稿预占数量异常')
  ) {
    addFailure('OrdersService.consumeActiveInventoryReservations must report missing ACTIVE reservations before reporting quantity mismatch.');
  }
  const submitSource = source.slice(source.indexOf('async submit(orderNo: string, dto: SubmitOrderDto)'), source.indexOf('private async resolveSubmitPlanOperator'));
  if (!submitSource.includes('提交生产必须消费订单保存时形成的 ACTIVE 预占')) {
    addFailure('OrdersService.submit must document that submit consumes saved ACTIVE InventoryReservation rows instead of rebuilding them.');
  }
  if (submitSource.includes('syncOrderInventoryReservations(tx, order.id)')) {
    addFailure('OrdersService.submit must not release and recreate draft InventoryReservation rows before consuming stock.');
  }
  if (
    !source.includes('stockReservationConsumesAvailability') ||
    !source.includes('reservationOrder.createdAt.getTime()') ||
    !source.includes('reservationOrder.orderNo.localeCompare(currentOrder.orderNo) < 0')
  ) {
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
  const sourceDialogPath = 'frontend/src/components/InventorySourceDetailsDialog.vue';
  const inventoryViewPath = 'frontend/src/views/InventoryView.vue';
  const materialDashboardPath = 'frontend/src/views/MaterialsManagementView.vue';
  const materialTransformsPath = 'frontend/src/views/MaterialTransformsView.vue';
  const warehousePath = 'frontend/src/views/WarehouseView.vue';
  for (const projectPath of [
    servicePath,
    dtoPath,
    apiPath,
    editorPath,
    sourceDialogPath,
    inventoryViewPath,
    materialDashboardPath,
    materialTransformsPath,
    warehousePath
  ]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing inventory source priority file: ${projectPath}`);
      return;
    }
  }

  const source = readFile(servicePath);
  const dtoSource = readFile(dtoPath);
  const apiSource = readFile(apiPath);
  const editorSource = readFile(editorPath);
  const sourceDialogSource = readFile(sourceDialogPath);
  const inventoryViewSource = readFile(inventoryViewPath);
  const materialDashboardSource = readFile(materialDashboardPath);
  const materialTransformsSource = readFile(materialTransformsPath);
  const warehouseSource = readFile(warehousePath);
  if (!/class\s+InventorySourceDetailQueryDto[\s\S]*customerId\?:\s*string/.test(dtoSource)) {
    addFailure('InventorySourceDetailQueryDto must accept customerId for stock source context.');
  }
  if (
    !/class\s+InventorySourceDetailQueryDto[\s\S]*includeTestFixtures\?:\s*string/.test(dtoSource) ||
    !/interface\s+InventorySourceDetailFilters[\s\S]*includeTestFixtures\?:\s*boolean/.test(apiSource) ||
    !apiSource.includes("includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined") ||
    !source.includes("const includeTestFixtures = query.includeTestFixtures === 'true'") ||
    !source.includes('const visibleBatches = includeTestFixtures ? batches : batches.filter((batch) => !this.isTestFixtureInventoryBatch(batch))') ||
    !source.includes('const visibleMaterial = includeTestFixtures || !material || !this.isTestFixtureMaterial(material) ? material : null')
  ) {
    addFailure('Inventory source-details must hide reusable test fixture batches by default and only expose them through explicit includeTestFixtures opt-in.');
  }
  if (!/interface\s+InventorySourceDetailFilters[\s\S]*customerId\?:\s*string/.test(apiSource) || !apiSource.includes('customerId: filters.customerId')) {
    addFailure('erpApi.inventoryMaterialSourceDetails must send customerId to source-details.');
  }
  if (
    !/class\s+InventorySourceDetailQueryDto[\s\S]*limit\?:\s*number[\s\S]*offset\?:\s*number[\s\S]*withPage\?:\s*string/.test(dtoSource) ||
    !/interface\s+InventorySourceDetailFilters[\s\S]*limit\?:\s*number[\s\S]*offset\?:\s*number[\s\S]*withPage\?:\s*boolean/.test(apiSource) ||
    !apiSource.includes("withPage: filters.withPage ? 'true' : undefined") ||
    !source.includes('totalSourceCount') ||
    !source.includes('sourceHasMore')
  ) {
    addFailure('Inventory source-details must keep explicit pagination metadata without changing the legacy unpaged response.');
  }
  if (
    !sourceDialogSource.includes('sourcePageChange') ||
    !sourceDialogSource.includes('sourcePaginationVisible') ||
    !sourceDialogSource.includes('<el-pagination') ||
    !sourceDialogSource.includes('mobileSourceBatchStateKey') ||
    !sourceDialogSource.includes('expandedMobileSourceBatchKeys.value = []')
  ) {
    addFailure('InventorySourceDetailsDialog.vue must expose visible source pagination controls and reset stale mobile expanded source rows for paged read-only source-details.');
  }
  for (const [file, viewSource] of [
    [inventoryViewPath, inventoryViewSource],
    [materialDashboardPath, materialDashboardSource],
    [materialTransformsPath, materialTransformsSource]
  ]) {
    if (!viewSource.includes('@source-page-change="handleSourceDetailsPageChange"') || !viewSource.includes('withPage: true')) {
      addFailure(`${file} read-only inventory source detail views must request paged source-details and expose pagination.`);
    }
  }
  if (editorSource.includes('withPage: true') || warehouseSource.includes('withPage: true')) {
    addFailure('Order and warehouse stock-source review flows must keep loading full source-details instead of paginating selectable batches.');
  }
  if (!editorSource.includes('customerId: props.customerId')) {
    addFailure('OrderLineEditor.vue must pass current customerId into inventory source-details.');
    return;
  }
  if (
    !source.includes('resolveStockReservationPriorityOrder') ||
    !source.includes('stockReservationConsumesAvailability') ||
    !source.includes('reservationOrder.orderNo.localeCompare(currentOrder.orderNo) < 0')
  ) {
    addFailure('InventoryService must calculate stock source available quantity by current draft order priority.');
  }
  const priorityResolverSource = source.slice(source.indexOf('private async resolveStockReservationPriorityOrder'), source.indexOf('private stockReservationConsumesAvailability'));
  if (
    !priorityResolverSource.includes('const excludeOrderId = query.excludeOrderId?.trim()') ||
    !priorityResolverSource.includes('const excludeOrderNo = query.excludeOrderNo?.trim()') ||
    priorityResolverSource.indexOf('const excludeOrderId = query.excludeOrderId?.trim()') > priorityResolverSource.indexOf('const excludeOrderNo = query.excludeOrderNo?.trim()')
  ) {
    addFailure('InventoryService.resolveStockReservationPriorityOrder must prefer excludeOrderId before excludeOrderNo when both are supplied.');
  }
  if (
    !/const\s+currentOrder\s*=\s*await\s+this\.prisma\.customerOrder\.findUnique[\s\S]*if\s*\(\s*currentOrder\s*\)\s*{[\s\S]*return\s+currentOrder;[\s\S]*const\s+excludeOrderNo\s*=\s*query\.excludeOrderNo\?\.trim\(\)/.test(priorityResolverSource)
  ) {
    addFailure('InventoryService.resolveStockReservationPriorityOrder must fall back to excludeOrderNo when excludeOrderId is stale.');
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
  const materialSuggestionsSource = source.slice(source.indexOf('async materialSuggestions'), source.indexOf('private async findMaterialSuggestionHistory'));
  if (
    !materialSuggestionsSource.includes('activeReservationQuantityByBatchId') ||
    !materialSuggestionsSource.includes('query') ||
    !materialSuggestionsSource.includes('reservedQuantityByBatchId.get(batch.id)')
  ) {
    addFailure('InventoryService materialSuggestions must calculate availableQuantity by current draft order priority.');
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
  const inventoryAdjustmentApiScriptPath = 'scripts/verify-inventory-adjustment-api.cjs';
  const packagePath = 'package.json';

  for (const projectPath of [
    controllerPath,
    servicePath,
    dtoPath,
    apiPath,
    viewPath,
    verifierPath,
    seedPath,
    inventoryAdjustmentApiScriptPath,
    packagePath
  ]) {
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

  const inventoryAdjustmentApiScriptSource = readFile(inventoryAdjustmentApiScriptPath);
  const packageSource = readFile(packagePath);
  const apiRegressionSnippets = [
    'submitAdjustment',
    'expectRequestFailure',
    'expectAdjustmentFailure',
    'expectForgedAttachmentFailure',
    'seedActiveReservation',
    '`Inventory Adjustment Reservation Customer ${runId}`',
    'assertAdjustmentTransaction',
    '盘点到 0 时批次必须转 USED',
    '0 数量批次重新盘点为正数时必须恢复 AVAILABLE',
    '盘点后数量不能低于已预占数量',
    '盘点后数量不能小于已预占数量',
    '伪造库存盘点附件必须被拦截',
    '库存盘点附件必须通过系统上传接口上传',
    '库存盘点附件文件不存在',
    '报废或销毁清零后数量必须为 0',
    '报废盘点必须清零并转 SCRAPPED',
    "usedBatch?.status === 'USED'",
    "restoredBatch?.status === 'AVAILABLE'",
    "scrappedBatch?.status === 'SCRAPPED'",
    "reservedBatchAfterFailure?.status === 'AVAILABLE'",
    "activeReservation?.status === 'ACTIVE'",
    'failed reserved adjustment must not create InventoryAdjustment',
    "forgedAttachmentBatchAfterFailure?.status === 'AVAILABLE'",
    'forged attachment adjustment must not create InventoryAdjustment',
    "await assertAdjustmentTransaction(zeroAdjustment, 'OUT', 5)",
    "await assertAdjustmentTransaction(restoreAdjustment, 'IN', 3)",
    "await assertAdjustmentTransaction(scrapAdjustment, 'OUT', 7)",
    'adjustment history should keep 2 records',
    'scrap adjustment history should keep 1 record',
    "const runId = 'STABLE';",
    "const testPrefix = 'COD-INV-ADJ-STABLE';",
    'prisma.customer.findFirst',
    'prisma.customer.update',
    'prisma.customer.create',
    'prisma.customerContact.updateMany',
    'async function upsertRegressionWarehouse(warehouseCode, warehouseName)',
    'async function upsertRegressionWarehouseLocation(warehouseId, locationCode, locationName)',
    'prisma.warehouse.upsert',
    'prisma.warehouseLocation.findFirst',
    'prisma.warehouseLocation.update',
    'prisma.warehouseLocation.create',
    'prisma.warehouseLocation.updateMany',
    'prisma.warehouse.updateMany',
    'customerCode: `${testPrefix}-CUST${archiveSuffix}`',
    'customerName: `Inventory Adjustment Reservation Customer ${runId}${archiveSuffix}`',
    "contactName: null",
    "contactPhone: null",
    'Inventory adjustment API verification passed.'
  ];
  for (const snippet of apiRegressionSnippets) {
    if (!inventoryAdjustmentApiScriptSource.includes(snippet)) {
      addFailure(`verify-inventory-adjustment-api.cjs must keep inventory adjustment API regression snippet: ${snippet}`);
    }
  }
  if (
    inventoryAdjustmentApiScriptSource.includes('prisma.customer.deleteMany') ||
    inventoryAdjustmentApiScriptSource.includes('prisma.warehouse.deleteMany') ||
    inventoryAdjustmentApiScriptSource.includes('prisma.warehouseLocation.deleteMany') ||
    inventoryAdjustmentApiScriptSource.includes('function localDateTimeStamp')
  ) {
    addFailure('verify-inventory-adjustment-api.cjs must reuse stable customer master data and soft-disable it after verification.');
  }
  if (!packageSource.includes('"verify:inventory-adjustment-api": "node scripts/verify-inventory-adjustment-api.cjs"')) {
    addFailure('package.json must expose verify:inventory-adjustment-api for inventory adjustment status regression testing.');
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
    !source.includes('material.findMany') ||
    !source.includes('modelBomLine.findMany') ||
    !source.includes('materialTransformRule.findMany')
  ) {
    addFailure('ProcessDefinitionsService must check order process, process template, material default process, BOM, and transform-rule references before disabling or renaming a process definition.');
  }
  if (!source.includes('processSnapshotToDetails') || !source.includes("action: '停用' | '改名'") || !source.includes('不能${action}')) {
    addFailure('ProcessDefinitionsService must parse process template steps and reject disabling or renaming referenced process definitions with a clear message.');
  }
  const processReferenceSnippets = [
    'splitDefaultProcessRoute',
    '.split(/(?:->|→|[、,，;；\\n\\r]+)/)',
    '零件默认工艺 ${material.partCode} / ${material.partName}',
    '来源加工关系 ${rule.sourceMaterial.partCode} -> ${rule.targetMaterial.partCode}',
    '订单流程、流程记忆、零件默认工艺、BOM 或来源加工关系'
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
    addFailure('ProcessDefinitionsService.restore must explicitly restore disabled process definitions without mutating historical orders, material default process, BOM, or transform rules.');
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
    'prisma.material.findMany',
    'prisma.modelBomLine.findMany',
    'prisma.materialTransformRule.findMany',
    'splitDefaultProcessRoute',
    '零件默认工艺 ${material.partCode} / ${material.partName}',
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
    'MATERIAL_DEFAULT_PROCESS_DUPLICATE',
    'MATERIAL_DEFAULT_PROCESS_DEFINITION_MISSING',
    'MATERIAL_TRANSFORM_DEFAULT_PROCESS_DUPLICATE',
    'MATERIAL_TRANSFORM_DEFAULT_PROCESS_DEFINITION_MISSING',
    'PRODUCTION_TASK_PROCESS_STEP_DUPLICATE',
    'PRODUCTION_TASK_PROCESS_DEFINITION_MISSING',
    'prisma.modelBomLine.findMany',
    'prisma.material.findMany',
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
    !source.includes('BOM 同名范围重复')
  ) {
    addFailure('repair-first-stage.ts must report and block duplicate ModelBom name/customer/project scopes before migration or write mode.');
  }
  if (
    !source.includes('collectModelBomScopeApprovalBlocks') ||
    !source.includes('printModelBomScopeApprovalBlocks') ||
    !source.includes('ModelBomScopeApprovalBlock') ||
    !source.includes('BOM 范围审批重复')
  ) {
    addFailure('repair-first-stage.ts must report and block duplicate open ModelBom scope approval requests before migration or write mode.');
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
    /assertNoBlockedRepairs\s*\(\s*stockSourceReviewStatusRepairs\s*,\s*draftReservationSyncRepairs\s*,\s*consumedReservationRepairs\s*,\s*stockAllocationRepairs\s*,\s*componentStructureBlocks\s*,\s*modelBomScopeBlocks\s*,\s*modelBomScopeApprovalBlocks\s*\)/;
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
    '非取消订单 quantity 必须大于 0',
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
    '"quantity" >= 0',
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
    'BOM 同名范围重复',
    'BOM 范围审批重复',
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
  const materialImportApiRegressionScriptPath = 'scripts/verify-material-import-api.cjs';
  const inventoryAdjustmentApiRegressionScriptPath = 'scripts/verify-inventory-adjustment-api.cjs';
  const inventoryExportApiRegressionScriptPath = 'scripts/verify-inventory-export-api.cjs';
  const materialDrawingRevisionsExportApiRegressionScriptPath = 'scripts/verify-material-drawing-revisions-export-api.cjs';
  const materialApplicabilitiesExportApiRegressionScriptPath = 'scripts/verify-material-applicabilities-export-api.cjs';
  const materialDashboardExportApiRegressionScriptPath = 'scripts/verify-material-dashboard-export-api.cjs';
  const statisticsManagementApiRegressionScriptPath = 'scripts/verify-statistics-management-api.cjs';
  const businessDataBaselineApiRegressionScriptPath = 'scripts/verify-business-data-baseline-api.cjs';
  const businessFixtureVisibilityApiRegressionScriptPath = 'scripts/verify-business-fixture-visibility-api.cjs';
  const productionNoticesApiRegressionScriptPath = 'scripts/verify-production-notices-api.cjs';
  const productionManagementApiRegressionScriptPath = 'scripts/verify-production-management-api.cjs';
  const productionExportApiRegressionScriptPath = 'scripts/verify-production-export-api.cjs';
  const warehouseConfigApiRegressionScriptPath = 'scripts/verify-warehouse-config-api.cjs';
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
    materialImportApiRegressionScriptPath,
    inventoryAdjustmentApiRegressionScriptPath,
    inventoryExportApiRegressionScriptPath,
    materialDrawingRevisionsExportApiRegressionScriptPath,
    materialApplicabilitiesExportApiRegressionScriptPath,
    materialDashboardExportApiRegressionScriptPath,
    statisticsManagementApiRegressionScriptPath,
    businessDataBaselineApiRegressionScriptPath,
    businessFixtureVisibilityApiRegressionScriptPath,
    productionNoticesApiRegressionScriptPath,
    productionManagementApiRegressionScriptPath,
    productionExportApiRegressionScriptPath,
    warehouseConfigApiRegressionScriptPath,
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
  const packageJson = JSON.parse(packageSource);
  const packageScripts = packageJson.scripts || {};
  const regressionScriptSource = readFile(regressionScriptPath);
  const materialImportApiRegressionScriptSource = readFile(materialImportApiRegressionScriptPath);
  const inventoryAdjustmentApiRegressionScriptSource = readFile(inventoryAdjustmentApiRegressionScriptPath);
  const inventoryExportApiRegressionScriptSource = readFile(inventoryExportApiRegressionScriptPath);
  const materialDrawingRevisionsExportApiRegressionScriptSource = readFile(materialDrawingRevisionsExportApiRegressionScriptPath);
  const materialApplicabilitiesExportApiRegressionScriptSource = readFile(materialApplicabilitiesExportApiRegressionScriptPath);
  const materialDashboardExportApiRegressionScriptSource = readFile(materialDashboardExportApiRegressionScriptPath);
  const statisticsManagementApiRegressionScriptSource = readFile(statisticsManagementApiRegressionScriptPath);
  const businessDataBaselineApiRegressionScriptSource = readFile(businessDataBaselineApiRegressionScriptPath);
  const businessFixtureVisibilityApiRegressionScriptSource = readFile(businessFixtureVisibilityApiRegressionScriptPath);
  const productionNoticesApiRegressionScriptSource = readFile(productionNoticesApiRegressionScriptPath);
  const productionManagementApiRegressionScriptSource = readFile(productionManagementApiRegressionScriptPath);
  const productionExportApiRegressionScriptSource = readFile(productionExportApiRegressionScriptPath);
  const warehouseConfigApiRegressionScriptSource = readFile(warehouseConfigApiRegressionScriptPath);
  const uploadFileNameRegressionScriptSource = readFile(uploadFileNameRegressionScriptPath);
  const fileNameNormalizerRegressionScriptSource = readFile(fileNameNormalizerRegressionScriptPath);
  const workbookRegressionScriptSource = readFile(workbookRegressionScriptPath);
  const apiAggregateRegressionScriptSource = readFile(apiAggregateRegressionScriptPath);
  const migrationSqlSource = readMigrationSqlSource();

  const serviceSnippets = [
    'readOrderImportTemplateWorkbookFile',
    '组件零件清单ERP上传模板.xlsx',
    "['outputs', 'component-order-template', this.orderImportTemplateFileName]",
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
    "drawingVersion: this.importColumn(header.columns, '版本', '图纸版本', '图纸版本号')",
    'drawingVersion: this.cellText(row, columns.drawingVersion)',
    'drawingVersion: row.drawingVersion || null',
    'drawingVersion: row.drawingVersion || undefined',
    '导入提交必须携带 previewToken',
    '导入预览已变化，请刷新预览后重新提交',
    'submitValidationLines',
    'this.validateOrderLineComponentStructure(submitValidationLines)',
    'buildOrderImportIssueReport',
    "issueSheet.autoFilter = { from: 'A1', to: 'R1' }",
    'row.drawingVersion,',
    'row.drawingDate,',
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
    'parentComponentNo',
    'drawingVersion    String?'
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
    'OrderImportRow_optional_text_not_blank',
    '"drawingVersion" IS NULL OR BTRIM("drawingVersion") <>',
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
    '[line.drawingNo, line.drawingVersion, line.drawingDate, line.drawingStatus]',
    'function formatModelBomApplyMissingThicknessLine(line: CreateOrderLinePayload)',
    'orderImportSourceFilePreview',
    'orderImportFilePreview',
    'OrderImportFilePreview',
    'prop="drawingVersion" label="版本"',
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
  if (
    !/function formatModelBomApplyMissingThicknessLine\(line: CreateOrderLinePayload\)[\s\S]*\[line\.drawingNo, line\.drawingVersion, line\.drawingDate, line\.drawingStatus\]/.test(
      ordersViewSource
    )
  ) {
    addFailure('OrdersListView.vue BOM missing-thickness review text must include drawingNo, drawingVersion, drawingDate and drawingStatus.');
  }
  const orderImportDrawingDateColumnCount = (ordersViewSource.match(/prop="drawingDate"\s+label="图纸日期"/g) || []).length;
  const orderImportDrawingStatusColumnCount = (ordersViewSource.match(/prop="drawingStatus"\s+label="图纸状态"/g) || []).length;
  if (orderImportDrawingDateColumnCount < 3 || orderImportDrawingStatusColumnCount < 3) {
    addFailure('OrdersListView.vue order import, source preview and BOM draft preview tables must show drawingDate and drawingStatus columns.');
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
  if (!packageSource.includes('"verify:inventory-adjustment-api": "node scripts/verify-inventory-adjustment-api.cjs"')) {
    addFailure('package.json must expose verify:inventory-adjustment-api for inventory adjustment status regression testing.');
  }
  if (!packageSource.includes('"verify:customer-management-api": "node scripts/verify-customer-management-api.cjs"')) {
    addFailure('package.json must expose verify:customer-management-api for customer page data visibility regression testing.');
  }
  if (!packageSource.includes('"verify:customer-contact-management-api": "node scripts/verify-customer-contact-management-api.cjs"')) {
    addFailure('package.json must expose verify:customer-contact-management-api for customer contact management regression testing.');
  }
  if (!packageSource.includes('"verify:order-management-api": "node scripts/verify-order-management-api.cjs"')) {
    addFailure('package.json must expose verify:order-management-api for order page data visibility regression testing.');
  }
  if (!packageSource.includes('"verify:inventory-management-api": "node scripts/verify-inventory-management-api.cjs"')) {
    addFailure('package.json must expose verify:inventory-management-api for inventory page data visibility regression testing.');
  }
  if (!packageSource.includes('"verify:material-management-api": "node scripts/verify-material-management-api.cjs"')) {
    addFailure('package.json must expose verify:material-management-api for material dashboard data visibility regression testing.');
  }
  if (!packageSource.includes('"verify:model-bom-management-api": "node scripts/verify-model-bom-management-api.cjs"')) {
    addFailure('package.json must expose verify:model-bom-management-api for model BOM management data visibility regression testing.');
  }
  if (!packageSource.includes('"verify:material-transform-management-api": "node scripts/verify-material-transform-management-api.cjs"')) {
    addFailure('package.json must expose verify:material-transform-management-api for material transform management data visibility regression testing.');
  }
  if (!packageSource.includes('"verify:production-export-api": "node scripts/verify-production-export-api.cjs"')) {
    addFailure('package.json must expose verify:production-export-api for production Excel export regression testing.');
  }
  if (!packageSource.includes('"verify:production-management-api": "node scripts/verify-production-management-api.cjs"')) {
    addFailure('package.json must expose verify:production-management-api for production management data visibility regression testing.');
  }
  if (!packageSource.includes('"verify:process-management-api": "node scripts/verify-process-management-api.cjs"')) {
    addFailure('package.json must expose verify:process-management-api for process page data visibility regression testing.');
  }
  if (!packageSource.includes('"verify:statistics-management-api": "node scripts/verify-statistics-management-api.cjs"')) {
    addFailure('package.json must expose verify:statistics-management-api for statistics filter data visibility regression testing.');
  }
  if (!packageSource.includes('"verify:business-data-baseline-api": "node scripts/verify-business-data-baseline-api.cjs"')) {
    addFailure('package.json must expose verify:business-data-baseline-api for first-stage business data baseline regression testing.');
  }
  if (!packageSource.includes('"verify:business-fixture-visibility-api": "node scripts/verify-business-fixture-visibility-api.cjs"')) {
    addFailure('package.json must expose verify:business-fixture-visibility-api for first-stage fixture visibility regression testing.');
  }
  if (
    !packageSource.includes(
      '"verify:local-runtime": "npm run verify:docker-runtime && npm run verify:frontend-smoke && npm run verify:business-data-baseline-api && npm run verify:business-fixture-visibility-api"'
    )
  ) {
    addFailure('verify:local-runtime must include Docker runtime, frontend smoke, business baseline and fixture visibility regressions.');
  }
  if (!packageSource.includes('"verify:warehouse-config-api": "node scripts/verify-warehouse-config-api.cjs"')) {
    addFailure('package.json must expose verify:warehouse-config-api for warehouse delete/disable regression testing.');
  }
  if (!packageSource.includes('"verify:upload-filenames-api": "node scripts/verify-upload-filenames-api.cjs"')) {
    addFailure('package.json must expose verify:upload-filenames-api for upload filename regression testing.');
  }
  if (!packageSource.includes('"verify:file-name-normalizers": "node scripts/verify-file-name-normalizers.cjs"')) {
    addFailure('package.json must expose verify:file-name-normalizers for frontend/backend filename normalizer regression testing.');
  }
  if (!packageSource.includes('"verify:excel-export-format": "node scripts/verify-excel-export-format.cjs"')) {
    addFailure('package.json must expose verify:excel-export-format for real .xlsx export regression testing.');
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
  if (!packageSource.includes('"verify:first-stage:api:after-build": "node scripts/verify-first-stage-api.cjs --skip-build"')) {
    addFailure('package.json must expose verify:first-stage:api:after-build to reuse the backend build in total verification.');
  }
  if (
    !packageSource.includes(
      'npm run verify:file-name-normalizers && npm run verify:excel-export-format && npm run verify:order-import-workbooks && npm run backend:db:generate && npm run verify:prisma-client-enums && npm run verify:test-data-cleanup && npm run backend:verify:first-stage && npm run backend:build && npm run verify:first-stage:api:after-build && npm run frontend:build'
    )
  ) {
    addFailure('verify:first-stage must regenerate Prisma Client, check generated Prisma Client enums, workbook artifacts, self-contained API regressions and backend/frontend builds.');
  }
  if (!packageSource.includes('npm run backend:build && npm run verify:first-stage:api:after-build && npm run frontend:build')) {
    addFailure('verify:first-stage:strict must include self-contained API regressions after backend build and before frontend build.');
  }

  const apiAggregateRegressionSnippets = [
    "const { createServer } = require('node:net');",
    "const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');",
    "const skipBackendBuild = process.argv.includes('--skip-build') || process.env.FIRST_STAGE_API_SKIP_BUILD === '1';",
    'FIRST_STAGE_API_SCRIPT_TIMEOUT_MS',
    'defaultCommandTimeoutMs',
    'timed out after',
    'function stopProcessTree',
    "const backendBuildEntry = resolve(rootDir, 'backend/dist/main.js');",
    "const backendBuildStamp = resolve(rootDir, 'backend/dist/tsconfig.tsbuildinfo');",
    'const backendBuildInputPaths = [',
    'FIRST_STAGE_API_BASE_URL',
    'FIRST_STAGE_API_SKIP_BUILD',
    'FIRST_STAGE_API_PORT',
    'const explicitApiBaseUrl = process.env.FIRST_STAGE_API_BASE_URL || process.env.ORDER_IMPORT_API_BASE_URL ||',
    'async function findAvailablePort',
    'const selectedPort = await findAvailablePort(apiPort)',
    'Building backend and starting a temporary API server on port',
    'Starting a temporary API server on port',
    'using the existing backend build',
    'Explicit API health check failed',
    'verify:customer-management-api',
    'verify:customer-contact-management-api',
    'verify:customers-export-api',
    'verify:order-management-api',
    'verify:orders-export-api',
    'verify:material-import-api',
    'verify:inventory-adjustment-api',
    'verify:inventory-summary-api',
    'verify:inventory-management-api',
    'verify:inventory-export-api',
    'verify:inventory-materials-export-api',
    'verify:material-suggestions-api',
    'verify:material-management-api',
    'verify:material-drawing-management-api',
    'verify:material-drawing-revisions-export-api',
    'verify:material-applicabilities-export-api',
    'verify:material-dashboard-export-api',
    'verify:model-bom-management-api',
    'verify:model-boms-export-api',
    'verify:model-bom-scope-approval-api',
    'verify:model-bom-diff-reviews-export-api',
    'verify:material-transform-management-api',
    'verify:material-transform-rules-export-api',
    'verify:statistics-api',
    'verify:statistics-management-api',
    'verify:business-data-baseline-api',
    'verify:business-fixture-visibility-api',
    'verify:order-import-api',
    'verify:notice-center-api',
    'verify:production-notices-api',
    'verify:production-notices-export-api',
    'verify:production-exception-management-api',
    'verify:production-replenishment-requests-export-api',
    'verify:production-scrap-records-export-api',
    'verify:production-management-api',
    'verify:production-export-api',
    'verify:process-management-api',
    'verify:process-exports-api',
    'verify:warehouse-config-api',
    'verify:warehouse-management-api',
    'verify:warehouse-work-management-api',
    'verify:warehouse-work-export-api',
    'verify:warehouse-notices-export-api',
    'verify:warehouse-transactions-export-api',
    'verify:upload-filenames-api',
    "FIRST_STAGE_API_BASE_URL: apiBaseUrl",
    "CUSTOMER_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "CUSTOMER_CONTACT_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "CUSTOMERS_EXPORT_API_BASE_URL: apiBaseUrl",
    "ORDER_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "ORDERS_EXPORT_API_BASE_URL: apiBaseUrl",
    "ORDER_IMPORT_API_BASE_URL: apiBaseUrl",
    "MATERIAL_IMPORT_API_BASE_URL: apiBaseUrl",
    "INVENTORY_ADJUSTMENT_API_BASE_URL: apiBaseUrl",
    "INVENTORY_SUMMARY_API_BASE_URL: apiBaseUrl",
    "INVENTORY_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "INVENTORY_EXPORT_API_BASE_URL: apiBaseUrl",
    "INVENTORY_MATERIALS_EXPORT_API_BASE_URL: apiBaseUrl",
    "MATERIAL_SUGGESTIONS_API_BASE_URL: apiBaseUrl",
    "MATERIAL_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "MATERIAL_DRAWING_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "MATERIAL_DRAWING_REVISIONS_EXPORT_API_BASE_URL: apiBaseUrl",
    "MATERIAL_APPLICABILITIES_EXPORT_API_BASE_URL: apiBaseUrl",
    "MATERIAL_DASHBOARD_EXPORT_API_BASE_URL: apiBaseUrl",
    "MODEL_BOM_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "MODEL_BOMS_EXPORT_API_BASE_URL: apiBaseUrl",
    "MODEL_BOM_SCOPE_APPROVAL_API_BASE_URL: apiBaseUrl",
    "MODEL_BOM_DIFF_REVIEWS_EXPORT_API_BASE_URL: apiBaseUrl",
    "MATERIAL_TRANSFORM_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "MATERIAL_TRANSFORM_RULES_EXPORT_API_BASE_URL: apiBaseUrl",
    "STATISTICS_API_BASE_URL: apiBaseUrl",
    "STATISTICS_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "BUSINESS_DATA_BASELINE_API_BASE_URL: apiBaseUrl",
    "BUSINESS_FIXTURE_VISIBILITY_API_BASE_URL: apiBaseUrl",
    "NOTICE_CENTER_API_BASE_URL: apiBaseUrl",
    "NOTICE_API_BASE_URL: apiBaseUrl",
    "PRODUCTION_NOTICES_EXPORT_API_BASE_URL: apiBaseUrl",
    "PRODUCTION_EXCEPTION_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "PRODUCTION_REPLENISHMENT_REQUESTS_EXPORT_API_BASE_URL: apiBaseUrl",
    "PRODUCTION_SCRAP_RECORDS_EXPORT_API_BASE_URL: apiBaseUrl",
    "PRODUCTION_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "PRODUCTION_EXPORT_API_BASE_URL: apiBaseUrl",
    "PROCESS_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "PROCESS_EXPORT_API_BASE_URL: apiBaseUrl",
    "WAREHOUSE_CONFIG_API_BASE_URL: apiBaseUrl",
    "WAREHOUSE_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "WAREHOUSE_WORK_MANAGEMENT_API_BASE_URL: apiBaseUrl",
    "WAREHOUSE_WORK_EXPORT_API_BASE_URL: apiBaseUrl",
    "WAREHOUSE_NOTICES_EXPORT_API_BASE_URL: apiBaseUrl",
    "WAREHOUSE_TRANSACTION_EXPORT_API_BASE_URL: apiBaseUrl",
    'function latestFileMtime',
    'function assertBackendBuildCurrent',
    'if (!skipBackendBuild)',
    'assertBackendBuildCurrent();',
    'requires an existing backend build stamp',
    'const buildMtimeMs = statSync(backendBuildStamp).mtimeMs',
    'latestInput.mtimeMs > buildMtimeMs + 1000',
    '--skip-build found backend build older than',
    'Run npm run backend:build first',
    "await runCommand(['run', 'backend:build'], { timeoutMs: Math.max(defaultCommandTimeoutMs, 300000) })",
    "spawn(command.file, command.args",
    "spawnSync('taskkill'",
    'timeoutMs: Math.max(defaultCommandTimeoutMs, 300000)',
    'await waitForHealth(backend)',
    'const exitStatus = backend.exited();',
    'Temporary API server exited before health check passed',
    'exited: () => exitStatus',
    'First-stage API regression verification passed.',
    'process.exit(0);',
    'process.exit(1);'
  ];
  for (const snippet of apiAggregateRegressionSnippets) {
    if (!apiAggregateRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-first-stage-api.cjs must keep self-contained API regression snippet: ${snippet}`);
    }
  }
  const aggregateVerifyScriptListMatch = apiAggregateRegressionScriptSource.match(/const verifyScripts = \[([\s\S]*?)\];/);
  if (!aggregateVerifyScriptListMatch) {
    addFailure('verify-first-stage-api.cjs must keep an explicit verifyScripts array for aggregate API regressions.');
  } else {
    const aggregateVerifyScripts = [...aggregateVerifyScriptListMatch[1].matchAll(/['"`](verify:[^'"`]+)['"`]/g)].map((match) => match[1]);
    const duplicateVerifyScripts = aggregateVerifyScripts.filter((scriptName, index) => aggregateVerifyScripts.indexOf(scriptName) !== index);
    if (duplicateVerifyScripts.length > 0) {
      addFailure(`Duplicate first-stage API regression scripts: ${[...new Set(duplicateVerifyScripts)].join(', ')}`);
    }
    for (const scriptName of aggregateVerifyScripts) {
      if (!packageScripts[scriptName]) {
        addFailure(`Package script missing for aggregate first-stage API regression: ${scriptName}`);
      }
    }
  }
  if (
    !/async function main\(\) \{[\s\S]*let backend = null;[\s\S]*try \{[\s\S]*backend = startBackend\(\);[\s\S]*await waitForHealth\(backend\);[\s\S]*finally \{[\s\S]*if \(backend\) \{[\s\S]*stopBackend\(backend\.child\);/.test(
      apiAggregateRegressionScriptSource
    )
  ) {
    addFailure('verify-first-stage-api.cjs must stop the temporary backend even when health check or child regressions fail.');
  }
  if (
    !/main\(\)[\s\S]*\.then\(\(\)\s*=>\s*\{[\s\S]*First-stage API regression verification passed\.[\s\S]*process\.exit\(0\);[\s\S]*\.catch\(\(error\)\s*=>\s*\{[\s\S]*process\.exit\(1\);/.test(
      apiAggregateRegressionScriptSource
    )
  ) {
    addFailure('verify-first-stage-api.cjs must explicitly exit after cleanup so lingering API/test handles cannot hang verify:first-stage:api.');
  }
  if (
    !/function runCommand\(args, options = \{\}\)[\s\S]*defaultCommandTimeoutMs[\s\S]*setTimeout\(\(\) => \{[\s\S]*stopProcessTree\(child\)[\s\S]*timed out after[\s\S]*clearTimeout\(timer\)/.test(
      apiAggregateRegressionScriptSource
    )
  ) {
    addFailure('verify-first-stage-api.cjs must timeout and clean up child regression scripts so a hung API script cannot block first-stage verification.');
  }

  const apiRegressionScriptSources = [
    ['verify-order-import-api.cjs', regressionScriptSource],
    ['verify-material-import-api.cjs', materialImportApiRegressionScriptSource],
    ['verify-inventory-adjustment-api.cjs', inventoryAdjustmentApiRegressionScriptSource],
    ['verify-inventory-export-api.cjs', inventoryExportApiRegressionScriptSource],
    ['verify-material-drawing-revisions-export-api.cjs', materialDrawingRevisionsExportApiRegressionScriptSource],
    ['verify-material-applicabilities-export-api.cjs', materialApplicabilitiesExportApiRegressionScriptSource],
    ['verify-material-dashboard-export-api.cjs', materialDashboardExportApiRegressionScriptSource],
    ['verify-statistics-management-api.cjs', statisticsManagementApiRegressionScriptSource],
    ['verify-business-data-baseline-api.cjs', businessDataBaselineApiRegressionScriptSource],
    ['verify-business-fixture-visibility-api.cjs', businessFixtureVisibilityApiRegressionScriptSource],
    ['verify-production-notices-api.cjs', productionNoticesApiRegressionScriptSource],
    ['verify-production-management-api.cjs', productionManagementApiRegressionScriptSource],
    ['verify-production-export-api.cjs', productionExportApiRegressionScriptSource],
    ['verify-warehouse-config-api.cjs', warehouseConfigApiRegressionScriptSource],
    ['verify-upload-filenames-api.cjs', uploadFileNameRegressionScriptSource]
  ];
  for (const [scriptName, scriptSource] of apiRegressionScriptSources) {
    if (!scriptSource.includes('FIRST_STAGE_API_BASE_URL')) {
      addFailure(`${scriptName} must accept FIRST_STAGE_API_BASE_URL so verify:first-stage:api can run on a temporary API port.`);
    }
  }
  for (const snippet of [
    'material-drawing-revisions-export-read-only',
    'findMaterialWithDefaultDrawing',
    'assertExportWorkbook',
    'defaultDrawingVersion',
    'fixturePrefixes'
  ]) {
    if (!materialDrawingRevisionsExportApiRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-material-drawing-revisions-export-api.cjs must stay read-only and verify existing drawing revision export data: ${snippet}`);
    }
  }
  for (const forbiddenSnippet of [
    "const { PrismaClient } = require('@prisma/client');",
    'prisma.material.upsert',
    'prisma.materialDrawingRevision.upsert',
    'prisma.materialDrawingRevision.updateMany',
    'prisma.material.updateMany',
    'prepareStableVerificationData',
    'cleanupStableVerificationData'
  ]) {
    if (materialDrawingRevisionsExportApiRegressionScriptSource.includes(forbiddenSnippet)) {
      addFailure(`verify-material-drawing-revisions-export-api.cjs must not write drawing export verification data: ${forbiddenSnippet}`);
    }
  }
  for (const snippet of [
    'material-applicabilities-export-read-only',
    'findMaterialForApplicabilityExport',
    'assertApplicabilityRow',
    'material-applicabilities-export-empty-state',
    'fixturePrefixes'
  ]) {
    if (!materialApplicabilitiesExportApiRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-material-applicabilities-export-api.cjs must stay read-only and verify existing applicability export data: ${snippet}`);
    }
  }
  for (const forbiddenSnippet of [
    "const { PrismaClient } = require('@prisma/client');",
    'prisma.material.upsert',
    'prisma.materialApplicability.upsert',
    'prisma.materialApplicability.updateMany',
    'prisma.material.updateMany',
    'prepareStableVerificationData',
    'cleanupStableVerificationData'
  ]) {
    if (materialApplicabilitiesExportApiRegressionScriptSource.includes(forbiddenSnippet)) {
      addFailure(`verify-material-applicabilities-export-api.cjs must not write applicability export verification data: ${forbiddenSnippet}`);
    }
  }
  for (const snippet of [
    'STATISTICS_MANAGEMENT_API_BASE_URL',
    'fixturePrefixes',
    '/statistics/options',
    'currentBusinessQuarter',
    'currentBusinessMonth',
    '/statistics/orders?period=year&year=${year}',
    '/statistics/orders?period=quarter&year=${year}',
    '/statistics/orders?period=quarter&year=${year}&quarter=${quarter}',
    '/statistics/orders?period=month&year=${year}',
    '/statistics/orders?period=month&year=${year}&month=${month}',
    'statistics quarter ignores stray month',
    'statistics month ignores stray quarter',
    'future month statistics must be marked as future.',
    'assertNoFixtureText'
  ]) {
    if (!statisticsManagementApiRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-statistics-management-api.cjs must keep statistics filter visibility regression snippet: ${snippet}`);
    }
  }
  for (const snippet of [
    'BUSINESS_DATA_BASELINE_API_BASE_URL',
    'coveredModules',
    'checkPage',
    '/customers?limit=1&offset=0',
    '/orders?limit=1&offset=0',
    '/materials/dashboard?limit=1&offset=0',
    '/inventory/materials?limit=1&offset=0',
    '/inventory/model-boms?status=ALL&limit=1&offset=0',
    '/production/tasks?limit=1&offset=0',
    '/production/tasks/order-summary?limit=1&offset=0',
    '/warehouse/transactions?limit=1&offset=0',
    '/inventory/summary?limit=1&offset=0',
    '/warehouses?status=ALL&locationStatus=ALL',
    '/statistics/orders?period=year&year=${currentBusinessYear}',
    'Run npm run backend:db:seed or inspect business fixture filters.'
  ]) {
    if (!businessDataBaselineApiRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-business-data-baseline-api.cjs must keep first-stage business data baseline regression snippet: ${snippet}`);
    }
  }
  for (const snippet of [
    'PRODUCTION_MANAGEMENT_API_BASE_URL',
    'filteredDisplayStatuses',
    'assertPageShape',
    'assertProductionTaskRow',
    'assertProductionSummaryRow',
    '/production/tasks?displayStatus=ALL&limit=5&offset=0',
    '/production/tasks/order-summary?displayStatus=ALL&limit=5&offset=0',
    'production management task detail tab must show business rows by default.',
    'production management order summary tab must show business rows by default.',
    'production management status cards must not all be zero when ALL has production data.',
    'customerId',
    'orderNo',
    'production scoped order summary should still contain the selected business order.',
    'production scoped task list should still contain the selected business order.'
  ]) {
    if (!productionManagementApiRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-production-management-api.cjs must keep production data visibility regression snippet: ${snippet}`);
    }
  }

  const inventoryExportRegressionSnippets = [
    'inventory-export-read-only',
    'inventory-export-source-balance-read-only',
    '正常备货',
    '取消转备货',
    '客户变更转备货',
    'stockInventoryQuantity === normalOrderStockQuantity + cancelledOrderStockQuantity + customerChangeStockQuantity',
    'availableQuantity === orderInventoryQuantity + stockInventoryQuantity',
    'inventory-export-test-fixture-filter',
    'inventory export default response must hide reusable test fixture inventory',
    'workbookDataRowsHaveTestFixturePrefix',
    'assertSummaryQuantityRelationships',
    'inventory no-match export should only include title, scope, blank row and header rows'
  ];
  for (const snippet of inventoryExportRegressionSnippets) {
    if (!inventoryExportApiRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-inventory-export-api.cjs must keep stock source split regression snippet: ${snippet}`);
    }
  }
  if (
    inventoryExportApiRegressionScriptSource.includes('prisma.customer.deleteMany') ||
    inventoryExportApiRegressionScriptSource.includes('prisma.warehouse.deleteMany') ||
    inventoryExportApiRegressionScriptSource.includes('prisma.warehouseLocation.deleteMany') ||
    inventoryExportApiRegressionScriptSource.includes('function localDateTimeStamp')
  ) {
    addFailure('verify-inventory-export-api.cjs must stay read-only and avoid deleting customer, warehouse or location data.');
  }

  const regressionSnippets = [
    "workbook.addWorksheet('ERP上传净表')",
    '/orders/import-sessions',
    'downloadTemplate',
    'assertTemplateWorkbook',
    "optionsSheet.getCell('E10000').text === 'C9999'",
    "uploadSheet.getCell('X4').text === '版本'",
    "dataValidation?.errorStyle === 'warning'",
    'assertIssueReportWorkbook',
    "headerColumns.has('版本')",
    "headerColumns.has('图纸日期')",
    "headerColumns.has('图纸状态')",
    'requiredDrawingVersions',
    'requiredDrawingDates',
    'requiredDrawingStatuses',
    '问题明细必须在错误代码',
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
    'template.buffer.equals(readFileSync(bundledTemplatePath))',
    "upload.files?.[0]?.sheetName",
    "upload.files?.[0]?.fileName === fileName",
    "sourceFileName === fileName",
    'upload.summary.materialSyncCount === 6',
    'upload.summary.materialSyncPreview?.includes',
    '订单导入父级组件行厚度必须按不适用处理为 0',
    'THICKNESS_DEFAULTED',
    '订单导入父级组件行不应产生 THICKNESS_DEFAULTED 厚度待核对警告',
    'assertImportMissingThicknessDraftRequiresReview',
    'assertOrderImportDrawingVersionSnapshot',
    'assertDraftStockReservationReleasedOnCancel',
    'assertDraftStockReservationRemovedOnDelete',
    'assertDraftStockReservationReplacedOnEdit',
    'assertDraftStockReservationOrderNoRenumberedOnEdit',
    'assertDraftWithInventoryCannotBeDeleted',
    'assertSubmittedOrderCannotBeDeleted',
    'assertDraftWithProductionTaskCannotBeDeleted',
    'assertDraftWithInventoryTransactionCannotBeDeleted',
    'draft stock reservation must become RELEASED after order cancel',
    'deleted draft order must remove ACTIVE InventoryReservation rows',
    'deleted unsubmitted draft must release orderNo reservation for corrected re-import',
    'stock batch quantity should remain 9 after draft delete',
    '草稿编辑同批次增加数量后必须保留原预占 createdAt',
    '草稿编辑同批次减少数量后仍必须保留原预占 createdAt',
    '草稿编辑库存来源失败后必须保留原 ACTIVE InventoryReservation',
    '草稿编辑库存来源失败后不得提前释放旧预占',
    '草稿编辑库存来源失败后不得生成新库存批次预占',
    '草稿编辑库存来源失败后不得生成 InventoryTransaction',
    '草稿修改订单号后 ACTIVE InventoryReservation 必须同步新 orderNo',
    '草稿修改订单号后旧订单号预占必须释放',
    '草稿修改订单号后旧订单号占用必须释放',
    '草稿修改订单号后新订单号必须继续占用',
    '草稿改成已占用订单号失败后订单号必须保持不变',
    '草稿改成已占用订单号失败后原 ACTIVE 预占必须保持 ACTIVE',
    '草稿改成已占用订单号失败后原订单号占用必须保持',
    '草稿改成已占用订单号失败后不得把目标订单号占用转给当前订单',
    '草稿修改订单号后删除草稿必须清理全部 InventoryReservation',
    '草稿修改订单号后删除草稿必须释放新订单号占用',
    '避免后下单抢占库存优先级',
    '草稿编辑换库存批次后旧 ACTIVE 预占必须释放',
    '草稿编辑换库存批次后新库存批次必须创建 ACTIVE InventoryReservation',
    '草稿编辑清空库存来源后不得保留 ACTIVE InventoryReservation',
    '草稿编辑清空库存来源后旧库存批次预占必须释放',
    '草稿编辑清空库存来源不得生成 InventoryTransaction',
    '清空库存来源草稿提交失败后订单必须保持 DRAFT',
    '清空库存来源草稿提交失败后不得重新生成 ACTIVE InventoryReservation',
    '清空库存来源草稿提交失败后不得生成 InventoryTransaction',
    '清空库存来源草稿提交失败后不得生成 ProductionTask',
    '草稿编辑改为重新生产后不得保留 ACTIVE InventoryReservation',
    '草稿编辑库存来源不得生成 InventoryTransaction',
    'draft with inventory must stay after rejected delete',
    'draft inventory batch must stay linked after rejected delete',
    'rejected draft delete must keep orderNo reservation occupied',
    'submitted order must stay after rejected delete',
    'submitted order status must remain PENDING_PRODUCTION',
    'rejected submitted delete must keep orderNo reservation occupied',
    'draft with production task must stay after rejected delete',
    'draft production task must stay linked after rejected delete',
    'rejected draft task delete must keep orderNo reservation occupied',
    'draft with inventory transaction must stay after rejected delete',
    'draft inventory transaction must stay linked after rejected delete',
    'rejected draft transaction delete must keep orderNo reservation occupied',
    "releasedReservation?.statusReason === 'ORDER_CANCELLED'",
    'released reservation must keep releasedAt for audit',
    'cancelled draft reservation must not be marked consumed',
    'stock batch quantity should remain 8 after draft cancel',
    'cancelled order must keep orderNo reservation instead of releasing reused order number',
    '订单行图纸版本快照必须保留 B',
    '来源 Excel 预览必须保留图纸版本',
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
    'assertSubmitConsumesDraftStockReservation',
    '库存全覆盖草稿保存后必须创建 ACTIVE InventoryReservation',
    '提交生产后草稿库存预占必须转为 CONSUMED',
    'CONSUMED InventoryReservation 必须记录 consumedAt',
    '原备货批次提交后应剩余 2',
    '库存全覆盖提交后必须生成订单待发货库存批次',
    '库存全覆盖提交后必须给原备货批次追加 OUT InventoryTransaction',
    '库存全覆盖提交后必须给订单待发货批次追加 IN InventoryTransaction',
    '库存全覆盖且 productionPlanQuantity=0 时不得生成 ProductionTask',
    'assertSubmitPartiallyConsumesStockAndCreatesProductionTask',
    '部分库存覆盖订单生产计划必须是',
    '部分库存覆盖提交后草稿预占必须转为 CONSUMED',
    '部分库存覆盖提交后必须生成订单待发货库存批次',
    '部分库存覆盖提交后必须给原备货批次追加 OUT InventoryTransaction',
    '部分库存覆盖提交后必须给订单待发货批次追加 IN InventoryTransaction',
    '部分库存覆盖只应按剩余数量生成 1 个 ProductionTask',
    '部分库存覆盖 ProductionTask plannedQuantity 应为',
    '部分库存覆盖 ProductionTask 必须保留下单时的 processSnapshot',
    'assertSubmitRejectsPartialStockWithoutProcessSteps',
    '部分库存缺工序提交失败后订单必须保持 DRAFT',
    '部分库存缺工序提交失败后预占必须保持 ACTIVE',
    '部分库存缺工序提交失败后不得生成 InventoryTransaction',
    '部分库存缺工序提交失败后不得生成订单待发货库存批次',
    '部分库存缺工序提交失败后不得生成 ProductionTask',
    'assertSubmitConsumesReworkStockAndCreatesProductionTask',
    '库存再加工清空来源后不得保留 ACTIVE InventoryReservation',
    '库存再加工清空来源提交失败后订单必须保持 DRAFT',
    '库存再加工清空来源提交失败后不得生成 InventoryTransaction',
    '库存再加工重新选择来源后必须重新创建 ACTIVE InventoryReservation',
    '库存再加工提交后草稿预占必须转为 CONSUMED',
    '库存再加工流水 sourceRecordType 必须是 OrderLineREWORK',
    '库存再加工提交后不得生成订单待发货库存批次',
    '库存再加工 ProductionTask 必须保留下单时的 processSnapshot',
    'assertSubmitRejectsReworkStockSourceShortage',
    '库存再加工来源不足提交失败后订单必须保持 DRAFT',
    '库存再加工来源不足提交失败后预占必须保持 ACTIVE',
    '库存再加工来源不足提交失败后不得生成 InventoryTransaction',
    '库存再加工来源不足提交失败后不得生成订单待发货库存批次',
    '库存再加工来源不足提交失败后不得生成 ProductionTask',
    'assertCreateRejectsStockSourceOverAvailable',
    '使用库存超可用量保存失败后不得生成草稿订单',
    '使用库存超可用量保存失败后不得占用订单号',
    '使用库存超可用量保存失败后不得生成 InventoryReservation',
    '使用库存超可用量保存失败后不得生成 InventoryTransaction',
    'assertCreateRejectsSameBatchStockSourcesOverAvailableAcrossLines',
    '同一草稿订单多行共用同一库存批次超库存保存失败后不得生成草稿订单',
    '同一草稿订单多行共用同一库存批次超库存保存失败后不得生成 InventoryReservation',
    '同一草稿订单多行共用同一库存批次超库存保存失败后不得生成 InventoryTransaction',
    'assertCreateRejectsDuplicateStockSourceStrictStatusWithoutFreshManualConfirmation',
    '重复库存来源严格状态缺少新人工确认保存失败后不得生成草稿订单',
    '重复库存来源合并后需要重新人工确认',
    'assertUpdateRejectsSameBatchStockSourcesOverAvailableAcrossLines',
    '同批次编辑聚合超库存失败后订单行库存来源必须保持原始合法选择',
    '同批次编辑聚合超库存失败后必须保留原 2 条 ACTIVE InventoryReservation',
    '同批次编辑聚合超库存失败后不得提前释放预占',
    'assertCreateRejectsStockSourceReservedByEarlierDraftOrder',
    '跨草稿预占优先级第二个草稿超库存保存失败后不得生成 CustomerOrder',
    '跨草稿预占优先级第二个草稿超库存保存失败后不得生成 InventoryReservation',
    '跨草稿预占优先级第二个草稿失败后第一个预占必须保持 ACTIVE',
    'assertLaterDraftSubmitRejectsAfterEarlierDraftReservationIncrease',
    '较早草稿提高预占后较晚草稿预占仍应保持 ACTIVE',
    '较晚草稿提交失败后自身预占必须保持 ACTIVE',
    '较晚草稿提交失败后不得生成订单待发货库存批次',
    'assertEarlierDraftSubmitWinsPriorityBeforeLaterDraftReservation',
    '较早草稿提交后不得保留 ACTIVE InventoryReservation',
    '较早草稿提交后 CONSUMED InventoryReservation 合计必须为',
    '较早草稿提交后较晚草稿预占仍应保持 ACTIVE',
    '较晚草稿提交失败后只能保留较早草稿的 OUT/IN InventoryTransaction',
    'assertLaterDraftSubmitSucceedsAfterEarlierDraftConsumesStock',
    '较早草稿提交后较晚草稿预占必须保持 ACTIVE',
    '跨草稿顺序提交较晚预占必须转为 CONSUMED',
    '跨草稿顺序提交全库存覆盖不得生成 ProductionTask',
    'assertDraftStockReservationPriorityUsesOrderNoTieBreaker',
    'source-details?sourceType=STOCK&includeTestFixtures=true&excludeOrderNo',
    'source-details?sourceType=STOCK&includeTestFixtures=true&excludeOrderId',
    'same-time higher order stale id source-details must fall back to excludeOrderNo',
    'same-time higher order stale id inventory summary must fall back to excludeOrderNo',
    'same-time higher order stale id inventory list must fall back to excludeOrderNo',
    'same-time higher order stale id material suggestions must fall back to excludeOrderNo',
    '同时间草稿预占优先级必须把两个 DRAFT 的 createdAt 调整为完全相同',
    '同时间较小订单号库存来源明细不应扣除较大订单号预占',
    '同时间较大订单号库存来源明细必须扣除较小订单号预占',
    '同时间较大订单号库存来源明细只能把较小订单号预占计入占用',
    '同时间较小订单号库存汇总不应扣除较大订单号预占',
    '同时间较大订单号库存汇总必须扣除较小订单号预占',
    '同时间较小订单号库存列表不应扣除较大订单号预占',
    '同时间较大订单号库存列表必须扣除较小订单号预占',
    '同时间较大订单号库存列表只能把较小订单号预占计入占用',
    '同时间较小订单号物料建议不应扣除较大订单号预占',
    '同时间较大订单号物料建议必须扣除较小订单号预占',
    '同时间较大订单号物料建议备货库存应为',
    '同时间较大订单 id 库存来源明细必须扣除较小订单号预占',
    '同时间较大订单 id 库存汇总必须扣除较小订单号预占',
    '同时间较大订单 id 库存列表必须扣除较小订单号预占',
    '同时间较大订单 id 物料建议必须扣除较小订单号预占',
    '同时间较大订单 id 冲突参数库存来源明细必须优先按 id 扣除较小订单号预占',
    '同时间较大订单 id 冲突参数库存汇总必须优先按 id 扣除较小订单号预占',
    '同时间较大订单 id 冲突参数库存列表必须优先按 id 扣除较小订单号预占',
    '同时间较大订单 id 冲突参数物料建议必须优先按 id 扣除较小订单号预占',
    '同时间较大订单号物料建议在较小订单号占满库存后不得继续返回 STOCK 候选',
    '同时间较大订单 id 物料建议在较小订单号占满库存后不得继续返回 STOCK 候选',
    '同时间较大订单号物料建议 sourceType=ALL 应保留零可用量物料用于人工核对',
    '同时间较大订单 id 物料建议 sourceType=ALL 应保留零可用量物料用于人工核对',
    '同时间较小订单号占满整批提交后原库存批次必须转为 USED',
    '同时间较大订单号提交失败后自身预占必须保持 ACTIVE',
    '同时间较大订单号提交失败后不得生成 InventoryTransaction',
    '同时间较小订单号提交后较大订单号预占必须保持 ACTIVE',
    '同时间草稿预占优先级全库存覆盖不得生成 ProductionTask',
    'assertSubmitConsumesSameBatchStockSourcesAcrossLines',
    '同一草稿订单多行合法共用同一库存批次保存后应创建 2 条 ACTIVE InventoryReservation',
    '同一草稿订单多行合法共用同一库存批次提交后所有预占必须转为 CONSUMED',
    '同批次合法共用全库存覆盖不得生成 ProductionTask',
    'assertCreateRejectsReworkStockSourceOverPlan',
    '库存再加工来源超计划保存失败后不得生成草稿订单',
    '库存再加工来源超计划保存失败后不得占用订单号',
    '库存再加工来源超计划保存失败后不得生成 InventoryReservation',
    '库存再加工来源超计划保存失败后不得生成 InventoryTransaction',
    'assertSubmitRejectsReworkWithoutStockSources',
    '库存再加工未选来源草稿不得生成 InventoryReservation',
    '库存再加工未选来源提交失败后订单必须保持 DRAFT',
    '库存再加工未选来源提交失败后不得生成 InventoryReservation',
    '库存再加工未选来源提交失败后不得生成 InventoryTransaction',
    '库存再加工未选来源提交失败后不得生成 ProductionTask',
    'assertSubmitConsumesSelectedStockSourcesInManualOrder',
    '人工库存批次顺序第 1 条 OUT 必须来自先选的 B 批次',
    '人工库存批次顺序第 2 条 OUT 必须来自后选的 A 批次',
    'IB-ALLOC-${orderNo}-001-01',
    'IB-ALLOC-${orderNo}-001-02',
    '人工库存批次顺序第 1 条 IN 必须写入第 1 个订单库存批次',
    '人工库存批次顺序全库存覆盖不得生成 ProductionTask',
    'assertEarlierDraftManualSelectionSeesSmallerBatchReservedByLaterDraft',
    '未优先使用较小库存批次',
    'later draft must reserve the smaller batch',
    'earlier draft rejected manual priority edit must not create InventoryReservation',
    'stale manual priority confirmation',
    'earlier draft stale manual priority edit must not create InventoryReservation',
    'later draft reservation must stay ACTIVE after stale earlier edit rejection',
    'later draft smaller-batch reservation must remain ACTIVE after earlier submit',
    'assertSubmitRejectsStaleManualSelectionWhenSmallerBatchAppearsAfterDraftSave',
    'stale manual priority submit regression must create draft order first',
    'stale manual priority submit rejection must keep order DRAFT',
    'stale manual priority submit rejection must keep original reservation ACTIVE',
    'stale manual priority submit rejection must not create InventoryTransaction',
    'assertCreateRejectsStockSourceDrawingSnapshotMismatchWithoutManualConfirmation',
    'fileNameMismatchOrderNo',
    'fileMismatchOrderNo',
    'missingFileNameOrderNo',
    'missingFileOrderNo',
    'missingSourceDrawingOrderNo',
    'reworkMissingFileOrderNo',
    'partNameMismatchOrderNo',
    'unitMismatchOrderNo',
    'projectModelMismatchOrderNo',
    'partCategoryMismatchOrderNo',
    '库存来源图纸文件不一致保存失败后不得生成 CustomerOrder',
    '库存来源图纸文件不一致保存失败后不得生成 InventoryReservation',
    '库存来源图纸文件名不一致保存失败后不得生成 CustomerOrder',
    '库存来源图纸文件名不一致保存失败后不得生成 InventoryReservation',
    '库存来源本次订单缺图纸文件保存失败后不得生成 CustomerOrder',
    '库存来源本次订单缺图纸文件保存失败后不得生成 InventoryReservation',
    '库存来源本次订单缺图纸文件名保存失败后不得生成 CustomerOrder',
    '库存来源本次订单缺图纸文件名保存失败后不得生成 InventoryReservation',
    '库存来源资料不完整：图纸日期、图纸状态',
    '库存来源与订单不一致',
    '库存来源批次缺图纸日期和状态保存失败后不得生成 CustomerOrder',
    '库存来源批次缺图纸日期和状态保存失败后不得生成 InventoryReservation',
    '库存再加工本次订单缺图纸文件保存失败后不得生成 CustomerOrder',
    '库存再加工本次订单缺图纸文件保存失败后不得生成 InventoryReservation',
    '库存来源零件名称不一致保存失败后不得生成 CustomerOrder',
    '库存来源零件名称不一致保存失败后不得生成 InventoryReservation',
    '库存来源单位不一致保存失败后不得生成 CustomerOrder',
    '库存来源单位不一致保存失败后不得生成 InventoryReservation',
    '库存来源项目型号不一致保存失败后不得生成 CustomerOrder',
    '库存来源项目型号不一致保存失败后不得生成 InventoryReservation',
    '库存来源零件类型不一致保存失败后不得生成 CustomerOrder',
    '库存来源零件类型不一致保存失败后不得生成 InventoryReservation',
    '库存来源图纸快照不一致保存失败后不得生成 CustomerOrder',
    '库存来源图纸快照不一致保存失败后不得生成 InventoryReservation',
    'assertCreateRejectsStockSourceLineTypeMismatchWithoutManualConfirmation',
    '库存来源行类型不一致保存失败后不得生成 CustomerOrder',
    '库存来源行类型不一致保存失败后不得生成 InventoryReservation',
    'assertCreateRejectsStockSourceStructureMismatchWithoutManualConfirmation',
    '库存来源组件结构不一致保存失败后不得生成 CustomerOrder',
    '库存来源组件结构不一致保存失败后不得生成 InventoryReservation',
    'assertSameOrderOtherLineSelectionSatisfiesSmallerBatchPriority',
    '同订单跨行小批次优先草稿应创建 2 条 ACTIVE InventoryReservation',
    '同订单跨行小批次优先草稿必须预占已用满的小批次',
    '同订单跨行小批次优先提交后较小批次应被用完',
    '同订单跨行小批次优先全库存覆盖不得生成 ProductionTask',
    'assertSubmittedStockOrderCannotBeSubmittedAgain',
    '只有待提交生产订单可以提交生产',
    '重复提交库存订单后不得新增 InventoryTransaction',
    '重复提交库存订单后不得新增订单待发货库存批次',
    '重复提交库存订单后原备货批次数量不得继续减少',
    '重复提交库存订单后不得生成 ProductionTask',
    'assertSubmitRejectsMismatchedDraftStockReservation',
    '草稿预占数量异常',
    '库存预占异常提交失败后订单必须保持 DRAFT',
    '库存预占异常提交失败后预占必须保持 ACTIVE',
    '库存预占异常提交失败后原备货批次数量必须保持 6',
    '库存预占异常提交失败后不得残留 InventoryTransaction',
    '库存预占异常提交失败后不得生成订单待发货库存批次',
    '库存预占异常提交失败后不得生成 ProductionTask',
    'assertSubmitRejectsMissingDraftStockReservation',
    '缺少草稿库存预占记录',
    '库存预占缺失提交失败后订单必须保持 DRAFT',
    '库存预占缺失提交失败后原备货批次数量必须保持 6',
    '库存预占缺失提交失败后不得残留 InventoryTransaction',
    '库存预占缺失提交失败后不得生成订单待发货库存批次',
    '库存预占缺失提交失败后不得生成 ProductionTask',
    'assertSubmitRejectsInvalidPersistedComponentStructure',
    '所属组件 MISSING-COMPONENT 在当前订单内不存在',
    "const runId = 'STABLE';",
    "const orderPrefix = 'COD-IMPORT-STABLE';",
    "const materialPrefix = 'MAT-STABLE';",
    "const customerSearchPrefix = 'CUST-SEARCH-STABLE';",
    'function pageItems(result)',
    'function archivedCustomerIdentity(value, customerId)',
    'async function archiveDisabledCustomersByIds(prisma, customerIds)',
    'function orderImportCaseSuffix(customerCode)',
    "text.match(/^COD-IMPORT-\\d{14}(.+)$/)",
    "text.match(/^COD-IMPORT-STABLE(.+)$/)",
    'async function findReusableCustomerByCode(prisma, customerCode)',
    'async function createRegressionCustomerRecord(prisma, args)',
    'createRegressionCustomerRecord(prisma,',
    'async function activateReusableRegressionCustomer(customerCode, customerName, contactName, contactPhone)',
    'async function softDisableCustomerByCode(prisma, customerCode)',
    'const suffix = orderImportCaseSuffix(customerCode)',
    "customerCode: { endsWith: suffix }",
    "customerCode: { startsWith: `${customerCode}__DISABLED__` }",
    'async function archiveExistingCustomerByCode(customerCode)',
    'await archiveExistingCustomerByCode(customerCode);',
    'createOrderImportRegressionCustomers',
    'createdRegressionCustomerIds',
    'prisma.customerContact.updateMany',
    'customerCode: archivedCustomerIdentity(customer.customerCode, customer.id)',
    'customerName: archivedCustomerIdentity(customer.customerName, customer.id)',
    'await archiveDisabledCustomersByIds(prisma, createdRegressionCustomerIds);',
    'await softDisableCustomerByCode(prisma, customerCode);',
    'const customerCode = overrides.customerCode',
    "'RANK-PREFIX'",
    "'RANK-EXACT'",
    'resolveHostUploadRoot',
    "normalized === '/app/storage/uploads'",
    'await cleanup()',
    'new PrismaClient()',
    'prisma.material.updateMany',
    "status: 'DISABLED'",
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
    '涉及物料号',
    'async function firstEnabledCustomerName()',
    'prisma.customer.deleteMany',
    'prisma.material.deleteMany',
    'customerCode: { startsWith: customerSearchPrefix }',
    'new Date().toISOString().replace(/[-:.TZ]/g, \'\').slice(0, 14)',
    'prisma.customer.create({'
  ];
  for (const snippet of forbiddenRegressionScriptSnippets) {
    if (regressionScriptSource.includes(snippet)) {
      addFailure(`verify-order-import-api.cjs must use 零件搜索记忆 wording instead of stale import wording: ${snippet}`);
    }
  }

  const uploadFileNameRegressionSnippets = [
    '/orders/drawings/upload',
    '/inventory/material-drawings/upload',
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
    '零件图纸-中文验证.png',
    '零件图纸-percent编码验证.png',
    '零件图纸-路径清理验证.png',
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
    '零件图纸普通中文文件名必须保留',
    '零件图纸 percent-encoded 文件名必须修复为中文',
    '零件图纸路径文件名必须只保留 basename',
    '库存附件 mojibake 文件名必须修复为中文',
    '库存附件 percent-encoded 文件名必须修复为中文',
    '库存附件路径文件名必须只保留 basename',
    'createUploadFilenameCustomerName',
    'createdCustomerIds',
    "const uploadFilenameCustomerCode = 'UPLOAD-FILENAME-CUST-STABLE';",
    "const uploadFilenameCustomerName = '上传文件名验证客户 STABLE';",
    "const runId = 'STABLE';",
    'const { PrismaClient } = require(\'@prisma/client\');',
    'const prisma = new PrismaClient();',
    'prisma.customer.findFirst',
    'prisma.customer.update',
    'prisma.customer.create',
    'prisma.customerContact.updateMany',
    'prisma.customerContact.findFirst',
    'prisma.customerContact.update',
    'customerCode: `${baseCode}${archiveSuffix}`',
    'customerName: `${baseName}${archiveSuffix}`',
    'resolveHostUploadRoot',
    "normalized === '/app/storage/uploads'",
    "join(uploadRoot, 'drawings', fileName)",
    "join(uploadRoot, 'inventory-adjustments', fileName)"
  ];
  for (const snippet of uploadFileNameRegressionSnippets) {
    if (!uploadFileNameRegressionScriptSource.includes(snippet)) {
      addFailure(`verify-upload-filenames-api.cjs must keep upload filename regression snippet: ${snippet}`);
    }
  }
  if (uploadFileNameRegressionScriptSource.includes('async function firstEnabledCustomerName()')) {
    addFailure('verify-upload-filenames-api.cjs must create and soft-disable its own verification customer instead of depending on pre-existing enabled customers.');
  }
  if (
    uploadFileNameRegressionScriptSource.includes('new Date().toISOString().replace') ||
    uploadFileNameRegressionScriptSource.includes('UPLOAD-FILENAME-CUST-${runId}')
  ) {
    addFailure('verify-upload-filenames-api.cjs must reuse a stable upload filename customer instead of creating timestamped customers.');
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

function verifyOrderTableHeightControls() {
  const viewPath = 'frontend/src/views/OrdersListView.vue';
  if (!fileExists(viewPath)) {
    addFailure(`Missing order table height control file: ${viewPath}`);
    return;
  }

  const viewSource = readFile(viewPath);
  const requiredSnippets = [
    "import { Minus, Plus, RefreshLeft, WarningFilled } from '@element-plus/icons-vue';",
    "type OrdersWorkTableKey = 'orders' | 'orderFormStructure' | 'importPreview' | 'importFilePreview' | 'importFileStructure' | 'modelBomDraft' | 'modelBomRecommendationStructure' | 'modelBomApplyStructure'",
    'ordersWorkTableHeightLimits',
    'ordersWorkTableDefaultHeights',
    'baisheng.erp.ordersWorkTableHeights.v1',
    '订单页面表格和固定格式清单高度只保存为本机 UI 偏好，不写入订单、导入会话、BOM、生产或库存业务数据。',
    'ordersWorkTableHeights = reactive<Record<OrdersWorkTableKey, number>>',
    'function adjustOrdersWorkTableHeight',
    'function resetOrdersWorkTableHeight',
    'function restoreOrdersWorkTableHeights',
    'function saveOrdersWorkTableHeights',
    'window.localStorage.getItem(ordersWorkTableHeightStorageKey)',
    'window.localStorage.setItem(ordersWorkTableHeightStorageKey',
    'aria-label="订单总列表表格高度"',
    'aria-label="降低订单总列表表格高度"',
    'aria-label="提高订单总列表表格高度"',
    'aria-label="恢复订单总列表表格默认高度"',
    'aria-label="当前草稿固定格式清单高度"',
    'aria-label="降低当前草稿固定格式清单高度"',
    'aria-label="提高当前草稿固定格式清单高度"',
    'aria-label="恢复当前草稿固定格式清单默认高度"',
    'aria-label="订单导入预览表格高度"',
    'aria-label="降低订单导入预览表格高度"',
    'aria-label="提高订单导入预览表格高度"',
    'aria-label="恢复订单导入预览表格默认高度"',
    'aria-label="上传文件预览表格高度"',
    'aria-label="降低上传文件预览表格高度"',
    'aria-label="提高上传文件预览表格高度"',
    'aria-label="恢复上传文件预览表格默认高度"',
    'aria-label="上传文件固定格式清单高度"',
    'aria-label="降低上传文件固定格式清单高度"',
    'aria-label="提高上传文件固定格式清单高度"',
    'aria-label="恢复上传文件固定格式清单默认高度"',
    'aria-label="BOM 草稿预览表格高度"',
    'aria-label="降低 BOM 草稿预览表格高度"',
    'aria-label="提高 BOM 草稿预览表格高度"',
    'aria-label="恢复 BOM 草稿预览表格默认高度"',
    'aria-label="零件包推荐结构预览高度"',
    'aria-label="降低零件包推荐结构预览高度"',
    'aria-label="提高零件包推荐结构预览高度"',
    'aria-label="恢复零件包推荐结构预览默认高度"',
    'aria-label="BOM 预览带入结构清单高度"',
    'aria-label="降低 BOM 预览带入结构清单高度"',
    'aria-label="提高 BOM 预览带入结构清单高度"',
    'aria-label="恢复 BOM 预览带入结构清单默认高度"',
    ':max-height="ordersWorkTableHeights.orders"',
    ':style="{ maxHeight: `${ordersWorkTableHeights.orderFormStructure}px` }"',
    ':max-height="ordersWorkTableHeights.importPreview"',
    ':max-height="ordersWorkTableHeights.importFilePreview"',
    ':style="{ maxHeight: `${ordersWorkTableHeights.importFileStructure}px` }"',
    ':max-height="ordersWorkTableHeights.modelBomDraft"',
    ':style="{ maxHeight: `${ordersWorkTableHeights.modelBomRecommendationStructure}px` }"',
    ':style="{ maxHeight: `${ordersWorkTableHeights.modelBomApplyStructure}px` }"',
    'restoreOrdersWorkTableHeights();',
    'orders-table-height-actions',
    'orders-table-height-toolbar'
  ];
  for (const snippet of requiredSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`OrdersListView.vue must keep adjustable order table height control snippet: ${snippet}`);
    }
  }
}

function verifyOrderDetailTableHeightControls() {
  const viewPath = 'frontend/src/views/OrderDetailView.vue';
  if (!fileExists(viewPath)) {
    addFailure(`Missing order detail table height control file: ${viewPath}`);
    return;
  }

  const viewSource = readFile(viewPath);
  const requiredSnippets = [
    "import { Minus, Plus, Rank, RefreshLeft, WarningFilled } from '@element-plus/icons-vue';",
    "type OrderDetailWorkTableKey = 'lines' | 'importSourcePreview' | 'submitOrderLines'",
    'orderDetailWorkTableHeightLimits',
    'orderDetailWorkTableDefaultHeights',
    'baisheng.erp.orderDetailWorkTableHeights.v1',
    '订单详情表格和提交生产核对列表高度只保存为本机 UI 偏好，不写入订单明细、导入追溯、生产或库存业务数据。',
    'orderDetailWorkTableHeights = reactive<Record<OrderDetailWorkTableKey, number>>',
    'function adjustOrderDetailWorkTableHeight',
    'function resetOrderDetailWorkTableHeight',
    'function orderDetailWorkTableHeightStyle',
    'function restoreOrderDetailWorkTableHeights',
    'function saveOrderDetailWorkTableHeights',
    'window.localStorage.getItem(orderDetailWorkTableHeightStorageKey)',
    'window.localStorage.setItem(',
    'orderDetailWorkTableHeightStorageKey',
    'aria-label="订单详情零件明细表格高度"',
    'aria-label="降低订单详情零件明细表格高度"',
    'aria-label="提高订单详情零件明细表格高度"',
    'aria-label="恢复订单详情零件明细表格默认高度"',
    'aria-label="来源 Excel 预览表格高度"',
    'aria-label="降低来源 Excel 预览表格高度"',
    'aria-label="提高来源 Excel 预览表格高度"',
    'aria-label="恢复来源 Excel 预览表格默认高度"',
    'aria-label="提交生产订单零件列表高度"',
    'aria-label="降低提交生产订单零件列表高度"',
    'aria-label="提高提交生产订单零件列表高度"',
    'aria-label="恢复提交生产订单零件列表默认高度"',
    ':max-height="orderDetailWorkTableHeights.lines"',
    ':max-height="orderDetailWorkTableHeights.importSourcePreview"',
    ":style=\"{ maxHeight: orderDetailWorkTableHeightStyle('submitOrderLines') }\"",
    'formatOrderDetailProcessRoutePreview(row.processRoute)',
    'formatOrderDetailLongTextPreview(row.processRemark)',
    "formatOrderDetailLongTextPreview(remark, 12, '')",
    'processStepTitle(line, step)',
    'processStepTitle(row, step)',
    'function processStepTitle(line: OrderLine, processName: string)',
    'function processStepRemark(line: OrderLine, processName: string)',
    'formatImportSourcePreviewIssuesTitle(row)',
    "formatOrderDetailListPreview(row.issues?.map((issue) => issue.message) || [], '问题', '')",
    'function formatOrderDetailProcessRoutePreview',
    'function formatOrderDetailLongTextPreview',
    'restoreOrderDetailWorkTableHeights();',
    'order-detail-table-height-actions',
    'order-detail-table-height-toolbar'
  ];
  for (const snippet of requiredSnippets) {
    if (!viewSource.includes(snippet)) {
      addFailure(`OrderDetailView.vue must keep adjustable order detail table height control snippet: ${snippet}`);
    }
  }
  if (viewSource.includes("return row.issues?.map((issue) => issue.message).filter(Boolean).join('；') || '';")) {
    addFailure('OrderDetailView.vue must summarize import source preview issues instead of rendering every issue message in the table.');
  }
  if (viewSource.includes('return remark ? `${processName}（${remark}）` : processName;')) {
    addFailure('OrderDetailView.vue must summarize process step remarks in pills instead of rendering full remarks directly.');
  }
}

function verifyOrderLineEditorTableHeightControls() {
  const componentPath = 'frontend/src/components/OrderLineEditor.vue';
  if (!fileExists(componentPath)) {
    addFailure(`Missing order line editor table height control file: ${componentPath}`);
    return;
  }

  const source = readFile(componentPath);
  const requiredSnippets = [
    "import { Delete, Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';",
    'orderLineEditorTableHeightLimits',
    'orderLineEditorTableDefaultHeight',
    'baisheng.erp.orderLineEditorTableHeight.v1',
    '订单零件编辑表格高度只保存为本机 UI 偏好，不写入订单明细、导入草稿、生产或库存业务数据。',
    'orderLineEditorTableHeight = ref(orderLineEditorTableDefaultHeight)',
    'function adjustOrderLineEditorTableHeight',
    'function resetOrderLineEditorTableHeight',
    'function restoreOrderLineEditorTableHeight',
    'function saveOrderLineEditorTableHeight',
    'const savedHeightText = window.localStorage.getItem(orderLineEditorTableHeightStorageKey)',
    'if (!savedHeightText)',
    'window.localStorage.getItem(orderLineEditorTableHeightStorageKey)',
    'window.localStorage.setItem(orderLineEditorTableHeightStorageKey',
    'aria-label="订单零件编辑表格高度"',
    'aria-label="降低订单零件编辑表格高度"',
    'aria-label="提高订单零件编辑表格高度"',
    'aria-label="恢复订单零件编辑表格默认高度"',
    ':max-height="orderLineEditorTableHeight"',
    'restoreOrderLineEditorTableHeight();',
    'order-line-table-height-actions',
    'order-line-fixed-toolbar-actions'
  ];
  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`OrderLineEditor.vue must keep adjustable order line editor table height control snippet: ${snippet}`);
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

function verifyMaterialDashboardExportWorkflow() {
  const controllerPath = 'backend/src/modules/materials/materials.controller.ts';
  const dtoPath = 'backend/src/modules/materials/dto.ts';
  const servicePath = 'backend/src/modules/materials/materials.service.ts';
  const apiPath = 'frontend/src/api/erp.ts';
  const dashboardViewPath = 'frontend/src/views/MaterialsManagementView.vue';
  const packagePath = 'package.json';
  const regressionPath = 'scripts/verify-material-dashboard-export-api.cjs';

  for (const projectPath of [controllerPath, dtoPath, servicePath, apiPath, dashboardViewPath, packagePath, regressionPath]) {
    if (!fileExists(projectPath)) {
      addFailure(`Missing material dashboard export source file: ${projectPath}`);
      return;
    }
  }

  const controllerSource = readFile(controllerPath);
  const dtoSource = readFile(dtoPath);
  const serviceSource = readFile(servicePath);
  const apiSource = readFile(apiPath);
  const dashboardViewSource = readFile(dashboardViewPath);
  const packageSource = readFile(packagePath);
  const regressionSource = readFile(regressionPath);
  const requiredSnippets = [
    [controllerPath, controllerSource, "@Get('dashboard/export')"],
    [controllerPath, controllerSource, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    [controllerPath, controllerSource, 'material-dashboard-export.xlsx'],
    [controllerPath, controllerSource, 'buildDashboardExport(query)'],
    [dtoPath, dtoSource, "const materialDashboardStatusFilterValues = ['ALL', 'ENABLED', 'DISABLED'] as const;"],
    [dtoPath, dtoSource, 'status?: MaterialDashboardStatusFilter;'],
    [dtoPath, dtoSource, 'includeTestFixtures?: string;'],
    [dtoPath, dtoSource, 'export class MaterialProjectOptionsQueryDto'],
    [servicePath, serviceSource, 'async buildDashboardExport(query: MaterialDashboardQueryDto): Promise<Uint8Array>'],
    [servicePath, serviceSource, 'async projectModels(query: MaterialProjectOptionsQueryDto)'],
    [servicePath, serviceSource, 'testFixturePrefixes'],
    [servicePath, serviceSource, 'MAT-STABLE'],
    [servicePath, serviceSource, 'isDisabledTestFixtureMaterial'],
    [servicePath, serviceSource, 'isTestFixtureMaterial'],
    [servicePath, serviceSource, 'isArchivedTestFixtureCustomer'],
    [servicePath, serviceSource, "const includeTestFixtures = query.includeTestFixtures === 'true';"],
    [servicePath, serviceSource, 'const visibleOrderLines = includeTestFixtures'],
    [servicePath, serviceSource, '!this.hasTestFixturePrefix(line.partCode, line.partName, line.projectModel, line.order.orderNo)'],
    [servicePath, serviceSource, "!this.hasTestFixturePrefix(item.projectModel) && !this.isArchivedTestFixtureCustomer(item.customer)"],
    [servicePath, serviceSource, '!this.hasTestFixturePrefix(line.bom.bomName, line.bom.projectModel)'],
    [servicePath, serviceSource, 'const visibleApplicabilities = includeTestFixtures ? applicabilities : applicabilities.filter'],
    [servicePath, serviceSource, 'const visibleBoms = includeTestFixtures'],
    [servicePath, serviceSource, 'const scopeText = await this.dashboardExportScopeText(query, summary.totalCount);'],
    [servicePath, serviceSource, "workbook.addWorksheet('零件控制面板'"],
    [servicePath, serviceSource, '零件管理导出只导出现有筛选结果，不写入零件、BOM、订单、生产任务或库存流水。'],
    [servicePath, serviceSource, 'private async dashboardExportScopeText'],
    [servicePath, serviceSource, 'dashboardExportCustomerLabel'],
    [servicePath, serviceSource, 'dashboardExportStockAlertFilterLabel'],
    [servicePath, serviceSource, 'dashboardExportDateRangeLabel'],
    [servicePath, serviceSource, 'dashboardExportDrawingReviewText'],
    [servicePath, serviceSource, 'dashboardExportBomReviewText'],
    [servicePath, serviceSource, 'dashboardExportBomStructureText'],
    [servicePath, serviceSource, 'dashboardExportBomStructureDetailText'],
    [servicePath, serviceSource, 'private dashboardExportCustomerScopeText(row: Record<string, any>)'],
    [servicePath, serviceSource, '仅订单历史 ${preview} 等 ${historyCount} 个客户'],
    [servicePath, serviceSource, 'dashboardExportInventoryReviewText'],
    [servicePath, serviceSource, 'dashboardExportProcessRouteText(row.defaultProcessRoute)'],
    [servicePath, serviceSource, 'private dashboardExportProcessRouteText(value?: string | null)'],
    [servicePath, serviceSource, '等 ${steps.length} 个工序'],
    [servicePath, serviceSource, "private joinDashboardExportValues(values: Array<string | null | undefined>, emptyText = '-', limit = 10, unitLabel = '项', totalCount?: number)"],
    [servicePath, serviceSource, 'private dashboardBomNameValues(row: Record<string, any>)'],
    [servicePath, serviceSource, 'private dashboardRowHasBom(row: Record<string, any>)'],
    [servicePath, serviceSource, 'this.dashboardBomNameValues(row).length > 0'],
    [servicePath, serviceSource, 'Boolean(row.bomStructureLabels?.length)'],
    [servicePath, serviceSource, 'withBomCount: allRows.filter((row) => this.dashboardRowHasBom(row)).length'],
    [servicePath, serviceSource, "this.compareDashboardNumber(this.dashboardRowHasBom(a) ? 1 : 0, this.dashboardRowHasBom(b) ? 1 : 0, sortOrder)"],
    [servicePath, serviceSource, "return bomPresence === 'WITH_BOM' ? this.dashboardRowHasBom(row) : !this.dashboardRowHasBom(row);"],
    [servicePath, serviceSource, 'const displayCount = Math.max(Number(totalCount || 0), filtered.length);'],
    [servicePath, serviceSource, "return displayCount > filtered.length || filtered.length > limit ? `${preview} 等 ${displayCount} 个${unitLabel}` : preview;"],
    [servicePath, serviceSource, 'this.dashboardExportCustomerScopeText(row)'],
    [servicePath, serviceSource, "this.joinDashboardExportValues(this.dashboardBomNameValues(row), '', 10, 'BOM', row.bomNameCount)"],
    [servicePath, serviceSource, 'this.dashboardExportBomStructureText(row)'],
    [servicePath, serviceSource, 'Number(row.bomStructureDetailCount || 0) > 0'],
    [servicePath, serviceSource, 'const projectCount = Math.max(Number(row.projectModelCount || 0)'],
    [servicePath, serviceSource, '库存核对列只提示人工复核，不自动补单、提交生产、扣库存或写入 InventoryTransaction。'],
    [servicePath, serviceSource, "if (stockAlert === 'ALL')"],
    [servicePath, serviceSource, "status && status !== 'ALL' ? { status } : {}"],
    [apiPath, apiSource, 'downloadMaterialDashboardExport'],
    [apiPath, apiSource, '/materials/dashboard/export'],
    [apiPath, apiSource, 'materialProjectModels(customerId?: string, includeTestFixtures = false)'],
    [apiPath, apiSource, "status?: CommonStatus | 'ALL';"],
    [apiPath, apiSource, 'includeTestFixtures?: boolean;'],
    [apiPath, apiSource, "includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined"],
    [dashboardViewPath, dashboardViewSource, 'exportDashboardExcel'],
    [dashboardViewPath, dashboardViewSource, 'dashboardRequestFilters(false)'],
    [dashboardViewPath, dashboardViewSource, '零件管理控制面板_${formatFileDateTime()}.xlsx'],
    [packagePath, packageSource, 'verify:material-dashboard-export-api'],
    [packagePath, packageSource, 'verify:statistics-api'],
    [regressionPath, regressionSource, 'material-dashboard-read-only'],
    [regressionPath, regressionSource, 'material-dashboard-stock-alert-all'],
    [regressionPath, regressionSource, 'material-dashboard-status-all'],
    [regressionPath, regressionSource, 'material-dashboard-test-fixture-filter'],
    [regressionPath, regressionSource, 'material-dashboard-export-test-fixture-filter'],
    [regressionPath, regressionSource, 'material-project-models-test-fixture-filter'],
    [regressionPath, regressionSource, 'material-common-project-models-test-fixture-filter'],
    [regressionPath, regressionSource, 'assertDashboardTestFixtureFilter'],
    [regressionPath, regressionSource, 'assertProjectModelsTestFixtureFilter'],
    [regressionPath, regressionSource, 'assertCommonProjectModelsTestFixtureFilter'],
    [regressionPath, regressionSource, 'MAT-STABLE'],
    [regressionPath, regressionSource, 'material dashboard default list must hide reusable test fixture materials/customers/BOMs'],
    [regressionPath, regressionSource, 'includeTestFixtures=true must not reduce material dashboard default results'],
    [regressionPath, regressionSource, 'includeTestFixtures=true'],
    [regressionPath, regressionSource, 'worksheetTextHasTestFixturePrefix'],
    [regressionPath, regressionSource, 'const dashboardListLimit = 200;'],
    [regressionPath, regressionSource, 'limit=${dashboardListLimit}'],
    [regressionPath, regressionSource, 'assertDashboardBomPreviewContractReadOnly'],
    [regressionPath, regressionSource, 'checkedTruncatedBomNamePreview'],
    [regressionPath, regressionSource, 'checkedTruncatedBomStructurePreview'],
    [regressionPath, regressionSource, 'assertDashboardBomStructureExportContractReadOnly'],
    [regressionPath, regressionSource, 'assertDashboardCustomerScopeExportContract'],
    [regressionPath, regressionSource, 'material-dashboard-bom-structure-export-summary'],
    [regressionPath, regressionSource, 'material-dashboard-customer-scope-export-summary'],
    [regressionPath, regressionSource, "allScopeText === '全部客户'"],
    [regressionPath, regressionSource, "historyScopeText.startsWith('仅订单历史')"],
    [regressionPath, regressionSource, "structureText.includes(sourceRow.bomNames[0])"],
    [regressionPath, regressionSource, "!reviewText.includes('结构待核对')"],
    [regressionPath, regressionSource, 'assertDashboardPreviewContract'],
    [regressionPath, regressionSource, 'details.length <= 10'],
    [regressionPath, regressionSource, 'bomStructureDetailCount >= details.length'],
    [regressionPath, regressionSource, 'currentScopeBomLineCount'],
    [regressionPath, regressionSource, 'material-dashboard-bom-preview-limit'],
    [regressionPath, regressionSource, 'material-dashboard-customer-preview-limit'],
    [regressionPath, regressionSource, 'material-dashboard-all-customer-scope-summary'],
    [regressionPath, regressionSource, 'material-dashboard-all-customer-scope-common-type'],
    [regressionPath, regressionSource, 'material-dashboard-all-customer-scope-history-separation'],
    [regressionPath, regressionSource, 'material-dashboard-order-history-scope-separation'],
    [regressionPath, regressionSource, 'material-dashboard-scope-type-filter-common'],
    [regressionPath, regressionSource, 'material-dashboard-scope-type-filter-custom'],
    [regressionPath, regressionSource, 'material-dashboard-current-scope-bom-context'],
    [regressionPath, regressionSource, 'material-dashboard-all-project-scope-summary'],
    [regressionPath, regressionSource, 'material-dashboard-history-customer-preview-limit'],
    [regressionPath, regressionSource, 'material-dashboard-project-model-preview-limit'],
    [regressionPath, regressionSource, 'customerNames.length <= 20'],
    [regressionPath, regressionSource, 'customerNameCount >= customerNames.length'],
    [regressionPath, regressionSource, "row.customerScopeKind === 'ALL'"],
    [regressionPath, regressionSource, 'customerNames.length === 0'],
    [regressionPath, regressionSource, 'row.customerNameCount === 0'],
    [regressionPath, regressionSource, 'row.hasGlobalCustomerScope === true'],
    [regressionPath, regressionSource, "row.scopeType === 'COMMON'"],
    [regressionPath, regressionSource, "row.partType === '通用件'"],
    [regressionPath, regressionSource, 'allCustomerScopeRowCount > 0'],
    [regressionPath, regressionSource, 'allCustomerScopeHistoryRowCount > 0'],
    [regressionPath, regressionSource, 'orderHistoryScopeRowCount > 0'],
    [regressionPath, regressionSource, "row.customerScopeKind === 'ORDER_HISTORY'"],
    [regressionPath, regressionSource, 'scopeType=COMMON must only return COMMON rows'],
    [regressionPath, regressionSource, 'scopeType=CUSTOM must not include'],
    [regressionPath, regressionSource, 'currentScopeBomLineCount > 0'],
    [regressionPath, regressionSource, "row.partCode === 'P-1001'"],
    [regressionPath, regressionSource, 'allProjectScopeRowCount > 0'],
    [regressionPath, regressionSource, 'projectModels.length === 0'],
    [regressionPath, regressionSource, 'row.projectModelCount === 0'],
    [regressionPath, regressionSource, 'projectModels.length <= 20'],
    [regressionPath, regressionSource, 'projectModelCount >= projectModels.length'],
    [regressionPath, regressionSource, 'historyProjectModels.length <= 20'],
    [regressionPath, regressionSource, 'historyProjectModelCount >= historyProjectModels.length'],
    [regressionPath, regressionSource, 'ORDER_HISTORY scope must not expand historical projectModels as formal scope'],
    [regressionPath, regressionSource, 'material-dashboard-bom-name-preview-limit'],
    [regressionPath, regressionSource, 'material-dashboard-bom-name-real-total'],
    [regressionPath, regressionSource, 'material-dashboard-bom-structure-real-total'],
    [regressionPath, regressionSource, 'historyCustomerNames.length <= 20'],
    [regressionPath, regressionSource, 'historyCustomerCount >= historyCustomerNames.length'],
    [regressionPath, regressionSource, 'bomNames.length <= 20'],
    [regressionPath, regressionSource, 'bomNameCount >= bomNames.length'],
    [regressionPath, regressionSource, 'material-dashboard-current-scope-bom-count'],
    [regressionPath, regressionSource, 'material-dashboard-export-xlsx'],
    [regressionPath, regressionSource, 'material-dashboard-export-review-columns'],
    [regressionPath, regressionSource, 'material-dashboard-export-status-column'],
    [regressionPath, regressionSource, '图纸日期：2026-01-01 至 2026-12-31'],
    [regressionPath, regressionSource, '最近下单日期：2026-01-01 至 2026-12-31'],
    [regressionPath, regressionSource, '库存报警：全部'],
    [regressionPath, regressionSource, 'status=ALL'],
    [regressionPath, regressionSource, '状态：全部'],
    [regressionPath, regressionSource, 'ExcelJS.Workbook']
  ];

  for (const [projectPath, source, snippet] of requiredSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`${projectPath} must keep material dashboard export snippet: ${snippet}`);
    }
  }
  for (const forbidden of [
    "const { PrismaClient } = require('@prisma/client');",
    'new PrismaClient()',
    'prisma.materialCommonProjectModel.updateMany',
    'prisma.materialCommonProjectModel.upsert',
    'prisma.modelBomLine.updateMany',
    'prisma.modelBom.updateMany',
    'prisma.material.updateMany',
    'prisma.material.upsert',
    'prisma.modelBom.upsert',
    'prisma.modelBomLine.create',
    'prisma.modelBomLine.deleteMany',
    'prisma.modelBom.deleteMany',
    'prisma.material.deleteMany',
    'prisma.materialCommonProjectModel.deleteMany',
    'cleanupDashboardBomPreviewData',
    'createDashboardBomPreviewData',
    'seedCommonProjectModelFixture'
  ]) {
    if (regressionSource.includes(forbidden)) {
      addFailure(`Material dashboard export regression must stay read-only and not write verification data: ${forbidden}`);
    }
  }
  if (serviceSource.includes('return filtered.length > 0 ? [...new Set(filtered)].join')) {
    addFailure('MaterialsService material dashboard export must summarize long customer/BOM/project lists instead of writing full joined values.');
  }
  if (serviceSource.includes('row.defaultProcessRoute || \'\'')) {
    addFailure('MaterialsService material dashboard export must summarize default process route text instead of exporting the full route.');
  }
  if (
    serviceSource.includes('row.bomNames.length > 0') ||
    serviceSource.includes('row.bomNames.length === 0')
  ) {
    addFailure('MaterialsService material dashboard BOM presence must use dashboardRowHasBom so BOM structure details are not misclassified.');
  }
  if (/dashboardExportBomReviewText[\s\S]*?if \(!row\.bomStructureLabels\?\.length\)/.test(serviceSource)) {
    addFailure('MaterialsService material dashboard BOM export review must use bomStructureDetailCount-aware summary instead of only checking bomStructureLabels.');
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
    'commonProjectModelFixtureWhere',
    "const includeTestFixtures = query.includeTestFixtures === 'true';",
    'NOT: this.commonProjectModelFixtureWhere()',
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
  const controllerSource = readFile('backend/src/modules/materials/materials.controller.ts');
  if (!controllerSource.includes('commonProjectModels(@Query() query: MaterialProjectOptionsQueryDto)')) {
    addFailure('MaterialsController common-project-models must accept query filters so reusable test fixtures stay opt-in.');
  }
  const apiSource = readFile('frontend/src/api/erp.ts');
  if (!apiSource.includes('materialCommonProjectModels(includeTestFixtures = false)')) {
    addFailure('frontend erpApi.materialCommonProjectModels must keep includeTestFixtures default false for regression scripts.');
  }
  const dashboardSource = readFile('frontend/src/views/MaterialsManagementView.vue');
  if (/commonProjectStorageKey|saveCommonProjectModelsToCache|本机缓存/.test(dashboardSource)) {
    addFailure('MaterialsManagementView.vue must not store common project model business configuration in browser localStorage.');
  }
  const commonProjectLocalStorageWindow = dashboardSource.match(/commonProject[\s\S]{0,240}localStorage|localStorage[\s\S]{0,240}commonProject/);
  if (commonProjectLocalStorageWindow) {
    addFailure('MaterialsManagementView.vue must not connect common project model business configuration to browser localStorage.');
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

function verifyFrontendSmokeWorkflow() {
  const packageSource = readFile('package.json');
  const smokePath = 'scripts/verify-frontend-smoke.cjs';
  if (!packageSource.includes('"verify:frontend-smoke": "node scripts/verify-frontend-smoke.cjs"')) {
    addFailure('package.json must expose verify:frontend-smoke for local frontend/runtime smoke checks.');
  }
  if (!fileExists(smokePath)) {
    addFailure(`Missing frontend smoke verification script: ${smokePath}`);
    return;
  }

  const smokeSource = readFile(smokePath);
  for (const snippet of [
    'fixturePrefixes',
    'function assertNoFixtureText',
    'function assertBusinessPage',
    'pageTotalCount',
    'pageItems',
    'should hide reusable test fixture prefix',
    'statistics/options should expose at least one selectable business year.',
    'customers business page',
    'orders business page',
    'materials dashboard business page',
    'inventory summary business page',
    'production tasks business page',
    'production order summaries business page',
    'warehouse transactions business page',
    'warehouse config business page'
  ]) {
    if (!smokeSource.includes(snippet)) {
      addFailure(`verify-frontend-smoke.cjs must keep live business data smoke snippet: ${snippet}`);
    }
  }
}

function verifyTestDataCleanupWorkflow() {
  const packageSource = readFile('package.json');
  const cleanupScriptPath = 'scripts/cleanup-test-data.cjs';
  if (!packageSource.includes('"cleanup:test-data": "node scripts/cleanup-test-data.cjs"')) {
    addFailure('package.json must expose cleanup:test-data for safe verification data cleanup.');
  }
  if (!packageSource.includes('"verify:test-data-cleanup": "node scripts/verify-test-data-cleanup.cjs"')) {
    addFailure('package.json must expose verify:test-data-cleanup for cleanup dry-run regression coverage.');
  }
  if (
    !packageSource.includes(
      'npm run backend:db:generate && npm run verify:prisma-client-enums && npm run verify:test-data-cleanup && npm run backend:verify:first-stage'
    )
  ) {
    addFailure('verify:first-stage scripts must generate Prisma Client, verify enums, then run cleanup dry-run before backend/API verification.');
  }
  if (!fileExists(cleanupScriptPath)) {
    addFailure(`Missing test data cleanup script: ${cleanupScriptPath}`);
    return;
  }
  const cleanupRegressionPath = 'scripts/verify-test-data-cleanup.cjs';
  if (!fileExists(cleanupRegressionPath)) {
    addFailure(`Missing test data cleanup regression script: ${cleanupRegressionPath}`);
  } else {
    const regressionSource = readFile(cleanupRegressionPath);
    const regressionRequiredSnippets = [
      'function runCleanupDryRun(args = [])',
      "execFileSync(process.execPath, [cleanupScriptPath, ...args]",
      "CLEANUP_TEST_DATA_PREVIEW_LIMIT: process.env.CLEANUP_TEST_DATA_PREVIEW_LIMIT || '2'",
      'Mode: dry-run only; no database rows are changed.',
      'Preview limit: 2',
      "runCleanupDryRun(['--preview-limit=1'])",
      'Preview limit: 1',
      'Expected project database:',
      'Known prefixes: VERIFY-, VERIFY_, COD-, MI-API-, MAT-STABLE, UPLOAD-FILENAME, CUST-SEARCH-, TEST-CUSTOMER',
      'Matched master records',
      '- MaterialCommonProjectModel:',
      'Matched common project model preview',
      'Soft-disable actions',
      'Warehouse ENABLED -> DISABLED',
      'WarehouseLocation ENABLED -> DISABLED',
      'Business records requiring manual review',
      'Cleanup recommendation',
      "!output.includes('cleanup:test-data applied.')",
      'verify:test-data-cleanup must only run cleanup:test-data dry-run, never apply changes.'
    ];
    for (const snippet of regressionRequiredSnippets) {
      if (!regressionSource.includes(snippet)) {
        addFailure(`verify-test-data-cleanup.cjs must keep cleanup dry-run safety regression snippet: ${snippet}`);
      }
    }
  }
  const source = readFile(cleanupScriptPath);
  const requiredSnippets = [
    "const knownPrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];",
    'cleanup:test-data dry run. Pass --apply',
    'const previewLimit = resolvePreviewLimit();',
    'function cliArgValue(name)',
    "cliArgValue('--preview-limit') ?? process.env.CLEANUP_TEST_DATA_PREVIEW_LIMIT ?? '8'",
    'Number.isFinite(parsedValue) && parsedValue > 0 ? Math.max(Math.floor(parsedValue), 1) : 8',
    'function cleanupTargetSummary(databaseUrl = process.env.DATABASE_URL)',
    'return `${url.protocol}//${userText}:***@${hostText}/${databaseName}?schema=${schemaName} (${localText})`;',
    'function expectedCleanupTargetSummary()',
    "const expectedPort = process.env.POSTGRES_HOST_PORT || '55432';",
    "const expectedDb = process.env.POSTGRES_DB || 'baisheng_erp';",
    'function cleanupTargetMatchesProjectDatabase(databaseUrl = process.env.DATABASE_URL)',
    'function printCleanupTarget()',
    'Expected project database: ${expectedCleanupTargetSummary()}',
    'Mode: dry-run only; no database rows are changed.',
    'Preview limit: ${previewLimit}',
    'function printRecordPreview(title, rows, formatter, totalCount = rows.length)',
    'function printBlockingRecordPreviews(previews)',
    'const activeBusinessCount = (label) => activeBusinessData.find((row) => row.label === label)?.count || 0;',
    'Matched customer preview',
    'Matched material preview',
    'Matched BOM preview',
    'Matched common project model preview',
    'Customer identity archive preview',
    'CustomerOrder not CANCELLED preview',
    'ProductionTask not CANCELLED/STORED preview',
    'ProductionNotice PENDING preview',
    'InventoryReservation ACTIVE preview',
    'InventoryBatch AVAILABLE/RESERVED preview',
    'function archivedCustomerIdentity(value, customerId)',
    'async function archiveCustomerIdentities(customers)',
    'function isLocalCleanupDatabaseUrl(databaseUrl = process.env.DATABASE_URL)',
    "host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'",
    'function assertCleanupApplyAllowed()',
    "const cleanupConfirmed = process.env.CLEANUP_TEST_DATA_CONFIRMED === 'true';",
    "const allowTestDataCleanup = process.env.ALLOW_TEST_DATA_CLEANUP === 'true';",
    'cleanupTargetMatchesProjectDatabase()',
    'cleanup:test-data --apply is blocked',
    'Default apply is only allowed for the current project database',
    'assertCleanupApplyAllowed();',
    'function numericCount(row)',
    'function sumCounts(rows)',
    'function printCleanupRecommendation(masterCleanupResults, activeBusinessData)',
    'function assertNoActiveBusinessDataForApply(activeBusinessData)',
    'cleanup:test-data --apply is blocked because matching business records require manual review first',
    'assertNoActiveBusinessDataForApply(activeBusinessData);',
    'function startsWithKnownPrefixAny(fields)',
    "where: { OR: startsWithKnownPrefixAny(['customerCode', 'customerName']) }",
    'Pending soft-clean actions',
    'Next step: run npm run cleanup:test-data -- --apply when the target database is confirmed.',
    'printCleanupRecommendation(masterCleanupResults, activeBusinessData);',
    'function statusCounts(rows)',
    'statusSummary(statusCounts(testCustomers))',
    'statusSummary(statusCounts(testCommonProjectModels))',
    'const testCommonProjectModels = await prisma.materialCommonProjectModel.findMany',
    'Customer ENABLED -> DISABLED',
    "status: 'DISABLED', isPrimary: false",
    'Customer identity -> archived disabled key',
    'customerCode: archivedCustomerIdentity(customer.customerCode, customer.id)',
    'customerName: archivedCustomerIdentity(customer.customerName, customer.id)',
    'Material ENABLED -> DISABLED',
    'Material test defaultProcessRoute -> NULL',
    '{ id: { in: materialIds }, defaultProcessRoute: { not: null } }',
    "status: 'DISABLED', isDefault: false",
    'ModelBom ENABLED -> DISABLED',
    'ModelBomScopeApprovalRequest PENDING/APPROVED/REJECTED -> USED',
    "'modelBomScopeApprovalRequest'",
    "status: { in: ['PENDING', 'APPROVED', 'REJECTED'] }",
    'usedAt: now',
    'Warehouse ENABLED -> DISABLED',
    'WarehouseLocation ENABLED -> DISABLED',
    "{ OR: [{ warehouseId: { in: warehouseIds } }, ...startsWithKnownPrefix('locationCode')], status: 'ENABLED' }",
    'statusSummary(statusCounts(testWarehouses))',
    'Business records requiring manual review',
    'InventoryBatch AVAILABLE/RESERVED',
    'printBlockingRecordPreviews(activeBusinessPreviews);',
    "...startsWithKnownPrefix('sourceOrderNo')",
    "...startsWithKnownPrefix('sourceProductionTaskNo')",
    'prisma.$disconnect()'
  ];
  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      addFailure(`cleanup-test-data.cjs must keep safe dry-run and soft-disable snippet: ${snippet}`);
    }
  }
  const businessBlockIndex = source.indexOf('assertNoActiveBusinessDataForApply(activeBusinessData);');
  const masterCleanupIndex = source.indexOf('const masterCleanupResults');
  const firstCleanupMutationIndex = source.indexOf('await updateMany(');
  if (businessBlockIndex < 0 || masterCleanupIndex < 0 || firstCleanupMutationIndex < 0) {
    addFailure('cleanup-test-data.cjs must keep explicit business-record blocking before soft-clean mutations.');
  } else if (!(businessBlockIndex < masterCleanupIndex && businessBlockIndex < firstCleanupMutationIndex)) {
    addFailure('cleanup-test-data.cjs must call assertNoActiveBusinessDataForApply before constructing or applying soft-clean mutations.');
  }
  const knownPrefixLine = source.split(/\r?\n/).find((line) => line.includes('const knownPrefixes')) || '';
  const cleanupPrefixes = [...knownPrefixLine.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const detectedTestPrefixes = new Set();
  const scriptDir = resolveProjectPath('scripts');
  for (const scriptName of fs.readdirSync(scriptDir).filter((name) => name.endsWith('.cjs'))) {
    const scriptSource = readFile(`scripts/${scriptName}`);
    for (const match of scriptSource.matchAll(/[`'"]([^`'"]*(?:VERIFY|COD-|MI-API|MAT-STABLE|UPLOAD-FILENAME|CUST-SEARCH|TEST-CUSTOMER)[^`'"]*)[`'"]/g)) {
      const prefixMatch = match[1].match(/^(VERIFY[-_]|COD-|MI-API-|MAT-STABLE|UPLOAD-FILENAME|CUST-SEARCH-|TEST-CUSTOMER)/);
      if (prefixMatch) {
        detectedTestPrefixes.add(prefixMatch[1]);
      }
    }
  }
  for (const prefix of detectedTestPrefixes) {
    if (!cleanupPrefixes.some((cleanupPrefix) => prefix.startsWith(cleanupPrefix))) {
      addFailure(`cleanup-test-data.cjs knownPrefixes must cover regression test prefix: ${prefix}`);
    }
  }
  const readmeSource = fileExists('README.md') ? readFile('README.md') : '';
  const agentsSource = fileExists('AGENTS.md') ? readFile('AGENTS.md') : '';
  for (const snippet of [
    'npm run cleanup:test-data -- --apply',
    '--preview-limit=20',
    '当前项目 PostgreSQL 目标库',
    'CLEANUP_TEST_DATA_CONFIRMED=true',
    'ALLOW_TEST_DATA_CLEANUP=true',
    '未取消订单',
    '有效库存预占'
  ]) {
    if (!readmeSource.includes(snippet)) {
      addFailure(`README.md must document cleanup:test-data apply safety snippet: ${snippet}`);
    }
  }
  for (const snippet of [
    'cleanup:test-data -- --apply',
    '--preview-limit=20',
    '当前项目 PostgreSQL 目标库',
    'CLEANUP_TEST_DATA_CONFIRMED=true',
    'ALLOW_TEST_DATA_CLEANUP=true',
    '未取消订单',
    '有效库存预占'
  ]) {
    if (!agentsSource.includes(snippet)) {
      addFailure(`AGENTS.md must document cleanup:test-data apply safety snippet: ${snippet}`);
    }
  }
  for (const forbidden of ['customer.deleteMany', 'material.deleteMany', 'modelBom.deleteMany', 'inventoryBatch.updateMany({']) {
    if (source.includes(forbidden)) {
      addFailure(`cleanup-test-data.cjs must not physically delete or silently mutate inventory test records: ${forbidden}`);
    }
  }
}

function verifySeedResetSafetyWorkflow() {
  const seedSource = readFile('database/prisma/seed.ts');
  const dockerDbSource = readFile('scripts/docker-db.cjs');
  const readmeSource = readFile('README.md');
  const agentsSource = readFile('AGENTS.md');
  const seedSnippets = [
    'function isLocalSeedDatabaseUrl(databaseUrl = process.env.DATABASE_URL)',
    "host === 'localhost' || host === '127.0.0.1' || host === '::1'",
    "const backupConfirmed = process.env.SEED_BACKUP_CONFIRMED === 'true';",
    'allowDestructiveSeed || backupConfirmed || (!isProduction && isLocalSeedDatabaseUrl())',
    'run npm run docker:db:seed so backup confirmation is passed'
  ];
  for (const snippet of seedSnippets) {
    if (!seedSource.includes(snippet)) {
      addFailure(`database/prisma/seed.ts must keep seed reset safety guard snippet: ${snippet}`);
    }
  }
  if (!dockerDbSource.includes("'env', 'SEED_BACKUP_CONFIRMED=true', 'npm', 'run', 'db:seed'")) {
    addFailure('scripts/docker-db.cjs seed command must pass SEED_BACKUP_CONFIRMED=true after creating and verifying a backup.');
  }
  if (dockerDbSource.includes("'backend', 'npm', 'run', 'db:seed'")) {
    addFailure('scripts/docker-db.cjs must not run db:seed without SEED_BACKUP_CONFIRMED=true.');
  }
  for (const sourceContract of [
    { label: 'README.md', source: readmeSource },
    { label: 'AGENTS.md', source: agentsSource }
  ]) {
    for (const snippet of ['SEED_BACKUP_CONFIRMED=true', 'localhost', '127.0.0.1', '::1']) {
      if (!sourceContract.source.includes(snippet)) {
        addFailure(`${sourceContract.label} must document seed reset guard snippet: ${snippet}`);
      }
    }
  }
}

function verifyProjectProgressWorkflow() {
  const packageSource = readFile('package.json');
  const readmeSource = readFile('README.md');
  const agentsSource = readFile('AGENTS.md');
  const progressPath = 'scripts/project-progress.cjs';
  if (!packageSource.includes('"project:progress": "node scripts/project-progress.cjs"')) {
    addFailure('package.json must expose project:progress for repeatable P0-P5 progress reporting.');
  }
  if (!fileExists(progressPath)) {
    addFailure(`Missing project progress script: ${progressPath}`);
    return;
  }

  const progressSource = readFile(progressPath);
  const requiredSnippets = [
    'P0',
    'P1',
    'P2',
    'P3',
    'P4',
    'P5',
    'overallPercent',
    'Progress is calculated from first-stage source checklist coverage',
    '百胜 ERP v0.2 第一阶段源码进度',
    '--json',
    'scripts/cleanup-test-data.cjs',
    'frontend/src/views/MaterialsManagementView.vue',
    'database/prisma/schema.prisma',
    'scripts/verify-order-import-api.cjs',
    'scripts/verify-material-drawing-revisions-export-api.cjs',
    'scripts/verify-docker-runtime.cjs',
    'project runtime uniqueness',
    'Current project should use exactly one PostgreSQL container',
    'frontend/src/views/WarehouseView.vue'
  ];
  for (const snippet of requiredSnippets) {
    if (!progressSource.includes(snippet)) {
      addFailure(`project-progress.cjs must keep repeatable P0-P5 progress snippet: ${snippet}`);
    }
  }
  for (const sourceContract of [
    { label: 'README.md', source: readmeSource },
    { label: 'AGENTS.md', source: agentsSource }
  ]) {
    for (const snippet of ['npm run project:progress', '源码 checklist', '不等同于最终业务验收']) {
      if (!sourceContract.source.includes(snippet)) {
        addFailure(`${sourceContract.label} must document project:progress tracking boundary snippet: ${snippet}`);
      }
    }
  }
}

function verifyNoLegacyProcessTemplateFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const legacyCallPattern = /erpApi\.processTemplates\s*\(/g;
    for (const match of source.matchAll(legacyCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use processTemplatesPage pagination instead of legacy erpApi.processTemplates full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/processTemplates\s*\(\s*keyword\?:\s*string/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy processTemplates(keyword, status) full-list API; use processTemplatesPage only.');
  }
  const frontendTemplateManagerSource = readFile('frontend/src/components/ProcessTemplateManager.vue');
  for (const snippet of ['templatePagination', 'erpApi.processTemplatesPage', 'handleTemplatePageChange', 'reloadTemplatesFromFirstPage']) {
    if (!frontendTemplateManagerSource.includes(snippet)) {
      addFailure(`ProcessTemplateManager.vue must keep process template pagination snippet: ${snippet}`);
    }
  }
  const backendDtoSource = readFile('backend/src/modules/process-templates/dto.ts');
  for (const snippet of ['limit?: number', 'offset?: number', 'withPage?: string', 'includeTestFixtures?: string']) {
    if (!backendDtoSource.includes(snippet)) {
      addFailure(`ProcessTemplateQueryDto must keep explicit pagination field: ${snippet}`);
    }
  }
  const backendControllerSource = readFile('backend/src/modules/process-templates/process-templates.controller.ts');
  if (!backendControllerSource.includes("return this.processTemplatesService.findAll({ ...query, withPage: 'true' });")) {
    addFailure('ProcessTemplatesController public process template list must force paged responses.');
  }
  const regressionSource = readFile('scripts/verify-process-exports-api.cjs');
  if (!regressionSource.includes('process-templates-public-list-pagination')) {
    addFailure('scripts/verify-process-exports-api.cjs must verify public process template pagination.');
  }
  if (!regressionSource.includes('process-exports-read-only')) {
    addFailure('scripts/verify-process-exports-api.cjs must keep process export regression read-only.');
  }
  for (const forbidden of [
    "const { PrismaClient } = require('@prisma/client');",
    'new PrismaClient()',
    'ensureStableFixtures',
    'processDefinition.upsert',
    'processTemplate.upsert',
    'processDefinition.create',
    'processTemplate.create',
    'processDefinition.update',
    'processTemplate.update',
    'processDefinition.delete',
    'processTemplate.delete'
  ]) {
    if (regressionSource.includes(forbidden)) {
      addFailure(`scripts/verify-process-exports-api.cjs must be read-only and must not include: ${forbidden}`);
    }
  }
  const backendServiceSource = readFile('backend/src/modules/process-templates/process-templates.service.ts');
  const fixtureFilterSources = [frontendApiSource, backendDtoSource, backendServiceSource, regressionSource].join('\n');
  for (const snippet of [
    'PROCESS_TEMPLATE_TEST_FIXTURE_PREFIXES',
    'isProcessTemplateTestFixture',
    "query.includeTestFixtures === 'true'",
    "includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined",
    'process-templates-fixture-filter',
    'process-templates-export-fixture-filter'
  ]) {
    if (!fixtureFilterSources.includes(snippet)) {
      addFailure(`Process template list/export must keep reusable test-fixture filter snippet: ${snippet}`);
    }
  }
}

function verifyProcessDefinitionPaginationContract() {
  const frontendDefinitionManagerSource = readFile('frontend/src/components/ProcessDefinitionManager.vue');
  for (const snippet of ['definitionPagination', 'erpApi.processDefinitionsPage', 'handleDefinitionPageChange', 'reloadDefinitionsFromFirstPage']) {
    if (!frontendDefinitionManagerSource.includes(snippet)) {
      addFailure(`ProcessDefinitionManager.vue must keep process definition pagination snippet: ${snippet}`);
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  for (const snippet of [
    'processDefinitionsPage(filters: ProcessDefinitionFilters = {})',
    'return request<ProcessDefinitionListResponse>',
    'const result = await erpApi.processDefinitionsPage({ keyword, status, limit: pageLimit, offset });',
    'hasMore = result.hasMore && result.items.length > 0;'
  ]) {
    if (!frontendApiSource.includes(snippet)) {
      addFailure(`frontend/src/api/erp.ts must keep explicit process definition pagination helper snippet: ${snippet}`);
    }
  }
  const backendDtoSource = readFile('backend/src/modules/process-definitions/dto.ts');
  for (const snippet of ['limit?: number', 'offset?: number', 'withPage?: string', 'includeTestFixtures?: string']) {
    if (!backendDtoSource.includes(snippet)) {
      addFailure(`ProcessDefinitionQueryDto must keep explicit pagination field: ${snippet}`);
    }
  }
  const backendControllerSource = readFile('backend/src/modules/process-definitions/process-definitions.controller.ts');
  if (!backendControllerSource.includes("return this.processDefinitionsService.findAll({ ...query, withPage: 'true' });")) {
    addFailure('ProcessDefinitionsController public process definition list must force paged responses.');
  }
  const regressionSource = readFile('scripts/verify-process-exports-api.cjs');
  if (!regressionSource.includes('process-definitions-public-list-pagination')) {
    addFailure('scripts/verify-process-exports-api.cjs must verify public process definition pagination.');
  }
  const backendServiceSource = readFile('backend/src/modules/process-definitions/process-definitions.service.ts');
  const fixtureFilterSources = [frontendApiSource, backendDtoSource, backendServiceSource, regressionSource].join('\n');
  for (const snippet of [
    'PROCESS_DEFINITION_TEST_FIXTURE_PREFIXES',
    'isProcessDefinitionTestFixture',
    "query.includeTestFixtures === 'true'",
    "includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined",
    'process-definitions-fixture-filter',
    'process-definitions-export-fixture-filter'
  ]) {
    if (!fixtureFilterSources.includes(snippet)) {
      addFailure(`Process definition list/export must keep reusable test-fixture filter snippet: ${snippet}`);
    }
  }
}

function verifyNoLegacyModelBomFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const legacyCallPattern = /erpApi\.modelBoms\s*\(/g;
    for (const match of source.matchAll(legacyCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use modelBomsPage pagination instead of legacy erpApi.modelBoms full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/modelBoms\s*\(\s*filters\s*:\s*ModelBomFilters/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy modelBoms(filters) full-list API; use modelBomsPage only.');
  }
  const modelBomExportRegressionSource = readFile('scripts/verify-model-boms-export-api.cjs');
  if (!modelBomExportRegressionSource.includes('model-boms-public-list-pagination')) {
    addFailure('scripts/verify-model-boms-export-api.cjs must verify public model BOM list pagination.');
  }
  const inventoryServiceSource = readFile('backend/src/modules/inventory/inventory.service.ts');
  const inventoryDtoSource = readFile('backend/src/modules/inventory/dto.ts');
  const modelBomFixtureFilterSources = [frontendApiSource, inventoryServiceSource, inventoryDtoSource, modelBomExportRegressionSource].join('\n');
  for (const snippet of [
    'includeTestFixtures?: string',
    "const includeTestFixtures = query.includeTestFixtures === 'true';",
    'isDisabledTestFixtureModelBom',
    "includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined",
    'model-boms-test-fixture-filter',
    'model-boms-export-test-fixture-filter'
  ]) {
    if (!modelBomFixtureFilterSources.includes(snippet)) {
      addFailure(`Model BOM list/export must keep disabled test-fixture opt-in filter snippet: ${snippet}`);
    }
  }
  for (const snippet of [
    'model-boms-list-customer-scope-preview',
    'model-boms-list-line-summary',
    'model-boms-detail-full-customer-scope',
    'model-boms-detail-full-lines',
    'scopeCustomerCount >= listedBom.scopeCustomers.length',
    'listedBom.lines.length === 0',
    'listedBom.lineSummary'
  ]) {
    if (!modelBomExportRegressionSource.includes(snippet)) {
      addFailure(`scripts/verify-model-boms-export-api.cjs must verify model BOM customer-scope preview contract: ${snippet}`);
    }
  }
  const modelBomDiffReviewExportRegressionSource = readFile('scripts/verify-model-bom-diff-reviews-export-api.cjs');
  const modelBomDiffReviewReadOnlySnippets = [
    'model-bom-diff-reviews-read-only',
    'async function findSourceBasedBom()',
    'sourceBomId',
    'assertDiffReviewPage(reviewList, 10, 0)',
    'assertDiffReviewPage(defaultList, 10, 0)',
    'model-bom-diff-reviews-public-list-pagination',
    'model-bom-diff-reviews-public-list-default-pagination',
    'model-bom-diff-reviews-list-review-keys',
    'model-bom-diff-reviews-list-no-maintenance-timestamps',
    "Object.prototype.hasOwnProperty.call(review, 'createdAt')",
    "Object.prototype.hasOwnProperty.call(review, 'updatedAt')",
    "review.status === 'ENABLED'",
    'model-bom-diff-reviews-export-xlsx',
    'model-bom-diff-reviews-export-scope',
    'model-bom-diff-reviews-export-columns',
    '当前 BOM 没有已确认的来源差异核对记录'
  ];
  for (const snippet of modelBomDiffReviewReadOnlySnippets) {
    if (!modelBomDiffReviewExportRegressionSource.includes(snippet)) {
      addFailure(`scripts/verify-model-bom-diff-reviews-export-api.cjs must verify diff review list/export read-only contract: ${snippet}`);
    }
  }
  const modelBomDiffReviewForbiddenSnippets = [
    "const { PrismaClient } = require('@prisma/client');",
    'new PrismaClient()',
    "method: 'POST'",
    "method: 'DELETE'",
    "const partCode = 'VERIFY-BOM-DIFF-STABLE';",
    "const customerCode = 'VERIFY-BOM-DIFF-CUST-STABLE';",
    "const sourceBomName = 'VERIFY-BOM-DIFF-SOURCE-STABLE';",
    "const targetBomName = 'VERIFY-BOM-DIFF-TARGET-STABLE';",
    'prepareStableVerificationData',
    'cleanupStableVerificationData',
    'prisma.material.upsert',
    'prisma.customer.create',
    'prisma.customer.update',
    'prisma.customerContact.updateMany',
    'prisma.modelBom.upsert',
    'prisma.modelBomLine.create',
    'prisma.modelBomDiffReview.updateMany',
    'prisma.modelBomLine.updateMany',
    'prisma.modelBom.updateMany',
    'prisma.material.updateMany'
  ];
  for (const snippet of modelBomDiffReviewForbiddenSnippets) {
    if (modelBomDiffReviewExportRegressionSource.includes(snippet)) {
      addFailure(`scripts/verify-model-bom-diff-reviews-export-api.cjs must stay read-only and must not include: ${snippet}`);
    }
  }
  if (modelBomDiffReviewExportRegressionSource.includes('new Date().toISOString().replace')) {
    addFailure('scripts/verify-model-bom-diff-reviews-export-api.cjs must not create timestamped verification records.');
  }
}

function verifyNoLegacyInventoryBatchFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const legacyCallPattern = /erpApi\.inventory\s*\(/g;
    for (const match of source.matchAll(legacyCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use inventoryPage pagination instead of legacy erpApi.inventory full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/inventory\s*\(\s*filters\s*:\s*InventoryFilters/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy inventory(filters) full-list API; use inventoryPage only.');
  }
  const inventoryControllerSource = readFile('backend/src/modules/inventory/inventory.controller.ts');
  if (!inventoryControllerSource.includes("return this.inventoryService.findAll({ ...query, withPage: 'true' });")) {
    addFailure('InventoryController public inventory batch list must force paged responses.');
  }
  const inventorySummaryRegressionSource = readFile('scripts/verify-inventory-summary-api.cjs');
  if (!inventorySummaryRegressionSource.includes('inventory-batch-public-list-pagination')) {
    addFailure('scripts/verify-inventory-summary-api.cjs must verify public inventory batch pagination.');
  }
  const inventorySource = readFile('backend/src/modules/inventory/inventory.service.ts');
  const inventoryDtoSource = readFile('backend/src/modules/inventory/dto.ts');
  const inventoryFrontendApiSource = readFile('frontend/src/api/erp.ts');
  const inventoryFixtureFilterSources = [inventorySource, inventoryDtoSource, inventoryFrontendApiSource, inventorySummaryRegressionSource].join('\n');
  for (const snippet of [
    'includeTestFixtures?: string',
    'includeTestFixtures?: boolean',
    "const includeTestFixtures = query.includeTestFixtures === 'true';",
    'MAT-STABLE',
    'isTestFixtureInventoryBatch',
    'inventoryBatchFixtureWhere',
    'inventoryTransactionFixtureWhere',
    'buildInventoryOutTransactionWhere',
    'where.NOT = this.inventoryTransactionFixtureWhere();',
    'visibleBatches',
    'visibleRawBatches',
    'inventory-summary-test-fixture-filter'
  ]) {
    if (!inventoryFixtureFilterSources.includes(snippet)) {
      addFailure(`Inventory summary/list must keep reusable test-fixture filter snippet: ${snippet}`);
    }
  }
  for (const snippet of [
    'inventory-summary-read-only',
    'assertSummaryRowRelationships',
    'row.normalOrderStockQuantity + row.cancelledOrderStockQuantity + row.customerChangeStockQuantity',
    'row.orderInventoryQuantity + row.stockInventoryQuantity',
    'findSummaryRowForSourceDetails',
    'inventory-summary-source-split-read-only',
    'inventory-summary-active-reservation-read-only',
    'inventory-source-details-test-fixture-filter'
  ]) {
    if (!inventorySummaryRegressionSource.includes(snippet)) {
      addFailure(`scripts/verify-inventory-summary-api.cjs must keep read-only inventory summary regression snippet: ${snippet}`);
    }
  }
  for (const forbiddenSnippet of [
    "const { PrismaClient } = require('@prisma/client');",
    'new PrismaClient()',
    "const testPrefix = 'COD-INV-SUM-STABLE';",
    'cleanupDatabase',
    'seedInventorySummaryRows',
    'prisma.material.upsert',
    'prisma.inventoryBatch.create',
    'prisma.inventoryBatch.createMany',
    'prisma.inventoryReservation.create',
    'prisma.customer.create',
    'prisma.customer.update',
    'prisma.warehouse.upsert',
    'deleteMany',
    'updateMany',
    'function localDateTimeStamp'
  ]) {
    if (inventorySummaryRegressionSource.includes(forbiddenSnippet)) {
      addFailure(`scripts/verify-inventory-summary-api.cjs must stay read-only and not write inventory summary verification data: ${forbiddenSnippet}`);
    }
  }
}

function verifyNoLegacyInventoryMaterialFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const legacyCallPattern = /erpApi\.inventoryMaterials\s*\(/g;
    for (const match of source.matchAll(legacyCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use inventoryMaterialsPage, inventoryMaterialsAllPages, or inventoryMaterialByPartCode instead of legacy erpApi.inventoryMaterials full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/inventoryMaterials\s*\(\s*filters\s*:\s*MaterialMemoryFilters/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy inventoryMaterials(filters) full-list API; use explicit paged helpers only.');
  }
  const inventoryControllerSource = readFile('backend/src/modules/inventory/inventory.controller.ts');
  if (!inventoryControllerSource.includes("return this.inventoryService.materials({ ...query, withPage: 'true' });")) {
    addFailure('InventoryController public inventory materials list must force paged responses.');
  }
  const inventoryMaterialsRegressionSource = readFile('scripts/verify-inventory-materials-export-api.cjs');
  if (!inventoryMaterialsRegressionSource.includes('inventory-materials-public-list-pagination')) {
    addFailure('scripts/verify-inventory-materials-export-api.cjs must verify public inventory materials pagination.');
  }
  const inventoryServiceSource = readFile('backend/src/modules/inventory/inventory.service.ts');
  const inventoryDtoSource = readFile('backend/src/modules/inventory/dto.ts');
  const inventoryMaterialFixtureFilterSources = [frontendApiSource, inventoryServiceSource, inventoryDtoSource, inventoryMaterialsRegressionSource].join('\n');
  for (const snippet of [
    'includeTestFixtures?: string',
    'includeTestFixtures?: boolean',
    "const includeTestFixtures = query.includeTestFixtures === 'true';",
    'isTestFixtureMaterial',
    'MAT-STABLE',
    'visibleMaterialRows',
    "includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined",
    'inventory-materials-test-fixture-filter-read-only',
    'inventory-materials-export-test-fixture-filter-read-only',
    'inventory-materials-scope-filter-read-only',
    'inventory-materials-export-scope-filter-read-only',
    'findScopeContext',
    '/materials/project-models?customerId=${encodeURIComponent(customerId)}',
    'scoped inventory materials export must match the scoped material list.'
  ]) {
    if (!inventoryMaterialFixtureFilterSources.includes(snippet)) {
      addFailure(`Inventory material list/export must keep disabled test-fixture opt-in filter snippet: ${snippet}`);
    }
  }
  for (const forbiddenSnippet of [
    "const { PrismaClient } = require('@prisma/client');",
    'prisma.material.upsert',
    'prisma.materialApplicability.upsert',
    'prisma.material.deleteMany',
    'prisma.customer.deleteMany',
    'seedMaterialFixture',
    'seedScopeFilterFixture',
    'cleanupScopeFilterFixture'
  ]) {
    if (inventoryMaterialsRegressionSource.includes(forbiddenSnippet)) {
      addFailure(`scripts/verify-inventory-materials-export-api.cjs must not write inventory material export verification data: ${forbiddenSnippet}`);
    }
  }
}

function verifyNoLegacyProductionNoticesFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const legacyCallPattern = /erpApi\.productionNotices\s*\(/g;
    for (const match of source.matchAll(legacyCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use productionNoticesPage pagination instead of legacy erpApi.productionNotices full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/productionNotices\s*\(\s*status\?:\s*ProductionNoticeStatus/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy productionNotices(status, target, filters) full-list API; use productionNoticesPage only.');
  }
  const productionControllerSource = readFile('backend/src/modules/production/production.controller.ts');
  if (!productionControllerSource.includes("return this.productionService.notices({ ...query, withPage: 'true' });")) {
    addFailure('ProductionController public production notices list must force paged responses.');
  }
  const productionNoticesRegressionSource = readFile('scripts/verify-production-notices-export-api.cjs');
  if (!productionNoticesRegressionSource.includes('production-notices-public-list-pagination')) {
    addFailure('scripts/verify-production-notices-export-api.cjs must verify public production notices pagination.');
  }
}

function verifyNoLegacyProductionReplenishmentRequestFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const legacyCallPattern = /erpApi\.productionReplenishmentRequests\s*\(/g;
    for (const match of source.matchAll(legacyCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use productionReplenishmentRequestsPage pagination instead of legacy erpApi.productionReplenishmentRequests full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/productionReplenishmentRequests\s*\(\s*filters\s*:\s*ProductionReplenishmentRequestFilters/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy productionReplenishmentRequests(filters) full-list API; use productionReplenishmentRequestsPage only.');
  }
  const productionControllerSource = readFile('backend/src/modules/production/production.controller.ts');
  if (!productionControllerSource.includes("return this.productionService.replenishmentRequests({ ...query, withPage: 'true' });")) {
    addFailure('ProductionController public production replenishment request list must force paged responses.');
  }
  const regressionSource = readFile('scripts/verify-production-replenishment-requests-export-api.cjs');
  if (!regressionSource.includes('production-replenishment-requests-public-list-pagination')) {
    addFailure('scripts/verify-production-replenishment-requests-export-api.cjs must verify public production replenishment request pagination.');
  }
}

function verifyNoLegacyProductionScrapRecordFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const legacyCallPattern = /erpApi\.productionScrapRecords\s*\(/g;
    for (const match of source.matchAll(legacyCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use productionScrapRecordsPage or productionScrapRecordsAllPages instead of legacy erpApi.productionScrapRecords full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/productionScrapRecords\s*\(\s*filters\s*:\s*ProductionScrapFilters/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy productionScrapRecords(filters) full-list API; use explicit paged helpers only.');
  }
  const productionControllerSource = readFile('backend/src/modules/production/production.controller.ts');
  if (!productionControllerSource.includes("return this.productionService.scrapRecords({ ...query, withPage: 'true' });")) {
    addFailure('ProductionController public production scrap record list must force paged responses.');
  }
  const regressionSource = readFile('scripts/verify-production-scrap-records-export-api.cjs');
  if (!regressionSource.includes('production-scrap-records-public-list-pagination')) {
    addFailure('scripts/verify-production-scrap-records-export-api.cjs must verify public production scrap record pagination.');
  }
}

function verifyNoLegacyProductionTaskFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    if (toProjectPath(filePath) === 'frontend/src/api/erp.ts') {
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const taskCallPattern = /erpApi\.productionTasks\s*\(/g;
    for (const match of source.matchAll(taskCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use productionTasksPage pagination instead of legacy erpApi.productionTasks full-list calls.`
      );
    }
    const summaryCallPattern = /erpApi\.productionOrderSummaries\s*\(/g;
    for (const match of source.matchAll(summaryCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use productionOrderSummariesPage pagination instead of legacy erpApi.productionOrderSummaries full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/productionTasks\s*\(\s*filters\s*:\s*ProductionTaskFilters/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy productionTasks(filters) full-list API; use productionTasksPage only.');
  }
  if (/productionOrderSummaries\s*\(\s*filters\s*:\s*ProductionTaskFilters/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy productionOrderSummaries(filters) full-list API; use productionOrderSummariesPage only.');
  }
  const productionExportRegressionSource = readFile('scripts/verify-production-export-api.cjs');
  if (!productionExportRegressionSource.includes('production-tasks-display-status-pagination')) {
    addFailure('scripts/verify-production-export-api.cjs must verify production task display-status pagination.');
  }
}

function verifyNoLegacyAdminProductionNoticesFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const legacyCallPattern = /erpApi\.adminProductionNotices\s*\(/g;
    for (const match of source.matchAll(legacyCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use adminProductionNoticesPage pagination instead of legacy erpApi.adminProductionNotices full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/adminProductionNotices\s*\(\s*filters\s*:\s*ProductionNoticeFilters/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy adminProductionNotices(filters) full-list API; use adminProductionNoticesPage only.');
  }
  const productionControllerSource = readFile('backend/src/modules/production/production.controller.ts');
  if (!productionControllerSource.includes("return this.productionService.adminNotices({ ...query, withPage: 'true' });")) {
    addFailure('ProductionController public admin notices list must force paged responses.');
  }
  const productionNoticesRegressionSource = readFile('scripts/verify-production-notices-export-api.cjs');
  if (!productionNoticesRegressionSource.includes('admin-production-notices-public-list-pagination')) {
    addFailure('scripts/verify-production-notices-export-api.cjs must verify public admin production notices pagination.');
  }
}

function verifyNoLegacyWarehouseNoticesFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const legacyCallPattern = /erpApi\.warehouseNotices\s*\(/g;
    for (const match of source.matchAll(legacyCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use warehouseNoticesPage pagination instead of legacy erpApi.warehouseNotices full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/warehouseNotices\s*\(\s*status\?:\s*ProductionNoticeStatus/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy warehouseNotices(status, filters) full-list API; use warehouseNoticesPage only.');
  }
  const warehouseControllerSource = readFile('backend/src/modules/warehouses/warehouses.controller.ts');
  if (!warehouseControllerSource.includes("return this.warehousesService.warehouseNotices({ ...query, withPage: 'true' });")) {
    addFailure('WarehousesController public warehouse notices list must force paged responses.');
  }
  const warehouseNoticesRegressionSource = readFile('scripts/verify-warehouse-notices-export-api.cjs');
  if (!warehouseNoticesRegressionSource.includes('warehouse-notices-public-list-pagination')) {
    addFailure('scripts/verify-warehouse-notices-export-api.cjs must verify public warehouse notices pagination.');
  }
}

function verifyNoLegacyWarehouseTransactionsFullListCalls() {
  const frontendSourceDir = resolveProjectPath('frontend/src');
  for (const filePath of walkFiles(frontendSourceDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const legacyCallPattern = /erpApi\.warehouseTransactions\s*\(/g;
    for (const match of source.matchAll(legacyCallPattern)) {
      addFailure(
        `${toProjectPath(filePath)}:${sourceLineForIndex(source, match.index)} must use warehouseTransactionsPage pagination instead of legacy erpApi.warehouseTransactions full-list calls.`
      );
    }
  }
  const frontendApiSource = readFile('frontend/src/api/erp.ts');
  if (/warehouseTransactions\s*\(\s*filters\s*:\s*WarehouseTransactionFilters/.test(frontendApiSource)) {
    addFailure('frontend/src/api/erp.ts must not expose legacy warehouseTransactions(filters) full-list API; use warehouseTransactionsPage only.');
  }
  const warehouseControllerSource = readFile('backend/src/modules/warehouses/warehouses.controller.ts');
  if (!warehouseControllerSource.includes("return this.warehousesService.findTransactions({ ...query, withPage: 'true' });")) {
    addFailure('WarehousesController public warehouse transactions list must force paged responses.');
  }
  const warehouseTransactionRegressionSource = readFile('scripts/verify-warehouse-transactions-export-api.cjs');
  if (!warehouseTransactionRegressionSource.includes('warehouse-transactions-public-list-pagination')) {
    addFailure('scripts/verify-warehouse-transactions-export-api.cjs must verify public warehouse transaction pagination.');
  }
  const warehouseServiceSource = readFile('backend/src/modules/warehouses/warehouses.service.ts');
  const warehouseDtoSource = readFile('backend/src/modules/warehouses/dto.ts');
  const warehouseTransactionFixtureSources = [warehouseServiceSource, warehouseDtoSource, frontendApiSource, warehouseTransactionRegressionSource].join('\n');
  for (const snippet of [
    'includeTestFixtures?: string',
    'includeTestFixtures?: boolean',
    'warehouseInventoryBatchFixtureWhere',
    'warehouseInventoryTransactionFixtureWhere',
    "if (query.includeTestFixtures !== 'true')",
    'where.NOT = this.warehouseInventoryTransactionFixtureWhere();',
    'WAREHOUSE_TEST_FIXTURE_PREFIXES',
    'warehouse-transactions-public-list-pagination'
  ]) {
    if (!warehouseTransactionFixtureSources.includes(snippet)) {
      addFailure(`Warehouse transactions must keep reusable test-fixture filter snippet: ${snippet}`);
    }
  }
}

function verifyInventoryTableHeightControls() {
  const inventoryViewPath = 'frontend/src/views/InventoryView.vue';
  if (!fileExists(inventoryViewPath)) {
    addFailure(`Missing inventory table height control file: ${inventoryViewPath}`);
    return;
  }
  const inventoryViewSource = readFile(inventoryViewPath);
  const requiredSnippets = [
    "import { Minus, Plus, RefreshLeft } from '@element-plus/icons-vue';",
    "type InventoryWorkTableKey = 'materialMemory' | 'summary' | 'batches' | 'reservationHistory' | 'adjustmentHistory';",
    'const inventoryWorkTableKeys: InventoryWorkTableKey[]',
    'inventoryWorkTableHeightLimits',
    'inventoryWorkTableDefaultHeights',
    'inventoryWorkTableHeightStorageKey',
    '库存页表格高度是本机 UI 偏好，不能写入库存批次、预占、盘点、订单、生产或库存流水业务数据。',
    'const inventoryWorkTableHeights = reactive<Record<InventoryWorkTableKey, number>>',
    'function adjustInventoryWorkTableHeight',
    'function resetInventoryWorkTableHeight',
    'function restoreInventoryWorkTableHeights',
    'function saveInventoryWorkTableHeights',
    'localStorage.getItem(inventoryWorkTableHeightStorageKey)',
    'materialMemory: inventoryWorkTableHeights.materialMemory',
    'summary: inventoryWorkTableHeights.summary',
    'batches: inventoryWorkTableHeights.batches',
    'reservationHistory: inventoryWorkTableHeights.reservationHistory',
    'adjustmentHistory: inventoryWorkTableHeights.adjustmentHistory',
    ':max-height="inventoryWorkTableHeights.materialMemory"',
    ':max-height="inventoryWorkTableHeights.summary"',
    ':max-height="inventoryWorkTableHeights.batches"',
    ':max-height="inventoryWorkTableHeights.reservationHistory"',
    ':max-height="inventoryWorkTableHeights.adjustmentHistory"',
    'formatLongTextPreview(row.remark)',
    'longTextTooltipText(row.remark)',
    'reservationStatusReasonPreview(row)',
    'reservationStatusReasonTitle(row)',
    'function reservationStatusReasonPreview(row: InventoryReservationAudit)',
    'function formatLongTextPreview',
    'aria-label="降低库存使用总览表格高度"',
    'aria-label="提高库存汇总表格高度"',
    'aria-label="恢复库存溯源表格默认高度"',
    'aria-label="库存预占记录表格高度"',
    'aria-label="降低库存预占记录表格高度"',
    'aria-label="提高库存盘点记录表格高度"',
    'aria-label="恢复库存盘点记录表格默认高度"',
    'inventory-table-height-actions'
  ];
  for (const snippet of requiredSnippets) {
    if (!inventoryViewSource.includes(snippet)) {
      addFailure(`InventoryView.vue must keep desktop inventory table height control snippet: ${snippet}`);
    }
  }
  if (inventoryViewSource.includes("{{ row.remark || '-' }}")) {
    addFailure('InventoryView.vue must summarize inventory adjustment remarks instead of rendering full remark text directly.');
  }
  if (inventoryViewSource.includes('{{ row.statusReason || \'-\' }}')) {
    addFailure('InventoryView.vue must summarize reservation status reasons instead of rendering full text directly.');
  }
}

verifyRequiredFiles();
verifyOrderStatusEnumContract();
verifyNoMojibakeInUserFacingSources();
verifyFrontendDoesNotExposeTestFixtureOptIn();
verifyTableHeightButtonsHaveTitles();
verifyNativeButtonsHaveAccessibleNames();
verifyIconOnlyButtonsHaveAccessibleNames();
verifyRiskButtonsHaveTitles();
verifyImportantActionButtonsHaveAccessibleNames();
verifySecondaryActionButtonsHaveAccessibleNames();
verifyNavigation();
verifyNoForbiddenSecondStageEntrypoints();
verifyNoJsonFilePrimaryDatabase();
verifyResponsiveMobileBaseline();
verifyBusinessTablesHaveHorizontalScroll();
verifyNoElementPlusShowOverflowTooltip();
verifyNoRawLongTextTableColumns();
verifyNoNativeBrowserDialogs();
verifyNoElementPlusConfirmDialogs();
verifyNoDefaultFirstOption();
verifyResponsiveElementPlusDialogs();
verifyElementPlusChineseLocale();
verifyCustomerSelectOnlyShowsName();
verifyCustomerContactSoftDisableWorkflow();
verifyCustomerTableHeightControls();
verifyOrderSelectDisplayContract();
verifyOrderFilterOrder();
verifyOrderTestFixtureFilter();
verifyCaseInsensitiveBusinessKeyContracts();
verifyProductionTabOrder();
verifyProductionOrderSummaryWorkflow();
verifyProductionTableHeightControls();
verifyProductionExcelExportWorkflow();
verifyExportConcurrencyGuards();
verifyProductionOperatorSearchWorkflow();
verifyPlannerProcessAndSubmitGuard();
verifyProcessSelectionTableHeightControls();
verifyMaterialTransformTableHeightControls();
verifyMaterialLibraryTableHeightControls();
verifyInventorySourceDialogTableHeightControls();
verifyProcessPinyinSearchWorkflow();
verifyProcessMemoryCoreDataGuards();
verifyNoBusinessTextHardMaxLength();
verifyNoPrismaBusinessTextNativeLengthLimits();
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
verifyAdminNoticeTableHeightControls();
verifyUiPreferenceStorageGuards();
verifyInventoryTransactionOrderLineTraceability();
verifyPartialShipmentWorkflow();
verifySharedLinkComponents();
verifyDrawingDuplicateConfirmationWorkflow();
verifyNoInlineCustomerDropdowns();
verifyNoSilentSearchResultLimits();
verifyFixedFrontendLimitsExposeContinuation();
verifyStatisticsDisplayContract();
verifyStatisticsTableHeightControls();
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
verifyOrderTableHeightControls();
verifyOrderDetailTableHeightControls();
verifyOrderLineEditorTableHeightControls();
verifySeedStockReservationCoverage();
verifyMaterialCommonProjectModelGuards();
verifyMaterialStockAlertWorkflow();
verifyInventoryTableHeightControls();
verifyRealXlsxExportFormatContract();
verifyMaterialDashboardExportWorkflow();
verifyRuntimeStorageIgnored();
verifyFrontendSmokeWorkflow();
verifyTestDataCleanupWorkflow();
verifySeedResetSafetyWorkflow();
verifyProjectProgressWorkflow();
verifyProcessDefinitionPaginationContract();
verifyNoLegacyProcessTemplateFullListCalls();
verifyNoLegacyModelBomFullListCalls();
verifyNoLegacyInventoryBatchFullListCalls();
verifyNoLegacyInventoryMaterialFullListCalls();
verifyNoLegacyProductionNoticesFullListCalls();
verifyNoLegacyProductionReplenishmentRequestFullListCalls();
verifyNoLegacyProductionScrapRecordFullListCalls();
verifyNoLegacyProductionTaskFullListCalls();
verifyNoLegacyAdminProductionNoticesFullListCalls();
verifyNoLegacyWarehouseNoticesFullListCalls();
verifyNoLegacyWarehouseTransactionsFullListCalls();

if (failures.length > 0) {
  console.error('First-stage source verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('First-stage source verification passed.');
