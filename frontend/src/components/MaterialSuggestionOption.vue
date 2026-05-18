<template>
  <div class="material-suggestion">
    <div class="material-suggestion-main">
      <strong>{{ item.partCode }}</strong>
      <span>{{ item.partName }}</span>
    </div>
    <small v-if="drawingText" class="material-suggestion-identity">{{ drawingText }}</small>
    <small v-if="identityWarningText" class="material-suggestion-warning">{{ identityWarningText }}</small>
    <small>{{ inventoryText }}</small>
    <small v-if="baseInfoText" :title="baseInfoTooltipText">{{ baseInfoText }}</small>
    <small v-if="matchText">{{ matchText }}</small>
    <small v-if="historyText" :title="historyTooltipText">{{ historyText }}</small>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { InventoryMaterialSuggestion } from '../types/erp';
import { formatQuantity } from '../utils/format';

const props = withDefaults(
  defineProps<{
    item: InventoryMaterialSuggestion;
    showAvailable?: boolean;
    availableScopeLabel?: string;
  }>(),
  {
    showAvailable: false,
    availableScopeLabel: '全部仓库'
  }
);

const inventoryText = computed(() => {
  const parts = [
    props.showAvailable ? `${props.availableScopeLabel}可用 ${formatQuantity(props.item.availableQuantity, props.item.unit)}` : '',
    `备货 ${formatQuantity(props.item.stockInventoryQuantity, props.item.unit)}`,
    props.item.orderInventoryQuantity ? `订单库存 ${formatQuantity(props.item.orderInventoryQuantity, props.item.unit)}` : ''
  ].filter(Boolean);
  return parts.join(' / ');
});

const baseInfoText = computed(() => {
  const parts = [
    props.item.unit ? `单位 ${props.item.unit}` : '',
    props.item.partSpecification ? `规格 ${props.item.partSpecification}` : '',
    props.item.defaultProcessRoute ? `默认工艺 ${formatProcessRoutePreview(props.item.defaultProcessRoute)}` : '',
    props.item.historyUsageCount ? `历史使用 ${props.item.historyUsageCount} 次` : ''
  ].filter(Boolean);
  return parts.join(' / ');
});

const baseInfoTooltipText = computed(() => {
  const parts = [
    props.item.unit ? `单位 ${props.item.unit}` : '',
    props.item.partSpecification ? `规格 ${props.item.partSpecification}` : '',
    props.item.defaultProcessRoute ? `默认工艺 ${fullProcessRouteText(props.item.defaultProcessRoute)}` : '',
    props.item.historyUsageCount ? `历史使用 ${props.item.historyUsageCount} 次` : ''
  ].filter(Boolean);
  return parts.join(' / ');
});

const identityWarningText = computed(() => {
  if (!props.item.hasIdentityConflict) {
    return '';
  }
  const fields = props.item.identityConflictFields?.length
    ? props.item.identityConflictFields.join('/')
    : '图号/规格/厚度/项目型号';
  return `同编码 ${props.item.identityVariantCount || '多'} 套历史资料，请核对${fields}`;
});

const matchText = computed(() => {
  const parts = [
    props.item.searchMatchText || '',
    props.item.matchedCustomerName
      ? `客户 ${props.item.matchedCustomerName}${props.item.matchedCustomerCode ? `（${props.item.matchedCustomerCode}）` : ''}`
      : '',
    props.item.matchedHistoryOrderNo ? `历史订单 ${props.item.matchedHistoryOrderNo}` : '',
    props.item.matchedBatchNo ? `命中批次 ${props.item.matchedBatchNo}` : '',
    props.item.matchedSourceOrderNo ? `来源订单 ${props.item.matchedSourceOrderNo}` : '',
    props.item.matchedProductionTaskNo ? `来源任务 ${props.item.matchedProductionTaskNo}` : ''
  ].filter(Boolean);
  return parts.join(' / ');
});

