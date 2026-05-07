import { apiBaseUrl, request } from './http';
import type {
  CommonStatus,
  Customer,
  InventoryBatch,
  InventoryAdjustment,
  InventoryMaterialSuggestion,
  InventorySummaryRow,
  InventoryStatus,
  OrderLineFulfillmentMode,
  OrderDetail,
  ProcessStepDetail,
  OrderStatisticsResponse,
  OrderStatus,
  OrderSummary,
  ProductionAnnualSummaryRow,
  ProductionNotice,
  ProductionNoticeStatus,
  ProductionNoticeTarget,
  ProductionOperator,
  ProductionScrapRecord,
  ProductionShortageMode,
  ProductionStatus,
  ProductionTask,
  Warehouse,
  WarehouseShipment,
  WarehouseTransaction,
  WarehouseReceipt
} from '../types/erp';

export interface CreateOrderLinePayload {
  partCode: string;
  partName: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness: number;
  partSpecification?: string;
  quantity: number;
  productionPlanQuantity?: number;
  fulfillmentMode?: OrderLineFulfillmentMode;
  unit: string;
  deliveryDate?: string;
  remark?: string;
  processSteps?: ProcessStepDetail[];
}

export interface CreateOrderPayload {
  customerId: string;
  orderNo?: string;
  orderDate?: string;
  deliveryDate?: string;
  remark?: string;
  lines: CreateOrderLinePayload[];
}

export interface DrawingUploadResponse {
  fileName: string;
  storedFileName: string;
  fileUrl: string;
  size: number;
  mimeType: string;
}

export interface DrawingDuplicateMatch {
  orderNo: string;
  customerName: string;
  orderDate?: string;
  partCode: string;
  partName: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
}

export interface OrderFilters {
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: OrderStatus;
}

export interface InventoryFilters {
  keyword?: string;
  customerId?: string;
  warehouseId?: string;
  orderNo?: string;
  status?: InventoryStatus;
}

export interface AdjustInventoryBatchPayload {
  afterQuantity: number;
  countedBy: string;
  countedAt?: string;
  signatureName: string;
  attachmentFileName?: string;
  attachmentFileUrl?: string;
  attachmentMimeType?: string;
  attachmentSize?: number;
  remark?: string;
}

export interface InventoryAdjustmentUploadResponse {
  fileName: string;
  storedFileName: string;
  fileUrl: string;
  size: number;
  mimeType: string;
}

export interface ProductionTaskFilters {
  customerId?: string;
  orderNo?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: ProductionStatus;
}

