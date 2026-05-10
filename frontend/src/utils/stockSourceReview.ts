import type { CreateOrderLinePayload } from '../api/erp';
import type { InventorySourceBatchDetail } from '../types/erp';
import { formatQuantity } from './format';

export type StockSourceComparableLine = Pick<
  CreateOrderLinePayload,
  | 'partCode'
  | 'partName'
  | 'drawingNo'
  | 'drawingVersion'
  | 'partSpecification'
  | 'partThickness'
  | 'quantity'
  | 'productionPlanQuantity'
  | 'fulfillmentMode'
  | 'unit'
>;

function normalize(value?: string | number | null) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

export function stockSourceRequiredQuantity(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    return Number(line.quantity || 0);
  }
  if (line.fulfillmentMode === 'REWORK') {
    return Number(line.productionPlanQuantity ?? line.quantity ?? 0);
  }
  return 0;
}

export function stockSourceReviewRequired(line: CreateOrderLinePayload) {
  return line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK';
}

export function stockSourceReviewSignature(line: CreateOrderLinePayload) {
  const selectedSourceSignature = normalizeSelectedStockSources(line)
    .map(
      (source) =>
        `${source.batchId}:${source.quantity}:${source.compatibilityStatus || ''}:${source.compatibilityReason || ''}:${source.manualConfirmedBy || ''}:${source.manualConfirmedAt || ''}:${source.manualConfirmRemark || ''}`
    )
    .join(',');
  return [
    line.fulfillmentMode || 'PRODUCTION',
    line.partCode,
    line.unit,
    line.drawingNo,
    line.drawingVersion,
    line.drawingFileName,
    line.partThickness,
    line.partSpecification,
    // 使用库存时数量也属于核对对象，避免核对 20 件后又改成 40 件仍显示已核对。
    stockSourceRequiredQuantity(line),
    selectedSourceSignature
  ]
    .map(normalize)
    .join('|');
}

export function markStockSourceReviewed(line: CreateOrderLinePayload) {
  line.stockSourceReviewed = true;
  line.stockSourceReviewSignature = stockSourceReviewSignature(line);
}

export function restoreSavedStockSourceReview(line: CreateOrderLinePayload) {
  if (!stockSourceReviewRequired(line)) {
    return;
  }
  const selectedQuantity = selectedStockSourceQuantity(line);
  const requiredQuantity = stockSourceRequiredQuantity(line);
  const selectedQuantityInvalid =
    line.fulfillmentMode === 'STOCK'
      ? selectedQuantity <= 0 || selectedQuantity > requiredQuantity + 0.0001
      : selectedQuantity <= 0 || selectedQuantity + 0.0001 < requiredQuantity || selectedQuantity > requiredQuantity + 0.0001;
  if (
    selectedQuantityInvalid
  ) {
    line.stockSourceReviewed = false;
    line.stockSourceReviewSignature = '';
    return;
  }
  if (findMissingStockSourceManualConfirmation(line)) {
    line.stockSourceReviewed = false;
    line.stockSourceReviewSignature = '';
    return;
  }
  if (findDirectStockSourceBlockedIssue(line)) {
    line.stockSourceReviewed = false;
    line.stockSourceReviewSignature = '';
    return;
  }
  line.stockSourceAvailableQuantity = selectedQuantity;
  line.stockSourceMatchedQuantity = selectedQuantity;
  markStockSourceReviewed(line);
}

export function isStockSourceReviewed(line: CreateOrderLinePayload) {
  if (!stockSourceReviewRequired(line)) {
    return true;
  }
  return Boolean(line.stockSourceReviewed && line.stockSourceReviewSignature === stockSourceReviewSignature(line));
}

export function findUnreviewedStockSourceLine(lines: CreateOrderLinePayload[]) {
  return lines.find((line) => stockSourceReviewRequired(line) && !isStockSourceReviewed(line));
}

