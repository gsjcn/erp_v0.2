<template>
  <section class="process-template-manager" :class="{ compact }">
    <div class="process-template-toolbar">
      <div>
        <strong>{{ title }}</strong>
        <p v-if="hint">{{ hint }}</p>
      </div>
      <div class="process-template-tools">
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索流程名称 / 工序 / 备注 / 拼音 / 首字母"
          class="process-template-search"
          @keyup.enter="loadTemplates"
          @clear="loadTemplates"
        />
        <el-button :loading="loading" @click="loadTemplates">搜索</el-button>
        <el-button v-if="canCreateFromSource" @click="openCreateFromSourceDialog">保存当前流程</el-button>
        <el-button type="primary" @click="openCreateDialog">新建流程</el-button>
      </div>
    </div>

    <div v-loading="loading" class="process-template-list">
      <el-tooltip
        v-for="template in templates"
        :key="template.id"
        placement="top"
        effect="light"
        :show-after="250"
        popper-class="process-template-popper"
      >
        <template #content>
          <div class="process-template-tooltip">
            <strong>{{ template.templateName }}</strong>
            <ol>
              <li v-for="(step, index) in template.steps" :key="`${template.id}-${index}`">
                {{ step.processName }}<span v-if="step.processRemark">：{{ step.processRemark }}</span>
              </li>
            </ol>
            <p v-if="template.remark">备注：{{ template.remark }}</p>
          </div>
        </template>

        <article class="process-template-card">
          <button class="process-template-main" type="button" @click="handleTemplateMainClick(template)">
            <strong>{{ template.templateName }}</strong>
            <small>{{ templateStepSummary(template.steps) }}</small>
            <em v-if="template.remark">{{ template.remark }}</em>
          </button>
          <div class="process-template-card-actions">
            <el-button v-if="selectable" link type="primary" :disabled="disabled" @click.stop="applyTemplate(template)">应用</el-button>
            <el-button link type="primary" @click.stop="openPreviewDialog(template)">查看</el-button>
            <el-button link type="primary" @click.stop="openEditDialog(template)">编辑</el-button>
            <el-button link type="primary" @click.stop="openCopyDialog(template)">复制</el-button>
            <el-button link type="danger" @click.stop="openDeleteDialog(template)">删除</el-button>
          </div>
        </article>
      </el-tooltip>

      <el-empty v-if="!loading && templates.length === 0" description="没有匹配的流程记忆" />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="min(760px, calc(100vw - 32px))"
      class="process-template-dialog"
    >
      <el-form label-width="92px">
        <el-form-item label="流程名称" required>
          <el-input
            v-model="templateForm.templateName"
            placeholder="例如 激光折弯包装"
            :maxlength="templateNameMaxLength"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="流程备注">
          <el-input
            v-model="templateForm.remark"
            type="textarea"
            :rows="2"
            placeholder="说明适用范围、注意事项或特殊要求"
            :maxlength="templateRemarkMaxLength"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="流程步骤" required>
          <div class="template-step-editor">
            <div v-for="(step, index) in templateForm.steps" :key="`template-step-${index}`" class="template-step-row">
              <span class="template-step-index">{{ index + 1 }}</span>
              <el-select
                v-model="step.processName"
                filterable
                placeholder="标准工序 / 拼音 / 首字母"
                :filter-method="handleTemplateProcessFilter"
                @change="handleTemplateStepChange"
                @visible-change="handleTemplateProcessVisibleChange"
              >
                <el-option v-for="process in filteredDynamicProcessOptions" :key="process" :label="process" :value="process" />
              </el-select>
              <el-input
                v-model="step.processRemark"
                placeholder="参数备注，例如 4次 / M6孔"
                :maxlength="processRemarkMaxLength"
                show-word-limit
              />
              <div class="template-step-actions">
                <el-button link :disabled="index === 0" @click="moveTemplateStep(index, -1)">上移</el-button>
                <el-button link :disabled="index === templateForm.steps.length - 1" @click="moveTemplateStep(index, 1)">下移</el-button>
                <el-button link type="danger" @click="removeTemplateStep(index)">删除</el-button>
              </div>
            </div>
            <div class="template-step-add">
              <el-select
                v-model="newStepName"
                filterable
                placeholder="选择标准工序 / 拼音 / 首字母"
                style="width: 200px"
                :filter-method="handleNewStepProcessFilter"
                @visible-change="handleNewStepProcessVisibleChange"
              >
                <el-option v-for="process in filteredNewStepOptions" :key="process" :label="process" :value="process" />
              </el-select>
              <el-button @click="addTemplateStep">添加工序</el-button>
            </div>
            <div class="template-process-create">
              <el-input v-model="newProcessName" placeholder="新建标准工序，例如 抛丸" maxlength="30" />
              <el-button :loading="creatingProcess" @click="createProcessDefinition">新建标准工序</el-button>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveTemplate">保存流程记忆</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="previewVisible"
      title="流程记忆详情"
      width="min(560px, calc(100vw - 32px))"
      class="process-template-preview-dialog"
    >
      <div v-if="previewTemplate" class="process-template-preview">
        <h3>{{ previewTemplate.templateName }}</h3>
        <ol>
          <li v-for="(step, index) in previewTemplate.steps" :key="`preview-step-${index}`">
            <strong>{{ step.processName }}</strong>
            <span v-if="step.processRemark">：{{ step.processRemark }}</span>
          </li>
        </ol>
        <p v-if="previewTemplate.remark">备注：{{ previewTemplate.remark }}</p>
        <p v-else class="muted-text">暂无模板备注</p>
      </div>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <el-button v-if="selectable" type="primary" :disabled="disabled || !previewTemplate" @click="applyPreviewTemplate">应用此流程</el-button>
        <el-button v-if="previewTemplate" type="primary" plain @click="copyPreviewTemplate">复制编辑</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="deleteDialogVisible"
      title="删除流程记忆"
      width="min(520px, calc(100vw - 32px))"
      append-to-body
    >
      <div class="delete-template-summary">
        <p>
          <span>流程名称</span>
          <strong>{{ activeDeleteTemplate?.templateName }}</strong>
        </p>
        <p class="delete-template-warning">删除后不会影响已经保存到订单零件的流程。</p>
      </div>
      <template #footer>
        <el-button :disabled="deleting" @click="deleteDialogVisible = false">取消</el-button>
        <el-button type="danger" :loading="deleting" @click="deleteTemplate">删除</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { erpApi } from '../api/erp';
