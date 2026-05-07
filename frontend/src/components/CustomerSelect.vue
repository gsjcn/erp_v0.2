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
    default-first-option
    popper-class="customer-select-popper"
    @update:model-value="handleChange"
    @focus="handleFocus"
    @visible-change="handleVisibleChange"
    @clear="handleChange(undefined)"
    :remote-method="searchCustomers"
  >
    <el-option v-for="customer in options" :key="customer.id" :label="customerLabel(customer)" :value="customer.id">
      <div class="customer-option">
        {{ customer.customerName }}
      </div>
    </el-option>
  </el-select>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
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
const loading = ref(false);
let searchSequence = 0;

async function searchCustomers(keyword = '') {
  const requestId = ++searchSequence;
  loading.value = true;
  try {
    const result = await erpApi.customers(keyword.trim(), props.status);
    if (requestId === searchSequence) {
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

function handleChange(value?: string) {
  const nextValue = value || undefined;
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
  return customer.customerName;
}

watch(
  () => props.status,
  () => {
    void searchCustomers('');
  }
);

onMounted(() => {
  void searchCustomers('');
});
</script>

<style scoped>
.customer-option {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 40px;
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.customer-select-popper .el-select-dropdown__wrap) {
  max-height: 320px;
}

:global(.customer-select-popper .el-select-dropdown__item) {
  height: 44px;
  min-height: 44px;
  padding: 0 14px;
  line-height: 44px;
}

:global(.customer-select-popper .el-select-dropdown__item.is-hovering),
:global(.customer-select-popper .el-select-dropdown__item:hover) {
  background: #f1f5f9;
}
</style>
