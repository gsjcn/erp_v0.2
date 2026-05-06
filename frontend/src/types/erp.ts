export type CommonStatus = 'ENABLED' | 'DISABLED';
export type CustomerRegionType = 'CHINA' | 'OVERSEAS';
export type OrderStatus = 'DRAFT' | 'SUBMITTED' | 'IN_PRODUCTION' | 'COMPLETED';
export type ProductionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
export type InventoryStatus = 'AVAILABLE' | 'USED';
export type StatisticsPeriod = 'year' | 'quarter' | 'month';

export interface Customer {
  id: string;
  customerCode: string;
  customerName: string;
  contactName?: string;
  contactPhone?: string;
  address?: string;
  regionType: CustomerRegionType;
  country: string;
  province?: string;
  state?: string;
  district?: string;
  city?: string;
  detailAddress?: string;
  remark?: string;
  status: CommonStatus;
  contacts: CustomerContact[];
}

export interface CustomerContact {
  id?: string;
  contactName: string;
  contactPhone?: string;
  title?: string;
  remark?: string;
  isPrimary?: boolean;
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  orderDate: string;
  deliveryDate?: string;
  status: OrderStatus;
  partCount: number;
  totalQuantity: number;
  totalProductionPlanQuantity: number;
  unit: string;
  remark?: string;
}

export interface OrderLine {
  id: string;
  lineNo: number;
  partCode: string;
  partName: string;
  drawingNo?: string;
  quantity: number;
  productionPlanQuantity: number;
  unit: string;
  deliveryDate?: string;
  remark?: string;
  processSteps: string[];
}

export interface OrderDetail extends OrderSummary {
  customer: Customer;
  lines: OrderLine[];
}

export interface ProductionTask {
  id: string;
  productionTaskNo: string;
  orderId: string;
  orderNo: string;
  customerId?: string;
  customerName: string;
  orderDate?: string;
  deliveryDate?: string;
  partCode: string;
  partName: string;
  plannedQuantity: number;
  completedQuantity: number;
  unit: string;
  status: ProductionStatus;
  processSteps: string[];
  startedAt?: string;
  completedAt?: string;
  remark?: string;
}

export interface ProductionAnnualSummaryRow {
  partCode: string;
  partName: string;
  unit: string;
  customerOrderQuantity: number;
  productionPlanQuantity: number;
  completedProductionQuantity: number;
  shippedOrderQuantity: number;
  stockQuantity: number;
}

export interface OrderStatisticsSummaryRow {
  periodKey: string;
  periodLabel: string;
  partCode: string;
  partName: string;
  unit: string;
  orderCount: number;
  customerOrderQuantity: number;
  productionPlanQuantity: number;
  completedProductionQuantity: number;
  shippedOrderQuantity: number;
  stockQuantity: number;
}

export interface OrderStatisticsOrderRow {
  periodKey: string;
  periodLabel: string;
  orderNo: string;
  customerName: string;
  orderDate: string;
  deliveryDate?: string;
  status: OrderStatus;
  partCount: number;
  totalQuantity: number;
  totalProductionPlanQuantity: number;
  unit: string;
}

export interface OrderStatisticsResponse {
  period: StatisticsPeriod;
  year: number;
  summaryRows: OrderStatisticsSummaryRow[];
  orderRows: OrderStatisticsOrderRow[];
}

export interface WarehouseLocation {
  id: string;
  warehouseId: string;
  locationCode: string;
  locationName: string;
  status: CommonStatus;
}

export interface Warehouse {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  status: CommonStatus;
  locations: WarehouseLocation[];
}

export interface WarehouseReceipt {
  id: string;
  productionTaskNo: string;
  customerId?: string;
  orderNo: string;
  customerName: string;
  orderDate?: string;
  deliveryDate?: string;
  partCode: string;
  partName: string;
  quantity: number;
  plannedQuantity?: number;
  completedQuantity?: number;
  orderReceiptQuantity?: number;
  stockQuantity?: number;
  unit: string;
  status: string;
  completedAt?: string;
}

export interface WarehouseShipment {
  id: string;
  batchNo: string;
  customerId?: string;
  orderNo?: string;
  customerName?: string;
  orderDate?: string;
  deliveryDate?: string;
  partCode: string;
  partName: string;
  quantity: number;
  unit: string;
  warehouseName: string;
  locationName?: string;
  status: string;
}

export interface InventoryBatch {
  id: string;
  batchNo: string;
  partCode: string;
  partName: string;
  quantity: number;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  locationId?: string;
  locationName?: string;
  sourceOrderNo?: string;
  orderDate?: string;
  deliveryDate?: string;
  sourceCustomerName?: string;
  sourceProductionTaskNo?: string;
  status: InventoryStatus;
}

export interface WarehouseTransaction {
  id: string;
  transactionNo: string;
  transactionType: 'IN' | 'OUT';
  partCode: string;
  partName: string;
  orderNo?: string;
  productionTaskNo?: string;
  quantity: number;
  unit: string;
  warehouseName: string;
  locationName?: string;
  transactionTime: string;
  remark?: string;
}
