#!/usr/bin/env node

const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { unlink } = require('node:fs/promises');
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

const apiBaseUrl = (process.env.MATERIAL_IMPORT_API_BASE_URL || process.env.ORDER_IMPORT_API_BASE_URL || 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const materialPrefix = `MI-API-${runId}`;
const createdSessionIds = new Set();
const mojibakePattern =
  /[ÃÂ�]|锟|脙|脗|鈥|绗|\u95c3\u8235|\u95c3\u8236|寮€|涓€|瀵煎|璁㈠崟|鏂囦欢|缂栫爜|鍚嶇О|绮剧‘|鍖归厤|鍓嶇紑|鎷奸煶|鍥剧焊|瀹㈡埛|鍘嗗彶|搴撳瓨|鏉ユ簮|涔辩爜|淇|楠岃瘉|鏃犳硶|鏈壘|鎵惧埌|涓|尮閰|墿鏂|璇蜂粠|嬫媺|閫夋嫨|鏌ヨ|澶辫触|宸ヨ緭|闃绘柇/;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = String(value || '');
  assert(!mojibakePattern.test(text), `${label} 不能出现乱码：${text}`);
}

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

async function requestBuffer(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${buffer.toString('utf8')}`);
  }
  return buffer;
}

async function expectRequestFailure(label, action, expectedMessage) {
  let failed = false;
  try {
    await action();
  } catch (error) {
    failed = true;
    assert(
      String(error.message || '').includes(expectedMessage),
      `${label} 失败原因应包含“${expectedMessage}”，实际：${error.message}`
    );
  }
  assert(failed, `${label} 应该失败`);
}

function assertXlsxBuffer(buffer, label) {
  assert(buffer.slice(0, 2).toString('utf8') === 'PK', `${label} 必须是 xlsx zip 文件`);
}

function addRow(sheet, rowNo, values) {
  values.forEach((value, index) => {
    sheet.getCell(rowNo, index + 1).value = value;
  });
}

const materialHeaders = [
  '零件编码',
  '零件名称',
  '单位',
  '成品规格',
  '图号',
  '图纸版本',
  '图纸日期',
  '图纸状态',
  '厚度',
  '项目型号',
  '库存报警',
  '最小库存',
  '备注'
];

const applicabilityHeaders = ['零件编码', '客户编码', '客户名称', '项目型号', '状态', '备注'];
const transformHeaders = [
  '来源零件编码',
  '目标零件编码',
  '客户编码',
  '客户名称',
  '项目型号',
  '倍率',
  '损耗率',
  '默认工艺',
  '转换说明',
  '状态',
  '备注'
];

async function workbookBuffer({ materialRows = [], applicabilityRows = [], transformRows = [] }) {
  const workbook = new ExcelJS.Workbook();
  const materialSheet = workbook.addWorksheet('零件基础库');
  addRow(materialSheet, 1, materialHeaders);
  materialRows.forEach((row, index) => addRow(materialSheet, index + 2, row));

  const applicabilitySheet = workbook.addWorksheet('适用范围');
  addRow(applicabilitySheet, 1, applicabilityHeaders);
  applicabilityRows.forEach((row, index) => addRow(applicabilitySheet, index + 2, row));

  const transformSheet = workbook.addWorksheet('来源加工关系');
  addRow(transformSheet, 1, transformHeaders);
  transformRows.forEach((row, index) => addRow(transformSheet, index + 2, row));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function validMaterialImportWorkbook() {
  return workbookBuffer({
    materialRows: [
      [
        `${materialPrefix}-SRC`,
        'API验证来源半成品',
        '件',
        '200x300',
        `${materialPrefix}-DWG-SRC`,
        'A',
        '2026/5/30',
        '旧图',
        2,
        'B5',
        '启用',
        12,
        'API 回归来源零件'
      ],
      [
        `${materialPrefix}-TGT`,
        'API验证目标零件',
        '件',
        '200x300-加工',
        `${materialPrefix}-DWG-TGT`,
        'A',
        '2026/5/31',
        '新图',
        2,
        'B5',
        '停用',
        '',
        'API 回归目标零件'
      ]
    ],
    applicabilityRows: [[`${materialPrefix}-TGT`, '', '', 'B5', '启用', '全部客户 B5 适用']],
    transformRows: [[`${materialPrefix}-SRC`, `${materialPrefix}-TGT`, '', '', 'B5', 1, 0, '', '来源加工关系只作为建议，不自动扣库存', '启用', 'API 回归来源关系']]
  });
}

async function issueMaterialImportWorkbook() {
  return workbookBuffer({
    materialRows: [
      [`${materialPrefix}-ISSUE`, '问题明细验证零件', '件', '', '', '', '', '', '', '', '停用', 3, '停用库存报警仍填写最小库存，应生成可持久化警告']
    ],
    applicabilityRows: [[`${materialPrefix}-MISSING-SCOPE`, '', '', 'B5', '启用', '引用不存在零件']],
    transformRows: [[`${materialPrefix}-MISSING-SRC`, `${materialPrefix}-MISSING-TGT`, '', '', 'B5', 1, 0, `不存在工序${runId}`, '引用不存在来源和目标，并使用无效默认工艺', '启用', '']]
  });
}

async function missingRequiredMaterialImportWorkbook() {
  return workbookBuffer({
    materialRows: [
      [
        `${materialPrefix}-REQUIRED`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        -1,
        '',
        '启用',
        '',
        '缺少零件名称、单位和最小库存，同时厚度为负数，必须进入预览错误'
      ]
    ],
    applicabilityRows: [['', '', '', 'B5', '启用', '缺少零件编码，必须进入适用范围预览错误']],
    transformRows: [
      [
        `${materialPrefix}-REQUIRED`,
        `${materialPrefix}-REQUIRED`,
        '',
        '',
        'B5',
        -1,
        -0.1,
        '',
        '来源和目标相同，同时倍率和损耗无效，必须进入来源加工关系预览错误',
        '启用',
        ''
      ]
    ]
  });
}

async function createSession(createdBy) {
  const session = await requestJson('/inventory/material-import-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ createdBy })
  });
  createdSessionIds.add(session.id);
  return session;
}

async function uploadWorkbook(sessionId, buffer, fileName) {
  const form = new FormData();
  form.set(
    'file',
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName
  );
  const response = await fetch(`${apiBaseUrl}/inventory/material-import-sessions/${sessionId}/files`, {
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

async function materialImportUploadDir() {
  const health = await requestJson('/health');
  const uploadRoot = health?.storage?.uploads?.path;
  assert(uploadRoot, '健康检查必须返回上传目录，用于验证零件库导入临时文件清理');
  return join(uploadRoot, 'material-imports');
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

async function assertNoOrderProductionInventorySideEffects() {
  const prisma = new PrismaClient();
  try {
    const [orderLines, orders, productionTasks, batches, transactions] = await Promise.all([
      prisma.orderLine.count({ where: { partCode: { startsWith: materialPrefix } } }),
      prisma.customerOrder.count({ where: { orderNo: { startsWith: materialPrefix } } }),
      prisma.productionTask.count({ where: { partCode: { startsWith: materialPrefix } } }),
      prisma.inventoryBatch.count({ where: { partCode: { startsWith: materialPrefix } } }),
      prisma.inventoryTransaction.count({ where: { partCode: { startsWith: materialPrefix } } })
    ]);
    assert(orderLines === 0, `零件库导入不得创建订单明细，实际 ${orderLines}`);
    assert(orders === 0, `零件库导入不得创建订单，实际 ${orders}`);
    assert(productionTasks === 0, `零件库导入不得创建生产任务，实际 ${productionTasks}`);
    assert(batches === 0, `零件库导入不得创建库存批次，实际 ${batches}`);
    assert(transactions === 0, `零件库导入不得创建库存流水，实际 ${transactions}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function assertCommittedMaterialData() {
  const prisma = new PrismaClient();
  try {
    const materials = await prisma.material.findMany({
      where: { partCode: { startsWith: materialPrefix } },
      include: {
        drawingRevisions: true,
        applicabilities: true,
        sourceTransformRules: true,
        targetTransformRules: true
      },
      orderBy: { partCode: 'asc' }
    });
    assert(materials.length === 2, `提交后应只写入 2 个 Material，实际 ${materials.length}`);
    const source = materials.find((item) => item.partCode.endsWith('-SRC'));
    const target = materials.find((item) => item.partCode.endsWith('-TGT'));
    assert(source && target, '提交后必须能找到来源和目标零件');
    assert(source.stockAlertEnabled === true, '来源零件应启用库存报警');
    assert(Number(source.stockAlertQuantity) === 12, `来源零件最小库存应为 12，实际 ${source.stockAlertQuantity}`);
    assert(target.stockAlertEnabled === false, '目标零件应停用库存报警');
    assert(source.drawingRevisions.length === 1 && target.drawingRevisions.length === 1, '每个导入零件都应写入图纸版本');
    assert(target.applicabilities.length === 1, '目标零件应写入 1 条适用范围');
    assert(source.sourceTransformRules.length === 1, '来源零件应写入 1 条来源加工关系');
    assert(target.targetTransformRules.length === 1, '目标零件应写入 1 条目标来源加工关系');
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanup() {
  const prisma = new PrismaClient();
  try {
    const sessions = await prisma.materialImportSession.findMany({
      where: {
        OR: [{ id: { in: [...createdSessionIds] } }, { createdBy: { contains: `verify-material-import-api-${runId}` } }]
      },
      include: { files: { select: { storedFileName: true } } }
    });
    for (const session of sessions) {
      for (const file of session.files) {
        if (!file.storedFileName) {
          continue;
        }
        try {
          await unlink(join(await materialImportUploadDir(), file.storedFileName));
        } catch {
          // 回归验证清理尽力执行；最终错误仍由主流程抛出。
        }
      }
    }
    if (sessions.length > 0) {
      await prisma.materialImportSession.deleteMany({ where: { id: { in: sessions.map((session) => session.id) } } });
    }

    const materials = await prisma.material.findMany({
      where: { partCode: { startsWith: materialPrefix } },
      select: { id: true }
    });
    const materialIds = materials.map((material) => material.id);
    if (materialIds.length > 0) {
      await prisma.materialTransformRule.deleteMany({
        where: { OR: [{ sourceMaterialId: { in: materialIds } }, { targetMaterialId: { in: materialIds } }] }
      });
      await prisma.materialApplicability.deleteMany({ where: { materialId: { in: materialIds } } });
      await prisma.materialDrawingRevision.deleteMany({ where: { materialId: { in: materialIds } } });
      await prisma.material.deleteMany({ where: { id: { in: materialIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await assertNoOrderProductionInventorySideEffects();
  const uploadDir = await materialImportUploadDir();

  const template = await requestBuffer('/inventory/material-import-template');
  assertXlsxBuffer(template, '零件库导入模板');
  const config = await requestJson('/inventory/material-import-config');
  assert(Array.isArray(config.allowedExtensions) && config.allowedExtensions.includes('.xlsx'), '零件库导入配置必须允许 .xlsx');

  const deleteSession = await createSession(`verify-material-import-api-${runId}-delete`);
  const deleteToken = `material-import-api-delete-${runId}`;
  const deletePreview = await uploadWorkbook(deleteSession.id, await validMaterialImportWorkbook(), `${deleteToken}.xlsx`);
  assert(deletePreview.files.length === 1, '删除文件验证会话应有 1 个上传文件');
  const afterDelete = await requestJson(`/inventory/material-import-sessions/${deleteSession.id}/files/${deletePreview.files[0].id}`, {
    method: 'DELETE'
  });
  assert(afterDelete.summary.rowCount === 0 && afterDelete.files.length === 0, '删除零件库导入文件后预览必须清空');
  assertNoStoredImportFilesMatching(uploadDir, deleteToken, '删除零件库导入文件');
  await requestJson(`/inventory/material-import-sessions/${deleteSession.id}`, { method: 'DELETE' });

  const issueSession = await createSession(`verify-material-import-api-${runId}-issues`);
  const issuePreview = await uploadWorkbook(issueSession.id, await issueMaterialImportWorkbook(), `material-import-api-issues-${runId}.xlsx`);
  assert(issuePreview.summary.errorCount > 0, '问题明细验证会话必须产生错误');
  const issueReport = await requestBuffer(`/inventory/material-import-sessions/${issueSession.id}/error-report`);
  assertXlsxBuffer(issueReport, '零件库导入问题明细');
  await requestJson(`/inventory/material-import-sessions/${issueSession.id}`, { method: 'DELETE' });

  const requiredSession = await createSession(`verify-material-import-api-${runId}-required-fields`);
  const requiredPreview = await uploadWorkbook(
    requiredSession.id,
    await missingRequiredMaterialImportWorkbook(),
    `material-import-api-required-fields-${runId}.xlsx`
  );
  const requiredIssueCodes = new Set([
    ...requiredPreview.rows.flatMap((row) => (Array.isArray(row.issues) ? row.issues.map((issue) => issue.code) : [])),
    ...requiredPreview.applicabilityRows.flatMap((row) =>
      Array.isArray(row.issues) ? row.issues.map((issue) => issue.code) : []
    ),
    ...requiredPreview.transformRows.flatMap((row) => (Array.isArray(row.issues) ? row.issues.map((issue) => issue.code) : []))
  ]);
  for (const issueCode of [
    'REQUIRED_PART_NAME',
    'REQUIRED_UNIT',
    'STOCK_ALERT_QUANTITY_REQUIRED',
    'INVALID_PART_THICKNESS',
    'REQUIRED_PART_CODE',
    'SAME_SOURCE_TARGET',
    'INVALID_MULTIPLIER',
    'INVALID_LOSS_RATE'
  ]) {
    assert(requiredIssueCodes.has(issueCode), `缺少业务错误行必须保留预览 issue：${issueCode}`);
  }
  assert(requiredPreview.summary.errorCount >= 8, `缺少业务字段预览必须产生错误，实际 ${requiredPreview.summary.errorCount}`);
  const requiredIssueReport = await requestBuffer(`/inventory/material-import-sessions/${requiredSession.id}/error-report`);
  assertXlsxBuffer(requiredIssueReport, '缺少业务字段的零件库导入问题明细');
  await requestJson(`/inventory/material-import-sessions/${requiredSession.id}`, { method: 'DELETE' });

  const staleSession = await createSession(`verify-material-import-api-${runId}-stale-token`);
  const firstStalePreview = await uploadWorkbook(staleSession.id, await validMaterialImportWorkbook(), `material-import-api-stale-a-${runId}.xlsx`);
  await uploadWorkbook(
    staleSession.id,
    await workbookBuffer({
      materialRows: [[`${materialPrefix}-STALE`, '预览变化零件', '件', '', '', '', '', '', '', '', '', '', '刷新 previewToken 验证']]
    }),
    `material-import-api-stale-b-${runId}.xlsx`
  );
  await expectRequestFailure(
    '旧 previewToken 提交',
    () =>
      requestJson(`/inventory/material-import-sessions/${staleSession.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewToken: firstStalePreview.previewToken })
      }),
    '导入预览已变化'
  );
  await requestJson(`/inventory/material-import-sessions/${staleSession.id}`, { method: 'DELETE' });

  const commitSession = await createSession(`verify-material-import-api-${runId}-commit`);
  const preview = await uploadWorkbook(commitSession.id, await validMaterialImportWorkbook(), `零件库导入验证-${runId}.xlsx`);
  assert(preview.status === 'DRAFT', `上传后会话应保持 DRAFT，实际 ${preview.status}`);
  assert(preview.previewToken, '零件库导入提交必须返回 previewToken');
  assert(preview.summary.fileCount === 1, `上传后文件数应为 1，实际 ${preview.summary.fileCount}`);
  assert(preview.summary.materialRowCount === 2, `基础零件预览应为 2 行，实际 ${preview.summary.materialRowCount}`);
  assert(preview.summary.applicabilityRowCount === 1, `适用范围预览应为 1 行，实际 ${preview.summary.applicabilityRowCount}`);
  assert(preview.summary.transformRowCount === 1, `来源加工关系预览应为 1 行，实际 ${preview.summary.transformRowCount}`);
  assert(preview.summary.errorCount === 0, `可提交预览不应有错误，实际 ${preview.summary.errorCount}`);
  assertNoMojibake(preview.files[0]?.fileName, '零件库导入来源文件名');
  assertNoMojibake(preview.rows[0]?.partName, '零件库导入中文零件名称');
  const result = await requestJson(`/inventory/material-import-sessions/${commitSession.id}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken: preview.previewToken })
  });
  assert(result.createdCount === 2, `零件库导入应新增 2 个 Material，实际 ${result.createdCount}`);
  assert(result.drawingRevisionUpsertCount === 2, `零件库导入应写入 2 条图纸版本，实际 ${result.drawingRevisionUpsertCount}`);
  assert(result.applicabilityUpsertCount === 1, `零件库导入应写入 1 条适用范围，实际 ${result.applicabilityUpsertCount}`);
  assert(result.transformRuleUpsertCount === 1, `零件库导入应写入 1 条来源加工关系，实际 ${result.transformRuleUpsertCount}`);

  await assertCommittedMaterialData();
  await assertNoOrderProductionInventorySideEffects();
}

main()
  .then(async () => {
    await cleanup();
    console.log(
      JSON.stringify(
        {
          ok: true,
          runId,
          checked: [
            'template',
            'config',
            'upload-preview',
            'delete-file-cleanup',
            'issue-report',
            'required-field-preview-errors',
            'stale-preview-token',
            'commit-material-drawing-applicability-transform',
            'no-order-production-inventory-side-effects'
          ]
        },
        null,
        2
      )
    );
  })
  .catch(async (error) => {
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error('零件库导入 API 回归验证清理失败:', cleanupError);
    }
    console.error(error);
    process.exitCode = 1;
  });
