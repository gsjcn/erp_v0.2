<template>
  <section class="page admin-notices-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">通知中心</h2>
        <p class="page-subtitle">管理员全部通知只读查看，生产和仓库按 target 归类展示。</p>
      </div>
      <el-button :loading="loading" @click="loadNotices">刷新</el-button>
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
        <CustomerSelect v-model="filters.customerId" placeholder="全部客户" width="220px" @change="loadNotices" />
      </div>
      <div class="filter-field">
        <label>订单号</label>
        <el-input v-model="filters.orderNo" clearable placeholder="订单号" @keyup.enter="loadNotices" />
      </div>
      <div class="filter-field">
        <label>零件编码</label>
        <el-input v-model="filters.partCode" clearable placeholder="零件编码" @keyup.enter="loadNotices" />
      </div>
      <div class="filter-field">
        <label>任务号</label>
        <el-input v-model="filters.productionTaskNo" clearable placeholder="生产任务号" @keyup.enter="loadNotices" />
      </div>
      <div class="filter-field wide">
        <label>通知时间</label>
        <DateRangeFilter v-model="dateRange" start-placeholder="通知开始" end-placeholder="通知结束" width="240px" />
      </div>
      <div class="filter-field wide">
        <label>关键字</label>
        <el-input v-model="filters.keyword" clearable placeholder="客户/原因/任务号" @keyup.enter="loadNotices" />
      </div>
      <el-button type="primary" :loading="loading" @click="loadNotices">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="notice-summary-grid">
      <div class="notice-summary-item">
        <span>全部</span>
        <strong>{{ notices.length }}</strong>
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
      </div>
      <el-table v-loading="loading" :data="notices" empty-text="暂无通知" max-height="max(320px, calc(100vh - 380px))">
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
        <el-table-column prop="customerName" label="客户" min-width="160" show-overflow-tooltip />
        <el-table-column prop="productionTaskNo" label="任务号" width="150" show-overflow-tooltip />
        <el-table-column label="零件" min-width="210" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ [row.partCode, row.partName].filter(Boolean).join(' / ') || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="数量变化" width="140">
          <template #default="{ row }">{{ noticeQuantityText(row) }}</template>
        </el-table-column>
        <el-table-column prop="reason" label="通知原因" min-width="280" show-overflow-tooltip />
        <el-table-column label="确认信息" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ noticeAcknowledgementText(row) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">管理员全部通知</h3>
      <article v-for="notice in notices" :key="notice.id" class="mobile-card mobile-order-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ noticeTitle(notice) }}</strong>
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
            <span>{{ notice.productionTaskNo || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>通知原因</label>
            <span>{{ notice.reason || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>确认信息</label>
            <span>{{ noticeAcknowledgementText(notice) }}</span>
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
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import type { ProductionNotice, ProductionNoticeStatus, ProductionNoticeTarget, ProductionNoticeType } from '../types/erp';
import { formatDateTime, formatQuantity } from '../utils/format';

const loading = ref(false);
const notices = ref<ProductionNotice[]>([]);
const dateRange = ref<string[]>([]);
const targetFilter = ref<'ALL' | ProductionNoticeTarget>('ALL');
const statusFilter = ref<'ALL' | ProductionNoticeStatus>('ALL');
const noticeTypeFilter = ref<'ALL' | ProductionNoticeType>('ALL');

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

const productionNoticeCount = computed(() => notices.value.filter((notice) => notice.target === 'PRODUCTION').length);
const warehouseNoticeCount = computed(() => notices.value.filter((notice) => notice.target === 'WAREHOUSE').length);
const pendingNoticeCount = computed(() => notices.value.filter((notice) => notice.status === 'PENDING').length);
const acknowledgedNoticeCount = computed(() => notices.value.filter((notice) => notice.status === 'ACKNOWLEDGED').length);

async function loadNotices() {
  loading.value = true;
  try {
    // 管理员通知中心只读拉取历史消息，确认动作仍保留在生产和仓库业务入口内。
    notices.value = await erpApi.adminProductionNotices({
      target: targetFilter.value === 'ALL' ? undefined : targetFilter.value,
      status: statusFilter.value === 'ALL' ? undefined : statusFilter.value,
      noticeType: noticeTypeFilter.value === 'ALL' ? undefined : noticeTypeFilter.value,
      customerId: filters.customerId || undefined,
      orderNo: filters.orderNo,
      partCode: filters.partCode,
      productionTaskNo: filters.productionTaskNo,
      keyword: filters.keyword,
      dateFrom: dateRange.value[0],
      dateTo: dateRange.value[1]
    });
  } catch (error) {
    notices.value = [];
    ElMessage.error(error instanceof Error ? error.message : '通知加载失败，请确认后端服务和筛选条件');
  } finally {
    loading.value = false;
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
  void loadNotices();
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

function noticeTitle(notice: ProductionNotice) {
  return [notice.customerName, notice.orderNo, notice.partCode, notice.partName].filter(Boolean).join(' / ') || notice.noticeNo;
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

watch([targetFilter, statusFilter, noticeTypeFilter], () => {
  void loadNotices();
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
</style>
