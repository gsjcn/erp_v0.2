<template>
  <el-table class="desktop-table order-line-table" :data="lines" border>
    <el-table-column label="行类型" width="104">
      <template #default="{ row }">
        <el-select v-model="row.lineType" placeholder="行类型" @change="handleLineTypeChange(row)">
          <el-option label="零件" value="PART" />
          <el-option label="组件" value="COMPONENT" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="零件类型" width="120">
      <template #default="{ row }">
        <el-select v-model="row.partCategory" clearable filterable placeholder="类型">
          <el-option label="通用件" value="通用件" />
          <el-option label="定制件" value="定制件" />
          <el-option label="数控件" value="数控件" />
          <el-option label="外协件" value="外协件" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="组件编号" width="120">
      <template #default="{ row }">
        <el-input
          v-model="row.componentNo"
          placeholder="组件行填 C001"
          :disabled="row.lineType !== 'COMPONENT'"
          @focus="captureComponentNoBeforeEdit(row)"
          @blur="normalizeComponentFields(row)"
        />
      </template>
    </el-table-column>
    <el-table-column label="所属组件" width="120">
      <template #default="{ row }">
        <el-select
          v-model="row.parentComponentNo"
          clearable
          filterable
          placeholder="选择组件"
          :disabled="row.lineType === 'COMPONENT'"
          @change="normalizeComponentFields(row)"
        >
          <el-option v-for="option in componentOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="零件编码" width="130">
      <template #default="{ row }">
        <el-autocomplete
          v-model="row.partCode"
          :fetch-suggestions="queryMaterialSuggestions"
          value-key="partCode"
          placeholder="编码/名称/拼音/图号/厚度/客户"
          :debounce="250"
          :trigger-on-focus="true"
          clearable
          popper-class="material-suggestion-popper"
          @input="handlePartCodeInput(row)"
          @blur="() => fillExactMaterialFromInput(row, 'partCode')"
          @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(row, item)"
        >
          <template #default="{ item }">
            <MaterialSuggestionOption :item="item" />
          </template>
        </el-autocomplete>
      </template>
    </el-table-column>
    <el-table-column label="零件名称" width="150">
      <template #default="{ row }">
        <div class="material-input-cell">
          <el-autocomplete
            v-model="row.partName"
            :fetch-suggestions="queryMaterialSuggestions"
            value-key="partName"
            placeholder="名称/编码/拼音/图号/厚度/客户"
            :debounce="250"
            :trigger-on-focus="true"
            clearable
            popper-class="material-suggestion-popper"
            @input="handlePartNameInput(row)"
            @blur="() => fillExactMaterialFromInput(row, 'partName')"
            @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(row, item)"
          >
            <template #default="{ item }">
              <MaterialSuggestionOption :item="item" />
            </template>
          </el-autocomplete>
          <small v-if="materialIdentityWarningText(row)" class="material-identity-warning">
            {{ materialIdentityWarningText(row) }}
          </small>
        </div>
      </template>
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
    <div class="order-line-mobile-toolbar">
      <span>订单零件 {{ lines.length }} 项</span>
      <div>
        <el-button size="small" @click="expandAllMobileLineCards">全部展开</el-button>
        <el-button size="small" @click="collapseAllMobileLineCards">全部收起</el-button>
      </div>
    </div>
    <article
      v-for="(line, index) in lines"
      :key="`${index}-${line.partCode}`"
      class="mobile-card order-line-card"
      :class="{ expanded: isMobileLineExpanded(index) }"
    >
      <div class="mobile-card-header">
        <div class="mobile-card-title">
          <strong>零件 {{ index + 1 }}</strong>
          <small>{{ line.partName || line.partCode || '未填写零件资料' }}</small>
        </div>
        <div class="mobile-card-header-actions">
          <el-button link type="primary" @click.stop="toggleMobileLineCard(index)">
            {{ isMobileLineExpanded(index) ? '收起' : '详情' }}
          </el-button>
          <el-button class="line-remove-button" link type="danger" :icon="Delete" @click="emitRemove(index)">
            {{ removeButtonText }}
          </el-button>
        </div>
      </div>

      <div class="mobile-card-compact-summary order-line-compact-summary">
        <span>{{ line.partCode || '未填编码' }}</span>
        <span>{{ fulfillmentModeText(line) }}</span>
        <span>订单 {{ formatQuantity(line.quantity || 0, line.unit || '件') }}</span>
        <span>计划 {{ formatQuantity(line.productionPlanQuantity ?? suggestedProductionPlanQuantity(line), line.unit || '件') }}</span>
        <span>交期 {{ line.deliveryDate || defaultDeliveryDate || '-' }}</span>
        <span v-if="selectedStockSourceQuantity(line) > 0">库存 {{ formatQuantity(selectedStockSourceQuantity(line), line.unit || '件') }}</span>
        <span v-if="stockSourceReviewRequired(line)" :class="isStockSourceReviewed(line) ? 'success' : 'warning'">
          {{ isStockSourceReviewed(line) ? '已核对来源' : '未核对来源' }}
        </span>
        <span v-if="stockProductionPlanDiffers(line)" class="warning">计划偏差待说明</span>
      </div>

      <div v-show="isMobileLineExpanded(index)" class="order-line-mobile-fields">
        <label>
          <span>行类型</span>
          <el-select v-model="line.lineType" placeholder="行类型" @change="handleLineTypeChange(line)">
            <el-option label="零件" value="PART" />
            <el-option label="组件" value="COMPONENT" />
          </el-select>
        </label>
        <label>
          <span>零件类型</span>
          <el-select v-model="line.partCategory" clearable filterable placeholder="类型">
            <el-option label="通用件" value="通用件" />
            <el-option label="定制件" value="定制件" />
            <el-option label="数控件" value="数控件" />
            <el-option label="外协件" value="外协件" />
          </el-select>
        </label>
        <label>
          <span>组件编号</span>
          <el-input
            v-model="line.componentNo"
            placeholder="组件行填 C001"
            :disabled="line.lineType !== 'COMPONENT'"
            @focus="captureComponentNoBeforeEdit(line)"
            @blur="normalizeComponentFields(line)"
          />
        </label>
        <label>
          <span>所属组件</span>
          <el-select
            v-model="line.parentComponentNo"
            clearable
            filterable
            placeholder="选择组件"
            :disabled="line.lineType === 'COMPONENT'"
            @change="normalizeComponentFields(line)"
          >
            <el-option v-for="option in componentOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </label>
        <label>
          <span>零件编码</span>
          <el-autocomplete
            v-model="line.partCode"
            :fetch-suggestions="queryMaterialSuggestions"
            value-key="partCode"
            placeholder="编码/名称/拼音/图号/厚度/客户"
            :debounce="250"
            :trigger-on-focus="true"
            clearable
            popper-class="material-suggestion-popper"
            @input="handlePartCodeInput(line)"
            @blur="() => fillExactMaterialFromInput(line, 'partCode')"
            @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(line, item)"
          >
            <template #default="{ item }">
              <MaterialSuggestionOption :item="item" />
            </template>
          </el-autocomplete>
        </label>
        <label>
          <span>零件名称</span>
          <div class="material-input-cell">
            <el-autocomplete
              v-model="line.partName"
              :fetch-suggestions="queryMaterialSuggestions"
              value-key="partName"
              placeholder="名称/编码/拼音/图号/厚度/客户"
              :debounce="250"
              :trigger-on-focus="true"
              clearable
              popper-class="material-suggestion-popper"
              @input="handlePartNameInput(line)"
              @blur="() => fillExactMaterialFromInput(line, 'partName')"
              @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(line, item)"
            >
              <template #default="{ item }">
                <MaterialSuggestionOption :item="item" />
              </template>
            </el-autocomplete>
            <small v-if="materialIdentityWarningText(line)" class="material-identity-warning">
              {{ materialIdentityWarningText(line) }}
            </small>
          </div>
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
    :draft-reserved-sources="otherLineSelectedStockSources"
    :exclude-order-no="excludeOrderNo"
    :exclude-order-id="excludeOrderId"
    :customer-id="customerId"
    review-mode
    :reviewed="Boolean(currentSourceLine && isStockSourceReviewed(currentSourceLine))"
    @source-search="loadStockDetailsForPart"
    @selection-change="handleStockSourceSelectionChange"
    @confirm-reviewed="handleStockSourceReviewed"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadRequestOptions } from 'element-plus';
