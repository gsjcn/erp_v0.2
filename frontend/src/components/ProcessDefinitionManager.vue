<template>
  <section class="process-definition-manager">
    <div class="process-definition-toolbar">
      <div>
        <strong>{{ title }}</strong>
        <p v-if="hint">{{ hint }}</p>
      </div>
      <div class="process-definition-tools">
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索工序名称 / 备注 / 拼音 / 首字母"
          class="process-definition-search"
          @keyup.enter="loadDefinitions"
          @clear="loadDefinitions"
        />
        <el-button :loading="loading" @click="loadDefinitions">搜索</el-button>
        <el-select
          v-if="showStatusFilter && !readOnly"
          v-model="statusFilter"
          class="process-definition-status-filter"
          style="width: 118px"
          @change="loadDefinitions"
        >
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
          <el-option label="全部" value="ALL" />
        </el-select>
        <el-button v-if="!readOnly" type="primary" @click="openCreateDialog">新建工序</el-button>
        <span v-else class="mobile-readonly-note">手机端只查看标准工序</span>
      </div>
    </div>

    <div v-loading="loading" class="process-definition-list">
      <el-tooltip
        v-for="definition in definitions"
        :key="definition.id"
        placement="top"
        effect="light"
        :show-after="250"
        popper-class="process-definition-popper"
      >
        <template #content>
          <div class="process-definition-tooltip">
            <strong>{{ definition.processName }}</strong>
            <p>{{ definition.remark || '暂无备注' }}</p>
            <small>用于订单零件流程配置和流程记忆；历史订单中的已保存工序不会被删除。</small>
          </div>
        </template>

        <article class="process-definition-card" :class="{ expanded: isMobileDefinitionExpanded(definition.id) }">
          <div class="process-definition-main">
            <strong>{{ definition.processName }}</strong>
            <el-tag v-if="showStatusFilter && definition.status === 'DISABLED'" size="small" type="info" effect="plain">已停用</el-tag>
            <small v-if="definition.remark">{{ definition.remark }}</small>
            <small v-else>暂无备注</small>
          </div>
          <el-button class="process-definition-detail-toggle" link type="primary" @click.stop="toggleMobileDefinitionCard(definition.id)">
            {{ isMobileDefinitionExpanded(definition.id) ? '收起' : '详情' }}
          </el-button>
          <div v-if="!readOnly" class="process-definition-actions">
            <template v-if="definition.status === 'DISABLED'">
              <el-button
                link
                type="success"
                :loading="restoringDefinitionId === definition.id"
                :disabled="Boolean(restoringDefinitionId)"
                @click="restoreDefinition(definition)"
              >
                恢复启用
              </el-button>
            </template>
            <template v-else>
              <el-button link type="primary" @click="openEditDialog(definition)">编辑</el-button>
              <el-button link type="danger" @click="openDeleteDialog(definition)">停用</el-button>
            </template>
          </div>
          <span v-else class="mobile-readonly-note process-definition-readonly">手机端只读</span>
        </article>
      </el-tooltip>

      <el-empty v-if="!loading && definitions.length === 0" description="没有匹配的工序" />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingDefinitionId ? '编辑工序' : '新建工序'"
      width="min(520px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleDefinitionDialogClose"
    >
      <el-form label-width="86px">
        <el-form-item label="工序名称" required>
          <el-input v-model="form.processName" placeholder="例如 抛丸" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="3"
            placeholder="可填写工序使用范围或注意事项"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="closeDefinitionDialog">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" @click="saveDefinition">保存工序</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="deleteDialogVisible"
      title="停用工序"
      width="min(500px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
      :close-on-click-modal="!deleting"
      :close-on-press-escape="!deleting"
      :before-close="handleDeleteDialogClose"
    >
      <div class="delete-definition-summary">
        <p>
          <span>工序名称</span>
          <strong>{{ activeDeleteDefinition?.processName }}</strong>
        </p>
        <p class="delete-definition-warning">停用后不再出现在新增流程、BOM 和来源加工关系的工序下拉中；历史订单和生产任务中的已保存工序不会被删除。</p>
      </div>
      <template #footer>
        <el-button :disabled="deleting" @click="closeDeleteDialog">取消</el-button>
        <el-button type="danger" :loading="deleting" :disabled="deleting" @click="deleteDefinition">停用工序</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { erpApi } from '../api/erp';
import type { ProcessDefinition } from '../types/erp';

