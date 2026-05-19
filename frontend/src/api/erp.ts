import { apiBaseUrl, request } from './http';
import type {
  CommonStatus,
  Customer,
  CustomerListResponse,
  InventoryBatch,
  InventoryBatchListResponse,
  InventoryAdjustment,
  InventoryMaterialSuggestion,
  MaterialApplicability,
  MaterialApplicabilityResponse,
  MaterialDashboardResponse,
  MaterialDrawingRevision,
  MaterialDrawingRevisionResponse,
  CommitMaterialImportSessionResponse,
  DiscardMaterialImportSessionResponse,
  MaterialImportSessionPreview,
  MaterialTransformRule,
  MaterialTransformRuleListResponse,
  MaterialMemory,
  MaterialMemoryListResponse,
  ModelBom,
  ModelBomDraftPreview,
  ModelBomDiffReview,
  ModelBomDiffReviewListResponse,
  ModelBomListResponse,
  ModelBomLine,
  ModelBomRevisionListResponse,
  ModelBomScopeApprovalRequest,
  ModelBomScopeApprovalRequestListResponse,
  InventoryReservationAudit,
  InventorySourceDetailResponse,
  InventorySummaryListResponse,
  InventorySummaryRow,
  InventoryStatus,
  OrderLineFulfillmentMode,
  OrderDetail,
  ProcessDefinition,
  ProcessStepDetail,
  OrderStatisticsOptions,
  OrderStatisticsResponse,
  OrderStatus,
  OrderProductionFilterStatus,
  OrderSummary,
  ProductionAnnualSummaryRow,
  ProcessDefinitionListResponse,
  ProductionNotice,
  ProductionNoticeListResponse,
  ProductionNoticeStatus,
  ProductionNoticeTarget,
  ProductionNoticeType,
  ProductionOperator,
  ProductionOrderSummaryListResponse,
  ProductionReplenishmentRequest,
  ProductionReplenishmentRequestListResponse,
  ProductionReplenishmentRequestStatus,
  ProcessTemplate,
  ProcessTemplateListResponse,
  ProductionScrapRecord,
  ProductionScrapRecordListResponse,
  ProductionShortageMode,
  ProductionStatus,
  ProductionTask,
  ProductionTaskListResponse,
  Warehouse,
  WarehouseLocation,
  WarehouseShipment,
  WarehouseTransaction,
  WarehouseTransactionListResponse,
  WarehouseReceipt
} from '../types/erp';

export interface CreateOrderLinePayload {
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  importSequence?: string;
  sourceImportSessionId?: string;
  sourceImportFileId?: string;
  sourceImportFileName?: string;
  sourceImportRowNo?: number;
  projectModel?: string;
  drawingDate?: string;
  drawingStatus?: string;
  partCode: string;
  partName: string;
  drawingNo?: string;
  drawingVersion?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  selectedMaterialId?: string;
  selectedDrawingRevisionId?: string;
  partThickness: number;
  partSpecification?: string;
  quantity: number;
  productionPlanQuantity?: number;
  productionPlanSuggestedQuantity?: number;
  productionPlanOverrideByCode?: string;
  productionPlanOverrideByName?: string;
  productionPlanOverrideByRole?: string;
  productionPlanOverrideAt?: string;
  productionPlanOverrideReason?: string;
  fulfillmentMode?: OrderLineFulfillmentMode;
  unit: string;
  deliveryDate?: string;
  remark?: string;
  processRoute?: string;
  processSteps?: ProcessStepDetail[];
  stockSourceReviewed?: boolean;
  stockSourceReviewSignature?: string;
  stockSourceMatchedQuantity?: number;
  stockSourceAvailableQuantity?: number;
  selectedStockSources?: StockSourceSelectionPayload[];
}

export interface StockSourceSelectionPayload {
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

export interface CreateOrderPayload {
  customerId: string;
  orderNo?: string;
  orderDate?: string;
  deliveryDate?: string;
  remark?: string;
  lines: CreateOrderLinePayload[];
}

export interface SaveProcessTemplatePayload {
  templateName: string;
  steps: ProcessStepDetail[];
  remark?: string;
}

export interface ProcessTemplateFilters {
  keyword?: string;
  status?: CommonStatus | 'ALL';
  limit?: number;
  offset?: number;
  includeTestFixtures?: boolean;
}

export interface ProcessDefinitionFilters {
  keyword?: string;
  status?: CommonStatus | 'ALL';
  limit?: number;
  offset?: number;
  includeTestFixtures?: boolean;
}

export interface SaveProcessDefinitionPayload {
  processName: string;
  remark?: string;
  status?: CommonStatus;
}

export interface MaterialMemoryFilters {
  keyword?: string;
  customerId?: string;
  projectModel?: string;
  status?: CommonStatus;
  stockAlert?: StockAlertFilter;
  limit?: number;
  offset?: number;
  includeTestFixtures?: boolean;
}

export type StockAlertFilter = 'ALL' | 'ENABLED' | 'TRIGGERED' | 'DISABLED';

export interface MaterialDashboardFilters {
  keyword?: string;
  customerId?: string;
  projectModel?: string;
  scopeType?: 'COMMON' | 'CUSTOM';
  relationType?: 'BOM' | 'APPLICABILITY' | 'ORDER_HISTORY' | 'MATERIAL_ONLY';
  drawingNo?: string;
  drawingStatus?: string;
  drawingSource?: 'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST' | 'ORDER_HISTORY' | 'NONE';
  bomStructureType?: 'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART' | 'NONE';
  bomPresence?: 'WITH_BOM' | 'WITHOUT_BOM';
  recentOrderPresence?: 'WITH_RECENT_ORDER' | 'WITHOUT_RECENT_ORDER';
  stockAlert?: StockAlertFilter;
  drawingDateFrom?: string;
  drawingDateTo?: string;
  lastOrderDateFrom?: string;
  lastOrderDateTo?: string;
  status?: CommonStatus | 'ALL';
  sortBy?: 'LAST_ORDER_DATE' | 'DRAWING_DATE' | 'BOM_STATUS' | 'PART_CODE';
  sortOrder?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
  includeTestFixtures?: boolean;
}

export interface UpdateMaterialMemoryPayload {
  partCode?: string;
  partName?: string;
  unit?: string;
  partSpecification?: string;
  defaultProcessRoute?: string;
  stockAlertEnabled?: boolean;
  stockAlertQuantity?: number | null;
}

export interface CreateMaterialMemoryPayload {
  partCode: string;
  partName: string;
  unit: string;
  partSpecification?: string;
  defaultProcessRoute?: string;
  stockAlertEnabled?: boolean;
  stockAlertQuantity?: number | null;
  status?: CommonStatus;
}

export interface SaveMaterialApplicabilityPayload {
  customerId?: string;
  projectModel?: string;
  remark?: string;
  status?: CommonStatus;
}

export type UpdateMaterialApplicabilityPayload = Omit<SaveMaterialApplicabilityPayload, 'status'>;

export interface ModelBomFilters {
  keyword?: string;
  customerId?: string;
  projectModel?: string;
  scopeMode?: 'ALL' | 'PRIVATE' | 'SELECTED';
  excludeGlobalAllProject?: boolean;
  commonOnly?: boolean;
  status?: CommonStatus | 'ALL';
  limit?: number;
  offset?: number;
  includeTestFixtures?: boolean;
}

export interface SaveModelBomPayload {
  bomName: string;
  customerId?: string;
  customerScopeMode?: 'ALL' | 'PRIVATE' | 'SELECTED';
  customerIds?: string[];
  projectModel?: string;
  remark?: string;
  status?: CommonStatus;
  isCommon?: boolean;
  scopeChangeConfirmed?: boolean;
  scopeApprovalRequestId?: string;
}

export interface CreateModelBomScopeApprovalRequestPayload extends SaveModelBomPayload {
  requestedBy: string;
  requestReason: string;
}

export interface ModelBomScopeApprovalRequestFilters {
  bomId?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'ALL';
  requestedCustomerScopeMode?: 'ALL' | 'PRIVATE' | 'SELECTED';
  requestedScopeKey?: string;
  requestedProjectModelScopeKey?: string;
  includeTestFixtures?: boolean;
  limit?: number;
  offset?: number;
}

export interface ModelBomDiffReviewFilters {
  sourceBomId?: string;
  limit?: number;
  offset?: number;
  withPage?: boolean;
}

export interface ReviewModelBomScopeApprovalRequestPayload {
  reviewedBy: string;
  reviewRemark?: string;
}

export interface CopyModelBomPayload {
  customerId: string;
  bomName?: string;
  projectModel?: string;
  remark?: string;
  status?: CommonStatus;
  isCommon?: boolean;
}

export interface SaveMaterialDrawingRevisionPayload {
  drawingNo: string;
  drawingVersion: string;
  drawingDate?: string;
  drawingStatus?: string;
  drawingFileName?: string;
  drawingFileUrl?: string;
  isDefault?: boolean;
  defaultChangedBy?: string;
  remark?: string;
  status?: CommonStatus;
}

export type UpdateMaterialDrawingRevisionPayload = Omit<SaveMaterialDrawingRevisionPayload, 'status'>;

export interface SaveModelBomLinePayload {
  materialId: string;
  lineType?: 'PART' | 'COMPONENT';
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  defaultDrawingRevisionId?: string;
  defaultProcessRoute?: string;
  partThickness?: number;
  defaultQuantity: number;
  remark?: string;
  sortOrder?: number;
  status?: CommonStatus;
}

export interface ReorderModelBomLinesPayload {
  items: Array<{
    lineId: string;
    sortOrder: number;
  }>;
}

export interface ReorderModelBomCommonPayload {
  items: Array<{
    bomId: string;
    commonSortOrder: number;
  }>;
}

export interface SetModelBomsCommonBatchPayload {
  bomIds: string[];
  isCommon: boolean;
}

export interface ConfirmModelBomDiffReviewPayload {
  sourceBomId: string;
  reviewKey: string;
  issueKind: string;
  sourceLineId?: string;
  targetLineId?: string;
  issueTitle: string;
  issueDetail?: string;
  diffFingerprint: string;
  fieldsJson?: Record<string, unknown>;
  reviewedBy: string;
  reviewRemark?: string;
}

export interface MaterialTransformRuleFilters {
  keyword?: string;
  customerId?: string;
  projectModel?: string;
  sourceMaterialId?: string;
  sourcePartCode?: string;
  targetMaterialId?: string;
  targetPartCode?: string;
  status?: CommonStatus | 'ALL';
  sourceStockStatus?: 'ALL' | 'WITH_STOCK' | 'NO_STOCK';
  targetStockStatus?: 'ALL' | 'WITH_STOCK' | 'NO_STOCK';
  inventoryDecision?: 'ALL' | 'TARGET_STOCK' | 'SOURCE_REWORK' | 'NO_STOCK';
  includeTestFixtures?: boolean;
  limit?: number;
  offset?: number;
}

export interface SaveMaterialTransformRulePayload {
  sourceMaterialId: string;
  targetMaterialId: string;
  customerId?: string;
  projectModel?: string;
  conversionDescription?: string;
  defaultProcessRoute?: string;
  multiplier?: number;
  lossRate?: number;
  remark?: string;
  status?: CommonStatus;
}

export type UpdateMaterialTransformRulePayload = Omit<SaveMaterialTransformRulePayload, 'status'>;

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

export interface OrderImportIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
}

