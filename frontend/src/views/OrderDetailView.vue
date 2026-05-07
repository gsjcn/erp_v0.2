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
        <el-tooltip :content="cancelStartedOrderDisabledReason" :disabled="canCancelStartedOrder" placement="bottom">
          <span class="action-tooltip-wrap">
            <el-button type="danger" plain :disabled="!canCancelStartedOrder" @click="openCancelStartedOrder">取消订单</el-button>
          </span>
        </el-tooltip>
        <el-button @click="goProcess">选择生产流程</el-button>
        <el-button type="primary" :disabled="!order || order.status !== 'DRAFT'" @click="submitOrder">提交生产</el-button>
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
          <strong>{{ order.partCount }} 个 / {{ formatQuantity(order.totalQuantity, order.unit) }}</strong>
        </div>
        <div>
          <div class="muted">生产计划</div>
          <strong>{{ formatQuantity(order.totalProductionPlanQuantity, order.unit) }}</strong>
        </div>
        <div>
          <div class="muted">状态</div>
          <StatusTag :value="order.status" />
        </div>
        <div>
          <div class="muted">仓库阶段</div>
          <StatusTag :value="order.warehouseStage" />
        </div>
      </div>

      <el-alert
        v-if="showProductionChangeHelp"
        title="已开始生产的订单不能再当作草稿修改。补单、客户数量变更、新增物料都会同步通知生产；数量减少或取消会同时通知仓库等待转库存或报废处理。"
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
            <span v-if="line.processSteps.length === 0" class="muted">未选择生产流程</span>
          </div>
          <div class="line-actions">
            <el-tooltip :content="productionChangeDisabledReason(line)" :disabled="canCreateProductionChange(line)" placement="top">
              <span class="action-tooltip-wrap">
                <el-button size="small" :disabled="!canCreateProductionChange(line)" @click="openReplenishment(line)">补单</el-button>
              </span>
            </el-tooltip>
            <el-tooltip :content="productionChangeDisabledReason(line)" :disabled="canCreateProductionChange(line)" placement="top">
              <span class="action-tooltip-wrap">
                <el-button size="small" :disabled="!canCreateProductionChange(line)" @click="openQuantityChange(line)">数量变更</el-button>
              </span>
            </el-tooltip>
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
            <template #default="{ row }">{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="库存/生产方式" width="130">
            <template #default="{ row }">{{ fulfillmentModeLabel(row.fulfillmentMode) }}</template>
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
          <el-table-column label="仓库阶段" width="125">
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
              </div>
            </template>
          </el-table-column>
          <el-table-column label="生产变更" width="150" fixed="right">
            <template #default="{ row }">
              <el-tooltip :content="productionChangeDisabledReason(row)" :disabled="canCreateProductionChange(row)" placement="top">
                <span class="action-tooltip-wrap">
                  <el-button link type="primary" :disabled="!canCreateProductionChange(row)" @click="openReplenishment(row)">补单</el-button>
                </span>
              </el-tooltip>
              <el-tooltip :content="productionChangeDisabledReason(row)" :disabled="canCreateProductionChange(row)" placement="top">
                <span class="action-tooltip-wrap">
                  <el-button link type="primary" :disabled="!canCreateProductionChange(row)" @click="openQuantityChange(row)">变更</el-button>
                </span>
              </el-tooltip>
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
              <el-input v-model="editForm.orderNo" placeholder="草稿订单号可修改，系统自动查重" @input="scheduleEditOrderNoCheck" />
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
                <p>如果当前订单内出现重复图号，保存时会提示“此图号和某某零件的图号一样”，需要确认后才能继续。</p>
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
              <div class="additional-process-picker">
                <el-button v-for="item in processOptions" :key="item" round @click="addAdditionalMaterialProcess(item)">
                  {{ item }}
                </el-button>
              </div>
              <div class="additional-process-steps">
                <div
                  v-for="(step, index) in additionalMaterialProcessSteps"
                  :key="`${index}-${step.processName}`"
                  class="additional-process-row"
                >
                  <span class="step-index">{{ index + 1 }}</span>
                  <el-select v-model="step.processName" filterable placeholder="标准工序" @change="normalizeAdditionalMaterialProcesses">
                    <el-option v-for="item in processOptions" :key="item" :label="item" :value="item" />
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

    <el-dialog v-model="replenishmentVisible" title="创建补单" width="min(520px, calc(100vw - 32px))">
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
          <el-input v-model="replenishmentForm.reason" type="textarea" :rows="3" placeholder="例如：客户追加、生产缺件补足" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="replenishmentVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveReplenishment">确认补单</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="quantityChangeVisible" title="客户数量变更" width="min(560px, calc(100vw - 32px))">
      <el-alert
        title="已开始生产的订单不能按草稿编辑。数量减少或取消会通知生产管理确认已生产物料转库存或销毁；数量增加会生成补单任务。"
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
        </el-form-item>
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

    <el-dialog v-model="cancelOrderVisible" title="取消已生产订单" width="min(620px, calc(100vw - 32px))">
      <el-alert
        title="只允许取消已经开始生产的订单。取消后客户订单数量归零，未开始的生产任务会删除，已开始生产的任务会通知生产和仓库确认转库存或销毁。"
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
        <el-form-item label="管理人员">
          <el-input v-model="cancelOrderForm.managerName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="取消原因" required>
          <el-input v-model="cancelOrderForm.reason" type="textarea" :rows="4" placeholder="例如：客户取消订单、客户项目暂停" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cancelOrderVisible = false">返回</el-button>
        <el-button type="danger" :loading="saving" @click="saveCancelStartedOrder">确认取消订单</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import type { CreateOrderLinePayload } from '../api/erp';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { WarningFilled } from '@element-plus/icons-vue';
