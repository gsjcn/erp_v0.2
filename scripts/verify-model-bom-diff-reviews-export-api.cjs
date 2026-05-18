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
  process.env.MODEL_BOM_DIFF_REVIEWS_EXPORT_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const prisma = new PrismaClient();
const partCode = 'VERIFY-BOM-DIFF-STABLE';
const partName = 'BOM 差异核对导出验证零件';
const customerCode = 'VERIFY-BOM-DIFF-CUST-STABLE';
const customerName = 'BOM 差异核对导出客户';
const projectModel = 'VERIFY-DIFF-STABLE';
const projectModelScopeKey = projectModel.toUpperCase();
const sourceBomName = 'VERIFY-BOM-DIFF-SOURCE-STABLE';
const targetBomName = 'VERIFY-BOM-DIFF-TARGET-STABLE';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

async function upsertBomLine(bomId, material, defaultQuantity) {
  const lineData = {
    partCodeSnapshot: material.partCode,
    partNameSnapshot: material.partName,
    unitSnapshot: material.unit,
    partSpecificationSnapshot: material.partSpecification,
    partThicknessSnapshot: 1.2,
    lineType: 'PART',
    defaultQuantity,
    defaultProcessRoute: null,
    sortOrder: 1,
    status: 'ENABLED'
  };
  const existingLine = await prisma.modelBomLine.findFirst({
    where: { bomId, materialId: material.id, sortOrder: 1 },
    orderBy: { createdAt: 'asc' }
  });
  if (existingLine) {
    return prisma.modelBomLine.update({
      where: { id: existingLine.id },
      data: lineData
    });
  }
  return prisma.modelBomLine.create({
    data: {
      bomId,
      materialId: material.id,
      ...lineData
    }
  });
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
  const existingCustomer = await prisma.customer.findFirst({
    where: {
      OR: [
        { customerCode },
        { customerCode: { startsWith: `${customerCode}__DISABLED__` } },
        { customerName: { startsWith: `${customerName}__DISABLED__` } }
      ]
    },
    orderBy: { createdAt: 'asc' }
  });
  const customerData = {
    customerCode,
    customerName,
    contactName: '导出验证',
    contactPhone: '13800000000',
    regionType: 'CHINA',
    country: '中国',
    province: '江苏',
    city: '常州',
    detailAddress: '导出验证地址',
    status: 'ENABLED'
  };
  const customer = existingCustomer
    ? await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: customerData
      })
    : await prisma.customer.create({
        data: customerData
      });
  await prisma.customerContact.updateMany({
    where: { customerId: customer.id, status: 'ENABLED' },
    data: { status: 'DISABLED' }
  });
  const sourceBom = await prisma.modelBom.upsert({
    where: {
      bomName_customerScopeKey_projectModelScopeKey: {
        bomName: sourceBomName,
        customerScopeKey: 'ALL',
        projectModelScopeKey
      }
    },
    update: {
      projectModel,
      customerId: null,
      customerNameSnapshot: null,
      customerScopeMode: 'ALL',
      sourceBomId: null,
      sourceBomNameSnapshot: null,
      status: 'ENABLED',
      isCommon: false,
      commonSortOrder: null,
      remark: '临时回归数据：验证 BOM 差异核对导出。'
    },
    create: {
      bomName: sourceBomName,
      projectModel,
      customerId: null,
      customerNameSnapshot: null,
      customerScopeMode: 'ALL',
      customerScopeKey: 'ALL',
      projectModelScopeKey,
      sourceBomId: null,
      sourceBomNameSnapshot: null,
      status: 'ENABLED',
      isCommon: false,
      commonSortOrder: null,
      remark: '临时回归数据：验证 BOM 差异核对导出。'
    }
  });
  const targetBom = await prisma.modelBom.upsert({
    where: {
      bomName_customerScopeKey_projectModelScopeKey: {
        bomName: targetBomName,
        customerScopeKey: customer.id,
        projectModelScopeKey
      }
    },
    update: {
      projectModel,
      customerId: customer.id,
      customerNameSnapshot: customer.customerName,
      customerScopeMode: 'PRIVATE',
      sourceBomId: sourceBom.id,
      sourceBomNameSnapshot: sourceBom.bomName,
      status: 'ENABLED',
      isCommon: false,
      commonSortOrder: null,
      remark: '临时回归数据：验证客户 BOM 独立差异核对。'
    },
    create: {
      bomName: targetBomName,
      projectModel,
      customerId: customer.id,
      customerNameSnapshot: customer.customerName,
      customerScopeMode: 'PRIVATE',
      customerScopeKey: customer.id,
      projectModelScopeKey,
      sourceBomId: sourceBom.id,
      sourceBomNameSnapshot: sourceBom.bomName,
      status: 'ENABLED',
      isCommon: false,
      commonSortOrder: null,
      remark: '临时回归数据：验证客户 BOM 独立差异核对。'
    }
  });
  const sourceLine = await upsertBomLine(sourceBom.id, material, 2);
  const targetLine = await upsertBomLine(targetBom.id, material, 1);
  return { material, customer, sourceBom, sourceLine, targetBom, targetLine };
}

