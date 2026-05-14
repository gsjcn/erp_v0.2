<template>
  <section class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">零件管理</h2>
        <p class="page-subtitle">下单前维护零件搜索记忆、适用范围、机型 BOM 和最近历史用料；库存数量由 InventoryBatch 独立计算。</p>
      </div>
      <div class="page-actions">
        <el-button @click="openDesktopMaintenancePage('/inventory/materials', '零件基础库维护')">零件基础库</el-button>
        <el-button @click="openDesktopMaintenancePage('/inventory/model-boms', '机型零件包维护')">机型零件包</el-button>
        <el-button @click="openDesktopMaintenancePage('/inventory/material-transforms', '来源加工关系维护')">来源加工关系</el-button>
        <el-button v-if="!isMobileLayout" type="primary" @click="openCreateDialog">新增零件</el-button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">筛选结果</div>
        <div class="stat-value">{{ dashboard.summary.totalCount }}</div>
      </div>
      <button class="stat-card stat-action" :class="{ active: filters.scopeType === 'COMMON' }" type="button" @click="applyScopeTypeFilter('COMMON')">
        <div class="stat-label">通用件</div>
        <div class="stat-value">{{ dashboard.summary.commonCount }}</div>
      </button>
      <button class="stat-card stat-action" :class="{ active: filters.scopeType === 'CUSTOM' }" type="button" @click="applyScopeTypeFilter('CUSTOM')">
        <div class="stat-label">定制件</div>
        <div class="stat-value">{{ dashboard.summary.customCount }}</div>
      </button>
      <button class="stat-card stat-action" :class="{ active: filters.bomPresence === 'WITH_BOM' }" type="button" @click="applyBomPresenceFilter('WITH_BOM')">
        <div class="stat-label">已进 BOM</div>
        <div class="stat-value">{{ dashboard.summary.withBomCount }}</div>
      </button>
      <button class="stat-card stat-action" :class="{ active: filters.bomPresence === 'WITHOUT_BOM' }" type="button" @click="applyBomPresenceFilter('WITHOUT_BOM')">
        <div class="stat-label">未进 BOM</div>
        <div class="stat-value">{{ dashboard.summary.withoutBomCount }}</div>
      </button>
      <button class="stat-card stat-action" :class="{ active: filters.recentOrderPresence === 'WITH_RECENT_ORDER' }" type="button" @click="applyRecentOrderPresenceFilter('WITH_RECENT_ORDER')">
        <div class="stat-label">有历史下单</div>
        <div class="stat-value">{{ dashboard.summary.withRecentOrderCount }}</div>
      </button>
      <button class="stat-card stat-action" :class="{ active: filters.recentOrderPresence === 'WITHOUT_RECENT_ORDER' }" type="button" @click="applyRecentOrderPresenceFilter('WITHOUT_RECENT_ORDER')">
        <div class="stat-label">无历史下单</div>
        <div class="stat-value">{{ dashboard.summary.withoutRecentOrderCount }}</div>
      </button>
    </div>

    <div class="summary-filter-grid">
      <button
        v-for="item in relationSummaryItems"
        :key="item.value"
        class="summary-filter-chip"
        :class="{ active: filters.relationType === item.value }"
        type="button"
        @click="applyRelationFilter(item.value)"
      >
        <span>{{ item.label }}</span>
        <strong>{{ item.count }}</strong>
      </button>
      <button
        v-for="item in drawingSourceSummaryItems"
        :key="item.value"
        class="summary-filter-chip"
        :class="{ active: filters.drawingSource === item.value }"
        type="button"
        @click="applyDrawingSourceFilter(item.value)"
      >
        <span>{{ item.label }}</span>
        <strong>{{ item.count }}</strong>
      </button>
      <button
        v-for="item in bomStructureSummaryItems"
        :key="item.value"
        class="summary-filter-chip"
        :class="{ active: filters.bomStructureType === item.value }"
        type="button"
        @click="applyBomStructureFilter(item.value)"
      >
        <span>{{ item.label }}</span>
        <strong>{{ item.count }}</strong>
      </button>
    </div>

    <el-alert
      class="relation-boundary-alert"
      type="info"
      :closable="false"
      show-icon
      title="订单历史不等于正式适用范围"
      description="新增订单或 Excel 导入只会补建零件搜索记忆，并在这里显示为订单历史；不会自动变成全部客户通用、客户私有 BOM 或正式适用范围。需要固定推荐时，请维护适用范围或 BOM。"
    />

    <div v-if="activeFilterItems.length" class="active-filter-bar">
      <span>当前筛选</span>
      <button
        v-for="item in activeFilterItems"
        :key="item.key"
        class="active-filter-chip"
        type="button"
        @click="clearActiveFilter(item.key)"
      >
        {{ item.label }}
        <span>×</span>
      </button>
      <el-button size="small" @click="resetFilters">清除全部</el-button>
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect
          v-model="filters.customerId"
          placeholder="全部客户"
          width="240px"
          @change="handleCustomerChange"
          @selected-customer-change="handleSelectedCustomerChange"
        />
      </div>
      <div class="filter-field">
        <label>机型 / 项目</label>
        <el-select
          v-model="filters.projectModel"
          clearable
          filterable
          allow-create
          placeholder="全部机型 / 项目"
          style="width: 210px"
          @change="resetAndLoad"
        >
          <el-option v-for="item in projectOptions" :key="item" :label="item" :value="item" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>零件关键字</label>
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="编码 / 名称 / 客户 / 订单 / 规格"
          style="width: 280px"
          @keyup.enter="resetAndLoad"
        />
      </div>
      <div class="filter-field">
        <label>通用 / 定制</label>
        <el-select v-model="filters.scopeType" clearable placeholder="全部" style="width: 140px" @change="resetAndLoad">
          <el-option label="通用件" value="COMMON" />
          <el-option label="定制件" value="CUSTOM" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>当前关系</label>
        <el-select v-model="filters.relationType" clearable placeholder="全部" style="width: 150px" @change="resetAndLoad">
          <el-option label="BOM 零件" value="BOM" />
          <el-option label="显式适用" value="APPLICABILITY" />
          <el-option label="订单历史" value="ORDER_HISTORY" />
          <el-option label="仅搜索记忆" value="MATERIAL_ONLY" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>图号</label>
        <el-input v-model="filters.drawingNo" clearable placeholder="图号" style="width: 180px" @keyup.enter="resetAndLoad" />
      </div>
      <div class="filter-field">
        <label>图纸状态</label>
        <el-input v-model="filters.drawingStatus" clearable placeholder="旧图 / 新图" style="width: 140px" @keyup.enter="resetAndLoad" />
      </div>
      <div class="filter-field">
        <label>图纸来源</label>
        <el-select v-model="filters.drawingSource" clearable placeholder="全部" style="width: 160px" @change="resetAndLoad">
          <el-option label="BOM 指定图纸" value="BOM_LINE" />
          <el-option label="零件默认图纸" value="MATERIAL_DEFAULT" />
          <el-option label="零件最新图纸" value="MATERIAL_LATEST" />
          <el-option label="历史订单图纸" value="ORDER_HISTORY" />
          <el-option label="无图纸" value="NONE" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>BOM 结构</label>
        <el-select v-model="filters.bomStructureType" clearable placeholder="全部" style="width: 160px" @change="resetAndLoad">
          <el-option label="组件" value="COMPONENT" />
          <el-option label="子零件" value="CHILD_PART" />
          <el-option label="单独零件" value="STANDALONE_PART" />
          <el-option label="未进 BOM" value="NONE" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>BOM 状态</label>
        <el-select v-model="filters.bomPresence" clearable placeholder="全部" style="width: 140px" @change="handleBomPresenceChange">
          <el-option label="已进 BOM" value="WITH_BOM" />
          <el-option label="未进 BOM" value="WITHOUT_BOM" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>图纸日期</label>
        <DateRangeFilter v-model="drawingDateRange" width="220px" @change="resetAndLoad" />
      </div>
      <div class="filter-field">
        <label>最近下单</label>
        <DateRangeFilter v-model="lastOrderDateRange" width="220px" @change="handleLastOrderDateRangeChange" />
      </div>
      <div class="filter-field">
        <label>下单记录</label>
        <el-select v-model="filters.recentOrderPresence" clearable placeholder="全部" style="width: 140px" @change="resetAndLoad">
          <el-option label="有历史下单" value="WITH_RECENT_ORDER" />
          <el-option label="无历史下单" value="WITHOUT_RECENT_ORDER" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" clearable placeholder="全部" style="width: 120px" @change="resetAndLoad">
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>排序字段</label>
        <el-select v-model="filters.sortBy" placeholder="排序字段" style="width: 150px" @change="resetAndLoad">
          <el-option label="最近下单" value="LAST_ORDER_DATE" />
          <el-option label="图纸日期" value="DRAWING_DATE" />
          <el-option label="BOM 状态" value="BOM_STATUS" />
          <el-option label="零件编码" value="PART_CODE" />
          <el-option label="更新时间" value="UPDATED_AT" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>排序顺序</label>
        <el-select v-model="filters.sortOrder" placeholder="排序顺序" style="width: 120px" @change="resetAndLoad">
          <el-option label="降序" value="DESC" />
          <el-option label="升序" value="ASC" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="resetAndLoad">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="project-quick-list">
      <div class="project-quick-toolbar">
        <span>常用机型</span>
        <el-tag class="project-quick-state" :type="commonProjectSyncTagType" effect="plain">
          {{ commonProjectSyncText }}
        </el-tag>
        <el-select
          v-if="!isMobileLayout"
          v-model="commonProjectCandidate"
          filterable
          clearable
          allow-create
          placeholder="搜索机型加入常用"
          style="width: min(220px, 100%)"
          :disabled="commonProjectBusy"
          @change="addCommonProjectFromSelect"
        >
          <el-option v-for="item in commonProjectSelectOptions" :key="item" :label="item" :value="item" />
        </el-select>
        <el-button
          v-if="!isMobileLayout"
          size="small"
          plain
          :loading="commonProjectLoading"
          :disabled="commonProjectBusy"
          @click="refreshCommonProjects"
        >
          刷新常用
        </el-button>
        <el-button
          v-if="!isMobileLayout"
          size="small"
          plain
          :disabled="commonProjectBusy || !filters.projectModel.trim() || isCommonProject(filters.projectModel)"
          @click="addCommonProject(filters.projectModel)"
        >
          设为常用
        </el-button>
        <el-button v-if="!isMobileLayout" size="small" plain :disabled="commonProjectBusy" @click="resetCommonProjectsToDefault">
          恢复默认 B3/B5
        </el-button>
      </div>
      <span class="project-quick-hint">默认 B3/B5；可搜索机型加入常用，拖拽手柄调整顺序，移除常用只隐藏快捷入口，不删除 BOM 或零件资料。</span>
      <div
        v-for="item in quickProjectOptions"
        :key="item"
        class="project-quick-item"
        :class="{
          'is-dragging': draggedCommonProjectKey === projectModelKey(item),
          'is-drop-before': commonProjectDragOverKey === projectModelKey(item) && !commonProjectDragInsertAfter,
          'is-drop-after': commonProjectDragOverKey === projectModelKey(item) && commonProjectDragInsertAfter
        }"
        @dragover.prevent="handleCommonProjectDragOver($event, item)"
        @drop.prevent="dropCommonProject($event, item)"
      >
        <button
          class="project-quick-drag-handle"
          :class="{ 'is-disabled': quickProjectOptions.length <= 1 || commonProjectBusy }"
          type="button"
          v-if="!isMobileLayout"
          :draggable="quickProjectOptions.length > 1 && !commonProjectBusy"
          :disabled="commonProjectBusy"
          :title="quickProjectOptions.length > 1 ? '拖拽调整常用机型顺序' : '当前只有 1 个常用机型'"
          aria-label="拖拽调整常用机型顺序"
          @click.stop
          @dragstart.stop="startCommonProjectDrag($event, item)"
          @dragend="endCommonProjectDrag"
        >
          <el-icon><Rank /></el-icon>
        </button>
        <el-button
          class="project-quick-filter"
          size="small"
          :type="filters.projectModel === item ? 'primary' : 'default'"
          plain
          @click="selectProject(item)"
        >
          {{ item }}
        </el-button>
        <el-button
          v-if="!isMobileLayout"
          size="small"
          type="primary"
          plain
          :disabled="Boolean(bomOperationSavingKey)"
          @click="openProjectBomMaintain(item)"
        >
          查看/编辑BOM
        </el-button>
        <el-button
          v-if="!isMobileLayout"
          size="small"
          type="danger"
          plain
          :loading="bomOperationSavingKey === projectBomOperationKey(item, 'disable')"
          :disabled="Boolean(bomOperationSavingKey)"
          @click="disableProjectBom(item)"
        >
          停用BOM
        </el-button>
        <el-button
          v-if="!isMobileLayout"
          size="small"
          type="success"
          plain
          :loading="bomOperationSavingKey === projectBomOperationKey(item, 'enable')"
          :disabled="Boolean(bomOperationSavingKey)"
          @click="enableProjectBom(item)"
        >
          启用BOM
        </el-button>
        <el-button
          v-if="!isMobileLayout"
          size="small"
          type="danger"
          plain
          :loading="bomOperationSavingKey === projectBomOperationKey(item, 'delete')"
          :disabled="Boolean(bomOperationSavingKey)"
          @click="deleteProjectBom(item)"
        >
          删除BOM
        </el-button>
        <el-button v-if="!isMobileLayout" size="small" plain :disabled="commonProjectBusy" @click="removeCommonProject(item)">
          移除常用
        </el-button>
        <span v-else class="mobile-readonly-note">手机端只查看常用机型</span>
      </div>
      <span class="project-quick-hint">误操作创建的无效 BOM 可永久删除；正常暂不用的 BOM 建议停用。查看/编辑会进入机型零件包页维护表头、明细和拖拽顺序。</span>
    </div>

    <div v-if="contextBomPanelVisible" v-loading="contextBomLoading" class="context-bom-panel">
      <div class="section-heading">
        <div>
          <strong>当前适用零件包</strong>
          <span>{{ contextBomScopeText }}，共 {{ contextBomTotalCount }} 个，启用 {{ contextBomActiveCount }} 个</span>
        </div>
        <div v-if="!isMobileLayout" class="section-actions">
          <el-button size="small" type="success" plain :disabled="Boolean(bomOperationSavingKey)" @click="openContextBomCreate">
            新建零件包
          </el-button>
          <el-button size="small" type="success" plain :disabled="Boolean(bomOperationSavingKey)" @click="openContextCommonBomCreate">
            新建常用零件包
          </el-button>
          <el-button size="small" type="primary" plain :disabled="Boolean(bomOperationSavingKey)" @click="openContextBomMaintain">
            维护零件包
          </el-button>
          <el-button size="small" plain :disabled="!contextBomFixedText" @click="openContextBomTextDialog">查看范围格式</el-button>
          <el-button size="small" plain :disabled="!contextBomFixedText" @click="copyContextBomText">复制范围</el-button>
        </div>
      </div>
      <div class="context-bom-scope-summary">
        <el-button size="small" :type="contextBomScopeFilter === 'ALL' ? 'primary' : 'default'" plain @click="toggleContextBomScopeFilter('ALL')">
          全部客户通用 {{ contextBomAllCustomerCount }}
        </el-button>
        <el-button size="small" :type="contextBomScopeFilter === 'SELECTED' ? 'primary' : 'default'" plain @click="toggleContextBomScopeFilter('SELECTED')">
          指定客户可用 {{ contextBomSelectedCustomerCount }}
        </el-button>
        <el-button size="small" :type="contextBomScopeFilter === 'PRIVATE' ? 'primary' : 'default'" plain @click="toggleContextBomScopeFilter('PRIVATE')">
          客户私有 {{ contextBomPrivateCount }}
        </el-button>
        <el-button
          size="small"
          :type="contextBomCommonOnly ? 'primary' : 'default'"
          plain
          @click="toggleContextBomCommonOnly"
        >
          只看常用 {{ contextBomCommonCount }}
        </el-button>
        <el-button
          v-if="!isMobileLayout"
          size="small"
          plain
          :disabled="!contextBomScopeFilter || Boolean(bomOperationSavingKey)"
          @click="openContextBomMaintainByScope(contextBomScopeFilter || 'ALL')"
        >
          维护当前范围
        </el-button>
        <span class="context-bom-common-hint">
          客户零件包也可以设为常用；常用只影响当前范围的显示顺序和下单推荐优先级，不修改 BOM 明细、适用客户、订单、生产任务或库存。
        </span>
      </div>
      <el-empty v-if="!contextBomLoading && contextBomVisibleRows.length === 0" :description="contextBomEmptyDescription">
        <el-button v-if="!isMobileLayout" type="primary" plain :disabled="Boolean(bomOperationSavingKey)" @click="openContextBomCreate">
          新建零件包
        </el-button>
        <el-button v-if="!isMobileLayout" type="success" plain :disabled="Boolean(bomOperationSavingKey)" @click="openContextCommonBomCreate">
          新建常用零件包
        </el-button>
      </el-empty>
      <div v-else class="context-bom-grid">
        <article
          v-for="bom in contextBomVisibleRows"
          :key="bom.id"
          class="context-bom-card"
          :class="{ 'is-common-drop-target': contextBomDragOverId === bom.id }"
          @dragover.prevent="handleContextBomDragOver($event, bom)"
          @drop.prevent="dropContextBom(bom)"
        >
          <div class="context-bom-card__header">
            <div>
              <strong>{{ bom.bomName }}</strong>
              <span>{{ bom.scopeLabel }}</span>
            </div>
            <button
              v-if="bom.status === 'ENABLED' && bom.isCommon && !isMobileLayout"
              class="context-bom-common-drag-handle"
              :class="{ 'is-disabled': Boolean(bomOperationSavingKey) || contextBomCommonDragRowsForScope(bom).length <= 1 }"
              type="button"
              :draggable="!bomOperationSavingKey && contextBomCommonDragRowsForScope(bom).length > 1"
              :title="contextBomCommonDragRowsForScope(bom).length > 1 ? '拖拽调整同一范围内的常用 BOM 顺序' : '当前范围只有 1 个常用 BOM'"
              aria-label="拖拽调整常用 BOM 顺序"
              @click.stop
              @dragstart.stop="startContextBomDrag($event, bom)"
              @dragend="endContextBomDrag"
            >
              <el-icon><Rank /></el-icon>
            </button>
            <el-tag :type="contextBomScopeTagType(bom)" effect="plain">
              {{ contextBomScopeTypeLabel(bom) }}
            </el-tag>
            <el-tag :type="bom.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
              {{ bom.status === 'ENABLED' ? '启用' : '停用' }}
            </el-tag>
            <el-tag v-if="bom.isCommon" type="success" effect="plain" :title="`常用显示顺序 ${contextBomCommonDisplayOrder(bom) || '-'}`">
              常用 {{ contextBomCommonDisplayOrder(bom) }}
            </el-tag>
          </div>
          <div class="context-bom-tags">
            <el-tag effect="plain" type="warning">组件 {{ contextBomSummary(bom).componentCount }}</el-tag>
            <el-tag effect="plain" type="success">子零件 {{ contextBomSummary(bom).childPartCount }}</el-tag>
            <el-tag effect="plain" type="info">单独零件 {{ contextBomSummary(bom).standalonePartCount }}</el-tag>
            <el-tag v-if="contextBomSummary(bom).disabledCount > 0" effect="plain" type="info">停用 {{ contextBomSummary(bom).disabledCount }}</el-tag>
          </div>
          <div class="context-bom-lines">
            <div v-for="line in contextBomPreviewLines(bom)" :key="line.id" class="context-bom-line">
              <el-tag size="small" :type="contextBomStructureTagType(line)" effect="plain">
                {{ contextBomStructureLabel(line) }}
              </el-tag>
              <span>{{ line.partCode }} / {{ line.partName }}</span>
              <small>顺序 {{ contextBomLineDisplayOrder(bom, line) }} · 默认 {{ formatQuantity(line.defaultQuantity, line.unit) }}</small>
            </div>
            <div
              v-if="contextBomSummary(bom).activeLineCount > contextBomPreviewLines(bom).length"
              class="context-bom-more"
            >
              前 {{ contextBomPreviewLines(bom).length }} / {{ contextBomSummary(bom).activeLineCount }} 行
            </div>
          </div>
          <div class="context-bom-actions">
            <el-tag v-if="contextCustomerBomForSource(bom)" effect="plain" type="warning">已有客户 BOM</el-tag>
            <template v-if="!isMobileLayout">
              <el-button
                v-if="canCopyContextBomToCustomer(bom)"
                link
                type="success"
                :disabled="Boolean(bomOperationSavingKey)"
                @click="openContextBomCopy(bom)"
              >
                复制给当前客户
              </el-button>
              <el-button
                v-else-if="contextCustomerBomForSource(bom)"
                link
                type="primary"
                :disabled="Boolean(bomOperationSavingKey)"
                @click="openContextCustomerBomDetail(bom)"
              >
                打开客户 BOM
              </el-button>
              <el-button
                v-if="bom.status === 'ENABLED' && !bom.isCommon"
                link
                type="success"
                :loading="bomOperationSavingKey === contextBomOperationKey(bom, 'common')"
                :disabled="Boolean(bomOperationSavingKey)"
                @click="setContextBomCommon(bom, true)"
              >
                设为常用
              </el-button>
              <el-button
                v-else-if="bom.status === 'ENABLED'"
                link
                type="warning"
                :loading="bomOperationSavingKey === contextBomOperationKey(bom, 'common')"
                :disabled="Boolean(bomOperationSavingKey)"
                @click="setContextBomCommon(bom, false)"
              >
                取消常用
              </el-button>
              <el-button link type="primary" :disabled="Boolean(bomOperationSavingKey)" @click="openContextBomDetail(bom)">
                查看/编辑
              </el-button>
              <el-button
                v-if="bom.status === 'ENABLED'"
                link
                type="danger"
                :loading="bomOperationSavingKey === contextBomOperationKey(bom, 'disable')"
                :disabled="Boolean(bomOperationSavingKey)"
                @click="disableContextBom(bom)"
              >
                停用
              </el-button>
              <el-button
                v-else
                link
                type="success"
                :loading="bomOperationSavingKey === contextBomOperationKey(bom, 'enable')"
                :disabled="Boolean(bomOperationSavingKey)"
                @click="enableContextBom(bom)"
              >
                恢复启用
              </el-button>
              <el-button
                link
                type="danger"
                :loading="bomOperationSavingKey === contextBomOperationKey(bom, 'delete')"
                :disabled="Boolean(bomOperationSavingKey)"
                @click="deleteContextBom(bom)"
              >
                删除
              </el-button>
            </template>
            <span v-else class="mobile-readonly-note">手机端只查看零件包</span>
          </div>
        </article>
      </div>
    </div>

    <div class="table-card desktop-table">
      <div class="section-heading">
        <div>
          <strong>零件控制面板</strong>
          <span>第 {{ pagination.page }} 页，已显示 {{ dashboard.items.length }} / {{ dashboard.totalCount }} 条</span>
        </div>
        <div class="section-actions">
          <el-button size="small" :disabled="dashboard.items.length === 0" @click="openDashboardTextDialog">查看固定格式</el-button>
          <el-button size="small" :disabled="dashboard.items.length === 0" @click="copyDashboardText">复制当前页</el-button>
        </div>
      </div>
      <el-table v-loading="loading" :data="dashboard.items" max-height="640">
        <el-table-column prop="partCode" label="零件编码" min-width="150" fixed="left" />
        <el-table-column prop="partName" label="零件名称" min-width="170" fixed="left" />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag :type="row.scopeType === 'COMMON' ? 'success' : 'warning'" effect="plain">{{ row.partType || row.scopeLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="当前关系" min-width="170">
          <template #default="{ row }">
            <el-tag :type="materialRelationTagType(row.currentRelationType)" effect="plain">
              {{ row.currentRelationLabel || '-' }}
            </el-tag>
            <div class="cell-subtext">{{ row.currentRelationDescription || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="所属客户" min-width="180">
          <template #default="{ row }">{{ joinPreview(row.customerNames, '全部客户') }}</template>
        </el-table-column>
        <el-table-column label="机型 / 项目" min-width="160">
          <template #default="{ row }">{{ joinPreview(materialProjectScopeValues(row), '全部机型') }}</template>
        </el-table-column>
        <el-table-column label="图纸" min-width="210">
          <template #default="{ row }">
            <div>{{ row.drawingNo || '-' }}</div>
            <div class="cell-subtext">{{ [row.drawingVersion, row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ') || '-' }}</div>
            <el-tag v-if="row.drawingSourceLabel" size="small" effect="plain">{{ row.drawingSourceLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="厚度 / 规格" min-width="170">
          <template #default="{ row }">
            <div>{{ row.partThickness ?? '-' }}</div>
            <div class="cell-subtext">{{ row.partSpecification || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="默认数量" width="120">
          <template #default="{ row }">{{ row.defaultQuantity ? formatQuantity(row.defaultQuantity, row.defaultQuantityUnit || row.unit) : '-' }}</template>
        </el-table-column>
        <el-table-column label="默认工艺" min-width="180">
          <template #default="{ row }">{{ row.defaultProcessRoute || '-' }}</template>
        </el-table-column>
        <el-table-column label="最近下单" min-width="220">
          <template #default="{ row }">
            <div>{{ row.lastOrderDate || '-' }}</div>
            <div class="cell-subtext">{{ row.lastOrderNo || '-' }} / {{ row.lastCustomerName || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="库存" min-width="180">
          <template #default="{ row }">
            <div>可用 {{ formatQuantity(row.availableQuantity, row.unit) }}</div>
            <div class="cell-subtext">订单 {{ formatQuantity(row.orderInventoryQuantity, row.unit) }} / 备货 {{ formatQuantity(row.stockInventoryQuantity, row.unit) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="BOM" min-width="280">
          <template #default="{ row }">
            <div>{{ joinPreview(row.bomNames, '-') }}</div>
            <div v-if="row.bomStructureDetails?.length" class="dashboard-bom-structure-list">
              <div v-for="detail in row.bomStructureDetails" :key="`${detail.bomId}-${detail.sortOrder}-${detail.structureLabel}`">
                <el-tag size="small" :type="dashboardBomStructureTagType(detail.structureType)" effect="plain">
                  {{ detail.structureLabel }}
                </el-tag>
                <small>{{ dashboardBomStructureDetailText(detail) }}</small>
                <el-button link type="primary" size="small" @click="openBomStructureDetail(row, detail)">维护此 BOM 行</el-button>
              </div>
            </div>
            <div v-else-if="row.bomStructureLabel || row.bomStructureLabels?.length" class="cell-subtext">
              {{ joinPreview(row.bomStructureLabels || [], row.bomStructureLabel || '-') }}
            </div>
            <div v-else class="dashboard-bom-empty">
              <span>{{ bomCurrentScopeEmptyText(row) }}</span>
              <el-button v-if="canCreateBomLineForCurrentScope(row)" link type="success" size="small" @click="openBomMaintain(row)">加入当前范围 BOM</el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">{{ row.status === 'ENABLED' ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="350" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openMaterialDrawingMaintain(row)">图纸</el-button>
            <el-button link type="primary" @click="openMaterialApplicabilityMaintain(row)">适用</el-button>
            <el-button link :type="canCreateBomLineForCurrentScope(row) ? 'success' : 'primary'" @click="openBomMaintain(row)">
              {{ bomMaintainActionLabel(row) }}
            </el-button>
            <el-button link type="primary" @click="openSourceDetails(row)">库存</el-button>
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button v-if="row.status === 'ENABLED'" link type="danger" @click="disableMaterial(row)">停用</el-button>
            <el-button v-else link type="success" @click="enableMaterial(row)">启用</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-bar">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[20, 50, 100, 200]"
          :total="dashboard.totalCount"
          layout="total, sizes, prev, pager, next"
          @size-change="handlePageSizeChange"
          @current-change="loadDashboard"
        />
      </div>
    </div>

    <div class="mobile-section">
      <el-alert
        title="手机端仅查看零件管理信息"
        description="零件新增、编辑、停用、导入和 BOM 维护请在电脑端操作。"
        type="info"
        :closable="false"
      />
      <div v-for="row in dashboard.items" :key="row.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ row.partName }}</strong>
            <small>{{ row.partCode }} / {{ row.unit }}</small>
          </div>
          <el-tag :type="row.scopeType === 'COMMON' ? 'success' : 'warning'" effect="plain" size="small">{{ row.partType || row.scopeLabel }}</el-tag>
        </div>
        <div class="mobile-card-fields">
          <div class="mobile-field">
            <label>客户</label>
            <span>{{ joinPreview(row.customerNames, '全部客户') }}</span>
          </div>
          <div class="mobile-field">
            <label>关系</label>
            <span>{{ row.currentRelationLabel || '-' }}{{ row.currentRelationDescription ? ` / ${row.currentRelationDescription}` : '' }}</span>
          </div>
          <div class="mobile-field">
            <label>机型</label>
            <span>{{ joinPreview(materialProjectScopeValues(row), '全部机型') }}</span>
          </div>
          <div class="mobile-field">
            <label>图纸</label>
            <span>{{ row.drawingNo || '-' }}{{ row.drawingSourceLabel ? ` / ${row.drawingSourceLabel}` : '' }}</span>
          </div>
          <div class="mobile-field">
            <label>BOM 结构</label>
            <span>{{ dashboardBomStructureSummary(row) }}</span>
          </div>
          <div class="mobile-field">
            <label>最近下单</label>
            <span>{{ row.lastOrderDate || '-' }}</span>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button size="small" type="primary" plain @click="openSourceDetails(row)">库存来源</el-button>
          <span class="mobile-readonly-note">手机端只保留库存来源查看入口</span>
        </div>
      </div>
      <div v-if="dashboard.totalCount > 0" class="mobile-pagination-bar">
        <span>第 {{ pagination.page }} 页，已显示 {{ dashboard.items.length }} / {{ dashboard.totalCount }} 条</span>
        <div class="mobile-pagination-actions">
          <el-button size="small" :disabled="loading || pagination.page <= 1" @click="loadMobilePreviousPage">上一页</el-button>
          <el-button size="small" type="primary" plain :disabled="loading || !dashboard.hasMore" @click="loadMobileNextPage">继续加载</el-button>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      class="responsive-dialog"
      :title="dialogTitle"
      width="560px"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleMaterialDialogClose"
    >
      <el-form label-width="110px">
        <el-form-item label="零件编码" required>
          <el-input v-model="form.partCode" placeholder="例如 RS1001" />
        </el-form-item>
        <el-form-item label="零件名称" required>
          <el-input v-model="form.partName" placeholder="例如 顶盖" />
        </el-form-item>
        <el-form-item label="单位" required>
          <el-input v-model="form.unit" placeholder="件 / 套" />
        </el-form-item>
        <el-form-item label="成品规格">
          <el-input v-model="form.partSpecification" placeholder="可留空" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 160px">
            <el-option label="启用" value="ENABLED" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
      </el-form>
      <el-alert
        class="material-memory-boundary-alert"
        type="info"
        :closable="false"
        show-icon
        title="保存范围"
        description="这里只维护零件搜索记忆，方便后续下单搜索和 0 库存查看；不会修改历史订单、库存批次、库存数量、BOM 明细或生产记录。"
      />
      <template #footer>
        <el-button :disabled="saving" @click="closeMaterialDialog">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" @click="saveMaterial">保存</el-button>
      </template>
    </el-dialog>

    <InventorySourceDetailsDialog
      v-model="sourceDetailsVisible"
      :loading="sourceDetailsLoading"
      :detail="sourceDetails"
    />

    <el-dialog v-model="dashboardTextDialogVisible" class="responsive-dialog" title="零件管理固定格式清单" width="860px">
      <el-input
        class="fixed-format-textarea"
        :model-value="dashboardFixedText"
        type="textarea"
        :rows="20"
        readonly
      />
      <template #footer>
        <el-button @click="dashboardTextDialogVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!dashboardFixedText" @click="copyDashboardText">复制清单</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="contextBomTextDialogVisible" class="responsive-dialog" title="当前适用零件包范围清单" width="940px">
      <el-input
        class="fixed-format-textarea"
        :model-value="contextBomFixedText"
        type="textarea"
        :rows="20"
        readonly
      />
      <template #footer>
        <el-button @click="contextBomTextDialogVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!contextBomFixedText" @click="copyContextBomText">复制范围</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="managementConfirmDialogVisible"
      class="responsive-dialog"
      :title="managementConfirmTitle"
      width="620px"
      append-to-body
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      :before-close="handleManagementConfirmDialogClose"
    >
      <div class="management-confirm-panel">
        <p v-for="line in managementConfirmMessageLines" :key="line">{{ line }}</p>
        <ul v-if="managementConfirmDetails.length">
          <li v-for="detail in managementConfirmDetails" :key="detail">{{ detail }}</li>
        </ul>
      </div>
      <template #footer>
        <el-button @click="cancelManagementConfirm">取消</el-button>
        <el-button :type="managementConfirmButtonType" @click="acceptManagementConfirm">
          {{ managementConfirmButtonText }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Rank } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import DateRangeFilter from '../components/DateRangeFilter.vue';
import InventorySourceDetailsDialog from '../components/InventorySourceDetailsDialog.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import type {
  CommonStatus,
  Customer,
  InventorySourceDetailResponse,
  MaterialDashboardBomStructureDetail,
  MaterialDashboardResponse,
  MaterialDashboardRow,
  ModelBom,
  ModelBomLine
} from '../types/erp';

type ManagementConfirmButtonType = 'primary' | 'success' | 'warning' | 'danger' | 'info';

const route = useRoute();
const router = useRouter();
const { isMobileLayout } = useDeviceProfile();
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editingMaterialId = ref('');
const commonProjectStorageKey = 'baisheng.erp.materials.commonProjectModels.v1';
const defaultCommonProjectModels = ['B3', 'B5'];
const commonProjectCandidate = ref('');
const commonProjectModels = ref<string[]>([]);
const draggedCommonProjectKey = ref('');
const commonProjectDragOverKey = ref('');
const commonProjectDragInsertAfter = ref(false);
const commonProjectDragSaving = ref(false);
const commonProjectSaving = ref(false);
const commonProjectLoading = ref(false);
const commonProjectSyncSource = ref<'SERVER' | 'CACHE' | 'DEFAULT'>('DEFAULT');
const projectOptions = ref<string[]>([]);
const drawingDateRange = ref<string[]>([]);
const lastOrderDateRange = ref<string[]>([]);
const sourceDetailsVisible = ref(false);
const sourceDetailsLoading = ref(false);
const sourceDetails = ref<InventorySourceDetailResponse | null>(null);
const sourceDetailsRequestSeq = ref(0);
const dashboardTextDialogVisible = ref(false);
const contextBomTextDialogVisible = ref(false);
const managementConfirmDialogVisible = ref(false);
const managementConfirmTitle = ref('');
const managementConfirmMessage = ref('');
const managementConfirmDetails = ref<string[]>([]);
const managementConfirmButtonText = ref('确认');
const managementConfirmButtonType = ref<ManagementConfirmButtonType>('primary');
const selectedCustomerName = ref('');
const contextBomLoading = ref(false);
const contextBoms = ref<ModelBom[]>([]);
const contextBomCommonOnly = ref(false);
const contextBomScopeFilter = ref<'' | 'ALL' | 'SELECTED' | 'PRIVATE'>('');
const draggedContextBomId = ref('');
const draggedContextBomScopeKey = ref('');
const contextBomDragOverId = ref('');
const bomOperationSavingKey = ref('');
let managementConfirmResolver: ((confirmed: boolean) => void) | null = null;
type ActiveFilterKey =
  | 'keyword'
  | 'customer'
  | 'projectModel'
  | 'scopeType'
  | 'relationType'
  | 'drawingNo'
  | 'drawingStatus'
  | 'drawingSource'
  | 'bomStructureType'
  | 'bomPresence'
  | 'recentOrderPresence'
  | 'drawingDate'
  | 'lastOrderDate'
  | 'sort'
  | 'status';

const dashboard = reactive<MaterialDashboardResponse>({
  items: [],
  totalCount: 0,
  limit: Number(50),
  offset: 0,
  hasMore: false,
  summary: {
    totalCount: 0,
    enabledCount: 0,
    disabledCount: 0,
    commonCount: 0,
    customCount: 0,
    withBomCount: 0,
    withoutBomCount: 0,
    withRecentOrderCount: 0,
    withoutRecentOrderCount: 0,
    relationCounts: {},
    drawingSourceCounts: {},
    bomStructureCounts: {}
  }
});

const filters = reactive<{
  keyword: string;
  customerId: string;
  projectModel: string;
  scopeType: '' | 'COMMON' | 'CUSTOM';
  relationType: '' | 'BOM' | 'APPLICABILITY' | 'ORDER_HISTORY' | 'MATERIAL_ONLY';
  drawingNo: string;
  drawingStatus: string;
  drawingSource: '' | 'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST' | 'ORDER_HISTORY' | 'NONE';
  bomStructureType: '' | 'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART' | 'NONE';
  bomPresence: '' | 'WITH_BOM' | 'WITHOUT_BOM';
  recentOrderPresence: '' | 'WITH_RECENT_ORDER' | 'WITHOUT_RECENT_ORDER';
  sortBy: 'LAST_ORDER_DATE' | 'DRAWING_DATE' | 'BOM_STATUS' | 'PART_CODE' | 'UPDATED_AT';
  sortOrder: 'ASC' | 'DESC';
  status: '' | CommonStatus;
}>({
  keyword: '',
  customerId: '',
  projectModel: '',
  scopeType: '',
  relationType: '',
  drawingNo: '',
  drawingStatus: '',
  drawingSource: '',
  bomStructureType: '',
  bomPresence: '',
  recentOrderPresence: '',
  sortBy: 'LAST_ORDER_DATE',
  sortOrder: 'DESC',
  status: 'ENABLED'
});

const pagination = reactive({
  page: 1,
  pageSize: Number(50)
});

const form = reactive<{
  partCode: string;
  partName: string;
  unit: string;
  partSpecification: string;
  status: CommonStatus;
}>({
  partCode: '',
  partName: '',
  unit: '件',
  partSpecification: '',
  status: 'ENABLED'
});

const dialogTitle = computed(() => (editingMaterialId.value ? '编辑零件搜索记忆' : '新增零件搜索记忆'));
const quickProjectOptions = computed(() => commonProjectModels.value);
const commonProjectBusy = computed(() => commonProjectLoading.value || commonProjectDragSaving.value || commonProjectSaving.value);
const commonProjectSyncText = computed(() => {
  const countText = `${quickProjectOptions.value.length} 个`;
  if (commonProjectLoading.value) {
    return `读取中 / ${countText}`;
  }
  if (commonProjectDragSaving.value) {
    return `保存排序中 / ${countText}`;
  }
  if (commonProjectSaving.value) {
    return `保存中 / ${countText}`;
  }
  if (commonProjectSyncSource.value === 'SERVER') {
    return `数据库已保存 / ${countText}`;
  }
  if (commonProjectSyncSource.value === 'CACHE') {
    return `本机缓存 / ${countText}`;
  }
  return `默认 B3/B5 / ${countText}`;
});
const commonProjectSyncTagType = computed(() => {
  if (commonProjectBusy.value) {
    return 'warning';
  }
  if (commonProjectSyncSource.value === 'SERVER') {
    return 'success';
  }
  return 'info';
});
const commonProjectSelectOptions = computed(() => {
  const selectedKeys = new Set(quickProjectOptions.value.map((item) => projectModelKey(item)));
  return projectOptions.value.filter((item) => !selectedKeys.has(projectModelKey(item)));
});
const contextBomPanelVisible = computed(() => Boolean(filters.customerId || filters.projectModel.trim() || contextBoms.value.length));
const customerContextExcludesGlobalAllProject = computed(() => Boolean(filters.customerId.trim()));
const contextBomScopeText = computed(() => {
  const exclusionText = customerContextExcludesGlobalAllProject.value ? ' / 已排除全部客户全部机型泛用 BOM' : '';
  return `客户 ${selectedCustomerFilterLabel()} / 机型 ${filters.projectModel.trim() || '全部'}${exclusionText}`;
});
const contextBomVisibleRows = computed(() =>
  contextBoms.value.filter((bom) => {
    const scopeMatched = contextBomScopeFilter.value ? contextBomScopeMode(bom) === contextBomScopeFilter.value : true;
    const commonMatched = contextBomCommonOnly.value ? bom.isCommon : true;
    return scopeMatched && commonMatched;
  })
);
const contextBomCommonDragRows = computed(() => contextBomVisibleRows.value.filter((bom) => bom.status === 'ENABLED' && bom.isCommon));
const contextBomTotalCount = computed(() => contextBomVisibleRows.value.length);
const contextBomActiveCount = computed(() => contextBomVisibleRows.value.filter((bom) => bom.status === 'ENABLED').length);
const contextBomCommonCount = computed(() => contextBoms.value.filter((bom) => bom.isCommon).length);
const contextBomAllCustomerCount = computed(() => contextBoms.value.filter((bom) => contextBomScopeMode(bom) === 'ALL').length);
const contextBomSelectedCustomerCount = computed(() => contextBoms.value.filter((bom) => contextBomScopeMode(bom) === 'SELECTED').length);
const contextBomPrivateCount = computed(() => contextBoms.value.filter((bom) => contextBomScopeMode(bom) === 'PRIVATE').length);
const contextBomEmptyDescription = computed(() => {
  if (contextBomScopeFilter.value && contextBomCommonOnly.value) {
    return '当前范围暂无匹配的常用 BOM';
  }
  if (contextBomScopeFilter.value) {
    return '当前范围暂无匹配 BOM';
  }
  return contextBomCommonOnly.value ? '当前范围暂无常用 BOM' : '当前范围暂无 BOM';
});
const relationSummaryItems = computed(() => [
  { label: 'BOM 零件', value: 'BOM' as const, count: dashboard.summary.relationCounts.BOM || 0 },
  { label: '显式适用', value: 'APPLICABILITY' as const, count: dashboard.summary.relationCounts.APPLICABILITY || 0 },
  { label: '订单历史', value: 'ORDER_HISTORY' as const, count: dashboard.summary.relationCounts.ORDER_HISTORY || 0 },
  { label: '仅搜索记忆', value: 'MATERIAL_ONLY' as const, count: dashboard.summary.relationCounts.MATERIAL_ONLY || 0 }
]);
const drawingSourceSummaryItems = computed(() => [
  { label: 'BOM 指定图纸', value: 'BOM_LINE' as const, count: dashboard.summary.drawingSourceCounts.BOM_LINE || 0 },
  { label: '零件默认图纸', value: 'MATERIAL_DEFAULT' as const, count: dashboard.summary.drawingSourceCounts.MATERIAL_DEFAULT || 0 },
  { label: '零件最新图纸', value: 'MATERIAL_LATEST' as const, count: dashboard.summary.drawingSourceCounts.MATERIAL_LATEST || 0 },
  { label: '历史订单图纸', value: 'ORDER_HISTORY' as const, count: dashboard.summary.drawingSourceCounts.ORDER_HISTORY || 0 },
  { label: '无图纸', value: 'NONE' as const, count: dashboard.summary.drawingSourceCounts.NONE || 0 }
]);
const bomStructureSummaryItems = computed(() => [
  { label: '组件', value: 'COMPONENT' as const, count: dashboard.summary.bomStructureCounts.COMPONENT || 0 },
  { label: '子零件', value: 'CHILD_PART' as const, count: dashboard.summary.bomStructureCounts.CHILD_PART || 0 },
  { label: '单独零件', value: 'STANDALONE_PART' as const, count: dashboard.summary.bomStructureCounts.STANDALONE_PART || 0 },
  { label: '未进 BOM', value: 'NONE' as const, count: dashboard.summary.bomStructureCounts.NONE || 0 }
]);
const dashboardFixedText = computed(() => buildDashboardText());
const contextBomFixedText = computed(() => buildContextBomText());
const managementConfirmMessageLines = computed(() =>
  managementConfirmMessage.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);
const activeFilterItems = computed<Array<{ key: ActiveFilterKey; label: string }>>(() => {
  const items: Array<{ key: ActiveFilterKey; label: string }> = [];
  if (filters.keyword.trim()) {
    items.push({ key: 'keyword', label: `关键字：${filters.keyword.trim()}` });
  }
  if (filters.customerId) {
    items.push({ key: 'customer', label: `客户：${selectedCustomerFilterLabel()}` });
  }
  if (filters.projectModel.trim()) {
    items.push({ key: 'projectModel', label: `机型：${filters.projectModel.trim()}` });
  }
  if (filters.scopeType) {
    items.push({ key: 'scopeType', label: `类型：${filters.scopeType === 'COMMON' ? '通用件' : '定制件'}` });
  }
  if (filters.relationType) {
    items.push({ key: 'relationType', label: `当前关系：${materialRelationFilterLabel(filters.relationType)}` });
  }
  if (filters.drawingNo.trim()) {
    items.push({ key: 'drawingNo', label: `图号：${filters.drawingNo.trim()}` });
  }
  if (filters.drawingStatus.trim()) {
    items.push({ key: 'drawingStatus', label: `图纸状态：${filters.drawingStatus.trim()}` });
  }
  if (filters.drawingSource) {
    items.push({ key: 'drawingSource', label: `图纸来源：${drawingSourceFilterLabel(filters.drawingSource)}` });
  }
  if (filters.bomStructureType) {
    items.push({ key: 'bomStructureType', label: `BOM 结构：${bomStructureFilterLabel(filters.bomStructureType)}` });
  }
  if (filters.bomPresence) {
    items.push({ key: 'bomPresence', label: `BOM 状态：${bomPresenceFilterLabel(filters.bomPresence)}` });
  }
  if (filters.recentOrderPresence) {
    items.push({ key: 'recentOrderPresence', label: `下单记录：${recentOrderPresenceFilterLabel(filters.recentOrderPresence)}` });
  }
  if (drawingDateRange.value.length) {
    items.push({ key: 'drawingDate', label: `图纸日期：${formatRangeText(drawingDateRange.value)}` });
  }
  if (lastOrderDateRange.value.length) {
    items.push({ key: 'lastOrderDate', label: `最近下单：${formatRangeText(lastOrderDateRange.value)}` });
  }
  if (filters.sortBy !== 'LAST_ORDER_DATE' || filters.sortOrder !== 'DESC') {
    items.push({ key: 'sort', label: `排序：${dashboardSortByLabel(filters.sortBy)} / ${dashboardSortOrderLabel(filters.sortOrder)}` });
  }
  if (filters.status) {
    items.push({ key: 'status', label: `状态：${filters.status === 'ENABLED' ? '启用' : '停用'}` });
  }
  return items;
});

onMounted(async () => {
  applyRouteQueryFilters();
  await loadCommonProjectModels();
  await Promise.all([loadProjectOptions(), loadDashboard(), loadContextBoms()]);
});

watch(
  () => [
    route.query.customerId,
    route.query.projectModel,
    route.query.keyword,
    route.query.status,
    route.query.excludeGlobalAllProject
  ],
  async () => {
    applyRouteQueryFilters();
    pagination.page = 1;
    await Promise.all([loadProjectOptions(), loadDashboard(), loadContextBoms()]);
  }
);

function routeQueryText(value: unknown) {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  return typeof value === 'string' ? value.trim() : '';
}

function routeStatusFilter(value: string): CommonStatus | '' | undefined {
  if (value === 'ENABLED' || value === 'DISABLED') {
    return value;
  }
  if (value === 'ALL') {
    return '';
  }
  return undefined;
}

function applyRouteQueryFilters() {
  const customerId = routeQueryText(route.query.customerId);
  const projectModel = routeQueryText(route.query.projectModel);
  const keyword = routeQueryText(route.query.keyword);
  const status = routeStatusFilter(routeQueryText(route.query.status));

  filters.customerId = customerId;
  filters.projectModel = projectModel;
  if (route.query.keyword !== undefined) {
    filters.keyword = keyword;
  }
  if (status !== undefined) {
    filters.status = status;
  }
  if (!customerId) {
    selectedCustomerName.value = '';
  }
}

function normalizeProjectModel(projectModel?: string | null) {
  return String(projectModel || '').trim();
}

function projectModelKey(projectModel?: string | null) {
  return normalizeProjectModel(projectModel).toLowerCase();
}

function projectBomOperationKey(projectModel: string, action: 'disable' | 'enable' | 'delete') {
  return `${action}:project:${projectModelKey(projectModel)}`;
}

function contextBomOperationKey(bom: ModelBom, action: 'disable' | 'enable' | 'delete' | 'common') {
  return `${action}:bom:${bom.id}`;
}

function uniqueProjectModels(values: string[]) {
  const seenKeys = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeProjectModel(value);
    const key = projectModelKey(normalized);
    if (!normalized || seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    result.push(normalized);
  }
  return result;
}

function commonProjectStorage() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}

// 常用机型只是快捷入口设置，不修改 BOM 适用范围或零件业务数据。
async function loadCommonProjectModels() {
  commonProjectLoading.value = true;
  try {
    const savedProjectModels = await erpApi.materialCommonProjectModels();
    commonProjectModels.value = uniqueProjectModels(savedProjectModels);
    commonProjectSyncSource.value = 'SERVER';
    saveCommonProjectModelsToCache();
    return commonProjectSyncSource.value;
  } catch {
    ElMessage.warning('常用机型设置读取失败，已使用本机缓存或默认 B3/B5');
  } finally {
    commonProjectLoading.value = false;
  }

  const storage = commonProjectStorage();
  const rawValue = storage?.getItem(commonProjectStorageKey);
  if (!rawValue) {
    commonProjectModels.value = [...defaultCommonProjectModels];
    commonProjectSyncSource.value = 'DEFAULT';
    return commonProjectSyncSource.value;
  }

  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    commonProjectModels.value = Array.isArray(parsedValue)
      ? uniqueProjectModels(parsedValue.filter((item): item is string => typeof item === 'string'))
      : [...defaultCommonProjectModels];
    commonProjectSyncSource.value = Array.isArray(parsedValue) ? 'CACHE' : 'DEFAULT';
  } catch {
    commonProjectModels.value = [...defaultCommonProjectModels];
    commonProjectSyncSource.value = 'DEFAULT';
  }
  return commonProjectSyncSource.value;
}

function saveCommonProjectModelsToCache() {
  try {
    commonProjectStorage()?.setItem(commonProjectStorageKey, JSON.stringify(commonProjectModels.value));
  } catch {
    // 本机缓存失败不影响后端保存，页面刷新后仍以数据库设置为准。
  }
}

function isCommonProject(projectModel: string) {
  const key = projectModelKey(projectModel);
  return Boolean(key) && commonProjectModels.value.some((item) => projectModelKey(item) === key);
}

async function saveCommonProjectModels() {
  if (commonProjectSaving.value) {
    return false;
  }
  commonProjectSaving.value = true;
  commonProjectModels.value = uniqueProjectModels(commonProjectModels.value);
  saveCommonProjectModelsToCache();
  try {
    const savedProjectModels = await erpApi.saveMaterialCommonProjectModels(commonProjectModels.value);
    commonProjectModels.value = uniqueProjectModels(savedProjectModels);
    commonProjectSyncSource.value = 'SERVER';
    saveCommonProjectModelsToCache();
    return true;
  } catch {
    commonProjectSyncSource.value = 'CACHE';
    ElMessage.warning('常用机型设置保存到后端失败，已临时保存到本机浏览器');
    return false;
  } finally {
    commonProjectSaving.value = false;
  }
}

async function refreshCommonProjects() {
  if (commonProjectBusy.value) {
    return;
  }
  const source = await loadCommonProjectModels();
  if (source === 'SERVER') {
    ElMessage.success('常用机型已从数据库刷新');
  } else if (source === 'CACHE') {
    ElMessage.info('已读取本机缓存常用机型');
  } else {
    ElMessage.info('已使用默认常用机型 B3/B5');
  }
}

async function addCommonProject(projectModel: string) {
  if (commonProjectBusy.value) {
    return;
  }
  const normalized = normalizeProjectModel(projectModel);
  if (!normalized) {
    ElMessage.warning('请先选择机型 / 项目');
    return;
  }
  if (isCommonProject(normalized)) {
    ElMessage.info(`${normalized} 已是常用机型`);
    return;
  }
  commonProjectModels.value = uniqueProjectModels([...commonProjectModels.value, normalized]);
  if (await saveCommonProjectModels()) {
    ElMessage.success(`已加入常用机型：${normalized}`);
  }
}

function addCommonProjectFromSelect(projectModel: string) {
  if (commonProjectBusy.value) {
    return;
  }
  if (!normalizeProjectModel(projectModel)) {
    commonProjectCandidate.value = '';
    return;
  }
  void addCommonProject(projectModel);
  commonProjectCandidate.value = '';
}

async function removeCommonProject(projectModel: string) {
  if (commonProjectBusy.value) {
    return;
  }
  const key = projectModelKey(projectModel);
  commonProjectModels.value = commonProjectModels.value.filter((item) => projectModelKey(item) !== key);
  if (await saveCommonProjectModels()) {
    ElMessage.success(`已移除常用机型：${normalizeProjectModel(projectModel)}`);
  }
}

async function resetCommonProjectsToDefault() {
  if (commonProjectBusy.value) {
    return;
  }
  commonProjectModels.value = [...defaultCommonProjectModels];
  if (await saveCommonProjectModels()) {
    ElMessage.success('已恢复默认常用机型 B3/B5');
  }
}

function startCommonProjectDrag(event: DragEvent, projectModel: string) {
  if (quickProjectOptions.value.length <= 1 || commonProjectBusy.value) {
    event.preventDefault();
    return;
  }
  draggedCommonProjectKey.value = projectModelKey(projectModel);
  commonProjectDragOverKey.value = draggedCommonProjectKey.value;
  commonProjectDragInsertAfter.value = false;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedCommonProjectKey.value);
  }
}

function handleCommonProjectDragOver(event: DragEvent, projectModel: string) {
  if (!draggedCommonProjectKey.value || commonProjectBusy.value) {
    return;
  }
  const targetKey = projectModelKey(projectModel);
  if (!targetKey) {
    return;
  }
  commonProjectDragOverKey.value = targetKey;
  commonProjectDragInsertAfter.value = isCommonProjectDragAfterMiddle(event);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

async function dropCommonProject(event: DragEvent, projectModel: string) {
  if (commonProjectBusy.value) {
    endCommonProjectDrag();
    return;
  }
  const orderedProjects = buildCommonProjectDragOrder(projectModel, isCommonProjectDragAfterMiddle(event));
  endCommonProjectDrag();
  if (!orderedProjects) {
    return;
  }
  commonProjectDragSaving.value = true;
  commonProjectModels.value = orderedProjects;
  try {
    if (await saveCommonProjectModels()) {
      ElMessage.success('常用机型顺序已保存');
    }
  } finally {
    commonProjectDragSaving.value = false;
  }
}

function buildCommonProjectDragOrder(targetProjectModel: string, insertAfter: boolean) {
  const sourceKey = draggedCommonProjectKey.value;
  const targetKey = projectModelKey(targetProjectModel);
  if (!sourceKey || !targetKey || sourceKey === targetKey) {
    return null;
  }
  const orderedProjects = [...commonProjectModels.value];
  const fromIndex = orderedProjects.findIndex((item) => projectModelKey(item) === sourceKey);
  if (fromIndex < 0) {
    return null;
  }
  const [movedProject] = orderedProjects.splice(fromIndex, 1);
  if (!movedProject) {
    return null;
  }
  const targetIndex = orderedProjects.findIndex((item) => projectModelKey(item) === targetKey);
  if (targetIndex < 0) {
    return null;
  }
  orderedProjects.splice(insertAfter ? targetIndex + 1 : targetIndex, 0, movedProject);
  const normalized = uniqueProjectModels(orderedProjects);
  return normalized.every((item, index) => projectModelKey(item) === projectModelKey(commonProjectModels.value[index])) ? null : normalized;
}

function endCommonProjectDrag() {
  draggedCommonProjectKey.value = '';
  commonProjectDragOverKey.value = '';
  commonProjectDragInsertAfter.value = false;
}

function isCommonProjectDragAfterMiddle(event: DragEvent) {
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!target) {
    return false;
  }
  const rect = target.getBoundingClientRect();
  return event.clientX > rect.left + rect.width / 2;
}

async function loadDashboard() {
  loading.value = true;
  try {
    const result = await erpApi.materialDashboard({
      keyword: filters.keyword.trim() || undefined,
      customerId: filters.customerId || undefined,
      projectModel: filters.projectModel.trim() || undefined,
      scopeType: filters.scopeType || undefined,
      relationType: filters.relationType || undefined,
      drawingNo: filters.drawingNo.trim() || undefined,
      drawingStatus: filters.drawingStatus.trim() || undefined,
      drawingSource: filters.drawingSource || undefined,
      bomStructureType: filters.bomStructureType || undefined,
      bomPresence: filters.bomPresence || undefined,
      recentOrderPresence: filters.recentOrderPresence || undefined,
      drawingDateFrom: drawingDateRange.value[0],
      drawingDateTo: drawingDateRange.value[1],
      lastOrderDateFrom: lastOrderDateRange.value[0],
      lastOrderDateTo: lastOrderDateRange.value[1],
      status: filters.status || undefined,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize
    });
    Object.assign(dashboard, result);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件控制面板加载失败，请确认后端服务');
  } finally {
    loading.value = false;
  }
}

async function loadProjectOptions() {
  try {
    projectOptions.value = await erpApi.materialProjectModels(filters.customerId || undefined);
  } catch (error) {
    projectOptions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '机型 / 项目选项加载失败，请确认客户筛选和后端服务');
  }
}

async function loadContextBoms() {
  const scopedCustomerId = filters.customerId.trim();
  const scopedProjectModel = filters.projectModel.trim();
  if (!scopedCustomerId && !scopedProjectModel) {
    contextBoms.value = [];
    return;
  }

  contextBomLoading.value = true;
  try {
    const rows = await erpApi.modelBoms({
      customerId: scopedCustomerId || undefined,
      projectModel: scopedProjectModel || undefined,
      excludeGlobalAllProject: Boolean(scopedCustomerId),
      status: 'ALL'
    });
    if (filters.customerId.trim() === scopedCustomerId && filters.projectModel.trim() === scopedProjectModel) {
      contextBoms.value = rows;
    }
  } catch (error) {
    if (filters.customerId.trim() === scopedCustomerId && filters.projectModel.trim() === scopedProjectModel) {
      contextBoms.value = [];
    }
    ElMessage.error(error instanceof Error ? error.message : '当前适用零件包加载失败，请确认客户、机型和后端服务');
  } finally {
    contextBomLoading.value = false;
  }
}

async function handleCustomerChange() {
  filters.projectModel = '';
  if (!filters.customerId) {
    selectedCustomerName.value = '';
  }
  await loadProjectOptions();
  resetAndLoad();
}

function handleSelectedCustomerChange(customer?: Customer) {
  selectedCustomerName.value = customer?.customerName || '';
}

function resetAndLoad() {
  pagination.page = 1;
  void loadDashboard();
  void loadContextBoms();
}

function applyScopeTypeFilter(value: 'COMMON' | 'CUSTOM') {
  filters.scopeType = filters.scopeType === value ? '' : value;
  resetAndLoad();
}

function applyRelationFilter(value: 'BOM' | 'APPLICABILITY' | 'ORDER_HISTORY' | 'MATERIAL_ONLY') {
  filters.relationType = filters.relationType === value ? '' : value;
  resetAndLoad();
}

function applyBomPresenceFilter(value: 'WITH_BOM' | 'WITHOUT_BOM') {
  filters.bomPresence = filters.bomPresence === value ? '' : value;
  normalizeBomPresenceFilters();
  resetAndLoad();
}

function applyRecentOrderPresenceFilter(value: 'WITH_RECENT_ORDER' | 'WITHOUT_RECENT_ORDER') {
  filters.recentOrderPresence = filters.recentOrderPresence === value ? '' : value;
  if (filters.recentOrderPresence === 'WITHOUT_RECENT_ORDER') {
    lastOrderDateRange.value = [];
  }
  resetAndLoad();
}

function handleBomPresenceChange() {
  normalizeBomPresenceFilters();
  resetAndLoad();
}

function handleLastOrderDateRangeChange() {
  if (lastOrderDateRange.value.length > 0 && filters.recentOrderPresence === 'WITHOUT_RECENT_ORDER') {
    filters.recentOrderPresence = '';
  }
  resetAndLoad();
}

function normalizeBomPresenceFilters() {
  if (filters.bomPresence === 'WITH_BOM' && filters.bomStructureType === 'NONE') {
    filters.bomStructureType = '';
  }
  if (filters.bomPresence === 'WITHOUT_BOM' && filters.bomStructureType && filters.bomStructureType !== 'NONE') {
    filters.bomStructureType = '';
  }
}

function applyDrawingSourceFilter(value: 'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST' | 'ORDER_HISTORY' | 'NONE') {
  filters.drawingSource = filters.drawingSource === value ? '' : value;
  resetAndLoad();
}

function applyBomStructureFilter(value: 'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART' | 'NONE') {
  filters.bomStructureType = filters.bomStructureType === value ? '' : value;
  if (filters.bomStructureType === 'NONE' && filters.bomPresence === 'WITH_BOM') {
    filters.bomPresence = '';
  }
  if (filters.bomStructureType && filters.bomStructureType !== 'NONE' && filters.bomPresence === 'WITHOUT_BOM') {
    filters.bomPresence = '';
  }
  resetAndLoad();
}

async function clearActiveFilter(key: ActiveFilterKey) {
  if (key === 'keyword') {
    filters.keyword = '';
  } else if (key === 'customer') {
    filters.customerId = '';
    selectedCustomerName.value = '';
    filters.projectModel = '';
    await loadProjectOptions();
  } else if (key === 'projectModel') {
    filters.projectModel = '';
  } else if (key === 'scopeType') {
    filters.scopeType = '';
  } else if (key === 'relationType') {
    filters.relationType = '';
  } else if (key === 'drawingNo') {
    filters.drawingNo = '';
  } else if (key === 'drawingStatus') {
    filters.drawingStatus = '';
  } else if (key === 'drawingSource') {
    filters.drawingSource = '';
  } else if (key === 'bomStructureType') {
    filters.bomStructureType = '';
  } else if (key === 'bomPresence') {
    filters.bomPresence = '';
  } else if (key === 'recentOrderPresence') {
    filters.recentOrderPresence = '';
  } else if (key === 'drawingDate') {
    drawingDateRange.value = [];
  } else if (key === 'lastOrderDate') {
    lastOrderDateRange.value = [];
  } else if (key === 'sort') {
    filters.sortBy = 'LAST_ORDER_DATE';
    filters.sortOrder = 'DESC';
  } else if (key === 'status') {
    filters.status = '';
  }
  resetAndLoad();
}

async function resetFilters() {
  filters.keyword = '';
  filters.customerId = '';
  selectedCustomerName.value = '';
  filters.projectModel = '';
  filters.scopeType = '';
  filters.relationType = '';
  filters.drawingNo = '';
  filters.drawingStatus = '';
  filters.drawingSource = '';
  filters.bomStructureType = '';
  filters.bomPresence = '';
  filters.recentOrderPresence = '';
  filters.sortBy = 'LAST_ORDER_DATE';
  filters.sortOrder = 'DESC';
  filters.status = 'ENABLED';
  contextBomCommonOnly.value = false;
  contextBomScopeFilter.value = '';
  drawingDateRange.value = [];
  lastOrderDateRange.value = [];
  pagination.page = 1;
  await Promise.all([loadProjectOptions(), loadDashboard(), loadContextBoms()]);
}

function selectProject(projectModel: string) {
  filters.projectModel = filters.projectModel === projectModel ? '' : projectModel;
  resetAndLoad();
}

function openProjectBomMaintain(projectModel: string) {
  if (guardDesktopOperation('BOM 查看和编辑')) {
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  const targetProjectModel = projectModel.trim();
  if (!targetProjectModel) {
    ElMessage.warning('请先选择机型 / 项目');
    return;
  }
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: filters.customerId || undefined,
      projectModel: targetProjectModel,
      scopeMode: filters.customerId ? 'PRIVATE' : 'ALL',
      status: 'ALL'
    }
  });
}

function loadProjectBomsForAction(projectModel: string) {
  return erpApi.modelBoms({
    customerId: filters.customerId || undefined,
    projectModel: projectModel.trim(),
    status: 'ALL'
  });
}

function exactProjectBomForCurrentScope(rows: ModelBom[], projectModel: string, statusFilter: CommonStatus | 'ANY' = 'ENABLED') {
  const targetProjectModel = normalizeBomScopeText(projectModel);
  return rows.find((bom) => {
    if ((statusFilter !== 'ANY' && bom.status !== statusFilter) || normalizeBomScopeText(bom.projectModel) !== targetProjectModel) {
      return false;
    }
    return filters.customerId ? bom.customerId === filters.customerId : contextBomIsAllCustomer(bom);
  });
}

async function disableProjectBom(projectModel: string) {
  if (guardDesktopOperation('停用 BOM')) {
    return;
  }
  const targetProjectModel = projectModel.trim();
  if (!targetProjectModel) {
    ElMessage.warning('请先选择机型 / 项目');
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  const operationKey = projectBomOperationKey(targetProjectModel, 'disable');
  bomOperationSavingKey.value = operationKey;
  try {
    const rows = await loadProjectBomsForAction(targetProjectModel);
    const bom = exactProjectBomForCurrentScope(rows, targetProjectModel);
    if (!bom) {
      ElMessage.warning(
        filters.customerId
          ? `${targetProjectModel} 当前客户没有可停用的独立 BOM，请进入机型零件包页查看百胜通用 BOM 或已停用记录`
          : `${targetProjectModel} 没有可停用的百胜通用 BOM，请进入机型零件包页查看已停用记录`
      );
      return;
    }
    const confirmed = await openManagementConfirmDialog({
      title: '停用 BOM',
      message: `确定停用 ${bom.bomName} 吗？`,
      details: [
        '停用只影响后续推荐，不会删除历史订单引用或 BOM 明细。',
        '误建无效 BOM 请使用删除。',
        bom.isCommon ? '该 BOM 当前为常用，停用后会同时取消常用排序。' : ''
      ].filter(Boolean),
      confirmButtonText: '停用',
      confirmButtonType: 'warning'
    });
    if (!confirmed) {
      return;
    }
    // BOM 停用用于保留历史订单和 BOM 行引用；误建无效 BOM 才走物理删除。
    await erpApi.disableModelBom(bom.id);
    ElMessage.success(`${targetProjectModel} BOM 已停用`);
    await Promise.all([loadDashboard(), loadContextBoms()]);
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error instanceof Error ? error.message : 'BOM 停用失败，请确认后端服务和当前 BOM 状态');
    }
  } finally {
    if (bomOperationSavingKey.value === operationKey) {
      bomOperationSavingKey.value = '';
    }
  }
}

async function enableProjectBom(projectModel: string) {
  if (guardDesktopOperation('启用 BOM')) {
    return;
  }
  const targetProjectModel = projectModel.trim();
  if (!targetProjectModel) {
    ElMessage.warning('请先选择机型 / 项目');
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  const operationKey = projectBomOperationKey(targetProjectModel, 'enable');
  bomOperationSavingKey.value = operationKey;
  try {
    const rows = await loadProjectBomsForAction(targetProjectModel);
    const bom = exactProjectBomForCurrentScope(rows, targetProjectModel, 'DISABLED');
    if (!bom) {
      ElMessage.warning(
        filters.customerId
          ? `${targetProjectModel} 当前客户没有可恢复启用的停用 BOM`
          : `${targetProjectModel} 没有可恢复启用的百胜通用 BOM`
      );
      return;
    }
    await enableContextBom(bom, operationKey);
  } finally {
    if (bomOperationSavingKey.value === operationKey) {
      bomOperationSavingKey.value = '';
    }
  }
}

async function deleteProjectBom(projectModel: string) {
  if (guardDesktopOperation('删除无效 BOM')) {
    return;
  }
  const targetProjectModel = projectModel.trim();
  if (!targetProjectModel) {
    ElMessage.warning('请先选择机型 / 项目');
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  const operationKey = projectBomOperationKey(targetProjectModel, 'delete');
  bomOperationSavingKey.value = operationKey;
  try {
    const rows = await loadProjectBomsForAction(targetProjectModel);
    const bom = exactProjectBomForCurrentScope(rows, targetProjectModel, 'ANY');
    if (!bom) {
      ElMessage.warning(
        filters.customerId
          ? `${targetProjectModel} 当前客户没有可删除的独立 BOM，请进入机型零件包页查看其他范围或已停用记录`
          : `${targetProjectModel} 没有可删除的百胜通用 BOM，请进入机型零件包页查看已停用记录`
      );
      return;
    }
    if (!(await confirmDeleteBom(bom))) {
      return;
    }
    // 永久删除只用于误操作创建的无效 BOM；后端会阻断仍被客户副本引用的来源 BOM。
    const result = await erpApi.deleteModelBom(bom.id);
    ElMessage.success(
      `已删除无效 BOM：${result.bomName}，清理 ${result.lineCount} 行明细、${result.customerScopeCount} 个适用客户、${result.diffReviewCount} 条差异核对记录`
    );
    await Promise.all([loadDashboard(), loadContextBoms()]);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无效 BOM 删除失败，请确认后端服务和当前 BOM 状态');
  } finally {
    if (bomOperationSavingKey.value === operationKey) {
      bomOperationSavingKey.value = '';
    }
  }
}

function handlePageSizeChange() {
  pagination.page = 1;
  void loadDashboard();
}

function loadMobilePreviousPage() {
  if (pagination.page <= 1 || loading.value) {
    return;
  }
  pagination.page -= 1;
  void loadDashboard();
}

function loadMobileNextPage() {
  if (!dashboard.hasMore || loading.value) {
    return;
  }
  pagination.page += 1;
  void loadDashboard();
}

function resetForm() {
  editingMaterialId.value = '';
  form.partCode = '';
  form.partName = '';
  form.unit = '件';
  form.partSpecification = '';
  form.status = 'ENABLED';
}

function isMobileViewport() {
  return isMobileLayout.value || (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
}

function showMobileDesktopNotice(actionLabel: string) {
  ElMessage.warning(`手机端仅查看零件管理信息，${actionLabel}请在电脑端操作`);
}

function guardDesktopOperation(actionLabel: string) {
  if (!isMobileViewport()) {
    return false;
  }
  showMobileDesktopNotice(actionLabel);
  return true;
}

function openDesktopMaintenancePage(path: string, actionLabel: string) {
  if (guardDesktopOperation(actionLabel)) {
    return;
  }
  router.push(path);
}

function warnMaterialSavingClose() {
  ElMessage.warning('零件搜索记忆正在保存，请等待保存完成');
}

function closeMaterialDialog() {
  if (saving.value) {
    warnMaterialSavingClose();
    return;
  }
  dialogVisible.value = false;
}

function handleMaterialDialogClose(done: () => void) {
  if (saving.value) {
    warnMaterialSavingClose();
    return;
  }
  done();
}

function openManagementConfirmDialog(options: {
  title: string;
  message: string;
  details?: string[];
  confirmButtonText: string;
  confirmButtonType?: ManagementConfirmButtonType;
}) {
  if (managementConfirmResolver) {
    managementConfirmResolver(false);
  }
  managementConfirmTitle.value = options.title;
  managementConfirmMessage.value = options.message;
  managementConfirmDetails.value = options.details || [];
  managementConfirmButtonText.value = options.confirmButtonText;
  managementConfirmButtonType.value = options.confirmButtonType || 'primary';
  managementConfirmDialogVisible.value = true;
  return new Promise<boolean>((resolve) => {
    managementConfirmResolver = resolve;
  });
}

function resolveManagementConfirm(confirmed: boolean, closeDialog = true) {
  const resolver = managementConfirmResolver;
  managementConfirmResolver = null;
  if (closeDialog) {
    managementConfirmDialogVisible.value = false;
  }
  if (resolver) {
    resolver(confirmed);
  }
}

function cancelManagementConfirm() {
  resolveManagementConfirm(false);
}

function acceptManagementConfirm() {
  resolveManagementConfirm(true);
}

function handleManagementConfirmDialogClose(done: () => void) {
  resolveManagementConfirm(false, false);
  done();
}

function openCreateDialog() {
  if (guardDesktopOperation('新增零件')) {
    return;
  }
  resetForm();
  dialogVisible.value = true;
}

function openEditDialog(row: MaterialDashboardRow) {
  if (guardDesktopOperation('编辑零件')) {
    return;
  }
  editingMaterialId.value = row.id;
  form.partCode = row.partCode;
  form.partName = row.partName;
  form.unit = row.unit;
  form.partSpecification = row.partSpecification || '';
  form.status = row.status;
  dialogVisible.value = true;
}

async function saveMaterial() {
  if (saving.value) {
    return;
  }
  const partCode = form.partCode.trim();
  const partName = form.partName.trim();
  const unit = form.unit.trim();
  if (!partCode || !partName || !unit) {
    ElMessage.warning('请填写零件编码、零件名称和单位');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      partCode,
      partName,
      unit,
      partSpecification: form.partSpecification.trim() || undefined,
      status: form.status
    };
    if (editingMaterialId.value) {
      await erpApi.updateInventoryMaterial(editingMaterialId.value, payload);
      ElMessage.success('零件搜索记忆已保存');
    } else {
      await erpApi.createInventoryMaterial(payload);
      ElMessage.success('零件搜索记忆已新增');
    }
    dialogVisible.value = false;
    await Promise.all([loadDashboard(), loadContextBoms()]);
  } finally {
    saving.value = false;
  }
}

async function disableMaterial(row: MaterialDashboardRow) {
  if (guardDesktopOperation('停用零件')) {
    return;
  }
  const confirmed = await openManagementConfirmDialog({
    title: '停用零件搜索记忆',
    message: `确定停用零件 ${row.partCode} / ${row.partName} 吗？`,
    details: ['系统只会停用零件搜索记忆，不会删除历史订单、库存批次、库存数量或生产记录。'],
    confirmButtonText: '停用',
    confirmButtonType: 'warning'
  });
  if (!confirmed) {
    return;
  }
  await erpApi.disableInventoryMaterial(row.id);
  ElMessage.success('零件搜索记忆已停用');
  await Promise.all([loadDashboard(), loadContextBoms()]);
}

async function enableMaterial(row: MaterialDashboardRow) {
  if (guardDesktopOperation('启用零件')) {
    return;
  }
  await erpApi.updateInventoryMaterial(row.id, { status: 'ENABLED' });
  ElMessage.success('零件搜索记忆已启用');
  await Promise.all([loadDashboard(), loadContextBoms()]);
}

function openMaterialMaintain(row: MaterialDashboardRow, action: 'drawing' | 'applicability') {
  router.push({
    path: '/inventory/materials',
    query: {
      keyword: row.partCode,
      status: row.status,
      action
    }
  });
}

function openMaterialDrawingMaintain(row: MaterialDashboardRow) {
  if (guardDesktopOperation('图纸版本维护')) {
    return;
  }
  openMaterialMaintain(row, 'drawing');
}

function openMaterialApplicabilityMaintain(row: MaterialDashboardRow) {
  if (guardDesktopOperation('适用范围维护')) {
    return;
  }
  openMaterialMaintain(row, 'applicability');
}

function openBomMaintain(row: MaterialDashboardRow) {
  if (guardDesktopOperation('BOM 维护')) {
    return;
  }
  const targetProjectModel = bomMaintainTargetProjectModel(row);
  const shouldCreateLine = canCreateBomLineForCurrentScope(row);
  router.push({
    path: '/inventory/model-boms',
    query: {
      keyword: shouldCreateLine ? undefined : row.partCode,
      customerId: filters.customerId || undefined,
      projectModel: targetProjectModel || undefined,
      scopeMode: filters.customerId ? 'PRIVATE' : 'ALL',
      status: 'ENABLED',
      action: shouldCreateLine ? 'createLine' : undefined,
      lineStructure: shouldCreateLine ? 'STANDALONE_PART' : undefined,
      materialId: shouldCreateLine ? row.id : undefined,
      materialKeyword: shouldCreateLine ? materialRouteKeyword(row) : undefined,
      materialStatus: shouldCreateLine ? row.status : undefined
    }
  });
}

function bomMaintainProjectOptions(row: MaterialDashboardRow) {
  return [...new Set(row.projectModels.map((item) => item.trim()).filter(Boolean))];
}

function bomMaintainTargetProjectModel(row: MaterialDashboardRow) {
  if (filters.projectModel.trim()) {
    return filters.projectModel.trim();
  }
  const projectOptions = bomMaintainProjectOptions(row);
  return projectOptions.length === 1 ? projectOptions[0] : '';
}

function normalizeBomScopeText(value?: string | null) {
  return String(value || '').trim().toLocaleLowerCase();
}

function contextBomScopeMode(bom: ModelBom) {
  if (bom.customerId) {
    return 'PRIVATE';
  }
  return bom.customerScopeMode === 'SELECTED' ? 'SELECTED' : 'ALL';
}

function contextBomIsAllCustomer(bom: ModelBom) {
  return contextBomScopeMode(bom) === 'ALL';
}

function contextBomScopeTypeLabel(bom: ModelBom) {
  return bom.scopeTypeLabel || (contextBomScopeMode(bom) === 'PRIVATE' ? '客户私有' : contextBomScopeMode(bom) === 'SELECTED' ? '指定客户可用' : '全部客户通用');
}

function contextBomCustomerText(bom: ModelBom) {
  if (contextBomScopeMode(bom) === 'ALL') {
    return '全部客户';
  }
  if (bom.customerName) {
    return bom.customerName;
  }
  const names = (bom.scopeCustomers || []).map((item) => item.customerName).filter(Boolean);
  return names.length > 0 ? names.join('、') : '-';
}

function contextBomCommonScopeKey(bom: ModelBom) {
  return `${bom.customerScopeKey || bom.customerId || contextBomScopeMode(bom)}__${bom.projectModelScopeKey || bom.projectModel || 'ALL'}`;
}

function contextBomCommonDragRowsForScope(bom: ModelBom) {
  const scopeKey = contextBomCommonScopeKey(bom);
  return contextBomCommonDragRows.value
    .filter((item) => contextBomCommonScopeKey(item) === scopeKey)
    .sort(
      (left, right) =>
        (left.commonSortOrder || Number.MAX_SAFE_INTEGER) - (right.commonSortOrder || Number.MAX_SAFE_INTEGER) ||
        left.bomName.localeCompare(right.bomName)
    );
}

function contextBomCommonDisplayOrder(bom: ModelBom) {
  if (bom.status !== 'ENABLED' || !bom.isCommon) {
    return '-';
  }
  const index = contextBomCommonDragRowsForScope(bom).findIndex((item) => item.id === bom.id);
  return index >= 0 ? index + 1 : '-';
}

function contextBomScopeTagType(bom: ModelBom): 'success' | 'warning' | 'info' {
  if (contextBomScopeMode(bom) === 'PRIVATE') {
    return 'warning';
  }
  return contextBomScopeMode(bom) === 'SELECTED' ? 'info' : 'success';
}

function rowHasBomLineForCurrentScope(row: MaterialDashboardRow) {
  const targetProjectModel = bomMaintainTargetProjectModel(row);
  return Boolean(
    row.bomStructureDetails?.some((detail) => {
      const customerMatches = filters.customerId ? detail.customerId === filters.customerId : !detail.customerId;
      const projectMatches =
        !targetProjectModel || normalizeBomScopeText(detail.projectModel) === normalizeBomScopeText(targetProjectModel);
      return customerMatches && projectMatches;
    })
  );
}

function canCreateBomLineForCurrentScope(row: MaterialDashboardRow) {
  const targetProjectModel = bomMaintainTargetProjectModel(row);
  return Boolean(targetProjectModel) && !rowHasBomLineForCurrentScope(row);
}

function bomMaintainActionLabel(row: MaterialDashboardRow) {
  return canCreateBomLineForCurrentScope(row) ? '加入BOM' : 'BOM';
}

function bomCurrentScopeEmptyText(row: MaterialDashboardRow) {
  if (!bomMaintainTargetProjectModel(row)) {
    return '先选择机型/项目后加入 BOM';
  }
  if (canCreateBomLineForCurrentScope(row)) {
    return row.bomStructureDetails?.length ? '当前客户/机型 BOM 未包含' : '当前范围未进 BOM';
  }
  return '选择客户或机型后可加入 BOM';
}

function materialRouteKeyword(row: MaterialDashboardRow) {
  return `${row.partCode} / ${row.partName}`;
}

function toggleContextBomCommonOnly() {
  contextBomCommonOnly.value = !contextBomCommonOnly.value;
}

function toggleContextBomScopeFilter(scopeMode: 'ALL' | 'PRIVATE' | 'SELECTED') {
  contextBomScopeFilter.value = contextBomScopeFilter.value === scopeMode ? '' : scopeMode;
}

function openContextBomMaintain() {
  if (guardDesktopOperation('零件包维护')) {
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: filters.customerId || undefined,
      projectModel: filters.projectModel.trim() || undefined,
      scopeMode: contextBomScopeFilter.value || undefined,
      commonOnly: contextBomCommonOnly.value ? 'true' : undefined,
      status: 'ENABLED'
    }
  });
}

function openContextBomMaintainByScope(scopeMode: 'ALL' | 'PRIVATE' | 'SELECTED') {
  if (guardDesktopOperation('BOM 范围查看')) {
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: scopeMode === 'ALL' ? undefined : filters.customerId || undefined,
      projectModel: filters.projectModel.trim() || undefined,
      scopeMode,
      commonOnly: contextBomCommonOnly.value ? 'true' : undefined,
      status: 'ENABLED'
    }
  });
}

function pushContextBomCreate(defaultCommon = contextBomCommonOnly.value) {
  const createAsCommon = defaultCommon || contextBomCommonOnly.value;
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: filters.customerId || undefined,
      projectModel: filters.projectModel.trim() || undefined,
      scopeMode: filters.customerId ? 'PRIVATE' : 'ALL',
      commonOnly: createAsCommon ? 'true' : undefined,
      isCommon: createAsCommon ? 'true' : undefined,
      status: 'ENABLED',
      action: 'createBom',
      bomName: contextBomCreateName(createAsCommon) || undefined
    }
  });
}

function openContextBomCreate() {
  if (guardDesktopOperation('新建零件包')) {
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  pushContextBomCreate();
}

function openContextCommonBomCreate() {
  if (guardDesktopOperation('新建常用零件包')) {
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  // 新建常用零件包仍只维护 BOM 表头和明细；常用只影响显示顺序和下单推荐优先级。
  pushContextBomCreate(true);
}

function openContextBomCopy(bom: ModelBom) {
  if (guardDesktopOperation('复制客户零件包')) {
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  if (!canCopyContextBomToCustomer(bom)) {
    ElMessage.warning('当前客户和机型已存在客户 BOM，请打开客户 BOM 继续维护，避免重复复制');
    return;
  }
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: filters.customerId || undefined,
      projectModel: filters.projectModel.trim() || bom.projectModel || undefined,
      status: 'ENABLED',
      bomId: bom.id,
      action: 'copyBom',
      bomName: contextBomCopyName(bom)
    }
  });
}

function contextCustomerBomForSource(bom: ModelBom) {
  if (!filters.customerId || !contextBomIsAllCustomer(bom)) {
    return undefined;
  }
  const sourceProjectModel = normalizeBomScopeText(filters.projectModel.trim() || bom.projectModel);
  return contextBoms.value.find(
    (item) => item.customerId === filters.customerId && normalizeBomScopeText(item.projectModel) === sourceProjectModel
  );
}

function canCopyContextBomToCustomer(bom: ModelBom) {
  return Boolean(filters.customerId && contextBomIsAllCustomer(bom) && !contextCustomerBomForSource(bom));
}

function openContextCustomerBomDetail(bom: ModelBom) {
  const customerBom = contextCustomerBomForSource(bom);
  if (!customerBom) {
    return;
  }
  openContextBomDetail(customerBom);
}

function openContextBomDetail(bom: ModelBom) {
  if (guardDesktopOperation('BOM 明细维护')) {
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: bom.customerId || filters.customerId || undefined,
      projectModel: bom.projectModel || filters.projectModel.trim() || undefined,
      scopeMode: contextBomScopeMode(bom),
      status: bom.status === 'DISABLED' ? 'ALL' : 'ENABLED',
      bomId: bom.id
    }
  });
}