import type { ProcessStepDetail, ProcessTemplate } from '../types/erp';
import { filterPinyinSearchOptions } from '../utils/pinyinSearch';

const props = withDefaults(
  defineProps<{
    title?: string;
    hint?: string;
    selectable?: boolean;
    disabled?: boolean;
    compact?: boolean;
    sourceSteps?: ProcessStepDetail[];
    sourceName?: string;
  }>(),
  {
    title: '流程记忆',
    hint: '',
    selectable: false,
    disabled: false,
    compact: false,
    sourceSteps: () => [],
    sourceName: ''
  }
);

const emit = defineEmits<{
  apply: [steps: ProcessStepDetail[]];
  updated: [];
  processDefinitionUpdated: [];
}>();

const dynamicProcessOptions = ref<string[]>([]);
const templateNameMaxLength = 60;
const templateRemarkMaxLength = 300;
const processRemarkMaxLength = 120;
const templates = ref<ProcessTemplate[]>([]);
const keyword = ref('');
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const dialogVisible = ref(false);
const previewVisible = ref(false);
const deleteDialogVisible = ref(false);
const previewTemplate = ref<ProcessTemplate>();
const activeDeleteTemplate = ref<ProcessTemplate>();
const editingTemplateId = ref('');
const newStepName = ref('');
const newProcessName = ref('');
const searchTimer = ref<number>();
const creatingProcess = ref(false);
const templateProcessFilterKeyword = ref('');
const newStepProcessFilterKeyword = ref('');
const templateForm = reactive({
  templateName: '',
  remark: '',
  steps: [] as ProcessStepDetail[]
});

