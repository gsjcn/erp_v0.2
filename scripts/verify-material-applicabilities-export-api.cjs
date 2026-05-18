#!/usr/bin/env node

const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

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
  process.env.MATERIAL_APPLICABILITIES_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const prisma = new PrismaClient();
const partCode = 'VERIFY-APPLICABILITY-EXPORT-STABLE';
const partName = '适用范围导出验证零件';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function prepareStableVerificationData() {
  const material = await prisma.material.upsert({
    where: { partCode },
    update: {
      partName,
      unit: '件',
      partSpecification: '导出验证规格',
      defaultProcessRoute: null,
      status: 'ENABLED'
    },
    create: {
      partCode,
      partName,
      unit: '件',
      partSpecification: '导出验证规格',
      defaultProcessRoute: null,
      status: 'ENABLED'
    }
  });
  await prisma.materialApplicability.upsert({
    where: {
      materialId_customerScopeKey_projectModelScopeKey: {
        materialId: material.id,
        customerScopeKey: 'ALL',
        projectModelScopeKey: 'ALL'
      }
    },
    update: {
      customerId: null,
      customerNameSnapshot: null,
      projectModel: null,
      customerScopeKey: 'ALL',
      projectModelScopeKey: 'ALL',
      remark: '适用范围导出验证',
      status: 'ENABLED'
    },
    create: {
      materialId: material.id,
      customerId: null,
      customerNameSnapshot: null,
      projectModel: null,
      customerScopeKey: 'ALL',
      projectModelScopeKey: 'ALL',
      remark: '适用范围导出验证',
      status: 'ENABLED'
    }
  });
  return material;
}

async function cleanupStableVerificationData() {
  await prisma.materialApplicability.updateMany({
    where: { material: { partCode: { equals: partCode, mode: 'insensitive' } } },
    data: { status: 'DISABLED' }
  });
  await prisma.material.updateMany({
    where: { partCode: { equals: partCode, mode: 'insensitive' } },
    data: { status: 'DISABLED' }
  });
}

async function main() {
  let material;
  try {
    material = await prepareStableVerificationData();
    const response = await fetch(`${apiBaseUrl}/inventory/materials/${material.id}/applicabilities/export`);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    }

    const contentType = response.headers.get('content-type') || '';
    assert(
      contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      `零件适用范围导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
    );
    const contentDisposition = response.headers.get('content-disposition') || '';
    assert(contentDisposition.includes('material-applicabilities-export.xlsx'), '零件适用范围导出缺少固定响应文件名');

    const buffer = Buffer.from(await response.arrayBuffer());
    assert(buffer.subarray(0, 2).toString('utf8') === 'PK', '零件适用范围导出必须是 .xlsx zip 文件');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('适用范围');
    assert(sheet, '零件适用范围导出缺少 适用范围 工作表');
    assert(sheet.getCell('A1').text === '零件适用范围导出', '零件适用范围导出标题不正确');
    assert(sheet.getCell('A2').text.includes(`零件：${partCode} / ${partName}`), '零件适用范围导出范围说明缺少零件信息');
    assert(sheet.getCell('A2').text.includes('零件状态：启用'), '零件适用范围导出范围说明缺少零件状态');

    const headers = sheet
      .getRow(4)
      .values.filter((value) => value !== undefined)
      .map(String);
    for (const header of ['序号', '零件编码', '零件名称', '客户范围', '机型/项目范围', '适用范围', '状态', '备注']) {
      assert(headers.includes(header), `零件适用范围导出缺少表头 ${header}`);
    }
    assert(sheet.getCell('B5').text === partCode, '零件适用范围导出缺少创建的零件编码');
    assert(sheet.getCell('F5').text === '全部客户', '零件适用范围导出必须保留全部客户范围');
    assert(sheet.getCell('I5').text === '全部机型/项目', '零件适用范围导出必须保留全部机型/项目范围');
    assert(sheet.getCell('L5').text === '启用', '零件适用范围导出必须保留启用状态');

    console.log(
      JSON.stringify(
        {
          ok: true,
          apiBaseUrl,
          checked: ['material-applicabilities-export-xlsx', 'material-applicabilities-export-scope', 'material-applicabilities-export-columns'],
          materialId: material.id,
          partCode,
          byteLength: buffer.length,
          rowCount: sheet.rowCount
        },
        null,
        2
      )
    );
  } finally {
    await cleanupStableVerificationData();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
