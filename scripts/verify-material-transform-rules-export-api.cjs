#!/usr/bin/env node

const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');

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

const apiBaseUrl = (
  process.env.MATERIAL_TRANSFORM_RULES_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const fixturePrefix = 'VERIFY-TRANSFORM-RULE-STABLE';
const sourcePartCode = `${fixturePrefix}-SOURCE`;
const targetPartCode = `${fixturePrefix}-TARGET`;
const projectModel = 'VERIFY_TRANSFORM_RULE_STABLE';
const prisma = new PrismaClient();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function requestWorkbook(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }

  const contentType = response.headers.get('content-type') || '';
  assert(
    contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    `来源加工关系导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
  );
  const contentDisposition = response.headers.get('content-disposition') || '';
  assert(contentDisposition.includes('material-transform-rules-export.xlsx'), '来源加工关系导出缺少固定响应文件名');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '来源加工关系导出必须是 .xlsx zip 文件');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('来源加工关系');
  assert(sheet, '来源加工关系导出缺少 来源加工关系 工作表');
  return { buffer, sheet };
}

function sheetDataText(sheet) {
  const values = [];
  for (let rowNumber = 5; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (const value of row.values) {
      if (value !== undefined && value !== null) {
        values.push(String(value));
      }
    }
  }
  return values.join('\n');
}

async function upsertFixtureMaterial(partCode, partName) {
  return prisma.material.upsert({
    where: { partCode },
    update: {
      partName,
      unit: '件',
      partSpecification: 'fixture transform rule',
      status: 'DISABLED'
    },
    create: {
      partCode,
      partName,
      unit: '件',
      partSpecification: 'fixture transform rule',
      status: 'DISABLED'
    }
  });
}

async function prepareFixtureRule() {
  const sourceMaterial = await upsertFixtureMaterial(sourcePartCode, 'VERIFY 来源加工关系验证来源零件');
  const targetMaterial = await upsertFixtureMaterial(targetPartCode, 'VERIFY 来源加工关系验证目标零件');
  const existing = await prisma.materialTransformRule.findFirst({
    where: {
      sourceMaterialId: sourceMaterial.id,
      targetMaterialId: targetMaterial.id,
      customerScopeKey: 'ALL',
      projectModelScopeKey: projectModel
    }
  });
  const data = {
    sourceMaterialId: sourceMaterial.id,
    targetMaterialId: targetMaterial.id,
    customerId: null,
    customerNameSnapshot: null,
    projectModel,
    customerScopeKey: 'ALL',
    projectModelScopeKey: projectModel,
    conversionDescription: 'VERIFY 来源加工关系回归验证；默认业务列表必须隐藏。',
    defaultProcessRoute: null,
    multiplier: 1,
    lossRate: 0,
    remark: 'verify-material-transform-rules-export-api stable fixture',
    status: 'DISABLED'
  };
  return existing
    ? prisma.materialTransformRule.update({ where: { id: existing.id }, data })
    : prisma.materialTransformRule.create({ data });
}

async function assertFixtureFiltering(ruleId) {
  const defaultList = await requestJson(
    `/inventory/material-transform-rules?status=ALL&keyword=${encodeURIComponent(sourcePartCode)}&withPage=true&limit=20&offset=0`
  );
  assert(
    !defaultList.items.some((item) => item.id === ruleId || item.sourcePartCode === sourcePartCode || item.targetPartCode === targetPartCode),
    '来源加工关系列表默认必须隐藏稳定测试规则'
  );

  const fixtureList = await requestJson(
    `/inventory/material-transform-rules?status=ALL&keyword=${encodeURIComponent(sourcePartCode)}&includeTestFixtures=true&withPage=true&limit=20&offset=0`
  );
  assert(
    fixtureList.items.some((item) => item.id === ruleId && item.sourcePartCode === sourcePartCode && item.targetPartCode === targetPartCode),
    '来源加工关系列表 includeTestFixtures=true 必须能读取稳定测试规则'
  );

  const defaultExport = await requestWorkbook(
    `/inventory/material-transform-rules/export?status=ALL&keyword=${encodeURIComponent(sourcePartCode)}`
  );
  assert(!sheetDataText(defaultExport.sheet).includes(sourcePartCode), '来源加工关系默认导出不得包含稳定测试规则');

  const fixtureExport = await requestWorkbook(
    `/inventory/material-transform-rules/export?status=ALL&keyword=${encodeURIComponent(sourcePartCode)}&includeTestFixtures=true`
  );
  const fixtureExportText = sheetDataText(fixtureExport.sheet);
  assert(fixtureExportText.includes(sourcePartCode), '来源加工关系 includeTestFixtures=true 导出必须包含稳定测试规则');
  assert(fixtureExportText.includes(targetPartCode), '来源加工关系 includeTestFixtures=true 导出必须包含稳定测试目标零件');
}

async function assertEmptyExportContract() {
  const { buffer, sheet } = await requestWorkbook(
    '/inventory/material-transform-rules/export?keyword=NO_MATCH_TRANSFORM_EXPORT&targetPartCode=NO_MATCH_TARGET&status=ALL'
  );
  assert(sheet.getCell('A1').text === '来源加工关系导出', '来源加工关系导出标题不正确');
  assert(sheet.getCell('A2').text.includes('关键词：NO_MATCH_TRANSFORM_EXPORT'), '来源加工关系导出范围说明缺少关键字');
  assert(sheet.getCell('A2').text.includes('目标零件：NO_MATCH_TARGET'), '来源加工关系导出范围说明缺少目标零件');
  assert(sheet.getCell('A2').text.includes('状态：全部'), '来源加工关系导出范围说明缺少状态');

  const headers = sheet
    .getRow(4)
    .values.filter((value) => value !== undefined)
    .map(String);
  for (const header of [
    '序号',
    '库存判断',
    '判断依据',
    '来源零件编码',
    '来源可用库存',
    '目标零件编码',
    '目标可用库存',
    '适用范围',
    '换算倍率',
    '建议工艺',
    '关系状态'
  ]) {
    assert(headers.includes(header), `来源加工关系导出缺少表头 ${header}`);
  }
  assert(sheet.getCell('A5').text.includes('当前筛选范围没有来源加工关系'), '空筛选导出必须保留可读提示行');
  return { byteLength: buffer.length, rowCount: sheet.rowCount };
}

async function main() {
  try {
    const fixtureRule = await prepareFixtureRule();
    await assertFixtureFiltering(fixtureRule.id);
    const exportInfo = await assertEmptyExportContract();

    console.log(
      JSON.stringify(
        {
          ok: true,
          apiBaseUrl,
          checked: [
            'material-transform-rules-test-fixture-filter',
            'material-transform-rules-export-test-fixture-filter',
            'material-transform-rules-export-xlsx',
            'material-transform-rules-export-scope',
            'material-transform-rules-export-columns'
          ],
          byteLength: exportInfo.byteLength,
          rowCount: exportInfo.rowCount
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
