<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">每个零件的生产流程选择</h2>
      <div class="process-actions">
        <el-button :disabled="!order" @click="goOrderDetail">返回订单明细</el-button>
        <el-button :disabled="!selectedLine" :loading="saving" @click="saveAndNext">保存并下一个</el-button>
        <el-button type="primary" :disabled="!selectedLine" :loading="saving" @click="saveProcess">保存流程</el-button>
        <el-button type="success" :disabled="!canSubmitOrder" :loading="submitting" @click="submitOrderFromProcess">
          提交生产
        </el-button>
      </div>
    </div>

    <div class="filter-bar process-filter">
      <div class="filter-field">
        <label>客户</label>
        <el-select
          v-model="selectedCustomerId"
          filterable
          clearable
          placeholder="先选择客户"
          style="width: 260px"
          @change="handleCustomerChange"
        >
          <el-option v-for="item in customers" :key="item.id" :label="item.customerName" :value="item.id" />
        </el-select>
      </div>

      <div class="filter-field">
        <label>订单日期</label>
        <el-date-picker
          v-model="orderDateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          range-separator="-"
          style="width: 260px"
          :disabled="!selectedCustomerId"
          @change="handleDateChange"
        />
      </div>

      <el-button type="primary" :disabled="!selectedCustomerId" :loading="ordersLoading" @click="loadOrders">
        查询订单
      </el-button>

      <div class="filter-field">
        <label>订单</label>
        <el-select
          v-model="selectedOrderNo"
          filterable
          clearable
          placeholder="再选择订单"
          style="width: 320px"
          :disabled="!selectedCustomerId || orders.length === 0"
          @change="handleOrderChange"
        >
          <el-option
            v-for="item in orders"
            :key="item.orderNo"
            :label="`${item.orderNo} / ${formatDate(item.orderDate)}`"
            :value="item.orderNo"
          />
        </el-select>
      </div>
    </div>

    <el-empty v-if="!selectedCustomerId" description="请先选择客户" />
    <el-empty v-else-if="!selectedOrderNo" description="请选择订单" />

    <div v-else-if="order" v-loading="loading" class="process-layout">
      <div class="panel parts-panel">
        <div class="process-summary">
          <div>
            <span class="summary-label">客户</span>
            <strong>{{ order.customerName }}</strong>
          </div>
          <div>
            <span class="summary-label">订单状态</span>
            <StatusTag :value="order.status" />
          </div>
          <div>
            <span class="summary-label">流程进度</span>
            <el-progress :percentage="processPercent" :stroke-width="8" />
          </div>
          <p v-if="missingLineNames.length" class="missing-text">未配置：{{ missingLineNames.join('、') }}</p>
          <p v-else class="ready-text">全部零件已配置流程</p>
        </div>

        <div class="panel-header">
          <h3 class="panel-title">订单零件</h3>
          <span class="muted">{{ order.orderNo }}</span>
        </div>
        <button
          v-for="line in order.lines"
          :key="line.id"
          class="part-item"
          :class="{ active: line.id === selectedLineId }"
          @click="selectLine(line.id)"
        >
          <span>
            <strong>{{ line.partName }}</strong>
            <small>{{ line.partCode }} / 订单 {{ formatQuantity(line.quantity, line.unit) }}</small>
            <small>生产计划 {{ formatQuantity(line.productionPlanQuantity, line.unit) }}</small>
          </span>
          <em>{{ line.processSteps.length ? `${line.processSteps.length} 道` : '未选择' }}</em>
        </button>
      </div>

      <div class="panel builder-panel">
        <div class="panel-header">
          <h3 class="panel-title">{{ selectedLine?.partName || '-' }} / 生产步骤</h3>
          <span v-if="isDirty" class="dirty-text">未保存</span>
        </div>

        <div class="process-templates">
          <span>常用流程</span>
          <el-button v-for="template in processTemplates" :key="template.name" size="small" @click="applyTemplate(template.steps)">
            {{ template.name }}
          </el-button>
        </div>

        <div class="available-processes">
          <el-button v-for="process in processOptions" :key="process" round @click="addStep(process)">
            {{ process }}
          </el-button>
        </div>

        <div class="custom-process">
          <el-input
            v-model="customProcessName"
            placeholder="输入自定义工艺"
            clearable
            style="max-width: 320px"
            @keyup.enter="addCustomStep"
          />
          <el-button type="primary" plain @click="addCustomStep">添加工艺</el-button>
        </div>

        <h4>已选流程</h4>
        <div class="selected-steps">
          <div v-for="(step, index) in draftSteps" :key="`${index}-${step}`" class="selected-step">
            <span class="step-index">{{ index + 1 }}</span>
            <el-input v-model="draftSteps[index]" placeholder="工艺名称" />
            <div class="step-actions">
              <el-button link :disabled="index === 0" @click="moveStep(index, -1)">上移</el-button>
              <el-button link :disabled="index === draftSteps.length - 1" @click="moveStep(index, 1)">下移</el-button>
              <el-button link type="danger" @click="removeStep(index)">删除</el-button>
            </div>
          </div>
          <el-empty v-if="draftSteps.length === 0" description="当前零件未选择生产流程" />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import { erpApi } from '../api/erp';