import { Delete } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import type { CreateOrderLinePayload, StockSourceSelectionPayload } from '../api/erp';
import type { InventoryMaterialSuggestion, InventorySourceDetailResponse, InventorySourceExpected, InventorySummaryRow } from '../types/erp';
import DrawingPreviewLink from './DrawingPreviewLink.vue';
import InventorySourceDetailsDialog from './InventorySourceDetailsDialog.vue';
import MaterialSuggestionOption from './MaterialSuggestionOption.vue';
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
    componentSourceLines?: Array<Pick<CreateOrderLinePayload, 'lineType' | 'componentNo' | 'partName' | 'partCode'>>;
    minLines?: number;
    defaultDeliveryDate?: string;
    customerId?: string;
    excludeOrderNo?: string;
    excludeOrderId?: string;
    inventorySummary?: InventorySummaryRow[];
  }>(),
  {
    componentSourceLines: () => [],
    minLines: 1,
    defaultDeliveryDate: '',
    customerId: '',
    excludeOrderNo: '',
    excludeOrderId: '',
    inventorySummary: () => []
  }
);

const lines = computed(() => props.lines);
const defaultDeliveryDate = computed(() => props.defaultDeliveryDate);
const excludeOrderNo = computed(() => props.excludeOrderNo);
const excludeOrderId = computed(() => props.excludeOrderId);
const removeButtonText = computed(() => (props.lines.length > props.minLines ? '删除' : '清空'));
const sourceDetailsVisible = ref(false);
const sourceDetailsLoading = ref(false);
const sourceDetails = ref<InventorySourceDetailResponse | null>(null);
const sourceExpected = ref<InventorySourceExpected | null>(null);
const currentSourceLine = ref<CreateOrderLinePayload | null>(null);
const stockCoverAutoSyncedLines = new WeakSet<CreateOrderLinePayload>();
const materialSuggestionRequestSeq = ref(0);
const expandedMobileLineIndexes = ref<number[]>([]);
const mobileLineExpansionInitialized = ref(false);
const otherLineSelectedStockSources = computed(() =>
  currentSourceLine.value
    ? props.lines
        .filter((line) => line !== currentSourceLine.value)
        .flatMap((line) => line.selectedStockSources || [])
    : []
);
const componentOptions = computed(() => {
  const seen = new Set<string>();
  return [...props.componentSourceLines, ...props.lines]
    .map((line) => ({
      lineType: line.lineType,
      value: normalizeComponentNo(line.componentNo),
      labelText: line.partName || line.partCode || ''
    }))
    .filter((line) => {
      if (line.lineType !== 'COMPONENT' || !line.value || seen.has(line.value)) {
        return false;
      }
      seen.add(line.value);
      return true;
    })
    .map((line) => ({
      value: line.value,
      label: line.labelText ? `${line.value} | ${line.labelText}` : line.value
    }));
});

