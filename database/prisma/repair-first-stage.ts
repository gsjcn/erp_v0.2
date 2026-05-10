import { CommonStatus, InventoryReservationStatus, OrderLineFulfillmentMode, OrderStatus, Prisma, PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPinyinSearchText, normalizeSearchKeyword } from '../../backend/src/common/pinyin-search';
import { processSnapshotToDetails } from '../../backend/src/common/serializers';

type StockSourceSelection = {
  batchId: string;
  batchNo?: string;
  quantity: number;
  compatibilityStatus?: string;
  compatibilityReason?: string;
  manualConfirmedBy?: string;
  manualConfirmedAt?: string;
  manualConfirmRemark?: string;
};

type StockSourceVolatileFieldsRepair = {
  id: string;
  orderNo: string;
  lineNo: number;
  partCode: string;
  fields: string[];
  stockSourceSelections: Prisma.InputJsonValue;
};

type StockSourceReviewStatusRepair = {
  id: string;
  orderNo: string;
  lineNo: number;
  partCode: string;
  changedCount: number;
  blockedReasons: string[];
  stockSourceSelections: Prisma.InputJsonValue;
};

type DraftReservationSyncRepair = {
  orderId: string;
  orderNo: string;
  activeReservationCount: number;
  expectedReservationCount: number;
  activeQuantity: number;
  expectedQuantity: number;
  reasons: string[];
  blockedReasons: string[];
  createRows: Prisma.InventoryReservationCreateManyInput[];
};

type PlanRepair = {
  id: string;
  orderNo: string;
  lineNo: number;
  partCode: string;
  planQuantity: number;
  previousSuggestedQuantity: number | null;
  suggestedQuantity: number;
  selectedStockQuantity: number;
  autoNormalizedStockCover: boolean;
  needsOverrideBackfill: boolean;
  overrideRepairReason: string;
  data: Prisma.OrderLineUpdateInput;
};

type ShipmentStatusRepair = {
  id: string;
  orderNo: string;
  previousStatus: OrderStatus;
  nextStatus: OrderStatus;
  customerQuantity: number;
  shippedQuantity: number;
};

type ProcessSearchRepair = {
  kind: 'definition' | 'template';
  id: string;
  name: string;
  previousNormalized: string;
  nextNormalized: string;
  previousSearchText: string;
  nextSearchText: string;
};

type MissingProcessDefinitionRepair = {
  action: 'create' | 'enable';
  id?: string;
  processName: string;
  processNameNormalized: string;
  previousStatus?: CommonStatus;
  sources: string[];
};

type RequiredProductionOperator = {
  accountId: string;
  name: string;
  role: string;
  pinyin: string;
  pinyinInitials: string;
  keywords: string[];
  idCardMasked?: string | null;
  idCardBound?: boolean;
};

type ProductionOperatorRepair = {
  action: 'create' | 'update';
  id?: string;
  accountId: string;
  previousLabel: string;
  next: RequiredProductionOperator;
};

type ConsumedReservationRepair = {
  orderId: string;
  orderNo: string;
  orderLineId: string;
  lineNo: number;
  partCode: string;
  partName: string;
  batchId: string;
  batchNo: string;
  quantity: number;
  unit: string;
  blockedReasons: string[];
};

type StockAllocationRepair = {
  orderNo: string;
  lineNo: number;
  partCode: string;
  selectedQuantity: number;
  stockOutQuantity: number;
  allocationInQuantity: number;
  orderBatchCount: number;
  blockedReasons: string[];
};

const quantityTolerance = 0.0001;
const serializableRepairRetryCount = 3;
const volatileStockSourceFields = ['availableQuantity', 'reservedQuantity', 'currentQuantity', 'physicalQuantity'];
const stockCompatibilityStatuses = new Set(['MATCHED', 'NEEDS_CONFIRMATION', 'INCOMPLETE', 'UNKNOWN']);
const historyOperator = {
  code: 'HISTORY-BACKFILL',
  name: '历史数据补录',
  role: '系统补录'
};

const requiredProductionOperators: RequiredProductionOperator[] = [
  {
    accountId: 'PLAN-001',
    name: '刘计划',
    role: '生产计划员',
    pinyin: 'liujihua',
    pinyinInitials: 'ljh',
    keywords: ['liu', 'jihua', 'ljh', '计划', '下计划', '下单', '订单']
  },
  {
    accountId: 'ORDER-001',
    name: '孙下单',
    role: '下单管理员',
    pinyin: 'sunxiadan',
    pinyinInitials: 'sxd',
    keywords: ['sun', 'xiadan', 'sxd', '下单', '订单', '订单管理员']
  },
  {
    accountId: 'WS-001',
    name: '陈主任',
    role: '车间主任',
    pinyin: 'chenzhuren',
    pinyinInitials: 'czr',
    keywords: ['chen', 'zhuren', 'czr', '车间主任', '主任', '车间', '主管']
  },
  {
    accountId: 'TECH-001',
    name: '王工艺',
    role: '技术工艺员',
    pinyin: 'wanggongyi',
    pinyinInitials: 'wgy',
    keywords: ['wang', 'gongyi', 'wgy', '技术', '工艺', '流程']
  },
  {
    accountId: 'OP-001',
    name: '张明',
    role: '冲压操作员',
    pinyin: 'zhangming',
    pinyinInitials: 'zm',
    keywords: ['zhang', 'ming', 'zm', '冲压']
  },
  {
    accountId: 'OP-002',
    name: '李强',
    role: '激光切割操作员',
    pinyin: 'liqiang',
    pinyinInitials: 'lq',
    keywords: ['li', 'qiang', 'lq', '激光', '切割']
  },
  {
    accountId: 'OP-003',
    name: '王磊',
    role: '焊接操作员',
    pinyin: 'wanglei',
    pinyinInitials: 'wl',
    keywords: ['wang', 'lei', 'wl', '焊接']
  },
  {
    accountId: 'OP-004',
    name: '赵敏',
    role: '包装操作员',
    pinyin: 'zhaomin',
    pinyinInitials: 'zm',
    keywords: ['zhao', 'min', 'zm', '包装']
  },
  {
    accountId: 'OP-005',
    name: '顾胜钧',
    role: '折弯操作员',
    pinyin: 'gushengjun',
    pinyinInitials: 'gsj',
    keywords: ['gu', 'sheng', 'jun', 'gs', 'gsj', '折弯'],
    idCardMasked: '3204********1234',
    idCardBound: true
  }
];

loadRootEnv();

const prisma = new PrismaClient();
const writeMode = process.argv.includes('--write');

