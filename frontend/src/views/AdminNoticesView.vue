<template>
  <section class="page admin-notices-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">通知中心</h2>
        <p class="page-subtitle">管理员全部通知只读查看，生产和仓库按 target 归类展示。</p>
      </div>
      <div class="admin-notice-header-actions">
        <el-button title="导出Excel" :icon="Download" :loading="adminNoticeExporting" @click="exportAdminNoticesExcel">导出 Excel</el-button>
        <el-button title="刷新" :loading="loading" @click="loadNotices">刷新</el-button>
      </div>
    </div>

    <div class="filter-bar admin-notice-filter">
      <div class="filter-field">
        <label>业务归类</label>
        <el-select v-model="targetFilter" placeholder="全部通知">
          <el-option label="全部通知" value="ALL" />
          <el-option label="生产通知" value="PRODUCTION" />
          <el-option label="仓库通知" value="WAREHOUSE" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>通知状态</label>
        <el-select v-model="statusFilter" placeholder="全部状态">
          <el-option label="全部状态" value="ALL" />
          <el-option label="待确认" value="PENDING" />
          <el-option label="已确认" value="ACKNOWLEDGED" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>通知类型</label>
        <el-select v-model="noticeTypeFilter" placeholder="全部类型">
          <el-option label="全部类型" value="ALL" />
          <el-option v-for="item in noticeTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect v-model="filters.customerId" placeholder="全部客户" width="220px" @change="reloadAdminNoticesFromFirstPage" />
      </div>
      <div class="filter-field">
        <label>订单号</label>
        <el-input v-model="filters.orderNo" clearable placeholder="订单号" @keyup.enter="reloadAdminNoticesFromFirstPage" />
      </div>
      <div class="filter-field">
        <label>零件编码</label>
        <el-input v-model="filters.partCode" clearable placeholder="零件编码" @keyup.enter="reloadAdminNoticesFromFirstPage" />
      </div>
      <div class="filter-field">
        <label>任务号</label>
        <el-input v-model="filters.productionTaskNo" clearable placeholder="生产任务号" @keyup.enter="reloadAdminNoticesFromFirstPage" />
      </div>
      <div class="filter-field wide">
        <label>通知时间</label>
        <DateRangeFilter v-model="dateRange" start-placeholder="通知开始" end-placeholder="通知结束" width="240px" />
      </div>
      <div class="filter-field wide">
        <label>关键字</label>
        <el-input v-model="filters.keyword" clearable placeholder="客户/原因/任务号" @keyup.enter="reloadAdminNoticesFromFirstPage" />
      </div>
      <el-button title="查询" type="primary" :loading="loading" @click="reloadAdminNoticesFromFirstPage">查询</el-button>
      <el-button title="重置" @click="resetFilters">重置</el-button>
    </div>

    <div class="notice-summary-grid">
      <div class="notice-summary-item">
        <span>全部</span>
        <strong>{{ allNoticeCount }}</strong>
      </div>
      <div class="notice-summary-item">
        <span>生产通知</span>
        <strong>{{ productionNoticeCount }}</strong>
      </div>
      <div class="notice-summary-item">
        <span>仓库通知</span>
        <strong>{{ warehouseNoticeCount }}</strong>
      </div>
      <div class="notice-summary-item">
        <span>待确认</span>
        <strong>{{ pendingNoticeCount }}</strong>
      </div>
      <div class="notice-summary-item">
        <span>已确认</span>
        <strong>{{ acknowledgedNoticeCount }}</strong>
      </div>
    </div>

    <div class="table-card desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">管理员全部通知</h3>
        <div class="panel-actions admin-notice-table-height-actions" aria-label="管理员通知表格高度">
          <span class="admin-notice-table-height-label">通知历史表格高度</span>
          <el-tooltip content="降低表格高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="Minus"
              :disabled="adminNoticeTableHeight <= adminNoticeTableHeightLimits.min"
              title="降低管理员通知表格高度"

              aria-label="降低管理员通知表格高度"
              @click="adjustAdminNoticeTableHeight(-adminNoticeTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="提高表格高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="Plus"
              :disabled="adminNoticeTableHeight >= adminNoticeTableHeightLimits.max"
              title="提高管理员通知表格高度"

              aria-label="提高管理员通知表格高度"
              @click="adjustAdminNoticeTableHeight(adminNoticeTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="恢复默认高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="RefreshLeft"
              :disabled="adminNoticeTableHeight === adminNoticeTableDefaultHeight"
              title="恢复管理员通知表格默认高度"
              aria-label="恢复管理员通知表格默认高度"
              @click="resetAdminNoticeTableHeight"
            />
          </el-tooltip>
        </div>
      </div>
      <el-table v-loading="loading" :data="notices" empty-text="暂无通知" :max-height="adminNoticeTableHeight">
        <el-table-column label="通知时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="归类" width="110">
          <template #default="{ row }">
            <el-tag :type="noticeTargetTagType(row.target)" effect="light" round>{{ noticeTargetLabel(row.target) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <StatusTag :value="row.status" :label-override="noticeStatusLabel(row.status)" compact />
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">{{ noticeTypeLabel(row.noticeType) }}</template>
        </el-table-column>
        <el-table-column label="订单号" width="150">
          <template #default="{ row }"><OrderNoLink :order-no="row.orderNo" /></template>
        </el-table-column>
        <el-table-column label="客户" min-width="160">
          <template #default="{ row }">
            <span :title="noticeCustomerTitle(row)">{{ noticeCustomerPreview(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="任务号" width="150">
          <template #default="{ row }">
            <span :title="noticeTaskNoTitle(row)">{{ noticeTaskNoPreview(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="零件" min-width="210">
          <template #default="{ row }">
            <span :title="noticePartTitle(row)">{{ noticePartPreview(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="数量变化" width="140">
          <template #default="{ row }">{{ noticeQuantityText(row) }}</template>
        </el-table-column>
        <el-table-column label="通知原因" min-width="280">
          <template #default="{ row }">
            <span :title="noticeReasonTitle(row)">{{ noticeReasonPreview(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="确认信息" min-width="180">
          <template #default="{ row }">
            <span :title="noticeAcknowledgementTitle(row)">{{ noticeAcknowledgementPreview(row) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="admin-notice-pagination">
        <span>共 {{ adminNoticePagination.totalCount }} 条，当前第 {{ adminNoticePagination.page }} 页</span>
        <el-pagination
          background
          layout="prev, pager, next, jumper"
          :current-page="adminNoticePagination.page"
          :page-size="adminNoticePagination.limit"
          :total="adminNoticePagination.totalCount"
          @current-change="handleAdminNoticePageChange"
        />
      </div>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">管理员全部通知</h3>
      <article v-for="notice in notices" :key="notice.id" class="mobile-card mobile-order-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong :title="noticeTitle(notice)">{{ noticeTitlePreview(notice) }}</strong>
            <small>{{ formatDateTime(notice.createdAt) }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <el-tag :type="noticeTargetTagType(notice.target)" effect="light" round>{{ noticeTargetLabel(notice.target) }}</el-tag>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span><StatusTag :value="notice.status" :label-override="noticeStatusLabel(notice.status)" compact /></span>
          <span>{{ noticeTypeLabel(notice.noticeType) }}</span>
          <span>{{ noticeQuantityText(notice) }}</span>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>订单号</label>
            <span><OrderNoLink :order-no="notice.orderNo" /></span>
          </div>
          <div class="mobile-field">
            <label>任务号</label>
            <span :title="noticeTaskNoTitle(notice)">{{ noticeTaskNoPreview(notice) }}</span>
          </div>
          <div class="mobile-field">
            <label>通知原因</label>
            <span :title="noticeReasonTitle(notice)">{{ noticeReasonPreview(notice) }}</span>
          </div>
          <div class="mobile-field">
            <label>确认信息</label>
            <span :title="noticeAcknowledgementTitle(notice)">{{ noticeAcknowledgementPreview(notice) }}</span>
          </div>
        </div>
      </article>
      <div v-if="!notices.length && !loading" class="mobile-empty">暂无通知</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Minus, Plus, RefreshLeft } from '@element-plus/icons-vue';
import { Download } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import type { ProductionNotice, ProductionNoticeStatus, ProductionNoticeTarget, ProductionNoticeType } from '../types/erp';
import { formatDateTime, formatQuantity } from '../utils/format';
import { formatFileDateTime } from '../utils/tableExport';

const loading = ref(false);
const adminNoticeExporting = ref(false);
const notices = ref<ProductionNotice[]>([]);
const dateRange = ref<string[]>([]);
const targetFilter = ref<'ALL' | ProductionNoticeTarget>('ALL');
const statusFilter = ref<'ALL' | ProductionNoticeStatus>('ALL');
const noticeTypeFilter = ref<'ALL' | ProductionNoticeType>('ALL');
const adminNoticeDefaultLimit = Number(20);
const adminNoticePagination = reactive({
  page: 1,
  limit: adminNoticeDefaultLimit,
  totalCount: 0
});
const adminNoticeServerCounts = reactive({
  ALL: 0,
  PRODUCTION: 0,
  WAREHOUSE: 0,
  PENDING: 0,
  ACKNOWLEDGED: 0
});

const filters = reactive({
  customerId: '',
  orderNo: '',
  partCode: '',
  productionTaskNo: '',
  keyword: ''
});

const noticeTypeOptions: Array<{ label: string; value: ProductionNoticeType }> = [
  { label: '数量增加', value: 'QUANTITY_INCREASE' },
  { label: '数量减少', value: 'QUANTITY_DECREASE' },
  { label: '订单取消', value: 'ORDER_CANCELLED' },
  { label: '新增零件', value: 'MATERIAL_ADDED' },
  { label: '管理撤回', value: 'TASK_WITHDRAWN' }
];

const allNoticeCount = computed(() => adminNoticeServerCounts.ALL);
const productionNoticeCount = computed(() => adminNoticeServerCounts.PRODUCTION);
const warehouseNoticeCount = computed(() => adminNoticeServerCounts.WAREHOUSE);
const pendingNoticeCount = computed(() => adminNoticeServerCounts.PENDING);
const acknowledgedNoticeCount = computed(() => adminNoticeServerCounts.ACKNOWLEDGED);
const adminNoticeTableHeightLimits = { min: 320, max: 900, step: 80 } as const;
const adminNoticeTableDefaultHeight = 560;
const adminNoticeTableHeightStorageKey = 'baisheng.erp.adminNoticeTableHeight.v1';
// 管理员通知表格高度只保存为本机 UI 偏好，不写入通知、订单、生产或仓库业务数据。
const adminNoticeTableHeight = ref(adminNoticeTableDefaultHeight);

function clampAdminNoticeTableHeight(value: number) {
  const normalizedHeight = Math.round(Number(value));
  if (!Number.isFinite(normalizedHeight)) {
    return adminNoticeTableDefaultHeight;
  }
  return Math.min(adminNoticeTableHeightLimits.max, Math.max(adminNoticeTableHeightLimits.min, normalizedHeight));
}

function adjustAdminNoticeTableHeight(delta: number) {
  adminNoticeTableHeight.value = clampAdminNoticeTableHeight(adminNoticeTableHeight.value + delta);
}

function resetAdminNoticeTableHeight() {
  adminNoticeTableHeight.value = adminNoticeTableDefaultHeight;
}

function restoreAdminNoticeTableHeight() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const savedHeightText = window.localStorage.getItem(adminNoticeTableHeightStorageKey);
    if (!savedHeightText) {
      return;
    }
    const savedHeight = Number(savedHeightText);
    if (Number.isFinite(savedHeight)) {
      adminNoticeTableHeight.value = clampAdminNoticeTableHeight(savedHeight);
    }
  } catch {
    // 本机 UI 偏好读取失败时使用默认高度，不影响管理员历史通知查看。
  }
}

function saveAdminNoticeTableHeight() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(adminNoticeTableHeightStorageKey, String(adminNoticeTableHeight.value));
  } catch {
    // 本机 UI 偏好写入失败不阻断管理员历史通知查询。
  }
}

restoreAdminNoticeTableHeight();

function adminNoticeRequestFilters() {
  const offset = (adminNoticePagination.page - 1) * adminNoticePagination.limit;
  return {
    ...adminNoticeBaseFilters(),
    target: targetFilter.value === 'ALL' ? undefined : targetFilter.value,
    status: statusFilter.value === 'ALL' ? undefined : statusFilter.value,
    limit: adminNoticePagination.limit,
    offset
  };
}

function adminNoticeBaseFilters() {
  return {
    noticeType: noticeTypeFilter.value === 'ALL' ? undefined : noticeTypeFilter.value,
    customerId: filters.customerId || undefined,
    orderNo: filters.orderNo,
    partCode: filters.partCode,
    productionTaskNo: filters.productionTaskNo,
    keyword: filters.keyword,
    dateFrom: dateRange.value[0],
    dateTo: dateRange.value[1]
  };
}

async function loadNotices() {
  loading.value = true;
  try {
    const baseFilters = adminNoticeBaseFilters();
    // 管理员通知中心只读拉取历史消息，确认动作仍保留在生产和仓库业务入口内。
    const [result, allCount, productionCount, warehouseCount, pendingCount, acknowledgedCount] = await Promise.all([
      erpApi.adminProductionNoticesPage(adminNoticeRequestFilters()),
      erpApi.adminProductionNoticesPage({ ...baseFilters, limit: Number(1), offset: Number(0) }),
      erpApi.adminProductionNoticesPage({ ...baseFilters, target: 'PRODUCTION', limit: Number(1), offset: Number(0) }),
      erpApi.adminProductionNoticesPage({ ...baseFilters, target: 'WAREHOUSE', limit: Number(1), offset: Number(0) }),
      erpApi.adminProductionNoticesPage({ ...baseFilters, status: 'PENDING', limit: Number(1), offset: Number(0) }),
      erpApi.adminProductionNoticesPage({ ...baseFilters, status: 'ACKNOWLEDGED', limit: Number(1), offset: Number(0) })
    ]);
    notices.value = result.items;
    adminNoticePagination.totalCount = result.totalCount;
    adminNoticePagination.limit = result.limit;
    adminNoticePagination.page = Math.floor(result.offset / result.limit) + 1;
    adminNoticeServerCounts.ALL = allCount.totalCount;
    adminNoticeServerCounts.PRODUCTION = productionCount.totalCount;
    adminNoticeServerCounts.WAREHOUSE = warehouseCount.totalCount;
    adminNoticeServerCounts.PENDING = pendingCount.totalCount;
    adminNoticeServerCounts.ACKNOWLEDGED = acknowledgedCount.totalCount;
  } catch (error) {
    notices.value = [];
    adminNoticePagination.totalCount = 0;
    adminNoticeServerCounts.ALL = 0;
    adminNoticeServerCounts.PRODUCTION = 0;
    adminNoticeServerCounts.WAREHOUSE = 0;
    adminNoticeServerCounts.PENDING = 0;
    adminNoticeServerCounts.ACKNOWLEDGED = 0;
    ElMessage.error(error instanceof Error ? error.message : '通知加载失败，请确认后端服务和筛选条件');
  } finally {
    loading.value = false;
  }
}

async function reloadAdminNoticesFromFirstPage() {
  adminNoticePagination.page = 1;
  await loadNotices();
}

async function handleAdminNoticePageChange(page: number) {
  adminNoticePagination.page = page;
  await loadNotices();
}

async function exportAdminNoticesExcel() {
  if (adminNoticeExporting.value) {
    return;
  }
  adminNoticeExporting.value = true;
  try {
    // 管理员通知导出只复用当前只读筛选条件，不确认生产或仓库通知。
    await erpApi.downloadAdminProductionNoticesExport(adminNoticeRequestFilters(), `管理员通知_${formatFileDateTime()}.xlsx`);
    ElMessage.success('管理员通知 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '管理员通知 Excel 导出失败，请确认后端服务和筛选条件');
  } finally {
    adminNoticeExporting.value = false;
  }
}

function resetFilters() {
  targetFilter.value = 'ALL';
  statusFilter.value = 'ALL';
  noticeTypeFilter.value = 'ALL';
  filters.customerId = '';
  filters.orderNo = '';
  filters.partCode = '';
  filters.productionTaskNo = '';
  filters.keyword = '';
  dateRange.value = [];
  void reloadAdminNoticesFromFirstPage();
}

function noticeTargetLabel(target: ProductionNoticeTarget) {
  return target === 'WAREHOUSE' ? '仓库通知' : '生产通知';
}

function noticeTargetTagType(target: ProductionNoticeTarget) {
  return target === 'WAREHOUSE' ? 'primary' : 'warning';
}

function noticeTypeLabel(type: ProductionNoticeType) {
  return noticeTypeOptions.find((item) => item.value === type)?.label || type;
}

function noticeStatusLabel(status: ProductionNoticeStatus) {
  return status === 'ACKNOWLEDGED' ? '已确认' : '待确认';
}

function formatLongTextPreview(value?: string | null, maxLength = 42, emptyText = '-') {
  const text = String(value || '').trim();
  if (!text) {
    return emptyText;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function noticeTitle(notice: ProductionNotice) {
  return [notice.customerName, notice.orderNo, notice.partCode, notice.partName].filter(Boolean).join(' / ') || notice.noticeNo;
}

function noticeTitlePreview(notice: ProductionNotice) {
  return formatLongTextPreview(noticeTitle(notice), 36, '-');
}

function noticeCustomerPreview(notice: ProductionNotice) {
  return formatLongTextPreview(notice.customerName, 24, '-');
}

function noticeCustomerTitle(notice: ProductionNotice) {
  return String(notice.customerName || '').trim() || '-';
}

function noticeTaskNoPreview(notice: ProductionNotice) {
  return formatLongTextPreview(notice.productionTaskNo, 22, '-');
}

function noticeTaskNoTitle(notice: ProductionNotice) {
  return String(notice.productionTaskNo || '').trim() || '-';
}

function noticePartText(notice: ProductionNotice) {
  return [notice.partCode, notice.partName].filter(Boolean).join(' / ') || '-';
}

function noticePartPreview(notice: ProductionNotice) {
  return formatLongTextPreview(noticePartText(notice), 34, '-');
}

function noticePartTitle(notice: ProductionNotice) {
  return noticePartText(notice);
}

function noticeReasonPreview(notice: ProductionNotice) {
  return formatLongTextPreview(notice.reason);
}

function noticeReasonTitle(notice: ProductionNotice) {
  return String(notice.reason || '').trim() || '-';
}

function noticeQuantityText(notice: ProductionNotice) {
  if (notice.deltaQuantity !== undefined && notice.deltaQuantity !== null) {
    const sign = Number(notice.deltaQuantity) > 0 ? '+' : '';
    return `${sign}${formatQuantity(Number(notice.deltaQuantity), notice.unit)}`;
  }
  if (notice.beforeQuantity !== undefined && notice.afterQuantity !== undefined) {
    return `${formatQuantity(Number(notice.beforeQuantity), notice.unit)} -> ${formatQuantity(Number(notice.afterQuantity), notice.unit)}`;
  }
  return '-';
}

function noticeAcknowledgementText(notice: ProductionNotice) {
  if (notice.status !== 'ACKNOWLEDGED') {
    return '-';
  }
  return [notice.acknowledgedBy || '已确认', notice.acknowledgedAt ? formatDateTime(notice.acknowledgedAt) : ''].filter(Boolean).join(' / ');
}

function noticeAcknowledgementPreview(notice: ProductionNotice) {
  return formatLongTextPreview(noticeAcknowledgementText(notice), 28, '-');
}

function noticeAcknowledgementTitle(notice: ProductionNotice) {
  return noticeAcknowledgementText(notice);
}

watch([targetFilter, statusFilter, noticeTypeFilter], () => {
  void reloadAdminNoticesFromFirstPage();
});

watch(adminNoticeTableHeight, () => {
  saveAdminNoticeTableHeight();
});

onMounted(async () => {
  await loadNotices();
});
</script>

<style scoped>
.admin-notice-filter {
  align-items: flex-end;
  margin-bottom: 16px;
}

.admin-notice-filter .wide {
  min-width: 240px;
}

.admin-notice-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.notice-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.notice-summary-item {
  padding: 14px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
}

.notice-summary-item span {
  display: block;
  color: var(--erp-muted);
  font-size: 13px;
}

.notice-summary-item strong {
  display: block;
  margin-top: 6px;
  color: var(--erp-text);
  font-size: 24px;
}

.admin-notice-table-height-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.admin-notice-table-height-label {
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

.admin-notice-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 12px;
  color: #64748b;
  font-size: 13px;
}
</style>