export function validateDraftStockSourceLines(lines: CreateOrderLinePayload[]) {
  const overusedBatchIssue = findOverusedSelectedStockBatchIssue(lines);
  if (overusedBatchIssue) {
    return {
      ok: false,
      message: overusedBatchIssue,
      warning: ''
    };
  }

  let warning = '';
  for (const line of lines) {
    const planOverrideIssue = findProductionPlanOverrideIssue(line);
    if (planOverrideIssue) {
      return {
        ok: false,
        message: planOverrideIssue,
        warning: ''
      };
    }

    if (!stockSourceReviewRequired(line)) {
      continue;
    }

    const selectedQuantity = selectedStockSourceQuantity(line);
    const partText = `${line.partCode || '-'} / ${line.partName || '-'}`;
    if (selectedQuantity <= 0) {
      warning ||= `${partText} 尚未选择库存批次，待提交生产订单已允许保存；提交生产前必须选择库存来源并完成核对。`;
      continue;
    }

    const overSelectedIssue = findOverSelectedStockSourceQuantity(line);
    if (overSelectedIssue) {
      return {
        ok: false,
        message: overSelectedIssue,
        warning: ''
      };
    }

    const selectedQuantityIssue = findSelectedStockSourceQuantityIssue(line, { requireFullRework: false });
    if (selectedQuantityIssue) {
      return {
        ok: false,
        message: selectedQuantityIssue,
        warning: ''
      };
    }

    const directStockIssue = findDirectStockSourceBlockedIssue(line);
    if (directStockIssue) {
      return {
        ok: false,
        message: directStockIssue,
        warning: ''
      };
    }

    if (!isStockSourceReviewed(line)) {
      return {
        ok: false,
        message: `${partText} 必须先完成库存来源核对，再保存订单。`,
        warning: ''
      };
    }

    const manualIssue = findMissingStockSourceManualConfirmation(line);
    if (manualIssue) {
      return {
        ok: false,
        message: manualIssue,
        warning: ''
      };
    }
  }

  return {
    ok: true,
    message: '',
    warning
  };
}

export function validateReviewedStockSourceLines(lines: CreateOrderLinePayload[]) {
  const overusedBatchIssue = findOverusedSelectedStockBatchIssue(lines);
  if (overusedBatchIssue) {
    return {
      ok: false,
      message: overusedBatchIssue
    };
  }

  const stockGroups = new Map<
    string,
    {
      partText: string;
      unit: string;
      requiredQuantity: number;
      matchedQuantity: number;
    }
  >();
  const reworkGroups = new Map<
    string,
    {
      partText: string;
      unit: string;
      requiredQuantity: number;
      availableQuantity: number;
    }
  >();

  for (const line of lines) {
    const planOverrideIssue = findProductionPlanOverrideIssue(line);
    if (planOverrideIssue) {
      return {
        ok: false,
        message: planOverrideIssue
      };
    }

    if (!stockSourceReviewRequired(line)) {
      continue;
    }

    const partText = `${line.partCode || '-'} / ${line.partName || '-'}`;
    const manualIssue = findMissingStockSourceManualConfirmation(line);
    if (manualIssue) {
      return {
        ok: false,
        message: manualIssue
      };
    }
    const directStockIssue = findDirectStockSourceBlockedIssue(line);
    if (directStockIssue) {
      return {
        ok: false,
        message: directStockIssue
      };
    }
    const overSelectedIssue = findOverSelectedStockSourceQuantity(line);
    if (overSelectedIssue) {
      return {
        ok: false,
        message: overSelectedIssue
      };
    }

    const requiredQuantity = stockSourceRequiredQuantity(line);
    const selectedQuantityIssue = findSelectedStockSourceQuantityIssue(line);
    if (selectedQuantityIssue) {
      return {
        ok: false,
        message: selectedQuantityIssue
      };
    }

    if (line.fulfillmentMode === 'STOCK') {
      const key = stockSourceComparableKey(line);
      const selectedQuantity = selectedStockSourceQuantity(line);
      const row =
        stockGroups.get(key) ??
        {
          partText,
          unit: line.unit || '件',
          requiredQuantity: 0,
          matchedQuantity: 0
        };
      row.requiredQuantity += requiredQuantity;
      row.matchedQuantity += selectedQuantity;
      stockGroups.set(key, row);
      continue;
    }

    const reworkKey = `${(line.partCode || '').trim().toLocaleLowerCase()}__${(line.unit || '件').trim().toLocaleLowerCase()}`;
    const selectedQuantity = selectedStockSourceQuantity(line);
    const row =
      reworkGroups.get(reworkKey) ??
      {
        partText,
        unit: line.unit || '件',
        requiredQuantity: 0,
        availableQuantity: 0
      };
    row.requiredQuantity += requiredQuantity;
    row.availableQuantity += selectedQuantity;
    reworkGroups.set(reworkKey, row);
  }

  const insufficientRework = [...reworkGroups.values()].find((row) => row.requiredQuantity > row.availableQuantity + 0.0001);
  if (insufficientRework) {
    return {
      ok: false,
      message: `${insufficientRework.partText} 库存再加工备货不足：合计需要 ${formatQuantity(
        insufficientRework.requiredQuantity,
        insufficientRework.unit
      )}，已核对可用库存只有 ${formatQuantity(insufficientRework.availableQuantity, insufficientRework.unit)}。`
    };
  }

  return { ok: true, message: '' };
}