const emit = defineEmits<{
  remove: [index: number];
  quantityChange: [line: CreateOrderLinePayload];
}>();

const specificationOptions = ['120mm x 204mm x 10mm', '200mm x 300mm x 2mm', '500mm x 800mm x 3mm'];
type MaterialSuggestionInputField = 'partCode' | 'partName';
type AutoMaterialField =
  | 'partName'
  | 'unit'
  | 'partSpecification'
  | 'drawingNo'
  | 'drawingVersion'
  | 'drawingDate'
  | 'drawingStatus'
  | 'projectModel'
  | 'partThickness';
type AutoMaterialSnapshot = {
  partCode: string;
  partName: string;
  autoFields: Partial<Record<AutoMaterialField, string | number | null | undefined>>;
};
type MaterialIdentityWarning = {
  partCode: string;
  partName: string;
  text: string;
};
const autoMaterialSnapshots = new WeakMap<CreateOrderLinePayload, AutoMaterialSnapshot>();
const materialIdentityWarnings = new WeakMap<CreateOrderLinePayload, MaterialIdentityWarning>();
const materialIdentityWarningVersion = ref(0);
const componentNoEditSnapshots = new WeakMap<CreateOrderLinePayload, string>();

watch(
  () => props.lines.length,
  (length, previousLength = 0) => {
    if (!mobileLineExpansionInitialized.value) {
      expandedMobileLineIndexes.value = length === 1 ? [0] : [];
      mobileLineExpansionInitialized.value = true;
      return;
    }
    const existingIndexes = expandedMobileLineIndexes.value.filter((index) => index < length);
    const startIndex = Math.max(previousLength, 0);
    const addedIndexes = Array.from({ length: Math.max(length - startIndex, 0) }, (_, offset) => startIndex + offset);
    expandedMobileLineIndexes.value = Array.from(new Set([...existingIndexes, ...addedIndexes]));
  },
  { immediate: true }
);

