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
          popper-class="material-suggestion-popper"
          @input="handlePartCodeInput(row)"
          @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(row, item)"
        >
          <template #default="{ item }">
            <div class="material-suggestion">
              <strong>{{ item.partCode }}</strong>
              <span>{{ item.partName }}</span>
              <small>库存 {{ formatQuantity(item.stockInventoryQuantity, item.unit) }}</small>
              <small v-if="materialSuggestionMatchText(item)">{{ materialSuggestionMatchText(item) }}</small>
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
        <el-select v-model="row.fulfillmentMode" placeholder="选择方式" @change="handleFulfillmentModeChange(row)">
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
          <el-button class="stock-detail-button" link type="primary" @click="openStockDetails(row)">
            {{ stockSourceActionText(row) }}
          </el-button>
          <el-tooltip
            v-if="stockSourceReviewRequired(row)"
            :content="stockSourceReviewHint(row)"
            placement="top"
          >
            <el-tag :type="isStockSourceReviewed(row) ? 'success' : 'warning'" effect="plain">
              {{ isStockSourceReviewed(row) ? '已核对来源' : '未核对来源' }}
            </el-tag>
          </el-tooltip>
          <el-tooltip v-if="selectedSourceSummary(row)" :content="selectedSourceSummary(row)" placement="top">
            <small class="selected-source-summary">
              {{ selectedSourceSummary(row) }}
            </small>
          </el-tooltip>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="厚度(mm)*" width="120">
      <template #default="{ row }">
        <el-input-number
          v-model="row.partThickness"
          :min="0.001"
          :precision="3"
          :controls="false"
          style="width: 96px"
          @change="handleStockComparableChange(row)"
        />
      </template>
    </el-table-column>
    <el-table-column label="成品规格" width="190">
      <template #default="{ row }">
        <el-select
          v-model="row.partSpecification"
          filterable
          allow-create
          default-first-option
          placeholder="例如 120mm x 204mm x 10mm"
          @change="handleStockComparableChange(row)"
        >
          <el-option v-for="item in specificationOptions" :key="item" :label="item" :value="item" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="图号" width="130">
      <template #default="{ row }"><el-input v-model="row.drawingNo" @input="handleStockComparableChange(row)" /></template>
    </el-table-column>
    <el-table-column label="版本" width="90">
      <template #default="{ row }"><el-input v-model="row.drawingVersion" placeholder="A" @input="handleStockComparableChange(row)" /></template>
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
          :controls="false"
          style="width: 110px"
          @change="handlePlanQuantityChange(row)"
        />
        <small v-if="stockProductionPlanHint(row)" class="stock-plan-hint">
          {{ stockProductionPlanHint(row) }}
        </small>
      </template>
    </el-table-column>
    <el-table-column label="计划偏差说明" width="260">
      <template #default="{ row }">
        <div v-if="stockProductionPlanDiffers(row)" class="plan-override-cell">
          <el-input v-model="row.productionPlanOverrideByCode" size="small" placeholder="操作人员账号" />
          <el-input
            v-model="row.productionPlanOverrideReason"
            size="small"
            type="textarea"
            :rows="2"
            placeholder="备货、替代品、客户确认少做或需多做备件"
          />
        </div>
        <span v-else class="muted">-</span>
      </template>
    </el-table-column>
    <el-table-column label="单位" width="100">
      <template #default="{ row }"><el-input v-model="row.unit" @input="handleUnitInput(row)" /></template>
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
            popper-class="material-suggestion-popper"
            @input="handlePartCodeInput(line)"
            @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(line, item)"
          >
            <template #default="{ item }">
              <div class="material-suggestion">
                <strong>{{ item.partCode }}</strong>
                <span>{{ item.partName }}</span>
                <small>库存 {{ formatQuantity(item.stockInventoryQuantity, item.unit) }}</small>
                <small v-if="materialSuggestionMatchText(item)">{{ materialSuggestionMatchText(item) }}</small>
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
          <el-select v-model="line.fulfillmentMode" placeholder="选择方式" @change="handleFulfillmentModeChange(line)">
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
            <el-button class="stock-detail-button" link type="primary" @click="openStockDetails(line)">
              {{ stockSourceActionText(line) }}
            </el-button>
            <el-tooltip
              v-if="stockSourceReviewRequired(line)"
              :content="stockSourceReviewHint(line)"
              placement="top"
            >
              <el-tag :type="isStockSourceReviewed(line) ? 'success' : 'warning'" effect="plain">
                {{ isStockSourceReviewed(line) ? '已核对来源' : '未核对来源' }}
              </el-tag>
            </el-tooltip>
            <el-tooltip v-if="selectedSourceSummary(line)" :content="selectedSourceSummary(line)" placement="top">
              <small class="selected-source-summary">
                {{ selectedSourceSummary(line) }}
              </small>
            </el-tooltip>
          </div>
        </label>
        <label>
          <span>图号</span>
          <el-input v-model="line.drawingNo" @input="handleStockComparableChange(line)" />
        </label>
        <label>
          <span>图纸版本</span>
          <el-input v-model="line.drawingVersion" placeholder="A" @input="handleStockComparableChange(line)" />
        </label>
        <label>
          <span>零件厚度(mm)*</span>
          <el-input-number
            v-model="line.partThickness"
            :min="0.001"
            :precision="3"
            :controls="false"
            @change="handleStockComparableChange(line)"
          />
        </label>
        <label>
          <span>成品规格</span>
          <el-select
            v-model="line.partSpecification"
            filterable
            allow-create
            default-first-option
            placeholder="例如 120mm x 204mm x 10mm"
            @change="handleStockComparableChange(line)"
          >
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
            :controls="false"
            @change="handlePlanQuantityChange(line)"
          />
          <small v-if="stockProductionPlanHint(line)" class="stock-plan-hint">
            {{ stockProductionPlanHint(line) }}
          </small>
        </label>
        <label v-if="stockProductionPlanDiffers(line)">
          <span>计划偏差说明</span>
          <el-input v-model="line.productionPlanOverrideByCode" placeholder="操作人员账号" />
          <el-input
            v-model="line.productionPlanOverrideReason"
            type="textarea"
            :rows="2"
            placeholder="备货、替代品、客户确认少做或需多做备件"
          />
        </label>
        <label>
          <span>单位</span>
          <el-input v-model="line.unit" @input="handleUnitInput(line)" />
        </label>
      </div>
    </article>
  </div>

  <InventorySourceDetailsDialog
    v-model="sourceDetailsVisible"
    :loading="sourceDetailsLoading"
    :detail="sourceDetails"
    :expected="sourceExpected"
    :selected-sources="currentSourceLine?.selectedStockSources || []"
    review-mode
    :reviewed="Boolean(currentSourceLine && isStockSourceReviewed(currentSourceLine))"
    @source-search="loadStockDetailsForPart"
    @selection-change="handleStockSourceSelectionChange"
    @confirm-reviewed="handleStockSourceReviewed"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadRequestOptions } from 'element-plus';