const dialogTitle = computed(() => (editingTemplateId.value ? '编辑流程记忆' : '新建流程记忆'));
const availableNewStepOptions = computed(() =>
  dynamicProcessOptions.value.filter(
    (processName) => !templateForm.steps.some((step) => normalizeProcessNameKey(step.processName) === normalizeProcessNameKey(processName))
  )
);
const filteredDynamicProcessOptions = computed(() => filterPinyinSearchOptions(dynamicProcessOptions.value, templateProcessFilterKeyword.value));
const filteredNewStepOptions = computed(() => filterPinyinSearchOptions(availableNewStepOptions.value, newStepProcessFilterKeyword.value));
const canCreateFromSource = computed(() =>
  props.sourceSteps.some((step) => {
    const processKey = normalizeProcessNameKey(step.processName || '');
    return Boolean(processKey && dynamicProcessOptions.value.some((item) => normalizeProcessNameKey(item) === processKey));
  })
);

async function loadProcessDefinitions() {
  try {
    const rows = await erpApi.processDefinitions(undefined, 'ENABLED');
    dynamicProcessOptions.value = rows.map((row) => row.processName);
  } catch (error) {
    dynamicProcessOptions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '标准工序加载失败');
  }
}

async function loadTemplates() {
  loading.value = true;
  try {
    templates.value = await erpApi.processTemplates(keyword.value.trim() || undefined);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '流程记忆加载失败');
  } finally {
    loading.value = false;
  }
}

async function createProcessDefinition() {
  const processName = newProcessName.value.trim();
  if (!processName) {
    ElMessage.warning('请填写标准工序名称');
    return;
  }
  const processKey = normalizeProcessNameKey(processName);
  if (dynamicProcessOptions.value.some((item) => normalizeProcessNameKey(item) === processKey)) {
    ElMessage.warning(`标准工序“${processName}”已存在，请勿重复创建`);
    return;
  }

  creatingProcess.value = true;
  try {
    const created = await erpApi.createProcessDefinition({ processName });
    await loadProcessDefinitions();
    newStepName.value = created.processName;
    newProcessName.value = '';
    ElMessage.success('标准工序已创建，可直接添加到流程');
    emit('processDefinitionUpdated');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '标准工序创建失败，请确认是否重复');
  } finally {
    creatingProcess.value = false;
  }
}

function handleTemplateMainClick(template: ProcessTemplate) {
  if (props.selectable && !props.disabled) {
    applyTemplate(template);
    return;
  }
  openEditDialog(template);
}

function applyTemplate(template: ProcessTemplate) {
  if (props.disabled) {
    ElMessage.warning('当前零件不能修改生产流程');
    return;
  }
  emit('apply', cloneProcessSteps(template.steps));
}

function openCreateDialog() {
  editingTemplateId.value = '';
  templateForm.templateName = '';
  templateForm.remark = '';
  templateForm.steps = [];
  newStepName.value = '';
  resetProcessSelectFilters();
  dialogVisible.value = true;
}

function openCreateFromSourceDialog() {
  editingTemplateId.value = '';
  const suggestedName = props.sourceName.trim() || '当前流程';
  templateForm.templateName = nextAvailableName(suggestedName);
  templateForm.remark = '';
  templateForm.steps = cloneProcessSteps(props.sourceSteps).filter((step) => step.processName);
  newStepName.value = '';
  resetProcessSelectFilters();
  dialogVisible.value = true;
}

function openEditDialog(template: ProcessTemplate) {
  editingTemplateId.value = template.id;
  templateForm.templateName = template.templateName;
  templateForm.remark = template.remark || '';
  templateForm.steps = cloneProcessSteps(template.steps);
  newStepName.value = '';
  resetProcessSelectFilters();
  dialogVisible.value = true;
}

function openCopyDialog(template: ProcessTemplate) {
  editingTemplateId.value = '';
  templateForm.templateName = nextAvailableName(`${template.templateName} 副本`);
  templateForm.remark = template.remark || '';
  templateForm.steps = cloneProcessSteps(template.steps);
  newStepName.value = '';
  resetProcessSelectFilters();
  dialogVisible.value = true;
}

