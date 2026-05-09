<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">仓库操作</h2>
      <div class="page-actions">
        <el-badge :value="pendingNoticeCount" :hidden="pendingNoticeCount === 0" class="notice-badge">
          <el-button :icon="Bell" @click="openWarehouseNotices">通知</el-button>
        </el-badge>
        <el-button @click="openWarehouseDialog">新增仓库</el-button>
        <el-button @click="openLocationDialog">新增库位</el-button>
        <el-button :loading="loading" @click="queryWarehouseWork">刷新</el-button>
      </div>
    </div>

    <div class="filter-bar warehouse-filter">
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
          @change="queryWarehouseWork"
        />
      </div>
      <el-button type="primary" :loading="loading" @click="queryWarehouseWork">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">待入库</div>
        <div class="stat-value">{{ receipts.length }} 批</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">待发货</div>
        <div class="stat-value">{{ shipments.length }} 批</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">仓库</div>
        <div class="stat-value">{{ warehouses.length }} 个</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">库位</div>
        <div class="stat-value">{{ locationCount }} 个</div>
      </div>
    </div>

    <div class="table-card desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">生产完成待入库</h3>
      </div>
      <el-table v-loading="loading" :data="receipts" max-height="clamp(220px, 26vh, 320px)">
        <el-table-column label="完成单号" min-width="190">
          <template #default="{ row }">
            <div class="cell-main">{{ row.productionTaskNo }}</div>
            <div v-if="taskRelationText(row)" class="cell-subtext">{{ taskRelationText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="订单号" min-width="160">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column label="订单日期" width="110">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="110">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="150" />
        <el-table-column prop="partName" label="零件" min-width="150" />
        <el-table-column label="图纸" min-width="180">
          <template #default="{ row }">
            <div class="cell-main">{{ drawingTitle(row) }}</div>
            <DrawingPreviewLink
              :file-name="row.drawingFileName"
              :file-url="row.drawingFileUrl"
              link-text="打开图纸"
              :title="`${row.partName} 入库图纸`"
            />
          </template>
        </el-table-column>
        <el-table-column label="规格 / 厚度" min-width="150">
          <template #default="{ row }">
            <div>{{ row.partSpecification || '-' }}</div>
            <div class="cell-subtext">{{ row.partThickness ? `${row.partThickness} mm` : '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="完成 / 生产计划" width="150">
          <template #default="{ row }">
            {{ formatQuantity(row.completedQuantity || row.quantity, row.unit) }} /
            {{ formatQuantity(row.plannedQuantity || row.quantity, row.unit) }}
          </template>
        </el-table-column>
        <el-table-column label="客户订单数量" width="125">
          <template #default="{ row }">{{ formatQuantity(row.customerOrderQuantity || row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="订单剩余" width="115">
          <template #default="{ row }">{{ formatQuantity(row.remainingOrderQuantity ?? row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="客户订单入库" width="125">
          <template #default="{ row }">{{ formatQuantity(row.orderReceiptQuantity ?? row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="多做库存" width="105">
          <template #default="{ row }">
            <span :class="{ 'stock-extra': (row.stockQuantity || 0) > 0 }">
              {{ row.stockQuantity ? formatQuantity(row.stockQuantity, row.unit) : '-' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" width="140">
          <template #default>待选择</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="95" />
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openConfirm(row)">确认入库</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-section">
      <h3 class="mobile-section-title">生产完成待入库</h3>
      <article v-for="receipt in receipts" :key="receipt.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ receipt.partName }}</strong>
            <small>{{ receipt.productionTaskNo }}</small>
            <small v-if="taskRelationText(receipt)">{{ taskRelationText(receipt) }}</small>
          </div>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>状态</label>
            <span>{{ receipt.status }}</span>
          </div>
          <div class="mobile-field">
            <label>订单号</label>
            <span><OrderNoLink :order-no="receipt.orderNo" /></span>
          </div>
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ receipt.customerName }}</span>
          </div>
          <div class="mobile-field">
            <label>图纸</label>
            <span>{{ drawingTitle(receipt) }}</span>
          </div>
          <div class="mobile-field">
            <label>规格 / 厚度</label>
            <span>{{ receipt.partSpecification || '-' }} / {{ receipt.partThickness ? `${receipt.partThickness} mm` : '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(receipt.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(receipt.deliveryDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>完成 / 生产计划</label>
            <span>
              {{ formatQuantity(receipt.completedQuantity || receipt.quantity, receipt.unit) }} /
              {{ formatQuantity(receipt.plannedQuantity || receipt.quantity, receipt.unit) }}
            </span>
          </div>
          <div class="mobile-field">
            <label>客户订单数量</label>
            <span>{{ formatQuantity(receipt.customerOrderQuantity || receipt.quantity, receipt.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>订单剩余</label>
            <span>{{ formatQuantity(receipt.remainingOrderQuantity ?? receipt.quantity, receipt.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>客户订单入库</label>
            <span>{{ formatQuantity(receipt.orderReceiptQuantity ?? receipt.quantity, receipt.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>多做库存</label>
            <span :class="{ 'stock-extra': (receipt.stockQuantity || 0) > 0 }">
              {{ receipt.stockQuantity ? formatQuantity(receipt.stockQuantity, receipt.unit) : '-' }}
            </span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <DrawingPreviewLink
            :file-name="receipt.drawingFileName"
            :file-url="receipt.drawingFileUrl"
            link-text="打开图纸"
            :title="`${receipt.partName} 入库图纸`"
          />
          <el-button link type="primary" @click="openConfirm(receipt)">确认入库</el-button>
        </div>
      </article>
      <div v-if="!receipts.length && !loading" class="mobile-empty">暂无待入库任务</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">待发货库存</h3>
        <div class="panel-actions">
          <span v-if="selectedShipments.length" class="muted">
            已选 {{ selectedShipments.length }} 批{{ selectedShipmentOrderNo ? ` / ${selectedShipmentOrderNo}` : '' }}
          </span>
          <el-button size="small" type="primary" :disabled="selectedShipments.length === 0" @click="openBatchShipmentConfirmFromSelection">
            批量确认发货
          </el-button>
        </div>
      </div>
      <div v-if="shipmentOrderGroups.length" class="shipment-order-groups">
        <article v-for="group in shipmentOrderGroups" :key="group.orderNo" class="shipment-order-card">
          <div>
            <strong><OrderNoLink :order-no="group.orderNo" /></strong>
            <span>{{ group.customerName || '-' }}</span>
            <small>{{ group.partCount }} 种零件 / {{ group.batchCount }} 批 / {{ group.totalText }}</small>
          </div>
          <el-button size="small" type="primary" plain @click="openOrderShipmentConfirm(group.rows[0])">
            整单发货
          </el-button>
        </article>
      </div>
      <el-table
        ref="shipmentTableRef"
        :data="shipments"
        row-key="id"
        max-height="clamp(220px, 26vh, 320px)"
        @selection-change="handleShipmentSelectionChange"
      >
        <el-table-column type="selection" width="46" />
        <el-table-column label="库存批次" min-width="210">
          <template #default="{ row }">
            <div class="cell-main">{{ row.batchNo }}</div>
            <div v-if="taskRelationText(row)" class="cell-subtext">{{ taskRelationText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="订单号" min-width="160">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column label="订单日期" width="110">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="110">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="150" />
        <el-table-column prop="partName" label="零件" min-width="150" />
        <el-table-column label="图纸" min-width="180">
          <template #default="{ row }">
            <div class="cell-main">{{ drawingTitle(row) }}</div>
            <DrawingPreviewLink
              :file-name="row.drawingFileName"
              :file-url="row.drawingFileUrl"
              link-text="打开图纸"
              :title="`${row.partName} 发货图纸`"
            />
          </template>
        </el-table-column>
        <el-table-column label="规格 / 厚度" min-width="150">
          <template #default="{ row }">
            <div>{{ row.partSpecification || '-' }}</div>
            <div class="cell-subtext">{{ row.partThickness ? `${row.partThickness} mm` : '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="100">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="160">
          <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="selectShipmentOrder(row)">选中整单</el-button>
            <el-button link type="primary" @click="openOrderShipmentConfirm(row)">整单发货</el-button>
            <el-button link type="primary" @click="openShipmentSourceDetails(row)">来源/图纸</el-button>
            <el-button link type="primary" @click="openShipmentConfirm(row)">确认发货</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-section">
      <h3 class="mobile-section-title">待发货库存</h3>
      <div v-if="shipmentOrderGroups.length" class="mobile-shipment-order-groups">
        <article v-for="group in shipmentOrderGroups" :key="group.orderNo" class="mobile-card shipment-mobile-order-card">
          <div class="mobile-card-header">
            <div class="mobile-card-title">
              <strong><OrderNoLink :order-no="group.orderNo" /></strong>
              <small>{{ group.customerName || '-' }}</small>
            </div>
          </div>
          <div class="mobile-card-fields">
            <div class="mobile-field">
              <label>零件 / 批次</label>
              <span>{{ group.partCount }} 种 / {{ group.batchCount }} 批</span>
            </div>
            <div class="mobile-field">
              <label>待发货数量</label>
              <span>{{ group.totalText }}</span>
            </div>
          </div>
          <div class="mobile-card-actions">
            <el-button size="small" type="primary" plain @click="openOrderShipmentConfirm(group.rows[0])">
              整单发货
            </el-button>
          </div>
        </article>
      </div>
      <article v-for="shipment in shipments" :key="shipment.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ shipment.partName }}</strong>
            <small>{{ shipment.batchNo }}</small>
            <small v-if="taskRelationText(shipment)">{{ taskRelationText(shipment) }}</small>
          </div>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>状态</label>
            <span>{{ shipment.status }}</span>
          </div>
          <div class="mobile-field">
            <label>订单号</label>
            <span><OrderNoLink :order-no="shipment.orderNo" /></span>
          </div>
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ shipment.customerName || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(shipment.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(shipment.deliveryDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>图纸</label>
            <span>{{ drawingTitle(shipment) }}</span>
          </div>
          <div class="mobile-field">
            <label>规格 / 厚度</label>
            <span>{{ partSpecText(shipment) }}</span>
          </div>
          <div class="mobile-field">
            <label>数量</label>
            <span>{{ formatQuantity(shipment.quantity, shipment.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>仓库 / 库位</label>
            <span>{{ shipment.warehouseName }} / {{ shipment.locationName || '-' }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <DrawingPreviewLink
            :file-name="shipment.drawingFileName"
            :file-url="shipment.drawingFileUrl"
            link-text="打开图纸"
            :title="`${shipment.partName} 发货图纸`"
          />
          <el-button link type="primary" @click="openShipmentSourceDetails(shipment)">来源/图纸</el-button>
          <el-button link type="primary" @click="openShipmentConfirm(shipment)">确认发货</el-button>
          <el-button link type="primary" @click="openOrderShipmentConfirm(shipment)">整单发货</el-button>
        </div>
      </article>
      <div v-if="!shipments.length && !loading" class="mobile-empty">暂无待发货库存</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">仓库 / 库位</h3>
      </div>
      <el-table :data="warehouseRows" max-height="clamp(220px, 26vh, 320px)">
        <el-table-column prop="warehouseCode" label="仓库编码" width="140" />
        <el-table-column prop="warehouseName" label="仓库名称" min-width="180" />
        <el-table-column prop="locationCode" label="库位编码" width="140" />
        <el-table-column prop="locationName" label="库位名称" width="140" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <StatusTag :value="row.status" />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">仓库 / 库位</h3>
      <article v-for="row in warehouseRows" :key="`${row.warehouseCode}-${row.locationCode}`" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.warehouseName }}</strong>
            <small>{{ row.warehouseCode }}</small>
          </div>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>状态</label>
            <span><StatusTag :value="row.status" /></span>
          </div>
          <div class="mobile-field">
            <label>库位编码</label>
            <span>{{ row.locationCode }}</span>
          </div>
          <div class="mobile-field">
            <label>库位名称</label>
            <span>{{ row.locationName }}</span>
          </div>
        </div>
      </article>
      <div v-if="!warehouseRows.length && !loading" class="mobile-empty">暂无库位</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">库存流水</h3>
        <el-segmented v-model="transactionType" :options="transactionOptions" @change="loadTransactions" />
      </div>
      <el-table :data="transactions" max-height="clamp(220px, 26vh, 320px)">
        <el-table-column prop="transactionNo" label="流水号" min-width="210" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">{{ row.transactionType === 'IN' ? '入库' : '出库' }}</template>
        </el-table-column>
        <el-table-column prop="partName" label="零件" min-width="160" />
        <el-table-column label="批次 / 任务" min-width="210">
          <template #default="{ row }">
            <div class="cell-main">{{ row.batchNo || '-' }}</div>
            <small v-if="row.productionTaskNo" class="muted">{{ row.productionTaskNo }}</small>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="120">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="批次余量" min-width="170">
          <template #default="{ row }">
            <div v-if="row.batchNo" class="inventory-balance-cell">
              <span>可用 {{ formatQuantity(row.availableQuantity ?? 0, row.unit) }}</span>
              <small class="muted">
                账面 {{ formatQuantity(row.physicalQuantity ?? 0, row.unit) }}
                <template v-if="(row.reservedQuantity || 0) > 0">
                  / 预占 {{ formatQuantity(row.reservedQuantity || 0, row.unit) }}
                </template>
              </small>
            </div>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="170">
          <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column label="来源订单" min-width="180">
          <template #default="{ row }">
            <OrderNoLink :order-no="transactionSourceOrderNo(row)" />
            <small v-if="row.orderNo && row.sourceOrderNo && row.orderNo !== row.sourceOrderNo" class="muted">
              当前订单 <OrderNoLink :order-no="row.orderNo" />
            </small>
            <small v-if="row.productionSourceOrderNo && row.productionSourceOrderNo !== transactionSourceOrderNo(row)" class="muted">
              生产来源 <OrderNoLink :order-no="row.productionSourceOrderNo" />
            </small>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="160" />
      </el-table>
    </div>

    <div class="mobile-section">
      <div class="mobile-card-header">
        <h3 class="mobile-section-title">库存流水</h3>
        <el-segmented v-model="transactionType" :options="transactionOptions" @change="loadTransactions" />
      </div>
      <article v-for="transaction in transactions" :key="transaction.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ transaction.partName }}</strong>
            <small>{{ transaction.transactionNo }}</small>
          </div>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>类型</label>
            <span>{{ transaction.transactionType === 'IN' ? '入库' : '出库' }}</span>
          </div>
          <div class="mobile-field">
            <label>数量</label>
            <span>{{ formatQuantity(transaction.quantity, transaction.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>批次 / 任务</label>
            <span>
              {{ transaction.batchNo || '-' }}
              <small v-if="transaction.productionTaskNo" class="muted">{{ transaction.productionTaskNo }}</small>
            </span>
          </div>
          <div v-if="transaction.batchNo" class="mobile-field">
            <label>批次余量</label>
            <span>
              可用 {{ formatQuantity(transaction.availableQuantity ?? 0, transaction.unit) }}
              <small class="muted">
                账面 {{ formatQuantity(transaction.physicalQuantity ?? 0, transaction.unit) }}
                <template v-if="(transaction.reservedQuantity || 0) > 0">
                  / 预占 {{ formatQuantity(transaction.reservedQuantity || 0, transaction.unit) }}
                </template>
              </small>
            </span>
          </div>
          <div class="mobile-field">
            <label>仓库 / 库位</label>
            <span>{{ transaction.warehouseName }} / {{ transaction.locationName || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>来源订单</label>
            <span>
              <OrderNoLink :order-no="transactionSourceOrderNo(transaction)" />
              <small v-if="transaction.orderNo && transaction.sourceOrderNo && transaction.orderNo !== transaction.sourceOrderNo" class="muted">
                当前订单 <OrderNoLink :order-no="transaction.orderNo" />
              </small>
              <small
                v-if="transaction.productionSourceOrderNo && transaction.productionSourceOrderNo !== transactionSourceOrderNo(transaction)"
                class="muted"
              >
                生产来源 <OrderNoLink :order-no="transaction.productionSourceOrderNo" />
              </small>
            </span>
          </div>
          <div class="mobile-field">
            <label>备注</label>
            <span>{{ transaction.remark || '-' }}</span>
          </div>
        </div>
      </article>
      <div v-if="!transactions.length && !loading" class="mobile-empty">暂无库存流水</div>
    </div>

    <el-dialog
      v-model="confirmVisible"
      title="确认入库"
      width="min(440px, calc(100vw - 32px))"
      :close-on-click-modal="false"
      :before-close="handleSavingDialogBeforeClose"
      @closed="resetReceiptDialog"
    >
      <el-form label-width="92px">
        <el-form-item label="零件">
          <strong>{{ activeReceipt?.partName }}</strong>
        </el-form-item>
        <el-form-item label="图纸">
          <div class="receipt-drawing-info">
            <strong>{{ activeReceipt ? drawingTitle(activeReceipt) : '-' }}</strong>
            <DrawingPreviewLink
              v-if="activeReceipt"
              :file-name="activeReceipt.drawingFileName"
              :file-url="activeReceipt.drawingFileUrl"
              link-text="打开图纸"
              :title="`${activeReceipt.partName} 入库图纸`"
            />
          </div>
        </el-form-item>
        <el-form-item label="规格/厚度">
          {{
            activeReceipt
              ? `${activeReceipt.partSpecification || '-'} / ${activeReceipt.partThickness ? `${activeReceipt.partThickness} mm` : '-'}`
              : '-'
          }}
        </el-form-item>
        <el-form-item v-if="activeReceipt && taskRelationText(activeReceipt)" label="任务来源">
          {{ taskRelationText(activeReceipt) }}
        </el-form-item>
        <el-form-item label="实际完成">
          {{ activeReceipt ? formatQuantity(activeReceipt.completedQuantity || activeReceipt.quantity, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item label="生产计划">
          {{ activeReceipt ? formatQuantity(activeReceipt.plannedQuantity || activeReceipt.quantity, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item label="客户订单">
          {{ activeReceipt ? formatQuantity(activeReceipt.customerOrderQuantity || activeReceipt.quantity, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item label="已入订单">
          {{ activeReceipt ? formatQuantity(activeReceipt.receivedOrderQuantity || 0, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item label="订单剩余">
          {{ activeReceipt ? formatQuantity(activeReceipt.remainingOrderQuantity ?? activeReceipt.quantity, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item label="客户订单入库">
          {{ activeReceipt ? formatQuantity(activeReceipt.orderReceiptQuantity ?? activeReceipt.quantity, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item v-if="activeReceipt?.stockQuantity" label="多做库存">
          <strong class="stock-extra">{{ formatQuantity(activeReceipt.stockQuantity, activeReceipt.unit) }}</strong>
        </el-form-item>
        <el-form-item label="仓库">
          <el-select v-model="receiptForm.warehouseId" placeholder="选择仓库" style="width: 260px" @change="resetLocation">
            <el-option v-for="item in warehouses" :key="item.id" :label="item.warehouseName" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="库位" required>
          <el-select v-model="receiptForm.locationId" placeholder="选择库位" style="width: 260px">
            <el-option v-for="item in currentLocations" :key="item.id" :label="item.locationName" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="receiptForm.remark"
            type="textarea"
            :rows="3"
            maxlength="120"
            show-word-limit
            placeholder="例如：订单数量入库，多做数量转库存"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="confirmVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmReceipt">确认入库</el-button>
      </template>
    </el-dialog>

    <InventorySourceDetailsDialog
      v-model="shipmentSourceDetailsVisible"
      :loading="shipmentSourceDetailsLoading"
      :detail="shipmentSourceDetails"
      :focus-batch-id="shipmentSourceFocusBatchId"
      :focus-batch-no="shipmentSourceFocusBatchNo"
    />

    <el-dialog
      v-model="shipmentVisible"
      title="确认发货"
      width="min(460px, calc(100vw - 32px))"
      :close-on-click-modal="false"
      :before-close="handleSavingDialogBeforeClose"
      @closed="resetShipmentDialog"
    >
      <el-form label-width="92px">
        <el-form-item label="库存批次">
          <strong>{{ activeShipment?.batchNo }}</strong>
        </el-form-item>
        <el-form-item v-if="activeShipment && taskRelationText(activeShipment)" label="任务来源">
          {{ taskRelationText(activeShipment) }}
        </el-form-item>
        <el-form-item label="订单号">
          <OrderNoLink v-if="activeShipment?.orderNo" :order-no="activeShipment.orderNo" />
          <span v-else>-</span>
        </el-form-item>
        <el-form-item label="零件">
          {{ activeShipment?.partName || '-' }}
        </el-form-item>
        <el-form-item label="图纸">
          <div class="receipt-drawing-info">
            <strong>{{ activeShipment ? drawingTitle(activeShipment) : '-' }}</strong>
            <DrawingPreviewLink
              v-if="activeShipment"
              :file-name="activeShipment.drawingFileName"
              :file-url="activeShipment.drawingFileUrl"
              link-text="打开图纸"
              :title="`${activeShipment.partName} 发货图纸`"
            />
          </div>
        </el-form-item>
        <el-form-item label="规格/厚度">
          {{ activeShipment ? partSpecText(activeShipment) : '-' }}
        </el-form-item>
        <el-form-item label="数量">
          {{ activeShipment ? formatQuantity(activeShipment.quantity, activeShipment.unit) : '-' }}
        </el-form-item>
        <el-form-item label="仓库">
          {{
            activeShipment
              ? `${activeShipment.warehouseName} / ${activeShipment.locationName || '-'}`
              : '-'
          }}
        </el-form-item>
        <el-form-item label="库存来源">
          <el-button
            v-if="activeShipment"
            link
            type="primary"
            @click="openShipmentSourceDetails(activeShipment)"
          >
            查看生产订单 / 图纸
          </el-button>
          <span v-else>-</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="shipmentForm.remark"
            type="textarea"
            :rows="3"
            maxlength="120"
            show-word-limit
            placeholder="例如：按订单发货"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="shipmentVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmShipment">确认发货</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="batchShipmentVisible"
      :title="batchShipmentIsOrderMode ? '整单确认发货' : '批量确认发货'"
      width="min(760px, calc(100vw - 32px))"
      :close-on-click-modal="false"
      :before-close="handleSavingDialogBeforeClose"
      @closed="resetBatchShipmentDialog"
    >
      <el-alert
        :title="batchShipmentAlertTitle"
        type="warning"
        :closable="false"
        class="mb-16"
      />
      <el-form label-width="92px">
        <el-form-item label="订单号">
          <OrderNoLink v-if="batchShipmentOrderNo" :order-no="batchShipmentOrderNo" />
          <span v-else>-</span>
        </el-form-item>
        <el-form-item label="客户">
          <strong>{{ batchShipmentCustomerName || '-' }}</strong>
        </el-form-item>
        <el-form-item :label="batchShipmentIsOrderMode ? '当前可见' : '选中批次'">
          <span>
            {{ batchShipmentRows.length }} 批 / {{ batchShipmentTotalText }}
            <span v-if="batchShipmentIsOrderMode" class="muted">，确认时以后端该订单全部待发货库存为准</span>
          </span>
        </el-form-item>
        <el-table :data="batchShipmentRows" max-height="260px" class="batch-shipment-table">
          <el-table-column prop="batchNo" label="库存批次" min-width="190" />
          <el-table-column prop="partName" label="零件" min-width="160" />
          <el-table-column label="图纸" min-width="180">
            <template #default="{ row }">
              <div class="cell-main">{{ drawingTitle(row) }}</div>
              <DrawingPreviewLink
                :file-name="row.drawingFileName"
                :file-url="row.drawingFileUrl"
                link-text="打开图纸"
                :title="`${row.partName} 发货图纸`"
              />
            </template>
          </el-table-column>
          <el-table-column label="规格 / 厚度" min-width="150">
            <template #default="{ row }">{{ partSpecText(row) }}</template>
          </el-table-column>
          <el-table-column label="数量" width="110">
            <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="仓库 / 库位" min-width="160">
            <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
          </el-table-column>
          <el-table-column label="来源/图纸" width="100">
            <template #default="{ row }">
              <el-button link type="primary" @click="openShipmentSourceDetails(row)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-form-item label="备注">
          <el-input
            v-model="batchShipmentForm.remark"
            type="textarea"
            :rows="3"
            maxlength="120"
            show-word-limit
            :placeholder="batchShipmentRemarkPlaceholder"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="batchShipmentVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmBatchShipment">
          {{ batchShipmentIsOrderMode ? '确认整单发货' : '确认批量发货' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="warehouseVisible"
      title="新增仓库"
      width="min(420px, calc(100vw - 32px))"
      :before-close="handleSavingDialogBeforeClose"
    >
      <el-form label-width="92px">
        <el-form-item label="仓库编码">
          <el-input v-model="warehouseForm.warehouseCode" placeholder="不填则自动生成" />
        </el-form-item>
        <el-form-item label="仓库名称">
          <el-input v-model="warehouseForm.warehouseName" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="warehouseVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveWarehouse">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="locationVisible"
      title="新增库位"
      width="min(420px, calc(100vw - 32px))"
      :before-close="handleSavingDialogBeforeClose"
    >
      <el-form label-width="92px">
        <el-form-item label="仓库">
          <el-select v-model="locationForm.warehouseId" placeholder="选择仓库" style="width: 260px">
            <el-option v-for="item in warehouses" :key="item.id" :label="item.warehouseName" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="库位编码">
          <el-input v-model="locationForm.locationCode" />
        </el-form-item>
        <el-form-item label="库位名称">
          <el-input v-model="locationForm.locationName" placeholder="不填则使用库位编码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="locationVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveLocation">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="noticeVisible" title="仓库通知" width="min(760px, calc(100vw - 32px))">
      <div v-loading="noticeLoading" class="notice-list">
        <div v-if="warehouseNotices.length === 0" class="muted">暂无仓库通知</div>
        <article v-for="notice in warehouseNotices" :key="notice.id" class="notice-item">
          <div>
            <strong>{{ warehouseNoticeTitle(notice) }}</strong>
            <p>{{ notice.reason }}</p>
            <small>{{ formatDateTime(notice.createdAt) }}</small>
          </div>
          <el-button
            v-if="notice.status === 'PENDING'"
            size="small"
            type="primary"
            @click="acknowledgeWarehouseNotice(notice)"
          >
            确认已知晓
          </el-button>
          <StatusTag v-else value="ACKNOWLEDGED" compact />
        </article>
      </div>
      <template #footer>
        <el-button @click="noticeVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <NoticeAcknowledgeDialog
      v-model="acknowledgeVisible"
      title="确认仓库通知"
      name-label="仓库确认人员"
      name-placeholder="请输入仓库确认人员姓名"
      :notice-title="activeWarehouseNotice ? warehouseNoticeTitle(activeWarehouseNotice) : ''"
      :notice-reason="activeWarehouseNotice?.reason"
      :created-at-text="activeWarehouseNotice ? formatDateTime(activeWarehouseNotice.createdAt) : ''"
      :loading="acknowledgeSaving"
      @confirm="saveWarehouseNoticeAcknowledge"
    />

    <el-dialog
      v-model="stockNoticeVisible"
      :title="stockNoticeDialogTitle"
      width="min(640px, calc(100vw - 32px))"
      append-to-body
      :close-on-click-modal="false"
      :before-close="handleStockNoticeBeforeClose"
    >
      <div v-if="activeWarehouseNotice" class="notice-stock-panel">
        <el-alert
          :title="stockNoticeAlertTitle"
          type="warning"
          :closable="false"
          class="mb-16"
        />
        <div class="notice-summary-card">
          <strong>{{ warehouseNoticeTitle(activeWarehouseNotice) }}</strong>
          <p>{{ activeWarehouseNotice.reason }}</p>
          <span>
            {{ activeWarehouseNotice.partName || '-' }} /
            {{ formatQuantity(activeWarehouseNotice.afterQuantity || 0, activeWarehouseNotice.unit || '件') }}
          </span>
        </div>
        <div v-if="activeWarehouseNotice.handlingPlan" class="notice-plan-card">
          <strong>取消时处理建议</strong>
          <span>{{ handlingPlanText(activeWarehouseNotice) }}</span>
          <small>仓库可根据实物清点结果修改处理方式、数量和备注，最终以仓库确认记录为准。</small>
        </div>
        <el-form label-width="116px" class="mt-16">
          <el-form-item label="仓库确认人员" required>
            <el-input v-model="stockNoticeForm.acknowledgedBy" maxlength="30" show-word-limit placeholder="请输入仓库确认人员姓名" />
          </el-form-item>
          <el-form-item v-if="showCustomerChangeHandlingFields" label="处理方式" required>
            <el-radio-group v-model="stockNoticeForm.handlingMode" @change="handleStockNoticeModeChange">
              <el-radio-button value="STOCK">转备货库存</el-radio-button>
              <el-radio-button value="SCRAP">报废</el-radio-button>
              <el-radio-button value="NONE">无实物处理</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="showCustomerChangeHandlingFields && stockNoticeForm.handlingMode !== 'NONE'" label="处理数量" required>
            <el-input-number v-model="stockNoticeForm.handlingQuantity" :min="0" :precision="3" :controls="false" style="width: 180px" />
            <span class="unit-text">{{ activeWarehouseNotice.unit || '件' }}</span>
          </el-form-item>
          <el-form-item v-if="stockNoticeNeedsWarehouse" label="转入仓库" required>
            <el-select v-model="stockNoticeForm.warehouseId" placeholder="选择转入仓库" style="width: 260px" @change="resetStockNoticeLocation">
              <el-option v-for="item in warehouses" :key="item.id" :label="item.warehouseName" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="stockNoticeNeedsWarehouse" label="库位" required>
            <el-select v-model="stockNoticeForm.locationId" placeholder="选择库位" style="width: 260px">
              <el-option v-for="item in currentStockNoticeLocations" :key="item.id" :label="item.locationName" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="showStockMergeConfirm" label="来源合并确认" required>
            <el-checkbox v-model="stockNoticeForm.mergeConfirmed">
              已确认该取消/变更订单库存可以与同型号现有库存合并展示；库存明细仍按批次保留来源订单。
            </el-checkbox>
          </el-form-item>
          <el-form-item label="备注">
            <el-input
              v-model="stockNoticeForm.remark"
              type="textarea"
              :rows="3"
              maxlength="160"
              show-word-limit
              placeholder="例如：管理撤回实物已清点，转入备货库存"
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button :disabled="stockNoticeSaving" @click="stockNoticeVisible = false">取消</el-button>
        <el-button type="primary" :loading="stockNoticeSaving" @click="saveWithdrawStockNotice">
          {{ stockNoticeConfirmText }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Bell } from '@element-plus/icons-vue';
import { useRoute } from 'vue-router';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import InventorySourceDetailsDialog from '../components/InventorySourceDetailsDialog.vue';
import NoticeAcknowledgeDialog from '../components/NoticeAcknowledgeDialog.vue';
import OrderSelect from '../components/OrderSelect.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import DrawingPreviewLink from '../components/DrawingPreviewLink.vue';
import StatusTag from '../components/StatusTag.vue';
import type {
  InventorySourceDetailResponse,
  OrderSummary,
  ProductionNotice,
  Warehouse,
  WarehouseReceipt,
  WarehouseShipment,
  WarehouseTransaction
} from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';

const route = useRoute();
const orderOptions = ref<OrderSummary[]>([]);
const warehouses = ref<Warehouse[]>([]);
const receipts = ref<WarehouseReceipt[]>([]);
const shipments = ref<WarehouseShipment[]>([]);
const selectedShipments = ref<WarehouseShipment[]>([]);
const batchShipmentRows = ref<WarehouseShipment[]>([]);
const transactions = ref<WarehouseTransaction[]>([]);
const warehouseNotices = ref<ProductionNotice[]>([]);
const dateRange = ref<string[]>([]);
const transactionType = ref<'ALL' | 'IN' | 'OUT'>('ALL');
const loading = ref(false);
const noticeLoading = ref(false);
const acknowledgeVisible = ref(false);
const acknowledgeSaving = ref(false);
const stockNoticeVisible = ref(false);
const stockNoticeSaving = ref(false);
const saving = ref(false);
const noticeVisible = ref(false);
const confirmVisible = ref(false);
const shipmentVisible = ref(false);
const shipmentSourceDetailsVisible = ref(false);
const shipmentSourceDetailsLoading = ref(false);
const batchShipmentVisible = ref(false);
const batchShipmentIsOrderMode = ref(false);
const warehouseVisible = ref(false);
const locationVisible = ref(false);
const activeReceipt = ref<WarehouseReceipt>();
const activeShipment = ref<WarehouseShipment>();
const activeWarehouseNotice = ref<ProductionNotice>();
const shipmentSourceDetails = ref<InventorySourceDetailResponse | null>(null);
const shipmentSourceFocusBatchId = ref('');
const shipmentSourceFocusBatchNo = ref('');
const shipmentTableRef = ref();

const filters = reactive<{
  customerId?: string;
  orderNo?: string;
}>({});
const receiptForm = reactive({
  warehouseId: '',
  locationId: '',
  remark: ''
});
const shipmentForm = reactive({
  remark: ''
});
const batchShipmentForm = reactive({
  remark: ''
});
const stockNoticeForm = reactive({
  acknowledgedBy: '',
  handlingMode: 'STOCK' as 'STOCK' | 'SCRAP' | 'NONE',
  handlingQuantity: 0,
  warehouseId: '',
  locationId: '',
  mergeConfirmed: false,
  remark: ''
});
const warehouseForm = reactive({
  warehouseCode: '',
  warehouseName: ''
});
const locationForm = reactive({
  warehouseId: '',
  locationCode: '',
  locationName: ''
});
const transactionOptions = [
  { label: '全部', value: 'ALL' },
  { label: '入库', value: 'IN' },
  { label: '出库', value: 'OUT' }
];

type ShipmentOrderGroup = {
  orderNo: string;
  customerName: string;
  rows: WarehouseShipment[];
  partCount: number;
  batchCount: number;
  totalText: string;
};

const locationCount = computed(() => warehouses.value.reduce((sum, item) => sum + item.locations.length, 0));
const pendingNoticeCount = computed(() => warehouseNotices.value.filter((notice) => notice.status === 'PENDING').length);
const currentLocations = computed(() => warehouses.value.find((item) => item.id === receiptForm.warehouseId)?.locations || []);
const currentStockNoticeLocations = computed(() => warehouses.value.find((item) => item.id === stockNoticeForm.warehouseId)?.locations || []);
const activeStockNoticeIsWithdraw = computed(() => Boolean(activeWarehouseNotice.value && requiresWithdrawStockReceipt(activeWarehouseNotice.value)));
const showCustomerChangeHandlingFields = computed(() => Boolean(activeWarehouseNotice.value && requiresCustomerChangeHandling(activeWarehouseNotice.value)));
const stockNoticeNeedsWarehouse = computed(
  () => activeStockNoticeIsWithdraw.value || (showCustomerChangeHandlingFields.value && stockNoticeForm.handlingMode === 'STOCK')
);
const showStockMergeConfirm = computed(
  () => showCustomerChangeHandlingFields.value && stockNoticeForm.handlingMode === 'STOCK'
);
const stockNoticeDialogTitle = computed(() => (activeStockNoticeIsWithdraw.value ? '撤回零件转库存确认' : '客户变更物料处理'));
const stockNoticeAlertTitle = computed(() =>
  activeStockNoticeIsWithdraw.value
    ? '该通知来自生产管理撤回，确认后会生成备货库存批次和入库流水。请先选择仓库和库位，避免只确认通知但库存没有增加。'
    : '客户取消或减量后，仓库需要记录多余实物的处理方式：转备货库存、报废，或确认无实物处理。'
);
const stockNoticeConfirmText = computed(() => {
  if (activeStockNoticeIsWithdraw.value || stockNoticeForm.handlingMode === 'STOCK') {
    return '确认转入库存';
  }
  if (stockNoticeForm.handlingMode === 'SCRAP') {
    return '确认报废';
  }
  return '确认无实物处理';
});
const selectedShipmentOrderNo = computed(() => {
  const orderNos = Array.from(new Set(selectedShipments.value.map((item) => item.orderNo).filter(Boolean)));
  return orderNos.length === 1 ? orderNos[0] : '';
});
const batchShipmentOrderNo = computed(() => {
  const orderNos = Array.from(new Set(batchShipmentRows.value.map((item) => item.orderNo).filter(Boolean)));
  return orderNos.length === 1 ? orderNos[0] : '';
});
const batchShipmentCustomerName = computed(() => batchShipmentRows.value[0]?.customerName || '');
const batchShipmentTotalText = computed(() => formatShipmentTotal(batchShipmentRows.value));
const batchShipmentAlertTitle = computed(() =>
  batchShipmentIsOrderMode.value
    ? '整单发货会以后端该订单全部待发货库存为准，不只发当前可见行；若仍有未入库或未完成零件，订单会继续保持待发货或流转中。'
    : '批量发货只允许选择同一订单的待发货库存。确认后，选中批次会一次性出库；若该订单所有零件都已发完，订单自动完成。'
);
const batchShipmentRemarkPlaceholder = computed(() =>
  batchShipmentIsOrderMode.value ? '例如：按订单整单发货' : '例如：按订单批量发货'
);
const shipmentOrderGroups = computed(() => {
  const groupMap = new Map<string, ShipmentOrderGroup>();
  for (const row of shipments.value) {
    const key = row.orderNo;
    if (!key) {
      continue;
    }
    const group =
      groupMap.get(key) ??
      {
        orderNo: key,
        customerName: row.customerName || '',
        rows: [],
        partCount: 0,
        batchCount: 0,
        totalText: ''
      };
    group.rows.push(row);
    group.partCount = new Set(group.rows.map((item) => item.partCode)).size;
    group.batchCount = group.rows.length;
    group.totalText = formatShipmentTotal(group.rows);
    groupMap.set(key, group);
  }
  return [...groupMap.values()].sort((a, b) => a.orderNo.localeCompare(b.orderNo, 'zh-Hans-CN'));
});
const warehouseRows = computed(() =>
  warehouses.value.flatMap((warehouse) =>
    warehouse.locations.map((location) => ({
      warehouseCode: warehouse.warehouseCode,
      warehouseName: warehouse.warehouseName,
      locationCode: location.locationCode,
      locationName: location.locationName,
      status: location.status
    }))
  )
);

function warehouseWorkParams() {
  return {
    customerId: filters.customerId,
    orderNo: filters.orderNo,
    dateFrom: dateRange.value[0],
    dateTo: dateRange.value[1]
  };
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
    ElMessage.error(error instanceof Error ? error.message : '订单选项加载失败');
  }
}

async function loadData() {
  loading.value = true;
  try {
    const [warehouseResult, receiptResult, shipmentResult, noticeResult] = await Promise.all([
      erpApi.warehouses(),
      erpApi.pendingReceipts(warehouseWorkParams()),
      erpApi.pendingShipments(warehouseWorkParams()),
      erpApi.warehouseNotices()
    ]);
    warehouses.value = warehouseResult;
    receipts.value = receiptResult;
    shipments.value = shipmentResult;
    selectedShipments.value = [];
    shipmentTableRef.value?.clearSelection();
    warehouseNotices.value = noticeResult;
    await loadTransactions();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '仓库数据加载失败');
  } finally {
    loading.value = false;
  }
}

async function queryWarehouseWork() {
  loading.value = true;
  try {
    await loadOrderOptions();
    await loadData();
  } finally {
    loading.value = false;
  }
}

async function handleScopeChange() {
  filters.orderNo = undefined;
  await queryWarehouseWork();
}

async function resetFilters() {
  filters.customerId = undefined;
  filters.orderNo = undefined;
  dateRange.value = [];
  await queryWarehouseWork();
}

async function loadTransactions() {
  try {
    transactions.value = await erpApi.warehouseTransactions({
      ...warehouseWorkParams(),
      transactionType: transactionType.value === 'ALL' ? undefined : transactionType.value
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '库存流水加载失败');
  }
}

function routeOrderNo() {
  const value = route.query.orderNo;
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function applyRouteOrderFilter() {
  const orderNo = routeOrderNo().trim();
  if (orderNo) {
    filters.orderNo = orderNo;
  }
}

async function loadWarehouseNotices() {
  noticeLoading.value = true;
  try {
    warehouseNotices.value = await erpApi.warehouseNotices();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '仓库通知加载失败');
  } finally {
    noticeLoading.value = false;
  }
}

async function openWarehouseNotices() {
  noticeVisible.value = true;
  await loadWarehouseNotices();
}

function warehouseNoticeTitle(notice: ProductionNotice) {
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

function acknowledgeWarehouseNotice(notice: ProductionNotice) {
  activeWarehouseNotice.value = notice;
  if (requiresWithdrawStockReceipt(notice) || requiresCustomerChangeHandling(notice)) {
    const handlingPlan = notice.handlingPlan;
    stockNoticeForm.acknowledgedBy = '';
    stockNoticeForm.handlingMode = requiresWithdrawStockReceipt(notice)
      ? 'STOCK'
      : handlingPlan?.handlingMode || 'NONE';
    stockNoticeForm.handlingQuantity = handlingPlan?.handlingQuantity || 0;
    stockNoticeForm.warehouseId = warehouses.value[0]?.id || '';
    stockNoticeForm.mergeConfirmed = false;
    stockNoticeForm.remark = handlingPlan?.remark || '';
    resetStockNoticeLocation();
    stockNoticeVisible.value = true;
    return;
  }
  acknowledgeVisible.value = true;
}

async function saveWarehouseNoticeAcknowledge(acknowledgedBy: string) {
  const notice = activeWarehouseNotice.value;
  if (!notice) {
    return;
  }
  acknowledgeSaving.value = true;
  try {
    await erpApi.acknowledgeWarehouseNotice(notice.id, acknowledgedBy);
    ElMessage.success('仓库通知已确认');
    acknowledgeVisible.value = false;
    await loadWarehouseNotices();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '确认仓库通知失败');
  } finally {
    acknowledgeSaving.value = false;
  }
}

function requiresWithdrawStockReceipt(notice: ProductionNotice) {
  return notice.noticeType === 'TASK_WITHDRAWN' && Number(notice.afterQuantity || 0) > 0;
}

function requiresCustomerChangeHandling(notice: ProductionNotice) {
  return notice.noticeType === 'ORDER_CANCELLED' || notice.noticeType === 'QUANTITY_DECREASE';
}

function handlingPlanText(notice: ProductionNotice) {
  const plan = notice.handlingPlan;
  if (!plan) {
    return '';
  }
  const quantityText = formatQuantity(plan.handlingQuantity || 0, notice.unit || '件');
  const remarkText = plan.remark ? `，说明：${plan.remark}` : '';
  if (plan.handlingMode === 'STOCK') {
    return `建议转备货库存 ${quantityText}${remarkText}`;
  }
  if (plan.handlingMode === 'SCRAP') {
    return `建议报废 ${quantityText}${remarkText}`;
  }
  return `建议无实物处理${remarkText}`;
}

function resetStockNoticeLocation() {
  stockNoticeForm.locationId = currentStockNoticeLocations.value[0]?.id || '';
}

function handleSavingDialogBeforeClose(done: () => void) {
  if (saving.value) {
    return;
  }
  done();
}

function handleStockNoticeBeforeClose(done: () => void) {
  if (stockNoticeSaving.value) {
    return;
  }
  done();
}

function handleStockNoticeModeChange() {
  if (stockNoticeForm.handlingMode === 'NONE') {
    stockNoticeForm.handlingQuantity = 0;
    stockNoticeForm.warehouseId = '';
    stockNoticeForm.locationId = '';
    stockNoticeForm.mergeConfirmed = false;
    return;
  }
  if (stockNoticeForm.handlingMode === 'STOCK' && !stockNoticeForm.warehouseId) {
    stockNoticeForm.warehouseId = warehouses.value[0]?.id || '';
    resetStockNoticeLocation();
  }
}

async function saveWithdrawStockNotice() {
  const notice = activeWarehouseNotice.value;
  if (!notice) {
    return;
  }
  if (!stockNoticeForm.acknowledgedBy.trim()) {
    ElMessage.warning('请填写仓库确认人员');
    return;
  }
  if (showCustomerChangeHandlingFields.value && stockNoticeForm.handlingMode !== 'NONE' && stockNoticeForm.handlingQuantity <= 0) {
    ElMessage.warning('请填写处理数量');
    return;
  }
  if (stockNoticeNeedsWarehouse.value && !stockNoticeForm.warehouseId) {
    ElMessage.warning('请选择转入仓库');
    return;
  }
  if (stockNoticeNeedsWarehouse.value && !stockNoticeForm.locationId) {
    ElMessage.warning('请选择转入库位');
    return;
  }
  if (showStockMergeConfirm.value && !stockNoticeForm.mergeConfirmed) {
    ElMessage.warning('请确认取消/变更来源库存是否允许与现有库存合并展示');
    return;
  }

  stockNoticeSaving.value = true;
  try {
    await erpApi.acknowledgeWarehouseNotice(notice.id, {
      acknowledgedBy: stockNoticeForm.acknowledgedBy.trim(),
      handlingMode: showCustomerChangeHandlingFields.value ? stockNoticeForm.handlingMode : undefined,
      handlingQuantity: showCustomerChangeHandlingFields.value ? stockNoticeForm.handlingQuantity : undefined,
      warehouseId: stockNoticeNeedsWarehouse.value ? stockNoticeForm.warehouseId : undefined,
      locationId: stockNoticeForm.locationId || undefined,
      mergeConfirmed: showStockMergeConfirm.value ? stockNoticeForm.mergeConfirmed : undefined,
      remark: stockNoticeForm.remark.trim() || undefined
    });
    ElMessage.success(activeStockNoticeIsWithdraw.value || stockNoticeForm.handlingMode === 'STOCK' ? '物料已转入备货库存' : '仓库处理结果已记录');
    stockNoticeVisible.value = false;
    await queryWarehouseWork();
    await loadWarehouseNotices();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '仓库通知处理失败');
  } finally {
    stockNoticeSaving.value = false;
  }
}

function openConfirm(row: WarehouseReceipt) {
  activeReceipt.value = row;
  receiptForm.warehouseId = warehouses.value[0]?.id || '';
  receiptForm.remark = '';
  resetLocation();
  confirmVisible.value = true;
}

function openShipmentConfirm(row: WarehouseShipment) {
  activeShipment.value = row;
  shipmentForm.remark = '';
  shipmentVisible.value = true;
}

async function openShipmentSourceDetails(row: WarehouseShipment) {
  if (!row.partCode?.trim()) {
    ElMessage.warning('该库存缺少零件编码，无法查询来源');
    return;
  }

  shipmentSourceDetailsVisible.value = true;
  shipmentSourceDetailsLoading.value = true;
  shipmentSourceDetails.value = null;
  shipmentSourceFocusBatchId.value = row.id;
  shipmentSourceFocusBatchNo.value = row.batchNo;
  try {
    shipmentSourceDetails.value = await erpApi.inventoryMaterialSourceDetails(row.partCode.trim(), {
      unit: row.unit,
      warehouseId: row.warehouseId,
      sourceType: 'ALL'
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '库存来源查询失败');
  } finally {
    shipmentSourceDetailsLoading.value = false;
  }
}

function handleShipmentSelectionChange(rows: WarehouseShipment[]) {
  selectedShipments.value = rows;
}

async function selectShipmentOrder(row: WarehouseShipment) {
  const orderNo = row.orderNo;
  if (!orderNo) {
    ElMessage.warning('该库存没有来源订单，不能按订单批量发货');
    return;
  }
  shipmentTableRef.value?.clearSelection();
  await nextTick();
  shipments.value
    .filter((item) => item.orderNo === orderNo)
    .forEach((item) => shipmentTableRef.value?.toggleRowSelection(item, true));
}

function openOrderShipmentConfirm(row: WarehouseShipment) {
  if (!row.orderNo) {
    ElMessage.warning('该库存没有来源订单，不能按订单批量发货');
    return;
  }
  batchShipmentRows.value = shipments.value
    .filter((item) => item.orderNo === row.orderNo)
    .sort((a, b) => `${a.partCode}-${a.batchNo}`.localeCompare(`${b.partCode}-${b.batchNo}`));
  batchShipmentForm.remark = '';
  batchShipmentIsOrderMode.value = true;
  batchShipmentVisible.value = true;
}

function openBatchShipmentConfirmFromSelection() {
  openBatchShipmentConfirm(selectedShipments.value);
}

function openBatchShipmentConfirm(rows: WarehouseShipment[]) {
  if (rows.length === 0) {
    ElMessage.warning('请先选择待发货库存');
    return;
  }
  const orderNos = Array.from(new Set(rows.map((item) => item.orderNo).filter(Boolean)));
  if (orderNos.length !== 1 || rows.some((item) => !item.orderNo)) {
    ElMessage.warning('批量发货只能选择同一个订单的库存');
    return;
  }

  batchShipmentRows.value = [...rows].sort((a, b) => `${a.partCode}-${a.batchNo}`.localeCompare(`${b.partCode}-${b.batchNo}`));
  batchShipmentForm.remark = '';
  batchShipmentIsOrderMode.value = false;
  batchShipmentVisible.value = true;
}

function resetLocation() {
  receiptForm.locationId = currentLocations.value[0]?.id || '';
}

function resetReceiptDialog() {
  activeReceipt.value = undefined;
  receiptForm.warehouseId = '';
  receiptForm.locationId = '';
  receiptForm.remark = '';
}

function resetShipmentDialog() {
  activeShipment.value = undefined;
  shipmentForm.remark = '';
}

function resetBatchShipmentDialog() {
  if (!batchShipmentVisible.value) {
    batchShipmentIsOrderMode.value = false;
    batchShipmentRows.value = [];
    batchShipmentForm.remark = '';
  }
}

function taskRelationText(
  row: Pick<
    WarehouseReceipt | WarehouseShipment,
    'isReplenishment' | 'sourceProductionTaskNo' | 'replenishmentSourceType' | 'replenishmentSourceRequestNo' | 'replenishmentSourceLabel'
  >
) {
  if (row.replenishmentSourceLabel) {
    return row.sourceProductionTaskNo ? `${row.replenishmentSourceLabel} / 源任务 ${row.sourceProductionTaskNo}` : row.replenishmentSourceLabel;
  }
  if (row.replenishmentSourceType) {
    const label = row.replenishmentSourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单';
    return row.replenishmentSourceRequestNo ? `${label}：${row.replenishmentSourceRequestNo}` : label;
  }
  if (row.isReplenishment && row.sourceProductionTaskNo) {
    return `补单来源：${row.sourceProductionTaskNo}`;
  }
  if (row.isReplenishment) {
    return '补单任务';
  }
  return '';
}

function drawingTitle(row: Pick<WarehouseReceipt | WarehouseShipment, 'drawingNo' | 'drawingVersion'>) {
  const drawingNo = row.drawingNo || '未填写图号';
  const version = row.drawingVersion ? ` / ${row.drawingVersion}` : '';
  return `${drawingNo}${version}`;
}

function partSpecText(row: Pick<WarehouseReceipt | WarehouseShipment, 'partSpecification' | 'partThickness'>) {
  const specification = row.partSpecification || '-';
  const thickness = row.partThickness ? `${row.partThickness} mm` : '-';
  return `${specification} / ${thickness}`;
}

function transactionSourceOrderNo(row: WarehouseTransaction) {
  return row.sourceOrderNo || row.orderNo || '';
}

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function openWarehouseDialog() {
  warehouseForm.warehouseCode = '';
  warehouseForm.warehouseName = '';
  warehouseVisible.value = true;
}

function openLocationDialog() {
  locationForm.warehouseId = warehouses.value[0]?.id || '';
  locationForm.locationCode = '';
  locationForm.locationName = '';
  locationVisible.value = true;
}

async function saveWarehouse() {
  if (!warehouseForm.warehouseName.trim()) {
    ElMessage.warning('请填写仓库名称');
    return;
  }

  saving.value = true;
  try {
    await erpApi.createWarehouse({
      warehouseCode: warehouseForm.warehouseCode || undefined,
      warehouseName: warehouseForm.warehouseName
    });
    ElMessage.success('仓库已新增');
    warehouseVisible.value = false;
    await queryWarehouseWork();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '仓库新增失败');
  } finally {
    saving.value = false;
  }
}

async function saveLocation() {
  if (!locationForm.warehouseId || !locationForm.locationCode.trim()) {
    ElMessage.warning('请选择仓库并填写库位编码');
    return;
  }

  saving.value = true;
  try {
    await erpApi.createWarehouseLocation(locationForm.warehouseId, {
      locationCode: locationForm.locationCode,
      locationName: locationForm.locationName || undefined
    });
    ElMessage.success('库位已新增');
    locationVisible.value = false;
    await queryWarehouseWork();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '库位新增失败');
  } finally {
    saving.value = false;
  }
}

async function confirmReceipt() {
  if (!activeReceipt.value) {
    return;
  }
  if (!receiptForm.warehouseId) {
    ElMessage.warning('请选择仓库');
    return;
  }
  if (!receiptForm.locationId) {
    ElMessage.warning('请选择库位');
    return;
  }
  saving.value = true;
  try {
    await erpApi.confirmReceipt(
      activeReceipt.value.id,
      receiptForm.warehouseId,
      receiptForm.locationId,
      receiptForm.remark || undefined
    );
    ElMessage.success('入库已确认');
    confirmVisible.value = false;
    await queryWarehouseWork();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '入库确认失败');
  } finally {
    saving.value = false;
  }
}

async function confirmShipment() {
  if (!activeShipment.value) {
    return;
  }
  saving.value = true;
  try {
    await erpApi.confirmShipment(activeShipment.value.id, shipmentForm.remark || undefined);
    ElMessage.success('发货已确认，库存已出库');
    shipmentVisible.value = false;
    await queryWarehouseWork();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '发货确认失败');
  } finally {
    saving.value = false;
  }
}

async function confirmBatchShipment() {
  if (batchShipmentRows.value.length === 0) {
    return;
  }
  saving.value = true;
  try {
    if (batchShipmentIsOrderMode.value) {
      const orderNo = batchShipmentOrderNo.value;
      if (!orderNo) {
        ElMessage.warning('没有可发货的订单号');
        return;
      }
      await erpApi.confirmOrderShipment(orderNo, batchShipmentForm.remark || undefined);
      ElMessage.success('整单发货已确认，订单状态已重新计算');
    } else {
      await erpApi.confirmBatchShipment(
        batchShipmentRows.value.map((item) => item.id),
        batchShipmentForm.remark || undefined
      );
      ElMessage.success('批量发货已确认，订单状态已重新计算');
    }
    batchShipmentVisible.value = false;
    batchShipmentIsOrderMode.value = false;
    batchShipmentRows.value = [];
    selectedShipments.value = [];
    shipmentTableRef.value?.clearSelection();
    await queryWarehouseWork();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '批量发货失败');
  } finally {
    saving.value = false;
  }
}

function formatShipmentTotal(rows: WarehouseShipment[]) {
  const quantityByUnit = new Map<string, number>();
  rows.forEach((row) => {
    quantityByUnit.set(row.unit, (quantityByUnit.get(row.unit) || 0) + Number(row.quantity || 0));
  });
  return Array.from(quantityByUnit.entries())
    .map(([unit, quantity]) => formatQuantity(quantity, unit))
    .join(' / ');
}

watch(
  () => route.query.orderNo,
  async () => {
    filters.orderNo = routeOrderNo().trim() || undefined;
    await queryWarehouseWork();
  }
);

onMounted(async () => {
  applyRouteOrderFilter();
  await queryWarehouseWork();
});
</script>

<style scoped>
.warehouse-filter {
  align-items: flex-end;
}

.notice-badge {
  margin-right: 4px;
}

.panel-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.notice-list {
  display: grid;
  gap: 10px;
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

.notice-stock-panel {
  display: grid;
  gap: 12px;
}

.notice-summary-card {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: #f8fbff;
}

.notice-summary-card strong {
  color: #0f172a;
  line-height: 22px;
}

.notice-summary-card p {
  margin: 0;
  color: #334155;
  line-height: 22px;
}

.notice-summary-card span {
  color: #64748b;
  font-size: 13px;
}

.notice-plan-card {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
}

.notice-plan-card strong {
  color: #78350f;
}

.notice-plan-card small {
  color: #9a6a12;
  line-height: 18px;
}

.stock-extra {
  color: #d97706;
  font-weight: 600;
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

.inventory-balance-cell {
  display: grid;
  gap: 2px;
  line-height: 20px;
}

.batch-shipment-table {
  width: 100%;
}

.shipment-order-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.shipment-order-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: #ffffff;
}

.shipment-order-card > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.shipment-order-card strong,
.shipment-order-card span,
.shipment-order-card small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shipment-order-card strong {
  color: #0f172a;
}

.shipment-order-card span,
.shipment-order-card small {
  color: #64748b;
  font-size: 12px;
}

.mobile-shipment-order-groups {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.shipment-mobile-order-card {
  border-color: #bfdbfe;
  background: #f8fbff;
}

@media (max-width: 900px) {
  .panel-actions {
    align-items: stretch;
    flex-direction: column;
    width: 100%;
  }

  .panel-actions .el-button {
    width: 100%;
  }

  .shipment-order-card {
    align-items: stretch;
    flex-direction: column;
  }

  .shipment-order-card .el-button {
    width: 100%;
  }

  .mobile-card-header :deep(.el-segmented) {
    width: 100%;
  }
}
</style>
