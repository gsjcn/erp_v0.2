#!/usr/bin/env node

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
  process.env.MATERIAL_SUGGESTIONS_API_BASE_URL ||
  process.env.FIRST_STAGE_API_BASE_URL ||
  'http://127.0.0.1:3000/api'
).replace(/\/$/, '');
const verificationName = 'verify-material-suggestions-api';
const customerPrefix = 'VERIFY-SUG-CUST-STABLE';
const customerNamePrefix = '历史客户摘要验证客户';
const orderPrefix = 'VERIFY-SUG-ORDER-STABLE';
const partCode = 'VERIFY-SUG-PART-STABLE';
const partName = '历史客户摘要验证零件';
const prisma = new PrismaClient();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
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

async function cleanup() {
  // material-suggestions-reusable-history-fixture: reuse stable hidden history orders instead of deleting order history.
}

async function createRegressionData() {
  await prisma.material.upsert({
    where: { partCode },
    update: {
      partName,
      unit: '件',
      partSpecification: 'summary-preview',
      status: 'ENABLED'
    },
    create: {
      partCode,
      partName,
      unit: '件',
      partSpecification: 'summary-preview'
    }
  });

  for (let index = 1; index <= 25; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const customerCode = `${customerPrefix}-${suffix}`;
    const customerName = `${customerNamePrefix} ${suffix}`;
    const customerData = {
      customerCode,
      customerName,
      contactName: '验证人员',
      contactPhone: '13800000000',
      province: '江苏省',
      city: '常州市',
      status: 'ENABLED'
    };
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
    const orderData = {
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      customerSnapshot: {
        customerCode: customer.customerCode,
        customerName: customer.customerName
      },
      orderDate: new Date(`2026-05-${String(Math.min(index, 28)).padStart(2, '0')}T00:00:00.000Z`),
      status: 'DRAFT'
    };
    const order = await prisma.customerOrder.upsert({
      where: { orderNo: `${orderPrefix}-${suffix}` },
      update: orderData,
      create: {
        orderNo: `${orderPrefix}-${suffix}`,
        ...orderData
      }
    });
    const lineData = {
      partCode,
      partName,
      partThickness: 1,
      partSpecification: 'summary-preview',
      quantity: 1,
      productionPlanQuantity: 1,
      unit: '件',
      partCategory: '通用件',
      projectModel: '历史客户摘要验证'
    };
    await prisma.orderLine.upsert({
      where: { orderId_lineNo: { orderId: order.id, lineNo: 1 } },
      update: lineData,
      create: {
        orderId: order.id,
        lineNo: 1,
        ...lineData
      }
    });
  }
}

async function main() {
  try {
    await cleanup();
    await createRegressionData();

    const suggestions = await requestJson(`/inventory/materials/suggestions?keyword=${encodeURIComponent(partCode)}`);
    assert(Array.isArray(suggestions), 'material suggestions API must return an array');
    const matched = suggestions.find((item) => String(item.partCode || '').toLocaleLowerCase() === partCode.toLocaleLowerCase());
    assert(matched, `material suggestions must include temporary part ${partCode}`);
    assert(Array.isArray(matched.historyCustomerNames), 'material suggestions must expose historyCustomerNames as an array preview');
    assert(
      matched.historyCustomerNames.length <= 20,
      `material suggestion historyCustomerNames preview must not exceed 20, actual ${matched.historyCustomerNames.length}`
    );
    assert(
      matched.historyCustomerCount === 25,
      `material suggestion historyCustomerCount must keep the real total 25, actual ${matched.historyCustomerCount}`
    );
    assert(
      matched.historyCustomerCount >= matched.historyCustomerNames.length,
      'material suggestion historyCustomerCount must be >= preview length'
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          verificationName,
          apiBaseUrl,
          partCode,
          historyCustomerPreviewLength: matched.historyCustomerNames.length,
          historyCustomerCount: matched.historyCustomerCount
        },
        null,
        2
      )
    );
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
