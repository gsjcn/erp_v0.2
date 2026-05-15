import type { CreateOrderLinePayload } from '../api/erp';
import type { InventorySummaryRow } from '../types/erp';

type StockCheckLine = Pick<
  CreateOrderLinePayload,
  'partCode' | 'partName' | 'quantity' | 'productionPlanQuantity' | 'unit' | 'fulfillmentMode' | 'selectedStockSources'
>;

export function matchedStockSummary(line: StockCheckLine, inventorySummary: InventorySummaryRow[]) {
  const partCode = line.partCode?.trim().toLocaleLowerCase();
  const partName = line.partName?.trim().toLocaleLowerCase();
  return inventorySummary.find((item) => {
    const sameUnit = item.unit === line.unit;
    if (partCode && item.partCode.toLocaleLowerCase() === partCode && sameUnit) {
      return true;
    }
    return Boolean(partName && item.partName.toLocaleLowerCase() === partName && sameUnit);
  });
}

export function availableStockQuantity(line: StockCheckLine, inventorySummary: InventorySummaryRow[]) {
  return matchedStockSummary(line, inventorySummary)?.stockInventoryQuantity ?? 0;
}

export function validateStockModeLines(lines: StockCheckLine[], inventorySummary: InventorySummaryRow[]) {
  const requiredRows = new Map<
    string,
    {
      partText: string;
      unit: string;
      requiredQuantity: number;
      availableQuantity: number;
      summaryAvailabilityCounted: boolean;
    }
  >();

  for (const line of lines) {
    if (line.fulfillmentMode !== 'STOCK' && line.fulfillmentMode !== 'REWORK') {
      continue;
    }

    const summary = matchedStockSummary(line, inventorySummary);
    const selectedQuantity = selectedStockSourceQuantity(line);
    const key = summary
      ? `${summary.partCode}__${summary.unit}`
      : `${line.partCode || line.partName || 'UNKNOWN'}__${line.unit}`;
    const row =
      requiredRows.get(key) ??
      {
        partText: summary ? `${summary.partCode} / ${summary.partName}` : `${line.partCode || '-'} / ${line.partName || '-'}`,
        unit: summary?.unit || line.unit,
        requiredQuantity: 0,
        availableQuantity: 0,
        summaryAvailabilityCounted: false
      };
    // STOCK 允许库存不足，短缺数量会自动转生产计划；REWORK 必须按生产计划数量领用库存。
    if (line.fulfillmentMode === 'REWORK') {
      row.requiredQuantity += Number(line.productionPlanQuantity ?? line.quantity ?? 0);
      // 已经选择具体库存批次时，应按已选批次数量校验，允许使用替代库存；否则才用同零件库存汇总做预提示。
      if (selectedQuantity > 0) {
        row.availableQuantity += selectedQuantity;
      } else if (!row.summaryAvailabilityCounted) {
        row.availableQuantity += summary?.stockInventoryQuantity ?? 0;
        row.summaryAvailabilityCounted = true;
      }
    }
    requiredRows.set(key, row);
  }

  const insufficient = [...requiredRows.values()].find((row) => row.requiredQuantity > 0 && row.requiredQuantity > row.availableQuantity);
  if (!insufficient) {
    return { ok: true, message: '' };
  }

  return {
    ok: false,
    message: `${insufficient.partText} 备货库存不足，当前 ${insufficient.availableQuantity} ${insufficient.unit}，需要 ${insufficient.requiredQuantity} ${insufficient.unit}`
  };
}

function selectedStockSourceQuantity(line: StockCheckLine) {
  return (line.selectedStockSources || []).reduce((sum, source) => sum + Number(source.quantity ?? 0), 0);
}
