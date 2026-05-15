<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">每个零件的生产流程选择</h2>
      <div class="process-actions">
        <el-tooltip :disabled="!orderDetailDisabledReason" :content="orderDetailDisabledReason" placement="bottom">
          <span class="action-tooltip-wrap">
            <el-button :disabled="!order" @click="goOrderDetail">查看订单明细</el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="!processSaveDisabledReason" :content="processSaveDisabledReason" placement="bottom">
          <span class="action-tooltip-wrap">
            <el-button v-if="!isMobileLayout" :disabled="saving || !selectedLine || !canEditProcess" :loading="saving" @click="saveAndNext">保存并下一个</el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="!processSaveDisabledReason" :content="processSaveDisabledReason" placement="bottom">
          <span class="action-tooltip-wrap">
            <el-button v-if="!isMobileLayout" type="primary" :disabled="saving || !selectedLine || !canEditProcess" :loading="saving" @click="saveProcess">保存零件流程</el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="!submitOrderDisabledReason" :content="submitOrderDisabledReason" placement="bottom">
          <span class="action-tooltip-wrap">
            <el-button v-if="!isMobileLayout" type="success" :disabled="submitting || !canSubmitOrder" :loading="submitting" @click="openSubmitOrderDialog">
              提交生产
            </el-button>
          </span>
        </el-tooltip>
        <span v-if="isMobileLayout" class="mobile-readonly-note">手机端只查看流程配置</span>
      </div>
    </div>

    <div class="filter-bar process-filter">
      <div class="filter-field">
        <label>订单日期</label>
        <DateRangeFilter v-model="orderDateRange" @change="handleDateChange" />
      </div>

      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect
          v-model="selectedCustomerId"
          placeholder="全部客户"
          width="260px"
          @change="handleCustomerChange"
        />
      </div>

      <div class="filter-field">
        <label>订单</label>
        <OrderSelect
          v-model="filterOrderNo"
          :orders="orderOptions"
          placeholder="可选订单"
          width="320px"
          :disabled="orderOptions.length === 0"
        />
      </div>

      <el-button type="primary" :loading="ordersLoading" @click="queryOrders">查询订单</el-button>
    </div>

    <el-empty v-if="ordersLoaded && orders.length === 0" description="当前条件没有订单" />

    <div v-else-if="!order" v-loading="ordersLoading" class="process-order-list">
      <div class="order-list-note">
        <strong>当前条件订单</strong>
        <span>可先按订单日期筛选全部客户订单，再按客户或订单继续缩小范围。</span>
      </div>

      <div class="table-card desktop-table">
        <el-table :data="orders" max-height="calc(100vh - 330px)">
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
          <el-table-column label="订单状态" width="170">
            <template #default="{ row }">
              <StatusTag :value="orderDisplayStatus(row)" />
            </template>
          </el-table-column>
          <el-table-column label="生产状态" width="130">
            <template #default="{ row }">
              <StatusTag :value="orderProductionStatusValue(row)" :label-override="orderProductionStatusLabel(row)" compact />
            </template>
          </el-table-column>
          <el-table-column label="待补单" min-width="170">
            <template #default="{ row }">
              <el-button v-if="orderNeedsShortageAttention(row)" link type="warning" @click="goOrderShortageDetail(row)">
                {{ orderShortageActionText(row) }}
              </el-button>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="selectOrderFromList(row.orderNo)">{{ processEntryActionText(row) }}</el-button>
              <el-button link type="primary" @click="goOrderSummaryDetail(row.orderNo)">订单明细</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="mobile-card-list">
        <article
          v-for="item in orders"
          :key="item.id"
          class="mobile-card mobile-order-card"
          :class="{ expanded: isMobileOrderExpanded(item.id) }"
        >
          <div class="mobile-card-header">
            <div class="mobile-card-title">
              <strong>
                <OrderNoLink :order-no="item.orderNo" />
              </strong>
              <small>{{ item.customerName }}</small>
            </div>
            <div class="mobile-card-header-actions">
              <StatusTag :value="orderDisplayStatus(item)" compact />
              <el-button link type="primary" @click.stop="toggleMobileOrderCard(item.id)">
                {{ isMobileOrderExpanded(item.id) ? '收起' : '详情' }}
              </el-button>
            </div>
          </div>
          <div class="mobile-card-compact-summary">
            <span>交期 {{ formatDate(item.deliveryDate) }}</span>
            <span>零件 {{ item.partCount }} 个</span>
            <span>{{ formatOrderQuantity(item, 'totalProductionPlanQuantity') }}</span>
          </div>
          <div v-show="isMobileOrderExpanded(item.id)" class="mobile-card-fields">
            <div class="mobile-field">
              <label>订单状态</label>
              <span><StatusTag :value="orderDisplayStatus(item)" compact /></span>
            </div>
            <div class="mobile-field">
              <label>生产状态</label>
              <span><StatusTag :value="orderProductionStatusValue(item)" :label-override="orderProductionStatusLabel(item)" compact /></span>
            </div>
            <div class="mobile-field">
              <label>订单日期</label>
              <span>{{ formatDate(item.orderDate) }}</span>
            </div>
            <div class="mobile-field">
              <label>交期</label>
              <span>{{ formatDate(item.deliveryDate) }}</span>
            </div>
            <div class="mobile-field">
              <label>零件数</label>
              <span>{{ item.partCount }} 个</span>
            </div>
            <div class="mobile-field">
              <label>客户订单数量</label>
              <span>{{ formatOrderQuantity(item, 'totalQuantity') }}</span>
            </div>
            <div class="mobile-field">
              <label>生产计划数量</label>
              <span>{{ formatOrderQuantity(item, 'totalProductionPlanQuantity') }}</span>
            </div>
            <div v-if="orderNeedsShortageAttention(item)" class="mobile-field mobile-full warning">
              <label>待补单</label>
              <span>{{ orderShortageActionText(item) }}</span>
            </div>
          </div>
          <div class="mobile-card-actions">
            <el-button link type="primary" @click="selectOrderFromList(item.orderNo)">查看流程</el-button>
            <el-button link type="primary" @click="goOrderSummaryDetail(item.orderNo)">订单明细</el-button>
            <el-button v-if="orderNeedsShortageAttention(item) && !isMobileLayout" link type="warning" @click="goOrderShortageDetail(item)">
              处理补单
            </el-button>
            <span v-if="orderNeedsShortageAttention(item) && isMobileLayout" class="mobile-readonly-note">手机端只查看补单状态</span>
          </div>
        </article>
      </div>
    </div>

    <div v-else-if="order" v-loading="loading" class="process-layout">
      <div class="panel parts-panel">
        <div class="process-summary">
          <div>
            <span class="summary-label">客户</span>
            <strong>{{ order.customerName }}</strong>
          </div>
          <div>
          <span class="summary-label">订单状态</span>
          <StatusTag :value="orderDisplayStatus(order)" />
        </div>
          <div>
            <span class="summary-label">零件流程配置进度</span>
            <el-progress :percentage="processPercent" :stroke-width="8" />
          </div>
          <p v-if="missingLineNames.length" class="missing-text">未配置：{{ missingLineNames.join('、') }}</p>
          <p v-if="missingStockSourceLineNames.length" class="missing-text">库存未核对：{{ missingStockSourceLineNames.join('、') }}</p>
          <p v-if="insufficientReworkSourceLineNames.length" class="missing-text">库存再加工未补齐：{{ insufficientReworkSourceLineNames.join('、') }}</p>
          <p v-if="!missingLineNames.length && !missingStockSourceLineNames.length && !insufficientReworkSourceLineNames.length" class="ready-text">
            {{ processReadyText }}
          </p>
          <p v-if="processReadOnlyText" class="locked-text">{{ processReadOnlyText }}</p>
        </div>

        <div class="panel-header">
          <h3 class="panel-title">订单零件</h3>
          <OrderNoLink :order-no="order.orderNo" />
        </div>
        <div class="process-structure-panel">
          <div class="process-structure-header">
            <div>
              <strong>流程固定格式清单</strong>
              <span>{{ processStructureGroups.length }} 组 / {{ order.lines.length }} 行</span>
            </div>
            <div class="process-structure-actions">
              <el-button size="small" :disabled="order.lines.length === 0" @click="openProcessStructureTextDialog">查看固定格式</el-button>
              <el-button size="small" :disabled="order.lines.length === 0" @click="copyProcessStructureText">复制清单</el-button>
            </div>
          </div>
          <div v-if="processStructureGroups.length" class="process-structure-list">
            <div v-for="(group, groupIndex) in processStructureGroups" :key="group.id" class="process-structure-group">
              <div class="process-structure-main">
                <span>{{ groupIndex + 1 }}</span>
                <el-tag :type="processLineStructureTagType(group.line)" effect="plain">
                  {{ processLineStructureLabel(group.line) }}
                </el-tag>
                <strong>{{ formatProcessStructureCore(group.line) }}</strong>
                <span>{{ formatProcessStructureMeta(group.line) }}</span>
              </div>
              <div v-for="(child, childIndex) in group.children" :key="child.id" class="process-structure-child">
                <span>{{ `${groupIndex + 1}.${childIndex + 1}` }}</span>
                <el-tag :type="processLineStructureTagType(child)" effect="plain">{{ processLineStructureLabel(child) }}</el-tag>
                <strong>{{ formatProcessStructureCore(child) }}</strong>
                <span>{{ formatProcessStructureMeta(child) }}</span>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无流程清单" />
        </div>
        <button
          v-for="line in order.lines"
          :key="line.id"
          class="part-item"
          :class="{ active: line.id === selectedLineId }"
          @click="selectLine(line.id)"
        >
          <span>
            <strong>{{ line.partName }}</strong>
            <small>{{ line.partCode }} / 订单 {{ formatQuantity(line.quantity, line.unit) }}</small>
            <small>{{ fulfillmentModeLabel(line.fulfillmentMode) }} / 生产计划 {{ formatQuantity(line.productionPlanQuantity, line.unit) }}</small>
            <small v-if="componentTraceText(line)">{{ componentTraceText(line) }}</small>
          </span>
          <em>{{ lineProcessBadgeText(line) }}</em>
        </button>
      </div>

      <div class="panel builder-panel">
        <div class="panel-header">
          <h3 class="panel-title">{{ selectedLine?.partName || '-' }} / 生产步骤</h3>
          <span v-if="isDirty" class="dirty-text">未保存</span>
        </div>

        <el-form label-width="108px" class="process-editor-form">
          <el-form-item label="流程填写人员" required>
            <el-select
              v-model="processEditorCode"
              filterable
              remote
              reserve-keyword
              clearable
              :disabled="!canEditProcessBase || isMobileLayout"
              :remote-method="loadProcessEditorOperators"
              :loading="processEditorLoading"
              placeholder="选择下单/计划人员，车间人员只能查看"
              @change="handleProcessEditorOperatorChange"
              @visible-change="(visible: boolean) => visible && loadProcessEditorOperators('')"
            >
              <el-option
                v-for="operator in processEditorOptionRows"
                :key="operator.code"
                :label="submitPlanOperatorLabel(operator)"
                :value="operator.code"
              >
                <div class="operator-option">
                  <strong>{{ operator.name }}</strong>
                  <span>{{ operator.accountId || operator.code }} / {{ operator.role }}</span>
                </div>
              </el-option>
            </el-select>
            <div class="form-help-text">第一阶段生产流程由下单/计划管理人员填写；技术工艺人员作为后续阶段预留，车间人员只查看流程并按流程生产。</div>
            <el-alert
              v-if="processEditorNotice"
              :title="processEditorNotice"
              :type="canEditProcessBase && !processEditorCode ? 'warning' : 'info'"
              :closable="false"
              class="process-editor-notice"
            />
          </el-form-item>
        </el-form>

        <ProcessTemplateManager
          v-if="!isMobileLayout"
          class="process-template-inline"
          compact
          selectable
          :disabled="!canEditProcess"
          :source-steps="draftSteps"
          :source-name="selectedLineTemplateName"
          title="流程记忆"
          hint="可搜索、应用、新建、编辑或删除流程模板；模板不绑定零件号。"
          @apply="applyTemplate"
          @process-definition-updated="loadProcessDefinitions"
        />
        <el-alert
          v-else
          title="手机端只查看已保存流程，流程填写、模板维护和标准工序维护请在电脑端操作。"
          type="info"
          :closable="false"
          class="process-editor-notice"
        />

        <div v-if="!isMobileLayout" class="available-process-toolbar">
          <el-input
            v-model="quickProcessFilterKeyword"
            clearable
            placeholder="搜索工序 / 拼音 / 首字母"
            :disabled="!canEditProcess"
          />
        </div>
        <div v-if="!isMobileLayout" class="available-processes">
          <el-tooltip
            v-for="process in filteredQuickProcessOptions"
            :key="process"
            :disabled="!processEditDisabledReason"
            :content="processEditDisabledReason"
            placement="top"
          >
            <span class="action-tooltip-wrap">
              <el-button round :disabled="!canEditProcess" @click="addStep(process)">
                {{ process }}
              </el-button>
            </span>
          </el-tooltip>
          <span v-if="quickProcessFilterKeyword && filteredQuickProcessOptions.length === 0" class="process-empty-text">没有匹配工序</span>
        </div>
        <div v-if="!isMobileLayout" class="inline-process-create">
          <el-input v-model="newProcessName" placeholder="新建标准工序，例如 抛丸、抛光" :disabled="!canEditProcess" />
          <el-tooltip :disabled="!processEditDisabledReason" :content="processEditDisabledReason" placement="top">
            <span class="action-tooltip-wrap">
              <el-button :loading="creatingProcess" :disabled="!canEditProcess" @click="createProcessDefinition">新建工序</el-button>
            </span>
          </el-tooltip>
          <el-tooltip :disabled="!processEditDisabledReason" :content="processEditDisabledReason" placement="top">
            <span class="action-tooltip-wrap">
              <el-button :disabled="!canEditProcess" @click="processDefinitionManagerVisible = true">管理工序</el-button>
            </span>
          </el-tooltip>
        </div>

        <div class="standard-process-help">
          工序名称只允许选择标准工序；次数、参数和特殊要求请写入工序备注，避免后续统计混乱。
        </div>

        <div class="selected-steps-title">
          <h4>已选流程</h4>
          <small>拖动“拖拽”手柄调整顺序；上移 / 下移可作为备用操作。</small>
        </div>
        <div
          class="selected-steps"
          @dragover.self.prevent="handleStepListDragOverEnd"
          @dragleave="handleStepListDragLeave"
          @drop.self.prevent="dropStepAtEnd"
        >
          <div
            v-for="(step, index) in draftSteps"
            :key="draftStepKey(step)"
            class="selected-step"
            :class="{
              'is-dragging': draggedStepIndex === index,
              'is-drop-before': dragOverStepIndex === index && !dragOverStepInsertAfter,
              'is-drop-after': dragOverStepIndex === index && dragOverStepInsertAfter
            }"
            @dragenter.prevent="handleStepDragOver($event, index)"
            @dragover.prevent="handleStepDragOver($event, index)"
            @drop.prevent="dropStep($event, index)"
          >
            <div class="step-sort-cell">
              <button
                type="button"
                class="step-drag-handle"
                :disabled="!canEditProcess || isMobileLayout"
                :draggable="canEditProcess && !isMobileLayout"
                :title="isMobileLayout ? '手机端只查看流程顺序' : '拖拽调整顺序'"
                aria-label="拖拽调整顺序"
                @dragstart.stop="startStepDrag($event, index)"
                @dragend="endStepDrag"
              >
                <el-icon><Rank /></el-icon>
              </button>
              <span class="step-index">{{ index + 1 }}</span>
            </div>
            <el-select
              v-model="step.processName"
              filterable
              placeholder="标准工序 / 拼音 / 首字母"
              :disabled="!canEditProcess"
              :filter-method="handleDraftProcessFilter"
              @change="handleDraftStepChange"
              @visible-change="handleDraftProcessVisibleChange"
            >
              <el-option v-for="process in filteredProcessOptions" :key="process" :label="process" :value="process" />
            </el-select>
            <el-input v-model="step.processRemark" placeholder="参数备注，例如 4次 / M6孔" :disabled="!canEditProcess" />
            <div v-if="!isMobileLayout" class="step-actions">
              <el-tooltip :disabled="!stepMoveUpDisabledReason(index)" :content="stepMoveUpDisabledReason(index)" placement="top">
                <span class="action-tooltip-wrap">
                  <el-button link :disabled="!canEditProcess || index === 0" @click="moveStep(index, -1)">上移</el-button>
                </span>
              </el-tooltip>
              <el-tooltip :disabled="!stepMoveDownDisabledReason(index)" :content="stepMoveDownDisabledReason(index)" placement="top">
                <span class="action-tooltip-wrap">
                  <el-button link :disabled="!canEditProcess || index === draftSteps.length - 1" @click="moveStep(index, 1)">下移</el-button>
                </span>
              </el-tooltip>
              <el-tooltip :disabled="!processEditDisabledReason" :content="processEditDisabledReason" placement="top">
                <span class="action-tooltip-wrap">
                  <el-button link type="danger" :disabled="!canEditProcess" @click="removeStep(index)">删除</el-button>
                </span>
              </el-tooltip>
            </div>
          </div>
          <el-empty v-if="draftSteps.length === 0" description="当前零件未选择生产流程" />
        </div>
      </div>
    </div>

    <el-dialog
      v-model="processStructureTextDialogVisible"
      title="流程固定格式清单"
      width="min(900px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
    >
      <el-input
        class="process-structure-textarea"
        :model-value="processStructureText"
        type="textarea"
        :rows="22"
        readonly
      />
      <template #footer>
        <el-button @click="processStructureTextDialogVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!processStructureText" @click="copyProcessStructureText">复制清单</el-button>
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
        title="生产流程标准工序"
        hint="这里维护每个零件流程配置时可选择的标准工序；重复工序名称会被系统拦截。"
        @updated="handleProcessDefinitionsUpdated"
      />
    </el-dialog>

    <el-dialog
      v-model="submitOrderDialogVisible"
      title="提交生产"
      width="min(760px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
      :close-on-click-modal="!submitting"
      :close-on-press-escape="!submitting"
      :before-close="handleSubmitOrderDialogClose"
      :show-close="!submitting"
      @closed="resetSubmitOrderDialog"
    >
      <div class="submit-production-summary">
        <el-alert
          title="提交后会按履约方式生成生产任务、扣减库存或转入订单待发货库存；提交后订单零件不能再按待提交生产状态编辑。"
          type="warning"
          :closable="false"
        />
        <el-form label-width="108px" class="submit-plan-form">
          <el-form-item label="下单/计划操作员" required>
            <el-select
              v-model="submitPlanOperatorCode"
              filterable
              remote
              reserve-keyword
              clearable
              :remote-method="loadSubmitPlanOperators"
              :loading="submitPlanOperatorLoading"
              placeholder="选择下单或计划人员，车间主任不能提交"
              @change="handleSubmitPlanOperatorChange"
              @visible-change="(visible: boolean) => visible && loadSubmitPlanOperators('')"
            >
              <el-option
                v-for="operator in submitPlanOperatorOptionRows"
                :key="operator.code"
                :label="submitPlanOperatorLabel(operator)"
                :value="operator.code"
              >
                <div class="operator-option">
                  <strong>{{ operator.name }}</strong>
                  <span>{{ operator.accountId || operator.code }} / {{ operator.role }}</span>
                </div>
              </el-option>
            </el-select>
            <div class="form-help-text">提交生产属于下单/计划动作；车间主任只在生产页开始生产、确认生产。</div>
          </el-form-item>
        </el-form>
        <p class="submit-production-row">
          <span>订单号</span>
          <strong>
            <OrderNoLink :order-no="order?.orderNo" />
          </strong>
        </p>
        <p class="submit-production-row">
          <span>客户</span>
          <strong>{{ order?.customerName }}</strong>
        </p>
        <p class="submit-production-row">
          <span>零件数</span>
          <strong>{{ order?.lines.length || 0 }} 个</strong>
        </p>
        <p v-if="order" class="submit-production-row">
          <span>客户订单</span>
          <strong>{{ formatOrderQuantity(order, 'totalQuantity') }}</strong>
        </p>
        <p v-if="order" class="submit-production-row">
          <span>生产计划</span>
          <strong>{{ formatOrderQuantity(order, 'totalProductionPlanQuantity') }}</strong>
        </p>
        <div v-if="order" class="submit-production-lines">
          <article v-for="line in order.lines" :key="line.id" class="submit-production-line">
            <div>
              <strong>{{ line.partCode }} / {{ line.partName }}</strong>
              <span>{{ fulfillmentModeLabel(line.fulfillmentMode) }}，订单 {{ formatQuantity(line.quantity, line.unit) }}，生产计划 {{ formatQuantity(line.productionPlanQuantity, line.unit) }}</span>
            </div>
            <small v-if="componentTraceText(line)">组件关系：{{ componentTraceText(line) }}</small>
            <small v-if="lineRequiresProductionProcess(line)">流程：{{ line.processSteps.length ? line.processSteps.join('、') : '未配置' }}</small>
            <small v-if="stockSourceSummary(line)">库存来源：{{ stockSourceSummary(line) }}</small>
            <small v-if="submitOrderLineWarning(line)" class="submit-production-line-warning">{{ submitOrderLineWarning(line) }}</small>
          </article>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="submitting" @click="closeSubmitOrderDialog">取消</el-button>
        <el-button type="success" :disabled="!submitPlanOperatorCode" :loading="submitting" @click="confirmSubmitOrderFromProcess">提交生产</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="discardChangesDialogVisible"
      title="切换流程"
      width="min(500px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
      @closed="handleDiscardChangesClosed"
    >
      <p class="discard-changes-text">当前流程未保存，切换后会丢失修改。</p>
      <template #footer>
        <el-button @click="cancelDiscardChanges">取消</el-button>
        <el-button type="warning" @click="confirmDiscardChangesDialog">继续切换</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Rank } from '@element-plus/icons-vue';
