<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">库存界面</h2>
      <el-button :loading="loading" @click="loadInventory">刷新</el-button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">库存批次</div>
        <div class="stat-value">{{ inventory.length }} 批</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">零件种类</div>
        <div class="stat-value">{{ inventorySummary.length }} 种</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">可用数量</div>
        <div class="stat-value">{{ availableQuantity }} 件</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">有库存仓库</div>
        <div class="stat-value">{{ stockedWarehouseCount }} 个</div>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>零件关键字 / 客户 / 订单 / 任务 / 批次</label>
        <el-autocomplete
          v-model="filters.keyword"
          :fetch-suggestions="queryMaterialSuggestions"
          value-key="value"
          placeholder="零件编码 / 名称 / 拼音 / 客户 / 订单 / 任务 / 批次"
          style="width: 330px"
          clearable
          @select="selectMaterialSuggestion"
        >
          <template #default="{ item }">
            <div class="material-suggestion">
              <div class="material-suggestion-main">
                <strong>{{ item.partCode }}</strong>
                <span>{{ item.partName }}</span>
              </div>
              <small>
                {{ selectedWarehouseName || '全部仓库' }}库存
                {{ formatQuantity(item.availableQuantity, item.unit) }}
              </small>
            </div>
          </template>
        </el-autocomplete>
      </div>
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect v-model="filters.customerId" placeholder="全部客户" width="220px" />
      </div>
      <div class="filter-field">
        <label>仓库</label>
        <el-select v-model="filters.warehouseId" clearable placeholder="全部仓库" style="width: 190px">
          <el-option v-for="item in warehouses" :key="item.id" :label="item.warehouseName" :value="item.id" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>订单号</label>
        <el-input v-model="filters.orderNo" placeholder="订单号 / 生产来源订单号" style="width: 220px" clearable />
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" clearable placeholder="全部状态" style="width: 150px">
          <el-option label="可用" value="AVAILABLE" />
          <el-option label="已使用" value="USED" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="loadInventory">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <div v-if="inventoryQueryNoticeRows.length" class="inventory-query-notice">
      <strong>当前查询库存</strong>
      <span v-for="row in inventoryQueryNoticeRows" :key="`${row.partCode}-${row.unit}`">
        {{ row.partName }}（{{ row.partCode }}）在{{ selectedWarehouseName || '全部仓库' }}当前可用库存为
        {{ formatQuantity(row.availableQuantity, row.unit) }}
      </span>
    </div>

    <div class="table-card desktop-table summary-table-card">
      <div class="section-heading">
        <strong>零件库存汇总</strong>
        <span>从库存批次实时统计，只读显示</span>
      </div>
      <el-table v-loading="loading" :data="inventorySummary" max-height="260">
        <el-table-column prop="partCode" label="零件编码" min-width="150" />
        <el-table-column prop="partName" label="零件名称" min-width="190" />
        <el-table-column label="当前可用库存" width="150">
          <template #default="{ row }">{{ formatQuantity(row.availableQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="订单库存" width="140">
          <template #default="{ row }">{{ formatQuantity(row.orderInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="备货库存" width="140">
          <template #default="{ row }">{{ formatQuantity(row.stockInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="备货来源构成" min-width="240">
          <template #default="{ row }">
            <div class="stock-source-breakdown">
              <el-tag size="small" effect="plain">正常 {{ formatQuantity(row.normalOrderStockQuantity || 0, row.unit) }}</el-tag>
              <el-tag size="small" effect="plain" type="warning">取消 {{ formatQuantity(row.cancelledOrderStockQuantity || 0, row.unit) }}</el-tag>
              <el-tag size="small" effect="plain" type="info">变更 {{ formatQuantity(row.customerChangeStockQuantity || 0, row.unit) }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="累计数量" width="130">
          <template #default="{ row }">{{ formatQuantity(row.totalQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="已出库 / 已使用" width="150">
          <template #default="{ row }">{{ formatQuantity(row.usedQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="批次 / 仓库" width="140">
          <template #default="{ row }">{{ row.batchCount }} 批 / {{ row.warehouseCount }} 个</template>
        </el-table-column>
        <el-table-column label="仓库分布" min-width="240">
          <template #default="{ row }">
            <div class="warehouse-summary">
              <el-tag
                v-for="warehouse in row.warehouses"
                :key="warehouse.warehouseId"
                effect="plain"
                size="small"
              >
                {{ warehouse.warehouseName }} {{ formatQuantity(warehouse.availableQuantity, row.unit) }}
              </el-tag>
              <span v-if="!row.warehouses.length" class="muted">无可用库存</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="来源/图纸" width="120">
          <template #default="{ row }">
            <el-button link type="primary" @click="openSourceDetails(row.partCode, row.unit, 'ALL')">查看来源</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list summary-mobile-list">
      <article v-for="row in inventorySummary" :key="`${row.partCode}-${row.partName}-${row.unit}`" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.partName }}</strong>
            <small>{{ row.partCode }}</small>
          </div>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>当前可用库存</label>
            <strong>{{ formatQuantity(row.availableQuantity, row.unit) }}</strong>
          </div>
          <div class="mobile-field">
            <label>批次 / 仓库</label>
            <span>{{ row.batchCount }} 批 / {{ row.warehouseCount }} 个</span>
          </div>
          <div class="mobile-field">
            <label>订单库存</label>
            <span>{{ formatQuantity(row.orderInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>备货库存</label>
            <span>{{ formatQuantity(row.stockInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field mobile-full">
            <label>备货来源构成</label>
            <span>{{ stockSourceBreakdownText(row) }}</span>
          </div>
          <div class="mobile-field">
            <label>累计数量</label>
            <span>{{ formatQuantity(row.totalQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>已出库 / 已使用</label>
            <span>{{ formatQuantity(row.usedQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field mobile-full">
            <label>仓库分布</label>
            <span>{{ warehouseSummaryText(row) }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button link type="primary" @click="openSourceDetails(row.partCode, row.unit, 'ALL')">来源/图纸</el-button>
        </div>
      </article>
    </div>

    <div class="table-card desktop-table">
      <el-table v-loading="loading" :data="inventory" max-height="max(300px, calc(100vh - 390px))">
        <el-table-column label="批次号" min-width="230">
          <template #default="{ row }">
            <div class="cell-main">{{ row.batchNo }}</div>
            <el-tag class="source-tag" :type="inventorySourceTagType(row)" size="small" effect="plain">
              {{ inventorySourceLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="partCode" label="零件编码" width="140" />
        <el-table-column prop="partName" label="零件名称" min-width="180" />
        <el-table-column label="图纸" min-width="190">
          <template #default="{ row }">
            <div class="cell-main">{{ drawingInfoText(row) }}</div>
            <DrawingPreviewLink
              :file-name="row.drawingFileName"
              :file-url="row.drawingFileUrl"
              link-text="打开图纸"
              :title="`${row.partName || row.partCode} 库存图纸`"
            />
          </template>
        </el-table-column>
        <el-table-column label="当前剩余" width="120">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="170">
          <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column label="客户" min-width="180">
          <template #default="{ row }">{{ customerDisplay(row) }}</template>
        </el-table-column>
        <el-table-column label="来源订单" min-width="180">
          <template #default="{ row }">
            <OrderNoLink v-if="inventorySourceOrderNo(row)" :order-no="inventorySourceOrderNo(row)" />
            <span v-else class="muted">备货库存</span>
            <div v-if="row.inventorySourceType === 'STOCK' && inventorySourceOrderNo(row)" class="cell-subtext">生产来源订单</div>
          </template>
        </el-table-column>
        <el-table-column label="生产任务" min-width="220">
          <template #default="{ row }">
            <div class="cell-main">{{ row.sourceProductionTaskNo || '-' }}</div>
            <div v-if="taskRelationText(row)" class="cell-subtext">{{ taskRelationText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="订单日期" width="120">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="120">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <StatusTag :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openSourceDetails(row.partCode, row.unit, 'ALL')">
              来源
            </el-button>
            <el-button link type="primary" :disabled="!canAdjustBatch(row)" @click="openAdjustDialog(row)">
              盘点调整
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list">
      <article v-for="batch in inventory" :key="batch.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ batch.partName }}</strong>
            <small>{{ batch.batchNo }}</small>
          </div>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>状态</label>
            <span><StatusTag :value="batch.status" /></span>
          </div>
          <div class="mobile-field">
            <label>来源类型</label>
            <span>
              <el-tag :type="inventorySourceTagType(batch)" size="small" effect="plain">
                {{ inventorySourceLabel(batch) }}
              </el-tag>
            </span>
          </div>
          <div class="mobile-field">
            <label>零件编码</label>
            <span>{{ batch.partCode }}</span>
          </div>
          <div class="mobile-field">
            <label>当前剩余</label>
            <span>{{ formatQuantity(batch.quantity, batch.unit) }}</span>
          </div>
          <div class="mobile-field mobile-full">
            <label>仓库 / 库位</label>
            <span>{{ batch.warehouseName }} / {{ batch.locationName || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ customerDisplay(batch) }}</span>
          </div>
          <div class="mobile-field">
            <label>来源订单</label>
            <span>
              <OrderNoLink v-if="inventorySourceOrderNo(batch)" :order-no="inventorySourceOrderNo(batch)" />
              <span v-else class="muted">备货库存</span>
              <small v-if="batch.inventorySourceType === 'STOCK' && inventorySourceOrderNo(batch)" class="mobile-subtext">生产来源订单</small>
            </span>
          </div>
          <div class="mobile-field mobile-full">
            <label>图纸</label>
            <span>
              {{ drawingInfoText(batch) }}
              <DrawingPreviewLink
                :file-name="batch.drawingFileName"
                :file-url="batch.drawingFileUrl"
                link-text="打开图纸"
                :title="`${batch.partName || batch.partCode} 库存图纸`"
              />
            </span>
          </div>
          <div class="mobile-field mobile-full">
            <label>生产任务</label>
            <span>
              {{ batch.sourceProductionTaskNo || '-' }}
              <small v-if="taskRelationText(batch)" class="mobile-subtext">{{ taskRelationText(batch) }}</small>
            </span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(batch.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(batch.deliveryDate) }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button size="small" type="primary" plain @click="openSourceDetails(batch.partCode, batch.unit, 'ALL')">
            来源/图纸
          </el-button>
          <el-button size="small" type="primary" plain :disabled="!canAdjustBatch(batch)" @click="openAdjustDialog(batch)">
            盘点调整
          </el-button>
        </div>
      </article>
      <div v-if="!inventory.length && !loading" class="mobile-empty">暂无库存</div>
    </div>

    <InventorySourceDetailsDialog
      v-model="sourceDetailsVisible"
      :loading="sourceDetailsLoading"
      :detail="sourceDetails"
    />

    <el-dialog v-model="adjustDialogVisible" title="库存盘点调整" width="640px" class="responsive-dialog">
      <div v-if="selectedBatch" class="adjustment-summary">
        <strong>{{ selectedBatch.partName }}</strong>
        <span>{{ selectedBatch.partCode }} / {{ selectedBatch.batchNo }}</span>
        <span>{{ selectedBatch.warehouseName }} / {{ selectedBatch.locationName || '-' }}</span>
      </div>
      <el-form class="adjustment-form" label-width="110px">
        <el-form-item label="当前剩余">
          <span class="readonly-value">{{ selectedBatch ? formatQuantity(selectedBatch.quantity, selectedBatch.unit) : '-' }}</span>
        </el-form-item>
        <el-form-item label="盘点后数量" required>
          <el-input-number
            v-model="adjustForm.afterQuantity"
            :min="0"
            :precision="3"
            :step="1"
            controls-position="right"
            style="width: 220px"
          />
          <span v-if="selectedBatch" class="adjustment-delta">
            差异：{{ formatSignedQuantity(adjustmentDelta, selectedBatch.unit) }}
          </span>
        </el-form-item>
        <el-form-item label="清点人" required>
          <el-input v-model="adjustForm.countedBy" placeholder="库存清点人员" />
        </el-form-item>
        <el-form-item label="清点时间">
          <el-date-picker
            v-model="adjustForm.countedAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="默认当前时间"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="签字人" required>
          <el-input v-model="adjustForm.signatureName" placeholder="确认签字人" />
        </el-form-item>
        <el-form-item label="盘点工单" required>
          <input
            ref="adjustmentFileInput"
            class="adjustment-file-input"
            type="file"
            accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff"
            @change="onAdjustmentFileChange"
          />
          <div class="adjustment-hint">必须上传盘点工单、现场照片或 PDF；支持 PNG、JPG、WEBP、BMP、GIF、TIF 等格式。</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="adjustForm.remark" type="textarea" :rows="3" placeholder="库存差异原因，可选" />
        </el-form-item>
      </el-form>
      <div class="adjustment-history">
        <div class="section-heading compact-heading">
          <strong>最近盘点记录</strong>
          <span>按时间倒序显示全部记录</span>
        </div>
        <el-table v-loading="adjustmentHistoryLoading" :data="adjustmentHistory" max-height="180" size="small">
          <el-table-column prop="adjustmentNo" label="盘点号" min-width="170" />
          <el-table-column label="数量变化" min-width="130">
            <template #default="{ row }">
              {{ formatQuantity(row.beforeQuantity, row.unit) }} -> {{ formatQuantity(row.afterQuantity, row.unit) }}
            </template>
          </el-table-column>
          <el-table-column label="清点人 / 签字" min-width="130">
            <template #default="{ row }">{{ row.countedBy }} / {{ row.signatureName }}</template>
          </el-table-column>
          <el-table-column label="清点时间" min-width="155">
            <template #default="{ row }">{{ formatDateTime(row.countedAt) }}</template>
          </el-table-column>
          <el-table-column label="附件" width="90">
            <template #default="{ row }">
              <a v-if="row.attachmentFileUrl" :href="row.attachmentFileUrl" target="_blank" rel="noreferrer">查看</a>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="adjustDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="adjustSaving" @click="submitAdjustment">保存盘点</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DrawingPreviewLink from '../components/DrawingPreviewLink.vue';
import InventorySourceDetailsDialog from '../components/InventorySourceDetailsDialog.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import type {
  InventoryAdjustment,
  InventoryBatch,
  InventoryMaterialSuggestion,
  InventorySourceDetailResponse,
  InventoryStatus,
  InventorySummaryRow,
  Warehouse
} from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';

const warehouses = ref<Warehouse[]>([]);
const inventory = ref<InventoryBatch[]>([]);
const inventorySummary = ref<InventorySummaryRow[]>([]);
const loading = ref(false);
const adjustDialogVisible = ref(false);
const adjustSaving = ref(false);
const selectedBatch = ref<InventoryBatch>();
const sourceDetailsVisible = ref(false);
const sourceDetailsLoading = ref(false);
const sourceDetails = ref<InventorySourceDetailResponse | null>(null);
const materialSuggestionRequestSeq = ref(0);
const adjustmentFileInput = ref<HTMLInputElement>();
const adjustmentFile = ref<File | null>(null);
const adjustmentHistory = ref<InventoryAdjustment[]>([]);
const adjustmentHistoryLoading = ref(false);
const adjustForm = reactive({
  afterQuantity: 0,
  countedBy: '',
  countedAt: '',
  signatureName: '',
  remark: ''
});
const allowedAdjustmentFileExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'];
const allowedAdjustmentMimeTypes = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/gif',
  'image/tiff'
];
const genericAdjustmentMimeTypes = ['', 'application/octet-stream'];
const filters = reactive<{
  keyword?: string;
  customerId?: string;
  warehouseId?: string;
  orderNo?: string;
  status?: InventoryStatus;
}>({});

const availableQuantity = computed(() =>
  inventory.value
    .filter((item) => item.status === 'AVAILABLE' && item.quantity > 0)
    .reduce((sum, item) => sum + item.quantity, 0)
);
const stockedWarehouseCount = computed(
  () => new Set(inventory.value.filter((item) => item.status === 'AVAILABLE' && item.quantity > 0).map((item) => item.warehouseId)).size
);
const adjustmentDelta = computed(() => (selectedBatch.value ? adjustForm.afterQuantity - selectedBatch.value.quantity : 0));
const selectedWarehouseName = computed(() => warehouses.value.find((item) => item.id === filters.warehouseId)?.warehouseName);
const inventoryQueryNoticeRows = computed(() => {
  if (!filters.keyword?.trim()) {
    return [];
  }
  // 关键字命中物料但库存为 0 时，要明确告诉仓库人员当前查询范围没有可用库存。
  return inventorySummary.value.filter((row) => row.availableQuantity <= 0);
});

async function loadWarehouses() {
  try {
    warehouses.value = await erpApi.warehouses();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '仓库列表加载失败');
  }
}

async function loadInventory() {
  loading.value = true;
  try {
    const [summaryRows, inventoryRows] = await Promise.all([erpApi.inventorySummary(filters), erpApi.inventory(filters)]);
    inventorySummary.value = summaryRows;
    inventory.value = inventoryRows;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '库存数据加载失败');
  } finally {
    loading.value = false;
  }
}

function reset() {
  filters.keyword = undefined;
  filters.customerId = undefined;
  filters.warehouseId = undefined;
  filters.orderNo = undefined;
  filters.status = undefined;
  void loadInventory();
}

async function queryMaterialSuggestions(keyword: string, callback: (items: InventoryMaterialSuggestion[]) => void) {
  const normalizedKeyword = keyword.trim();
  const requestId = ++materialSuggestionRequestSeq.value;
  callback([]);
  try {
    const result = await erpApi.inventoryMaterialSuggestions(normalizedKeyword, filters.warehouseId);
    if (requestId === materialSuggestionRequestSeq.value) {
      callback(result);
    }
  } catch {
    if (requestId === materialSuggestionRequestSeq.value) {
      callback([]);
    }
  }
}

function selectMaterialSuggestion(item: InventoryMaterialSuggestion) {
  filters.keyword = item.partCode;
  void loadInventory();
}

function inventorySourceLabel(row: InventoryBatch) {
  if (row.inventorySourceType === 'ORDER') {
    return '订单库存';
  }
  return sourceKindLabel(row.sourceKind);
}

function inventorySourceTagType(row: InventoryBatch) {
  if (row.inventorySourceType === 'ORDER') {
    return 'success';
  }
  return row.sourceKind === 'CANCELLED_ORDER' ? 'danger' : row.sourceKind === 'CUSTOMER_CHANGE' ? 'warning' : 'info';
}

function sourceKindLabel(kind?: string) {
  const map: Record<string, string> = {
    NORMAL_ORDER: '正常订单备货',
    CANCELLED_ORDER: '取消订单转库存',
    CUSTOMER_CHANGE: '客户变更转库存'
  };
  return map[kind || 'NORMAL_ORDER'] || kind || '正常订单备货';
}

function stockSourceBreakdownText(row: InventorySummaryRow) {
  return [
    `正常 ${formatQuantity(row.normalOrderStockQuantity || 0, row.unit)}`,
    `取消 ${formatQuantity(row.cancelledOrderStockQuantity || 0, row.unit)}`,
    `变更 ${formatQuantity(row.customerChangeStockQuantity || 0, row.unit)}`
  ].join(' / ');
}

function customerDisplay(row: InventoryBatch) {
  return row.sourceCustomerName || (row.inventorySourceType === 'STOCK' ? '备货库存' : '-');
}

function inventorySourceOrderNo(row: InventoryBatch) {
  return row.productionSourceOrderNo || row.sourceOrderNo || '';
}

function drawingInfoText(row: InventoryBatch) {
  const drawingNo = row.drawingNo || '未记录图号';
  const version = row.drawingVersion ? ` / ${row.drawingVersion}` : '';
  return `${drawingNo}${version}`;
}

function taskRelationText(row: InventoryBatch) {
  if (row.replenishmentSourceLabel) {
    return row.sourceProductionTaskNo ? `${row.replenishmentSourceLabel} / 源任务 ${row.sourceProductionTaskNo}` : row.replenishmentSourceLabel;
  }
  if (row.replenishmentSourceType) {
    const label = row.replenishmentSourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单';
    return row.replenishmentSourceRequestNo ? `${label}：${row.replenishmentSourceRequestNo}` : label;
  }
  if (row.isReplenishment && row.sourceReplenishmentTaskNo) {
    return `补单来源：${row.sourceReplenishmentTaskNo}`;
  }
  if (row.isReplenishment) {
    return '补单任务';
  }
  return '';
}

function warehouseSummaryText(row: InventorySummaryRow) {
  if (!row.warehouses.length) {
    return '无可用库存';
  }
  return row.warehouses
    .map((warehouse) => `${warehouse.warehouseName} ${formatQuantity(warehouse.availableQuantity, row.unit)}`)
    .join('，');
}

function canAdjustBatch(row: InventoryBatch) {
  return Boolean(row.canAdjust);
}

async function openSourceDetails(partCode: string, unit?: string, sourceType: 'ALL' | 'ORDER' | 'STOCK' = 'ALL') {
  if (!partCode?.trim()) {
    ElMessage.warning('请先选择零件');
    return;
  }
  sourceDetailsVisible.value = true;
  sourceDetailsLoading.value = true;
  sourceDetails.value = null;
  try {
    sourceDetails.value = await erpApi.inventoryMaterialSourceDetails(partCode.trim(), {
      unit,
      warehouseId: filters.warehouseId,
      sourceType
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '库存来源查询失败');
  } finally {
    sourceDetailsLoading.value = false;
  }
}

function currentDateTimeValue() {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 19);
}

function openAdjustDialog(row: InventoryBatch) {
  selectedBatch.value = row;
  adjustForm.afterQuantity = row.quantity;
  adjustForm.countedBy = '';
  adjustForm.countedAt = currentDateTimeValue();
  adjustForm.signatureName = '';
  adjustForm.remark = '';
  adjustmentFile.value = null;
  if (adjustmentFileInput.value) {
    adjustmentFileInput.value.value = '';
  }
  adjustmentHistory.value = [];
  adjustDialogVisible.value = true;
  void loadAdjustmentHistory(row.id);
}

function onAdjustmentFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] || null;
  if (!file) {
    adjustmentFile.value = null;
    return;
  }
  if (!isAllowedAdjustmentFile(file)) {
    ElMessage.warning('盘点附件只支持 PDF 或常用图片格式');
    input.value = '';
    adjustmentFile.value = null;
    return;
  }
  adjustmentFile.value = file;
}

function isAllowedAdjustmentFile(file: File) {
  const fileName = file.name.toLowerCase();
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  return (
    allowedAdjustmentFileExtensions.includes(extension) &&
    (genericAdjustmentMimeTypes.includes(file.type) || allowedAdjustmentMimeTypes.includes(file.type))
  );
}

function formatSignedQuantity(value: number, unit: string) {
  if (value === 0) {
    return `0 ${unit}`;
  }
  const prefix = value > 0 ? '+' : '-';
  return `${prefix}${formatQuantity(Math.abs(value), unit)}`;
}

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

async function loadAdjustmentHistory(batchId: string) {
  adjustmentHistoryLoading.value = true;
  try {
    adjustmentHistory.value = await erpApi.inventoryBatchAdjustments(batchId);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '盘点记录加载失败');
  } finally {
    adjustmentHistoryLoading.value = false;
  }
}

async function submitAdjustment() {
  if (!selectedBatch.value) {
    return;
  }
  if (!adjustForm.countedBy.trim()) {
    ElMessage.warning('请填写清点人');
    return;
  }
  if (!adjustForm.signatureName.trim()) {
    ElMessage.warning('请填写签字人');
    return;
  }
  if (!adjustmentFile.value) {
    ElMessage.warning('请上传盘点工单、照片或 PDF 附件');
    return;
  }

  adjustSaving.value = true;
  try {
    const attachment = await erpApi.uploadInventoryAdjustmentFile(adjustmentFile.value);

    await erpApi.adjustInventoryBatch(selectedBatch.value.id, {
      afterQuantity: Number(adjustForm.afterQuantity),
      countedBy: adjustForm.countedBy.trim(),
      countedAt: adjustForm.countedAt || undefined,
      signatureName: adjustForm.signatureName.trim(),
      attachmentFileName: attachment?.fileName,
      attachmentFileUrl: attachment?.fileUrl,
      attachmentMimeType: attachment?.mimeType,
      attachmentSize: attachment?.size,
      remark: adjustForm.remark.trim() || undefined
    });

    ElMessage.success('盘点调整已保存');
    adjustDialogVisible.value = false;
    await loadInventory();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '盘点调整保存失败');
  } finally {
    adjustSaving.value = false;
  }
}

onMounted(async () => {
  await loadWarehouses();
  await loadInventory();
});
</script>

<style scoped>
.cell-main {
  color: #0f172a;
  font-weight: 600;
  line-height: 20px;
}

.cell-subtext {
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.source-tag {
  margin-top: 5px;
}

.summary-table-card {
  margin-bottom: 18px;
}

.inventory-query-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  color: #1e3a8a;
  font-size: 13px;
  line-height: 20px;
}

.inventory-query-notice strong {
  color: #0f172a;
}

.inventory-query-notice span {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  background: #ffffff;
  color: #1e40af;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid #edf2f7;
}

.section-heading strong {
  color: #0f172a;
  font-size: 15px;
  line-height: 22px;
}

.section-heading span {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.warehouse-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.stock-source-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.material-suggestion {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 0;
  line-height: 18px;
}

.material-suggestion-main {
  display: flex;
  gap: 8px;
  align-items: center;
}

.material-suggestion-main strong {
  color: #0f172a;
  font-size: 13px;
}

.material-suggestion-main span {
  color: #334155;
  font-size: 13px;
}

.material-suggestion small {
  color: #64748b;
  font-size: 12px;
}

.summary-mobile-list {
  margin-bottom: 14px;
}

.mobile-subtext {
  display: block;
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.adjustment-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 18px;
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  color: #475569;
  font-size: 13px;
  line-height: 20px;
}

.adjustment-summary strong {
  color: #0f172a;
}

.readonly-value {
  color: #0f172a;
  font-weight: 600;
}

.adjustment-delta {
  margin-left: 12px;
  color: #64748b;
  font-size: 13px;
}

.adjustment-file-input {
  width: 100%;
  max-width: 420px;
  color: #475569;
}

.adjustment-hint {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.adjustment-history {
  margin-top: 18px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.compact-heading {
  padding: 10px 12px;
  background: #f8fafc;
}

.mobile-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}

.mobile-card-actions .el-button {
  margin-left: 0;
}

@media (max-width: 768px) {
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .inventory-query-notice {
    align-items: flex-start;
    flex-direction: column;
  }

  .inventory-query-notice span {
    width: 100%;
  }

  .adjustment-form :deep(.el-form-item) {
    display: block;
  }

  .adjustment-form :deep(.el-form-item__label) {
    justify-content: flex-start;
    width: auto !important;
    margin-bottom: 6px;
  }

  .adjustment-form :deep(.el-form-item__content) {
    margin-left: 0 !important;
  }

  .adjustment-delta {
    display: block;
    margin: 8px 0 0;
  }

  .mobile-card-actions {
    justify-content: flex-start;
  }

  .mobile-card-actions .el-button {
    flex: 1 1 128px;
  }
}
</style>