import StatusTag from '../components/StatusTag.vue';
import type { Customer, OrderDetail, OrderLine, OrderSummary } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';

const route = useRoute();
const router = useRouter();
const customers = ref<Customer[]>([]);
const orders = ref<OrderSummary[]>([]);
const order = ref<OrderDetail>();
const selectedCustomerId = ref('');
const selectedOrderNo = ref('');
const selectedLineId = ref('');
const orderDateRange = ref<string[]>([]);
const lastDateRange = ref<string[]>([]);
const draftSteps = ref<string[]>([]);
const customProcessName = ref('');
const loading = ref(false);
const ordersLoading = ref(false);
const saving = ref(false);
const submitting = ref(false);
const restoringSelection = ref(false);

const processOptions = ['激光切割', '折弯', '冲压', '焊接', '打磨', '喷涂', '装配', '包装'];
const processTemplates = [
  { name: '激光折弯包装', steps: ['激光切割', '折弯', '包装'] },
  { name: '焊接件', steps: ['激光切割', '折弯', '焊接', '打磨', '包装'] },
  { name: '冲压装配件', steps: ['冲压', '打磨', '装配', '包装'] },
  { name: '喷涂件', steps: ['激光切割', '折弯', '喷涂', '包装'] }
];

const selectedLine = computed<OrderLine | undefined>(() => order.value?.lines.find((line) => line.id === selectedLineId.value));
const savedSteps = computed(() => selectedLine.value?.processSteps || []);
const isDirty = computed(() => JSON.stringify(normalizeSteps(draftSteps.value)) !== JSON.stringify(savedSteps.value));
const totalLineCount = computed(() => order.value?.lines.length || 0);
const configuredLineCount = computed(() => order.value?.lines.filter((line) => line.processSteps.length > 0).length || 0);
const processPercent = computed(() =>
  totalLineCount.value ? Math.round((configuredLineCount.value / totalLineCount.value) * 100) : 0
);
const missingLineNames = computed(() => order.value?.lines.filter((line) => line.processSteps.length === 0).map((line) => line.partName) || []);
const canSubmitOrder = computed(
  () => order.value?.status === 'DRAFT' && totalLineCount.value > 0 && missingLineNames.value.length === 0 && !isDirty.value
);

async function loadCustomers() {
  customers.value = await erpApi.customers();
}

async function loadOrders() {
  if (!selectedCustomerId.value) {
    resetOrderSelection();
    return;
  }

  ordersLoading.value = true;
  try {
    // 生产流程页必须先按客户和可选订单日期筛订单，避免直接展示无关订单零件。
    orders.value = await erpApi.orders({
      customerId: selectedCustomerId.value,
      dateFrom: orderDateRange.value[0],
      dateTo: orderDateRange.value[1]
    });

    if (!orders.value.some((item) => item.orderNo === selectedOrderNo.value)) {
      resetOrderSelection();
    }
    lastDateRange.value = [...orderDateRange.value];
  } finally {
    ordersLoading.value = false;
  }
}

