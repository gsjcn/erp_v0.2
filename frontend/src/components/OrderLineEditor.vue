<template>
  <el-table class="desktop-table order-line-table" :data="lines" border>
    <el-table-column label="零件编码" width="130">
      <template #default="{ row }">
        <el-autocomplete
          v-model="row.partCode"
          :fetch-suggestions="queryMaterialSuggestions"
          value-key="partCode"
          placeholder="搜索物料"
          clearable
          @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(row, item)"
        >
          <template #default="{ item }">
            <div class="material-suggestion">
              <strong>{{ item.partCode }}</strong>
              <span>{{ item.partName }}</span>
              <small>库存 {{ formatQuantity(item.stockInventoryQuantity, item.unit) }}</small>
            </div>
          </template>
        </el-autocomplete>
      </template>
    </el-table-column>
    <el-table-column label="零件名称" width="150">
      <template #default="{ row }"><el-input v-model="row.partName" /></template>
    </el-table-column>
    <el-table-column label="库存/生产方式" width="170">
      <template #default="{ row }">
        <el-select v-model="row.fulfillmentMode" @change="handleFulfillmentModeChange(row)">
          <el-option label="重新生产" value="PRODUCTION" />
          <el-option label="使用库存" value="STOCK" />
          <el-option label="库存再加工" value="REWORK" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="当前库存" width="130">
      <template #default="{ row }">
        <div class="stock-status-cell">
          <el-tag :type="stockTagType(row)" effect="plain">
            {{ formatStockQuantity(row) }}
          </el-tag>
          <small :class="{ warning: stockGapQuantity(row) > 0 }">{{ stockStatusHint(row) }}</small>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="厚度(mm)*" width="120">
      <template #default="{ row }">
        <el-input-number v-model="row.partThickness" :min="0.001" :precision="3" :controls="false" style="width: 96px" />
      </template>
    </el-table-column>
    <el-table-column label="成品规格" width="190">
      <template #default="{ row }">
        <el-select v-model="row.partSpecification" filterable allow-create default-first-option placeholder="例如 120mm x 204mm x 10mm">
          <el-option v-for="item in specificationOptions" :key="item" :label="item" :value="item" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="图号" width="130">
      <template #default="{ row }"><el-input v-model="row.drawingNo" /></template>
    </el-table-column>
    <el-table-column label="版本" width="90">
      <template #default="{ row }"><el-input v-model="row.drawingVersion" placeholder="A" /></template>
    </el-table-column>
    <el-table-column label="图纸" width="170">
      <template #default="{ row }">
        <div class="drawing-upload-cell">
          <el-upload :show-file-list="false" :http-request="createUploadRequest(row)" accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf">
            <el-button size="small">上传图纸</el-button>
          </el-upload>
          <DrawingPreviewLink :file-name="row.drawingFileName" :file-url="row.drawingFileUrl" :title="`${row.partName || row.partCode || '零件'} 图纸预览`" />
        </div>
      </template>
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
        <el-input-number
          v-model="row.productionPlanQuantity"
          :min="productionPlanMin(row)"
          :disabled="row.fulfillmentMode === 'STOCK'"
          :controls="false"
          style="width: 110px"
        />
      </template>
    </el-table-column>
    <el-table-column label="单位" width="100">
      <template #default="{ row }"><el-input v-model="row.unit" /></template>
    </el-table-column>
    <el-table-column label="操作" width="96" fixed="right" align="center">
      <template #default="{ $index }">
        <el-button class="line-remove-button" link type="danger" :icon="Delete" @click="emitRemove($index)">
          {{ removeButtonText }}
        </el-button>
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
        <el-button class="line-remove-button" link type="danger" :icon="Delete" @click="emitRemove(index)">
          {{ removeButtonText }}
        </el-button>
      </div>

      <div class="order-line-mobile-fields">
        <label>
          <span>零件编码</span>
          <el-autocomplete
            v-model="line.partCode"
            :fetch-suggestions="queryMaterialSuggestions"
            value-key="partCode"
            placeholder="搜索物料"
            clearable
            @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(line, item)"
          >
            <template #default="{ item }">
              <div class="material-suggestion">
                <strong>{{ item.partCode }}</strong>
                <span>{{ item.partName }}</span>
                <small>库存 {{ formatQuantity(item.stockInventoryQuantity, item.unit) }}</small>
              </div>
            </template>
          </el-autocomplete>
        </label>
        <label>
          <span>零件名称</span>
          <el-input v-model="line.partName" />
        </label>
        <label>
          <span>库存/生产方式</span>
          <el-select v-model="line.fulfillmentMode" @change="handleFulfillmentModeChange(line)">
            <el-option label="重新生产" value="PRODUCTION" />
            <el-option label="使用库存" value="STOCK" />
            <el-option label="库存再加工" value="REWORK" />
          </el-select>
        </label>
        <label>
          <span>当前库存</span>
          <div class="stock-status-cell">
            <el-tag :type="stockTagType(line)" effect="plain">
              {{ formatStockQuantity(line) }}
            </el-tag>
            <small :class="{ warning: stockGapQuantity(line) > 0 }">{{ stockStatusHint(line) }}</small>
          </div>
        </label>
        <label>
          <span>图号</span>
          <el-input v-model="line.drawingNo" />
        </label>
        <label>
          <span>图纸版本</span>
          <el-input v-model="line.drawingVersion" placeholder="A" />
        </label>
        <label>
          <span>零件厚度(mm)*</span>
          <el-input-number v-model="line.partThickness" :min="0.001" :precision="3" :controls="false" />
        </label>
        <label>
          <span>成品规格</span>
          <el-select v-model="line.partSpecification" filterable allow-create default-first-option placeholder="例如 120mm x 204mm x 10mm">
            <el-option v-for="item in specificationOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </label>
        <label>
          <span>图纸上传</span>
          <div class="drawing-upload-cell">
            <el-upload :show-file-list="false" :http-request="createUploadRequest(line)" accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf">
              <el-button>上传图纸</el-button>
            </el-upload>
            <DrawingPreviewLink :file-name="line.drawingFileName" :file-url="line.drawingFileUrl" :title="`${line.partName || line.partCode || '零件'} 图纸预览`" />
          </div>
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
          <el-input-number
            v-model="line.productionPlanQuantity"
            :min="productionPlanMin(line)"
            :disabled="line.fulfillmentMode === 'STOCK'"
            :controls="false"
          />
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
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadRequestOptions } from 'element-plus';
import { Delete } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import type { CreateOrderLinePayload } from '../api/erp';
import type { InventoryMaterialSuggestion, InventorySummaryRow } from '../types/erp';
import DrawingPreviewLink from './DrawingPreviewLink.vue';
import { confirmUploadDrawingFileName } from '../utils/orderLineDuplicateChecks';
import { formatQuantity } from '../utils/format';
import { availableStockQuantity as getAvailableStockQuantity, matchedStockSummary } from '../utils/orderLineStockChecks';

