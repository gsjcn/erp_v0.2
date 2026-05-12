<template>
  <div class="order-select" :style="{ width }">
    <el-select
      :model-value="modelValue || undefined"
      :placeholder="placeholder"
      :clearable="clearable"
      :disabled="disabled"
      filterable
      reserve-keyword
      popper-class="order-select-popper"
      :filter-method="handleFilter"
      @update:model-value="handleChange"
      @visible-change="handleVisibleChange"
      @clear="handleChange(undefined)"
    >
      <el-option v-for="order in visibleOrders" :key="order.orderNo" :label="order.orderNo" :value="order.orderNo">
        <div class="order-option">
          <div class="order-option-main">
            <strong>{{ order.orderNo }}</strong>
            <StatusTag :value="orderDisplayStatus(order)" compact />
          </div>
          <span>{{ order.customerName }}</span>
          <small>订单 {{ formatDate(order.orderDate) }} / 交期 {{ formatDate(order.deliveryDate) }} / {{ order.partCount }} 个零件</small>
        </div>
      </el-option>
    </el-select>
    <div v-if="selectedOrder" class="order-select-summary">
      {{ selectedOrder.customerName }} / 订单 {{ formatDate(selectedOrder.orderDate) }} / 交期 {{ formatDate(selectedOrder.deliveryDate) }} /
      {{ selectedOrder.partCount }} 个零件
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import StatusTag from './StatusTag.vue';
import type { OrderSummary } from '../types/erp';
import { formatDate } from '../utils/format';
import { orderDisplayStatus } from '../utils/orderStatus';
import { pinyinSearchMatches } from '../utils/pinyinSearch';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    orders: OrderSummary[];
    placeholder?: string;
    clearable?: boolean;
    disabled?: boolean;
    width?: string;
  }>(),
  {
    placeholder: '全部订单',
    clearable: true,
    disabled: false,
    width: '250px'
  }
);

const emit = defineEmits<{
  'update:modelValue': [value?: string];
  change: [value?: string];
}>();

const keyword = ref('');

const selectedOrder = computed(() => props.orders.find((order) => order.orderNo === props.modelValue));

const visibleOrders = computed(() => {
  const normalizedKeyword = normalizeKeyword(keyword.value);
  if (!normalizedKeyword) {
    return props.orders;
  }
  return props.orders.filter((order) => orderMatchesKeyword(order, normalizedKeyword));
});

function handleFilter(value: string) {
  keyword.value = value;
}

function handleVisibleChange(visible: boolean) {
  if (!visible) {
    keyword.value = '';
  }
}

function handleChange(value?: string) {
  const nextValue = value || undefined;
  emit('update:modelValue', nextValue);
  emit('change', nextValue);
}

function orderMatchesKeyword(order: OrderSummary, normalizedKeyword: string) {
  // 订单下拉只在当前日期/客户范围内做轻量本地过滤，不改变父页面筛选范围。
  return pinyinSearchMatches(
    [
      order.orderNo,
      order.customerCode,
      order.customerName,
      order.customerSearchText,
      formatDate(order.orderDate),
      formatDate(order.deliveryDate),
      order.status,
      order.productionStatus,
      order.warehouseStage
    ],
    normalizedKeyword
  );
}

function normalizeKeyword(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_./\\]+/g, '');
}

watch(
  () => props.orders,
  () => {
    if (props.modelValue && !props.orders.some((order) => order.orderNo === props.modelValue)) {
      handleChange(undefined);
    }
  }
);
</script>

<style scoped>
.order-select {
  min-width: 0;
}

.order-select :deep(.el-select) {
  width: 100%;
}

.order-select-summary {
  margin-top: 5px;
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-option {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 5px 0;
  line-height: 1.35;
}

.order-option-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.order-option strong {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  overflow-wrap: anywhere;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-option span,
.order-option small {
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.order-select-popper .el-select-dropdown__wrap) {
  max-height: 320px;
}

:global(.order-select-popper .el-select-dropdown__item) {
  height: auto;
  min-height: 64px;
  padding: 6px 14px;
  line-height: normal;
}

:global(.order-select-popper .el-select-dropdown__item.is-hovering),
:global(.order-select-popper .el-select-dropdown__item:hover) {
  background: #f1f5f9;
}

@media (max-width: 900px) {
  .order-select-summary {
    display: -webkit-box;
    overflow: hidden;
    overflow-wrap: anywhere;
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .order-option-main {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .order-option strong,
  .order-option span,
  .order-option small {
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: anywhere;
    white-space: normal;
  }
}
</style>
