<template>
  <section class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">零件基础库</h2>
        <p class="page-subtitle">维护下单可搜索的零件搜索记忆；不会生成订单、不会占用库存、不会创建生产任务。</p>
      </div>
      <div class="page-actions">
        <el-button v-if="!isMobileLayout" :loading="materialImportTemplateDownloading" @click="downloadMaterialImportTemplate">下载导入模板</el-button>
        <el-button v-if="!isMobileLayout" :icon="Download" :loading="materialExporting" @click="exportMaterialsExcel">导出 Excel</el-button>
        <el-button v-if="!isMobileLayout" type="success" plain @click="openImportDialog">导入零件库</el-button>
        <el-button @click="router.push('/materials')">返回零件管理</el-button>
        <el-button @click="openDesktopMaintenancePage('/inventory/model-boms', '机型零件包维护')">机型零件包</el-button>
        <el-button @click="openDesktopMaintenancePage('/inventory/material-transforms', '来源加工关系维护')">来源加工关系</el-button>
        <el-button v-if="!isMobileLayout" type="primary" @click="openCreateDialog">新增零件</el-button>
      </div>
    </div>

    <el-alert
      class="material-library-alert"
      type="info"
      :closable="false"
      show-icon
      title="导入说明"
      description="零件库导入可预览写入零件基础资料、适用范围和来源加工关系；必须人工确认，不会创建订单、库存或生产任务。"
    />

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">筛选结果</div>
        <div class="stat-value">{{ materialPagination.total }} 条</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">当前页</div>
        <div class="stat-value">{{ materials.length }} 条</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">当前页启用</div>
        <div class="stat-value">{{ enabledCount }} 条</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">当前页停用</div>
        <div class="stat-value">{{ disabledCount }} 条</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">当前页可用库存</div>
        <div class="stat-value">{{ currentAvailableText }}</div>
      </div>
      <button
        class="stat-card stat-card-button"
        :class="{ active: filters.stockAlert === 'TRIGGERED' }"
        type="button"
        @click="applyTriggeredStockAlertFilter"
      >
        <div class="stat-label">低库存报警</div>
        <div class="stat-value">{{ triggeredStockAlertText }}</div>
      </button>
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>零件关键字</label>
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="编码 / 名称 / 拼音 / 规格 / 客户 / 订单 / 图号"
          style="width: 360px"
          @keyup.enter="searchMaterials"
        />
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" placeholder="状态" style="width: 140px" @change="searchMaterials">
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>库存报警</label>
        <el-select v-model="filters.stockAlert" clearable placeholder="全部报警" style="width: 150px" @change="searchMaterials">
          <el-option label="已触发" value="TRIGGERED" />
          <el-option label="已启用" value="ENABLED" />
          <el-option label="未启用" value="DISABLED" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="searchMaterials">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="table-card desktop-table">
      <div class="section-heading">
        <div>
          <strong>零件基础资料</strong>
          <span>库存数量从 InventoryBatch 实时汇总；停用只影响后续搜索和推荐，不删除历史订单、库存批次、库存数量或生产记录。</span>
        </div>
        <div v-if="!isMobileLayout" class="material-library-table-height-actions" aria-label="零件基础资料表格高度">
          <span class="material-library-table-height-label">表格高度</span>
          <el-tooltip content="降低表格高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="Minus"
              :disabled="materialLibraryWorkTableHeights.materials <= materialLibraryWorkTableHeightLimits.min"
              aria-label="降低零件基础资料表格高度"
              @click="adjustMaterialLibraryWorkTableHeight('materials', -materialLibraryWorkTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="提高表格高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="Plus"
              :disabled="materialLibraryWorkTableHeights.materials >= materialLibraryWorkTableHeightLimits.max"
              aria-label="提高零件基础资料表格高度"
              @click="adjustMaterialLibraryWorkTableHeight('materials', materialLibraryWorkTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="恢复默认高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="RefreshLeft"
              :disabled="materialLibraryWorkTableHeights.materials === materialLibraryWorkTableDefaultHeights.materials"
              aria-label="恢复零件基础资料表格默认高度"
              @click="resetMaterialLibraryWorkTableHeight('materials')"
            />
          </el-tooltip>
        </div>
      </div>
      <el-table v-loading="loading" :data="materials" :max-height="materialLibraryWorkTableHeights.materials">
        <el-table-column prop="partCode" label="零件编码" min-width="160" />
        <el-table-column prop="partName" label="零件名称" min-width="180" />
        <el-table-column prop="unit" label="单位" width="90" />
        <el-table-column prop="partSpecification" label="成品规格" min-width="180">
          <template #default="{ row }">{{ row.partSpecification || '-' }}</template>
        </el-table-column>
        <el-table-column prop="defaultProcessRoute" label="默认工艺" min-width="180">
          <template #default="{ row }">
            <el-tooltip :content="processRouteTooltipText(row.defaultProcessRoute)" placement="top" :disabled="!row.defaultProcessRoute">
              <span>{{ formatProcessRoutePreview(row.defaultProcessRoute) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
              {{ row.status === 'ENABLED' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="当前库存" width="150">
          <template #default="{ row }">{{ formatQuantity(row.availableQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="库存报警" width="160">
          <template #default="{ row }">
            <el-tag :type="stockAlertTagType(row)" effect="plain">
              {{ stockAlertText(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="库存构成" min-width="180">
          <template #default="{ row }">
            <div>订单库存 {{ formatQuantity(row.orderInventoryQuantity, row.unit) }}</div>
            <div class="cell-subtext">备货库存 {{ formatQuantity(row.stockInventoryQuantity, row.unit) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="订单使用" min-width="230">
          <template #default="{ row }">
            <div>{{ row.orderLineUsageCount }} 次</div>
            <div v-if="row.lastOrderNo" class="cell-subtext">
              最近 {{ row.lastOrderNo }} / {{ row.lastCustomerName || '-' }} / {{ row.lastOrderDate || '-' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="Boolean(materialOperationSavingId)" @click="openApplicabilityDialog(row)">适用范围</el-button>
            <el-button link type="primary" :disabled="Boolean(materialOperationSavingId)" @click="openDrawingDialog(row)">图纸版本</el-button>
            <el-button link type="primary" :disabled="Boolean(materialOperationSavingId)" @click="openEditDialog(row)">编辑</el-button>
            <el-button
              v-if="row.status === 'ENABLED'"
              link
              type="danger"
              :loading="materialOperationSavingId === row.id"
              :disabled="Boolean(materialOperationSavingId)"
              @click="disableMaterial(row)"
            >
              停用
            </el-button>
            <el-button
              v-else
              link
              type="success"
              :loading="materialOperationSavingId === row.id"
              :disabled="Boolean(materialOperationSavingId)"
              @click="enableMaterial(row)"
            >
              启用
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-pagination-row">
        <span>
          第 {{ materialPagination.page }} 页，已显示 {{ materials.length }} /
          {{ materialPagination.total }} 条零件基础资料
        </span>
        <el-pagination
          background
          layout="prev, pager, next"
          :current-page="materialPagination.page"
          :page-size="materialPagination.limit"
          :total="materialPagination.total"
          :disabled="loading"
          @current-change="handleMaterialPageChange"
        />
      </div>
    </div>

    <div class="mobile-section">
      <el-alert
        title="手机端仅查看零件基础资料"
        description="新增、编辑、停用、导入、适用范围和图纸版本维护请在电脑端操作。"
        type="info"
        :closable="false"
      />
      <div v-for="row in materials" :key="row.id" class="mobile-card">
        <div class="mobile-card-title">
          <span>{{ row.partName }}</span>
          <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain" size="small">
            {{ row.status === 'ENABLED' ? '启用' : '停用' }}
          </el-tag>
        </div>
        <p>{{ row.partCode }} / {{ row.unit }} / {{ row.partSpecification || '无规格' }}</p>
        <p>库存 {{ formatQuantity(row.availableQuantity, row.unit) }} / 使用 {{ row.orderLineUsageCount }} 次</p>
        <p>库存报警：{{ stockAlertText(row) }}</p>
        <div class="mobile-actions">
          <span class="mobile-readonly-note">手机端只展示零件基础资料</span>
        </div>
      </div>
      <div class="mobile-pagination-row">
        <span>已显示 {{ materials.length }} / {{ materialPagination.total }} 条</span>
        <el-pagination
          size="small"
          background
          layout="prev, pager, next"
          :current-page="materialPagination.page"
          :page-size="materialPagination.limit"
          :total="materialPagination.total"
          :disabled="loading"
          @current-change="handleMaterialPageChange"
        />
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      class="responsive-dialog"
      :title="dialogTitle"
      width="560px"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleMaterialDialogClose"
    >
      <el-form label-width="110px">
        <el-form-item label="零件编码" required>
          <el-input v-model="form.partCode" placeholder="例如 RBKS-300DBII-10-50-01" />
        </el-form-item>
        <el-form-item label="零件名称" required>
          <el-input v-model="form.partName" placeholder="例如 顶盖" />
        </el-form-item>
        <el-form-item label="单位" required>
          <el-input v-model="form.unit" placeholder="件 / 套" />
        </el-form-item>
        <el-form-item label="成品规格">
          <el-input v-model="form.partSpecification" placeholder="例如 200mm x 300mm；可留空" />
        </el-form-item>
        <el-form-item label="默认工艺">
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
        <el-form-item label="库存报警">
          <el-radio-group v-model="form.stockAlertEnabled">
            <el-radio-button :value="false">不启用</el-radio-button>
            <el-radio-button :value="true">低库存报警</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.stockAlertEnabled" label="最小库存" required>
          <div class="stock-alert-form-row">
            <el-input-number v-model="form.stockAlertQuantity" :min="0" :precision="3" :step="1" controls-position="right" />
            <span class="unit-text">{{ form.unit || '件' }}</span>
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" :disabled="Boolean(editingMaterialId)" style="width: 160px">
            <el-option label="启用" value="ENABLED" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="dialog-hint">
        这里只维护 `Material` 搜索记忆。编辑已有零件时状态请使用列表里的启用/停用动作；保存不会改写历史订单、库存批次、BOM、默认图纸或来源加工关系。默认工艺只作为后续下单初始建议，库存报警配置只写入 `Material`，不改变库存数量。
      </p>
      <template #footer>
        <el-button :disabled="saving" @click="closeMaterialDialog">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" @click="saveMaterial">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialogVisible" class="responsive-dialog material-import-dialog" title="导入零件基础库" width="1180px">
      <div class="import-toolbar">
        <el-button :loading="materialImportTemplateDownloading" @click="downloadMaterialImportTemplate">下载模板</el-button>
        <el-button type="primary" :loading="importUploading" :disabled="materialImportBusy" @click="triggerMaterialImportFileInput">选择 .xlsx 文件</el-button>
        <el-button :loading="importRefreshing" :disabled="!materialImportSession || materialImportBusy" @click="refreshMaterialImportSession">刷新预览</el-button>
        <el-button
          :disabled="!materialImportHasIssues || materialImportBusy"
          :loading="importIssueReportDownloading"
          @click="downloadMaterialImportIssueReport"
        >
          下载问题明细
        </el-button>
        <el-button
          type="success"
          :disabled="!materialImportCanCommit || materialImportBusy"
          :loading="importCommitting"
          @click="commitMaterialImport"
        >
          确认写入零件库
        </el-button>
        <el-button v-if="materialImportSession" type="danger" plain :loading="importDiscarding" :disabled="materialImportBusy" @click="discardMaterialImport">
          放弃本次导入
        </el-button>
        <input ref="materialImportInput" class="hidden-file-input" type="file" multiple accept=".xlsx" @change="handleImportFileInput" />
      </div>

      <div
        class="drop-zone"
        :class="{ 'is-dragging': materialImportDragging }"
        @dragenter.prevent="materialImportDragging = true"
        @dragover.prevent="materialImportDragging = true"
        @dragleave.prevent="materialImportDragging = false"
        @drop.prevent="handleMaterialImportDrop"
      >
        <strong>拖拽 ERP 零件库导入文件到这里</strong>
        <span>支持连续上传多个 .xlsx 文件；提交前只进入预览，不会写入系统库。</span>
      </div>

      <div v-if="materialImportSession" class="import-summary-grid">
        <div class="import-summary-item">
          <span>文件</span>
          <strong>{{ materialImportSession.summary.fileCount }}</strong>
        </div>
        <div class="import-summary-item">
          <span>读取行</span>
          <strong>{{ materialImportSession.summary.rowCount }}</strong>
        </div>
        <div class="import-summary-item">
          <span>可写入行</span>
          <strong>{{ materialImportSession.summary.importableRowCount }}</strong>
        </div>
        <div class="import-summary-item">
          <span>零件数</span>
          <strong>{{ materialImportSession.summary.materialUpsertCount }}</strong>
        </div>
        <div class="import-summary-item">
          <span>图纸版本</span>
          <strong>{{ materialImportSession.summary.drawingRevisionUpsertCount ?? 0 }}</strong>
        </div>
        <div class="import-summary-item">
          <span>适用范围</span>
          <strong>{{ materialImportSession.summary.applicabilityUpsertCount ?? 0 }}</strong>
        </div>
        <div class="import-summary-item">
          <span>来源关系</span>
          <strong>{{ materialImportSession.summary.transformRuleUpsertCount ?? 0 }}</strong>
        </div>
        <div class="import-summary-item danger">
          <span>错误</span>
          <strong>{{ materialImportSession.summary.errorCount }}</strong>
        </div>
        <div class="import-summary-item warning">
          <span>警告</span>
          <strong>{{ materialImportSession.summary.warningCount }}</strong>
        </div>
        <div class="import-summary-item">
          <span>重复行</span>
          <strong>{{ materialImportSession.summary.duplicateRowCount }}</strong>
        </div>
      </div>

      <div v-if="materialImportSession?.files.length" class="import-file-list">
        <div v-for="file in materialImportSession.files" :key="file.id" class="import-file-row">
          <span>{{ displayMaterialImportFileName(file.fileName) }}</span>
          <small>
            {{ file.sheetName }} / 读取 {{ file.rowCount }} 行
            （零件 {{ file.materialRowCount ?? 0 }} / 范围 {{ file.scopeRowCount ?? 0 }} / 来源关系 {{ file.transformRowCount ?? 0 }}）
            / 新增预览 {{ file.acceptedRowCount }} 行 / 重复 {{ file.duplicateRowCount }} 行
          </small>
          <el-button
            link
            type="danger"
            :loading="importDeletingFileId === file.id"
            :disabled="materialImportSession.status !== 'DRAFT' || materialImportBusy"
            @click="deleteMaterialImportFile(file.id)"
          >
            删除文件
          </el-button>
        </div>
      </div>

      <div v-if="materialImportSession && !isMobileLayout" class="material-library-import-height-toolbar">
        <div class="material-library-table-height-actions" aria-label="零件库导入预览表格高度">
          <span class="material-library-table-height-label">预览表格高度</span>
          <el-tooltip content="降低表格高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="Minus"
              :disabled="materialLibraryWorkTableHeights.importPreview <= materialLibraryWorkTableHeightLimits.min"
              aria-label="降低零件库导入预览表格高度"
              @click="adjustMaterialLibraryWorkTableHeight('importPreview', -materialLibraryWorkTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="提高表格高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="Plus"
              :disabled="materialLibraryWorkTableHeights.importPreview >= materialLibraryWorkTableHeightLimits.max"
              aria-label="提高零件库导入预览表格高度"
              @click="adjustMaterialLibraryWorkTableHeight('importPreview', materialLibraryWorkTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="恢复默认高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="RefreshLeft"
              :disabled="materialLibraryWorkTableHeights.importPreview === materialLibraryWorkTableDefaultHeights.importPreview"
              aria-label="恢复零件库导入预览表格默认高度"
              @click="resetMaterialLibraryWorkTableHeight('importPreview')"
            />
          </el-tooltip>
        </div>
      </div>
      <el-tabs v-if="materialImportSession" v-model="materialImportActiveTab" class="import-preview-tabs">
        <el-tab-pane :label="`零件基础库 ${materialImportSession.rows.length}/${materialImportSession.summary.materialRowCount ?? 0}`" name="materials">
          <el-table v-loading="importUploading" :data="materialImportSession.rows" :max-height="materialLibraryWorkTableHeights.importPreview">
            <el-table-column label="来源文件" min-width="180">
              <template #default="{ row }">
                <div :title="materialImportSourceFileTitle(row)">{{ materialImportSourceFilePreview(row) }}</div>
                <div class="cell-subtext" :title="materialImportSourceFileTitle(row)">{{ materialImportSourceSheetPreview(row) }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="sourceRowNo" label="Excel 行" width="90" />
            <el-table-column prop="partCode" label="零件编码" min-width="160" />
            <el-table-column prop="partName" label="零件名称" min-width="160" />
            <el-table-column prop="unit" label="单位" width="80" />
            <el-table-column prop="partSpecification" label="规格" min-width="140">
              <template #default="{ row }">{{ row.partSpecification || '-' }}</template>
            </el-table-column>
            <el-table-column prop="defaultProcessRoute" label="默认工艺" min-width="160">
              <template #default="{ row }">
                <el-tooltip :content="processRouteTooltipText(row.defaultProcessRoute)" placement="top" :disabled="!row.defaultProcessRoute">
                  <span>{{ formatProcessRoutePreview(row.defaultProcessRoute) }}</span>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column prop="drawingNo" label="图纸" min-width="210">
              <template #default="{ row }">
                <div>{{ formatMaterialDrawingSnapshot(row) }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="partThickness" label="厚度" width="90">
              <template #default="{ row }">{{ row.partThickness ?? '-' }}</template>
            </el-table-column>
            <el-table-column prop="projectModel" label="项目型号" min-width="120">
              <template #default="{ row }">{{ row.projectModel || '-' }}</template>
            </el-table-column>
            <el-table-column label="备注" min-width="220">
              <template #default="{ row }">
                <span :title="longTextTooltipText(row.remark)">{{ formatLongTextPreview(row.remark) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="库存报警" min-width="130">
              <template #default="{ row }">
                <el-tag v-if="row.stockAlertEnabled === true" type="warning" effect="plain">启用 {{ row.stockAlertQuantity ?? '-' }}</el-tag>
                <el-tag v-else-if="row.stockAlertEnabled === false" type="info" effect="plain">停用</el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="追溯" width="90" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openMaterialImportTrace(row, 'material')">查看</el-button>
              </template>
            </el-table-column>
            <el-table-column label="校验" min-width="260" fixed="right">
              <template #default="{ row }">
                <ImportIssueList :issues="row.issues" />
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`适用范围 ${(materialImportSession.applicabilityRows ?? []).length}/${materialImportSession.summary.applicabilityRowCount ?? 0}`" name="applicabilities">
          <el-table v-loading="importUploading" :data="materialImportSession.applicabilityRows ?? []" :max-height="materialLibraryWorkTableHeights.importPreview">
            <el-table-column label="来源文件" min-width="180">
              <template #default="{ row }">
                <div :title="materialImportSourceFileTitle(row)">{{ materialImportSourceFilePreview(row) }}</div>
                <div class="cell-subtext" :title="materialImportSourceFileTitle(row)">{{ materialImportSourceSheetPreview(row) }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="sourceRowNo" label="Excel 行" width="90" />
            <el-table-column prop="partCode" label="零件编码" min-width="160" />
            <el-table-column prop="customerCode" label="客户编码" min-width="130">
              <template #default="{ row }">{{ row.customerCode || '-' }}</template>
            </el-table-column>
            <el-table-column prop="customerName" label="客户名称" min-width="180">
              <template #default="{ row }">{{ row.customerName || '全部客户' }}</template>
            </el-table-column>
            <el-table-column prop="projectModel" label="项目型号" min-width="120">
              <template #default="{ row }">{{ row.projectModel || '全部机型/项目' }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">{{ row.status === 'ENABLED' ? '启用' : '停用' }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="180">
              <template #default="{ row }">
                <el-tooltip :content="longTextTooltipText(row.remark)" placement="top" :disabled="!row.remark">
                  <span>{{ formatLongTextPreview(row.remark) }}</span>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column label="追溯" width="90" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openMaterialImportTrace(row, 'applicability')">查看</el-button>
              </template>
            </el-table-column>
            <el-table-column label="校验" min-width="260" fixed="right">
              <template #default="{ row }">
                <ImportIssueList :issues="row.issues" />
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`来源加工关系 ${(materialImportSession.transformRows ?? []).length}/${materialImportSession.summary.transformRowCount ?? 0}`" name="transforms">
          <el-table v-loading="importUploading" :data="materialImportSession.transformRows ?? []" :max-height="materialLibraryWorkTableHeights.importPreview">
            <el-table-column label="来源文件" min-width="180">
              <template #default="{ row }">
                <div :title="materialImportSourceFileTitle(row)">{{ materialImportSourceFilePreview(row) }}</div>
                <div class="cell-subtext" :title="materialImportSourceFileTitle(row)">{{ materialImportSourceSheetPreview(row) }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="sourceRowNo" label="Excel 行" width="90" />
            <el-table-column prop="sourcePartCode" label="来源零件" min-width="160" />
            <el-table-column prop="targetPartCode" label="目标零件" min-width="160" />
            <el-table-column prop="customerName" label="客户" min-width="180">
              <template #default="{ row }">{{ row.customerName || row.customerCode || '全部客户' }}</template>
            </el-table-column>
            <el-table-column prop="projectModel" label="项目型号" min-width="120">
              <template #default="{ row }">{{ row.projectModel || '全部机型/项目' }}</template>
            </el-table-column>
            <el-table-column prop="multiplier" label="倍率" width="90">
              <template #default="{ row }">{{ row.multiplier ?? 1 }}</template>
            </el-table-column>
            <el-table-column prop="lossRate" label="损耗率" width="100">
              <template #default="{ row }">{{ row.lossRate ?? 0 }}</template>
            </el-table-column>
            <el-table-column prop="defaultProcessRoute" label="默认工艺" min-width="180">
              <template #default="{ row }">
                <el-tooltip :content="processRouteTooltipText(row.defaultProcessRoute)" placement="top" :disabled="!row.defaultProcessRoute">
                  <span>{{ formatProcessRoutePreview(row.defaultProcessRoute) }}</span>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="180">
              <template #default="{ row }">
                <el-tooltip :content="longTextTooltipText(row.remark)" placement="top" :disabled="!row.remark">
                  <span>{{ formatLongTextPreview(row.remark) }}</span>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column label="追溯" width="90" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openMaterialImportTrace(row, 'transform')">查看</el-button>
              </template>
            </el-table-column>
            <el-table-column label="校验" min-width="260" fixed="right">
              <template #default="{ row }">
                <ImportIssueList :issues="row.issues" />
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <div v-if="materialImportSession" class="import-preview-pager">
        <span>{{ materialImportPreviewProgressText }}</span>
        <el-button
          v-if="materialImportHasMoreRows"
          type="primary"
          plain
          :loading="importLoadingMore"
          :disabled="materialImportBusy"
          @click="loadMoreMaterialImportRows"
        >
          继续加载预览
        </el-button>
        <span v-else class="check-ok">已显示全部预览行</span>
      </div>
      <el-empty v-else description="请先上传零件库导入文件" />

      <template #footer>
        <el-button @click="importDialogVisible = false">关闭</el-button>
        <el-button
          type="success"
          :disabled="!materialImportCanCommit || materialImportBusy"
          :loading="importCommitting"
          @click="commitMaterialImport"
        >
          确认写入零件库
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="materialImportTraceDialogVisible" class="responsive-dialog" title="导入行追溯" width="760px" append-to-body>
      <div v-if="activeMaterialImportTraceRow" class="material-import-trace">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="追溯信息只用于人工核对"
          description="这里展示来源文件、来源工作表、来源行和原始字段；不会新增、覆盖或停用任何零件、BOM、订单、生产任务或库存。"
        />
        <div class="trace-summary-grid">
          <div>
            <span>来源文件</span>
            <strong>{{ displayMaterialImportFileName(activeMaterialImportTraceRow.sourceFileName) }}</strong>
          </div>
          <div>
            <span>来源工作表</span>
            <strong>{{ activeMaterialImportTraceRow.sourceSheetName || '-' }}</strong>
          </div>
          <div>
            <span>来源行</span>
            <strong>{{ activeMaterialImportTraceRow.sourceRowNo }}</strong>
          </div>
          <div>
            <span>预览类型</span>
            <strong>{{ materialImportTraceKindLabel }}</strong>
          </div>
        </div>
        <el-descriptions :column="1" border class="trace-descriptions">
          <el-descriptions-item v-for="entry in materialImportTraceEntries" :key="entry.label" :label="entry.label">
            {{ entry.value }}
          </el-descriptions-item>
        </el-descriptions>
        <div v-if="activeMaterialImportTraceRow.remark" class="trace-remark">
          <strong>备注</strong>
          <p :title="materialImportTraceRemarkTitle(activeMaterialImportTraceRow)">{{ materialImportTraceRemarkPreview(activeMaterialImportTraceRow) }}</p>
        </div>
        <ImportIssueList :issues="activeMaterialImportTraceRow.issues" />
      </div>
      <template #footer>
        <el-button @click="materialImportTraceDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="materialImportConfirmDialogVisible"
      class="responsive-dialog"
      :title="materialImportConfirmTitle"
      width="620px"
      append-to-body
      :close-on-click-modal="!materialImportConfirmSaving"
      :close-on-press-escape="!materialImportConfirmSaving"
      :before-close="handleMaterialImportConfirmDialogClose"
    >
      <div class="material-confirm-panel">
        <template v-if="materialImportConfirmAction === 'commit'">
          <p>{{ materialImportCommitSummaryText }}</p>
          <ul>
            <li>写入前仍以后端重新校验和当前 `previewToken` 为准。</li>
            <li>只写入零件搜索记忆、图纸版本、适用范围和来源加工关系。</li>
            <li>不会创建订单、不会占用库存、不会创建生产任务。</li>
          </ul>
        </template>
        <template v-else-if="materialImportConfirmAction === 'deleteFile'">
          <p>
            确认删除导入文件
            <strong>{{ displayMaterialImportFileName(materialImportDeleteFileTarget?.fileName) }}</strong>
            吗？
          </p>
          <ul>
            <li>只会删除本次导入会话里的文件和对应预览行。</li>
            <li>删除后后端会重新合并校验剩余文件，并刷新 `previewToken`。</li>
            <li>不会影响已经存在的零件基础库、历史订单、库存批次或生产任务。</li>
          </ul>
        </template>
        <template v-else>
          <p>确认放弃本次零件库导入吗？已上传文件和预览行会删除。</p>
          <ul>
            <li>放弃导入不会影响已经存在的零件基础库。</li>
            <li>不会删除历史订单、库存批次、生产任务或库存流水。</li>
          </ul>
        </template>
      </div>
      <template #footer>
        <el-button :disabled="materialImportConfirmSaving" @click="closeMaterialImportConfirmDialog">取消</el-button>
        <el-button
          :type="materialImportConfirmAction === 'commit' ? 'success' : 'danger'"
          :loading="materialImportConfirmSaving"
          @click="confirmMaterialImportAction"
        >
          {{ materialImportConfirmButtonText }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="materialStatusDialogVisible"
      class="responsive-dialog"
      :title="materialStatusDialogTitle"
      width="560px"
      append-to-body
      :close-on-click-modal="!materialStatusSaving"
      :close-on-press-escape="!materialStatusSaving"
      :before-close="handleMaterialStatusDialogClose"
    >
      <div v-if="materialStatusTarget" class="material-confirm-panel">
        <p>
          确定{{ materialStatusActionLabel }}
          <strong>{{ materialStatusTarget.partCode }} / {{ materialStatusTarget.partName }}</strong>
          吗？
        </p>
        <ul>
          <li>{{ materialStatusWarningText }}</li>
          <li>不会删除历史订单、库存批次、库存数量、生产记录或导入追溯。</li>
        </ul>
      </div>
      <template #footer>
        <el-button :disabled="materialStatusSaving" @click="closeMaterialStatusDialog">取消</el-button>
        <el-button
          :type="materialStatusAction === 'enable' ? 'success' : 'danger'"
          :loading="materialStatusSaving"
          @click="confirmMaterialStatusChange"
        >
          {{ materialStatusConfirmText }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="materialMaintenanceStatusDialogVisible"
      class="responsive-dialog"
      :title="materialMaintenanceStatusDialogTitle"
      width="560px"
      append-to-body
      :close-on-click-modal="!materialMaintenanceStatusSaving"
      :close-on-press-escape="!materialMaintenanceStatusSaving"
      :before-close="handleMaterialMaintenanceStatusDialogClose"
    >
      <div v-if="activeMaterialMaintenanceStatusTarget" class="material-confirm-panel">
        <p>
          确定{{ activeMaterialMaintenanceStatusTarget.actionLabel }}
          <strong>{{ activeMaterialMaintenanceStatusTarget.name }}</strong>
          吗？
        </p>
        <ul>
          <li>{{ activeMaterialMaintenanceStatusTarget.warning }}</li>
          <li>不会删除历史订单、BOM 行、库存批次、库存流水、生产任务或导入追溯。</li>
        </ul>
      </div>
      <template #footer>
        <el-button :disabled="materialMaintenanceStatusSaving" @click="closeMaterialMaintenanceStatusDialog">取消</el-button>
        <el-button
          :type="activeMaterialMaintenanceStatusTarget?.nextStatus === 'ENABLED' ? 'success' : 'danger'"
          :loading="materialMaintenanceStatusSaving"
          @click="confirmMaterialMaintenanceStatusChange"
        >
          {{ materialMaintenanceStatusConfirmText }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="applicabilityDialogVisible"
      class="responsive-dialog"
      :title="applicabilityDialogTitle"
      width="860px"
      :close-on-click-modal="!applicabilitySaving"
      :close-on-press-escape="!applicabilitySaving"
      :before-close="handleApplicabilityDialogClose"
    >
      <div class="applicability-layout">
        <div class="applicability-form">
          <h3>{{ applicabilityForm.id ? '编辑适用范围' : '新增适用范围' }}</h3>
          <el-form label-width="120px">
            <el-form-item label="客户范围">
              <el-select v-model="applicabilityForm.customerScope" style="width: 220px" @change="handleCustomerScopeChange">
                <el-option label="全部客户" value="ALL" />
                <el-option label="指定客户" value="SPECIFIC" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="applicabilityForm.customerScope === 'SPECIFIC'" label="指定客户" required>
              <CustomerSelect v-model="applicabilityForm.customerId" width="260px" placeholder="选择客户" />
            </el-form-item>
            <el-form-item label="机型/项目">
              <el-select v-model="applicabilityForm.projectScope" style="width: 220px" @change="handleProjectScopeChange">
                <el-option label="全部机型/项目" value="ALL" />
                <el-option label="指定机型/项目" value="SPECIFIC" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="applicabilityForm.projectScope === 'SPECIFIC'" label="指定机型/项目" required>
              <el-input v-model="applicabilityForm.projectModel" placeholder="例如 B3 / B5 / C型15P" />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="applicabilityForm.status" :disabled="Boolean(applicabilityForm.id)" style="width: 160px">
                <el-option label="启用" value="ENABLED" />
                <el-option label="停用" value="DISABLED" />
              </el-select>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="applicabilityForm.remark" type="textarea" :rows="3" placeholder="例如 客户A专用，B5项目暂用" />
            </el-form-item>
          </el-form>
          <div class="applicability-actions">
            <el-button :disabled="applicabilitySaving" @click="resetApplicabilityForm">清空</el-button>
            <el-button type="primary" :loading="applicabilitySaving" :disabled="applicabilitySaving" @click="saveApplicability">
              {{ applicabilityForm.id ? '保存范围' : '新增范围' }}
            </el-button>
          </div>
        </div>

        <div class="applicability-list">
          <div class="material-library-dialog-table-header">
            <div class="material-library-dialog-title-actions">
              <h3>已维护范围</h3>
              <el-button
                v-if="!isMobileLayout"
                size="small"
                :icon="Download"
                :loading="applicabilityExporting"
                :disabled="!activeMaterial || applicabilityLoading"
                @click="exportApplicabilitiesExcel"
              >
                导出 Excel
              </el-button>
            </div>
            <div v-if="!isMobileLayout" class="material-library-table-height-actions" aria-label="适用范围维护表格高度">
              <span class="material-library-table-height-label">表格高度</span>
              <el-tooltip content="降低表格高度" placement="top">
                <el-button
                  circle
                  size="small"
                  :icon="Minus"
                  :disabled="materialLibraryWorkTableHeights.applicability <= materialLibraryWorkTableHeightLimits.min"
                  aria-label="降低适用范围维护表格高度"
                  @click="adjustMaterialLibraryWorkTableHeight('applicability', -materialLibraryWorkTableHeightLimits.step)"
                />
              </el-tooltip>
              <el-tooltip content="提高表格高度" placement="top">
                <el-button
                  circle
                  size="small"
                  :icon="Plus"
                  :disabled="materialLibraryWorkTableHeights.applicability >= materialLibraryWorkTableHeightLimits.max"
                  aria-label="提高适用范围维护表格高度"
                  @click="adjustMaterialLibraryWorkTableHeight('applicability', materialLibraryWorkTableHeightLimits.step)"
                />
              </el-tooltip>
              <el-tooltip content="恢复默认高度" placement="top">
                <el-button
                  circle
                  size="small"
                  :icon="RefreshLeft"
                  :disabled="materialLibraryWorkTableHeights.applicability === materialLibraryWorkTableDefaultHeights.applicability"
                  aria-label="恢复适用范围维护表格默认高度"
                  @click="resetMaterialLibraryWorkTableHeight('applicability')"
                />
              </el-tooltip>
            </div>
          </div>
          <el-table v-loading="applicabilityLoading" :data="applicabilities" :max-height="materialLibraryWorkTableHeights.applicability">
            <el-table-column label="适用范围" min-width="220">
              <template #default="{ row }">
                <el-tooltip :content="materialApplicabilityScopeTitle(row)" placement="top">
                  <span class="material-scope-cell">{{ materialApplicabilityScopePreview(row) }}</span>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
                  {{ row.status === 'ENABLED' ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="180">
              <template #default="{ row }">
                <el-tooltip :content="longTextTooltipText(row.remark)" placement="top" :disabled="!row.remark">
                  <span>{{ formatLongTextPreview(row.remark) }}</span>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" :disabled="applicabilitySaving || Boolean(applicabilityOperationSavingId)" @click="editApplicability(row)">编辑</el-button>
                <el-button
                  v-if="row.status === 'ENABLED'"
                  link
                  type="danger"
                  :loading="applicabilityOperationSavingId === row.id"
                  :disabled="applicabilitySaving || Boolean(applicabilityOperationSavingId)"
                  @click="disableApplicability(row)"
                >
                  停用
                </el-button>
                <el-button
                  v-else
                  link
                  type="success"
                  :loading="applicabilityOperationSavingId === row.id"
                  :disabled="applicabilitySaving || Boolean(applicabilityOperationSavingId)"
                  @click="enableApplicability(row)"
                >
                  启用
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <p class="dialog-hint">
        空客户表示全部客户，空机型/项目表示全部机型/项目。规则只用于后续下单推荐，不会自动加入订单、占用库存或生成生产任务。
      </p>
    </el-dialog>

    <el-dialog
      v-model="drawingDialogVisible"
      class="responsive-dialog"
      :title="drawingDialogTitle"
      width="980px"
      :close-on-click-modal="!drawingSaving && !drawingUploading"
      :close-on-press-escape="!drawingSaving && !drawingUploading"
      :before-close="handleDrawingDialogClose"
    >
      <div class="applicability-layout">
        <div class="applicability-form">
          <h3>{{ drawingForm.id ? '编辑图纸版本' : '新增图纸版本' }}</h3>
          <el-form label-width="120px">
            <el-form-item label="图号" required>
              <el-input v-model="drawingForm.drawingNo" placeholder="例如 DRW-4101" />
            </el-form-item>
            <el-form-item label="图纸版本" required>
              <el-input v-model="drawingForm.drawingVersion" placeholder="例如 A / B" />
            </el-form-item>
            <el-form-item label="图纸日期">
              <el-date-picker v-model="drawingForm.drawingDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 220px" />
            </el-form-item>
            <el-form-item label="图纸状态">
              <el-input v-model="drawingForm.drawingStatus" placeholder="旧图 / 新图 / 图纸变更" />
            </el-form-item>
            <el-form-item label="图纸文件">
              <div class="drawing-file-maintenance">
                <el-upload
                  :show-file-list="false"
                  :http-request="uploadMaterialDrawingFile"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf"
                  :disabled="drawingSaving || drawingUploading"
                >
                  <el-button type="primary" plain :loading="drawingUploading" :disabled="drawingSaving || drawingUploading">
                    上传图纸文件
                  </el-button>
                </el-upload>
                <DrawingPreviewLink
                  v-if="drawingForm.drawingFileUrl"
                  :file-name="drawingForm.drawingFileName"
                  :file-url="drawingForm.drawingFileUrl"
                  :title="`${activeMaterial?.partName || activeMaterial?.partCode || '零件'} 图纸预览`"
                />
                <span v-else class="cell-subtext">支持 PDF、图片、DWG、DXF；上传后自动回填文件名和地址。</span>
              </div>
            </el-form-item>
            <el-form-item label="图纸文件名">
              <el-input v-model="drawingForm.drawingFileName" placeholder="例如 DRW-4101-A.pdf" />
            </el-form-item>
            <el-form-item label="图纸文件地址">
              <el-input v-model="drawingForm.drawingFileUrl" placeholder="/uploads/drawings/..." />
            </el-form-item>
            <el-form-item label="默认图纸">
              <el-switch v-model="drawingForm.isDefault" active-text="作为默认下单图纸" />
            </el-form-item>
            <el-form-item v-if="drawingForm.isDefault" label="默认变更人" required>
              <el-input v-model="drawingForm.defaultChangedBy" placeholder="填写本次设置默认图纸的操作人员" />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="drawingForm.status" :disabled="Boolean(drawingForm.id)" style="width: 160px">
                <el-option label="启用" value="ENABLED" />
                <el-option label="停用" value="DISABLED" />
              </el-select>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="drawingForm.remark" type="textarea" :rows="3" placeholder="图纸变更说明或核对备注" />
            </el-form-item>
          </el-form>
          <div class="applicability-actions">
            <el-button :disabled="drawingSaving || drawingUploading" @click="resetDrawingForm">清空</el-button>
            <el-button type="primary" :loading="drawingSaving" :disabled="drawingSaving || drawingUploading" @click="saveDrawingRevision">
              {{ drawingForm.id ? '保存图纸' : '新增图纸' }}
            </el-button>
          </div>
        </div>

        <div class="applicability-list">
          <div class="material-library-dialog-table-header">
            <div class="material-library-dialog-title-actions">
              <h3>已维护图纸</h3>
              <el-button
                v-if="!isMobileLayout"
                size="small"
                :icon="Download"
                :loading="drawingExporting"
                :disabled="!activeMaterial || drawingLoading"
                @click="exportDrawingRevisionsExcel"
              >
                导出 Excel
              </el-button>
            </div>
            <div v-if="!isMobileLayout" class="material-library-table-height-actions" aria-label="图纸版本维护表格高度">
              <span class="material-library-table-height-label">表格高度</span>
              <el-tooltip content="降低表格高度" placement="top">
                <el-button
                  circle
                  size="small"
                  :icon="Minus"
                  :disabled="materialLibraryWorkTableHeights.drawing <= materialLibraryWorkTableHeightLimits.min"
                  aria-label="降低图纸版本维护表格高度"
                  @click="adjustMaterialLibraryWorkTableHeight('drawing', -materialLibraryWorkTableHeightLimits.step)"
                />
              </el-tooltip>
              <el-tooltip content="提高表格高度" placement="top">
                <el-button
                  circle
                  size="small"
                  :icon="Plus"
                  :disabled="materialLibraryWorkTableHeights.drawing >= materialLibraryWorkTableHeightLimits.max"
                  aria-label="提高图纸版本维护表格高度"
                  @click="adjustMaterialLibraryWorkTableHeight('drawing', materialLibraryWorkTableHeightLimits.step)"
                />
              </el-tooltip>
              <el-tooltip content="恢复默认高度" placement="top">
                <el-button
                  circle
                  size="small"
                  :icon="RefreshLeft"
                  :disabled="materialLibraryWorkTableHeights.drawing === materialLibraryWorkTableDefaultHeights.drawing"
                  aria-label="恢复图纸版本维护表格默认高度"
                  @click="resetMaterialLibraryWorkTableHeight('drawing')"
                />
              </el-tooltip>
            </div>
          </div>
          <el-table v-loading="drawingLoading" :data="drawingRevisions" :max-height="materialLibraryWorkTableHeights.drawing">
            <el-table-column label="图纸" min-width="220">
              <template #default="{ row }">
                <div>{{ formatMaterialDrawingSnapshot(row) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="默认" width="90">
              <template #default="{ row }">
                <el-tag v-if="row.isDefault" type="success" effect="plain">默认</el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="文件" min-width="180">
              <template #default="{ row }">
                <DrawingPreviewLink
                  v-if="row.drawingFileUrl"
                  :file-name="row.drawingFileName"
                  :file-url="row.drawingFileUrl"
                  :title="`${formatMaterialDrawingSnapshot(row)} 图纸预览`"
                />
                <span v-else>{{ row.drawingFileName || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
                  {{ row.status === 'ENABLED' ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="190" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" :disabled="drawingSaving || Boolean(drawingOperationSavingId)" @click="editDrawingRevision(row)">编辑</el-button>
                <el-button
                  v-if="!row.isDefault && row.status === 'ENABLED'"
                  link
                  type="success"
                  :loading="drawingOperationSavingId === row.id"
                  :disabled="drawingSaving || Boolean(drawingOperationSavingId)"
                  @click="setDefaultDrawingRevision(row)"
                >
                  设默认
                </el-button>
                <el-button
                  v-if="row.status === 'ENABLED'"
                  link
                  type="danger"
                  :loading="drawingOperationSavingId === row.id"
                  :disabled="drawingSaving || Boolean(drawingOperationSavingId)"
                  @click="disableDrawingRevision(row)"
                >
                  停用
                </el-button>
                <el-button
                  v-else
                  link
                  type="success"
                  :loading="drawingOperationSavingId === row.id"
                  :disabled="drawingSaving || Boolean(drawingOperationSavingId)"
                  @click="enableDrawingRevision(row)"
                >
                  启用
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <p class="dialog-hint">
        图纸版本用于 BOM 默认图纸和订单下单快照。修改默认图纸不会覆盖历史订单里的图号、版本、日期或文件。
      </p>
    </el-dialog>

    <el-dialog
      v-model="defaultDrawingDialogVisible"
      class="responsive-dialog"
      title="设置默认图纸"
      width="520px"
      :close-on-click-modal="!drawingOperationSavingId"
      :close-on-press-escape="!drawingOperationSavingId"
      :before-close="handleDefaultDrawingDialogClose"
    >
      <div v-if="activeDefaultDrawingRevision" class="status-dialog-content">
        <p>
          将 {{ formatMaterialDrawingSnapshot(activeDefaultDrawingRevision) }} 设置为当前零件默认下单图纸。
          历史订单图纸快照不会被覆盖。
        </p>
        <el-form label-width="110px">
          <el-form-item label="操作人员" required>
            <el-input v-model="defaultDrawingForm.defaultChangedBy" placeholder="填写本次设置默认图纸的操作人员" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="defaultDrawingForm.remark" type="textarea" :rows="3" placeholder="默认图纸变更说明" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button :disabled="Boolean(drawingOperationSavingId)" @click="closeDefaultDrawingDialog">取消</el-button>
        <el-button type="primary" :loading="Boolean(drawingOperationSavingId)" @click="confirmDefaultDrawingRevision">确认设为默认</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref, watch, type PropType } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, type UploadRequestOptions } from 'element-plus';
import { Download } from '@element-plus/icons-vue';
import { Minus, Plus, RefreshLeft } from '@element-plus/icons-vue';
import { erpApi, type StockAlertFilter, type UpdateMaterialDrawingRevisionPayload } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DrawingPreviewLink from '../components/DrawingPreviewLink.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import { normalizeDisplayFileName } from '../utils/fileNames';
import { formatNumber, formatQuantity } from '../utils/format';
import { formatFileDateTime } from '../utils/tableExport';
import type {
  CommonStatus,
  MaterialApplicability,
  MaterialDrawingRevision,
  MaterialImportIssue,
  MaterialImportSessionPreview,
  MaterialMemory,
  ProcessDefinition
} from '../types/erp';

const router = useRouter();
const route = useRoute();
const { isMobileLayout } = useDeviceProfile();
const ImportIssueList = defineComponent({
  props: {
    issues: {
      type: Array as PropType<MaterialImportIssue[]>,
      required: true
    }
  },
  setup(props) {
    return () => {
      const issues = props.issues || [];
      if (!issues.length) {
        return h('div', { class: 'check-ok' }, '可写入');
      }
      const hasError = issues.some((issue) => issue.severity === 'ERROR');
      return h('div', { class: 'issue-list' }, [
        h(
          'span',
          {
            class: ['issue-pill', hasError ? 'is-error' : 'is-warning'],
            title: formatMaterialImportIssueTitle(issues)
          },
          formatMaterialImportIssuePreview(issues)
        )
      ]);
    };
  }
});

type MaterialMaintenanceStatusTarget = {
  type: 'applicability' | 'drawing';
  id: string;
  name: string;
  nextStatus: CommonStatus;
  actionLabel: string;
  warning: string;
};
type MaterialImportTraceKind = 'material' | 'applicability' | 'transform';
type MaterialImportTraceRow =
  | MaterialImportSessionPreview['rows'][number]
  | NonNullable<MaterialImportSessionPreview['applicabilityRows']>[number]
  | NonNullable<MaterialImportSessionPreview['transformRows']>[number];
type MaterialLibraryWorkTableKey = 'materials' | 'importPreview' | 'applicability' | 'drawing';

const loading = ref(false);
const saving = ref(false);
const materialOperationSavingId = ref('');
const dialogVisible = ref(false);
const importDialogVisible = ref(false);
const importUploading = ref(false);
const importCommitting = ref(false);
const importRefreshing = ref(false);
const importDiscarding = ref(false);
const importDeletingFileId = ref('');
const importIssueReportDownloading = ref(false);
const importLoadingMore = ref(false);
const materialExporting = ref(false);
const materialImportTemplateDownloading = ref(false);
const materialImportDragging = ref(false);
const materialImportActiveTab = ref('materials');
const materialImportConfirmDialogVisible = ref(false);
const materialImportConfirmAction = ref<'commit' | 'discard' | 'deleteFile'>('commit');
const materialImportDeleteFileTarget = ref<MaterialImportSessionPreview['files'][number]>();
const materialImportInput = ref<HTMLInputElement>();
const materialImportSession = ref<MaterialImportSessionPreview>();
const materialImportTraceDialogVisible = ref(false);
const materialImportTraceKind = ref<MaterialImportTraceKind>('material');
const activeMaterialImportTraceRow = ref<MaterialImportTraceRow>();
const materialStatusDialogVisible = ref(false);
const materialStatusSaving = ref(false);
const materialStatusAction = ref<'enable' | 'disable'>('disable');
const materialStatusTarget = ref<MaterialMemory>();
const materialMaintenanceStatusDialogVisible = ref(false);
const activeMaterialMaintenanceStatusTarget = ref<MaterialMaintenanceStatusTarget>();
const applicabilityDialogVisible = ref(false);
const applicabilityLoading = ref(false);
const applicabilitySaving = ref(false);
const applicabilityOperationSavingId = ref('');
const drawingDialogVisible = ref(false);
const drawingLoading = ref(false);
const drawingSaving = ref(false);
const drawingUploading = ref(false);
const drawingExporting = ref(false);
const drawingOperationSavingId = ref('');
const defaultDrawingDialogVisible = ref(false);
const activeDefaultDrawingRevision = ref<MaterialDrawingRevision | null>(null);
const editingMaterialId = ref('');
const activeMaterial = ref<MaterialMemory>();
const materials = ref<MaterialMemory[]>([]);
const processDefinitions = ref<ProcessDefinition[]>([]);
const triggeredStockAlertTotal = ref(0);
const applicabilities = ref<MaterialApplicability[]>([]);
const applicabilityExporting = ref(false);
const drawingRevisions = ref<MaterialDrawingRevision[]>([]);
const routeActionApplied = ref(false);

const filters = reactive<{
  keyword: string;
  status: CommonStatus;
  stockAlert?: StockAlertFilter;
}>({
  keyword: '',
  status: 'ENABLED'
});
const materialPagination = reactive({
  page: Number(1),
  limit: Number(20),
  total: Number(0)
});
const materialLibraryWorkTableHeightLimits = {
  min: 300,
  max: 860,
  step: 80
};
const materialLibraryWorkTableDefaultHeights: Record<MaterialLibraryWorkTableKey, number> = {
  materials: 620,
  importPreview: 420,
  applicability: 420,
  drawing: 520
};
const materialLibraryWorkTableHeightStorageKey = 'baisheng.erp.materialLibraryWorkTableHeights.v1';
// 零件基础库表格高度只保存为本机 UI 偏好，不写入 Material、适用范围、图纸版本、导入或库存业务数据。
const materialLibraryWorkTableHeights = reactive<Record<MaterialLibraryWorkTableKey, number>>({
  ...materialLibraryWorkTableDefaultHeights
});

const form = reactive<{
  partCode: string;
  partName: string;
  unit: string;
  partSpecification: string;
  defaultProcessRouteSteps: string[];
  stockAlertEnabled: boolean;
  stockAlertQuantity: number | null;
  status: CommonStatus;
}>({
  partCode: '',
  partName: '',
  unit: '件',
  partSpecification: '',
  defaultProcessRouteSteps: [],
  stockAlertEnabled: false,
  stockAlertQuantity: null,
  status: 'ENABLED'
});

const applicabilityForm = reactive<{
  id: string;
  customerScope: 'ALL' | 'SPECIFIC';
  customerId: string;
  projectScope: 'ALL' | 'SPECIFIC';
  projectModel: string;
  remark: string;
  status: CommonStatus;
}>({
  id: '',
  customerScope: 'ALL',
  customerId: '',
  projectScope: 'ALL',
  projectModel: '',
  remark: '',
  status: 'ENABLED'
});

const drawingForm = reactive<{
  id: string;
  drawingNo: string;
  drawingVersion: string;
  drawingDate: string;
  drawingStatus: string;
  drawingFileName: string;
  drawingFileUrl: string;
  isDefault: boolean;
  defaultChangedBy: string;
  remark: string;
  status: CommonStatus;
}>({
  id: '',
  drawingNo: '',
  drawingVersion: 'A',
  drawingDate: '',
  drawingStatus: '',
  drawingFileName: '',
  drawingFileUrl: '',
  isDefault: false,
  defaultChangedBy: '',
  remark: '',
  status: 'ENABLED'
});

const defaultDrawingForm = reactive({
  defaultChangedBy: '',
  remark: ''
});

const dialogTitle = computed(() => (editingMaterialId.value ? '编辑零件基础资料' : '新增零件基础资料'));
const applicabilityDialogTitle = computed(() =>
  activeMaterial.value ? `适用范围 - ${activeMaterial.value.partCode} / ${activeMaterial.value.partName}` : '适用范围'
);
const drawingDialogTitle = computed(() =>
  activeMaterial.value ? `图纸版本 - ${activeMaterial.value.partCode} / ${activeMaterial.value.partName}` : '图纸版本'
);
const materialStatusActionLabel = computed(() => (materialStatusAction.value === 'enable' ? '启用零件' : '停用零件'));
const materialStatusDialogTitle = computed(() => `${materialStatusActionLabel.value}基础资料`);
const materialStatusConfirmText = computed(() => `确认${materialStatusAction.value === 'enable' ? '启用' : '停用'}`);
const materialStatusWarningText = computed(() =>
  materialStatusAction.value === 'enable'
    ? '系统只会恢复 `Material` 搜索记忆的后续可选状态，不会自动恢复适用范围、BOM 行、默认图纸或来源加工关系。'
    : '系统只会停用 `Material` 搜索记忆，影响后续搜索和推荐。'
);
const materialMaintenanceStatusDialogTitle = computed(() => activeMaterialMaintenanceStatusTarget.value?.actionLabel || '资料状态确认');
const materialMaintenanceStatusConfirmText = computed(() => `确认${activeMaterialMaintenanceStatusTarget.value?.actionLabel || '操作'}`);
const materialMaintenanceStatusSaving = computed(() => Boolean(applicabilityOperationSavingId.value || drawingOperationSavingId.value));
const enabledCount = computed(() => materials.value.filter((item) => item.status === 'ENABLED').length);
const disabledCount = computed(() => materials.value.filter((item) => item.status === 'DISABLED').length);
const triggeredStockAlertText = computed(() => `${triggeredStockAlertTotal.value} 条`);
const materialImportCanCommit = computed(
  () =>
    Boolean(materialImportSession.value?.previewToken) &&
    materialImportSession.value?.status === 'DRAFT' &&
    (materialImportSession.value?.summary.rowCount ?? 0) > 0 &&
    (materialImportSession.value?.summary.errorCount ?? 0) === 0
);
const materialImportHasIssues = computed(() => {
  const session = materialImportSession.value;
  const issueCount = (session?.summary.errorCount ?? 0) + (session?.summary.warningCount ?? 0);
  return issueCount > 0;
});
const materialImportLoadedCount = computed(() => {
  const session = materialImportSession.value;
  if (!session) {
    return 0;
  }
  return session.rows.length + (session.applicabilityRows ?? []).length + (session.transformRows ?? []).length;
});
const materialImportHasMoreRows = computed(() => {
  const session = materialImportSession.value;
  if (!session) {
    return false;
  }
  return (
    session.rows.length < (session.summary.materialRowCount ?? 0) ||
    (session.applicabilityRows ?? []).length < (session.summary.applicabilityRowCount ?? 0) ||
    (session.transformRows ?? []).length < (session.summary.transformRowCount ?? 0)
  );
});
const materialImportPreviewProgressText = computed(() => {
  const total = materialImportSession.value?.summary.rowCount ?? 0;
  return `已加载 ${materialImportLoadedCount.value} / ${total} 行预览；未显示的行不会被静默忽略，可继续加载或下载问题明细核对。`;
});
const materialImportConfirmTitle = computed(() => {
  if (materialImportConfirmAction.value === 'commit') {
    return '确认写入零件库';
  }
  if (materialImportConfirmAction.value === 'deleteFile') {
    return '删除导入文件';
  }
  return '放弃零件库导入';
});
const materialImportConfirmButtonText = computed(() => {
  if (materialImportConfirmAction.value === 'commit') {
    return '确认写入';
  }
  if (materialImportConfirmAction.value === 'deleteFile') {
    return '确认删除';
  }
  return '确认放弃';
});
const materialImportConfirmSaving = computed(() => importCommitting.value || importDiscarding.value || Boolean(importDeletingFileId.value));
const materialImportCommitSummaryText = computed(() => {
  const summary = materialImportSession.value?.summary;
  if (!summary) {
    return '当前没有可写入的零件库导入预览。';
  }
  return `确认写入零件库吗？将新增或更新 ${summary.materialUpsertCount} 个零件、${summary.drawingRevisionUpsertCount ?? 0} 条图纸版本、${summary.applicabilityUpsertCount ?? 0} 条适用范围、${summary.transformRuleUpsertCount ?? 0} 条来源加工关系。`;
});
const materialImportTraceKindLabel = computed(() => {
  const labels: Record<MaterialImportTraceKind, string> = {
    material: '零件基础库',
    applicability: '适用范围',
    transform: '来源加工关系'
  };
  return labels[materialImportTraceKind.value];
});
const materialImportTraceEntries = computed(() => {
  const row = activeMaterialImportTraceRow.value;
  if (!row) {
    return [];
  }
  const entries = Object.entries(row.raw || {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => ({ label, value: materialImportTraceValueText(value) }));
  if (entries.length > 0) {
    return entries;
  }
  return [
    { label: '来源文件', value: displayMaterialImportFileName(row.sourceFileName) },
    { label: '来源工作表', value: row.sourceSheetName || '-' },
    { label: '来源行', value: String(row.sourceRowNo) }
  ];
});
const materialImportBusy = computed(() =>
  Boolean(
    importUploading.value ||
      importCommitting.value ||
      importRefreshing.value ||
      importDiscarding.value ||
      importDeletingFileId.value ||
      importLoadingMore.value
  )
);
const currentAvailableText = computed(() => {
  const totals = new Map<string, number>();
  materials.value.forEach((item) => {
    totals.set(item.unit, (totals.get(item.unit) ?? 0) + (item.availableQuantity ?? 0));
  });
  const text = [...totals.entries()].map(([unit, quantity]) => `${formatNumber(quantity)} ${unit}`).join(' / ');
  return text || '0';
});

function clampMaterialLibraryWorkTableHeight(value: number) {
  return Math.min(materialLibraryWorkTableHeightLimits.max, Math.max(materialLibraryWorkTableHeightLimits.min, value));
}

function adjustMaterialLibraryWorkTableHeight(key: MaterialLibraryWorkTableKey, delta: number) {
  materialLibraryWorkTableHeights[key] = clampMaterialLibraryWorkTableHeight(materialLibraryWorkTableHeights[key] + delta);
}

function resetMaterialLibraryWorkTableHeight(key: MaterialLibraryWorkTableKey) {
  materialLibraryWorkTableHeights[key] = materialLibraryWorkTableDefaultHeights[key];
}

function restoreMaterialLibraryWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const rawValue = window.localStorage.getItem(materialLibraryWorkTableHeightStorageKey);
    const savedHeights = rawValue ? JSON.parse(rawValue) as Partial<Record<MaterialLibraryWorkTableKey, number>> : {};
    for (const key of Object.keys(materialLibraryWorkTableDefaultHeights) as MaterialLibraryWorkTableKey[]) {
      const savedHeight = Number(savedHeights[key]);
      if (Number.isFinite(savedHeight)) {
        materialLibraryWorkTableHeights[key] = clampMaterialLibraryWorkTableHeight(savedHeight);
      }
    }
  } catch {
    materialLibraryWorkTableHeights.materials = materialLibraryWorkTableDefaultHeights.materials;
    materialLibraryWorkTableHeights.importPreview = materialLibraryWorkTableDefaultHeights.importPreview;
    materialLibraryWorkTableHeights.applicability = materialLibraryWorkTableDefaultHeights.applicability;
    materialLibraryWorkTableHeights.drawing = materialLibraryWorkTableDefaultHeights.drawing;
  }
}

function saveMaterialLibraryWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      materialLibraryWorkTableHeightStorageKey,
      JSON.stringify({
        materials: materialLibraryWorkTableHeights.materials,
        importPreview: materialLibraryWorkTableHeights.importPreview,
        applicability: materialLibraryWorkTableHeights.applicability,
        drawing: materialLibraryWorkTableHeights.drawing
      })
    );
  } catch {
    // 本机 UI 偏好写入失败不阻断零件基础库、适用范围、图纸版本或导入预览。
  }
}

onMounted(() => {
  restoreMaterialLibraryWorkTableHeights();
  applyRouteQueryFilters();
  void loadProcessDefinitions();
  void loadMaterials();
  void openMaterialImportSessionFromRoute();
});

watch(
  () => route.query.materialImportSessionId,
  () => {
    void openMaterialImportSessionFromRoute();
  }
);

watch(
  () => [
    materialLibraryWorkTableHeights.materials,
    materialLibraryWorkTableHeights.importPreview,
    materialLibraryWorkTableHeights.applicability,
    materialLibraryWorkTableHeights.drawing
  ],
  () => saveMaterialLibraryWorkTableHeights()
);

function routeQueryText(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
}

function applyRouteQueryFilters() {
  const keyword = routeQueryText(route.query.keyword);
  const status = routeQueryText(route.query.status);
  const stockAlert = routeQueryText(route.query.stockAlert);
  if (keyword) {
    filters.keyword = keyword;
  }
  if (status === 'ENABLED' || status === 'DISABLED') {
    filters.status = status;
  }
  if (stockAlert === 'ENABLED' || stockAlert === 'TRIGGERED' || stockAlert === 'DISABLED') {
    filters.stockAlert = stockAlert;
  }
}

async function openMaterialImportSessionFromRoute() {
  const materialImportSessionId = routeQueryText(route.query.materialImportSessionId);
  if (!materialImportSessionId) {
    return;
  }
  if (materialImportSession.value?.id === materialImportSessionId) {
    if (!guardDesktopOperation('打开零件库导入草稿')) {
      materialImportActiveTab.value = 'materials';
      importDialogVisible.value = true;
    }
    return;
  }
  if (guardDesktopOperation('打开零件库导入草稿')) {
    return;
  }
  importRefreshing.value = true;
  try {
    materialImportSession.value = await erpApi.materialImportSession(materialImportSessionId);
    materialImportActiveTab.value = 'materials';
    importDialogVisible.value = true;
    ElMessage.success('已打开从订单净表提取的零件库导入草稿，请预览确认后再写入');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件库导入草稿加载失败，请确认导入会话状态');
  } finally {
    importRefreshing.value = false;
  }
}

function displayMaterialImportFileName(fileName?: string | null) {
  return normalizeDisplayFileName(fileName) || '上传文件';
}

function materialImportSourceFilePreview(row: { sourceFileName?: string | null }) {
  return formatLongTextPreview(displayMaterialImportFileName(row.sourceFileName), 28, '上传文件');
}

function materialImportSourceSheetPreview(row: { sourceSheetName?: string | null }) {
  return formatLongTextPreview(row.sourceSheetName, 18, '-');
}

function materialImportSourceFileTitle(row: { sourceFileName?: string | null; sourceSheetName?: string | null }) {
  const fileName = displayMaterialImportFileName(row.sourceFileName);
  const sheetName = String(row.sourceSheetName || '').trim();
  return sheetName ? `${fileName} / ${sheetName}` : fileName;
}

function formatMaterialDrawingSnapshot(row: {
  drawingNo?: string | null;
  drawingVersion?: string | null;
  drawingDate?: string | null;
  drawingStatus?: string | null;
}) {
  return [row.drawingNo, row.drawingVersion, row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ') || '-';
}

function formatProcessRoutePreview(value?: string | null, emptyText = '-') {
  const routeText = String(value || '').trim();
  if (!routeText) {
    return emptyText;
  }
  const steps = splitDefaultProcessRoute(routeText);
  if (steps.length <= 1) {
    return routeText;
  }
  const preview = steps.filter((_, index) => index < 3).join('、');
  return steps.length > 3 ? `${preview} 等 ${steps.length} 个工序` : preview;
}

function processRouteTooltipText(value?: string | null) {
  return String(value || '').trim() || '-';
}

function materialImportIssueSeverityText(issue: MaterialImportIssue) {
  return issue.severity === 'ERROR' ? '错误' : '警告';
}

function formatMaterialImportIssuePreview(issues?: MaterialImportIssue[]) {
  const visibleIssues = issues || [];
  if (!visibleIssues.length) {
    return '可写入';
  }
  if (visibleIssues.length === 1) {
    return formatLongTextPreview(visibleIssues[0].message, 36, materialImportIssueSeverityText(visibleIssues[0]));
  }
  const errorCount = visibleIssues.filter((issue) => issue.severity === 'ERROR').length;
  const warningCount = visibleIssues.length - errorCount;
  return [
    errorCount > 0 ? `错误 ${errorCount}` : '',
    warningCount > 0 ? `警告 ${warningCount}` : ''
  ]
    .filter(Boolean)
    .join(' / ');
}

function formatMaterialImportIssueTitle(issues?: MaterialImportIssue[]) {
  const visibleIssues = issues || [];
  return visibleIssues.length
    ? visibleIssues
        .map((issue) => `${materialImportIssueSeverityText(issue)} ${issue.code || '-'}：${issue.message || '-'}`)
        .join('；')
    : '可写入';
}

function formatLongTextPreview(value?: string | null, maxLength = 32, emptyText = '-') {
  const text = String(value || '').trim();
  if (!text) {
    return emptyText;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function longTextTooltipText(value?: string | null) {
  return String(value || '').trim() || '-';
}

function materialImportTraceRemarkPreview(row: MaterialImportTraceRow) {
  return formatLongTextPreview(row.remark, 48, '-');
}

function materialImportTraceRemarkTitle(row: MaterialImportTraceRow) {
  return longTextTooltipText(row.remark);
}

function materialApplicabilityScopePreview(row: MaterialApplicability) {
  return formatLongTextPreview(row.scopeLabel, 32, '-');
}

function materialApplicabilityScopeTitle(row: MaterialApplicability) {
  return `适用范围：${materialApplicabilityScopePreview(row)}。完整范围请进入适用范围详情核对；该范围只影响后续搜索和推荐，不会修改历史订单、BOM、生产任务或库存。`;
}

function materialImportTraceValueText(value: string | number | boolean | null) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  return String(value);
}

function openMaterialImportTrace(row: MaterialImportTraceRow, kind: MaterialImportTraceKind) {
  activeMaterialImportTraceRow.value = row;
  materialImportTraceKind.value = kind;
  materialImportTraceDialogVisible.value = true;
}

async function loadMaterials() {
  loading.value = true;
  try {
    const requestPage = Math.max(materialPagination.page, 1);
    const requestLimit = materialPagination.limit;
    const requestOffset = (requestPage - 1) * requestLimit;
    const baseFilters = {
      keyword: filters.keyword.trim() || undefined,
      status: filters.status
    };
    const [initialResult, triggeredResult] = await Promise.all([
      erpApi.inventoryMaterialsPage({
        ...baseFilters,
        stockAlert: filters.stockAlert,
        limit: requestLimit,
        offset: requestOffset
      }),
      erpApi.inventoryMaterialsPage({
        ...baseFilters,
        stockAlert: 'TRIGGERED',
        limit: Number(1),
        offset: Number(0)
      })
    ]);
    let result = initialResult;
    triggeredStockAlertTotal.value = triggeredResult.totalCount;
    if (result.totalCount > 0 && result.items.length === 0 && requestPage > 1) {
      materialPagination.page = Math.max(Math.ceil(result.totalCount / requestLimit), 1);
      result = await erpApi.inventoryMaterialsPage({
        ...baseFilters,
        stockAlert: filters.stockAlert,
        limit: requestLimit,
        offset: (materialPagination.page - 1) * requestLimit
      });
    }
    materials.value = result.items;
    materialPagination.total = result.totalCount;
    await applyRouteActionAfterLoad();
  } catch (error) {
    materials.value = [];
    triggeredStockAlertTotal.value = 0;
    materialPagination.total = Number(0);
    ElMessage.error(error instanceof Error ? error.message : '零件基础库加载失败，请确认后端服务和筛选条件');
  } finally {
    loading.value = false;
  }
}

function materialRequestFilters() {
  return {
    keyword: filters.keyword.trim() || undefined,
    status: filters.status,
    stockAlert: filters.stockAlert
  };
}

async function exportMaterialsExcel() {
  if (materialExporting.value) {
    return;
  }
  materialExporting.value = true;
  try {
    await erpApi.downloadInventoryMaterialsExport(materialRequestFilters(), `零件基础库_${formatFileDateTime()}.xlsx`);
    ElMessage.success('零件基础库 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件基础库导出失败，请稍后重试');
  } finally {
    materialExporting.value = false;
  }
}

async function loadProcessDefinitions() {
  try {
    processDefinitions.value = await erpApi.processDefinitions(undefined, 'ENABLED');
  } catch {
    processDefinitions.value = [];
    ElMessage.error('标准工序加载失败，零件默认工艺暂不可选');
  }
}

function splitDefaultProcessRoute(value: string) {
  return String(value || '')
    .split(/(?:->|→|[、,，;；\n\r]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function searchMaterials() {
  materialPagination.page = Number(1);
  void loadMaterials();
}

function handleMaterialPageChange(page: number) {
  materialPagination.page = page;
  void loadMaterials();
}

async function applyRouteActionAfterLoad() {
  if (routeActionApplied.value) {
    return;
  }
  const action = routeQueryText(route.query.action);
  if (action !== 'drawing' && action !== 'applicability') {
    return;
  }
  routeActionApplied.value = true;
  const keyword = routeQueryText(route.query.keyword).trim().toLocaleLowerCase();
  const matchedMaterial =
    materials.value.find((item) => item.partCode.trim().toLocaleLowerCase() === keyword) ||
    (materials.value.length === 1 ? materials.value[0] : undefined);
  if (!matchedMaterial) {
    ElMessage.warning('未找到可直接打开的零件，请先在列表中选择');
    return;
  }
  if (action === 'drawing') {
    await openDrawingDialog(matchedMaterial);
    return;
  }
  await openApplicabilityDialog(matchedMaterial);
}

function resetFilters() {
  filters.keyword = '';
  filters.status = 'ENABLED';
  filters.stockAlert = undefined;
  searchMaterials();
}

function applyTriggeredStockAlertFilter() {
  filters.stockAlert = filters.stockAlert === 'TRIGGERED' ? undefined : 'TRIGGERED';
  // 库存报警仅用于基础资料提醒和筛选，不会自动生成订单、生产任务或库存流水。
  searchMaterials();
}

function resetForm() {
  editingMaterialId.value = '';
  form.partCode = '';
  form.partName = '';
  form.unit = '件';
  form.partSpecification = '';
  form.defaultProcessRouteSteps = [];
  form.stockAlertEnabled = false;
  form.stockAlertQuantity = null;
  form.status = 'ENABLED';
}

function isMobileViewport() {
  return isMobileLayout.value || (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
}

function showMobileDesktopNotice(actionLabel: string) {
  ElMessage.warning(`手机端仅查看零件基础资料，${actionLabel}请在电脑端操作`);
}

function guardDesktopOperation(actionLabel: string) {
  if (!isMobileViewport()) {
    return false;
  }
  showMobileDesktopNotice(actionLabel);
  return true;
}

function warnMaterialSavingClose() {
  ElMessage.warning('零件基础资料正在保存，请等待保存完成');
}

function closeMaterialDialog() {
  if (saving.value) {
    warnMaterialSavingClose();
    return;
  }
  dialogVisible.value = false;
}

function handleMaterialDialogClose(done: () => void) {
  if (saving.value) {
    warnMaterialSavingClose();
    return;
  }
  done();
}

function closeMaterialImportConfirmDialog() {
  if (materialImportConfirmSaving.value) {
    ElMessage.warning('零件库导入确认正在执行，请等待操作完成');
    return;
  }
  materialImportConfirmDialogVisible.value = false;
  materialImportDeleteFileTarget.value = undefined;
}

function handleMaterialImportConfirmDialogClose(done: () => void) {
  if (materialImportConfirmSaving.value) {
    ElMessage.warning('零件库导入确认正在执行，请等待操作完成');
    return;
  }
  done();
}

function openMaterialImportConfirmDialog(action: 'commit' | 'discard' | 'deleteFile', file?: MaterialImportSessionPreview['files'][number]) {
  materialImportConfirmAction.value = action;
  materialImportDeleteFileTarget.value = file;
  materialImportConfirmDialogVisible.value = true;
}

function closeMaterialStatusDialog() {
  if (materialStatusSaving.value) {
    ElMessage.warning('零件基础资料状态正在保存，请等待操作完成');
    return;
  }
  materialStatusDialogVisible.value = false;
  materialStatusTarget.value = undefined;
  materialStatusAction.value = 'disable';
}

function handleMaterialStatusDialogClose(done: () => void) {
  if (materialStatusSaving.value) {
    ElMessage.warning('零件基础资料状态正在保存，请等待操作完成');
    return;
  }
  materialStatusTarget.value = undefined;
  materialStatusAction.value = 'disable';
  done();
}

function closeMaterialMaintenanceStatusDialog() {
  if (materialMaintenanceStatusSaving.value) {
    ElMessage.warning('零件资料状态正在保存，请等待操作完成');
    return;
  }
  materialMaintenanceStatusDialogVisible.value = false;
  activeMaterialMaintenanceStatusTarget.value = undefined;
}

function handleMaterialMaintenanceStatusDialogClose(done: () => void) {
  if (materialMaintenanceStatusSaving.value) {
    ElMessage.warning('零件资料状态正在保存，请等待操作完成');
    return;
  }
  activeMaterialMaintenanceStatusTarget.value = undefined;
  done();
}

function openMaterialMaintenanceStatusDialog(target: MaterialMaintenanceStatusTarget) {
  activeMaterialMaintenanceStatusTarget.value = target;
  materialMaintenanceStatusDialogVisible.value = true;
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

function openEditDialog(row: MaterialMemory) {
  if (guardDesktopOperation('编辑零件')) {
    return;
  }
  editingMaterialId.value = row.id;
  form.partCode = row.partCode;
  form.partName = row.partName;
  form.unit = row.unit;
  form.partSpecification = row.partSpecification || '';
  form.defaultProcessRouteSteps = splitDefaultProcessRoute(row.defaultProcessRoute || '');
  form.stockAlertEnabled = Boolean(row.stockAlertEnabled);
  form.stockAlertQuantity = row.stockAlertQuantity === null || row.stockAlertQuantity === undefined ? null : Number(row.stockAlertQuantity);
  form.status = row.status;
  dialogVisible.value = true;
}

function validStockAlertQuantity(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return false;
  }
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0;
}

async function saveMaterial() {
  if (saving.value) {
    return;
  }
  if (guardDesktopOperation('保存零件')) {
    return;
  }
  const partCode = form.partCode.trim();
  const partName = form.partName.trim();
  const unit = form.unit.trim();
  if (!partCode || !partName || !unit) {
    ElMessage.warning('请填写零件编码、零件名称和单位');
    return;
  }
  if (form.stockAlertEnabled && !validStockAlertQuantity(form.stockAlertQuantity)) {
    ElMessage.warning('启用低库存报警时必须填写大于或等于 0 的最小库存');
    return;
  }

  saving.value = true;
  try {
    // 默认工艺和库存报警只属于 Material 基础资料，不创建订单、生产任务或库存流水。
    const payload = {
      partCode,
      partName,
      unit,
      partSpecification: form.partSpecification.trim() || undefined,
      defaultProcessRoute: form.defaultProcessRouteSteps.join('、') || undefined,
      stockAlertEnabled: form.stockAlertEnabled,
      stockAlertQuantity: form.stockAlertEnabled ? Number(form.stockAlertQuantity) : null
    };
    if (editingMaterialId.value) {
      await erpApi.updateInventoryMaterial(editingMaterialId.value, payload);
      ElMessage.success('零件基础资料已保存');
    } else {
      await erpApi.createInventoryMaterial({ ...payload, status: form.status });
      ElMessage.success('零件基础资料已新增');
    }
    dialogVisible.value = false;
    await loadMaterials();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件基础资料保存失败');
  } finally {
    saving.value = false;
  }
}

function stockAlertText(row: MaterialMemory) {
  if (!row.stockAlertEnabled) {
    return '未启用';
  }
  const alertQuantity = row.stockAlertQuantity === null || row.stockAlertQuantity === undefined ? 0 : Number(row.stockAlertQuantity);
  const quantityText = formatQuantity(alertQuantity, row.unit);
  return row.availableQuantity <= alertQuantity ? `低库存：低于 ${quantityText}` : `正常：下限 ${quantityText}`;
}

function stockAlertTagType(row: MaterialMemory) {
  if (!row.stockAlertEnabled) {
    return 'info';
  }
  const alertQuantity = row.stockAlertQuantity === null || row.stockAlertQuantity === undefined ? 0 : Number(row.stockAlertQuantity);
  return row.availableQuantity <= alertQuantity ? 'danger' : 'success';
}

async function downloadMaterialImportTemplate() {
  if (guardDesktopOperation('下载零件库导入模板')) {
    return;
  }
  if (materialImportTemplateDownloading.value) {
    return;
  }
  materialImportTemplateDownloading.value = true;
  try {
    await erpApi.downloadMaterialImportTemplate();
    ElMessage.success('零件库导入模板已下载');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件库导入模板下载失败');
  } finally {
    materialImportTemplateDownloading.value = false;
  }
}

async function openImportDialog() {
  if (guardDesktopOperation('导入零件库')) {
    return;
  }
  importDialogVisible.value = true;
  try {
    if (!materialImportSession.value || materialImportSession.value.status !== 'DRAFT') {
      materialImportSession.value = await erpApi.createMaterialImportSession();
    }
  } catch (error) {
    materialImportSession.value = undefined;
    importDialogVisible.value = false;
    ElMessage.error(error instanceof Error ? error.message : '零件库导入会话创建失败，请确认后端服务和上传目录配置');
  }
}

function triggerMaterialImportFileInput() {
  if (guardDesktopOperation('上传零件库 Excel')) {
    return;
  }
  if (materialImportBusy.value) {
    ElMessage.warning('当前导入任务正在处理，请稍后再上传');
    return;
  }
  materialImportInput.value?.click();
}

async function handleImportFileInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = '';
  await uploadMaterialImportFiles(files);
}

async function handleMaterialImportDrop(event: DragEvent) {
  materialImportDragging.value = false;
  await uploadMaterialImportFiles(Array.from(event.dataTransfer?.files || []));
}

async function uploadMaterialImportFiles(files: File[]) {
  if (guardDesktopOperation('上传零件库 Excel')) {
    return;
  }
  if (materialImportBusy.value) {
    ElMessage.warning('当前导入任务正在处理，请稍后再上传');
    return;
  }
  const excelFiles = files.filter((file) => file.name.toLowerCase().endsWith('.xlsx'));
  if (excelFiles.length === 0) {
    ElMessage.warning('请选择 .xlsx 零件库导入文件');
    return;
  }
  importUploading.value = true;
  try {
    if (!materialImportSession.value || materialImportSession.value.status !== 'DRAFT') {
      materialImportSession.value = await erpApi.createMaterialImportSession();
    }
    for (const file of excelFiles) {
      materialImportSession.value = await erpApi.uploadMaterialImportFile(materialImportSession.value.id, file);
    }
    ElMessage.success(`已上传 ${excelFiles.length} 个文件，请检查预览后确认写入`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件库文件上传失败');
  } finally {
    importUploading.value = false;
  }
}

async function refreshMaterialImportSession() {
  if (!materialImportSession.value) {
    return;
  }
  importRefreshing.value = true;
  try {
    materialImportSession.value = await erpApi.materialImportSession(materialImportSession.value.id);
  } catch (error) {
    materialImportSession.value = undefined;
    ElMessage.error(error instanceof Error ? error.message : '零件库导入预览刷新失败，请确认导入会话和后端服务');
  } finally {
    importRefreshing.value = false;
  }
}

function mergeMaterialImportSessionRows(current: MaterialImportSessionPreview, nextPage: MaterialImportSessionPreview): MaterialImportSessionPreview {
  const mergeById = <T extends { id: string }>(existing: T[] = [], incoming: T[] = []) => {
    const seen = new Set(existing.map((item) => item.id));
    return [...existing, ...incoming.filter((item) => !seen.has(item.id))];
  };
  const rows = mergeById(current.rows, nextPage.rows);
  const applicabilityRows = mergeById(current.applicabilityRows ?? [], nextPage.applicabilityRows ?? []);
  const transformRows = mergeById(current.transformRows ?? [], nextPage.transformRows ?? []);
  return {
    ...nextPage,
    rows,
    applicabilityRows,
    transformRows,
    rowPage: {
      ...nextPage.rowPage,
      loadedCount: rows.length + applicabilityRows.length + transformRows.length
    }
  };
}

async function loadMoreMaterialImportRows() {
  const session = materialImportSession.value;
  if (!session || !materialImportHasMoreRows.value) {
    return;
  }
  if (materialImportBusy.value) {
    ElMessage.warning('当前导入任务正在处理，请稍后再加载预览');
    return;
  }
  importLoadingMore.value = true;
  try {
    // 零件库导入预览必须明确显示总数并支持继续加载，避免大文件只看到前 100 行。
    const nextOffset = session.rowPage.offset + session.rowPage.limit;
    const nextPage = await erpApi.materialImportSession(session.id, session.rowPage.limit, nextOffset);
    materialImportSession.value = mergeMaterialImportSessionRows(session, nextPage);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件库导入预览继续加载失败');
  } finally {
    importLoadingMore.value = false;
  }
}

async function downloadMaterialImportIssueReport() {
  if (guardDesktopOperation('下载零件库导入问题明细')) {
    return;
  }
  if (importIssueReportDownloading.value) {
    return;
  }
  if (!materialImportSession.value?.id) {
    ElMessage.warning('请先上传 Excel 并生成导入预览');
    return;
  }
  importIssueReportDownloading.value = true;
  try {
    await erpApi.downloadMaterialImportIssueReport(materialImportSession.value.id);
    ElMessage.success('问题明细已下载');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '问题明细下载失败');
  } finally {
    importIssueReportDownloading.value = false;
  }
}

async function deleteMaterialImportFile(fileId: string) {
  if (guardDesktopOperation('删除导入文件')) {
    return;
  }
  if (!materialImportSession.value) {
    return;
  }
  if (materialImportBusy.value) {
    return;
  }
  const file = materialImportSession.value.files.find((item) => item.id === fileId);
  if (!file) {
    ElMessage.error('导入文件不存在，请刷新预览后重试');
    return;
  }
  openMaterialImportConfirmDialog('deleteFile', file);
}

async function discardMaterialImport() {
  if (guardDesktopOperation('放弃导入')) {
    return;
  }
  if (!materialImportSession.value) {
    return;
  }
  if (materialImportBusy.value) {
    return;
  }
  openMaterialImportConfirmDialog('discard');
}

async function commitMaterialImport() {
  if (guardDesktopOperation('确认写入零件库')) {
    return;
  }
  if (!materialImportSession.value?.previewToken) {
    return;
  }
  if (materialImportBusy.value) {
    return;
  }
  openMaterialImportConfirmDialog('commit');
}

async function confirmMaterialImportAction() {
  if (materialImportConfirmAction.value === 'discard') {
    await executeDiscardMaterialImport();
    return;
  }
  if (materialImportConfirmAction.value === 'deleteFile') {
    await executeDeleteMaterialImportFile();
    return;
  }
  await executeCommitMaterialImport();
}

async function executeDeleteMaterialImportFile() {
  const file = materialImportDeleteFileTarget.value;
  if (!materialImportSession.value || !file || importDeletingFileId.value) {
    return;
  }
  importDeletingFileId.value = file.id;
  try {
    materialImportSession.value = await erpApi.deleteMaterialImportFile(materialImportSession.value.id, file.id);
    materialImportConfirmDialogVisible.value = false;
    materialImportDeleteFileTarget.value = undefined;
    ElMessage.success('导入文件已删除，预览已刷新');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入文件删除失败');
  } finally {
    if (importDeletingFileId.value === file.id) {
      importDeletingFileId.value = '';
    }
  }
}

async function executeDiscardMaterialImport() {
  if (!materialImportSession.value || importDiscarding.value) {
    return;
  }
  importDiscarding.value = true;
  try {
    await erpApi.discardMaterialImportSession(materialImportSession.value.id);
    materialImportSession.value = undefined;
    materialImportConfirmDialogVisible.value = false;
    ElMessage.success('已放弃本次导入');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '放弃导入失败');
  } finally {
    importDiscarding.value = false;
  }
}

async function executeCommitMaterialImport() {
  if (!materialImportSession.value?.previewToken || importCommitting.value) {
    return;
  }
  const returnToOrders = routeQueryText(route.query.returnTo) === '/orders';
  const orderImportSessionId = routeQueryText(route.query.orderImportSessionId);
  const previewBomDraft = routeQueryText(route.query.previewBomDraft) || '1';
  importCommitting.value = true;
  try {
    const result = await erpApi.commitMaterialImportSession(materialImportSession.value.id, materialImportSession.value.previewToken);
    ElMessage.success(
      `导入完成：新增 ${result.createdCount} 个，更新 ${result.updatedCount} 个，图纸版本 ${result.drawingRevisionUpsertCount ?? 0} 条，适用范围 ${result.applicabilityUpsertCount ?? 0} 条，来源关系 ${result.transformRuleUpsertCount ?? 0} 条`
    );
    materialImportSession.value = undefined;
    materialImportConfirmDialogVisible.value = false;
    importDialogVisible.value = false;
    if (returnToOrders && orderImportSessionId) {
      await router.push({
        path: '/orders',
        query: {
          orderImportSessionId,
          previewBomDraft
        }
      });
      return;
    }
    await loadMaterials();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件库导入写入失败');
  } finally {
    importCommitting.value = false;
  }
}

async function openApplicabilityDialog(row: MaterialMemory) {
  if (guardDesktopOperation('适用范围维护')) {
    return;
  }
  activeMaterial.value = row;
  applicabilityDialogVisible.value = true;
  resetApplicabilityForm();
  await loadApplicabilities();
}

async function loadApplicabilities() {
  if (!activeMaterial.value) {
    return;
  }
  applicabilityLoading.value = true;
  try {
    const response = await erpApi.materialApplicabilities(activeMaterial.value.id);
    applicabilities.value = response.items;
  } catch (error) {
    applicabilities.value = [];
    ElMessage.error(error instanceof Error ? error.message : '零件适用范围加载失败，请确认后端服务和当前零件状态');
  } finally {
    applicabilityLoading.value = false;
  }
}

async function exportApplicabilitiesExcel() {
  if (applicabilityExporting.value || !activeMaterial.value) {
    return;
  }
  applicabilityExporting.value = true;
  try {
    await erpApi.downloadMaterialApplicabilitiesExport(
      activeMaterial.value.id,
      `零件适用范围_${activeMaterial.value.partCode}_${formatFileDateTime()}.xlsx`
    );
    ElMessage.success('零件适用范围 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件适用范围导出失败，请稍后重试');
  } finally {
    applicabilityExporting.value = false;
  }
}

function resetApplicabilityForm() {
  applicabilityForm.id = '';
  applicabilityForm.customerScope = 'ALL';
  applicabilityForm.customerId = '';
  applicabilityForm.projectScope = 'ALL';
  applicabilityForm.projectModel = '';
  applicabilityForm.remark = '';
  applicabilityForm.status = 'ENABLED';
}

function warnMaterialMaintenanceSavingClose(message: string) {
  ElMessage.warning(message);
}

function handleApplicabilityDialogClose(done: () => void) {
  if (applicabilitySaving.value) {
    warnMaterialMaintenanceSavingClose('适用范围正在保存，请等待保存完成');
    return;
  }
  done();
}

function handleCustomerScopeChange() {
  if (applicabilityForm.customerScope === 'ALL') {
    applicabilityForm.customerId = '';
  }
}

function handleProjectScopeChange() {
  if (applicabilityForm.projectScope === 'ALL') {
    applicabilityForm.projectModel = '';
  }
}

function editApplicability(row: MaterialApplicability) {
  if (guardDesktopOperation('编辑适用范围')) {
    return;
  }
  applicabilityForm.id = row.id;
  applicabilityForm.customerScope = row.customerId ? 'SPECIFIC' : 'ALL';
  applicabilityForm.customerId = row.customerId || '';
  applicabilityForm.projectScope = row.projectModel ? 'SPECIFIC' : 'ALL';
  applicabilityForm.projectModel = row.projectModel || '';
  applicabilityForm.remark = row.remark || '';
  applicabilityForm.status = row.status;
}

async function saveApplicability() {
  if (guardDesktopOperation('保存适用范围')) {
    return;
  }
  if (applicabilitySaving.value) {
    return;
  }
  if (!activeMaterial.value) {
    return;
  }
  if (applicabilityForm.customerScope === 'SPECIFIC' && !applicabilityForm.customerId) {
    ElMessage.warning('请选择指定客户');
    return;
  }
  if (applicabilityForm.projectScope === 'SPECIFIC' && !applicabilityForm.projectModel.trim()) {
    ElMessage.warning('请填写指定机型/项目');
    return;
  }
  applicabilitySaving.value = true;
  try {
    const payload = {
      customerId: applicabilityForm.customerScope === 'SPECIFIC' ? applicabilityForm.customerId : undefined,
      projectModel: applicabilityForm.projectScope === 'SPECIFIC' ? applicabilityForm.projectModel.trim() : undefined,
      remark: applicabilityForm.remark.trim() || undefined
    };
    if (applicabilityForm.id) {
      await erpApi.updateMaterialApplicability(applicabilityForm.id, payload);
      ElMessage.success('适用范围已保存');
    } else {
      await erpApi.saveMaterialApplicability(activeMaterial.value.id, { ...payload, status: applicabilityForm.status });
      ElMessage.success('适用范围已新增');
    }
    resetApplicabilityForm();
    await loadApplicabilities();
  } finally {
    applicabilitySaving.value = false;
  }
}

function disableApplicability(row: MaterialApplicability) {
  if (guardDesktopOperation('停用适用范围')) {
    return;
  }
  if (applicabilitySaving.value) {
    return;
  }
  if (applicabilityOperationSavingId.value) {
    return;
  }
  openMaterialMaintenanceStatusDialog({
    type: 'applicability',
    id: row.id,
    name: materialApplicabilityScopePreview(row),
    nextStatus: 'DISABLED',
    actionLabel: '停用适用范围',
    warning: '停用适用范围只影响后续推荐和下单选择，不会改写历史订单或已维护 BOM。'
  });
}

function enableApplicability(row: MaterialApplicability) {
  if (guardDesktopOperation('启用适用范围')) {
    return;
  }
  if (applicabilitySaving.value) {
    return;
  }
  if (applicabilityOperationSavingId.value) {
    return;
  }
  openMaterialMaintenanceStatusDialog({
    type: 'applicability',
    id: row.id,
    name: materialApplicabilityScopePreview(row),
    nextStatus: 'ENABLED',
    actionLabel: '启用适用范围',
    warning: '启用适用范围只恢复后续推荐入口，不会重写原客户范围、机型范围或备注。'
  });
}

async function openDrawingDialog(row: MaterialMemory) {
  if (guardDesktopOperation('图纸版本维护')) {
    return;
  }
  activeMaterial.value = row;
  drawingDialogVisible.value = true;
  drawingRevisions.value = [];
  await loadDrawingRevisions();
  resetDrawingForm();
}

async function loadDrawingRevisions() {
  if (!activeMaterial.value) {
    return;
  }
  drawingLoading.value = true;
  try {
    const response = await erpApi.materialDrawingRevisions(activeMaterial.value.id);
    drawingRevisions.value = response.items;
  } catch (error) {
    drawingRevisions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '零件图纸版本加载失败，请确认后端服务和当前零件状态');
  } finally {
    drawingLoading.value = false;
  }
}

async function exportDrawingRevisionsExcel() {
  if (drawingExporting.value || !activeMaterial.value) {
    return;
  }
  drawingExporting.value = true;
  try {
    await erpApi.downloadMaterialDrawingRevisionsExport(
      activeMaterial.value.id,
      `零件图纸版本_${activeMaterial.value.partCode}_${formatFileDateTime()}.xlsx`
    );
    ElMessage.success('零件图纸版本 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件图纸版本导出失败，请稍后重试');
  } finally {
    drawingExporting.value = false;
  }
}

function resetDrawingForm() {
  drawingForm.id = '';
  drawingForm.drawingNo = '';
  drawingForm.drawingVersion = 'A';
  drawingForm.drawingDate = '';
  drawingForm.drawingStatus = '';
  drawingForm.drawingFileName = '';
  drawingForm.drawingFileUrl = '';
  drawingForm.isDefault = drawingRevisions.value.length === 0;
  drawingForm.defaultChangedBy = '';
  drawingForm.remark = '';
  drawingForm.status = 'ENABLED';
}

function handleDrawingDialogClose(done: () => void) {
  if (drawingSaving.value) {
    warnMaterialMaintenanceSavingClose('图纸版本正在保存，请等待保存完成');
    return;
  }
  if (drawingUploading.value) {
    warnMaterialMaintenanceSavingClose('图纸文件正在上传，请等待上传完成');
    return;
  }
  done();
}

async function uploadMaterialDrawingFile(options: UploadRequestOptions) {
  if (guardDesktopOperation('上传图纸文件')) {
    return;
  }
  if (drawingSaving.value || drawingUploading.value) {
    return;
  }
  drawingUploading.value = true;
  try {
    const file = options.file as File;
    const result = await erpApi.uploadMaterialDrawing(file);
    // 零件基础库只记录图纸文件地址和文件名；订单保存时会把当前选用图纸写入订单零件快照。
    drawingForm.drawingFileName = result.fileName;
    drawingForm.drawingFileUrl = result.fileUrl;
    options.onSuccess?.(result);
    ElMessage.success('图纸文件已上传');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '图纸文件上传失败');
  } finally {
    drawingUploading.value = false;
  }
}

function editDrawingRevision(row: MaterialDrawingRevision) {
  if (guardDesktopOperation('编辑图纸版本')) {
    return;
  }
  drawingForm.id = row.id;
  drawingForm.drawingNo = row.drawingNo;
  drawingForm.drawingVersion = row.drawingVersion;
  drawingForm.drawingDate = row.drawingDate || '';
  drawingForm.drawingStatus = row.drawingStatus || '';
  drawingForm.drawingFileName = row.drawingFileName || '';
  drawingForm.drawingFileUrl = row.drawingFileUrl || '';
  drawingForm.isDefault = row.isDefault;
  drawingForm.defaultChangedBy = row.defaultChangedBy || '';
  drawingForm.remark = row.remark || '';
  drawingForm.status = row.status;
}

function drawingRevisionPayload(overrides: Partial<UpdateMaterialDrawingRevisionPayload> = {}): UpdateMaterialDrawingRevisionPayload {
  return {
    drawingNo: drawingForm.drawingNo.trim(),
    drawingVersion: drawingForm.drawingVersion.trim(),
    drawingDate: drawingForm.drawingDate || undefined,
    drawingStatus: drawingForm.drawingStatus.trim() || undefined,
    drawingFileName: drawingForm.drawingFileName.trim() || undefined,
    drawingFileUrl: drawingForm.drawingFileUrl.trim() || undefined,
    isDefault: drawingForm.isDefault,
    defaultChangedBy: drawingForm.isDefault ? drawingForm.defaultChangedBy.trim() : undefined,
    remark: drawingForm.remark.trim() || undefined,
    ...overrides
  };
}

async function saveDrawingRevision() {
  if (guardDesktopOperation('保存图纸版本')) {
    return;
  }
  if (drawingSaving.value) {
    return;
  }
  if (drawingUploading.value) {
    ElMessage.warning('图纸文件正在上传，请等待上传完成后再保存');
    return;
  }
  if (!activeMaterial.value) {
    return;
  }
  if (!drawingForm.drawingNo.trim() || !drawingForm.drawingVersion.trim()) {
    ElMessage.warning('请填写图号和图纸版本');
    return;
  }
  if (drawingForm.isDefault && !drawingForm.defaultChangedBy.trim()) {
    ElMessage.warning('设置默认图纸必须填写操作人员');
    return;
  }
  drawingSaving.value = true;
  try {
    const payload = drawingRevisionPayload();
    if (drawingForm.id) {
      await erpApi.updateMaterialDrawingRevision(drawingForm.id, payload);
      ElMessage.success('图纸版本已保存');
    } else {
      await erpApi.saveMaterialDrawingRevision(activeMaterial.value.id, { ...payload, status: drawingForm.status });
      ElMessage.success('图纸版本已新增');
    }
    await loadDrawingRevisions();
    resetDrawingForm();
  } finally {
    drawingSaving.value = false;
  }
}

async function setDefaultDrawingRevision(row: MaterialDrawingRevision) {
  if (guardDesktopOperation('设置默认图纸')) {
    return;
  }
  if (drawingSaving.value) {
    return;
  }
  if (drawingOperationSavingId.value) {
    return;
  }
  activeDefaultDrawingRevision.value = row;
  defaultDrawingForm.defaultChangedBy = '';
  defaultDrawingForm.remark = row.remark || '';
  defaultDrawingDialogVisible.value = true;
}

function closeDefaultDrawingDialog() {
  if (drawingOperationSavingId.value) {
    warnMaterialMaintenanceSavingClose('默认图纸正在更新，请等待保存完成');
    return;
  }
  defaultDrawingDialogVisible.value = false;
}

function handleDefaultDrawingDialogClose(done: () => void) {
  if (drawingOperationSavingId.value) {
    warnMaterialMaintenanceSavingClose('默认图纸正在更新，请等待保存完成');
    return;
  }
  done();
}

async function confirmDefaultDrawingRevision() {
  const row = activeDefaultDrawingRevision.value;
  if (!row) {
    return;
  }
  if (!defaultDrawingForm.defaultChangedBy.trim()) {
    ElMessage.warning('设置默认图纸必须填写操作人员');
    return;
  }
  drawingOperationSavingId.value = row.id;
  try {
    await erpApi.updateMaterialDrawingRevision(row.id, {
      drawingNo: row.drawingNo,
      drawingVersion: row.drawingVersion,
      drawingDate: row.drawingDate || undefined,
      drawingStatus: row.drawingStatus || undefined,
      drawingFileName: row.drawingFileName || undefined,
      drawingFileUrl: row.drawingFileUrl || undefined,
      isDefault: true,
      defaultChangedBy: defaultDrawingForm.defaultChangedBy.trim(),
      remark: defaultDrawingForm.remark.trim() || row.remark || undefined
    });
    ElMessage.success('默认图纸已更新');
    defaultDrawingDialogVisible.value = false;
    await loadDrawingRevisions();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '默认图纸更新失败');
  } finally {
    if (drawingOperationSavingId.value === row.id) {
      drawingOperationSavingId.value = '';
    }
  }
}

function disableDrawingRevision(row: MaterialDrawingRevision) {
  if (guardDesktopOperation('停用图纸版本')) {
    return;
  }
  if (drawingSaving.value) {
    return;
  }
  if (drawingOperationSavingId.value) {
    return;
  }
  openMaterialMaintenanceStatusDialog({
    type: 'drawing',
    id: row.id,
    name: formatMaterialDrawingSnapshot(row),
    nextStatus: 'DISABLED',
    actionLabel: '停用图纸版本',
    warning: '停用图纸版本只影响后续 BOM 和订单选择，不会覆盖历史订单图纸快照。'
  });
}

function enableDrawingRevision(row: MaterialDrawingRevision) {
  if (guardDesktopOperation('启用图纸版本')) {
    return;
  }
  if (drawingSaving.value) {
    return;
  }
  if (drawingOperationSavingId.value) {
    return;
  }
  openMaterialMaintenanceStatusDialog({
    type: 'drawing',
    id: row.id,
    name: formatMaterialDrawingSnapshot(row),
    nextStatus: 'ENABLED',
    actionLabel: '启用图纸版本',
    warning: '启用图纸版本只恢复可选状态，不会自动设为默认，也不会覆盖历史订单图纸快照。'
  });
}

async function confirmMaterialMaintenanceStatusChange() {
  const target = activeMaterialMaintenanceStatusTarget.value;
  if (!target || materialMaintenanceStatusSaving.value) {
    return;
  }

  if (target.type === 'applicability') {
    applicabilityOperationSavingId.value = target.id;
    try {
      if (target.nextStatus === 'ENABLED') {
        // 恢复适用范围只恢复推荐入口，不重写原客户范围、机型范围或备注。
        await erpApi.restoreMaterialApplicability(target.id);
        ElMessage.success('适用范围已启用');
      } else {
        // 停用适用范围只影响后续推荐，不改写历史订单、BOM 或导入追溯。
        await erpApi.disableMaterialApplicability(target.id);
        ElMessage.success('适用范围已停用');
      }
      materialMaintenanceStatusDialogVisible.value = false;
      activeMaterialMaintenanceStatusTarget.value = undefined;
      await loadApplicabilities();
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : target.nextStatus === 'ENABLED' ? '适用范围启用失败' : '适用范围停用失败');
    } finally {
      if (applicabilityOperationSavingId.value === target.id) {
        applicabilityOperationSavingId.value = '';
      }
    }
    return;
  }

  drawingOperationSavingId.value = target.id;
  try {
    if (target.nextStatus === 'ENABLED') {
      // 恢复图纸版本只恢复可选状态，不自动设为默认，也不覆盖历史订单图纸快照。
      await erpApi.restoreMaterialDrawingRevision(target.id);
      ElMessage.success('图纸版本已启用');
    } else {
      // 图纸版本停用只影响后续选择；历史订单继续保留下单时图纸快照。
      await erpApi.disableMaterialDrawingRevision(target.id);
      ElMessage.success('图纸版本已停用');
    }
    materialMaintenanceStatusDialogVisible.value = false;
    activeMaterialMaintenanceStatusTarget.value = undefined;
    await loadDrawingRevisions();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : target.nextStatus === 'ENABLED' ? '图纸版本启用失败' : '图纸版本停用失败');
  } finally {
    if (drawingOperationSavingId.value === target.id) {
      drawingOperationSavingId.value = '';
    }
  }
}

function disableMaterial(row: MaterialMemory) {
  if (guardDesktopOperation('停用零件')) {
    return;
  }
  if (materialOperationSavingId.value) {
    return;
  }
  materialStatusAction.value = 'disable';
  materialStatusTarget.value = row;
  materialStatusDialogVisible.value = true;
}

function enableMaterial(row: MaterialMemory) {
  if (guardDesktopOperation('启用零件')) {
    return;
  }
  if (materialOperationSavingId.value) {
    return;
  }
  materialStatusAction.value = 'enable';
  materialStatusTarget.value = row;
  materialStatusDialogVisible.value = true;
}

async function confirmMaterialStatusChange() {
  const row = materialStatusTarget.value;
  if (!row || materialStatusSaving.value || materialOperationSavingId.value) {
    return;
  }
  const action = materialStatusAction.value;
  materialStatusSaving.value = true;
  materialOperationSavingId.value = row.id;
  try {
    if (action === 'enable') {
      // 恢复零件搜索记忆只恢复 Material 后续可选状态，不自动恢复适用范围、BOM 行、默认图纸或来源加工关系。
      await erpApi.restoreInventoryMaterial(row.id);
      ElMessage.success('零件基础资料已启用');
    } else {
      await erpApi.disableInventoryMaterial(row.id);
      ElMessage.success('零件基础资料已停用');
    }
    materialStatusDialogVisible.value = false;
    materialStatusTarget.value = undefined;
    materialStatusAction.value = 'disable';
    await loadMaterials();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : action === 'enable' ? '零件基础资料启用失败' : '零件基础资料停用失败');
  } finally {
    materialStatusSaving.value = false;
    if (materialOperationSavingId.value === row.id) {
      materialOperationSavingId.value = '';
    }
  }
}

</script>

<style scoped>
.page-subtitle {
  margin: 6px 0 0;
  color: #64748b;
}

.page-actions,
.import-toolbar,
.mobile-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.mobile-readonly-note {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  color: #64748b;
  font-size: 12px;
}

.material-library-alert {
  margin-bottom: 16px;
}

.material-library-table-height-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}

.material-library-table-height-label {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
}

.material-library-import-height-toolbar {
  display: flex;
  justify-content: flex-end;
  margin: 10px 0 0;
}

.material-library-dialog-table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.material-library-dialog-table-header h3 {
  margin: 0;
}

.material-library-dialog-title-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.stock-alert-form-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.unit-text {
  color: #64748b;
  font-size: 13px;
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

.dialog-hint {
  margin: 0;
  color: #64748b;
  line-height: 1.7;
}

.material-confirm-panel {
  display: grid;
  gap: 10px;
  color: #475569;
  font-size: 14px;
  line-height: 1.65;
}

.material-confirm-panel p {
  margin: 0;
}

.material-confirm-panel strong {
  color: #0f172a;
}

.material-confirm-panel ul {
  display: grid;
  gap: 6px;
  padding-left: 18px;
  margin: 0;
}

.hidden-file-input {
  display: none;
}

.drop-zone {
  display: grid;
  gap: 6px;
  margin: 14px 0;
  padding: 18px;
  border: 1px dashed #93c5fd;
  border-radius: 8px;
  background: #eff6ff;
  color: #475569;
}

.drop-zone strong {
  color: #1e3a8a;
}

.drop-zone.is-dragging {
  border-color: #2563eb;
  background: #dbeafe;
}

.import-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.import-summary-item {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.import-summary-item span {
  font-size: 12px;
  color: #64748b;
}

.import-summary-item strong {
  font-size: 22px;
  color: #0f172a;
}

.import-summary-item.danger strong {
  color: #dc2626;
}

.import-summary-item.warning strong {
  color: #d97706;
}

.import-file-list {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.import-file-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(240px, 2fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
}

.import-file-row small {
  color: #64748b;
}

.material-import-trace {
  display: grid;
  gap: 14px;
}

.trace-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.trace-summary-grid > div {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.trace-summary-grid span {
  color: #64748b;
  font-size: 12px;
}

.trace-summary-grid strong {
  color: #0f172a;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.trace-descriptions {
  word-break: break-word;
}

.trace-remark {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.trace-remark p {
  margin: 0;
  color: #475569;
  line-height: 1.6;
}

.issue-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.issue-pill {
  display: inline-flex;
  align-items: center;
  max-width: min(240px, 100%);
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid #fed7aa;
  background: #fff7ed;
  color: #c2410c;
  font-size: 12px;
  line-height: 1.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-pill.is-error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

.material-scope-cell {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  color: #334155;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-preview-tabs {
  margin-top: 8px;
}

.import-preview-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.check-ok {
  color: #16a34a;
}

.applicability-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  margin-bottom: 14px;
}

.applicability-form,
.applicability-list {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
  background: #f8fafc;
}

.applicability-form h3,
.applicability-list h3 {
  margin: 0 0 12px;
  font-size: 15px;
}

.applicability-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.drawing-file-maintenance {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

@media (max-width: 900px) {
  .page-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .import-summary-grid,
  .applicability-layout {
    grid-template-columns: 1fr;
  }

  .import-file-row {
    grid-template-columns: 1fr;
  }

  .import-preview-pager {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