import { useRoute, useRouter } from 'vue-router';
import { erpApi } from '../api/erp';
import DrawingPreviewLink from '../components/DrawingPreviewLink.vue';
import OrderLineEditor from '../components/OrderLineEditor.vue';
import StatusTag from '../components/StatusTag.vue';
import { standardProcessOptions } from '../config/processes';
import type { InventorySummaryRow, OrderDetail, OrderLine, ProcessStepDetail } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';
import {
  confirmDuplicateDrawingFiles,
  confirmDuplicateDrawingNos,
  confirmExistingDrawingFiles,
  confirmExistingDrawingNos
} from '../utils/orderLineDuplicateChecks';
import { validateStockModeLines } from '../utils/orderLineStockChecks';

const route = useRoute();
const router = useRouter();
const order = ref<OrderDetail>();
const inventorySummary = ref<InventorySummaryRow[]>([]);
const loading = ref(false);
const saving = ref(false);
const editVisible = ref(false);
const additionalMaterialVisible = ref(false);
const replenishmentVisible = ref(false);
const quantityChangeVisible = ref(false);
const cancelOrderVisible = ref(false);
const activeLine = ref<OrderLine>();
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
const processOptions: string[] = [...standardProcessOptions];
const quantityChangeForm = ref({
  quantity: 0,
  productionPlanQuantity: 0,
  managerName: '',
  reason: ''
});
const cancelOrderForm = ref({
  managerName: '',
  reason: ''
});
const canAddAdditionalMaterial = computed(() =>
  Boolean(
    order.value &&
      order.value.status !== 'DRAFT' &&
      order.value.status !== 'CANCELLED' &&
      order.value.status !== 'COMPLETED' &&
      order.value.lines.some((line) => canCreateProductionChange(line))
  )
);
const canCancelStartedOrder = computed(() =>
  Boolean(
    order.value &&
      order.value.status !== 'DRAFT' &&
      order.value.status !== 'CANCELLED' &&
      order.value.status !== 'COMPLETED' &&
      order.value.lines.some((line) => canCreateProductionChange(line))
  )
);
const additionalMaterialDisabledReason = computed(() => orderProductionChangeDisabledReason('新增补单物料'));
const cancelStartedOrderDisabledReason = computed(() => orderProductionChangeDisabledReason('取消订单'));
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
  return '当前订单已提交但还没有任何零件开始生产。需要补单、数量变化或取消时，应先修改订单；只有生产开始后才走生产变更流程。';
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
  return startedLines
    .slice(0, 4)
    .map((line) => `${line.partCode} ${line.productionStatus}`)
    .join('；');
});

