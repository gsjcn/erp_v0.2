#!/usr/bin/env node

const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { pinyin } = require('pinyin-pro');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

for (const envPath of [resolve('.env'), resolve('backend/.env')]) {
  if (!existsSync(envPath)) {
    continue;
  }
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const apiBaseUrl = (process.env.ORDER_IMPORT_API_BASE_URL || 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const orderPrefix = `COD-IMPORT-${runId}`;
const materialPrefix = `MAT-${runId}`;
const customerSearchPrefix = `CUST-SEARCH-${runId}`;
const longProcessRemark = `LONG-PROCESS-REMARK-${runId}-` + 'no-business-text-limit-'.repeat(120);
const createdOrderNos = [];
const importSessionIds = [];
let sessionId = '';
const mojibakePattern =
  /[ÃÂ�]|锟|脙|脗|鈥|绗|\u95c3\u8235|\u95c3\u8236|寮€|涓€|瀵煎|璁㈠崟|鏂囦欢|缂栫爜|鍚嶇О|绮剧‘|鍖归厤|鍓嶇紑|鎷奸煶|鍥剧焊|瀹㈡埛|鍘嗗彶|搴撳瓨|鏉ユ簮|涔辩爜|淇|楠岃瘉|鏃犳硶|鏈壘|鎵惧埌|涓|尮閰|墿鏂|璇蜂粠|嬫媺|閫夋嫨|鏌ヨ|澶辫触|宸ヨ緭|闃绘柇/;

async function requestJson(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && body.message ? body.message : text;
    throw new Error(`${response.status} ${response.statusText}: ${Array.isArray(message) ? message.join('; ') : message}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = String(value || '');
  assert(!mojibakePattern.test(text), `${label} 不能出现乱码：${text}`);
}

function pinyinInitials(value) {
  return pinyin(String(value || ''), {
    toneType: 'none',
    type: 'array',
    pattern: 'first'
  })
    .join('')
    .toLowerCase();
}

async function firstEnabledCustomerName() {
  const customers = await requestJson('/customers?status=ENABLED');
  const customer = Array.isArray(customers) ? customers.find((item) => item.status === 'ENABLED') : null;
  assert(customer?.customerName, '未找到启用客户，无法执行订单导入 API 回归验证');
  return customer.customerName;
}

async function assertCustomerSearchRanking() {
  const exactName = `排序客户${runId}`;
  const prefixName = `${exactName}附加`;
  const exactCode = `${customerSearchPrefix}-Z`;
  const prefixCode = `${customerSearchPrefix}-A`;
  const prisma = new PrismaClient();
  try {
    await prisma.customer.deleteMany({ where: { customerCode: { startsWith: customerSearchPrefix } } });
    await prisma.customer.createMany({
      data: [
        {
          customerCode: prefixCode,
          customerName: prefixName,
          contactName: '排序回归联系人',
          regionType: 'CHINA',
          country: '中国',
          province: '江苏省',
          city: '常州市',
          status: 'ENABLED'
        },
        {
          customerCode: exactCode,
          customerName: exactName,
          contactName: '排序回归联系人',
          regionType: 'CHINA',
          country: '中国',
          province: '江苏省',
          city: '无锡市',
          status: 'ENABLED'
        }
      ]
    });

    const exactNameResults = await requestJson(`/customers?status=ENABLED&keyword=${encodeURIComponent(exactName)}`);
    assert(
      exactNameResults[0]?.customerCode === exactCode,
      `Customer search must rank exact customerName first; actual=${exactNameResults[0]?.customerCode}`
    );

    const exactCodeResults = await requestJson(`/customers?status=ENABLED&keyword=${encodeURIComponent(prefixCode)}`);
    assert(
      exactCodeResults[0]?.customerCode === prefixCode,
      `Customer search must rank exact customerCode first; actual=${exactCodeResults[0]?.customerCode}`
    );
  } finally {
    await prisma.customer.deleteMany({ where: { customerCode: { startsWith: customerSearchPrefix } } });
    await prisma.$disconnect();
  }
}

async function orderImportUploadDir() {
  const health = await requestJson('/health');
  const uploadRoot = health?.storage?.uploads?.path;
  assert(uploadRoot, '健康检查必须返回上传目录，用于验证导入临时文件清理');
  return join(uploadRoot, 'order-imports');
}

function storedImportFilesMatching(uploadDir, nameToken) {
  if (!existsSync(uploadDir)) {
    return [];
  }
  return readdirSync(uploadDir).filter((fileName) => fileName.includes(nameToken));
}

function assertNoStoredImportFilesMatching(uploadDir, nameToken, label) {
  const matches = storedImportFilesMatching(uploadDir, nameToken);
  assert(matches.length === 0, `${label} 不应残留服务器端 Excel 文件：${matches.join('、')}`);
}

function addRow(sheet, rowNo, values) {
  values.forEach((value, index) => {
    sheet.getCell(rowNo, index + 1).value = value;
  });
}

const orderImportHeaders = [
  '订单块(自动)',
  '订单编号',
  '制单日期',
  '客户名称',
  '项目型号',
  '行类型',
  '自动序号',
  '零件类型',
  '组件编号(自动)',
  '所属组件编号(自动/可改)',
  '物料号',
  '图号',
  '产品名称',
  '展开尺寸',
  '厚度',
  '订单数',
  '单套用量',
  '需求数量(自动)',
  '单位',
  '工艺路线',
  '工艺备注',
  '图纸日期',
  '图纸状态'
];

async function buildWorkbookBufferFromRows(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ERP上传净表');
  addRow(sheet, 1, orderImportHeaders);
  rows.forEach((row, index) => addRow(sheet, index + 2, row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildWorkbookBuffer(customerName) {
  const today = '2026/6/18';
  const rows = [
    [1, `${orderPrefix}-001`, today, customerName, '导入验证A', '零件', 1, '通用件', '', '', `${materialPrefix}-001`, `VERIFY-${runId}-10-01`, '验证顶盖', '', '1mm', 8, '', 8, '件', '', longProcessRemark, '2026/5/30', '旧图'],
    [1, `${orderPrefix}-001`, today, customerName, '导入验证A', '组件', 2, '定制件', 'C001', '', `${materialPrefix}-002`, `VERIFY-${runId}-20-00`, '验证支架组件', '', '2mm', 20, 2, 40, '套', '装配', 'API 回归组件行', '', '旧图'],
    [1, `${orderPrefix}-001`, today, customerName, '导入验证A', '零件', '2.1', '定制件', '', 'C001', `${materialPrefix}-003`, `VERIFY-${runId}-20-A`, '验证支架子件A', '', '2mm', '', 2, 80, '件', '', '按父组件需求数量×2', '', '旧图'],
    [2, `${orderPrefix}-002`, today, customerName, '导入验证B', '零件', 1, '外协件', '', '', `${materialPrefix}-004`, `VERIFY-${runId}-30-01`, '验证外协网罩', '', '1mm', 16, '', 16, '件', '', 'API 回归外协件', '', '新图'],
    [2, `${orderPrefix}-002`, today, customerName, '导入验证B', '组件', 2, '定制件', 'C001', '', `${materialPrefix}-005`, `VERIFY-${runId}-40-00`, '验证底盘组件', '', '2mm', 10, 1, 10, '套', '装配', '第二个订单组件编号从 C001 开始', '', '旧图'],
    [2, `${orderPrefix}-002`, today, customerName, '导入验证B', '零件', '2.1', '定制件', '', 'C001', `${materialPrefix}-006`, `VERIFY-${runId}-40-A`, '验证底盘子件', '', '1.5mm', '', 3, 30, '件', '', '按父组件需求数量×3', '', '旧图'],
    [3, `${orderPrefix}-003`, today, customerName, '导入验证C', '组件', 1, '数控件', 'ASM-X1', '', `${materialPrefix}-007`, `VERIFY-${runId}-50-00`, '验证自定义编号组件', '', '1.2mm', 6, 1, 6, '套', '激光折弯', '自定义组件编号不能被 C001-C9999 写死', '', '旧图'],
    [3, `${orderPrefix}-003`, today, customerName, '导入验证C', '零件', '1.1', '数控件', '', 'ASM-X1', `${materialPrefix}-008`, `VERIFY-${runId}-50-01`, '验证自定义编号子件', '', '1.2mm', '', 2, 12, '件', '激光折弯', '按自定义父组件编号关联', '', '旧图'],
    [4, `${orderPrefix}-BAD`, '', customerName, '导入验证错误订单', '零件', 1, '通用件', 'C999', '', `${materialPrefix}-BAD`, `VERIFY-${runId}-BAD`, '错误零件填了组件编号', '', '', 1, '', 1, '件', '', '用于验证预览阶段拦截组件结构错误和缺厚度待核对', '', '旧图']
  ];
  return buildWorkbookBufferFromRows(rows);
}

async function buildSplitWorkbookBuffer(customerName, rows) {
  return buildWorkbookBufferFromRows(rows.map((row) => [5, `${orderPrefix}-SPLIT`, '2026/6/19', customerName, '连续上传验证', ...row]));
}

async function buildSelectedCommitWorkbookBuffer(customerName) {
  const rows = [
    [1, `${orderPrefix}-PAGE-001`, '2026/6/20', customerName, '分页选择验证', '零件', 1, '通用件', '', '', `${materialPrefix}-PAGE-001`, `VERIFY-${runId}-PAGE-01`, '分页选择零件1', '', '1mm', 1, '', 1, '件', '', '分页验证第1单', '', '旧图'],
    [2, `${orderPrefix}-PAGE-002`, '2026/6/20', customerName, '分页选择验证', '零件', 1, '通用件', '', '', `${materialPrefix}-PAGE-002`, `VERIFY-${runId}-PAGE-02`, '分页选择零件2', '', '1mm', 2, '', 2, '件', '', '分页验证第2单', '', '旧图'],
    [3, `${orderPrefix}-PAGE-003`, '2026/6/20', customerName, '分页选择验证', '零件', 1, '通用件', '', '', `${materialPrefix}-PAGE-003`, `VERIFY-${runId}-PAGE-03`, '分页选择零件3', '', '1mm', 3, '', 3, '件', '', '分页验证第3单', '', '旧图']
  ];
  return buildWorkbookBufferFromRows(rows);
}

async function buildExcludedCommitWorkbookBuffer(customerName) {
  const rows = [
    [1, `${orderPrefix}-EXCLUDE-001`, '2026/6/21', customerName, '排除提交验证', '零件', 1, '通用件', '', '', `${materialPrefix}-EXCLUDE-001`, `VERIFY-${runId}-EXCLUDE-01`, '排除提交零件1', '', '1mm', 1, '', 1, '件', '', '排除提交第1单', '', '旧图'],
    [2, `${orderPrefix}-EXCLUDE-002`, '2026/6/21', customerName, '排除提交验证', '零件', 1, '通用件', '', '', `${materialPrefix}-EXCLUDE-002`, `VERIFY-${runId}-EXCLUDE-02`, '排除提交零件2', '', '1mm', 2, '', 2, '件', '未维护工序', '用于验证可选订单警告统计', '', '旧图'],
    [3, `${orderPrefix}-EXCLUDE-003`, '2026/6/21', customerName, '排除提交验证', '零件', 1, '通用件', '', '', `${materialPrefix}-EXCLUDE-003`, `VERIFY-${runId}-EXCLUDE-03`, '排除提交零件3', '', '1mm', 3, '', 3, '件', '', '排除提交第3单', '', '旧图']
  ];
  return buildWorkbookBufferFromRows(rows);
}

async function buildWorkbookWithoutUploadSheetBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('清单台账');
  addRow(sheet, 1, orderImportHeaders);
  addRow(sheet, 2, [
    1,
    `${orderPrefix}-NO-UPLOAD-SHEET`,
    '2026/6/20',
    '错误客户',
    '缺少上传净表验证',
    '零件',
    1,
    '通用件',
    '',
    '',
    `${materialPrefix}-NO-UPLOAD-SHEET`,
    `VERIFY-${runId}-NO-UPLOAD-SHEET`,
    '缺少上传净表',
    '',
    '1mm',
    1,
    '',
    1,
    '件',
    '',
    '',
    '',
    '旧图'
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildWorkbookWithBlankRowInMiddleBuffer(customerName) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ERP上传净表');
  addRow(sheet, 1, orderImportHeaders);
  addRow(sheet, 2, [
    1,
    `${orderPrefix}-BLANK-ROW`,
    '2026/6/20',
    customerName,
    '中间空行验证',
    '零件',
    1,
    '通用件',
    '',
    '',
    `${materialPrefix}-BLANK-001`,
    `VERIFY-${runId}-BLANK-01`,
    '中间空行前零件',
    '',
    '1mm',
    1,
    '',
    1,
    '件',
    '',
    '',
    '',
    '旧图'
  ]);
  addRow(sheet, 4, [
    1,
    `${orderPrefix}-BLANK-ROW`,
    '2026/6/20',
    customerName,
    '中间空行验证',
    '零件',
    2,
    '通用件',
    '',
    '',
    `${materialPrefix}-BLANK-002`,
    `VERIFY-${runId}-BLANK-02`,
    '中间空行后零件',
    '',
    '1mm',
    1,
    '',
    1,
    '件',
    '',
    '',
    '',
    '旧图'
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildWorkbookWithOrderHeadRowBuffer(customerName) {
  return buildWorkbookBufferFromRows([
    [
      1,
      `${orderPrefix}-ORDER-HEAD`,
      '2026/6/20',
      customerName,
      '订单头行验证',
      '订单头',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ],
    [
      1,
      `${orderPrefix}-ORDER-HEAD`,
      '2026/6/20',
      customerName,
      '订单头行验证',
      '零件',
      1,
      '通用件',
      '',
      '',
      `${materialPrefix}-ORDER-HEAD`,
      `VERIFY-${runId}-ORDER-HEAD`,
      '订单头后零件',
      '',
      '1mm',
      1,
      '',
      1,
      '件',
      '',
      '',
      '',
      '旧图'
    ]
  ]);
}

async function buildWorkbookWithMissingRequiredHeaderBuffer(customerName) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ERP上传净表');
  const headers = orderImportHeaders.filter((header) => header !== '需求数量(自动)');
  addRow(sheet, 1, headers);
  addRow(sheet, 2, [
    1,
    `${orderPrefix}-MISSING-HEADER`,
    '2026/6/20',
    customerName,
    '缺少表头验证',
    '零件',
    1,
    '通用件',
    '',
    '',
    `${materialPrefix}-MISSING-HEADER`,
    `VERIFY-${runId}-MISSING-HEADER`,
    '缺少需求数量表头零件',
    '',
    '1mm',
    1,
    '',
    '件',
    '',
    '',
    '',
    '旧图'
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildWorkbookWithEmptyUploadSheetBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ERP上传净表');
  addRow(sheet, 1, orderImportHeaders);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function uploadWorkbook(sessionId, buffer, fileName = `order-import-api-${runId}.xlsx`) {
  const form = new FormData();
  form.set(
    'file',
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName
  );
  const response = await fetch(`${apiBaseUrl}/orders/import-sessions/${sessionId}/files`, {
    method: 'POST',
    body: form
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function uploadWorkbookExpectFailure(sessionId, buffer, expectedMessage, fileName = `order-import-api-fail-${runId}.xlsx`) {
  let rejected = false;
  try {
    await uploadWorkbook(sessionId, buffer, fileName);
  } catch (error) {
    rejected = true;
    assert(
      String(error.message || '').includes(expectedMessage),
      `上传失败原因应包含“${expectedMessage}”，实际：${error.message}`
    );
  }
  assert(rejected, `上传 ${fileName} 应失败`);
}

async function commitImportSessionExpectFailure(sessionIdForCommit, payload, expectedMessage) {
  let rejected = false;
  try {
    await requestJson(`/orders/import-sessions/${sessionIdForCommit}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    rejected = true;
    assert(
      String(error.message || '').includes(expectedMessage),
      `导入提交失败原因应包含“${expectedMessage}”，实际：${error.message}`
    );
  }
  assert(rejected, '导入提交应被拒绝');
}

async function verifyBundledWorkbookUploadPreviews() {
  const workbookDir = resolve('outputs/component-order-template');
  if (!existsSync(workbookDir)) {
    throw new Error(`缺少 Excel 模板目录：${workbookDir}`);
  }
  const workbookFiles = readdirSync(workbookDir)
    .filter((fileName) => fileName.endsWith('.xlsx'))
    .sort();
  assert(workbookFiles.includes('组件零件清单ERP上传模板.xlsx'), '缺少网页下载同源的空白 ERP 上传模板');
  assert(workbookFiles.some((fileName) => fileName.includes('最终版')), '缺少最终版组件零件清单台账模板');
  assert(workbookFiles.includes('erpordertest.xlsx'), '缺少 erpordertest.xlsx 汇总上传测试文件');

  for (const fileName of workbookFiles) {
    if (fileName === '组件零件清单ERP上传模板.xlsx') {
      continue;
    }
    const previewSession = await requestJson('/orders/import-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ createdBy: `verify-workbook-preview-${runId}` })
    });
    try {
      const buffer = readFileSync(join(workbookDir, fileName));
      const upload = await uploadWorkbook(previewSession.id, buffer, fileName);
      assert(upload.summary.fileCount === 1, `${fileName} 上传预览应只包含 1 个文件`);
      assert(upload.summary.rowCount > 0, `${fileName} 上传预览必须读取到 ERP上传净表 明细`);
      assert(upload.files?.[0]?.fileName === fileName, `${fileName} 上传预览必须保留中文文件名，实际 ${upload.files?.[0]?.fileName}`);
      assert(upload.files?.[0]?.sheetName === 'ERP上传净表', `${fileName} 必须由 ERP上传净表 生成预览`);
      assert(upload.summary.orderCount > 0, `${fileName} 上传预览必须识别到订单`);
      assert(
        upload.orders?.[0]?.rows?.[0]?.sourceFileName === fileName,
        `${fileName} 预览明细来源文件名必须保留中文，实际 ${upload.orders?.[0]?.rows?.[0]?.sourceFileName}`
      );
    } finally {
      try {
        await requestJson(`/orders/import-sessions/${previewSession.id}`, { method: 'DELETE' });
      } catch {
        // 预览会话清理尽力执行；失败不掩盖真正的解析错误。
      }
    }
  }
}

async function downloadTemplate() {
  const response = await fetch(`${apiBaseUrl}/orders/import-template`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${buffer.toString('utf8')}`);
  }
  return {
    contentType: response.headers.get('content-type') || '',
    buffer
  };
}

async function downloadIssueReport(sessionId) {
  const response = await fetch(`${apiBaseUrl}/orders/import-sessions/${sessionId}/error-report`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${buffer.toString('utf8')}`);
  }
  return {
    contentType: response.headers.get('content-type') || '',
    buffer
  };
}

