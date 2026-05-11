<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">订单总列表</h2>
      <div class="page-header-actions orders-page-header-actions">
        <el-button @click="openImportDialog">导入订单</el-button>
        <el-button type="primary" @click="openCreate">新增订单</el-button>
      </div>
    </div>

    <div class="mobile-order-paused">
      <el-alert
        title="手机端订单编辑和上传先暂停"
        description="订单新增、编辑、删除、取消和 Excel 导入请在电脑端操作。手机端当前不作为订单业务界面的开发范围。"
        type="info"
        :closable="false"
      />
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>订单日期</label>
        <DateRangeFilter v-model="dateRange" @change="handleOrderScopeChange" />
      </div>
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect v-model="filters.customerId" placeholder="全部客户" width="260px" @change="handleOrderScopeChange" />
      </div>
      <div class="filter-field">
        <label>订单</label>
        <OrderSelect
          v-model="filters.orderNo"
          :orders="orderOptions"
          placeholder="全部订单"
          width="320px"
          :disabled="orderOptions.length === 0"
          @change="loadOrders"
        />
      </div>
      <div class="filter-field">
        <label>订单状态</label>
        <el-select
          v-model="filters.orderStatuses"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="勾选订单状态"
          style="width: 210px"
        >
          <template #header>
            <el-checkbox
              class="select-all-checkbox"
              :model-value="allOrderStatusesChecked"
              :indeterminate="orderStatusesIndeterminate"
              @change="toggleAllOrderStatuses"
            >
              全部勾选
            </el-checkbox>
          </template>
          <el-option v-for="option in orderStatusOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>生产状态</label>
        <el-select
          v-model="filters.productionStatuses"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="勾选生产状态"
          style="width: 190px"
        >
          <template #header>
            <el-checkbox
              class="select-all-checkbox"
              :model-value="allProductionStatusesChecked"
              :indeterminate="productionStatusesIndeterminate"
              @change="toggleAllProductionStatuses"
            >
              全部勾选
            </el-checkbox>
          </template>
          <el-option
            v-for="option in productionStatusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="loadOrders">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <div class="table-card orders-table-card desktop-table">
      <el-table v-loading="loading" :data="orders" max-height="calc(100vh - 315px)" @row-dblclick="goDetail">
        <el-table-column label="订单号" min-width="190">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="210" />
        <el-table-column label="订单日期" width="130">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="130">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column prop="partCount" label="零件数" width="100" />
        <el-table-column label="客户订单数量" width="140">
          <template #default="{ row }">{{ formatOrderQuantity(row, 'totalQuantity') }}</template>
        </el-table-column>
        <el-table-column label="生产计划数量" width="140">
          <template #default="{ row }">{{ formatOrderQuantity(row, 'totalProductionPlanQuantity') }}</template>
        </el-table-column>
        <el-table-column label="订单状态" width="160">
          <template #default="{ row }">
            <StatusTag :value="orderDisplayStatus(row)" />
          </template>
        </el-table-column>
        <el-table-column label="生产状态" width="130">
          <template #default="{ row }">
            <StatusTag :value="orderProductionStatusValue(row)" :label-override="orderProductionStatusLabel(row)" compact />
          </template>
        </el-table-column>
        <el-table-column label="待补单" width="150">
          <template #default="{ row }">
            <el-button v-if="orderNeedsShortageAttention(row)" link type="warning" @click.stop="goShortageDetail(row)">
              {{ orderShortageActionText(row) }}
            </el-button>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goProcess(row)">{{ orderProcessActionText(row) }}</el-button>
            <el-button v-if="row.status === 'DRAFT'" link type="danger" @click.stop="openDeleteDraftOrder(row)">删除草稿</el-button>
            <el-tooltip :content="cancelOrderDisabledReason(row)" :disabled="canCancelOrder(row)" placement="top">
              <span class="action-tooltip-wrap">
                <el-button link type="danger" :disabled="!canCancelOrder(row)" @click.stop="openCancelOrder(row)">取消</el-button>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list">
      <article
        v-for="order in orders"
        :key="order.id"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileOrderExpanded(order.id) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong><OrderNoLink :order-no="order.orderNo" /></strong>
            <small>{{ order.customerName }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <StatusTag :value="orderDisplayStatus(order)" compact />
            <el-button link type="primary" @click.stop="toggleMobileOrderCard(order.id)">
              {{ isMobileOrderExpanded(order.id) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>交期 {{ formatDate(order.deliveryDate) }}</span>
          <span>零件 {{ order.partCount }} 个</span>
          <span>{{ formatOrderQuantity(order, 'totalProductionPlanQuantity') }}</span>
        </div>
        <div v-show="isMobileOrderExpanded(order.id)" class="mobile-card-fields">
          <div class="mobile-field">
            <label>订单状态</label>
            <span><StatusTag :value="orderDisplayStatus(order)" compact /></span>
          </div>
          <div class="mobile-field">
            <label>生产状态</label>
            <span><StatusTag :value="orderProductionStatusValue(order)" :label-override="orderProductionStatusLabel(order)" compact /></span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(order.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(order.deliveryDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>零件数</label>
            <span>{{ order.partCount }} 个</span>
          </div>
          <div class="mobile-field">
            <label>客户订单数量</label>
            <span>{{ formatOrderQuantity(order, 'totalQuantity') }}</span>
          </div>
          <div class="mobile-field">
            <label>生产计划数量</label>
            <span>{{ formatOrderQuantity(order, 'totalProductionPlanQuantity') }}</span>
          </div>
          <div v-if="orderNeedsShortageAttention(order)" class="mobile-field mobile-full warning">
            <label>待补单</label>
            <span>{{ orderShortageActionText(order) }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button link type="primary" @click="goDetail(order)">订单明细</el-button>
        </div>
      </article>
      <div v-if="!orders.length && !loading" class="mobile-empty">暂无订单</div>
    </div>

    <el-dialog v-model="dialogVisible" title="新增订单" width="min(1500px, calc(100vw - 32px))" class="responsive-dialog order-create-dialog">
      <el-form label-width="86px">
        <div class="order-form-grid">
          <el-form-item label="客户">
            <CustomerSelect v-model="orderForm.customerId" placeholder="选择客户" status="ENABLED" width="260px" />
          </el-form-item>
          <el-form-item label="订单号">
            <div class="order-no-field">
              <el-input v-model="orderForm.orderNo" placeholder="自动生成，可手工修改" @input="handleOrderNoInput" />
              <el-button :loading="generatingOrderNo" @click="generateOrderNo">自动生成</el-button>
            </div>
            <div
              v-if="orderNoCheckText"
              :class="['order-no-check', checkingOrderNo ? 'checking' : orderNoAvailable ? 'available' : 'duplicated']"
            >
              {{ orderNoCheckText }}
            </div>
          </el-form-item>
          <el-form-item label="订单周期">
            <div class="order-date-range-field">
              <DateRangeFilter
                v-model="orderDateRange"
                start-placeholder="订单日期"
                end-placeholder="交期"
                :clearable="false"
                width="320px"
                @change="handleOrderDateRangeChange"
              />
              <span class="order-duration-text">完成天数：{{ orderDurationDaysText }}</span>
            </div>
          </el-form-item>
        </div>

        <div class="dialog-subtitle">
          <div class="dialog-subtitle-title">
            <strong>订单零件</strong>
            <el-popover placement="right" trigger="click" width="430">
              <template #reference>
                <el-button
                  class="duplicate-help-button"
                  :icon="WarningFilled"
                  circle
                  text
                  aria-label="图纸重复规则说明"
                />
              </template>
              <div class="duplicate-help">
                <strong>图纸与图号使用说明</strong>
                <p>图号可能跨零件复用，但系统必须先提醒操作人员确认。</p>
                <p>如果不同零件编号出现相同图号，保存时会提示图号冲突，并列出两个零件的图号和版本号，需要确认后才能继续。</p>
                <p>如果上传了相同图纸文件名，上传时会先确认，并同时展示当前选择图纸和重复图纸或图纸打开入口。</p>
                <p>保存时仍会再次检查相同图纸文件名，作为最终兜底。</p>
                <p>保存时会同时检查当前订单和历史订单中的图号、图纸文件名，不能只依赖人工记忆。</p>
              </div>
            </el-popover>
          </div>
          <div class="dialog-subtitle-actions">
            <el-button size="small" @click="processDefinitionManagerVisible = true">标准工序维护</el-button>
            <el-button size="small" @click="addLine">新增零件</el-button>
          </div>
        </div>

        <OrderLineEditor
          :lines="orderForm.lines"
          :default-delivery-date="orderForm.deliveryDate"
          :customer-id="orderForm.customerId"
          :inventory-summary="inventorySummary"
          @remove="removeLine"
          @quantity-change="syncPlanQuantity"
        />
      </el-form>
      <template #footer>
        <div class="dialog-footer-actions">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="saveOrder">保存订单</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialogVisible" title="导入组件/零件清单订单" width="min(1500px, calc(100vw - 32px))" class="responsive-dialog order-import-dialog">
      <el-alert
        :title="orderImportNotice"
        type="info"
        :closable="false"
        class="mb-16"
      />
      <div class="import-toolbar">
        <input ref="importFileInput" type="file" accept=".xlsx" multiple class="hidden-file-input" @change="handleImportFileChange" />
        <el-button :loading="importTemplateDownloading" @click="downloadImportTemplate">下载上传模板</el-button>
        <el-button
          :disabled="!importPreview || importPreview.summary.errorCount + importPreview.summary.warningCount === 0"
          :loading="importIssueReportDownloading"
          @click="downloadImportIssueReport"
        >
          下载问题明细
        </el-button>
        <el-button type="primary" :loading="importUploading || importSessionCreating" @click="selectImportFile">
          上传 ERP上传净表
        </el-button>
        <el-button :disabled="!importPreview" :loading="importPreviewLoading" @click="refreshImportPreview">刷新预览</el-button>
        <el-button :loading="importSessionsLoading" @click="loadImportSessionHistory">刷新导入记录</el-button>
        <el-button
          type="danger"
          plain
          :disabled="!importPreview || importPreview.status !== 'DRAFT'"
          :loading="importDiscarding"
          @click="discardImportSession"
        >
          放弃本次导入
        </el-button>
        <el-button
          type="success"
          :disabled="!canCommitImport"
          :loading="importCommitting"
          @click="commitImportSession"
        >
          创建已勾选草稿订单
        </el-button>
        <el-button
          type="success"
          plain
          :disabled="!canCommitAllImportSelectable"
          :loading="importCommittingAll"
          @click="commitAllImportSelectableOrders"
        >
          创建全部可导入草稿
        </el-button>
      </div>
      <div
        class="import-drop-zone"
        :class="{ 'is-uploading': importUploading || importSessionCreating, 'is-drag-over': importDragActive }"
        role="button"
        tabindex="0"
        @click="selectImportFile"
        @keydown.enter.prevent="selectImportFile"
        @keydown.space.prevent="selectImportFile"
        @dragenter.prevent="handleImportDragEnter"
        @dragover.prevent="handleImportDragOver"
        @dragleave.prevent="handleImportDragLeave"
        @drop.prevent="handleImportFileDrop"
      >
        <strong>拖拽 ERP上传净表 .xlsx 到这里</strong>
        <span>支持一次拖入多个文件，也可以继续上传到当前导入会话；只读取名为 ERP上传净表 的工作表。</span>
      </div>
      <div v-if="importSessionHistory.length" class="import-history-list">
        <article
          v-for="session in importSessionHistory"
          :key="session.id"
          class="import-history-item"
          :class="{ 'is-active': importPreview?.id === session.id }"
        >
          <div>
            <strong>
              {{ importSessionStatusLabel(session.status) }} / {{ session.orderCount }} 个订单 / {{ session.rowCount }} 行
              <el-tag v-if="importPreview?.id === session.id" size="small" type="primary" effect="plain">当前打开</el-tag>
            </strong>
            <span>
              {{ formatDateTime(session.committedAt || session.createdAt) }}
              <template v-if="session.orderCount"> / {{ importOrderNosSummary(session) }}</template>
            </span>
            <span v-if="importSessionValidationSummary(session)">{{ importSessionValidationSummary(session) }}</span>
            <span v-if="session.status === 'COMMITTED'">
              现存订单：{{ importCurrentCommittedOrderNosSummary(session) }}
              <template v-if="session.committedOrderCount && session.currentCommittedOrderCount !== session.committedOrderCount">
                / 提交时生成 {{ session.committedOrderCount }} 个
              </template>
            </span>
            <span v-if="session.fileCount">{{ importFileNamesSummary(session) }}</span>
          </div>
          <div class="import-history-actions">
            <el-button
              link
              type="primary"
              :loading="importSessionOpeningId === session.id"
              @click="openImportSessionFromHistory(session)"
            >
              {{ session.status === 'DRAFT' ? '继续上传' : '查看记录' }}
            </el-button>
            <el-button
              link
              type="danger"
              :loading="importSessionDeletingId === session.id"
              @click="deleteImportSessionMemory(session)"
            >
              {{ session.status === 'DRAFT' ? '放弃' : '删除记录' }}
            </el-button>
          </div>
        </article>
      </div>
      <div v-if="importSessionHistory.length || importSessionHistoryTotal > 0" class="import-history-footer">
        <span>已显示 {{ importSessionHistory.length }} / {{ importSessionHistoryTotal }} 条导入记录</span>
        <el-button
          v-if="importSessionHistoryHasMore"
          size="small"
          :loading="importSessionsLoading"
          @click="loadMoreImportSessionHistory"
        >
          加载更多
        </el-button>
      </div>
      <div v-if="importPreview" class="import-summary">
        <div>
          <strong>{{ importPreview.summary.orderCount }}</strong>
          <span>订单</span>
        </div>
        <div>
          <strong>{{ importPreview.summary.selectableOrderCount }}</strong>
          <span>可导入订单</span>
        </div>
        <div>
          <strong class="danger">{{ importPreview.summary.blockedOrderCount }}</strong>
          <span>不可导入订单</span>
        </div>
        <div>
          <strong>{{ importPreview.summary.rowCount }}</strong>
          <span>明细行</span>
        </div>
        <div>
          <strong class="danger">{{ importPreview.summary.errorCount }}</strong>
          <span>错误</span>
        </div>
        <div>
          <strong class="warning">{{ importPreview.summary.warningCount }}</strong>
          <span>警告</span>
        </div>
        <div>
          <strong>{{ importPreview.summary.duplicateRowCount }}</strong>
          <span>重复行</span>
        </div>
        <div :title="materialSyncPreviewText(importPreview.summary.materialSyncPreview, importPreview.summary.materialSyncCount)">
          <strong>{{ importPreview.summary.materialSyncCount }}</strong>
          <span>预计同步物料</span>
        </div>
        <div v-if="importPreview.status === 'COMMITTED'">
          <strong>{{ importPreview.summary.currentCommittedOrderCount || 0 }}</strong>
          <span>现存订单</span>
        </div>
        <div>
          <strong>{{ selectedValidImportOrderNos.length }}</strong>
          <span>已勾选订单</span>
        </div>
      </div>
      <div v-if="importPreview" class="import-selection-actions">
        <span>
          全部可导入 {{ importPreview.summary.selectableOrderCount }} 个；不可导入
          {{ importPreview.summary.blockedOrderCount }} 个；当前页可导入 {{ visibleSelectableImportOrderCount }} 个，已勾选
          {{ selectedValidImportOrderNos.length }} 个
        </span>
        <div>
          <el-button
            size="small"
            :disabled="importPreview.status !== 'DRAFT' || visibleSelectableImportOrderCount === 0"
            @click="selectAllValidImportOrders"
          >
            勾选当前页可导入
          </el-button>
          <el-button
            size="small"
            type="primary"
            plain
            :disabled="importPreview.status !== 'DRAFT' || importPreview.summary.orderCount === 0"
            :loading="importSelectingAllOrders"
            @click="selectAllImportSelectableOrders"
          >
            勾选全部可导入
          </el-button>
          <el-button size="small" :disabled="selectedValidImportOrderNos.length === 0" @click="clearImportOrderSelection">
            清空勾选
          </el-button>
        </div>
      </div>
      <div v-if="importPreview?.files.length" class="import-file-list">
        <article v-for="file in importPreview.files" :key="file.id" class="import-file-item">
          <div>
            <strong>{{ displayImportFileName(file.fileName) }}</strong>
            <span>
              {{ file.sheetName }} / 明细 {{ file.rowCount }} 行 / 已读取 {{ file.acceptedRowCount }} 行 / 重复
              {{ file.duplicateRowCount }} 行
            </span>
          </div>
          <div class="import-file-actions">
            <el-button link type="primary" :loading="importFilePreviewLoadingId === file.id" @click="openImportFilePreview(file.id)">
              预览文件
            </el-button>
            <el-button
              link
              type="danger"
              :disabled="importPreview.status !== 'DRAFT'"
              :loading="importFileDeletingId === file.id"
              @click="deleteImportFile(file.id)"
            >
              删除文件
            </el-button>
          </div>
        </article>
      </div>
      <el-table
        v-if="importPreview"
        ref="importPreviewTable"
        :data="importPreview.orders"
        row-key="orderNo"
        max-height="520"
        class="import-preview-table"
        @selection-change="handleImportOrderSelectionChange"
      >
        <el-table-column type="selection" width="48" :selectable="isImportOrderSelectable" />
        <el-table-column type="expand">
          <template #default="{ row }">
            <el-table :data="row.rows" size="small" class="import-line-table">
              <el-table-column prop="importSequence" label="序号" width="90" />
              <el-table-column label="行类型" width="90">
                <template #default="{ row: line }">{{ line.lineType === 'COMPONENT' ? '组件' : '零件' }}</template>
              </el-table-column>
              <el-table-column prop="partCategory" label="零件类型" width="100" />
              <el-table-column prop="componentNo" label="组件编号" width="110" />
              <el-table-column prop="parentComponentNo" label="所属组件" width="110" />
              <el-table-column prop="partCode" label="物料号" min-width="140" />
              <el-table-column prop="drawingNo" label="图号" min-width="170" />
              <el-table-column prop="partName" label="产品名称" min-width="160" />
              <el-table-column prop="partThickness" label="厚度" width="90" />
              <el-table-column label="需求数量" width="120">
                <template #default="{ row: line }">{{ formatQuantity(line.demandQuantity, line.unit) }}</template>
              </el-table-column>
              <el-table-column prop="processRoute" label="工艺路线" min-width="180" />
              <el-table-column label="校验" min-width="240">
                <template #default="{ row: line }">
                  <div v-if="line.issues.length" class="import-issues">
                    <el-tag
                      v-for="issue in line.issues"
                      :key="`${line.id}-${issue.code}-${issue.message}`"
                      :type="issue.severity === 'ERROR' ? 'danger' : 'warning'"
                      effect="plain"
                    >
                      {{ issue.message }}
                    </el-tag>
                  </div>
                  <span v-else class="muted">通过</span>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </el-table-column>
        <el-table-column prop="orderNo" label="订单编号" min-width="180" />
        <el-table-column prop="orderDate" label="制单日期" width="120" />
        <el-table-column prop="customerName" label="客户" min-width="220" />
        <el-table-column prop="projectModel" label="项目型号" width="120" />
        <el-table-column prop="rowCount" label="明细行" width="90" />
        <el-table-column label="状态" min-width="230">
          <template #default="{ row }">
            <div class="import-order-status">
              <div class="import-status-tags">
                <el-tag v-if="row.errorCount" type="danger" effect="plain">{{ row.errorCount }} 个错误</el-tag>
                <el-tag v-if="row.warningCount" type="warning" effect="plain">{{ row.warningCount }} 个警告</el-tag>
                <el-tag v-if="!row.errorCount && !row.warningCount" type="success" effect="plain">可导入</el-tag>
              </div>
              <div v-if="importOrderIssueSummary(row).length" class="import-order-issue-summary">
                <span v-for="message in importOrderIssueSummary(row)" :key="message">{{ message }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="importPreview" class="import-preview-footer">
        <span>已显示 {{ importPreview.orders.length }} / {{ importPreview.orderPage?.totalCount || importPreview.summary.orderCount }} 个订单预览</span>
        <el-button
          v-if="importPreview.orderPage?.hasMore"
          size="small"
          :loading="importPreviewLoading"
          @click="loadMoreImportPreviewOrders"
        >
          加载更多订单预览
        </el-button>
      </div>
      <el-empty v-else description="请上传包含 ERP上传净表 的 .xlsx 文件" />
      <template #footer>
        <div class="dialog-footer-actions">
          <el-button @click="importDialogVisible = false">关闭</el-button>
          <el-button
            type="danger"
            plain
            :disabled="!importPreview || importPreview.status !== 'DRAFT'"
            :loading="importDiscarding"
            @click="discardImportSession"
          >
            放弃本次导入
          </el-button>
          <el-button type="success" :disabled="!canCommitImport" :loading="importCommitting" @click="commitImportSession">
            创建已勾选草稿订单
          </el-button>
          <el-button
            type="success"
            plain
            :disabled="!canCommitAllImportSelectable"
            :loading="importCommittingAll"
            @click="commitAllImportSelectableOrders"
          >
            创建全部可导入草稿
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="processDefinitionManagerVisible"
      title="标准工序维护"
      width="min(900px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
    >
      <ProcessDefinitionManager
        title="订单页面标准工序"
        hint="这里维护下单和补单后可选的标准工序；重复工序名称会被系统拦截。"
      />
    </el-dialog>

    <el-dialog v-model="cancelOrderVisible" title="取消订单" width="min(980px, calc(100vw - 32px))" class="responsive-dialog">
      <el-alert
        title="正常订单和补单订单都可以取消。未开始生产的订单会删除未开工任务并释放库存；已开始生产的订单会同步通知生产和仓库处理已生产物料。"
        type="warning"
        :closable="false"
        class="mb-16"
      />
      <el-form label-width="116px">
        <el-form-item label="订单号">
          <strong>{{ activeCancelOrder?.orderNo }}</strong>
        </el-form-item>
        <el-form-item label="客户">
          <span>{{ activeCancelOrder?.customerName }}</span>
        </el-form-item>
        <el-form-item label="订单状态">
          <StatusTag v-if="activeCancelOrder" :value="orderDisplayStatus(activeCancelOrder)" />
        </el-form-item>
        <el-form-item label="取消日期">
          <el-input v-model="cancelOrderForm.cancelAt" disabled />
          <div class="form-hint">提交时由系统自动记录，操作人员不需要手工回填。</div>
        </el-form-item>
        <el-form-item label="生产状态" required>
          <el-radio-group v-model="cancelOrderForm.productionCancelState">
            <el-radio-button value="NOT_PRODUCED">未生产取消</el-radio-button>
            <el-radio-button value="PRODUCED">已生产取消</el-radio-button>
          </el-radio-group>
          <div class="form-hint">必须人工选择。若已生产，系统会同步通知仓库逐项确认转库存或报废。</div>
        </el-form-item>
        <div v-if="cancelOrderForm.productionCancelState === 'PRODUCED'" class="cancel-handling-section">
          <div class="cancel-handling-title">
            <strong>已生产零件处理计划</strong>
            <span>仓库确认时仍可修改，最终以仓库实物清点为准。</span>
          </div>
          <div v-if="cancelHandlingPlanRows.length" class="cancel-handling-list">
            <article v-for="row in cancelHandlingPlanRows" :key="row.productionTaskNo" class="cancel-handling-row">
              <div class="cancel-handling-main">
                <strong>{{ row.partCode }} / {{ row.partName }}</strong>
                <span>{{ row.productionTaskNo }}，已完成 {{ formatQuantity(row.completedQuantity, row.unit) }} / 计划 {{ formatQuantity(row.plannedQuantity, row.unit) }}</span>
              </div>
              <el-radio-group v-model="row.handlingMode" @change="handleCancelHandlingModeChange(row)">
                <el-radio-button value="STOCK">转库存</el-radio-button>
                <el-radio-button value="SCRAP">报废</el-radio-button>
                <el-radio-button value="NONE">无实物</el-radio-button>
              </el-radio-group>
              <el-input-number
                v-model="row.handlingQuantity"
                :min="0"
                :max="Math.max(row.completedQuantity, row.plannedQuantity)"
                :precision="3"
                :controls="false"
                class="cancel-handling-quantity"
                :disabled="row.handlingMode === 'NONE'"
              />
              <el-input v-model="row.remark" maxlength="120" show-word-limit placeholder="处理说明，可修改" />
            </article>
          </div>
          <el-alert v-else title="该订单未发现已开始生产的零件；请选择“未生产取消”或刷新订单后重试。" type="warning" :closable="false" />
        </div>
        <el-form-item label="管理人员" required>
          <el-input v-model="cancelOrderForm.managerName" placeholder="填写管理人员姓名" />
        </el-form-item>
        <el-form-item label="取消原因" required>
          <el-input v-model="cancelOrderForm.reason" type="textarea" :rows="4" placeholder="例如：客户取消、重复下单、项目暂停" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer-actions">
          <el-button @click="cancelOrderVisible = false">返回</el-button>
          <el-button type="danger" :loading="saving" @click="saveCancelOrder">确认取消订单</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="deleteDraftVisible" title="删除草稿订单" width="min(560px, calc(100vw - 32px))" class="responsive-dialog">
      <el-alert
        title="只允许删除未提交生产、未产生生产和库存记录的草稿订单。删除后会释放该草稿订单的订单号，可修正 Excel 后重新导入。"
        type="warning"
        :closable="false"
        class="mb-16"
      />
      <div v-if="activeDeleteDraftOrder" class="delete-draft-summary">
        <div><span>订单号</span><strong>{{ activeDeleteDraftOrder.orderNo }}</strong></div>
        <div><span>客户</span><strong>{{ activeDeleteDraftOrder.customerName }}</strong></div>
        <div><span>零件数</span><strong>{{ activeDeleteDraftOrder.partCount }} 个</strong></div>
      </div>
      <template #footer>
        <div class="dialog-footer-actions">
          <el-button @click="deleteDraftVisible = false">取消</el-button>
          <el-button type="danger" :loading="saving" @click="deleteDraftOrder">确认删除草稿</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="importFilePreviewVisible"
      title="上传文件预览"
      width="min(1280px, calc(100vw - 32px))"
      class="responsive-dialog"
    >
      <div v-loading="importFilePreviewLoading" class="import-file-preview-panel">
        <template v-if="importFilePreview">
          <div class="import-file-preview-header">
            <div>
              <strong>{{ displayImportFileName(importFilePreview.file.fileName) }}</strong>
              <span>
                {{ importFilePreview.file.sheetName || 'ERP上传净表' }} /
                已读取 {{ importFilePreview.file.acceptedRowCount }} 行 /
                原文件 {{ importFilePreview.file.rowCount }} 行 /
                重复 {{ importFilePreview.file.duplicateRowCount }} 行
              </span>
            </div>
            <a v-if="importFilePreview.file.fileUrl" :href="importFilePreview.file.fileUrl" target="_blank" rel="noreferrer">
              打开原 Excel
            </a>
          </div>
          <el-table :data="importFilePreview.rows" max-height="520" size="small" class="import-line-table">
            <el-table-column prop="sourceRowNo" label="Excel行" width="86" />
            <el-table-column prop="orderNo" label="订单编号" min-width="160" />
            <el-table-column prop="importSequence" label="序号" width="86" />
            <el-table-column label="行类型" width="90">
              <template #default="{ row }">{{ row.lineType === 'COMPONENT' ? '组件' : '零件' }}</template>
            </el-table-column>
            <el-table-column prop="partCategory" label="零件类型" width="100" />
            <el-table-column prop="componentNo" label="组件编号" width="110" />
            <el-table-column prop="parentComponentNo" label="所属组件" width="110" />
            <el-table-column prop="partCode" label="物料号" min-width="150" />
            <el-table-column prop="drawingNo" label="图号" min-width="150" />
            <el-table-column prop="partName" label="产品名称" min-width="160" />
            <el-table-column prop="partThickness" label="厚度" width="90" />
            <el-table-column label="数量" min-width="170">
              <template #default="{ row }">
                订单 {{ row.orderQuantity ?? '-' }} / 单套 {{ row.unitUsage ?? '-' }} / 需求
                {{ formatQuantity(row.demandQuantity, row.unit) }}
              </template>
            </el-table-column>
            <el-table-column prop="processRoute" label="工艺路线" min-width="170" />
            <el-table-column prop="processRemark" label="工艺备注" min-width="220" />
            <el-table-column label="校验" min-width="260">
              <template #default="{ row }">
                <div v-if="row.issues.length" class="import-issues">
                  <el-tag
                    v-for="issue in row.issues"
                    :key="`${row.id}-${issue.code}-${issue.message}`"
                    :type="issue.severity === 'ERROR' ? 'danger' : 'warning'"
                    effect="plain"
                  >
                    {{ issue.message }}
                  </el-tag>
                </div>
                <span v-else class="muted">通过</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="import-preview-footer">
            <span>
              已显示 {{ importFilePreview.rows.length }} /
              {{ importFilePreview.rowPage.totalCount }} 行文件预览
            </span>
            <el-button
              v-if="importFilePreview.rowPage.hasMore"
              size="small"
              :loading="importFilePreviewLoading"
              @click="loadMoreImportFilePreviewRows"
            >
              加载更多行
            </el-button>
          </div>
        </template>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { WarningFilled } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router';
import {
  erpApi,
  type CreateOrderLinePayload,
  type OrderImportConfigResponse,
  type OrderImportFilePreview,
  type OrderImportPreviewOrder,
  type OrderImportSessionSummary,
  type OrderImportSessionPreview,
  type OrderImportSelectableOrderNosResponse
} from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import OrderLineEditor from '../components/OrderLineEditor.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import OrderSelect from '../components/OrderSelect.vue';
import ProcessDefinitionManager from '../components/ProcessDefinitionManager.vue';
import StatusTag from '../components/StatusTag.vue';
import type {
  Customer,
  InventorySummaryRow,
  OrderDetail,
  OrderLine,
  OrderLineProductionTask,
  OrderProductionFilterStatus,
  OrderStatus,
  OrderSummary
} from '../types/erp';
import { normalizeDisplayFileName } from '../utils/fileNames';
import { formatDate, formatDateTime, formatQuantity } from '../utils/format';
import {
  confirmDuplicateDrawingFiles,
  confirmDuplicateDrawingNos,
  confirmExistingDrawingFiles,
  confirmExistingDrawingNos
} from '../utils/orderLineDuplicateChecks';
import { validateStockModeLines } from '../utils/orderLineStockChecks';
import { orderDisplayStatus } from '../utils/orderStatus';
import {
  sanitizeOrderLinePayload,
  suggestedProductionPlanQuantity,
  validateDraftStockSourceLines
} from '../utils/stockSourceReview';

const router = useRouter();
const customers = ref<Customer[]>([]);
const orders = ref<OrderSummary[]>([]);
const orderOptions = ref<OrderSummary[]>([]);
const inventorySummary = ref<InventorySummaryRow[]>([]);
const dateRange = ref<string[]>([]);
const orderDateRange = ref<string[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const cancelOrderVisible = ref(false);
const deleteDraftVisible = ref(false);
const processDefinitionManagerVisible = ref(false);
const importDialogVisible = ref(false);
const importSessionCreating = ref(false);
const importTemplateDownloading = ref(false);
const importIssueReportDownloading = ref(false);
const importUploading = ref(false);
const importDragActive = ref(false);
const importDragDepth = ref(0);
const importPreviewLoading = ref(false);
const importCommitting = ref(false);
const importCommittingAll = ref(false);
const importDiscarding = ref(false);
const importSelectingAllOrders = ref(false);
const importFileDeletingId = ref('');
const importFilePreviewVisible = ref(false);
const importFilePreviewLoading = ref(false);
const importFilePreviewLoadingId = ref('');
const importFilePreview = ref<OrderImportFilePreview>();
const importSessionsLoading = ref(false);
const importSessionOpeningId = ref('');
const importSessionDeletingId = ref('');
const importPreview = ref<OrderImportSessionPreview>();
const importSessionHistory = ref<OrderImportSessionSummary[]>([]);
const importSessionHistoryPageSize = 20;
const importPreviewOrderPageSize = 50;
const importFilePreviewRowPageSize = 200;
const importSessionHistoryTotal = ref(0);
const importSessionHistoryHasMore = ref(false);
const importConfig = ref<OrderImportConfigResponse>();
const importFileInput = ref<HTMLInputElement>();
const importPreviewTable = ref();
const selectedImportOrderNos = ref<Set<string>>(new Set());
const allSelectableImportOrderNos = ref<Set<string> | null>(null);
const allSelectableImportOrderWarnings = ref<Map<string, number> | null>(null);
const selectedImportOrders = ref<OrderImportPreviewOrder[]>([]);
const activeCancelOrder = ref<OrderSummary>();
const activeCancelOrderDetail = ref<OrderDetail>();
const activeDeleteDraftOrder = ref<OrderSummary>();
const expandedMobileOrderIds = ref<string[]>([]);

const orderStatusOptions: Array<{ label: string; value: OrderStatus }> = [
  { label: '待提交生产', value: 'DRAFT' },
  { label: '待确认生产', value: 'SUBMITTED' },
  { label: '生产中', value: 'IN_PRODUCTION' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已取消', value: 'CANCELLED' }
];
const productionStatusOptions: Array<{ label: string; value: OrderProductionFilterStatus }> = [
  { label: '待提交生产', value: 'ORDER_DRAFT' },
  { label: '待确认生产', value: 'WAITING_PRODUCTION' },
  { label: '生产中', value: 'ORDER_IN_PRODUCTION' },
  { label: '已完成未发货', value: 'ORDER_COMPLETED_UNSHIPPED' },
  { label: '部分发货', value: 'PARTIAL_SHIPPED' },
  { label: '已完成发货', value: 'ORDER_SHIPPED_COMPLETED' },
  { label: '已取消', value: 'ORDER_CANCELLED' }
];

const filters = reactive<{
  customerId?: string;
  orderNo?: string;
  orderStatuses: OrderStatus[];
  productionStatuses: OrderProductionFilterStatus[];
}>({
  orderStatuses: orderStatusOptions.map((option) => option.value),
  productionStatuses: productionStatusOptions.map((option) => option.value)
});

const orderForm = reactive<{
  customerId: string;
  orderNo: string;
  orderDate: string;
  deliveryDate: string;
  lines: CreateOrderLinePayload[];
}>({
  customerId: '',
  orderNo: '',
  orderDate: '',
  deliveryDate: '',
  lines: []
});
const orderNoTouched = ref(false);
const generatingOrderNo = ref(false);
const checkingOrderNo = ref(false);
const orderNoAvailable = ref(false);
const orderNoCheckText = ref('');
const cancelOrderForm = reactive({
  cancelAt: '',
  managerName: '',
  productionCancelState: 'NOT_PRODUCED' as 'NOT_PRODUCED' | 'PRODUCED',
  reason: ''
});
type CancelHandlingMode = '' | 'STOCK' | 'SCRAP' | 'NONE';
type CancelHandlingPlanRow = {
  orderLineId: string;
  productionTaskNo: string;
  partCode: string;
  partName: string;
  plannedQuantity: number;
  completedQuantity: number;
  unit: string;
  handlingMode: CancelHandlingMode;
  handlingQuantity: number;
  remark: string;
};
const cancelHandlingPlanRows = ref<CancelHandlingPlanRow[]>([]);
let orderNoCheckTimer: ReturnType<typeof window.setTimeout> | undefined;
let orderNoCheckSequence = 0;
let syncingImportOrderSelection = false;

const activeCustomers = computed(() => customers.value.filter((item) => item.status === 'ENABLED'));
const allOrderStatusesChecked = computed(() => filters.orderStatuses.length === orderStatusOptions.length);
const orderStatusesIndeterminate = computed(
  () => filters.orderStatuses.length > 0 && filters.orderStatuses.length < orderStatusOptions.length
);
const allProductionStatusesChecked = computed(() => filters.productionStatuses.length === productionStatusOptions.length);
const productionStatusesIndeterminate = computed(
  () => filters.productionStatuses.length > 0 && filters.productionStatuses.length < productionStatusOptions.length
);
const orderDurationDaysText = computed(() => {
  if (!orderForm.orderDate || !orderForm.deliveryDate) {
    return '-';
  }
  const start = toDateOnly(orderForm.orderDate);
  const end = toDateOnly(orderForm.deliveryDate);
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (!Number.isFinite(diffDays)) {
    return '-';
  }
  return `${diffDays} 天`;
});
const canCommitImport = computed(
  () =>
    Boolean(importPreview.value) &&
    importPreview.value?.status === 'DRAFT' &&
    selectedValidImportOrderNos.value.length > 0
);
const canCommitAllImportSelectable = computed(
  () =>
    Boolean(importPreview.value) &&
    importPreview.value?.status === 'DRAFT' &&
    (importPreview.value?.summary.selectableOrderCount || 0) > 0
);
const orderImportNotice = computed(() => {
  const uploadLimitText = importConfig.value
    ? `单个文件最大 ${formatFileSize(importConfig.value.uploadMaxBytes)}。`
    : '正在读取单个文件上传上限。';
  return `导入只创建待提交生产的草稿订单；不会自动提交生产、不会占用库存、不会生成生产任务。创建草稿时会同步物料基础资料，但不会产生库存数量。只读取名为 ERP上传净表 的工作表，台账页不能直接上传。可一次多选或在同一会话连续上传多个 .xlsx 文件，${uploadLimitText}ERP上传净表明细必须连续，中间不能留空行。`;
});
const selectedValidImportOrderNos = computed(() => [...selectedImportOrderNos.value]);
const visibleSelectableImportOrderCount = computed(
  () => importPreview.value?.orders.filter((order) => isImportOrderSelectable(order)).length || 0
);

function newLine(index: number): CreateOrderLinePayload {
  return {
    lineType: 'PART',
    partCategory: '',
    componentNo: '',
    parentComponentNo: '',
    importSequence: '',
    partCode: `P-${Date.now().toString().slice(-4)}-${index + 1}`,
    partName: '',
    drawingNo: '',
    drawingVersion: 'A',
    drawingFileName: '',
    drawingFileUrl: '',
    partThickness: 1,
    partSpecification: '',
    quantity: 1,
    productionPlanQuantity: 1,
    fulfillmentMode: 'PRODUCTION',
    unit: '件',
    deliveryDate: '',
    processSteps: [],
    selectedStockSources: []
  };
}

function inheritedParentComponentNo(lines: CreateOrderLinePayload[]) {
  const previousLine = lines[lines.length - 1];
  if (!previousLine) {
    return '';
  }
  if (previousLine.lineType === 'COMPONENT') {
    return previousLine.componentNo?.trim().toUpperCase() || '';
  }
  return previousLine.parentComponentNo?.trim().toUpperCase() || '';
}

async function loadCustomers() {
  try {
    customers.value = await erpApi.customers();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户资料加载失败');
  }
}

async function loadOrders() {
  if (filters.orderStatuses.length === 0 || filters.productionStatuses.length === 0) {
    loading.value = false;
    orders.value = [];
    return;
  }
  loading.value = true;
  try {
    const rows = await erpApi.orders({
      customerId: filters.customerId,
      statuses: selectedOrderStatusesForQuery(),
      productionStatuses: selectedProductionStatusesForQuery(),
      dateFrom: dateRange.value[0],
      dateTo: dateRange.value[1]
    });
    // 订单下拉只在当前日期/客户范围内做本地缩小，不反向改变父页面的日期和客户筛选。
    orders.value = filters.orderNo ? rows.filter((item) => item.orderNo === filters.orderNo) : rows;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单列表加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadInventorySummary() {
  try {
    inventorySummary.value = await erpApi.inventorySummary({ status: 'AVAILABLE' });
    return true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '库存汇总加载失败');
    return false;
  }
}

async function loadOrderOptions() {
  try {
    orderOptions.value = await erpApi.orders({
      customerId: filters.customerId,
      dateFrom: dateRange.value[0],
      dateTo: dateRange.value[1]
    });

    if (filters.orderNo && !orderOptions.value.some((item) => item.orderNo === filters.orderNo)) {
      filters.orderNo = undefined;
    }
  } catch (error) {
    orderOptions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '订单选项加载失败');
  }
}

async function handleOrderScopeChange() {
  await loadOrderOptions();
  await loadOrders();
}

async function reset() {
  filters.customerId = undefined;
  filters.orderNo = undefined;
  filters.orderStatuses = orderStatusOptions.map((option) => option.value);
  filters.productionStatuses = productionStatusOptions.map((option) => option.value);
  dateRange.value = [];
  await loadOrderOptions();
  await loadOrders();
}

function toggleAllOrderStatuses(value: string | number | boolean) {
  filters.orderStatuses = value ? orderStatusOptions.map((option) => option.value) : [];
}

function toggleAllProductionStatuses(value: string | number | boolean) {
  filters.productionStatuses = value ? productionStatusOptions.map((option) => option.value) : [];
}

function selectedOrderStatusesForQuery() {
  if (filters.orderStatuses.length === orderStatusOptions.length) {
    return undefined;
  }
  return [...filters.orderStatuses];
}

function selectedProductionStatusesForQuery() {
  if (filters.productionStatuses.length === productionStatusOptions.length) {
    return undefined;
  }
  return [...filters.productionStatuses];
}

function orderProductionStatusValue(order: OrderSummary) {
  return orderDisplayStatus(order);
}

function orderProductionStatusLabel(order: OrderSummary) {
  void order;
  return undefined;
}

function formatOrderQuantity(order: OrderSummary, field: 'totalQuantity' | 'totalProductionPlanQuantity') {
  if (order.quantityByUnit?.length) {
    return order.quantityByUnit.map((row) => formatQuantity(row[field], row.unit)).join(' / ');
  }
  return formatQuantity(order[field], order.unit);
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '未知大小';
  }
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) {
    return `${Math.round(mb * 10) / 10}MB`;
  }
  return `${Math.ceil(bytes / 1024)}KB`;
}

function orderShortageActionText(order: OrderSummary) {
  if (order.needsProductionReplenishmentReview && !order.needsReplenishmentAction) {
    const quantityText = order.pendingProductionReplenishmentQuantityByUnit?.length
      ? order.pendingProductionReplenishmentQuantityByUnit.map((row) => formatQuantity(row.quantity, row.unit)).join('、')
      : formatQuantity(order.pendingProductionReplenishmentQuantity || 0, order.pendingProductionReplenishmentUnit || order.unit);
    return `生产报废补单待确认 ${order.pendingProductionReplenishmentLineCount || 0} 个 / ${quantityText}`;
  }
  const quantityText = order.unresolvedShortageQuantityByUnit?.length
    ? order.unresolvedShortageQuantityByUnit.map((row) => formatQuantity(row.quantity, row.unit)).join('、')
    : formatQuantity(order.unresolvedShortageQuantity || 0, order.unresolvedShortageUnit || order.unit);
  return `需补单 ${order.unresolvedShortageLineCount || 0} 个 / ${quantityText}`;
}

function orderNeedsShortageAttention(order: OrderSummary) {
  return Boolean(order.needsReplenishmentAction || order.needsProductionReplenishmentReview);
}

function isMobileOrderExpanded(orderId: string) {
  return expandedMobileOrderIds.value.includes(orderId);
}

function toggleMobileOrderCard(orderId: string) {
  expandedMobileOrderIds.value = isMobileOrderExpanded(orderId)
    ? expandedMobileOrderIds.value.filter((id) => id !== orderId)
    : [...expandedMobileOrderIds.value, orderId];
}

async function openCreate() {
  if (isMobileOrderWorkspacePaused()) {
    ElMessage.info('手机端订单新增先暂停，请在电脑端操作');
    return;
  }
  orderForm.customerId = activeCustomers.value[0]?.id || '';
  orderForm.orderNo = '';
  orderForm.orderDate = todayText();
  orderForm.deliveryDate = defaultDeliveryDate(orderForm.orderDate);
  syncOrderDateRangeFromForm();
  orderForm.lines = [newLine(0), newLine(1), newLine(2)];
  orderNoTouched.value = false;
  clearOrderNoCheck();
  if (!(await loadInventorySummary())) {
    return;
  }
  dialogVisible.value = true;
  await generateOrderNo();
}

async function ensureImportSession() {
  if (importPreview.value?.id && importPreview.value.status === 'DRAFT') {
    return importPreview.value.id;
  }
  importSessionCreating.value = true;
  try {
    importPreview.value = await erpApi.createOrderImportSession();
    clearImportOrderSelection();
    return importPreview.value.id;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入会话创建失败');
    return '';
  } finally {
    importSessionCreating.value = false;
  }
}

async function openImportDialog() {
  if (isMobileOrderWorkspacePaused()) {
    ElMessage.info('手机端订单上传先暂停，请在电脑端操作');
    return;
  }
  importDialogVisible.value = true;
  await Promise.all([loadImportConfig(), loadImportSessionHistory()]);
}

function isMobileOrderWorkspacePaused() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
}

async function loadImportConfig() {
  try {
    importConfig.value = await erpApi.orderImportConfig();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入配置读取失败');
  }
}

function importSessionStatusLabel(status: string) {
  if (status === 'DRAFT') {
    return '未提交';
  }
  if (status === 'COMMITTED') {
    return '已创建草稿';
  }
  return status;
}

function importOrderNosSummary(session: OrderImportSessionSummary) {
  const orderNos = session.orderNosPreview?.length ? session.orderNosPreview : session.orderNos;
  const totalCount = session.orderNoCount || session.orderCount || orderNos.length;
  if (!orderNos.length) {
    return '无订单';
  }
  const visibleOrderNos: string[] = [];
  for (const orderNo of orderNos) {
    if (visibleOrderNos.length >= 5) {
      break;
    }
    visibleOrderNos.push(orderNo);
  }
  const suffix = totalCount > visibleOrderNos.length ? ` 等 ${totalCount} 个订单` : '';
  return `${visibleOrderNos.join('、')}${suffix}`;
}

function importCurrentCommittedOrderNosSummary(session: OrderImportSessionSummary) {
  const orderNos = session.currentCommittedOrderNosPreview?.length
    ? session.currentCommittedOrderNosPreview
    : session.currentCommittedOrderNos || [];
  const totalCount = session.currentCommittedOrderCount ?? orderNos.length;
  if (!orderNos.length) {
    return '无现存订单';
  }
  const visibleOrderNos: string[] = [];
  for (const orderNo of orderNos) {
    if (visibleOrderNos.length >= 5) {
      break;
    }
    visibleOrderNos.push(orderNo);
  }
  const suffix = totalCount > visibleOrderNos.length ? ` 等 ${totalCount} 个订单` : '';
  return `${visibleOrderNos.join('、')}${suffix}`;
}

function displayImportFileName(fileName?: string | null) {
  return normalizeDisplayFileName(fileName);
}

function importFileNamesSummary(session: OrderImportSessionSummary) {
  const fileNames = session.fileNamesPreview?.length ? session.fileNamesPreview : session.fileNames;
  const totalCount = session.fileCount || fileNames.length;
  if (!fileNames.length) {
    return '无文件';
  }
  const visibleFileNames: string[] = [];
  for (const fileName of fileNames) {
    if (visibleFileNames.length >= 5) {
      break;
    }
    visibleFileNames.push(displayImportFileName(fileName));
  }
  const suffix = totalCount > visibleFileNames.length ? ` 等 ${totalCount} 个文件` : '';
  return `${visibleFileNames.join('、')}${suffix}`;
}

function importSessionValidationSummary(session: OrderImportSessionSummary) {
  const parts: string[] = [];
  if (typeof session.selectableOrderCount === 'number') {
    parts.push(`可导入 ${session.selectableOrderCount} 个`);
  }
  if (typeof session.blockedOrderCount === 'number') {
    parts.push(`不可导入 ${session.blockedOrderCount} 个`);
  }
  if (session.errorCount > 0) {
    parts.push(`错误 ${session.errorCount} 个`);
  }
  if (session.warningCount > 0) {
    parts.push(`警告 ${session.warningCount} 个`);
  }
  if (typeof session.materialSyncCount === 'number') {
    parts.push(`预计同步物料 ${session.materialSyncCount} 个${materialSyncPreviewSuffix(session.materialSyncPreview)}`);
  }
  return parts.join(' / ');
}

function materialSyncPreviewSuffix(preview?: string[]) {
  const visiblePreview = (preview || []).filter(Boolean);
  return visiblePreview.length > 0 ? `：${visiblePreview.join('、')}` : '';
}

function materialSyncPreviewText(preview: string[] | undefined, totalCount: number) {
  const suffix = materialSyncPreviewSuffix(preview);
  return suffix ? `预计同步 ${totalCount} 个物料基础资料${suffix}` : `预计同步 ${totalCount} 个物料基础资料`;
}

async function loadImportSessionHistory(options: { append?: boolean } = {}) {
  if (importSessionsLoading.value) {
    return;
  }
  const append = options.append === true;
  importSessionsLoading.value = true;
  try {
    const offset = append ? importSessionHistory.value.length : 0;
    const result = await erpApi.orderImportSessions(importSessionHistoryPageSize, offset);
    importSessionHistory.value = append ? [...importSessionHistory.value, ...result.items] : result.items;
    importSessionHistoryTotal.value = result.totalCount;
    importSessionHistoryHasMore.value = result.hasMore;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入记录加载失败');
  } finally {
    importSessionsLoading.value = false;
  }
}

async function loadMoreImportSessionHistory() {
  await loadImportSessionHistory({ append: true });
}

async function openImportSessionFromHistory(session: OrderImportSessionSummary) {
  if (
    importPreview.value?.id &&
    importPreview.value.id !== session.id &&
    importPreview.value.status === 'DRAFT' &&
    importPreview.value.summary.rowCount > 0
  ) {
    try {
      await ElMessageBox.confirm(
        '当前已有未提交的导入预览。切换记录不会删除数据，但会把当前弹窗切换到所选导入记录。',
        '切换导入记录',
        {
          confirmButtonText: '切换',
          cancelButtonText: '返回',
          type: 'warning'
        }
      );
    } catch {
      return;
    }
  }

  importSessionOpeningId.value = session.id;
  try {
    importPreview.value = await erpApi.orderImportSession(session.id, importPreviewOrderPageSize, 0);
    clearImportOrderSelection();
    if (importPreview.value.status === 'DRAFT') {
      await selectAllValidImportOrders();
    }
    ElMessage.success(session.status === 'DRAFT' ? '已切换到未提交导入，可继续上传' : '已打开导入记录');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入记录打开失败');
  } finally {
    importSessionOpeningId.value = '';
  }
}

function isImportOrderSelectable(order: OrderImportPreviewOrder) {
  return importPreview.value?.status === 'DRAFT' && order.errorCount === 0;
}

function importOrderIssueSummary(order: OrderImportPreviewOrder) {
  const messages: string[] = [];
  const pushMessage = (message?: string) => {
    const normalized = message?.trim();
    if (normalized && !messages.includes(normalized)) {
      messages.push(normalized);
    }
  };

  order.issues.forEach((issue) => pushMessage(issue.message));
  order.rows.forEach((line) => {
    const prefix = line.importSequence || `第 ${line.sourceRowNo} 行`;
    line.issues.forEach((issue) => pushMessage(`${prefix}：${issue.message}`));
  });

  const visibleMessages: string[] = [];
  for (const message of messages) {
    if (visibleMessages.length >= 3) {
      break;
    }
    visibleMessages.push(message);
  }
  if (messages.length > visibleMessages.length) {
    visibleMessages.push(`还有 ${messages.length - visibleMessages.length} 条问题，请展开查看`);
  }
  return visibleMessages;
}

function handleImportOrderSelectionChange(rows: OrderImportPreviewOrder[]) {
  const visibleSelectedOrders = rows.filter((order) => isImportOrderSelectable(order));
  selectedImportOrders.value = visibleSelectedOrders;
  if (syncingImportOrderSelection) {
    return;
  }
  const nextOrderNos = new Set(selectedImportOrderNos.value);
  const visibleOrderNos = new Set(importPreview.value?.orders.map((order) => order.orderNo) || []);
  visibleOrderNos.forEach((orderNo) => nextOrderNos.delete(orderNo));
  visibleSelectedOrders.forEach((order) => nextOrderNos.add(order.orderNo));
  selectedImportOrderNos.value = nextOrderNos;
}

async function selectAllValidImportOrders() {
  const orderNos = new Set(selectedImportOrderNos.value);
  importPreview.value?.orders
    .filter((order) => isImportOrderSelectable(order))
    .forEach((order) => orderNos.add(order.orderNo));
  await selectImportOrdersByNos(orderNos);
}

function cacheAllSelectableImportOrders(result: OrderImportSelectableOrderNosResponse) {
  const warningRows = result.orders || result.orderNos.map((orderNo) => ({ orderNo, warningCount: 0 }));
  const warningMap = new Map(warningRows.map((order) => [order.orderNo, order.warningCount || 0]));
  allSelectableImportOrderNos.value = new Set(result.orderNos);
  allSelectableImportOrderWarnings.value = warningMap;
  return warningMap;
}

async function selectAllImportSelectableOrders() {
  if (!importPreview.value?.id || importPreview.value.status !== 'DRAFT') {
    return;
  }
  importSelectingAllOrders.value = true;
  try {
    const result = await erpApi.orderImportSelectableOrderNos(importPreview.value.id);
    cacheAllSelectableImportOrders(result);
    await selectImportOrdersByNos(new Set(result.orderNos));
    const blockedText = result.blockedCount > 0 ? `，${result.blockedCount} 个订单有错误未勾选` : '';
    ElMessage.success(`已勾选 ${result.selectableCount} 个可导入订单${blockedText}`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '批量勾选失败');
  } finally {
    importSelectingAllOrders.value = false;
  }
}

async function selectImportOrdersByNos(orderNos: Set<string>) {
  await nextTick();
  const nextOrderNos = new Set(orderNos);
  if (allSelectableImportOrderNos.value) {
    for (const orderNo of [...nextOrderNos]) {
      if (!allSelectableImportOrderNos.value.has(orderNo)) {
        nextOrderNos.delete(orderNo);
      }
    }
  }
  importPreview.value?.orders.filter((order) => !isImportOrderSelectable(order)).forEach((order) => {
    nextOrderNos.delete(order.orderNo);
  });
  selectedImportOrderNos.value = nextOrderNos;
  const table = importPreviewTable.value;
  if (!table || !importPreview.value) {
    selectedImportOrders.value = [];
    return;
  }
  syncingImportOrderSelection = true;
  try {
    table.clearSelection?.();
    const visibleSelectedOrders = importPreview.value.orders.filter(
      (order) => nextOrderNos.has(order.orderNo) && isImportOrderSelectable(order)
    );
    visibleSelectedOrders.forEach((order) => {
      table.toggleRowSelection?.(order, true);
    });
    selectedImportOrders.value = visibleSelectedOrders;
  } finally {
    syncingImportOrderSelection = false;
  }
}

function clearImportOrderSelection() {
  selectedImportOrderNos.value = new Set();
  allSelectableImportOrderNos.value = null;
  allSelectableImportOrderWarnings.value = null;
  selectedImportOrders.value = [];
  importPreviewTable.value?.clearSelection?.();
}

async function syncImportSelectionAgainstSelectableOrders() {
  const selectedOrderNos = new Set(selectedValidImportOrderNos.value);
  if (!importPreview.value?.id || importPreview.value.status !== 'DRAFT' || selectedOrderNos.size === 0) {
    await selectImportOrdersByNos(selectedOrderNos);
    return selectedOrderNos;
  }
  const result = await erpApi.orderImportSelectableOrderNos(importPreview.value.id);
  const selectableOrderNos = new Set(result.orderNos);
  cacheAllSelectableImportOrders(result);
  const syncedOrderNos = new Set<string>();
  selectedOrderNos.forEach((orderNo) => {
    if (selectableOrderNos.has(orderNo)) {
      syncedOrderNos.add(orderNo);
    }
  });
  await selectImportOrdersByNos(syncedOrderNos);
  return syncedOrderNos;
}

function selectedImportWarningCount(orderNos?: Set<string>) {
  const selectedOrderNos = orderNos || new Set(selectedValidImportOrderNos.value);
  if (allSelectableImportOrderWarnings.value) {
    let warningCount = 0;
    selectedOrderNos.forEach((orderNo) => {
      warningCount += allSelectableImportOrderWarnings.value?.get(orderNo) || 0;
    });
    return warningCount;
  }
  return (
    importPreview.value?.orders
      .filter((order) => selectedOrderNos.has(order.orderNo))
      .reduce((sum, order) => sum + order.warningCount, 0) || 0
  );
}

async function confirmImportWarnings(warningCount: number, useAllSelectableCommit: boolean, excludedOrderCount = 0) {
  if (warningCount <= 0) {
    return true;
  }
  const scopeText = useAllSelectableCommit && excludedOrderCount === 0 ? '全部可导入订单' : '已勾选订单';
  try {
    await ElMessageBox.confirm(
      `${scopeText}仍有 ${warningCount} 个警告。系统可以先创建待提交生产草稿，但厚度、单位、工艺路线、图纸状态等警告内容必须在 ERP 草稿里复核后再提交生产。`,
      '导入警告复核',
      {
        confirmButtonText: '已知晓，继续创建草稿',
        cancelButtonText: '返回预览',
        type: 'warning'
      }
    );
    return true;
  } catch {
    return false;
  }
}

function mergeImportPreviewOrders(nextPreview: OrderImportSessionPreview) {
  if (!importPreview.value || importPreview.value.id !== nextPreview.id) {
    importPreview.value = nextPreview;
    return;
  }
  const existingOrderNos = new Set(importPreview.value.orders.map((order) => order.orderNo));
  const appendedOrders = nextPreview.orders.filter((order) => !existingOrderNos.has(order.orderNo));
  importPreview.value = {
    ...nextPreview,
    orders: [...importPreview.value.orders, ...appendedOrders],
    orderPage: nextPreview.orderPage
      ? {
          ...nextPreview.orderPage,
          loadedCount: importPreview.value.orders.length + appendedOrders.length
        }
      : nextPreview.orderPage
  };
}

async function downloadImportTemplate() {
  importTemplateDownloading.value = true;
  try {
    await erpApi.downloadOrderImportTemplate();
    ElMessage.success('上传模板已下载');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '上传模板下载失败');
  } finally {
    importTemplateDownloading.value = false;
  }
}

async function downloadImportIssueReport() {
  if (!importPreview.value?.id) {
    ElMessage.warning('请先上传 Excel 并生成导入预览');
    return;
  }
  importIssueReportDownloading.value = true;
  try {
    await erpApi.downloadOrderImportIssueReport(importPreview.value.id);
    ElMessage.success('问题明细已下载');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '问题明细下载失败');
  } finally {
    importIssueReportDownloading.value = false;
  }
}

async function selectImportFile() {
  if (importUploading.value || importSessionCreating.value) {
    ElMessage.warning('文件正在上传，请稍后再选择');
    return;
  }
  importFileInput.value?.click();
}

async function handleImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const selectedFiles = Array.from(input.files || []);
  input.value = '';
  await uploadImportFiles(selectedFiles);
}

function importDragHasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function resetImportDragState() {
  importDragDepth.value = 0;
  importDragActive.value = false;
}

function handleImportDragEnter(event: DragEvent) {
  if (!importDragHasFiles(event)) {
    return;
  }
  importDragDepth.value += 1;
  importDragActive.value = true;
}

function handleImportDragOver(event: DragEvent) {
  if (!importDragHasFiles(event)) {
    return;
  }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = importUploading.value || importSessionCreating.value ? 'none' : 'copy';
  }
  importDragActive.value = !importUploading.value && !importSessionCreating.value;
}

function handleImportDragLeave(event: DragEvent) {
  if (!importDragHasFiles(event)) {
    return;
  }
  importDragDepth.value = Math.max(importDragDepth.value - 1, 0);
  if (importDragDepth.value === 0) {
    importDragActive.value = false;
  }
}

async function handleImportFileDrop(event: DragEvent) {
  resetImportDragState();
  const selectedFiles = Array.from(event.dataTransfer?.files || []);
  await uploadImportFiles(selectedFiles);
}

async function uploadImportFiles(selectedFiles: File[]) {
  if (!selectedFiles.length) {
    return;
  }
  if (importUploading.value || importSessionCreating.value) {
    ElMessage.warning('文件正在上传，请稍后再继续上传');
    return;
  }
  const xlsxFiles = selectedFiles.filter((file) => displayImportFileName(file.name).toLowerCase().endsWith('.xlsx'));
  const skippedExtensionCount = selectedFiles.length - xlsxFiles.length;
  if (!xlsxFiles.length) {
    ElMessage.warning('订单导入只支持 .xlsx 文件');
    return;
  }
  if (!importConfig.value) {
    await loadImportConfig();
  }
  const uploadMaxBytes = importConfig.value?.uploadMaxBytes;
  const filesToUpload = xlsxFiles.filter((file) => !uploadMaxBytes || file.size <= uploadMaxBytes);
  const skippedSizeFiles = xlsxFiles.filter((file) => uploadMaxBytes && file.size > uploadMaxBytes);
  if (!filesToUpload.length) {
    const firstSkipped = skippedSizeFiles[0];
    ElMessage.warning(
      firstSkipped
        ? `文件超过上传上限：${displayImportFileName(firstSkipped.name)} 当前 ${formatFileSize(firstSkipped.size)}，单个文件最大 ${formatFileSize(uploadMaxBytes || 0)}`
        : '没有可上传的 .xlsx 文件'
    );
    return;
  }
  const hadDraftSession = Boolean(importPreview.value?.id && importPreview.value.status === 'DRAFT');
  const sessionId = await ensureImportSession();
  if (!sessionId) {
    return;
  }
  allSelectableImportOrderNos.value = null;
  allSelectableImportOrderWarnings.value = null;
  const createdEmptySessionForUpload = !hadDraftSession;
  const previousLoadedOrderNos = new Set(importPreview.value?.orders.map((order) => order.orderNo) || []);
  const previousSelectedOrderNos = new Set(selectedValidImportOrderNos.value);
  const nextSelectedOrderNos = new Set(previousSelectedOrderNos);
  const uploadSummaries: Array<{ fileName: string; acceptedRowCount: number; duplicateRowCount: number }> = [];
  const uploadFailures: Array<{ fileName: string; message: string }> = [];
  importUploading.value = true;
  try {
    for (const file of filesToUpload) {
      try {
        importPreview.value = await erpApi.uploadOrderImportFile(sessionId, file);
        const result = importPreview.value.uploadResult;
        uploadSummaries.push({
          fileName: displayImportFileName(file.name),
          acceptedRowCount: result?.acceptedRowCount || 0,
          duplicateRowCount: result?.duplicateRowCount || 0
        });
        importPreview.value.orders
          .filter((order) => !previousLoadedOrderNos.has(order.orderNo) && isImportOrderSelectable(order))
          .forEach((order) => nextSelectedOrderNos.add(order.orderNo));
      } catch (error) {
        uploadFailures.push({
          fileName: displayImportFileName(file.name),
          message: error instanceof Error ? error.message : 'Excel 文件上传失败'
        });
      }
    }

    if (importPreview.value) {
      await selectImportOrdersByNos(nextSelectedOrderNos);
    }
    await loadImportSessionHistory();

    const skippedTexts: string[] = [];
    if (skippedExtensionCount > 0) {
      skippedTexts.push(`跳过 ${skippedExtensionCount} 个非 .xlsx 文件`);
    }
    if (skippedSizeFiles.length > 0) {
      skippedTexts.push(`跳过 ${skippedSizeFiles.length} 个超限文件`);
    }
    if (uploadSummaries.length > 0) {
      const acceptedRowCount = uploadSummaries.reduce((sum, item) => sum + item.acceptedRowCount, 0);
      const duplicateRowCount = uploadSummaries.reduce((sum, item) => sum + item.duplicateRowCount, 0);
      const skippedText = skippedTexts.length ? `；${skippedTexts.join('；')}` : '';
      ElMessage.success(`已上传 ${uploadSummaries.length} 个文件，读取 ${acceptedRowCount} 行，重复 ${duplicateRowCount} 行${skippedText}`);
    }
    if (uploadFailures.length > 0) {
      const visibleFailures: string[] = [];
      for (const failure of uploadFailures) {
        if (visibleFailures.length >= 3) {
          break;
        }
        visibleFailures.push(`${displayImportFileName(failure.fileName)}：${failure.message}`);
      }
      const hiddenFailureText = uploadFailures.length > visibleFailures.length ? `；其余 ${uploadFailures.length - visibleFailures.length} 个请在导入记录中继续查看` : '';
      const failurePreview = `${visibleFailures.join('；')}${hiddenFailureText}`;
      ElMessage.error(`有 ${uploadFailures.length} 个文件上传失败：${failurePreview}`);
    } else if (!uploadSummaries.length && skippedTexts.length) {
      ElMessage.warning(skippedTexts.join('；'));
    }
  } finally {
    if (
      createdEmptySessionForUpload &&
      importPreview.value?.id === sessionId &&
      importPreview.value.status === 'DRAFT' &&
      importPreview.value.summary.rowCount === 0 &&
      uploadSummaries.length === 0
    ) {
      try {
        await erpApi.discardOrderImportSession(sessionId);
        importPreview.value = undefined;
        clearImportOrderSelection();
        await loadImportSessionHistory();
      } catch {
        // 上传失败后的空会话清理只是体验优化；真正错误仍以上传失败原因提示。
      }
    }
    importUploading.value = false;
  }
}

async function refreshImportPreview() {
  if (!importPreview.value?.id) {
    return;
  }
  const previousSelectedOrderNos = new Set(selectedValidImportOrderNos.value);
  allSelectableImportOrderNos.value = null;
  allSelectableImportOrderWarnings.value = null;
  importPreviewLoading.value = true;
  try {
    importPreview.value = await erpApi.orderImportSession(importPreview.value.id, importPreviewOrderPageSize, 0);
    await selectImportOrdersByNos(previousSelectedOrderNos);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入预览刷新失败');
  } finally {
    importPreviewLoading.value = false;
  }
}

async function loadMoreImportPreviewOrders() {
  if (!importPreview.value?.id || !importPreview.value.orderPage?.hasMore) {
    return;
  }
  const previousSelectedOrderNos = new Set(selectedValidImportOrderNos.value);
  importPreviewLoading.value = true;
  try {
    const nextPreview = await erpApi.orderImportSession(
      importPreview.value.id,
      importPreviewOrderPageSize,
      importPreview.value.orders.length
    );
    mergeImportPreviewOrders(nextPreview);
    nextPreview.orders.filter((order) => isImportOrderSelectable(order)).forEach((order) => {
      previousSelectedOrderNos.add(order.orderNo);
    });
    await selectImportOrdersByNos(previousSelectedOrderNos);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单预览加载失败');
  } finally {
    importPreviewLoading.value = false;
  }
}

async function openImportFilePreview(fileId: string) {
  if (!importPreview.value?.id) {
    return;
  }
  importFilePreviewVisible.value = true;
  importFilePreviewLoading.value = true;
  importFilePreviewLoadingId.value = fileId;
  try {
    importFilePreview.value = await erpApi.orderImportFilePreview(
      importPreview.value.id,
      fileId,
      importFilePreviewRowPageSize,
      0
    );
  } catch (error) {
    importFilePreviewVisible.value = false;
    ElMessage.error(error instanceof Error ? error.message : '上传文件预览失败');
  } finally {
    importFilePreviewLoading.value = false;
    importFilePreviewLoadingId.value = '';
  }
}

async function loadMoreImportFilePreviewRows() {
  if (!importPreview.value?.id || !importFilePreview.value?.file.id || !importFilePreview.value.rowPage.hasMore) {
    return;
  }
  importFilePreviewLoading.value = true;
  try {
    const nextPreview = await erpApi.orderImportFilePreview(
      importPreview.value.id,
      importFilePreview.value.file.id,
      importFilePreviewRowPageSize,
      importFilePreview.value.rows.length
    );
    importFilePreview.value = {
      ...nextPreview,
      rows: [...importFilePreview.value.rows, ...nextPreview.rows]
    };
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '上传文件预览加载失败');
  } finally {
    importFilePreviewLoading.value = false;
  }
}

async function deleteImportFile(fileId: string) {
  if (!importPreview.value?.id || importPreview.value.status !== 'DRAFT') {
    return;
  }
  const file = importPreview.value.files.find((item) => item.id === fileId);
  try {
    await ElMessageBox.confirm(
      `确定删除上传文件“${displayImportFileName(file?.fileName || fileId)}”吗？该文件带来的预览明细会从本次导入中移除。`,
      '删除上传文件',
      {
        confirmButtonText: '删除',
        cancelButtonText: '返回',
        type: 'warning'
      }
    );
  } catch {
    return;
  }

  importFileDeletingId.value = fileId;
  try {
    importPreview.value = await erpApi.deleteOrderImportFile(importPreview.value.id, fileId);
    if (importFilePreview.value?.file.id === fileId) {
      importFilePreview.value = undefined;
      importFilePreviewVisible.value = false;
    }
    allSelectableImportOrderNos.value = null;
    allSelectableImportOrderWarnings.value = null;
    const currentPageSelectableOrderNos = new Set(
      importPreview.value.orders.filter((order) => isImportOrderSelectable(order)).map((order) => order.orderNo)
    );
    await selectImportOrdersByNos(currentPageSelectableOrderNos);
    await loadImportSessionHistory();
    ElMessage.success('上传文件已从本次导入中删除');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '上传文件删除失败');
  } finally {
    importFileDeletingId.value = '';
  }
}

