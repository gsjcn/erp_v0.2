<template>
  <el-date-picker
    class="date-range-filter"
    :model-value="normalizedValue"
    type="daterange"
    value-format="YYYY-MM-DD"
    :start-placeholder="startPlaceholder"
    :end-placeholder="endPlaceholder"
    range-separator="-"
    :clearable="clearable"
    :style="{ width }"
    @update:model-value="handleUpdate"
    @change="handleChange"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue?: string[];
    startPlaceholder?: string;
    endPlaceholder?: string;
    clearable?: boolean;
    width?: string;
  }>(),
  {
    startPlaceholder: '开始',
    endPlaceholder: '结束',
    clearable: true,
    width: '200px'
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
  change: [value: string[]];
}>();

const normalizedValue = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []));

function normalizeRange(value: unknown) {
  return Array.isArray(value) ? (value.filter(Boolean) as string[]) : [];
}

function handleUpdate(value: unknown) {
  emit('update:modelValue', normalizeRange(value));
}

function handleChange(value: unknown) {
  emit('change', normalizeRange(value));
}
</script>

<style scoped>
.date-range-filter {
  max-width: 100%;
}

.date-range-filter :deep(.el-range-input) {
  min-width: 0;
  font-size: 13px;
}

.date-range-filter :deep(.el-range-separator) {
  flex: 0 0 18px;
  min-width: 18px;
  padding: 0;
}
</style>
