import {
  CommonStatus,
  CustomerRegionType,
  InventoryReservationStatus,
  OrderLineFulfillmentMode,
  OrderStatus,
  Prisma,
  PrismaClient,
  ProductionNoticeStatus,
  ProductionStatus
} from '@prisma/client';
import * as dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { buildPinyinSearchText, normalizeSearchKeyword } from '../../backend/src/common/pinyin-search';

type IssueLevel = 'ERROR' | 'WARN';

type VerifyIssue = {
  level: IssueLevel;
  code: string;
  message: string;
};

type StockSourceSelection = {
  batchId: string;
  batchNo?: string;
  quantity: number;
  unit?: string;
  compatibilityStatus?: string;
  manualConfirmedBy?: string;
  manualConfirmedAt?: string;
  manualConfirmRemark?: string;
};

const volatileStockSourceFields = ['availableQuantity', 'reservedQuantity', 'currentQuantity', 'physicalQuantity'];

type ProcessStepSnapshot = {
  processName: string;
  processRemark?: string;
};

type NoticeOrderRow = { id: string; orderNo: string; customerName: string; status?: OrderStatus };
type NoticeLineRow = { id: string; orderId: string; partCode: string; partName: string; unit: string };
type NoticeTaskRow = {
  id: string;
  productionTaskNo: string;
  orderId: string;
  orderLineId: string;
  orderNo: string;
  partCode: string;
  partName: string;
  unit: string;
  plannedQuantity?: Prisma.Decimal;
  status?: ProductionStatus;
  inventoryBatch?: { id: string } | null;
  isReplenishment?: boolean;
  sourceProductionTaskNo?: string | null;
  replenishmentSourceType?: string | null;
  replenishmentSourceRequestNo?: string | null;
};

type OrderQuantityByUnitRow = {
  unit: string;
  totalQuantity: number;
  totalProductionPlanQuantity: number;
};

type ProductionOperatorSearchRow = {
  accountId: string;
  name: string;
  role: string;
  pinyin?: string | null;
  pinyinInitials?: string | null;
  keywords?: string[] | null;
};

const quantityTolerance = 0.0001;
const stockCompatibilityStatuses = new Set(['MATCHED', 'NEEDS_CONFIRMATION', 'INCOMPLETE', 'UNKNOWN']);
const processCompletionLogActions = new Set([
  'CREATE',
  'UPDATE',
  'BATCH_CREATE',
  'BATCH_UPDATE',
  'TASK_FINAL_CONFIRM',
  'TASK_FINAL_UPDATE',
  'TASK_WITHDRAWN',
  'APPROVE_REPLENISHMENT_REQUEST',
  'REJECT_REPLENISHMENT_REQUEST'
]);
const historyBackfillOperatorCode = 'HISTORY-BACKFILL';

loadRootEnv();

const prisma = new PrismaClient();
const issues: VerifyIssue[] = [];

async function main() {
  await checkMasterDataUniqueness();
  await checkProcessMemoryData();
  await checkModelBomData();
  await checkMaterialMasterData();
  await checkMaterialCommonProjectModels();
  await checkMaterialDrawingRevisions();
  await checkFirstStageVerificationFixtures();
  await checkMaterialStockAlerts();
  await checkMaterialImportData();
  await checkMaterialTransformRuleData();
  await checkProductionOperators();
  await checkCustomerContacts();
  await checkOrderNoReservations();
  await checkOrderLineComponentStructure();
  await checkOrderImportData();
  await checkCommittedOrderImportRowComponentStructure();
  await checkOrderLinePlans();
  await checkOrderLineProcessSteps();
  await checkProductionTaskConsistency();
  await checkInventoryReservations();
  await checkInventoryTransactionBalances();
  await checkInventoryTransactionOrderLineLinks();
  await checkInventoryBatchSources();
  await checkStockSourceConsumptionTransactions();
  await checkProductionNotices();
  await checkProductionReplenishmentRequests();
  await checkProductionShortageResolutions();
  await checkProductionScrapRecords();
  await checkOrderStatisticsStatuses();
  await checkInventoryAdjustments();

  printSummary();

  process.exitCode = issues.some((issue) => issue.level === 'ERROR') ? 1 : 0;
}

async function checkModelBomData() {
  const boms = await prisma.modelBom.findMany({
    include: {
      customerScopes: {
        select: {
          id: true,
          bomId: true,
          customerId: true,
          customerNameSnapshot: true,
          status: true
        },
        orderBy: [{ status: 'asc' }, { customerNameSnapshot: 'asc' }]
      },
      lines: {
        include: {
          material: {
            select: { id: true, status: true }
          },
          defaultDrawingRevision: {
            select: { id: true, materialId: true, status: true, drawingNo: true, drawingVersion: true }
          }
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
      }
    },
    orderBy: { bomName: 'asc' }
  });

  const bomsByScope = new Map<string, (typeof boms)[number]>();

  for (const bom of boms) {
    const actualCustomerScopeKey = stringValue(bom.customerScopeKey) || 'ALL';
    const actualProjectModelScopeKey = stringValue(bom.projectModelScopeKey) || 'ALL';
    const expectedCustomerScopeKey =
      bom.customerScopeMode === 'SELECTED'
        ? actualCustomerScopeKey
        : bom.customerId || 'ALL';
    const expectedProjectModelScopeKey = stringValue(bom.projectModel).toLocaleUpperCase() || 'ALL';

    // BOM 范围决定下单推荐边界，必须明确区分全部客户、客户私有和指定客户可用，不能依赖备注或模糊字段。
    const missingBomIdentityFields = [
      ['bomName', bom.bomName],
      ['customerScopeMode', bom.customerScopeMode],
      ['customerScopeKey', bom.customerScopeKey],
      ['projectModelScopeKey', bom.projectModelScopeKey]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingBomIdentityFields.length > 0) {
      addIssue('ERROR', 'MODEL_BOM_IDENTITY_MISSING', `BOM ${bom.id} 缺少身份或适用范围字段：${missingBomIdentityFields.map(([field]) => field).join(', ')}`);
    }
    if (!['ALL', 'PRIVATE', 'SELECTED'].includes(bom.customerScopeMode)) {
      addIssue('ERROR', 'MODEL_BOM_SCOPE_MODE_INVALID', `BOM ${bom.bomName} customerScopeMode=${bom.customerScopeMode} 不在允许范围内`);
    }
    if (bom.customerScopeMode === 'ALL' && (bom.customerId || actualCustomerScopeKey !== 'ALL' || bom.customerNameSnapshot !== null)) {
      addIssue('ERROR', 'MODEL_BOM_ALL_CUSTOMER_SCOPE_MISMATCH', `BOM ${bom.bomName} 全部客户范围必须 customerId 为空、customerScopeKey=ALL 且不保存 customerNameSnapshot`);
    }
    if (bom.customerScopeMode === 'PRIVATE' && (!bom.customerId || actualCustomerScopeKey !== bom.customerId || !stringValue(bom.customerNameSnapshot))) {
      addIssue('ERROR', 'MODEL_BOM_PRIVATE_CUSTOMER_SCOPE_MISMATCH', `BOM ${bom.bomName} 客户私有范围必须绑定 customerId、customerScopeKey 和 customerNameSnapshot`);
    }
    if (bom.customerScopeMode === 'SELECTED') {
      if (bom.customerId || !actualCustomerScopeKey.startsWith('SELECTED:') || bom.customerNameSnapshot !== null) {
        addIssue('ERROR', 'MODEL_BOM_SELECTED_CUSTOMER_SCOPE_MISMATCH', `BOM ${bom.bomName} 指定客户范围必须 customerId 为空、customerScopeKey 以 SELECTED: 开头且不保存 customerNameSnapshot`);
      }
      const enabledCustomerScopes = bom.customerScopes.filter((scope) => scope.status === CommonStatus.ENABLED);
      if (enabledCustomerScopes.length === 0) {
        addIssue('ERROR', 'MODEL_BOM_SELECTED_CUSTOMER_SCOPE_MISSING', `BOM ${bom.bomName} 指定客户范围缺少启用的 ModelBomCustomerScope`);
      }
    }
    if (bom.isCommon && (!bom.commonSortOrder || bom.commonSortOrder <= 0)) {
      addIssue('ERROR', 'MODEL_BOM_COMMON_SORT_INVALID', `BOM ${bom.bomName} 标记为常用 BOM 时 commonSortOrder 必须大于 0`);
    }
    if (!bom.isCommon && bom.commonSortOrder !== null) {
      addIssue('ERROR', 'MODEL_BOM_COMMON_SORT_INVALID', `BOM ${bom.bomName} 非常用 BOM 不能保存 commonSortOrder`);
    }
    const blankBomOptionalFields = [
      ['customerNameSnapshot', bom.customerNameSnapshot],
      ['sourceBomNameSnapshot', bom.sourceBomNameSnapshot],
      ['remark', bom.remark]
    ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
    if (blankBomOptionalFields.length > 0) {
      addIssue('ERROR', 'MODEL_BOM_OPTIONAL_TEXT_BLANK', `BOM ${bom.bomName} 可选文本不能保存空字符串：${blankBomOptionalFields.map(([field]) => field).join(', ')}`);
    }
    for (const scope of bom.customerScopes) {
      const missingScopeFields = [
        ['bomId', scope.bomId],
        ['customerId', scope.customerId],
        ['customerNameSnapshot', scope.customerNameSnapshot]
      ].filter(([, value]) => !String(value || '').trim());
      if (missingScopeFields.length > 0) {
        addIssue('ERROR', 'MODEL_BOM_CUSTOMER_SCOPE_ROW_IDENTITY_MISSING', `BOM ${bom.bomName} / customerScope ${scope.id} 缺少字段：${missingScopeFields.map(([field]) => field).join(', ')}`);
      }
    }

    if (actualCustomerScopeKey !== expectedCustomerScopeKey) {
      addIssue(
        'ERROR',
        'MODEL_BOM_CUSTOMER_SCOPE_KEY_MISMATCH',
        `BOM ${bom.bomName} customerScopeKey=${actualCustomerScopeKey} 与 customerId=${expectedCustomerScopeKey} 不一致`
      );
    }
    if (actualProjectModelScopeKey !== expectedProjectModelScopeKey) {
      addIssue(
        'ERROR',
        'MODEL_BOM_PROJECT_SCOPE_KEY_MISMATCH',
        `BOM ${bom.bomName} projectModelScopeKey=${actualProjectModelScopeKey} 与 projectModel=${expectedProjectModelScopeKey} 不一致`
      );
    }

    // BOM 范围必须唯一，避免同一客户 / 机型出现多套可变清单互相覆盖。
    const bomScopeKey = `${actualCustomerScopeKey}|${actualProjectModelScopeKey.toLocaleUpperCase()}`;
    const existingScopeBom = bomsByScope.get(bomScopeKey);
    if (existingScopeBom) {
      addIssue(
        'ERROR',
        'MODEL_BOM_SCOPE_DUPLICATE',
        `BOM ${existingScopeBom.bomName} 和 ${bom.bomName} 使用相同客户 / 机型范围 ${bomScopeKey}，请合并后保留一套独立清单`
      );
    } else {
      bomsByScope.set(bomScopeKey, bom);
    }

    const enabledComponentsByNo = new Map<string, (typeof bom.lines)[number]>();
    const seenEnabledComponentNos = new Set<string>();

    for (const line of bom.lines) {
      const componentNo = stringValue(line.componentNo);
      if (line.lineType !== 'COMPONENT' || line.status !== CommonStatus.ENABLED || !componentNo) {
        continue;
      }
      const key = componentNo.toLocaleUpperCase();
      if (seenEnabledComponentNos.has(key)) {
        addIssue('ERROR', 'MODEL_BOM_COMPONENT_NO_DUPLICATE', `BOM ${bom.bomName} 存在重复启用组件编号 ${componentNo}`);
      }
      seenEnabledComponentNos.add(key);
      enabledComponentsByNo.set(key, line);
    }

    for (const line of bom.lines) {
      const label = `BOM ${bom.bomName} / ${line.partCodeSnapshot}`;
      const componentNo = stringValue(line.componentNo);
      const parentComponentNo = stringValue(line.parentComponentNo);

      // BOM 行是订单带入 DRAFT 明细的来源，默认数量、结构和快照字段必须可追溯。
      const missingLineIdentityFields = [
        ['bomId', line.bomId],
        ['materialId', line.materialId],
        ['partCodeSnapshot', line.partCodeSnapshot],
        ['partNameSnapshot', line.partNameSnapshot],
        ['unitSnapshot', line.unitSnapshot],
        ['lineType', line.lineType]
      ].filter(([, value]) => !String(value || '').trim());
      if (missingLineIdentityFields.length > 0) {
        addIssue('ERROR', 'MODEL_BOM_LINE_IDENTITY_MISSING', `${label} 缺少 BOM 行身份字段：${missingLineIdentityFields.map(([field]) => field).join(', ')}`);
      }
      if (!['PART', 'COMPONENT'].includes(line.lineType)) {
        addIssue('ERROR', 'MODEL_BOM_LINE_TYPE_INVALID', `${label} lineType=${line.lineType} 不在允许范围内`);
      }
      if (decimalToNumber(line.defaultQuantity) <= 0) {
        addIssue('ERROR', 'MODEL_BOM_LINE_DEFAULT_QUANTITY_INVALID', `${label} defaultQuantity 必须大于 0`);
      }
      if (line.partThicknessSnapshot !== null && decimalToNumber(line.partThicknessSnapshot) < 0) {
        addIssue('ERROR', 'MODEL_BOM_LINE_THICKNESS_INVALID', `${label} partThicknessSnapshot 不能小于 0`);
      }
      const blankLineOptionalFields = [
        ['partSpecificationSnapshot', line.partSpecificationSnapshot],
        ['partCategory', line.partCategory],
        ['componentNo', line.componentNo],
        ['parentComponentNo', line.parentComponentNo],
        ['defaultProcessRoute', line.defaultProcessRoute],
        ['remark', line.remark]
      ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
      if (blankLineOptionalFields.length > 0) {
        addIssue('ERROR', 'MODEL_BOM_LINE_OPTIONAL_TEXT_BLANK', `${label} 可选文本不能保存空字符串：${blankLineOptionalFields.map(([field]) => field).join(', ')}`);
      }

      if (line.status === CommonStatus.ENABLED && line.material.status !== CommonStatus.ENABLED) {
        addIssue(
          'ERROR',
          'MODEL_BOM_LINE_DISABLED_MATERIAL_ENABLED',
          `${label} 引用了停用零件但 BOM 行仍启用，请先启用零件或停用该 BOM 行`
        );
      }

      if (line.status === CommonStatus.ENABLED && line.defaultDrawingRevisionId) {
        const revision = line.defaultDrawingRevision;
        if (!revision || revision.status !== CommonStatus.ENABLED) {
          addIssue(
            'ERROR',
            'MODEL_BOM_DEFAULT_DRAWING_DISABLED',
            `${label} 默认图纸 ${line.defaultDrawingRevisionId} 不存在或已停用，请先调整 BOM 行默认图纸`
          );
        } else if (revision.materialId !== line.materialId) {
          addIssue(
            'ERROR',
            'MODEL_BOM_DEFAULT_DRAWING_MATERIAL_MISMATCH',
            `${label} 默认图纸 ${revision.drawingNo} / ${revision.drawingVersion} 不属于当前零件`
          );
        }
      }

      if (line.lineType === 'COMPONENT') {
        if (!componentNo) {
          addIssue('ERROR', 'MODEL_BOM_COMPONENT_NO_MISSING', `${label} 是组件行但缺少 componentNo`);
        }
        if (line.partThicknessSnapshot !== null) {
          addIssue(
            'ERROR',
            'MODEL_BOM_COMPONENT_THICKNESS_SNAPSHOT_NOT_ALLOWED',
            `${label} 是父级组件，不能保存 partThicknessSnapshot=${decimalToNumber(line.partThicknessSnapshot)}；厚度只核对子零件和单独零件`
          );
        }
        if (componentNo && isComponentNoRangeInvalid(componentNo)) {
          addIssue('ERROR', 'MODEL_BOM_COMPONENT_NO_RANGE_INVALID', `${label} 组件编号 ${componentNo} 超出 C001-C9999 范围`);
        }
        if (parentComponentNo) {
          addIssue('ERROR', 'MODEL_BOM_COMPONENT_HAS_PARENT', `${label} 是组件行但填写了 parentComponentNo=${parentComponentNo}`);
        }
        continue;
      }

      if (componentNo) {
        addIssue('ERROR', 'MODEL_BOM_PART_COMPONENT_NO_NOT_ALLOWED', `${label} 是零件行，不能填写 componentNo=${componentNo}`);
      }
      if (line.status !== CommonStatus.ENABLED || !parentComponentNo) {
        continue;
      }
      const parent = enabledComponentsByNo.get(parentComponentNo.toLocaleUpperCase());
      if (!parent) {
        addIssue(
          'ERROR',
          'MODEL_BOM_CHILD_PARENT_DISABLED_OR_MISSING',
          `${label} 启用子零件所属组件 ${parentComponentNo} 不存在或已停用`
        );
      }
    }
  }

  const diffReviews = await prisma.modelBomDiffReview.findMany({
    include: {
      targetBom: { select: { id: true, bomName: true, sourceBomId: true } },
      sourceBom: { select: { id: true, bomName: true } },
      sourceLine: { select: { id: true, bomId: true, partCodeSnapshot: true } },
      targetLine: { select: { id: true, bomId: true, partCodeSnapshot: true } }
    }
  });

  for (const review of diffReviews) {
    const label = `BOM 差异核对 ${review.issueTitle || review.reviewKey}`;
    const allowedIssueKinds = new Set(['MISSING_IN_CUSTOMER', 'CHANGED', 'CUSTOMER_EXTRA']);
    const requiredReviewFields = [
      ['targetBomId', review.targetBomId],
      ['sourceBomId', review.sourceBomId],
      ['reviewKey', review.reviewKey],
      ['issueKind', review.issueKind],
      ['issueTitle', review.issueTitle],
      ['diffFingerprint', review.diffFingerprint],
      ['reviewedBy', review.reviewedBy]
    ].filter(([, value]) => !String(value || '').trim());
    if (requiredReviewFields.length > 0) {
      addIssue('ERROR', 'MODEL_BOM_DIFF_REVIEW_IDENTITY_MISSING', `${label} 缺少核对记录字段：${requiredReviewFields.map(([field]) => field).join(', ')}`);
    }
    const blankReviewOptionalFields = [
      ['sourceLineId', review.sourceLineId],
      ['targetLineId', review.targetLineId],
      ['issueDetail', review.issueDetail],
      ['reviewRemark', review.reviewRemark]
    ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
    if (blankReviewOptionalFields.length > 0) {
      addIssue('ERROR', 'MODEL_BOM_DIFF_REVIEW_OPTIONAL_TEXT_BLANK', `${label} 可选文本不能保存空字符串：${blankReviewOptionalFields.map(([field]) => field).join(', ')}`);
    }
    if (review.targetBomId === review.sourceBomId) {
      addIssue('ERROR', 'MODEL_BOM_DIFF_REVIEW_SOURCE_TARGET_SAME', `${label} targetBomId 和 sourceBomId 不能相同`);
    }
    if (!allowedIssueKinds.has(review.issueKind)) {
      addIssue('ERROR', 'MODEL_BOM_DIFF_REVIEW_KIND_INVALID', `${label} issueKind=${review.issueKind} 不在允许范围内`);
    }
    if (!review.reviewKey.startsWith(`${review.targetBomId}|${review.sourceBomId}|`)) {
      addIssue('ERROR', 'MODEL_BOM_DIFF_REVIEW_KEY_SCOPE_INVALID', `${label} reviewKey 未以 targetBomId/sourceBomId 开头`);
    }
    const lineShapeInvalid =
      (review.issueKind === 'MISSING_IN_CUSTOMER' && (!review.sourceLineId || review.targetLineId)) ||
      (review.issueKind === 'CHANGED' && (!review.sourceLineId || !review.targetLineId)) ||
      (review.issueKind === 'CUSTOMER_EXTRA' && (review.sourceLineId || !review.targetLineId));
    if (lineShapeInvalid) {
      addIssue('ERROR', 'MODEL_BOM_DIFF_REVIEW_LINE_SHAPE_INVALID', `${label} 的 sourceLineId / targetLineId 与 issueKind 不匹配`);
    }
    if (review.fieldsJson !== null && !isJsonRecord(review.fieldsJson)) {
      addIssue('ERROR', 'MODEL_BOM_DIFF_REVIEW_FIELDS_JSON_INVALID', `${label} fieldsJson 必须是对象或 null`);
    }
    if (review.targetBom.sourceBomId !== review.sourceBomId) {
      addIssue(
        'ERROR',
        'MODEL_BOM_DIFF_REVIEW_SOURCE_MISMATCH',
        `${label} 的 sourceBomId=${review.sourceBomId} 与客户 BOM ${review.targetBom.bomName} 的 sourceBomId=${review.targetBom.sourceBomId || '-'} 不一致`
      );
    }
    if (review.sourceLine && review.sourceLine.bomId !== review.sourceBomId) {
      addIssue(
        'ERROR',
        'MODEL_BOM_DIFF_REVIEW_SOURCE_LINE_MISMATCH',
        `${label} 的来源行 ${review.sourceLine.partCodeSnapshot} 不属于来源 BOM ${review.sourceBom.bomName}`
      );
    }
    if (review.targetLine && review.targetLine.bomId !== review.targetBomId) {
      addIssue(
        'ERROR',
        'MODEL_BOM_DIFF_REVIEW_TARGET_LINE_MISMATCH',
        `${label} 的客户行 ${review.targetLine.partCodeSnapshot} 不属于客户 BOM ${review.targetBom.bomName}`
      );
    }
    if (!stringValue(review.diffFingerprint)) {
      addIssue('ERROR', 'MODEL_BOM_DIFF_REVIEW_FINGERPRINT_MISSING', `${label} 缺少 diffFingerprint，无法判断后续差异是否已经变化`);
    }
  }
}

async function checkMaterialMasterData() {
  const materials = await prisma.material.findMany({
    select: {
      id: true,
      partCode: true,
      partName: true,
      unit: true,
      partSpecification: true,
      status: true,
      applicabilities: {
        select: {
          id: true,
          customerId: true,
          customerNameSnapshot: true,
          projectModel: true,
          customerScopeKey: true,
          projectModelScopeKey: true,
          remark: true,
          status: true
        },
        orderBy: [{ status: 'asc' }, { customerScopeKey: 'asc' }, { projectModelScopeKey: 'asc' }]
      }
    },
    orderBy: { partCode: 'asc' }
  });

  const materialRowsByCode = new Map<string, typeof materials>();
  for (const material of materials) {
    const key = normalizeCaseInsensitiveKey(material.partCode);
    materialRowsByCode.set(key, [...(materialRowsByCode.get(key) || []), material]);

    const label = `Material ${material.partCode || material.id}`;
    // 零件基础资料只保存身份字段和推荐配置，不保存库存数量；空身份字段会破坏订单、BOM 和库存追溯。
    const missingMaterialFields = [
      ['partCode', material.partCode],
      ['partName', material.partName],
      ['unit', material.unit]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingMaterialFields.length > 0) {
      addIssue('ERROR', 'MATERIAL_IDENTITY_MISSING', `${label} 缺少零件基础字段：${missingMaterialFields.map(([field]) => field).join(', ')}`);
    }
    if (material.partSpecification !== null && !material.partSpecification.trim()) {
      addIssue('ERROR', 'MATERIAL_OPTIONAL_TEXT_BLANK', `${label} partSpecification 不能保存空字符串`);
    }

    for (const applicability of material.applicabilities) {
      const applicabilityLabel = `${label} / applicability ${applicability.id}`;
      const missingScopeFields = [
        ['customerScopeKey', applicability.customerScopeKey],
        ['projectModelScopeKey', applicability.projectModelScopeKey]
      ].filter(([, value]) => !String(value || '').trim());
      if (missingScopeFields.length > 0) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_SCOPE_KEY_MISSING', `${applicabilityLabel} 缺少适用范围 key：${missingScopeFields.map(([field]) => field).join(', ')}`);
      }
      if (applicability.customerId) {
        if (applicability.customerScopeKey !== applicability.customerId) {
          addIssue('ERROR', 'MATERIAL_APPLICABILITY_CUSTOMER_SCOPE_KEY_MISMATCH', `${applicabilityLabel} customerScopeKey 必须等于 customerId`);
        }
        if (!stringValue(applicability.customerNameSnapshot)) {
          addIssue('ERROR', 'MATERIAL_APPLICABILITY_CUSTOMER_SNAPSHOT_MISSING', `${applicabilityLabel} 指定客户适用范围缺少 customerNameSnapshot`);
        }
      } else {
        if (applicability.customerScopeKey !== 'ALL') {
          addIssue('ERROR', 'MATERIAL_APPLICABILITY_ALL_CUSTOMER_SCOPE_MISMATCH', `${applicabilityLabel} 全部客户适用范围 customerScopeKey 必须为 ALL`);
        }
        if (applicability.customerNameSnapshot !== null) {
          addIssue('ERROR', 'MATERIAL_APPLICABILITY_ALL_CUSTOMER_SNAPSHOT_STALE', `${applicabilityLabel} 全部客户适用范围不能保存 customerNameSnapshot`);
        }
      }

      const expectedProjectScopeKey = stringValue(applicability.projectModel).toLocaleUpperCase() || 'ALL';
      if (applicability.projectModelScopeKey !== expectedProjectScopeKey) {
        addIssue(
          'ERROR',
          'MATERIAL_APPLICABILITY_PROJECT_SCOPE_KEY_MISMATCH',
          `${applicabilityLabel} projectModelScopeKey=${applicability.projectModelScopeKey}，应为 ${expectedProjectScopeKey}`
        );
      }
      if (applicability.projectModel !== null && !applicability.projectModel.trim()) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_OPTIONAL_TEXT_BLANK', `${applicabilityLabel} projectModel 不能保存空字符串`);
      }
      if (applicability.remark !== null && !applicability.remark.trim()) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_OPTIONAL_TEXT_BLANK', `${applicabilityLabel} remark 不能保存空字符串`);
      }
      if (applicability.status === CommonStatus.ENABLED && material.status !== CommonStatus.ENABLED) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_ENABLED_MATERIAL_DISABLED', `${applicabilityLabel} 仍启用，但所属 Material 已停用`);
      }
    }
  }

  for (const [key, rows] of materialRowsByCode.entries()) {
    if (!key) {
      continue;
    }
    if (rows.length > 1) {
      addIssue('ERROR', 'MATERIAL_CODE_DUPLICATE', `零件编码大小写不敏感重复：${key}，记录：${rows.map((row) => row.partCode).join('，')}`);
    }
  }
}

async function checkMaterialCommonProjectModels() {
  const rows = await prisma.materialCommonProjectModel.findMany({
    orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { projectModel: 'asc' }]
  });
  const enabledSortOrders = new Map<number, string[]>();

  for (const row of rows) {
    const label = `常用机型 ${row.projectModel || row.id}`;
    const projectModel = row.projectModel.trim();
    const expectedKey = normalizeCaseInsensitiveKey(projectModel);

    // 常用机型只控制零件管理快捷入口顺序，不能依赖空 key 或重复排序导致下单前筛选误导。
    if (!projectModel) {
      addIssue('ERROR', 'MATERIAL_COMMON_PROJECT_MODEL_EMPTY', `${label} projectModel 为空`);
    }
    if (row.projectModel !== projectModel) {
      addIssue('ERROR', 'MATERIAL_COMMON_PROJECT_MODEL_HAS_SPACES', `${label} projectModel 存在首尾空格`);
    }
    if (!row.projectModelNormalized.trim()) {
      addIssue('ERROR', 'MATERIAL_COMMON_PROJECT_MODEL_KEY_EMPTY', `${label} projectModelNormalized 为空`);
    }
    if (row.projectModelNormalized !== expectedKey) {
      addIssue(
        'ERROR',
        'MATERIAL_COMMON_PROJECT_MODEL_KEY_STALE',
        `${label} 的 projectModelNormalized=${row.projectModelNormalized}，应为 ${expectedKey}`
      );
    }
    if (row.sortOrder <= 0) {
      addIssue('ERROR', 'MATERIAL_COMMON_PROJECT_MODEL_SORT_INVALID', `${label} sortOrder 必须大于 0`);
    }
    if (row.status === CommonStatus.ENABLED) {
      const sortRows = enabledSortOrders.get(row.sortOrder) || [];
      sortRows.push(row.projectModel);
      enabledSortOrders.set(row.sortOrder, sortRows);
    }
  }

  for (const [sortOrder, projectModels] of enabledSortOrders.entries()) {
    if (projectModels.length > 1) {
      addIssue(
        'ERROR',
        'MATERIAL_COMMON_PROJECT_MODEL_SORT_DUPLICATE',
        `启用常用机型 sortOrder=${sortOrder} 重复：${projectModels.join('，')}`
      );
    }
  }
}