async function cleanupStableVerificationData() {
  const [sourceBom, targetBom] = await Promise.all([
    prisma.modelBom.findFirst({ where: { bomName: sourceBomName }, select: { id: true } }),
    prisma.modelBom.findFirst({ where: { bomName: targetBomName }, select: { id: true } })
  ]);
  if (sourceBom?.id && targetBom?.id) {
    await prisma.modelBomDiffReview.updateMany({
      where: { sourceBomId: sourceBom.id, targetBomId: targetBom.id },
      data: { status: 'DISABLED' }
    });
  }
  await prisma.modelBomLine.updateMany({
    where: {
      OR: [
        { material: { partCode: { equals: partCode, mode: 'insensitive' } } },
        { bom: { bomName: { in: [sourceBomName, targetBomName] } } }
      ]
    },
    data: { status: 'DISABLED' }
  });
  await prisma.modelBom.updateMany({
    where: { bomName: { in: [sourceBomName, targetBomName] } },
    data: { status: 'DISABLED', isCommon: false, commonSortOrder: null }
  });
  await prisma.material.updateMany({
    where: { partCode: { equals: partCode, mode: 'insensitive' } },
    data: { status: 'DISABLED' }
  });
  const customer = await prisma.customer.findFirst({
    where: {
      OR: [
        { customerCode },
        { customerCode: { startsWith: `${customerCode}__DISABLED__` } },
        { customerName: { startsWith: `${customerName}__DISABLED__` } }
      ]
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true }
  });
  if (customer?.id) {
    const archiveSuffix = `__DISABLED__${customer.id.slice(0, 8)}`;
    await prisma.customerContact.updateMany({
      where: { customerId: customer.id, status: 'ENABLED' },
      data: { status: 'DISABLED' }
    });
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        customerCode: `${customerCode}${archiveSuffix}`,
        customerName: `${customerName}${archiveSuffix}`,
        contactName: null,
        contactPhone: null,
        status: 'DISABLED'
      }
    });
  }
}

