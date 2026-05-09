<template>
  <el-dialog
    :model-value="modelValue"
    title="库存来源详情"
    width="min(1120px, calc(100vw - 32px))"
    append-to-body
    class="responsive-dialog inventory-source-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-alert
      title="使用库存前必须核对生产订单、任务号、图号、版本和图纸文件；图纸不一致时应选择库存再加工或重新生产。"
      type="warning"
      :closable="false"
      class="source-warning"
    />

    <div v-if="reviewMode" class="source-search-panel">
      <div>
        <strong>库存查询</strong>
        <small>可按零件编码、名称、拼音或首字母搜索数据库库存；允许选择可替代产品，但必须逐批确认数量。</small>
      </div>
      <div class="source-search-controls">
        <el-autocomplete
          v-model="sourceSearchKeyword"
          :fetch-suggestions="queryInventorySuggestions"
          value-key="partCode"
          placeholder="搜索库存或可替代物料"
          clearable
          popper-class="material-suggestion-popper"
          @select="handleInventorySuggestionSelect"
        >
          <template #default="{ item }">
            <div class="material-suggestion">
              <strong>{{ item.partCode }}</strong>
              <span>{{ item.partName }}</span>
              <small>备货库存 {{ formatQuantity(item.stockInventoryQuantity, item.unit) }}</small>
              <small v-if="materialSuggestionMatchText(item)">{{ materialSuggestionMatchText(item) }}</small>
            </div>
          </template>
        </el-autocomplete>
        <el-button @click="searchInventoryKeyword">查询库存</el-button>
        <el-button v-if="expected?.partCode" @click="searchExpectedPart">返回订单零件</el-button>
      </div>
      <div v-if="lastInventorySuggestions.length > 1" class="source-search-results">
        <strong>匹配到多个物料，请选择具体零件</strong>
        <button
          v-for="item in lastInventorySuggestions"
          :key="`${item.partCode}-${item.matchedBatchNo || 'all'}`"
          type="button"
          class="source-search-result"
          @click="handleInventorySuggestionSelect(item)"
        >
          <span>{{ item.partCode }} / {{ item.partName }}</span>
          <small>备货库存 {{ formatQuantity(item.stockInventoryQuantity, item.unit) }}</small>
          <small v-if="materialSuggestionMatchText(item)">{{ materialSuggestionMatchText(item) }}</small>
        </button>
      </div>
    </div>

    <div v-loading="loading" class="source-detail-body">
      <div v-if="detail" class="source-summary">
        <div>
          <span>零件</span>
          <strong>{{ detail.partName || '-' }} / {{ detail.partCode }}</strong>
        </div>
        <div>
          <span>当前可用</span>
          <strong>{{ formatQuantity(detail.availableQuantity, detail.unit) }}</strong>
        </div>
        <div>
          <span>库存批次</span>
          <strong>{{ detail.batchCount }} 批</strong>
        </div>
        <div>
          <span>来源构成</span>
          <strong>订单 {{ detail.orderSourceCount }} / 备货 {{ detail.stockSourceCount }}</strong>
          <small v-if="sourceKindSummaryText">{{ sourceKindSummaryText }}</small>
        </div>
      </div>

      <div v-if="expected && hasExpectedInfo" class="expected-card">
        <div class="expected-title">本次订单图纸要求</div>
        <div class="expected-grid">
          <span>图号：{{ expected.drawingNo || '未填写' }}</span>
          <span>版本：{{ expected.drawingVersion || '未填写' }}</span>
          <span>规格：{{ expected.partSpecification || '未填写' }}</span>
          <span>厚度：{{ expected.partThickness ? `${expected.partThickness} mm` : '未填写' }}</span>
          <span>本次需要：{{ expected.requiredQuantity ? formatQuantity(expected.requiredQuantity, expected.unit || '件') : '未填写' }}</span>
          <span>使用方式：{{ fulfillmentModeText }}</span>
        </div>
        <DrawingPreviewLink
          :file-name="expected.drawingFileName"
          :file-url="expected.drawingFileUrl"
          link-text="打开本次订单图纸"
          title="本次订单图纸"
        />
        <el-alert
          v-if="expectedMissingInfoReasons.length"
          :title="`本次订单资料不完整：${expectedMissingInfoReasons.join('、')}。直接使用库存前必须补齐关键图纸资料；否则请选择库存再加工或重新生产。`"
          type="warning"
          :closable="false"
          class="expected-warning"
        />
        <el-alert
          v-else-if="expectedFileMissing"
          title="本次订单未上传图纸文件，系统只能按图号、版本、规格和厚度进行初步核对。建议补上传图纸后再使用库存。"
          type="warning"
          :closable="false"
          class="expected-warning"
        />
      </div>

      <div v-if="expected && hasExpectedInfo && detail" class="source-quantity-check">
        <span>图纸匹配库存：{{ formatQuantity(matchedQuantity, detail.unit) }}</span>
        <span>需确认或资料不完整：{{ formatQuantity(unmatchedQuantity, detail.unit) }}</span>
        <strong :class="{ danger: !stockReviewQuantityOk }">{{ stockReviewQuantityText }}</strong>
      </div>

      <div v-if="reviewMode && selectedSourceRows.length" class="selected-source-card">
        <div class="selected-source-title">
          <strong>已选库存批次</strong>
          <span>这里会保留跨物料搜索后选中的批次，避免切换搜索结果后误以为没有选择库存。</span>
        </div>
        <div class="selected-source-list">
          <article v-for="source in selectedSourceRows" :key="source.batchId" class="selected-source-item">
            <div>
              <strong>{{ source.batchNo || source.batchId }}</strong>
              <span>{{ source.partCode || '-' }} / {{ source.partName || '-' }}</span>
              <small>{{ formatQuantity(source.quantity, source.unit || expected?.unit || detail?.unit || '件') }}</small>
              <small v-if="selectedSourceReplenishmentText(source)" class="selected-source-replenishment-note">
                {{ selectedSourceReplenishmentText(source) }}
              </small>
              <small v-if="source.manualConfirmedBy" class="selected-source-manual-note">
                人工确认：{{ source.manualConfirmedBy }}
                <template v-if="source.manualConfirmedAt"> / {{ formatDateTime(source.manualConfirmedAt) }}</template>
                <template v-if="source.manualConfirmRemark"> / {{ source.manualConfirmRemark }}</template>
              </small>
            </div>
            <el-tag v-if="sourceNeedsManualConfirmation(source)" type="warning" effect="plain">
              {{ source.compatibilityReason || '需要人工确认' }}
            </el-tag>
            <el-tag v-else type="success" effect="plain">已匹配</el-tag>
            <el-button link type="danger" @click="removeSelectedSource(source.batchId)">移除</el-button>
          </article>
        </div>
      </div>

      <div v-if="reviewMode && selectedIssueSources.length" class="manual-confirm-card">
        <div class="manual-confirm-title">
          <strong>不适配库存人工确认</strong>
          <span>已选库存存在图纸、规格、厚度或来源资料不一致，必须填写记录后才能确认。</span>
        </div>
        <div class="manual-confirm-issues">
          <article v-for="item in selectedIssueSourceForms" :key="item.source.batchId" class="manual-confirm-item">
            <div class="manual-confirm-item-head">
              <el-tag type="warning" effect="plain">
                {{ item.source.batchNo || item.source.batchId }}
              </el-tag>
              <span>{{ item.source.compatibilityReason || '需要人工确认' }}</span>
            </div>
            <div class="manual-confirm-form">
              <label>
                <span>确认人员</span>
                <el-input v-model="item.form.confirmedBy" placeholder="填写操作人员姓名" />
              </label>
              <label>
                <span>确认时间</span>
                <el-input :model-value="formatDateTime(item.form.confirmedAt)" disabled />
              </label>
              <label class="manual-confirm-remark">
                <span>说明</span>
                <el-input
                  v-model="item.form.remark"
                  type="textarea"
                  :rows="2"
                  placeholder="例如：该库存产品可替用；需要改工后使用；客户已确认规格差异；图纸缺失但实物已核对。"
                />
              </label>
            </div>
          </article>
        </div>
      </div>

      <el-table
        v-if="detail"
        class="desktop-table"
        :data="sourceRows"
        :row-class-name="sourceRowClassName"
        max-height="520"
        border
      >
        <el-table-column v-if="reviewMode" label="本次使用" width="180" fixed="left">
          <template #default="{ row }">
            <div class="source-selection-cell">
              <el-checkbox :model-value="isSourceSelected(row)" @change="handleSourceChecked(row, $event)">
                选用
              </el-checkbox>
              <el-input-number
                :model-value="selectedSourceQuantity(row)"
                :min="0"
                :max="sourceMaxSelectableQuantity(row)"
                :precision="3"
                :controls="false"
                size="small"
                @change="handleSourceQuantityChange(row, $event)"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="库存批次" min-width="220">
          <template #default="{ row }">
            <div class="cell-main batch-cell-main">
              <span>{{ row.batchNo }}</span>
              <el-tag v-if="isFocusedSource(row)" type="primary" size="small" effect="plain">当前批次</el-tag>
            </div>
            <div class="cell-subtext">{{ sourceTypeText(row.inventorySourceType) }} / {{ sourceKindText(row.sourceKind) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="当前库存" width="120">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="170">
          <template #default="{ row }">{{ row.warehouseName || '-' }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column label="匹配订单" min-width="170">
          <template #default="{ row }">
            <el-button v-if="row.sourceOrderNo" link type="primary" class="inline-order-link" @click="openOrderPreview(row.sourceOrderNo)">
              {{ row.sourceOrderNo }}
            </el-button>
            <span v-else class="muted">备货库存</span>
            <div v-if="row.sourceCustomerName" class="cell-subtext">{{ row.sourceCustomerName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="生产来源" min-width="210">
          <template #default="{ row }">
            <el-button v-if="productionOrderNo(row)" link type="primary" class="inline-order-link" @click="openOrderPreview(productionOrderNo(row))">
              {{ productionOrderNo(row) }}
            </el-button>
            <span v-else class="muted">未记录来源订单</span>
            <div class="cell-subtext">{{ row.sourceProductionTaskNo || '未记录生产任务' }}</div>
            <div v-if="replenishmentSourceText(row)" class="cell-subtext">{{ replenishmentSourceText(row) }}</div>
            <div v-if="productionCustomerName(row)" class="cell-subtext">{{ productionCustomerName(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="生产日期" width="125">
          <template #default="{ row }">{{ formatDate(row.productionDate || row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="图纸信息" min-width="220">
          <template #default="{ row }">
            <div class="cell-main">{{ drawingTitle(row) }}</div>
            <DrawingPreviewLink
              :file-name="row.drawingFileName"
              :file-url="row.drawingFileUrl"
              link-text="打开图纸"
              :title="`${row.partName || row.partCode} 库存图纸`"
            />
            <span v-if="!row.drawingFileUrl" class="muted">未上传图纸</span>
          </template>
        </el-table-column>
        <el-table-column v-if="expected && hasExpectedInfo" label="适用判断" min-width="190">
          <template #default="{ row }">
            <el-tag :type="compatibilityResult(row).type" effect="plain">
              {{ compatibilityResult(row).label }}
            </el-tag>
            <div v-if="compatibilityResult(row).reason" class="cell-subtext warning-text">
              {{ compatibilityResult(row).reason }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="规格 / 厚度" min-width="170">
          <template #default="{ row }">
            <div>{{ row.partSpecification || '-' }}</div>
            <div class="cell-subtext">{{ row.partThickness ? `${row.partThickness} mm` : '-' }}</div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="detail" class="mobile-section source-mobile-list">
        <article v-for="row in sourceRows" :key="row.id || row.batchNo" class="mobile-card source-mobile-card">
          <div class="mobile-card-header">
            <div class="mobile-card-title">
              <strong>{{ row.batchNo }}</strong>
              <small>{{ sourceTypeText(row.inventorySourceType) }} / {{ sourceKindText(row.sourceKind) }} / {{ formatQuantity(row.quantity, row.unit) }}</small>
            </div>
            <el-tag v-if="expected && hasExpectedInfo" :type="compatibilityResult(row).type" effect="plain">
              {{ compatibilityResult(row).label }}
            </el-tag>
          </div>

          <div v-if="reviewMode" class="mobile-source-selection">
            <el-checkbox :model-value="isSourceSelected(row)" @change="handleSourceChecked(row, $event)">
              选用该批次
            </el-checkbox>
            <el-input-number
              :model-value="selectedSourceQuantity(row)"
              :min="0"
              :max="sourceMaxSelectableQuantity(row)"
              :precision="3"
              :controls="false"
              @change="handleSourceQuantityChange(row, $event)"
            />
          </div>

          <div class="mobile-card-fields">
            <div class="mobile-field">
              <label>仓库 / 库位</label>
              <span>{{ row.warehouseName || '-' }} / {{ row.locationName || '-' }}</span>
            </div>
            <div class="mobile-field">
              <label>匹配订单</label>
              <span>
                <el-button v-if="row.sourceOrderNo" link type="primary" class="inline-order-link" @click="openOrderPreview(row.sourceOrderNo)">
                  {{ row.sourceOrderNo }}
                </el-button>
                <span v-else>备货库存</span>
              </span>
            </div>
            <div class="mobile-field">
              <label>生产来源</label>
              <span>
                <el-button v-if="productionOrderNo(row)" link type="primary" class="inline-order-link" @click="openOrderPreview(productionOrderNo(row))">
                  {{ productionOrderNo(row) }}
                </el-button>
                <span v-else>未记录来源订单</span>
              </span>
            </div>
            <div class="mobile-field">
              <label>生产任务</label>
              <span>{{ row.sourceProductionTaskNo || '-' }}</span>
            </div>
            <div v-if="replenishmentSourceText(row)" class="mobile-field">
              <label>补单来源</label>
              <span>{{ replenishmentSourceText(row) }}</span>
            </div>
            <div class="mobile-field">
              <label>生产日期</label>
              <span>{{ formatDate(row.productionDate || row.createdAt) }}</span>
            </div>
            <div class="mobile-field">
              <label>图纸信息</label>
              <span>{{ drawingTitle(row) }}</span>
            </div>
            <div class="mobile-field">
              <label>规格 / 厚度</label>
              <span>{{ row.partSpecification || '-' }} / {{ row.partThickness ? `${row.partThickness} mm` : '-' }}</span>
            </div>
            <div v-if="expected && hasExpectedInfo && compatibilityResult(row).reason" class="mobile-field">
              <label>适用说明</label>
              <span class="warning-text">{{ compatibilityResult(row).reason }}</span>
            </div>
          </div>

          <div class="mobile-card-actions">
            <DrawingPreviewLink
              :file-name="row.drawingFileName"
              :file-url="row.drawingFileUrl"
              link-text="打开图纸"
              :title="`${row.partName || row.partCode} 库存图纸`"
            />
          </div>
        </article>
      </div>

      <el-empty v-if="detail && detail.sources.length === 0" description="当前条件下没有可用库存来源" />
    </div>

    <template v-if="reviewMode" #footer>
      <div class="source-dialog-footer">
        <div class="source-confirm-left">
          <el-checkbox v-model="reviewConfirmChecked">
            已核对库存批次、订单/任务、图号、版本、图纸文件、规格和厚度
          </el-checkbox>
          <span class="source-confirm-hint">{{ confirmHint }}</span>
        </div>
        <div class="source-dialog-actions">
          <el-button @click="emit('update:modelValue', false)">关闭</el-button>
          <el-button
            type="primary"
            :disabled="!canConfirmReview"
            @click="confirmReviewed"
          >
            确认已核对库存来源
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <el-dialog
    v-model="orderPreviewVisible"
    title="订单信息"
    width="min(920px, calc(100vw - 32px))"
    append-to-body
    class="responsive-dialog order-preview-dialog"
  >
    <div v-loading="orderPreviewLoading" class="order-preview-body">
      <template v-if="orderPreview">
        <div class="order-preview-summary">
          <div>
            <span>订单号</span>
            <strong>{{ orderPreview.orderNo }}</strong>
          </div>
          <div>
            <span>客户</span>
            <strong>{{ orderPreview.customerName }}</strong>
          </div>
          <div>
            <span>订单日期</span>
            <strong>{{ formatDate(orderPreview.orderDate) }}</strong>
          </div>
          <div>
            <span>交期</span>
            <strong>{{ formatDate(orderPreview.deliveryDate) || '-' }}</strong>
          </div>
          <div>
            <span>状态</span>
            <strong>{{ orderStatusText(orderPreview.status) }}</strong>
          </div>
        </div>
        <el-table :data="orderPreview.lines" border max-height="360">
          <el-table-column prop="partCode" label="零件编码" min-width="130" />
          <el-table-column prop="partName" label="零件名称" min-width="150" />
          <el-table-column label="客户订单" width="120">
            <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="生产计划" width="120">
            <template #default="{ row }">{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="图纸" min-width="170">
            <template #default="{ row }">
              <div>{{ row.drawingNo || '未填写' }} / {{ row.drawingVersion || '-' }}</div>
              <DrawingPreviewLink :file-name="row.drawingFileName" :file-url="row.drawingFileUrl" link-text="打开图纸" />
            </template>
          </el-table-column>
          <el-table-column label="规格 / 厚度" min-width="170">
            <template #default="{ row }">
              <div>{{ row.partSpecification || '-' }}</div>
              <div class="cell-subtext">{{ row.partThickness ? `${row.partThickness} mm` : '-' }}</div>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <el-empty v-else-if="!orderPreviewLoading" description="未找到订单信息" />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import DrawingPreviewLink from './DrawingPreviewLink.vue';
import { erpApi, type StockSourceSelectionPayload } from '../api/erp';
import type {
  InventoryMaterialSuggestion,
  InventorySourceBatchDetail,
  InventorySourceDetailResponse,
  InventorySourceExpected,
  InventorySourceType,
  OrderDetail
} from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';

const props = defineProps<{
  modelValue: boolean;
  loading?: boolean;
  detail?: InventorySourceDetailResponse | null;
  expected?: InventorySourceExpected | null;
  reviewMode?: boolean;
  reviewed?: boolean;
  focusBatchId?: string;
  focusBatchNo?: string;
  selectedSources?: StockSourceSelectionPayload[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirmReviewed: [];
  sourceSearch: [partCode: string];
  selectionChange: [sources: StockSourceSelectionPayload[]];
}>();

type CompatibilityStatus = NonNullable<StockSourceSelectionPayload['compatibilityStatus']>;
type ManualConfirmForm = {
  confirmedBy: string;
  confirmedAt: Date;
  remark: string;
};

const expected = computed(() => props.expected || null);
const sourceSearchKeyword = ref('');
const activeSearchFocusBatchNo = ref('');
const inventorySuggestionRequestSeq = ref(0);
const lastInventorySuggestions = ref<InventoryMaterialSuggestion[]>([]);
const reviewConfirmChecked = ref(false);
const manualConfirmForms = ref<Record<string, ManualConfirmForm>>({});
const orderPreviewVisible = ref(false);
const orderPreviewLoading = ref(false);
const orderPreview = ref<OrderDetail | null>(null);
const sourceRows = computed(() => {
  const rows = props.detail?.sources || [];
  if (!props.focusBatchId && !props.focusBatchNo && !activeSearchFocusBatchNo.value && (!expected.value || !hasExpectedInfo.value)) {
    return rows;
  }
  // 操作人员优先看到当前正在核对的批次；下单核对时，再把图纸匹配库存排在前面。
  return rows
    .map((row, index) => ({ row, index, rank: sourceRowRank(row) }))
    .sort((left, right) => left.rank - right.rank || compatibilityRank(left.row) - compatibilityRank(right.row) || left.index - right.index)
    .map((item) => item.row);
});
const selectedSourceRows = computed(() => {
  const sourceMap = new Map((props.detail?.sources || []).map((row) => [row.id, row]));
  return normalizeSelectedSources(props.selectedSources || []).map((source) => {
    const row = sourceMap.get(source.batchId);
    if (!row) {
      return source;
    }
    const compatibility = compatibilityResult(row);
    return {
      ...source,
      batchNo: row.batchNo || source.batchNo,
      partCode: row.partCode || source.partCode,
      partName: row.partName || source.partName,
      unit: row.unit || source.unit,
      replenishmentSourceType: row.replenishmentSourceType || source.replenishmentSourceType,
      replenishmentSourceRequestNo: row.replenishmentSourceRequestNo || source.replenishmentSourceRequestNo,
      replenishmentSourceLabel: row.replenishmentSourceLabel || source.replenishmentSourceLabel,
      compatibilityStatus: selectionCompatibilityStatus(row),
      compatibilityReason: selectionCompatibilityReason(compatibility)
    };
  });
});
const selectedSourceMap = computed(() => new Map(selectedSourceRows.value.map((source) => [source.batchId, source])));
const requiredQuantity = computed(() => Number(expected.value?.requiredQuantity || 0));
const selectedQuantityTotal = computed(() => selectedSourceRows.value.reduce((sum, source) => sum + source.quantity, 0));
const selectedQuantityOverRequired = computed(
  () => props.reviewMode && requiredQuantity.value > 0 && selectedQuantityTotal.value > requiredQuantity.value + 0.0001
);
const selectedIssueSources = computed(() => selectedSourceRows.value.filter((source) => sourceNeedsManualConfirmation(source)));
const selectedIssueSourceForms = computed(() =>
  selectedIssueSources.value.map((source) => ({
    source,
    form: ensureManualConfirmForm(source)
  }))
);
const directStockBlockedIssue = computed(() => {
  if (!props.reviewMode || expected.value?.fulfillmentMode !== 'STOCK') {
    return '';
  }
  const sourceMap = new Map((props.detail?.sources || []).map((row) => [row.id, row]));
  const blockedSource = selectedSourceRows.value.find((source) => {
    const row = sourceMap.get(source.batchId);
    if (row) {
      return directStockSourceMissingDrawingInfo(row).length > 0;
    }
    return source.compatibilityStatus === 'INCOMPLETE' && savedSourceMissingDrawingInfo(source.compatibilityReason);
  });
  if (!blockedSource) {
    return '';
  }
  const row = sourceMap.get(blockedSource.batchId);
  const reason = row
    ? directStockSourceMissingDrawingInfo(row).join('、')
    : blockedSource.compatibilityReason || '库存来源图纸资料不完整';
  return `已选库存批次 ${blockedSource.batchNo || blockedSource.batchId} 缺少来源${reason}，不能直接使用库存；请选择库存再加工或重新生产。`;
});
const matchedQuantity = computed(() =>
  (props.detail?.sources || []).reduce(
    (sum, row) => sum + (compatibilityResult(row).label === '图纸匹配' ? row.quantity : 0),
    0
  )
);
const unmatchedQuantity = computed(() => Math.max((props.detail?.availableQuantity || 0) - matchedQuantity.value, 0));
const fulfillmentModeText = computed(() => {
  if (expected.value?.fulfillmentMode === 'STOCK') {
    return '使用库存';
  }
  if (expected.value?.fulfillmentMode === 'REWORK') {
    return '库存再加工';
  }
  return '重新生产';
});
const expectedMissingInfoReasons = computed(() => {
  const row = expected.value;
  if (!row) {
    return [];
  }
  return [
    !normalizeValue(row.drawingNo) ? '缺图号' : '',
    !normalizeValue(row.drawingVersion) ? '缺图纸版本' : '',
    !normalizeValue(row.partSpecification) ? '缺成品规格' : '',
    Number(row.partThickness || 0) <= 0 ? '缺零件厚度' : ''
  ].filter(Boolean);
});
const expectedFileMissing = computed(() => Boolean(expected.value && !expected.value.drawingFileUrl));
const orderDrawingInfoComplete = computed(() => expectedMissingInfoReasons.value.length === 0);
const stockReviewQuantityOk = computed(() => {
  if (!props.detail || props.detail.sources.length === 0) {
    return false;
  }
  if (props.reviewMode) {
    if (expected.value?.fulfillmentMode === 'STOCK' && !orderDrawingInfoComplete.value) {
      return false;
    }
    return selectedQuantityTotal.value + 0.0001 >= requiredQuantity.value && !selectedQuantityOverRequired.value;
  }
  if (expected.value?.fulfillmentMode === 'STOCK') {
    // 直接使用库存必须先有本次订单关键图纸资料，再按匹配库存数量确认，避免仅凭零件编码借用旧库存。
    return orderDrawingInfoComplete.value && matchedQuantity.value + 0.0001 >= requiredQuantity.value;
  }
  return props.detail.availableQuantity + 0.0001 >= requiredQuantity.value;
});
const stockReviewQuantityText = computed(() => {
  if (!props.detail || props.detail.sources.length === 0) {
    return '没有可用库存';
  }
  if (props.reviewMode) {
    if (selectedQuantityTotal.value <= 0) {
      return '请先选择要使用的库存批次和数量';
    }
    if (selectedQuantityTotal.value + 0.0001 < requiredQuantity.value) {
      return `已选 ${formatQuantity(selectedQuantityTotal.value, expected.value?.unit || props.detail.unit)}，仍不足本次需要`;
    }
    if (selectedQuantityOverRequired.value) {
      return `已选 ${formatQuantity(selectedQuantityTotal.value, expected.value?.unit || props.detail.unit)}，超过本次需要 ${formatQuantity(requiredQuantity.value, expected.value?.unit || props.detail.unit)}`;
    }
    if (expected.value?.fulfillmentMode === 'STOCK' && !orderDrawingInfoComplete.value) {
      return `本次订单图纸资料不完整，必须补齐 ${expectedMissingInfoReasons.value.join('、')}；否则请选择库存再加工或重新生产`;
    }
    return `已选 ${formatQuantity(selectedQuantityTotal.value, expected.value?.unit || props.detail.unit)}，满足本次需要`;
  }
  if (expected.value?.fulfillmentMode === 'STOCK' && !orderDrawingInfoComplete.value) {
    return '本次订单图纸资料不完整，不能直接使用库存';
  }
  if (expected.value?.fulfillmentMode === 'STOCK' && !stockReviewQuantityOk.value) {
    return '匹配库存不足，请改为库存再加工或重新生产';
  }
  if (expected.value?.fulfillmentMode === 'REWORK') {
    return '库存再加工允许使用需确认库存，但必须保留来源记录';
  }
  return '库存数量满足当前选择';
});
const manualConfirmationOk = computed(() => {
  if (!selectedIssueSources.value.length) {
    return true;
  }
  return selectedIssueSourceForms.value.every((item) =>
    Boolean(item.form.confirmedBy.trim() && manualConfirmDateValid(item.form.confirmedAt) && item.form.remark.trim())
  );
});
const canConfirmReview = computed(() =>
  Boolean(!props.loading && stockReviewQuantityOk.value && !directStockBlockedIssue.value && reviewConfirmChecked.value && manualConfirmationOk.value)
);
const sourceKindSummaryText = computed(() => {
  const rows = props.detail?.sources || [];
  if (!rows.length) {
    return '';
  }
  const quantityMap = rows.reduce<Record<string, number>>((map, row) => {
    const key = row.sourceKind || 'NORMAL_ORDER';
    map[key] = (map[key] || 0) + row.quantity;
    return map;
  }, {});
  return Object.entries(quantityMap)
    .map(([kind, quantity]) => `${sourceKindText(kind)} ${formatQuantity(quantity, props.detail?.unit || '件')}`)
    .join(' / ');
});
const confirmHint = computed(() => {
  if (props.loading) {
    return '正在查询库存来源...';
  }
  if (!props.detail || props.detail.sources.length === 0) {
    return '当前没有可用库存来源，不能确认使用库存。';
  }
  if (!stockReviewQuantityOk.value) {
    return stockReviewQuantityText.value;
  }
  if (directStockBlockedIssue.value) {
    return directStockBlockedIssue.value;
  }
  if (!manualConfirmationOk.value) {
    return '已选不适配库存，请填写确认人员、确认时间和使用说明。';
  }
  if (!reviewConfirmChecked.value) {
    return '请先勾选人工核对确认。';
  }
  return props.reviewed ? '已核对；如果零件、图号、版本、规格或厚度被修改，需要重新核对。' : '请确认库存来源、生产任务、图号、版本和图纸文件后再保存订单。';
});
const hasExpectedInfo = computed(() => {
  const row = expected.value;
  return Boolean(row?.drawingNo || row?.drawingVersion || row?.drawingFileName || row?.partThickness || row?.partSpecification);
});

async function queryInventorySuggestions(keyword: string, callback: (items: InventoryMaterialSuggestion[]) => void) {
  const requestId = ++inventorySuggestionRequestSeq.value;
  try {
    const result = await erpApi.inventoryMaterialSuggestions(keyword.trim(), undefined, 'STOCK');
    if (requestId === inventorySuggestionRequestSeq.value) {
      lastInventorySuggestions.value = result;
      callback(result);
    }
  } catch {
    if (requestId === inventorySuggestionRequestSeq.value) {
      lastInventorySuggestions.value = [];
      callback([]);
    }
  }
}

function handleInventorySuggestionSelect(item: InventoryMaterialSuggestion) {
  resetReviewConfirmation();
  lastInventorySuggestions.value = [item];
  activeSearchFocusBatchNo.value = item.matchedBatchNo || '';
  sourceSearchKeyword.value = item.partName ? `${item.partCode} ${item.partName}` : item.partCode;
  emit('sourceSearch', item.partCode);
}

function materialSuggestionMatchText(item: InventoryMaterialSuggestion) {
  const parts = [
    item.matchedBatchNo ? `命中批次 ${item.matchedBatchNo}` : '',
    item.matchedSourceOrderNo ? `订单 ${item.matchedSourceOrderNo}` : '',
    item.matchedProductionTaskNo ? `任务 ${item.matchedProductionTaskNo}` : ''
  ].filter(Boolean);
  return parts.join(' / ');
}

async function searchInventoryKeyword() {
  const keyword = sourceSearchKeyword.value.trim();
  resetReviewConfirmation();
  if (!keyword) {
    activeSearchFocusBatchNo.value = '';
    lastInventorySuggestions.value = [];
    if (expected.value?.partCode) {
      emit('sourceSearch', expected.value.partCode);
    }
    return;
  }

  const exact = lastInventorySuggestions.value.find(
    (item) => item.partCode.toLocaleLowerCase() === keyword.toLocaleLowerCase() || item.partName === keyword
  );
  if (exact) {
    lastInventorySuggestions.value = [exact];
    activeSearchFocusBatchNo.value = exact.matchedBatchNo || '';
    emit('sourceSearch', exact.partCode);
    return;
  }

  try {
    const suggestions = await erpApi.inventoryMaterialSuggestions(keyword, undefined, 'STOCK');
    lastInventorySuggestions.value = suggestions;
    const first = suggestions[0];
    if (!first) {
      activeSearchFocusBatchNo.value = '';
      ElMessage.warning('没有找到匹配物料');
      return;
    }
    if (suggestions.length > 1) {
      activeSearchFocusBatchNo.value = '';
      ElMessage.warning(`找到 ${suggestions.length} 个匹配物料，请从下拉列表中选择具体零件`);
      return;
    }
    activeSearchFocusBatchNo.value = first.matchedBatchNo || '';
    sourceSearchKeyword.value = first.partName ? `${first.partCode} ${first.partName}` : first.partCode;
    emit('sourceSearch', first.partCode);
  } catch (error) {
    activeSearchFocusBatchNo.value = '';
    ElMessage.error(error instanceof Error ? error.message : '库存查询失败');
  }
}

function searchExpectedPart() {
  if (expected.value?.partCode) {
    resetReviewConfirmation();
    activeSearchFocusBatchNo.value = '';
    lastInventorySuggestions.value = [];
    sourceSearchKeyword.value = expected.value.partName ? `${expected.value.partCode} ${expected.value.partName}` : expected.value.partCode;
    emit('sourceSearch', expected.value.partCode);
  }
}

function selectedSourceQuantity(row: InventorySourceBatchDetail) {
  return selectedSourceMap.value.get(row.id)?.quantity || 0;
}

function selectedQuantityWithout(batchId: string) {
  return selectedSourceRows.value
    .filter((source) => source.batchId !== batchId)
    .reduce((sum, source) => sum + Number(source.quantity || 0), 0);
}

function sourceMaxSelectableQuantity(row: InventorySourceBatchDetail) {
  if (!props.reviewMode || requiredQuantity.value <= 0) {
    return row.quantity;
  }
  return Math.max(0, Math.min(row.quantity, requiredQuantity.value - selectedQuantityWithout(row.id)));
}

function isSourceSelected(row: InventorySourceBatchDetail) {
  return selectedSourceQuantity(row) > 0;
}

function handleSourceChecked(row: InventorySourceBatchDetail, value: string | number | boolean) {
  toggleSourceSelection(row, Boolean(value));
}

function handleSourceQuantityChange(row: InventorySourceBatchDetail, value: number | undefined) {
  updateSourceSelection(row, Number(value || 0));
}

function toggleSourceSelection(row: InventorySourceBatchDetail, checked: boolean) {
  if (!checked) {
    updateSourceSelection(row, 0);
    return;
  }
  const remainingQuantity = Math.max(requiredQuantity.value - selectedQuantityTotal.value, 0);
  updateSourceSelection(row, Math.min(row.quantity, remainingQuantity || row.quantity));
}

function updateSourceSelection(row: InventorySourceBatchDetail, quantity: number) {
  const nextQuantity = Math.max(0, Math.min(Number(quantity || 0), sourceMaxSelectableQuantity(row)));
  const rows = selectedSourceRows.value.filter((source) => source.batchId !== row.id);
  const previous = selectedSourceMap.value.get(row.id);
  if (nextQuantity > 0) {
    const compatibility = compatibilityResult(row);
    rows.push({
      batchId: row.id,
      batchNo: row.batchNo,
      partCode: row.partCode,
      partName: row.partName,
      quantity: nextQuantity,
      availableQuantity: row.quantity,
      unit: row.unit,
      replenishmentSourceType: row.replenishmentSourceType,
      replenishmentSourceRequestNo: row.replenishmentSourceRequestNo,
      replenishmentSourceLabel: row.replenishmentSourceLabel,
      compatibilityStatus: selectionCompatibilityStatus(row),
      compatibilityReason: selectionCompatibilityReason(compatibility),
      manualConfirmedBy: previous?.manualConfirmedBy,
      manualConfirmedAt: previous?.manualConfirmedAt,
      manualConfirmRemark: previous?.manualConfirmRemark
    });
  }
  resetReviewConfirmation();
  emit('selectionChange', normalizeSelectedSources(rows));
}

function removeSelectedSource(batchId: string) {
  resetReviewConfirmation();
  emit(
    'selectionChange',
    selectedSourceRows.value.filter((source) => source.batchId !== batchId)
  );
}

function normalizeSelectedSources(sources: StockSourceSelectionPayload[]) {
  const rows = new Map<string, StockSourceSelectionPayload>();
  for (const source of sources || []) {
    const batchId = source.batchId?.trim();
    const quantity = Number(source.quantity || 0);
    if (!batchId || quantity <= 0) {
      continue;
    }
    const current = rows.get(batchId);
    rows.set(batchId, {
      batchId,
      batchNo: source.batchNo?.trim() || current?.batchNo,
      partCode: source.partCode?.trim() || current?.partCode,
      partName: source.partName?.trim() || current?.partName,
      quantity: (current?.quantity || 0) + quantity,
      availableQuantity: Math.max(Number(source.availableQuantity || 0), Number(current?.availableQuantity || 0)) || undefined,
      unit: source.unit?.trim() || current?.unit,
      replenishmentSourceType: source.replenishmentSourceType?.trim() || current?.replenishmentSourceType,
      replenishmentSourceRequestNo: source.replenishmentSourceRequestNo?.trim() || current?.replenishmentSourceRequestNo,
      replenishmentSourceLabel: source.replenishmentSourceLabel?.trim() || current?.replenishmentSourceLabel,
      compatibilityStatus: normalizeCompatibilityStatus(source.compatibilityStatus || current?.compatibilityStatus),
      compatibilityReason: source.compatibilityReason?.trim() || current?.compatibilityReason,
      manualConfirmedBy: source.manualConfirmedBy?.trim() || current?.manualConfirmedBy,
      manualConfirmedAt: source.manualConfirmedAt?.trim() || current?.manualConfirmedAt,
      manualConfirmRemark: source.manualConfirmRemark?.trim() || current?.manualConfirmRemark
    });
  }
  return [...rows.values()];
}

function resetReviewConfirmation() {
  reviewConfirmChecked.value = false;
}

function sourceTypeText(type: InventorySourceType) {
  return type === 'ORDER' ? '订单待发库存' : '备货库存';
}

function sourceKindText(kind?: string) {
  const map: Record<string, string> = {
    NORMAL_ORDER: '正常订单来源',
    CANCELLED_ORDER: '取消订单来源',
    CUSTOMER_CHANGE: '客户变更来源'
  };
  return map[kind || 'NORMAL_ORDER'] || kind || '正常订单来源';
}

function isFocusedSource(row: InventorySourceBatchDetail) {
  return Boolean(
    (props.focusBatchId && row.id === props.focusBatchId) ||
      (props.focusBatchNo && row.batchNo === props.focusBatchNo) ||
      (activeSearchFocusBatchNo.value && row.batchNo === activeSearchFocusBatchNo.value)
  );
}

function sourceRowRank(row: InventorySourceBatchDetail) {
  if (isFocusedSource(row)) {
    return 0;
  }
  return isSourceSelected(row) ? 1 : 2;
}

function sourceRowClassName({ row }: { row: InventorySourceBatchDetail }) {
  return isFocusedSource(row) ? 'source-row-focused' : '';
}

function productionOrderNo(row: InventorySourceBatchDetail) {
  return row.productionSourceOrderNo || '';
}

function productionCustomerName(row: InventorySourceBatchDetail) {
  return row.productionSourceCustomerName || '';
}

function replenishmentSourceText(row: InventorySourceBatchDetail) {
  if (row.replenishmentSourceLabel) {
    return row.replenishmentSourceLabel;
  }
  if (!row.replenishmentSourceType) {
    return '';
  }
  const label = row.replenishmentSourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单';
  return row.replenishmentSourceRequestNo ? `${label}：${row.replenishmentSourceRequestNo}` : label;
}

function selectedSourceReplenishmentText(source: StockSourceSelectionPayload) {
  if (source.replenishmentSourceLabel) {
    return source.replenishmentSourceLabel;
  }
  if (!source.replenishmentSourceType) {
    return '';
  }
  const label = source.replenishmentSourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单';
  return source.replenishmentSourceRequestNo ? `${label}：${source.replenishmentSourceRequestNo}` : label;
}

function drawingTitle(row: InventorySourceBatchDetail) {
  const drawingNo = row.drawingNo || '未记录图号';
  const version = row.drawingVersion ? ` / ${row.drawingVersion}` : '';
  return `${drawingNo}${version}`;
}

function directStockSourceMissingDrawingInfo(row: InventorySourceBatchDetail) {
  // 直接使用库存必须能追到来源图号、版本和图纸文件，人工说明不能替代缺失的来源图纸。
  return [
    !normalizeValue(row.drawingNo) ? '图号' : '',
    !normalizeValue(row.drawingVersion) ? '图纸版本' : '',
    !row.drawingFileUrl ? '图纸文件' : ''
  ].filter(Boolean);
}

function savedSourceMissingDrawingInfo(reason?: string) {
  return Boolean(reason && /库存缺图号|库存缺版本|库存缺图纸文件|库存图纸信息不完整|库存来源图纸资料不完整|来源图纸/.test(reason));
}

function normalizeValue(value?: string | number | null) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function sameText(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeValue(left);
  const normalizedRight = normalizeValue(right);
  if (!normalizedLeft || !normalizedRight) {
    return true;
  }
  return normalizedLeft === normalizedRight;
}

function sameNumber(left?: number | null, right?: number | null) {
  const leftNumber = Number(left ?? 0);
  const rightNumber = Number(right ?? 0);
  if (!leftNumber || !rightNumber) {
    return true;
  }
  return Math.abs(leftNumber - rightNumber) < 0.0001;
}

function compatibilityResult(row: InventorySourceBatchDetail) {
  const target = expected.value;
  if (!target) {
    return { type: 'info' as const, label: '未提供对照', reason: '' };
  }

  if (expectedMissingInfoReasons.value.length > 0) {
    return { type: 'warning' as const, label: '资料不完整', reason: `本次订单${expectedMissingInfoReasons.value.join('、')}` };
  }

  if (expectedFileMissing.value) {
    return { type: 'warning' as const, label: '资料不完整', reason: '本次订单未上传图纸文件' };
  }

  const missingReasons = [
    target.drawingNo && !row.drawingNo ? '库存缺图号' : '',
    target.drawingVersion && !row.drawingVersion ? '库存缺版本' : '',
    target.drawingFileUrl && !row.drawingFileUrl ? '库存缺图纸文件' : '',
    target.partSpecification && !row.partSpecification ? '库存缺规格' : '',
    target.partThickness && !row.partThickness ? '库存缺厚度' : ''
  ].filter(Boolean);
  if (missingReasons.length > 0) {
    return { type: 'warning' as const, label: '资料不完整', reason: missingReasons.join('、') };
  }

  const mismatchReasons = [
    sameText(row.partCode, target.partCode) ? '' : '物料编码不同',
    sameText(row.drawingNo, target.drawingNo) ? '' : '图号不同',
    sameText(row.drawingVersion, target.drawingVersion) ? '' : '版本不同',
    sameText(row.partSpecification, target.partSpecification) ? '' : '规格不同',
    sameNumber(row.partThickness, target.partThickness) ? '' : '厚度不同'
  ].filter(Boolean);

  if (mismatchReasons.length > 0) {
    return { type: 'danger' as const, label: '需要确认', reason: mismatchReasons.join('、') };
  }
  if (!row.drawingNo || !row.drawingVersion || !row.drawingFileUrl) {
    return { type: 'warning' as const, label: '资料不完整', reason: '库存图纸信息不完整' };
  }
  return { type: 'success' as const, label: '图纸匹配', reason: '' };
}

function compatibilityRank(row: InventorySourceBatchDetail) {
  const result = compatibilityResult(row).label;
  if (result === '图纸匹配') {
    return 0;
  }
  if (result === '需要确认') {
    return 1;
  }
  return 2;
}

function selectionCompatibilityStatus(row: InventorySourceBatchDetail): CompatibilityStatus {
  const result = compatibilityResult(row).label;
  if (result === '图纸匹配') {
    return 'MATCHED';
  }
  if (result === '需要确认') {
    return 'NEEDS_CONFIRMATION';
  }
  if (result === '资料不完整') {
    return 'INCOMPLETE';
  }
  return 'UNKNOWN';
}

function selectionCompatibilityReason(result: ReturnType<typeof compatibilityResult>) {
  if (result.reason) {
    return result.reason;
  }
  return result.label === '图纸匹配' ? '' : result.label;
}

function sourceNeedsManualConfirmation(source: StockSourceSelectionPayload) {
  return (
    source.compatibilityStatus !== 'MATCHED' ||
    !sameText(source.partCode, expected.value?.partCode) ||
    Boolean(expected.value?.fulfillmentMode === 'STOCK' && (!orderDrawingInfoComplete.value || expectedFileMissing.value))
  );
}

function normalizeCompatibilityStatus(value?: string): CompatibilityStatus | undefined {
  if (value === 'MATCHED' || value === 'NEEDS_CONFIRMATION' || value === 'INCOMPLETE' || value === 'UNKNOWN') {
    return value;
  }
  return undefined;
}

function formatDateTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function manualConfirmDateValid(value?: Date | string) {
  if (!value) {
    return false;
  }
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
}

function toManualConfirmDate(value?: string) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function createManualConfirmForm(source: StockSourceSelectionPayload): ManualConfirmForm {
  return {
    confirmedBy: source.manualConfirmedBy || '',
    confirmedAt: toManualConfirmDate(source.manualConfirmedAt),
    remark: source.manualConfirmRemark || ''
  };
}

function ensureManualConfirmForm(source: StockSourceSelectionPayload) {
  if (!manualConfirmForms.value[source.batchId]) {
    manualConfirmForms.value[source.batchId] = createManualConfirmForm(source);
  }
  return manualConfirmForms.value[source.batchId];
}

function syncManualConfirmForms() {
  const nextForms: Record<string, ManualConfirmForm> = {};
  for (const source of selectedIssueSources.value) {
    const current = manualConfirmForms.value[source.batchId];
    nextForms[source.batchId] = current || createManualConfirmForm(source);
  }
  manualConfirmForms.value = nextForms;
}

async function openOrderPreview(orderNo?: string) {
  const normalizedOrderNo = orderNo?.trim();
  if (!normalizedOrderNo) {
    return;
  }
  orderPreviewVisible.value = true;
  orderPreviewLoading.value = true;
  orderPreview.value = null;
  try {
    orderPreview.value = await erpApi.order(normalizedOrderNo);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单信息查询失败');
  } finally {
    orderPreviewLoading.value = false;
  }
}

function confirmReviewed() {
  if (!stockReviewQuantityOk.value) {
    ElMessage.warning(stockReviewQuantityText.value);
    return;
  }
  if (directStockBlockedIssue.value) {
    ElMessage.warning(directStockBlockedIssue.value);
    return;
  }
  if (!manualConfirmationOk.value) {
    ElMessage.warning('已选不适配库存，请填写确认人员、确认时间和使用说明');
    return;
  }
  if (!reviewConfirmChecked.value) {
    ElMessage.warning('请先勾选人工核对确认');
    return;
  }

  const confirmedAt = new Date();
  const nextSources = selectedSourceRows.value.map((source) => {
    if (!sourceNeedsManualConfirmation(source)) {
      return source;
    }
    const form = ensureManualConfirmForm(source);
    form.confirmedAt = confirmedAt;
    return {
      ...source,
      manualConfirmedBy: form.confirmedBy.trim(),
      manualConfirmedAt: (form.confirmedAt || confirmedAt).toISOString(),
      manualConfirmRemark: form.remark.trim()
    };
  });

  emit('selectionChange', normalizeSelectedSources(nextSources));
  emit('confirmReviewed');
}

function orderStatusText(status?: string) {
  const map: Record<string, string> = {
    DRAFT: '草稿',
    SUBMITTED: '已下单',
    IN_PRODUCTION: '生产中',
    PRODUCTION_COMPLETED: '生产完成',
    IN_WAREHOUSE: '已入库',
    WAITING_SHIPMENT: '待发货',
    COMPLETED: '订单完成',
    CANCELLED: '已取消'
  };
  return map[status || ''] || status || '-';
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      activeSearchFocusBatchNo.value = '';
      return;
    }
    reviewConfirmChecked.value = Boolean(props.reviewed);
    syncManualConfirmForms();
  }
);

watch(
  () => expected.value?.partCode,
  () => {
    activeSearchFocusBatchNo.value = '';
  }
);

watch(
  selectedIssueSources,
  () => {
    syncManualConfirmForms();
  },
  { deep: true, immediate: true, flush: 'sync' }
);
</script>

<style scoped>
.source-warning {
  margin-bottom: 14px;
}

.source-search-panel {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(360px, 1.4fr);
  gap: 12px;
  align-items: end;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
}

.source-search-panel > div:first-child {
  display: grid;
  gap: 4px;
}

.source-search-panel small {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.source-search-controls {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto auto;
  gap: 8px;
}

.source-search-results {
  grid-column: 1 / -1;
  display: grid;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
  padding-top: 4px;
}

.source-search-results > strong {
  color: #1e3a8a;
  font-size: 13px;
}

.source-search-result {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto minmax(160px, auto);
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  background: #ffffff;
  color: #334155;
  text-align: left;
  cursor: pointer;
}

.source-search-result:hover,
.source-search-result:focus {
  border-color: #409eff;
  outline: none;
}

.source-search-result span {
  color: #0f172a;
  font-weight: 600;
}

.source-detail-body {
  min-height: 180px;
}

.source-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.source-summary > div {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.source-summary span,
.source-summary small,
.cell-subtext,
.muted {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.source-summary strong,
.cell-main {
  color: #0f172a;
  font-weight: 600;
  line-height: 20px;
}

.batch-cell-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.source-selection-cell {
  display: grid;
  gap: 6px;
}

.source-selection-cell :deep(.el-input-number) {
  width: 100%;
}

.mobile-source-selection {
  display: grid;
  grid-template-columns: 1fr minmax(120px, 180px);
  gap: 8px;
  align-items: center;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #e2e8f0;
}

:deep(.source-row-focused > td) {
  background: #eff6ff !important;
}

:deep(.source-row-focused:hover > td) {
  background: #dbeafe !important;
}

.expected-card {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
}

.expected-warning {
  margin-top: 2px;
}

.expected-title {
  color: #0f172a;
  font-weight: 700;
}

.expected-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  color: #334155;
  font-size: 13px;
}

.warning-text {
  color: #dc2626;
}

.source-quantity-check {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
  color: #334155;
  font-size: 13px;
}

.source-quantity-check strong {
  color: #16a34a;
}

.source-quantity-check strong.danger {
  color: #dc2626;
}

.selected-source-card {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #f8fbff;
}

.selected-source-title {
  display: grid;
  gap: 4px;
}

.selected-source-title strong {
  color: #1e3a8a;
}

.selected-source-title span {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
}

.selected-source-list {
  display: grid;
  gap: 8px;
}

.selected-source-item {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #ffffff;
}

.selected-source-item > div {
  display: grid;
  gap: 3px;
}

.selected-source-item strong {
  color: #0f172a;
}

.selected-source-item span,
.selected-source-item small {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.selected-source-item .selected-source-manual-note {
  color: #b45309;
}

.selected-source-item .selected-source-replenishment-note {
  color: #2563eb;
}

.manual-confirm-card {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #fff7ed;
}

.manual-confirm-title {
  display: grid;
  gap: 4px;
}

.manual-confirm-title strong {
  color: #9a3412;
}

.manual-confirm-title span {
  color: #9a3412;
  font-size: 13px;
  line-height: 20px;
}

.manual-confirm-issues {
  display: grid;
  gap: 10px;
}

.manual-confirm-item {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #ffffff;
}

.manual-confirm-item-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.manual-confirm-item-head span {
  color: #9a3412;
  font-size: 13px;
  line-height: 20px;
}

.manual-confirm-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.manual-confirm-form label {
  display: grid;
  gap: 6px;
  color: #475569;
  font-size: 13px;
}

.manual-confirm-remark {
  grid-column: 1 / -1;
}

.source-mobile-list {
  margin-top: 0;
}

.source-mobile-card {
  border-color: #dbe3ef;
}

.source-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.source-confirm-hint {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
}

.source-confirm-left {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.source-dialog-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.inline-order-link {
  height: auto;
  padding: 0;
  vertical-align: baseline;
  font-weight: 600;
}

.order-preview-body {
  min-height: 160px;
}

.order-preview-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.order-preview-summary > div {
  display: grid;
  gap: 5px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.order-preview-summary span {
  color: #64748b;
  font-size: 12px;
}

.order-preview-summary strong {
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .source-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .expected-grid,
  .manual-confirm-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .source-search-panel {
    grid-template-columns: 1fr;
  }

  .order-preview-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .source-warning {
    margin-bottom: 10px;
  }

  .source-summary {
    grid-template-columns: 1fr;
  }

  .expected-grid,
  .manual-confirm-form,
  .order-preview-summary {
    grid-template-columns: 1fr;
  }

  .source-search-controls,
  .source-search-result,
  .mobile-source-selection {
    grid-template-columns: 1fr;
  }

  .source-dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .source-dialog-actions {
    display: grid;
    grid-template-columns: 1fr;
    justify-content: stretch;
  }

  .source-dialog-actions .el-button {
    width: 100%;
    margin-left: 0;
  }

  .selected-source-item {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
}
</style>