import { Delete } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import type { CreateOrderLinePayload, StockSourceSelectionPayload } from '../api/erp';
import type { InventoryMaterialSuggestion, InventorySourceDetailResponse, InventorySourceExpected, InventorySummaryRow } from '../types/erp';
import DrawingPreviewLink from './DrawingPreviewLink.vue';
import InventorySourceDetailsDialog from './InventorySourceDetailsDialog.vue';
import { confirmUploadDrawingFileName } from '../utils/orderLineDuplicateChecks';
import { formatQuantity } from '../utils/format';
import { availableStockQuantity as getAvailableStockQuantity, matchedStockSummary } from '../utils/orderLineStockChecks';
import {
  isStockSourceReviewed,
  markStockSourceReviewed,
  normalizeSelectedStockSources,
  selectedStockSourceQuantity,
  suggestedProductionPlanQuantity,
  stockSourceRequiredQuantity,
  stockSourceReviewRequired
} from '../utils/stockSourceReview';

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
const sourceDetailsVisible = ref(false);
const sourceDetailsLoading = ref(false);
const sourceDetails = ref<InventorySourceDetailResponse | null>(null);
const sourceExpected = ref<InventorySourceExpected | null>(null);
const currentSourceLine = ref<CreateOrderLinePayload | null>(null);
const materialSuggestionRequestSeq = ref(0);