const props = withDefaults(
  defineProps<{
    lines: CreateOrderLinePayload[];
    minLines?: number;
    defaultDeliveryDate?: string;
    excludeOrderNo?: string;
    inventorySummary?: InventorySummaryRow[];
  }>(),
  {
    minLines: 1,
    defaultDeliveryDate: '',
    excludeOrderNo: '',
    inventorySummary: () => []
  }
);

const lines = computed(() => props.lines);
const defaultDeliveryDate = computed(() => props.defaultDeliveryDate);
const removeButtonText = computed(() => (props.lines.length > props.minLines ? '删除' : '清空'));

const emit = defineEmits<{
  remove: [index: number];
  quantityChange: [line: CreateOrderLinePayload];
}>();

const specificationOptions = ['120mm x 204mm x 10mm', '200mm x 300mm x 2mm', '500mm x 800mm x 3mm'];

function emitRemove(index: number) {
  emit('remove', index);
}

function emitQuantityChange(line: CreateOrderLinePayload) {
  // 客户订单数量变化时由父页面统一同步生产计划数量，避免创建和编辑逻辑分叉。
  emit('quantityChange', line);
}

function productionPlanMin(line: CreateOrderLinePayload) {
  return line.fulfillmentMode === 'STOCK' ? 0 : line.quantity || 1;
}

function handleFulfillmentModeChange(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    line.productionPlanQuantity = 0;
    return;
  }
  emitQuantityChange(line);
}

function availableStockQuantity(line: CreateOrderLinePayload) {
  return getAvailableStockQuantity(line, props.inventorySummary);
}

function stockRequiredQuantity(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    return Number(line.quantity || 0);
  }
  if (line.fulfillmentMode === 'REWORK') {
    // 库存再加工按生产计划领料；客户只要 100 件但计划改 200 件时，需要先确认有 200 件备货库存。
    return Number(line.productionPlanQuantity || line.quantity || 0);
  }
  return 0;
}

function stockDemandKey(line: CreateOrderLinePayload) {
  const summary = matchedStockSummary(line, props.inventorySummary);
  if (summary) {
    return `${summary.partCode.trim().toLocaleLowerCase()}__${summary.unit.trim().toLocaleLowerCase()}`;
  }
  return `${(line.partCode || line.partName || '').trim().toLocaleLowerCase()}__${(line.unit || '件').trim().toLocaleLowerCase()}`;
}

