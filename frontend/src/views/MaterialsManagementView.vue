<template>
  <section class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">零件管理</h2>
        <p class="page-subtitle">下单前维护零件基础资料、适用范围、机型 BOM 和最近历史用料。</p>
      </div>
      <div class="page-actions">
        <el-button @click="openDesktopMaintenancePage('/inventory/materials', '零件基础库维护')">零件基础库</el-button>
        <el-button @click="openDesktopMaintenancePage('/inventory/model-boms', '机型零件包维护')">机型零件包</el-button>
        <el-button @click="openDesktopMaintenancePage('/inventory/material-transforms', '来源加工关系维护')">来源加工关系</el-button>
        <el-button type="primary" @click="openCreateDialog">新增零件</el-button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">筛选结果</div>
        <div class="stat-value">{{ dashboard.summary.totalCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">通用件</div>
        <div class="stat-value">{{ dashboard.summary.commonCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">定制件</div>
        <div class="stat-value">{{ dashboard.summary.customCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">已进 BOM</div>
        <div class="stat-value">{{ dashboard.summary.withBomCount }}</div>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect v-model="filters.customerId" placeholder="全部客户" width="240px" @change="handleCustomerChange" />
      </div>
      <div class="filter-field">
        <label>机型 / 项目</label>
        <el-select
          v-model="filters.projectModel"
          clearable
          filterable
          allow-create
          placeholder="全部机型 / 项目"
          style="width: 210px"
          @change="resetAndLoad"
        >
          <el-option v-for="item in projectOptions" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>零件关键字</label>
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="编码 / 名称 / 客户 / 订单 / 规格"
          style="width: 280px"
          @keyup.enter="resetAndLoad"
        />
      </div>
      <div class="filter-field">
        <label>通用 / 定制</label>
        <el-select v-model="filters.scopeType" clearable placeholder="全部" style="width: 140px" @change="resetAndLoad">
          <el-option label="通用件" value="COMMON" />
          <el-option label="定制件" value="CUSTOM" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>图号</label>
        <el-input v-model="filters.drawingNo" clearable placeholder="图号" style="width: 180px" @keyup.enter="resetAndLoad" />
      </div>
      <div class="filter-field">
        <label>图纸状态</label>
        <el-input v-model="filters.drawingStatus" clearable placeholder="旧图 / 新图" style="width: 140px" @keyup.enter="resetAndLoad" />
      </div>
      <div class="filter-field">
        <label>图纸日期</label>
        <DateRangeFilter v-model="drawingDateRange" width="220px" @change="resetAndLoad" />
      </div>
      <div class="filter-field">
        <label>最近下单</label>
        <DateRangeFilter v-model="lastOrderDateRange" width="220px" @change="resetAndLoad" />
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" clearable placeholder="全部" style="width: 120px" @change="resetAndLoad">
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="resetAndLoad">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div v-if="projectOptions.length" class="project-quick-list">
      <span>常用机型</span>
      <span v-if="quickProjectHiddenCount > 0" class="project-quick-more">
        已显示前 {{ quickProjectOptions.length }} 个，另有 {{ quickProjectHiddenCount }} 个可在上方下拉搜索
      </span>
      <el-button
        v-for="item in quickProjectOptions"
        :key="item"
        size="small"
        :type="filters.projectModel === item ? 'primary' : 'default'"
        plain
        @click="selectProject(item)"
      >
        {{ item }}
      </el-button>
    </div>

    <div class="table-card desktop-table">
      <div class="section-heading">
        <div>
          <strong>零件控制面板</strong>
          <span>第 {{ pagination.page }} 页，已显示 {{ dashboard.items.length }} / {{ dashboard.totalCount }} 条</span>
        </div>
        <el-button size="small" :disabled="dashboard.items.length === 0" @click="copyDashboardText">复制当前页</el-button>
      </div>
      <el-table v-loading="loading" :data="dashboard.items" max-height="640">
        <el-table-column prop="partCode" label="零件编码" min-width="150" fixed="left" />
        <el-table-column prop="partName" label="零件名称" min-width="170" fixed="left" />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag :type="row.scopeType === 'COMMON' ? 'success' : 'warning'" effect="plain">{{ row.partType || row.scopeLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="所属客户" min-width="180">
          <template #default="{ row }">{{ joinPreview(row.customerNames, '全部客户') }}</template>
        </el-table-column>
        <el-table-column label="机型 / 项目" min-width="160">
          <template #default="{ row }">{{ joinPreview(row.projectModels, '全部机型') }}</template>
        </el-table-column>
        <el-table-column label="图纸" min-width="210">
          <template #default="{ row }">
            <div>{{ row.drawingNo || '-' }}</div>
            <div class="cell-subtext">{{ [row.drawingVersion, row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ') || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="厚度 / 规格" min-width="170">
          <template #default="{ row }">
            <div>{{ row.partThickness ?? '-' }}</div>
            <div class="cell-subtext">{{ row.partSpecification || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="默认数量" width="120">
          <template #default="{ row }">{{ row.defaultQuantity ? formatQuantity(row.defaultQuantity, row.defaultQuantityUnit || row.unit) : '-' }}</template>
        </el-table-column>
        <el-table-column label="默认工艺" min-width="180">
          <template #default="{ row }">{{ row.defaultProcessRoute || '-' }}</template>
        </el-table-column>
        <el-table-column label="最近下单" min-width="220">
          <template #default="{ row }">
            <div>{{ row.lastOrderDate || '-' }}</div>
            <div class="cell-subtext">{{ row.lastOrderNo || '-' }} / {{ row.lastCustomerName || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="库存" min-width="180">
          <template #default="{ row }">
            <div>可用 {{ formatQuantity(row.availableQuantity, row.unit) }}</div>
            <div class="cell-subtext">订单 {{ formatQuantity(row.orderInventoryQuantity, row.unit) }} / 备货 {{ formatQuantity(row.stockInventoryQuantity, row.unit) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="BOM" min-width="180">
          <template #default="{ row }">{{ joinPreview(row.bomNames, '-') }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">{{ row.status === 'ENABLED' ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="350" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openMaterialDrawingMaintain(row)">图纸</el-button>
            <el-button link type="primary" @click="openMaterialApplicabilityMaintain(row)">适用</el-button>
            <el-button link type="primary" @click="openBomMaintain(row)">BOM</el-button>
            <el-button link type="primary" @click="openSourceDetails(row)">库存</el-button>
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button v-if="row.status === 'ENABLED'" link type="danger" @click="disableMaterial(row)">停用</el-button>
            <el-button v-else link type="success" @click="enableMaterial(row)">启用</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-bar">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[20, 50, 100, 200]"
          :total="dashboard.totalCount"
          layout="total, sizes, prev, pager, next"
          @size-change="handlePageSizeChange"
          @current-change="loadDashboard"
        />
      </div>
    </div>

    <div class="mobile-section">
      <el-alert
        title="手机端仅查看零件管理信息"
        description="零件新增、编辑、停用、导入和 BOM 维护请在电脑端操作。"
        type="info"
        :closable="false"
      />
      <div v-for="row in dashboard.items" :key="row.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.partName }}</strong>
            <small>{{ row.partCode }} / {{ row.unit }}</small>
          </div>
          <el-tag :type="row.scopeType === 'COMMON' ? 'success' : 'warning'" effect="plain" size="small">{{ row.partType || row.scopeLabel }}</el-tag>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ joinPreview(row.customerNames, '全部客户') }}</span>
          </div>
          <div class="mobile-field">
            <label>机型</label>
            <span>{{ joinPreview(row.projectModels, '全部机型') }}</span>
          </div>
          <div class="mobile-field">
            <label>图纸</label>
            <span>{{ row.drawingNo || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>最近下单</label>
            <span>{{ row.lastOrderDate || '-' }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button size="small" type="primary" plain @click="openMaterialDrawingMaintain(row)">图纸</el-button>
          <el-button size="small" type="primary" plain @click="openMaterialApplicabilityMaintain(row)">适用</el-button>
          <el-button size="small" type="primary" plain @click="openBomMaintain(row)">BOM</el-button>
          <el-button size="small" type="primary" plain @click="openSourceDetails(row)">库存来源</el-button>
        </div>
      </div>
      <div v-if="dashboard.totalCount > 0" class="mobile-pagination-bar">
        <span>第 {{ pagination.page }} 页，已显示 {{ dashboard.items.length }} / {{ dashboard.totalCount }} 条</span>
        <div class="mobile-pagination-actions">
          <el-button size="small" :disabled="loading || pagination.page <= 1" @click="loadMobilePreviousPage">上一页</el-button>
          <el-button size="small" type="primary" plain :disabled="loading || !dashboard.hasMore" @click="loadMobileNextPage">继续加载</el-button>
        </div>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" class="responsive-dialog" :title="dialogTitle" width="560px">
      <el-form label-width="110px">
        <el-form-item label="零件编码" required>
          <el-input v-model="form.partCode" placeholder="例如 RS1001" />
        </el-form-item>
        <el-form-item label="零件名称" required>
          <el-input v-model="form.partName" placeholder="例如 顶盖" />
        </el-form-item>
        <el-form-item label="单位" required>
          <el-input v-model="form.unit" placeholder="件 / 套" />
        </el-form-item>
        <el-form-item label="成品规格">
          <el-input v-model="form.partSpecification" placeholder="可留空" />
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
        <el-button type="primary" :loading="saving" @click="saveMaterial">保存</el-button>
      </template>
    </el-dialog>

    <InventorySourceDetailsDialog
      v-model="sourceDetailsVisible"
      :loading="sourceDetailsLoading"
      :detail="sourceDetails"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import InventorySourceDetailsDialog from '../components/InventorySourceDetailsDialog.vue';
import type { CommonStatus, InventorySourceDetailResponse, MaterialDashboardResponse, MaterialDashboardRow } from '../types/erp';

const router = useRouter();
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editingMaterialId = ref('');
const projectOptions = ref<string[]>([]);
const drawingDateRange = ref<string[]>([]);
const lastOrderDateRange = ref<string[]>([]);
const sourceDetailsVisible = ref(false);
const sourceDetailsLoading = ref(false);
const sourceDetails = ref<InventorySourceDetailResponse | null>(null);

const dashboard = reactive<MaterialDashboardResponse>({
  items: [],
  totalCount: 0,
  limit: Number(50),
  offset: 0,
  hasMore: false,
  summary: {
    totalCount: 0,
    enabledCount: 0,
    disabledCount: 0,
    commonCount: 0,
    customCount: 0,
    withBomCount: 0,
    withRecentOrderCount: 0
  }
});

const filters = reactive<{
  keyword: string;
  customerId: string;
  projectModel: string;
  scopeType: '' | 'COMMON' | 'CUSTOM';
  drawingNo: string;
  drawingStatus: string;
  status: '' | CommonStatus;
}>({
  keyword: '',
  customerId: '',
  projectModel: '',
  scopeType: '',
  drawingNo: '',
  drawingStatus: '',
  status: 'ENABLED'
});

const pagination = reactive({
  page: 1,
  pageSize: Number(50)
});

const form = reactive<{
  partCode: string;
  partName: string;
  unit: string;
  partSpecification: string;
  status: CommonStatus;
}>({
  partCode: '',
  partName: '',
  unit: '件',
  partSpecification: '',
  status: 'ENABLED'
});

const dialogTitle = computed(() => (editingMaterialId.value ? '编辑零件基础资料' : '新增零件基础资料'));
const quickProjectOptions = computed(() => projectOptions.value.filter((_, index) => index < 12));
const quickProjectHiddenCount = computed(() => Math.max(projectOptions.value.length - quickProjectOptions.value.length, 0));

onMounted(async () => {
  await Promise.all([loadProjectOptions(), loadDashboard()]);
});

async function loadDashboard() {
  loading.value = true;
  try {
    const result = await erpApi.materialDashboard({
      keyword: filters.keyword.trim() || undefined,
      customerId: filters.customerId || undefined,
      projectModel: filters.projectModel.trim() || undefined,
      scopeType: filters.scopeType || undefined,
      drawingNo: filters.drawingNo.trim() || undefined,
      drawingStatus: filters.drawingStatus.trim() || undefined,
      drawingDateFrom: drawingDateRange.value[0],
      drawingDateTo: drawingDateRange.value[1],
      lastOrderDateFrom: lastOrderDateRange.value[0],
      lastOrderDateTo: lastOrderDateRange.value[1],
      status: filters.status || undefined,
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize
    });
    Object.assign(dashboard, result);
  } finally {
    loading.value = false;
  }
}

async function loadProjectOptions() {
  projectOptions.value = await erpApi.materialProjectModels(filters.customerId || undefined);
}

async function handleCustomerChange() {
  filters.projectModel = '';
  await loadProjectOptions();
  resetAndLoad();
}

function resetAndLoad() {
  pagination.page = 1;
  void loadDashboard();
}

async function resetFilters() {
  filters.keyword = '';
  filters.customerId = '';
  filters.projectModel = '';
  filters.scopeType = '';
  filters.drawingNo = '';
  filters.drawingStatus = '';
  filters.status = 'ENABLED';
  drawingDateRange.value = [];
  lastOrderDateRange.value = [];
  pagination.page = 1;
  await loadProjectOptions();
  await loadDashboard();
}

function selectProject(projectModel: string) {
  filters.projectModel = filters.projectModel === projectModel ? '' : projectModel;
  resetAndLoad();
}

function handlePageSizeChange() {
  pagination.page = 1;
  void loadDashboard();
}

function loadMobilePreviousPage() {
  if (pagination.page <= 1 || loading.value) {
    return;
  }
  pagination.page -= 1;
  void loadDashboard();
}

function loadMobileNextPage() {
  if (!dashboard.hasMore || loading.value) {
    return;
  }
  pagination.page += 1;
  void loadDashboard();
}

function resetForm() {
  editingMaterialId.value = '';
  form.partCode = '';
  form.partName = '';
  form.unit = '件';
  form.partSpecification = '';
  form.status = 'ENABLED';
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
}

function showMobileDesktopNotice(actionLabel: string) {
  ElMessage.warning(`手机端仅查看零件管理信息，${actionLabel}请在电脑端操作`);
}

function guardDesktopOperation(actionLabel: string) {
  if (!isMobileViewport()) {
    return false;
  }
  showMobileDesktopNotice(actionLabel);
  return true;
}

function openDesktopMaintenancePage(path: string, actionLabel: string) {
  if (guardDesktopOperation(actionLabel)) {
    return;
  }
  router.push(path);
}

function openCreateDialog() {
  if (guardDesktopOperation('新增零件')) {
    return;
  }
  resetForm();
  dialogVisible.value = true;
}

function openEditDialog(row: MaterialDashboardRow) {
  if (guardDesktopOperation('编辑零件')) {
    return;
  }
  editingMaterialId.value = row.id;
  form.partCode = row.partCode;
  form.partName = row.partName;
  form.unit = row.unit;
  form.partSpecification = row.partSpecification || '';
  form.status = row.status;
  dialogVisible.value = true;
}

async function saveMaterial() {
  const partCode = form.partCode.trim();
  const partName = form.partName.trim();
  const unit = form.unit.trim();
  if (!partCode || !partName || !unit) {
    ElMessage.warning('请填写零件编码、零件名称和单位');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      partCode,
      partName,
      unit,
      partSpecification: form.partSpecification.trim() || undefined,
      status: form.status
    };
    if (editingMaterialId.value) {
      await erpApi.updateInventoryMaterial(editingMaterialId.value, payload);
      ElMessage.success('零件基础资料已保存');
    } else {
      await erpApi.createInventoryMaterial(payload);
      ElMessage.success('零件基础资料已新增');
    }
    dialogVisible.value = false;
    await loadDashboard();
  } finally {
    saving.value = false;
  }
}

async function disableMaterial(row: MaterialDashboardRow) {
  if (guardDesktopOperation('停用零件')) {
    return;
  }
  await ElMessageBox.confirm(
    `确定停用零件 ${row.partCode} / ${row.partName} 吗？系统只会停用基础资料，不会删除历史订单、库存或生产记录。`,
    '停用零件',
    { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' }
  );
  await erpApi.disableInventoryMaterial(row.id);
  ElMessage.success('零件已停用');
  await loadDashboard();
}

async function enableMaterial(row: MaterialDashboardRow) {
  if (guardDesktopOperation('启用零件')) {
    return;
  }
  await erpApi.updateInventoryMaterial(row.id, { status: 'ENABLED' });
  ElMessage.success('零件已启用');
  await loadDashboard();
}

function openMaterialMaintain(row: MaterialDashboardRow, action: 'drawing' | 'applicability') {
  router.push({
    path: '/inventory/materials',
    query: {
      keyword: row.partCode,
      status: row.status,
      action
    }
  });
}

function openMaterialDrawingMaintain(row: MaterialDashboardRow) {
  if (guardDesktopOperation('图纸版本维护')) {
    return;
  }
  openMaterialMaintain(row, 'drawing');
}

function openMaterialApplicabilityMaintain(row: MaterialDashboardRow) {
  if (guardDesktopOperation('适用范围维护')) {
    return;
  }
  openMaterialMaintain(row, 'applicability');
}

function openBomMaintain(row: MaterialDashboardRow) {
  if (guardDesktopOperation('BOM 维护')) {
    return;
  }
  router.push({
    path: '/inventory/model-boms',
    query: {
      keyword: row.partCode,
      customerId: filters.customerId || undefined,
      projectModel: filters.projectModel || row.projectModels[0] || undefined,
      status: 'ENABLED'
    }
  });
}

async function openSourceDetails(row: MaterialDashboardRow) {
  if (!row.partCode?.trim()) {
    ElMessage.warning('请先选择零件');
    return;
  }
  sourceDetailsVisible.value = true;
  sourceDetailsLoading.value = true;
  sourceDetails.value = null;
  try {
    sourceDetails.value = await erpApi.inventoryMaterialSourceDetails(row.partCode.trim(), {
      unit: row.unit,
      sourceType: 'ALL'
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '库存来源查询失败');
  } finally {
    sourceDetailsLoading.value = false;
  }
}

function buildDashboardText() {
  if (!dashboard.items.length) {
    return '';
  }
  const header = [
    `零件管理固定格式清单`,
    `筛选：客户 ${filters.customerId || '全部'}；机型 ${filters.projectModel || '全部'}；关键字 ${filters.keyword || '无'}；状态 ${filters.status || '全部'}`,
    `页码：第 ${pagination.page} 页；本页 ${dashboard.items.length} 条；总计 ${dashboard.totalCount} 条`
  ].join('\n');
  const body = dashboard.items.map((row, index) => formatDashboardRowText(row, index + 1)).join('\n');
  return `${header}\n${body}`;
}

function formatDashboardRowText(row: MaterialDashboardRow, index: number) {
  return [
    `${index}. ${row.partCode} | ${row.partName}`,
    `类型：${row.partType || row.scopeLabel || '-'}；范围：${row.scopeLabel || '-'}；客户：${joinPreview(row.customerNames, '全部客户')}；机型：${joinPreview(row.projectModels, '全部机型')}`,
    `图纸：${row.drawingNo || '-'} / ${row.drawingVersion || '-'} / ${row.drawingDate || '-'} / ${row.drawingStatus || '-'}`,
    `厚度规格：${row.partThickness ?? '-'} / ${row.partSpecification || '-'}；默认数量：${row.defaultQuantity ? formatQuantity(row.defaultQuantity, row.defaultQuantityUnit || row.unit) : '-'}；默认工艺：${row.defaultProcessRoute || '-'}`,
    `最近下单：${row.lastOrderDate || '-'} / ${row.lastOrderNo || '-'} / ${row.lastCustomerName || '-'}；库存：可用 ${formatQuantity(row.availableQuantity, row.unit)}，订单 ${formatQuantity(row.orderInventoryQuantity, row.unit)}，备货 ${formatQuantity(row.stockInventoryQuantity, row.unit)}；BOM：${joinPreview(row.bomNames, '-')}`
  ].join('\n');
}

async function copyDashboardText() {
  const text = buildDashboardText();
  if (!text) {
    ElMessage.warning('暂无可复制的零件清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('零件固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

function joinPreview(values: string[], emptyText = '-') {
  const filtered = values.filter(Boolean);
  if (filtered.length === 0) {
    return emptyText;
  }
  const preview = filtered.filter((_, index) => index < 3).join('、');
  return filtered.length > 3 ? `${preview} 等 ${filtered.length} 项` : preview;
}

function formatQuantity(value: number | undefined | null, unit?: string | null) {
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

.project-quick-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: -10px 0 18px;
}

.project-quick-list span {
  color: #64748b;
  font-size: 13px;
}

.project-quick-more {
  color: #94a3b8;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #e2e8f0;
}

.section-heading > div {
  display: grid;
  gap: 4px;
}

.section-heading span {
  color: #64748b;
  font-size: 12px;
}

.cell-subtext {
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  padding: 14px 16px;
  border-top: 1px solid #e2e8f0;
}

.mobile-pagination-bar {
  display: none;
}

.mobile-pagination-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 900px) {
  .project-quick-list {
    align-items: stretch;
    margin-top: 0;
  }

  .project-quick-list span {
    width: 100%;
  }

  .project-quick-list .el-button {
    flex: 1 1 96px;
    margin-left: 0;
  }

  .mobile-pagination-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 0 4px;
    color: #64748b;
    font-size: 13px;
  }

  .mobile-pagination-actions {
    width: 100%;
  }

  .mobile-pagination-actions .el-button {
    flex: 1 1 96px;
    margin-left: 0;
  }
}
</style>