export interface WarehouseWorkFilters {
  customerId?: string;
  orderNo?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CompleteProcessStepPayload {
  processName: string;
  isCompleted: boolean;
  completedQuantity?: number;
  operatorCode?: string;
  operatorCodes?: string[];
  scrapQuantity?: number;
  shortageMode?: ProductionShortageMode;
  createReplenishment?: boolean;
  managerName?: string;
  shortageReason?: string;
  quantityOverrideReason?: string;
  remark?: string;
}

export interface CompleteProcessStepsPayload {
  processNames: string[];
  completedQuantity: number;
  operatorCode?: string;
  operatorCodes?: string[];
  operatorsByProcess?: Array<{
    processName: string;
    operatorCodes?: string[];
  }>;
  scrapQuantity?: number;
  shortageMode?: ProductionShortageMode;
  createReplenishment?: boolean;
  managerName?: string;
  shortageReason?: string;
  quantityOverrideReason?: string;
  remark?: string;
}

export interface CompleteProductionPayload {
  completedQuantity: number;
  operatorCode?: string;
  operatorCodes?: string[];
  scrapQuantity?: number;
  shortageMode?: ProductionShortageMode;
  createReplenishment?: boolean;
  managerName?: string;
  shortageReason?: string;
  remark?: string;
}

export interface CreateLineReplenishmentPayload {
  quantity: number;
  reason: string;
  managerName?: string;
}

export interface CreateAdditionalMaterialPayload extends CreateOrderLinePayload {
  reason: string;
  managerName?: string;
}

export interface UpdateLineQuantityPayload {
  quantity: number;
  productionPlanQuantity?: number;
  reason: string;
  managerName?: string;
}

export interface CancelStartedOrderPayload {
  reason: string;
  managerName?: string;
}

export interface WithdrawProductionTaskPayload {
  managerName: string;
  reason: string;
  handlingMode: 'STOCK' | 'SCRAP' | 'NONE';
  handlingQuantity: number;
  handledAt?: string | Date;
  remark?: string;
}

export interface OrderStatisticsFilters {
  period?: 'year' | 'quarter' | 'month';
  year?: number;
  customerId?: string;
}

export interface CreateWarehousePayload {
  warehouseCode?: string;
  warehouseName: string;
}

export interface CreateWarehouseLocationPayload {
  locationCode: string;
  locationName?: string;
}

export interface ProductionScrapFilters {
  orderNo?: string;
  dateFrom?: string;
  dateTo?: string;
}

function toQuery(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      search.set(key, value);
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const erpApi = {
  customers(keyword?: string, status?: CommonStatus) {
    return request<Customer[]>(`/customers${toQuery({ keyword, status })}`);
  },
  checkCustomerName(customerName: string, excludeId?: string) {
    return request<{ customerName: string; exists: boolean; available: boolean }>(
      `/customers/check-name${toQuery({ customerName, excludeId })}`
    );
  },
  checkCustomerCode(customerCode: string, excludeId?: string) {
    return request<{ customerCode: string; exists: boolean; available: boolean }>(
      `/customers/check-code${toQuery({ customerCode, excludeId })}`
    );
  },
  nextCustomerCode() {
    return request<{ customerCode: string }>('/customers/next-code');
  },
  createCustomer(payload: Partial<Customer>) {
    return request<Customer>('/customers', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateCustomer(id: string, payload: Partial<Customer>) {
    return request<Customer>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  updateCustomerStatus(id: string, status: CommonStatus) {
    return request<Customer>(`/customers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
  orders(filters: OrderFilters) {
    return request<OrderSummary[]>(
      `/orders${toQuery({
        customerId: filters.customerId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status
      })}`
    );
  },
  order(orderNo: string) {
    return request<OrderDetail>(`/orders/${orderNo}`);
  },
  nextOrderNo(orderDate?: string) {
    return request<{ orderNo: string }>(`/orders/next-no${toQuery({ orderDate })}`);
  },
  checkOrderNo(orderNo: string, excludeOrderNo?: string) {
    return request<{ orderNo: string; exists: boolean; available: boolean }>(
      `/orders/check-no${toQuery({ orderNo, excludeOrderNo })}`
    );
  },
  duplicateDrawingNos(value: string, excludeOrderNo?: string) {
    return request<DrawingDuplicateMatch[]>(`/orders/drawings/duplicate-nos${toQuery({ value, excludeOrderNo })}`);
  },
  duplicateDrawingFiles(value: string, excludeOrderNo?: string) {
    return request<DrawingDuplicateMatch[]>(`/orders/drawings/duplicate-files${toQuery({ value, excludeOrderNo })}`);
  },
  async uploadDrawing(file: File) {
    const formData = new FormData();
    formData.set('file', file);
    const response = await fetch(`${apiBaseUrl}/orders/drawings/upload`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      throw new Error((await response.text()) || '图纸上传失败');
    }
    return response.json() as Promise<DrawingUploadResponse>;
  },
  createOrder(payload: CreateOrderPayload) {
    return request<OrderDetail>('/orders', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateOrder(orderNo: string, payload: Omit<CreateOrderPayload, 'customerId' | 'orderDate'>) {
    return request<OrderDetail>(`/orders/${orderNo}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  submitOrder(orderNo: string) {
    return request<OrderDetail>(`/orders/${orderNo}/submit`, { method: 'POST' });
  },
  updateLineProcess(orderNo: string, lineId: string, steps: ProcessStepDetail[]) {
    return request<OrderDetail>(`/orders/${orderNo}/lines/${lineId}/process`, {
      method: 'PATCH',
      body: JSON.stringify({ steps })
    });
  },
  createLineReplenishment(orderNo: string, lineId: string, payload: CreateLineReplenishmentPayload) {
    return request<OrderDetail>(`/orders/${orderNo}/lines/${lineId}/replenishments`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  createAdditionalMaterial(orderNo: string, payload: CreateAdditionalMaterialPayload) {
    return request<OrderDetail>(`/orders/${orderNo}/lines/additional-materials`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  updateLineQuantityAfterProductionStarted(orderNo: string, lineId: string, payload: UpdateLineQuantityPayload) {
    return request<OrderDetail>(`/orders/${orderNo}/lines/${lineId}/quantity-change`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  cancelOrder(orderNo: string, payload: CancelStartedOrderPayload) {
    return request<OrderDetail>(`/orders/${orderNo}/cancel`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  cancelReplenishment(orderNo: string, productionTaskNo: string, payload: CancelStartedOrderPayload) {
    return request<OrderDetail>(`/orders/${orderNo}/replenishments/${productionTaskNo}/cancel`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  cancelOrderAfterProductionStarted(orderNo: string, payload: CancelStartedOrderPayload) {
    return request<OrderDetail>(`/orders/${orderNo}/cancel-after-production-started`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  productionTasks(filters: ProductionTaskFilters = {}) {
    return request<ProductionTask[]>(
      `/production/tasks${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status
      })}`
    );
  },
  productionAnnualSummary(year: number) {
    return request<ProductionAnnualSummaryRow[]>(`/production/tasks/annual-summary${toQuery({ year: String(year) })}`);
  },
  productionOperators(keyword?: string) {
    return request<ProductionOperator[]>(`/production/tasks/operators${toQuery({ keyword })}`);
  },
  productionNotices(status?: ProductionNoticeStatus, target?: ProductionNoticeTarget) {
    return request<ProductionNotice[]>(`/production/tasks/notices${toQuery({ status, target })}`);
  },
  acknowledgeProductionNotice(id: string, acknowledgedBy: string) {
    return request<ProductionNotice>(`/production/tasks/notices/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ acknowledgedBy })
    });
  },
  productionScrapRecords(filters: ProductionScrapFilters = {}) {
    return request<ProductionScrapRecord[]>(
      `/production/tasks/scrap-records${toQuery({
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo
      })}`
    );
  },
  orderStatistics(filters: OrderStatisticsFilters) {
    return request<OrderStatisticsResponse>(
      `/statistics/orders${toQuery({
        period: filters.period,
        year: filters.year ? String(filters.year) : undefined,
        customerId: filters.customerId
      })}`
    );
  },
  startProduction(id: string) {
    return request<ProductionTask>(`/production/tasks/${id}/start`, { method: 'POST' });
  },
  completeProduction(id: string, payload: CompleteProductionPayload) {
    return request<ProductionTask>(`/production/tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  withdrawProductionTask(id: string, payload: WithdrawProductionTaskPayload) {
    return request<ProductionTask>(`/production/tasks/${id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  completeProcessStep(id: string, payload: CompleteProcessStepPayload) {
    return request<ProductionTask>(`/production/tasks/${id}/process-completions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  completeProcessSteps(id: string, payload: CompleteProcessStepsPayload) {
    return request<ProductionTask>(`/production/tasks/${id}/process-completions/batch`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  warehouses() {
    return request<Warehouse[]>('/warehouses');
  },
  createWarehouse(payload: CreateWarehousePayload) {
    return request<Warehouse>('/warehouses', { method: 'POST', body: JSON.stringify(payload) });
  },
  createWarehouseLocation(warehouseId: string, payload: CreateWarehouseLocationPayload) {
    return request(`/warehouses/${warehouseId}/locations`, { method: 'POST', body: JSON.stringify(payload) });
  },
  pendingReceipts(filters: WarehouseWorkFilters = {}) {
    return request<WarehouseReceipt[]>(
      `/warehouse/receipts/pending${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo
      })}`
    );
  },
  confirmReceipt(productionTaskId: string, warehouseId?: string, locationId?: string, remark?: string) {
    return request(`/warehouse/receipts/${productionTaskId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ warehouseId, locationId, remark })
    });
  },
  pendingShipments(filters: WarehouseWorkFilters = {}) {
    return request<WarehouseShipment[]>(
      `/warehouse/shipments/pending${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo
      })}`
    );
  },
  confirmShipment(batchId: string, remark?: string) {
    return request(`/warehouse/shipments/${batchId}/confirm`, { method: 'POST', body: JSON.stringify({ remark }) });
  },
  warehouseNotices(status?: ProductionNoticeStatus) {
    return request<ProductionNotice[]>(`/warehouse/notices${toQuery({ status })}`);
  },
  acknowledgeWarehouseNotice(id: string, acknowledgedBy: string) {
    return request<ProductionNotice>(`/warehouse/notices/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ acknowledgedBy })
    });
  },
  warehouseTransactions(transactionType?: 'IN' | 'OUT') {
    return request<WarehouseTransaction[]>(`/warehouse/transactions${toQuery({ transactionType })}`);
  },
  inventory(filters: InventoryFilters) {
    return request<InventoryBatch[]>(
      `/inventory${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        warehouseId: filters.warehouseId,
        orderNo: filters.orderNo,
        status: filters.status
      })}`
    );
  },
  inventorySummary(filters: InventoryFilters) {
    return request<InventorySummaryRow[]>(
      `/inventory/summary${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        warehouseId: filters.warehouseId,
        orderNo: filters.orderNo,
        status: filters.status
      })}`
    );
  },
  inventoryMaterialSuggestions(keyword: string, warehouseId?: string) {
    return request<InventoryMaterialSuggestion[]>(
      `/inventory/materials/suggestions${toQuery({
        keyword,
        warehouseId
      })}`
    );
  },
  async uploadInventoryAdjustmentFile(file: File) {
    const formData = new FormData();
    formData.set('file', file);
    const response = await fetch(`${apiBaseUrl}/inventory/adjustments/upload`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      throw new Error((await response.text()) || '盘点附件上传失败');
    }
    return response.json() as Promise<InventoryAdjustmentUploadResponse>;
  },
  adjustInventoryBatch(batchId: string, payload: AdjustInventoryBatchPayload) {
    return request<InventoryAdjustment>(`/inventory/batches/${batchId}/adjust`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  inventoryBatchAdjustments(batchId: string) {
    return request<InventoryAdjustment[]>(`/inventory/batches/${batchId}/adjustments`);
  }
};