function openPreviewDialog(template: ProcessTemplate) {
  previewTemplate.value = template;
  previewVisible.value = true;
}

function applyPreviewTemplate() {
  if (!previewTemplate.value) {
    return;
  }
  applyTemplate(previewTemplate.value);
  if (!props.disabled) {
    previewVisible.value = false;
  }
}

function copyPreviewTemplate() {
  if (!previewTemplate.value) {
    return;
  }
  openCopyDialog(previewTemplate.value);
  previewVisible.value = false;
}

function addTemplateStep() {
  const processName = newStepName.value.trim();
  if (!processName) {
    ElMessage.warning('请选择标准工序');
    return;
  }
  const processKey = normalizeProcessNameKey(processName);
  if (templateForm.steps.some((step) => normalizeProcessNameKey(step.processName) === processKey)) {
    ElMessage.warning(`当前流程已包含工序：${processName}`);
    return;
  }
  templateForm.steps.push({ processName, processRemark: '' });
  newStepName.value = '';
  newStepProcessFilterKeyword.value = '';
}

function handleTemplateStepChange() {
  normalizeTemplateSteps();
  templateProcessFilterKeyword.value = '';
  const duplicates = duplicateTemplateStepNames();
  if (duplicates.length > 0) {
    ElMessage.warning(`当前流程存在重复工序：${duplicates.join('、')}，请确认后再保存`);
  }
}

function handleTemplateProcessFilter(keyword: string) {
  templateProcessFilterKeyword.value = keyword;
}

function handleNewStepProcessFilter(keyword: string) {
  newStepProcessFilterKeyword.value = keyword;
}

function handleTemplateProcessVisibleChange(visible: boolean) {
  if (!visible) {
    templateProcessFilterKeyword.value = '';
  }
}

function handleNewStepProcessVisibleChange(visible: boolean) {
  if (!visible) {
    newStepProcessFilterKeyword.value = '';
  }
}

function resetProcessSelectFilters() {
  templateProcessFilterKeyword.value = '';
  newStepProcessFilterKeyword.value = '';
}

function removeTemplateStep(index: number) {
  templateForm.steps.splice(index, 1);
}

function moveTemplateStep(index: number, offset: number) {
  const target = index + offset;
  const next = [...templateForm.steps];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  templateForm.steps = next;
}

function normalizeTemplateSteps() {
  // 本地只做空白清理，不按当前下拉选项删除步骤；后端会校验标准工序是否仍启用。
  const result: ProcessStepDetail[] = [];
  for (const step of templateForm.steps) {
    const processName = step.processName.trim();
    if (!processName) {
      continue;
    }
    const processRemark = step.processRemark?.trim();
    result.push({ processName, ...(processRemark ? { processRemark } : {}) });
  }
  templateForm.steps = result;
}

function duplicateTemplateStepNames() {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const step of templateForm.steps) {
    const processName = step.processName.trim();
    const processKey = normalizeProcessNameKey(processName);
    if (!processKey) {
      continue;
    }
    if (seen.has(processKey)) {
      duplicates.add(processName);
    }
    seen.add(processKey);
  }
  return [...duplicates];
}

function normalizeProcessNameKey(processName: string) {
  return processName.trim().toLocaleLowerCase().replace(/[\s\-_./\\]+/g, '');
}

