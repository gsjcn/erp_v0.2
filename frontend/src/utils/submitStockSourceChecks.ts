import { erpApi } from '../api/erp';
import type { CreateOrderLinePayload } from '../api/erp';
import type { OrderLine } from '../types/erp';
import { formatQuantity } from './format';
import {
  findOverSelectedStockSourceQuantity,
  findMissingStockSourceManualConfirmation,
  matchedInventorySourceQuantity,
  normalizeSelectedStockSources,
  selectedStockSourceQuantity,
  stockSourceComparableKey,
  stockSourceManualConfirmationComplete,
  stockSourceMissingOrderInfo,
  stockSourceRequiredQuantity
} from './stockSourceReview';

function toStockSourcePayload(line: OrderLine): CreateOrderLinePayload {
  return {
    partCode: line.partCode,
    partName: line.partName,
    drawingNo: line.drawingNo,
    drawingVersion: line.drawingVersion,
    drawingFileName: line.drawingFileName,
    drawingFileUrl: line.drawingFileUrl,
    partThickness: line.partThickness,
    partSpecification: line.partSpecification,
    quantity: line.quantity,
    productionPlanQuantity: line.productionPlanQuantity,
    fulfillmentMode: line.fulfillmentMode,
    unit: line.unit,
    deliveryDate: line.deliveryDate,
    remark: line.remark,
    processSteps: line.processStepDetails,
    selectedStockSources: line.selectedStockSources
  };
}

export async function validateSubmitStockSources(lines: OrderLine[]) {
  const stockLines = lines.filter((line) => line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK');
  if (stockLines.length === 0) {
    return { ok: true, message: '' };
  }

  const sourceCache = new Map<string, Awaited<ReturnType<typeof erpApi.inventoryMaterialSourceDetails>>>();
  const stockRequirements = new Map<
    string,
    {
      line: CreateOrderLinePayload;
      partText: string;
      requiredQuantity: number;
      matchedQuantity: number;
    }
  >();
  const reworkRequirements = new Map<
    string,
    {
      line: CreateOrderLinePayload;
      partText: string;
      requiredQuantity: number;
      availableQuantity: number;
    }
  >();

  for (const orderLine of stockLines) {
    const line = toStockSourcePayload(orderLine);
    const missingManualConfirmation = findMissingStockSourceManualConfirmation(line);
    if (missingManualConfirmation) {
      return {
        ok: false,
        message: missingManualConfirmation
      };
    }
    const overSelectedIssue = findOverSelectedStockSourceQuantity(line);
    if (overSelectedIssue) {
      return {
        ok: false,
        message: overSelectedIssue
      };
    }

    if (line.fulfillmentMode === 'STOCK') {
      const missingStockInfo = stockSourceMissingOrderInfo(line);
      const selectedSources = normalizeSelectedStockSources(line);
      const manualOverrideOk = selectedSources.length > 0 && selectedSources.every((source) => stockSourceManualConfirmationComplete(source));
      if (missingStockInfo.length > 0 && !manualOverrideOk) {
        return {
          ok: false,
          message: `${line.partCode} / ${line.partName} 直接使用库存前必须补齐：${missingStockInfo.join('、')}；如确需使用库存，必须逐批填写人工确认记录。`
        };
      }
    }

    const sourceKey = `${line.partCode.trim().toLocaleLowerCase()}__${line.unit.trim().toLocaleLowerCase()}`;
    let detail = sourceCache.get(sourceKey);
    if (!detail) {
      detail = await erpApi.inventoryMaterialSourceDetails(line.partCode.trim(), {
        unit: line.unit,
        sourceType: 'STOCK'
      });
      sourceCache.set(sourceKey, detail);
    }

    const requiredQuantity = stockSourceRequiredQuantity(line);
    const partText = `${line.partCode} / ${line.partName}`;
    const selectedQuantity = selectedStockSourceQuantity(line);
    if (line.fulfillmentMode === 'STOCK') {
      const requirementKey = `STOCK__${stockSourceComparableKey(line)}`;
      const row =
        stockRequirements.get(requirementKey) ??
        {
          line,
          partText,
          requiredQuantity: 0,
          matchedQuantity: selectedQuantity ? 0 : matchedInventorySourceQuantity(detail.sources, line)
        };
      // 提交生产前按图号、版本、规格、厚度合并校验，避免多行同时占用同一批匹配库存后超量。
      row.requiredQuantity += requiredQuantity;
      row.matchedQuantity = selectedQuantity
        ? row.matchedQuantity + selectedQuantity
        : Math.max(row.matchedQuantity, matchedInventorySourceQuantity(detail.sources, line));
      stockRequirements.set(requirementKey, row);
      continue;
    }

    const reworkKey = `REWORK__${sourceKey}`;
    const row =
      reworkRequirements.get(reworkKey) ??
      {
        line,
        partText,
        requiredQuantity: 0,
        availableQuantity: selectedQuantity ? 0 : detail.availableQuantity
      };
    row.requiredQuantity += requiredQuantity;
    row.availableQuantity = selectedQuantity ? row.availableQuantity + selectedQuantity : Math.max(row.availableQuantity, detail.availableQuantity);
    reworkRequirements.set(reworkKey, row);
  }

  const insufficientStock = [...stockRequirements.values()].find((row) => row.requiredQuantity > row.matchedQuantity);
  if (insufficientStock) {
    return {
      ok: false,
      message: `${insufficientStock.partText} 匹配库存不足：需要 ${formatQuantity(
        insufficientStock.requiredQuantity,
        insufficientStock.line.unit
      )}，按图号/版本/规格/厚度匹配只有 ${formatQuantity(insufficientStock.matchedQuantity, insufficientStock.line.unit)}。请改为库存再加工或重新生产。`
    };
  }

  const insufficientRework = [...reworkRequirements.values()].find((row) => row.requiredQuantity > row.availableQuantity);
  if (insufficientRework) {
    return {
      ok: false,
      message: `${insufficientRework.partText} 库存再加工备货不足：需要 ${formatQuantity(
        insufficientRework.requiredQuantity,
        insufficientRework.line.unit
      )}，当前可用 ${formatQuantity(insufficientRework.availableQuantity, insufficientRework.line.unit)}。`
    };
  }

  return { ok: true, message: '' };
}