const emit = defineEmits<{
  remove: [index: number];
  quantityChange: [line: CreateOrderLinePayload];
}>();

const specificationOptions = ['120mm x 204mm x 10mm', '200mm x 300mm x 2mm', '500mm x 800mm x 3mm'];

function emitRemove(index: number) {
  emit('remove', index);
}

function emitQuantityChange(line: CreateOrderLinePayload) {
  invalidateStockSourceReview(line);
  // 客户订单数量变化时由父页面统一同步生产计划数量，避免创建和编辑逻辑分叉。
  emit('quantityChange', line);
}

function productionPlanMin(line: CreateOrderLinePayload) {
  return 0;
}

function handleFulfillmentModeChange(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    syncStockProductionPlanQuantity(line);
    invalidateStockSourceReview(line);
    void openStockDetails(line);
    return;
  }
  if (line.fulfillmentMode === 'REWORK') {
    ensureProductionPlanQuantity(line);
    invalidateStockSourceReview(line);
    void openStockDetails(line);
    return;
  }
  ensureProductionPlanQuantity(line);
  invalidateStockSourceReview(line, true);
  emitQuantityChange(line);
}

function ensureProductionPlanQuantity(line: CreateOrderLinePayload) {
  // 切换生产方式时只补默认值；少做或多做由“计划偏差说明”记录操作人员和原因。
  if (line.productionPlanQuantity === undefined || line.productionPlanQuantity === null) {
    line.productionPlanQuantity = line.quantity || 1;
  }
}

function stockShortageProductionQuantity(line: CreateOrderLinePayload) {
  const customerQuantity = Number(line.quantity || 0);
  const selectedQuantity = selectedStockSourceQuantity(line);
  return Math.max(Math.round((customerQuantity - selectedQuantity + Number.EPSILON) * 1000) / 1000, 0);
}

function syncStockProductionPlanQuantity(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    line.productionPlanQuantity = stockShortageProductionQuantity(line);
    clearProductionPlanOverride(line);
  }
}

function clearProductionPlanOverride(line: CreateOrderLinePayload) {
  line.productionPlanOverrideByCode = '';
  line.productionPlanOverrideByName = '';
  line.productionPlanOverrideByRole = '';
  line.productionPlanOverrideAt = '';
  line.productionPlanOverrideReason = '';
}

function stockProductionPlanDiffers(line: CreateOrderLinePayload) {
  const suggestedQuantity = suggestedProductionPlanQuantity(line);
  const plannedQuantity = Number(line.productionPlanQuantity ?? suggestedQuantity);
  return Math.abs(plannedQuantity - suggestedQuantity) > 0.0001;
}

function invalidateStockSourceReview(line: CreateOrderLinePayload, clearSources = false, markSourcesForRecheck = false) {
  // 零件、数量或使用方式变化后必须重新核对库存来源，防止沿用旧批次记录。
  line.stockSourceReviewed = false;
  line.stockSourceReviewSignature = '';
  line.stockSourceAvailableQuantity = 0;
  line.stockSourceMatchedQuantity = 0;
  if (clearSources) {
    line.selectedStockSources = [];
    return;
  }
  if (markSourcesForRecheck && line.selectedStockSources?.length) {
    line.selectedStockSources = line.selectedStockSources.map((source) => ({
      ...source,
      compatibilityStatus: 'UNKNOWN',
      compatibilityReason: '订单图纸或规格资料已变更，需要重新核对库存来源',
      manualConfirmedBy: undefined,
      manualConfirmedAt: undefined,
      manualConfirmRemark: undefined
    }));
  }
}

