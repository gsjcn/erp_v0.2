#!/usr/bin/env node

const ExcelJS = require('exceljs');
const { existsSync, readFileSync } = require('node:fs');
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

const apiBaseUrl = (process.env.ORDER_IMPORT_API_BASE_URL || 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const uploadedDrawingFiles = [];
const uploadedInventoryFiles = [];
const orderImportSessionIds = [];
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const mojibakePattern =
  /[ÃÂ�]|锟|脙|脗|鈥|绗|\u95c3\u8235|\u95c3\u8236|寮€|涓€|瀵煎|璁㈠崟|鏂囦欢|缂栫爜|鍚嶇О|绮剧‘|鍖归厤|鍓嶇紑|鎷奸煶|鍥剧焊|瀹㈡埛|鍘嗗彶|搴撳瓨|鏉ユ簮|涔辩爜|淇|楠岃瘉|鏃犳硶|鏈壘|鎵惧埌|涓|尮閰|墿鏂|璇蜂粠|嬫媺|閫夋嫨|鏌ヨ|澶辫触|宸ヨ緭|闃绘柇/;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function mojibakeLatin1(fileName) {
  return Buffer.from(fileName, 'utf8').toString('latin1');
}

function utf8PercentFileName(fileName) {
  return `UTF-8''${encodeURIComponent(fileName)}`;
}

function windowsFakePath(fileName) {
  return `C:\\fakepath\\${fileName}`;
}

function posixPathName(fileName) {
  return `/tmp/${fileName}`;
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

async function firstEnabledCustomerName() {
  const customers = await requestJson('/customers?status=ENABLED');
  const customer = Array.isArray(customers) ? customers.find((item) => item.status === 'ENABLED') : null;
  assert(customer?.customerName, '未找到启用客户，无法执行订单导入文件名回归验证');
  return customer.customerName;
}

function addRow(sheet, rowNo, values) {
  values.forEach((value, index) => {
    sheet.getCell(rowNo, index + 1).value = value;
  });
}

async function buildMinimalOrderImportWorkbook(customerName) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ERP上传净表');
  addRow(sheet, 1, [
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
  ]);
  addRow(sheet, 2, [
    1,
    `UPLOAD-FILENAME-${runId}`,
    '2026/6/22',
    customerName,
    '上传文件名验证',
    '零件',
    1,
    '通用件',
    '',
    '',
    `UPLOAD-FILENAME-MAT-${runId}`,
    `UPLOAD-FILENAME-DWG-${runId}`,
    '上传文件名验证零件',
    '',
    '1mm',
    1,
    '',
    1,
    '件',
    '',
    '只验证上传文件名，不创建草稿订单',
    '',
    '旧图'
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function createOrderImportSession() {
  const session = await requestJson('/orders/import-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ createdBy: 'upload filename regression' })
  });
  orderImportSessionIds.push(session.id);
  return session;
}

async function uploadOrderImportFile(sessionId, fileName, buffer) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName
  );
  return requestJson(`/orders/import-sessions/${sessionId}/files`, {
    method: 'POST',
    body: form
  });
}

async function uploadInventoryAdjustmentFile(fileName) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('inventory upload filename regression')], { type: 'image/png' }), fileName);
  const result = await requestJson('/inventory/adjustments/upload', {
    method: 'POST',
    body: form
  });
  uploadedInventoryFiles.push(result.storedFileName);
  return result;
}

async function uploadDrawingFile(fileName) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('drawing upload filename regression')], { type: 'image/png' }), fileName);
  const result = await requestJson('/orders/drawings/upload', {
    method: 'POST',
    body: form
  });
  uploadedDrawingFiles.push(result.storedFileName);
  return result;
}

async function cleanup() {
  for (const sessionId of orderImportSessionIds) {
    try {
      await requestJson(`/orders/import-sessions/${sessionId}`, { method: 'DELETE' });
    } catch {
      // 导入会话清理尽力执行；主错误仍由验证流程抛出。
    }
  }

  if (uploadedDrawingFiles.length === 0 && uploadedInventoryFiles.length === 0) {
    return undefined;
  }
  try {
    const health = await requestJson('/health');
    const uploadRoot = health?.storage?.uploads?.path;
    if (!uploadRoot) {
      return;
    }
    const drawingDeletes = uploadedDrawingFiles
      .filter(Boolean)
      .map((fileName) => unlink(join(uploadRoot, 'drawings', fileName)).catch(() => undefined));
    const inventoryDeletes = uploadedInventoryFiles
      .filter(Boolean)
      .map((fileName) => unlink(join(uploadRoot, 'inventory-adjustments', fileName)).catch(() => undefined));
    await Promise.all([...drawingDeletes, ...inventoryDeletes]);
  } catch {
    // 清理失败不掩盖主验证错误；服务端孤立文件可由上传目录定期清理。
  }
}