async function loadWorkbookFromBuffer(buffer, label) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (error) {
    throw new Error(`${label} 不是 ExcelJS 可读取的 xlsx：${error.message}`);
  }
  return workbook;
}

async function assertTemplateWorkbook(template) {
  assert(
    template.contentType.includes('spreadsheetml.sheet'),
    `模板应返回 xlsx content-type，实际 ${template.contentType}`
  );
  assert(template.buffer.slice(0, 2).toString('utf8') === 'PK', '模板必须是 xlsx zip 文件');
  const bundledTemplatePath = join(resolve('outputs/component-order-template'), '组件零件清单ERP上传模板.xlsx');
  assert(existsSync(bundledTemplatePath), '必须保留 outputs/component-order-template/组件零件清单ERP上传模板.xlsx 作为网页下载模板来源');
  assert(
    template.buffer.equals(readFileSync(bundledTemplatePath)),
    '网页下载的 ERP 上传模板必须和 outputs/component-order-template/组件零件清单ERP上传模板.xlsx 完全一致'
  );
  const workbook = await loadWorkbookFromBuffer(template.buffer, '订单导入模板');
  for (const sheetName of ['ERP上传净表', '字段说明', '示例数据', '选项']) {
    assert(workbook.getWorksheet(sheetName), `订单导入模板必须包含 ${sheetName} 工作表`);
  }
  const uploadSheet = workbook.getWorksheet('ERP上传净表');
  assert(uploadSheet.getCell('A4').text === '订单块(自动)', 'ERP上传净表第 4 行必须是正式上传表头');
  assert(uploadSheet.getCell('P4').text === '订单数', 'ERP上传净表必须使用订单数字段');
  assert(uploadSheet.getCell('R4').text === '需求数量(自动)', 'ERP上传净表必须保留自动需求数量字段');
  const optionsSheet = workbook.getWorksheet('选项');
  assert(optionsSheet.getCell('E2').text === 'C001', '订单导入模板组件编号选项必须从 C001 开始');
  assert(optionsSheet.getCell('E10000').text === 'C9999', '订单导入模板组件编号选项必须支持到 C9999');
  assert(uploadSheet.getCell('I5').dataValidation?.errorStyle === 'warning', '组件编号下拉只能警告，不能阻止自定义组件编号');
  assert(uploadSheet.getCell('J5').dataValidation?.errorStyle === 'warning', '所属组件编号下拉只能警告，不能阻止自定义组件编号');
  assert(!workbook.getWorksheet('清单台账'), 'ERP 下载模板不应混入台账工作表，避免误上传');
}

async function assertIssueReportWorkbook(issueReport, options = {}) {
  assert(
    issueReport.contentType.includes('spreadsheetml.sheet'),
    `问题明细应返回 xlsx content-type，实际 ${issueReport.contentType}`
  );
  assert(issueReport.buffer.slice(0, 2).toString('utf8') === 'PK', '问题明细必须是可打开的 xlsx 文件');
  const workbook = await loadWorkbookFromBuffer(issueReport.buffer, '订单导入问题明细');
  for (const sheetName of ['导入概览', '上传文件', '问题明细']) {
    assert(workbook.getWorksheet(sheetName), `问题明细文件必须包含 ${sheetName} 工作表`);
  }
  const issueSheet = workbook.getWorksheet('问题明细');
  const rows = [];
  issueSheet.eachRow((row, rowNo) => {
    if (rowNo <= 1) {
      return;
    }
    rows.push({
      orderNo: row.getCell(1).text,
      sourceRowNo: row.getCell(4).text,
      lineType: row.getCell(6).text,
      issueCode: row.getCell(13).text,
      issueMessage: row.getCell(14).text
    });
  });
  for (const code of options.requiredCodes || []) {
    assert(rows.some((row) => row.issueCode === code), `问题明细必须包含错误代码 ${code}`);
  }
  for (const pair of options.forbiddenOrderCodePairs || []) {
    assert(
      !rows.some((row) => row.orderNo === pair.orderNo && row.issueCode === pair.code),
      `订单 ${pair.orderNo} 不应残留错误代码 ${pair.code}`
    );
  }
  return rows;
}

function toOrderUpdateLine(line, overrides = {}) {
  const processStepDetails =
    line.processStepDetails && line.processStepDetails.length > 0
      ? line.processStepDetails
      : (line.processSteps || []).map((processName) => ({ processName, processRemark: '' }));
  return {
    lineType: line.lineType || 'PART',
    partCategory: line.partCategory || '',
    componentNo: line.componentNo || '',
    parentComponentNo: line.parentComponentNo || '',
    importSequence: line.importSequence || '',
    sourceImportSessionId: line.sourceImportSessionId || '',
    sourceImportFileId: line.sourceImportFileId || '',
    sourceImportFileName: line.sourceImportFileName || '',
    sourceImportRowNo: line.sourceImportRowNo || undefined,
    projectModel: line.projectModel || '',
    drawingDate: line.drawingDate || undefined,
    drawingStatus: line.drawingStatus || '',
    partCode: line.partCode,
    partName: line.partName,
    drawingNo: line.drawingNo || '',
    drawingVersion: line.drawingVersion || '',
    drawingFileName: line.drawingFileName || '',
    drawingFileUrl: line.drawingFileUrl || '',
    partThickness: Number(line.partThickness || 0),
    partSpecification: line.partSpecification || '',
    quantity: Number(line.quantity || 0),
    productionPlanQuantity: Number(line.productionPlanQuantity ?? line.quantity ?? 0),
    fulfillmentMode: line.fulfillmentMode || 'PRODUCTION',
    unit: line.unit || '件',
    deliveryDate: line.deliveryDate || undefined,
    remark: line.remark || '',
    processSteps: processStepDetails.map((step) => ({
      processName: step.processName,
      processRemark: step.processRemark || ''
    })),
    selectedStockSources: line.selectedStockSources || [],
    ...overrides
  };
}

