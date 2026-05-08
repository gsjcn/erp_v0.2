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
    return Number(line.productionPlanQuantity || line.quantity || 0);
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
  if (
    selectedQuantity <= 0 ||
    selectedQuantity + 0.0001 < stockSourceRequiredQuantity(line) ||
    selectedQuantity > stockSourceRequiredQuantity(line) + 0.0001
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

export function validateReviewedStockSourceLines(lines: CreateOrderLinePayload[]) {
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
    if (!stockSourceReviewRequired(line)) {
      continue;
    }

    const manualIssue = findMissingStockSourceManualConfirmation(line);
    if (manualIssue) {
      return {
        ok: false,
        message: manualIssue
      };
    }
    const overSelectedIssue = findOverSelectedStockSourceQuantity(line);
    if (overSelectedIssue) {
      return {
        ok: false,
        message: overSelectedIssue
      };
    }

    const partText = `${line.partCode || '-'} / ${line.partName || '-'}`;
    const requiredQuantity = stockSourceRequiredQuantity(line);
    if (line.fulfillmentMode === 'STOCK') {
      const key = stockSourceComparableKey(line);
      const selectedQuantity = selectedStockSourceQuantity(line);
      const row =
        stockGroups.get(key) ??
        {
          partText,
          unit: line.unit || '件',
          requiredQuantity: 0,
          matchedQuantity: selectedQuantity ? 0 : Number(line.stockSourceMatchedQuantity || 0)
        };
      row.requiredQuantity += requiredQuantity;
      row.matchedQuantity = selectedQuantity
        ? row.matchedQuantity + selectedQuantity
        : Math.max(row.matchedQuantity, Number(line.stockSourceMatchedQuantity || 0));
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
        availableQuantity: selectedQuantity ? 0 : Number(line.stockSourceAvailableQuantity || 0)
      };
    row.requiredQuantity += requiredQuantity;
    row.availableQuantity = selectedQuantity
      ? row.availableQuantity + selectedQuantity
      : Math.max(row.availableQuantity, Number(line.stockSourceAvailableQuantity || 0));
    reworkGroups.set(reworkKey, row);
  }

  const insufficientStock = [...stockGroups.values()].find((row) => row.requiredQuantity > row.matchedQuantity + 0.0001);
  if (insufficientStock) {
    return {
      ok: false,
      message: `${insufficientStock.partText} 匹配库存不足：合计需要 ${formatQuantity(
        insufficientStock.requiredQuantity,
        insufficientStock.unit
      )}，已核对匹配库存只有 ${formatQuantity(insufficientStock.matchedQuantity, insufficientStock.unit)}。`
    };
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

export function normalizeSelectedStockSources(line: CreateOrderLinePayload) {
  const rows = new Map<
    string,
    {
      batchId: string;
      batchNo?: string;
      partCode?: string;
      partName?: string;
      quantity: number;
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
    rows.set(batchId, {
      batchId,
      batchNo: source.batchNo?.trim() || current?.batchNo,
      partCode: source.partCode?.trim() || current?.partCode,
      partName: source.partName?.trim() || current?.partName,
      quantity: (current?.quantity || 0) + quantity,
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

export function selectedStockSourceNeedsManualConfirmation(
  line: CreateOrderLinePayload,
  source: { partCode?: string; compatibilityStatus?: 'MATCHED' | 'NEEDS_CONFIRMATION' | 'INCOMPLETE' | 'UNKNOWN' },
  missingOrderInfo = stockSourceMissingOrderInfo(line)
) {
  return (
    source.compatibilityStatus !== 'MATCHED' ||
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
  // 直接使用库存必须能看到库存来源图纸文件；否则只能提示改为库存再加工或重新生产。
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
    productionPlanQuantity:
      fulfillmentMode === 'STOCK' ? 0 : Math.max(Number(line.productionPlanQuantity || quantity), quantity),
    fulfillmentMode,
    unit: line.unit,
    deliveryDate: line.deliveryDate || fallbackDeliveryDate,
    remark: line.remark,
    processSteps: line.processSteps || [],
    selectedStockSources: stockSourceReviewRequired(line) ? normalizeSelectedStockSources(line) : []
  };
}