export function sourceMatchesOrderLine(source: InventorySourceBatchDetail, line: StockSourceComparableLine) {
  return (
    sourceHasDirectStockDrawingInfo(source) &&
    requiredTextMatches(line.partCode, source.partCode) &&
    requiredTextMatches(line.drawingNo, source.drawingNo) &&
    requiredTextMatches(line.drawingVersion, source.drawingVersion) &&
    requiredTextMatches(line.partSpecification, source.partSpecification) &&
    requiredNumberMatches(line.partThickness, source.partThickness)
  );
}

export function matchedInventorySourceQuantity(sources: InventorySourceBatchDetail[], line: StockSourceComparableLine) {
  return sources.reduce((sum, source) => (sourceMatchesOrderLine(source, line) ? sum + source.quantity : sum), 0);
}

export function totalInventorySourceQuantity(sources: InventorySourceBatchDetail[]) {
  return sources.reduce((sum, source) => sum + source.quantity, 0);
}

export function selectedStockSourceQuantity(line: CreateOrderLinePayload) {
  return normalizeSelectedStockSources(line).reduce((sum, source) => sum + source.quantity, 0);
}

export function stockSuggestedProductionQuantity(line: CreateOrderLinePayload) {
  return Math.max(Number(line.quantity || 0) - selectedStockSourceQuantity(line), 0);
}

export function suggestedProductionPlanQuantity(line: CreateOrderLinePayload) {
  return line.fulfillmentMode === 'STOCK'
    ? stockSuggestedProductionQuantity(line)
    : Math.max(Number(line.quantity || 0), 0);
}

export function productionPlanOverrideRequired(line: CreateOrderLinePayload) {
  const suggestedQuantity = suggestedProductionPlanQuantity(line);
  const plannedQuantity = Number(line.productionPlanQuantity ?? suggestedQuantity);
  return Math.abs(plannedQuantity - suggestedQuantity) > 0.0001;
}

export function findProductionPlanOverrideIssue(line: CreateOrderLinePayload, options: { requireResolvedOperator?: boolean } = {}) {
  if (!productionPlanOverrideRequired(line)) {
    return '';
  }
  const partText = `${line.partCode || '-'} / ${line.partName || '-'}`;
  if (!line.productionPlanOverrideByCode?.trim()) {
    return `${partText} 生产计划数量与建议数量不一致，必须填写操作人员账号。`;
  }
  if (!line.productionPlanOverrideReason?.trim()) {
    return `${partText} 生产计划数量与建议数量不一致，必须填写调整说明。`;
  }
  if (options.requireResolvedOperator) {
    if (!line.productionPlanOverrideByName?.trim() || !line.productionPlanOverrideByRole?.trim()) {
      return `${partText} 生产计划调整操作员资料不完整，请重新保存订单后再提交生产。`;
    }
    const overrideAt = line.productionPlanOverrideAt ? new Date(line.productionPlanOverrideAt) : null;
    if (!overrideAt || Number.isNaN(overrideAt.getTime())) {
      return `${partText} 生产计划调整时间无效，请重新保存订单后再提交生产。`;
    }
  }
  return '';
}

export function findOverSelectedStockSourceQuantity(line: CreateOrderLinePayload) {
  if (!stockSourceReviewRequired(line)) {
    return '';
  }
  const requiredQuantity = stockSourceRequiredQuantity(line);
  const selectedQuantity = selectedStockSourceQuantity(line);
  if (requiredQuantity > 0 && selectedQuantity > requiredQuantity + 0.0001) {
    return `${line.partCode || '-'} / ${line.partName || '-'} 已选库存 ${formatQuantity(
      selectedQuantity,
      line.unit || '件'
    )}，超过本次需要 ${formatQuantity(requiredQuantity, line.unit || '件')}；请重新打开库存来源并减少选用批次数量。`;
  }
  return '';
}

