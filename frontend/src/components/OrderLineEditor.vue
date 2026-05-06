<template>
  <el-table class="desktop-table" :data="lines" border>
    <el-table-column label="零件编码" min-width="130">
      <template #default="{ row }"><el-input v-model="row.partCode" /></template>
    </el-table-column>
    <el-table-column label="零件名称" min-width="160">
      <template #default="{ row }"><el-input v-model="row.partName" /></template>
    </el-table-column>
    <el-table-column label="图号" min-width="130">
      <template #default="{ row }"><el-input v-model="row.drawingNo" /></template>
    </el-table-column>
    <el-table-column label="零件交期" width="150">
      <template #default="{ row }">
        <el-date-picker
          v-model="row.deliveryDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="默认订单交期"
          style="width: 132px"
        />
      </template>
    </el-table-column>
    <el-table-column label="客户订单数量" width="150">
      <template #default="{ row }">
        <el-input-number
          v-model="row.quantity"
          :min="1"
          :controls="false"
          style="width: 110px"
          @change="emitQuantityChange(row)"
        />
      </template>
    </el-table-column>
    <el-table-column label="生产计划数量" width="150">
      <template #default="{ row }">
        <el-input-number v-model="row.productionPlanQuantity" :min="row.quantity || 1" :controls="false" style="width: 110px" />
      </template>
    </el-table-column>
    <el-table-column label="单位" width="100">
      <template #default="{ row }"><el-input v-model="row.unit" /></template>
    </el-table-column>
    <el-table-column label="操作" width="90">
      <template #default="{ $index }">
        <el-button link :disabled="lines.length <= minLines" @click="emitRemove($index)">删除</el-button>
      </template>
    </el-table-column>
  </el-table>

  <div class="mobile-section order-line-mobile">
    <article v-for="(line, index) in lines" :key="`${index}-${line.partCode}`" class="mobile-card order-line-card">
      <div class="mobile-card-header">
        <div class="mobile-card-title">
          <strong>零件 {{ index + 1 }}</strong>
          <small>默认交期：{{ defaultDeliveryDate || '-' }}</small>
        </div>
        <el-button link :disabled="lines.length <= minLines" @click="emitRemove(index)">删除</el-button>
      </div>

      <div class="order-line-mobile-fields">
        <label>
          <span>零件编码</span>
          <el-input v-model="line.partCode" />
        </label>
        <label>
          <span>零件名称</span>
          <el-input v-model="line.partName" />
        </label>
        <label>
          <span>图号</span>
          <el-input v-model="line.drawingNo" />
        </label>
        <label>
          <span>零件交期</span>
          <el-date-picker
            v-model="line.deliveryDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="默认订单交期"
          />
        </label>
        <label>
          <span>客户订单数量</span>
          <el-input-number v-model="line.quantity" :min="1" :controls="false" @change="emitQuantityChange(line)" />
        </label>
        <label>
          <span>生产计划数量</span>
          <el-input-number v-model="line.productionPlanQuantity" :min="line.quantity || 1" :controls="false" />
        </label>
        <label>
          <span>单位</span>
          <el-input v-model="line.unit" />
        </label>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import type { CreateOrderLinePayload } from '../api/erp';

withDefaults(
  defineProps<{
    lines: CreateOrderLinePayload[];
    minLines?: number;
    defaultDeliveryDate?: string;
  }>(),
  {
    minLines: 3,
    defaultDeliveryDate: ''
  }
);

const emit = defineEmits<{
  remove: [index: number];
  quantityChange: [line: CreateOrderLinePayload];
}>();

function emitRemove(index: number) {
  emit('remove', index);
}

function emitQuantityChange(line: CreateOrderLinePayload) {
  // 客户订单数量变化时由父页面统一同步生产计划数量，避免创建和编辑逻辑分叉。
  emit('quantityChange', line);
}
</script>

<style scoped>
.order-line-mobile {
  margin-top: 0;
}

.order-line-card {
  padding: 12px;
}

.order-line-mobile-fields {
  display: grid;
  gap: 10px;
}

.order-line-mobile-fields label {
  display: grid;
  gap: 6px;
  color: #64748b;
  font-size: 12px;
}

.order-line-mobile-fields :deep(.el-input),
.order-line-mobile-fields :deep(.el-input-number),
.order-line-mobile-fields :deep(.el-date-editor) {
  width: 100% !important;
}
</style>