async function loadOrder() {
  const orderNo = String(route.params.orderNo);
  loading.value = true;
  try {
    order.value = await erpApi.order(orderNo);
  } finally {
    loading.value = false;
  }
}

function goProcess() {
  if (order.value) {
    void router.push(`/processes?orderNo=${order.value.orderNo}`);
  }
}

function openEdit() {
  if (!order.value || order.value.status !== 'DRAFT') {
    return;
  }
  void loadInventorySummary();
  editForm.value = {
    orderNo: order.value.orderNo,
    deliveryDate: order.value.deliveryDate?.slice(0, 10),
    lines: order.value.lines.map((line) => ({
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
      fulfillmentMode: line.fulfillmentMode || 'PRODUCTION',
      unit: line.unit,
      deliveryDate: line.deliveryDate?.slice(0, 10),
      remark: line.remark,
      processSteps: line.processStepDetails?.length ? line.processStepDetails : line.processSteps.map((processName) => ({ processName }))
    }))
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
    return `草稿订单还未提交生产，${actionName}前请直接编辑订单`;
  }
  if (order.value.status === 'CANCELLED') {
    return `订单已取消，不能${actionName}`;
  }
  if (order.value.status === 'COMPLETED') {
    return `订单已完成，不能${actionName}`;
  }
  if (!order.value.lines.some((line) => canCreateProductionChange(line))) {
    return `订单尚未开始生产，${actionName}应先修改订单，不能走生产变更`;
  }
  return '';
}

function productionChangeDisabledReason(line: OrderLine) {
  if (!order.value) {
    return '订单数据未加载';
  }
  if (order.value.status === 'DRAFT') {
    return '草稿订单还未提交生产，请直接编辑订单';
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
  await loadInventorySummary();
  const line = newLine(order.value.lines.length);
  line.partCode = `P-${Date.now().toString().slice(-4)}-A`;
  line.deliveryDate = order.value.deliveryDate?.slice(0, 10);
  line.processSteps = [];
  additionalMaterialProcessSteps.value = ['激光切割', '折弯', '包装'].map((processName) => ({ processName }));
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
}

function normalizeAdditionalMaterialProcessSteps(steps: ProcessStepDetail[]) {
  const result: ProcessStepDetail[] = [];
  steps.forEach((step) => {
    const processName = step.processName.trim();
    if (processName && processOptions.includes(processName) && !result.some((item) => item.processName === processName)) {
      const processRemark = step.processRemark?.trim();
      result.push({
        processName,
        ...(processRemark ? { processRemark } : {})
      });
    }
  });
  return result;
}

function normalizeAdditionalMaterialProcesses() {
  additionalMaterialProcessSteps.value = normalizeAdditionalMaterialProcessSteps(additionalMaterialProcessSteps.value);
}

function addAdditionalMaterialProcess(processName: string) {
  if (additionalMaterialProcessSteps.value.some((step) => step.processName === processName)) {
    ElMessage.warning('该标准工序已存在，请把次数或特殊要求写入参数备注');
    return;
  }
  additionalMaterialProcessSteps.value.push({ processName, processRemark: '' });
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
    managerName: '',
    reason: ''
  };
  quantityChangeVisible.value = true;
}