async function discardImportSession() {
  if (!importPreview.value?.id || importPreview.value.status !== 'DRAFT') {
    return;
  }
  try {
    await ElMessageBox.confirm('确定放弃本次导入预览吗？已上传但未创建草稿订单的 Excel 数据会被清空。', '放弃导入', {
      confirmButtonText: '放弃',
      cancelButtonText: '返回',
      type: 'warning'
    });
  } catch {
    return;
  }

  importDiscarding.value = true;
  try {
    await erpApi.discardOrderImportSession(importPreview.value.id);
    importPreview.value = undefined;
    clearImportOrderSelection();
    await loadImportSessionHistory();
    ElMessage.success('本次导入已放弃，可以重新上传 Excel');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入会话放弃失败');
  } finally {
    importDiscarding.value = false;
  }
}

async function commitImportSession() {
  if (!importPreview.value?.id) {
    ElMessage.warning('请先上传 Excel 文件');
    return;
  }
  if (!canCommitImport.value) {
    ElMessage.warning('请选择没有错误的订单后再创建草稿');
    return;
  }
  let syncedSelectedOrderNos: Set<string>;
  try {
    syncedSelectedOrderNos = await syncImportSelectionAgainstSelectableOrders();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入订单勾选状态同步失败');
    return;
  }
  if (syncedSelectedOrderNos.size === 0) {
    ElMessage.warning('已勾选的订单已不再可导入，请重新勾选');
    return;
  }
  const selectedCount = syncedSelectedOrderNos.size;
  const selectableCount = importPreview.value.summary.selectableOrderCount || 0;
  const selectedOrderNoSet = syncedSelectedOrderNos;
  const visibleSelectableCovered = importPreview.value.orders
    .filter((order) => isImportOrderSelectable(order))
    .every((order) => selectedOrderNoSet.has(order.orderNo));
  const allSelectableOrderNos = allSelectableImportOrderNos.value;
  const excludedOrderNos = allSelectableOrderNos
    ? [...allSelectableOrderNos].filter((orderNo) => !syncedSelectedOrderNos.has(orderNo))
    : [];
  const canUseAllSelectableEnvelope = Boolean(
    allSelectableOrderNos && allSelectableOrderNos.size === selectableCount && excludedOrderNos.length < selectedCount
  );
  const useAllSelectableCommit =
    selectedCount > 0 && canUseAllSelectableEnvelope && (excludedOrderNos.length > 0 || visibleSelectableCovered);
  const skippedSelectableCount = selectableCount - selectedCount;
  const blockedCount = importPreview.value.summary.blockedOrderCount || 0;
  if (skippedSelectableCount > 0 || blockedCount > 0) {
    const messages = [`当前共有 ${selectableCount} 个可导入订单，你勾选了 ${selectedCount} 个。`];
    if (skippedSelectableCount > 0) {
      messages.push(`另外 ${skippedSelectableCount} 个可导入订单不会在本次导入会话中创建。`);
    }
    if (blockedCount > 0) {
      messages.push(`${blockedCount} 个不可导入订单会被跳过，需修正 Excel 后重新上传。`);
    }
    try {
      await ElMessageBox.confirm(
        messages.join(''),
        '只创建已勾选订单',
        {
          confirmButtonText: '继续创建已勾选',
          cancelButtonText: '返回勾选',
          type: 'warning'
        }
      );
    } catch {
      return;
    }
  }
  if (importPreview.value.orderPage?.hasMore) {
    try {
      await ElMessageBox.confirm(
        `当前只显示了 ${importPreview.value.orders.length} / ${importPreview.value.orderPage.totalCount} 个订单预览。继续操作只会创建 ${selectedCount} 个已勾选订单，没有勾选的订单不会创建。`,
        '还有未加载订单',
        {
          confirmButtonText: '继续创建已选',
          cancelButtonText: '返回加载更多',
          type: 'warning'
        }
      );
    } catch {
      return;
    }
  }
  const warningCount = selectedImportWarningCount(syncedSelectedOrderNos);
  if (!(await confirmImportWarnings(warningCount, useAllSelectableCommit, excludedOrderNos.length))) {
    return;
  }
  importCommitting.value = true;
  try {
    const orderNos = [...syncedSelectedOrderNos];
    const previewToken = importPreview.value.previewToken;
    if (!previewToken) {
      ElMessage.warning('导入预览已过期，请刷新预览后再创建草稿');
      return;
    }
    const result = await erpApi.commitOrderImportSession(
      importPreview.value.id,
      useAllSelectableCommit ? [] : orderNos,
      previewToken,
      useAllSelectableCommit,
      useAllSelectableCommit ? excludedOrderNos : []
    );
    const previewText = result.createdOrdersTruncated ? `，返回前 ${result.createdOrdersPreviewCount} 个订单摘要` : '';
    const skippedSelectableText = result.skippedSelectableCount > 0 ? `，未创建 ${result.skippedSelectableCount} 个可导入订单` : '';
    const materialSyncText = `，同步 ${result.materialSyncCount || 0} 个物料基础资料${materialSyncPreviewSuffix(result.materialSyncPreview)}`;
    ElMessage.success(`已创建 ${result.createdCount} 个草稿订单${materialSyncText}${skippedSelectableText}${previewText}`);
    importPreview.value = undefined;
    clearImportOrderSelection();
    importDialogVisible.value = false;
    await loadImportSessionHistory();
    await loadOrderOptions();
    await loadOrders();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单导入提交失败');
  } finally {
    importCommitting.value = false;
  }
}

