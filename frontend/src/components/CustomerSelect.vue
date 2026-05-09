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
    default-first-option
    popper-class="customer-select-popper"
    @update:model-value="handleChange"
    @focus="handleFocus"
    @visible-change="handleVisibleChange"
    @clear="handleChange(undefined)"
    :remote-method="searchCustomers"
  >
    <el-option v-for="customer in visibleOptions" :key="customer.id" :label="customerLabel(customer)" :value="customer.id">
      <div class="customer-option">
        <div class="customer-option-main">
          <strong>{{ customer.customerName }}</strong>
          <span>{{ customer.customerCode }}</span>
        </div>
        <small>{{ customerContactText(customer) }}</small>
        <small>{{ customerRegionText(customer) }}</small>
      </div>
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
}>();

const options = ref<Customer[]>([]);
const optionCache = ref<Record<string, Customer>>({});
const loading = ref(false);
let searchSequence = 0;

async function searchCustomers(keyword = '') {
  const requestId = ++searchSequence;
  loading.value = true;
  try {
    const result = await erpApi.customers(keyword.trim(), props.status);
    if (requestId === searchSequence) {
      cacheCustomers(result);
      options.value = result;
    }
  } catch {
    if (requestId === searchSequence) {
      options.value = [];
    }
  } finally {
    if (requestId === searchSequence) {
      loading.value = false;
    }
  }
}

const visibleOptions = computed(() => {
  const rows = new Map(options.value.map((customer) => [customer.id, customer]));
  const selectedCustomer = props.modelValue ? optionCache.value[props.modelValue] : undefined;
  if (selectedCustomer && !rows.has(selectedCustomer.id)) {
    rows.set(selectedCustomer.id, selectedCustomer);
  }
  return [...rows.values()];
});

function cacheCustomers(customers: Customer[]) {
  const next = { ...optionCache.value };
  for (const customer of customers) {
    next[customer.id] = customer;
  }
  optionCache.value = next;
}

function handleChange(value?: string) {
  const nextValue = value || undefined;
  const selectedCustomer = visibleOptions.value.find((customer) => customer.id === nextValue);
  if (selectedCustomer) {
    cacheCustomers([selectedCustomer]);
  }
  emit('update:modelValue', nextValue);
  emit('change', nextValue);
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
  return `${customer.customerName} / ${customer.customerCode}`;
}

function customerContactText(customer: Customer) {
  const contactName = customer.contactName?.trim();
  const contactPhone = customer.contactPhone?.trim();
  if (!contactName && !contactPhone) {
    return customer.status === 'DISABLED' ? '无主要联系人 / 已停用' : '无主要联系人';
  }
  return [contactName, contactPhone].filter(Boolean).join(' / ');
}

function customerRegionText(customer: Customer) {
  const parts =
    customer.regionType === 'OVERSEAS'
      ? [customer.country, customer.state, customer.province, customer.district, customer.city]
      : [customer.country || '中国', customer.province, customer.city, customer.district];
  return parts.filter(Boolean).join(' / ') || '未填写地区';
}

watch(
  () => props.status,
  () => {
    void searchCustomers('');
  }
);

watch(
  () => props.modelValue,
  (value) => {
    if (value && !optionCache.value[value]) {
      void searchCustomers('');
    }
  }
);

onMounted(() => {
  void searchCustomers('');
});
</script>

<style scoped>
.customer-option {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 5px 0;
  overflow: hidden;
  color: #0f172a;
  line-height: 1.35;
}

.customer-option-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.customer-option strong {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.customer-option span,
.customer-option small {
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.customer-select-popper .el-select-dropdown__wrap) {
  max-height: 320px;
}

:global(.customer-select-popper .el-select-dropdown__item) {
  height: auto;
  min-height: 64px;
  padding: 6px 14px;
  line-height: normal;
}

:global(.customer-select-popper .el-select-dropdown__item.is-hovering),
:global(.customer-select-popper .el-select-dropdown__item:hover) {
  background: #f1f5f9;
}

@media (max-width: 900px) {
  .customer-option-main {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  .customer-option span,
  .customer-option small {
    white-space: normal;
  }
}
</style>
