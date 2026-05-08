export type CommonStatus = 'ENABLED' | 'DISABLED';
export type CustomerRegionType = 'CHINA' | 'OVERSEAS';
export type OrderStatus = 'DRAFT' | 'SUBMITTED' | 'IN_PRODUCTION' | 'COMPLETED' | 'CANCELLED';
export type OrderLineFulfillmentMode = 'PRODUCTION' | 'STOCK' | 'REWORK';
export type ProductionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
export type ProductionShortageMode = 'REPLENISHMENT_REQUEST' | 'REPLENISHMENT' | 'MANAGER_APPROVED';
export type ProductionReplenishmentRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ProductionNoticeType = 'QUANTITY_INCREASE' | 'QUANTITY_DECREASE' | 'ORDER_CANCELLED' | 'MATERIAL_ADDED' | 'TASK_WITHDRAWN';
export type ProductionNoticeStatus = 'PENDING' | 'ACKNOWLEDGED';
export type ProductionNoticeTarget = 'PRODUCTION' | 'WAREHOUSE';
export type InventoryStatus = 'AVAILABLE' | 'USED';
export type InventorySourceType = 'ORDER' | 'STOCK';
export type InventorySourceKind = 'NORMAL_ORDER' | 'CANCELLED_ORDER' | 'CUSTOMER_CHANGE';
export type StatisticsPeriod = 'year' | 'quarter' | 'month';
export type WarehouseStage =
  | 'ORDER_DRAFT'
  | 'ORDER_CANCELLED'
  | 'WAITING_PRODUCTION'
  | 'IN_PRODUCTION_STAGE'
  | 'WAITING_RECEIPT'
  | 'WAITING_SHIPMENT'
  | 'PARTIAL_SHIPPED'
  | 'SHIPPED';

export interface ProcessStepDetail {
  processName: string;
  processRemark?: string;
}

export interface ProcessTemplate {
  id: string;
  templateName: string;
  steps: ProcessStepDetail[];
  remark?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessDefinition {
  id: string;
  processName: string;
  remark?: string;
  status: CommonStatus;
  createdAt: string;
  updatedAt: string;
}

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
  customerSearchText?: string;
  orderDate: string;
  deliveryDate?: string;
  status: OrderStatus;
  partCount: number;
  totalQuantity: number;
  totalProductionPlanQuantity: number;
  unit: string;
  productionStatus: ProductionStatus;
  warehouseStage: WarehouseStage;
  remark?: string;
}

export interface OrderLine {
  id: string;
  lineNo: number;
  partCode: string;
  partName: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness: number;
  partSpecification?: string;
  quantity: number;
  productionPlanQuantity: number;
  fulfillmentMode: OrderLineFulfillmentMode;
  unit: string;
  deliveryDate?: string;
  remark?: string;
  selectedStockSources?: StockSourceSelection[];
  processSteps: string[];
  processStepDetails?: ProcessStepDetail[];
  productionTaskNo?: string;
  productionTasks?: OrderLineProductionTask[];
  productionStatus?: ProductionStatus;
  completedQuantity?: number;
  productionTaskCount?: number;
  productionShortageQuantity?: number;
  productionScrapQuantity?: number;
  productionShortageMode?: ProductionShortageMode;
  productionReplenishmentTaskNos?: string[];
  productionReplenishmentRequestNos?: string[];
  productionShortageReasons?: Array<{ managerName?: string; shortageReason?: string }>;
  productionProgressText?: string;
  warehouseStage: WarehouseStage;
  inventoryBatchNo?: string;
  inventoryStatus?: InventoryStatus;
  warehouseName?: string;
  locationName?: string;
}