function availableStockQuantity(line: CreateOrderLinePayload) {
  return getAvailableStockQuantity(line, props.inventorySummary);
}

function stockRequiredQuantity(line: CreateOrderLinePayload) {
  // STOCK 按客户订单数量占用库存；REWORK 按生产计划数量领料。
  return stockSourceRequiredQuantity(line);
}

function stockDemandKey(line: CreateOrderLinePayload) {
  const summary = matchedStockSummary(line, props.inventorySummary);
  if (summary) {
    return `${summary.partCode.trim().toLocaleLowerCase()}__${summary.unit.trim().toLocaleLowerCase()}`;
  }
  return `${(line.partCode || line.partName || '').trim().toLocaleLowerCase()}__${(line.unit || '件').trim().toLocaleLowerCase()}`;
}

function stockAggregateRequiredQuantity(line: CreateOrderLinePayload) {
  // 同一个订单内相同零件、相同单位的 STOCK / REWORK 需求必须合计校验，避免每行单独看库存时误判够用。
  return stockDemandLines(line).reduce((sum, item) => sum + stockRequiredQuantity(item), 0);
}

function stockAggregateSelectedQuantity(line: CreateOrderLinePayload) {
  return stockDemandLines(line).reduce((sum, item) => sum + selectedStockSourceQuantity(item), 0);
}

function stockDemandLines(line: CreateOrderLinePayload) {
  const key = stockDemandKey(line);
  if (!key.trim()) {
    return [line];
  }
  return props.lines
    .filter((item) => item.fulfillmentMode === 'STOCK' || item.fulfillmentMode === 'REWORK')
    .filter((item) => stockDemandKey(item) === key);
}

function stockGapQuantity(line: CreateOrderLinePayload) {
  if ((line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK') && isStockSourceReviewed(line)) {
    return Math.max(stockAggregateRequiredQuantity(line) - stockAggregateSelectedQuantity(line), 0);
  }
  return Math.max(stockAggregateRequiredQuantity(line) - availableStockQuantity(line), 0);
}

function stockTagType(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    const selectedQuantity = selectedStockSourceQuantity(line);
    if (selectedQuantity > 0) {
      return stockShortageProductionQuantity(line) > 0 ? 'warning' : 'success';
    }
    return availableStockQuantity(line) > 0 ? 'warning' : 'danger';
  }
  if (line.fulfillmentMode === 'REWORK') {
    return stockGapQuantity(line) > 0 ? 'danger' : 'success';
  }
  return availableStockQuantity(line) > 0 ? 'info' : 'warning';
}

