<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">统计表</h2>
      <el-button :loading="loading" @click="loadStatistics">刷新</el-button>
    </div>

    <div class="filter-bar statistics-filter">
      <div class="filter-field">
        <label>年份</label>
        <el-input-number v-model="year" :min="2000" :max="2100" :controls="false" style="width: 120px" />
      </div>
      <el-button type="primary" :loading="loading" @click="loadStatistics">查询</el-button>
    </div>

    <el-tabs v-model="activePeriod" class="statistics-tabs">
      <el-tab-pane label="年度统计" name="year" />
      <el-tab-pane label="季度统计" name="quarter" />
      <el-tab-pane label="月度统计" name="month" />
    </el-tabs>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">订单数</div>
        <div class="stat-value">{{ totals.orderCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">客户订单数量</div>
        <div class="stat-value">{{ formatQuantity(totals.customerOrderQuantity, defaultUnit) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">生产计划数量</div>
        <div class="stat-value">{{ formatQuantity(totals.productionPlanQuantity, defaultUnit) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">实际完成数量</div>
        <div class="stat-value">{{ formatQuantity(totals.completedProductionQuantity, defaultUnit) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">订单发货数量</div>
        <div class="stat-value">{{ formatQuantity(totals.shippedOrderQuantity, defaultUnit) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">转库存数量</div>
        <div class="stat-value">{{ formatQuantity(totals.stockQuantity, defaultUnit) }}</div>
      </div>
    </div>

    <div class="table-card desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">{{ periodTitle }}汇总</h3>
      </div>
      <el-table v-loading="loading" :data="summaryRows" max-height="max(280px, calc(50vh - 150px))">
        <el-table-column prop="periodLabel" label="统计周期" width="140" />
        <el-table-column prop="partCode" label="零件编码" width="140" />
        <el-table-column prop="partName" label="零件名称" min-width="160" />
        <el-table-column prop="orderCount" label="订单数" width="90" />
        <el-table-column label="客户订单数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.customerOrderQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="生产计划数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="实际完成数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.completedProductionQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="订单发货数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.shippedOrderQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="转库存数量" width="130">
          <template #default="{ row }">{{ formatQuantity(row.stockQuantity, row.unit) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">{{ periodTitle }}汇总</h3>
      <article v-for="row in summaryRows" :key="`${row.periodKey}-${row.partCode}`" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.partName }}</strong>
            <small>{{ row.periodLabel }} / {{ row.partCode }}</small>
          </div>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>订单数</label>
            <span>{{ row.orderCount }}</span>
          </div>
          <div class="mobile-field">
            <label>客户订单数量</label>
            <span>{{ formatQuantity(row.customerOrderQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>生产计划数量</label>
            <span>{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>实际完成数量</label>
            <span>{{ formatQuantity(row.completedProductionQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>订单发货数量</label>
            <span>{{ formatQuantity(row.shippedOrderQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>转库存数量</label>
            <span>{{ formatQuantity(row.stockQuantity, row.unit) }}</span>
          </div>
        </div>
      </article>
      <div v-if="!summaryRows.length && !loading" class="mobile-empty">暂无统计汇总</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">订单展示</h3>
      </div>
      <el-table v-loading="loading" :data="orderRows" max-height="max(280px, calc(50vh - 130px))">
        <el-table-column prop="periodLabel" label="统计周期" width="140" />
        <el-table-column label="订单号" min-width="180">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="190" />
        <el-table-column label="订单日期" width="120">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="120">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column prop="partCount" label="零件数" width="90" />
        <el-table-column label="客户订单数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.totalQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="生产计划数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.totalProductionPlanQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="订单状态" width="150">
          <template #default="{ row }">
            <StatusTag :value="row.status" />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">订单展示</h3>
      <article v-for="row in orderRows" :key="`${row.periodKey}-${row.orderNo}`" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong><OrderNoLink :order-no="row.orderNo" /></strong>
            <small>{{ row.periodLabel }} / {{ row.customerName }}</small>
          </div>
          <StatusTag :value="row.status" />
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(row.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(row.deliveryDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>零件数</label>
            <span>{{ row.partCount }} 个</span>
          </div>
          <div class="mobile-field">
            <label>客户订单数量</label>
            <span>{{ formatQuantity(row.totalQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>生产计划数量</label>
            <span>{{ formatQuantity(row.totalProductionPlanQuantity, row.unit) }}</span>
          </div>
        </div>
      </article>
      <div v-if="!orderRows.length && !loading" class="mobile-empty">暂无订单展示</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { erpApi } from '../api/erp';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import type { OrderStatisticsResponse, StatisticsPeriod } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';

const activePeriod = ref<StatisticsPeriod>('year');
const year = ref(new Date().getFullYear());
const loading = ref(false);
const statistics = ref<OrderStatisticsResponse>();

const summaryRows = computed(() => statistics.value?.summaryRows || []);
const orderRows = computed(() => statistics.value?.orderRows || []);
const defaultUnit = computed(() => summaryRows.value[0]?.unit || '件');
const periodTitle = computed(() => {
  if (activePeriod.value === 'quarter') {
    return '季度';
  }
  if (activePeriod.value === 'month') {
    return '月度';
  }
  return '年度';
});

const totals = computed(() => ({
  orderCount: orderRows.value.length,
  customerOrderQuantity: summaryRows.value.reduce((sum, row) => sum + row.customerOrderQuantity, 0),
  productionPlanQuantity: summaryRows.value.reduce((sum, row) => sum + row.productionPlanQuantity, 0),
  completedProductionQuantity: summaryRows.value.reduce((sum, row) => sum + row.completedProductionQuantity, 0),
  shippedOrderQuantity: summaryRows.value.reduce((sum, row) => sum + row.shippedOrderQuantity, 0),
  stockQuantity: summaryRows.value.reduce((sum, row) => sum + row.stockQuantity, 0)
}));

async function loadStatistics() {
  loading.value = true;
  try {
    // 统计页为只读页面，按订单日期把订单、生产、发货和转库存数量归属到年度、季度、月度。
    statistics.value = await erpApi.orderStatistics({
      period: activePeriod.value,
      year: year.value
    });
  } finally {
    loading.value = false;
  }
}

watch(activePeriod, loadStatistics);

onMounted(loadStatistics);
</script>

<style scoped>
.statistics-filter {
  margin-bottom: 12px;
}

.statistics-tabs {
  margin-bottom: 18px;
}
</style>