function isMobileLineExpanded(index: number) {
  return expandedMobileLineIndexes.value.includes(index);
}

function toggleMobileLineCard(index: number) {
  expandedMobileLineIndexes.value = isMobileLineExpanded(index)
    ? expandedMobileLineIndexes.value.filter((item) => item !== index)
    : [...expandedMobileLineIndexes.value, index];
}

function expandAllMobileLineCards() {
  expandedMobileLineIndexes.value = props.lines.map((_, index) => index);
}

function collapseAllMobileLineCards() {
  expandedMobileLineIndexes.value = [];
}

function materialIdentityWarningText(line: CreateOrderLinePayload) {
  materialIdentityWarningVersion.value;
  return materialIdentityWarnings.get(line)?.text || '';
}

function materialIdentityConflictFieldsText(item: InventoryMaterialSuggestion, separator = '、') {
  return item.identityConflictFields?.length ? item.identityConflictFields.join(separator) : `图号${separator}规格${separator}厚度${separator}项目型号`;
}

function setMaterialIdentityWarning(line: CreateOrderLinePayload, item: InventoryMaterialSuggestion) {
  if (item.hasIdentityConflict) {
    materialIdentityWarnings.set(line, {
      partCode: item.partCode,
      partName: item.partName,
      text: `同编码 ${item.identityVariantCount || '多'} 套历史资料，核对${materialIdentityConflictFieldsText(item, '/')}`
    });
  } else {
    materialIdentityWarnings.delete(line);
  }
  materialIdentityWarningVersion.value += 1;
}

function clearMaterialIdentityWarning(line: CreateOrderLinePayload) {
  if (!materialIdentityWarnings.has(line)) {
    return;
  }
  materialIdentityWarnings.delete(line);
  materialIdentityWarningVersion.value += 1;
}

function clearMaterialIdentityWarningWhenMaterialIdentityChanges(line: CreateOrderLinePayload) {
  const warning = materialIdentityWarnings.get(line);
  if (!warning) {
    return;
  }
  const partCodeMatches = normalizeMaterialSuggestionValue(line.partCode) === normalizeMaterialSuggestionValue(warning.partCode);
  const partNameMatches = normalizeMaterialSuggestionValue(line.partName) === normalizeMaterialSuggestionValue(warning.partName);
  if (partCodeMatches && partNameMatches) {
    return;
  }
  clearMaterialIdentityWarning(line);
}

function normalizeComponentNo(value?: string) {
  return value?.trim().toUpperCase() || '';
}

function captureComponentNoBeforeEdit(line: CreateOrderLinePayload) {
  componentNoEditSnapshots.set(line, normalizeComponentNo(line.componentNo));
}

function normalizeComponentFields(line: CreateOrderLinePayload) {
  const previousComponentNo = componentNoEditSnapshots.get(line) || normalizeComponentNo(line.componentNo);
  line.componentNo = normalizeComponentNo(line.componentNo);
  line.parentComponentNo = normalizeComponentNo(line.parentComponentNo);
  syncChildParentComponentNo(line, previousComponentNo);
  componentNoEditSnapshots.delete(line);
}