async function main() {
  const planRepairs = await collectPlanRepairs();
  const stockSourceVolatileFieldRepairs = await collectStockSourceVolatileFieldRepairs();
  const stockSourceReviewStatusRepairs = await collectStockSourceReviewStatusRepairs();
  const draftReservationSyncRepairs = await collectDraftReservationSyncRepairs();
  const shipmentStatusRepairs = await collectShipmentStatusRepairs();
  const processSearchRepairs = await collectProcessSearchRepairs();
  const missingProcessDefinitionRepairs = await collectMissingProcessDefinitionRepairs();
  const productionOperatorRepairs = await collectProductionOperatorRepairs();
  const consumedReservationRepairs = await collectConsumedReservationRepairs();
  const stockAllocationRepairs = await collectStockAllocationRepairs();

  printPlanRepairs(planRepairs);
  printStockSourceVolatileFieldRepairs(stockSourceVolatileFieldRepairs);
  printStockSourceReviewStatusRepairs(stockSourceReviewStatusRepairs);
  printDraftReservationSyncRepairs(draftReservationSyncRepairs);
  printShipmentStatusRepairs(shipmentStatusRepairs);
  printProcessSearchRepairs(processSearchRepairs);
  printMissingProcessDefinitionRepairs(missingProcessDefinitionRepairs);
  printProductionOperatorRepairs(productionOperatorRepairs);
  printConsumedReservationRepairs(consumedReservationRepairs);
  printStockAllocationRepairs(stockAllocationRepairs);

  if (!writeMode) {
    console.log('当前为 dry-run，只报告将修复的记录。确认后执行：npm run backend:repair:first-stage -- --write');
    return;
  }

  assertNoBlockedRepairs(stockSourceReviewStatusRepairs, draftReservationSyncRepairs, consumedReservationRepairs, stockAllocationRepairs);

  await runSerializableRepairWrite(() =>
    prisma.$transaction(
      async (tx) => {
      if (planRepairs.length > 0) {
        for (const repair of planRepairs) {
          await tx.orderLine.update({
            where: { id: repair.id },
            data: repair.data
          });
        }
      }

      if (stockSourceVolatileFieldRepairs.length > 0) {
        for (const repair of stockSourceVolatileFieldRepairs) {
          await tx.orderLine.update({
            where: { id: repair.id },
            data: { stockSourceSelections: repair.stockSourceSelections }
          });
        }
      }

      if (stockSourceReviewStatusRepairs.length > 0) {
        for (const repair of stockSourceReviewStatusRepairs) {
          if (repair.changedCount <= 0) {
            continue;
          }
          await tx.orderLine.update({
            where: { id: repair.id },
            data: { stockSourceSelections: repair.stockSourceSelections }
          });
        }
      }

      if (draftReservationSyncRepairs.length > 0) {
        for (const repair of draftReservationSyncRepairs) {
          await tx.inventoryReservation.updateMany({
            where: { orderId: repair.orderId, status: InventoryReservationStatus.ACTIVE },
            data: {
              status: InventoryReservationStatus.RELEASED,
              statusReason: 'HISTORY_DRAFT_RESERVATION_SYNC',
              releasedAt: new Date()
            }
          });
          if (repair.createRows.length > 0) {
            await tx.inventoryReservation.createMany({ data: repair.createRows });
          }
        }
      }

      if (shipmentStatusRepairs.length > 0) {
        for (const repair of shipmentStatusRepairs) {
          await tx.customerOrder.update({
            where: { id: repair.id },
            data: { status: repair.nextStatus }
          });
        }
      }

      if (processSearchRepairs.length > 0) {
        for (const repair of processSearchRepairs) {
          if (repair.kind === 'definition') {
            await tx.processDefinition.update({
              where: { id: repair.id },
              data: {
                processNameNormalized: repair.nextNormalized,
                searchText: repair.nextSearchText
              }
            });
            continue;
          }

          await tx.processTemplate.update({
            where: { id: repair.id },
            data: {
              templateNameNormalized: repair.nextNormalized,
              searchText: repair.nextSearchText
            }
          });
        }
      }

      if (missingProcessDefinitionRepairs.length > 0) {
        for (const repair of missingProcessDefinitionRepairs) {
          if (repair.action === 'create') {
            await tx.processDefinition.create({
              data: {
                processName: repair.processName,
                processNameNormalized: repair.processNameNormalized,
                remark: '历史订单或流程模板引用补录',
                searchText: buildPinyinSearchText([repair.processName, '历史订单或流程模板引用补录']),
                status: CommonStatus.ENABLED
              }
            });
            continue;
          }

          if (repair.id) {
            await tx.processDefinition.update({
              where: { id: repair.id },
              data: { status: CommonStatus.ENABLED }
            });
          }
        }
      }

      if (productionOperatorRepairs.length > 0) {
        for (const repair of productionOperatorRepairs) {
          const data = toProductionOperatorWriteData(repair.next);
          if (repair.action === 'create') {
            await tx.productionOperator.create({ data });
            continue;
          }
          if (repair.id) {
            await tx.productionOperator.update({
              where: { id: repair.id },
              data
            });
          }
        }
      }

      if (consumedReservationRepairs.length > 0) {
        for (const repair of consumedReservationRepairs) {
          if (repair.quantity <= quantityTolerance) {
            continue;
          }
          await tx.inventoryReservation.create({
            data: {
              batchId: repair.batchId,
              orderId: repair.orderId,
              orderLineId: repair.orderLineId,
              orderNo: repair.orderNo,
              partCode: repair.partCode,
              partName: repair.partName,
              quantity: repair.quantity,
              unit: repair.unit,
              status: InventoryReservationStatus.CONSUMED,
              statusReason: 'HISTORY_CONSUMED_RESERVATION_BACKFILL',
              consumedAt: new Date()
            }
          });
        }
      }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );

  console.log(
    `第一阶段历史数据修复完成：已写入 ${planRepairs.length} 条订单零件生产计划记录，${stockSourceVolatileFieldRepairs.length} 条库存来源临时字段清理记录，${draftReservationSyncRepairs.length} 条草稿库存预占同步记录，${shipmentStatusRepairs.length} 条订单发货状态记录，${processSearchRepairs.length} 条流程搜索记录，${missingProcessDefinitionRepairs.length} 条标准工序补录记录，${productionOperatorRepairs.length} 条生产操作人员记录，${consumedReservationRepairs.length} 条库存消费预占记录。`
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSerializableRepairConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

async function runSerializableRepairWrite<T>(action: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= serializableRepairRetryCount; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (!isSerializableRepairConflict(error)) {
        throw error;
      }

      lastError = error;
      if (attempt < serializableRepairRetryCount) {
        await delay(80 * attempt);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError || 'unknown error');
  throw new Error(`历史数据修复写入遇到并发冲突，已重试 ${serializableRepairRetryCount} 次仍失败，请稍后重试：${message}`);
}

function assertNoBlockedRepairs(
  stockSourceReviewStatusRepairs: StockSourceReviewStatusRepair[],
  draftReservationSyncRepairs: DraftReservationSyncRepair[],
  consumedReservationRepairs: ConsumedReservationRepair[],
  stockAllocationRepairs: StockAllocationRepair[]
) {
  const messages: string[] = [];
  const blockedStockSourceReviewRepairs = stockSourceReviewStatusRepairs.filter((repair) => repair.blockedReasons.length > 0);
  if (blockedStockSourceReviewRepairs.length > 0) {
    messages.push(
      `库存来源核对状态 ${blockedStockSourceReviewRepairs.length} 条：` +
        blockedStockSourceReviewRepairs.map((repair) => `${repair.orderNo} / line ${repair.lineNo} ${repair.blockedReasons.join('；')}`).join(' | ')
    );
  }

  const blockedDraftRepairs = draftReservationSyncRepairs.filter((repair) => repair.blockedReasons.length > 0);
  if (blockedDraftRepairs.length > 0) {
    messages.push(
      `草稿库存预占同步 ${blockedDraftRepairs.length} 条：` +
        blockedDraftRepairs.map((repair) => `${repair.orderNo} ${repair.blockedReasons.join('；')}`).join(' | ')
    );
  }

  const blockedConsumedReservationRepairs = consumedReservationRepairs.filter((repair) => repair.blockedReasons.length > 0);
  if (blockedConsumedReservationRepairs.length > 0) {
    messages.push(
      `库存消费预占记录 ${blockedConsumedReservationRepairs.length} 条：` +
        blockedConsumedReservationRepairs
          .map((repair) => `${repair.orderNo} / line ${repair.lineNo} / ${repair.batchNo} ${repair.blockedReasons.join('；')}`)
          .join(' | ')
    );
  }

  const blockedStockAllocationRepairs = stockAllocationRepairs.filter((repair) => repair.blockedReasons.length > 0);
  if (blockedStockAllocationRepairs.length > 0) {
    messages.push(
      `使用库存转订单待发货 ${blockedStockAllocationRepairs.length} 条：` +
        blockedStockAllocationRepairs
          .map((repair) => `${repair.orderNo} / line ${repair.lineNo} / ${repair.partCode} ${repair.blockedReasons.join('；')}`)
          .join(' | ')
    );
  }

  if (messages.length > 0) {
    throw new Error(`历史数据修复存在阻断问题，已停止写入。${messages.join(' || ')}`);
  }
}

function loadRootEnv() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
    resolve(process.cwd(), 'backend/.env')
  ];

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
}

async function collectPlanRepairs(): Promise<PlanRepair[]> {
  const operators = await prisma.productionOperator.findMany({
    select: { accountId: true, name: true, role: true, status: true }
  });
  const operatorByCode = new Map(operators.map((operator) => [operator.accountId.trim().toLocaleLowerCase(), operator]));
  const lines = await prisma.orderLine.findMany({
    include: {
      order: { select: { orderNo: true } }
    },
    orderBy: [{ orderId: 'asc' }, { lineNo: 'asc' }]
  });

  const repairs: PlanRepair[] = [];

  for (const line of lines) {
    const orderQuantity = decimalToNumber(line.quantity);
    const planQuantity = decimalToNumber(line.productionPlanQuantity);
    const selectedStockQuantity = selectedStockSourceQuantity(line.stockSourceSelections);
    const suggestedQuantity =
      line.fulfillmentMode === OrderLineFulfillmentMode.STOCK ? roundQuantity(Math.max(orderQuantity - selectedStockQuantity, 0)) : orderQuantity;
    const previousSuggestedQuantity =
      line.productionPlanSuggestedQuantity === null || line.productionPlanSuggestedQuantity === undefined
        ? null
        : decimalToNumber(line.productionPlanSuggestedQuantity);
    const suggestedStale = previousSuggestedQuantity === null || quantityDiffers(previousSuggestedQuantity, suggestedQuantity);
    const planDiffers = quantityDiffers(planQuantity, suggestedQuantity);
    const overrideOperatorCode = line.productionPlanOverrideByCode?.trim() || '';
    const overrideOperator = overrideOperatorCode ? operatorByCode.get(overrideOperatorCode.toLocaleLowerCase()) : null;
    const stockCoversCustomerQuantity =
      line.fulfillmentMode === OrderLineFulfillmentMode.STOCK &&
      suggestedQuantity <= quantityTolerance &&
      selectedStockQuantity + quantityTolerance >= orderQuantity;
    const hasExplicitProductionPlanOverride = Boolean(overrideOperatorCode || line.productionPlanOverrideReason?.trim());
    const autoNormalizedStockCover = stockCoversCustomerQuantity && planQuantity > quantityTolerance && !hasExplicitProductionPlanOverride;
    const overrideHasRequiredFields = Boolean(
      overrideOperatorCode &&
        line.productionPlanOverrideByName?.trim() &&
        line.productionPlanOverrideByRole?.trim() &&
        line.productionPlanOverrideAt &&
        line.productionPlanOverrideReason?.trim()
    );
    let overrideRepairReason = '';
    let overrideSnapshotData: Pick<
      Prisma.OrderLineUpdateInput,
      'productionPlanOverrideByCode' | 'productionPlanOverrideByName' | 'productionPlanOverrideByRole'
    > | null = null;

    if (autoNormalizedStockCover) {
      overrideRepairReason = '';
    } else if (planDiffers) {
      if (!overrideHasRequiredFields) {
        overrideRepairReason = '补齐偏差操作员、岗位、时间或说明';
      } else if (overrideOperatorCode.toLocaleUpperCase() === historyOperator.code) {
        overrideRepairReason = '';
      } else if (!overrideOperator) {
        overrideRepairReason = `操作人员 ${overrideOperatorCode} 不存在，改为历史补录账号`;
        overrideSnapshotData = {
          productionPlanOverrideByCode: historyOperator.code,
          productionPlanOverrideByName: historyOperator.name,
          productionPlanOverrideByRole: historyOperator.role
        };
      } else if (overrideOperator.status !== CommonStatus.ENABLED) {
        overrideRepairReason = `操作人员 ${overrideOperatorCode} 已停用，改为历史补录账号`;
        overrideSnapshotData = {
          productionPlanOverrideByCode: historyOperator.code,
          productionPlanOverrideByName: historyOperator.name,
          productionPlanOverrideByRole: historyOperator.role
        };
      } else if (!isSubmitPlanOperatorRole(overrideOperator.role)) {
        overrideRepairReason = `操作人员 ${overrideOperatorCode} 岗位不是下单/计划管理人员，改为历史补录账号`;
        overrideSnapshotData = {
          productionPlanOverrideByCode: historyOperator.code,
          productionPlanOverrideByName: historyOperator.name,
          productionPlanOverrideByRole: historyOperator.role
        };
      } else if (line.productionPlanOverrideByName !== overrideOperator.name || line.productionPlanOverrideByRole !== overrideOperator.role) {
        overrideRepairReason = `同步操作人员 ${overrideOperatorCode} 的姓名和岗位快照`;
        overrideSnapshotData = {
          productionPlanOverrideByCode: overrideOperator.accountId,
          productionPlanOverrideByName: overrideOperator.name,
          productionPlanOverrideByRole: overrideOperator.role
        };
      }
    }
    const needsOverrideBackfill = planDiffers && Boolean(overrideRepairReason);

    if (!suggestedStale && !needsOverrideBackfill) {
      continue;
    }

    const data: Prisma.OrderLineUpdateInput = {};
    if (suggestedStale) {
      data.productionPlanSuggestedQuantity = suggestedQuantity;
    }
    if (autoNormalizedStockCover) {
      data.productionPlanQuantity = suggestedQuantity;
      data.productionPlanSuggestedQuantity = suggestedQuantity;
      data.productionPlanOverrideByCode = null;
      data.productionPlanOverrideByName = null;
      data.productionPlanOverrideByRole = null;
      data.productionPlanOverrideAt = null;
      data.productionPlanOverrideReason = null;
    }
    if (needsOverrideBackfill) {
      data.productionPlanOverrideByCode =
        overrideSnapshotData?.productionPlanOverrideByCode || line.productionPlanOverrideByCode?.trim() || historyOperator.code;
      data.productionPlanOverrideByName =
        overrideSnapshotData?.productionPlanOverrideByName || line.productionPlanOverrideByName?.trim() || historyOperator.name;
      data.productionPlanOverrideByRole =
        overrideSnapshotData?.productionPlanOverrideByRole || line.productionPlanOverrideByRole?.trim() || historyOperator.role;
      data.productionPlanOverrideAt = line.productionPlanOverrideAt || new Date();
      data.productionPlanOverrideReason =
        line.productionPlanOverrideReason?.trim() ||
        `历史数据补录：生产计划数量 ${planQuantity} 与建议数量 ${suggestedQuantity} 不一致，按当前订单和库存来源补齐说明。`;
    }

    repairs.push({
      id: line.id,
      orderNo: line.order.orderNo,
      lineNo: line.lineNo,
      partCode: line.partCode,
      planQuantity,
      previousSuggestedQuantity,
      suggestedQuantity,
      selectedStockQuantity,
      autoNormalizedStockCover,
      needsOverrideBackfill,
      overrideRepairReason,
      data
    });
  }

  return repairs;
}

function printPlanRepairs(repairs: PlanRepair[]) {
  console.log(`第一阶段历史数据修复检查：生产计划记录 ${repairs.length} 条需要处理。`);
  for (const repair of repairs) {
    const oldSuggested = repair.previousSuggestedQuantity === null ? '空' : String(repair.previousSuggestedQuantity);
    const overrideStatus = repair.autoNormalizedStockCover
      ? '库存已覆盖客户数量，自动把历史生产计划数量归零'
      : repair.needsOverrideBackfill
        ? repair.overrideRepairReason
        : '仅同步建议数量';
    console.log(
      `[${writeMode ? 'write' : 'dry-run'}] ${repair.orderNo} / ${repair.partCode} / line ${repair.lineNo}: ` +
        `productionPlanQuantity=${repair.planQuantity}, selectedStock=${repair.selectedStockQuantity}, ` +
        `productionPlanSuggestedQuantity ${oldSuggested} -> ${repair.suggestedQuantity}, ${overrideStatus}`
    );
  }
}

function isSubmitPlanOperatorRole(role?: string | null) {
  const value = role || '';
  return /计划|下单|订单/.test(value) && !/车间|主任|技术|工艺/.test(value);
}

async function collectStockSourceVolatileFieldRepairs(): Promise<StockSourceVolatileFieldsRepair[]> {
  const lines = await prisma.orderLine.findMany({
    where: { stockSourceSelections: { not: Prisma.JsonNull } },
    include: { order: { select: { orderNo: true } } },
    orderBy: [{ orderId: 'asc' }, { lineNo: 'asc' }]
  });
  const repairs: StockSourceVolatileFieldsRepair[] = [];

  for (const line of lines) {
    const result = sanitizeStockSourceSelections(line.stockSourceSelections);
    if (!result.changed) {
      continue;
    }

    repairs.push({
      id: line.id,
      orderNo: line.order.orderNo,
      lineNo: line.lineNo,
      partCode: line.partCode,
      fields: result.fields,
      stockSourceSelections: result.value
    });
  }

  return repairs;
}

function sanitizeStockSourceSelections(value: Prisma.JsonValue | null | undefined): {
  changed: boolean;
  fields: string[];
  value: Prisma.InputJsonValue;
} {
  if (!Array.isArray(value)) {
    return { changed: false, fields: [], value: [] };
  }

  const fields = new Set<string>();
  const sanitized = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return item as Prisma.InputJsonValue;
    }
    const row = { ...(item as Record<string, unknown>) };
    for (const field of volatileStockSourceFields) {
      if (Object.prototype.hasOwnProperty.call(row, field)) {
        fields.add(field);
        delete row[field];
      }
    }
    return row as Prisma.InputJsonValue;
  });

  return {
    changed: fields.size > 0,
    fields: [...fields].sort(),
    value: sanitized as Prisma.InputJsonValue
  };
}