export function findSelectedStockSourceQuantityIssue(line: CreateOrderLinePayload, options: { requireFullRework?: boolean } = {}) {
  if (!stockSourceReviewRequired(line)) {
    return '';
  }
  const requiredQuantity = stockSourceRequiredQuantity(line);
  const selectedQuantity = selectedStockSourceQuantity(line);
  const partText = `${line.partCode || '-'} / ${line.partName || '-'}`;
  const unit = line.unit || '件';
  if (requiredQuantity > 0 && selectedQuantity <= 0) {
    return `${partText} 必须先选择库存批次并完成来源核对，不能由系统自动扣减库存。`;
  }
  if (
    options.requireFullRework !== false &&
    line.fulfillmentMode !== 'STOCK' &&
    requiredQuantity > 0 &&
    selectedQuantity + 0.0001 < requiredQuantity
  ) {
    return `${partText} 已选库存 ${formatQuantity(selectedQuantity, unit)}，少于本次需要 ${formatQuantity(
      requiredQuantity,
      unit
    )}；请重新打开库存来源并补足批次数量。`;
  }
  return '';
}

export function findOverusedSelectedStockBatchIssue(lines: CreateOrderLinePayload[]) {
  const batchRows = new Map<
    string,
    {
      batchId: string;
      batchNo?: string;
      unit: string;
      selectedQuantity: number;
      availableQuantity?: number;
      partTexts: Set<string>;
    }
  >();

  for (const line of lines) {
    if (!stockSourceReviewRequired(line)) {
      continue;
    }
    const partText = `${line.partCode || '-'} / ${line.partName || '-'}`;
    for (const source of normalizeSelectedStockSources(line)) {
      const row =
        batchRows.get(source.batchId) ??
        {
          batchId: source.batchId,
          batchNo: source.batchNo,
          unit: source.unit || line.unit || '件',
          selectedQuantity: 0,
          availableQuantity: undefined,
          partTexts: new Set<string>()
        };
      row.batchNo = row.batchNo || source.batchNo;
      row.unit = source.unit || row.unit;
      row.selectedQuantity += source.quantity;
      if (source.availableQuantity !== undefined) {
        const sourceAvailableQuantity = Number(source.availableQuantity || 0);
        row.availableQuantity =
          row.availableQuantity === undefined
            ? sourceAvailableQuantity
            : Math.max(row.availableQuantity, sourceAvailableQuantity);
      }
      row.partTexts.add(partText);
      batchRows.set(source.batchId, row);
    }
  }

  const issue = [...batchRows.values()].find(
    (row) => row.availableQuantity !== undefined && row.selectedQuantity > row.availableQuantity + 0.0001
  );
  if (!issue) {
    return '';
  }

  const relatedParts = [...issue.partTexts].join('、');
  return `库存批次 ${issue.batchNo || issue.batchId} 被多行重复选用${
    relatedParts ? `（${relatedParts}）` : ''
  }，当前可用 ${formatQuantity(issue.availableQuantity ?? 0, issue.unit)}，合计选用 ${formatQuantity(
    issue.selectedQuantity,
    issue.unit
  )}；请调整库存来源。`;
}