async function disableContextBom(bom: ModelBom) {
  if (guardDesktopOperation('停用 BOM')) {
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  const operationKey = contextBomOperationKey(bom, 'disable');
  bomOperationSavingKey.value = operationKey;
  try {
    const confirmed = await openManagementConfirmDialog({
      title: '停用 BOM',
      message: `确定停用 ${bom.bomName} 吗？`,
      details: [
        '停用只影响后续推荐，不会删除历史订单引用或 BOM 明细。',
        '误建无效 BOM 请使用删除。',
        bom.isCommon ? '该 BOM 当前为常用，停用后会同时取消常用排序。' : ''
      ].filter(Boolean),
      confirmButtonText: '停用',
      confirmButtonType: 'warning'
    });
    if (!confirmed) {
      return;
    }
    // BOM 停用用于保留历史订单和 BOM 行引用；误建无效 BOM 才走物理删除。
    await erpApi.disableModelBom(bom.id);
    ElMessage.success('零件包已停用');
    await Promise.all([loadDashboard(), loadContextBoms()]);
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error instanceof Error ? error.message : 'BOM 停用失败，请确认后端服务和当前 BOM 状态');
    }
  } finally {
    if (bomOperationSavingKey.value === operationKey) {
      bomOperationSavingKey.value = '';
    }
  }
}