function assertNoBlankOptionalOrderLineText(order, label) {
  const optionalFields = ['drawingNo', 'drawingVersion', 'drawingFileName', 'drawingFileUrl', 'partSpecification', 'remark'];
  for (const line of order.lines || []) {
    for (const field of optionalFields) {
      const value = line[field];
      assert(
        value === null || value === undefined || String(value).trim() !== '',
        `${label} ${line.partCode} ${field} 不能保存为空字符串，空值必须归一化为 null`
      );
    }
  }
}

async function assertImportSourcePreview(order) {
  const sourceLine = order.lines.find((line) => line.sourceImportFileId && line.sourceImportFileName);
  assert(sourceLine, '订单明细必须返回来源 Excel 文件 ID 和文件名，便于订单页预览来源文件');
  assertNoMojibake(sourceLine.sourceImportFileName, '来源 Excel 文件名');
  const previewPage = await requestJson(
    `/orders/${encodeURIComponent(order.orderNo)}/import-source-files/${encodeURIComponent(sourceLine.sourceImportFileId)}/preview?limit=2&offset=0`
  );
  assert(previewPage.rowPage.totalCount === order.lines.length, '来源 Excel 预览必须返回当前订单总行数');
  assert(previewPage.rows.length === Math.min(order.lines.length, 2), '来源 Excel 预览必须按 limit 分页返回');
  assert(previewPage.rowPage.hasMore === order.lines.length > previewPage.rows.length, '来源 Excel 预览必须返回 hasMore');
  const preview = await requestJson(
    `/orders/${encodeURIComponent(order.orderNo)}/import-source-files/${encodeURIComponent(sourceLine.sourceImportFileId)}/preview?limit=500&offset=0`
  );
  assert(preview.file.fileName === sourceLine.sourceImportFileName, '来源 Excel 预览必须保留中文文件名并与订单明细一致');
  assert(preview.file.fileUrl, '来源 Excel 预览必须返回可打开的原文件地址');
  assert(preview.file.sheetName === 'ERP上传净表', `来源 Excel 预览必须显示 ERP上传净表 工作表，实际 ${preview.file.sheetName}`);
  assert(preview.rows.length === order.lines.length, `来源 Excel 预览行数应等于当前订单行数，实际 ${preview.rows.length}`);
  for (const row of preview.rows) {
    assertNoMojibake(row.customerName, '来源 Excel 预览客户名称');
    assertNoMojibake(row.partName, '来源 Excel 预览产品名称');
    assertNoMojibake(row.processRemark, '来源 Excel 预览工艺备注');
    assertNoMojibake(row.drawingStatus, '来源 Excel 预览图纸状态');
  }
  assert(
    preview.rows.some((row) => row.sourceRowNo === sourceLine.sourceImportRowNo && row.partCode === sourceLine.partCode),
    '来源 Excel 预览必须能定位到当前订单零件原始 Excel 行'
  );
}

async function assertImportSessionFilePreview(sessionIdForPreview, fileId, expectedFileName) {
  const firstPage = await requestJson(
    `/orders/import-sessions/${sessionIdForPreview}/files/${fileId}/preview?limit=3&offset=0`
  );
  assert(firstPage.file.fileName === expectedFileName, `上传文件预览必须保留中文文件名，实际 ${firstPage.file.fileName}`);
  assert(firstPage.file.fileUrl, '上传文件预览必须返回可打开的原文件地址');
  assert(firstPage.rows.length === 3, `上传文件预览第一页应按 limit 返回 3 行，实际 ${firstPage.rows.length}`);
  assert(firstPage.rowPage.hasMore === true, '上传文件预览必须支持分页加载更多行');
  assert(
    firstPage.rows.every((row) => row.sourceImportFileId === fileId && row.sourceFileName === expectedFileName),
    '上传文件预览每行必须带来源文件 ID 和中文来源文件名'
  );
  for (const row of firstPage.rows) {
    assertNoMojibake(row.sourceFileName, '上传文件预览来源文件名');
    assertNoMojibake(row.customerName, '上传文件预览客户名称');
    assertNoMojibake(row.partName, '上传文件预览产品名称');
    assertNoMojibake(row.processRemark, '上传文件预览工艺备注');
  }
  assert(firstPage.rows.some((row) => row.orderNo && row.partName), '上传文件预览必须返回订单编号和中文产品名称');

  const secondPage = await requestJson(
    `/orders/import-sessions/${sessionIdForPreview}/files/${fileId}/preview?limit=3&offset=3`
  );
  assert(secondPage.rows.length === 3, `上传文件预览第二页应继续返回 3 行，实际 ${secondPage.rows.length}`);
  assert(
    !new Set(firstPage.rows.map((row) => row.id)).has(secondPage.rows[0].id),
    '上传文件预览分页不应重复第一页第一行'
  );
}

