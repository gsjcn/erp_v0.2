<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">仓库操作</h2>
      <div class="page-actions">
        <el-badge :value="pendingNoticeCount" :hidden="pendingNoticeCount === 0" class="notice-badge">
          <el-button :icon="Bell" @click="openWarehouseNotices">通知</el-button>
        </el-badge>
        <el-button v-if="!isMobileLayout" @click="openWarehouseDialog">新增仓库</el-button>
        <el-button v-if="!isMobileLayout" @click="openLocationDialog">新增库位</el-button>
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
            <div class="cell-subtext">{{ partThicknessText(row) }}</div>
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
      <article
        v-for="receipt in receipts"
        :key="receipt.id"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileWarehouseCardExpanded(receiptCardKey(receipt)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ receipt.partName }}</strong>
            <small>{{ receipt.productionTaskNo }}</small>
            <small v-if="taskRelationText(receipt)">{{ taskRelationText(receipt) }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <StatusTag :value="receipt.status" compact />
            <el-button link type="primary" @click.stop="toggleMobileWarehouseCard(receiptCardKey(receipt))">
              {{ isMobileWarehouseCardExpanded(receiptCardKey(receipt)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>{{ receipt.customerName }}</span>
          <span>订单 {{ formatQuantity(receipt.customerOrderQuantity || receipt.quantity, receipt.unit) }}</span>
          <span>入库 {{ formatQuantity(receipt.orderReceiptQuantity ?? receipt.quantity, receipt.unit) }}</span>
        </div>
        <div v-show="isMobileWarehouseCardExpanded(receiptCardKey(receipt))" class="mobile-card-fields">
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
            <span>{{ partSpecText(receipt) }}</span>
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
          <span class="mobile-readonly-note">手机端只查看待入库信息</span>
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
          <el-button
            size="small"
            type="primary"
            :disabled="selectedShipments.length === 0 || Boolean(selectedShipmentLockedText)"
            :title="selectedShipmentLockedText"
            @click="openBatchShipmentConfirmFromSelection"
          >
            批量确认发货
          </el-button>
        </div>
      </div>
      <div v-if="shipmentOrderGroups.length" class="shipment-order-groups">
        <article v-for="group in shipmentOrderGroups" :key="group.orderNo" class="shipment-order-card">
          <div>
            <strong><OrderNoLink :order-no="group.orderNo" /></strong>
            <span>{{ group.customerName || '-' }}</span>
            <small>{{ group.partCount }} 种零件 / {{ group.batchCount }} 批 / 可发 {{ group.totalText }}</small>
            <small>已发 {{ group.shippedText }} / 未发 {{ group.remainingText }} / 本次建议 {{ group.suggestedText }}</small>
            <small v-if="group.shortageText" class="shipment-shortage-warning">{{ group.shortageText }}</small>
          </div>
          <el-button
            size="small"
            type="primary"
            plain
            :disabled="!canShipWarehouseShipment(group.rows[0])"
            :title="shipmentLockedText(group.rows[0])"
            @click="openOrderShipmentConfirm(group.rows[0])"
          >
            订单发货
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
        <el-table-column type="selection" width="46" :selectable="shipmentRowSelectable" />
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
            <div class="cell-subtext">{{ partThicknessText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="100">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="已发货" width="110">
          <template #default="{ row }">{{ formatQuantity(row.shippedQuantity || 0, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="未发货" width="110">
          <template #default="{ row }">{{ formatQuantity(row.remainingQuantity || 0, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="本次建议" width="110">
          <template #default="{ row }">{{ formatQuantity(row.suggestedShipmentQuantity || 0, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="160">
          <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="selectShipmentOrder(row)">选中订单</el-button>
            <el-button link type="primary" :disabled="!canShipWarehouseShipment(row)" :title="shipmentLockedText(row)" @click="openOrderShipmentConfirm(row)">订单发货</el-button>
            <el-button link type="primary" @click="openShipmentSourceDetails(row)">库存来源/图纸</el-button>
            <el-button
              link
              type="primary"
              :disabled="!canShipWarehouseShipment(row) || Boolean(shipmentShortageText(row))"
              :title="shipmentLockedText(row) || shipmentShortageText(row)"
              @click="openShipmentConfirm(row)"
            >
              确认发货
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-section">
      <h3 class="mobile-section-title">待发货库存</h3>
      <div v-if="shipmentOrderGroups.length" class="mobile-shipment-order-groups">
        <article
          v-for="group in shipmentOrderGroups"
          :key="group.orderNo"
          class="mobile-card mobile-order-card shipment-mobile-order-card"
          :class="{ expanded: isMobileWarehouseCardExpanded(shipmentOrderCardKey(group.orderNo)) }"
        >
          <div class="mobile-card-header">
            <div class="mobile-card-title">
              <strong><OrderNoLink :order-no="group.orderNo" /></strong>
              <small>{{ group.customerName || '-' }}</small>
            </div>
            <div class="mobile-card-header-actions">
              <el-button link type="primary" @click.stop="toggleMobileWarehouseCard(shipmentOrderCardKey(group.orderNo))">
                {{ isMobileWarehouseCardExpanded(shipmentOrderCardKey(group.orderNo)) ? '收起' : '详情' }}
              </el-button>
            </div>
          </div>
          <div class="mobile-card-compact-summary">
            <span>{{ group.partCount }} 种 / {{ group.batchCount }} 批</span>
            <span>未发 {{ group.remainingText }}</span>
            <span>建议 {{ group.suggestedText }}</span>
          </div>
          <div v-show="isMobileWarehouseCardExpanded(shipmentOrderCardKey(group.orderNo))" class="mobile-card-fields">
            <div class="mobile-field">
              <label>零件 / 批次</label>
              <span>{{ group.partCount }} 种 / {{ group.batchCount }} 批</span>
            </div>
            <div class="mobile-field">
              <label>可发数量</label>
              <span>{{ group.totalText }}</span>
            </div>
            <div class="mobile-field">
              <label>已发货</label>
              <span>{{ group.shippedText }}</span>
            </div>
            <div class="mobile-field">
              <label>未发货</label>
              <span>{{ group.remainingText }}</span>
            </div>
            <div class="mobile-field">
              <label>本次建议</label>
              <span>{{ group.suggestedText }}</span>
            </div>
          </div>
          <div class="mobile-card-actions">
            <span class="mobile-readonly-note">手机端只查看待发货汇总</span>
          </div>
        </article>
      </div>
      <article
        v-for="shipment in shipments"
        :key="shipment.id"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileWarehouseCardExpanded(shipmentCardKey(shipment)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ shipment.partName }}</strong>
            <small>{{ shipment.batchNo }}</small>
            <small v-if="taskRelationText(shipment)">{{ taskRelationText(shipment) }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <StatusTag :value="shipment.status" compact />
            <el-button link type="primary" @click.stop="toggleMobileWarehouseCard(shipmentCardKey(shipment))">
              {{ isMobileWarehouseCardExpanded(shipmentCardKey(shipment)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>{{ shipment.customerName || '-' }}</span>
          <span>未发 {{ formatQuantity(shipment.remainingQuantity || 0, shipment.unit) }}</span>
          <span>建议 {{ formatQuantity(shipment.suggestedShipmentQuantity || 0, shipment.unit) }}</span>
        </div>
        <div v-show="isMobileWarehouseCardExpanded(shipmentCardKey(shipment))" class="mobile-card-fields">
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
            <label>已发货</label>
            <span>{{ formatQuantity(shipment.shippedQuantity || 0, shipment.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>未发货</label>
            <span>{{ formatQuantity(shipment.remainingQuantity || 0, shipment.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>本次建议</label>
            <span>{{ formatQuantity(shipment.suggestedShipmentQuantity || 0, shipment.unit) }}</span>
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
          <el-button link type="primary" @click="openShipmentSourceDetails(shipment)">库存来源/图纸</el-button>
          <span class="mobile-readonly-note">手机端只查看发货信息</span>
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
      <article
        v-for="row in warehouseRows"
        :key="warehouseLocationCardKey(row)"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileWarehouseCardExpanded(warehouseLocationCardKey(row)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.warehouseName }}</strong>
            <small>{{ row.warehouseCode }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <el-button link type="primary" @click.stop="toggleMobileWarehouseCard(warehouseLocationCardKey(row))">
              {{ isMobileWarehouseCardExpanded(warehouseLocationCardKey(row)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>{{ row.locationCode }}</span>
          <span>{{ row.locationName }}</span>
          <span><StatusTag :value="row.status" compact /></span>
        </div>
        <div v-show="isMobileWarehouseCardExpanded(warehouseLocationCardKey(row))" class="mobile-card-fields">
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
            <small v-if="taskRelationText(row)" class="muted">{{ taskRelationText(row) }}</small>
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
      <article
        v-for="transaction in transactions"
        :key="transaction.id"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileWarehouseCardExpanded(transactionCardKey(transaction)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ transaction.partName }}</strong>
            <small>{{ transaction.transactionNo }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <el-button link type="primary" @click.stop="toggleMobileWarehouseCard(transactionCardKey(transaction))">
              {{ isMobileWarehouseCardExpanded(transactionCardKey(transaction)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>{{ transaction.transactionType === 'IN' ? '入库' : '出库' }}</span>
          <span>{{ formatQuantity(transaction.quantity, transaction.unit) }}</span>
          <span>{{ transaction.batchNo || '-' }}</span>
        </div>
        <div v-show="isMobileWarehouseCardExpanded(transactionCardKey(transaction))" class="mobile-card-fields">
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
              <small v-if="taskRelationText(transaction)" class="muted">{{ taskRelationText(transaction) }}</small>
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
      class="responsive-dialog"
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
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
              ? partSpecText(activeReceipt)
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
      class="responsive-dialog"
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
      :before-close="handleSavingDialogBeforeClose"
      @closed="resetShipmentDialog"
    >
      <div v-if="activeShipmentShortageText" class="shipment-shortage-block mb-16">
        <div>
          <strong>该订单仍有待补单短缺，暂不能单批发货</strong>
          <p>{{ activeShipmentShortageText }}</p>
        </div>
        <el-button type="warning" plain @click="goActiveShipmentShortageDetail">处理补单</el-button>
      </div>
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
        <el-form-item label="已发货">
          {{ activeShipment ? formatQuantity(activeShipment.shippedQuantity || 0, activeShipment.unit) : '-' }}
        </el-form-item>
        <el-form-item label="未发货">
          {{ activeShipment ? formatQuantity(activeShipment.remainingQuantity || 0, activeShipment.unit) : '-' }}
        </el-form-item>
        <el-form-item label="本次发货" required>
          <el-input-number
            v-model="shipmentForm.shipmentQuantity"
            :min="0"
            :max="activeShipment?.quantity || 0"
            :precision="3"
            :step="1"
            style="width: 220px"
          />
          <span class="unit-text">{{ activeShipment?.unit || '件' }}</span>
          <small v-if="activeShipmentQuantityAdjustmentText" class="shipment-adjustment-note">
            {{ activeShipmentQuantityAdjustmentText }}
          </small>
        </el-form-item>
        <el-form-item label="仓库确认" required>
          <el-input v-model="shipmentForm.warehouseConfirmedBy" maxlength="30" placeholder="填写仓库管理确认人" />
        </el-form-item>
        <el-alert
          v-if="activeShipmentOverQuantity > 0"
          class="mb-16"
          type="warning"
          :closable="false"
          :title="`本次超出未发货数量 ${formatQuantity(activeShipmentOverQuantity, activeShipment?.unit || '件')}，需要销售确认和说明。`"
        />
        <el-form-item v-if="activeShipmentOverQuantity > 0" label="销售确认" required>
          <el-input v-model="shipmentForm.salesConfirmedBy" maxlength="30" placeholder="填写销售确认人" />
        </el-form-item>
        <el-form-item v-if="activeShipmentOverQuantity > 0" label="超发说明" required>
          <el-input
            v-model="shipmentForm.overShipmentReason"
            type="textarea"
            :rows="2"
            maxlength="160"
            show-word-limit
            placeholder="例如：客户临时要求多发，已由销售确认。"
          />
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
        <el-button type="primary" :loading="saving" :disabled="Boolean(activeShipmentShortageText)" @click="confirmShipment">确认发货</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="batchShipmentVisible"
      :title="batchShipmentIsOrderMode ? '订单发货确认' : '批量确认发货'"
      width="min(760px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
      :before-close="handleSavingDialogBeforeClose"
      @closed="resetBatchShipmentDialog"
    >
      <el-alert
        :title="batchShipmentAlertTitle"
        type="warning"
        :closable="false"
        class="mb-16"
      />
      <div v-if="batchShipmentShortageText" class="shipment-shortage-block mb-16">
        <div>
          <strong>该订单仍有待补单短缺，暂不能整单或批量发货</strong>
          <p>{{ batchShipmentShortageText }}</p>
        </div>
        <el-button type="warning" plain @click="goBatchShipmentShortageDetail">处理补单</el-button>
      </div>
      <el-form label-width="92px">
        <el-form-item label="订单号">
          <OrderNoLink v-if="batchShipmentOrderNo" :order-no="batchShipmentOrderNo" />
          <span v-else>-</span>
        </el-form-item>
        <el-form-item label="客户">
          <strong>{{ batchShipmentCustomerName || '-' }}</strong>
        </el-form-item>
        <el-form-item label="仓库确认" required>
          <el-input v-model="batchShipmentForm.warehouseConfirmedBy" maxlength="30" placeholder="填写仓库管理确认人" />
        </el-form-item>
        <el-form-item label="销售确认">
          <el-input v-model="batchShipmentForm.salesConfirmedBy" maxlength="30" placeholder="如存在超发，请填写销售确认人" />
        </el-form-item>
        <el-form-item label="超发说明">
          <el-input
            v-model="batchShipmentForm.overShipmentReason"
            type="textarea"
            :rows="2"
            maxlength="160"
            show-word-limit
            placeholder="如存在超发，必须填写原因"
          />
        </el-form-item>
        <el-form-item :label="batchShipmentIsOrderMode ? '当前可见' : '选中批次'">
          <span>
            {{ batchShipmentRows.length }} 批 / 可发 {{ batchShipmentTotalText }}
            <span class="muted">，可按客户分批发货要求修改每批本次数量</span>
          </span>
        </el-form-item>
        <el-form-item label="发货汇总">
          <span>
            已发 {{ formatShipmentLineTotal(batchShipmentRows, 'shippedQuantity') }} /
            未发 {{ formatShipmentLineTotal(batchShipmentRows, 'remainingQuantity') }} /
            本次建议 {{ formatShipmentTotal(batchShipmentRows, 'suggestedShipmentQuantity') }} /
            本次发货 {{ batchShipmentCurrentText || '0 件' }}
          </span>
        </el-form-item>
        <el-alert
          v-if="batchShipmentOverText"
          class="mb-12"
          type="warning"
          :closable="false"
          :title="`本次发货超过订单未发货数量 ${batchShipmentOverText}，必须填写销售确认人和超发说明。`"
        />
        <el-alert
          v-if="batchShipmentHasStockOverRows && !batchShipmentOverText"
          class="mb-12"
          type="warning"
          :closable="false"
          title="本次发货已加入备货库存作为客户额外发货来源，必须填写销售确认人和超发说明。"
        />
        <el-table :data="batchShipmentRows" max-height="260px" class="batch-shipment-table">
          <el-table-column label="库存批次" min-width="190">
            <template #default="{ row }">
              <div class="cell-main">{{ row.batchNo }}</div>
              <el-tag v-if="row.isStockOverShipment" size="small" type="warning">备货超发</el-tag>
            </template>
          </el-table-column>
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
          <el-table-column label="已发货" width="110">
            <template #default="{ row }">{{ formatQuantity(row.shippedQuantity || 0, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="未发货" width="110">
            <template #default="{ row }">{{ formatQuantity(row.remainingQuantity || 0, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="本次建议" width="110">
            <template #default="{ row }">{{ formatQuantity(row.suggestedShipmentQuantity || 0, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="本次发货" width="170">
            <template #default="{ row }">
              <el-input-number
                v-model="row.currentShipmentQuantity"
                :min="0"
                :max="row.quantity"
                :precision="3"
                :step="1"
                controls-position="right"
                class="shipment-quantity-input"
              />
              <small v-if="shipmentQuantityAdjustmentText(row)" class="shipment-adjustment-note">
                {{ shipmentQuantityAdjustmentText(row) }}
              </small>
            </template>
          </el-table-column>
          <el-table-column label="仓库 / 库位" min-width="160">
            <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
          </el-table-column>
          <el-table-column label="库存来源/图纸" width="120">
            <template #default="{ row }">
              <el-button link type="primary" @click="openShipmentSourceDetails(row)">查看</el-button>
            </template>
          </el-table-column>
          <el-table-column v-if="batchShipmentIsOrderMode" label="备货超发" width="120" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="!row.isStockOverShipment"
                link
                type="primary"
                :loading="stockSourceLoading"
                @click="appendStockOverShipment(row)"
              >
                添加备货
              </el-button>
              <el-button v-else link type="danger" @click="removeStockOverShipment(row)">移除</el-button>
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
        <el-button
          type="primary"
          :loading="saving"
          :disabled="Boolean(batchShipmentLockedText) || Boolean(batchShipmentShortageText)"
          :title="batchShipmentLockedText || batchShipmentShortageText"
          @click="confirmBatchShipment"
        >
          {{ batchShipmentIsOrderMode ? '确认本次发货' : '确认批量发货' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="warehouseVisible"
      title="新增仓库"
      width="min(420px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
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
      class="responsive-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
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

    <el-dialog v-model="noticeVisible" title="仓库通知" width="min(760px, calc(100vw - 32px))" class="responsive-dialog">
      <div v-loading="noticeLoading" class="notice-list">
        <div v-if="warehouseNotices.length === 0" class="muted">暂无仓库通知</div>
        <article v-for="notice in warehouseNotices" :key="notice.id" class="notice-item">
          <div>
            <strong>{{ warehouseNoticeTitle(notice) }}</strong>
            <p>{{ notice.reason }}</p>
            <small>通知时间：{{ formatDateTime(notice.createdAt) }}</small>
            <small v-if="notice.status === 'ACKNOWLEDGED'" class="notice-ack-text">
              确认：{{ notice.acknowledgedBy || '-' }} / {{ formatDateTime(notice.acknowledgedAt) }}
            </small>
          </div>
          <el-button
            v-if="notice.status === 'PENDING' && !isMobileLayout"
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
      class="responsive-dialog"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="!stockNoticeSaving"
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
          <el-form-item label="确认时间">
            <el-input :model-value="stockNoticeConfirmTimeText" disabled />
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
import { useRoute, useRouter } from 'vue-router';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import InventorySourceDetailsDialog from '../components/InventorySourceDetailsDialog.vue';
import NoticeAcknowledgeDialog from '../components/NoticeAcknowledgeDialog.vue';
import OrderSelect from '../components/OrderSelect.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import DrawingPreviewLink from '../components/DrawingPreviewLink.vue';
import StatusTag from '../components/StatusTag.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import type {
  InventorySourceBatchDetail,
  InventorySourceDetailResponse,
  OrderSummary,
  ProductionNotice,
  Warehouse,
  WarehouseReceipt,
  WarehouseShipment,
  WarehouseTransaction
} from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';

type EditableWarehouseShipment = WarehouseShipment & {
  currentShipmentQuantity?: number;
  isStockOverShipment?: boolean;
  targetOrderLineId?: string;
};

const route = useRoute();
const router = useRouter();
const { isMobileLayout } = useDeviceProfile();
const orderOptions = ref<OrderSummary[]>([]);
const warehouses = ref<Warehouse[]>([]);
const receipts = ref<WarehouseReceipt[]>([]);
const shipments = ref<WarehouseShipment[]>([]);
const selectedShipments = ref<WarehouseShipment[]>([]);
const batchShipmentRows = ref<EditableWarehouseShipment[]>([]);
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
const stockSourceLoading = ref(false);
const stockSourceRequestSeq = ref(0);
const stockNoticeConfirmTime = ref('');
const saving = ref(false);
const noticeVisible = ref(false);
const confirmVisible = ref(false);
const shipmentVisible = ref(false);
const shipmentSourceDetailsVisible = ref(false);
const shipmentSourceDetailsLoading = ref(false);
const shipmentSourceDetailsRequestSeq = ref(0);
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
const expandedMobileWarehouseCardKeys = ref<string[]>([]);

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
  shipmentQuantity: 0,
  warehouseConfirmedBy: '',
  salesConfirmedBy: '',
  overShipmentReason: '',
  remark: ''
});
const batchShipmentForm = reactive({
  warehouseConfirmedBy: '',
  salesConfirmedBy: '',
  overShipmentReason: '',
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
  shippedText: string;
  remainingText: string;
  suggestedText: string;
  shortageText?: string;
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
const stockNoticeDialogTitle = computed(() => (activeStockNoticeIsWithdraw.value ? '撤回零件转库存确认' : '客户变更零件处理'));
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
const stockNoticeConfirmTimeText = computed(() => stockNoticeConfirmTime.value || formatDateTime(new Date()));
const selectedShipmentOrderNo = computed(() => {
  const orderNos = Array.from(new Set(selectedShipments.value.map((item) => item.orderNo).filter(Boolean)));
  return orderNos.length === 1 ? orderNos[0] : '';
});
const activeShipmentOverQuantity = computed(() => {
  if (!activeShipment.value) {
    return 0;
  }
  return Math.max(Number(shipmentForm.shipmentQuantity || 0) - Number(activeShipment.value.remainingQuantity || 0), 0);
});
const activeShipmentQuantityAdjustmentText = computed(() =>
  activeShipment.value
    ? shipmentQuantityAdjustmentText({
        ...activeShipment.value,
        currentShipmentQuantity: shipmentForm.shipmentQuantity
      })
    : ''
);
const batchShipmentOrderNo = computed(() => {
  const orderNos = Array.from(new Set(batchShipmentRows.value.map((item) => item.orderNo).filter(Boolean)));
  return orderNos.length === 1 ? orderNos[0] : '';
});
const batchShipmentCustomerName = computed(() => batchShipmentRows.value[0]?.customerName || '');
const batchShipmentTotalText = computed(() => formatShipmentTotal(batchShipmentRows.value));
const batchShipmentCurrentText = computed(() => formatShipmentTotal(batchShipmentRows.value, 'currentShipmentQuantity'));
const batchShipmentOverText = computed(() => formatBatchShipmentOverText(batchShipmentRows.value));
const batchShipmentHasStockOverRows = computed(() =>
  batchShipmentRows.value.some((row) => row.isStockOverShipment && Number(row.currentShipmentQuantity || 0) > 0)
);
const batchShipmentRequiresSalesConfirmation = computed(
  () => Boolean(batchShipmentOverText.value) || batchShipmentHasStockOverRows.value
);
const batchShipmentOrder = computed(() => orderOptions.value.find((order) => order.orderNo === batchShipmentOrderNo.value));
const batchShipmentShortageText = computed(() =>
  batchShipmentOrder.value && orderNeedsShortageAttention(batchShipmentOrder.value) ? orderShortageActionText(batchShipmentOrder.value) : ''
);
const selectedShipmentLockedText = computed(() => {
  const lockedRow = selectedShipments.value.find((row) => !canShipWarehouseShipment(row));
  return lockedRow ? shipmentLockedText(lockedRow) : '';
});
const batchShipmentLockedText = computed(() => {
  const lockedRow = batchShipmentRows.value.find((row) => !canShipWarehouseShipment(row));
  return lockedRow ? shipmentLockedText(lockedRow) : '';
});
const activeShipmentShortageText = computed(() => shipmentShortageText(activeShipment.value));
const batchShipmentAlertTitle = computed(() =>
  batchShipmentIsOrderMode.value
    ? '整单发货默认带出该订单当前可发批次的建议数量；仓库可按客户要求逐批改本次发货数量。'
    : '批量发货只允许选择同一订单的待发货库存；仓库可逐批填写本次发货数量。'
);
const batchShipmentRemarkPlaceholder = computed(() =>
  batchShipmentIsOrderMode.value ? '例如：按客户要求本次发货 500 件' : '例如：按订单批量发货'
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
        totalText: '',
        shippedText: '',
        remainingText: '',
        suggestedText: '',
        shortageText: ''
      };
    group.rows.push(row);
    group.partCount = new Set(group.rows.map((item) => item.partCode)).size;
    group.batchCount = group.rows.length;
    group.totalText = formatShipmentTotal(group.rows);
    group.shippedText = formatShipmentLineTotal(group.rows, 'shippedQuantity');
    group.remainingText = formatShipmentLineTotal(group.rows, 'remainingQuantity');
    group.suggestedText = formatShipmentTotal(group.rows, 'suggestedShipmentQuantity');
    const order = orderOptions.value.find((item) => item.orderNo === key);
    group.shortageText = order && orderNeedsShortageAttention(order) ? `部分发货，${orderShortageActionText(order)}` : '';
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

function receiptCardKey(receipt: WarehouseReceipt) {
  return `receipt:${receipt.id}`;
}

function shipmentOrderCardKey(orderNo: string) {
  return `shipment-order:${orderNo}`;
}

function shipmentCardKey(shipment: WarehouseShipment) {
  return `shipment:${shipment.id}`;
}

function warehouseLocationCardKey(row: { warehouseCode: string; locationCode: string }) {
  return `warehouse-location:${row.warehouseCode}:${row.locationCode}`;
}

function transactionCardKey(transaction: WarehouseTransaction) {
  return `transaction:${transaction.id}`;
}

function isMobileWarehouseCardExpanded(key: string) {
  return expandedMobileWarehouseCardKeys.value.includes(key);
}

function toggleMobileWarehouseCard(key: string) {
  expandedMobileWarehouseCardKeys.value = isMobileWarehouseCardExpanded(key)
    ? expandedMobileWarehouseCardKeys.value.filter((item) => item !== key)
    : [...expandedMobileWarehouseCardKeys.value, key];
}

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
    orderOptions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '订单选项加载失败，请确认后端服务和筛选条件');
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
    warehouses.value = [];
    receipts.value = [];
    shipments.value = [];
    selectedShipments.value = [];
    batchShipmentRows.value = [];
    transactions.value = [];
    warehouseNotices.value = [];
    expandedMobileWarehouseCardKeys.value = [];
    shipmentTableRef.value?.clearSelection();
    ElMessage.error(error instanceof Error ? error.message : '仓库数据加载失败，请确认后端服务和筛选条件');
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
    transactions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '库存流水加载失败，请确认后端服务和筛选条件');
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
    warehouseNotices.value = [];
    ElMessage.error(error instanceof Error ? error.message : '仓库通知加载失败，请确认后端服务');
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

function acknowledgeWarehouseNotice(notice: ProductionNotice) {
  if (guardDesktopWarehouseMutation('确认仓库通知')) {
    return;
  }
  activeWarehouseNotice.value = notice;
  if (requiresWithdrawStockReceipt(notice) || requiresCustomerChangeHandling(notice)) {
    const handlingPlan = notice.handlingPlan;
    stockNoticeForm.acknowledgedBy = '';
    stockNoticeConfirmTime.value = formatDateTime(new Date());
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
  if (guardDesktopWarehouseMutation('确认仓库通知')) {
    return;
  }
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
    ElMessage.warning('仓库业务正在保存，请等待保存完成');
    return;
  }
  done();
}

function handleStockNoticeBeforeClose(done: () => void) {
  if (stockNoticeSaving.value) {
    ElMessage.warning('仓库通知正在处理，请等待保存完成');
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
  if (guardDesktopWarehouseMutation('确认仓库通知')) {
    return;
  }
  if (stockNoticeSaving.value) {
    return;
  }
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
    ElMessage.success(activeStockNoticeIsWithdraw.value || stockNoticeForm.handlingMode === 'STOCK' ? '零件已转入备货库存' : '仓库处理结果已记录');
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
  if (guardDesktopWarehouseMutation('确认入库')) {
    return;
  }
  activeReceipt.value = row;
  receiptForm.warehouseId = warehouses.value[0]?.id || '';
  receiptForm.remark = '';
  resetLocation();
  confirmVisible.value = true;
}

function defaultShipmentQuantity(row: WarehouseShipment) {
  const suggestedQuantity = Number(row.suggestedShipmentQuantity || 0);
  if (suggestedQuantity > 0) {
    return suggestedQuantity;
  }
  if (row.remainingQuantity === undefined || row.remainingQuantity === null) {
    return Number(row.quantity || 0);
  }
  const remainingQuantity = Number(row.remainingQuantity || 0);
  return remainingQuantity > 0 ? Math.min(Number(row.quantity || 0), remainingQuantity) : 0;
}

function prepareBatchShipmentRows(rows: WarehouseShipment[]): EditableWarehouseShipment[] {
  return rows.map((row) => ({
    ...row,
    currentShipmentQuantity: defaultShipmentQuantity(row)
  }));
}

function toStockOverShipmentRow(source: InventorySourceBatchDetail, targetLine: EditableWarehouseShipment): EditableWarehouseShipment {
  return {
    id: source.id,
    batchNo: source.batchNo,
    orderLineId: targetLine.orderLineId,
    targetOrderLineId: targetLine.orderLineId,
    customerId: targetLine.customerId,
    orderNo: targetLine.orderNo,
    customerName: targetLine.customerName,
    orderDate: targetLine.orderDate,
    deliveryDate: targetLine.deliveryDate,
    partCode: source.partCode,
    partName: source.partName,
    quantity: Number(source.quantity || 0),
    customerOrderQuantity: targetLine.customerOrderQuantity,
    shippedQuantity: targetLine.shippedQuantity,
    remainingQuantity: targetLine.remainingQuantity,
    suggestedShipmentQuantity: 0,
    physicalQuantity: source.physicalQuantity,
    reservedQuantity: source.reservedQuantity,
    unit: source.unit,
    warehouseId: source.warehouseId,
    warehouseName: source.warehouseName || '-',
    locationId: source.locationId,
    locationName: source.locationName,
    inventorySourceType: source.inventorySourceType,
    sourceKind: source.sourceKind,
    productionSourceOrderNo: source.productionSourceOrderNo,
    productionSourceCustomerName: source.productionSourceCustomerName,
    productionDate: source.productionDate,
    drawingNo: source.drawingNo || targetLine.drawingNo,
    drawingVersion: source.drawingVersion || targetLine.drawingVersion,
    drawingFileName: source.drawingFileName || targetLine.drawingFileName,
    drawingFileUrl: source.drawingFileUrl || targetLine.drawingFileUrl,
    partThickness: source.partThickness ?? targetLine.partThickness,
    partSpecification: source.partSpecification || targetLine.partSpecification,
    status: source.status,
    currentShipmentQuantity: 0,
    isStockOverShipment: true
  };
}

async function appendStockOverShipment(row: EditableWarehouseShipment) {
  if (!batchShipmentIsOrderMode.value) {
    return;
  }
  if (stockSourceLoading.value) {
    ElMessage.info('备货库存正在查询，请等待当前查询完成');
    return;
  }
  if (!row.partCode?.trim()) {
    ElMessage.warning('该零件缺少零件编码，无法查询备货库存');
    return;
  }
  const requestId = ++stockSourceRequestSeq.value;
  const requestedPartCode = row.partCode.trim();
  const requestedOrderNo = batchShipmentOrderNo.value || row.orderNo;
  stockSourceLoading.value = true;
  try {
    const detail = await erpApi.inventoryMaterialSourceDetails(requestedPartCode, {
      unit: row.unit,
      sourceType: 'STOCK',
      customerId: row.customerId,
      excludeOrderNo: requestedOrderNo
    });
    if (requestId !== stockSourceRequestSeq.value || !batchShipmentIsOrderMode.value || !batchShipmentRows.value.includes(row)) {
      return;
    }
    // 备货超发只允许把最新查询到的可用备货批次追加到当前发货明细，避免慢请求把旧订单库存插入当前发货单。
    const existingIds = new Set(batchShipmentRows.value.map((item) => item.id));
    const source = detail.sources
      .filter((item) => item.inventorySourceType === 'STOCK' && Number(item.quantity || 0) > 0 && !existingIds.has(item.id))
      .sort(
        (a, b) =>
          Number(a.quantity || 0) - Number(b.quantity || 0) ||
          String(a.batchNo || '').localeCompare(String(b.batchNo || ''), 'zh-Hans-CN')
      )[0];
    if (!source) {
      ElMessage.warning('没有可用于该零件的备货库存，或备货库存已加入本次发货');
      return;
    }
    batchShipmentRows.value.push(toStockOverShipmentRow(source, row));
    ElMessage.success('已加入备货库存，请填写本次发货数量、销售确认人和超发说明');
  } catch (error) {
    if (requestId === stockSourceRequestSeq.value) {
      ElMessage.error(error instanceof Error ? error.message : '备货库存查询失败，请确认零件、客户和后端服务');
    }
  } finally {
    if (requestId === stockSourceRequestSeq.value) {
      stockSourceLoading.value = false;
    }
  }
}

function removeStockOverShipment(row: EditableWarehouseShipment) {
  batchShipmentRows.value = batchShipmentRows.value.filter((item) => item !== row);
}

function openShipmentConfirm(row: WarehouseShipment) {
  if (guardDesktopWarehouseMutation('确认发货')) {
    return;
  }
  const lockedText = shipmentLockedText(row);
  if (lockedText) {
    ElMessage.warning(lockedText);
    return;
  }
  activeShipment.value = row;
  shipmentForm.shipmentQuantity = defaultShipmentQuantity(row);
  shipmentForm.warehouseConfirmedBy = '';
  shipmentForm.salesConfirmedBy = '';
  shipmentForm.overShipmentReason = '';
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
  const requestId = ++shipmentSourceDetailsRequestSeq.value;
  try {
    const detail = await erpApi.inventoryMaterialSourceDetails(row.partCode.trim(), {
      unit: row.unit,
      warehouseId: row.warehouseId,
      sourceType: 'ALL',
      customerId: row.customerId
    });
    if (requestId === shipmentSourceDetailsRequestSeq.value) {
      shipmentSourceDetails.value = detail;
    }
  } catch (error) {
    if (requestId === shipmentSourceDetailsRequestSeq.value) {
      shipmentSourceDetails.value = null;
      ElMessage.error(error instanceof Error ? error.message : '库存来源查询失败，请确认零件和后端服务');
    }
  } finally {
    if (requestId === shipmentSourceDetailsRequestSeq.value) {
      shipmentSourceDetailsLoading.value = false;
    }
  }
}

function handleShipmentSelectionChange(rows: WarehouseShipment[]) {
  selectedShipments.value = rows.filter(canShipWarehouseShipment);
}

async function selectShipmentOrder(row: WarehouseShipment) {
  const orderNo = row.orderNo;
  if (!orderNo) {
    ElMessage.warning('该库存没有来源订单，不能按订单批量发货');
    return;
  }
  const lockedText = shipmentLockedText(row);
  if (lockedText) {
    ElMessage.warning(lockedText);
    return;
  }
  shipmentTableRef.value?.clearSelection();
  await nextTick();
  shipments.value
    .filter((item) => item.orderNo === orderNo && canShipWarehouseShipment(item))
    .forEach((item) => shipmentTableRef.value?.toggleRowSelection(item, true));
}

function openOrderShipmentConfirm(row: WarehouseShipment) {
  if (guardDesktopWarehouseMutation('订单发货')) {
    return;
  }
  if (!row.orderNo) {
    ElMessage.warning('该库存没有来源订单，不能按订单批量发货');
    return;
  }
  const lockedText = shipmentLockedText(row);
  if (lockedText) {
    ElMessage.warning(lockedText);
    return;
  }
  batchShipmentRows.value = prepareBatchShipmentRows(
    shipments.value
    .filter((item) => item.orderNo === row.orderNo && canShipWarehouseShipment(item))
    .sort((a, b) => `${a.partCode}-${a.batchNo}`.localeCompare(`${b.partCode}-${b.batchNo}`))
  );
  batchShipmentForm.remark = '';
  batchShipmentForm.warehouseConfirmedBy = '';
  batchShipmentForm.salesConfirmedBy = '';
  batchShipmentForm.overShipmentReason = '';
  batchShipmentIsOrderMode.value = true;
  batchShipmentVisible.value = true;
}

function openBatchShipmentConfirmFromSelection() {
  openBatchShipmentConfirm(selectedShipments.value);
}

function openBatchShipmentConfirm(rows: WarehouseShipment[]) {
  if (guardDesktopWarehouseMutation('批量确认发货')) {
    return;
  }
  if (rows.length === 0) {
    ElMessage.warning('请先选择待发货库存');
    return;
  }
  const lockedRow = rows.find((row) => !canShipWarehouseShipment(row));
  if (lockedRow) {
    ElMessage.warning(shipmentLockedText(lockedRow));
    return;
  }
  const orderNos = Array.from(new Set(rows.map((item) => item.orderNo).filter(Boolean)));
  if (orderNos.length !== 1 || rows.some((item) => !item.orderNo)) {
    ElMessage.warning('批量发货只能选择同一个订单的库存');
    return;
  }

  batchShipmentRows.value = prepareBatchShipmentRows(
    [...rows].sort((a, b) => `${a.partCode}-${a.batchNo}`.localeCompare(`${b.partCode}-${b.batchNo}`))
  );
  batchShipmentForm.remark = '';
  batchShipmentForm.warehouseConfirmedBy = '';
  batchShipmentForm.salesConfirmedBy = '';
  batchShipmentForm.overShipmentReason = '';
  batchShipmentIsOrderMode.value = false;
  batchShipmentVisible.value = true;
}

function goBatchShipmentShortageDetail() {
  const orderNo = batchShipmentOrderNo.value;
  if (!orderNo) {
    return;
  }
  batchShipmentVisible.value = false;
  router.push({
    path: `/orders/${encodeURIComponent(orderNo)}`,
    query: { shortage: '1', returnTo: route.fullPath }
  });
}

function goActiveShipmentShortageDetail() {
  const orderNo = activeShipment.value?.orderNo;
  if (!orderNo) {
    return;
  }
  shipmentVisible.value = false;
  router.push({
    path: `/orders/${encodeURIComponent(orderNo)}`,
    query: { shortage: '1', returnTo: route.fullPath }
  });
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
  shipmentForm.shipmentQuantity = 0;
  shipmentForm.warehouseConfirmedBy = '';
  shipmentForm.salesConfirmedBy = '';
  shipmentForm.overShipmentReason = '';
  shipmentForm.remark = '';
}

function resetBatchShipmentDialog() {
  if (!batchShipmentVisible.value) {
    batchShipmentIsOrderMode.value = false;
    batchShipmentRows.value = [];
    batchShipmentForm.warehouseConfirmedBy = '';
    batchShipmentForm.salesConfirmedBy = '';
    batchShipmentForm.overShipmentReason = '';
    batchShipmentForm.remark = '';
  }
}

function taskRelationText(
  row: {
    isReplenishment?: boolean;
    sourceProductionTaskNo?: string;
    replenishmentSourceType?: 'PRODUCTION_SCRAP' | 'ORDER_CHANGE' | string;
    replenishmentSourceRequestNo?: string;
    replenishmentSourceLabel?: string;
    lineType?: string;
    componentNo?: string;
    parentComponentNo?: string;
    importSequence?: string;
  }
) {
  const texts: string[] = [];
  if (row.replenishmentSourceLabel) {
    texts.push(row.sourceProductionTaskNo ? `${row.replenishmentSourceLabel} / 源任务 ${row.sourceProductionTaskNo}` : row.replenishmentSourceLabel);
  } else if (row.replenishmentSourceType) {
    const label = row.replenishmentSourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单';
    texts.push(row.replenishmentSourceRequestNo ? `${label}：${row.replenishmentSourceRequestNo}` : label);
  } else if (row.isReplenishment && row.sourceProductionTaskNo) {
    texts.push(`补单来源：${row.sourceProductionTaskNo}`);
  } else if (row.isReplenishment) {
    texts.push('补单任务');
  }
  const componentText = warehouseComponentText(row);
  if (componentText) {
    texts.push(componentText);
  }
  if (row.importSequence) {
    texts.push(`Excel 序号 ${row.importSequence}`);
  }
  return texts.join('；');
}

function warehouseComponentText(row: { lineType?: string; componentNo?: string; parentComponentNo?: string }) {
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

function drawingTitle(row: Pick<WarehouseReceipt | WarehouseShipment, 'drawingNo' | 'drawingVersion'>) {
  const drawingNo = row.drawingNo || '未填写图号';
  const version = row.drawingVersion ? ` / ${row.drawingVersion}` : '';
  return `${drawingNo}${version}`;
}

function partThicknessText(row: Pick<WarehouseReceipt | WarehouseShipment, 'lineType' | 'partThickness'>) {
  if (row.lineType === 'COMPONENT') {
    return '不适用（父级组件由子零件维护）';
  }
  return row.partThickness ? `${row.partThickness} mm` : '-';
}

function partSpecText(row: Pick<WarehouseReceipt | WarehouseShipment, 'lineType' | 'partSpecification' | 'partThickness'>) {
  const specification = row.partSpecification || '-';
  return `${specification} / ${partThicknessText(row)}`;
}

function transactionSourceOrderNo(row: WarehouseTransaction) {
  return row.sourceOrderNo || row.orderNo || '';
}

function formatDateTime(value?: Date | string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function guardDesktopWarehouseMutation(actionLabel: string) {
  if (!isMobileLayout.value) {
    return false;
  }
  ElMessage.warning(`手机端仅查看仓库、库存和通知，${actionLabel}请在电脑端操作`);
  return true;
}

function openWarehouseDialog() {
  if (guardDesktopWarehouseMutation('新增仓库')) {
    return;
  }
  warehouseForm.warehouseCode = '';
  warehouseForm.warehouseName = '';
  warehouseVisible.value = true;
}

function openLocationDialog() {
  if (guardDesktopWarehouseMutation('新增库位')) {
    return;
  }
  locationForm.warehouseId = warehouses.value[0]?.id || '';
  locationForm.locationCode = '';
  locationForm.locationName = '';
  locationVisible.value = true;
}

async function saveWarehouse() {
  if (guardDesktopWarehouseMutation('新增仓库')) {
    return;
  }
  if (saving.value) {
    return;
  }
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
  if (guardDesktopWarehouseMutation('新增库位')) {
    return;
  }
  if (saving.value) {
    return;
  }
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
  if (guardDesktopWarehouseMutation('确认入库')) {
    return;
  }
  if (saving.value) {
    return;
  }
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
  if (guardDesktopWarehouseMutation('确认发货')) {
    return;
  }
  if (saving.value) {
    return;
  }
  if (!activeShipment.value) {
    return;
  }
  const lockedText = shipmentLockedText(activeShipment.value);
  if (lockedText) {
    ElMessage.warning(lockedText);
    return;
  }
  if (activeShipmentShortageText.value) {
    ElMessage.warning('该订单仍有待补单短缺，请先处理补单、客户减量或无需补单说明');
    return;
  }
  if (shipmentForm.shipmentQuantity <= 0) {
    ElMessage.warning('请填写本次发货数量');
    return;
  }
  if (shipmentForm.shipmentQuantity > activeShipment.value.quantity) {
    ElMessage.warning('本次发货数量不能大于当前库存数量');
    return;
  }
  if (!shipmentForm.warehouseConfirmedBy.trim()) {
    ElMessage.warning('请填写仓库确认人');
    return;
  }
  if (activeShipmentOverQuantity.value > 0 && !shipmentForm.salesConfirmedBy.trim()) {
    ElMessage.warning('超出未发货数量时必须填写销售确认人');
    return;
  }
  if (activeShipmentOverQuantity.value > 0 && !shipmentForm.overShipmentReason.trim()) {
    ElMessage.warning('超出未发货数量时必须填写超发说明');
    return;
  }
  saving.value = true;
  try {
    await erpApi.confirmShipment(activeShipment.value.id, {
      shipmentQuantity: shipmentForm.shipmentQuantity,
      warehouseConfirmedBy: shipmentForm.warehouseConfirmedBy.trim(),
      salesConfirmedBy: shipmentForm.salesConfirmedBy.trim() || undefined,
      overShipmentReason: shipmentForm.overShipmentReason.trim() || undefined,
      remark: shipmentForm.remark || undefined
    });
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
  if (guardDesktopWarehouseMutation(batchShipmentIsOrderMode.value ? '订单发货' : '批量确认发货')) {
    return;
  }
  if (saving.value) {
    return;
  }
  if (batchShipmentRows.value.length === 0) {
    return;
  }
  const lockedRow = batchShipmentRows.value.find((row) => !canShipWarehouseShipment(row));
  if (lockedRow) {
    ElMessage.warning(shipmentLockedText(lockedRow));
    return;
  }
  if (batchShipmentShortageText.value) {
    ElMessage.warning('该订单仍有待补单短缺，请先处理补单、客户减量或无需补单说明');
    return;
  }
  if (!batchShipmentForm.warehouseConfirmedBy.trim()) {
    ElMessage.warning('请填写仓库确认人');
    return;
  }
  const invalidQuantityRow = batchShipmentRows.value.find(
    (row) => Number(row.currentShipmentQuantity || 0) < 0 || Number(row.currentShipmentQuantity || 0) > Number(row.quantity || 0)
  );
  if (invalidQuantityRow) {
    ElMessage.warning(`${invalidQuantityRow.batchNo} 本次发货数量不能大于当前库存数量`);
    return;
  }
  const batchShipments = batchShipmentRows.value
    .map((row) => ({
      batchId: row.id,
      orderLineId: row.isStockOverShipment ? row.targetOrderLineId || row.orderLineId : row.orderLineId,
      shipmentQuantity: Number(row.currentShipmentQuantity || 0)
    }))
    .filter((item) => item.shipmentQuantity > 0);
  if (batchShipments.length === 0) {
    ElMessage.warning('请至少填写一个批次的本次发货数量');
    return;
  }
  if (batchShipmentRequiresSalesConfirmation.value && !batchShipmentForm.salesConfirmedBy.trim()) {
    ElMessage.warning('本次发货超过订单未发货数量或使用备货库存，必须填写销售确认人');
    return;
  }
  if (batchShipmentRequiresSalesConfirmation.value && !batchShipmentForm.overShipmentReason.trim()) {
    ElMessage.warning('本次发货超过订单未发货数量或使用备货库存，必须填写超发说明');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      batchShipments,
      warehouseConfirmedBy: batchShipmentForm.warehouseConfirmedBy.trim(),
      salesConfirmedBy: batchShipmentForm.salesConfirmedBy.trim() || undefined,
      overShipmentReason: batchShipmentForm.overShipmentReason.trim() || undefined,
      remark: batchShipmentForm.remark || undefined
    };
    if (batchShipmentIsOrderMode.value) {
      const orderNo = batchShipmentOrderNo.value;
      if (!orderNo) {
        ElMessage.warning('没有可发货的订单号');
        return;
      }
      await erpApi.confirmOrderShipment(orderNo, payload);
      ElMessage.success('本次发货已确认，订单状态已重新计算');
    } else {
      await erpApi.confirmBatchShipment(
        batchShipments.map((item) => item.batchId),
        payload
      );
      ElMessage.success('批量发货已确认，订单状态已重新计算');
    }
    batchShipmentVisible.value = false;
    batchShipmentIsOrderMode.value = false;
    batchShipmentRows.value = [];
    batchShipmentForm.warehouseConfirmedBy = '';
    batchShipmentForm.salesConfirmedBy = '';
    batchShipmentForm.overShipmentReason = '';
    batchShipmentForm.remark = '';
    selectedShipments.value = [];
    shipmentTableRef.value?.clearSelection();
    await queryWarehouseWork();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '批量发货失败');
  } finally {
    saving.value = false;
  }
}

function formatShipmentTotal(rows: EditableWarehouseShipment[], field: keyof EditableWarehouseShipment = 'quantity') {
  const quantityByUnit = new Map<string, number>();
  rows.forEach((row) => {
    quantityByUnit.set(row.unit, (quantityByUnit.get(row.unit) || 0) + Number(row[field] || 0));
  });
  return Array.from(quantityByUnit.entries())
    .map(([unit, quantity]) => formatQuantity(quantity, unit))
    .join(' / ');
}

function formatShipmentLineTotal(rows: EditableWarehouseShipment[], field: keyof EditableWarehouseShipment) {
  const seenLineKeys = new Set<string>();
  const quantityByUnit = new Map<string, number>();
  rows.forEach((row) => {
    const lineKey = row.orderLineId || `${row.partCode}-${row.partName}-${row.unit}`;
    if (seenLineKeys.has(lineKey)) {
      return;
    }
    seenLineKeys.add(lineKey);
    quantityByUnit.set(row.unit, (quantityByUnit.get(row.unit) || 0) + Number(row[field] || 0));
  });
  return Array.from(quantityByUnit.entries())
    .map(([unit, quantity]) => formatQuantity(quantity, unit))
    .join(' / ');
}

function formatBatchShipmentOverText(rows: EditableWarehouseShipment[]) {
  const lineMap = new Map<string, { current: number; remaining: number; unit: string }>();
  rows.forEach((row) => {
    const lineKey = row.orderLineId || `${row.partCode}-${row.partName}-${row.unit}`;
    const current = Number(row.currentShipmentQuantity || 0);
    const existing = lineMap.get(lineKey);
    if (existing) {
      existing.current += current;
      return;
    }
    lineMap.set(lineKey, {
      current,
      remaining: Number(row.remainingQuantity || 0),
      unit: row.unit
    });
  });

  const overByUnit = new Map<string, number>();
  lineMap.forEach((item) => {
    const overQuantity = Math.max(item.current - item.remaining, 0);
    if (overQuantity > 0) {
      overByUnit.set(item.unit, (overByUnit.get(item.unit) || 0) + overQuantity);
    }
  });
  return Array.from(overByUnit.entries())
    .map(([unit, quantity]) => formatQuantity(quantity, unit))
    .join(' / ');
}

function shipmentQuantityAdjustmentText(row: EditableWarehouseShipment) {
  const currentQuantity = Number(row.currentShipmentQuantity || 0);
  const suggestedQuantity = Number(row.suggestedShipmentQuantity || 0);
  const remainingQuantity = Number(row.remainingQuantity || 0);
  const unit = row.unit || '件';

  if (row.isStockOverShipment && currentQuantity > 0) {
    return `备货超发 ${formatQuantity(currentQuantity, unit)}，需销售确认`;
  }
  if (currentQuantity <= 0) {
    return '本批次本次不发货';
  }
  if (remainingQuantity > 0 && currentQuantity > remainingQuantity + 0.0001) {
    return `超过未发 ${formatQuantity(currentQuantity - remainingQuantity, unit)}，需销售确认`;
  }
  if (suggestedQuantity > 0 && Math.abs(currentQuantity - suggestedQuantity) > 0.0001) {
    return currentQuantity < suggestedQuantity
      ? `少于建议 ${formatQuantity(suggestedQuantity - currentQuantity, unit)}，用于客户分批发货`
      : `多于建议 ${formatQuantity(currentQuantity - suggestedQuantity, unit)}，需销售确认`;
  }
  return '';
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

function shipmentShortageText(row?: WarehouseShipment) {
  if (!row?.orderNo) {
    return '';
  }
  const order = orderOptions.value.find((item) => item.orderNo === row.orderNo);
  if (!order || !orderNeedsShortageAttention(order)) {
    return '';
  }
  return orderShortageActionText(order);
}

function shipmentLockedText(row?: WarehouseShipment) {
  if (!row) {
    return '';
  }
  if (row.orderStatus === 'COMPLETED') {
    return '订单已完成发货，不能再次发货';
  }
  if (row.orderStatus === 'CANCELLED') {
    return '订单已取消，不能发货';
  }
  if (row.orderStatus === 'DRAFT') {
    return '待提交生产订单不能发货';
  }
  return '';
}

function canShipWarehouseShipment(row?: WarehouseShipment) {
  return Boolean(row) && !shipmentLockedText(row);
}

function shipmentRowSelectable(row: WarehouseShipment) {
  return canShipWarehouseShipment(row);
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
  display: block;
  color: #60708a;
}

.notice-ack-text {
  margin-top: 2px;
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

.shipment-quantity-input {
  width: 140px;
}

.shipment-adjustment-note {
  display: block;
  margin-top: 4px;
  color: #b45309;
  font-size: 12px;
  line-height: 16px;
}

.shipment-shortage-block {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid #f6c453;
  border-radius: 8px;
  background: #fff7e6;
  color: #92400e;
}

.shipment-shortage-block p {
  margin: 4px 0 0;
  color: #b45309;
  line-height: 20px;
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

.shipment-order-card .shipment-shortage-warning {
  color: #b45309;
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

.mobile-readonly-note {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  color: #64748b;
  font-size: 12px;
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

  .shipment-order-card strong,
  .shipment-order-card span,
  .shipment-order-card small {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .shipment-order-card .el-button {
    width: 100%;
  }

  .mobile-card-header :deep(.el-segmented) {
    width: 100%;
  }
}
</style>