import { useRoute, useRouter } from 'vue-router';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import OrderSelect from '../components/OrderSelect.vue';
import ProcessDefinitionManager from '../components/ProcessDefinitionManager.vue';
import ProcessTemplateManager from '../components/ProcessTemplateManager.vue';
import StatusTag from '../components/StatusTag.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import type { OrderDetail, OrderLine, OrderSummary, ProcessStepDetail, ProductionOperator } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';
import { validateStockModeLines } from '../utils/orderLineStockChecks';
import { orderDisplayStatus } from '../utils/orderStatus';
import { filterPinyinSearchOptions } from '../utils/pinyinSearch';
import { validateSubmitStockSources } from '../utils/submitStockSourceChecks';

type ProcessStructureGroup = {
  id: string;
  type: 'component' | 'standalone' | 'orphan';
  line: OrderLine;
  children: OrderLine[];
};

const route = useRoute();
const router = useRouter();
const { isMobileLayout } = useDeviceProfile();
const orders = ref<OrderSummary[]>([]);
const orderOptions = ref<OrderSummary[]>([]);
const order = ref<OrderDetail>();
const selectedCustomerId = ref('');
const filterOrderNo = ref('');
const selectedOrderNo = ref('');
const selectedLineId = ref('');
const orderDateRange = ref<string[]>([]);
const lastDateRange = ref<string[]>([]);
const draftSteps = ref<ProcessStepDetail[]>([]);
const draftStepKeys = new WeakMap<ProcessStepDetail, string>();
let draftStepKeySeq = 0;
const draggedStepIndex = ref<number | null>(null);
const dragOverStepIndex = ref<number | null>(null);
const dragOverStepInsertAfter = ref(false);
const loading = ref(false);
const ordersLoading = ref(false);
const ordersLoaded = ref(false);
const saving = ref(false);
const submitting = ref(false);
const restoringSelection = ref(false);