const props = withDefaults(
  defineProps<{
    title?: string;
    hint?: string;
    readOnly?: boolean;
    showStatusFilter?: boolean;
  }>(),
  {
    title: '标准工序',
    hint: '',
    readOnly: false,
    showStatusFilter: false
  }
);

const emit = defineEmits<{
  updated: [];
}>();

const definitions = ref<ProcessDefinition[]>([]);
const keyword = ref('');
const statusFilter = ref<'ENABLED' | 'DISABLED' | 'ALL'>('ENABLED');
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const restoringDefinitionId = ref('');
const dialogVisible = ref(false);
const deleteDialogVisible = ref(false);
const editingDefinitionId = ref('');
const searchTimer = ref<number>();
const activeDeleteDefinition = ref<ProcessDefinition>();
const expandedMobileDefinitionIds = ref<string[]>([]);
const form = reactive({
  processName: '',
  remark: ''
});

async function loadDefinitions() {
  loading.value = true;
  try {
    definitions.value = await erpApi.processDefinitions(keyword.value.trim() || undefined, props.showStatusFilter ? statusFilter.value : 'ENABLED');
  } catch (error) {
    definitions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '标准工序加载失败，请确认后端服务和筛选条件');
  } finally {
    loading.value = false;
  }
}

function guardReadOnlyDefinitionMutation(actionLabel: string) {
  if (!props.readOnly) {
    return false;
  }
  ElMessage.warning(`手机端仅查看标准工序，${actionLabel}请在电脑端操作`);
  return true;
}

function openCreateDialog() {
  if (guardReadOnlyDefinitionMutation('新建工序')) {
    return;
  }
  editingDefinitionId.value = '';
  form.processName = '';
  form.remark = '';
  dialogVisible.value = true;
}

function openEditDialog(definition: ProcessDefinition) {
  if (guardReadOnlyDefinitionMutation('编辑工序')) {
    return;
  }
  if (definition.status === 'DISABLED') {
    ElMessage.warning('已停用的标准工序需先恢复启用后再编辑');
    return;
  }
  editingDefinitionId.value = definition.id;
  form.processName = definition.processName;
  form.remark = definition.remark || '';
  dialogVisible.value = true;
}

function warnDefinitionSavingClose() {
  ElMessage.warning('标准工序正在保存，请等待保存完成');
}

function closeDefinitionDialog() {
  if (saving.value) {
    warnDefinitionSavingClose();
    return;
  }
  dialogVisible.value = false;
}

function handleDefinitionDialogClose(done: () => void) {
  if (saving.value) {
    warnDefinitionSavingClose();
    return;
  }
  done();
}

async function saveDefinition() {
  if (saving.value) {
    return;
  }
  if (guardReadOnlyDefinitionMutation('保存工序')) {
    return;
  }
  const processName = form.processName.trim();
  if (!processName) {
    ElMessage.warning('请填写工序名称');
    return;
  }
  if (processDefinitionNameExists(processName)) {
    ElMessage.warning(`工序“${processName}”已存在，请勿重复创建`);
    return;
  }
  saving.value = true;
  try {
    const payload = {
      processName,
      remark: form.remark.trim() || undefined
    };
    if (editingDefinitionId.value) {
      await erpApi.updateProcessDefinition(editingDefinitionId.value, payload);
    } else {
      await erpApi.createProcessDefinition(payload);
    }
    ElMessage.success('工序已保存');
    dialogVisible.value = false;
    await loadDefinitions();
    emit('updated');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '工序保存失败，请确认是否重复');
  } finally {
    saving.value = false;
  }
}

function processDefinitionNameExists(processName: string) {
  const normalizedName = normalizeProcessDefinitionName(processName);
  return definitions.value.some(
    (definition) =>
      definition.id !== editingDefinitionId.value &&
      normalizeProcessDefinitionName(definition.processName) === normalizedName
  );
}

function normalizeProcessDefinitionName(processName: string) {
  return processName.trim().toLocaleLowerCase().replace(/[\s\-_./\\]+/g, '');
}

function toggleMobileDefinitionCard(definitionId: string) {
  if (expandedMobileDefinitionIds.value.includes(definitionId)) {
    expandedMobileDefinitionIds.value = expandedMobileDefinitionIds.value.filter((id) => id !== definitionId);
    return;
  }
  expandedMobileDefinitionIds.value = [...expandedMobileDefinitionIds.value, definitionId];
}

function isMobileDefinitionExpanded(definitionId: string) {
  return expandedMobileDefinitionIds.value.includes(definitionId);
}