function printStockSourceVolatileFieldRepairs(repairs: StockSourceVolatileFieldsRepair[]) {
  console.log(`第一阶段历史数据修复检查：库存来源临时字段 ${repairs.length} 条需要处理。`);
  for (const repair of repairs) {
    console.log(
      `[${writeMode ? 'write' : 'dry-run'}] ${repair.orderNo} / line ${repair.lineNo} / ${repair.partCode}: ` +
        `清理 selectedStockSources 临时字段 ${repair.fields.join(', ')}`
    );
  }
}

async function collectStockSourceReviewStatusRepairs(): Promise<StockSourceReviewStatusRepair[]> {
  const lines = await prisma.orderLine.findMany({
    where: { stockSourceSelections: { not: Prisma.JsonNull } },
    include: { order: { select: { orderNo: true } } },
    orderBy: [{ orderId: 'asc' }, { lineNo: 'asc' }]
  });

  const repairs: StockSourceReviewStatusRepair[] = [];
  for (const line of lines) {
    const result = repairStockSourceReviewStatuses(line.stockSourceSelections);
    if (result.changedCount === 0 && result.blockedReasons.length === 0) {
      continue;
    }
    repairs.push({
      id: line.id,
      orderNo: line.order.orderNo,
      lineNo: line.lineNo,
      partCode: line.partCode,
      changedCount: result.changedCount,
      blockedReasons: result.blockedReasons,
      stockSourceSelections: result.value
    });
  }

  return repairs;
}