async function commitAllImportSelectableOrders() {
  if (!importPreview.value?.id) {
    ElMessage.warning('请先上传 Excel 文件');
    return;
  }
  if (!canCommitAllImportSelectable.value) {
    ElMessage.warning('当前没有可创建草稿的导入订单');
    return;
  }
  const skippedText =
    importPreview.value.summary.blockedOrderCount > 0
      ? `系统会跳过 ${importPreview.value.summary.blockedOrderCount} 个不可导入订单，当前共有 ${importPreview.value.summary.errorCount} 个错误。`
      : '';
  let selectableWarningCount = importPreview.value.summary.warningCount || 0;
  try {
    const selectableResult = await erpApi.orderImportSelectableOrderNos(importPreview.value.id);
    const warningMap = cacheAllSelectableImportOrders(selectableResult);
    selectableWarningCount = [...warningMap.values()].reduce((sum, count) => sum + count, 0);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '可导入订单统计同步失败');
    return;
  }
  try {
    if (!(await confirmImportWarnings(selectableWarningCount, true))) {
      return;
    }
    await ElMessageBox.confirm(
      `确定创建本次导入中 ${importPreview.value.summary.selectableOrderCount} 个可导入订单的草稿吗？该操作不依赖前端传入订单号列表，适合大批量导入。${skippedText}`,
      '创建全部可导入草稿',
      {
        confirmButtonText: '创建全部可导入',
        cancelButtonText: '返回',
        type: importPreview.value.summary.blockedOrderCount > 0 ? 'warning' : 'info'
      }
    );
  } catch {
    return;
  }

  importCommittingAll.value = true;
  try {
    const previewToken = importPreview.value.previewToken;
    if (!previewToken) {
      ElMessage.warning('导入预览已过期，请刷新预览后再创建草稿');
      return;
    }
    const result = await erpApi.commitOrderImportSession(importPreview.value.id, [], previewToken, true);
    const skippedText = result.skippedBlockedCount > 0 ? `，跳过 ${result.skippedBlockedCount} 个不可导入订单` : '';
    const skippedSelectableText = result.skippedSelectableCount > 0 ? `，未创建 ${result.skippedSelectableCount} 个可导入订单` : '';
    const previewText = result.createdOrdersTruncated ? `，返回前 ${result.createdOrdersPreviewCount} 个订单摘要` : '';
    const materialSyncText = `，同步 ${result.materialSyncCount || 0} 个物料基础资料${materialSyncPreviewSuffix(result.materialSyncPreview)}`;
    ElMessage.success(`已创建 ${result.createdCount} 个草稿订单${materialSyncText}${skippedSelectableText}${skippedText}${previewText}`);
    importPreview.value = undefined;
    clearImportOrderSelection();
    importDialogVisible.value = false;
    await loadImportSessionHistory();
    await loadOrderOptions();
    await loadOrders();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单导入提交失败');
  } finally {
    importCommittingAll.value = false;
  }
}