async function checkMaterialDrawingRevisions() {
  const materials = await prisma.material.findMany({
    select: {
      id: true,
      partCode: true,
      partName: true,
      drawingRevisions: {
        select: {
          id: true,
          drawingNo: true,
          drawingVersion: true,
          drawingStatus: true,
          drawingFileName: true,
          drawingFileUrl: true,
          isDefault: true,
          defaultChangedBy: true,
          defaultChangedAt: true,
          remark: true,
          status: true
        },
        orderBy: [{ status: 'asc' }, { isDefault: 'desc' }, { drawingDate: 'desc' }, { createdAt: 'desc' }]
      }
    },
    orderBy: { partCode: 'asc' }
  });

  for (const material of materials) {
    const label = `Material ${material.partCode} / ${material.partName}`;
    const enabledDefaults = material.drawingRevisions.filter((revision) => revision.status === CommonStatus.ENABLED && revision.isDefault);
    if (enabledDefaults.length > 1) {
      addIssue(
        'ERROR',
        'MATERIAL_DRAWING_DEFAULT_DUPLICATE',
        `${label} 存在 ${enabledDefaults.length} 个启用默认图纸版本；同一个零件只能有一个启用默认图纸`
      );
    }

    const drawingIdentityRows = new Map<string, (typeof material.drawingRevisions)[number]>();
    for (const revision of material.drawingRevisions) {
      const drawingNo = stringValue(revision.drawingNo);
      const drawingVersion = stringValue(revision.drawingVersion);
      const revisionLabel = `${label} / drawing ${drawingNo || '-'} / ${drawingVersion || '-'}`;
      if (!drawingNo || !drawingVersion) {
        addIssue('ERROR', 'MATERIAL_DRAWING_REVISION_IDENTITY_MISSING', `${revisionLabel} 缺少 drawingNo 或 drawingVersion`);
      }
      if (revision.drawingNo !== drawingNo || revision.drawingVersion !== drawingVersion) {
        addIssue('ERROR', 'MATERIAL_DRAWING_REVISION_IDENTITY_HAS_SPACES', `${revisionLabel} drawingNo 或 drawingVersion 存在首尾空格`);
      }
      const blankDrawingOptionalFields = [
        ['drawingStatus', revision.drawingStatus],
        ['drawingFileName', revision.drawingFileName],
        ['drawingFileUrl', revision.drawingFileUrl],
        ['defaultChangedBy', revision.defaultChangedBy],
        ['remark', revision.remark]
      ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
      if (blankDrawingOptionalFields.length > 0) {
        addIssue(
          'ERROR',
          'MATERIAL_DRAWING_REVISION_OPTIONAL_TEXT_BLANK',
          `${revisionLabel} 可选文本不能保存空字符串：${blankDrawingOptionalFields.map(([field]) => field).join(', ')}`
        );
      }
      const untrimmedDrawingOptionalFields = [
        ['drawingStatus', revision.drawingStatus],
        ['drawingFileName', revision.drawingFileName],
        ['drawingFileUrl', revision.drawingFileUrl],
        ['defaultChangedBy', revision.defaultChangedBy],
        ['remark', revision.remark]
      ].filter(([, value]) => value !== null && value !== undefined && String(value) !== String(value).trim());
      if (untrimmedDrawingOptionalFields.length > 0) {
        addIssue(
          'ERROR',
          'MATERIAL_DRAWING_REVISION_OPTIONAL_TEXT_HAS_SPACES',
          `${revisionLabel} 可选文本存在首尾空格：${untrimmedDrawingOptionalFields.map(([field]) => field).join(', ')}`
        );
      }

      const identityKey = `${normalizeCaseInsensitiveKey(drawingNo)}|${normalizeCaseInsensitiveKey(drawingVersion)}`;
      if (identityKey !== '|') {
        const existing = drawingIdentityRows.get(identityKey);
        if (existing) {
          addIssue(
            'ERROR',
            'MATERIAL_DRAWING_REVISION_DUPLICATE',
            `${label} 存在大小写不敏感重复图纸版本：${existing.drawingNo} / ${existing.drawingVersion} 与 ${drawingNo} / ${drawingVersion}`
          );
        } else {
          drawingIdentityRows.set(identityKey, revision);
        }
      }

      if (revision.status !== CommonStatus.ENABLED && revision.isDefault) {
        addIssue('ERROR', 'MATERIAL_DRAWING_DISABLED_IS_DEFAULT', `${revisionLabel} 已停用但仍被标记为默认图纸`);
      }
      if (revision.status === CommonStatus.ENABLED && revision.isDefault && !stringValue(revision.defaultChangedBy)) {
        addIssue('ERROR', 'MATERIAL_DRAWING_DEFAULT_OPERATOR_MISSING', `${revisionLabel} 是默认图纸但缺少 defaultChangedBy`);
      }
      if (revision.status === CommonStatus.ENABLED && revision.isDefault && !revision.defaultChangedAt) {
        addIssue('ERROR', 'MATERIAL_DRAWING_DEFAULT_TIME_MISSING', `${revisionLabel} 是默认图纸但缺少 defaultChangedAt`);
      }
    }
  }
}

async function checkFirstStageVerificationFixtures() {
  const [
    enabledCustomerCount,
    enabledGlobalBomCount,
    enabledGlobalAllProjectBomCount,
    enabledCustomerBomCount,
    enabledCustomerAllProjectBomCount,
    enabledCustomerBomGroups,
    copiedCustomerBomCount,
    enabledBomLineCount,
    enabledComponentLineCount,
    enabledChildLineCount,
    enabledStandaloneLineCount,
    enabledTransformRuleCount,
    projectModels
  ] = await Promise.all([
    prisma.customer.count({ where: { status: CommonStatus.ENABLED } }),
    prisma.modelBom.count({ where: { status: CommonStatus.ENABLED, customerId: null } }),
    prisma.modelBom.count({
      where: {
        status: CommonStatus.ENABLED,
        bomName: '百胜全部机型通用零件包',
        customer: { customerCode: 'C-004' },
        projectModelScopeKey: 'ALL'
      }
    }),
    prisma.modelBom.count({ where: { status: CommonStatus.ENABLED, customerId: { not: null } } }),
    prisma.modelBom.count({ where: { status: CommonStatus.ENABLED, customerId: { not: null }, projectModelScopeKey: 'ALL' } }),
    prisma.modelBom.groupBy({
      by: ['customerId'],
      where: { status: CommonStatus.ENABLED, customerId: { not: null } },
      _count: { _all: true }
    }),
    prisma.modelBom.count({ where: { status: CommonStatus.ENABLED, customerId: { not: null }, sourceBomId: { not: null } } }),
    prisma.modelBomLine.count({ where: { status: CommonStatus.ENABLED, material: { status: CommonStatus.ENABLED } } }),
    prisma.modelBomLine.count({ where: { status: CommonStatus.ENABLED, lineType: 'COMPONENT', material: { status: CommonStatus.ENABLED } } }),
    prisma.modelBomLine.count({
      where: {
        status: CommonStatus.ENABLED,
        lineType: 'PART',
        parentComponentNo: { not: null },
        material: { status: CommonStatus.ENABLED }
      }
    }),
    prisma.modelBomLine.count({
      where: {
        status: CommonStatus.ENABLED,
        lineType: 'PART',
        parentComponentNo: null,
        material: { status: CommonStatus.ENABLED }
      }
    }),
    prisma.materialTransformRule.count({
      where: {
        status: CommonStatus.ENABLED,
        sourceMaterial: { status: CommonStatus.ENABLED },
        targetMaterial: { status: CommonStatus.ENABLED }
      }
    }),
    prisma.modelBom.findMany({
      where: { status: CommonStatus.ENABLED },
      select: { projectModelScopeKey: true },
      distinct: ['projectModelScopeKey']
    })
  ]);

  if (enabledCustomerCount < 2) {
    addIssue(
      'ERROR',
      'FIRST_STAGE_SEED_CUSTOMER_COVERAGE_MISSING',
      `第一阶段验证至少需要 2 个启用客户用于客户下拉和关键字搜索，目前只有 ${enabledCustomerCount} 个；请重新执行 seed。`
    );
  }
  if (enabledGlobalBomCount < 1) {
    addIssue(
      'ERROR',
      'FIRST_STAGE_SEED_GLOBAL_BOM_MISSING',
      '第一阶段验证至少需要 1 个启用的百胜通用 BOM，用于验证复制客户 BOM。'
    );
  }
  if (enabledGlobalAllProjectBomCount < 1) {
    addIssue(
      'ERROR',
      'FIRST_STAGE_SEED_BAISHENG_ALL_PROJECT_BOM_MISSING',
      '第一阶段验证至少需要 1 个转入江阴市百胜制冷设备有限公司名下的百胜全部机型通用 BOM，避免其他客户界面误显示。'
    );
  }
  if (enabledCustomerBomCount < 2) {
    addIssue(
      'ERROR',
      'FIRST_STAGE_SEED_CUSTOMER_BOM_MISSING',
      `第一阶段验证至少需要 2 个启用客户 BOM，用于验证客户/机型筛选和下拉搜索，目前只有 ${enabledCustomerBomCount} 个。`
    );
  }
  if (enabledCustomerAllProjectBomCount < 1) {
    addIssue(
      'ERROR',
      'FIRST_STAGE_SEED_CUSTOMER_ALL_PROJECT_BOM_MISSING',
      '第一阶段验证至少需要 1 个客户全部机型通用 BOM，用于验证客户通用 BOM 和客户指定机型 BOM 可并存。'
    );
  }
  if (enabledCustomerBomGroups.length < 2) {
    addIssue(
      'ERROR',
      'FIRST_STAGE_SEED_CUSTOMER_BOM_CUSTOMER_COVERAGE_MISSING',
      `第一阶段验证至少需要 2 个不同客户拥有启用客户 BOM，用于验证客户下拉、关键字搜索和客户/机型联动，目前只有 ${enabledCustomerBomGroups.length} 个客户。`
    );
  }
  if (copiedCustomerBomCount < 1) {
    addIssue(
      'ERROR',
      'FIRST_STAGE_SEED_COPIED_CUSTOMER_BOM_MISSING',
      '第一阶段验证至少需要 1 个带 sourceBomId 的客户 BOM，用于验证从百胜通用 BOM 复制后的独立维护关系。'
    );
  }
  if (projectModels.length < 2) {
    addIssue(
      'ERROR',
      'FIRST_STAGE_SEED_PROJECT_MODEL_COVERAGE_MISSING',
      `第一阶段验证至少需要 2 个启用机型/项目 BOM，用于验证机型筛选，目前只有 ${projectModels.length} 个。`
    );
  }
  if (enabledBomLineCount < 3 || enabledComponentLineCount < 1 || enabledChildLineCount < 1 || enabledStandaloneLineCount < 1) {
    addIssue(
      'ERROR',
      'FIRST_STAGE_SEED_BOM_STRUCTURE_COVERAGE_MISSING',
      `第一阶段验证需要组件、子零件和单独零件结构；当前启用明细 ${enabledBomLineCount}，组件 ${enabledComponentLineCount}，子零件 ${enabledChildLineCount}，单独零件 ${enabledStandaloneLineCount}。`
    );
  }
  if (enabledTransformRuleCount < 1) {
    addIssue(
      'ERROR',
      'FIRST_STAGE_SEED_MATERIAL_TRANSFORM_RULE_MISSING',
      '第一阶段验证至少需要 1 条启用来源加工关系，用于验证来源加工关系只作为下单和库存来源核对建议，不会自动扣库存、生成订单或创建生产任务。'
    );
  }
}

async function checkMaterialStockAlerts() {
  const materials = await prisma.material.findMany({
    select: {
      partCode: true,
      partName: true,
      stockAlertEnabled: true,
      stockAlertQuantity: true
    },
    orderBy: { partCode: 'asc' }
  });

  const enabledAlertMaterials = materials.filter((material) => material.stockAlertEnabled);
  for (const material of materials) {
    const label = `Material ${material.partCode} / ${material.partName}`;
    const stockAlertQuantity =
      material.stockAlertQuantity === null || material.stockAlertQuantity === undefined ? null : decimalToNumber(material.stockAlertQuantity);
    if (material.stockAlertEnabled && stockAlertQuantity === null) {
      addIssue('ERROR', 'MATERIAL_STOCK_ALERT_QUANTITY_MISSING', `${label} 启用了库存报警但缺少 stockAlertQuantity`);
    }
    if (material.stockAlertEnabled && stockAlertQuantity !== null && stockAlertQuantity < 0) {
      addIssue('ERROR', 'MATERIAL_STOCK_ALERT_QUANTITY_NEGATIVE', `${label} 的 stockAlertQuantity=${stockAlertQuantity}，不能小于 0`);
    }
    if (!material.stockAlertEnabled && stockAlertQuantity !== null) {
      addIssue('WARN', 'MATERIAL_STOCK_ALERT_DISABLED_HAS_QUANTITY', `${label} 未启用库存报警但仍保留 stockAlertQuantity=${stockAlertQuantity}`);
    }
  }

  if (enabledAlertMaterials.length > 0) {
    await checkMaterialStockAlertRuntimeQuantities(enabledAlertMaterials);
  }

  const alertTransactions = await prisma.inventoryTransaction.findMany({
    where: {
      OR: [
        { sourceRecordType: { contains: 'StockAlert', mode: 'insensitive' } },
        { remark: { contains: '库存报警', mode: 'insensitive' } },
        { remark: { contains: '低库存', mode: 'insensitive' } }
      ]
    },
    select: {
      transactionNo: true,
      sourceRecordType: true,
      remark: true
    },
    orderBy: { transactionNo: 'asc' }
  });
  for (const transaction of alertTransactions) {
    addIssue(
      'ERROR',
      'MATERIAL_STOCK_ALERT_TRANSACTION_NOT_ALLOWED',
      `库存报警只能提醒和筛选，不能生成 InventoryTransaction：${transaction.transactionNo} / ${transaction.sourceRecordType || '-'} / ${transaction.remark || '-'}`
    );
  }
}

async function checkMaterialStockAlertRuntimeQuantities(
  materials: Array<{
    partCode: string;
    partName: string;
    stockAlertQuantity: Prisma.Decimal | null;
  }>
) {
  const partCodes = [...new Set(materials.map((material) => material.partCode.trim()).filter(Boolean))];
  if (partCodes.length === 0) {
    return;
  }
  const batches = await prisma.inventoryBatch.findMany({
    where: {
      status: 'AVAILABLE',
      quantity: { gt: 0 },
      OR: partCodes.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' } }))
    },
    select: {
      id: true,
      partCode: true,
      quantity: true,
      sourceOrderId: true
    }
  });
  const reservations = batches.length
    ? await prisma.inventoryReservation.findMany({
        where: {
          status: InventoryReservationStatus.ACTIVE,
          batchId: { in: batches.filter((batch) => !batch.sourceOrderId).map((batch) => batch.id) }
        },
        select: {
          batchId: true,
          quantity: true
        }
      })
    : [];
  const reservedQuantityByBatchId = new Map<string, number>();
  for (const reservation of reservations) {
    reservedQuantityByBatchId.set(
      reservation.batchId,
      roundQuantity((reservedQuantityByBatchId.get(reservation.batchId) || 0) + decimalToNumber(reservation.quantity))
    );
  }

  const availableQuantityByCode = new Map<string, number>();
  for (const batch of batches) {
    const key = normalizeCaseInsensitiveKey(batch.partCode);
    const physicalQuantity = decimalToNumber(batch.quantity);
    const reservedQuantity = batch.sourceOrderId ? 0 : reservedQuantityByBatchId.get(batch.id) || 0;
    if (!batch.sourceOrderId && reservedQuantity - physicalQuantity > quantityTolerance) {
      addIssue(
        'ERROR',
        'MATERIAL_STOCK_ALERT_RESERVED_OVER_AVAILABLE',
        `库存报警可用量核对发现 ${batch.partCode} 批次 ${batch.id} 的 active reservation=${reservedQuantity} 超过批次数量 ${physicalQuantity}`
      );
    }
    const availableQuantity = Math.max(roundQuantity(physicalQuantity - reservedQuantity), 0);
    availableQuantityByCode.set(key, roundQuantity((availableQuantityByCode.get(key) || 0) + availableQuantity));
  }

  for (const material of materials) {
    const threshold = decimalToNumber(material.stockAlertQuantity);
    const availableQuantity = availableQuantityByCode.get(normalizeCaseInsensitiveKey(material.partCode)) || 0;
    if (threshold < 0) {
      continue;
    }
    if (availableQuantity <= threshold) {
      // 低库存报警只由 Material 阈值和 InventoryBatch 实时可用数量计算，不保存第二份库存汇总数量。
      continue;
    }
  }
}

async function checkMaterialImportData() {
  const sessions = await prisma.materialImportSession.findMany({
    select: {
      id: true,
      status: true,
      createdBy: true,
      committedAt: true,
      committedMaterialCodes: true,
      files: {
        select: {
          id: true,
          sessionId: true,
          fileName: true,
          storedFileName: true,
          fileHash: true,
          sheetName: true,
          rowCount: true,
          materialRowCount: true,
          scopeRowCount: true,
          transformRowCount: true,
          acceptedRowCount: true,
          duplicateRowCount: true
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      },
      rows: {
        select: {
          id: true,
          sessionId: true,
          fileId: true,
          sourceRowNo: true,
          rowHash: true,
          partCode: true,
          partName: true,
          unit: true,
          partSpecification: true,
          drawingNo: true,
          drawingVersion: true,
          drawingStatus: true,
          partThickness: true,
          projectModel: true,
          stockAlertEnabled: true,
          stockAlertQuantity: true,
          remark: true,
          raw: true,
          issues: true,
          errorCount: true,
          warningCount: true
        },
        orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }]
      },
      applicabilityRows: {
        select: {
          id: true,
          sessionId: true,
          fileId: true,
          sourceRowNo: true,
          rowHash: true,
          partCode: true,
          customerCode: true,
          customerName: true,
          projectModel: true,
          remark: true,
          status: true,
          raw: true,
          issues: true,
          errorCount: true,
          warningCount: true
        },
        orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }]
      },
      transformRows: {
        select: {
          id: true,
          sessionId: true,
          fileId: true,
          sourceRowNo: true,
          rowHash: true,
          sourcePartCode: true,
          targetPartCode: true,
          customerCode: true,
          customerName: true,
          projectModel: true,
          multiplier: true,
          lossRate: true,
          defaultProcessRoute: true,
          conversionDescription: true,
          remark: true,
          status: true,
          raw: true,
          issues: true,
          errorCount: true,
          warningCount: true
        },
        orderBy: [{ createdAt: 'asc' }, { sourceRowNo: 'asc' }]
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  const countStoredImportIssues = (value: Prisma.JsonValue | null | undefined) => {
    const rows = Array.isArray(value) ? value : [];
    return {
      errorCount: rows.filter((issue) => isJsonRecord(issue as Prisma.JsonValue) && issue.severity === 'ERROR').length,
      warningCount: rows.filter((issue) => isJsonRecord(issue as Prisma.JsonValue) && issue.severity === 'WARNING').length
    };
  };
  const storedImportIssueCodes = (value: Prisma.JsonValue | null | undefined) => {
    const rows = Array.isArray(value) ? value : [];
    return new Set(
      rows
        .filter((issue) => isJsonRecord(issue as Prisma.JsonValue) && typeof issue.code === 'string')
        .map((issue) => String((issue as Prisma.JsonObject).code))
    );
  };

  for (const session of sessions) {
    const sessionLabel = `零件库导入会话 ${session.id}`;
    // 零件库导入只写基础资料和规则，不能借导入会话生成订单、生产任务或库存流水。
    if (!['DRAFT', 'COMMITTED'].includes(session.status)) {
      addIssue('ERROR', 'MATERIAL_IMPORT_SESSION_STATUS_INVALID', `${sessionLabel} status=${session.status} 不在允许范围内`);
    }
    if (session.createdBy !== null && !session.createdBy.trim()) {
      addIssue('ERROR', 'MATERIAL_IMPORT_SESSION_OPTIONAL_TEXT_BLANK', `${sessionLabel} createdBy 不能保存空字符串`);
    }
    if (session.status === 'DRAFT' && (session.committedAt !== null || session.committedMaterialCodes !== null)) {
      addIssue('ERROR', 'MATERIAL_IMPORT_DRAFT_COMMIT_FIELDS_STALE', `${sessionLabel} 仍为 DRAFT，但保存了 committedAt 或 committedMaterialCodes`);
    }
    if (session.status === 'COMMITTED') {
      if (!session.committedAt) {
        addIssue('ERROR', 'MATERIAL_IMPORT_COMMITTED_AT_MISSING', `${sessionLabel} 已提交但缺少 committedAt`);
      }
      if (!Array.isArray(session.committedMaterialCodes)) {
        addIssue('ERROR', 'MATERIAL_IMPORT_COMMITTED_CODES_INVALID', `${sessionLabel} 已提交但 committedMaterialCodes 不是数组`);
      }
    }

    const materialRowCountByFileId = new Map<string, number>();
    const scopeRowCountByFileId = new Map<string, number>();
    const transformRowCountByFileId = new Map<string, number>();
    for (const row of session.rows) {
      materialRowCountByFileId.set(row.fileId, (materialRowCountByFileId.get(row.fileId) || 0) + 1);
    }
    for (const row of session.applicabilityRows) {
      scopeRowCountByFileId.set(row.fileId, (scopeRowCountByFileId.get(row.fileId) || 0) + 1);
    }
    for (const row of session.transformRows) {
      transformRowCountByFileId.set(row.fileId, (transformRowCountByFileId.get(row.fileId) || 0) + 1);
    }

    for (const file of session.files) {
      const fileLabel = `${sessionLabel} / 文件 ${file.fileName || file.id}`;
      const missingFileFields = [
        ['sessionId', file.sessionId],
        ['fileName', file.fileName],
        ['fileHash', file.fileHash],
        ['sheetName', file.sheetName]
      ].filter(([, value]) => !String(value || '').trim());
      if (missingFileFields.length > 0) {
        addIssue('ERROR', 'MATERIAL_IMPORT_FILE_IDENTITY_MISSING', `${fileLabel} 缺少文件追溯字段：${missingFileFields.map(([field]) => field).join(', ')}`);
      }
      if (file.storedFileName !== null && !file.storedFileName.trim()) {
        addIssue('ERROR', 'MATERIAL_IMPORT_FILE_OPTIONAL_TEXT_BLANK', `${fileLabel} storedFileName 不能保存空字符串`);
      }
      const rowCounts = [file.rowCount, file.materialRowCount, file.scopeRowCount, file.transformRowCount, file.acceptedRowCount, file.duplicateRowCount];
      if (rowCounts.some((count) => count < 0)) {
        addIssue('ERROR', 'MATERIAL_IMPORT_FILE_COUNT_NEGATIVE', `${fileLabel} 行数统计不能小于 0`);
      }
      if (file.materialRowCount + file.scopeRowCount + file.transformRowCount !== file.rowCount) {
        addIssue('ERROR', 'MATERIAL_IMPORT_FILE_ROW_COUNT_MISMATCH', `${fileLabel} rowCount 必须等于 materialRowCount + scopeRowCount + transformRowCount`);
      }
      if (file.acceptedRowCount + file.duplicateRowCount !== file.rowCount) {
        addIssue('ERROR', 'MATERIAL_IMPORT_FILE_ACCEPTED_COUNT_MISMATCH', `${fileLabel} rowCount 必须等于 acceptedRowCount + duplicateRowCount`);
      }
      const actualMaterialRows = materialRowCountByFileId.get(file.id) || 0;
      const actualScopeRows = scopeRowCountByFileId.get(file.id) || 0;
      const actualTransformRows = transformRowCountByFileId.get(file.id) || 0;
      if (actualMaterialRows !== file.materialRowCount || actualScopeRows !== file.scopeRowCount || actualTransformRows !== file.transformRowCount) {
        addIssue(
          'ERROR',
          'MATERIAL_IMPORT_FILE_TYPED_ROW_COUNT_MISMATCH',
          `${fileLabel} 类型行数与实际保存行不一致：${file.materialRowCount}/${file.scopeRowCount}/${file.transformRowCount}，实际 ${actualMaterialRows}/${actualScopeRows}/${actualTransformRows}`
        );
      }
      const actualAcceptedRows = actualMaterialRows + actualScopeRows + actualTransformRows;
      if (actualAcceptedRows !== file.acceptedRowCount) {
        addIssue('ERROR', 'MATERIAL_IMPORT_FILE_ACCEPTED_ROW_COUNT_MISMATCH', `${fileLabel} acceptedRowCount=${file.acceptedRowCount}，实际保存行数=${actualAcceptedRows}`);
      }
    }

    for (const row of session.rows) {
      const rowLabel = `${sessionLabel} / 零件行 ${row.sourceRowNo || '-'} / ${row.partCode || '-'}`;
      const issueCodes = storedImportIssueCodes(row.issues);
      const missingFields = [
        ['sessionId', row.sessionId],
        ['fileId', row.fileId],
        ['rowHash', row.rowHash]
      ].filter(([, value]) => !String(value || '').trim());
      if (missingFields.length > 0) {
        addIssue('ERROR', 'MATERIAL_IMPORT_ROW_IDENTITY_MISSING', `${rowLabel} 缺少行追溯字段：${missingFields.map(([field]) => field).join(', ')}`);
      }
      const missingBusinessIssues = [
        ['partCode', row.partCode, 'REQUIRED_PART_CODE'],
        ['partName', row.partName, 'REQUIRED_PART_NAME'],
        ['unit', row.unit, 'REQUIRED_UNIT']
      ].filter(([, value, issueCode]) => !String(value || '').trim() && !issueCodes.has(String(issueCode)));
      if (missingBusinessIssues.length > 0) {
        addIssue(
          'ERROR',
          'MATERIAL_IMPORT_ROW_REQUIRED_FIELD_MISSING_WITHOUT_ISSUE',
          `${rowLabel} 缺少业务必填字段但未保存对应 issues：${missingBusinessIssues.map(([field]) => field).join(', ')}`
        );
      }
      if (row.sourceRowNo <= 0) {
        addIssue('ERROR', 'MATERIAL_IMPORT_ROW_SOURCE_ROW_INVALID', `${rowLabel} sourceRowNo 必须大于 0`);
      }
      if (row.partThickness !== null && decimalToNumber(row.partThickness) < 0 && !issueCodes.has('INVALID_PART_THICKNESS')) {
        addIssue('ERROR', 'MATERIAL_IMPORT_ROW_QUANTITY_INVALID', `${rowLabel} partThickness 不能小于 0`);
      }
      if (row.stockAlertQuantity !== null && decimalToNumber(row.stockAlertQuantity) < 0 && !issueCodes.has('INVALID_STOCK_ALERT_QUANTITY')) {
        addIssue('ERROR', 'MATERIAL_IMPORT_ROW_QUANTITY_INVALID', `${rowLabel} stockAlertQuantity 不能小于 0`);
      }
      if (row.stockAlertEnabled === true && row.stockAlertQuantity === null && !issueCodes.has('STOCK_ALERT_QUANTITY_REQUIRED')) {
        addIssue('ERROR', 'MATERIAL_IMPORT_ROW_STOCK_ALERT_QUANTITY_MISSING', `${rowLabel} 启用库存报警时必须填写 stockAlertQuantity`);
      }
      if (row.errorCount < 0 || row.warningCount < 0) {
        addIssue('ERROR', 'MATERIAL_IMPORT_ROW_ISSUE_COUNT_INVALID', `${rowLabel} errorCount / warningCount 不能小于 0`);
      }
      if (!isJsonRecord(row.raw)) {
        addIssue('ERROR', 'MATERIAL_IMPORT_ROW_RAW_INVALID', `${rowLabel} raw 必须是对象快照`);
      }
      if (row.issues !== null && !Array.isArray(row.issues)) {
        addIssue('ERROR', 'MATERIAL_IMPORT_ROW_ISSUES_INVALID', `${rowLabel} issues 必须为空或数组`);
      }
      const issueCounts = countStoredImportIssues(row.issues);
      if (row.errorCount !== issueCounts.errorCount || row.warningCount !== issueCounts.warningCount) {
        addIssue(
          'ERROR',
          'MATERIAL_IMPORT_ROW_ISSUE_COUNT_MISMATCH',
          `${rowLabel} errorCount/warningCount 与 issues 快照不一致：${row.errorCount}/${row.warningCount}，实际 ${issueCounts.errorCount}/${issueCounts.warningCount}`
        );
      }
      const blankOptionalFields = [
        ['partSpecification', row.partSpecification],
        ['drawingNo', row.drawingNo],
        ['drawingVersion', row.drawingVersion],
        ['drawingStatus', row.drawingStatus],
        ['projectModel', row.projectModel],
        ['remark', row.remark]
      ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
      if (blankOptionalFields.length > 0) {
        addIssue('ERROR', 'MATERIAL_IMPORT_ROW_OPTIONAL_TEXT_BLANK', `${rowLabel} 可选文本不能保存空字符串：${blankOptionalFields.map(([field]) => field).join(', ')}`);
      }
    }

    for (const row of session.applicabilityRows) {
      const rowLabel = `${sessionLabel} / 适用范围行 ${row.sourceRowNo || '-'} / ${row.partCode || '-'}`;
      const missingFields = [
        ['sessionId', row.sessionId],
        ['fileId', row.fileId],
        ['rowHash', row.rowHash]
      ].filter(([, value]) => !String(value || '').trim());
      if (missingFields.length > 0) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_IMPORT_ROW_IDENTITY_MISSING', `${rowLabel} 缺少行追溯字段：${missingFields.map(([field]) => field).join(', ')}`);
      }
      if (row.sourceRowNo <= 0) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_IMPORT_ROW_SOURCE_ROW_INVALID', `${rowLabel} sourceRowNo 必须大于 0`);
      }
      if (!String(row.partCode || '').trim() && !storedImportIssueCodes(row.issues).has('REQUIRED_PART_CODE')) {
        addIssue(
          'ERROR',
          'MATERIAL_APPLICABILITY_IMPORT_ROW_REQUIRED_FIELD_MISSING_WITHOUT_ISSUE',
          `${rowLabel} 缺少业务必填字段但未保存对应 issues：partCode`
        );
      }
      if (row.status !== CommonStatus.ENABLED && row.status !== CommonStatus.DISABLED) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_IMPORT_ROW_STATUS_INVALID', `${rowLabel} status=${row.status} 不在允许范围内`);
      }
      if (row.errorCount < 0 || row.warningCount < 0) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_IMPORT_ROW_ISSUE_COUNT_INVALID', `${rowLabel} errorCount / warningCount 不能小于 0`);
      }
      if (!isJsonRecord(row.raw)) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_IMPORT_ROW_RAW_INVALID', `${rowLabel} raw 必须是对象快照`);
      }
      if (row.issues !== null && !Array.isArray(row.issues)) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_IMPORT_ROW_ISSUES_INVALID', `${rowLabel} issues 必须为空或数组`);
      }
      const issueCounts = countStoredImportIssues(row.issues);
      if (row.errorCount !== issueCounts.errorCount || row.warningCount !== issueCounts.warningCount) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_IMPORT_ROW_ISSUE_COUNT_MISMATCH', `${rowLabel} errorCount/warningCount 与 issues 快照不一致`);
      }
      const blankOptionalFields = [
        ['customerCode', row.customerCode],
        ['customerName', row.customerName],
        ['projectModel', row.projectModel],
        ['remark', row.remark]
      ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
      if (blankOptionalFields.length > 0) {
        addIssue('ERROR', 'MATERIAL_APPLICABILITY_IMPORT_ROW_OPTIONAL_TEXT_BLANK', `${rowLabel} 可选文本不能保存空字符串：${blankOptionalFields.map(([field]) => field).join(', ')}`);
      }
    }

    for (const row of session.transformRows) {
      const rowLabel = `${sessionLabel} / 来源加工行 ${row.sourceRowNo || '-'} / ${row.sourcePartCode || '-'} -> ${row.targetPartCode || '-'}`;
      const missingFields = [
        ['sessionId', row.sessionId],
        ['fileId', row.fileId],
        ['rowHash', row.rowHash]
      ].filter(([, value]) => !String(value || '').trim());
      if (missingFields.length > 0) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_IDENTITY_MISSING', `${rowLabel} 缺少行追溯字段：${missingFields.map(([field]) => field).join(', ')}`);
      }
      const issueCodes = storedImportIssueCodes(row.issues);
      const missingTransformBusinessIssues = [
        ['sourcePartCode', row.sourcePartCode, 'REQUIRED_SOURCE_PART_CODE'],
        ['targetPartCode', row.targetPartCode, 'REQUIRED_TARGET_PART_CODE']
      ].filter(([, value, issueCode]) => !String(value || '').trim() && !issueCodes.has(String(issueCode)));
      if (missingTransformBusinessIssues.length > 0) {
        addIssue(
          'ERROR',
          'MATERIAL_TRANSFORM_IMPORT_ROW_REQUIRED_FIELD_MISSING_WITHOUT_ISSUE',
          `${rowLabel} 缺少业务必填字段但未保存对应 issues：${missingTransformBusinessIssues.map(([field]) => field).join(', ')}`
        );
      }
      if (
        normalizeCaseInsensitiveKey(row.sourcePartCode) === normalizeCaseInsensitiveKey(row.targetPartCode) &&
        String(row.sourcePartCode || '').trim() &&
        String(row.targetPartCode || '').trim() &&
        !issueCodes.has('SAME_SOURCE_TARGET')
      ) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_SOURCE_TARGET_SAME', `${rowLabel} 来源零件和目标零件不能相同`);
      }
      if (row.sourceRowNo <= 0) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_SOURCE_ROW_INVALID', `${rowLabel} sourceRowNo 必须大于 0`);
      }
      if (row.multiplier !== null && decimalToNumber(row.multiplier) <= 0 && !issueCodes.has('INVALID_MULTIPLIER')) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_QUANTITY_INVALID', `${rowLabel} multiplier 必须大于 0`);
      }
      if (row.lossRate !== null && decimalToNumber(row.lossRate) < 0 && !issueCodes.has('INVALID_LOSS_RATE')) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_QUANTITY_INVALID', `${rowLabel} lossRate 不能小于 0`);
      }
      if (row.status !== CommonStatus.ENABLED && row.status !== CommonStatus.DISABLED) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_STATUS_INVALID', `${rowLabel} status=${row.status} 不在允许范围内`);
      }
      if (row.errorCount < 0 || row.warningCount < 0) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_ISSUE_COUNT_INVALID', `${rowLabel} errorCount / warningCount 不能小于 0`);
      }
      if (!isJsonRecord(row.raw)) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_RAW_INVALID', `${rowLabel} raw 必须是对象快照`);
      }
      if (row.issues !== null && !Array.isArray(row.issues)) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_ISSUES_INVALID', `${rowLabel} issues 必须为空或数组`);
      }
      const issueCounts = countStoredImportIssues(row.issues);
      if (row.errorCount !== issueCounts.errorCount || row.warningCount !== issueCounts.warningCount) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_ISSUE_COUNT_MISMATCH', `${rowLabel} errorCount/warningCount 与 issues 快照不一致`);
      }
      const blankOptionalFields = [
        ['customerCode', row.customerCode],
        ['customerName', row.customerName],
        ['projectModel', row.projectModel],
        ['defaultProcessRoute', row.defaultProcessRoute],
        ['conversionDescription', row.conversionDescription],
        ['remark', row.remark]
      ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
      if (blankOptionalFields.length > 0) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_IMPORT_ROW_OPTIONAL_TEXT_BLANK', `${rowLabel} 可选文本不能保存空字符串：${blankOptionalFields.map(([field]) => field).join(', ')}`);
      }
    }
  }
}

async function checkOrderLineComponentStructure() {
  const orders = await prisma.customerOrder.findMany({
    select: {
      id: true,
      orderNo: true,
      lines: {
        select: {
          id: true,
          lineNo: true,
          lineType: true,
          componentNo: true,
          parentComponentNo: true,
          partCode: true
        },
        orderBy: [{ lineNo: 'asc' }, { createdAt: 'asc' }]
      }
    },
    orderBy: { orderNo: 'asc' }
  });

  for (const order of orders) {
    const componentNos = new Map<string, (typeof order.lines)[number]>();
    const duplicateComponentNos = new Set<string>();

    for (const line of order.lines) {
      const lineType = stringValue(line.lineType) || 'PART';
      const componentNo = normalizeComponentNo(line.componentNo);
      const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
      const label = `订单 ${order.orderNo} / line ${line.lineNo || '-'} / ${line.partCode}`;

      if (lineType !== 'COMPONENT' && lineType !== 'PART') {
        addIssue('ERROR', 'ORDER_LINE_TYPE_INVALID', `${label} lineType=${lineType} 不在 COMPONENT / PART 范围内`);
      }

      if (lineType === 'COMPONENT') {
        if (!componentNo) {
          addIssue('ERROR', 'ORDER_LINE_COMPONENT_NO_MISSING', `${label} 是组件行但缺少 componentNo`);
          continue;
        }
        if (isComponentNoRangeInvalid(componentNo)) {
          addIssue('ERROR', 'ORDER_LINE_COMPONENT_NO_RANGE_INVALID', `${label} 组件编号 ${componentNo} 超出 C001-C9999 范围`);
        }
        if (parentComponentNo) {
          addIssue('ERROR', 'ORDER_LINE_COMPONENT_HAS_PARENT', `${label} 是组件行但填写了 parentComponentNo=${parentComponentNo}`);
        }
        if (componentNos.has(componentNo)) {
          duplicateComponentNos.add(componentNo);
        }
        componentNos.set(componentNo, line);
        continue;
      }

      if (componentNo) {
        addIssue('ERROR', 'ORDER_LINE_PART_COMPONENT_NO_NOT_ALLOWED', `${label} 是零件行，不能填写 componentNo=${componentNo}`);
      }
    }

    for (const duplicateComponentNo of duplicateComponentNos) {
      addIssue('ERROR', 'ORDER_LINE_COMPONENT_NO_DUPLICATE', `订单 ${order.orderNo} 存在重复组件编号 ${duplicateComponentNo}`);
    }

    for (const line of order.lines) {
      const lineType = stringValue(line.lineType) || 'PART';
      const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
      if (lineType === 'PART' && parentComponentNo && !componentNos.has(parentComponentNo)) {
        addIssue(
          'ERROR',
          'ORDER_LINE_CHILD_PARENT_MISSING',
          `订单 ${order.orderNo} / line ${line.lineNo || '-'} / ${line.partCode} 所属组件 ${parentComponentNo} 在当前订单内不存在`
        );
      }
    }
  }
}

