<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">生产任务</h2>
      <div class="page-actions">
        <el-button :icon="Download" :disabled="filteredTasks.length === 0" @click="exportExcel">导出 Excel</el-button>
        <el-button :icon="Printer" :disabled="filteredTasks.length === 0" @click="openPrintPreview">打印预览</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="queryTasks">刷新</el-button>
      </div>
    </div>

    <div class="filter-bar production-filter">
      <div class="filter-field">
        <label>客户</label>
        <el-select
          v-model="filters.customerId"
          clearable
          filterable
          placeholder="全部客户"
          style="width: 230px"
          @change="handleScopeChange"
        >
          <el-option v-for="item in customers" :key="item.id" :label="item.customerName" :value="item.id" />
        </el-select>
      </div>

      <div class="filter-field">
        <label>订单日期</label>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          range-separator="-"
          style="width: 260px"
          @change="handleScopeChange"
        />
      </div>

      <div class="filter-field">
        <label>订单</label>
        <el-select v-model="filters.orderNo" clearable filterable placeholder="全部订单" style="width: 250px">
          <el-option
            v-for="item in orderOptions"
            :key="item.orderNo"
            :label="`${item.orderNo} / ${item.customerName}`"
            :value="item.orderNo"
          />
        </el-select>
      </div>

      <el-button type="primary" :loading="loading" @click="queryTasks">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">待生产</div>
        <div class="stat-value">{{ counts.PENDING }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">生产中</div>
        <div class="stat-value">{{ counts.IN_PROGRESS }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">已完成</div>
        <div class="stat-value">{{ counts.COMPLETED }}</div>
      </div>
    </div>

    <el-tabs v-model="activeStatus" class="mt-16">
      <el-tab-pane label="全部" name="ALL" />
      <el-tab-pane label="待生产" name="PENDING" />
      <el-tab-pane label="生产中" name="IN_PROGRESS" />
      <el-tab-pane label="已完成" name="COMPLETED" />
    </el-tabs>

    <div class="table-card desktop-table">
      <el-table v-loading="loading" :data="filteredTasks" max-height="max(300px, calc(100vh - 430px))">
        <el-table-column prop="productionTaskNo" label="任务号" min-width="190" />
        <el-table-column label="订单号" min-width="180">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="180" />
        <el-table-column label="订单日期" width="120">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="120">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column prop="partName" label="零件" min-width="160" />
        <el-table-column label="完成 / 计划" width="150">
          <template #default="{ row }">
            {{ formatCompletedPlan(row) }}
          </template>
        </el-table-column>
        <el-table-column label="生产流程" min-width="330">
          <template #default="{ row }">
            <div class="process-chain">
              <span v-for="step in row.processSteps" :key="step" class="process-pill">{{ step }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="140">
          <template #default="{ row }">
            <StatusTag :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'PENDING'" link type="primary" @click="start(row)">开始生产</el-button>
            <el-button v-if="row.status === 'IN_PROGRESS'" link type="primary" @click="openComplete(row)">完成生产</el-button>
            <span v-if="row.status === 'COMPLETED'" class="muted">已完成</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list">
      <article v-for="task in filteredTasks" :key="task.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ task.partName }}</strong>
            <small>{{ task.productionTaskNo }}</small>
          </div>
          <StatusTag :value="task.status" />
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field mobile-full">
            <label>订单号</label>
            <span><OrderNoLink :order-no="task.orderNo" /></span>
          </div>
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ task.customerName }}</span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(task.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(task.deliveryDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>完成 / 计划</label>
            <span>{{ formatCompletedPlan(task) }}</span>
          </div>
          <div class="mobile-field mobile-full">
            <label>生产流程</label>
            <div class="process-chain">
              <span v-for="step in task.processSteps" :key="step" class="process-pill">{{ step }}</span>
            </div>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button v-if="task.status === 'PENDING'" link type="primary" @click="start(task)">开始生产</el-button>
          <el-button v-if="task.status === 'IN_PROGRESS'" link type="primary" @click="openComplete(task)">完成生产</el-button>
          <span v-if="task.status === 'COMPLETED'" class="muted">已完成</span>
        </div>
      </article>
      <div v-if="!filteredTasks.length && !loading" class="mobile-empty">暂无生产任务</div>
    </div>

    <el-dialog v-model="completeVisible" title="完成生产" width="min(420px, calc(100vw - 32px))">
      <el-form label-width="90px">
        <el-form-item label="零件">
          <strong>{{ activeTask?.partName }}</strong>
        </el-form-item>
        <el-form-item label="完成数量">
          <el-input-number
            v-model="completeForm.completedQuantity"
            :min="0.001"
            :precision="3"
            :controls="false"
            style="width: 180px"
          />
          <span class="unit-text">{{ activeTask?.unit }}</span>
        </el-form-item>
        <el-form-item label="说明">
          <span class="muted">超过计划数量的部分，仓库入库时会转为库存备货。</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="completeForm.remark" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="completeVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="complete">确认完成</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="printPreviewVisible"
      title="生产计划表打印预览"
      width="min(1220px, calc(100vw - 24px))"
      top="3vh"
    >
      <div class="print-preview-toolbar">
        <span>A4 横版，建议页边距 8mm，当前按 {{ filteredTasks.length }} 条任务预览。</span>
        <el-button type="primary" :icon="Printer" @click="printProductionPlan">打印</el-button>
      </div>
      <div class="print-preview-frame">
        <article class="production-print-page">
          <header class="production-print-header">
            <div>
              <h1>生产计划表</h1>
              <p>{{ printScopeText }}</p>
            </div>
            <div class="production-print-meta">
              <span>制表日期：{{ printDateTime }}</span>
              <span>任务数量：{{ filteredTasks.length }}</span>
            </div>
          </header>

          <table class="production-print-table">
            <colgroup>
              <col class="print-col-index" />
              <col class="print-col-task" />
              <col class="print-col-order" />
              <col class="print-col-customer" />
              <col class="print-col-date" />
              <col class="print-col-delivery" />
              <col class="print-col-part" />
              <col class="print-col-quantity" />
              <col class="print-col-process" />
              <col class="print-col-status" />
            </colgroup>
            <thead>
              <tr>
                <th>序号</th>
                <th>任务号</th>
                <th>订单号</th>
                <th>客户</th>
                <th>订单日期</th>
                <th>交期</th>
                <th>零件</th>
                <th>完成/计划</th>
                <th>生产流程</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in filteredTasks" :key="row.id">
                <td>{{ index + 1 }}</td>
                <td>{{ row.productionTaskNo }}</td>
                <td>{{ row.orderNo }}</td>
                <td>{{ row.customerName }}</td>
                <td>{{ formatDate(row.orderDate) }}</td>
                <td>{{ formatDate(row.deliveryDate) }}</td>
                <td>{{ row.partName }}</td>
                <td>{{ formatCompletedPlan(row) }}</td>
                <td>{{ formatProcessSteps(row) }}</td>
                <td>{{ productionStatusLabel(row.status) }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
      <template #footer>
        <el-button @click="printPreviewVisible = false">关闭</el-button>
        <el-button type="primary" :icon="Printer" @click="printProductionPlan">打印</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Download, Printer, Refresh } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import type { Customer, OrderSummary, ProductionStatus, ProductionTask } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';
import { downloadHtmlAsExcel, escapeHtml, formatFileDateTime, openPrintHtml } from '../utils/tableExport';

const customers = ref<Customer[]>([]);
const orderOptions = ref<OrderSummary[]>([]);
const tasks = ref<ProductionTask[]>([]);
const dateRange = ref<string[]>([]);
const loading = ref(false);
const saving = ref(false);
const completeVisible = ref(false);
const printPreviewVisible = ref(false);
const activeTask = ref<ProductionTask>();
const activeStatus = ref<ProductionStatus | 'ALL'>('ALL');
const printDateTime = ref('');

const filters = reactive<{
  customerId?: string;
  orderNo?: string;
}>({});

const completeForm = reactive({
  completedQuantity: 1,
  remark: ''
});

const counts = computed(() => ({
  PENDING: tasks.value.filter((task) => task.status === 'PENDING').length,
  IN_PROGRESS: tasks.value.filter((task) => task.status === 'IN_PROGRESS').length,
  COMPLETED: tasks.value.filter((task) => task.status === 'COMPLETED').length
}));

const filteredTasks = computed(() => {
  if (activeStatus.value === 'ALL') {
    return tasks.value;
  }
  return tasks.value.filter((task) => task.status === activeStatus.value);
});

const activeStatusLabel = computed(() => {
  if (activeStatus.value === 'ALL') {
    return '全部';
  }
  return productionStatusLabel(activeStatus.value);
});

const printScopeText = computed(() => {
  const customerName = customers.value.find((item) => item.id === filters.customerId)?.customerName || '全部客户';
  const orderNo = filters.orderNo || '全部订单';
  const dateText = dateRange.value.length === 2 ? `${dateRange.value[0]} 至 ${dateRange.value[1]}` : '全部订单日期';
  return `客户：${customerName} | 订单日期：${dateText} | 订单：${orderNo} | 状态：${activeStatusLabel.value}`;
});

function taskQueryParams() {
  return {
    customerId: filters.customerId,
    orderNo: filters.orderNo,
    dateFrom: dateRange.value[0],
    dateTo: dateRange.value[1]
  };
}

async function loadCustomers() {
  customers.value = await erpApi.customers();
}

async function loadOrderOptions() {
  orderOptions.value = await erpApi.orders({
    customerId: filters.customerId,
    dateFrom: dateRange.value[0],
    dateTo: dateRange.value[1]
  });

  if (filters.orderNo && !orderOptions.value.some((item) => item.orderNo === filters.orderNo)) {
    filters.orderNo = undefined;
  }
}

async function loadTasks() {
  // 生产任务按客户、订单日期和订单号过滤，避免任务列表混在一起难以操作。
  tasks.value = await erpApi.productionTasks(taskQueryParams());
}

async function queryTasks() {
  loading.value = true;
  try {
    await loadOrderOptions();
    await loadTasks();
  } finally {
    loading.value = false;
  }
}

async function handleScopeChange() {
  filters.orderNo = undefined;
  await loadOrderOptions();
}

async function resetFilters() {
  filters.customerId = undefined;
  filters.orderNo = undefined;
  dateRange.value = [];
  activeStatus.value = 'ALL';
  await queryTasks();
}

async function start(row: ProductionTask) {
  try {
    await erpApi.startProduction(row.id);
    ElMessage.success('已开始生产');
    await loadTasks();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '开始生产失败');
  }
}

function openComplete(row: ProductionTask) {
  activeTask.value = row;
  completeForm.completedQuantity = row.plannedQuantity;
  completeForm.remark = '';
  completeVisible.value = true;
}

async function complete() {
  if (!activeTask.value) {
    return;
  }
  saving.value = true;
  try {
    await erpApi.completeProduction(activeTask.value.id, completeForm.completedQuantity, completeForm.remark);
    ElMessage.success('生产已完成，等待仓库确认入库');
    completeVisible.value = false;
    await loadTasks();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '完成生产失败');
  } finally {
    saving.value = false;
  }
}

function productionStatusLabel(status: ProductionStatus) {
  const labels: Record<ProductionStatus, string> = {
    PENDING: '待生产',
    IN_PROGRESS: '生产中',
    COMPLETED: '已完成'
  };
  return labels[status] || status;
}

function formatProcessSteps(row: ProductionTask) {
  return row.processSteps.length > 0 ? row.processSteps.join('、') : '-';
}

function formatCompletedQuantity(row: ProductionTask) {
  // 完成数量为 0 时不显示“0 件”，只保留单位，避免生产计划表视觉噪音过多。
  if (Number(row.completedQuantity) === 0) {
    return row.unit || '-';
  }
  return formatQuantity(row.completedQuantity, row.unit);
}

function formatCompletedPlan(row: ProductionTask) {
  return `${formatCompletedQuantity(row)} / ${formatQuantity(row.plannedQuantity, row.unit)}`;
}

function refreshPrintDateTime() {
  printDateTime.value = new Date().toLocaleString('zh-CN', { hour12: false });
}

function productionPlanRows() {
  return filteredTasks.value.map((task, index) => ({
    index: index + 1,
    productionTaskNo: task.productionTaskNo,
    orderNo: task.orderNo,
    customerName: task.customerName,
    orderDate: formatDate(task.orderDate),
    deliveryDate: formatDate(task.deliveryDate),
    partName: task.partName,
    quantityText: formatCompletedPlan(task),
    processSteps: formatProcessSteps(task),
    status: productionStatusLabel(task.status)
  }));
}

function buildPrintTableHtml() {
  const rows = productionPlanRows()
    .map(
      (row) => `
        <tr>
          <td>${row.index}</td>
          <td>${escapeHtml(row.productionTaskNo)}</td>
          <td>${escapeHtml(row.orderNo)}</td>
          <td>${escapeHtml(row.customerName)}</td>
          <td>${escapeHtml(row.orderDate)}</td>
          <td>${escapeHtml(row.deliveryDate)}</td>
          <td>${escapeHtml(row.partName)}</td>
          <td>${escapeHtml(row.quantityText)}</td>
          <td>${escapeHtml(row.processSteps)}</td>
          <td>${escapeHtml(row.status)}</td>
        </tr>`
    )
    .join('');

  return `
    <table class="production-print-table">
      <colgroup>
        <col class="print-col-index" />
        <col class="print-col-task" />
        <col class="print-col-order" />
        <col class="print-col-customer" />
        <col class="print-col-date" />
        <col class="print-col-delivery" />
        <col class="print-col-part" />
        <col class="print-col-quantity" />
        <col class="print-col-process" />
        <col class="print-col-status" />
      </colgroup>
      <thead>
        <tr>
          <th>序号</th>
          <th>任务号</th>
          <th>订单号</th>
          <th>客户</th>
          <th>订单日期</th>
          <th>交期</th>
          <th>零件</th>
          <th>完成/计划</th>
          <th>生产流程</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildProductionPlanDocument() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>生产计划表</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111827;
      background: #ffffff;
      font-family: "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
      font-size: 8.5pt;
    }
    .production-print-page {
      width: 281mm;
      min-height: 194mm;
    }
    .production-print-header {
      display: flex;
      justify-content: space-between;
      gap: 8mm;
      margin-bottom: 5mm;
      border-bottom: 0.3mm solid #111827;
      padding-bottom: 3mm;
    }
    .production-print-header h1 {
      margin: 0 0 2mm;
      font-size: 16pt;
      line-height: 1.2;
    }
    .production-print-header p,
    .production-print-meta span {
      margin: 0;
      color: #374151;
      font-size: 8pt;
      line-height: 1.6;
    }
    .production-print-meta {
      min-width: 42mm;
      text-align: right;
    }
    .production-print-meta span {
      display: block;
    }
    .production-print-table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
    }
    .production-print-table th,
    .production-print-table td {
      border: 0.2mm solid #9ca3af;
      padding: 1.6mm 1.4mm;
      vertical-align: top;
      word-break: break-all;
      overflow-wrap: anywhere;
      line-height: 1.35;
    }
    .production-print-table th {
      background: #eef2f7;
      text-align: left;
      font-weight: 700;
    }
    .production-print-table thead {
      display: table-header-group;
    }
    .production-print-table tr {
      page-break-inside: avoid;
    }
    .print-col-index { width: 9mm; }
    .print-col-task { width: 37mm; }
    .print-col-order { width: 31mm; }
    .print-col-customer { width: 35mm; }
    .print-col-date { width: 19mm; }
    .print-col-delivery { width: 19mm; }
    .print-col-part { width: 27mm; }
    .print-col-quantity { width: 25mm; }
    .print-col-process { width: 61mm; }
    .print-col-status { width: 18mm; }
  </style>
</head>
<body>
  <article class="production-print-page">
    <header class="production-print-header">
      <div>
        <h1>生产计划表</h1>
        <p>${escapeHtml(printScopeText.value)}</p>
      </div>
      <div class="production-print-meta">
        <span>制表日期：${escapeHtml(printDateTime.value)}</span>
        <span>任务数量：${filteredTasks.value.length}</span>
      </div>
    </header>
    ${buildPrintTableHtml()}
  </article>
</body>
</html>`;
}

function exportExcel() {
  if (filteredTasks.value.length === 0) {
    ElMessage.warning('当前没有可导出的生产任务');
    return;
  }

  refreshPrintDateTime();
  const documentHtml = buildProductionPlanDocument();
  downloadHtmlAsExcel(documentHtml, `生产计划表_${formatFileDateTime()}.xls`);
}

function openPrintPreview() {
  if (filteredTasks.value.length === 0) {
    ElMessage.warning('当前没有可打印的生产任务');
    return;
  }
  refreshPrintDateTime();
  printPreviewVisible.value = true;
}

function printProductionPlan() {
  if (filteredTasks.value.length === 0) {
    ElMessage.warning('当前没有可打印的生产任务');
    return;
  }

  refreshPrintDateTime();
  if (!openPrintHtml(buildProductionPlanDocument())) {
    ElMessage.error('浏览器阻止了打印预览窗口，请允许弹出窗口后重试');
  }
}

onMounted(async () => {
  await loadCustomers();
  await queryTasks();
});
</script>

<style scoped>
.production-filter {
  align-items: flex-end;
}

.page-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.unit-text {
  margin-left: 8px;
  color: #64748b;
}

.print-preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  color: #64748b;
  font-size: 13px;
}

