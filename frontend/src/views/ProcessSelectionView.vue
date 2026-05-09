<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">每个零件的生产流程选择</h2>
      <div class="process-actions">
        <el-button :disabled="!order" @click="goOrderDetail">查看订单明细</el-button>
        <el-button :disabled="!selectedLine || !canEditProcess" :loading="saving" @click="saveAndNext">保存并下一个</el-button>
        <el-button type="primary" :disabled="!selectedLine || !canEditProcess" :loading="saving" @click="saveProcess">保存零件流程</el-button>
        <el-button type="success" :disabled="!canSubmitOrder" :loading="submitting" @click="openSubmitOrderDialog">
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
              <OrderNoLink :order-no="row.orderNo" />
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
            <template #default="{ row }">{{ formatOrderQuantity(row, 'totalQuantity') }}</template>
          </el-table-column>
          <el-table-column label="生产计划数量" width="140">
            <template #default="{ row }">{{ formatOrderQuantity(row, 'totalProductionPlanQuantity') }}</template>
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
                <OrderNoLink :order-no="item.orderNo" />
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
              <span>{{ formatOrderQuantity(item, 'totalQuantity') }}</span>
            </div>
            <div class="mobile-field">
              <label>生产计划数量</label>
              <span>{{ formatOrderQuantity(item, 'totalProductionPlanQuantity') }}</span>
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

        <el-form label-width="108px" class="process-editor-form">
          <el-form-item label="流程填写人员" required>
            <el-select
              v-model="processEditorCode"
              filterable
              remote
              reserve-keyword
              clearable
              :disabled="!canEditProcessBase"
              :remote-method="loadProcessEditorOperators"
              :loading="processEditorLoading"
              placeholder="选择下单/计划或技术工艺人员，车间人员只能查看"
              @visible-change="(visible: boolean) => visible && loadProcessEditorOperators('')"
            >
              <el-option
                v-for="operator in processEditorOperators"
                :key="operator.code"
                :label="submitPlanOperatorLabel(operator)"
                :value="operator.code"
              >
                <div class="operator-option">
                  <strong>{{ operator.name }}</strong>
                  <span>{{ operator.accountId || operator.code }} / {{ operator.role }}</span>
                </div>
              </el-option>
            </el-select>
            <div class="form-help-text">生产流程由下单管理人员填写；后续可交由技术或工艺人员维护，车间人员只查看流程并按流程生产。</div>
          </el-form-item>
        </el-form>

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

        <div class="available-process-toolbar">
          <el-input
            v-model="quickProcessFilterKeyword"
            clearable
            placeholder="搜索工序 / 拼音 / 首字母"
            :disabled="!canEditProcess"
          />
        </div>
        <div class="available-processes">
          <el-button v-for="process in filteredQuickProcessOptions" :key="process" round :disabled="!canEditProcess" @click="addStep(process)">
            {{ process }}
          </el-button>
          <span v-if="quickProcessFilterKeyword && filteredQuickProcessOptions.length === 0" class="process-empty-text">没有匹配工序</span>
        </div>
        <div class="inline-process-create">
          <el-input v-model="newProcessName" placeholder="新建标准工序，例如 抛丸、抛光" maxlength="30" :disabled="!canEditProcess" />
          <el-button :loading="creatingProcess" :disabled="!canEditProcess" @click="createProcessDefinition">新建工序</el-button>
          <el-button :disabled="!canEditProcess" @click="processDefinitionManagerVisible = true">管理工序</el-button>
        </div>

        <div class="standard-process-help">
          工序名称只允许选择标准工序；次数、参数和特殊要求请写入工序备注，避免后续统计混乱。
        </div>

        <h4>已选流程</h4>
        <div class="selected-steps">
          <div v-for="(step, index) in draftSteps" :key="`${index}-${step.processName}`" class="selected-step">
            <span class="step-index">{{ index + 1 }}</span>
            <el-select
              v-model="step.processName"
              filterable
              placeholder="标准工序 / 拼音 / 首字母"
              :disabled="!canEditProcess"
              :filter-method="handleDraftProcessFilter"
              @change="handleDraftStepChange"
              @visible-change="handleDraftProcessVisibleChange"
            >
              <el-option v-for="process in filteredProcessOptions" :key="process" :label="process" :value="process" />
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

    <el-dialog
      v-model="submitOrderDialogVisible"
      title="提交生产"
      width="min(760px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
    >
      <div class="submit-production-summary">
        <el-alert
          title="提交后会按履约方式生成生产任务、扣减库存或转入订单待发货库存；提交后订单零件不能再按草稿编辑。"
          type="warning"
          :closable="false"
        />
        <el-form label-width="108px" class="submit-plan-form">
          <el-form-item label="下计划操作员" required>
            <el-select
              v-model="submitPlanOperatorCode"
              filterable
              remote
              reserve-keyword
              clearable
              :remote-method="loadSubmitPlanOperators"
              :loading="submitPlanOperatorLoading"
              placeholder="选择生产计划员，车间主任不能提交"
              @visible-change="(visible: boolean) => visible && loadSubmitPlanOperators('')"
            >
              <el-option
                v-for="operator in submitPlanOperators"
                :key="operator.code"
                :label="submitPlanOperatorLabel(operator)"
                :value="operator.code"
              >
                <div class="operator-option">
                  <strong>{{ operator.name }}</strong>
                  <span>{{ operator.accountId || operator.code }} / {{ operator.role }}</span>
                </div>
              </el-option>
            </el-select>
            <div class="form-help-text">提交生产属于下计划动作；车间主任只在生产页开始生产、确认生产。</div>
          </el-form-item>
        </el-form>
        <p class="submit-production-row">
          <span>订单号</span>
          <strong>{{ order?.orderNo }}</strong>
        </p>
        <p class="submit-production-row">
          <span>客户</span>
          <strong>{{ order?.customerName }}</strong>
        </p>
        <p class="submit-production-row">
          <span>零件数</span>
          <strong>{{ order?.lines.length || 0 }} 个</strong>
        </p>
        <p v-if="order" class="submit-production-row">
          <span>客户订单</span>
          <strong>{{ formatOrderQuantity(order, 'totalQuantity') }}</strong>
        </p>
        <p v-if="order" class="submit-production-row">
          <span>生产计划</span>
          <strong>{{ formatOrderQuantity(order, 'totalProductionPlanQuantity') }}</strong>
        </p>
        <div v-if="order" class="submit-production-lines">
          <article v-for="line in order.lines" :key="line.id" class="submit-production-line">
            <div>
              <strong>{{ line.partCode }} / {{ line.partName }}</strong>
              <span>{{ fulfillmentModeLabel(line.fulfillmentMode) }}，订单 {{ formatQuantity(line.quantity, line.unit) }}，生产计划 {{ formatQuantity(line.productionPlanQuantity, line.unit) }}</span>
            </div>
            <small v-if="line.fulfillmentMode !== 'STOCK'">流程：{{ line.processSteps.length ? line.processSteps.join('、') : '未配置' }}</small>
            <small v-if="stockSourceSummary(line)">库存来源：{{ stockSourceSummary(line) }}</small>
          </article>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="submitting" @click="submitOrderDialogVisible = false">取消</el-button>
        <el-button type="success" :disabled="!submitPlanOperatorCode" :loading="submitting" @click="confirmSubmitOrderFromProcess">提交生产</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="discardChangesDialogVisible"
      title="切换流程"
      width="min(500px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
      @closed="handleDiscardChangesClosed"
    >
      <p class="discard-changes-text">当前流程未保存，切换后会丢失修改。</p>
      <template #footer>
        <el-button @click="cancelDiscardChanges">取消</el-button>
        <el-button type="warning" @click="confirmDiscardChangesDialog">继续切换</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import OrderSelect from '../components/OrderSelect.vue';