async function loadOrder() {
  if (!selectedOrderNo.value) {
    order.value = undefined;
    selectedLineId.value = '';
    draftSteps.value = [];
    return;
  }

  loading.value = true;
  try {
    order.value = await erpApi.order(selectedOrderNo.value);
    applySelectedLine(order.value.lines[0]?.id || '');
  } finally {
    loading.value = false;
  }
}

async function handleCustomerChange() {
  if (restoringSelection.value) {
    return;
  }
  if (!(await confirmDiscardChanges())) {
    restoringSelection.value = true;
    selectedCustomerId.value = order.value?.customerId || '';
    restoringSelection.value = false;
    return;
  }
  selectedOrderNo.value = '';
  resetOrderSelection();
  await loadOrders();
}

async function handleDateChange() {
  if (restoringSelection.value) {
    return;
  }
  if (!(await confirmDiscardChanges())) {
    restoringSelection.value = true;
    orderDateRange.value = [...lastDateRange.value];
    restoringSelection.value = false;
    return;
  }
  selectedOrderNo.value = '';
  resetOrderSelection();
  await loadOrders();
}

async function handleOrderChange() {
  if (restoringSelection.value) {
    return;
  }
  if (!(await confirmDiscardChanges())) {
    restoringSelection.value = true;
    selectedOrderNo.value = order.value?.orderNo || '';
    restoringSelection.value = false;
    return;
  }
  await loadOrder();
}

function resetOrderSelection() {
  order.value = undefined;
  selectedLineId.value = '';
  draftSteps.value = [];
}

async function selectLine(lineId: string) {
  if (lineId === selectedLineId.value) {
    return;
  }

  if (selectedLineId.value && !(await confirmDiscardChanges())) {
    return;
  }

  applySelectedLine(lineId);
}

async function confirmDiscardChanges() {
  if (!isDirty.value) {
    return true;
  }

  try {
    await ElMessageBox.confirm('当前流程未保存，切换后会丢失修改。', '切换流程', {
      confirmButtonText: '继续切换',
      cancelButtonText: '取消',
      type: 'warning'
    });
    return true;
  } catch {
    return false;
  }
}

function applySelectedLine(lineId: string) {
  selectedLineId.value = lineId;
  draftSteps.value = [...(order.value?.lines.find((line) => line.id === lineId)?.processSteps || [])];
}

function addStep(processName: string) {
  const step = processName.trim();
  if (!step) {
    return;
  }
  draftSteps.value.push(step);
}

function addCustomStep() {
  const step = customProcessName.value.trim();
  if (!step) {
    ElMessage.warning('请填写工艺名称');
    return;
  }
  addStep(step);
  customProcessName.value = '';
}

function removeStep(index: number) {
  draftSteps.value.splice(index, 1);
}

function moveStep(index: number, offset: number) {
  const target = index + offset;
  const next = [...draftSteps.value];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  draftSteps.value = next;
}

function applyTemplate(steps: string[]) {
  draftSteps.value = [...steps];
}

function normalizeSteps(steps: string[]) {
  return steps.map((step) => step.trim()).filter(Boolean);
}

function goOrderDetail() {
  if (order.value) {
    void router.push(`/orders/${order.value.orderNo}`);
  }
}

async function saveProcess() {
  if (!order.value || !selectedLine.value) {
    return false;
  }

  const normalizedSteps = normalizeSteps(draftSteps.value);
  if (normalizedSteps.length === 0) {
    ElMessage.warning('请至少添加一道生产工艺');
    return false;
  }

  const lineId = selectedLine.value.id;
  saving.value = true;
  try {
    // 保存时同步 OrderLine 流程，并同步尚未完成的 ProductionTask 快照。
    order.value = await erpApi.updateLineProcess(order.value.orderNo, lineId, normalizedSteps);
    applySelectedLine(lineId);
    ElMessage.success('生产流程已保存');
    return true;
  } finally {
    saving.value = false;
  }
}