function repairStockSourceReviewStatuses(value: Prisma.JsonValue | null | undefined): {
  changedCount: number;
  blockedReasons: string[];
  value: Prisma.InputJsonValue;
} {
  const sanitized = sanitizeStockSourceSelections(value).value;
  if (!Array.isArray(sanitized)) {
    return { changedCount: 0, blockedReasons: [], value: sanitized };
  }

  let changedCount = 0;
  const blockedReasons: string[] = [];
  const nextRows = sanitized.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return item as Prisma.InputJsonValue;
    }
    const row = { ...(item as Record<string, unknown>) };
    const batchId = stringValue(row.batchId);
    const quantity = Number(row.quantity || 0);
    if (!batchId || quantity <= 0) {
      return row as Prisma.InputJsonValue;
    }

    const batchLabel = stringValue(row.batchNo) || batchId;
    const status = stringValue(row.compatibilityStatus);
    if (stockCompatibilityStatuses.has(status)) {
      return row as Prisma.InputJsonValue;
    }

    if (!stockSourceManualConfirmationComplete(row)) {
      blockedReasons.push(
        `库存批次 ${batchLabel} ${status ? `compatibilityStatus=${status} 非法` : '缺少 compatibilityStatus'}，且缺少人工确认记录`
      );
      return row as Prisma.InputJsonValue;
    }

    row.compatibilityStatus = 'NEEDS_CONFIRMATION';
    if (!stringValue(row.compatibilityReason)) {
      row.compatibilityReason = status
        ? `历史数据 compatibilityStatus=${status} 非法，按人工确认记录补齐为需要确认`
        : '历史数据缺少库存来源核对结果，按人工确认记录补齐为需要确认';
    }
    changedCount += 1;
    return row as Prisma.InputJsonValue;
  });

  return {
    changedCount,
    blockedReasons,
    value: nextRows as Prisma.InputJsonValue
  };
}

function stockSourceManualConfirmationComplete(source: Record<string, unknown>) {
  const confirmedAt = stringValue(source.manualConfirmedAt);
  return Boolean(
    stringValue(source.manualConfirmedBy) &&
      confirmedAt &&
      !Number.isNaN(new Date(confirmedAt).getTime()) &&
      stringValue(source.manualConfirmRemark)
  );
}

function printStockSourceReviewStatusRepairs(repairs: StockSourceReviewStatusRepair[]) {
  console.log(`第一阶段历史数据修复检查：库存来源核对状态 ${repairs.length} 条需要处理。`);
  for (const repair of repairs) {
    const blockedText = repair.blockedReasons.length ? `；阻断：${repair.blockedReasons.join('；')}` : '';
    console.log(
      `[${writeMode ? 'write' : 'dry-run'}] ${repair.orderNo} / line ${repair.lineNo} / ${repair.partCode}: ` +
        `补齐 compatibilityStatus ${repair.changedCount} 批${blockedText}`
    );
  }
}

