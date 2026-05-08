<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">每个零件的生产流程选择</h2>
      <div class="process-actions">
        <el-button :disabled="!order" @click="goOrderDetail">查看订单明细</el-button>
        <el-button :disabled="!selectedLine || !canEditProcess" :loading="saving" @click="saveAndNext">保存并下一个</el-button>
        <el-button type="primary" :disabled="!selectedLine || !canEditProcess" :loading="saving" @click="saveProcess">保存零件流程</el-button>
        <el-button type="success" :disabled="!canSubmitOrder" :loading="submitting" @click="submitOrderFromProcess">
          提交生产
        </el-button>
      </div>
    </div>

    <div class="filter-bar process-filter">
      <div class="filter-field">
        <label>订单日期</label>
        <DateRangeFilter v-model="orderDateRange" @change="handleDateChange" />
      </div>

      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect
          v-model="selectedCustomerId"
          placeholder="全部客户"
          width="260px"
          @change="handleCustomerChange"
        />
      </div>

      <div class="filter-field">
        <label>订单</label>
        <OrderSelect
          v-model="filterOrderNo"
          :orders="orderOptions"
          placeholder="可选订单"
          width="320px"
          :disabled="orderOptions.length === 0"
        />
      </div>

      <el-button type="primary" :loading="ordersLoading" @click="queryOrders">查询订单</el-button>
    </div>

    <el-empty v-if="ordersLoaded && orders.length === 0" description="当前条件没有订单" />

    <div v-else-if="!order" v-loading="ordersLoading" class="process-order-list">
      <div class="order-list-note">
        <strong>当前条件订单</strong>
        <span>可先按订单日期筛选全部客户订单，再按客户或订单继续缩小范围。</span>
      </div>

      <div class="table-card desktop-table">
        <el-table :data="orders" max-height="calc(100vh - 330px)">
          <el-table-column label="订单号" min-width="190">
            <template #default="{ row }">
              <el-button link type="primary" @click="goOrderSummaryDetail(row.orderNo)">{{ row.orderNo }}</el-button>
            </template>
          </el-table-column>
          <el-table-column prop="customerName" label="客户" min-width="210" />
          <el-table-column label="订单日期" width="130">
            <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
          </el-table-column>
          <el-table-column label="交期" width="130">
            <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
          </el-table-column>
          <el-table-column prop="partCount" label="零件数" width="100" />
          <el-table-column label="客户订单数量" width="140">
            <template #default="{ row }">{{ formatQuantity(row.totalQuantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="生产计划数量" width="140">
            <template #default="{ row }">{{ formatQuantity(row.totalProductionPlanQuantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="订单状态" width="170">
            <template #default="{ row }">
              <StatusTag :value="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="生产状态" width="130">
            <template #default="{ row }">
              <StatusTag :value="orderProductionStatusValue(row)" compact />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="selectOrderFromList(row.orderNo)">工序设定</el-button>
              <el-button link type="primary" @click="goOrderSummaryDetail(row.orderNo)">订单明细</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="mobile-card-list">
        <article v-for="item in orders" :key="item.id" class="mobile-card">
          <div class="mobile-card-header">
            <div class="mobile-card-title">
              <strong>
                <el-button link type="primary" @click="goOrderSummaryDetail(item.orderNo)">{{ item.orderNo }}</el-button>
              </strong>
              <small>{{ item.customerName }}</small>
            </div>
          </div>
          <div class="mobile-card-fields">
            <div class="mobile-field">
              <label>订单状态</label>
              <span><StatusTag :value="item.status" compact /></span>
            </div>
            <div class="mobile-field">
              <label>生产状态</label>
              <span><StatusTag :value="orderProductionStatusValue(item)" compact /></span>
            </div>
            <div class="mobile-field">
              <label>订单日期</label>
              <span>{{ formatDate(item.orderDate) }}</span>
            </div>
            <div class="mobile-field">
              <label>交期</label>
              <span>{{ formatDate(item.deliveryDate) }}</span>
            </div>
            <div class="mobile-field">
              <label>零件数</label>
              <span>{{ item.partCount }} 个</span>
            </div>
            <div class="mobile-field">
              <label>客户订单数量</label>
              <span>{{ formatQuantity(item.totalQuantity, item.unit) }}</span>
            </div>
            <div class="mobile-field">
              <label>生产计划数量</label>
              <span>{{ formatQuantity(item.totalProductionPlanQuantity, item.unit) }}</span>
            </div>
          </div>
          <div class="mobile-card-actions">
            <el-button link type="primary" @click="selectOrderFromList(item.orderNo)">工序设定</el-button>
            <el-button link type="primary" @click="goOrderSummaryDetail(item.orderNo)">订单明细</el-button>
          </div>
        </article>
      </div>
    </div>

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
            <span class="summary-label">零件流程配置进度</span>
            <el-progress :percentage="processPercent" :stroke-width="8" />
          </div>
          <p v-if="missingLineNames.length" class="missing-text">未配置：{{ missingLineNames.join('、') }}</p>
          <p v-else class="ready-text">全部零件已配置流程</p>
          <p v-if="order.status !== 'DRAFT'" class="locked-text">当前订单已提交，生产流程只能查看，不能修改。</p>
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
            <small>{{ fulfillmentModeLabel(line.fulfillmentMode) }} / 生产计划 {{ formatQuantity(line.productionPlanQuantity, line.unit) }}</small>
          </span>
          <em>{{ line.fulfillmentMode === 'STOCK' ? '使用库存' : line.processSteps.length ? `${line.processSteps.length} 道` : '未选择' }}</em>
        </button>
      </div>

      <div class="panel builder-panel">
        <div class="panel-header">
          <h3 class="panel-title">{{ selectedLine?.partName || '-' }} / 生产步骤</h3>
          <span v-if="isDirty" class="dirty-text">未保存</span>
        </div>

        <ProcessTemplateManager
          class="process-template-inline"
          compact
          selectable
          :disabled="!canEditProcess"
          :source-steps="draftSteps"
          :source-name="selectedLineTemplateName"
          title="流程记忆"
          hint="可搜索、应用、新建、编辑或删除流程模板；模板不绑定零件号。"
          @apply="applyTemplate"
          @process-definition-updated="loadProcessDefinitions"
        />

        <div class="available-processes">
          <el-button v-for="process in processOptions" :key="process" round :disabled="!canEditProcess" @click="addStep(process)">
            {{ process }}
          </el-button>
        </div>
        <div class="inline-process-create">
          <el-input v-model="newProcessName" placeholder="新建标准工序，例如 抛丸、抛光" maxlength="30" :disabled="!canEditProcess" />
          <el-button :loading="creatingProcess" :disabled="!canEditProcess" @click="createProcessDefinition">新建工序</el-button>
          <el-button @click="processDefinitionManagerVisible = true">管理工序</el-button>
        </div>

        <div class="standard-process-help">
          工序名称只允许选择标准工序；次数、参数和特殊要求请写入工序备注，避免后续统计混乱。
        </div>

        <h4>已选流程</h4>
        <div class="selected-steps">
          <div v-for="(step, index) in draftSteps" :key="`${index}-${step.processName}`" class="selected-step">
            <span class="step-index">{{ index + 1 }}</span>
            <el-select v-model="step.processName" placeholder="标准工序" :disabled="!canEditProcess" @change="handleDraftStepChange">
              <el-option v-for="process in processOptions" :key="process" :label="process" :value="process" />
            </el-select>
            <el-input v-model="step.processRemark" placeholder="参数备注，例如 4次 / M6孔" :disabled="!canEditProcess" />
            <div class="step-actions">
              <el-button link :disabled="!canEditProcess || index === 0" @click="moveStep(index, -1)">上移</el-button>
              <el-button link :disabled="!canEditProcess || index === draftSteps.length - 1" @click="moveStep(index, 1)">下移</el-button>
              <el-button link type="danger" :disabled="!canEditProcess" @click="removeStep(index)">删除</el-button>
            </div>
          </div>
          <el-empty v-if="draftSteps.length === 0" description="当前零件未选择生产流程" />
        </div>
      </div>
    </div>

    <el-dialog
      v-model="processDefinitionManagerVisible"
      title="标准工序维护"
      width="min(900px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
    >
      <ProcessDefinitionManager
        title="生产流程标准工序"
        hint="这里维护每个零件流程配置时可选择的标准工序；重复工序名称会被系统拦截。"
        @updated="handleProcessDefinitionsUpdated"
      />
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import OrderSelect from '../components/OrderSelect.vue';
import ProcessDefinitionManager from '../components/ProcessDefinitionManager.vue';
import ProcessTemplateManager from '../components/ProcessTemplateManager.vue';
import StatusTag from '../components/StatusTag.vue';
import { standardProcessOptions } from '../config/processes';
import type { OrderDetail, OrderLine, OrderSummary, ProcessStepDetail } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';
import { validateStockModeLines } from '../utils/orderLineStockChecks';
import { validateSubmitStockSources } from '../utils/submitStockSourceChecks';

