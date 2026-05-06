<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">仓库操作</h2>
      <div>
        <el-button @click="openWarehouseDialog">新增仓库</el-button>
        <el-button @click="openLocationDialog">新增库位</el-button>
        <el-button :loading="loading" @click="queryWarehouseWork">刷新</el-button>
      </div>
    </div>

    <div class="filter-bar warehouse-filter">
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
      <el-button type="primary" :loading="loading" @click="queryWarehouseWork">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">待入库</div>
        <div class="stat-value">{{ receipts.length }} 批</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">待发货</div>
        <div class="stat-value">{{ shipments.length }} 批</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">仓库</div>
        <div class="stat-value">{{ warehouses.length }} 个</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">库位</div>
        <div class="stat-value">{{ locationCount }} 个</div>
      </div>
    </div>

    <div class="table-card desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">生产完成待入库</h3>
      </div>
      <el-table v-loading="loading" :data="receipts" max-height="clamp(220px, 26vh, 320px)">
        <el-table-column prop="productionTaskNo" label="完成单号" min-width="190" />
        <el-table-column label="订单号" min-width="170">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column label="订单日期" width="120">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="120">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="170" />
        <el-table-column prop="partName" label="零件" min-width="170" />
        <el-table-column label="完成 / 计划" width="160">
          <template #default="{ row }">
            {{ formatQuantity(row.completedQuantity || row.quantity, row.unit) }} /
            {{ formatQuantity(row.plannedQuantity || row.quantity, row.unit) }}
          </template>
        </el-table-column>
        <el-table-column label="订单入库" width="130">
          <template #default="{ row }">{{ formatQuantity(row.orderReceiptQuantity || row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="多做库存" width="130">
          <template #default="{ row }">
            <span :class="{ 'stock-extra': (row.stockQuantity || 0) > 0 }">
              {{ row.stockQuantity ? formatQuantity(row.stockQuantity, row.unit) : '-' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" width="180">
          <template #default>待选择</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="120" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openConfirm(row)">确认入库</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-section">
      <h3 class="mobile-section-title">生产完成待入库</h3>
      <article v-for="receipt in receipts" :key="receipt.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ receipt.partName }}</strong>
            <small>{{ receipt.productionTaskNo }}</small>
          </div>
          <span class="muted">{{ receipt.status }}</span>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>订单号</label>
            <span><OrderNoLink :order-no="receipt.orderNo" /></span>
          </div>
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ receipt.customerName }}</span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(receipt.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(receipt.deliveryDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>完成 / 计划</label>
            <span>
              {{ formatQuantity(receipt.completedQuantity || receipt.quantity, receipt.unit) }} /
              {{ formatQuantity(receipt.plannedQuantity || receipt.quantity, receipt.unit) }}
            </span>
          </div>
          <div class="mobile-field">
            <label>订单入库</label>
            <span>{{ formatQuantity(receipt.orderReceiptQuantity || receipt.quantity, receipt.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>多做库存</label>
            <span :class="{ 'stock-extra': (receipt.stockQuantity || 0) > 0 }">
              {{ receipt.stockQuantity ? formatQuantity(receipt.stockQuantity, receipt.unit) : '-' }}
            </span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button link type="primary" @click="openConfirm(receipt)">确认入库</el-button>
        </div>
      </article>
      <div v-if="!receipts.length && !loading" class="mobile-empty">暂无待入库任务</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">待发货库存</h3>
      </div>
      <el-table :data="shipments" max-height="clamp(220px, 26vh, 320px)">
        <el-table-column prop="batchNo" label="库存批次" min-width="210" />
        <el-table-column label="订单号" min-width="170">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column label="订单日期" width="120">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="120">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="170" />
        <el-table-column prop="partName" label="零件" min-width="170" />
        <el-table-column label="数量" width="120">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="180">
          <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="120" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="confirmShipment(row)">确认发货</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-section">
      <h3 class="mobile-section-title">待发货库存</h3>
      <article v-for="shipment in shipments" :key="shipment.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ shipment.partName }}</strong>
            <small>{{ shipment.batchNo }}</small>
          </div>
          <span class="muted">{{ shipment.status }}</span>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>订单号</label>
            <span><OrderNoLink :order-no="shipment.orderNo" /></span>
          </div>
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ shipment.customerName || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(shipment.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(shipment.deliveryDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>数量</label>
            <span>{{ formatQuantity(shipment.quantity, shipment.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>仓库 / 库位</label>
            <span>{{ shipment.warehouseName }} / {{ shipment.locationName || '-' }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button link type="primary" @click="confirmShipment(shipment)">确认发货</el-button>
        </div>
      </article>
      <div v-if="!shipments.length && !loading" class="mobile-empty">暂无待发货库存</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">仓库 / 库位</h3>
      </div>
      <el-table :data="warehouseRows" max-height="clamp(220px, 26vh, 320px)">
        <el-table-column prop="warehouseCode" label="仓库编码" width="140" />
        <el-table-column prop="warehouseName" label="仓库名称" min-width="180" />
        <el-table-column prop="locationCode" label="库位编码" width="140" />
        <el-table-column prop="locationName" label="库位名称" width="140" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <StatusTag :value="row.status" />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">仓库 / 库位</h3>
      <article v-for="row in warehouseRows" :key="`${row.warehouseCode}-${row.locationCode}`" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.warehouseName }}</strong>
            <small>{{ row.warehouseCode }}</small>
          </div>
          <StatusTag :value="row.status" />
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>库位编码</label>
            <span>{{ row.locationCode }}</span>
          </div>
          <div class="mobile-field">
            <label>库位名称</label>
            <span>{{ row.locationName }}</span>
          </div>
        </div>
      </article>
      <div v-if="!warehouseRows.length && !loading" class="mobile-empty">暂无库位</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">库存流水</h3>
        <el-segmented v-model="transactionType" :options="transactionOptions" @change="loadTransactions" />
      </div>
      <el-table :data="transactions" max-height="clamp(220px, 26vh, 320px)">
        <el-table-column prop="transactionNo" label="流水号" min-width="210" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">{{ row.transactionType === 'IN' ? '入库' : '出库' }}</template>
        </el-table-column>
        <el-table-column prop="partName" label="零件" min-width="160" />
        <el-table-column label="数量" width="120">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="170">
          <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column label="来源订单" min-width="180">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="160" />
      </el-table>
    </div>

    <div class="mobile-section">
      <div class="mobile-card-header">
        <h3 class="mobile-section-title">库存流水</h3>
        <el-segmented v-model="transactionType" :options="transactionOptions" @change="loadTransactions" />
      </div>
      <article v-for="transaction in transactions" :key="transaction.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ transaction.partName }}</strong>
            <small>{{ transaction.transactionNo }}</small>
          </div>
          <span class="muted">{{ transaction.transactionType === 'IN' ? '入库' : '出库' }}</span>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>数量</label>
            <span>{{ formatQuantity(transaction.quantity, transaction.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>仓库 / 库位</label>
            <span>{{ transaction.warehouseName }} / {{ transaction.locationName || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>来源订单</label>
            <span><OrderNoLink :order-no="transaction.orderNo" /></span>
          </div>
          <div class="mobile-field">
            <label>备注</label>
            <span>{{ transaction.remark || '-' }}</span>
          </div>
        </div>
      </article>
      <div v-if="!transactions.length && !loading" class="mobile-empty">暂无库存流水</div>
    </div>

    <el-dialog v-model="confirmVisible" title="确认入库" width="min(440px, calc(100vw - 32px))">
      <el-form label-width="92px">
        <el-form-item label="零件">
          <strong>{{ activeReceipt?.partName }}</strong>
        </el-form-item>
        <el-form-item label="数量">
          {{ activeReceipt ? formatQuantity(activeReceipt.quantity, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item label="订单入库">
          {{ activeReceipt ? formatQuantity(activeReceipt.orderReceiptQuantity || activeReceipt.quantity, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item v-if="activeReceipt?.stockQuantity" label="多做库存">
          <strong class="stock-extra">{{ formatQuantity(activeReceipt.stockQuantity, activeReceipt.unit) }}</strong>
        </el-form-item>
        <el-form-item label="仓库">
          <el-select v-model="receiptForm.warehouseId" style="width: 260px" @change="resetLocation">
            <el-option v-for="item in warehouses" :key="item.id" :label="item.warehouseName" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="库位">
          <el-select v-model="receiptForm.locationId" style="width: 260px">
            <el-option v-for="item in currentLocations" :key="item.id" :label="item.locationName" :value="item.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="confirmVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmReceipt">确认入库</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="warehouseVisible" title="新增仓库" width="min(420px, calc(100vw - 32px))">
      <el-form label-width="92px">
        <el-form-item label="仓库编码">
          <el-input v-model="warehouseForm.warehouseCode" placeholder="不填则自动生成" />
        </el-form-item>
        <el-form-item label="仓库名称">
          <el-input v-model="warehouseForm.warehouseName" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="warehouseVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveWarehouse">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="locationVisible" title="新增库位" width="min(420px, calc(100vw - 32px))">
      <el-form label-width="92px">
        <el-form-item label="仓库">
          <el-select v-model="locationForm.warehouseId" style="width: 260px">
            <el-option v-for="item in warehouses" :key="item.id" :label="item.warehouseName" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="库位编码">
          <el-input v-model="locationForm.locationCode" />
        </el-form-item>
        <el-form-item label="库位名称">
          <el-input v-model="locationForm.locationName" placeholder="不填则使用库位编码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="locationVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveLocation">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { erpApi } from '../api/erp';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import type { Customer, OrderSummary, Warehouse, WarehouseReceipt, WarehouseShipment, WarehouseTransaction } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';

const customers = ref<Customer[]>([]);
const orderOptions = ref<OrderSummary[]>([]);
const warehouses = ref<Warehouse[]>([]);
const receipts = ref<WarehouseReceipt[]>([]);
const shipments = ref<WarehouseShipment[]>([]);
const transactions = ref<WarehouseTransaction[]>([]);
const dateRange = ref<string[]>([]);
const transactionType = ref<'ALL' | 'IN' | 'OUT'>('ALL');
const loading = ref(false);
const saving = ref(false);
const confirmVisible = ref(false);
const warehouseVisible = ref(false);
const locationVisible = ref(false);
const activeReceipt = ref<WarehouseReceipt>();

const filters = reactive<{
  customerId?: string;
  orderNo?: string;
}>({});
const receiptForm = reactive({
  warehouseId: '',
  locationId: ''
});
const warehouseForm = reactive({
  warehouseCode: '',
  warehouseName: ''
});
const locationForm = reactive({
  warehouseId: '',
  locationCode: '',
  locationName: ''
});
const transactionOptions = [
  { label: '全部', value: 'ALL' },
  { label: '入库', value: 'IN' },
  { label: '出库', value: 'OUT' }
];

const locationCount = computed(() => warehouses.value.reduce((sum, item) => sum + item.locations.length, 0));
const currentLocations = computed(() => warehouses.value.find((item) => item.id === receiptForm.warehouseId)?.locations || []);
const warehouseRows = computed(() =>
  warehouses.value.flatMap((warehouse) =>
    warehouse.locations.map((location) => ({
      warehouseCode: warehouse.warehouseCode,
      warehouseName: warehouse.warehouseName,
      locationCode: location.locationCode,
      locationName: location.locationName,
      status: location.status
    }))
  )
);

function warehouseWorkParams() {
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

async function loadData() {
  loading.value = true;
  try {
    const [warehouseResult, receiptResult, shipmentResult] = await Promise.all([
      erpApi.warehouses(),
      erpApi.pendingReceipts(warehouseWorkParams()),
      erpApi.pendingShipments(warehouseWorkParams())
    ]);
    warehouses.value = warehouseResult;
    receipts.value = receiptResult;
    shipments.value = shipmentResult;
    await loadTransactions();
  } finally {
    loading.value = false;
  }
}

async function queryWarehouseWork() {
  loading.value = true;
  try {
    await loadOrderOptions();
    await loadData();
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
  await queryWarehouseWork();
}

async function loadTransactions() {
  transactions.value = await erpApi.warehouseTransactions(transactionType.value === 'ALL' ? undefined : transactionType.value);
}

function openConfirm(row: WarehouseReceipt) {
  activeReceipt.value = row;
  receiptForm.warehouseId = warehouses.value[0]?.id || '';
  resetLocation();
  confirmVisible.value = true;
}

function resetLocation() {
  receiptForm.locationId = currentLocations.value[0]?.id || '';
}

function openWarehouseDialog() {
  warehouseForm.warehouseCode = '';
  warehouseForm.warehouseName = '';
  warehouseVisible.value = true;
}

function openLocationDialog() {
  locationForm.warehouseId = warehouses.value[0]?.id || '';
  locationForm.locationCode = '';
  locationForm.locationName = '';
  locationVisible.value = true;
}

async function saveWarehouse() {
  if (!warehouseForm.warehouseName.trim()) {
    ElMessage.warning('请填写仓库名称');
    return;
  }

  saving.value = true;
  try {
    await erpApi.createWarehouse({
      warehouseCode: warehouseForm.warehouseCode || undefined,
      warehouseName: warehouseForm.warehouseName
    });
    ElMessage.success('仓库已新增');
    warehouseVisible.value = false;
    await queryWarehouseWork();
  } finally {
    saving.value = false;
  }
}

async function saveLocation() {
  if (!locationForm.warehouseId || !locationForm.locationCode.trim()) {
    ElMessage.warning('请选择仓库并填写库位编码');
    return;
  }

  saving.value = true;
  try {
    await erpApi.createWarehouseLocation(locationForm.warehouseId, {
      locationCode: locationForm.locationCode,
      locationName: locationForm.locationName || undefined
    });
    ElMessage.success('库位已新增');
    locationVisible.value = false;
    await queryWarehouseWork();
  } finally {
    saving.value = false;
  }
}

async function confirmReceipt() {
  if (!activeReceipt.value) {
    return;
  }
  saving.value = true;
  try {
    await erpApi.confirmReceipt(activeReceipt.value.id, receiptForm.warehouseId, receiptForm.locationId);
    ElMessage.success('入库已确认');
    confirmVisible.value = false;
    await queryWarehouseWork();
  } finally {
    saving.value = false;
  }
}

async function confirmShipment(row: WarehouseShipment) {
  saving.value = true;
  try {
    await erpApi.confirmShipment(row.id);
    ElMessage.success('发货已确认，库存已出库');
    await queryWarehouseWork();
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadCustomers();
  await queryWarehouseWork();
});
</script>

<style scoped>
.warehouse-filter {
  align-items: flex-end;
}

.stock-extra {
  color: #d97706;
  font-weight: 600;
}
</style>