async function enableContextBom(bom: ModelBom, operationKey = contextBomOperationKey(bom, 'enable')) {
  if (guardDesktopOperation('启用 BOM')) {
    return;
  }
  if (bomOperationSavingKey.value && bomOperationSavingKey.value !== operationKey) {
    return;
  }
  bomOperationSavingKey.value = operationKey;
  try {
    const confirmed = await openManagementConfirmDialog({
      title: '启用 BOM',
      message: `确定恢复启用 ${bom.bomName} 吗？`,
      details: [
        '启用后会重新参与后续推荐。',
        '是否设为常用需要单独人工设置。',
        '恢复启用只改 BOM 表头状态，不自动恢复常用排序，不生成订单、生产任务或库存。'
      ],
      confirmButtonText: '启用',
      confirmButtonType: 'warning'
    });
    if (!confirmed) {
      return;
    }
    // 恢复启用只改 BOM 表头状态，不自动恢复常用排序、不生成订单、生产任务或库存。
    await erpApi.updateModelBom(bom.id, {
      bomName: bom.bomName,
      customerScopeMode: contextBomScopeMode(bom),
      customerId: bom.customerId || undefined,
      customerIds: bom.scopeCustomerIds,
      projectModel: bom.projectModel,
      remark: bom.remark || undefined,
      status: 'ENABLED'
    });
    ElMessage.success('零件包已恢复启用');
    await Promise.all([loadDashboard(), loadContextBoms()]);
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error instanceof Error ? error.message : 'BOM 启用失败，请确认客户和机型范围没有冲突');
    }
  } finally {
    if (bomOperationSavingKey.value === operationKey) {
      bomOperationSavingKey.value = '';
    }
  }
}