function stockStatusHint(line: CreateOrderLinePayload) {
  // 下单时先把备货库存是否足够说清楚，避免保存或提交订单时才发现库存不足。
  const gap = stockGapQuantity(line);
  const requiredQuantity = stockAggregateRequiredQuantity(line);
  if (line.fulfillmentMode === 'STOCK') {
    const selectedQuantity = selectedStockSourceQuantity(line);
    if (selectedQuantity > 0) {
      const shortageQuantity = stockShortageProductionQuantity(line);
      return shortageQuantity > 0
        ? `此零件，客户要求 ${formatQuantity(line.quantity || 0, line.unit || '件')}，库存已有 ${formatQuantity(selectedQuantity, line.unit || '件')}，按需生产 ${formatQuantity(shortageQuantity, line.unit || '件')}`
        : `此零件库存已覆盖客户数量，确认生产后进入待发货`;
    }
    if (isStockSourceReviewed(line)) {
      const matchedQuantity = stockAggregateSelectedQuantity(line);
      return matchedQuantity + 0.0001 >= requiredQuantity
        ? `已选库存 ${formatQuantity(matchedQuantity, line.unit || '件')}，需 ${formatQuantity(requiredQuantity, line.unit || '件')}`
        : `已选库存不足，已选 ${formatQuantity(matchedQuantity, line.unit || '件')}，需 ${formatQuantity(requiredQuantity, line.unit || '件')}`;
    }
    return gap > 0
      ? `当前库存可先使用，缺 ${formatQuantity(gap, line.unit || '件')} 会自动转生产计划`
      : `库存可覆盖客户数量，必须选择库存批次并核对来源`;
  }
  if (line.fulfillmentMode === 'REWORK') {
    if (isStockSourceReviewed(line)) {
      return `已选库存 ${formatQuantity(stockAggregateSelectedQuantity(line), line.unit || '件')}`;
    }
    return gap > 0
      ? `合计领料 ${formatQuantity(requiredQuantity, line.unit || '件')}，缺 ${formatQuantity(gap, line.unit || '件')}`
      : `可领库存再加工，必须选择库存批次并核对来源`;
  }
  return availableStockQuantity(line) > 0 ? '有备货库存' : '无备货库存';
}

function stockProductionPlanHint(line: CreateOrderLinePayload) {
  const suggestedQuantity = suggestedProductionPlanQuantity(line);
  const plannedQuantity = Number(line.productionPlanQuantity ?? suggestedQuantity);
  if (Math.abs(plannedQuantity - suggestedQuantity) > 0.0001) {
    return `建议生产 ${formatQuantity(suggestedQuantity, line.unit || '件')}，当前计划 ${formatQuantity(plannedQuantity, line.unit || '件')}，需填写操作人员和说明`;
  }
  if (line.fulfillmentMode !== 'STOCK') {
    return '';
  }
  const selectedQuantity = selectedStockSourceQuantity(line);
  if (selectedQuantity <= 0) {
    return '选择库存来源后自动计算';
  }
  if (suggestedQuantity <= 0) {
    return `客户要求 ${formatQuantity(line.quantity || 0, line.unit || '件')}，库存已覆盖，不生成生产任务`;
  }
  return `客户要求 ${formatQuantity(line.quantity || 0, line.unit || '件')}，库存已有 ${formatQuantity(selectedQuantity, line.unit || '件')}，按需生产 ${formatQuantity(suggestedQuantity, line.unit || '件')}`;
}

function stockSourceReviewHint(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    return '使用库存提交生产前必须选择具体库存批次，并核对来源订单、任务号、图号、版本、规格、厚度和图纸文件。';
  }
  if (line.fulfillmentMode === 'REWORK') {
    return '库存再加工提交生产前必须选择具体库存批次，核对库存来源并保留记录。';
  }
  return '';
}

function stockSourceActionText(line: CreateOrderLinePayload) {
  if (!stockSourceReviewRequired(line)) {
    return '查看库存来源';
  }
  return isStockSourceReviewed(line) ? '调整库存来源' : '选择库存来源';
}

