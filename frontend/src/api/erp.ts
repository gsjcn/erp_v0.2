import { request } from './http';
import type {
  CommonStatus,
  Customer,
  InventoryBatch,
  InventoryStatus,
  OrderDetail,
  OrderStatisticsResponse,
  OrderStatus,
  OrderSummary,
  ProductionAnnualSummaryRow,
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
  quantity: number;
  productionPlanQuantity?: number;
  unit: string;
  deliveryDate?: string;
  remark?: string;
  processSteps?: string[];
}

export interface CreateOrderPayload {
  customerId: string;
  orderNo?: string;
  orderDate?: string;
  deliveryDate?: string;
  remark?: string;
  lines: CreateOrderLinePayload[];
}

export interface OrderFilters {
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: OrderStatus;
}

export interface InventoryFilters {
  keyword?: string;
  warehouseId?: string;
  orderNo?: string;
  status?: InventoryStatus;
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

export interface OrderStatisticsFilters {
  period?: 'year' | 'quarter' | 'month';
  year?: number;
}

export interface CreateWarehousePayload {
  warehouseCode?: string;
  warehouseName: string;
}

export interface CreateWarehouseLocationPayload {
  locationCode: string;
  locationName?: string;
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
  customers(keyword?: string) {
    return request<Customer[]>(`/customers${toQuery({ keyword })}`);
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
  checkOrderNo(orderNo: string) {
    return request<{ orderNo: string; exists: boolean; available: boolean }>(`/orders/check-no${toQuery({ orderNo })}`);
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
  updateLineProcess(orderNo: string, lineId: string, steps: string[]) {
    return request<OrderDetail>(`/orders/${orderNo}/lines/${lineId}/process`, {
      method: 'PATCH',
      body: JSON.stringify({ steps })
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
  orderStatistics(filters: OrderStatisticsFilters) {
    return request<OrderStatisticsResponse>(
      `/statistics/orders${toQuery({
        period: filters.period,
        year: filters.year ? String(filters.year) : undefined
      })}`
    );
  },
  startProduction(id: string) {
    return request<ProductionTask>(`/production/tasks/${id}/start`, { method: 'POST' });
  },
  completeProduction(id: string, completedQuantity: number, remark?: string) {
    return request<ProductionTask>(`/production/tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ completedQuantity, remark })
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
  confirmReceipt(productionTaskId: string, warehouseId?: string, locationId?: string) {
    return request(`/warehouse/receipts/${productionTaskId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ warehouseId, locationId })
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
  confirmShipment(batchId: string) {
    return request(`/warehouse/shipments/${batchId}/confirm`, { method: 'POST', body: JSON.stringify({}) });
  },
  warehouseTransactions(transactionType?: 'IN' | 'OUT') {
    return request<WarehouseTransaction[]>(`/warehouse/transactions${toQuery({ transactionType })}`);
  },
  inventory(filters: InventoryFilters) {
    return request<InventoryBatch[]>(
      `/inventory${toQuery({
        keyword: filters.keyword,
        warehouseId: filters.warehouseId,
        orderNo: filters.orderNo,
        status: filters.status
      })}`
    );
  }
};
