export type CommonStatus = 'ENABLED' | 'DISABLED';
export type CustomerRegionType = 'CHINA' | 'OVERSEAS';
export type OrderStatus = 'DRAFT' | 'PENDING_PRODUCTION' | 'IN_PRODUCTION' | 'COMPLETED' | 'CANCELLED';
export type OrderLineFulfillmentMode = 'PRODUCTION' | 'STOCK' | 'REWORK';
export type ProductionStatus = 'PENDING' | 'IN_PROGRESS' | 'WAITING_CONFIRMATION' | 'COMPLETED' | 'STORED' | 'CANCELLED';
export type OrderProductionFilterStatus =
  | 'ORDER_DRAFT'
  | 'WAITING_PRODUCTION'
  | 'ORDER_IN_PRODUCTION'
  | 'ORDER_COMPLETED_UNSHIPPED'
  | 'PARTIAL_SHIPPED'
  | 'ORDER_SHIPPED_COMPLETED'
  | 'ORDER_CANCELLED';
export type ProductionOrderSummaryStatus = ProductionStatus | 'READY_TO_COMPLETE' | 'RECEIVED';
export type ProductionShortageMode = 'REPLENISHMENT_REQUEST' | 'REPLENISHMENT' | 'MANAGER_APPROVED';
export type ProductionReplenishmentRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ProductionNoticeType = 'QUANTITY_INCREASE' | 'QUANTITY_DECREASE' | 'ORDER_CANCELLED' | 'MATERIAL_ADDED' | 'TASK_WITHDRAWN';
export type ProductionNoticeStatus = 'PENDING' | 'ACKNOWLEDGED';
export type ProductionNoticeTarget = 'PRODUCTION' | 'WAREHOUSE';
export type InventoryStatus = 'AVAILABLE' | 'RESERVED' | 'USED' | 'SCRAPPED';
export type InventorySourceType = 'ORDER' | 'STOCK';
export type InventorySourceKind = 'NORMAL_ORDER' | 'CANCELLED_ORDER' | 'CUSTOMER_CHANGE';
export type StatisticsPeriod = 'year' | 'quarter' | 'month';
export type OrderDisplayStatus =
  | 'ORDER_DRAFT'
  | 'ORDER_CANCELLED'
  | 'ORDER_IN_PRODUCTION'
  | 'ORDER_COMPLETED_UNSHIPPED'
  | 'ORDER_SHIPPED_COMPLETED'
  | 'WAITING_PRODUCTION'
  | 'PARTIAL_SHIPPED'
  | OrderStatus;
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
  status: CommonStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessTemplateListResponse {
  items: ProcessTemplate[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ProcessDefinition {
  id: string;
  processName: string;
  remark?: string;
  status: CommonStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessDefinitionListResponse {
  items: ProcessDefinition[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface OrderQuantityByUnit {
  unit: string;
  totalQuantity: number;
  totalProductionPlanQuantity: number;
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

export interface CustomerListResponse {
  items: Customer[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CustomerContact {
  id?: string;
  contactName: string;
  contactPhone?: string;
  title?: string;
  remark?: string;
  isPrimary?: boolean;
  status?: CommonStatus;
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
  quantityByUnit?: OrderQuantityByUnit[];
  unit: string;
  productionStatus: ProductionStatus;
  warehouseStage: WarehouseStage;
  unresolvedShortageLineCount?: number;
  unresolvedShortageQuantity?: number;
  unresolvedShortageUnit?: string;
  unresolvedShortageQuantityByUnit?: Array<{ unit: string; quantity: number }>;
  needsReplenishmentAction?: boolean;
  pendingProductionReplenishmentLineCount?: number;
  pendingProductionReplenishmentQuantity?: number;
  pendingProductionReplenishmentUnit?: string;
  pendingProductionReplenishmentQuantityByUnit?: Array<{ unit: string; quantity: number }>;
  needsProductionReplenishmentReview?: boolean;
  remark?: string;
}

export interface OrderLine {
  id: string;
  lineNo: number;
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  importSequence?: string;
  sourceImportSessionId?: string;
  sourceImportFileId?: string;
  sourceImportFileName?: string;
  sourceImportFileUrl?: string;
  sourceImportSheetName?: string;
  sourceImportFileAvailable?: boolean;
  sourceImportRowNo?: number;
  projectModel?: string;
  drawingDate?: string;
  drawingStatus?: string;
  partCode: string;
  partName: string;
  materialIdentityVariantCount?: number;
  materialHasIdentityConflict?: boolean;
  materialIdentityConflictFields?: string[];
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness: number;
  partSpecification?: string;
  quantity: number;
  productionPlanQuantity: number;
  productionPlanSuggestedQuantity?: number;
  productionPlanOverrideByCode?: string;
  productionPlanOverrideByName?: string;
  productionPlanOverrideByRole?: string;
  productionPlanOverrideAt?: string;
  productionPlanOverrideReason?: string;
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
  unresolvedShortageQuantity?: number;
  unresolvedShortageCount?: number;
  unresolvedShortageRecords?: Array<{
    completionId?: string;
    productionTaskNo?: string;
    partCode?: string;
    partName?: string;
    shortageQuantity: number;
    scrapQuantity: number;
    managerName?: string;
    shortageReason?: string;
    unit?: string;
  }>;
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
  availableQuantity?: number;
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
  orderLineId: string;
  orderNo: string;
  orderStatus?: OrderStatus;
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
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  importSequence?: string;
  projectModel?: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingDate?: string;
  drawingStatus?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness: number;
  partSpecification?: string;
  customerOrderQuantity: number;
  plannedQuantity: number;
  completedQuantity: number;
  unresolvedShortageQuantity?: number;
  unresolvedShortageUnit?: string;
  unresolvedShortageReason?: string;
  pendingProductionReplenishmentQuantity?: number;
  pendingProductionReplenishmentUnit?: string;
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

export interface ProductionTaskListResponse {
  items: ProductionTask[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ProductionOrderSummaryTask {
  id: string;
  orderLineId?: string;
  orderNo: string;
  orderStatus?: OrderStatus;
  productionTaskNo: string;
  partCode: string;
  partName: string;
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  importSequence?: string;
  projectModel?: string;
  plannedQuantity: number;
  unit: string;
  processSteps: string[];
  processStepDetails?: ProcessStepDetail[];
}

export interface ProductionOrderSummaryQuantity {
  unit: string;
  customerOrderQuantity: number;
  plannedQuantity: number;
  completedQuantity: number;
}

export interface ProductionOrderSummaryProgressItem {
  label: string;
  count: number;
  text: string;
}

export interface ProductionOrderSummary {
  orderId: string;
  orderNo: string;
  orderStatus?: OrderStatus;
  customerId?: string;
  customerName: string;
  orderDate?: string;
  deliveryDate?: string;
  taskCount: number;
  partCount: number;
  pendingCount: number;
  inProgressCount: number;
  readyToCompleteCount: number;
  completedCount: number;
  receivedCount: number;
  totalPlannedQuantity: number;
  totalCompletedQuantity: number;
  unit: string;
  status: ProductionOrderSummaryStatus;
  progressPercent: number;
  quantityByUnit: ProductionOrderSummaryQuantity[];
  progressItems?: ProductionOrderSummaryProgressItem[];
  pendingTaskIds: string[];
  pendingTasks: ProductionOrderSummaryTask[];
  unresolvedShortageLineCount?: number;
  unresolvedShortageQuantity?: number;
  unresolvedShortageUnit?: string;
  unresolvedShortageQuantityByUnit?: Array<{ unit: string; quantity: number }>;
  needsReplenishmentAction?: boolean;
  pendingProductionReplenishmentLineCount?: number;
  pendingProductionReplenishmentQuantity?: number;
  pendingProductionReplenishmentUnit?: string;
  pendingProductionReplenishmentQuantityByUnit?: Array<{ unit: string; quantity: number }>;
  needsProductionReplenishmentReview?: boolean;
  shortageActionTasks?: Array<{
    id: string;
    orderLineId?: string;
    productionTaskNo: string;
    partCode: string;
    partName: string;
    shortageQuantity: number;
    unit: string;
  }>;
}

export interface ProductionOrderSummaryListResponse {
  items: ProductionOrderSummary[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
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
  shortageResolutionMode?: string;
  shortageResolutionBy?: string;
  shortageResolutionReason?: string;
  shortageResolvedAt?: string;
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
  orderId?: string;
  orderNo: string;
  customerName?: string;
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

export interface ProductionNoticeListResponse {
  items: ProductionNotice[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
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

export interface ProductionScrapRecordListResponse {
  items: ProductionScrapRecord[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ProductionReplenishmentRequest {
  id: string;
  requestNo: string;
  sourceType: 'PRODUCTION_SCRAP' | string;
  status: ProductionReplenishmentRequestStatus;
  orderStatus?: OrderStatus;
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

export interface ProductionReplenishmentRequestListResponse {
  items: ProductionReplenishmentRequest[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
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
  currentInventoryQuantity: number;
  currentOrderInventoryQuantity: number;
  currentStockInventoryQuantity: number;
  scrapQuantity: number;
}

export interface OrderStatisticsCustomerRow {
  periodKey: string;
  periodLabel: string;
  customerId?: string;
  customerName: string;
  unit: string;
  orderCount: number;
  customerOrderQuantity: number;
  productionPlanQuantity: number;
  completedProductionQuantity: number;
  shippedOrderQuantity: number;
  stockQuantity: number;
  currentInventoryQuantity: number;
  currentOrderInventoryQuantity: number;
  currentStockInventoryQuantity: number;
  scrapQuantity: number;
}

export interface OrderStatisticsOrderRow {
  periodKey: string;
  periodLabel: string;
  orderNo: string;
  customerName: string;
  orderDate: string;
  deliveryDate?: string;
  status: OrderStatus;
  statisticsStatus?: OrderDisplayStatus;
  partCount: number;
  totalQuantity: number;
  totalProductionPlanQuantity: number;
  quantityByUnit?: OrderQuantityByUnit[];
  unit: string;
}

export interface OrderStatisticsInventorySnapshotRow {
  partCode: string;
  partName: string;
  unit: string;
  batchCount: number;
  warehouseCount: number;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
  stockAlertEnabled: boolean;
  stockAlertQuantity?: number | null;
  stockAlertTriggered: boolean;
}

export interface OrderStatisticsResponse {
  period: StatisticsPeriod;
  year: number;
  currentBusinessDate?: string;
  statisticsEndDate?: string;
  isFuturePeriod?: boolean;
  isCurrentPeriodPartial?: boolean;
  cutoffNotice?: string;
  inventorySnapshotRows: OrderStatisticsInventorySnapshotRow[];
  inventorySnapshotTotal?: number;
  inventorySnapshotLimit?: number;
  inventorySnapshotOffset?: number;
  inventorySnapshotHasMore?: boolean;
  customerRows: OrderStatisticsCustomerRow[];
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
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  importSequence?: string;
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
  drawingDate?: string;
  drawingStatus?: string;
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
  orderLineId?: string;
  productionTaskNo?: string;
  isReplenishment?: boolean;
  sourceProductionTaskNo?: string;
  replenishmentSourceType?: 'PRODUCTION_SCRAP' | 'ORDER_CHANGE' | string;
  replenishmentSourceRequestNo?: string;
  replenishmentSourceLabel?: string;
  customerId?: string;
  orderStatus?: OrderStatus;
  orderNo?: string;
  customerName?: string;
  orderDate?: string;
  deliveryDate?: string;
  partCode: string;
  partName: string;
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  importSequence?: string;
  quantity: number;
  customerOrderQuantity?: number;
  shippedQuantity?: number;
  remainingQuantity?: number;
  suggestedShipmentQuantity?: number;
  physicalQuantity?: number;
  reservedQuantity?: number;
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
  drawingDate?: string;
  drawingStatus?: string;
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
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  importSequence?: string;
  quantity: number;
  physicalQuantity?: number;
  reservedQuantity?: number;
  availableQuantity?: number;
  reservations?: InventorySourceReservation[];
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
  drawingDate?: string;
  drawingStatus?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness?: number | null;
  partSpecification?: string;
  status: InventoryStatus;
}

export interface InventoryBatchListResponse {
  items: InventoryBatch[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface InventorySummaryWarehouseRow {
  warehouseId: string;
  warehouseName: string;
  reservedQuantity: number;
  availableQuantity: number;
  batchCount: number;
}

export interface InventorySummaryRow {
  materialId?: string;
  partCode: string;
  partName: string;
  unit: string;
  batchCount: number;
  warehouseCount: number;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  usedQuantity: number;
  totalQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
  normalOrderStockQuantity: number;
  cancelledOrderStockQuantity: number;
  customerChangeStockQuantity: number;
  stockAlertEnabled: boolean;
  stockAlertQuantity?: number | null;
  stockAlertTriggered: boolean;
  warehouses: InventorySummaryWarehouseRow[];
}

export interface InventorySummaryListResponse {
  items: InventorySummaryRow[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface InventoryMaterialSuggestion {
  value: string;
  materialId?: string;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string;
  defaultProcessRoute?: string | null;
  drawingNo?: string;
  drawingVersion?: string;
  drawingDate?: string;
  drawingStatus?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness?: number | null;
  projectModel?: string;
  matchedBatchNo?: string;
  matchedSourceOrderNo?: string;
  matchedProductionTaskNo?: string;
  searchMatchRank?: number;
  searchMatchText?: string;
  customerUsageCount?: number;
  historyUsageCount?: number;
  hasCurrentCustomerHistory?: boolean;
  identityVariantCount?: number;
  hasIdentityConflict?: boolean;
  identityConflictFields?: string[];
  lastCustomerCode?: string;
  lastCustomerName?: string;
  lastCustomerOrderNo?: string;
  lastCustomerOrderDate?: string;
  matchedCustomerCode?: string;
  matchedCustomerName?: string;
  matchedHistoryOrderNo?: string;
  historyCustomerNames?: string[];
  historyCustomerCount?: number;
  availableQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
}

export interface MaterialMemory {
  id: string;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  defaultProcessRoute?: string | null;
  stockAlertEnabled: boolean;
  stockAlertQuantity?: number | null;
  status: CommonStatus;
  availableQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
  orderLineUsageCount: number;
  lastOrderNo?: string;
  lastCustomerName?: string;
  lastOrderDate?: string;
}

export interface MaterialMemoryListResponse {
  items: MaterialMemory[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface MaterialDashboardBomStructureDetail {
  lineId: string;
  bomId: string;
  bomName: string;
  customerId?: string | null;
  customerName?: string | null;
  projectModel?: string | null;
  structureType: 'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART' | null;
  structureLabel: string;
  componentNo?: string | null;
  parentComponentNo?: string | null;
  displayOrder?: number | null;
  sortOrder: number;
}

export interface MaterialDashboardRow {
  id: string;
  partCode: string;
  partName: string;
  partType?: string | null;
  unit: string;
  partSpecification?: string | null;
  status: CommonStatus;
  scopeType: 'COMMON' | 'CUSTOM';
  scopeLabel: string;
  currentRelationType?: 'BOM' | 'APPLICABILITY' | 'ORDER_HISTORY' | 'MATERIAL_ONLY';
  currentRelationLabel?: string;
  currentRelationDescription?: string;
  customerNames: string[];
  customerNameCount?: number;
  customerScopeLabel?: string;
  customerScopeKind?: 'ALL' | 'SCOPED' | 'ORDER_HISTORY' | 'NONE';
  hasGlobalCustomerScope?: boolean;
  historyCustomerNames?: string[];
  historyCustomerCount?: number;
  projectModels: string[];
  projectModelCount?: number;
  historyProjectModels?: string[];
  historyProjectModelCount?: number;
  hasGlobalProjectScope?: boolean;
  applicabilityCount: number;
  bomLineCount: number;
  currentScopeBomLineCount?: number;
  bomNames: string[];
  bomNameCount?: number;
  defaultQuantity?: number | null;
  defaultQuantityUnit?: string | null;
  defaultProcessRoute?: string | null;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: string | null;
  drawingStatus?: string | null;
  drawingSource?: 'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST' | 'ORDER_HISTORY' | null;
  drawingSourceLabel?: string | null;
  partThickness?: number | null;
  projectModel?: string | null;
  bomStructureType?: 'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART' | null;
  bomStructureLabel?: string | null;
  bomStructureTypes?: Array<'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART'>;
  bomStructureLabels?: string[];
  bomStructureDetails?: MaterialDashboardBomStructureDetail[];
  bomStructureDetailCount?: number;
  lastOrderNo?: string | null;
  lastOrderDate?: string | null;
  lastCustomerName?: string | null;
  orderLineUsageCount: number;
  currentCustomerUsageCount: number;
  availableQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
  stockAlertEnabled: boolean;
  stockAlertQuantity?: number | null;
  stockAlertTriggered: boolean;
}

export interface MaterialDashboardSummary {
  totalCount: number;
  enabledCount: number;
  disabledCount: number;
  commonCount: number;
  customCount: number;
  withBomCount: number;
  withoutBomCount: number;
  withRecentOrderCount: number;
  withoutRecentOrderCount: number;
  relationCounts: Partial<Record<'BOM' | 'APPLICABILITY' | 'ORDER_HISTORY' | 'MATERIAL_ONLY', number>>;
  drawingSourceCounts: Partial<Record<'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST' | 'ORDER_HISTORY' | 'NONE', number>>;
  bomStructureCounts: Partial<Record<'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART' | 'NONE', number>>;
  stockAlertCounts: Partial<Record<'ENABLED' | 'TRIGGERED' | 'DISABLED', number>>;
}

export interface MaterialDashboardResponse {
  items: MaterialDashboardRow[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  summary: MaterialDashboardSummary;
}

export interface MaterialDrawingRevision {
  id: string;
  materialId: string;
  drawingNo: string;
  drawingVersion: string;
  drawingDate?: string | null;
  drawingStatus?: string | null;
  drawingFileName?: string | null;
  drawingFileUrl?: string | null;
  isDefault: boolean;
  defaultChangedBy?: string | null;
  defaultChangedAt?: string | null;
  remark?: string | null;
  status: CommonStatus;
}

export interface MaterialDrawingRevisionResponse {
  items: MaterialDrawingRevision[];
}

export interface MaterialApplicability {
  id: string;
  materialId: string;
  customerId?: string | null;
  customerCode?: string;
  customerName?: string;
  projectModel?: string | null;
  customerScopeKey: string;
  projectModelScopeKey: string;
  scopeLabel: string;
  sourceBomId?: string | null;
  sourceBomNameSnapshot?: string | null;
  remark?: string | null;
  status: CommonStatus;
}

export interface MaterialApplicabilityResponse {
  material: {
    id: string;
    partCode: string;
    partName: string;
  };
  items: MaterialApplicability[];
}

export interface MaterialImportIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
}

export interface MaterialImportPreviewRow {
  id: string;
  sourceFileName: string;
  sourceSheetName: string;
  sourceRowNo: number;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  defaultProcessRoute?: string | null;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: string;
  drawingStatus?: string | null;
  partThickness?: number | null;
  projectModel?: string | null;
  stockAlertEnabled?: boolean | null;
  stockAlertQuantity?: number | null;
  remark?: string | null;
  raw?: Record<string, string | number | boolean | null>;
  issues: MaterialImportIssue[];
  errorCount: number;
  warningCount: number;
}

export interface MaterialApplicabilityImportPreviewRow {
  id: string;
  sourceFileName: string;
  sourceSheetName: string;
  sourceRowNo: number;
  partCode: string;
  customerCode?: string | null;
  customerName?: string | null;
  projectModel?: string | null;
  remark?: string | null;
  status: CommonStatus;
  raw?: Record<string, string | number | boolean | null>;
  issues: MaterialImportIssue[];
  errorCount: number;
  warningCount: number;
}

export interface MaterialTransformImportPreviewRow {
  id: string;
  sourceFileName: string;
  sourceSheetName: string;
  sourceRowNo: number;
  sourcePartCode: string;
  targetPartCode: string;
  customerCode?: string | null;
  customerName?: string | null;
  projectModel?: string | null;
  multiplier?: number | null;
  lossRate?: number | null;
  defaultProcessRoute?: string | null;
  conversionDescription?: string | null;
  remark?: string | null;
  status: CommonStatus;
  raw?: Record<string, string | number | boolean | null>;
  issues: MaterialImportIssue[];
  errorCount: number;
  warningCount: number;
}

export interface MaterialImportSessionPreview {
  id: string;
  status: 'DRAFT' | 'COMMITTED' | string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  committedAt?: string;
  committedMaterialCodes?: string[];
  previewToken?: string;
  files: Array<{
    id: string;
    fileName: string;
    sheetName: string;
    rowCount: number;
    materialRowCount?: number;
    scopeRowCount?: number;
    transformRowCount?: number;
    acceptedRowCount: number;
    duplicateRowCount: number;
    createdAt: string;
  }>;
  summary: {
    fileCount: number;
    rowCount: number;
    importableRowCount: number;
    materialUpsertCount: number;
    drawingRevisionUpsertCount?: number;
    materialRowCount?: number;
    applicabilityRowCount?: number;
    transformRowCount?: number;
    applicabilityUpsertCount?: number;
    transformRuleUpsertCount?: number;
    errorCount: number;
    warningCount: number;
    duplicateRowCount: number;
  };
  rowPage: {
    offset: number;
    limit: number;
    loadedCount: number;
    totalCount: number;
    hasMore: boolean;
  };
  rows: MaterialImportPreviewRow[];
  applicabilityRows?: MaterialApplicabilityImportPreviewRow[];
  transformRows?: MaterialTransformImportPreviewRow[];
  uploadResult?: {
    fileName: string;
    sheetName: string;
    rowCount: number;
    acceptedRowCount: number;
    duplicateRowCount: number;
  };
}

export interface CommitMaterialImportSessionResponse {
  sessionId: string;
  createdCount: number;
  updatedCount: number;
  drawingRevisionUpsertCount?: number;
  applicabilityUpsertCount?: number;
  transformRuleUpsertCount?: number;
  committedMaterialCount: number;
  committedMaterialCodes: string[];
}

export interface DiscardMaterialImportSessionResponse {
  sessionId: string;
  discarded: boolean;
  deletedFileCount: number;
}

export interface ModelBomLine {
  id: string;
  bomId: string;
  materialId: string;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string | null;
  partThickness?: number | null;
  partThicknessSource?: 'BOM_LINE' | 'ORDER_HISTORY' | null;
  lineType: 'PART' | 'COMPONENT';
  partCategory?: string | null;
  componentNo?: string | null;
  parentComponentNo?: string | null;
  structureType?: 'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART';
  structureLabel?: string;
  level?: number;
  defaultDrawingRevisionId?: string | null;
  resolvedDrawingRevisionId?: string | null;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: string | null;
  drawingStatus?: string | null;
  drawingFileName?: string | null;
  drawingFileUrl?: string | null;
  drawingSource?: 'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST';
  bomLineDefaultProcessRoute?: string | null;
  defaultProcessRoute?: string | null;
  defaultProcessRouteSource?: 'BOM_LINE' | 'MATERIAL' | null;
  defaultQuantity: number;
  remark?: string | null;
  displayOrder?: number | null;
  sortOrder: number;
  status: CommonStatus;
  materialStatus?: CommonStatus;
}

export interface ModelBom {
  id: string;
  bomName: string;
  customerId?: string | null;
  customerCode?: string;
  customerName?: string;
  projectModel: string;
  customerScopeMode?: 'ALL' | 'PRIVATE' | 'SELECTED';
  scopeTypeLabel?: string;
  scopeCustomerIds?: string[];
  scopeCustomerCount?: number;
  scopeCustomers?: Array<{
    customerId: string;
    customerCode?: string;
    customerName: string;
  }>;
  customerScopeKey: string;
  projectModelScopeKey: string;
  scopeLabel: string;
  sourceBomId?: string | null;
  sourceBomNameSnapshot?: string | null;
  isCommon?: boolean;
  commonSortOrder?: number | null;
  remark?: string | null;
  status: CommonStatus;
  lineCount: number;
  lineSummary?: ModelBomLineSummary;
  sameScopeBomCount?: number;
  lines: ModelBomLine[];
}

export interface ModelBomLineSummary {
  componentCount: number;
  childPartCount: number;
  standalonePartCount: number;
  orphanPartCount: number;
  missingThicknessCount: number;
  disabledCount: number;
  materialDisabledCount: number;
  effectiveCount: number;
  inactiveCount: number;
  confirmedThicknessCount: number;
  historyThicknessCount: number;
  noThicknessCount: number;
}

export interface ModelBomScopeSummary {
  totalCount: number;
  allCustomerCount: number;
  selectedCustomerCount: number;
  privateCount: number;
  commonCount: number;
}

export interface ModelBomListResponse {
  items: ModelBom[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  scopeSummary: ModelBomScopeSummary;
}

export interface ModelBomRevision {
  id: string;
  bomId: string;
  revisionNo: number;
  action: string;
  changedBy?: string | null;
  changeRemark?: string | null;
  snapshotJson?: unknown;
  createdAt: string;
}

export interface ModelBomRevisionListResponse {
  items: ModelBomRevision[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export type ModelBomScopeApprovalRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED';

export interface ModelBomScopeApprovalRequest {
  id: string;
  requestNo: string;
  bomId: string;
  bomName: string;
  requestType: string;
  status: ModelBomScopeApprovalRequestStatus;
  requestedBomName: string;
  requestedCustomerScopeMode: 'ALL' | 'PRIVATE' | 'SELECTED';
  requestedCustomerId?: string | null;
  requestedCustomerNameSnapshot?: string | null;
  requestedCustomerIds?: unknown;
  requestedProjectModel: string;
  requestedScopeKey: string;
  requestedProjectModelScopeKey: string;
  currentScopeJson?: unknown;
  requestedScopeJson?: unknown;
  reason: string;
  requestedBy: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  reviewRemark?: string | null;
  usedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelBomScopeApprovalRequestListResponse {
  items: ModelBomScopeApprovalRequest[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ModelBomDraftIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
}

export interface ModelBomDraftPreviewLine {
  sourceFileName?: string | null;
  sourceSheetName?: string | null;
  sourceRowNo: number;
  orderNo: string;
  lineType: 'PART' | 'COMPONENT';
  partCategory?: string | null;
  componentNo?: string | null;
  parentComponentNo?: string | null;
  partCode: string;
  partName: string;
  materialId?: string | null;
  materialStatus?: CommonStatus | null;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: string | null;
  drawingStatus?: string | null;
  partSpecification?: string | null;
  partThickness?: number | null;
  defaultQuantity: number;
  unit: string;
  defaultProcessRoute?: string | null;
  sortOrder: number;
  raw?: unknown;
  issues: ModelBomDraftIssue[];
}

export interface ModelBomDraftExistingBomDiffSummary {
  sameLineCount: number;
  changedLineCount: number;
  newLineCount: number;
  removedLineCount: number;
  changedFields: string[];
}

export interface ModelBomDraftExistingBomDiffField {
  label: string;
  draftValue: string;
  existingValue: string;
  changed: boolean;
}

export interface ModelBomDraftExistingBomDiffLineSnapshot {
  id?: string | null;
  sourceRowNo?: number | null;
  orderNo?: string | null;
  structureText: string;
  partCode: string;
  partName: string;
  partCategory?: string | null;
  defaultQuantityText: string;
  unit: string;
  partThicknessText?: string | null;
  partSpecification?: string | null;
  defaultProcessRoute?: string | null;
}

export interface ModelBomDraftExistingBomDiffLine {
  key: string;
  status: 'SAME' | 'CHANGED' | 'DRAFT_ONLY' | 'EXISTING_ONLY';
  structureText: string;
  partCode: string;
  partName: string;
  draftLine?: ModelBomDraftExistingBomDiffLineSnapshot | null;
  existingLine?: ModelBomDraftExistingBomDiffLineSnapshot | null;
  fields: ModelBomDraftExistingBomDiffField[];
}

export interface ModelBomDraftExistingBomSummary {
  id: string;
  bomName: string;
  status: CommonStatus;
  lineCount: number;
  diffSummary?: ModelBomDraftExistingBomDiffSummary;
  diffLines?: ModelBomDraftExistingBomDiffLine[];
}

export interface ModelBomDraftPreviewItem {
  draftKey: string;
  bomName: string;
  commitBomName?: string;
  customerId?: string | null;
  customerCode?: string | null;
  customerName: string;
  customerScopeMode: 'PRIVATE';
  projectModel?: string | null;
  existingBom?: ModelBomDraftExistingBomSummary | null;
  existingBoms?: ModelBomDraftExistingBomSummary[];
  lineCount: number;
  componentCount: number;
  childPartCount: number;
  standalonePartCount: number;
  issues: ModelBomDraftIssue[];
  lines: ModelBomDraftPreviewLine[];
}

export interface ModelBomDraftPreview {
  sourceOrderImportSessionId: string;
  sourceStatus: string;
  previewToken: string;
  summary: {
    draftCount: number;
    lineCount: number;
    componentCount: number;
    childPartCount: number;
    standalonePartCount: number;
    existingBomScopeCount: number;
    missingMaterialCount: number;
    errorCount: number;
    warningCount: number;
  };
  drafts: ModelBomDraftPreviewItem[];
}

export interface ModelBomDiffReview {
  id: string;
  targetBomId: string;
  sourceBomId: string;
  reviewKey: string;
  issueKind: string;
  sourceLineId?: string | null;
  targetLineId?: string | null;
  issueTitle: string;
  issueDetail?: string | null;
  diffFingerprint: string;
  fieldsJson?: unknown;
  reviewedBy?: string | null;
  reviewRemark?: string | null;
  status: CommonStatus;
  reviewedAt: string;
}

export interface ModelBomDiffReviewListResponse {
  items: ModelBomDiffReview[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  reviewKeys: string[];
}

export interface MaterialTransformRule {
  id: string;
  sourceMaterialId: string;
  sourcePartCode: string;
  sourcePartName: string;
  sourceUnit: string;
  sourcePartSpecification?: string | null;
  sourceMaterialStatus?: CommonStatus;
  sourceAvailableQuantity: number;
  sourceAvailableBatchCount: number;
  targetMaterialId: string;
  targetPartCode: string;
  targetPartName: string;
  targetUnit: string;
  targetPartSpecification?: string | null;
  targetMaterialStatus?: CommonStatus;
  targetAvailableQuantity: number;
  targetAvailableBatchCount: number;
  customerId?: string | null;
  customerCode?: string;
  customerName?: string;
  projectModel?: string | null;
  customerScopeKey: string;
  projectModelScopeKey: string;
  scopeLabel: string;
  conversionDescription?: string | null;
  defaultProcessRoute?: string | null;
  multiplier: number;
  lossRate?: number | null;
  remark?: string | null;
  status: CommonStatus;
}

export interface MaterialTransformRuleListResponse {
  items: MaterialTransformRule[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface InventorySourceBatchDetail {
  id: string;
  batchNo: string;
  partCode: string;
  partName: string;
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  importSequence?: string;
  quantity: number;
  physicalQuantity?: number;
  reservedQuantity?: number;
  reservations?: InventorySourceReservation[];
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
  drawingDate?: string;
  drawingStatus?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness?: number | null;
  partSpecification?: string;
  projectModel?: string;
  status: InventoryStatus;
  createdAt: string;
}

export interface InventorySourceReservation {
  id: string;
  orderNo?: string;
  customerName?: string;
  orderDate?: string;
  orderLineId?: string;
  lineNo?: number;
  partCode?: string;
  partName?: string;
  quantity: number;
  unit?: string;
  statusReason?: string;
  createdAt: string;
}

export type InventoryReservationStatus = 'ACTIVE' | 'RELEASED' | 'CONSUMED';

export interface InventoryReservationAudit {
  id: string;
  batchId: string;
  orderId: string;
  orderLineId?: string;
  orderNo?: string;
  customerName?: string;
  orderDate?: string;
  lineNo?: number;
  partCode?: string;
  partName?: string;
  quantity: number;
  unit: string;
  status: InventoryReservationStatus;
  statusReason?: string;
  releasedAt?: string;
  consumedAt?: string;
  createdAt: string;
  updatedAt: string;
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
  totalSourceCount?: number;
  sourceLimit?: number;
  sourceOffset?: number;
  sourceHasMore?: boolean;
}

export interface InventorySourceExpected {
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string | null;
  componentNo?: string | null;
  parentComponentNo?: string | null;
  partCode?: string;
  partName?: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingDate?: string;
  drawingStatus?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  partThickness?: number | null;
  partSpecification?: string;
  projectModel?: string;
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
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  importSequence?: string;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: string | null;
  drawingStatus?: string | null;
  drawingFileName?: string | null;
  drawingFileUrl?: string | null;
  orderNo?: string;
  sourceOrderNo?: string;
  productionSourceOrderNo?: string;
  batchId?: string;
  batchNo?: string;
  batchStatus?: InventoryStatus;
  physicalQuantity?: number | null;
  reservedQuantity?: number | null;
  availableQuantity?: number | null;
  productionTaskNo?: string;
  quantity: number;
  unit: string;
  warehouseName: string;
  locationName?: string;
  transactionTime: string;
  remark?: string;
}

export interface WarehouseTransactionListResponse {
  items: WarehouseTransaction[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