const historyCustomerText = computed(() => {
  const names = props.item.historyCustomerNames || [];
  const count = props.item.historyCustomerCount ?? names.length;
  if (count === 0) {
    return '';
  }
  return `历史客户 ${formatCustomerNamePreview(names, '-', count)}`;
});

const historyCustomerTitle = computed(() => {
  const names = props.item.historyCustomerNames || [];
  const count = props.item.historyCustomerCount ?? names.length;
  return count ? `历史客户摘要：${formatCustomerNamePreview(names, '-', count)}。仅用于搜索记忆，不代表正式适用范围。` : '';
});

const historyText = computed(() => {
  const parts = [
    props.item.hasCurrentCustomerHistory ? '当前客户历史' : '',
    props.item.customerUsageCount ? `当前客户用过 ${props.item.customerUsageCount} 次` : '',
    props.item.lastCustomerOrderNo
      ? `最近订单 ${props.item.lastCustomerOrderNo}${props.item.lastCustomerOrderDate ? ` / ${props.item.lastCustomerOrderDate}` : ''}${
          props.item.lastCustomerCode ? ` / ${props.item.lastCustomerCode}` : ''
        }`
      : '',
    historyCustomerText.value
  ].filter(Boolean);
  return parts.join(' / ');
});

const historyTooltipText = computed(() => {
  return [historyText.value, historyCustomerTitle.value].filter(Boolean).join(' / ');
});

const drawingText = computed(() => {
  const parts = [
    props.item.projectModel ? `型号 ${props.item.projectModel}` : '',
    props.item.drawingNo ? `图号 ${props.item.drawingNo}` : '',
    props.item.drawingVersion ? `版本 ${props.item.drawingVersion}` : '',
    props.item.partThickness ? `厚 ${formatQuantity(props.item.partThickness, 'mm')}` : '',
    props.item.drawingDate ? `日期 ${props.item.drawingDate}` : '',
    props.item.drawingStatus ? `图纸 ${props.item.drawingStatus}` : '',
    props.item.drawingFileName ? `文件 ${props.item.drawingFileName}` : ''
  ].filter(Boolean);
  return parts.join(' / ');
});

function formatCustomerNamePreview(names: Array<string | null | undefined>, emptyText = '-', totalCount?: number) {
  const filtered = names.map((name) => String(name || '').trim()).filter(Boolean);
  const count = Math.max(totalCount ?? filtered.length, filtered.length);
  if (count === 0) {
    return emptyText;
  }
  const preview = filtered.filter((_, index) => index < 3).join('、');
  if (!preview) {
    return `${count} 个客户`;
  }
  return count > 3 ? `${preview} 等 ${count} 个客户` : preview;
}

function formatProcessRoutePreview(value?: string | null, emptyText = '-') {
  const routeText = String(value || '').trim();
  if (!routeText) {
    return emptyText;
  }
  const steps = routeText
    .split(/(?:->|→|[、,，;；\n\r]+)/)
    .map((step) => step.trim())
    .filter(Boolean);
  if (steps.length === 0) {
    return emptyText;
  }
  const preview = steps.filter((_, index) => index < 3).join('、');
  return steps.length > 3 ? `${preview} 等 ${steps.length} 个工序` : preview;
}

function fullProcessRouteText(value?: string | null) {
  return String(value || '').trim();
}
</script>

<style scoped>
.material-suggestion {
  display: grid;
  gap: 2px;
  padding: 4px 0;
  line-height: 18px;
}

.material-suggestion-main {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.material-suggestion strong {
  color: #0f172a;
  font-size: 13px;
  white-space: nowrap;
}

.material-suggestion span {
  min-width: 0;
  overflow: hidden;
  color: #334155;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-suggestion small {
  color: #64748b;
  font-size: 12px;
  white-space: normal;
}

.material-suggestion-identity {
  color: #334155;
  font-weight: 600;
}

.material-suggestion-warning {
  color: #b45309;
  font-weight: 600;
}
</style>