async function collectDraftReservationSyncRepairs(): Promise<DraftReservationSyncRepair[]> {
  const orders = await prisma.customerOrder.findMany({
    where: { status: OrderStatus.DRAFT },
    include: {
      lines: { orderBy: { lineNo: 'asc' } },
      inventoryReservations: {
        where: { status: InventoryReservationStatus.ACTIVE },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      }
    },
    orderBy: [{ createdAt: 'asc' }, { orderNo: 'asc' }]
  });

  const selectedBatchIds = [
    ...new Set(
      orders.flatMap((order) =>
        order.lines.flatMap((line) => normalizeStockSourceSelections(line.stockSourceSelections).map((source) => source.batchId))
      )
    )
  ];
  const batches = selectedBatchIds.length
    ? await prisma.inventoryBatch.findMany({
        where: { id: { in: selectedBatchIds } },
        include: {
          reservations: {
            where: { status: InventoryReservationStatus.ACTIVE },
            select: { orderId: true, quantity: true }
          }
        }
      })
    : [];
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const draftOrderIds = new Set(orders.map((order) => order.id));
  const expectedBeforeQuantityByOrderBatchKey = new Map<string, number>();
  const runningExpectedQuantityByBatchId = new Map<string, number>();
  for (const order of orders) {
    const orderExpectedByBatchId = new Map<string, number>();
    for (const line of order.lines) {
      if (line.fulfillmentMode !== OrderLineFulfillmentMode.STOCK && line.fulfillmentMode !== OrderLineFulfillmentMode.REWORK) {
        continue;
      }
      for (const source of normalizeStockSourceSelections(line.stockSourceSelections)) {
        orderExpectedByBatchId.set(
          source.batchId,
          roundQuantity((orderExpectedByBatchId.get(source.batchId) || 0) + source.quantity)
        );
      }
    }
    for (const [batchId, expectedQuantity] of orderExpectedByBatchId) {
      const runningQuantity = runningExpectedQuantityByBatchId.get(batchId) || 0;
      expectedBeforeQuantityByOrderBatchKey.set(sourceKey(order.id, batchId), runningQuantity);
      runningExpectedQuantityByBatchId.set(batchId, roundQuantity(runningQuantity + expectedQuantity));
    }
  }
  const repairs: DraftReservationSyncRepair[] = [];

  for (const order of orders) {
    const createRows: Prisma.InventoryReservationCreateManyInput[] = [];
    const expected = new Map<string, number>();
    const expectedByBatchId = new Map<string, number>();
    const existingCreatedAtByKey = new Map<string, Date>();
    for (const reservation of order.inventoryReservations) {
      const key = sourceKey(reservation.orderLineId, reservation.batchId);
      if (!existingCreatedAtByKey.has(key)) {
        existingCreatedAtByKey.set(key, reservation.createdAt);
      }
    }
    for (const line of order.lines) {
      if (line.fulfillmentMode !== OrderLineFulfillmentMode.STOCK && line.fulfillmentMode !== OrderLineFulfillmentMode.REWORK) {
        continue;
      }
      for (const source of normalizeStockSourceSelections(line.stockSourceSelections)) {
        const key = sourceKey(line.id, source.batchId);
        expected.set(key, roundQuantity((expected.get(key) || 0) + source.quantity));
        expectedByBatchId.set(source.batchId, roundQuantity((expectedByBatchId.get(source.batchId) || 0) + source.quantity));
        createRows.push({
          batchId: source.batchId,
          orderId: order.id,
          orderLineId: line.id,
          orderNo: order.orderNo,
          partCode: line.partCode,
          partName: line.partName,
          quantity: source.quantity,
          unit: line.unit,
          status: InventoryReservationStatus.ACTIVE,
          statusReason: 'DRAFT_ORDER_RESERVED',
          createdAt: existingCreatedAtByKey.get(key) || order.createdAt
        });
      }
    }

    const actual = new Map<string, number>();
    for (const reservation of order.inventoryReservations) {
      const key = sourceKey(reservation.orderLineId, reservation.batchId);
      actual.set(key, roundQuantity((actual.get(key) || 0) + decimalToNumber(reservation.quantity)));
    }

    const reasons: string[] = [];
    const blockedReasons: string[] = [];
    for (const [key, quantity] of expected) {
      const activeQuantity = actual.get(key) || 0;
      if (quantityDiffers(quantity, activeQuantity)) {
        reasons.push(`${key} 应预占 ${quantity}，实际 ACTIVE ${activeQuantity}`);
      }
    }
    for (const [key, quantity] of actual) {
      if (!expected.has(key)) {
        reasons.push(`${key} 是多余 ACTIVE 预占 ${quantity}`);
      }
    }

    for (const [batchId, expectedQuantity] of expectedByBatchId) {
      const batch = batchById.get(batchId);
      if (!batch) {
        blockedReasons.push(`库存批次 ${batchId} 不存在`);
        continue;
      }
      if (batch.sourceOrderId) {
        blockedReasons.push(`库存批次 ${batch.batchNo} 是订单待发货库存，不能作为备货来源`);
      }
      if (batch.status !== 'AVAILABLE') {
        blockedReasons.push(`库存批次 ${batch.batchNo} 状态为 ${batch.status}`);
      }
      const externalActiveQuantity = roundQuantity(
        batch.reservations
          .filter((reservation) => !draftOrderIds.has(reservation.orderId))
          .reduce((sum, reservation) => sum + decimalToNumber(reservation.quantity), 0)
      );
      const priorDraftExpectedQuantity = expectedBeforeQuantityByOrderBatchKey.get(sourceKey(order.id, batchId)) || 0;
      const availableQuantity = roundQuantity(decimalToNumber(batch.quantity) - externalActiveQuantity - priorDraftExpectedQuantity);
      if (availableQuantity + quantityTolerance < expectedQuantity) {
        blockedReasons.push(
          `库存批次 ${batch.batchNo} 当前剩余 ${decimalToNumber(batch.quantity)}，外部 ACTIVE 预占 ${externalActiveQuantity}，` +
            `前序草稿应预占 ${priorDraftExpectedQuantity}，可用 ${availableQuantity}，本订单需要 ${expectedQuantity}`
        );
      }
    }

    if (reasons.length === 0 && blockedReasons.length === 0) {
      continue;
    }

    repairs.push({
      orderId: order.id,
      orderNo: order.orderNo,
      activeReservationCount: order.inventoryReservations.length,
      expectedReservationCount: createRows.length,
      activeQuantity: roundQuantity(Array.from(actual.values()).reduce((sum, quantity) => sum + quantity, 0)),
      expectedQuantity: roundQuantity(Array.from(expected.values()).reduce((sum, quantity) => sum + quantity, 0)),
      reasons,
      blockedReasons,
      createRows
    });
  }

  return repairs;
}

function printDraftReservationSyncRepairs(repairs: DraftReservationSyncRepair[]) {
  console.log(`第一阶段历史数据修复检查：草稿库存预占同步 ${repairs.length} 条需要处理。`);
  for (const repair of repairs) {
    const reasonText = repair.reasons.length ? repair.reasons.join('；') : '预占数量已一致';
    const blockedText = repair.blockedReasons.length ? `；阻断：${repair.blockedReasons.join('；')}` : '';
    console.log(
      `[${writeMode ? 'write' : 'dry-run'}] ${repair.orderNo}: ACTIVE ${repair.activeReservationCount} 条 / ${repair.activeQuantity}，` +
        `应同步为 ${repair.expectedReservationCount} 条 / ${repair.expectedQuantity}；${reasonText}${blockedText}`
    );
  }
}

async function collectShipmentStatusRepairs(): Promise<ShipmentStatusRepair[]> {
  const orders = await prisma.customerOrder.findMany({
    where: {
      status: { notIn: [OrderStatus.DRAFT, OrderStatus.CANCELLED] }
    },
    include: { lines: true },
    orderBy: { orderNo: 'asc' }
  });
  const orderLineIds = orders.flatMap((order) => order.lines.map((line) => line.id));
  const shipmentTransactions = orderLineIds.length
    ? await prisma.inventoryTransaction.findMany({
        where: {
          transactionType: 'OUT',
          sourceRecordType: 'InventoryBatch',
          OR: [{ orderLineId: { in: orderLineIds } }, { batch: { sourceOrderLineId: { in: orderLineIds } } }]
        },
        select: {
          id: true,
          orderLineId: true,
          quantity: true,
          unit: true,
          batch: { select: { sourceOrderLineId: true } }
        }
      })
    : [];

  const shippedQuantityByLineUnit = new Map<string, Map<string, number>>();
  const countedTransactionIds = new Set<string>();
  for (const transaction of shipmentTransactions) {
    if (countedTransactionIds.has(transaction.id)) {
      continue;
    }
    countedTransactionIds.add(transaction.id);
    const lineId = transaction.orderLineId || transaction.batch?.sourceOrderLineId;
    if (!lineId) {
      continue;
    }
    const unitMap = shippedQuantityByLineUnit.get(lineId) || new Map<string, number>();
    const unit = transaction.unit || '件';
    unitMap.set(unit, roundQuantity((unitMap.get(unit) || 0) + decimalToNumber(transaction.quantity)));
    shippedQuantityByLineUnit.set(lineId, unitMap);
  }

  const repairs: ShipmentStatusRepair[] = [];
  for (const order of orders) {
    let customerQuantity = 0;
    let shippedQuantity = 0;
    let hasPositiveOrderQuantity = false;
    let isFullyShipped = order.lines.length > 0;
    for (const line of order.lines) {
      const unit = line.unit || '件';
      const lineQuantity = decimalToNumber(line.quantity);
      const lineShippedQuantity = shippedQuantityByLineUnit.get(line.id)?.get(unit) || 0;
      customerQuantity = roundQuantity(customerQuantity + lineQuantity);
      shippedQuantity = roundQuantity(shippedQuantity + lineShippedQuantity);
      if (lineQuantity > 0) {
        hasPositiveOrderQuantity = true;
      }
      if (lineQuantity > 0 && lineShippedQuantity + quantityTolerance < lineQuantity) {
        isFullyShipped = false;
      }
    }
    isFullyShipped = hasPositiveOrderQuantity && isFullyShipped;
    const nextStatus = isFullyShipped
      ? OrderStatus.COMPLETED
      : order.status === OrderStatus.COMPLETED
        ? OrderStatus.IN_PRODUCTION
        : order.status;
    if (order.status === nextStatus) {
      continue;
    }

    repairs.push({
      id: order.id,
      orderNo: order.orderNo,
      previousStatus: order.status,
      nextStatus,
      customerQuantity,
      shippedQuantity
    });
  }
  return repairs;
}

