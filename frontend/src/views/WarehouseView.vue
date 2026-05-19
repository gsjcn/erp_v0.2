<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">仓库操作</h2>
      <div class="page-actions">
        <el-button v-if="isMobileLayout" :icon="Camera" plain @click="showMobileScanReserved">扫码</el-button>
        <el-badge :value="pendingNoticeCount" :hidden="pendingNoticeCount === 0" class="notice-badge">
          <el-button :icon="Bell" @click="openWarehouseNotices">通知</el-button>
        </el-badge>
        <el-button v-if="!isMobileLayout" @click="openWarehouseDialog">新增仓库</el-button>
        <el-button v-if="!isMobileLayout" @click="openLocationDialog">新增库位</el-button>
        <el-button title="导出配置" v-if="!isMobileLayout" :icon="Download" :loading="warehouseConfigExporting" @click="exportWarehouseConfigExcel">
          导出配置
        </el-button>
        <el-button title="导出待处理" v-if="!isMobileLayout" :icon="Download" :loading="warehouseWorkExporting" @click="exportWarehouseWorkExcel">
          导出待处理
        </el-button>
        <el-button title="刷新整页仓库数据" :loading="warehousePageRefreshing || loading" @click="refreshWarehousePage">刷新</el-button>
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
          @change="handleWarehouseOrderChange"
        />
      </div>
      <el-button title="查询" type="primary" :loading="loading" @click="queryWarehouseWork">查询</el-button>
      <el-button title="重置" @click="resetFilters">重置</el-button>
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
        <div class="stat-label">显示仓库</div>
        <div class="stat-value">{{ warehouseConfigVisibleWarehouses.length }} 个</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">显示库位</div>
        <div class="stat-value">{{ visibleWarehouseLocationCount }} 个</div>
      </div>
    </div>

    <div class="table-card desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">生产完成待入库</h3>
        <div class="panel-actions warehouse-table-height-actions" aria-label="待入库表格高度">
          <el-tooltip content="降低表格高度" placement="top">
            <el-button
              size="small"
              circle
              :icon="Minus"
              :disabled="warehouseWorkTableHeights.receipts <= warehouseWorkTableHeightLimits.min"
              title="降低待入库表格高度"
              aria-label="降低待入库表格高度"
              @click="adjustWarehouseWorkTableHeight('receipts', -warehouseWorkTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="提高表格高度" placement="top">
            <el-button
              size="small"
              circle
              :icon="Plus"
              :disabled="warehouseWorkTableHeights.receipts >= warehouseWorkTableHeightLimits.max"
              title="提高待入库表格高度"
              aria-label="提高待入库表格高度"
              @click="adjustWarehouseWorkTableHeight('receipts', warehouseWorkTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="恢复默认高度" placement="top">
            <el-button
              size="small"
              circle
              :icon="RefreshLeft"
              :disabled="warehouseWorkTableHeights.receipts === warehouseWorkTableDefaultHeights.receipts"
              title="恢复待入库表格默认高度"
              aria-label="恢复待入库表格默认高度"
              @click="resetWarehouseWorkTableHeight('receipts')"
            />
          </el-tooltip>
        </div>
      </div>
      <el-table v-loading="loading" :data="receipts" :max-height="warehouseWorkTableHeights.receipts">
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
            {{ formatQuantity(row.completedQuantity ?? row.quantity, row.unit) }} /
            {{ formatQuantity(row.plannedQuantity ?? row.quantity, row.unit) }}
          </template>
        </el-table-column>
        <el-table-column label="客户订单数量" width="125">
          <template #default="{ row }">{{ formatQuantity(row.customerOrderQuantity ?? row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="订单剩余" width="115">
          <template #default="{ row }">{{ formatQuantity(row.remainingOrderQuantity ?? row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="客户订单入库" width="125">
          <template #default="{ row }">{{ formatQuantity(row.orderReceiptQuantity ?? row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="多做库存" width="105">
          <template #default="{ row }">
            <span :class="{ 'stock-extra': (row.stockQuantity ?? 0) > 0 }">
              {{ (row.stockQuantity ?? 0) > 0 ? formatQuantity(row.stockQuantity ?? 0, row.unit) : '-' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" width="140">
          <template #default>待选择</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="95" />
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openConfirm(row)"
              title="确认入库">确认入库</el-button>
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
          <span>订单 {{ formatQuantity(receipt.customerOrderQuantity ?? receipt.quantity, receipt.unit) }}</span>
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
              {{ formatQuantity(receipt.completedQuantity ?? receipt.quantity, receipt.unit) }} /
              {{ formatQuantity(receipt.plannedQuantity ?? receipt.quantity, receipt.unit) }}
            </span>
          </div>
          <div class="mobile-field">
            <label>客户订单数量</label>
            <span>{{ formatQuantity(receipt.customerOrderQuantity ?? receipt.quantity, receipt.unit) }}</span>
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
            <span :class="{ 'stock-extra': (receipt.stockQuantity ?? 0) > 0 }">
              {{ (receipt.stockQuantity ?? 0) > 0 ? formatQuantity(receipt.stockQuantity ?? 0, receipt.unit) : '-' }}
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
          <el-button link type="primary" @click="openConfirm(receipt)"
            title="确认入库">确认入库</el-button>
        </div>
      </article>
      <div v-if="!receipts.length && !loading" class="mobile-empty">暂无待入库任务</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">待发货库存</h3>
        <div class="panel-actions">
          <div class="warehouse-table-height-actions" aria-label="待发货表格高度">
            <el-tooltip content="降低表格高度" placement="top">
              <el-button
                size="small"
                circle
                :icon="Minus"
                :disabled="warehouseWorkTableHeights.shipments <= warehouseWorkTableHeightLimits.min"
                title="降低待发货表格高度"
                aria-label="降低待发货表格高度"
                @click="adjustWarehouseWorkTableHeight('shipments', -warehouseWorkTableHeightLimits.step)"
              />
            </el-tooltip>
            <el-tooltip content="提高表格高度" placement="top">
              <el-button
                size="small"
                circle
                :icon="Plus"
                :disabled="warehouseWorkTableHeights.shipments >= warehouseWorkTableHeightLimits.max"
                title="提高待发货表格高度"
                aria-label="提高待发货表格高度"
                @click="adjustWarehouseWorkTableHeight('shipments', warehouseWorkTableHeightLimits.step)"
              />
            </el-tooltip>
            <el-tooltip content="恢复默认高度" placement="top">
              <el-button
                size="small"
                circle
                :icon="RefreshLeft"
                :disabled="warehouseWorkTableHeights.shipments === warehouseWorkTableDefaultHeights.shipments"
                title="恢复待发货表格默认高度"
                aria-label="恢复待发货表格默认高度"
                @click="resetWarehouseWorkTableHeight('shipments')"
              />
            </el-tooltip>
          </div>
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
        :max-height="warehouseWorkTableHeights.shipments"
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
          <template #default="{ row }">{{ formatQuantity(row.shippedQuantity ?? 0, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="未发货" width="110">
          <template #default="{ row }">{{ formatQuantity(row.remainingQuantity ?? 0, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="本次建议" width="110">
          <template #default="{ row }">{{ formatQuantity(row.suggestedShipmentQuantity ?? 0, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="160">
          <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <div class="warehouse-shipment-actions">
              <div class="warehouse-shipment-action-group">
                <span class="warehouse-shipment-action-label">订单</span>
                <el-button link type="primary" title="选中订单" @click="selectShipmentOrder(row)">选中</el-button>
                <el-button
                  link
                  type="primary"
                  :disabled="!canShipWarehouseShipment(row)"
                  :title="shipmentLockedText(row) || '订单发货'"
                  @click="openOrderShipmentConfirm(row)"
                >
                  整单
                </el-button>
              </div>
              <div class="warehouse-shipment-action-group">
                <span class="warehouse-shipment-action-label">来源</span>
                <el-button link type="primary" title="库存来源/图纸" @click="openShipmentSourceDetails(row)">图纸</el-button>
              </div>
              <div class="warehouse-shipment-action-group">
                <span class="warehouse-shipment-action-label">发货</span>
                <el-button
                  link
                  type="primary"
                  :disabled="!canShipWarehouseShipment(row) || Boolean(shipmentShortageText(row))"
                  :title="shipmentLockedText(row) || shipmentShortageText(row) || '确认发货'"
                  @click="openShipmentConfirm(row)"
                >
                  确认
                </el-button>
              </div>
            </div>
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
            <el-button
              link
              type="primary"
              :disabled="!canShipWarehouseShipment(group.rows[0])"
              :title="shipmentLockedText(group.rows[0])"
              @click="openOrderShipmentConfirm(group.rows[0])"
            >
              订单发货
            </el-button>
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
          <span>未发 {{ formatQuantity(shipment.remainingQuantity ?? 0, shipment.unit) }}</span>
          <span>建议 {{ formatQuantity(shipment.suggestedShipmentQuantity ?? 0, shipment.unit) }}</span>
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
            <span>{{ formatQuantity(shipment.shippedQuantity ?? 0, shipment.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>未发货</label>
            <span>{{ formatQuantity(shipment.remainingQuantity ?? 0, shipment.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>本次建议</label>
            <span>{{ formatQuantity(shipment.suggestedShipmentQuantity ?? 0, shipment.unit) }}</span>
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
          <el-button
            link
            type="primary"
            :disabled="!canShipWarehouseShipment(shipment)"
            :title="shipmentLockedText(shipment)"
            @click="openOrderShipmentConfirm(shipment)"
          >
            订单发货
          </el-button>
          <el-button link type="primary" @click="openShipmentSourceDetails(shipment)">库存来源/图纸</el-button>
          <el-button
            link
            type="primary"
            :disabled="!canShipWarehouseShipment(shipment) || Boolean(shipmentShortageText(shipment))"
            :title="shipmentLockedText(shipment) || shipmentShortageText(shipment)"
            @click="openShipmentConfirm(shipment)"
          >
            确认发货
          </el-button>
        </div>
      </article>
      <div v-if="!shipments.length && !loading" class="mobile-empty">暂无待发货库存</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">仓库 / 库位</h3>
        <div class="panel-actions warehouse-table-height-actions" aria-label="仓库库位表格高度">
          <el-tooltip content="降低表格高度" placement="top">
            <el-button
              size="small"
              circle
              :icon="Minus"
              :disabled="warehouseWorkTableHeights.locations <= warehouseWorkTableHeightLimits.min"
              title="降低仓库库位表格高度"
              aria-label="降低仓库库位表格高度"
              @click="adjustWarehouseWorkTableHeight('locations', -warehouseWorkTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="提高表格高度" placement="top">
            <el-button
              size="small"
              circle
              :icon="Plus"
              :disabled="warehouseWorkTableHeights.locations >= warehouseWorkTableHeightLimits.max"
              title="提高仓库库位表格高度"
              aria-label="提高仓库库位表格高度"
              @click="adjustWarehouseWorkTableHeight('locations', warehouseWorkTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="恢复默认高度" placement="top">
            <el-button
              size="small"
              circle
              :icon="RefreshLeft"
              :disabled="warehouseWorkTableHeights.locations === warehouseWorkTableDefaultHeights.locations"
              title="恢复仓库库位表格默认高度"
              aria-label="恢复仓库库位表格默认高度"
              @click="resetWarehouseWorkTableHeight('locations')"
            />
          </el-tooltip>
        </div>
      </div>
      <div class="warehouse-config-export-filters">
        <span class="warehouse-config-export-title">配置显示/导出范围</span>
        <div class="warehouse-config-export-filter">
          <span>仓库状态</span>
          <el-segmented v-model="warehouseConfigExportFilters.status" :options="warehouseConfigStatusOptions" />
        </div>
        <div class="warehouse-config-export-filter">
          <span>库位状态</span>
          <el-segmented v-model="warehouseConfigExportFilters.locationStatus" :options="warehouseConfigStatusOptions" />
        </div>
      </div>
      <el-table :data="warehouseRows" :max-height="warehouseWorkTableHeights.locations">
        <el-table-column prop="warehouseCode" label="仓库编码" width="140" />
        <el-table-column prop="warehouseName" label="仓库名称" min-width="180" />
        <el-table-column label="仓库状态" width="110">
          <template #default="{ row }">
            <StatusTag :value="row.warehouseStatus" />
          </template>
        </el-table-column>
        <el-table-column prop="locationCode" label="库位编码" width="140" />
        <el-table-column prop="locationName" label="库位名称" width="140" />
        <el-table-column label="库位状态" width="110">
          <template #default="{ row }">
            <StatusTag v-if="row.locationId" :value="row.locationStatus" />
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" fixed="right" width="260">
          <template #default="{ row }">
            <div class="warehouse-config-actions">
              <div class="warehouse-config-action-group">
                <span class="warehouse-config-action-label">仓库</span>
                <el-button title="编辑仓库" link type="primary" @click="openEditWarehouseDialog(row)">编辑</el-button>
                <el-button
                  link
                  :title="row.warehouseStatus === 'ENABLED' ? '停用仓库' : '启用仓库'"
                  :type="row.warehouseStatus === 'ENABLED' ? 'danger' : 'success'"
                  @click="toggleWarehouseStatus(row)"
                >
                  {{ row.warehouseStatus === 'ENABLED' ? '停用' : '启用' }}
                </el-button>
                <el-button title="删除仓库" link type="danger" @click="requestDeleteWarehouse(row)">删除</el-button>
              </div>
              <div v-if="row.locationId" class="warehouse-config-action-group">
                <span class="warehouse-config-action-label">库位</span>
                <el-button title="编辑库位" link type="primary" @click="openEditLocationDialog(row)">编辑</el-button>
                <el-button
                  link
                  :title="row.locationStatus === 'ENABLED' ? '停用库位' : '启用库位'"
                  :type="row.locationStatus === 'ENABLED' ? 'danger' : 'success'"
                  @click="toggleLocationStatus(row)"
                >
                  {{ row.locationStatus === 'ENABLED' ? '停用' : '启用' }}
                </el-button>
                <el-button title="删除库位" link type="danger" @click="requestDeleteLocation(row)">删除</el-button>
              </div>
            </div>
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
          <span><StatusTag :value="row.warehouseStatus" compact /></span>
        </div>
        <div v-show="isMobileWarehouseCardExpanded(warehouseLocationCardKey(row))" class="mobile-card-fields">
          <div class="mobile-field">
            <label>仓库状态</label>
            <span><StatusTag :value="row.warehouseStatus" /></span>
          </div>
          <div class="mobile-field">
            <label>库位状态</label>
            <span>
              <StatusTag v-if="row.locationId" :value="row.locationStatus" />
              <span v-else>-</span>
            </span>
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
        <div class="panel-actions">
          <div class="warehouse-table-height-actions" aria-label="库存流水表格高度">
            <el-tooltip content="降低表格高度" placement="top">
              <el-button
                size="small"
                circle
                :icon="Minus"
                :disabled="warehouseWorkTableHeights.transactions <= warehouseWorkTableHeightLimits.min"
                title="降低库存流水表格高度"
                aria-label="降低库存流水表格高度"
                @click="adjustWarehouseWorkTableHeight('transactions', -warehouseWorkTableHeightLimits.step)"
              />
            </el-tooltip>
            <el-tooltip content="提高表格高度" placement="top">
              <el-button
                size="small"
                circle
                :icon="Plus"
                :disabled="warehouseWorkTableHeights.transactions >= warehouseWorkTableHeightLimits.max"
                title="提高库存流水表格高度"
                aria-label="提高库存流水表格高度"
                @click="adjustWarehouseWorkTableHeight('transactions', warehouseWorkTableHeightLimits.step)"
              />
            </el-tooltip>
            <el-tooltip content="恢复默认高度" placement="top">
              <el-button
                size="small"
                circle
                :icon="RefreshLeft"
                :disabled="warehouseWorkTableHeights.transactions === warehouseWorkTableDefaultHeights.transactions"
                title="恢复库存流水表格默认高度"
                aria-label="恢复库存流水表格默认高度"
                @click="resetWarehouseWorkTableHeight('transactions')"
              />
            </el-tooltip>
          </div>
          <el-button title="导出Excel" :icon="Download" :loading="transactionExporting" @click="exportWarehouseTransactions">
            导出 Excel
          </el-button>
          <el-segmented v-model="transactionType" :options="transactionOptions" @change="reloadTransactionsFromFirstPage" />
        </div>
      </div>
      <el-table :data="transactions" :max-height="warehouseWorkTableHeights.transactions">
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
        <el-table-column label="图纸快照" min-width="220">
          <template #default="{ row }">
            <div class="cell-main">{{ drawingTitle(row) }}</div>
            <DrawingPreviewLink :file-name="row.drawingFileName" :file-url="row.drawingFileUrl" empty-text="未上传图纸" />
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
                <template v-if="(row.reservedQuantity ?? 0) > 0">
                  / 预占 {{ formatQuantity(row.reservedQuantity ?? 0, row.unit) }}
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
        <el-table-column prop="remark" label="备注" min-width="160">
          <template #default="{ row }">
            <el-tooltip :content="longTextTooltipText(row.remark)" placement="top" :disabled="!row.remark">
              <span>{{ formatLongTextPreview(row.remark) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
      <div class="warehouse-transaction-pagination">
        <span>共 {{ transactionPagination.totalCount }} 条，当前第 {{ transactionPagination.page }} 页</span>
        <el-pagination
          background
          layout="prev, pager, next, jumper"
          :current-page="transactionPagination.page"
          :page-size="transactionPagination.limit"
          :total="transactionPagination.totalCount"
          @current-change="handleTransactionPageChange"
        />
      </div>
    </div>

    <div class="mobile-section">
      <div class="mobile-card-header">
        <h3 class="mobile-section-title">库存流水</h3>
        <el-segmented v-model="transactionType" :options="transactionOptions" @change="reloadTransactionsFromFirstPage" />
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
          <div class="mobile-field">
            <label>图纸快照</label>
            <span>
              {{ drawingTitle(transaction) }}
              <DrawingPreviewLink
                :file-name="transaction.drawingFileName || undefined"
                :file-url="transaction.drawingFileUrl || undefined"
                empty-text="未上传图纸"
              />
            </span>
          </div>
          <div v-if="transaction.batchNo" class="mobile-field">
            <label>批次余量</label>
            <span>
              可用 {{ formatQuantity(transaction.availableQuantity ?? 0, transaction.unit) }}
              <small class="muted">
                账面 {{ formatQuantity(transaction.physicalQuantity ?? 0, transaction.unit) }}
                <template v-if="(transaction.reservedQuantity ?? 0) > 0">
                  / 预占 {{ formatQuantity(transaction.reservedQuantity ?? 0, transaction.unit) }}
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
            <span :title="longTextTooltipText(transaction.remark)">{{ formatLongTextPreview(transaction.remark) }}</span>
          </div>
        </div>
      </article>
      <div v-if="!transactions.length && !loading" class="mobile-empty">暂无库存流水</div>
      <div class="warehouse-transaction-pagination">
        <span>共 {{ transactionPagination.totalCount }} 条，当前第 {{ transactionPagination.page }} 页</span>
        <el-pagination
          background
          layout="prev, pager, next"
          :current-page="transactionPagination.page"
          :page-size="transactionPagination.limit"
          :total="transactionPagination.totalCount"
          @current-change="handleTransactionPageChange"
        />
      </div>
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
          {{ activeReceipt ? formatQuantity(activeReceipt.completedQuantity ?? activeReceipt.quantity, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item label="生产计划">
          {{ activeReceipt ? formatQuantity(activeReceipt.plannedQuantity ?? activeReceipt.quantity, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item label="客户订单">
          {{ activeReceipt ? formatQuantity(activeReceipt.customerOrderQuantity ?? activeReceipt.quantity, activeReceipt.unit) : '-' }}
        </el-form-item>
        <el-form-item label="已入订单">
          {{ activeReceipt ? formatQuantity(activeReceipt.receivedOrderQuantity ?? 0, activeReceipt.unit) : '-' }}
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
            <el-option v-for="item in enabledWarehouses" :key="item.id" :label="item.warehouseName" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="库位" required>
          <el-select v-model="receiptForm.locationId" placeholder="选择库位" style="width: 260px">
            <el-option v-for="item in currentLocations" :key="item.id" :label="item.locationName" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库确认" required>
          <el-select
            v-model="receiptForm.warehouseConfirmedByCode"
            filterable
            remote
            clearable
            reserve-keyword
            placeholder="选择仓库管理员"
            style="width: 260px"
            :remote-method="searchWarehouseOperators"
            :loading="warehouseOperatorLoading"
            @visible-change="handleWarehouseOperatorSelectVisible"
          >
            <el-option
              v-for="operator in warehouseOperatorOptionRows"
              :key="operator.code"
              :label="warehouseOperatorOptionLabel(operator)"
              :value="operator.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="receiptForm.remark"
            type="textarea"
            :rows="3"
            placeholder="例如：订单数量入库，多做数量转库存"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="confirmVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmReceipt"
          title="确认入库">确认入库</el-button>
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
        <el-button type="warning" plain @click="goActiveShipmentShortageDetail"
  title="处理补单">处理补单</el-button>
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
          {{ activeShipment ? formatQuantity(activeShipment.shippedQuantity ?? 0, activeShipment.unit) : '-' }}
        </el-form-item>
        <el-form-item label="未发货">
          {{ activeShipment ? formatQuantity(activeShipment.remainingQuantity ?? 0, activeShipment.unit) : '-' }}
        </el-form-item>
        <el-form-item label="本次发货" required>
          <el-input-number
            v-model="shipmentForm.shipmentQuantity"
            :min="0"
            :max="activeShipment?.quantity ?? 0"
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
          <el-select
            v-model="shipmentForm.warehouseConfirmedByCode"
            filterable
            remote
            clearable
            reserve-keyword
            placeholder="选择仓库管理员"
            style="width: 260px"
            :remote-method="searchWarehouseOperators"
            :loading="warehouseOperatorLoading"
            @visible-change="handleWarehouseOperatorSelectVisible"
          >
            <el-option
              v-for="operator in warehouseOperatorOptionRows"
              :key="operator.code"
              :label="warehouseOperatorOptionLabel(operator)"
              :value="operator.code"
            />
          </el-select>
        </el-form-item>
        <el-alert
          v-if="activeShipmentOverQuantity > 0"
          class="mb-16"
          type="warning"
          :closable="false"
          :title="`本次超出未发货数量 ${formatQuantity(activeShipmentOverQuantity, activeShipment?.unit || '件')}，需要销售确认和说明。`"
        />
        <el-form-item v-if="activeShipmentOverQuantity > 0" label="销售确认" required>
          <el-input v-model="shipmentForm.salesConfirmedBy" placeholder="填写销售确认人" />
        </el-form-item>
        <el-form-item v-if="activeShipmentOverQuantity > 0" label="超发说明" required>
          <el-input
            v-model="shipmentForm.overShipmentReason"
            type="textarea"
            :rows="2"
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
            placeholder="例如：按订单发货"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="shipmentVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="Boolean(activeShipmentShortageText)" @click="confirmShipment"
          title="确认发货">确认发货</el-button>
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
        <el-button type="warning" plain @click="goBatchShipmentShortageDetail"
  title="处理补单">处理补单</el-button>
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
          <el-select
            v-model="batchShipmentForm.warehouseConfirmedByCode"
            filterable
            remote
            clearable
            reserve-keyword
            placeholder="选择仓库管理员"
            style="width: 260px"
            :remote-method="searchWarehouseOperators"
            :loading="warehouseOperatorLoading"
            @visible-change="handleWarehouseOperatorSelectVisible"
          >
            <el-option
              v-for="operator in warehouseOperatorOptionRows"
              :key="operator.code"
              :label="warehouseOperatorOptionLabel(operator)"
              :value="operator.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="销售确认">
          <el-input v-model="batchShipmentForm.salesConfirmedBy" placeholder="如存在超发，请填写销售确认人" />
        </el-form-item>
        <el-form-item label="超发说明">
          <el-input
            v-model="batchShipmentForm.overShipmentReason"
            type="textarea"
            :rows="2"
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
        <div class="batch-shipment-table-toolbar">
          <strong>本次发货批次</strong>
          <div class="warehouse-table-height-actions" aria-label="批量发货明细表格高度">
            <el-tooltip content="降低表格高度" placement="top">
              <el-button
                size="small"
                circle
                :icon="Minus"
                :disabled="warehouseWorkTableHeights.batchShipment <= warehouseWorkTableHeightLimits.min"
                title="降低批量发货明细表格高度"
                aria-label="降低批量发货明细表格高度"
                @click="adjustWarehouseWorkTableHeight('batchShipment', -warehouseWorkTableHeightLimits.step)"
              />
            </el-tooltip>
            <el-tooltip content="提高表格高度" placement="top">
              <el-button
                size="small"
                circle
                :icon="Plus"
                :disabled="warehouseWorkTableHeights.batchShipment >= warehouseWorkTableHeightLimits.max"
                title="提高批量发货明细表格高度"
                aria-label="提高批量发货明细表格高度"
                @click="adjustWarehouseWorkTableHeight('batchShipment', warehouseWorkTableHeightLimits.step)"
              />
            </el-tooltip>
            <el-tooltip content="恢复默认高度" placement="top">
              <el-button
                size="small"
                circle
                :icon="RefreshLeft"
                :disabled="warehouseWorkTableHeights.batchShipment === warehouseWorkTableDefaultHeights.batchShipment"
                title="恢复批量发货明细表格默认高度"
                aria-label="恢复批量发货明细表格默认高度"
                @click="resetWarehouseWorkTableHeight('batchShipment')"
              />
            </el-tooltip>
          </div>
        </div>
        <el-table :data="batchShipmentRows" :max-height="warehouseWorkTableHeights.batchShipment" class="batch-shipment-table">
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
            <template #default="{ row }">{{ formatQuantity(row.shippedQuantity ?? 0, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="未发货" width="110">
            <template #default="{ row }">{{ formatQuantity(row.remainingQuantity ?? 0, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="本次建议" width="110">
            <template #default="{ row }">{{ formatQuantity(row.suggestedShipmentQuantity ?? 0, row.unit) }}</template>
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
              <el-button v-else link type="danger" @click="removeStockOverShipment(row)"
  title="移除">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-form-item label="备注">
          <el-input
            v-model="batchShipmentForm.remark"
            type="textarea"
            :rows="3"
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
      :title="warehouseDialogTitle"
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
        <el-button type="primary" :loading="saving" @click="saveWarehouse"
          title="保存">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="locationVisible"
      :title="locationDialogTitle"
      width="min(420px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleSavingDialogBeforeClose"
    >
      <el-form label-width="92px">
        <el-form-item label="仓库">
          <el-select v-model="locationForm.warehouseId" :disabled="Boolean(locationEditId)" placeholder="选择仓库" style="width: 260px">
            <el-option
              v-for="item in locationWarehouseOptions"
              :key="item.id"
              :label="`${item.warehouseName} / ${item.warehouseCode}`"
              :value="item.id"
              :disabled="item.status === 'DISABLED'"
            />
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
        <el-button type="primary" :loading="saving" @click="saveLocation"
          title="保存">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="warehouseDeleteVisible"
      title="删除确认"
      width="min(520px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleSavingDialogBeforeClose"
    >
      <div v-if="activeWarehouseDeleteTarget" class="delete-confirm-body">
        <p>
          确认删除
          <strong>{{ activeWarehouseDeleteTarget.title }}</strong>
          ？
        </p>
        <el-alert
          type="warning"
          show-icon
          :closable="false"
          :title="activeWarehouseDeleteTarget.warning"
        />
      </div>
      <template #footer>
        <el-button :disabled="saving" @click="warehouseDeleteVisible = false">取消</el-button>
        <el-button type="danger" :loading="saving" @click="confirmDeleteWarehouseTarget"
  title="确认删除">确认删除</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="warehouseStatusVisible"
      :title="activeWarehouseStatusTarget?.actionLabel || '状态确认'"
      width="min(540px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleWarehouseStatusDialogBeforeClose"
    >
      <div v-if="activeWarehouseStatusTarget" class="delete-confirm-body">
        <p>
          确认{{ activeWarehouseStatusTarget.actionLabel }}
          <strong>{{ activeWarehouseStatusTarget.title }}</strong>
          ？
        </p>
        <el-alert
          :type="activeWarehouseStatusTarget.nextStatus === 'ENABLED' ? 'success' : 'warning'"
          show-icon
          :closable="false"
          :title="activeWarehouseStatusTarget.warning"
        />
      </div>
      <template #footer>
        <el-button :disabled="saving" @click="closeWarehouseStatusDialog">取消</el-button>
        <el-button
          :type="activeWarehouseStatusTarget?.nextStatus === 'ENABLED' ? 'success' : 'danger'"
          :loading="saving"
          @click="confirmWarehouseStatusTarget"

          :title="activeWarehouseStatusTarget?.actionLabel || '确认'">
          {{ activeWarehouseStatusTarget?.actionLabel || '确认' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="noticeVisible" title="仓库通知" width="min(980px, calc(100vw - 32px))" class="responsive-dialog">
      <div v-loading="noticeLoading" class="notice-list">
        <div class="notice-toolbar">
          <el-radio-group v-model="warehouseNoticeStatusFilter" size="small" @change="reloadWarehouseNoticesFromFirstPage">
            <el-radio-button value="PENDING">待处理 {{ warehouseNoticeCounts.PENDING }}</el-radio-button>
            <el-radio-button value="ACKNOWLEDGED">历史 {{ warehouseNoticeCounts.ACKNOWLEDGED }}</el-radio-button>
            <el-radio-button value="ALL">全部 {{ warehouseNoticeCounts.ALL }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="notice-filter-grid">
          <CustomerSelect
            v-model="warehouseNoticeFilters.customerId"
            placeholder="通知客户"
            width="180px"
            @change="reloadWarehouseNoticesFromFirstPage"
          />
          <el-input v-model="warehouseNoticeFilters.orderNo" clearable placeholder="订单号" @keyup.enter="reloadWarehouseNoticesFromFirstPage" />
          <el-input v-model="warehouseNoticeFilters.partCode" clearable placeholder="零件编码" @keyup.enter="reloadWarehouseNoticesFromFirstPage" />
          <el-select v-model="warehouseNoticeFilters.noticeType" placeholder="通知类型">
            <el-option label="全部类型" value="ALL" />
            <el-option v-for="item in warehouseNoticeTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <DateRangeFilter v-model="warehouseNoticeDateRange" start-placeholder="通知开始" end-placeholder="通知结束" width="220px" />
          <el-input v-model="warehouseNoticeFilters.keyword" clearable placeholder="客户/原因/任务号" @keyup.enter="reloadWarehouseNoticesFromFirstPage" />
          <el-button title="查询" type="primary" @click="reloadWarehouseNoticesFromFirstPage">查询</el-button>
          <el-button title="重置" @click="resetWarehouseNoticeFilters">重置</el-button>
          <el-button title="导出Excel" :icon="Download" :loading="warehouseNoticeExporting" @click="exportWarehouseNoticesExcel">导出 Excel</el-button>
        </div>
        <div class="warehouse-dialog-list-toolbar">
          <div class="warehouse-table-height-actions" aria-label="仓库通知列表高度">
            <span class="warehouse-table-height-label">通知列表高度</span>
            <el-button-group>
              <el-button
                size="small"
                :icon="Minus"
                :disabled="warehouseWorkTableHeights.notices <= warehouseWorkTableHeightLimits.min"
                title="降低仓库通知列表高度"
                aria-label="降低仓库通知列表高度"
                @click="adjustWarehouseWorkTableHeight('notices', -warehouseWorkTableHeightLimits.step)"
              />
              <el-button
                size="small"
                :icon="Plus"
                :disabled="warehouseWorkTableHeights.notices >= warehouseWorkTableHeightLimits.max"
                title="提高仓库通知列表高度"
                aria-label="提高仓库通知列表高度"
                @click="adjustWarehouseWorkTableHeight('notices', warehouseWorkTableHeightLimits.step)"
              />
              <el-button
                size="small"
                :icon="RefreshLeft"
                :disabled="warehouseWorkTableHeights.notices === warehouseWorkTableDefaultHeights.notices"
                title="恢复仓库通知列表默认高度"
                aria-label="恢复仓库通知列表默认高度"
                @click="resetWarehouseWorkTableHeight('notices')"
              />
            </el-button-group>
          </div>
        </div>
        <div class="notice-scroll-list" :style="{ maxHeight: warehouseWorkTableHeightStyle('notices') }">
          <div v-if="filteredWarehouseNotices.length === 0" class="muted">暂无仓库通知</div>
          <article v-for="notice in filteredWarehouseNotices" :key="notice.id" class="notice-item">
            <div>
              <strong>{{ warehouseNoticeTitle(notice) }}</strong>
              <p :title="warehouseNoticeReasonTitle(notice)">{{ warehouseNoticeReasonPreview(notice) }}</p>
              <small>通知时间：{{ formatDateTime(notice.createdAt) }}</small>
              <small v-if="notice.status === 'ACKNOWLEDGED'" class="notice-ack-text">
                确认：{{ notice.acknowledgedBy || '-' }} / {{ formatDateTime(notice.acknowledgedAt) }}
              </small>
            </div>
            <el-button
              v-if="notice.status === 'PENDING'"
              size="small"
              type="primary"
              @click="acknowledgeWarehouseNotice(notice)"

              title="确认已知晓">
              确认已知晓
            </el-button>
            <StatusTag v-else value="ACKNOWLEDGED" compact />
          </article>
        </div>
        <div class="warehouse-notice-pagination">
          <span>共 {{ warehouseNoticePagination.totalCount }} 条，当前第 {{ warehouseNoticePagination.page }} 页</span>
          <el-pagination
            background
            layout="prev, pager, next, jumper"
            :current-page="warehouseNoticePagination.page"
            :page-size="warehouseNoticePagination.limit"
            :total="warehouseNoticePagination.totalCount"
            @current-change="handleWarehouseNoticePageChange"
          />
        </div>
      </div>
      <template #footer>
        <el-button title="关闭" @click="noticeVisible = false">关闭</el-button>
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
      :use-select="true"
      :select-options="warehouseOperatorSelectOptions"
      :select-loading="warehouseOperatorLoading"
      select-placeholder="选择仓库管理员"
      @search="searchWarehouseOperators"
      @visible-change="handleWarehouseOperatorSelectVisible"
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
          <p :title="warehouseNoticeReasonTitle(activeWarehouseNotice)">{{ warehouseNoticeReasonPreview(activeWarehouseNotice) }}</p>
          <span>
            {{ activeWarehouseNotice.partName || '-' }} /
            {{ stockNoticeQuantityText }}
          </span>
        </div>
        <div v-if="activeWarehouseNotice.handlingPlan" class="notice-plan-card">
          <strong>取消时处理建议</strong>
          <span>{{ handlingPlanText(activeWarehouseNotice) }}</span>
          <small>仓库可根据实物清点结果修改处理方式、数量和备注，最终以仓库确认记录为准。</small>
        </div>
        <el-form label-width="116px" class="mt-16">
          <el-form-item label="仓库确认人员" required>
            <el-select
              v-model="stockNoticeForm.acknowledgedByCode"
              filterable
              remote
              clearable
              reserve-keyword
              placeholder="选择仓库管理员"
              style="width: 260px"
              :remote-method="searchWarehouseOperators"
              :loading="warehouseOperatorLoading"
              @visible-change="handleWarehouseOperatorSelectVisible"
            >
              <el-option
                v-for="operator in warehouseOperatorOptionRows"
                :key="operator.code"
                :label="warehouseOperatorOptionLabel(operator)"
                :value="operator.code"
              />
            </el-select>
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
            <el-input-number
              v-model="stockNoticeForm.handlingQuantity"
              :min="0"
              :max="stockNoticeHandlingQuantityMax || undefined"
              :precision="3"
              :controls="false"
              style="width: 180px"
            />
            <span class="unit-text">{{ activeWarehouseNotice.unit || '件' }}</span>
            <small v-if="stockNoticeHandlingQuantityMax > 0" class="notice-quantity-limit">
              最多 {{ formatQuantity(stockNoticeHandlingQuantityMax, activeWarehouseNotice.unit || '件') }}
            </small>
          </el-form-item>
          <el-form-item v-if="stockNoticeNeedsWarehouse" label="转入仓库" required>
            <el-select v-model="stockNoticeForm.warehouseId" placeholder="选择转入仓库" style="width: 260px" @change="resetStockNoticeLocation">
              <el-option v-for="item in enabledWarehouses" :key="item.id" :label="item.warehouseName" :value="item.id" />
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
import { Bell, Camera, Download, Minus, Plus, RefreshLeft } from '@element-plus/icons-vue';
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
  CommonStatus,
  InventorySourceBatchDetail,
  InventorySourceDetailResponse,
  OrderSummary,
  ProductionNotice,
  ProductionNoticeStatus,
  ProductionNoticeType,
  ProductionOperator,
  Warehouse,
  WarehouseReceipt,
  WarehouseShipment,
  WarehouseTransaction
} from '../types/erp';
import { formatDate, formatDateTime, formatQuantity } from '../utils/format';
import { formatFileDateTime } from '../utils/tableExport';

type EditableWarehouseShipment = WarehouseShipment & {
  currentShipmentQuantity?: number;
  isStockOverShipment?: boolean;
  targetOrderLineId?: string;
};

type WarehouseLocationRow = {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseStatus: CommonStatus;
  locationId: string;
  locationCode: string;
  locationName: string;
  locationStatus: CommonStatus;
  status: CommonStatus;
};

type WarehouseDeleteTarget = {
  type: 'warehouse' | 'location';
  warehouseId: string;
  locationId?: string;
  title: string;
  warning: string;
};

type WarehouseStatusTarget = {
  type: 'warehouse' | 'location';
  warehouseId: string;
  locationId?: string;
  nextStatus: CommonStatus;
  title: string;
  actionLabel: string;
  warning: string;
};

type WarehouseWorkTableKey = 'receipts' | 'shipments' | 'locations' | 'transactions' | 'batchShipment' | 'notices';
const warehouseWorkTableKeys: WarehouseWorkTableKey[] = ['receipts', 'shipments', 'locations', 'transactions', 'batchShipment', 'notices'];

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
const transactionDefaultLimit = Number(20);
const transactionPagination = reactive({
  page: 1,
  limit: transactionDefaultLimit,
  totalCount: 0
});
const warehouseNotices = ref<ProductionNotice[]>([]);
const warehouseNoticeStatusFilter = ref<ProductionNoticeStatus | 'ALL'>('PENDING');
const warehouseNoticeDateRange = ref<string[]>([]);
const warehouseNoticeDefaultLimit = Number(20);
const warehouseNoticePagination = reactive({
  page: 1,
  limit: warehouseNoticeDefaultLimit,
  totalCount: 0
});
const warehouseNoticeServerCounts = reactive({
  ALL: 0,
  PENDING: 0,
  ACKNOWLEDGED: 0
});
const dateRange = ref<string[]>([]);
const transactionType = ref<'ALL' | 'IN' | 'OUT'>('ALL');
const warehouseConfigExportFilters = reactive<{
  status: CommonStatus | 'ALL';
  locationStatus: CommonStatus | 'ALL';
}>({
  status: 'ENABLED',
  locationStatus: 'ENABLED'
});
const loading = ref(false);
const warehousePageRefreshing = ref(false);
const warehouseConfigExporting = ref(false);
const warehouseWorkExporting = ref(false);
const transactionExporting = ref(false);
const warehouseNoticeExporting = ref(false);
const noticeLoading = ref(false);
const acknowledgeVisible = ref(false);
const acknowledgeSaving = ref(false);
const stockNoticeVisible = ref(false);
const stockNoticeSaving = ref(false);
const stockSourceLoading = ref(false);
const stockSourceRequestSeq = ref(0);
const stockNoticeConfirmTime = ref('');
const saving = ref(false);
const warehouseOperatorLoading = ref(false);
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
const warehouseDeleteVisible = ref(false);
const warehouseStatusVisible = ref(false);
const warehouseEditId = ref('');
const locationEditId = ref('');
const activeReceipt = ref<WarehouseReceipt>();
const activeShipment = ref<WarehouseShipment>();
const activeWarehouseNotice = ref<ProductionNotice>();
const activeWarehouseDeleteTarget = ref<WarehouseDeleteTarget>();
const activeWarehouseStatusTarget = ref<WarehouseStatusTarget>();
const shipmentSourceDetails = ref<InventorySourceDetailResponse | null>(null);
const shipmentSourceFocusBatchId = ref('');
const shipmentSourceFocusBatchNo = ref('');
const shipmentTableRef = ref();
const expandedMobileWarehouseCardKeys = ref<string[]>([]);
const warehouseOperatorOptions = ref<ProductionOperator[]>([]);
const warehouseOperatorCache = reactive<Record<string, ProductionOperator>>({});
let warehouseOperatorRequestSeq = 0;
const warehouseWorkTableHeightLimits = {
  min: 280,
  max: 680,
  step: 80
};
const warehouseWorkTableDefaultHeights: Record<WarehouseWorkTableKey, number> = {
  receipts: 400,
  shipments: 480,
  locations: 360,
  transactions: 360,
  batchShipment: 360,
  notices: 480
};
const warehouseWorkTableHeightStorageKey = 'baisheng.erp.warehouseWorkTableHeights.v1';
// 仓库现场表格和通知列表高度只保存为本机 UI 偏好，不写入入库、发货、通知状态、库存批次或库存流水业务数据。
const warehouseWorkTableHeights = reactive<Record<WarehouseWorkTableKey, number>>({ ...warehouseWorkTableDefaultHeights });

const filters = reactive<{
  customerId?: string;
  orderNo?: string;
}>({});

const warehouseNoticeFilters = reactive<{
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

const warehouseNoticeTypeOptions: Array<{ label: string; value: ProductionNoticeType }> = [
  { label: '数量增加', value: 'QUANTITY_INCREASE' },
  { label: '数量减少', value: 'QUANTITY_DECREASE' },
  { label: '订单取消', value: 'ORDER_CANCELLED' },
  { label: '新增零件', value: 'MATERIAL_ADDED' },
  { label: '管理撤回', value: 'TASK_WITHDRAWN' }
];
const receiptForm = reactive({
  warehouseId: '',
  locationId: '',
  warehouseConfirmedByCode: '',
  remark: ''
});
const shipmentForm = reactive({
  shipmentQuantity: 0,
  warehouseConfirmedByCode: '',
  salesConfirmedBy: '',
  overShipmentReason: '',
  remark: ''
});
const batchShipmentForm = reactive({
  warehouseConfirmedByCode: '',
  salesConfirmedBy: '',
  overShipmentReason: '',
  remark: ''
});
const stockNoticeForm = reactive({
  acknowledgedByCode: '',
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
const warehouseConfigStatusOptions: Array<{ label: string; value: CommonStatus | 'ALL' }> = [
  { label: '全部', value: 'ALL' },
  { label: '启用', value: 'ENABLED' },
  { label: '停用', value: 'DISABLED' }
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
const pendingNoticeCount = computed(() => warehouseNoticeServerCounts.PENDING);
const warehouseNoticeCounts = computed(() => warehouseNoticeServerCounts);
const filteredWarehouseNotices = computed(() => warehouseNotices.value);
const warehouseConfigVisibleWarehouses = computed(() =>
  warehouses.value.filter((item) => warehouseConfigStatusMatches(item.status, warehouseConfigExportFilters.status))
);
const enabledWarehouses = computed(() => warehouses.value.filter((item) => item.status === 'ENABLED'));
const warehouseDialogTitle = computed(() => (warehouseEditId.value ? '编辑仓库' : '新增仓库'));
const locationDialogTitle = computed(() => (locationEditId.value ? '编辑库位' : '新增库位'));
const locationWarehouseOptions = computed(() => (locationEditId.value ? warehouses.value : enabledWarehouses.value));
const currentLocations = computed(() => {
  const warehouse = warehouses.value.find((item) => item.id === receiptForm.warehouseId);
  if (!warehouse || warehouse.status !== 'ENABLED') {
    return [];
  }
  return warehouse.locations.filter((item) => item.status === 'ENABLED');
});
const currentStockNoticeLocations = computed(() => {
  const warehouse = warehouses.value.find((item) => item.id === stockNoticeForm.warehouseId);
  if (!warehouse || warehouse.status !== 'ENABLED') {
    return [];
  }
  return warehouse.locations.filter((item) => item.status === 'ENABLED');
});
const warehouseOperatorOptionRows = computed(() => {
  const merged = new Map<string, ProductionOperator>();
  warehouseOperatorOptions.value.forEach((operator) => merged.set(operator.code, operator));
  [
    receiptForm.warehouseConfirmedByCode,
    shipmentForm.warehouseConfirmedByCode,
    batchShipmentForm.warehouseConfirmedByCode,
    stockNoticeForm.acknowledgedByCode
  ]
    .filter(Boolean)
    .forEach((code) => {
      const cached = warehouseOperatorCache[code];
      if (cached) {
        merged.set(code, cached);
      }
  });
  return Array.from(merged.values()).filter(isWarehouseOperator);
});
const warehouseOperatorSelectOptions = computed(() =>
  warehouseOperatorOptionRows.value.map((operator) => ({
    label: warehouseOperatorOptionLabel(operator),
    value: operator.code
  }))
);
const activeStockNoticeIsWithdraw = computed(() => Boolean(activeWarehouseNotice.value && requiresWithdrawStockReceipt(activeWarehouseNotice.value)));
const showCustomerChangeHandlingFields = computed(() => Boolean(activeWarehouseNotice.value && requiresCustomerChangeHandling(activeWarehouseNotice.value)));
const stockNoticeNeedsWarehouse = computed(
  () => activeStockNoticeIsWithdraw.value || (showCustomerChangeHandlingFields.value && stockNoticeForm.handlingMode === 'STOCK')
);
const showStockMergeConfirm = computed(
  () => showCustomerChangeHandlingFields.value && stockNoticeForm.handlingMode === 'STOCK'
);
const stockNoticeHandlingQuantityMax = computed(() => {
  const notice = activeWarehouseNotice.value;
  if (!notice) {
    return 0;
  }
  if (requiresWithdrawStockReceipt(notice)) {
    return roundQuantityValue(Number(notice.afterQuantity ?? 0));
  }
  if (requiresCustomerChangeHandling(notice)) {
    return customerChangeHandlingQuantityLimit(notice);
  }
  return 0;
});
const stockNoticeQuantityText = computed(() => {
  const notice = activeWarehouseNotice.value;
  if (!notice) {
    return '-';
  }
  const quantity = stockNoticeDisplayQuantity(notice);
  const prefix = requiresCustomerChangeHandling(notice) ? '需处理' : '数量';
  return `${prefix} ${formatQuantity(quantity, notice.unit || '件')}`;
});
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
  return Math.max(Number(shipmentForm.shipmentQuantity ?? 0) - Number(activeShipment.value.remainingQuantity ?? 0), 0);
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
  batchShipmentRows.value.some((row) => row.isStockOverShipment && Number(row.currentShipmentQuantity ?? 0) > 0)
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
const warehouseRows = computed<WarehouseLocationRow[]>(() =>
  warehouseConfigVisibleWarehouses.value.flatMap((warehouse) => {
    const visibleLocations = warehouse.locations.filter((location) =>
      warehouseConfigStatusMatches(location.status, warehouseConfigExportFilters.locationStatus)
    );
    const shouldShowWarehouseWithoutVisibleLocation =
      (warehouseConfigExportFilters.locationStatus === 'ALL' && !warehouse.locations.length) ||
      (warehouseConfigExportFilters.locationStatus === 'ENABLED' && warehouse.status === 'ENABLED' && !visibleLocations.length);
    if (shouldShowWarehouseWithoutVisibleLocation) {
      return [
        {
          warehouseId: warehouse.id,
          warehouseCode: warehouse.warehouseCode,
          warehouseName: warehouse.warehouseName,
          warehouseStatus: warehouse.status,
          locationId: '',
          locationCode: '-',
          locationName: warehouse.locations.length ? '无启用库位' : '未建库位',
          locationStatus: warehouse.status,
          status: warehouse.status
        }
      ];
    }
    return visibleLocations.map((location) => ({
      warehouseId: warehouse.id,
      warehouseCode: warehouse.warehouseCode,
      warehouseName: warehouse.warehouseName,
      warehouseStatus: warehouse.status,
      locationId: location.id,
      locationCode: location.locationCode,
      locationName: location.locationName,
      locationStatus: location.status,
      status: location.status
    }));
  })
);
const visibleWarehouseLocationCount = computed(() => warehouseRows.value.filter((row) => row.locationId).length);

function warehouseConfigStatusMatches(status: CommonStatus, filter: CommonStatus | 'ALL') {
  return filter === 'ALL' || status === filter;
}

function normalizeWarehouseOperatorKeyword(value?: string) {
  return String(value || '').trim().toLowerCase().replace(/[\s\-_./\\]+/g, '');
}

function isWarehouseOperator(operator: ProductionOperator) {
  const role = operator.role || '';
  const tokens = [
    role,
    operator.name,
    operator.accountId,
    operator.code,
    operator.pinyin,
    operator.pinyinInitials,
    ...(operator.keywords || [])
  ]
    .filter(Boolean)
    .map((value) => normalizeWarehouseOperatorKeyword(String(value)));
  return tokens.some((token) => token.includes('仓库') || token.includes('仓管') || token.includes('库管') || token.includes('cangguan'));
}

function cacheWarehouseOperators(operators: ProductionOperator[]) {
  operators.forEach((operator) => {
    warehouseOperatorCache[operator.code] = operator;
  });
}

async function searchWarehouseOperators(keyword = '') {
  const requestId = ++warehouseOperatorRequestSeq;
  warehouseOperatorLoading.value = true;
  try {
    const operators = await erpApi.productionOperators(keyword.trim());
    if (requestId !== warehouseOperatorRequestSeq) {
      return;
    }
    const warehouseOperators = operators.filter(isWarehouseOperator);
    cacheWarehouseOperators(warehouseOperators);
    warehouseOperatorOptions.value = warehouseOperators;
  } catch {
    if (requestId === warehouseOperatorRequestSeq) {
      warehouseOperatorOptions.value = [];
    }
  } finally {
    if (requestId === warehouseOperatorRequestSeq) {
      warehouseOperatorLoading.value = false;
    }
  }
}

function handleWarehouseOperatorSelectVisible(visible: boolean) {
  if (visible) {
    void searchWarehouseOperators('');
  }
}

function warehouseOperatorOptionLabel(operator: ProductionOperator) {
  return `${operator.name} / ${operator.accountId || operator.code} / ${operator.role}`;
}

function warehouseOperatorSnapshot(operator: ProductionOperator) {
  return `${operator.name}（${operator.accountId || operator.code} / ${operator.role}）`;
}

function requireWarehouseOperator(code: string, actionName: string) {
  const operator = warehouseOperatorCache[code];
  if (!operator || !isWarehouseOperator(operator)) {
    ElMessage.warning(`请选择${actionName}仓库确认人`);
    return undefined;
  }
  return operator;
}

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

function clampWarehouseWorkTableHeight(value: number) {
  return Math.min(warehouseWorkTableHeightLimits.max, Math.max(warehouseWorkTableHeightLimits.min, value));
}

function adjustWarehouseWorkTableHeight(key: WarehouseWorkTableKey, delta: number) {
  warehouseWorkTableHeights[key] = clampWarehouseWorkTableHeight(warehouseWorkTableHeights[key] + delta);
}

function resetWarehouseWorkTableHeight(key: WarehouseWorkTableKey) {
  warehouseWorkTableHeights[key] = warehouseWorkTableDefaultHeights[key];
}

function warehouseWorkTableHeightStyle(key: WarehouseWorkTableKey) {
  return `${warehouseWorkTableHeights[key]}px`;
}

function restoreWarehouseWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const rawValue = window.localStorage.getItem(warehouseWorkTableHeightStorageKey);
    if (!rawValue) {
      return;
    }
    const savedHeights = JSON.parse(rawValue) as Partial<Record<WarehouseWorkTableKey, number>>;
    warehouseWorkTableKeys.forEach((key) => {
      const savedHeight = Number(savedHeights[key]);
      if (Number.isFinite(savedHeight)) {
        warehouseWorkTableHeights[key] = clampWarehouseWorkTableHeight(savedHeight);
      }
    });
  } catch {
    // 本机 UI 偏好读取失败时使用默认高度，不影响仓库业务操作。
  }
}

function saveWarehouseWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      warehouseWorkTableHeightStorageKey,
      JSON.stringify({
        receipts: warehouseWorkTableHeights.receipts,
        shipments: warehouseWorkTableHeights.shipments,
        locations: warehouseWorkTableHeights.locations,
        transactions: warehouseWorkTableHeights.transactions,
        batchShipment: warehouseWorkTableHeights.batchShipment,
        notices: warehouseWorkTableHeights.notices
      })
    );
  } catch {
    // 本机 UI 偏好写入失败不阻断入库、发货或通知处理。
  }
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
      erpApi.warehouseNoticesPage('PENDING', { limit: Number(1), offset: Number(0) })
    ]);
    warehouses.value = warehouseResult;
    receipts.value = receiptResult;
    shipments.value = shipmentResult;
    selectedShipments.value = [];
    shipmentTableRef.value?.clearSelection();
    warehouseNoticeServerCounts.PENDING = noticeResult.totalCount;
    await loadTransactions();
  } catch (error) {
    warehouses.value = [];
    receipts.value = [];
    shipments.value = [];
    selectedShipments.value = [];
    batchShipmentRows.value = [];
    transactions.value = [];
    warehouseNotices.value = [];
    warehouseNoticeServerCounts.PENDING = 0;
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

async function refreshWarehousePage() {
  if (warehousePageRefreshing.value) {
    return;
  }
  warehousePageRefreshing.value = true;
  try {
    // 整页刷新同步订单下拉、待入库、待发货、仓库配置、库存流水和已打开的仓库通知。
    await queryWarehouseWork();
    if (noticeVisible.value) {
      await loadWarehouseNotices();
    }
  } finally {
    warehousePageRefreshing.value = false;
  }
}

async function handleScopeChange() {
  filters.orderNo = undefined;
  transactionPagination.page = 1;
  await queryWarehouseWork();
}

async function handleWarehouseOrderChange() {
  transactionPagination.page = 1;
  await queryWarehouseWork();
}

async function resetFilters() {
  filters.customerId = undefined;
  filters.orderNo = undefined;
  dateRange.value = [];
  transactionPagination.page = 1;
  await queryWarehouseWork();
}

async function loadTransactions() {
  try {
    const offset = (transactionPagination.page - 1) * transactionPagination.limit;
    const result = await erpApi.warehouseTransactionsPage({
      ...warehouseWorkParams(),
      transactionType: transactionType.value === 'ALL' ? undefined : transactionType.value,
      limit: transactionPagination.limit,
      offset
    });
    transactions.value = result.items;
    transactionPagination.totalCount = result.totalCount;
    transactionPagination.limit = result.limit;
    transactionPagination.page = Math.floor(result.offset / result.limit) + 1;
    const maxPage = Math.max(Math.ceil(result.totalCount / result.limit), 1);
    if (result.items.length === 0 && result.totalCount > 0 && transactionPagination.page > maxPage) {
      transactionPagination.page = maxPage;
      await loadTransactions();
    }
  } catch (error) {
    transactions.value = [];
    transactionPagination.totalCount = 0;
    ElMessage.error(error instanceof Error ? error.message : '库存流水加载失败，请确认后端服务和筛选条件');
  }
}

async function reloadTransactionsFromFirstPage() {
  transactionPagination.page = 1;
  await loadTransactions();
}

async function handleTransactionPageChange(page: number) {
  transactionPagination.page = page;
  await loadTransactions();
}

async function exportWarehouseWorkExcel() {
  if (warehouseWorkExporting.value) {
    return;
  }
  warehouseWorkExporting.value = true;
  try {
    // 仓库待处理导出复用当前筛选条件，只读取待入库和待发货列表，不确认入库、不发货、不写库存流水。
    await erpApi.downloadWarehouseWorkExport(warehouseWorkParams(), `仓库待处理_${formatFileDateTime()}.xlsx`);
    ElMessage.success('仓库待处理 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '仓库待处理 Excel 导出失败，请确认后端服务和筛选条件');
  } finally {
    warehouseWorkExporting.value = false;
  }
}

async function exportWarehouseConfigExcel() {
  if (warehouseConfigExporting.value) {
    return;
  }
  warehouseConfigExporting.value = true;
  try {
    // 仓库配置导出只读取仓库和库位基础资料，不新增库存批次、不写库存流水、不修改启停用状态。
    await erpApi.downloadWarehouseConfigExport(
      {
        status: warehouseConfigExportFilters.status,
        locationStatus: warehouseConfigExportFilters.locationStatus
      },
      `仓库配置_${formatFileDateTime()}.xlsx`
    );
    ElMessage.success('仓库配置 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '仓库配置 Excel 导出失败，请确认后端服务');
  } finally {
    warehouseConfigExporting.value = false;
  }
}

async function exportWarehouseTransactions() {
  if (transactionExporting.value) {
    return;
  }
  transactionExporting.value = true;
  try {
    const transactionOption = transactionOptions.find((item) => item.value === transactionType.value);
    const transactionLabel = transactionOption?.label || '全部';
    // 库存流水导出复用当前只读筛选条件，不新增、不合并、不修改库存批次或流水。
    await erpApi.downloadWarehouseTransactionsExport(
      {
        ...warehouseWorkParams(),
        transactionType: transactionType.value === 'ALL' ? undefined : transactionType.value
      },
      `库存流水_${transactionLabel}_${formatFileDateTime()}.xlsx`
    );
    ElMessage.success('库存流水 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '库存流水 Excel 导出失败，请确认后端服务和筛选条件');
  } finally {
    transactionExporting.value = false;
  }
}

function warehouseNoticeExportFilters() {
  return {
    status: warehouseNoticeStatusFilter.value === 'ALL' ? undefined : warehouseNoticeStatusFilter.value,
    customerId: warehouseNoticeFilters.customerId,
    orderNo: warehouseNoticeFilters.orderNo,
    partCode: warehouseNoticeFilters.partCode,
    keyword: warehouseNoticeFilters.keyword,
    noticeType: warehouseNoticeFilters.noticeType === 'ALL' ? undefined : warehouseNoticeFilters.noticeType,
    dateFrom: warehouseNoticeDateRange.value[0],
    dateTo: warehouseNoticeDateRange.value[1]
  };
}

function warehouseNoticeBaseFilters() {
  return {
    customerId: warehouseNoticeFilters.customerId,
    orderNo: warehouseNoticeFilters.orderNo,
    partCode: warehouseNoticeFilters.partCode,
    keyword: warehouseNoticeFilters.keyword,
    noticeType: warehouseNoticeFilters.noticeType === 'ALL' ? undefined : warehouseNoticeFilters.noticeType,
    dateFrom: warehouseNoticeDateRange.value[0],
    dateTo: warehouseNoticeDateRange.value[1]
  };
}

async function exportWarehouseNoticesExcel() {
  if (warehouseNoticeExporting.value) {
    return;
  }
  warehouseNoticeExporting.value = true;
  try {
    // 仓库通知导出只复用当前筛选条件，不确认通知、不触发库存处理。
    await erpApi.downloadWarehouseNoticesExport(warehouseNoticeExportFilters(), `仓库通知_${formatFileDateTime()}.xlsx`);
    ElMessage.success('仓库通知 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '仓库通知 Excel 导出失败，请确认后端服务和筛选条件');
  } finally {
    warehouseNoticeExporting.value = false;
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
    const status = warehouseNoticeStatusFilter.value === 'ALL' ? undefined : warehouseNoticeStatusFilter.value;
    const offset = (warehouseNoticePagination.page - 1) * warehouseNoticePagination.limit;
    const baseFilters = warehouseNoticeBaseFilters();
    const [result, allCount, pendingCount, acknowledgedCount] = await Promise.all([
      erpApi.warehouseNoticesPage(status, {
        ...baseFilters,
        limit: warehouseNoticePagination.limit,
        offset
      }),
      erpApi.warehouseNoticesPage(undefined, { ...baseFilters, limit: Number(1), offset: Number(0) }),
      erpApi.warehouseNoticesPage('PENDING', { ...baseFilters, limit: Number(1), offset: Number(0) }),
      erpApi.warehouseNoticesPage('ACKNOWLEDGED', { ...baseFilters, limit: Number(1), offset: Number(0) })
    ]);
    warehouseNotices.value = result.items;
    warehouseNoticePagination.totalCount = result.totalCount;
    warehouseNoticePagination.limit = result.limit;
    warehouseNoticePagination.page = Math.floor(result.offset / result.limit) + 1;
    warehouseNoticeServerCounts.ALL = allCount.totalCount;
    warehouseNoticeServerCounts.PENDING = pendingCount.totalCount;
    warehouseNoticeServerCounts.ACKNOWLEDGED = acknowledgedCount.totalCount;
    const maxPage = Math.max(Math.ceil(result.totalCount / result.limit), 1);
    if (result.items.length === 0 && result.totalCount > 0 && warehouseNoticePagination.page > maxPage) {
      warehouseNoticePagination.page = maxPage;
      await loadWarehouseNotices();
    }
  } catch (error) {
    warehouseNotices.value = [];
    warehouseNoticePagination.totalCount = 0;
    ElMessage.error(error instanceof Error ? error.message : '仓库通知加载失败，请确认后端服务');
  } finally {
    noticeLoading.value = false;
  }
}

async function openWarehouseNotices() {
  warehouseNoticeFilters.customerId = filters.customerId;
  warehouseNoticeFilters.orderNo = filters.orderNo || '';
  warehouseNoticeDateRange.value = [...dateRange.value];
  warehouseNoticeStatusFilter.value = pendingNoticeCount.value > 0 ? 'PENDING' : 'ALL';
  warehouseNoticePagination.page = 1;
  noticeVisible.value = true;
  await loadWarehouseNotices();
}

async function reloadWarehouseNoticesFromFirstPage() {
  warehouseNoticePagination.page = 1;
  await loadWarehouseNotices();
}

async function handleWarehouseNoticePageChange(page: number) {
  warehouseNoticePagination.page = page;
  await loadWarehouseNotices();
}

async function resetWarehouseNoticeFilters() {
  warehouseNoticeFilters.customerId = undefined;
  warehouseNoticeFilters.orderNo = '';
  warehouseNoticeFilters.partCode = '';
  warehouseNoticeFilters.keyword = '';
  warehouseNoticeFilters.noticeType = 'ALL';
  warehouseNoticeDateRange.value = [];
  warehouseNoticePagination.page = 1;
  warehouseNoticeStatusFilter.value = pendingNoticeCount.value > 0 ? 'PENDING' : 'ALL';
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
    stockNoticeForm.acknowledgedByCode = '';
    stockNoticeConfirmTime.value = formatDateTime(new Date());
    stockNoticeForm.handlingMode = requiresWithdrawStockReceipt(notice)
      ? 'STOCK'
      : handlingPlan?.handlingMode || 'NONE';
    stockNoticeForm.handlingQuantity = handlingPlan?.handlingQuantity ?? 0;
    stockNoticeForm.warehouseId = enabledWarehouses.value[0]?.id || '';
    stockNoticeForm.mergeConfirmed = false;
    stockNoticeForm.remark = handlingPlan?.remark || '';
    resetStockNoticeLocation();
    void searchWarehouseOperators('');
    stockNoticeVisible.value = true;
    return;
  }
  void searchWarehouseOperators('');
  acknowledgeVisible.value = true;
}

async function saveWarehouseNoticeAcknowledge(operatorCode: string) {
  if (guardDesktopWarehouseMutation('确认仓库通知')) {
    return;
  }
  const notice = activeWarehouseNotice.value;
  if (!notice) {
    return;
  }
  const warehouseOperator = requireWarehouseOperator(operatorCode, '通知');
  if (!warehouseOperator) {
    return;
  }
  acknowledgeSaving.value = true;
  try {
    await erpApi.acknowledgeWarehouseNotice(notice.id, {
      acknowledgedByCode: warehouseOperator.code,
      acknowledgedBy: warehouseOperatorSnapshot(warehouseOperator)
    });
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
  return notice.noticeType === 'TASK_WITHDRAWN' && Number(notice.afterQuantity ?? 0) > 0;
}

function requiresCustomerChangeHandling(notice: ProductionNotice) {
  return notice.noticeType === 'ORDER_CANCELLED' || notice.noticeType === 'QUANTITY_DECREASE';
}

function roundQuantityValue(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function customerChangeHandlingQuantityLimit(notice: ProductionNotice) {
  const beforeQuantity = Number(notice.beforeQuantity ?? 0);
  const afterQuantity = Number(notice.afterQuantity ?? 0);
  const deltaQuantity = Math.abs(Number(notice.deltaQuantity ?? 0));
  const plannedHandlingQuantity = Number(notice.handlingPlan?.handlingQuantity ?? 0);
  const reducedQuantity = beforeQuantity > afterQuantity ? beforeQuantity - afterQuantity : 0;
  return roundQuantityValue(Math.max(deltaQuantity, reducedQuantity, plannedHandlingQuantity, 0));
}

function stockNoticeDisplayQuantity(notice: ProductionNotice) {
  // 仓库通知展示客户变更时必须使用待处理数量，不能把变更后的订单数量当成待处理实物数量。
  if (requiresCustomerChangeHandling(notice) || requiresWithdrawStockReceipt(notice)) {
    return stockNoticeHandlingQuantityMax.value;
  }
  return Number(notice.afterQuantity ?? 0);
}

function handlingPlanText(notice: ProductionNotice) {
  const plan = notice.handlingPlan;
  if (!plan) {
    return '';
  }
  const quantityText = formatQuantity(plan.handlingQuantity ?? 0, notice.unit || '件');
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

function closeWarehouseStatusDialog() {
  if (saving.value) {
    ElMessage.warning('仓库状态正在保存，请等待保存完成');
    return;
  }
  warehouseStatusVisible.value = false;
  activeWarehouseStatusTarget.value = undefined;
}

function handleWarehouseStatusDialogBeforeClose(done: () => void) {
  if (saving.value) {
    ElMessage.warning('仓库状态正在保存，请等待保存完成');
    return;
  }
  activeWarehouseStatusTarget.value = undefined;
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
    stockNoticeForm.warehouseId = enabledWarehouses.value[0]?.id || '';
    resetStockNoticeLocation();
  }
  if (showCustomerChangeHandlingFields.value && stockNoticeHandlingQuantityMax.value > 0) {
    const nextQuantity = Number(stockNoticeForm.handlingQuantity ?? 0);
    if (nextQuantity <= 0 || nextQuantity > stockNoticeHandlingQuantityMax.value) {
      stockNoticeForm.handlingQuantity = stockNoticeHandlingQuantityMax.value;
    }
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
  const warehouseOperator = requireWarehouseOperator(stockNoticeForm.acknowledgedByCode, '通知');
  if (!warehouseOperator) {
    return;
  }
  if (showCustomerChangeHandlingFields.value && stockNoticeForm.handlingMode !== 'NONE' && stockNoticeForm.handlingQuantity <= 0) {
    ElMessage.warning('请填写处理数量');
    return;
  }
  if (
    showCustomerChangeHandlingFields.value &&
    stockNoticeForm.handlingMode !== 'NONE' &&
    stockNoticeHandlingQuantityMax.value > 0 &&
    stockNoticeForm.handlingQuantity > stockNoticeHandlingQuantityMax.value + 0.0001
  ) {
    ElMessage.warning(`处理数量不能超过本次客户变更数量 ${formatQuantity(stockNoticeHandlingQuantityMax.value, notice.unit || '件')}`);
    return;
  }
  if (showCustomerChangeHandlingFields.value && stockNoticeForm.handlingMode === 'NONE' && stockNoticeHandlingQuantityMax.value > 0 && !stockNoticeForm.remark.trim()) {
    ElMessage.warning('确认无实物处理时请填写备注说明');
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
      acknowledgedByCode: warehouseOperator.code,
      acknowledgedBy: warehouseOperatorSnapshot(warehouseOperator),
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
  receiptForm.warehouseId = enabledWarehouses.value[0]?.id || '';
  receiptForm.warehouseConfirmedByCode = '';
  receiptForm.remark = '';
  resetLocation();
  void searchWarehouseOperators('');
  confirmVisible.value = true;
}

function defaultShipmentQuantity(row: WarehouseShipment) {
  const suggestedQuantity = Number(row.suggestedShipmentQuantity ?? 0);
  if (suggestedQuantity > 0) {
    return suggestedQuantity;
  }
  if (row.remainingQuantity === undefined || row.remainingQuantity === null) {
    return Number(row.quantity ?? 0);
  }
  const remainingQuantity = Number(row.remainingQuantity ?? 0);
  return remainingQuantity > 0 ? Math.min(Number(row.quantity ?? 0), remainingQuantity) : 0;
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
    quantity: Number(source.quantity ?? 0),
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
    drawingDate: source.drawingDate || targetLine.drawingDate,
    drawingStatus: source.drawingStatus || targetLine.drawingStatus,
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
      .filter((item) => item.inventorySourceType === 'STOCK' && Number(item.quantity ?? 0) > 0 && !existingIds.has(item.id))
      .sort(
        (a, b) =>
          Number(a.quantity ?? 0) - Number(b.quantity ?? 0) ||
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
  shipmentForm.warehouseConfirmedByCode = '';
  shipmentForm.salesConfirmedBy = '';
  shipmentForm.overShipmentReason = '';
  shipmentForm.remark = '';
  void searchWarehouseOperators('');
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
  batchShipmentForm.warehouseConfirmedByCode = '';
  batchShipmentForm.salesConfirmedBy = '';
  batchShipmentForm.overShipmentReason = '';
  void searchWarehouseOperators('');
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
  batchShipmentForm.warehouseConfirmedByCode = '';
  batchShipmentForm.salesConfirmedBy = '';
  batchShipmentForm.overShipmentReason = '';
  void searchWarehouseOperators('');
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
  receiptForm.warehouseConfirmedByCode = '';
  receiptForm.remark = '';
}

function resetShipmentDialog() {
  activeShipment.value = undefined;
  shipmentForm.shipmentQuantity = 0;
  shipmentForm.warehouseConfirmedByCode = '';
  shipmentForm.salesConfirmedBy = '';
  shipmentForm.overShipmentReason = '';
  shipmentForm.remark = '';
}

function resetBatchShipmentDialog() {
  if (!batchShipmentVisible.value) {
    batchShipmentIsOrderMode.value = false;
    batchShipmentRows.value = [];
    batchShipmentForm.warehouseConfirmedByCode = '';
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

function drawingTitle(row: Pick<WarehouseReceipt | WarehouseShipment | WarehouseTransaction, 'drawingNo' | 'drawingVersion' | 'drawingDate' | 'drawingStatus'>) {
  return [row.drawingNo || '未填写图号', row.drawingVersion, row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ');
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

function showMobileScanReserved() {
  ElMessage.info('扫码入口已预留，第一阶段暂不启用');
}

function guardDesktopWarehouseMutation(actionLabel: string) {
  const desktopOnlyActions = ['新增仓库', '编辑仓库', '删除仓库', '停用仓库', '启用仓库', '新增库位', '编辑库位', '删除库位', '停用库位', '启用库位'];
  if (!isMobileLayout.value || !desktopOnlyActions.includes(actionLabel)) {
    return false;
  }
  ElMessage.warning(`手机端可处理入库、发货和仓库通知，${actionLabel}请在电脑端操作`);
  return true;
}

function openWarehouseDialog() {
  if (guardDesktopWarehouseMutation('新增仓库')) {
    return;
  }
  warehouseEditId.value = '';
  warehouseForm.warehouseCode = '';
  warehouseForm.warehouseName = '';
  warehouseVisible.value = true;
}

function openEditWarehouseDialog(row: WarehouseLocationRow) {
  if (guardDesktopWarehouseMutation('编辑仓库')) {
    return;
  }
  warehouseEditId.value = row.warehouseId;
  warehouseForm.warehouseCode = row.warehouseCode;
  warehouseForm.warehouseName = row.warehouseName;
  warehouseVisible.value = true;
}

function openLocationDialog() {
  if (guardDesktopWarehouseMutation('新增库位')) {
    return;
  }
  if (!enabledWarehouses.value.length) {
    ElMessage.warning('请先新增或启用仓库');
    return;
  }
  locationEditId.value = '';
  locationForm.warehouseId = enabledWarehouses.value[0]?.id || '';
  locationForm.locationCode = '';
  locationForm.locationName = '';
  locationVisible.value = true;
}

function openEditLocationDialog(row: WarehouseLocationRow) {
  if (guardDesktopWarehouseMutation('编辑库位')) {
    return;
  }
  if (!row.locationId) {
    ElMessage.warning('该仓库还没有库位可编辑');
    return;
  }
  locationEditId.value = row.locationId;
  locationForm.warehouseId = row.warehouseId;
  locationForm.locationCode = row.locationCode;
  locationForm.locationName = row.locationName;
  locationVisible.value = true;
}

async function saveWarehouse() {
  const isEdit = Boolean(warehouseEditId.value);
  if (guardDesktopWarehouseMutation(isEdit ? '编辑仓库' : '新增仓库')) {
    return;
  }
  if (saving.value) {
    return;
  }
  const warehouseCode = warehouseForm.warehouseCode.trim();
  const warehouseName = warehouseForm.warehouseName.trim();
  if (isEdit && !warehouseCode) {
    ElMessage.warning('请填写仓库编码');
    return;
  }
  if (!warehouseName) {
    ElMessage.warning('请填写仓库名称');
    return;
  }

  saving.value = true;
  try {
    if (isEdit) {
      await erpApi.updateWarehouse(warehouseEditId.value, {
        warehouseCode,
        warehouseName
      });
      ElMessage.success('仓库已保存');
    } else {
      await erpApi.createWarehouse({
        warehouseCode: warehouseCode || undefined,
        warehouseName
      });
      ElMessage.success('仓库已新增');
    }
    warehouseVisible.value = false;
    warehouseEditId.value = '';
    await queryWarehouseWork();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : isEdit ? '仓库保存失败' : '仓库新增失败');
  } finally {
    saving.value = false;
  }
}

async function saveLocation() {
  const isEdit = Boolean(locationEditId.value);
  if (guardDesktopWarehouseMutation(isEdit ? '编辑库位' : '新增库位')) {
    return;
  }
  if (saving.value) {
    return;
  }
  const locationCode = locationForm.locationCode.trim();
  const locationName = locationForm.locationName.trim();
  if (!locationForm.warehouseId || !locationCode) {
    ElMessage.warning('请选择仓库并填写库位编码');
    return;
  }

  saving.value = true;
  try {
    if (isEdit) {
      await erpApi.updateWarehouseLocation(locationForm.warehouseId, locationEditId.value, {
        locationCode,
        locationName: locationName || undefined
      });
      ElMessage.success('库位已保存');
    } else {
      await erpApi.createWarehouseLocation(locationForm.warehouseId, {
        locationCode,
        locationName: locationName || undefined
      });
      ElMessage.success('库位已新增');
    }
    locationVisible.value = false;
    locationEditId.value = '';
    await queryWarehouseWork();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : isEdit ? '库位保存失败' : '库位新增失败');
  } finally {
    saving.value = false;
  }
}

async function toggleWarehouseStatus(row: WarehouseLocationRow) {
  const nextStatus: CommonStatus = row.warehouseStatus === 'ENABLED' ? 'DISABLED' : 'ENABLED';
  const actionLabel = nextStatus === 'ENABLED' ? '启用仓库' : '停用仓库';
  if (guardDesktopWarehouseMutation(actionLabel) || saving.value) {
    return;
  }
  activeWarehouseStatusTarget.value = {
    type: 'warehouse',
    warehouseId: row.warehouseId,
    nextStatus,
    title: `仓库 ${row.warehouseName} / ${row.warehouseCode}`,
    actionLabel,
    warning:
      nextStatus === 'ENABLED'
        ? '启用后该仓库可重新作为后续入库、转库存和发货调整的候选；已随仓库停用的库位不会自动恢复，需要逐个启用。历史库存、流水和订单来源继续保留。'
        : '停用仓库会同步停用该仓库下仍启用的库位，避免后续入库或转库存误选；历史库存、流水和订单来源仍会显示原仓库和库位名称。'
  };
  warehouseStatusVisible.value = true;
}

async function confirmWarehouseStatusTarget() {
  const target = activeWarehouseStatusTarget.value;
  if (!target || saving.value) {
    return;
  }
  if (guardDesktopWarehouseMutation(target.actionLabel)) {
    return;
  }
  saving.value = true;
  try {
    if (target.type === 'warehouse') {
      // 仓库停用只影响后续选择，历史库存批次和库存流水继续保留。
      await erpApi.updateWarehouse(target.warehouseId, { status: target.nextStatus });
      ElMessage.success(target.nextStatus === 'ENABLED' ? '仓库已启用' : '仓库已停用');
    } else if (target.locationId) {
      // 库位停用只影响后续入库选择，不修改历史来源记录。
      await erpApi.updateWarehouseLocation(target.warehouseId, target.locationId, { status: target.nextStatus });
      ElMessage.success(target.nextStatus === 'ENABLED' ? '库位已启用' : '库位已停用');
    }
    warehouseStatusVisible.value = false;
    activeWarehouseStatusTarget.value = undefined;
    await queryWarehouseWork();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '仓库/库位状态保存失败');
  } finally {
    saving.value = false;
  }
}

async function toggleLocationStatus(row: WarehouseLocationRow) {
  if (!row.locationId) {
    return;
  }
  const nextStatus: CommonStatus = row.locationStatus === 'ENABLED' ? 'DISABLED' : 'ENABLED';
  const actionLabel = nextStatus === 'ENABLED' ? '启用库位' : '停用库位';
  if (guardDesktopWarehouseMutation(actionLabel) || saving.value) {
    return;
  }
  activeWarehouseStatusTarget.value = {
    type: 'location',
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    nextStatus,
    title: `库位 ${row.locationName} / ${row.locationCode}`,
    actionLabel,
    warning:
      nextStatus === 'ENABLED'
        ? '启用后该库位可重新作为后续入库和转库存候选。历史库存、流水和订单来源继续保留。'
        : '停用后不得作为新入库或转库存候选；已有库存溯源仍会展示该库位，并允许按业务规则盘点或发货处理。'
  };
  warehouseStatusVisible.value = true;
}

function requestDeleteWarehouse(row: WarehouseLocationRow) {
  if (guardDesktopWarehouseMutation('删除仓库')) {
    return;
  }
  activeWarehouseDeleteTarget.value = {
    type: 'warehouse',
    warehouseId: row.warehouseId,
    title: `仓库 ${row.warehouseName} / ${row.warehouseCode}`,
    warning: '只有没有库存批次、库存流水和库位历史的空仓库才会被删除；已有历史记录请改用停用。'
  };
  warehouseDeleteVisible.value = true;
}

function requestDeleteLocation(row: WarehouseLocationRow) {
  if (guardDesktopWarehouseMutation('删除库位')) {
    return;
  }
  if (!row.locationId) {
    ElMessage.warning('该仓库还没有库位可删除');
    return;
  }
  activeWarehouseDeleteTarget.value = {
    type: 'location',
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    title: `库位 ${row.locationName} / ${row.locationCode}`,
    warning: '只有没有库存批次或库存流水的空库位才会被删除；已有历史记录请改用停用。'
  };
  warehouseDeleteVisible.value = true;
}

async function confirmDeleteWarehouseTarget() {
  const target = activeWarehouseDeleteTarget.value;
  if (!target || saving.value) {
    return;
  }
  if (guardDesktopWarehouseMutation(target.type === 'warehouse' ? '删除仓库' : '删除库位')) {
    return;
  }
  saving.value = true;
  try {
    if (target.type === 'warehouse') {
      await erpApi.deleteWarehouse(target.warehouseId);
      ElMessage.success('仓库已删除');
    } else if (target.locationId) {
      await erpApi.deleteWarehouseLocation(target.warehouseId, target.locationId);
      ElMessage.success('库位已删除');
    }
    warehouseDeleteVisible.value = false;
    activeWarehouseDeleteTarget.value = undefined;
    await queryWarehouseWork();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败');
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
  const warehouseOperator = requireWarehouseOperator(receiptForm.warehouseConfirmedByCode, '入库');
  if (!warehouseOperator) {
    return;
  }
  saving.value = true;
  try {
    await erpApi.confirmReceipt(activeReceipt.value.id, {
      warehouseId: receiptForm.warehouseId,
      locationId: receiptForm.locationId,
      warehouseConfirmedByCode: warehouseOperator.code,
      warehouseConfirmedBy: warehouseOperatorSnapshot(warehouseOperator),
      remark: receiptForm.remark || undefined
    });
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
  const warehouseOperator = requireWarehouseOperator(shipmentForm.warehouseConfirmedByCode, '发货');
  if (!warehouseOperator) {
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
      warehouseConfirmedByCode: warehouseOperator.code,
      warehouseConfirmedBy: warehouseOperatorSnapshot(warehouseOperator),
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
  const warehouseOperator = requireWarehouseOperator(batchShipmentForm.warehouseConfirmedByCode, '发货');
  if (!warehouseOperator) {
    return;
  }
  const invalidQuantityRow = batchShipmentRows.value.find(
    (row) => Number(row.currentShipmentQuantity ?? 0) < 0 || Number(row.currentShipmentQuantity ?? 0) > Number(row.quantity ?? 0)
  );
  if (invalidQuantityRow) {
    ElMessage.warning(`${invalidQuantityRow.batchNo} 本次发货数量不能大于当前库存数量`);
    return;
  }
  const batchShipments = batchShipmentRows.value
    .map((row) => ({
      batchId: row.id,
      orderLineId: row.isStockOverShipment ? row.targetOrderLineId || row.orderLineId : row.orderLineId,
      shipmentQuantity: Number(row.currentShipmentQuantity ?? 0)
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
      warehouseConfirmedByCode: warehouseOperator.code,
      warehouseConfirmedBy: warehouseOperatorSnapshot(warehouseOperator),
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
    batchShipmentForm.warehouseConfirmedByCode = '';
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
    quantityByUnit.set(row.unit, (quantityByUnit.get(row.unit) ?? 0) + Number(row[field] ?? 0));
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
    quantityByUnit.set(row.unit, (quantityByUnit.get(row.unit) ?? 0) + Number(row[field] ?? 0));
  });
  return Array.from(quantityByUnit.entries())
    .map(([unit, quantity]) => formatQuantity(quantity, unit))
    .join(' / ');
}

function formatBatchShipmentOverText(rows: EditableWarehouseShipment[]) {
  const lineMap = new Map<string, { current: number; remaining: number; unit: string }>();
  rows.forEach((row) => {
    const lineKey = row.orderLineId || `${row.partCode}-${row.partName}-${row.unit}`;
    const current = Number(row.currentShipmentQuantity ?? 0);
    const existing = lineMap.get(lineKey);
    if (existing) {
      existing.current += current;
      return;
    }
    lineMap.set(lineKey, {
      current,
      remaining: Number(row.remainingQuantity ?? 0),
      unit: row.unit
    });
  });

  const overByUnit = new Map<string, number>();
  lineMap.forEach((item) => {
    const overQuantity = Math.max(item.current - item.remaining, 0);
    if (overQuantity > 0) {
      overByUnit.set(item.unit, (overByUnit.get(item.unit) ?? 0) + overQuantity);
    }
  });
  return Array.from(overByUnit.entries())
    .map(([unit, quantity]) => formatQuantity(quantity, unit))
    .join(' / ');
}

function shipmentQuantityAdjustmentText(row: EditableWarehouseShipment) {
  const currentQuantity = Number(row.currentShipmentQuantity ?? 0);
  const suggestedQuantity = Number(row.suggestedShipmentQuantity ?? 0);
  const remainingQuantity = Number(row.remainingQuantity ?? 0);
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
      ? formatQuantityByUnitPreview(order.pendingProductionReplenishmentQuantityByUnit)
      : formatQuantity(order.pendingProductionReplenishmentQuantity ?? 0, order.pendingProductionReplenishmentUnit || order.unit);
    return `生产报废补单待确认 ${order.pendingProductionReplenishmentLineCount ?? 0} 个 / ${quantityText}`;
  }
  const quantityText = order.unresolvedShortageQuantityByUnit?.length
    ? formatQuantityByUnitPreview(order.unresolvedShortageQuantityByUnit)
    : formatQuantity(order.unresolvedShortageQuantity ?? 0, order.unresolvedShortageUnit || order.unit);
  return `需补单 ${order.unresolvedShortageLineCount ?? 0} 个 / ${quantityText}`;
}

function formatQuantityByUnitPreview(rows?: Array<{ quantity: number; unit: string }>) {
  const values = (rows || []).map((row) => formatQuantity(row.quantity, row.unit)).filter(Boolean);
  if (values.length === 0) {
    return '-';
  }
  const preview = values.filter((_, index) => index < 3).join('、');
  return values.length > 3 ? `${preview} 等 ${values.length} 个单位` : preview;
}

function formatLongTextPreview(value?: string | null, maxLength = 32, emptyText = '-') {
  const text = String(value || '').trim();
  if (!text) {
    return emptyText;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function longTextTooltipText(value?: string | null) {
  return String(value || '').trim() || '-';
}

function warehouseNoticeReasonPreview(notice: ProductionNotice) {
  return formatLongTextPreview(notice.reason, 42, '-');
}

function warehouseNoticeReasonTitle(notice: ProductionNotice) {
  return longTextTooltipText(notice.reason);
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

watch(
  () => warehouseWorkTableKeys.map((key) => warehouseWorkTableHeights[key]),
  () => saveWarehouseWorkTableHeights()
);

onMounted(async () => {
  restoreWarehouseWorkTableHeights();
  applyRouteOrderFilter();
  await refreshWarehousePage();
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

.warehouse-table-height-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.warehouse-config-export-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 0 14px;
}

.warehouse-config-export-title {
  font-weight: 600;
  color: #1f2937;
}

.warehouse-config-export-filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #475569;
  font-size: 13px;
}

.warehouse-table-height-label {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
}

.warehouse-dialog-list-toolbar {
  display: flex;
  justify-content: flex-end;
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

.notice-quantity-limit {
  margin-left: 8px;
  color: #64748b;
  font-size: 12px;
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

.batch-shipment-table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0 10px;
}

.batch-shipment-table-toolbar strong {
  color: #0f172a;
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

.warehouse-notice-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 12px;
  color: #64748b;
  font-size: 13px;
}

.warehouse-transaction-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 12px;
  color: #64748b;
  font-size: 13px;
}

.table-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 10px;
}

.warehouse-shipment-actions {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.warehouse-shipment-action-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
  line-height: 20px;
}

.warehouse-shipment-action-label {
  flex: 0 0 34px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 20px;
}

.warehouse-shipment-actions :deep(.el-button) {
  margin-left: 0;
  padding: 0;
}

.warehouse-config-actions {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.warehouse-config-action-group {
  display: flex;
  align-items: center;
  gap: 4px 8px;
  flex-wrap: wrap;
  min-width: 0;
  line-height: 20px;
}

.warehouse-config-action-group .el-button {
  margin-left: 0;
}

.warehouse-config-action-label {
  min-width: 32px;
  color: #64748b;
  font-size: 12px;
}

.delete-confirm-body {
  display: grid;
  gap: 12px;
}

.delete-confirm-body p {
  margin: 0;
  color: #334155;
  line-height: 22px;
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
