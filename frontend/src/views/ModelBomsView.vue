<template>
  <section class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">机型零件包</h2>
        <p class="page-subtitle">维护 B3、B5 等机型/项目的标准零件清单；仅作为后续下单推荐基础。</p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/materials')">返回零件管理</el-button>
        <el-button type="primary" @click="openBomCreateDialog">新增零件包</el-button>
      </div>
    </div>

    <el-alert
      class="model-bom-alert"
      type="info"
      :closable="false"
      show-icon
      title="业务边界"
      description="机型零件包只维护客户/机型下应包含哪些零件和默认数量；不会自动生成订单、不会占库存、不会创建生产任务。"
    />
    <div class="mobile-section">
      <el-alert
        title="手机端仅查看机型零件包"
        description="新增、编辑、复制、停用、启用和拖拽排序请在电脑端操作。"
        type="info"
        :closable="false"
      />
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>关键字</label>
        <el-input v-model="filters.keyword" clearable placeholder="包名 / 机型 / 客户 / 零件" style="width: 260px" @keyup.enter="loadModelBoms" />
      </div>
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect v-model="filters.customerId" width="220px" placeholder="全部客户" />
      </div>
      <div class="filter-field">
        <label>机型/项目</label>
        <el-input v-model="filters.projectModel" clearable placeholder="例如 B3 / B5" style="width: 180px" @keyup.enter="loadModelBoms" />
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" placeholder="状态" style="width: 130px" @change="loadModelBoms">
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="loadModelBoms">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="model-bom-layout">
      <div class="table-card">
        <div class="section-heading">
          <div>
            <strong>零件包列表</strong>
            <span>点击一行查看和维护包内零件。</span>
          </div>
        </div>
        <el-table v-loading="loading" :data="modelBoms" max-height="620" highlight-current-row @row-click="selectBom">
          <el-table-column prop="bomName" label="零件包" min-width="160" />
          <el-table-column prop="scopeLabel" label="适用范围" min-width="210" />
          <el-table-column prop="lineCount" label="零件数" width="90" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
                {{ row.status === 'ENABLED' ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click.stop="openBomEditDialog(row)">编辑</el-button>
              <el-button v-if="!row.customerId" link type="primary" @click.stop="openBomCopyDialog(row)">复制给客户</el-button>
              <el-button v-if="row.status === 'ENABLED'" link type="danger" @click.stop="disableBom(row)">停用</el-button>
              <el-button v-else link type="success" @click.stop="enableBom(row)">启用</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="table-card">
        <div class="section-heading">
          <div>
            <strong>{{ activeBom ? `${activeBom.bomName} 明细` : '零件包明细' }}</strong>
            <span>{{ activeBom ? activeBom.scopeLabel : '先选择左侧零件包' }}</span>
          </div>
          <el-button type="primary" plain :disabled="!activeBom" @click="openLineCreateDialog">添加明细</el-button>
        </div>
        <div v-if="activeBom" class="bom-structure-panel">
          <div class="bom-structure-panel__header">
            <div>
              <strong>固定格式清单</strong>
              <span>{{ activeBomStructureGroups.length }} 组 / {{ activeBomDisplayLines.length }} 行</span>
            </div>
            <el-button size="small" :disabled="activeBomDisplayLines.length === 0" @click="copyBomStructureText">复制清单</el-button>
          </div>
          <div v-if="activeBomStructureGroups.length > 0" class="bom-structure-list">
            <div v-for="(group, groupIndex) in activeBomStructureGroups" :key="group.id" class="bom-structure-group">
              <div class="bom-structure-main">
                <span class="bom-structure-index">{{ groupIndex + 1 }}</span>
                <el-tag :type="group.type === 'component' ? 'warning' : group.type === 'orphan' ? 'danger' : 'info'" effect="plain">
                  {{ group.type === 'component' ? `组件 ${group.line.componentNo || '-'}` : group.type === 'orphan' ? `未匹配父级 ${group.line.parentComponentNo || '-'}` : '单独零件' }}
                </el-tag>
                <strong>{{ formatFixedLineCore(group.line) }}</strong>
                <span>{{ formatFixedLineMeta(group.line) }}</span>
              </div>
              <div
                v-for="(child, childIndex) in group.children"
                :key="child.id"
                class="bom-structure-child"
              >
                <span>{{ `${groupIndex + 1}.${childIndex + 1}` }}</span>
                <el-tag type="success" effect="plain">子零件</el-tag>
                <strong>{{ formatFixedLineCore(child) }}</strong>
                <span>{{ formatFixedLineMeta(child) }}</span>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无固定格式清单" />
        </div>
        <div v-if="activeBom?.sourceBomId" v-loading="sourceBomDiffLoading" class="bom-source-diff-panel">
          <div class="bom-source-diff-header">
            <div>
              <strong>来源 BOM 差异</strong>
              <span>来源：{{ activeSourceBomName }}</span>
            </div>
            <el-tag :type="sourceBomDiffIssues.length === 0 ? 'success' : 'warning'" effect="plain">
              {{ sourceBomDiffIssues.length === 0 ? '无差异' : `${sourceBomDiffIssues.length} 项差异` }}
            </el-tag>
          </div>
          <el-alert
            v-if="!sourceBomForDiff && !sourceBomDiffLoading"
            title="未能读取来源 BOM，当前客户 BOM 仍可独立维护，但无法提示与百胜通用 BOM 的差异。"
            type="warning"
            :closable="false"
          />
          <div v-else-if="sourceBomDiffIssues.length > 0" class="bom-source-diff-list">
            <article v-for="issue in sourceBomDiffIssues" :key="issue.id" class="bom-source-diff-item">
              <el-tag :type="issue.severity === 'warning' ? 'warning' : 'info'" effect="plain" size="small">
                {{ issue.severity === 'warning' ? '需核对' : '客户差异' }}
              </el-tag>
              <div>
                <strong>{{ issue.title }}</strong>
                <span>{{ issue.detail }}</span>
              </div>
            </article>
          </div>
          <div v-else class="bom-source-diff-empty">
            客户 BOM 与来源百胜通用 BOM 当前一致；后续来源更新只提示差异，不自动覆盖客户 BOM。
          </div>
        </div>
        <div class="bom-line-table" @dragover.self.prevent="handleLineListDragOverEnd" @drop.self.prevent="dropLineDragAtEnd">
          <div class="bom-line-row bom-line-row--head">
            <div>顺序</div>
            <div>结构</div>
            <div>零件编码</div>
            <div>零件名称</div>
            <div>默认数量</div>
            <div>默认图纸</div>
            <div>默认工艺</div>
            <div>规格</div>
            <div>状态</div>
            <div>操作</div>
          </div>
          <el-empty v-if="activeBomDisplayLines.length === 0" description="暂无包内明细" />
          <div v-else class="bom-line-body">
            <div
              v-for="(row, index) in activeBomDisplayLines"
              :key="row.id"
              :class="[
                'bom-line-row',
                {
                  'is-dragging': draggedLineIndex === index,
                  'is-drop-before': dragOverLineIndex === index && !dragOverLineInsertAfter,
                  'is-drop-after': dragOverLineIndex === index && dragOverLineInsertAfter
                }
              ]"
              @dragenter.prevent="handleLineDragOver($event, index)"
              @dragover.prevent="handleLineDragOver($event, index)"
              @drop.prevent="dropLineDrag"
            >
              <div class="bom-line-sort-cell">
                <el-button
                  class="bom-line-drag-handle"
                  text
                  :draggable="!saving"
                  :disabled="saving"
                  title="拖动调整顺序"
                  @dragstart.stop="startLineDrag($event, index)"
                  @dragend="endLineDrag"
                >
                  <el-icon><Rank /></el-icon>
                </el-button>
                <span>{{ row.sortOrder }}</span>
              </div>
              <div :class="['bom-line-structure', lineStructureClass(row)]">
                <el-tag :type="row.lineType === 'COMPONENT' ? 'warning' : row.parentComponentNo ? 'success' : 'info'" effect="plain">
                  {{ formatLineStructure(row) }}
                </el-tag>
                <span v-if="row.partCategory">{{ row.partCategory }}</span>
              </div>
              <div class="bom-line-text">{{ row.partCode }}</div>
              <div class="bom-line-text">{{ row.partName }}</div>
              <div>{{ formatQuantity(row.defaultQuantity, row.unit) }}</div>
              <div class="bom-line-text">{{ formatLineDrawing(row) }}</div>
              <div class="bom-line-text">{{ row.defaultProcessRoute || '-' }}</div>
              <div class="bom-line-text">{{ row.partSpecification || '-' }}</div>
              <div>
                <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
                  {{ row.status === 'ENABLED' ? '启用' : '停用' }}
                </el-tag>
              </div>
              <div class="bom-line-actions">
                <el-button link type="primary" @click="openLineEditDialog(row)">编辑</el-button>
                <el-button v-if="row.status === 'ENABLED'" link type="danger" @click="disableLine(row)">停用</el-button>
                <el-button v-else link type="success" @click="enableLine(row)">启用</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-dialog v-model="bomDialogVisible" class="responsive-dialog" :title="bomForm.id ? '编辑机型零件包' : '新增机型零件包'" width="620px">
      <el-form label-width="120px">
        <el-form-item label="零件包名称" required>
          <el-input v-model="bomForm.bomName" placeholder="例如 B3 标准零件包" />
        </el-form-item>
        <el-form-item label="客户范围">
          <el-select v-model="bomForm.customerScope" style="width: 220px" @change="handleBomCustomerScopeChange">
            <el-option label="全部客户" value="ALL" />
            <el-option label="指定客户" value="SPECIFIC" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="bomForm.customerScope === 'SPECIFIC'" label="指定客户" required>
          <CustomerSelect v-model="bomForm.customerId" width="280px" placeholder="选择客户" />
        </el-form-item>
        <el-form-item label="机型/项目" required>
          <el-input v-model="bomForm.projectModel" placeholder="例如 B3 / B5 / C型15P" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="bomForm.status" style="width: 160px">
            <el-option label="启用" value="ENABLED" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="bomForm.remark" type="textarea" :rows="3" placeholder="例如 B3 常规配置，客户A专用版本" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="bomDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveBom">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="copyDialogVisible" class="responsive-dialog" title="复制百胜通用零件包" width="620px">
      <el-form label-width="120px">
        <el-form-item label="来源零件包">
          <el-input v-model="copyForm.sourceBomName" disabled />
        </el-form-item>
        <el-form-item label="目标客户" required>
          <CustomerSelect v-model="copyForm.customerId" width="300px" placeholder="选择客户" status="ENABLED" />
        </el-form-item>
        <el-form-item label="客户零件包名" required>
          <el-input v-model="copyForm.bomName" placeholder="例如 B3 标准零件包-客户A" />
        </el-form-item>
        <el-form-item label="机型/项目" required>
          <el-input v-model="copyForm.projectModel" placeholder="例如 B3 / B5 / C型15P" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="copyForm.remark" type="textarea" :rows="3" placeholder="复制后客户 BOM 独立维护，不影响百胜通用 BOM" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="copyDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="copyBom">确认复制</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="lineDialogVisible" class="responsive-dialog" :title="lineForm.id ? '编辑包内零件' : '添加包内零件'" width="640px">
      <el-form label-width="120px">
        <el-form-item label="结构类型" required>
          <el-radio-group v-model="lineForm.structureType" @change="handleLineStructureChange">
            <el-radio-button label="STANDALONE_PART">单独零件</el-radio-button>
            <el-radio-button label="COMPONENT">组件</el-radio-button>
            <el-radio-button label="CHILD_PART">组件子零件</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="lineForm.structureType === 'COMPONENT'" label="组件编号" required>
          <el-input v-model="lineForm.componentNo" placeholder="例如 C001" style="width: 180px" />
        </el-form-item>
        <el-form-item v-if="lineForm.structureType === 'CHILD_PART'" label="所属组件" required>
          <el-select v-model="lineForm.parentComponentNo" placeholder="选择父级组件" style="width: 260px">
            <el-option
              v-for="item in availableParentComponents"
              :key="item.id"
              :label="`${item.componentNo} / ${item.partCode} ${item.partName}`"
              :value="item.componentNo || ''"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="零件" required>
          <el-autocomplete
            v-model="lineForm.materialKeyword"
            :fetch-suggestions="queryMaterials"
            value-key="partCode"
            placeholder="输入编码 / 名称 / 拼音搜索零件"
            style="width: 360px"
            @select="selectMaterial"
          >
            <template #default="{ item }">
              <div class="material-option">
                <strong>{{ item.partCode }}</strong>
                <span>{{ item.partName }} / {{ item.unit }}</span>
              </div>
            </template>
          </el-autocomplete>
        </el-form-item>
        <el-form-item label="零件类型">
          <el-select v-model="lineForm.partCategory" clearable placeholder="通用件 / 定制件" style="width: 200px">
            <el-option label="百胜通用件" value="百胜通用件" />
            <el-option label="客户通用件" value="客户通用件" />
            <el-option label="客户定制件" value="客户定制件" />
            <el-option label="半成品" value="半成品" />
          </el-select>
        </el-form-item>
        <el-form-item label="默认数量" required>
          <el-input-number v-model="lineForm.defaultQuantity" :min="0.001" :precision="3" :step="1" />
        </el-form-item>
        <el-form-item label="默认图纸">
          <el-select
            v-model="lineForm.defaultDrawingRevisionId"
            clearable
            filterable
            placeholder="不指定则使用零件默认或最新图纸"
            style="width: 360px"
            :disabled="!lineForm.materialId"
          >
            <el-option
              v-for="item in lineDrawingRevisions"
              :key="item.id"
              :label="formatDrawingRevisionOption(item)"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="默认工艺">
          <el-select
            v-model="lineForm.defaultProcessRouteSteps"
            multiple
            filterable
            clearable
            placeholder="选择标准工序，按选择顺序保存"
            style="width: 420px"
          >
            <el-option v-for="item in processDefinitions" :key="item.id" :label="item.processName" :value="item.processName" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="lineForm.sortOrder" :min="0" :step="10" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="lineForm.status" style="width: 160px">
            <el-option label="启用" value="ENABLED" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="lineForm.remark" type="textarea" :rows="3" placeholder="例如 B3 每台 2 件" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="lineDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveLine">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Rank } from '@element-plus/icons-vue';