async function deleteImportSessionMemory(session: OrderImportSessionSummary) {
  const staleCommittedText =
    session.status === 'COMMITTED' && session.committedOrderCount && session.currentCommittedOrderCount !== session.committedOrderCount
      ? `提交时生成过 ${session.committedOrderCount} 个订单。`
      : '';
  const message =
    session.status === 'DRAFT'
      ? `确定放弃这次未提交导入吗？${session.fileCount} 个上传文件和 ${session.rowCount} 行预览会被清空。`
      : `确定删除这条导入记录吗？系统只会删除上传记忆和预览行，不会删除当前仍存在的订单：${importCurrentCommittedOrderNosSummary(session)}。${staleCommittedText}`;
  try {
    await ElMessageBox.confirm(message, session.status === 'DRAFT' ? '放弃导入' : '删除导入记录', {
      confirmButtonText: session.status === 'DRAFT' ? '放弃' : '删除记录',
      cancelButtonText: '返回',
      type: 'warning'
    });
  } catch {
    return;
  }

  importSessionDeletingId.value = session.id;
  try {
    await erpApi.discardOrderImportSession(session.id);
    if (importPreview.value?.id === session.id) {
      importPreview.value = undefined;
      clearImportOrderSelection();
    }
    await loadImportSessionHistory();
    ElMessage.success(session.status === 'DRAFT' ? '未提交导入已放弃' : '导入记录已删除，订单不受影响');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入记录删除失败');
  } finally {
    importSessionDeletingId.value = '';
  }
}