async function cleanup() {
  for (const orderNo of createdOrderNos) {
    try {
      await requestJson(`/orders/${encodeURIComponent(orderNo)}`, { method: 'DELETE' });
    } catch {
      // 回归验证清理尽力执行；最终错误仍由主流程抛出。
    }
  }
  if (sessionId && !importSessionIds.includes(sessionId)) {
    importSessionIds.push(sessionId);
  }
  for (const id of importSessionIds) {
    try {
      await requestJson(`/orders/import-sessions/${id}`, { method: 'DELETE' });
    } catch {
      // 已提交导入记录可以删除记忆；失败时不掩盖主错误。
    }
  }
  const prisma = new PrismaClient();
  try {
    await prisma.material.deleteMany({
      where: {
        partCode: { startsWith: materialPrefix }
      }
    });
    await prisma.customer.deleteMany({
      where: {
        customerCode: { startsWith: customerSearchPrefix }
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function assertImportedMaterialsUpserted(expectedPartCodes, forbiddenPartCodes = []) {
  const prisma = new PrismaClient();
  try {
    const materials = await prisma.material.findMany({
      where: { partCode: { in: expectedPartCodes } },
      select: { partCode: true, partName: true, unit: true, status: true }
    });
    const foundPartCodes = new Set(materials.map((material) => material.partCode));
    const missingPartCodes = expectedPartCodes.filter((partCode) => !foundPartCodes.has(partCode));
    assert(
      missingPartCodes.length === 0,
      `Imported order lines must be upserted into Material library, missing: ${missingPartCodes.join(', ')}`
    );
    assert(
      materials.every((material) => material.status === 'ENABLED'),
      'Imported Material rows must be enabled'
    );
    assert(
      materials.every((material) => material.partName && material.unit),
      'Imported Material rows must keep partName and unit'
    );
    for (const material of materials) {
      assertNoMojibake(material.partName, `Material ${material.partCode} 产品名称`);
      assertNoMojibake(material.unit, `Material ${material.partCode} 单位`);
    }
    if (forbiddenPartCodes.length > 0) {
      const rejectedMaterials = await prisma.material.findMany({
        where: { partCode: { in: forbiddenPartCodes } },
        select: { partCode: true }
      });
      assert(
        rejectedMaterials.length === 0,
        `Blocked import rows must not be upserted into Material library: ${rejectedMaterials
          .map((material) => material.partCode)
          .join(', ')}`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function assertOrderImportDoesNotOverwriteExistingMaterial(customerName) {
  const partCode = `${materialPrefix}-LOCKED`;
  const orderNo = `${orderPrefix}-NO-MATERIAL-OVERWRITE`;
  const originalMaterial = {
    partCode,
    partName: '订单导入不得覆盖已有 Material',
    unit: '件',
    partSpecification: '原始基础资料规格',
    status: 'DISABLED'
  };
  const importedSnapshot = {
    partName: '订单导入行独立快照名称',
    unit: '套',
    partSpecification: '订单行规格 888mm x 999mm'
  };

  const prisma = new PrismaClient();
  try {
    await prisma.material.upsert({
      where: { partCode },
      create: originalMaterial,
      update: originalMaterial
    });
  } finally {
    await prisma.$disconnect();
  }

  const overwriteSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-material-no-overwrite' })
  });
  importSessionIds.push(overwriteSession.id);

  const upload = await uploadWorkbook(
    overwriteSession.id,
    await buildWorkbookBufferFromRows([
      [
        1,
        orderNo,
        '2026/6/18',
        customerName,
        '导入不覆盖基础资料',
        '零件',
        1,
        '通用件',
        '',
        '',
        partCode,
        `VERIFY-${runId}-LOCKED`,
        importedSnapshot.partName,
        importedSnapshot.partSpecification,
        '1.5mm',
        2,
        '',
        2,
        importedSnapshot.unit,
        '激光切割',
        '订单导入只保存订单行快照，不能覆盖 Material 搜索记忆',
        '2026/6/18',
        '旧图'
      ]
    ]),
    `order-import-material-no-overwrite-${runId}.xlsx`
  );
  assert(upload.summary.selectableOrderCount === 1, `订单导入不得覆盖已有 Material 回归预览应有 1 个可导入订单，实际 ${upload.summary.selectableOrderCount}`);

  const commit = await requestJson(`/orders/import-sessions/${overwriteSession.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allSelectable: true, previewToken: upload.previewToken })
  });
  assert(commit.createdCount === 1, `订单导入不得覆盖已有 Material 回归应创建 1 个草稿订单，实际 ${commit.createdCount}`);
  assert(commit.materialSyncCount === 1, `订单导入不得覆盖已有 Material 回归仍应统计 1 个涉及零件编码，实际 ${commit.materialSyncCount}`);
  createdOrderNos.push(orderNo);

  const verifyPrisma = new PrismaClient();
  try {
    const material = await verifyPrisma.material.findUnique({
      where: { partCode },
      select: { partCode: true, partName: true, unit: true, partSpecification: true, status: true }
    });
    assert(material?.status === 'DISABLED', `订单导入不得把已停用 Material 自动恢复启用，实际 ${material?.status}`);
    assert(material.partName === originalMaterial.partName, `订单导入不得覆盖已有 Material.partName，实际 ${material.partName}`);
    assert(material.unit === originalMaterial.unit, `订单导入不得覆盖已有 Material.unit，实际 ${material.unit}`);
    assert(
      material.partSpecification === originalMaterial.partSpecification,
      `订单导入不得覆盖已有 Material.partSpecification，实际 ${material.partSpecification}`
    );

    const order = await verifyPrisma.customerOrder.findUnique({
      where: { orderNo },
      select: {
        status: true,
        lines: {
          where: { partCode },
          select: { partName: true, unit: true, partSpecification: true }
        }
      }
    });
    const importedLine = order?.lines?.[0];
    assert(order?.status === 'DRAFT', `订单导入只应创建 DRAFT 草稿订单，实际 ${order?.status}`);
    assert(importedLine?.partName === importedSnapshot.partName, `订单行应保留导入快照 partName，实际 ${importedLine?.partName}`);
    assert(importedLine?.unit === importedSnapshot.unit, `订单行应保留导入快照 unit，实际 ${importedLine?.unit}`);
    assert(
      importedLine?.partSpecification === importedSnapshot.partSpecification,
      `订单行应保留导入快照 partSpecification，实际 ${importedLine?.partSpecification}`
    );
  } finally {
    await verifyPrisma.$disconnect();
  }
}

async function assertMaterialMemoryHistorySearch(orderNo, expectedPartCode, drawingNo) {
  const prisma = new PrismaClient();
  try {
    const order = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      select: {
        customerCode: true,
        customerName: true
      }
    });
    assert(order?.customerCode, `Order ${orderNo} must have customerCode for material memory history search regression`);
    assert(order?.customerName, `Order ${orderNo} must have customerName for material memory history search regression`);

    const byCustomerCode = await requestJson(`/inventory/materials?keyword=${encodeURIComponent(order.customerCode)}`);
    assert(
      byCustomerCode.some((item) => item.partCode === expectedPartCode),
      `Material memory search by historical customerCode must find ${expectedPartCode}`
    );

    const byCustomerName = await requestJson(`/inventory/materials?keyword=${encodeURIComponent(order.customerName)}`);
    assert(
      byCustomerName.some((item) => item.partCode === expectedPartCode),
      `Material memory search by historical customerName must find ${expectedPartCode}`
    );

    const byDrawingNo = await requestJson(`/inventory/materials?keyword=${encodeURIComponent(drawingNo)}`);
    assert(
      byDrawingNo.some((item) => item.partCode === expectedPartCode),
      `Material memory search by historical drawingNo must find ${expectedPartCode}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function assertDisabledMaterialMemoryExcludedFromSuggestions(partCode, customerOrderNo) {
  const prisma = new PrismaClient();
  let materialId = '';
  try {
    const material = await prisma.material.findFirst({
      where: { partCode: { equals: partCode, mode: 'insensitive' } },
      select: { id: true }
    });
    assert(material?.id, `Material ${partCode} must exist before disabled-memory suggestion regression`);
    materialId = material.id;

    const order = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: customerOrderNo, mode: 'insensitive' } },
      select: { customerId: true }
    });
    assert(order?.customerId, `Order ${customerOrderNo} must have customerId for disabled-memory suggestion regression`);

    await requestJson(`/inventory/materials/${material.id}`, { method: 'DELETE' });

    const keywordSuggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}`);
    assert(
      !keywordSuggestions.some((item) => String(item.partCode || '').toLocaleLowerCase() === partCode.toLocaleLowerCase()),
      `Disabled Material ${partCode} must not appear in keyword material suggestions`
    );

    const customerSuggestions = await requestJson(`/inventory/materials/suggestions?customerId=${encodeURIComponent(order.customerId)}`);
    assert(
      !customerSuggestions.some((item) => String(item.partCode || '').toLocaleLowerCase() === partCode.toLocaleLowerCase()),
      `Disabled Material ${partCode} must not appear in current-customer history suggestions`
    );

    const disabledMemoryRows = await requestJson(`/inventory/materials?keyword=${encodeURIComponent(partCode)}&status=DISABLED`);
    assert(
      disabledMemoryRows.some((item) => String(item.partCode || '').toLocaleLowerCase() === partCode.toLocaleLowerCase()),
      `Disabled Material ${partCode} must remain visible in disabled material-memory management`
    );
  } finally {
    if (materialId) {
      await prisma.material.update({
        where: { id: materialId },
        data: { status: 'ENABLED' }
      });
    }
    await prisma.$disconnect();
  }
}

async function assertMaterialSuggestionCustomerCodeSearch(orderNo, expectedPartCode) {
  const prisma = new PrismaClient();
  try {
    const order = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      select: {
        customerId: true,
        customerCode: true,
        customerName: true
      }
    });
    assert(order?.customerId, `订单 ${orderNo} 必须有客户 ID，才能验证当前客户历史用料聚焦推荐`);
    assert(order?.customerCode, `订单 ${orderNo} 必须有客户编码，才能验证过往客户快速检索`);

    const focusedSuggestions = await requestJson(`/inventory/materials/suggestions?customerId=${encodeURIComponent(order.customerId)}`);
    const focusedMatched = focusedSuggestions.find((item) => item.partCode === expectedPartCode);
    assert(
      focusedMatched,
      `客户已选但未输入关键字时，必须能推荐当前客户历史用料 ${expectedPartCode}`
    );
    assert(
      focusedMatched.customerUsageCount > 0,
      `当前客户历史用料必须返回 customerUsageCount，实际 ${focusedMatched.customerUsageCount}`
    );
    assert(
      focusedMatched.lastCustomerOrderNo,
      '当前客户历史用料必须返回最近订单号，便于下单人员判断是否选对'
    );

    const globalEmptySuggestions = await requestJson('/inventory/materials/suggestions');
    assert(
      Array.isArray(globalEmptySuggestions) && globalEmptySuggestions.length === 0,
      '没有关键词且没有当前客户时，物料建议不得返回全库物料'
    );

    const suggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(order.customerCode)}`);
    const matched = suggestions.find((item) => item.partCode === expectedPartCode);
    assert(
      matched,
      `用客户编码 ${order.customerCode} 搜索时必须能找到历史使用零件 ${expectedPartCode}`
    );
    assert(
      matched.matchedCustomerCode === order.customerCode,
      `客户编码搜索结果必须返回 matchedCustomerCode，实际 ${matched.matchedCustomerCode}`
    );
    assert(
      matched.matchedCustomerName === order.customerName,
      `客户编码搜索结果必须返回 matchedCustomerName，实际 ${matched.matchedCustomerName}`
    );
    assert(
      matched.searchMatchText === '客户历史匹配',
      `客户编码搜索结果必须标记客户历史匹配，实际 ${matched.searchMatchText}`
    );

    const customerNameSuggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(order.customerName)}`);
    const matchedByName = customerNameSuggestions.find((item) => item.partCode === expectedPartCode);
    assert(
      matchedByName,
      `用客户名称 ${order.customerName} 搜索时必须能找到历史使用零件 ${expectedPartCode}`
    );
    assert(
      matchedByName.matchedCustomerName === order.customerName,
      `客户名称搜索结果必须返回 matchedCustomerName，实际 ${matchedByName.matchedCustomerName}`
    );
    assert(
      matchedByName.searchMatchText === '客户历史匹配',
      `客户名称搜索结果必须标记客户历史匹配，实际 ${matchedByName.searchMatchText}`
    );

    const customerNameFragment = order.customerName.slice(0, Math.min(2, order.customerName.length));
    if (customerNameFragment && customerNameFragment !== order.customerName) {
      const fragmentSuggestions = await requestJson(
        `/inventory/materials/suggestions?keyword=${encodeURIComponent(customerNameFragment)}`
      );
      const matchedByFragment = fragmentSuggestions.find((item) => item.partCode === expectedPartCode);
      assert(
        matchedByFragment,
        `用客户名称片段 ${customerNameFragment} 搜索时必须能找到历史使用零件 ${expectedPartCode}`
      );
      assert(
        matchedByFragment.matchedCustomerName === order.customerName,
        `客户名称片段搜索结果必须返回 matchedCustomerName，实际 ${matchedByFragment.matchedCustomerName}`
      );
    }

    const customerInitials = pinyinInitials(order.customerName);
    assert(customerInitials.length >= 2, `客户名称 ${order.customerName} 必须能生成拼音首字母用于搜索回归`);
    const initialSuggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(customerInitials)}`);
    const matchedByInitials = initialSuggestions.find((item) => item.partCode === expectedPartCode);
    assert(
      matchedByInitials,
      `用客户名称拼音首字母 ${customerInitials} 搜索时必须能找到历史使用零件 ${expectedPartCode}`
    );
    assert(
      matchedByInitials.matchedCustomerName === order.customerName,
      `客户名称拼音首字母搜索结果必须返回 matchedCustomerName，实际 ${matchedByInitials.matchedCustomerName}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function assertMaterialSuggestionRecentCustomerHistorySort(recentOrderNo, expectedFirstPartCode) {
  let customerId = '';
  const prisma = new PrismaClient();
  try {
    const recentOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: recentOrderNo, mode: 'insensitive' } },
      select: { customerId: true }
    });
    assert(recentOrder?.customerId, `Order ${recentOrderNo} must have customerId for recent customer history sort regression`);
    customerId = recentOrder.customerId;
    await prisma.customerOrder.updateMany({
      where: {
        customerId,
        orderNo: { startsWith: orderPrefix }
      },
      data: { orderDate: new Date('2026-06-01T00:00:00.000Z') }
    });
    await prisma.customerOrder.updateMany({
      where: { orderNo: { equals: recentOrderNo, mode: 'insensitive' } },
      data: { orderDate: new Date('2026-07-01T00:00:00.000Z') }
    });
  } finally {
    await prisma.$disconnect();
  }

  const focusedSuggestions = await requestJson(`/inventory/materials/suggestions?customerId=${encodeURIComponent(customerId)}`);
  assert(
    focusedSuggestions[0]?.partCode === expectedFirstPartCode,
    `Current customer material suggestions must sort tied history by recent order date; first=${focusedSuggestions[0]?.partCode}`
  );
  assert(
    focusedSuggestions[0]?.lastCustomerOrderNo === recentOrderNo,
    `Current customer material suggestions must expose recent source order after sorting; actual=${focusedSuggestions[0]?.lastCustomerOrderNo}`
  );
}

async function assertMaterialSuggestionLastOrderScopedToCustomer(currentOrderNo, partCode) {
  const otherOrderNo = `${currentOrderNo}-OTHER-CUSTOMER-HISTORY`;
  const prisma = new PrismaClient();
  try {
    const currentOrder = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: currentOrderNo, mode: 'insensitive' } },
      select: {
        customerId: true,
        customerName: true,
        lines: {
          where: { partCode },
          take: 1,
          select: { partName: true, drawingNo: true, partThickness: true, quantity: true, unit: true }
        }
      }
    });
    assert(currentOrder?.customerId, `Order ${currentOrderNo} must have customerId for scoped customer history regression`);
    const sourceLine = currentOrder.lines[0];
    assert(sourceLine, `Order ${currentOrderNo} must contain ${partCode} for scoped customer history regression`);
    const otherCustomer = await prisma.customer.findFirst({
      where: {
        id: { not: currentOrder.customerId },
        status: 'ENABLED'
      },
      select: { id: true, customerCode: true, customerName: true }
    });
    assert(otherCustomer, 'Scoped customer history regression requires another enabled customer');

    await prisma.customerOrder.deleteMany({ where: { orderNo: otherOrderNo } });
    const otherCustomerPartName = `${sourceLine.partName}-其他客户误用`;
    const otherCustomerDrawingNo = `${sourceLine.drawingNo || partCode}-OTHER`;
    const otherCustomerThickness = Number(sourceLine.partThickness || 0) + 9;
    await prisma.customerOrder.create({
      data: {
        orderNo: otherOrderNo,
        customerId: otherCustomer.id,
        customerCode: otherCustomer.customerCode,
        customerName: otherCustomer.customerName,
        customerSnapshot: otherCustomer,
        orderDate: new Date('2026-08-01T00:00:00.000Z'),
        status: 'DRAFT',
        lines: {
          create: [
            {
              lineNo: 1,
              partCode,
              partName: otherCustomerPartName,
              drawingNo: otherCustomerDrawingNo,
              partThickness: otherCustomerThickness,
              quantity: 1,
              productionPlanQuantity: 1,
              unit: sourceLine.unit,
              remark: 'Scoped customer history regression'
            }
          ]
        }
      }
    });

    const suggestions = await requestJson(
      `/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}&customerId=${encodeURIComponent(currentOrder.customerId)}`
    );
    const matched = suggestions.find((item) => item.partCode === partCode);
    assert(matched, `Material suggestion must find ${partCode} when scoped by current customer`);
    assert(
      matched.lastCustomerOrderNo === currentOrderNo,
      `Material suggestion lastCustomerOrderNo must stay scoped to current customer; actual=${matched.lastCustomerOrderNo}`
    );
    assert(
      matched.lastCustomerName === currentOrder.customerName,
      `Material suggestion lastCustomerName must stay scoped to current customer; actual=${matched.lastCustomerName}`
    );
    assert(
      matched.partName === sourceLine.partName,
      `Material suggestion partName must prefer current customer history; actual=${matched.partName}`
    );
    assert(
      matched.drawingNo === sourceLine.drawingNo,
      `Material suggestion drawingNo must prefer current customer history; actual=${matched.drawingNo}`
    );
    assert(
      Number(matched.partThickness || 0) === Number(sourceLine.partThickness || 0),
      `Material suggestion partThickness must prefer current customer history; actual=${matched.partThickness}`
    );
    assert(
      matched.hasIdentityConflict === true && Number(matched.identityVariantCount || 0) >= 2,
      `Material suggestion must flag same-code identity conflicts; actual=${matched.identityVariantCount}`
    );
    const conflictFields = matched.identityConflictFields || [];
    for (const field of ['名称', '图号', '厚度']) {
      assert(
        conflictFields.includes(field),
        `Material suggestion identityConflictFields must include ${field}; actual=${conflictFields.join(',')}`
      );
    }
  } finally {
    await prisma.customerOrder.deleteMany({ where: { orderNo: otherOrderNo } });
    await prisma.$disconnect();
  }
}

async function assertMaterialSuggestionPinyinInitialSearch(keyword, expectedPartCode, expectedMatchText) {
  const suggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(keyword)}`);
  const matched = suggestions.find((item) => item.partCode === expectedPartCode);
  assert(
    matched,
    `用拼音/首字母 ${keyword} 搜索时必须能找到零件 ${expectedPartCode}`
  );
  assert(
    matched.searchMatchText === expectedMatchText,
    `拼音/首字母搜索结果必须标记 ${expectedMatchText}，实际 ${matched.searchMatchText}`
  );
  assertNoMojibake(matched.partName, '拼音/首字母搜索结果产品名称');
}

async function assertMaterialSuggestionCodeAbbreviationSearch(keyword, expectedPartCode) {
  const suggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(keyword)}`);
  const matched = suggestions.find((item) => item.partCode === expectedPartCode);
  assert(
    matched,
    `用编码缩写 ${keyword} 搜索时必须能找到零件 ${expectedPartCode}`
  );
  assert(
    matched.searchMatchText === '编码缩写匹配',
    `编码缩写搜索结果必须标记编码缩写匹配，实际 ${matched.searchMatchText}`
  );
  assertNoMojibake(matched.partName, '编码缩写搜索结果产品名称');
}

async function assertMaterialSuggestionHistoryFieldSearch(keyword, expectedPartCode, expectedMatchText, label) {
  assert(keyword, `必须提供${label}关键词，才能验证物料历史快速检索`);
  const suggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(keyword)}`);
  const matched = suggestions.find((item) => item.partCode === expectedPartCode);
  assert(
    matched,
    `用${label} ${keyword} 搜索时必须能找到历史使用零件 ${expectedPartCode}`
  );
  assert(
    matched.searchMatchText === expectedMatchText,
    `${label}搜索结果必须标记 ${expectedMatchText}，实际 ${matched.searchMatchText}`
  );
  if (expectedMatchText === '历史订单匹配') {
    assert(
      matched.matchedHistoryOrderNo === keyword,
      `${label}搜索结果必须返回 matchedHistoryOrderNo=${keyword}，实际 ${matched.matchedHistoryOrderNo}`
    );
  }
  assertNoMojibake(matched.partName, `${label}搜索结果产品名称`);
}