async function checkOrderImportData() {
  const sessions = await prisma.orderImportSession.findMany({
    select: {
      id: true,
      status: true,
      createdBy: true,
      committedAt: true,
      committedOrderNos: true,
      files: {
        select: {
          id: true,
          sessionId: true,
          fileName: true,
          storedFileName: true,
          fileHash: true,
          sheetName: true,
          rowCount: true,
          acceptedRowCount: true,
          duplicateRowCount: true
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      },
      rows: {
        select: {
          id: true,
          sessionId: true,
          fileId: true,
          sourceRowNo: true,
          rowHash: true,
          orderBlock: true,
          orderNo: true,
          customerName: true,
          projectModel: true,
          lineType: true,
          importSequence: true,
          partCategory: true,
          componentNo: true,
          parentComponentNo: true,
          partCode: true,
          drawingNo: true,
          partName: true,
          partSpecification: true,
          partThickness: true,
          orderQuantity: true,
          unitUsage: true,
          demandQuantity: true,
          unit: true,
          processRoute: true,
          processRemark: true,
          drawingStatus: true,
          raw: true,
          issues: true,
          errorCount: true,
          warningCount: true
        },
        orderBy: [{ orderNo: 'asc' }, { sourceRowNo: 'asc' }]
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  for (const session of sessions) {
    const sessionLabel = `导入会话 ${session.id}`;
    // Excel 导入会话只允许 DRAFT 或 COMMITTED；提交后只保留来源记忆，不自动提交生产。
    if (!['DRAFT', 'COMMITTED'].includes(session.status)) {
      addIssue('ERROR', 'ORDER_IMPORT_SESSION_STATUS_INVALID', `${sessionLabel} status=${session.status} 不在允许范围内`);
    }
    if (session.createdBy !== null && !session.createdBy.trim()) {
      addIssue('ERROR', 'ORDER_IMPORT_SESSION_OPTIONAL_TEXT_BLANK', `${sessionLabel} createdBy 不能保存空字符串`);
    }
    const committedOrderNos = committedOrderNoSet(session.committedOrderNos);
    if (session.status === 'DRAFT' && (session.committedAt !== null || session.committedOrderNos !== null)) {
      addIssue('ERROR', 'ORDER_IMPORT_DRAFT_COMMIT_FIELDS_STALE', `${sessionLabel} 仍为 DRAFT，但保存了 committedAt 或 committedOrderNos`);
    }
    if (session.status === 'COMMITTED') {
      if (!session.committedAt) {
        addIssue('ERROR', 'ORDER_IMPORT_COMMITTED_AT_MISSING', `${sessionLabel} 已提交但缺少 committedAt`);
      }
      if (!Array.isArray(session.committedOrderNos) || committedOrderNos.size === 0) {
        addIssue('ERROR', 'ORDER_IMPORT_COMMITTED_ORDER_NOS_INVALID', `${sessionLabel} 已提交但 committedOrderNos 不是有效订单号数组`);
      }
    }

    const rowCountByFileId = new Map<string, number>();
    for (const row of session.rows) {
      rowCountByFileId.set(row.fileId, (rowCountByFileId.get(row.fileId) || 0) + 1);
    }
    for (const file of session.files) {
      const fileLabel = `${sessionLabel} / 文件 ${file.fileName || file.id}`;
      const missingFileFields = [
        ['sessionId', file.sessionId],
        ['fileName', file.fileName],
        ['fileHash', file.fileHash],
        ['sheetName', file.sheetName]
      ].filter(([, value]) => !String(value || '').trim());
      if (missingFileFields.length > 0) {
        addIssue('ERROR', 'ORDER_IMPORT_FILE_IDENTITY_MISSING', `${fileLabel} 缺少文件追溯字段：${missingFileFields.map(([field]) => field).join(', ')}`);
      }
      if (file.storedFileName !== null && !file.storedFileName.trim()) {
        addIssue('ERROR', 'ORDER_IMPORT_FILE_OPTIONAL_TEXT_BLANK', `${fileLabel} storedFileName 不能保存空字符串`);
      }
      if (file.rowCount < 0 || file.acceptedRowCount < 0 || file.duplicateRowCount < 0) {
        addIssue('ERROR', 'ORDER_IMPORT_FILE_COUNT_NEGATIVE', `${fileLabel} rowCount / acceptedRowCount / duplicateRowCount 不能小于 0`);
      }
      if (file.acceptedRowCount + file.duplicateRowCount > file.rowCount) {
        addIssue('ERROR', 'ORDER_IMPORT_FILE_COUNT_OVERFLOW', `${fileLabel} acceptedRowCount + duplicateRowCount 不能大于 rowCount`);
      }
      if (file.acceptedRowCount + file.duplicateRowCount !== file.rowCount) {
        addIssue('ERROR', 'ORDER_IMPORT_FILE_COUNT_MISMATCH', `${fileLabel} rowCount 必须等于 acceptedRowCount + duplicateRowCount`);
      }
      const actualAcceptedRows = rowCountByFileId.get(file.id) || 0;
      if (actualAcceptedRows !== file.acceptedRowCount) {
        addIssue('ERROR', 'ORDER_IMPORT_FILE_ACCEPTED_ROW_COUNT_MISMATCH', `${fileLabel} acceptedRowCount=${file.acceptedRowCount}，实际保存行数=${actualAcceptedRows}`);
      }
    }

    for (const row of session.rows) {
      const rowLabel = `${sessionLabel} / 订单 ${row.orderNo || '-'} / Excel 行 ${row.sourceRowNo || '-'} / ${row.partCode || '-'}`;
      const missingRowFields = [
        ['sessionId', row.sessionId],
        ['fileId', row.fileId],
        ['rowHash', row.rowHash],
        ['lineType', row.lineType],
        ['unit', row.unit]
      ].filter(([, value]) => !String(value || '').trim());
      if (missingRowFields.length > 0) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_IDENTITY_MISSING', `${rowLabel} 缺少行追溯字段：${missingRowFields.map(([field]) => field).join(', ')}`);
      }
      if (!['PART', 'COMPONENT'].includes(row.lineType)) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_LINE_TYPE_INVALID', `${rowLabel} lineType=${row.lineType} 不在 PART / COMPONENT 范围内`);
      }
      if (row.sourceRowNo <= 0) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_SOURCE_ROW_INVALID', `${rowLabel} sourceRowNo 必须大于 0`);
      }
      if (decimalToNumber(row.partThickness) < 0) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_QUANTITY_INVALID', `${rowLabel} partThickness 不能小于 0`);
      }
      if (row.orderQuantity !== null && decimalToNumber(row.orderQuantity) < 0) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_QUANTITY_INVALID', `${rowLabel} orderQuantity 不能小于 0`);
      }
      if (row.unitUsage !== null && decimalToNumber(row.unitUsage) < 0) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_QUANTITY_INVALID', `${rowLabel} unitUsage 不能小于 0`);
      }
      if (decimalToNumber(row.demandQuantity) < 0) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_QUANTITY_INVALID', `${rowLabel} demandQuantity 不能小于 0`);
      }
      if (row.errorCount < 0 || row.warningCount < 0) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_ISSUE_COUNT_INVALID', `${rowLabel} errorCount / warningCount 不能小于 0`);
      }
      if (!isJsonRecord(row.raw)) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_RAW_INVALID', `${rowLabel} raw 必须是对象快照`);
      }
      if (row.issues !== null && !Array.isArray(row.issues)) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_ISSUES_INVALID', `${rowLabel} issues 必须为空或数组`);
      }
      const storedIssues = Array.isArray(row.issues) ? row.issues : [];
      const storedErrorCount = storedIssues.filter((issue) => isJsonRecord(issue as Prisma.JsonValue) && issue.severity === 'ERROR').length;
      const storedWarningCount = storedIssues.filter((issue) => isJsonRecord(issue as Prisma.JsonValue) && issue.severity === 'WARNING').length;
      if (row.errorCount !== storedErrorCount || row.warningCount !== storedWarningCount) {
        addIssue(
          'ERROR',
          'ORDER_IMPORT_ROW_ISSUE_COUNT_MISMATCH',
          `${rowLabel} errorCount/warningCount 与 issues 快照不一致：${row.errorCount}/${row.warningCount}，实际 ${storedErrorCount}/${storedWarningCount}`
        );
      }
      if (row.errorCount === 0) {
        const missingCleanFields = [
          ['orderNo', row.orderNo],
          ['customerName', row.customerName],
          ['partCode', row.partCode],
          ['partName', row.partName]
        ].filter(([, value]) => !String(value || '').trim());
        if (missingCleanFields.length > 0 || decimalToNumber(row.demandQuantity) <= 0) {
          addIssue('ERROR', 'ORDER_IMPORT_CLEAN_ROW_REQUIRED_FIELDS_MISSING', `${rowLabel} 无错误行必须保留订单号、客户、零件和正数 demandQuantity`);
        }
        const componentNo = normalizeComponentNo(row.componentNo);
        const parentComponentNo = normalizeComponentNo(row.parentComponentNo);
        if (row.lineType === 'COMPONENT' && (!componentNo || parentComponentNo)) {
          addIssue('ERROR', 'ORDER_IMPORT_CLEAN_COMPONENT_SHAPE_INVALID', `${rowLabel} 无错误组件行必须有 componentNo 且不能填写 parentComponentNo`);
        }
        if (row.lineType === 'PART' && componentNo) {
          addIssue('ERROR', 'ORDER_IMPORT_CLEAN_PART_SHAPE_INVALID', `${rowLabel} 无错误零件行不能填写 componentNo`);
        }
      }
      const blankOptionalFields = [
        ['orderBlock', row.orderBlock],
        ['projectModel', row.projectModel],
        ['importSequence', row.importSequence],
        ['partCategory', row.partCategory],
        ['componentNo', row.componentNo],
        ['parentComponentNo', row.parentComponentNo],
        ['drawingNo', row.drawingNo],
        ['partSpecification', row.partSpecification],
        ['processRoute', row.processRoute],
        ['processRemark', row.processRemark],
        ['drawingStatus', row.drawingStatus]
      ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
      if (blankOptionalFields.length > 0) {
        addIssue('ERROR', 'ORDER_IMPORT_ROW_OPTIONAL_TEXT_BLANK', `${rowLabel} 可选文本不能保存空字符串：${blankOptionalFields.map(([field]) => field).join(', ')}`);
      }
    }
  }
}

async function checkCommittedOrderImportRowComponentStructure() {
  const sessions = await prisma.orderImportSession.findMany({
    where: { status: 'COMMITTED' },
    select: {
      id: true,
      committedOrderNos: true,
      rows: {
        select: {
          id: true,
          orderNo: true,
          sourceRowNo: true,
          lineType: true,
          componentNo: true,
          parentComponentNo: true,
          partCode: true,
          errorCount: true
        },
        orderBy: [{ orderNo: 'asc' }, { sourceRowNo: 'asc' }]
      }
    },
    orderBy: { committedAt: 'asc' }
  });

  for (const session of sessions) {
    const committedOrderNos = committedOrderNoSet(session.committedOrderNos);
    if (committedOrderNos.size === 0) {
      continue;
    }
    const rowsByOrderNo = new Map<string, typeof session.rows>();
    for (const row of session.rows) {
      const orderNo = normalizeOrderNo(row.orderNo);
      if (!committedOrderNos.has(orderNo)) {
        continue;
      }
      rowsByOrderNo.set(orderNo, [...(rowsByOrderNo.get(orderNo) || []), row]);
      if (row.errorCount > 0) {
        addIssue(
          'ERROR',
          'ORDER_IMPORT_COMMITTED_ROW_HAS_ERROR',
          `导入会话 ${session.id} / 订单 ${row.orderNo} / Excel 行 ${row.sourceRowNo || '-'} 已提交但仍保留 errorCount=${row.errorCount}`
        );
      }
    }

    for (const [orderNo, rows] of rowsByOrderNo.entries()) {
      const componentNos = new Set<string>();
      const duplicateComponentNos = new Set<string>();
      for (const row of rows) {
        const lineType = stringValue(row.lineType) || 'PART';
        const componentNo = normalizeComponentNo(row.componentNo);
        const parentComponentNo = normalizeComponentNo(row.parentComponentNo);
        const label = `导入会话 ${session.id} / 订单 ${orderNo} / Excel 行 ${row.sourceRowNo || '-'} / ${row.partCode}`;

        if (lineType !== 'COMPONENT' && lineType !== 'PART') {
          addIssue('ERROR', 'ORDER_IMPORT_LINE_TYPE_INVALID', `${label} lineType=${lineType} 不在 COMPONENT / PART 范围内`);
        }
        if (lineType === 'COMPONENT') {
          if (!componentNo) {
            addIssue('ERROR', 'ORDER_IMPORT_COMPONENT_NO_MISSING', `${label} 是组件行但缺少 componentNo`);
            continue;
          }
          if (isComponentNoRangeInvalid(componentNo)) {
            addIssue('ERROR', 'ORDER_IMPORT_COMPONENT_NO_RANGE_INVALID', `${label} 组件编号 ${componentNo} 超出 C001-C9999 范围`);
          }
          if (parentComponentNo) {
            addIssue('ERROR', 'ORDER_IMPORT_COMPONENT_HAS_PARENT', `${label} 是组件行但填写了 parentComponentNo=${parentComponentNo}`);
          }
          if (componentNos.has(componentNo)) {
            duplicateComponentNos.add(componentNo);
          }
          componentNos.add(componentNo);
          continue;
        }
        if (componentNo) {
          addIssue('ERROR', 'ORDER_IMPORT_PART_COMPONENT_NO_NOT_ALLOWED', `${label} 是零件行，不能填写 componentNo=${componentNo}`);
        }
      }

      for (const duplicateComponentNo of duplicateComponentNos) {
        addIssue('ERROR', 'ORDER_IMPORT_COMPONENT_NO_DUPLICATE', `导入会话 ${session.id} / 订单 ${orderNo} 存在重复组件编号 ${duplicateComponentNo}`);
      }

      for (const row of rows) {
        const lineType = stringValue(row.lineType) || 'PART';
        const parentComponentNo = normalizeComponentNo(row.parentComponentNo);
        if (lineType === 'PART' && parentComponentNo && !componentNos.has(parentComponentNo)) {
          addIssue(
            'ERROR',
            'ORDER_IMPORT_CHILD_PARENT_MISSING',
            `导入会话 ${session.id} / 订单 ${orderNo} / Excel 行 ${row.sourceRowNo || '-'} / ${row.partCode} 所属组件 ${parentComponentNo} 在当前导入订单内不存在`
          );
        }
      }
    }
  }
}

async function checkMaterialTransformRuleData() {
  const rules = await prisma.materialTransformRule.findMany({
    select: {
      id: true,
      sourceMaterialId: true,
      targetMaterialId: true,
      customerId: true,
      customerNameSnapshot: true,
      projectModel: true,
      customerScopeKey: true,
      projectModelScopeKey: true,
      conversionDescription: true,
      defaultProcessRoute: true,
      multiplier: true,
      lossRate: true,
      remark: true,
      status: true,
      sourceMaterial: { select: { partCode: true, status: true } },
      targetMaterial: { select: { partCode: true, status: true } }
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
  });

  for (const rule of rules) {
    const scopeText = [rule.customerNameSnapshot, rule.projectModel].filter(Boolean).join(' / ') || '全部范围';
    const label = `来源加工关系 ${rule.sourceMaterial.partCode} -> ${rule.targetMaterial.partCode} / ${scopeText}`;
    // 来源加工关系只做库存来源建议，不得保存缺失身份、非法倍率或模糊适用范围。
    const missingIdentityFields = [
      ['sourceMaterialId', rule.sourceMaterialId],
      ['targetMaterialId', rule.targetMaterialId],
      ['customerScopeKey', rule.customerScopeKey],
      ['projectModelScopeKey', rule.projectModelScopeKey]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingIdentityFields.length > 0) {
      addIssue('ERROR', 'MATERIAL_TRANSFORM_RULE_IDENTITY_MISSING', `${label} 缺少身份或适用范围 key：${missingIdentityFields.map(([field]) => field).join(', ')}`);
    }
    if (rule.sourceMaterialId === rule.targetMaterialId) {
      addIssue('ERROR', 'MATERIAL_TRANSFORM_RULE_SOURCE_TARGET_SAME', `${label} sourceMaterialId 和 targetMaterialId 不能相同`);
    }
    if (decimalToNumber(rule.multiplier) <= 0) {
      addIssue('ERROR', 'MATERIAL_TRANSFORM_RULE_MULTIPLIER_INVALID', `${label} multiplier 必须大于 0`);
    }
    if (rule.lossRate !== null && decimalToNumber(rule.lossRate) < 0) {
      addIssue('ERROR', 'MATERIAL_TRANSFORM_RULE_LOSS_RATE_INVALID', `${label} lossRate 不能小于 0`);
    }

    if (rule.customerId) {
      if (rule.customerScopeKey !== rule.customerId) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_RULE_CUSTOMER_SCOPE_KEY_MISMATCH', `${label} customerScopeKey 必须等于 customerId`);
      }
      if (!stringValue(rule.customerNameSnapshot)) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_RULE_CUSTOMER_SNAPSHOT_MISSING', `${label} 指定客户来源加工关系缺少 customerNameSnapshot`);
      }
    } else {
      if (rule.customerScopeKey !== 'ALL') {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_RULE_ALL_CUSTOMER_SCOPE_MISMATCH', `${label} 全部客户范围 customerScopeKey 必须为 ALL`);
      }
      if (rule.customerNameSnapshot !== null) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_RULE_ALL_CUSTOMER_SNAPSHOT_STALE', `${label} 全部客户范围不能保存 customerNameSnapshot`);
      }
    }

    const expectedProjectScopeKey = stringValue(rule.projectModel).toLocaleUpperCase() || 'ALL';
    if (rule.projectModelScopeKey !== expectedProjectScopeKey) {
      addIssue(
        'ERROR',
        'MATERIAL_TRANSFORM_RULE_PROJECT_SCOPE_KEY_MISMATCH',
        `${label} projectModelScopeKey=${rule.projectModelScopeKey}，应为 ${expectedProjectScopeKey}`
      );
    }
    const blankOptionalFields = [
      ['customerNameSnapshot', rule.customerNameSnapshot],
      ['projectModel', rule.projectModel],
      ['conversionDescription', rule.conversionDescription],
      ['defaultProcessRoute', rule.defaultProcessRoute],
      ['remark', rule.remark]
    ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
    if (blankOptionalFields.length > 0) {
      addIssue('ERROR', 'MATERIAL_TRANSFORM_RULE_OPTIONAL_TEXT_BLANK', `${label} 可选文本不能保存空字符串：${blankOptionalFields.map(([field]) => field).join(', ')}`);
    }

    if (rule.status === CommonStatus.ENABLED && (rule.sourceMaterial.status !== CommonStatus.ENABLED || rule.targetMaterial.status !== CommonStatus.ENABLED)) {
      addIssue(
        'ERROR',
        'MATERIAL_TRANSFORM_RULE_DISABLED_MATERIAL_ENABLED',
        `${label} 引用了停用零件但规则仍启用，请先启用零件或停用该来源加工关系`
      );
    }
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

function addIssue(level: IssueLevel, code: string, message: string) {
  issues.push({ level, code, message });
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

function draftReservationPriorityRows<
  T extends {
    id: string;
    createdAt: Date;
    order: { orderNo: string; createdAt: Date };
    orderLine?: { lineNo: number | null } | null;
  }
>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const orderTimeDiff = left.order.createdAt.getTime() - right.order.createdAt.getTime();
    if (orderTimeDiff !== 0) {
      return orderTimeDiff;
    }
    const orderNoDiff = left.order.orderNo.localeCompare(right.order.orderNo);
    if (orderNoDiff !== 0) {
      return orderNoDiff;
    }
    const lineNoDiff = (left.orderLine?.lineNo || 0) - (right.orderLine?.lineNo || 0);
    if (lineNoDiff !== 0) {
      return lineNoDiff;
    }
    const reservationTimeDiff = left.createdAt.getTime() - right.createdAt.getTime();
    if (reservationTimeDiff !== 0) {
      return reservationTimeDiff;
    }
    return left.id.localeCompare(right.id);
  });
}

function normalizeOrderNo(orderNo: string) {
  return orderNo.trim().toUpperCase();
}

function committedOrderNoSet(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return new Set<string>();
  }
  return new Set(
    value
      .map((item) => (typeof item === 'string' ? normalizeOrderNo(item) : ''))
      .filter(Boolean)
  );
}

function normalizeCaseInsensitiveKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() || '';
}

function normalizeComponentNo(value: string | null | undefined) {
  return value?.trim().toUpperCase() || '';
}

function isComponentNoRangeInvalid(value: string | null | undefined) {
  const componentNo = normalizeComponentNo(value);
  return /^C\d+$/i.test(componentNo) && !/^C(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2}|[1-9][0-9]{3})$/i.test(componentNo);
}

function sameText(left: string | null | undefined, right: string | null | undefined) {
  return (left?.trim() || '') === (right?.trim() || '');
}

function addUnitQuantity(target: Map<string, number>, unit: string | null | undefined, quantity: number) {
  const normalizedUnit = unit?.trim() || '件';
  target.set(normalizedUnit, roundQuantity((target.get(normalizedUnit) || 0) + quantity));
}

function addOrderUnitQuantity(target: Map<string, Map<string, number>>, orderNo: string, unit: string | null | undefined, quantity: number) {
  const unitMap = target.get(orderNo) || new Map<string, number>();
  addUnitQuantity(unitMap, unit, quantity);
  target.set(orderNo, unitMap);
}

function allUnitsReached(
  quantityByUnit: OrderQuantityByUnitRow[],
  field: 'totalQuantity' | 'totalProductionPlanQuantity',
  actualQuantityByUnit: Map<string, number>
) {
  const targets = quantityByUnit.filter((row) => Number(row[field] || 0) > 0);
  if (targets.length === 0) {
    return false;
  }
  return targets.every((row) => (actualQuantityByUnit.get(row.unit || '件') || 0) + quantityTolerance >= Number(row[field] || 0));
}

function toOrderQuantityByUnit(lines: Array<{ quantity: Prisma.Decimal; productionPlanQuantity: Prisma.Decimal; unit: string }>) {
  const unitMap = new Map<string, OrderQuantityByUnitRow>();
  for (const line of lines) {
    const unit = line.unit || '件';
    const row = unitMap.get(unit) || { unit, totalQuantity: 0, totalProductionPlanQuantity: 0 };
    row.totalQuantity = roundQuantity(row.totalQuantity + decimalToNumber(line.quantity));
    row.totalProductionPlanQuantity = roundQuantity(row.totalProductionPlanQuantity + decimalToNumber(line.productionPlanQuantity));
    unitMap.set(unit, row);
  }
  return Array.from(unitMap.values());
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
      unit: stringValue(row.unit) || current?.unit,
      compatibilityStatus: stringValue(row.compatibilityStatus) || current?.compatibilityStatus,
      manualConfirmedBy: stringValue(row.manualConfirmedBy) || current?.manualConfirmedBy,
      manualConfirmedAt: stringValue(row.manualConfirmedAt) || current?.manualConfirmedAt,
      manualConfirmRemark: stringValue(row.manualConfirmRemark) || current?.manualConfirmRemark
    });
  }
  return [...rows.values()];
}

function stockSourceRawRows(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [] as Record<string, unknown>[];
  }
  return value
    .filter((item) => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => item as Record<string, unknown>);
}

function stringValue(value: unknown) {
  return value ? String(value).trim() : '';
}

function isJsonRecord(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function selectedStockSourceQuantity(stockSourceSelections: Prisma.JsonValue | null | undefined) {
  return normalizeStockSourceSelections(stockSourceSelections).reduce((sum, source) => sum + source.quantity, 0);
}

function processSnapshotToSteps(value: Prisma.JsonValue | null | undefined): ProcessStepSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return { processName: item.trim(), processRemark: '' };
      }
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        processName: stringValue(row.processName),
        processRemark: stringValue(row.processRemark)
      };
    })
    .filter((step) => step.processName);
}