function addLine() {
  const line = newLine(orderForm.lines.length);
  line.parentComponentNo = inheritedParentComponentNo(orderForm.lines);
  orderForm.lines.push(line);
}

function removeLine(index: number) {
  // 默认仍创建三行零件，操作人员可删除误填行，但订单至少保留一行零件。
  if (orderForm.lines.length > 1) {
    orderForm.lines.splice(index, 1);
    return;
  }
  orderForm.lines = [newLine(0)];
  ElMessage.info('订单至少保留一行，已清空当前零件');
}

async function saveOrder() {
  if (!orderForm.customerId) {
    ElMessage.warning('请选择客户');
    return;
  }
  if (!orderForm.orderNo.trim()) {
    ElMessage.warning('请填写订单号');
    return;
  }
  if (orderForm.lines.length === 0) {
    ElMessage.warning('订单至少需要一个零件');
    return;
  }
  if (
    orderForm.lines.some(
      (line) =>
        !line.partCode ||
        !line.partName ||
        !line.partThickness ||
        !line.quantity ||
        (line.productionPlanQuantity === undefined || line.productionPlanQuantity === null) ||
        !line.unit
    )
  ) {
    ElMessage.warning('请补齐订单零件、厚度等必填信息');
    return;
  }
  if (!(await loadInventorySummary())) {
    return;
  }
  const stockCheck = validateStockModeLines(orderForm.lines, inventorySummary.value);
  if (!stockCheck.ok) {
    ElMessage.warning(`待提交生产订单可先保存；${stockCheck.message}，提交生产前必须补足`);
  }
  const draftStockCheck = validateDraftStockSourceLines(orderForm.lines);
  if (!draftStockCheck.ok) {
    ElMessage.warning(draftStockCheck.message);
    return;
  }
  if (draftStockCheck.warning) {
    ElMessage.warning(draftStockCheck.warning);
  }
  if (!(await confirmDuplicateDrawingNos(orderForm.lines))) {
    return;
  }
  if (!(await confirmDuplicateDrawingFiles(orderForm.lines))) {
    return;
  }
  if (!(await confirmExistingDrawingNos(orderForm.lines))) {
    return;
  }
  if (!(await confirmExistingDrawingFiles(orderForm.lines))) {
    return;
  }
  if (!(await checkOrderNo(true))) {
    ElMessage.error(orderNoCheckText.value || '订单号已存在，不能保存');
    return;
  }

  saving.value = true;
  try {
    const order = await erpApi.createOrder({
      customerId: orderForm.customerId,
      orderNo: orderForm.orderNo.trim(),
      orderDate: orderForm.orderDate,
      deliveryDate: orderForm.deliveryDate,
      lines: normalizedLines()
    });
    ElMessage.success('订单已保存');
    dialogVisible.value = false;
    await router.push(orderDetailPath(order.orderNo));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单保存失败');
  } finally {
    saving.value = false;
  }
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function defaultDeliveryDate(orderDate: string) {
  const date = orderDate ? new Date(orderDate) : new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

function toDateOnly(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function syncOrderDateRangeFromForm() {
  orderDateRange.value =
    orderForm.orderDate && orderForm.deliveryDate ? [orderForm.orderDate, orderForm.deliveryDate] : [];
}

function clearOrderNoCheck() {
  if (orderNoCheckTimer) {
    window.clearTimeout(orderNoCheckTimer);
    orderNoCheckTimer = undefined;
  }
  orderNoCheckSequence += 1;
  checkingOrderNo.value = false;
  orderNoAvailable.value = false;
  orderNoCheckText.value = '';
}

function handleOrderNoInput() {
  orderNoTouched.value = true;
  scheduleOrderNoCheck();
}

async function handleOrderDateRangeChange(value: string[]) {
  if (!value || value.length !== 2) {
    return;
  }
  orderForm.orderDate = value[0];
  orderForm.deliveryDate = value[1];
  if (!orderNoTouched.value) {
    await generateOrderNo();
  }
}

async function generateOrderNo() {
  generatingOrderNo.value = true;
  try {
    const result = await erpApi.nextOrderNo(orderForm.orderDate);
    // 订单号默认由后端按日期生成，但保留输入框允许手工修改。
    orderForm.orderNo = result.orderNo;
    orderNoTouched.value = false;
    await checkOrderNo(true);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单号生成失败');
  } finally {
    generatingOrderNo.value = false;
  }
}

function scheduleOrderNoCheck() {
  if (orderNoCheckTimer) {
    window.clearTimeout(orderNoCheckTimer);
    orderNoCheckTimer = undefined;
  }
  const orderNo = orderForm.orderNo.trim();
  orderNoAvailable.value = false;
  if (!orderNo) {
    checkingOrderNo.value = false;
    orderNoCheckText.value = '';
    return;
  }
  // 手工修改订单号时自动查重，避免操作人员依赖额外按钮。
  const sequence = ++orderNoCheckSequence;
  checkingOrderNo.value = true;
  orderNoCheckText.value = '正在自动查重...';
  orderNoCheckTimer = window.setTimeout(() => {
    orderNoCheckTimer = undefined;
    void checkOrderNo(true, sequence);
  }, 400);
}

async function checkOrderNo(silent = false, expectedSequence?: number) {
  const orderNo = orderForm.orderNo.trim();
  if (!orderNo) {
    if (!silent) {
      ElMessage.warning('请先填写订单号');
    }
    clearOrderNoCheck();
    return false;
  }

  if (orderNoCheckTimer) {
    window.clearTimeout(orderNoCheckTimer);
    orderNoCheckTimer = undefined;
  }
  const sequence = expectedSequence ?? ++orderNoCheckSequence;
  checkingOrderNo.value = true;
  try {
    const result = await erpApi.checkOrderNo(orderNo);
    if (sequence !== orderNoCheckSequence || orderNo !== orderForm.orderNo.trim()) {
      return result.available;
    }
    orderNoAvailable.value = result.available;
    orderNoCheckText.value = result.available ? '订单号可用' : '订单号已存在，请修改';
    if (!result.available && !silent) {
      ElMessage.warning('订单号已存在，请修改');
    }
    return result.available;
  } catch (error) {
    orderNoAvailable.value = false;
    orderNoCheckText.value = '订单号查重失败，请稍后再试';
    ElMessage.error(error instanceof Error ? error.message : '订单号查重失败');
    return false;
  } finally {
    if (sequence === orderNoCheckSequence) {
      checkingOrderNo.value = false;
    }
  }
}

function syncPlanQuantity(line: CreateOrderLinePayload) {
  const nextSuggestedQuantity = suggestedProductionPlanQuantity(line);
  const previousSuggestedQuantity = Number(line.productionPlanSuggestedQuantity ?? line.productionPlanQuantity ?? nextSuggestedQuantity);
  const currentPlanQuantity = Number(line.productionPlanQuantity ?? previousSuggestedQuantity);
  const planWasFollowingSuggestion = Math.abs(currentPlanQuantity - previousSuggestedQuantity) <= 0.0001;
  line.productionPlanSuggestedQuantity = nextSuggestedQuantity;

  if (line.fulfillmentMode === 'STOCK') {
    if (planWasFollowingSuggestion) {
      line.productionPlanQuantity = nextSuggestedQuantity;
      clearProductionPlanOverride(line);
    }
    return;
  }
  // 客户订单数量变化时，只在计划仍跟随建议数量时自动同步；手动多做或少做必须保留说明。
  if (line.productionPlanQuantity === undefined || line.productionPlanQuantity === null) {
    line.productionPlanQuantity = nextSuggestedQuantity;
    return;
  }
  if (planWasFollowingSuggestion) {
    line.productionPlanQuantity = nextSuggestedQuantity;
    clearProductionPlanOverride(line);
  }
}

function clearProductionPlanOverride(line: CreateOrderLinePayload) {
  line.productionPlanOverrideByCode = '';
  line.productionPlanOverrideByName = '';
  line.productionPlanOverrideByRole = '';
  line.productionPlanOverrideAt = '';
  line.productionPlanOverrideReason = '';
}

function normalizedLines() {
  return orderForm.lines.map((line) => sanitizeOrderLinePayload(line, orderForm.deliveryDate));
}

function goDetail(row: OrderSummary) {
  void router.push(orderDetailPath(row.orderNo));
}

function goShortageDetail(row: OrderSummary) {
  if (!requireDesktopOrderListMutation('处理补单')) {
    return;
  }
  void router.push({
    path: orderDetailPath(row.orderNo),
    query: { shortage: '1', returnTo: '/orders' }
  });
}

function orderDetailPath(orderNo: string) {
  return `/orders/${encodeURIComponent(orderNo)}`;
}

function goProcess(row: OrderSummary) {
  if (!requireDesktopOrderListMutation(orderProcessActionText(row))) {
    return;
  }
  if (row.status === 'DRAFT') {
    void router.push({ path: '/processes', query: { orderNo: row.orderNo, open: 'edit', returnTo: '/orders' } });
    return;
  }
  if (orderWarehouseActionText(row)) {
    void router.push({ path: '/warehouses', query: { orderNo: row.orderNo, returnTo: '/orders' } });
    return;
  }
  void router.push({ path: '/production', query: { orderNo: row.orderNo, returnTo: '/orders' } });
}

function orderProcessActionText(row: OrderSummary) {
  if (row.status === 'DRAFT') {
    return '提交生产';
  }
  return orderWarehouseActionText(row) || '生产详情';
}

function orderWarehouseActionText(row: OrderSummary) {
  if (row.warehouseStage === 'WAITING_RECEIPT') {
    return '仓库入库';
  }
  if (row.warehouseStage === 'WAITING_SHIPMENT' || row.warehouseStage === 'PARTIAL_SHIPPED') {
    return '仓库发货';
  }
  return '';
}

function canCancelOrder(row: OrderSummary) {
  return row.status !== 'CANCELLED' && row.status !== 'COMPLETED';
}

function cancelOrderDisabledReason(row: OrderSummary) {
  if (row.status === 'COMPLETED') {
    return '已完成订单第一阶段不允许直接取消';
  }
  if (row.status === 'CANCELLED') {
    return '订单已取消';
  }
  return '';
}

async function openCancelOrder(row: OrderSummary) {
  if (!requireDesktopOrderListMutation('取消订单')) {
    return;
  }
  if (!canCancelOrder(row)) {
    ElMessage.warning(cancelOrderDisabledReason(row));
    return;
  }
  activeCancelOrder.value = row;
  activeCancelOrderDetail.value = undefined;
  cancelHandlingPlanRows.value = [];
  cancelOrderForm.cancelAt = formatDateTime(new Date().toISOString());
  cancelOrderForm.managerName = '';
  cancelOrderForm.productionCancelState = 'NOT_PRODUCED';
  cancelOrderForm.reason = '';
  try {
    activeCancelOrderDetail.value = await erpApi.order(row.orderNo);
    cancelHandlingPlanRows.value = buildCancelHandlingPlanRows(activeCancelOrderDetail.value);
    if (cancelHandlingPlanRows.value.length > 0) {
      cancelOrderForm.productionCancelState = 'PRODUCED';
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '取消订单资料加载失败');
    return;
  }
  cancelOrderVisible.value = true;
}

function openDeleteDraftOrder(row: OrderSummary) {
  if (!requireDesktopOrderListMutation('删除草稿')) {
    return;
  }
  if (row.status !== 'DRAFT') {
    ElMessage.warning('只有待提交生产草稿订单可以删除');
    return;
  }
  activeDeleteDraftOrder.value = row;
  deleteDraftVisible.value = true;
}

function requireDesktopOrderListMutation(actionName: string) {
  if (!isMobileOrderWorkspacePaused()) {
    return true;
  }
  ElMessage.info(`${actionName}请在电脑端操作；手机端订单列表仅用于查看明细`);
  return false;
}

async function deleteDraftOrder() {
  if (!activeDeleteDraftOrder.value) {
    return;
  }
  saving.value = true;
  try {
    await erpApi.deleteDraftOrder(activeDeleteDraftOrder.value.orderNo);
    ElMessage.success('草稿订单已删除');
    deleteDraftVisible.value = false;
    activeDeleteDraftOrder.value = undefined;
    await loadOrderOptions();
    await loadOrders();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '草稿订单删除失败');
  } finally {
    saving.value = false;
  }
}

function taskHasProductionProgress(task: OrderLineProductionTask) {
  return task.status !== 'PENDING' || task.completedQuantity > 0;
}

function buildCancelHandlingPlanRows(order: OrderDetail) {
  return order.lines.flatMap((line: OrderLine) =>
    (line.productionTasks || [])
      .filter(taskHasProductionProgress)
      .map((task) => ({
        orderLineId: line.id,
        productionTaskNo: task.productionTaskNo,
        partCode: line.partCode,
        partName: line.partName,
        plannedQuantity: task.plannedQuantity,
        completedQuantity: task.completedQuantity,
        unit: line.unit,
        handlingMode: '' as CancelHandlingMode,
        handlingQuantity: 0,
        remark: ''
      }))
  );
}

function handleCancelHandlingModeChange(row: CancelHandlingPlanRow) {
  if (row.handlingMode === 'NONE') {
    row.handlingQuantity = 0;
    return;
  }
  if (row.handlingQuantity <= 0) {
    row.handlingQuantity = row.completedQuantity > 0 ? row.completedQuantity : row.plannedQuantity;
  }
}

function collectCancelHandlingPlan() {
  if (cancelOrderForm.productionCancelState !== 'PRODUCED') {
    return undefined;
  }
  if (cancelHandlingPlanRows.value.length === 0) {
    ElMessage.warning('已生产取消必须先加载并选择零件处理方式');
    return false;
  }
  for (const row of cancelHandlingPlanRows.value) {
    if (!row.handlingMode) {
      ElMessage.warning(`请选择 ${row.partCode} / ${row.productionTaskNo} 的处理方式`);
      return false;
    }
    if ((row.handlingMode === 'STOCK' || row.handlingMode === 'SCRAP') && row.handlingQuantity <= 0) {
      ElMessage.warning(`请填写 ${row.partCode} / ${row.productionTaskNo} 的处理数量`);
      return false;
    }
    if (row.handlingMode === 'NONE' && !row.remark.trim()) {
      ElMessage.warning(`请填写 ${row.partCode} / ${row.productionTaskNo} 无实物处理说明`);
      return false;
    }
  }
  return cancelHandlingPlanRows.value.map((row) => ({
    orderLineId: row.orderLineId,
    productionTaskNo: row.productionTaskNo,
    handlingMode: row.handlingMode as 'STOCK' | 'SCRAP' | 'NONE',
    handlingQuantity: row.handlingMode === 'NONE' ? 0 : row.handlingQuantity,
    remark: row.remark.trim() || undefined
  }));
}

async function saveCancelOrder() {
  if (!activeCancelOrder.value) {
    return;
  }
  if (!cancelOrderForm.managerName.trim()) {
    ElMessage.warning('请填写管理人员姓名');
    return;
  }
  if (!cancelOrderForm.reason.trim()) {
    ElMessage.warning('请填写取消订单原因');
    return;
  }
  const handlingPlan = collectCancelHandlingPlan();
  if (handlingPlan === false) {
    return;
  }

  saving.value = true;
  try {
    await erpApi.cancelOrder(activeCancelOrder.value.orderNo, {
      reason: cancelOrderForm.reason.trim(),
      managerName: cancelOrderForm.managerName.trim(),
      productionCancelState: cancelOrderForm.productionCancelState,
      handlingPlan
    });
    ElMessage.success('订单已取消');
    cancelOrderVisible.value = false;
    await loadOrders();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '取消订单失败');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadCustomers();
  await loadOrderOptions();
  await loadOrders();
});
</script>

<style scoped>
.order-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.page-header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.page-header-actions .el-button {
  margin-left: 0;
}

.mobile-order-paused {
  display: none;
}

.order-no-field {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: min(460px, 100%);
}

.order-no-field .el-input {
  flex: 1 1 180px;
}

.order-no-check {
  width: 100%;
  margin-top: 6px;
  font-size: 12px;
}

.order-no-check.available {
  color: #16a34a;
}

.order-no-check.checking {
  color: #64748b;
}

.order-no-check.duplicated {
  color: #dc2626;
}

.order-date-range-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.order-date-range-field :deep(.el-date-editor) {
  width: min(360px, 100%);
}

.order-duration-text {
  color: #64748b;
  font-size: 13px;
  white-space: nowrap;
}

.dialog-subtitle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0 12px;
}