async function main() {
  const { sourceBom, sourceLine, targetBom, targetLine } = await prepareStableVerificationData();
  const reviewKey = [targetBom.id, sourceBom.id, 'CHANGED', sourceLine.id, targetLine.id, 'VERIFY-STABLE'].join('|');

  try {
    const savedReview = await requestJson(`/inventory/model-boms/${targetBom.id}/diff-reviews`, {
      method: 'POST',
      body: JSON.stringify({
        sourceBomId: sourceBom.id,
        reviewKey,
        issueKind: 'CHANGED',
        sourceLineId: sourceLine.id,
        targetLineId: targetLine.id,
        issueTitle: '默认数量差异',
        issueDetail: '来源 BOM 与客户 BOM 的默认数量需要人工确认保留。',
        diffFingerprint: `CHANGED|${sourceLine.id}|${targetLine.id}|defaultQuantity`,
        fieldsJson: {
          fields: [{ label: '默认数量', sourceValue: '2', targetValue: '1', changed: true }]
        },
        reviewedBy: 'verify',
        reviewRemark: '保留客户 BOM 独立差异'
      })
    });

    const reviewList = await requestJson(
      `/inventory/model-boms/${targetBom.id}/diff-reviews?sourceBomId=${encodeURIComponent(sourceBom.id)}&withPage=true&limit=10&offset=0`
    );
    assert(Array.isArray(reviewList.items), 'model BOM diff review paginated list must return items');
    assert(reviewList.totalCount >= 1, 'model BOM diff review paginated list must return totalCount');
    assert(reviewList.limit === 10, 'model BOM diff review paginated list must echo limit');
    assert(reviewList.offset === 0, 'model BOM diff review paginated list must echo offset');
    assert(Array.isArray(reviewList.reviewKeys), 'model BOM diff review paginated list must return all reviewKeys');
    assert(reviewList.reviewKeys.includes(reviewKey), 'model BOM diff review paginated list must include saved reviewKey in reviewKeys');
    const listedReview = reviewList.items.find((review) => review.id === savedReview.id);
    assert(listedReview, 'model BOM diff review list must include the saved review');
    assert(listedReview.reviewedAt, 'model BOM diff review list must expose reviewedAt');
    assert(!Object.prototype.hasOwnProperty.call(listedReview, 'createdAt'), 'model BOM diff review list must not expose createdAt');
    assert(!Object.prototype.hasOwnProperty.call(listedReview, 'updatedAt'), 'model BOM diff review list must not expose updatedAt');
    assert(listedReview.targetBomId === targetBom.id, 'model BOM diff review list must keep targetBomId');
    assert(listedReview.sourceBomId === sourceBom.id, 'model BOM diff review list must keep sourceBomId');
    assert(listedReview.reviewKey === reviewKey, 'model BOM diff review list must keep reviewKey');
    assert(listedReview.status === 'ENABLED', 'model BOM diff review list must only show enabled review rows');
    const defaultList = await requestJson(
      `/inventory/model-boms/${targetBom.id}/diff-reviews?sourceBomId=${encodeURIComponent(sourceBom.id)}&limit=10&offset=0`
    );
    assert(Array.isArray(defaultList.items), 'model BOM diff review public list must be paginated by default');
    assert(defaultList.reviewKeys.includes(reviewKey), 'model BOM diff review default paginated list must include saved reviewKey');

    const response = await fetch(`${apiBaseUrl}/inventory/model-boms/${targetBom.id}/diff-reviews/export?sourceBomId=${encodeURIComponent(sourceBom.id)}`);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    }
    const contentType = response.headers.get('content-type') || '';
    assert(
      contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      `BOM 差异核对记录导出 content-type 必须是真实 .xlsx，实际 ${contentType || '-'}`
    );
    const contentDisposition = response.headers.get('content-disposition') || '';
    assert(contentDisposition.includes('model-bom-diff-reviews-export.xlsx'), 'BOM 差异核对记录导出缺少固定响应文件名');

    const buffer = Buffer.from(await response.arrayBuffer());
    assert(buffer.subarray(0, 2).toString('utf8') === 'PK', 'BOM 差异核对记录导出必须是 .xlsx zip 文件');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('差异核对记录');
    assert(sheet, 'BOM 差异核对记录导出缺少 差异核对记录 工作表');
    assert(sheet.getCell('A1').text === 'BOM 差异核对记录导出', 'BOM 差异核对记录导出标题不正确');
    assert(sheet.getCell('A2').text.includes(`客户BOM：${targetBom.bomName}`), 'BOM 差异核对记录导出范围说明缺少客户 BOM');
    assert(sheet.getCell('A2').text.includes(`来源BOM：${sourceBom.bomName}`), 'BOM 差异核对记录导出范围说明缺少来源 BOM');

    const headers = sheet
      .getRow(4)
      .values.filter((value) => value !== undefined)
      .map(String);
    for (const header of ['序号', '客户BOM', '来源BOM', '差异类型', '差异项', '来源行', '客户BOM行', '核对人', '核对备注']) {
      assert(headers.includes(header), `BOM 差异核对记录导出缺少表头 ${header}`);
    }
    assert(sheet.getCell('B5').text === targetBom.bomName, 'BOM 差异核对记录导出缺少客户 BOM 名称');
    assert(sheet.getCell('C5').text === sourceBom.bomName, 'BOM 差异核对记录导出缺少来源 BOM 名称');
    assert(sheet.getCell('F5').text.includes('明细不同'), 'BOM 差异核对记录导出缺少差异类型中文说明');
    assert(sheet.getCell('G5').text === '默认数量差异', 'BOM 差异核对记录导出缺少差异项');
    assert(sheet.getCell('L5').text === 'verify', 'BOM 差异核对记录导出缺少核对人');

    console.log(
      JSON.stringify(
        {
          ok: true,
          apiBaseUrl,
          checked: [
            'model-bom-diff-reviews-public-list-pagination',
            'model-bom-diff-reviews-public-list-default-pagination',
            'model-bom-diff-reviews-list-review-keys',
            'model-bom-diff-reviews-list-no-maintenance-timestamps',
            'model-bom-diff-reviews-export-xlsx',
            'model-bom-diff-reviews-export-scope',
            'model-bom-diff-reviews-export-columns'
          ],
          targetBomId: targetBom.id,
          sourceBomId: sourceBom.id,
          reviewKey,
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