export interface OrderImportPreviewRow {
  id: string;
  sourceImportSessionId?: string;
  sourceImportFileId?: string;
  sourceFileName?: string;
  sourceRowNo: number;
  orderBlock?: string;
  orderNo?: string;
  lineType: 'PART' | 'COMPONENT';
  importSequence?: string;
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  partCode: string;
  drawingNo?: string;
  drawingVersion?: string;
  partName: string;
  partSpecification?: string;
  partThickness: number;
  orderQuantity?: number;
  unitUsage?: number;
  demandQuantity: number;
  unit: string;
  processRoute?: string;
  processRemark?: string;
  projectModel?: string;
  drawingDate?: string;
  drawingStatus?: string;
  issues: OrderImportIssue[];
}

export interface OrderImportPreviewOrder {
  orderNo: string;
  orderDate: string;
  customerName: string;
  customerId?: string;
  projectModel?: string;
  rowCount: number;
  errorCount: number;
  warningCount: number;
  issues: OrderImportIssue[];
  rows: OrderImportPreviewRow[];
}

export interface OrderImportSessionPreview {
  id: string;
  status: 'DRAFT' | 'COMMITTED' | string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  committedAt?: string;
  previewToken?: string;
  committedOrderNos?: string[];
  currentCommittedOrderNos?: string[];
  files: Array<{
    id: string;
    fileName: string;
    sheetName: string;
    rowCount: number;
    acceptedRowCount: number;
    duplicateRowCount: number;
    createdAt: string;
  }>;
  summary: {
    fileCount: number;
    rowCount: number;
    orderCount: number;
    selectableOrderCount: number;
    blockedOrderCount: number;
    errorCount: number;
    warningCount: number;
    committedOrderCount?: number;
    currentCommittedOrderCount?: number;
    materialSyncCount: number;
    materialSyncPreview: string[];
    duplicateRowCount: number;
  };
  orderPage?: {
    offset: number;
    limit: number;
    loadedCount: number;
    totalCount: number;
    hasMore: boolean;
  };
  orders: OrderImportPreviewOrder[];
  uploadResult?: {
    fileName: string;
    sheetName: string;
    rowCount: number;
    acceptedRowCount: number;
    duplicateRowCount: number;
  };
}

export interface OrderImportFilePreview {
  sessionId: string;
  status: 'DRAFT' | 'COMMITTED' | string;
  file: {
    id: string;
    fileName: string;
    storedFileName?: string;
    fileUrl?: string;
    sheetName?: string;
    rowCount: number;
    acceptedRowCount: number;
    duplicateRowCount: number;
    createdAt?: string;
  };
  rowPage: {
    offset: number;
    limit: number;
    loadedCount: number;
    totalCount: number;
    hasMore: boolean;
  };
  rows: OrderImportPreviewRow[];
}

export interface OrderImportSessionSummary {
  id: string;
  status: 'DRAFT' | 'COMMITTED' | string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  committedAt?: string;
  fileCount: number;
  rowCount: number;
  orderCount: number;
  orderNoCount?: number;
  orderNos: string[];
  orderNosPreview?: string[];
  committedOrderCount?: number;
  committedOrderNos?: string[];
  committedOrderNosPreview?: string[];
  currentCommittedOrderCount?: number;
  currentCommittedOrderNos?: string[];
  currentCommittedOrderNosPreview?: string[];
  fileNames: string[];
  fileNamesPreview?: string[];
  duplicateRowCount: number;
  selectableOrderCount?: number;
  blockedOrderCount?: number;
  errorCount: number;
  warningCount: number;
  materialSyncCount?: number;
  materialSyncPreview?: string[];
}