import { erpApi, type CopyModelBomPayload, type SaveModelBomLinePayload } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import type { CommonStatus, MaterialDrawingRevision, MaterialMemory, ModelBom, ModelBomLine, ProcessDefinition } from '../types/erp';

type BomLineStructureType = 'STANDALONE_PART' | 'COMPONENT' | 'CHILD_PART';
type BomStructureGroup = {
  id: string;
  type: 'component' | 'standalone' | 'orphan';
  line: ModelBomLine;
  children: ModelBomLine[];
};
type BomDiffIssue = {
  id: string;
  severity: 'warning' | 'info';
  title: string;
  detail: string;
};

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const saving = ref(false);
const bomDialogVisible = ref(false);
const copyDialogVisible = ref(false);
const lineDialogVisible = ref(false);
const modelBoms = ref<ModelBom[]>([]);
const activeBomId = ref('');
const sourceBomForDiff = ref<ModelBom | null>(null);
const sourceBomDiffLoading = ref(false);
const lineDrawingRevisions = ref<MaterialDrawingRevision[]>([]);
const processDefinitions = ref<ProcessDefinition[]>([]);
const materialSearchSeq = ref(0);
const draggedLineIndex = ref<number | null>(null);
const dragOverLineIndex = ref<number | null>(null);
const dragOverLineInsertAfter = ref(false);

