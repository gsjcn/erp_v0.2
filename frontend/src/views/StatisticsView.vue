<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">统计表</h2>
      <div class="header-actions">
        <el-button :icon="Download" :loading="statisticsExporting" title="按当前统计筛选导出 Excel" @click="exportStatisticsExcel">导出 Excel</el-button>
        <el-button :loading="loading" title="刷新年份选项和当前统计数据" @click="refreshStatistics">刷新</el-button>
      </div>
    </div>

    <div class="filter-bar statistics-filter">
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect v-model="customerId" placeholder="全部客户" width="220px" />
      </div>
      <div class="filter-field">
        <label>年份</label>
        <el-select v-model="year" filterable placeholder="选择年份" title="选择统计年份" style="width: 120px" @change="handleYearChange">
          <el-option v-for="item in yearOptions" :key="item" :label="`${item} 年`" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>季度</label>
        <el-select
          v-model="quarter"
          clearable
          placeholder="全部季度"
          :disabled="quarterFilterDisabled"
          :title="quarterFilterTitle"
          style="width: 130px"
          @change="handleQuarterChange"
        >
          <el-option v-for="item in quarterOptions" :key="item" :label="`第 ${item} 季度`" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>月份</label>
        <el-select
          v-model="month"
          clearable
          placeholder="全部月份"
          :disabled="monthFilterDisabled"
          :title="monthFilterTitle"
          style="width: 130px"
          @change="handleMonthChange"
        >
          <el-option v-for="item in monthOptions" :key="item" :label="`${item} 月`" :value="item" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" title="按当前筛选查询统计" @click="loadStatistics">查询</el-button>
      <el-button title="重置统计筛选条件" @click="resetStatisticsFilters">重置</el-button>
    </div>

    <div class="statistics-filter-summary" :title="statisticsFilterSummaryTitle">
      <span>当前统计：{{ periodTitle }} / {{ statisticsExportScopeLabel }}</span>
      <span>{{ statisticsNarrowFilterHint }}</span>
    </div>

    <el-tabs v-model="activePeriod" class="statistics-tabs">
      <el-tab-pane label="年度统计" name="year" />
      <el-tab-pane label="季度统计" name="quarter" />
      <el-tab-pane label="月度统计" name="month" />
    </el-tabs>

    <el-alert
      v-if="statisticsCutoffNotice"
      class="statistics-cutoff-alert"
      :title="statisticsCutoffNotice"
      type="warning"
      show-icon
      :closable="false"
    />

    <el-alert
      class="statistics-cutoff-alert"
      title="当前库存快照只从 InventoryBatch 实时汇总，按可用量、预占量、订单库存和备货库存拆分展示，不写入库存流水。"
      type="info"
      show-icon
      :closable="false"
    />

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">订单数</div>
        <div class="stat-value">{{ totals.orderCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">客户订单数量</div>
        <div class="stat-value">{{ formatTotalQuantity('customerOrderQuantity') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">生产计划数量</div>
        <div class="stat-value">{{ formatTotalQuantity('productionPlanQuantity') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">实际完成数量</div>
        <div class="stat-value">{{ formatTotalQuantity('completedProductionQuantity') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">订单发货数量</div>
        <div class="stat-value">{{ formatTotalQuantity('shippedOrderQuantity') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">转库存数量</div>
        <div class="stat-value">{{ formatTotalQuantity('stockQuantity') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">当前库存数量</div>
        <div class="stat-value">{{ formatTotalQuantity('currentInventoryQuantity') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">当前订单库存数量</div>
        <div class="stat-value">{{ formatTotalQuantity('currentOrderInventoryQuantity') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">当前备货库存数量</div>
        <div class="stat-value">{{ formatTotalQuantity('currentStockInventoryQuantity') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">报废数量</div>
        <div class="stat-value">{{ formatTotalQuantity('scrapQuantity') }}</div>
      </div>
    </div>

    <div class="table-card desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">当前库存快照</h3>
        <div class="inventory-snapshot-summary">
          <span>已显示 {{ inventorySnapshotRows.length }} / {{ inventorySnapshotTotal }} 个零件</span>
          <span>本页低库存 {{ inventorySnapshotTriggeredAlertCount }} 个</span>
        </div>
        <div v-if="!isMobileLayout" class="statistics-table-height-actions" aria-label="统计库存快照表格高度">
          <span class="statistics-table-height-label">统计库存快照表格高度</span>
          <el-button-group>
            <el-button
              :icon="Minus"
              :disabled="statisticsWorkTableHeights.inventorySnapshot <= statisticsWorkTableHeightLimits.min"
              title="降低统计库存快照表格高度"
              aria-label="降低统计库存快照表格高度"
              @click="adjustStatisticsWorkTableHeight('inventorySnapshot', -statisticsWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="Plus"
              :disabled="statisticsWorkTableHeights.inventorySnapshot >= statisticsWorkTableHeightLimits.max"
              title="提高统计库存快照表格高度"
              aria-label="提高统计库存快照表格高度"
              @click="adjustStatisticsWorkTableHeight('inventorySnapshot', statisticsWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="RefreshLeft"
              :disabled="statisticsWorkTableHeights.inventorySnapshot === statisticsWorkTableDefaultHeights.inventorySnapshot"
              title="恢复统计库存快照表格默认高度"
              aria-label="恢复统计库存快照表格默认高度"
              @click="resetStatisticsWorkTableHeight('inventorySnapshot')"
            />
          </el-button-group>
        </div>
      </div>
      <el-table v-loading="loading" :data="inventorySnapshotRows" :max-height="statisticsWorkTableHeights.inventorySnapshot">
        <el-table-column prop="partCode" label="零件编码" width="150" fixed="left" />
        <el-table-column prop="partName" label="零件名称" min-width="180" fixed="left" />
        <el-table-column label="批次 / 仓库" width="130">
          <template #default="{ row }">{{ row.batchCount }} 批 / {{ row.warehouseCount }} 个仓库</template>
        </el-table-column>
        <el-table-column label="账面数量" width="130">
          <template #default="{ row }">{{ formatQuantity(row.physicalQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="预占数量" width="130">
          <template #default="{ row }">{{ formatQuantity(row.reservedQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="可用数量" width="130">
          <template #default="{ row }">{{ formatQuantity(row.availableQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="订单库存" width="130">
          <template #default="{ row }">{{ formatQuantity(row.orderInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="备货库存" width="130">
          <template #default="{ row }">{{ formatQuantity(row.stockInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="库存报警" min-width="160">
          <template #default="{ row }">
            <el-tag :type="inventorySnapshotStockAlertTagType(row)" effect="plain">
              {{ inventorySnapshotStockAlertText(row) }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="inventorySnapshotTotal > 0" class="table-pagination-row">
        <span>
          第 {{ inventorySnapshotPagination.page }} 页，已显示 {{ inventorySnapshotRows.length }} /
          {{ inventorySnapshotTotal }} 个零件
        </span>
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :current-page="inventorySnapshotPagination.page"
          :page-size="inventorySnapshotPagination.pageLimit"
          :page-sizes="[10, 20, 50, 100]"
          :total="inventorySnapshotTotal"
          :disabled="loading"
          @size-change="handleInventorySnapshotPageSizeChange"
          @current-change="handleInventorySnapshotPageChange"
        />
      </div>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">当前库存快照</h3>
      <article
        v-for="row in inventorySnapshotRows"
        :key="inventorySnapshotMobileCardKey(row)"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileStatisticsCardExpanded(inventorySnapshotMobileCardKey(row)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.partName }}</strong>
            <small>{{ row.partCode }} / {{ row.batchCount }} 批</small>
          </div>
          <div class="mobile-card-header-actions">
            <el-button
              link
              type="primary"
              :title="
                isMobileStatisticsCardExpanded(inventorySnapshotMobileCardKey(row)) ? '收起当前库存快照详情' : '查看当前库存快照详情'
              "
              @click="toggleMobileStatisticsCard(inventorySnapshotMobileCardKey(row))"
            >
              {{ isMobileStatisticsCardExpanded(inventorySnapshotMobileCardKey(row)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>可用 {{ formatQuantity(row.availableQuantity, row.unit) }}</span>
          <span>预占 {{ formatQuantity(row.reservedQuantity, row.unit) }}</span>
          <span>{{ inventorySnapshotStockAlertText(row) }}</span>
        </div>
        <div v-show="isMobileStatisticsCardExpanded(inventorySnapshotMobileCardKey(row))" class="mobile-card-fields">
          <div class="mobile-field">
            <label>账面数量</label>
            <span>{{ formatQuantity(row.physicalQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>订单库存</label>
            <span>{{ formatQuantity(row.orderInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>备货库存</label>
            <span>{{ formatQuantity(row.stockInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>仓库数量</label>
            <span>{{ row.warehouseCount }} 个</span>
          </div>
        </div>
      </article>
      <div v-if="!inventorySnapshotRows.length && !loading" class="mobile-empty">暂无当前库存快照</div>
      <div v-if="inventorySnapshotTotal > 0" class="mobile-pagination-bar">
        <span>
          第 {{ inventorySnapshotPagination.page }} 页，已显示 {{ inventorySnapshotRows.length }} /
          {{ inventorySnapshotTotal }} 个零件
        </span>
        <div class="mobile-pagination-actions">
          <el-button size="small" :disabled="loading || inventorySnapshotPagination.page <= 1" @click="loadInventorySnapshotPreviousPage">
            上一页
          </el-button>
          <el-button title="继续加载" size="small" type="primary" plain :disabled="loading || !inventorySnapshotHasMore" @click="loadInventorySnapshotNextPage">
            继续加载
          </el-button>
        </div>
      </div>
    </div>

    <div class="table-card desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">{{ periodTitle }}总汇总</h3>
        <div v-if="!isMobileLayout" class="statistics-table-height-actions" aria-label="统计总汇总表格高度">
          <span class="statistics-table-height-label">统计总汇总表格高度</span>
          <el-button-group>
            <el-button
              :icon="Minus"
              :disabled="statisticsWorkTableHeights.totals <= statisticsWorkTableHeightLimits.min"
              title="降低统计总汇总表格高度"
              aria-label="降低统计总汇总表格高度"
              @click="adjustStatisticsWorkTableHeight('totals', -statisticsWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="Plus"
              :disabled="statisticsWorkTableHeights.totals >= statisticsWorkTableHeightLimits.max"
              title="提高统计总汇总表格高度"
              aria-label="提高统计总汇总表格高度"
              @click="adjustStatisticsWorkTableHeight('totals', statisticsWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="RefreshLeft"
              :disabled="statisticsWorkTableHeights.totals === statisticsWorkTableDefaultHeights.totals"
              title="恢复统计总汇总表格默认高度"
              aria-label="恢复统计总汇总表格默认高度"
              @click="resetStatisticsWorkTableHeight('totals')"
            />
          </el-button-group>
        </div>
      </div>
      <el-table v-loading="loading" :data="totalRows" :max-height="statisticsWorkTableHeights.totals">
        <el-table-column prop="range" label="统计范围" min-width="160" />
        <el-table-column prop="metric" label="指标" min-width="170" />
        <el-table-column label="数量" min-width="140">
          <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">{{ periodTitle }}总汇总</h3>
      <article
        v-for="row in totalRows"
        :key="totalMobileCardKey(row)"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileStatisticsCardExpanded(totalMobileCardKey(row)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.metric }}</strong>
            <small>{{ row.range }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <el-button
              link
              type="primary"
              :title="isMobileStatisticsCardExpanded(totalMobileCardKey(row)) ? '收起统计总汇总详情' : '查看统计总汇总详情'"
              @click="toggleMobileStatisticsCard(totalMobileCardKey(row))"
            >
              {{ isMobileStatisticsCardExpanded(totalMobileCardKey(row)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>{{ formatQuantity(row.quantity, row.unit) }}</span>
        </div>
        <div v-show="isMobileStatisticsCardExpanded(totalMobileCardKey(row))" class="mobile-card-fields">
          <div class="mobile-field">
            <label>统计范围</label>
            <span>{{ row.range }}</span>
          </div>
          <div class="mobile-field">
            <label>指标</label>
            <span>{{ row.metric }}</span>
          </div>
          <div class="mobile-field">
            <label>数量</label>
            <span>{{ formatQuantity(row.quantity, row.unit) }}</span>
          </div>
        </div>
      </article>
      <div v-if="!totalRows.length && !loading" class="mobile-empty">暂无总汇总</div>
    </div>

    <div class="table-card desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">{{ periodTitle }}客户汇总</h3>
        <div v-if="!isMobileLayout" class="statistics-table-height-actions" aria-label="统计客户汇总表格高度">
          <span class="statistics-table-height-label">统计客户汇总表格高度</span>
          <el-button-group>
            <el-button
              :icon="Minus"
              :disabled="statisticsWorkTableHeights.customers <= statisticsWorkTableHeightLimits.min"
              title="降低统计客户汇总表格高度"
              aria-label="降低统计客户汇总表格高度"
              @click="adjustStatisticsWorkTableHeight('customers', -statisticsWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="Plus"
              :disabled="statisticsWorkTableHeights.customers >= statisticsWorkTableHeightLimits.max"
              title="提高统计客户汇总表格高度"
              aria-label="提高统计客户汇总表格高度"
              @click="adjustStatisticsWorkTableHeight('customers', statisticsWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="RefreshLeft"
              :disabled="statisticsWorkTableHeights.customers === statisticsWorkTableDefaultHeights.customers"
              title="恢复统计客户汇总表格默认高度"
              aria-label="恢复统计客户汇总表格默认高度"
              @click="resetStatisticsWorkTableHeight('customers')"
            />
          </el-button-group>
        </div>
      </div>
      <el-table v-loading="loading" :data="customerRows" :max-height="statisticsWorkTableHeights.customers">
        <el-table-column prop="periodLabel" label="统计周期" width="140" />
        <el-table-column prop="customerName" label="客户" min-width="190" />
        <el-table-column prop="orderCount" label="订单数" width="90" />
        <el-table-column label="客户订单数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.customerOrderQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="生产计划数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="实际完成数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.completedProductionQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="订单发货数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.shippedOrderQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="转库存数量" width="130">
          <template #default="{ row }">{{ formatQuantity(row.stockQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="当前库存数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.currentInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="当前订单库存数量" width="160">
          <template #default="{ row }">{{ formatQuantity(row.currentOrderInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="当前备货库存数量" width="160">
          <template #default="{ row }">{{ formatQuantity(row.currentStockInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="报废数量" width="120">
          <template #default="{ row }">{{ formatQuantity(row.scrapQuantity, row.unit) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">{{ periodTitle }}客户汇总</h3>
      <article
        v-for="row in customerRows"
        :key="customerMobileCardKey(row)"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileStatisticsCardExpanded(customerMobileCardKey(row)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.customerName }}</strong>
            <small>{{ row.periodLabel }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <el-button
              link
              type="primary"
              :title="isMobileStatisticsCardExpanded(customerMobileCardKey(row)) ? '收起客户汇总详情' : '查看客户汇总详情'"
              @click="toggleMobileStatisticsCard(customerMobileCardKey(row))"
            >
              {{ isMobileStatisticsCardExpanded(customerMobileCardKey(row)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>订单 {{ row.orderCount }}</span>
          <span>生产 {{ formatQuantity(row.productionPlanQuantity, row.unit) }}</span>
          <span>发货 {{ formatQuantity(row.shippedOrderQuantity, row.unit) }}</span>
        </div>
        <div v-show="isMobileStatisticsCardExpanded(customerMobileCardKey(row))" class="mobile-card-fields">
          <div class="mobile-field">
            <label>订单数</label>
            <span>{{ row.orderCount }}</span>
          </div>
          <div class="mobile-field">
            <label>客户订单数量</label>
            <span>{{ formatQuantity(row.customerOrderQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>生产计划数量</label>
            <span>{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>实际完成数量</label>
            <span>{{ formatQuantity(row.completedProductionQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>订单发货数量</label>
            <span>{{ formatQuantity(row.shippedOrderQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>转库存数量</label>
            <span>{{ formatQuantity(row.stockQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>当前库存数量</label>
            <span>{{ formatQuantity(row.currentInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>当前订单库存数量</label>
            <span>{{ formatQuantity(row.currentOrderInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>当前备货库存数量</label>
            <span>{{ formatQuantity(row.currentStockInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>报废数量</label>
            <span>{{ formatQuantity(row.scrapQuantity, row.unit) }}</span>
          </div>
        </div>
      </article>
      <div v-if="!customerRows.length && !loading" class="mobile-empty">暂无客户汇总</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">{{ periodTitle }}零件汇总</h3>
        <div v-if="!isMobileLayout" class="statistics-table-height-actions" aria-label="统计汇总表格高度">
          <span class="statistics-table-height-label">统计汇总表格高度</span>
          <el-button-group>
            <el-button
              :icon="Minus"
              :disabled="statisticsWorkTableHeights.summary <= statisticsWorkTableHeightLimits.min"
              title="降低统计汇总表格高度"
              aria-label="降低统计汇总表格高度"
              @click="adjustStatisticsWorkTableHeight('summary', -statisticsWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="Plus"
              :disabled="statisticsWorkTableHeights.summary >= statisticsWorkTableHeightLimits.max"
              title="提高统计汇总表格高度"
              aria-label="提高统计汇总表格高度"
              @click="adjustStatisticsWorkTableHeight('summary', statisticsWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="RefreshLeft"
              :disabled="statisticsWorkTableHeights.summary === statisticsWorkTableDefaultHeights.summary"
              title="恢复统计汇总表格默认高度"
              aria-label="恢复统计汇总表格默认高度"
              @click="resetStatisticsWorkTableHeight('summary')"
            />
          </el-button-group>
        </div>
      </div>
      <el-table v-loading="loading" :data="summaryRows" :max-height="statisticsWorkTableHeights.summary">
        <el-table-column prop="periodLabel" label="统计周期" width="140" />
        <el-table-column prop="partCode" label="零件编码" width="140" />
        <el-table-column prop="partName" label="零件名称" min-width="160" />
        <el-table-column prop="orderCount" label="订单数" width="90" />
        <el-table-column label="客户订单数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.customerOrderQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="生产计划数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="实际完成数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.completedProductionQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="订单发货数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.shippedOrderQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="转库存数量" width="130">
          <template #default="{ row }">{{ formatQuantity(row.stockQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="当前库存数量" width="140">
          <template #default="{ row }">{{ formatQuantity(row.currentInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="当前订单库存数量" width="160">
          <template #default="{ row }">{{ formatQuantity(row.currentOrderInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="当前备货库存数量" width="160">
          <template #default="{ row }">{{ formatQuantity(row.currentStockInventoryQuantity, row.unit) }}</template>
        </el-table-column>
        <el-table-column label="报废数量" width="120">
          <template #default="{ row }">{{ formatQuantity(row.scrapQuantity, row.unit) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">{{ periodTitle }}零件汇总</h3>
      <article
        v-for="row in summaryRows"
        :key="summaryMobileCardKey(row)"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileStatisticsCardExpanded(summaryMobileCardKey(row)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.partName }}</strong>
            <small>{{ row.periodLabel }} / {{ row.partCode }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <el-button
              link
              type="primary"
              :title="isMobileStatisticsCardExpanded(summaryMobileCardKey(row)) ? '收起零件汇总详情' : '查看零件汇总详情'"
              @click="toggleMobileStatisticsCard(summaryMobileCardKey(row))"
            >
              {{ isMobileStatisticsCardExpanded(summaryMobileCardKey(row)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span>订单 {{ row.orderCount }}</span>
          <span>生产 {{ formatQuantity(row.productionPlanQuantity, row.unit) }}</span>
          <span>发货 {{ formatQuantity(row.shippedOrderQuantity, row.unit) }}</span>
        </div>
        <div v-show="isMobileStatisticsCardExpanded(summaryMobileCardKey(row))" class="mobile-card-fields">
          <div class="mobile-field">
            <label>订单数</label>
            <span>{{ row.orderCount }}</span>
          </div>
          <div class="mobile-field">
            <label>客户订单数量</label>
            <span>{{ formatQuantity(row.customerOrderQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>生产计划数量</label>
            <span>{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>实际完成数量</label>
            <span>{{ formatQuantity(row.completedProductionQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>订单发货数量</label>
            <span>{{ formatQuantity(row.shippedOrderQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>转库存数量</label>
            <span>{{ formatQuantity(row.stockQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>当前库存数量</label>
            <span>{{ formatQuantity(row.currentInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>当前订单库存数量</label>
            <span>{{ formatQuantity(row.currentOrderInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>当前备货库存数量</label>
            <span>{{ formatQuantity(row.currentStockInventoryQuantity, row.unit) }}</span>
          </div>
          <div class="mobile-field">
            <label>报废数量</label>
            <span>{{ formatQuantity(row.scrapQuantity, row.unit) }}</span>
          </div>
        </div>
      </article>
      <div v-if="!summaryRows.length && !loading" class="mobile-empty">暂无统计汇总</div>
    </div>

    <div class="table-card mt-24 desktop-table">
      <div class="panel-header">
        <h3 class="panel-title">订单展示</h3>
        <div v-if="!isMobileLayout" class="statistics-table-height-actions" aria-label="统计订单展示表格高度">
          <span class="statistics-table-height-label">统计订单展示表格高度</span>
          <el-button-group>
            <el-button
              :icon="Minus"
              :disabled="statisticsWorkTableHeights.orders <= statisticsWorkTableHeightLimits.min"
              title="降低统计订单展示表格高度"
              aria-label="降低统计订单展示表格高度"
              @click="adjustStatisticsWorkTableHeight('orders', -statisticsWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="Plus"
              :disabled="statisticsWorkTableHeights.orders >= statisticsWorkTableHeightLimits.max"
              title="提高统计订单展示表格高度"
              aria-label="提高统计订单展示表格高度"
              @click="adjustStatisticsWorkTableHeight('orders', statisticsWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="RefreshLeft"
              :disabled="statisticsWorkTableHeights.orders === statisticsWorkTableDefaultHeights.orders"
              title="恢复统计订单展示表格默认高度"
              aria-label="恢复统计订单展示表格默认高度"
              @click="resetStatisticsWorkTableHeight('orders')"
            />
          </el-button-group>
        </div>
      </div>
      <el-table v-loading="loading" :data="orderRows" :max-height="statisticsWorkTableHeights.orders">
        <el-table-column prop="periodLabel" label="统计周期" width="140" />
        <el-table-column label="订单号" min-width="180">
          <template #default="{ row }">
            <OrderNoLink :order-no="row.orderNo" />
          </template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="190" />
        <el-table-column label="订单日期" width="120">
          <template #default="{ row }">{{ formatDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="交期" width="120">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column prop="partCount" label="零件数" width="90" />
        <el-table-column label="客户订单数量" width="140">
          <template #default="{ row }">{{ formatOrderQuantity(row, 'totalQuantity') }}</template>
        </el-table-column>
        <el-table-column label="生产计划数量" width="140">
          <template #default="{ row }">{{ formatOrderQuantity(row, 'totalProductionPlanQuantity') }}</template>
        </el-table-column>
        <el-table-column label="订单状态" width="150">
          <template #default="{ row }">
            <StatusTag :value="statisticsOrderStatus(row)" />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="mobile-section">
      <h3 class="mobile-section-title">订单展示</h3>
      <article
        v-for="row in orderRows"
        :key="orderMobileCardKey(row)"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileStatisticsCardExpanded(orderMobileCardKey(row)) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong><OrderNoLink :order-no="row.orderNo" /></strong>
            <small>{{ row.periodLabel }} / {{ row.customerName }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <el-button
              link
              type="primary"
              :title="isMobileStatisticsCardExpanded(orderMobileCardKey(row)) ? '收起订单展示详情' : '查看订单展示详情'"
              @click="toggleMobileStatisticsCard(orderMobileCardKey(row))"
            >
              {{ isMobileStatisticsCardExpanded(orderMobileCardKey(row)) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span><StatusTag :value="statisticsOrderStatus(row)" compact /></span>
          <span>{{ row.partCount }} 个零件</span>
          <span>{{ formatOrderQuantity(row, 'totalQuantity') }}</span>
        </div>
        <div v-show="isMobileStatisticsCardExpanded(orderMobileCardKey(row))" class="mobile-card-fields">
          <div class="mobile-field">
            <label>订单状态</label>
            <span><StatusTag :value="statisticsOrderStatus(row)" compact /></span>
          </div>
          <div class="mobile-field">
            <label>订单日期</label>
            <span>{{ formatDate(row.orderDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>交期</label>
            <span>{{ formatDate(row.deliveryDate) }}</span>
          </div>
          <div class="mobile-field">
            <label>零件数</label>
            <span>{{ row.partCount }} 个</span>
          </div>
          <div class="mobile-field">
            <label>客户订单数量</label>
            <span>{{ formatOrderQuantity(row, 'totalQuantity') }}</span>
          </div>
          <div class="mobile-field">
            <label>生产计划数量</label>
            <span>{{ formatOrderQuantity(row, 'totalProductionPlanQuantity') }}</span>
          </div>
        </div>
      </article>
      <div v-if="!orderRows.length && !loading" class="mobile-empty">暂无订单展示</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Download, Minus, Plus, RefreshLeft } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import OrderNoLink from '../components/OrderNoLink.vue';
import StatusTag from '../components/StatusTag.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import type {
  OrderStatisticsCustomerRow,
  OrderStatisticsInventorySnapshotRow,
  OrderStatisticsOrderRow,
  OrderStatisticsOptions,
  OrderStatisticsResponse,
  OrderStatisticsSummaryRow,
  StatisticsPeriod
} from '../types/erp';
import { formatDate, formatQuantity } from '../utils/format';
import { orderDisplayStatus } from '../utils/orderStatus';
import { formatFileDateTime } from '../utils/tableExport';

const { isMobileLayout } = useDeviceProfile();
const statisticsBusinessTimeZone = 'Asia/Shanghai';
const currentBusinessDateText = businessDateText();
const currentBusinessYear = Number(currentBusinessDateText.substring(0, 4));
const activePeriod = ref<StatisticsPeriod>('year');
const year = ref(currentBusinessYear);
const quarter = ref<number | undefined>();
const month = ref<number | undefined>();
const customerId = ref('');
const loading = ref(false);
const statisticsExporting = ref(false);
const statistics = ref<OrderStatisticsResponse>();
const statisticsOptions = ref<OrderStatisticsOptions>();
const expandedMobileStatisticsCardKeys = ref<string[]>([]);
const defaultInventorySnapshotPageLimit = 20;
const inventorySnapshotPagination = reactive({
  page: 1,
  pageLimit: defaultInventorySnapshotPageLimit
});
const yearOptions = computed(() => {
  const optionYears = new Set<number>([
    ...(statisticsOptions.value?.years || []),
    statisticsOptions.value?.currentBusinessYear || currentBusinessYear,
    year.value
  ]);
  return [...optionYears]
    .filter((item) => Number.isInteger(item) && item >= 2000 && item <= 2100)
    .sort((a, b) => b - a);
});
const quarterOptions = [1, 2, 3, 4];
const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);
const quarterFilterDisabled = computed(() => activePeriod.value !== 'quarter');
const monthFilterDisabled = computed(() => activePeriod.value !== 'month');
const quarterFilterTitle = computed(() =>
  quarterFilterDisabled.value ? '只有季度统计使用季度筛选；年度和月度统计会自动忽略季度。' : '选择统计季度；不选则显示全年全部季度'
);
const monthFilterTitle = computed(() =>
  monthFilterDisabled.value ? '只有月度统计使用月份筛选；年度和季度统计会自动忽略月份。' : '选择统计月份；不选则显示全年全部月份'
);

type StatisticsWorkTableKey = 'totals' | 'summary' | 'customers' | 'orders' | 'inventorySnapshot';

const statisticsWorkTableHeightLimits = {
  min: 280,
  max: 760,
  step: 80
};

const statisticsWorkTableDefaultHeights: Record<StatisticsWorkTableKey, number> = {
  totals: 320,
  summary: 420,
  customers: 360,
  orders: 420,
  inventorySnapshot: 360
};

const statisticsWorkTableHeightStorageKey = 'baisheng.erp.statisticsWorkTableHeights.v1';
// 统计页表格高度只保存为本机 UI 偏好，不写入订单、生产、仓库或库存业务数据。
const statisticsWorkTableHeights = reactive<Record<StatisticsWorkTableKey, number>>({ ...statisticsWorkTableDefaultHeights });

const customerRows = computed(() => statistics.value?.customerRows || []);
const summaryRows = computed(() => statistics.value?.summaryRows || []);
const orderRows = computed(() => statistics.value?.orderRows || []);
const inventorySnapshotRows = computed(() => statistics.value?.inventorySnapshotRows || []);
const periodTitle = computed(() => {
  if (activePeriod.value === 'quarter') {
    return '季度';
  }
  if (activePeriod.value === 'month') {
    return '月度';
  }
  return '年度';
});
const statisticsExportScopeLabel = computed(() => {
  if (activePeriod.value === 'month') {
    return month.value ? `${year.value}年${month.value}月` : `${year.value}年全部月份`;
  }
  if (activePeriod.value === 'quarter') {
    return quarter.value ? `${year.value}年第${quarter.value}季度` : `${year.value}年全部季度`;
  }
  return `${year.value}年`;
});
const statisticsNarrowFilterHint = computed(() => {
  if (activePeriod.value === 'month') {
    return month.value ? '已按所选月份统计；季度筛选自动忽略。' : '未选择月份，默认显示全年全部月份汇总。';
  }
  if (activePeriod.value === 'quarter') {
    return quarter.value ? '已按所选季度统计；月份筛选自动忽略。' : '未选择季度，默认显示全年全部季度汇总。';
  }
  return '年度统计默认忽略季度和月份筛选。';
});
const statisticsFilterSummaryTitle = computed(() =>
  [
    `统计类型：${periodTitle.value}`,
    `统计范围：${statisticsExportScopeLabel.value}`,
    statisticsNarrowFilterHint.value,
    statisticsOptions.value?.years?.length ? `可选年份来自订单、生产、库存流水和报废记录：${statisticsOptions.value.years.join('、')}` : '',
    '统计页只读，不会修改订单、生产、仓库或库存数据。'
  ].filter(Boolean).join('；')
);

const totals = computed(() => ({
  orderCount: orderRows.value.length
}));
const statisticsCutoffNotice = computed(() => statistics.value?.cutoffNotice || '');

function businessDateText(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: statisticsBusinessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const partValue = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${partValue('year')}-${partValue('month')}-${partValue('day')}`;
}

function selectedStatisticsQuarter() {
  return activePeriod.value === 'quarter' ? quarter.value || undefined : undefined;
}

function selectedStatisticsMonth() {
  return activePeriod.value === 'month' ? month.value || undefined : undefined;
}

function normalizeStatisticsFiltersForActivePeriod() {
  if (activePeriod.value === 'year') {
    quarter.value = undefined;
    month.value = undefined;
    return;
  }
  if (activePeriod.value === 'quarter') {
    month.value = undefined;
    return;
  }
  quarter.value = undefined;
}

function handleQuarterChange(value?: number) {
  const alreadyOnQuarterStatisticsTab = activePeriod.value === 'quarter';
  if (value) {
    month.value = undefined;
    activePeriod.value = 'quarter';
    if (alreadyOnQuarterStatisticsTab) {
      void loadStatistics();
    }
    return;
  }
  if (alreadyOnQuarterStatisticsTab) {
    void loadStatistics();
  }
}

function handleMonthChange(value?: number) {
  const alreadyOnMonthStatisticsTab = activePeriod.value === 'month';
  if (value) {
    quarter.value = undefined;
    activePeriod.value = 'month';
    if (alreadyOnMonthStatisticsTab) {
      void loadStatistics();
    }
    return;
  }
  if (alreadyOnMonthStatisticsTab) {
    void loadStatistics();
  }
}

function handleYearChange() {
  void loadStatistics();
}

function selectedDefaultStatisticsYear() {
  return statisticsOptions.value?.currentBusinessYear || currentBusinessYear;
}

function emptyStatisticsResponse(): OrderStatisticsResponse {
  return {
    period: activePeriod.value,
    year: year.value,
    quarter: selectedStatisticsQuarter(),
    month: selectedStatisticsMonth(),
    currentBusinessDate: currentBusinessDateText,
    statisticsEndDate: currentBusinessDateText,
    isFuturePeriod: false,
    isCurrentPeriodPartial: false,
    cutoffNotice: '',
    inventorySnapshotRows: [],
    inventorySnapshotTotal: 0,
    inventorySnapshotLimit: inventorySnapshotPagination.pageLimit,
    inventorySnapshotOffset: 0,
    inventorySnapshotHasMore: false,
    customerRows: [],
    summaryRows: [],
    orderRows: []
  };
}

function clampStatisticsWorkTableHeight(value: number) {
  return Math.min(statisticsWorkTableHeightLimits.max, Math.max(statisticsWorkTableHeightLimits.min, value));
}

function adjustStatisticsWorkTableHeight(key: StatisticsWorkTableKey, delta: number) {
  statisticsWorkTableHeights[key] = clampStatisticsWorkTableHeight(statisticsWorkTableHeights[key] + delta);
}

function resetStatisticsWorkTableHeight(key: StatisticsWorkTableKey) {
  statisticsWorkTableHeights[key] = statisticsWorkTableDefaultHeights[key];
}

function restoreStatisticsWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const rawValue = window.localStorage.getItem(statisticsWorkTableHeightStorageKey);
    const savedHeights = rawValue ? JSON.parse(rawValue) as Partial<Record<StatisticsWorkTableKey, number>> : {};
    for (const key of Object.keys(statisticsWorkTableDefaultHeights) as StatisticsWorkTableKey[]) {
      const savedHeight = Number(savedHeights[key]);
      if (Number.isFinite(savedHeight)) {
        statisticsWorkTableHeights[key] = clampStatisticsWorkTableHeight(savedHeight);
      }
    }
  } catch {
    statisticsWorkTableHeights.totals = statisticsWorkTableDefaultHeights.totals;
    statisticsWorkTableHeights.summary = statisticsWorkTableDefaultHeights.summary;
    statisticsWorkTableHeights.customers = statisticsWorkTableDefaultHeights.customers;
    statisticsWorkTableHeights.orders = statisticsWorkTableDefaultHeights.orders;
    statisticsWorkTableHeights.inventorySnapshot = statisticsWorkTableDefaultHeights.inventorySnapshot;
  }
}

function saveStatisticsWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      statisticsWorkTableHeightStorageKey,
      JSON.stringify({
        totals: statisticsWorkTableHeights.totals,
        summary: statisticsWorkTableHeights.summary,
        customers: statisticsWorkTableHeights.customers,
        orders: statisticsWorkTableHeights.orders,
        inventorySnapshot: statisticsWorkTableHeights.inventorySnapshot
      })
    );
  } catch {
    // 本机 UI 偏好写入失败不阻断只读统计查询。
  }
}

type QuantitySummaryField = Extract<
  keyof OrderStatisticsSummaryRow,
  | 'customerOrderQuantity'
  | 'productionPlanQuantity'
  | 'completedProductionQuantity'
  | 'shippedOrderQuantity'
  | 'stockQuantity'
  | 'currentInventoryQuantity'
  | 'currentOrderInventoryQuantity'
  | 'currentStockInventoryQuantity'
  | 'scrapQuantity'
>;

type StatisticsTotalRow = {
  key: string;
  range: string;
  metric: string;
  quantity: number;
  unit: string;
};

const totalRows = computed<StatisticsTotalRow[]>(() => {
  const rows: StatisticsTotalRow[] = [
    {
      key: 'order-count',
      range: '全部客户合计',
      metric: '订单数',
      quantity: orderRows.value.length,
      unit: '单'
    }
  ];
  const metrics: Array<{ field: QuantitySummaryField; label: string }> = [
    { field: 'customerOrderQuantity', label: '客户订单数量' },
    { field: 'productionPlanQuantity', label: '生产计划数量' },
    { field: 'completedProductionQuantity', label: '实际完成数量' },
    { field: 'shippedOrderQuantity', label: '订单发货数量' },
    { field: 'stockQuantity', label: '转库存数量' },
    { field: 'currentInventoryQuantity', label: '当前库存数量' },
    { field: 'currentOrderInventoryQuantity', label: '当前订单库存数量' },
    { field: 'currentStockInventoryQuantity', label: '当前备货库存数量' },
    { field: 'scrapQuantity', label: '报废数量' }
  ];
  for (const metric of metrics) {
    const quantityRows = totalQuantityRows(metric.field);
    for (const row of quantityRows) {
      rows.push({
        key: `${metric.field}:${row.unit}`,
        range: '全部客户合计',
        metric: metric.label,
        quantity: row.quantity,
        unit: row.unit
      });
    }
  }
  return rows;
});
const inventorySnapshotTriggeredAlertCount = computed(() => inventorySnapshotRows.value.filter((row) => row.stockAlertTriggered).length);
const inventorySnapshotTotal = computed(() => statistics.value?.inventorySnapshotTotal ?? inventorySnapshotRows.value.length);
const inventorySnapshotHasMore = computed(
  () =>
    statistics.value?.inventorySnapshotHasMore ??
    inventorySnapshotPagination.page * inventorySnapshotPagination.pageLimit < inventorySnapshotTotal.value
);

function totalQuantityRows(field: QuantitySummaryField) {
  const totalByUnit = new Map<string, number>();
  for (const row of summaryRows.value) {
    const unit = row.unit || '件';
    totalByUnit.set(unit, (totalByUnit.get(unit) ?? 0) + Number(row[field] ?? 0));
  }
  return totalByUnit.size > 0
    ? Array.from(totalByUnit.entries()).map(([unit, quantity]) => ({ unit, quantity }))
    : [{ unit: '件', quantity: 0 }];
}

function formatTotalQuantity(field: QuantitySummaryField) {
  // 统计卡片不能把不同单位强行合并；按单位分别汇总，避免把“件”和“套”显示成同一种数量。
  return totalQuantityRows(field)
    .map(({ unit, quantity }) => formatQuantity(quantity, unit))
    .join(' / ');
}

function formatOrderQuantity(row: OrderStatisticsOrderRow, field: 'totalQuantity' | 'totalProductionPlanQuantity') {
  if (row.quantityByUnit?.length) {
    return row.quantityByUnit.map((item) => formatQuantity(item[field], item.unit)).join(' / ');
  }
  return formatQuantity(row[field], row.unit);
}

function statisticsOrderStatus(row: OrderStatisticsOrderRow) {
  return row.statisticsStatus || orderDisplayStatus(row);
}

function totalMobileCardKey(row: StatisticsTotalRow) {
  return `total:${row.key}`;
}

function summaryMobileCardKey(row: OrderStatisticsSummaryRow) {
  return `summary:${row.periodKey}:${row.partCode}:${row.unit || 'unit'}`;
}

function customerMobileCardKey(row: OrderStatisticsCustomerRow) {
  return `customer:${row.periodKey}:${row.customerId || row.customerName}:${row.unit || 'unit'}`;
}

function orderMobileCardKey(row: OrderStatisticsOrderRow) {
  return `order:${row.periodKey}:${row.orderNo}`;
}

function inventorySnapshotMobileCardKey(row: OrderStatisticsInventorySnapshotRow) {
  return `inventory:${row.partCode}:${row.unit || 'unit'}`;
}

function isMobileStatisticsCardExpanded(key: string) {
  return expandedMobileStatisticsCardKeys.value.includes(key);
}

function toggleMobileStatisticsCard(key: string) {
  expandedMobileStatisticsCardKeys.value = isMobileStatisticsCardExpanded(key)
    ? expandedMobileStatisticsCardKeys.value.filter((item) => item !== key)
    : [...expandedMobileStatisticsCardKeys.value, key];
}

type LoadStatisticsOptions = {
  resetInventorySnapshotPage?: boolean;
};

async function loadStatisticsOptions() {
  try {
    statisticsOptions.value = await erpApi.orderStatisticsOptions();
    if (!yearOptions.value.includes(year.value)) {
      year.value = statisticsOptions.value.currentBusinessYear || currentBusinessYear;
    }
  } catch (error) {
    statisticsOptions.value = {
      years: [currentBusinessYear],
      currentBusinessDate: currentBusinessDateText,
      currentBusinessYear,
      currentBusinessQuarter: Math.floor((Number(currentBusinessDateText.substring(5, 7)) - 1) / 3) + 1,
      currentBusinessMonth: Number(currentBusinessDateText.substring(5, 7))
    };
    ElMessage.warning(error instanceof Error ? `统计年份选项加载失败：${error.message}` : '统计年份选项加载失败，已使用当前年份');
  }
}

async function loadStatistics(options: LoadStatisticsOptions = { resetInventorySnapshotPage: true }) {
  if (options.resetInventorySnapshotPage !== false) {
    inventorySnapshotPagination.page = 1;
  }
  loading.value = true;
  try {
    // 统计页为只读页面，筛选只限制展示范围，不提供任何订单、生产、仓库操作。
    statistics.value = await erpApi.orderStatistics({
      period: activePeriod.value,
      year: year.value,
      quarter: selectedStatisticsQuarter(),
      month: selectedStatisticsMonth(),
      customerId: customerId.value || undefined,
      inventorySnapshotLimit: inventorySnapshotPagination.pageLimit,
      inventorySnapshotOffset: (inventorySnapshotPagination.page - 1) * inventorySnapshotPagination.pageLimit
    });
  } catch (error) {
    statistics.value = emptyStatisticsResponse();
    expandedMobileStatisticsCardKeys.value = [];
    ElMessage.error(error instanceof Error ? error.message : '统计数据加载失败，请确认后端服务和筛选条件');
  } finally {
    loading.value = false;
  }
}

async function refreshStatistics() {
  await loadStatisticsOptions();
  await loadStatistics();
}

async function exportStatisticsExcel() {
  if (statisticsExporting.value) {
    return;
  }
  statisticsExporting.value = true;
  try {
    // 统计导出复用当前只读筛选条件，不修改订单、生产、仓库或库存业务数据。
    await erpApi.downloadStatisticsExport(
      {
        period: activePeriod.value,
        year: year.value,
        quarter: selectedStatisticsQuarter(),
        month: selectedStatisticsMonth(),
        customerId: customerId.value || undefined
      },
      `订单统计表_${periodTitle.value}_${statisticsExportScopeLabel.value}_${formatFileDateTime()}.xlsx`
    );
    ElMessage.success('统计 Excel 已导出');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '统计 Excel 导出失败');
  } finally {
    statisticsExporting.value = false;
  }
}

function resetStatisticsFilters() {
  customerId.value = '';
  year.value = selectedDefaultStatisticsYear();
  quarter.value = undefined;
  month.value = undefined;
  if (activePeriod.value === 'year') {
    void loadStatistics();
    return;
  }
  activePeriod.value = 'year';
}

watch(activePeriod, () => {
  normalizeStatisticsFiltersForActivePeriod();
  void loadStatistics();
});

watch(
  () => [
    statisticsWorkTableHeights.totals,
    statisticsWorkTableHeights.summary,
    statisticsWorkTableHeights.customers,
    statisticsWorkTableHeights.orders,
    statisticsWorkTableHeights.inventorySnapshot
  ],
  () => saveStatisticsWorkTableHeights()
);

function handleInventorySnapshotPageChange(page: number) {
  inventorySnapshotPagination.page = page;
  void loadStatistics({ resetInventorySnapshotPage: false });
}

function handleInventorySnapshotPageSizeChange(pageLimit: number) {
  inventorySnapshotPagination.pageLimit = pageLimit;
  inventorySnapshotPagination.page = 1;
  void loadStatistics({ resetInventorySnapshotPage: false });
}

function loadInventorySnapshotPreviousPage() {
  if (inventorySnapshotPagination.page <= 1 || loading.value) {
    return;
  }
  inventorySnapshotPagination.page -= 1;
  void loadStatistics({ resetInventorySnapshotPage: false });
}

function loadInventorySnapshotNextPage() {
  if (!inventorySnapshotHasMore.value || loading.value) {
    return;
  }
  inventorySnapshotPagination.page += 1;
  void loadStatistics({ resetInventorySnapshotPage: false });
}

function inventorySnapshotStockAlertText(row: OrderStatisticsInventorySnapshotRow) {
  if (!row.stockAlertEnabled) {
    return '未启用';
  }
  const alertQuantity = row.stockAlertQuantity === null || row.stockAlertQuantity === undefined ? '-' : formatQuantity(row.stockAlertQuantity, row.unit);
  return row.stockAlertTriggered ? `低库存：低于 ${alertQuantity}` : `正常：下限 ${alertQuantity}`;
}

function inventorySnapshotStockAlertTagType(row: OrderStatisticsInventorySnapshotRow) {
  if (!row.stockAlertEnabled) {
    return 'info';
  }
  return row.stockAlertTriggered ? 'danger' : 'success';
}

onMounted(async () => {
  restoreStatisticsWorkTableHeights();
  await loadStatisticsOptions();
  await loadStatistics();
});
</script>

<style scoped>
.statistics-filter {
  margin-bottom: 12px;
}

.statistics-filter-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: -4px 0 10px;
  color: #475569;
  font-size: 13px;
  line-height: 1.5;
}

.statistics-filter-summary span:first-child {
  color: #0f172a;
  font-weight: 700;
}

.statistics-tabs {
  margin-bottom: 18px;
}

.statistics-table-height-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.statistics-table-height-label {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
}

.inventory-snapshot-summary {
  color: #64748b;
  display: inline-flex;
  flex-wrap: wrap;
  font-size: 13px;
  gap: 10px;
}
</style>