function splitDefaultProcessRoute(value?: string | null) {
  return String(value || '')
    .split(/(?:->|→|[、,，;；\n\r]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function processRowsToSteps(rows: Array<{ processName: string; processRemark?: string | null }>): ProcessStepSnapshot[] {
  return rows
    .map((row) => ({
      processName: row.processName.trim(),
      processRemark: row.processRemark?.trim() || ''
    }))
    .filter((step) => step.processName);
}

function processStepsSignature(steps: ProcessStepSnapshot[]) {
  return steps.map((step) => `${step.processName.trim()}::${step.processRemark?.trim() || ''}`).join('|');
}

function manualConfirmationComplete(source: StockSourceSelection) {
  return Boolean(
    source.manualConfirmedBy?.trim() &&
      source.manualConfirmedAt?.trim() &&
      !Number.isNaN(new Date(source.manualConfirmedAt).getTime()) &&
      source.manualConfirmRemark?.trim()
  );
}

function productionPlanOverrideComplete(line: {
  productionPlanOverrideByCode?: string | null;
  productionPlanOverrideByName?: string | null;
  productionPlanOverrideByRole?: string | null;
  productionPlanOverrideAt?: Date | string | null;
  productionPlanOverrideReason?: string | null;
}) {
  return Boolean(
    line.productionPlanOverrideByCode?.trim() &&
      line.productionPlanOverrideByName?.trim() &&
      line.productionPlanOverrideByRole?.trim() &&
      line.productionPlanOverrideAt &&
      !Number.isNaN(new Date(line.productionPlanOverrideAt).getTime()) &&
      line.productionPlanOverrideReason?.trim()
  );
}

function isSubmitPlanOperatorRole(role?: string | null) {
  const value = role || '';
  return /计划|下单|订单/.test(value) && !/车间|主任|技术|工艺/.test(value);
}

function sourceKey(orderLineId: string | null | undefined, batchId: string) {
  return `${orderLineId || 'NO_LINE'}__${batchId}`;
}

function requiredTextMatches(required?: string | null, actual?: string | null) {
  const normalizedRequired = String(required ?? '').trim().toLocaleLowerCase();
  if (!normalizedRequired) {
    return true;
  }
  return normalizedRequired === String(actual ?? '').trim().toLocaleLowerCase();
}

function requiredNumberMatches(required?: Prisma.Decimal | number | null, actual?: Prisma.Decimal | number | null) {
  const requiredNumber = decimalToNumber(required);
  if (!requiredNumber) {
    return true;
  }
  const actualNumber = decimalToNumber(actual);
  if (!actualNumber) {
    return false;
  }
  return Math.abs(requiredNumber - actualNumber) < quantityTolerance;
}

function sourceLineHasDirectStockDrawingInfo(sourceLine: any) {
  return Boolean(
    String(sourceLine?.drawingNo || '').trim() &&
      String(sourceLine?.drawingVersion || '').trim() &&
      String(sourceLine?.drawingFileUrl || '').trim()
  );
}

function resolveStockBatchSourceLine(batch: any, sourceTaskMap: Map<string, any>) {
  if (!batch) {
    return null;
  }
  const sourceTask = batch.sourceProductionTaskNo ? sourceTaskMap.get(batch.sourceProductionTaskNo) : null;
  return sourceTask?.orderLine || batch.productionTask?.orderLine || batch.sourceOrderLine || null;
}

function stockBatchMatchesOrderLine(line: any, batch: any, sourceTaskMap: Map<string, any>) {
  const sourceLine = resolveStockBatchSourceLine(batch, sourceTaskMap);
  if (!sourceLine) {
    return false;
  }
  return (
    sourceLineHasDirectStockDrawingInfo(sourceLine) &&
    requiredTextMatches(line.partCode, batch.partCode) &&
    requiredTextMatches(line.drawingNo, sourceLine.drawingNo) &&
    requiredTextMatches(line.drawingVersion, sourceLine.drawingVersion) &&
    requiredTextMatches(line.partSpecification, sourceLine.partSpecification) &&
    requiredNumberMatches(line.partThickness, sourceLine.partThickness)
  );
}

function stockBatchReservedQuantity(batch: any, currentOrderId?: string) {
  return roundQuantity(
    (batch.reservations || [])
      .filter((reservation: any) => !currentOrderId || reservation.orderId !== currentOrderId)
      .reduce((sum: number, reservation: any) => sum + decimalToNumber(reservation.quantity), 0)
  );
}

function stockBatchAvailableQuantity(batch: any, currentOrderId?: string) {
  return roundQuantity(Math.max(decimalToNumber(batch.quantity) - stockBatchReservedQuantity(batch, currentOrderId), 0));
}

function stockBatchCompatibilityRank(line: any, batch: any, sourceTaskMap: Map<string, any>) {
  const sourceLine = resolveStockBatchSourceLine(batch, sourceTaskMap);
  if (stockBatchMatchesOrderLine(line, batch, sourceTaskMap)) {
    return 0;
  }
  if (!sourceLine) {
    return 2;
  }
  return 1;
}

function stockSourceUsageOrderIssue(
  line: any,
  batch: any,
  sourceTaskMap: Map<string, any>,
  selectedSources: StockSourceSelection[],
  availableBatches: any[],
  currentOrderId?: string
) {
  const selectedQuantityMap = new Map(selectedSources.map((source) => [source.batchId, source.quantity]));
  const selectedOrderIndexMap = new Map(selectedSources.map((source, index) => [source.batchId, index]));
  const currentSelectedIndex = selectedOrderIndexMap.get(batch.id);
  const currentQuantity = stockBatchAvailableQuantity(batch, currentOrderId);
  const currentCompatibilityRank = stockBatchCompatibilityRank(line, batch, sourceTaskMap);
  const requiredQuantity =
    line.fulfillmentMode === OrderLineFulfillmentMode.REWORK ? decimalToNumber(line.productionPlanQuantity) : decimalToNumber(line.quantity);
  const smallerBatch = availableBatches
    .filter(
      (candidate) =>
        candidate.id !== batch.id &&
        candidate.unit === batch.unit &&
        String(candidate.partCode || '').trim().toLocaleLowerCase() === String(batch.partCode || '').trim().toLocaleLowerCase() &&
        stockBatchCompatibilityRank(line, candidate, sourceTaskMap) === currentCompatibilityRank
    )
    .sort((left, right) => stockBatchAvailableQuantity(left, currentOrderId) - stockBatchAvailableQuantity(right, currentOrderId))
    .find((candidate) => {
      const selectedQuantity = selectedQuantityMap.get(candidate.id) || 0;
      const candidateSelectedIndex = selectedOrderIndexMap.get(candidate.id);
      const candidateAvailableQuantity = stockBatchAvailableQuantity(candidate, currentOrderId);
      const expectedEarlierUseQuantity = Math.min(candidateAvailableQuantity, requiredQuantity || candidateAvailableQuantity);
      const smallerQuantity = candidateAvailableQuantity > 0 && candidateAvailableQuantity + quantityTolerance < currentQuantity;
      const notFullyUsed = selectedQuantity + quantityTolerance < expectedEarlierUseQuantity;
      const selectedAfterCurrent =
        currentSelectedIndex !== undefined && candidateSelectedIndex !== undefined && candidateSelectedIndex > currentSelectedIndex;
      return smallerQuantity && (notFullyUsed || selectedAfterCurrent);
    });
  return smallerBatch ? `未优先使用较小库存批次 ${smallerBatch.batchNo}` : '';
}

function stockSourceMissingOrderInfo(line: any) {
  return [
    !String(line.drawingNo || '').trim() ? '图号' : '',
    !String(line.drawingVersion || '').trim() ? '图纸版本' : '',
    !String(line.partSpecification || '').trim() ? '成品规格' : '',
    line.lineType !== 'COMPONENT' && decimalToNumber(line.partThickness) <= 0 ? '零件厚度' : ''
  ].filter(Boolean);
}

function directStockSourceMissingDrawingInfo(batch: any, sourceTaskMap: Map<string, any>) {
  const sourceLine = resolveStockBatchSourceLine(batch, sourceTaskMap);
  if (!sourceLine) {
    return ['图纸资料'];
  }
  return [
    !String(sourceLine.drawingNo || '').trim() ? '图号' : '',
    !String(sourceLine.drawingVersion || '').trim() ? '图纸版本' : '',
    !String(sourceLine.drawingFileUrl || '').trim() ? '图纸文件' : ''
  ].filter(Boolean);
}

function actualStockSourceNeedsManualConfirmation(line: any, batch: any, sourceTaskMap: Map<string, any>) {
  if (line.fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
    return (
      stockSourceMissingOrderInfo(line).length > 0 ||
      directStockSourceMissingDrawingInfo(batch, sourceTaskMap).length > 0 ||
      !stockBatchMatchesOrderLine(line, batch, sourceTaskMap)
    );
  }
  if (line.fulfillmentMode === OrderLineFulfillmentMode.REWORK) {
    return !stockBatchMatchesOrderLine(line, batch, sourceTaskMap);
  }
  return false;
}

async function checkMasterDataUniqueness() {
  const [customers, warehouses, locations] = await Promise.all([
    prisma.customer.findMany({
      select: { id: true, customerCode: true, customerName: true }
    }),
    prisma.warehouse.findMany({
      select: { id: true, warehouseCode: true, warehouseName: true, status: true }
    }),
    prisma.warehouseLocation.findMany({
      select: {
        id: true,
        warehouseId: true,
        locationCode: true,
        locationName: true,
        status: true,
        warehouse: { select: { warehouseCode: true, status: true } }
      }
    })
  ]);

  assertCaseInsensitiveUnique(
    customers.map((customer) => ({
      id: customer.id,
      value: customer.customerCode,
      label: `客户ID ${customer.customerCode}`
    })),
    'CUSTOMER_CODE_DUPLICATE',
    '客户ID'
  );
  assertCaseInsensitiveUnique(
    customers.map((customer) => ({
      id: customer.id,
      value: customer.customerName,
      label: `客户名称 ${customer.customerName}`
    })),
    'CUSTOMER_NAME_DUPLICATE',
    '客户名称'
  );
  assertCaseInsensitiveUnique(
    warehouses.map((warehouse) => ({
      id: warehouse.id,
      value: warehouse.warehouseCode,
      label: `仓库编码 ${warehouse.warehouseCode}`
    })),
    'WAREHOUSE_CODE_DUPLICATE',
    '仓库编码'
  );
  assertCaseInsensitiveUnique(
    locations.map((location) => ({
      id: location.id,
      value: `${location.warehouseId}__${location.locationCode}`,
      label: `仓库 ${location.warehouse.warehouseCode} / 库位编码 ${location.locationCode}`
    })),
    'LOCATION_CODE_DUPLICATE',
    '同一仓库内库位编码'
  );

  for (const warehouse of warehouses) {
    const normalized = warehouse.warehouseCode.trim().toUpperCase();
    const missingWarehouseFields = [
      ['warehouseCode', warehouse.warehouseCode],
      ['warehouseName', warehouse.warehouseName]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingWarehouseFields.length > 0) {
      addIssue('ERROR', 'WAREHOUSE_IDENTITY_MISSING', `仓库 ${warehouse.warehouseCode || warehouse.id} 缺少基础字段：${missingWarehouseFields.map(([field]) => field).join(', ')}`);
    }
    if (warehouse.warehouseCode !== normalized) {
      addIssue('ERROR', 'WAREHOUSE_CODE_NOT_NORMALIZED', `仓库编码 ${warehouse.warehouseCode} 未按大写规范保存，应为 ${normalized}`);
    }
  }

  for (const location of locations) {
    const normalized = location.locationCode.trim().toUpperCase();
    const missingLocationFields = [
      ['warehouseId', location.warehouseId],
      ['locationCode', location.locationCode],
      ['locationName', location.locationName]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingLocationFields.length > 0) {
      addIssue(
        'ERROR',
        'WAREHOUSE_LOCATION_IDENTITY_MISSING',
        `仓库 ${location.warehouse.warehouseCode} / 库位 ${location.locationCode || location.id} 缺少基础字段：${missingLocationFields.map(([field]) => field).join(', ')}`
      );
    }
    if (location.locationCode !== normalized) {
      addIssue(
        'ERROR',
        'LOCATION_CODE_NOT_NORMALIZED',
        `仓库 ${location.warehouse.warehouseCode} / 库位编码 ${location.locationCode} 未按大写规范保存，应为 ${normalized}`
      );
    }
    if (location.status === CommonStatus.ENABLED && location.warehouse.status !== CommonStatus.ENABLED) {
      addIssue('ERROR', 'WAREHOUSE_LOCATION_ENABLED_UNDER_DISABLED_WAREHOUSE', `仓库 ${location.warehouse.warehouseCode} 已停用，但库位 ${location.locationCode} 仍为 ENABLED`);
    }
  }
}

function assertCaseInsensitiveUnique(
  rows: Array<{ id: string; value: string | null | undefined; label: string }>,
  code: string,
  fieldName: string
) {
  const rowsByKey = new Map<string, Array<{ id: string; label: string }>>();
  for (const row of rows) {
    const key = normalizeCaseInsensitiveKey(row.value);
    if (!key) {
      addIssue('ERROR', `${code}_EMPTY`, `${fieldName} 存在空值：${row.label}`);
      continue;
    }
    const current = rowsByKey.get(key) || [];
    current.push({ id: row.id, label: row.label });
    rowsByKey.set(key, current);
  }

  for (const [key, matches] of rowsByKey) {
    if (matches.length > 1) {
      addIssue('ERROR', code, `${fieldName} 大小写不敏感重复：${key}，记录：${matches.map((match) => match.label).join('；')}`);
    }
  }
}

async function checkProcessMemoryData() {
  const [definitions, templates, bomLines, transformRules] = await Promise.all([
    prisma.processDefinition.findMany({
      select: {
        id: true,
        processName: true,
        processNameNormalized: true,
        searchText: true,
        remark: true,
        status: true
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
        remark: true,
        status: true
      },
      orderBy: { templateName: 'asc' }
    }),
    prisma.modelBomLine.findMany({
      where: { defaultProcessRoute: { not: null } },
      select: {
        defaultProcessRoute: true,
        partCodeSnapshot: true,
        bom: { select: { bomName: true } }
      },
      orderBy: [{ bom: { bomName: 'asc' } }, { sortOrder: 'asc' }]
    }),
    prisma.materialTransformRule.findMany({
      where: { defaultProcessRoute: { not: null } },
      select: {
        defaultProcessRoute: true,
        sourceMaterial: { select: { partCode: true } },
        targetMaterial: { select: { partCode: true } },
        customerNameSnapshot: true,
        projectModel: true
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    })
  ]);

  const enabledDefinitionNames = new Set(
    definitions.filter((definition) => definition.status === CommonStatus.ENABLED).map((definition) => definition.processNameNormalized)
  );

  assertCaseInsensitiveUnique(
    definitions.map((definition) => ({
      id: definition.id,
      value: definition.processNameNormalized,
      label: `标准工序 ${definition.processName}`
    })),
    'PROCESS_DEFINITION_NORMALIZED_DUPLICATE',
    '标准工序规范化名称'
  );
  assertCaseInsensitiveUnique(
    templates.map((template) => ({
      id: template.id,
      value: template.templateNameNormalized,
      label: `流程记忆 ${template.templateName}`
    })),
    'PROCESS_TEMPLATE_NORMALIZED_DUPLICATE',
    '流程记忆规范化名称'
  );

  for (const definition of definitions) {
    const label = `标准工序 ${definition.processName}`;
    const normalizedName = definition.processName.trim();
    const normalizedKey = normalizeSearchKeyword(normalizedName);
    const expectedSearchText = buildPinyinSearchText([definition.processName, definition.remark]);

    if (!normalizedName) {
      addIssue('ERROR', 'PROCESS_DEFINITION_NAME_EMPTY', `${label} 名称为空`);
    }
    if (definition.processName !== normalizedName) {
      addIssue('ERROR', 'PROCESS_DEFINITION_NAME_HAS_SPACES', `${label} 名称存在首尾空格`);
    }
    if (definition.remark !== null && definition.remark.trim() === '') {
      addIssue('ERROR', 'PROCESS_DEFINITION_OPTIONAL_TEXT_BLANK', `${label} 的 remark 只能为 null，不能保存空白字符串`);
    }
    if (!definition.searchText.trim()) {
      addIssue('ERROR', 'PROCESS_DEFINITION_SEARCH_TEXT_EMPTY', `${label} 的 searchText 为空，无法支持拼音搜索`);
    }
    if (definition.searchText !== definition.searchText.trim()) {
      addIssue('ERROR', 'PROCESS_DEFINITION_SEARCH_TEXT_HAS_SPACES', `${label} 的 searchText 存在首尾空格`);
    }
    if (definition.processNameNormalized !== normalizedKey) {
      addIssue(
        'ERROR',
        'PROCESS_DEFINITION_NORMALIZED_STALE',
        `${label} 的 processNameNormalized=${definition.processNameNormalized}，应为 ${normalizedKey}`
      );
    }
    if (definition.searchText !== expectedSearchText) {
      addIssue('ERROR', 'PROCESS_DEFINITION_SEARCH_TEXT_STALE', `${label} 的 searchText 未按当前拼音规则生成`);
    }
  }

  for (const template of templates) {
    const label = `流程记忆 ${template.templateName}`;
    const normalizedName = template.templateName.trim();
    const normalizedKey = normalizeSearchKeyword(normalizedName);
    const stepsIsArray = Array.isArray(template.steps);
    const steps = processSnapshotToSteps(template.steps);
    const stepKeys = new Set<string>();
    const expectedSearchText = buildPinyinSearchText([
      template.templateName,
      template.remark,
      ...steps.flatMap((step) => [step.processName, step.processRemark])
    ]);

    if (!normalizedName) {
      addIssue('ERROR', 'PROCESS_TEMPLATE_NAME_EMPTY', `${label} 名称为空`);
    }
    if (template.templateName !== normalizedName) {
      addIssue('ERROR', 'PROCESS_TEMPLATE_NAME_HAS_SPACES', `${label} 名称存在首尾空格`);
    }
    if (template.remark !== null && template.remark.trim() === '') {
      addIssue('ERROR', 'PROCESS_TEMPLATE_OPTIONAL_TEXT_BLANK', `${label} 的 remark 只能为 null，不能保存空白字符串`);
    }
    if (template.status === CommonStatus.DISABLED) {
      if (template.searchText !== '') {
        addIssue('ERROR', 'PROCESS_TEMPLATE_STATUS_SEARCH_MISMATCH', `${label} 已停用但 searchText 未清空，可能继续污染搜索结果`);
      }
      if (!template.templateNameNormalized.startsWith(`disabled:${template.id}:`)) {
        addIssue('ERROR', 'PROCESS_TEMPLATE_DISABLED_KEY_INVALID', `${label} 已停用但 templateNameNormalized 未释放为 disabled:${template.id}:*`);
      }
    } else {
      if (template.templateNameNormalized.startsWith('disabled:')) {
        addIssue('ERROR', 'PROCESS_TEMPLATE_ENABLED_KEY_DISABLED', `${label} 启用状态下仍使用 disabled:* 查重键`);
      }
      if (!template.searchText.trim()) {
        addIssue('ERROR', 'PROCESS_TEMPLATE_SEARCH_TEXT_EMPTY', `${label} 的 searchText 为空，无法支持拼音搜索`);
      }
      if (template.searchText !== template.searchText.trim()) {
        addIssue('ERROR', 'PROCESS_TEMPLATE_SEARCH_TEXT_HAS_SPACES', `${label} 的 searchText 存在首尾空格`);
      }
    }
    if (template.status === CommonStatus.ENABLED && template.templateNameNormalized !== normalizedKey) {
      addIssue(
        'ERROR',
        'PROCESS_TEMPLATE_NORMALIZED_STALE',
        `${label} 的 templateNameNormalized=${template.templateNameNormalized}，应为 ${normalizedKey}`
      );
    }
    if (!stepsIsArray) {
      addIssue('ERROR', 'PROCESS_TEMPLATE_STEPS_NOT_ARRAY', `${label} 的 steps 不是 JSON 数组`);
    }
    if (steps.length === 0) {
      addIssue('ERROR', 'PROCESS_TEMPLATE_STEPS_EMPTY', `${label} 没有任何工序步骤`);
    }
    if (template.status === CommonStatus.ENABLED && template.searchText !== expectedSearchText) {
      addIssue('ERROR', 'PROCESS_TEMPLATE_SEARCH_TEXT_STALE', `${label} 的 searchText 未按当前拼音规则生成`);
    }

    for (const [index, step] of steps.entries()) {
      const stepLabel = `${label} / 第 ${index + 1} 道 ${step.processName || '-'}`;
      const stepName = step.processName.trim();
      const stepKey = normalizeSearchKeyword(stepName);

      if (!stepName) {
        addIssue('ERROR', 'PROCESS_TEMPLATE_STEP_NAME_EMPTY', `${stepLabel} 工序名称为空`);
        continue;
      }
      if (step.processName !== stepName) {
        addIssue('ERROR', 'PROCESS_TEMPLATE_STEP_NAME_HAS_SPACES', `${stepLabel} 工序名称存在首尾空格`);
      }
      if (stepKeys.has(stepKey)) {
        addIssue('ERROR', 'PROCESS_TEMPLATE_STEP_DUPLICATE', `${stepLabel} 在同一流程记忆中重复`);
      }
      stepKeys.add(stepKey);
      if (!enabledDefinitionNames.has(stepKey)) {
        addIssue('ERROR', 'PROCESS_TEMPLATE_STEP_DEFINITION_MISSING', `${stepLabel} 没有对应的启用标准工序`);
      }
    }
  }

  for (const line of bomLines) {
    const label = `BOM ${line.bom.bomName} / ${line.partCodeSnapshot}`;
    const processKeys = new Set<string>();
    for (const processName of splitDefaultProcessRoute(line.defaultProcessRoute)) {
      const processKey = normalizeSearchKeyword(processName);
      if (processKeys.has(processKey)) {
        addIssue('ERROR', 'MODEL_BOM_DEFAULT_PROCESS_DUPLICATE', `${label} 默认工艺 ${processName} 在同一 BOM 行中重复`);
      }
      processKeys.add(processKey);
      if (!enabledDefinitionNames.has(processKey)) {
        addIssue('ERROR', 'MODEL_BOM_DEFAULT_PROCESS_DEFINITION_MISSING', `${label} 默认工艺 ${processName} 没有对应的启用标准工序`);
      }
    }
  }

  for (const rule of transformRules) {
    const scopeText = [rule.customerNameSnapshot, rule.projectModel].filter(Boolean).join(' / ') || '全部范围';
    const label = `来源加工关系 ${rule.sourceMaterial.partCode} -> ${rule.targetMaterial.partCode} / ${scopeText}`;
    const processKeys = new Set<string>();
    for (const processName of splitDefaultProcessRoute(rule.defaultProcessRoute)) {
      const processKey = normalizeSearchKeyword(processName);
      if (processKeys.has(processKey)) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_DEFAULT_PROCESS_DUPLICATE', `${label} 默认工艺 ${processName} 在同一来源加工关系中重复`);
      }
      processKeys.add(processKey);
      if (!enabledDefinitionNames.has(processKey)) {
        addIssue('ERROR', 'MATERIAL_TRANSFORM_DEFAULT_PROCESS_DEFINITION_MISSING', `${label} 默认工艺 ${processName} 没有对应的启用标准工序`);
      }
    }
  }
}

async function checkProductionOperators() {
  const operators = await prisma.productionOperator.findMany({
    orderBy: [{ accountId: 'asc' }]
  });

  if (operators.length === 0) {
    addIssue('ERROR', 'PRODUCTION_OPERATOR_EMPTY', '生产操作人员基础账号为空，无法支撑提交生产、确认生产和工序完成记录');
    return;
  }

  assertCaseInsensitiveUnique(
    operators.map((operator) => ({
      id: operator.id,
      value: operator.accountId,
      label: `生产操作人员 ${operator.accountId} / ${operator.name}`
    })),
    'PRODUCTION_OPERATOR_ACCOUNT_DUPLICATE',
    '生产操作人员账户ID'
  );

  const enabledOperators = operators.filter((operator) => operator.status === CommonStatus.ENABLED);
  if (enabledOperators.length === 0) {
    addIssue('ERROR', 'PRODUCTION_OPERATOR_ENABLED_EMPTY', '没有任何启用的生产操作人员');
  }

  for (const operator of operators) {
    const label = `生产操作人员 ${operator.accountId || '-'} / ${operator.name || '-'}`;
    const keywords = operator.keywords || [];

    if (!operator.accountId.trim()) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_ACCOUNT_EMPTY', `${label} accountId 为空`);
    }
    if (operator.accountId !== operator.accountId.trim()) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_ACCOUNT_HAS_SPACES', `${label} accountId 存在首尾空格`);
    }
    if (!operator.name.trim()) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_NAME_EMPTY', `${label} name 为空`);
    }
    if (operator.name !== operator.name.trim()) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_NAME_HAS_SPACES', `${label} name 存在首尾空格`);
    }
    if (!operator.role.trim()) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_ROLE_EMPTY', `${label} role 为空`);
    }
    if (operator.role !== operator.role.trim()) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_ROLE_HAS_SPACES', `${label} role 存在首尾空格`);
    }
    const blankOptionalOperatorFields = [
      ['pinyin', operator.pinyin],
      ['pinyinInitials', operator.pinyinInitials],
      ['idCardMasked', operator.idCardMasked]
    ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
    if (blankOptionalOperatorFields.length > 0) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_OPTIONAL_TEXT_BLANK', `${label} 可选文本不能保存空字符串：${blankOptionalOperatorFields.map(([field]) => field).join(', ')}`);
    }

    if (operator.idCardBound) {
      if (!operator.idCardMasked?.trim()) {
        addIssue('ERROR', 'PRODUCTION_OPERATOR_ID_CARD_MASK_MISSING', `${label} 已绑定身份证，但缺少 idCardMasked`);
      }
      if (operator.idCardMasked && /\d{8,}/.test(operator.idCardMasked)) {
        addIssue('ERROR', 'PRODUCTION_OPERATOR_ID_CARD_EXPOSED', `${label} idCardMasked 疑似暴露了连续完整身份证号码`);
      }
    } else if (operator.idCardMasked) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_ID_CARD_MASK_STALE', `${label} 未绑定身份证但仍保存 idCardMasked`);
    }

    if (operator.status !== CommonStatus.ENABLED) {
      continue;
    }

    if (!operator.pinyin?.trim()) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_PINYIN_MISSING', `${label} 启用状态下缺少 pinyin`);
    } else if (operator.pinyin !== normalizeSearchKeyword(operator.pinyin)) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_PINYIN_NOT_NORMALIZED', `${label} pinyin 未按小写无分隔符保存`);
    }

    if (!operator.pinyinInitials?.trim()) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_PINYIN_INITIALS_MISSING', `${label} 启用状态下缺少 pinyinInitials`);
    } else if (operator.pinyinInitials !== normalizeSearchKeyword(operator.pinyinInitials)) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_PINYIN_INITIALS_NOT_NORMALIZED', `${label} pinyinInitials 未按小写无分隔符保存`);
    }

    if (keywords.length === 0) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_KEYWORDS_EMPTY', `${label} 启用状态下缺少 keywords，姓名/角色/拼音搜索覆盖不足`);
    }

    for (const [index, keyword] of keywords.entries()) {
      if (!keyword.trim()) {
        addIssue('ERROR', 'PRODUCTION_OPERATOR_KEYWORD_EMPTY', `${label} keywords 第 ${index + 1} 项为空`);
      }
      if (keyword !== keyword.trim()) {
        addIssue('ERROR', 'PRODUCTION_OPERATOR_KEYWORD_HAS_SPACES', `${label} keywords 第 ${index + 1} 项存在首尾空格`);
      }
    }

    if (operator.pinyinInitials && !operatorMatchesProductionKeyword(operator, operator.pinyinInitials)) {
      addIssue('ERROR', 'PRODUCTION_OPERATOR_INITIALS_UNSEARCHABLE', `${label} 无法通过拼音首字母 ${operator.pinyinInitials} 搜索命中`);
    }
  }

  if (!enabledOperators.some((operator) => isSubmitPlanOperatorRole(operator.role))) {
    addIssue('ERROR', 'PRODUCTION_OPERATOR_PLANNER_MISSING', '缺少下单/计划类生产操作人员，草稿订单无法由正确角色提交生产');
  }
  if (!enabledOperators.some((operator) => /车间主任|车间主管|主任/.test(operator.role) && !/计划/.test(operator.role))) {
    addIssue('ERROR', 'PRODUCTION_OPERATOR_WORKSHOP_SUPERVISOR_MISSING', '缺少车间主任/车间主管类生产操作人员');
  }
  if (!enabledOperators.some((operator) => /技术|工艺/.test(operator.role))) {
    addIssue('ERROR', 'PRODUCTION_OPERATOR_TECHNICIAN_MISSING', '缺少技术/工艺类生产操作人员，后续工序维护角色无法落地');
  }
  if (!enabledOperators.some((operator) => /操作员/.test(operator.role))) {
    addIssue('ERROR', 'PRODUCTION_OPERATOR_WORKER_MISSING', '缺少一线操作员，工序完成记录无法选择执行人员');
  }

  const guShengJun = enabledOperators.find((operator) => operator.name === '顾胜钧');
  if (guShengJun && operatorMatchesProductionKeyword(guShengJun, 'zm')) {
    addIssue('ERROR', 'PRODUCTION_OPERATOR_CROSS_FIELD_MATCH', '操作人员搜索不应让关键字 zm 命中顾胜钧，避免跨字段拼接误匹配');
  }
}

function operatorMatchesProductionKeyword(operator: ProductionOperatorSearchRow, keyword: string) {
  const normalizedKeyword = normalizeSearchKeyword(keyword);
  if (!normalizedKeyword) {
    return true;
  }

  const tokens = [
    operator.accountId,
    operator.name,
    operator.role,
    operator.pinyin,
    operator.pinyinInitials,
    ...(operator.keywords || [])
  ]
    .filter(Boolean)
    .map((value) => normalizeSearchKeyword(String(value)))
    .filter(Boolean);

  return tokens.some((token) => token.includes(normalizedKeyword));
}