export function normalizeSelectedStockSources(line: CreateOrderLinePayload) {
  const rows = new Map<
    string,
    {
      batchId: string;
      batchNo?: string;
      partCode?: string;
      partName?: string;
      quantity: number;
      availableQuantity?: number;
      unit?: string;
      replenishmentSourceType?: 'PRODUCTION_SCRAP' | 'ORDER_CHANGE' | string;
      replenishmentSourceRequestNo?: string;
      replenishmentSourceLabel?: string;
      compatibilityStatus?: 'MATCHED' | 'NEEDS_CONFIRMATION' | 'INCOMPLETE' | 'UNKNOWN';
      compatibilityReason?: string;
      manualConfirmedBy?: string;
      manualConfirmedAt?: string;
      manualConfirmRemark?: string;
    }
  >();
  for (const source of line.selectedStockSources || []) {
    const batchId = source.batchId?.trim();
    const quantity = Number(source.quantity || 0);
    if (!batchId || quantity <= 0) {
      continue;
    }
    const current = rows.get(batchId);
    const availableQuantity =
      source.availableQuantity === undefined && current?.availableQuantity === undefined
        ? undefined
        : Math.max(Number(source.availableQuantity ?? 0), Number(current?.availableQuantity ?? 0));
    rows.set(batchId, {
      batchId,
      batchNo: source.batchNo?.trim() || current?.batchNo,
      partCode: source.partCode?.trim() || current?.partCode,
      partName: source.partName?.trim() || current?.partName,
      quantity: (current?.quantity || 0) + quantity,
      availableQuantity,
      unit: source.unit?.trim() || current?.unit,
      replenishmentSourceType: source.replenishmentSourceType?.trim() || current?.replenishmentSourceType,
      replenishmentSourceRequestNo: source.replenishmentSourceRequestNo?.trim() || current?.replenishmentSourceRequestNo,
      replenishmentSourceLabel: source.replenishmentSourceLabel?.trim() || current?.replenishmentSourceLabel,
      compatibilityStatus: source.compatibilityStatus || current?.compatibilityStatus,
      compatibilityReason: source.compatibilityReason?.trim() || current?.compatibilityReason,
      manualConfirmedBy: source.manualConfirmedBy?.trim() || current?.manualConfirmedBy,
      manualConfirmedAt: source.manualConfirmedAt?.trim() || current?.manualConfirmedAt,
      manualConfirmRemark: source.manualConfirmRemark?.trim() || current?.manualConfirmRemark
    });
  }
  return [...rows.values()];
}

export function normalizeSelectedStockSourcesForPayload(line: CreateOrderLinePayload) {
  return normalizeSelectedStockSources(line).map((source) => {
    // availableQuantity 只用于前端显示和本地重复选用校验，真实可用库存必须由后端实时计算。
    const { availableQuantity, ...payload } = source;
    void availableQuantity;
    return payload;
  });
}

export function findMissingStockSourceManualConfirmation(line: CreateOrderLinePayload) {
  const selectedSources = normalizeSelectedStockSources(line);
  if (!stockSourceReviewRequired(line) || selectedSources.length === 0) {
    return '';
  }

  const missingOrderInfo = stockSourceMissingOrderInfo(line);
  const issueSource = selectedSources.find((source) => {
    const needsManualRecord = selectedStockSourceNeedsManualConfirmation(line, source, missingOrderInfo);
    return needsManualRecord && !stockSourceManualConfirmationComplete(source);
  });
  if (!issueSource) {
    return '';
  }

  const partText = `${line.partCode || '-'} / ${line.partName || '-'}`;
  const issueReason =
    issueSource.compatibilityReason ||
    (!requiredTextMatches(line.partCode, issueSource.partCode) ? '物料编码不同，属于替代库存' : '') ||
    (missingOrderInfo.length > 0 ? `本次订单缺少${missingOrderInfo.join('、')}` : '库存来源需要人工确认');
  return `${partText} 已选库存批次 ${issueSource.batchNo || issueSource.batchId} 需要填写人工确认记录：${issueReason}`;
}

export function findDirectStockSourceBlockedIssue(line: CreateOrderLinePayload) {
  if (!stockSourceReviewRequired(line)) {
    return '';
  }
  const missingReviewSource = normalizeSelectedStockSources(line).find((source) => !source.compatibilityStatus);
  if (!missingReviewSource) {
    return '';
  }
  const partText = `${line.partCode || '-'} / ${line.partName || '-'}`;
  return `${partText} 已选库存批次 ${
    missingReviewSource.batchNo || missingReviewSource.batchId
  } 缺少库存来源核对结果，请重新打开库存来源并确认后再保存。`;
}

