<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">订单总列表</h2>
      <el-button type="primary" @click="openCreate">新增订单</el-button>
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>订单日期</label>
        <DateRangeFilter v-model="dateRange" @change="handleOrderScopeChange" />
      </div>
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect v-model="filters.customerId" placeholder="全部客户" width="260px" @change="handleOrderScopeChange" />
      </div>
      <div class="filter-field">
        <label>订单</label>
        <OrderSelect
          v-model="filters.orderNo"
          :orders="orderOptions"
          placeholder="全部订单"
          width="320px"
          :disabled="orderOptions.length === 0"
          @change="loadOrders"
        />
      </div>
      <div class="filter-field">
        <label>订单状态</label>
        <el-select
          v-model="filters.orderStatuses"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="勾选订单状态"
          style="width: 210px"
        >
          <template #header>
            <el-checkbox
              class="select-all-checkbox"
              :model-value="allOrderStatusesChecked"
              :indeterminate="orderStatusesIndeterminate"
              @change="toggleAllOrderStatuses"
            >
              全部勾选
            </el-checkbox>
          </template>
          <el-option v-for="option in orderStatusOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>生产状态</label>
        <el-select
          v-model="filters.productionStatuses"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="勾选生产状态"
          style="width: 190px"
        >
          <template #header>
            <el-checkbox
              class="select-all-checkbox"
              :model-value="allProductionStatusesChecked"
              :indeterminate="productionStatusesIndeterminate"
              @change="toggleAllProductionStatuses"
            >
              全部勾选
            </el-checkbox>
          </template>
          <el-option
            v-for="option in productionStatusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="loadOrders">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <div class="table-card orders-table-card desktop-table">
      <el-table v-loading="loading" :data="orders" max-height="calc(100vh - 315px)" @row-dblclick="goDetail">
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
        <el-table-column label="订单状态" width="160">
          <template #default="{ row }">
            <StatusTag :value="orderDisplayStatus(row)" />
          </template>
        </el-table-column>
        <el-table-column label="生产状态" width="130">
          <template #default="{ row }">
            <StatusTag :value="orderProductionStatusValue(row)" :label-override="orderProductionStatusLabel(row)" compact />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goProcess(row)">{{ orderProcessActionText(row) }}</el-button>
            <el-tooltip :content="cancelOrderDisabledReason(row)" :disabled="canCancelOrder(row)" placement="top">
              <span class="action-tooltip-wrap">
                <el-button link type="danger" :disabled="!canCancelOrder(row)" @click.stop="openCancelOrder(row)">取消</el-button>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list">
      <article v-for="order in orders" :key="order.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong><OrderNoLink :order-no="order.orderNo" /></strong>
            <small>{{ order.customerName }}</small>
          </div>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>订单状态</label>
            <span><StatusTag :value="orderDisplayStatus(order)" compact /></span>
          </div>
          <div class="mobile-field">
            <label>生产状态</label>
            <span><StatusTag :value="orderProductionStatusValue(order)" :label-override="orderProductionStatusLabel(order)" compact /></span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(order.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(order.deliveryDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>零件数</label>
            <span>{{ order.partCount }} 个</span>
          </div>
          <div class="mobile-field">
            <label>客户订单数量</label>
            <span>{{ formatOrderQuantity(order, 'totalQuantity') }}</span>
          </div>
          <div class="mobile-field">
            <label>生产计划数量</label>
            <span>{{ formatOrderQuantity(order, 'totalProductionPlanQuantity') }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button link type="primary" @click="goDetail(order)">订单明细</el-button>
          <el-button link type="primary" @click="goProcess(order)">{{ orderProcessActionText(order) }}</el-button>
          <el-tooltip :content="cancelOrderDisabledReason(order)" :disabled="canCancelOrder(order)" placement="top">
            <span class="action-tooltip-wrap">
              <el-button link type="danger" :disabled="!canCancelOrder(order)" @click="openCancelOrder(order)">取消</el-button>
            </span>
          </el-tooltip>
        </div>
      </article>
      <div v-if="!orders.length && !loading" class="mobile-empty">暂无订单</div>
    </div>

    <el-dialog v-model="dialogVisible" title="新增订单" width="min(1500px, calc(100vw - 32px))" class="responsive-dialog order-create-dialog">
      <el-form label-width="86px">
        <div class="order-form-grid">
          <el-form-item label="客户">
            <CustomerSelect v-model="orderForm.customerId" placeholder="选择客户" status="ENABLED" width="260px" />
          </el-form-item>
          <el-form-item label="订单号">
            <div class="order-no-field">
              <el-input v-model="orderForm.orderNo" placeholder="自动生成，可手工修改" @input="handleOrderNoInput" />
              <el-button :loading="generatingOrderNo" @click="generateOrderNo">自动生成</el-button>
            </div>
            <div
              v-if="orderNoCheckText"
              :class="['order-no-check', checkingOrderNo ? 'checking' : orderNoAvailable ? 'available' : 'duplicated']"
            >
              {{ orderNoCheckText }}
            </div>
          </el-form-item>
          <el-form-item label="订单周期">
            <div class="order-date-range-field">
              <DateRangeFilter
                v-model="orderDateRange"
                start-placeholder="订单日期"
                end-placeholder="交期"
                :clearable="false"
                width="320px"
                @change="handleOrderDateRangeChange"
              />
              <span class="order-duration-text">完成天数：{{ orderDurationDaysText }}</span>
            </div>
          </el-form-item>
        </div>

        <div class="dialog-subtitle">
          <div class="dialog-subtitle-title">
            <strong>订单零件</strong>
            <el-popover placement="right" trigger="click" width="430">
              <template #reference>
                <el-button
                  class="duplicate-help-button"
                  :icon="WarningFilled"
                  circle
                  text
                  aria-label="图纸重复规则说明"
                />
              </template>
              <div class="duplicate-help">
                <strong>图纸与图号使用说明</strong>
                <p>图号可能跨零件复用，但系统必须先提醒操作人员确认。</p>
                <p>如果不同零件编号出现相同图号，保存时会提示图号冲突，并列出两个零件的图号和版本号，需要确认后才能继续。</p>
                <p>如果上传了相同图纸文件名，上传时会先确认，并同时展示当前选择图纸和重复图纸或图纸打开入口。</p>
                <p>保存时仍会再次检查相同图纸文件名，作为最终兜底。</p>
                <p>保存时会同时检查当前订单和历史订单中的图号、图纸文件名，不能只依赖人工记忆。</p>
              </div>
            </el-popover>
          </div>
          <div class="dialog-subtitle-actions">
            <el-button size="small" @click="processDefinitionManagerVisible = true">标准工序维护</el-button>
            <el-button size="small" @click="addLine">新增零件</el-button>
          </div>
        </div>

        <OrderLineEditor
          :lines="orderForm.lines"
          :default-delivery-date="orderForm.deliveryDate"
          :inventory-summary="inventorySummary"
          @remove="removeLine"
          @quantity-change="syncPlanQuantity"
        />
      </el-form>
      <template #footer>
        <div class="dialog-footer-actions">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="saveOrder">保存订单</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="processDefinitionManagerVisible"
      title="标准工序维护"
      width="min(900px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
    >
      <ProcessDefinitionManager
        title="订单页面标准工序"
        hint="这里维护下单和补单后可选的标准工序；重复工序名称会被系统拦截。"
      />
    </el-dialog>

    <el-dialog v-model="cancelOrderVisible" title="取消订单" width="min(980px, calc(100vw - 32px))" class="responsive-dialog">
      <el-alert
        title="正常订单和补单订单都可以取消。未开始生产的订单会删除未开工任务并释放库存；已开始生产的订单会同步通知生产和仓库处理已生产物料。"
        type="warning"
        :closable="false"
        class="mb-16"
      />
      <el-form label-width="116px">
        <el-form-item label="订单号">
          <strong>{{ activeCancelOrder?.orderNo }}</strong>
        </el-form-item>
        <el-form-item label="客户">
          <span>{{ activeCancelOrder?.customerName }}</span>
        </el-form-item>
        <el-form-item label="订单状态">
          <StatusTag v-if="activeCancelOrder" :value="orderDisplayStatus(activeCancelOrder)" />
        </el-form-item>
        <el-form-item label="取消日期">
          <el-input v-model="cancelOrderForm.cancelAt" disabled />
          <div class="form-hint">提交时由系统自动记录，操作人员不需要手工回填。</div>
        </el-form-item>
        <el-form-item label="生产状态" required>
          <el-radio-group v-model="cancelOrderForm.productionCancelState">
            <el-radio-button value="NOT_PRODUCED">未生产取消</el-radio-button>
            <el-radio-button value="PRODUCED">已生产取消</el-radio-button>
          </el-radio-group>
          <div class="form-hint">必须人工选择。若已生产，系统会同步通知仓库逐项确认转库存或报废。</div>
        </el-form-item>
        <div v-if="cancelOrderForm.productionCancelState === 'PRODUCED'" class="cancel-handling-section">
          <div class="cancel-handling-title">
            <strong>已生产零件处理计划</strong>
            <span>仓库确认时仍可修改，最终以仓库实物清点为准。</span>
          </div>
          <div v-if="cancelHandlingPlanRows.length" class="cancel-handling-list">
            <article v-for="row in cancelHandlingPlanRows" :key="row.productionTaskNo" class="cancel-handling-row">
              <div class="cancel-handling-main">
                <strong>{{ row.partCode }} / {{ row.partName }}</strong>
                <span>{{ row.productionTaskNo }}，已完成 {{ formatQuantity(row.completedQuantity, row.unit) }} / 计划 {{ formatQuantity(row.plannedQuantity, row.unit) }}</span>
              </div>
              <el-radio-group v-model="row.handlingMode" @change="handleCancelHandlingModeChange(row)">
                <el-radio-button value="STOCK">转库存</el-radio-button>
                <el-radio-button value="SCRAP">报废</el-radio-button>
                <el-radio-button value="NONE">无实物</el-radio-button>
              </el-radio-group>
              <el-input-number
                v-model="row.handlingQuantity"
                :min="0"
                :max="Math.max(row.completedQuantity, row.plannedQuantity)"
                :precision="3"
                :controls="false"
                class="cancel-handling-quantity"
                :disabled="row.handlingMode === 'NONE'"
              />
              <el-input v-model="row.remark" maxlength="120" show-word-limit placeholder="处理说明，可修改" />
            </article>
          </div>
          <el-alert v-else title="该订单未发现已开始生产的零件；请选择“未生产取消”或刷新订单后重试。" type="warning" :closable="false" />
        </div>
        <el-form-item label="管理人员" required>
          <el-input v-model="cancelOrderForm.managerName" placeholder="填写管理人员姓名" />
        </el-form-item>
        <el-form-item label="取消原因" required>
          <el-input v-model="cancelOrderForm.reason" type="textarea" :rows="4" placeholder="例如：客户取消、重复下单、项目暂停" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer-actions">
          <el-button @click="cancelOrderVisible = false">返回</el-button>
          <el-button type="danger" :loading="saving" @click="saveCancelOrder">确认取消订单</el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { WarningFilled } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router';
import { erpApi, type CreateOrderLinePayload } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import OrderLineEditor from '../components/OrderLineEditor.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import OrderSelect from '../components/OrderSelect.vue';
import ProcessDefinitionManager from '../components/ProcessDefinitionManager.vue';
import StatusTag from '../components/StatusTag.vue';
import type {
  Customer,
  InventorySummaryRow,
  OrderDetail,
  OrderLine,
  OrderLineProductionTask,
  OrderProductionFilterStatus,
  OrderStatus,
  OrderSummary
} from '../types/erp';
import { formatDate, formatDateTime, formatQuantity } from '../utils/format';
import {
  confirmDuplicateDrawingFiles,
  confirmDuplicateDrawingNos,
  confirmExistingDrawingFiles,
  confirmExistingDrawingNos
} from '../utils/orderLineDuplicateChecks';
import { validateStockModeLines } from '../utils/orderLineStockChecks';
import { orderDisplayStatus } from '../utils/orderStatus';
import { sanitizeOrderLinePayload, selectedStockSourceQuantity, validateDraftStockSourceLines } from '../utils/stockSourceReview';

const router = useRouter();
const customers = ref<Customer[]>([]);
const orders = ref<OrderSummary[]>([]);
const orderOptions = ref<OrderSummary[]>([]);
const inventorySummary = ref<InventorySummaryRow[]>([]);
const dateRange = ref<string[]>([]);
const orderDateRange = ref<string[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const cancelOrderVisible = ref(false);
const processDefinitionManagerVisible = ref(false);
const activeCancelOrder = ref<OrderSummary>();
const activeCancelOrderDetail = ref<OrderDetail>();

const orderStatusOptions: Array<{ label: string; value: OrderStatus }> = [
  { label: '待提交生产', value: 'DRAFT' },
  { label: '待确认生产', value: 'SUBMITTED' },
  { label: '生产中', value: 'IN_PRODUCTION' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已取消', value: 'CANCELLED' }
];
const productionStatusOptions: Array<{ label: string; value: OrderProductionFilterStatus }> = [
  { label: '待提交生产', value: 'ORDER_DRAFT' },
  { label: '待确认生产', value: 'WAITING_PRODUCTION' },
  { label: '生产中', value: 'ORDER_IN_PRODUCTION' },
  { label: '已完成未发货', value: 'ORDER_COMPLETED_UNSHIPPED' },
  { label: '已完成发货', value: 'ORDER_SHIPPED_COMPLETED' },
  { label: '已取消', value: 'ORDER_CANCELLED' }
];

const filters = reactive<{
  customerId?: string;
  orderNo?: string;
  orderStatuses: OrderStatus[];
  productionStatuses: OrderProductionFilterStatus[];
}>({
  orderStatuses: orderStatusOptions.map((option) => option.value),
  productionStatuses: productionStatusOptions.map((option) => option.value)
});

const orderForm = reactive<{
  customerId: string;
  orderNo: string;
  orderDate: string;
  deliveryDate: string;
  lines: CreateOrderLinePayload[];
}>({
  customerId: '',
  orderNo: '',
  orderDate: '',
  deliveryDate: '',
  lines: []
});
const orderNoTouched = ref(false);
const generatingOrderNo = ref(false);
const checkingOrderNo = ref(false);
const orderNoAvailable = ref(false);
const orderNoCheckText = ref('');
const cancelOrderForm = reactive({
  cancelAt: '',
  managerName: '',
  productionCancelState: 'NOT_PRODUCED' as 'NOT_PRODUCED' | 'PRODUCED',
  reason: ''
});
type CancelHandlingMode = '' | 'STOCK' | 'SCRAP' | 'NONE';
type CancelHandlingPlanRow = {
  orderLineId: string;
  productionTaskNo: string;
  partCode: string;
  partName: string;
  plannedQuantity: number;
  completedQuantity: number;
  unit: string;
  handlingMode: CancelHandlingMode;
  handlingQuantity: number;
  remark: string;
};
const cancelHandlingPlanRows = ref<CancelHandlingPlanRow[]>([]);
let orderNoCheckTimer: ReturnType<typeof window.setTimeout> | undefined;
let orderNoCheckSequence = 0;

const activeCustomers = computed(() => customers.value.filter((item) => item.status === 'ENABLED'));
const allOrderStatusesChecked = computed(() => filters.orderStatuses.length === orderStatusOptions.length);
const orderStatusesIndeterminate = computed(
  () => filters.orderStatuses.length > 0 && filters.orderStatuses.length < orderStatusOptions.length
);
const allProductionStatusesChecked = computed(() => filters.productionStatuses.length === productionStatusOptions.length);
const productionStatusesIndeterminate = computed(
  () => filters.productionStatuses.length > 0 && filters.productionStatuses.length < productionStatusOptions.length
);
const orderDurationDaysText = computed(() => {
  if (!orderForm.orderDate || !orderForm.deliveryDate) {
    return '-';
  }
  const start = toDateOnly(orderForm.orderDate);
  const end = toDateOnly(orderForm.deliveryDate);
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (!Number.isFinite(diffDays)) {
    return '-';
  }
  return `${diffDays} 天`;
});

function newLine(index: number): CreateOrderLinePayload {
  return {
    partCode: `P-${Date.now().toString().slice(-4)}-${index + 1}`,
    partName: '',
    drawingNo: '',
    drawingVersion: 'A',
    drawingFileName: '',
    drawingFileUrl: '',
    partThickness: 1,
    partSpecification: '',
    quantity: 1,
    productionPlanQuantity: 1,
    fulfillmentMode: 'PRODUCTION',
    unit: '件',
    deliveryDate: '',
    processSteps: [],
    selectedStockSources: []
  };
}

async function loadCustomers() {
  try {
    customers.value = await erpApi.customers();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户资料加载失败');
  }
}

async function loadOrders() {
  if (filters.orderStatuses.length === 0 || filters.productionStatuses.length === 0) {
    loading.value = false;
    orders.value = [];
    return;
  }
  loading.value = true;
  try {
    const rows = await erpApi.orders({
      customerId: filters.customerId,
      statuses: selectedOrderStatusesForQuery(),
      productionStatuses: selectedProductionStatusesForQuery(),
      dateFrom: dateRange.value[0],
      dateTo: dateRange.value[1]
    });
    // 订单下拉只在当前日期/客户范围内做本地缩小，不反向改变父页面的日期和客户筛选。
    orders.value = filters.orderNo ? rows.filter((item) => item.orderNo === filters.orderNo) : rows;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单列表加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadInventorySummary() {
  try {
    inventorySummary.value = await erpApi.inventorySummary({ status: 'AVAILABLE' });
    return true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '库存汇总加载失败');
    return false;
  }
}

async function loadOrderOptions() {
  try {
    orderOptions.value = await erpApi.orders({
      customerId: filters.customerId,
      dateFrom: dateRange.value[0],
      dateTo: dateRange.value[1]
    });

    if (filters.orderNo && !orderOptions.value.some((item) => item.orderNo === filters.orderNo)) {
      filters.orderNo = undefined;
    }
  } catch (error) {
    orderOptions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '订单选项加载失败');
  }
}

async function handleOrderScopeChange() {
  await loadOrderOptions();
  await loadOrders();
}

async function reset() {
  filters.customerId = undefined;
  filters.orderNo = undefined;
  filters.orderStatuses = orderStatusOptions.map((option) => option.value);
  filters.productionStatuses = productionStatusOptions.map((option) => option.value);
  dateRange.value = [];
  await loadOrderOptions();
  await loadOrders();
}

function toggleAllOrderStatuses(value: string | number | boolean) {
  filters.orderStatuses = value ? orderStatusOptions.map((option) => option.value) : [];
}

function toggleAllProductionStatuses(value: string | number | boolean) {
  filters.productionStatuses = value ? productionStatusOptions.map((option) => option.value) : [];
}

function selectedOrderStatusesForQuery() {
  if (filters.orderStatuses.length === orderStatusOptions.length) {
    return undefined;
  }
  return [...filters.orderStatuses];
}

function selectedProductionStatusesForQuery() {
  if (filters.productionStatuses.length === productionStatusOptions.length) {
    return undefined;
  }
  return [...filters.productionStatuses];
}

function orderProductionStatusValue(order: OrderSummary) {
  return orderDisplayStatus(order);
}

function orderProductionStatusLabel(order: OrderSummary) {
  void order;
  return undefined;
}

function formatOrderQuantity(order: OrderSummary, field: 'totalQuantity' | 'totalProductionPlanQuantity') {
  if (order.quantityByUnit?.length) {
    return order.quantityByUnit.map((row) => formatQuantity(row[field], row.unit)).join(' / ');
  }
  return formatQuantity(order[field], order.unit);
}

async function openCreate() {
  orderForm.customerId = activeCustomers.value[0]?.id || '';
  orderForm.orderNo = '';
  orderForm.orderDate = todayText();
  orderForm.deliveryDate = defaultDeliveryDate(orderForm.orderDate);
  syncOrderDateRangeFromForm();
  orderForm.lines = [newLine(0), newLine(1), newLine(2)];
  orderNoTouched.value = false;
  clearOrderNoCheck();
  if (!(await loadInventorySummary())) {
    return;
  }
  dialogVisible.value = true;
  await generateOrderNo();
}

function addLine() {
  orderForm.lines.push(newLine(orderForm.lines.length));
}

function removeLine(index: number) {
  // 默认仍创建三行零件，操作人员可删除误填行，但订单至少保留一行零件。
  if (orderForm.lines.length > 1) {
    orderForm.lines.splice(index, 1);
    return;
  }
  orderForm.lines = [newLine(0)];
  ElMessage.info('订单至少保留一行，已清空当前零件');
}

async function saveOrder() {
  if (!orderForm.customerId) {
    ElMessage.warning('请选择客户');
    return;
  }
  if (!orderForm.orderNo.trim()) {
    ElMessage.warning('请填写订单号');
    return;
  }
  if (orderForm.lines.length === 0) {
    ElMessage.warning('订单至少需要一个零件');
    return;
  }
  if (
    orderForm.lines.some(
      (line) =>
        !line.partCode ||
        !line.partName ||
        !line.partThickness ||
        !line.quantity ||
        (line.productionPlanQuantity === undefined || line.productionPlanQuantity === null) ||
        !line.unit
    )
  ) {
    ElMessage.warning('请补齐订单零件、厚度等必填信息');
    return;
  }
  if (!(await loadInventorySummary())) {
    return;
  }
  const stockCheck = validateStockModeLines(orderForm.lines, inventorySummary.value);
  if (!stockCheck.ok) {
    ElMessage.warning(`待提交生产订单可先保存；${stockCheck.message}，提交生产前必须补足`);
  }
  const draftStockCheck = validateDraftStockSourceLines(orderForm.lines);
  if (!draftStockCheck.ok) {
    ElMessage.warning(draftStockCheck.message);
    return;
  }
  if (draftStockCheck.warning) {
    ElMessage.warning(draftStockCheck.warning);
  }
  if (!(await confirmDuplicateDrawingNos(orderForm.lines))) {
    return;
  }
  if (!(await confirmDuplicateDrawingFiles(orderForm.lines))) {
    return;
  }
  if (!(await confirmExistingDrawingNos(orderForm.lines))) {
    return;
  }
  if (!(await confirmExistingDrawingFiles(orderForm.lines))) {
    return;
  }
  if (!(await checkOrderNo(true))) {
    ElMessage.error(orderNoCheckText.value || '订单号已存在，不能保存');
    return;
  }

  saving.value = true;
  try {
    const order = await erpApi.createOrder({
      customerId: orderForm.customerId,
      orderNo: orderForm.orderNo.trim(),
      orderDate: orderForm.orderDate,
      deliveryDate: orderForm.deliveryDate,
      lines: normalizedLines()
    });
    ElMessage.success('订单已保存');
    dialogVisible.value = false;
    await router.push(orderDetailPath(order.orderNo));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单保存失败');
  } finally {
    saving.value = false;
  }
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function defaultDeliveryDate(orderDate: string) {
  const date = orderDate ? new Date(orderDate) : new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

function toDateOnly(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function syncOrderDateRangeFromForm() {
  orderDateRange.value =
    orderForm.orderDate && orderForm.deliveryDate ? [orderForm.orderDate, orderForm.deliveryDate] : [];
}

function clearOrderNoCheck() {
  if (orderNoCheckTimer) {
    window.clearTimeout(orderNoCheckTimer);
    orderNoCheckTimer = undefined;
  }
  orderNoCheckSequence += 1;
  checkingOrderNo.value = false;
  orderNoAvailable.value = false;
  orderNoCheckText.value = '';
}

function handleOrderNoInput() {
  orderNoTouched.value = true;
  scheduleOrderNoCheck();
}

async function handleOrderDateRangeChange(value: string[]) {
  if (!value || value.length !== 2) {
    return;
  }
  orderForm.orderDate = value[0];
  orderForm.deliveryDate = value[1];
  if (!orderNoTouched.value) {
    await generateOrderNo();
  }
}

async function generateOrderNo() {
  generatingOrderNo.value = true;
  try {
    const result = await erpApi.nextOrderNo(orderForm.orderDate);
    // 订单号默认由后端按日期生成，但保留输入框允许手工修改。
    orderForm.orderNo = result.orderNo;
    orderNoTouched.value = false;
    await checkOrderNo(true);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单号生成失败');
  } finally {
    generatingOrderNo.value = false;
  }
}

function scheduleOrderNoCheck() {
  if (orderNoCheckTimer) {
    window.clearTimeout(orderNoCheckTimer);
    orderNoCheckTimer = undefined;
  }
  const orderNo = orderForm.orderNo.trim();
  orderNoAvailable.value = false;
  if (!orderNo) {
    checkingOrderNo.value = false;
    orderNoCheckText.value = '';
    return;
  }
  // 手工修改订单号时自动查重，避免操作人员依赖额外按钮。
  const sequence = ++orderNoCheckSequence;
  checkingOrderNo.value = true;
  orderNoCheckText.value = '正在自动查重...';
  orderNoCheckTimer = window.setTimeout(() => {
    orderNoCheckTimer = undefined;
    void checkOrderNo(true, sequence);
  }, 400);
}

async function checkOrderNo(silent = false, expectedSequence?: number) {
  const orderNo = orderForm.orderNo.trim();
  if (!orderNo) {
    if (!silent) {
      ElMessage.warning('请先填写订单号');
    }
    clearOrderNoCheck();
    return false;
  }

  if (orderNoCheckTimer) {
    window.clearTimeout(orderNoCheckTimer);
    orderNoCheckTimer = undefined;
  }
  const sequence = expectedSequence ?? ++orderNoCheckSequence;
  checkingOrderNo.value = true;
  try {
    const result = await erpApi.checkOrderNo(orderNo);
    if (sequence !== orderNoCheckSequence || orderNo !== orderForm.orderNo.trim()) {
      return result.available;
    }
    orderNoAvailable.value = result.available;
    orderNoCheckText.value = result.available ? '订单号可用' : '订单号已存在，请修改';
    if (!result.available && !silent) {
      ElMessage.warning('订单号已存在，请修改');
    }
    return result.available;
  } catch (error) {
    orderNoAvailable.value = false;
    orderNoCheckText.value = '订单号查重失败，请稍后再试';
    ElMessage.error(error instanceof Error ? error.message : '订单号查重失败');
    return false;
  } finally {
    if (sequence === orderNoCheckSequence) {
      checkingOrderNo.value = false;
    }
  }
}

function syncPlanQuantity(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    line.productionPlanQuantity = Math.max(Number(line.quantity || 0) - selectedStockSourceQuantity(line), 0);
    line.productionPlanOverrideByCode = '';
    line.productionPlanOverrideReason = '';
    return;
  }
  // 客户订单数量变化时只补默认值；少做或多做需要在订单行里填写偏差说明。
  if (line.productionPlanQuantity === undefined || line.productionPlanQuantity === null) {
    line.productionPlanQuantity = line.quantity;
  }
}

function normalizedLines() {
  return orderForm.lines.map((line) => sanitizeOrderLinePayload(line, orderForm.deliveryDate));
}

function goDetail(row: OrderSummary) {
  void router.push(orderDetailPath(row.orderNo));
}

function orderDetailPath(orderNo: string) {
  return `/orders/${encodeURIComponent(orderNo)}`;
}

function goProcess(row: OrderSummary) {
  if (row.status === 'DRAFT') {
    void router.push({ path: '/processes', query: { orderNo: row.orderNo, open: 'edit', returnTo: '/orders' } });
    return;
  }
  if (orderWarehouseActionText(row)) {
    void router.push({ path: '/warehouses', query: { orderNo: row.orderNo, returnTo: '/orders' } });
    return;
  }
  void router.push({ path: '/production', query: { orderNo: row.orderNo, returnTo: '/orders' } });
}

function orderProcessActionText(row: OrderSummary) {
  if (row.status === 'DRAFT') {
    return '提交生产';
  }
  return orderWarehouseActionText(row) || '生产详情';
}

function orderWarehouseActionText(row: OrderSummary) {
  if (row.warehouseStage === 'WAITING_RECEIPT') {
    return '仓库入库';
  }
  if (row.warehouseStage === 'WAITING_SHIPMENT' || row.warehouseStage === 'PARTIAL_SHIPPED') {
    return '仓库发货';
  }
  return '';
}

function canCancelOrder(row: OrderSummary) {
  return row.status !== 'CANCELLED' && row.status !== 'COMPLETED';
}

function cancelOrderDisabledReason(row: OrderSummary) {
  if (row.status === 'COMPLETED') {
    return '已完成订单第一阶段不允许直接取消';
  }
  if (row.status === 'CANCELLED') {
    return '订单已取消';
  }
  return '';
}

async function openCancelOrder(row: OrderSummary) {
  if (!canCancelOrder(row)) {
    ElMessage.warning(cancelOrderDisabledReason(row));
    return;
  }
  activeCancelOrder.value = row;
  activeCancelOrderDetail.value = undefined;
  cancelHandlingPlanRows.value = [];
  cancelOrderForm.cancelAt = formatDateTime(new Date().toISOString());
  cancelOrderForm.managerName = '';
  cancelOrderForm.productionCancelState = 'NOT_PRODUCED';
  cancelOrderForm.reason = '';
  try {
    activeCancelOrderDetail.value = await erpApi.order(row.orderNo);
    cancelHandlingPlanRows.value = buildCancelHandlingPlanRows(activeCancelOrderDetail.value);
    if (cancelHandlingPlanRows.value.length > 0) {
      cancelOrderForm.productionCancelState = 'PRODUCED';
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '取消订单资料加载失败');
    return;
  }
  cancelOrderVisible.value = true;
}

function taskHasProductionProgress(task: OrderLineProductionTask) {
  return task.status !== 'PENDING' || task.completedQuantity > 0;
}

function buildCancelHandlingPlanRows(order: OrderDetail) {
  return order.lines.flatMap((line: OrderLine) =>
    (line.productionTasks || [])
      .filter(taskHasProductionProgress)
      .map((task) => ({
        orderLineId: line.id,
        productionTaskNo: task.productionTaskNo,
        partCode: line.partCode,
        partName: line.partName,
        plannedQuantity: task.plannedQuantity,
        completedQuantity: task.completedQuantity,
        unit: line.unit,
        handlingMode: '' as CancelHandlingMode,
        handlingQuantity: 0,
        remark: ''
      }))
  );
}

function handleCancelHandlingModeChange(row: CancelHandlingPlanRow) {
  if (row.handlingMode === 'NONE') {
    row.handlingQuantity = 0;
    return;
  }
  if (row.handlingQuantity <= 0) {
    row.handlingQuantity = row.completedQuantity > 0 ? row.completedQuantity : row.plannedQuantity;
  }
}

function collectCancelHandlingPlan() {
  if (cancelOrderForm.productionCancelState !== 'PRODUCED') {
    return undefined;
  }
  if (cancelHandlingPlanRows.value.length === 0) {
    ElMessage.warning('已生产取消必须先加载并选择零件处理方式');
    return false;
  }
  for (const row of cancelHandlingPlanRows.value) {
    if (!row.handlingMode) {
      ElMessage.warning(`请选择 ${row.partCode} / ${row.productionTaskNo} 的处理方式`);
      return false;
    }
    if ((row.handlingMode === 'STOCK' || row.handlingMode === 'SCRAP') && row.handlingQuantity <= 0) {
      ElMessage.warning(`请填写 ${row.partCode} / ${row.productionTaskNo} 的处理数量`);
      return false;
    }
    if (row.handlingMode === 'NONE' && !row.remark.trim()) {
      ElMessage.warning(`请填写 ${row.partCode} / ${row.productionTaskNo} 无实物处理说明`);
      return false;
    }
  }
  return cancelHandlingPlanRows.value.map((row) => ({
    orderLineId: row.orderLineId,
    productionTaskNo: row.productionTaskNo,
    handlingMode: row.handlingMode as 'STOCK' | 'SCRAP' | 'NONE',
    handlingQuantity: row.handlingMode === 'NONE' ? 0 : row.handlingQuantity,
    remark: row.remark.trim() || undefined
  }));
}

async function saveCancelOrder() {
  if (!activeCancelOrder.value) {
    return;
  }
  if (!cancelOrderForm.managerName.trim()) {
    ElMessage.warning('请填写管理人员姓名');
    return;
  }
  if (!cancelOrderForm.reason.trim()) {
    ElMessage.warning('请填写取消订单原因');
    return;
  }
  const handlingPlan = collectCancelHandlingPlan();
  if (handlingPlan === false) {
    return;
  }

  saving.value = true;
  try {
    await erpApi.cancelOrder(activeCancelOrder.value.orderNo, {
      reason: cancelOrderForm.reason.trim(),
      managerName: cancelOrderForm.managerName.trim(),
      productionCancelState: cancelOrderForm.productionCancelState,
      handlingPlan
    });
    ElMessage.success('订单已取消');
    cancelOrderVisible.value = false;
    await loadOrders();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '取消订单失败');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadCustomers();
  await loadOrderOptions();
  await loadOrders();
});
</script>

<style scoped>
.order-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.order-no-field {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: min(460px, 100%);
}

.order-no-field .el-input {
  flex: 1 1 180px;
}

.order-no-check {
  width: 100%;
  margin-top: 6px;
  font-size: 12px;
}

.order-no-check.available {
  color: #16a34a;
}

.order-no-check.checking {
  color: #64748b;
}

.order-no-check.duplicated {
  color: #dc2626;
}

.order-date-range-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.order-date-range-field :deep(.el-date-editor) {
  width: min(360px, 100%);
}

.order-duration-text {
  color: #64748b;
  font-size: 13px;
  white-space: nowrap;
}

.dialog-subtitle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0 12px;
}

.dialog-subtitle-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-subtitle-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-subtitle-actions .el-button {
  margin-left: 0;
}

.duplicate-help-button {
  color: #f59e0b;
}

.duplicate-help {
  display: grid;
  gap: 8px;
  color: #334155;
  line-height: 1.6;
}

.duplicate-help p {
  margin: 0;
}

.orders-table-card {
  min-height: 0;
}

.action-tooltip-wrap {
  display: inline-flex;
}

.select-all-checkbox {
  width: 100%;
}

.dialog-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

.form-hint {
  width: 100%;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.cancel-handling-section {
  display: grid;
  gap: 10px;
  margin: 0 0 16px 116px;
}

.cancel-handling-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.cancel-handling-title span {
  color: #64748b;
  font-size: 12px;
}

.cancel-handling-list {
  display: grid;
  gap: 8px;
}

.cancel-handling-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto 130px minmax(180px, 1fr);
  align-items: center;
  gap: 10px;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.cancel-handling-main {
  display: grid;
  gap: 3px;
}

.cancel-handling-main span {
  color: #64748b;
  font-size: 12px;
}

.cancel-handling-quantity {
  width: 130px;
}

@media (max-width: 900px) {
  .order-form-grid {
    grid-template-columns: 1fr;
  }

  .order-no-field,
  .order-date-range-field {
    width: 100%;
  }

  .order-no-field .el-button {
    flex: 1 1 120px;
  }

  .dialog-subtitle {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .dialog-subtitle-actions,
  .dialog-subtitle-actions .el-button {
    width: 100%;
  }

  .dialog-footer-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dialog-footer-actions .el-button {
    width: 100%;
    margin-left: 0;
  }

  .cancel-handling-section {
    margin-left: 0;
  }

  .cancel-handling-title {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .cancel-handling-row {
    grid-template-columns: 1fr;
  }

  .cancel-handling-quantity {
    width: 100%;
  }
}
</style>
