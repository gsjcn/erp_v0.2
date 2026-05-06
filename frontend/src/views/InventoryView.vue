<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">库存界面</h2>
      <el-button :loading="loading" @click="loadInventory">刷新</el-button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">库存批次</div>
        <div class="stat-value">{{ inventory.length }} 批</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">可用数量</div>
        <div class="stat-value">{{ availableQuantity }} 件</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">有库存仓库</div>
        <div class="stat-value">{{ stockedWarehouseCount }} 个</div>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>零件 / 客户 / 订单</label>
        <el-input v-model="filters.keyword" placeholder="零件、客户或订单号" style="width: 260px" clearable />
      </div>
      <div class="filter-field">
        <label>仓库</label>
        <el-select v-model="filters.warehouseId" clearable placeholder="全部仓库" style="width: 190px">
          <el-option v-for="item in warehouses" :key="item.id" :label="item.warehouseName" :value="item.id" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>订单号</label>
        <el-input v-model="filters.orderNo" placeholder="sourceOrderNo" style="width: 190px" clearable />
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" clearable placeholder="全部状态" style="width: 150px">
          <el-option label="可用" value="AVAILABLE" />
          <el-option label="已使用" value="USED" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="loadInventory">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <div class="table-card desktop-table">
      <el-table v-loading="loading" :data="inventory" max-height="max(300px, calc(100vh - 390px))">
        <el-table-column prop="batchNo" label="批次号" min-width="210" />
        <el-table-column prop="partCode" label="零件编码" width="140" />
        <el-table-column prop="partName" label="零件名称" min-width="180" />
        <el-table-column label="数量" width="120">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="170">
          <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="sourceCustomerName" label="客户" min-width="180" />
        <el-table-column label="来源订单" min-width="180">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.sourceOrderNo" />
          </template>
        </el-table-column>
        <el-table-column label="订单日期" width="120">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="120">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <StatusTag :value="row.status" />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list">
      <article v-for="batch in inventory" :key="batch.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ batch.partName }}</strong>
            <small>{{ batch.batchNo }}</small>
          </div>
          <StatusTag :value="batch.status" />
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>零件编码</label>
            <span>{{ batch.partCode }}</span>
          </div>
          <div class="mobile-field">
            <label>数量</label>
            <span>{{ formatQuantity(batch.quantity, batch.unit) }}</span>
          </div>
          <div class="mobile-field mobile-full">
            <label>仓库 / 库位</label>
            <span>{{ batch.warehouseName }} / {{ batch.locationName || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ batch.sourceCustomerName || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>来源订单</label>
            <span><OrderNoLink :order-no="batch.sourceOrderNo" /></span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(batch.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(batch.deliveryDate) }}</span>
          </div>
        </div>
      </article>
      <div v-if="!inventory.length && !loading" class="mobile-empty">暂无库存</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { erpApi } from '../api/erp';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import type { InventoryBatch, InventoryStatus, Warehouse } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';

const warehouses = ref<Warehouse[]>([]);
const inventory = ref<InventoryBatch[]>([]);
const loading = ref(false);
const filters = reactive<{
  keyword?: string;
  warehouseId?: string;
  orderNo?: string;
  status?: InventoryStatus;
}>({});

const availableQuantity = computed(() =>
  inventory.value
    .filter((item) => item.status === 'AVAILABLE')
    .reduce((sum, item) => sum + item.quantity, 0)
);
const stockedWarehouseCount = computed(
  () => new Set(inventory.value.filter((item) => item.status === 'AVAILABLE').map((item) => item.warehouseId)).size
);

async function loadWarehouses() {
  warehouses.value = await erpApi.warehouses();
}

async function loadInventory() {
  loading.value = true;
  try {
    inventory.value = await erpApi.inventory(filters);
  } finally {
    loading.value = false;
  }
}

function reset() {
  filters.keyword = undefined;
  filters.warehouseId = undefined;
  filters.orderNo = undefined;
  filters.status = undefined;
  void loadInventory();
}

onMounted(async () => {
  await loadWarehouses();
  await loadInventory();
});
</script>