const route = useRoute();
const router = useRouter();
const orders = ref<OrderSummary[]>([]);
const orderOptions = ref<OrderSummary[]>([]);
const order = ref<OrderDetail>();
const selectedCustomerId = ref('');
const filterOrderNo = ref('');
const selectedOrderNo = ref('');
const selectedLineId = ref('');
const orderDateRange = ref<string[]>([]);
const lastDateRange = ref<string[]>([]);
const draftSteps = ref<ProcessStepDetail[]>([]);
const loading = ref(false);
const ordersLoading = ref(false);
const ordersLoaded = ref(false);
const saving = ref(false);
const submitting = ref(false);
const restoringSelection = ref(false);

const processOptions = ref<string[]>([...standardProcessOptions]);
const newProcessName = ref('');
const creatingProcess = ref(false);
const processDefinitionManagerVisible = ref(false);

const selectedLine = computed<OrderLine | undefined>(() => order.value?.lines.find((line) => line.id === selectedLineId.value));
const selectedLineTemplateName = computed(() => (selectedLine.value?.partName ? `${selectedLine.value.partName}流程` : '当前流程'));
const savedSteps = computed(() => selectedLineProcessDetails(selectedLine.value));
const isDirty = computed(() => JSON.stringify(normalizeSteps(draftSteps.value)) !== JSON.stringify(normalizeSteps(savedSteps.value)));
const processRequiredLines = computed(() => order.value?.lines.filter((line) => line.fulfillmentMode !== 'STOCK') || []);
const totalLineCount = computed(() => processRequiredLines.value.length);
const configuredLineCount = computed(() => processRequiredLines.value.filter((line) => line.processSteps.length > 0).length);
const processPercent = computed(() =>
  totalLineCount.value ? Math.round((configuredLineCount.value / totalLineCount.value) * 100) : 0
);
const missingLineNames = computed(() => processRequiredLines.value.filter((line) => line.processSteps.length === 0).map((line) => line.partName));
const canEditProcess = computed(() => order.value?.status === 'DRAFT' && selectedLine.value?.fulfillmentMode !== 'STOCK');
const canSubmitOrder = computed(
  () => order.value?.status === 'DRAFT' && (order.value?.lines.length || 0) > 0 && missingLineNames.value.length === 0 && !isDirty.value
);
const returnToPath = computed(() => normalizeReturnTo(route.query.returnTo));