const filters = reactive<{
  keyword: string;
  customerId: string;
  projectModel: string;
  status: CommonStatus;
}>({
  keyword: '',
  customerId: '',
  projectModel: '',
  status: 'ENABLED'
});

const bomForm = reactive<{
  id: string;
  bomName: string;
  customerScope: 'ALL' | 'SPECIFIC';
  customerId: string;
  projectModel: string;
  remark: string;
  status: CommonStatus;
}>({
  id: '',
  bomName: '',
  customerScope: 'ALL',
  customerId: '',
  projectModel: '',
  remark: '',
  status: 'ENABLED'
});

const copyForm = reactive<{
  sourceBomId: string;
  sourceBomName: string;
  customerId: string;
  bomName: string;
  projectModel: string;
  remark: string;
}>({
  sourceBomId: '',
  sourceBomName: '',
  customerId: '',
  bomName: '',
  projectModel: '',
  remark: ''
});

const lineForm = reactive<{
  id: string;
  materialId: string;
  materialKeyword: string;
  structureType: BomLineStructureType;
  partCategory: string;
  componentNo: string;
  parentComponentNo: string;
  defaultDrawingRevisionId: string;
  defaultProcessRouteSteps: string[];
  defaultQuantity: number;
  sortOrder: number;
  remark: string;
  status: CommonStatus;
}>({
  id: '',
  materialId: '',
  materialKeyword: '',
  structureType: 'STANDALONE_PART',
  partCategory: '',
  componentNo: '',
  parentComponentNo: '',
  defaultDrawingRevisionId: '',
  defaultProcessRouteSteps: [],
  defaultQuantity: 1,
  sortOrder: 0,
  remark: '',
  status: 'ENABLED'
});

