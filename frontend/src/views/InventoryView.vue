<template>
  <section class="page">
    <div class="page-header">
      <div class="inventory-page-title">
        <h2 class="page-title">库存</h2>
        <p class="page-subtitle">查看库存使用率、零件库存汇总和逐批库存溯源。</p>
      </div>
      <div class="page-actions">
        <RouterLink to="/inventory/materials">
          <el-button>零件基础库</el-button>
        </RouterLink>
        <RouterLink to="/inventory/model-boms">
          <el-button>机型零件包</el-button>
        </RouterLink>
        <el-button :loading="loading" @click="loadInventory">刷新</el-button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">库存批次</div>
        <div class="stat-value">{{ inventory.length }} 批</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">零件种类</div>
        <div class="stat-value">{{ inventorySummary.length }} 种</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">平均使用率</div>
        <div class="stat-value">{{ averageInventoryUsageRateText }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">可用数量</div>
        <div class="stat-value">{{ availableQuantityText }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">有库存仓库</div>
        <div class="stat-value">{{ stockedWarehouseCount }} 个</div>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>零件关键字 / 客户 / 订单 / 任务 / 批次</label>
        <el-autocomplete
          v-model="filters.keyword"
          :fetch-suggestions="queryMaterialSuggestions"
          value-key="value"
          placeholder="零件编码 / 名称 / 拼音 / 客户 / 订单 / 任务 / 批次"
          style="width: 330px"
          clearable
          @select="selectMaterialSuggestion"
        >
          <template #default="{ item }">
            <MaterialSuggestionOption
              :item="item"
              show-available
              :available-scope-label="selectedWarehouseName || '全部仓库'"
            />
          </template>
        </el-autocomplete>
      </div>
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect v-model="filters.customerId" placeholder="全部客户" width="220px" />
      </div>
      <div class="filter-field">
        <label>仓库</label>
        <el-select v-model="filters.warehouseId" clearable placeholder="全部仓库" style="width: 190px">
          <el-option v-for="item in warehouses" :key="item.id" :label="item.warehouseName" :value="item.id" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>订单号</label>
        <el-input v-model="filters.orderNo" placeholder="订单号 / 生产来源订单号" style="width: 220px" clearable />
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" clearable placeholder="全部状态" style="width: 150px">
          <el-option label="可用" value="AVAILABLE" />
          <el-option label="已使用" value="USED" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="loadInventory">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <div v-if="inventoryQueryNoticeRows.length" class="inventory-query-notice">
      <strong>当前查询库存</strong>
      <span v-for="row in inventoryQueryNoticeRows" :key="`${row.partCode}-${row.unit}`">
        {{ row.partName }}（{{ row.partCode }}）在{{ selectedWarehouseName || '全部仓库' }}当前可用库存为
        {{ formatQuantity(row.availableQuantity, row.unit) }}
      </span>
    </div>

    <div class="table-card desktop-table material-memory-card">
      <div class="section-heading material-memory-heading">
        <div>
          <strong>库存使用总览</strong>
          <span>查看零件搜索记忆、订单使用和库存参考；编辑只改搜索记忆，停用只影响后续搜索推荐。</span>
        </div>
        <div class="material-memory-toolbar">
          <RouterLink to="/inventory/materials">
            <el-button type="primary" plain>打开零件基础库</el-button>
          </RouterLink>
          <RouterLink to="/inventory/model-boms">
            <el-button plain>机型零件包</el-button>
          </RouterLink>
          <el-input v-model="materialMemoryFilters.keyword" clearable placeholder="编码 / 名称 / 拼音 / 规格 / 客户 / 订单 / 图号" style="width: 320px" @keyup.enter="searchMaterialMemory" />
          <el-select v-model="materialMemoryFilters.status" placeholder="状态" style="width: 120px" @change="searchMaterialMemory">
            <el-option label="启用" value="ENABLED" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
          <el-button :loading="materialMemoryLoading" @click="searchMaterialMemory">查询</el-button>
        </div>
      </div>
      <el-table v-loading="materialMemoryLoading" :data="materialMemory" max-height="260">
        <el-table-column prop="partCode" label="零件编码" min-width="160" />
        <el-table-column prop="partName" label="零件名称" min-width="180" />
        <el-table-column prop="unit" label="单位" width="80" />
        <el-table-column prop="partSpecification" label="规格" min-width="180">
          <template #default="{ row }">{{ row.partSpecification || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
              {{ row.status === 'ENABLED' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="库存" width="130">
          <template #default="{ row }">{{ formatQuantity(row.availableQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="库存使用率" width="130">
          <template #default="{ row }">
            <el-tag :type="materialMemoryUsageRateTagType(row)" effect="plain">
              {{ formatMaterialMemoryUsageRate(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="订单使用" min-width="220">
          <template #default="{ row }">
            <div>{{ row.orderLineUsageCount }} 次</div>
            <div v-if="row.lastOrderNo" class="cell-subtext">
              最近 {{ row.lastOrderNo }} / {{ row.lastCustomerName || '-' }} / {{ row.lastOrderDate || '-' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="Boolean(materialMemoryOperationSavingId)" @click="openMaterialMemoryDialog(row)">编辑搜索记忆</el-button>
            <el-button
              v-if="row.status === 'ENABLED'"
              link
              type="danger"
              :loading="materialMemoryDisableSaving && materialMemoryOperationSavingId === row.id"
              :disabled="Boolean(materialMemoryOperationSavingId) || materialMemoryDisableDialogVisible"
              @click="disableMaterialMemory(row)"
            >
              停用记忆
            </el-button>
            <el-button
              v-else
              link
              type="success"
              :loading="materialMemoryOperationSavingId === row.id"
              :disabled="Boolean(materialMemoryOperationSavingId)"
              @click="enableMaterialMemory(row)"
            >
              启用记忆
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-pagination-row">
        <span>
          第 {{ materialMemoryPagination.page }} 页，已显示 {{ materialMemory.length }} /
          {{ materialMemoryPagination.total }} 条零件搜索记忆
        </span>
        <el-pagination
          background
          layout="prev, pager, next"
          :current-page="materialMemoryPagination.page"
          :page-size="materialMemoryPagination.limit"
          :total="materialMemoryPagination.total"
          :disabled="materialMemoryLoading"
          @current-change="handleMaterialMemoryPageChange"
        />
      </div>
    </div>

    <div class="table-card desktop-table summary-table-card">
      <div class="section-heading">
        <strong>零件库存汇总</strong>
        <span>按零件汇总使用率、可用、预占、订单库存、备货库存和仓库分布。</span>
      </div>
      <el-table v-loading="loading" :data="inventorySummary" max-height="260">
        <el-table-column prop="partCode" label="零件编码" min-width="150" />
        <el-table-column label="零件名称" min-width="210">
          <template #default="{ row }">
            <div class="cell-main">{{ row.partName }}</div>
            <el-tag v-if="isZeroInventorySummaryRow(row)" size="small" type="info" effect="plain">
              当前范围 0 库存
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="库存使用率" width="130">
          <template #default="{ row }">
            <el-tag :type="inventoryUsageRateTagType(row)" effect="plain">
              {{ formatInventoryUsageRate(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="当前可用库存" width="150">
          <template #default="{ row }">{{ formatQuantity(row.availableQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="已预占" width="120">
          <template #default="{ row }">{{ formatQuantity(row.reservedQuantity || 0, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="订单库存" width="140">
          <template #default="{ row }">{{ formatQuantity(row.orderInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="备货库存" width="140">
          <template #default="{ row }">{{ formatQuantity(row.stockInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="备货来源构成" min-width="240">
          <template #default="{ row }">
            <div class="stock-source-breakdown">
              <el-tag size="small" effect="plain">正常 {{ formatQuantity(row.normalOrderStockQuantity || 0, row.unit) }}</el-tag>
              <el-tag size="small" effect="plain" type="warning">取消 {{ formatQuantity(row.cancelledOrderStockQuantity || 0, row.unit) }}</el-tag>
              <el-tag size="small" effect="plain" type="info">变更 {{ formatQuantity(row.customerChangeStockQuantity || 0, row.unit) }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="累计数量" width="130">
          <template #default="{ row }">{{ formatQuantity(row.totalQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="已出库 / 已使用" width="150">
          <template #default="{ row }">{{ formatQuantity(row.usedQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="批次 / 仓库" width="140">
          <template #default="{ row }">{{ row.batchCount }} 批 / {{ row.warehouseCount }} 个</template>
        </el-table-column>
        <el-table-column label="仓库分布" min-width="240">
          <template #default="{ row }">
            <div class="warehouse-summary">
              <el-tag
                v-for="warehouse in row.warehouses"
                :key="warehouse.warehouseId"
                effect="plain"
                size="small"
              >
                {{ warehouse.warehouseName }} {{ formatQuantity(warehouse.availableQuantity, row.unit) }}
              </el-tag>
              <span v-if="!row.warehouses.length" class="muted">无可用库存</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="库存来源/图纸" width="140">
          <template #default="{ row }">
            <el-button link type="primary" @click="openSummarySourceDetails(row)">
              {{ summarySourceDetailsButtonText(row) }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list summary-mobile-list">
      <article
        v-for="row in inventorySummary"
        :key="`${row.partCode}-${row.partName}-${row.unit}`"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileInventoryCardExpanded(summaryCardKey(row)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.partName }}</strong>
            <small>{{ row.partCode }}</small>
            <el-tag v-if="isZeroInventorySummaryRow(row)" size="small" type="info" effect="plain">
              当前范围 0 库存
            </el-tag>
          </div>
          <div class="mobile-card-header-actions">
            <el-button link type="primary" @click.stop="toggleMobileInventoryCard(summaryCardKey(row))">
              {{ isMobileInventoryCardExpanded(summaryCardKey(row)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>使用率 {{ formatInventoryUsageRate(row) }}</span>
          <span>可用 {{ formatQuantity(row.availableQuantity, row.unit) }}</span>
          <span>预占 {{ formatQuantity(row.reservedQuantity || 0, row.unit) }}</span>
          <span>{{ row.batchCount }} 批 / {{ row.warehouseCount }} 仓</span>
        </div>
        <div v-show="isMobileInventoryCardExpanded(summaryCardKey(row))" class="mobile-card-fields">
          <div class="mobile-field">
            <label>库存使用率</label>
            <strong>{{ formatInventoryUsageRate(row) }}</strong>
          </div>
          <div class="mobile-field">
            <label>当前可用库存</label>
            <strong>{{ formatQuantity(row.availableQuantity, row.unit) }}</strong>
          </div>
          <div class="mobile-field">
            <label>已预占</label>
            <span>{{ formatQuantity(row.reservedQuantity || 0, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>批次 / 仓库</label>
            <span>{{ row.batchCount }} 批 / {{ row.warehouseCount }} 个</span>
          </div>
          <div class="mobile-field">
            <label>订单库存</label>
            <span>{{ formatQuantity(row.orderInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>备货库存</label>
            <span>{{ formatQuantity(row.stockInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field mobile-full">
            <label>备货来源构成</label>
            <span>{{ stockSourceBreakdownText(row) }}</span>
          </div>
          <div class="mobile-field">
            <label>累计数量</label>
            <span>{{ formatQuantity(row.totalQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>已出库 / 已使用</label>
            <span>{{ formatQuantity(row.usedQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field mobile-full">
            <label>仓库分布</label>
            <span>{{ warehouseSummaryText(row) }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button link type="primary" @click="openSummarySourceDetails(row)">
            {{ summarySourceDetailsButtonText(row) }}
          </el-button>
        </div>
      </article>
    </div>

    <div class="table-card desktop-table">
      <div class="section-heading">
        <strong>库存溯源</strong>
        <span>逐批查看库存来源、占用记录、仓库库位，并进行盘点调整。</span>
      </div>
      <el-table v-loading="loading" :data="inventory" max-height="max(300px, calc(100vh - 390px))">
        <el-table-column label="批次号" min-width="230">
          <template #default="{ row }">
            <div class="cell-main">{{ row.batchNo }}</div>
            <el-tag class="source-tag" :type="inventorySourceTagType(row)" size="small" effect="plain">
              {{ inventorySourceLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="partCode" label="零件编码" width="140" />
        <el-table-column prop="partName" label="零件名称" min-width="180" />
        <el-table-column label="图纸" min-width="190">
          <template #default="{ row }">
            <div class="cell-main">{{ drawingInfoText(row) }}</div>
            <DrawingPreviewLink
              :file-name="row.drawingFileName"
              :file-url="row.drawingFileUrl"
              link-text="打开图纸"
              :title="`${row.partName || row.partCode} 库存图纸`"
            />
          </template>
        </el-table-column>
        <el-table-column label="可用 / 账面" width="145">
          <template #default="{ row }">
            <div>{{ formatQuantity(batchAvailableQuantity(row), row.unit) }}</div>
            <div class="cell-subtext">账面 {{ formatQuantity(row.quantity, row.unit) }}</div>
            <div v-if="row.reservedQuantity" class="cell-subtext warning-text">
              预占 {{ formatQuantity(row.reservedQuantity, row.unit) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="170">
          <template #default="{ row }">{{ row.warehouseName }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column label="客户" min-width="180">
          <template #default="{ row }">{{ customerDisplay(row) }}</template>
        </el-table-column>
        <el-table-column label="来源订单" min-width="180">
          <template #default="{ row }">
            <OrderNoLink v-if="inventorySourceOrderNo(row)" :order-no="inventorySourceOrderNo(row)" />
            <span v-else class="muted">备货库存</span>
            <div v-if="row.inventorySourceType === 'STOCK' && inventorySourceOrderNo(row)" class="cell-subtext">生产来源订单</div>
          </template>
        </el-table-column>
        <el-table-column label="生产任务" min-width="220">
          <template #default="{ row }">
            <div class="cell-main">{{ row.sourceProductionTaskNo || '-' }}</div>
            <div v-if="taskRelationText(row)" class="cell-subtext">{{ taskRelationText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="生产日期" width="120">
          <template #default="{ row }">{{ formatDate(row.productionDate) }}</template>
        </el-table-column>
        <el-table-column label="订单日期" width="120">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="120">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <StatusTag :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openSourceDetails(row.partCode, row.unit, 'ALL')">
              库存来源
            </el-button>
            <el-button link type="primary" @click="openReservationDialog(row)">
              预占记录
            </el-button>
            <el-button link type="primary" :disabled="!canAdjustBatch(row)" :title="adjustmentDisabledReason(row)" @click="openAdjustDialog(row)">
              盘点调整
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list">
      <article
        v-for="batch in inventory"
        :key="batch.id"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileInventoryCardExpanded(batchCardKey(batch)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ batch.partName }}</strong>
            <small>{{ batch.batchNo }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <StatusTag :value="batch.status" compact />
            <el-button link type="primary" @click.stop="toggleMobileInventoryCard(batchCardKey(batch))">
              {{ isMobileInventoryCardExpanded(batchCardKey(batch)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>可用 {{ formatQuantity(batchAvailableQuantity(batch), batch.unit) }}</span>
          <span>账面 {{ formatQuantity(batch.quantity, batch.unit) }}</span>
          <span>{{ batch.warehouseName }} / {{ batch.locationName || '-' }}</span>
        </div>
        <div v-show="isMobileInventoryCardExpanded(batchCardKey(batch))" class="mobile-card-fields">
          <div class="mobile-field">
            <label>状态</label>
            <span><StatusTag :value="batch.status" /></span>
          </div>
          <div class="mobile-field">
            <label>来源类型</label>
            <span>
              <el-tag :type="inventorySourceTagType(batch)" size="small" effect="plain">
                {{ inventorySourceLabel(batch) }}
              </el-tag>
            </span>
          </div>
          <div class="mobile-field">
            <label>零件编码</label>
            <span>{{ batch.partCode }}</span>
          </div>
          <div class="mobile-field">
            <label>可用库存</label>
            <span>{{ formatQuantity(batchAvailableQuantity(batch), batch.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>账面 / 预占</label>
            <span>
              {{ formatQuantity(batch.quantity, batch.unit) }}
              <small v-if="batch.reservedQuantity" class="mobile-subtext">预占 {{ formatQuantity(batch.reservedQuantity, batch.unit) }}</small>
            </span>
          </div>
          <div class="mobile-field mobile-full">
            <label>仓库 / 库位</label>
            <span>{{ batch.warehouseName }} / {{ batch.locationName || '-' }}</span>
          </div>
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ customerDisplay(batch) }}</span>
          </div>
          <div class="mobile-field">
            <label>来源订单</label>
            <span>
              <OrderNoLink v-if="inventorySourceOrderNo(batch)" :order-no="inventorySourceOrderNo(batch)" />
              <span v-else class="muted">备货库存</span>
              <small v-if="batch.inventorySourceType === 'STOCK' && inventorySourceOrderNo(batch)" class="mobile-subtext">生产来源订单</small>
            </span>
          </div>
          <div class="mobile-field mobile-full">
            <label>图纸</label>
            <span>
              {{ drawingInfoText(batch) }}
              <DrawingPreviewLink
                :file-name="batch.drawingFileName"
                :file-url="batch.drawingFileUrl"
                link-text="打开图纸"
                :title="`${batch.partName || batch.partCode} 库存图纸`"
              />
            </span>
          </div>
          <div class="mobile-field mobile-full">
            <label>生产任务</label>
            <span>
              {{ batch.sourceProductionTaskNo || '-' }}
              <small v-if="taskRelationText(batch)" class="mobile-subtext">{{ taskRelationText(batch) }}</small>
            </span>
          </div>
          <div class="mobile-field">
            <label>生产日期</label>
            <span>{{ formatDate(batch.productionDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(batch.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(batch.deliveryDate) }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button size="small" type="primary" plain @click="openSourceDetails(batch.partCode, batch.unit, 'ALL')">
            库存来源/图纸
          </el-button>
          <el-button size="small" type="primary" plain @click="openReservationDialog(batch)">
            预占记录
          </el-button>
          <span class="mobile-readonly-note">手机端只查看库存来源和预占记录</span>
        </div>
      </article>
      <div v-if="!inventory.length && !loading" class="mobile-empty">暂无库存</div>
    </div>

    <InventorySourceDetailsDialog
      v-model="sourceDetailsVisible"
      :loading="sourceDetailsLoading"
      :title="sourceDetailsTitle"
      :reference-only="sourceDetailsReferenceOnly"
      :detail="sourceDetails"
    />

    <el-dialog
      v-model="reservationDialogVisible"
      title="库存预占记录"
      width="min(920px, calc(100vw - 32px))"
      class="responsive-dialog"
    >
      <div v-if="selectedReservationBatch" class="reservation-summary">
        <strong>{{ selectedReservationBatch.partName }}</strong>
        <span>{{ selectedReservationBatch.partCode }} / {{ selectedReservationBatch.batchNo }}</span>
        <span>可用 {{ formatQuantity(batchAvailableQuantity(selectedReservationBatch), selectedReservationBatch.unit) }}</span>
        <span>账面 {{ formatQuantity(selectedReservationBatch.quantity, selectedReservationBatch.unit) }}</span>
        <span>预占 {{ formatQuantity(selectedReservationBatch.reservedQuantity || 0, selectedReservationBatch.unit) }}</span>
      </div>
      <el-table v-loading="reservationHistoryLoading" :data="reservationHistory" max-height="420">
        <el-table-column label="状态" width="105">
          <template #default="{ row }">
            <el-tag :type="reservationStatusTagType(row.status)" effect="plain">
              {{ reservationStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="订单 / 客户" min-width="210">
          <template #default="{ row }">
            <OrderNoLink v-if="row.orderNo" :order-no="row.orderNo" />
            <span v-else class="muted">草稿订单</span>
            <div class="cell-subtext">{{ row.customerName || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="零件" min-width="190">
          <template #default="{ row }">
            <div class="cell-main">{{ row.partName || '-' }}</div>
            <div class="cell-subtext">{{ row.partCode || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="110">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="时间" min-width="190">
          <template #default="{ row }">
            <div>预占 {{ formatDateTime(row.createdAt) }}</div>
            <div v-if="row.consumedAt" class="cell-subtext">消费 {{ formatDateTime(row.consumedAt) }}</div>
            <div v-if="row.releasedAt" class="cell-subtext">释放 {{ formatDateTime(row.releasedAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="220">
          <template #default="{ row }">{{ row.statusReason || '-' }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="reservationDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="adjustDialogVisible"
      title="库存盘点调整"
      width="640px"
      class="responsive-dialog"
      :close-on-click-modal="false"
      :close-on-press-escape="!adjustSaving"
      :before-close="handleAdjustDialogBeforeClose"
      @closed="resetAdjustDialog"
    >
      <div v-if="selectedBatch" class="adjustment-summary">
        <strong>{{ selectedBatch.partName }}</strong>
        <span>{{ selectedBatch.partCode }} / {{ selectedBatch.batchNo }}</span>
        <span>{{ selectedBatch.warehouseName }} / {{ selectedBatch.locationName || '-' }}</span>
        <span v-if="adjustmentReservedQuantity > 0">已预占 {{ formatQuantity(adjustmentReservedQuantity, selectedBatch.unit) }}</span>
      </div>
      <el-form class="adjustment-form" label-width="110px">
        <el-form-item label="当前剩余">
          <span class="readonly-value">{{ selectedBatch ? formatQuantity(selectedBatch.quantity, selectedBatch.unit) : '-' }}</span>
        </el-form-item>
        <el-form-item label="盘点后数量" required>
          <el-input-number
            v-model="adjustForm.afterQuantity"
            :min="adjustmentMinQuantity"
            :precision="3"
            :step="1"
            controls-position="right"
            style="width: 220px"
          />
          <span v-if="selectedBatch" class="adjustment-delta">
            差异：{{ formatSignedQuantity(adjustmentDelta, selectedBatch.unit) }}
          </span>
          <div v-if="adjustmentReservedQuantity > 0" class="adjustment-hint">
            该批次已有订单预占，盘点后数量不能低于 {{ formatQuantity(adjustmentReservedQuantity, selectedBatch?.unit || '件') }}。
          </div>
        </el-form-item>
        <el-form-item label="清点人" required>
          <el-input v-model="adjustForm.countedBy" placeholder="库存清点人员" />
        </el-form-item>
        <el-form-item label="清点时间">
          <el-date-picker
            v-model="adjustForm.countedAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="默认当前时间"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="签字人" required>
          <el-input v-model="adjustForm.signatureName" placeholder="确认签字人" />
        </el-form-item>
        <el-form-item label="盘点工单" required>
          <input
            ref="adjustmentFileInput"
            class="adjustment-file-input"
            type="file"
            accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff"
            @change="onAdjustmentFileChange"
          />
          <div class="adjustment-hint">必须上传盘点工单、现场照片或 PDF；支持 PNG、JPG、WEBP、BMP、GIF、TIF 等格式。</div>
          <div v-if="adjustmentFile" class="adjustment-selected-file">
            已选择：{{ displayFileName(adjustmentFile.name) }}
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="adjustForm.remark" type="textarea" :rows="3" placeholder="库存差异原因，可选" />
        </el-form-item>
      </el-form>
      <div class="adjustment-history">
        <div class="section-heading compact-heading">
          <strong>最近盘点记录</strong>
          <span>按时间倒序显示全部记录</span>
        </div>
        <el-table v-loading="adjustmentHistoryLoading" :data="adjustmentHistory" max-height="180" size="small">
          <el-table-column prop="adjustmentNo" label="盘点号" min-width="170" />
          <el-table-column label="数量变化" min-width="130">
            <template #default="{ row }">
              {{ formatQuantity(row.beforeQuantity, row.unit) }} -> {{ formatQuantity(row.afterQuantity, row.unit) }}
            </template>
          </el-table-column>
          <el-table-column label="清点人 / 签字" min-width="130">
            <template #default="{ row }">{{ row.countedBy }} / {{ row.signatureName }}</template>
          </el-table-column>
          <el-table-column label="清点时间" min-width="155">
            <template #default="{ row }">{{ formatDateTime(row.countedAt) }}</template>
          </el-table-column>
          <el-table-column label="附件" min-width="170">
            <template #default="{ row }">
              <a
                v-if="row.attachmentFileUrl"
                class="adjustment-attachment-link"
                :href="row.attachmentFileUrl"
                :title="displayFileName(row.attachmentFileName) || '查看附件'"
                target="_blank"
                rel="noreferrer"
              >
                {{ displayFileName(row.attachmentFileName) || '查看附件' }}
              </a>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="盘点备注" min-width="180">
            <template #default="{ row }">{{ row.remark || '-' }}</template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button :disabled="adjustSaving" @click="closeAdjustDialog">取消</el-button>
        <el-button type="primary" :loading="adjustSaving" @click="submitAdjustment">保存盘点</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="materialMemoryDialogVisible"
      class="responsive-dialog"
      title="编辑零件搜索记忆"
      width="520px"
      :close-on-click-modal="!materialMemorySaving"
      :close-on-press-escape="!materialMemorySaving"
      :before-close="handleMaterialMemoryDialogBeforeClose"
    >
      <el-form label-width="96px">
        <el-form-item label="零件编码">
          <el-input v-model="materialMemoryForm.partCode" />
        </el-form-item>
        <el-form-item label="零件名称">
          <el-input v-model="materialMemoryForm.partName" />
        </el-form-item>
        <el-form-item label="单位">
          <el-input v-model="materialMemoryForm.unit" />
        </el-form-item>
        <el-form-item label="规格">
          <el-input v-model="materialMemoryForm.partSpecification" clearable />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="materialMemoryForm.status" style="width: 160px">
            <el-option label="启用" value="ENABLED" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="material-memory-dialog-hint">
        <strong>保存影响</strong>
        <ul>
          <li>只维护下单搜索记忆，用于后续订单选料、库存搜索和 0 库存零件展示。</li>
          <li>不会修改库存数量；库存仍然只从 InventoryBatch 实时计算。</li>
          <li>不会覆盖历史订单、BOM 明细、库存批次、库存流水或生产记录。</li>
          <li>需要修改库存数量时，请到库存溯源里做盘点调整，系统会追加 InventoryTransaction。</li>
          <li>需要维护客户适用范围、机型 BOM 或默认图纸时，请到零件基础库或机型零件包维护。</li>
        </ul>
      </div>
      <template #footer>
        <el-button :disabled="materialMemorySaving" @click="closeMaterialMemoryDialog">取消</el-button>
        <el-button type="primary" :loading="materialMemorySaving" @click="saveMaterialMemory">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="materialMemoryDisableDialogVisible"
      class="responsive-dialog"
      title="停用零件搜索记忆"
      width="520px"
      :close-on-click-modal="!materialMemoryDisableSaving"
      :close-on-press-escape="!materialMemoryDisableSaving"
      :before-close="handleMaterialMemoryDisableDialogBeforeClose"
    >
      <div class="material-memory-disable-confirm" v-if="materialMemoryDisableTarget">
        <p>
          确认停用
          <strong>{{ materialMemoryDisableTarget.partCode }} / {{ materialMemoryDisableTarget.partName }}</strong>
          的零件搜索记忆吗？
        </p>
        <ul>
          <li>停用后不再作为后续订单选料、库存搜索和 0 库存零件展示的推荐项。</li>
          <li>系统只会停用零件搜索记忆，不会删除历史订单、库存批次、库存数量和生产记录。</li>
          <li>需要恢复时，可在库存使用总览切换到停用状态后重新启用。</li>
        </ul>
      </div>
      <template #footer>
        <el-button :disabled="materialMemoryDisableSaving" @click="closeMaterialMemoryDisableDialog">取消</el-button>
        <el-button type="danger" :loading="materialMemoryDisableSaving" @click="confirmDisableMaterialMemory">停用记忆</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DrawingPreviewLink from '../components/DrawingPreviewLink.vue';
import InventorySourceDetailsDialog from '../components/InventorySourceDetailsDialog.vue';
import MaterialSuggestionOption from '../components/MaterialSuggestionOption.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import type {
  CommonStatus,
  InventoryAdjustment,
  InventoryBatch,
  InventoryMaterialSuggestion,
  InventoryReservationAudit,
  InventoryReservationStatus,
  InventorySourceDetailResponse,
  InventoryStatus,
  InventorySummaryRow,
  MaterialMemory,
  Warehouse
} from '../types/erp';
import { normalizeDisplayFileName } from '../utils/fileNames';
import { formatDate, formatDateTime, formatDateTimeInputValue, formatQuantity } from '../utils/format';

const { isMobileLayout } = useDeviceProfile();
const warehouses = ref<Warehouse[]>([]);
const inventory = ref<InventoryBatch[]>([]);
const inventorySummary = ref<InventorySummaryRow[]>([]);
const loading = ref(false);
const adjustDialogVisible = ref(false);
const adjustSaving = ref(false);
const selectedBatch = ref<InventoryBatch>();
const selectedReservationBatch = ref<InventoryBatch>();
const sourceDetailsVisible = ref(false);
const sourceDetailsLoading = ref(false);
const sourceDetails = ref<InventorySourceDetailResponse | null>(null);
const sourceDetailsTitle = ref('库存来源详情');
const sourceDetailsReferenceOnly = ref(false);
const sourceDetailsRequestSeq = ref(0);
const reservationDialogVisible = ref(false);
const reservationHistory = ref<InventoryReservationAudit[]>([]);
const reservationHistoryLoading = ref(false);
const materialSuggestionRequestSeq = ref(0);
const materialMemory = ref<MaterialMemory[]>([]);
const materialMemoryLoading = ref(false);
const materialMemoryDialogVisible = ref(false);
const materialMemorySaving = ref(false);
const materialMemoryDisableDialogVisible = ref(false);
const materialMemoryDisableSaving = ref(false);
const materialMemoryDisableTarget = ref<MaterialMemory | null>(null);
const materialMemoryOperationSavingId = ref('');
const adjustmentFileInput = ref<HTMLInputElement>();
const adjustmentFile = ref<File | null>(null);
const adjustmentHistory = ref<InventoryAdjustment[]>([]);
const adjustmentHistoryLoading = ref(false);
const expandedMobileInventoryCardKeys = ref<string[]>([]);
const adjustForm = reactive({
  afterQuantity: 0,
  countedBy: '',
  countedAt: '',
  signatureName: '',
  remark: ''
});
const allowedAdjustmentFileExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'];
const allowedAdjustmentMimeTypes = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/gif',
  'image/tiff'
];
const genericAdjustmentMimeTypes = ['', 'application/octet-stream'];
const filters = reactive<{
  keyword?: string;
  customerId?: string;
  warehouseId?: string;
  orderNo?: string;
  status?: InventoryStatus;
}>({});
const materialMemoryFilters = reactive<{
  keyword?: string;
  status: CommonStatus;
}>({
  status: 'ENABLED'
});
const materialMemoryPagination = reactive({
  page: Number(1),
  limit: Number(20),
  total: Number(0)
});
const materialMemoryForm = reactive<{
  id: string;
  partCode: string;
  partName: string;
  unit: string;
  partSpecification: string;
  status: CommonStatus;
}>({
  id: '',
  partCode: '',
  partName: '',
  unit: '',
  partSpecification: '',
  status: 'ENABLED'
});

const availableQuantityText = computed(() => formatInventoryTotalByUnit('availableQuantity'));
const averageInventoryUsageRateText = computed(() => {
  const rates = inventorySummary.value
    .map((row) => inventoryUsageRate(row))
    .filter((rate): rate is number => rate !== null);
  if (!rates.length) {
    return '-';
  }
  const averageRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  return `${(averageRate * 100).toFixed(1)}%`;
});
const stockedWarehouseCount = computed(
  () => new Set(inventory.value.filter((item) => item.status === 'AVAILABLE' && batchAvailableQuantity(item) > 0).map((item) => item.warehouseId)).size
);
const adjustmentReservedQuantity = computed(() => Number(selectedBatch.value?.reservedQuantity || 0));
const adjustmentMinQuantity = computed(() => adjustmentReservedQuantity.value);
const adjustmentDelta = computed(() => (selectedBatch.value ? adjustForm.afterQuantity - selectedBatch.value.quantity : 0));
const selectedWarehouseName = computed(() => warehouses.value.find((item) => item.id === filters.warehouseId)?.warehouseName);
const inventoryQueryNoticeRows = computed(() => {
  if (!filters.keyword?.trim()) {
    return [];
  }
  // 关键字命中零件但库存为 0 时，要明确告诉仓库人员当前查询范围没有可用库存。
  return inventorySummary.value.filter((row) => row.availableQuantity <= 0);
});
const inventorySummaryByPartCode = computed(() => {
  // 库存使用总览用当前库存筛选结果反查使用率，避免搜索记忆和库存统计口径不一致。
  return new Map(inventorySummary.value.map((row) => [row.partCode.trim().toLocaleLowerCase(), row]));
});

function formatInventoryTotalByUnit(field: 'availableQuantity') {
  // 库存汇总可能同时包含件、套、kg 等单位，顶部卡片必须按单位分别展示。
  const totalByUnit = new Map<string, number>();
  for (const row of inventorySummary.value) {
    const unit = row.unit || '件';
    totalByUnit.set(unit, (totalByUnit.get(unit) || 0) + Number(row[field] || 0));
  }
  if (totalByUnit.size === 0) {
    return formatQuantity(0, '件');
  }
  return Array.from(totalByUnit.entries())
    .map(([unit, quantity]) => formatQuantity(quantity, unit))
    .join(' / ');
}

async function loadWarehouses() {
  try {
    warehouses.value = await erpApi.warehouses();
  } catch (error) {
    warehouses.value = [];
    ElMessage.error(error instanceof Error ? error.message : '仓库列表加载失败，请确认后端服务');
  }
}

async function loadInventory() {
  loading.value = true;
  try {
    const [summaryRows, inventoryRows] = await Promise.all([erpApi.inventorySummary(filters), erpApi.inventory(filters)]);
    inventorySummary.value = summaryRows;
    inventory.value = inventoryRows;
  } catch (error) {
    inventorySummary.value = [];
    inventory.value = [];
    expandedMobileInventoryCardKeys.value = [];
    ElMessage.error(error instanceof Error ? error.message : '库存数据加载失败，请确认后端服务和筛选条件');
  } finally {
    loading.value = false;
  }
}

async function loadMaterialMemory() {
  materialMemoryLoading.value = true;
  try {
    const requestPage = Math.max(materialMemoryPagination.page, 1);
    const requestLimit = materialMemoryPagination.limit;
    const requestOffset = (requestPage - 1) * requestLimit;
    let result = await erpApi.inventoryMaterialsPage({
      ...materialMemoryFilters,
      limit: requestLimit,
      offset: requestOffset
    });
    if (result.totalCount > 0 && result.items.length === 0 && requestPage > 1) {
      materialMemoryPagination.page = Math.max(Math.ceil(result.totalCount / requestLimit), 1);
      result = await erpApi.inventoryMaterialsPage({
        ...materialMemoryFilters,
        limit: requestLimit,
        offset: (materialMemoryPagination.page - 1) * requestLimit
      });
    }
    materialMemory.value = result.items;
    materialMemoryPagination.total = result.totalCount;
  } catch (error) {
    materialMemory.value = [];
    materialMemoryPagination.total = Number(0);
    ElMessage.error(error instanceof Error ? error.message : '库存使用总览加载失败，请确认后端服务和筛选条件');
  } finally {
    materialMemoryLoading.value = false;
  }
}

function searchMaterialMemory() {
  materialMemoryPagination.page = Number(1);
  void loadMaterialMemory();
}

function handleMaterialMemoryPageChange(page: number) {
  materialMemoryPagination.page = page;
  void loadMaterialMemory();
}

function openMaterialMemoryDialog(row: MaterialMemory) {
  materialMemoryForm.id = row.id;
  materialMemoryForm.partCode = row.partCode;
  materialMemoryForm.partName = row.partName;
  materialMemoryForm.unit = row.unit;
  materialMemoryForm.partSpecification = row.partSpecification || '';
  materialMemoryForm.status = row.status;
  materialMemoryDialogVisible.value = true;
}

function warnMaterialMemorySavingClose() {
  ElMessage.warning('零件搜索记忆正在保存，请等待保存完成');
}

function closeMaterialMemoryDialog() {
  if (materialMemorySaving.value) {
    warnMaterialMemorySavingClose();
    return;
  }
  materialMemoryDialogVisible.value = false;
}

function handleMaterialMemoryDialogBeforeClose(done: () => void) {
  if (materialMemorySaving.value) {
    warnMaterialMemorySavingClose();
    return;
  }
  done();
}

async function saveMaterialMemory() {
  if (materialMemorySaving.value) {
    return;
  }
  if (!materialMemoryForm.id) {
    return;
  }
  if (!materialMemoryForm.partCode.trim() || !materialMemoryForm.partName.trim() || !materialMemoryForm.unit.trim()) {
    ElMessage.warning('零件编码、名称和单位不能为空');
    return;
  }
  materialMemorySaving.value = true;
  try {
    await erpApi.updateInventoryMaterial(materialMemoryForm.id, {
      partCode: materialMemoryForm.partCode.trim(),
      partName: materialMemoryForm.partName.trim(),
      unit: materialMemoryForm.unit.trim(),
      partSpecification: materialMemoryForm.partSpecification.trim() || undefined,
      status: materialMemoryForm.status
    });
    ElMessage.success('零件搜索记忆已保存');
    materialMemoryDialogVisible.value = false;
    await loadMaterialMemory();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件搜索记忆保存失败');
  } finally {
    materialMemorySaving.value = false;
  }
}

async function disableMaterialMemory(row: MaterialMemory) {
  if (materialMemoryOperationSavingId.value) {
    return;
  }
  materialMemoryDisableTarget.value = row;
  materialMemoryDisableDialogVisible.value = true;
}

function closeMaterialMemoryDisableDialog() {
  if (materialMemoryDisableSaving.value) {
    ElMessage.warning('零件搜索记忆正在停用，请等待操作完成');
    return;
  }
  materialMemoryDisableDialogVisible.value = false;
  materialMemoryDisableTarget.value = null;
}

function handleMaterialMemoryDisableDialogBeforeClose(done: () => void) {
  if (materialMemoryDisableSaving.value) {
    ElMessage.warning('零件搜索记忆正在停用，请等待操作完成');
    return;
  }
  done();
  materialMemoryDisableTarget.value = null;
}

async function confirmDisableMaterialMemory() {
  if (materialMemoryDisableSaving.value || !materialMemoryDisableTarget.value) {
    return;
  }
  const target = materialMemoryDisableTarget.value;
  materialMemoryDisableSaving.value = true;
  materialMemoryOperationSavingId.value = target.id;
  try {
    await erpApi.disableInventoryMaterial(target.id);
    ElMessage.success('零件搜索记忆已停用');
    materialMemoryDisableDialogVisible.value = false;
    materialMemoryDisableTarget.value = null;
    await loadMaterialMemory();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件搜索记忆停用失败');
  } finally {
    materialMemoryDisableSaving.value = false;
    if (materialMemoryOperationSavingId.value === target.id) {
      materialMemoryOperationSavingId.value = '';
    }
  }
}

async function enableMaterialMemory(row: MaterialMemory) {
  if (materialMemoryOperationSavingId.value) {
    return;
  }
  materialMemoryOperationSavingId.value = row.id;
  try {
    await erpApi.updateInventoryMaterial(row.id, { status: 'ENABLED' });
    ElMessage.success('零件搜索记忆已启用');
    await loadMaterialMemory();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件搜索记忆启用失败');
  } finally {
    if (materialMemoryOperationSavingId.value === row.id) {
      materialMemoryOperationSavingId.value = '';
    }
  }
}

function reset() {
  filters.keyword = undefined;
  filters.customerId = undefined;
  filters.warehouseId = undefined;
  filters.orderNo = undefined;
  filters.status = undefined;
  void loadInventory();
}

async function queryMaterialSuggestions(keyword: string, callback: (items: InventoryMaterialSuggestion[]) => void) {
  const normalizedKeyword = keyword.trim();
  const requestId = ++materialSuggestionRequestSeq.value;
  callback([]);
  try {
    const result = await erpApi.inventoryMaterialSuggestions(
      normalizedKeyword,
      filters.warehouseId,
      undefined,
      undefined,
      undefined,
      filters.customerId
    );
    if (requestId === materialSuggestionRequestSeq.value) {
      callback(result);
    }
  } catch {
    if (requestId === materialSuggestionRequestSeq.value) {
      callback([]);
    }
  }
}

function selectMaterialSuggestion(item: InventoryMaterialSuggestion) {
  filters.keyword = item.partCode;
  void loadInventory();
}

function inventorySourceLabel(row: InventoryBatch) {
  if (row.inventorySourceType === 'ORDER') {
    return '订单库存';
  }
  return sourceKindLabel(row.sourceKind);
}

function inventorySourceTagType(row: InventoryBatch) {
  if (row.inventorySourceType === 'ORDER') {
    return 'success';
  }
  return row.sourceKind === 'CANCELLED_ORDER' ? 'danger' : row.sourceKind === 'CUSTOMER_CHANGE' ? 'warning' : 'info';
}

function sourceKindLabel(kind?: string) {
  const map: Record<string, string> = {
    NORMAL_ORDER: '正常订单备货',
    CANCELLED_ORDER: '取消订单转库存',
    CUSTOMER_CHANGE: '客户变更转库存'
  };
  return map[kind || 'NORMAL_ORDER'] || kind || '正常订单备货';
}

function stockSourceBreakdownText(row: InventorySummaryRow) {
  return [
    `正常 ${formatQuantity(row.normalOrderStockQuantity || 0, row.unit)}`,
    `取消 ${formatQuantity(row.cancelledOrderStockQuantity || 0, row.unit)}`,
    `变更 ${formatQuantity(row.customerChangeStockQuantity || 0, row.unit)}`
  ].join(' / ');
}

function inventoryUsageRate(row: InventorySummaryRow) {
  const totalQuantity = Number(row.totalQuantity || 0);
  if (totalQuantity <= 0) {
    return null;
  }
  return Math.min(Math.max(Number(row.usedQuantity || 0) / totalQuantity, 0), 1);
}

function isZeroInventorySummaryRow(row: InventorySummaryRow) {
  // 0 库存行来自零件搜索记忆匹配，表示当前筛选范围没有可用库存或历史批次。
  return Number(row.batchCount || 0) === 0 && Number(row.availableQuantity || 0) <= 0 && Number(row.totalQuantity || 0) <= 0;
}

function summarySourceDetailsButtonText(row: InventorySummaryRow) {
  return isZeroInventorySummaryRow(row) ? '查看资料' : '查看来源';
}

function formatInventoryUsageRate(row: InventorySummaryRow) {
  const rate = inventoryUsageRate(row);
  if (rate === null) {
    return '-';
  }
  return `${(rate * 100).toFixed(rate >= 0.1 ? 1 : 2)}%`;
}

function inventoryUsageRateTagType(row: InventorySummaryRow) {
  const rate = inventoryUsageRate(row);
  if (rate === null) {
    return 'info';
  }
  if (rate >= 0.8) {
    return 'success';
  }
  if (rate >= 0.4) {
    return 'warning';
  }
  return 'info';
}

function materialMemoryInventorySummary(row: MaterialMemory) {
  return inventorySummaryByPartCode.value.get(row.partCode.trim().toLocaleLowerCase());
}

function formatMaterialMemoryUsageRate(row: MaterialMemory) {
  const summary = materialMemoryInventorySummary(row);
  return summary ? formatInventoryUsageRate(summary) : '无库存记录';
}

function materialMemoryUsageRateTagType(row: MaterialMemory) {
  const summary = materialMemoryInventorySummary(row);
  return summary ? inventoryUsageRateTagType(summary) : 'info';
}

function customerDisplay(row: InventoryBatch) {
  return row.sourceCustomerName || row.productionSourceCustomerName || (row.inventorySourceType === 'STOCK' ? '备货库存' : '-');
}

function inventorySourceOrderNo(row: InventoryBatch) {
  return row.productionSourceOrderNo || row.sourceOrderNo || '';
}

function drawingInfoText(row: InventoryBatch) {
  const drawingNo = row.drawingNo || '未记录图号';
  const version = row.drawingVersion ? ` / ${row.drawingVersion}` : '';
  return `${drawingNo}${version}`;
}

function taskRelationText(row: InventoryBatch) {
  const texts: string[] = [];
  if (row.replenishmentSourceLabel) {
    texts.push(row.sourceProductionTaskNo ? `${row.replenishmentSourceLabel} / 源任务 ${row.sourceProductionTaskNo}` : row.replenishmentSourceLabel);
  } else if (row.replenishmentSourceType) {
    const label = row.replenishmentSourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单';
    texts.push(row.replenishmentSourceRequestNo ? `${label}：${row.replenishmentSourceRequestNo}` : label);
  } else if (row.isReplenishment && row.sourceReplenishmentTaskNo) {
    texts.push(`补单来源：${row.sourceReplenishmentTaskNo}`);
  } else if (row.isReplenishment) {
    texts.push('补单任务');
  }
  const componentText = inventoryComponentText(row);
  if (componentText) {
    texts.push(componentText);
  }
  if (row.importSequence) {
    texts.push(`Excel 序号 ${row.importSequence}`);
  }
  return texts.join('；');
}

function inventoryComponentText(row: InventoryBatch) {
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

function warehouseSummaryText(row: InventorySummaryRow) {
  if (!row.warehouses.length) {
    return '无可用库存';
  }
  return row.warehouses
    .map((warehouse) => `${warehouse.warehouseName} ${formatQuantity(warehouse.availableQuantity, row.unit)}`)
    .join('，');
}

function summaryCardKey(row: InventorySummaryRow) {
  return `summary:${row.partCode}:${row.partName}:${row.unit}`;
}

function batchCardKey(row: InventoryBatch) {
  return `batch:${row.id}`;
}

function isMobileInventoryCardExpanded(key: string) {
  return expandedMobileInventoryCardKeys.value.includes(key);
}

function toggleMobileInventoryCard(key: string) {
  expandedMobileInventoryCardKeys.value = isMobileInventoryCardExpanded(key)
    ? expandedMobileInventoryCardKeys.value.filter((item) => item !== key)
    : [...expandedMobileInventoryCardKeys.value, key];
}

function canAdjustBatch(row: InventoryBatch) {
  return Boolean(row.canAdjust);
}

function adjustmentDisabledReason(row?: InventoryBatch) {
  if (!row || canAdjustBatch(row)) {
    return '';
  }
  return '只有可用库存或数量为 0 的历史批次可以盘点调整。';
}

function batchAvailableQuantity(row: InventoryBatch) {
  return Number(row.availableQuantity ?? Math.max(Number(row.quantity || 0) - Number(row.reservedQuantity || 0), 0));
}

function reservationStatusText(status: InventoryReservationStatus) {
  const map: Record<InventoryReservationStatus, string> = {
    ACTIVE: '预占中',
    RELEASED: '已释放',
    CONSUMED: '已消费'
  };
  return map[status] || status;
}

function reservationStatusTagType(status: InventoryReservationStatus) {
  const map: Record<InventoryReservationStatus, 'primary' | 'success' | 'info'> = {
    ACTIVE: 'primary',
    RELEASED: 'info',
    CONSUMED: 'success'
  };
  return map[status] || 'info';
}

async function openSourceDetails(
  partCode: string,
  unit?: string,
  sourceType: 'ALL' | 'ORDER' | 'STOCK' = 'ALL',
  title = '库存来源详情',
  referenceOnly = false
) {
  if (!partCode?.trim()) {
    ElMessage.warning('请先选择零件');
    return;
  }
  sourceDetailsTitle.value = title;
  sourceDetailsReferenceOnly.value = referenceOnly;
  sourceDetailsVisible.value = true;
  sourceDetailsLoading.value = true;
  sourceDetails.value = null;
  const requestId = ++sourceDetailsRequestSeq.value;
  try {
    const detail = await erpApi.inventoryMaterialSourceDetails(partCode.trim(), {
      unit,
      warehouseId: filters.warehouseId,
      sourceType,
      customerId: filters.customerId
    });
    if (requestId === sourceDetailsRequestSeq.value) {
      sourceDetails.value = detail;
    }
  } catch (error) {
    if (requestId === sourceDetailsRequestSeq.value) {
      sourceDetails.value = null;
      ElMessage.error(error instanceof Error ? error.message : '库存来源查询失败，请确认零件和后端服务');
    }
  } finally {
    if (requestId === sourceDetailsRequestSeq.value) {
      sourceDetailsLoading.value = false;
    }
  }
}

async function openSummarySourceDetails(row: InventorySummaryRow) {
  const referenceOnly = isZeroInventorySummaryRow(row);
  await openSourceDetails(row.partCode, row.unit, 'ALL', referenceOnly ? '零件资料详情' : '库存来源详情', referenceOnly);
}

async function openReservationDialog(row: InventoryBatch) {
  selectedReservationBatch.value = row;
  reservationHistory.value = [];
  reservationDialogVisible.value = true;
  reservationHistoryLoading.value = true;
  try {
    reservationHistory.value = await erpApi.inventoryBatchReservations(row.id);
  } catch (error) {
    reservationHistory.value = [];
    ElMessage.error(error instanceof Error ? error.message : '预占记录加载失败，请确认库存批次和后端服务');
  } finally {
    reservationHistoryLoading.value = false;
  }
}

function currentDateTimeValue() {
  return formatDateTimeInputValue(new Date());
}

function openAdjustDialog(row: InventoryBatch) {
  if (isMobileLayout.value) {
    ElMessage.warning('手机端仅查看库存和来源，盘点调整请在电脑端操作');
    return;
  }
  const disabledReason = adjustmentDisabledReason(row);
  if (disabledReason) {
    ElMessage.warning(disabledReason);
    return;
  }
  selectedBatch.value = row;
  adjustForm.afterQuantity = Math.max(row.quantity, Number(row.reservedQuantity || 0));
  adjustForm.countedBy = '';
  adjustForm.countedAt = currentDateTimeValue();
  adjustForm.signatureName = '';
  adjustForm.remark = '';
  adjustmentFile.value = null;
  if (adjustmentFileInput.value) {
    adjustmentFileInput.value.value = '';
  }
  adjustmentHistory.value = [];
  adjustDialogVisible.value = true;
  void loadAdjustmentHistory(row.id);
}

// 库存盘点会写入库存流水，保存中禁止关闭弹窗，避免操作员重复提交或误判保存状态。
function warnAdjustDialogSavingClose() {
  ElMessage.warning('库存盘点正在保存，请等待保存完成');
}

function closeAdjustDialog() {
  if (adjustSaving.value) {
    warnAdjustDialogSavingClose();
    return;
  }
  adjustDialogVisible.value = false;
}

function handleAdjustDialogBeforeClose(done: () => void) {
  if (adjustSaving.value) {
    warnAdjustDialogSavingClose();
    return;
  }
  done();
}

function resetAdjustDialog() {
  selectedBatch.value = undefined;
  adjustForm.afterQuantity = 0;
  adjustForm.countedBy = '';
  adjustForm.countedAt = '';
  adjustForm.signatureName = '';
  adjustForm.remark = '';
  adjustmentFile.value = null;
  adjustmentHistory.value = [];
  if (adjustmentFileInput.value) {
    adjustmentFileInput.value.value = '';
  }
}

function onAdjustmentFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] || null;
  if (!file) {
    adjustmentFile.value = null;
    return;
  }
  if (!isAllowedAdjustmentFile(file)) {
    ElMessage.warning('盘点附件只支持 PDF 或常用图片格式');
    input.value = '';
    adjustmentFile.value = null;
    return;
  }
  adjustmentFile.value = file;
}

function isAllowedAdjustmentFile(file: File) {
  const fileName = displayFileName(file.name).toLowerCase();
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  return (
    allowedAdjustmentFileExtensions.includes(extension) &&
    (genericAdjustmentMimeTypes.includes(file.type) || allowedAdjustmentMimeTypes.includes(file.type))
  );
}

function displayFileName(fileName?: string | null) {
  return normalizeDisplayFileName(fileName);
}

function formatSignedQuantity(value: number, unit: string) {
  if (value === 0) {
    return `0 ${unit}`;
  }
  const prefix = value > 0 ? '+' : '-';
  return `${prefix}${formatQuantity(Math.abs(value), unit)}`;
}

async function loadAdjustmentHistory(batchId: string) {
  adjustmentHistoryLoading.value = true;
  try {
    adjustmentHistory.value = await erpApi.inventoryBatchAdjustments(batchId);
  } catch (error) {
    adjustmentHistory.value = [];
    ElMessage.error(error instanceof Error ? error.message : '盘点记录加载失败，请确认库存批次和后端服务');
  } finally {
    adjustmentHistoryLoading.value = false;
  }
}

async function submitAdjustment() {
  if (!selectedBatch.value) {
    return;
  }
  if (!adjustForm.countedBy.trim()) {
    ElMessage.warning('请填写清点人');
    return;
  }
  if (!adjustForm.signatureName.trim()) {
    ElMessage.warning('请填写签字人');
    return;
  }
  if (!adjustmentFile.value) {
    ElMessage.warning('请上传盘点工单、照片或 PDF 附件');
    return;
  }
  if (Number(adjustForm.afterQuantity) + 0.0001 < adjustmentMinQuantity.value) {
    ElMessage.warning(
      `盘点后数量不能低于已预占数量 ${formatQuantity(adjustmentMinQuantity.value, selectedBatch.value.unit)}`
    );
    return;
  }

  adjustSaving.value = true;
  try {
    const attachment = await erpApi.uploadInventoryAdjustmentFile(adjustmentFile.value);

    await erpApi.adjustInventoryBatch(selectedBatch.value.id, {
      afterQuantity: Number(adjustForm.afterQuantity),
      countedBy: adjustForm.countedBy.trim(),
      countedAt: adjustForm.countedAt || undefined,
      signatureName: adjustForm.signatureName.trim(),
      attachmentFileName: attachment?.fileName,
      attachmentFileUrl: attachment?.fileUrl,
      attachmentMimeType: attachment?.mimeType,
      attachmentSize: attachment?.size,
      remark: adjustForm.remark.trim() || undefined
    });

    ElMessage.success('盘点调整已保存');
    adjustDialogVisible.value = false;
    await loadInventory();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '盘点调整保存失败');
  } finally {
    adjustSaving.value = false;
  }
}

onMounted(async () => {
  await loadWarehouses();
  await Promise.all([loadInventory(), loadMaterialMemory()]);
});
</script>

<style scoped>
.inventory-page-title {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.page-subtitle {
  margin: 0;
  color: #64748b;
  font-size: 14px;
  line-height: 20px;
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

.warning-text {
  color: #dc2626;
}

.source-tag {
  margin-top: 5px;
}

.summary-table-card {
  margin-bottom: 18px;
}

.material-memory-card {
  margin-bottom: 18px;
}

.material-memory-heading {
  align-items: flex-start;
}

.material-memory-heading > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.material-memory-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.table-pagination-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px 14px;
  border-top: 1px solid #edf2f7;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.material-memory-dialog-hint {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #eff6ff;
  color: #475569;
  font-size: 13px;
  line-height: 20px;
}

.material-memory-dialog-hint strong {
  display: block;
  margin-bottom: 4px;
  color: #0f172a;
}

.material-memory-dialog-hint ul {
  margin: 0;
  padding-left: 18px;
}

.material-memory-dialog-hint li + li {
  margin-top: 3px;
}

.material-memory-disable-confirm {
  display: grid;
  gap: 10px;
  color: #475569;
  font-size: 14px;
  line-height: 1.6;
}

.material-memory-disable-confirm p,
.material-memory-disable-confirm ul {
  margin: 0;
}

.material-memory-disable-confirm strong {
  color: #0f172a;
}

.material-memory-disable-confirm ul {
  padding-left: 20px;
}

.inventory-query-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  color: #1e3a8a;
  font-size: 13px;
  line-height: 20px;
}

.inventory-query-notice strong {
  color: #0f172a;
}

.inventory-query-notice span {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  background: #ffffff;
  color: #1e40af;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid #edf2f7;
}

.section-heading strong {
  color: #0f172a;
  font-size: 15px;
  line-height: 22px;
}

.section-heading span {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.warehouse-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.stock-source-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.summary-mobile-list {
  margin-bottom: 14px;
}

.mobile-subtext {
  display: block;
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.mobile-readonly-note {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  color: #64748b;
  font-size: 12px;
}

.reservation-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
  color: #475569;
  font-size: 13px;
  line-height: 20px;
}

.reservation-summary strong {
  color: #0f172a;
}

.adjustment-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 18px;
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  color: #475569;
  font-size: 13px;
  line-height: 20px;
}

.adjustment-summary strong {
  color: #0f172a;
}

.readonly-value {
  color: #0f172a;
  font-weight: 600;
}

.adjustment-delta {
  margin-left: 12px;
  color: #64748b;
  font-size: 13px;
}

.adjustment-file-input {
  width: 100%;
  max-width: 420px;
  color: #475569;
}

.adjustment-hint {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.adjustment-selected-file,
.adjustment-attachment-link {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.adjustment-selected-file {
  margin-top: 6px;
  color: #0f172a;
  font-size: 12px;
  line-height: 18px;
}

.adjustment-attachment-link {
  color: #2563eb;
  text-decoration: none;
}

.adjustment-history {
  margin-top: 18px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.compact-heading {
  padding: 10px 12px;
  background: #f8fafc;
}

.mobile-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}

.mobile-card-actions .el-button {
  margin-left: 0;
}

@media (max-width: 768px) {
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .material-memory-toolbar {
    justify-content: flex-start;
    width: 100%;
  }

  .inventory-query-notice {
    align-items: flex-start;
    flex-direction: column;
  }

  .inventory-query-notice span {
    width: 100%;
  }

  .adjustment-form :deep(.el-form-item) {
    display: block;
  }

  .adjustment-form :deep(.el-form-item__label) {
    justify-content: flex-start;
    width: auto !important;
    margin-bottom: 6px;
  }

  .adjustment-form :deep(.el-form-item__content) {
    margin-left: 0 !important;
  }

  .adjustment-delta {
    display: block;
    margin: 8px 0 0;
  }

  .mobile-card-actions {
    justify-content: flex-start;
  }

  .mobile-card-actions .el-button {
    flex: 1 1 128px;
  }
}
</style>