function formatStockQuantity(line: CreateOrderLinePayload) {
  if ((line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK') && selectedStockSourceQuantity(line) > 0) {
    return `已选 ${formatQuantity(selectedStockSourceQuantity(line), line.unit || '件')}`;
  }
  return formatQuantity(availableStockQuantity(line), line.unit || '件');
}

function selectedSourceSummary(line: CreateOrderLinePayload) {
  const sources = normalizeSelectedStockSources(line);
  if (!sources.length) {
    return '';
  }
  return sources
    .map((source) => {
      const label = source.batchNo || source.partCode || source.batchId;
      const replenishmentMark = selectedSourceReplenishmentText(source);
      const manualMark = source.compatibilityStatus && source.compatibilityStatus !== 'MATCHED' ? ' / 人工确认' : '';
      const sourceMark = replenishmentMark ? ` / ${replenishmentMark}` : '';
      return `${label} ${formatQuantity(source.quantity, source.unit || line.unit || '件')}${sourceMark}${manualMark}`;
    })
    .join('；');
}

function selectedSourceReplenishmentText(source: ReturnType<typeof normalizeSelectedStockSources>[number]) {
  if (source.replenishmentSourceLabel) {
    return source.replenishmentSourceLabel;
  }
  if (!source.replenishmentSourceType) {
    return '';
  }
  const sourceTypeText =
    source.replenishmentSourceType === 'PRODUCTION_SCRAP'
      ? '生产报废补单'
      : source.replenishmentSourceType === 'ORDER_CHANGE'
        ? '订单数量补单'
        : source.replenishmentSourceType;
  return source.replenishmentSourceRequestNo ? `${sourceTypeText}：${source.replenishmentSourceRequestNo}` : sourceTypeText;
}

async function openStockDetails(line: CreateOrderLinePayload) {
  if (!line.partCode?.trim()) {
    ElMessage.warning('请先选择物料编码');
    return;
  }
  currentSourceLine.value = line;
  sourceDetailsVisible.value = true;
  sourceDetailsLoading.value = true;
  sourceDetails.value = null;
  sourceExpected.value = {
    partCode: line.partCode,
    partName: line.partName,
    drawingNo: line.drawingNo,
    drawingVersion: line.drawingVersion,
    drawingFileName: line.drawingFileName,
    drawingFileUrl: line.drawingFileUrl,
    partThickness: line.partThickness,
    partSpecification: line.partSpecification,
    requiredQuantity: stockRequiredQuantity(line),
    unit: line.unit,
    fulfillmentMode: line.fulfillmentMode
  };
  await loadStockDetailsForPart(line.partCode.trim());
}

async function loadStockDetailsForPart(partCode: string) {
  if (!currentSourceLine.value || !partCode.trim()) {
    return;
  }
  sourceDetailsLoading.value = true;
  sourceDetails.value = null;
  try {
    sourceDetails.value = await erpApi.inventoryMaterialSourceDetails(partCode.trim(), {
      unit: currentSourceLine.value.unit,
      sourceType: 'STOCK',
      excludeOrderNo: props.excludeOrderNo
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '库存来源查询失败');
  } finally {
    sourceDetailsLoading.value = false;
  }
}

function handleStockSourceSelectionChange(sources: StockSourceSelectionPayload[]) {
  if (!currentSourceLine.value) {
    return;
  }
  currentSourceLine.value.selectedStockSources = sources;
  currentSourceLine.value.stockSourceReviewed = false;
  currentSourceLine.value.stockSourceReviewSignature = '';
  currentSourceLine.value.stockSourceAvailableQuantity = sources.reduce((sum, source) => sum + Number(source.quantity || 0), 0);
  currentSourceLine.value.stockSourceMatchedQuantity = currentSourceLine.value.stockSourceAvailableQuantity;
  syncStockProductionPlanQuantity(currentSourceLine.value);
}

function handleStockSourceReviewed() {
  if (!currentSourceLine.value) {
    return;
  }
  const selectedQuantity = selectedStockSourceQuantity(currentSourceLine.value);
  if (selectedQuantity <= 0) {
    ElMessage.warning('当前没有可用库存来源，不能确认');
    return;
  }
  if (currentSourceLine.value.fulfillmentMode !== 'STOCK' && selectedQuantity + 0.0001 < stockRequiredQuantity(currentSourceLine.value)) {
    ElMessage.warning('已选库存数量不足，不能确认');
    return;
  }
  syncStockProductionPlanQuantity(currentSourceLine.value);
  currentSourceLine.value.stockSourceAvailableQuantity = selectedQuantity;
  currentSourceLine.value.stockSourceMatchedQuantity = selectedQuantity;
  markStockSourceReviewed(currentSourceLine.value);
  sourceDetailsVisible.value = false;
  ElMessage.success('库存来源已核对');
}

async function queryMaterialSuggestions(keyword: string, callback: (items: InventoryMaterialSuggestion[]) => void) {
  const normalizedKeyword = keyword.trim();
  const requestId = ++materialSuggestionRequestSeq.value;
  callback([]);
  try {
    const result = await erpApi.inventoryMaterialSuggestions(normalizedKeyword);
    if (requestId === materialSuggestionRequestSeq.value) {
      callback(result);
    }
  } catch {
    if (requestId === materialSuggestionRequestSeq.value) {
      callback([]);
    }
  }
}

function selectMaterialSuggestion(line: CreateOrderLinePayload, item: InventoryMaterialSuggestion) {
  invalidateStockSourceReview(line, true);
  line.partCode = item.partCode;
  line.partName = item.partName;
  line.unit = item.unit || line.unit || '件';
  if (!line.partSpecification && item.partSpecification) {
    line.partSpecification = item.partSpecification;
  }
}

function materialSuggestionMatchText(item: InventoryMaterialSuggestion) {
  const parts = [
    item.matchedBatchNo ? `命中批次 ${item.matchedBatchNo}` : '',
    item.matchedSourceOrderNo ? `订单 ${item.matchedSourceOrderNo}` : '',
    item.matchedProductionTaskNo ? `任务 ${item.matchedProductionTaskNo}` : ''
  ].filter(Boolean);
  return parts.join(' / ');
}

function handlePartCodeInput(line: CreateOrderLinePayload) {
  if (line.selectedStockSources?.length || line.stockSourceReviewed) {
    invalidateStockSourceReview(line, true);
  }
}

function handleStockComparableChange(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK' || line.selectedStockSources?.length) {
    invalidateStockSourceReview(line, false, true);
  }
}

function handlePlanQuantityChange(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    if (!stockProductionPlanDiffers(line)) {
      clearProductionPlanOverride(line);
    }
    return;
  }
  if (line.fulfillmentMode === 'REWORK' || line.selectedStockSources?.length) {
    invalidateStockSourceReview(line);
  }
}

