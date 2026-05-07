import type { CreateOrderLinePayload } from '../api/erp';
import type { InventorySummaryRow } from '../types/erp';

type StockCheckLine = Pick<
  CreateOrderLinePayload,
  'partCode' | 'partName' | 'quantity' | 'productionPlanQuantity' | 'unit' | 'fulfillmentMode'
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
  return matchedStockSummary(line, inventorySummary)?.stockInventoryQuantity || 0;
}

export function validateStockModeLines(lines: StockCheckLine[], inventorySummary: InventorySummaryRow[]) {
  const requiredRows = new Map<
    string,
    {
      partText: string;
      unit: string;
      requiredQuantity: number;
      availableQuantity: number;
    }
  >();

  for (const line of lines) {
    if (line.fulfillmentMode !== 'STOCK' && line.fulfillmentMode !== 'REWORK') {
      continue;
    }

    const summary = matchedStockSummary(line, inventorySummary);
    const key = summary
      ? `${summary.partCode}__${summary.unit}`
      : `${line.partCode || line.partName || 'UNKNOWN'}__${line.unit}`;
    const row =
      requiredRows.get(key) ??
      {
        partText: summary ? `${summary.partCode} / ${summary.partName}` : `${line.partCode || '-'} / ${line.partName || '-'}`,
        unit: summary?.unit || line.unit,
        requiredQuantity: 0,
        availableQuantity: summary?.stockInventoryQuantity || 0
      };
    // STOCK 只占用客户订单数量；REWORK 要按生产计划数量领用库存，避免多计划数量少扣库存。
    row.requiredQuantity += line.fulfillmentMode === 'REWORK' ? Number(line.productionPlanQuantity || line.quantity || 0) : Number(line.quantity || 0);
    requiredRows.set(key, row);
  }

  const insufficient = [...requiredRows.values()].find((row) => row.requiredQuantity > row.availableQuantity);
  if (!insufficient) {
    return { ok: true, message: '' };
  }

  return {
    ok: false,
    message: `${insufficient.partText} 备货库存不足，当前 ${insufficient.availableQuantity} ${insufficient.unit}，需要 ${insufficient.requiredQuantity} ${insufficient.unit}`
  };
}
