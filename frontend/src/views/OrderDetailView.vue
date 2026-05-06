<template>
  <section class="page" v-loading="loading">
    <div class="page-header">
      <h2 class="page-title">订单明细</h2>
      <div>
        <el-button :disabled="!order || order.status !== 'DRAFT'" @click="openEdit">编辑订单</el-button>
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
      </div>

      <div class="line-cards mt-24">
        <article v-for="line in order.lines" :key="line.id" class="line-card">
          <div class="line-title">
            <strong>{{ line.partName }}</strong>
            <span class="muted">订单 {{ formatQuantity(line.quantity, line.unit) }}</span>
          </div>
          <div class="muted">生产计划 {{ formatQuantity(line.productionPlanQuantity, line.unit) }}</div>
          <div class="muted">交期 {{ formatDate(line.deliveryDate || order.deliveryDate) }}</div>
          <div class="muted">{{ line.partCode }} / {{ line.drawingNo || '-' }}</div>
          <div class="process-chain mt-16">
            <span v-for="step in line.processSteps" :key="step" class="process-pill">{{ step }}</span>
            <span v-if="line.processSteps.length === 0" class="muted">未选择生产流程</span>
          </div>
        </article>
      </div>

      <div class="table-card mt-24 desktop-table">
        <el-table :data="order.lines" max-height="max(260px, calc(100vh - 520px))">
          <el-table-column prop="lineNo" label="序号" width="80" />
          <el-table-column prop="partCode" label="零件编码" width="140" />
          <el-table-column prop="partName" label="零件名称" min-width="180" />
          <el-table-column prop="drawingNo" label="图号" width="150" />
          <el-table-column label="零件交期" width="120">
            <template #default="{ row }">{{ formatDate(row.deliveryDate || order.deliveryDate) }}</template>
          </el-table-column>
          <el-table-column label="客户订单数量" width="140">
            <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="生产计划数量" width="140">
            <template #default="{ row }">{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="生产流程" min-width="360">
            <template #default="{ row }">
              <div class="process-chain">
                <span v-for="step in row.processSteps" :key="step" class="process-pill">{{ step }}</span>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <el-dialog v-model="editVisible" title="编辑订单零件" width="min(1080px, calc(100vw - 32px))">
      <el-form label-width="86px">
        <el-form-item label="交期">
          <el-date-picker v-model="editForm.deliveryDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>

        <div class="dialog-subtitle">
          <strong>订单零件</strong>
          <el-button size="small" @click="addLine">新增零件</el-button>
        </div>

        <OrderLineEditor
          :lines="editForm.lines"
          :default-delivery-date="editForm.deliveryDate"
          @remove="removeLine"
          @quantity-change="syncPlanQuantity"
        />
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import type { CreateOrderLinePayload } from '../api/erp';
import { onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import { erpApi } from '../api/erp';
import OrderLineEditor from '../components/OrderLineEditor.vue';
import StatusTag from '../components/StatusTag.vue';
import type { OrderDetail } from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';

const route = useRoute();
const router = useRouter();
const order = ref<OrderDetail>();
const loading = ref(false);
const saving = ref(false);
const editVisible = ref(false);
const editForm = ref<{
  deliveryDate?: string;
  lines: CreateOrderLinePayload[];
}>({
  deliveryDate: '',
  lines: []
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
  editForm.value = {
    deliveryDate: order.value.deliveryDate?.slice(0, 10),
    lines: order.value.lines.map((line) => ({
      partCode: line.partCode,
      partName: line.partName,
      drawingNo: line.drawingNo,
      quantity: line.quantity,
      productionPlanQuantity: line.productionPlanQuantity,
      unit: line.unit,
      deliveryDate: line.deliveryDate?.slice(0, 10),
      remark: line.remark,
      processSteps: line.processSteps
    }))
  };
  editVisible.value = true;
}

function newLine(index: number): CreateOrderLinePayload {
  return {
    partCode: `P-${Date.now().toString().slice(-4)}-${index + 1}`,
    partName: '',
    drawingNo: '',
    quantity: 1,
    productionPlanQuantity: 1,
    unit: '件',
    deliveryDate: '',
    processSteps: []
  };
}

function addLine() {
  editForm.value.lines.push(newLine(editForm.value.lines.length));
}

function removeLine(index: number) {
  if (editForm.value.lines.length > 3) {
    editForm.value.lines.splice(index, 1);
  }
}

async function saveEdit() {
  if (!order.value) {
    return;
  }
  if (
    editForm.value.lines.some(
      (line) => !line.partCode || !line.partName || !line.quantity || !line.productionPlanQuantity || !line.unit
    )
  ) {
    ElMessage.warning('请补齐订单零件信息');
    return;
  }

  saving.value = true;
  try {
    order.value = await erpApi.updateOrder(order.value.orderNo, {
      deliveryDate: editForm.value.deliveryDate,
      lines: normalizedLines()
    });
    ElMessage.success('订单已保存');
    editVisible.value = false;
  } finally {
    saving.value = false;
  }
}

function syncPlanQuantity(line: CreateOrderLinePayload) {
  // 编辑订单数量时，生产计划不能低于客户订单；生产计划仍可手工改为更大数量。
  if (!line.productionPlanQuantity || line.productionPlanQuantity < line.quantity) {
    line.productionPlanQuantity = line.quantity;
  }
}

function normalizedLines() {
  return editForm.value.lines.map((line) => ({
    ...line,
    deliveryDate: line.deliveryDate || editForm.value.deliveryDate,
    productionPlanQuantity: Math.max(line.productionPlanQuantity || line.quantity, line.quantity)
  }));
}

async function submitOrder() {
  if (!order.value) {
    return;
  }
  try {
    order.value = await erpApi.submitOrder(order.value.orderNo);
    ElMessage.success('订单已提交生产');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '提交失败');
  }
}

watch(() => route.params.orderNo, loadOrder);
onMounted(loadOrder);
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

.dialog-subtitle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0 12px;
}
</style>
