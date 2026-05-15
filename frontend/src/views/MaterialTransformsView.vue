<template>
  <section class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">来源加工关系</h2>
        <p class="page-subtitle">维护通用件 / 半成品加工成客户零件的建议规则；不自动扣库存、不自动提交生产。</p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/materials')">返回零件管理</el-button>
        <el-button
          v-if="!isMobileLayout"
          type="primary"
          :loading="prefillLoading"
          :disabled="transformOperationBusy"
          @click="openCreateDialog"
        >
          新增关系
        </el-button>
      </div>
    </div>

    <el-alert
      class="transform-alert"
      type="info"
      :closable="false"
      show-icon
      title="业务边界"
      description="这里保存的是来源加工建议。是否使用库存、库存再加工或重新生产，仍然由订单提交生产时的库存来源核对决定。"
    />

    <section class="transform-usage-panel" aria-label="来源加工关系使用逻辑">
      <article>
        <strong>1. 先维护关系</strong>
        <span>记录“来源零件 -> 目标零件”、适用客户 / 机型、换算倍率、损耗和建议工艺。</span>
      </article>
      <article>
        <strong>2. 提交生产时提示</strong>
        <span>订单零件做库存来源核对时，系统会显示匹配的来源零件，并提供“查来源库存”。</span>
      </article>
      <article>
        <strong>3. 人工选择库存</strong>
        <span>操作员仍需逐批核对图号、版本、规格、厚度和数量，再确认是否使用库存再加工。</span>
      </article>
      <article class="no-auto-impact">
        <strong>不自动影响库存</strong>
        <span>新增或启用关系不会生成订单、不会创建生产任务、不会扣减来源库存。</span>
      </article>
    </section>

    <div class="filter-bar">
      <div class="filter-field">
        <label>关键字</label>
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="来源零件 / 目标零件 / 客户 / 工艺 / 拼音"
          style="width: 320px"
          @keyup.enter="searchRules"
        />
      </div>
      <div class="filter-field">
        <label>目标零件</label>
        <el-input
          v-model="filters.targetPartCode"
          clearable
          placeholder="例如 P-2002"
          style="width: 170px"
          @keyup.enter="searchRules"
        />
      </div>
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect v-model="filters.customerId" placeholder="全部客户范围" width="240px" @change="searchRules" />
      </div>
      <div class="filter-field">
        <label>机型 / 项目</label>
        <el-input v-model="filters.projectModel" clearable placeholder="例如 B3、B5" style="width: 180px" @keyup.enter="searchRules" />
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" style="width: 130px" @change="searchRules">
          <el-option label="全部" value="ALL" />
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>来源库存</label>
        <el-select v-model="filters.sourceStockStatus" style="width: 150px" @change="searchRules">
          <el-option label="全部" value="ALL" />
          <el-option label="有可用库存" value="WITH_STOCK" />
          <el-option label="无可用库存" value="NO_STOCK" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>目标库存</label>
        <el-select v-model="filters.targetStockStatus" style="width: 150px" @change="searchRules">
          <el-option label="全部" value="ALL" />
          <el-option label="有可用库存" value="WITH_STOCK" />
          <el-option label="无可用库存" value="NO_STOCK" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>库存判断</label>
        <el-select v-model="filters.inventoryDecision" style="width: 170px" @change="searchRules">
          <el-option label="全部" value="ALL" />
          <el-option label="先核对目标库存" value="TARGET_STOCK" />
          <el-option label="可核对来源再加工" value="SOURCE_REWORK" />
          <el-option label="暂无库存，考虑生产" value="NO_STOCK" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="searchRules">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
      <el-button :disabled="!transformRulesFixedText" @click="openTransformRulesTextDialog">查看固定格式</el-button>
      <el-button :disabled="rules.length === 0" @click="copyTransformRulesText">复制当前结果</el-button>
    </div>

    <div class="transform-summary-strip" aria-label="来源加工关系当前结果库存判断汇总">
      <span class="summary-caption">筛选结果 {{ rulePagination.total }} 条 / 当前页</span>
      <el-button size="small" :type="filters.inventoryDecision === 'ALL' ? 'primary' : ''" @click="setInventoryDecisionFilter('ALL')">
        全部 {{ transformDecisionSummary.total }}
      </el-button>
      <el-button
        size="small"
        :type="filters.inventoryDecision === 'TARGET_STOCK' ? 'success' : ''"
        @click="setInventoryDecisionFilter('TARGET_STOCK')"
      >
        先核对目标库存 {{ transformDecisionSummary.targetStock }}
      </el-button>
      <el-button
        size="small"
        :type="filters.inventoryDecision === 'SOURCE_REWORK' ? 'warning' : ''"
        @click="setInventoryDecisionFilter('SOURCE_REWORK')"
      >
        可核对来源再加工 {{ transformDecisionSummary.sourceRework }}
      </el-button>
      <el-button
        size="small"
        :type="filters.inventoryDecision === 'NO_STOCK' ? 'danger' : ''"
        @click="setInventoryDecisionFilter('NO_STOCK')"
      >
        暂无库存需生产 {{ transformDecisionSummary.noStock }}
      </el-button>
    </div>

    <div class="table-card desktop-table">
      <el-table v-loading="loading" :data="rules" max-height="650">
        <template #empty>
          <div class="transform-empty">
            <strong>暂无来源加工关系</strong>
            <span>可新增一条来源零件到目标零件的建议规则；保存后仍不会自动扣库存或提交生产。</span>
          </div>
        </template>
        <el-table-column label="来源零件" min-width="260">
          <template #default="{ row }">
            <div class="strong-text">{{ row.sourcePartCode }}</div>
            <div class="cell-subtext">{{ row.sourcePartName }} / {{ row.sourceUnit }}</div>
          </template>
        </el-table-column>
        <el-table-column label="目标零件" min-width="260">
          <template #default="{ row }">
            <div class="strong-text">{{ row.targetPartCode }}</div>
            <div class="cell-subtext">{{ row.targetPartName }} / {{ row.targetUnit }}</div>
          </template>
        </el-table-column>
        <el-table-column label="库存概况" min-width="210">
          <template #default="{ row }">
            <div class="stock-summary-line">
              <span>来源</span>
              <strong :class="{ 'is-empty': !row.sourceAvailableQuantity }">
                {{ formatQuantity(row.sourceAvailableQuantity ?? 0, row.sourceUnit) }}
              </strong>
              <em>{{ row.sourceAvailableBatchCount ?? 0 }} 批</em>
            </div>
            <div class="stock-summary-line target">
              <span>目标</span>
              <strong :class="{ 'is-empty': !row.targetAvailableQuantity }">
                {{ formatQuantity(row.targetAvailableQuantity ?? 0, row.targetUnit) }}
              </strong>
              <em>{{ row.targetAvailableBatchCount ?? 0 }} 批</em>
            </div>
            <el-tag class="inventory-decision-tag" :type="transformInventoryDecision(row).type" effect="plain" size="small">
              {{ transformInventoryDecision(row).label }}
            </el-tag>
            <div class="inventory-decision-reason">{{ transformInventoryDecisionReason(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="scopeLabel" label="适用范围" min-width="220" />
        <el-table-column label="换算" width="150">
          <template #default="{ row }">
            <div>倍率 {{ row.multiplier }}</div>
            <div class="cell-subtext">损耗 {{ row.lossRate ?? '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="defaultProcessRoute" label="建议工艺" min-width="180">
          <template #default="{ row }">{{ row.defaultProcessRoute || '-' }}</template>
        </el-table-column>
        <el-table-column prop="conversionDescription" label="转换说明" min-width="240">
          <template #default="{ row }">{{ row.conversionDescription || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
              {{ row.status === 'ENABLED' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :disabled="transformOperationBusy || sourceDetailsLoading"
              @click="openTransformSourceDetails(row)"
            >
              来源库存
            </el-button>
            <el-button
              link
              type="primary"
              :disabled="transformOperationBusy || sourceDetailsLoading"
              @click="openTransformTargetDetails(row)"
            >
              目标库存
            </el-button>
            <el-button link type="primary" :disabled="transformOperationBusy" @click="openEditDialog(row)">
              编辑
            </el-button>
            <el-button
              v-if="row.status === 'ENABLED'"
              link
              type="danger"
              :loading="operationSavingId === row.id"
              :disabled="transformOperationBusy"
              @click="disableRule(row)"
            >
              停用
            </el-button>
            <el-button
              v-else
              link
              type="success"
              :loading="operationSavingId === row.id"
              :disabled="transformOperationBusy"
              @click="enableRule(row)"
            >
              启用
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-pagination-row">
        <span>
          第 {{ rulePagination.page }} 页，已显示 {{ rules.length }} /
          {{ rulePagination.total }} 条来源加工关系
        </span>
        <el-pagination
          background
          layout="prev, pager, next"
          :current-page="rulePagination.page"
          :page-size="rulePagination.limit"
          :total="rulePagination.total"
          :disabled="loading"
          @current-change="handleRulePageChange"
        />
      </div>
    </div>

    <div class="mobile-section">
      <el-alert
        title="手机端仅查看来源加工关系"
        description="新增、编辑、停用和启用来源加工关系请在电脑端操作。"
        type="info"
        :closable="false"
      />
      <div v-for="row in rules" :key="row.id" class="mobile-card">
        <div class="mobile-card-title">
          <span>{{ row.sourcePartName }} -> {{ row.targetPartName }}</span>
          <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain" size="small">
            {{ row.status === 'ENABLED' ? '启用' : '停用' }}
          </el-tag>
        </div>
        <p>{{ row.sourcePartCode }} -> {{ row.targetPartCode }}</p>
        <p>
          来源库存 {{ formatQuantity(row.sourceAvailableQuantity ?? 0, row.sourceUnit) }} / {{ row.sourceAvailableBatchCount ?? 0 }} 批；
          目标库存 {{ formatQuantity(row.targetAvailableQuantity ?? 0, row.targetUnit) }} / {{ row.targetAvailableBatchCount ?? 0 }} 批
        </p>
        <el-tag :type="transformInventoryDecision(row).type" effect="plain" size="small">
          {{ transformInventoryDecision(row).label }}
        </el-tag>
        <p>{{ transformInventoryDecisionReason(row) }}</p>
        <p>{{ row.scopeLabel }} / 倍率 {{ row.multiplier }} / 损耗 {{ row.lossRate ?? '-' }}</p>
        <div class="mobile-actions">
          <el-button size="small" type="primary" plain :disabled="sourceDetailsLoading" @click="openTransformSourceDetails(row)">来源库存</el-button>
          <el-button size="small" type="primary" plain :disabled="sourceDetailsLoading" @click="openTransformTargetDetails(row)">目标库存</el-button>
          <span class="mobile-readonly-note">手机端只保留库存查看入口</span>
        </div>
      </div>
      <div class="mobile-pagination-row">
        <span>已显示 {{ rules.length }} / {{ rulePagination.total }} 条</span>
        <el-pagination
          small
          background
          layout="prev, pager, next"
          :current-page="rulePagination.page"
          :page-size="rulePagination.limit"
          :total="rulePagination.total"
          :disabled="loading"
          @current-change="handleRulePageChange"
        />
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      class="responsive-dialog"
      :title="dialogTitle"
      width="720px"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleRuleDialogClose"
    >
      <el-form label-width="120px">
        <el-form-item label="来源零件" required>
          <el-autocomplete
            v-model="form.sourceMaterialKeyword"
            :fetch-suggestions="querySourceMaterials"
            value-key="partCode"
            clearable
            placeholder="输入编码 / 名称 / 拼音搜索"
            style="width: 100%"
            @input="handleSourceMaterialKeywordInput"
            @select="selectSourceMaterial"
          >
            <template #default="{ item }">
              <div class="material-option">
                <strong>{{ item.partCode }}</strong>
                <span>{{ item.partName }} / {{ item.unit }}</span>
              </div>
            </template>
          </el-autocomplete>
        </el-form-item>
        <el-form-item label="目标零件" required>
          <el-autocomplete
            v-model="form.targetMaterialKeyword"
            :fetch-suggestions="queryTargetMaterials"
            value-key="partCode"
            clearable
            placeholder="输入编码 / 名称 / 拼音搜索"
            style="width: 100%"
            @input="handleTargetMaterialKeywordInput"
            @select="selectTargetMaterial"
          >
            <template #default="{ item }">
              <div class="material-option">
                <strong>{{ item.partCode }}</strong>
                <span>{{ item.partName }} / {{ item.unit }}</span>
              </div>
            </template>
          </el-autocomplete>
        </el-form-item>
        <el-form-item label="适用客户">
          <CustomerSelect v-model="form.customerId" placeholder="留空表示全部客户" width="100%" />
        </el-form-item>
        <el-form-item label="适用机型 / 项目">
          <el-input v-model="form.projectModel" placeholder="留空表示全部机型 / 项目" />
        </el-form-item>
        <div class="form-grid-2">
          <el-form-item label="换算倍率" required>
            <el-input-number v-model="form.multiplier" :min="0.001" :precision="3" :step="1" controls-position="right" />
          </el-form-item>
          <el-form-item label="损耗率">
            <el-input-number v-model="form.lossRate" :min="0" :precision="4" :step="0.01" controls-position="right" />
          </el-form-item>
        </div>
        <el-form-item label="建议工艺">
          <el-select
            v-model="form.defaultProcessRouteSteps"
            multiple
            filterable
            clearable
            placeholder="选择标准工序，拖拽调整顺序"
            style="width: 100%"
            @change="handleDefaultProcessRouteChange"
          >
            <el-option v-for="item in processDefinitions" :key="item.id" :label="item.processName" :value="item.processName" />
          </el-select>
          <small class="transform-process-help">建议工艺只作为下单和库存来源核对的初始建议；拖动手柄调整顺序，不会自动提交生产或扣库存。</small>
          <div
            v-if="form.defaultProcessRouteSteps.length > 0"
            class="transform-process-step-list"
            @dragover.self.prevent="handleTransformProcessListDragOverEnd"
            @drop.self.prevent="dropTransformProcessAtEnd"
          >
            <div
              v-for="(step, index) in form.defaultProcessRouteSteps"
              :key="`${step}-${index}`"
              class="transform-process-step-row"
              :class="{
                'is-dragging': draggedTransformProcessIndex === index,
                'is-drop-before': transformProcessDragOverIndex === index && !transformProcessDragInsertAfter,
                'is-drop-after': transformProcessDragOverIndex === index && transformProcessDragInsertAfter
              }"
              @dragenter.prevent="handleTransformProcessDragOver($event, index)"
              @dragover.prevent="handleTransformProcessDragOver($event, index)"
              @drop.prevent="dropTransformProcess($event, index)"
            >
              <button
                type="button"
                class="transform-process-drag-handle"
                :draggable="!transformOperationBusy"
                title="拖拽调整建议工艺顺序"
                aria-label="拖拽调整建议工艺顺序"
                @dragstart.stop="startTransformProcessDrag($event, index)"
                @dragend="endTransformProcessDrag"
              >
                <el-icon><Rank /></el-icon>
              </button>
              <span class="transform-process-index">{{ index + 1 }}</span>
              <strong>{{ step }}</strong>
              <el-button link type="danger" :disabled="transformOperationBusy" @click="removeTransformProcessStep(index)">删除</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="转换说明">
          <el-input v-model="form.conversionDescription" type="textarea" :rows="3" placeholder="例如 通用件 D 加工为客户 A 零件 5" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" :disabled="Boolean(form.id)" style="width: 160px">
            <el-option label="启用" value="ENABLED" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="transform-dialog-hint">
        <strong>保存影响</strong>
        <ul>
          <li>这里只保存来源加工建议，用于后续订单选料和库存来源核对提示。</li>
          <li>保存、启用或停用关系都不会生成订单、不会创建生产任务、不会扣减来源库存。</li>
          <li>建议工艺只作为初始建议；订单保存后每个订单零件仍会保留自己的流程快照。</li>
          <li>是否使用目标库存、来源库存再加工或重新生产，仍由提交生产时人工核对确认。</li>
        </ul>
      </div>
      <template #footer>
        <el-button :disabled="saving" @click="closeRuleDialog">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="transformOperationBusy" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>

    <InventorySourceDetailsDialog
      v-model="sourceDetailsVisible"
      :loading="sourceDetailsLoading"
      :detail="sourceDetails"
    />

    <el-dialog
      v-model="ruleStatusDialogVisible"
      class="responsive-dialog"
      :title="ruleStatusDialogTitle"
      width="560px"
      append-to-body
      :close-on-click-modal="!ruleStatusSaving"
      :close-on-press-escape="!ruleStatusSaving"
      :before-close="handleRuleStatusDialogClose"
    >
      <div v-if="ruleStatusTarget" class="transform-status-confirm">
        <p>
          确认{{ ruleStatusActionText }}来源加工关系
          <strong>{{ ruleStatusTarget.sourcePartCode }} -> {{ ruleStatusTarget.targetPartCode }}</strong>
          吗？
        </p>
        <ul>
          <li v-if="ruleStatusAction === 'disable'">
            停用只关闭后续建议入口，不删除关系记录，也不改订单、生产任务、库存批次或库存流水。
          </li>
          <li v-else>
            启用后只恢复建议展示；是否使用库存仍必须在库存来源核对中人工确认。
          </li>
          <li>本操作不会自动扣减来源库存、提交生产或生成订单。</li>
        </ul>
      </div>
      <template #footer>
        <el-button :disabled="ruleStatusSaving" @click="closeRuleStatusDialog">取消</el-button>
        <el-button
          :type="ruleStatusAction === 'disable' ? 'danger' : 'primary'"
          :loading="ruleStatusSaving"
          @click="confirmRuleStatusChange"
        >
          确认{{ ruleStatusActionText }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="transformRulesTextDialogVisible" class="responsive-dialog" title="来源加工关系固定格式清单" width="980px">
      <el-input
        class="fixed-format-textarea"
        :model-value="transformRulesFixedText"
        type="textarea"
        :rows="20"
        readonly
      />
      <template #footer>
        <el-button @click="transformRulesTextDialogVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!transformRulesFixedText" @click="copyTransformRulesText">复制清单</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Rank } from '@element-plus/icons-vue';
import { useRoute, useRouter } from 'vue-router';
import { erpApi, type SaveMaterialTransformRulePayload, type UpdateMaterialTransformRulePayload } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import InventorySourceDetailsDialog from '../components/InventorySourceDetailsDialog.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import type {
  CommonStatus,
  InventorySourceDetailResponse,
  MaterialMemory,
  MaterialTransformRule,
  ProcessDefinition
} from '../types/erp';
import { formatDateTime, formatQuantity } from '../utils/format';

const router = useRouter();
const route = useRoute();
const { isMobileLayout } = useDeviceProfile();
const loading = ref(false);
const saving = ref(false);
const prefillLoading = ref(false);
const operationSavingId = ref('');
const dialogVisible = ref(false);
const sourceDetailsVisible = ref(false);
const sourceDetailsLoading = ref(false);
const sourceDetails = ref<InventorySourceDetailResponse | null>(null);
const sourceDetailsRequestSeq = ref(0);
const transformRulesTextDialogVisible = ref(false);
const ruleStatusDialogVisible = ref(false);
const ruleStatusSaving = ref(false);
const ruleStatusTarget = ref<MaterialTransformRule | null>(null);
const ruleStatusAction = ref<'enable' | 'disable'>('disable');
const rules = ref<MaterialTransformRule[]>([]);
const processDefinitions = ref<ProcessDefinition[]>([]);
const sourceMaterialSearchSeq = ref(0);
const targetMaterialSearchSeq = ref(0);
const sourceMaterialSelectedLabel = ref('');
const targetMaterialSelectedLabel = ref('');
const draggedTransformProcessIndex = ref<number | null>(null);
const transformProcessDragOverIndex = ref<number | null>(null);
const transformProcessDragInsertAfter = ref(false);
const transformOperationBusy = computed(
  () => saving.value || prefillLoading.value || ruleStatusDialogVisible.value || ruleStatusSaving.value || Boolean(operationSavingId.value)
);
const rulePagination = reactive({
  page: Number(1),
  limit: Number(20),
  total: Number(0)
});

const filters = reactive<{
  keyword: string;
  targetPartCode: string;
  customerId?: string;
  projectModel: string;
  status: CommonStatus | 'ALL';
  sourceStockStatus: 'ALL' | 'WITH_STOCK' | 'NO_STOCK';
  targetStockStatus: 'ALL' | 'WITH_STOCK' | 'NO_STOCK';
  inventoryDecision: 'ALL' | 'TARGET_STOCK' | 'SOURCE_REWORK' | 'NO_STOCK';
}>({
  keyword: '',
  targetPartCode: '',
  customerId: undefined,
  projectModel: '',
  status: 'ENABLED',
  sourceStockStatus: 'ALL',
  targetStockStatus: 'ALL',
  inventoryDecision: 'ALL'
});

type TransformInventoryDecisionValue = 'TARGET_STOCK' | 'SOURCE_REWORK' | 'NO_STOCK';

const form = reactive({
  id: '',
  sourceMaterialId: '',
  sourceMaterialKeyword: '',
  targetMaterialId: '',
  targetMaterialKeyword: '',
  customerId: '',
  projectModel: '',
  conversionDescription: '',
  defaultProcessRouteSteps: [] as string[],
  multiplier: 1,
  lossRate: undefined as number | undefined,
  remark: '',
  status: 'ENABLED' as CommonStatus
});

const dialogTitle = computed(() => (form.id ? '编辑来源加工关系' : '新增来源加工关系'));
const ruleStatusActionText = computed(() => (ruleStatusAction.value === 'disable' ? '停用' : '启用'));
const ruleStatusDialogTitle = computed(() => `${ruleStatusActionText.value}来源加工关系`);

const transformDecisionSummary = computed(() => {
  const summary = {
    total: rules.value.length,
    targetStock: 0,
    sourceRework: 0,
    noStock: 0
  };
  for (const row of rules.value) {
    const decision = transformInventoryDecisionValue(row);
    if (decision === 'TARGET_STOCK') {
      summary.targetStock += 1;
    } else if (decision === 'SOURCE_REWORK') {
      summary.sourceRework += 1;
    } else {
      summary.noStock += 1;
    }
  }
  return summary;
});
const transformCustomerFilterLabel = computed(() => {
  if (!filters.customerId) {
    return '全部客户范围';
  }
  const customerName = rules.value.find((row) => row.customerId === filters.customerId)?.customerName;
  return customerName || filters.customerId;
});

const transformRulesFixedText = computed(() => {
  if (rules.value.length === 0) {
    return '';
  }
  const header = [
    '序号',
    '库存判断',
    '判断依据',
    '来源零件编码',
    '来源零件名称',
    '来源库存',
    '目标零件编码',
    '目标零件名称',
    '目标库存',
    '适用范围',
    '倍率',
    '损耗',
    '建议工艺',
    '转换说明',
    '状态',
    '更新时间'
  ].join('\t');
  const rows = rules.value.map((row, index) =>
    [
      index + 1,
      transformInventoryDecision(row).label,
      transformInventoryDecisionReason(row),
      row.sourcePartCode,
      row.sourcePartName,
      `${formatQuantity(row.sourceAvailableQuantity ?? 0, row.sourceUnit)} / ${row.sourceAvailableBatchCount ?? 0} 批`,
      row.targetPartCode,
      row.targetPartName,
      `${formatQuantity(row.targetAvailableQuantity ?? 0, row.targetUnit)} / ${row.targetAvailableBatchCount ?? 0} 批`,
      row.scopeLabel,
      row.multiplier,
      row.lossRate ?? '-',
      row.defaultProcessRoute || '-',
      row.conversionDescription || '-',
      row.status === 'ENABLED' ? '启用' : '停用',
      formatDateTime(row.updatedAt)
    ].join('\t')
  );
  const filterText = [
    `关键字 ${filters.keyword.trim() || '无'}`,
    `目标零件 ${filters.targetPartCode.trim() || '全部'}`,
    `客户 ${transformCustomerFilterLabel.value}`,
    `机型/项目 ${filters.projectModel.trim() || '全部'}`,
    `状态 ${filters.status}`,
    `来源库存 ${filters.sourceStockStatus}`,
    `目标库存 ${filters.targetStockStatus}`,
    `库存判断 ${filters.inventoryDecision}`
  ].join('；');
  const decisionSummary = transformDecisionSummary.value;
  return [
    `来源加工关系固定格式清单（当前页 ${rules.value.length} / 筛选结果 ${rulePagination.total} 条）`,
    '业务边界：只作为下单和库存来源核对建议；不会自动扣库存、不会自动提交生产、不会自动生成订单或生产任务。',
    `当前筛选：${filterText}`,
    `库存判断汇总：先核对目标库存 ${decisionSummary.targetStock}；可核对来源再加工 ${decisionSummary.sourceRework}；暂无库存需生产 ${decisionSummary.noStock}`,
    header,
    ...rows
  ].join('\n');
});

function transformInventoryDecisionValue(row: MaterialTransformRule): TransformInventoryDecisionValue {
  if ((row.targetAvailableQuantity ?? 0) > 0) {
    return 'TARGET_STOCK';
  }
  if ((row.sourceAvailableQuantity ?? 0) > 0) {
    return 'SOURCE_REWORK';
  }
  return 'NO_STOCK';
}

function transformInventoryDecision(row: MaterialTransformRule): { label: string; type: 'success' | 'warning' | 'danger' } {
  const decision = transformInventoryDecisionValue(row);
  if (decision === 'TARGET_STOCK') {
    return { label: '先核对目标库存', type: 'success' };
  }
  if (decision === 'SOURCE_REWORK') {
    return { label: '可核对来源再加工', type: 'warning' };
  }
  return { label: '暂无库存，考虑生产', type: 'danger' };
}

function transformInventoryDecisionReason(row: MaterialTransformRule) {
  const sourceQuantity = row.sourceAvailableQuantity ?? 0;
  const targetQuantity = row.targetAvailableQuantity ?? 0;
  if (targetQuantity > 0) {
    return `目标零件有 ${formatQuantity(targetQuantity, row.targetUnit)} 可用库存，提交生产时先打开目标库存批次核对。`;
  }
  if (sourceQuantity > 0) {
    return `目标零件暂无可用库存，来源零件有 ${formatQuantity(sourceQuantity, row.sourceUnit)} 可用库存，可在库存来源核对中人工选择再加工。`;
  }
  return '来源零件和目标零件都暂无可用库存，提交生产时仍需人工确认重新生产。';
}

function setInventoryDecisionFilter(value: 'ALL' | TransformInventoryDecisionValue) {
  filters.inventoryDecision = value;
  searchRules();
}

async function loadRules() {
  loading.value = true;
  try {
    const requestPage = Math.max(rulePagination.page, 1);
    const requestLimit = rulePagination.limit;
    const requestOffset = (requestPage - 1) * requestLimit;
    let result = await erpApi.materialTransformRulesPage({
      keyword: filters.keyword.trim() || undefined,
      targetPartCode: filters.targetPartCode.trim() || undefined,
      customerId: filters.customerId || undefined,
      projectModel: filters.projectModel.trim() || undefined,
      status: filters.status,
      sourceStockStatus: filters.sourceStockStatus,
      targetStockStatus: filters.targetStockStatus,
      inventoryDecision: filters.inventoryDecision,
      limit: requestLimit,
      offset: requestOffset
    });
    if (result.totalCount > 0 && result.items.length === 0 && requestPage > 1) {
      rulePagination.page = Math.max(Math.ceil(result.totalCount / requestLimit), 1);
      result = await erpApi.materialTransformRulesPage({
        keyword: filters.keyword.trim() || undefined,
        targetPartCode: filters.targetPartCode.trim() || undefined,
        customerId: filters.customerId || undefined,
        projectModel: filters.projectModel.trim() || undefined,
        status: filters.status,
        sourceStockStatus: filters.sourceStockStatus,
        targetStockStatus: filters.targetStockStatus,
        inventoryDecision: filters.inventoryDecision,
        limit: requestLimit,
        offset: (rulePagination.page - 1) * requestLimit
      });
    }
    rules.value = result.items;
    rulePagination.total = result.totalCount;
  } catch (error) {
    rules.value = [];
    rulePagination.total = Number(0);
    ElMessage.error(error instanceof Error ? error.message : '来源加工关系加载失败，请确认后端服务和筛选条件');
  } finally {
    loading.value = false;
  }
}

function searchRules() {
  rulePagination.page = Number(1);
  void loadRules();
}

function handleRulePageChange(page: number) {
  rulePagination.page = page;
  void loadRules();
}

async function loadProcessDefinitions() {
  try {
    processDefinitions.value = await erpApi.processDefinitions(undefined, 'ENABLED');
  } catch (error) {
    processDefinitions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '标准工序加载失败，来源加工关系默认工艺暂不可选');
  }
}

async function copyTransformRulesText() {
  if (!transformRulesFixedText.value) {
    ElMessage.warning('暂无可复制的来源加工关系清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(transformRulesFixedText.value);
    ElMessage.success('来源加工关系固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

function openTransformRulesTextDialog() {
  if (!transformRulesFixedText.value) {
    ElMessage.warning('暂无可查看的来源加工关系清单');
    return;
  }
  transformRulesTextDialogVisible.value = true;
}

function resetFilters() {
  filters.keyword = '';
  filters.targetPartCode = '';
  filters.customerId = undefined;
  filters.projectModel = '';
  filters.status = 'ENABLED';
  filters.sourceStockStatus = 'ALL';
  filters.targetStockStatus = 'ALL';
  filters.inventoryDecision = 'ALL';
  searchRules();
}

function routeQueryText(value: unknown) {
  return typeof value === 'string' ? value.trim() : Array.isArray(value) && typeof value[0] === 'string' ? value[0].trim() : '';
}

function applyRouteFilters() {
  const targetPartCode = routeQueryText(route.query.targetPartCode);
  const keyword = routeQueryText(route.query.keyword);
  const customerId = routeQueryText(route.query.customerId);
  const projectModel = routeQueryText(route.query.projectModel);
  const status = routeQueryText(route.query.status);
  const sourceStockStatus = routeQueryText(route.query.sourceStockStatus);
  const targetStockStatus = routeQueryText(route.query.targetStockStatus);
  const inventoryDecision = routeQueryText(route.query.inventoryDecision);
  filters.targetPartCode = targetPartCode;
  filters.keyword = keyword;
  filters.customerId = customerId || undefined;
  filters.projectModel = projectModel;
  filters.status = status === 'ALL' || status === 'DISABLED' ? status : 'ENABLED';
  filters.sourceStockStatus = sourceStockStatus === 'WITH_STOCK' || sourceStockStatus === 'NO_STOCK' ? sourceStockStatus : 'ALL';
  filters.targetStockStatus = targetStockStatus === 'WITH_STOCK' || targetStockStatus === 'NO_STOCK' ? targetStockStatus : 'ALL';
  filters.inventoryDecision =
    inventoryDecision === 'TARGET_STOCK' || inventoryDecision === 'SOURCE_REWORK' || inventoryDecision === 'NO_STOCK' ? inventoryDecision : 'ALL';
}

function resetForm() {
  form.id = '';
  form.sourceMaterialId = '';
  form.sourceMaterialKeyword = '';
  sourceMaterialSelectedLabel.value = '';
  form.targetMaterialId = '';
  form.targetMaterialKeyword = '';
  targetMaterialSelectedLabel.value = '';
  form.customerId = '';
  form.projectModel = '';
  form.conversionDescription = '';
  form.defaultProcessRouteSteps = [];
  resetTransformProcessDragState();
  form.multiplier = 1;
  form.lossRate = undefined;
  form.remark = '';
  form.status = 'ENABLED';
}

function isMobileViewport() {
  return isMobileLayout.value || (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
}

function showMobileDesktopNotice(actionLabel: string) {
  ElMessage.warning(`手机端仅查看来源加工关系，${actionLabel}请在电脑端操作`);
}

function guardDesktopOperation(actionLabel: string) {
  if (!isMobileViewport()) {
    return false;
  }
  showMobileDesktopNotice(actionLabel);
  return true;
}

function closeRuleDialog() {
  if (saving.value) {
    ElMessage.warning('来源加工关系正在保存，请等待保存完成');
    return;
  }
  dialogVisible.value = false;
}

function handleRuleDialogClose(done: () => void) {
  if (saving.value) {
    ElMessage.warning('来源加工关系正在保存，请等待保存完成');
    return;
  }
  done();
}

function openRuleStatusDialog(row: MaterialTransformRule, action: 'enable' | 'disable') {
  ruleStatusTarget.value = row;
  ruleStatusAction.value = action;
  ruleStatusDialogVisible.value = true;
}

function closeRuleStatusDialog() {
  if (ruleStatusSaving.value) {
    ElMessage.warning('来源加工关系状态正在保存，请等待操作完成');
    return;
  }
  ruleStatusDialogVisible.value = false;
  ruleStatusTarget.value = null;
}

function handleRuleStatusDialogClose(done: () => void) {
  if (ruleStatusSaving.value) {
    ElMessage.warning('来源加工关系状态正在保存，请等待操作完成');
    return;
  }
  ruleStatusTarget.value = null;
  done();
}

function normalizeMaterialCode(value: string) {
  return value.trim().toLocaleLowerCase('zh-CN');
}

async function prefillTargetMaterialFromFilter() {
  const targetPartCode = filters.targetPartCode.trim();
  if (!targetPartCode) {
    return;
  }
  prefillLoading.value = true;
  try {
    const rows = await erpApi.inventoryMaterials({ keyword: targetPartCode, status: 'ENABLED' });
    const matched = rows.find((item) => normalizeMaterialCode(item.partCode) === normalizeMaterialCode(targetPartCode));
    if (matched) {
      selectTargetMaterial(matched);
    } else {
      form.targetMaterialKeyword = targetPartCode;
      ElMessage.warning(`未找到目标零件 ${targetPartCode}，请先在零件基础库维护后再保存来源加工关系`);
    }
  } catch {
    form.targetMaterialKeyword = targetPartCode;
    ElMessage.warning(`目标零件 ${targetPartCode} 自动带入失败，请手动搜索选择`);
  } finally {
    prefillLoading.value = false;
  }
}

async function openCreateDialog() {
  if (guardDesktopOperation('新增关系')) {
    return;
  }
  if (transformOperationBusy.value) {
    return;
  }
  resetForm();
  form.customerId = filters.customerId || '';
  form.projectModel = filters.projectModel.trim();
  await prefillTargetMaterialFromFilter();
  dialogVisible.value = true;
}

function openEditDialog(row: MaterialTransformRule) {
  if (guardDesktopOperation('编辑关系')) {
    return;
  }
  if (transformOperationBusy.value) {
    return;
  }
  form.id = row.id;
  form.sourceMaterialId = row.sourceMaterialId;
  form.sourceMaterialKeyword = materialLabel(row.sourcePartCode, row.sourcePartName);
  sourceMaterialSelectedLabel.value = form.sourceMaterialKeyword;
  form.targetMaterialId = row.targetMaterialId;
  form.targetMaterialKeyword = materialLabel(row.targetPartCode, row.targetPartName);
  targetMaterialSelectedLabel.value = form.targetMaterialKeyword;
  form.customerId = row.customerId || '';
  form.projectModel = row.projectModel || '';
  form.conversionDescription = row.conversionDescription || '';
  form.defaultProcessRouteSteps = splitDefaultProcessRoute(row.defaultProcessRoute || '');
  form.multiplier = row.multiplier ?? 1;
  form.lossRate = row.lossRate ?? undefined;
  form.remark = row.remark || '';
  form.status = row.status;
  dialogVisible.value = true;
}

function materialLabel(partCode: string, partName: string) {
  return `${partCode} / ${partName}`;
}

function normalizeMaterialLabel(value: string) {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function handleSourceMaterialKeywordInput(value: string) {
  if (form.sourceMaterialId && normalizeMaterialLabel(value) !== normalizeMaterialLabel(sourceMaterialSelectedLabel.value)) {
    // 选中后再次手工修改来源零件文本时，必须清理旧 id，避免保存成界面文本和实际 Material 不一致的关系。
    form.sourceMaterialId = '';
    sourceMaterialSelectedLabel.value = '';
  }
}

function handleTargetMaterialKeywordInput(value: string) {
  if (form.targetMaterialId && normalizeMaterialLabel(value) !== normalizeMaterialLabel(targetMaterialSelectedLabel.value)) {
    // 选中后再次手工修改目标零件文本时，必须清理旧 id，避免保存成界面文本和实际 Material 不一致的关系。
    form.targetMaterialId = '';
    targetMaterialSelectedLabel.value = '';
  }
}

function splitDefaultProcessRoute(value: string) {
  return value
    .split(/(?:->|→|[、,，;；\n\r]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function handleDefaultProcessRouteChange() {
  normalizeTransformProcessSteps();
  resetTransformProcessDragState();
}

function normalizeTransformProcessSteps() {
  const seen = new Set<string>();
  const steps: string[] = [];
  for (const step of form.defaultProcessRouteSteps) {
    const processName = step.trim();
    const key = processName.toLocaleLowerCase('zh-CN');
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    steps.push(processName);
  }
  form.defaultProcessRouteSteps = steps;
}

function startTransformProcessDrag(event: DragEvent, index: number) {
  if (transformOperationBusy.value) {
    event.preventDefault();
    return;
  }
  draggedTransformProcessIndex.value = index;
  transformProcessDragOverIndex.value = index;
  transformProcessDragInsertAfter.value = false;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function handleTransformProcessDragOver(event: DragEvent, index: number) {
  if (draggedTransformProcessIndex.value === null || transformOperationBusy.value) {
    return;
  }
  transformProcessDragOverIndex.value = index;
  transformProcessDragInsertAfter.value = isTransformProcessDragAfterRowMiddle(event);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function handleTransformProcessListDragOverEnd(event: DragEvent) {
  if (draggedTransformProcessIndex.value === null || form.defaultProcessRouteSteps.length === 0 || transformOperationBusy.value) {
    return;
  }
  transformProcessDragOverIndex.value = form.defaultProcessRouteSteps.length - 1;
  transformProcessDragInsertAfter.value = true;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function dropTransformProcess(event: DragEvent, index: number) {
  if (draggedTransformProcessIndex.value === null || transformOperationBusy.value) {
    endTransformProcessDrag();
    return;
  }
  reorderTransformProcessStep(draggedTransformProcessIndex.value, index + (isTransformProcessDragAfterRowMiddle(event) ? 1 : 0));
  endTransformProcessDrag();
}

function dropTransformProcessAtEnd() {
  if (draggedTransformProcessIndex.value === null || transformOperationBusy.value) {
    endTransformProcessDrag();
    return;
  }
  reorderTransformProcessStep(draggedTransformProcessIndex.value, form.defaultProcessRouteSteps.length);
  endTransformProcessDrag();
}

function endTransformProcessDrag() {
  resetTransformProcessDragState();
}

function resetTransformProcessDragState() {
  draggedTransformProcessIndex.value = null;
  transformProcessDragOverIndex.value = null;
  transformProcessDragInsertAfter.value = false;
}

function isTransformProcessDragAfterRowMiddle(event: DragEvent) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const rect = target.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

function reorderTransformProcessStep(index: number, insertionIndex: number) {
  if (index < 0 || index >= form.defaultProcessRouteSteps.length) {
    return;
  }
  let target = Math.max(0, Math.min(insertionIndex, form.defaultProcessRouteSteps.length));
  if (index < target) {
    target -= 1;
  }
  if (index === target) {
    return;
  }
  const steps = [...form.defaultProcessRouteSteps];
  const [step] = steps.splice(index, 1);
  if (!step) {
    return;
  }
  steps.splice(target, 0, step);
  form.defaultProcessRouteSteps = steps;
}

function removeTransformProcessStep(index: number) {
  form.defaultProcessRouteSteps.splice(index, 1);
  resetTransformProcessDragState();
}

async function queryMaterials(keyword: string, sequenceRef: { value: number }, callback: (items: MaterialMemory[]) => void) {
  const requestId = ++sequenceRef.value;
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) {
    callback([]);
    return;
  }
  try {
    const rows = await erpApi.inventoryMaterials({ keyword: normalizedKeyword, status: 'ENABLED' });
    if (requestId === sequenceRef.value) {
      callback(rows);
    }
  } catch {
    if (requestId === sequenceRef.value) {
      callback([]);
    }
  }
}

function querySourceMaterials(keyword: string, callback: (items: MaterialMemory[]) => void) {
  void queryMaterials(keyword, sourceMaterialSearchSeq, callback);
}

function queryTargetMaterials(keyword: string, callback: (items: MaterialMemory[]) => void) {
  void queryMaterials(keyword, targetMaterialSearchSeq, callback);
}

function selectSourceMaterial(item: MaterialMemory) {
  form.sourceMaterialId = item.id;
  form.sourceMaterialKeyword = materialLabel(item.partCode, item.partName);
  sourceMaterialSelectedLabel.value = form.sourceMaterialKeyword;
}

function selectTargetMaterial(item: MaterialMemory) {
  form.targetMaterialId = item.id;
  form.targetMaterialKeyword = materialLabel(item.partCode, item.partName);
  targetMaterialSelectedLabel.value = form.targetMaterialKeyword;
}

function buildPayload(): SaveMaterialTransformRulePayload | undefined {
  if (!form.sourceMaterialId || !form.targetMaterialId) {
    ElMessage.warning('请选择来源零件和目标零件');
    return undefined;
  }
  if (form.sourceMaterialId === form.targetMaterialId) {
    ElMessage.warning('来源零件和目标零件不能相同');
    return undefined;
  }
  if (!form.multiplier || form.multiplier <= 0) {
    ElMessage.warning('换算倍率必须大于 0');
    return undefined;
  }
  normalizeTransformProcessSteps();
  return {
    sourceMaterialId: form.sourceMaterialId,
    targetMaterialId: form.targetMaterialId,
    customerId: form.customerId || undefined,
    projectModel: form.projectModel.trim() || undefined,
    conversionDescription: form.conversionDescription.trim() || undefined,
    defaultProcessRoute: form.defaultProcessRouteSteps.join('、') || undefined,
    multiplier: form.multiplier,
    lossRate: form.lossRate,
    remark: form.remark.trim() || undefined,
    ...(form.id ? {} : { status: form.status })
  };
}

async function saveRule() {
  if (guardDesktopOperation('保存关系')) {
    return;
  }
  if (transformOperationBusy.value) {
    return;
  }
  const payload = buildPayload();
  if (!payload) {
    return;
  }
  saving.value = true;
  try {
    if (form.id) {
      const updatePayload: UpdateMaterialTransformRulePayload = {
        sourceMaterialId: payload.sourceMaterialId,
        targetMaterialId: payload.targetMaterialId,
        customerId: payload.customerId,
        projectModel: payload.projectModel,
        conversionDescription: payload.conversionDescription,
        defaultProcessRoute: payload.defaultProcessRoute,
        multiplier: payload.multiplier,
        lossRate: payload.lossRate,
        remark: payload.remark
      };
      // 来源加工关系状态必须走 restoreMaterialTransformRule / disableMaterialTransformRule，普通编辑不携带 status。
      await erpApi.updateMaterialTransformRule(form.id, updatePayload);
    } else {
      await erpApi.createMaterialTransformRule(payload);
    }
    dialogVisible.value = false;
    ElMessage.success('来源加工关系已保存');
    await loadRules();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '来源加工关系保存失败');
  } finally {
    saving.value = false;
  }
}

function disableRule(row: MaterialTransformRule) {
  if (guardDesktopOperation('停用关系')) {
    return;
  }
  if (transformOperationBusy.value) {
    return;
  }
  openRuleStatusDialog(row, 'disable');
}

function enableRule(row: MaterialTransformRule) {
  if (guardDesktopOperation('启用关系')) {
    return;
  }
  if (transformOperationBusy.value) {
    return;
  }
  openRuleStatusDialog(row, 'enable');
}

async function confirmRuleStatusChange() {
  const row = ruleStatusTarget.value;
  if (!row || ruleStatusSaving.value) {
    return;
  }
  ruleStatusSaving.value = true;
  operationSavingId.value = row.id;
  try {
    if (ruleStatusAction.value === 'disable') {
      // 停用只关闭后续建议入口，不删除关系记录，也不改订单、生产任务、库存批次或库存流水。
      await erpApi.disableMaterialTransformRule(row.id);
      ElMessage.success('来源加工关系已停用');
    } else {
      // 恢复启用只恢复建议展示，不重写原来的客户范围、机型范围、倍率、损耗和工艺建议。
      await erpApi.restoreMaterialTransformRule(row.id);
      ElMessage.success('来源加工关系已启用');
    }
    ruleStatusDialogVisible.value = false;
    ruleStatusTarget.value = null;
    await loadRules();
  } catch (error) {
    const fallback = ruleStatusAction.value === 'disable' ? '来源加工关系停用失败' : '来源加工关系启用失败';
    ElMessage.error(error instanceof Error ? error.message : fallback);
  } finally {
    ruleStatusSaving.value = false;
    if (operationSavingId.value === row.id) {
      operationSavingId.value = '';
    }
  }
}

async function openTransformSourceDetails(row: MaterialTransformRule) {
  await openTransformInventoryDetails(row, 'source');
}

async function openTransformTargetDetails(row: MaterialTransformRule) {
  await openTransformInventoryDetails(row, 'target');
}

async function openTransformInventoryDetails(row: MaterialTransformRule, partRole: 'source' | 'target') {
  const partCode = (partRole === 'source' ? row.sourcePartCode : row.targetPartCode)?.trim();
  const unit = partRole === 'source' ? row.sourceUnit : row.targetUnit;
  const label = partRole === 'source' ? '来源零件' : '目标零件';
  if (!partCode) {
    ElMessage.warning(`${label}编码为空，无法查看库存来源`);
    return;
  }
  sourceDetailsVisible.value = true;
  sourceDetailsLoading.value = true;
  sourceDetails.value = null;
  const requestId = ++sourceDetailsRequestSeq.value;
  try {
    const detail = await erpApi.inventoryMaterialSourceDetails(partCode, {
      unit,
      sourceType: 'ALL',
      customerId: row.customerId || filters.customerId || undefined
    });
    if (requestId === sourceDetailsRequestSeq.value) {
      sourceDetails.value = detail;
    }
  } catch (error) {
    if (requestId === sourceDetailsRequestSeq.value) {
      sourceDetails.value = null;
      ElMessage.error(error instanceof Error ? error.message : `${label}库存查询失败，请确认零件和后端服务`);
    }
  } finally {
    if (requestId === sourceDetailsRequestSeq.value) {
      sourceDetailsLoading.value = false;
    }
  }
}

onMounted(() => {
  applyRouteFilters();
  void loadRules();
  void loadProcessDefinitions();
});

watch(
  () => route.query,
  () => {
    applyRouteFilters();
    searchRules();
  }
);
</script>

<style scoped>
.transform-alert {
  margin-bottom: 14px;
}

.transform-usage-panel {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.transform-usage-panel article {
  display: grid;
  gap: 6px;
  min-height: 92px;
  padding: 14px;
  border: 1px solid #dbe4ef;
  border-radius: 8px;
  background: #fff;
}

.transform-usage-panel article strong {
  color: #0f172a;
}

.transform-usage-panel article span {
  color: #64748b;
  font-size: 13px;
  line-height: 1.55;
}

.transform-usage-panel .no-auto-impact {
  border-color: #fed7aa;
  background: #fff7ed;
}

.transform-empty {
  display: grid;
  gap: 6px;
  padding: 28px 0;
  color: #64748b;
}

.transform-empty strong {
  color: #0f172a;
}

.transform-summary-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
}

.transform-summary-strip .el-button + .el-button {
  margin-left: 0;
}

.summary-caption {
  color: #64748b;
  font-size: 13px;
  white-space: nowrap;
}

.table-pagination-row,
.mobile-pagination-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px 14px;
  border-top: 1px solid #edf2f7;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.mobile-pagination-row {
  flex-wrap: wrap;
  padding: 12px 0 0;
  border-top: 0;
}

.strong-text {
  font-weight: 700;
}

.material-option {
  display: grid;
  gap: 2px;
}

.material-option span,
.cell-subtext {
  color: #64748b;
  font-size: 12px;
}

.stock-summary-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  line-height: 1.7;
}

.stock-summary-line span {
  width: 36px;
  color: #64748b;
}

.stock-summary-line strong {
  color: #0f172a;
  font-weight: 700;
}

.stock-summary-line strong.is-empty {
  color: #dc2626;
}

.stock-summary-line em {
  color: #94a3b8;
  font-style: normal;
}

.stock-summary-line.target strong {
  color: #2563eb;
}

.stock-summary-line.target strong.is-empty {
  color: #dc2626;
}

.inventory-decision-tag {
  margin-top: 4px;
}

.inventory-decision-reason {
  margin-top: 4px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.transform-process-help {
  display: block;
  margin-top: 8px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
}

.transform-process-step-list {
  display: grid;
  gap: 8px;
  width: min(460px, 100%);
  margin-top: 10px;
}

.transform-process-step-row {
  position: relative;
  display: grid;
  grid-template-columns: 30px 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.transform-process-step-row.is-dragging {
  opacity: 0.55;
}

.transform-process-step-row.is-drop-before,
.transform-process-step-row.is-drop-after {
  border-color: #60a5fa;
  background: #eff6ff;
}

.transform-process-step-row.is-drop-before::before,
.transform-process-step-row.is-drop-after::after {
  position: absolute;
  right: 8px;
  left: 8px;
  height: 2px;
  background: #2563eb;
  content: '';
}

.transform-process-step-row.is-drop-before::before {
  top: -6px;
}

.transform-process-step-row.is-drop-after::after {
  bottom: -6px;
}

.transform-process-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: #64748b;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: grab;
  font-size: 15px;
  line-height: 1;
}

.transform-process-drag-handle:active {
  cursor: grabbing;
}

.transform-process-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #1d4ed8;
  background: #dbeafe;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.transform-process-step-row strong {
  overflow: hidden;
  color: #0f172a;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transform-dialog-hint {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  padding: 12px 14px;
  color: #475569;
  background: #f8fafc;
  border: 1px solid #dbe4ef;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
}

.transform-dialog-hint strong {
  color: #0f172a;
}

.transform-dialog-hint ul {
  display: grid;
  gap: 4px;
  padding-left: 18px;
  margin: 0;
}

.transform-status-confirm {
  display: grid;
  gap: 10px;
  color: #475569;
  font-size: 14px;
  line-height: 1.65;
}

.transform-status-confirm p {
  margin: 0;
}

.transform-status-confirm strong {
  color: #0f172a;
}

.transform-status-confirm ul {
  display: grid;
  gap: 6px;
  padding-left: 18px;
  margin: 0;
}

.mobile-readonly-note {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  color: #64748b;
  font-size: 12px;
}

.fixed-format-textarea :deep(textarea) {
  min-height: 460px;
  font-family: Consolas, 'Courier New', monospace;
  line-height: 1.55;
  white-space: pre;
}

@media (max-width: 900px) {
  .transform-usage-panel {
    grid-template-columns: 1fr;
  }

  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