const activeBom = computed(() => modelBoms.value.find((item) => item.id === activeBomId.value));
const activeSourceBomName = computed(() => sourceBomForDiff.value?.bomName || activeBom.value?.sourceBomNameSnapshot || '百胜通用 BOM');
const sortedActiveBomLines = computed(() => [...(activeBom.value?.lines || [])].sort(compareBomLines));
const activeBomDisplayLines = computed(() => {
  const lines = sortedActiveBomLines.value;
  const childrenByParent = new Map<string, ModelBomLine[]>();
  const rootLines: ModelBomLine[] = [];
  for (const line of lines) {
    if (line.lineType === 'PART' && line.parentComponentNo) {
      const key = line.parentComponentNo;
      childrenByParent.set(key, [...(childrenByParent.get(key) || []), line]);
    } else {
      rootLines.push(line);
    }
  }
  const ordered: ModelBomLine[] = [];
  const attachedIds = new Set<string>();
  for (const line of rootLines) {
    ordered.push(line);
    if (line.lineType === 'COMPONENT' && line.componentNo) {
      for (const child of childrenByParent.get(line.componentNo) || []) {
        ordered.push(child);
        attachedIds.add(child.id);
      }
    }
  }
  for (const line of lines) {
    if (line.lineType === 'PART' && line.parentComponentNo && !attachedIds.has(line.id)) {
      ordered.push(line);
    }
  }
  return ordered;
});
const activeBomStructureGroups = computed<BomStructureGroup[]>(() => {
  const lines = sortedActiveBomLines.value;
  const childrenByParent = new Map<string, ModelBomLine[]>();
  const rootLines: ModelBomLine[] = [];
  for (const line of lines) {
    if (line.lineType === 'PART' && line.parentComponentNo) {
      const key = line.parentComponentNo;
      childrenByParent.set(key, [...(childrenByParent.get(key) || []), line]);
    } else {
      rootLines.push(line);
    }
  }
  const groups: BomStructureGroup[] = [];
  const attachedIds = new Set<string>();
  for (const line of rootLines) {
    if (line.lineType === 'COMPONENT') {
      const children = line.componentNo ? childrenByParent.get(line.componentNo) || [] : [];
      children.forEach((child) => attachedIds.add(child.id));
      groups.push({ id: `component-${line.id}`, type: 'component', line, children });
      continue;
    }
    groups.push({ id: `standalone-${line.id}`, type: 'standalone', line, children: [] });
  }
  for (const line of lines) {
    if (line.lineType === 'PART' && line.parentComponentNo && !attachedIds.has(line.id)) {
      groups.push({ id: `orphan-${line.id}`, type: 'orphan', line, children: [] });
    }
  }
  return groups;
});
const availableParentComponents = computed(() =>
  sortedActiveBomLines.value.filter((line) => line.lineType === 'COMPONENT' && line.status === 'ENABLED' && line.id !== lineForm.id && !!line.componentNo)
);
const sourceBomDiffIssues = computed<BomDiffIssue[]>(() => {
  if (!activeBom.value?.sourceBomId || !sourceBomForDiff.value) {
    return [];
  }
  return buildSourceBomDiffIssues(sourceBomForDiff.value, activeBom.value);
});

onMounted(() => {
  applyRouteQueryFilters();
  void loadModelBoms();
  void loadProcessDefinitions();
});

watch(
  () => activeBom.value?.sourceBomId || '',
  (sourceBomId) => {
    void loadSourceBomForDiff(sourceBomId);
  },
  { immediate: true }
);

function routeQueryText(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
}

function applyRouteQueryFilters() {
  const keyword = routeQueryText(route.query.keyword);
  const customerId = routeQueryText(route.query.customerId);
  const projectModel = routeQueryText(route.query.projectModel);
  const status = routeQueryText(route.query.status);
  if (keyword) {
    filters.keyword = keyword;
  }
  if (customerId) {
    filters.customerId = customerId;
  }
  if (projectModel) {
    filters.projectModel = projectModel;
  }
  if (status === 'ENABLED' || status === 'DISABLED') {
    filters.status = status;
  }
}

async function loadModelBoms() {
  loading.value = true;
  try {
    const rows = await erpApi.modelBoms({
      keyword: filters.keyword.trim() || undefined,
      customerId: filters.customerId || undefined,
      projectModel: filters.projectModel.trim() || undefined,
      status: filters.status
    });
    modelBoms.value = rows;
    if (!activeBomId.value || !rows.some((item) => item.id === activeBomId.value)) {
      activeBomId.value = rows[0]?.id || '';
    }
  } finally {
    loading.value = false;
  }
}

async function loadSourceBomForDiff(sourceBomId: string) {
  sourceBomForDiff.value = null;
  if (!sourceBomId) {
    return;
  }
  const cached = modelBoms.value.find((item) => item.id === sourceBomId);
  if (cached) {
    sourceBomForDiff.value = cached;
    return;
  }
  sourceBomDiffLoading.value = true;
  try {
    sourceBomForDiff.value = await erpApi.modelBom(sourceBomId);
  } catch (error) {
    sourceBomForDiff.value = null;
    ElMessage.warning(error instanceof Error ? error.message : '来源 BOM 差异加载失败');
  } finally {
    sourceBomDiffLoading.value = false;
  }
}

async function loadProcessDefinitions() {
  processDefinitions.value = await erpApi.processDefinitions(undefined, 'ENABLED');
}

async function loadLineDrawingRevisions(materialId: string) {
  if (!materialId) {
    lineDrawingRevisions.value = [];
    return;
  }
  const response = await erpApi.materialDrawingRevisions(materialId);
  lineDrawingRevisions.value = response.items.filter((item) => item.status === 'ENABLED');
}

function resetFilters() {
  filters.keyword = '';
  filters.customerId = '';
  filters.projectModel = '';
  filters.status = 'ENABLED';
  void loadModelBoms();
}

function selectBom(row: ModelBom) {
  activeBomId.value = row.id;
}

function resetBomForm() {
  bomForm.id = '';
  bomForm.bomName = '';
  bomForm.customerScope = 'ALL';
  bomForm.customerId = '';
  bomForm.projectModel = '';
  bomForm.remark = '';
  bomForm.status = 'ENABLED';
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
}

function showMobileDesktopNotice(actionLabel: string) {
  ElMessage.warning(`手机端仅查看机型零件包，${actionLabel}请在电脑端操作`);
}

function guardDesktopOperation(actionLabel: string) {
  if (!isMobileViewport()) {
    return false;
  }
  showMobileDesktopNotice(actionLabel);
  return true;
}

function openBomCreateDialog() {
  if (guardDesktopOperation('新增零件包')) {
    return;
  }
  resetBomForm();
  bomDialogVisible.value = true;
}

function openBomEditDialog(row: ModelBom) {
  if (guardDesktopOperation('编辑零件包')) {
    return;
  }
  bomForm.id = row.id;
  bomForm.bomName = row.bomName;
  bomForm.customerScope = row.customerId ? 'SPECIFIC' : 'ALL';
  bomForm.customerId = row.customerId || '';
  bomForm.projectModel = row.projectModel;
  bomForm.remark = row.remark || '';
  bomForm.status = row.status;
  bomDialogVisible.value = true;
}

function resetCopyForm() {
  copyForm.sourceBomId = '';
  copyForm.sourceBomName = '';
  copyForm.customerId = '';
  copyForm.bomName = '';
  copyForm.projectModel = '';
  copyForm.remark = '';
}

