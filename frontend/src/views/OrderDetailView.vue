<template>
  <section class="page" v-loading="loading">
    <div class="page-header">
      <h2 class="page-title">订单明细</h2>
      <div class="page-actions">
        <el-button :disabled="!order || order.status !== 'DRAFT'" @click="openEdit">编辑订单</el-button>
        <el-tooltip :content="additionalMaterialDisabledReason" :disabled="canAddAdditionalMaterial" placement="bottom">
          <span class="action-tooltip-wrap">
            <el-button :disabled="!canAddAdditionalMaterial" @click="openAdditionalMaterial">新增补单物料</el-button>
          </span>
        </el-tooltip>
        <el-tooltip :content="cancelOrderDisabledReason" :disabled="canCancelOrder" placement="bottom">
          <span class="action-tooltip-wrap">
            <el-button type="danger" plain :disabled="!canCancelOrder" @click="openCancelOrder">取消订单</el-button>
          </span>
        </el-tooltip>
        <el-button @click="goProcess">{{ processActionText }}</el-button>
        <el-button type="primary" :disabled="!order || order.status !== 'DRAFT'" :loading="saving" @click="openSubmitOrderDialog">提交生产</el-button>
      </div>
    </div>

    <template v-if="order">
      <div class="panel order-summary">
        <div>
          <div class="muted">当前订单</div>
          <strong>{{ order.orderNo }}</strong>
        </div>
        <div>
          <div class="muted">客户</div>
          <strong>{{ order.customerName }}</strong>
        </div>
        <div>
          <div class="muted">订单日期</div>
          <strong>{{ formatDate(order.orderDate) }}</strong>
        </div>
        <div>
          <div class="muted">交期</div>
          <strong>{{ formatDate(order.deliveryDate) }}</strong>
        </div>
        <div>
          <div class="muted">零件 / 客户订单</div>
          <strong>{{ order.partCount }} 个 / {{ formatOrderQuantity(order, 'totalQuantity') }}</strong>
        </div>
        <div>
          <div class="muted">生产计划</div>
          <strong>{{ formatOrderQuantity(order, 'totalProductionPlanQuantity') }}</strong>
        </div>
        <div>
          <div class="muted">状态</div>
          <StatusTag :value="orderDisplayStatus(order)" />
        </div>
        <div>
          <div class="muted">库存/发货状态</div>
          <StatusTag :value="order.warehouseStage" />
        </div>
      </div>

      <el-alert
        v-if="showProductionChangeHelp"
        title="已开始生产的订单不能再按待提交生产状态修改。补单、客户数量变更、新增物料都会同步通知生产；数量减少或取消会同时通知仓库等待转库存或报废处理。"
        type="warning"
        :closable="false"
        class="mt-16"
      />
      <el-alert
        v-if="productionChangeBlockingText"
        :title="productionChangeBlockingText"
        type="info"
        :closable="false"
        class="mt-16"
      />

      <div class="line-cards mt-24">
        <article v-for="line in order.lines" :key="line.id" class="line-card">
          <div class="line-title">
            <strong>{{ line.partName }}</strong>
            <span class="muted">订单 {{ formatQuantity(line.quantity, line.unit) }}</span>
          </div>
          <div class="muted">来源 {{ fulfillmentModeLabel(line.fulfillmentMode) }} / 生产计划 {{ formatQuantity(line.productionPlanQuantity, line.unit) }}</div>
          <div v-if="stockSourceSummary(line)" class="stock-source-summary">
            库存来源：{{ stockSourceSummary(line) }}
          </div>
          <div v-if="stockFulfillmentHint(line)" class="stock-fulfillment-hint">
            {{ stockFulfillmentHint(line) }}
          </div>
          <div class="muted">交期 {{ formatDate(line.deliveryDate || order.deliveryDate) }}</div>
          <div class="muted">{{ line.partCode }} / {{ line.drawingNo || '-' }} / 版本 {{ line.drawingVersion || '-' }}</div>
          <div class="muted">厚度 {{ line.partThickness }} mm / 成品规格 {{ line.partSpecification || '-' }}</div>
          <div class="line-status-row">
            <StatusTag :value="line.warehouseStage" compact />
            <span class="muted">{{ formatLineWarehouseText(line) }}</span>
          </div>
          <div v-if="formatLineShortageText(line)" class="line-shortage">
            {{ formatLineShortageText(line) }}
          </div>
          <div class="line-progress">{{ formatLineProductionProgressText(line) }}</div>
          <DrawingPreviewLink :file-name="line.drawingFileName" :file-url="line.drawingFileUrl" :title="`${line.partName} 图纸预览`" />
          <div class="process-chain mt-16">
            <span v-for="step in line.processSteps" :key="step" class="process-pill">{{ processStepDisplay(line, step) }}</span>
            <span v-if="line.processSteps.length === 0" class="muted">
              {{ lineRequiresProductionProcess(line) ? '未选择生产流程' : '当前生产计划为 0，无生产流程' }}
            </span>
          </div>
          <div class="line-actions">
            <el-tooltip :content="productionChangeDisabledReason(line)" :disabled="canCreateProductionChange(line)" placement="top">
              <span class="action-tooltip-wrap">
                <el-button size="small" :disabled="!canCreateProductionChange(line)" @click="openReplenishment(line)">订单补单</el-button>
              </span>
            </el-tooltip>
            <el-tooltip :content="productionChangeDisabledReason(line)" :disabled="canCreateProductionChange(line)" placement="top">
              <span class="action-tooltip-wrap">
                <el-button size="small" :disabled="!canCreateProductionChange(line)" @click="openQuantityChange(line)">数量变更</el-button>
              </span>
            </el-tooltip>
            <el-button
              v-for="task in cancelableReplenishmentTasks(line)"
              :key="task.productionTaskNo"
              size="small"
              type="danger"
              plain
              @click="openCancelReplenishment(line, task)"
            >
              取消补单 {{ task.productionTaskNo }}
            </el-button>
          </div>
        </article>
      </div>

      <div class="table-card mt-24 desktop-table">
        <el-table :data="order.lines" max-height="max(260px, calc(100vh - 520px))">
          <el-table-column prop="lineNo" label="序号" width="80" />
          <el-table-column prop="partCode" label="零件编码" width="140" />
          <el-table-column prop="partName" label="零件名称" min-width="180" />
          <el-table-column prop="drawingNo" label="图号" width="150" />
          <el-table-column prop="drawingVersion" label="图纸版本" width="100" />
          <el-table-column label="厚度(mm)" width="110">
            <template #default="{ row }">{{ row.partThickness }}</template>
          </el-table-column>
          <el-table-column label="成品规格" min-width="170">
            <template #default="{ row }">{{ row.partSpecification || '-' }}</template>
          </el-table-column>
          <el-table-column label="图纸文件" min-width="160">
            <template #default="{ row }">
              <DrawingPreviewLink
                v-if="row.drawingFileUrl"
                :file-name="row.drawingFileName"
                :file-url="row.drawingFileUrl"
                :title="`${row.partName} 图纸预览`"
              />
              <span v-else class="muted">未上传</span>
            </template>
          </el-table-column>
          <el-table-column label="零件交期" width="120">
            <template #default="{ row }">{{ formatDate(row.deliveryDate || order.deliveryDate) }}</template>
          </el-table-column>
          <el-table-column label="客户订单数量" width="140">
            <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="生产计划数量" width="140">
            <template #default="{ row }">
              <div>{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</div>
              <small v-if="stockFulfillmentHint(row)" class="stock-fulfillment-hint-inline">
                {{ stockFulfillmentHint(row) }}
              </small>
            </template>
          </el-table-column>
          <el-table-column label="库存/生产方式" width="130">
            <template #default="{ row }">{{ fulfillmentModeLabel(row.fulfillmentMode) }}</template>
          </el-table-column>
          <el-table-column label="已选库存来源" min-width="260">
            <template #default="{ row }">
              <span v-if="stockSourceSummary(row)" class="stock-source-summary-inline">
                {{ stockSourceSummary(row) }}
              </span>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="完成数量" width="120">
            <template #default="{ row }">
              {{ row.completedQuantity ? formatQuantity(row.completedQuantity, row.unit) : '-' }}
            </template>
          </el-table-column>
          <el-table-column label="短缺 / 补单" min-width="220">
            <template #default="{ row }">
              <span :class="{ 'line-shortage-inline': formatLineShortageText(row) }">
                {{ formatLineShortageText(row) || '-' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="当前生产进度" min-width="260">
            <template #default="{ row }">{{ formatLineProductionProgressText(row) }}</template>
          </el-table-column>
          <el-table-column label="库存/发货状态" width="135">
            <template #default="{ row }">
              <StatusTag :value="row.warehouseStage" compact />
            </template>
          </el-table-column>
          <el-table-column label="库存批次 / 库位" min-width="190">
            <template #default="{ row }">{{ formatLineWarehouseText(row) }}</template>
          </el-table-column>
          <el-table-column label="生产流程" min-width="360">
            <template #default="{ row }">
              <div class="process-chain">
                <span v-for="step in row.processSteps" :key="step" class="process-pill">{{ processStepDisplay(row, step) }}</span>
                <span v-if="row.processSteps.length === 0" class="muted">
                  {{ lineRequiresProductionProcess(row) ? '未选择生产流程' : '当前生产计划为 0，无生产流程' }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="生产数量变更" width="210" fixed="right">
            <template #default="{ row }">
              <el-tooltip :content="productionChangeDisabledReason(row)" :disabled="canCreateProductionChange(row)" placement="top">
                <span class="action-tooltip-wrap">
                  <el-button link type="primary" :disabled="!canCreateProductionChange(row)" @click="openReplenishment(row)">订单补单</el-button>
                </span>
              </el-tooltip>
              <el-tooltip :content="productionChangeDisabledReason(row)" :disabled="canCreateProductionChange(row)" placement="top">
                <span class="action-tooltip-wrap">
                  <el-button link type="primary" :disabled="!canCreateProductionChange(row)" @click="openQuantityChange(row)">变更</el-button>
                </span>
              </el-tooltip>
              <el-button
                v-for="task in cancelableReplenishmentTasks(row)"
                :key="task.productionTaskNo"
                link
                type="danger"
                @click="openCancelReplenishment(row, task)"
              >
                取消补单
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <el-dialog v-model="editVisible" title="编辑订单零件" width="min(1500px, calc(100vw - 32px))">
      <el-form label-width="86px">
        <div class="order-edit-grid">
          <el-form-item label="订单号">
            <div class="order-no-field">
              <el-input v-model="editForm.orderNo" placeholder="待提交生产订单号可修改，系统自动查重" @input="scheduleEditOrderNoCheck" />
            </div>
            <div
              v-if="orderNoCheckText"
              :class="['order-no-check', checkingOrderNo ? 'checking' : orderNoAvailable ? 'available' : 'duplicated']"
            >
              {{ orderNoCheckText }}
            </div>
          </el-form-item>
          <el-form-item label="交期">
            <el-date-picker v-model="editForm.deliveryDate" type="date" value-format="YYYY-MM-DD" />
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
          <el-button size="small" @click="addLine">新增零件</el-button>
        </div>

        <OrderLineEditor
          :lines="editForm.lines"
          :default-delivery-date="editForm.deliveryDate"
          :exclude-order-no="order?.orderNo || ''"
          :inventory-summary="inventorySummary"
          @remove="removeLine"
          @quantity-change="syncPlanQuantity"
        />
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="additionalMaterialVisible" title="新增补单物料" width="min(1280px, calc(100vw - 32px))">
      <el-alert
        title="只能用于订单已经开始生产后，客户在原订单基础上新增物料。未开始生产的订单必须编辑订单，不允许走补单。"
        type="warning"
        :closable="false"
        class="mb-16"
      />
      <el-form label-width="96px">
        <div class="order-edit-grid">
          <el-form-item label="订单号">
            <strong>{{ order?.orderNo }}</strong>
          </el-form-item>
          <el-form-item label="当前生产">
            <span>{{ orderProgressHint }}</span>
          </el-form-item>
        </div>

        <OrderLineEditor
          :lines="additionalMaterialLines"
          :min-lines="1"
          :default-delivery-date="order?.deliveryDate?.slice(0, 10) || ''"
          :exclude-order-no="order?.orderNo || ''"
          :inventory-summary="inventorySummary"
          @remove="removeAdditionalMaterialLine"
          @quantity-change="syncPlanQuantity"
        />

        <div class="additional-material-extra">
          <el-form-item label="生产流程" required>
            <div class="additional-process-editor">
              <el-input
                v-model="additionalProcessQuickKeyword"
                clearable
                placeholder="搜索工序 / 拼音 / 首字母"
                class="additional-process-search"
              />
              <div class="additional-process-picker">
                <el-button v-for="item in filteredAdditionalQuickProcessOptions" :key="item" round @click="addAdditionalMaterialProcess(item)">
                  {{ item }}
                </el-button>
                <span v-if="additionalProcessQuickKeyword && filteredAdditionalQuickProcessOptions.length === 0" class="process-empty-text">
                  没有匹配工序
                </span>
              </div>
              <div class="additional-process-create">
                <el-input v-model="newAdditionalProcessName" placeholder="新建标准工序，例如 抛丸、抛光" maxlength="30" />
                <el-button :loading="creatingProcess" @click="createAdditionalProcessDefinition">新建工序</el-button>
                <el-button @click="processDefinitionManagerVisible = true">管理工序</el-button>
              </div>
              <div class="additional-process-steps">
                <div
                  v-for="(step, index) in additionalMaterialProcessSteps"
                  :key="`${index}-${step.processName}`"
                  class="additional-process-row"
                >
                  <span class="step-index">{{ index + 1 }}</span>
                  <el-select
                    v-model="step.processName"
                    filterable
                    placeholder="标准工序 / 拼音 / 首字母"
                    :filter-method="handleAdditionalProcessFilter"
                    @change="handleAdditionalProcessStepChange"
                    @visible-change="handleAdditionalProcessVisibleChange"
                  >
                    <el-option v-for="item in filteredAdditionalProcessOptions" :key="item" :label="item" :value="item" />
                  </el-select>
                  <el-input v-model="step.processRemark" placeholder="参数备注，例如 4次 / M6孔 / 按图纸" />
                  <div class="additional-process-actions">
                    <el-button link :disabled="index === 0" @click="moveAdditionalMaterialProcess(index, -1)">上移</el-button>
                    <el-button
                      link
                      :disabled="index === additionalMaterialProcessSteps.length - 1"
                      @click="moveAdditionalMaterialProcess(index, 1)"
                    >
                      下移
                    </el-button>
                    <el-button link type="danger" @click="removeAdditionalMaterialProcess(index)">删除</el-button>
                  </div>
                </div>
              </div>
              <div class="process-help-text">工序名称只选择标准工序；次数、参数和特殊要求写入参数备注，避免后期统计混乱。</div>
            </div>
          </el-form-item>
          <el-form-item label="管理人员">
            <el-input v-model="additionalMaterialForm.managerName" placeholder="可选" style="width: min(420px, 100%)" />
          </el-form-item>
          <el-form-item label="新增原因" required>
            <el-input
              v-model="additionalMaterialForm.reason"
              type="textarea"
              :rows="3"
              placeholder="例如：客户在原订单基础上追加新物料"
            />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="additionalMaterialVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveAdditionalMaterial">生成新增物料补单</el-button>
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
        title="订单明细标准工序"
        hint="这里维护补单物料和生产流程可选的标准工序；修改后会刷新当前页面的工序下拉列表。"
        @updated="handleProcessDefinitionsUpdated"
      />
    </el-dialog>

    <el-dialog
      v-model="submitOrderVisible"
      title="提交生产确认"
      width="min(760px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :show-close="!saving"
      @closed="resetSubmitOrderDialog"
    >
      <div v-if="order" class="submit-order-confirm">
        <el-alert
          title="提交后会生成生产任务；使用库存或库存再加工会在提交时重新校验库存来源并写入库存流水。提交后不能再按待提交生产状态编辑。"
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
        <div class="submit-order-summary">
          <p class="submit-order-row">
            <span>订单号</span>
            <strong>{{ order.orderNo }}</strong>
          </p>
          <p class="submit-order-row">
            <span>客户</span>
            <strong>{{ order.customerName }}</strong>
          </p>
          <p class="submit-order-row">
            <span>客户订单</span>
            <strong>{{ formatOrderQuantity(order, 'totalQuantity') }}</strong>
          </p>
          <p class="submit-order-row">
            <span>生产计划</span>
            <strong>{{ formatOrderQuantity(order, 'totalProductionPlanQuantity') }}</strong>
          </p>
        </div>
        <div class="submit-order-lines">
          <article v-for="line in order.lines" :key="line.id" class="submit-order-line">
            <div>
              <strong>{{ line.partCode }} / {{ line.partName }}</strong>
              <span>{{ fulfillmentModeLabel(line.fulfillmentMode) }}，订单 {{ formatQuantity(line.quantity, line.unit) }}，生产计划 {{ formatQuantity(line.productionPlanQuantity, line.unit) }}</span>
            </div>
            <small v-if="stockSourceSummary(line)">库存来源：{{ stockSourceSummary(line) }}</small>
            <small v-if="submitOrderLineWarning(line)" class="submit-order-line-warning">
              {{ submitOrderLineWarning(line) }}
            </small>
          </article>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="saving" @click="closeSubmitOrderDialog">返回</el-button>
        <el-button type="primary" :disabled="!submitPlanOperatorCode" :loading="saving" @click="confirmSubmitOrder">确认提交生产</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="replenishmentVisible" title="创建订单补单" width="min(560px, calc(100vw - 32px))">
      <el-alert
        title="这里用于销售或计划决定的客户追加、订单数量增加。生产过程中因报废缺件需要补齐时，必须在生产页面提交生产报废补单申请，由车间主管确认。"
        type="info"
        :closable="false"
        class="mb-16"
      />
      <el-form label-width="96px">
        <el-form-item label="订单号">
          <strong>{{ order?.orderNo }}</strong>
        </el-form-item>
        <el-form-item label="物料">
          <strong>{{ activeLine?.partCode }} / {{ activeLine?.partName }}</strong>
        </el-form-item>
        <el-form-item label="当前生产进度">
          <span>{{ activeLine ? formatLineProductionProgressText(activeLine) : '-' }}</span>
        </el-form-item>
        <el-form-item label="补单数量" required>
          <el-input-number v-model="replenishmentForm.quantity" :min="0.001" :precision="3" :controls="false" />
          <span class="form-unit">{{ activeLine?.unit }}</span>
        </el-form-item>
        <el-form-item label="管理人员">
          <el-input v-model="replenishmentForm.managerName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="补单原因" required>
          <el-input v-model="replenishmentForm.reason" type="textarea" :rows="3" placeholder="例如：客户追加数量、销售漏下物料、计划数量调整" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="replenishmentVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveReplenishment">生成订单补单</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="cancelReplenishmentVisible" title="取消补单" width="min(620px, calc(100vw - 32px))">
      <el-alert
        title="只允许取消未开始生产的补单。补单已经开工后不能直接删除，必须到生产页面走管理撤回。"
        type="warning"
        :closable="false"
        class="mb-16"
      />
      <el-form label-width="116px">
        <el-form-item label="订单号">
          <strong>{{ order?.orderNo }}</strong>
        </el-form-item>
        <el-form-item label="补单任务">
          <strong>{{ activeReplenishmentTask?.productionTaskNo }}</strong>
        </el-form-item>
        <el-form-item label="物料">
          <strong>{{ activeLine?.partCode }} / {{ activeLine?.partName }}</strong>
        </el-form-item>
        <el-form-item label="补单数量">
          <span>{{ activeReplenishmentTask ? formatQuantity(activeReplenishmentTask.plannedQuantity, activeLine?.unit || order?.unit || '件') : '-' }}</span>
        </el-form-item>
        <el-form-item label="管理人员" required>
          <el-input v-model="cancelReplenishmentForm.managerName" placeholder="填写管理人员姓名" />
        </el-form-item>
        <el-form-item label="取消原因" required>
          <el-input v-model="cancelReplenishmentForm.reason" type="textarea" :rows="4" placeholder="例如：重复补单、客户取消追加数量" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cancelReplenishmentVisible = false">返回</el-button>
        <el-button type="danger" :loading="saving" @click="saveCancelReplenishment">确认取消补单</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="quantityChangeVisible" title="客户数量变更" width="min(640px, calc(100vw - 32px))">
      <el-alert
        title="已开始生产的订单不能按待提交生产状态编辑。数量减少或取消会通知生产管理确认已生产物料转库存或销毁；数量增加会生成补单任务。"
        type="warning"
        :closable="false"
        class="mb-16"
      />
      <el-form label-width="116px">
        <el-form-item label="物料">
          <strong>{{ activeLine?.partCode }} / {{ activeLine?.partName }}</strong>
        </el-form-item>
        <el-form-item label="当前生产进度">
          <span>{{ activeLine ? formatLineProductionProgressText(activeLine) : '-' }}</span>
        </el-form-item>
        <el-form-item label="原客户数量">
          <span>{{ activeLine ? formatQuantity(activeLine.quantity, activeLine.unit) : '-' }}</span>
        </el-form-item>
        <el-form-item label="新客户数量" required>
          <el-input-number v-model="quantityChangeForm.quantity" :min="0" :precision="3" :controls="false" />
          <span class="form-unit">{{ activeLine?.unit }}</span>
        </el-form-item>
        <el-form-item label="生产计划数量">
          <el-input-number v-model="quantityChangeForm.productionPlanQuantity" :min="0" :precision="3" :controls="false" />
          <span class="form-unit">{{ activeLine?.unit }}</span>
          <div class="form-hint">{{ quantityChangePlanHint }}</div>
        </el-form-item>
        <template v-if="quantityChangeNeedsPlanOverride">
          <el-form-item label="调整操作员" required>
            <el-input v-model="quantityChangeForm.productionPlanOverrideByCode" placeholder="填写下单/计划操作员账号，例如 PLAN-001" />
          </el-form-item>
          <el-form-item label="计划偏差说明" required>
            <el-input
              v-model="quantityChangeForm.productionPlanOverrideReason"
              type="textarea"
              :rows="3"
              placeholder="例如：备货多做、找到其他替代不计入库存的产品、客户确认少做"
            />
          </el-form-item>
        </template>
        <el-form-item label="管理人员">
          <el-input v-model="quantityChangeForm.managerName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="变更原因" required>
          <el-input v-model="quantityChangeForm.reason" type="textarea" :rows="3" placeholder="例如：客户追加、客户减少、客户取消" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quantityChangeVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveQuantityChange">确认变更</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="cancelOrderVisible" title="取消订单" width="min(980px, calc(100vw - 32px))">
      <el-alert
        :title="cancelOrderNoticeText"
        type="warning"
        :closable="false"
        class="mb-16"
      />
      <el-form label-width="116px">
        <el-form-item label="订单号">
          <strong>{{ order?.orderNo }}</strong>
        </el-form-item>
        <el-form-item label="当前生产">
          <span>{{ orderProgressHint }}</span>
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
          <div class="form-hint">必须人工确认。已生产取消后，仓库需要逐项确认转库存或报废。</div>
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
          <el-input v-model="cancelOrderForm.reason" type="textarea" :rows="4" placeholder="例如：客户取消订单、客户项目暂停" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cancelOrderVisible = false">返回</el-button>
        <el-button type="danger" :loading="saving" @click="saveCancelOrder">确认取消订单</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import type { CreateOrderLinePayload } from '../api/erp';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { WarningFilled } from '@element-plus/icons-vue';
import { useRoute, useRouter } from 'vue-router';
import { erpApi } from '../api/erp';
import DrawingPreviewLink from '../components/DrawingPreviewLink.vue';
import OrderLineEditor from '../components/OrderLineEditor.vue';
import ProcessDefinitionManager from '../components/ProcessDefinitionManager.vue';
import StatusTag from '../components/StatusTag.vue';
import type {
  InventorySummaryRow,
  OrderDetail,
  OrderLine,
  OrderLineProductionTask,
  ProcessStepDetail,
  ProductionOperator
} from '../types/erp';
import { formatDate, formatDateTime, formatQuantity } from '../utils/format';
import { orderDisplayStatus } from '../utils/orderStatus';
import {
  confirmDuplicateDrawingFiles,
  confirmDuplicateDrawingNos,
  confirmExistingDrawingFiles,
  confirmExistingDrawingNos
} from '../utils/orderLineDuplicateChecks';
import { validateStockModeLines } from '../utils/orderLineStockChecks';
import { filterPinyinSearchOptions } from '../utils/pinyinSearch';
import {
  normalizeSelectedStockSources,
  restoreSavedStockSourceReview,
  sanitizeOrderLinePayload,
  selectedStockSourceQuantity,
  validateDraftStockSourceLines
} from '../utils/stockSourceReview';
import { validateSubmitStockSources } from '../utils/submitStockSourceChecks';

const route = useRoute();
const router = useRouter();
const order = ref<OrderDetail>();
const inventorySummary = ref<InventorySummaryRow[]>([]);
const loading = ref(false);
const saving = ref(false);
const editVisible = ref(false);
const additionalMaterialVisible = ref(false);
const replenishmentVisible = ref(false);
const cancelReplenishmentVisible = ref(false);
const quantityChangeVisible = ref(false);
const cancelOrderVisible = ref(false);
const processDefinitionManagerVisible = ref(false);
const submitOrderVisible = ref(false);
const submitPlanOperatorCode = ref('');
const submitPlanOperators = ref<ProductionOperator[]>([]);
const submitPlanOperatorLoading = ref(false);
const operatorCache = reactive<Record<string, ProductionOperator>>({});
const activeLine = ref<OrderLine>();
const activeReplenishmentTask = ref<OrderLineProductionTask>();
const checkingOrderNo = ref(false);
const orderNoAvailable = ref(false);
const orderNoCheckText = ref('');
let editOrderNoCheckTimer: ReturnType<typeof window.setTimeout> | undefined;
let editOrderNoCheckSequence = 0;
const editForm = ref<{
  orderNo: string;
  deliveryDate?: string;
  lines: CreateOrderLinePayload[];
}>({
  orderNo: '',
  deliveryDate: '',
  lines: []
});
const additionalMaterialLines = ref<CreateOrderLinePayload[]>([newLine(0)]);
const additionalMaterialProcessSteps = ref<ProcessStepDetail[]>([]);
const additionalMaterialForm = ref({
  managerName: '',
  reason: ''
});
const replenishmentForm = ref({
  quantity: 1,
  managerName: '',
  reason: ''
});
const cancelReplenishmentForm = ref({
  managerName: '',
  reason: ''
});
const processOptions = ref<string[]>([]);
const additionalProcessQuickKeyword = ref('');
const additionalProcessFilterKeyword = ref('');
const newAdditionalProcessName = ref('');
const creatingProcess = ref(false);
const quantityChangeForm = ref({
  quantity: 0,
  productionPlanQuantity: 0,
  productionPlanOverrideByCode: '',
  productionPlanOverrideReason: '',
  managerName: '',
  reason: ''
});
const cancelOrderForm = ref({
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
const submitPlanOperatorOptionRows = computed(() => operatorRowsWithSelected(submitPlanOperators.value, submitPlanOperatorCode.value));
const canAddAdditionalMaterial = computed(() =>
  Boolean(
    order.value &&
      order.value.status !== 'DRAFT' &&
      order.value.status !== 'CANCELLED' &&
      order.value.status !== 'COMPLETED' &&
      order.value.lines.some((line) => canCreateProductionChange(line))
  )
);
const canCancelOrder = computed(() =>
  Boolean(
    order.value &&
      order.value.status !== 'CANCELLED' &&
      order.value.status !== 'COMPLETED'
  )
);
const additionalMaterialDisabledReason = computed(() => orderProductionChangeDisabledReason('新增补单物料'));
const filteredAdditionalQuickProcessOptions = computed(() =>
  filterPinyinSearchOptions(processOptions.value, additionalProcessQuickKeyword.value)
);
const filteredAdditionalProcessOptions = computed(() => filterPinyinSearchOptions(processOptions.value, additionalProcessFilterKeyword.value));
const cancelOrderDisabledReason = computed(() => {
  if (!order.value) {
    return '订单数据未加载';
  }
  if (order.value.status === 'CANCELLED') {
    return '订单已取消';
  }
  if (order.value.status === 'COMPLETED') {
    return '已完成订单第一阶段不允许直接取消';
  }
  return '';
});
const cancelOrderNoticeText = computed(() => {
  if (!order.value) {
    return '';
  }
  const hasStartedProduction = order.value.lines.some((line) => line.productionStatus && line.productionStatus !== 'PENDING');
  if (hasStartedProduction) {
    return '取消后客户订单数量归零，未开始的生产任务会删除，已开始生产的任务会通知生产和仓库确认转库存或销毁。';
  }
  return '订单尚未开始生产，取消后系统会删除未开工生产任务，并释放已占用的订单库存。';
});
const productionChangeBlockingText = computed(() => {
  if (
    !order.value ||
    order.value.status === 'DRAFT' ||
    order.value.status === 'CANCELLED' ||
    order.value.status === 'COMPLETED' ||
    order.value.lines.some((line) => canCreateProductionChange(line))
  ) {
    return '';
  }
  return '当前订单已提交但还没有任何零件开始生产。需要补单、数量变化或取消时，应先修改订单；只有生产开始后才走生产数量变更流程。';
});
const showProductionChangeHelp = computed(() =>
  Boolean(
    order.value &&
      order.value.status !== 'DRAFT' &&
      order.value.status !== 'CANCELLED' &&
      order.value.status !== 'COMPLETED'
  )
);
const orderProgressHint = computed(() => {
  const startedLines = order.value?.lines.filter((line) => line.productionStatus && line.productionStatus !== 'PENDING') || [];
  if (startedLines.length === 0) {
    return '尚未开始生产';
  }
  const visibleLines = startedLines
    .slice(0, 4)
    .map((line) => `${line.partCode} ${productionStatusText(line.productionStatus)}`)
    .join('；');
  const hiddenCount = startedLines.length - 4;
  return hiddenCount > 0 ? `${visibleLines}；另 ${hiddenCount} 个零件` : visibleLines;
});
const orderProgressStarted = computed(() => orderProgressHint.value !== '尚未开始生产');
const processActionText = computed(() => {
  if (order.value?.status === 'DRAFT') {
    return '提交生产';
  }
  return order.value ? orderWarehouseActionText(order.value) || '生产详情' : '生产详情';
});
const quantityChangeSuggestedProductionQuantity = computed(() => {
  const orderQuantity = Math.max(Number(quantityChangeForm.value.quantity || 0), 0);
  if (activeLine.value?.fulfillmentMode !== 'STOCK') {
    return orderQuantity;
  }
  const selectedStockQuantity = (activeLine.value.selectedStockSources || []).reduce(
    (sum, source) => sum + Number(source.quantity || 0),
    0
  );
  return Math.max(orderQuantity - selectedStockQuantity, 0);
});
const quantityChangeNeedsPlanOverride = computed(
  () =>
    Math.abs(
      Math.max(Number(quantityChangeForm.value.productionPlanQuantity || 0), 0) -
        quantityChangeSuggestedProductionQuantity.value
    ) > 0.0001
);
const quantityChangePlanHint = computed(() => {
  const unit = activeLine.value?.unit || '件';
  const suggested = quantityChangeSuggestedProductionQuantity.value;
  const current = Math.max(Number(quantityChangeForm.value.productionPlanQuantity || 0), 0);
  if (quantityChangeNeedsPlanOverride.value) {
    return `建议生产 ${formatQuantity(suggested, unit)}，当前计划 ${formatQuantity(current, unit)}；必须记录操作人员账号和说明。`;
  }
  return `建议生产 ${formatQuantity(suggested, unit)}。`;
});

async function loadOrder() {
  const orderNo = String(route.params.orderNo);
  loading.value = true;
  try {
    order.value = await erpApi.order(orderNo);
  } catch (error) {
    order.value = undefined;
    ElMessage.error(error instanceof Error ? error.message : '订单明细加载失败');
  } finally {
    loading.value = false;
  }
}

function goProcess() {
  if (order.value) {
    if (order.value.status !== 'DRAFT') {
      if (orderWarehouseActionText(order.value)) {
        void router.push({
          path: '/warehouses',
          query: {
            orderNo: order.value.orderNo,
            returnTo: `/orders/${encodeURIComponent(order.value.orderNo)}`
          }
        });
        return;
      }
      void router.push({
        path: '/production',
        query: {
          orderNo: order.value.orderNo,
          returnTo: `/orders/${encodeURIComponent(order.value.orderNo)}`
        }
      });
      return;
    }
    void router.push({
      path: '/processes',
      query: {
        orderNo: order.value.orderNo,
        open: 'edit',
        returnTo: `/orders/${encodeURIComponent(order.value.orderNo)}`
      }
    });
  }
}

async function openEdit() {
  if (!order.value || order.value.status !== 'DRAFT') {
    return;
  }
  if (!(await loadInventorySummary())) {
    return;
  }
  const lines = order.value.lines.map((line) => ({
    partCode: line.partCode,
    partName: line.partName,
    drawingNo: line.drawingNo,
    drawingVersion: line.drawingVersion || 'A',
    drawingFileName: line.drawingFileName || '',
    drawingFileUrl: line.drawingFileUrl || '',
    partThickness: line.partThickness || 1,
    partSpecification: line.partSpecification || '',
    quantity: line.quantity,
    productionPlanQuantity: line.productionPlanQuantity,
    productionPlanSuggestedQuantity: line.productionPlanSuggestedQuantity,
    productionPlanOverrideByCode: line.productionPlanOverrideByCode || '',
    productionPlanOverrideByName: line.productionPlanOverrideByName || '',
    productionPlanOverrideByRole: line.productionPlanOverrideByRole || '',
    productionPlanOverrideAt: line.productionPlanOverrideAt || '',
    productionPlanOverrideReason: line.productionPlanOverrideReason || '',
    fulfillmentMode: line.fulfillmentMode || 'PRODUCTION',
    unit: line.unit,
    deliveryDate: line.deliveryDate?.slice(0, 10),
    remark: line.remark,
    selectedStockSources: line.selectedStockSources || [],
    processSteps: line.processStepDetails?.length ? line.processStepDetails : line.processSteps.map((processName) => ({ processName }))
  }));
  lines.forEach(restoreSavedStockSourceReview);
  editForm.value = {
    orderNo: order.value.orderNo,
    deliveryDate: order.value.deliveryDate?.slice(0, 10),
    lines
  };
  orderNoAvailable.value = true;
  orderNoCheckText.value = '订单号未修改';
  editOrderNoCheckSequence += 1;
  editVisible.value = true;
}

function canCreateProductionChange(line: OrderLine) {
  return Boolean(
    order.value &&
      order.value.status !== 'DRAFT' &&
      order.value.status !== 'CANCELLED' &&
      order.value.status !== 'COMPLETED' &&
      line.productionTaskNo &&
      line.productionStatus !== 'PENDING'
  );
}

function orderProductionChangeDisabledReason(actionName: string) {
  if (!order.value) {
    return '订单数据未加载';
  }
  if (order.value.status === 'DRAFT') {
    return `待提交生产订单还未提交生产，${actionName}前请直接编辑订单`;
  }
  if (order.value.status === 'CANCELLED') {
    return `订单已取消，不能${actionName}`;
  }
  if (order.value.status === 'COMPLETED') {
    return `订单已完成，不能${actionName}`;
  }
  if (!order.value.lines.some((line) => canCreateProductionChange(line))) {
    return `订单尚未开始生产，${actionName}应先修改订单，不能走生产数量变更`;
  }
  return '';
}

function productionChangeDisabledReason(line: OrderLine) {
  if (!order.value) {
    return '订单数据未加载';
  }
  if (order.value.status === 'DRAFT') {
    return '待提交生产订单还未提交生产，请直接编辑订单';
  }
  if (order.value.status === 'CANCELLED') {
    return '订单已取消，不能补单或数量变更';
  }
  if (order.value.status === 'COMPLETED') {
    return '订单已完成，不能补单或数量变更';
  }
  if (!line.productionTaskNo) {
    return '该零件没有生产任务，通常是使用库存或尚未提交生产';
  }
  if (line.productionStatus === 'PENDING') {
    return '该零件尚未开始生产，请修改订单，不要创建补单或生产数量变更';
  }
  return '';
}

function processStepDisplay(line: OrderLine, processName: string) {
  const remark = line.processStepDetails?.find((item) => item.processName === processName)?.processRemark?.trim();
  return remark ? `${processName}（${remark}）` : processName;
}

async function openAdditionalMaterial() {
  if (!order.value) {
    return;
  }
  if (!canAddAdditionalMaterial.value) {
    ElMessage.warning('订单还没有开始生产，请编辑订单，不要创建新增物料补单');
    return;
  }
  if (!(await loadInventorySummary())) {
    return;
  }
  const line = newLine(order.value.lines.length);
  line.partCode = `P-${Date.now().toString().slice(-4)}-A`;
  line.deliveryDate = order.value.deliveryDate?.slice(0, 10);
  line.processSteps = [];
  additionalMaterialProcessSteps.value = [];
  additionalProcessFilterKeyword.value = '';
  line.fulfillmentMode = 'PRODUCTION';
  additionalMaterialLines.value = [line];
  additionalMaterialForm.value = {
    managerName: '',
    reason: ''
  };
  additionalMaterialVisible.value = true;
}

function removeAdditionalMaterialLine() {
  additionalMaterialLines.value = [newLine(order.value?.lines.length || 0)];
  additionalMaterialProcessSteps.value = [];
  additionalProcessFilterKeyword.value = '';
}

function normalizeAdditionalMaterialProcessSteps(steps: ProcessStepDetail[]) {
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

async function loadProcessDefinitions() {
  try {
    const rows = await erpApi.processDefinitions(undefined, 'ENABLED');
    processOptions.value = rows.map((row) => row.processName);
  } catch (error) {
    processOptions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '标准工序加载失败');
  }
}

async function handleProcessDefinitionsUpdated() {
  await loadProcessDefinitions();
}

async function createAdditionalProcessDefinition() {
  const processName = newAdditionalProcessName.value.trim();
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
    newAdditionalProcessName.value = '';
    ElMessage.success('标准工序已创建');
    addAdditionalMaterialProcess(created.processName);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '标准工序创建失败，请确认是否重复');
  } finally {
    creatingProcess.value = false;
  }
}

function normalizeAdditionalMaterialProcesses() {
  additionalMaterialProcessSteps.value = normalizeAdditionalMaterialProcessSteps(additionalMaterialProcessSteps.value);
  const duplicates = duplicateAdditionalMaterialProcessNames(additionalMaterialProcessSteps.value);
  if (duplicates.length > 0) {
    ElMessage.warning(`新增物料流程存在重复工序：${duplicates.join('、')}，请把次数或特殊要求写入参数备注`);
  }
}

function handleAdditionalProcessStepChange() {
  normalizeAdditionalMaterialProcesses();
  additionalProcessFilterKeyword.value = '';
}

function handleAdditionalProcessFilter(keyword: string) {
  additionalProcessFilterKeyword.value = keyword;
}

function handleAdditionalProcessVisibleChange(visible: boolean) {
  if (!visible) {
    additionalProcessFilterKeyword.value = '';
  }
}

function addAdditionalMaterialProcess(processName: string) {
  const processKey = normalizeProcessNameKey(processName);
  if (additionalMaterialProcessSteps.value.some((step) => normalizeProcessNameKey(step.processName) === processKey)) {
    ElMessage.warning('该标准工序已存在，请把次数或特殊要求写入参数备注');
    return;
  }
  additionalMaterialProcessSteps.value.push({ processName, processRemark: '' });
  additionalProcessFilterKeyword.value = '';
}

function moveAdditionalMaterialProcess(index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= additionalMaterialProcessSteps.value.length) {
    return;
  }
  const steps = [...additionalMaterialProcessSteps.value];
  const [current] = steps.splice(index, 1);
  steps.splice(target, 0, current);
  additionalMaterialProcessSteps.value = steps;
}

function removeAdditionalMaterialProcess(index: number) {
  additionalMaterialProcessSteps.value.splice(index, 1);
}

function duplicateAdditionalMaterialProcessNames(steps: ProcessStepDetail[]) {
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

function openReplenishment(line: OrderLine) {
  if (!canCreateProductionChange(line)) {
    ElMessage.warning('该物料还没有开始生产，请修改订单，不要创建补单');
    return;
  }
  activeLine.value = line;
  replenishmentForm.value = {
    quantity: 1,
    managerName: '',
    reason: ''
  };
  replenishmentVisible.value = true;
}

function openQuantityChange(line: OrderLine) {
  if (!canCreateProductionChange(line)) {
    ElMessage.warning('该物料还没有开始生产，请修改订单，不要走生产数量变更');
    return;
  }
  activeLine.value = line;
  quantityChangeForm.value = {
    quantity: line.quantity,
    productionPlanQuantity: line.productionPlanQuantity,
    productionPlanOverrideByCode: line.productionPlanOverrideByCode || '',
    productionPlanOverrideReason: line.productionPlanOverrideReason || '',
    managerName: '',
    reason: ''
  };
  quantityChangeVisible.value = true;
}

function cancelableReplenishmentTasks(line: OrderLine) {
  return (line.productionTasks || []).filter(
    (task) => task.isReplenishment && task.replenishmentSourceType !== 'PRODUCTION_SCRAP' && task.canCancelReplenishment
  );
}

function openCancelReplenishment(line: OrderLine, task: OrderLineProductionTask) {
  if (!task.canCancelReplenishment) {
    ElMessage.warning('补单已经开始生产，请到生产页面使用管理撤回');
    return;
  }
  activeLine.value = line;
  activeReplenishmentTask.value = task;
  cancelReplenishmentForm.value = {
    managerName: '',
    reason: ''
  };
  cancelReplenishmentVisible.value = true;
}

function openCancelOrder() {
  if (!order.value) {
    return;
  }
  if (!canCancelOrder.value) {
    ElMessage.warning(cancelOrderDisabledReason.value || '当前订单不能取消');
    return;
  }
  cancelOrderForm.value = {
    cancelAt: formatDateTime(new Date().toISOString()),
    managerName: '',
    productionCancelState: orderProgressStarted.value ? 'PRODUCED' : 'NOT_PRODUCED',
    reason: ''
  };
  cancelHandlingPlanRows.value = buildCancelHandlingPlanRows(order.value);
  cancelOrderVisible.value = true;
}

function taskHasProductionProgress(task: OrderLineProductionTask) {
  return task.status !== 'PENDING' || task.completedQuantity > 0;
}

function buildCancelHandlingPlanRows(orderDetail: OrderDetail) {
  return orderDetail.lines.flatMap((line: OrderLine) =>
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
  if (cancelOrderForm.value.productionCancelState !== 'PRODUCED') {
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

function newLine(index: number): CreateOrderLinePayload {
  return {
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

function addLine() {
  editForm.value.lines.push(newLine(editForm.value.lines.length));
}

function removeLine(index: number) {
  // 订单编辑允许删除误填零件，但至少保留 1 个订单零件。
  if (editForm.value.lines.length > 1) {
    editForm.value.lines.splice(index, 1);
    return;
  }
  editForm.value.lines = [newLine(0)];
  ElMessage.info('订单至少保留一行，已清空当前零件');
}

async function saveEdit() {
  if (!order.value) {
    return;
  }
  if (!editForm.value.orderNo.trim()) {
    ElMessage.warning('请填写订单号');
    return;
  }
  if (
    editForm.value.lines.some(
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
  const stockCheck = validateStockModeLines(editForm.value.lines, inventorySummary.value);
  if (!stockCheck.ok) {
    ElMessage.warning(`待提交生产订单可先保存；${stockCheck.message}，提交生产前必须补足`);
  }
  const draftStockCheck = validateDraftStockSourceLines(editForm.value.lines);
  if (!draftStockCheck.ok) {
    ElMessage.warning(draftStockCheck.message);
    return;
  }
  if (draftStockCheck.warning) {
    ElMessage.warning(draftStockCheck.warning);
  }
  if (!(await confirmDuplicateDrawingNos(editForm.value.lines))) {
    return;
  }
  if (!(await confirmDuplicateDrawingFiles(editForm.value.lines))) {
    return;
  }
  if (!(await confirmExistingDrawingNos(editForm.value.lines, order.value.orderNo))) {
    return;
  }
  if (!(await confirmExistingDrawingFiles(editForm.value.lines, order.value.orderNo))) {
    return;
  }
  if (!(await checkEditOrderNo(true))) {
    return;
  }

  saving.value = true;
  try {
    const previousOrderNo = order.value.orderNo;
    order.value = await erpApi.updateOrder(previousOrderNo, {
      orderNo: editForm.value.orderNo.trim(),
      deliveryDate: editForm.value.deliveryDate,
      lines: normalizedLines()
    });
    ElMessage.success('订单已保存');
    editVisible.value = false;
    if (order.value.orderNo !== previousOrderNo) {
      await router.replace(`/orders/${encodeURIComponent(order.value.orderNo)}`);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单保存失败');
  } finally {
    saving.value = false;
  }
}

async function saveAdditionalMaterial() {
  if (!order.value) {
    return;
  }
  const line = additionalMaterialLines.value[0];
  if (!line) {
    return;
  }
  if (
    !line.partCode ||
    !line.partName ||
    !line.partThickness ||
    !line.quantity ||
    line.productionPlanQuantity === undefined ||
    line.productionPlanQuantity === null ||
    !line.unit
  ) {
    ElMessage.warning('请补齐新增物料、厚度、数量等必填信息');
    return;
  }
  if (Number(line.productionPlanQuantity || 0) <= 0) {
    ElMessage.warning('新增物料生产计划数量必须大于 0');
    return;
  }
  if (line.fulfillmentMode !== 'PRODUCTION') {
    ElMessage.warning('新增物料补单只能选择重新生产');
    return;
  }
  const processSteps = normalizeAdditionalMaterialProcessSteps(additionalMaterialProcessSteps.value);
  if (processSteps.length === 0) {
    ElMessage.warning('请选择新增物料的生产流程');
    return;
  }
  additionalMaterialProcessSteps.value = processSteps;
  const duplicateProcesses = duplicateAdditionalMaterialProcessNames(processSteps);
  if (duplicateProcesses.length > 0) {
    ElMessage.warning(`新增物料流程存在重复工序：${duplicateProcesses.join('、')}，请删除重复项或写入参数备注`);
    return;
  }
  if (!additionalMaterialForm.value.reason.trim()) {
    ElMessage.warning('请填写新增物料原因');
    return;
  }

  const payload = {
    ...sanitizeOrderLinePayload(line, order.value.deliveryDate?.slice(0, 10)),
    processSteps,
    fulfillmentMode: 'PRODUCTION' as const,
    reason: additionalMaterialForm.value.reason.trim(),
    managerName: additionalMaterialForm.value.managerName.trim() || undefined
  };

  if (!(await confirmDuplicateDrawingNos([payload]))) {
    return;
  }
  if (!(await confirmDuplicateDrawingFiles([payload]))) {
    return;
  }
  if (!(await confirmExistingDrawingNos([payload], order.value.orderNo))) {
    return;
  }
  if (!(await confirmExistingDrawingFiles([payload], order.value.orderNo))) {
    return;
  }

  saving.value = true;
  try {
    order.value = await erpApi.createAdditionalMaterial(order.value.orderNo, payload);
    ElMessage.success('新增物料补单已生成，并已同步生产通知');
    additionalMaterialVisible.value = false;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '新增物料补单失败');
  } finally {
    saving.value = false;
  }
}

function clearOrderNoCheck() {
  if (editOrderNoCheckTimer) {
    window.clearTimeout(editOrderNoCheckTimer);
    editOrderNoCheckTimer = undefined;
  }
  editOrderNoCheckSequence += 1;
  checkingOrderNo.value = false;
  orderNoAvailable.value = false;
  orderNoCheckText.value = '';
}

function scheduleEditOrderNoCheck() {
  if (editOrderNoCheckTimer) {
    window.clearTimeout(editOrderNoCheckTimer);
    editOrderNoCheckTimer = undefined;
  }
  orderNoAvailable.value = false;
  const orderNo = editForm.value.orderNo.trim();
  if (!orderNo) {
    checkingOrderNo.value = false;
    orderNoCheckText.value = '';
    return;
  }
  const sequence = ++editOrderNoCheckSequence;
  checkingOrderNo.value = true;
  orderNoCheckText.value = '正在自动查重...';
  editOrderNoCheckTimer = window.setTimeout(() => {
    editOrderNoCheckTimer = undefined;
    void checkEditOrderNo(true, sequence);
  }, 400);
}

async function checkEditOrderNo(silent = false, expectedSequence?: number) {
  if (!order.value) {
    return false;
  }
  const orderNo = editForm.value.orderNo.trim();
  if (!orderNo) {
    if (!silent) {
      ElMessage.warning('请先填写订单号');
    }
    clearOrderNoCheck();
    return false;
  }

  if (editOrderNoCheckTimer) {
    window.clearTimeout(editOrderNoCheckTimer);
    editOrderNoCheckTimer = undefined;
  }
  const sequence = expectedSequence ?? ++editOrderNoCheckSequence;
  checkingOrderNo.value = true;
  try {
    const result = await erpApi.checkOrderNo(orderNo, order.value.orderNo);
    if (sequence !== editOrderNoCheckSequence || orderNo !== editForm.value.orderNo.trim()) {
      return result.available;
    }
    orderNoAvailable.value = result.available;
    orderNoCheckText.value = result.available ? '订单号可用' : '订单号已存在，请修改';
    if (!result.available && !silent) {
      ElMessage.warning('订单号已存在，请修改');
    }
    return result.available;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单号查重失败');
    return false;
  } finally {
    if (sequence === editOrderNoCheckSequence) {
      checkingOrderNo.value = false;
    }
  }
}

function syncPlanQuantity(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    line.productionPlanQuantity = Math.max(Number(line.quantity || 0) - selectedStockSourceQuantity(line), 0);
    line.productionPlanOverrideByCode = '';
    line.productionPlanOverrideReason = '';
    return;
  }
  // 编辑订单数量时只补默认值；少做或多做需要在订单行里填写偏差说明。
  if (line.productionPlanQuantity === undefined || line.productionPlanQuantity === null) {
    line.productionPlanQuantity = line.quantity;
  }
}

function normalizedLines() {
  return editForm.value.lines.map((line) => sanitizeOrderLinePayload(line, editForm.value.deliveryDate));
}

function lineRequiresProductionProcess(line: OrderLine | CreateOrderLinePayload) {
  return Number(line.productionPlanQuantity || 0) > 0;
}

function submitOrderLineWarning(line: OrderLine) {
  if (
    (line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK') &&
    selectedStockSourceQuantity(line as unknown as CreateOrderLinePayload) <= 0
  ) {
    return '该零件尚未选择库存批次，提交生产前必须完成库存来源核对。';
  }
  if (lineRequiresProductionProcess(line) && line.processSteps.length === 0) {
    return '该零件尚未设置生产流程，提交时会被后端拒绝。';
  }
  return '';
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

function formatOrderQuantity(row: OrderDetail, field: 'totalQuantity' | 'totalProductionPlanQuantity') {
  if (row.quantityByUnit?.length) {
    return row.quantityByUnit.map((item) => formatQuantity(item[field], item.unit)).join(' / ');
  }
  return formatQuantity(row[field], row.unit);
}

function stockSourceSummary(line: OrderLine | CreateOrderLinePayload) {
  const sources = normalizeSelectedStockSources(line as CreateOrderLinePayload);
  if (sources.length === 0) {
    return '';
  }

  return sources
    .map((source) => {
      const sourcePart = source.partCode && source.partCode !== line.partCode ? `${source.partCode} / ` : '';
      const replenishmentText = stockSourceReplenishmentText(source);
      const replenishmentMark = replenishmentText ? ` / ${replenishmentText}` : '';
      const manualText = source.manualConfirmedBy ? ` / 人工确认：${source.manualConfirmedBy}` : '';
      const reasonText = source.compatibilityStatus && source.compatibilityStatus !== 'MATCHED' && source.compatibilityReason
        ? ` / ${source.compatibilityReason}`
        : '';
      return `${source.batchNo || source.batchId} ${sourcePart}${formatQuantity(source.quantity, source.unit || line.unit || '件')}${replenishmentMark}${manualText}${reasonText}`;
    })
    .join('；');
}

function stockFulfillmentHint(line: OrderLine | CreateOrderLinePayload) {
  if (line.fulfillmentMode !== 'STOCK') {
    return '';
  }
  const selectedQuantity = selectedStockSourceQuantity(line as CreateOrderLinePayload);
  if (selectedQuantity <= 0) {
    return '';
  }
  const orderQuantity = Number(line.quantity || 0);
  const planQuantity = Math.max(Number(line.productionPlanQuantity || 0), 0);
  if (planQuantity <= 0) {
    return `客户要求 ${formatQuantity(orderQuantity, line.unit || '件')}，库存已覆盖，不生成生产任务`;
  }
  return `客户要求 ${formatQuantity(orderQuantity, line.unit || '件')}，库存已有 ${formatQuantity(
    selectedQuantity,
    line.unit || '件'
  )}，按需生产 ${formatQuantity(planQuantity, line.unit || '件')}`;
}

function stockSourceReplenishmentText(source: ReturnType<typeof normalizeSelectedStockSources>[number]) {
  if (source.replenishmentSourceLabel) {
    return source.replenishmentSourceLabel;
  }
  if (!source.replenishmentSourceType) {
    return '';
  }
  const sourceTypeText =
    source.replenishmentSourceType === 'PRODUCTION_SCRAP'
      ? '生产报废补单'
      : source.replenishmentSourceType === 'ORDER_CHANGE'
        ? '订单数量补单'
        : source.replenishmentSourceType;
  return source.replenishmentSourceRequestNo ? `${sourceTypeText}：${source.replenishmentSourceRequestNo}` : sourceTypeText;
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

function formatLineWarehouseText(line: OrderLine) {
  if (line.inventoryBatchNo) {
    const location = [line.warehouseName, line.locationName].filter(Boolean).join(' / ');
    return `${line.inventoryBatchNo}${location ? `，${location}` : ''}`;
  }
  if (line.productionTaskNo) {
    return line.productionTaskNo;
  }
  return '未生成生产任务';
}

function formatLineProductionProgressText(line: OrderLine) {
  // 已生产订单的补单、数量变更必须先看到当前工序进度，防止误把生产数量变更当作待提交生产订单修改。
  if (line.productionProgressText) {
    return line.productionProgressText;
  }
  if (!line.productionTaskNo) {
    return '尚未生成生产任务';
  }
  if (line.productionStatus === 'PENDING') {
    return `${line.productionTaskNo} 待确认生产`;
  }
  if (line.productionStatus === 'COMPLETED') {
    return `${line.productionTaskNo} 已完成`;
  }
  return `${line.productionTaskNo} 生产中`;
}

function productionStatusText(status?: string) {
  const labels: Record<string, string> = {
    PENDING: '待确认生产',
    IN_PROGRESS: '生产中',
    COMPLETED: '已完成'
  };
  return status ? labels[status] || status : '-';
}

function formatLineShortageText(line: OrderLine) {
  if (!line.productionShortageQuantity || line.productionShortageQuantity <= 0) {
    return '';
  }

  const shortage = formatQuantity(line.productionShortageQuantity, line.unit);
  const scrap = formatQuantity(line.productionScrapQuantity || 0, line.unit);
  if (line.productionShortageMode === 'REPLENISHMENT_REQUEST') {
    const requestNos = line.productionReplenishmentRequestNos?.length ? line.productionReplenishmentRequestNos.join('、') : '-';
    return `短缺 ${shortage}，报废 ${scrap}，生产报废补单申请待主管确认 ${requestNos}`;
  }
  if (line.productionShortageMode === 'REPLENISHMENT') {
    const taskNos = line.productionReplenishmentTaskNos?.length ? line.productionReplenishmentTaskNos.join('、') : '-';
    return `短缺 ${shortage}，报废 ${scrap}，补单 ${taskNos}`;
  }

  const reasonText = line.productionShortageReasons?.length
    ? line.productionShortageReasons
        .map((item) => `${item.managerName || '-'}确认：${item.shortageReason || '-'}`)
        .join('；')
    : '管理确认缺货完成';
  return `短缺 ${shortage}，报废 ${scrap}，${reasonText}`;
}

async function saveReplenishment() {
  if (!order.value || !activeLine.value) {
    return;
  }
  if (!replenishmentForm.value.quantity || replenishmentForm.value.quantity <= 0) {
    ElMessage.warning('请填写补单数量');
    return;
  }
  if (!replenishmentForm.value.reason.trim()) {
    ElMessage.warning('请填写补单原因');
    return;
  }

  saving.value = true;
  try {
    order.value = await erpApi.createLineReplenishment(order.value.orderNo, activeLine.value.id, {
      quantity: replenishmentForm.value.quantity,
      managerName: replenishmentForm.value.managerName.trim() || undefined,
      reason: replenishmentForm.value.reason.trim()
    });
    ElMessage.success('补单已生成，并已同步生产通知');
    replenishmentVisible.value = false;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建补单失败');
  } finally {
    saving.value = false;
  }
}

async function saveCancelReplenishment() {
  if (!order.value || !activeReplenishmentTask.value) {
    return;
  }
  if (!cancelReplenishmentForm.value.reason.trim()) {
    ElMessage.warning('请填写取消补单原因');
    return;
  }
  if (!cancelReplenishmentForm.value.managerName.trim()) {
    ElMessage.warning('请填写管理人员姓名');
    return;
  }

  saving.value = true;
  try {
    order.value = await erpApi.cancelReplenishment(order.value.orderNo, activeReplenishmentTask.value.productionTaskNo, {
      reason: cancelReplenishmentForm.value.reason.trim(),
      managerName: cancelReplenishmentForm.value.managerName.trim()
    });
    ElMessage.success('补单已取消');
    cancelReplenishmentVisible.value = false;
    activeReplenishmentTask.value = undefined;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '取消补单失败');
  } finally {
    saving.value = false;
  }
}

async function saveQuantityChange() {
  if (!order.value || !activeLine.value) {
    return;
  }
  if (quantityChangeForm.value.quantity < 0) {
    ElMessage.warning('客户数量不能小于 0');
    return;
  }
  if (!quantityChangeForm.value.reason.trim()) {
    ElMessage.warning('请填写数量变更原因');
    return;
  }
  if (quantityChangeNeedsPlanOverride.value && !quantityChangeForm.value.productionPlanOverrideByCode.trim()) {
    ElMessage.warning('生产计划数量与建议数量不一致，请填写操作人员账号');
    return;
  }
  if (quantityChangeNeedsPlanOverride.value && !quantityChangeForm.value.productionPlanOverrideReason.trim()) {
    ElMessage.warning('生产计划数量与建议数量不一致，请填写调整说明');
    return;
  }

  saving.value = true;
  try {
    order.value = await erpApi.updateLineQuantityAfterProductionStarted(order.value.orderNo, activeLine.value.id, {
      quantity: quantityChangeForm.value.quantity,
      productionPlanQuantity: quantityChangeForm.value.productionPlanQuantity,
      productionPlanOverrideByCode: quantityChangeNeedsPlanOverride.value
        ? quantityChangeForm.value.productionPlanOverrideByCode.trim()
        : undefined,
      productionPlanOverrideReason: quantityChangeNeedsPlanOverride.value
        ? quantityChangeForm.value.productionPlanOverrideReason.trim()
        : undefined,
      managerName: quantityChangeForm.value.managerName.trim() || undefined,
      reason: quantityChangeForm.value.reason.trim()
    });
    ElMessage.success('数量变更已保存，并已同步生产通知');
    quantityChangeVisible.value = false;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存数量变更失败');
  } finally {
    saving.value = false;
  }
}

async function saveCancelOrder() {
  if (!order.value) {
    return;
  }
  if (!cancelOrderForm.value.managerName.trim()) {
    ElMessage.warning('请填写管理人员姓名');
    return;
  }
  if (!cancelOrderForm.value.reason.trim()) {
    ElMessage.warning('请填写取消订单原因');
    return;
  }
  const handlingPlan = collectCancelHandlingPlan();
  if (handlingPlan === false) {
    return;
  }

  saving.value = true;
  try {
    order.value = await erpApi.cancelOrder(order.value.orderNo, {
      reason: cancelOrderForm.value.reason.trim(),
      managerName: cancelOrderForm.value.managerName.trim(),
      productionCancelState: cancelOrderForm.value.productionCancelState,
      handlingPlan
    });
    ElMessage.success('订单已取消；如有已开工任务，通知已同步生产和仓库');
    cancelOrderVisible.value = false;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '取消订单失败');
  } finally {
    saving.value = false;
  }
}

async function openSubmitOrderDialog() {
  if (!order.value) {
    return;
  }
  if (order.value.status !== 'DRAFT') {
    ElMessage.warning('只有待提交生产订单允许提交生产');
    return;
  }
  submitPlanOperatorCode.value = '';
  await loadSubmitPlanOperators('');
  submitOrderVisible.value = true;
}

function closeSubmitOrderDialog() {
  if (saving.value) {
    return;
  }
  submitOrderVisible.value = false;
}

function resetSubmitOrderDialog() {
  submitPlanOperatorCode.value = '';
}

async function confirmSubmitOrder() {
  if (!order.value) {
    return;
  }
  if (!submitPlanOperatorCode.value) {
    ElMessage.warning('请选择下单/计划操作员');
    return;
  }
  saving.value = true;
  try {
    if (!(await loadInventorySummary())) {
      return;
    }
    const stockCheck = validateStockModeLines(order.value.lines, inventorySummary.value);
    if (!stockCheck.ok) {
      ElMessage.warning(stockCheck.message);
      return;
    }
    const sourceCheck = await validateSubmitStockSources(order.value.lines);
    if (!sourceCheck.ok) {
      ElMessage.warning(sourceCheck.message);
      return;
    }
    const submittedOrderNo = order.value.orderNo;
    order.value = await erpApi.submitOrder(submittedOrderNo, { submittedByCode: submitPlanOperatorCode.value });
    submitOrderVisible.value = false;
    if (submittedOrderShouldGoWarehouse(order.value)) {
      ElMessage.success('订单已提交生产，库存已进入仓库待发货');
      await router.push({
        path: '/warehouses',
        query: {
          orderNo: submittedOrderNo,
          returnTo: `/orders/${encodeURIComponent(submittedOrderNo)}`
        }
      });
      return;
    }
    ElMessage.success('订单已提交生产，已进入生产详情');
    await router.push({
      path: '/production',
      query: {
        orderNo: submittedOrderNo,
        returnTo: `/orders/${encodeURIComponent(submittedOrderNo)}`
      }
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '提交失败');
  } finally {
    saving.value = false;
  }
}

function submittedOrderShouldGoWarehouse(submittedOrder: OrderDetail) {
  return submittedOrder.warehouseStage === 'WAITING_SHIPMENT';
}

function orderWarehouseActionText(currentOrder: OrderDetail) {
  if (currentOrder.warehouseStage === 'WAITING_RECEIPT') {
    return '仓库入库';
  }
  if (currentOrder.warehouseStage === 'WAITING_SHIPMENT' || currentOrder.warehouseStage === 'PARTIAL_SHIPPED') {
    return '仓库发货';
  }
  return '';
}

function isSubmitPlanOperator(operator: ProductionOperator) {
  const role = operator.role || '';
  return /计划|下单|订单/.test(role) && !/车间|主任|技术|工艺/.test(role);
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

async function loadSubmitPlanOperators(keyword = '') {
  submitPlanOperatorLoading.value = true;
  try {
    const operators = await erpApi.productionOperators(keyword.trim());
    cacheOperators(operators);
    submitPlanOperators.value = operators.filter(isSubmitPlanOperator);
  } catch (error) {
    submitPlanOperators.value = [];
    ElMessage.error(error instanceof Error ? error.message : '下单/计划操作员加载失败');
  } finally {
    submitPlanOperatorLoading.value = false;
  }
}

watch(() => route.params.orderNo, loadOrder);
onMounted(async () => {
  await loadProcessDefinitions();
  await loadOrder();
});
onBeforeUnmount(() => {
  if (editOrderNoCheckTimer) {
    window.clearTimeout(editOrderNoCheckTimer);
  }
});
</script>

<style scoped>
.order-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 20px;
  padding: 20px;
}

.order-summary strong {
  display: inline-block;
  margin-top: 8px;
  font-size: 16px;
}

.submit-order-confirm {
  display: grid;
  gap: 14px;
}

.submit-order-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
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

.submit-order-row {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.submit-order-row span {
  color: #64748b;
  font-size: 12px;
}

.submit-order-row strong {
  min-width: 0;
  color: #0f172a;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.submit-order-lines {
  display: grid;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
}

.submit-order-line {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.submit-order-line div {
  display: grid;
  gap: 4px;
}

.submit-order-line strong,
.submit-order-line span,
.submit-order-line small {
  min-width: 0;
  overflow-wrap: anywhere;
}

.submit-order-line span,
.submit-order-line small {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.submit-order-line .submit-order-line-warning {
  color: #b45309;
}

.order-edit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.order-no-field {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: min(420px, 100%);
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

.order-no-check.duplicated {
  color: #dc2626;
}

.order-no-check.checking {
  color: #64748b;
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

.line-status-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
}

.line-shortage,
.line-shortage-inline {
  color: #b45309;
  font-size: 13px;
  line-height: 20px;
}

.line-shortage {
  padding: 8px 10px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
}

.line-progress {
  margin-top: 8px;
  padding: 8px 10px;
  color: #475569;
  font-size: 13px;
  line-height: 20px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.stock-source-summary {
  margin-top: 8px;
  padding: 8px 10px;
  color: #1e3a8a;
  font-size: 13px;
  line-height: 20px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
}

.stock-source-summary-inline {
  color: #1e3a8a;
  font-size: 13px;
  line-height: 20px;
}

.stock-fulfillment-hint {
  margin-top: 8px;
  padding: 8px 10px;
  color: #92400e;
  font-size: 13px;
  line-height: 20px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
}

.stock-fulfillment-hint-inline {
  display: block;
  margin-top: 4px;
  color: #92400e;
  font-size: 12px;
  line-height: 18px;
}

.line-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.action-tooltip-wrap {
  display: inline-flex;
}

.additional-material-extra {
  margin-top: 18px;
}

.additional-process-editor {
  display: grid;
  gap: 12px;
  width: min(960px, 100%);
}

.additional-process-search {
  max-width: 360px;
}

.additional-process-picker {
  display: flex;
  flex-wrap: wrap;
  min-height: 38px;
  gap: 8px;
}

.process-empty-text {
  align-self: center;
  color: #64748b;
  font-size: 13px;
}

.additional-process-create {
  display: grid;
  grid-template-columns: minmax(220px, 360px) auto auto;
  gap: 10px;
  align-items: center;
}

.additional-process-steps {
  display: grid;
  gap: 8px;
}

.additional-process-row {
  display: grid;
  grid-template-columns: 32px minmax(140px, 180px) minmax(220px, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: #2563eb;
  font-weight: 700;
  background: #dbeafe;
  border-radius: 999px;
}

.additional-process-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

.process-help-text {
  color: #60708a;
  font-size: 13px;
  line-height: 20px;
}

.form-unit {
  margin-left: 8px;
  color: #60708a;
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

.mb-16 {
  margin-bottom: 16px;
}

@media (max-width: 900px) {
  .order-summary {
    grid-template-columns: 1fr;
    gap: 12px;
    padding: 14px;
  }

  .order-edit-grid {
    grid-template-columns: 1fr;
  }

  .dialog-subtitle {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .dialog-subtitle > .el-button {
    width: 100%;
  }

  .line-actions,
  .additional-process-actions {
    align-items: stretch;
  }

  .line-actions .el-button,
  .action-tooltip-wrap,
  .action-tooltip-wrap .el-button {
    flex: 1 1 128px;
    min-width: 0;
  }

  .additional-process-picker .el-button {
    flex: 1 1 120px;
    margin-left: 0;
  }

  .additional-process-create {
    grid-template-columns: 1fr;
  }

  .additional-process-row {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .additional-process-row .el-input,
  .additional-process-actions {
    grid-column: 2;
  }

  .additional-process-actions {
    justify-content: flex-start;
  }

  .form-unit {
    display: block;
    margin: 6px 0 0;
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
}

</style>