async function setContextBomCommon(bom: ModelBom, isCommon: boolean) {
  if (guardDesktopOperation(isCommon ? '设置常用零件包' : '取消常用零件包')) {
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  if (isCommon && bom.status === 'DISABLED') {
    ElMessage.warning('已停用 BOM 不能设为常用，请先恢复启用');
    return;
  }
  const operationKey = contextBomOperationKey(bom, 'common');
  bomOperationSavingKey.value = operationKey;
  try {
    if (!(await confirmSetContextBomCommon(bom, isCommon))) {
      return;
    }
    await erpApi.setModelBomCommon(bom.id, isCommon);
    ElMessage.success(isCommon ? '已设为常用零件包' : '已取消常用零件包');
    await Promise.all([loadDashboard(), loadContextBoms()]);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '常用零件包设置失败，请确认后端服务和当前 BOM 状态');
  } finally {
    if (bomOperationSavingKey.value === operationKey) {
      bomOperationSavingKey.value = '';
    }
  }
}

async function confirmSetContextBomCommon(bom: ModelBom, isCommon: boolean) {
  const actionText = isCommon ? '设为常用' : '取消常用';
  const scopeText = [contextBomScopeTypeLabel(bom), contextBomCustomerText(bom), bom.projectModel || '全部机型/项目'].join(' / ');
  return openManagementConfirmDialog({
    title: `${actionText} BOM`,
    message: `确定将 ${bom.bomName} ${actionText}吗？`,
    details: [
      `范围：${scopeText}`,
      '常用 BOM 只影响当前范围内的显示顺序和下单推荐优先级，不会修改 BOM 明细、适用客户、订单、生产任务或库存。'
    ],
    confirmButtonText: actionText,
    confirmButtonType: isCommon ? 'warning' : 'info'
  });
}