async function main() {
  const customerName = await firstEnabledCustomerName();

  const orderImportMojibakeSourceName = '订单导入-乱码修复验证.xlsx';
  const orderImportSession = await createOrderImportSession();
  const orderImportUpload = await uploadOrderImportFile(
    orderImportSession.id,
    mojibakeLatin1(orderImportMojibakeSourceName),
    await buildMinimalOrderImportWorkbook(customerName)
  );
  const orderImportFileName = orderImportUpload.files?.[0]?.fileName;
  assert(
    orderImportFileName === orderImportMojibakeSourceName,
    `订单导入 mojibake 文件名必须修复为中文，实际 ${orderImportFileName}`
  );
  assertNoMojibake(orderImportFileName, '订单导入 mojibake 文件名');

  const orderImportPercentSourceName = '订单导入-percent编码验证.xlsx';
  const orderImportPercentSession = await createOrderImportSession();
  const orderImportPercentUpload = await uploadOrderImportFile(
    orderImportPercentSession.id,
    utf8PercentFileName(orderImportPercentSourceName),
    await buildMinimalOrderImportWorkbook(customerName)
  );
  const orderImportPercentFileName = orderImportPercentUpload.files?.[0]?.fileName;
  assert(
    orderImportPercentFileName === orderImportPercentSourceName,
    `订单导入 percent-encoded 文件名必须修复为中文，实际 ${orderImportPercentFileName}`
  );
  assertNoMojibake(orderImportPercentFileName, '订单导入 percent-encoded 文件名');

  const orderImportPathSourceName = '订单导入-路径清理验证.xlsx';
  const orderImportPathSession = await createOrderImportSession();
  const orderImportPathUpload = await uploadOrderImportFile(
    orderImportPathSession.id,
    windowsFakePath(orderImportPathSourceName),
    await buildMinimalOrderImportWorkbook(customerName)
  );
  const orderImportPathFileName = orderImportPathUpload.files?.[0]?.fileName;
  assert(
    orderImportPathFileName === orderImportPathSourceName,
    `订单导入路径文件名必须只保留 basename，实际 ${orderImportPathFileName}`
  );
  assertNoMojibake(orderImportPathFileName, '订单导入路径文件名');

  const drawingName = '订单图纸-中文验证.png';
  const decodedDrawing = await uploadDrawingFile(drawingName);
  assert(decodedDrawing.fileName === drawingName, `订单图纸普通中文文件名必须保留，实际 ${decodedDrawing.fileName}`);
  assertNoMojibake(decodedDrawing.fileName, '订单图纸普通中文文件名');
  assert(decodedDrawing.fileUrl?.includes('/uploads/drawings/'), '订单图纸必须返回可访问的上传地址');

  const drawingMojibakeSourceName = '订单图纸-乱码修复验证.png';
  const decodedDrawingMojibake = await uploadDrawingFile(mojibakeLatin1(drawingMojibakeSourceName));
  assert(
    decodedDrawingMojibake.fileName === drawingMojibakeSourceName,
    `订单图纸 mojibake 文件名必须修复为中文，实际 ${decodedDrawingMojibake.fileName}`
  );
  assertNoMojibake(decodedDrawingMojibake.fileName, '订单图纸 mojibake 文件名');

  const drawingPercentSourceName = '订单图纸-percent编码验证.png';
  const decodedDrawingPercent = await uploadDrawingFile(utf8PercentFileName(drawingPercentSourceName));
  assert(
    decodedDrawingPercent.fileName === drawingPercentSourceName,
    `订单图纸 percent-encoded 文件名必须修复为中文，实际 ${decodedDrawingPercent.fileName}`
  );
  assertNoMojibake(decodedDrawingPercent.fileName, '订单图纸 percent-encoded 文件名');

  const drawingPathSourceName = '订单图纸-路径清理验证.png';
  const decodedDrawingPath = await uploadDrawingFile(windowsFakePath(drawingPathSourceName));
  assert(
    decodedDrawingPath.fileName === drawingPathSourceName,
    `订单图纸路径文件名必须只保留 basename，实际 ${decodedDrawingPath.fileName}`
  );
  assertNoMojibake(decodedDrawingPath.fileName, '订单图纸路径文件名');

  const normalChineseName = '库存盘点照片-中文验证.png';
  const decodedNormal = await uploadInventoryAdjustmentFile(normalChineseName);
  assert(decodedNormal.fileName === normalChineseName, `库存附件普通中文文件名必须保留，实际 ${decodedNormal.fileName}`);
  assertNoMojibake(decodedNormal.fileName, '库存附件普通中文文件名');
  assert(decodedNormal.fileUrl?.includes('/uploads/inventory-adjustments/'), '库存附件必须返回可访问的上传地址');

  const mojibakeSourceName = '库存盘点工单-乱码修复验证.png';
  const decodedMojibake = await uploadInventoryAdjustmentFile(mojibakeLatin1(mojibakeSourceName));
  assert(
    decodedMojibake.fileName === mojibakeSourceName,
    `库存附件 mojibake 文件名必须修复为中文，实际 ${decodedMojibake.fileName}`
  );
  assertNoMojibake(decodedMojibake.fileName, '库存附件 mojibake 文件名');

  const inventoryPercentSourceName = '库存盘点-percent编码验证.png';
  const decodedInventoryPercent = await uploadInventoryAdjustmentFile(utf8PercentFileName(inventoryPercentSourceName));
  assert(
    decodedInventoryPercent.fileName === inventoryPercentSourceName,
    `库存附件 percent-encoded 文件名必须修复为中文，实际 ${decodedInventoryPercent.fileName}`
  );
  assertNoMojibake(decodedInventoryPercent.fileName, '库存附件 percent-encoded 文件名');

  const inventoryPathSourceName = '库存盘点-路径清理验证.png';
  const decodedInventoryPath = await uploadInventoryAdjustmentFile(posixPathName(inventoryPathSourceName));
  assert(
    decodedInventoryPath.fileName === inventoryPathSourceName,
    `库存附件路径文件名必须只保留 basename，实际 ${decodedInventoryPath.fileName}`
  );
  assertNoMojibake(decodedInventoryPath.fileName, '库存附件路径文件名');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl,
        checked: [
          orderImportFileName,
          orderImportPercentFileName,
          orderImportPathFileName,
          decodedDrawing.fileName,
          decodedDrawingMojibake.fileName,
          decodedDrawingPercent.fileName,
          decodedDrawingPath.fileName,
          decodedNormal.fileName,
          decodedMojibake.fileName,
          decodedInventoryPercent.fileName,
          decodedInventoryPath.fileName
        ]
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