function orderProductionStatusValue(item: OrderSummary) {
  if (item.status === 'DRAFT') {
    return 'ORDER_DRAFT';
  }
  if (item.status === 'CANCELLED') {
    return 'ORDER_CANCELLED';
  }
  return item.productionStatus;
}

async function loadProcessDefinitions() {
  try {
    const rows = await erpApi.processDefinitions(undefined, 'ENABLED');
    processOptions.value = rows.map((row) => row.processName);
  } catch {
    processOptions.value = [...standardProcessOptions];
  }
}

async function handleProcessDefinitionsUpdated() {
  await loadProcessDefinitions();
}

async function loadOrders() {
  ordersLoading.value = true;
  try {
    // 订单日期是生产流程页的第一层筛选；客户和订单都是可选的下一级筛选条件。
    orderOptions.value = await erpApi.orders({
      customerId: selectedCustomerId.value || undefined,
      dateFrom: orderDateRange.value[0],
      dateTo: orderDateRange.value[1]
    });

    orders.value = filterOrderNo.value
      ? orderOptions.value.filter((item) => item.orderNo === filterOrderNo.value)
      : [...orderOptions.value];
    lastDateRange.value = [...orderDateRange.value];
    ordersLoaded.value = true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单列表加载失败');
  } finally {
    ordersLoading.value = false;
  }
}

async function queryOrders() {
  if (!(await confirmDiscardChanges())) {
    return;
  }
  resetOrderSelection();
  await loadOrders();
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
  } catch (error) {
    order.value = undefined;
    selectedLineId.value = '';
    draftSteps.value = [];
    ElMessage.error(error instanceof Error ? error.message : '订单明细加载失败');
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
  filterOrderNo.value = '';
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
  filterOrderNo.value = '';
  resetOrderSelection();
  await loadOrders();
}