async function assertStockOnlySuggestionsExcludeNoStockHistory(keyword, expectedPartCode) {
  const suggestions = await requestJson(
    `/inventory/materials/suggestions?keyword=${encodeURIComponent(keyword)}&sourceType=STOCK`
  );
  assert(
    !suggestions.some((item) => item.partCode === expectedPartCode),
    `sourceType=STOCK must not return history-only Material ${expectedPartCode} when no available stock exists`
  );
}

async function assertSubmitRejectsInvalidPersistedComponentStructure(orderNo) {
  const prisma = new PrismaClient();
  try {
    const order = await prisma.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' }
        }
      }
    });
    assert(order, `未找到待破坏组件结构的订单 ${orderNo}`);
    const childLine = order.lines.find((line) => line.parentComponentNo);
    assert(childLine, `订单 ${orderNo} 必须包含子零件，才能验证提交生产前组件结构兜底校验`);
    await prisma.orderLine.update({
      where: { id: childLine.id },
      data: { parentComponentNo: 'MISSING-COMPONENT' }
    });
  } finally {
    await prisma.$disconnect();
  }

  let rejected = false;
  try {
    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
  } catch (error) {
    rejected = true;
    assert(
      String(error.message || '').includes('所属组件 MISSING-COMPONENT 在当前订单内不存在'),
      `提交生产前必须拦截数据库中异常的组件父子关系，实际错误：${error.message}`
    );
  }
  assert(rejected, '提交生产前必须拒绝数据库中组件父子关系异常的草稿订单');
}

async function deleteSubmittedOrderStatusRegressionData(orderNo) {
  const prisma = new PrismaClient();
  try {
    await prisma.productionNotice.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.productionTask.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.inventoryReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.customerOrder.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
    await prisma.orderNoReservation.deleteMany({ where: { orderNo: { equals: orderNo, mode: 'insensitive' } } });
  } finally {
    await prisma.$disconnect();
  }
}

async function assertSubmitReturnsPendingProductionStatus(customerName) {
  const orderNo = `${orderPrefix}-PENDING-PRODUCTION`;
  const partCode = `${materialPrefix}-PENDING-PRODUCTION`;
  let cleanupIndex = -1;
  try {
    await deleteSubmittedOrderStatusRegressionData(orderNo);
    const prisma = new PrismaClient();
    let customer;
    try {
      customer = await prisma.customer.findFirst({
        where: { customerName },
        orderBy: { createdAt: 'asc' },
        select: { id: true }
      });
    } finally {
      await prisma.$disconnect();
    }
    assert(customer?.id, `未找到客户 ${customerName}，无法验证提交生产状态`);

    const createdOrder = await requestJson('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.id,
        orderNo,
        orderDate: '2026-06-24',
        lines: [
          {
            lineType: 'PART',
            partCategory: '通用件',
            projectModel: '提交状态回归',
            partCode,
            partName: '提交状态回归零件',
            drawingNo: `VERIFY-${runId}-PENDING`,
            drawingVersion: 'A',
            partThickness: 1,
            partSpecification: '100mm x 100mm',
            quantity: 1,
            productionPlanQuantity: 1,
            fulfillmentMode: 'PRODUCTION',
            unit: '件',
            processSteps: [{ processName: '激光切割' }]
          }
        ]
      })
    });
    createdOrderNos.push(orderNo);
    cleanupIndex = createdOrderNos.length - 1;
    assert(createdOrder.status === 'DRAFT', `提交状态回归订单创建后必须是 DRAFT，实际 ${createdOrder.status}`);

    const submittedOrder = await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
    assert(
      submittedOrder.status === 'PENDING_PRODUCTION',
      `订单提交生产后必须返回 PENDING_PRODUCTION，实际 ${submittedOrder.status}`
    );
    const fetchedOrder = await requestJson(`/orders/${encodeURIComponent(orderNo)}`);
    assert(
      fetchedOrder.status === 'PENDING_PRODUCTION',
      `订单提交生产后详情接口必须返回 PENDING_PRODUCTION，实际 ${fetchedOrder.status}`
    );
  } finally {
    if (cleanupIndex >= 0) {
      createdOrderNos.splice(cleanupIndex, 1);
    }
    await deleteSubmittedOrderStatusRegressionData(orderNo);
  }
}

async function assertImportMissingThicknessDraftRequiresReview(customerName) {
  const orderNo = `${orderPrefix}-MISSING-THICKNESS`;
  const partCode = `${materialPrefix}-MISSING-THICKNESS`;
  const session = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: `verify-missing-thickness-${runId}` })
  });
  importSessionIds.push(session.id);

  const upload = await uploadWorkbook(
    session.id,
    await buildWorkbookBufferFromRows([
      [
        1,
        orderNo,
        '2026/6/23',
        customerName,
        '缺厚度提交拦截',
        '零件',
        1,
        '通用件',
        '',
        '',
        partCode,
        `VERIFY-${runId}-MISSING-THICKNESS`,
        '缺厚度待核对零件',
        '100mm x 100mm',
        '',
        1,
        '',
        1,
        '件',
        '',
        '缺厚度应保存为草稿待核对',
        '',
        '旧图'
      ]
    ]),
    `order-import-missing-thickness-${runId}.xlsx`
  );
  assert(upload.summary.orderCount === 1, `缺厚度回归应只预览 1 个订单，实际 ${upload.summary.orderCount}`);
  assert(upload.summary.selectableOrderCount === 1, `缺厚度订单应允许导入草稿，实际可导入 ${upload.summary.selectableOrderCount}`);
  assert(upload.summary.errorCount === 0, `缺厚度订单不应在导入预览阶段变成错误订单，实际错误 ${upload.summary.errorCount}`);
  assert(upload.summary.warningCount > 0, '缺厚度订单应在导入预览阶段产生待核对警告');
  const previewLine = upload.orders?.[0]?.rows?.find((row) => row.partCode === partCode);
  assert(previewLine, '缺厚度回归订单必须返回预览零件行');
  assert(Number(previewLine.partThickness || 0) === 0, `缺厚度预览行必须保留为 0 待核对，实际 ${previewLine.partThickness}`);
  assert(
    previewLine.issues?.some((issue) => issue.code === 'THICKNESS_DEFAULTED' && issue.message.includes('待核对')),
    '缺厚度预览行必须带 THICKNESS_DEFAULTED 待核对警告'
  );

  const commit = await requestJson(`/orders/import-sessions/${session.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allSelectable: true, previewToken: upload.previewToken })
  });
  assert(commit.createdCount === 1, `缺厚度草稿应能创建 1 个订单，实际 ${commit.createdCount}`);
  assert(commit.committedOrderNos?.includes(orderNo), '缺厚度草稿提交响应必须返回创建的订单号');
  createdOrderNos.push(orderNo);

  const createdOrder = await requestJson(`/orders/${encodeURIComponent(orderNo)}`);
  const createdLine = createdOrder.lines?.find((line) => line.partCode === partCode);
  assert(createdOrder.status === 'DRAFT', `缺厚度导入只能创建 DRAFT 草稿，实际 ${createdOrder.status}`);
  assert(Number(createdLine?.partThickness || 0) === 0, `缺厚度导入后数据库草稿必须保留 0 待核对，实际 ${createdLine?.partThickness}`);

  let rejected = false;
  try {
    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
  } catch (error) {
    rejected = true;
    assert(
      String(error.message || '').includes('厚度必须大于 0'),
      `缺厚度草稿提交生产必须被厚度校验拦截，实际错误：${error.message}`
    );
  }
  assert(rejected, '缺厚度草稿不得绕过待核对直接提交生产');
}

async function assertSubmitRejectsUnconfirmedMaterialIdentityConflict(customerName) {
  const orderNo = `${orderPrefix}-IDENTITY-BLOCK`;
  const partCode = `${materialPrefix}-IDENTITY-001`;
  const prisma = new PrismaClient();
  try {
    const customer = await prisma.customer.findFirst({
      where: { customerName },
      orderBy: { createdAt: 'asc' }
    });
    assert(customer, `未找到客户 ${customerName}，无法验证同编码多套历史资料提交拦截`);
    await prisma.customerOrder.deleteMany({ where: { orderNo } });
    await prisma.customerOrder.create({
      data: {
        orderNo,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        customerSnapshot: {
          customerCode: customer.customerCode,
          customerName: customer.customerName
        },
        orderDate: new Date('2026-06-22T00:00:00.000Z'),
        status: 'DRAFT',
        lines: {
          create: [
            {
              lineNo: 1,
              partCode,
              partName: '身份冲突验证件A',
              drawingNo: `IDENTITY-${runId}-A`,
              drawingVersion: 'A',
              partThickness: 1,
              partSpecification: '100mm x 100mm',
              quantity: 1,
              productionPlanQuantity: 1,
              fulfillmentMode: 'PRODUCTION',
              unit: '件',
              lineType: 'PART',
              projectModel: '身份冲突A'
            },
            {
              lineNo: 2,
              partCode,
              partName: '身份冲突验证件B',
              drawingNo: `IDENTITY-${runId}-B`,
              drawingVersion: 'B',
              partThickness: 2,
              partSpecification: '200mm x 200mm',
              quantity: 1,
              productionPlanQuantity: 1,
              fulfillmentMode: 'PRODUCTION',
              unit: '件',
              lineType: 'PART',
              projectModel: '身份冲突B'
            }
          ]
        }
      }
    });
    createdOrderNos.push(orderNo);
  } finally {
    await prisma.$disconnect();
  }

  let rejectedWithoutConfirmation = false;
  try {
    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001' })
    });
  } catch (error) {
    rejectedWithoutConfirmation = true;
    assert(
      String(error.message || '').includes('发现同编码多套历史资料零件，提交生产前必须确认已核对'),
      `提交生产必须先拦截未确认的同编码多套历史资料风险，实际错误：${error.message}`
    );
  }
  assert(rejectedWithoutConfirmation, '提交生产必须拒绝未确认的同编码多套历史资料风险');

  let rejectedAfterConfirmation = false;
  try {
    await requestJson(`/orders/${encodeURIComponent(orderNo)}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submittedByCode: 'PLAN-001', materialIdentityConfirmed: true })
    });
  } catch (error) {
    rejectedAfterConfirmation = true;
    assert(
      !String(error.message || '').includes('同编码多套历史资料'),
      `带 materialIdentityConfirmed 后不应继续被同编码资料风险拦截，实际错误：${error.message}`
    );
  }
  assert(rejectedAfterConfirmation, '带确认标记后仍应继续执行后续提交校验，而不是绕过所有校验');
}

