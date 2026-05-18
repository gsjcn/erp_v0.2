<template>
  <el-select
    :model-value="modelValue || undefined"
    :placeholder="placeholder"
    :clearable="clearable"
    :disabled="disabled"
    :loading="loading"
    :style="{ width }"
    filterable
    remote
    reserve-keyword
    popper-class="customer-select-popper"
    :no-data-text="customerEmptyText"
    :no-match-text="customerEmptyText"
    @update:model-value="handleChange"
    @focus="handleFocus"
    @visible-change="handleVisibleChange"
    @clear="handleChange(undefined)"
    :remote-method="searchCustomers"
  >
    <el-option v-for="customer in visibleOptions" :key="customer.id" :label="customerLabel(customer)" :value="customer.id">
      <div class="customer-option">
        <strong>{{ customer.customerName }}</strong>
      </div>
    </el-option>
    <el-option
      v-if="customerTotalCount > 0"
      disabled
      class="customer-select-summary-option"
      :label="customerPageSummary"
      :value="customerPageSummaryValue"
    >
      <div class="customer-select-summary">{{ customerPageSummary }}</div>
    </el-option>
    <el-option
      v-if="customerHasMore"
      :key="loadMoreCustomerValue"
      class="customer-select-load-more-option"
      :label="loading ? '客户加载中' : '加载更多客户'"
      :value="loadMoreCustomerValue"
    >
      <button type="button" class="customer-select-load-more" :disabled="loading" @click.stop.prevent="loadMoreCustomers">
        {{ loading ? '客户加载中' : `加载更多客户（已显示 ${customerPageOffset} / ${customerTotalCount}）` }}
      </button>
    </el-option>
  </el-select>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { erpApi } from '../api/erp';
import type { CommonStatus, Customer } from '../types/erp';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    status?: CommonStatus;
    clearable?: boolean;
    disabled?: boolean;
    width?: string;
  }>(),
  {
    placeholder: '全部客户',
    clearable: true,
    disabled: false,
    width: '220px'
  }
);

const emit = defineEmits<{
  'update:modelValue': [value?: string];
  change: [value?: string];
  'selected-customer-change': [customer?: Customer];
}>();

const options = ref<Customer[]>([]);
const optionCache = ref<Record<string, Customer>>({});
const loading = ref(false);
const loadErrorText = ref('');
const customerSearchKeyword = ref('');
const customerPageOffset = ref(0);
const customerTotalCount = ref(0);
const customerHasMore = ref(false);
const customerPageLimit = 50;
const customerPageSummaryValue = '__CUSTOMER_PAGE_SUMMARY__';
const loadMoreCustomerValue = '__LOAD_MORE_CUSTOMERS__';
let searchSequence = 0;

async function searchCustomers(keyword = '') {
  customerSearchKeyword.value = keyword.trim();
  customerPageOffset.value = 0;
  await loadCustomerPage(false);
}

async function loadCustomerPage(append: boolean) {
  const requestId = ++searchSequence;
  loading.value = true;
  loadErrorText.value = '';
  try {
    const result = await erpApi.customersPage(
      customerSearchKeyword.value,
      props.status || 'ENABLED',
      customerPageLimit,
      append ? customerPageOffset.value : 0
    );
    if (requestId === searchSequence) {
      cacheCustomers(result.items);
      const rows = append ? [...options.value, ...result.items] : result.items;
      options.value = [...new Map(rows.map((customer) => [customer.id, customer])).values()];
      customerTotalCount.value = result.totalCount;
      customerHasMore.value = result.hasMore;
      customerPageOffset.value = result.offset + result.items.length;
      emitSelectedCustomer();
    }
  } catch (error) {
    if (requestId === searchSequence) {
      if (!append) {
        options.value = [];
      }
      customerTotalCount.value = append ? customerTotalCount.value : 0;
      customerHasMore.value = false;
      customerPageOffset.value = append ? customerPageOffset.value : 0;
      loadErrorText.value = error instanceof Error ? error.message : '客户数据加载失败，请确认后端服务已启动';
    }
  } finally {
    if (requestId === searchSequence) {
      loading.value = false;
    }
  }
}

async function loadMoreCustomers() {
  if (loading.value || !customerHasMore.value) {
    return;
  }
  await loadCustomerPage(true);
}

