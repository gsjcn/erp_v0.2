<template>
  <section class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">零件基础库</h2>
        <p class="page-subtitle">维护下单可搜索的零件主数据；不会生成订单、不会占用库存、不会创建生产任务。</p>
      </div>
      <div class="page-actions">
        <el-button @click="erpApi.downloadMaterialImportTemplate">下载导入模板</el-button>
        <el-button type="success" plain @click="openImportDialog">导入零件库</el-button>
        <el-button @click="router.push('/materials')">返回零件管理</el-button>
        <el-button @click="openDesktopMaintenancePage('/inventory/model-boms', '机型零件包维护')">机型零件包</el-button>
        <el-button @click="openDesktopMaintenancePage('/inventory/material-transforms', '来源加工关系维护')">来源加工关系</el-button>
        <el-button type="primary" @click="openCreateDialog">新增零件</el-button>
      </div>
    </div>

    <el-alert
      class="material-library-alert"
      type="info"
      :closable="false"
      show-icon
      title="导入说明"
      description="零件库导入只写入零件基础资料，不会创建订单、库存或生产任务。客户/机型适用范围和来源加工关系应在 ERP 中维护，避免 Excel 名称手工输入造成错误。"
    />

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">当前列表</div>
        <div class="stat-value">{{ materials.length }} 条</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">启用零件</div>
        <div class="stat-value">{{ enabledCount }} 条</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">停用记忆</div>
        <div class="stat-value">{{ disabledCount }} 条</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">当前可用库存</div>
        <div class="stat-value">{{ currentAvailableText }}</div>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>零件关键字</label>
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="编码 / 名称 / 拼音 / 规格 / 客户 / 订单 / 图号"
          style="width: 360px"
          @keyup.enter="loadMaterials"
        />
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" placeholder="状态" style="width: 140px" @change="loadMaterials">
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="loadMaterials">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="table-card desktop-table">
      <div class="section-heading">
        <div>
          <strong>零件基础资料</strong>
          <span>库存数量从批次实时汇总；删除只会软停用基础资料。</span>
        </div>
      </div>
      <el-table v-loading="loading" :data="materials" max-height="620">
        <el-table-column prop="partCode" label="零件编码" min-width="160" />
        <el-table-column prop="partName" label="零件名称" min-width="180" />
        <el-table-column prop="unit" label="单位" width="90" />
        <el-table-column prop="partSpecification" label="成品规格" min-width="180">
          <template #default="{ row }">{{ row.partSpecification || '-' }}</template>
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
        <el-table-column label="更新时间" width="150">
          <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openApplicabilityDialog(row)">适用范围</el-button>
            <el-button link type="primary" @click="openDrawingDialog(row)">图纸版本</el-button>
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button v-if="row.status === 'ENABLED'" link type="danger" @click="disableMaterial(row)">停用</el-button>
            <el-button v-else link type="success" @click="enableMaterial(row)">启用</el-button>
          </template>
        </el-table-column>
      </el-table>
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
        <div class="mobile-actions">
          <el-button size="small" @click="openApplicabilityDialog(row)">适用范围</el-button>
          <el-button size="small" @click="openDrawingDialog(row)">图纸版本</el-button>
          <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
          <el-button v-if="row.status === 'ENABLED'" size="small" type="danger" plain @click="disableMaterial(row)">停用</el-button>
          <el-button v-else size="small" type="success" plain @click="enableMaterial(row)">启用</el-button>
        </div>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" class="responsive-dialog" :title="dialogTitle" width="560px">
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
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 160px">
            <el-option label="启用" value="ENABLED" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="dialog-hint">
        这里只维护 `Material` 基础资料。库存数量、订单来源、客户/机型适用范围和来源加工关系由独立功能维护。
      </p>
      <template #footer>
        <el-button :disabled="saving" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveMaterial">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialogVisible" class="responsive-dialog material-import-dialog" title="导入零件基础库" width="1180px">
      <div class="import-toolbar">
        <el-button @click="erpApi.downloadMaterialImportTemplate">下载模板</el-button>
        <el-button type="primary" :loading="importUploading" @click="triggerMaterialImportFileInput">选择 .xlsx 文件</el-button>
        <el-button :disabled="!materialImportSession" @click="refreshMaterialImportSession">刷新预览</el-button>
        <el-button
          :disabled="!materialImportHasIssues"
          :loading="importIssueReportDownloading"
          @click="downloadMaterialImportIssueReport"
        >
          下载问题明细
        </el-button>
        <el-button
          type="success"
          :disabled="!materialImportCanCommit"
          :loading="importCommitting"
          @click="commitMaterialImport"
        >
          确认写入零件库
        </el-button>
        <el-button v-if="materialImportSession" type="danger" plain :disabled="importUploading || importCommitting" @click="discardMaterialImport">
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
          <strong>{{ materialImportSession.summary.drawingRevisionUpsertCount || 0 }}</strong>
        </div>
        <div class="import-summary-item">
          <span>适用范围</span>
          <strong>{{ materialImportSession.summary.applicabilityUpsertCount || 0 }}</strong>
        </div>
        <div class="import-summary-item">
          <span>来源关系</span>
          <strong>{{ materialImportSession.summary.transformRuleUpsertCount || 0 }}</strong>
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
            （零件 {{ file.materialRowCount || 0 }} / 范围 {{ file.scopeRowCount || 0 }} / 来源关系 {{ file.transformRowCount || 0 }}）
            / 新增预览 {{ file.acceptedRowCount }} 行 / 重复 {{ file.duplicateRowCount }} 行
          </small>
          <el-button link type="danger" :disabled="materialImportSession.status !== 'DRAFT'" @click="deleteMaterialImportFile(file.id)">
            删除文件
          </el-button>
        </div>
      </div>

      <el-tabs v-if="materialImportSession" v-model="materialImportActiveTab" class="import-preview-tabs">
        <el-tab-pane :label="`零件基础库 ${materialImportSession.summary.materialRowCount || materialImportSession.rows.length}`" name="materials">
          <el-table v-loading="importUploading" :data="materialImportSession.rows" max-height="420">
            <el-table-column label="来源文件" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ displayMaterialImportFileName(row.sourceFileName) }}</template>
            </el-table-column>
            <el-table-column prop="sourceRowNo" label="Excel 行" width="90" />
            <el-table-column prop="partCode" label="零件编码" min-width="160" />
            <el-table-column prop="partName" label="零件名称" min-width="160" />
            <el-table-column prop="unit" label="单位" width="80" />
            <el-table-column prop="partSpecification" label="规格" min-width="140">
              <template #default="{ row }">{{ row.partSpecification || '-' }}</template>
            </el-table-column>
            <el-table-column prop="drawingNo" label="图号" min-width="160">
              <template #default="{ row }">{{ row.drawingNo || '-' }}</template>
            </el-table-column>
            <el-table-column prop="partThickness" label="厚度" width="90">
              <template #default="{ row }">{{ row.partThickness ?? '-' }}</template>
            </el-table-column>
            <el-table-column prop="projectModel" label="项目型号" min-width="120">
              <template #default="{ row }">{{ row.projectModel || '-' }}</template>
            </el-table-column>
            <el-table-column label="校验" min-width="260" fixed="right">
              <template #default="{ row }">
                <ImportIssueList :issues="row.issues" />
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`适用范围 ${materialImportSession.summary.applicabilityRowCount || 0}`" name="applicabilities">
          <el-table v-loading="importUploading" :data="materialImportSession.applicabilityRows || []" max-height="420">
            <el-table-column label="来源文件" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ displayMaterialImportFileName(row.sourceFileName) }}</template>
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
              <template #default="{ row }">{{ row.remark || '-' }}</template>
            </el-table-column>
            <el-table-column label="校验" min-width="260" fixed="right">
              <template #default="{ row }">
                <ImportIssueList :issues="row.issues" />
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`来源加工关系 ${materialImportSession.summary.transformRowCount || 0}`" name="transforms">
          <el-table v-loading="importUploading" :data="materialImportSession.transformRows || []" max-height="420">
            <el-table-column label="来源文件" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ displayMaterialImportFileName(row.sourceFileName) }}</template>
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
              <template #default="{ row }">{{ row.defaultProcessRoute || '-' }}</template>
            </el-table-column>
            <el-table-column label="校验" min-width="260" fixed="right">
              <template #default="{ row }">
                <ImportIssueList :issues="row.issues" />
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <el-empty v-else description="请先上传零件库导入文件" />

      <template #footer>
        <el-button @click="importDialogVisible = false">关闭</el-button>
        <el-button
          type="success"
          :disabled="!materialImportCanCommit"
          :loading="importCommitting"
          @click="commitMaterialImport"
        >
          确认写入零件库
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="applicabilityDialogVisible" class="responsive-dialog" :title="applicabilityDialogTitle" width="860px">
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
              <el-select v-model="applicabilityForm.status" style="width: 160px">
                <el-option label="启用" value="ENABLED" />
                <el-option label="停用" value="DISABLED" />
              </el-select>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="applicabilityForm.remark" type="textarea" :rows="3" placeholder="例如 客户A专用，B5项目暂用" />
            </el-form-item>
          </el-form>
          <div class="applicability-actions">
            <el-button @click="resetApplicabilityForm">清空</el-button>
            <el-button type="primary" :loading="applicabilitySaving" @click="saveApplicability">
              {{ applicabilityForm.id ? '保存范围' : '新增范围' }}
            </el-button>
          </div>
        </div>

        <div class="applicability-list">
          <h3>已维护范围</h3>
          <el-table v-loading="applicabilityLoading" :data="applicabilities" max-height="420">
            <el-table-column prop="scopeLabel" label="适用范围" min-width="220" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
                  {{ row.status === 'ENABLED' ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="180">
              <template #default="{ row }">{{ row.remark || '-' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="editApplicability(row)">编辑</el-button>
                <el-button v-if="row.status === 'ENABLED'" link type="danger" @click="disableApplicability(row)">停用</el-button>
                <el-button v-else link type="success" @click="enableApplicability(row)">启用</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <p class="dialog-hint">
        空客户表示全部客户，空机型/项目表示全部机型/项目。规则只用于后续下单推荐，不会自动加入订单、占用库存或生成生产任务。
      </p>
    </el-dialog>

    <el-dialog v-model="drawingDialogVisible" class="responsive-dialog" :title="drawingDialogTitle" width="980px">
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
            <el-form-item label="图纸文件名">
              <el-input v-model="drawingForm.drawingFileName" placeholder="例如 DRW-4101-A.pdf" />
            </el-form-item>
            <el-form-item label="图纸文件地址">
              <el-input v-model="drawingForm.drawingFileUrl" placeholder="/uploads/drawings/..." />
            </el-form-item>
            <el-form-item label="默认图纸">
              <el-switch v-model="drawingForm.isDefault" active-text="作为默认下单图纸" />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="drawingForm.status" style="width: 160px">
                <el-option label="启用" value="ENABLED" />
                <el-option label="停用" value="DISABLED" />
              </el-select>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="drawingForm.remark" type="textarea" :rows="3" placeholder="图纸变更说明或核对备注" />
            </el-form-item>
          </el-form>
          <div class="applicability-actions">
            <el-button @click="resetDrawingForm">清空</el-button>
            <el-button type="primary" :loading="drawingSaving" @click="saveDrawingRevision">
              {{ drawingForm.id ? '保存图纸' : '新增图纸' }}
            </el-button>
          </div>
        </div>

        <div class="applicability-list">
          <h3>已维护图纸</h3>
          <el-table v-loading="drawingLoading" :data="drawingRevisions" max-height="520">
            <el-table-column label="图纸" min-width="220">
              <template #default="{ row }">
                <div>{{ row.drawingNo }} / {{ row.drawingVersion }}</div>
                <div class="cell-subtext">{{ [row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ') || '-' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="默认" width="90">
              <template #default="{ row }">
                <el-tag v-if="row.isDefault" type="success" effect="plain">默认</el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="文件" min-width="180">
              <template #default="{ row }">{{ row.drawingFileName || row.drawingFileUrl || '-' }}</template>
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
                <el-button link type="primary" @click="editDrawingRevision(row)">编辑</el-button>
                <el-button v-if="!row.isDefault && row.status === 'ENABLED'" link type="success" @click="setDefaultDrawingRevision(row)">设默认</el-button>
                <el-button v-if="row.status === 'ENABLED'" link type="danger" @click="disableDrawingRevision(row)">停用</el-button>
                <el-button v-else link type="success" @click="enableDrawingRevision(row)">启用</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <p class="dialog-hint">
        图纸版本用于 BOM 默认图纸和订单下单快照。修改默认图纸不会覆盖历史订单里的图号、版本、日期或文件。
      </p>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref, type PropType } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { erpApi, type SaveMaterialDrawingRevisionPayload } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import { normalizeDisplayFileName } from '../utils/fileNames';
import type {
  CommonStatus,
  MaterialApplicability,
  MaterialDrawingRevision,
  MaterialImportIssue,
  MaterialImportSessionPreview,
  MaterialMemory
} from '../types/erp';

const router = useRouter();
const route = useRoute();
const ImportIssueList = defineComponent({
  props: {
    issues: {
      type: Array as PropType<MaterialImportIssue[]>,
      required: true
    }
  },
  setup(props) {
    return () =>
      props.issues.length
        ? h(
            'div',
            { class: 'issue-list' },
            props.issues.map((issue) =>
              h(
                'span',
                {
                  class: ['issue-pill', issue.severity === 'ERROR' ? 'is-error' : 'is-warning'],
                  title: issue.code
                },
                issue.message
              )
            )
          )
        : h('div', { class: 'check-ok' }, '可写入');
  }
});
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const importDialogVisible = ref(false);
const importUploading = ref(false);
const importCommitting = ref(false);
const importIssueReportDownloading = ref(false);
const materialImportDragging = ref(false);
const materialImportActiveTab = ref('materials');
const materialImportInput = ref<HTMLInputElement>();
const materialImportSession = ref<MaterialImportSessionPreview>();
const applicabilityDialogVisible = ref(false);
const applicabilityLoading = ref(false);
const applicabilitySaving = ref(false);
const drawingDialogVisible = ref(false);
const drawingLoading = ref(false);
const drawingSaving = ref(false);
const editingMaterialId = ref('');
const activeMaterial = ref<MaterialMemory>();
const materials = ref<MaterialMemory[]>([]);
const applicabilities = ref<MaterialApplicability[]>([]);
const drawingRevisions = ref<MaterialDrawingRevision[]>([]);
const routeActionApplied = ref(false);

const filters = reactive<{
  keyword: string;
  status: CommonStatus;
}>({
  keyword: '',
  status: 'ENABLED'
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
  remark: '',
  status: 'ENABLED'
});

const dialogTitle = computed(() => (editingMaterialId.value ? '编辑零件基础资料' : '新增零件基础资料'));
const applicabilityDialogTitle = computed(() =>
  activeMaterial.value ? `适用范围 - ${activeMaterial.value.partCode} / ${activeMaterial.value.partName}` : '适用范围'
);
const drawingDialogTitle = computed(() =>
  activeMaterial.value ? `图纸版本 - ${activeMaterial.value.partCode} / ${activeMaterial.value.partName}` : '图纸版本'
);
const enabledCount = computed(() => materials.value.filter((item) => item.status === 'ENABLED').length);
const disabledCount = computed(() => materials.value.filter((item) => item.status === 'DISABLED').length);
const materialImportCanCommit = computed(
  () =>
    Boolean(materialImportSession.value?.previewToken) &&
    materialImportSession.value?.status === 'DRAFT' &&
    (materialImportSession.value?.summary.rowCount || 0) > 0 &&
    (materialImportSession.value?.summary.errorCount || 0) === 0
);
const materialImportHasIssues = computed(() => {
  const session = materialImportSession.value;
  const issueCount = (session?.summary.errorCount || 0) + (session?.summary.warningCount || 0);
  return issueCount > 0;
});
const currentAvailableText = computed(() => {
  const totals = new Map<string, number>();
  materials.value.forEach((item) => {
    totals.set(item.unit, (totals.get(item.unit) || 0) + (item.availableQuantity || 0));
  });
  const text = [...totals.entries()].map(([unit, quantity]) => `${formatNumber(quantity)} ${unit}`).join(' / ');
  return text || '0';
});

onMounted(() => {
  applyRouteQueryFilters();
  void loadMaterials();
});

function routeQueryText(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
}

function applyRouteQueryFilters() {
  const keyword = routeQueryText(route.query.keyword);
  const status = routeQueryText(route.query.status);
  if (keyword) {
    filters.keyword = keyword;
  }
  if (status === 'ENABLED' || status === 'DISABLED') {
    filters.status = status;
  }
}

function displayMaterialImportFileName(fileName?: string | null) {
  return normalizeDisplayFileName(fileName) || '上传文件';
}

async function loadMaterials() {
  loading.value = true;
  try {
    materials.value = await erpApi.inventoryMaterials({
      keyword: filters.keyword.trim() || undefined,
      status: filters.status
    });
    await applyRouteActionAfterLoad();
  } finally {
    loading.value = false;
  }
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
  void loadMaterials();
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
  ElMessage.warning(`手机端仅查看零件基础资料，${actionLabel}请在电脑端操作`);
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

function openEditDialog(row: MaterialMemory) {
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
    await loadMaterials();
  } finally {
    saving.value = false;
  }
}

async function openImportDialog() {
  if (guardDesktopOperation('导入零件库')) {
    return;
  }
  importDialogVisible.value = true;
  if (!materialImportSession.value || materialImportSession.value.status !== 'DRAFT') {
    materialImportSession.value = await erpApi.createMaterialImportSession();
  }
}

function triggerMaterialImportFileInput() {
  if (guardDesktopOperation('上传零件库 Excel')) {
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
  } finally {
    importUploading.value = false;
  }
}

async function refreshMaterialImportSession() {
  if (!materialImportSession.value) {
    return;
  }
  materialImportSession.value = await erpApi.materialImportSession(materialImportSession.value.id);
}

async function downloadMaterialImportIssueReport() {
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
  materialImportSession.value = await erpApi.deleteMaterialImportFile(materialImportSession.value.id, fileId);
}

async function discardMaterialImport() {
  if (guardDesktopOperation('放弃导入')) {
    return;
  }
  if (!materialImportSession.value) {
    return;
  }
  await ElMessageBox.confirm('确认放弃本次零件库导入吗？已上传文件和预览行会删除，但不会影响已存在的零件库。', '放弃导入', {
    type: 'warning',
    confirmButtonText: '放弃',
    cancelButtonText: '取消'
  });
  await erpApi.discardMaterialImportSession(materialImportSession.value.id);
  materialImportSession.value = undefined;
  ElMessage.success('已放弃本次导入');
}

async function commitMaterialImport() {
  if (guardDesktopOperation('确认写入零件库')) {
    return;
  }
  if (!materialImportSession.value?.previewToken) {
    return;
  }
  await ElMessageBox.confirm(
    `确认写入零件库吗？将新增或更新 ${materialImportSession.value.summary.materialUpsertCount} 个零件、${materialImportSession.value.summary.drawingRevisionUpsertCount || 0} 条图纸版本、${materialImportSession.value.summary.applicabilityUpsertCount || 0} 条适用范围、${materialImportSession.value.summary.transformRuleUpsertCount || 0} 条来源加工关系。`,
    '确认导入',
    { type: 'warning', confirmButtonText: '确认写入', cancelButtonText: '取消' }
  );
  importCommitting.value = true;
  try {
    const result = await erpApi.commitMaterialImportSession(materialImportSession.value.id, materialImportSession.value.previewToken);
    ElMessage.success(
      `导入完成：新增 ${result.createdCount} 个，更新 ${result.updatedCount} 个，图纸版本 ${result.drawingRevisionUpsertCount || 0} 条，适用范围 ${result.applicabilityUpsertCount || 0} 条，来源关系 ${result.transformRuleUpsertCount || 0} 条`
    );
    materialImportSession.value = undefined;
    importDialogVisible.value = false;
    await loadMaterials();
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
  } finally {
    applicabilityLoading.value = false;
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
      remark: applicabilityForm.remark.trim() || undefined,
      status: applicabilityForm.status
    };
    if (applicabilityForm.id) {
      await erpApi.updateMaterialApplicability(applicabilityForm.id, payload);
      ElMessage.success('适用范围已保存');
    } else {
      await erpApi.saveMaterialApplicability(activeMaterial.value.id, payload);
      ElMessage.success('适用范围已新增');
    }
    resetApplicabilityForm();
    await loadApplicabilities();
  } finally {
    applicabilitySaving.value = false;
  }
}

async function disableApplicability(row: MaterialApplicability) {
  if (guardDesktopOperation('停用适用范围')) {
    return;
  }
  await erpApi.disableMaterialApplicability(row.id);
  ElMessage.success('适用范围已停用');
  await loadApplicabilities();
}

async function enableApplicability(row: MaterialApplicability) {
  if (guardDesktopOperation('启用适用范围')) {
    return;
  }
  await erpApi.updateMaterialApplicability(row.id, {
    customerId: row.customerId || undefined,
    projectModel: row.projectModel || undefined,
    remark: row.remark || undefined,
    status: 'ENABLED'
  });
  ElMessage.success('适用范围已启用');
  await loadApplicabilities();
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
  } finally {
    drawingLoading.value = false;
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
  drawingForm.remark = '';
  drawingForm.status = 'ENABLED';
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
  drawingForm.remark = row.remark || '';
  drawingForm.status = row.status;
}

function drawingRevisionPayload(overrides: Partial<SaveMaterialDrawingRevisionPayload> = {}): SaveMaterialDrawingRevisionPayload {
  return {
    drawingNo: drawingForm.drawingNo.trim(),
    drawingVersion: drawingForm.drawingVersion.trim(),
    drawingDate: drawingForm.drawingDate || undefined,
    drawingStatus: drawingForm.drawingStatus.trim() || undefined,
    drawingFileName: drawingForm.drawingFileName.trim() || undefined,
    drawingFileUrl: drawingForm.drawingFileUrl.trim() || undefined,
    isDefault: drawingForm.isDefault,
    defaultChangedBy: drawingForm.isDefault ? '系统操作员' : undefined,
    remark: drawingForm.remark.trim() || undefined,
    status: drawingForm.status,
    ...overrides
  };
}

async function saveDrawingRevision() {
  if (guardDesktopOperation('保存图纸版本')) {
    return;
  }
  if (!activeMaterial.value) {
    return;
  }
  if (!drawingForm.drawingNo.trim() || !drawingForm.drawingVersion.trim()) {
    ElMessage.warning('请填写图号和图纸版本');
    return;
  }
  drawingSaving.value = true;
  try {
    const payload = drawingRevisionPayload();
    if (drawingForm.id) {
      await erpApi.updateMaterialDrawingRevision(drawingForm.id, payload);
      ElMessage.success('图纸版本已保存');
    } else {
      await erpApi.saveMaterialDrawingRevision(activeMaterial.value.id, payload);
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
  await erpApi.updateMaterialDrawingRevision(row.id, {
    drawingNo: row.drawingNo,
    drawingVersion: row.drawingVersion,
    drawingDate: row.drawingDate || undefined,
    drawingStatus: row.drawingStatus || undefined,
    drawingFileName: row.drawingFileName || undefined,
    drawingFileUrl: row.drawingFileUrl || undefined,
    isDefault: true,
    defaultChangedBy: '系统操作员',
    remark: row.remark || undefined,
    status: 'ENABLED'
  });
  ElMessage.success('默认图纸已更新');
  await loadDrawingRevisions();
}

async function disableDrawingRevision(row: MaterialDrawingRevision) {
  if (guardDesktopOperation('停用图纸版本')) {
    return;
  }
  await erpApi.disableMaterialDrawingRevision(row.id);
  ElMessage.success('图纸版本已停用');
  await loadDrawingRevisions();
}

async function enableDrawingRevision(row: MaterialDrawingRevision) {
  if (guardDesktopOperation('启用图纸版本')) {
    return;
  }
  await erpApi.updateMaterialDrawingRevision(row.id, {
    drawingNo: row.drawingNo,
    drawingVersion: row.drawingVersion,
    drawingDate: row.drawingDate || undefined,
    drawingStatus: row.drawingStatus || undefined,
    drawingFileName: row.drawingFileName || undefined,
    drawingFileUrl: row.drawingFileUrl || undefined,
    isDefault: row.isDefault,
    defaultChangedBy: row.isDefault ? '系统操作员' : undefined,
    remark: row.remark || undefined,
    status: 'ENABLED'
  });
  ElMessage.success('图纸版本已启用');
  await loadDrawingRevisions();
}

async function disableMaterial(row: MaterialMemory) {
  if (guardDesktopOperation('停用零件')) {
    return;
  }
  await ElMessageBox.confirm(
    `确定停用零件 ${row.partCode} / ${row.partName} 吗？系统只会停用基础资料，不会删除历史订单、库存和生产记录。`,
    '停用零件基础资料',
    { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' }
  );
  await erpApi.disableInventoryMaterial(row.id);
  ElMessage.success('零件基础资料已停用');
  await loadMaterials();
}

async function enableMaterial(row: MaterialMemory) {
  if (guardDesktopOperation('启用零件')) {
    return;
  }
  await erpApi.updateInventoryMaterial(row.id, { status: 'ENABLED' });
  ElMessage.success('零件基础资料已启用');
  await loadMaterials();
}

function formatQuantity(value: number | undefined, unit?: string) {
  return `${formatNumber(value || 0)} ${unit || ''}`.trim();
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

.material-library-alert {
  margin-bottom: 16px;
}

.dialog-hint {
  margin: 0;
  color: #64748b;
  line-height: 1.7;
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

.issue-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.issue-pill {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid #fed7aa;
  background: #fff7ed;
  color: #c2410c;
  font-size: 12px;
  line-height: 1.6;
}

.issue-pill.is-error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

.import-preview-tabs {
  margin-top: 8px;
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
}
</style>