function startContextBomDrag(event: DragEvent, bom: ModelBom) {
  const scopedRows = contextBomCommonDragRowsForScope(bom);
  if (bomOperationSavingKey.value || bom.status !== 'ENABLED' || !bom.isCommon || scopedRows.length <= 1) {
    event.preventDefault();
    return;
  }
  draggedContextBomId.value = bom.id;
  draggedContextBomScopeKey.value = contextBomCommonScopeKey(bom);
  contextBomDragOverId.value = bom.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', bom.id);
  }
}

function handleContextBomDragOver(event: DragEvent, bom: ModelBom) {
  if (
    bomOperationSavingKey.value ||
    !draggedContextBomId.value ||
    bom.status !== 'ENABLED' ||
    !bom.isCommon ||
    contextBomCommonScopeKey(bom) !== draggedContextBomScopeKey.value
  ) {
    return;
  }
  contextBomDragOverId.value = bom.id;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

async function dropContextBom(bom: ModelBom) {
  if (bomOperationSavingKey.value) {
    endContextBomDrag();
    return;
  }
  const sourceId = draggedContextBomId.value;
  const sourceScopeKey = draggedContextBomScopeKey.value;
  endContextBomDrag();
  if (!sourceId || bom.status !== 'ENABLED' || !bom.isCommon || sourceId === bom.id) {
    return;
  }
  if (contextBomCommonScopeKey(bom) !== sourceScopeKey) {
    ElMessage.warning('常用 BOM 只能在同一客户范围和同一机型/项目范围内拖拽排序');
    return;
  }
  const orderedRows = [...contextBomCommonDragRowsForScope(bom)];
  const fromIndex = orderedRows.findIndex((item) => item.id === sourceId);
  const toIndex = orderedRows.findIndex((item) => item.id === bom.id);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return;
  }
  const [moved] = orderedRows.splice(fromIndex, 1);
  if (!moved) {
    return;
  }
  orderedRows.splice(toIndex, 0, moved);
  const operationKey = contextBomOperationKey(bom, 'common');
  bomOperationSavingKey.value = operationKey;
  try {
    await erpApi.reorderModelBomCommon({
      items: orderedRows.map((item, index) => ({ bomId: item.id, commonSortOrder: index + 1 }))
    });
    ElMessage.success('当前适用常用 BOM 顺序已保存');
    await loadContextBoms();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '当前适用常用 BOM 排序保存失败，请确认后端服务');
  } finally {
    if (bomOperationSavingKey.value === operationKey) {
      bomOperationSavingKey.value = '';
    }
  }
}