export function selectedStockSourceNeedsManualConfirmation(
  line: CreateOrderLinePayload,
  source: { partCode?: string; compatibilityStatus?: 'MATCHED' | 'NEEDS_CONFIRMATION' | 'INCOMPLETE' | 'UNKNOWN' },
  missingOrderInfo = stockSourceMissingOrderInfo(line)
) {
  const explicitCompatibilityIssue =
    source.compatibilityStatus === 'NEEDS_CONFIRMATION' ||
    source.compatibilityStatus === 'INCOMPLETE' ||
    source.compatibilityStatus === 'UNKNOWN';
  return (
    explicitCompatibilityIssue ||
    !requiredTextMatches(line.partCode, source.partCode) ||
    Boolean(line.fulfillmentMode === 'STOCK' && missingOrderInfo.length > 0)
  );
}

export function stockSourceManualConfirmationComplete(source: {
  manualConfirmedBy?: string;
  manualConfirmedAt?: string;
  manualConfirmRemark?: string;
}) {
  const confirmedAt = source.manualConfirmedAt?.trim();
  return Boolean(
    source.manualConfirmedBy?.trim() &&
      confirmedAt &&
      !Number.isNaN(new Date(confirmedAt).getTime()) &&
      source.manualConfirmRemark?.trim()
  );
}

export function stockSourceMissingOrderInfo(line: CreateOrderLinePayload) {
  return [
    !String(line.drawingNo || '').trim() ? '图号' : '',
    !String(line.drawingVersion || '').trim() ? '图纸版本' : '',
    !String(line.partSpecification || '').trim() ? '成品规格' : '',
    Number(line.partThickness || 0) <= 0 ? '零件厚度' : ''
  ].filter(Boolean);
}

export function stockSourceComparableKey(line: StockSourceComparableLine) {
  return [
    line.fulfillmentMode || 'PRODUCTION',
    line.partCode,
    line.unit,
    line.drawingNo,
    line.drawingVersion,
    line.partSpecification,
    line.partThickness
  ]
    .map(normalize)
    .join('|');
}

function sourceHasDirectStockDrawingInfo(source: InventorySourceBatchDetail) {
  // 来源图纸完整时才算自动匹配；资料缺失时不硬拦截，但必须转人工确认记录。
  return Boolean(source.drawingNo?.trim() && source.drawingVersion?.trim() && source.drawingFileUrl?.trim());
}

function requiredTextMatches(required?: string | null, actual?: string | null) {
  const normalizedRequired = normalize(required);
  if (!normalizedRequired) {
    return true;
  }
  return normalizedRequired === normalize(actual);
}

function requiredNumberMatches(required?: number | null, actual?: number | null) {
  const requiredNumber = Number(required || 0);
  if (!requiredNumber) {
    return true;
  }
  const actualNumber = Number(actual || 0);
  if (!actualNumber) {
    return false;
  }
  return Math.abs(requiredNumber - actualNumber) < 0.0001;
}

export function sanitizeOrderLinePayload(line: CreateOrderLinePayload, fallbackDeliveryDate?: string): CreateOrderLinePayload {
  const fulfillmentMode = line.fulfillmentMode || 'PRODUCTION';
  const quantity = Number(line.quantity || 0);
  const suggestedQuantity = suggestedProductionPlanQuantity(line);
  const productionPlanQuantity = Math.max(Number(line.productionPlanQuantity ?? suggestedQuantity), 0);
  const planOverrideRequired = Math.abs(productionPlanQuantity - suggestedQuantity) > 0.0001;
  return {
    partCode: line.partCode,
    partName: line.partName,
    drawingNo: line.drawingNo,
    drawingVersion: line.drawingVersion,
    drawingFileName: line.drawingFileName,
    drawingFileUrl: line.drawingFileUrl,
    partThickness: Number(line.partThickness || 0),
    partSpecification: line.partSpecification,
    quantity,
    productionPlanQuantity,
    productionPlanSuggestedQuantity: suggestedQuantity,
    productionPlanOverrideByCode: planOverrideRequired ? line.productionPlanOverrideByCode?.trim() : undefined,
    productionPlanOverrideReason: planOverrideRequired ? line.productionPlanOverrideReason?.trim() : undefined,
    fulfillmentMode,
    unit: line.unit,
    deliveryDate: line.deliveryDate || fallbackDeliveryDate,
    remark: line.remark,
    processSteps: fulfillmentMode === 'STOCK' && productionPlanQuantity <= 0 ? [] : line.processSteps || [],
    selectedStockSources: stockSourceReviewRequired(line) ? normalizeSelectedStockSourcesForPayload(line) : []
  };
}