function handleUnitInput(line: CreateOrderLinePayload) {
  if (line.selectedStockSources?.length || line.stockSourceReviewed) {
    invalidateStockSourceReview(line, true);
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
    invalidateStockSourceReview(line, false, true);
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

.selected-source-summary {
  display: -webkit-box;
  overflow: hidden;
  max-width: 220px;
  color: #2563eb !important;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.stock-plan-hint {
  display: block;
  margin-top: 4px;
  color: #d97706;
  font-size: 12px;
  line-height: 16px;
}

.plan-override-cell {
  display: grid;
  gap: 6px;
}

.muted {
  color: #94a3b8;
}

.stock-detail-button {
  justify-self: start;
  padding: 0;
  font-size: 12px;
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

:global(.material-suggestion-popper .el-autocomplete-suggestion__wrap) {
  max-height: 340px;
}

:global(.material-suggestion-popper .el-autocomplete-suggestion li) {
  min-height: 58px;
  padding: 6px 14px;
}

@media (max-width: 900px) {
  .stock-status-cell {
    align-items: stretch;
  }

  .stock-status-cell :deep(.el-tag) {
    width: fit-content;
    max-width: 100%;
    white-space: normal;
  }

  .selected-source-summary {
    max-width: 100%;
    -webkit-line-clamp: 3;
  }

  .stock-detail-button {
    justify-self: stretch;
    min-height: 36px;
    border: 1px solid #dbeafe;
    border-radius: 6px;
    background: #f8fbff;
  }

  .drawing-upload-cell :deep(.drawing-preview-button) {
    max-width: 100%;
    white-space: normal;
  }
}
</style>