import ProcessDefinitionManager from '../components/ProcessDefinitionManager.vue';
import ProcessTemplateManager from '../components/ProcessTemplateManager.vue';
import StatusTag from '../components/StatusTag.vue';
import type { OrderDetail, OrderLine, OrderSummary, ProcessStepDetail, ProductionOperator } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';
import { validateStockModeLines } from '../utils/orderLineStockChecks';
import { filterPinyinSearchOptions } from '../utils/pinyinSearch';
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

const processOptions = ref<string[]>([]);
const newProcessName = ref('');
const creatingProcess = ref(false);
const quickProcessFilterKeyword = ref('');
const draftProcessFilterKeyword = ref('');
const processDefinitionManagerVisible = ref(false);
const submitOrderDialogVisible = ref(false);
const processEditorCode = ref('');
const processEditorOperators = ref<ProductionOperator[]>([]);
const processEditorLoading = ref(false);
const submitPlanOperatorCode = ref('');
const submitPlanOperators = ref<ProductionOperator[]>([]);
const submitPlanOperatorLoading = ref(false);
const discardChangesDialogVisible = ref(false);
let discardChangesResolver: ((confirmed: boolean) => void) | undefined;

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
const canEditProcessBase = computed(() => order.value?.status === 'DRAFT' && selectedLine.value?.fulfillmentMode !== 'STOCK');
const canEditProcess = computed(() => canEditProcessBase.value);
const canSubmitOrder = computed(
  () => order.value?.status === 'DRAFT' && (order.value?.lines.length || 0) > 0 && missingLineNames.value.length === 0 && !isDirty.value
);
const returnToPath = computed(() => normalizeReturnTo(route.query.returnTo));
const filteredQuickProcessOptions = computed(() => filterPinyinSearchOptions(processOptions.value, quickProcessFilterKeyword.value));
const filteredProcessOptions = computed(() => filterPinyinSearchOptions(processOptions.value, draftProcessFilterKeyword.value));