async function saveTemplate() {
  normalizeTemplateSteps();
  const templateName = templateForm.templateName.trim();
  if (!templateName) {
    ElMessage.warning('请填写流程名称');
    return;
  }
  if (templateName.length > templateNameMaxLength) {
    ElMessage.warning(`流程名称不能超过 ${templateNameMaxLength} 个字符`);
    return;
  }
  const templateNameKey = normalizeTemplateNameKey(templateName);
  const duplicatedTemplate = templates.value.find(
    (template) => template.id !== editingTemplateId.value && normalizeTemplateNameKey(template.templateName) === templateNameKey
  );
  if (duplicatedTemplate) {
    ElMessage.warning(`流程记忆“${duplicatedTemplate.templateName}”已存在，请勿重复创建`);
    return;
  }
  if (templateForm.remark.trim().length > templateRemarkMaxLength) {
    ElMessage.warning(`流程备注不能超过 ${templateRemarkMaxLength} 个字符`);
    return;
  }
  const longRemarkStep = templateForm.steps.find((step) => (step.processRemark || '').trim().length > processRemarkMaxLength);
  if (longRemarkStep) {
    ElMessage.warning(`工序“${longRemarkStep.processName}”的参数备注不能超过 ${processRemarkMaxLength} 个字符`);
    return;
  }
  if (templateForm.steps.length === 0) {
    ElMessage.warning('请至少添加一道工序');
    return;
  }
  const duplicates = duplicateTemplateStepNames();
  if (duplicates.length > 0) {
    ElMessage.warning(`当前流程存在重复工序：${duplicates.join('、')}，请删除或调整后再保存`);
    return;
  }

  saving.value = true;
  try {
    const payload = {
      templateName,
      remark: templateForm.remark.trim() || undefined,
      steps: templateForm.steps.map((step) => ({ ...step }))
    };
    if (editingTemplateId.value) {
      await erpApi.updateProcessTemplate(editingTemplateId.value, payload);
    } else {
      await erpApi.createProcessTemplate(payload);
    }
    ElMessage.success('流程记忆已保存');
    dialogVisible.value = false;
    await loadTemplates();
    emit('updated');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '流程记忆保存失败');
  } finally {
    saving.value = false;
  }
}

function cloneProcessSteps(steps: ProcessStepDetail[]) {
  // 应用模板时保留模板里的完整步骤；标准工序是否仍可用由保存接口统一校验，避免接口加载慢时把步骤误删。
  return steps
    .map((step) => ({
      processName: step.processName.trim(),
      ...(step.processRemark?.trim() ? { processRemark: step.processRemark.trim() } : {})
    }))
    .filter((step) => step.processName);
}

function nextAvailableName(name: string) {
  const baseName = truncateTemplateName(name.trim() || '流程记忆');
  const usedNames = new Set(templates.value.map((template) => normalizeTemplateNameKey(template.templateName)));
  if (!usedNames.has(normalizeTemplateNameKey(baseName))) {
    return baseName;
  }

  let index = 2;
  let candidate = buildNumberedTemplateName(baseName, index);
  while (usedNames.has(normalizeTemplateNameKey(candidate))) {
    index += 1;
    candidate = buildNumberedTemplateName(baseName, index);
  }
  return candidate;
}

function truncateTemplateName(name: string) {
  return name.length > templateNameMaxLength ? name.slice(0, templateNameMaxLength).trim() : name;
}

function buildNumberedTemplateName(baseName: string, index: number) {
  const suffix = ` ${index}`;
  const head = baseName.slice(0, templateNameMaxLength - suffix.length).trim();
  return `${head}${suffix}`;
}

function normalizeTemplateNameKey(templateName: string) {
  return templateName.trim().toLocaleLowerCase().replace(/[\s\-_./\\]+/g, '');
}

function openDeleteDialog(template: ProcessTemplate) {
  activeDeleteTemplate.value = template;
  deleteDialogVisible.value = true;
}

async function deleteTemplate() {
  if (!activeDeleteTemplate.value) {
    return;
  }

  deleting.value = true;
  try {
    await erpApi.deleteProcessTemplate(activeDeleteTemplate.value.id);
    ElMessage.success('流程记忆已删除');
    deleteDialogVisible.value = false;
    activeDeleteTemplate.value = undefined;
    await loadTemplates();
    emit('updated');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '流程记忆删除失败');
  } finally {
    deleting.value = false;
  }
}

function templateStepSummary(steps: ProcessStepDetail[]) {
  return steps.map((step) => (step.processRemark ? `${step.processName}(${step.processRemark})` : step.processName)).join(' → ');
}