async function checkCustomerContacts() {
  const customers = await prisma.customer.findMany({
    include: {
      contacts: {
        where: { status: CommonStatus.ENABLED },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
      }
    },
    orderBy: { customerCode: 'asc' }
  });
  const disabledPrimaryContacts = await prisma.customerContact.findMany({
    where: { status: CommonStatus.DISABLED, isPrimary: true },
    include: { customer: { select: { customerCode: true, customerName: true } } }
  });
  const allContacts = await prisma.customerContact.findMany({
    include: { customer: { select: { customerCode: true, customerName: true } } },
    orderBy: [{ customerId: 'asc' }, { createdAt: 'asc' }]
  });

  for (const contact of disabledPrimaryContacts) {
    addIssue(
      'ERROR',
      'CUSTOMER_DISABLED_CONTACT_PRIMARY',
      `客户 ${contact.customer.customerName}（${contact.customer.customerCode}）存在已停用但仍标记主联系人的联系人 ${contact.contactName}`
    );
  }

  for (const contact of allContacts) {
    const label = `客户 ${contact.customer.customerName}（${contact.customer.customerCode}）/ 联系人 ${contact.contactName || contact.id}`;
    const missingContactFields = [
      ['customerId', contact.customerId],
      ['contactName', contact.contactName]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingContactFields.length > 0) {
      addIssue('ERROR', 'CUSTOMER_CONTACT_IDENTITY_MISSING', `${label} 缺少联系人基础字段：${missingContactFields.map(([field]) => field).join(', ')}`);
    }
    const blankContactOptionalFields = [
      ['contactPhone', contact.contactPhone],
      ['title', contact.title],
      ['remark', contact.remark]
    ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
    if (blankContactOptionalFields.length > 0) {
      addIssue('ERROR', 'CUSTOMER_CONTACT_OPTIONAL_TEXT_BLANK', `${label} 可选文本不能保存空字符串：${blankContactOptionalFields.map(([field]) => field).join(', ')}`);
    }
    if (contact.status === CommonStatus.DISABLED && contact.isPrimary) {
      addIssue('ERROR', 'CUSTOMER_DISABLED_CONTACT_PRIMARY', `${label} 已停用但仍标记为主联系人`);
    }
  }

  for (const customer of customers) {
    const label = `${customer.customerName}（${customer.customerCode}）`;
    const primaryContacts = customer.contacts.filter((contact) => contact.isPrimary);
    const normalizedCustomerCode = customer.customerCode.trim();

    // 客户主表是下单和历史追溯快照来源，基础身份、地区和联系人快照不能保存空字符串。
    const missingCustomerFields = [
      ['customerCode', customer.customerCode],
      ['customerName', customer.customerName],
      ['country', customer.country]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingCustomerFields.length > 0) {
      addIssue('ERROR', 'CUSTOMER_IDENTITY_MISSING', `${label} 缺少客户基础字段：${missingCustomerFields.map(([field]) => field).join(', ')}`);
    }
    const blankCustomerOptionalFields = [
      ['contactName', customer.contactName],
      ['contactPhone', customer.contactPhone],
      ['address', customer.address],
      ['province', customer.province],
      ['state', customer.state],
      ['district', customer.district],
      ['city', customer.city],
      ['detailAddress', customer.detailAddress],
      ['remark', customer.remark]
    ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
    if (blankCustomerOptionalFields.length > 0) {
      addIssue('ERROR', 'CUSTOMER_OPTIONAL_TEXT_BLANK', `${label} 可选文本不能保存空字符串：${blankCustomerOptionalFields.map(([field]) => field).join(', ')}`);
    }
    if (!customer.contactName && customer.contactPhone) {
      addIssue('ERROR', 'CUSTOMER_CONTACT_SNAPSHOT_PHONE_WITHOUT_NAME', `${label} 主表保留了 contactPhone，但缺少 contactName`);
    }

    if (customer.customerCode !== normalizedCustomerCode) {
      addIssue('ERROR', 'CUSTOMER_CODE_HAS_SPACES', `${label} 的 customerCode 存在首尾空格`);
    }
    if (customer.customerName !== customer.customerName.trim()) {
      addIssue('ERROR', 'CUSTOMER_NAME_HAS_SPACES', `${label} 的 customerName 存在首尾空格`);
    }

    if (customer.regionType === CustomerRegionType.CHINA) {
      if (!customer.province?.trim() || !customer.city?.trim()) {
        addIssue('ERROR', 'CHINA_CUSTOMER_REGION_MISSING', `${label} 是中国客户，但缺少 province 或 city`);
      }
      if (!customer.country?.trim()) {
        addIssue('ERROR', 'CHINA_CUSTOMER_COUNTRY_MISSING', `${label} 是中国客户，但缺少 country`);
      }
    }

    if (customer.regionType === CustomerRegionType.OVERSEAS && !customer.country?.trim()) {
      addIssue('ERROR', 'OVERSEAS_CUSTOMER_COUNTRY_MISSING', `${label} 是国外客户，但缺少 country`);
    }

    if (customer.contacts.length === 0) {
      if (customer.status !== CommonStatus.DISABLED) {
        addIssue('ERROR', 'CUSTOMER_WITHOUT_CONTACT_ENABLED', `${label} 没有联系人，但客户状态不是 DISABLED`);
      }
      if (customer.contactName || customer.contactPhone) {
        addIssue('ERROR', 'CUSTOMER_WITHOUT_CONTACT_SNAPSHOT', `${label} 没有联系人，但仍保留 contactName 或 contactPhone 快照`);
      }
      continue;
    }

    if (primaryContacts.length !== 1) {
      addIssue('ERROR', 'CUSTOMER_PRIMARY_CONTACT_INVALID', `${label} 有 ${customer.contacts.length} 个联系人，但主联系人数量为 ${primaryContacts.length}`);
      continue;
    }

    const primary = primaryContacts[0];
    if (customer.contactName !== primary.contactName || (customer.contactPhone || null) !== (primary.contactPhone || null)) {
      addIssue('ERROR', 'CUSTOMER_CONTACT_SNAPSHOT_STALE', `${label} 的 contactName/contactPhone 与主联系人快照不一致`);
    }
  }
}

async function checkOrderNoReservations() {
  const [orders, reservations] = await Promise.all([
    prisma.customerOrder.findMany({
      select: { id: true, orderNo: true, customerCode: true, customerName: true, customerSnapshot: true }
    }),
    prisma.orderNoReservation.findMany({
      select: { id: true, orderNo: true, orderNoNormalized: true, sourceOrderId: true, reservedReason: true }
    })
  ]);

  const orderIds = new Set(orders.map((order) => order.id));
  const orderNoRows = new Map<string, string[]>();
  for (const order of orders) {
    const normalized = normalizeOrderNo(order.orderNo);
    // 订单主表快照必须可独立追溯，避免后续客户资料修改后历史订单失去可读身份。
    const missingOrderFields = [
      ['orderNo', order.orderNo],
      ['customerCode', order.customerCode],
      ['customerName', order.customerName]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingOrderFields.length > 0) {
      addIssue('ERROR', 'CUSTOMER_ORDER_IDENTITY_MISSING', `订单 ${order.orderNo || order.id} 缺少身份字段：${missingOrderFields.map(([field]) => field).join(', ')}`);
    }
    if (!isJsonRecord(order.customerSnapshot)) {
      addIssue('ERROR', 'CUSTOMER_ORDER_SNAPSHOT_INVALID', `订单 ${order.orderNo || order.id} 的 customerSnapshot 必须是对象快照`);
    }
    if (order.orderNo !== normalized) {
      addIssue('ERROR', 'ORDER_NO_NOT_NORMALIZED', `订单号 ${order.orderNo} 未按大写规范保存，应为 ${normalized}`);
    }
    const rows = orderNoRows.get(normalized) || [];
    rows.push(order.id);
    orderNoRows.set(normalized, rows);
  }

  for (const [normalized, rows] of orderNoRows) {
    if (rows.length > 1) {
      addIssue('ERROR', 'ORDER_NO_DUPLICATE', `订单号 ${normalized} 在 CustomerOrder 中重复 ${rows.length} 次`);
    }
  }

  const reservationByOrderNo = new Map(reservations.map((reservation) => [reservation.orderNoNormalized, reservation]));
  for (const order of orders) {
    const normalized = normalizeOrderNo(order.orderNo);
    const reservation = reservationByOrderNo.get(normalized);
    if (!reservation) {
      addIssue('ERROR', 'ORDER_NO_RESERVATION_MISSING', `订单 ${order.orderNo} 缺少 OrderNoReservation 永久占用记录`);
      continue;
    }
    if (reservation.sourceOrderId !== order.id) {
      addIssue(
        'ERROR',
        'ORDER_NO_RESERVATION_LINK',
        `订单 ${order.orderNo} 的 OrderNoReservation.sourceOrderId 与 CustomerOrder.id 不一致`
      );
    }
  }

  for (const reservation of reservations) {
    const normalized = normalizeOrderNo(reservation.orderNo);
    const reservationLabel = `订单号占用记录 ${reservation.orderNo || reservation.id}`;
    const allowedReservationReasons = new Set([
      'ORDER_CREATED',
      'ORDER_IMPORTED',
      'EXISTING_ORDER_RESERVED',
      'CANCELLED_ORDER_RESERVED',
      'DRAFT_ORDER_RENUMBERED',
      'SEED_ORDER_RESERVED',
      'SEED_DRAFT_STOCK_RESERVED',
      'SEED_STOCK_ORDER_RESERVED'
    ]);
    const missingReservationFields = [
      ['orderNo', reservation.orderNo],
      ['orderNoNormalized', reservation.orderNoNormalized],
      ['reservedReason', reservation.reservedReason]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingReservationFields.length > 0) {
      addIssue('ERROR', 'ORDER_NO_RESERVATION_IDENTITY_MISSING', `${reservationLabel} 缺少字段：${missingReservationFields.map(([field]) => field).join(', ')}`);
    }
    if (reservation.reservedReason !== reservation.reservedReason.trim()) {
      addIssue('ERROR', 'ORDER_NO_RESERVATION_REASON_HAS_SPACES', `${reservationLabel} reservedReason 存在首尾空格`);
    }
    if (!allowedReservationReasons.has(reservation.reservedReason)) {
      addIssue('ERROR', 'ORDER_NO_RESERVATION_REASON_INVALID', `${reservationLabel} reservedReason=${reservation.reservedReason} 不在允许范围内`);
    }
    if (reservation.orderNo !== normalized) {
      addIssue('ERROR', 'ORDER_NO_RESERVATION_ORDER_NO_NOT_NORMALIZED', `订单号占用记录 ${reservation.orderNo} 未按大写规范保存，应为 ${normalized}`);
    }
    if (reservation.orderNoNormalized !== normalized) {
      addIssue(
        'ERROR',
        'ORDER_NO_RESERVATION_NORMALIZED_MISMATCH',
        `订单号占用记录 ${reservation.orderNo} 的 orderNoNormalized=${reservation.orderNoNormalized}，应为 ${normalized}`
      );
    }
    if (reservation.sourceOrderId && !orderIds.has(reservation.sourceOrderId)) {
      addIssue('WARN', 'ORDER_NO_RESERVATION_ORPHAN', `订单号 ${reservation.orderNo} 占用记录指向的订单不存在`);
    }
  }
}

async function checkOrderLinePlans() {
  const lines = await prisma.orderLine.findMany({
    include: {
      order: { select: { id: true, orderNo: true, status: true } }
    },
    orderBy: [{ orderId: 'asc' }, { lineNo: 'asc' }]
  });
  const selectedSourcesByLineId = new Map(lines.map((line) => [line.id, normalizeStockSourceSelections(line.stockSourceSelections)]));
  const selectedBatchIds = [
    ...new Set(Array.from(selectedSourcesByLineId.values()).flatMap((sources) => sources.map((source) => source.batchId)))
  ];
  const batches = selectedBatchIds.length
    ? await prisma.inventoryBatch.findMany({
        where: { id: { in: selectedBatchIds } },
        include: {
          sourceOrderLine: true,
          productionTask: { include: { orderLine: true } },
          reservations: { where: { status: InventoryReservationStatus.ACTIVE } }
        }
      })
    : [];
  const stockCandidateKeys = new Map<string, { partCode: string; unit: string }>();
  for (const batch of batches) {
    const partCode = String(batch.partCode || '').trim();
    const unit = String(batch.unit || '').trim();
    if (!partCode || !unit) {
      continue;
    }
    stockCandidateKeys.set(`${partCode.toLocaleLowerCase()}__${unit.toLocaleLowerCase()}`, { partCode, unit });
  }
  const candidateBatches = stockCandidateKeys.size
    ? await prisma.inventoryBatch.findMany({
        where: {
          sourceOrderId: null,
          quantity: { gt: 0 },
          status: 'AVAILABLE',
          OR: [...stockCandidateKeys.values()].map((key) => ({
            partCode: { equals: key.partCode, mode: 'insensitive' },
            unit: key.unit
          }))
        },
        include: {
          sourceOrderLine: true,
          productionTask: { include: { orderLine: true } },
          reservations: { where: { status: InventoryReservationStatus.ACTIVE } }
        },
        orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }]
      })
    : [];
  const allStockBatches = [...new Map([...batches, ...candidateBatches].map((batch) => [batch.id, batch])).values()];
  const batchById = new Map(allStockBatches.map((batch) => [batch.id, batch]));
  const sourceTaskNos = [...new Set(allStockBatches.map((batch) => batch.sourceProductionTaskNo).filter(Boolean))] as string[];
  const sourceTasks = sourceTaskNos.length
    ? await prisma.productionTask.findMany({
        where: { productionTaskNo: { in: sourceTaskNos } },
        include: { orderLine: true }
      })
    : [];
  const sourceTaskMap = new Map(sourceTasks.map((task) => [task.productionTaskNo, task]));
  const productionOperators = await prisma.productionOperator.findMany({
    select: { accountId: true, name: true, role: true, status: true }
  });
  const productionOperatorByCode = new Map(
    productionOperators.map((operator) => [operator.accountId.trim().toLocaleLowerCase(), operator])
  );

  for (const line of lines) {
    const label = `${line.order.orderNo} / ${line.partCode} / line ${line.lineNo}`;
    const orderQuantity = decimalToNumber(line.quantity);
    const planQuantity = decimalToNumber(line.productionPlanQuantity);
    const suggestedPlanQuantity =
      line.productionPlanSuggestedQuantity === null || line.productionPlanSuggestedQuantity === undefined
        ? null
        : decimalToNumber(line.productionPlanSuggestedQuantity);
    const partThickness = decimalToNumber(line.partThickness);
    const selectedSources = selectedSourcesByLineId.get(line.id) || [];
    const selectedQuantity = selectedSources.reduce((sum, source) => sum + source.quantity, 0);
    const suggestedQuantity =
      line.fulfillmentMode === OrderLineFulfillmentMode.STOCK ? roundQuantity(Math.max(orderQuantity - selectedQuantity, 0)) : orderQuantity;
    const stockCoversCustomerQuantity =
      line.fulfillmentMode === OrderLineFulfillmentMode.STOCK &&
      suggestedQuantity <= quantityTolerance &&
      selectedQuantity + quantityTolerance >= orderQuantity;
    const staleFullStockPlanWithoutOverride =
      stockCoversCustomerQuantity && planQuantity > quantityTolerance && !productionPlanOverrideComplete(line);

    const missingLineFields = [
      ['partCode', line.partCode],
      ['partName', line.partName],
      ['unit', line.unit],
      ['lineType', line.lineType]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingLineFields.length > 0) {
      addIssue('ERROR', 'ORDER_LINE_IDENTITY_MISSING', `${label} 缺少订单明细身份字段：${missingLineFields.map(([field]) => field).join(', ')}`);
    }
    if (line.lineNo <= 0) {
      addIssue('ERROR', 'ORDER_LINE_LINE_NO_INVALID', `${label} lineNo 必须大于 0`);
    }
    if (orderQuantity <= 0) {
      addIssue('ERROR', 'ORDER_LINE_QUANTITY_INVALID', `${label} quantity 必须大于 0`);
    }
    if (planQuantity < 0) {
      addIssue('ERROR', 'ORDER_LINE_PLAN_NEGATIVE', `${label} productionPlanQuantity 不能为负数`);
    }
    if (suggestedPlanQuantity !== null && suggestedPlanQuantity < 0) {
      addIssue('ERROR', 'ORDER_LINE_SUGGESTION_NEGATIVE', `${label} productionPlanSuggestedQuantity 不能为负数`);
    }
    const isImportDraftMissingThickness =
      line.order.status === OrderStatus.DRAFT && Boolean(line.sourceImportSessionId) && line.lineType === 'PART' && partThickness === 0;
    if (line.lineType === 'PART' && partThickness <= 0 && !isImportDraftMissingThickness) {
      addIssue('ERROR', 'ORDER_LINE_PART_THICKNESS_MISSING', `${label} 零件行 partThickness 必须大于 0`);
    }
    if (line.lineType === 'COMPONENT' && partThickness !== 0) {
      addIssue('ERROR', 'ORDER_LINE_COMPONENT_THICKNESS_NOT_ZERO', `${label} 组件行 partThickness 必须为 0，厚度只核对子零件`);
    }
    const blankOptionalFields = [
      ['drawingNo', line.drawingNo],
      ['drawingVersion', line.drawingVersion],
      ['drawingFileName', line.drawingFileName],
      ['drawingFileUrl', line.drawingFileUrl],
      ['partSpecification', line.partSpecification],
      ['componentNo', line.componentNo],
      ['parentComponentNo', line.parentComponentNo],
      ['sourceImportSessionId', line.sourceImportSessionId],
      ['sourceImportFileId', line.sourceImportFileId],
      ['sourceImportFileName', line.sourceImportFileName],
      ['projectModel', line.projectModel],
      ['drawingStatus', line.drawingStatus],
      ['productionPlanOverrideByCode', line.productionPlanOverrideByCode],
      ['productionPlanOverrideByName', line.productionPlanOverrideByName],
      ['productionPlanOverrideByRole', line.productionPlanOverrideByRole],
      ['productionPlanOverrideReason', line.productionPlanOverrideReason]
    ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
    if (blankOptionalFields.length > 0) {
      addIssue('ERROR', 'ORDER_LINE_OPTIONAL_TEXT_BLANK', `${label} 可选文本字段不能保存空字符串：${blankOptionalFields.map(([field]) => field).join(', ')}`);
    }

    for (const rawSource of stockSourceRawRows(line.stockSourceSelections)) {
      const volatileFields = volatileStockSourceFields.filter((field) => Object.prototype.hasOwnProperty.call(rawSource, field));
      if (volatileFields.length > 0) {
        addIssue(
          'ERROR',
          'STOCK_SOURCE_VOLATILE_FIELDS_PERSISTED',
          `${label} 的 selectedStockSources 持久化了临时库存字段 ${volatileFields.join(', ')}，这些字段必须由接口实时计算`
        );
      }
    }

    if (orderQuantity < 0 || planQuantity < 0) {
      addIssue('ERROR', 'NEGATIVE_ORDER_QUANTITY', `${label} 存在负数订单数量或生产计划数量`);
    }

    if (line.productionPlanSuggestedQuantity !== null) {
      const storedSuggestedQuantity = decimalToNumber(line.productionPlanSuggestedQuantity);
      if (quantityDiffers(storedSuggestedQuantity, suggestedQuantity)) {
        addIssue(
          'WARN',
          'PLAN_SUGGESTION_STALE',
          `${label} 的 productionPlanSuggestedQuantity=${storedSuggestedQuantity}，当前建议值应为 ${suggestedQuantity}`
        );
      }
    }

    if (staleFullStockPlanWithoutOverride) {
      addIssue(
        'ERROR',
        'FULL_STOCK_LINE_PLAN_STALE',
        `${label} 已选库存覆盖客户订单数量，但 productionPlanQuantity=${planQuantity}，且没有生产计划偏差说明，应自动归零或补齐多做说明`
      );
    } else if (quantityDiffers(planQuantity, suggestedQuantity)) {
      if (!productionPlanOverrideComplete(line)) {
        addIssue(
          'ERROR',
          'PLAN_OVERRIDE_MISSING',
          `${label} 生产计划数量 ${planQuantity} 与建议数量 ${suggestedQuantity} 不一致，但缺少完整操作人员账号、姓名、岗位、时间或说明`
        );
      } else {
        const operatorCode = line.productionPlanOverrideByCode?.trim() || '';
        if (operatorCode.toLocaleUpperCase() !== historyBackfillOperatorCode) {
          const operator = productionOperatorByCode.get(operatorCode.toLocaleLowerCase());
          if (!operator) {
            addIssue('ERROR', 'PLAN_OVERRIDE_OPERATOR_MISSING', `${label} 生产计划偏差操作人员 ${operatorCode} 不存在`);
          } else if (operator.status !== CommonStatus.ENABLED) {
            addIssue('ERROR', 'PLAN_OVERRIDE_OPERATOR_DISABLED', `${label} 生产计划偏差操作人员 ${operatorCode} 已停用`);
          } else if (!isSubmitPlanOperatorRole(operator.role)) {
            addIssue(
              'ERROR',
              'PLAN_OVERRIDE_OPERATOR_ROLE_INVALID',
              `${label} 生产计划偏差操作人员 ${operatorCode} 的岗位为 ${operator.role}，必须是下单/计划管理人员`
            );
          } else if (line.productionPlanOverrideByName !== operator.name || line.productionPlanOverrideByRole !== operator.role) {
            addIssue(
              'ERROR',
              'PLAN_OVERRIDE_OPERATOR_SNAPSHOT_STALE',
              `${label} 生产计划偏差操作人员快照为 ${line.productionPlanOverrideByName || '-'} / ${line.productionPlanOverrideByRole || '-'}，当前账号 ${operatorCode} 应为 ${operator.name} / ${operator.role}`
            );
          }
        }
      }
    }

    if (line.fulfillmentMode === OrderLineFulfillmentMode.PRODUCTION && normalizeStockSourceSelections(line.stockSourceSelections).length > 0) {
      addIssue('ERROR', 'PRODUCTION_LINE_HAS_STOCK_SOURCES', `${label} 是 PRODUCTION，但仍保留 selectedStockSources`);
    }

    if (line.fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      if (selectedQuantity > orderQuantity + quantityTolerance) {
        addIssue('ERROR', 'STOCK_SOURCE_OVER_ORDER_QUANTITY', `${label} 已选库存 ${selectedQuantity} 超过客户订单数量 ${orderQuantity}`);
      }
      if (line.order.status !== OrderStatus.DRAFT && selectedQuantity <= 0) {
        addIssue('ERROR', 'PENDING_PRODUCTION_STOCK_LINE_NO_SOURCE', `${label} 已提交但没有 selectedStockSources`);
      }
    }

    if (line.fulfillmentMode === OrderLineFulfillmentMode.REWORK) {
      if (selectedQuantity > planQuantity + quantityTolerance) {
        addIssue('ERROR', 'REWORK_SOURCE_OVER_PLAN_QUANTITY', `${label} 已选库存 ${selectedQuantity} 超过生产计划领料数量 ${planQuantity}`);
      }
      if (line.order.status !== OrderStatus.DRAFT && selectedQuantity + quantityTolerance < planQuantity) {
        addIssue('ERROR', 'PENDING_PRODUCTION_REWORK_SOURCE_SHORTAGE', `${label} 已提交但库存再加工领料未选满`);
      }
    }

    for (const source of selectedSources) {
      if (!source.compatibilityStatus) {
        addIssue(
          'ERROR',
          'STOCK_SOURCE_REVIEW_STATUS_MISSING',
          `${label} 的库存批次 ${source.batchNo || source.batchId} 缺少 compatibilityStatus，必须重新打开库存来源并完成核对`
        );
      } else if (!stockCompatibilityStatuses.has(source.compatibilityStatus)) {
        addIssue(
          'ERROR',
          'STOCK_SOURCE_REVIEW_STATUS_INVALID',
          `${label} 的库存批次 ${source.batchNo || source.batchId} compatibilityStatus=${source.compatibilityStatus} 非法`
        );
      }
      if (source.compatibilityStatus && source.compatibilityStatus !== 'MATCHED' && !manualConfirmationComplete(source)) {
        addIssue('ERROR', 'STOCK_SOURCE_MANUAL_CONFIRMATION_MISSING', `${label} 的库存批次 ${source.batchNo || source.batchId} 缺少人工确认记录`);
      }
      const batch = batchById.get(source.batchId);
      if (!batch) {
        addIssue('ERROR', 'STOCK_SOURCE_BATCH_MISSING', `${label} 已选库存批次 ${source.batchNo || source.batchId} 不存在`);
        continue;
      }
      if (batch.unit !== line.unit) {
        addIssue('ERROR', 'STOCK_SOURCE_UNIT_MISMATCH', `${label} 已选库存批次 ${batch.batchNo} 单位 ${batch.unit} 与订单零件单位 ${line.unit} 不一致`);
      }
      if (batch.sourceOrderId) {
        addIssue(
          'ERROR',
          'STOCK_SOURCE_USES_ORDER_BOUND_BATCH',
          `${label} 已选库存批次 ${batch.batchNo} 是订单待发货库存，不能作为备货库存来源继续下单`
        );
      }
      if (line.order.status === OrderStatus.DRAFT) {
        if (batch.status !== 'AVAILABLE') {
          addIssue('ERROR', 'DRAFT_STOCK_SOURCE_BATCH_NOT_AVAILABLE', `${label} 已选库存批次 ${batch.batchNo} 状态为 ${batch.status}，草稿预占必须指向可用备货库存`);
        }
        if (decimalToNumber(batch.quantity) <= quantityTolerance) {
          addIssue('ERROR', 'DRAFT_STOCK_SOURCE_BATCH_EMPTY', `${label} 已选库存批次 ${batch.batchNo} 当前剩余为 ${decimalToNumber(batch.quantity)}，草稿预占不能指向空库存`);
        }
      }
      const actualNeedsManualConfirmation = actualStockSourceNeedsManualConfirmation(line, batch, sourceTaskMap);
      if (actualNeedsManualConfirmation && source.compatibilityStatus === 'MATCHED') {
        addIssue(
          'ERROR',
          'STOCK_SOURCE_COMPATIBILITY_STALE',
          `${label} 的库存批次 ${batch.batchNo} 实际需要人工确认，但 selectedStockSources 标记为 MATCHED`
        );
      }
      if (actualNeedsManualConfirmation && !manualConfirmationComplete(source)) {
        addIssue(
          'ERROR',
          'STOCK_SOURCE_ACTUAL_MANUAL_CONFIRMATION_MISSING',
          `${label} 的库存批次 ${batch.batchNo} 按真实库存来源核对需要人工确认，但缺少确认人员、时间或说明`
        );
      }
      if (line.order.status === OrderStatus.DRAFT) {
        const usageOrderIssue = stockSourceUsageOrderIssue(line, batch, sourceTaskMap, selectedSources, allStockBatches, line.order.id);
        if (usageOrderIssue && !manualConfirmationComplete(source)) {
          addIssue(
            'ERROR',
            'STOCK_SOURCE_USAGE_ORDER_CONFIRMATION_MISSING',
            `${label} 的库存批次 ${batch.batchNo} ${usageOrderIssue}，但缺少人工确认说明`
          );
        }
      }
    }
  }
}

async function checkOrderLineProcessSteps() {
  const [lines, definitions] = await Promise.all([
    prisma.orderLine.findMany({
      include: {
        order: { select: { orderNo: true, status: true } },
        processSteps: { orderBy: { stepNo: 'asc' } }
      },
      orderBy: [{ orderId: 'asc' }, { lineNo: 'asc' }]
    }),
    prisma.processDefinition.findMany({
      where: { status: CommonStatus.ENABLED },
      select: { processNameNormalized: true }
    })
  ]);
  const enabledProcessKeys = new Set(definitions.map((definition) => definition.processNameNormalized));

  for (const line of lines) {
    const label = `${line.order.orderNo} / ${line.partCode} / line ${line.lineNo}`;
    const planQuantity = decimalToNumber(line.productionPlanQuantity);
    const rowSteps = processRowsToSteps(line.processSteps);
    const snapshotSteps = processSnapshotToSteps(line.processSnapshot);
    const requiresFinalizedProcess = line.order.status !== OrderStatus.DRAFT && line.order.status !== OrderStatus.CANCELLED;
    const shouldHaveProcessSteps = requiresFinalizedProcess && planQuantity > quantityTolerance;
    const processStepKeys = new Set<string>();

    if (shouldHaveProcessSteps && rowSteps.length === 0) {
      addIssue('ERROR', 'ORDER_LINE_PROCESS_STEPS_EMPTY', `${label} 需要生产，但没有保存任何订单零件工序明细`);
    }

    if (rowSteps.length > 0 && snapshotSteps.length === 0) {
      addIssue('ERROR', 'ORDER_LINE_PROCESS_SNAPSHOT_EMPTY', `${label} 已有工序明细，但 processSnapshot 为空`);
    }

    if (rowSteps.length > 0 && snapshotSteps.length > 0 && processStepsSignature(rowSteps) !== processStepsSignature(snapshotSteps)) {
      addIssue('ERROR', 'ORDER_LINE_PROCESS_SNAPSHOT_STALE', `${label} 的 processSnapshot 与 OrderLineProcessStep 明细不一致`);
    }

    for (const [index, step] of line.processSteps.entries()) {
      const expectedStepNo = index + 1;
      const stepLabel = `${label} / 第 ${expectedStepNo} 道 ${step.processName || '-'}`;
      const processName = step.processName.trim();

      if (step.stepNo !== expectedStepNo) {
        addIssue('ERROR', 'ORDER_LINE_PROCESS_STEP_NO_GAP', `${stepLabel} stepNo=${step.stepNo}，应连续保存为 ${expectedStepNo}`);
      }
      if (!processName) {
        addIssue('ERROR', 'ORDER_LINE_PROCESS_STEP_NAME_EMPTY', `${stepLabel} 工序名称为空`);
        continue;
      }
      const processKey = normalizeSearchKeyword(processName);
      if (processStepKeys.has(processKey)) {
        addIssue('ERROR', 'ORDER_LINE_PROCESS_STEP_DUPLICATE', `${stepLabel} 在同一订单零件中重复`);
      }
      processStepKeys.add(processKey);
      if (step.processName !== processName) {
        addIssue('ERROR', 'ORDER_LINE_PROCESS_STEP_NAME_HAS_SPACES', `${stepLabel} 工序名称存在首尾空格`);
      }
      if (!enabledProcessKeys.has(processKey)) {
        addIssue(
          requiresFinalizedProcess ? 'ERROR' : 'WARN',
          'ORDER_LINE_PROCESS_DEFINITION_MISSING',
          `${stepLabel} 没有对应的启用标准工序`
        );
      }
    }
  }
}

async function checkProductionTaskConsistency() {
  const [lines, definitions] = await Promise.all([
    prisma.orderLine.findMany({
      include: {
        order: { select: { orderNo: true, status: true } },
        processSteps: { orderBy: { stepNo: 'asc' } },
        productionTasks: {
          include: {
            processCompletions: {
              orderBy: { stepNo: 'asc' },
              include: {
                logs: { orderBy: { createdAt: 'asc' } }
              }
            },
            inventoryBatch: { select: { id: true, batchNo: true, quantity: true, status: true } }
          },
          orderBy: { productionTaskNo: 'asc' }
        },
        inventoryBatches: {
          select: {
            id: true,
            batchNo: true,
            sourceOrderId: true,
            sourceOrderLineId: true,
            status: true
          }
        }
      },
      orderBy: [{ orderId: 'asc' }, { lineNo: 'asc' }]
    }),
    prisma.processDefinition.findMany({
      where: { status: CommonStatus.ENABLED },
      select: { processNameNormalized: true }
    })
  ]);
  const enabledProcessKeys = new Set(definitions.map((definition) => definition.processNameNormalized));

  for (const line of lines) {
    const label = `${line.order.orderNo} / ${line.partCode} / line ${line.lineNo}`;
    const planQuantity = decimalToNumber(line.productionPlanQuantity);
    const shouldHaveProductionTask = line.order.status !== OrderStatus.DRAFT && line.order.status !== OrderStatus.CANCELLED && planQuantity > quantityTolerance;
    const activeProductionTasks = line.productionTasks.filter((task) => task.status !== ProductionStatus.CANCELLED);
    const normalTasks = activeProductionTasks.filter((task) => !task.isReplenishment);
    const lineSteps = processRowsToSteps(line.processSteps);
    const lineStepSignature = processStepsSignature(lineSteps);
    const selectedStockQuantity = normalizeStockSourceSelections(line.stockSourceSelections).reduce((sum, source) => sum + source.quantity, 0);
    const fullStockCoveredLine =
      line.fulfillmentMode === OrderLineFulfillmentMode.STOCK &&
      line.order.status !== OrderStatus.DRAFT &&
      line.order.status !== OrderStatus.CANCELLED &&
      selectedStockQuantity + quantityTolerance >= decimalToNumber(line.quantity) &&
      planQuantity <= quantityTolerance;

    if (shouldHaveProductionTask && normalTasks.length === 0) {
      addIssue('ERROR', 'PRODUCTION_TASK_MISSING', `${label} 已提交且生产计划数量为 ${planQuantity}，但没有普通 ProductionTask`);
    }

    if (line.order.status !== OrderStatus.DRAFT && line.order.status !== OrderStatus.CANCELLED && planQuantity <= quantityTolerance && normalTasks.length > 0) {
      addIssue('ERROR', 'ZERO_PLAN_HAS_NORMAL_TASK', `${label} 生产计划数量为 ${planQuantity}，但仍存在普通生产任务`);
    }

    if (
      fullStockCoveredLine &&
      !line.inventoryBatches.some((batch) => batch.sourceOrderId === line.orderId && batch.sourceOrderLineId === line.id)
    ) {
      addIssue(
        'ERROR',
        'FULL_STOCK_LINE_ORDER_BATCH_MISSING',
        `${label} 已全量使用库存且不需要生产，但没有转成该订单的待发货库存批次`
      );
    }

    if (shouldHaveProductionTask && lineSteps.length === 0) {
      addIssue('ERROR', 'ORDER_LINE_PROCESS_STEPS_MISSING', `${label} 需要生产，但没有 OrderLineProcessStep`);
    }

    const normalPlannedQuantity = normalTasks.reduce((sum, task) => sum + decimalToNumber(task.plannedQuantity), 0);
    if (normalTasks.length > 0 && quantityDiffers(normalPlannedQuantity, planQuantity)) {
      addIssue(
        'ERROR',
        'NORMAL_TASK_PLAN_MISMATCH',
        `${label} 普通生产任务计划数量合计 ${roundQuantity(normalPlannedQuantity)}，与订单行 productionPlanQuantity ${planQuantity} 不一致`
      );
    }

    for (const task of line.productionTasks) {
      const taskLabel = `${label} / ${task.productionTaskNo}`;
      const taskPlannedQuantity = decimalToNumber(task.plannedQuantity);
      const taskCompletedQuantity = decimalToNumber(task.completedQuantity);
      const taskSteps = processSnapshotToSteps(task.processSnapshot);
      const completionByStepNo = new Map(task.processCompletions.map((completion) => [completion.stepNo, completion] as const));
      const completedCompletions = task.processCompletions.filter((completion) => completion.isCompleted);

      if (taskPlannedQuantity <= 0) {
        addIssue('ERROR', 'PRODUCTION_TASK_NON_POSITIVE_PLAN', `${taskLabel} plannedQuantity 必须大于 0`);
      }
      if (taskCompletedQuantity < 0) {
        addIssue('ERROR', 'PRODUCTION_TASK_NEGATIVE_COMPLETED', `${taskLabel} completedQuantity 为负数`);
      }
      // 生产任务快照字段必须可独立追溯，避免历史订单、入库和通知只剩外键不可读。
      const missingIdentityFields = [
        ['productionTaskNo', task.productionTaskNo],
        ['orderNo', task.orderNo],
        ['customerName', task.customerName],
        ['partCode', task.partCode],
        ['partName', task.partName],
        ['unit', task.unit]
      ].filter(([, value]) => !String(value || '').trim());
      if (missingIdentityFields.length > 0) {
        addIssue('ERROR', 'PRODUCTION_TASK_IDENTITY_MISSING', `${taskLabel} 缺少生产任务快照字段：${missingIdentityFields.map(([field]) => field).join(', ')}`);
      }
      if (task.startedAt && task.completedAt && task.completedAt.getTime() < task.startedAt.getTime()) {
        addIssue('ERROR', 'PRODUCTION_TASK_COMPLETED_BEFORE_STARTED', `${taskLabel} completedAt 早于 startedAt`);
      }
      if (task.status === ProductionStatus.CANCELLED) {
        if (task.startedAt || task.completedAt || taskCompletedQuantity > quantityTolerance || completedCompletions.length > 0) {
          addIssue('ERROR', 'CANCELLED_TASK_HAS_PRODUCTION_PROGRESS', `${taskLabel} 已取消，但仍有生产开始、完成数量或工序完成记录`);
        }
        if (!task.remark?.trim()) {
          addIssue('ERROR', 'CANCELLED_TASK_REMARK_MISSING', `${taskLabel} 已取消，但缺少取消原因 remark`);
        }
        continue;
      }
      const taskProcessKeys = new Set<string>();
      for (const [stepIndex, step] of taskSteps.entries()) {
        const processKey = normalizeSearchKeyword(step.processName);
        const taskStepLabel = `${taskLabel} / processSnapshot 第 ${stepIndex + 1} 道 ${step.processName || '-'}`;
        if (taskProcessKeys.has(processKey)) {
          addIssue('ERROR', 'PRODUCTION_TASK_PROCESS_STEP_DUPLICATE', `${taskStepLabel} 在同一生产任务中重复`);
        }
        taskProcessKeys.add(processKey);
        if (!enabledProcessKeys.has(processKey)) {
          addIssue('ERROR', 'PRODUCTION_TASK_PROCESS_DEFINITION_MISSING', `${taskStepLabel} 没有对应的启用标准工序`);
        }
      }
      if (taskSteps.length === 0) {
        addIssue('ERROR', 'PRODUCTION_TASK_PROCESS_SNAPSHOT_EMPTY', `${taskLabel} 缺少 processSnapshot 工序快照`);
      }
      if (!task.isReplenishment && lineStepSignature && processStepsSignature(taskSteps) !== lineStepSignature) {
        addIssue('ERROR', 'PRODUCTION_TASK_PROCESS_SNAPSHOT_MISMATCH', `${taskLabel} 的 processSnapshot 与订单零件工序不一致`);
      }
      if (task.status === ProductionStatus.PENDING) {
        if (task.startedAt) {
          addIssue('ERROR', 'PENDING_TASK_HAS_STARTED_AT', `${taskLabel} 仍是 PENDING，但已经存在 startedAt`);
        }
        if (task.completedAt) {
          addIssue('ERROR', 'PENDING_TASK_HAS_COMPLETED_AT', `${taskLabel} 仍是 PENDING，但已经存在 completedAt`);
        }
        if (taskCompletedQuantity > quantityTolerance) {
          addIssue('ERROR', 'PENDING_TASK_HAS_COMPLETED_QUANTITY', `${taskLabel} 仍是 PENDING，但 completedQuantity=${taskCompletedQuantity}`);
        }
        if (completedCompletions.length > 0) {
          addIssue('ERROR', 'PENDING_TASK_HAS_COMPLETED_PROCESS', `${taskLabel} 仍是 PENDING，但已有已完成工序`);
        }
      }
      if (task.status === ProductionStatus.IN_PROGRESS) {
        if (!task.startedAt) {
          addIssue('ERROR', 'IN_PROGRESS_TASK_MISSING_STARTED_AT', `${taskLabel} 状态为 IN_PROGRESS，但缺少 startedAt`);
        }
        if (task.completedAt) {
          addIssue('ERROR', 'IN_PROGRESS_TASK_HAS_COMPLETED_AT', `${taskLabel} 状态为 IN_PROGRESS，但已经存在 completedAt`);
        }
      }
      if (task.status === ProductionStatus.WAITING_CONFIRMATION) {
        if (!task.startedAt) {
          addIssue('ERROR', 'WAITING_CONFIRMATION_TASK_MISSING_STARTED_AT', `${taskLabel} 状态为 WAITING_CONFIRMATION，但缺少 startedAt`);
        }
        if (task.completedAt) {
          addIssue('ERROR', 'WAITING_CONFIRMATION_TASK_HAS_COMPLETED_AT', `${taskLabel} 状态为 WAITING_CONFIRMATION，但已经存在 completedAt`);
        }
        if (taskCompletedQuantity > quantityTolerance) {
          addIssue('ERROR', 'WAITING_CONFIRMATION_TASK_HAS_COMPLETED_QUANTITY', `${taskLabel} 状态为 WAITING_CONFIRMATION，但 completedQuantity=${taskCompletedQuantity}`);
        }
        for (let stepNo = 1; stepNo <= taskSteps.length; stepNo += 1) {
          const completion = completionByStepNo.get(stepNo);
          if (!completion?.isCompleted) {
            addIssue('ERROR', 'WAITING_CONFIRMATION_TASK_PROCESS_INCOMPLETE', `${taskLabel} 待最终确认，但第 ${stepNo} 道工序没有确认完成`);
          }
        }
      }
      if (task.status === ProductionStatus.COMPLETED) {
        if (!task.startedAt) {
          addIssue('ERROR', 'COMPLETED_TASK_MISSING_STARTED_AT', `${taskLabel} 状态为 COMPLETED，但缺少 startedAt`);
        }
        if (!task.completedAt) {
          addIssue('ERROR', 'COMPLETED_TASK_MISSING_COMPLETED_AT', `${taskLabel} 状态为 COMPLETED，但缺少 completedAt`);
        }
        if (taskCompletedQuantity <= 0) {
          addIssue('ERROR', 'COMPLETED_TASK_ZERO_QUANTITY', `${taskLabel} 状态为 COMPLETED，但 completedQuantity 不大于 0`);
        }
        if (task.inventoryBatch) {
          // 已有入库批次的任务必须进入 STORED，避免待入库和已入库状态混用。
          addIssue('ERROR', 'COMPLETED_TASK_HAS_INVENTORY_BATCH', `${taskLabel} 状态为 COMPLETED，但已经关联入库批次，应回填为 STORED`);
        }
        for (let stepNo = 1; stepNo <= taskSteps.length; stepNo += 1) {
          const completion = completionByStepNo.get(stepNo);
          if (!completion?.isCompleted) {
            addIssue('ERROR', 'COMPLETED_TASK_PROCESS_INCOMPLETE', `${taskLabel} 已最终完成，但第 ${stepNo} 道工序没有确认完成`);
          }
        }
      }
      if (task.status === ProductionStatus.STORED) {
        if (!task.startedAt || !task.completedAt || taskCompletedQuantity <= 0) {
          addIssue('ERROR', 'STORED_TASK_FINAL_FIELDS_MISSING', `${taskLabel} 状态为 STORED，但生产开始、完成时间或完成数量不完整`);
        }
        if (!task.inventoryBatch) {
          addIssue('ERROR', 'STORED_TASK_MISSING_INVENTORY_BATCH', `${taskLabel} 状态为 STORED，但没有关联入库批次`);
        }
        for (let stepNo = 1; stepNo <= taskSteps.length; stepNo += 1) {
          const completion = completionByStepNo.get(stepNo);
          if (!completion?.isCompleted) {
            addIssue('ERROR', 'STORED_TASK_PROCESS_INCOMPLETE', `${taskLabel} 已入库，但第 ${stepNo} 道工序没有确认完成`);
          }
        }
      }
      for (const completion of task.processCompletions) {
        const completionQuantity = decimalToNumber(completion.completedQuantity);
        const expectedStep = taskSteps[completion.stepNo - 1];
        checkProductionProcessCompletionLogs(taskLabel, task.id, completion);
        if (completion.stepNo <= 0 || completion.stepNo > taskSteps.length) {
          addIssue('ERROR', 'PROCESS_COMPLETION_STEP_OUT_OF_RANGE', `${taskLabel} / ${completion.processName} stepNo=${completion.stepNo} 超出任务工序范围`);
        }
        if (expectedStep && expectedStep.processName !== completion.processName) {
          addIssue(
            'ERROR',
            'PROCESS_COMPLETION_STEP_NAME_MISMATCH',
            `${taskLabel} 第 ${completion.stepNo} 道工序记录为 ${completion.processName}，任务快照为 ${expectedStep.processName}`
          );
        }
        if (completionQuantity < 0) {
          addIssue('ERROR', 'PROCESS_COMPLETION_NEGATIVE_QUANTITY', `${taskLabel} / ${completion.processName} 完成数量为负数`);
        }
        if (completion.isCompleted && completionQuantity <= 0) {
          addIssue('ERROR', 'PROCESS_COMPLETION_ZERO_COMPLETED', `${taskLabel} / ${completion.processName} 已确认完成，但 completedQuantity 不大于 0`);
        }
        if (completion.isCompleted && !completion.completedAt) {
          addIssue('ERROR', 'PROCESS_COMPLETION_TIME_MISSING', `${taskLabel} / ${completion.processName} 已确认完成，但缺少 completedAt`);
        }
        if (!completion.isCompleted && completion.completedAt) {
          addIssue('WARN', 'PROCESS_COMPLETION_TIME_STALE', `${taskLabel} / ${completion.processName} 未完成，但仍存在 completedAt`);
        }
        if (completion.isCompleted) {
          for (let previousStepNo = 1; previousStepNo < completion.stepNo; previousStepNo += 1) {
            const previousCompletion = completionByStepNo.get(previousStepNo);
            if (!previousCompletion?.isCompleted) {
              addIssue(
                'ERROR',
                'PROCESS_COMPLETION_SKIPPED_PREVIOUS',
                `${taskLabel} 第 ${completion.stepNo} 道工序已完成，但第 ${previousStepNo} 道工序尚未完成`
              );
              break;
            }
          }
        }
        if (!taskSteps.some((step) => step.processName === completion.processName)) {
          addIssue('ERROR', 'PROCESS_COMPLETION_NOT_IN_TASK_SNAPSHOT', `${taskLabel} / ${completion.processName} 不在任务 processSnapshot 中`);
        }
      }
    }
  }
}

function checkProductionProcessCompletionLogs(taskLabel: string, productionTaskId: string, completion: any) {
  const logs = Array.isArray(completion.logs) ? completion.logs : [];
  for (const log of logs) {
    const logLabel = `${taskLabel} / ${completion.processName} / log ${log.id}`;
    // 工序完成日志是生产执行追溯链路，不能留下空动作或不可解析快照。
    const missingLogFields = [
      ['productionTaskId', log.productionTaskId],
      ['completionId', log.completionId],
      ['processName', log.processName],
      ['action', log.action]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingLogFields.length > 0) {
      addIssue('ERROR', 'PROCESS_COMPLETION_LOG_IDENTITY_MISSING', `${logLabel} 缺少日志身份字段：${missingLogFields.map(([field]) => field).join(', ')}`);
    }
    if (!processCompletionLogActions.has(log.action)) {
      addIssue('ERROR', 'PROCESS_COMPLETION_LOG_ACTION_INVALID', `${logLabel} action=${log.action} 不在允许的工序日志动作中`);
    }
    if (log.productionTaskId !== productionTaskId) {
      addIssue('ERROR', 'PROCESS_COMPLETION_LOG_TASK_MISMATCH', `${logLabel} productionTaskId 与所属 ProductionTask 不一致`);
    }
    if (log.completionId !== completion.id) {
      addIssue('ERROR', 'PROCESS_COMPLETION_LOG_COMPLETION_MISMATCH', `${logLabel} completionId 与所属 ProductionProcessCompletion 不一致`);
    }
    if (log.processName !== completion.processName) {
      addIssue('ERROR', 'PROCESS_COMPLETION_LOG_PROCESS_MISMATCH', `${logLabel} processName 与所属 ProductionProcessCompletion 不一致`);
    }
    if (!isJsonRecord(log.afterSnapshot)) {
      addIssue('ERROR', 'PROCESS_COMPLETION_LOG_AFTER_SNAPSHOT_INVALID', `${logLabel} afterSnapshot 必须是对象快照`);
    } else {
      const afterSnapshotProcessName = stringValue(log.afterSnapshot.processName);
      const afterSnapshotStepNo = Number(log.afterSnapshot.stepNo);
      if (!afterSnapshotProcessName || !Number.isFinite(afterSnapshotStepNo)) {
        addIssue('ERROR', 'PROCESS_COMPLETION_LOG_AFTER_SNAPSHOT_INCOMPLETE', `${logLabel} afterSnapshot 缺少 processName 或 stepNo`);
      }
      if (afterSnapshotProcessName && afterSnapshotProcessName !== log.processName) {
        addIssue('ERROR', 'PROCESS_COMPLETION_LOG_AFTER_PROCESS_MISMATCH', `${logLabel} afterSnapshot.processName 与日志 processName 不一致`);
      }
      if (Number.isFinite(afterSnapshotStepNo) && afterSnapshotStepNo > 0 && afterSnapshotStepNo !== completion.stepNo) {
        addIssue('ERROR', 'PROCESS_COMPLETION_LOG_AFTER_STEP_MISMATCH', `${logLabel} afterSnapshot.stepNo 与工序记录 stepNo 不一致`);
      }
    }
    if (log.beforeSnapshot !== null && !isJsonRecord(log.beforeSnapshot)) {
      addIssue('ERROR', 'PROCESS_COMPLETION_LOG_BEFORE_SNAPSHOT_INVALID', `${logLabel} beforeSnapshot 只能为空或对象快照`);
    }
  }
}

async function checkInventoryReservations() {
  const [batches, reservations] = await Promise.all([
    prisma.inventoryBatch.findMany({
      include: {
        reservations: {
          where: { status: InventoryReservationStatus.ACTIVE },
          include: {
            order: { select: { orderNo: true, status: true, createdAt: true } },
            orderLine: { select: { id: true, lineNo: true, stockSourceSelections: true } }
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        }
      },
      orderBy: { batchNo: 'asc' }
    }),
    prisma.inventoryReservation.findMany({
      include: {
        batch: { select: { batchNo: true, unit: true, status: true } },
        order: { select: { id: true, orderNo: true, status: true } },
        orderLine: { select: { id: true, orderId: true, lineNo: true, partCode: true, partName: true, unit: true } }
      },
      orderBy: [{ orderNo: 'asc' }, { createdAt: 'asc' }]
    })
  ]);

  const validInventoryBatchStatuses = new Set(['AVAILABLE', 'RESERVED', 'USED', 'SCRAPPED']);

  for (const batch of batches) {
    const batchQuantity = decimalToNumber(batch.quantity);
    const activeReservedQuantity = batch.reservations.reduce((sum, reservation) => sum + decimalToNumber(reservation.quantity), 0);

    if (!validInventoryBatchStatuses.has(String(batch.status))) {
      addIssue('ERROR', 'INVENTORY_BATCH_STATUS_INVALID', `库存批次 ${batch.batchNo} 状态 ${batch.status} 不在第一阶段允许范围内`);
    }
    if (batchQuantity < 0) {
      addIssue('ERROR', 'NEGATIVE_BATCH_QUANTITY', `库存批次 ${batch.batchNo} 当前剩余为负数 ${batchQuantity}`);
    }
    if (batch.status === 'AVAILABLE' && batchQuantity <= 0) {
      addIssue('WARN', 'AVAILABLE_ZERO_BATCH', `库存批次 ${batch.batchNo} 状态为 AVAILABLE，但当前剩余 ${batchQuantity}`);
    }
    if (batch.status === 'RESERVED' && batchQuantity <= 0) {
      addIssue('ERROR', 'RESERVED_BATCH_ZERO_QUANTITY', `库存批次 ${batch.batchNo} 状态为 RESERVED，但当前剩余 ${batchQuantity}`);
    }
    if (batch.status === 'RESERVED' && activeReservedQuantity <= quantityTolerance) {
      addIssue('ERROR', 'RESERVED_BATCH_WITHOUT_ACTIVE_RESERVATION', `库存批次 ${batch.batchNo} 状态为 RESERVED，但没有 ACTIVE 库存预占`);
    }
    if (batch.status === 'RESERVED' && batchQuantity > quantityTolerance && quantityDiffers(batchQuantity, activeReservedQuantity)) {
      addIssue(
        'ERROR',
        'RESERVED_BATCH_QUANTITY_MISMATCH',
        `库存批次 ${batch.batchNo} 状态为 RESERVED，当前剩余 ${batchQuantity}，ACTIVE 预占 ${roundQuantity(activeReservedQuantity)}，二者必须一致`
      );
    }
    if (batch.status === 'USED' && batchQuantity > quantityTolerance) {
      addIssue('WARN', 'USED_BATCH_HAS_QUANTITY', `库存批次 ${batch.batchNo} 状态为 USED，但当前剩余 ${batchQuantity}`);
    }
    if (batch.status === 'SCRAPPED' && batchQuantity > quantityTolerance) {
      addIssue('ERROR', 'SCRAPPED_BATCH_HAS_QUANTITY', `库存批次 ${batch.batchNo} 状态为 SCRAPPED，但当前剩余 ${batchQuantity}`);
    }
    if (activeReservedQuantity > batchQuantity + quantityTolerance) {
      addIssue(
        'ERROR',
        'ACTIVE_RESERVATION_OVER_BATCH',
        `库存批次 ${batch.batchNo} 当前剩余 ${batchQuantity}，ACTIVE 预占 ${roundQuantity(activeReservedQuantity)}，已超占`
      );
    }

    let remainingQuantityByPriority = roundQuantity(batchQuantity);
    for (const reservation of draftReservationPriorityRows(batch.reservations)) {
      const reservationQuantity = decimalToNumber(reservation.quantity);
      if (reservationQuantity > remainingQuantityByPriority + quantityTolerance) {
        const usedBefore = roundQuantity(batchQuantity - remainingQuantityByPriority);
        const lineText = reservation.orderLine?.lineNo ? ` / line ${reservation.orderLine.lineNo}` : '';
        addIssue(
          'ERROR',
          'DRAFT_RESERVATION_PRIORITY_OVER_AVAILABLE',
          `库存批次 ${batch.batchNo} 按草稿订单创建先后扣减后，${reservation.order.orderNo}${lineText} 需要 ${reservationQuantity}${batch.unit}，` +
            `前序草稿已占用 ${usedBefore}${batch.unit}，当前只剩 ${Math.max(remainingQuantityByPriority, 0)}${batch.unit}`
        );
      }
      remainingQuantityByPriority = roundQuantity(remainingQuantityByPriority - reservationQuantity);

      if (reservation.order.status !== OrderStatus.DRAFT) {
        addIssue(
          'ERROR',
          'ACTIVE_RESERVATION_NON_DRAFT_ORDER',
          `库存批次 ${batch.batchNo} 的 ACTIVE 预占仍挂在非草稿订单 ${reservation.order.orderNo}`
        );
      }
      if (reservation.unit !== batch.unit) {
        addIssue('ERROR', 'RESERVATION_UNIT_MISMATCH', `库存批次 ${batch.batchNo} 的预占单位 ${reservation.unit} 与库存单位 ${batch.unit} 不一致`);
      }
    }
  }

  for (const reservation of reservations) {
    const label = `库存预占 ${reservation.orderNo} / ${reservation.partCode} / ${reservation.batch.batchNo}`;
    const quantity = decimalToNumber(reservation.quantity);

    if (quantity <= 0) {
      addIssue('ERROR', 'RESERVATION_NON_POSITIVE', `${label} quantity 必须大于 0`);
    }
    // 库存预占快照必须能独立说明订单、零件和单位，避免批次或订单删除后失去追溯文字。
    const missingReservationFields = [
      ['orderNo', reservation.orderNo],
      ['partCode', reservation.partCode],
      ['partName', reservation.partName],
      ['unit', reservation.unit]
    ].filter(([, value]) => !String(value || '').trim());
    if (missingReservationFields.length > 0) {
      addIssue(
        'ERROR',
        'RESERVATION_IDENTITY_MISSING',
        `${label} 缺少库存预占快照字段：${missingReservationFields.map(([field]) => field).join(', ')}`
      );
    }
    if (reservation.orderNo !== reservation.order.orderNo) {
      addIssue('ERROR', 'RESERVATION_ORDER_NO_MISMATCH', `${label} 的 orderNo 与绑定订单不一致`);
    }
    if (reservation.unit !== reservation.batch.unit) {
      addIssue('ERROR', 'RESERVATION_BATCH_UNIT_MISMATCH', `${label} 的 unit 与库存批次单位 ${reservation.batch.unit} 不一致`);
    }

    if (reservation.orderLine) {
      if (reservation.orderLine.orderId !== reservation.order.id) {
        addIssue('ERROR', 'RESERVATION_LINE_ORDER_MISMATCH', `${label} 的 orderLineId 不属于绑定订单`);
      }
      if (normalizeCaseInsensitiveKey(reservation.partCode) !== normalizeCaseInsensitiveKey(reservation.orderLine.partCode)) {
        addIssue('ERROR', 'RESERVATION_LINE_PART_MISMATCH', `${label} 的 partCode 与订单零件不一致`);
      }
      if (!sameText(reservation.unit, reservation.orderLine.unit)) {
        addIssue('ERROR', 'RESERVATION_LINE_UNIT_MISMATCH', `${label} 的 unit 与订单零件单位不一致`);
      }
    }

    if (reservation.status === InventoryReservationStatus.ACTIVE) {
      if (reservation.order.status !== OrderStatus.DRAFT) {
        addIssue('ERROR', 'ACTIVE_RESERVATION_ORDER_NOT_DRAFT', `${label} 仍是 ACTIVE，但订单状态为 ${reservation.order.status}`);
      }
      if (reservation.consumedAt || reservation.releasedAt) {
        addIssue('ERROR', 'ACTIVE_RESERVATION_HAS_CLOSE_TIME', `${label} 仍是 ACTIVE，但已经存在 consumedAt 或 releasedAt`);
      }
    }

    if (reservation.status === InventoryReservationStatus.CONSUMED) {
      if (reservation.order.status === OrderStatus.DRAFT) {
        addIssue('ERROR', 'CONSUMED_RESERVATION_ORDER_DRAFT', `${label} 已 CONSUMED，但订单仍是 DRAFT`);
      }
      if (!reservation.consumedAt) {
        addIssue('ERROR', 'CONSUMED_RESERVATION_TIME_MISSING', `${label} 已 CONSUMED，但缺少 consumedAt`);
      }
      if (reservation.releasedAt) {
        addIssue('ERROR', 'CONSUMED_RESERVATION_HAS_RELEASE_TIME', `${label} 已 CONSUMED，但仍存在 releasedAt`);
      }
    }

    if (reservation.status === InventoryReservationStatus.RELEASED) {
      if (!reservation.releasedAt) {
        addIssue('ERROR', 'RELEASED_RESERVATION_TIME_MISSING', `${label} 已 RELEASED，但缺少 releasedAt`);
      }
      if (reservation.consumedAt) {
        addIssue('ERROR', 'RELEASED_RESERVATION_HAS_CONSUMED_TIME', `${label} 已 RELEASED，但仍存在 consumedAt`);
      }
      if (!reservation.statusReason?.trim()) {
        addIssue('WARN', 'RELEASED_RESERVATION_REASON_MISSING', `${label} 已 RELEASED，但缺少 statusReason`);
      }
    }
  }

  const draftOrders = await prisma.customerOrder.findMany({
    where: { status: OrderStatus.DRAFT },
    include: {
      lines: true,
      inventoryReservations: {
        where: { status: InventoryReservationStatus.ACTIVE }
      }
    }
  });

  for (const order of draftOrders) {
    const expected = new Map<string, number>();
    for (const line of order.lines) {
      if (line.fulfillmentMode !== OrderLineFulfillmentMode.STOCK && line.fulfillmentMode !== OrderLineFulfillmentMode.REWORK) {
        continue;
      }
      for (const source of normalizeStockSourceSelections(line.stockSourceSelections)) {
        const key = sourceKey(line.id, source.batchId);
        expected.set(key, roundQuantity((expected.get(key) || 0) + source.quantity));
      }
    }

    const actual = new Map<string, number>();
    for (const reservation of order.inventoryReservations) {
      const key = sourceKey(reservation.orderLineId, reservation.batchId);
      actual.set(key, roundQuantity((actual.get(key) || 0) + decimalToNumber(reservation.quantity)));
    }

    for (const [key, quantity] of expected) {
      const reservedQuantity = actual.get(key) || 0;
      if (quantityDiffers(quantity, reservedQuantity)) {
        addIssue('ERROR', 'DRAFT_RESERVATION_MISMATCH', `草稿订单 ${order.orderNo} 的库存来源 ${key} 应预占 ${quantity}，实际 ACTIVE 预占 ${reservedQuantity}`);
      }
    }

    for (const [key, quantity] of actual) {
      if (!expected.has(key)) {
        addIssue('ERROR', 'DRAFT_RESERVATION_STALE', `草稿订单 ${order.orderNo} 存在多余 ACTIVE 预占 ${key}，数量 ${quantity}`);
      }
    }
  }

  const submittedStockLines = await prisma.orderLine.findMany({
    where: {
      order: { status: { notIn: [OrderStatus.DRAFT, OrderStatus.CANCELLED] } },
      fulfillmentMode: { in: [OrderLineFulfillmentMode.STOCK, OrderLineFulfillmentMode.REWORK] }
    },
    include: {
      order: { select: { orderNo: true, status: true } },
      inventoryReservations: {
        where: { status: InventoryReservationStatus.CONSUMED }
      }
    },
    orderBy: [{ orderId: 'asc' }, { lineNo: 'asc' }]
  });

  for (const line of submittedStockLines) {
    const label = `${line.order.orderNo} / ${line.partCode} / line ${line.lineNo}`;
    const expected = new Map<string, number>();
    for (const source of normalizeStockSourceSelections(line.stockSourceSelections)) {
      const key = sourceKey(line.id, source.batchId);
      expected.set(key, roundQuantity((expected.get(key) || 0) + source.quantity));
    }

    const actual = new Map<string, number>();
    for (const reservation of line.inventoryReservations) {
      const key = sourceKey(reservation.orderLineId, reservation.batchId);
      actual.set(key, roundQuantity((actual.get(key) || 0) + decimalToNumber(reservation.quantity)));
    }

    if (expected.size === 0 && actual.size > 0) {
      addIssue('ERROR', 'CONSUMED_RESERVATION_WITHOUT_STOCK_SOURCE', `${label} 没有 selectedStockSources，但存在 CONSUMED 库存预占记录`);
    }

    for (const [key, quantity] of expected) {
      const consumedQuantity = actual.get(key) || 0;
      if (quantityDiffers(quantity, consumedQuantity)) {
        addIssue(
          'ERROR',
          'CONSUMED_RESERVATION_MISMATCH',
          `${label} 的库存来源 ${key} 已选 ${quantity}，实际 CONSUMED 预占 ${consumedQuantity}`
        );
      }
    }

    for (const [key, quantity] of actual) {
      if (!expected.has(key)) {
        addIssue('ERROR', 'CONSUMED_RESERVATION_STALE', `${label} 存在多余 CONSUMED 预占 ${key}，数量 ${quantity}`);
      }
    }
  }
}

async function checkInventoryTransactionBalances() {
  const [batches, orphanTransactions] = await Promise.all([
    prisma.inventoryBatch.findMany({
      include: {
        warehouse: { select: { id: true, warehouseCode: true } },
        location: { select: { id: true, locationCode: true } },
        transactions: {
          orderBy: { transactionTime: 'asc' },
          include: {
            warehouse: { select: { id: true, warehouseCode: true } },
            location: { select: { id: true, locationCode: true } }
          }
        }
      },
      orderBy: { batchNo: 'asc' }
    }),
    // InventoryTransaction.batchId 在 Prisma schema 中已是必填；这里用 raw SQL 保留数据库漂移检查。
    prisma.$queryRaw<Array<{ transactionNo: string }>>`
      SELECT "transactionNo"
      FROM "InventoryTransaction"
      WHERE "batchId" IS NULL
      ORDER BY "transactionNo" ASC
    `
  ]);

  for (const transaction of orphanTransactions) {
    addIssue('ERROR', 'INVENTORY_TRANSACTION_NO_BATCH', `库存流水 ${transaction.transactionNo} 没有关联 InventoryBatch`);
  }

  for (const batch of batches) {
    const batchQuantity = decimalToNumber(batch.quantity);
    if (!batch.warehouse) {
      addIssue('ERROR', 'INVENTORY_BATCH_WAREHOUSE_MISSING', `库存批次 ${batch.batchNo} 关联的仓库基础资料不存在`);
    }
    if (batch.locationId && !batch.location) {
      addIssue('ERROR', 'INVENTORY_BATCH_LOCATION_MISSING', `库存批次 ${batch.batchNo} 关联的库位基础资料不存在`);
    }
    if (batch.transactions.length === 0) {
      addIssue('ERROR', 'INVENTORY_BATCH_NO_TRANSACTION', `库存批次 ${batch.batchNo} 没有任何 InventoryTransaction 流水`);
      continue;
    }

    let ledgerQuantity = 0;
    for (const transaction of batch.transactions) {
      const transactionQuantity = decimalToNumber(transaction.quantity);
      if (!transaction.warehouse) {
        addIssue('ERROR', 'INVENTORY_TRANSACTION_WAREHOUSE_MISSING', `库存流水 ${transaction.transactionNo} 关联的仓库基础资料不存在`);
      }
      if (transaction.locationId && !transaction.location) {
        addIssue('ERROR', 'INVENTORY_TRANSACTION_LOCATION_MISSING', `库存流水 ${transaction.transactionNo} 关联的库位基础资料不存在`);
      }
      if (transactionQuantity <= 0) {
        addIssue('ERROR', 'INVENTORY_TRANSACTION_NON_POSITIVE', `库存流水 ${transaction.transactionNo} 数量必须大于 0`);
      }
      if (transaction.unit !== batch.unit) {
        addIssue('ERROR', 'INVENTORY_TRANSACTION_UNIT_MISMATCH', `库存流水 ${transaction.transactionNo} 单位 ${transaction.unit} 与批次 ${batch.batchNo} 单位 ${batch.unit} 不一致`);
      }
      if (normalizeCaseInsensitiveKey(transaction.partCode) !== normalizeCaseInsensitiveKey(batch.partCode)) {
        addIssue(
          'ERROR',
          'INVENTORY_TRANSACTION_PART_MISMATCH',
          `库存流水 ${transaction.transactionNo} 零件 ${transaction.partCode} 与批次 ${batch.batchNo} 零件 ${batch.partCode} 不一致`
        );
      }
      if (transaction.warehouseId !== batch.warehouseId) {
        addIssue('ERROR', 'INVENTORY_TRANSACTION_WAREHOUSE_MISMATCH', `库存流水 ${transaction.transactionNo} 仓库与批次 ${batch.batchNo} 当前仓库不一致`);
      }
      if ((transaction.locationId || null) !== (batch.locationId || null)) {
        addIssue('ERROR', 'INVENTORY_TRANSACTION_LOCATION_MISMATCH', `库存流水 ${transaction.transactionNo} 库位与批次 ${batch.batchNo} 当前库位不一致`);
      }

      ledgerQuantity += transaction.transactionType === 'IN' ? transactionQuantity : -transactionQuantity;
    }

    const roundedLedgerQuantity = roundQuantity(ledgerQuantity);
    if (quantityDiffers(roundedLedgerQuantity, batchQuantity)) {
      addIssue(
        'ERROR',
        'INVENTORY_BATCH_LEDGER_MISMATCH',
        `库存批次 ${batch.batchNo} 当前剩余 ${batchQuantity}，但流水 IN-OUT 计算为 ${roundedLedgerQuantity}`
      );
    }
  }
}

async function checkInventoryTransactionOrderLineLinks() {
  const orderLineSourceTypes = [
    'OrderLineSTOCK',
    'OrderLineREWORK',
    'OrderLineStockAllocation',
    'OrderCancellation',
    'OrderCancellationReleaseStock'
  ];
  const transactions = await prisma.inventoryTransaction.findMany({
    where: {
      OR: [
        {
          transactionType: 'OUT',
          sourceRecordType: 'InventoryBatch',
          orderNo: { not: null }
        },
        {
          sourceRecordType: { in: orderLineSourceTypes }
        }
      ]
    },
    include: {
      orderLine: {
        select: {
          id: true,
          orderId: true,
          partCode: true,
          partName: true,
          unit: true,
          order: { select: { orderNo: true } }
        }
      },
      batch: {
        select: {
          batchNo: true,
          sourceOrderId: true,
          sourceOrderLineId: true,
          partCode: true,
          partName: true,
          unit: true,
          sourceOrderNo: true,
          sourceOrderLine: {
            select: {
              id: true,
              orderId: true,
              partCode: true,
              partName: true,
              unit: true,
              order: { select: { orderNo: true } }
            }
          }
        }
      }
    },
    orderBy: { transactionNo: 'asc' }
  });

  for (const transaction of transactions) {
    const label = `库存流水 ${transaction.transactionNo}`;

    if (!transaction.orderLineId || !transaction.orderLine) {
      addIssue('ERROR', 'INVENTORY_TRANSACTION_ORDER_LINE_MISSING', `${label} 缺少有效 orderLineId，无法可靠计算订单发货状态`);
      continue;
    }

    if (orderLineSourceTypes.includes(transaction.sourceRecordType || '') && transaction.sourceRecordId !== transaction.orderLineId) {
      addIssue(
        'ERROR',
        'INVENTORY_TRANSACTION_ORDER_LINE_SOURCE_MISMATCH',
        `${label} 的 sourceRecordId 与 orderLineId 不一致，订单零件库存流水无法追溯`
      );
    }

    if (transaction.orderNo && normalizeOrderNo(transaction.orderNo) !== normalizeOrderNo(transaction.orderLine.order.orderNo)) {
      addIssue(
        'ERROR',
        'INVENTORY_TRANSACTION_ORDER_LINE_ORDER_MISMATCH',
        `${label} 的 orderNo=${transaction.orderNo} 与 orderLine 所属订单 ${transaction.orderLine.order.orderNo} 不一致`
      );
    }

    if (normalizeCaseInsensitiveKey(transaction.partCode) !== normalizeCaseInsensitiveKey(transaction.orderLine.partCode)) {
      addIssue(
        'ERROR',
        'INVENTORY_TRANSACTION_ORDER_LINE_PART_MISMATCH',
        `${label} 的 partCode=${transaction.partCode} 与 orderLine.partCode=${transaction.orderLine.partCode} 不一致`
      );
    }

    if (!sameText(transaction.unit, transaction.orderLine.unit)) {
      addIssue(
        'ERROR',
        'INVENTORY_TRANSACTION_ORDER_LINE_UNIT_MISMATCH',
        `${label} 的 unit=${transaction.unit} 与 orderLine.unit=${transaction.orderLine.unit} 不一致`
      );
    }

    if (transaction.batch?.sourceOrderLineId && transaction.batch.sourceOrderLineId !== transaction.orderLineId) {
      addIssue(
        'ERROR',
        'INVENTORY_TRANSACTION_ORDER_LINE_BATCH_MISMATCH',
        `${label} 发货的订单库存批次 ${transaction.batch.batchNo} 属于其他订单零件`
      );
    }

    if (transaction.batch?.sourceOrderLine && transaction.batch.sourceOrderLineId === transaction.orderLineId) {
      if (transaction.batch.sourceOrderLine.orderId !== transaction.orderLine.orderId) {
        addIssue('ERROR', 'INVENTORY_TRANSACTION_ORDER_LINE_BATCH_ORDER_MISMATCH', `${label} 的批次订单零件不属于同一订单`);
      }
      if (normalizeCaseInsensitiveKey(transaction.batch.partCode) !== normalizeCaseInsensitiveKey(transaction.orderLine.partCode)) {
        addIssue('ERROR', 'INVENTORY_TRANSACTION_ORDER_LINE_BATCH_PART_MISMATCH', `${label} 的批次零件编码与订单零件不一致`);
      }
      if (!sameText(transaction.batch.unit, transaction.orderLine.unit)) {
        addIssue('ERROR', 'INVENTORY_TRANSACTION_ORDER_LINE_BATCH_UNIT_MISMATCH', `${label} 的批次单位与订单零件单位不一致`);
      }
    }
  }
}

async function checkInventoryBatchSources() {
  const batches = await prisma.inventoryBatch.findMany({
    include: {
      sourceOrder: { select: { id: true, orderNo: true, customerName: true } },
      sourceOrderLine: { select: { id: true, orderId: true, partCode: true, partName: true, unit: true } },
      productionTask: {
        select: {
          id: true,
          productionTaskNo: true,
          orderId: true,
          orderLineId: true,
          orderNo: true,
          customerName: true,
          partCode: true,
          partName: true,
          unit: true
        }
      }
    },
    orderBy: { batchNo: 'asc' }
  });

  const sourceTaskNos = Array.from(new Set(batches.map((batch) => batch.sourceProductionTaskNo).filter(Boolean))) as string[];
  const sourceTasks = sourceTaskNos.length
    ? await prisma.productionTask.findMany({
        where: { productionTaskNo: { in: sourceTaskNos } },
        select: {
          id: true,
          productionTaskNo: true,
          orderId: true,
          orderLineId: true,
          orderNo: true,
          customerName: true,
          partCode: true,
          partName: true,
          unit: true
        }
      })
    : [];
  const sourceTaskByNo = new Map(sourceTasks.map((task) => [task.productionTaskNo, task]));
  const validSourceKinds = new Set(['NORMAL_ORDER', 'CANCELLED_ORDER', 'CUSTOMER_CHANGE']);

  for (const batch of batches) {
    const label = `库存批次 ${batch.batchNo}`;
    const sourceTask = batch.sourceProductionTaskNo ? sourceTaskByNo.get(batch.sourceProductionTaskNo) : null;

    if (!validSourceKinds.has(batch.sourceKind)) {
      addIssue('WARN', 'INVENTORY_BATCH_SOURCE_KIND_UNKNOWN', `${label} 的 sourceKind=${batch.sourceKind} 不是第一阶段已知来源类型`);
    }

    if (batch.sourceOrderId) {
      if (!batch.sourceOrder) {
        addIssue('ERROR', 'INVENTORY_BATCH_SOURCE_ORDER_MISSING', `${label} 绑定 sourceOrderId，但订单不存在`);
      } else {
        if (!batch.sourceOrderNo || normalizeOrderNo(batch.sourceOrderNo) !== normalizeOrderNo(batch.sourceOrder.orderNo)) {
          addIssue('ERROR', 'INVENTORY_BATCH_SOURCE_ORDER_NO_MISMATCH', `${label} 的 sourceOrderNo 与绑定订单号不一致`);
        }
        if (batch.sourceCustomerName && !sameText(batch.sourceCustomerName, batch.sourceOrder.customerName)) {
          addIssue('WARN', 'INVENTORY_BATCH_SOURCE_CUSTOMER_STALE', `${label} 的 sourceCustomerName 与绑定订单客户名称不一致`);
        }
      }

      if (!batch.sourceOrderLineId || !batch.sourceOrderLine) {
        addIssue('ERROR', 'INVENTORY_BATCH_SOURCE_LINE_MISSING', `${label} 是订单库存，但缺少 sourceOrderLineId 或订单零件不存在`);
      } else {
        if (batch.sourceOrderLine.orderId !== batch.sourceOrderId) {
          addIssue('ERROR', 'INVENTORY_BATCH_SOURCE_LINE_ORDER_MISMATCH', `${label} 的 sourceOrderLine 不属于绑定订单`);
        }
        if (normalizeCaseInsensitiveKey(batch.partCode) !== normalizeCaseInsensitiveKey(batch.sourceOrderLine.partCode)) {
          addIssue('ERROR', 'INVENTORY_BATCH_SOURCE_LINE_PART_MISMATCH', `${label} 的 partCode 与绑定订单零件不一致`);
        }
        if (!sameText(batch.unit, batch.sourceOrderLine.unit)) {
          addIssue('ERROR', 'INVENTORY_BATCH_SOURCE_LINE_UNIT_MISMATCH', `${label} 的 unit 与绑定订单零件不一致`);
        }
        if (!sameText(batch.partName, batch.sourceOrderLine.partName)) {
          addIssue('WARN', 'INVENTORY_BATCH_SOURCE_LINE_NAME_STALE', `${label} 的 partName 与绑定订单零件名称不一致`);
        }
      }
    } else if (batch.sourceOrderLineId) {
      addIssue('ERROR', 'STOCK_BATCH_HAS_ORDER_LINE_LINK', `${label} 是备货库存，但仍绑定 sourceOrderLineId`);
    }

    if (batch.productionTask) {
      if (!batch.sourceProductionTaskNo) {
        addIssue('ERROR', 'INVENTORY_BATCH_TASK_SOURCE_NO_MISSING', `${label} 绑定 productionTaskId，但缺少 sourceProductionTaskNo`);
      } else if (batch.sourceProductionTaskNo !== batch.productionTask.productionTaskNo) {
        addIssue('ERROR', 'INVENTORY_BATCH_TASK_SOURCE_NO_MISMATCH', `${label} 的 sourceProductionTaskNo 与 productionTaskId 指向任务不一致`);
      }
      if (normalizeCaseInsensitiveKey(batch.partCode) !== normalizeCaseInsensitiveKey(batch.productionTask.partCode)) {
        addIssue('ERROR', 'INVENTORY_BATCH_TASK_PART_MISMATCH', `${label} 的 partCode 与入库生产任务不一致`);
      }
      if (!sameText(batch.unit, batch.productionTask.unit)) {
        addIssue('ERROR', 'INVENTORY_BATCH_TASK_UNIT_MISMATCH', `${label} 的 unit 与入库生产任务不一致`);
      }
      if (!sameText(batch.partName, batch.productionTask.partName)) {
        addIssue('WARN', 'INVENTORY_BATCH_TASK_NAME_STALE', `${label} 的 partName 与入库生产任务零件名称不一致`);
      }
      if (batch.sourceOrderId && batch.sourceOrderId !== batch.productionTask.orderId) {
        addIssue('ERROR', 'INVENTORY_BATCH_TASK_ORDER_MISMATCH', `${label} 的 sourceOrderId 与入库生产任务订单不一致`);
      }
      if (batch.sourceOrderLineId && batch.sourceOrderLineId !== batch.productionTask.orderLineId) {
        addIssue('ERROR', 'INVENTORY_BATCH_TASK_LINE_MISMATCH', `${label} 的 sourceOrderLineId 与入库生产任务订单零件不一致`);
      }
    }

    if (batch.sourceProductionTaskNo && !sourceTask) {
      addIssue('ERROR', 'INVENTORY_BATCH_SOURCE_TASK_MISSING', `${label} 的 sourceProductionTaskNo=${batch.sourceProductionTaskNo} 找不到生产任务`);
    }

    if (!batch.sourceOrderId && sourceTask) {
      if (normalizeCaseInsensitiveKey(batch.partCode) !== normalizeCaseInsensitiveKey(sourceTask.partCode)) {
        addIssue('ERROR', 'STOCK_BATCH_SOURCE_TASK_PART_MISMATCH', `${label} 的 partCode 与来源生产任务不一致`);
      }
      if (!sameText(batch.unit, sourceTask.unit)) {
        addIssue('ERROR', 'STOCK_BATCH_SOURCE_TASK_UNIT_MISMATCH', `${label} 的 unit 与来源生产任务不一致`);
      }
      if (!sameText(batch.partName, sourceTask.partName)) {
        addIssue('WARN', 'STOCK_BATCH_SOURCE_TASK_NAME_STALE', `${label} 的 partName 与来源生产任务零件名称不一致`);
      }
    }

    if ((batch.sourceKind === 'CANCELLED_ORDER' || batch.sourceKind === 'CUSTOMER_CHANGE') && !batch.sourceOrderNo) {
      addIssue('ERROR', 'CHANGE_STOCK_SOURCE_ORDER_NO_MISSING', `${label} 是 ${batch.sourceKind} 来源库存，但缺少 sourceOrderNo`);
    }
  }
}

async function checkStockSourceConsumptionTransactions() {
  const submittedLines = await prisma.orderLine.findMany({
    where: {
      order: { status: { not: OrderStatus.DRAFT } },
      fulfillmentMode: { in: [OrderLineFulfillmentMode.STOCK, OrderLineFulfillmentMode.REWORK] }
    },
    include: {
      order: { select: { orderNo: true, status: true } }
    }
  });

  if (submittedLines.length === 0) {
    return;
  }

  const lineIds = submittedLines.map((line) => line.id);
  const transactions = await prisma.inventoryTransaction.findMany({
    where: {
      sourceRecordId: { in: lineIds },
      sourceRecordType: { in: ['OrderLineSTOCK', 'OrderLineREWORK', 'OrderLineStockAllocation'] }
    }
  });
  const transactionRowsByLine = new Map<string, typeof transactions>();
  for (const transaction of transactions) {
    const rows = transactionRowsByLine.get(transaction.sourceRecordId || '') || [];
    rows.push(transaction);
    transactionRowsByLine.set(transaction.sourceRecordId || '', rows);
  }

  for (const line of submittedLines) {
    const label = `${line.order.orderNo} / ${line.partCode} / line ${line.lineNo}`;
    const selectedSources = normalizeStockSourceSelections(line.stockSourceSelections);
    const selectedQuantity = selectedSources.reduce((sum, source) => sum + source.quantity, 0);
    const rows = transactionRowsByLine.get(line.id) || [];
    const stockOutRows = rows.filter((row) => row.transactionType === 'OUT' && row.sourceRecordType === `OrderLine${line.fulfillmentMode}`);
    const stockOutQuantity = stockOutRows.reduce((sum, row) => sum + decimalToNumber(row.quantity), 0);

    if (selectedQuantity > 0 && quantityDiffers(stockOutQuantity, selectedQuantity)) {
      addIssue(
        'ERROR',
        'STOCK_OUT_TRANSACTION_MISMATCH',
        `${label} 已选库存 ${selectedQuantity}，对应 OUT 流水合计 ${roundQuantity(stockOutQuantity)}`
      );
    }

    const selectedQuantityByBatchId = new Map<string, { batchNo: string; quantity: number }>();
    for (const source of selectedSources) {
      selectedQuantityByBatchId.set(source.batchId, {
        batchNo: source.batchNo || source.batchId,
        quantity: roundQuantity((selectedQuantityByBatchId.get(source.batchId)?.quantity || 0) + source.quantity)
      });
    }
    const stockOutQuantityByBatchId = new Map<string, number>();
    for (const row of stockOutRows) {
      const batchId = row.batchId || '';
      if (!batchId) {
        continue;
      }
      stockOutQuantityByBatchId.set(batchId, roundQuantity((stockOutQuantityByBatchId.get(batchId) || 0) + decimalToNumber(row.quantity)));
    }
    for (const [batchId, selected] of selectedQuantityByBatchId) {
      const outQuantity = stockOutQuantityByBatchId.get(batchId) || 0;
      if (quantityDiffers(outQuantity, selected.quantity)) {
        addIssue(
          'ERROR',
          'STOCK_OUT_TRANSACTION_BATCH_MISMATCH',
          `${label} 的库存批次 ${selected.batchNo} 已选 ${selected.quantity}，对应 OUT 流水逐批合计 ${outQuantity}`
        );
      }
    }
    for (const [batchId, outQuantity] of stockOutQuantityByBatchId) {
      if (!selectedQuantityByBatchId.has(batchId)) {
        addIssue('ERROR', 'STOCK_OUT_TRANSACTION_STALE_BATCH', `${label} 存在未在 selectedStockSources 中记录的 OUT 批次 ${batchId}，数量 ${outQuantity}`);
      }
    }

    if (line.fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      const stockInQuantity = rows
        .filter((row) => row.transactionType === 'IN' && row.sourceRecordType === 'OrderLineStockAllocation')
        .reduce((sum, row) => sum + decimalToNumber(row.quantity), 0);
      if (selectedQuantity > 0 && quantityDiffers(stockInQuantity, selectedQuantity)) {
        addIssue(
          'ERROR',
          'STOCK_ALLOCATION_IN_TRANSACTION_MISMATCH',
          `${label} 使用库存转订单待发货应有 IN 流水 ${selectedQuantity}，实际 ${roundQuantity(stockInQuantity)}`
        );
      }
    }
  }
}

async function checkProductionNotices() {
  const notices = await prisma.productionNotice.findMany({
    orderBy: [{ createdAt: 'asc' }, { noticeNo: 'asc' }]
  });

  if (notices.length === 0) {
    return;
  }

  const orderIds = Array.from(new Set(notices.map((notice) => notice.orderId).filter(Boolean))) as string[];
  const orderNos = Array.from(new Set(notices.map((notice) => normalizeOrderNo(notice.orderNo)).filter(Boolean)));
  const lineIds = Array.from(new Set(notices.map((notice) => notice.orderLineId).filter(Boolean))) as string[];
  const taskIds = Array.from(new Set(notices.map((notice) => notice.productionTaskId).filter(Boolean))) as string[];
  const taskNos = Array.from(new Set(notices.map((notice) => notice.productionTaskNo).filter(Boolean))) as string[];

  const [ordersByIdRows, ordersByNoRows, lines, tasksByIdRows, tasksByNoRows] = await Promise.all([
    orderIds.length
      ? prisma.customerOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNo: true, customerName: true, status: true }
        })
      : [],
    orderNos.length
      ? prisma.customerOrder.findMany({
          where: { orderNo: { in: orderNos } },
          select: { id: true, orderNo: true, customerName: true, status: true }
        })
      : [],
    lineIds.length
      ? prisma.orderLine.findMany({
          where: { id: { in: lineIds } },
          select: { id: true, orderId: true, partCode: true, partName: true, unit: true }
        })
      : [],
    taskIds.length
      ? prisma.productionTask.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, productionTaskNo: true, orderId: true, orderLineId: true, orderNo: true, partCode: true, partName: true, unit: true }
        })
      : [],
    taskNos.length
      ? prisma.productionTask.findMany({
          where: { productionTaskNo: { in: taskNos } },
          select: { id: true, productionTaskNo: true, orderId: true, orderLineId: true, orderNo: true, partCode: true, partName: true, unit: true }
        })
      : []
  ]);

  const orderById = new Map<string, NoticeOrderRow>(
    (ordersByIdRows as NoticeOrderRow[]).map((order) => [order.id, order] as const)
  );
  const orderByNo = new Map<string, NoticeOrderRow>(
    (ordersByNoRows as NoticeOrderRow[]).map((order) => [normalizeOrderNo(order.orderNo), order] as const)
  );
  const lineById = new Map<string, NoticeLineRow>((lines as NoticeLineRow[]).map((line) => [line.id, line] as const));
  const taskById = new Map<string, NoticeTaskRow>((tasksByIdRows as NoticeTaskRow[]).map((task) => [task.id, task] as const));
  const taskByNo = new Map<string, NoticeTaskRow>(
    (tasksByNoRows as NoticeTaskRow[]).map((task) => [task.productionTaskNo, task] as const)
  );

  for (const notice of notices) {
    const label = `通知 ${notice.noticeNo} / ${notice.noticeType} / ${notice.target}`;
    const order = notice.orderId ? orderById.get(notice.orderId) : orderByNo.get(normalizeOrderNo(notice.orderNo));
    const line = notice.orderLineId ? lineById.get(notice.orderLineId) : null;
    const task = notice.productionTaskId
      ? taskById.get(notice.productionTaskId)
      : notice.productionTaskNo
        ? taskByNo.get(notice.productionTaskNo)
        : null;

    if (!notice.reason?.trim()) {
      addIssue('ERROR', 'PRODUCTION_NOTICE_REASON_MISSING', `${label} 缺少 reason`);
    }
    if (!notice.noticeNo?.trim() || !notice.orderNo?.trim()) {
      addIssue('ERROR', 'PRODUCTION_NOTICE_IDENTITY_MISSING', `${label} 缺少 noticeNo 或 orderNo`);
    }
    const blankOptionalFields = [
      ['productionTaskNo', notice.productionTaskNo],
      ['partCode', notice.partCode],
      ['partName', notice.partName],
      ['unit', notice.unit],
      ['managerName', notice.managerName]
    ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
    if (blankOptionalFields.length > 0) {
      addIssue(
        'ERROR',
        'PRODUCTION_NOTICE_OPTIONAL_TEXT_BLANK',
        `${label} 存在空白快照字段：${blankOptionalFields.map(([field]) => field).join(', ')}`
      );
    }

    if (notice.status === ProductionNoticeStatus.ACKNOWLEDGED) {
      if (!notice.acknowledgedBy?.trim() || !notice.acknowledgedAt || Number.isNaN(new Date(notice.acknowledgedAt).getTime())) {
        addIssue('ERROR', 'PRODUCTION_NOTICE_ACK_MISSING', `${label} 已确认，但缺少 acknowledgedBy 或 acknowledgedAt`);
      }
    } else if (notice.acknowledgedBy || notice.acknowledgedAt) {
      addIssue('ERROR', 'PRODUCTION_NOTICE_PENDING_ACK_STALE', `${label} 仍是 PENDING，但已经存在确认人或确认时间`);
    }

    if (notice.orderId && !order) {
      addIssue('ERROR', 'PRODUCTION_NOTICE_ORDER_MISSING', `${label} 绑定 orderId，但订单不存在`);
    } else if (order && normalizeOrderNo(notice.orderNo) !== normalizeOrderNo(order.orderNo)) {
      addIssue('ERROR', 'PRODUCTION_NOTICE_ORDER_NO_MISMATCH', `${label} 的 orderNo 与绑定订单不一致`);
    } else if (!notice.orderId && !order) {
      addIssue('WARN', 'PRODUCTION_NOTICE_ORDER_LOOKUP_MISSING', `${label} 的 orderNo 找不到对应订单`);
    }

    if (notice.orderLineId) {
      if (!line) {
        addIssue('ERROR', 'PRODUCTION_NOTICE_LINE_MISSING', `${label} 绑定 orderLineId，但订单零件不存在`);
      } else {
        if (order && line.orderId !== order.id) {
          addIssue('ERROR', 'PRODUCTION_NOTICE_LINE_ORDER_MISMATCH', `${label} 的 orderLineId 不属于通知订单`);
        }
        if (notice.partCode && normalizeCaseInsensitiveKey(notice.partCode) !== normalizeCaseInsensitiveKey(line.partCode)) {
          addIssue('ERROR', 'PRODUCTION_NOTICE_LINE_PART_MISMATCH', `${label} 的 partCode 与订单零件不一致`);
        }
        if (notice.unit && !sameText(notice.unit, line.unit)) {
          addIssue('ERROR', 'PRODUCTION_NOTICE_LINE_UNIT_MISMATCH', `${label} 的 unit 与订单零件不一致`);
        }
        if (notice.partName && !sameText(notice.partName, line.partName)) {
          addIssue('WARN', 'PRODUCTION_NOTICE_LINE_NAME_STALE', `${label} 的 partName 与订单零件名称不一致`);
        }
      }
    }

    if (notice.productionTaskId || notice.productionTaskNo) {
      if (!task) {
        if (notice.noticeType !== 'TASK_WITHDRAWN') {
          addIssue('ERROR', 'PRODUCTION_NOTICE_TASK_MISSING', `${label} 绑定生产任务，但生产任务不存在`);
        }
      } else {
        if (notice.productionTaskNo && notice.productionTaskNo !== task.productionTaskNo) {
          addIssue('ERROR', 'PRODUCTION_NOTICE_TASK_NO_MISMATCH', `${label} 的 productionTaskNo 与绑定任务不一致`);
        }
        if (order && task.orderId !== order.id) {
          addIssue('ERROR', 'PRODUCTION_NOTICE_TASK_ORDER_MISMATCH', `${label} 的生产任务不属于通知订单`);
        }
        if (notice.orderLineId && task.orderLineId !== notice.orderLineId) {
          addIssue('ERROR', 'PRODUCTION_NOTICE_TASK_LINE_MISMATCH', `${label} 的生产任务不属于通知订单零件`);
        }
        if (notice.partCode && normalizeCaseInsensitiveKey(notice.partCode) !== normalizeCaseInsensitiveKey(task.partCode)) {
          addIssue('ERROR', 'PRODUCTION_NOTICE_TASK_PART_MISMATCH', `${label} 的 partCode 与生产任务不一致`);
        }
        if (notice.unit && !sameText(notice.unit, task.unit)) {
          addIssue('ERROR', 'PRODUCTION_NOTICE_TASK_UNIT_MISMATCH', `${label} 的 unit 与生产任务不一致`);
        }
      }
    }

    const noticeQuantityValues = [notice.beforeQuantity, notice.afterQuantity, notice.deltaQuantity];
    const hasNoticeQuantity = noticeQuantityValues.some((value) => value !== null);
    const hasCompleteNoticeQuantity = noticeQuantityValues.every((value) => value !== null);
    if (hasNoticeQuantity && !hasCompleteNoticeQuantity) {
      addIssue('ERROR', 'PRODUCTION_NOTICE_QUANTITY_FIELDS_INCOMPLETE', `${label} beforeQuantity、afterQuantity 和 deltaQuantity 必须同时存在或同时为空`);
    }
    if (hasCompleteNoticeQuantity) {
      const beforeQuantity = decimalToNumber(notice.beforeQuantity);
      const afterQuantity = decimalToNumber(notice.afterQuantity);
      const deltaQuantity = decimalToNumber(notice.deltaQuantity);
      if (beforeQuantity < 0 || afterQuantity < 0) {
        addIssue('ERROR', 'PRODUCTION_NOTICE_QUANTITY_NEGATIVE', `${label} beforeQuantity 或 afterQuantity 不能为负数`);
      }
      if (!notice.unit?.trim()) {
        addIssue('ERROR', 'PRODUCTION_NOTICE_QUANTITY_UNIT_MISSING', `${label} 写入数量变化时必须保留 unit`);
      }
      if (quantityDiffers(roundQuantity(afterQuantity - beforeQuantity), deltaQuantity)) {
        addIssue(
          'ERROR',
          'PRODUCTION_NOTICE_DELTA_MISMATCH',
          `${label} 的 beforeQuantity=${beforeQuantity}、afterQuantity=${afterQuantity} 与 deltaQuantity=${deltaQuantity} 不一致`
        );
      }
    }

    if (notice.handlingPlan !== null) {
      const handlingPlan = notice.handlingPlan as Record<string, unknown>;
      const handlingMode = String(handlingPlan?.handlingMode || '');
      const handlingQuantity = Number(handlingPlan?.handlingQuantity ?? 0);
      const plannedBy = String(handlingPlan?.plannedBy || '').trim();
      const plannedAt = String(handlingPlan?.plannedAt || '').trim();
      if (!handlingPlan || typeof handlingPlan !== 'object' || Array.isArray(handlingPlan)) {
        addIssue('ERROR', 'PRODUCTION_NOTICE_HANDLING_PLAN_INVALID', `${label} 的 handlingPlan 不是有效对象`);
      } else if (!['STOCK', 'SCRAP', 'NONE'].includes(handlingMode)) {
        addIssue('ERROR', 'PRODUCTION_NOTICE_HANDLING_PLAN_MODE_INVALID', `${label} 的 handlingPlan.handlingMode 不正确`);
      } else if ((handlingMode === 'STOCK' || handlingMode === 'SCRAP') && !(handlingQuantity > 0)) {
        addIssue('ERROR', 'PRODUCTION_NOTICE_HANDLING_PLAN_QUANTITY_INVALID', `${label} 转库存或报废时 handlingQuantity 必须大于 0`);
      } else if (handlingMode === 'NONE' && handlingQuantity !== 0) {
        addIssue('ERROR', 'PRODUCTION_NOTICE_HANDLING_PLAN_NONE_QUANTITY_INVALID', `${label} 无实物处理时 handlingQuantity 必须为 0`);
      }
      if (!plannedBy || !plannedAt || Number.isNaN(new Date(plannedAt).getTime())) {
        addIssue('ERROR', 'PRODUCTION_NOTICE_HANDLING_PLAN_OPERATOR_MISSING', `${label} 的 handlingPlan 缺少 plannedBy 或 plannedAt`);
      }
    } else if (notice.noticeType === 'ORDER_CANCELLED' && notice.reason.includes('取消处理计划')) {
      addIssue('ERROR', 'PRODUCTION_NOTICE_HANDLING_PLAN_MISSING', `${label} 写入了取消处理计划说明，但缺少 handlingPlan`);
    }
  }
}