.dialog-subtitle-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-subtitle-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-subtitle-actions .el-button {
  margin-left: 0;
}

.duplicate-help-button {
  color: #f59e0b;
}

.duplicate-help {
  display: grid;
  gap: 8px;
  color: #334155;
  line-height: 1.6;
}

.duplicate-help p {
  margin: 0;
}

.orders-table-card {
  min-height: 0;
}

.import-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.hidden-file-input {
  display: none;
}

.import-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.import-summary > div {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.import-summary strong {
  color: #0f172a;
  font-size: 20px;
  line-height: 1;
}

.import-summary span {
  color: #64748b;
  font-size: 12px;
}

.import-summary .danger {
  color: #dc2626;
}

.import-summary .warning {
  color: #d97706;
}

.import-selection-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #475569;
  font-size: 13px;
}

.import-selection-actions > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.import-drop-zone {
  display: grid;
  gap: 4px;
  margin-bottom: 14px;
  padding: 16px;
  color: #1f4f7a;
  background: #f0f7ff;
  border: 1px dashed #60a5fa;
  border-radius: 6px;
  cursor: pointer;
}

.import-drop-zone:hover,
.import-drop-zone:focus-visible {
  background: #e0f2fe;
  border-color: #2563eb;
  outline: none;
}

.import-drop-zone.is-drag-over {
  background: #dbeafe;
  border-color: #1d4ed8;
  box-shadow: inset 0 0 0 1px #1d4ed8;
}

