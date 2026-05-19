<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">生产管理</h2>
      <div class="page-actions">
        <el-button v-if="isMobileLayout" :icon="Camera" plain @click="showMobileScanReserved">扫码</el-button>
        <el-badge :value="pendingNoticeCount" :hidden="pendingNoticeCount === 0" class="notice-badge">
          <el-button :icon="Bell" @click="openNotices">通知</el-button>
        </el-badge>
        <el-badge
          :value="pendingReplenishmentRequestCount"
          :hidden="pendingReplenishmentRequestCount === 0"
          class="notice-badge"
        >
        <el-button :icon="Document" @click="openReplenishmentRequests">生产报废补单</el-button>
        </el-badge>
        <el-button :icon="Document" @click="openScrapRecords">报废统计</el-button>
        <el-button title="导出Excel"
          :icon="Download"
          :loading="productionExporting"
          :disabled="printableRowCount === 0"
          @click="exportExcel"
        >
          导出 Excel
        </el-button>
        <el-button :icon="Printer" :disabled="printableRowCount === 0" @click="openPrintPreview">打印预览</el-button>
        <el-button title="刷新整页生产数据" :icon="Refresh" :loading="productionPageRefreshing || loading" @click="refreshProductionPage">刷新</el-button>
      </div>
    </div>

    <div class="filter-bar production-filter">
      <div class="filter-field">
        <label>订单日期</label>
        <DateRangeFilter v-model="dateRange" @change="handleScopeChange" />
      </div>

      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect
          v-model="filters.customerId"
          placeholder="全部客户"
          width="260px"
          @change="handleScopeChange"
        />
      </div>

      <div class="filter-field">
        <label>订单</label>
        <OrderSelect
          v-model="filters.orderNo"
          :orders="orderOptions"
          placeholder="全部订单"
          width="320px"
          @change="handleOrderFilterChange"
        />
      </div>

      <el-button title="查询" type="primary" :loading="loading" @click="queryTasks">查询</el-button>
      <el-button title="重置" @click="resetFilters">重置</el-button>
    </div>

    <div class="stat-grid">
      <button
        v-for="item in productionStatCards"
        :key="item.key"
        type="button"
        :class="['stat-card', 'stat-card-button', { active: isProductionStatActive(item.key) }]"
        @click="handleProductionStatClick(item.key)"
      >
        <div class="stat-label">{{ item.label }}</div>
        <div class="stat-value">{{ item.value }}</div>
      </button>
    </div>

    <div class="production-view-toolbar">
      <el-radio-group v-model="viewMode" size="large" @change="handleViewModeChange">
        <el-radio-button value="ORDER_SUMMARY">订单汇总</el-radio-button>
        <el-radio-button value="TASK_DETAIL">零件任务明细</el-radio-button>
      </el-radio-group>
      <div v-if="!isMobileLayout" class="production-table-height-actions" :aria-label="productionWorkTableHeightLabel">
        <span class="production-table-height-label">{{ productionWorkTableHeightLabel }}</span>
        <el-button-group>
          <el-button
            size="small"
            :icon="Minus"
            :disabled="activeProductionWorkTableHeight <= productionWorkTableHeightLimits.min"
            :title="`降低${productionWorkTableHeightLabel}`"
            :aria-label="`降低${productionWorkTableHeightLabel}`"
            @click="adjustActiveProductionWorkTableHeight(-productionWorkTableHeightLimits.step)"
          />
          <el-button
            size="small"
            :icon="Plus"
            :disabled="activeProductionWorkTableHeight >= productionWorkTableHeightLimits.max"
            :title="`提高${productionWorkTableHeightLabel}`"
            :aria-label="`提高${productionWorkTableHeightLabel}`"
            @click="adjustActiveProductionWorkTableHeight(productionWorkTableHeightLimits.step)"
          />
          <el-button
            size="small"
            :icon="RefreshLeft"
            :disabled="activeProductionWorkTableHeight === activeProductionWorkTableDefaultHeight"
            :title="productionWorkTableResetLabel"
            :aria-label="productionWorkTableResetLabel"
            @click="resetActiveProductionWorkTableHeight"
          />
        </el-button-group>
      </div>
      <div v-if="selectedProductionOrderNo" class="detail-scope">
        <span class="current-order-text">
          当前订单：
          <OrderNoLink :order-no="selectedProductionOrderNo" />
        </span>
        <el-button title="查看订单明细" size="small" @click="goSelectedOrderDetail">查看订单明细</el-button>
        <el-button title="返回订单汇总" size="small" @click="backToOrderSummary">返回订单汇总</el-button>
        <el-button
          type="primary"
          plain
          size="small"
          :disabled="selectedOrderPendingTasks.length === 0"
          @click="openBatchStartForCurrentOrder"

          title="批量开始待确认生产">
          批量开始待确认生产
        </el-button>
        <el-button
          type="primary"
          size="small"
          :disabled="selectedStartableTasks.length === 0"
          @click="openBatchStartForSelected"

          title="批量开始所选">
          批量开始所选
        </el-button>
      </div>
    </div>

    <section v-if="selectedProductionOrderNo && selectedOrderOverview" class="order-production-overview">
      <div class="order-overview-title">
        <span>订单生产概况</span>
        <strong><OrderNoLink :order-no="selectedOrderOverview.orderNo" /></strong>
        <small>
          {{ selectedOrderOverview.customerName }} / 订单 {{ formatDate(selectedOrderOverview.orderDate) }} / 交期
          {{ formatDate(selectedOrderOverview.deliveryDate) }}
        </small>
      </div>
      <div class="order-overview-metrics">
        <div>
          <span>零件 / 任务</span>
          <strong>{{ selectedOrderOverview.partCount }} / {{ selectedOrderOverview.taskCount }}</strong>
        </div>
        <div>
          <span>生产数量</span>
          <strong>{{ orderSummaryQuantityText(selectedOrderOverview) }}</strong>
        </div>
        <div>
          <span>整体进度</span>
          <strong>{{ selectedOrderOverview.progressPercent }}%</strong>
        </div>
        <div>
          <span>当前进度</span>
          <strong>{{ orderSummaryProgressText(selectedOrderOverview) }}</strong>
        </div>
      </div>
      <div class="order-overview-progress">
        <el-progress :percentage="selectedOrderOverview.progressPercent" :stroke-width="10" />
        <div class="summary-status-chain">
          <span v-if="selectedOrderOverview.pendingCount">待确认生产 {{ selectedOrderOverview.pendingCount }}</span>
          <span v-if="selectedOrderOverview.inProgressCount">生产中 {{ selectedOrderOverview.inProgressCount }}</span>
          <span v-if="selectedOrderOverview.readyToCompleteCount">待确认完成 {{ selectedOrderOverview.readyToCompleteCount }}</span>
          <span v-if="selectedOrderOverview.completedCount">已完成 {{ selectedOrderOverview.completedCount }}</span>
          <span v-if="selectedOrderOverview.receivedCount">已入库 {{ selectedOrderOverview.receivedCount }}</span>
        </div>
      </div>
    </section>

    <template v-if="viewMode === 'ORDER_SUMMARY'">
      <el-tabs v-model="activeOrderStatus" class="mt-16" @tab-change="handleOrderStatusTabChange">
        <el-tab-pane label="全部" name="ALL" />
        <el-tab-pane label="待处理" name="ACTIVE" />
        <el-tab-pane label="待确认生产" name="PENDING" />
        <el-tab-pane label="生产中" name="IN_PROGRESS" />
        <el-tab-pane label="待确认完成" name="READY_TO_COMPLETE" />
        <el-tab-pane label="已完成" name="COMPLETED" />
        <el-tab-pane label="已入库" name="RECEIVED" />
      </el-tabs>

      <div class="table-card desktop-table">
        <el-table v-loading="loading" :data="filteredOrderSummaries" :max-height="productionWorkTableHeights.orderSummary">
          <el-table-column label="订单号" min-width="170">
            <template #default="{ row }">
              <OrderNoLink :order-no="row.orderNo" />
            </template>
          </el-table-column>
          <el-table-column prop="customerName" label="客户" min-width="170" />
          <el-table-column label="订单日期" width="115">
            <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
          </el-table-column>
          <el-table-column label="交期" width="115">
            <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
          </el-table-column>
          <el-table-column label="零件/任务" width="110">
            <template #default="{ row }">{{ row.partCount }} / {{ row.taskCount }}</template>
          </el-table-column>
          <el-table-column label="生产数量" min-width="190">
            <template #default="{ row }">{{ orderSummaryQuantityText(row) }}</template>
          </el-table-column>
          <el-table-column label="订单进度" min-width="160">
            <template #default="{ row }">
              <el-progress :percentage="row.progressPercent" :stroke-width="10" />
            </template>
          </el-table-column>
          <el-table-column label="当前进度" min-width="220">
            <template #default="{ row }">
              <div class="summary-status-chain">
                <span v-for="item in orderSummaryProgressPreviewItems(row)" :key="item">{{ item }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="待补单" min-width="180">
            <template #default="{ row }">
              <el-button v-if="orderSummaryNeedsShortageAttention(row)" link type="warning" @click="goOrderShortageDetail(row)"
  :title="orderSummaryShortageActionText(row)">
                {{ orderSummaryShortageActionText(row) }}
              </el-button>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="状态分布" min-width="230">
            <template #default="{ row }">
              <div class="summary-status-chain">
                <span v-if="row.pendingCount">待确认生产 {{ row.pendingCount }}</span>
                <span v-if="row.inProgressCount">生产中 {{ row.inProgressCount }}</span>
                <span v-if="row.readyToCompleteCount">待确认完成 {{ row.readyToCompleteCount }}</span>
                <span v-if="row.completedCount">已完成 {{ row.completedCount }}</span>
                <span v-if="row.receivedCount">已入库 {{ row.receivedCount }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="订单状态" width="130">
            <template #default="{ row }">
              <el-tag :type="productionStatusTagType(row.status)" effect="light" round>
                {{ productionStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <div class="production-order-actions">
                <div class="production-order-action-group">
                  <span class="production-order-action-label">详情</span>
                  <el-button link type="primary" title="进入生产详情" @click="openOrderProductionDetail(row)">详情</el-button>
                </div>
                <div v-if="orderSummaryNeedsShortageAttention(row) || row.pendingCount > 0" class="production-order-action-group">
                  <span class="production-order-action-label">处理</span>
                  <el-button v-if="orderSummaryNeedsShortageAttention(row)" link type="warning" title="处理补单" @click="goOrderShortageDetail(row)">
                    补单
                  </el-button>
                  <el-button v-if="row.pendingCount > 0" link type="primary" title="批量开始生产" @click="openBatchStartForOrder(row)">
                    批量
                  </el-button>
                </div>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-loading="loading" class="mobile-card-list">
        <article
          v-for="summary in filteredOrderSummaries"
          :key="summary.orderId"
          class="mobile-card mobile-order-card"
          :class="{ expanded: isMobileProductionOrderExpanded(summary.orderId) }"
        >
          <div class="mobile-card-header">
            <div class="mobile-card-title">
              <strong><OrderNoLink :order-no="summary.orderNo" /></strong>
              <small>{{ summary.customerName }}</small>
            </div>
            <div class="mobile-card-header-actions">
              <el-tag :type="productionStatusTagType(summary.status)" effect="light" round>
                {{ productionStatusLabel(summary.status) }}
              </el-tag>
              <el-button link type="primary" @click.stop="toggleMobileProductionOrderCard(summary.orderId)">
                {{ isMobileProductionOrderExpanded(summary.orderId) ? '收起' : '详情' }}
              </el-button>
            </div>
          </div>
          <div class="mobile-card-compact-summary">
            <span>交期 {{ formatDate(summary.deliveryDate) }}</span>
            <span>任务 {{ summary.taskCount }} 个</span>
            <span>{{ summary.progressPercent }}%</span>
          </div>
          <div v-show="isMobileProductionOrderExpanded(summary.orderId)" class="mobile-card-fields">
            <div class="mobile-field">
              <label>订单日期</label>
              <span>{{ formatDate(summary.orderDate) }}</span>
            </div>
            <div class="mobile-field">
              <label>交期</label>
              <span>{{ formatDate(summary.deliveryDate) }}</span>
            </div>
            <div class="mobile-field">
              <label>零件/任务</label>
              <span>{{ summary.partCount }} / {{ summary.taskCount }}</span>
            </div>
            <div class="mobile-field">
              <label>进度</label>
              <span>{{ summary.progressPercent }}%</span>
            </div>
            <div class="mobile-field mobile-full">
              <label>生产数量</label>
              <span>{{ orderSummaryQuantityText(summary) }}</span>
            </div>
            <div class="mobile-field mobile-full">
              <label>当前进度</label>
              <span>{{ orderSummaryProgressText(summary) }}</span>
            </div>
            <div v-if="orderSummaryNeedsShortageAttention(summary)" class="mobile-field mobile-full warning">
              <label>待补单</label>
              <span>{{ orderSummaryShortageActionText(summary) }}</span>
            </div>
          </div>
          <div class="mobile-card-actions">
            <el-button link type="primary" @click="openOrderProductionDetail(summary)">进入生产详情</el-button>
            <el-button v-if="orderSummaryNeedsShortageAttention(summary)" link type="warning" @click="goOrderShortageDetail(summary)"
  title="处理补单">
              处理补单
            </el-button>
            <el-button v-if="summary.pendingCount > 0" link type="primary" @click="openBatchStartForOrder(summary)"
              title="批量开始生产">
              批量开始生产
            </el-button>
          </div>
        </article>
        <div v-if="!filteredOrderSummaries.length && !loading" class="mobile-empty">暂无生产订单</div>
      </div>
      <div class="production-list-pagination">
        <span>共 {{ orderSummaryPagination.totalCount }} 条，当前第 {{ orderSummaryPagination.page }} 页</span>
        <el-pagination
          background
          layout="prev, pager, next, jumper"
          :current-page="orderSummaryPagination.page"
          :page-size="orderSummaryPagination.limit"
          :total="orderSummaryPagination.totalCount"
          @current-change="handleOrderSummaryPageChange"
        />
      </div>
    </template>

    <template v-else>
      <el-tabs v-model="activeStatus" class="mt-16" @tab-change="handleTaskStatusTabChange">
        <el-tab-pane label="全部" name="ALL" />
        <el-tab-pane label="待确认生产" name="PENDING" />
        <el-tab-pane label="生产中" name="IN_PROGRESS" />
        <el-tab-pane label="待确认完成" name="READY_TO_COMPLETE" />
        <el-tab-pane label="已完成" name="COMPLETED" />
        <el-tab-pane label="已入库" name="RECEIVED" />
      </el-tabs>

      <el-alert
        v-if="selectedProductionOrderNo && !scopedTasks.length && !loading"
        class="mt-16"
        type="info"
        :closable="false"
        show-icon
      >
        <template #title>
          该订单当前没有需要车间处理的生产任务
        </template>
        <template #default>
          <div class="empty-production-hint">
            <span>
              <OrderNoLink :order-no="selectedProductionOrderNo" /> 可能已全量使用库存，订单库存已进入仓库待发货。可查看订单明细或到仓库待发货继续处理。
            </span>
            <div class="empty-production-actions">
              <el-button title="查看订单明细" size="small" @click="goSelectedOrderDetail">查看订单明细</el-button>
              <el-button size="small" type="primary" @click="goSelectedOrderWarehouse"
                title="到仓库待发货">到仓库待发货</el-button>
            </div>
          </div>
        </template>
      </el-alert>

    <div class="table-card desktop-table">
      <el-table
        v-loading="loading"
        :data="filteredTasks"
        :max-height="productionWorkTableHeights.taskDetail"
        @selection-change="handleTaskSelectionChange"
      >
        <el-table-column
          v-if="selectedProductionOrderNo"
          type="selection"
          width="48"
          :selectable="canBatchSelectTask"
        />
        <el-table-column label="任务号" min-width="190">
          <template #default="{ row }">
            <div class="cell-main">{{ row.productionTaskNo }}</div>
            <div v-if="taskRelationText(row)" class="cell-subtext">{{ taskRelationText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="订单号" min-width="165">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="160" />
        <el-table-column label="订单日期" width="110">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="110">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column prop="partName" label="零件" min-width="140" />
        <el-table-column label="客户订单" width="115">
          <template #default="{ row }">
            {{ formatCustomerOrderQuantity(row) }}
          </template>
        </el-table-column>
        <el-table-column label="完成 / 生产计划" width="140">
          <template #default="{ row }">
            <div class="cell-main">{{ formatCompletedPlan(row) }}</div>
            <div v-if="shortageSummary(row)" class="cell-subtext warning">{{ shortageSummary(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="生产流程" min-width="280">
          <template #default="{ row }">
            <div class="process-chain">
              <button
                v-for="step in row.processSteps"
                :key="step"
                type="button"
                :class="[
                  'process-pill',
                  'process-step-button',
                  {
                    completed: isProcessCompleted(row, step),
                    current: isCurrentProcess(row, step),
                    locked: !canOpenProcess(row, step)
                  }
                ]"
                :disabled="!canOpenProcess(row, step)"
                :title="processButtonTitle(row, step)"
                @click="openProcessCompletion(row, step)"
              >
                {{ processStepDisplay(row, step) }}
              </button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="当前工序" min-width="140">
          <template #default="{ row }">
            <div class="cell-main">{{ currentProcessText(row) }}</div>
            <div class="cell-subtext">{{ processProgressText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <StatusTag :value="effectiveProductionStatus(row)" :label-override="productionStatusLabel(effectiveProductionStatus(row))" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <div class="production-task-actions">
              <div v-if="pendingProductionReplenishmentRequest(row)" class="production-task-action-group">
                <span class="production-task-action-label">补单</span>
                <el-button link type="warning" title="主管确认补单" @click="openReplenishmentApproval(row)">
                  确认
                </el-button>
              </div>
              <div
                v-if="
                  shouldShowStartAction(row) ||
                  shouldShowConfirmCompletedAction(row) ||
                  shouldShowNextProcessAction(row) ||
                  canModifyFinalCompletion(row) ||
                  (!canWithdrawProduction(row) && ['RECEIVED', 'COMPLETED'].includes(effectiveProductionStatus(row)))
                "
                class="production-task-action-group"
              >
                <span class="production-task-action-label">生产</span>
                <el-button v-if="shouldShowStartAction(row)" link type="primary" title="开始生产" @click="openStartDialog(row)">
                  开始
                </el-button>
                <el-button
                  v-else-if="shouldShowConfirmCompletedAction(row)"
                  link
                  type="success"
                  title="确认完成"
                  @click="confirmCompletedTask(row)"
                >
                  完成
                </el-button>
                <el-button v-else-if="shouldShowNextProcessAction(row)" link type="primary" title="下一道工序" @click="openNextProcess(row)">
                  下道
                </el-button>
                <el-button v-else-if="canModifyFinalCompletion(row)" link type="primary" title="修改完成确认" @click="confirmCompletedTask(row)">
                  修改
                </el-button>
                <span v-else-if="effectiveProductionStatus(row) === 'RECEIVED'" class="muted">已入库</span>
                <span v-else-if="effectiveProductionStatus(row) === 'COMPLETED'" class="muted">已完成</span>
              </div>
              <div v-if="canWithdrawProduction(row)" class="production-task-action-group">
                <span class="production-task-action-label">管理</span>
                <el-button link type="danger" title="管理撤回" @click="withdrawProduction(row)">
                  撤回
                </el-button>
              </div>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list">
      <article
        v-for="task in filteredTasks"
        :key="task.id"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileProductionTaskExpanded(task.id) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ task.partName }}</strong>
            <small>{{ task.productionTaskNo }}</small>
            <small v-if="taskRelationText(task)">{{ taskRelationText(task) }}</small>
          </div>
          <div class="mobile-card-header-actions production-task-header-actions">
            <el-checkbox
              v-if="selectedProductionOrderNo && shouldShowStartAction(task)"
              :model-value="selectedStartableTaskIds.includes(task.id)"
              :value="task.id"
              class="mobile-start-checkbox"
              @change="toggleMobileStartSelection(task, Boolean($event))"
            >
              勾选生产
            </el-checkbox>
            <el-button link type="primary" @click.stop="toggleMobileProductionTaskCard(task.id)">
              {{ isMobileProductionTaskExpanded(task.id) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span><StatusTag :value="effectiveProductionStatus(task)" :label-override="productionStatusLabel(effectiveProductionStatus(task))" compact /></span>
          <span>{{ formatCompletedPlan(task) }}</span>
          <span>{{ currentProcessText(task) }}</span>
        </div>
        <div v-show="isMobileProductionTaskExpanded(task.id)" class="mobile-card-fields">
          <div class="mobile-field">
            <label>状态</label>
            <span>
              <StatusTag :value="effectiveProductionStatus(task)" :label-override="productionStatusLabel(effectiveProductionStatus(task))" />
            </span>
          </div>
          <div class="mobile-field mobile-full">
            <label>订单号</label>
            <span><OrderNoLink :order-no="task.orderNo" /></span>
          </div>
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ task.customerName }}</span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(task.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(task.deliveryDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>客户订单</label>
            <span>{{ formatCustomerOrderQuantity(task) }}</span>
          </div>
          <div class="mobile-field">
            <label>完成 / 生产计划</label>
            <span>{{ formatCompletedPlan(task) }}</span>
          </div>
          <div v-if="shortageSummary(task)" class="mobile-field mobile-full">
            <label>短缺处理</label>
            <span>{{ shortageSummary(task) }}</span>
          </div>
          <div class="mobile-field mobile-full">
            <label>生产流程</label>
            <div class="process-chain">
              <button
                v-for="step in task.processSteps"
                :key="step"
                type="button"
                :class="[
                  'process-pill',
                  'process-step-button',
                  {
                    completed: isProcessCompleted(task, step),
                    current: isCurrentProcess(task, step),
                    locked: !canOpenProcess(task, step)
                  }
                ]"
                :disabled="!canOpenProcess(task, step)"
                :title="processButtonTitle(task, step)"
                @click="openProcessCompletion(task, step)"
              >
                {{ processStepDisplay(task, step) }}
              </button>
            </div>
          </div>
          <div class="mobile-field">
            <label>当前工序</label>
            <span>{{ currentProcessText(task) }}</span>
          </div>
          <div class="mobile-field">
            <label>工序进度</label>
            <span>{{ processProgressText(task) }}</span>
          </div>
        </div>
        <div v-show="isMobileProductionTaskExpanded(task.id)" class="mobile-card-actions">
          <el-button
            v-if="pendingProductionReplenishmentRequest(task)"
            link
            type="warning"
            @click="openReplenishmentApproval(task)"

          title="主管确认补单">
            主管确认补单
          </el-button>
          <el-button v-if="shouldShowStartAction(task)" link type="primary" @click="openStartDialog(task)"
            title="开始生产">开始生产</el-button>
          <el-button
            v-else-if="shouldShowConfirmCompletedAction(task)"
            link
            type="success"
            @click="confirmCompletedTask(task)"

            title="确认完成">
            确认完成
          </el-button>
          <el-button v-else-if="shouldShowNextProcessAction(task)" link type="primary" @click="openNextProcess(task)">
            下一道工序
          </el-button>
          <el-button v-else-if="canModifyFinalCompletion(task)" link type="primary" @click="confirmCompletedTask(task)"
            title="修改完成确认">
            修改完成确认
          </el-button>
          <el-button v-if="canWithdrawProduction(task)" link type="danger" @click="withdrawProduction(task)"
  title="管理撤回">
            管理撤回
          </el-button>
          <span v-if="effectiveProductionStatus(task) === 'RECEIVED'" class="muted">已入库</span>
          <span v-else-if="effectiveProductionStatus(task) === 'COMPLETED'" class="muted">已完成</span>
        </div>
      </article>
      <div v-if="!filteredTasks.length && !loading" class="mobile-empty">暂无生产任务</div>
    </div>
    <div class="production-list-pagination">
      <span>共 {{ taskPagination.totalCount }} 条，当前第 {{ taskPagination.page }} 页</span>
      <el-pagination
        background
        layout="prev, pager, next, jumper"
        :current-page="taskPagination.page"
        :page-size="taskPagination.limit"
        :total="taskPagination.totalCount"
        @current-change="handleTaskPageChange"
      />
    </div>
    </template>

    <el-dialog
      v-model="startConfirmVisible"
      title="开始生产确认"
      width="min(640px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!startSaving"
      :close-on-press-escape="!startSaving"
      :before-close="handleStartDialogClose"
      :show-close="!startSaving"
      @closed="resetStartDialog"
    >
      <div v-if="activeStartTask" class="start-confirm-panel">
        <el-alert
          title="确认后任务会进入生产中，后续必须按工序顺序填写完成表。"
          type="warning"
          :closable="false"
        />
        <el-form label-width="96px" class="supervisor-form">
          <el-form-item label="车间主任" required>
            <el-select
              v-model="startSupervisorCode"
              filterable
              remote
              clearable
              reserve-keyword
              placeholder="选择车间主任，支持姓名 / 拼音 / 首字母 / 账号ID"
              :remote-method="searchStartSupervisors"
              :loading="isOperatorLoading(startSupervisorScope)"
              style="width: min(360px, 100%)"
              @visible-change="handleStartSupervisorSelectVisible"
            >
              <el-option
                v-for="operator in startSupervisorOptionRows"
                :key="operator.code"
                :label="operatorOptionLabel(operator)"
                :value="operator.code"
              >
                <div class="operator-option">
                  <strong>{{ operator.name }}</strong>
                  <span>{{ operator.accountId || operator.code }} / {{ operator.role }}</span>
                </div>
              </el-option>
            </el-select>
            <div class="form-help-text">开始生产必须由车间主任确认；提交生产仍由下单/计划操作员处理。</div>
          </el-form-item>
        </el-form>
        <div class="process-info-grid">
          <div>
            <label>订单号</label>
            <strong><OrderNoLink :order-no="activeStartTask.orderNo" /></strong>
          </div>
          <div>
            <label>任务号</label>
            <strong>{{ activeStartTask.productionTaskNo }}</strong>
          </div>
          <div>
            <label>客户</label>
            <strong>{{ activeStartTask.customerName }}</strong>
          </div>
          <div>
            <label>零件</label>
            <strong>{{ activeStartTask.partName }}</strong>
          </div>
          <div>
            <label>客户订单</label>
            <strong>{{ formatCustomerOrderQuantity(activeStartTask) }}</strong>
          </div>
          <div>
            <label>生产计划</label>
            <strong>{{ formatQuantity(activeStartTask.plannedQuantity, activeStartTask.unit) }}</strong>
          </div>
        </div>
        <div class="start-process-list">
          <span>生产流程</span>
          <strong>{{ startProcessText }}</strong>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="startSaving" @click="closeStartDialog">取消</el-button>
        <el-button type="primary" :loading="startSaving" :disabled="startSaving || !startSupervisorCode" @click="confirmStartProduction"
          title="确认开始生产">
          确认开始生产
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="batchStartVisible"
      title="批量开始生产确认"
      width="min(720px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!batchStartSaving"
      :close-on-press-escape="!batchStartSaving"
      :before-close="handleBatchStartDialogClose"
      :show-close="!batchStartSaving"
      @closed="resetBatchStartDialog"
    >
      <div class="start-confirm-panel">
        <el-alert
          title="批量开始后，所选任务会统一进入生产中。车间主任仍可在订单生产详情内逐个填写工序记录。"
          type="warning"
          :closable="false"
        />
        <el-form label-width="96px" class="supervisor-form">
          <el-form-item label="车间主任" required>
            <el-select
              v-model="batchStartSupervisorCode"
              filterable
              remote
              clearable
              reserve-keyword
              placeholder="选择车间主任，支持姓名 / 拼音 / 首字母 / 账号ID"
              :remote-method="searchBatchStartSupervisors"
              :loading="isOperatorLoading(batchStartSupervisorScope)"
              style="width: min(360px, 100%)"
              @visible-change="handleBatchStartSupervisorSelectVisible"
            >
              <el-option
                v-for="operator in batchStartSupervisorOptionRows"
                :key="operator.code"
                :label="operatorOptionLabel(operator)"
                :value="operator.code"
              >
                <div class="operator-option">
                  <strong>{{ operator.name }}</strong>
                  <span>{{ operator.accountId || operator.code }} / {{ operator.role }}</span>
                </div>
              </el-option>
            </el-select>
            <div class="form-help-text">批量开始生产只能由车间主任确认。</div>
          </el-form-item>
        </el-form>
        <div class="batch-start-heading">
          <div>
            <strong>{{ batchStartOrderNo }}</strong>
            <span>已选择 {{ batchStartSelectedTaskIds.length }} / {{ batchStartTasks.length }} 项待确认生产任务</span>
          </div>
          <div class="batch-start-actions">
            <el-button size="small" :disabled="batchStartSelectedTaskIds.length === batchStartTasks.length" @click="selectAllBatchStartTasks">
              全选
            </el-button>
            <el-button title="清空" size="small" :disabled="batchStartSelectedTaskIds.length === 0" @click="clearBatchStartTasks">
              清空
            </el-button>
          </div>
        </div>
        <div class="batch-start-height-toolbar">
          <div class="production-table-height-actions" aria-label="批量开始生产任务列表高度">
            <span class="production-table-height-label">任务列表高度</span>
            <el-button-group>
              <el-button
                size="small"
                :icon="Minus"
                :disabled="productionWorkTableHeights.batchStartTasks <= productionWorkTableHeightLimits.min"
                title="降低批量开始生产任务列表高度"
                aria-label="降低批量开始生产任务列表高度"
                @click="adjustProductionWorkTableHeight('batchStartTasks', -productionWorkTableHeightLimits.step)"
              />
              <el-button
                size="small"
                :icon="Plus"
                :disabled="productionWorkTableHeights.batchStartTasks >= productionWorkTableHeightLimits.max"
                title="提高批量开始生产任务列表高度"
                aria-label="提高批量开始生产任务列表高度"
                @click="adjustProductionWorkTableHeight('batchStartTasks', productionWorkTableHeightLimits.step)"
              />
              <el-button
                size="small"
                :icon="RefreshLeft"
                :disabled="productionWorkTableHeights.batchStartTasks === productionWorkTableDefaultHeights.batchStartTasks"
                title="恢复批量开始生产任务列表默认高度"
                aria-label="恢复批量开始生产任务列表默认高度"
                @click="resetProductionWorkTableHeight('batchStartTasks')"
              />
            </el-button-group>
          </div>
        </div>
        <el-checkbox-group
          v-model="batchStartSelectedTaskIds"
          class="batch-task-list"
          :style="{ maxHeight: productionWorkTableHeightStyle('batchStartTasks') }"
        >
          <el-checkbox v-for="task in batchStartTasks" :key="task.id" :value="task.id" class="batch-task-item">
            <div>
              <strong>{{ task.partName }}</strong>
              <span>{{ task.productionTaskNo }} / {{ formatQuantity(task.plannedQuantity, task.unit) }}</span>
            </div>
            <small>{{ formatProductionProcessSteps(task, '未配置生产流程', ' → ') }}</small>
          </el-checkbox>
        </el-checkbox-group>
      </div>
      <template #footer>
        <el-button :disabled="batchStartSaving" @click="closeBatchStartDialog">取消</el-button>
        <el-button
          type="primary"
          :loading="batchStartSaving"
          :disabled="batchStartSaving || !batchStartSupervisorCode || batchStartSelectedTaskIds.length === 0"
          @click="confirmBatchStartProduction"

          title="确认批量开始生产">
          确认批量开始生产
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="noticeVisible" title="生产通知" width="min(980px, calc(100vw - 32px))" class="responsive-dialog">
      <div v-loading="noticeLoading" class="notice-list">
        <div class="notice-toolbar">
          <el-radio-group v-model="productionNoticeStatusFilter" size="small" @change="reloadProductionNoticesFromFirstPage">
            <el-radio-button value="PENDING">待处理 {{ productionNoticeCounts.PENDING }}</el-radio-button>
            <el-radio-button value="ACKNOWLEDGED">历史 {{ productionNoticeCounts.ACKNOWLEDGED }}</el-radio-button>
            <el-radio-button value="ALL">全部 {{ productionNoticeCounts.ALL }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="notice-filter-grid">
          <CustomerSelect v-model="productionNoticeFilters.customerId" placeholder="通知客户" width="180px" @change="reloadProductionNoticesFromFirstPage" />
          <el-input v-model="productionNoticeFilters.orderNo" clearable placeholder="订单号" @keyup.enter="reloadProductionNoticesFromFirstPage" />
          <el-input v-model="productionNoticeFilters.partCode" clearable placeholder="零件编码" @keyup.enter="reloadProductionNoticesFromFirstPage" />
          <el-select v-model="productionNoticeFilters.noticeType" placeholder="通知类型">
            <el-option label="全部类型" value="ALL" />
            <el-option v-for="item in productionNoticeTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <DateRangeFilter v-model="productionNoticeDateRange" start-placeholder="通知开始" end-placeholder="通知结束" width="220px" />
          <el-input v-model="productionNoticeFilters.keyword" clearable placeholder="客户/原因/任务号" @keyup.enter="reloadProductionNoticesFromFirstPage" />
          <el-button title="查询" type="primary" @click="reloadProductionNoticesFromFirstPage">查询</el-button>
          <el-button title="重置" @click="resetProductionNoticeFilters">重置</el-button>
          <el-button title="导出Excel" :icon="Download" :loading="productionNoticeExporting" @click="exportProductionNoticesExcel">导出 Excel</el-button>
        </div>
        <div class="production-dialog-list-toolbar">
          <div class="production-table-height-actions" aria-label="生产通知列表高度">
            <span class="production-table-height-label">通知列表高度</span>
            <el-button-group>
              <el-button
                size="small"
                :icon="Minus"
                :disabled="productionWorkTableHeights.productionNotices <= productionWorkTableHeightLimits.min"
                title="降低生产通知列表高度"
                aria-label="降低生产通知列表高度"
                @click="adjustProductionWorkTableHeight('productionNotices', -productionWorkTableHeightLimits.step)"
              />
              <el-button
                size="small"
                :icon="Plus"
                :disabled="productionWorkTableHeights.productionNotices >= productionWorkTableHeightLimits.max"
                title="提高生产通知列表高度"
                aria-label="提高生产通知列表高度"
                @click="adjustProductionWorkTableHeight('productionNotices', productionWorkTableHeightLimits.step)"
              />
              <el-button
                size="small"
                :icon="RefreshLeft"
                :disabled="productionWorkTableHeights.productionNotices === productionWorkTableDefaultHeights.productionNotices"
                title="恢复生产通知列表默认高度"
                aria-label="恢复生产通知列表默认高度"
                @click="resetProductionWorkTableHeight('productionNotices')"
              />
            </el-button-group>
          </div>
        </div>
        <div class="notice-scroll-list" :style="{ maxHeight: productionWorkTableHeightStyle('productionNotices') }">
          <div v-if="filteredProductionNotices.length === 0" class="muted">暂无生产通知</div>
          <article v-for="notice in filteredProductionNotices" :key="notice.id" class="notice-item">
            <div>
              <strong>{{ productionNoticeTitle(notice) }}</strong>
              <p :title="productionNoticeReasonTitle(notice)">{{ productionNoticeReasonPreview(notice) }}</p>
              <small>通知时间：{{ formatDateTime(notice.createdAt) }}</small>
              <small v-if="notice.status === 'ACKNOWLEDGED'" class="notice-ack-text">
                确认：{{ notice.acknowledgedBy || '-' }} / {{ formatDateTime(notice.acknowledgedAt) }}
              </small>
            </div>
            <el-button
              v-if="notice.status === 'PENDING'"
              size="small"
              type="primary"
              @click="acknowledgeNotice(notice)"

              title="确认已知晓">
              确认已知晓
            </el-button>
            <StatusTag v-else value="ACKNOWLEDGED" compact />
          </article>
        </div>
        <div class="production-notice-pagination">
          <span>共 {{ productionNoticePagination.totalCount }} 条，当前第 {{ productionNoticePagination.page }} 页</span>
          <el-pagination
            background
            layout="prev, pager, next, jumper"
            :current-page="productionNoticePagination.page"
            :page-size="productionNoticePagination.limit"
            :total="productionNoticePagination.totalCount"
            @current-change="handleProductionNoticePageChange"
          />
        </div>
      </div>
      <template #footer>
        <el-button title="关闭" @click="noticeVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <NoticeAcknowledgeDialog
      v-model="acknowledgeVisible"
      title="确认生产通知"
      name-label="确认人员"
      name-placeholder="请输入确认人员姓名"
      :notice-title="activeProductionNotice ? productionNoticeTitle(activeProductionNotice) : ''"
      :notice-reason="activeProductionNotice?.reason"
      :created-at-text="activeProductionNotice ? formatDateTime(activeProductionNotice.createdAt) : ''"
      :loading="acknowledgeSaving"
      @confirm="saveNoticeAcknowledge"
    />

    <el-dialog v-model="replenishmentRequestVisible" title="生产报废补单申请" width="min(980px, calc(100vw - 32px))" class="responsive-dialog">
      <div class="replenishment-request-toolbar">
        <el-radio-group v-model="replenishmentRequestStatusFilter" size="small" @change="reloadReplenishmentRequestsFromFirstPage">
          <el-radio-button value="ALL">全部 {{ replenishmentRequestCounts.ALL }}</el-radio-button>
          <el-radio-button value="PENDING">待确认 {{ replenishmentRequestCounts.PENDING }}</el-radio-button>
          <el-radio-button value="APPROVED">已生成报废补单 {{ replenishmentRequestCounts.APPROVED }}</el-radio-button>
          <el-radio-button value="REJECTED">已驳回 {{ replenishmentRequestCounts.REJECTED }}</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="replenishmentRequestKeyword"
          clearable
          placeholder="搜索申请单 / 订单 / 任务 / 零件 / 人员"
          class="replenishment-request-search"
          @keyup.enter="queryReplenishmentRequests"
        />
        <el-button title="查询" type="primary" size="small" @click="queryReplenishmentRequests">查询</el-button>
        <el-button title="重置" size="small" @click="resetReplenishmentRequestFilters">重置</el-button>
        <el-button title="导出Excel" size="small" :icon="Download" :loading="replenishmentRequestExporting" @click="exportReplenishmentRequestsExcel">
          导出 Excel
        </el-button>
      </div>
      <div class="production-dialog-list-toolbar">
        <div class="production-table-height-actions" aria-label="生产报废补单申请列表高度">
          <span class="production-table-height-label">申请列表高度</span>
          <el-button-group>
            <el-button
              size="small"
              :icon="Minus"
              :disabled="productionWorkTableHeights.replenishmentRequests <= productionWorkTableHeightLimits.min"
              title="降低生产报废补单申请列表高度"
              aria-label="降低生产报废补单申请列表高度"
              @click="adjustProductionWorkTableHeight('replenishmentRequests', -productionWorkTableHeightLimits.step)"
            />
            <el-button
              size="small"
              :icon="Plus"
              :disabled="productionWorkTableHeights.replenishmentRequests >= productionWorkTableHeightLimits.max"
              title="提高生产报废补单申请列表高度"
              aria-label="提高生产报废补单申请列表高度"
              @click="adjustProductionWorkTableHeight('replenishmentRequests', productionWorkTableHeightLimits.step)"
            />
            <el-button
              size="small"
              :icon="RefreshLeft"
              :disabled="productionWorkTableHeights.replenishmentRequests === productionWorkTableDefaultHeights.replenishmentRequests"
              title="恢复生产报废补单申请列表默认高度"
              aria-label="恢复生产报废补单申请列表默认高度"
              @click="resetProductionWorkTableHeight('replenishmentRequests')"
            />
          </el-button-group>
        </div>
      </div>
      <div
        v-loading="replenishmentRequestLoading"
        class="replenishment-request-list"
        :style="{ maxHeight: productionWorkTableHeightStyle('replenishmentRequests') }"
      >
        <div v-if="filteredProductionReplenishmentRequests.length === 0" class="muted">暂无生产报废补单申请</div>
        <article
          v-for="request in filteredProductionReplenishmentRequests"
          :key="request.id"
          class="replenishment-request-item"
        >
          <div class="replenishment-request-main">
            <div class="replenishment-request-title">
              <strong>{{ request.requestNo }}</strong>
              <StatusTag
                :value="replenishmentRequestStatusTag(request.status)"
                :label-override="replenishmentRequestStatusText(request.status)"
                compact
              />
            </div>
            <div class="replenishment-request-grid">
              <p><span>订单号</span><OrderNoLink :order-no="request.orderNo" /></p>
              <p><span>任务号</span>{{ request.productionTaskNo || '-' }}</p>
              <p><span>零件</span>{{ request.partName }} / {{ request.partCode }}</p>
              <p><span>报废数量</span>{{ formatQuantity(request.scrapQuantity, request.unit) }}</p>
              <p><span>申请补齐</span>{{ formatQuantity(request.requestQuantity, request.unit) }}</p>
              <p><span>申请人员</span>{{ request.requestedByName || request.requestedByCode || '-' }}</p>
            </div>
            <p class="replenishment-request-reason" :title="replenishmentRequestReasonTitle(request)">
              {{ replenishmentRequestReasonPreview(request) }}
            </p>
            <small>
              来源：{{ replenishmentSourceTypeText(request.sourceType) }} / 创建时间：{{ formatDateTime(request.createdAt) }}
              <template v-if="request.reviewedAt"> / 审核时间：{{ formatDateTime(request.reviewedAt) }}</template>
              <template v-if="request.replenishmentTaskNo"> / 报废补单任务：{{ request.replenishmentTaskNo }}</template>
              <template v-if="request.supervisorName"> / 主管：{{ request.supervisorName }}</template>
              <template v-if="request.supervisorRemark">
                / 审核说明：<span :title="replenishmentSupervisorRemarkTitle(request)">{{ replenishmentSupervisorRemarkPreview(request) }}</span>
              </template>
            </small>
          </div>
          <div class="replenishment-request-actions">
            <template v-if="request.status === 'PENDING'">
              <el-button
                type="primary"
                size="small"
                :disabled="!canReviewReplenishmentRequest(request)"
                :title="replenishmentRequestLockedReason(request)"
                @click="openReplenishmentApprovalFromRequest(request)"
              >
                主管确认
              </el-button>
              <el-button
                type="danger"
                size="small"
                plain
                :disabled="!canReviewReplenishmentRequest(request)"
                :title="replenishmentRequestLockedReason(request)"
                @click="openReplenishmentReject(request)"
              >
                驳回申请
              </el-button>
            </template>
            <span v-else class="muted">{{ replenishmentRequestStatusText(request.status) }}</span>
          </div>
        </article>
      </div>
      <div class="production-list-pagination">
        <span>共 {{ replenishmentRequestPagination.totalCount }} 条，当前第 {{ replenishmentRequestPagination.page }} 页</span>
        <el-pagination
          background
          layout="prev, pager, next, jumper"
          :current-page="replenishmentRequestPagination.page"
          :page-size="replenishmentRequestPagination.limit"
          :total="replenishmentRequestPagination.totalCount"
          @current-change="handleReplenishmentRequestPageChange"
        />
      </div>
      <template #footer>
        <el-button title="关闭" @click="replenishmentRequestVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="replenishmentRejectVisible"
      title="驳回生产报废补单申请"
      width="min(620px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!replenishmentRejectSaving"
      :close-on-press-escape="!replenishmentRejectSaving"
      :before-close="handleReplenishmentRejectDialogClose"
    >
      <div v-if="activeReplenishmentRejectRequest" class="final-confirm-panel">
        <el-alert
          title="驳回后不会生成补单任务，该短缺会按管理确认缺货完成保存；请确认现场确实不需要补齐客户订单数量。"
          type="warning"
          :closable="false"
        />
        <div class="process-info-grid mt-16">
          <div>
            <label>申请单号</label>
            <strong>{{ activeReplenishmentRejectRequest.requestNo }}</strong>
          </div>
          <div>
            <label>订单号</label>
            <strong><OrderNoLink :order-no="activeReplenishmentRejectRequest.orderNo" /></strong>
          </div>
          <div>
            <label>任务号</label>
            <strong>{{ activeReplenishmentRejectRequest.productionTaskNo || '-' }}</strong>
          </div>
          <div>
            <label>零件</label>
            <strong>{{ activeReplenishmentRejectRequest.partName }}</strong>
          </div>
          <div>
            <label>报废数量</label>
            <strong>{{ formatQuantity(activeReplenishmentRejectRequest.scrapQuantity, activeReplenishmentRejectRequest.unit) }}</strong>
          </div>
          <div>
            <label>申请补齐</label>
            <strong>{{ formatQuantity(activeReplenishmentRejectRequest.requestQuantity, activeReplenishmentRejectRequest.unit) }}</strong>
          </div>
        </div>
        <el-form label-width="128px" class="mt-16">
          <el-form-item label="主管姓名" required>
            <el-input v-model="replenishmentRejectForm.managerName" placeholder="请输入车间主管姓名" style="width: 260px" />
          </el-form-item>
          <el-form-item label="驳回原因" required>
            <el-input
              v-model="replenishmentRejectForm.reason"
              type="textarea"
              :rows="3"
              placeholder="例如：客户已同意缺货发货，不生成补单"
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button :disabled="replenishmentRejectSaving" @click="closeReplenishmentRejectDialog">取消</el-button>
        <el-button
          type="danger"
          :loading="replenishmentRejectSaving"
          :disabled="replenishmentRejectSaving"
          @click="saveReplenishmentReject"

        title="确认驳回">
          确认驳回
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="scrapVisible" title="生产报废统计" width="min(980px, calc(100vw - 32px))" class="responsive-dialog">
      <div class="dialog-filter-row">
        <div class="filter-field compact">
          <label>报废日期</label>
          <DateRangeFilter v-model="scrapDateRange" @change="handleScrapScopeChange" />
        </div>
        <div class="filter-field compact">
          <label>客户</label>
          <CustomerSelect v-model="scrapFilters.customerId" placeholder="全部客户" width="220px" @change="handleScrapScopeChange" />
        </div>
        <div class="filter-field compact">
          <label>订单</label>
          <OrderSelect v-model="scrapFilters.orderNo" :orders="scrapOrderOptions" placeholder="全部订单" width="260px" @change="reloadScrapRecordsFromFirstPage" />
        </div>
        <el-button title="查询" type="primary" :loading="scrapLoading" @click="reloadScrapRecordsFromFirstPage">查询</el-button>
        <el-button title="重置" @click="resetScrapFilters">重置</el-button>
        <el-button title="导出Excel" :icon="Download" :loading="scrapExporting" @click="exportScrapRecordsExcel">导出 Excel</el-button>
      </div>
      <div class="production-dialog-table-toolbar">
        <div class="production-table-height-actions" aria-label="生产报废统计表格高度">
          <span class="production-table-height-label">生产报废统计表格高度</span>
          <el-button-group>
            <el-button
              size="small"
              :icon="Minus"
              :disabled="productionWorkTableHeights.scrapRecords <= productionWorkTableHeightLimits.min"
              title="降低生产报废统计表格高度"
              aria-label="降低生产报废统计表格高度"
              @click="adjustProductionWorkTableHeight('scrapRecords', -productionWorkTableHeightLimits.step)"
            />
            <el-button
              size="small"
              :icon="Plus"
              :disabled="productionWorkTableHeights.scrapRecords >= productionWorkTableHeightLimits.max"
              title="提高生产报废统计表格高度"
              aria-label="提高生产报废统计表格高度"
              @click="adjustProductionWorkTableHeight('scrapRecords', productionWorkTableHeightLimits.step)"
            />
            <el-button
              size="small"
              :icon="RefreshLeft"
              :disabled="productionWorkTableHeights.scrapRecords === productionWorkTableDefaultHeights.scrapRecords"
              title="恢复生产报废统计表格默认高度"
              aria-label="恢复生产报废统计表格默认高度"
              @click="resetProductionWorkTableHeight('scrapRecords')"
            />
          </el-button-group>
        </div>
      </div>
      <el-table v-loading="scrapLoading" :data="scrapRecords" :max-height="productionWorkTableHeights.scrapRecords">
        <el-table-column prop="scrapNo" label="报废记录号" min-width="180" />
        <el-table-column label="订单号" min-width="150">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column prop="productionTaskNo" label="任务号" min-width="210" />
        <el-table-column prop="partCode" label="零件编码" min-width="130" />
        <el-table-column prop="partName" label="零件名称" min-width="150" />
        <el-table-column label="报废数量" min-width="110">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="报废原因" min-width="260">
          <template #default="{ row }">
            <span :title="scrapRecordReasonTitle(row)">{{ scrapRecordReasonPreview(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="日期" min-width="170">
          <template #default="{ row }">{{ formatDateTime(row.recordDate) }}</template>
        </el-table-column>
      </el-table>
      <div class="production-list-pagination">
        <span>共 {{ scrapRecordPagination.totalCount }} 条，当前第 {{ scrapRecordPagination.page }} 页</span>
        <el-pagination
          background
          layout="prev, pager, next, jumper"
          :current-page="scrapRecordPagination.page"
          :page-size="scrapRecordPagination.limit"
          :total="scrapRecordPagination.totalCount"
          @current-change="handleScrapRecordPageChange"
        />
      </div>
      <template #footer>
        <el-button title="关闭" @click="scrapVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="processVisible"
      :title="processDialogTitle"
      width="min(860px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!processSaving"
      :close-on-press-escape="!processSaving"
      :before-close="handleProcessDialogClose"
    >
      <div v-if="activeTask" class="process-form">
        <div class="process-info-grid">
          <div>
            <label>客户</label>
            <strong>{{ activeTask.customerName }}</strong>
          </div>
          <div>
            <label>订单号</label>
            <strong><OrderNoLink :order-no="activeTask.orderNo" /></strong>
          </div>
          <div>
            <label>零件名称</label>
            <strong>{{ activeTask.partName }}</strong>
          </div>
          <div>
            <label>零件编码</label>
            <strong>{{ activeTask.partCode }}</strong>
          </div>
          <div>
            <label>零件图号</label>
            <strong>{{ activeTask.drawingNo || '-' }}</strong>
          </div>
          <div>
            <label>图纸版本</label>
            <strong>{{ activeTask.drawingVersion || '-' }}</strong>
          </div>
          <div>
            <label>图纸日期</label>
            <strong>{{ activeTask.drawingDate || '-' }}</strong>
          </div>
          <div>
            <label>图纸状态</label>
            <strong>{{ activeTask.drawingStatus || '-' }}</strong>
          </div>
          <div>
            <label>零件厚度</label>
            <strong>{{ formatProductionTaskThickness(activeTask) }}</strong>
          </div>
          <div>
            <label>成品规格</label>
            <strong>{{ activeTask.partSpecification || '-' }}</strong>
          </div>
          <div>
            <label>客户订单</label>
            <strong>{{ formatCustomerOrderQuantity(activeTask) }}</strong>
          </div>
          <div>
            <label>生产计划</label>
            <strong>{{ formatQuantity(activeTask.plannedQuantity, activeTask.unit) }}</strong>
          </div>
        </div>

        <div class="drawing-preview">
          <div class="drawing-preview-title">产品图纸在线预览</div>
          <div v-if="activeTask.drawingFileUrl" class="drawing-file-preview">
            <div class="drawing-file-toolbar">
              <span>{{ displayFileName(activeTask.drawingFileName || activeTask.drawingFileUrl) }}</span>
              <DrawingPreviewLink
                :file-name="activeTask.drawingFileName"
                :file-url="activeTask.drawingFileUrl"
                :title="`${activeTask.partName} 图纸预览`"
                link-text="打开图纸"
              />
            </div>
            <img
              v-if="isImageDrawing(activeTask.drawingFileUrl)"
              :src="drawingHref(activeTask.drawingFileUrl)"
              :alt="`${activeTask.partName} 图纸`"
            />
            <iframe
              v-else-if="isPdfDrawing(activeTask.drawingFileUrl)"
              :src="drawingHref(activeTask.drawingFileUrl)"
              title="产品图纸预览"
            />
            <div v-else class="drawing-file-empty">
              当前文件类型需要使用 CAD 或外部查看器打开。
            </div>
          </div>
          <div v-else class="drawing-sheet">
            <div class="drawing-sheet-part">{{ activeTask.partName }}</div>
            <div class="drawing-sheet-code">
              {{ activeTask.partCode }} / {{ formatProductionTaskDrawingText(activeTask) }}
            </div>
            <div class="drawing-sheet-lines">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div class="drawing-sheet-footer">
              <span>订单 {{ activeTask.orderNo }}</span>
              <span>{{ activeProcessLabel }}</span>
            </div>
          </div>
        </div>

        <el-form label-width="128px" class="mt-16">
          <el-alert
            v-if="activeProcessReadonly"
            :title="activeProcessReadonlyText"
            type="info"
            :closable="false"
            class="mt-16"
          />
          <el-form-item :label="`当前工序 ${activeProcessLabel}`" required>
            <el-radio-group v-model="processForm.isCompleted" :disabled="activeProcessReadonly">
              <el-radio-button :value="true">已完成</el-radio-button>
              <el-radio-button :value="false" :disabled="activeTask.status === 'COMPLETED'">未完成</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="!activeProcessReadonly && batchProcessOptions.length > 1 && processForm.isCompleted" label="同时完成">
            <el-checkbox-group v-model="batchProcessNames" class="batch-process-group" @change="handleBatchProcessChange">
              <el-checkbox
                v-for="processName in batchProcessOptions"
                :key="processName"
                :label="processName"
                :disabled="processName === activeProcessName"
              >
                {{ activeTask ? processStepDisplay(activeTask, processName) : processName }}
              </el-checkbox>
            </el-checkbox-group>
            <div class="process-help-text">可一次确认连续工序，系统仍按工艺顺序保存每道工序记录。</div>
          </el-form-item>
          <el-form-item label="完成数量" required>
            <el-input-number
              v-model="processForm.completedQuantity"
              :min="0.001"
              :precision="3"
              :controls="false"
              :disabled="activeProcessReadonly"
              style="width: 180px"
            />
            <span class="unit-text">{{ activeTask.unit }}</span>
          </el-form-item>
          <div v-if="shouldShowProcessQuantityNotice" class="process-quantity-panel">
            <el-alert :title="processQuantityWarningText" type="warning" show-icon :closable="false" />
            <el-form-item v-if="shouldShowQuantityOverridePanel" label="数量原因" required>
              <el-input
                v-model="processForm.quantityOverrideReason"
                type="textarea"
                :rows="2"
                :disabled="activeProcessReadonly"
                placeholder="例如：拿到补单一起做、使用以前多做库存、以前没有上报的余件"
              />
            </el-form-item>
          </div>
          <div v-if="shouldShowShortagePanel" class="shortage-panel">
            <el-alert
              title="完成数量少于生产计划，必须填写短缺处理信息。"
              type="warning"
              show-icon
              :closable="false"
            />
            <el-form-item label="缺少数量">
              <strong>{{ formatQuantity(shortageQuantity, activeTask.unit) }}</strong>
            </el-form-item>
            <el-form-item label="报废数量" required>
              <el-input-number
                v-model="processForm.scrapQuantity"
                :min="0"
                :max="shortageQuantity"
                :precision="3"
                :controls="false"
                :disabled="activeProcessReadonly"
                style="width: 180px"
              />
              <span class="unit-text">{{ activeTask.unit }}</span>
            </el-form-item>
            <el-form-item label="处理方式" required>
              <el-radio-group v-model="processForm.shortageMode" :disabled="activeProcessReadonly">
                <el-radio-button value="REPLENISHMENT_REQUEST">生产报废补单申请</el-radio-button>
                <el-radio-button value="MANAGER_APPROVED">管理确认缺货完成</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-alert
              v-if="processForm.shortageMode === 'REPLENISHMENT_REQUEST'"
              title="保存后只生成生产报废补单申请，车间主管确认后系统才会生成补单任务。"
              type="info"
              :closable="false"
            />
            <template v-else>
              <el-form-item label="确认主管" required>
                <el-input v-model="processForm.managerName" placeholder="车间管理人员姓名" :disabled="activeProcessReadonly" style="width: 260px" />
              </el-form-item>
              <el-form-item label="缺货理由" required>
                <el-input
                  v-model="processForm.shortageReason"
                  type="textarea"
                  :rows="2"
                  :disabled="activeProcessReadonly"
                  placeholder="例如：库存抵扣、客户取消部分数量、主管确认缺货完成"
                />
              </el-form-item>
            </template>
          </div>
          <el-form-item label="操作人员">
            <div class="process-operator-list">
              <div v-for="processName in selectedProcessNamesForOperatorForm" :key="processName" class="process-operator-row">
                <span class="process-operator-name">{{ activeTask ? processStepDisplay(activeTask, processName) : processName }}</span>
                <el-select
                  v-model="processOperatorCodes[processName]"
                  multiple
                  filterable
                  clearable
                  collapse-tags
                  collapse-tags-tooltip
                  remote
                  reserve-keyword
                  :remote-method="(keyword: string) => searchOperatorsForProcess(processName, keyword)"
                  :loading="isOperatorLoading(operatorScopeForProcess(processName))"
                  :disabled="activeProcessReadonly"
                  placeholder="必填，输入姓名 / 拼音 / 账号ID"
                  class="process-operator-select"
                  @visible-change="(visible: boolean) => handleProcessOperatorSelectVisible(processName, visible)"
                >
                  <el-option
                    v-for="operator in operatorOptionRowsForProcess(processName)"
                    :key="operator.code"
                    :label="operatorOptionLabel(operator)"
                    :value="operator.code"
                  >
                    <div class="operator-option">
                      <strong>{{ operator.name }}</strong>
                      <span>{{ operator.accountId || operator.code }} / {{ operator.role }}</span>
                      <small v-if="operator.idCardMasked">身份证 {{ operator.idCardMasked }}</small>
                    </div>
                  </el-option>
                </el-select>
              </div>
              <div class="process-help-text">确认工序完成时必须选择操作人员；批量确认时每道工序会分别保存自己的操作人员。</div>
            </div>
          </el-form-item>
          <el-form-item label="记录时间">
            <span class="muted">{{ processRecordTimeText }}</span>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="processForm.remark" type="textarea" :rows="3" :disabled="activeProcessReadonly" />
          </el-form-item>
        </el-form>

        <div class="process-log-panel">
          <div class="process-log-title">修改日志</div>
          <div v-if="activeProcessLogs.length === 0" class="muted">暂无修改记录</div>
          <div v-for="log in activeProcessLogs" :key="log.id" class="process-log-item">
            <div class="process-log-meta">
              <strong>{{ log.operatorName || '-' }}</strong>
              <span>{{ log.action }}</span>
              <small>{{ formatDateTime(log.createdAt) }}</small>
            </div>
            <div v-if="log.beforeSnapshot" class="process-log-change">
              <p>
                <span class="process-log-label">修改前</span>
                <span class="process-log-text" :title="formatProcessLogTitle(log.beforeSnapshot)">{{ formatProcessLogPreview(log.beforeSnapshot) }}</span>
              </p>
              <p>
                <span class="process-log-label">修改后</span>
                <span class="process-log-text" :title="formatProcessLogTitle(log.afterSnapshot)">{{ formatProcessLogPreview(log.afterSnapshot) }}</span>
              </p>
            </div>
            <p v-else class="process-log-single" :title="formatProcessLogTitle(log.afterSnapshot)">{{ formatProcessLogPreview(log.afterSnapshot) }}</p>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="processSaving" @click="closeProcessDialog">取消</el-button>
        <el-button
          v-if="!activeProcessReadonly"
          type="primary"
          :loading="processSaving"
          :disabled="processSaving"
          @click="saveProcessCompletion"

          title="确认完成">
          确认完成
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="quantityOverrideDialogVisible"
      title="数量确认"
      width="min(560px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
      @closed="handleQuantityOverrideDialogClosed"
    >
      <div class="quantity-override-confirm">
        <el-alert :title="processQuantityWarningText" type="warning" :closable="false" show-icon />
        <p>
          <span>填写原因</span>
          <strong :title="quantityOverrideReasonTitle">{{ quantityOverrideReasonPreview }}</strong>
        </p>
      </div>
      <template #footer>
        <el-button title="返回修改" :disabled="processSaving" @click="cancelQuantityOverrideDialog">返回修改</el-button>
        <el-button type="primary" :loading="processSaving" @click="confirmQuantityOverrideDialog">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="finalConfirmVisible"
      :title="finalConfirmTitle"
      width="min(720px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!finalSaving"
      :close-on-press-escape="!finalSaving"
      :before-close="handleFinalConfirmDialogClose"
      :show-close="!finalSaving"
      @closed="resetFinalConfirmDialog"
    >
      <div v-if="activeFinalTask" class="final-confirm-panel">
        <div class="process-info-grid">
          <div>
            <label>客户</label>
            <strong>{{ activeFinalTask.customerName }}</strong>
          </div>
          <div>
            <label>订单号</label>
            <strong><OrderNoLink :order-no="activeFinalTask.orderNo" /></strong>
          </div>
          <div>
            <label>生产任务</label>
            <strong>{{ activeFinalTask.productionTaskNo }}</strong>
          </div>
          <div>
            <label>零件</label>
            <strong>{{ activeFinalTask.partName }}</strong>
          </div>
          <div>
            <label>生产计划</label>
            <strong>{{ formatQuantity(activeFinalTask.plannedQuantity, activeFinalTask.unit) }}</strong>
          </div>
          <div>
            <label>客户订单</label>
            <strong>{{ formatCustomerOrderQuantity(activeFinalTask) }}</strong>
          </div>
          <div>
            <label>最后工序</label>
            <strong>{{ finalProcessLabel }}</strong>
          </div>
        </div>

        <el-form label-width="128px" class="mt-16">
          <el-form-item label="车间主任" required>
            <el-select
              v-model="finalSupervisorCode"
              filterable
              remote
              clearable
              reserve-keyword
              placeholder="选择车间主任，支持姓名 / 拼音 / 首字母 / 账号ID"
              :remote-method="searchFinalSupervisors"
              :loading="isOperatorLoading(finalSupervisorScope)"
              style="width: 320px; max-width: 100%"
              @visible-change="handleFinalSupervisorSelectVisible"
            >
              <el-option
                v-for="operator in finalSupervisorOptionRows"
                :key="operator.code"
                :label="operatorOptionLabel(operator)"
                :value="operator.code"
              >
                <div class="operator-option">
                  <strong>{{ operator.name }}</strong>
                  <span>{{ operator.accountId || operator.code }} / {{ operator.role }}</span>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="最终完成数量" required>
            <el-input-number
              v-model="finalForm.completedQuantity"
              :min="0.001"
              :precision="3"
              :controls="false"
              style="width: 180px"
            />
            <span class="operator-hint">{{ activeFinalTask.unit }} / 计划 {{ formatQuantity(activeFinalTask.plannedQuantity, activeFinalTask.unit) }}</span>
          </el-form-item>
          <el-alert
            v-if="finalOverageQuantity > 0"
            :title="`多做 ${formatQuantity(finalOverageQuantity, activeFinalTask.unit)}，仓库确认入库时会转为备货库存。`"
            type="warning"
            :closable="false"
            class="mt-16"
          />
          <div class="warehouse-split-panel">
            <div>
              <span>预计订单待发货</span>
              <strong>{{ formatQuantity(finalOrderReceiptQuantityEstimate, activeFinalTask.unit) }}</strong>
            </div>
            <div>
              <span>预计转备货库存</span>
              <strong :class="{ 'stock-extra': finalStockQuantityEstimate > 0 }">
                {{ formatQuantity(finalStockQuantityEstimate, activeFinalTask.unit) }}
              </strong>
            </div>
            <small>仓库确认入库时会按客户订单剩余数量重新计算，最终以仓库入库结果为准。</small>
          </div>
          <div v-if="finalShouldShowShortagePanel" class="shortage-panel">
            <el-alert
              :title="`缺少 ${formatQuantity(finalShortageQuantity, activeFinalTask.unit)}，必须填写报废数量，并选择生产报废补单申请或管理确认缺货完成。`"
              type="warning"
              :closable="false"
            />
            <el-form-item label="报废数量" required>
              <el-input-number
                v-model="finalForm.scrapQuantity"
                :min="0"
                :max="finalShortageQuantity"
                :precision="3"
                :controls="false"
                style="width: 180px"
              />
              <span class="operator-hint">{{ activeFinalTask.unit }}</span>
            </el-form-item>
            <el-form-item label="处理方式" required>
              <el-radio-group v-model="finalForm.shortageMode">
                <el-radio-button value="REPLENISHMENT_REQUEST">生产报废补单申请</el-radio-button>
                <el-radio-button value="MANAGER_APPROVED">管理确认缺货完成</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-alert
              v-if="finalForm.shortageMode === 'REPLENISHMENT_REQUEST'"
              title="提交后只形成生产报废补单申请，车间主管确认后才生成补单任务；补单来源会记录为生产报废。"
              type="info"
              :closable="false"
            />
            <template v-else>
              <el-form-item label="确认主管" required>
                <el-input v-model="finalForm.managerName" placeholder="车间管理人员姓名" style="width: 260px" />
              </el-form-item>
              <el-form-item label="缺货理由" required>
                <el-input
                  v-model="finalForm.shortageReason"
                  type="textarea"
                  :rows="2"
                  placeholder="例如：库存抵扣、客户取消部分数量、主管确认缺货完成"
                />
              </el-form-item>
            </template>
          </div>
          <el-form-item label="确认人员">
            <el-select
              v-model="finalForm.operatorCodes"
              multiple
              filterable
              remote
              clearable
              collapse-tags
              collapse-tags-tooltip
              reserve-keyword
              placeholder="可不填，输入姓名 / 拼音 / 账号ID"
              :remote-method="searchFinalOperators"
              :loading="isOperatorLoading(finalOperatorScope)"
              style="width: 260px"
              @visible-change="handleFinalOperatorSelectVisible"
            >
              <el-option
                v-for="operator in finalOperatorOptionRows"
                :key="operator.code"
                :label="operatorOptionLabel(operator)"
                :value="operator.code"
              >
                <div class="operator-option">
                  <strong>{{ operator.name }}</strong>
                  <span>{{ operator.accountId || operator.code }} / {{ operator.role }}</span>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="finalForm.remark" type="textarea" :rows="3" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button :disabled="finalSaving" @click="closeFinalConfirmDialog">取消</el-button>
        <el-button type="primary" :loading="finalSaving" :disabled="finalSaving || !finalSupervisorCode" @click="saveFinalProductionCompletion"
          :title="activeFinalTask?.status === 'COMPLETED' ? '保存修改' : '确认完成'">
          {{ activeFinalTask?.status === 'COMPLETED' ? '保存修改' : '确认完成' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="replenishmentApprovalVisible"
      title="主管确认生产报废补单"
      width="min(680px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!replenishmentApprovalSaving"
      :close-on-press-escape="!replenishmentApprovalSaving"
      :before-close="handleReplenishmentApprovalDialogClose"
    >
      <div v-if="activeReplenishmentApprovalTask && activeReplenishmentApprovalCompletion" class="final-confirm-panel">
        <div class="process-info-grid">
          <div>
            <label>客户</label>
            <strong>{{ activeReplenishmentApprovalTask.customerName }}</strong>
          </div>
          <div>
            <label>订单号</label>
            <strong><OrderNoLink :order-no="activeReplenishmentApprovalTask.orderNo" /></strong>
          </div>
          <div>
            <label>生产任务</label>
            <strong>{{ activeReplenishmentApprovalTask.productionTaskNo }}</strong>
          </div>
          <div>
            <label>零件</label>
            <strong>{{ activeReplenishmentApprovalTask.partName }}</strong>
          </div>
          <div>
            <label>报废数量</label>
            <strong>{{ formatQuantity(activeReplenishmentApprovalCompletion.scrapQuantity ?? 0, activeReplenishmentApprovalTask.unit) }}</strong>
          </div>
          <div>
            <label>申请补齐</label>
            <strong>{{ formatQuantity(activeReplenishmentApprovalCompletion.shortageQuantity ?? 0, activeReplenishmentApprovalTask.unit) }}</strong>
          </div>
        </div>
        <el-alert
          title="该补单来源为生产过程报废。主管确认后，系统才会生成生产报废补单任务；订单页面的补单仍用于销售或计划决定的数量增加。"
          type="warning"
          :closable="false"
          class="mt-16"
        />
        <el-form label-width="128px" class="mt-16">
          <el-form-item label="申请单号">
            <span>{{ activeReplenishmentApprovalCompletion.replenishmentRequestNo || '待生成' }}</span>
          </el-form-item>
          <el-form-item label="主管姓名" required>
            <el-input v-model="replenishmentApprovalForm.managerName" placeholder="请输入车间主管姓名" style="width: 260px" />
          </el-form-item>
          <el-form-item label="确认说明">
            <el-input
              v-model="replenishmentApprovalForm.remark"
              type="textarea"
              :rows="3"
              placeholder="例如：确认因生产报废导致缺件，同意生成补单"
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button :disabled="replenishmentApprovalSaving" @click="closeReplenishmentApprovalDialog">取消</el-button>
        <el-button
          type="primary"
          :loading="replenishmentApprovalSaving"
          :disabled="replenishmentApprovalSaving"
          @click="saveReplenishmentApproval"

          title="确认生成报废补单">
          确认生成报废补单
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="withdrawVisible"
      title="管理撤回"
      width="min(720px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!withdrawSaving"
      :close-on-press-escape="!withdrawSaving"
      :before-close="handleWithdrawDialogClose"
    >
      <div v-if="activeWithdrawTask" class="withdraw-panel">
        <div class="process-info-grid">
          <div>
            <label>订单号</label>
            <strong><OrderNoLink :order-no="activeWithdrawTask.orderNo" /></strong>
          </div>
          <div>
            <label>任务号</label>
            <strong>{{ activeWithdrawTask.productionTaskNo }}</strong>
          </div>
          <div>
            <label>客户</label>
            <strong>{{ activeWithdrawTask.customerName }}</strong>
          </div>
          <div>
            <label>零件</label>
            <strong>{{ activeWithdrawTask.partName }}</strong>
          </div>
          <div>
            <label>生产计划</label>
            <strong>{{ formatQuantity(activeWithdrawTask.plannedQuantity, activeWithdrawTask.unit) }}</strong>
          </div>
          <div>
            <label>当前完成</label>
            <strong>{{ formatQuantity(activeWithdrawTask.completedQuantity, activeWithdrawTask.unit) }}</strong>
          </div>
        </div>

        <el-alert
          title="撤回会重置当前任务的工序完成状态并退回待确认生产，系统会保留撤回前工序摘要和日志。请选择已经做出的零件转库存、报废，或确认无实物处理。保存前可以反复修改本表单，确认后再提交。"
          type="warning"
          :closable="false"
          class="mt-16"
        />

        <el-form label-width="128px" class="mt-16">
          <el-form-item label="管理人员姓名" required>
            <el-input v-model="withdrawForm.managerName" placeholder="请输入管理人员姓名" />
          </el-form-item>
          <el-form-item label="撤回订单原因" required>
            <el-input
              v-model="withdrawForm.reason"
              type="textarea"
              :rows="3"
              placeholder="例如：操作错误、客户变更、工序确认错误"
            />
          </el-form-item>
          <el-form-item label="处理日期" required>
            <el-date-picker
              v-model="withdrawForm.handledAt"
              type="datetime"
              placeholder="系统自动带入，可修改"
              style="width: 260px"
            />
          </el-form-item>
          <el-form-item label="处理方式" required>
            <el-radio-group v-model="withdrawForm.handlingMode" @change="handleWithdrawModeChange">
              <el-radio-button value="STOCK">零件入库存</el-radio-button>
              <el-radio-button value="SCRAP">零件报废</el-radio-button>
              <el-radio-button value="NONE">无实物处理</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="处理数量" required>
            <el-input-number
              v-model="withdrawForm.handlingQuantity"
              :min="0"
              :max="withdrawHandlingQuantityMax || undefined"
              :precision="3"
              :controls="false"
              :disabled="withdrawForm.handlingMode === 'NONE'"
              style="width: 180px"
            />
            <span class="unit-text">{{ activeWithdrawTask.unit }}</span>
            <small v-if="withdrawHandlingQuantityMax > 0" class="withdraw-quantity-limit">
              最多 {{ formatQuantity(withdrawHandlingQuantityMax, activeWithdrawTask.unit) }}
            </small>
          </el-form-item>
          <el-form-item label="其它说明">
            <el-input
              v-model="withdrawForm.remark"
              type="textarea"
              :rows="3"
              placeholder="例如：已通知仓库、现场数量复核、报废位置说明"
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button :disabled="withdrawSaving" @click="closeWithdrawDialog">取消</el-button>
        <el-button type="danger" :loading="withdrawSaving" :disabled="withdrawSaving" @click="saveWithdrawProduction"
  title="确认撤回">确认撤回</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="printPreviewVisible"
      :title="`${printDocumentTitle}打印预览`"
      width="min(1220px, calc(100vw - 24px))"
      class="responsive-dialog"
      top="3vh"
    >
      <div class="print-preview-toolbar">
        <span>A4 横版，建议页边距 8mm，当前按 {{ printableRowCount }} 条{{ printRecordLabel }}预览。</span>
        <el-button type="primary" :icon="Printer" @click="printProductionPlan">打印</el-button>
      </div>
      <div class="print-preview-frame">
        <article class="production-print-page">
          <header class="production-print-header">
            <div>
              <h1>{{ printDocumentTitle }}</h1>
              <p>{{ printScopeText }}</p>
            </div>
            <div class="production-print-meta">
              <span>制表日期：{{ printDateTime }}</span>
              <span>{{ printRecordLabel }}数量：{{ printableRowCount }}</span>
            </div>
          </header>

          <table v-if="viewMode === 'ORDER_SUMMARY'" class="production-print-table">
            <colgroup>
              <col class="print-col-index" />
              <col class="print-col-order" />
              <col class="print-col-customer" />
              <col class="print-col-date" />
              <col class="print-col-delivery" />
              <col class="print-col-part" />
              <col class="print-col-quantity" />
              <col class="print-col-current" />
              <col class="print-col-process" />
              <col class="print-col-status" />
            </colgroup>
            <thead>
              <tr>
                <th>序号</th>
                <th>订单号</th>
                <th>客户</th>
                <th>订单日期</th>
                <th>交期</th>
                <th>零件/任务</th>
                <th>生产数量</th>
                <th>订单进度</th>
                <th>当前进度</th>
                <th>订单状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in filteredOrderSummaries" :key="row.orderId">
                <td>{{ index + 1 }}</td>
                <td>{{ row.orderNo }}</td>
                <td>{{ row.customerName }}</td>
                <td>{{ formatDate(row.orderDate) }}</td>
                <td>{{ formatDate(row.deliveryDate) }}</td>
                <td>{{ row.partCount }} / {{ row.taskCount }}</td>
                <td>{{ orderSummaryQuantityText(row) }}</td>
                <td>{{ row.progressPercent }}%</td>
                <td>{{ orderSummaryProgressText(row) }}</td>
                <td>{{ productionStatusLabel(row.status) }}</td>
              </tr>
            </tbody>
          </table>

          <table v-else class="production-print-table">
            <colgroup>
              <col class="print-col-index" />
              <col class="print-col-task" />
              <col class="print-col-order" />
              <col class="print-col-customer" />
              <col class="print-col-date" />
              <col class="print-col-delivery" />
              <col class="print-col-part" />
              <col class="print-col-customer-order" />
              <col class="print-col-quantity" />
              <col class="print-col-process" />
              <col class="print-col-current" />
              <col class="print-col-status" />
            </colgroup>
            <thead>
              <tr>
                <th>序号</th>
                <th>任务号</th>
                <th>订单号</th>
                <th>客户</th>
                <th>订单日期</th>
                <th>交期</th>
                <th>零件</th>
                <th>客户订单</th>
                <th>完成/生产计划</th>
                <th>生产流程</th>
                <th>当前工序</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in filteredTasks" :key="row.id">
                <td>{{ index + 1 }}</td>
                <td>
                  <div>{{ row.productionTaskNo }}</div>
                  <small v-if="taskRelationText(row)" class="print-subtext">{{ taskRelationText(row) }}</small>
                </td>
                <td>{{ row.orderNo }}</td>
                <td>{{ row.customerName }}</td>
                <td>{{ formatDate(row.orderDate) }}</td>
                <td>{{ formatDate(row.deliveryDate) }}</td>
                <td>{{ row.partName }}</td>
                <td>{{ formatCustomerOrderQuantity(row) }}</td>
                <td>
                  <div>{{ formatCompletedPlan(row) }}</div>
                  <small v-if="shortageSummary(row)" class="print-subtext warning">{{ shortageSummary(row) }}</small>
                </td>
                <td>{{ formatProcessSteps(row) }}</td>
                <td>
                  <div>{{ currentProcessText(row) }}</div>
                  <small class="print-subtext">{{ processProgressText(row) }}</small>
                </td>
                <td>{{ productionStatusLabel(effectiveProductionStatus(row)) }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
      <template #footer>
        <el-button title="关闭" @click="printPreviewVisible = false">关闭</el-button>
        <el-button type="primary" :icon="Printer" @click="printProductionPlan">打印</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Bell, Camera, Document, Download, Minus, Plus, Printer, Refresh, RefreshLeft } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import DrawingPreviewLink from '../components/DrawingPreviewLink.vue';
import NoticeAcknowledgeDialog from '../components/NoticeAcknowledgeDialog.vue';
import OrderSelect from '../components/OrderSelect.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import type {
  OrderSummary,
  ProductionNotice,
  ProductionNoticeStatus,
  ProductionNoticeType,
  ProductionOperator,
  ProductionOrderSummary,
  ProductionOrderSummaryTask,
  ProductionOrderSummaryStatus,
  ProductionProcessCompletion,
  ProductionReplenishmentRequest,
  ProductionScrapRecord,
  ProductionShortageMode,
  ProductionTask
} from '../types/erp';
import { normalizeDisplayFileName } from '../utils/fileNames';
import { formatDate, formatDateTime, formatQuantity } from '../utils/format';
import { escapeHtml, formatFileDateTime, openPrintHtml } from '../utils/tableExport';

type ProductionDisplayStatus = ProductionOrderSummaryStatus;
type ProductionViewMode = 'ORDER_SUMMARY' | 'TASK_DETAIL';
type ProductionOrderStatusFilter = ProductionDisplayStatus | 'ACTIVE' | 'ALL';
type ProductionStatCardKey = ProductionDisplayStatus | 'ACTIVE' | 'ALL';
type ProductionWorkTableKey =
  | 'orderSummary'
  | 'taskDetail'
  | 'scrapRecords'
  | 'batchStartTasks'
  | 'productionNotices'
  | 'replenishmentRequests';
type BatchStartTask = ProductionOrderSummaryTask &
  Partial<Pick<ProductionTask, 'status' | 'orderStatus' | 'inventoryBatchNo' | 'processCompletions'>>;

const route = useRoute();
const router = useRouter();
const { isMobileLayout } = useDeviceProfile();
const orderOptions = ref<OrderSummary[]>([]);
const tasks = ref<ProductionTask[]>([]);
const orderSummaries = ref<ProductionOrderSummary[]>([]);
const dateRange = ref<string[]>([]);
const selectedCustomerName = ref('');
const loading = ref(false);
const productionExporting = ref(false);
const productionPageRefreshing = ref(false);
const noticeVisible = ref(false);
const noticeLoading = ref(false);
const productionNoticeExporting = ref(false);
const acknowledgeVisible = ref(false);
const acknowledgeSaving = ref(false);
const startConfirmVisible = ref(false);
const startSaving = ref(false);
const batchStartVisible = ref(false);
const batchStartSaving = ref(false);
const productionNotices = ref<ProductionNotice[]>([]);
const productionNoticeStatusFilter = ref<ProductionNoticeStatus | 'ALL'>('PENDING');
const productionNoticeDateRange = ref<string[]>([]);
const productionNoticeDefaultLimit = Number(20);
const productionNoticePagination = reactive({
  page: 1,
  limit: productionNoticeDefaultLimit,
  totalCount: 0
});
const productionNoticeServerCounts = reactive({
  ALL: 0,
  PENDING: 0,
  ACKNOWLEDGED: 0
});
const activeProductionNotice = ref<ProductionNotice>();
const replenishmentRequestVisible = ref(false);
const replenishmentRequestLoading = ref(false);
const replenishmentRequestExporting = ref(false);
const productionReplenishmentRequests = ref<ProductionReplenishmentRequest[]>([]);
const replenishmentRequestStatusFilter = ref<ProductionReplenishmentRequest['status'] | 'ALL'>('PENDING');
const replenishmentRequestKeyword = ref('');
const replenishmentRequestDefaultLimit = Number(20);
const replenishmentRequestPagination = reactive({
  page: 1,
  limit: replenishmentRequestDefaultLimit,
  totalCount: 0
});
const replenishmentRequestServerCounts = reactive({
  ALL: 0,
  PENDING: 0,
  APPROVED: 0,
  REJECTED: 0
});
const replenishmentRejectVisible = ref(false);
const replenishmentRejectSaving = ref(false);
const activeReplenishmentRejectRequest = ref<ProductionReplenishmentRequest>();
const scrapVisible = ref(false);
const scrapLoading = ref(false);
const scrapExporting = ref(false);
const scrapRecords = ref<ProductionScrapRecord[]>([]);
const scrapRecordDefaultLimit = Number(20);
const scrapRecordPagination = reactive({
  page: 1,
  limit: scrapRecordDefaultLimit,
  totalCount: 0
});
const productionMainDefaultLimit = Number(20);
const orderSummaryPagination = reactive({
  page: 1,
  limit: productionMainDefaultLimit,
  totalCount: 0
});
const taskPagination = reactive({
  page: 1,
  limit: productionMainDefaultLimit,
  totalCount: 0
});
const productionTaskServerCounts = reactive<Record<ProductionDisplayStatus, number>>({
  PENDING: 0,
  IN_PROGRESS: 0,
  WAITING_CONFIRMATION: 0,
  READY_TO_COMPLETE: 0,
  COMPLETED: 0,
  RECEIVED: 0,
  STORED: 0,
  CANCELLED: 0
});
const productionOrderSummaryServerCounts = reactive<Record<ProductionDisplayStatus, number>>({
  PENDING: 0,
  IN_PROGRESS: 0,
  WAITING_CONFIRMATION: 0,
  READY_TO_COMPLETE: 0,
  COMPLETED: 0,
  RECEIVED: 0,
  STORED: 0,
  CANCELLED: 0
});
const productionStatusCountKeys: ProductionDisplayStatus[] = [
  'PENDING',
  'IN_PROGRESS',
  'READY_TO_COMPLETE',
  'COMPLETED',
  'RECEIVED'
];
const scrapOrderOptions = ref<OrderSummary[]>([]);
const scrapDateRange = ref<string[]>([]);
const expandedMobileProductionOrderIds = ref<string[]>([]);
const expandedMobileProductionTaskIds = ref<string[]>([]);
const processVisible = ref(false);
const processSaving = ref(false);
const quantityOverrideDialogVisible = ref(false);
const finalConfirmVisible = ref(false);
const finalSaving = ref(false);
const replenishmentApprovalVisible = ref(false);
const replenishmentApprovalSaving = ref(false);
const withdrawVisible = ref(false);
const withdrawSaving = ref(false);
const printPreviewVisible = ref(false);
const activeStartTask = ref<ProductionTask>();
const batchStartTasks = ref<BatchStartTask[]>([]);
const batchStartSelectedTaskIds = ref<string[]>([]);
const selectedTaskRows = ref<ProductionTask[]>([]);
const activeTask = ref<ProductionTask>();
const activeFinalTask = ref<ProductionTask>();
const activeReplenishmentApprovalTask = ref<ProductionTask>();
const activeReplenishmentApprovalCompletion = ref<ProductionProcessCompletion>();
const activeWithdrawTask = ref<ProductionTask>();
const activeProcessName = ref('');
const batchProcessNames = ref<string[]>([]);
const processOperatorCodes = reactive<Record<string, string[]>>({});
const startSupervisorScope = 'start-supervisor';
const batchStartSupervisorScope = 'batch-start-supervisor';
const finalSupervisorScope = 'final-supervisor';
const finalOperatorScope = 'final';
const startSupervisorCode = ref('');
const batchStartSupervisorCode = ref('');
const finalSupervisorCode = ref('');
const operatorLoadingByScope = reactive<Record<string, boolean>>({});
const operatorOptionsByScope = reactive<Record<string, ProductionOperator[]>>({});
const operatorKeywordByScope = reactive<Record<string, string>>({});
const activeStatus = ref<ProductionDisplayStatus | 'ALL'>('ALL');
const activeOrderStatus = ref<ProductionOrderStatusFilter>('ALL');
const viewMode = ref<ProductionViewMode>('ORDER_SUMMARY');
const selectedProductionOrderNo = ref('');
const printDateTime = ref('');
const productionWorkTableHeightLimits = {
  min: 320,
  max: 860,
  step: 80
};
const productionWorkTableDefaultHeights = {
  orderSummary: 520,
  taskDetail: 560,
  scrapRecords: 520,
  batchStartTasks: 320,
  productionNotices: 560,
  replenishmentRequests: 560
} satisfies Record<ProductionWorkTableKey, number>;
const productionWorkTableHeightStorageKey = 'baisheng.erp.productionWorkTableHeights.v1';
// 生产页面表格、通知和现场任务列表高度只保存为本机 UI 偏好，不写入订单、生产任务、通知状态或库存业务数据。
const productionWorkTableHeights = reactive<Record<ProductionWorkTableKey, number>>({
  ...productionWorkTableDefaultHeights
});
let operatorSearchRequestSequence = 0;
let quantityOverrideResolver: ((confirmed: boolean) => void) | undefined;
const operatorSearchRequestByScope = reactive<Record<string, number>>({});

const filters = reactive<{
  customerId?: string;
  orderNo?: string;
}>({});

const productionNoticeFilters = reactive<{
  customerId?: string;
  orderNo: string;
  partCode: string;
  keyword: string;
  noticeType: ProductionNoticeType | 'ALL';
}>({
  customerId: undefined,
  orderNo: '',
  partCode: '',
  keyword: '',
  noticeType: 'ALL'
});

const productionNoticeTypeOptions: Array<{ label: string; value: ProductionNoticeType }> = [
  { label: '数量增加', value: 'QUANTITY_INCREASE' },
  { label: '数量减少', value: 'QUANTITY_DECREASE' },
  { label: '订单取消', value: 'ORDER_CANCELLED' },
  { label: '新增零件', value: 'MATERIAL_ADDED' },
  { label: '管理撤回', value: 'TASK_WITHDRAWN' }
];

const scrapFilters = reactive<{
  customerId?: string;
  orderNo?: string;
}>({});

const activeProductionWorkTableKey = computed<ProductionWorkTableKey>(() =>
  viewMode.value === 'ORDER_SUMMARY' ? 'orderSummary' : 'taskDetail'
);
const activeProductionWorkTableHeight = computed(() => productionWorkTableHeights[activeProductionWorkTableKey.value]);
const activeProductionWorkTableDefaultHeight = computed(
  () => productionWorkTableDefaultHeights[activeProductionWorkTableKey.value]
);
const productionWorkTableHeightLabel = computed(() =>
  viewMode.value === 'ORDER_SUMMARY' ? '订单汇总表格高度' : '零件任务明细表格高度'
);
const productionWorkTableResetLabel = computed(() =>
  viewMode.value === 'ORDER_SUMMARY' ? '恢复订单汇总表格默认高度' : '恢复零件任务明细表格默认高度'
);

function clampProductionWorkTableHeight(value: number) {
  return Math.min(productionWorkTableHeightLimits.max, Math.max(productionWorkTableHeightLimits.min, value));
}

function adjustProductionWorkTableHeight(key: ProductionWorkTableKey, delta: number) {
  productionWorkTableHeights[key] = clampProductionWorkTableHeight(productionWorkTableHeights[key] + delta);
}

function adjustActiveProductionWorkTableHeight(delta: number) {
  adjustProductionWorkTableHeight(activeProductionWorkTableKey.value, delta);
}

function resetProductionWorkTableHeight(key: ProductionWorkTableKey) {
  productionWorkTableHeights[key] = productionWorkTableDefaultHeights[key];
}

function resetActiveProductionWorkTableHeight() {
  resetProductionWorkTableHeight(activeProductionWorkTableKey.value);
}

function productionWorkTableHeightStyle(key: ProductionWorkTableKey) {
  return `${productionWorkTableHeights[key]}px`;
}

function restoreProductionWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const rawValue = window.localStorage.getItem(productionWorkTableHeightStorageKey);
    const savedValue = rawValue ? JSON.parse(rawValue) : {};
    for (const key of Object.keys(productionWorkTableDefaultHeights) as ProductionWorkTableKey[]) {
      const savedHeight = Number(savedValue[key]);
      if (Number.isFinite(savedHeight)) {
        productionWorkTableHeights[key] = clampProductionWorkTableHeight(savedHeight);
      }
    }
  } catch {
    productionWorkTableHeights.orderSummary = productionWorkTableDefaultHeights.orderSummary;
    productionWorkTableHeights.taskDetail = productionWorkTableDefaultHeights.taskDetail;
    productionWorkTableHeights.scrapRecords = productionWorkTableDefaultHeights.scrapRecords;
    productionWorkTableHeights.batchStartTasks = productionWorkTableDefaultHeights.batchStartTasks;
    productionWorkTableHeights.productionNotices = productionWorkTableDefaultHeights.productionNotices;
    productionWorkTableHeights.replenishmentRequests = productionWorkTableDefaultHeights.replenishmentRequests;
  }
}

function saveProductionWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(productionWorkTableHeightStorageKey, JSON.stringify(productionWorkTableHeights));
  } catch {
    // 本机 UI 偏好写入失败不阻断开始生产、工序确认、完成确认、通知或补单处理。
  }
}

const processForm = reactive({
  isCompleted: true,
  completedQuantity: 1,
  scrapQuantity: 0,
  shortageMode: 'REPLENISHMENT_REQUEST' as ProductionShortageMode,
  managerName: '',
  shortageReason: '',
  quantityOverrideReason: '',
  remark: ''
});

const finalForm = reactive({
  completedQuantity: 1,
  operatorCodes: [] as string[],
  scrapQuantity: 0,
  shortageMode: 'REPLENISHMENT_REQUEST' as ProductionShortageMode,
  managerName: '',
  shortageReason: '',
  remark: ''
});

const replenishmentApprovalForm = reactive({
  managerName: '',
  remark: ''
});

const replenishmentRejectForm = reactive({
  managerName: '',
  reason: ''
});

const withdrawForm = reactive({
  managerName: '',
  reason: '',
  handledAt: new Date() as Date | undefined,
  handlingMode: 'STOCK' as 'STOCK' | 'SCRAP' | 'NONE',
  handlingQuantity: 0,
  remark: ''
});

const operatorOptions = ref<ProductionOperator[]>([]);
const operatorCache = reactive<Record<string, ProductionOperator>>({});

const scopedTasks = computed(() => {
  if (!selectedProductionOrderNo.value) {
    return tasks.value;
  }
  return tasks.value.filter((task) => task.orderNo === selectedProductionOrderNo.value);
});
const selectedProductionOrderOption = computed(() =>
  selectedProductionOrderNo.value ? orderOptions.value.find((item) => item.orderNo === selectedProductionOrderNo.value) : undefined
);
const withdrawHandlingQuantityMax = computed(() =>
  activeWithdrawTask.value ? defaultWithdrawHandlingQuantity(activeWithdrawTask.value) : 0
);

const counts = computed(() => ({
  PENDING: productionTaskServerCounts.PENDING,
  IN_PROGRESS: productionTaskServerCounts.IN_PROGRESS,
  WAITING_CONFIRMATION: productionTaskServerCounts.WAITING_CONFIRMATION,
  READY_TO_COMPLETE: productionTaskServerCounts.READY_TO_COMPLETE,
  COMPLETED: productionTaskServerCounts.COMPLETED,
  RECEIVED: productionTaskServerCounts.RECEIVED,
  STORED: productionTaskServerCounts.STORED,
  CANCELLED: productionTaskServerCounts.CANCELLED
}));
const orderCounts = computed(() => ({
  PENDING: productionOrderSummaryServerCounts.PENDING,
  IN_PROGRESS: productionOrderSummaryServerCounts.IN_PROGRESS,
  WAITING_CONFIRMATION: productionOrderSummaryServerCounts.WAITING_CONFIRMATION,
  READY_TO_COMPLETE: productionOrderSummaryServerCounts.READY_TO_COMPLETE,
  COMPLETED: productionOrderSummaryServerCounts.COMPLETED,
  RECEIVED: productionOrderSummaryServerCounts.RECEIVED,
  STORED: productionOrderSummaryServerCounts.STORED,
  CANCELLED: productionOrderSummaryServerCounts.CANCELLED
}));
const pendingNoticeCount = computed(() => productionNoticeServerCounts.PENDING);
const productionNoticeCounts = computed(() => productionNoticeServerCounts);
const filteredProductionNotices = computed(() => productionNotices.value);
const pendingReplenishmentRequestCount = computed(() => replenishmentRequestServerCounts.PENDING);
const replenishmentRequestCounts = computed(() => replenishmentRequestServerCounts);
const filteredProductionReplenishmentRequests = computed(() => productionReplenishmentRequests.value);

const filteredTasks = computed(() => {
  const rows = scopedTasks.value;
  if (activeStatus.value === 'ALL') {
    return rows;
  }
  return rows.filter((task) => effectiveProductionStatus(task) === activeStatus.value);
});

const filteredOrderSummaries = computed(() => {
  if (activeOrderStatus.value === 'ALL') {
    return orderSummaries.value;
  }
  if (activeOrderStatus.value === 'ACTIVE') {
    return orderSummaries.value.filter((summary) =>
      ['PENDING', 'IN_PROGRESS', 'READY_TO_COMPLETE'].includes(summary.status)
    );
  }
  return orderSummaries.value.filter((summary) => summary.status === activeOrderStatus.value);
});

const activeOrderSummary = computed(() =>
  selectedProductionOrderNo.value
    ? orderSummaries.value.find((summary) => summary.orderNo === selectedProductionOrderNo.value)
    : undefined
);

const selectedOrderOverview = computed<ProductionOrderSummary | undefined>(() => {
  if (activeOrderSummary.value) {
    return activeOrderSummary.value;
  }
  if (!selectedProductionOrderNo.value || scopedTasks.value.length === 0) {
    return undefined;
  }
  return buildOrderSummaryFromTasks(scopedTasks.value);
});

const productionStatCards = computed<Array<{ key: ProductionStatCardKey; label: string; value: number }>>(() => {
  const isOrderSummary = viewMode.value === 'ORDER_SUMMARY';
  const countSource =
    !isOrderSummary && selectedProductionOrderNo.value && selectedOrderOverview.value
      ? orderSummaryStatusCounts(selectedOrderOverview.value)
      : isOrderSummary
        ? orderCounts.value
        : counts.value;

  const allCount =
    countSource.PENDING +
    countSource.IN_PROGRESS +
    countSource.READY_TO_COMPLETE +
    countSource.COMPLETED +
    countSource.RECEIVED;
  const allCard: { key: ProductionStatCardKey; label: string; value: number } = {
    key: 'ALL',
    label: '全部',
    value: allCount
  };
  const cards: Array<{ key: ProductionStatCardKey; label: string; value: number }> = [
    { key: 'PENDING', label: '待确认生产', value: countSource.PENDING },
    { key: 'IN_PROGRESS', label: '生产中', value: countSource.IN_PROGRESS },
    { key: 'READY_TO_COMPLETE', label: '待确认完成', value: countSource.READY_TO_COMPLETE },
    { key: 'COMPLETED', label: '已完成', value: countSource.COMPLETED },
    { key: 'RECEIVED', label: '已入库', value: countSource.RECEIVED }
  ];
  if (isOrderSummary) {
    return [
      allCard,
      {
        key: 'ACTIVE',
        label: '待处理',
        value: countSource.PENDING + countSource.IN_PROGRESS + countSource.READY_TO_COMPLETE
      },
      ...cards
    ];
  }
  return [allCard, ...cards];
});

function isProductionStatActive(status: ProductionStatCardKey) {
  if (status === 'ALL') {
    return viewMode.value === 'ORDER_SUMMARY' ? activeOrderStatus.value === 'ALL' : activeStatus.value === 'ALL';
  }
  if (status === 'ACTIVE') {
    return viewMode.value === 'ORDER_SUMMARY' && activeOrderStatus.value === 'ACTIVE';
  }
  return viewMode.value === 'ORDER_SUMMARY' ? activeOrderStatus.value === status : activeStatus.value === status;
}

function handleProductionStatClick(status: ProductionStatCardKey) {
  if (viewMode.value === 'ORDER_SUMMARY') {
    activeOrderStatus.value = status;
    void reloadOrderSummariesFromFirstPage();
    return;
  }
  if (status === 'ACTIVE') {
    return;
  }
  activeStatus.value = status;
  void reloadTasksFromFirstPage();
}

async function reloadOrderSummariesFromFirstPage() {
  loading.value = true;
  try {
    orderSummaryPagination.page = 1;
    expandedMobileProductionOrderIds.value = [];
    await loadOrderSummaries();
  } finally {
    loading.value = false;
  }
}

async function reloadTasksFromFirstPage() {
  loading.value = true;
  try {
    taskPagination.page = 1;
    selectedTaskRows.value = [];
    expandedMobileProductionTaskIds.value = [];
    await loadTasks();
  } finally {
    loading.value = false;
  }
}

async function handleOrderStatusTabChange() {
  await reloadOrderSummariesFromFirstPage();
}

async function handleTaskStatusTabChange() {
  await reloadTasksFromFirstPage();
}

async function handleOrderSummaryPageChange(page: number) {
  loading.value = true;
  try {
    orderSummaryPagination.page = page;
    expandedMobileProductionOrderIds.value = [];
    await loadOrderSummaries();
  } finally {
    loading.value = false;
  }
}

async function handleTaskPageChange(page: number) {
  loading.value = true;
  try {
    taskPagination.page = page;
    selectedTaskRows.value = [];
    expandedMobileProductionTaskIds.value = [];
    await loadTasks();
  } finally {
    loading.value = false;
  }
}

function isMobileProductionOrderExpanded(orderId: string) {
  return expandedMobileProductionOrderIds.value.includes(orderId);
}

function toggleMobileProductionOrderCard(orderId: string) {
  expandedMobileProductionOrderIds.value = isMobileProductionOrderExpanded(orderId)
    ? expandedMobileProductionOrderIds.value.filter((id) => id !== orderId)
    : [...expandedMobileProductionOrderIds.value, orderId];
}

function isMobileProductionTaskExpanded(taskId: string) {
  return expandedMobileProductionTaskIds.value.includes(taskId);
}

function toggleMobileProductionTaskCard(taskId: string) {
  expandedMobileProductionTaskIds.value = isMobileProductionTaskExpanded(taskId)
    ? expandedMobileProductionTaskIds.value.filter((id) => id !== taskId)
    : [...expandedMobileProductionTaskIds.value, taskId];
}

const selectedStartableTasks = computed(() => selectedTaskRows.value.filter((task) => shouldShowStartAction(task)));
const selectedStartableTaskIds = computed<string[]>({
  get: () => selectedStartableTasks.value.map((task) => task.id),
  set: (ids) => {
    const selectedIds = new Set(ids);
    selectedTaskRows.value = scopedTasks.value.filter((task) => selectedIds.has(task.id) && shouldShowStartAction(task));
  }
});

const selectedOrderPendingTasks = computed(() =>
  selectedProductionOrderNo.value ? pendingTasksForOrder(selectedProductionOrderNo.value) : []
);

const batchStartOrderNo = computed(() => batchStartTasks.value[0]?.orderNo || activeOrderSummary.value?.orderNo || '-');

const activeStatusLabel = computed(() => {
  if (activeStatus.value === 'ALL') {
    return '全部';
  }
  return productionStatusLabel(activeStatus.value);
});
const activeOrderStatusLabel = computed(() => {
  if (activeOrderStatus.value === 'ALL') {
    return '全部';
  }
  if (activeOrderStatus.value === 'ACTIVE') {
    return '待处理';
  }
  return productionStatusLabel(activeOrderStatus.value);
});
const printDocumentTitle = computed(() => (viewMode.value === 'ORDER_SUMMARY' ? '生产订单汇总表' : '生产计划表'));
const printRecordLabel = computed(() => (viewMode.value === 'ORDER_SUMMARY' ? '订单' : '任务'));
const printableRowCount = computed(() =>
  viewMode.value === 'ORDER_SUMMARY' ? filteredOrderSummaries.value.length : filteredTasks.value.length
);

const printScopeText = computed(() => {
  const customerName = filters.customerId ? selectedCustomerName.value || '当前客户' : '全部客户';
  const orderNo = selectedProductionOrderNo.value || filters.orderNo || '全部订单';
  const dateText = dateRange.value.length === 2 ? `${dateRange.value[0]} 至 ${dateRange.value[1]}` : '全部订单日期';
  const statusText = viewMode.value === 'ORDER_SUMMARY' ? activeOrderStatusLabel.value : activeStatusLabel.value;
  return `客户：${customerName} | 订单日期：${dateText} | 订单：${orderNo} | 状态：${statusText}`;
});

const activeProcessLabel = computed(() =>
  activeTask.value && activeProcessName.value ? processStepDisplay(activeTask.value, activeProcessName.value) : activeProcessName.value
);
const processDialogTitle = computed(() => (activeProcessLabel.value ? `${activeProcessLabel.value}工序完成表` : '工序完成表'));
const finalConfirmTitle = computed(() =>
  activeFinalTask.value?.status === 'COMPLETED' ? '修改生产完成确认' : '确认生产完成'
);
const finalProcessLabel = computed(() => {
  if (!activeFinalTask.value) {
    return '-';
  }
  const finalProcessName = activeFinalTask.value.processSteps[activeFinalTask.value.processSteps.length - 1];
  return finalProcessName ? processStepDisplay(activeFinalTask.value, finalProcessName) : '-';
});
const startProcessText = computed(() => {
  const task = activeStartTask.value;
  if (!task) {
    return '-';
  }
  if (task.processSteps.length === 0) {
    return '未配置生产流程';
  }
  return formatProductionProcessSteps(task);
});

const finalOperatorOptionRows = computed(() => operatorOptionRowsWithSelectedCodes(finalForm.operatorCodes, finalOperatorScope));
const startSupervisorOptionRows = computed(() =>
  supervisorOptionRowsWithSelectedCode(startSupervisorCode.value, startSupervisorScope)
);
const batchStartSupervisorOptionRows = computed(() =>
  supervisorOptionRowsWithSelectedCode(batchStartSupervisorCode.value, batchStartSupervisorScope)
);
const finalSupervisorOptionRows = computed(() =>
  supervisorOptionRowsWithSelectedCode(finalSupervisorCode.value, finalSupervisorScope)
);

const batchProcessOptions = computed(() => {
  if (!activeTask.value || !activeProcessName.value || !processForm.isCompleted) {
    return [];
  }
  if (isProcessCompleted(activeTask.value, activeProcessName.value)) {
    return [activeProcessName.value];
  }

  const activeIndex = activeTask.value.processSteps.indexOf(activeProcessName.value);
  if (activeIndex < 0) {
    return [];
  }

  return activeTask.value.processSteps.slice(activeIndex);
});

const selectedProcessNamesForOperatorForm = computed(() => {
  if (!activeProcessName.value || !processForm.isCompleted) {
    return activeProcessName.value ? [activeProcessName.value] : [];
  }
  return batchProcessNames.value.length > 0 ? batchProcessNames.value : [activeProcessName.value];
});

const activeProcessCompletion = computed(() => {
  if (!activeTask.value || !activeProcessName.value) {
    return undefined;
  }
  return getProcessCompletion(activeTask.value, activeProcessName.value);
});

const activeProcessLogs = computed(() => activeProcessCompletion.value?.logs || []);
const activeProcessReadonly = computed(() =>
  Boolean(activeTask.value?.inventoryBatchNo || activeTask.value?.status === 'STORED' || activeTask.value?.orderStatus === 'COMPLETED')
);
const activeProcessReadonlyText = computed(() =>
  activeTask.value?.orderStatus === 'COMPLETED'
    ? '该订单已完成发货，工序完成表只能查看，不能再修改。'
    : '该生产任务已经入库，工序完成表只能查看，不能再修改。'
);

const processRecordTimeText = computed(() => {
  if (activeProcessCompletion.value?.completedAt) {
    return formatDateTime(activeProcessCompletion.value.completedAt);
  }
  return '提交时由系统自动记录';
});

const activeExpectedProcessQuantity = computed(() => {
  if (!activeTask.value || !activeProcessName.value) {
    return 0;
  }
  return expectedProcessQuantity(activeTask.value, activeProcessName.value);
});

const activePreviousProcessName = computed(() => {
  if (!activeTask.value || !activeProcessName.value) {
    return '';
  }
  const activeIndex = activeTask.value.processSteps.indexOf(activeProcessName.value);
  return activeIndex > 0 ? activeTask.value.processSteps[activeIndex - 1] : '';
});

const activePreviousShortageQuantity = computed(() => {
  if (!activeTask.value || !activePreviousProcessName.value) {
    return 0;
  }
  return Math.max(roundQuantity(activeTask.value.plannedQuantity - activeExpectedProcessQuantity.value), 0);
});

const shouldShowProcessQuantityNotice = computed(
  () => processForm.isCompleted && activePreviousShortageQuantity.value > 0 && Boolean(activePreviousProcessName.value)
);

const shouldShowQuantityOverridePanel = computed(
  () =>
    shouldShowProcessQuantityNotice.value &&
    Number(processForm.completedQuantity ?? 0) > activeExpectedProcessQuantity.value &&
    !activeProcessReadonly.value
);

const processQuantityWarningText = computed(() => {
  if (!activeTask.value) {
    return '';
  }
  const expectedText = formatQuantity(activeExpectedProcessQuantity.value, activeTask.value.unit);
  const shortageText = formatQuantity(activePreviousShortageQuantity.value, activeTask.value.unit);
  const previousText = activePreviousProcessName.value ? processStepDisplay(activeTask.value, activePreviousProcessName.value) : '上一道工序';
  return `此工序应该是 ${expectedText}，因为${previousText}少了 ${shortageText}，请与前一道工序确认实际数量。`;
});

const quantityOverrideReasonPreview = computed(() => formatLongTextPreview(processForm.quantityOverrideReason, 42, '-'));
const quantityOverrideReasonTitle = computed(() => String(processForm.quantityOverrideReason || '').trim() || '-');

const isFinalProcessSelected = computed(() => {
  if (!activeTask.value || !processForm.isCompleted) {
    return false;
  }
  const finalProcessName = activeTask.value.processSteps[activeTask.value.processSteps.length - 1];
  return Boolean(finalProcessName && (activeProcessName.value === finalProcessName || batchProcessNames.value.includes(finalProcessName)));
});

const shortageQuantity = computed(() => {
  if (!activeTask.value || !isFinalProcessSelected.value) {
    return 0;
  }
  return roundQuantity(activeTask.value.plannedQuantity - Number(processForm.completedQuantity ?? 0));
});

const shouldShowShortagePanel = computed(() => shortageQuantity.value > 0);

const finalShortageQuantity = computed(() => {
  if (!activeFinalTask.value) {
    return 0;
  }
  return Math.max(roundQuantity(activeFinalTask.value.plannedQuantity - Number(finalForm.completedQuantity ?? 0)), 0);
});

const finalOverageQuantity = computed(() => {
  if (!activeFinalTask.value) {
    return 0;
  }
  return Math.max(roundQuantity(Number(finalForm.completedQuantity ?? 0) - activeFinalTask.value.plannedQuantity), 0);
});

const finalOrderReceiptQuantityEstimate = computed(() => {
  if (!activeFinalTask.value) {
    return 0;
  }
  return Math.min(Number(finalForm.completedQuantity ?? 0), activeFinalTask.value.customerOrderQuantity ?? activeFinalTask.value.plannedQuantity);
});

const finalStockQuantityEstimate = computed(() => {
  if (!activeFinalTask.value) {
    return 0;
  }
  return Math.max(roundQuantity(Number(finalForm.completedQuantity ?? 0) - finalOrderReceiptQuantityEstimate.value), 0);
});

const finalShouldShowShortagePanel = computed(() => finalShortageQuantity.value > 0);

function taskQueryParams() {
  return {
    customerId: filters.customerId,
    orderNo: filters.orderNo,
    dateFrom: dateRange.value[0],
    dateTo: dateRange.value[1]
  };
}

function productionTaskDisplayStatusFilter() {
  return activeStatus.value === 'ALL' ? undefined : activeStatus.value;
}

function productionOrderSummaryDisplayStatusFilter() {
  return activeOrderStatus.value === 'ALL' ? undefined : activeOrderStatus.value;
}

function resetProductionTaskCounts() {
  for (const key of Object.keys(productionTaskServerCounts) as ProductionDisplayStatus[]) {
    productionTaskServerCounts[key] = 0;
  }
}

function resetProductionOrderSummaryCounts() {
  for (const key of Object.keys(productionOrderSummaryServerCounts) as ProductionDisplayStatus[]) {
    productionOrderSummaryServerCounts[key] = 0;
  }
}

function resetProductionMainPagination() {
  orderSummaryPagination.page = 1;
  taskPagination.page = 1;
}

let selectedCustomerNameRequestSeq = 0;
async function loadSelectedCustomerName() {
  const customerId = filters.customerId;
  const requestId = ++selectedCustomerNameRequestSeq;
  if (!customerId) {
    selectedCustomerName.value = '';
    return;
  }
  try {
    // 生产页只按当前筛选客户回填名称，避免为了打印范围一次性加载全量客户。
    const customer = await erpApi.customer(customerId);
    if (requestId === selectedCustomerNameRequestSeq) {
      selectedCustomerName.value = customer.customerName;
    }
  } catch (error) {
    if (requestId === selectedCustomerNameRequestSeq) {
      selectedCustomerName.value = '';
    }
    ElMessage.error(error instanceof Error ? error.message : '客户名称加载失败，请确认客户筛选和后端服务');
  }
}

async function loadOperators() {
  try {
    const operators = await erpApi.productionOperators();
    setOperatorOptions(operators);
  } catch (error) {
    clearOperatorOptions();
    ElMessage.error(error instanceof Error ? error.message : '操作人员列表加载失败，请确认后端服务和人员资料');
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

async function loadTasks() {
  try {
    // 生产任务按客户、订单日期和订单号过滤，避免任务列表混在一起难以操作。
    const offset = (taskPagination.page - 1) * taskPagination.limit;
    const baseFilters = taskQueryParams();
    const [result, ...countResults] = await Promise.all([
      erpApi.productionTasksPage({
        ...baseFilters,
        displayStatus: productionTaskDisplayStatusFilter(),
        limit: taskPagination.limit,
        offset
      }),
      ...productionStatusCountKeys.map((displayStatus) =>
        erpApi.productionTasksPage({ ...baseFilters, displayStatus, limit: Number(1), offset: Number(0) })
      )
    ]);
    // 生产主列表只加载当前页；状态卡数量通过后端分页 totalCount 计算，避免当前页统计误导车间处理。
    tasks.value = result.items;
    taskPagination.totalCount = result.totalCount;
    taskPagination.limit = result.limit;
    taskPagination.page = Math.floor(result.offset / result.limit) + 1;
    resetProductionTaskCounts();
    productionStatusCountKeys.forEach((displayStatus, index) => {
      productionTaskServerCounts[displayStatus] = countResults[index]?.totalCount || 0;
    });
    const maxPage = Math.max(Math.ceil(result.totalCount / result.limit), 1);
    if (result.items.length === 0 && result.totalCount > 0 && taskPagination.page > maxPage) {
      taskPagination.page = maxPage;
      await loadTasks();
    }
  } catch (error) {
    tasks.value = [];
    taskPagination.totalCount = 0;
    resetProductionTaskCounts();
    selectedTaskRows.value = [];
    expandedMobileProductionTaskIds.value = [];
    ElMessage.error(error instanceof Error ? error.message : '生产任务加载失败，请确认后端服务和筛选条件');
  }
}

async function loadOrderSummaries() {
  try {
    const offset = (orderSummaryPagination.page - 1) * orderSummaryPagination.limit;
    const baseFilters = taskQueryParams();
    const [result, ...countResults] = await Promise.all([
      erpApi.productionOrderSummariesPage({
        ...baseFilters,
        displayStatus: productionOrderSummaryDisplayStatusFilter(),
        limit: orderSummaryPagination.limit,
        offset
      }),
      ...productionStatusCountKeys.map((displayStatus) =>
        erpApi.productionOrderSummariesPage({ ...baseFilters, displayStatus, limit: Number(1), offset: Number(0) })
      )
    ]);
    orderSummaries.value = result.items;
    orderSummaryPagination.totalCount = result.totalCount;
    orderSummaryPagination.limit = result.limit;
    orderSummaryPagination.page = Math.floor(result.offset / result.limit) + 1;
    resetProductionOrderSummaryCounts();
    productionStatusCountKeys.forEach((displayStatus, index) => {
      productionOrderSummaryServerCounts[displayStatus] = countResults[index]?.totalCount || 0;
    });
    const maxPage = Math.max(Math.ceil(result.totalCount / result.limit), 1);
    if (result.items.length === 0 && result.totalCount > 0 && orderSummaryPagination.page > maxPage) {
      orderSummaryPagination.page = maxPage;
      await loadOrderSummaries();
    }
  } catch (error) {
    orderSummaries.value = [];
    orderSummaryPagination.totalCount = 0;
    resetProductionOrderSummaryCounts();
    selectedProductionOrderNo.value = '';
    selectedTaskRows.value = [];
    expandedMobileProductionOrderIds.value = [];
    ElMessage.error(error instanceof Error ? error.message : '生产订单汇总加载失败，请确认后端服务和筛选条件');
  }
}

async function loadProductionNotices() {
  noticeLoading.value = true;
  try {
    const status = productionNoticeStatusFilter.value === 'ALL' ? undefined : productionNoticeStatusFilter.value;
    const offset = (productionNoticePagination.page - 1) * productionNoticePagination.limit;
    const baseFilters = productionNoticeBaseFilters();
    const [result, allCount, pendingCount, acknowledgedCount] = await Promise.all([
      erpApi.productionNoticesPage(status, 'PRODUCTION', {
        ...baseFilters,
        limit: productionNoticePagination.limit,
        offset
      }),
      erpApi.productionNoticesPage(undefined, 'PRODUCTION', { ...baseFilters, limit: Number(1), offset: Number(0) }),
      erpApi.productionNoticesPage('PENDING', 'PRODUCTION', { ...baseFilters, limit: Number(1), offset: Number(0) }),
      erpApi.productionNoticesPage('ACKNOWLEDGED', 'PRODUCTION', { ...baseFilters, limit: Number(1), offset: Number(0) })
    ]);
    productionNotices.value = result.items;
    productionNoticePagination.totalCount = result.totalCount;
    productionNoticePagination.limit = result.limit;
    productionNoticePagination.page = Math.floor(result.offset / result.limit) + 1;
    productionNoticeServerCounts.ALL = allCount.totalCount;
    productionNoticeServerCounts.PENDING = pendingCount.totalCount;
    productionNoticeServerCounts.ACKNOWLEDGED = acknowledgedCount.totalCount;
    const maxPage = Math.max(Math.ceil(result.totalCount / result.limit), 1);
    if (result.items.length === 0 && result.totalCount > 0 && productionNoticePagination.page > maxPage) {
      productionNoticePagination.page = maxPage;
      await loadProductionNotices();
    }
  } catch (error) {
    productionNotices.value = [];
    productionNoticePagination.totalCount = 0;
    ElMessage.error(error instanceof Error ? error.message : '生产通知加载失败，请确认后端服务');
  } finally {
    noticeLoading.value = false;
  }
}

function productionNoticeBaseFilters() {
  return {
    target: 'PRODUCTION' as const,
    customerId: productionNoticeFilters.customerId,
    orderNo: productionNoticeFilters.orderNo,
    partCode: productionNoticeFilters.partCode,
    keyword: productionNoticeFilters.keyword,
    noticeType: productionNoticeFilters.noticeType === 'ALL' ? undefined : productionNoticeFilters.noticeType,
    dateFrom: productionNoticeDateRange.value[0],
    dateTo: productionNoticeDateRange.value[1]
  };
}

function productionNoticeExportFilters() {
  return {
    target: 'PRODUCTION' as const,
    status: productionNoticeStatusFilter.value === 'ALL' ? undefined : productionNoticeStatusFilter.value,
    customerId: productionNoticeFilters.customerId,
    orderNo: productionNoticeFilters.orderNo,
    partCode: productionNoticeFilters.partCode,
    keyword: productionNoticeFilters.keyword,
    noticeType: productionNoticeFilters.noticeType === 'ALL' ? undefined : productionNoticeFilters.noticeType,
    dateFrom: productionNoticeDateRange.value[0],
    dateTo: productionNoticeDateRange.value[1]
  };
}

async function exportProductionNoticesExcel() {
  if (productionNoticeExporting.value) {
    return;
  }
  productionNoticeExporting.value = true;
  try {
    // 生产通知导出只复用当前筛选条件，不确认通知、不改变生产状态。
    await erpApi.downloadProductionNoticesExport(productionNoticeExportFilters(), `生产通知_${formatFileDateTime()}.xlsx`);
    ElMessage.success('生产通知 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '生产通知 Excel 导出失败，请确认后端服务和筛选条件');
  } finally {
    productionNoticeExporting.value = false;
  }
}

async function openNotices() {
  productionNoticeFilters.customerId = filters.customerId;
  productionNoticeFilters.orderNo = filters.orderNo || '';
  productionNoticeDateRange.value = [...dateRange.value];
  productionNoticeStatusFilter.value = pendingNoticeCount.value > 0 ? 'PENDING' : 'ALL';
  productionNoticePagination.page = 1;
  noticeVisible.value = true;
  await loadProductionNotices();
}

async function reloadProductionNoticesFromFirstPage() {
  productionNoticePagination.page = 1;
  await loadProductionNotices();
}

async function handleProductionNoticePageChange(page: number) {
  productionNoticePagination.page = page;
  await loadProductionNotices();
}

async function resetProductionNoticeFilters() {
  productionNoticeFilters.customerId = undefined;
  productionNoticeFilters.orderNo = '';
  productionNoticeFilters.partCode = '';
  productionNoticeFilters.keyword = '';
  productionNoticeFilters.noticeType = 'ALL';
  productionNoticeDateRange.value = [];
  productionNoticePagination.page = 1;
  productionNoticeStatusFilter.value = pendingNoticeCount.value > 0 ? 'PENDING' : 'ALL';
  await loadProductionNotices();
}

async function loadProductionReplenishmentRequests(showLoading = false, useServerKeyword = false) {
  if (showLoading) {
    replenishmentRequestLoading.value = true;
  }
  try {
    const status = replenishmentRequestStatusFilter.value === 'ALL' ? undefined : replenishmentRequestStatusFilter.value;
    const offset = (replenishmentRequestPagination.page - 1) * replenishmentRequestPagination.limit;
    const baseFilters = replenishmentRequestBaseFilters(useServerKeyword);
    const [result, allCount, pendingCount, approvedCount, rejectedCount] = await Promise.all([
      erpApi.productionReplenishmentRequestsPage({
        ...baseFilters,
        status,
        limit: replenishmentRequestPagination.limit,
        offset
      }),
      erpApi.productionReplenishmentRequestsPage({ ...baseFilters, limit: Number(1), offset: Number(0) }),
      erpApi.productionReplenishmentRequestsPage({ ...baseFilters, status: 'PENDING', limit: Number(1), offset: Number(0) }),
      erpApi.productionReplenishmentRequestsPage({ ...baseFilters, status: 'APPROVED', limit: Number(1), offset: Number(0) }),
      erpApi.productionReplenishmentRequestsPage({ ...baseFilters, status: 'REJECTED', limit: Number(1), offset: Number(0) })
    ]);
    productionReplenishmentRequests.value = result.items;
    replenishmentRequestPagination.totalCount = result.totalCount;
    replenishmentRequestPagination.limit = result.limit;
    replenishmentRequestPagination.page = Math.floor(result.offset / result.limit) + 1;
    replenishmentRequestServerCounts.ALL = allCount.totalCount;
    replenishmentRequestServerCounts.PENDING = pendingCount.totalCount;
    replenishmentRequestServerCounts.APPROVED = approvedCount.totalCount;
    replenishmentRequestServerCounts.REJECTED = rejectedCount.totalCount;
    const maxPage = Math.max(Math.ceil(result.totalCount / result.limit), 1);
    if (result.items.length === 0 && result.totalCount > 0 && replenishmentRequestPagination.page > maxPage) {
      replenishmentRequestPagination.page = maxPage;
      await loadProductionReplenishmentRequests(showLoading, useServerKeyword);
    }
  } catch (error) {
    productionReplenishmentRequests.value = [];
    replenishmentRequestPagination.totalCount = 0;
    ElMessage.error(error instanceof Error ? error.message : '生产报废补单申请加载失败，请确认后端服务和筛选条件');
  } finally {
    if (showLoading) {
      replenishmentRequestLoading.value = false;
    }
  }
}

function replenishmentRequestBaseFilters(useServerKeyword = false) {
  return {
    keyword: useServerKeyword ? replenishmentRequestKeyword.value : undefined
  };
}

function replenishmentRequestExportFilters() {
  return {
    status: replenishmentRequestStatusFilter.value === 'ALL' ? undefined : replenishmentRequestStatusFilter.value,
    keyword: replenishmentRequestKeyword.value
  };
}

async function exportReplenishmentRequestsExcel() {
  if (replenishmentRequestExporting.value) {
    return;
  }
  replenishmentRequestExporting.value = true;
  try {
    // 生产报废补单申请导出只复用当前筛选条件，不确认补单、不驳回补单、不生成补单任务。
    await erpApi.downloadProductionReplenishmentRequestsExport(
      replenishmentRequestExportFilters(),
      `生产报废补单申请_${formatFileDateTime()}.xlsx`
    );
    ElMessage.success('生产报废补单申请 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '生产报废补单申请 Excel 导出失败，请确认后端服务和筛选条件');
  } finally {
    replenishmentRequestExporting.value = false;
  }
}

async function openReplenishmentRequests() {
  replenishmentRequestStatusFilter.value = pendingReplenishmentRequestCount.value > 0 ? 'PENDING' : 'ALL';
  replenishmentRequestKeyword.value = '';
  replenishmentRequestPagination.page = 1;
  replenishmentRequestVisible.value = true;
  await loadProductionReplenishmentRequests(true);
}

async function queryReplenishmentRequests() {
  replenishmentRequestPagination.page = 1;
  await loadProductionReplenishmentRequests(true, true);
}

async function reloadReplenishmentRequestsFromFirstPage() {
  replenishmentRequestPagination.page = 1;
  await loadProductionReplenishmentRequests(true, true);
}

async function handleReplenishmentRequestPageChange(page: number) {
  replenishmentRequestPagination.page = page;
  await loadProductionReplenishmentRequests(true, true);
}

async function resetReplenishmentRequestFilters() {
  replenishmentRequestStatusFilter.value = pendingReplenishmentRequestCount.value > 0 ? 'PENDING' : 'ALL';
  replenishmentRequestKeyword.value = '';
  replenishmentRequestPagination.page = 1;
  await loadProductionReplenishmentRequests(true);
}

async function loadScrapRecords() {
  scrapLoading.value = true;
  try {
    const offset = (scrapRecordPagination.page - 1) * scrapRecordPagination.limit;
    const result = await erpApi.productionScrapRecordsPage({
      ...scrapRecordFilters(),
      limit: scrapRecordPagination.limit,
      offset
    });
    scrapRecords.value = result.items;
    scrapRecordPagination.totalCount = result.totalCount;
    scrapRecordPagination.limit = result.limit;
    scrapRecordPagination.page = Math.floor(result.offset / result.limit) + 1;
    const maxPage = Math.max(Math.ceil(result.totalCount / result.limit), 1);
    if (result.items.length === 0 && result.totalCount > 0 && scrapRecordPagination.page > maxPage) {
      scrapRecordPagination.page = maxPage;
      await loadScrapRecords();
    }
  } catch (error) {
    scrapRecords.value = [];
    scrapRecordPagination.totalCount = 0;
    ElMessage.error(error instanceof Error ? error.message : '报废统计加载失败，请确认后端服务和筛选条件');
  } finally {
    scrapLoading.value = false;
  }
}

function scrapRecordFilters() {
  return {
    customerId: scrapFilters.customerId,
    orderNo: scrapFilters.orderNo?.trim() || undefined,
    dateFrom: scrapDateRange.value[0],
    dateTo: scrapDateRange.value[1]
  };
}

async function exportScrapRecordsExcel() {
  if (scrapExporting.value) {
    return;
  }
  scrapExporting.value = true;
  try {
    // 生产报废统计导出只读取当前筛选结果，不修改报废记录、不触发补单。
    await erpApi.downloadProductionScrapRecordsExport(scrapRecordFilters(), `生产报废统计_${formatFileDateTime()}.xlsx`);
    ElMessage.success('生产报废统计 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '生产报废统计 Excel 导出失败，请确认后端服务和筛选条件');
  } finally {
    scrapExporting.value = false;
  }
}

async function loadScrapOrderOptions() {
  try {
    const [records, orders] = await Promise.all([
      erpApi.productionScrapRecordsAllPages({
        customerId: scrapFilters.customerId,
        dateFrom: scrapDateRange.value[0],
        dateTo: scrapDateRange.value[1]
      }),
      erpApi.orders({
        customerId: scrapFilters.customerId
      })
    ]);
    const scrapOrderNos = new Set(records.map((record) => record.orderNo).filter(Boolean));
    // 报废统计的日期是报废日期，不是订单日期；订单下拉按当前报废日期/客户范围内实际有报废记录的订单缩小。
    scrapOrderOptions.value = orders.filter((order) => scrapOrderNos.has(order.orderNo));
    if (scrapFilters.orderNo && !scrapOrderOptions.value.some((item) => item.orderNo === scrapFilters.orderNo)) {
      scrapFilters.orderNo = undefined;
    }
  } catch (error) {
    scrapOrderOptions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '报废统计订单选项加载失败，请确认后端服务和筛选条件');
  }
}

async function openScrapRecords() {
  scrapVisible.value = true;
  scrapRecordPagination.page = 1;
  await loadScrapOrderOptions();
  await loadScrapRecords();
}

async function resetScrapFilters() {
  scrapFilters.customerId = undefined;
  scrapFilters.orderNo = undefined;
  scrapDateRange.value = [];
  scrapRecordPagination.page = 1;
  await loadScrapOrderOptions();
  await loadScrapRecords();
}

async function handleScrapScopeChange() {
  scrapFilters.orderNo = undefined;
  scrapRecordPagination.page = 1;
  await loadScrapOrderOptions();
  await loadScrapRecords();
}

async function reloadScrapRecordsFromFirstPage() {
  scrapRecordPagination.page = 1;
  await loadScrapRecords();
}

async function handleScrapRecordPageChange(page: number) {
  scrapRecordPagination.page = page;
  await loadScrapRecords();
}

function queryStringValue(value: unknown) {
  return String(Array.isArray(value) ? value[0] || '' : value || '').trim();
}

function productionRouteOrderNo() {
  return queryStringValue(route.query.orderNo);
}

function productionRouteView() {
  return queryStringValue(route.query.view);
}

function productionBaseQuery() {
  const returnTo = queryStringValue(route.query.returnTo);
  return returnTo ? { returnTo } : {};
}

function applyProductionRouteScope() {
  const orderNo = productionRouteOrderNo();
  if (orderNo) {
    filters.orderNo = orderNo;
    selectedProductionOrderNo.value = orderNo;
    selectedTaskRows.value = [];
    activeStatus.value = 'ALL';
    resetProductionMainPagination();
    viewMode.value = 'TASK_DETAIL';
    return;
  }

  selectedProductionOrderNo.value = '';
  selectedTaskRows.value = [];
  resetProductionMainPagination();
  viewMode.value = productionRouteView() === 'tasks' ? 'TASK_DETAIL' : 'ORDER_SUMMARY';
}

function pushProductionRouteForOrder(orderNo: string) {
  void router.push({
    path: '/production',
    query: {
      ...productionBaseQuery(),
      orderNo
    }
  });
}

function pushProductionRouteForSummary() {
  void router.push({
    path: '/production',
    query: productionBaseQuery()
  });
}

function pushProductionRouteForTaskList() {
  void router.push({
    path: '/production',
    query: {
      ...productionBaseQuery(),
      view: 'tasks'
    }
  });
}

async function queryTasks() {
  loading.value = true;
  try {
    await loadOrderOptions();
    await Promise.all([loadTasks(), loadOrderSummaries()]);
    normalizeOrderSummaryStatusFilter();
    if (
      selectedProductionOrderNo.value &&
      !tasks.value.some((task) => task.orderNo === selectedProductionOrderNo.value) &&
      !selectedProductionOrderOption.value
    ) {
      selectedProductionOrderNo.value = '';
      selectedTaskRows.value = [];
      viewMode.value = 'ORDER_SUMMARY';
      if (productionRouteOrderNo()) {
        pushProductionRouteForSummary();
      }
    }
    await Promise.all([loadProductionNotices(), loadProductionReplenishmentRequests()]);
  } finally {
    loading.value = false;
  }
}

async function refreshProductionPage() {
  if (productionPageRefreshing.value || loading.value) {
    return;
  }
  productionPageRefreshing.value = true;
  try {
    // 生产页整页刷新必须同步当前客户名、操作员缓存、任务、订单汇总、通知和补单申请。
    await loadSelectedCustomerName();
    await loadOperators();
    await queryTasks();
  } finally {
    productionPageRefreshing.value = false;
  }
}

function normalizeOrderSummaryStatusFilter() {
  // 指定订单时必须默认展示该订单全量生产状态，避免已完成 / 已入库订单被“待处理”标签隐藏。
  if (filters.orderNo && viewMode.value === 'ORDER_SUMMARY') {
    activeOrderStatus.value = 'ALL';
  }
}

async function handleOrderFilterChange() {
  selectedProductionOrderNo.value = '';
  selectedTaskRows.value = [];
  viewMode.value = 'ORDER_SUMMARY';
  resetProductionMainPagination();
  normalizeOrderSummaryStatusFilter();
  if (productionRouteOrderNo() || productionRouteView()) {
    pushProductionRouteForSummary();
  }
  await queryTasks();
}

async function handleScopeChange() {
  filters.orderNo = undefined;
  selectedProductionOrderNo.value = '';
  selectedTaskRows.value = [];
  viewMode.value = 'ORDER_SUMMARY';
  resetProductionMainPagination();
  await loadSelectedCustomerName();
  if (productionRouteOrderNo() || productionRouteView()) {
    pushProductionRouteForSummary();
  }
  await queryTasks();
}

async function resetFilters() {
  filters.customerId = undefined;
  selectedCustomerName.value = '';
  filters.orderNo = undefined;
  dateRange.value = [];
  activeStatus.value = 'ALL';
  activeOrderStatus.value = 'ALL';
  selectedProductionOrderNo.value = '';
  selectedTaskRows.value = [];
  resetProductionMainPagination();
  viewMode.value = 'ORDER_SUMMARY';
  if (productionRouteOrderNo() || productionRouteView()) {
    pushProductionRouteForSummary();
  }
  await queryTasks();
}

function guardDesktopProductionMutation(actionLabel: string) {
  void actionLabel;
  // 生产页属于现场执行端：手机端允许开始生产、工序确认、完成确认、生产通知和补单审核。
  // 订单提交生产仍由订单页控制，手机端不开放下单、导入或提交生产。
  return false;
}

function showMobileScanReserved() {
  ElMessage.info('扫码入口已预留，第一阶段暂不启用');
}

function productionNoticeTitle(notice: ProductionNotice) {
  const quantityText =
    notice.deltaQuantity && notice.unit ? `，变化 ${formatQuantity(Math.abs(notice.deltaQuantity), notice.unit)}` : '';
  const partText = [notice.customerName, notice.orderNo, notice.partCode, notice.partName].filter(Boolean).join(' / ');
  const typeMap: Record<string, string> = {
    QUANTITY_INCREASE: '客户数量增加',
    QUANTITY_DECREASE: '客户数量减少',
    ORDER_CANCELLED: '客户取消零件',
    MATERIAL_ADDED: '客户新增零件',
    TASK_WITHDRAWN: '管理撤回'
  };
  return `${typeMap[notice.noticeType] || notice.noticeType}：${partText}${quantityText}`;
}

function acknowledgeNotice(notice: ProductionNotice) {
  if (guardDesktopProductionMutation('确认生产通知')) {
    return;
  }
  activeProductionNotice.value = notice;
  acknowledgeVisible.value = true;
}

async function saveNoticeAcknowledge(acknowledgedBy: string) {
  if (guardDesktopProductionMutation('确认生产通知')) {
    return;
  }
  const notice = activeProductionNotice.value;
  if (!notice) {
    return;
  }
  acknowledgeSaving.value = true;
  try {
    await erpApi.acknowledgeProductionNotice(notice.id, acknowledgedBy);
    ElMessage.success('通知已确认');
    acknowledgeVisible.value = false;
    await loadProductionNotices();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '确认通知失败');
  } finally {
    acknowledgeSaving.value = false;
  }
}

function openStartDialog(row: ProductionTask) {
  if (guardDesktopProductionMutation('开始生产')) {
    return;
  }
  activeStartTask.value = row;
  startSupervisorCode.value = '';
  startConfirmVisible.value = true;
  void searchStartSupervisors('');
}

function closeStartDialog() {
  if (startSaving.value) {
    warnProductionSavingClose('开始生产正在保存，请等待保存完成');
    return;
  }
  startConfirmVisible.value = false;
}

function handleStartDialogClose(done: () => void) {
  if (startSaving.value) {
    warnProductionSavingClose('开始生产正在保存，请等待保存完成');
    return;
  }
  done();
}

function resetStartDialog() {
  activeStartTask.value = undefined;
  startSupervisorCode.value = '';
}

async function confirmStartProduction() {
  if (startSaving.value) {
    return;
  }
  if (guardDesktopProductionMutation('开始生产')) {
    return;
  }
  if (!activeStartTask.value) {
    return;
  }
  if (!startSupervisorCode.value) {
    ElMessage.warning('请选择车间主任');
    return;
  }
  // 开始生产会改变任务状态，先由前端确认，再交给后端校验订单和任务当前状态。
  startSaving.value = true;
  try {
    await erpApi.startProduction(activeStartTask.value.id, {
      supervisorCode: startSupervisorCode.value
    });
    ElMessage.success('已开始生产');
    startConfirmVisible.value = false;
    await Promise.all([loadTasks(), loadOrderSummaries()]);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '开始生产失败');
  } finally {
    startSaving.value = false;
  }
}

function handleViewModeChange() {
  if (viewMode.value === 'ORDER_SUMMARY') {
    selectedProductionOrderNo.value = '';
    selectedTaskRows.value = [];
    activeStatus.value = 'ALL';
    pushProductionRouteForSummary();
    return;
  }

  if (!selectedProductionOrderNo.value) {
    pushProductionRouteForTaskList();
  }
}

function openOrderProductionDetail(row: ProductionOrderSummary) {
  selectedProductionOrderNo.value = row.orderNo;
  selectedTaskRows.value = [];
  activeStatus.value = 'ALL';
  viewMode.value = 'TASK_DETAIL';
  pushProductionRouteForOrder(row.orderNo);
}

function goOrderShortageDetail(row: ProductionOrderSummary) {
  void router.push({
    path: `/orders/${encodeURIComponent(row.orderNo)}`,
    query: {
      returnTo: route.fullPath,
      shortage: '1'
    }
  });
}

function goSelectedOrderDetail() {
  if (!selectedProductionOrderNo.value) {
    return;
  }
  void router.push({
    path: `/orders/${encodeURIComponent(selectedProductionOrderNo.value)}`,
    query: {
      returnTo: route.fullPath
    }
  });
}

function goSelectedOrderWarehouse() {
  if (!selectedProductionOrderNo.value) {
    return;
  }
  void router.push({
    path: '/warehouses',
    query: {
      orderNo: selectedProductionOrderNo.value,
      returnTo: route.fullPath
    }
  });
}

function backToOrderSummary() {
  selectedProductionOrderNo.value = '';
  selectedTaskRows.value = [];
  activeStatus.value = 'ALL';
  viewMode.value = 'ORDER_SUMMARY';
  normalizeOrderSummaryStatusFilter();
  pushProductionRouteForSummary();
}

function canBatchSelectTask(row: ProductionTask) {
  return shouldShowStartAction(row);
}

function handleTaskSelectionChange(rows: ProductionTask[]) {
  selectedTaskRows.value = rows;
}

function toggleMobileStartSelection(task: ProductionTask, checked: boolean) {
  if (guardDesktopProductionMutation('勾选生产任务')) {
    return;
  }
  if (!shouldShowStartAction(task)) {
    return;
  }
  const currentIds = new Set(selectedStartableTaskIds.value);
  if (checked) {
    currentIds.add(task.id);
  } else {
    currentIds.delete(task.id);
  }
  selectedStartableTaskIds.value = Array.from(currentIds);
}

function pendingTasksForOrder(orderNo: string) {
  return tasks.value.filter((task) => task.orderNo === orderNo && shouldShowStartAction(task));
}

function isBatchStartCandidate(row: BatchStartTask) {
  return row.status ? shouldShowStartAction(row as ProductionTask) : true;
}

function pendingSummaryTasksForBatch(row: ProductionOrderSummary): BatchStartTask[] {
  return row.pendingTasks?.map((task) => ({ ...task, orderNo: task.orderNo || row.orderNo })) || [];
}

function openBatchStartDialog(_orderNo: string, rows: BatchStartTask[]) {
  if (guardDesktopProductionMutation('批量开始生产')) {
    return;
  }
  const startableRows = rows.filter((task) => isBatchStartCandidate(task));
  if (startableRows.length === 0) {
    ElMessage.warning('当前订单没有待确认生产的任务');
    return;
  }
  batchStartTasks.value = startableRows;
  batchStartSelectedTaskIds.value = startableRows.map((task) => task.id);
  batchStartSupervisorCode.value = '';
  batchStartVisible.value = true;
  void searchBatchStartSupervisors('');
}

function closeBatchStartDialog() {
  if (batchStartSaving.value) {
    warnProductionSavingClose('批量开始生产正在保存，请等待保存完成');
    return;
  }
  batchStartVisible.value = false;
}

function handleBatchStartDialogClose(done: () => void) {
  if (batchStartSaving.value) {
    warnProductionSavingClose('批量开始生产正在保存，请等待保存完成');
    return;
  }
  done();
}

function resetBatchStartDialog() {
  batchStartTasks.value = [];
  batchStartSelectedTaskIds.value = [];
  batchStartSupervisorCode.value = '';
}

function selectAllBatchStartTasks() {
  batchStartSelectedTaskIds.value = batchStartTasks.value.map((task) => task.id);
}

function clearBatchStartTasks() {
  batchStartSelectedTaskIds.value = [];
}

function openBatchStartForOrder(row: ProductionOrderSummary) {
  const summaryPendingTasks = pendingSummaryTasksForBatch(row);
  openBatchStartDialog(row.orderNo, summaryPendingTasks.length > 0 ? summaryPendingTasks : pendingTasksForOrder(row.orderNo));
}

function openBatchStartForCurrentOrder() {
  if (!selectedProductionOrderNo.value) {
    return;
  }
  openBatchStartDialog(selectedProductionOrderNo.value, selectedOrderPendingTasks.value);
}

function openBatchStartForSelected() {
  if (selectedStartableTasks.value.length === 0) {
    ElMessage.warning('请先勾选待确认生产任务');
    return;
  }
  openBatchStartDialog(selectedProductionOrderNo.value, selectedStartableTasks.value);
}

async function confirmBatchStartProduction() {
  if (batchStartSaving.value) {
    return;
  }
  if (guardDesktopProductionMutation('批量开始生产')) {
    return;
  }
  if (!batchStartSupervisorCode.value) {
    ElMessage.warning('请选择车间主任');
    return;
  }
  if (batchStartSelectedTaskIds.value.length === 0) {
    ElMessage.warning('请选择需要开始生产的任务');
    return;
  }

  batchStartSaving.value = true;
  try {
    const result = await erpApi.batchStartProduction({
      taskIds: batchStartSelectedTaskIds.value,
      supervisorCode: batchStartSupervisorCode.value
    });
    ElMessage.success(`已开始 ${result.startedCount} 项生产任务`);
    batchStartVisible.value = false;
    selectedTaskRows.value = [];
    await Promise.all([loadTasks(), loadOrderSummaries()]);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '批量开始生产失败');
  } finally {
    batchStartSaving.value = false;
  }
}

function withdrawProduction(row: ProductionTask) {
  if (guardDesktopProductionMutation('管理撤回生产任务')) {
    return;
  }
  if (!canWithdrawProduction(row)) {
    ElMessage.warning('已取消、待生产或已入库任务不能管理撤回');
    return;
  }
  activeWithdrawTask.value = row;
  const defaultQuantity = defaultWithdrawHandlingQuantity(row);
  withdrawForm.managerName = '';
  withdrawForm.reason = '';
  withdrawForm.handledAt = new Date();
  withdrawForm.handlingMode = defaultQuantity > 0 ? 'STOCK' : 'NONE';
  withdrawForm.handlingQuantity = defaultQuantity;
  withdrawForm.remark = '';
  withdrawVisible.value = true;
}

function warnProductionSavingClose(message: string) {
  ElMessage.warning(message);
}

function closeWithdrawDialog() {
  if (withdrawSaving.value) {
    warnProductionSavingClose('生产撤回正在保存，请等待保存完成');
    return;
  }
  withdrawVisible.value = false;
}

function handleWithdrawDialogClose(done: () => void) {
  if (withdrawSaving.value) {
    warnProductionSavingClose('生产撤回正在保存，请等待保存完成');
    return;
  }
  done();
}

async function saveWithdrawProduction() {
  if (withdrawSaving.value) {
    return;
  }
  if (guardDesktopProductionMutation('管理撤回生产任务')) {
    return;
  }
  const task = activeWithdrawTask.value;
  if (!task) {
    return;
  }
  if (!canWithdrawProduction(task)) {
    ElMessage.warning('已取消、待生产或已入库任务不能管理撤回');
    return;
  }
  if (!withdrawForm.managerName.trim()) {
    ElMessage.warning('请输入管理人员姓名');
    return;
  }
  if (!withdrawForm.reason.trim()) {
    ElMessage.warning('请输入撤回订单原因');
    return;
  }
  if (!withdrawForm.handledAt) {
    ElMessage.warning('请选择处理日期');
    return;
  }
  if (withdrawForm.handlingMode === 'NONE') {
    withdrawForm.handlingQuantity = 0;
  } else if (withdrawHandlingQuantityMax.value <= 0) {
    ElMessage.warning('当前生产任务没有已记录产出数量，不能转库存或报废');
    return;
  } else if (!withdrawForm.handlingQuantity || withdrawForm.handlingQuantity <= 0) {
    ElMessage.warning('零件入库存或报废时，处理数量必须大于 0');
    return;
  } else if (withdrawHandlingQuantityMax.value > 0 && withdrawForm.handlingQuantity > withdrawHandlingQuantityMax.value) {
    ElMessage.warning(`撤回处理数量不能超过已记录产出数量 ${formatQuantity(withdrawHandlingQuantityMax.value, task.unit)}`);
    return;
  }

  withdrawSaving.value = true;
  try {
    await erpApi.withdrawProductionTask(task.id, {
      managerName: withdrawForm.managerName.trim(),
      reason: withdrawForm.reason.trim(),
      handledAt: withdrawForm.handledAt,
      handlingMode: withdrawForm.handlingMode,
      handlingQuantity: withdrawForm.handlingQuantity,
      remark: withdrawForm.remark.trim() || undefined
    });
    ElMessage.success('生产任务已撤回');
    withdrawVisible.value = false;
    await queryTasks();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '撤回生产任务失败');
  } finally {
    withdrawSaving.value = false;
  }
}

function getProcessCompletion(row: ProductionTask, processName: string): ProductionProcessCompletion | undefined {
  return row.processCompletions?.find((item) => item.processName === processName);
}

function processStepDisplay(row: { processStepDetails?: ProductionTask['processStepDetails'] }, processName: string) {
  const remark = processStepRemark(row, processName);
  return remark ? `${processName}（${formatLongTextPreview(remark, 12, '')}）` : processName;
}

function processStepTitle(row: { processStepDetails?: ProductionTask['processStepDetails'] }, processName: string) {
  const remark = processStepRemark(row, processName);
  return remark ? `${processName}：${remark}` : processName;
}

function processStepRemark(row: { processStepDetails?: ProductionTask['processStepDetails'] }, processName: string) {
  return row.processStepDetails?.find((item) => item.processName === processName)?.processRemark?.trim() || '';
}

function processProgressText(row: ProductionTask) {
  if (row.processSteps.length === 0) {
    return '未配置生产流程';
  }
  const completedCount = row.processSteps.filter((step) => isProcessCompleted(row, step)).length;
  return `${completedCount} / ${row.processSteps.length} 道`;
}

function currentProcessText(row: ProductionTask) {
  const status = effectiveProductionStatus(row);
  if (status === 'PENDING') {
    return '待确认生产';
  }
  if (status === 'READY_TO_COMPLETE') {
    return '待确认完成';
  }
  if (status === 'COMPLETED' || status === 'RECEIVED' || status === 'CANCELLED') {
    return productionStatusLabel(status);
  }
  const current = nextIncompleteProcess(row);
  return current ? processStepDisplay(row, current) : '待确认完成';
}

function expectedProcessQuantity(row: ProductionTask, processName: string) {
  const activeIndex = row.processSteps.indexOf(processName);
  if (activeIndex <= 0) {
    return Number(row.plannedQuantity ?? 0);
  }
  const previousProcessName = row.processSteps[activeIndex - 1];
  const previousCompletion = getProcessCompletion(row, previousProcessName);
  if (!previousCompletion?.isCompleted) {
    return Number(row.plannedQuantity ?? 0);
  }
  return Number(previousCompletion.completedQuantity ?? 0);
}

function isProcessCompleted(row: ProductionTask, processName: string) {
  return row.status === 'COMPLETED' || row.status === 'STORED' || Boolean(getProcessCompletion(row, processName)?.isCompleted);
}

function isAllProcessConfirmed(row: ProductionTask) {
  if (row.status === 'COMPLETED' || row.status === 'STORED' || row.status === 'WAITING_CONFIRMATION') {
    return true;
  }
  if (row.processSteps.length === 0) {
    // 兼容历史无工序快照任务：开始生产后允许直接进入最终完成确认，并在确认时记录短缺处理。
    return row.status !== 'PENDING';
  }
  return row.processSteps.every((step) => Boolean(getProcessCompletion(row, step)?.isCompleted));
}

function effectiveProductionStatus(row: ProductionTask): ProductionDisplayStatus {
  if (row.inventoryBatchNo || row.status === 'STORED') {
    return 'RECEIVED';
  }
  if (row.status === 'CANCELLED') {
    // 已取消任务只保留历史状态，不能因工序完成或历史无工序快照被重新算成待确认完成。
    return 'CANCELLED';
  }
  if (row.status === 'WAITING_CONFIRMATION') {
    return 'READY_TO_COMPLETE';
  }
  // 工序全部确认只代表流程走完；必须点击“确认完成”后，任务才真正进入待入库的 COMPLETED。
  if (row.status !== 'PENDING' && row.status !== 'COMPLETED' && isAllProcessConfirmed(row)) {
    return 'READY_TO_COMPLETE';
  }
  return row.status;
}

function nextIncompleteProcess(row: ProductionTask) {
  return row.processSteps.find((step) => !isProcessCompleted(row, step));
}

function isCurrentProcess(row: ProductionTask, processName: string) {
  return row.status !== 'COMPLETED' && row.status !== 'STORED' && nextIncompleteProcess(row) === processName;
}

function isFinalProcess(row: ProductionTask, processName: string) {
  return row.processSteps[row.processSteps.length - 1] === processName;
}

function shouldShowConfirmCompletedAction(row: ProductionTask) {
  // 工序走完后必须先进入“待确认完成”，由操作人员再填写最终完成数量。
  return row.orderStatus !== 'CANCELLED' && row.orderStatus !== 'COMPLETED' && effectiveProductionStatus(row) === 'READY_TO_COMPLETE';
}

function shouldShowStartAction(row: ProductionTask) {
  // 操作入口必须按有效状态判断；已入库历史任务即使原始 status 异常，也不能再次开始生产。
  return row.orderStatus !== 'CANCELLED' && row.orderStatus !== 'COMPLETED' && effectiveProductionStatus(row) === 'PENDING';
}

function shouldShowNextProcessAction(row: ProductionTask) {
  return row.orderStatus !== 'CANCELLED' && row.orderStatus !== 'COMPLETED' && effectiveProductionStatus(row) === 'IN_PROGRESS' && Boolean(nextIncompleteProcess(row));
}

function canModifyFinalCompletion(row: ProductionTask) {
  // 已经入库的生产任务不能再改最终完成数量，否则会和库存批次数量不一致。
  return row.orderStatus !== 'CANCELLED' && row.orderStatus !== 'COMPLETED' && row.status === 'COMPLETED' && !row.inventoryBatchNo;
}

function canWithdrawProduction(row: ProductionTask) {
  const status = effectiveProductionStatus(row);
  // 已取消任务只保留历史，不允许从生产端再次管理撤回。
  return (
    row.orderStatus !== 'CANCELLED' &&
    row.orderStatus !== 'COMPLETED' &&
    !row.inventoryBatchNo &&
    status !== 'PENDING' &&
    status !== 'CANCELLED' &&
    status !== 'RECEIVED'
  );
}

function defaultWithdrawHandlingQuantity(row: ProductionTask) {
  const processQuantity = Math.max(0, ...(row.processCompletions || []).map((item) => Number(item.completedQuantity ?? 0)));
  return row.completedQuantity > 0 ? row.completedQuantity : processQuantity;
}

function handleWithdrawModeChange() {
  if (withdrawForm.handlingMode === 'NONE') {
    withdrawForm.handlingQuantity = 0;
  } else if (withdrawForm.handlingQuantity <= 0 && activeWithdrawTask.value) {
    withdrawForm.handlingQuantity = withdrawHandlingQuantityMax.value;
  } else if (withdrawHandlingQuantityMax.value > 0 && withdrawForm.handlingQuantity > withdrawHandlingQuantityMax.value) {
    withdrawForm.handlingQuantity = withdrawHandlingQuantityMax.value;
  }
}

function canOpenProcess(row: ProductionTask, processName: string) {
  const status = effectiveProductionStatus(row);
  if (row.orderStatus === 'CANCELLED') {
    return false;
  }
  if (row.orderStatus === 'COMPLETED') {
    return isProcessCompleted(row, processName);
  }
  if (row.inventoryBatchNo) {
    return isProcessCompleted(row, processName);
  }
  if (status === 'RECEIVED') {
    return isProcessCompleted(row, processName);
  }
  if (status === 'PENDING' || status === 'CANCELLED') {
    return false;
  }
  return row.status === 'COMPLETED' || isProcessCompleted(row, processName) || isCurrentProcess(row, processName);
}

function processButtonTitle(row: ProductionTask, processName: string) {
  const stepTitle = processStepTitle(row, processName);
  const status = effectiveProductionStatus(row);
  if (row.orderStatus === 'CANCELLED') {
    return `${stepTitle}；订单已取消，只能做管理撤回或查看通知`;
  }
  if (status === 'CANCELLED') {
    return `${stepTitle}；生产任务已取消，只能查看历史记录`;
  }
  if (row.orderStatus === 'COMPLETED') {
    return isProcessCompleted(row, processName) ? `${stepTitle}；订单已完成发货，只能查看工序记录` : `${stepTitle}；订单已完成发货，不能新增工序记录`;
  }
  if (row.inventoryBatchNo) {
    return isProcessCompleted(row, processName) ? `${stepTitle}；已入库，只能查看工序记录` : `${stepTitle}；已入库，不能新增工序记录`;
  }
  if (status === 'RECEIVED') {
    return isProcessCompleted(row, processName) ? `${stepTitle}；已入库，只能查看工序记录` : `${stepTitle}；已入库，不能新增工序记录`;
  }
  if (status === 'PENDING') {
    return `${stepTitle}；请先开始生产`;
  }
  if (!canOpenProcess(row, processName)) {
    return `${stepTitle}；请先完成上一道工序`;
  }
  return isProcessCompleted(row, processName) ? `${stepTitle}；查看或修改工序完成记录` : `${stepTitle}；填写当前工序完成表`;
}

function openNextProcess(row: ProductionTask) {
  if (guardDesktopProductionMutation('确认下一道工序')) {
    return;
  }
  const processName = nextIncompleteProcess(row);
  if (!processName) {
    ElMessage.info('所有工序已确认完成');
    return;
  }
  openProcessCompletion(row, processName);
}

function openProcessCompletion(row: ProductionTask, processName: string) {
  if (guardDesktopProductionMutation('填写工序完成表')) {
    return;
  }
  if (!canOpenProcess(row, processName)) {
    ElMessage.warning(processButtonTitle(row, processName));
    return;
  }
  const completion = getProcessCompletion(row, processName);
  activeTask.value = row;
  activeProcessName.value = processName;
  // 打开当前未完成工序时默认选择“已完成”，避免操作人员点击“确认完成”却再次保存成未完成。
  processForm.isCompleted = true;
  processForm.completedQuantity = completion?.isCompleted ? completion.completedQuantity : expectedProcessQuantity(row, processName);
  processForm.scrapQuantity = completion?.scrapQuantity ?? 0;
  processForm.shortageMode = completion?.shortageMode || 'REPLENISHMENT_REQUEST';
  processForm.managerName = completion?.managerName || '';
  processForm.shortageReason = completion?.shortageReason || '';
  processForm.quantityOverrideReason = completion?.quantityOverrideReason || '';
  processForm.remark = completion?.remark || '';
  batchProcessNames.value = [processName];
  resetProcessOperatorCodes();
  syncProcessOperatorRows();
  processVisible.value = true;
}

function closeProcessDialog() {
  if (processSaving.value) {
    warnProductionSavingClose('工序完成表正在保存，请等待保存完成');
    return;
  }
  processVisible.value = false;
}

function handleProcessDialogClose(done: () => void) {
  if (processSaving.value) {
    warnProductionSavingClose('工序完成表正在保存，请等待保存完成');
    return;
  }
  done();
}

function normalizeBatchProcessNames() {
  if (!activeTask.value || !activeProcessName.value) {
    return;
  }

  const activeIndex = activeTask.value.processSteps.indexOf(activeProcessName.value);
  if (activeIndex < 0) {
    batchProcessNames.value = [activeProcessName.value];
    return;
  }

  const selectedIndexes = batchProcessNames.value
    .map((processName) => activeTask.value?.processSteps.indexOf(processName) ?? -1)
    .filter((index) => index >= activeIndex);
  const maxIndex = Math.max(activeIndex, ...selectedIndexes);

  // 批量确认必须连续；勾选后道工序时，自动补齐中间工序，避免保存时跳工序。
  batchProcessNames.value = activeTask.value.processSteps.slice(activeIndex, maxIndex + 1);
}

function handleBatchProcessChange() {
  normalizeBatchProcessNames();
  syncProcessOperatorRows();
}

function selectedProcessNamesForSave() {
  if (!activeProcessName.value || !processForm.isCompleted) {
    return activeProcessName.value ? [activeProcessName.value] : [];
  }
  normalizeBatchProcessNames();
  syncProcessOperatorRows();
  return batchProcessNames.value.length > 0 ? batchProcessNames.value : [activeProcessName.value];
}

function formatProductionListPreview(values: Array<string | null | undefined>, unitLabel: string, emptyText = '-', delimiter = '、') {
  const filtered = values.map((value) => String(value || '').trim()).filter(Boolean);
  if (filtered.length === 0) {
    return emptyText;
  }
  const preview = filtered.filter((_, index) => index < 3).join(delimiter);
  return filtered.length > 3 ? `${preview} 等 ${filtered.length} 个${unitLabel}` : preview;
}

function formatLongTextPreview(value?: string | null, maxLength = 32, emptyText = '-') {
  const text = String(value || '').trim();
  if (!text) {
    return emptyText;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function productionNoticeReasonPreview(notice: ProductionNotice) {
  return formatLongTextPreview(notice.reason, 42, '-');
}

function productionNoticeReasonTitle(notice: ProductionNotice) {
  return String(notice.reason || '').trim() || '-';
}

function scrapRecordReasonPreview(record: ProductionScrapRecord) {
  return formatLongTextPreview(record.reason, 42, '-');
}

function scrapRecordReasonTitle(record: ProductionScrapRecord) {
  return String(record.reason || '').trim() || '-';
}

function replenishmentRequestReasonPreview(request: ProductionReplenishmentRequest) {
  return formatLongTextPreview(request.reason, 42, '-');
}

function replenishmentRequestReasonTitle(request: ProductionReplenishmentRequest) {
  return String(request.reason || '').trim() || '-';
}

function replenishmentSupervisorRemarkPreview(request: ProductionReplenishmentRequest) {
  return formatLongTextPreview(request.supervisorRemark, 28, '-');
}

function replenishmentSupervisorRemarkTitle(request: ProductionReplenishmentRequest) {
  return String(request.supervisorRemark || '').trim() || '-';
}

function resetProcessOperatorCodes() {
  for (const key of Object.keys(processOperatorCodes)) {
    delete processOperatorCodes[key];
  }
}

function operatorCodesFromCompletion(completion?: ProductionProcessCompletion) {
  if (!completion?.operatorCode) {
    return [];
  }
  return completion.operatorCode
    .split(',')
    .map((code) => code.trim())
    .filter((code) => Boolean(operatorCache[code] || operatorOptions.value.some((operator) => operator.code === code)));
}

function syncProcessOperatorRows() {
  if (!activeTask.value) {
    return;
  }
  const selectedNames = selectedProcessNamesForOperatorForm.value;
  for (const processName of selectedNames) {
    if (!Array.isArray(processOperatorCodes[processName])) {
      processOperatorCodes[processName] = operatorCodesFromCompletion(getProcessCompletion(activeTask.value, processName));
    }
  }
  for (const processName of Object.keys(processOperatorCodes)) {
    if (!selectedNames.includes(processName)) {
      delete processOperatorCodes[processName];
    }
  }
}

function cleanOperatorCodes(codes?: string[]) {
  return Array.from(
    new Set(
      (codes || [])
        .map((code) => code.trim())
        .filter(Boolean)
    )
  );
}

function operatorCodesForProcess(processName: string) {
  return cleanOperatorCodes(Array.isArray(processOperatorCodes[processName]) ? processOperatorCodes[processName] : []);
}

function cacheOperators(operators: ProductionOperator[]) {
  operators.forEach((operator) => {
    operatorCache[operator.code] = operator;
  });
}

function setOperatorOptions(operators: ProductionOperator[]) {
  cacheOperators(operators);
  operatorOptions.value = operators;
}

function clearOperatorOptions() {
  operatorOptions.value = [];
  Object.keys(operatorCache).forEach((code) => delete operatorCache[code]);
  Object.keys(operatorOptionsByScope).forEach((scope) => delete operatorOptionsByScope[scope]);
  Object.keys(operatorKeywordByScope).forEach((scope) => delete operatorKeywordByScope[scope]);
  Object.keys(operatorLoadingByScope).forEach((scope) => delete operatorLoadingByScope[scope]);
}

function setOperatorOptionsForScope(scope: string, operators: ProductionOperator[]) {
  cacheOperators(operators);
  operatorOptionsByScope[scope] = operators;
}

function normalizeOperatorKeyword(value: string) {
  return value.trim().toLowerCase().replace(/[\s\-_./\\]+/g, '');
}

function operatorMatchesLocalKeyword(operator: ProductionOperator, keyword: string) {
  const normalizedKeyword = normalizeOperatorKeyword(keyword);
  if (!normalizedKeyword) {
    return true;
  }
  const tokens = [
    operator.code,
    operator.accountId,
    operator.name,
    operator.role,
    operator.pinyin,
    operator.pinyinInitials,
    ...(operator.keywords || [])
  ]
    .filter(Boolean)
    .map((value) => normalizeOperatorKeyword(String(value)))
    .filter(Boolean);
  // 本地候选也按字段逐项匹配，避免远程返回前短暂展示不相关操作人员。
  return tokens.some((token) => token.includes(normalizedKeyword));
}

function operatorScopeForProcess(processName: string) {
  return `process:${processName}`;
}

function operatorOptionsForScope(scope: string) {
  return operatorOptionsByScope[scope] || operatorOptions.value;
}

function isOperatorLoading(scope: string) {
  return Boolean(operatorLoadingByScope[scope]);
}

function operatorOptionRowsWithSelectedCodes(selectedCodes: string[], scope: string) {
  const keyword = operatorKeywordByScope[scope] || '';
  const normalizedKeyword = normalizeOperatorKeyword(keyword);
  const merged = new Map<string, ProductionOperator>();
  operatorOptionsForScope(scope)
    .filter((operator) => operatorMatchesLocalKeyword(operator, keyword))
    .forEach((operator) => merged.set(operator.code, operator));
  if (normalizedKeyword) {
    return Array.from(merged.values());
  }
  selectedCodes.forEach((code) => {
    const cached = operatorCache[code];
    // 未输入关键字时补齐已选人员，确保下拉重新打开仍能显示已选账号的完整名称和角色。
    if (cached) {
      merged.set(code, cached);
    }
  });
  return Array.from(merged.values());
}

function isWorkshopSupervisor(operator: ProductionOperator) {
  const role = operator.role || '';
  return !role.includes('计划') && (role.includes('车间主任') || role.includes('车间主管') || role.includes('主任'));
}

function supervisorOptionRowsWithSelectedCode(selectedCode: string, scope: string) {
  return operatorOptionRowsWithSelectedCodes(selectedCode ? [selectedCode] : [], scope).filter(isWorkshopSupervisor);
}

function operatorOptionRowsForProcess(processName: string) {
  return operatorOptionRowsWithSelectedCodes(operatorCodesForProcess(processName), operatorScopeForProcess(processName));
}

async function searchOperatorsForScope(scope: string, keyword: string) {
  const requestId = ++operatorSearchRequestSequence;
  operatorSearchRequestByScope[scope] = requestId;
  operatorKeywordByScope[scope] = keyword.trim();
  operatorLoadingByScope[scope] = true;
  // 远程搜索返回前先用本地缓存做一次精确过滤，避免下拉框短暂显示不匹配的旧候选。
  setOperatorOptionsForScope(
    scope,
    keyword.trim()
      ? operatorOptions.value.filter((operator) => operatorMatchesLocalKeyword(operator, keyword))
      : operatorOptions.value
  );
  try {
    const operators = await erpApi.productionOperators(keyword.trim());
    if (requestId === operatorSearchRequestByScope[scope]) {
      setOperatorOptionsForScope(scope, operators);
    }
  } catch {
    if (requestId === operatorSearchRequestByScope[scope]) {
      setOperatorOptionsForScope(scope, []);
    }
  } finally {
    if (requestId === operatorSearchRequestByScope[scope]) {
      operatorLoadingByScope[scope] = false;
    }
  }
}

function searchOperatorsForProcess(processName: string, keyword: string) {
  return searchOperatorsForScope(operatorScopeForProcess(processName), keyword);
}

function searchFinalOperators(keyword: string) {
  return searchOperatorsForScope(finalOperatorScope, keyword);
}

function searchStartSupervisors(keyword: string) {
  return searchOperatorsForScope(startSupervisorScope, keyword);
}

function searchBatchStartSupervisors(keyword: string) {
  return searchOperatorsForScope(batchStartSupervisorScope, keyword);
}

function searchFinalSupervisors(keyword: string) {
  return searchOperatorsForScope(finalSupervisorScope, keyword);
}

function handleOperatorSelectVisible(scope: string, visible: boolean) {
  if (visible) {
    if (!operatorOptionsByScope[scope]) {
      void searchOperatorsForScope(scope, '');
    }
    return;
  }
  operatorKeywordByScope[scope] = '';
  operatorOptionsByScope[scope] = operatorOptions.value;
}

function handleProcessOperatorSelectVisible(processName: string, visible: boolean) {
  handleOperatorSelectVisible(operatorScopeForProcess(processName), visible);
}

function handleFinalOperatorSelectVisible(visible: boolean) {
  handleOperatorSelectVisible(finalOperatorScope, visible);
}

function handleStartSupervisorSelectVisible(visible: boolean) {
  handleOperatorSelectVisible(startSupervisorScope, visible);
}

function handleBatchStartSupervisorSelectVisible(visible: boolean) {
  handleOperatorSelectVisible(batchStartSupervisorScope, visible);
}

function handleFinalSupervisorSelectVisible(visible: boolean) {
  handleOperatorSelectVisible(finalSupervisorScope, visible);
}

function operatorOptionLabel(operator: ProductionOperator) {
  return `${operator.name} / ${operator.accountId || operator.code} / ${operator.role}`;
}

function validateShortageHandling() {
  if (!shouldShowShortagePanel.value) {
    return true;
  }

  const scrapQuantity = Number(processForm.scrapQuantity);
  if (!Number.isFinite(scrapQuantity) || scrapQuantity < 0) {
    ElMessage.warning('请填写报废数量，没有报废也需要填写 0');
    return false;
  }
  if (scrapQuantity > shortageQuantity.value) {
    ElMessage.warning('报废数量不能大于缺少数量');
    return false;
  }
  if (processForm.shortageMode === 'REPLENISHMENT_REQUEST' && scrapQuantity <= 0) {
    ElMessage.warning('生产报废补单申请必须填写大于 0 的报废数量');
    return false;
  }
  if (processForm.shortageMode === 'MANAGER_APPROVED') {
    if (!processForm.managerName.trim()) {
      ElMessage.warning('请填写车间管理人员');
      return false;
    }
    if (!processForm.shortageReason.trim()) {
      ElMessage.warning('请填写订单缺货完成理由');
      return false;
    }
  }
  return true;
}

async function confirmProcessQuantityOverride() {
  if (!shouldShowQuantityOverridePanel.value) {
    return true;
  }
  if (!processForm.quantityOverrideReason.trim()) {
    ElMessage.warning('完成数量超过上一道工序数量，请填写原因');
    return false;
  }
  if (quantityOverrideResolver) {
    quantityOverrideResolver(false);
    quantityOverrideResolver = undefined;
  }
  quantityOverrideDialogVisible.value = true;
  return new Promise<boolean>((resolve) => {
    quantityOverrideResolver = resolve;
  });
}

function confirmQuantityOverrideDialog() {
  const resolve = quantityOverrideResolver;
  quantityOverrideResolver = undefined;
  quantityOverrideDialogVisible.value = false;
  resolve?.(true);
}

function cancelQuantityOverrideDialog() {
  const resolve = quantityOverrideResolver;
  quantityOverrideResolver = undefined;
  quantityOverrideDialogVisible.value = false;
  resolve?.(false);
}

function handleQuantityOverrideDialogClosed() {
  if (!quantityOverrideResolver) {
    return;
  }
  const resolve = quantityOverrideResolver;
  quantityOverrideResolver = undefined;
  resolve(false);
}

function buildShortagePayloadFromForm() {
  if (!shouldShowShortagePanel.value) {
    return {};
  }
  return {
    scrapQuantity: Number(processForm.scrapQuantity),
    shortageMode: processForm.shortageMode,
    managerName: processForm.shortageMode === 'MANAGER_APPROVED' ? processForm.managerName.trim() : undefined,
    shortageReason: processForm.shortageMode === 'MANAGER_APPROVED' ? processForm.shortageReason.trim() : undefined
  };
}

function buildProcessQuantityPayload() {
  if (!shouldShowQuantityOverridePanel.value) {
    return {};
  }
  return {
    quantityOverrideReason: processForm.quantityOverrideReason.trim()
  };
}

async function confirmCompletedTask(row: ProductionTask) {
  if (guardDesktopProductionMutation('确认生产完成')) {
    return;
  }
  if (!isAllProcessConfirmed(row)) {
    ElMessage.warning('请先确认所有生产工序');
    return;
  }

  const finalCompletion = finalProcessCompletion(row);
  activeFinalTask.value = row;
  finalForm.completedQuantity = finalCompletion?.completedQuantity ?? row.completedQuantity ?? row.plannedQuantity;
  finalForm.operatorCodes = operatorCodesFromCompletion(finalCompletion);
  finalForm.scrapQuantity = finalCompletion?.scrapQuantity ?? 0;
  finalForm.shortageMode = finalCompletion?.shortageMode || 'REPLENISHMENT_REQUEST';
  finalForm.managerName = finalCompletion?.managerName || '';
  finalForm.shortageReason = finalCompletion?.shortageReason || '';
  finalForm.remark = finalCompletion?.remark || row.remark || '';
  finalSupervisorCode.value = '';
  finalConfirmVisible.value = true;
  void searchFinalSupervisors('');
}

function closeFinalConfirmDialog() {
  if (finalSaving.value) {
    warnProductionSavingClose('生产完成确认正在保存，请等待保存完成');
    return;
  }
  finalConfirmVisible.value = false;
}

function handleFinalConfirmDialogClose(done: () => void) {
  if (finalSaving.value) {
    warnProductionSavingClose('生产完成确认正在保存，请等待保存完成');
    return;
  }
  done();
}

function resetFinalConfirmDialog() {
  activeFinalTask.value = undefined;
  finalSupervisorCode.value = '';
  finalForm.completedQuantity = 1;
  finalForm.operatorCodes = [];
  finalForm.scrapQuantity = 0;
  finalForm.shortageMode = 'REPLENISHMENT_REQUEST';
  finalForm.managerName = '';
  finalForm.shortageReason = '';
  finalForm.remark = '';
}

function validateFinalCompletion() {
  if (!activeFinalTask.value) {
    return false;
  }
  if (!finalSupervisorCode.value) {
    ElMessage.warning('请选择车间主任');
    return false;
  }
  if (!finalForm.completedQuantity || finalForm.completedQuantity <= 0) {
    ElMessage.warning('请填写最终完成数量');
    return false;
  }
  if (!finalShouldShowShortagePanel.value) {
    return true;
  }

  const scrapQuantity = Number(finalForm.scrapQuantity);
  if (!Number.isFinite(scrapQuantity) || scrapQuantity < 0) {
    ElMessage.warning('请填写报废数量，没有报废也需要填写 0');
    return false;
  }
  if (scrapQuantity > finalShortageQuantity.value) {
    ElMessage.warning('报废数量不能大于缺少数量');
    return false;
  }
  if (finalForm.shortageMode === 'REPLENISHMENT_REQUEST' && scrapQuantity <= 0) {
    ElMessage.warning('生产报废补单申请必须填写大于 0 的报废数量');
    return false;
  }
  if (finalForm.shortageMode === 'MANAGER_APPROVED') {
    if (!finalForm.managerName.trim()) {
      ElMessage.warning('请填写车间管理人员');
      return false;
    }
    if (!finalForm.shortageReason.trim()) {
      ElMessage.warning('请填写订单缺货完成理由');
      return false;
    }
  }
  return true;
}

function buildFinalShortagePayload() {
  if (!finalShouldShowShortagePanel.value) {
    return {};
  }
  return {
    scrapQuantity: Number(finalForm.scrapQuantity),
    shortageMode: finalForm.shortageMode,
    managerName: finalForm.shortageMode === 'MANAGER_APPROVED' ? finalForm.managerName.trim() : undefined,
    shortageReason: finalForm.shortageMode === 'MANAGER_APPROVED' ? finalForm.shortageReason.trim() : undefined
  };
}

async function saveFinalProductionCompletion() {
  if (finalSaving.value) {
    return;
  }
  if (guardDesktopProductionMutation('确认生产完成')) {
    return;
  }
  if (!activeFinalTask.value || !validateFinalCompletion()) {
    return;
  }

  finalSaving.value = true;
  try {
    await erpApi.completeProduction(activeFinalTask.value.id, {
      supervisorCode: finalSupervisorCode.value,
      completedQuantity: finalForm.completedQuantity,
      operatorCodes: cleanOperatorCodes(finalForm.operatorCodes),
      ...buildFinalShortagePayload(),
      remark: finalForm.remark || undefined
    });
    ElMessage.success(activeFinalTask.value.status === 'COMPLETED' ? '生产完成确认已修改' : '生产已确认完成，请到仓库确认入库');
    finalConfirmVisible.value = false;
    finalSupervisorCode.value = '';
    await Promise.all([loadTasks(), loadOrderSummaries()]);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '确认生产完成失败');
  } finally {
    finalSaving.value = false;
  }
}

async function saveProcessCompletion() {
  if (processSaving.value) {
    return;
  }
  if (guardDesktopProductionMutation('保存工序完成表')) {
    return;
  }
  if (!activeTask.value || !activeProcessName.value) {
    return;
  }
  if (activeTask.value.inventoryBatchNo) {
    ElMessage.warning('该生产任务已经入库，不能再修改工序完成表');
    return;
  }
  if (processForm.isCompleted && (!processForm.completedQuantity || processForm.completedQuantity <= 0)) {
    ElMessage.warning('请填写完成数量');
    return;
  }
  const selectedProcessNames = selectedProcessNamesForSave();
  if (!validateShortageHandling()) {
    return;
  }
  if (processForm.isCompleted) {
    const missingOperatorProcessNames = selectedProcessNames.filter((processName) => operatorCodesForProcess(processName).length === 0);
    if (missingOperatorProcessNames.length > 0) {
      ElMessage.warning(`请选择${formatProductionListPreview(missingOperatorProcessNames, '工序')}的操作人员`);
      return;
    }
  }
  if (!(await confirmProcessQuantityOverride())) {
    return;
  }

  const savedTaskId = activeTask.value.id;
  const shouldOpenFinalConfirmAfterSave = processForm.isCompleted;
  processSaving.value = true;
  try {
    if (processForm.isCompleted && selectedProcessNames.length > 1) {
      await erpApi.completeProcessSteps(activeTask.value.id, {
        processNames: selectedProcessNames,
        completedQuantity: processForm.completedQuantity,
        operatorsByProcess: selectedProcessNames.map((processName) => ({
          processName,
          operatorCodes: operatorCodesForProcess(processName)
        })),
        ...buildShortagePayloadFromForm(),
        ...buildProcessQuantityPayload(),
        remark: processForm.remark
      });
      ElMessage.success(`${formatProductionListPreview(selectedProcessNames, '工序')}已保存`);
    } else {
      await erpApi.completeProcessStep(activeTask.value.id, {
        processName: activeProcessName.value,
        isCompleted: processForm.isCompleted,
        completedQuantity: processForm.completedQuantity,
        operatorCodes: operatorCodesForProcess(activeProcessName.value),
        ...buildShortagePayloadFromForm(),
        ...buildProcessQuantityPayload(),
        remark: processForm.remark
      });
      ElMessage.success(`${activeProcessName.value}已保存`);
    }
    processVisible.value = false;
    await Promise.all([loadTasks(), loadOrderSummaries()]);
    const updatedTask = tasks.value.find((task) => task.id === savedTaskId);
    if (shouldOpenFinalConfirmAfterSave && updatedTask && shouldShowConfirmCompletedAction(updatedTask)) {
      await confirmCompletedTask(updatedTask);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '工序完成保存失败');
  } finally {
    processSaving.value = false;
  }
}

function productionStatusLabel(status: ProductionDisplayStatus) {
  const labels: Record<ProductionDisplayStatus, string> = {
    PENDING: '待确认生产',
    IN_PROGRESS: '生产中',
    WAITING_CONFIRMATION: '待确认完成',
    READY_TO_COMPLETE: '待确认完成',
    COMPLETED: '已完成',
    RECEIVED: '已入库',
    STORED: '已入库',
    CANCELLED: '已取消'
  };
  return labels[status] || status;
}

function productionStatusTagType(status: ProductionDisplayStatus) {
  const types: Record<ProductionDisplayStatus, 'success' | 'warning' | 'info' | 'primary' | 'danger'> = {
    PENDING: 'info',
    IN_PROGRESS: 'warning',
    WAITING_CONFIRMATION: 'primary',
    READY_TO_COMPLETE: 'primary',
    COMPLETED: 'success',
    RECEIVED: 'success',
    STORED: 'success',
    CANCELLED: 'danger'
  };
  return types[status] || 'info';
}

function formatProcessSteps(row: ProductionTask) {
  return formatProductionProcessSteps(row);
}

function formatProductionProcessSteps(row: { processSteps: string[]; processStepDetails?: ProductionTask['processStepDetails'] }, emptyText = '-', delimiter = '、') {
  return formatProductionListPreview(row.processSteps.map((step) => processStepDisplay(row, step)), '工序', emptyText, delimiter);
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function formatCompletedQuantity(row: ProductionTask) {
  // 完成数量为 0 时不显示“0 件”，只保留单位，避免生产计划表视觉噪音过多。
  if (Number(row.completedQuantity) === 0) {
    return row.unit || '-';
  }
  return formatQuantity(row.completedQuantity, row.unit);
}

function formatCustomerOrderQuantity(row: ProductionTask) {
  // 生产现场要同时看到客户订单数量和生产计划数量，避免把多做库存误认为客户要发货数量。
  return formatQuantity(row.customerOrderQuantity ?? row.plannedQuantity, row.unit);
}

function formatProductionTaskThickness(row: ProductionTask) {
  if (row.lineType === 'COMPONENT') {
    return '不适用（父级组件由子零件维护）';
  }
  return row.partThickness ? `${row.partThickness} mm` : '-';
}

function formatProductionTaskDrawingText(row: Pick<ProductionTask, 'drawingNo' | 'drawingVersion' | 'drawingDate' | 'drawingStatus'>) {
  return [row.drawingNo, row.drawingVersion, row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ') || '未上传图纸';
}

function formatCompletedPlan(row: ProductionTask) {
  return `${formatCompletedQuantity(row)} / ${formatQuantity(row.plannedQuantity, row.unit)}`;
}

function productionTaskStatusCounts(rows: ProductionTask[]) {
  return {
    PENDING: rows.filter((task) => effectiveProductionStatus(task) === 'PENDING').length,
    IN_PROGRESS: rows.filter((task) => effectiveProductionStatus(task) === 'IN_PROGRESS').length,
    WAITING_CONFIRMATION: rows.filter((task) => effectiveProductionStatus(task) === 'WAITING_CONFIRMATION').length,
    READY_TO_COMPLETE: rows.filter((task) => effectiveProductionStatus(task) === 'READY_TO_COMPLETE').length,
    COMPLETED: rows.filter((task) => effectiveProductionStatus(task) === 'COMPLETED').length,
    RECEIVED: rows.filter((task) => effectiveProductionStatus(task) === 'RECEIVED').length,
    STORED: rows.filter((task) => effectiveProductionStatus(task) === 'STORED').length,
    CANCELLED: rows.filter((task) => effectiveProductionStatus(task) === 'CANCELLED').length
  };
}

function orderSummaryStatusCounts(row: ProductionOrderSummary) {
  // 订单详情模式优先使用订单汇总口径，确保顶部卡片和“订单生产概况”一致。
  return {
    PENDING: row.pendingCount,
    IN_PROGRESS: row.inProgressCount,
    READY_TO_COMPLETE: row.readyToCompleteCount,
    COMPLETED: row.completedCount,
    RECEIVED: row.receivedCount
  };
}

function orderSummaryQuantityText(row: ProductionOrderSummary) {
  if (row.quantityByUnit.length === 0) {
    return `${formatQuantity(row.totalCompletedQuantity, row.unit)} / ${formatQuantity(row.totalPlannedQuantity, row.unit)}`;
  }
  return row.quantityByUnit
    .map((item) => `${formatQuantity(item.completedQuantity, item.unit)} / ${formatQuantity(item.plannedQuantity, item.unit)}`)
    .join('；');
}

function orderSummaryShortageActionText(row: ProductionOrderSummary) {
  if (row.needsProductionReplenishmentReview && !row.needsReplenishmentAction) {
    const quantityText = row.pendingProductionReplenishmentQuantityByUnit?.length
      ? formatQuantityByUnitPreview(row.pendingProductionReplenishmentQuantityByUnit)
      : formatQuantity(row.pendingProductionReplenishmentQuantity ?? 0, row.pendingProductionReplenishmentUnit || row.unit || '件');
    return `生产报废补单待确认 ${row.pendingProductionReplenishmentLineCount ?? 0} 个零件 / ${quantityText}`;
  }
  const quantityText = row.unresolvedShortageQuantityByUnit?.length
    ? formatQuantityByUnitPreview(row.unresolvedShortageQuantityByUnit)
    : formatQuantity(row.unresolvedShortageQuantity ?? 0, row.unresolvedShortageUnit || row.unit || '件');
  return `需补单 ${row.unresolvedShortageLineCount ?? 0} 个零件 / ${quantityText}`;
}

function formatQuantityByUnitPreview(rows?: Array<{ quantity: number; unit: string }>) {
  const values = (rows || []).map((row) => formatQuantity(row.quantity, row.unit)).filter(Boolean);
  if (values.length === 0) {
    return '-';
  }
  const preview = values.filter((_, index) => index < 3).join('、');
  return values.length > 3 ? `${preview} 等 ${values.length} 个单位` : preview;
}

function orderSummaryNeedsShortageAttention(row: ProductionOrderSummary) {
  return Boolean(row.needsReplenishmentAction || row.needsProductionReplenishmentReview);
}

function buildOrderSummaryFromTasks(rows: ProductionTask[]): ProductionOrderSummary | undefined {
  const first = rows[0];
  if (!first) {
    return undefined;
  }
  const counts = {
    PENDING: 0,
    IN_PROGRESS: 0,
    WAITING_CONFIRMATION: 0,
    READY_TO_COMPLETE: 0,
    COMPLETED: 0,
    RECEIVED: 0,
    STORED: 0,
    CANCELLED: 0
  } satisfies Record<ProductionDisplayStatus, number>;
  const partKeys = new Set<string>();
  const quantityByUnit = new Map<
    string,
    {
      unit: string;
      customerOrderQuantity: number;
      plannedQuantity: number;
      completedQuantity: number;
    }
  >();
  const pendingTasks: ProductionOrderSummaryTask[] = [];
  const customerOrderLineKeys = new Set<string>();
  const unresolvedShortageLineKeys = new Set<string>();
  const unresolvedShortageQuantityByUnit = new Map<string, number>();
  const pendingProductionReplenishmentLineKeys = new Set<string>();
  const pendingProductionReplenishmentQuantityByUnit = new Map<string, number>();
  const shortageActionTasks: NonNullable<ProductionOrderSummary['shortageActionTasks']> = [];

  for (const task of rows) {
    partKeys.add(`${task.partCode}__${task.partName}`);
    const status = effectiveProductionStatus(task);
    counts[status] += 1;
    const quantityRow =
      quantityByUnit.get(task.unit) ||
      {
        unit: task.unit,
        customerOrderQuantity: 0,
        plannedQuantity: 0,
        completedQuantity: 0
      };
    const customerOrderLineKey = task.orderLineId || `${task.partCode}__${task.partName}__${task.unit}`;
    if (!customerOrderLineKeys.has(customerOrderLineKey)) {
      quantityRow.customerOrderQuantity += Number(task.customerOrderQuantity ?? 0);
      customerOrderLineKeys.add(customerOrderLineKey);
    }
    quantityRow.plannedQuantity += Number(task.plannedQuantity ?? 0);
    quantityRow.completedQuantity += Number(task.completedQuantity ?? 0);
    quantityByUnit.set(task.unit, quantityRow);
    if (status === 'PENDING') {
      pendingTasks.push({
        id: task.id,
        orderLineId: task.orderLineId,
        orderNo: task.orderNo,
        orderStatus: task.orderStatus,
        productionTaskNo: task.productionTaskNo,
        partCode: task.partCode,
        partName: task.partName,
        plannedQuantity: task.plannedQuantity,
        unit: task.unit,
        processSteps: task.processSteps,
        processStepDetails: task.processStepDetails
      });
    }
    if (Number(task.unresolvedShortageQuantity ?? 0) > 0) {
      unresolvedShortageLineKeys.add(task.orderLineId || task.id);
      const unit = task.unresolvedShortageUnit || task.unit || '件';
      unresolvedShortageQuantityByUnit.set(
        unit,
        (unresolvedShortageQuantityByUnit.get(unit) ?? 0) + Number(task.unresolvedShortageQuantity ?? 0)
      );
      shortageActionTasks.push({
        id: task.id,
        orderLineId: task.orderLineId,
        productionTaskNo: task.productionTaskNo,
        partCode: task.partCode,
        partName: task.partName,
        shortageQuantity: Number(task.unresolvedShortageQuantity ?? 0),
        unit
      });
    }
    if (Number(task.pendingProductionReplenishmentQuantity ?? 0) > 0) {
      pendingProductionReplenishmentLineKeys.add(task.orderLineId || task.id);
      const unit = task.pendingProductionReplenishmentUnit || task.unit || '件';
      pendingProductionReplenishmentQuantityByUnit.set(
        unit,
        (pendingProductionReplenishmentQuantityByUnit.get(unit) ?? 0) +
          Number(task.pendingProductionReplenishmentQuantity ?? 0)
      );
    }
  }

  const totalPlannedQuantity = rows.reduce((sum, task) => sum + Number(task.plannedQuantity ?? 0), 0);
  const totalCompletedQuantity = rows.reduce((sum, task) => sum + Number(task.completedQuantity ?? 0), 0);
  const doneCount = counts.COMPLETED + counts.RECEIVED;
  return {
    orderId: first.orderId,
    orderNo: first.orderNo,
    orderStatus: first.orderStatus,
    customerId: first.customerId,
    customerName: first.customerName,
    orderDate: first.orderDate,
    deliveryDate: rows.reduce<string | undefined>((current, task) => pickEarlierDateText(current, task.deliveryDate), first.deliveryDate),
    taskCount: rows.length,
    partCount: partKeys.size,
    pendingCount: counts.PENDING,
    inProgressCount: counts.IN_PROGRESS,
    readyToCompleteCount: counts.READY_TO_COMPLETE,
    completedCount: counts.COMPLETED,
    receivedCount: counts.RECEIVED,
    totalPlannedQuantity,
    totalCompletedQuantity,
    unit: first.unit,
    status: resolveOrderSummaryStatusFromCounts(rows.length, counts),
    progressPercent: rows.length > 0 ? Math.round((doneCount / rows.length) * 100) : 0,
    quantityByUnit: Array.from(quantityByUnit.values()),
    unresolvedShortageLineCount: unresolvedShortageLineKeys.size,
    unresolvedShortageQuantity: Array.from(unresolvedShortageQuantityByUnit.values()).reduce((sum, quantity) => sum + quantity, 0),
    unresolvedShortageUnit:
      unresolvedShortageQuantityByUnit.size === 1 ? Array.from(unresolvedShortageQuantityByUnit.keys())[0] : undefined,
    unresolvedShortageQuantityByUnit: Array.from(unresolvedShortageQuantityByUnit.entries()).map(([unit, quantity]) => ({
      unit,
      quantity
    })),
    needsReplenishmentAction: unresolvedShortageLineKeys.size > 0,
    pendingProductionReplenishmentLineCount: pendingProductionReplenishmentLineKeys.size,
    pendingProductionReplenishmentQuantity: Array.from(pendingProductionReplenishmentQuantityByUnit.values()).reduce(
      (sum, quantity) => sum + quantity,
      0
    ),
    pendingProductionReplenishmentUnit:
      pendingProductionReplenishmentQuantityByUnit.size === 1
        ? Array.from(pendingProductionReplenishmentQuantityByUnit.keys())[0]
        : undefined,
    pendingProductionReplenishmentQuantityByUnit: Array.from(pendingProductionReplenishmentQuantityByUnit.entries()).map(
      ([unit, quantity]) => ({
        unit,
        quantity
      })
    ),
    needsProductionReplenishmentReview: pendingProductionReplenishmentLineKeys.size > 0,
    shortageActionTasks,
    pendingTaskIds: pendingTasks.map((task) => task.id),
    pendingTasks
  };
}

function pickEarlierDateText(current?: string, candidate?: string) {
  if (!current) {
    return candidate;
  }
  if (!candidate) {
    return current;
  }
  return new Date(candidate).getTime() < new Date(current).getTime() ? candidate : current;
}

function resolveOrderSummaryStatusFromCounts(
  taskCount: number,
  counts: Record<ProductionDisplayStatus, number>
): ProductionOrderSummaryStatus {
  if (taskCount > 0 && counts.CANCELLED === taskCount) {
    return 'CANCELLED';
  }
  if (taskCount > 0 && counts.RECEIVED === taskCount) {
    return 'RECEIVED';
  }
  if (taskCount > 0 && counts.COMPLETED + counts.RECEIVED === taskCount) {
    return 'COMPLETED';
  }
  if (counts.READY_TO_COMPLETE > 0) {
    return 'READY_TO_COMPLETE';
  }
  if (counts.IN_PROGRESS > 0) {
    return 'IN_PROGRESS';
  }
  return 'PENDING';
}

function orderTasksForSummary(row: ProductionOrderSummary) {
  return tasks.value.filter((task) => task.orderNo === row.orderNo);
}

function orderSummaryProgressItems(row: ProductionOrderSummary) {
  if (row.progressItems?.length) {
    return row.progressItems.map((item) => item.text || `${item.label} ${item.count}`);
  }

  const sourceTasks = orderTasksForSummary(row);
  const buckets = new Map<string, number>();
  const add = (label: string, count = 1) => {
    if (count <= 0) {
      return;
    }
    buckets.set(label, (buckets.get(label) ?? 0) + count);
  };

  if (sourceTasks.length === 0) {
    add('待确认生产', row.pendingCount);
    add('生产中', row.inProgressCount);
    add('待确认完成', row.readyToCompleteCount);
    add('已完成', row.completedCount);
    add('已入库', row.receivedCount);
  } else {
    for (const task of sourceTasks) {
      const status = effectiveProductionStatus(task);
      if (status === 'PENDING') {
        add('待确认生产');
      } else if (status === 'IN_PROGRESS') {
        add(currentProcessText(task));
      } else if (status === 'READY_TO_COMPLETE') {
        add('待确认完成');
      } else {
        add(productionStatusLabel(status));
      }
    }
  }

  return Array.from(buckets.entries()).map(([label, count]) => `${label} ${count}`);
}

function orderSummaryProgressPreviewItems(row: ProductionOrderSummary) {
  const items = orderSummaryProgressItems(row);
  if (items.length <= 3) {
    return items;
  }
  return [...items.filter((_, index) => index < 3), `等 ${items.length} 项`];
}

function orderSummaryProgressText(row: ProductionOrderSummary) {
  return formatProductionListPreview(orderSummaryProgressItems(row), '进度');
}

function finalProcessCompletion(row: ProductionTask) {
  const finalProcessName = row.processSteps[row.processSteps.length - 1];
  return finalProcessName ? getProcessCompletion(row, finalProcessName) : undefined;
}

function pendingProductionReplenishmentRequest(row: ProductionTask) {
  if (row.orderStatus === 'CANCELLED' || row.orderStatus === 'COMPLETED' || row.inventoryBatchNo) {
    return undefined;
  }
  return row.processCompletions?.find(
    (completion) =>
      completion.id &&
      completion.shortageMode === 'REPLENISHMENT_REQUEST' &&
      completion.shortageQuantity > 0 &&
      (!completion.replenishmentRequestStatus || completion.replenishmentRequestStatus === 'PENDING') &&
      !completion.replenishmentTaskNo
  );
}

function replenishmentRequestLockedReason(request: ProductionReplenishmentRequest) {
  if (request.orderStatus === 'COMPLETED') {
    return '订单已完成发货，不能处理生产报废补单申请';
  }
  if (request.orderStatus === 'CANCELLED') {
    return '订单已取消，不能处理生产报废补单申请';
  }
  return '';
}

function canReviewReplenishmentRequest(request: ProductionReplenishmentRequest) {
  return request.status === 'PENDING' && !replenishmentRequestLockedReason(request);
}

function replenishmentRequestStatusTag(status: ProductionReplenishmentRequest['status']) {
  if (status === 'APPROVED') {
    return 'COMPLETED';
  }
  if (status === 'REJECTED') {
    return 'CANCELLED';
  }
  return 'PENDING';
}

function replenishmentRequestStatusText(status: ProductionReplenishmentRequest['status']) {
  const labels: Record<ProductionReplenishmentRequest['status'], string> = {
    PENDING: '待主管确认',
    APPROVED: '已生成报废补单',
    REJECTED: '已驳回'
  };
  return labels[status] || status;
}

function replenishmentSourceTypeText(sourceType?: string) {
  if (sourceType === 'PRODUCTION_SCRAP') {
    return '生产报废补单';
  }
  return sourceType || '生产报废补单';
}

function openReplenishmentApproval(row: ProductionTask) {
  if (guardDesktopProductionMutation('主管确认补单')) {
    return;
  }
  const completion = pendingProductionReplenishmentRequest(row);
  if (!completion) {
    ElMessage.warning('当前任务没有待主管确认的生产报废补单申请');
    return;
  }
  activeReplenishmentApprovalTask.value = row;
  activeReplenishmentApprovalCompletion.value = completion;
  replenishmentApprovalForm.managerName = '';
  replenishmentApprovalForm.remark = '';
  replenishmentApprovalVisible.value = true;
}

async function findProductionTaskForReplenishmentRequest(request: ProductionReplenishmentRequest) {
  const pageLimit = 100;
  let offset = 0;
  while (true) {
    // 补单确认只按订单分页查找目标生产任务，不允许为了单个补单申请一次性拉取整单全量任务。
    const result = await erpApi.productionTasksPage({
      orderNo: request.orderNo,
      limit: pageLimit,
      offset
    });
    const task = result.items.find((item) => item.productionTaskNo === request.productionTaskNo);
    if (task || !result.hasMore || result.items.length === 0) {
      return task;
    }
    offset += pageLimit;
  }
}

function closeReplenishmentApprovalDialog() {
  if (replenishmentApprovalSaving.value) {
    warnProductionSavingClose('生产报废补单确认正在保存，请等待保存完成');
    return;
  }
  replenishmentApprovalVisible.value = false;
}

function handleReplenishmentApprovalDialogClose(done: () => void) {
  if (replenishmentApprovalSaving.value) {
    warnProductionSavingClose('生产报废补单确认正在保存，请等待保存完成');
    return;
  }
  done();
}

async function openReplenishmentApprovalFromRequest(request: ProductionReplenishmentRequest) {
  if (guardDesktopProductionMutation('主管确认补单')) {
    return;
  }
  activeReplenishmentApprovalTask.value = undefined;
  activeReplenishmentApprovalCompletion.value = undefined;
  const lockedReason = replenishmentRequestLockedReason(request);
  if (lockedReason) {
    ElMessage.warning(lockedReason);
    return;
  }
  if (!request.processCompletionId) {
    ElMessage.warning('该补单申请缺少工序完成记录，不能确认');
    return;
  }

  let task = tasks.value.find((item) => item.productionTaskNo === request.productionTaskNo);
  if (!task) {
    try {
      task = await findProductionTaskForReplenishmentRequest(request);
    } catch (error) {
      activeReplenishmentApprovalTask.value = undefined;
      activeReplenishmentApprovalCompletion.value = undefined;
      ElMessage.error(error instanceof Error ? error.message : '补单申请关联任务加载失败，请确认订单、任务和后端服务');
      return;
    }
  }

  const completion = task?.processCompletions.find(
    (item) => item.id === request.processCompletionId || item.replenishmentRequestNo === request.requestNo
  );
  if (!task || !completion) {
    ElMessage.warning('没有找到该补单申请对应的生产任务，请刷新后重试');
    return;
  }

  activeReplenishmentApprovalTask.value = task;
  activeReplenishmentApprovalCompletion.value = completion;
  replenishmentApprovalForm.managerName = '';
  replenishmentApprovalForm.remark = '';
  replenishmentApprovalVisible.value = true;
}

async function saveReplenishmentApproval() {
  if (replenishmentApprovalSaving.value) {
    return;
  }
  if (guardDesktopProductionMutation('主管确认补单')) {
    return;
  }
  const completion = activeReplenishmentApprovalCompletion.value;
  if (!completion?.id) {
    return;
  }
  if (!replenishmentApprovalForm.managerName.trim()) {
    ElMessage.warning('请输入车间主管姓名');
    return;
  }

  replenishmentApprovalSaving.value = true;
  try {
    await erpApi.approveProductionReplenishmentRequest(completion.id, {
      managerName: replenishmentApprovalForm.managerName.trim(),
      remark: replenishmentApprovalForm.remark.trim() || undefined
    });
    ElMessage.success('主管已确认，系统已生成生产报废补单任务');
    replenishmentApprovalVisible.value = false;
    await queryTasks();
    if (replenishmentRequestVisible.value) {
      await loadProductionReplenishmentRequests(true);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '主管确认补单失败');
  } finally {
    replenishmentApprovalSaving.value = false;
  }
}

function openReplenishmentReject(request: ProductionReplenishmentRequest) {
  if (guardDesktopProductionMutation('驳回补单申请')) {
    return;
  }
  const lockedReason = replenishmentRequestLockedReason(request);
  if (lockedReason) {
    ElMessage.warning(lockedReason);
    return;
  }
  if (!request.processCompletionId) {
    ElMessage.warning('该补单申请缺少工序完成记录，不能驳回');
    return;
  }
  activeReplenishmentRejectRequest.value = request;
  replenishmentRejectForm.managerName = '';
  replenishmentRejectForm.reason = '';
  replenishmentRejectVisible.value = true;
}

function closeReplenishmentRejectDialog() {
  if (replenishmentRejectSaving.value) {
    warnProductionSavingClose('生产报废补单驳回正在保存，请等待保存完成');
    return;
  }
  replenishmentRejectVisible.value = false;
}

function handleReplenishmentRejectDialogClose(done: () => void) {
  if (replenishmentRejectSaving.value) {
    warnProductionSavingClose('生产报废补单驳回正在保存，请等待保存完成');
    return;
  }
  done();
}

async function saveReplenishmentReject() {
  if (replenishmentRejectSaving.value) {
    return;
  }
  if (guardDesktopProductionMutation('驳回补单申请')) {
    return;
  }
  const request = activeReplenishmentRejectRequest.value;
  if (!request?.processCompletionId) {
    return;
  }
  if (!replenishmentRejectForm.managerName.trim()) {
    ElMessage.warning('请输入车间主管姓名');
    return;
  }
  if (!replenishmentRejectForm.reason.trim()) {
    ElMessage.warning('请填写驳回原因');
    return;
  }

  replenishmentRejectSaving.value = true;
  try {
    await erpApi.rejectProductionReplenishmentRequest(request.processCompletionId, {
      managerName: replenishmentRejectForm.managerName.trim(),
      reason: replenishmentRejectForm.reason.trim()
    });
    ElMessage.success('已驳回生产报废补单申请，并记录为管理确认缺货完成');
    replenishmentRejectVisible.value = false;
    await queryTasks();
    if (replenishmentRequestVisible.value) {
      await loadProductionReplenishmentRequests(true);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '驳回补单申请失败');
  } finally {
    replenishmentRejectSaving.value = false;
  }
}

function taskRelationText(row: ProductionTask) {
  const texts: string[] = [];
  if (row.isReplenishment && row.sourceProductionTaskNo) {
    const sourceRequest = row.replenishmentSourceRequestNo ? ` / 来源单 ${row.replenishmentSourceRequestNo}` : '';
    texts.push(`${replenishmentTaskTypeText(row)}：源任务 ${row.sourceProductionTaskNo}${sourceRequest}`);
  } else if (row.isReplenishment) {
    const sourceRequest = row.replenishmentSourceRequestNo ? `：来源单 ${row.replenishmentSourceRequestNo}` : '';
    texts.push(`${replenishmentTaskTypeText(row)}${sourceRequest}`);
  }
  const componentText = productionComponentText(row);
  if (componentText) {
    texts.push(componentText);
  }
  if (row.importSequence) {
    texts.push(`Excel 序号 ${row.importSequence}`);
  }
  return texts.join('；');
}

function productionComponentText(row: ProductionTask | { lineType?: string; componentNo?: string; parentComponentNo?: string }) {
  if (row.lineType === 'COMPONENT' && row.componentNo) {
    return `组件 ${String(row.componentNo || '').trim().toUpperCase() || '未编号'}`;
  }
  if (row.parentComponentNo) {
    return `子零件 -> ${String(row.parentComponentNo || '').trim().toUpperCase()}`;
  }
  if (row.lineType === 'PART') {
    return '单独零件';
  }
  return '';
}

function replenishmentTaskTypeText(row: ProductionTask) {
  return row.replenishmentSourceLabel || (row.replenishmentSourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单');
}

function shortageSummary(row: ProductionTask) {
  const completion = finalProcessCompletion(row);
  if (!completion || !completion.shortageQuantity || completion.shortageQuantity <= 0) {
    return '';
  }

  const shortage = formatQuantity(completion.shortageQuantity, row.unit);
  const scrap = formatQuantity(completion.scrapQuantity ?? 0, row.unit);
  if (completion.shortageMode === 'REPLENISHMENT_REQUEST' && !completion.replenishmentTaskNo) {
    return `缺 ${shortage}，报废 ${scrap}，生产报废补单申请待主管确认${completion.replenishmentRequestNo ? `：${completion.replenishmentRequestNo}` : ''}`;
  }
  if (completion.shortageMode === 'REPLENISHMENT') {
    const sourceText = completion.replenishmentSource === 'PRODUCTION_SCRAP' ? '生产报废补单' : '补单';
    return `缺 ${shortage}，报废 ${scrap}，${sourceText} ${completion.replenishmentTaskNo || '-'}`;
  }
  if (completion.shortageResolutionMode) {
    const modeText =
      completion.shortageResolutionMode === 'NO_REPLENISHMENT'
        ? '无需补单'
        : completion.shortageResolutionMode === 'CUSTOMER_QUANTITY_CHANGED'
          ? '客户数量已变更'
          : '已创建订单补单';
    return `缺 ${shortage}，报废 ${scrap}，${modeText}：${completion.shortageResolutionReason || '-'}`;
  }

  return `缺 ${shortage}，报废 ${scrap}，${completion.managerName || '-'}确认：${completion.shortageReason || '-'}`;
}

function drawingHref(url?: string) {
  return url || '';
}

function displayFileName(fileName?: string | null) {
  return normalizeDisplayFileName(fileName);
}

function isImageDrawing(url?: string) {
  return Boolean(url && /\.(png|jpe?g|webp)$/i.test(url));
}

function isPdfDrawing(url?: string) {
  return Boolean(url && /\.pdf$/i.test(url));
}

function formatProcessLog(snapshot?: Record<string, unknown> | null) {
  if (!snapshot) {
    return '-';
  }
  const status = snapshot.isCompleted ? '已完成' : '未完成';
  const quantity = formatQuantity(Number(snapshot.completedQuantity ?? 0), String(snapshot.unit || '件'));
  const role = snapshot.operatorRole ? ` / ${snapshot.operatorRole}` : '';
  const completedAt = snapshot.completedAt ? `，时间 ${formatDateTime(String(snapshot.completedAt))}` : '';
  const shortageQuantity = Number(snapshot.shortageQuantity ?? 0);
  const shortageMode =
    snapshot.shortageMode === 'REPLENISHMENT_REQUEST'
      ? '生产报废补单申请'
      : snapshot.shortageMode === 'REPLENISHMENT'
        ? '生成补单'
        : '管理确认缺货完成';
  const replenishmentTaskNo = snapshot.replenishmentTaskNo ? `，补单任务 ${snapshot.replenishmentTaskNo}` : '';
  const requestNo = snapshot.replenishmentRequestNo ? `，申请单 ${snapshot.replenishmentRequestNo}` : '';
  const manager = snapshot.managerName ? `，确认主管 ${snapshot.managerName}` : '';
  const reason = snapshot.shortageReason ? `，缺货理由 ${snapshot.shortageReason}` : '';
  const shortage =
    shortageQuantity > 0
      ? `，缺少 ${formatQuantity(shortageQuantity, String(snapshot.unit || '件'))}，报废 ${formatQuantity(
          Number(snapshot.scrapQuantity ?? 0),
          String(snapshot.unit || '件')
        )}，处理 ${shortageMode}${requestNo}${replenishmentTaskNo}${manager}${reason}`
      : '';
  const quantityOverrideReason = snapshot.quantityOverrideReason ? `，数量原因 ${snapshot.quantityOverrideReason}` : '';
  const remark = snapshot.remark ? `，备注 ${snapshot.remark}` : '';
  return `${status}，数量 ${quantity}，操作人员 ${snapshot.operatorName || '-'}${role}${completedAt}${shortage}${quantityOverrideReason}${remark}`;
}

function formatProcessLogPreview(snapshot?: Record<string, unknown> | null) {
  return formatLongTextPreview(formatProcessLog(snapshot), 96, '-');
}

function formatProcessLogTitle(snapshot?: Record<string, unknown> | null) {
  return formatProcessLog(snapshot);
}

function refreshPrintDateTime() {
  printDateTime.value = formatDateTime(new Date());
}

function productionPlanRows() {
  return filteredTasks.value.map((task, index) => ({
    index: index + 1,
    productionTaskNo: task.productionTaskNo,
    taskRelationText: taskRelationText(task),
    orderNo: task.orderNo,
    customerName: task.customerName,
    orderDate: formatDate(task.orderDate),
    deliveryDate: formatDate(task.deliveryDate),
    partName: task.partName,
    customerOrderText: formatCustomerOrderQuantity(task),
    quantityText: formatCompletedPlan(task),
    shortageText: shortageSummary(task),
    processSteps: formatProcessSteps(task),
    currentProcessText: currentProcessText(task),
    processProgressText: processProgressText(task),
    status: productionStatusLabel(effectiveProductionStatus(task))
  }));
}

function productionOrderSummaryRows() {
  return filteredOrderSummaries.value.map((summary, index) => ({
    index: index + 1,
    orderNo: summary.orderNo,
    customerName: summary.customerName,
    orderDate: formatDate(summary.orderDate),
    deliveryDate: formatDate(summary.deliveryDate),
    partTaskText: `${summary.partCount} / ${summary.taskCount}`,
    quantityText: orderSummaryQuantityText(summary),
    progressText: `${summary.progressPercent}%`,
    currentProgressText: orderSummaryProgressText(summary),
    status: productionStatusLabel(summary.status)
  }));
}

function buildOrderSummaryPrintTableHtml() {
  const rows = productionOrderSummaryRows()
    .map(
      (row) => `
        <tr>
          <td>${row.index}</td>
          <td>${escapeHtml(row.orderNo)}</td>
          <td>${escapeHtml(row.customerName)}</td>
          <td>${escapeHtml(row.orderDate)}</td>
          <td>${escapeHtml(row.deliveryDate)}</td>
          <td>${escapeHtml(row.partTaskText)}</td>
          <td>${escapeHtml(row.quantityText)}</td>
          <td>${escapeHtml(row.progressText)}</td>
          <td>${escapeHtml(row.currentProgressText)}</td>
          <td>${escapeHtml(row.status)}</td>
        </tr>`
    )
    .join('');

  return `
    <table class="production-print-table">
      <colgroup>
        <col class="print-col-index" />
        <col class="print-col-order" />
        <col class="print-col-customer" />
        <col class="print-col-date" />
        <col class="print-col-delivery" />
        <col class="print-col-part" />
        <col class="print-col-quantity" />
        <col class="print-col-current" />
        <col class="print-col-process" />
        <col class="print-col-status" />
      </colgroup>
      <thead>
        <tr>
          <th>序号</th>
          <th>订单号</th>
          <th>客户</th>
          <th>订单日期</th>
          <th>交期</th>
          <th>零件/任务</th>
          <th>生产数量</th>
          <th>订单进度</th>
          <th>当前进度</th>
          <th>订单状态</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildTaskPrintTableHtml() {
  const rows = productionPlanRows()
    .map(
      (row) => `
        <tr>
          <td>${row.index}</td>
          <td>${printMultiline(row.productionTaskNo, row.taskRelationText)}</td>
          <td>${escapeHtml(row.orderNo)}</td>
          <td>${escapeHtml(row.customerName)}</td>
          <td>${escapeHtml(row.orderDate)}</td>
          <td>${escapeHtml(row.deliveryDate)}</td>
          <td>${escapeHtml(row.partName)}</td>
          <td>${escapeHtml(row.customerOrderText)}</td>
          <td>${printMultiline(row.quantityText, row.shortageText)}</td>
          <td>${escapeHtml(row.processSteps)}</td>
          <td>${printMultiline(row.currentProcessText, row.processProgressText)}</td>
          <td>${escapeHtml(row.status)}</td>
        </tr>`
    )
    .join('');

  return `
    <table class="production-print-table">
      <colgroup>
        <col class="print-col-index" />
        <col class="print-col-task" />
        <col class="print-col-order" />
        <col class="print-col-customer" />
        <col class="print-col-date" />
        <col class="print-col-delivery" />
        <col class="print-col-part" />
        <col class="print-col-customer-order" />
        <col class="print-col-quantity" />
        <col class="print-col-process" />
        <col class="print-col-current" />
        <col class="print-col-status" />
      </colgroup>
      <thead>
        <tr>
          <th>序号</th>
          <th>任务号</th>
          <th>订单号</th>
          <th>客户</th>
          <th>订单日期</th>
          <th>交期</th>
          <th>零件</th>
          <th>客户订单</th>
          <th>完成/生产计划</th>
          <th>生产流程</th>
          <th>当前工序</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildPrintTableHtml() {
  return viewMode.value === 'ORDER_SUMMARY' ? buildOrderSummaryPrintTableHtml() : buildTaskPrintTableHtml();
}

function printMultiline(mainText: string, subText?: string) {
  const main = escapeHtml(mainText || '-');
  return subText ? `${main}<br /><small class="print-subtext">${escapeHtml(subText)}</small>` : main;
}

function buildProductionPlanDocument() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(printDocumentTitle.value)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111827;
      background: #ffffff;
      font-family: "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
      font-size: 8.5pt;
    }
    .production-print-page {
      width: 281mm;
      min-height: 194mm;
    }
    .production-print-header {
      display: flex;
      justify-content: space-between;
      gap: 8mm;
      margin-bottom: 5mm;
      border-bottom: 0.3mm solid #111827;
      padding-bottom: 3mm;
    }
    .production-print-header h1 {
      margin: 0 0 2mm;
      font-size: 16pt;
      line-height: 1.2;
    }
    .production-print-header p,
    .production-print-meta span {
      margin: 0;
      color: #374151;
      font-size: 8pt;
      line-height: 1.6;
    }
    .production-print-meta {
      min-width: 42mm;
      text-align: right;
    }
    .production-print-meta span {
      display: block;
    }
    .production-print-table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
    }
    .production-print-table th,
    .production-print-table td {
      border: 0.2mm solid #9ca3af;
      padding: 1.6mm 1.4mm;
      vertical-align: top;
      word-break: break-all;
      overflow-wrap: anywhere;
      line-height: 1.35;
    }
    .production-print-table th {
      background: #eef2f7;
      text-align: left;
      font-weight: 700;
    }
    .production-print-table thead {
      display: table-header-group;
    }
    .production-print-table tr {
      page-break-inside: avoid;
    }
    .print-subtext {
      color: #64748b;
      font-size: 7.5pt;
      line-height: 1.35;
    }
    .print-subtext.warning {
      color: #92400e;
    }
    .print-col-index { width: 8mm; }
    .print-col-task { width: 38mm; }
    .print-col-order { width: 28mm; }
    .print-col-customer { width: 29mm; }
    .print-col-date { width: 18mm; }
    .print-col-delivery { width: 18mm; }
    .print-col-part { width: 24mm; }
    .print-col-customer-order { width: 18mm; }
    .print-col-quantity { width: 38mm; }
    .print-col-process { width: 38mm; }
    .print-col-current { width: 20mm; }
    .print-col-status { width: 15mm; }
  </style>
</head>
<body>
  <article class="production-print-page">
    <header class="production-print-header">
      <div>
        <h1>${escapeHtml(printDocumentTitle.value)}</h1>
        <p>${escapeHtml(printScopeText.value)}</p>
      </div>
      <div class="production-print-meta">
        <span>制表日期：${escapeHtml(printDateTime.value)}</span>
        <span>${escapeHtml(printRecordLabel.value)}数量：${printableRowCount.value}</span>
      </div>
    </header>
    ${buildPrintTableHtml()}
  </article>
</body>
</html>`;
}

async function exportExcel() {
  if (productionExporting.value) {
    return;
  }
  if (printableRowCount.value === 0) {
    ElMessage.warning(`当前没有可导出的生产${printRecordLabel.value}`);
    return;
  }

  refreshPrintDateTime();
  productionExporting.value = true;
  try {
    await erpApi.downloadProductionExport(
      {
        ...taskQueryParams(),
        orderNo: viewMode.value === 'TASK_DETAIL' ? selectedProductionOrderNo.value || filters.orderNo : filters.orderNo
      },
      viewMode.value,
      viewMode.value === 'ORDER_SUMMARY' ? activeOrderStatus.value : activeStatus.value,
      `${printDocumentTitle.value}_${formatFileDateTime()}.xlsx`
    );
  } catch (error) {
    console.error(error);
    ElMessage.error(error instanceof Error ? error.message : '生产 Excel 导出失败，请稍后重试');
  } finally {
    productionExporting.value = false;
  }
}

function openPrintPreview() {
  if (printableRowCount.value === 0) {
    ElMessage.warning(`当前没有可打印的生产${printRecordLabel.value}`);
    return;
  }
  refreshPrintDateTime();
  printPreviewVisible.value = true;
}

function printProductionPlan() {
  if (printableRowCount.value === 0) {
    ElMessage.warning(`当前没有可打印的生产${printRecordLabel.value}`);
    return;
  }

  refreshPrintDateTime();
  if (!openPrintHtml(buildProductionPlanDocument())) {
    ElMessage.error('浏览器阻止了打印预览窗口，请允许弹出窗口后重试');
  }
}

watch(
  () => [route.query.orderNo, route.query.view],
  async () => {
    applyProductionRouteScope();
    await queryTasks();
  }
);

watch(
  () => [
    productionWorkTableHeights.orderSummary,
    productionWorkTableHeights.taskDetail,
    productionWorkTableHeights.scrapRecords,
    productionWorkTableHeights.batchStartTasks,
    productionWorkTableHeights.productionNotices,
    productionWorkTableHeights.replenishmentRequests
  ],
  () => saveProductionWorkTableHeights()
);

onMounted(async () => {
  restoreProductionWorkTableHeights();
  applyProductionRouteScope();
  await refreshProductionPage();
});
</script>

<style scoped>
.production-filter {
  align-items: flex-end;
}

.page-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.unit-text {
  margin-left: 8px;
  color: #64748b;
}

.withdraw-quantity-limit {
  margin-left: 8px;
  color: #64748b;
  font-size: 12px;
}

.cell-main {
  color: #0f172a;
  font-weight: 600;
  line-height: 20px;
}

.cell-subtext {
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.cell-subtext.warning,
.print-subtext.warning {
  color: #b45309;
}

.operator-hint {
  margin-left: 10px;
  color: #64748b;
  font-size: 13px;
}

.notice-badge {
  margin-right: 4px;
}

.production-view-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
}

.production-table-height-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.production-order-actions,
.production-task-actions {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.production-order-action-group,
.production-task-action-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  line-height: 20px;
}

.production-order-action-label,
.production-task-action-label {
  flex: 0 0 34px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 20px;
}

.production-order-actions :deep(.el-button),
.production-task-actions :deep(.el-button) {
  margin-left: 0;
  padding: 0;
}

.production-table-height-label {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
}

.production-dialog-table-toolbar {
  display: flex;
  justify-content: flex-end;
  margin: 8px 0;
}

.production-dialog-list-toolbar {
  display: flex;
  justify-content: flex-end;
}

.detail-scope {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: #475569;
  font-size: 14px;
}

.current-order-text {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.order-production-overview {
  display: grid;
  grid-template-columns: minmax(190px, 0.8fr) minmax(360px, 1.5fr) minmax(260px, 1fr);
  align-items: center;
  gap: 18px;
  margin-top: 14px;
  padding: 16px 18px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.order-overview-title,
.order-overview-metrics > div,
.order-overview-progress {
  min-width: 0;
}

.order-overview-title {
  display: grid;
  gap: 4px;
}

.order-overview-title span,
.order-overview-metrics span {
  color: #64748b;
  font-size: 13px;
}

.order-overview-title strong {
  color: #0f172a;
  font-size: 18px;
  line-height: 24px;
}

.order-overview-title small {
  color: #64748b;
  line-height: 18px;
}

.order-overview-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.order-overview-metrics > div {
  display: grid;
  gap: 6px;
}

.order-overview-metrics strong {
  color: #0f172a;
  font-size: 15px;
  line-height: 20px;
  overflow-wrap: anywhere;
}

.order-overview-progress {
  display: grid;
  gap: 10px;
}

.link-button {
  border: 0;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  padding: 0;
}

.link-button.strong-link {
  font-weight: 700;
}

.summary-status-chain {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.summary-status-chain span {
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  font-size: 12px;
  line-height: 20px;
  padding: 0 8px;
}

.batch-start-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin: 14px 0 8px;
  color: #475569;
}

.batch-start-heading > div:first-child {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.batch-start-heading strong {
  color: #0f172a;
}

.batch-start-actions {
  display: flex;
  gap: 8px;
}

.batch-start-height-toolbar {
  display: flex;
  justify-content: flex-end;
}

.batch-task-list {
  display: grid;
  gap: 8px;
  overflow: auto;
  padding-right: 4px;
}

.batch-task-item {
  width: 100%;
  min-height: 58px;
  margin-right: 0;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.batch-task-item :deep(.el-checkbox__label) {
  display: grid;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.batch-task-item :deep(.el-checkbox__label div) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.batch-task-item small {
  color: #64748b;
  white-space: normal;
}

.mobile-start-checkbox {
  flex-shrink: 0;
}

.production-task-header-actions {
  align-items: flex-end;
  flex-direction: column;
  gap: 4px;
}

.mobile-start-checkbox :deep(.el-checkbox__label) {
  color: #2563eb;
  font-weight: 600;
}

.mobile-readonly-note {
  color: #64748b;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}

.empty-production-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.empty-production-hint span {
  min-width: 240px;
  flex: 1;
}

.empty-production-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.notice-list {
  display: grid;
  gap: 10px;
}

.notice-scroll-list {
  display: grid;
  gap: 10px;
  overflow: auto;
  padding-right: 4px;
}

.notice-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}

.notice-filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  align-items: center;
}

.notice-filter-grid :deep(.el-input),
.notice-filter-grid :deep(.el-select),
.notice-filter-grid :deep(.date-range-filter) {
  width: 100%;
}

.production-notice-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 12px;
  color: #64748b;
  font-size: 13px;
}

.production-list-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 12px;
  color: #64748b;
  font-size: 13px;
}

.start-confirm-panel {
  display: grid;
  gap: 14px;
}

.supervisor-form {
  padding: 10px 0 0;
}

.form-help-text {
  width: 100%;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.start-process-list {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.start-process-list span {
  color: #64748b;
  font-size: 12px;
}

.start-process-list strong {
  color: #0f172a;
  font-size: 14px;
  line-height: 20px;
  overflow-wrap: anywhere;
}

.dialog-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.notice-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border: 1px solid #dce3ee;
  border-radius: 8px;
  background: #f8fbff;
}

.notice-item p {
  margin: 6px 0;
  color: #334155;
  line-height: 1.5;
}

.notice-item small {
  display: block;
  color: #60708a;
}

.notice-ack-text {
  margin-top: 2px;
}

.process-operator-list {
  display: grid;
  width: min(100%, 720px);
  gap: 10px;
}

.process-operator-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.process-operator-name {
  overflow: hidden;
  color: #334155;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-operator-select {
  width: 100%;
}

.operator-option {
  display: grid;
  gap: 2px;
  line-height: 1.35;
}

.operator-option strong {
  color: #0f172a;
}

.operator-option span,
.operator-option small {
  color: #64748b;
  font-size: 12px;
}

.batch-process-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}

.batch-process-group .el-checkbox {
  margin-right: 0;
}

.process-help-text {
  width: 100%;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.shortage-panel {
  display: grid;
  gap: 10px;
  margin: 0 0 16px 128px;
  padding: 14px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
}

.warehouse-split-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 16px 128px;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.warehouse-split-panel div {
  display: grid;
  gap: 4px;
}

.warehouse-split-panel span,
.warehouse-split-panel small {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.warehouse-split-panel strong {
  color: #0f172a;
  font-size: 14px;
}

.warehouse-split-panel small {
  grid-column: 1 / -1;
}

.stock-extra {
  color: #b45309;
}

.process-quantity-panel {
  display: grid;
  gap: 10px;
  margin: 0 0 16px 128px;
  padding: 14px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 8px;
}

.quantity-override-confirm {
  display: grid;
  gap: 12px;
}

.quantity-override-confirm p {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.quantity-override-confirm span {
  color: #64748b;
  font-size: 13px;
}

.quantity-override-confirm strong {
  color: #0f172a;
  line-height: 1.6;
  white-space: pre-wrap;
}

.process-step-button {
  border: 0;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease,
    opacity 0.15s ease;
}

.process-step-button:hover {
  color: #1d4ed8;
  background: #dbeafe;
}

.process-step-button.current {
  color: #1d4ed8;
  background: #dbeafe;
}

.process-step-button.completed {
  color: #15803d;
  background: #dcfce7;
}

.process-step-button.locked,
.process-step-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.process-step-button.locked:hover,
.process-step-button:disabled:hover {
  color: #334155;
  background: #f1f5f9;
}

.process-form {
  display: grid;
  gap: 16px;
}

.process-info-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.process-info-grid label {
  display: block;
  margin-bottom: 4px;
  color: #64748b;
  font-size: 12px;
}

.process-info-grid strong {
  display: block;
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawing-preview {
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.drawing-preview-title,
.process-log-title {
  margin-bottom: 10px;
  color: #0f172a;
  font-size: 15px;
  font-weight: 700;
}

.drawing-sheet {
  min-height: 180px;
  padding: 18px;
  background:
    linear-gradient(#eef2f7 1px, transparent 1px),
    linear-gradient(90deg, #eef2f7 1px, transparent 1px),
    #ffffff;
  background-size: 22px 22px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
}

.drawing-file-preview {
  display: grid;
  gap: 10px;
}

.drawing-file-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #64748b;
  font-size: 13px;
}

.drawing-file-toolbar span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawing-file-toolbar :deep(.drawing-preview-button) {
  flex: 0 0 auto;
  color: #2563eb;
  font-size: 13px;
}

.drawing-file-preview img,
.drawing-file-preview iframe,
.drawing-file-empty {
  width: 100%;
  min-height: 260px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
}

.drawing-file-preview img {
  max-height: 420px;
  object-fit: contain;
}

.drawing-file-empty {
  display: grid;
  place-items: center;
  color: #64748b;
  font-size: 14px;
}

.drawing-sheet-part {
  font-size: 20px;
  font-weight: 700;
}

.drawing-sheet-code {
  margin-top: 6px;
  color: #64748b;
}

.drawing-sheet-lines {
  display: grid;
  gap: 12px;
  margin: 24px 0;
}

.drawing-sheet-lines span {
  display: block;
  height: 1px;
  background: #94a3b8;
}

.drawing-sheet-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  color: #334155;
  font-size: 13px;
}

.process-log-panel {
  padding: 14px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.process-log-item {
  padding: 10px 0;
  border-top: 1px solid #eef2f7;
}

.process-log-item:first-of-type {
  border-top: 0;
}

.process-log-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: #334155;
  font-size: 13px;
}

.process-log-meta small {
  color: #94a3b8;
}

.process-log-single {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
}

.process-log-change {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}

.process-log-change p {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 8px;
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
}

.process-log-label {
  color: #334155;
  font-weight: 700;
}

.process-log-text {
  min-width: 0;
  color: #64748b;
  font-weight: 400;
  overflow-wrap: anywhere;
}

.replenishment-request-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.replenishment-request-search {
  width: min(360px, 100%);
  margin-left: auto;
}

.replenishment-request-list {
  display: grid;
  gap: 12px;
  overflow: auto;
  padding-right: 4px;
}

.replenishment-request-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.replenishment-request-main {
  min-width: 0;
}

.replenishment-request-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.replenishment-request-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 18px;
}

.replenishment-request-grid p,
.replenishment-request-reason {
  margin: 0;
  color: #334155;
  line-height: 22px;
}

.replenishment-request-grid span {
  display: block;
  color: #64748b;
  font-size: 12px;
}

.replenishment-request-reason {
  margin-top: 10px;
}

.replenishment-request-item small {
  display: block;
  margin-top: 8px;
  color: #64748b;
}

.replenishment-request-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.print-preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  color: #64748b;
  font-size: 13px;
}

.print-preview-frame {
  max-height: calc(100vh - 230px);
  overflow: auto;
  padding: 18px;
  background: #e2e8f0;
  border-radius: 8px;
}

.production-print-page {
  width: 281mm;
  min-height: 194mm;
  margin: 0 auto;
  padding: 0;
  color: #111827;
  background: #ffffff;
  box-shadow: 0 12px 32px rgb(15 23 42 / 16%);
  font-family: "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
  font-size: 8.5pt;
}

.production-print-header {
  display: flex;
  justify-content: space-between;
  gap: 8mm;
  margin-bottom: 5mm;
  padding-bottom: 3mm;
  border-bottom: 0.3mm solid #111827;
}

.production-print-header h1 {
  margin: 0 0 2mm;
  font-size: 16pt;
  line-height: 1.2;
}

.production-print-header p,
.production-print-meta span {
  margin: 0;
  color: #374151;
  font-size: 8pt;
  line-height: 1.6;
}

.production-print-meta {
  min-width: 42mm;
  text-align: right;
}

.production-print-meta span {
  display: block;
}

.production-print-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}

.production-print-table th,
.production-print-table td {
  padding: 1.6mm 1.4mm;
  vertical-align: top;
  border: 0.2mm solid #9ca3af;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.35;
}

.production-print-table th {
  background: #eef2f7;
  text-align: left;
  font-weight: 700;
}

.print-subtext {
  color: #64748b;
  font-size: 7.5pt;
  line-height: 1.35;
}

.print-col-index {
  width: 8mm;
}

.print-col-task {
  width: 38mm;
}

.print-col-order {
  width: 28mm;
}

.print-col-customer {
  width: 29mm;
}

.print-col-date {
  width: 18mm;
}

.print-col-delivery {
  width: 18mm;
}

.print-col-part {
  width: 24mm;
}

.print-col-customer-order {
  width: 18mm;
}

.print-col-quantity {
  width: 38mm;
}

.print-col-process {
  width: 38mm;
}

.print-col-current {
  width: 20mm;
}

.print-col-status {
  width: 15mm;
}

@media (max-width: 900px) {
  .page-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .dialog-filter-row {
    display: grid;
    grid-template-columns: 1fr;
  }

  .process-info-grid {
    grid-template-columns: 1fr;
  }

  .replenishment-request-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .replenishment-request-toolbar :deep(.el-radio-group) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .replenishment-request-toolbar :deep(.el-radio-button__inner) {
    width: 100%;
    border-left: 1px solid var(--el-border-color);
    border-radius: 4px;
  }

  .replenishment-request-search {
    width: 100%;
    margin-left: 0;
  }

  .replenishment-request-item {
    flex-direction: column;
  }

  .replenishment-request-grid {
    grid-template-columns: 1fr;
  }

  .replenishment-request-actions {
    width: 100%;
    align-items: stretch;
    flex-direction: column;
  }

  .replenishment-request-actions .el-button {
    width: 100%;
  }

  .process-info-grid strong,
  .process-operator-name,
  .drawing-file-toolbar span {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .empty-production-hint span {
    min-width: 0;
  }

  .unit-text {
    display: block;
    margin: 6px 0 0;
  }

  .operator-hint {
    display: block;
    width: 100%;
    margin: 6px 0 0;
  }

  .order-production-overview {
    grid-template-columns: 1fr;
    gap: 14px;
    padding: 14px;
  }

  .order-overview-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .process-operator-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .process-operator-select {
    width: 100%;
  }

  .batch-process-group {
    gap: 8px;
  }

  .batch-process-group .el-checkbox {
    flex: 1 1 128px;
    min-height: 44px;
  }

  .process-step-button {
    min-height: 44px;
    padding: 0 14px;
  }

  .drawing-file-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .drawing-file-toolbar :deep(.drawing-preview-button) {
    align-self: flex-start;
    max-width: 100%;
    white-space: normal;
  }

  .drawing-file-preview img,
  .drawing-file-preview iframe,
  .drawing-file-empty {
    min-height: 190px;
    max-height: 280px;
  }

  .shortage-panel,
  .warehouse-split-panel,
  .process-quantity-panel {
    margin-left: 0;
  }

  .warehouse-split-panel {
    grid-template-columns: 1fr;
  }

  .drawing-sheet {
    min-height: 150px;
  }

  .print-preview-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .print-preview-frame {
    padding: 10px;
  }
}

</style>