async function checkProductionReplenishmentRequests() {
  const requests = await prisma.productionReplenishmentRequest.findMany({
    include: { processCompletion: true },
    orderBy: [{ createdAt: 'asc' }, { requestNo: 'asc' }]
  });

  if (requests.length === 0) {
    return;
  }

  const orderIds = Array.from(new Set(requests.map((request) => request.orderId).filter(Boolean))) as string[];
  const orderNos = Array.from(new Set(requests.map((request) => normalizeOrderNo(request.orderNo)).filter(Boolean)));
  const lineIds = Array.from(new Set(requests.map((request) => request.orderLineId).filter(Boolean))) as string[];
  const taskIds = Array.from(new Set(requests.map((request) => request.productionTaskId).filter(Boolean))) as string[];
  const taskNos = Array.from(
    new Set(requests.flatMap((request) => [request.productionTaskNo, request.replenishmentTaskNo]).filter(Boolean))
  ) as string[];

  const [ordersByIdRows, ordersByNoRows, lines, tasksByIdRows, tasksByNoRows] = await Promise.all([
    orderIds.length
      ? prisma.customerOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNo: true, customerName: true, status: true }
        })
      : [],
    orderNos.length
      ? prisma.customerOrder.findMany({
          where: { orderNo: { in: orderNos } },
          select: { id: true, orderNo: true, customerName: true, status: true }
        })
      : [],
    lineIds.length
      ? prisma.orderLine.findMany({
          where: { id: { in: lineIds } },
          select: { id: true, orderId: true, partCode: true, partName: true, unit: true }
        })
      : [],
    taskIds.length
      ? prisma.productionTask.findMany({
          where: { id: { in: taskIds } },
          select: {
            id: true,
            productionTaskNo: true,
            orderId: true,
            orderLineId: true,
            orderNo: true,
            partCode: true,
            partName: true,
            unit: true,
            plannedQuantity: true,
            status: true,
            inventoryBatch: { select: { id: true } },
            isReplenishment: true,
            sourceProductionTaskNo: true,
            replenishmentSourceType: true,
            replenishmentSourceRequestNo: true
          }
        })
      : [],
    taskNos.length
      ? prisma.productionTask.findMany({
          where: { productionTaskNo: { in: taskNos } },
          select: {
            id: true,
            productionTaskNo: true,
            orderId: true,
            orderLineId: true,
            orderNo: true,
            partCode: true,
            partName: true,
            unit: true,
            plannedQuantity: true,
            status: true,
            inventoryBatch: { select: { id: true } },
            isReplenishment: true,
            sourceProductionTaskNo: true,
            replenishmentSourceType: true,
            replenishmentSourceRequestNo: true
          }
        })
      : []
  ]);

  const orderById = new Map<string, NoticeOrderRow>(
    (ordersByIdRows as NoticeOrderRow[]).map((order) => [order.id, order] as const)
  );
  const orderByNo = new Map<string, NoticeOrderRow>(
    (ordersByNoRows as NoticeOrderRow[]).map((order) => [normalizeOrderNo(order.orderNo), order] as const)
  );
  const lineById = new Map<string, NoticeLineRow>((lines as NoticeLineRow[]).map((line) => [line.id, line] as const));
  const taskById = new Map<string, NoticeTaskRow>((tasksByIdRows as NoticeTaskRow[]).map((task) => [task.id, task] as const));
  const taskByNo = new Map<string, NoticeTaskRow>(
    (tasksByNoRows as NoticeTaskRow[]).map((task) => [task.productionTaskNo, task] as const)
  );
  const validStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED']);
  const pendingRequestKeys = new Map<string, string[]>();

  for (const request of requests) {
    const label = `生产报废补单申请 ${request.requestNo}`;
    const requestQuantity = decimalToNumber(request.requestQuantity);
    const scrapQuantity = decimalToNumber(request.scrapQuantity);
    const order = request.orderId ? orderById.get(request.orderId) : orderByNo.get(normalizeOrderNo(request.orderNo));
    const line = request.orderLineId ? lineById.get(request.orderLineId) : null;
    const task = request.productionTaskId
      ? taskById.get(request.productionTaskId)
      : request.productionTaskNo
        ? taskByNo.get(request.productionTaskNo)
        : null;
    const replenishmentTask = request.replenishmentTaskNo ? taskByNo.get(request.replenishmentTaskNo) : null;
    const completion = request.processCompletion;

    if (request.sourceType !== 'PRODUCTION_SCRAP') {
      addIssue('ERROR', 'REPLENISHMENT_SOURCE_TYPE_INVALID', `${label} 的 sourceType=${request.sourceType}，第一阶段生产补单必须是 PRODUCTION_SCRAP`);
    }
    if (!validStatuses.has(request.status)) {
      addIssue('ERROR', 'REPLENISHMENT_STATUS_INVALID', `${label} 的 status=${request.status} 不在 PENDING / APPROVED / REJECTED 内`);
    }
    const blankSnapshotFields = [
      ['requestNo', request.requestNo],
      ['sourceType', request.sourceType],
      ['status', request.status],
      ['orderNo', request.orderNo],
      ['productionTaskNo', request.productionTaskNo],
      ['partCode', request.partCode],
      ['partName', request.partName],
      ['unit', request.unit],
      ['reason', request.reason],
      ['requestedByCode', request.requestedByCode],
      ['requestedByName', request.requestedByName],
      ['supervisorName', request.supervisorName],
      ['supervisorRemark', request.supervisorRemark],
      ['replenishmentTaskNo', request.replenishmentTaskNo]
    ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
    if (blankSnapshotFields.length > 0) {
      addIssue(
        'ERROR',
        'REPLENISHMENT_IDENTITY_BLANK',
        `${label} 存在空白快照字段：${blankSnapshotFields.map(([field]) => field).join(', ')}`
      );
    }
    if (requestQuantity <= 0) {
      addIssue('ERROR', 'REPLENISHMENT_REQUEST_NON_POSITIVE', `${label} requestQuantity 必须大于 0`);
    }
    if (scrapQuantity <= 0) {
      addIssue('ERROR', 'REPLENISHMENT_SCRAP_NON_POSITIVE', `${label} scrapQuantity 必须大于 0`);
    }
    if (!request.reason?.trim()) {
      addIssue('ERROR', 'REPLENISHMENT_REASON_MISSING', `${label} 缺少 reason`);
    }
    if (!request.unit?.trim()) {
      addIssue('ERROR', 'REPLENISHMENT_UNIT_MISSING', `${label} 缺少 unit`);
    }

    if (request.status === 'PENDING') {
      const key = `${request.orderLineId || 'NO_LINE'}__${request.productionTaskNo || 'NO_TASK'}`;
      const rows = pendingRequestKeys.get(key) || [];
      rows.push(request.requestNo);
      pendingRequestKeys.set(key, rows);
    }

    if (!request.processCompletionId || !completion) {
      addIssue('ERROR', 'REPLENISHMENT_COMPLETION_MISSING', `${label} 缺少关联的 ProductionProcessCompletion`);
    } else {
      if (request.productionTaskId && completion.productionTaskId !== request.productionTaskId) {
        addIssue('ERROR', 'REPLENISHMENT_COMPLETION_TASK_MISMATCH', `${label} 的 processCompletion 不属于申请绑定的生产任务`);
      }
      if (!sameText(completion.unit, request.unit)) {
        addIssue('ERROR', 'REPLENISHMENT_COMPLETION_UNIT_MISMATCH', `${label} 的 unit 与工序完成表不一致`);
      }
      if (quantityDiffers(decimalToNumber(completion.shortageQuantity), requestQuantity)) {
        addIssue('ERROR', 'REPLENISHMENT_COMPLETION_SHORTAGE_MISMATCH', `${label} 的 requestQuantity 与工序完成表 shortageQuantity 不一致`);
      }
      if (quantityDiffers(decimalToNumber(completion.scrapQuantity), scrapQuantity)) {
        addIssue('ERROR', 'REPLENISHMENT_COMPLETION_SCRAP_MISMATCH', `${label} 的 scrapQuantity 与工序完成表 scrapQuantity 不一致`);
      }
    }

    if (request.orderId && !order) {
      addIssue('ERROR', 'REPLENISHMENT_ORDER_MISSING', `${label} 绑定 orderId，但订单不存在`);
    } else if (order && normalizeOrderNo(order.orderNo) !== normalizeOrderNo(request.orderNo)) {
      addIssue('ERROR', 'REPLENISHMENT_ORDER_NO_MISMATCH', `${label} 的 orderNo 与绑定订单不一致`);
    }

    if (!request.orderLineId || !line) {
      addIssue('ERROR', 'REPLENISHMENT_LINE_MISSING', `${label} 缺少订单零件或订单零件不存在`);
    } else {
      if (order && line.orderId !== order.id) {
        addIssue('ERROR', 'REPLENISHMENT_LINE_ORDER_MISMATCH', `${label} 的订单零件不属于绑定订单`);
      }
      if (normalizeCaseInsensitiveKey(request.partCode) !== normalizeCaseInsensitiveKey(line.partCode)) {
        addIssue('ERROR', 'REPLENISHMENT_LINE_PART_MISMATCH', `${label} 的 partCode 与订单零件不一致`);
      }
      if (!sameText(request.unit, line.unit)) {
        addIssue('ERROR', 'REPLENISHMENT_LINE_UNIT_MISMATCH', `${label} 的 unit 与订单零件不一致`);
      }
    }

    if (!request.productionTaskId || !request.productionTaskNo || !task) {
      addIssue('ERROR', 'REPLENISHMENT_TASK_MISSING', `${label} 缺少来源生产任务或来源生产任务不存在`);
    } else {
      if (request.productionTaskNo !== task.productionTaskNo) {
        addIssue('ERROR', 'REPLENISHMENT_TASK_NO_MISMATCH', `${label} 的 productionTaskNo 与绑定任务不一致`);
      }
      if (order && task.orderId !== order.id) {
        addIssue('ERROR', 'REPLENISHMENT_TASK_ORDER_MISMATCH', `${label} 的来源生产任务不属于绑定订单`);
      }
      if (request.orderLineId && task.orderLineId !== request.orderLineId) {
        addIssue('ERROR', 'REPLENISHMENT_TASK_LINE_MISMATCH', `${label} 的来源生产任务不属于绑定订单零件`);
      }
      if (normalizeCaseInsensitiveKey(request.partCode) !== normalizeCaseInsensitiveKey(task.partCode)) {
        addIssue('ERROR', 'REPLENISHMENT_TASK_PART_MISMATCH', `${label} 的 partCode 与来源生产任务不一致`);
      }
      if (!sameText(request.unit, task.unit)) {
        addIssue('ERROR', 'REPLENISHMENT_TASK_UNIT_MISMATCH', `${label} 的 unit 与来源生产任务不一致`);
      }
    }

    if (request.status === 'PENDING') {
      if (order?.status === OrderStatus.CANCELLED) {
        addIssue('ERROR', 'PENDING_REPLENISHMENT_ORDER_CANCELLED', `${label} 仍是 PENDING，但订单 ${order.orderNo} 已取消`);
      }
      if (order?.status === OrderStatus.COMPLETED) {
        addIssue('ERROR', 'PENDING_REPLENISHMENT_ORDER_COMPLETED', `${label} 仍是 PENDING，但订单 ${order.orderNo} 已完成发货`);
      }
      if (task?.inventoryBatch) {
        addIssue('ERROR', 'PENDING_REPLENISHMENT_TASK_RECEIVED', `${label} 仍是 PENDING，但来源任务 ${task.productionTaskNo} 已入库`);
      }
      if (request.replenishmentTaskNo || request.approvedAt || request.reviewedAt || request.supervisorName || request.supervisorRemark) {
        addIssue('ERROR', 'PENDING_REPLENISHMENT_REVIEW_FIELDS_STALE', `${label} 仍是 PENDING，但已经存在主管确认字段或补单任务号`);
      }
      if (completion && completion.shortageMode !== 'REPLENISHMENT_REQUEST') {
        addIssue('ERROR', 'PENDING_REPLENISHMENT_COMPLETION_MODE', `${label} 的工序完成表 shortageMode 应为 REPLENISHMENT_REQUEST`);
      }
      if (completion?.replenishmentTaskNo) {
        addIssue('ERROR', 'PENDING_REPLENISHMENT_COMPLETION_TASK_STALE', `${label} 仍是 PENDING，但工序完成表已经有 replenishmentTaskNo`);
      }
    }

    if (request.status === 'APPROVED') {
      if (!request.supervisorName?.trim() || !request.approvedAt || !request.reviewedAt || !request.replenishmentTaskNo) {
        addIssue('ERROR', 'APPROVED_REPLENISHMENT_REVIEW_FIELDS_MISSING', `${label} 已确认，但缺少主管、确认时间或补单任务号`);
      }
      if (!replenishmentTask) {
        addIssue('ERROR', 'APPROVED_REPLENISHMENT_TASK_MISSING', `${label} 已确认，但补单任务 ${request.replenishmentTaskNo || '-'} 不存在`);
      } else {
        if (!replenishmentTask.isReplenishment) {
          addIssue('ERROR', 'APPROVED_REPLENISHMENT_TASK_FLAG_MISSING', `${label} 的补单任务未标记 isReplenishment`);
        }
        if (replenishmentTask.sourceProductionTaskNo !== request.productionTaskNo) {
          addIssue('ERROR', 'APPROVED_REPLENISHMENT_TASK_SOURCE_MISMATCH', `${label} 的补单任务 sourceProductionTaskNo 与申请来源任务不一致`);
        }
        if (replenishmentTask.replenishmentSourceType !== 'PRODUCTION_SCRAP') {
          addIssue('ERROR', 'APPROVED_REPLENISHMENT_TASK_SOURCE_TYPE', `${label} 的补单任务 replenishmentSourceType 不是 PRODUCTION_SCRAP`);
        }
        if (replenishmentTask.replenishmentSourceRequestNo !== request.requestNo) {
          addIssue('ERROR', 'APPROVED_REPLENISHMENT_TASK_REQUEST_NO', `${label} 的补单任务 replenishmentSourceRequestNo 与申请单号不一致`);
        }
        if (quantityDiffers(decimalToNumber(replenishmentTask.plannedQuantity), requestQuantity)) {
          addIssue('ERROR', 'APPROVED_REPLENISHMENT_TASK_PLAN_MISMATCH', `${label} 的补单任务 plannedQuantity 与申请数量不一致`);
        }
      }
      if (completion && completion.shortageMode !== 'REPLENISHMENT') {
        addIssue('ERROR', 'APPROVED_REPLENISHMENT_COMPLETION_MODE', `${label} 已确认，但工序完成表 shortageMode 不是 REPLENISHMENT`);
      }
      if (completion && completion.replenishmentTaskNo !== request.replenishmentTaskNo) {
        addIssue('ERROR', 'APPROVED_REPLENISHMENT_COMPLETION_TASK_MISMATCH', `${label} 的工序完成表 replenishmentTaskNo 与申请不一致`);
      }
    }

    if (request.status === 'REJECTED') {
      if (!request.supervisorName?.trim() || !request.supervisorRemark?.trim() || !request.reviewedAt) {
        addIssue('ERROR', 'REJECTED_REPLENISHMENT_REVIEW_FIELDS_MISSING', `${label} 已驳回，但缺少主管、驳回说明或 reviewedAt`);
      }
      if (request.approvedAt || request.replenishmentTaskNo) {
        addIssue('ERROR', 'REJECTED_REPLENISHMENT_APPROVAL_FIELDS_STALE', `${label} 已驳回，但仍保留 approvedAt 或 replenishmentTaskNo`);
      }
      if (completion && completion.shortageMode === 'REPLENISHMENT_REQUEST') {
        addIssue('ERROR', 'REJECTED_REPLENISHMENT_COMPLETION_MODE', `${label} 已驳回，但工序完成表仍是 REPLENISHMENT_REQUEST`);
      }
    }
  }

  for (const [key, requestNos] of pendingRequestKeys) {
    if (requestNos.length > 1) {
      addIssue('ERROR', 'PENDING_REPLENISHMENT_DUPLICATE', `同一订单零件和来源任务存在多个 PENDING 生产报废补单申请 ${key}：${requestNos.join('，')}`);
    }
  }
}