function printShipmentStatusRepairs(repairs: ShipmentStatusRepair[]) {
  console.log(`第一阶段历史数据修复检查：订单发货状态 ${repairs.length} 条需要处理。`);
  for (const repair of repairs) {
    console.log(
      `[${writeMode ? 'write' : 'dry-run'}] ${repair.orderNo}: CustomerOrder.status ${repair.previousStatus} -> ${repair.nextStatus}, ` +
        `客户订单数量=${repair.customerQuantity}, 发货数量=${repair.shippedQuantity}`
    );
  }
}

async function collectProcessSearchRepairs(): Promise<ProcessSearchRepair[]> {
  const [definitions, templates] = await Promise.all([
    prisma.processDefinition.findMany({
      select: {
        id: true,
        processName: true,
        processNameNormalized: true,
        searchText: true,
        remark: true
      },
      orderBy: { processName: 'asc' }
    }),
    prisma.processTemplate.findMany({
      select: {
        id: true,
        templateName: true,
        templateNameNormalized: true,
        steps: true,
        searchText: true,
        remark: true
      },
      orderBy: { templateName: 'asc' }
    })
  ]);

  const repairs: ProcessSearchRepair[] = [];

  for (const definition of definitions) {
    const nextNormalized = normalizeSearchKeyword(definition.processName);
    const nextSearchText = buildPinyinSearchText([definition.processName, definition.remark]);
    if (definition.processNameNormalized === nextNormalized && definition.searchText === nextSearchText) {
      continue;
    }

    repairs.push({
      kind: 'definition',
      id: definition.id,
      name: definition.processName,
      previousNormalized: definition.processNameNormalized,
      nextNormalized,
      previousSearchText: definition.searchText,
      nextSearchText
    });
  }

  for (const template of templates) {
    const steps = processSnapshotToDetails(template.steps);
    const nextNormalized = normalizeSearchKeyword(template.templateName);
    const nextSearchText = buildPinyinSearchText([
      template.templateName,
      template.remark,
      ...steps.flatMap((step) => [step.processName, step.processRemark])
    ]);
    if (template.templateNameNormalized === nextNormalized && template.searchText === nextSearchText) {
      continue;
    }

    repairs.push({
      kind: 'template',
      id: template.id,
      name: template.templateName,
      previousNormalized: template.templateNameNormalized,
      nextNormalized,
      previousSearchText: template.searchText,
      nextSearchText
    });
  }

  return repairs;
}

function printProcessSearchRepairs(repairs: ProcessSearchRepair[]) {
  console.log(`第一阶段历史数据修复检查：流程搜索字段 ${repairs.length} 条需要处理。`);
  for (const repair of repairs) {
    const label = repair.kind === 'definition' ? '标准工序' : '流程记忆';
    const normalizedChange =
      repair.previousNormalized === repair.nextNormalized
        ? 'normalized 不变'
        : `normalized ${repair.previousNormalized || '空'} -> ${repair.nextNormalized || '空'}`;
    const searchTextChange =
      repair.previousSearchText === repair.nextSearchText
        ? 'searchText 不变'
        : `searchText ${repair.previousSearchText ? '将按当前拼音规则重建' : '空 -> 当前拼音规则'}`;
    console.log(`[${writeMode ? 'write' : 'dry-run'}] ${label} ${repair.name}: ${normalizedChange}，${searchTextChange}`);
  }
}

async function collectMissingProcessDefinitionRepairs(): Promise<MissingProcessDefinitionRepair[]> {
  const [definitions, templates, orderSteps] = await Promise.all([
    prisma.processDefinition.findMany({
      select: {
        id: true,
        processName: true,
        processNameNormalized: true,
        status: true
      }
    }),
    prisma.processTemplate.findMany({
      select: {
        templateName: true,
        steps: true
      },
      orderBy: { templateName: 'asc' }
    }),
    prisma.orderLineProcessStep.findMany({
      select: {
        processName: true,
        orderLine: {
          select: {
            lineNo: true,
            partCode: true,
            order: { select: { orderNo: true } }
          }
        }
      },
      orderBy: [{ processName: 'asc' }]
    })
  ]);

  const existingByNormalized = new Map(definitions.map((definition) => [definition.processNameNormalized, definition]));
  const referencedByNormalized = new Map<string, { processName: string; sources: string[] }>();

  const addReference = (rawProcessName: string | null | undefined, source: string) => {
    const processName = String(rawProcessName || '').trim();
    if (!processName) {
      return;
    }
    const processNameNormalized = normalizeSearchKeyword(processName);
    if (!processNameNormalized) {
      return;
    }
    const row = referencedByNormalized.get(processNameNormalized) || { processName, sources: [] };
    if (!row.sources.includes(source) && row.sources.length < 5) {
      row.sources.push(source);
    }
    referencedByNormalized.set(processNameNormalized, row);
  };

  for (const template of templates) {
    for (const step of processSnapshotToDetails(template.steps)) {
      addReference(step.processName, `流程记忆 ${template.templateName}`);
    }
  }

  for (const step of orderSteps) {
    addReference(
      step.processName,
      `${step.orderLine.order.orderNo} / ${step.orderLine.partCode} / line ${step.orderLine.lineNo}`
    );
  }

  const repairs: MissingProcessDefinitionRepair[] = [];
  for (const [processNameNormalized, reference] of referencedByNormalized.entries()) {
    const existing = existingByNormalized.get(processNameNormalized);
    if (!existing) {
      repairs.push({
        action: 'create',
        processName: reference.processName,
        processNameNormalized,
        sources: reference.sources
      });
      continue;
    }

    if (existing.status !== CommonStatus.ENABLED) {
      repairs.push({
        action: 'enable',
        id: existing.id,
        processName: existing.processName,
        processNameNormalized,
        previousStatus: existing.status,
        sources: reference.sources
      });
    }
  }

  return repairs.sort((left, right) => left.processName.localeCompare(right.processName, 'zh-Hans-CN'));
}

function printMissingProcessDefinitionRepairs(repairs: MissingProcessDefinitionRepair[]) {
  console.log(`第一阶段历史数据修复检查：标准工序补录 ${repairs.length} 条需要处理。`);
  for (const repair of repairs) {
    const sourceLabel = repair.sources.length ? repair.sources.join('；') : '未知引用来源';
    const actionLabel = repair.action === 'create' ? '新增标准工序' : `恢复启用 ${repair.previousStatus}`;
    console.log(`[${writeMode ? 'write' : 'dry-run'}] ${actionLabel} ${repair.processName}: ${sourceLabel}`);
  }
}

