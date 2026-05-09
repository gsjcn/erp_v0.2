import type { CreateOrderLinePayload } from '../api/erp';
import type { OrderLine } from '../types/erp';
import { formatQuantity } from './format';
import {
  findOverSelectedStockSourceQuantity,
  findDirectStockSourceBlockedIssue,
  findMissingStockSourceManualConfirmation,
  findOverusedSelectedStockBatchIssue,
  findSelectedStockSourceQuantityIssue,
  selectedStockSourceQuantity,
  stockSourceComparableKey,
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
  const stockPayloadLines = stockLines.map(toStockSourcePayload);
  const overusedBatchIssue = findOverusedSelectedStockBatchIssue(stockPayloadLines);
  if (overusedBatchIssue) {
    return {
      ok: false,
      message: overusedBatchIssue
    };
  }

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

  for (const line of stockPayloadLines) {
    if (line.fulfillmentMode === 'STOCK') {
      const missingStockInfo = stockSourceMissingOrderInfo(line);
      if (missingStockInfo.length > 0) {
        return {
          ok: false,
          message: `${line.partCode} / ${line.partName} 直接使用库存前必须补齐：${missingStockInfo.join('、')}；否则请选择库存再加工或重新生产。`
        };
      }
    }

    const missingManualConfirmation = findMissingStockSourceManualConfirmation(line);
    if (missingManualConfirmation) {
      return {
        ok: false,
        message: missingManualConfirmation
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
    const selectedQuantityIssue = findSelectedStockSourceQuantityIssue(line);
    if (selectedQuantityIssue) {
      return {
        ok: false,
        message: selectedQuantityIssue
      };
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
          matchedQuantity: 0
        };
      // 提交生产前按图号、版本、规格、厚度合并校验，避免多行同时占用同一批匹配库存后超量。
      row.requiredQuantity += requiredQuantity;
      row.matchedQuantity += selectedQuantity;
      stockRequirements.set(requirementKey, row);
      continue;
    }

    const sourceKey = `${line.partCode.trim().toLocaleLowerCase()}__${line.unit.trim().toLocaleLowerCase()}`;
    const reworkKey = `REWORK__${sourceKey}`;
    const row =
      reworkRequirements.get(reworkKey) ??
      {
        line,
        partText,
        requiredQuantity: 0,
        availableQuantity: 0
      };
    row.requiredQuantity += requiredQuantity;
    row.availableQuantity += selectedQuantity;
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