async function checkProductionShortageResolutions() {
  const completions = await prisma.productionProcessCompletion.findMany({
    where: {
      OR: [
        { shortageQuantity: { gt: 0 } },
        { shortageMode: { not: null } },
        { shortageResolutionMode: { not: null } }
      ]
    },
    include: {
      productionTask: {
        select: {
          id: true,
          productionTaskNo: true,
          orderNo: true,
          orderLineId: true,
          partCode: true,
          partName: true,
          unit: true
        }
      }
    },
    orderBy: [{ completedAt: 'asc' }, { createdAt: 'asc' }]
  });

  if (completions.length === 0) {
    return;
  }

  const lineIds = Array.from(
    new Set(completions.map((completion) => completion.productionTask?.orderLineId).filter(Boolean))
  ) as string[];
  const replenishmentTasks = lineIds.length
    ? await prisma.productionTask.findMany({
        where: {
          orderLineId: { in: lineIds },
          isReplenishment: true
        },
        select: {
          orderLineId: true,
          productionTaskNo: true,
          replenishmentSourceType: true,
          status: true,
          completedQuantity: true,
          plannedQuantity: true,
          inventoryBatch: { select: { id: true } }
        }
      })
    : [];
  const orderChangeTaskNosByLineId = new Map<string, string[]>();
  const completedReplenishmentQuantityByLineId = new Map<string, number>();
  for (const task of replenishmentTasks) {
    if (!task.orderLineId) {
      continue;
    }
    if (task.replenishmentSourceType === 'ORDER_CHANGE') {
      const rows = orderChangeTaskNosByLineId.get(task.orderLineId) || [];
      rows.push(task.productionTaskNo);
      orderChangeTaskNosByLineId.set(task.orderLineId, rows);
    }

    const taskFinished = task.status === ProductionStatus.COMPLETED || task.status === ProductionStatus.STORED || Boolean(task.inventoryBatch);
    if (!taskFinished) {
      continue;
    }
    const quantity = roundQuantity(
      decimalToNumber(task.completedQuantity) > 0 ? decimalToNumber(task.completedQuantity) : decimalToNumber(task.plannedQuantity)
    );
    if (quantity <= 0) {
      continue;
    }
    completedReplenishmentQuantityByLineId.set(
      task.orderLineId,
      roundQuantity((completedReplenishmentQuantityByLineId.get(task.orderLineId) || 0) + quantity)
    );
  }

  const validShortageModes = new Set(['REPLENISHMENT_REQUEST', 'REPLENISHMENT', 'MANAGER_APPROVED']);
  const validResolutionModes = new Set(['ORDER_REPLENISHMENT', 'CUSTOMER_QUANTITY_CHANGED', 'NO_REPLENISHMENT']);
  const completedReplenishmentCoveredCompletionIds = new Set<string>();
  const completedReplenishmentRemainingByLineId = new Map(completedReplenishmentQuantityByLineId);
  for (const completion of completions) {
    const lineId = completion.productionTask?.orderLineId;
    const shortageQuantity = decimalToNumber(completion.shortageQuantity);
    if (
      !lineId ||
      completion.shortageResolutionMode ||
      completion.shortageMode !== 'MANAGER_APPROVED' ||
      shortageQuantity <= 0
    ) {
      continue;
    }
    const coveringQuantity = completedReplenishmentRemainingByLineId.get(lineId) || 0;
    if (coveringQuantity <= 0) {
      continue;
    }
    const usedQuantity = Math.min(shortageQuantity, coveringQuantity);
    completedReplenishmentRemainingByLineId.set(lineId, roundQuantity(coveringQuantity - usedQuantity));
    if (shortageQuantity - usedQuantity <= quantityTolerance) {
      completedReplenishmentCoveredCompletionIds.add(completion.id);
    }
  }

  for (const completion of completions) {
    const task = completion.productionTask;
    const shortageQuantity = decimalToNumber(completion.shortageQuantity);
    const label = `${task?.orderNo || '-'} / ${task?.productionTaskNo || '-'} / ${task?.partCode || '-'} / 第 ${completion.stepNo} 道 ${completion.processName}`;

    if (completion.shortageMode && !validShortageModes.has(completion.shortageMode)) {
      addIssue('ERROR', 'PRODUCTION_SHORTAGE_MODE_INVALID', `${label} 的 shortageMode=${completion.shortageMode} 无效`);
    }

    if (shortageQuantity <= 0 && completion.shortageMode) {
      addIssue('ERROR', 'PRODUCTION_SHORTAGE_MODE_WITHOUT_QUANTITY', `${label} 没有短缺数量，但写入了 shortageMode=${completion.shortageMode}`);
    }

    if (!completion.shortageResolutionMode) {
      if (shortageQuantity > 0 && completion.shortageMode === 'MANAGER_APPROVED') {
        if (!completedReplenishmentCoveredCompletionIds.has(completion.id)) {
          addIssue(
            'WARN',
            'PRODUCTION_SHORTAGE_ACTION_PENDING',
            `${label} 管理确认缺货 ${roundQuantity(shortageQuantity)} ${completion.unit || task?.unit || ''}，仍需要在订单明细处理补单、客户减量或无需补单说明`
          );
        }
      }
      continue;
    }

    if (!validResolutionModes.has(completion.shortageResolutionMode)) {
      addIssue('ERROR', 'PRODUCTION_SHORTAGE_RESOLUTION_MODE_INVALID', `${label} 的 shortageResolutionMode=${completion.shortageResolutionMode} 无效`);
    }
    if (shortageQuantity <= 0) {
      addIssue('ERROR', 'PRODUCTION_SHORTAGE_RESOLUTION_WITHOUT_SHORTAGE', `${label} 没有短缺数量，但写入了 shortageResolutionMode`);
    }
    if (completion.shortageMode !== 'MANAGER_APPROVED') {
      addIssue('ERROR', 'PRODUCTION_SHORTAGE_RESOLUTION_MODE_MISMATCH', `${label} 已关闭短缺，但 shortageMode 不是 MANAGER_APPROVED`);
    }
    if (!completion.shortageResolutionBy?.trim()) {
      addIssue('ERROR', 'PRODUCTION_SHORTAGE_RESOLUTION_BY_MISSING', `${label} 缺少 shortageResolutionBy`);
    }
    if (!completion.shortageResolutionReason?.trim()) {
      addIssue('ERROR', 'PRODUCTION_SHORTAGE_RESOLUTION_REASON_MISSING', `${label} 缺少 shortageResolutionReason`);
    }
    if (!completion.shortageResolvedAt) {
      addIssue('ERROR', 'PRODUCTION_SHORTAGE_RESOLVED_AT_MISSING', `${label} 缺少 shortageResolvedAt`);
    }
    if (completion.shortageResolutionMode === 'ORDER_REPLENISHMENT') {
      const taskNos = task?.orderLineId ? orderChangeTaskNosByLineId.get(task.orderLineId) || [] : [];
      if (taskNos.length === 0) {
        addIssue('ERROR', 'PRODUCTION_SHORTAGE_ORDER_REPLENISHMENT_TASK_MISSING', `${label} 标记为订单补单关闭，但同一订单零件没有 ORDER_CHANGE 补单任务`);
      }
    }
  }
}