.import-drop-zone.is-uploading {
  cursor: wait;
  opacity: 0.72;
}

.import-drop-zone span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.import-history-list {
  display: grid;
  gap: 8px;
  margin-bottom: 8px;
}

.import-history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.import-history-item.is-active {
  background: #eef6ff;
  border-color: #93c5fd;
}

.import-history-item > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.import-history-item strong {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.import-history-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.import-history-item strong,
.import-history-item span {
  overflow-wrap: anywhere;
}

.import-history-item span {
  color: #64748b;
  font-size: 12px;
}

.import-history-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
  color: #64748b;
  font-size: 12px;
}

.import-file-list {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.import-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #dbeafe;
  border-radius: 6px;
}

.import-file-item > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.import-file-item strong,
.import-file-item span {
  overflow-wrap: anywhere;
}

.import-file-item span {
  color: #64748b;
  font-size: 12px;
}

.import-file-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.import-file-preview-panel {
  min-height: 180px;
}

.import-file-preview-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.import-file-preview-header > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.import-file-preview-header strong,
.import-file-preview-header span {
  overflow-wrap: anywhere;
}

.import-file-preview-header span {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
}

.import-file-preview-header a {
  flex: 0 0 auto;
  color: #2563eb;
  text-decoration: none;
}

.import-preview-table,
.import-line-table {
  width: 100%;
}