async function assertSelectedCommitSupportsUnloadedOrders(customerName) {
  const uploadDir = await orderImportUploadDir();
  const selectedSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-selected-unloaded-order' })
  });
  importSessionIds.push(selectedSession.id);
  await uploadWorkbook(
    selectedSession.id,
    await buildSelectedCommitWorkbookBuffer(customerName),
    `order-import-selected-${runId}.xlsx`
  );
  const firstPage = await requestJson(`/orders/import-sessions/${selectedSession.id}?orderLimit=1&orderOffset=0`);
  assert(firstPage.orders.length === 1, `分页预览应只加载 1 个订单，实际 ${firstPage.orders.length}`);
  assert(firstPage.orderPage?.hasMore === true, '分页预览应提示还有未加载订单');
  assert(
    !firstPage.orders.some((order) => order.orderNo === `${orderPrefix}-PAGE-003`),
    '分页外订单不应出现在第一页预览中'
  );
  const selectedCommit = await requestJson(`/orders/import-sessions/${selectedSession.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderNos: [`${orderPrefix}-PAGE-003`], previewToken: firstPage.previewToken })
  });
  assert(selectedCommit.createdCount === 1, `只创建分页外已选订单时应创建 1 个草稿，实际 ${selectedCommit.createdCount}`);
  assert(selectedCommit.materialSyncCount === 1, `分页外已选订单应补建 1 个缺失零件搜索记忆，实际 ${selectedCommit.materialSyncCount}`);
  assert(
    selectedCommit.materialSyncPreview?.[0] === `${materialPrefix}-PAGE-003`,
    `分页外已选订单应返回零件编码示例 ${materialPrefix}-PAGE-003，实际 ${selectedCommit.materialSyncPreview}`
  );
  assert(
    selectedCommit.committedOrderNos?.[0] === `${orderPrefix}-PAGE-003`,
    '后端必须支持创建未加载预览页中的已选订单号'
  );
  createdOrderNos.push(`${orderPrefix}-PAGE-003`);

  const committedRejectedFileName = `order-import-committed-reject-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    selectedSession.id,
    await buildSelectedCommitWorkbookBuffer(customerName),
    '400 Bad Request',
    committedRejectedFileName
  );
  assertNoStoredImportFilesMatching(
    uploadDir,
    committedRejectedFileName.replace(/\.xlsx$/i, ''),
    'committed import session rejected upload'
  );
}

async function assertAllSelectableCommitSupportsExcludedOrders(customerName) {
  const excludedSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-all-selectable-excluded' })
  });
  importSessionIds.push(excludedSession.id);

  const preview = await uploadWorkbook(
    excludedSession.id,
    await buildExcludedCommitWorkbookBuffer(customerName),
    `order-import-excluded-${runId}.xlsx`
  );
  const selectable = await requestJson(`/orders/import-sessions/${excludedSession.id}/selectable-order-nos`);
  assert(selectable.orderNos.length === 3, `排除提交验证应有 3 个可导入订单，实际 ${selectable.orderNos.length}`);
  assert(
    selectable.orders?.some((order) => order.orderNo === `${orderPrefix}-EXCLUDE-002` && order.warningCount > 0),
    '可选订单号接口必须返回每个可导入订单的警告数量，便于前端按实际勾选范围确认'
  );
  await commitImportSessionExpectFailure(
    excludedSession.id,
    {
      orderNos: [`${orderPrefix}-EXCLUDE-001`],
      excludedOrderNos: [`${orderPrefix}-EXCLUDE-002`],
      previewToken: preview.previewToken
    },
    '只有全部可导入模式'
  );
  await commitImportSessionExpectFailure(
    excludedSession.id,
    {
      allSelectable: true,
      excludedOrderNos: [`${orderPrefix}-EXCLUDE-002`, `${orderPrefix}-EXCLUDE-002`],
      previewToken: preview.previewToken
    },
    '排除的订单编号存在空值或重复'
  );
  await commitImportSessionExpectFailure(
    excludedSession.id,
    {
      allSelectable: true,
      excludedOrderNos: [`${orderPrefix}-EXCLUDE-MISSING`],
      previewToken: preview.previewToken
    },
    '排除的订单不存在或已不可导入'
  );

  const commit = await requestJson(`/orders/import-sessions/${excludedSession.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      allSelectable: true,
      excludedOrderNos: [`${orderPrefix}-EXCLUDE-002`],
      previewToken: preview.previewToken
    })
  });
  assert(commit.createdCount === 2, `全部可导入排除 1 个订单后应创建 2 个草稿，实际 ${commit.createdCount}`);
  assert(commit.materialSyncCount === 2, `全部可导入排除 1 个订单后应补建 2 个缺失零件搜索记忆，实际 ${commit.materialSyncCount}`);
  assert(
    commit.materialSyncPreview?.includes(`${materialPrefix}-EXCLUDE-001`) &&
      !commit.materialSyncPreview?.includes(`${materialPrefix}-EXCLUDE-002`),
    `排除提交的零件编码示例不应包含被排除订单零件，实际 ${commit.materialSyncPreview}`
  );
  assert(commit.excludedOrderCount === 1, `全部可导入排除提交应返回 excludedOrderCount=1，实际 ${commit.excludedOrderCount}`);
  assert(
    commit.skippedSelectableCount === 1,
    `全部可导入排除提交应返回 skippedSelectableCount=1，实际 ${commit.skippedSelectableCount}`
  );
  assert(
    commit.committedOrderNos.includes(`${orderPrefix}-EXCLUDE-001`) &&
      commit.committedOrderNos.includes(`${orderPrefix}-EXCLUDE-003`) &&
      !commit.committedOrderNos.includes(`${orderPrefix}-EXCLUDE-002`),
    'allSelectable + excludedOrderNos 必须只创建未排除的可导入订单'
  );
  createdOrderNos.push(`${orderPrefix}-EXCLUDE-001`, `${orderPrefix}-EXCLUDE-003`);
}

async function assertStaleImportPreviewTokenRejectsCommit(customerName) {
  const staleSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-stale-preview-token' })
  });
  importSessionIds.push(staleSession.id);

  const firstPreview = await uploadWorkbook(
    staleSession.id,
    await buildSelectedCommitWorkbookBuffer(customerName),
    `order-import-stale-token-a-${runId}.xlsx`
  );
  assert(firstPreview.previewToken, '导入预览必须返回 previewToken');

  await commitImportSessionExpectFailure(
    staleSession.id,
    { allSelectable: true },
    'previewToken'
  );

  await uploadWorkbook(
    staleSession.id,
    await buildSplitWorkbookBuffer(customerName, [
      ['组件', 1, '定制件', 'C001', '', `${materialPrefix}-STALE-001`, `VERIFY-${runId}-STALE-00`, '旧预览令牌验证组件', '', '2mm', 3, 1, 3, '套', '装配', '新增文件后旧预览必须失效', '', '旧图']
    ]),
    `order-import-stale-token-b-${runId}.xlsx`
  );

  await commitImportSessionExpectFailure(
    staleSession.id,
    { allSelectable: true, previewToken: firstPreview.previewToken },
    '导入预览已变化'
  );
  const afterRejectedCommit = await requestJson(`/orders/import-sessions/${staleSession.id}`);
  assert(afterRejectedCommit.status === 'DRAFT', '旧 previewToken 被拒绝后导入会话必须仍保持 DRAFT，允许刷新后重新提交');
  assert(
    afterRejectedCommit.previewToken && afterRejectedCommit.previewToken !== firstPreview.previewToken,
    '新增上传文件后刷新预览必须生成新的 previewToken'
  );
}

async function assertRejectedAndDuplicateUploadsStayClean(customerName) {
  const uploadDir = await orderImportUploadDir();
  const rejectedSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-rejected-upload-cleanup' })
  });
  importSessionIds.push(rejectedSession.id);
  const missingSheetFileName = `order-import-no-upload-sheet-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    rejectedSession.id,
    await buildWorkbookWithoutUploadSheetBuffer(),
    'ERP上传净表',
    missingSheetFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, missingSheetFileName.replace(/\.xlsx$/i, ''), '缺少 ERP上传净表 的失败上传');
  const blankRowFileName = `order-import-blank-row-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    rejectedSession.id,
    await buildWorkbookWithBlankRowInMiddleBuffer(customerName),
    '必须连续填写',
    blankRowFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, blankRowFileName.replace(/\.xlsx$/i, ''), '中间空行的失败上传');
  const orderHeadFileName = `order-import-order-head-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    rejectedSession.id,
    await buildWorkbookWithOrderHeadRowBuffer(customerName),
    '不允许包含订单头行',
    orderHeadFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, orderHeadFileName.replace(/\.xlsx$/i, ''), '订单头行的失败上传');
  const missingHeaderFileName = `order-import-missing-header-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    rejectedSession.id,
    await buildWorkbookWithMissingRequiredHeaderBuffer(customerName),
    '缺少表头',
    missingHeaderFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, missingHeaderFileName.replace(/\.xlsx$/i, ''), '缺少必填表头的失败上传');
  const emptyUploadSheetFileName = `order-import-empty-upload-sheet-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    rejectedSession.id,
    await buildWorkbookWithEmptyUploadSheetBuffer(),
    '没有可导入',
    emptyUploadSheetFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, emptyUploadSheetFileName.replace(/\.xlsx$/i, ''), '空 ERP上传净表 的失败上传');
  const rejectedPreview = await requestJson(`/orders/import-sessions/${rejectedSession.id}`);
  assert(rejectedPreview.summary.fileCount === 0, `失败上传后不应留下导入文件记录，实际 ${rejectedPreview.summary.fileCount}`);
  assert(rejectedPreview.summary.rowCount === 0, `失败上传后不应留下导入行，实际 ${rejectedPreview.summary.rowCount}`);

  const duplicateSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-duplicate-upload' })
  });
  importSessionIds.push(duplicateSession.id);
  const buffer = await buildSelectedCommitWorkbookBuffer(customerName);
  const firstUpload = await uploadWorkbook(duplicateSession.id, buffer, `order-import-duplicate-a-${runId}.xlsx`);
  assert(firstUpload.summary.fileCount === 1, `首次上传后应只有 1 个文件，实际 ${firstUpload.summary.fileCount}`);
  assert(firstUpload.summary.rowCount === 3, `首次上传后应读取 3 行，实际 ${firstUpload.summary.rowCount}`);
  const duplicateRejectedFileName = `order-import-duplicate-b-${runId}.xlsx`;
  await uploadWorkbookExpectFailure(
    duplicateSession.id,
    buffer,
    '已上传到当前导入会话',
    duplicateRejectedFileName
  );
  assertNoStoredImportFilesMatching(uploadDir, duplicateRejectedFileName.replace(/\.xlsx$/i, ''), '重复上传被拒绝的文件');
  const duplicatePreview = await requestJson(`/orders/import-sessions/${duplicateSession.id}`);
  assert(duplicatePreview.summary.fileCount === 1, `重复上传后文件记录仍应为 1，实际 ${duplicatePreview.summary.fileCount}`);
  assert(duplicatePreview.summary.rowCount === 3, `重复上传后导入行仍应为 3，实际 ${duplicatePreview.summary.rowCount}`);
}

async function firstStoredImportFile(sessionIdForLookup) {
  const prisma = new PrismaClient();
  try {
    const file = await prisma.orderImportFile.findFirst({
      where: { sessionId: sessionIdForLookup },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, storedFileName: true }
    });
    assert(file?.storedFileName, `导入会话 ${sessionIdForLookup} 必须存在已落盘的上传文件`);
    return file;
  } finally {
    await prisma.$disconnect();
  }
}

