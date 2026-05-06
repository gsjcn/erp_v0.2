<template>
  <el-tag :type="tagType" effect="light" round>{{ label }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  value: string;
}>();

const labelMap: Record<string, string> = {
  ENABLED: '启用',
  DISABLED: '停用',
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  IN_PRODUCTION: '生产/入库/发货中',
  COMPLETED: '已完成',
  PENDING: '待生产',
  IN_PROGRESS: '生产中',
  AVAILABLE: '可用',
  USED: '已使用'
};

const typeMap: Record<string, 'success' | 'warning' | 'info' | 'primary' | 'danger'> = {
  ENABLED: 'success',
  DISABLED: 'info',
  DRAFT: 'info',
  SUBMITTED: 'primary',
  IN_PRODUCTION: 'warning',
  COMPLETED: 'success',
  PENDING: 'info',
  IN_PROGRESS: 'warning',
  AVAILABLE: 'success',
  USED: 'info'
};

const label = computed(() => labelMap[props.value] || props.value);
const tagType = computed(() => typeMap[props.value] || 'info');
</script>
