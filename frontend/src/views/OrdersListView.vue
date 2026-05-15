<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">订单总列表</h2>
      <div class="page-header-actions orders-page-header-actions">
        <el-button v-if="!isMobileLayout" @click="openImportDialog">导入订单</el-button>
        <el-button v-if="!isMobileLayout" type="primary" @click="openCreate">新增订单</el-button>
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

    <el-dialog
      v-model="dialogVisible"
      title="新增订单"
      width="min(1500px, calc(100vw - 32px))"
      class="responsive-dialog order-create-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleOrderSavingDialogClose"
    >
      <el-form label-width="86px">
        <div class="order-form-grid">
          <el-form-item label="客户">
            <CustomerSelect
              v-model="orderForm.customerId"
              placeholder="选择客户"
              status="ENABLED"
              width="260px"
              @change="handleOrderCustomerChange"
            />
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
            <el-button size="small" @click="toggleModelBomRecommendation">零件包推荐</el-button>
            <el-button size="small" @click="addLine">新增零件</el-button>
          </div>
        </div>

        <div v-if="modelBomRecommendationVisible" class="model-bom-recommendation">
          <div class="model-bom-recommendation-toolbar">
            <div class="model-bom-recommendation-title">
              <strong>按客户 / 机型推荐零件包</strong>
              <span>只带入当前草稿明细，不提交生产、不占库存。</span>
            </div>
            <div class="model-bom-recommendation-search">
              <el-input
                v-model="modelBomSearch.projectModel"
                clearable
                placeholder="项目型号 / 机型，例如 B3、B5"
                @keyup.enter="loadModelBomRecommendations"
              />
              <el-input
                v-model="modelBomSearch.keyword"
                clearable
                placeholder="零件包、零件、客户关键字"
                @keyup.enter="loadModelBomRecommendations"
              />
              <el-button type="primary" :loading="modelBomLoading" @click="loadModelBomRecommendations">
                搜索零件包
              </el-button>
            </div>
          </div>
          <el-empty
            v-if="!modelBomLoading && modelBomRecommendations.length === 0"
            description="请选择客户并输入机型后搜索；也可以搜索全局通用零件包。"
          />
          <div v-else class="model-bom-card-list">
            <article v-for="bom in modelBomRecommendations" :key="bom.id" class="model-bom-card">
              <div class="model-bom-card-main">
                <div class="model-bom-card-title">
                  <strong>{{ bom.bomName }}</strong>
                  <el-tag size="small" effect="plain">{{ bom.scopeLabel }}</el-tag>
                </div>
                <div class="model-bom-card-meta">
                  <span>{{ modelBomProjectScopeText(bom) }}</span>
                  <span>{{ enabledModelBomLineCount(bom) }} 个启用零件</span>
                  <span v-if="bom.remark">{{ bom.remark }}</span>
                </div>
                <div class="model-bom-structure-preview">
                  <div v-for="(group, groupIndex) in modelBomStructureGroups(bom)" :key="group.id" class="model-bom-structure-group">
                    <div class="model-bom-structure-main">
                      <span>{{ groupIndex + 1 }}</span>
                      <el-tag :type="groupStructureTagType(group.type, group.line)" effect="plain">
                        {{ groupStructureLabel(group.type, group.line) }}
                      </el-tag>
                      <strong>{{ formatModelBomStructureCore(group.line) }}</strong>
                      <span>{{ formatModelBomStructureMeta(group.line) }}</span>
                    </div>
                    <div v-for="(child, childIndex) in group.children" :key="child.id" class="model-bom-structure-child">
                      <span>{{ `${groupIndex + 1}.${childIndex + 1}` }}</span>
                      <el-tag :type="groupStructureTagType('standalone', child)" effect="plain">
                        {{ groupStructureLabel('standalone', child) }}
                      </el-tag>
                      <strong>{{ formatModelBomStructureCore(child) }}</strong>
                      <span>{{ formatModelBomStructureMeta(child) }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <el-button type="primary" plain @click="openModelBomApplyDialog(bom)">预览带入</el-button>
            </article>
          </div>
        </div>

        <div class="order-form-structure-panel">
          <div class="order-form-structure-header">
            <div>
              <strong>当前草稿固定格式清单</strong>
              <span>{{ orderFormStructureGroups.length }} 组 / {{ orderFormFilledLineCount }} 行</span>
            </div>
            <div class="structure-header-actions">
              <el-button size="small" :disabled="orderFormFilledLineCount === 0" @click="openOrderFormStructureTextDialog">查看固定格式</el-button>
              <el-button size="small" :disabled="orderFormFilledLineCount === 0" @click="copyOrderFormStructureText">复制清单</el-button>
            </div>
          </div>
          <div v-if="orderFormStructureGroups.length" class="order-form-structure-list">
            <div v-for="(group, groupIndex) in orderFormStructureGroups" :key="group.id" class="order-form-structure-group">
              <div class="order-form-structure-main">
                <span>{{ groupIndex + 1 }}</span>
                <el-tag :type="groupStructureTagType(group.type, group.entry.line)" effect="plain">
                  {{ groupStructureLabel(group.type, group.entry.line) }}
                </el-tag>
                <strong>{{ formatOrderFormStructureCore(group.entry.line) }}</strong>
                <span>{{ formatOrderFormStructureMeta(group.entry.line) }}</span>
              </div>
              <div v-for="(child, childIndex) in group.children" :key="child.key" class="order-form-structure-child">
                <span>{{ `${groupIndex + 1}.${childIndex + 1}` }}</span>
                <el-tag :type="groupStructureTagType('standalone', child.line)" effect="plain">
                  {{ groupStructureLabel('standalone', child.line) }}
                </el-tag>
                <strong>{{ formatOrderFormStructureCore(child.line) }}</strong>
                <span>{{ formatOrderFormStructureMeta(child.line) }}</span>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无固定格式清单" />
        </div>

        <OrderLineEditor
          :lines="orderForm.lines"
          :default-delivery-date="orderForm.deliveryDate"
          :customer-id="orderForm.customerId"
          :inventory-summary="inventorySummary"
          :read-only="isMobileLayout"
          @remove="removeLine"
          @quantity-change="syncPlanQuantity"
        />
      </el-form>
      <template #footer>
        <div class="dialog-footer-actions">
          <el-button :disabled="saving" @click="closeCreateOrderDialog">取消</el-button>
          <el-button type="primary" :loading="saving" :disabled="saving" @click="saveOrder">保存订单</el-button>
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
              {{ session.status === 'DRAFT' ? '放弃' : '删除导入记忆' }}
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
          <span>涉及零件编码</span>
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
            <div class="import-structure-panel">
              <div class="import-structure-header">
                <strong>固定格式清单</strong>
                <span>{{ importStructureGroups(row.rows).length }} 组 / {{ row.rows.length }} 行</span>
                <div class="structure-header-actions">
                  <el-button size="small" :disabled="row.rows.length === 0" @click="openImportOrderStructureTextDialog(row)">查看固定格式</el-button>
                  <el-button size="small" :disabled="row.rows.length === 0" @click="copyImportOrderStructureText(row)">复制清单</el-button>
                </div>
              </div>
              <div v-if="importStructureGroups(row.rows).length" class="import-structure-list">
                <div v-for="(group, groupIndex) in importStructureGroups(row.rows)" :key="group.id" class="import-structure-group">
                  <div class="import-structure-main">
                    <span>{{ groupIndex + 1 }}</span>
                    <el-tag :type="groupStructureTagType(group.type, group.line)" effect="plain">
                      {{ groupStructureLabel(group.type, group.line) }}
                    </el-tag>
                    <strong>{{ formatImportStructureCore(group.line) }}</strong>
                    <span>{{ formatImportStructureMeta(group.line) }}</span>
                  </div>
                  <div v-for="(child, childIndex) in group.children" :key="child.id" class="import-structure-child">
                    <span>{{ `${groupIndex + 1}.${childIndex + 1}` }}</span>
                    <el-tag :type="groupStructureTagType('standalone', child)" effect="plain">
                      {{ groupStructureLabel('standalone', child) }}
                    </el-tag>
                    <strong>{{ formatImportStructureCore(child) }}</strong>
                    <span>{{ formatImportStructureMeta(child) }}</span>
                  </div>
                </div>
              </div>
              <el-empty v-else description="暂无固定格式清单" />
            </div>
            <el-table :data="row.rows" size="small" class="import-line-table">
              <el-table-column prop="importSequence" label="序号" width="90" />
              <el-table-column label="结构" min-width="170">
                <template #default="{ row: line }">
                  <div class="import-line-structure-cell">
                    <el-tag size="small" :type="lineStructureTagType(line)" effect="plain">
                      {{ lineStructureLabel(line) }}
                    </el-tag>
                    <small>{{ lineStructureHint(line) }}</small>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="partCategory" label="零件类型" width="100" />
              <el-table-column prop="partCode" label="零件编码" min-width="140" />
              <el-table-column prop="drawingNo" label="图号" min-width="170" />
              <el-table-column prop="partName" label="产品名称" min-width="160" />
              <el-table-column label="厚度" width="90">
                <template #default="{ row: line }">{{ formatStructureLineThickness(line) }}</template>
              </el-table-column>
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

    <el-dialog
      v-model="cancelOrderVisible"
      title="取消订单"
      width="min(980px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleOrderSavingDialogClose"
    >
      <el-alert
        title="正常订单和补单订单都可以取消。未开始生产任务会标记为已取消并保留历史，同时释放库存；已开始生产的订单会同步通知生产和仓库处理已生产零件。"
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
              <el-input v-model="row.remark" placeholder="处理说明，可修改" />
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
          <el-button :disabled="saving" @click="closeCancelOrderDialog">返回</el-button>
          <el-button type="danger" :loading="saving" :disabled="saving" @click="saveCancelOrder">确认取消订单</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="deleteDraftVisible"
      title="删除草稿订单"
      width="min(560px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleOrderSavingDialogClose"
    >
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
          <el-button :disabled="saving" @click="closeDeleteDraftDialog">取消</el-button>
          <el-button type="danger" :loading="saving" :disabled="saving" @click="deleteDraftOrder">确认删除草稿</el-button>
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
            <div class="import-file-structure-panel">
              <div class="import-structure-header">
                <strong>固定格式清单</strong>
                <span>{{ importFileStructureOrders.length }} 个订单 / 已加载 {{ importFilePreview.rows.length }} 行</span>
                <div class="structure-header-actions">
                  <el-button size="small" :disabled="importFilePreview.rows.length === 0" @click="openImportFileStructureTextDialog">查看固定格式</el-button>
                  <el-button size="small" :disabled="importFilePreview.rows.length === 0" @click="copyImportFileStructureText">复制全部</el-button>
                </div>
              </div>
            <div v-if="importFileStructureOrders.length" class="import-file-structure-orders">
              <section v-for="previewOrder in importFileStructureOrders" :key="previewOrder.orderNo" class="import-file-structure-order">
                <div class="import-file-structure-order__title">
                  <strong>{{ previewOrder.orderNo }}</strong>
                  <span>{{ previewOrder.customerName || '-' }} / {{ previewOrder.projectModel || '-' }}</span>
                </div>
                <div class="import-structure-list">
                  <div v-for="(group, groupIndex) in previewOrder.groups" :key="group.id" class="import-structure-group">
                    <div class="import-structure-main">
                      <span>{{ groupIndex + 1 }}</span>
                      <el-tag :type="groupStructureTagType(group.type, group.line)" effect="plain">
                        {{ groupStructureLabel(group.type, group.line) }}
                      </el-tag>
                      <strong>{{ formatImportStructureCore(group.line) }}</strong>
                      <span>{{ formatImportStructureMeta(group.line) }}</span>
                    </div>
                    <div v-for="(child, childIndex) in group.children" :key="child.id" class="import-structure-child">
                      <span>{{ `${groupIndex + 1}.${childIndex + 1}` }}</span>
                      <el-tag :type="groupStructureTagType('standalone', child)" effect="plain">
                        {{ groupStructureLabel('standalone', child) }}
                      </el-tag>
                      <strong>{{ formatImportStructureCore(child) }}</strong>
                      <span>{{ formatImportStructureMeta(child) }}</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
            <el-empty v-else description="暂无固定格式清单" />
          </div>
          <el-table :data="importFilePreview.rows" max-height="520" size="small" class="import-line-table">
            <el-table-column prop="sourceRowNo" label="Excel行" width="86" />
            <el-table-column prop="orderNo" label="订单编号" min-width="160" />
            <el-table-column prop="importSequence" label="序号" width="86" />
            <el-table-column label="结构" min-width="170">
              <template #default="{ row }">
                <div class="import-line-structure-cell">
                  <el-tag size="small" :type="lineStructureTagType(row)" effect="plain">
                    {{ lineStructureLabel(row) }}
                  </el-tag>
                  <small>{{ lineStructureHint(row) }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="partCategory" label="零件类型" width="100" />
            <el-table-column prop="partCode" label="零件编码" min-width="150" />
            <el-table-column prop="drawingNo" label="图号" min-width="150" />
            <el-table-column prop="partName" label="产品名称" min-width="160" />
            <el-table-column label="厚度" width="90">
              <template #default="{ row: line }">{{ formatStructureLineThickness(line) }}</template>
            </el-table-column>
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

    <el-dialog
      v-model="modelBomApplyDialogVisible"
      title="零件包带入预览"
      width="min(1080px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
    >
      <div v-if="modelBomApplyPreview" class="model-bom-apply-preview">
        <el-alert
          title="零件包推荐只写入当前未保存的草稿明细，不提交生产、不占库存；确认带入后仍需保存订单。"
          type="info"
          :closable="false"
          show-icon
        />
        <div class="model-bom-apply-summary">
          <div>
            <strong>{{ modelBomApplyPreview.bom.bomName }}</strong>
            <span>{{ modelBomApplyPreview.bom.scopeLabel }}</span>
          </div>
          <div>
            <label>本次数量倍率</label>
            <el-input-number
              v-model="modelBomApplyQuantityMultiplier"
              :min="0.001"
              :precision="3"
              :step="1"
              controls-position="right"
              style="width: 180px"
            />
          </div>
        </div>
        <div class="model-bom-apply-tags">
          <el-tag effect="plain" type="success">将带入 {{ modelBomApplyPreviewOrderLines.length }} 行</el-tag>
          <el-tag v-if="modelBomApplyPreview.duplicatePartCodes.length > 0" effect="plain" type="warning">
            重复零件 {{ modelBomApplyPreview.duplicatePartCodes.length }} 个
          </el-tag>
          <el-tag v-if="modelBomApplyPreview.remappedComponentCount > 0" effect="plain" type="warning">
            重映射组件 {{ modelBomApplyPreview.remappedComponentCount }} 个
          </el-tag>
          <el-tag v-if="modelBomApplyMissingThicknessCount > 0" effect="plain" type="danger">
            厚度需核对 {{ modelBomApplyMissingThicknessCount }} 行
          </el-tag>
          <el-tag v-if="modelBomApplyPreview.skippedInvalidStructureCount > 0" effect="plain" type="info">
            跳过无效结构 {{ modelBomApplyPreview.skippedInvalidStructureCount }} 行
          </el-tag>
        </div>
        <el-alert
          v-if="modelBomApplyPreview.duplicatePartCodes.length > 0"
          type="warning"
          :closable="false"
          show-icon
          :title="`当前草稿已存在 ${modelBomApplyPreview.duplicatePartCodes.join('、')}，确认后会追加重复零件。`"
        />
        <el-alert
          v-if="modelBomApplyMissingThicknessCount > 0"
          type="warning"
          :closable="false"
          show-icon
          title="有零件缺少厚度，带入后必须在草稿明细中补齐，否则订单保存会被后端拦截。"
        />
        <el-alert
          v-if="modelBomApplyRequiresRefresh"
          type="info"
          :closable="false"
          show-icon
          title="BOM 维护页已打开。补齐保存后，请回到当前订单页点击“刷新 BOM 预览”；刷新前不会把旧预览带入草稿。"
        />
        <div v-if="modelBomApplyMissingThicknessLines.length > 0" class="model-bom-apply-review-list">
          <strong>需核对厚度明细</strong>
          <div
            v-for="(line, index) in modelBomApplyMissingThicknessLines"
            :key="`${line.partCode || 'missing'}-${index}`"
            class="model-bom-apply-review-item"
          >
            <el-tag type="danger" effect="plain">{{ index + 1 }}</el-tag>
            <span>{{ formatModelBomApplyMissingThicknessLine(line) }}</span>
          </div>
        </div>
        <div class="model-bom-apply-structure">
          <div
            v-for="(group, groupIndex) in modelBomApplyPreviewStructureGroups"
            :key="group.id"
            class="model-bom-apply-group"
          >
            <div class="model-bom-apply-main">
              <span>{{ groupIndex + 1 }}</span>
              <el-tag :type="groupStructureTagType(group.type, group.entry.line)" effect="plain">
                {{ groupStructureLabel(group.type, group.entry.line) }}
              </el-tag>
              <strong>{{ formatOrderFormStructureCore(group.entry.line) }}</strong>
              <span>{{ formatOrderFormStructureMeta(group.entry.line) }}</span>
              <small>{{ modelBomApplyLineFlags(group.entry.line) }}</small>
            </div>
            <div v-for="(child, childIndex) in group.children" :key="child.key" class="model-bom-apply-child">
              <span>{{ `${groupIndex + 1}.${childIndex + 1}` }}</span>
              <el-tag :type="groupStructureTagType('standalone', child.line)" effect="plain">
                {{ groupStructureLabel('standalone', child.line) }}
              </el-tag>
              <strong>{{ formatOrderFormStructureCore(child.line) }}</strong>
              <span>{{ formatOrderFormStructureMeta(child.line) }}</span>
              <small>{{ modelBomApplyLineFlags(child.line) }}</small>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button
          :disabled="!modelBomApplyPreview"
          :loading="modelBomApplyRefreshLoading"
          @click="refreshModelBomApplyPreview"
        >
          刷新 BOM 预览
        </el-button>
        <el-button
          v-if="modelBomApplyMissingThicknessSourceLines.length > 0"
          type="warning"
          plain
          @click="openModelBomApplySourceBom"
        >
          {{ modelBomApplySourceBomActionText }}
        </el-button>
        <el-button @click="closeModelBomApplyDialog">取消</el-button>
        <el-button
          type="primary"
          :disabled="!modelBomApplyPreview || modelBomApplyPreviewOrderLines.length === 0 || modelBomApplyRequiresRefresh"
          @click="confirmApplyModelBomToOrder"
        >
          确认带入草稿
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="structureTextDialogVisible"
      :title="structureTextDialogTitle"
      width="min(960px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
    >
      <el-input
        class="structure-textarea"
        :model-value="structureTextDialogContent"
        type="textarea"
        :rows="24"
        readonly
      />
      <template #footer>
        <el-button @click="structureTextDialogVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!structureTextDialogContent" @click="copyStructureTextDialogContent">复制清单</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="orderConfirmDialogVisible"
      class="responsive-dialog"
      :title="orderConfirmTitle"
      width="640px"
      append-to-body
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      :before-close="handleOrderConfirmDialogClose"
    >
      <div class="order-confirm-panel">
        <p v-for="line in orderConfirmMessageLines" :key="line">{{ line }}</p>
        <ul v-if="orderConfirmDetails.length">
          <li v-for="detail in orderConfirmDetails" :key="detail">{{ detail }}</li>
        </ul>
      </div>
      <template #footer>
        <el-button @click="cancelOrderConfirm">{{ orderConfirmCancelButtonText }}</el-button>
        <el-button :type="orderConfirmButtonType" @click="acceptOrderConfirm">
          {{ orderConfirmButtonText }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { WarningFilled } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router';
import {
  erpApi,
  type CreateOrderLinePayload,
  type OrderImportConfigResponse,
  type OrderImportFilePreview,
  type OrderImportPreviewOrder,
  type OrderImportPreviewRow,
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
import { useDeviceProfile } from '../composables/useDeviceProfile';
import type {
  InventorySummaryRow,
  ModelBom,
  OrderDetail,
  OrderLine,
  OrderLineProductionTask,
  OrderProductionFilterStatus,
  OrderStatus,
  OrderSummary
} from '../types/erp';
import { normalizeDisplayFileName } from '../utils/fileNames';
import { formatDate, formatDateInputValue, formatDateTime, formatQuantity } from '../utils/format';
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

type ImportStructureRow = {
  id: string;
  orderNo?: string;
  customerName?: string;
  projectModel?: string;
  lineType?: string;
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  partCode?: string;
  drawingNo?: string;
  drawingDate?: string;
  drawingStatus?: string;
  partName?: string;
  partSpecification?: string;
  partThickness?: number | null;
  orderQuantity?: number;
  unitUsage?: number;
  demandQuantity: number;
  unit: string;
  processRoute?: string;
};

type ImportStructureGroup = {
  id: string;
  type: 'component' | 'standalone' | 'orphan';
  line: ImportStructureRow;
  children: ImportStructureRow[];
};
type LineStructureTagType = 'success' | 'warning' | 'info' | 'danger';
type StructureLine = {
  lineType?: string;
  componentNo?: string | null;
  parentComponentNo?: string | null;
};
type StructureGroupType = 'component' | 'standalone' | 'orphan';

type ImportFileStructureOrder = {
  orderNo: string;
  customerName?: string;
  projectModel?: string;
  groups: ImportStructureGroup[];
};

type ModelBomStructureGroup = {
  id: string;
  type: 'component' | 'standalone' | 'orphan';
  line: ModelBom['lines'][number];
  children: Array<ModelBom['lines'][number]>;
};

type OrderFormStructureLine = {
  key: string;
  line: CreateOrderLinePayload;
};

type OrderFormStructureGroup = {
  id: string;
  type: 'component' | 'standalone' | 'orphan';
  entry: OrderFormStructureLine;
  children: OrderFormStructureLine[];
};

type ModelBomApplyPreview = {
  bom: ModelBom;
  componentNoMap: Map<string, string>;
  importableBomLines: ModelBom['lines'];
  skippedInvalidStructureCount: number;
  duplicatePartCodes: string[];
  remappedComponentCount: number;
};
type OrderConfirmButtonType = 'primary' | 'success' | 'warning' | 'danger' | 'info';

const router = useRouter();
const { isMobileLayout } = useDeviceProfile();
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
const structureTextDialogVisible = ref(false);
const structureTextDialogTitle = ref('固定格式清单');
const structureTextDialogContent = ref('');
const structureTextDialogSuccessMessage = ref('固定格式清单已复制');
const orderConfirmDialogVisible = ref(false);
const orderConfirmTitle = ref('');
const orderConfirmMessage = ref('');
const orderConfirmDetails = ref<string[]>([]);
const orderConfirmButtonText = ref('确认');
const orderConfirmCancelButtonText = ref('取消');
const orderConfirmButtonType = ref<OrderConfirmButtonType>('primary');
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
const importFileStructureOrders = computed<ImportFileStructureOrder[]>(() => {
  const rows = importFilePreview.value?.rows || [];
  const byOrderNo = new Map<string, ImportStructureRow[]>();
  for (const row of rows) {
    const key = String(row.orderNo || '未识别订单').trim() || '未识别订单';
    byOrderNo.set(key, [...(byOrderNo.get(key) || []), row]);
  }
  return [...byOrderNo.entries()].map(([orderNo, orderRows]) => ({
    orderNo,
    customerName: orderRows[0]?.customerName,
    projectModel: orderRows[0]?.projectModel,
    groups: importStructureGroups(orderRows)
  }));
});
const activeCancelOrder = ref<OrderSummary>();
const activeCancelOrderDetail = ref<OrderDetail>();
const activeDeleteDraftOrder = ref<OrderSummary>();
const expandedMobileOrderIds = ref<string[]>([]);
let orderConfirmResolver: ((confirmed: boolean) => void) | null = null;

const orderStatusOptions: Array<{ label: string; value: OrderStatus }> = [
  { label: '待提交生产', value: 'DRAFT' },
  { label: '待确认生产', value: 'PENDING_PRODUCTION' },
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
const orderFormFilledLines = computed(() => filledOrderFormLines());
const orderFormFilledLineCount = computed(() => orderFormFilledLines.value.length);
const orderFormStructureGroups = computed<OrderFormStructureGroup[]>(() => buildOrderFormStructureGroups(orderFormFilledLines.value));
const orderConfirmMessageLines = computed(() =>
  orderConfirmMessage.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);
const modelBomRecommendationVisible = ref(false);
const modelBomLoading = ref(false);
const modelBomRecommendations = ref<ModelBom[]>([]);
const modelBomApplyDialogVisible = ref(false);
const modelBomApplyRefreshLoading = ref(false);
const modelBomApplySourceOpened = ref(false);
const modelBomApplyRefreshReminderShown = ref(false);
const modelBomApplyQuantityMultiplier = ref(1);
const modelBomApplyPreview = ref<ModelBomApplyPreview>();
const modelBomSearch = reactive({
  projectModel: '',
  keyword: ''
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
const modelBomApplyPreviewOrderLines = computed(() => {
  const preview = modelBomApplyPreview.value;
  if (!preview) {
    return [];
  }
  const targetProjectModel = modelBomImportProjectModel(preview.bom);
  return preview.importableBomLines.map((line, index) =>
    createLineFromModelBomLine(
      preview.bom,
      line,
      index,
      preview.componentNoMap,
      targetProjectModel,
      modelBomApplyQuantityMultiplier.value
    )
  );
});
const modelBomApplyPreviewStructureGroups = computed(() => buildOrderFormStructureGroups(modelBomApplyPreviewOrderLines.value));
const modelBomApplyMissingThicknessCount = computed(
  () => modelBomApplyPreviewOrderLines.value.filter(orderLineNeedsThicknessReview).length
);
const modelBomApplyMissingThicknessLines = computed(() =>
  modelBomApplyPreviewOrderLines.value.filter(orderLineNeedsThicknessReview)
);
const modelBomApplyMissingThicknessSourceLines = computed(() =>
  (modelBomApplyPreview.value?.importableBomLines || []).filter(isModelBomLineMissingThickness)
);
const modelBomApplySourceBomActionText = computed(() =>
  modelBomApplyMissingThicknessSourceLines.value.length === 1 ? '打开 BOM 明细补厚度' : '打开 BOM 维护补厚度'
);
const modelBomApplyRequiresRefresh = computed(() => modelBomApplySourceOpened.value && Boolean(modelBomApplyPreview.value));
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
  return `导入只创建待提交生产的草稿订单；不会自动提交生产、不会占用库存、不会生成生产任务。创建草稿时只会补建缺失的零件搜索记忆，不覆盖已存在或已停用零件搜索记忆；客户归属来自订单历史，不会创建客户 BOM、全局适用范围或库存数量。只读取名为 ERP上传净表 的工作表，台账页不能直接上传。可一次多选或在同一会话连续上传多个 .xlsx 文件，${uploadLimitText}ERP上传净表明细必须连续，中间不能留空行。`;
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
    partCode: '',
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

function toggleModelBomRecommendation() {
  modelBomRecommendationVisible.value = !modelBomRecommendationVisible.value;
  if (modelBomRecommendationVisible.value && modelBomRecommendations.value.length === 0) {
    void loadModelBomRecommendations();
  }
}

function handleOrderCustomerChange() {
  modelBomRecommendations.value = [];
}

async function loadModelBomRecommendations() {
  if (!orderForm.customerId && !modelBomSearch.projectModel.trim() && !modelBomSearch.keyword.trim()) {
    ElMessage.warning('请先选择客户，或输入机型 / 零件包关键字');
    return;
  }
  modelBomLoading.value = true;
  try {
    modelBomRecommendations.value = await erpApi.modelBoms({
      customerId: orderForm.customerId || undefined,
      projectModel: modelBomSearch.projectModel.trim() || undefined,
      keyword: modelBomSearch.keyword.trim() || undefined,
      status: 'ENABLED'
    });
    if (modelBomRecommendations.value.length === 0) {
      ElMessage.info('没有找到适用零件包');
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件包推荐加载失败');
  } finally {
    modelBomLoading.value = false;
  }
}

function enabledModelBomLines(bom: ModelBom) {
  const lines = bom.lines
    .filter((line) => line.status === 'ENABLED' && line.materialStatus !== 'DISABLED')
    .sort(compareModelBomLinesForImport);
  const childrenByParent = new Map<string, typeof lines>();
  const rootLines: typeof lines = [];
  for (const line of lines) {
    if (line.lineType === 'PART' && line.parentComponentNo) {
      const key = normalizeComponentNo(line.parentComponentNo);
      childrenByParent.set(key, [...(childrenByParent.get(key) || []), line]);
    } else {
      rootLines.push(line);
    }
  }
  const ordered: typeof lines = [];
  const attachedIds = new Set<string>();
  for (const line of rootLines) {
    ordered.push(line);
    if (line.lineType === 'COMPONENT' && line.componentNo) {
      for (const child of childrenByParent.get(normalizeComponentNo(line.componentNo)) || []) {
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
}

function compareModelBomLinesForImport(left: ModelBom['lines'][number], right: ModelBom['lines'][number]) {
  const leftDisplayOrder = Number(left.displayOrder || 0);
  const rightDisplayOrder = Number(right.displayOrder || 0);
  if (leftDisplayOrder > 0 && rightDisplayOrder > 0 && leftDisplayOrder !== rightDisplayOrder) {
    return leftDisplayOrder - rightDisplayOrder;
  }
  if (leftDisplayOrder > 0 && rightDisplayOrder <= 0) {
    return -1;
  }
  if (rightDisplayOrder > 0 && leftDisplayOrder <= 0) {
    return 1;
  }
  return (left.sortOrder || 0) - (right.sortOrder || 0) || String(left.partCode || '').localeCompare(String(right.partCode || ''));
}

function enabledModelBomLineCount(bom: ModelBom) {
  return enabledModelBomLines(bom).length;
}

function normalizeComponentNo(value?: string | null) {
  return String(value || '').trim().toUpperCase();
}

function lineStructureLabel(line: StructureLine) {
  if (line.lineType === 'COMPONENT') {
    return `组件 ${normalizeComponentNo(line.componentNo) || '未编号'}`;
  }
  const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
  return parentComponentNo ? `子零件 -> ${parentComponentNo}` : '单独零件';
}

function lineStructureHint(line: StructureLine) {
  if (line.lineType === 'COMPONENT') {
    return '父级组件';
  }
  const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
  return parentComponentNo ? `所属组件 ${parentComponentNo}` : '不属于组件';
}

function lineStructureTagType(line: StructureLine): LineStructureTagType {
  if (line.lineType === 'COMPONENT') {
    return 'success';
  }
  return normalizeComponentNo(line.parentComponentNo) ? 'warning' : 'info';
}

function formatStructureLineThickness(line: StructureLine & { partThickness?: number | null }) {
  if (line.lineType === 'COMPONENT') {
    return '不适用（父级组件由子零件维护）';
  }
  return line.partThickness ?? '-';
}

function groupStructureLabel(type: StructureGroupType, line: StructureLine) {
  if (type === 'component') {
    return `组件 ${normalizeComponentNo(line.componentNo) || '未编号'}`;
  }
  if (type === 'orphan') {
    return `未匹配父级 ${normalizeComponentNo(line.parentComponentNo) || '-'}`;
  }
  return lineStructureLabel(line);
}

function groupStructureHint(type: StructureGroupType, line: StructureLine) {
  if (type === 'component') {
    return '父级组件';
  }
  if (type === 'orphan') {
    return '所属组件不存在';
  }
  return lineStructureHint(line);
}

function groupStructureTagType(type: StructureGroupType, line: StructureLine): LineStructureTagType {
  if (type === 'orphan') {
    return 'danger';
  }
  return lineStructureTagType(line);
}

function isComponentNoOutOfRange(value?: string | null) {
  const matched = /^C(\d+)$/.exec(normalizeComponentNo(value));
  return !!matched && (Number(matched[1]) < 1 || Number(matched[1]) > 9999);
}

function validateOrderFormComponentStructure(lines = orderForm.lines) {
  const componentNos = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const lineType = line.lineType || 'PART';
    const componentNo = normalizeComponentNo(line.componentNo);
    const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
    const label = `第 ${index + 1} 行`;
    if (lineType === 'COMPONENT') {
      if (!componentNo) {
        return `${label} 是组件行，必须填写组件编号`;
      }
      if (isComponentNoOutOfRange(componentNo)) {
        return `${label} 组件编号只支持 C001-C9999；自定义编号请不要使用 C 开头的非 C001-C9999 数字格式`;
      }
      if (parentComponentNo) {
        return `${label} 是组件行，不能填写所属组件`;
      }
      if (componentNos.has(componentNo)) {
        return `同一订单内组件编号重复：${componentNo}`;
      }
      componentNos.add(componentNo);
      continue;
    }
    if (componentNo) {
      return `${label} 是零件行，不能填写组件编号；如属于组件，请填写所属组件`;
    }
  }
  for (const [index, line] of lines.entries()) {
    const lineType = line.lineType || 'PART';
    const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
    if (lineType === 'PART' && parentComponentNo && !componentNos.has(parentComponentNo)) {
      return `第 ${index + 1} 行零件所属组件 ${parentComponentNo} 在当前订单内不存在`;
    }
  }
  return '';
}

function buildOrderFormStructureGroups(lines: CreateOrderLinePayload[]): OrderFormStructureGroup[] {
  const entries = lines.map((line, index) => ({ key: `order-form-line-${index}`, line }));
  const childrenByParent = new Map<string, OrderFormStructureLine[]>();
  const rootLines: OrderFormStructureLine[] = [];
  for (const entry of entries) {
    if (entry.line.lineType !== 'COMPONENT' && entry.line.parentComponentNo) {
      const key = normalizeComponentNo(entry.line.parentComponentNo);
      childrenByParent.set(key, [...(childrenByParent.get(key) || []), entry]);
    } else {
      rootLines.push(entry);
    }
  }
  const groups: OrderFormStructureGroup[] = [];
  const attachedKeys = new Set<string>();
  for (const entry of rootLines) {
    if (entry.line.lineType === 'COMPONENT') {
      const children = childrenByParent.get(normalizeComponentNo(entry.line.componentNo)) || [];
      children.forEach((child) => attachedKeys.add(child.key));
      groups.push({ id: `component-${entry.key}`, type: 'component', entry, children });
      continue;
    }
    groups.push({ id: `standalone-${entry.key}`, type: 'standalone', entry, children: [] });
  }
  for (const entry of entries) {
    if (entry.line.lineType !== 'COMPONENT' && entry.line.parentComponentNo && !attachedKeys.has(entry.key)) {
      groups.push({ id: `orphan-${entry.key}`, type: 'orphan', entry, children: [] });
    }
  }
  return groups;
}

function displayOrderFormPartCode(line: CreateOrderLinePayload) {
  return line.partCode || '-';
}

function orderFormProcessText(line: CreateOrderLinePayload) {
  const steps = line.processSteps?.map((step) => step.processName).filter(Boolean) || [];
  return steps.length ? steps.join('、') : '-';
}

function formatOrderFormStructureCore(line: CreateOrderLinePayload) {
  return `${displayOrderFormPartCode(line)} | ${line.partName || '未填写零件名称'} | 订单 ${formatQuantity(line.quantity ?? 0, line.unit || '件')}`;
}

function formatOrderFormStructureMeta(line: CreateOrderLinePayload) {
  const drawingText = [line.drawingNo, line.drawingVersion, line.drawingDate, line.drawingStatus].filter(Boolean).join(' / ') || '-';
  return `计划 ${formatQuantity(line.productionPlanQuantity ?? 0, line.unit || '件')} | 图纸 ${drawingText} | 工艺 ${orderFormProcessText(line)}`;
}

function formatOrderFormStructureTextLine(line: CreateOrderLinePayload, prefix: string, type: StructureGroupType) {
  const drawingText = [line.drawingNo, line.drawingVersion, line.drawingDate, line.drawingStatus].filter(Boolean).join(' / ') || '-';
  return [
    prefix,
    `结构 ${groupStructureLabel(type, line)}`,
    `父级 ${groupStructureHint(type, line)}`,
    `编码 ${displayOrderFormPartCode(line)}`,
    `名称 ${line.partName || '未填写零件名称'}`,
    `类型 ${line.partCategory || '-'}`,
    `项目 ${line.projectModel || '-'}`,
    `厚度 ${formatStructureLineThickness(line)}`,
    `规格 ${line.partSpecification || '-'}`,
    `订单 ${formatQuantity(line.quantity ?? 0, line.unit || '件')}`,
    `计划 ${formatQuantity(line.productionPlanQuantity ?? 0, line.unit || '件')}`,
    `交期 ${line.deliveryDate || orderForm.deliveryDate || '-'}`,
    `图纸 ${drawingText}`,
    `工艺 ${orderFormProcessText(line)}`
  ].join(' | ');
}

const orderFormStructureText = computed(() => {
  if (orderFormStructureGroups.value.length === 0) {
    return '';
  }
  const header = `${orderForm.orderNo || '未生成订单号'} / ${orderForm.orderDate || '-'} / ${orderForm.deliveryDate || '-'}`;
  const lines = [
    header,
    '序号 | 结构 | 父级 | 编码 | 名称 | 类型 | 项目 | 厚度 | 规格 | 订单 | 计划 | 交期 | 图纸 | 工艺'
  ];
  for (const [groupIndex, group] of orderFormStructureGroups.value.entries()) {
    const groupLine = group.entry.line;
    const prefix =
      group.type === 'component'
        ? `${groupIndex + 1}. 组件 ${groupLine.componentNo || '-'}`
        : group.type === 'orphan'
          ? `${groupIndex + 1}. 未匹配父级 ${groupLine.parentComponentNo || '-'}`
          : `${groupIndex + 1}. 单独零件`;
    lines.push(formatOrderFormStructureTextLine(groupLine, prefix, group.type));
    group.children.forEach((child, childIndex) => {
      lines.push(formatOrderFormStructureTextLine(child.line, `  ${groupIndex + 1}.${childIndex + 1} 子零件`, 'standalone'));
    });
  }
  return lines.join('\n');
});

function openStructureTextDialog(title: string, text: string, successMessage: string) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    ElMessage.warning('暂无可查看的固定格式清单');
    return;
  }
  structureTextDialogTitle.value = title;
  structureTextDialogContent.value = normalizedText;
  structureTextDialogSuccessMessage.value = successMessage;
  structureTextDialogVisible.value = true;
}

function openOrderFormStructureTextDialog() {
  openStructureTextDialog('当前草稿固定格式清单', orderFormStructureText.value, '当前草稿固定格式清单已复制');
}

async function copyOrderFormStructureText() {
  const text = orderFormStructureText.value.trim();
  if (!text) {
    ElMessage.warning('暂无可复制的固定格式清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('当前草稿固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

function importStructureGroups(rows: ImportStructureRow[]): ImportStructureGroup[] {
  const childrenByParent = new Map<string, ImportStructureRow[]>();
  const rootLines: ImportStructureRow[] = [];
  for (const line of rows) {
    if (line.lineType !== 'COMPONENT' && line.parentComponentNo) {
      const key = normalizeComponentNo(line.parentComponentNo);
      childrenByParent.set(key, [...(childrenByParent.get(key) || []), line]);
    } else {
      rootLines.push(line);
    }
  }
  const groups: ImportStructureGroup[] = [];
  const attachedIds = new Set<string>();
  for (const line of rootLines) {
    if (line.lineType === 'COMPONENT') {
      const children = childrenByParent.get(normalizeComponentNo(line.componentNo)) || [];
      children.forEach((child) => attachedIds.add(child.id));
      groups.push({ id: `component-${line.id}`, type: 'component', line, children });
      continue;
    }
    groups.push({ id: `standalone-${line.id}`, type: 'standalone', line, children: [] });
  }
  for (const line of rows) {
    if (line.lineType !== 'COMPONENT' && line.parentComponentNo && !attachedIds.has(line.id)) {
      groups.push({ id: `orphan-${line.id}`, type: 'orphan', line, children: [] });
    }
  }
  return groups;
}

function formatImportStructureCore(line: ImportStructureRow) {
  return `${line.partCode || '-'} | ${line.partName || '-'} | 需求 ${formatQuantity(line.demandQuantity, line.unit)}`;
}

function formatImportStructureMeta(line: ImportStructureRow) {
  const drawingText = [line.drawingNo, line.drawingDate, line.drawingStatus].filter(Boolean).join(' / ') || '-';
  const processText = line.processRoute || '-';
  const quantityText =
    line.orderQuantity != null || line.unitUsage != null ? `订单 ${line.orderQuantity ?? '-'} / 单套 ${line.unitUsage ?? '-'}` : '数量 -';
  return `${quantityText} | 图纸 ${drawingText} | 工艺 ${processText}`;
}

function formatImportStructureTextLine(line: ImportStructureRow, prefix: string, type: StructureGroupType) {
  const drawingText = [line.drawingNo, line.drawingDate, line.drawingStatus].filter(Boolean).join(' / ') || '-';
  return [
    prefix,
    `结构 ${groupStructureLabel(type, line)}`,
    `父级 ${groupStructureHint(type, line)}`,
    `编码 ${line.partCode || '-'}`,
    `名称 ${line.partName || '-'}`,
    `类型 ${line.partCategory || '-'}`,
    `项目 ${line.projectModel || '-'}`,
    `厚度 ${formatStructureLineThickness(line)}`,
    `规格 ${line.partSpecification || '-'}`,
    `需求 ${formatQuantity(line.demandQuantity, line.unit)}`,
    `订单 ${line.orderQuantity ?? '-'}`,
    `单套 ${line.unitUsage ?? '-'}`,
    `图纸 ${drawingText}`,
    `工艺 ${line.processRoute || '-'}`
  ].join(' | ');
}

function formatImportStructureGroupsText(title: string, groups: ImportStructureGroup[]) {
  const lines = [
    title,
    '序号 | 结构 | 父级 | 编码 | 名称 | 类型 | 项目 | 厚度 | 规格 | 需求 | 订单 | 单套 | 图纸 | 工艺'
  ];
  for (const [groupIndex, group] of groups.entries()) {
    const prefix =
      group.type === 'component'
        ? `${groupIndex + 1}. 组件 ${group.line.componentNo || '-'}`
        : group.type === 'orphan'
          ? `${groupIndex + 1}. 未匹配父级 ${group.line.parentComponentNo || '-'}`
          : `${groupIndex + 1}. 单独零件`;
    lines.push(formatImportStructureTextLine(group.line, prefix, group.type));
    group.children.forEach((child, childIndex) => {
      lines.push(formatImportStructureTextLine(child, `  ${groupIndex + 1}.${childIndex + 1} 子零件`, 'standalone'));
    });
  }
  return lines.join('\n');
}

function formatImportStructureText(title: string, rows: ImportStructureRow[]) {
  return formatImportStructureGroupsText(title, importStructureGroups(rows));
}

function importOrderStructureTitle(order: Pick<OrderImportPreviewOrder, 'orderNo' | 'customerName' | 'projectModel'>) {
  return [order.orderNo || '未识别订单', order.customerName || '-', order.projectModel || '-'].join(' / ');
}

async function copyStructureTextToClipboard(text: string, successMessage: string) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    ElMessage.warning('暂无可复制的固定格式清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(normalizedText);
    ElMessage.success(successMessage);
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

async function copyStructureTextDialogContent() {
  await copyStructureTextToClipboard(structureTextDialogContent.value, structureTextDialogSuccessMessage.value);
}

function openImportOrderStructureTextDialog(order: OrderImportPreviewOrder) {
  openStructureTextDialog(
    '导入订单固定格式清单',
    formatImportStructureText(importOrderStructureTitle(order), order.rows),
    '导入订单固定格式清单已复制'
  );
}

async function copyImportOrderStructureText(order: OrderImportPreviewOrder) {
  await copyStructureTextToClipboard(
    formatImportStructureText(importOrderStructureTitle(order), order.rows),
    '导入订单固定格式清单已复制'
  );
}

function openImportFileStructureTextDialog() {
  const sections = importFileStructureOrders.value.map((order) =>
    formatImportStructureGroupsText(
      [order.orderNo || '未识别订单', order.customerName || '-', order.projectModel || '-'].join(' / '),
      order.groups
    )
  );
  openStructureTextDialog('上传文件固定格式清单', sections.join('\n\n'), '文件预览固定格式清单已复制');
}

async function copyImportFileStructureText() {
  const sections = importFileStructureOrders.value.map((order) =>
    formatImportStructureGroupsText(
      [order.orderNo || '未识别订单', order.customerName || '-', order.projectModel || '-'].join(' / '),
      order.groups
    )
  );
  await copyStructureTextToClipboard(sections.join('\n\n'), '文件预览固定格式清单已复制');
}

function modelBomStructureGroups(bom: ModelBom): ModelBomStructureGroup[] {
  const lines = enabledModelBomLines(bom);
  const childrenByParent = new Map<string, typeof lines>();
  const rootLines: typeof lines = [];
  for (const line of lines) {
    if (line.lineType !== 'COMPONENT' && line.parentComponentNo) {
      const key = normalizeComponentNo(line.parentComponentNo);
      childrenByParent.set(key, [...(childrenByParent.get(key) || []), line]);
    } else {
      rootLines.push(line);
    }
  }
  const groups: ModelBomStructureGroup[] = [];
  const attachedIds = new Set<string>();
  for (const line of rootLines) {
    if (line.lineType === 'COMPONENT') {
      const children = childrenByParent.get(normalizeComponentNo(line.componentNo)) || [];
      children.forEach((child) => attachedIds.add(child.id));
      groups.push({ id: `component-${line.id}`, type: 'component', line, children });
      continue;
    }
    groups.push({ id: `standalone-${line.id}`, type: 'standalone', line, children: [] });
  }
  for (const line of lines) {
    if (line.lineType !== 'COMPONENT' && line.parentComponentNo && !attachedIds.has(line.id)) {
      groups.push({ id: `orphan-${line.id}`, type: 'orphan', line, children: [] });
    }
  }
  return groups;
}

function formatModelBomStructureCore(line: ModelBom['lines'][number]) {
  return `${line.partCode || '-'} | ${line.partName || '-'} | 默认 ${formatQuantity(line.defaultQuantity, line.unit)}`;
}

function formatModelBomStructureMeta(line: ModelBom['lines'][number]) {
  const drawingText = [line.drawingNo, line.drawingVersion, line.drawingDate, line.drawingStatus].filter(Boolean).join(' / ') || '-';
  const drawingSourceText =
    line.drawingSource === 'BOM_LINE' ? 'BOM指定' : line.drawingSource === 'MATERIAL_DEFAULT' ? '零件默认' : line.drawingSource === 'MATERIAL_LATEST' ? '零件最新' : '-';
  const processText = line.defaultProcessRoute || '-';
  const specificationText = line.partSpecification || '-';
  const thicknessText = line.lineType === 'COMPONENT' ? '不适用（父级组件由子零件维护）' : Number(line.partThickness ?? 0) > 0 ? line.partThickness : '待核对';
  return `图纸 ${drawingText}（${drawingSourceText}） | 工艺 ${processText} | 厚度 ${thicknessText} | 规格 ${specificationText}`;
}

function isModelBomLineMissingThickness(line: ModelBom['lines'][number]) {
  return line.lineType !== 'COMPONENT' && Number(line.partThickness ?? 0) <= 0;
}

function orderLineNeedsThicknessReview(line: CreateOrderLinePayload) {
  return line.lineType !== 'COMPONENT' && Number(line.partThickness ?? 0) <= 0;
}

function isBlankOrderLine(line: CreateOrderLinePayload) {
  const partCode = line.partCode?.trim();
  return (
    !partCode &&
    !line.partName?.trim() &&
    !line.drawingNo?.trim() &&
    !line.partSpecification?.trim() &&
    !line.componentNo?.trim() &&
    !line.parentComponentNo?.trim() &&
    (!line.processSteps || line.processSteps.length === 0)
  );
}

function filledOrderFormLines() {
  return orderForm.lines.filter((line) => !isBlankOrderLine(line));
}

function splitBomDefaultProcessRoute(value?: string | null) {
  return String(value || '')
    .split(/[、,，;；\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function nextAvailableOrderComponentNo(usedComponentNos: Set<string>) {
  let maxNo = 0;
  for (const componentNo of usedComponentNos) {
    const matched = /^C(\d+)$/i.exec(componentNo);
    if (matched) {
      maxNo = Math.max(maxNo, Number(matched[1]) || 0);
    }
  }
  for (let nextNo = maxNo + 1; nextNo <= 9999; nextNo += 1) {
    const componentNo = `C${String(nextNo).padStart(3, '0')}`;
    if (!usedComponentNos.has(componentNo)) {
      usedComponentNos.add(componentNo);
      return componentNo;
    }
  }
  throw new Error('当前订单组件编号已超过 C9999，无法继续带入零件包');
}

function buildBomComponentNoMap(bomLines: ModelBom['lines'], existingLines: CreateOrderLinePayload[]) {
  const usedComponentNos = new Set(
    existingLines
      .filter((line) => line.lineType === 'COMPONENT')
      .map((line) => normalizeComponentNo(line.componentNo))
      .filter(Boolean)
  );
  const componentNoMap = new Map<string, string>();

  // BOM 推荐带入时，componentNo 只在当前订单内有效；遇到已有编号必须重映射并同步子零件父级。
  for (const bomLine of bomLines) {
    if (bomLine.lineType !== 'COMPONENT') {
      continue;
    }
    const sourceComponentNo = normalizeComponentNo(bomLine.componentNo);
    if (!sourceComponentNo || componentNoMap.has(sourceComponentNo)) {
      continue;
    }
    if (!usedComponentNos.has(sourceComponentNo)) {
      usedComponentNos.add(sourceComponentNo);
      componentNoMap.set(sourceComponentNo, sourceComponentNo);
      continue;
    }
    componentNoMap.set(sourceComponentNo, nextAvailableOrderComponentNo(usedComponentNos));
  }

  return componentNoMap;
}

function orderImportableModelBomLines(bomLines: ModelBom['lines'], componentNoMap: Map<string, string>) {
  return bomLines.filter((bomLine) => {
    if (bomLine.lineType === 'COMPONENT') {
      const sourceComponentNo = normalizeComponentNo(bomLine.componentNo);
      return Boolean(sourceComponentNo && componentNoMap.has(sourceComponentNo));
    }
    const sourceParentComponentNo = normalizeComponentNo(bomLine.parentComponentNo);
    return !sourceParentComponentNo || componentNoMap.has(sourceParentComponentNo);
  });
}

function modelBomProjectScopeText(bom: ModelBom) {
  const projectModel = bom.projectModel?.trim();
  if (projectModel) {
    return projectModel;
  }
  const importProjectModel = modelBomSearch.projectModel.trim();
  return importProjectModel ? `全部机型/项目（带入 ${importProjectModel}）` : '全部机型/项目';
}

function modelBomImportProjectModel(bom: ModelBom) {
  return bom.projectModel?.trim() || modelBomSearch.projectModel.trim();
}

function scaleModelBomQuantity(value: number, multiplier: number) {
  // BOM 默认数量为 0 时保留为草稿待人工修正，不能静默放大为 1。
  const baseQuantity = Number.isFinite(value) ? Math.max(value, 0) : 1;
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.round(baseQuantity * safeMultiplier * 1000) / 1000;
}

function createLineFromModelBomLine(
  bom: ModelBom,
  bomLine: ModelBom['lines'][number],
  index: number,
  componentNoMap = new Map<string, string>(),
  targetProjectModel = modelBomImportProjectModel(bom),
  quantityMultiplier = 1
): CreateOrderLinePayload {
  const quantity = scaleModelBomQuantity(Number(bomLine.defaultQuantity ?? 1), quantityMultiplier);
  const line = newLine(index);
  line.lineType = bomLine.lineType === 'COMPONENT' ? 'COMPONENT' : 'PART';
  line.partCategory = bomLine.partCategory || '';
  const sourceComponentNo = normalizeComponentNo(bomLine.componentNo);
  const sourceParentComponentNo = normalizeComponentNo(bomLine.parentComponentNo);
  line.componentNo = bomLine.lineType === 'COMPONENT' ? componentNoMap.get(sourceComponentNo) || sourceComponentNo : '';
  line.parentComponentNo = bomLine.lineType === 'PART' ? componentNoMap.get(sourceParentComponentNo) || sourceParentComponentNo : '';
  line.importSequence = '';
  line.partCode = bomLine.partCode;
  line.partName = bomLine.partName;
  // 全部机型 BOM 按当前搜索机型带入订单，避免订单行缺少项目型号影响后续筛选和追溯。
  line.projectModel = targetProjectModel;
  const materialThickness = Number(bomLine.partThickness ?? 0);
  // 父级组件由子零件拼接，不维护自身厚度；子零件和单独零件缺厚度时必须人工补齐。
  line.partThickness = bomLine.lineType === 'COMPONENT' ? 0 : materialThickness > 0 ? materialThickness : 0;
  line.partSpecification = bomLine.partSpecification || '';
  line.drawingNo = bomLine.drawingNo || '';
  line.drawingVersion = bomLine.drawingVersion || line.drawingVersion;
  line.drawingDate = bomLine.drawingDate || undefined;
  line.drawingStatus = bomLine.drawingStatus || '';
  line.drawingFileName = bomLine.drawingFileName || '';
  line.drawingFileUrl = bomLine.drawingFileUrl || '';
  line.quantity = quantity;
  line.productionPlanQuantity = line.quantity;
  line.productionPlanSuggestedQuantity = line.quantity;
  line.unit = bomLine.unit || line.unit;
  line.deliveryDate = orderForm.deliveryDate;
  line.remark = bomLine.remark || '';
  line.fulfillmentMode = 'PRODUCTION';
  line.selectedStockSources = [];
  // BOM 默认工艺只作为下单初始建议，保存订单后每个订单零件仍保留独立流程快照。
  line.processSteps = splitBomDefaultProcessRoute(bomLine.defaultProcessRoute).map((processName) => ({ processName }));
  return line;
}

function buildModelBomApplyPreview(bom: ModelBom) {
  const bomLines = enabledModelBomLines(bom);
  if (bomLines.length === 0) {
    ElMessage.warning('该零件包没有可带入的启用零件');
    return undefined;
  }
  const filledLines = orderForm.lines.filter((line) => !isBlankOrderLine(line));
  const existingPartCodes = new Set(filledLines.map((line) => line.partCode?.trim()).filter(Boolean));
  let componentNoMap: Map<string, string>;
  try {
    componentNoMap = buildBomComponentNoMap(bomLines, filledLines);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件包组件编号生成失败');
    return undefined;
  }
  const importableBomLines = orderImportableModelBomLines(bomLines, componentNoMap);
  const skippedInvalidStructureCount = bomLines.length - importableBomLines.length;
  if (importableBomLines.length === 0) {
    ElMessage.warning('该零件包没有可带入的有效组件结构');
    return undefined;
  }
  const duplicatePartCodes = [...new Set(importableBomLines.map((line) => line.partCode).filter((partCode) => existingPartCodes.has(partCode)))];
  const remappedComponentCount = [...componentNoMap.entries()].filter(([sourceComponentNo, targetComponentNo]) => sourceComponentNo !== targetComponentNo).length;
  return {
    bom,
    componentNoMap,
    importableBomLines,
    skippedInvalidStructureCount,
    duplicatePartCodes,
    remappedComponentCount
  };
}

function openModelBomApplyDialog(bom: ModelBom) {
  const preview = buildModelBomApplyPreview(bom);
  if (!preview) {
    return;
  }
  modelBomApplyPreview.value = preview;
  modelBomApplyQuantityMultiplier.value = 1;
  modelBomApplyDialogVisible.value = true;
}

async function refreshModelBomApplyPreview() {
  const preview = modelBomApplyPreview.value;
  if (!preview?.bom.id) {
    return;
  }

  modelBomApplyRefreshLoading.value = true;
  try {
    const bom = await erpApi.modelBom(preview.bom.id);
    const nextPreview = buildModelBomApplyPreview(bom);
    if (!nextPreview) {
      return;
    }
    modelBomApplyPreview.value = nextPreview;
    modelBomApplySourceOpened.value = false;
    modelBomApplyRefreshReminderShown.value = false;
    modelBomRecommendations.value = modelBomRecommendations.value.map((item) => (item.id === bom.id ? bom : item));
    const missingThicknessCount = nextPreview.importableBomLines.filter(isModelBomLineMissingThickness).length;
    if (missingThicknessCount > 0) {
      ElMessage.warning(`BOM 预览已刷新，仍有 ${missingThicknessCount} 行厚度需核对`);
    } else {
      ElMessage.success('BOM 预览已刷新，厚度需核对已清除');
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'BOM 预览刷新失败，请确认后端服务和 BOM 状态');
  } finally {
    modelBomApplyRefreshLoading.value = false;
  }
}

function closeModelBomApplyDialog() {
  modelBomApplyDialogVisible.value = false;
  modelBomApplyPreview.value = undefined;
  modelBomApplyQuantityMultiplier.value = 1;
  modelBomApplySourceOpened.value = false;
  modelBomApplyRefreshReminderShown.value = false;
}

function modelBomApplyLineFlags(line: CreateOrderLinePayload) {
  const flags: string[] = [];
  if (modelBomApplyPreview.value?.duplicatePartCodes.includes(line.partCode)) {
    flags.push('当前草稿已存在同编码');
  }
  if (orderLineNeedsThicknessReview(line)) {
    flags.push('厚度需核对');
  }
  const componentNo = normalizeComponentNo(line.componentNo);
  const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
  const remappedEntries = [...(modelBomApplyPreview.value?.componentNoMap.entries() || [])].filter(
    ([sourceComponentNo, targetComponentNo]) => sourceComponentNo !== targetComponentNo
  );
  if (remappedEntries.some(([, targetComponentNo]) => targetComponentNo === componentNo || targetComponentNo === parentComponentNo)) {
    flags.push('组件编号已避让');
  }
  return flags.length ? flags.join('；') : '可带入';
}

function formatModelBomApplyMissingThicknessLine(line: CreateOrderLinePayload) {
  const structureText = line.parentComponentNo
    ? `子零件 -> ${normalizeComponentNo(line.parentComponentNo)}`
    : '单独零件';
  const drawingText = [line.drawingNo, line.drawingVersion].filter(Boolean).join(' / ') || '-';
  const specificationText = line.partSpecification || '-';
  return `${structureText} | ${line.partCode || '-'} | ${line.partName || '-'} | 图纸 ${drawingText} | 规格 ${specificationText}`;
}

function openModelBomApplySourceBom() {
  const preview = modelBomApplyPreview.value;
  if (!preview?.bom.id) {
    return;
  }

  const sourceLines = modelBomApplyMissingThicknessSourceLines.value;
  const query: Record<string, string> = {
    bomId: preview.bom.id,
    returnTo: '/orders'
  };

  // 只有一条缺厚度时直接定位并打开该 BOM 明细；多条时先进入 BOM 维护页统一核对。
  if (sourceLines.length === 1 && sourceLines[0]?.id) {
    query.lineId = sourceLines[0].id;
    query.action = 'editLine';
  }

  const routeTarget = router.resolve({
    path: '/inventory/model-boms',
    query
  });
  // BOM 维护在新标签页打开，避免丢失当前未保存的订单草稿和零件包预览上下文。
  const openedWindow = window.open(routeTarget.href, '_blank');
  if (!openedWindow) {
    ElMessage.warning('浏览器阻止了新标签页，请允许弹出窗口后再打开 BOM 维护');
    return;
  }
  openedWindow.opener = null;
  modelBomApplySourceOpened.value = true;
  modelBomApplyRefreshReminderShown.value = false;
  ElMessage.info('BOM 维护页已打开；补齐后回到当前订单页点击“刷新 BOM 预览”。');
}

function handleModelBomApplyWindowFocus() {
  if (
    !modelBomApplyDialogVisible.value ||
    !modelBomApplyPreview.value ||
    !modelBomApplySourceOpened.value ||
    modelBomApplyRefreshReminderShown.value ||
    modelBomApplyRefreshLoading.value
  ) {
    return;
  }

  modelBomApplyRefreshReminderShown.value = true;
  ElMessage.info('如果已在 BOM 维护页补齐厚度，请点击“刷新 BOM 预览”读取最新 BOM。');
}

function confirmApplyModelBomToOrder() {
  const preview = modelBomApplyPreview.value;
  if (!preview) {
    return;
  }
  if (!Number.isFinite(modelBomApplyQuantityMultiplier.value) || modelBomApplyQuantityMultiplier.value <= 0) {
    ElMessage.warning('本次数量倍率必须大于 0');
    return;
  }
  const filledLines = orderForm.lines.filter((line) => !isBlankOrderLine(line));
  const importedLines = modelBomApplyPreviewOrderLines.value.map((line) => ({ ...line }));
  orderForm.lines = [...filledLines, ...importedLines];
  const remapText = preview.remappedComponentCount > 0 ? `，${preview.remappedComponentCount} 个组件编号已避让当前草稿` : '';
  const skippedText = preview.skippedInvalidStructureCount > 0 ? `，已跳过 ${preview.skippedInvalidStructureCount} 个父组件缺失或组件编号无效的 BOM 行` : '';
  const duplicateText = preview.duplicatePartCodes.length > 0 ? `，追加了 ${preview.duplicatePartCodes.length} 个同编码零件` : '';
  const missingThicknessCount = importedLines.filter(orderLineNeedsThicknessReview).length;
  const missingThicknessText = missingThicknessCount > 0 ? `，其中 ${missingThicknessCount} 行厚度需核对` : '';
  closeModelBomApplyDialog();
  ElMessage.success(`已带入 ${importedLines.length} 行零件包明细${remapText}${duplicateText}${skippedText}${missingThicknessText}，请核对数量、图号、厚度和工艺后保存草稿订单`);
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
    orders.value = [];
    expandedMobileOrderIds.value = [];
    ElMessage.error(error instanceof Error ? error.message : '订单列表加载失败，请确认后端服务和筛选条件');
  } finally {
    loading.value = false;
  }
}

async function loadInventorySummary() {
  try {
    inventorySummary.value = await erpApi.inventorySummary({ status: 'AVAILABLE' });
    return true;
  } catch (error) {
    inventorySummary.value = [];
    ElMessage.error(error instanceof Error ? error.message : '库存汇总加载失败，请确认后端服务和库存状态');
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
    ElMessage.error(error instanceof Error ? error.message : '订单选项加载失败，请确认后端服务和筛选条件');
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
      : formatQuantity(order.pendingProductionReplenishmentQuantity ?? 0, order.pendingProductionReplenishmentUnit || order.unit);
    return `生产报废补单待确认 ${order.pendingProductionReplenishmentLineCount ?? 0} 个 / ${quantityText}`;
  }
  const quantityText = order.unresolvedShortageQuantityByUnit?.length
    ? order.unresolvedShortageQuantityByUnit.map((row) => formatQuantity(row.quantity, row.unit)).join('、')
    : formatQuantity(order.unresolvedShortageQuantity ?? 0, order.unresolvedShortageUnit || order.unit);
  return `需补单 ${order.unresolvedShortageLineCount ?? 0} 个 / ${quantityText}`;
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
  // 订单新增必须由操作员在 CustomerSelect 中明确选择客户，避免默认第一个客户造成误下单。
  orderForm.customerId = '';
  orderForm.orderNo = '';
  orderForm.orderDate = todayText();
  orderForm.deliveryDate = defaultDeliveryDate(orderForm.orderDate);
  syncOrderDateRangeFromForm();
  orderForm.lines = [newLine(0), newLine(1), newLine(2)];
  modelBomRecommendationVisible.value = true;
  modelBomRecommendations.value = [];
  modelBomSearch.projectModel = '';
  modelBomSearch.keyword = '';
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
  return isMobileLayout.value || (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
}

async function loadImportConfig() {
  try {
    importConfig.value = await erpApi.orderImportConfig();
  } catch (error) {
    importConfig.value = undefined;
    ElMessage.error(error instanceof Error ? error.message : '导入配置读取失败，请确认后端服务和上传配置');
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
    parts.push(`涉及零件编码 ${session.materialSyncCount} 个${materialSyncPreviewSuffix(session.materialSyncPreview)}`);
  }
  return parts.join(' / ');
}

function materialSyncPreviewSuffix(preview?: string[]) {
  const visiblePreview = (preview || []).filter(Boolean);
  return visiblePreview.length > 0 ? `：${visiblePreview.join('、')}` : '';
}

function materialSyncPreviewText(preview: string[] | undefined, totalCount: number) {
  const suffix = materialSyncPreviewSuffix(preview);
  return suffix
    ? `本次草稿涉及 ${totalCount} 个零件编码${suffix}；仅缺失记录会补建为零件搜索记忆，已有零件搜索记忆不会被订单覆盖。`
    : `本次草稿涉及 ${totalCount} 个零件编码；仅缺失记录会补建为零件搜索记忆，已有零件搜索记忆不会被订单覆盖。`;
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
    if (!append) {
      importSessionHistory.value = [];
      importSessionHistoryTotal.value = 0;
    }
    importSessionHistoryHasMore.value = false;
    ElMessage.error(error instanceof Error ? error.message : '导入记录加载失败，请确认后端服务和导入记忆');
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
    const confirmed = await openOrderConfirmDialog({
      title: '切换导入记录',
      message: '当前已有未提交的导入预览。切换记录不会删除数据，但会把当前弹窗切换到所选导入记录。',
      confirmButtonText: '切换',
      cancelButtonText: '返回',
      confirmButtonType: 'warning'
    });
    if (!confirmed) {
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
  return openOrderConfirmDialog({
    title: '导入警告复核',
    message: `${scopeText}仍有 ${warningCount} 个警告。`,
    details: ['系统可以先创建待提交生产草稿，但厚度、单位、工艺路线、图纸状态等警告内容必须在 ERP 草稿里复核后再提交生产。'],
    confirmButtonText: '已知晓，继续创建草稿',
    cancelButtonText: '返回预览',
    confirmButtonType: 'warning'
  });
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
    importPreview.value = undefined;
    clearImportOrderSelection();
    ElMessage.error(error instanceof Error ? error.message : '导入预览刷新失败，请确认导入记忆和后端服务');
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
    ElMessage.error(error instanceof Error ? error.message : '订单预览加载失败，请确认导入记忆和后端服务');
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
    importFilePreview.value = undefined;
    ElMessage.error(error instanceof Error ? error.message : '上传文件预览失败，请确认导入文件和后端服务');
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
    ElMessage.error(error instanceof Error ? error.message : '上传文件预览加载失败，请确认导入文件和后端服务');
  } finally {
    importFilePreviewLoading.value = false;
  }
}

async function deleteImportFile(fileId: string) {
  if (!importPreview.value?.id || importPreview.value.status !== 'DRAFT') {
    return;
  }
  const file = importPreview.value.files.find((item) => item.id === fileId);
  const confirmed = await openOrderConfirmDialog({
    title: '删除上传文件',
    message: `确定删除上传文件“${displayImportFileName(file?.fileName || fileId)}”吗？`,
    details: ['该文件带来的预览明细会从本次导入中移除。'],
    confirmButtonText: '删除',
    cancelButtonText: '返回',
    confirmButtonType: 'warning'
  });
  if (!confirmed) {
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
  const confirmed = await openOrderConfirmDialog({
    title: '放弃导入',
    message: '确定放弃本次导入预览吗？',
    details: ['已上传但未创建草稿订单的 Excel 数据会被清空。'],
    confirmButtonText: '放弃',
    cancelButtonText: '返回',
    confirmButtonType: 'warning'
  });
  if (!confirmed) {
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
    const confirmed = await openOrderConfirmDialog({
      title: '只创建已勾选订单',
      message: messages[0],
      details: messages.slice(1),
      confirmButtonText: '继续创建已勾选',
      cancelButtonText: '返回勾选',
      confirmButtonType: 'warning'
    });
    if (!confirmed) {
      return;
    }
  }
  if (importPreview.value.orderPage?.hasMore) {
    const confirmed = await openOrderConfirmDialog({
      title: '还有未加载订单',
      message: `当前只显示了 ${importPreview.value.orders.length} / ${importPreview.value.orderPage.totalCount} 个订单预览。`,
      details: [`继续操作只会创建 ${selectedCount} 个已勾选订单，没有勾选的订单不会创建。`],
      confirmButtonText: '继续创建已选',
      cancelButtonText: '返回加载更多',
      confirmButtonType: 'warning'
    });
    if (!confirmed) {
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
    const materialSyncText = `，涉及 ${result.materialSyncCount || 0} 个零件编码${materialSyncPreviewSuffix(result.materialSyncPreview)}，仅补建缺失的零件搜索记忆`;
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
    const confirmed = await openOrderConfirmDialog({
      title: '创建全部可导入草稿',
      message: `确定创建本次导入中 ${importPreview.value.summary.selectableOrderCount} 个可导入订单的草稿吗？`,
      details: ['该操作不依赖前端传入订单号列表，适合大批量导入。', skippedText].filter(Boolean),
      confirmButtonText: '创建全部可导入',
      cancelButtonText: '返回',
      confirmButtonType: importPreview.value.summary.blockedOrderCount > 0 ? 'warning' : 'info'
    });
    if (!confirmed) {
      return;
    }
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
    const materialSyncText = `，涉及 ${result.materialSyncCount || 0} 个零件编码${materialSyncPreviewSuffix(result.materialSyncPreview)}，仅补建缺失的零件搜索记忆`;
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
  // 已提交导入只能删除上传和预览记忆，正式订单与订单来源文字追溯必须保留。
  const message =
    session.status === 'DRAFT'
      ? `确定放弃这次未提交导入吗？${session.fileCount} 个上传文件和 ${session.rowCount} 行预览会被清空。`
      : `确定删除这条导入记忆吗？系统只会删除上传文件、预览行和会话记录，不会删除已经生成的订单。当前仍存在的订单：${importCurrentCommittedOrderNosSummary(session)}。删除后订单仍保留来源文字，但原 Excel 文件不可再预览。${staleCommittedText}`;
  const confirmed = await openOrderConfirmDialog({
    title: session.status === 'DRAFT' ? '放弃导入' : '删除导入记忆',
    message,
    confirmButtonText: session.status === 'DRAFT' ? '放弃' : '删除导入记忆',
    cancelButtonText: '返回',
    confirmButtonType: 'warning'
  });
  if (!confirmed) {
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
    const [removedLine] = orderForm.lines.splice(index, 1);
    clearParentComponentNoAfterRemovingLine(removedLine);
    return;
  }
  orderForm.lines = [newLine(0)];
  ElMessage.info('订单至少保留一行，已清空当前零件');
}

function clearParentComponentNoAfterRemovingLine(removedLine?: CreateOrderLinePayload) {
  const removedComponentNo = normalizeComponentNo(removedLine?.componentNo);
  if (removedLine?.lineType !== 'COMPONENT' || !removedComponentNo) {
    return;
  }
  const stillHasComponent = orderForm.lines.some(
    (line) => line.lineType === 'COMPONENT' && normalizeComponentNo(line.componentNo) === removedComponentNo
  );
  if (stillHasComponent) {
    return;
  }
  // 组件行删除后，只清空仍指向该组件的子零件；已手工指向其他组件的子零件不覆盖。
  for (const line of orderForm.lines) {
    if (line.lineType !== 'COMPONENT' && normalizeComponentNo(line.parentComponentNo) === removedComponentNo) {
      line.parentComponentNo = '';
    }
  }
}

function warnOrderSavingDialogClose() {
  ElMessage.warning('订单操作正在保存，请等待保存完成');
}

function closeCreateOrderDialog() {
  if (saving.value) {
    warnOrderSavingDialogClose();
    return;
  }
  dialogVisible.value = false;
}

function closeCancelOrderDialog() {
  if (saving.value) {
    warnOrderSavingDialogClose();
    return;
  }
  cancelOrderVisible.value = false;
}

function closeDeleteDraftDialog() {
  if (saving.value) {
    warnOrderSavingDialogClose();
    return;
  }
  deleteDraftVisible.value = false;
}

function handleOrderSavingDialogClose(done: () => void) {
  if (saving.value) {
    warnOrderSavingDialogClose();
    return;
  }
  done();
}

function openOrderConfirmDialog(options: {
  title: string;
  message: string;
  details?: string[];
  confirmButtonText: string;
  cancelButtonText?: string;
  confirmButtonType?: OrderConfirmButtonType;
}) {
  if (orderConfirmResolver) {
    orderConfirmResolver(false);
  }
  orderConfirmTitle.value = options.title;
  orderConfirmMessage.value = options.message;
  orderConfirmDetails.value = options.details || [];
  orderConfirmButtonText.value = options.confirmButtonText;
  orderConfirmCancelButtonText.value = options.cancelButtonText || '取消';
  orderConfirmButtonType.value = options.confirmButtonType || 'primary';
  orderConfirmDialogVisible.value = true;
  return new Promise<boolean>((resolve) => {
    orderConfirmResolver = resolve;
  });
}

function resolveOrderConfirm(confirmed: boolean, closeDialog = true) {
  const resolver = orderConfirmResolver;
  orderConfirmResolver = null;
  if (closeDialog) {
    orderConfirmDialogVisible.value = false;
  }
  if (resolver) {
    resolver(confirmed);
  }
}

function cancelOrderConfirm() {
  resolveOrderConfirm(false);
}

function acceptOrderConfirm() {
  resolveOrderConfirm(true);
}

function handleOrderConfirmDialogClose(done: () => void) {
  resolveOrderConfirm(false, false);
  done();
}

async function saveOrder() {
  if (saving.value) {
    return;
  }
  if (!orderForm.customerId) {
    ElMessage.warning('请选择客户');
    return;
  }
  if (!orderForm.orderNo.trim()) {
    ElMessage.warning('请填写订单号');
    return;
  }
  const filledLines = filledOrderFormLines();
  if (filledLines.length === 0) {
    ElMessage.warning('订单至少需要一个零件');
    return;
  }
  if (
    filledLines.some(
      (line) =>
        !line.partCode ||
        !line.partName ||
        orderLineNeedsThicknessReview(line) ||
        !line.quantity ||
        (line.productionPlanQuantity === undefined || line.productionPlanQuantity === null) ||
        !line.unit
    )
  ) {
    ElMessage.warning('请补齐订单零件、厚度等必填信息');
    return;
  }
  const componentStructureMessage = validateOrderFormComponentStructure(filledLines);
  if (componentStructureMessage) {
    ElMessage.warning(componentStructureMessage);
    return;
  }
  if (!(await loadInventorySummary())) {
    return;
  }
  const stockCheck = validateStockModeLines(filledLines, inventorySummary.value);
  if (!stockCheck.ok) {
    ElMessage.warning(`待提交生产订单可先保存；${stockCheck.message}，提交生产前必须补足`);
  }
  const draftStockCheck = validateDraftStockSourceLines(filledLines);
  if (!draftStockCheck.ok) {
    ElMessage.warning(draftStockCheck.message);
    return;
  }
  if (draftStockCheck.warning) {
    ElMessage.warning(draftStockCheck.warning);
  }
  if (!(await confirmDuplicateDrawingNos(filledLines))) {
    return;
  }
  if (!(await confirmDuplicateDrawingFiles(filledLines))) {
    return;
  }
  if (!(await confirmExistingDrawingNos(filledLines))) {
    return;
  }
  if (!(await confirmExistingDrawingFiles(filledLines))) {
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
      lines: normalizedLines(filledLines)
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
  // 订单制单日期必须按本地业务日期生成，避免 UTC 日期在凌晨回退到前一天。
  return formatDateInputValue(new Date());
}

function defaultDeliveryDate(orderDate: string) {
  const date = orderDate ? toDateOnly(orderDate) : new Date();
  date.setDate(date.getDate() + 14);
  return formatDateInputValue(date);
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

function normalizedLines(lines = filledOrderFormLines()) {
  return lines.map((line) => sanitizeOrderLinePayload(line, orderForm.deliveryDate));
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
  cancelOrderForm.cancelAt = formatDateTime(new Date());
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
  if (saving.value) {
    return;
  }
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
  // 已取消任务只保留历史，不参与订单取消时的已生产处理计划。
  return task.status !== 'CANCELLED' && (task.status !== 'PENDING' || task.completedQuantity > 0);
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
  if (saving.value) {
    return;
  }
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
  window.addEventListener('focus', handleModelBomApplyWindowFocus);
  await loadOrderOptions();
  await loadOrders();
});

onBeforeUnmount(() => {
  window.removeEventListener('focus', handleModelBomApplyWindowFocus);
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

.order-confirm-panel {
  display: grid;
  gap: 10px;
  color: #475569;
  font-size: 14px;
  line-height: 1.65;
}

.order-confirm-panel p {
  margin: 0;
}

.order-confirm-panel ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
}

.model-bom-recommendation {
  display: grid;
  gap: 12px;
  margin: 0 0 14px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #dbeafe;
  border-radius: 8px;
}

.model-bom-recommendation-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(360px, 1.5fr);
  align-items: end;
  gap: 12px;
}

.model-bom-recommendation-title {
  display: grid;
  gap: 4px;
}

.model-bom-recommendation-title span {
  color: #64748b;
  font-size: 12px;
}

.model-bom-recommendation-search {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) auto;
  gap: 8px;
}

.model-bom-card-list {
  display: grid;
  gap: 8px;
}

.model-bom-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.model-bom-card-main {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.model-bom-card-title,
.model-bom-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.model-bom-card-meta {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.model-bom-structure-preview {
  display: grid;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
  padding: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
}

.model-bom-structure-group {
  display: grid;
  gap: 5px;
}

.model-bom-structure-main,
.model-bom-structure-child {
  display: grid;
  grid-template-columns: 28px 108px minmax(180px, 1fr) minmax(220px, 1.25fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: #fff;
}

.model-bom-structure-child {
  margin-left: 28px;
  background: #f0fdf4;
}

.model-bom-structure-main > span:first-child,
.model-bom-structure-child > span:first-child {
  color: #64748b;
  font-size: 12px;
}

.model-bom-structure-main strong,
.model-bom-structure-child strong,
.model-bom-structure-main > span:last-child,
.model-bom-structure-child > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-bom-structure-main > span:last-child,
.model-bom-structure-child > span:last-child {
  color: #475569;
  font-size: 12px;
}

.model-bom-apply-preview {
  display: grid;
  gap: 12px;
}

.model-bom-apply-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.model-bom-apply-summary > div {
  display: grid;
  gap: 4px;
}

.model-bom-apply-summary span,
.model-bom-apply-summary label {
  color: #64748b;
  font-size: 12px;
}

.model-bom-apply-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.model-bom-apply-review-list {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 8px;
}

.model-bom-apply-review-list > strong {
  color: #9a3412;
}

.model-bom-apply-review-item {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.model-bom-apply-review-item > span:last-child {
  overflow: hidden;
  color: #7c2d12;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-bom-apply-structure {
  display: grid;
  gap: 8px;
  max-height: 460px;
  overflow: auto;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.model-bom-apply-group {
  display: grid;
  gap: 6px;
}

.model-bom-apply-main,
.model-bom-apply-child {
  display: grid;
  grid-template-columns: 34px 120px minmax(220px, 1fr) minmax(300px, 1.35fr) minmax(150px, 0.7fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 8px 10px;
  background: #fff;
  border-radius: 6px;
}

.model-bom-apply-child {
  margin-left: 34px;
  background: #f0fdf4;
}

.model-bom-apply-main > span:first-child,
.model-bom-apply-child > span:first-child,
.model-bom-apply-main small,
.model-bom-apply-child small {
  color: #64748b;
  font-size: 12px;
}

.model-bom-apply-main strong,
.model-bom-apply-child strong,
.model-bom-apply-main > span:nth-child(4),
.model-bom-apply-child > span:nth-child(4),
.model-bom-apply-main small,
.model-bom-apply-child small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-form-structure-panel {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.order-form-structure-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.order-form-structure-header > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.order-form-structure-header span {
  color: #64748b;
  font-size: 12px;
}

.structure-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.structure-textarea :deep(textarea) {
  min-height: 500px;
  font-family: Consolas, 'Courier New', monospace;
  line-height: 1.55;
  white-space: pre;
}

.order-form-structure-list {
  display: grid;
  gap: 8px;
  max-height: 260px;
  overflow: auto;
}

.order-form-structure-group {
  display: grid;
  gap: 6px;
}

.order-form-structure-main,
.order-form-structure-child {
  display: grid;
  grid-template-columns: 34px 118px minmax(220px, 1fr) minmax(320px, 1.45fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fff;
}

.order-form-structure-child {
  margin-left: 34px;
  background: #f0fdf4;
}

.order-form-structure-main > span:first-child,
.order-form-structure-child > span:first-child {
  color: #64748b;
  font-size: 12px;
}

.order-form-structure-main strong,
.order-form-structure-child strong,
.order-form-structure-main > span:last-child,
.order-form-structure-child > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-form-structure-main > span:last-child,
.order-form-structure-child > span:last-child {
  color: #475569;
  font-size: 12px;
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

.import-structure-panel {
  display: grid;
  gap: 10px;
  margin: 10px 0 12px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.import-structure-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.import-structure-header span {
  color: #64748b;
  font-size: 12px;
}

.import-structure-list {
  display: grid;
  gap: 8px;
}

.import-structure-group {
  display: grid;
  gap: 6px;
}

.import-structure-main,
.import-structure-child {
  display: grid;
  grid-template-columns: 34px 118px minmax(220px, 1fr) minmax(280px, 1.35fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fff;
}

.import-structure-child {
  margin-left: 34px;
  background: #f0fdf4;
}

.import-structure-main > span:first-child,
.import-structure-child > span:first-child {
  color: #64748b;
  font-size: 12px;
}

.import-structure-main strong,
.import-structure-child strong,
.import-structure-main > span:last-child,
.import-structure-child > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-structure-main > span:last-child,
.import-structure-child > span:last-child {
  color: #475569;
  font-size: 12px;
}

.import-file-preview-panel {
  min-height: 180px;
}

.import-file-structure-panel {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.import-file-structure-orders {
  display: grid;
  gap: 10px;
  max-height: 360px;
  overflow: auto;
}

.import-file-structure-order {
  display: grid;
  gap: 8px;
}

.import-file-structure-order__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 0 2px;
}

.import-file-structure-order__title span {
  color: #64748b;
  font-size: 12px;
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

.import-line-structure-cell {
  display: grid;
  gap: 4px;
  align-items: start;
}

.import-line-structure-cell small {
  color: #64748b;
  font-size: 12px;
  line-height: 16px;
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

  .model-bom-recommendation-toolbar,
  .model-bom-recommendation-search,
  .model-bom-card {
    grid-template-columns: 1fr;
  }

  .model-bom-line-preview {
    white-space: normal;
  }

  .model-bom-structure-main,
  .model-bom-structure-child {
    grid-template-columns: 28px minmax(92px, auto) minmax(0, 1fr);
  }

  .model-bom-structure-main > span:last-child,
  .model-bom-structure-child > span:last-child {
    grid-column: 3;
    white-space: normal;
  }

  .model-bom-structure-child {
    margin-left: 16px;
  }

  .model-bom-apply-summary {
    align-items: stretch;
    flex-direction: column;
  }

  .model-bom-apply-main,
  .model-bom-apply-child {
    grid-template-columns: 28px minmax(92px, auto) minmax(0, 1fr);
  }

  .model-bom-apply-main > span:nth-child(4),
  .model-bom-apply-child > span:nth-child(4),
  .model-bom-apply-main small,
  .model-bom-apply-child small {
    grid-column: 3;
    white-space: normal;
  }

  .model-bom-apply-review-item {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .model-bom-apply-review-item > span:last-child {
    white-space: normal;
  }

  .model-bom-apply-child {
    margin-left: 16px;
  }

  .order-form-structure-header {
    align-items: stretch;
    flex-direction: column;
  }

  .order-form-structure-main,
  .order-form-structure-child {
    grid-template-columns: 28px minmax(92px, auto) minmax(0, 1fr);
  }

  .order-form-structure-main > span:last-child,
  .order-form-structure-child > span:last-child {
    grid-column: 3;
    white-space: normal;
  }

  .order-form-structure-child {
    margin-left: 16px;
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

  .import-structure-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .import-structure-main,
  .import-structure-child {
    grid-template-columns: 28px minmax(92px, auto) minmax(0, 1fr);
  }

  .import-structure-main > span:last-child,
  .import-structure-child > span:last-child {
    grid-column: 3;
    white-space: normal;
  }

  .import-structure-child {
    margin-left: 16px;
  }

  .import-file-actions {
    justify-content: flex-start;
  }

  .import-file-structure-order__title {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }
}
</style>