async function collectProductionOperatorRepairs(): Promise<ProductionOperatorRepair[]> {
  const operators = await prisma.productionOperator.findMany({
    orderBy: { accountId: 'asc' }
  });
  const existingByAccount = new Map(operators.map((operator) => [operator.accountId.trim().toLowerCase(), operator]));
  const repairs: ProductionOperatorRepair[] = [];

  for (const required of requiredProductionOperators) {
    const existing = existingByAccount.get(required.accountId.toLowerCase());
    if (!existing) {
      repairs.push({
        action: 'create',
        accountId: required.accountId,
        previousLabel: '缺失',
        next: required
      });
      continue;
    }

    const nextData = toProductionOperatorWriteData(required);
    const fieldsDiffer =
      existing.accountId !== nextData.accountId ||
      existing.name !== nextData.name ||
      existing.role !== nextData.role ||
      (existing.pinyin || '') !== nextData.pinyin ||
      (existing.pinyinInitials || '') !== nextData.pinyinInitials ||
      JSON.stringify(existing.keywords || []) !== JSON.stringify(nextData.keywords) ||
      (existing.idCardMasked || null) !== nextData.idCardMasked ||
      Boolean(existing.idCardBound) !== nextData.idCardBound ||
      existing.status !== nextData.status;

    if (!fieldsDiffer) {
      continue;
    }

    repairs.push({
      action: 'update',
      id: existing.id,
      accountId: required.accountId,
      previousLabel: `${existing.accountId} / ${existing.name} / ${existing.role} / ${existing.status}`,
      next: required
    });
  }

  return repairs;
}

function toProductionOperatorWriteData(operator: RequiredProductionOperator) {
  return {
    accountId: operator.accountId,
    name: operator.name,
    role: operator.role,
    pinyin: operator.pinyin,
    pinyinInitials: operator.pinyinInitials,
    keywords: operator.keywords,
    idCardMasked: operator.idCardMasked || null,
    idCardBound: Boolean(operator.idCardBound),
    status: CommonStatus.ENABLED
  };
}

function printProductionOperatorRepairs(repairs: ProductionOperatorRepair[]) {
  console.log(`第一阶段历史数据修复检查：生产操作人员 ${repairs.length} 条需要处理。`);
  for (const repair of repairs) {
    console.log(
      `[${writeMode ? 'write' : 'dry-run'}] ${repair.action === 'create' ? '新增' : '同步'} ${repair.accountId}: ` +
        `${repair.previousLabel} -> ${repair.next.name} / ${repair.next.role} / ENABLED`
    );
  }
}

async function collectConsumedReservationRepairs(): Promise<ConsumedReservationRepair[]> {
  const lines = await prisma.orderLine.findMany({
    where: {
      order: { status: { notIn: [OrderStatus.DRAFT, OrderStatus.CANCELLED] } },
      fulfillmentMode: { in: [OrderLineFulfillmentMode.STOCK, OrderLineFulfillmentMode.REWORK] }
    },
    include: {
      order: { select: { id: true, orderNo: true } },
      inventoryReservations: {
        where: { status: InventoryReservationStatus.CONSUMED }
      }
    },
    orderBy: [{ orderId: 'asc' }, { lineNo: 'asc' }]
  });

  const selectedBatchIds = [
    ...new Set(lines.flatMap((line) => normalizeStockSourceSelections(line.stockSourceSelections).map((source) => source.batchId)))
  ];
  const lineIds = lines.map((line) => line.id);
  const transactions = lineIds.length
    ? await prisma.inventoryTransaction.findMany({
        where: {
          sourceRecordId: { in: lineIds },
          sourceRecordType: { in: ['OrderLineSTOCK', 'OrderLineREWORK'] }
        },
        select: {
          batchId: true,
          sourceRecordId: true,
          sourceRecordType: true,
          transactionType: true,
          quantity: true
        }
      })
    : [];
  const transactionRowsByLine = new Map<string, typeof transactions>();
  for (const transaction of transactions) {
    const rows = transactionRowsByLine.get(transaction.sourceRecordId || '') || [];
    rows.push(transaction);
    transactionRowsByLine.set(transaction.sourceRecordId || '', rows);
  }
  const consumedReservationBatchIds = lines.flatMap((line) => line.inventoryReservations.map((reservation) => reservation.batchId));
  const transactionBatchIds = transactions.map((transaction) => transaction.batchId).filter(Boolean) as string[];
  const batchIds = [...new Set([...selectedBatchIds, ...consumedReservationBatchIds, ...transactionBatchIds])];
  const batches = batchIds.length
    ? await prisma.inventoryBatch.findMany({
        where: { id: { in: batchIds } },
        select: { id: true, batchNo: true }
      })
    : [];
  const batchNoById = new Map(batches.map((batch) => [batch.id, batch.batchNo]));
  const repairs: ConsumedReservationRepair[] = [];

  for (const line of lines) {
    const expected = new Map<string, { batchId: string; quantity: number }>();
    for (const source of normalizeStockSourceSelections(line.stockSourceSelections)) {
      const row = expected.get(source.batchId) || { batchId: source.batchId, quantity: 0 };
      row.quantity = roundQuantity(row.quantity + source.quantity);
      expected.set(source.batchId, row);
    }

    const actualQuantityByBatchId = new Map<string, number>();
    for (const reservation of line.inventoryReservations) {
      actualQuantityByBatchId.set(
        reservation.batchId,
        roundQuantity((actualQuantityByBatchId.get(reservation.batchId) || 0) + decimalToNumber(reservation.quantity))
      );
    }

    const outQuantityByBatchId = new Map<string, number>();
    for (const transaction of transactionRowsByLine.get(line.id) || []) {
      if (transaction.transactionType !== 'OUT' || transaction.sourceRecordType !== `OrderLine${line.fulfillmentMode}` || !transaction.batchId) {
        continue;
      }
      outQuantityByBatchId.set(
        transaction.batchId,
        roundQuantity((outQuantityByBatchId.get(transaction.batchId) || 0) + decimalToNumber(transaction.quantity))
      );
    }

    const blockedReasons: string[] = [];
    for (const expectedRow of expected.values()) {
      const batchNo = batchNoById.get(expectedRow.batchId) || expectedRow.batchId;
      const outQuantity = outQuantityByBatchId.get(expectedRow.batchId) || 0;
      if (quantityDiffers(outQuantity, expectedRow.quantity)) {
        blockedReasons.push(`批次 ${batchNo} selectedStockSources=${expectedRow.quantity}，OUT 流水=${outQuantity}`);
      }
      const actualQuantity = actualQuantityByBatchId.get(expectedRow.batchId) || 0;
      if (actualQuantity > expectedRow.quantity + quantityTolerance) {
        blockedReasons.push(`批次 ${batchNo} selectedStockSources=${expectedRow.quantity}，CONSUMED 预占=${actualQuantity}`);
      }
    }
    for (const [batchId, actualQuantity] of actualQuantityByBatchId) {
      if (!expected.has(batchId)) {
        blockedReasons.push(`批次 ${batchNoById.get(batchId) || batchId} 不在 selectedStockSources 中，但存在 CONSUMED 预占 ${actualQuantity}`);
      }
    }
    for (const [batchId, outQuantity] of outQuantityByBatchId) {
      if (!expected.has(batchId)) {
        blockedReasons.push(`批次 ${batchNoById.get(batchId) || batchId} 不在 selectedStockSources 中，但存在 OUT 流水 ${outQuantity}`);
      }
    }
    if (blockedReasons.length > 0) {
      repairs.push({
        orderId: line.order.id,
        orderNo: line.order.orderNo,
        orderLineId: line.id,
        lineNo: line.lineNo,
        partCode: line.partCode,
        partName: line.partName,
        batchId: expected.values().next().value?.batchId || line.inventoryReservations[0]?.batchId || '',
        batchNo:
          batchNoById.get(expected.values().next().value?.batchId || line.inventoryReservations[0]?.batchId || '') ||
          expected.values().next().value?.batchId ||
          line.inventoryReservations[0]?.batchId ||
          '-',
        quantity: 0,
        unit: line.unit,
        blockedReasons
      });
      continue;
    }

    for (const expectedRow of expected.values()) {
      const batchNo = batchNoById.get(expectedRow.batchId);
      const actualQuantity = actualQuantityByBatchId.get(expectedRow.batchId) || 0;
      const missingQuantity = roundQuantity(expectedRow.quantity - actualQuantity);
      if (!batchNo || missingQuantity <= quantityTolerance) {
        continue;
      }
      repairs.push({
        orderId: line.order.id,
        orderNo: line.order.orderNo,
        orderLineId: line.id,
        lineNo: line.lineNo,
        partCode: line.partCode,
        partName: line.partName,
        batchId: expectedRow.batchId,
        batchNo,
        quantity: missingQuantity,
        unit: line.unit,
        blockedReasons: []
      });
    }
  }

  return repairs;
}