function openBomCopyDialog(row: ModelBom) {
  if (guardDesktopOperation('复制零件包')) {
    return;
  }
  if (row.customerId) {
    ElMessage.warning('当前阶段只允许从百胜通用零件包复制为客户零件包');
    return;
  }
  resetCopyForm();
  copyForm.sourceBomId = row.id;
  copyForm.sourceBomName = row.bomName;
  copyForm.bomName = `${row.bomName}-客户版`;
  copyForm.projectModel = row.projectModel;
  copyForm.remark = `从 ${row.bomName} 复制生成，复制后独立维护`;
  copyDialogVisible.value = true;
}

function handleBomCustomerScopeChange() {
  if (bomForm.customerScope === 'ALL') {
    bomForm.customerId = '';
  }
}

async function saveBom() {
  if (guardDesktopOperation('保存零件包')) {
    return;
  }
  if (!bomForm.bomName.trim() || !bomForm.projectModel.trim()) {
    ElMessage.warning('请填写零件包名称和机型/项目');
    return;
  }
  if (bomForm.customerScope === 'SPECIFIC' && !bomForm.customerId) {
    ElMessage.warning('请选择指定客户');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      bomName: bomForm.bomName.trim(),
      customerId: bomForm.customerScope === 'SPECIFIC' ? bomForm.customerId : undefined,
      projectModel: bomForm.projectModel.trim(),
      remark: bomForm.remark.trim() || undefined,
      status: bomForm.status
    };
    const saved = bomForm.id ? await erpApi.updateModelBom(bomForm.id, payload) : await erpApi.createModelBom(payload);
    activeBomId.value = saved.id;
    bomDialogVisible.value = false;
    ElMessage.success('机型零件包已保存');
    await loadModelBoms();
  } finally {
    saving.value = false;
  }
}

async function copyBom() {
  if (guardDesktopOperation('确认复制零件包')) {
    return;
  }
  if (!copyForm.sourceBomId) {
    return;
  }
  if (!copyForm.customerId) {
    ElMessage.warning('请选择目标客户');
    return;
  }
  if (!copyForm.bomName.trim() || !copyForm.projectModel.trim()) {
    ElMessage.warning('请填写客户零件包名和机型/项目');
    return;
  }
  saving.value = true;
  try {
    const payload: CopyModelBomPayload = {
      customerId: copyForm.customerId,
      bomName: copyForm.bomName.trim(),
      projectModel: copyForm.projectModel.trim(),
      remark: copyForm.remark.trim() || undefined,
      status: 'ENABLED'
    };
    const saved = await erpApi.copyModelBom(copyForm.sourceBomId, payload);
    activeBomId.value = saved.id;
    copyDialogVisible.value = false;
    ElMessage.success('客户零件包已复制生成');
    await loadModelBoms();
  } finally {
    saving.value = false;
  }
}

async function disableBom(row: ModelBom) {
  if (guardDesktopOperation('停用零件包')) {
    return;
  }
  await erpApi.disableModelBom(row.id);
  ElMessage.success('机型零件包已停用');
  await loadModelBoms();
}

async function enableBom(row: ModelBom) {
  if (guardDesktopOperation('启用零件包')) {
    return;
  }
  await erpApi.updateModelBom(row.id, {
    bomName: row.bomName,
    customerId: row.customerId || undefined,
    projectModel: row.projectModel,
    remark: row.remark || undefined,
    status: 'ENABLED'
  });
  ElMessage.success('机型零件包已启用');
  await loadModelBoms();
}

function compareBomLines(left: ModelBomLine, right: ModelBomLine) {
  return (left.sortOrder || 0) - (right.sortOrder || 0) || left.partCode.localeCompare(right.partCode);
}

function buildSourceBomDiffIssues(sourceBom: ModelBom, targetBom: ModelBom): BomDiffIssue[] {
  const sourceLineMap = new Map<string, ModelBomLine>();
  const targetLineMap = new Map<string, ModelBomLine>();
  const sourceActiveLines = sourceBom.lines.filter((line) => line.status === 'ENABLED' && line.materialStatus !== 'DISABLED');
  const targetActiveLines = targetBom.lines.filter((line) => line.status === 'ENABLED' && line.materialStatus !== 'DISABLED');
  sourceActiveLines.forEach((line) => sourceLineMap.set(bomLineIdentityKey(line), line));
  targetActiveLines.forEach((line) => targetLineMap.set(bomLineIdentityKey(line), line));

  const issues: BomDiffIssue[] = [];
  for (const [key, sourceLine] of sourceLineMap.entries()) {
    const targetLine = targetLineMap.get(key);
    if (!targetLine) {
      issues.push({
        id: `missing-${key}`,
        severity: 'warning',
        title: `客户 BOM 缺少：${bomLineShortText(sourceLine)}`,
        detail: `来源 ${sourceBom.bomName} 中仍存在该行；如客户确实不使用，可保留客户独立差异。`
      });
      continue;
    }
    const changedFields = changedBomLineFields(sourceLine, targetLine);
    if (changedFields.length > 0) {
      issues.push({
        id: `changed-${key}`,
        severity: 'warning',
        title: `行内容不一致：${bomLineShortText(targetLine)}`,
        detail: changedFields.join('；')
      });
    }
  }

  for (const [key, targetLine] of targetLineMap.entries()) {
    if (!sourceLineMap.has(key)) {
      issues.push({
        id: `extra-${key}`,
        severity: 'info',
        title: `客户 BOM 独立新增：${bomLineShortText(targetLine)}`,
        detail: '该行不在来源百胜通用 BOM 中，复制关系不会把客户新增行反向写回来源 BOM。'
      });
    }
  }
  return issues;
}

function bomLineIdentityKey(line: ModelBomLine) {
  return [
    line.lineType || 'PART',
    normalizeComponentNo(line.componentNo) || '-',
    normalizeComponentNo(line.parentComponentNo) || '-',
    normalizeDiffText(line.partCode)
  ].join('|');
}

function bomLineShortText(line: ModelBomLine) {
  const structureText = line.lineType === 'COMPONENT' ? `组件 ${line.componentNo || '-'}` : line.parentComponentNo ? `子零件 ${line.parentComponentNo}` : '单独零件';
  return `${structureText} / ${line.partCode} / ${line.partName}`;
}