function orderProductionStatusValue(item: OrderSummary) {
  if (item.status === 'DRAFT') {
    return 'ORDER_DRAFT';
  }
  if (item.status === 'CANCELLED') {
    return 'ORDER_CANCELLED';
  }
  return item.productionStatus;
}

function formatOrderQuantity(order: OrderSummary, field: 'totalQuantity' | 'totalProductionPlanQuantity') {
  if (order.quantityByUnit?.length) {
    return order.quantityByUnit.map((row) => formatQuantity(row[field], row.unit)).join(' / ');
  }
  return formatQuantity(order[field], order.unit);
}

async function loadProcessDefinitions() {
  try {
    const rows = await erpApi.processDefinitions(undefined, 'ENABLED');
    processOptions.value = rows.map((row) => row.processName);
  } catch (error) {
    processOptions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '标准工序加载失败');
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
    processEditorCode.value = '';
    return;
  }

  loading.value = true;
  try {
    order.value = await erpApi.order(selectedOrderNo.value);
    processEditorCode.value = '';
    applySelectedLine(defaultProcessLineId(order.value));
  } catch (error) {
    order.value = undefined;
    selectedLineId.value = '';
    draftSteps.value = [];
    processEditorCode.value = '';
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
  processEditorCode.value = '';
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

function stockSourceSummary(line: OrderLine) {
  const sources = line.selectedStockSources || [];
  if (sources.length === 0) {
    return '';
  }
  return sources
    .map((source) => {
      const manualText = source.compatibilityStatus && source.compatibilityStatus !== 'MATCHED' ? ' / 人工确认' : '';
      return `${source.batchNo || source.batchId} ${formatQuantity(source.quantity, source.unit || line.unit)}${manualText}`;
    })
    .join('；');
}

function warnProcessEditUnavailable() {
  if (!canEditProcessBase.value) {
    ElMessage.warning('只有草稿订单的生产零件可以修改生产流程');
    return false;
  }
  return true;
}

function warnProcessSaveUnavailable() {
  if (!warnProcessEditUnavailable()) {
    return false;
  }
  if (!processEditorCode.value) {
    ElMessage.warning('保存生产流程前，请选择下单/计划或技术工艺人员；车间人员只能查看生产流程');
    return false;
  }
  return true;
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

  if (discardChangesResolver) {
    discardChangesResolver(false);
    discardChangesResolver = undefined;
  }
  discardChangesDialogVisible.value = true;
  return new Promise<boolean>((resolve) => {
    discardChangesResolver = resolve;
  });
}

function confirmDiscardChangesDialog() {
  const resolve = discardChangesResolver;
  discardChangesResolver = undefined;
  discardChangesDialogVisible.value = false;
  resolve?.(true);
}

function cancelDiscardChanges() {
  const resolve = discardChangesResolver;
  discardChangesResolver = undefined;
  discardChangesDialogVisible.value = false;
  resolve?.(false);
}

function handleDiscardChangesClosed() {
  if (!discardChangesResolver) {
    return;
  }
  const resolve = discardChangesResolver;
  discardChangesResolver = undefined;
  resolve(false);
}

function applySelectedLine(lineId: string) {
  selectedLineId.value = lineId;
  draftSteps.value = selectedLineProcessDetails(order.value?.lines.find((line) => line.id === lineId));
}

function defaultProcessLineId(orderDetail: OrderDetail) {
  // 使用库存的零件不需要配置工序；进入页面时优先定位到仍需维护流程的零件，减少操作员手动跳转。
  return (
    orderDetail.lines.find((line) => line.fulfillmentMode !== 'STOCK' && line.processSteps.length === 0)?.id ||
    orderDetail.lines.find((line) => line.fulfillmentMode !== 'STOCK')?.id ||
    orderDetail.lines[0]?.id ||
    ''
  );
}

function addStep(processName: string) {
  if (!warnProcessEditUnavailable()) {
    return;
  }
  const step = processName.trim();
  if (!step) {
    return;
  }
  const stepKey = normalizeProcessNameKey(step);
  if (normalizeSteps(draftSteps.value).some((item) => normalizeProcessNameKey(item.processName) === stepKey)) {
    ElMessage.warning(`当前零件已包含工艺：${step}`);
    return;
  }
  draftSteps.value.push({ processName: step, processRemark: '' });
}

async function createProcessDefinition() {
  if (!warnProcessEditUnavailable()) {
    return;
  }
  const processName = newProcessName.value.trim();
  if (!processName) {
    ElMessage.warning('请填写标准工序名称');
    return;
  }
  const processKey = normalizeProcessNameKey(processName);
  if (processOptions.value.some((item) => normalizeProcessNameKey(item) === processKey)) {
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
  if (!warnProcessEditUnavailable()) {
    return;
  }
  draftSteps.value = normalizeSteps(steps);
  const duplicates = duplicateStepNames(draftSteps.value);
  if (duplicates.length > 0) {
    ElMessage.warning(`流程中存在重复工序：${duplicates.join('、')}，请调整后再保存`);
  }
}

function normalizeSteps(steps: ProcessStepDetail[]) {
  // 不按当前本地标准工序列表过滤，避免列表尚未刷新时把模板步骤误删；保存时后端会校验标准工序状态。
  const result: ProcessStepDetail[] = [];
  steps.forEach((step) => {
    const processName = step.processName.trim();
    if (processName) {
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
  draftProcessFilterKeyword.value = '';
  const duplicates = duplicateStepNames(draftSteps.value);
  if (duplicates.length > 0) {
    ElMessage.warning(`当前零件流程存在重复工序：${duplicates.join('、')}，请确认后再保存`);
  }
}

function handleDraftProcessFilter(keyword: string) {
  draftProcessFilterKeyword.value = keyword;
}

function handleDraftProcessVisibleChange(visible: boolean) {
  if (!visible) {
    draftProcessFilterKeyword.value = '';
  }
}

function duplicateStepNames(steps: ProcessStepDetail[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const step of steps) {
    const processName = step.processName.trim();
    const processKey = normalizeProcessNameKey(processName);
    if (!processKey) {
      continue;
    }
    if (seen.has(processKey)) {
      duplicates.add(processName);
    }
    seen.add(processKey);
  }
  return [...duplicates];
}

function normalizeProcessNameKey(processName: string) {
  return processName.trim().toLocaleLowerCase().replace(/[\s\-_./\\]+/g, '');
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
  if (order.value) {
    goOrderSummaryDetail(order.value.orderNo);
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
  if (!warnProcessSaveUnavailable()) {
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
    order.value = await erpApi.updateLineProcess(order.value.orderNo, lineId, {
      configuredByCode: processEditorCode.value,
      steps: normalizedSteps
    });
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
  const nextLine = order.value.lines.slice(currentIndex + 1).find((line) => line.fulfillmentMode !== 'STOCK');
  if (nextLine) {
    applySelectedLine(nextLine.id);
  } else {
    ElMessage.success('当前订单需要配置流程的零件已全部处理');
  }
}

function validateSubmitOrderReady() {
  if (!order.value) {
    return false;
  }
  if (isDirty.value) {
    ElMessage.warning('请先保存当前零件流程');
    return false;
  }
  if (order.value.status !== 'DRAFT') {
    ElMessage.warning('只有草稿订单可以提交生产');
    return false;
  }
  if (missingLineNames.value.length > 0) {
    ElMessage.warning(`还有零件未配置流程：${missingLineNames.value.join('、')}`);
    return false;
  }
  return true;
}

async function openSubmitOrderDialog() {
  if (!validateSubmitOrderReady()) {
    return;
  }
  submitPlanOperatorCode.value = '';
  await loadSubmitPlanOperators('');
  submitOrderDialogVisible.value = true;
}

async function confirmSubmitOrderFromProcess() {
  if (!validateSubmitOrderReady() || !order.value) {
    submitOrderDialogVisible.value = false;
    return;
  }
  if (!submitPlanOperatorCode.value) {
    ElMessage.warning('请选择下计划操作员');
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
    order.value = await erpApi.submitOrder(order.value.orderNo, { submittedByCode: submitPlanOperatorCode.value });
    ElMessage.success('订单已提交生产');
    submitOrderDialogVisible.value = false;
    await loadOrders();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单提交生产失败');
  } finally {
    submitting.value = false;
  }
}

function isSubmitPlanOperator(operator: ProductionOperator) {
  return /计划/.test(operator.role || '') && !/车间主任|主任/.test(operator.role || '');
}

function isProcessEditorOperator(operator: ProductionOperator) {
  const role = operator.role || '';
  return /计划|下单|订单|技术|工艺/.test(role) && !/车间|主任|操作员/.test(role);
}

function submitPlanOperatorLabel(operator: ProductionOperator) {
  return `${operator.name} / ${operator.accountId || operator.code} / ${operator.role}`;
}

async function loadSubmitPlanOperators(keyword = '') {
  submitPlanOperatorLoading.value = true;
  try {
    const operators = await erpApi.productionOperators(keyword.trim());
    submitPlanOperators.value = operators.filter(isSubmitPlanOperator);
  } catch (error) {
    submitPlanOperators.value = [];
    ElMessage.error(error instanceof Error ? error.message : '下计划操作员加载失败');
  } finally {
    submitPlanOperatorLoading.value = false;
  }
}

async function loadProcessEditorOperators(keyword = '') {
  processEditorLoading.value = true;
  try {
    const operators = await erpApi.productionOperators(keyword.trim());
    processEditorOperators.value = operators.filter(isProcessEditorOperator);
  } catch (error) {
    processEditorOperators.value = [];
    ElMessage.error(error instanceof Error ? error.message : '流程填写人员加载失败');
  } finally {
    processEditorLoading.value = false;
  }
}

async function loadInitialState() {
  await loadProcessDefinitions();
  await loadProcessEditorOperators('');
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

.available-process-toolbar {
  max-width: 360px;
  padding: 8px 20px 4px;
}

.available-processes {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  min-height: 42px;
  padding: 8px 20px 18px;
}

.process-empty-text {
  align-self: center;
  color: #64748b;
  font-size: 13px;
}

.process-template-inline {
  margin: 4px 20px 18px;
}

.process-editor-form {
  margin: 4px 20px 18px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.process-editor-form :deep(.el-select) {
  width: min(380px, 100%);
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

.submit-production-summary {
  display: grid;
  gap: 12px;
}

.submit-plan-form {
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.submit-plan-form :deep(.el-select) {
  width: min(360px, 100%);
}

.form-help-text {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.operator-option {
  display: grid;
  gap: 2px;
  padding: 4px 0;
}

.operator-option strong {
  color: #0f172a;
}

.operator-option span {
  color: #64748b;
  font-size: 12px;
}

.submit-production-row {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  margin: 0;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.submit-production-summary span {
  color: #64748b;
  font-size: 13px;
}

.submit-production-summary strong {
  min-width: 0;
  color: #0f172a;
  overflow-wrap: anywhere;
}

.submit-production-lines {
  display: grid;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
}

.submit-production-line {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.submit-production-line div {
  display: grid;
  gap: 4px;
}

.submit-production-line span,
.submit-production-line small {
  min-width: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.discard-changes-text {
  margin: 0;
  color: #475569;
  line-height: 1.7;
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