async function loadCustomerById(id: string) {
  const requestId = ++searchSequence;
  loading.value = true;
  loadErrorText.value = '';
  try {
    const customer = await erpApi.customer(id);
    if (requestId === searchSequence) {
      cacheCustomers([customer]);
      options.value = [customer, ...options.value.filter((item) => item.id !== customer.id)];
      emitSelectedCustomer();
    }
  } catch (error) {
    if (requestId === searchSequence) {
      loadErrorText.value = error instanceof Error ? error.message : '客户数据加载失败，请确认后端服务已启动';
    }
  } finally {
    if (requestId === searchSequence) {
      loading.value = false;
    }
  }
}

const customerEmptyText = computed(() => {
  if (loading.value) {
    return '客户加载中';
  }
  if (loadErrorText.value) {
    return loadErrorText.value;
  }
  return '暂无可用客户，请先在客户模块维护启用客户';
});

const visibleOptions = computed(() => {
  const rows = new Map(options.value.map((customer) => [customer.id, customer]));
  const selectedCustomer = props.modelValue ? optionCache.value[props.modelValue] : undefined;
  if (selectedCustomer && !rows.has(selectedCustomer.id)) {
    rows.set(selectedCustomer.id, selectedCustomer);
  }
  return [...rows.values()];
});

const customerPageSummary = computed(() => {
  if (customerTotalCount.value <= 0) {
    return '';
  }
  return `已显示 ${Math.min(customerPageOffset.value, customerTotalCount.value)} / ${customerTotalCount.value} 个客户`;
});

function cacheCustomers(customers: Customer[]) {
  const next = { ...optionCache.value };
  for (const customer of customers) {
    next[customer.id] = customer;
  }
  optionCache.value = next;
}

function handleChange(value?: string) {
  if (value === loadMoreCustomerValue) {
    void loadMoreCustomers();
    return;
  }
  const nextValue = value || undefined;
  const selectedCustomer = visibleOptions.value.find((customer) => customer.id === nextValue);
  if (selectedCustomer) {
    cacheCustomers([selectedCustomer]);
  }
  emit('update:modelValue', nextValue);
  emit('change', nextValue);
  emit('selected-customer-change', selectedCustomer);
}

function emitSelectedCustomer() {
  const selectedCustomer = props.modelValue ? visibleOptions.value.find((customer) => customer.id === props.modelValue) : undefined;
  emit('selected-customer-change', selectedCustomer);
}

function handleFocus() {
  if (options.value.length === 0) {
    void searchCustomers('');
  }
}

function handleVisibleChange(visible: boolean) {
  if (visible) {
    void searchCustomers('');
  }
}

function customerLabel(customer: Customer) {
  return customer.customerName;
}

watch(
  () => props.status,
  () => {
    if (props.modelValue) {
      void loadCustomerById(props.modelValue);
    } else {
      void searchCustomers('');
    }
  }
);

watch(
  () => props.modelValue,
  (value) => {
    if (!value) {
      emit('selected-customer-change', undefined);
    } else if (!optionCache.value[value]) {
      void loadCustomerById(value);
    } else {
      emitSelectedCustomer();
    }
  }
);

onMounted(() => {
  if (props.modelValue) {
    void loadCustomerById(props.modelValue);
  } else {
    void searchCustomers('');
  }
});
</script>

<style scoped>
.customer-option {
  display: flex;
  align-items: center;
  min-height: 44px;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  color: #0f172a;
  line-height: 20px;
}

.customer-option strong {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.customer-select-popper .el-select-dropdown__wrap) {
  max-height: 320px;
}

:global(.customer-select-popper .el-select-dropdown__item) {
  height: auto;
  min-height: 44px;
  padding: 4px 14px;
  line-height: 20px;
}

:global(.customer-select-popper .el-select-dropdown__item.is-hovering),
:global(.customer-select-popper .el-select-dropdown__item:hover) {
  background: #f1f5f9;
}

.customer-select-summary {
  width: 100%;
  color: #64748b;
  font-size: 12px;
  text-align: center;
}

.customer-select-load-more {
  width: 100%;
  min-height: 34px;
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.customer-select-load-more:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .customer-option {
    overflow: visible;
  }

  .customer-option strong {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}

</style>
