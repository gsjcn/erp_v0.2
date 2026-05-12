<template>
  <section class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">来源加工关系</h2>
        <p class="page-subtitle">维护通用件 / 半成品加工成客户零件的建议规则；不自动扣库存、不自动提交生产。</p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/materials')">返回零件管理</el-button>
        <el-button type="primary" @click="openCreateDialog">新增关系</el-button>
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

    <div class="filter-bar">
      <div class="filter-field">
        <label>关键字</label>
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="来源零件 / 目标零件 / 客户 / 工艺 / 拼音"
          style="width: 320px"
          @keyup.enter="loadRules"
        />
      </div>
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect v-model="filters.customerId" placeholder="全部客户范围" width="240px" @change="loadRules" />
      </div>
      <div class="filter-field">
        <label>机型 / 项目</label>
        <el-input v-model="filters.projectModel" clearable placeholder="例如 B3、B5" style="width: 180px" @keyup.enter="loadRules" />
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" style="width: 130px" @change="loadRules">
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="loadRules">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="table-card desktop-table">
      <el-table v-loading="loading" :data="rules" max-height="650">
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
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button v-if="row.status === 'ENABLED'" link type="danger" @click="disableRule(row)">停用</el-button>
            <el-button v-else link type="success" @click="enableRule(row)">启用</el-button>
          </template>
        </el-table-column>
      </el-table>
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
        <p>{{ row.scopeLabel }} / 倍率 {{ row.multiplier }} / 损耗 {{ row.lossRate ?? '-' }}</p>
        <div class="mobile-actions">
          <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
          <el-button v-if="row.status === 'ENABLED'" size="small" type="danger" plain @click="disableRule(row)">停用</el-button>
          <el-button v-else size="small" type="success" plain @click="enableRule(row)">启用</el-button>
        </div>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" class="responsive-dialog" :title="dialogTitle" width="720px">
      <el-form label-width="120px">
        <el-form-item label="来源零件" required>
          <el-autocomplete
            v-model="form.sourceMaterialKeyword"
            :fetch-suggestions="querySourceMaterials"
            value-key="partCode"
            clearable
            placeholder="输入编码 / 名称 / 拼音搜索"
            style="width: 100%"
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
            placeholder="选择标准工序，按选择顺序保存"
            style="width: 100%"
          >
            <el-option v-for="item in processDefinitions" :key="item.id" :label="item.processName" :value="item.processName" />
          </el-select>
        </el-form-item>
        <el-form-item label="转换说明">
          <el-input v-model="form.conversionDescription" type="textarea" :rows="3" placeholder="例如 通用件 D 加工为客户 A 零件 5" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 160px">
            <el-option label="启用" value="ENABLED" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { erpApi, type SaveMaterialTransformRulePayload } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import type { CommonStatus, MaterialMemory, MaterialTransformRule, ProcessDefinition } from '../types/erp';
import { formatDateTime } from '../utils/format';

const router = useRouter();
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const rules = ref<MaterialTransformRule[]>([]);
const processDefinitions = ref<ProcessDefinition[]>([]);
const sourceMaterialSearchSeq = ref(0);
const targetMaterialSearchSeq = ref(0);

const filters = reactive<{
  keyword: string;
  customerId?: string;
  projectModel: string;
  status: CommonStatus;
}>({
  keyword: '',
  customerId: undefined,
  projectModel: '',
  status: 'ENABLED'
});

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

async function loadRules() {
  loading.value = true;
  try {
    rules.value = await erpApi.materialTransformRules({
      keyword: filters.keyword.trim() || undefined,
      customerId: filters.customerId || undefined,
      projectModel: filters.projectModel.trim() || undefined,
      status: filters.status
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '来源加工关系加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadProcessDefinitions() {
  processDefinitions.value = await erpApi.processDefinitions(undefined, 'ENABLED');
}

function resetFilters() {
  filters.keyword = '';
  filters.customerId = undefined;
  filters.projectModel = '';
  filters.status = 'ENABLED';
  void loadRules();
}

function resetForm() {
  form.id = '';
  form.sourceMaterialId = '';
  form.sourceMaterialKeyword = '';
  form.targetMaterialId = '';
  form.targetMaterialKeyword = '';
  form.customerId = '';
  form.projectModel = '';
  form.conversionDescription = '';
  form.defaultProcessRouteSteps = [];
  form.multiplier = 1;
  form.lossRate = undefined;
  form.remark = '';
  form.status = 'ENABLED';
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
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

function openCreateDialog() {
  if (guardDesktopOperation('新增关系')) {
    return;
  }
  resetForm();
  dialogVisible.value = true;
}

function openEditDialog(row: MaterialTransformRule) {
  if (guardDesktopOperation('编辑关系')) {
    return;
  }
  form.id = row.id;
  form.sourceMaterialId = row.sourceMaterialId;
  form.sourceMaterialKeyword = materialLabel(row.sourcePartCode, row.sourcePartName);
  form.targetMaterialId = row.targetMaterialId;
  form.targetMaterialKeyword = materialLabel(row.targetPartCode, row.targetPartName);
  form.customerId = row.customerId || '';
  form.projectModel = row.projectModel || '';
  form.conversionDescription = row.conversionDescription || '';
  form.defaultProcessRouteSteps = splitDefaultProcessRoute(row.defaultProcessRoute || '');
  form.multiplier = row.multiplier || 1;
  form.lossRate = row.lossRate ?? undefined;
  form.remark = row.remark || '';
  form.status = row.status;
  dialogVisible.value = true;
}

function materialLabel(partCode: string, partName: string) {
  return `${partCode} / ${partName}`;
}

function splitDefaultProcessRoute(value: string) {
  return value
    .split(/(?:->|→|[、,，;；\n\r]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
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
}

function selectTargetMaterial(item: MaterialMemory) {
  form.targetMaterialId = item.id;
  form.targetMaterialKeyword = materialLabel(item.partCode, item.partName);
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
    status: form.status
  };
}

async function saveRule() {
  if (guardDesktopOperation('保存关系')) {
    return;
  }
  const payload = buildPayload();
  if (!payload) {
    return;
  }
  saving.value = true;
  try {
    if (form.id) {
      await erpApi.updateMaterialTransformRule(form.id, payload);
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

async function disableRule(row: MaterialTransformRule) {
  if (guardDesktopOperation('停用关系')) {
    return;
  }
  await erpApi.disableMaterialTransformRule(row.id);
  ElMessage.success('来源加工关系已停用');
  await loadRules();
}

async function enableRule(row: MaterialTransformRule) {
  if (guardDesktopOperation('启用关系')) {
    return;
  }
  await erpApi.updateMaterialTransformRule(row.id, {
    sourceMaterialId: row.sourceMaterialId,
    targetMaterialId: row.targetMaterialId,
    customerId: row.customerId || undefined,
    projectModel: row.projectModel || undefined,
    conversionDescription: row.conversionDescription || undefined,
    defaultProcessRoute: splitDefaultProcessRoute(row.defaultProcessRoute || '').join('、') || undefined,
    multiplier: row.multiplier,
    lossRate: row.lossRate ?? undefined,
    remark: row.remark || undefined,
    status: 'ENABLED'
  });
  ElMessage.success('来源加工关系已启用');
  await loadRules();
}

onMounted(() => {
  void loadRules();
  void loadProcessDefinitions();
});
</script>

<style scoped>
.transform-alert {
  margin-bottom: 14px;
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

.form-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 900px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