function endContextBomDrag() {
  draggedContextBomId.value = '';
  draggedContextBomScopeKey.value = '';
  contextBomDragOverId.value = '';
}

async function deleteContextBom(bom: ModelBom) {
  if (guardDesktopOperation('删除无效 BOM')) {
    return;
  }
  if (bomOperationSavingKey.value) {
    return;
  }
  const operationKey = contextBomOperationKey(bom, 'delete');
  bomOperationSavingKey.value = operationKey;
  try {
    if (!(await confirmDeleteBom(bom))) {
      return;
    }
    // 永久删除只用于误操作创建的无效 BOM；后端会阻断仍被客户副本引用的来源 BOM。
    const result = await erpApi.deleteModelBom(bom.id);
    ElMessage.success(
      `已删除无效 BOM：${result.bomName}，清理 ${result.lineCount} 行明细、${result.customerScopeCount} 个适用客户、${result.diffReviewCount} 条差异核对记录`
    );
    await Promise.all([loadDashboard(), loadContextBoms()]);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无效 BOM 删除失败，请确认后端服务和当前 BOM 状态');
  } finally {
    if (bomOperationSavingKey.value === operationKey) {
      bomOperationSavingKey.value = '';
    }
  }
}

async function confirmDeleteBom(bom: ModelBom) {
  return openManagementConfirmDialog({
    title: '删除无效 BOM',
    message: `确定永久删除 ${bom.bomName} 吗？`,
    details: [
      '该操作会删除 BOM 表头、包内明细和差异核对记录。',
      '仅用于误操作创建的无效 BOM。',
      '不会删除订单、生产或库存数据。'
    ],
    confirmButtonText: '永久删除',
    confirmButtonType: 'danger'
  });
}