async function assertImportFileDeletionRemovesStoredFile(customerName) {
  const uploadDir = await orderImportUploadDir();
  const fileDeleteSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-delete-import-file-cleanup' })
  });
  importSessionIds.push(fileDeleteSession.id);
  await uploadWorkbook(
    fileDeleteSession.id,
    await buildSelectedCommitWorkbookBuffer(customerName),
    `order-import-file-delete-${runId}.xlsx`
  );
  const storedFile = await firstStoredImportFile(fileDeleteSession.id);
  const storedPath = join(uploadDir, storedFile.storedFileName);
  assert(existsSync(storedPath), `删除上传文件前服务器端 Excel 必须存在：${storedPath}`);
  const afterDelete = await requestJson(`/orders/import-sessions/${fileDeleteSession.id}/files/${storedFile.id}`, { method: 'DELETE' });
  assert(afterDelete.deletedFileCount === 1, `删除上传文件应返回 deletedFileCount=1，实际 ${afterDelete.deletedFileCount}`);
  assert(afterDelete.summary.fileCount === 0, `删除上传文件后文件记录应为 0，实际 ${afterDelete.summary.fileCount}`);
  assert(afterDelete.summary.rowCount === 0, `删除上传文件后导入行应为 0，实际 ${afterDelete.summary.rowCount}`);
  assert(!existsSync(storedPath), `删除上传文件后服务器端 Excel 必须同步删除：${storedPath}`);

  const discardSession = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdBy: 'verify-discard-import-file-cleanup' })
  });
  importSessionIds.push(discardSession.id);
  await uploadWorkbook(
    discardSession.id,
    await buildSelectedCommitWorkbookBuffer(customerName),
    `order-import-discard-${runId}.xlsx`
  );
  const discardStoredFile = await firstStoredImportFile(discardSession.id);
  const discardStoredPath = join(uploadDir, discardStoredFile.storedFileName);
  assert(existsSync(discardStoredPath), `放弃导入前服务器端 Excel 必须存在：${discardStoredPath}`);
  const discardResult = await requestJson(`/orders/import-sessions/${discardSession.id}`, { method: 'DELETE' });
  assert(discardResult.deletedFileCount === 1, `放弃导入应删除 1 个服务器端 Excel，实际 ${discardResult.deletedFileCount}`);
  assert(!existsSync(discardStoredPath), `放弃导入后服务器端 Excel 必须同步删除：${discardStoredPath}`);
}