export interface OrderImportSessionListResponse {
  items: OrderImportSessionSummary[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface OrderImportConfigResponse {
  uploadMaxBytes: number;
  uploadMaxMb: number;
  allowedExtensions: string[];
}

export interface OrderImportSelectableOrderNosResponse {
  sessionId: string;
  status: 'DRAFT' | string;
  totalOrderCount: number;
  selectableCount: number;
  blockedCount: number;
  errorCount: number;
  warningCount: number;
  orders?: Array<{
    orderNo: string;
    warningCount: number;
  }>;
  orderNos: string[];
}

export interface CommitOrderImportSessionResponse {
  sessionId: string;
  requestedMode: 'SELECTED' | 'ALL_SELECTABLE';
  createdCount: number;
  skippedBlockedCount: number;
  skippedSelectableCount: number;
  excludedOrderCount: number;
  materialSyncCount: number;
  materialSyncPreview: string[];
  committedOrderNos?: string[];
  createdOrdersPreviewCount: number;
  createdOrdersTruncated: boolean;
  createdOrders: Array<{
    id: string;
    orderNo: string;
    customerName: string;
    status: OrderStatus;
  }>;
}

export interface DiscardOrderImportSessionResponse {
  sessionId: string;
  discarded: boolean;
  deletedMemory?: boolean;
  previousStatus?: string;
  deletedFileCount: number;
}

export interface OrderImportSourceFilePreview {
  orderNo: string;
  file: {
    id: string;
    fileName: string;
    storedFileName?: string;
    fileUrl?: string;
    sheetName?: string;
    rowCount: number;
    acceptedRowCount: number;
    duplicateRowCount: number;
    createdAt?: string;
  };
  rowPage: {
    offset: number;
    limit: number;
    loadedCount: number;
    totalCount: number;
    hasMore: boolean;
  };
  rows: Array<{
    id: string;
    sourceRowNo: number;
    orderBlock?: string;
    orderNo: string;
    orderDate?: string;
    customerName: string;
    projectModel?: string;
    lineType: 'PART' | 'COMPONENT' | string;
    importSequence?: string;
    partCategory?: string;
    componentNo?: string;
    parentComponentNo?: string;
    partCode: string;
    drawingNo?: string;
    drawingVersion?: string;
    partName: string;
    partSpecification?: string;
    partThickness: number;
    orderQuantity?: number;
    unitUsage?: number;
    demandQuantity: number;
    unit: string;
    processRoute?: string;
    processRemark?: string;
    drawingDate?: string;
    drawingStatus?: string;
    issues?: OrderImportIssue[];
    errorCount: number;
    warningCount: number;
  }>;
}

export interface OrderFilters {
  customerId?: string;
  orderNo?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: OrderStatus;
  statuses?: OrderStatus[];
  productionStatuses?: OrderProductionFilterStatus[];
  includeTestFixtures?: boolean;
}

export interface InventoryFilters {
  keyword?: string;
  customerId?: string;
  warehouseId?: string;
  orderNo?: string;
  status?: InventoryStatus;
  stockAlert?: StockAlertFilter;
  excludeOrderNo?: string;
  excludeOrderId?: string;
  limit?: number;
  offset?: number;
  includeTestFixtures?: boolean;
}

export interface InventorySourceDetailFilters {
  unit?: string;
  warehouseId?: string;
  sourceType?: 'ALL' | 'ORDER' | 'STOCK';
  customerId?: string;
  includeTestFixtures?: boolean;
  excludeOrderNo?: string;
  excludeOrderId?: string;
  limit?: number;
  offset?: number;
  withPage?: boolean;
}

export interface AdjustInventoryBatchPayload {
  afterQuantity: number;
  targetStatus?: 'SCRAPPED';
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
  displayStatus?: ProductionExportDisplayStatus;
  limit?: number;
  offset?: number;
  includeTestFixtures?: boolean;
}

export type ProductionExportViewMode = 'ORDER_SUMMARY' | 'TASK_DETAIL';
export type ProductionExportDisplayStatus = ProductionStatus | 'READY_TO_COMPLETE' | 'RECEIVED' | 'ACTIVE' | 'ALL';

export interface ProductionReplenishmentRequestFilters {
  status?: ProductionReplenishmentRequestStatus;
  keyword?: string;
  orderNo?: string;
  productionTaskNo?: string;
  partCode?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  includeTestFixtures?: boolean;
}

export interface ProductionNoticeFilters {
  status?: ProductionNoticeStatus;
  target?: ProductionNoticeTarget;
  noticeType?: ProductionNoticeType;
  keyword?: string;
  customerId?: string;
  customerKeyword?: string;
  orderNo?: string;
  productionTaskNo?: string;
  partCode?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  includeTestFixtures?: boolean;
}

export interface WarehouseWorkFilters {
  customerId?: string;
  orderNo?: string;
  dateFrom?: string;
  dateTo?: string;
  includeTestFixtures?: boolean;
}

export interface WarehouseTransactionFilters extends WarehouseWorkFilters {
  transactionType?: 'IN' | 'OUT';
  limit?: number;
  offset?: number;
}

export interface ConfirmShipmentItemPayload {
  batchId: string;
  orderLineId?: string;
  shipmentQuantity: number;
}

export interface ConfirmShipmentPayload {
  shipmentQuantity?: number;
  batchShipments?: ConfirmShipmentItemPayload[];
  warehouseConfirmedByCode?: string;
  warehouseConfirmedBy?: string;
  salesConfirmedBy?: string;
  overShipmentReason?: string;
  remark?: string;
}

export interface ConfirmReceiptPayload {
  warehouseId: string;
  locationId: string;
  warehouseConfirmedByCode?: string;
  warehouseConfirmedBy?: string;
  remark?: string;
}

export interface CompleteProcessStepPayload {
  processName: string;
  isCompleted: boolean;
  completedQuantity?: number;
  operatorCode?: string;
  operatorCodes?: string[];
  scrapQuantity?: number;
  shortageMode?: ProductionShortageMode;
  managerName?: string;
  shortageReason?: string;
  quantityOverrideReason?: string;
  remark?: string;
}

export interface SubmitOrderPayload {
  submittedByCode: string;
  materialIdentityConfirmed?: boolean;
}

export interface UpdateLineProcessPayload {
  configuredByCode: string;
  steps: ProcessStepDetail[];
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
  managerName?: string;
  shortageReason?: string;
  quantityOverrideReason?: string;
  remark?: string;
}

export interface CompleteProductionPayload {
  supervisorCode: string;
  completedQuantity: number;
  operatorCode?: string;
  operatorCodes?: string[];
  scrapQuantity?: number;
  shortageMode?: ProductionShortageMode;
  managerName?: string;
  shortageReason?: string;
  remark?: string;
}

export interface StartProductionPayload {
  supervisorCode: string;
}

export interface BatchStartProductionPayload {
  taskIds: string[];
  supervisorCode: string;
}

export interface ApproveProductionReplenishmentRequestPayload {
  managerName: string;
  remark?: string;
}

export interface RejectProductionReplenishmentRequestPayload {
  managerName: string;
  reason: string;
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
  productionPlanOverrideByCode?: string;
  productionPlanOverrideReason?: string;
  reason: string;
  managerName?: string;
}

export interface ResolveLineShortagePayload {
  resolutionMode: 'NO_REPLENISHMENT';
  managerName: string;
  reason: string;
}

export interface CancelStartedOrderPayload {
  reason: string;
  managerName: string;
  productionCancelState?: 'NOT_PRODUCED' | 'PRODUCED';
  handlingPlan?: CancelOrderHandlingPlanItemPayload[];
}

export interface CancelOrderHandlingPlanItemPayload {
  orderLineId: string;
  productionTaskNo: string;
  handlingMode: 'STOCK' | 'SCRAP' | 'NONE';
  handlingQuantity?: number;
  remark?: string;
}

export interface AcknowledgeWarehouseNoticePayload {
  acknowledgedByCode?: string;
  acknowledgedBy: string;
  handlingMode?: 'STOCK' | 'SCRAP' | 'NONE';
  handlingQuantity?: number;
  warehouseId?: string;
  locationId?: string;
  remark?: string;
  mergeConfirmed?: boolean;
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
  quarter?: number;
  month?: number;
  customerId?: string;
  inventorySnapshotLimit?: number;
  inventorySnapshotOffset?: number;
}

export interface CreateWarehousePayload {
  warehouseCode?: string;
  warehouseName: string;
}

export interface UpdateWarehousePayload {
  warehouseCode?: string;
  warehouseName?: string;
  status?: CommonStatus;
}

export interface CreateWarehouseLocationPayload {
  locationCode: string;
  locationName?: string;
}

export interface UpdateWarehouseLocationPayload {
  locationCode?: string;
  locationName?: string;
  status?: CommonStatus;
}

export interface ProductionScrapFilters {
  customerId?: string;
  orderNo?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  includeTestFixtures?: boolean;
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

async function uploadErrorMessage(response: Response, fallback: string) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { message?: string | string[]; error?: string };
    return Array.isArray(parsed.message) ? parsed.message.join('; ') : parsed.message || parsed.error || fallback;
  } catch {
    return text || fallback;
  }
}

function xlsxFilename(filename: string) {
  return filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`;
}

function materialPartCodeKey(value: string) {
  return value.trim().toLocaleLowerCase('zh-CN');
}

async function downloadXlsxResponse(response: Response, filename: string) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = xlsxFilename(filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const erpApi = {
  customersPage(keyword?: string, status?: CommonStatus, limit = 50, offset = 0, includeTestFixtures = false) {
    return request<CustomerListResponse>(
      `/customers${toQuery({
        keyword,
        status,
        limit: String(limit),
        offset: String(offset),
        withPage: 'true',
        includeTestFixtures: includeTestFixtures ? 'true' : undefined
      })}`
    );
  },
  async downloadCustomersExport(keyword: string | undefined, status: CommonStatus | undefined, filename: string, includeTestFixtures = false) {
    const response = await fetch(
      `${apiBaseUrl}/customers/export${toQuery({ keyword, status, includeTestFixtures: includeTestFixtures ? 'true' : undefined })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '客户资料导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  customer(id: string) {
    return request<Customer>(`/customers/${id}`);
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
        status: filters.status,
        statuses: filters.statuses?.join(','),
        productionStatuses: filters.productionStatuses?.join(','),
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
  },
  async downloadOrdersExport(filters: OrderFilters, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/orders/export${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status,
        statuses: filters.statuses?.join(','),
        productionStatuses: filters.productionStatuses?.join(','),
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '订单导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  order(orderNo: string) {
    return request<OrderDetail>(`/orders/${orderNo}`);
  },
  async downloadOrderDetailExport(orderNo: string, filename: string) {
    const response = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(orderNo)}/export`);
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '订单明细导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  orderImportSourceFilePreview(orderNo: string, fileId: string, limit = 200, offset = 0) {
    return request<OrderImportSourceFilePreview>(
      `/orders/${encodeURIComponent(orderNo)}/import-source-files/${encodeURIComponent(fileId)}/preview${toQuery({
        limit: String(limit),
        offset: String(offset)
      })}`
    );
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
  createOrderImportSession(createdBy?: string) {
    return request<OrderImportSessionPreview>('/orders/import-sessions', {
      method: 'POST',
      body: JSON.stringify({ createdBy })
    });
  },
  orderImportSessions(limit = 20, offset = 0, includeTestFixtures = false) {
    return request<OrderImportSessionListResponse>(
      `/orders/import-sessions${toQuery({
        limit: String(limit),
        offset: String(offset),
        includeTestFixtures: includeTestFixtures ? 'true' : undefined
      })}`
    );
  },
  orderImportConfig() {
    return request<OrderImportConfigResponse>('/orders/import-config');
  },
  orderImportSession(sessionId: string, orderLimit = 50, orderOffset = 0) {
    return request<OrderImportSessionPreview>(
      `/orders/import-sessions/${sessionId}${toQuery({ orderLimit: String(orderLimit), orderOffset: String(orderOffset) })}`
    );
  },
  orderImportFilePreview(sessionId: string, fileId: string, limit = 200, offset = 0) {
    return request<OrderImportFilePreview>(
      `/orders/import-sessions/${sessionId}/files/${fileId}/preview${toQuery({
        limit: String(limit),
        offset: String(offset)
      })}`
    );
  },
  orderImportSelectableOrderNos(sessionId: string) {
    return request<OrderImportSelectableOrderNosResponse>(`/orders/import-sessions/${sessionId}/selectable-order-nos`);
  },
  async downloadOrderImportTemplate() {
    const response = await fetch(`${apiBaseUrl}/orders/import-template`);
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '订单导入模板下载失败'));
    }
    await downloadXlsxResponse(response, '组件零件清单ERP上传模板.xlsx');
  },
  async downloadOrderImportIssueReport(sessionId: string) {
    const response = await fetch(`${apiBaseUrl}/orders/import-sessions/${sessionId}/error-report`);
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '订单导入问题明细下载失败'));
    }
    await downloadXlsxResponse(response, '订单导入问题明细.xlsx');
  },
  async uploadOrderImportFile(sessionId: string, file: File) {
    const formData = new FormData();
    formData.set('file', file);
    const response = await fetch(`${apiBaseUrl}/orders/import-sessions/${sessionId}/files`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '订单导入文件上传失败'));
    }
    return response.json() as Promise<OrderImportSessionPreview>;
  },
  commitOrderImportSession(
    sessionId: string,
    orderNos: string[],
    previewToken: string,
    allSelectable = false,
    excludedOrderNos: string[] = []
  ) {
    return request<CommitOrderImportSessionResponse>(`/orders/import-sessions/${sessionId}/commit`, {
      method: 'POST',
      body: JSON.stringify(
        allSelectable
          ? { allSelectable: true, excludedOrderNos, previewToken }
          : { orderNos, previewToken }
      )
    });
  },
  deleteOrderImportFile(sessionId: string, fileId: string) {
    return request<OrderImportSessionPreview>(`/orders/import-sessions/${sessionId}/files/${fileId}`, {
      method: 'DELETE'
    });
  },
  discardOrderImportSession(sessionId: string) {
    return request<DiscardOrderImportSessionResponse>(`/orders/import-sessions/${sessionId}`, { method: 'DELETE' });
  },
  async uploadDrawing(file: File) {
    const formData = new FormData();
    formData.set('file', file);
    const response = await fetch(`${apiBaseUrl}/orders/drawings/upload`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '图纸上传失败'));
    }
    return response.json() as Promise<DrawingUploadResponse>;
  },
  async uploadMaterialDrawing(file: File) {
    const formData = new FormData();
    formData.set('file', file);
    const response = await fetch(`${apiBaseUrl}/inventory/material-drawings/upload`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '零件图纸上传失败'));
    }
    return response.json() as Promise<DrawingUploadResponse>;
  },
  createOrder(payload: CreateOrderPayload) {
    return request<OrderDetail>('/orders', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateOrder(orderNo: string, payload: Omit<CreateOrderPayload, 'customerId' | 'orderDate'>) {
    return request<OrderDetail>(`/orders/${orderNo}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  deleteDraftOrder(orderNo: string) {
    return request<{ orderNo: string; deleted: boolean }>(`/orders/${orderNo}`, { method: 'DELETE' });
  },
  submitOrder(orderNo: string, payload: SubmitOrderPayload) {
    return request<OrderDetail>(`/orders/${orderNo}/submit`, { method: 'POST', body: JSON.stringify(payload) });
  },
  updateLineProcess(orderNo: string, lineId: string, payload: UpdateLineProcessPayload) {
    return request<OrderDetail>(`/orders/${orderNo}/lines/${lineId}/process`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  processDefinitionsPage(filters: ProcessDefinitionFilters = {}) {
    return request<ProcessDefinitionListResponse>(
      `/process-definitions${toQuery({
        keyword: filters.keyword,
        status: filters.status,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset !== undefined ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  async processDefinitions(keyword?: string, status?: CommonStatus | 'ALL') {
    const rows: ProcessDefinition[] = [];
    const pageLimit = 200;
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const result = await erpApi.processDefinitionsPage({ keyword, status, limit: pageLimit, offset });
      rows.push(...result.items);
      hasMore = result.hasMore && result.items.length > 0;
      offset += pageLimit;
    }
    return rows;
  },
  async downloadProcessDefinitionsExport(
    keyword: string | undefined,
    status: CommonStatus | 'ALL' | undefined,
    filename: string,
    includeTestFixtures = false
  ) {
    const response = await fetch(
      `${apiBaseUrl}/process-definitions/export${toQuery({
        keyword,
        status,
        includeTestFixtures: includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '标准工序导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  createProcessDefinition(payload: SaveProcessDefinitionPayload) {
    return request<ProcessDefinition>('/process-definitions', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateProcessDefinition(id: string, payload: Partial<SaveProcessDefinitionPayload>) {
    return request<ProcessDefinition>(`/process-definitions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  deleteProcessDefinition(id: string) {
    return request<ProcessDefinition>(`/process-definitions/${id}`, { method: 'DELETE' });
  },
  restoreProcessDefinition(id: string) {
    return request<ProcessDefinition>(`/process-definitions/${id}/restore`, { method: 'PATCH' });
  },
  processTemplatesPage(filters: ProcessTemplateFilters = {}) {
    return request<ProcessTemplateListResponse>(
      `/process-templates${toQuery({
        keyword: filters.keyword,
        status: filters.status,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset !== undefined ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  async downloadProcessTemplatesExport(
    keyword: string | undefined,
    status: CommonStatus | 'ALL' | undefined,
    filename: string,
    includeTestFixtures = false
  ) {
    const response = await fetch(
      `${apiBaseUrl}/process-templates/export${toQuery({
        keyword,
        status,
        includeTestFixtures: includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '流程记忆导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  createProcessTemplate(payload: SaveProcessTemplatePayload) {
    return request<ProcessTemplate>('/process-templates', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateProcessTemplate(id: string, payload: Partial<SaveProcessTemplatePayload>) {
    return request<ProcessTemplate>(`/process-templates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  deleteProcessTemplate(id: string) {
    return request<{ id: string; disabled: boolean }>(`/process-templates/${id}`, { method: 'DELETE' });
  },
  restoreProcessTemplate(id: string) {
    return request<ProcessTemplate>(`/process-templates/${id}/restore`, { method: 'PATCH' });
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
  resolveLineShortage(orderNo: string, lineId: string, payload: ResolveLineShortagePayload) {
    return request<OrderDetail>(`/orders/${orderNo}/lines/${lineId}/shortage-resolution`, {
      method: 'POST',
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
  productionTasksPage(filters: ProductionTaskFilters = {}) {
    return request<ProductionTaskListResponse>(
      `/production/tasks${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status,
        displayStatus: filters.displayStatus,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset !== undefined ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  productionOrderSummariesPage(filters: ProductionTaskFilters = {}) {
    return request<ProductionOrderSummaryListResponse>(
      `/production/tasks/order-summary${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status,
        displayStatus: filters.displayStatus,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset !== undefined ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  async downloadProductionExport(
    filters: ProductionTaskFilters = {},
    viewMode: ProductionExportViewMode,
    displayStatus: ProductionExportDisplayStatus,
    filename: string
  ) {
    const response = await fetch(
      `${apiBaseUrl}/production/tasks/export${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status,
        viewMode,
        displayStatus,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '生产 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  productionAnnualSummary(year: number, includeTestFixtures = false) {
    return request<ProductionAnnualSummaryRow[]>(
      `/production/tasks/annual-summary${toQuery({
        year: String(year),
        includeTestFixtures: includeTestFixtures ? 'true' : undefined
      })}`
    );
  },
  productionOperators(keyword?: string) {
    return request<ProductionOperator[]>(`/production/tasks/operators${toQuery({ keyword })}`);
  },
  productionNoticesPage(status?: ProductionNoticeStatus, target?: ProductionNoticeTarget, filters: ProductionNoticeFilters = {}) {
    return request<ProductionNoticeListResponse>(
      `/production/tasks/notices${toQuery({
        status: filters.status || status,
        target: filters.target || target,
        noticeType: filters.noticeType,
        keyword: filters.keyword?.trim() || undefined,
        customerId: filters.customerId,
        customerKeyword: filters.customerKeyword?.trim() || undefined,
        orderNo: filters.orderNo?.trim() || undefined,
        productionTaskNo: filters.productionTaskNo?.trim() || undefined,
        partCode: filters.partCode?.trim() || undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  adminProductionNoticesPage(filters: ProductionNoticeFilters = {}) {
    return request<ProductionNoticeListResponse>(
      `/production/tasks/notices/admin${toQuery({
        status: filters.status,
        target: filters.target,
        noticeType: filters.noticeType,
        keyword: filters.keyword?.trim() || undefined,
        customerId: filters.customerId,
        customerKeyword: filters.customerKeyword?.trim() || undefined,
        orderNo: filters.orderNo?.trim() || undefined,
        productionTaskNo: filters.productionTaskNo?.trim() || undefined,
        partCode: filters.partCode?.trim() || undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  async downloadProductionNoticesExport(filters: ProductionNoticeFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/production/tasks/notices/export${toQuery({
        status: filters.status,
        noticeType: filters.noticeType,
        keyword: filters.keyword?.trim() || undefined,
        customerId: filters.customerId,
        customerKeyword: filters.customerKeyword?.trim() || undefined,
        orderNo: filters.orderNo?.trim() || undefined,
        productionTaskNo: filters.productionTaskNo?.trim() || undefined,
        partCode: filters.partCode?.trim() || undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '生产通知 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  async downloadAdminProductionNoticesExport(filters: ProductionNoticeFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/production/tasks/notices/admin/export${toQuery({
        status: filters.status,
        target: filters.target,
        noticeType: filters.noticeType,
        keyword: filters.keyword?.trim() || undefined,
        customerId: filters.customerId,
        customerKeyword: filters.customerKeyword?.trim() || undefined,
        orderNo: filters.orderNo?.trim() || undefined,
        productionTaskNo: filters.productionTaskNo?.trim() || undefined,
        partCode: filters.partCode?.trim() || undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '管理员通知 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  productionReplenishmentRequestsPage(filters: ProductionReplenishmentRequestFilters = {}) {
    return request<ProductionReplenishmentRequestListResponse>(
      `/production/tasks/replenishment-requests${toQuery({
        status: filters.status,
        keyword: filters.keyword?.trim() || undefined,
        orderNo: filters.orderNo?.trim() || undefined,
        productionTaskNo: filters.productionTaskNo?.trim() || undefined,
        partCode: filters.partCode?.trim() || undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  async downloadProductionReplenishmentRequestsExport(filters: ProductionReplenishmentRequestFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/production/tasks/replenishment-requests/export${toQuery({
        status: filters.status,
        keyword: filters.keyword?.trim() || undefined,
        orderNo: filters.orderNo?.trim() || undefined,
        productionTaskNo: filters.productionTaskNo?.trim() || undefined,
        partCode: filters.partCode?.trim() || undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '生产报废补单申请 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  acknowledgeProductionNotice(id: string, acknowledgedBy: string) {
    return request<ProductionNotice>(`/production/tasks/notices/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ acknowledgedBy })
    });
  },
  productionScrapRecordsPage(filters: ProductionScrapFilters = {}) {
    return request<ProductionScrapRecordListResponse>(
      `/production/tasks/scrap-records${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo?.trim() || undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  async productionScrapRecordsAllPages(filters: ProductionScrapFilters = {}) {
    const rows: ProductionScrapRecord[] = [];
    const pageLimit = Number(200);
    let offset = Number(0);
    let hasMore = true;
    while (hasMore) {
      const result = await erpApi.productionScrapRecordsPage({
        ...filters,
        limit: pageLimit,
        offset
      });
      rows.push(...result.items);
      hasMore = result.hasMore && result.items.length > 0;
      offset = result.offset + result.items.length;
    }
    return rows;
  },
  async downloadProductionScrapRecordsExport(filters: ProductionScrapFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/production/tasks/scrap-records/export${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '生产报废统计 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  orderStatistics(filters: OrderStatisticsFilters) {
    return request<OrderStatisticsResponse>(
      `/statistics/orders${toQuery({
        period: filters.period,
        year: filters.year ? String(filters.year) : undefined,
        quarter: filters.quarter ? String(filters.quarter) : undefined,
        month: filters.month ? String(filters.month) : undefined,
        customerId: filters.customerId,
        inventorySnapshotLimit: filters.inventorySnapshotLimit ? String(filters.inventorySnapshotLimit) : undefined,
        inventorySnapshotOffset:
          filters.inventorySnapshotOffset === undefined ? undefined : String(filters.inventorySnapshotOffset)
      })}`
    );
  },
  orderStatisticsOptions() {
    return request<OrderStatisticsOptions>('/statistics/options');
  },
  async downloadStatisticsExport(filters: OrderStatisticsFilters, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/statistics/orders/export${toQuery({
        period: filters.period,
        year: filters.year ? String(filters.year) : undefined,
        quarter: filters.quarter ? String(filters.quarter) : undefined,
        month: filters.month ? String(filters.month) : undefined,
        customerId: filters.customerId
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '统计 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  startProduction(id: string, payload: StartProductionPayload) {
    return request<ProductionTask>(`/production/tasks/${id}/start`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  batchStartProduction(payload: BatchStartProductionPayload) {
    return request<{ orderId: string; orderNo: string; startedCount: number }>('/production/tasks/batch-start', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
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
  approveProductionReplenishmentRequest(completionId: string, payload: ApproveProductionReplenishmentRequestPayload) {
    return request<ProductionTask>(`/production/tasks/process-completions/${completionId}/replenishment-request/approve`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  rejectProductionReplenishmentRequest(completionId: string, payload: RejectProductionReplenishmentRequestPayload) {
    return request<ProductionTask>(`/production/tasks/process-completions/${completionId}/replenishment-request/reject`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  warehouses(filters: { status?: CommonStatus | 'ALL'; locationStatus?: CommonStatus | 'ALL'; includeTestFixtures?: boolean } = {}) {
    return request<Warehouse[]>(
      `/warehouses${toQuery({
        status: filters.status,
        locationStatus: filters.locationStatus,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
  },
  async downloadWarehouseConfigExport(
    filters: { status?: CommonStatus | 'ALL'; locationStatus?: CommonStatus | 'ALL'; includeTestFixtures?: boolean } = {},
    filename: string
  ) {
    const response = await fetch(
      `${apiBaseUrl}/warehouses/export${toQuery({
        status: filters.status,
        locationStatus: filters.locationStatus,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '仓库配置 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  createWarehouse(payload: CreateWarehousePayload) {
    return request<Warehouse>('/warehouses', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateWarehouse(warehouseId: string, payload: UpdateWarehousePayload) {
    return request<Warehouse>(`/warehouses/${warehouseId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  deleteWarehouse(warehouseId: string) {
    return request<{ deleted: boolean }>(`/warehouses/${warehouseId}`, { method: 'DELETE' });
  },
  createWarehouseLocation(warehouseId: string, payload: CreateWarehouseLocationPayload) {
    return request(`/warehouses/${warehouseId}/locations`, { method: 'POST', body: JSON.stringify(payload) });
  },
  updateWarehouseLocation(warehouseId: string, locationId: string, payload: UpdateWarehouseLocationPayload) {
    return request<WarehouseLocation>(`/warehouses/${warehouseId}/locations/${locationId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  deleteWarehouseLocation(warehouseId: string, locationId: string) {
    return request<{ deleted: boolean }>(`/warehouses/${warehouseId}/locations/${locationId}`, { method: 'DELETE' });
  },
  pendingReceipts(filters: WarehouseWorkFilters = {}) {
    return request<WarehouseReceipt[]>(
      `/warehouse/receipts/pending${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
  },
  // compatibility: confirmReceipt(productionTaskId: string, warehouseId: string, locationId: string, remark?: string)
  confirmReceipt(
    productionTaskId: string,
    warehouseIdOrPayload: string | ConfirmReceiptPayload,
    locationId?: string,
    remark?: string
  ) {
    const body =
      typeof warehouseIdOrPayload === 'string'
        ? { warehouseId: warehouseIdOrPayload, locationId, remark }
        : warehouseIdOrPayload;
    return request(`/warehouse/receipts/${productionTaskId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },
  pendingShipments(filters: WarehouseWorkFilters = {}) {
    return request<WarehouseShipment[]>(
      `/warehouse/shipments/pending${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
  },
  async downloadWarehouseWorkExport(filters: WarehouseWorkFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/warehouse/work/export${toQuery({
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '仓库待处理 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  // compatibility: confirmShipment(batchId: string, remark?: string)
  confirmShipment(batchId: string, payload: ConfirmShipmentPayload | string = {}) {
    const body = typeof payload === 'string' ? { remark: payload } : payload;
    return request(`/warehouse/shipments/${batchId}/confirm`, { method: 'POST', body: JSON.stringify(body) });
  },
  // compatibility: confirmBatchShipment(batchIds: string[], remark?: string)
  confirmBatchShipment(batchIds: string[], payload: ConfirmShipmentPayload | string = {}) {
    const body = typeof payload === 'string' ? { remark: payload } : payload;
    return request('/warehouse/shipments/batch-confirm', {
      method: 'POST',
      body: JSON.stringify({ batchIds, ...body })
    });
  },
  // compatibility: confirmOrderShipment(orderNo: string, remark?: string)
  confirmOrderShipment(orderNo: string, payload: ConfirmShipmentPayload | string = {}) {
    const body = typeof payload === 'string' ? { remark: payload } : payload;
    return request(`/warehouse/shipments/orders/${encodeURIComponent(orderNo)}/confirm`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },
  warehouseNoticesPage(status?: ProductionNoticeStatus, filters: Omit<ProductionNoticeFilters, 'target'> = {}) {
    return request<ProductionNoticeListResponse>(
      `/warehouse/notices${toQuery({
        status: filters.status || status,
        noticeType: filters.noticeType,
        keyword: filters.keyword?.trim() || undefined,
        customerId: filters.customerId,
        customerKeyword: filters.customerKeyword?.trim() || undefined,
        orderNo: filters.orderNo?.trim() || undefined,
        productionTaskNo: filters.productionTaskNo?.trim() || undefined,
        partCode: filters.partCode?.trim() || undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  async downloadWarehouseNoticesExport(filters: Omit<ProductionNoticeFilters, 'target'> = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/warehouse/notices/export${toQuery({
        status: filters.status,
        noticeType: filters.noticeType,
        keyword: filters.keyword?.trim() || undefined,
        customerId: filters.customerId,
        customerKeyword: filters.customerKeyword?.trim() || undefined,
        orderNo: filters.orderNo?.trim() || undefined,
        productionTaskNo: filters.productionTaskNo?.trim() || undefined,
        partCode: filters.partCode?.trim() || undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '仓库通知 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  acknowledgeWarehouseNotice(id: string, payload: AcknowledgeWarehouseNoticePayload | string) {
    const body = typeof payload === 'string' ? { acknowledgedBy: payload } : payload;
    return request<ProductionNotice>(`/warehouse/notices/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },
  warehouseTransactionsPage(filters: WarehouseTransactionFilters = {}) {
    return request<WarehouseTransactionListResponse>(
      `/warehouse/transactions${toQuery({
        transactionType: filters.transactionType,
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset ? String(filters.offset) : undefined,
        withPage: 'true'
      })}`
    );
  },
  async downloadWarehouseTransactionsExport(filters: WarehouseTransactionFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/warehouse/transactions/export${toQuery({
        transactionType: filters.transactionType,
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '库存流水 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  async downloadInventoryExport(filters: InventoryFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/inventory/export${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        warehouseId: filters.warehouseId,
        orderNo: filters.orderNo,
        status: filters.status,
        stockAlert: filters.stockAlert,
        excludeOrderNo: filters.excludeOrderNo,
        excludeOrderId: filters.excludeOrderId,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '库存 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  inventoryPage(filters: InventoryFilters) {
    return request<InventoryBatchListResponse>(
      `/inventory${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        warehouseId: filters.warehouseId,
        orderNo: filters.orderNo,
        status: filters.status,
        stockAlert: filters.stockAlert,
        excludeOrderNo: filters.excludeOrderNo,
        excludeOrderId: filters.excludeOrderId,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
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
        status: filters.status,
        stockAlert: filters.stockAlert,
        excludeOrderNo: filters.excludeOrderNo,
        excludeOrderId: filters.excludeOrderId,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
  },
  inventorySummaryPage(filters: InventoryFilters) {
    return request<InventorySummaryListResponse>(
      `/inventory/summary${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        warehouseId: filters.warehouseId,
        orderNo: filters.orderNo,
        status: filters.status,
        stockAlert: filters.stockAlert,
        excludeOrderNo: filters.excludeOrderNo,
        excludeOrderId: filters.excludeOrderId,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  inventoryMaterialSuggestions(
    keyword: string,
    warehouseId?: string,
    sourceType?: 'ALL' | 'ORDER' | 'STOCK',
    excludeOrderNo?: string,
    excludeOrderId?: string,
    customerId?: string,
    projectModel?: string
  ) {
    return request<InventoryMaterialSuggestion[]>(
      `/inventory/materials/suggestions${toQuery({
        keyword,
        customerId,
        projectModel,
        warehouseId,
        sourceType,
        excludeOrderNo,
        excludeOrderId
      })}`
    );
  },
  inventoryMaterialsPage(filters: MaterialMemoryFilters = {}) {
    return request<MaterialMemoryListResponse>(
      `/inventory/materials${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        projectModel: filters.projectModel,
        status: filters.status,
        stockAlert: filters.stockAlert,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  async inventoryMaterialsAllPages(filters: MaterialMemoryFilters = {}) {
    const rows: MaterialMemory[] = [];
    const pageLimit = Number(100);
    let offset = Number(0);
    let hasMore = true;
    while (hasMore) {
      const result = await erpApi.inventoryMaterialsPage({
        ...filters,
        limit: pageLimit,
        offset
      });
      rows.push(...result.items);
      hasMore = result.hasMore && result.items.length > 0;
      offset = result.offset + result.items.length;
    }
    return rows;
  },
  async inventoryMaterialByPartCode(partCode: string, status: CommonStatus = 'ENABLED') {
    const keyword = partCode.trim();
    if (!keyword) {
      return undefined;
    }
    const exactKey = materialPartCodeKey(keyword);
    const pageLimit = Number(100);
    let offset = Number(0);
    let hasMore = true;
    while (hasMore) {
      const result = await erpApi.inventoryMaterialsPage({
        keyword,
        status,
        limit: pageLimit,
        offset
      });
      const matched = result.items.find((row) => materialPartCodeKey(row.partCode) === exactKey);
      if (matched) {
        return matched;
      }
      hasMore = result.hasMore && result.items.length > 0;
      offset = result.offset + result.items.length;
    }
    return undefined;
  },
  async downloadInventoryMaterialsExport(filters: MaterialMemoryFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/inventory/materials/export${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        projectModel: filters.projectModel,
        status: filters.status,
        stockAlert: filters.stockAlert,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '零件基础库 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  materialDashboard(filters: MaterialDashboardFilters = {}) {
    return request<MaterialDashboardResponse>(
      `/materials/dashboard${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        projectModel: filters.projectModel,
        scopeType: filters.scopeType,
        relationType: filters.relationType,
        drawingNo: filters.drawingNo,
        drawingStatus: filters.drawingStatus,
        drawingSource: filters.drawingSource,
        bomStructureType: filters.bomStructureType,
        bomPresence: filters.bomPresence,
        recentOrderPresence: filters.recentOrderPresence,
        stockAlert: filters.stockAlert,
        drawingDateFrom: filters.drawingDateFrom,
        drawingDateTo: filters.drawingDateTo,
        lastOrderDateFrom: filters.lastOrderDateFrom,
        lastOrderDateTo: filters.lastOrderDateTo,
        status: filters.status,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
  },
  async downloadMaterialDashboardExport(filters: MaterialDashboardFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/materials/dashboard/export${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        projectModel: filters.projectModel,
        scopeType: filters.scopeType,
        relationType: filters.relationType,
        drawingNo: filters.drawingNo,
        drawingStatus: filters.drawingStatus,
        drawingSource: filters.drawingSource,
        bomStructureType: filters.bomStructureType,
        bomPresence: filters.bomPresence,
        recentOrderPresence: filters.recentOrderPresence,
        stockAlert: filters.stockAlert,
        drawingDateFrom: filters.drawingDateFrom,
        drawingDateTo: filters.drawingDateTo,
        lastOrderDateFrom: filters.lastOrderDateFrom,
        lastOrderDateTo: filters.lastOrderDateTo,
        status: filters.status,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '零件管理 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  materialProjectModels(customerId?: string, includeTestFixtures = false) {
    return request<string[]>(`/materials/project-models${toQuery({ customerId, includeTestFixtures: includeTestFixtures ? 'true' : undefined })}`);
  },
  materialCommonProjectModels(includeTestFixtures = false) {
    return request<string[]>(
      `/materials/common-project-models${toQuery({ includeTestFixtures: includeTestFixtures ? 'true' : undefined })}`
    );
  },
  saveMaterialCommonProjectModels(projectModels: string[]) {
    return request<string[]>('/materials/common-project-models', {
      method: 'PATCH',
      body: JSON.stringify({ projectModels })
    });
  },
  createMaterialImportSession(createdBy?: string) {
    return request<MaterialImportSessionPreview>('/inventory/material-import-sessions', {
      method: 'POST',
      body: JSON.stringify({ createdBy })
    });
  },
  createMaterialImportSessionFromOrderImport(orderImportSessionId: string, previewToken: string, createdBy?: string) {
    return request<MaterialImportSessionPreview>(`/inventory/material-import-sessions/from-order-import/${orderImportSessionId}`, {
      method: 'POST',
      body: JSON.stringify({ previewToken, createdBy })
    });
  },
  materialImportSession(sessionId: string, rowLimit = 100, rowOffset = 0) {
    return request<MaterialImportSessionPreview>(
      `/inventory/material-import-sessions/${sessionId}${toQuery({
        rowLimit: String(rowLimit),
        rowOffset: String(rowOffset)
      })}`
    );
  },
  async downloadMaterialImportTemplate() {
    const response = await fetch(`${apiBaseUrl}/inventory/material-import-template`);
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '零件库导入模板下载失败'));
    }
    await downloadXlsxResponse(response, '零件基础库导入模板.xlsx');
  },
  async downloadMaterialImportIssueReport(sessionId: string) {
    const response = await fetch(`${apiBaseUrl}/inventory/material-import-sessions/${sessionId}/error-report`);
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '零件库导入问题明细下载失败'));
    }
    await downloadXlsxResponse(response, '零件库导入问题明细.xlsx');
  },
  async uploadMaterialImportFile(sessionId: string, file: File) {
    const formData = new FormData();
    formData.set('file', file);
    const response = await fetch(`${apiBaseUrl}/inventory/material-import-sessions/${sessionId}/files`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '零件库导入文件上传失败'));
    }
    return response.json() as Promise<MaterialImportSessionPreview>;
  },
  commitMaterialImportSession(sessionId: string, previewToken: string) {
    return request<CommitMaterialImportSessionResponse>(`/inventory/material-import-sessions/${sessionId}/commit`, {
      method: 'POST',
      body: JSON.stringify({ previewToken })
    });
  },
  deleteMaterialImportFile(sessionId: string, fileId: string) {
    return request<MaterialImportSessionPreview>(`/inventory/material-import-sessions/${sessionId}/files/${fileId}`, {
      method: 'DELETE'
    });
  },
  discardMaterialImportSession(sessionId: string) {
    return request<DiscardMaterialImportSessionResponse>(`/inventory/material-import-sessions/${sessionId}`, {
      method: 'DELETE'
    });
  },
  createInventoryMaterial(payload: CreateMaterialMemoryPayload) {
    return request<MaterialMemory>('/inventory/materials', { method: 'POST', body: JSON.stringify(payload) });
  },
  materialDrawingRevisions(materialId: string) {
    return request<MaterialDrawingRevisionResponse>(`/inventory/materials/${materialId}/drawing-revisions`);
  },
  async downloadMaterialDrawingRevisionsExport(materialId: string, filename: string) {
    const response = await fetch(`${apiBaseUrl}/inventory/materials/${materialId}/drawing-revisions/export`);
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '零件图纸版本 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  saveMaterialDrawingRevision(materialId: string, payload: SaveMaterialDrawingRevisionPayload) {
    return request<MaterialDrawingRevision>(`/inventory/materials/${materialId}/drawing-revisions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  updateMaterialDrawingRevision(revisionId: string, payload: UpdateMaterialDrawingRevisionPayload) {
    return request<MaterialDrawingRevision>(`/inventory/material-drawing-revisions/${revisionId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  restoreMaterialDrawingRevision(revisionId: string) {
    return request<MaterialDrawingRevision>(`/inventory/material-drawing-revisions/${revisionId}/restore`, {
      method: 'PATCH'
    });
  },
  disableMaterialDrawingRevision(revisionId: string) {
    return request<MaterialDrawingRevision>(`/inventory/material-drawing-revisions/${revisionId}`, {
      method: 'DELETE'
    });
  },
  materialApplicabilities(materialId: string) {
    return request<MaterialApplicabilityResponse>(`/inventory/materials/${materialId}/applicabilities`);
  },
  async downloadMaterialApplicabilitiesExport(materialId: string, filename: string) {
    const response = await fetch(`${apiBaseUrl}/inventory/materials/${materialId}/applicabilities/export`);
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '零件适用范围 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  saveMaterialApplicability(materialId: string, payload: SaveMaterialApplicabilityPayload) {
    return request<MaterialApplicability>(`/inventory/materials/${materialId}/applicabilities`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  updateMaterialApplicability(applicabilityId: string, payload: UpdateMaterialApplicabilityPayload) {
    return request<MaterialApplicability>(`/inventory/material-applicabilities/${applicabilityId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  restoreMaterialApplicability(applicabilityId: string) {
    return request<MaterialApplicability>(`/inventory/material-applicabilities/${applicabilityId}/restore`, {
      method: 'PATCH'
    });
  },
  disableMaterialApplicability(applicabilityId: string) {
    return request<MaterialApplicability>(`/inventory/material-applicabilities/${applicabilityId}`, {
      method: 'DELETE'
    });
  },
  modelBomsPage(filters: ModelBomFilters = {}) {
    return request<ModelBomListResponse>(
      `/inventory/model-boms${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        projectModel: filters.projectModel,
        scopeMode: filters.scopeMode,
        excludeGlobalAllProject: filters.excludeGlobalAllProject ? 'true' : undefined,
        commonOnly: filters.commonOnly ? 'true' : undefined,
        status: filters.status,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset !== undefined ? String(filters.offset) : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        withPage: 'true'
      })}`
    );
  },
  async downloadModelBomsExport(filters: ModelBomFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/inventory/model-boms/export${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        projectModel: filters.projectModel,
        scopeMode: filters.scopeMode,
        excludeGlobalAllProject: filters.excludeGlobalAllProject ? 'true' : undefined,
        commonOnly: filters.commonOnly ? 'true' : undefined,
        status: filters.status,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '机型零件包 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  modelBom(bomId: string) {
    return request<ModelBom>(`/inventory/model-boms/${bomId}`);
  },
  modelBomRevisions(bomId: string, filters: { limit?: number; offset?: number } = {}) {
    return request<ModelBomRevisionListResponse>(
      `/inventory/model-boms/${bomId}/revisions${toQuery({
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset !== undefined ? String(filters.offset) : undefined
      })}`
    );
  },
  modelBomScopeApprovalRequests(filters: ModelBomScopeApprovalRequestFilters = {}) {
    return request<ModelBomScopeApprovalRequestListResponse>(
      `/inventory/model-bom-scope-approval-requests${toQuery({
        bomId: filters.bomId,
        status: filters.status && filters.status !== 'ALL' ? filters.status : undefined,
        requestedCustomerScopeMode: filters.requestedCustomerScopeMode,
        requestedScopeKey: filters.requestedScopeKey,
        requestedProjectModelScopeKey: filters.requestedProjectModelScopeKey,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset !== undefined ? String(filters.offset) : undefined
      })}`
    );
  },
  createModelBomScopeApprovalRequest(bomId: string, payload: CreateModelBomScopeApprovalRequestPayload) {
    return request<ModelBomScopeApprovalRequest>(`/inventory/model-boms/${bomId}/scope-approval-requests`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  approveModelBomScopeApprovalRequest(requestId: string, payload: ReviewModelBomScopeApprovalRequestPayload) {
    return request<ModelBomScopeApprovalRequest>(`/inventory/model-bom-scope-approval-requests/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  rejectModelBomScopeApprovalRequest(requestId: string, payload: ReviewModelBomScopeApprovalRequestPayload) {
    return request<ModelBomScopeApprovalRequest>(`/inventory/model-bom-scope-approval-requests/${requestId}/reject`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  createModelBomDraftsFromOrderImport(orderImportSessionId: string, previewToken: string) {
    return request<ModelBomDraftPreview>(`/inventory/model-bom-drafts/from-order-import/${orderImportSessionId}`, {
      method: 'POST',
      body: JSON.stringify({ previewToken })
    });
  },
  commitModelBomDraftFromOrderImport(
    orderImportSessionId: string,
    payload: { previewToken: string; draftKey: string; bomName?: string; confirmedBy?: string; reviewedExistingBomIds?: string[] }
  ) {
    return request<ModelBom>(`/inventory/model-bom-drafts/from-order-import/${orderImportSessionId}/commit`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  modelBomDiffReviewsPage(bomId: string, filters: ModelBomDiffReviewFilters = {}) {
    return request<ModelBomDiffReviewListResponse>(
      `/inventory/model-boms/${bomId}/diff-reviews${toQuery({
        sourceBomId: filters.sourceBomId,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset !== undefined ? String(filters.offset) : undefined,
        withPage: filters.withPage ? 'true' : undefined
      })}`
    );
  },
  async downloadModelBomDiffReviewsExport(bomId: string, sourceBomId: string | undefined, filename: string) {
    const response = await fetch(`${apiBaseUrl}/inventory/model-boms/${bomId}/diff-reviews/export${toQuery({ sourceBomId })}`);
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, 'BOM 差异核对记录 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  confirmModelBomDiffReview(bomId: string, payload: ConfirmModelBomDiffReviewPayload) {
    return request<ModelBomDiffReview>(`/inventory/model-boms/${bomId}/diff-reviews`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  disableModelBomDiffReview(reviewId: string) {
    return request<ModelBomDiffReview>(`/inventory/model-bom-diff-reviews/${reviewId}`, { method: 'DELETE' });
  },
  createModelBom(payload: SaveModelBomPayload) {
    return request<ModelBom>('/inventory/model-boms', { method: 'POST', body: JSON.stringify(payload) });
  },
  copyModelBom(bomId: string, payload: CopyModelBomPayload) {
    return request<ModelBom>(`/inventory/model-boms/${bomId}/copy`, { method: 'POST', body: JSON.stringify(payload) });
  },
  updateModelBom(bomId: string, payload: SaveModelBomPayload) {
    return request<ModelBom>(`/inventory/model-boms/${bomId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  setModelBomCommon(bomId: string, isCommon: boolean) {
    return request<ModelBom>(`/inventory/model-boms/${bomId}/common`, { method: 'PATCH', body: JSON.stringify({ isCommon }) });
  },
  setModelBomsCommonBatch(payload: SetModelBomsCommonBatchPayload) {
    return request<{ updatedCount: number; isCommon: boolean }>('/inventory/model-boms/common/batch', {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  reorderModelBomCommon(payload: ReorderModelBomCommonPayload) {
    return request<{ updatedCount: number }>('/inventory/model-boms/common/reorder', { method: 'PATCH', body: JSON.stringify(payload) });
  },
  disableModelBom(bomId: string) {
    return request<ModelBom>(`/inventory/model-boms/${bomId}`, { method: 'DELETE' });
  },
  deleteModelBom(bomId: string) {
    return request<{ id: string; bomName: string; lineCount: number; customerScopeCount: number; diffReviewCount: number; deleted: true }>(
      `/inventory/model-boms/${bomId}/permanent`,
      { method: 'DELETE' }
    );
  },
  saveModelBomLine(bomId: string, payload: SaveModelBomLinePayload) {
    return request<ModelBomLine>(`/inventory/model-boms/${bomId}/lines`, { method: 'POST', body: JSON.stringify(payload) });
  },
  reorderModelBomLines(bomId: string, payload: ReorderModelBomLinesPayload) {
    return request<ModelBom>(`/inventory/model-boms/${bomId}/lines/reorder`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  updateModelBomLine(lineId: string, payload: SaveModelBomLinePayload) {
    return request<ModelBomLine>(`/inventory/model-bom-lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  disableModelBomLine(lineId: string) {
    return request<ModelBomLine>(`/inventory/model-bom-lines/${lineId}`, { method: 'DELETE' });
  },
  materialTransformRules(filters: MaterialTransformRuleFilters = {}) {
    return request<MaterialTransformRule[]>(
      `/inventory/material-transform-rules${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        projectModel: filters.projectModel,
        sourceMaterialId: filters.sourceMaterialId,
        sourcePartCode: filters.sourcePartCode,
        targetMaterialId: filters.targetMaterialId,
        targetPartCode: filters.targetPartCode,
        status: filters.status,
        sourceStockStatus: filters.sourceStockStatus && filters.sourceStockStatus !== 'ALL' ? filters.sourceStockStatus : undefined,
        targetStockStatus: filters.targetStockStatus && filters.targetStockStatus !== 'ALL' ? filters.targetStockStatus : undefined,
        inventoryDecision: filters.inventoryDecision && filters.inventoryDecision !== 'ALL' ? filters.inventoryDecision : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
  },
  materialTransformRulesPage(filters: MaterialTransformRuleFilters = {}) {
    return request<MaterialTransformRuleListResponse>(
      `/inventory/material-transform-rules${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        projectModel: filters.projectModel,
        sourceMaterialId: filters.sourceMaterialId,
        sourcePartCode: filters.sourcePartCode,
        targetMaterialId: filters.targetMaterialId,
        targetPartCode: filters.targetPartCode,
        status: filters.status,
        sourceStockStatus: filters.sourceStockStatus && filters.sourceStockStatus !== 'ALL' ? filters.sourceStockStatus : undefined,
        targetStockStatus: filters.targetStockStatus && filters.targetStockStatus !== 'ALL' ? filters.targetStockStatus : undefined,
        inventoryDecision: filters.inventoryDecision && filters.inventoryDecision !== 'ALL' ? filters.inventoryDecision : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset !== undefined ? String(filters.offset) : undefined,
        withPage: 'true'
      })}`
    );
  },
  async downloadMaterialTransformRulesExport(filters: MaterialTransformRuleFilters = {}, filename: string) {
    const response = await fetch(
      `${apiBaseUrl}/inventory/material-transform-rules/export${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        projectModel: filters.projectModel,
        sourceMaterialId: filters.sourceMaterialId,
        sourcePartCode: filters.sourcePartCode,
        targetMaterialId: filters.targetMaterialId,
        targetPartCode: filters.targetPartCode,
        status: filters.status,
        sourceStockStatus: filters.sourceStockStatus && filters.sourceStockStatus !== 'ALL' ? filters.sourceStockStatus : undefined,
        targetStockStatus: filters.targetStockStatus && filters.targetStockStatus !== 'ALL' ? filters.targetStockStatus : undefined,
        inventoryDecision: filters.inventoryDecision && filters.inventoryDecision !== 'ALL' ? filters.inventoryDecision : undefined,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined
      })}`
    );
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '来源加工关系 Excel 导出失败'));
    }
    await downloadXlsxResponse(response, filename);
  },
  createMaterialTransformRule(payload: SaveMaterialTransformRulePayload) {
    return request<MaterialTransformRule>('/inventory/material-transform-rules', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  updateMaterialTransformRule(ruleId: string, payload: UpdateMaterialTransformRulePayload) {
    return request<MaterialTransformRule>(`/inventory/material-transform-rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  restoreMaterialTransformRule(ruleId: string) {
    return request<MaterialTransformRule>(`/inventory/material-transform-rules/${ruleId}/restore`, {
      method: 'PATCH'
    });
  },
  disableMaterialTransformRule(ruleId: string) {
    return request<MaterialTransformRule>(`/inventory/material-transform-rules/${ruleId}`, {
      method: 'DELETE'
    });
  },
  updateInventoryMaterial(materialId: string, payload: UpdateMaterialMemoryPayload) {
    return request<MaterialMemory>(`/inventory/materials/${materialId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  restoreInventoryMaterial(materialId: string) {
    return request<MaterialMemory>(`/inventory/materials/${materialId}/restore`, {
      method: 'PATCH'
    });
  },
  disableInventoryMaterial(materialId: string) {
    return request<MaterialMemory>(`/inventory/materials/${materialId}`, {
      method: 'DELETE'
    });
  },
  inventoryMaterialSourceDetails(partCode: string, filters: InventorySourceDetailFilters = {}) {
    return request<InventorySourceDetailResponse>(
      `/inventory/materials/${encodeURIComponent(partCode)}/source-details${toQuery({
        unit: filters.unit,
        warehouseId: filters.warehouseId,
        sourceType: filters.sourceType,
        customerId: filters.customerId,
        includeTestFixtures: filters.includeTestFixtures ? 'true' : undefined,
        excludeOrderNo: filters.excludeOrderNo,
        excludeOrderId: filters.excludeOrderId,
        limit: filters.limit ? String(filters.limit) : undefined,
        offset: filters.offset !== undefined ? String(filters.offset) : undefined,
        withPage: filters.withPage ? 'true' : undefined
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
  },
  inventoryBatchReservations(batchId: string) {
    return request<InventoryReservationAudit[]>(`/inventory/batches/${batchId}/reservations`);
  }
};
