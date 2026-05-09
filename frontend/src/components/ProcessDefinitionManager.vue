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
        <el-button type="primary" @click="openCreateDialog">新建工序</el-button>
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

        <article class="process-definition-card">
          <div>
            <strong>{{ definition.processName }}</strong>
            <small v-if="definition.remark">{{ definition.remark }}</small>
            <small v-else>暂无备注</small>
          </div>
          <div class="process-definition-actions">
            <el-button link type="primary" @click="openEditDialog(definition)">编辑</el-button>
            <el-button link type="danger" @click="openDeleteDialog(definition)">删除</el-button>
          </div>
        </article>
      </el-tooltip>

      <el-empty v-if="!loading && definitions.length === 0" description="没有匹配的工序" />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingDefinitionId ? '编辑工序' : '新建工序'"
      width="min(520px, calc(100vw - 32px))"
    >
      <el-form label-width="86px">
        <el-form-item label="工序名称" required>
          <el-input v-model="form.processName" maxlength="30" show-word-limit placeholder="例如 抛丸" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="可填写工序使用范围或注意事项"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveDefinition">保存工序</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="deleteDialogVisible"
      title="删除工序"
      width="min(500px, calc(100vw - 32px))"
      append-to-body
    >
      <div class="delete-definition-summary">
        <p>
          <span>工序名称</span>
          <strong>{{ activeDeleteDefinition?.processName }}</strong>
        </p>
        <p class="delete-definition-warning">已保存到订单和生产任务中的历史工序不会被删除。</p>
      </div>
      <template #footer>
        <el-button :disabled="deleting" @click="deleteDialogVisible = false">取消</el-button>
        <el-button type="danger" :loading="deleting" @click="deleteDefinition">删除</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { erpApi } from '../api/erp';
import type { ProcessDefinition } from '../types/erp';

withDefaults(
  defineProps<{
    title?: string;
    hint?: string;
  }>(),
  {
    title: '标准工序',
    hint: ''
  }
);

const emit = defineEmits<{
  updated: [];
}>();

const definitions = ref<ProcessDefinition[]>([]);
const keyword = ref('');
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const dialogVisible = ref(false);
const deleteDialogVisible = ref(false);
const editingDefinitionId = ref('');
const searchTimer = ref<number>();
const activeDeleteDefinition = ref<ProcessDefinition>();
const form = reactive({
  processName: '',
  remark: ''
});

async function loadDefinitions() {
  loading.value = true;
  try {
    definitions.value = await erpApi.processDefinitions(keyword.value.trim() || undefined, 'ENABLED');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '工序加载失败');
  } finally {
    loading.value = false;
  }
}

function openCreateDialog() {
  editingDefinitionId.value = '';
  form.processName = '';
  form.remark = '';
  dialogVisible.value = true;
}

function openEditDialog(definition: ProcessDefinition) {
  editingDefinitionId.value = definition.id;
  form.processName = definition.processName;
  form.remark = definition.remark || '';
  dialogVisible.value = true;
}

async function saveDefinition() {
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

function openDeleteDialog(definition: ProcessDefinition) {
  activeDeleteDefinition.value = definition;
  deleteDialogVisible.value = true;
}

async function deleteDefinition() {
  if (!activeDeleteDefinition.value) {
    return;
  }

  deleting.value = true;
  try {
    await erpApi.deleteProcessDefinition(activeDeleteDefinition.value.id);
    ElMessage.success('工序已删除');
    deleteDialogVisible.value = false;
    activeDeleteDefinition.value = undefined;
    await loadDefinitions();
    emit('updated');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '工序删除失败');
  } finally {
    deleting.value = false;
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
}
</style>