function resetOrderSelection() {
  selectedOrderNo.value = '';
  order.value = undefined;
  selectedLineId.value = '';
  draftSteps.value = [];
}

function fulfillmentModeLabel(mode?: string) {
  if (mode === 'STOCK') {
    return '使用库存';
  }
  if (mode === 'REWORK') {
    return '库存再加工';
  }
  return '重新生产';
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
  draftSteps.value = selectedLineProcessDetails(order.value?.lines.find((line) => line.id === lineId));
}

function addStep(processName: string) {
  if (!canEditProcess.value) {
    ElMessage.warning('只有草稿订单可以修改生产流程');
    return;
  }
  const step = processName.trim();
  if (!step) {
    return;
  }
  if (normalizeSteps(draftSteps.value).some((item) => item.processName === step)) {
    ElMessage.warning(`当前零件已包含工艺：${step}`);
    return;
  }
  draftSteps.value.push({ processName: step, processRemark: '' });
}

async function createProcessDefinition() {
  const processName = newProcessName.value.trim();
  if (!processName) {
    ElMessage.warning('请填写标准工序名称');
    return;
  }
  if (processOptions.value.some((item) => item.toLocaleLowerCase() === processName.toLocaleLowerCase())) {
    ElMessage.warning(`标准工序“${processName}”已存在，请勿重复创建`);
    return;
  }

  creatingProcess.value = true;
  try {
    const created = await erpApi.createProcessDefinition({ processName });
    await loadProcessDefinitions();
    newProcessName.value = '';
    ElMessage.success('标准工序已创建');
    addStep(created.processName);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '标准工序创建失败，请确认是否重复');
  } finally {
    creatingProcess.value = false;
  }
}

function removeStep(index: number) {
  if (!canEditProcess.value) {
    return;
  }
  draftSteps.value.splice(index, 1);
}

function moveStep(index: number, offset: number) {
  if (!canEditProcess.value) {
    return;
  }
  const target = index + offset;
  const next = [...draftSteps.value];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  draftSteps.value = next;
}

function applyTemplate(steps: ProcessStepDetail[]) {
  if (!canEditProcess.value) {
    ElMessage.warning('只有草稿订单可以修改生产流程');
    return;
  }
  draftSteps.value = normalizeSteps(steps);
  const duplicates = duplicateStepNames(draftSteps.value);
  if (duplicates.length > 0) {
    ElMessage.warning(`流程中存在重复工序：${duplicates.join('、')}，请调整后再保存`);
  }
}

function normalizeSteps(steps: ProcessStepDetail[]) {
  const result: ProcessStepDetail[] = [];
  steps.forEach((step) => {
    const processName = step.processName.trim();
    if (processName && processOptions.value.includes(processName)) {
      const processRemark = step.processRemark?.trim();
      result.push({
        processName,
        ...(processRemark ? { processRemark } : {})
      });
    }
  });
  return result;
}

function normalizeDraftSteps() {
  draftSteps.value = normalizeSteps(draftSteps.value);
}

function handleDraftStepChange() {
  normalizeDraftSteps();
  const duplicates = duplicateStepNames(draftSteps.value);
  if (duplicates.length > 0) {
    ElMessage.warning(`当前零件流程存在重复工序：${duplicates.join('、')}，请确认后再保存`);
  }
}

function duplicateStepNames(steps: ProcessStepDetail[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const step of steps) {
    const processName = step.processName.trim();
    if (!processName) {
      continue;
    }
    if (seen.has(processName)) {
      duplicates.add(processName);
    }
    seen.add(processName);
  }
  return [...duplicates];
}

function selectedLineProcessDetails(line?: OrderLine): ProcessStepDetail[] {
  if (!line) {
    return [];
  }
  if (line.processStepDetails?.length) {
    return line.processStepDetails.map((step) => ({ ...step }));
  }
  return line.processSteps.map((processName) => ({ processName }));
}

function goOrderDetail() {
  if (returnToPath.value) {
    void router.push(returnToPath.value);
    return;
  }
  if (order.value) {
    void router.push({
      path: `/orders/${encodeURIComponent(order.value.orderNo)}`,
      query: { returnTo: normalizeReturnTo(route.fullPath) || '/processes' }
    });
  }
}

async function selectOrderFromList(orderNo: string) {
  if (!(await confirmDiscardChanges())) {
    return;
  }
  selectedOrderNo.value = orderNo;
  await loadOrder();
}