function stockAggregateRequiredQuantity(line: CreateOrderLinePayload) {
  const key = stockDemandKey(line);
  if (!key.trim()) {
    return stockRequiredQuantity(line);
  }
  // 同一个订单内相同零件、相同单位的 STOCK / REWORK 需求必须合计校验，避免每行单独看库存时误判够用。
  return props.lines
    .filter((item) => item.fulfillmentMode === 'STOCK' || item.fulfillmentMode === 'REWORK')
    .filter((item) => stockDemandKey(item) === key)
    .reduce((sum, item) => sum + stockRequiredQuantity(item), 0);
}

function stockGapQuantity(line: CreateOrderLinePayload) {
  return Math.max(stockAggregateRequiredQuantity(line) - availableStockQuantity(line), 0);
}

function stockTagType(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK') {
    return stockGapQuantity(line) > 0 ? 'danger' : 'success';
  }
  return availableStockQuantity(line) > 0 ? 'info' : 'warning';
}

function stockStatusHint(line: CreateOrderLinePayload) {
  // 下单时先把备货库存是否足够说清楚，避免保存或提交订单时才发现库存不足。
  const gap = stockGapQuantity(line);
  const requiredQuantity = stockAggregateRequiredQuantity(line);
  if (line.fulfillmentMode === 'STOCK') {
    return gap > 0
      ? `合计需要 ${formatQuantity(requiredQuantity, line.unit || '件')}，缺 ${formatQuantity(gap, line.unit || '件')}`
      : `可用，合计需要 ${formatQuantity(requiredQuantity, line.unit || '件')}`;
  }
  if (line.fulfillmentMode === 'REWORK') {
    return gap > 0
      ? `合计领料 ${formatQuantity(requiredQuantity, line.unit || '件')}，缺 ${formatQuantity(gap, line.unit || '件')}`
      : `可领库存再加工，合计 ${formatQuantity(requiredQuantity, line.unit || '件')}`;
  }
  return availableStockQuantity(line) > 0 ? '有备货库存' : '无备货库存';
}

function formatStockQuantity(line: CreateOrderLinePayload) {
  return formatQuantity(availableStockQuantity(line), line.unit || '件');
}

async function queryMaterialSuggestions(keyword: string, callback: (items: InventoryMaterialSuggestion[]) => void) {
  const normalizedKeyword = keyword.trim();
  try {
    callback(await erpApi.inventoryMaterialSuggestions(normalizedKeyword));
  } catch {
    callback([]);
  }
}

function selectMaterialSuggestion(line: CreateOrderLinePayload, item: InventoryMaterialSuggestion) {
  line.partCode = item.partCode;
  line.partName = item.partName;
  line.unit = item.unit || line.unit || '件';
  if (!line.partSpecification && item.partSpecification) {
    line.partSpecification = item.partSpecification;
  }
}

function createUploadRequest(line: CreateOrderLinePayload) {
  return (options: UploadRequestOptions) => uploadDrawing(options, line);
}

async function uploadDrawing(options: UploadRequestOptions, line: CreateOrderLinePayload) {
  try {
    const file = options.file as File;
    const canUpload = await confirmUploadDrawingFileName(file, props.lines, line, props.excludeOrderNo);
    if (!canUpload) {
      ElMessage.info('已取消图纸上传');
      return;
    }

    const result = await erpApi.uploadDrawing(file);
    // 图纸先上传到后端文件目录，订单保存时只保存文件名和访问地址。
    line.drawingFileName = result.fileName;
    line.drawingFileUrl = result.fileUrl;
    options.onSuccess?.(result);
    ElMessage.success('图纸已上传');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '图纸上传失败');
  }
}

</script>

<style scoped>
.order-line-mobile {
  margin-top: 0;
}

.order-line-table :deep(.el-table__fixed-right) {
  box-shadow: -8px 0 12px rgba(15, 23, 42, 0.08);
}

.order-line-table :deep(.el-table__fixed-right .el-table__cell) {
  background: #ffffff;
}

.line-remove-button {
  color: #dc2626;
  font-weight: 600;
}

.line-remove-button:hover {
  color: #b91c1c;
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
.order-line-mobile-fields :deep(.el-date-editor),
.order-line-mobile-fields :deep(.el-select) {
  width: 100% !important;
}

.drawing-upload-cell {
  display: grid;
  gap: 6px;
}

.stock-status-cell {
  display: grid;
  align-items: start;
  gap: 4px;
}

.stock-status-cell small {
  color: #64748b;
  font-size: 12px;
  line-height: 16px;
}

.stock-status-cell small.warning {
  color: #dc2626;
}

.drawing-upload-cell :deep(.drawing-preview-button) {
  overflow: hidden;
  color: #2563eb;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-suggestion {
  display: grid;
  gap: 2px;
  padding: 4px 0;
  line-height: 18px;
}

.material-suggestion strong {
  color: #0f172a;
  font-size: 13px;
}

.material-suggestion span {
  color: #334155;
  font-size: 13px;
}

.material-suggestion small {
  color: #64748b;
  font-size: 12px;
}
</style>