function changedBomLineFields(sourceLine: ModelBomLine, targetLine: ModelBomLine) {
  const checks: Array<[string, string, string]> = [
    ['排序', String(sourceLine.sortOrder || 0), String(targetLine.sortOrder || 0)],
    ['零件名称', sourceLine.partName || '', targetLine.partName || ''],
    ['零件类型', sourceLine.partCategory || '', targetLine.partCategory || ''],
    ['默认数量', `${formatNumber(sourceLine.defaultQuantity)} ${sourceLine.unit || ''}`, `${formatNumber(targetLine.defaultQuantity)} ${targetLine.unit || ''}`],
    ['默认图纸', bomLineDrawingSignature(sourceLine), bomLineDrawingSignature(targetLine)],
    ['默认工艺', sourceLine.defaultProcessRoute || '', targetLine.defaultProcessRoute || ''],
    ['规格', sourceLine.partSpecification || '', targetLine.partSpecification || ''],
    ['状态', sourceLine.status || '', targetLine.status || '']
  ];
  return checks
    .filter(([, sourceValue, targetValue]) => normalizeDiffText(sourceValue) !== normalizeDiffText(targetValue))
    .map(([label, sourceValue, targetValue]) => `${label}：来源 ${sourceValue || '-'}，客户 ${targetValue || '-'}`);
}

function bomLineDrawingSignature(line: ModelBomLine) {
  return [line.drawingNo, line.drawingVersion, line.drawingDate, line.drawingStatus].filter(Boolean).join(' / ');
}

function normalizeDiffText(value?: string | null) {
  return String(value || '').trim().toLocaleLowerCase();
}

function nextComponentNo() {
  let maxNo = 0;
  for (const line of activeBom.value?.lines || []) {
    const matched = /^C(\d+)$/i.exec(line.componentNo || '');
    if (matched) {
      maxNo = Math.max(maxNo, Number(matched[1]) || 0);
    }
  }
  return `C${String(maxNo + 1).padStart(3, '0')}`;
}

function normalizeComponentNo(value?: string | null) {
  return String(value || '').trim().toUpperCase();
}

function lineStructureType(row: ModelBomLine): BomLineStructureType {
  if (row.lineType === 'COMPONENT') {
    return 'COMPONENT';
  }
  return row.parentComponentNo ? 'CHILD_PART' : 'STANDALONE_PART';
}

function formatLineStructure(row: ModelBomLine) {
  if (row.lineType === 'COMPONENT') {
    return `组件 ${row.componentNo || '-'}`;
  }
  if (row.parentComponentNo) {
    return `子零件 / 父级 ${row.parentComponentNo}`;
  }
  return '单独零件';
}

function formatLineDrawing(row: ModelBomLine) {
  if (!row.drawingNo && !row.drawingVersion) {
    return '-';
  }
  const suffix = row.drawingSource === 'BOM_LINE' ? 'BOM指定' : '零件默认';
  return `${[row.drawingNo, row.drawingVersion, row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ')}（${suffix}）`;
}

function formatFixedLineCore(row: ModelBomLine) {
  return `${row.partCode || '-'} | ${row.partName || '-'} | ${formatQuantity(row.defaultQuantity, row.unit)}`;
}

function formatFixedLineMeta(row: ModelBomLine) {
  const drawingText = formatLineDrawing(row);
  const processText = row.defaultProcessRoute || '-';
  const specificationText = row.partSpecification || '-';
  return `图纸 ${drawingText} | 工艺 ${processText} | 规格 ${specificationText}`;
}

function formatBomStructureTextLine(row: ModelBomLine, prefix: string) {
  const categoryText = row.partCategory || '-';
  return `${prefix} | ${row.partCode || '-'} | ${row.partName || '-'} | ${categoryText} | ${formatQuantity(row.defaultQuantity, row.unit)} | ${formatLineDrawing(row)} | ${row.defaultProcessRoute || '-'}`;
}

const bomStructureText = computed(() => {
  if (!activeBom.value) {
    return '';
  }
  const lines = [`${activeBom.value.bomName} / ${activeBom.value.scopeLabel}`];
  for (const [groupIndex, group] of activeBomStructureGroups.value.entries()) {
    const prefix =
      group.type === 'component'
        ? `${groupIndex + 1}. 组件 ${group.line.componentNo || '-'}`
        : group.type === 'orphan'
          ? `${groupIndex + 1}. 未匹配父级 ${group.line.parentComponentNo || '-'}`
          : `${groupIndex + 1}. 单独零件`;
    lines.push(formatBomStructureTextLine(group.line, prefix));
    group.children.forEach((child, childIndex) => {
      lines.push(formatBomStructureTextLine(child, `  ${groupIndex + 1}.${childIndex + 1} 子零件`));
    });
  }
  return lines.join('\n');
});

