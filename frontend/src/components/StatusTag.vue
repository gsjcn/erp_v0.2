<template>
  <el-tag :type="tagType" effect="light" round>{{ label }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  value: string;
  compact?: boolean;
}>();

const labelMap: Record<string, string> = {
  ENABLED: '启用',
  DISABLED: '停用',
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  IN_PRODUCTION: '生产/入库/发货中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  PENDING: '待生产',
  IN_PROGRESS: '生产中',
  READY_TO_COMPLETE: '待确认完成',
  RECEIVED: '已入库',
  AVAILABLE: '可用',
  USED: '已使用',
  ORDER_DRAFT: '待提交生产',
  ORDER_CANCELLED: '已取消',
  WAITING_PRODUCTION: '待生产',
  IN_PRODUCTION_STAGE: '生产中',
  WAITING_RECEIPT: '待入库',
  WAITING_SHIPMENT: '待发货',
  PARTIAL_SHIPPED: '部分发货',
  SHIPPED: '已发货'
};

const typeMap: Record<string, 'success' | 'warning' | 'info' | 'primary' | 'danger'> = {
  ENABLED: 'success',
  DISABLED: 'info',
  DRAFT: 'info',
  SUBMITTED: 'primary',
  IN_PRODUCTION: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  PENDING: 'info',
  IN_PROGRESS: 'warning',
  READY_TO_COMPLETE: 'primary',
  RECEIVED: 'success',
  AVAILABLE: 'success',
  USED: 'info',
  ORDER_DRAFT: 'info',
  ORDER_CANCELLED: 'danger',
  WAITING_PRODUCTION: 'info',
  IN_PRODUCTION_STAGE: 'warning',
  WAITING_RECEIPT: 'warning',
  WAITING_SHIPMENT: 'primary',
  PARTIAL_SHIPPED: 'warning',
  SHIPPED: 'success'
};

const compactLabelMap: Record<string, string> = {
  IN_PRODUCTION: '进行中',
  CANCELLED: '已取消',
  ORDER_CANCELLED: '已取消',
  IN_PRODUCTION_STAGE: '生产中',
  READY_TO_COMPLETE: '待确认',
  RECEIVED: '已入库',
  WAITING_RECEIPT: '待入库',
  WAITING_SHIPMENT: '待发货',
  PARTIAL_SHIPPED: '部分发货'
};

const label = computed(() => (props.compact ? compactLabelMap[props.value] : undefined) || labelMap[props.value] || props.value);
const tagType = computed(() => typeMap[props.value] || 'info');
</script>