const processOptions = ref<string[]>([]);
const newProcessName = ref('');
const creatingProcess = ref(false);
const quickProcessFilterKeyword = ref('');
const draftProcessFilterKeyword = ref('');
const processDefinitionManagerVisible = ref(false);
const submitOrderDialogVisible = ref(false);
const processStructureTextDialogVisible = ref(false);
const processEditorCode = ref('');
const processEditorOperators = ref<ProductionOperator[]>([]);
const processEditorLoading = ref(false);
const submitPlanOperatorCode = ref('');
const submitPlanOperators = ref<ProductionOperator[]>([]);
const submitPlanOperatorLoading = ref(false);
const operatorCache = reactive<Record<string, ProductionOperator>>({});
const discardChangesDialogVisible = ref(false);
const expandedMobileOrderIds = ref<string[]>([]);
let discardChangesResolver: ((confirmed: boolean) => void) | undefined;
let restoringProcessRoute = false;

const selectedLine = computed<OrderLine | undefined>(() => order.value?.lines.find((line) => line.id === selectedLineId.value));
const selectedLineTemplateName = computed(() => (selectedLine.value?.partName ? `${selectedLine.value.partName}流程` : '当前流程'));
const savedSteps = computed(() => selectedLineProcessDetails(selectedLine.value));
const isDirty = computed(() => JSON.stringify(normalizeSteps(draftSteps.value)) !== JSON.stringify(normalizeSteps(savedSteps.value)));
const processRequiredLines = computed(() => order.value?.lines.filter(lineRequiresProductionProcess) || []);
const processStructureGroups = computed<ProcessStructureGroup[]>(() => buildProcessStructureGroups(order.value?.lines || []));
const processComponentNoSet = computed(() => {
  const componentNos = new Set<string>();
  for (const line of order.value?.lines || []) {
    if (line.lineType === 'COMPONENT') {
      const componentNo = normalizeComponentNo(line.componentNo);
      if (componentNo) {
        componentNos.add(componentNo);
      }
    }
  }
  return componentNos;
});
const totalLineCount = computed(() => processRequiredLines.value.length);
const processEditorOptionRows = computed(() => operatorRowsWithSelected(processEditorOperators.value, processEditorCode.value));
const submitPlanOperatorOptionRows = computed(() => operatorRowsWithSelected(submitPlanOperators.value, submitPlanOperatorCode.value));
const configuredLineCount = computed(() => processRequiredLines.value.filter((line) => line.processSteps.length > 0).length);
const processPercent = computed(() =>
  totalLineCount.value
    ? Math.round((configuredLineCount.value / totalLineCount.value) * 100)
    : order.value?.lines.length && missingStockSourceLineNames.value.length === 0 && insufficientReworkSourceLineNames.value.length === 0
      ? 100
      : 0
);
const missingLineNames = computed(() => processRequiredLines.value.filter((line) => line.processSteps.length === 0).map((line) => line.partName));
const missingStockSourceLineNames = computed(() =>
  (order.value?.lines || [])
    .filter((line) => (line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK') && selectedStockSourceQuantity(line) <= 0)
    .map((line) => line.partName)
);
const insufficientReworkSourceLineNames = computed(() =>
  (order.value?.lines || [])
    .filter((line) => reworkStockShortageQuantity(line) > 0)
    .map((line) => line.partName)
);
const processReadyText = computed(() =>
  totalLineCount.value === 0 ? '全部零件无生产任务，无需配置生产流程' : '全部零件已配置流程'
);
const processReadOnlyText = computed(() => (order.value?.status === 'DRAFT' ? '' : processOrderReadOnlyReason(order.value)));
const canEditProcessBase = computed(() => order.value?.status === 'DRAFT' && Boolean(selectedLine.value && lineRequiresProductionProcess(selectedLine.value)));
const canEditProcess = computed(() => canEditProcessBase.value && !isMobileLayout.value && Boolean(processEditorCode.value));
const processEditorNotice = computed(() => {
  if (isMobileLayout.value) {
    return '手机端只查看生产流程，流程填写和提交生产请在电脑端操作。';
  }
  if (!order.value) {
    return '';
  }
  if (order.value.status !== 'DRAFT') {
    return processOrderReadOnlyReason(order.value);
  }
  if (!selectedLine.value) {
    return '请先选择需要维护生产流程的订单零件。';
  }
  if (!lineRequiresProductionProcess(selectedLine.value)) {
    return selectedLine.value.fulfillmentMode === 'STOCK'
      ? '当前零件已全量使用库存，不生成生产任务，也不需要填写生产流程。'
      : '当前零件生产计划为 0，不生成生产任务，也不需要填写生产流程。';
  }
  if (!processEditorCode.value) {
    return '请先选择下单/计划流程填写人员，选择后才可编辑工序。';
  }
  return '';
});
const processEditDisabledReason = computed(() => (!canEditProcess.value ? processEditorNotice.value || '请先选择订单零件和流程填写人员。' : ''));
const processSaveDisabledReason = computed(() => {
  if (!selectedLine.value) {
    return '请先选择需要维护生产流程的订单零件。';
  }
  return processEditDisabledReason.value;
});
const canSubmitOrder = computed(
  () =>
    !isMobileLayout.value &&
    order.value?.status === 'DRAFT' &&
    (order.value?.lines.length || 0) > 0 &&
    missingLineNames.value.length === 0 &&
    missingStockSourceLineNames.value.length === 0 &&
    insufficientReworkSourceLineNames.value.length === 0 &&
    !isDirty.value
);
const orderDetailDisabledReason = computed(() => (!order.value ? '请先选择订单，再查看订单明细。' : ''));
const submitOrderDisabledReason = computed(() => {
  if (isMobileLayout.value) {
    return '手机端只查看生产流程，提交生产请在电脑端操作。';
  }
  if (!order.value) {
    return '请先选择订单。';
  }
  if (order.value.status !== 'DRAFT') {
    return '当前订单已提交生产，不能重复提交。';
  }
  if ((order.value.lines.length || 0) === 0) {
    return '订单没有零件，不能提交生产。';
  }
  if (missingLineNames.value.length > 0) {
    return `仍有零件未配置生产流程：${missingLineNames.value.join('、')}。`;
  }
  if (missingStockSourceLineNames.value.length > 0) {
    return `仍有库存来源未核对：${missingStockSourceLineNames.value.join('、')}。`;
  }
  if (insufficientReworkSourceLineNames.value.length > 0) {
    return `库存再加工来源未补齐：${insufficientReworkSourceLineNames.value.join('、')}。`;
  }
  if (isDirty.value) {
    return '当前零件流程有未保存修改，请先保存。';
  }
  return '';
});
const returnToPath = computed(() => normalizeReturnTo(route.query.returnTo));
const filteredQuickProcessOptions = computed(() => filterPinyinSearchOptions(processOptions.value, quickProcessFilterKeyword.value));
const filteredProcessOptions = computed(() => filterPinyinSearchOptions(processOptions.value, draftProcessFilterKeyword.value));

function lineRequiresProductionProcess(line: OrderLine) {
  return Number(line.productionPlanQuantity ?? 0) > 0;
}

function normalizeComponentNo(value?: string | null) {
  return String(value || '').trim().toUpperCase();
}

function buildProcessStructureGroups(lines: OrderLine[]): ProcessStructureGroup[] {
  const childrenByParent = new Map<string, OrderLine[]>();
  const rootLines: OrderLine[] = [];
  for (const line of lines) {
    if (line.lineType !== 'COMPONENT' && line.parentComponentNo) {
      const key = normalizeComponentNo(line.parentComponentNo);
      childrenByParent.set(key, [...(childrenByParent.get(key) || []), line]);
    } else {
      rootLines.push(line);
    }
  }
  const groups: ProcessStructureGroup[] = [];
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

function componentTraceText(line: OrderLine) {
  if (line.lineType === 'COMPONENT' && line.componentNo) {
    return `组件 ${normalizeComponentNo(line.componentNo) || '未编号'}`;
  }
  if (line.parentComponentNo) {
    if (isProcessLineMissingParentComponent(line)) {
      return `未匹配父级 ${normalizeComponentNo(line.parentComponentNo)}`;
    }
    return `子零件 -> ${normalizeComponentNo(line.parentComponentNo)}`;
  }
  if (line.lineType === 'PART') {
    return '单独零件';
  }
  return '';
}

function isProcessLineMissingParentComponent(line: OrderLine) {
  const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
  return Boolean(line.lineType !== 'COMPONENT' && parentComponentNo && !processComponentNoSet.value.has(parentComponentNo));
}

function processLineStructureLabel(line: OrderLine) {
  if (line.lineType === 'COMPONENT') {
    return `组件 ${normalizeComponentNo(line.componentNo) || '未编号'}`;
  }
  const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
  if (parentComponentNo && isProcessLineMissingParentComponent(line)) {
    return `未匹配父级 ${parentComponentNo}`;
  }
  return parentComponentNo ? `子零件 -> ${parentComponentNo}` : '单独零件';
}

function processLineStructureHint(line: OrderLine) {
  if (line.lineType === 'COMPONENT') {
    return '父级组件';
  }
  const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
  if (parentComponentNo && isProcessLineMissingParentComponent(line)) {
    return '所属组件不存在';
  }
  return parentComponentNo ? `所属组件 ${parentComponentNo}` : '不属于组件';
}

function processLineStructureTagType(line: OrderLine): 'success' | 'warning' | 'info' | 'danger' {
  if (line.lineType === 'COMPONENT') {
    return 'success';
  }
  if (isProcessLineMissingParentComponent(line)) {
    return 'danger';
  }
  return normalizeComponentNo(line.parentComponentNo) ? 'warning' : 'info';
}

function processStepText(line: OrderLine) {
  return line.processSteps.length ? line.processSteps.join('、') : lineRequiresProductionProcess(line) ? '未配置' : '无生产任务';
}

function formatProcessLineThickness(line: OrderLine) {
  if (line.lineType === 'COMPONENT') {
    return '不适用（父级组件由子零件维护）';
  }
  return line.partThickness || '-';
}

function formatProcessStructureCore(line: OrderLine) {
  return `${line.partCode || '-'} | ${line.partName || '-'} | 订单 ${formatQuantity(line.quantity, line.unit)}`;
}

function formatProcessStructureMeta(line: OrderLine) {
  return `${fulfillmentModeLabel(line.fulfillmentMode)} | 生产计划 ${formatQuantity(line.productionPlanQuantity, line.unit)} | 流程 ${processStepText(line)}`;
}

function formatProcessStructureTextLine(line: OrderLine, prefix: string) {
  const drawingText = [line.drawingNo, line.drawingVersion, line.drawingDate, line.drawingStatus].filter(Boolean).join(' / ') || '-';
  const deliveryText = formatDate(line.deliveryDate || order.value?.deliveryDate);
  return [
    prefix,
    `结构 ${processLineStructureLabel(line)}`,
    `父级 ${processLineStructureHint(line)}`,
    `编码 ${line.partCode || '-'}`,
    `名称 ${line.partName || '-'}`,
    `类型 ${line.partCategory || '-'}`,
    `项目 ${line.projectModel || '-'}`,
    `厚度 ${formatProcessLineThickness(line)}`,
    `规格 ${line.partSpecification || '-'}`,
    `订单 ${formatQuantity(line.quantity, line.unit)}`,
    `计划 ${formatQuantity(line.productionPlanQuantity, line.unit)}`,
    `交期 ${deliveryText}`,
    `图纸 ${drawingText}`,
    `履约 ${fulfillmentModeLabel(line.fulfillmentMode)}`,
    `流程 ${processStepText(line)}`
  ].join(' | ');
}

const processStructureText = computed(() => {
  const currentOrder = order.value;
  if (!currentOrder) {
    return '';
  }
  const lines = [
    `${currentOrder.orderNo} / ${currentOrder.customerName} / ${formatDate(currentOrder.orderDate)} / 交期 ${formatDate(currentOrder.deliveryDate)}`,
    '序号 | 结构 | 父级 | 编码 | 名称 | 类型 | 项目 | 厚度 | 规格 | 订单 | 计划 | 交期 | 图纸 | 履约 | 流程'
  ];
  for (const [groupIndex, group] of processStructureGroups.value.entries()) {
    const prefix =
      group.type === 'component'
        ? `${groupIndex + 1}. 组件 ${group.line.componentNo || '-'}`
        : group.type === 'orphan'
          ? `${groupIndex + 1}. 未匹配父级 ${group.line.parentComponentNo || '-'}`
          : `${groupIndex + 1}. 单独零件`;
    lines.push(formatProcessStructureTextLine(group.line, prefix));
    group.children.forEach((child, childIndex) => {
      lines.push(formatProcessStructureTextLine(child, `  ${groupIndex + 1}.${childIndex + 1} 子零件`));
    });
  }
  return lines.join('\n');
});

function openProcessStructureTextDialog() {
  if (!processStructureText.value.trim()) {
    ElMessage.warning('暂无可查看的流程清单');
    return;
  }
  processStructureTextDialogVisible.value = true;
}

async function copyProcessStructureText() {
  const text = processStructureText.value.trim();
  if (!text) {
    ElMessage.warning('暂无可复制的流程清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('流程固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

function lineProcessBadgeText(line: OrderLine) {
  if (lineRequiresProductionProcess(line)) {
    return line.processSteps.length ? `${line.processSteps.length} 道` : '未选择';
  }
  return line.fulfillmentMode === 'STOCK' ? '使用库存' : '无生产任务';
}

function selectedStockSourceQuantity(line: OrderLine) {
  return (line.selectedStockSources || []).reduce((sum, source) => sum + Number(source.quantity ?? 0), 0);
}

function reworkStockShortageQuantity(line: OrderLine) {
  if (line.fulfillmentMode !== 'REWORK') {
    return 0;
  }
  return Math.max(Math.round((Number(line.productionPlanQuantity ?? 0) - selectedStockSourceQuantity(line) + Number.EPSILON) * 1000) / 1000, 0);
}

function submitOrderLineWarning(line: OrderLine) {
  if ((line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK') && selectedStockSourceQuantity(line) <= 0) {
    return '该零件尚未选择库存批次，提交生产前必须完成库存来源核对。';
  }
  const reworkShortageQuantity = reworkStockShortageQuantity(line);
  if (reworkShortageQuantity > 0) {
    return `库存再加工已选库存少于生产计划，仍需补选 ${formatQuantity(reworkShortageQuantity, line.unit)}。`;
  }
  if (lineRequiresProductionProcess(line) && line.processSteps.length === 0) {
    return '该零件尚未设置生产流程，提交时会被后端拒绝。';
  }
  return '';
}

function orderProductionStatusValue(item: OrderSummary) {
  return orderDisplayStatus(item);
}

function orderProductionStatusLabel(item: OrderSummary) {
  void item;
  return undefined;
}

function processEntryActionText(item: OrderSummary) {
  return item.status === 'DRAFT' ? '提交生产' : '查看流程';
}

function formatOrderQuantity(order: OrderSummary, field: 'totalQuantity' | 'totalProductionPlanQuantity') {
  if (order.quantityByUnit?.length) {
    return order.quantityByUnit.map((row) => formatQuantity(row[field], row.unit)).join(' / ');
  }
  return formatQuantity(order[field], order.unit);
}

function orderShortageActionText(order: OrderSummary) {
  if (order.needsProductionReplenishmentReview && !order.needsReplenishmentAction) {
    const quantityText = order.pendingProductionReplenishmentQuantityByUnit?.length
      ? order.pendingProductionReplenishmentQuantityByUnit.map((row) => formatQuantity(row.quantity, row.unit)).join('、')
      : formatQuantity(order.pendingProductionReplenishmentQuantity ?? 0, order.pendingProductionReplenishmentUnit || order.unit || '件');
    return `生产报废补单待确认 ${order.pendingProductionReplenishmentLineCount ?? 0} 个 / ${quantityText}`;
  }
  const quantityText = order.unresolvedShortageQuantityByUnit?.length
    ? order.unresolvedShortageQuantityByUnit.map((row) => formatQuantity(row.quantity, row.unit)).join('、')
    : formatQuantity(order.unresolvedShortageQuantity ?? 0, order.unresolvedShortageUnit || order.unit || '件');
  return `需补单 ${order.unresolvedShortageLineCount ?? 0} 个 / ${quantityText}`;
}

function orderNeedsShortageAttention(order: OrderSummary) {
  return Boolean(order.needsReplenishmentAction || order.needsProductionReplenishmentReview);
}

function processOrderReadOnlyReason(item?: { status?: string; warehouseStage?: string }) {
  if (!item) {
    return '';
  }
  if (item.status === 'CANCELLED') {
    return '当前订单已取消，生产流程只能查看，不能编辑工序。';
  }
  if (item.status === 'COMPLETED' || item.warehouseStage === 'SHIPPED') {
    return '当前订单已完成发货，生产流程只能查看，不能编辑工序。';
  }
  return '当前订单已提交生产，生产流程只能查看，不能修改。';
}

function isMobileOrderExpanded(orderId: string) {
  return expandedMobileOrderIds.value.includes(orderId);
}

function toggleMobileOrderCard(orderId: string) {
  expandedMobileOrderIds.value = isMobileOrderExpanded(orderId)
    ? expandedMobileOrderIds.value.filter((id) => id !== orderId)
    : [...expandedMobileOrderIds.value, orderId];
}

async function loadProcessDefinitions() {
  try {
    const rows = await erpApi.processDefinitions(undefined, 'ENABLED');
    processOptions.value = rows.map((row) => row.processName);
  } catch (error) {
    processOptions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '标准工序加载失败，请确认后端服务');
  }
}

async function handleProcessDefinitionsUpdated() {
  await loadProcessDefinitions();
}

async function loadOrders() {
  ordersLoading.value = true;
  try {
    // 订单日期是生产流程页的第一层筛选；客户和订单都是可选的下一级筛选条件。
    orderOptions.value = await erpApi.orders({
      customerId: selectedCustomerId.value || undefined,
      dateFrom: orderDateRange.value[0],
      dateTo: orderDateRange.value[1]
    });

    orders.value = filterOrderNo.value
      ? orderOptions.value.filter((item) => item.orderNo === filterOrderNo.value)
      : [...orderOptions.value];
    lastDateRange.value = [...orderDateRange.value];
    ordersLoaded.value = true;
  } catch (error) {
    orderOptions.value = [];
    orders.value = [];
    ordersLoaded.value = true;
    expandedMobileOrderIds.value = [];
    resetOrderSelection();
    ElMessage.error(error instanceof Error ? error.message : '订单列表加载失败，请确认后端服务和筛选条件');
  } finally {
    ordersLoading.value = false;
  }
}

async function queryOrders() {
  if (!(await confirmDiscardChanges())) {
    return;
  }
  resetOrderSelection();
  clearProcessRouteOrder();
  await loadOrders();
}

async function loadOrder() {
  if (!selectedOrderNo.value) {
    order.value = undefined;
    selectedLineId.value = '';
    draftSteps.value = [];
    processEditorCode.value = '';
    return;
  }

  loading.value = true;
  try {
    order.value = await erpApi.order(selectedOrderNo.value);
    processEditorCode.value = '';
    applySelectedLine(defaultProcessLineId(order.value));
  } catch (error) {
    order.value = undefined;
    selectedLineId.value = '';
    draftSteps.value = [];
    processEditorCode.value = '';
    ElMessage.error(error instanceof Error ? error.message : '订单明细加载失败，请确认订单状态和后端服务');
  } finally {
    loading.value = false;
  }
}

async function handleCustomerChange() {
  if (restoringSelection.value) {
    return;
  }
  if (!(await confirmDiscardChanges())) {
    restoringSelection.value = true;
    selectedCustomerId.value = order.value?.customerId || '';
    restoringSelection.value = false;
    return;
  }
  selectedOrderNo.value = '';
  filterOrderNo.value = '';
  resetOrderSelection();
  clearProcessRouteOrder();
  await loadOrders();
}

async function handleDateChange() {
  if (restoringSelection.value) {
    return;
  }
  if (!(await confirmDiscardChanges())) {
    restoringSelection.value = true;
    orderDateRange.value = [...lastDateRange.value];
    restoringSelection.value = false;
    return;
  }
  selectedOrderNo.value = '';
  filterOrderNo.value = '';
  resetOrderSelection();
  clearProcessRouteOrder();
  await loadOrders();
}

function resetOrderSelection() {
  selectedOrderNo.value = '';
  order.value = undefined;
  selectedLineId.value = '';
  draftSteps.value = [];
  processEditorCode.value = '';
}

function fulfillmentModeLabel(mode?: string) {
  if (mode === 'STOCK') {
    return '使用库存';
  }
  if (mode === 'REWORK') {
    return '库存再加工';
  }
  return '重新生产';
}

function stockSourceSummary(line: OrderLine) {
  const sources = line.selectedStockSources || [];
  if (sources.length === 0) {
    return '';
  }
  return sources
    .map((source) => {
      const manualText = source.compatibilityStatus && source.compatibilityStatus !== 'MATCHED' ? ' / 人工确认' : '';
      return `${source.batchNo || source.batchId} ${formatQuantity(source.quantity, source.unit || line.unit)}${manualText}`;
    })
    .join('；');
}

function guardDesktopProcessMutation(actionLabel: string) {
  if (!isMobileLayout.value) {
    return false;
  }
  ElMessage.warning(`手机端仅查看生产流程，${actionLabel}请在电脑端操作`);
  return true;
}

function warnProcessEditUnavailable() {
  if (guardDesktopProcessMutation('流程填写和维护')) {
    return false;
  }
  if (!canEditProcessBase.value) {
    ElMessage.warning(processEditorNotice.value || '只有待提交生产订单的生产零件可以修改生产流程');
    return false;
  }
  if (!processEditorCode.value) {
    ElMessage.warning(processEditorNotice.value || '请先选择下单/计划流程填写人员');
    return false;
  }
  return true;
}

function stepMoveUpDisabledReason(index: number) {
  if (processEditDisabledReason.value) {
    return processEditDisabledReason.value;
  }
  return index === 0 ? '当前工序已经是第一道，不能继续上移。' : '';
}

function stepMoveDownDisabledReason(index: number) {
  if (processEditDisabledReason.value) {
    return processEditDisabledReason.value;
  }
  return index === draftSteps.value.length - 1 ? '当前工序已经是最后一道，不能继续下移。' : '';
}

function warnProcessSaveUnavailable() {
  if (!warnProcessEditUnavailable()) {
    return false;
  }
  return true;
}

async function selectLine(lineId: string) {
  if (lineId === selectedLineId.value) {
    return;
  }

  if (selectedLineId.value && !(await confirmDiscardChanges())) {
    return;
  }

  applySelectedLine(lineId);
}

async function confirmDiscardChanges() {
  if (!isDirty.value) {
    return true;
  }

  if (discardChangesResolver) {
    discardChangesResolver(false);
    discardChangesResolver = undefined;
  }
  discardChangesDialogVisible.value = true;
  return new Promise<boolean>((resolve) => {
    discardChangesResolver = resolve;
  });
}

function confirmDiscardChangesDialog() {
  const resolve = discardChangesResolver;
  discardChangesResolver = undefined;
  discardChangesDialogVisible.value = false;
  resolve?.(true);
}

function cancelDiscardChanges() {
  const resolve = discardChangesResolver;
  discardChangesResolver = undefined;
  discardChangesDialogVisible.value = false;
  resolve?.(false);
}

function handleDiscardChangesClosed() {
  if (!discardChangesResolver) {
    return;
  }
  const resolve = discardChangesResolver;
  discardChangesResolver = undefined;
  resolve(false);
}

function applySelectedLine(lineId: string) {
  selectedLineId.value = lineId;
  draftSteps.value = selectedLineProcessDetails(order.value?.lines.find((line) => line.id === lineId));
}

function defaultProcessLineId(orderDetail: OrderDetail) {
  // 生产计划为 0 的零件不生成生产任务；计划数量大于 0 时仍需要维护流程。
  return (
    orderDetail.lines.find((line) => lineRequiresProductionProcess(line) && line.processSteps.length === 0)?.id ||
    orderDetail.lines.find(lineRequiresProductionProcess)?.id ||
    orderDetail.lines[0]?.id ||
    ''
  );
}

function addStep(processName: string) {
  if (!warnProcessEditUnavailable()) {
    return;
  }
  const step = processName.trim();
  if (!step) {
    return;
  }
  const stepKey = normalizeProcessNameKey(step);
  if (normalizeSteps(draftSteps.value).some((item) => normalizeProcessNameKey(item.processName) === stepKey)) {
    ElMessage.warning(`当前零件已包含工艺：${step}`);
    return;
  }
  draftSteps.value.push({ processName: step, processRemark: '' });
}

async function createProcessDefinition() {
  if (!warnProcessEditUnavailable()) {
    return;
  }
  const processName = newProcessName.value.trim();
  if (!processName) {
    ElMessage.warning('请填写标准工序名称');
    return;
  }
  const processKey = normalizeProcessNameKey(processName);
  if (processOptions.value.some((item) => normalizeProcessNameKey(item) === processKey)) {
    ElMessage.warning(`标准工序“${processName}”已存在，请勿重复创建`);
    return;
  }

  creatingProcess.value = true;
  try {
    const created = await erpApi.createProcessDefinition({ processName });
    await loadProcessDefinitions();
    newProcessName.value = '';
    ElMessage.success('标准工序已创建');
    addStep(created.processName);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '标准工序创建失败，请确认是否重复');
  } finally {
    creatingProcess.value = false;
  }
}

function removeStep(index: number) {
  if (!canEditProcess.value) {
    return;
  }
  draftSteps.value.splice(index, 1);
}

function moveStep(index: number, offset: number) {
  if (!canEditProcess.value) {
    return;
  }
  const target = index + offset + (offset > 0 ? 1 : 0);
  reorderDraftStep(index, target);
}

function draftStepKey(step: ProcessStepDetail) {
  const existingKey = draftStepKeys.get(step);
  if (existingKey) {
    return existingKey;
  }
  const key = `draft-step-${++draftStepKeySeq}`;
  draftStepKeys.set(step, key);
  return key;
}

function startStepDrag(event: DragEvent, index: number) {
  if (!canEditProcess.value) {
    event.preventDefault();
    return;
  }
  draggedStepIndex.value = index;
  dragOverStepIndex.value = index;
  dragOverStepInsertAfter.value = false;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function handleStepDragOver(event: DragEvent, index: number) {
  if (!canEditProcess.value || draggedStepIndex.value === null) {
    return;
  }
  dragOverStepIndex.value = index;
  dragOverStepInsertAfter.value = isDragAfterRowMiddle(event);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function handleStepListDragLeave(event: DragEvent) {
  if (!canEditProcess.value || draggedStepIndex.value === null) {
    return;
  }
  const listElement = event.currentTarget;
  const nextElement = event.relatedTarget;
  if (listElement instanceof HTMLElement && nextElement instanceof Node && listElement.contains(nextElement)) {
    return;
  }
  dragOverStepIndex.value = null;
  dragOverStepInsertAfter.value = false;
}

function handleStepListDragOverEnd(event: DragEvent) {
  if (!canEditProcess.value || draggedStepIndex.value === null || draftSteps.value.length === 0) {
    return;
  }
  dragOverStepIndex.value = draftSteps.value.length - 1;
  dragOverStepInsertAfter.value = true;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function dropStep(event: DragEvent, index: number) {
  if (!canEditProcess.value || draggedStepIndex.value === null) {
    endStepDrag();
    return;
  }
  const insertionIndex = index + (isDragAfterRowMiddle(event) ? 1 : 0);
  reorderDraftStep(draggedStepIndex.value, insertionIndex);
  endStepDrag();
}

function dropStepAtEnd() {
  if (!canEditProcess.value || draggedStepIndex.value === null) {
    endStepDrag();
    return;
  }
  reorderDraftStep(draggedStepIndex.value, draftSteps.value.length);
  endStepDrag();
}

function endStepDrag() {
  draggedStepIndex.value = null;
  dragOverStepIndex.value = null;
  dragOverStepInsertAfter.value = false;
  draftProcessFilterKeyword.value = '';
}

function isDragAfterRowMiddle(event: DragEvent) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const rect = target.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

function reorderDraftStep(index: number, insertionIndex: number) {
  if (index < 0 || index >= draftSteps.value.length) {
    return;
  }
  let target = Math.max(0, Math.min(insertionIndex, draftSteps.value.length));
  if (index < target) {
    target -= 1;
  }
  if (index === target) {
    return;
  }
  const next = [...draftSteps.value];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  draftSteps.value = next;
}

function applyTemplate(steps: ProcessStepDetail[]) {
  if (!warnProcessEditUnavailable()) {
    return;
  }
  draftSteps.value = normalizeSteps(steps);
  const duplicates = duplicateStepNames(draftSteps.value);
  if (duplicates.length > 0) {
    ElMessage.warning(`流程中存在重复工序：${duplicates.join('、')}，请调整后再保存`);
  }
}

function normalizeSteps(steps: ProcessStepDetail[]) {
  // 不按当前本地标准工序列表过滤，避免列表尚未刷新时把模板步骤误删；保存时后端会校验标准工序状态。
  const result: ProcessStepDetail[] = [];
  steps.forEach((step) => {
    const processName = step.processName.trim();
    if (processName) {
      const processRemark = step.processRemark?.trim();
      result.push({
        processName,
        ...(processRemark ? { processRemark } : {})
      });
    }
  });
  return result;
}

function normalizeDraftSteps() {
  draftSteps.value = normalizeSteps(draftSteps.value);
}

function handleDraftStepChange() {
  normalizeDraftSteps();
  draftProcessFilterKeyword.value = '';
  const duplicates = duplicateStepNames(draftSteps.value);
  if (duplicates.length > 0) {
    ElMessage.warning(`当前零件流程存在重复工序：${duplicates.join('、')}，请确认后再保存`);
  }
}

function handleDraftProcessFilter(keyword: string) {
  draftProcessFilterKeyword.value = keyword;
}

function handleDraftProcessVisibleChange(visible: boolean) {
  if (!visible) {
    draftProcessFilterKeyword.value = '';
  }
}

function duplicateStepNames(steps: ProcessStepDetail[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const step of steps) {
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

function selectedLineProcessDetails(line?: OrderLine): ProcessStepDetail[] {
  if (!line) {
    return [];
  }
  if (line.processStepDetails?.length) {
    return line.processStepDetails.map((step) => ({ ...step }));
  }
  return line.processSteps.map((processName) => ({ processName }));
}

function goOrderDetail() {
  if (order.value) {
    goOrderSummaryDetail(order.value.orderNo);
  }
}

async function selectOrderFromList(orderNo: string, syncRoute = true) {
  if (!(await confirmDiscardChanges())) {
    return;
  }
  selectedOrderNo.value = orderNo;
  await loadOrder();
  if (syncRoute) {
    syncProcessRouteOrder(orderNo);
  }
}

function goOrderSummaryDetail(orderNo: string) {
  void router.push({
    path: `/orders/${encodeURIComponent(orderNo)}`,
    query: { returnTo: normalizeReturnTo(route.fullPath) || '/processes' }
  });
}

function goOrderShortageDetail(order: OrderSummary) {
  void router.push({
    path: `/orders/${encodeURIComponent(order.orderNo)}`,
    query: {
      returnTo: normalizeReturnTo(route.fullPath) || '/processes',
      shortage: '1'
    }
  });
}

function normalizeReturnTo(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const path = String(raw || '').trim();
  // 返回地址只能来自站内路径，避免把生产流程页变成外部跳转入口。
  if (!path.startsWith('/') || path.startsWith('//')) {
    return '';
  }
  return path;
}

function queryStringValue(value: unknown) {
  return String(Array.isArray(value) ? value[0] || '' : value || '').trim();
}

function processRouteOrderNo() {
  return queryStringValue(route.query.orderNo);
}

function processRouteQueryWithOrder(orderNo?: string) {
  const query = { ...route.query };
  if (orderNo) {
    query.orderNo = orderNo;
  } else {
    delete query.orderNo;
    delete query.open;
  }
  return query;
}

function syncProcessRouteOrder(orderNo: string) {
  if (processRouteOrderNo() === orderNo) {
    return;
  }
  void router.push({
    path: '/processes',
    query: processRouteQueryWithOrder(orderNo)
  });
}

function clearProcessRouteOrder() {
  if (!processRouteOrderNo()) {
    return;
  }
  void router.replace({
    path: '/processes',
    query: processRouteQueryWithOrder()
  });
}

async function handleRouteOrderNoChange() {
  if (restoringProcessRoute) {
    return;
  }

  const nextOrderNo = processRouteOrderNo();
  if (nextOrderNo === selectedOrderNo.value) {
    return;
  }

  if (!(await confirmDiscardChanges())) {
    restoringProcessRoute = true;
    await router.replace({
      path: '/processes',
      query: processRouteQueryWithOrder(selectedOrderNo.value || undefined)
    });
    restoringProcessRoute = false;
    return;
  }

  if (!nextOrderNo) {
    resetOrderSelection();
    return;
  }

  filterOrderNo.value = nextOrderNo;
  await loadOrders();
  selectedOrderNo.value = nextOrderNo;
  await loadOrder();
}

async function saveProcess() {
  if (guardDesktopProcessMutation('保存零件流程')) {
    return false;
  }
  if (saving.value) {
    return false;
  }
  if (!order.value || !selectedLine.value) {
    return false;
  }
  if (!warnProcessSaveUnavailable()) {
    return false;
  }

  const normalizedSteps = normalizeSteps(draftSteps.value);
  if (normalizedSteps.length === 0) {
    ElMessage.warning('请至少添加一道生产工艺');
    return false;
  }
  const duplicates = duplicateStepNames(normalizedSteps);
  if (duplicates.length > 0) {
    ElMessage.warning(`当前零件流程存在重复工序：${duplicates.join('、')}，请删除或调整后再保存`);
    return false;
  }

  const lineId = selectedLine.value.id;
  saving.value = true;
  try {
    // 保存时同步 OrderLine 流程，并同步尚未完成的 ProductionTask 快照。
    order.value = await erpApi.updateLineProcess(order.value.orderNo, lineId, {
      configuredByCode: processEditorCode.value,
      steps: normalizedSteps
    });
    applySelectedLine(lineId);
    ElMessage.success('生产流程已保存');
    return true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '生产流程保存失败');
    return false;
  } finally {
    saving.value = false;
  }
}

async function saveAndNext() {
  if (guardDesktopProcessMutation('保存零件流程')) {
    return;
  }
  if (saving.value) {
    return;
  }
  const lineId = selectedLine.value?.id;
  const saved = await saveProcess();
  if (!saved || !order.value || !lineId) {
    return;
  }

  const currentIndex = order.value.lines.findIndex((line) => line.id === lineId);
  const nextLine = order.value.lines.slice(currentIndex + 1).find(lineRequiresProductionProcess);
  if (nextLine) {
    applySelectedLine(nextLine.id);
  } else {
    ElMessage.success('当前订单需要配置流程的零件已全部处理');
  }
}

function validateSubmitOrderReady() {
  if (guardDesktopProcessMutation('提交生产')) {
    return false;
  }
  if (!order.value) {
    return false;
  }
  if (isDirty.value) {
    ElMessage.warning('请先保存当前零件流程');
    return false;
  }
  if (order.value.status !== 'DRAFT') {
    ElMessage.warning('只有待提交生产订单可以提交生产');
    return false;
  }
  if (missingLineNames.value.length > 0) {
    ElMessage.warning(`还有零件未配置流程：${missingLineNames.value.join('、')}`);
    return false;
  }
  if (missingStockSourceLineNames.value.length > 0) {
    ElMessage.warning(`还有零件未选择库存来源：${missingStockSourceLineNames.value.join('、')}`);
    return false;
  }
  if (insufficientReworkSourceLineNames.value.length > 0) {
    ElMessage.warning(`库存再加工零件未补齐库存来源：${insufficientReworkSourceLineNames.value.join('、')}`);
    return false;
  }
  return true;
}

async function openSubmitOrderDialog() {
  if (guardDesktopProcessMutation('提交生产')) {
    return;
  }
  if (!validateSubmitOrderReady()) {
    return;
  }
  submitPlanOperatorCode.value = '';
  await loadSubmitPlanOperators('');
  submitOrderDialogVisible.value = true;
}

function closeSubmitOrderDialog() {
  if (submitting.value) {
    ElMessage.warning('订单正在提交生产，请等待提交完成');
    return;
  }
  submitOrderDialogVisible.value = false;
}

function handleSubmitOrderDialogClose(done: () => void) {
  if (submitting.value) {
    ElMessage.warning('订单正在提交生产，请等待提交完成');
    return;
  }
  done();
}

function resetSubmitOrderDialog() {
  submitPlanOperatorCode.value = '';
}

async function confirmSubmitOrderFromProcess() {
  if (guardDesktopProcessMutation('提交生产')) {
    return;
  }
  if (submitting.value) {
    return;
  }
  if (!validateSubmitOrderReady() || !order.value) {
    submitOrderDialogVisible.value = false;
    return;
  }
  if (!submitPlanOperatorCode.value) {
    ElMessage.warning('请选择下单/计划操作员');
    return;
  }
  submitting.value = true;
  try {
    const inventorySummary = await erpApi.inventorySummary({
      status: 'AVAILABLE',
      excludeOrderNo: order.value.orderNo,
      excludeOrderId: order.value.id
    });
    const stockCheck = validateStockModeLines(order.value.lines, inventorySummary);
    if (!stockCheck.ok) {
      ElMessage.warning(stockCheck.message);
      return;
    }
    const sourceCheck = await validateSubmitStockSources(order.value.lines);
    if (!sourceCheck.ok) {
      ElMessage.warning(sourceCheck.message);
      return;
    }
    // 生产流程页确认全部零件流程后，直接提交订单并生成 ProductionTask，然后进入订单生产详情。
    const submittedOrderNo = order.value.orderNo;
    order.value = await erpApi.submitOrder(submittedOrderNo, { submittedByCode: submitPlanOperatorCode.value });
    submitOrderDialogVisible.value = false;
    if (submittedOrderShouldGoWarehouse(order.value)) {
      ElMessage.success('订单已提交生产，库存已进入仓库待发货');
      await router.push({
        path: '/warehouses',
        query: {
          orderNo: submittedOrderNo,
          returnTo: returnToPath.value || `/orders/${encodeURIComponent(submittedOrderNo)}`
        }
      });
      return;
    }
    ElMessage.success('订单已提交生产，已进入生产详情');
    await router.push({
      path: '/production',
      query: {
        orderNo: submittedOrderNo,
        returnTo: returnToPath.value || `/orders/${encodeURIComponent(submittedOrderNo)}`
      }
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单提交生产失败');
  } finally {
    submitting.value = false;
  }
}

function submittedOrderShouldGoWarehouse(submittedOrder: OrderDetail) {
  return submittedOrder.warehouseStage === 'WAITING_SHIPMENT';
}

function isSubmitPlanOperator(operator: ProductionOperator) {
  const role = operator.role || '';
  return /计划|下单|订单/.test(role) && !/车间|主任|技术|工艺/.test(role);
}

function isProcessEditorOperator(operator: ProductionOperator) {
  const role = operator.role || '';
  return /计划|下单|订单/.test(role) && !/车间|主任|技术|工艺|操作员/.test(role);
}

function submitPlanOperatorLabel(operator: ProductionOperator) {
  return `${operator.name} / ${operator.accountId || operator.code} / ${operator.role}`;
}

function cacheOperators(operators: ProductionOperator[]) {
  for (const operator of operators) {
    operatorCache[operator.code] = operator;
  }
}

function operatorRowsWithSelected(rows: ProductionOperator[], selectedCode: string) {
  const merged = new Map<string, ProductionOperator>();
  for (const operator of rows) {
    merged.set(operator.code, operator);
  }
  const selected = selectedCode ? operatorCache[selectedCode] : undefined;
  if (selected && !merged.has(selected.code)) {
    merged.set(selected.code, selected);
  }
  return [...merged.values()];
}

function handleSubmitPlanOperatorChange(code?: string) {
  const operator = submitPlanOperatorOptionRows.value.find((item) => item.code === code);
  if (operator) {
    cacheOperators([operator]);
  }
}

function handleProcessEditorOperatorChange(code?: string) {
  const operator = processEditorOptionRows.value.find((item) => item.code === code);
  if (operator) {
    cacheOperators([operator]);
  }
}

async function loadSubmitPlanOperators(keyword = '') {
  submitPlanOperatorLoading.value = true;
  try {
    const operators = await erpApi.productionOperators(keyword.trim());
    cacheOperators(operators);
    submitPlanOperators.value = operators.filter(isSubmitPlanOperator);
  } catch (error) {
    submitPlanOperators.value = [];
    ElMessage.error(error instanceof Error ? error.message : '下单/计划操作员加载失败，请确认后端服务');
  } finally {
    submitPlanOperatorLoading.value = false;
  }
}

async function loadProcessEditorOperators(keyword = '') {
  processEditorLoading.value = true;
  try {
    const operators = await erpApi.productionOperators(keyword.trim());
    cacheOperators(operators);
    processEditorOperators.value = operators.filter(isProcessEditorOperator);
  } catch (error) {
    processEditorOperators.value = [];
    ElMessage.error(error instanceof Error ? error.message : '流程填写人员加载失败，请确认后端服务');
  } finally {
    processEditorLoading.value = false;
  }
}

async function loadInitialState() {
  await loadProcessDefinitions();
  await loadProcessEditorOperators('');
  const initialOrderNo = String(route.query.orderNo || '');
  if (!initialOrderNo) {
    await loadOrders();
    return;
  }

  filterOrderNo.value = initialOrderNo;
  await loadOrders();
  // URL 带 orderNo 时表示从订单或其他业务页切入，直接进入该订单的流程配置，兼容旧入口不带 open=edit 的情况。
  await selectOrderFromList(initialOrderNo, false);
}

watch(() => route.query.orderNo, handleRouteOrderNoChange);
onMounted(loadInitialState);
</script>

<style scoped>
.process-filter {
  align-items: flex-end;
}

.process-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.action-tooltip-wrap {
  display: inline-flex;
  max-width: 100%;
}

.mobile-readonly-note {
  color: #64748b;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}

.process-layout {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 24px;
}

.process-order-list {
  display: grid;
  gap: 14px;
}

.order-list-note {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #64748b;
  font-size: 13px;
}

.order-list-note strong {
  color: #0f172a;
  font-size: 15px;
}

.parts-panel,
.builder-panel {
  min-height: min(520px, calc(100vh - 230px));
  min-width: 0;
}

.process-summary {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin: 16px 17px 8px;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.summary-label {
  display: block;
  margin-bottom: 6px;
  color: #64748b;
  font-size: 12px;
}

.missing-text,
.ready-text {
  margin: 0;
  font-size: 13px;
}

.missing-text {
  color: #d97706;
}

.locked-text {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.ready-text {
  color: #15803d;
}

.part-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% - 34px);
  min-height: 74px;
  margin: 0 17px 14px;
  padding: 12px;
  text-align: left;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
}

.part-item.active {
  background: #eff6ff;
  border-color: #93c5fd;
}

.part-item strong,
.part-item small {
  display: block;
}

.part-item small {
  margin-top: 8px;
  color: #64748b;
}

.part-item em {
  color: #64748b;
  font-size: 12px;
  font-style: normal;
}

.part-item.active em {
  color: #1d4ed8;
}

.process-structure-panel {
  display: grid;
  gap: 10px;
  margin: 0 17px 14px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.process-structure-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.process-structure-header > div {
  display: grid;
  gap: 3px;
}

.process-structure-header > .process-structure-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.process-structure-header span {
  color: #64748b;
  font-size: 12px;
}

.process-structure-list {
  display: grid;
  gap: 8px;
  max-height: 300px;
  overflow: auto;
}

.process-structure-group {
  display: grid;
  gap: 6px;
}

.process-structure-main,
.process-structure-child {
  display: grid;
  grid-template-columns: 28px 150px minmax(160px, 1fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 8px;
  background: #fff;
  border-radius: 6px;
}

.process-structure-child {
  margin-left: 22px;
  background: #f0fdf4;
}

.process-structure-main > span:first-child,
.process-structure-child > span:first-child {
  color: #64748b;
  font-size: 12px;
}

.process-structure-main strong,
.process-structure-child strong,
.process-structure-main > span:last-child,
.process-structure-child > span:last-child {
  grid-column: 3;
  min-width: 0;
  overflow-wrap: anywhere;
}

.process-structure-main > span:last-child,
.process-structure-child > span:last-child {
  color: #475569;
  font-size: 12px;
}

.process-structure-textarea :deep(textarea) {
  min-height: 460px;
  font-family: Consolas, 'Courier New', monospace;
  line-height: 1.55;
  white-space: pre;
}

.dirty-text {
  color: #d97706;
  font-size: 13px;
}

.available-process-toolbar {
  max-width: 360px;
  padding: 8px 20px 4px;
}

.available-processes {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  min-height: 42px;
  padding: 8px 20px 18px;
}

.process-empty-text {
  align-self: center;
  color: #64748b;
  font-size: 13px;
}

.process-template-inline {
  margin: 4px 20px 18px;
}

.process-editor-form {
  margin: 4px 20px 18px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.process-editor-form :deep(.el-select) {
  width: min(380px, 100%);
}

.inline-process-create {
  display: grid;
  grid-template-columns: minmax(220px, 360px) auto auto;
  align-items: center;
  gap: 10px;
  padding: 0 20px 18px;
}

.available-processes .el-button,
.step-actions .el-button {
  margin-left: 0;
}

.standard-process-help {
  margin: 0 20px 18px;
  color: #64748b;
  font-size: 13px;
}

.submit-production-summary {
  display: grid;
  gap: 12px;
}

.submit-plan-form {
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.submit-plan-form :deep(.el-select) {
  width: min(360px, 100%);
}

.form-help-text {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.process-editor-notice {
  margin-top: 8px;
}

.operator-option {
  display: grid;
  gap: 2px;
  padding: 4px 0;
}

.operator-option strong {
  color: #0f172a;
}

.operator-option span {
  color: #64748b;
  font-size: 12px;
}

.submit-production-row {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  margin: 0;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.submit-production-summary span {
  color: #64748b;
  font-size: 13px;
}

.submit-production-summary strong {
  min-width: 0;
  color: #0f172a;
  overflow-wrap: anywhere;
}

.submit-production-lines {
  display: grid;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
}

.submit-production-line {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.submit-production-line div {
  display: grid;
  gap: 4px;
}

.submit-production-line span,
.submit-production-line small {
  min-width: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.submit-production-line .submit-production-line-warning {
  color: #d97706;
  font-weight: 600;
}

.discard-changes-text {
  margin: 0;
  color: #475569;
  line-height: 1.7;
}

.selected-steps {
  padding: 0 20px 24px;
}

.selected-steps-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 16px 20px;
}

.selected-steps-title h4 {
  margin: 0;
}

.selected-steps-title small {
  color: #64748b;
  font-size: 12px;
}

.selected-step {
  position: relative;
  display: grid;
  grid-template-columns: 74px minmax(140px, 180px) minmax(180px, 1fr) 180px;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  margin-bottom: 10px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.selected-step.is-dragging {
  opacity: 0.55;
}

.selected-step.is-drop-before,
.selected-step.is-drop-after {
  border-color: #60a5fa;
  background: #eff6ff;
}

.selected-step.is-drop-before::before,
.selected-step.is-drop-after::after {
  position: absolute;
  right: 10px;
  left: 10px;
  height: 2px;
  background: #2563eb;
  content: '';
}

.selected-step.is-drop-before::before {
  top: -6px;
}

.selected-step.is-drop-after::after {
  bottom: -6px;
}

.step-sort-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.step-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  padding: 0;
  color: #64748b;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: grab;
  font-size: 15px;
  line-height: 1;
}

.step-drag-handle:active {
  cursor: grabbing;
}

.step-drag-handle:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #1d4ed8;
  background: #dbeafe;
  border-radius: 14px;
  font-size: 12px;
  font-weight: 600;
}

.step-actions {
  text-align: right;
}

@media (max-width: 1100px) {
  .process-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .process-layout {
    grid-template-columns: 1fr;
  }

  .parts-panel,
  .builder-panel {
    min-height: auto;
  }

  .selected-step {
    grid-template-columns: 74px minmax(0, 1fr);
    row-gap: 8px;
  }

  .selected-step .el-select,
  .selected-step .el-input {
    grid-column: 2;
  }

  .step-actions {
    grid-column: 2;
    text-align: left;
  }

  .process-structure-main,
  .process-structure-child {
    grid-template-columns: 28px minmax(92px, auto) minmax(0, 1fr);
  }

  .process-structure-child {
    margin-left: 14px;
  }
}

@media (max-width: 900px) {
  .process-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .process-actions .el-button {
    width: 100%;
  }

  .process-actions .action-tooltip-wrap {
    width: 100%;
  }

  .available-processes,
  .inline-process-create,
  .selected-steps {
    padding-right: 20px;
    padding-left: 20px;
  }

  .inline-process-create {
    grid-template-columns: 1fr;
  }

  .available-processes .el-button {
    flex: 0 1 auto;
    max-width: 100%;
    white-space: normal;
  }

  .selected-step {
    grid-template-columns: 74px minmax(0, 1fr);
    padding: 8px;
  }

  .selected-step .el-select,
  .selected-step .el-input {
    grid-column: 2;
    width: 100%;
  }

  .step-actions {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .step-actions .el-button {
    flex: 1 1 82px;
    min-width: 0;
    margin-left: 0;
  }
}
</style>