function syncChildParentComponentNo(componentLine: CreateOrderLinePayload, previousComponentNo: string) {
  const nextComponentNoValue = normalizeComponentNo(componentLine.componentNo);
  if (
    componentLine.lineType !== 'COMPONENT' ||
    !previousComponentNo ||
    !nextComponentNoValue ||
    previousComponentNo === nextComponentNoValue
  ) {
    return;
  }
  for (const line of props.lines) {
    if (line === componentLine || line.lineType === 'COMPONENT') {
      continue;
    }
    if (normalizeComponentNo(line.parentComponentNo) === previousComponentNo) {
      line.parentComponentNo = nextComponentNoValue;
    }
  }
}

function clearChildParentComponentNo(componentNo: string) {
  if (!componentNo) {
    return;
  }
  const stillHasComponent = props.lines.some(
    (line) => line.lineType === 'COMPONENT' && normalizeComponentNo(line.componentNo) === componentNo
  );
  if (stillHasComponent) {
    return;
  }
  for (const line of props.lines) {
    if (line.lineType !== 'COMPONENT' && normalizeComponentNo(line.parentComponentNo) === componentNo) {
      line.parentComponentNo = '';
    }
  }
}

function handleLineTypeChange(line: CreateOrderLinePayload) {
  const previousComponentNo = normalizeComponentNo(line.componentNo);
  normalizeComponentFields(line);
  if (line.lineType === 'COMPONENT') {
    line.parentComponentNo = '';
    if (!line.componentNo) {
      line.componentNo = nextComponentNo();
    }
    return;
  }
  clearChildParentComponentNo(previousComponentNo);
  line.componentNo = '';
  applyDefaultParentComponent(line);
}

function applyDefaultParentComponent(line: CreateOrderLinePayload) {
  if (line.lineType === 'COMPONENT' || normalizeComponentNo(line.parentComponentNo)) {
    return;
  }
  line.parentComponentNo = inheritedParentComponentNoForLine(line);
}

function inheritedParentComponentNoForLine(line: CreateOrderLinePayload) {
  const lineIndex = props.lines.indexOf(line);
  if (lineIndex <= 0) {
    return '';
  }
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const previousLine = props.lines[index];
    if (previousLine.lineType === 'COMPONENT') {
      return normalizeComponentNo(previousLine.componentNo);
    }
    const inheritedParentNo = normalizeComponentNo(previousLine.parentComponentNo);
    if (inheritedParentNo) {
      return inheritedParentNo;
    }
  }
  return '';
}

function nextComponentNo() {
  const usedNos = new Set(
    [...props.componentSourceLines, ...props.lines].map((line) => normalizeComponentNo(line.componentNo)).filter(Boolean)
  );
  for (let index = 1; index <= 9999; index += 1) {
    const candidate = `C${String(index).padStart(3, '0')}`;
    if (!usedNos.has(candidate)) {
      return candidate;
    }
  }
  return '';
}

function fulfillmentModeText(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    return '使用库存';
  }
  if (line.fulfillmentMode === 'REWORK') {
    return '库存再加工';
  }
  return '重新生产';
}

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

function syncStockProductionPlanQuantity(
  line: CreateOrderLinePayload,
  previousSuggestedQuantity = suggestedProductionPlanQuantity(line),
  options: { forceWhenStockCovers?: boolean } = {}
) {
  if (line.fulfillmentMode === 'STOCK') {
    const currentPlanQuantity = Number(line.productionPlanQuantity ?? previousSuggestedQuantity);
    const nextSuggestedQuantity = stockShortageProductionQuantity(line);
    line.productionPlanSuggestedQuantity = nextSuggestedQuantity;
    const planWasFollowingSuggestion = Math.abs(currentPlanQuantity - previousSuggestedQuantity) <= 0.0001;
    const stockCoversCustomerQuantity =
      nextSuggestedQuantity <= 0 && selectedStockSourceQuantity(line) + 0.0001 >= Number(line.quantity || 0);
    const hasExplicitProductionPlanOverride = hasProductionPlanOverride(line);
    // 库存完全覆盖时默认不生产；如果操作人员已填写多做/少做说明，不覆盖人工计划。
    if (options.forceWhenStockCovers && stockCoversCustomerQuantity && !hasExplicitProductionPlanOverride) {
      line.productionPlanQuantity = nextSuggestedQuantity;
      clearProductionPlanOverride(line);
      return;
    }
    // 库存来源变化时只同步“仍跟随建议值”的生产计划；操作人员手动多做/少做后必须保留其计划和说明。
    if (planWasFollowingSuggestion) {
      line.productionPlanQuantity = nextSuggestedQuantity;
      clearProductionPlanOverride(line);
      return;
    }
    if (!stockProductionPlanDiffers(line)) {
      clearProductionPlanOverride(line);
    }
  }
}