watch(keyword, () => {
  window.clearTimeout(searchTimer.value);
  searchTimer.value = window.setTimeout(() => {
    void loadTemplates();
  }, 250);
});

onMounted(() => {
  void loadProcessDefinitions();
  void loadTemplates();
});
onBeforeUnmount(() => window.clearTimeout(searchTimer.value));
</script>

<style scoped>
.process-template-manager {
  display: grid;
  gap: 12px;
}

.process-template-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.process-template-toolbar strong {
  color: #0f172a;
}

.process-template-toolbar p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
}

.process-template-tools {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.process-template-search {
  width: 260px;
}

.process-template-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
  min-height: 64px;
}

.compact .process-template-list {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
}

.process-template-card {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.compact .process-template-card {
  min-width: 180px;
  max-width: 280px;
  padding: 8px 10px;
}

.process-template-main {
  display: grid;
  align-content: start;
  gap: 6px;
  width: 100%;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.process-template-main strong {
  color: #0f172a;
}

.process-template-main small,
.process-template-main em {
  display: -webkit-box;
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  font-style: normal;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.process-template-card-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.process-template-card-actions .el-button {
  margin-left: 0;
}

.template-step-editor {
  display: grid;
  gap: 10px;
  width: 100%;
}

.template-step-row {
  display: grid;
  grid-template-columns: 34px minmax(150px, 180px) minmax(180px, 1fr) 150px;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.template-step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: #1d4ed8;
  background: #dbeafe;
  border-radius: 13px;
  font-size: 12px;
  font-weight: 600;
}

.template-step-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.template-step-actions .el-button {
  margin-left: 0;
}

.template-step-add {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.template-process-create {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  gap: 10px;
  padding-top: 2px;
}

.process-template-preview {
  display: grid;
  gap: 12px;
}

.process-template-preview h3 {
  margin: 0;
  color: #0f172a;
}

.process-template-preview ol {
  margin: 0;
  padding-left: 22px;
}

.process-template-preview li {
  margin: 8px 0;
  line-height: 1.5;
}

.process-template-preview p {
  margin: 0;
  color: #475569;
  line-height: 1.6;
}

.muted-text {
  color: #94a3b8 !important;
}

:global(.process-template-popper) {
  max-width: 360px;
}

.process-template-tooltip {
  max-width: 320px;
}

.process-template-tooltip strong {
  display: block;
  margin-bottom: 6px;
}

.process-template-tooltip ol {
  margin: 0;
  padding-left: 18px;
}

.process-template-tooltip p {
  margin: 8px 0 0;
  color: #64748b;
}

.delete-template-summary {
  display: grid;
  gap: 12px;
}

.delete-template-summary p {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0;
}

.delete-template-summary span {
  color: #64748b;
  font-size: 13px;
}

.delete-template-summary strong {
  color: #0f172a;
}

.delete-template-warning {
  display: block !important;
  padding: 10px 12px;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  line-height: 1.6;
}

@media (max-width: 900px) {
  .process-template-toolbar {
    display: grid;
  }

  .process-template-tools,
  .process-template-search {
    width: 100%;
  }

  .process-template-tools .el-button {
    flex: 1 1 96px;
  }

  .process-template-card-actions {
    justify-content: stretch;
  }

  .process-template-card-actions .el-button {
    flex: 1 1 72px;
    min-width: 0;
  }

  .template-step-add .el-select,
  .template-step-add .el-button,
  .template-process-create .el-input,
  .template-process-create .el-button {
    width: 100% !important;
  }

  .template-process-create {
    grid-template-columns: 1fr;
  }

  .process-template-list {
    grid-template-columns: 1fr;
  }

  .compact .process-template-list {
    display: grid;
    grid-template-columns: 1fr;
  }

  .compact .process-template-card {
    max-width: none;
  }

  .template-step-row {
    grid-template-columns: 30px minmax(0, 1fr);
  }

  .template-step-row .el-select,
  .template-step-row .el-input,
  .template-step-actions {
    grid-column: 2;
  }

  .template-step-actions {
    justify-content: flex-start;
  }
}
</style>
