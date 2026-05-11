import { apiBaseUrl, request } from './http';
import type {
  CommonStatus,
  Customer,
  InventoryBatch,
  InventoryAdjustment,
  InventoryMaterialSuggestion,
  MaterialMemory,
  InventoryReservationAudit,
  InventorySourceDetailResponse,
  InventorySummaryRow,
  InventoryStatus,
  OrderLineFulfillmentMode,
  OrderDetail,
  ProcessDefinition,
  ProcessStepDetail,
  OrderStatisticsResponse,
  OrderStatus,
  OrderProductionFilterStatus,
  OrderSummary,
  ProductionAnnualSummaryRow,
  ProductionNotice,
  ProductionNoticeStatus,
  ProductionNoticeTarget,
  ProductionOperator,
  ProductionOrderSummary,
  ProductionReplenishmentRequest,
  ProductionReplenishmentRequestStatus,
  ProcessTemplate,
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

export interface SaveProcessDefinitionPayload {
  processName: string;
  remark?: string;
  status?: CommonStatus;
}

export interface MaterialMemoryFilters {
  keyword?: string;
  status?: CommonStatus;
}

export interface UpdateMaterialMemoryPayload {
  partCode?: string;
  partName?: string;
  unit?: string;
  partSpecification?: string;
  status?: CommonStatus;
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
  dateFrom?: string;
  dateTo?: string;
  status?: OrderStatus;
  statuses?: OrderStatus[];
  productionStatuses?: OrderProductionFilterStatus[];
}

export interface InventoryFilters {
  keyword?: string;
  customerId?: string;
  warehouseId?: string;
  orderNo?: string;
  status?: InventoryStatus;
  excludeOrderNo?: string;
  excludeOrderId?: string;
}

export interface InventorySourceDetailFilters {
  unit?: string;
  warehouseId?: string;
  sourceType?: 'ALL' | 'ORDER' | 'STOCK';
  excludeOrderNo?: string;
  excludeOrderId?: string;
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

export interface ProductionReplenishmentRequestFilters {
  status?: ProductionReplenishmentRequestStatus;
  keyword?: string;
  orderNo?: string;
  productionTaskNo?: string;
  partCode?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface WarehouseWorkFilters {
  customerId?: string;
  orderNo?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface WarehouseTransactionFilters extends WarehouseWorkFilters {
  transactionType?: 'IN' | 'OUT';
}

export interface ConfirmShipmentItemPayload {
  batchId: string;
  orderLineId?: string;
  shipmentQuantity: number;
}

export interface ConfirmShipmentPayload {
  shipmentQuantity?: number;
  batchShipments?: ConfirmShipmentItemPayload[];
  warehouseConfirmedBy?: string;
  salesConfirmedBy?: string;
  overShipmentReason?: string;
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
  customerId?: string;
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

async function uploadErrorMessage(response: Response, fallback: string) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { message?: string | string[]; error?: string };
    return Array.isArray(parsed.message) ? parsed.message.join('; ') : parsed.message || parsed.error || fallback;
  } catch {
    return text || fallback;
  }
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
        status: filters.status,
        statuses: filters.statuses?.join(','),
        productionStatuses: filters.productionStatuses?.join(',')
      })}`
    );
  },
  order(orderNo: string) {
    return request<OrderDetail>(`/orders/${orderNo}`);
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
  orderImportSessions(limit = 20, offset = 0) {
    return request<OrderImportSessionListResponse>(
      `/orders/import-sessions${toQuery({ limit: String(limit), offset: String(offset) })}`
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
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '组件零件清单ERP上传模板.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  },
  async downloadOrderImportIssueReport(sessionId: string) {
    const response = await fetch(`${apiBaseUrl}/orders/import-sessions/${sessionId}/error-report`);
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response, '订单导入问题明细下载失败'));
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '订单导入问题明细.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
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
  processDefinitions(keyword?: string, status?: CommonStatus) {
    return request<ProcessDefinition[]>(`/process-definitions${toQuery({ keyword, status })}`);
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
  processTemplates(keyword?: string) {
    return request<ProcessTemplate[]>(`/process-templates${toQuery({ keyword })}`);
  },
  createProcessTemplate(payload: SaveProcessTemplatePayload) {
    return request<ProcessTemplate>('/process-templates', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateProcessTemplate(id: string, payload: Partial<SaveProcessTemplatePayload>) {
    return request<ProcessTemplate>(`/process-templates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  deleteProcessTemplate(id: string) {
    return request<{ id: string; deleted: boolean }>(`/process-templates/${id}`, { method: 'DELETE' });
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
  productionOrderSummaries(filters: ProductionTaskFilters = {}) {
    return request<ProductionOrderSummary[]>(
      `/production/tasks/order-summary${toQuery({
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
  productionReplenishmentRequests(filters: ProductionReplenishmentRequestFilters = {}) {
    return request<ProductionReplenishmentRequest[]>(
      `/production/tasks/replenishment-requests${toQuery({
        status: filters.status,
        keyword: filters.keyword?.trim() || undefined,
        orderNo: filters.orderNo?.trim() || undefined,
        productionTaskNo: filters.productionTaskNo?.trim() || undefined,
        partCode: filters.partCode?.trim() || undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo
      })}`
    );
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
        customerId: filters.customerId,
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
  confirmReceipt(productionTaskId: string, warehouseId: string, locationId: string, remark?: string) {
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
  warehouseNotices(status?: ProductionNoticeStatus) {
    return request<ProductionNotice[]>(`/warehouse/notices${toQuery({ status })}`);
  },
  acknowledgeWarehouseNotice(id: string, payload: AcknowledgeWarehouseNoticePayload | string) {
    const body = typeof payload === 'string' ? { acknowledgedBy: payload } : payload;
    return request<ProductionNotice>(`/warehouse/notices/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },
  warehouseTransactions(filters: WarehouseTransactionFilters = {}) {
    return request<WarehouseTransaction[]>(
      `/warehouse/transactions${toQuery({
        transactionType: filters.transactionType,
        customerId: filters.customerId,
        orderNo: filters.orderNo,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo
      })}`
    );
  },
  inventory(filters: InventoryFilters) {
    return request<InventoryBatch[]>(
      `/inventory${toQuery({
        keyword: filters.keyword,
        customerId: filters.customerId,
        warehouseId: filters.warehouseId,
        orderNo: filters.orderNo,
        status: filters.status,
        excludeOrderNo: filters.excludeOrderNo,
        excludeOrderId: filters.excludeOrderId
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
        excludeOrderNo: filters.excludeOrderNo,
        excludeOrderId: filters.excludeOrderId
      })}`
    );
  },
  inventoryMaterialSuggestions(
    keyword: string,
    warehouseId?: string,
    sourceType?: 'ALL' | 'ORDER' | 'STOCK',
    excludeOrderNo?: string,
    excludeOrderId?: string,
    customerId?: string
  ) {
    return request<InventoryMaterialSuggestion[]>(
      `/inventory/materials/suggestions${toQuery({
        keyword,
        customerId,
        warehouseId,
        sourceType,
        excludeOrderNo,
        excludeOrderId
      })}`
    );
  },
  inventoryMaterials(filters: MaterialMemoryFilters = {}) {
    return request<MaterialMemory[]>(
      `/inventory/materials${toQuery({
        keyword: filters.keyword,
        status: filters.status
      })}`
    );
  },
  updateInventoryMaterial(materialId: string, payload: UpdateMaterialMemoryPayload) {
    return request<MaterialMemory>(`/inventory/materials/${materialId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
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
        excludeOrderNo: filters.excludeOrderNo,
        excludeOrderId: filters.excludeOrderId
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