function openDeleteDialog(definition: ProcessDefinition) {
  if (guardReadOnlyDefinitionMutation('停用工序')) {
    return;
  }
  if (definition.status === 'DISABLED') {
    ElMessage.warning('该标准工序已停用');
    return;
  }
  activeDeleteDefinition.value = definition;
  deleteDialogVisible.value = true;
}

function warnDefinitionDeletingClose() {
  ElMessage.warning('标准工序正在停用，请等待保存完成');
}

function closeDeleteDialog() {
  if (deleting.value) {
    warnDefinitionDeletingClose();
    return;
  }
  deleteDialogVisible.value = false;
}

function handleDeleteDialogClose(done: () => void) {
  if (deleting.value) {
    warnDefinitionDeletingClose();
    return;
  }
  done();
}

async function deleteDefinition() {
  if (deleting.value) {
    return;
  }
  if (guardReadOnlyDefinitionMutation('停用工序')) {
    return;
  }
  if (!activeDeleteDefinition.value) {
    return;
  }

  deleting.value = true;
  try {
    await erpApi.deleteProcessDefinition(activeDeleteDefinition.value.id);
    ElMessage.success('工序已停用，历史订单和生产任务不受影响');
    deleteDialogVisible.value = false;
    activeDeleteDefinition.value = undefined;
    await loadDefinitions();
    emit('updated');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '工序停用失败');
  } finally {
    deleting.value = false;
  }
}

async function restoreDefinition(definition: ProcessDefinition) {
  if (restoringDefinitionId.value) {
    return;
  }
  if (guardReadOnlyDefinitionMutation('恢复启用标准工序')) {
    return;
  }
  restoringDefinitionId.value = definition.id;
  try {
    await erpApi.restoreProcessDefinition(definition.id);
    ElMessage.success('标准工序已恢复启用');
    await loadDefinitions();
    emit('updated');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '标准工序恢复失败，请确认名称未重复');
  } finally {
    restoringDefinitionId.value = '';
  }
}

onMounted(() => {
  void loadDefinitions();
});

watch(keyword, () => {
  window.clearTimeout(searchTimer.value);
  searchTimer.value = window.setTimeout(() => {
    void loadDefinitions();
  }, 250);
});

onBeforeUnmount(() => window.clearTimeout(searchTimer.value));
</script>

<style scoped>
.process-definition-manager {
  display: grid;
  gap: 12px;
}

.process-definition-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.process-definition-toolbar p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
}

.process-definition-tools {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.process-definition-search {
  width: 260px;
}

.process-definition-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  min-height: 64px;
}

.process-definition-card {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.process-definition-main {
  min-width: 0;
}

.process-definition-card strong,
.process-definition-card small {
  display: block;
}

.process-definition-card small {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
}

.process-definition-actions {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  gap: 8px;
}

.process-definition-actions .el-button {
  margin-left: 0;
}

.mobile-readonly-note {
  color: #64748b;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}

.process-definition-readonly {
  flex-shrink: 0;
}

.process-definition-detail-toggle {
  display: none;
}

:global(.process-definition-popper) {
  max-width: 320px;
}

.process-definition-tooltip {
  display: grid;
  gap: 6px;
  max-width: 280px;
}

.process-definition-tooltip strong {
  color: #0f172a;
}

.process-definition-tooltip p,
.process-definition-tooltip small {
  margin: 0;
  color: #64748b;
  line-height: 1.5;
}

.delete-definition-summary {
  display: grid;
  gap: 12px;
}

.delete-definition-summary p {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0;
}

.delete-definition-summary span {
  color: #64748b;
  font-size: 13px;
}

.delete-definition-summary strong {
  color: #0f172a;
}

.delete-definition-warning {
  display: block !important;
  padding: 10px 12px;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  line-height: 1.6;
}

@media (max-width: 900px) {
  .process-definition-toolbar {
    display: grid;
  }

  .process-definition-tools,
  .process-definition-search {
    width: 100%;
  }

  .process-definition-tools .el-button {
    flex: 1 1 96px;
  }

  .process-definition-list {
    grid-template-columns: 1fr;
  }

  .process-definition-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: flex-start;
  }

  .process-definition-detail-toggle {
    display: inline-flex;
    min-height: 44px;
    padding: 0 4px;
  }

  .process-definition-actions {
    grid-column: 1 / -1;
    display: none;
    justify-content: stretch;
  }

  .process-definition-card.expanded .process-definition-actions {
    display: flex;
  }

  .process-definition-card:not(.expanded) small {
    display: none;
  }

  .process-definition-actions .el-button {
    flex: 1 1 96px;
    min-height: 44px;
  }
}
</style>