async function copyBomStructureText() {
  const text = bomStructureText.value.trim();
  if (!text) {
    ElMessage.warning('暂无可复制的固定格式清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

function formatDrawingRevisionOption(row: MaterialDrawingRevision) {
  const prefix = row.isDefault ? '默认 / ' : '';
  return `${prefix}${[row.drawingNo, row.drawingVersion, row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ')}`;
}

function lineStructureClass(row: ModelBomLine) {
  return `bom-line-structure--${lineStructureType(row).toLowerCase().replace(/_/g, '-')}`;
}

function buildLinePayload(row: ModelBomLine, overrides: Partial<SaveModelBomLinePayload> = {}): SaveModelBomLinePayload {
  return {
    materialId: row.materialId,
    lineType: row.lineType === 'COMPONENT' ? 'COMPONENT' : 'PART',
    partCategory: row.partCategory || undefined,
    componentNo: row.componentNo || undefined,
    parentComponentNo: row.parentComponentNo || undefined,
    defaultDrawingRevisionId: row.defaultDrawingRevisionId || undefined,
    defaultProcessRoute: row.defaultProcessRoute || undefined,
    defaultQuantity: row.defaultQuantity,
    sortOrder: row.sortOrder,
    remark: row.remark || undefined,
    status: row.status,
    ...overrides
  };
}

function isDragAfterRowMiddle(event: DragEvent) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) {
    return false;
  }
  const rect = target.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

function startLineDrag(event: DragEvent, index: number) {
  if (guardDesktopOperation('拖拽调整顺序')) {
    event.preventDefault();
    return;
  }
  if (saving.value) {
    event.preventDefault();
    return;
  }
  draggedLineIndex.value = index;
  dragOverLineIndex.value = index;
  dragOverLineInsertAfter.value = false;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', activeBomDisplayLines.value[index]?.id || '');
  }
}

function handleLineDragOver(event: DragEvent, index: number) {
  if (draggedLineIndex.value === null) {
    return;
  }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  dragOverLineIndex.value = index;
  dragOverLineInsertAfter.value = isDragAfterRowMiddle(event);
}

function handleLineListDragOverEnd() {
  if (draggedLineIndex.value === null || activeBomDisplayLines.value.length === 0) {
    return;
  }
  dragOverLineIndex.value = activeBomDisplayLines.value.length - 1;
  dragOverLineInsertAfter.value = true;
}

function buildDraggedLineOrder(targetIndex: number, insertAfter: boolean) {
  if (draggedLineIndex.value === null) {
    return [];
  }
  const ordered = [...activeBomDisplayLines.value];
  const [dragged] = ordered.splice(draggedLineIndex.value, 1);
  if (!dragged) {
    return [];
  }
  let insertionIndex = targetIndex + (insertAfter ? 1 : 0);
  if (draggedLineIndex.value < insertionIndex) {
    insertionIndex -= 1;
  }
  ordered.splice(Math.max(0, Math.min(insertionIndex, ordered.length)), 0, dragged);
  return ordered;
}

async function saveDraggedLineOrder(ordered: ModelBomLine[]) {
  if (!activeBom.value || ordered.length === 0) {
    return;
  }
  saving.value = true;
  try {
    const items = ordered.map((line, orderIndex) => ({
      lineId: line.id,
      sortOrder: (orderIndex + 1) * 10
    }));
    const hasChanged = items.some((item) => ordered.find((line) => line.id === item.lineId)?.sortOrder !== item.sortOrder);
    if (!hasChanged) {
      endLineDrag();
      return;
    }
    const saved = await erpApi.reorderModelBomLines(activeBom.value.id, { items });
    activeBomId.value = saved.id;
    await loadModelBoms();
    ElMessage.success('零件包顺序已保存');
  } finally {
    saving.value = false;
    endLineDrag();
  }
}

async function dropLineDrag() {
  if (draggedLineIndex.value === null || dragOverLineIndex.value === null) {
    endLineDrag();
    return;
  }
  const ordered = buildDraggedLineOrder(dragOverLineIndex.value, dragOverLineInsertAfter.value);
  await saveDraggedLineOrder(ordered);
}

async function dropLineDragAtEnd() {
  if (draggedLineIndex.value === null || activeBomDisplayLines.value.length === 0) {
    endLineDrag();
    return;
  }
  const ordered = buildDraggedLineOrder(activeBomDisplayLines.value.length - 1, true);
  await saveDraggedLineOrder(ordered);
}

function endLineDrag() {
  draggedLineIndex.value = null;
  dragOverLineIndex.value = null;
  dragOverLineInsertAfter.value = false;
}

function resetLineForm() {
  lineForm.id = '';
  lineForm.materialId = '';
  lineForm.materialKeyword = '';
  lineForm.structureType = 'STANDALONE_PART';
  lineForm.partCategory = '';
  lineForm.componentNo = '';
  lineForm.parentComponentNo = '';
  lineForm.defaultDrawingRevisionId = '';
  lineForm.defaultProcessRouteSteps = [];
  lineForm.defaultQuantity = 1;
  lineForm.sortOrder = ((activeBom.value?.lines || []).reduce((max, item) => Math.max(max, item.sortOrder || 0), 0) || 0) + 10;
  lineForm.remark = '';
  lineForm.status = 'ENABLED';
  lineDrawingRevisions.value = [];
}

function openLineCreateDialog() {
  if (guardDesktopOperation('新增包内明细')) {
    return;
  }
  if (!activeBom.value) {
    return;
  }
  resetLineForm();
  lineDialogVisible.value = true;
}

async function openLineEditDialog(row: ModelBomLine) {
  if (guardDesktopOperation('编辑包内明细')) {
    return;
  }
  lineForm.id = row.id;
  lineForm.materialId = row.materialId;
  lineForm.materialKeyword = `${row.partCode} / ${row.partName}`;
  lineForm.structureType = lineStructureType(row);
  lineForm.partCategory = row.partCategory || '';
  lineForm.componentNo = row.componentNo || '';
  lineForm.parentComponentNo = row.parentComponentNo || '';
  lineForm.defaultDrawingRevisionId = row.defaultDrawingRevisionId || '';
  lineForm.defaultProcessRouteSteps = splitDefaultProcessRoute(row.defaultProcessRoute || '');
  lineForm.defaultQuantity = row.defaultQuantity;
  lineForm.sortOrder = row.sortOrder || 0;
  lineForm.remark = row.remark || '';
  lineForm.status = row.status;
  lineDialogVisible.value = true;
  await loadLineDrawingRevisions(row.materialId);
}

function handleLineStructureChange() {
  if (lineForm.structureType === 'COMPONENT') {
    lineForm.componentNo = lineForm.componentNo || nextComponentNo();
    lineForm.parentComponentNo = '';
    return;
  }
  lineForm.componentNo = '';
  if (lineForm.structureType === 'STANDALONE_PART') {
    lineForm.parentComponentNo = '';
  }
}

async function queryMaterials(keyword: string, callback: (items: MaterialMemory[]) => void) {
  const requestId = ++materialSearchSeq.value;
  callback([]);
  try {
    const rows = await erpApi.inventoryMaterials({ keyword: keyword.trim() || undefined, status: 'ENABLED' });
    if (requestId === materialSearchSeq.value) {
      callback(rows);
    }
  } catch {
    if (requestId === materialSearchSeq.value) {
      callback([]);
    }
  }
}

function selectMaterial(item: MaterialMemory) {
  lineForm.materialId = item.id;
  lineForm.materialKeyword = `${item.partCode} / ${item.partName}`;
  lineForm.defaultDrawingRevisionId = '';
  void loadLineDrawingRevisions(item.id);
}

function splitDefaultProcessRoute(value: string) {
  return value
    .split(/(?:->|→|[、,，;；\n\r]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function saveLine() {
  if (guardDesktopOperation('保存包内明细')) {
    return;
  }
  if (!activeBom.value || !lineForm.materialId) {
    ElMessage.warning('请选择零件');
    return;
  }
  if (lineForm.structureType === 'COMPONENT' && !normalizeComponentNo(lineForm.componentNo)) {
    ElMessage.warning('请填写组件编号');
    return;
  }
  if (lineForm.structureType === 'CHILD_PART' && !normalizeComponentNo(lineForm.parentComponentNo)) {
    ElMessage.warning('请选择所属组件');
    return;
  }
  if (lineForm.defaultQuantity <= 0) {
    ElMessage.warning('默认数量必须大于 0');
    return;
  }
  saving.value = true;
  try {
    const payload: SaveModelBomLinePayload = {
      materialId: lineForm.materialId,
      lineType: lineForm.structureType === 'COMPONENT' ? 'COMPONENT' : 'PART',
      partCategory: lineForm.partCategory.trim() || undefined,
      componentNo: lineForm.structureType === 'COMPONENT' ? normalizeComponentNo(lineForm.componentNo) : undefined,
      parentComponentNo: lineForm.structureType === 'CHILD_PART' ? normalizeComponentNo(lineForm.parentComponentNo) : undefined,
      defaultDrawingRevisionId: lineForm.defaultDrawingRevisionId || undefined,
      defaultProcessRoute: lineForm.defaultProcessRouteSteps.join('、') || undefined,
      defaultQuantity: lineForm.defaultQuantity,
      sortOrder: lineForm.sortOrder,
      remark: lineForm.remark.trim() || undefined,
      status: lineForm.status
    };
    if (lineForm.id) {
      await erpApi.updateModelBomLine(lineForm.id, payload);
    } else {
      await erpApi.saveModelBomLine(activeBom.value.id, payload);
    }
    lineDialogVisible.value = false;
    ElMessage.success('包内零件已保存');
    await loadModelBoms();
  } finally {
    saving.value = false;
  }
}

async function disableLine(row: ModelBomLine) {
  if (guardDesktopOperation('停用包内明细')) {
    return;
  }
  await erpApi.disableModelBomLine(row.id);
  ElMessage.success(row.lineType === 'COMPONENT' ? '组件行已停用，所属子零件已同步停用' : '包内零件已停用');
  await loadModelBoms();
}

async function enableLine(row: ModelBomLine) {
  if (guardDesktopOperation('启用包内明细')) {
    return;
  }
  await erpApi.updateModelBomLine(row.id, buildLinePayload(row, { status: 'ENABLED' }));
  ElMessage.success('包内零件已启用');
  await loadModelBoms();
}

function formatQuantity(value: number | undefined, unit?: string) {
  return `${formatNumber(value || 0)} ${unit || ''}`.trim();
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}
</script>

<style scoped>
.page-subtitle {
  margin: 6px 0 0;
  color: #64748b;
}

.page-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.model-bom-alert {
  margin-bottom: 16px;
}

.model-bom-layout {
  display: grid;
  grid-template-columns: minmax(420px, 0.9fr) minmax(520px, 1.1fr);
  gap: 16px;
}

.material-option {
  display: grid;
  gap: 2px;
  line-height: 1.45;
}

.material-option span {
  color: #64748b;
  font-size: 12px;
}

.bom-structure-panel {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.bom-structure-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.bom-structure-panel__header > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.bom-structure-panel__header span {
  color: #64748b;
  font-size: 12px;
}

.bom-structure-list {
  display: grid;
  gap: 8px;
}

.bom-structure-group {
  display: grid;
  gap: 6px;
}

.bom-structure-main,
.bom-structure-child {
  display: grid;
  grid-template-columns: 34px 118px minmax(220px, 1fr) minmax(280px, 1.4fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fff;
}

.bom-structure-child {
  margin-left: 34px;
  background: #f0fdf4;
}

.bom-structure-index,
.bom-structure-child > span:first-child {
  color: #64748b;
  font-size: 12px;
}

.bom-structure-main strong,
.bom-structure-child strong,
.bom-structure-main > span:last-child,
.bom-structure-child > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bom-structure-main > span:last-child,
.bom-structure-child > span:last-child {
  color: #475569;
  font-size: 12px;
}

.bom-line-table {
  max-height: 620px;
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.bom-line-row {
  position: relative;
  display: grid;
  grid-template-columns: 92px minmax(180px, 1.1fr) minmax(150px, 0.9fr) minmax(180px, 1fr) 126px minmax(220px, 1.1fr) minmax(170px, 0.9fr) minmax(150px, 0.9fr) 92px 150px;
  min-width: 1520px;
  align-items: center;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}

.bom-line-row > div {
  min-width: 0;
  padding: 10px 12px;
}

.bom-line-row--head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f8fafc;
  color: #334155;
  font-weight: 600;
}

.bom-line-body .bom-line-row:last-child {
  border-bottom: 0;
}

.bom-line-row.is-dragging {
  opacity: 0.48;
}

.bom-line-row.is-drop-before::before,
.bom-line-row.is-drop-after::after {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 2;
  height: 2px;
  content: '';
  background: #2563eb;
}

.bom-line-row.is-drop-before::before {
  top: 0;
}

.bom-line-row.is-drop-after::after {
  bottom: 0;
}

.bom-line-sort-cell,
.bom-line-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bom-line-drag-handle {
  width: 28px;
  height: 28px;
  cursor: grab;
}

.bom-line-drag-handle:active {
  cursor: grabbing;
}

.bom-line-drag-handle:disabled {
  cursor: not-allowed;
}

.bom-line-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bom-line-structure {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.bom-line-structure span {
  color: #64748b;
  font-size: 12px;
}

.bom-line-structure--child-part {
  padding-left: 22px;
}

.bom-source-diff-panel {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid #fde68a;
  border-radius: 8px;
  background: #fffbeb;
}

.bom-source-diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.bom-source-diff-header > div {
  display: grid;
  gap: 3px;
}

.bom-source-diff-header span,
.bom-source-diff-item span,
.bom-source-diff-empty {
  color: #64748b;
  font-size: 12px;
}

.bom-source-diff-list {
  display: grid;
  gap: 8px;
}

.bom-source-diff-item {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 9px 10px;
  border-radius: 6px;
  background: #fff;
}

.bom-source-diff-item > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.bom-source-diff-item strong,
.bom-source-diff-item span {
  overflow-wrap: anywhere;
}

@media (max-width: 1100px) {
  .model-bom-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .page-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