function syncInitialStockCoveredPlanQuantity(line: CreateOrderLinePayload) {
  if (stockCoverAutoSyncedLines.has(line)) {
    return;
  }
  stockCoverAutoSyncedLines.add(line);
  if (
    line.fulfillmentMode === 'STOCK' &&
    selectedStockSourceQuantity(line) + 0.0001 >= Number(line.quantity || 0) &&
    Number(line.productionPlanQuantity || 0) > 0
  ) {
    syncStockProductionPlanQuantity(line, suggestedProductionPlanQuantity(line), { forceWhenStockCovers: true });
  }
}

watch(
  () => props.lines,
  (rows) => {
    rows.forEach(syncInitialStockCoveredPlanQuantity);
  },
  { immediate: true }
);

function clearProductionPlanOverride(line: CreateOrderLinePayload) {
  line.productionPlanOverrideByCode = '';
  line.productionPlanOverrideByName = '';
  line.productionPlanOverrideByRole = '';
  line.productionPlanOverrideAt = '';
  line.productionPlanOverrideReason = '';
}

function hasProductionPlanOverride(line: CreateOrderLinePayload) {
  return Boolean(line.productionPlanOverrideByCode?.trim() || line.productionPlanOverrideReason?.trim());
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
      excludeOrderNo: props.excludeOrderNo,
      excludeOrderId: props.excludeOrderId
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
  const previousSuggestedQuantity = suggestedProductionPlanQuantity(currentSourceLine.value);
  currentSourceLine.value.selectedStockSources = sources;
  currentSourceLine.value.stockSourceReviewed = false;
  currentSourceLine.value.stockSourceReviewSignature = '';
  currentSourceLine.value.stockSourceAvailableQuantity = sources.reduce((sum, source) => sum + Number(source.quantity || 0), 0);
  currentSourceLine.value.stockSourceMatchedQuantity = currentSourceLine.value.stockSourceAvailableQuantity;
  syncStockProductionPlanQuantity(currentSourceLine.value, previousSuggestedQuantity, { forceWhenStockCovers: true });
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
  syncStockProductionPlanQuantity(currentSourceLine.value, undefined, { forceWhenStockCovers: true });
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
  if (!normalizedKeyword && !props.customerId?.trim()) {
    return;
  }
  try {
    const result = await loadMaterialSuggestions(normalizedKeyword);
    if (requestId === materialSuggestionRequestSeq.value) {
      callback(result);
    }
  } catch {
    if (requestId === materialSuggestionRequestSeq.value) {
      callback([]);
    }
  }
}

function normalizeMaterialSuggestionValue(value?: string | null) {
  return String(value || '').trim().toLocaleLowerCase();
}

function materialSuggestionExactMatches(item: InventoryMaterialSuggestion, keyword: string) {
  const normalizedKeyword = normalizeMaterialSuggestionValue(keyword);
  return (
    normalizeMaterialSuggestionValue(item.partCode) === normalizedKeyword ||
    normalizeMaterialSuggestionValue(item.partName) === normalizedKeyword
  );
}

function canAutoFillMaterialSuggestion(item: InventoryMaterialSuggestion) {
  return !item.hasIdentityConflict;
}

function warnMaterialSuggestionNeedsManualPick(item: InventoryMaterialSuggestion) {
  if (item.hasIdentityConflict) {
    ElMessage.warning(`物料编码 ${item.partCode} 存在多套历史资料，请核对${materialIdentityConflictFieldsText(item)}，并从下拉候选中人工确认后再套用`);
  }
}