export interface StockSourceSelection {
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

export interface OrderLineProductionTask {
  id: string;
  productionTaskNo: string;
  status: ProductionStatus;
  isReplenishment?: boolean;
  sourceProductionTaskNo?: string;
  replenishmentSourceType?: 'PRODUCTION_SCRAP' | 'ORDER_CHANGE' | string;
  replenishmentSourceRequestNo?: string;
  replenishmentSourceLabel?: string;
  plannedQuantity: number;
  completedQuantity: number;
  canCancelReplenishment?: boolean;
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
  isReplenishment?: boolean;
  sourceProductionTaskNo?: string;
  replenishmentSourceType?: 'PRODUCTION_SCRAP' | 'ORDER_CHANGE' | string;
  replenishmentSourceRequestNo?: string;
  replenishmentSourceLabel?: string;
  customerId?: string;
  customerName: string;
  orderDate?: string;
  deliveryDate?: string;
  partCode: string;
  partName: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness: number;
  partSpecification?: string;
  customerOrderQuantity: number;
  plannedQuantity: number;
  completedQuantity: number;
  unit: string;
  status: ProductionStatus;
  inventoryBatchNo?: string;
  inventoryStatus?: InventoryStatus;
  processSteps: string[];
  processStepDetails?: ProcessStepDetail[];
  processCompletions: ProductionProcessCompletion[];
  startedAt?: string;
  completedAt?: string;
  remark?: string;
}

export interface ProductionProcessCompletion {
  id?: string;
  stepNo: number;
  processName: string;
  processRemark?: string;
  isCompleted: boolean;
  completedQuantity: number;
  scrapQuantity: number;
  shortageQuantity: number;
  shortageMode?: ProductionShortageMode;
  replenishmentTaskNo?: string;
  replenishmentRequestNo?: string;
  replenishmentSource?: string;
  replenishmentRequestStatus?: string;
  replenishmentApprovedBy?: string;
  replenishmentApprovedAt?: string;
  replenishmentReviewedAt?: string;
  replenishmentApprovalRemark?: string;
  managerName?: string;
  shortageReason?: string;
  unit: string;
  operatorCode?: string;
  operatorName?: string;
  operatorRole?: string;
  completedAt?: string;
  quantityOverrideReason?: string;
  remark?: string;
  logs: ProductionProcessCompletionLog[];
}

export interface ProductionProcessCompletionLog {
  id: string;
  action: string;
  operatorCode?: string;
  operatorName?: string;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface ProductionOperator {
  code: string;
  accountId?: string;
  name: string;
  role: string;
  pinyin?: string;
  pinyinInitials?: string;
  keywords?: string[];
  idCardMasked?: string;
}

export interface ProductionNotice {
  id: string;
  noticeNo: string;
  noticeType: ProductionNoticeType;
  target: ProductionNoticeTarget;
  status: ProductionNoticeStatus;
  orderNo: string;
  orderLineId?: string;
  productionTaskId?: string;
  productionTaskNo?: string;
  partCode?: string;
  partName?: string;
  beforeQuantity?: number;
  afterQuantity?: number;
  deltaQuantity?: number;
  unit?: string;
  reason: string;
  managerName?: string;
  handlingPlan?: ProductionNoticeHandlingPlan;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdAt: string;
}

export interface ProductionNoticeHandlingPlan {
  handlingMode: 'STOCK' | 'SCRAP' | 'NONE';
  handlingQuantity: number;
  remark?: string;
  plannedBy?: string;
  plannedAt?: string;
}

export interface ProductionScrapRecord {
  id: string;
  scrapNo: string;
  orderNo: string;
  orderLineId?: string;
  productionTaskId?: string;
  productionTaskNo?: string;
  partCode: string;
  partName: string;
  quantity: number;
  unit: string;
  reason: string;
  recordDate: string;
  sourceRecordType: string;
  sourceRecordId: string;
  createdAt: string;
}

export interface ProductionReplenishmentRequest {
  id: string;
  requestNo: string;
  sourceType: 'PRODUCTION_SCRAP' | string;
  status: ProductionReplenishmentRequestStatus;
  orderId?: string;
  orderNo: string;
  orderLineId?: string;
  productionTaskId?: string;
  productionTaskNo?: string;
  processCompletionId?: string;
  partCode: string;
  partName: string;
  requestQuantity: number;
  scrapQuantity: number;
  unit: string;
  reason: string;
  requestedByCode?: string;
  requestedByName?: string;
  supervisorName?: string;
  supervisorRemark?: string;
  approvedAt?: string;
  reviewedAt?: string;
  replenishmentTaskNo?: string;
  createdAt: string;
  updatedAt: string;
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
  isReplenishment?: boolean;
  sourceProductionTaskNo?: string;
  replenishmentSourceType?: 'PRODUCTION_SCRAP' | 'ORDER_CHANGE' | string;
  replenishmentSourceRequestNo?: string;
  replenishmentSourceLabel?: string;
  customerId?: string;
  orderNo: string;
  customerName: string;
  orderDate?: string;
  deliveryDate?: string;
  partCode: string;
  partName: string;
  quantity: number;
  plannedQuantity?: number;
  customerOrderQuantity?: number;
  receivedOrderQuantity?: number;
  remainingOrderQuantity?: number;
  completedQuantity?: number;
  orderReceiptQuantity?: number;
  stockQuantity?: number;
  unit: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness?: number | null;
  partSpecification?: string;
  status: string;
  completedAt?: string;
}

export interface WarehouseShipment {
  id: string;
  batchNo: string;
  productionTaskNo?: string;
  isReplenishment?: boolean;
  sourceProductionTaskNo?: string;
  replenishmentSourceType?: 'PRODUCTION_SCRAP' | 'ORDER_CHANGE' | string;
  replenishmentSourceRequestNo?: string;
  replenishmentSourceLabel?: string;
  customerId?: string;
  orderNo?: string;
  customerName?: string;
  orderDate?: string;
  deliveryDate?: string;
  partCode: string;
  partName: string;
  quantity: number;
  unit: string;
  warehouseId?: string;
  warehouseName: string;
  locationId?: string;
  locationName?: string;
  inventorySourceType?: InventorySourceType;
  sourceKind?: InventorySourceKind;
  productionSourceOrderNo?: string;
  productionSourceCustomerName?: string;
  productionDate?: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness?: number | null;
  partSpecification?: string;
  status: string;
}

export interface InventoryBatch {
  id: string;
  batchNo: string;
  partCode: string;
  partName: string;
  quantity: number;
  canAdjust?: boolean;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  locationId?: string;
  locationName?: string;
  inventorySourceType: InventorySourceType;
  sourceKind?: InventorySourceKind;
  isOrderInventory: boolean;
  sourceOrderNo?: string;
  orderDate?: string;
  deliveryDate?: string;
  sourceCustomerName?: string;
  productionSourceOrderNo?: string;
  productionSourceCustomerName?: string;
  sourceProductionTaskNo?: string;
  isReplenishment?: boolean;
  sourceReplenishmentTaskNo?: string;
  replenishmentSourceType?: 'PRODUCTION_SCRAP' | 'ORDER_CHANGE' | string;
  replenishmentSourceRequestNo?: string;
  replenishmentSourceLabel?: string;
  productionDate?: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness?: number | null;
  partSpecification?: string;
  status: InventoryStatus;
}

export interface InventorySummaryWarehouseRow {
  warehouseId: string;
  warehouseName: string;
  availableQuantity: number;
  batchCount: number;
}

export interface InventorySummaryRow {
  partCode: string;
  partName: string;
  unit: string;
  batchCount: number;
  warehouseCount: number;
  availableQuantity: number;
  usedQuantity: number;
  totalQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
  normalOrderStockQuantity: number;
  cancelledOrderStockQuantity: number;
  customerChangeStockQuantity: number;
  warehouses: InventorySummaryWarehouseRow[];
}

export interface InventoryMaterialSuggestion {
  value: string;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string;
  availableQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
}

export interface InventorySourceBatchDetail {
  id: string;
  batchNo: string;
  partCode: string;
  partName: string;
  quantity: number;
  unit: string;
  warehouseId: string;
  warehouseName?: string;
  locationId?: string;
  locationName?: string;
  inventorySourceType: InventorySourceType;
  sourceKind?: InventorySourceKind;
  sourceOrderNo?: string;
  sourceCustomerName?: string;
  productionSourceOrderNo?: string;
  productionSourceCustomerName?: string;
  sourceProductionTaskNo?: string;
  replenishmentSourceType?: 'PRODUCTION_SCRAP' | 'ORDER_CHANGE' | string;
  replenishmentSourceRequestNo?: string;
  replenishmentSourceLabel?: string;
  productionDate?: string;
  orderDate?: string;
  deliveryDate?: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness?: number | null;
  partSpecification?: string;
  status: InventoryStatus;
  createdAt: string;
}

export interface InventorySourceDetailResponse {
  partCode: string;
  partName: string;
  unit: string;
  availableQuantity: number;
  batchCount: number;
  orderSourceCount: number;
  stockSourceCount: number;
  sources: InventorySourceBatchDetail[];
}

export interface InventorySourceExpected {
  partCode?: string;
  partName?: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness?: number | null;
  partSpecification?: string;
  requiredQuantity?: number;
  unit?: string;
  fulfillmentMode?: OrderLineFulfillmentMode;
}

export interface InventoryAdjustment {
  id: string;
  adjustmentNo: string;
  batchId: string;
  partCode: string;
  partName: string;
  beforeQuantity: number;
  afterQuantity: number;
  deltaQuantity: number;
  unit: string;
  countedBy: string;
  countedAt: string;
  signatureName: string;
  attachmentFileName?: string;
  attachmentFileUrl?: string;
  attachmentMimeType?: string;
  attachmentSize?: number;
  remark?: string;
  createdAt: string;
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