function openCancelStartedOrder() {
  if (!order.value) {
    return;
  }
  if (!canCancelStartedOrder.value) {
    ElMessage.warning('订单还没有开始生产，请编辑订单，不要走生产取消流程');
    return;
  }
  cancelOrderForm.value = {
    managerName: '',
    reason: ''
  };
  cancelOrderVisible.value = true;
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
    processSteps: []
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
        (line.fulfillmentMode !== 'STOCK' && !line.productionPlanQuantity) ||
        !line.unit
    )
  ) {
    ElMessage.warning('请补齐订单零件、厚度等必填信息');
    return;
  }
  await loadInventorySummary();
  const stockCheck = validateStockModeLines(editForm.value.lines, inventorySummary.value);
  if (!stockCheck.ok) {
    ElMessage.warning(`草稿可先保存；${stockCheck.message}，提交生产前必须补足`);
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
    !line.productionPlanQuantity ||
    !line.unit
  ) {
    ElMessage.warning('请补齐新增物料、厚度、数量等必填信息');
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
  if (!additionalMaterialForm.value.reason.trim()) {
    ElMessage.warning('请填写新增物料原因');
    return;
  }

  const payload = {
    ...line,
    processSteps,
    deliveryDate: line.deliveryDate || order.value.deliveryDate?.slice(0, 10),
    fulfillmentMode: 'PRODUCTION' as const,
    productionPlanQuantity: Math.max(line.productionPlanQuantity || line.quantity, line.quantity),
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
    line.productionPlanQuantity = 0;
    return;
  }
  // 编辑订单数量时，生产计划不能低于客户订单；生产计划仍可手工改为更大数量。
  if (!line.productionPlanQuantity || line.productionPlanQuantity < line.quantity) {
    line.productionPlanQuantity = line.quantity;
  }
}

function normalizedLines() {
  return editForm.value.lines.map((line) => ({
    ...line,
    deliveryDate: line.deliveryDate || editForm.value.deliveryDate,
    fulfillmentMode: line.fulfillmentMode || 'PRODUCTION',
    productionPlanQuantity:
      line.fulfillmentMode === 'STOCK' ? 0 : Math.max(line.productionPlanQuantity || line.quantity, line.quantity)
  }));
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

async function loadInventorySummary() {
  inventorySummary.value = await erpApi.inventorySummary({ status: 'AVAILABLE' });
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
  // 已生产订单的补单、数量变更必须先看到当前工序进度，防止误把生产变更当作草稿修改。
  if (line.productionProgressText) {
    return line.productionProgressText;
  }
  if (!line.productionTaskNo) {
    return '尚未生成生产任务';
  }
  if (line.productionStatus === 'PENDING') {
    return `${line.productionTaskNo} 待生产`;
  }
  if (line.productionStatus === 'COMPLETED') {
    return `${line.productionTaskNo} 已完成`;
  }
  return `${line.productionTaskNo} 生产中`;
}

function formatLineShortageText(line: OrderLine) {
  if (!line.productionShortageQuantity || line.productionShortageQuantity <= 0) {
    return '';
  }

  const shortage = formatQuantity(line.productionShortageQuantity, line.unit);
  const scrap = formatQuantity(line.productionScrapQuantity || 0, line.unit);
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

  saving.value = true;
  try {
    order.value = await erpApi.updateLineQuantityAfterProductionStarted(order.value.orderNo, activeLine.value.id, {
      quantity: quantityChangeForm.value.quantity,
      productionPlanQuantity: quantityChangeForm.value.productionPlanQuantity,
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

async function saveCancelStartedOrder() {
  if (!order.value) {
    return;
  }
  if (!cancelOrderForm.value.reason.trim()) {
    ElMessage.warning('请填写取消订单原因');
    return;
  }

  saving.value = true;
  try {
    order.value = await erpApi.cancelOrderAfterProductionStarted(order.value.orderNo, {
      reason: cancelOrderForm.value.reason.trim(),
      managerName: cancelOrderForm.value.managerName.trim() || undefined
    });
    ElMessage.success('订单已取消，并已同步生产和仓库通知');
    cancelOrderVisible.value = false;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '取消订单失败');
  } finally {
    saving.value = false;
  }
}

async function submitOrder() {
  if (!order.value) {
    return;
  }
  try {
    await loadInventorySummary();
    const stockCheck = validateStockModeLines(order.value.lines, inventorySummary.value);
    if (!stockCheck.ok) {
      ElMessage.warning(stockCheck.message);
      return;
    }
    order.value = await erpApi.submitOrder(order.value.orderNo);
    ElMessage.success('订单已提交生产');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '提交失败');
  }
}

watch(() => route.params.orderNo, loadOrder);
onMounted(loadOrder);
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

.additional-process-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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

.mb-16 {
  margin-bottom: 16px;
}

@media (max-width: 900px) {
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
}

</style>