async function checkProductionScrapRecords() {
  const records = await prisma.productionScrapRecord.findMany({
    orderBy: [{ recordDate: 'asc' }, { scrapNo: 'asc' }]
  });

  if (records.length === 0) {
    return;
  }

  const orderIds = Array.from(new Set(records.map((record) => record.orderId).filter(Boolean))) as string[];
  const orderNos = Array.from(new Set(records.map((record) => normalizeOrderNo(record.orderNo)).filter(Boolean)));
  const lineIds = Array.from(new Set(records.map((record) => record.orderLineId).filter(Boolean))) as string[];
  const taskIds = Array.from(new Set(records.map((record) => record.productionTaskId).filter(Boolean))) as string[];
  const taskNos = Array.from(new Set(records.map((record) => record.productionTaskNo).filter(Boolean))) as string[];
  const completionIds = records
    .filter((record) => record.sourceRecordType === 'ProductionProcessCompletion')
    .map((record) => record.sourceRecordId);
  const noticeIds = records
    .filter((record) => record.sourceRecordType === 'CustomerChangeWarehouseScrap')
    .map((record) => record.sourceRecordId);

  const [ordersByIdRows, ordersByNoRows, lines, tasksByIdRows, tasksByNoRows, completions, notices] = await Promise.all([
    orderIds.length
      ? prisma.customerOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNo: true, customerName: true }
        })
      : [],
    orderNos.length
      ? prisma.customerOrder.findMany({
          where: { orderNo: { in: orderNos } },
          select: { id: true, orderNo: true, customerName: true }
        })
      : [],
    lineIds.length
      ? prisma.orderLine.findMany({
          where: { id: { in: lineIds } },
          select: { id: true, orderId: true, partCode: true, partName: true, unit: true }
        })
      : [],
    taskIds.length
      ? prisma.productionTask.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, productionTaskNo: true, orderId: true, orderLineId: true, orderNo: true, partCode: true, partName: true, unit: true }
        })
      : [],
    taskNos.length
      ? prisma.productionTask.findMany({
          where: { productionTaskNo: { in: taskNos } },
          select: { id: true, productionTaskNo: true, orderId: true, orderLineId: true, orderNo: true, partCode: true, partName: true, unit: true }
        })
      : [],
    completionIds.length
      ? prisma.productionProcessCompletion.findMany({
          where: { id: { in: completionIds } },
          select: { id: true, productionTaskId: true, scrapQuantity: true, shortageQuantity: true, unit: true }
        })
      : [],
    noticeIds.length
      ? prisma.productionNotice.findMany({
          where: { id: { in: noticeIds } },
          select: {
            id: true,
            noticeNo: true,
            noticeType: true,
            status: true,
            target: true,
            orderId: true,
            orderNo: true,
            orderLineId: true,
            productionTaskId: true,
            productionTaskNo: true,
            partCode: true,
            partName: true,
            unit: true
          }
        })
      : []
  ]);

  const orderById = new Map<string, NoticeOrderRow>(
    (ordersByIdRows as NoticeOrderRow[]).map((order) => [order.id, order] as const)
  );
  const orderByNo = new Map<string, NoticeOrderRow>(
    (ordersByNoRows as NoticeOrderRow[]).map((order) => [normalizeOrderNo(order.orderNo), order] as const)
  );
  const lineById = new Map<string, NoticeLineRow>((lines as NoticeLineRow[]).map((line) => [line.id, line] as const));
  const taskById = new Map<string, NoticeTaskRow>((tasksByIdRows as NoticeTaskRow[]).map((task) => [task.id, task] as const));
  const taskByNo = new Map<string, NoticeTaskRow>(
    (tasksByNoRows as NoticeTaskRow[]).map((task) => [task.productionTaskNo, task] as const)
  );
  const completionById = new Map(completions.map((completion) => [completion.id, completion] as const));
  const noticeById = new Map(notices.map((notice) => [notice.id, notice] as const));
  const validSourceTypes = new Set([
    'ProductionProcessCompletion',
    'ProductionProcessCompletionScrapCancelled',
    'ProductionProcessCompletionWithdrawSnapshot',
    'ProductionTaskWithdraw',
    'CustomerChangeWarehouseScrap'
  ]);

  for (const record of records) {
    const label = `报废记录 ${record.scrapNo}`;
    const quantity = decimalToNumber(record.quantity);
    const order = record.orderId ? orderById.get(record.orderId) : orderByNo.get(normalizeOrderNo(record.orderNo));
    const line = record.orderLineId ? lineById.get(record.orderLineId) : null;
    const task = record.productionTaskId
      ? taskById.get(record.productionTaskId)
      : record.productionTaskNo
        ? taskByNo.get(record.productionTaskNo)
        : null;
    const blankSnapshotFields = [
      ['scrapNo', record.scrapNo],
      ['orderNo', record.orderNo],
      ['productionTaskNo', record.productionTaskNo],
      ['partCode', record.partCode],
      ['partName', record.partName],
      ['unit', record.unit],
      ['reason', record.reason],
      ['sourceRecordType', record.sourceRecordType],
      ['sourceRecordId', record.sourceRecordId]
    ].filter(([, value]) => value !== null && value !== undefined && !String(value).trim());
    if (blankSnapshotFields.length > 0) {
      addIssue(
        'ERROR',
        'SCRAP_RECORD_IDENTITY_BLANK',
        `${label} 存在空白快照字段：${blankSnapshotFields.map(([field]) => field).join(', ')}`
      );
    }

    if (quantity <= 0) {
      addIssue('ERROR', 'SCRAP_RECORD_NON_POSITIVE', `${label} quantity 必须大于 0`);
    }
    if (!record.reason?.trim()) {
      addIssue('ERROR', 'SCRAP_RECORD_REASON_MISSING', `${label} 缺少 reason`);
    }
    if (!record.sourceRecordType?.trim() || !record.sourceRecordId?.trim()) {
      addIssue('ERROR', 'SCRAP_RECORD_SOURCE_MISSING', `${label} 缺少 sourceRecordType 或 sourceRecordId`);
    } else if (!validSourceTypes.has(record.sourceRecordType)) {
      addIssue('ERROR', 'SCRAP_RECORD_SOURCE_TYPE_UNKNOWN', `${label} 的 sourceRecordType=${record.sourceRecordType} 不是第一阶段已知来源`);
    }

    if (record.orderId && !order) {
      addIssue('ERROR', 'SCRAP_RECORD_ORDER_MISSING', `${label} 绑定 orderId，但订单不存在`);
    } else if (order && normalizeOrderNo(order.orderNo) !== normalizeOrderNo(record.orderNo)) {
      addIssue('ERROR', 'SCRAP_RECORD_ORDER_NO_MISMATCH', `${label} 的 orderNo 与绑定订单不一致`);
    }

    if (record.orderLineId) {
      if (!line) {
        addIssue('ERROR', 'SCRAP_RECORD_LINE_MISSING', `${label} 绑定 orderLineId，但订单零件不存在`);
      } else {
        if (order && line.orderId !== order.id) {
          addIssue('ERROR', 'SCRAP_RECORD_LINE_ORDER_MISMATCH', `${label} 的订单零件不属于绑定订单`);
        }
        if (normalizeCaseInsensitiveKey(record.partCode) !== normalizeCaseInsensitiveKey(line.partCode)) {
          addIssue('ERROR', 'SCRAP_RECORD_LINE_PART_MISMATCH', `${label} 的 partCode 与订单零件不一致`);
        }
        if (!sameText(record.unit, line.unit)) {
          addIssue('ERROR', 'SCRAP_RECORD_LINE_UNIT_MISMATCH', `${label} 的 unit 与订单零件不一致`);
        }
      }
    }

    if (record.productionTaskId || record.productionTaskNo) {
      if (!task) {
        addIssue('ERROR', 'SCRAP_RECORD_TASK_MISSING', `${label} 绑定生产任务，但生产任务不存在`);
      } else {
        if (record.productionTaskNo && record.productionTaskNo !== task.productionTaskNo) {
          addIssue('ERROR', 'SCRAP_RECORD_TASK_NO_MISMATCH', `${label} 的 productionTaskNo 与绑定任务不一致`);
        }
        if (order && task.orderId !== order.id) {
          addIssue('ERROR', 'SCRAP_RECORD_TASK_ORDER_MISMATCH', `${label} 的生产任务不属于绑定订单`);
        }
        if (record.orderLineId && task.orderLineId !== record.orderLineId) {
          addIssue('ERROR', 'SCRAP_RECORD_TASK_LINE_MISMATCH', `${label} 的生产任务不属于绑定订单零件`);
        }
        if (normalizeCaseInsensitiveKey(record.partCode) !== normalizeCaseInsensitiveKey(task.partCode)) {
          addIssue('ERROR', 'SCRAP_RECORD_TASK_PART_MISMATCH', `${label} 的 partCode 与生产任务不一致`);
        }
        if (!sameText(record.unit, task.unit)) {
          addIssue('ERROR', 'SCRAP_RECORD_TASK_UNIT_MISMATCH', `${label} 的 unit 与生产任务不一致`);
        }
      }
    }

    if (record.sourceRecordType === 'ProductionProcessCompletion') {
      const completion = completionById.get(record.sourceRecordId);
      if (!completion) {
        addIssue('ERROR', 'SCRAP_RECORD_COMPLETION_MISSING', `${label} 来源工序完成表不存在`);
      } else {
        if (record.productionTaskId && completion.productionTaskId !== record.productionTaskId) {
          addIssue('ERROR', 'SCRAP_RECORD_COMPLETION_TASK_MISMATCH', `${label} 的来源工序完成表不属于绑定生产任务`);
        }
        if (quantityDiffers(decimalToNumber(completion.scrapQuantity), quantity)) {
          addIssue('ERROR', 'SCRAP_RECORD_COMPLETION_QUANTITY_MISMATCH', `${label} 的 quantity 与工序完成表 scrapQuantity 不一致`);
        }
        if (!sameText(record.unit, completion.unit)) {
          addIssue('ERROR', 'SCRAP_RECORD_COMPLETION_UNIT_MISMATCH', `${label} 的 unit 与工序完成表不一致`);
        }
      }
    }

    if (record.sourceRecordType === 'ProductionTaskWithdraw' && record.productionTaskId) {
      if (!record.sourceRecordId.startsWith(`${record.productionTaskId}:`)) {
        addIssue('ERROR', 'SCRAP_RECORD_WITHDRAW_SOURCE_MISMATCH', `${label} 的撤回来源 sourceRecordId 与 productionTaskId 不一致`);
      }
    }

    if (record.sourceRecordType === 'ProductionProcessCompletionScrapCancelled' && !record.sourceRecordId.includes(':scrap-cancel:')) {
      addIssue('ERROR', 'SCRAP_RECORD_CANCELLED_SOURCE_MISMATCH', `${label} 的报废取消归档来源缺少 scrap-cancel 标记`);
    }

    if (record.sourceRecordType === 'ProductionProcessCompletionWithdrawSnapshot' && !record.sourceRecordId.includes(':withdraw:')) {
      addIssue('ERROR', 'SCRAP_RECORD_WITHDRAW_ARCHIVE_SOURCE_MISMATCH', `${label} 的撤回归档来源缺少 withdraw 标记`);
    }

    if (record.sourceRecordType === 'CustomerChangeWarehouseScrap') {
      const notice = noticeById.get(record.sourceRecordId);
      if (!notice) {
        addIssue('ERROR', 'SCRAP_RECORD_NOTICE_MISSING', `${label} 的仓库报废通知不存在`);
      } else {
        if (notice.target !== 'WAREHOUSE' || !['QUANTITY_DECREASE', 'ORDER_CANCELLED'].includes(notice.noticeType)) {
          addIssue('ERROR', 'SCRAP_RECORD_NOTICE_TYPE_INVALID', `${label} 的仓库报废通知类型不正确`);
        }
        if (notice.status !== ProductionNoticeStatus.ACKNOWLEDGED) {
          addIssue('ERROR', 'SCRAP_RECORD_NOTICE_NOT_ACKED', `${label} 的仓库报废通知还未确认`);
        }
        if (record.orderId && notice.orderId !== record.orderId) {
          addIssue('ERROR', 'SCRAP_RECORD_NOTICE_ORDER_MISMATCH', `${label} 的通知订单与报废记录不一致`);
        }
        if (record.productionTaskNo && notice.productionTaskNo !== record.productionTaskNo) {
          addIssue('ERROR', 'SCRAP_RECORD_NOTICE_TASK_MISMATCH', `${label} 的通知生产任务与报废记录不一致`);
        }
      }
    }
  }
}

async function checkOrderStatisticsStatuses() {
  const orders = await prisma.customerOrder.findMany({
    include: {
      lines: true,
      productionTasks: {
        include: { inventoryBatch: { select: { quantity: true } } },
        orderBy: { productionTaskNo: 'asc' }
      },
      inventoryBatches: true
    },
    orderBy: { orderNo: 'asc' }
  });

  if (orders.length === 0) {
    return;
  }

  const orderNos = orders.map((order) => order.orderNo);
  const taskNos = orders.flatMap((order) => order.productionTasks.map((task) => task.productionTaskNo));
  const [shipmentTransactions, stockAllocationTransactions, receiptTransactions] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where: {
        transactionType: 'OUT',
        orderNo: { in: orderNos },
        sourceRecordType: 'InventoryBatch'
      }
    }),
    prisma.inventoryTransaction.findMany({
      where: {
        transactionType: 'IN',
        orderNo: { in: orderNos },
        sourceRecordType: 'OrderLineStockAllocation'
      }
    }),
    taskNos.length
      ? prisma.inventoryTransaction.findMany({
          where: {
            transactionType: 'IN',
            productionTaskNo: { in: taskNos },
            sourceRecordType: 'ProductionTask'
          }
        })
      : []
  ]);

  const shippedQuantityByOrderUnit = new Map<string, Map<string, number>>();
  for (const transaction of shipmentTransactions) {
    if (transaction.orderNo) {
      addOrderUnitQuantity(shippedQuantityByOrderUnit, transaction.orderNo, transaction.unit, decimalToNumber(transaction.quantity));
    }
  }

  const stockAllocatedQuantityByOrderUnit = new Map<string, Map<string, number>>();
  for (const transaction of stockAllocationTransactions) {
    if (transaction.orderNo) {
      addOrderUnitQuantity(stockAllocatedQuantityByOrderUnit, transaction.orderNo, transaction.unit, decimalToNumber(transaction.quantity));
    }
  }

  const stockQuantityByTaskNo = new Map<string, number>();
  const orderReceiptQuantityByTaskNo = new Map<string, number>();
  for (const transaction of receiptTransactions) {
    if (!transaction.productionTaskNo) {
      continue;
    }
    const quantity = decimalToNumber(transaction.quantity);
    if (transaction.orderNo) {
      orderReceiptQuantityByTaskNo.set(
        transaction.productionTaskNo,
        roundQuantity((orderReceiptQuantityByTaskNo.get(transaction.productionTaskNo) || 0) + quantity)
      );
      continue;
    }
    stockQuantityByTaskNo.set(transaction.productionTaskNo, roundQuantity((stockQuantityByTaskNo.get(transaction.productionTaskNo) || 0) + quantity));
  }

  const completedProductionQuantityByOrderUnit = new Map<string, Map<string, number>>();
  for (const order of orders) {
    for (const task of order.productionTasks) {
      const completedQuantity = decimalToNumber(task.completedQuantity);
      const effectiveCompletedQuantity =
        completedQuantity > 0
          ? completedQuantity
          : (orderReceiptQuantityByTaskNo.get(task.productionTaskNo) || decimalToNumber(task.inventoryBatch?.quantity)) +
            (stockQuantityByTaskNo.get(task.productionTaskNo) || 0);
      if (effectiveCompletedQuantity > 0) {
        addOrderUnitQuantity(completedProductionQuantityByOrderUnit, order.orderNo, task.unit, effectiveCompletedQuantity);
      }
    }
  }

  const completedFulfillmentQuantityByOrderUnit = new Map<string, Map<string, number>>();
  for (const [orderNo, unitMap] of completedProductionQuantityByOrderUnit.entries()) {
    for (const [unit, quantity] of unitMap.entries()) {
      addOrderUnitQuantity(completedFulfillmentQuantityByOrderUnit, orderNo, unit, quantity);
    }
  }
  for (const [orderNo, unitMap] of stockAllocatedQuantityByOrderUnit.entries()) {
    for (const [unit, quantity] of unitMap.entries()) {
      addOrderUnitQuantity(completedFulfillmentQuantityByOrderUnit, orderNo, unit, quantity);
    }
  }

  for (const order of orders) {
    const quantityByUnit = toOrderQuantityByUnit(order.lines);
    const shippedQuantityByUnit = shippedQuantityByOrderUnit.get(order.orderNo) || new Map<string, number>();
    const completedProductionQuantityByUnit = completedProductionQuantityByOrderUnit.get(order.orderNo) || new Map<string, number>();
    const completedFulfillmentQuantityByUnit = completedFulfillmentQuantityByOrderUnit.get(order.orderNo) || new Map<string, number>();
    const statisticsStatus = resolveExpectedStatisticsStatus(
      order.status,
      quantityByUnit,
      order.productionTasks,
      completedProductionQuantityByUnit,
      completedFulfillmentQuantityByUnit,
      shippedQuantityByUnit,
      order.inventoryBatches
    );

    if (statisticsStatus === 'ORDER_SHIPPED_COMPLETED' && order.status !== OrderStatus.COMPLETED) {
      addIssue(
        'ERROR',
        'FULLY_SHIPPED_ORDER_STATUS_STALE',
        `订单 ${order.orderNo} 发货数量已覆盖客户订单数量，但 CustomerOrder.status 仍是 ${order.status}`
      );
    }
    if (order.status === OrderStatus.COMPLETED && statisticsStatus !== 'ORDER_SHIPPED_COMPLETED') {
      addIssue(
        'ERROR',
        'COMPLETED_ORDER_NOT_FULLY_SHIPPED',
        `订单 ${order.orderNo} 的 CustomerOrder.status=COMPLETED，但发货流水未覆盖客户订单数量`
      );
    }
    const availableShipmentBatches = order.inventoryBatches.filter(
      (batch) => batch.status === 'AVAILABLE' && decimalToNumber(batch.quantity) > quantityTolerance
    );
    if (order.status === OrderStatus.COMPLETED && availableShipmentBatches.length > 0) {
      addIssue(
        'ERROR',
        'COMPLETED_ORDER_HAS_AVAILABLE_SHIPMENT_BATCH',
        `订单 ${order.orderNo} 已完成发货，但仍有可发货库存批次：${availableShipmentBatches.map((batch) => batch.batchNo).join('，')}`
      );
    }
    if (order.status === OrderStatus.CANCELLED && availableShipmentBatches.length > 0) {
      addIssue(
        'ERROR',
        'CANCELLED_ORDER_HAS_AVAILABLE_SHIPMENT_BATCH',
        `订单 ${order.orderNo} 已取消，但仍有可发货订单库存批次：${availableShipmentBatches.map((batch) => batch.batchNo).join('，')}`
      );
    }
    if (order.status === OrderStatus.DRAFT && availableShipmentBatches.length > 0) {
      addIssue(
        'ERROR',
        'DRAFT_ORDER_HAS_AVAILABLE_SHIPMENT_BATCH',
        `订单 ${order.orderNo} 仍是待提交生产，但已经形成可发货订单库存批次：${availableShipmentBatches.map((batch) => batch.batchNo).join('，')}`
      );
    }
    if (statisticsStatus === 'ORDER_IN_PRODUCTION' && order.status === OrderStatus.PENDING_PRODUCTION) {
      addIssue(
        'ERROR',
        'IN_PROGRESS_ORDER_STATUS_STALE',
        `订单 ${order.orderNo} 已有生产中或已完成任务，但 CustomerOrder.status 仍是 PENDING_PRODUCTION`
      );
    }
  }
}

function resolveExpectedStatisticsStatus(
  orderStatus: OrderStatus,
  quantityByUnit: OrderQuantityByUnitRow[],
  tasks: Array<{ status: ProductionStatus }>,
  completedProductionQuantityByUnit: Map<string, number>,
  completedFulfillmentQuantityByUnit: Map<string, number>,
  shippedQuantityByUnit: Map<string, number>,
  orderBatches: Array<{ status: string }>
) {
  if (orderStatus === OrderStatus.DRAFT) {
    return 'ORDER_DRAFT';
  }
  if (orderStatus === OrderStatus.CANCELLED) {
    return 'ORDER_CANCELLED';
  }
  if (allUnitsReached(quantityByUnit, 'totalQuantity', shippedQuantityByUnit)) {
    return 'ORDER_SHIPPED_COMPLETED';
  }
  if (orderStatus === OrderStatus.COMPLETED) {
    return 'ORDER_COMPLETED_WITHOUT_FULL_SHIPMENT';
  }
  if (allUnitsReached(quantityByUnit, 'totalQuantity', completedFulfillmentQuantityByUnit)) {
    return 'ORDER_COMPLETED_UNSHIPPED';
  }
  if (
    orderBatches.length > 0 &&
    quantityByUnit.some((row) => Number(row.totalQuantity || 0) > 0) &&
    quantityByUnit.every((row) => Number(row.totalProductionPlanQuantity || 0) <= 0)
  ) {
    return 'ORDER_COMPLETED_UNSHIPPED';
  }
  if (
    allUnitsReached(quantityByUnit, 'totalProductionPlanQuantity', completedProductionQuantityByUnit) &&
    quantityByUnit.every((row) => Number(row.totalProductionPlanQuantity || 0) >= Number(row.totalQuantity || 0))
  ) {
    return 'ORDER_COMPLETED_UNSHIPPED';
  }
  if (
    orderStatus === OrderStatus.IN_PRODUCTION ||
    tasks.some((task) =>
      new Set<ProductionStatus>([
        ProductionStatus.IN_PROGRESS,
        ProductionStatus.WAITING_CONFIRMATION,
        ProductionStatus.COMPLETED,
        ProductionStatus.STORED
      ]).has(task.status)
    )
  ) {
    return 'ORDER_IN_PRODUCTION';
  }
  if (tasks.length > 0 || orderStatus === OrderStatus.PENDING_PRODUCTION) {
    return 'WAITING_PRODUCTION';
  }
  return orderStatus;
}

async function checkInventoryAdjustments() {
  const adjustments = await prisma.inventoryAdjustment.findMany({
    select: {
      id: true,
      adjustmentNo: true,
      batchId: true,
      beforeQuantity: true,
      afterQuantity: true,
      deltaQuantity: true,
      unit: true,
      countedBy: true,
      signatureName: true,
      attachmentFileUrl: true,
      attachmentFileName: true,
      attachmentSize: true
    }
  });
  const adjustmentIds = adjustments.map((adjustment) => adjustment.id);
  const adjustmentTransactions = adjustmentIds.length
    ? await prisma.inventoryTransaction.findMany({
        where: { sourceRecordType: 'InventoryAdjustment', sourceRecordId: { in: adjustmentIds } },
        select: {
          transactionNo: true,
          transactionType: true,
          sourceRecordId: true,
          batchId: true,
          quantity: true,
          unit: true
        }
      })
    : [];
  const transactionsByAdjustmentId = new Map<string, typeof adjustmentTransactions>();
  for (const transaction of adjustmentTransactions) {
    if (!transaction.sourceRecordId) {
      continue;
    }
    const rows = transactionsByAdjustmentId.get(transaction.sourceRecordId) || [];
    rows.push(transaction);
    transactionsByAdjustmentId.set(transaction.sourceRecordId, rows);
  }
  const uploadRoot = resolveUploadRootPath();
  const inventoryAdjustmentPrefix = '/uploads/inventory-adjustments/';

  for (const adjustment of adjustments) {
    const beforeQuantity = decimalToNumber(adjustment.beforeQuantity);
    const afterQuantity = decimalToNumber(adjustment.afterQuantity);
    const deltaQuantity = decimalToNumber(adjustment.deltaQuantity);
    const expectedDeltaQuantity = roundQuantity(afterQuantity - beforeQuantity);
    if (beforeQuantity < 0 || afterQuantity < 0) {
      addIssue(
        'ERROR',
        'INVENTORY_ADJUSTMENT_NEGATIVE_QUANTITY',
        `盘点调整 ${adjustment.adjustmentNo} beforeQuantity=${beforeQuantity}、afterQuantity=${afterQuantity}，盘点数量不能为负数`
      );
    }
    if (quantityDiffers(deltaQuantity, expectedDeltaQuantity)) {
      addIssue(
        'ERROR',
        'INVENTORY_ADJUSTMENT_DELTA_MISMATCH',
        `盘点调整 ${adjustment.adjustmentNo} 差异数量应为 ${expectedDeltaQuantity}${adjustment.unit}，实际记录为 ${deltaQuantity}${adjustment.unit}`
      );
    }

    const linkedTransactions = transactionsByAdjustmentId.get(adjustment.id) || [];
    if (Math.abs(deltaQuantity) > quantityTolerance) {
      if (linkedTransactions.length !== 1) {
        addIssue(
          'ERROR',
          'INVENTORY_ADJUSTMENT_TRANSACTION_MISSING',
          `盘点调整 ${adjustment.adjustmentNo} 差异 ${deltaQuantity}${adjustment.unit}，但对应库存流水数量为 ${linkedTransactions.length}`
        );
      } else {
        const transaction = linkedTransactions[0];
        const expectedType = deltaQuantity > 0 ? 'IN' : 'OUT';
        const transactionQuantity = decimalToNumber(transaction.quantity);
        if (
          transaction.transactionType !== expectedType ||
          transaction.batchId !== adjustment.batchId ||
          transaction.unit !== adjustment.unit ||
          quantityDiffers(transactionQuantity, Math.abs(deltaQuantity))
        ) {
          addIssue(
            'ERROR',
            'INVENTORY_ADJUSTMENT_TRANSACTION_MISMATCH',
            `盘点调整 ${adjustment.adjustmentNo} 对应流水 ${transaction.transactionNo} 与差异数量、方向、批次或单位不一致`
          );
        }
      }
    } else if (linkedTransactions.length > 0) {
      addIssue(
        'ERROR',
        'INVENTORY_ADJUSTMENT_ZERO_DELTA_HAS_TRANSACTION',
        `盘点调整 ${adjustment.adjustmentNo} 差异为 0，但仍生成了库存流水：${linkedTransactions
          .map((transaction) => transaction.transactionNo)
          .join('，')}`
      );
    }

    if (!adjustment.countedBy?.trim() || !adjustment.signatureName?.trim()) {
      addIssue('ERROR', 'INVENTORY_ADJUSTMENT_SIGN_MISSING', `盘点调整 ${adjustment.adjustmentNo} 缺少清点人或签字`);
    }
    if (!adjustment.attachmentFileName?.trim() || !adjustment.attachmentFileUrl?.startsWith(inventoryAdjustmentPrefix)) {
      addIssue('ERROR', 'INVENTORY_ADJUSTMENT_ATTACHMENT_MISSING', `盘点调整 ${adjustment.adjustmentNo} 缺少有效附件路径`);
      continue;
    }
    if (adjustment.attachmentSize !== null && adjustment.attachmentSize < 0) {
      addIssue('ERROR', 'INVENTORY_ADJUSTMENT_ATTACHMENT_SIZE_INVALID', `盘点调整 ${adjustment.adjustmentNo} attachmentSize 不能为负数`);
    }
    const storedFileName = basename(adjustment.attachmentFileUrl);
    const filePath = resolve(uploadRoot, 'inventory-adjustments', storedFileName);
    if (!existsSync(filePath)) {
      addIssue(
        'WARN',
        'INVENTORY_ADJUSTMENT_ATTACHMENT_FILE_MISSING',
        `盘点调整 ${adjustment.adjustmentNo} 附件记录存在，但本机文件不存在：${adjustment.attachmentFileName || storedFileName}`
      );
    }
  }
}

function resolveUploadRootPath() {
  const cwd = process.cwd();
  const projectRoot = basename(cwd) === 'backend' ? resolve(cwd, '..') : cwd;
  if (process.env.UPLOAD_DIR?.trim()) {
    return resolve(projectRoot, process.env.UPLOAD_DIR.trim());
  }
  return resolve(projectRoot, 'storage/uploads');
}

function printSummary() {
  const errorCount = issues.filter((issue) => issue.level === 'ERROR').length;
  const warnCount = issues.filter((issue) => issue.level === 'WARN').length;

  console.log(`第一阶段数据校验完成：ERROR ${errorCount}，WARN ${warnCount}`);
  if (issues.length === 0) {
    console.log('未发现 P2/P4 核心数据问题。');
    return;
  }

  for (const issue of issues) {
    console.log(`[${issue.level}] ${issue.code}: ${issue.message}`);
  }
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