function contextBomCreateName(isCommon = false) {
  const projectModel = filters.projectModel.trim();
  const commonText = isCommon ? '常用' : '';
  if (!projectModel) {
    return filters.customerId ? `客户${commonText}通用零件包` : `百胜${commonText}通用零件包`;
  }
  return `${projectModel} ${filters.customerId ? `客户${commonText}零件包` : `百胜${commonText}通用零件包`}`;
}

function contextBomCopyName(bom: ModelBom) {
  const projectModel = filters.projectModel.trim() || bom.projectModel;
  return projectModel ? `${projectModel} 客户零件包` : '客户通用零件包';
}

function openBomStructureDetail(row: MaterialDashboardRow, detail: MaterialDashboardBomStructureDetail) {
  if (guardDesktopOperation('BOM 行维护')) {
    return;
  }
  router.push({
    path: '/inventory/model-boms',
    query: {
      keyword: row.partCode,
      customerId: filters.customerId || undefined,
      projectModel: detail.projectModel || filters.projectModel || row.projectModels[0] || undefined,
      status: 'ENABLED',
      bomId: detail.bomId,
      lineId: detail.lineId,
      action: 'editLine'
    }
  });
}

async function openSourceDetails(row: MaterialDashboardRow) {
  if (!row.partCode?.trim()) {
    ElMessage.warning('请先选择零件');
    return;
  }
  sourceDetailsVisible.value = true;
  sourceDetailsLoading.value = true;
  sourceDetails.value = null;
  const requestId = ++sourceDetailsRequestSeq.value;
  try {
    const detail = await erpApi.inventoryMaterialSourceDetails(row.partCode.trim(), {
      unit: row.unit,
      sourceType: 'ALL',
      customerId: filters.customerId || undefined
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

function buildDashboardText() {
  if (!dashboard.items.length) {
    return '';
  }
  const header = [
    `零件管理固定格式清单`,
    `筛选：客户 ${selectedCustomerFilterLabel()}；机型 ${filters.projectModel || '全部'}；关键字 ${filters.keyword || '无'}；当前关系 ${materialRelationFilterLabel(filters.relationType)}；图纸来源 ${drawingSourceFilterLabel(filters.drawingSource)}；BOM 结构 ${bomStructureFilterLabel(filters.bomStructureType)}；BOM 状态 ${bomPresenceFilterLabel(filters.bomPresence)}；下单记录 ${recentOrderPresenceFilterLabel(filters.recentOrderPresence)}；排序 ${dashboardSortByLabel(filters.sortBy)} / ${dashboardSortOrderLabel(filters.sortOrder)}；状态 ${filters.status || '全部'}`,
    `页码：第 ${pagination.page} 页；本页 ${dashboard.items.length} 条；总计 ${dashboard.totalCount} 条`
  ].join('\n');
  const body = dashboard.items.map((row, index) => formatDashboardRowText(row, index + 1)).join('\n');
  return `${header}\n${body}`;
}

function selectedCustomerFilterLabel() {
  if (!filters.customerId) {
    return '全部';
  }
  return selectedCustomerName.value || '已选客户';
}

function formatDashboardRowText(row: MaterialDashboardRow, index: number) {
  return [
    `${index}. ${row.partCode} | ${row.partName}`,
    `类型：${row.partType || row.scopeLabel || '-'}；当前关系：${row.currentRelationLabel || '-'}；说明：${row.currentRelationDescription || '-'}；范围：${row.scopeLabel || '-'}；客户：${joinPreview(row.customerNames, '全部客户')}；机型：${joinPreview(materialProjectScopeValues(row), '全部机型')}`,
    `图纸：${row.drawingNo || '-'} / ${row.drawingVersion || '-'} / ${row.drawingDate || '-'} / ${row.drawingStatus || '-'}；来源：${row.drawingSourceLabel || '-'}`,
    `厚度规格：${row.partThickness ?? '-'} / ${row.partSpecification || '-'}；默认数量：${row.defaultQuantity ? formatQuantity(row.defaultQuantity, row.defaultQuantityUnit || row.unit) : '-'}；默认工艺：${row.defaultProcessRoute || '-'}`,
    `最近下单：${row.lastOrderDate || '-'} / ${row.lastOrderNo || '-'} / ${row.lastCustomerName || '-'}；库存：可用 ${formatQuantity(row.availableQuantity, row.unit)}，订单 ${formatQuantity(row.orderInventoryQuantity, row.unit)}，备货 ${formatQuantity(row.stockInventoryQuantity, row.unit)}；BOM：${joinPreview(row.bomNames, '-')}；结构：${dashboardBomStructureSummary(row)}`,
    ...dashboardBomStructureTextLines(row)
  ].join('\n');
}

function dashboardBomStructureSummary(row: MaterialDashboardRow) {
  return row.bomStructureDetails?.length
    ? row.bomStructureDetails.map((detail) => `${detail.structureLabel} @ ${detail.bomName}`).join('；')
    : joinPreview(row.bomStructureLabels || [], row.bomStructureLabel || '-');
}

function dashboardBomStructureTextLines(row: MaterialDashboardRow) {
  if (!row.bomStructureDetails?.length) {
    return [];
  }
  return row.bomStructureDetails.map((detail, index) => `  ${index + 1}) ${dashboardBomStructureDetailText(detail)}`);
}

function dashboardBomStructureDetailText(detail: MaterialDashboardBomStructureDetail) {
  const customerName = detail.customerName || '全部客户';
  const projectModel = detail.projectModel || '-';
  return `${detail.bomName} / ${customerName} / ${projectModel} / ${detail.structureLabel} / 顺序 ${detail.displayOrder || '-'}`;
}

function buildContextBomText() {
  if (!contextBomVisibleRows.value.length) {
    return '';
  }
  const header = [
    '序号',
    'BOM范围',
    '常用',
    '常用排序',
    '零件包',
    '适用范围',
    '客户',
    '机型/项目',
    '状态',
    '零件数',
    '组件',
    '子零件',
    '单独零件',
    '停用行',
    '来源BOM'
  ].join('\t');
  const rows = contextBomVisibleRows.value.map((bom, index) => {
    const summary = contextBomSummary(bom);
    return [
      index + 1,
      contextBomScopeTypeLabel(bom),
      bom.isCommon ? '常用' : '非常用',
      bom.isCommon ? contextBomCommonDisplayOrder(bom) : '-',
      bom.bomName,
      bom.scopeLabel,
      contextBomCustomerText(bom),
      bom.projectModel || '全部机型/项目',
      contextBomStatusText(bom.status),
      bom.lineCount,
      summary.componentCount,
      summary.childPartCount,
      summary.standalonePartCount,
      summary.disabledCount,
      bom.sourceBomNameSnapshot || '-'
    ].join('\t');
  });
  return [
    '当前适用零件包范围清单',
    `${contextBomScopeText.value}；显示 ${contextBomVisibleRows.value.length} / 原始 ${contextBoms.value.length} 个`,
    `筛选：BOM 范围 ${contextBomScopeFilter.value ? contextBomScopeFilterLabel(contextBomScopeFilter.value) : '全部'}；常用 ${contextBomCommonOnly.value ? '只看常用' : '全部'}`,
    '常用说明：常用 BOM 只影响同一客户/机型范围内的显示顺序和下单推荐优先级，不修改 BOM 明细、适用客户、订单、生产任务或库存。',
    '普通可用说明：非常用 BOM 仍可维护、复制和手动用于下单，只是不参与常用优先排序。',
    `范围统计：全部客户通用 ${contextBomAllCustomerCount.value}；指定客户可用 ${contextBomSelectedCustomerCount.value}；客户私有 ${contextBomPrivateCount.value}；常用 BOM ${contextBomCommonCount.value}`,
    header,
    ...rows
  ].join('\n');
}

function contextBomScopeFilterLabel(scopeMode: 'ALL' | 'SELECTED' | 'PRIVATE') {
  return scopeMode === 'ALL' ? '全部客户通用' : scopeMode === 'SELECTED' ? '指定客户可用' : '客户私有';
}

function contextBomStatusText(status: CommonStatus) {
  return status === 'ENABLED' ? '启用' : '停用';
}

function dashboardBomStructureTagType(type: MaterialDashboardBomStructureDetail['structureType']) {
  if (type === 'COMPONENT') {
    return 'warning';
  }
  if (type === 'CHILD_PART') {
    return 'success';
  }
  return 'info';
}

function materialRelationTagType(type?: MaterialDashboardRow['currentRelationType']) {
  if (type === 'BOM') {
    return 'success';
  }
  if (type === 'APPLICABILITY') {
    return 'warning';
  }
  if (type === 'ORDER_HISTORY') {
    return 'primary';
  }
  return 'info';
}

function compareContextBomLinesByStoredOrder(left: ModelBomLine, right: ModelBomLine) {
  const leftDisplayOrder = Number(left.displayOrder || 0);
  const rightDisplayOrder = Number(right.displayOrder || 0);
  if (leftDisplayOrder > 0 && rightDisplayOrder > 0 && leftDisplayOrder !== rightDisplayOrder) {
    return leftDisplayOrder - rightDisplayOrder;
  }
  if (leftDisplayOrder > 0 && rightDisplayOrder <= 0) {
    return -1;
  }
  if (rightDisplayOrder > 0 && leftDisplayOrder <= 0) {
    return 1;
  }
  return (
    Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
    String(left.partCode || '').localeCompare(String(right.partCode || '')) ||
    String(left.id || '').localeCompare(String(right.id || ''))
  );
}

function normalizeContextBomComponentNo(value?: string | null) {
  return String(value || '').trim().toUpperCase();
}

function contextBomActiveLines(bom: ModelBom) {
  const sortedLines = [...(bom.lines || [])]
    .filter((line) => line.status === 'ENABLED' && line.materialStatus !== 'DISABLED')
    .sort(compareContextBomLinesByStoredOrder);
  const enabledComponentNos = new Set(
    sortedLines
      .filter((line) => contextBomStructureType(line) === 'COMPONENT')
      .map((line) => normalizeContextBomComponentNo(line.componentNo))
      .filter(Boolean)
  );
  const childrenByParent = new Map<string, ModelBomLine[]>();
  const rootLines: ModelBomLine[] = [];

  for (const line of sortedLines) {
    const parentComponentNo = normalizeContextBomComponentNo(line.parentComponentNo);
    if (contextBomStructureType(line) === 'CHILD_PART' && parentComponentNo && enabledComponentNos.has(parentComponentNo)) {
      childrenByParent.set(parentComponentNo, [...(childrenByParent.get(parentComponentNo) || []), line]);
    } else {
      rootLines.push(line);
    }
  }

  const orderedLines: ModelBomLine[] = [];
  const attachedLineIds = new Set<string>();
  const appendLine = (line: ModelBomLine) => {
    if (attachedLineIds.has(line.id)) {
      return;
    }
    orderedLines.push(line);
    attachedLineIds.add(line.id);
  };

  // 零件管理当前适用 BOM 预览顺序跟机型 BOM 页一致：父组件后面紧跟子零件，内部 sortOrder 只作为拖拽持久化值。
  for (const line of rootLines) {
    appendLine(line);
    const componentNo = normalizeContextBomComponentNo(line.componentNo);
    if (contextBomStructureType(line) !== 'COMPONENT' || !componentNo) {
      continue;
    }
    for (const childLine of childrenByParent.get(componentNo) || []) {
      appendLine(childLine);
    }
  }

  for (const line of sortedLines) {
    appendLine(line);
  }

  return orderedLines;
}

function contextBomPreviewLines(bom: ModelBom) {
  const output: ModelBomLine[] = [];
  for (const line of contextBomActiveLines(bom)) {
    output.push(line);
    if (output.length >= 5) {
      break;
    }
  }
  return output;
}

function contextBomLineDisplayOrder(bom: ModelBom, line: ModelBomLine) {
  const orderedLines = contextBomActiveLines(bom);
  const index = orderedLines.findIndex((item) => item.id === line.id);
  return index >= 0 ? index + 1 : '-';
}

function contextBomSummary(bom: ModelBom) {
  const activeLines = contextBomActiveLines(bom);
  const componentCount = activeLines.filter((line) => contextBomStructureType(line) === 'COMPONENT').length;
  const childPartCount = activeLines.filter((line) => contextBomStructureType(line) === 'CHILD_PART').length;
  const standalonePartCount = activeLines.filter((line) => contextBomStructureType(line) === 'STANDALONE_PART').length;
  const disabledCount = (bom.lines || []).filter((line) => line.status === 'DISABLED' || line.materialStatus === 'DISABLED').length;
  return {
    activeLineCount: activeLines.length,
    componentCount,
    childPartCount,
    standalonePartCount,
    disabledCount
  };
}

function contextBomStructureType(line: ModelBomLine) {
  if (line.structureType) {
    return line.structureType;
  }
  if (line.lineType === 'COMPONENT') {
    return 'COMPONENT';
  }
  return line.parentComponentNo ? 'CHILD_PART' : 'STANDALONE_PART';
}

function contextBomStructureLabel(line: ModelBomLine) {
  const structureType = contextBomStructureType(line);
  if (structureType === 'COMPONENT') {
    return `组件 ${line.componentNo || '-'}`;
  }
  if (structureType === 'CHILD_PART') {
    return `子零件 -> ${line.parentComponentNo || '未匹配父级'}`;
  }
  return '单独零件';
}

function contextBomStructureTagType(line: ModelBomLine) {
  const structureType = contextBomStructureType(line);
  if (structureType === 'COMPONENT') {
    return 'warning';
  }
  if (structureType === 'CHILD_PART') {
    return 'success';
  }
  return 'info';
}

function openDashboardTextDialog() {
  if (!dashboardFixedText.value.trim()) {
    ElMessage.warning('暂无可查看的零件清单');
    return;
  }
  dashboardTextDialogVisible.value = true;
}

function openContextBomTextDialog() {
  if (!contextBomFixedText.value.trim()) {
    ElMessage.warning('暂无可查看的当前适用零件包范围清单');
    return;
  }
  contextBomTextDialogVisible.value = true;
}

async function copyDashboardText() {
  const text = dashboardFixedText.value;
  if (!text) {
    ElMessage.warning('暂无可复制的零件清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('零件固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

async function copyContextBomText() {
  const text = contextBomFixedText.value;
  if (!text) {
    ElMessage.warning('暂无可复制的当前适用零件包范围清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('当前适用零件包范围清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

function materialRelationFilterLabel(value: typeof filters.relationType) {
  return (
    {
      BOM: 'BOM 零件',
      APPLICABILITY: '显式适用',
      ORDER_HISTORY: '订单历史',
      MATERIAL_ONLY: '仅搜索记忆',
      '': '全部'
    }[value] || '全部'
  );
}

function drawingSourceFilterLabel(value: typeof filters.drawingSource) {
  return (
    {
      BOM_LINE: 'BOM 指定图纸',
      MATERIAL_DEFAULT: '零件默认图纸',
      MATERIAL_LATEST: '零件最新图纸',
      ORDER_HISTORY: '历史订单图纸',
      NONE: '无图纸',
      '': '全部'
    }[value] || '全部'
  );
}

function bomStructureFilterLabel(value: typeof filters.bomStructureType) {
  return (
    {
      COMPONENT: '组件',
      CHILD_PART: '子零件',
      STANDALONE_PART: '单独零件',
      NONE: '未进 BOM',
      '': '全部'
    }[value] || '全部'
  );
}

function bomPresenceFilterLabel(value: typeof filters.bomPresence) {
  return (
    {
      WITH_BOM: '已进 BOM',
      WITHOUT_BOM: '未进 BOM',
      '': '全部'
    }[value] || '全部'
  );
}

function recentOrderPresenceFilterLabel(value: typeof filters.recentOrderPresence) {
  return (
    {
      WITH_RECENT_ORDER: '有历史下单',
      WITHOUT_RECENT_ORDER: '无历史下单',
      '': '全部'
    }[value] || '全部'
  );
}

function dashboardSortByLabel(value: typeof filters.sortBy) {
  return (
    {
      LAST_ORDER_DATE: '最近下单',
      DRAWING_DATE: '图纸日期',
      BOM_STATUS: 'BOM 状态',
      PART_CODE: '零件编码',
      UPDATED_AT: '更新时间'
    }[value] || '最近下单'
  );
}

function dashboardSortOrderLabel(value: typeof filters.sortOrder) {
  return (
    {
      DESC: '降序',
      ASC: '升序'
    }[value] || '降序'
  );
}

function formatRangeText(value: string[]) {
  return value.filter(Boolean).join(' 至 ') || '全部';
}

function materialProjectScopeValues(row: MaterialDashboardRow) {
  const values = row.projectModels.map((item) => item.trim()).filter(Boolean);
  if (row.hasGlobalProjectScope) {
    values.unshift('全部机型/项目');
  }
  return [...new Set(values)];
}

function joinPreview(values: string[], emptyText = '-') {
  const filtered = values.filter(Boolean);
  if (filtered.length === 0) {
    return emptyText;
  }
  const preview = filtered.filter((_, index) => index < 3).join('、');
  return filtered.length > 3 ? `${preview} 等 ${filtered.length} 项` : preview;
}

function formatQuantity(value: number | undefined | null, unit?: string | null) {
  return `${formatNumber(value || 0)} ${unit || ''}`.trim();
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}
</script>

<style scoped>
.page-subtitle {
  margin: 6px 0 0;
  color: #64748b;
}

.stat-action {
  appearance: none;
  border: 1px solid #e2e8f0;
  text-align: left;
  cursor: pointer;
}

.stat-action:hover,
.stat-action.active {
  border-color: #94a3b8;
  background: #f8fafc;
}

.summary-filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin: -6px 0 18px;
}

.summary-filter-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  padding: 9px 12px;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  background: #fff;
  color: #475569;
  cursor: pointer;
}

.summary-filter-chip:hover,
.summary-filter-chip.active {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

.summary-filter-chip span {
  overflow-wrap: anywhere;
}

.summary-filter-chip strong {
  color: #0f172a;
}

.relation-boundary-alert {
  margin: -6px 0 18px;
}

.active-filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: -4px 0 18px;
  color: #64748b;
  font-size: 13px;
}

.active-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  cursor: pointer;
}

.active-filter-chip span {
  font-weight: 700;
}

.active-filter-chip:hover {
  border-color: #2563eb;
  background: #dbeafe;
}

.management-confirm-panel {
  display: grid;
  gap: 10px;
  color: #475569;
  font-size: 14px;
  line-height: 1.65;
}

.management-confirm-panel p {
  margin: 0;
}

.management-confirm-panel ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
}

.project-quick-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: -10px 0 18px;
}

.project-quick-toolbar {
  display: flex;
  align-items: center;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 8px;
}

.project-quick-list span:not(.project-quick-state) {
  color: #64748b;
  font-size: 13px;
}

.project-quick-toolbar > span:not(.project-quick-state) {
  font-weight: 700;
  color: #334155;
}

.project-quick-state {
  flex: 0 0 auto;
  font-weight: 500;
}

.project-quick-hint {
  flex: 1 1 100%;
  color: #94a3b8;
}

.project-quick-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.project-quick-item.is-dragging {
  opacity: 0.58;
}

.project-quick-item.is-drop-before::before,
.project-quick-item.is-drop-after::after {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 999px;
  background: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
}

.project-quick-item.is-drop-before::before {
  left: -5px;
}

.project-quick-item.is-drop-after::after {
  right: -5px;
}

.project-quick-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #64748b;
  background: #f8fafc;
  cursor: grab;
}

.project-quick-drag-handle:active {
  cursor: grabbing;
}

.project-quick-drag-handle.is-disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.project-quick-item .el-button {
  margin-left: 0;
}

.project-quick-filter {
  min-width: 42px;
}

.context-bom-panel {
  margin: -8px 0 18px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.context-bom-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
  gap: 12px;
  padding: 14px 16px 16px;
}

.context-bom-scope-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 16px 12px;
  border-bottom: 1px solid #e2e8f0;
}

.context-bom-common-hint {
  flex: 1 1 100%;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.context-bom-card {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.context-bom-card.is-common-drop-target {
  border-color: #60a5fa;
  background: #eff6ff;
}

.context-bom-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.context-bom-common-drag-handle {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 1px solid #93c5fd;
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  cursor: grab;
}

.context-bom-common-drag-handle:active {
  cursor: grabbing;
}

.context-bom-common-drag-handle.is-disabled {
  border-color: #e2e8f0;
  background: #f8fafc;
  color: #94a3b8;
  cursor: not-allowed;
}

.context-bom-card__header > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.context-bom-card__header strong {
  color: #0f172a;
  overflow-wrap: anywhere;
}

.context-bom-card__header span,
.context-bom-line small,
.context-bom-more {
  color: #64748b;
  font-size: 12px;
}

.context-bom-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.context-bom-lines {
  display: grid;
  gap: 7px;
}

.context-bom-line {
  display: grid;
  grid-template-columns: minmax(94px, auto) minmax(0, 1fr);
  gap: 6px 8px;
  align-items: center;
  min-width: 0;
}

.context-bom-line > span {
  color: #0f172a;
  overflow-wrap: anywhere;
}

.context-bom-line small {
  grid-column: 2;
}

.context-bom-more {
  padding-left: 2px;
}

.context-bom-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #e2e8f0;
}

.section-heading > div {
  display: grid;
  gap: 4px;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-heading span {
  color: #64748b;
  font-size: 12px;
}

.cell-subtext {
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.dashboard-bom-structure-list {
  display: grid;
  gap: 6px;
  margin-top: 6px;
}

.dashboard-bom-structure-list > div {
  display: grid;
  gap: 3px;
}

.dashboard-bom-structure-list .el-button {
  justify-self: start;
  min-height: 22px;
  padding: 0;
}

.dashboard-bom-structure-list small {
  color: #64748b;
  font-size: 12px;
  line-height: 16px;
}

.dashboard-bom-empty {
  display: grid;
  gap: 4px;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
}

.dashboard-bom-empty .el-button {
  justify-self: start;
  min-height: 22px;
  padding: 0;
}

.fixed-format-textarea :deep(textarea) {
  min-height: 420px;
  font-family: Consolas, 'Courier New', monospace;
  line-height: 1.55;
  white-space: pre;
}

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  padding: 14px 16px;
  border-top: 1px solid #e2e8f0;
}

.mobile-pagination-bar {
  display: none;
}

.mobile-pagination-actions {
  display: flex;
  gap: 8px;
}

.mobile-readonly-note {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  color: #64748b;
  font-size: 12px;
}

@media (max-width: 900px) {
  .project-quick-list {
    align-items: stretch;
    margin-top: 0;
  }

  .project-quick-list span {
    width: 100%;
  }

  .project-quick-toolbar {
    width: 100%;
  }

  .project-quick-toolbar .el-select {
    flex: 1 1 180px;
  }

  .project-quick-list .el-button {
    flex: 1 1 96px;
    margin-left: 0;
  }

  .project-quick-item {
    flex: 1 1 100%;
  }

  .project-quick-hint {
    width: 100%;
  }

  .context-bom-grid {
    grid-template-columns: 1fr;
    padding: 12px;
  }

  .context-bom-card__header {
    display: grid;
  }

  .context-bom-line {
    grid-template-columns: 1fr;
  }

  .context-bom-line small {
    grid-column: auto;
  }

  .mobile-pagination-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 0 4px;
    color: #64748b;
    font-size: 13px;
  }

  .mobile-pagination-actions {
    width: 100%;
  }

  .mobile-pagination-actions .el-button {
    flex: 1 1 96px;
    margin-left: 0;
  }
}
</style>