async function main() {
  try {
    await requestJson('/health');
    await assertCustomerSearchRanking();
    const customerName = await firstEnabledCustomerName();
    await assertTemplateWorkbook(await downloadTemplate());
    await verifyBundledWorkbookUploadPreviews();
    await assertRejectedAndDuplicateUploadsStayClean(customerName);
    await assertImportFileDeletionRemovesStoredFile(customerName);
    await assertSelectedCommitSupportsUnloadedOrders(customerName);
    await assertAllSelectableCommitSupportsExcludedOrders(customerName);
    await assertStaleImportPreviewTokenRejectsCommit(customerName);
    await assertOrderImportDoesNotOverwriteExistingMaterial(customerName);
    await assertImportMissingThicknessDraftRequiresReview(customerName);
    const session = await requestJson('/orders/import-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ createdBy: 'verify-order-import-api' })
    });
    sessionId = session.id;
    importSessionIds.push(session.id);

    const mainUploadFileName = `组件零件导入验证-${runId}.xlsx`;
    let upload = await uploadWorkbook(sessionId, await buildWorkbookBuffer(customerName), mainUploadFileName);
    assert(upload.summary.orderCount === 4, `期望 4 个订单，实际 ${upload.summary.orderCount}`);
    assert(upload.summary.rowCount === 9, `期望 9 行明细，实际 ${upload.summary.rowCount}`);
    assert(upload.summary.selectableOrderCount === 3, `期望 3 个可导入订单，实际 ${upload.summary.selectableOrderCount}`);
    assert(upload.summary.blockedOrderCount === 1, `期望 1 个被拦截订单，实际 ${upload.summary.blockedOrderCount}`);
    assert(upload.summary.materialSyncCount === 5, `预览应统计 5 个非组件零件编码，实际 ${upload.summary.materialSyncCount}`);
    assert(
      upload.summary.materialSyncPreview?.includes(`${materialPrefix}-001`) &&
        !upload.summary.materialSyncPreview?.includes(`${materialPrefix}-002`) &&
        !upload.summary.materialSyncPreview?.includes(`${materialPrefix}-BAD`),
      `预览零件编码示例应来自可导入订单且排除错误订单，实际 ${upload.summary.materialSyncPreview}`
    );
    assert(upload.summary.errorCount > 0, '错误订单应在预览阶段产生错误');
    const invalidOrder = upload.orders.find((order) => order.orderNo === `${orderPrefix}-BAD`);
    assert(invalidOrder?.orderDate === '', `缺少制单日期的错误订单预览不应显示占位日期，实际 ${invalidOrder?.orderDate}`);
    const invalidThicknessLine = invalidOrder?.rows?.find((row) => row.partCode === `${materialPrefix}-BAD`);
    assert(
      Number(invalidThicknessLine?.partThickness || 0) === 0,
      `订单导入缺厚度零件必须保留为 0 待核对，实际 ${invalidThicknessLine?.partThickness}`
    );
    assert(
      invalidThicknessLine?.issues?.some((issue) => issue.code === 'THICKNESS_DEFAULTED' && issue.message.includes('待核对')),
      '订单导入缺厚度零件必须产生 THICKNESS_DEFAULTED 待核对警告'
    );
    const previewComponentLine = upload.orders
      .flatMap((order) => order.rows || [])
      .find((row) => row.lineType === 'COMPONENT' && row.componentNo === 'C001');
    assert(previewComponentLine, '订单导入预览必须识别父级组件行');
    assert(
      Number(previewComponentLine.partThickness || 0) === 0,
      `订单导入父级组件行厚度必须按不适用处理为 0，实际 ${previewComponentLine.partThickness}`
    );
    assert(
      !previewComponentLine.issues?.some((issue) => issue.code === 'THICKNESS_DEFAULTED'),
      '订单导入父级组件行不应产生 THICKNESS_DEFAULTED 厚度待核对警告'
    );
    assert(
      invalidOrder?.rows?.some((row) => row.issues?.some((issue) => issue.code === 'PART_COMPONENT_NO_NOT_ALLOWED')),
      '零件行误填组件编号必须在预览阶段拦截'
    );
    await assertImportSessionFilePreview(sessionId, upload.files[0].id, mainUploadFileName);
    await assertIssueReportWorkbook(await downloadIssueReport(sessionId), {
      requiredCodes: ['PART_COMPONENT_NO_NOT_ALLOWED']
    });
    assert(upload.orders.every((order) => order.rows.length > 0), '分页预览应返回当前页订单明细');

    await uploadWorkbook(
      sessionId,
      await buildSplitWorkbookBuffer(customerName, [
        ['组件', 1, '定制件', 'C001', '', `${materialPrefix}-SPLIT-001`, `VERIFY-${runId}-SPLIT-00`, '跨文件组件', '', '2mm', 5, 1, 5, '套', '装配', '第一份文件只有组件', '', '旧图']
      ])
    );
    upload = await uploadWorkbook(
      sessionId,
      await buildSplitWorkbookBuffer(customerName, [
        ['零件', '', '定制件', '', '', `${materialPrefix}-SPLIT-002`, `VERIFY-${runId}-SPLIT-A`, '跨文件自动绑定子件', '', '1mm', '', 3, '', '件', '激光切割', '第二份文件缺少所属组件，后端应按会话兜底绑定', '', '旧图']
      ])
    );
    assert(upload.summary.orderCount === 5, `连续上传后期望 5 个订单，实际 ${upload.summary.orderCount}`);
    assert(upload.summary.rowCount === 11, `连续上传后期望 11 行明细，实际 ${upload.summary.rowCount}`);
    assert(upload.summary.selectableOrderCount === 4, `连续上传后期望 4 个可导入订单，实际 ${upload.summary.selectableOrderCount}`);
    assert(upload.summary.materialSyncCount === 6, `连续上传后应统计 6 个非组件零件编码，实际 ${upload.summary.materialSyncCount}`);
    const splitOrder = upload.orders.find((order) => order.orderNo === `${orderPrefix}-SPLIT`);
    assert(splitOrder?.errorCount === 0, '跨文件连续上传的同一订单应能通过会话级组件兜底绑定');
    assert(
      splitOrder?.rows?.some((row) => row.parentComponentNo === 'C001' && Number(row.demandQuantity) === 15),
      '跨文件子零件应自动绑定到上一文件的组件，并按父组件需求数量×单套用量计算'
    );
    await assertIssueReportWorkbook(await downloadIssueReport(sessionId), {
      requiredCodes: ['PART_COMPONENT_NO_NOT_ALLOWED'],
      forbiddenOrderCodePairs: [{ orderNo: `${orderPrefix}-SPLIT`, code: 'DEMAND_QUANTITY_REQUIRED' }]
    });
    const historyAfterSplit = await requestJson('/orders/import-sessions?limit=20&offset=0');
    const historySession = historyAfterSplit.items?.find((item) => item.id === sessionId);
    assert(historySession, '导入记录列表必须包含刚创建的导入会话');
    assert(
      historySession.selectableOrderCount === 4,
      `导入记录列表必须按跨文件组件关系统计 4 个可导入订单，实际 ${historySession.selectableOrderCount}`
    );
    assert(
      historySession.blockedOrderCount === 1,
      `导入记录列表必须按跨文件组件关系统计 1 个不可导入订单，实际 ${historySession.blockedOrderCount}`
    );
    assert(
      historySession.materialSyncCount === 6,
      `导入记录列表必须统计 6 个非组件零件编码，实际 ${historySession.materialSyncCount}`
    );
    assert(
      historySession.materialSyncPreview?.includes(`${materialPrefix}-001`) &&
        !historySession.materialSyncPreview?.includes(`${materialPrefix}-002`) &&
        !historySession.materialSyncPreview?.includes(`${materialPrefix}-BAD`),
      `导入记录列表零件编码示例应来自可导入订单且排除错误订单，实际 ${historySession.materialSyncPreview}`
    );

    const selectable = await requestJson(`/orders/import-sessions/${sessionId}/selectable-order-nos`);
    assert(selectable.orderNos.length === 4, `期望 4 个可选订单号，实际 ${selectable.orderNos.length}`);
    assert(selectable.orders?.length === 4, `可选订单号接口应返回 4 个轻量订单摘要，实际 ${selectable.orders?.length}`);

    const commit = await requestJson(`/orders/import-sessions/${sessionId}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allSelectable: true, previewToken: upload.previewToken })
  });
    assert(commit.createdCount === 4, `期望创建 4 个草稿订单，实际 ${commit.createdCount}`);
    assert(commit.materialSyncCount === 6, `期望补建 6 个非组件零件搜索记忆，实际 ${commit.materialSyncCount}`);
    assert(
      commit.materialSyncPreview?.includes(`${materialPrefix}-001`) &&
        !commit.materialSyncPreview?.includes(`${materialPrefix}-002`) &&
        !commit.materialSyncPreview?.includes(`${materialPrefix}-BAD`),
      `提交响应零件编码示例应来自已创建草稿，实际 ${commit.materialSyncPreview}`
    );
    assert(commit.skippedBlockedCount === 1, `期望跳过 1 个错误订单，实际 ${commit.skippedBlockedCount}`);
    assert(commit.skippedSelectableCount === 0, `整批创建不应跳过可导入订单，实际 ${commit.skippedSelectableCount}`);
    const mainCreatedOrderNos = [];
    for (const order of commit.createdOrders || []) {
      mainCreatedOrderNos.push(order.orderNo);
      createdOrderNos.push(order.orderNo);
    }
    assert(mainCreatedOrderNos.length === 4, '提交响应应返回 4 个创建订单摘要');
    assert(
      Array.isArray(commit.committedOrderNos) && commit.committedOrderNos.length === 4,
      '提交响应必须返回实际生成的订单号列表'
    );
    assert(
      !commit.committedOrderNos.includes(`${orderPrefix}-BAD`),
      '实际生成订单号列表不得包含被预览错误阻断的订单'
    );

    const committedImportSession = await requestJson(`/orders/import-sessions/${sessionId}`);
    assert(committedImportSession.status === 'COMMITTED', '提交后的导入会话状态必须是 COMMITTED');
    assert(
      committedImportSession.summary.committedOrderCount === 4,
      `提交后的导入会话必须记录 4 个实际生成订单，实际 ${committedImportSession.summary.committedOrderCount}`
    );
    assert(
      committedImportSession.committedOrderNos.includes(`${orderPrefix}-SPLIT`) &&
        !committedImportSession.committedOrderNos.includes(`${orderPrefix}-BAD`),
      '导入会话只应保存实际生成的订单号，不能混入错误订单'
    );
    await assertImportedMaterialsUpserted(
      [
        `${materialPrefix}-001`,
        `${materialPrefix}-003`,
        `${materialPrefix}-004`,
        `${materialPrefix}-006`,
        `${materialPrefix}-008`,
        `${materialPrefix}-SPLIT-002`
      ],
      [
        `${materialPrefix}-BAD`,
        `${materialPrefix}-002`,
        `${materialPrefix}-005`,
        `${materialPrefix}-007`,
        `${materialPrefix}-SPLIT-001`
      ]
    );
    await assertMaterialSuggestionCustomerCodeSearch(`${orderPrefix}-001`, `${materialPrefix}-001`);
    await assertMaterialSuggestionRecentCustomerHistorySort(`${orderPrefix}-002`, `${materialPrefix}-004`);
    await assertMaterialSuggestionLastOrderScopedToCustomer(`${orderPrefix}-001`, `${materialPrefix}-001`);
    await assertMaterialSuggestionCodeAbbreviationSearch('mat001', `${materialPrefix}-001`);
    await assertMaterialSuggestionPinyinInitialSearch('yzdg', `${materialPrefix}-001`, '名称拼音匹配');
    await assertMaterialSuggestionPinyinInitialSearch('yz', `${materialPrefix}-001`, '名称拼音匹配');

    const createdOrder = await requestJson(`/orders/${encodeURIComponent(mainCreatedOrderNos[0])}`);
    assert(createdOrder.status === 'DRAFT', 'Excel 导入只能创建 DRAFT 草稿订单');
    const longRemarkLine = createdOrder.lines.find((line) => line.partCode === `${materialPrefix}-001`);
    assert(
      longRemarkLine?.remark?.includes(longProcessRemark),
      'Excel 长工艺备注导入后必须完整保留，不能设置业务字数截断'
    );
    assert(longRemarkLine?.drawingNo, '导入验证零件必须保留图号，才能验证图号快速检索');
    assert(longRemarkLine?.drawingDate, '导入验证零件必须保留图纸日期，才能验证图纸日期快速检索');
    assert(longRemarkLine?.projectModel, '导入验证零件必须保留项目型号，才能验证项目型号快速检索');
    assert(longRemarkLine?.partThickness, '导入验证零件必须保留厚度，才能验证厚度快速检索');
    await assertMaterialMemoryHistorySearch(createdOrder.orderNo, longRemarkLine.partCode, longRemarkLine.drawingNo);
    await assertMaterialSuggestionHistoryFieldSearch(longRemarkLine.drawingNo, longRemarkLine.partCode, '图纸资料匹配', '图号');
    await assertMaterialSuggestionHistoryFieldSearch(longRemarkLine.drawingDate, longRemarkLine.partCode, '图纸资料匹配', '图纸日期');
    await assertMaterialSuggestionHistoryFieldSearch(
      longRemarkLine.drawingDate.replace(/-0/g, '-'),
      longRemarkLine.partCode,
      '图纸资料匹配',
      '不补零图纸日期'
    );
    await assertMaterialSuggestionHistoryFieldSearch(longRemarkLine.projectModel, longRemarkLine.partCode, '图纸资料匹配', '项目型号');
    await assertMaterialSuggestionHistoryFieldSearch(`${longRemarkLine.partThickness}mm`, longRemarkLine.partCode, '图纸资料匹配', '厚度');
    await assertMaterialSuggestionHistoryFieldSearch(
      `${Number(longRemarkLine.partThickness).toFixed(1)}mm`,
      longRemarkLine.partCode,
      '图纸资料匹配',
      '厚度带小数'
    );
    await assertMaterialSuggestionHistoryFieldSearch(createdOrder.orderNo, longRemarkLine.partCode, '历史订单匹配', '历史订单号');
    await assertStockOnlySuggestionsExcludeNoStockHistory(longRemarkLine.partCode, longRemarkLine.partCode);
    await assertSubmitRejectsUnconfirmedMaterialIdentityConflict(customerName);
    await assertDisabledMaterialMemoryExcludedFromSuggestions(`${materialPrefix}-SPLIT-002`, `${orderPrefix}-SPLIT`);
    const componentLine = createdOrder.lines.find((line) => line.lineType === 'COMPONENT' && line.componentNo === 'C001');
    assert(componentLine, '导入订单应保留组件行和组件编号');
    assert(Number(componentLine.partThickness || 0) === 0, `导入订单组件行厚度必须保存为 0，实际 ${componentLine.partThickness}`);
    const childLine = createdOrder.lines.find((line) => line.parentComponentNo === 'C001');
    assert(childLine, '导入订单应保留子零件所属组件编号');
    assert(Number(childLine.quantity) === 80, `子零件需求数量应为父组件需求数量×单套用量，实际 ${childLine.quantity}`);
    assert(
      createdOrder.lines.some((line) => line.sourceImportSessionId === sessionId),
      '导入草稿订单必须保留来源导入会话，便于追查 Excel 来源'
    );
    await assertImportSourcePreview(createdOrder);

    const editableOrderNo = `${createdOrder.orderNo}-EDIT`;
    const updatedOrder = await requestJson(`/orders/${encodeURIComponent(createdOrder.orderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo: editableOrderNo,
        deliveryDate: createdOrder.deliveryDate,
        remark: 'API 回归：导入草稿可编辑',
        lines: createdOrder.lines.map((line, index) =>
          toOrderUpdateLine(line, index === 0 ? { remark: '导入后编辑保留组件结构和来源信息' } : {})
        )
      })
    });
    mainCreatedOrderNos[0] = editableOrderNo;
    const createdOrderCleanupIndex = createdOrderNos.indexOf(createdOrder.orderNo);
    if (createdOrderCleanupIndex >= 0) {
      createdOrderNos[createdOrderCleanupIndex] = editableOrderNo;
    } else {
      createdOrderNos.push(editableOrderNo);
    }
    assert(updatedOrder.orderNo === editableOrderNo, '导入草稿订单应允许编辑订单号');
    assertNoBlankOptionalOrderLineText(updatedOrder, '导入草稿编辑后');
    assert(
      updatedOrder.lines.some((line) => line.lineType === 'COMPONENT' && line.componentNo === 'C001'),
      '导入草稿编辑后必须保留组件编号'
    );
    assert(
      updatedOrder.lines.some((line) => line.parentComponentNo === 'C001' && Number(line.quantity) === 80),
      '导入草稿编辑后必须保留子零件所属组件和需求数量'
    );
    assert(
      updatedOrder.lines.some((line) => line.sourceImportSessionId === sessionId),
      '导入草稿编辑后必须保留来源导入会话'
    );
    await assertImportSourcePreview(updatedOrder);
    const staleImportSourceOrder = await requestJson(`/orders/${encodeURIComponent(editableOrderNo)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderNo: editableOrderNo,
        deliveryDate: updatedOrder.deliveryDate,
        remark: 'API 回归：导入来源文件 ID 失效时仍可编辑草稿',
        lines: updatedOrder.lines.map((line, index) =>
          toOrderUpdateLine(line, index === 0 ? { sourceImportFileId: '00000000-0000-0000-0000-000000000000' } : {})
        )
      })
    });
    assert(
      staleImportSourceOrder.lines.length === updatedOrder.lines.length,
      '导入来源文件 ID 失效时，草稿编辑不能因为外键错误失败'
    );
    assertNoBlankOptionalOrderLineText(staleImportSourceOrder, '导入来源失效编辑后');
    const recoveredImportSourceLine = staleImportSourceOrder.lines.find((line) => line.partCode === updatedOrder.lines[0].partCode);
    assert(
      recoveredImportSourceLine?.sourceImportFileId &&
        recoveredImportSourceLine.sourceImportFileId !== '00000000-0000-0000-0000-000000000000',
      '导入来源文件 ID 失效时，订单详情应通过来源会话和 Excel 行号重新找回正确文件'
    );
    await assertImportSourcePreview(staleImportSourceOrder);
    const renamedImportSession = await requestJson(`/orders/import-sessions/${sessionId}`);
    assert(
      renamedImportSession.currentCommittedOrderNos.includes(editableOrderNo),
      '导入记录现存订单号应跟随订单编辑结果'
    );
    assert(
      !renamedImportSession.currentCommittedOrderNos.includes(createdOrder.orderNo),
      '导入记录现存订单号不应继续显示编辑前订单号'
    );
    assert(
      renamedImportSession.committedOrderNos.includes(createdOrder.orderNo),
      '导入记录提交时生成订单号应保留原始提交清单'
    );
    const deleteEdited = await requestJson(`/orders/${encodeURIComponent(editableOrderNo)}`, { method: 'DELETE' });
    assert(deleteEdited.deleted === true, '导入错误的草稿订单应允许删除');
    mainCreatedOrderNos.splice(0, 1);
    const deletedOrderCleanupIndex = createdOrderNos.indexOf(editableOrderNo);
    if (deletedOrderCleanupIndex >= 0) {
      createdOrderNos.splice(deletedOrderCleanupIndex, 1);
    }
    const afterDeleteImportSession = await requestJson(`/orders/import-sessions/${sessionId}`);
    assert(
      afterDeleteImportSession.summary.currentCommittedOrderCount === 3,
      `删除导入订单后现存订单数量应变为 3，实际 ${afterDeleteImportSession.summary.currentCommittedOrderCount}`
    );
    assert(
      !afterDeleteImportSession.currentCommittedOrderNos.includes(editableOrderNo),
      '删除导入订单后导入记录现存订单列表不应继续显示已删除订单'
    );
    assert(
      afterDeleteImportSession.summary.committedOrderCount === 4,
      '删除导入草稿后提交时生成订单统计仍应保留原始 4 个记录'
    );

    const customComponentOrder = await requestJson(`/orders/${encodeURIComponent(`${orderPrefix}-003`)}`);
    assert(
      customComponentOrder.lines.some((line) => line.lineType === 'COMPONENT' && line.componentNo === 'ASM-X1'),
      '导入订单应允许非 C001-C9999 的自定义组件编号'
    );
    assert(
      customComponentOrder.lines.some((line) => line.parentComponentNo === 'ASM-X1' && Number(line.quantity) === 12),
      '自定义组件编号的子零件必须按父组件需求数量计算需求数量'
    );

    const splitCreatedOrder = await requestJson(`/orders/${encodeURIComponent(`${orderPrefix}-SPLIT`)}`);
    assert(
      splitCreatedOrder.lines.some((line) => line.parentComponentNo === 'C001' && Number(line.quantity) === 15),
      '跨文件连续上传创建草稿后必须保留自动绑定的所属组件和需求数量'
    );
    await assertSubmitRejectsInvalidPersistedComponentStructure(`${orderPrefix}-SPLIT`);
    await assertSubmitReturnsPendingProductionStatus(customerName);

    const committedStoredFile = await firstStoredImportFile(sessionId);
    const committedStoredPath = join(await orderImportUploadDir(), committedStoredFile.storedFileName);
    assert(existsSync(committedStoredPath), `删除已提交导入记忆前服务器端 Excel 必须存在：${committedStoredPath}`);
    const memoryDeleteResult = await requestJson(`/orders/import-sessions/${sessionId}`, { method: 'DELETE' });
    assert(memoryDeleteResult.deletedMemory === true, '已提交导入记录删除时必须标记为删除导入记忆');
    assert(memoryDeleteResult.deletedFileCount >= 1, '删除导入记忆必须同步删除服务器端上传 Excel 文件');
    assert(!existsSync(committedStoredPath), `删除导入记忆后服务器端 Excel 必须同步删除：${committedStoredPath}`);
    const orderAfterMemoryDelete = await requestJson(`/orders/${encodeURIComponent(mainCreatedOrderNos[0])}`);
    assert(orderAfterMemoryDelete?.orderNo === mainCreatedOrderNos[0], '删除导入记忆不得删除已经生成的订单草稿');
    const importTraceLinesAfterMemoryDelete = orderAfterMemoryDelete.lines.filter((line) => line.sourceImportFileName);
    assert(importTraceLinesAfterMemoryDelete.length > 0, '删除导入记忆后订单明细必须保留来源 Excel 文件名文字追溯');
    assert(
      importTraceLinesAfterMemoryDelete.every((line) => !line.sourceImportFileId && !line.sourceImportFileAvailable),
      '删除导入记忆后订单明细不能继续保留可预览的来源文件 ID'
    );

    await cleanup();
    console.log(
      JSON.stringify(
        {
          ok: true,
          apiBaseUrl,
          sessionId,
          customerName,
          createdOrderNos
        },
        null,
        2
      )
    );
  } catch (error) {
    await cleanup();
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

main();