.print-preview-frame {
  max-height: calc(100vh - 230px);
  overflow: auto;
  padding: 18px;
  background: #e2e8f0;
  border-radius: 8px;
}

.production-print-page {
  width: 281mm;
  min-height: 194mm;
  margin: 0 auto;
  padding: 0;
  color: #111827;
  background: #ffffff;
  box-shadow: 0 12px 32px rgb(15 23 42 / 16%);
  font-family: "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
  font-size: 8.5pt;
}

.production-print-header {
  display: flex;
  justify-content: space-between;
  gap: 8mm;
  margin-bottom: 5mm;
  padding-bottom: 3mm;
  border-bottom: 0.3mm solid #111827;
}

.production-print-header h1 {
  margin: 0 0 2mm;
  font-size: 16pt;
  line-height: 1.2;
}

.production-print-header p,
.production-print-meta span {
  margin: 0;
  color: #374151;
  font-size: 8pt;
  line-height: 1.6;
}

.production-print-meta {
  min-width: 42mm;
  text-align: right;
}

.production-print-meta span {
  display: block;
}

.production-print-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}

.production-print-table th,
.production-print-table td {
  padding: 1.6mm 1.4mm;
  vertical-align: top;
  border: 0.2mm solid #9ca3af;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.35;
}

.production-print-table th {
  background: #eef2f7;
  text-align: left;
  font-weight: 700;
}

.print-col-index {
  width: 9mm;
}

.print-col-task {
  width: 37mm;
}

.print-col-order {
  width: 31mm;
}

.print-col-customer {
  width: 35mm;
}

.print-col-date {
  width: 19mm;
}

.print-col-delivery {
  width: 19mm;
}

.print-col-part {
  width: 27mm;
}

.print-col-quantity {
  width: 25mm;
}

.print-col-process {
  width: 61mm;
}

.print-col-status {
  width: 18mm;
}

@media (max-width: 900px) {
  .page-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .print-preview-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
}

</style>
