<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">生产任务</h2>
      <div class="page-actions">
        <el-badge :value="pendingNoticeCount" :hidden="pendingNoticeCount === 0" class="notice-badge">
          <el-button :icon="Bell" @click="openNotices">通知</el-button>
        </el-badge>
        <el-button :icon="Document" @click="openScrapRecords">报废统计</el-button>
        <el-button :icon="Download" :disabled="filteredTasks.length === 0" @click="exportExcel">导出 Excel</el-button>
        <el-button :icon="Printer" :disabled="filteredTasks.length === 0" @click="openPrintPreview">打印预览</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="queryTasks">刷新</el-button>
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
        <OrderSelect v-model="filters.orderNo" :orders="orderOptions" placeholder="全部订单" width="320px" @change="queryTasks" />
      </div>

      <el-button type="primary" :loading="loading" @click="queryTasks">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">待生产</div>
        <div class="stat-value">{{ counts.PENDING }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">生产中</div>
        <div class="stat-value">{{ counts.IN_PROGRESS }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">待确认完成</div>
        <div class="stat-value">{{ counts.READY_TO_COMPLETE }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">已完成</div>
        <div class="stat-value">{{ counts.COMPLETED }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">已入库</div>
        <div class="stat-value">{{ counts.RECEIVED }}</div>
      </div>
    </div>

    <el-tabs v-model="activeStatus" class="mt-16">
      <el-tab-pane label="全部" name="ALL" />
      <el-tab-pane label="待生产" name="PENDING" />
      <el-tab-pane label="生产中" name="IN_PROGRESS" />
      <el-tab-pane label="待确认完成" name="READY_TO_COMPLETE" />
      <el-tab-pane label="已完成" name="COMPLETED" />
      <el-tab-pane label="已入库" name="RECEIVED" />
    </el-tabs>

    <div class="table-card desktop-table">
      <el-table v-loading="loading" :data="filteredTasks" max-height="max(300px, calc(100vh - 430px))">
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
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <StatusTag :value="effectiveProductionStatus(row)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button v-if="shouldShowStartAction(row)" link type="primary" @click="start(row)">开始生产</el-button>
            <el-button
              v-else-if="shouldShowConfirmCompletedAction(row)"
              link
              type="success"
              @click="confirmCompletedTask(row)"
            >
              确认完成
            </el-button>
            <el-button v-else-if="shouldShowNextProcessAction(row)" link type="primary" @click="openNextProcess(row)">
              下一道工序
            </el-button>
            <el-button v-else-if="canModifyFinalCompletion(row)" link type="primary" @click="confirmCompletedTask(row)">
              修改完成确认
            </el-button>
            <el-button v-if="canWithdrawProduction(row)" link type="danger" @click="withdrawProduction(row)">
              管理撤回
            </el-button>
            <span v-else-if="effectiveProductionStatus(row) === 'RECEIVED'" class="muted">已入库</span>
            <span v-else-if="effectiveProductionStatus(row) === 'COMPLETED'" class="muted">已完成</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list">
      <article v-for="task in filteredTasks" :key="task.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ task.partName }}</strong>
            <small>{{ task.productionTaskNo }}</small>
            <small v-if="taskRelationText(task)">{{ taskRelationText(task) }}</small>
          </div>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>状态</label>
            <span><StatusTag :value="effectiveProductionStatus(task)" /></span>
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
        </div>
        <div class="mobile-card-actions">
          <el-button v-if="shouldShowStartAction(task)" link type="primary" @click="start(task)">开始生产</el-button>
          <el-button
            v-else-if="shouldShowConfirmCompletedAction(task)"
            link
            type="success"
            @click="confirmCompletedTask(task)"
          >
            确认完成
          </el-button>
          <el-button v-else-if="shouldShowNextProcessAction(task)" link type="primary" @click="openNextProcess(task)">
            下一道工序
          </el-button>
          <el-button v-else-if="canModifyFinalCompletion(task)" link type="primary" @click="confirmCompletedTask(task)">
            修改完成确认
          </el-button>
          <el-button v-if="canWithdrawProduction(task)" link type="danger" @click="withdrawProduction(task)">
            管理撤回
          </el-button>
          <span v-else-if="effectiveProductionStatus(task) === 'RECEIVED'" class="muted">已入库</span>
          <span v-else-if="effectiveProductionStatus(task) === 'COMPLETED'" class="muted">已完成</span>
        </div>
      </article>
      <div v-if="!filteredTasks.length && !loading" class="mobile-empty">暂无生产任务</div>
    </div>

    <el-dialog v-model="noticeVisible" title="生产通知" width="min(760px, calc(100vw - 32px))">
      <div v-loading="noticeLoading" class="notice-list">
        <div v-if="productionNotices.length === 0" class="muted">暂无生产通知</div>
        <article v-for="notice in productionNotices" :key="notice.id" class="notice-item">
          <div>
            <strong>{{ productionNoticeTitle(notice) }}</strong>
            <p>{{ notice.reason }}</p>
            <small>{{ formatDateTime(notice.createdAt) }}</small>
          </div>
          <el-button
            v-if="notice.status === 'PENDING'"
            size="small"
            type="primary"
            @click="acknowledgeNotice(notice)"
          >
            确认已知晓
          </el-button>
          <StatusTag v-else value="COMPLETED" compact />
        </article>
      </div>
      <template #footer>
        <el-button @click="noticeVisible = false">关闭</el-button>
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

    <el-dialog v-model="scrapVisible" title="生产报废统计" width="min(980px, calc(100vw - 32px))">
      <div class="dialog-filter-row">
        <el-input v-model="scrapFilters.orderNo" clearable placeholder="订单号" style="width: 220px" />
        <DateRangeFilter v-model="scrapDateRange" />
        <el-button type="primary" :loading="scrapLoading" @click="loadScrapRecords">查询</el-button>
        <el-button @click="resetScrapFilters">重置</el-button>
      </div>
      <el-table v-loading="scrapLoading" :data="scrapRecords" max-height="520px">
        <el-table-column prop="scrapNo" label="报废记录号" min-width="180" />
        <el-table-column prop="orderNo" label="订单号" min-width="150" />
        <el-table-column prop="productionTaskNo" label="任务号" min-width="210" />
        <el-table-column prop="partCode" label="物料编码" min-width="130" />
        <el-table-column prop="partName" label="物料名称" min-width="150" />
        <el-table-column label="报废数量" min-width="110">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column prop="reason" label="报废原因" min-width="260" show-overflow-tooltip />
        <el-table-column label="日期" min-width="170">
          <template #default="{ row }">{{ formatDateTime(row.recordDate) }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="scrapVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="processVisible"
      :title="processDialogTitle"
      width="min(860px, calc(100vw - 32px))"
    >
      <div v-if="activeTask" class="process-form">
        <div class="process-info-grid">
          <div>
            <label>客户</label>
            <strong>{{ activeTask.customerName }}</strong>
          </div>
          <div>
            <label>订单号</label>
            <strong>{{ activeTask.orderNo }}</strong>
          </div>
          <div>
            <label>产品名称</label>
            <strong>{{ activeTask.partName }}</strong>
          </div>
          <div>
            <label>物料编码</label>
            <strong>{{ activeTask.partCode }}</strong>
          </div>
          <div>
            <label>产品图号</label>
            <strong>{{ activeTask.drawingNo || '-' }}</strong>
          </div>
          <div>
            <label>图纸版本</label>
            <strong>{{ activeTask.drawingVersion || '-' }}</strong>
          </div>
          <div>
            <label>零件厚度</label>
            <strong>{{ activeTask.partThickness ? `${activeTask.partThickness} mm` : '-' }}</strong>
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
              <span>{{ activeTask.drawingFileName || activeTask.drawingFileUrl }}</span>
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
              {{ activeTask.partCode }} / {{ activeTask.drawingNo || '未上传图纸' }} / 版本 {{ activeTask.drawingVersion || '-' }}
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
            title="该生产任务已经入库，工序完成表只能查看，不能再修改。"
            type="info"
            :closable="false"
            class="mt-16"
          />
          <el-form-item :label="`当前工序 ${activeProcessLabel}`" required>
            <el-radio-group v-model="processForm.isCompleted" :disabled="activeProcessReadonly">
              <el-radio-button :label="true">已完成</el-radio-button>
              <el-radio-button :label="false" :disabled="activeTask.status === 'COMPLETED'">未完成</el-radio-button>
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
                {{ processName }}
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
                <el-radio-button label="REPLENISHMENT">生成补单</el-radio-button>
                <el-radio-button label="MANAGER_APPROVED">管理确认缺货完成</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-alert
              v-if="processForm.shortageMode === 'REPLENISHMENT'"
              title="保存后系统会生成补单生产任务，任务号按原任务号顺序追加 R01、R02，并继续链接当前订单号。"
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
                  placeholder="可不填，输入姓名 / 拼音 / 账号ID"
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
              <div class="process-help-text">可多选，也可以不填写；批量确认时每道工序会分别保存自己的操作人员。</div>
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
              <p><span>修改前</span>{{ formatProcessLog(log.beforeSnapshot) }}</p>
              <p><span>修改后</span>{{ formatProcessLog(log.afterSnapshot) }}</p>
            </div>
            <p v-else class="process-log-single">{{ formatProcessLog(log.afterSnapshot) }}</p>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="processVisible = false">取消</el-button>
        <el-button v-if="!activeProcessReadonly" type="primary" :loading="processSaving" @click="saveProcessCompletion">确认完成</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="finalConfirmVisible"
      :title="finalConfirmTitle"
      width="min(720px, calc(100vw - 32px))"
    >
      <div v-if="activeFinalTask" class="final-confirm-panel">
        <div class="process-info-grid">
          <div>
            <label>客户</label>
            <strong>{{ activeFinalTask.customerName }}</strong>
          </div>
          <div>
            <label>订单号</label>
            <strong>{{ activeFinalTask.orderNo }}</strong>
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
            <label>最后工序</label>
            <strong>{{ finalProcessLabel }}</strong>
          </div>
        </div>

        <el-form label-width="128px" class="mt-16">
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
          <div v-if="finalShouldShowShortagePanel" class="shortage-panel">
            <el-alert
              :title="`缺少 ${formatQuantity(finalShortageQuantity, activeFinalTask.unit)}，必须填写报废数量，并选择补单或管理确认缺货完成。`"
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
                <el-radio-button label="REPLENISHMENT">生成补单</el-radio-button>
                <el-radio-button label="MANAGER_APPROVED">管理确认缺货完成</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-alert
              v-if="finalForm.shortageMode === 'REPLENISHMENT'"
              title="保存后系统会生成补单生产任务，任务号按原任务号顺序追加 R01、R02，并继续链接当前订单号。"
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
        <el-button @click="finalConfirmVisible = false">取消</el-button>
        <el-button type="primary" :loading="finalSaving" @click="saveFinalProductionCompletion">
          {{ activeFinalTask?.status === 'COMPLETED' ? '保存修改' : '确认完成' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="withdrawVisible"
      title="管理撤回"
      width="min(720px, calc(100vw - 32px))"
    >
      <div v-if="activeWithdrawTask" class="withdraw-panel">
        <div class="process-info-grid">
          <div>
            <label>订单号</label>
            <strong>{{ activeWithdrawTask.orderNo }}</strong>
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
          title="撤回会清空当前任务的工序完成记录并退回待生产。请选择已经做出的零件转库存、报废，或确认无实物处理。保存前可以反复修改本表单，确认后再提交。"
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
              <el-radio-button label="STOCK">零件入库存</el-radio-button>
              <el-radio-button label="SCRAP">零件报废</el-radio-button>
              <el-radio-button label="NONE">无实物处理</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="处理数量" required>
            <el-input-number
              v-model="withdrawForm.handlingQuantity"
              :min="0"
              :precision="3"
              :controls="false"
              :disabled="withdrawForm.handlingMode === 'NONE'"
              style="width: 180px"
            />
            <span class="unit-text">{{ activeWithdrawTask.unit }}</span>
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
        <el-button @click="withdrawVisible = false">取消</el-button>
        <el-button type="danger" :loading="withdrawSaving" @click="saveWithdrawProduction">确认撤回</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="printPreviewVisible"
      title="生产计划表打印预览"
      width="min(1220px, calc(100vw - 24px))"
      top="3vh"
    >
      <div class="print-preview-toolbar">
        <span>A4 横版，建议页边距 8mm，当前按 {{ filteredTasks.length }} 条任务预览。</span>
        <el-button type="primary" :icon="Printer" @click="printProductionPlan">打印</el-button>
      </div>
      <div class="print-preview-frame">
        <article class="production-print-page">
          <header class="production-print-header">
            <div>
              <h1>生产计划表</h1>
              <p>{{ printScopeText }}</p>
            </div>
            <div class="production-print-meta">
              <span>制表日期：{{ printDateTime }}</span>
              <span>任务数量：{{ filteredTasks.length }}</span>
            </div>
          </header>

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
                <td>{{ productionStatusLabel(effectiveProductionStatus(row)) }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
      <template #footer>
        <el-button @click="printPreviewVisible = false">关闭</el-button>
        <el-button type="primary" :icon="Printer" @click="printProductionPlan">打印</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Bell, Document, Download, Printer, Refresh } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import DrawingPreviewLink from '../components/DrawingPreviewLink.vue';
import NoticeAcknowledgeDialog from '../components/NoticeAcknowledgeDialog.vue';
import OrderSelect from '../components/OrderSelect.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import type {
  Customer,
  OrderSummary,
  ProductionNotice,
  ProductionOperator,
  ProductionProcessCompletion,
  ProductionScrapRecord,
  ProductionShortageMode,
  ProductionStatus,
  ProductionTask
} from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';
import { downloadHtmlAsExcel, escapeHtml, formatFileDateTime, openPrintHtml } from '../utils/tableExport';

type ProductionDisplayStatus = ProductionStatus | 'READY_TO_COMPLETE' | 'RECEIVED';

const customers = ref<Customer[]>([]);
const orderOptions = ref<OrderSummary[]>([]);
const tasks = ref<ProductionTask[]>([]);
const dateRange = ref<string[]>([]);
const loading = ref(false);
const noticeVisible = ref(false);
const noticeLoading = ref(false);
const acknowledgeVisible = ref(false);
const acknowledgeSaving = ref(false);
const productionNotices = ref<ProductionNotice[]>([]);
const activeProductionNotice = ref<ProductionNotice>();
const scrapVisible = ref(false);
const scrapLoading = ref(false);
const scrapRecords = ref<ProductionScrapRecord[]>([]);
const scrapDateRange = ref<string[]>([]);
const processVisible = ref(false);
const processSaving = ref(false);
const finalConfirmVisible = ref(false);
const finalSaving = ref(false);
const withdrawVisible = ref(false);
const withdrawSaving = ref(false);
const printPreviewVisible = ref(false);
const activeTask = ref<ProductionTask>();
const activeFinalTask = ref<ProductionTask>();
const activeWithdrawTask = ref<ProductionTask>();
const activeProcessName = ref('');
const batchProcessNames = ref<string[]>([]);
const processOperatorCodes = reactive<Record<string, string[]>>({});
const finalOperatorScope = 'final';
const operatorLoadingByScope = reactive<Record<string, boolean>>({});
const operatorOptionsByScope = reactive<Record<string, ProductionOperator[]>>({});
const operatorKeywordByScope = reactive<Record<string, string>>({});
const activeStatus = ref<ProductionDisplayStatus | 'ALL'>('ALL');
const printDateTime = ref('');
let operatorSearchRequestSequence = 0;
const operatorSearchRequestByScope = reactive<Record<string, number>>({});

const filters = reactive<{
  customerId?: string;
  orderNo?: string;
}>({});

const scrapFilters = reactive<{
  orderNo?: string;
}>({});

const processForm = reactive({
  isCompleted: true,
  completedQuantity: 1,
  scrapQuantity: 0,
  shortageMode: 'REPLENISHMENT' as ProductionShortageMode,
  managerName: '',
  shortageReason: '',
  quantityOverrideReason: '',
  remark: ''
});

const finalForm = reactive({
  completedQuantity: 1,
  operatorCodes: [] as string[],
  scrapQuantity: 0,
  shortageMode: 'REPLENISHMENT' as ProductionShortageMode,
  managerName: '',
  shortageReason: '',
  remark: ''
});

const withdrawForm = reactive({
  managerName: '',
  reason: '',
  handledAt: new Date() as Date | undefined,
  handlingMode: 'STOCK' as 'STOCK' | 'SCRAP' | 'NONE',
  handlingQuantity: 0,
  remark: ''
});

const fallbackOperatorOptions: ProductionOperator[] = [
  { code: 'OP-001', accountId: 'OP-001', name: '张明', role: '冲压操作员', pinyin: 'zhangming', pinyinInitials: 'zm', keywords: ['zhang', 'ming', 'zm', '冲压'] },
  { code: 'OP-002', accountId: 'OP-002', name: '李强', role: '激光切割操作员', pinyin: 'liqiang', pinyinInitials: 'lq', keywords: ['li', 'qiang', 'lq', '激光', '切割'] },
  { code: 'OP-003', accountId: 'OP-003', name: '王磊', role: '焊接操作员', pinyin: 'wanglei', pinyinInitials: 'wl', keywords: ['wang', 'lei', 'wl', '焊接'] },
  { code: 'OP-004', accountId: 'OP-004', name: '赵敏', role: '包装操作员', pinyin: 'zhaomin', pinyinInitials: 'zm', keywords: ['zhao', 'min', 'zm', '包装'] },
  { code: 'OP-005', accountId: 'OP-005', name: '顾胜钧', role: '折弯操作员', pinyin: 'gushengjun', pinyinInitials: 'gsj', keywords: ['gu', 'sheng', 'jun', 'gs', 'gsj', '折弯'], idCardMasked: '3204********1234' }
];
const operatorOptions = ref<ProductionOperator[]>([...fallbackOperatorOptions]);
const operatorCache = reactive<Record<string, ProductionOperator>>({});

const counts = computed(() => ({
  PENDING: tasks.value.filter((task) => effectiveProductionStatus(task) === 'PENDING').length,
  IN_PROGRESS: tasks.value.filter((task) => effectiveProductionStatus(task) === 'IN_PROGRESS').length,
  READY_TO_COMPLETE: tasks.value.filter((task) => effectiveProductionStatus(task) === 'READY_TO_COMPLETE').length,
  COMPLETED: tasks.value.filter((task) => effectiveProductionStatus(task) === 'COMPLETED').length,
  RECEIVED: tasks.value.filter((task) => effectiveProductionStatus(task) === 'RECEIVED').length
}));
const pendingNoticeCount = computed(() => productionNotices.value.filter((notice) => notice.status === 'PENDING').length);

const filteredTasks = computed(() => {
  if (activeStatus.value === 'ALL') {
    return tasks.value;
  }
  return tasks.value.filter((task) => effectiveProductionStatus(task) === activeStatus.value);
});

const activeStatusLabel = computed(() => {
  if (activeStatus.value === 'ALL') {
    return '全部';
  }
  return productionStatusLabel(activeStatus.value);
});

const printScopeText = computed(() => {
  const customerName = customers.value.find((item) => item.id === filters.customerId)?.customerName || '全部客户';
  const orderNo = filters.orderNo || '全部订单';
  const dateText = dateRange.value.length === 2 ? `${dateRange.value[0]} 至 ${dateRange.value[1]}` : '全部订单日期';
  return `客户：${customerName} | 订单日期：${dateText} | 订单：${orderNo} | 状态：${activeStatusLabel.value}`;
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

const finalOperatorOptionRows = computed(() => operatorOptionRowsWithSelectedCodes(finalForm.operatorCodes, finalOperatorScope));

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
const activeProcessReadonly = computed(() => Boolean(activeTask.value?.inventoryBatchNo));

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
    Number(processForm.completedQuantity || 0) > activeExpectedProcessQuantity.value &&
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
  return roundQuantity(activeTask.value.plannedQuantity - Number(processForm.completedQuantity || 0));
});

const shouldShowShortagePanel = computed(() => false);

const finalShortageQuantity = computed(() => {
  if (!activeFinalTask.value) {
    return 0;
  }
  return Math.max(roundQuantity(activeFinalTask.value.plannedQuantity - Number(finalForm.completedQuantity || 0)), 0);
});

const finalOverageQuantity = computed(() => {
  if (!activeFinalTask.value) {
    return 0;
  }
  return Math.max(roundQuantity(Number(finalForm.completedQuantity || 0) - activeFinalTask.value.plannedQuantity), 0);
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

async function loadCustomers() {
  customers.value = await erpApi.customers();
}

async function loadOperators() {
  try {
    const operators = await erpApi.productionOperators();
    setOperatorOptions(operators.length > 0 ? operators : [...fallbackOperatorOptions]);
  } catch {
    setOperatorOptions([...fallbackOperatorOptions]);
  }
}

async function loadOrderOptions() {
  orderOptions.value = await erpApi.orders({
    customerId: filters.customerId,
    dateFrom: dateRange.value[0],
    dateTo: dateRange.value[1]
  });

  if (filters.orderNo && !orderOptions.value.some((item) => item.orderNo === filters.orderNo)) {
    filters.orderNo = undefined;
  }
}

async function loadTasks() {
  // 生产任务按客户、订单日期和订单号过滤，避免任务列表混在一起难以操作。
  tasks.value = await erpApi.productionTasks(taskQueryParams());
}

async function loadProductionNotices() {
  noticeLoading.value = true;
  try {
    productionNotices.value = await erpApi.productionNotices(undefined, 'PRODUCTION');
  } finally {
    noticeLoading.value = false;
  }
}

async function openNotices() {
  noticeVisible.value = true;
  await loadProductionNotices();
}

async function loadScrapRecords() {
  scrapLoading.value = true;
  try {
    scrapRecords.value = await erpApi.productionScrapRecords({
      orderNo: scrapFilters.orderNo?.trim() || undefined,
      dateFrom: scrapDateRange.value[0],
      dateTo: scrapDateRange.value[1]
    });
  } finally {
    scrapLoading.value = false;
  }
}

async function openScrapRecords() {
  scrapVisible.value = true;
  await loadScrapRecords();
}

async function resetScrapFilters() {
  scrapFilters.orderNo = undefined;
  scrapDateRange.value = [];
  await loadScrapRecords();
}

async function queryTasks() {
  loading.value = true;
  try {
    await loadOrderOptions();
    await loadTasks();
    await loadProductionNotices();
  } finally {
    loading.value = false;
  }
}

async function handleScopeChange() {
  filters.orderNo = undefined;
  await queryTasks();
}

async function resetFilters() {
  filters.customerId = undefined;
  filters.orderNo = undefined;
  dateRange.value = [];
  activeStatus.value = 'ALL';
  await queryTasks();
}

function productionNoticeTitle(notice: ProductionNotice) {
  const quantityText =
    notice.deltaQuantity && notice.unit ? `，变化 ${formatQuantity(Math.abs(notice.deltaQuantity), notice.unit)}` : '';
  const partText = [notice.orderNo, notice.partCode, notice.partName].filter(Boolean).join(' / ');
  const typeMap: Record<string, string> = {
    QUANTITY_INCREASE: '客户数量增加',
    QUANTITY_DECREASE: '客户数量减少',
    ORDER_CANCELLED: '客户取消物料',
    MATERIAL_ADDED: '客户新增物料',
    TASK_WITHDRAWN: '管理撤回'
  };
  return `${typeMap[notice.noticeType] || notice.noticeType}：${partText}${quantityText}`;
}

function acknowledgeNotice(notice: ProductionNotice) {
  activeProductionNotice.value = notice;
  acknowledgeVisible.value = true;
}

async function saveNoticeAcknowledge(acknowledgedBy: string) {
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

async function start(row: ProductionTask) {
  try {
    await erpApi.startProduction(row.id);
    ElMessage.success('已开始生产');
    await loadTasks();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '开始生产失败');
  }
}

function withdrawProduction(row: ProductionTask) {
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

async function saveWithdrawProduction() {
  const task = activeWithdrawTask.value;
  if (!task) {
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
  } else if (!withdrawForm.handlingQuantity || withdrawForm.handlingQuantity <= 0) {
    ElMessage.warning('零件入库存或报废时，处理数量必须大于 0');
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

function processStepDisplay(row: ProductionTask, processName: string) {
  const remark = row.processStepDetails?.find((item) => item.processName === processName)?.processRemark?.trim();
  return remark ? `${processName}（${remark}）` : processName;
}

function expectedProcessQuantity(row: ProductionTask, processName: string) {
  const activeIndex = row.processSteps.indexOf(processName);
  if (activeIndex <= 0) {
    return Number(row.plannedQuantity || 0);
  }
  const previousProcessName = row.processSteps[activeIndex - 1];
  const previousCompletion = getProcessCompletion(row, previousProcessName);
  if (!previousCompletion?.isCompleted) {
    return Number(row.plannedQuantity || 0);
  }
  return Number(previousCompletion.completedQuantity || 0);
}

function isProcessCompleted(row: ProductionTask, processName: string) {
  return row.status === 'COMPLETED' || Boolean(getProcessCompletion(row, processName)?.isCompleted);
}

function isAllProcessConfirmed(row: ProductionTask) {
  return row.status === 'COMPLETED' || (row.processSteps.length > 0 && row.processSteps.every((step) => Boolean(getProcessCompletion(row, step)?.isCompleted)));
}

function effectiveProductionStatus(row: ProductionTask): ProductionDisplayStatus {
  if (row.inventoryBatchNo) {
    return 'RECEIVED';
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
  return row.status !== 'COMPLETED' && nextIncompleteProcess(row) === processName;
}

function isFinalProcess(row: ProductionTask, processName: string) {
  return row.processSteps[row.processSteps.length - 1] === processName;
}

function shouldShowConfirmCompletedAction(row: ProductionTask) {
  // 工序走完后必须先进入“待确认完成”，由操作人员再填写最终完成数量。
  return effectiveProductionStatus(row) === 'READY_TO_COMPLETE';
}

function shouldShowStartAction(row: ProductionTask) {
  // 操作入口必须按有效状态判断；已入库历史任务即使原始 status 异常，也不能再次开始生产。
  return effectiveProductionStatus(row) === 'PENDING';
}

function shouldShowNextProcessAction(row: ProductionTask) {
  return effectiveProductionStatus(row) === 'IN_PROGRESS' && Boolean(nextIncompleteProcess(row));
}

function canModifyFinalCompletion(row: ProductionTask) {
  // 已经入库的生产任务不能再改最终完成数量，否则会和库存批次数量不一致。
  return row.status === 'COMPLETED' && !row.inventoryBatchNo;
}

function canWithdrawProduction(row: ProductionTask) {
  return !row.inventoryBatchNo && row.status !== 'PENDING';
}

function defaultWithdrawHandlingQuantity(row: ProductionTask) {
  const processQuantity = Math.max(0, ...(row.processCompletions || []).map((item) => Number(item.completedQuantity || 0)));
  return row.completedQuantity > 0 ? row.completedQuantity : processQuantity;
}

function handleWithdrawModeChange() {
  if (withdrawForm.handlingMode === 'NONE') {
    withdrawForm.handlingQuantity = 0;
  } else if (withdrawForm.handlingQuantity <= 0 && activeWithdrawTask.value) {
    withdrawForm.handlingQuantity = defaultWithdrawHandlingQuantity(activeWithdrawTask.value) || 1;
  }
}

function canOpenProcess(row: ProductionTask, processName: string) {
  if (row.inventoryBatchNo) {
    return isProcessCompleted(row, processName);
  }
  if (effectiveProductionStatus(row) === 'PENDING') {
    return false;
  }
  return row.status === 'COMPLETED' || isProcessCompleted(row, processName) || isCurrentProcess(row, processName);
}

function processButtonTitle(row: ProductionTask, processName: string) {
  if (row.inventoryBatchNo) {
    return isProcessCompleted(row, processName) ? '已入库，只能查看工序记录' : '已入库，不能新增工序记录';
  }
  if (effectiveProductionStatus(row) === 'PENDING') {
    return '请先开始生产';
  }
  if (!canOpenProcess(row, processName)) {
    return '请先完成上一道工序';
  }
  return isProcessCompleted(row, processName) ? '查看或修改工序完成记录' : '填写当前工序完成表';
}

function openNextProcess(row: ProductionTask) {
  const processName = nextIncompleteProcess(row);
  if (!processName) {
    ElMessage.info('所有工序已确认完成');
    return;
  }
  openProcessCompletion(row, processName);
}

function openProcessCompletion(row: ProductionTask, processName: string) {
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
  processForm.scrapQuantity = completion?.scrapQuantity || 0;
  processForm.shortageMode = completion?.shortageMode || 'REPLENISHMENT';
  processForm.managerName = completion?.managerName || '';
  processForm.shortageReason = completion?.shortageReason || '';
  processForm.quantityOverrideReason = completion?.quantityOverrideReason || '';
  processForm.remark = completion?.remark || '';
  batchProcessNames.value = [processName];
  resetProcessOperatorCodes();
  syncProcessOperatorRows();
  processVisible.value = true;
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
      setOperatorOptionsForScope(scope, keyword.trim() ? [] : [...fallbackOperatorOptions]);
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
  try {
    await ElMessageBox.confirm(processQuantityWarningText.value, '数量确认', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '返回修改'
    });
    return true;
  } catch {
    return false;
  }
}

function buildShortagePayloadFromForm() {
  if (!shouldShowShortagePanel.value) {
    return {};
  }
  return {
    scrapQuantity: Number(processForm.scrapQuantity),
    shortageMode: processForm.shortageMode,
    createReplenishment: processForm.shortageMode === 'REPLENISHMENT',
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
  if (!isAllProcessConfirmed(row)) {
    ElMessage.warning('请先确认所有生产工序');
    return;
  }

  const finalCompletion = finalProcessCompletion(row);
  activeFinalTask.value = row;
  finalForm.completedQuantity = finalCompletion?.completedQuantity || row.completedQuantity || row.plannedQuantity;
  finalForm.operatorCodes = operatorCodesFromCompletion(finalCompletion);
  finalForm.scrapQuantity = finalCompletion?.scrapQuantity || 0;
  finalForm.shortageMode = finalCompletion?.shortageMode || 'REPLENISHMENT';
  finalForm.managerName = finalCompletion?.managerName || '';
  finalForm.shortageReason = finalCompletion?.shortageReason || '';
  finalForm.remark = finalCompletion?.remark || row.remark || '';
  finalConfirmVisible.value = true;
}

function validateFinalCompletion() {
  if (!activeFinalTask.value) {
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
    createReplenishment: finalForm.shortageMode === 'REPLENISHMENT',
    managerName: finalForm.shortageMode === 'MANAGER_APPROVED' ? finalForm.managerName.trim() : undefined,
    shortageReason: finalForm.shortageMode === 'MANAGER_APPROVED' ? finalForm.shortageReason.trim() : undefined
  };
}

async function saveFinalProductionCompletion() {
  if (!activeFinalTask.value || !validateFinalCompletion()) {
    return;
  }

  finalSaving.value = true;
  try {
    await erpApi.completeProduction(activeFinalTask.value.id, {
      completedQuantity: finalForm.completedQuantity,
      operatorCodes: cleanOperatorCodes(finalForm.operatorCodes),
      ...buildFinalShortagePayload(),
      remark: finalForm.remark || undefined
    });
    ElMessage.success(activeFinalTask.value.status === 'COMPLETED' ? '生产完成确认已修改' : '生产已确认完成，请到仓库确认入库');
    finalConfirmVisible.value = false;
    await loadTasks();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '确认生产完成失败');
  } finally {
    finalSaving.value = false;
  }
}

async function saveProcessCompletion() {
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
      ElMessage.success(`${selectedProcessNames.join('、')}已保存`);
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
    await loadTasks();
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
    PENDING: '待生产',
    IN_PROGRESS: '生产中',
    READY_TO_COMPLETE: '待确认完成',
    COMPLETED: '已完成',
    RECEIVED: '已入库'
  };
  return labels[status] || status;
}

function formatProcessSteps(row: ProductionTask) {
  return row.processSteps.length > 0 ? row.processSteps.map((step) => processStepDisplay(row, step)).join('、') : '-';
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
  return formatQuantity(row.customerOrderQuantity || row.plannedQuantity, row.unit);
}

function formatCompletedPlan(row: ProductionTask) {
  return `${formatCompletedQuantity(row)} / ${formatQuantity(row.plannedQuantity, row.unit)}`;
}

function finalProcessCompletion(row: ProductionTask) {
  const finalProcessName = row.processSteps[row.processSteps.length - 1];
  return finalProcessName ? getProcessCompletion(row, finalProcessName) : undefined;
}

function taskRelationText(row: ProductionTask) {
  if (row.isReplenishment && row.sourceProductionTaskNo) {
    return `补单来源：${row.sourceProductionTaskNo}`;
  }
  if (row.isReplenishment) {
    return '补单任务';
  }
  return '';
}

function shortageSummary(row: ProductionTask) {
  const completion = finalProcessCompletion(row);
  if (!completion || !completion.shortageQuantity || completion.shortageQuantity <= 0) {
    return '';
  }

  const shortage = formatQuantity(completion.shortageQuantity, row.unit);
  const scrap = formatQuantity(completion.scrapQuantity || 0, row.unit);
  if (completion.shortageMode === 'REPLENISHMENT') {
    return `缺 ${shortage}，报废 ${scrap}，补单 ${completion.replenishmentTaskNo || '-'}`;
  }

  return `缺 ${shortage}，报废 ${scrap}，${completion.managerName || '-'}确认：${completion.shortageReason || '-'}`;
}

function drawingHref(url?: string) {
  return url || '';
}

function isImageDrawing(url?: string) {
  return Boolean(url && /\.(png|jpe?g|webp)$/i.test(url));
}

function isPdfDrawing(url?: string) {
  return Boolean(url && /\.pdf$/i.test(url));
}

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatProcessLog(snapshot?: Record<string, unknown> | null) {
  if (!snapshot) {
    return '-';
  }
  const status = snapshot.isCompleted ? '已完成' : '未完成';
  const quantity = formatQuantity(Number(snapshot.completedQuantity || 0), String(snapshot.unit || '件'));
  const role = snapshot.operatorRole ? ` / ${snapshot.operatorRole}` : '';
  const completedAt = snapshot.completedAt ? `，时间 ${formatDateTime(String(snapshot.completedAt))}` : '';
  const shortageQuantity = Number(snapshot.shortageQuantity || 0);
  const shortageMode = snapshot.shortageMode === 'REPLENISHMENT' ? '生成补单' : '管理确认缺货完成';
  const replenishmentTaskNo = snapshot.replenishmentTaskNo ? `，补单任务 ${snapshot.replenishmentTaskNo}` : '';
  const manager = snapshot.managerName ? `，确认主管 ${snapshot.managerName}` : '';
  const reason = snapshot.shortageReason ? `，缺货理由 ${snapshot.shortageReason}` : '';
  const shortage =
    shortageQuantity > 0
      ? `，缺少 ${formatQuantity(shortageQuantity, String(snapshot.unit || '件'))}，报废 ${formatQuantity(
          Number(snapshot.scrapQuantity || 0),
          String(snapshot.unit || '件')
        )}，处理 ${shortageMode}${replenishmentTaskNo}${manager}${reason}`
      : '';
  const quantityOverrideReason = snapshot.quantityOverrideReason ? `，数量原因 ${snapshot.quantityOverrideReason}` : '';
  const remark = snapshot.remark ? `，备注 ${snapshot.remark}` : '';
  return `${status}，数量 ${quantity}，操作人员 ${snapshot.operatorName || '-'}${role}${completedAt}${shortage}${quantityOverrideReason}${remark}`;
}

function refreshPrintDateTime() {
  printDateTime.value = new Date().toLocaleString('zh-CN', { hour12: false });
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
    status: productionStatusLabel(effectiveProductionStatus(task))
  }));
}

function buildPrintTableHtml() {
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
          <th>状态</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
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
  <title>生产计划表</title>
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
    .print-col-process { width: 47mm; }
    .print-col-status { width: 15mm; }
  </style>
</head>
<body>
  <article class="production-print-page">
    <header class="production-print-header">
      <div>
        <h1>生产计划表</h1>
        <p>${escapeHtml(printScopeText.value)}</p>
      </div>
      <div class="production-print-meta">
        <span>制表日期：${escapeHtml(printDateTime.value)}</span>
        <span>任务数量：${filteredTasks.value.length}</span>
      </div>
    </header>
    ${buildPrintTableHtml()}
  </article>
</body>
</html>`;
}

function exportExcel() {
  if (filteredTasks.value.length === 0) {
    ElMessage.warning('当前没有可导出的生产任务');
    return;
  }

  refreshPrintDateTime();
  const documentHtml = buildProductionPlanDocument();
  downloadHtmlAsExcel(documentHtml, `生产计划表_${formatFileDateTime()}.xls`);
}

function openPrintPreview() {
  if (filteredTasks.value.length === 0) {
    ElMessage.warning('当前没有可打印的生产任务');
    return;
  }
  refreshPrintDateTime();
  printPreviewVisible.value = true;
}

function printProductionPlan() {
  if (filteredTasks.value.length === 0) {
    ElMessage.warning('当前没有可打印的生产任务');
    return;
  }

  refreshPrintDateTime();
  if (!openPrintHtml(buildProductionPlanDocument())) {
    ElMessage.error('浏览器阻止了打印预览窗口，请允许弹出窗口后重试');
  }
}

onMounted(async () => {
  await loadCustomers();
  await loadOperators();
  await queryTasks();
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

.notice-list {
  display: grid;
  gap: 10px;
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
  color: #60708a;
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

.process-quantity-panel {
  display: grid;
  gap: 10px;
  margin: 0 0 16px 128px;
  padding: 14px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 8px;
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

.process-log-change span {
  color: #334155;
  font-weight: 700;
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
  width: 47mm;
}

.print-col-status {
  width: 15mm;
}

@media (max-width: 900px) {
  .page-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .process-info-grid {
    grid-template-columns: 1fr;
  }

  .operator-hint {
    display: block;
    width: 100%;
    margin: 6px 0 0;
  }

  .process-operator-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .shortage-panel,
  .process-quantity-panel {
    margin-left: 0;
  }

  .drawing-sheet {
    min-height: 150px;
  }

  .print-preview-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
}

</style>