function loadMaterialSuggestions(keyword: string) {
  return erpApi.inventoryMaterialSuggestions(
    keyword.trim(),
    undefined,
    undefined,
    props.excludeOrderNo,
    props.excludeOrderId,
    props.customerId
  );
}

async function fillExactMaterialFromInput(line: CreateOrderLinePayload, field: MaterialSuggestionInputField) {
  const keyword = String(line[field] || '').trim();
  if (!keyword) {
    return;
  }
  try {
    const suggestions = await loadMaterialSuggestions(keyword);
    if (normalizeMaterialSuggestionValue(line[field]) !== normalizeMaterialSuggestionValue(keyword)) {
      return;
    }
    const exactMatches = suggestions.filter((item) => materialSuggestionExactMatches(item, keyword));
    if (exactMatches.length === 1) {
      if (!canAutoFillMaterialSuggestion(exactMatches[0])) {
        warnMaterialSuggestionNeedsManualPick(exactMatches[0]);
        return;
      }
      selectMaterialSuggestion(line, exactMatches[0]);
      return;
    }
    if (exactMatches.length > 1) {
      const normalizedKeyword = normalizeMaterialSuggestionValue(keyword);
      const exactFieldMatches = exactMatches.filter(
        (item) => normalizeMaterialSuggestionValue(item[field]) === normalizedKeyword
      );
      if (exactFieldMatches.length === 1) {
        if (!canAutoFillMaterialSuggestion(exactFieldMatches[0])) {
          warnMaterialSuggestionNeedsManualPick(exactFieldMatches[0]);
          return;
        }
        selectMaterialSuggestion(line, exactFieldMatches[0]);
        return;
      }
      const exactPartCodeMatches = exactMatches.filter(
        (item) => normalizeMaterialSuggestionValue(item.partCode) === normalizedKeyword
      );
      if (exactFieldMatches.length === 0 && exactPartCodeMatches.length === 1) {
        if (!canAutoFillMaterialSuggestion(exactPartCodeMatches[0])) {
          warnMaterialSuggestionNeedsManualPick(exactPartCodeMatches[0]);
          return;
        }
        selectMaterialSuggestion(line, exactPartCodeMatches[0]);
        return;
      }
      ElMessage.warning(`找到 ${exactMatches.length} 个精确匹配物料，请从下拉列表选择具体零件`);
    }
  } catch {
    // 查询失败时保留手工输入值，避免阻断新物料下单。
  }
}

function selectMaterialSuggestion(line: CreateOrderLinePayload, item: InventoryMaterialSuggestion) {
  if (item.hasIdentityConflict) {
    ElMessage.warning(`物料编码 ${item.partCode} 存在多套历史资料，已按当前候选套用，请核对${materialIdentityConflictFieldsText(item)}`);
  }
  setMaterialIdentityWarning(line, item);
  const lineHadDrawingInfo = Boolean(
    line.drawingNo?.trim() ||
      line.drawingVersion?.trim() ||
      line.drawingDate ||
      line.drawingStatus?.trim() ||
      line.projectModel?.trim() ||
      line.partSpecification?.trim()
  );
  invalidateStockSourceReview(line, true);
  line.partCode = item.partCode;
  line.partName = item.partName;
  const autoFields: AutoMaterialSnapshot['autoFields'] = {
    partName: item.partName
  };
  line.unit = item.unit || line.unit || '件';
  if (item.unit) {
    autoFields.unit = item.unit;
  }
  if (!line.partSpecification && item.partSpecification) {
    line.partSpecification = item.partSpecification;
    autoFields.partSpecification = item.partSpecification;
  }
  if (!line.drawingNo && item.drawingNo) {
    line.drawingNo = item.drawingNo;
    autoFields.drawingNo = item.drawingNo;
  }
  if (!line.drawingVersion && item.drawingVersion) {
    line.drawingVersion = item.drawingVersion;
    autoFields.drawingVersion = item.drawingVersion;
  }
  if (!line.drawingDate && item.drawingDate) {
    line.drawingDate = item.drawingDate;
    autoFields.drawingDate = item.drawingDate;
  }
  if (!line.drawingStatus && item.drawingStatus) {
    line.drawingStatus = item.drawingStatus;
    autoFields.drawingStatus = item.drawingStatus;
  }
  if (!line.projectModel && item.projectModel) {
    line.projectModel = item.projectModel;
    autoFields.projectModel = item.projectModel;
  }
  if (!lineHadDrawingInfo && item.partThickness && Number(item.partThickness) > 0) {
    line.partThickness = item.partThickness;
    autoFields.partThickness = item.partThickness;
  }
  autoMaterialSnapshots.set(line, {
    partCode: item.partCode,
    partName: item.partName,
    autoFields
  });
}