async function saveAndNext() {
  const lineId = selectedLine.value?.id;
  const saved = await saveProcess();
  if (!saved || !order.value || !lineId) {
    return;
  }

  const currentIndex = order.value.lines.findIndex((line) => line.id === lineId);
  const nextLine = order.value.lines[currentIndex + 1];
  if (nextLine) {
    applySelectedLine(nextLine.id);
  } else {
    ElMessage.success('当前订单零件流程已全部处理');
  }
}

async function submitOrderFromProcess() {
  if (!order.value) {
    return;
  }
  if (isDirty.value) {
    ElMessage.warning('请先保存当前零件流程');
    return;
  }
  if (order.value.status !== 'DRAFT') {
    ElMessage.warning('只有草稿订单可以提交生产');
    return;
  }
  if (missingLineNames.value.length > 0) {
    ElMessage.warning(`还有零件未配置流程：${missingLineNames.value.join('、')}`);
    return;
  }

  try {
    await ElMessageBox.confirm('提交后会生成生产任务，订单零件不能再编辑。', '提交生产', {
      confirmButtonText: '提交生产',
      cancelButtonText: '取消',
      type: 'warning'
    });
  } catch {
    return;
  }

  submitting.value = true;
  try {
    // 生产流程页确认全部零件流程后，直接提交订单并生成 ProductionTask。
    order.value = await erpApi.submitOrder(order.value.orderNo);
    ElMessage.success('订单已提交生产');
    await loadOrders();
  } finally {
    submitting.value = false;
  }
}

async function loadInitialState() {
  await loadCustomers();

  const initialOrderNo = String(route.query.orderNo || '');
  if (!initialOrderNo) {
    return;
  }

  loading.value = true;
  try {
    order.value = await erpApi.order(initialOrderNo);
    selectedCustomerId.value = order.value.customerId;
    selectedOrderNo.value = order.value.orderNo;
    await loadOrders();
    applySelectedLine(order.value.lines[0]?.id || '');
  } finally {
    loading.value = false;
  }
}

onMounted(loadInitialState);
</script>

<style scoped>
.process-filter {
  align-items: flex-end;
}

.process-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.process-layout {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 24px;
}

.parts-panel,
.builder-panel {
  min-height: min(520px, calc(100vh - 230px));
  min-width: 0;
}

.process-summary {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin: 16px 17px 8px;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.summary-label {
  display: block;
  margin-bottom: 6px;
  color: #64748b;
  font-size: 12px;
}

.missing-text,
.ready-text {
  margin: 0;
  font-size: 13px;
}

.missing-text {
  color: #d97706;
}

.ready-text {
  color: #15803d;
}

.part-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% - 34px);
  min-height: 74px;
  margin: 0 17px 14px;
  padding: 12px;
  text-align: left;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
}

.part-item.active {
  background: #eff6ff;
  border-color: #93c5fd;
}

.part-item strong,
.part-item small {
  display: block;
}

.part-item small {
  margin-top: 8px;
  color: #64748b;
}

.part-item em {
  color: #64748b;
  font-size: 12px;
  font-style: normal;
}

.part-item.active em {
  color: #1d4ed8;
}

.dirty-text {
  color: #d97706;
  font-size: 13px;
}

.available-processes {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 8px 20px 18px;
}

.process-templates {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 20px 14px;
}

.process-templates span {
  color: #64748b;
  font-size: 13px;
}

.custom-process {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 0 20px 18px;
}

.builder-panel h4 {
  margin: 16px 20px;
}

.selected-steps {
  padding: 0 20px 24px;
}

.selected-step {
  display: grid;
  grid-template-columns: 42px minmax(180px, 1fr) 180px;
  align-items: center;
  min-height: 48px;
  margin-bottom: 10px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #1d4ed8;
  background: #dbeafe;
  border-radius: 14px;
  font-size: 12px;
  font-weight: 600;
}

.step-actions {
  text-align: right;
}

@media (max-width: 1100px) {
  .process-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .process-layout {
    grid-template-columns: 1fr;
  }

  .parts-panel,
  .builder-panel {
    min-height: auto;
  }

  .selected-step {
    grid-template-columns: 42px minmax(0, 1fr);
    row-gap: 8px;
  }

  .step-actions {
    grid-column: 2;
    text-align: left;
  }
}
</style>