.import-preview-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  color: #64748b;
  font-size: 12px;
}

.import-issues,
.import-status-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.import-order-status {
  display: grid;
  gap: 6px;
}

.import-order-issue-summary {
  display: grid;
  gap: 3px;
  color: #b45309;
  font-size: 12px;
  line-height: 18px;
}

.import-order-issue-summary span {
  word-break: break-word;
}

.action-tooltip-wrap {
  display: inline-flex;
}

.select-all-checkbox {
  width: 100%;
}

.dialog-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

.form-hint {
  width: 100%;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.cancel-handling-section {
  display: grid;
  gap: 10px;
  margin: 0 0 16px 116px;
}

.cancel-handling-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.cancel-handling-title span {
  color: #64748b;
  font-size: 12px;
}

.cancel-handling-list {
  display: grid;
  gap: 8px;
}

.cancel-handling-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto 130px minmax(180px, 1fr);
  align-items: center;
  gap: 10px;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.cancel-handling-main {
  display: grid;
  gap: 3px;
}

.cancel-handling-main span {
  color: #64748b;
  font-size: 12px;
}

.cancel-handling-quantity {
  width: 130px;
}

.delete-draft-summary {
  display: grid;
  gap: 10px;
}

.delete-draft-summary div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.delete-draft-summary span {
  color: #64748b;
}

@media (max-width: 900px) {
  .page-header-actions,
  .filter-bar,
  .orders-table-card {
    display: none;
  }

  .mobile-order-paused {
    display: block;
  }

  .order-form-grid {
    grid-template-columns: 1fr;
  }

  .page-header-actions {
    width: 100%;
  }

  .page-header-actions .el-button,
  .import-toolbar .el-button {
    flex: 1 1 140px;
  }

  .order-no-field,
  .order-date-range-field {
    width: 100%;
  }

  .order-no-field .el-button {
    flex: 1 1 120px;
  }

  .dialog-subtitle {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .dialog-subtitle-actions,
  .dialog-subtitle-actions .el-button {
    width: 100%;
  }

  .dialog-footer-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dialog-footer-actions .el-button {
    width: 100%;
    margin-left: 0;
  }

  .cancel-handling-section {
    margin-left: 0;
  }

  .cancel-handling-title {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .cancel-handling-row {
    grid-template-columns: 1fr;
  }

  .cancel-handling-quantity {
    width: 100%;
  }

  .import-file-item,
  .import-file-preview-header {
    align-items: stretch;
    flex-direction: column;
  }

  .import-file-actions {
    justify-content: flex-start;
  }
}
</style>