function handlePartCodeInput(line: CreateOrderLinePayload) {
  clearAutoMaterialFieldsWhenMaterialIdentityChanges(line);
  clearMaterialIdentityWarningWhenMaterialIdentityChanges(line);
  if (line.selectedStockSources?.length || line.stockSourceReviewed) {
    invalidateStockSourceReview(line, true);
  }
}

function handlePartNameInput(line: CreateOrderLinePayload) {
  clearAutoMaterialFieldsWhenMaterialIdentityChanges(line);
  clearMaterialIdentityWarningWhenMaterialIdentityChanges(line);
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

function clearAutoMaterialFieldsWhenMaterialIdentityChanges(line: CreateOrderLinePayload) {
  const snapshot = autoMaterialSnapshots.get(line);
  if (!snapshot) {
    return;
  }
  const partCodeMatches = normalizeMaterialSuggestionValue(line.partCode) === normalizeMaterialSuggestionValue(snapshot.partCode);
  const partNameMatches = normalizeMaterialSuggestionValue(line.partName) === normalizeMaterialSuggestionValue(snapshot.partName);
  if (partCodeMatches && partNameMatches) {
    return;
  }
  const clearTextField = (
    field: Exclude<AutoMaterialField, 'unit' | 'partThickness'>,
    fallback: string | undefined = ''
  ) => {
    const snapshotValue = snapshot.autoFields[field];
    if (snapshotValue !== undefined && normalizeMaterialSuggestionValue(String(line[field] || '')) === normalizeMaterialSuggestionValue(String(snapshotValue || ''))) {
      line[field] = fallback as never;
    }
  };
  clearTextField('partName');
  clearTextField('partSpecification');
  clearTextField('drawingNo');
  clearTextField('drawingVersion');
  clearTextField('drawingDate', undefined);
  clearTextField('drawingStatus');
  clearTextField('projectModel');
  if (
    snapshot.autoFields.unit !== undefined &&
    normalizeMaterialSuggestionValue(line.unit) === normalizeMaterialSuggestionValue(String(snapshot.autoFields.unit || ''))
  ) {
    line.unit = '件';
  }
  if (
    snapshot.autoFields.partThickness !== undefined &&
    Math.abs(Number(line.partThickness || 0) - Number(snapshot.autoFields.partThickness || 0)) <= 0.0001
  ) {
    line.partThickness = 1;
  }
  autoMaterialSnapshots.delete(line);
  clearMaterialIdentityWarning(line);
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

.order-line-mobile-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #475569;
  font-size: 13px;
}

.order-line-mobile-toolbar > div {
  display: flex;
  gap: 6px;
}

.order-line-compact-summary {
  margin-bottom: 10px;
}

.order-line-compact-summary .warning {
  color: #d97706;
  font-weight: 600;
}

.order-line-compact-summary .success {
  color: #16a34a;
  font-weight: 600;
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

.material-input-cell {
  display: grid;
  gap: 4px;
}

.material-identity-warning {
  color: #d97706;
  font-size: 12px;
  line-height: 16px;
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

:global(.material-suggestion-popper .el-autocomplete-suggestion__wrap) {
  max-height: 340px;
}

:global(.material-suggestion-popper) {
  width: min(560px, calc(100vw - 48px)) !important;
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

  .order-line-mobile-toolbar {
    flex-wrap: wrap;
  }

  .order-line-mobile-toolbar :deep(.el-button) {
    min-height: 36px;
  }
}
</style>