function printConsumedReservationRepairs(repairs: ConsumedReservationRepair[]) {
  console.log(`第一阶段历史数据修复检查：库存消费预占记录 ${repairs.length} 条需要处理。`);
  for (const repair of repairs) {
    if (repair.blockedReasons.length > 0) {
      console.log(
        `[blocked] ${repair.orderNo} / line ${repair.lineNo} / ${repair.partCode}: ` +
          `${repair.blockedReasons.join('；')}`
      );
      continue;
    }
    console.log(
      `[${writeMode ? 'write' : 'dry-run'}] ${repair.orderNo} / line ${repair.lineNo} / ${repair.partCode}: ` +
        `补录批次 ${repair.batchNo} CONSUMED ${repair.quantity}${repair.unit}`
    );
  }
}

async function collectStockAllocationRepairs(): Promise<StockAllocationRepair[]> {
  const lines = await prisma.orderLine.findMany({
    where: {
      order: { status: { notIn: [OrderStatus.DRAFT, OrderStatus.CANCELLED] } },
      fulfillmentMode: OrderLineFulfillmentMode.STOCK
    },
    include: {
      order: { select: { id: true, orderNo: true } },
      inventoryBatches: {
        select: {
          id: true,
          batchNo: true,
          sourceOrderId: true,
          sourceOrderLineId: true
        }
      }
    },
    orderBy: [{ orderId: 'asc' }, { lineNo: 'asc' }]
  });
  const lineIds = lines.map((line) => line.id);
  const transactions = lineIds.length
    ? await prisma.inventoryTransaction.findMany({
        where: {
          sourceRecordId: { in: lineIds },
          sourceRecordType: { in: ['OrderLineSTOCK', 'OrderLineStockAllocation'] }
        },
        select: {
          sourceRecordId: true,
          sourceRecordType: true,
          transactionType: true,
          quantity: true
        }
      })
    : [];
  const transactionRowsByLine = new Map<string, typeof transactions>();
  for (const transaction of transactions) {
    const rows = transactionRowsByLine.get(transaction.sourceRecordId || '') || [];
    rows.push(transaction);
    transactionRowsByLine.set(transaction.sourceRecordId || '', rows);
  }

  const repairs: StockAllocationRepair[] = [];
  for (const line of lines) {
    const selectedQuantity = selectedStockSourceQuantity(line.stockSourceSelections);
    if (selectedQuantity <= quantityTolerance) {
      continue;
    }

    const lineTransactions = transactionRowsByLine.get(line.id) || [];
    const stockOutQuantity = roundQuantity(
      lineTransactions
        .filter((transaction) => transaction.transactionType === 'OUT' && transaction.sourceRecordType === 'OrderLineSTOCK')
        .reduce((sum, transaction) => sum + decimalToNumber(transaction.quantity), 0)
    );
    const allocationInQuantity = roundQuantity(
      lineTransactions
        .filter((transaction) => transaction.transactionType === 'IN' && transaction.sourceRecordType === 'OrderLineStockAllocation')
        .reduce((sum, transaction) => sum + decimalToNumber(transaction.quantity), 0)
    );
    const orderBatchCount = line.inventoryBatches.filter(
      (batch) => batch.sourceOrderId === line.order.id && batch.sourceOrderLineId === line.id
    ).length;
    const blockedReasons: string[] = [];

    if (quantityDiffers(stockOutQuantity, selectedQuantity)) {
      blockedReasons.push(`selectedStockSources=${selectedQuantity}，备货库存 OUT 流水=${stockOutQuantity}`);
    }
    if (quantityDiffers(allocationInQuantity, selectedQuantity)) {
      blockedReasons.push(`selectedStockSources=${selectedQuantity}，订单待发货 IN 流水=${allocationInQuantity}`);
    }
    if (orderBatchCount === 0) {
      blockedReasons.push('没有绑定该订单零件的待发货库存批次');
    }

    if (blockedReasons.length === 0) {
      continue;
    }

    repairs.push({
      orderNo: line.order.orderNo,
      lineNo: line.lineNo,
      partCode: line.partCode,
      selectedQuantity,
      stockOutQuantity,
      allocationInQuantity,
      orderBatchCount,
      blockedReasons
    });
  }

  return repairs;
}

function printStockAllocationRepairs(repairs: StockAllocationRepair[]) {
  console.log(`第一阶段历史数据修复检查：使用库存转订单待发货 ${repairs.length} 条需要人工处理。`);
  for (const repair of repairs) {
    console.log(
      `[blocked] ${repair.orderNo} / line ${repair.lineNo} / ${repair.partCode}: ` +
        `选用库存=${repair.selectedQuantity}, OUT=${repair.stockOutQuantity}, IN=${repair.allocationInQuantity}, ` +
        `订单库存批次=${repair.orderBatchCount}；${repair.blockedReasons.join('；')}`
    );
  }
}

function normalizeStockSourceSelections(value: Prisma.JsonValue | null | undefined): StockSourceSelection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows = new Map<string, StockSourceSelection>();
  for (const item of value) {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const batchId = String(row.batchId || '').trim();
    const quantity = roundQuantity(Number(row.quantity || 0));
    if (!batchId || quantity <= 0) {
      continue;
    }
    const current = rows.get(batchId);
    rows.set(batchId, {
      batchId,
      batchNo: stringValue(row.batchNo) || current?.batchNo,
      quantity: roundQuantity((current?.quantity || 0) + quantity),
      compatibilityStatus: stringValue(row.compatibilityStatus) || current?.compatibilityStatus,
      compatibilityReason: stringValue(row.compatibilityReason) || current?.compatibilityReason,
      manualConfirmedBy: stringValue(row.manualConfirmedBy) || current?.manualConfirmedBy,
      manualConfirmedAt: stringValue(row.manualConfirmedAt) || current?.manualConfirmedAt,
      manualConfirmRemark: stringValue(row.manualConfirmRemark) || current?.manualConfirmRemark
    });
  }
  return [...rows.values()];
}

function selectedStockSourceQuantity(stockSourceSelections: Prisma.JsonValue | null | undefined) {
  return normalizeStockSourceSelections(stockSourceSelections).reduce((sum, source) => sum + source.quantity, 0);
}

function sourceKey(orderLineId: string | null | undefined, batchId: string) {
  return `${orderLineId || 'NO_LINE'}__${batchId}`;
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value.toString());
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function quantityDiffers(left: number, right: number) {
  return Math.abs(left - right) > quantityTolerance;
}

async function runMain() {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void runMain();