function goOrderSummaryDetail(orderNo: string) {
  void router.push({
    path: `/orders/${encodeURIComponent(orderNo)}`,
    query: { returnTo: normalizeReturnTo(route.fullPath) || '/processes' }
  });
}

function normalizeReturnTo(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const path = String(raw || '').trim();
  // 返回地址只能来自站内路径，避免把生产流程页变成外部跳转入口。
  if (!path.startsWith('/') || path.startsWith('//')) {
    return '';
  }
  return path;
}

async function saveProcess() {
  if (!order.value || !selectedLine.value) {
    return false;
  }
  if (!canEditProcess.value) {
    ElMessage.warning('只有草稿订单可以修改生产流程');
    return false;
  }

  const normalizedSteps = normalizeSteps(draftSteps.value);
  if (normalizedSteps.length === 0) {
    ElMessage.warning('请至少添加一道生产工艺');
    return false;
  }
  const duplicates = duplicateStepNames(normalizedSteps);
  if (duplicates.length > 0) {
    ElMessage.warning(`当前零件流程存在重复工序：${duplicates.join('、')}，请删除或调整后再保存`);
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
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '生产流程保存失败');
    return false;
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
    const inventorySummary = await erpApi.inventorySummary({ status: 'AVAILABLE' });
    const stockCheck = validateStockModeLines(order.value.lines, inventorySummary);
    if (!stockCheck.ok) {
      ElMessage.warning(stockCheck.message);
      return;
    }
    const sourceCheck = await validateSubmitStockSources(order.value.lines);
    if (!sourceCheck.ok) {
      ElMessage.warning(sourceCheck.message);
      return;
    }
    // 生产流程页确认全部零件流程后，直接提交订单并生成 ProductionTask。
    order.value = await erpApi.submitOrder(order.value.orderNo);
    ElMessage.success('订单已提交生产');
    await loadOrders();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单提交生产失败');
  } finally {
    submitting.value = false;
  }
}

async function loadInitialState() {
  await loadProcessDefinitions();
  const initialOrderNo = String(route.query.orderNo || '');
  if (!initialOrderNo) {
    await loadOrders();
    return;
  }

  filterOrderNo.value = initialOrderNo;
  await loadOrders();

  if (route.query.open === 'edit') {
    await selectOrderFromList(initialOrderNo);
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

.process-order-list {
  display: grid;
  gap: 14px;
}

.order-list-note {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #64748b;
  font-size: 13px;
}

.order-list-note strong {
  color: #0f172a;
  font-size: 15px;
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

.locked-text {
  margin: 0;
  color: #64748b;
  font-size: 13px;
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

.process-template-inline {
  margin: 4px 20px 18px;
}

.inline-process-create {
  display: grid;
  grid-template-columns: minmax(220px, 360px) auto auto;
  align-items: center;
  gap: 10px;
  padding: 0 20px 18px;
}

.available-processes .el-button,
.step-actions .el-button {
  margin-left: 0;
}

.standard-process-help {
  margin: 0 20px 18px;
  color: #64748b;
  font-size: 13px;
}

.builder-panel h4 {
  margin: 16px 20px;
}

.selected-steps {
  padding: 0 20px 24px;
}

.selected-step {
  display: grid;
  grid-template-columns: 42px minmax(140px, 180px) minmax(180px, 1fr) 180px;
  align-items: center;
  gap: 10px;
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

  .selected-step .el-select,
  .selected-step .el-input {
    grid-column: 2;
  }

  .step-actions {
    grid-column: 2;
    text-align: left;
  }
}

@media (max-width: 900px) {
  .process-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .process-actions .el-button {
    width: 100%;
  }

  .available-processes,
  .inline-process-create,
  .selected-steps {
    padding-right: 20px;
    padding-left: 20px;
  }

  .inline-process-create {
    grid-template-columns: 1fr;
  }

  .available-processes .el-button {
    flex: 0 1 auto;
    max-width: 100%;
    white-space: normal;
  }

  .selected-step {
    grid-template-columns: 34px minmax(0, 1fr);
    padding: 8px;
  }

  .selected-step .el-select,
  .selected-step .el-input {
    grid-column: 2;
    width: 100%;
  }

  .step-actions {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .step-actions .el-button {
    flex: 1 1 82px;
    min-width: 0;
    margin-left: 0;
  }
}
</style>
