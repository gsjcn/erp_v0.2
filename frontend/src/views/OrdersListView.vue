<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">订单总列表</h2>
      <el-button type="primary" @click="openCreate">新增订单</el-button>
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>客户</label>
        <el-select v-model="filters.customerId" placeholder="全部客户" clearable filterable style="width: 220px">
          <el-option v-for="item in customers" :key="item.id" :label="item.customerName" :value="item.id" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>订单日期</label>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width: 260px"
        />
      </div>
      <div class="filter-field">
        <label>订单状态</label>
        <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 180px">
          <el-option label="草稿" value="DRAFT" />
          <el-option label="已提交" value="SUBMITTED" />
          <el-option label="生产/入库/发货中" value="IN_PRODUCTION" />
          <el-option label="已完成" value="COMPLETED" />
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
          <template #default="{ row }">{{ formatQuantity(row.totalQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="生产计划数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.totalProductionPlanQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="订单状态" width="160">
          <template #default="{ row }">
            <StatusTag :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goProcess(row)">生产流程</el-button>
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
          <StatusTag :value="order.status" />
        </div>
        <div class="mobile-card-fields">
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
            <span>{{ formatQuantity(order.totalQuantity, order.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>生产计划数量</label>
            <span>{{ formatQuantity(order.totalProductionPlanQuantity, order.unit) }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button link type="primary" @click="goDetail(order)">查看明细</el-button>
          <el-button link type="primary" @click="goProcess(order)">生产流程</el-button>
        </div>
      </article>
      <div v-if="!orders.length && !loading" class="mobile-empty">暂无订单</div>
    </div>

    <el-dialog v-model="dialogVisible" title="新增订单" width="min(1080px, calc(100vw - 32px))">
      <el-form label-width="86px">
        <div class="order-form-grid">
          <el-form-item label="客户">
            <el-select v-model="orderForm.customerId" filterable placeholder="选择客户" style="width: 260px">
              <el-option v-for="item in activeCustomers" :key="item.id" :label="item.customerName" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="订单号">
            <div class="order-no-field">
              <el-input v-model="orderForm.orderNo" placeholder="自动生成，可手工修改" @input="handleOrderNoInput" />
              <el-button :loading="generatingOrderNo" @click="generateOrderNo">自动生成</el-button>
              <el-button :loading="checkingOrderNo" @click="checkOrderNo">查重</el-button>
            </div>
            <div v-if="orderNoCheckText" :class="['order-no-check', orderNoAvailable ? 'available' : 'duplicated']">
              {{ orderNoCheckText }}
            </div>
          </el-form-item>
          <el-form-item label="订单日期">
            <el-date-picker v-model="orderForm.orderDate" type="date" value-format="YYYY-MM-DD" @change="handleOrderDateChange" />
          </el-form-item>
          <el-form-item label="交期">
            <el-date-picker v-model="orderForm.deliveryDate" type="date" value-format="YYYY-MM-DD" />
          </el-form-item>
        </div>

        <div class="dialog-subtitle">
          <strong>订单零件</strong>
          <el-button size="small" @click="addLine">新增零件</el-button>
        </div>

        <OrderLineEditor
          :lines="orderForm.lines"
          :default-delivery-date="orderForm.deliveryDate"
          @remove="removeLine"
          @quantity-change="syncPlanQuantity"
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveOrder">保存订单</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { erpApi, type CreateOrderLinePayload } from '../api/erp';
import OrderLineEditor from '../components/OrderLineEditor.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import type { Customer, OrderStatus, OrderSummary } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';

const router = useRouter();
const customers = ref<Customer[]>([]);
const orders = ref<OrderSummary[]>([]);
const dateRange = ref<[string, string] | []>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);

const filters = reactive<{
  customerId?: string;
  status?: OrderStatus;
}>({});

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

const activeCustomers = computed(() => customers.value.filter((item) => item.status === 'ENABLED'));

function newLine(index: number): CreateOrderLinePayload {
  return {
    partCode: `P-${Date.now().toString().slice(-4)}-${index + 1}`,
    partName: '',
    drawingNo: '',
    quantity: 1,
    productionPlanQuantity: 1,
    unit: '件',
    deliveryDate: '',
    processSteps: []
  };
}

async function loadCustomers() {
  customers.value = await erpApi.customers();
}

async function loadOrders() {
  loading.value = true;
  try {
    orders.value = await erpApi.orders({
      customerId: filters.customerId,
      status: filters.status,
      dateFrom: dateRange.value[0],
      dateTo: dateRange.value[1]
    });
  } finally {
    loading.value = false;
  }
}

function reset() {
  filters.customerId = undefined;
  filters.status = undefined;
  dateRange.value = [];
  void loadOrders();
}

async function openCreate() {
  orderForm.customerId = activeCustomers.value[0]?.id || '';
  orderForm.orderNo = '';
  orderForm.orderDate = todayText();
  orderForm.deliveryDate = defaultDeliveryDate(orderForm.orderDate);
  orderForm.lines = [newLine(0), newLine(1), newLine(2)];
  orderNoTouched.value = false;
  clearOrderNoCheck();
  dialogVisible.value = true;
  await generateOrderNo();
}

function addLine() {
  orderForm.lines.push(newLine(orderForm.lines.length));
}

function removeLine(index: number) {
  if (orderForm.lines.length > 3) {
    orderForm.lines.splice(index, 1);
  }
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
  if (
    orderForm.lines.some(
      (line) => !line.partCode || !line.partName || !line.quantity || !line.productionPlanQuantity || !line.unit
    )
  ) {
    ElMessage.warning('请补齐订单零件信息');
    return;
  }
  if (!(await checkOrderNo(true))) {
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
    await router.push(`/orders/${order.orderNo}`);
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

function clearOrderNoCheck() {
  orderNoAvailable.value = false;
  orderNoCheckText.value = '';
}

function handleOrderNoInput() {
  orderNoTouched.value = true;
  clearOrderNoCheck();
}

async function handleOrderDateChange() {
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
    orderNoAvailable.value = true;
    orderNoCheckText.value = '订单号可用';
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单号生成失败');
  } finally {
    generatingOrderNo.value = false;
  }
}

async function checkOrderNo(silent = false) {
  const orderNo = orderForm.orderNo.trim();
  if (!orderNo) {
    if (!silent) {
      ElMessage.warning('请先填写订单号');
    }
    clearOrderNoCheck();
    return false;
  }

  checkingOrderNo.value = true;
  try {
    const result = await erpApi.checkOrderNo(orderNo);
    orderNoAvailable.value = result.available;
    orderNoCheckText.value = result.available ? '订单号可用' : '订单号已存在，请修改';
    if (!result.available && !silent) {
      ElMessage.warning('订单号已存在，请修改');
    }
    return result.available;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单号查重失败');
    return false;
  } finally {
    checkingOrderNo.value = false;
  }
}

function syncPlanQuantity(line: CreateOrderLinePayload) {
  // 客户订单数量变化时，生产计划不能低于客户订单；仍允许手工改大做库存。
  if (!line.productionPlanQuantity || line.productionPlanQuantity < line.quantity) {
    line.productionPlanQuantity = line.quantity;
  }
}

function normalizedLines() {
  return orderForm.lines.map((line) => ({
    ...line,
    deliveryDate: line.deliveryDate || orderForm.deliveryDate,
    productionPlanQuantity: Math.max(line.productionPlanQuantity || line.quantity, line.quantity)
  }));
}

function goDetail(row: OrderSummary) {
  void router.push(`/orders/${row.orderNo}`);
}

function goProcess(row: OrderSummary) {
  void router.push({ path: '/processes', query: { orderNo: row.orderNo } });
}

onMounted(async () => {
  await loadCustomers();
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

.order-no-check.duplicated {
  color: #dc2626;
}

.dialog-subtitle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0 12px;
}

.orders-table-card {
  min-height: 0;
}

</style>
