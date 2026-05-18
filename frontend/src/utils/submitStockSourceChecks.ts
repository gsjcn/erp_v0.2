import type { CreateOrderLinePayload } from '../api/erp';
import type { OrderLine } from '../types/erp';
import { formatQuantity } from './format';
import {
  findOverSelectedStockSourceQuantity,
  findProductionPlanOverrideIssue,
  findDirectStockSourceBlockedIssue,
  findMissingStockSourceManualConfirmation,
  findOverusedSelectedStockBatchIssue,
  findSelectedStockSourceQuantityIssue,
  selectedStockSourceQuantity,
  stockSourceRequiredQuantity
} from './stockSourceReview';

function toStockSourcePayload(line: OrderLine): CreateOrderLinePayload {
  return {
    lineType: line.lineType,
    partCategory: line.partCategory,
    componentNo: line.componentNo,
    parentComponentNo: line.parentComponentNo,
    importSequence: line.importSequence,
    projectModel: line.projectModel,
    partCode: line.partCode,
    partName: line.partName,
    drawingNo: line.drawingNo,
    drawingVersion: line.drawingVersion,
    drawingDate: line.drawingDate,
    drawingStatus: line.drawingStatus,
    drawingFileName: line.drawingFileName,
    drawingFileUrl: line.drawingFileUrl,
    partThickness: line.partThickness,
    partSpecification: line.partSpecification,
    quantity: line.quantity,
    productionPlanQuantity: line.productionPlanQuantity,
    productionPlanSuggestedQuantity: line.productionPlanSuggestedQuantity,
    productionPlanOverrideByCode: line.productionPlanOverrideByCode,
    productionPlanOverrideByName: line.productionPlanOverrideByName,
    productionPlanOverrideByRole: line.productionPlanOverrideByRole,
    productionPlanOverrideAt: line.productionPlanOverrideAt,
    productionPlanOverrideReason: line.productionPlanOverrideReason,
    fulfillmentMode: line.fulfillmentMode,
    unit: line.unit,
    deliveryDate: line.deliveryDate,
    remark: line.remark,
    processSteps: line.processStepDetails,
    selectedStockSources: line.selectedStockSources
  };
}

export async function validateSubmitStockSources(lines: OrderLine[]) {
  const payloadLines = lines.map(toStockSourcePayload);
  for (const line of payloadLines) {
    const planOverrideIssue = findProductionPlanOverrideIssue(line, { requireResolvedOperator: true });
    if (planOverrideIssue) {
      return {
        ok: false,
        message: planOverrideIssue
      };
    }
  }

  const stockPayloadLines = payloadLines.filter((line) => line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK');
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
      const requirementKey = `STOCK__${line.partCode.trim().toLocaleLowerCase()}__${line.unit.trim().toLocaleLowerCase()}`;
      const row =
        stockRequirements.get(requirementKey) ??
        {
          line,
          partText,
          requiredQuantity: 0,
          matchedQuantity: 0
        };
      // STOCK 允许只用部分库存；剩余数量会自动转为生产计划。这里仅保留统计行，重复批次超量由上面的批次校验拦截。
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
