<template>
  <section class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">机型零件包</h2>
        <p class="page-subtitle">维护 B3、B5 等机型/项目的标准零件清单；仅作为后续下单推荐基础。</p>
      </div>
      <div class="page-actions">
        <el-button @click="returnFromModelBom">{{ modelBomReturnButtonText }}</el-button>
        <el-button v-if="!isMobileLayout" :loading="bomScopeApprovalLoading" @click="openBomScopeApprovalDialog">范围审批</el-button>
        <el-button v-if="!isMobileLayout" :icon="Download" :loading="modelBomExporting" @click="exportModelBomsExcel">导出 Excel</el-button>
        <el-button v-if="!isMobileLayout" type="primary" @click="openBomCreateDialog">新增零件包</el-button>
      </div>
    </div>

    <el-alert
      class="model-bom-alert"
      type="info"
      :closable="false"
      show-icon
      title="业务边界"
      description="机型零件包只维护客户/机型下应包含哪些零件和默认数量；不会自动生成订单、不会占库存、不会创建生产任务。"
    />
    <div class="mobile-section">
      <el-alert
        title="手机端仅查看机型零件包"
        description="新增、编辑、复制、停用、删除、启用和拖拽排序请在电脑端操作。"
        type="info"
        :closable="false"
      />
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>关键字</label>
        <el-input v-model="filters.keyword" clearable placeholder="包名 / 机型 / 客户 / 零件" style="width: 260px" @keyup.enter="searchModelBoms" @clear="searchModelBoms" />
      </div>
      <div class="filter-field">
        <label>客户</label>
        <CustomerSelect
          v-model="filters.customerId"
          width="220px"
          placeholder="全部客户"
          @change="searchModelBoms"
          @selected-customer-change="handleSelectedCustomerChange"
        />
      </div>
      <div class="filter-field">
        <label>BOM 范围</label>
        <el-select v-model="filters.scopeMode" placeholder="全部范围" clearable style="width: 160px" @change="searchModelBoms">
          <el-option label="全部客户通用" value="ALL" />
          <el-option label="指定客户可用" value="SELECTED" />
          <el-option label="客户私有" value="PRIVATE" />
        </el-select>
      </div>
      <div class="filter-field">
        <label>机型/项目</label>
        <el-input v-model="filters.projectModel" clearable placeholder="例如 B3 / B5" style="width: 180px" @keyup.enter="searchModelBoms" @clear="searchModelBoms" />
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="filters.status" placeholder="状态" style="width: 130px" @change="searchModelBoms">
          <el-option label="全部" value="ALL" />
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
      </div>
      <div class="filter-field filter-field-checkbox">
        <label>常用</label>
        <el-checkbox v-model="filters.commonOnly" @change="searchModelBoms">只看常用 BOM</el-checkbox>
      </div>
      <el-button type="primary" :loading="loading" @click="searchModelBoms">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>
    <div v-if="modelBomFilterSummaryVisible" class="model-bom-filter-summary">
      当前筛选：关键字 {{ modelBomKeywordFilterLabel() }}；客户 {{ selectedCustomerFilterLabel() }}；机型 {{ filters.projectModel || '全部' }}；BOM 范围 {{ modelBomScopeFilterLabel() }}；泛用包 {{ modelBomGlobalAllProjectFilterLabel() }}；常用 {{ modelBomCommonFilterLabel() }}；状态 {{ modelBomStatusFilterLabel() }}
    </div>
    <div v-if="modelBomScopeSummaryVisible" class="model-bom-scope-summary" aria-label="BOM 范围统计">
      <span>范围统计</span>
      <button
        class="model-bom-scope-chip"
        :class="{ active: filters.scopeMode === 'ALL' }"
        type="button"
        @click="applyModelBomScopeFilter('ALL')"
      >
        全部客户通用 <strong>{{ modelBomScopeSummary.allCustomerCount }}</strong>
      </button>
      <button
        class="model-bom-scope-chip"
        :class="{ active: filters.scopeMode === 'SELECTED' }"
        type="button"
        @click="applyModelBomScopeFilter('SELECTED')"
      >
        指定客户可用 <strong>{{ modelBomScopeSummary.selectedCustomerCount }}</strong>
      </button>
      <button
        class="model-bom-scope-chip"
        :class="{ active: filters.scopeMode === 'PRIVATE' }"
        type="button"
        @click="applyModelBomScopeFilter('PRIVATE')"
      >
        客户私有 <strong>{{ modelBomScopeSummary.privateCount }}</strong>
      </button>
      <button
        class="model-bom-scope-chip"
        :class="{ active: filters.commonOnly }"
        type="button"
        @click="applyModelBomCommonFilter"
      >
        常用 BOM <strong>{{ modelBomScopeSummary.commonCount }}</strong>
      </button>
      <small>统计基于当前关键字、客户、机型和状态，不受 BOM 范围和常用筛选影响。</small>
    </div>
    <div class="model-bom-scope-guide" aria-label="BOM 范围说明">
      <span class="model-bom-scope-guide-title">查看方式</span>
      <button
        v-for="item in modelBomScopeGuideItems"
        :key="item.value"
        class="model-bom-scope-guide-item"
        :class="{ active: filters.scopeMode === item.value }"
        type="button"
        @click="applyModelBomScopeFilter(item.value)"
      >
        <strong>{{ item.label }}</strong>
        <span :title="item.description">{{ modelBomScopeGuideDescriptionPreview(item.description) }}</span>
      </button>
      <small>BOM 范围筛选或上方统计可直接区分通用 BOM、指定客户可用 BOM 和客户私有 BOM。</small>
    </div>

    <div class="model-bom-layout">
      <div class="table-card model-bom-list-card">
        <div class="section-heading">
          <div>
            <strong>零件包列表</strong>
            <span>{{ modelBomCommonDragRows.length > 1 ? '常用 BOM 可拖拽排序；点击一行查看和维护包内零件。' : '点击一行查看和维护包内零件。' }}</span>
          </div>
          <div class="section-actions">
            <el-button size="small" :disabled="modelBoms.length === 0" @click="openModelBomListTextDialog">查看列表格式</el-button>
            <el-button size="small" :disabled="modelBoms.length === 0" @click="copyModelBomListText">复制列表</el-button>
            <div class="model-bom-table-height-actions" aria-label="零件包列表表格高度">
              <el-tooltip content="降低表格高度" placement="top">
                <el-button
                  circle
                  size="small"
                  :icon="Minus"
                  :disabled="modelBomWorkTableHeights.list <= modelBomWorkTableHeightLimits.min"
                  aria-label="降低零件包列表表格高度"
                  @click="adjustModelBomWorkTableHeight('list', -modelBomWorkTableHeightLimits.step)"
                />
              </el-tooltip>
              <el-tooltip content="提高表格高度" placement="top">
                <el-button
                  circle
                  size="small"
                  :icon="Plus"
                  :disabled="modelBomWorkTableHeights.list >= modelBomWorkTableHeightLimits.max"
                  aria-label="提高零件包列表表格高度"
                  @click="adjustModelBomWorkTableHeight('list', modelBomWorkTableHeightLimits.step)"
                />
              </el-tooltip>
              <el-tooltip content="恢复默认高度" placement="top">
                <el-button
                  circle
                  size="small"
                  :icon="RefreshLeft"
                  :disabled="modelBomWorkTableHeights.list === modelBomWorkTableDefaultHeights.list"
                  aria-label="恢复零件包列表表格默认高度"
                  @click="resetModelBomWorkTableHeight('list')"
                />
              </el-tooltip>
            </div>
          </div>
        </div>
        <el-table
          class="model-bom-list-table"
          v-loading="loading"
          :data="modelBoms"
          :max-height="modelBomWorkTableHeights.list"
          highlight-current-row
          @row-click="selectBom"
        >
          <el-table-column label="常用排序" width="100">
            <template #default="{ row }">
              <div v-if="row.status === 'ENABLED' && row.isCommon" class="common-bom-sort-cell">
                <button
                  v-if="!isMobileLayout"
                  class="common-bom-drag-handle"
                  :class="{ 'is-drop-target': commonBomDragOverId === row.id, 'is-disabled': modelBomCommonDragRowsForScope(row).length <= 1 || Boolean(modelBomOperationSavingKey) }"
                  type="button"
                  :draggable="!modelBomOperationSavingKey && modelBomCommonDragRowsForScope(row).length > 1"
                  :title="modelBomCommonDragRowsForScope(row).length > 1 ? '拖拽调整同一适用范围内的常用 BOM 显示顺序' : '当前适用范围只有 1 个常用 BOM'"
                  aria-label="拖拽调整常用 BOM 顺序"
                  @click.stop
                  @dragstart.stop="startCommonBomDrag($event, row)"
                  @dragover.prevent.stop="handleCommonBomDragOver($event, row)"
                  @drop.prevent.stop="dropCommonBom(row)"
                  @dragend="endCommonBomDrag"
                >
                  <el-icon><Rank /></el-icon>
                </button>
                <span :title="`常用显示顺序 ${modelBomCommonDisplayOrder(row) || '-'}`">常用 {{ modelBomCommonDisplayOrder(row) }}</span>
              </div>
              <span v-else class="cell-subtext">-</span>
            </template>
          </el-table-column>
          <el-table-column label="零件包" min-width="280">
            <template #default="{ row }">
              <div class="model-bom-name-cell">
                <strong>{{ row.bomName }}</strong>
                <div class="model-bom-name-tags">
                  <el-tag size="small" :type="modelBomScopeTagType(row)" effect="plain">
                    {{ modelBomScopeTypeLabel(row) }}
                  </el-tag>
                  <el-tag size="small" effect="plain">
                    {{ row.projectModel ? `机型 ${row.projectModel}` : '全部机型/项目' }}
                  </el-tag>
                  <el-tag v-if="row.isCommon" size="small" type="success" effect="plain">常用</el-tag>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="适用范围" min-width="260">
            <template #default="{ row }">
              <el-tooltip :content="modelBomScopeTitle(row)" placement="top">
                <span class="model-bom-scope-cell">{{ modelBomScopeText(row) }}</span>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="有效推荐行" width="120">
            <template #default="{ row }">
              <span title="只统计启用且基础零件未停用的 BOM 明细；停用内容不参与后续下单推荐。">
                {{ formatModelBomListLineSummary(row).effectiveCount }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="结构" min-width="360">
            <template #default="{ row }">
              <div class="model-bom-structure-tags">
                <el-tag effect="plain" type="warning">组件 {{ modelBomLineSummary(row).componentCount }}</el-tag>
                <el-tag effect="plain" type="success">子零件 {{ modelBomLineSummary(row).childPartCount }}</el-tag>
                <el-tag effect="plain" type="info">单独零件 {{ modelBomLineSummary(row).standalonePartCount }}</el-tag>
                <el-tag v-if="modelBomLineSummary(row).orphanPartCount > 0" effect="plain" type="danger">未匹配父级 {{ modelBomLineSummary(row).orphanPartCount }}</el-tag>
                <el-tag
                  v-if="modelBomLineSummary(row).missingThicknessCount > 0"
                  class="clickable-review-tag"
                  effect="plain"
                  type="danger"
                  role="button"
                  tabindex="0"
                  :title="modelBomListThicknessReviewTitle(row)"
                  @click.stop="openBomThicknessReview(row)"
                  @keydown.enter.prevent.stop="openBomThicknessReview(row)"
                  @keydown.space.prevent.stop="openBomThicknessReview(row)"
                >
                  厚度核对 {{ modelBomLineSummary(row).missingThicknessCount }}
                </el-tag>
                <el-tag v-if="modelBomLineSummary(row).disabledCount > 0" effect="plain" type="info">停用 {{ modelBomLineSummary(row).disabledCount }}</el-tag>
                <el-tag v-if="modelBomLineSummary(row).materialDisabledCount > 0" effect="plain" type="info">基础零件停用 {{ modelBomLineSummary(row).materialDisabledCount }}</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
                {{ row.status === 'ENABLED' ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="340" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click.stop="selectBom(row)">查看明细</el-button>
              <el-button v-if="!isMobileLayout" link type="primary" :disabled="Boolean(modelBomOperationSavingKey)" @click.stop="openBomEditDialog(row)">编辑表头</el-button>
              <el-button
                v-if="!isMobileLayout && row.status === 'ENABLED' && !row.isCommon"
                link
                type="success"
                :loading="modelBomOperationSavingKey === modelBomOperationKey(row, 'common')"
                :disabled="Boolean(modelBomOperationSavingKey)"
                @click.stop="setBomCommon(row, true)"
              >
                设为常用
              </el-button>
              <el-button
                v-else-if="!isMobileLayout && row.status === 'ENABLED'"
                link
                type="warning"
                :loading="modelBomOperationSavingKey === modelBomOperationKey(row, 'common')"
                :disabled="Boolean(modelBomOperationSavingKey)"
                @click.stop="setBomCommon(row, false)"
              >
                取消常用
              </el-button>
              <el-button
                v-if="!isMobileLayout && isAllCustomerBom(row) && canCopyModelBomToCurrentCustomer(row)"
                link
                type="primary"
                :disabled="Boolean(modelBomOperationSavingKey)"
                @click.stop="openBomCopyDialog(row)"
              >
                复制给客户
              </el-button>
              <el-button v-else-if="isAllCustomerBom(row) && currentCustomerBomForSource(row)" link type="success" :disabled="Boolean(modelBomOperationSavingKey)" @click.stop="openCurrentCustomerBom(row)">
                打开客户 BOM
              </el-button>
              <el-button
                v-if="!isMobileLayout && row.status === 'ENABLED'"
                link
                type="danger"
                :loading="modelBomOperationSavingKey === modelBomOperationKey(row, 'disable')"
                :disabled="Boolean(modelBomOperationSavingKey)"
                @click.stop="disableBom(row)"
              >
                停用
              </el-button>
              <el-button
                v-else-if="!isMobileLayout"
                link
                type="success"
                :loading="modelBomOperationSavingKey === modelBomOperationKey(row, 'enable')"
                :disabled="Boolean(modelBomOperationSavingKey)"
                @click.stop="enableBom(row)"
              >
                恢复启用
              </el-button>
              <el-button
                v-if="!isMobileLayout"
                link
                type="danger"
                :loading="modelBomOperationSavingKey === modelBomOperationKey(row, 'delete')"
                :disabled="Boolean(modelBomOperationSavingKey)"
                @click.stop="deleteBom(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="table-pagination-row">
          <span>
            第 {{ modelBomPagination.page }} 页，已显示 {{ modelBoms.length }} /
            {{ modelBomPagination.total }} 个零件包
          </span>
          <el-pagination
            background
            layout="prev, pager, next"
            :current-page="modelBomPagination.page"
            :page-size="modelBomPagination.limit"
            :total="modelBomPagination.total"
            :disabled="loading"
            @current-change="handleModelBomPageChange"
          />
        </div>
      </div>

      <div class="table-card model-bom-detail-card">
        <div class="section-heading">
          <div>
            <strong>{{ activeBom ? `${activeBom.bomName} 明细` : '零件包明细' }}</strong>
            <span :title="activeBom ? modelBomScopeTitle(activeBom) : '先选择上方零件包'">{{ activeBom ? modelBomScopeText(activeBom) : '先选择上方零件包' }}</span>
          </div>
          <div v-if="!isMobileLayout" class="section-actions">
            <el-button type="primary" plain :disabled="!activeBom || activeBom.status === 'DISABLED'" @click="openLineCreateDialog('COMPONENT')">添加组件</el-button>
            <el-button
              type="success"
              plain
              :disabled="!activeBom || activeBom.status === 'DISABLED' || availableParentComponents.length === 0"
              title="先维护组件行后才能添加子零件"
              @click="openLineCreateDialog('CHILD_PART')"
            >
              添加子零件
            </el-button>
            <el-button type="info" plain :disabled="!activeBom || activeBom.status === 'DISABLED'" @click="openLineCreateDialog('STANDALONE_PART')">添加单独零件</el-button>
          </div>
        </div>
        <el-alert
          v-if="activeBom?.status === 'DISABLED'"
          class="active-bom-disabled-alert"
          type="warning"
          :closable="false"
          show-icon
          title="当前零件包已停用；不会参与下单推荐。恢复启用后才允许新增包内明细，已有明细仍可查看和编辑。"
        />
        <div v-if="activeBom" v-loading="bomRevisionLoading" class="bom-revision-panel">
          <div class="bom-revision-panel__header">
            <div>
              <strong>版本记录</strong>
              <span>已记录 {{ bomRevisionPagination.total }} 次变更</span>
            </div>
            <el-button size="small" :icon="RefreshLeft" @click="loadBomRevisions()">刷新</el-button>
          </div>
          <el-table :data="bomRevisions" size="small" max-height="220" empty-text="暂无版本记录">
            <el-table-column prop="revisionNo" label="版本" width="90">
              <template #default="{ row }">V{{ row.revisionNo }}</template>
            </el-table-column>
            <el-table-column label="动作" min-width="150">
              <template #default="{ row }">{{ formatBomRevisionAction(row.action) }}</template>
            </el-table-column>
            <el-table-column label="操作来源" min-width="130">
              <template #default="{ row }">
                <span :title="modelBomRevisionChangedByTitle(row)">{{ modelBomRevisionChangedByPreview(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="changeRemark" label="备注" min-width="220">
              <template #default="{ row }">
                <span :title="modelBomRevisionChangeRemarkTitle(row)">{{ modelBomRevisionChangeRemarkPreview(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="记录时间" width="180">
              <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openBomRevisionDetail(row)">查看快照</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="bomRevisionHasMore" class="bom-revision-panel__footer">
            <span>已显示 {{ bomRevisions.length }} / {{ bomRevisionPagination.total }} 条</span>
            <el-button size="small" :loading="bomRevisionLoading" @click="loadMoreBomRevisions">加载更多</el-button>
          </div>
        </div>
        <el-alert
          v-if="activeBom"
          class="bom-line-order-alert"
          type="info"
          :closable="false"
          show-icon
          title="顺序列显示连续编号 1、2、3；拖拽保存后仍按连续编号查看。"
        />
        <div v-if="activeBom" v-loading="activeBomDetailLoading" class="bom-structure-panel">
          <div class="bom-structure-panel__header">
            <div>
              <strong>固定格式清单</strong>
              <span>{{ activeBomStructureGroups.length }} 组 / {{ activeBomDisplayLines.length }} 行</span>
            </div>
            <div class="section-actions">
              <el-button size="small" :disabled="!bomStructureText" @click="openBomStructureTextDialog">查看固定格式</el-button>
              <el-button size="small" :disabled="!bomStructureText" @click="copyBomStructureText">复制清单</el-button>
              <div class="model-bom-table-height-actions" aria-label="BOM 明细表格高度">
                <el-tooltip content="降低表格高度" placement="top">
                  <el-button
                    circle
                    size="small"
                    :icon="Minus"
                    :disabled="modelBomWorkTableHeights.lines <= modelBomWorkTableHeightLimits.min"
                    aria-label="降低 BOM 明细表格高度"
                    @click="adjustModelBomWorkTableHeight('lines', -modelBomWorkTableHeightLimits.step)"
                  />
                </el-tooltip>
                <el-tooltip content="提高表格高度" placement="top">
                  <el-button
                    circle
                    size="small"
                    :icon="Plus"
                    :disabled="modelBomWorkTableHeights.lines >= modelBomWorkTableHeightLimits.max"
                    aria-label="提高 BOM 明细表格高度"
                    @click="adjustModelBomWorkTableHeight('lines', modelBomWorkTableHeightLimits.step)"
                  />
                </el-tooltip>
                <el-tooltip content="恢复默认高度" placement="top">
                  <el-button
                    circle
                    size="small"
                    :icon="RefreshLeft"
                    :disabled="modelBomWorkTableHeights.lines === modelBomWorkTableDefaultHeights.lines"
                    aria-label="恢复 BOM 明细表格默认高度"
                    @click="resetModelBomWorkTableHeight('lines')"
                  />
                </el-tooltip>
              </div>
            </div>
          </div>
          <div class="bom-summary-tags">
            <el-tag effect="plain" type="warning">组件 {{ activeBomLineSummary.componentCount }}</el-tag>
            <el-tag effect="plain" type="success">子零件 {{ activeBomLineSummary.childPartCount }}</el-tag>
            <el-tag effect="plain" type="info">单独零件 {{ activeBomLineSummary.standalonePartCount }}</el-tag>
            <el-tag v-if="activeBomLineSummary.orphanPartCount > 0" effect="plain" type="danger">未匹配父级 {{ activeBomLineSummary.orphanPartCount }}</el-tag>
            <el-tag
              v-if="activeBomLineSummary.missingThicknessCount > 0"
              class="clickable-review-tag"
              effect="plain"
              type="danger"
              role="button"
              tabindex="0"
              :title="formatThicknessReviewBreakdown(activeBomDisplayLines)"
              @click.stop="openBomThicknessReview(activeBom)"
              @keydown.enter.prevent.stop="openBomThicknessReview(activeBom)"
              @keydown.space.prevent.stop="openBomThicknessReview(activeBom)"
            >
              厚度核对 {{ activeBomLineSummary.missingThicknessCount }}
            </el-tag>
            <el-tag v-if="activeBomLineSummary.disabledCount > 0" effect="plain" type="info">停用 {{ activeBomLineSummary.disabledCount }}</el-tag>
            <el-tag v-if="activeBomLineSummary.materialDisabledCount > 0" effect="plain" type="danger">基础零件停用 {{ activeBomLineSummary.materialDisabledCount }}</el-tag>
          </div>
          <div v-if="activeBomStructureGroups.length > 0" class="bom-structure-list">
            <div v-for="(group, groupIndex) in activeBomStructureGroups" :key="group.id" class="bom-structure-group">
              <div class="bom-structure-main">
                <span class="bom-structure-index">{{ groupIndex + 1 }}</span>
                <el-tag :type="group.type === 'component' ? 'warning' : group.type === 'orphan' ? 'danger' : 'info'" effect="plain">
                  {{ group.type === 'component' ? `组件 ${group.line.componentNo || '-'}` : group.type === 'orphan' ? `未匹配父级 ${group.line.parentComponentNo || '-'}` : '单独零件' }}
                </el-tag>
                <strong>{{ formatFixedLineCore(group.line) }}</strong>
                <span class="bom-structure-meta">{{ formatFixedLineMeta(group.line) }}</span>
                <div class="bom-structure-actions">
                  <el-button
                    v-if="!isMobileLayout && group.type === 'component'"
                    size="small"
                    type="success"
                    plain
                    :disabled="activeBom.status === 'DISABLED'"
                    @click="openLineCreateDialog('CHILD_PART', normalizeComponentNo(group.line.componentNo))"
                  >
                    添加子零件
                  </el-button>
                </div>
              </div>
              <div
                v-for="(child, childIndex) in group.children"
                :key="child.id"
                class="bom-structure-child"
              >
                <span>{{ `${groupIndex + 1}.${childIndex + 1}` }}</span>
                <el-tag type="success" effect="plain">子零件</el-tag>
                <strong>{{ formatFixedLineCore(child) }}</strong>
                <span class="bom-structure-meta">{{ formatFixedLineMeta(child) }}</span>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无明细，仍可查看零件包固定格式头部信息" />
        </div>
        <div v-if="activeBom?.sourceBomId" v-loading="sourceBomDiffLoading" class="bom-source-diff-panel">
          <div class="bom-source-diff-header">
            <div>
              <strong>来源 BOM 差异</strong>
              <span>来源：{{ activeSourceBomName }}</span>
            </div>
            <div class="bom-source-diff-actions">
              <el-tag :type="sourceBomDiffIssues.length === 0 ? 'success' : 'warning'" effect="plain">
                {{ sourceBomDiffIssues.length === 0 ? '无差异' : `${sourceBomDiffIssues.length} 项差异 / ${sourceBomDiffReviewedCount} 项已核对` }}
              </el-tag>
              <el-button
                v-if="!isMobileLayout"
                size="small"
                :icon="Download"
                :loading="sourceBomDiffReviewExporting"
                :disabled="!activeBom?.sourceBomId"
                @click="exportSourceBomDiffReviewsExcel"
              >
                导出核对
              </el-button>
              <el-button
                size="small"
                :loading="sourceBomDiffReviewLoading"
                :disabled="sourceBomDiffReviewLoading || sourceBomDiffReviews.length === 0"
                @click="sourceBomReviewListDialogVisible = true"
              >
                查看核对记录 {{ sourceBomDiffReviews.length }} 条
              </el-button>
              <el-button size="small" :disabled="sourceBomDiffIssues.length === 0" @click="copySourceBomDiffText">复制差异</el-button>
            </div>
          </div>
          <el-alert
            v-if="sourceBomDiffIssues.length > 0"
            type="warning"
            :closable="false"
            show-icon
            title="需核对表示来源 BOM 与客户 BOM 不一致；客户差异表示客户 BOM 独立新增。点击核对会在当前页面弹出对比窗口，不自动覆盖客户 BOM。"
          />
          <el-alert
            v-if="!sourceBomForDiff && !sourceBomDiffLoading"
            title="未能读取来源 BOM，当前客户 BOM 仍可独立维护，但无法提示与百胜通用 BOM 的差异。"
            type="warning"
            :closable="false"
          />
          <div v-else-if="sourceBomDiffIssues.length > 0" class="bom-source-diff-list">
            <article v-for="issue in sourceBomDiffIssues" :key="issue.id" class="bom-source-diff-item">
              <el-tag :type="sourceBomDiffStatusTagType(issue)" effect="plain" size="small">
                {{ sourceBomDiffStatusLabel(issue) }}
              </el-tag>
              <div>
                <strong>{{ issue.title }}</strong>
                <span :title="sourceBomDiffIssueDetailTitle(issue)">{{ sourceBomDiffIssueDetailPreview(issue) }}</span>
                <small class="bom-source-diff-action-hint">{{ issue.suggestedAction }}</small>
                <small v-if="isSourceBomDiffReviewed(issue)">{{ sourceBomDiffReviewRecordText(issue) }}</small>
              </div>
              <div class="bom-source-diff-item__actions">
                <el-button v-if="!isMobileLayout || isSourceBomDiffReviewed(issue)" size="small" plain @click="openSourceBomDiffReviewDialog(issue)">
                  {{ isSourceBomDiffReviewed(issue) ? '查看核对' : '核对' }}
                </el-button>
                <el-button
                  v-if="!isMobileLayout && isSourceBomDiffReviewed(issue)"
                  size="small"
                  type="danger"
                  plain
                  @click="revokeSourceBomDiffReviewed(issue)"
                >
                  撤销核对
                </el-button>
              </div>
            </article>
          </div>
          <div v-else class="bom-source-diff-empty">
            客户 BOM 与来源百胜通用 BOM 当前一致；后续来源更新只提示差异，不自动覆盖客户 BOM。
          </div>
        </div>
        <div
          class="bom-line-table"
          :style="{ maxHeight: `${modelBomWorkTableHeights.lines}px` }"
          @dragover.self.prevent="handleLineListDragOverEnd"
          @drop.self.prevent="dropLineDragAtEnd"
        >
          <div class="bom-line-row bom-line-row--head">
            <div>顺序</div>
            <div>结构</div>
            <div>零件编码</div>
            <div>零件名称</div>
            <div>默认数量</div>
            <div>默认图纸</div>
            <div>默认工艺</div>
            <div>厚度</div>
            <div>规格</div>
            <div>状态</div>
            <div>操作</div>
          </div>
          <el-empty v-if="activeBomDisplayLines.length === 0" description="暂无包内明细，请添加组件或单独零件">
            <div v-if="!isMobileLayout" class="empty-line-actions">
              <el-button type="primary" plain :disabled="!activeBom || activeBom.status === 'DISABLED'" @click="openLineCreateDialog('COMPONENT')">添加第一个组件</el-button>
              <el-button type="info" plain :disabled="!activeBom || activeBom.status === 'DISABLED'" @click="openLineCreateDialog('STANDALONE_PART')">添加单独零件</el-button>
            </div>
          </el-empty>
          <div v-else class="bom-line-body">
            <div
              v-for="(row, index) in activeBomDisplayLines"
              :key="row.id"
              :class="[
                'bom-line-row',
                {
                  'is-dragging': draggedLineIndex === index,
                  'is-drop-before': dragOverLineIndex === index && !dragOverLineInsertAfter,
                  'is-drop-after': dragOverLineIndex === index && dragOverLineInsertAfter,
                  'is-route-highlighted': row.id === highlightedBomLineId
                }
              ]"
              :data-bom-line-id="row.id"
              @dragenter.prevent="handleLineDragOver($event, index)"
              @dragover.prevent="handleLineDragOver($event, index)"
              @drop.prevent="dropLineDrag"
            >
              <div class="bom-line-sort-cell">
                <el-button
                  class="bom-line-drag-handle"
                  text
                  :draggable="!saving && !modelBomLineOperationSavingKey && !isMobileLayout"
                  :disabled="saving || Boolean(modelBomLineOperationSavingKey) || isMobileLayout"
                  :title="isMobileLayout ? '手机端仅查看顺序' : '拖动调整顺序'"
                  @dragstart.stop="startLineDrag($event, index)"
                  @dragend="endLineDrag"
                >
                  <el-icon><Rank /></el-icon>
                </el-button>
                <span :title="formatLineOrderTitle(row)">{{ displayBomLineOrder(row) }}</span>
              </div>
              <div :class="['bom-line-structure', lineStructureClass(row)]">
                <el-tag :type="lineStructureTagType(row)" effect="plain">
                  {{ formatLineStructure(row) }}
                </el-tag>
                <span>{{ lineStructureHint(row) }}</span>
                <span v-if="row.partCategory">{{ row.partCategory }}</span>
              </div>
              <div class="bom-line-text">{{ row.partCode }}</div>
              <div class="bom-line-text">{{ row.partName }}</div>
              <div>{{ formatQuantity(row.defaultQuantity, row.unit) }}</div>
              <div class="bom-line-text">{{ formatLineDrawing(row) }}</div>
              <div class="bom-line-text" :title="formatLineDefaultProcessRouteFull(row)">{{ formatLineDefaultProcessRoute(row) }}</div>
              <div class="bom-line-text">
                <el-tag
                  :class="{ 'clickable-review-tag': lineNeedsThicknessReview(row) && !isMobileLayout }"
                  :type="lineNeedsThicknessReview(row) ? 'danger' : 'info'"
                  :role="lineNeedsThicknessReview(row) && !isMobileLayout ? 'button' : undefined"
                  :tabindex="lineNeedsThicknessReview(row) && !isMobileLayout ? 0 : undefined"
                  :title="lineNeedsThicknessReview(row) ? lineThicknessReviewActionTitle(row) : row.lineType === 'COMPONENT' ? '父级组件不维护自身厚度' : '当前 BOM 明细厚度'"
                  effect="plain"
                  @click.stop="handleThicknessReviewLineAction(row)"
                  @keydown.enter.prevent.stop="handleThicknessReviewLineAction(row)"
                  @keydown.space.prevent.stop="handleThicknessReviewLineAction(row)"
                >
                  {{ formatLineThickness(row) }}
                </el-tag>
              </div>
              <div class="bom-line-text">{{ row.partSpecification || '-' }}</div>
              <div>
                <div class="bom-line-status-tags">
                  <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" effect="plain">
                    {{ row.status === 'ENABLED' ? '启用' : '停用' }}
                  </el-tag>
                  <el-tag v-if="row.materialStatus === 'DISABLED'" type="danger" effect="plain">基础零件停用</el-tag>
                </div>
              </div>
              <div class="bom-line-actions">
                <template v-if="!isMobileLayout">
                  <el-button
                    v-if="row.lineType === 'COMPONENT' && row.status === 'ENABLED'"
                    link
                    type="success"
                    :disabled="activeBom?.status === 'DISABLED' || saving || Boolean(modelBomLineOperationSavingKey)"
                    @click="openLineCreateDialog('CHILD_PART', normalizeComponentNo(row.componentNo))"
                  >
                    加子件
                  </el-button>
                  <el-button link type="primary" :disabled="saving || Boolean(modelBomLineOperationSavingKey)" @click="openLineEditDialog(row)">编辑</el-button>
                  <el-button
                    v-if="row.status === 'ENABLED'"
                    link
                    type="danger"
                    :loading="modelBomLineOperationSavingKey === modelBomLineOperationKey(row, 'disable')"
                    :disabled="saving || Boolean(modelBomLineOperationSavingKey)"
                    @click="disableLine(row)"
                  >
                    停用
                  </el-button>
                  <el-button
                    v-else
                    link
                    :type="row.materialStatus === 'DISABLED' ? 'info' : 'success'"
                    :title="row.materialStatus === 'DISABLED' ? '请先启用零件基础资料' : '启用包内明细'"
                    :loading="modelBomLineOperationSavingKey === modelBomLineOperationKey(row, 'enable')"
                    :disabled="saving || Boolean(modelBomLineOperationSavingKey)"
                    @click="enableLine(row)"
                  >
                    启用
                  </el-button>
                </template>
                <span v-else class="mobile-readonly-note">手机端只读</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="bomDialogVisible"
      class="responsive-dialog"
      :title="bomForm.id ? '编辑机型零件包' : '新增机型零件包'"
      width="620px"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleSavingDialogClose"
    >
      <el-form label-width="120px">
        <el-form-item label="零件包名称" required>
          <el-input v-model="bomForm.bomName" placeholder="例如 B3 标准零件包" />
        </el-form-item>
        <el-form-item label="客户范围">
          <el-select v-model="bomForm.customerScope" style="width: 220px" @change="handleBomCustomerScopeChange">
            <el-option label="全部客户通用" value="ALL" />
            <el-option label="客户私有" value="PRIVATE" />
            <el-option label="指定客户可用" value="SELECTED" />
          </el-select>
          <div class="bom-scope-help">{{ bomScopeCustomerSelectionText }}</div>
          <div v-if="bomScopeNarrowingText" class="bom-scope-help bom-scope-help--warning">{{ bomScopeNarrowingText }}</div>
        </el-form-item>
        <el-form-item v-if="bomForm.customerScope === 'PRIVATE'" label="所属客户" required>
          <CustomerSelect v-model="bomForm.customerId" width="280px" placeholder="选择客户" status="ENABLED" />
        </el-form-item>
        <el-form-item v-if="bomForm.customerScope === 'SELECTED'" label="可用客户" required>
          <div class="bom-scope-customer-picker">
            <el-input
              v-model="bomScopeCustomerKeyword"
              clearable
              placeholder="搜索客户名称 / ID / 联系人 / 地区 / 拼音"
              style="width: 360px"
            />
            <el-select
              v-model="bomForm.customerIds"
              multiple
              filterable
              :filter-method="handleBomScopeCustomerSelectFilter"
              collapse-tags
              collapse-tags-tooltip
              placeholder="勾选可使用该 BOM 的客户"
              style="width: 360px"
            >
              <el-option v-for="customer in bomScopeCustomerDisplayOptions" :key="customer.id" :label="customer.customerName" :value="customer.id" />
            </el-select>
            <el-button
              size="small"
              plain
              :loading="customerOptionsLoading"
              :disabled="customerOptionsLoading || customerOptions.length === 0"
              @click="selectAllBomScopeCustomers"
            >
              全部勾选
            </el-button>
            <el-button
              size="small"
              plain
              :disabled="customerOptionsLoading || bomScopeFilteredCustomerOptions.length === 0"
              @click="selectFilteredBomScopeCustomers"
            >
              勾选搜索结果
            </el-button>
            <el-button
              size="small"
              plain
              :disabled="customerOptionsLoading || bomScopeFilteredCustomerOptions.length === 0"
              @click="removeFilteredBomScopeCustomers"
            >
              移除搜索结果
            </el-button>
            <el-button size="small" plain @click="clearBomScopeCustomers">清空</el-button>
            <span class="bom-scope-help">{{ bomScopeSelectedCustomerCountText }}</span>
            <span class="bom-scope-help">{{ bomScopeCustomerOptionLoadText }}</span>
          </div>
        </el-form-item>
        <el-form-item label="机型/项目范围">
          <el-input v-model="bomForm.projectModel" placeholder="例如 B3 / B5 / C型15P；留空表示全部机型/项目" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="bomForm.status" style="width: 160px">
            <el-option label="启用" value="ENABLED" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="常用 BOM">
          <el-switch v-model="bomForm.isCommon" :disabled="bomForm.status === 'DISABLED'" active-text="设为常用" inactive-text="非常用" />
          <div class="bom-scope-help">
            常用只影响当前范围内的显示顺序和下单推荐优先级，不修改 BOM 明细、适用客户、订单、生产任务或库存。停用 BOM 会自动取消常用排序；恢复启用时可重新勾选常用。
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="bomForm.remark" type="textarea" :rows="3" placeholder="例如 B3 常规配置，客户A专用版本" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="closeBomDialog">取消</el-button>
        <el-button v-if="!bomForm.id" type="primary" plain :loading="saving" @click="saveBom(true)">保存并添加明细</el-button>
        <el-button type="primary" :loading="saving" @click="saveBom(false)">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="bomScopeReviewDialogVisible"
      class="responsive-dialog"
      title="BOM 适用范围核对"
      width="820px"
      @closed="resolveBomScopeReview(false)"
    >
      <div class="bom-scope-review">
        <el-alert
          :type="bomScopeChangeBroadens() ? 'warning' : 'info'"
          :closable="false"
          show-icon
          :title="bomScopeReviewAlertText"
        />
        <div class="model-bom-dialog-table-toolbar">
          <strong>BOM 适用范围核对表</strong>
          <div class="model-bom-table-height-actions" aria-label="BOM 适用范围核对表格高度">
            <el-button-group>
              <el-button
                :icon="Minus"
                :disabled="modelBomWorkTableHeights.scopeReview <= modelBomWorkTableHeightLimits.min"
                aria-label="降低 BOM 适用范围核对表格高度"
                @click="adjustModelBomWorkTableHeight('scopeReview', -modelBomWorkTableHeightLimits.step)"
              />
              <el-button
                :icon="Plus"
                :disabled="modelBomWorkTableHeights.scopeReview >= modelBomWorkTableHeightLimits.max"
                aria-label="提高 BOM 适用范围核对表格高度"
                @click="adjustModelBomWorkTableHeight('scopeReview', modelBomWorkTableHeightLimits.step)"
              />
              <el-button
                :icon="RefreshLeft"
                :disabled="modelBomWorkTableHeights.scopeReview === modelBomWorkTableDefaultHeights.scopeReview"
                aria-label="恢复 BOM 适用范围核对表格默认高度"
                @click="resetModelBomWorkTableHeight('scopeReview')"
              />
            </el-button-group>
          </div>
        </div>
        <el-table :data="bomScopeReviewRows" border class="bom-scope-review-table" :max-height="modelBomWorkTableHeights.scopeReview">
          <el-table-column prop="field" label="核对项" width="150" />
          <el-table-column label="修改前" min-width="220">
            <template #default="{ row }">
              <span :title="formatBomScopeReviewCellTitle(row.before)">{{ formatBomScopeReviewCellPreview(row.before) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="修改后" min-width="220">
            <template #default="{ row }">
              <span :title="formatBomScopeReviewCellTitle(row.after)">{{ formatBomScopeReviewCellPreview(row.after) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="影响" min-width="170">
            <template #default="{ row }">
              <span :title="formatBomScopeReviewCellTitle(row.impact)">{{ formatBomScopeReviewCellPreview(row.impact, 24) }}</span>
            </template>
          </el-table-column>
        </el-table>
        <div class="bom-scope-review-notes">
          <strong>保存影响</strong>
          <span>只修改 BOM 后续可见范围和推荐范围，不会删除 BOM 明细、历史订单、生产任务或库存流水。</span>
          <span v-if="bomScopeChangeBroadens()">范围扩大后，新增可见客户可能在下单推荐中看到该 BOM；该动作必须先提交管理员审批申请，批准后才能保存。</span>
          <span v-else>范围缩小后，被移除的客户后续不再看到该 BOM；历史订单和已经复制出的客户 BOM 不受影响。</span>
        </div>
        <div v-if="bomScopeChangeBroadens()" class="bom-scope-approval-apply">
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            title="扩大到更多客户或全部机型属于特殊动作。请先提交审批申请，管理员批准后再点击保存。"
          />
          <el-form label-width="90px">
            <el-form-item label="申请人" required>
              <el-input v-model="bomScopeApprovalForm.requestedBy" placeholder="填写操作员姓名" />
            </el-form-item>
            <el-form-item label="申请原因" required>
              <el-input v-model="bomScopeApprovalForm.requestReason" type="textarea" :rows="3" placeholder="说明为什么需要扩大 BOM 可见范围" />
            </el-form-item>
          </el-form>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="saving" @click="resolveBomScopeReview(false)">取消</el-button>
        <el-button v-if="bomScopeChangeBroadens()" type="warning" :loading="bomScopeApprovalSubmitting" @click="submitBomScopeApprovalRequest">
          提交管理员申请
        </el-button>
        <el-button v-else type="primary" :loading="saving" @click="resolveBomScopeReview(true)">确认并保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="copyDialogVisible"
      class="responsive-dialog"
      title="复制百胜通用零件包"
      width="620px"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleSavingDialogClose"
    >
      <el-form label-width="120px">
        <el-form-item label="来源零件包">
          <el-input v-model="copyForm.sourceBomName" disabled />
        </el-form-item>
        <el-form-item label="目标客户" required>
          <CustomerSelect v-model="copyForm.customerId" width="300px" placeholder="选择客户" status="ENABLED" />
        </el-form-item>
        <el-form-item label="客户零件包名" required>
          <el-input v-model="copyForm.bomName" placeholder="例如 B3 标准零件包-客户A" />
        </el-form-item>
        <el-form-item label="机型/项目范围">
          <el-input v-model="copyForm.projectModel" placeholder="例如 B3 / B5 / C型15P；留空表示全部机型/项目" />
        </el-form-item>
        <el-form-item label="常用 BOM">
          <el-switch v-model="copyForm.isCommon" active-text="复制后设为常用" inactive-text="复制后非常用" />
          <div class="bom-scope-help">复制时设为常用只影响目标客户/机型范围内的显示顺序和下单推荐优先级，不修改来源 BOM、订单、生产任务或库存。</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="copyForm.remark" type="textarea" :rows="3" placeholder="复制后客户 BOM 独立维护，不影响百胜通用 BOM" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="closeCopyDialog">取消</el-button>
        <el-button type="primary" :loading="saving" @click="copyBom">确认复制</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="lineDialogVisible"
      class="responsive-dialog"
      :title="lineDialogTitle"
      width="640px"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleSavingDialogClose"
    >
      <el-form label-width="120px">
        <el-alert
          v-if="routeTargetLineNotice"
          class="route-target-line-alert"
          type="info"
          :closable="false"
          show-icon
          :title="routeTargetLineNotice"
        />
        <el-alert
          v-if="routeTargetLineEditNotice"
          class="route-target-line-alert"
          type="warning"
          :closable="false"
          show-icon
          :title="routeTargetLineEditNotice"
        />
        <el-alert
          v-if="thicknessReviewLineNotice"
          class="route-target-line-alert"
          type="warning"
          :closable="false"
          show-icon
          :title="thicknessReviewLineNotice"
        />
        <el-form-item label="结构类型" required>
          <el-radio-group v-model="lineForm.structureType" @change="handleLineStructureChange">
            <el-radio-button label="STANDALONE_PART">单独零件</el-radio-button>
            <el-radio-button label="COMPONENT">组件</el-radio-button>
            <el-radio-button label="CHILD_PART">组件子零件</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="lineForm.structureType === 'COMPONENT'" label="组件编号" required>
          <el-input v-model="lineForm.componentNo" placeholder="例如 C001" style="width: 180px" />
        </el-form-item>
        <el-alert
          v-if="lineFormComponentNoRisk"
          type="warning"
          :closable="false"
          show-icon
          :title="lineFormComponentNoRisk"
        />
        <el-alert
          v-if="lineFormComponentMutationNotice"
          type="warning"
          :closable="false"
          show-icon
          :title="lineFormComponentMutationNotice"
        />
        <el-form-item v-if="lineForm.structureType === 'CHILD_PART'" label="所属组件" required>
          <el-select v-model="lineForm.parentComponentNo" placeholder="选择父级组件" style="width: 260px">
            <el-option
              v-for="item in availableParentComponents"
              :key="item.id"
              :label="`${normalizeComponentNo(item.componentNo)} / ${item.partCode} ${item.partName}`"
              :value="normalizeComponentNo(item.componentNo)"
            />
          </el-select>
        </el-form-item>
        <el-alert
          v-if="lineFormParentComponentNotice"
          type="warning"
          :closable="false"
          show-icon
          :title="lineFormParentComponentNotice"
        />
        <el-form-item label="零件" required>
          <el-autocomplete
            v-model="lineForm.materialKeyword"
            :fetch-suggestions="queryMaterials"
            value-key="partCode"
            placeholder="编码 / 名称 / 拼音 / 图号 / 厚度 / 客户 / 订单"
            style="width: 360px"
            clearable
            :trigger-on-focus="true"
            :debounce="250"
            @clear="handleLineMaterialClear"
            @input="handleLineMaterialKeywordInput"
            @select="selectMaterial"
          >
            <template #default="{ item }">
              <MaterialSuggestionOption :item="item" />
            </template>
          </el-autocomplete>
        </el-form-item>
        <el-alert
          v-if="lineFormMaterialSelectionRisk"
          type="warning"
          :closable="false"
          show-icon
          :title="lineFormMaterialSelectionRisk"
        />
        <el-alert
          v-if="lineFormDuplicateLineRisk"
          type="warning"
          :closable="false"
          show-icon
          :title="lineFormDuplicateLineRisk"
        />
        <el-alert
          v-if="lineForm.materialStatus === 'DISABLED'"
          type="warning"
          :closable="false"
          show-icon
          title="当前基础零件已停用，只能保存为停用 BOM 明细；如需启用推荐，请先在零件管理中启用基础资料。"
        />
        <el-form-item label="零件类型">
          <el-select v-model="lineForm.partCategory" clearable placeholder="通用件 / 定制件" style="width: 200px">
            <el-option label="百胜通用件" value="百胜通用件" />
            <el-option label="客户通用件" value="客户通用件" />
            <el-option label="客户定制件" value="客户定制件" />
            <el-option label="半成品" value="半成品" />
          </el-select>
        </el-form-item>
        <el-form-item label="默认数量" required>
          <el-input-number v-model="lineForm.defaultQuantity" :min="0.001" :precision="3" :step="1" />
        </el-form-item>
        <el-form-item v-if="lineForm.structureType !== 'COMPONENT'" label="默认厚度">
          <el-input-number v-model="lineForm.partThickness" :min="0" :precision="3" :step="0.1" />
          <small class="default-process-help">{{ lineFormThicknessHelpText }}</small>
        </el-form-item>
        <el-alert
          v-else
          type="info"
          :closable="false"
          show-icon
          title="父级组件由多个子零件拼接，不维护自身厚度，也不会计入厚度核对数量。"
        />
        <el-form-item label="默认图纸">
          <el-select
            v-model="lineForm.defaultDrawingRevisionId"
            clearable
            filterable
            placeholder="不指定则使用零件默认或最新图纸"
            style="width: 360px"
            :disabled="!lineForm.materialId"
          >
            <el-option
              v-for="item in lineDrawingRevisions"
              :key="item.id"
              :label="formatDrawingRevisionOption(item)"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="默认工艺">
          <el-select
            v-model="lineForm.defaultProcessRouteSteps"
            multiple
            filterable
            clearable
            collapse-tags
            collapse-tags-tooltip
            placeholder="选择标准工序，按选择顺序保存"
            style="width: 420px"
            :filter-method="handleLineDefaultProcessFilter"
            @change="handleLineDefaultProcessChange"
            @visible-change="handleLineDefaultProcessVisibleChange"
          >
            <el-option v-for="item in filteredLineDefaultProcessDefinitions" :key="item.id" :label="item.processName" :value="item.processName" />
          </el-select>
          <small class="default-process-help">默认工艺只作为下单初始建议；拖动手柄调整顺序。</small>
          <div
            v-if="lineForm.defaultProcessRouteSteps.length > 0"
            class="default-process-step-list"
            @dragover.self.prevent="handleDefaultProcessListDragOverEnd"
            @dragleave="handleDefaultProcessListDragLeave"
            @drop.self.prevent="dropDefaultProcessAtEnd"
          >
            <div
              v-for="(step, index) in lineForm.defaultProcessRouteSteps"
              :key="`${step}-${index}`"
              class="default-process-step-row"
              :class="{
                'is-dragging': draggedDefaultProcessIndex === index,
                'is-drop-before': defaultProcessDragOverIndex === index && !defaultProcessDragInsertAfter,
                'is-drop-after': defaultProcessDragOverIndex === index && defaultProcessDragInsertAfter
              }"
              @dragenter.prevent="handleDefaultProcessDragOver($event, index)"
              @dragover.prevent="handleDefaultProcessDragOver($event, index)"
              @drop.prevent="dropDefaultProcess($event, index)"
            >
              <button
                type="button"
                class="default-process-drag-handle"
                :draggable="!saving"
                title="拖拽调整默认工艺顺序"
                aria-label="拖拽调整默认工艺顺序"
                @dragstart.stop="startDefaultProcessDrag($event, index)"
                @dragend="endDefaultProcessDrag"
              >
                <el-icon><Rank /></el-icon>
              </button>
              <span class="default-process-index">{{ index + 1 }}</span>
              <strong>{{ step }}</strong>
              <el-button link type="danger" @click="removeDefaultProcessStep(index)">删除</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="显示顺序">
          <div class="line-order-readonly">
            <span>{{ lineFormDisplayOrderText }}</span>
            <small>顺序通过明细表拖拽手柄调整；保存时系统自动维护拖拽顺序。</small>
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="lineForm.status" style="width: 160px" :title="lineFormEnableStatusDisabledReason">
            <el-option label="启用" value="ENABLED" :disabled="lineFormEnableStatusDisabled" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="lineForm.remark" type="textarea" :rows="3" placeholder="例如 B3 每台 2 件" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="closeLineDialog">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveLine">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="bomStructureTextDialogVisible" class="responsive-dialog" title="BOM 固定格式清单" width="900px">
      <el-input
        class="fixed-format-textarea"
        :model-value="bomStructureText"
        type="textarea"
        :rows="22"
        readonly
      />
      <template #footer>
        <el-button @click="bomStructureTextDialogVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!bomStructureText" @click="copyBomStructureText">复制清单</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="bomListTextDialogVisible" class="responsive-dialog" title="BOM 范围固定格式清单" width="980px">
      <el-input
        class="fixed-format-textarea"
        :model-value="modelBomListText"
        type="textarea"
        :rows="22"
        readonly
      />
      <template #footer>
        <el-button @click="bomListTextDialogVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!modelBomListText" @click="copyModelBomListText">复制列表</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="thicknessReviewDialogVisible" class="responsive-dialog" title="BOM 厚度核对" width="980px">
      <div class="bom-thickness-review">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="这里只核对子零件和单独零件；父级组件由多个子零件拼接，不参与厚度核对。确认厚度只写入当前 BOM 明细，不改历史订单、库存或生产记录。"
        />
        <div v-if="thicknessReviewLines.length > 0" class="thickness-review-summary">
          <el-tag type="danger" effect="plain">需核对 {{ thicknessReviewSummary.totalCount }}</el-tag>
          <el-tag v-if="thicknessReviewSummary.noThicknessCount > 0" type="danger" effect="plain">未填写 {{ thicknessReviewSummary.noThicknessCount }}</el-tag>
          <el-tag v-if="thicknessReviewSummary.historyReferenceCount > 0" type="warning" effect="plain">历史参考 {{ thicknessReviewSummary.historyReferenceCount }}</el-tag>
          <el-tag v-if="thicknessReviewSummary.unconfirmedSourceCount > 0" type="danger" effect="plain">来源未确认 {{ thicknessReviewSummary.unconfirmedSourceCount }}</el-tag>
          <span v-if="isMobileLayout">手机端仅查看厚度核对清单，核对并保存厚度请在电脑端操作。</span>
          <span v-else>点击任意行可逐条核对；BOM 顺序与下方明细表连续编号一致，保存后会继续提示剩余厚度核对项。</span>
        </div>
        <div v-if="thicknessReviewLines.length > 0" class="table-card bom-thickness-review-table-card">
          <div class="model-bom-dialog-table-toolbar">
            <strong>BOM 厚度核对明细</strong>
            <div class="model-bom-table-height-actions" aria-label="BOM 厚度核对表格高度">
              <el-button-group>
                <el-button
                  :icon="Minus"
                  :disabled="modelBomWorkTableHeights.thicknessReview <= modelBomWorkTableHeightLimits.min"
                  aria-label="降低 BOM 厚度核对表格高度"
                  @click="adjustModelBomWorkTableHeight('thicknessReview', -modelBomWorkTableHeightLimits.step)"
                />
                <el-button
                  :icon="Plus"
                  :disabled="modelBomWorkTableHeights.thicknessReview >= modelBomWorkTableHeightLimits.max"
                  aria-label="提高 BOM 厚度核对表格高度"
                  @click="adjustModelBomWorkTableHeight('thicknessReview', modelBomWorkTableHeightLimits.step)"
                />
                <el-button
                  :icon="RefreshLeft"
                  :disabled="modelBomWorkTableHeights.thicknessReview === modelBomWorkTableDefaultHeights.thicknessReview"
                  aria-label="恢复 BOM 厚度核对表格默认高度"
                  @click="resetModelBomWorkTableHeight('thicknessReview')"
                />
              </el-button-group>
            </div>
          </div>
          <el-table
            :data="thicknessReviewLines"
            border
            highlight-current-row
            class="bom-thickness-review-table"
            :max-height="modelBomWorkTableHeights.thicknessReview"
            :row-class-name="thicknessReviewRowClassName"
            @row-click="handleThicknessReviewLineAction"
          >
            <el-table-column label="BOM 顺序" width="90">
              <template #default="{ row }">{{ displayBomLineOrder(row) || '-' }}</template>
            </el-table-column>
            <el-table-column label="结构" min-width="180">
              <template #default="{ row }">
                <el-tag :type="lineStructureTagType(row)" effect="plain">{{ formatLineStructure(row) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="partCode" label="零件编码" min-width="150" />
            <el-table-column prop="partName" label="零件名称" min-width="180" />
            <el-table-column label="默认图纸" min-width="220">
              <template #default="{ row }">{{ formatLineDrawing(row) }}</template>
            </el-table-column>
            <el-table-column prop="partSpecification" label="规格" min-width="180" />
            <el-table-column label="当前厚度" width="140">
              <template #default="{ row }">
                <el-tag
                  :class="{ 'clickable-review-tag': !isMobileLayout }"
                  type="danger"
                  effect="plain"
                  :role="!isMobileLayout ? 'button' : undefined"
                  :tabindex="!isMobileLayout ? 0 : undefined"
                  :title="lineThicknessReviewActionTitle(row)"
                  @click.stop="handleThicknessReviewLineAction(row)"
                  @keydown.enter.prevent.stop="handleThicknessReviewLineAction(row)"
                  @keydown.space.prevent.stop="handleThicknessReviewLineAction(row)"
                >
                  {{ formatLineThickness(row) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="厚度来源" width="150">
              <template #default="{ row }">
                <el-tag :type="lineThicknessSourceTagType(row)" effect="plain">
                  {{ formatLineThicknessSourceLabel(row) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="核对原因" min-width="260">
              <template #default="{ row }">
                <span class="thickness-review-reason" :title="lineThicknessReviewTitle(row)">
                  {{ formatLineThicknessReviewReasonPreview(row) }}
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <el-empty v-else description="当前 BOM 没有需要核对厚度的子零件或单独零件" />
      </div>
      <template #footer>
        <el-button @click="thicknessReviewDialogVisible = false">关闭</el-button>
        <el-button :disabled="!thicknessReviewText" @click="copyThicknessReviewText">复制核对清单</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="sourceBomReviewDialogVisible" class="responsive-dialog" title="BOM 差异核对" width="980px">
      <div v-if="selectedSourceBomDiffIssue" class="source-bom-review">
        <el-alert
          :type="selectedSourceBomDiffIssue.severity === 'warning' ? 'warning' : 'info'"
          :closable="false"
          show-icon
          :title="selectedSourceBomDiffIssue.suggestedAction"
        />
        <div class="source-bom-review-summary">
          <el-tag :type="sourceBomDiffStatusTagType(selectedSourceBomDiffIssue)" effect="plain">
            {{ sourceBomDiffStatusLabel(selectedSourceBomDiffIssue) }}
          </el-tag>
          <div>
            <strong>{{ selectedSourceBomDiffIssue.title }}</strong>
            <span :title="sourceBomDiffIssueDetailTitle(selectedSourceBomDiffIssue)">
              {{ sourceBomDiffIssueDetailPreview(selectedSourceBomDiffIssue, 72) }}
            </span>
          </div>
        </div>
        <el-alert
          v-if="isSourceBomDiffReviewed(selectedSourceBomDiffIssue)"
          type="success"
          :closable="false"
          show-icon
          :title="sourceBomDiffReviewRecordText(selectedSourceBomDiffIssue) || '本项已核对，系统不会把来源 BOM 覆盖到客户 BOM。'"
        />
        <el-form v-else-if="!isMobileLayout" class="source-bom-review-confirm-form" label-width="76px">
          <el-form-item label="核对人" required>
            <el-input v-model="sourceBomReviewForm.reviewedBy" placeholder="填写核对人员" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="sourceBomReviewForm.reviewRemark" type="textarea" :rows="2" placeholder="例如：客户定制要求，保留客户 BOM 差异" />
          </el-form-item>
        </el-form>
        <div class="source-bom-review-lines">
          <section>
            <strong>来源 BOM 行</strong>
            <p :title="sourceBomReviewLineTitle(selectedSourceBomDiffIssue.sourceLine)">
              {{ sourceBomReviewLinePreview(selectedSourceBomDiffIssue.sourceLine) }}
            </p>
          </section>
          <section>
            <strong>当前客户 BOM 行</strong>
            <p :title="sourceBomReviewLineTitle(selectedSourceBomDiffIssue.targetLine)">
              {{ sourceBomReviewLinePreview(selectedSourceBomDiffIssue.targetLine) }}
            </p>
          </section>
        </div>
        <div class="model-bom-dialog-table-toolbar">
          <strong>来源 BOM 差异字段</strong>
          <div class="model-bom-table-height-actions" aria-label="来源 BOM 差异字段表格高度">
            <el-button-group>
              <el-button
                :icon="Minus"
                :disabled="modelBomWorkTableHeights.sourceDiffFields <= modelBomWorkTableHeightLimits.min"
                aria-label="降低来源 BOM 差异字段表格高度"
                @click="adjustModelBomWorkTableHeight('sourceDiffFields', -modelBomWorkTableHeightLimits.step)"
              />
              <el-button
                :icon="Plus"
                :disabled="modelBomWorkTableHeights.sourceDiffFields >= modelBomWorkTableHeightLimits.max"
                aria-label="提高来源 BOM 差异字段表格高度"
                @click="adjustModelBomWorkTableHeight('sourceDiffFields', modelBomWorkTableHeightLimits.step)"
              />
              <el-button
                :icon="RefreshLeft"
                :disabled="modelBomWorkTableHeights.sourceDiffFields === modelBomWorkTableDefaultHeights.sourceDiffFields"
                aria-label="恢复来源 BOM 差异字段表格默认高度"
                @click="resetModelBomWorkTableHeight('sourceDiffFields')"
              />
            </el-button-group>
          </div>
        </div>
        <el-table
          :data="selectedSourceBomDiffIssue.fields"
          border
          class="source-bom-review-table"
          row-key="label"
          :max-height="modelBomWorkTableHeights.sourceDiffFields"
        >
          <el-table-column prop="label" label="核对字段" width="130" />
          <el-table-column label="来源 BOM">
            <template #default="{ row }">
              <span :class="{ 'source-bom-review-changed': row.changed }">{{ row.sourceValue || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="客户 BOM">
            <template #default="{ row }">
              <span :class="{ 'source-bom-review-changed': row.changed }">{{ row.targetValue || '-' }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="sourceBomReviewDialogVisible = false">关闭</el-button>
        <el-button v-if="selectedSourceBomDiffIssue?.targetLine" plain @click="focusSourceBomReviewTargetLine">定位客户行</el-button>
        <el-button v-if="selectedSourceBomDiffIssue?.sourceLine" plain @click="openSourceBomFromReview">打开来源 BOM</el-button>
        <el-button
          v-if="!isMobileLayout && selectedSourceBomDiffIssue && !isSourceBomDiffReviewed(selectedSourceBomDiffIssue)"
          type="success"
          plain
          :loading="sourceBomDiffReviewSaving"
          :disabled="!sourceBomReviewForm.reviewedBy.trim()"
          @click="confirmSourceBomDiffReviewed"
        >
          确认保留差异
        </el-button>
        <el-button
          v-if="!isMobileLayout && selectedSourceBomDiffIssue && isSourceBomDiffReviewed(selectedSourceBomDiffIssue)"
          type="danger"
          plain
          :loading="sourceBomDiffReviewRevoking"
          @click="revokeSourceBomDiffReviewed(selectedSourceBomDiffIssue)"
        >
          撤销核对
        </el-button>
        <el-button v-if="!isMobileLayout && selectedSourceBomDiffIssue?.targetLine" type="primary" @click="editSourceBomReviewTargetLine">编辑客户行</el-button>
        <el-button v-else-if="!isMobileLayout && selectedSourceBomDiffIssue?.sourceLine" type="primary" @click="createCustomerLineFromSourceBomReview">按来源行补入</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="bomRevisionDetailDialogVisible"
      class="responsive-dialog"
      :title="selectedBomRevision ? `BOM 版本快照 V${selectedBomRevision.revisionNo}` : 'BOM 版本快照'"
      width="1080px"
    >
      <div v-if="selectedBomRevision" class="bom-revision-detail">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="该快照仅用于人工核对历史状态，不会恢复、替换或覆盖当前 BOM。"
        />
        <el-descriptions border :column="2" size="small">
          <el-descriptions-item label="动作">{{ formatBomRevisionAction(selectedBomRevision.action) }}</el-descriptions-item>
          <el-descriptions-item label="记录时间">{{ formatDateTime(selectedBomRevision.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="操作来源">{{ selectedBomRevision.changedBy || '-' }}</el-descriptions-item>
          <el-descriptions-item label="备注">
            <span :title="modelBomRevisionChangeRemarkTitle(selectedBomRevision)">{{ modelBomRevisionChangeRemarkPreview(selectedBomRevision) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="BOM 名称">{{ selectedBomRevisionSnapshot.bom?.bomName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="适用范围">{{ formatBomRevisionSnapshotScope(selectedBomRevisionSnapshot) }}</el-descriptions-item>
          <el-descriptions-item label="来源 BOM">{{ selectedBomRevisionSnapshot.bom?.sourceBomNameSnapshot || '-' }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ formatModelBomStatusText(selectedBomRevisionSnapshot.bom?.status) }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="selectedBomRevisionLines" border max-height="520" empty-text="该版本暂无明细快照">
          <el-table-column label="顺序" width="80">
            <template #default="{ row }">{{ Number(row.sortOrder ?? 0) }}</template>
          </el-table-column>
          <el-table-column label="结构" min-width="150">
            <template #default="{ row }">{{ formatBomRevisionLineStructure(row) }}</template>
          </el-table-column>
          <el-table-column label="零件编码" min-width="150">
            <template #default="{ row }">
              <span :title="formatBomRevisionLinePartCodeTitle(row)">{{ formatBomRevisionLinePartCode(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="零件名称" min-width="180">
            <template #default="{ row }">
              <span :title="formatBomRevisionLinePartNameTitle(row)">{{ formatBomRevisionLinePartName(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="默认数量" width="120">
            <template #default="{ row }">{{ formatBomRevisionLineQuantity(row) }}</template>
          </el-table-column>
          <el-table-column label="默认图纸" min-width="180">
            <template #default="{ row }">
              <span :title="formatBomRevisionLineDrawingTitle(row)">{{ formatBomRevisionLineDrawing(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="默认工艺" min-width="180">
            <template #default="{ row }">
              <span :title="formatBomRevisionLineDefaultProcessRouteTitle(row)">
                {{ formatBomRevisionLineDefaultProcessRoute(row) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="厚度" width="110">
            <template #default="{ row }">{{ formatBomRevisionLineThickness(row) }}</template>
          </el-table-column>
          <el-table-column label="规格" min-width="160">
            <template #default="{ row }">
              <span :title="formatBomRevisionLineSpecificationTitle(row)">{{ formatBomRevisionLineSpecification(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">{{ formatBomRevisionLineStatus(row) }}</template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="bomRevisionDetailDialogVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!selectedBomRevisionSnapshotText" @click="copyBomRevisionSnapshotText">复制快照</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="sourceBomReviewListDialogVisible" class="responsive-dialog" title="BOM 差异核对记录" width="980px">
      <div class="model-bom-dialog-table-toolbar">
        <div>
          <strong>来源 BOM 差异核对记录</strong>
          <div class="bom-scope-help">已显示 {{ sourceBomDiffReviews.length }} / {{ sourceBomDiffReviewPagination.total }} 条核对记录</div>
        </div>
        <div class="model-bom-table-height-actions" aria-label="来源 BOM 差异核对记录表格高度">
          <el-button
            v-if="!isMobileLayout"
            size="small"
            :icon="Download"
            :loading="sourceBomDiffReviewExporting"
            :disabled="!activeBom?.sourceBomId"
            @click="exportSourceBomDiffReviewsExcel"
          >
            导出 Excel
          </el-button>
          <el-button
            size="small"
            :icon="RefreshLeft"
            :loading="sourceBomDiffReviewLoading"
            :disabled="!activeBom?.sourceBomId"
            @click="loadSourceBomDiffReviews()"
          >
            刷新
          </el-button>
          <el-button-group>
            <el-button
              :icon="Minus"
              :disabled="modelBomWorkTableHeights.sourceDiffReviews <= modelBomWorkTableHeightLimits.min"
              aria-label="降低来源 BOM 差异核对记录表格高度"
              @click="adjustModelBomWorkTableHeight('sourceDiffReviews', -modelBomWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="Plus"
              :disabled="modelBomWorkTableHeights.sourceDiffReviews >= modelBomWorkTableHeightLimits.max"
              aria-label="提高来源 BOM 差异核对记录表格高度"
              @click="adjustModelBomWorkTableHeight('sourceDiffReviews', modelBomWorkTableHeightLimits.step)"
            />
            <el-button
              :icon="RefreshLeft"
              :disabled="modelBomWorkTableHeights.sourceDiffReviews === modelBomWorkTableDefaultHeights.sourceDiffReviews"
              aria-label="恢复来源 BOM 差异核对记录表格默认高度"
              @click="resetModelBomWorkTableHeight('sourceDiffReviews')"
            />
          </el-button-group>
        </div>
      </div>
      <el-table v-loading="sourceBomDiffReviewLoading" :data="sourceBomDiffReviews" border :max-height="modelBomWorkTableHeights.sourceDiffReviews">
        <el-table-column prop="issueKind" label="类型" width="120" />
        <el-table-column label="差异项" min-width="260">
          <template #default="{ row }">
            <span :title="sourceBomDiffReviewIssueTitle(row)">{{ sourceBomDiffReviewIssuePreview(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="reviewedBy" label="核对人" width="130">
          <template #default="{ row }">{{ row.reviewedBy || '-' }}</template>
        </el-table-column>
        <el-table-column label="核对时间" width="180">
          <template #default="{ row }">{{ formatSourceBomReviewAt(row.reviewedAt) }}</template>
        </el-table-column>
        <el-table-column prop="reviewRemark" label="备注" min-width="220">
          <template #default="{ row }">
            <span :title="sourceBomDiffReviewRemarkTitle(row)">{{ sourceBomDiffReviewRemarkPreview(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isMobileLayout" label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" @click="revokeSourceBomDiffReviewRow(row)">撤销核对</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="sourceBomDiffReviewHasMore" class="model-bom-dialog-table-footer">
        <span>已显示 {{ sourceBomDiffReviews.length }} / {{ sourceBomDiffReviewPagination.total }} 条</span>
        <el-button size="small" :loading="sourceBomDiffReviewLoading" @click="loadMoreSourceBomDiffReviews">加载更多</el-button>
      </div>
      <template #footer>
        <el-button @click="sourceBomReviewListDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="bomScopeApprovalDialogVisible" class="responsive-dialog" title="BOM 范围审批申请" width="1100px">
      <div class="bom-scope-approval-panel">
        <div class="model-bom-dialog-table-toolbar">
          <div class="scope-approval-filters">
            <el-select v-model="bomScopeApprovalFilters.status" style="width: 150px" @change="refreshBomScopeApprovalRequests()">
              <el-option label="待审批" value="PENDING" />
              <el-option label="已批准" value="APPROVED" />
              <el-option label="已驳回" value="REJECTED" />
              <el-option label="已使用" value="USED" />
              <el-option label="全部" value="ALL" />
            </el-select>
            <el-input v-model="bomScopeApprovalReviewForm.reviewedBy" placeholder="管理员姓名" style="width: 180px" />
            <el-input v-model="bomScopeApprovalReviewForm.reviewRemark" clearable placeholder="审批备注" style="width: 260px" />
            <span class="bom-scope-help">已显示 {{ bomScopeApprovalRequests.length }} / {{ bomScopeApprovalTotal }} 条</span>
          </div>
          <div class="scope-approval-actions">
            <el-button :loading="bomScopeApprovalLoading" @click="refreshBomScopeApprovalRequests()">刷新</el-button>
            <el-button v-if="bomScopeApprovalHasMore" :loading="bomScopeApprovalLoading" @click="loadMoreBomScopeApprovalRequests">加载更多</el-button>
          </div>
        </div>
        <el-table v-loading="bomScopeApprovalLoading" :data="bomScopeApprovalRequests" border max-height="560" empty-text="暂无 BOM 范围审批申请">
          <el-table-column label="申请号" min-width="210">
            <template #default="{ row }">
              <span :title="formatBomScopeApprovalRequestNoTitle(row)">{{ formatBomScopeApprovalRequestNoPreview(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="BOM" min-width="180">
            <template #default="{ row }">
              <span :title="formatBomScopeApprovalBomNameTitle(row)">{{ formatBomScopeApprovalBomNamePreview(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="申请范围" min-width="260">
            <template #default="{ row }">
              <span :title="formatBomScopeApprovalRequestedScopeTitle(row)">{{ formatBomScopeApprovalRequestedScopePreview(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="requestedBy" label="申请人" width="110" />
          <el-table-column label="申请原因" min-width="220">
            <template #default="{ row }">
              <span :title="formatBomScopeApprovalReasonTitle(row)">{{ formatBomScopeApprovalReasonPreview(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="bomScopeApprovalStatusTagType(row.status)" effect="plain">{{ formatBomScopeApprovalStatus(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="申请时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="审批信息" min-width="180">
            <template #default="{ row }">
              <span :title="formatBomScopeApprovalReviewTitle(row)">{{ formatBomScopeApprovalReviewPreview(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <template v-if="row.status === 'PENDING'">
                <el-button link type="success" :loading="bomScopeApprovalSavingId === `${row.id}:approve`" @click="reviewBomScopeApprovalRequest(row, true)">
                  批准
                </el-button>
                <el-button link type="danger" :loading="bomScopeApprovalSavingId === `${row.id}:reject`" @click="reviewBomScopeApprovalRequest(row, false)">
                  驳回
                </el-button>
              </template>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="bomScopeApprovalDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="modelBomConfirmDialogVisible"
      class="responsive-dialog"
      :title="modelBomConfirmTitle"
      width="640px"
      append-to-body
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      :before-close="handleModelBomConfirmDialogClose"
    >
      <div class="model-bom-confirm-panel">
        <p v-for="line in modelBomConfirmMessageLines" :key="line">{{ line }}</p>
        <ul v-if="modelBomConfirmDetails.length">
          <li v-for="detail in modelBomConfirmDetails" :key="detail">{{ detail }}</li>
        </ul>
      </div>
      <template #footer>
        <el-button @click="cancelModelBomConfirm">取消</el-button>
        <el-button :type="modelBomConfirmButtonType" @click="acceptModelBomConfirm">
          {{ modelBomConfirmButtonText }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Download } from '@element-plus/icons-vue';
import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';
import { erpApi, type CopyModelBomPayload, type SaveModelBomLinePayload, type SaveModelBomPayload } from '../api/erp';
import CustomerSelect from '../components/CustomerSelect.vue';
import MaterialSuggestionOption from '../components/MaterialSuggestionOption.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import type {
  CommonStatus,
  Customer,
  InventoryMaterialSuggestion,
  MaterialDrawingRevision,
  MaterialMemory,
  ModelBom,
  ModelBomDiffReview,
  ModelBomLine,
  ModelBomLineSummary,
  ModelBomRevision,
  ModelBomScopeApprovalRequest,
  ModelBomScopeSummary,
  ProcessDefinition
} from '../types/erp';
import { formatDateTime, formatNumber, formatQuantity } from '../utils/format';
import { filterPinyinSearchOptions, normalizeSearchKeyword, pinyinSearchMatches } from '../utils/pinyinSearch';
import { formatFileDateTime } from '../utils/tableExport';

type BomLineStructureType = 'STANDALONE_PART' | 'COMPONENT' | 'CHILD_PART';
type BomCustomerScope = 'ALL' | 'PRIVATE' | 'SELECTED';
type ModelBomOperationAction = 'common' | 'disable' | 'enable' | 'delete';
type ModelBomLineOperationAction = 'disable' | 'enable' | 'reorder';
type BomLineStructureTagType = 'success' | 'warning' | 'info' | 'danger';
type ModelBomConfirmButtonType = 'primary' | 'success' | 'warning' | 'danger' | 'info';
type BomStructureGroup = {
  id: string;
  type: 'component' | 'standalone' | 'orphan';
  line: ModelBomLine;
  children: ModelBomLine[];
};
type BomDiffField = {
  label: string;
  sourceValue: string;
  targetValue: string;
  changed: boolean;
};
type BomDiffIssue = {
  id: string;
  severity: 'warning' | 'info';
  kind: 'MISSING_IN_CUSTOMER' | 'CHANGED' | 'CUSTOMER_EXTRA';
  title: string;
  detail: string;
  sourceLine?: ModelBomLine;
  targetLine?: ModelBomLine;
  fields: BomDiffField[];
  suggestedAction: string;
};
type BomLineSummary = ModelBomLineSummary;
type ModelBomWorkTableKey = 'list' | 'lines' | 'scopeReview' | 'thicknessReview' | 'sourceDiffFields' | 'sourceDiffReviews';
const modelBomWorkTableKeys: ModelBomWorkTableKey[] = ['list', 'lines', 'scopeReview', 'thicknessReview', 'sourceDiffFields', 'sourceDiffReviews'];

type ModelBomRevisionSnapshotLine = {
  id?: string;
  materialId?: string;
  partCodeSnapshot?: string;
  partNameSnapshot?: string;
  unitSnapshot?: string;
  partSpecificationSnapshot?: string | null;
  partThicknessSnapshot?: number | null;
  lineType?: string;
  partCategory?: string | null;
  componentNo?: string | null;
  parentComponentNo?: string | null;
  defaultDrawingRevisionId?: string | null;
  defaultDrawingRevision?: {
    drawingNo?: string | null;
    drawingVersion?: string | null;
    drawingDate?: string | null;
    drawingStatus?: string | null;
    drawingFileName?: string | null;
    drawingFileUrl?: string | null;
  } | null;
  defaultProcessRoute?: string | null;
  defaultQuantity?: number;
  remark?: string | null;
  sortOrder?: number;
  status?: CommonStatus;
  createdAt?: string;
  updatedAt?: string;
};

type ModelBomRevisionSnapshot = {
  bom?: {
    bomName?: string;
    customerNameSnapshot?: string | null;
    projectModel?: string;
    customerScopeMode?: string;
    sourceBomNameSnapshot?: string | null;
    isCommon?: boolean;
    remark?: string | null;
    status?: CommonStatus;
    updatedAt?: string;
  };
  customerScopes?: Array<{
    customerId?: string;
    customerNameSnapshot?: string | null;
    status?: CommonStatus;
  }>;
  lines?: ModelBomRevisionSnapshotLine[];
};

function emptyModelBomScopeSummary(): ModelBomScopeSummary {
  return {
    totalCount: 0,
    allCustomerCount: 0,
    selectedCustomerCount: 0,
    privateCount: 0,
    commonCount: 0
  };
}

const router = useRouter();
const route = useRoute();
const { isMobileLayout } = useDeviceProfile();
const modelBomReturnPath = computed(() => (routeQueryText(route.query.returnTo) === '/orders' ? '/orders' : '/materials'));
const modelBomReturnButtonText = computed(() => (modelBomReturnPath.value === '/orders' ? '返回订单' : '返回零件管理'));
const loading = ref(false);
const saving = ref(false);
const modelBomExporting = ref(false);
const modelBomOperationSavingKey = ref('');
const modelBomLineOperationSavingKey = ref('');
const bomDialogVisible = ref(false);
const copyDialogVisible = ref(false);
const lineDialogVisible = ref(false);
const bomStructureTextDialogVisible = ref(false);
const bomListTextDialogVisible = ref(false);
const bomScopeReviewDialogVisible = ref(false);
const bomScopeApprovalDialogVisible = ref(false);
const bomScopeApprovalLoading = ref(false);
const bomScopeApprovalSubmitting = ref(false);
const bomScopeApprovalSavingId = ref('');
const bomScopeApprovalTotal = ref(0);
const bomScopeApprovalPageLimit = Number(100);
const thicknessReviewDialogVisible = ref(false);
const thicknessReviewBomId = ref('');
const thicknessReviewLineId = ref('');
const sourceBomReviewDialogVisible = ref(false);
const sourceBomReviewListDialogVisible = ref(false);
const bomRevisionDetailDialogVisible = ref(false);
const modelBomConfirmDialogVisible = ref(false);
const modelBomConfirmTitle = ref('');
const modelBomConfirmMessage = ref('');
const modelBomConfirmDetails = ref<string[]>([]);
const modelBomConfirmButtonText = ref('确认');
const modelBomConfirmButtonType = ref<ModelBomConfirmButtonType>('primary');
const modelBoms = ref<ModelBom[]>([]);
const modelBomWorkTableHeightLimits = {
  min: 320,
  max: 840,
  step: 80
};
const modelBomWorkTableDefaultHeights: Record<ModelBomWorkTableKey, number> = {
  list: 440,
  lines: 640,
  scopeReview: 360,
  thicknessReview: 520,
  sourceDiffFields: 420,
  sourceDiffReviews: 520
};
const modelBomWorkTableHeightStorageKey = 'baisheng.erp.modelBomWorkTableHeights.v1';
// 机型零件包维护和核对弹窗表格高度只作为本机 UI 偏好，不写入 BOM、订单、生产或库存业务资料。
const modelBomWorkTableHeights = reactive<Record<ModelBomWorkTableKey, number>>({ ...modelBomWorkTableDefaultHeights });
const modelBomScopeSummaryTotals = ref<ModelBomScopeSummary>(emptyModelBomScopeSummary());
const modelBomPagination = reactive({
  page: Number(1),
  limit: Number(20),
  total: Number(0)
});
const customerOptions = ref<Customer[]>([]);
const bomScopeCustomerKeyword = ref('');
const customerOptionsLoading = ref(false);
const customerOptionsTotal = ref(Number(0));
const customerOptionBatchLimit = Number(200);
const activeBomId = ref('');
const activeBomDetail = ref<ModelBom | null>(null);
const activeBomDetailLoading = ref(false);
let activeBomDetailRequestSeq = 0;
const bomRevisions = ref<ModelBomRevision[]>([]);
const selectedBomRevision = ref<ModelBomRevision | null>(null);
const bomScopeApprovalRequests = ref<ModelBomScopeApprovalRequest[]>([]);
const bomScopeApprovalHasMore = computed(() => bomScopeApprovalRequests.value.length < bomScopeApprovalTotal.value);
const bomRevisionLoading = ref(false);
const bomRevisionPagination = reactive({
  limit: Number(10),
  offset: Number(0),
  total: Number(0)
});
const sourceBomForDiff = ref<ModelBom | null>(null);
const selectedSourceBomDiffIssue = ref<BomDiffIssue | null>(null);
const sourceBomDiffReviews = ref<ModelBomDiffReview[]>([]);
const sourceBomReviewedDiffKeys = ref<Set<string>>(new Set());
const sourceBomDiffReviewPagination = reactive({
  limit: Number(50),
  offset: Number(0),
  total: Number(0)
});
const sourceBomDiffReviewHasMore = computed(() => sourceBomDiffReviews.value.length < sourceBomDiffReviewPagination.total);
const sourceBomDiffLoading = ref(false);
const sourceBomDiffReviewLoading = ref(false);
const sourceBomDiffReviewSaving = ref(false);
const sourceBomDiffReviewRevoking = ref(false);
const sourceBomDiffReviewExporting = ref(false);
const sourceBomDiffRequestSeq = ref(0);
const sourceBomDiffReviewRequestSeq = ref(0);
const lineDrawingRevisions = ref<MaterialDrawingRevision[]>([]);
const processDefinitions = ref<ProcessDefinition[]>([]);
const materialSearchSeq = ref(0);
const draggedLineIndex = ref<number | null>(null);
const dragOverLineIndex = ref<number | null>(null);
const dragOverLineInsertAfter = ref(false);
const draggedDefaultProcessIndex = ref<number | null>(null);
const defaultProcessDragOverIndex = ref<number | null>(null);
const defaultProcessDragInsertAfter = ref(false);
const draggedCommonBomId = ref('');
const draggedCommonBomScopeKey = ref('');
const commonBomDragOverId = ref('');
const lineDefaultProcessFilterKeyword = ref('');
const routeTargetBomId = ref('');
const routeTargetLineId = ref('');
const routeTargetMaterialId = ref('');
const routeTargetMaterialKeyword = ref('');
const routeTargetMaterialStatus = ref<CommonStatus>('ENABLED');
const routeTargetLineStructure = ref<BomLineStructureType>('STANDALONE_PART');
const routeTargetParentComponentNo = ref('');
const highlightedBomLineId = ref('');
const routeTargetAction = ref('');
const routeTargetKey = ref('');
const routeTargetActionApplied = ref(false);
const routeTargetBomManuallySelected = ref(false);
const routeTargetMultipleBomChoiceWarned = ref(false);
const selectedCustomerName = ref('');
const originalBomCustomerScope = ref<BomCustomerScope>('ALL');
const originalBomCustomerId = ref('');
const originalBomScopeCustomerIds = ref<string[]>([]);
const originalBomProjectModel = ref('');
const confirmedBomCustomerScope = ref<BomCustomerScope>('ALL');
const bomCustomerScopeChangeConfirmed = ref(false);
let bomScopeReviewResolver: ((confirmed: boolean) => void) | null = null;
let modelBomConfirmResolver: ((confirmed: boolean) => void) | null = null;

const filters = reactive<{
  keyword: string;
  customerId: string;
  projectModel: string;
  scopeMode: '' | 'ALL' | 'PRIVATE' | 'SELECTED';
  commonOnly: boolean;
  excludeGlobalAllProject: boolean;
  status: CommonStatus | 'ALL';
}>({
  keyword: '',
  customerId: '',
  projectModel: '',
  scopeMode: '',
  commonOnly: false,
  excludeGlobalAllProject: false,
  status: 'ENABLED'
});

const bomForm = reactive<{
  id: string;
  bomName: string;
  customerScope: BomCustomerScope;
  customerId: string;
  customerIds: string[];
  projectModel: string;
  remark: string;
  isCommon: boolean;
  status: CommonStatus;
}>({
  id: '',
  bomName: '',
  customerScope: 'ALL',
  customerId: '',
  customerIds: [],
  projectModel: '',
  remark: '',
  isCommon: false,
  status: 'ENABLED'
});

const copyForm = reactive<{
  sourceBomId: string;
  sourceBomName: string;
  customerId: string;
  bomName: string;
  projectModel: string;
  isCommon: boolean;
  remark: string;
}>({
  sourceBomId: '',
  sourceBomName: '',
  customerId: '',
  bomName: '',
  projectModel: '',
  isCommon: false,
  remark: ''
});

const bomScopeApprovalForm = reactive({
  requestedBy: '',
  requestReason: ''
});

const bomScopeApprovalFilters = reactive<{
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'ALL';
}>({
  status: 'PENDING'
});

const bomScopeApprovalReviewForm = reactive({
  reviewedBy: '管理员',
  reviewRemark: ''
});

const sourceBomReviewForm = reactive({
  reviewedBy: '',
  reviewRemark: ''
});

const modelBomConfirmMessageLines = computed(() =>
  modelBomConfirmMessage.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);

const lineForm = reactive<{
  id: string;
  materialId: string;
  materialKeyword: string;
  selectedMaterialKeyword: string;
  materialStatus: CommonStatus;
  structureType: BomLineStructureType;
  partCategory: string;
  componentNo: string;
  parentComponentNo: string;
  defaultDrawingRevisionId: string;
  defaultProcessRouteSteps: string[];
  partThickness: number | null;
  defaultQuantity: number;
  sortOrder: number;
  remark: string;
  status: CommonStatus;
}>({
  id: '',
  materialId: '',
  materialKeyword: '',
  selectedMaterialKeyword: '',
  materialStatus: 'ENABLED',
  structureType: 'STANDALONE_PART',
  partCategory: '',
  componentNo: '',
  parentComponentNo: '',
  defaultDrawingRevisionId: '',
  defaultProcessRouteSteps: [],
  partThickness: 0,
  defaultQuantity: 1,
  sortOrder: 0,
  remark: '',
  status: 'ENABLED'
});
const lineFormOriginalPartThickness = ref<number | null>(null);
const lineFormOriginalPartThicknessSource = ref<string | null>(null);

const activeBomListItem = computed(() => modelBoms.value.find((item) => item.id === activeBomId.value));
const activeBom = computed(() => (activeBomDetail.value?.id === activeBomId.value ? activeBomDetail.value : activeBomListItem.value));
const selectedBomRevisionSnapshot = computed(() => parseModelBomRevisionSnapshot(selectedBomRevision.value));
const selectedBomRevisionLines = computed(() => selectedBomRevisionSnapshot.value.lines || []);
const selectedBomRevisionSnapshotText = computed(() =>
  selectedBomRevision.value ? buildBomRevisionSnapshotText(selectedBomRevision.value, selectedBomRevisionSnapshot.value) : ''
);
const bomRevisionHasMore = computed(() => bomRevisions.value.length < bomRevisionPagination.total);
const thicknessReviewBom = computed(() =>
  activeBomDetail.value?.id === thicknessReviewBomId.value
    ? activeBomDetail.value
    : modelBoms.value.find((item) => item.id === thicknessReviewBomId.value) || activeBom.value
);
const thicknessReviewLines = computed(() => (thicknessReviewBom.value?.lines || []).filter(lineNeedsThicknessReview));
const thicknessReviewSummary = computed(() => summarizeThicknessReviewLines(thicknessReviewBom.value?.lines || []));
const thicknessReviewText = computed(() => {
  const bom = thicknessReviewBom.value;
  if (!bom || thicknessReviewLines.value.length === 0) {
    return '';
  }
  const summary = thicknessReviewSummary.value;
  const lines = [
    'BOM 厚度核对清单',
    `零件包：${bom.bomName}`,
    `适用范围：${modelBomScopeText(bom)}`,
    `统计：需核对 ${summary.totalCount}；未填写 ${summary.noThicknessCount}；历史参考 ${summary.historyReferenceCount}；来源未确认 ${summary.unconfirmedSourceCount}`,
    '说明：父级组件不参与厚度核对；确认厚度只写入当前 BOM 明细，不改历史订单、库存或生产记录。',
    '序号\tBOM顺序\t结构\t零件编码\t零件名称\t当前厚度\t厚度来源\t核对原因\t默认图纸\t规格'
  ];
  thicknessReviewLines.value.forEach((line, index) => {
    lines.push(
      [
        index + 1,
        displayBomLineOrder(line) || '-',
        formatLineStructure(line),
        line.partCode || '-',
        line.partName || '-',
        formatLineThickness(line),
        formatLineThicknessSourceLabel(line),
        formatLineThicknessReviewReason(line),
        formatLineDrawing(line),
        line.partSpecification || '-'
      ].join('\t')
    );
  });
  return lines.join('\n');
});
const lineDialogTitle = computed(() =>
  lineForm.id && lineForm.id === thicknessReviewLineId.value && lineDialogVisible.value ? '核对 BOM 明细厚度' : lineForm.id ? '编辑包内零件' : '添加包内零件'
);
const thicknessReviewEditingLine = computed(() => {
  if (!lineDialogVisible.value || !lineForm.id || lineForm.id !== thicknessReviewLineId.value) {
    return undefined;
  }
  return modelBoms.value.flatMap((bom) => bom.lines || []).find((line) => line.id === lineForm.id);
});

function summarizeThicknessReviewLines(lines: ModelBomLine[]) {
  const reviewLines = lines.filter(lineNeedsThicknessReview);
  const summary = {
    totalCount: reviewLines.length,
    noThicknessCount: 0,
    historyReferenceCount: 0,
    unconfirmedSourceCount: 0
  };
  for (const line of reviewLines) {
    const thickness = Number(line.partThickness ?? 0);
    if (thickness <= 0) {
      summary.noThicknessCount += 1;
    } else if (line.partThicknessSource === 'ORDER_HISTORY') {
      summary.historyReferenceCount += 1;
    } else if (line.partThicknessSource !== 'BOM_LINE') {
      summary.unconfirmedSourceCount += 1;
    }
  }
  return summary;
}

function formatThicknessReviewBreakdown(lines: ModelBomLine[]) {
  const summary = summarizeThicknessReviewLines(lines);
  return `点击打开当前 BOM 厚度核对：需核对 ${summary.totalCount}，未填写 ${summary.noThicknessCount}，历史参考 ${summary.historyReferenceCount}，来源未确认 ${summary.unconfirmedSourceCount}`;
}
const thicknessReviewLineNotice = computed(() => {
  if (!lineDialogVisible.value || !lineForm.id || lineForm.id !== thicknessReviewLineId.value || lineForm.structureType === 'COMPONENT') {
    return '';
  }
  if (thicknessReviewEditingLine.value?.partThicknessSource === 'ORDER_HISTORY') {
    return `正在核对 ${lineForm.materialKeyword || '当前 BOM 明细'} 的默认厚度；当前值来自历史订单，只作为预填建议。保存后才会写入当前 BOM 明细，不改历史订单、库存或生产记录。`;
  }
  return `正在核对 ${lineForm.materialKeyword || '当前 BOM 明细'} 的默认厚度；填 0 会继续保留“需核对”。保存只写入当前 BOM 明细，不改历史订单、库存或生产记录。`;
});
const lineFormThicknessHelpText = computed(() => {
  if (lineFormOriginalPartThicknessSource.value === 'ORDER_HISTORY' && lineForm.id !== thicknessReviewLineId.value) {
    return '当前厚度来自历史订单，只作为核对参考；普通编辑保存不会把未改动的历史厚度确认为 BOM 厚度，点击“厚度核对”或手工改动后保存才写入当前 BOM 明细。';
  }
  return '填 0 表示仍需核对；保存后只写入当前 BOM 明细，作为后续下单建议，不改历史订单、库存或生产记录。';
});
const activeBomHasRouteTargetLine = computed(() => Boolean(routeTargetLineId.value && activeBom.value?.lines.some((line) => line.id === routeTargetLineId.value)));
const activeSourceBomName = computed(() => sourceBomForDiff.value?.bomName || activeBom.value?.sourceBomNameSnapshot || '百胜通用 BOM');
const modelBomFilterSummaryVisible = computed(() =>
  Boolean(
    filters.keyword.trim() ||
      filters.customerId ||
      filters.projectModel.trim() ||
      filters.scopeMode ||
      filters.commonOnly ||
      filters.excludeGlobalAllProject ||
      filters.status !== 'ENABLED'
  )
);
const modelBomScopeSummary = computed(() => modelBomScopeSummaryTotals.value);
const modelBomScopeSummaryVisible = computed(() => modelBomScopeSummary.value.totalCount > 0 || Boolean(filters.scopeMode || filters.commonOnly));
const modelBomScopeGuideItems = computed(() => [
  {
    value: 'ALL' as const,
    label: '全部客户通用',
    description: '任意客户下单时都可见，只适合真正标准的百胜通用 BOM。'
  },
  {
    value: 'SELECTED' as const,
    label: '指定客户可用',
    description: '只对勾选客户可见，可在编辑表头里单选、多选或一次性全选客户。'
  },
  {
    value: 'PRIVATE' as const,
    label: '客户私有',
    description: '只属于所属客户，不会显示在其他客户界面。'
  }
]);

function modelBomScopeGuideDescriptionPreview(description: string) {
  return formatModelBomLongTextPreview(description, 28, '-');
}

const bomScopeSelectedCustomers = computed(() =>
  customerOptions.value.filter((customer) => bomForm.customerIds.includes(customer.id))
);
const bomScopeFilteredCustomerOptions = computed(() => {
  const keyword = bomScopeCustomerKeyword.value.trim();
  if (!keyword) {
    return customerOptions.value;
  }
  return customerOptions.value.filter((customer) => pinyinSearchMatches(customerSearchParts(customer), keyword));
});
const bomScopeCustomerDisplayOptions = computed(() => {
  const filtered = bomScopeFilteredCustomerOptions.value;
  if (!bomScopeCustomerKeyword.value.trim()) {
    return filtered;
  }
  const filteredIdSet = new Set(filtered.map((customer) => customer.id));
  const selectedOutsideFilter = bomScopeSelectedCustomers.value.filter((customer) => !filteredIdSet.has(customer.id));
  return [...selectedOutsideFilter, ...filtered];
});
const bomScopeSelectedCustomerCountText = computed(() => {
  if (bomForm.customerScope !== 'SELECTED') {
    return '';
  }
  const keyword = bomScopeCustomerKeyword.value.trim();
  const matchedText = keyword ? `；搜索命中 ${bomScopeFilteredCustomerOptions.value.length} 个` : '';
  const total = customerOptionsTotal.value || customerOptions.value.length;
  return `已勾选 ${bomForm.customerIds.length} / ${total} 个客户${matchedText}`;
});
const bomScopeCustomerOptionLoadText = computed(() => {
  if (bomForm.customerScope !== 'SELECTED') {
    return '';
  }
  if (customerOptionsLoading.value) {
    return `客户选项加载中：已加载 ${customerOptions.value.length} / ${customerOptionsTotal.value || '...'} 个`;
  }
  if (customerOptionsTotal.value > 0) {
    return `客户选项已加载 ${customerOptions.value.length} / ${customerOptionsTotal.value} 个`;
  }
  return '客户选项未加载或暂无启用客户';
});
const bomScopeCustomerSelectionText = computed(() => {
  if (bomForm.customerScope === 'ALL') {
    return '全部客户通用：任意客户下单时都可以看到该 BOM，建议只用于真正标准的百胜通用包。';
  }
  if (bomForm.customerScope === 'PRIVATE') {
    const customerName = customerOptions.value.find((customer) => customer.id === bomForm.customerId)?.customerName;
    return `客户私有：仅 ${customerName || '所选客户'} 可见，不会显示在其他客户界面。`;
  }
  const selectedNames = bomScopeSelectedCustomers.value.map((customer) => customer.customerName);
  return selectedNames.length
    ? `指定客户可用：${formatCustomerNamePreview(selectedNames)} 可见；可使用全部勾选批量开放。`
    : '指定客户可用：请勾选允许使用该 BOM 的客户。';
});
const bomScopeNarrowingText = computed(() => {
  if (!bomForm.id || bomCustomerScopeExpansionNeedsConfirmation()) {
    return '';
  }
  if (originalBomCustomerScope.value === 'ALL' && bomForm.customerScope !== 'ALL') {
    return `范围缩小：保存后仅${bomScopeVisibilityText()}可见；不会删除 BOM 明细、历史订单、生产任务或库存记录。`;
  }
  if (originalBomCustomerScope.value === 'SELECTED' && bomForm.customerScope === 'SELECTED') {
    const removedCustomerNames = removedBomScopeCustomerNames();
    return removedCustomerNames.length
      ? `范围缩小：将移除可用客户 ${formatCustomerNamePreview(removedCustomerNames)}；不会删除 BOM 明细、历史订单、生产任务或库存记录。`
      : '';
  }
  if (originalBomCustomerScope.value === 'SELECTED' && bomForm.customerScope === 'PRIVATE') {
    return `范围缩小：保存后仅${bomScopeVisibilityText()}可见；不会删除 BOM 明细、历史订单、生产任务或库存记录。`;
  }
  return '';
});
const bomScopeReviewRows = computed(() => {
  if (!bomForm.id) {
    return [];
  }
  const rows: Array<{ field: string; before: string; after: string; impact: string }> = [];
  const previousScopeLabel = bomCustomerScopeLabel(originalBomCustomerScope.value);
  const nextScopeLabel = bomCustomerScopeLabel(bomForm.customerScope);
  if (originalBomCustomerScope.value !== bomForm.customerScope) {
    rows.push({
      field: '客户范围类型',
      before: previousScopeLabel,
      after: nextScopeLabel,
      impact: bomCustomerScopeTypeImpactText()
    });
  }
  const previousCustomerText = bomScopeCustomerText(originalBomCustomerScope.value, originalBomCustomerId.value, originalBomScopeCustomerIds.value);
  const nextCustomerText = bomScopeCustomerText(bomForm.customerScope, bomForm.customerId, bomForm.customerIds);
  if (previousCustomerText !== nextCustomerText) {
    rows.push({
      field: '可见客户',
      before: previousCustomerText,
      after: nextCustomerText,
      impact: bomCustomerVisibilityImpactText()
    });
  }
  const previousProjectText = bomProjectScopeText(originalBomProjectModel.value);
  const nextProjectText = bomProjectScopeText(bomForm.projectModel);
  if (previousProjectText !== nextProjectText) {
    rows.push({
      field: '机型/项目范围',
      before: previousProjectText,
      after: nextProjectText,
      impact: bomProjectScopeBroadens(originalBomProjectModel.value, bomForm.projectModel) ? '适用机型增加' : '适用机型减少'
    });
  }
  return rows;
});
const bomScopeReviewAlertText = computed(() => {
  if (bomScopeChangeBroadens()) {
    return '正在扩大 BOM 适用范围，请核对新增客户或机型确实可以使用该 BOM。';
  }
  return '正在缩小或调整 BOM 适用范围，请核对后续哪些客户和机型还能看到该 BOM。';
});

function formatBomScopeReviewCellPreview(value?: string | null, maxLength = 32) {
  return formatModelBomLongTextPreview(value, maxLength, '-');
}

function formatBomScopeReviewCellTitle(value?: string | null) {
  return String(value || '').trim() || '-';
}

const modelBomCommonDragRows = computed(() => modelBoms.value.filter((row) => row.status === 'ENABLED' && row.isCommon));
function formatModelBomListLineSummary(row: ModelBom) {
  const summary = modelBomLineSummary(row);
  return {
    effectiveCount: summary.effectiveCount,
    inactiveCount: summary.inactiveCount,
    structureText: `组件 ${summary.componentCount} / 子零件 ${summary.childPartCount} / 单独零件 ${summary.standalonePartCount} / 未匹配父级 ${summary.orphanPartCount}`,
    reviewText: `厚度已确认 ${summary.confirmedThicknessCount} / 历史参考 ${summary.historyThicknessCount} / 无厚度 ${summary.noThicknessCount} / 需核对 ${summary.missingThicknessCount}`,
    inactiveText: `停用 ${summary.disabledCount} / 基础零件停用 ${summary.materialDisabledCount}`
  };
}

function modelBomListThicknessReviewTitle(row: ModelBom) {
  if ((row.lines || []).length > 0) {
    return formatThicknessReviewBreakdown(row.lines || []);
  }
  const summary = modelBomLineSummary(row);
  return `列表只显示摘要；需核对 ${summary.missingThicknessCount} 行，点击后读取 BOM 详情再处理。`;
}

const modelBomListText = computed(() => {
  if (modelBoms.value.length === 0) {
    return '';
  }
  const summary = modelBomScopeSummary.value;
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
    '有效推荐行',
    '停用/基础停用行',
    '结构统计',
    '核对项',
    '停用统计',
    '来源BOM'
  ].join('\t');
  const pageOffset = (modelBomPagination.page - 1) * modelBomPagination.limit;
  const rows = modelBoms.value.map((row, index) => {
    const lineSummary = formatModelBomListLineSummary(row);
    return [
      pageOffset + index + 1,
      modelBomScopeTypeLabel(row),
      row.isCommon ? '常用' : '非常用',
      row.isCommon ? modelBomCommonDisplayOrder(row) : '-',
      row.bomName,
      modelBomScopeText(row),
      modelBomCustomerText(row),
      row.projectModel || '全部机型/项目',
      formatModelBomStatusText(row.status),
      lineSummary.effectiveCount,
      lineSummary.inactiveCount,
      lineSummary.structureText,
      lineSummary.reviewText,
      lineSummary.inactiveText,
      row.sourceBomNameSnapshot || '-'
    ].join('\t');
  });
  return [
    `BOM 范围固定格式清单（当前页 ${modelBoms.value.length} / 筛选结果 ${modelBomPagination.total} 个零件包）`,
    `当前筛选：关键字 ${modelBomKeywordFilterLabel()}；客户 ${selectedCustomerFilterLabel()}；机型 ${filters.projectModel || '全部'}；BOM 范围 ${modelBomScopeFilterLabel()}；泛用包 ${modelBomGlobalAllProjectFilterLabel()}；常用 ${modelBomCommonFilterLabel()}；状态 ${modelBomStatusFilterLabel()}`,
    '常用说明：常用 BOM 只影响同一客户/机型范围内的显示顺序和下单推荐优先级，不修改 BOM 明细、适用客户、订单、生产任务或库存。',
    '普通可用说明：非常用 BOM 仍可维护、复制和手动用于下单，只是不参与常用优先排序。',
    '厚度说明：固定格式中只有“来源 当前BOM明细”表示该厚度已经保存到当前 BOM；“历史订单参考”或“未确认”仍需点击厚度核对后人工保存。',
    `范围统计：全部客户通用 ${summary.allCustomerCount}；指定客户可用 ${summary.selectedCustomerCount}；客户私有 ${summary.privateCount}；常用 BOM ${summary.commonCount}`,
    header,
    ...rows
  ].join('\n');
});
const routeTargetLineNotice = computed(() => {
  if (lineForm.id || routeTargetAction.value !== 'createLine' || !routeTargetMaterialId.value || !lineDialogVisible.value) {
    return '';
  }
  return `来自零件管理：已带入 ${lineForm.materialKeyword || '当前零件'}；当前按${routeTargetLineStructureLabel()}加入 BOM，保存前可改为组件、组件子零件或单独零件。`;
});
const routeTargetLineEditNotice = computed(() => {
  if (routeTargetAction.value !== 'editLine' || !lineForm.id || lineForm.id !== routeTargetLineId.value || !lineDialogVisible.value) {
    return '';
  }
  const thicknessText = formatLineFormThicknessStatusText();
  if (modelBomReturnPath.value === '/orders') {
    return `来自订单 BOM 预览：${thicknessText}。保存后请回到订单页点击“刷新 BOM 预览”，再确认带入草稿。`;
  }
  return `已定位到指定 BOM 明细：${thicknessText}。保存只修改当前 BOM 明细，不改历史订单、库存或生产记录。`;
});
const filteredLineDefaultProcessDefinitions = computed(() => {
  const keyword = lineDefaultProcessFilterKeyword.value;
  if (!keyword.trim()) {
    return processDefinitions.value;
  }
  const matchedNames = new Set(filterPinyinSearchOptions(processDefinitions.value.map((item) => item.processName), keyword));
  return processDefinitions.value.filter((item) => matchedNames.has(item.processName));
});
const sortedActiveBomLines = computed(() => [...(activeBom.value?.lines || [])].sort(compareBomLines));
const activeBomDisplayLines = computed(() => {
  const lines = sortedActiveBomLines.value;
  const childrenByParent = new Map<string, ModelBomLine[]>();
  const enabledComponentNos = enabledComponentNosForLines(lines);
  const rootLines: ModelBomLine[] = [];
  for (const line of lines) {
    const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
    if (line.lineType === 'PART' && parentComponentNo) {
      childrenByParent.set(parentComponentNo, [...(childrenByParent.get(parentComponentNo) || []), line]);
    } else {
      rootLines.push(line);
    }
  }
  const ordered: ModelBomLine[] = [];
  const attachedIds = new Set<string>();
  for (const line of rootLines) {
    ordered.push(line);
    const componentNo = normalizeComponentNo(line.componentNo);
    if (line.lineType === 'COMPONENT' && componentNo && enabledComponentNos.has(componentNo)) {
      for (const child of childrenByParent.get(componentNo) || []) {
        ordered.push(child);
        attachedIds.add(child.id);
      }
    }
  }
  for (const line of lines) {
    if (line.lineType === 'PART' && line.parentComponentNo && !attachedIds.has(line.id)) {
      ordered.push(line);
    }
  }
  return ordered;
});
const activeBomLineDisplayOrderMap = computed(() => {
  const displayOrderMap = new Map<string, number>();
  activeBomDisplayLines.value.forEach((line, index) => {
    displayOrderMap.set(line.id, index + 1);
  });
  return displayOrderMap;
});

function buildBomStructureGroups(lines: ModelBomLine[]) {
  const childrenByParent = new Map<string, ModelBomLine[]>();
  const enabledComponentNos = enabledComponentNosForLines(lines);
  const rootLines: ModelBomLine[] = [];
  for (const line of lines) {
    const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
    if (line.lineType === 'PART' && parentComponentNo) {
      childrenByParent.set(parentComponentNo, [...(childrenByParent.get(parentComponentNo) || []), line]);
    } else {
      rootLines.push(line);
    }
  }
  const groups: BomStructureGroup[] = [];
  const attachedIds = new Set<string>();
  for (const line of rootLines) {
    if (line.lineType === 'COMPONENT') {
      const componentNo = normalizeComponentNo(line.componentNo);
      const children = componentNo && enabledComponentNos.has(componentNo) ? childrenByParent.get(componentNo) || [] : [];
      children.forEach((child) => attachedIds.add(child.id));
      groups.push({ id: `component-${line.id}`, type: 'component', line, children });
      continue;
    }
    groups.push({ id: `standalone-${line.id}`, type: 'standalone', line, children: [] });
  }
  for (const line of lines) {
    if (line.lineType === 'PART' && line.parentComponentNo && !attachedIds.has(line.id)) {
      groups.push({ id: `orphan-${line.id}`, type: 'orphan', line, children: [] });
    }
  }
  return groups;
}

const activeBomStructureGroups = computed<BomStructureGroup[]>(() => buildBomStructureGroups(sortedActiveBomLines.value));
const activeBomLineSummary = computed(() => summarizeModelBomLines(activeBomDisplayLines.value));
const lineFormDisplayOrderText = computed(() => {
  if (!lineForm.id) {
    return '保存后排到末尾';
  }
  const displayOrder = activeBomLineDisplayOrderMap.value.get(lineForm.id);
  return displayOrder ? String(displayOrder) : '未在当前明细中显示';
});
function enabledComponentNosForLines(lines: ModelBomLine[]) {
  return new Set(
    lines
      .filter((line) => line.lineType === 'COMPONENT' && line.status === 'ENABLED')
      .map((line) => normalizeComponentNo(line.componentNo))
      .filter(Boolean)
  );
}

function lineCountsAsActiveBomContent(line: ModelBomLine) {
  return line.status === 'ENABLED' && line.materialStatus !== 'DISABLED';
}

function lineNeedsThicknessReview(line: ModelBomLine) {
  // 只核对启用且基础零件可用的明细；父级组件只是结构容器，历史订单厚度也必须人工保存到当前 BOM 后才算已核对。
  return (
    lineCountsAsActiveBomContent(line) &&
    line.lineType !== 'COMPONENT' &&
    (Number(line.partThickness ?? 0) <= 0 || line.partThicknessSource !== 'BOM_LINE')
  );
}

function summarizeModelBomLines(lines: ModelBomLine[]): BomLineSummary {
  const activeContentLines = lines.filter(lineCountsAsActiveBomContent);
  const enabledComponentNos = enabledComponentNosForLines(activeContentLines);
  return lines.reduce(
    (summary, line) => {
      const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
      if (line.status === 'DISABLED') {
        summary.disabledCount += 1;
      }
      if (line.materialStatus === 'DISABLED') {
        summary.materialDisabledCount += 1;
      }
      if (!lineCountsAsActiveBomContent(line)) {
        return summary;
      }
      summary.effectiveCount += 1;
      if (lineNeedsThicknessReview(line)) {
        summary.missingThicknessCount += 1;
      }
      if (line.lineType !== 'COMPONENT') {
        if (Number(line.partThickness ?? 0) > 0 && line.partThicknessSource === 'BOM_LINE') {
          summary.confirmedThicknessCount += 1;
        } else if (Number(line.partThickness ?? 0) > 0 && line.partThicknessSource === 'ORDER_HISTORY') {
          summary.historyThicknessCount += 1;
        } else {
          summary.noThicknessCount += 1;
        }
      }
      if (line.lineType === 'COMPONENT') {
        summary.componentCount += 1;
      } else if (parentComponentNo && !enabledComponentNos.has(parentComponentNo)) {
        summary.orphanPartCount += 1;
      } else if (parentComponentNo) {
        summary.childPartCount += 1;
      } else {
        summary.standalonePartCount += 1;
      }
      return summary;
    },
    {
      componentCount: 0,
      childPartCount: 0,
      standalonePartCount: 0,
      orphanPartCount: 0,
      missingThicknessCount: 0,
      disabledCount: 0,
      materialDisabledCount: 0,
      effectiveCount: 0,
      inactiveCount: Math.max(lines.length - activeContentLines.length, 0),
      confirmedThicknessCount: 0,
      historyThicknessCount: 0,
      noThicknessCount: 0
    }
  );
}

function modelBomLineSummary(row: ModelBom) {
  return row.lineSummary || summarizeModelBomLines(row.lines || []);
}

function modelBomScopeMode(row: ModelBom) {
  if (row.customerId) {
    return 'PRIVATE';
  }
  return row.customerScopeMode === 'SELECTED' ? 'SELECTED' : 'ALL';
}

function isAllCustomerBom(row: ModelBom) {
  return modelBomScopeMode(row) === 'ALL';
}

function modelBomScopeTypeLabel(row: ModelBom) {
  return row.scopeTypeLabel || (modelBomScopeMode(row) === 'PRIVATE' ? '客户私有' : modelBomScopeMode(row) === 'SELECTED' ? '指定客户可用' : '全部客户通用');
}

function modelBomCustomerText(row: ModelBom) {
  if (modelBomScopeMode(row) === 'ALL') {
    return '全部客户';
  }
  if (row.customerName) {
    return row.customerName;
  }
  const scopeCustomerNames = (row.scopeCustomers || []).map((item) => item.customerName).filter(Boolean);
  return formatCustomerNamePreview(scopeCustomerNames, '指定客户', row.scopeCustomerCount);
}

function modelBomScopeText(row: ModelBom) {
  return `${modelBomScopeTypeLabel(row)} / ${modelBomCustomerText(row)} / ${row.projectModel || '全部机型/项目'}`;
}

function modelBomScopeTitle(row: ModelBom) {
  const scopeMode = modelBomScopeMode(row);
  const projectModel = row.projectModel || '全部机型/项目';
  if (scopeMode === 'ALL') {
    return `适用范围：全部客户 / ${projectModel}。列表只显示摘要，不代表自动覆盖客户 BOM。`;
  }
  if (scopeMode === 'PRIVATE') {
    return `适用范围：客户私有 / ${row.customerName || '指定客户'} / ${projectModel}。只影响该客户，不覆盖其他客户 BOM。`;
  }
  const scopeCustomerNames = (row.scopeCustomers || []).map((item) => item.customerName).filter(Boolean);
  return `适用范围：指定客户可用 / ${formatCustomerNamePreview(scopeCustomerNames, '指定客户', row.scopeCustomerCount)} / ${projectModel}。完整客户范围请进入 BOM 详情核对；扩大可见范围必须先走审批。`;
}

function formatCustomerNamePreview(names: Array<string | null | undefined>, emptyText = '-', totalCount?: number) {
  const filtered = names.map((name) => String(name || '').trim()).filter(Boolean);
  const displayTotal = Math.max(totalCount ?? 0, filtered.length);
  if (filtered.length === 0) {
    return emptyText;
  }
  const preview = filtered.filter((_, index) => index < 3).join('、');
  return displayTotal > 3 ? `${preview} 等 ${displayTotal} 个客户` : preview;
}

function modelBomScopeTagType(row: ModelBom): 'success' | 'warning' | 'info' {
  if (modelBomScopeMode(row) === 'PRIVATE') {
    return 'warning';
  }
  return modelBomScopeMode(row) === 'SELECTED' ? 'info' : 'success';
}

function modelBomCommonScopeKey(row: ModelBom) {
  return `${row.customerScopeKey || row.customerId || modelBomScopeMode(row)}__${row.projectModelScopeKey || row.projectModel || 'ALL'}`;
}

function modelBomOperationKey(row: ModelBom, action: ModelBomOperationAction) {
  return `${action}:model-bom:${row.id}`;
}

function modelBomLineOperationKey(row: ModelBomLine, action: ModelBomLineOperationAction) {
  return `${action}:model-bom-line:${row.id}`;
}

function modelBomCommonDragRowsForScope(row: ModelBom) {
  const scopeKey = modelBomCommonScopeKey(row);
  return modelBomCommonDragRows.value.filter((item) => modelBomCommonScopeKey(item) === scopeKey);
}

function modelBomCommonDisplayOrder(row: ModelBom) {
  if (row.status !== 'ENABLED' || !row.isCommon) {
    return '-';
  }
  const scopedRows = [...modelBomCommonDragRowsForScope(row)].sort(
    (left, right) =>
      (left.commonSortOrder || Number.MAX_SAFE_INTEGER) - (right.commonSortOrder || Number.MAX_SAFE_INTEGER) ||
      left.bomName.localeCompare(right.bomName)
  );
  const index = scopedRows.findIndex((item) => item.id === row.id);
  return index >= 0 ? index + 1 : '-';
}

const availableParentComponents = computed(() => {
  const seenComponentNos = new Set<string>();
  return sortedActiveBomLines.value.filter((line) => {
    const componentNo = normalizeComponentNo(line.componentNo);
    if (line.lineType !== 'COMPONENT' || line.status !== 'ENABLED' || line.id === lineForm.id || !componentNo) {
      return false;
    }
    if (seenComponentNos.has(componentNo)) {
      return false;
    }
    seenComponentNos.add(componentNo);
    return true;
  });
});
const lineFormExistingLine = computed(() => sortedActiveBomLines.value.find((line) => line.id === lineForm.id));
const lineFormExistingComponentNo = computed(() =>
  lineFormExistingLine.value?.lineType === 'COMPONENT' ? normalizeComponentNo(lineFormExistingLine.value.componentNo) : ''
);
const lineFormExistingComponentChildLines = computed(() => {
  const componentNo = lineFormExistingComponentNo.value;
  if (!componentNo) {
    return [];
  }
  return sortedActiveBomLines.value.filter((line) => line.lineType === 'PART' && normalizeComponentNo(line.parentComponentNo) === componentNo);
});
const lineFormExistingComponentEnabledChildLines = computed(() =>
  lineFormExistingComponentChildLines.value.filter((line) => line.status === 'ENABLED')
);
function formatComponentMutationChildSummary(childLines: ModelBomLine[]) {
  if (childLines.length === 0) {
    return '';
  }
  const previewItems: string[] = [];
  for (let index = 0; index < childLines.length && index < 5; index += 1) {
    const line = childLines[index];
    if (line) {
      previewItems.push(`${line.partCode} / ${line.partName}`);
    }
  }
  const preview = previewItems.join('；');
  const remainingCount = childLines.length > 5 ? ` 等 ${childLines.length} 个` : '';
  return `涉及子零件：${preview}${remainingCount}`;
}
function enabledChildLinesForComponentLine(row: ModelBomLine) {
  const componentNo = normalizeComponentNo(row.componentNo);
  if (row.lineType !== 'COMPONENT' || !componentNo) {
    return [];
  }
  return sortedActiveBomLines.value.filter(
    (line) => line.lineType === 'PART' && line.status === 'ENABLED' && normalizeComponentNo(line.parentComponentNo) === componentNo
  );
}
const lineFormComponentMutationChildSummary = computed(() => formatComponentMutationChildSummary(lineFormExistingComponentChildLines.value));
const lineFormComponentDisableChildSummary = computed(() => formatComponentMutationChildSummary(lineFormExistingComponentEnabledChildLines.value));
const lineFormComponentNoRisk = computed(() => {
  const componentNo = normalizeComponentNo(lineForm.componentNo);
  if (lineForm.structureType !== 'COMPONENT' || !componentNo) {
    return '';
  }
  if (isComponentNoOutOfRange(componentNo)) {
    return '组件编号只支持 C001-C9999；自定义编号请不要使用 C 开头的非 C001-C9999 数字格式';
  }
  const duplicated = sortedActiveBomLines.value.find(
    (line) => line.lineType === 'COMPONENT' && line.id !== lineForm.id && normalizeComponentNo(line.componentNo) === componentNo
  );
  return duplicated ? `组件编号 ${componentNo} 已存在，请换一个编号` : '';
});
const lineFormComponentMutationNotice = computed(() => {
  const existingComponentNo = lineFormExistingComponentNo.value;
  const childCount = lineFormExistingComponentChildLines.value.length;
  const enabledChildCount = lineFormExistingComponentEnabledChildLines.value.length;
  if (!existingComponentNo || childCount === 0) {
    return '';
  }
  const childSummary = lineFormComponentMutationChildSummary.value;
  if (lineForm.structureType !== 'COMPONENT') {
    return `该组件当前有 ${childCount} 个子零件，保存后这些子零件会改为单独零件。${childSummary}`;
  }
  const nextComponentNo = normalizeComponentNo(lineForm.componentNo);
  if (nextComponentNo && nextComponentNo !== existingComponentNo) {
    const disableNotice = lineForm.status === 'DISABLED' && enabledChildCount > 0 ? `；其中 ${enabledChildCount} 个启用子零件会同步停用` : '';
    return `该组件当前有 ${childCount} 个子零件，保存后仍指向 ${existingComponentNo} 的子零件会同步改挂到 ${nextComponentNo}${disableNotice}。${childSummary}`;
  }
  if (lineForm.status === 'DISABLED' && enabledChildCount > 0) {
    return `该组件当前有 ${enabledChildCount} 个启用子零件，停用组件会同步停用仍挂靠的启用子零件。${lineFormComponentDisableChildSummary.value}`;
  }
  return '';
});
const lineFormParentComponent = computed(() => {
  const parentComponentNo = normalizeComponentNo(lineForm.parentComponentNo);
  if (lineForm.structureType !== 'CHILD_PART' || !parentComponentNo) {
    return undefined;
  }
  return sortedActiveBomLines.value.find(
    (line) => line.lineType === 'COMPONENT' && line.id !== lineForm.id && normalizeComponentNo(line.componentNo) === parentComponentNo
  );
});
const lineFormParentComponentNotice = computed(() => {
  const parentComponentNo = normalizeComponentNo(lineForm.parentComponentNo);
  if (lineForm.structureType !== 'CHILD_PART' || !parentComponentNo) {
    return '';
  }
  if (!lineFormParentComponent.value) {
    return `所属组件 ${parentComponentNo} 不存在，请先维护组件行`;
  }
  if (lineFormParentComponent.value.status !== 'ENABLED') {
    return `所属组件 ${parentComponentNo} 已停用，当前子零件只能保存为停用；如需启用推荐，请先启用组件行`;
  }
  return '';
});
const lineFormParentComponentRisk = computed(() => {
  const parentComponentNo = normalizeComponentNo(lineForm.parentComponentNo);
  if (lineForm.structureType !== 'CHILD_PART' || !parentComponentNo) {
    return '';
  }
  if (!lineFormParentComponent.value) {
    return `所属组件 ${parentComponentNo} 不存在，请先维护组件行`;
  }
  if (lineForm.status === 'ENABLED' && lineFormParentComponent.value.status !== 'ENABLED') {
    return `所属组件 ${parentComponentNo} 已停用，请先启用组件行，或将子零件保存为停用`;
  }
  return '';
});
const lineFormEnableStatusDisabled = computed(() => {
  if (lineForm.materialStatus === 'DISABLED') {
    return true;
  }
  if (lineForm.structureType !== 'CHILD_PART') {
    return false;
  }
  const parentComponentNo = normalizeComponentNo(lineForm.parentComponentNo);
  return Boolean(parentComponentNo && (!lineFormParentComponent.value || lineFormParentComponent.value.status !== 'ENABLED'));
});
const lineFormEnableStatusDisabledReason = computed(() => {
  if (lineForm.materialStatus === 'DISABLED') {
    return '请先启用零件基础资料';
  }
  if (lineFormEnableStatusDisabled.value) {
    return '请先选择启用的所属组件';
  }
  return '';
});
const lineFormMaterialSelectionRisk = computed(() => {
  const keyword = lineForm.materialKeyword.trim();
  if (!keyword) {
    return '';
  }
  if (!lineForm.materialId) {
    return '请从搜索结果中选择零件，不能只输入关键词';
  }
  if (keyword !== lineForm.selectedMaterialKeyword) {
    return '零件关键词已被修改，请重新从搜索结果中选择零件';
  }
  return '';
});
const lineFormDuplicateLineRisk = computed(() => {
  if (!lineForm.materialId) {
    return '';
  }
  const lineType = lineForm.structureType === 'COMPONENT' ? 'COMPONENT' : 'PART';
  const componentNo = lineForm.structureType === 'COMPONENT' ? normalizeComponentNo(lineForm.componentNo) : '';
  const parentComponentNo = lineForm.structureType === 'CHILD_PART' ? normalizeComponentNo(lineForm.parentComponentNo) : '';
  const duplicate = sortedActiveBomLines.value.find((line) => {
    if (line.id === lineForm.id || line.materialId !== lineForm.materialId || line.lineType !== lineType) {
      return false;
    }
    return normalizeComponentNo(line.componentNo) === componentNo && normalizeComponentNo(line.parentComponentNo) === parentComponentNo;
  });
  if (!duplicate) {
    return '';
  }
  const structureText = lineForm.structureType === 'COMPONENT' ? `组件 ${componentNo || '未编号'}` : parentComponentNo ? `子零件 -> ${parentComponentNo}` : '单独零件';
  return `该零件已经存在于当前零件包的相同结构位置：${structureText}`;
});
const sourceBomDiffIssues = computed<BomDiffIssue[]>(() => {
  if (!activeBom.value?.sourceBomId || !sourceBomForDiff.value) {
    return [];
  }
  return buildSourceBomDiffIssues(sourceBomForDiff.value, activeBom.value);
});
const sourceBomDiffReviewByKey = computed(() => new Map(sourceBomDiffReviews.value.map((review) => [review.reviewKey, review])));
const sourceBomDiffReviewedCount = computed(() => sourceBomDiffIssues.value.filter((issue) => isSourceBomDiffReviewed(issue)).length);
const sourceBomDiffText = computed(() => {
  if (!activeBom.value?.sourceBomId) {
    return '';
  }
  const lines = [
    'BOM 差异固定格式清单',
    `来源 BOM：${activeSourceBomName.value}`,
    `当前 BOM：${activeBom.value.bomName} / ${modelBomScopeText(activeBom.value)}`,
    `差异数量：${sourceBomDiffIssues.value.length}`
  ];
  sourceBomDiffIssues.value.forEach((issue, index) => {
    lines.push(`${index + 1}. ${sourceBomDiffStatusLabel(issue)} | ${issue.title} | ${sourceBomDiffIssueDetailPreview(issue, 72)} | 建议：${issue.suggestedAction}`);
  });
  return lines.join('\n');
});

function clampModelBomWorkTableHeight(value: number) {
  return Math.min(modelBomWorkTableHeightLimits.max, Math.max(modelBomWorkTableHeightLimits.min, value));
}

function adjustModelBomWorkTableHeight(key: ModelBomWorkTableKey, delta: number) {
  modelBomWorkTableHeights[key] = clampModelBomWorkTableHeight(modelBomWorkTableHeights[key] + delta);
}

function resetModelBomWorkTableHeight(key: ModelBomWorkTableKey) {
  modelBomWorkTableHeights[key] = modelBomWorkTableDefaultHeights[key];
}

function restoreModelBomWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const rawValue = window.localStorage.getItem(modelBomWorkTableHeightStorageKey);
    if (!rawValue) {
      return;
    }
    const savedHeights = JSON.parse(rawValue) as Partial<Record<ModelBomWorkTableKey, number>>;
    modelBomWorkTableKeys.forEach((key) => {
      const savedHeight = Number(savedHeights[key]);
      if (Number.isFinite(savedHeight)) {
        modelBomWorkTableHeights[key] = clampModelBomWorkTableHeight(savedHeight);
      }
    });
  } catch {
    // 本机 UI 偏好读取失败时使用默认高度，不影响 BOM 维护。
  }
}

function saveModelBomWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      modelBomWorkTableHeightStorageKey,
      JSON.stringify({
        list: modelBomWorkTableHeights.list,
        lines: modelBomWorkTableHeights.lines,
        scopeReview: modelBomWorkTableHeights.scopeReview,
        thicknessReview: modelBomWorkTableHeights.thicknessReview,
        sourceDiffFields: modelBomWorkTableHeights.sourceDiffFields,
        sourceDiffReviews: modelBomWorkTableHeights.sourceDiffReviews
      })
    );
  } catch {
    // 本机 UI 偏好写入失败不阻断 BOM 查询、复制或明细维护。
  }
}

onMounted(() => {
  restoreModelBomWorkTableHeights();
  applyRouteQueryFilters();
  void loadModelBoms();
  void loadCustomerOptions();
  void loadProcessDefinitions();
});

watch(
  () => modelBomWorkTableKeys.map((key) => modelBomWorkTableHeights[key]),
  () => saveModelBomWorkTableHeights()
);

watch(
  () => activeBom.value?.sourceBomId || '',
  (sourceBomId) => {
    void loadSourceBomForDiff(sourceBomId);
  },
  { immediate: true }
);

watch(
  () => activeBom.value?.id || '',
  (bomId) => {
    bomRevisionPagination.offset = Number(0);
    void loadBomRevisions(bomId);
  },
  { immediate: true }
);

watch(
  () => [activeBom.value?.id || '', activeBom.value?.sourceBomId || ''],
  () => {
    void loadSourceBomDiffReviews();
  },
  { immediate: true }
);

watch(
  () => [
    lineForm.materialStatus,
    lineForm.structureType,
    lineForm.parentComponentNo,
    lineFormParentComponent.value?.status || ''
  ],
  () => {
    if (lineForm.status === 'ENABLED' && lineFormEnableStatusDisabled.value) {
      lineForm.status = 'DISABLED';
    }
  }
);

watch(
  () => bomForm.status,
  (status) => {
    if (status === 'DISABLED' && bomForm.isCommon) {
      bomForm.isCommon = false;
    }
  }
);

watch(
  () => [bomForm.customerScope, bomForm.customerId, normalizedBomCustomerIds(bomForm.customerIds).join(','), bomForm.projectModel],
  () => {
    if (bomForm.id) {
      bomCustomerScopeChangeConfirmed.value = false;
    }
  }
);

watch(
  () => lineDialogVisible.value,
  (visible) => {
    if (!visible) {
      thicknessReviewLineId.value = '';
    }
  }
);

watch(
  () => [
    route.query.keyword,
    route.query.customerId,
    route.query.projectModel,
    route.query.scopeMode,
    route.query.commonOnly,
    route.query.isCommon,
    route.query.excludeGlobalAllProject,
    route.query.status,
    route.query.bomId,
    route.query.lineId,
    route.query.action,
    route.query.bomName,
    route.query.lineStructure,
    route.query.parentComponentNo,
    route.query.materialId,
    route.query.materialKeyword,
    route.query.materialStatus
  ],
  async () => {
    applyRouteQueryFilters();
    modelBomPagination.page = Number(1);
    await loadModelBoms();
  }
);

function routeQueryText(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
}

function returnFromModelBom() {
  // 只接受白名单返回路径，避免外部 query 影响前端导航目标。
  void router.push(modelBomReturnPath.value);
}

function routeLineStructure(value: string): BomLineStructureType {
  if (value === 'COMPONENT' || value === 'CHILD_PART') {
    return value;
  }
  return 'STANDALONE_PART';
}

function routeTargetLineStructureLabel() {
  if (lineForm.structureType === 'COMPONENT') {
    return '组件';
  }
  if (lineForm.structureType === 'CHILD_PART') {
    return '组件子零件';
  }
  return '单独零件';
}

function applyRouteQueryFilters() {
  const keyword = routeQueryText(route.query.keyword);
  const customerId = routeQueryText(route.query.customerId);
  const projectModel = routeQueryText(route.query.projectModel);
  const scopeMode = routeQueryText(route.query.scopeMode);
  const commonOnly = routeQueryText(route.query.commonOnly);
  const isCommon = routeQueryText(route.query.isCommon);
  const excludeGlobalAllProject = routeQueryText(route.query.excludeGlobalAllProject);
  const status = routeQueryText(route.query.status);
  const bomId = routeQueryText(route.query.bomId);
  const lineId = routeQueryText(route.query.lineId);
  const action = routeQueryText(route.query.action);
  const materialId = routeQueryText(route.query.materialId);
  const materialKeyword = routeQueryText(route.query.materialKeyword);
  const materialStatus = routeQueryText(route.query.materialStatus);
  const lineStructure = routeQueryText(route.query.lineStructure);
  const parentComponentNo = routeQueryText(route.query.parentComponentNo);
  const bomName = routeQueryText(route.query.bomName);
  const nextRouteTargetKey = [
    keyword,
    customerId,
    projectModel,
    scopeMode,
    commonOnly,
    isCommon,
    excludeGlobalAllProject,
    status,
    bomId,
    lineId,
    action,
    bomName,
    lineStructure,
    parentComponentNo,
    materialId,
    materialKeyword,
    materialStatus
  ].join('|');
  if (nextRouteTargetKey !== routeTargetKey.value) {
    routeTargetKey.value = nextRouteTargetKey;
    routeTargetActionApplied.value = false;
    routeTargetBomManuallySelected.value = false;
    routeTargetMultipleBomChoiceWarned.value = false;
  }
  filters.keyword = keyword;
  filters.customerId = customerId;
  filters.projectModel = projectModel;
  filters.scopeMode = scopeMode === 'ALL' || scopeMode === 'PRIVATE' || scopeMode === 'SELECTED' ? scopeMode : '';
  filters.commonOnly = commonOnly === 'true';
  filters.excludeGlobalAllProject = excludeGlobalAllProject === 'true';
  filters.status = status === 'ENABLED' || status === 'DISABLED' || status === 'ALL' ? status : 'ENABLED';
  if (!customerId) {
    selectedCustomerName.value = '';
  }
  routeTargetBomId.value = bomId;
  routeTargetLineId.value = lineId;
  routeTargetAction.value = action;
  routeTargetMaterialId.value = materialId;
  routeTargetMaterialKeyword.value = materialKeyword;
  routeTargetMaterialStatus.value = materialStatus === 'DISABLED' ? 'DISABLED' : 'ENABLED';
  routeTargetLineStructure.value = routeLineStructure(lineStructure);
  routeTargetParentComponentNo.value = normalizeComponentNo(parentComponentNo);
  highlightedBomLineId.value = lineId;
  if (bomId) {
    activeBomId.value = bomId;
  }
}

async function loadModelBoms() {
  loading.value = true;
  try {
    const requestPage = Math.max(modelBomPagination.page, 1);
    const requestLimit = modelBomPagination.limit;
    const requestOffset = (requestPage - 1) * requestLimit;
    const baseFilters = {
      keyword: filters.keyword.trim() || undefined,
      customerId: filters.customerId || undefined,
      projectModel: filters.projectModel.trim() || undefined,
      excludeGlobalAllProject: filters.excludeGlobalAllProject || undefined,
      status: filters.status
    };
    const listFilters = {
      ...baseFilters,
      commonOnly: filters.commonOnly || undefined,
      scopeMode: filters.scopeMode || undefined,
      limit: requestLimit,
      offset: requestOffset
    };
    let result = await erpApi.modelBomsPage(listFilters);
    if (result.totalCount > 0 && result.items.length === 0 && requestPage > 1) {
      modelBomPagination.page = Math.max(Math.ceil(result.totalCount / requestLimit), 1);
      result = await erpApi.modelBomsPage({
        ...listFilters,
        offset: (modelBomPagination.page - 1) * requestLimit
      });
    }
    modelBoms.value = result.items;
    modelBomPagination.total = result.totalCount;
    modelBomScopeSummaryTotals.value = result.scopeSummary;
    if (routeTargetBomId.value && !modelBoms.value.some((item) => item.id === routeTargetBomId.value)) {
      await appendRouteTargetBom(routeTargetBomId.value);
    }
    if (routeTargetBomId.value && modelBoms.value.some((item) => item.id === routeTargetBomId.value)) {
      activeBomId.value = routeTargetBomId.value;
    }
    if (!activeBomId.value || !modelBoms.value.some((item) => item.id === activeBomId.value)) {
      activeBomId.value = modelBoms.value[0]?.id || '';
    }
    if (activeBomId.value) {
      await loadActiveBomDetail(activeBomId.value);
      void loadBomRevisions(activeBomId.value);
    } else {
      activeBomDetail.value = null;
    }
    selectRouteCreateLineTargetBom();
    await focusRouteTargetLine();
    await openRouteTargetCreateBomDialog();
    await openRouteTargetCopyBomDialog();
    await openRouteTargetCreateLineDialog();
  } catch (error) {
    modelBoms.value = [];
    modelBomPagination.total = Number(0);
    modelBomScopeSummaryTotals.value = emptyModelBomScopeSummary();
    activeBomId.value = '';
    activeBomDetail.value = null;
    ElMessage.error(error instanceof Error ? error.message : '机型零件包加载失败，请确认后端服务和筛选条件');
  } finally {
    loading.value = false;
  }
}

function modelBomExportFilters() {
  return {
    keyword: filters.keyword.trim() || undefined,
    customerId: filters.customerId || undefined,
    projectModel: filters.projectModel.trim() || undefined,
    scopeMode: filters.scopeMode || undefined,
    excludeGlobalAllProject: filters.excludeGlobalAllProject || undefined,
    commonOnly: filters.commonOnly || undefined,
    status: filters.status
  };
}

async function exportModelBomsExcel() {
  if (modelBomExporting.value) {
    return;
  }
  modelBomExporting.value = true;
  try {
    await erpApi.downloadModelBomsExport(modelBomExportFilters(), `机型零件包_${formatFileDateTime()}.xlsx`);
    ElMessage.success('机型零件包 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '机型零件包导出失败，请稍后重试');
  } finally {
    modelBomExporting.value = false;
  }
}

async function exportSourceBomDiffReviewsExcel() {
  const bom = activeBom.value;
  const sourceBomId = bom?.sourceBomId || sourceBomForDiff.value?.id || '';
  if (sourceBomDiffReviewExporting.value || !bom?.id || !sourceBomId) {
    return;
  }
  sourceBomDiffReviewExporting.value = true;
  try {
    await erpApi.downloadModelBomDiffReviewsExport(
      bom.id,
      sourceBomId,
      `BOM差异核对_${bom.bomName}_${formatFileDateTime()}.xlsx`
    );
    ElMessage.success('BOM 差异核对记录 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'BOM 差异核对记录导出失败，请稍后重试');
  } finally {
    sourceBomDiffReviewExporting.value = false;
  }
}

function searchModelBoms() {
  modelBomPagination.page = Number(1);
  void loadModelBoms();
}

function handleModelBomPageChange(page: number) {
  modelBomPagination.page = page;
  void loadModelBoms();
}

async function loadActiveBomDetail(bomId = activeBomId.value) {
  const targetBomId = String(bomId || '').trim();
  if (!targetBomId) {
    activeBomDetail.value = null;
    return null;
  }
  const requestSeq = ++activeBomDetailRequestSeq;
  activeBomDetailLoading.value = true;
  try {
    const detail = await erpApi.modelBom(targetBomId);
    if (requestSeq === activeBomDetailRequestSeq && activeBomId.value === targetBomId) {
      activeBomDetail.value = detail;
      modelBoms.value = modelBoms.value.map((item) => (item.id === detail.id ? { ...item, ...detail } : item));
    }
    return detail;
  } catch (error) {
    if (requestSeq === activeBomDetailRequestSeq && activeBomId.value === targetBomId) {
      activeBomDetail.value = null;
      ElMessage.error(error instanceof Error ? error.message : '零件包详情加载失败，请刷新后重试');
    }
    return null;
  } finally {
    if (requestSeq === activeBomDetailRequestSeq) {
      activeBomDetailLoading.value = false;
    }
  }
}

async function appendRouteTargetBom(bomId: string) {
  try {
    const target = await erpApi.modelBom(bomId);
    modelBoms.value = [target, ...modelBoms.value.filter((item) => item.id !== target.id)];
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '未能定位零件管理传入的 BOM');
  }
}

function ensureModelBomVisible(bom: ModelBom) {
  modelBoms.value = [bom, ...modelBoms.value.filter((item) => item.id !== bom.id)];
  activeBomId.value = bom.id;
  void loadBomRevisions(bom.id);
}

function syncModelBomFiltersToSavedBom(bom: ModelBom) {
  filters.keyword = '';
  filters.customerId = bom.customerId || '';
  selectedCustomerName.value = bom.customerName || '';
  filters.projectModel = bom.projectModel;
  filters.scopeMode = modelBomScopeMode(bom);
  filters.commonOnly = false;
  filters.status = bom.status;
  modelBomPagination.page = Number(1);
}

function handleSelectedCustomerChange(customer?: Customer) {
  selectedCustomerName.value = customer?.customerName || '';
}

function selectedCustomerFilterLabel() {
  if (!filters.customerId) {
    return '全部';
  }
  return selectedCustomerName.value || '已选客户';
}

function modelBomKeywordFilterLabel() {
  return filters.keyword.trim() || '无';
}

function modelBomScopeFilterLabel() {
  if (filters.scopeMode === 'ALL') {
    return '全部客户通用';
  }
  if (filters.scopeMode === 'PRIVATE') {
    return '客户私有';
  }
  if (filters.scopeMode === 'SELECTED') {
    return '指定客户可用';
  }
  return '全部范围';
}

function applyModelBomScopeFilter(scopeMode: 'ALL' | 'PRIVATE' | 'SELECTED') {
  filters.scopeMode = filters.scopeMode === scopeMode ? '' : scopeMode;
  searchModelBoms();
}

function applyModelBomCommonFilter() {
  filters.commonOnly = !filters.commonOnly;
  searchModelBoms();
}

function modelBomCommonFilterLabel() {
  return filters.commonOnly ? '只看常用' : '全部';
}

function modelBomGlobalAllProjectFilterLabel() {
  return filters.excludeGlobalAllProject ? '排除全部客户/全部机型泛用包' : '包含';
}

function modelBomStatusFilterLabel() {
  if (filters.status === 'ALL') {
    return '全部';
  }
  return filters.status === 'ENABLED' ? '启用' : '停用';
}

function normalizeRouteScopeText(value?: string | null) {
  return String(value || '').trim().toLocaleLowerCase();
}

function isRouteCreateLineAction() {
  return routeTargetAction.value === 'createLine' && Boolean(routeTargetMaterialId.value) && !routeTargetBomId.value;
}

function isExactRouteCreateLineBom(row: ModelBom) {
  if (!isRouteCreateLineAction()) {
    return false;
  }
  const requestedCustomerId = filters.customerId;
  if (requestedCustomerId ? row.customerId !== requestedCustomerId : Boolean(row.customerId)) {
    return false;
  }
  const requestedProjectModel = filters.projectModel.trim();
  if (requestedProjectModel && normalizeRouteScopeText(row.projectModel) !== normalizeRouteScopeText(requestedProjectModel)) {
    return false;
  }
  if (!requestedProjectModel && normalizeRouteScopeText(row.projectModel)) {
    return false;
  }
  return true;
}

function selectRouteCreateLineTargetBom() {
  if (!isRouteCreateLineAction()) {
    return;
  }
  const exactBoms = routeCreateLineExactBoms();
  if (exactBoms.length === 1) {
    activeBomId.value = exactBoms[0].id;
  }
}

function routeCreateLineExactBoms() {
  return isRouteCreateLineAction() ? modelBoms.value.filter(isExactRouteCreateLineBom) : [];
}

function routeCreateLineNeedsManualBomChoice() {
  return !routeTargetBomId.value && routeCreateLineExactBoms().length > 1 && !routeTargetBomManuallySelected.value;
}

function routeCreateLineNeedsNewScopedBom(row?: ModelBom) {
  if (!isRouteCreateLineAction()) {
    return false;
  }
  const requestedCustomerId = filters.customerId;
  if (requestedCustomerId && row?.customerId !== requestedCustomerId) {
    return true;
  }
  if (!requestedCustomerId && row?.customerId) {
    return true;
  }
  const requestedProjectModel = filters.projectModel.trim();
  if (!requestedProjectModel) {
    return Boolean(normalizeRouteScopeText(row?.projectModel));
  }
  return normalizeRouteScopeText(row?.projectModel) !== normalizeRouteScopeText(requestedProjectModel);
}

function routeCreateLineNewBomMessage(row?: ModelBom) {
  if (filters.customerId && !row?.customerId) {
    return '当前是客户范围，需先保存客户独立 BOM，避免把客户零件写入百胜通用 BOM';
  }
  return '请先保存当前范围的零件包，保存后会继续添加当前零件明细';
}

function currentCustomerBomForSource(row: ModelBom) {
  if (!filters.customerId || !isAllCustomerBom(row)) {
    return undefined;
  }
  const targetProjectModel = normalizeRouteScopeText(filters.projectModel.trim() || row.projectModel);
  return modelBoms.value.find(
    (item) => item.customerId === filters.customerId && normalizeRouteScopeText(item.projectModel) === targetProjectModel
  );
}

function canCopyModelBomToCurrentCustomer(row: ModelBom) {
  return isAllCustomerBom(row);
}

function openCurrentCustomerBom(row: ModelBom) {
  const customerBom = currentCustomerBomForSource(row);
  if (!customerBom) {
    return;
  }
  activeBomId.value = customerBom.id;
  highlightedBomLineId.value = '';
  ElMessage.info('当前客户和机型已存在客户 BOM，已定位到现有 BOM，请继续维护');
}

async function findExistingCustomerBomForCopy(customerId: string, projectModel: string) {
  const existing = await findExistingModelBomForScope(customerId, projectModel);
  return existing?.customerId ? existing : undefined;
}

async function loadModelBomScopePages(filters: Parameters<typeof erpApi.modelBomsPage>[0]) {
  const rows: ModelBom[] = [];
  const pageLimit = Number(100);
  let offset = Number(filters?.offset || 0);
  let hasMore = true;
  while (hasMore) {
    const result = await erpApi.modelBomsPage({
      ...filters,
      limit: pageLimit,
      offset
    });
    rows.push(...result.items);
    hasMore = result.hasMore && result.items.length > 0;
    offset = result.offset + result.items.length;
  }
  return rows;
}

async function findExistingModelBomForScope(customerId: string, projectModel: string) {
  const normalizedProjectModel = normalizeRouteScopeText(projectModel);
  const cached = modelBoms.value.find((item) => {
    const customerMatched = customerId ? item.customerId === customerId : !item.customerId;
    return customerMatched && normalizeRouteScopeText(item.projectModel) === normalizedProjectModel;
  });
  if (cached) {
    return cached;
  }
  const rows = await loadModelBomScopePages({ customerId: customerId || undefined, projectModel, status: 'ALL' });
  return rows.find((item) => {
    const customerMatched = customerId ? item.customerId === customerId : !item.customerId;
    return customerMatched && normalizeRouteScopeText(item.projectModel) === normalizedProjectModel;
  });
}

async function guardDuplicateCustomerBomCopy(customerId: string, projectModel: string) {
  void customerId;
  void projectModel;
  // 同一客户同一机型允许保留多个不同用途 BOM；复制时只保留同名查重。
  return false;
}

async function guardExistingBomBeforeRouteCreateLine() {
  if (!isRouteCreateLineAction()) {
    return false;
  }
  const existing =
    routeTargetBomManuallySelected.value && activeBom.value && isExactRouteCreateLineBom(activeBom.value)
      ? activeBom.value
      : await findExistingModelBomForScope(filters.customerId, filters.projectModel.trim());
  if (!existing || existing.id === activeBom.value?.id) {
    return false;
  }
  routeTargetActionApplied.value = true;
  ensureModelBomVisible(existing);
  if (existing.status === 'DISABLED') {
    ElMessage.warning('当前范围已有停用 BOM，已定位到现有 BOM；请先启用后再添加明细，避免重复新建');
    return true;
  }
  openLineCreateDialog(routeTargetLineStructure.value, routeTargetParentComponentNo.value);
  applyRouteTargetMaterialToLineForm();
  ElMessage.info('当前范围已存在 BOM，已定位并继续添加当前零件明细');
  return true;
}

async function guardDuplicateBomScopeBeforeSave(customerId: string, projectModel: string, currentBomId = '') {
  void customerId;
  void projectModel;
  void currentBomId;
  // 同一客户同一机型可以保存多个 BOM，禁止范围级别拦截；后端仍按同名 + 范围查重。
  return false;
}

async function focusRouteTargetLine() {
  if (!routeTargetLineId.value) {
    return;
  }
  if (!activeBomHasRouteTargetLine.value) {
    if (routeTargetAction.value === 'editLine' && !routeTargetActionApplied.value) {
      routeTargetActionApplied.value = true;
      ElMessage.warning('未找到要核对的 BOM 明细，可能已被停用或不在当前零件包内；请在列表中重新选择需要维护的行。');
    }
    return;
  }
  await focusBomLine(routeTargetLineId.value);
  await openRouteTargetLineEditDialog();
}

async function focusBomLine(lineId: string) {
  if (!lineId) {
    return;
  }
  highlightedBomLineId.value = lineId;
  await nextTick();
  const target = document.querySelector(`[data-bom-line-id="${lineId}"]`);
  if (target instanceof HTMLElement) {
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
}

async function openRouteTargetLineEditDialog() {
  if (routeTargetAction.value !== 'editLine' || routeTargetActionApplied.value || lineDialogVisible.value || isMobileViewport()) {
    return;
  }
  const targetLine = activeBom.value?.lines.find((line) => line.id === routeTargetLineId.value);
  if (targetLine) {
    routeTargetActionApplied.value = true;
    await openLineEditDialog(targetLine);
  }
}

async function openRouteTargetCreateBomDialog() {
  if (routeTargetAction.value !== 'createBom' || routeTargetActionApplied.value || bomDialogVisible.value || isMobileViewport()) {
    return;
  }
  routeTargetActionApplied.value = true;
  prefillBomCreateFormFromRoute();
  await nextTick();
  bomDialogVisible.value = true;
}

async function openRouteTargetCopyBomDialog() {
  if (routeTargetAction.value !== 'copyBom' || routeTargetActionApplied.value || copyDialogVisible.value || isMobileViewport()) {
    return;
  }
  const sourceBom = modelBoms.value.find((item) => item.id === routeTargetBomId.value) || activeBom.value;
  if (!sourceBom) {
    return;
  }
  routeTargetActionApplied.value = true;
  if (!isAllCustomerBom(sourceBom)) {
    ElMessage.warning('当前阶段只允许从全部客户通用零件包复制为客户私有 BOM');
    return;
  }
  const targetCustomerId = filters.customerId;
  const targetProjectModel = filters.projectModel.trim() || sourceBom.projectModel;
  if (targetCustomerId && (await guardDuplicateCustomerBomCopy(targetCustomerId, targetProjectModel))) {
    return;
  }
  prefillCopyFormFromSourceBom(sourceBom, filters.customerId, routeQueryText(route.query.bomName));
  await nextTick();
  copyDialogVisible.value = true;
}

async function openRouteTargetCreateLineDialog() {
  if (routeTargetAction.value !== 'createLine' || routeTargetActionApplied.value || lineDialogVisible.value || isMobileViewport()) {
    return;
  }
  if (!routeTargetMaterialId.value) {
    return;
  }
  if (routeCreateLineNeedsManualBomChoice()) {
    if (!routeTargetMultipleBomChoiceWarned.value) {
      ElMessage.warning('当前客户/机型范围存在多个 BOM，请先点击要加入的 BOM 的“查看明细”；系统不会自动选择，避免加错 BOM。');
      routeTargetMultipleBomChoiceWarned.value = true;
    }
    return;
  }
  if (await guardExistingBomBeforeRouteCreateLine()) {
    return;
  }
  routeTargetActionApplied.value = true;
  if (activeBom.value?.status === 'DISABLED') {
    ElMessage.warning('当前 BOM 已停用，请先启用后再添加明细');
    return;
  }
  if (!activeBom.value || routeCreateLineNeedsNewScopedBom(activeBom.value)) {
    prefillBomCreateFormFromCurrentFilters(routeQueryText(route.query.bomName));
    await nextTick();
    bomDialogVisible.value = true;
    ElMessage.info(routeCreateLineNewBomMessage(activeBom.value));
    return;
  }
  openLineCreateDialog(routeTargetLineStructure.value, routeTargetParentComponentNo.value);
  applyRouteTargetMaterialToLineForm();
}

function applyRouteTargetMaterialToLineForm() {
  if (!routeTargetMaterialId.value) {
    return;
  }
  lineForm.materialId = routeTargetMaterialId.value;
  lineForm.materialKeyword = routeTargetMaterialKeyword.value || filters.keyword.trim();
  lineForm.selectedMaterialKeyword = lineForm.materialKeyword;
  lineForm.materialStatus = routeTargetMaterialStatus.value;
  if (lineForm.materialStatus === 'DISABLED') {
    lineForm.status = 'DISABLED';
  }
  void loadLineDrawingRevisions(routeTargetMaterialId.value);
}

function prefillBomCreateFormFromRoute() {
  prefillBomCreateFormFromCurrentFilters(routeQueryText(route.query.bomName), routeCreateBomDefaultCommon());
}

function routeCreateBomDefaultCommon() {
  return filters.commonOnly || routeQueryText(route.query.isCommon) === 'true';
}

function prefillBomCreateFormFromCurrentFilters(bomName = '', defaultCommon = routeCreateBomDefaultCommon()) {
  resetBomForm();
  const projectModel = filters.projectModel.trim();
  bomForm.customerScope = filters.customerId ? 'PRIVATE' : 'ALL';
  originalBomCustomerScope.value = bomForm.customerScope;
  originalBomScopeCustomerIds.value = [];
  confirmedBomCustomerScope.value = bomForm.customerScope;
  bomCustomerScopeChangeConfirmed.value = false;
  bomForm.customerId = filters.customerId;
  bomForm.customerIds = filters.customerId ? [filters.customerId] : [];
  bomForm.projectModel = projectModel;
  bomForm.bomName = bomName.trim() || defaultRouteBomName(projectModel, Boolean(filters.customerId));
  bomForm.isCommon = defaultCommon;
  bomForm.status = 'ENABLED';
}

function defaultRouteBomName(projectModel: string, isCustomerBom: boolean) {
  if (!projectModel) {
    return isCustomerBom ? '客户通用零件包' : '百胜通用零件包';
  }
  return `${projectModel} ${isCustomerBom ? '客户零件包' : '百胜通用零件包'}`;
}

async function loadBomRevisions(bomId = activeBom.value?.id || '', append = false) {
  bomRevisionLoading.value = true;
  if (!append) {
    bomRevisionPagination.offset = Number(0);
    bomRevisions.value = [];
    bomRevisionPagination.total = Number(0);
  }
  if (!bomId) {
    bomRevisionLoading.value = false;
    return;
  }
  const requestOffset = append ? bomRevisions.value.length : bomRevisionPagination.offset;
  try {
    const result = await erpApi.modelBomRevisions(bomId, {
      limit: bomRevisionPagination.limit,
      offset: requestOffset
    });
    if (activeBom.value?.id === bomId) {
      const nextItems = append
        ? [
            ...bomRevisions.value,
            ...result.items.filter((item) => !bomRevisions.value.some((existing) => existing.id === item.id))
          ]
        : result.items;
      bomRevisions.value = nextItems;
      bomRevisionPagination.total = result.totalCount;
      bomRevisionPagination.offset = nextItems.length;
    }
  } catch (error) {
    if (activeBom.value?.id === bomId) {
      if (!append) {
        bomRevisions.value = [];
        bomRevisionPagination.total = Number(0);
      }
      ElMessage.warning(error instanceof Error ? error.message : 'BOM 版本记录加载失败');
    }
  } finally {
    if (activeBom.value?.id === bomId) {
      bomRevisionLoading.value = false;
    }
  }
}

function loadMoreBomRevisions() {
  const bomId = activeBom.value?.id || '';
  if (!bomId || bomRevisionLoading.value || !bomRevisionHasMore.value) {
    return;
  }
  void loadBomRevisions(bomId, true);
}

function openBomRevisionDetail(row: ModelBomRevision) {
  selectedBomRevision.value = row;
  bomRevisionDetailDialogVisible.value = true;
}

async function loadSourceBomForDiff(sourceBomId: string) {
  const requestSeq = sourceBomDiffRequestSeq.value + 1;
  sourceBomDiffRequestSeq.value = requestSeq;
  sourceBomForDiff.value = null;
  sourceBomDiffLoading.value = false;
  if (!sourceBomId) {
    return;
  }
  const cached = modelBoms.value.find((item) => item.id === sourceBomId);
  if (cached) {
    if (sourceBomDiffRequestSeq.value === requestSeq) {
      sourceBomForDiff.value = cached;
    }
    return;
  }
  sourceBomDiffLoading.value = true;
  try {
    const sourceBom = await erpApi.modelBom(sourceBomId);
    // BOM 差异核对只允许当前选中 BOM 的来源请求写回，避免快速切换时旧响应覆盖当前差异。
    if (sourceBomDiffRequestSeq.value === requestSeq && activeBom.value?.sourceBomId === sourceBomId) {
      sourceBomForDiff.value = sourceBom;
    }
  } catch (error) {
    if (sourceBomDiffRequestSeq.value === requestSeq) {
      sourceBomForDiff.value = null;
      ElMessage.warning(error instanceof Error ? error.message : '来源 BOM 差异加载失败，请确认来源 BOM 和后端服务');
    }
  } finally {
    if (sourceBomDiffRequestSeq.value === requestSeq) {
      sourceBomDiffLoading.value = false;
    }
  }
}

async function loadSourceBomDiffReviews(options: { append?: boolean } = {}) {
  const requestSeq = sourceBomDiffReviewRequestSeq.value + 1;
  sourceBomDiffReviewRequestSeq.value = requestSeq;
  if (!options.append) {
    sourceBomDiffReviews.value = [];
    sourceBomReviewedDiffKeys.value = new Set();
    sourceBomDiffReviewPagination.offset = Number(0);
    sourceBomDiffReviewPagination.total = Number(0);
  }
  const bom = activeBom.value;
  if (!bom?.id || !bom.sourceBomId) {
    sourceBomDiffReviewLoading.value = false;
    return;
  }
  sourceBomDiffReviewLoading.value = true;
  const requestOffset = options.append ? sourceBomDiffReviews.value.length : 0;
  try {
    const result = await erpApi.modelBomDiffReviewsPage(bom.id, {
      sourceBomId: bom.sourceBomId,
      limit: sourceBomDiffReviewPagination.limit,
      offset: requestOffset,
      withPage: true
    });
    if (
      sourceBomDiffReviewRequestSeq.value === requestSeq &&
      activeBom.value?.id === bom.id &&
      activeBom.value?.sourceBomId === bom.sourceBomId
    ) {
      const nextItems = options.append
        ? [
            ...sourceBomDiffReviews.value,
            ...result.items.filter((item) => !sourceBomDiffReviews.value.some((existing) => existing.id === item.id))
          ]
        : result.items;
      sourceBomDiffReviews.value = nextItems;
      sourceBomReviewedDiffKeys.value = new Set(result.reviewKeys);
      sourceBomDiffReviewPagination.total = result.totalCount;
      sourceBomDiffReviewPagination.offset = nextItems.length;
    }
  } catch (error) {
    if (sourceBomDiffReviewRequestSeq.value === requestSeq) {
      if (!options.append) {
        sourceBomDiffReviews.value = [];
        sourceBomReviewedDiffKeys.value = new Set();
        sourceBomDiffReviewPagination.offset = Number(0);
        sourceBomDiffReviewPagination.total = Number(0);
      }
      ElMessage.warning(error instanceof Error ? error.message : 'BOM 差异核对记录加载失败，请确认当前 BOM 和后端服务');
    }
  } finally {
    if (sourceBomDiffReviewRequestSeq.value === requestSeq) {
      sourceBomDiffReviewLoading.value = false;
    }
  }
}

function loadMoreSourceBomDiffReviews() {
  if (sourceBomDiffReviewLoading.value || !sourceBomDiffReviewHasMore.value) {
    return;
  }
  void loadSourceBomDiffReviews({ append: true });
}

async function loadProcessDefinitions() {
  try {
    processDefinitions.value = await erpApi.processDefinitions(undefined, 'ENABLED');
  } catch (error) {
    processDefinitions.value = [];
    ElMessage.error(error instanceof Error ? error.message : '标准工序加载失败，BOM 行默认工艺暂不可选');
  }
}

async function loadCustomerOptions() {
  customerOptionsLoading.value = true;
  try {
    // BOM 指定客户范围需要支持全选客户，因此按分页接口连续取完并在界面显示加载数量，避免静默截断。
    const loadedCustomers: Customer[] = [];
    let offset = Number(0);
    let hasMore = true;
    customerOptionsTotal.value = Number(0);
    while (hasMore) {
      const result = await erpApi.customersPage(undefined, 'ENABLED', customerOptionBatchLimit, offset);
      loadedCustomers.push(...result.items);
      customerOptions.value = [...new Map(loadedCustomers.map((customer) => [customer.id, customer])).values()];
      customerOptionsTotal.value = result.totalCount;
      hasMore = result.hasMore && result.items.length > 0;
      offset = result.offset + result.items.length;
    }
  } catch (error) {
    customerOptions.value = [];
    customerOptionsTotal.value = Number(0);
    ElMessage.error(error instanceof Error ? error.message : '客户选项加载失败，请确认后端服务');
  } finally {
    customerOptionsLoading.value = false;
  }
}

async function loadLineDrawingRevisions(materialId: string) {
  if (!materialId) {
    lineDrawingRevisions.value = [];
    return;
  }
  try {
    const response = await erpApi.materialDrawingRevisions(materialId);
    lineDrawingRevisions.value = response.items.filter((item) => item.status === 'ENABLED');
  } catch (error) {
    lineDrawingRevisions.value = [];
    ElMessage.error(error instanceof Error ? error.message : 'BOM 行图纸版本加载失败，请确认零件基础资料和后端服务');
  }
}

function resetFilters() {
  filters.keyword = '';
  filters.customerId = '';
  selectedCustomerName.value = '';
  filters.projectModel = '';
  filters.scopeMode = '';
  filters.commonOnly = false;
  filters.excludeGlobalAllProject = false;
  filters.status = 'ENABLED';
  routeTargetBomId.value = '';
  routeTargetLineId.value = '';
  routeTargetMaterialId.value = '';
  routeTargetMaterialKeyword.value = '';
  routeTargetMaterialStatus.value = 'ENABLED';
  routeTargetLineStructure.value = 'STANDALONE_PART';
  routeTargetParentComponentNo.value = '';
  routeTargetAction.value = '';
  routeTargetKey.value = '';
  routeTargetActionApplied.value = false;
  highlightedBomLineId.value = '';
  searchModelBoms();
}

async function selectBom(row: ModelBom) {
  activeBomId.value = row.id;
  await loadActiveBomDetail(row.id);
  void loadBomRevisions(row.id);
  if (row.id !== routeTargetBomId.value) {
    highlightedBomLineId.value = '';
  }
  if (isRouteCreateLineAction() && !routeTargetBomId.value && isExactRouteCreateLineBom(row)) {
    routeTargetBomManuallySelected.value = true;
    routeTargetMultipleBomChoiceWarned.value = false;
    void nextTick(() => {
      void openRouteTargetCreateLineDialog();
    });
  }
}

async function openBomThicknessReview(row?: ModelBom | null) {
  if (!row) {
    return;
  }
  await selectBom(row);
  thicknessReviewBomId.value = row.id;
  const bom = activeBom.value?.id === row.id ? activeBom.value : row;
  const lines = (bom.lines || []).filter(lineNeedsThicknessReview);
  if (lines.length === 0) {
    ElMessage.info('当前 BOM 没有需要核对厚度的子零件或单独零件');
    return;
  }
  if (lines.length === 1 && !isMobileViewport()) {
    await openThicknessReviewLineEdit(lines[0]);
    return;
  }
  if (isMobileViewport()) {
    ElMessage.info('手机端仅查看厚度核对清单，核对并保存厚度请在电脑端操作');
  }
  thicknessReviewDialogVisible.value = true;
}

async function openThicknessReviewLineEdit(row: ModelBomLine) {
  thicknessReviewDialogVisible.value = false;
  const bomForLine = modelBoms.value.find((item) => item.lines.some((line) => line.id === row.id));
  if (bomForLine) {
    selectBom(bomForLine);
    thicknessReviewBomId.value = bomForLine.id;
  }
  await openLineEditDialog(row, { thicknessReview: true });
}

async function handleThicknessReviewLineAction(row: ModelBomLine) {
  if (!lineNeedsThicknessReview(row)) {
    return;
  }
  if (guardDesktopOperation('核对并保存 BOM 明细厚度')) {
    return;
  }
  await openThicknessReviewLineEdit(row);
}

function remainingThicknessReviewLinesForBom(bomId: string, ignoredLineId = '') {
  const bom = modelBoms.value.find((item) => item.id === bomId);
  return (bom?.lines || []).filter((line) => line.id !== ignoredLineId && lineNeedsThicknessReview(line));
}

async function continueThicknessReviewAfterSave(bomId: string, savedLineId: string) {
  if (!bomId) {
    return;
  }
  const bom = modelBoms.value.find((item) => item.id === bomId);
  const savedLine = bom?.lines.find((line) => line.id === savedLineId);
  if (savedLine && lineNeedsThicknessReview(savedLine)) {
    ElMessage.warning('当前明细厚度仍未确认，请填写厚度并通过“厚度核对”保存到当前 BOM 明细');
    return;
  }
  const remainingLines = remainingThicknessReviewLinesForBom(bomId, savedLineId);
  if (remainingLines.length === 0) {
    return;
  }
  // 多条厚度核对项时，保存一条后继续引导操作员处理剩余项，不自动写入或覆盖任何 BOM 厚度。
  thicknessReviewBomId.value = bomId;
  if (remainingLines.length === 1) {
    ElMessage.info('还有 1 条 BOM 厚度核对项，已打开下一条');
    await openThicknessReviewLineEdit(remainingLines[0]);
    return;
  }
  thicknessReviewDialogVisible.value = true;
  ElMessage.info(`还有 ${remainingLines.length} 条 BOM 厚度核对项`);
}

function resetBomForm() {
  bomForm.id = '';
  bomForm.bomName = '';
  bomForm.customerScope = 'ALL';
  originalBomCustomerScope.value = 'ALL';
  originalBomCustomerId.value = '';
  originalBomScopeCustomerIds.value = [];
  originalBomProjectModel.value = '';
  confirmedBomCustomerScope.value = 'ALL';
  bomCustomerScopeChangeConfirmed.value = false;
  bomForm.customerId = '';
  bomForm.customerIds = [];
  bomForm.projectModel = '';
  bomForm.remark = '';
  bomForm.isCommon = false;
  bomForm.status = 'ENABLED';
  bomScopeCustomerKeyword.value = '';
}

function isMobileViewport() {
  return isMobileLayout.value || (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
}

function showMobileDesktopNotice(actionLabel: string) {
  ElMessage.warning(`手机端仅查看机型零件包，${actionLabel}请在电脑端操作`);
}

function guardDesktopOperation(actionLabel: string) {
  if (!isMobileViewport()) {
    return false;
  }
  showMobileDesktopNotice(actionLabel);
  return true;
}

function warnSavingDialogClose() {
  ElMessage.warning('BOM 正在保存，请等待保存完成');
}

function handleSavingDialogClose(done: () => void) {
  if (saving.value) {
    warnSavingDialogClose();
    return;
  }
  done();
}

function openModelBomConfirmDialog(options: {
  title: string;
  message: string;
  details?: string[];
  confirmButtonText: string;
  confirmButtonType?: ModelBomConfirmButtonType;
}) {
  if (modelBomConfirmResolver) {
    modelBomConfirmResolver(false);
  }
  modelBomConfirmTitle.value = options.title;
  modelBomConfirmMessage.value = options.message;
  modelBomConfirmDetails.value = options.details || [];
  modelBomConfirmButtonText.value = options.confirmButtonText;
  modelBomConfirmButtonType.value = options.confirmButtonType || 'primary';
  modelBomConfirmDialogVisible.value = true;
  return new Promise<boolean>((resolve) => {
    modelBomConfirmResolver = resolve;
  });
}

function resolveModelBomConfirm(confirmed: boolean) {
  const resolver = modelBomConfirmResolver;
  modelBomConfirmResolver = null;
  modelBomConfirmDialogVisible.value = false;
  if (resolver) {
    resolver(confirmed);
  }
}

function cancelModelBomConfirm() {
  resolveModelBomConfirm(false);
}

function acceptModelBomConfirm() {
  resolveModelBomConfirm(true);
}

function handleModelBomConfirmDialogClose(done: () => void) {
  resolveModelBomConfirm(false);
  done();
}

function closeBomDialog() {
  if (saving.value) {
    warnSavingDialogClose();
    return;
  }
  bomDialogVisible.value = false;
}

function closeCopyDialog() {
  if (saving.value) {
    warnSavingDialogClose();
    return;
  }
  copyDialogVisible.value = false;
}

function closeLineDialog() {
  if (saving.value) {
    warnSavingDialogClose();
    return;
  }
  lineDialogVisible.value = false;
}

function openBomCreateDialog() {
  if (guardDesktopOperation('新增零件包')) {
    return;
  }
  prefillBomCreateFormFromCurrentFilters();
  bomDialogVisible.value = true;
}

async function openBomEditDialog(row: ModelBom) {
  if (guardDesktopOperation('编辑零件包')) {
    return;
  }
  let fullRow = row;
  try {
    // 列表只展示客户范围摘要；编辑前重新读取完整 BOM，避免多客户范围被摘要预览影响保存。
    fullRow = await erpApi.modelBom(row.id);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '零件包详情加载失败，请刷新后重试');
    return;
  }
  bomForm.id = fullRow.id;
  bomForm.bomName = fullRow.bomName;
  bomForm.customerScope = modelBomScopeMode(fullRow);
  originalBomCustomerScope.value = bomForm.customerScope;
  originalBomCustomerId.value = fullRow.customerId || '';
  originalBomScopeCustomerIds.value = [...(fullRow.scopeCustomerIds || [])];
  originalBomProjectModel.value = fullRow.projectModel || '';
  confirmedBomCustomerScope.value = bomForm.customerScope;
  bomCustomerScopeChangeConfirmed.value = false;
  bomForm.customerId = fullRow.customerId || '';
  bomForm.customerIds = fullRow.scopeCustomerIds || [];
  bomForm.projectModel = fullRow.projectModel;
  bomForm.remark = fullRow.remark || '';
  bomForm.isCommon = Boolean(fullRow.isCommon);
  bomForm.status = fullRow.status;
  bomScopeApprovalForm.requestedBy = '';
  bomScopeApprovalForm.requestReason = '';
  bomDialogVisible.value = true;
}

function resetCopyForm() {
  copyForm.sourceBomId = '';
  copyForm.sourceBomName = '';
  copyForm.customerId = '';
  copyForm.bomName = '';
  copyForm.projectModel = '';
  copyForm.isCommon = false;
  copyForm.remark = '';
}

function prefillCopyFormFromSourceBom(row: ModelBom, targetCustomerId = '', targetBomName = '') {
  resetCopyForm();
  copyForm.sourceBomId = row.id;
  copyForm.sourceBomName = row.bomName;
  copyForm.customerId = targetCustomerId;
  copyForm.bomName = targetBomName.trim() || `${row.bomName}-客户版`;
  copyForm.projectModel = filters.projectModel.trim() || row.projectModel;
  copyForm.isCommon = Boolean(row.isCommon);
  copyForm.remark = `从 ${row.bomName} 复制生成，复制后独立维护`;
}

function openBomCopyDialog(row: ModelBom) {
  if (guardDesktopOperation('复制零件包')) {
    return;
  }
  if (!isAllCustomerBom(row)) {
    ElMessage.warning('当前阶段只允许从全部客户通用零件包复制为客户私有 BOM');
    return;
  }
  prefillCopyFormFromSourceBom(row, filters.customerId);
  copyDialogVisible.value = true;
}

function handleBomCustomerScopeChange(nextScope: BomCustomerScope) {
  bomCustomerScopeChangeConfirmed.value = false;
  confirmedBomCustomerScope.value = nextScope;
  normalizeBomCustomerScopeFields();
}

function normalizeBomCustomerScopeFields() {
  if (bomForm.customerScope === 'ALL') {
    bomForm.customerId = '';
    bomForm.customerIds = [];
    bomScopeCustomerKeyword.value = '';
  } else if (bomForm.customerScope === 'PRIVATE') {
    bomForm.customerIds = [];
    bomScopeCustomerKeyword.value = '';
  } else if (bomForm.customerId && bomForm.customerIds.length === 0) {
    bomForm.customerIds = [bomForm.customerId];
    bomForm.customerId = '';
  }
}

function bomCustomerScopeBroadens(previousScope: BomCustomerScope, nextScope: BomCustomerScope) {
  return previousScope !== 'ALL' && nextScope === 'ALL';
}

function bomProjectScopeBroadens(previousProjectModel: string, nextProjectModel: string) {
  return Boolean(previousProjectModel.trim()) && !nextProjectModel.trim();
}

function bomProjectScopeText(projectModel: string) {
  return projectModel.trim() || '全部机型/项目';
}

function normalizedBomCustomerIds(customerIds: string[]) {
  return [...new Set(customerIds.map((customerId) => customerId.trim()).filter(Boolean))].sort();
}

function bomVisibleCustomerIds(scope: BomCustomerScope, customerId: string, customerIds: string[]) {
  if (scope === 'PRIVATE') {
    return customerId.trim() ? [customerId.trim()] : [];
  }
  if (scope === 'SELECTED') {
    return normalizedBomCustomerIds(customerIds);
  }
  return [];
}

function bomCustomerScopeExposesNewCustomers(
  previousScope: BomCustomerScope,
  previousCustomerId: string,
  previousCustomerIds: string[],
  nextScope: BomCustomerScope,
  nextCustomerId: string,
  nextCustomerIds: string[]
) {
  if (previousScope === 'ALL' || nextScope === 'ALL') {
    return false;
  }
  const previousCustomerIdSet = new Set(bomVisibleCustomerIds(previousScope, previousCustomerId, previousCustomerIds));
  return bomVisibleCustomerIds(nextScope, nextCustomerId, nextCustomerIds).some((customerId) => !previousCustomerIdSet.has(customerId));
}

function bomCustomerScopeExpansionNeedsConfirmation() {
  return (
    bomCustomerScopeBroadens(originalBomCustomerScope.value, bomForm.customerScope) ||
    bomCustomerScopeExposesNewCustomers(
      originalBomCustomerScope.value,
      originalBomCustomerId.value,
      originalBomScopeCustomerIds.value,
      bomForm.customerScope,
      bomForm.customerId,
      bomForm.customerIds
    ) ||
    bomProjectScopeBroadens(originalBomProjectModel.value, bomForm.projectModel)
  );
}

function bomScopeChangeNeedsReview() {
  if (!bomForm.id) {
    return false;
  }
  if (originalBomCustomerScope.value !== bomForm.customerScope) {
    return true;
  }
  if (originalBomCustomerScope.value === 'PRIVATE' && bomForm.customerScope === 'PRIVATE' && originalBomCustomerId.value !== bomForm.customerId) {
    return true;
  }
  if (originalBomCustomerScope.value === 'SELECTED' && bomForm.customerScope === 'SELECTED') {
    const previous = normalizedBomCustomerIds(originalBomScopeCustomerIds.value).join(',');
    const next = normalizedBomCustomerIds(bomForm.customerIds).join(',');
    if (previous !== next) {
      return true;
    }
  }
  return originalBomProjectModel.value.trim() !== bomForm.projectModel.trim();
}

function bomScopeChangeBroadens() {
  return bomCustomerScopeExpansionNeedsConfirmation();
}

function bomCustomerName(customerId: string) {
  return customerOptions.value.find((customer) => customer.id === customerId)?.customerName || customerId || '-';
}

function bomScopeCustomerText(scope: BomCustomerScope, customerId: string, customerIds: string[]) {
  if (scope === 'ALL') {
    return '全部客户';
  }
  if (scope === 'PRIVATE') {
    return bomCustomerName(customerId);
  }
  const names = normalizedBomCustomerIds(customerIds).map((id) => bomCustomerName(id));
  return names.length ? formatCustomerNamePreview(names) : '未勾选客户';
}

function bomCustomerVisibilityImpactText() {
  if (bomCustomerScopeExpansionNeedsConfirmation()) {
    const addedCustomerNames = addedBomScopeCustomerNames();
    return addedCustomerNames.length ? `新增 ${addedCustomerNames.length} 个客户` : '可见范围扩大';
  }
  const removedCustomerNames = removedBomScopeCustomerNames();
  return removedCustomerNames.length ? `移除 ${removedCustomerNames.length} 个客户` : '可见范围调整';
}

function bomCustomerScopeTypeImpactText() {
  if (
    bomCustomerScopeBroadens(originalBomCustomerScope.value, bomForm.customerScope) ||
    bomCustomerScopeExposesNewCustomers(
      originalBomCustomerScope.value,
      originalBomCustomerId.value,
      originalBomScopeCustomerIds.value,
      bomForm.customerScope,
      bomForm.customerId,
      bomForm.customerIds
    )
  ) {
    return '可见客户增加';
  }
  const removedCustomerNames = removedBomScopeCustomerNames();
  return removedCustomerNames.length ? '可见客户减少' : '可见客户不变';
}

function addedBomScopeCustomerNames() {
  const previousCustomerIdSet = new Set(
    bomVisibleCustomerIds(originalBomCustomerScope.value, originalBomCustomerId.value, originalBomScopeCustomerIds.value)
  );
  const addedCustomerIds = bomVisibleCustomerIds(bomForm.customerScope, bomForm.customerId, bomForm.customerIds).filter(
    (customerId) => !previousCustomerIdSet.has(customerId)
  );
  return customerOptions.value
    .filter((customer) => addedCustomerIds.includes(customer.id))
    .map((customer) => customer.customerName);
}

function removedBomScopeCustomerNames() {
  const nextCustomerIdSet = new Set(bomVisibleCustomerIds(bomForm.customerScope, bomForm.customerId, bomForm.customerIds));
  const removedCustomerIds = bomVisibleCustomerIds(
    originalBomCustomerScope.value,
    originalBomCustomerId.value,
    originalBomScopeCustomerIds.value
  ).filter((customerId) => !nextCustomerIdSet.has(customerId));
  return customerOptions.value
    .filter((customer) => removedCustomerIds.includes(customer.id))
    .map((customer) => customer.customerName);
}

function bomScopeVisibilityText() {
  if (bomForm.customerScope === 'PRIVATE') {
    return customerOptions.value.find((customer) => customer.id === bomForm.customerId)?.customerName || '所选客户';
  }
  if (bomForm.customerScope === 'SELECTED') {
    return `${bomForm.customerIds.length} 个已勾选客户`;
  }
  return '全部客户';
}

function bomCustomerScopeLabel(scope: BomCustomerScope) {
  if (scope === 'ALL') {
    return '全部客户通用';
  }
  return scope === 'SELECTED' ? '指定客户可用' : '客户私有';
}

function openBomScopeChangeReviewDialog() {
  if (bomScopeReviewRows.value.length === 0) {
    return Promise.resolve(true);
  }
  bomScopeReviewDialogVisible.value = true;
  return new Promise<boolean>((resolve) => {
    bomScopeReviewResolver = resolve;
  });
}

function resolveBomScopeReview(confirmed: boolean) {
  const resolver = bomScopeReviewResolver;
  bomScopeReviewResolver = null;
  bomScopeReviewDialogVisible.value = false;
  if (resolver) {
    resolver(confirmed);
  }
}

function bomFormCustomerScopeKey() {
  if (bomForm.customerScope === 'ALL') {
    return 'ALL';
  }
  if (bomForm.customerScope === 'PRIVATE') {
    return bomForm.customerId;
  }
  return `SELECTED:${normalizedBomCustomerIds(bomForm.customerIds).join(',')}`;
}

function bomFormProjectModelScopeKey() {
  return bomForm.projectModel.trim() || 'ALL';
}

function bomScopeApprovalCurrentFormFilters() {
  return {
    bomId: bomForm.id,
    requestedCustomerScopeMode: bomForm.customerScope,
    requestedScopeKey: bomFormCustomerScopeKey(),
    requestedProjectModelScopeKey: bomFormProjectModelScopeKey()
  };
}

function buildBomScopeApprovalPayload(): SaveModelBomPayload {
  return {
    bomName: bomForm.bomName.trim(),
    customerScopeMode: bomForm.customerScope,
    customerId: bomForm.customerScope === 'PRIVATE' ? bomForm.customerId : undefined,
    customerIds: bomForm.customerScope === 'SELECTED' ? bomForm.customerIds : undefined,
    projectModel: bomForm.projectModel.trim() || undefined,
    remark: bomForm.remark.trim() || undefined,
    status: bomForm.status,
    isCommon: bomForm.status === 'DISABLED' ? false : bomForm.isCommon
  };
}

function bomScopeApprovalTargetMatchesCurrentForm(row: ModelBomScopeApprovalRequest) {
  return (
    row.bomId === bomForm.id &&
    row.requestedCustomerScopeMode === bomForm.customerScope &&
    row.requestedScopeKey === bomFormCustomerScopeKey() &&
    row.requestedProjectModelScopeKey === bomFormProjectModelScopeKey()
  );
}

function bomScopeApprovalMatchesCurrentForm(row: ModelBomScopeApprovalRequest) {
  return row.status === 'APPROVED' && !row.usedAt && bomScopeApprovalTargetMatchesCurrentForm(row);
}

function bomScopeApprovalBlocksNewRequest(row: ModelBomScopeApprovalRequest) {
  return (row.status === 'PENDING' || (row.status === 'APPROVED' && !row.usedAt)) && bomScopeApprovalTargetMatchesCurrentForm(row);
}

async function findApprovedBomScopeApprovalForCurrentForm() {
  if (!bomForm.id || !bomCustomerScopeExpansionNeedsConfirmation()) {
    return '';
  }
  const result = await erpApi.modelBomScopeApprovalRequests({
    ...bomScopeApprovalCurrentFormFilters(),
    status: 'APPROVED',
    limit: bomScopeApprovalPageLimit,
    offset: 0
  });
  return result.items.find(bomScopeApprovalMatchesCurrentForm)?.id || '';
}

async function findOpenBomScopeApprovalForCurrentForm() {
  if (!bomForm.id || !bomCustomerScopeExpansionNeedsConfirmation()) {
    return null;
  }
  const statuses: Array<'PENDING' | 'APPROVED'> = ['PENDING', 'APPROVED'];
  for (const status of statuses) {
    const result = await erpApi.modelBomScopeApprovalRequests({
      ...bomScopeApprovalCurrentFormFilters(),
      status,
      limit: bomScopeApprovalPageLimit,
      offset: 0
    });
    const matched = result.items.find(bomScopeApprovalBlocksNewRequest);
    if (matched) {
      return matched;
    }
  }
  return null;
}

async function submitBomScopeApprovalRequest() {
  if (!bomForm.id) {
    return;
  }
  if (!bomScopeApprovalForm.requestedBy.trim()) {
    ElMessage.warning('请填写申请人');
    return;
  }
  if (!bomScopeApprovalForm.requestReason.trim()) {
    ElMessage.warning('请填写申请原因');
    return;
  }
  bomScopeApprovalSubmitting.value = true;
  try {
    const existingRequest = await findOpenBomScopeApprovalForCurrentForm();
    if (existingRequest) {
      bomScopeApprovalFilters.status = existingRequest.status;
      resolveBomScopeReview(false);
      bomScopeApprovalDialogVisible.value = true;
      await loadBomScopeApprovalRequests();
      if (existingRequest.status === 'APPROVED') {
        ElMessage.success('相同范围已有已批准且未使用的 BOM 范围审批申请，请重新保存 BOM。');
      } else {
        ElMessage.warning('相同范围已有待审批的 BOM 范围申请，请等待管理员处理。');
      }
      return;
    }
    await erpApi.createModelBomScopeApprovalRequest(bomForm.id, {
      ...buildBomScopeApprovalPayload(),
      requestedBy: bomScopeApprovalForm.requestedBy.trim(),
      requestReason: bomScopeApprovalForm.requestReason.trim()
    });
    resolveBomScopeReview(false);
    bomScopeApprovalFilters.status = 'PENDING';
    await loadBomScopeApprovalRequests();
    ElMessage.success('BOM 范围扩大申请已提交，管理员批准后再保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'BOM 范围扩大申请提交失败');
  } finally {
    bomScopeApprovalSubmitting.value = false;
  }
}

async function openBomScopeApprovalDialog() {
  if (guardDesktopOperation('审批 BOM 范围申请')) {
    return;
  }
  bomScopeApprovalDialogVisible.value = true;
  await loadBomScopeApprovalRequests();
}

async function loadBomScopeApprovalRequests(options: { append?: boolean } = {}) {
  bomScopeApprovalLoading.value = true;
  try {
    const offset = options.append ? bomScopeApprovalRequests.value.length : 0;
    const result = await erpApi.modelBomScopeApprovalRequests({
      status: bomScopeApprovalFilters.status,
      limit: bomScopeApprovalPageLimit,
      offset
    });
    bomScopeApprovalRequests.value = options.append ? [...bomScopeApprovalRequests.value, ...result.items] : result.items;
    bomScopeApprovalTotal.value = result.totalCount;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'BOM 范围审批申请加载失败');
  } finally {
    bomScopeApprovalLoading.value = false;
  }
}

async function refreshBomScopeApprovalRequests() {
  await loadBomScopeApprovalRequests();
}

async function loadMoreBomScopeApprovalRequests() {
  if (bomScopeApprovalLoading.value || !bomScopeApprovalHasMore.value) {
    return;
  }
  await loadBomScopeApprovalRequests({ append: true });
}

async function reviewBomScopeApprovalRequest(row: ModelBomScopeApprovalRequest, approved: boolean) {
  if (!bomScopeApprovalReviewForm.reviewedBy.trim()) {
    ElMessage.warning('请填写管理员姓名');
    return;
  }
  const action = approved ? 'approve' : 'reject';
  bomScopeApprovalSavingId.value = `${row.id}:${action}`;
  try {
    const payload = {
      reviewedBy: bomScopeApprovalReviewForm.reviewedBy.trim(),
      reviewRemark: bomScopeApprovalReviewForm.reviewRemark.trim() || undefined
    };
    if (approved) {
      await erpApi.approveModelBomScopeApprovalRequest(row.id, payload);
    } else {
      await erpApi.rejectModelBomScopeApprovalRequest(row.id, payload);
    }
    ElMessage.success(approved ? 'BOM 范围申请已批准' : 'BOM 范围申请已驳回');
    await loadBomScopeApprovalRequests();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'BOM 范围审批失败');
  } finally {
    bomScopeApprovalSavingId.value = '';
  }
}

function formatBomScopeApprovalStatus(status: ModelBomScopeApprovalRequest['status']) {
  const labels: Record<ModelBomScopeApprovalRequest['status'], string> = {
    PENDING: '待审批',
    APPROVED: '已批准',
    REJECTED: '已驳回',
    USED: '已使用'
  };
  return labels[status] || status;
}

function bomScopeApprovalStatusTagType(status: ModelBomScopeApprovalRequest['status']) {
  if (status === 'APPROVED') {
    return 'success';
  }
  if (status === 'REJECTED') {
    return 'danger';
  }
  if (status === 'USED') {
    return 'info';
  }
  return 'warning';
}

function formatBomScopeApprovalRequestedScope(row: ModelBomScopeApprovalRequest) {
  const customerText =
    row.requestedCustomerScopeMode === 'ALL'
      ? '全部客户'
      : row.requestedCustomerScopeMode === 'PRIVATE'
        ? row.requestedCustomerNameSnapshot || '指定客户'
        : formatBomScopeApprovalSelectedCustomers(row.requestedCustomerIds);
  return `${customerText} / ${row.requestedProjectModel || '全部机型/项目'}`;
}

function formatBomScopeApprovalRequestedScopePreview(row: ModelBomScopeApprovalRequest) {
  return formatModelBomLongTextPreview(formatBomScopeApprovalRequestedScope(row), 34, '-');
}

function formatBomScopeApprovalRequestedScopeTitle(row: ModelBomScopeApprovalRequest) {
  return formatBomScopeApprovalRequestedScope(row);
}

function formatBomScopeApprovalRequestNoPreview(row: ModelBomScopeApprovalRequest) {
  return formatModelBomLongTextPreview(row.requestNo, 28, '-');
}

function formatBomScopeApprovalRequestNoTitle(row: ModelBomScopeApprovalRequest) {
  return row.requestNo || '-';
}

function formatBomScopeApprovalBomNamePreview(row: ModelBomScopeApprovalRequest) {
  return formatModelBomLongTextPreview(row.bomName, 24, '-');
}

function formatBomScopeApprovalBomNameTitle(row: ModelBomScopeApprovalRequest) {
  return row.bomName || '-';
}

function formatBomScopeApprovalReasonPreview(row: ModelBomScopeApprovalRequest) {
  return formatModelBomLongTextPreview(row.reason, 32, '-');
}

function formatBomScopeApprovalReasonTitle(row: ModelBomScopeApprovalRequest) {
  return row.reason || '-';
}

function formatBomScopeApprovalSelectedCustomers(value: unknown) {
  if (!Array.isArray(value)) {
    return '指定客户';
  }
  const names = value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const row = item as { customerName?: unknown; customerId?: unknown };
      return String(row.customerName || row.customerId || '').trim();
    })
    .filter(Boolean);
  return names.length ? formatCustomerNamePreview(names, '指定客户') : '指定客户';
}

function formatBomScopeApprovalReviewText(row: ModelBomScopeApprovalRequest) {
  if (row.status === 'APPROVED') {
    return `${row.approvedBy || '-'} / ${formatDateTime(row.approvedAt)}`;
  }
  if (row.status === 'REJECTED') {
    return `${row.rejectedBy || '-'} / ${formatDateTime(row.rejectedAt)}`;
  }
  if (row.status === 'USED') {
    return `已用于保存 / ${formatDateTime(row.usedAt)}`;
  }
  return '-';
}

function formatBomScopeApprovalReviewPreview(row: ModelBomScopeApprovalRequest) {
  const reviewText = formatBomScopeApprovalReviewText(row);
  return formatModelBomLongTextPreview(reviewText, 26, '-');
}

function formatBomScopeApprovalReviewTitle(row: ModelBomScopeApprovalRequest) {
  const reviewText = formatBomScopeApprovalReviewText(row);
  const remark = String(row.reviewRemark || '').trim();
  return remark && reviewText !== '-' ? `${reviewText} / ${remark}` : reviewText;
}

function customerSearchParts(customer: Customer) {
  const contactParts = (customer.contacts || []).flatMap((contact) => [contact.contactName, contact.contactPhone, contact.title]);
  return [
    customer.customerName,
    customer.customerCode,
    customer.contactName,
    customer.contactPhone,
    customer.country,
    customer.province,
    customer.state,
    customer.district,
    customer.city,
    customer.detailAddress,
    ...contactParts
  ];
}

function handleBomScopeCustomerSelectFilter(keyword: string) {
  bomScopeCustomerKeyword.value = keyword;
}

function selectAllBomScopeCustomers() {
  if (customerOptionsLoading.value) {
    ElMessage.warning('客户选项仍在加载，请等待加载完成后再全部勾选');
    return;
  }
  bomForm.customerIds = customerOptions.value.map((customer) => customer.id);
}

function selectFilteredBomScopeCustomers() {
  if (customerOptionsLoading.value) {
    ElMessage.warning('客户选项仍在加载，请等待加载完成后再勾选搜索结果');
    return;
  }
  const selected = new Set(bomForm.customerIds);
  for (const customer of bomScopeFilteredCustomerOptions.value) {
    selected.add(customer.id);
  }
  bomForm.customerIds = customerOptions.value.map((customer) => customer.id).filter((customerId) => selected.has(customerId));
}

function removeFilteredBomScopeCustomers() {
  if (customerOptionsLoading.value) {
    ElMessage.warning('客户选项仍在加载，请等待加载完成后再移除搜索结果');
    return;
  }
  const removed = new Set(bomScopeFilteredCustomerOptions.value.map((customer) => customer.id));
  bomForm.customerIds = bomForm.customerIds.filter((customerId) => !removed.has(customerId));
}

function clearBomScopeCustomers() {
  bomForm.customerIds = [];
}

async function saveBom(addFirstLineAfterSave = false) {
  if (guardDesktopOperation('保存零件包')) {
    return;
  }
  if (!bomForm.bomName.trim()) {
    ElMessage.warning('请填写零件包名称');
    return;
  }
  if (bomForm.customerScope === 'PRIVATE' && !bomForm.customerId) {
    ElMessage.warning('请选择客户私有 BOM 的所属客户');
    return;
  }
  if (bomForm.customerScope === 'SELECTED' && bomForm.customerIds.length === 0) {
    ElMessage.warning('请选择至少一个可使用该 BOM 的客户');
    return;
  }
  const isEditing = Boolean(bomForm.id);
  const payloadCustomerId = bomForm.customerScope === 'PRIVATE' ? bomForm.customerId : '';
  const payloadProjectModel = bomForm.projectModel.trim();
  const scopeExpansionNeedsConfirmation = isEditing && bomCustomerScopeExpansionNeedsConfirmation();
  let scopeApprovalRequestId = '';
  if (scopeExpansionNeedsConfirmation) {
    scopeApprovalRequestId = await findApprovedBomScopeApprovalForCurrentForm();
    if (!scopeApprovalRequestId) {
      const confirmed = await openBomScopeChangeReviewDialog();
      if (!confirmed) {
        return;
      }
      return;
    }
  } else if (isEditing && bomScopeChangeNeedsReview() && !bomCustomerScopeChangeConfirmed.value) {
    const confirmed = await openBomScopeChangeReviewDialog();
    if (!confirmed) {
      return;
    }
    bomCustomerScopeChangeConfirmed.value = true;
  }
  if (bomForm.customerScope !== 'SELECTED' && (await guardDuplicateBomScopeBeforeSave(payloadCustomerId, payloadProjectModel, bomForm.id))) {
    return;
  }
  let shouldOpenFirstLineDialog = false;
  saving.value = true;
  try {
    const payload: SaveModelBomPayload = {
      bomName: bomForm.bomName.trim(),
      customerScopeMode: bomForm.customerScope,
      customerId: payloadCustomerId || undefined,
      customerIds: bomForm.customerScope === 'SELECTED' ? bomForm.customerIds : undefined,
      projectModel: payloadProjectModel || undefined,
      remark: bomForm.remark.trim() || undefined,
      status: bomForm.status,
      isCommon: bomForm.status === 'DISABLED' ? false : bomForm.isCommon,
      scopeChangeConfirmed: scopeExpansionNeedsConfirmation ? undefined : bomCustomerScopeChangeConfirmed.value || undefined,
      scopeApprovalRequestId: scopeApprovalRequestId || undefined
    };
    const saved = bomForm.id ? await erpApi.updateModelBom(bomForm.id, payload) : await erpApi.createModelBom(payload);
    bomDialogVisible.value = false;
    syncModelBomFiltersToSavedBom(saved);
    await loadModelBoms();
    ensureModelBomVisible(saved);
    ElMessage.success(
      `${isEditing ? '机型零件包已保存并已定位到当前筛选' : '新增零件包已保存，可继续添加包内明细'}${bomForm.status !== 'DISABLED' && bomForm.isCommon ? '，并已设为常用' : ''}`
    );
    shouldOpenFirstLineDialog = (addFirstLineAfterSave || (routeTargetAction.value === 'createLine' && Boolean(routeTargetMaterialId.value))) && !isEditing;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '机型零件包保存失败，请确认后端服务和客户数据');
  } finally {
    saving.value = false;
  }
  if (shouldOpenFirstLineDialog) {
    await nextTick();
    openLineCreateDialog(routeTargetMaterialId.value ? routeTargetLineStructure.value : 'COMPONENT', routeTargetParentComponentNo.value);
    applyRouteTargetMaterialToLineForm();
  }
}

async function copyBom() {
  if (guardDesktopOperation('确认复制零件包')) {
    return;
  }
  if (!copyForm.sourceBomId) {
    return;
  }
  if (!copyForm.customerId) {
    ElMessage.warning('请选择目标客户');
    return;
  }
  if (!copyForm.bomName.trim()) {
    ElMessage.warning('请填写客户零件包名');
    return;
  }
  if (await guardDuplicateCustomerBomCopy(copyForm.customerId, copyForm.projectModel.trim())) {
    return;
  }
  const confirmed = await confirmCopyBom();
  if (!confirmed) {
    return;
  }
  saving.value = true;
  try {
    const payload: CopyModelBomPayload = {
      customerId: copyForm.customerId,
      bomName: copyForm.bomName.trim(),
      projectModel: copyForm.projectModel.trim() || undefined,
      remark: copyForm.remark.trim() || undefined,
      status: 'ENABLED',
      isCommon: copyForm.isCommon
    };
    const saved = await erpApi.copyModelBom(copyForm.sourceBomId, payload);
    copyDialogVisible.value = false;
    syncModelBomFiltersToSavedBom(saved);
    await loadModelBoms();
    ensureModelBomVisible(saved);
    ElMessage.success(`客户零件包已复制生成${copyForm.isCommon ? '，并已设为常用' : ''}，可继续维护包内明细`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户零件包复制失败，请确认后端服务和客户数据');
  } finally {
    saving.value = false;
  }
}

async function confirmCopyBom() {
  return openModelBomConfirmDialog({
    title: '复制客户零件包',
    message: `确定从 ${copyForm.sourceBomName || '百胜通用 BOM'} 复制生成 ${copyForm.bomName.trim()} 吗？`,
    details: [
      '复制后客户 BOM 独立维护，不会反向修改来源 BOM。',
      '后续来源更新只提示差异，不自动覆盖客户 BOM。',
      copyForm.isCommon ? '复制后会设为目标客户常用 BOM，仅影响显示顺序和推荐优先级。' : ''
    ].filter(Boolean),
    confirmButtonText: '确认复制',
    confirmButtonType: 'warning'
  });
}

async function disableBom(row: ModelBom) {
  if (guardDesktopOperation('停用零件包')) {
    return;
  }
  if (modelBomOperationSavingKey.value) {
    return;
  }
  const operationKey = modelBomOperationKey(row, 'disable');
  modelBomOperationSavingKey.value = operationKey;
  try {
    const confirmed = await confirmDisableBom(row);
    if (!confirmed) {
      return;
    }
    await erpApi.disableModelBom(row.id);
    ElMessage.success('机型零件包已停用');
    await loadModelBoms();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '机型零件包停用失败，请确认后端服务和当前 BOM 状态');
  } finally {
    if (modelBomOperationSavingKey.value === operationKey) {
      modelBomOperationSavingKey.value = '';
    }
  }
}

async function setBomCommon(row: ModelBom, isCommon: boolean) {
  if (guardDesktopOperation(isCommon ? '设置常用零件包' : '取消常用零件包')) {
    return;
  }
  if (isCommon && row.status === 'DISABLED') {
    ElMessage.warning('已停用 BOM 不能设为常用，请先恢复启用');
    return;
  }
  if (modelBomOperationSavingKey.value) {
    return;
  }
  const operationKey = modelBomOperationKey(row, 'common');
  modelBomOperationSavingKey.value = operationKey;
  try {
    if (!(await confirmSetBomCommon(row, isCommon))) {
      return;
    }
    const saved = await erpApi.setModelBomCommon(row.id, isCommon);
    ElMessage.success(isCommon ? '已设为常用零件包' : '已取消常用零件包');
    await loadModelBoms();
    ensureModelBomVisible(saved);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '常用零件包设置失败，请确认后端服务和当前 BOM 状态');
  } finally {
    if (modelBomOperationSavingKey.value === operationKey) {
      modelBomOperationSavingKey.value = '';
    }
  }
}

async function confirmSetBomCommon(row: ModelBom, isCommon: boolean) {
  const actionText = isCommon ? '设为常用' : '取消常用';
  const scopeText = [modelBomScopeTypeLabel(row), modelBomCustomerText(row), row.projectModel || '全部机型/项目'].join(' / ');
  return openModelBomConfirmDialog({
    title: `${actionText} BOM`,
    message: `确定将 ${row.bomName} ${actionText}吗？\n范围：${scopeText}`,
    details: ['常用 BOM 只影响当前范围内的显示顺序和下单推荐优先级，不会修改 BOM 明细、适用客户、订单、生产任务或库存。'],
    confirmButtonText: actionText,
    confirmButtonType: isCommon ? 'warning' : 'info'
  });
}

function startCommonBomDrag(event: DragEvent, row: ModelBom) {
  const scopedRows = modelBomCommonDragRowsForScope(row);
  if (modelBomOperationSavingKey.value || row.status !== 'ENABLED' || !row.isCommon || scopedRows.length <= 1) {
    event.preventDefault();
    return;
  }
  draggedCommonBomId.value = row.id;
  draggedCommonBomScopeKey.value = modelBomCommonScopeKey(row);
  commonBomDragOverId.value = row.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.id);
  }
}

function handleCommonBomDragOver(event: DragEvent, row: ModelBom) {
  if (
    modelBomOperationSavingKey.value ||
    !draggedCommonBomId.value ||
    row.status !== 'ENABLED' ||
    !row.isCommon ||
    modelBomCommonScopeKey(row) !== draggedCommonBomScopeKey.value
  ) {
    return;
  }
  commonBomDragOverId.value = row.id;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

async function dropCommonBom(row: ModelBom) {
  if (modelBomOperationSavingKey.value) {
    endCommonBomDrag();
    return;
  }
  const sourceId = draggedCommonBomId.value;
  const sourceScopeKey = draggedCommonBomScopeKey.value;
  endCommonBomDrag();
  if (!sourceId || row.status !== 'ENABLED' || !row.isCommon || sourceId === row.id) {
    return;
  }
  if (modelBomCommonScopeKey(row) !== sourceScopeKey) {
    ElMessage.warning('常用 BOM 只能在同一客户范围和同一机型/项目范围内拖拽排序');
    return;
  }
  const orderedRows = [...modelBomCommonDragRowsForScope(row)];
  const fromIndex = orderedRows.findIndex((item) => item.id === sourceId);
  const toIndex = orderedRows.findIndex((item) => item.id === row.id);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return;
  }
  const [moved] = orderedRows.splice(fromIndex, 1);
  if (!moved) {
    return;
  }
  orderedRows.splice(toIndex, 0, moved);
  const operationKey = modelBomOperationKey(row, 'common');
  modelBomOperationSavingKey.value = operationKey;
  try {
    await erpApi.reorderModelBomCommon({
      items: orderedRows.map((item, index) => ({ bomId: item.id, commonSortOrder: index + 1 }))
    });
    ElMessage.success('常用 BOM 顺序已保存');
    await loadModelBoms();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '常用 BOM 排序保存失败，请确认后端服务');
  } finally {
    if (modelBomOperationSavingKey.value === operationKey) {
      modelBomOperationSavingKey.value = '';
    }
  }
}

function endCommonBomDrag() {
  draggedCommonBomId.value = '';
  draggedCommonBomScopeKey.value = '';
  commonBomDragOverId.value = '';
}

async function confirmDisableBom(row: ModelBom) {
  const commonNotice = row.isCommon ? '该 BOM 当前为常用，停用后会同时取消常用排序。' : '';
  return openModelBomConfirmDialog({
    title: '停用零件包',
    message: `确定停用零件包 ${row.bomName} 吗？`,
    details: ['停用只影响后续推荐，不会删除历史订单、客户 BOM 副本或包内明细。', commonNotice].filter(Boolean),
    confirmButtonText: '停用',
    confirmButtonType: 'warning'
  });
}

async function deleteBom(row: ModelBom) {
  if (guardDesktopOperation('删除无效零件包')) {
    return;
  }
  if (modelBomOperationSavingKey.value) {
    return;
  }
  const operationKey = modelBomOperationKey(row, 'delete');
  modelBomOperationSavingKey.value = operationKey;
  try {
    const confirmed = await confirmDeleteBom(row);
    if (!confirmed) {
      return;
    }
    const result = await erpApi.deleteModelBom(row.id);
    if (activeBomId.value === row.id) {
      activeBomId.value = '';
    }
    ElMessage.success(
      `已删除无效空 BOM：${result.bomName}，确认明细 ${result.lineCount} 行、适用客户 ${result.customerScopeCount} 个、差异核对 ${result.diffReviewCount} 条`
    );
    await loadModelBoms();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无效 BOM 删除失败，请确认后端服务和当前 BOM 状态');
  } finally {
    if (modelBomOperationSavingKey.value === operationKey) {
      modelBomOperationSavingKey.value = '';
    }
  }
}

async function confirmDeleteBom(row: ModelBom) {
  const scopeText = [
    modelBomScopeTypeLabel(row),
    modelBomCustomerText(row),
    row.projectModel || '全部机型/项目',
    row.lineCount ? `${row.lineCount} 行明细` : '无明细'
  ].filter(Boolean).join(' / ');
  return openModelBomConfirmDialog({
    title: '删除无效 BOM',
    message: `确定永久删除零件包 ${row.bomName} 吗？\n范围：${scopeText}`,
    details: [
      '仅允许删除已停用、无包内明细、无适用客户、无差异核对记录且没有客户副本引用的无效空 BOM。',
      '有明细、客户范围、差异核对记录或客户副本引用时，后端会阻断物理删除，请改为停用。',
      '不会删除订单、生产、库存、BOM 行历史或客户 BOM 副本。'
    ],
    confirmButtonText: '永久删除',
    confirmButtonType: 'danger'
  });
}

async function enableBom(row: ModelBom) {
  if (guardDesktopOperation('启用零件包')) {
    return;
  }
  if (modelBomOperationSavingKey.value) {
    return;
  }
  const operationKey = modelBomOperationKey(row, 'enable');
  modelBomOperationSavingKey.value = operationKey;
  try {
    const saved = await erpApi.updateModelBom(row.id, {
      bomName: row.bomName,
      customerScopeMode: modelBomScopeMode(row),
      customerId: row.customerId || undefined,
      customerIds: row.scopeCustomerIds,
      projectModel: row.projectModel,
      remark: row.remark || undefined,
      status: 'ENABLED'
    });
    ElMessage.success('机型零件包已启用');
    await loadModelBoms();
    ensureModelBomVisible(saved);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '机型零件包启用失败，请确认后端服务、BOM 状态或同名范围重复');
  } finally {
    if (modelBomOperationSavingKey.value === operationKey) {
      modelBomOperationSavingKey.value = '';
    }
  }
}

function compareBomLines(left: ModelBomLine, right: ModelBomLine) {
  const leftDisplayOrder = Number(left.displayOrder ?? 0);
  const rightDisplayOrder = Number(right.displayOrder ?? 0);
  if (leftDisplayOrder > 0 && rightDisplayOrder > 0 && leftDisplayOrder !== rightDisplayOrder) {
    return leftDisplayOrder - rightDisplayOrder;
  }
  if (leftDisplayOrder > 0 && rightDisplayOrder <= 0) {
    return -1;
  }
  if (rightDisplayOrder > 0 && leftDisplayOrder <= 0) {
    return 1;
  }
  return (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.partCode.localeCompare(right.partCode);
}

function buildSourceBomDiffIssues(sourceBom: ModelBom, targetBom: ModelBom): BomDiffIssue[] {
  const sourceLineMap = new Map<string, ModelBomLine>();
  const targetLineMap = new Map<string, ModelBomLine>();
  const sourceActiveLines = sourceBom.lines.filter((line) => line.status === 'ENABLED' && line.materialStatus !== 'DISABLED');
  const targetActiveLines = targetBom.lines.filter((line) => line.status === 'ENABLED' && line.materialStatus !== 'DISABLED');
  const sourceDisplayOrderMap = bomLineDisplayOrderMap(sourceActiveLines);
  const targetDisplayOrderMap = bomLineDisplayOrderMap(targetActiveLines);
  sourceActiveLines.forEach((line) => sourceLineMap.set(bomLineIdentityKey(line), line));
  targetActiveLines.forEach((line) => targetLineMap.set(bomLineIdentityKey(line), line));

  const issues: BomDiffIssue[] = [];
  for (const [key, sourceLine] of sourceLineMap.entries()) {
    const targetLine = targetLineMap.get(key);
    if (!targetLine) {
      const fields = bomLineReviewFields(sourceLine, undefined, sourceDisplayOrderMap.get(sourceLine.id));
      issues.push({
        id: `missing-${key}`,
        severity: 'warning',
        kind: 'MISSING_IN_CUSTOMER',
        title: `客户 BOM 缺少：${bomLineShortText(sourceLine)}`,
        detail: `来源 ${sourceBom.bomName} 中仍存在该行；如客户确实不使用，可保留客户独立差异。`,
        sourceLine,
        fields,
        suggestedAction: '核对客户是否确实不使用该来源行；如需要沿用来源配置，可点击“按来源行补入”，再人工保存。'
      });
      continue;
    }
    const fields = bomLineReviewFields(sourceLine, targetLine, sourceDisplayOrderMap.get(sourceLine.id), targetDisplayOrderMap.get(targetLine.id));
    const changedFields = fields.filter((field) => field.changed).map((field) => `${field.label}：来源 ${field.sourceValue || '-'}，客户 ${field.targetValue || '-'}`);
    if (changedFields.length > 0) {
      issues.push({
        id: `changed-${key}`,
        severity: 'warning',
        kind: 'CHANGED',
        title: `行内容不一致：${bomLineShortText(targetLine)}`,
        detail: changedFields.join('；'),
        sourceLine,
        targetLine,
        fields,
        suggestedAction: '逐项核对来源值和客户值；如果客户版本是定制要求，保留客户差异；如果不是，请点击“编辑客户行”修正。'
      });
    }
  }

  for (const [key, targetLine] of targetLineMap.entries()) {
    if (!sourceLineMap.has(key)) {
      const fields = bomLineReviewFields(undefined, targetLine, undefined, targetDisplayOrderMap.get(targetLine.id));
      issues.push({
        id: `extra-${key}`,
        severity: 'info',
        kind: 'CUSTOMER_EXTRA',
        title: `客户 BOM 独立新增：${bomLineShortText(targetLine)}`,
        detail: '该行不在来源百胜通用 BOM 中，复制关系不会把客户新增行反向写回来源 BOM。',
        targetLine,
        fields,
        suggestedAction: '核对该行是否为客户专属新增；确认无误后保留即可。若录入错误，可点击“编辑客户行”修改或停用。'
      });
    }
  }
  return issues;
}

function bomLineDisplayOrderMap(lines: ModelBomLine[]) {
  const orderMap = new Map<string, number>();
  [...lines].sort(compareBomLines).forEach((line, index) => {
    orderMap.set(line.id, index + 1);
  });
  return orderMap;
}

function bomLineIdentityKey(line: ModelBomLine) {
  return [
    line.lineType || 'PART',
    normalizeComponentNo(line.componentNo) || '-',
    normalizeComponentNo(line.parentComponentNo) || '-',
    normalizeDiffText(line.partCode)
  ].join('|');
}

function bomLineShortText(line: ModelBomLine) {
  const componentNo = normalizeComponentNo(line.componentNo);
  const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
  const structureText =
    line.lineType === 'COMPONENT' ? `组件 ${componentNo || '未编号'}` : parentComponentNo ? `子零件 -> ${parentComponentNo}` : '单独零件';
  return `${structureText} / ${line.partCode} / ${line.partName}`;
}

function bomLineReviewFields(sourceLine?: ModelBomLine, targetLine?: ModelBomLine, sourceDisplayOrder?: number, targetDisplayOrder?: number): BomDiffField[] {
  const checks: Array<[string, string, string]> = [
    ['结构', sourceLine ? bomLineStructureText(sourceLine) : '', targetLine ? bomLineStructureText(targetLine) : ''],
    ['顺序', sourceLine ? String(sourceDisplayOrder || '-') : '', targetLine ? String(targetDisplayOrder || '-') : ''],
    ['零件编码', sourceLine?.partCode || '', targetLine?.partCode || ''],
    ['零件名称', sourceLine?.partName || '', targetLine?.partName || ''],
    ['零件类型', sourceLine?.partCategory || '', targetLine?.partCategory || ''],
    ['默认数量', sourceLine ? formatQuantity(sourceLine.defaultQuantity, sourceLine.unit) : '', targetLine ? formatQuantity(targetLine.defaultQuantity, targetLine.unit) : ''],
    ['默认图纸', sourceLine ? bomLineDrawingSignature(sourceLine) : '', targetLine ? bomLineDrawingSignature(targetLine) : ''],
    ['默认工艺', sourceLine ? explicitBomLineDefaultProcessRoute(sourceLine) : '', targetLine ? explicitBomLineDefaultProcessRoute(targetLine) : ''],
    ['厚度', sourceLine?.partThickness ? formatNumber(sourceLine.partThickness) : '', targetLine?.partThickness ? formatNumber(targetLine.partThickness) : ''],
    ['规格', sourceLine?.partSpecification || '', targetLine?.partSpecification || ''],
    ['状态', sourceLine?.status || '', targetLine?.status || '']
  ];
  return checks.map(([label, sourceValue, targetValue]) => ({
    label,
    sourceValue,
    targetValue,
    changed: normalizeDiffText(sourceValue) !== normalizeDiffText(targetValue)
  }));
}

function bomLineStructureText(line: ModelBomLine) {
  const componentNo = normalizeComponentNo(line.componentNo);
  const parentComponentNo = normalizeComponentNo(line.parentComponentNo);
  if (line.lineType === 'COMPONENT') {
    return `组件 ${componentNo || '未编号'}`;
  }
  return parentComponentNo ? `子零件 -> ${parentComponentNo}` : '单独零件';
}

function bomLineDrawingSignature(line: ModelBomLine) {
  return [line.drawingNo, line.drawingVersion, line.drawingDate, line.drawingStatus].filter(Boolean).join(' / ');
}

function openSourceBomDiffReviewDialog(issue: BomDiffIssue) {
  selectedSourceBomDiffIssue.value = issue;
  const review = sourceBomDiffReviewRow(issue);
  sourceBomReviewForm.reviewedBy = review?.reviewedBy || '';
  sourceBomReviewForm.reviewRemark = review?.reviewRemark || '';
  sourceBomReviewDialogVisible.value = true;
}

function sourceBomDiffFingerprint(issue: BomDiffIssue) {
  return [
    issue.kind,
    issue.id,
    ...issue.fields.map((field) => `${field.label}:${field.sourceValue || '-'}=>${field.targetValue || '-'}:${field.changed ? 'changed' : 'same'}`)
  ].join('|');
}

function sourceBomDiffReviewKey(issue: BomDiffIssue) {
  return [activeBom.value?.id || '-', activeBom.value?.sourceBomId || '-', issue.id, sourceBomDiffFingerprint(issue)].join('|');
}

function sourceBomDiffReviewRow(issue?: BomDiffIssue | null) {
  if (!issue) {
    return undefined;
  }
  return sourceBomDiffReviewByKey.value.get(sourceBomDiffReviewKey(issue));
}

function isSourceBomDiffReviewed(issue?: BomDiffIssue | null) {
  return Boolean(issue && (sourceBomDiffReviewRow(issue) || sourceBomReviewedDiffKeys.value.has(sourceBomDiffReviewKey(issue))));
}

function sourceBomDiffStatusLabel(issue: BomDiffIssue) {
  if (isSourceBomDiffReviewed(issue)) {
    return '已核对';
  }
  return issue.severity === 'warning' ? '需核对' : '客户差异';
}

function sourceBomDiffIssueDetailPreview(issue: BomDiffIssue, maxLength = 48) {
  return formatModelBomLongTextPreview(issue.detail, maxLength, '-');
}

function sourceBomDiffIssueDetailTitle(issue: BomDiffIssue) {
  return String(issue.detail || '').trim() || '-';
}

function sourceBomDiffStatusTagType(issue: BomDiffIssue) {
  if (isSourceBomDiffReviewed(issue)) {
    return 'success';
  }
  return issue.severity === 'warning' ? 'warning' : 'info';
}

function sourceBomDiffReviewRecordText(issue?: BomDiffIssue | null) {
  const review = sourceBomDiffReviewRow(issue);
  if (!review) {
    return '';
  }
  const reviewedAt = formatSourceBomReviewAt(review.reviewedAt);
  return `已由 ${review.reviewedBy || '未填写核对人'} 于 ${reviewedAt || '未知时间'} 核对；${review.reviewRemark || '保留为客户 BOM 差异'}`;
}

function formatSourceBomReviewAt(value?: string | null) {
  return value ? formatDateTime(value) : '';
}

async function confirmSourceBomDiffReviewed() {
  if (guardDesktopOperation('确认 BOM 差异核对')) {
    return;
  }
  const issue = selectedSourceBomDiffIssue.value;
  const bom = activeBom.value;
  const sourceBomId = bom?.sourceBomId || sourceBomForDiff.value?.id || '';
  if (!issue || !bom || !sourceBomId) {
    return;
  }
  if (!sourceBomReviewForm.reviewedBy.trim()) {
    ElMessage.warning('请填写核对人');
    return;
  }
  sourceBomDiffReviewSaving.value = true;
  try {
    const reviewKey = sourceBomDiffReviewKey(issue);
    const saved = await erpApi.confirmModelBomDiffReview(bom.id, {
      sourceBomId,
      reviewKey,
      issueKind: issue.kind,
      sourceLineId: issue.sourceLine?.id,
      targetLineId: issue.targetLine?.id,
      issueTitle: issue.title,
      issueDetail: issue.detail,
      diffFingerprint: sourceBomDiffFingerprint(issue),
      fieldsJson: { fields: issue.fields },
      reviewedBy: sourceBomReviewForm.reviewedBy.trim(),
      reviewRemark: sourceBomReviewForm.reviewRemark.trim() || undefined
    });
    const nextKeys = new Set(sourceBomReviewedDiffKeys.value);
    nextKeys.add(saved.reviewKey);
    sourceBomReviewedDiffKeys.value = nextKeys;
    await loadSourceBomDiffReviews();
    ElMessage.success('BOM 差异核对记录已保存，客户 BOM 不会被来源 BOM 自动覆盖');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'BOM 差异核对保存失败');
  } finally {
    sourceBomDiffReviewSaving.value = false;
  }
}

async function revokeSourceBomDiffReviewed(issue: BomDiffIssue) {
  const review = sourceBomDiffReviewRow(issue);
  if (!review) {
    return;
  }
  await revokeSourceBomDiffReviewRow(review);
}

async function revokeSourceBomDiffReviewRow(review: ModelBomDiffReview) {
  if (guardDesktopOperation('撤销 BOM 差异核对')) {
    return;
  }
  const confirmed = await openModelBomConfirmDialog({
    title: '撤销BOM差异核对',
    message: `确定撤销 ${review.issueTitle} 的核对记录吗？`,
    details: ['撤销只停用人工核对记录，不会修改来源 BOM 或客户 BOM 明细。'],
    confirmButtonText: '撤销核对',
    confirmButtonType: 'warning'
  });
  if (!confirmed) {
    return;
  }
  sourceBomDiffReviewRevoking.value = true;
  try {
    await erpApi.disableModelBomDiffReview(review.id);
    const nextKeys = new Set(sourceBomReviewedDiffKeys.value);
    nextKeys.delete(review.reviewKey);
    sourceBomReviewedDiffKeys.value = nextKeys;
    await loadSourceBomDiffReviews();
    ElMessage.success('BOM 差异核对已撤销，差异将重新进入需核对状态');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'BOM 差异核对撤销失败');
  } finally {
    sourceBomDiffReviewRevoking.value = false;
  }
}

function sourceBomReviewLineText(line?: ModelBomLine) {
  return line ? bomLineShortText(line) : '无对应行';
}

function sourceBomReviewLinePreview(line?: ModelBomLine) {
  return formatModelBomLongTextPreview(sourceBomReviewLineText(line), 44, '无对应行');
}

function sourceBomReviewLineTitle(line?: ModelBomLine) {
  return sourceBomReviewLineText(line);
}

async function focusSourceBomReviewTargetLine() {
  const lineId = selectedSourceBomDiffIssue.value?.targetLine?.id;
  if (!lineId) {
    return;
  }
  sourceBomReviewDialogVisible.value = false;
  await focusBomLine(lineId);
}

async function editSourceBomReviewTargetLine() {
  const targetLine = selectedSourceBomDiffIssue.value?.targetLine;
  if (!targetLine) {
    return;
  }
  sourceBomReviewDialogVisible.value = false;
  await openLineEditDialog(targetLine);
}

function openSourceBomFromReview() {
  const sourceBom = sourceBomForDiff.value;
  if (!sourceBom) {
    ElMessage.warning('未读取到来源 BOM，无法定位来源明细');
    return;
  }
  sourceBomReviewDialogVisible.value = false;
  ensureModelBomVisible(sourceBom);
  ElMessage.info('已打开来源百胜通用 BOM；返回客户 BOM 后可继续维护客户独立差异');
}

async function createCustomerLineFromSourceBomReview() {
  const sourceLine = selectedSourceBomDiffIssue.value?.sourceLine;
  if (!sourceLine || !activeBom.value) {
    return;
  }
  if (guardDesktopOperation('按来源 BOM 补入客户明细')) {
    return;
  }
  if (activeBom.value.status === 'DISABLED') {
    ElMessage.warning('当前客户 BOM 已停用，请先启用后再补入明细');
    return;
  }
  resetLineForm();
  lineForm.materialId = sourceLine.materialId;
  lineForm.materialKeyword = formatLineMaterialKeyword(sourceLine);
  lineForm.selectedMaterialKeyword = lineForm.materialKeyword;
  lineForm.materialStatus = sourceLine.materialStatus || 'ENABLED';
  lineForm.structureType = lineStructureType(sourceLine);
  lineForm.partCategory = sourceLine.partCategory || '';
  lineForm.componentNo = sourceLine.lineType === 'COMPONENT' ? normalizeComponentNo(sourceLine.componentNo) || nextComponentNo() || '' : '';
  lineForm.parentComponentNo = lineForm.structureType === 'CHILD_PART' ? normalizeComponentNo(sourceLine.parentComponentNo) : '';
  lineForm.defaultDrawingRevisionId = sourceLine.defaultDrawingRevisionId || '';
  lineForm.defaultProcessRouteSteps = splitDefaultProcessRoute(explicitBomLineDefaultProcessRoute(sourceLine));
  lineForm.partThickness = sourceLine.lineType === 'COMPONENT' ? 0 : Number(sourceLine.partThickness ?? 0);
  lineFormOriginalPartThickness.value = Number(sourceLine.partThickness ?? 0);
  lineFormOriginalPartThicknessSource.value = sourceLine.partThicknessSource || null;
  resetDefaultProcessDragState();
  lineDefaultProcessFilterKeyword.value = '';
  lineForm.defaultQuantity = sourceLine.defaultQuantity;
  lineForm.sortOrder = sourceLine.sortOrder ?? (activeBom.value.lines || []).reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0) + 10;
  lineForm.remark = sourceLine.remark || `从来源 BOM ${activeSourceBomName.value} 核对补入`;
  lineForm.status = sourceLine.materialStatus === 'DISABLED' ? 'DISABLED' : 'ENABLED';
  sourceBomReviewDialogVisible.value = false;
  lineDialogVisible.value = true;
  await loadLineDrawingRevisions(sourceLine.materialId);
}

function normalizeDiffText(value?: string | null) {
  return String(value || '').trim().toLocaleLowerCase();
}

function nextComponentNo() {
  let maxNo = 0;
  for (const line of activeBom.value?.lines || []) {
    const matched = /^C(\d+)$/i.exec(normalizeComponentNo(line.componentNo));
    if (matched) {
      maxNo = Math.max(maxNo, Number(matched[1]) || 0);
    }
  }
  if (maxNo >= 9999) {
    return '';
  }
  return `C${String(maxNo + 1).padStart(3, '0')}`;
}

function isComponentNoOutOfRange(value?: string | null) {
  const matched = /^C(\d+)$/.exec(normalizeComponentNo(value));
  return !!matched && (Number(matched[1]) < 1 || Number(matched[1]) > 9999);
}

function normalizeComponentNo(value?: string | null) {
  return String(value || '').trim().toUpperCase();
}

function lineStructureType(row: ModelBomLine): BomLineStructureType {
  if (row.lineType === 'COMPONENT') {
    return 'COMPONENT';
  }
  return row.parentComponentNo ? 'CHILD_PART' : 'STANDALONE_PART';
}

function formatLineStructure(row: ModelBomLine) {
  if (row.lineType === 'COMPONENT') {
    return `组件 ${normalizeComponentNo(row.componentNo) || '未编号'}`;
  }
  const parentComponentNo = normalizeComponentNo(row.parentComponentNo);
  if (parentComponentNo) {
    if (isLineMissingEnabledParent(row)) {
      return `未匹配父级 -> ${parentComponentNo}`;
    }
    return `子零件 -> ${parentComponentNo}`;
  }
  return '单独零件';
}

function lineStructureHint(row: ModelBomLine) {
  if (row.lineType === 'COMPONENT') {
    return row.status === 'ENABLED' ? '父级组件' : '父级组件已停用';
  }
  const parentComponentNo = normalizeComponentNo(row.parentComponentNo);
  if (parentComponentNo && isLineMissingEnabledParent(row)) {
    return `所属组件 ${parentComponentNo} 不存在或已停用`;
  }
  return parentComponentNo ? `所属组件 ${parentComponentNo}` : '不属于组件';
}

function lineStructureTagType(row: ModelBomLine): BomLineStructureTagType {
  if (row.lineType === 'COMPONENT') {
    return 'success';
  }
  if (isLineMissingEnabledParent(row)) {
    return 'danger';
  }
  return normalizeComponentNo(row.parentComponentNo) ? 'warning' : 'info';
}

function isLineMissingEnabledParent(row: ModelBomLine) {
  const parentComponentNo = normalizeComponentNo(row.parentComponentNo);
  if (row.lineType === 'COMPONENT' || !parentComponentNo) {
    return false;
  }
  return !enabledComponentNosForLines(sortedActiveBomLines.value).has(parentComponentNo);
}

function formatLineDrawing(row: ModelBomLine) {
  if (!row.drawingNo && !row.drawingVersion) {
    return '-';
  }
  const suffix = row.drawingSource === 'BOM_LINE' ? 'BOM指定' : row.drawingSource === 'MATERIAL_LATEST' ? '零件最新' : '零件默认';
  return `${[row.drawingNo, row.drawingVersion, row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ')}（${suffix}）`;
}

function explicitBomLineDefaultProcessRoute(row: ModelBomLine) {
  return row.defaultProcessRouteSource === 'BOM_LINE' ? row.bomLineDefaultProcessRoute || row.defaultProcessRoute || '' : '';
}

function formatLineDefaultProcessRoute(row: ModelBomLine) {
  if (!row.defaultProcessRoute) {
    return '-';
  }
  const processText = formatProcessRoutePreview(row.defaultProcessRoute);
  return row.defaultProcessRouteSource === 'MATERIAL' ? `${processText}（零件默认）` : `${processText}（BOM指定）`;
}

function formatLineDefaultProcessRouteFull(row: ModelBomLine) {
  if (!row.defaultProcessRoute) {
    return '-';
  }
  return row.defaultProcessRouteSource === 'MATERIAL' ? `${row.defaultProcessRoute}（零件默认）` : `${row.defaultProcessRoute}（BOM指定）`;
}

function formatProcessRoutePreview(value?: string | null, emptyText = '-') {
  const routeText = String(value || '').trim();
  if (!routeText) {
    return emptyText;
  }
  const steps = splitDefaultProcessRoute(routeText);
  if (steps.length <= 1) {
    return routeText;
  }
  const preview = steps.filter((_, index) => index < 3).join('、');
  return steps.length > 3 ? `${preview} 等 ${steps.length} 个工序` : preview;
}

function displayBomLineOrder(row: ModelBomLine) {
  return activeBomLineDisplayOrderMap.value.get(row.id) ?? row.displayOrder ?? 0;
}

function formatLineOrderTitle(row: ModelBomLine) {
  return `BOM 明细顺序 ${displayBomLineOrder(row) || '-'}`;
}

function formatLineOrderText(row: ModelBomLine) {
  return `顺序 ${displayBomLineOrder(row) || '-'}`;
}

function formatLineStatusText(row: ModelBomLine) {
  const rowStatusText = row.status === 'ENABLED' ? '启用' : '停用';
  return row.materialStatus === 'DISABLED' ? `${rowStatusText} / 基础零件停用` : rowStatusText;
}

function formatLineThickness(row: ModelBomLine) {
  if (row.lineType === 'COMPONENT') {
    return '不适用（父级组件由子零件维护）';
  }
  const thickness = Number(row.partThickness ?? 0);
  if (thickness <= 0) {
    return '需核对';
  }
  if (row.partThicknessSource === 'ORDER_HISTORY') {
    return `历史厚度 ${String(row.partThickness)}（需核对）`;
  }
  if (row.partThicknessSource !== 'BOM_LINE') {
    return `${String(row.partThickness)}（需核对）`;
  }
  return String(row.partThickness);
}

function formatLineThicknessSourceForText(row: ModelBomLine) {
  if (row.lineType === 'COMPONENT') {
    return '父级组件不适用';
  }
  const thickness = Number(row.partThickness ?? 0);
  if (thickness > 0 && row.partThicknessSource === 'BOM_LINE') {
    return '当前BOM明细';
  }
  if (thickness > 0 && row.partThicknessSource === 'ORDER_HISTORY') {
    return '历史订单参考';
  }
  return '未确认';
}

function formatLineThicknessSourceLabel(row: ModelBomLine) {
  if (row.lineType === 'COMPONENT') {
    return '父级组件';
  }
  const thickness = Number(row.partThickness ?? 0);
  if (thickness <= 0) {
    return '未填写';
  }
  if (row.partThicknessSource === 'BOM_LINE') {
    return '当前 BOM 明细';
  }
  if (row.partThicknessSource === 'ORDER_HISTORY') {
    return '历史订单参考';
  }
  return '来源未确认';
}

function lineThicknessSourceTagType(row: ModelBomLine) {
  if (row.lineType === 'COMPONENT') {
    return 'info';
  }
  const thickness = Number(row.partThickness ?? 0);
  if (thickness <= 0) {
    return 'danger';
  }
  if (row.partThicknessSource === 'BOM_LINE') {
    return 'success';
  }
  if (row.partThicknessSource === 'ORDER_HISTORY') {
    return 'warning';
  }
  return 'danger';
}

function formatLineThicknessReviewReason(row: ModelBomLine) {
  if (row.lineType === 'COMPONENT') {
    return '父级组件由子零件拼接，不需要维护自身厚度';
  }
  const thickness = Number(row.partThickness ?? 0);
  if (thickness <= 0) {
    return '当前 BOM 明细未填写厚度，请核对后保存';
  }
  if (row.partThicknessSource === 'ORDER_HISTORY') {
    return '当前值来自历史订单，只是预填参考；保存后才写入当前 BOM 明细';
  }
  if (row.partThicknessSource !== 'BOM_LINE') {
    return '厚度来源未确认，请核对后保存到当前 BOM 明细';
  }
  return '当前 BOM 明细厚度已确认';
}

function formatModelBomLongTextPreview(value?: string | null, maxLength = 32, emptyText = '-') {
  const text = String(value || '').trim();
  if (!text) {
    return emptyText;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function modelBomRevisionChangeRemarkPreview(revision?: ModelBomRevision | null) {
  return formatModelBomLongTextPreview(revision?.changeRemark, 32, '-');
}

function modelBomRevisionChangeRemarkTitle(revision?: ModelBomRevision | null) {
  return String(revision?.changeRemark || '').trim() || '-';
}

function modelBomRevisionChangedByPreview(revision?: ModelBomRevision | null) {
  return formatModelBomLongTextPreview(revision?.changedBy, 18, '-');
}

function modelBomRevisionChangedByTitle(revision?: ModelBomRevision | null) {
  return String(revision?.changedBy || '').trim() || '-';
}

function sourceBomDiffReviewRemarkPreview(review: ModelBomDiffReview) {
  return formatModelBomLongTextPreview(review.reviewRemark, 32, '保留为客户 BOM 差异');
}

function sourceBomDiffReviewRemarkTitle(review: ModelBomDiffReview) {
  return String(review.reviewRemark || '').trim() || '保留为客户 BOM 差异';
}

function sourceBomDiffReviewIssuePreview(review: ModelBomDiffReview) {
  return formatModelBomLongTextPreview(review.issueTitle, 34, '-');
}

function sourceBomDiffReviewIssueTitle(review: ModelBomDiffReview) {
  return review.issueTitle || '-';
}

function formatLineThicknessReviewReasonPreview(row: ModelBomLine) {
  return formatModelBomLongTextPreview(formatLineThicknessReviewReason(row), 34, '-');
}

function lineThicknessReviewTitle(row: ModelBomLine) {
  return `${formatLineThicknessReviewReason(row)}。点击核对并保存为当前 BOM 明细厚度`;
}

function lineThicknessReviewActionTitle(row: ModelBomLine) {
  if (isMobileLayout.value) {
    return `${formatLineThicknessReviewReason(row)}。手机端仅查看厚度核对清单，核对并保存厚度请在电脑端操作`;
  }
  return lineThicknessReviewTitle(row);
}

function thicknessReviewRowClassName({ row }: { row: ModelBomLine }) {
  return !isMobileLayout.value && lineNeedsThicknessReview(row) ? 'bom-thickness-review-table__row' : '';
}

function formatLineThicknessForText(row: ModelBomLine) {
  return row.lineType === 'COMPONENT' ? '不适用（父级组件由子零件维护）' : `${formatLineThickness(row)}；来源 ${formatLineThicknessSourceForText(row)}`;
}

function formatModelBomStatusText(status?: CommonStatus | null) {
  return status === 'DISABLED' ? '停用' : '启用';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseModelBomRevisionSnapshot(revision?: ModelBomRevision | null): ModelBomRevisionSnapshot {
  return isPlainObject(revision?.snapshotJson) ? (revision?.snapshotJson as ModelBomRevisionSnapshot) : {};
}

function formatBomRevisionSnapshotScope(snapshot: ModelBomRevisionSnapshot) {
  const bom = snapshot.bom;
  if (!bom) {
    return '-';
  }
  const projectModel = bom.projectModel || '全部机型/项目';
  if (bom.customerScopeMode === 'PRIVATE') {
    return `${bom.customerNameSnapshot || '指定客户'} / ${projectModel}`;
  }
  if (bom.customerScopeMode === 'SELECTED') {
    const customerNames = (snapshot.customerScopes || []).map((scope) => scope.customerNameSnapshot).filter(Boolean);
    return `${formatCustomerNamePreview(customerNames, '指定客户')} / ${projectModel}`;
  }
  return `全部客户 / ${projectModel}`;
}

function formatBomRevisionLineStructure(row: ModelBomRevisionSnapshotLine) {
  if (row.lineType === 'COMPONENT') {
    return `组件 ${row.componentNo || '-'}`;
  }
  if (row.parentComponentNo) {
    return `子零件 -> ${row.parentComponentNo}`;
  }
  return '单独零件';
}

function formatBomRevisionLineQuantity(row: ModelBomRevisionSnapshotLine) {
  return formatQuantity(Number(row.defaultQuantity ?? 0), row.unitSnapshot || '件');
}

function formatBomRevisionLinePartCode(row: ModelBomRevisionSnapshotLine) {
  return formatModelBomLongTextPreview(row.partCodeSnapshot, 24, '-');
}

function formatBomRevisionLinePartCodeTitle(row: ModelBomRevisionSnapshotLine) {
  return row.partCodeSnapshot || '-';
}

function formatBomRevisionLinePartName(row: ModelBomRevisionSnapshotLine) {
  return formatModelBomLongTextPreview(row.partNameSnapshot, 28, '-');
}

function formatBomRevisionLinePartNameTitle(row: ModelBomRevisionSnapshotLine) {
  return row.partNameSnapshot || '-';
}

function formatBomRevisionLineDrawingText(row: ModelBomRevisionSnapshotLine) {
  const drawing = row.defaultDrawingRevision;
  if (!drawing) {
    return row.defaultDrawingRevisionId ? '已指定图纸' : '-';
  }
  return [drawing.drawingNo, drawing.drawingVersion, drawing.drawingDate, drawing.drawingStatus].filter(Boolean).join(' / ') || '-';
}

function formatBomRevisionLineDrawing(row: ModelBomRevisionSnapshotLine) {
  return formatModelBomLongTextPreview(formatBomRevisionLineDrawingText(row), 30, '-');
}

function formatBomRevisionLineDrawingTitle(row: ModelBomRevisionSnapshotLine) {
  return formatBomRevisionLineDrawingText(row);
}

function formatBomRevisionLineDefaultProcessRoute(row: ModelBomRevisionSnapshotLine) {
  return formatProcessRoutePreview(row.defaultProcessRoute);
}

function formatBomRevisionLineDefaultProcessRouteTitle(row: ModelBomRevisionSnapshotLine) {
  return String(row.defaultProcessRoute || '').trim() || '-';
}

function formatBomRevisionLineThickness(row: ModelBomRevisionSnapshotLine) {
  return Number(row.partThicknessSnapshot ?? 0) > 0 ? formatNumber(Number(row.partThicknessSnapshot)) : '-';
}

function formatBomRevisionLineSpecification(row: ModelBomRevisionSnapshotLine) {
  return formatModelBomLongTextPreview(row.partSpecificationSnapshot, 28, '-');
}

function formatBomRevisionLineSpecificationTitle(row: ModelBomRevisionSnapshotLine) {
  return row.partSpecificationSnapshot || '-';
}

function formatBomRevisionLineStatus(row: ModelBomRevisionSnapshotLine) {
  return row.status === 'DISABLED' ? '停用' : '启用';
}

function buildBomRevisionSnapshotText(revision: ModelBomRevision, snapshot: ModelBomRevisionSnapshot) {
  const bom = snapshot.bom;
  const rows = snapshot.lines || [];
  const lines = [
    `BOM 版本快照 V${revision.revisionNo}`,
    `动作：${formatBomRevisionAction(revision.action)}`,
    `记录时间：${formatDateTime(revision.createdAt)}`,
    `操作来源：${revision.changedBy || '-'}`,
    `备注：${revision.changeRemark || '-'}`,
    `BOM名称：${bom?.bomName || '-'}`,
    `适用范围：${formatBomRevisionSnapshotScope(snapshot)}`,
    `来源BOM：${bom?.sourceBomNameSnapshot || '-'}`,
    `状态：${formatModelBomStatusText(bom?.status)}`,
    '说明：该快照仅用于人工核对，不会恢复、替换或覆盖当前 BOM。',
    '序号\t顺序\t结构\t零件编码\t零件名称\t默认数量\t默认图纸\t默认工艺\t厚度\t规格\t状态'
  ];
  rows.forEach((row, index) => {
    lines.push(
      [
        index + 1,
        Number(row.sortOrder ?? 0),
        formatBomRevisionLineStructure(row),
        row.partCodeSnapshot || '-',
        row.partNameSnapshot || '-',
        formatBomRevisionLineQuantity(row),
        formatBomRevisionLineDrawingTitle(row),
        formatBomRevisionLineDefaultProcessRoute(row),
        formatBomRevisionLineThickness(row),
        row.partSpecificationSnapshot || '-',
        formatBomRevisionLineStatus(row)
      ].join('\t')
    );
  });
  return lines.join('\n');
}

function formatBomRevisionAction(action: string) {
  const actionLabels: Record<string, string> = {
    CREATE: '新建 BOM',
    COPY_FROM_SOURCE: '复制 BOM',
    ORDER_IMPORT_DRAFT_COMMIT: '订单导入草稿确认',
    UPDATE_HEADER: '编辑表头',
    SET_COMMON: '设为常用',
    UNSET_COMMON: '取消常用',
    SET_COMMON_BATCH: '批量设为常用',
    UNSET_COMMON_BATCH: '批量取消常用',
    REORDER_COMMON: '调整常用排序',
    DISABLE_BOM: '停用 BOM',
    CREATE_LINE: '新增明细',
    UPDATE_LINE: '编辑明细',
    REORDER_LINES: '明细排序',
    DISABLE_LINE: '停用明细'
  };
  return actionLabels[action] || action;
}

function formatFixedLineCore(row: ModelBomLine) {
  return `${row.partCode || '-'} | ${row.partName || '-'} | ${formatQuantity(row.defaultQuantity, row.unit)}`;
}

function formatFixedLineMeta(row: ModelBomLine) {
  const drawingText = formatLineDrawing(row);
  const processText = formatLineDefaultProcessRoute(row);
  const specificationText = row.partSpecification || '-';
  const thicknessText = formatLineThicknessForText(row);
  return `${formatLineOrderText(row)} | 结构 ${formatLineStructure(row)} | 图纸 ${drawingText} | 工艺 ${processText} | 厚度 ${thicknessText} | 规格 ${specificationText} | 状态 ${formatLineStatusText(row)}`;
}

function formatBomStructureTextLine(row: ModelBomLine, prefix: string) {
  const categoryText = row.partCategory || '-';
  const thicknessText = formatLineThicknessForText(row);
  return `${prefix} | ${formatLineOrderText(row)} | 结构 ${formatLineStructure(row)} | ${row.partCode || '-'} | ${row.partName || '-'} | ${categoryText} | 默认 ${formatQuantity(row.defaultQuantity, row.unit)} | 图纸 ${formatLineDrawing(row)} | 工艺 ${formatLineDefaultProcessRoute(row)} | 厚度 ${thicknessText} | 规格 ${row.partSpecification || '-'} | 状态 ${formatLineStatusText(row)}`;
}

function appendBomStructureTextGroups(lines: string[], groups: BomStructureGroup[]) {
  for (const [groupIndex, group] of groups.entries()) {
    const prefix =
      group.type === 'component'
        ? `${groupIndex + 1}. 组件 ${group.line.componentNo || '-'}`
        : group.type === 'orphan'
          ? `${groupIndex + 1}. 未匹配父级 ${group.line.parentComponentNo || '-'}`
          : `${groupIndex + 1}. 单独零件`;
    lines.push(formatBomStructureTextLine(group.line, prefix));
    group.children.forEach((child, childIndex) => {
      lines.push(formatBomStructureTextLine(child, `  ${groupIndex + 1}.${childIndex + 1} 子零件`));
    });
  }
}

const bomStructureText = computed(() => {
  if (!activeBom.value) {
    return '';
  }
  const summary = activeBomLineSummary.value;
  const effectiveGroups = buildBomStructureGroups(activeBomDisplayLines.value.filter(lineCountsAsActiveBomContent));
  const inactiveLines = activeBomDisplayLines.value.filter((line) => !lineCountsAsActiveBomContent(line));
  const lines = [
    'BOM 固定格式清单',
    `零件包：${activeBom.value.bomName}`,
    `适用范围：客户 ${activeBom.value.customerName || '全部客户'}；机型 ${activeBom.value.projectModel || '-'}；状态 ${formatModelBomStatusText(activeBom.value.status)}`,
    `结构统计：组件 ${summary.componentCount}；子零件 ${summary.childPartCount}；单独零件 ${summary.standalonePartCount}；未匹配父级 ${summary.orphanPartCount}；厚度核对 ${summary.missingThicknessCount}；停用 ${summary.disabledCount}；基础零件停用 ${summary.materialDisabledCount}`,
    `来源 BOM：${activeBom.value.sourceBomNameSnapshot || '-'}`,
    '厚度说明：只有“来源 当前BOM明细”表示该厚度已经保存到当前 BOM；“历史订单参考”或“未确认”仍需点击厚度核对后人工保存。',
    '有效明细（用于后续推荐）：'
  ];
  if (effectiveGroups.length === 0) {
    lines.push('暂无有效明细');
  } else {
    appendBomStructureTextGroups(lines, effectiveGroups);
  }
  if (inactiveLines.length > 0) {
    // 固定格式清单把停用内容单独列出，避免复制后误当成下单推荐 BOM。
    lines.push('停用/基础零件停用明细（不参与后续推荐）：');
    inactiveLines.forEach((line, index) => {
      lines.push(formatBomStructureTextLine(line, `${index + 1}. 停用明细`));
    });
  }
  return lines.join('\n');
});

function openBomStructureTextDialog() {
  if (!bomStructureText.value.trim()) {
    ElMessage.warning('暂无可查看的固定格式清单');
    return;
  }
  bomStructureTextDialogVisible.value = true;
}

function openModelBomListTextDialog() {
  if (!modelBomListText.value.trim()) {
    ElMessage.warning('暂无可查看的 BOM 范围清单');
    return;
  }
  bomListTextDialogVisible.value = true;
}

async function copyBomStructureText() {
  const text = bomStructureText.value.trim();
  if (!text) {
    ElMessage.warning('暂无可复制的固定格式清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

async function copyBomRevisionSnapshotText() {
  const text = selectedBomRevisionSnapshotText.value.trim();
  if (!text) {
    ElMessage.warning('暂无可复制的 BOM 版本快照');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('BOM 版本快照已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

async function copyModelBomListText() {
  const text = modelBomListText.value.trim();
  if (!text) {
    ElMessage.warning('暂无可复制的 BOM 范围清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('BOM 范围固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

async function copyThicknessReviewText() {
  const text = thicknessReviewText.value.trim();
  if (!text) {
    ElMessage.warning('暂无可复制的厚度核对清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('厚度核对清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

async function copySourceBomDiffText() {
  const text = sourceBomDiffText.value.trim();
  if (!text || sourceBomDiffIssues.value.length === 0) {
    ElMessage.warning('暂无可复制的来源 BOM 差异');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('来源 BOM 差异固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

function formatDrawingRevisionOption(row: MaterialDrawingRevision) {
  const prefix = row.isDefault ? '默认 / ' : '';
  return `${prefix}${[row.drawingNo, row.drawingVersion, row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ')}`;
}

function lineStructureClass(row: ModelBomLine) {
  return `bom-line-structure--${lineStructureType(row).toLowerCase().replace(/_/g, '-')}`;
}

function buildLinePayload(row: ModelBomLine, overrides: Partial<SaveModelBomLinePayload> = {}): SaveModelBomLinePayload {
  return {
    materialId: row.materialId,
    lineType: row.lineType === 'COMPONENT' ? 'COMPONENT' : 'PART',
    partCategory: row.partCategory || undefined,
    componentNo: normalizeComponentNo(row.componentNo) || undefined,
    parentComponentNo: normalizeComponentNo(row.parentComponentNo) || undefined,
    defaultDrawingRevisionId: row.defaultDrawingRevisionId || undefined,
    defaultProcessRoute: row.defaultProcessRoute || undefined,
    defaultQuantity: row.defaultQuantity,
    sortOrder: row.sortOrder,
    remark: row.remark || undefined,
    status: row.status,
    ...overrides
  };
}

function isDragAfterRowMiddle(event: DragEvent) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) {
    return false;
  }
  const rect = target.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

function startLineDrag(event: DragEvent, index: number) {
  if (guardDesktopOperation('拖拽调整顺序')) {
    event.preventDefault();
    return;
  }
  if (saving.value || modelBomLineOperationSavingKey.value) {
    event.preventDefault();
    return;
  }
  draggedLineIndex.value = index;
  dragOverLineIndex.value = index;
  dragOverLineInsertAfter.value = false;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', activeBomDisplayLines.value[index]?.id || '');
  }
}

function handleLineDragOver(event: DragEvent, index: number) {
  if (draggedLineIndex.value === null || saving.value || modelBomLineOperationSavingKey.value) {
    return;
  }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  dragOverLineIndex.value = index;
  dragOverLineInsertAfter.value = isDragAfterRowMiddle(event);
}

function handleLineListDragOverEnd() {
  if (draggedLineIndex.value === null || activeBomDisplayLines.value.length === 0 || saving.value || modelBomLineOperationSavingKey.value) {
    return;
  }
  dragOverLineIndex.value = activeBomDisplayLines.value.length - 1;
  dragOverLineInsertAfter.value = true;
}

function componentNoForLine(line?: ModelBomLine | null) {
  return line?.lineType === 'COMPONENT' ? normalizeComponentNo(line.componentNo) : '';
}

function parentComponentNoForLine(line?: ModelBomLine | null) {
  return line?.lineType === 'PART' ? normalizeComponentNo(line.parentComponentNo) : '';
}

function hasComponentNo(componentNo: string) {
  return activeBomDisplayLines.value.some((line) => componentNoForLine(line) === componentNo);
}

function isAttachedChildLine(line?: ModelBomLine | null) {
  const parentComponentNo = parentComponentNoForLine(line);
  return Boolean(parentComponentNo && hasComponentNo(parentComponentNo));
}

function buildDraggedLineOrder(targetIndex: number, insertAfter: boolean): ModelBomLine[] | null {
  if (draggedLineIndex.value === null) {
    return [];
  }
  const dragged = activeBomDisplayLines.value[draggedLineIndex.value];
  if (!dragged) {
    return [];
  }
  return isAttachedChildLine(dragged)
    ? buildChildDraggedLineOrder(dragged, targetIndex, insertAfter)
    : buildRootDraggedLineOrder(dragged, targetIndex, insertAfter);
}

function buildChildDraggedLineOrder(dragged: ModelBomLine, targetIndex: number, insertAfter: boolean): ModelBomLine[] | null {
  const target = activeBomDisplayLines.value[targetIndex];
  const sourceIndex = draggedLineIndex.value;
  if (sourceIndex === null) {
    return [];
  }
  const parentComponentNo = parentComponentNoForLine(dragged);
  const targetParentComponentNo = parentComponentNoForLine(target);
  const isParentRowDrop = componentNoForLine(target) === parentComponentNo;
  if (!target || (!isParentRowDrop && targetParentComponentNo !== parentComponentNo)) {
    ElMessage.warning('子零件只能在同一父组件内拖拽排序；如需换父级，请编辑所属组件');
    return null;
  }
  if (isParentRowDrop && !insertAfter) {
    ElMessage.warning('子零件不能拖到父组件前面；请拖到父组件下方子零件区域');
    return null;
  }
  const ordered = [...activeBomDisplayLines.value];
  const [movedLine] = ordered.splice(sourceIndex, 1);
  if (!movedLine) {
    return [];
  }
  let insertionIndex = targetIndex + (insertAfter ? 1 : 0);
  if (sourceIndex < insertionIndex) {
    insertionIndex -= 1;
  }
  ordered.splice(Math.max(0, Math.min(insertionIndex, ordered.length)), 0, movedLine);
  return ordered;
}

function buildRootDraggedLineOrder(dragged: ModelBomLine, targetIndex: number, insertAfter: boolean): ModelBomLine[] | null {
  const target = activeBomDisplayLines.value[targetIndex];
  if (!target || isAttachedChildLine(target)) {
    ElMessage.warning('组件和单独零件请拖到顶层行之间排序，不要拖入子零件区域');
    return null;
  }
  const groups = [...activeBomStructureGroups.value];
  const draggedGroupIndex = groups.findIndex((group) => group.line.id === dragged.id);
  const targetGroupIndex = groups.findIndex((group) => group.line.id === target.id);
  if (draggedGroupIndex === targetGroupIndex) {
    return [];
  }
  if (draggedGroupIndex < 0 || targetGroupIndex < 0) {
    return [];
  }
  const [draggedGroup] = groups.splice(draggedGroupIndex, 1);
  if (!draggedGroup) {
    return [];
  }
  const targetIndexAfterRemove = groups.findIndex((group) => group.line.id === target.id);
  if (targetIndexAfterRemove < 0) {
    return [];
  }
  const insertionIndex = targetIndexAfterRemove + (insertAfter ? 1 : 0);
  groups.splice(Math.max(0, Math.min(insertionIndex, groups.length)), 0, draggedGroup);
  return groups.flatMap((group) => [group.line, ...group.children]);
}

async function saveDraggedLineOrder(ordered: ModelBomLine[]) {
  if (!activeBom.value || ordered.length === 0) {
    return;
  }
  if (saving.value || modelBomLineOperationSavingKey.value) {
    endLineDrag();
    return;
  }
  const operationSource = ordered[0];
  if (!operationSource) {
    return;
  }
  const operationKey = modelBomLineOperationKey(operationSource, 'reorder');
  modelBomLineOperationSavingKey.value = operationKey;
  saving.value = true;
  try {
    const items = ordered.map((line, orderIndex) => ({
      lineId: line.id,
      sortOrder: (orderIndex + 1) * 10
    }));
    const hasChanged = items.some((item) => ordered.find((line) => line.id === item.lineId)?.sortOrder !== item.sortOrder);
    if (!hasChanged) {
      endLineDrag();
      return;
    }
    const saved = await erpApi.reorderModelBomLines(activeBom.value.id, { items });
    activeBomId.value = saved.id;
    await loadModelBoms();
    ElMessage.success('零件包顺序已保存');
  } finally {
    saving.value = false;
    if (modelBomLineOperationSavingKey.value === operationKey) {
      modelBomLineOperationSavingKey.value = '';
    }
    endLineDrag();
  }
}

async function dropLineDrag() {
  if (draggedLineIndex.value === null || dragOverLineIndex.value === null || saving.value || modelBomLineOperationSavingKey.value) {
    endLineDrag();
    return;
  }
  const ordered = buildDraggedLineOrder(dragOverLineIndex.value, dragOverLineInsertAfter.value);
  if (!ordered || ordered.length === 0) {
    endLineDrag();
    return;
  }
  await saveDraggedLineOrder(ordered);
}

async function dropLineDragAtEnd() {
  if (draggedLineIndex.value === null || activeBomDisplayLines.value.length === 0 || saving.value || modelBomLineOperationSavingKey.value) {
    endLineDrag();
    return;
  }
  const ordered = buildDraggedLineOrder(activeBomDisplayLines.value.length - 1, true);
  if (!ordered || ordered.length === 0) {
    endLineDrag();
    return;
  }
  await saveDraggedLineOrder(ordered);
}

function endLineDrag() {
  draggedLineIndex.value = null;
  dragOverLineIndex.value = null;
  dragOverLineInsertAfter.value = false;
}

function defaultLinePartCategory() {
  if (!activeBom.value?.customerId) {
    return '百胜通用件';
  }
  return activeBom.value.projectModel ? '客户定制件' : '客户通用件';
}

function resetLineForm() {
  lineForm.id = '';
  lineForm.materialId = '';
  lineForm.materialKeyword = '';
  lineForm.selectedMaterialKeyword = '';
  lineForm.materialStatus = 'ENABLED';
  lineForm.structureType = 'STANDALONE_PART';
  lineForm.partCategory = defaultLinePartCategory();
  lineForm.componentNo = '';
  lineForm.parentComponentNo = '';
  lineForm.defaultDrawingRevisionId = '';
  lineForm.defaultProcessRouteSteps = [];
  resetDefaultProcessDragState();
  lineDefaultProcessFilterKeyword.value = '';
  lineForm.partThickness = 0;
  lineForm.defaultQuantity = 1;
  lineForm.sortOrder = (activeBom.value?.lines || []).reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0) + 10;
  lineForm.remark = '';
  lineForm.status = 'ENABLED';
  lineDrawingRevisions.value = [];
  lineFormOriginalPartThickness.value = null;
  lineFormOriginalPartThicknessSource.value = null;
}

function openLineCreateDialog(initialStructure: BomLineStructureType = 'STANDALONE_PART', parentComponentNo = '') {
  if (guardDesktopOperation('新增包内明细')) {
    return;
  }
  if (!activeBom.value) {
    return;
  }
  if (activeBom.value.status === 'DISABLED') {
    ElMessage.warning('当前零件包已停用，请先恢复启用后再新增包内明细');
    return;
  }
  resetLineForm();
  thicknessReviewLineId.value = '';
  applyInitialLineStructure(initialStructure, parentComponentNo);
  lineDialogVisible.value = true;
}

function applyInitialLineStructure(initialStructure: BomLineStructureType, preferredParentComponentNo = '') {
  lineForm.structureType = initialStructure;
  if (initialStructure === 'COMPONENT') {
    const componentNo = nextComponentNo();
    if (!componentNo) {
      ElMessage.warning('当前零件包 C001-C9999 自动组件编号已用完，请手工填写当前零件包内唯一组件编号');
      return;
    }
    lineForm.componentNo = componentNo;
    lineForm.parentComponentNo = '';
    return;
  }
  lineForm.componentNo = '';
  if (initialStructure === 'CHILD_PART') {
    const preferredParent = normalizeComponentNo(preferredParentComponentNo);
    const matchedParent = preferredParent
      ? availableParentComponents.value.find((line) => normalizeComponentNo(line.componentNo) === preferredParent)
      : undefined;
    const firstParent = matchedParent || availableParentComponents.value[0];
    const parentComponentNo = normalizeComponentNo(firstParent?.componentNo);
    if (!parentComponentNo) {
      ElMessage.warning('请先添加组件行，再添加组件子零件');
      lineForm.structureType = 'STANDALONE_PART';
      lineForm.parentComponentNo = '';
      return;
    }
    lineForm.parentComponentNo = parentComponentNo;
    return;
  }
  lineForm.parentComponentNo = '';
}

async function openLineEditDialog(row: ModelBomLine, options: { thicknessReview?: boolean } = {}) {
  if (guardDesktopOperation('编辑包内明细')) {
    return;
  }
  thicknessReviewLineId.value = options.thicknessReview ? row.id : '';
  lineForm.id = row.id;
  lineForm.materialId = row.materialId;
  lineForm.materialKeyword = formatLineMaterialKeyword(row);
  lineForm.selectedMaterialKeyword = lineForm.materialKeyword;
  lineForm.materialStatus = row.materialStatus || 'ENABLED';
  lineForm.structureType = lineStructureType(row);
  lineForm.partCategory = row.partCategory || '';
  lineForm.componentNo = row.componentNo || '';
  lineForm.parentComponentNo = row.parentComponentNo || '';
  lineForm.defaultDrawingRevisionId = row.defaultDrawingRevisionId || '';
  lineForm.defaultProcessRouteSteps = splitDefaultProcessRoute(explicitBomLineDefaultProcessRoute(row));
  resetDefaultProcessDragState();
  lineDefaultProcessFilterKeyword.value = '';
  lineForm.partThickness = row.lineType === 'COMPONENT' ? 0 : Number(row.partThickness ?? 0);
  lineFormOriginalPartThickness.value = Number(row.partThickness ?? 0);
  lineFormOriginalPartThicknessSource.value = row.partThicknessSource || null;
  lineForm.defaultQuantity = row.defaultQuantity;
  lineForm.sortOrder = row.sortOrder ?? 0;
  lineForm.remark = row.remark || '';
  lineForm.status = row.status;
  lineDialogVisible.value = true;
  await loadLineDrawingRevisions(row.materialId);
}

function handleLineStructureChange() {
  if (lineForm.structureType === 'COMPONENT') {
    if (!normalizeComponentNo(lineForm.componentNo)) {
      const componentNo = nextComponentNo();
      if (!componentNo) {
        ElMessage.warning('当前零件包 C001-C9999 自动组件编号已用完，请手工填写当前零件包内唯一组件编号');
        return;
      }
      lineForm.componentNo = componentNo;
    }
    lineForm.parentComponentNo = '';
    return;
  }
  lineForm.componentNo = '';
  if (lineForm.structureType === 'STANDALONE_PART') {
    lineForm.parentComponentNo = '';
  }
}

async function queryMaterials(keyword: string, callback: (items: InventoryMaterialSuggestion[]) => void) {
  const requestId = ++materialSearchSeq.value;
  callback([]);
  try {
    const rows = await erpApi.inventoryMaterialSuggestions(
      keyword.trim(),
      undefined,
      'ALL',
      undefined,
      undefined,
      activeBom.value?.customerId || filters.customerId || undefined,
      activeBom.value?.projectModel || filters.projectModel.trim() || undefined
    );
    if (requestId === materialSearchSeq.value) {
      callback(rows);
    }
  } catch {
    if (requestId === materialSearchSeq.value) {
      callback([]);
    }
  }
}

async function selectMaterial(item: InventoryMaterialSuggestion) {
  const materialId = item.materialId || (await resolveSuggestionMaterialId(item));
  if (!materialId) {
    ElMessage.warning('该建议未匹配到启用的零件基础资料，请先在零件基础库维护后再加入 BOM');
    clearLineMaterialSelection(false);
    return;
  }
  const keyword = formatLineMaterialKeyword(item);
  lineForm.materialId = materialId;
  lineForm.materialKeyword = keyword;
  lineForm.selectedMaterialKeyword = keyword;
  lineForm.materialStatus = 'ENABLED';
  lineForm.defaultDrawingRevisionId = '';
  lineForm.partThickness = Number(item.partThickness ?? 0) > 0 ? Number(item.partThickness) : 0;
  lineFormOriginalPartThickness.value = null;
  lineFormOriginalPartThicknessSource.value = null;
  void loadLineDrawingRevisions(materialId);
}

async function resolveSuggestionMaterialId(item: InventoryMaterialSuggestion) {
  const matched = await erpApi.inventoryMaterialByPartCode(item.partCode, 'ENABLED');
  return matched?.id || '';
}

function formatLineMaterialKeyword(item: Pick<MaterialMemory | ModelBomLine | InventoryMaterialSuggestion, 'partCode' | 'partName'>) {
  return `${item.partCode} / ${item.partName}`;
}

function handleLineMaterialKeywordInput(value: string) {
  if (!lineForm.materialId || value === lineForm.selectedMaterialKeyword) {
    return;
  }
  // 手工改动零件关键词后必须清空旧选择，避免显示新关键词但保存旧 materialId。
  clearLineMaterialSelection(false);
}

function handleLineMaterialClear() {
  clearLineMaterialSelection(true);
}

function clearLineMaterialSelection(resetKeyword: boolean) {
  if (resetKeyword) {
    lineForm.materialKeyword = '';
  }
  lineForm.materialId = '';
  lineForm.selectedMaterialKeyword = '';
  lineForm.materialStatus = 'ENABLED';
  lineForm.defaultDrawingRevisionId = '';
  lineForm.partThickness = 0;
  lineFormOriginalPartThickness.value = null;
  lineFormOriginalPartThicknessSource.value = null;
  lineDrawingRevisions.value = [];
}

function splitDefaultProcessRoute(value: string) {
  return value
    .split(/(?:->|→|[、,，;；\n\r]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function handleLineDefaultProcessFilter(keyword: string) {
  lineDefaultProcessFilterKeyword.value = keyword;
}

function handleLineDefaultProcessVisibleChange(visible: boolean) {
  if (!visible) {
    lineDefaultProcessFilterKeyword.value = '';
  }
}

function handleLineDefaultProcessChange() {
  normalizeLineDefaultProcessSteps();
  lineDefaultProcessFilterKeyword.value = '';
}

function normalizeLineDefaultProcessSteps() {
  const seen = new Set<string>();
  const steps: string[] = [];
  for (const step of lineForm.defaultProcessRouteSteps) {
    const processName = step.trim();
    const key = normalizeSearchKeyword(processName);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    steps.push(processName);
  }
  lineForm.defaultProcessRouteSteps = steps;
}

function startDefaultProcessDrag(event: DragEvent, index: number) {
  draggedDefaultProcessIndex.value = index;
  defaultProcessDragOverIndex.value = index;
  defaultProcessDragInsertAfter.value = false;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function handleDefaultProcessDragOver(event: DragEvent, index: number) {
  if (draggedDefaultProcessIndex.value === null) {
    return;
  }
  defaultProcessDragOverIndex.value = index;
  defaultProcessDragInsertAfter.value = isDefaultProcessDragAfterRowMiddle(event);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function handleDefaultProcessListDragLeave(event: DragEvent) {
  if (draggedDefaultProcessIndex.value === null) {
    return;
  }
  const listElement = event.currentTarget;
  const nextElement = event.relatedTarget;
  if (listElement instanceof HTMLElement && nextElement instanceof Node && listElement.contains(nextElement)) {
    return;
  }
  defaultProcessDragOverIndex.value = null;
  defaultProcessDragInsertAfter.value = false;
}

function handleDefaultProcessListDragOverEnd(event: DragEvent) {
  if (draggedDefaultProcessIndex.value === null || lineForm.defaultProcessRouteSteps.length === 0) {
    return;
  }
  defaultProcessDragOverIndex.value = lineForm.defaultProcessRouteSteps.length - 1;
  defaultProcessDragInsertAfter.value = true;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function dropDefaultProcess(event: DragEvent, index: number) {
  if (draggedDefaultProcessIndex.value === null) {
    endDefaultProcessDrag();
    return;
  }
  const insertionIndex = index + (isDefaultProcessDragAfterRowMiddle(event) ? 1 : 0);
  reorderDefaultProcessStep(draggedDefaultProcessIndex.value, insertionIndex);
  endDefaultProcessDrag();
}

function dropDefaultProcessAtEnd() {
  if (draggedDefaultProcessIndex.value === null) {
    endDefaultProcessDrag();
    return;
  }
  reorderDefaultProcessStep(draggedDefaultProcessIndex.value, lineForm.defaultProcessRouteSteps.length);
  endDefaultProcessDrag();
}

function endDefaultProcessDrag() {
  resetDefaultProcessDragState();
  // 拖拽排序完成后清理工序下拉筛选关键字，避免残留过滤条件影响下一次选择。
  lineDefaultProcessFilterKeyword.value = '';
}

function resetDefaultProcessDragState() {
  draggedDefaultProcessIndex.value = null;
  defaultProcessDragOverIndex.value = null;
  defaultProcessDragInsertAfter.value = false;
}

function isDefaultProcessDragAfterRowMiddle(event: DragEvent) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const rect = target.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

function reorderDefaultProcessStep(index: number, insertionIndex: number) {
  if (index < 0 || index >= lineForm.defaultProcessRouteSteps.length) {
    return;
  }
  let target = Math.max(0, Math.min(insertionIndex, lineForm.defaultProcessRouteSteps.length));
  if (index < target) {
    target -= 1;
  }
  if (index === target) {
    return;
  }
  const steps = [...lineForm.defaultProcessRouteSteps];
  const [step] = steps.splice(index, 1);
  if (!step) {
    return;
  }
  steps.splice(target, 0, step);
  lineForm.defaultProcessRouteSteps = steps;
}

function removeDefaultProcessStep(index: number) {
  lineForm.defaultProcessRouteSteps.splice(index, 1);
  lineDefaultProcessFilterKeyword.value = '';
}

function formatLineFormThicknessStatusText() {
  if (lineForm.structureType === 'COMPONENT') {
    return '父级组件不维护自身厚度';
  }
  const thickness = Number(lineForm.partThickness ?? 0);
  if (thickness <= 0) {
    return '当前厚度需要核对';
  }
  if (lineFormOriginalPartThicknessSource.value === 'ORDER_HISTORY' && !shouldSubmitLinePartThickness(thickness)) {
    return `历史订单参考厚度 ${lineForm.partThickness}，尚未保存到当前 BOM`;
  }
  if (lineFormOriginalPartThicknessSource.value === 'ORDER_HISTORY') {
    return `已手工改为 ${lineForm.partThickness}，保存后写入当前 BOM 明细`;
  }
  return lineFormOriginalPartThicknessSource.value === 'BOM_LINE'
    ? `当前 BOM 明细厚度 ${lineForm.partThickness}`
    : `当前厚度 ${lineForm.partThickness}`;
}

function shouldSubmitLinePartThickness(lineThickness: number) {
  if (lineForm.structureType === 'COMPONENT') {
    return false;
  }
  if (lineForm.id && lineForm.id === thicknessReviewLineId.value) {
    return true;
  }
  if (lineFormOriginalPartThicknessSource.value !== 'ORDER_HISTORY') {
    return true;
  }
  const originalThickness = Number(lineFormOriginalPartThickness.value ?? 0);
  const unchangedHistoryThickness = Math.abs(lineThickness - originalThickness) < 0.0001;
  // 历史订单厚度只做普通编辑的参考值，不能因为保存其它字段而静默确认为当前 BOM 明细厚度。
  return !unchangedHistoryThickness;
}

async function saveLine() {
  if (guardDesktopOperation('保存包内明细')) {
    return;
  }
  if (!activeBom.value) {
    return;
  }
  if (!lineForm.id && activeBom.value.status === 'DISABLED') {
    ElMessage.warning('当前零件包已停用，请先恢复启用后再新增包内明细');
    return;
  }
  if (lineFormMaterialSelectionRisk.value) {
    ElMessage.warning(lineFormMaterialSelectionRisk.value);
    return;
  }
  if (!lineForm.materialId) {
    ElMessage.warning('请选择零件');
    return;
  }
  if (lineFormDuplicateLineRisk.value) {
    ElMessage.warning(lineFormDuplicateLineRisk.value);
    return;
  }
  if (lineForm.structureType === 'COMPONENT' && !normalizeComponentNo(lineForm.componentNo)) {
    ElMessage.warning('请填写组件编号');
    return;
  }
  if (lineForm.structureType === 'CHILD_PART' && !normalizeComponentNo(lineForm.parentComponentNo)) {
    ElMessage.warning('请选择所属组件');
    return;
  }
  if (lineFormComponentNoRisk.value) {
    ElMessage.warning(lineFormComponentNoRisk.value);
    return;
  }
  if (lineFormParentComponentRisk.value) {
    ElMessage.warning(lineFormParentComponentRisk.value);
    return;
  }
  if (lineForm.structureType === 'COMPONENT' && isComponentNoOutOfRange(lineForm.componentNo)) {
    ElMessage.warning('组件编号只支持 C001-C9999；自定义编号请不要使用 C 开头的非 C001-C9999 数字格式');
    return;
  }
  if (lineForm.defaultQuantity <= 0) {
    ElMessage.warning('默认数量必须大于 0');
    return;
  }
  const lineThickness = Number(lineForm.partThickness ?? 0);
  if (lineForm.structureType !== 'COMPONENT' && (!Number.isFinite(lineThickness) || lineThickness < 0)) {
    ElMessage.warning('默认厚度不能小于 0');
    return;
  }
  // 停用基础零件不能重新进入启用 BOM 推荐，后端保存接口也会再次校验。
  if (lineForm.status === 'ENABLED' && lineForm.materialStatus === 'DISABLED') {
    ElMessage.warning('当前基础零件已停用，请先在零件管理中启用基础资料，或将 BOM 明细保存为停用');
    return;
  }
  normalizeLineDefaultProcessSteps();
  const confirmedComponentMutation = await confirmLineComponentMutation();
  if (!confirmedComponentMutation) {
    return;
  }
  const shouldPromptOrderPreviewRefresh =
    routeTargetAction.value === 'editLine' && lineForm.id === routeTargetLineId.value && modelBomReturnPath.value === '/orders';
  const shouldSubmitPartThickness = shouldSubmitLinePartThickness(lineThickness);
  const shouldKeepHistoryThicknessPending =
    lineForm.structureType !== 'COMPONENT' &&
    lineFormOriginalPartThicknessSource.value === 'ORDER_HISTORY' &&
    Number(lineForm.partThickness ?? 0) > 0 &&
    !shouldSubmitPartThickness;
  const savedFromThicknessReview = Boolean(lineForm.id && lineForm.id === thicknessReviewLineId.value);
  const thicknessReviewBomIdBeforeSave = savedFromThicknessReview ? thicknessReviewBomId.value || activeBom.value.id : '';
  saving.value = true;
  try {
    // 父级组件由子零件拼接不提交厚度；历史订单预填厚度只有人工核对或手工改动后才写入当前 BOM 明细。
    const payloadPartThickness = shouldSubmitPartThickness ? lineThickness : undefined;
    const payload: SaveModelBomLinePayload = {
      materialId: lineForm.materialId,
      lineType: lineForm.structureType === 'COMPONENT' ? 'COMPONENT' : 'PART',
      partCategory: lineForm.partCategory.trim() || undefined,
      componentNo: lineForm.structureType === 'COMPONENT' ? normalizeComponentNo(lineForm.componentNo) : undefined,
      parentComponentNo: lineForm.structureType === 'CHILD_PART' ? normalizeComponentNo(lineForm.parentComponentNo) : undefined,
      defaultDrawingRevisionId: lineForm.defaultDrawingRevisionId || undefined,
      defaultProcessRoute: lineForm.defaultProcessRouteSteps.join('、') || undefined,
      partThickness: payloadPartThickness,
      defaultQuantity: lineForm.defaultQuantity,
      sortOrder: lineForm.sortOrder,
      remark: lineForm.remark.trim() || undefined,
      status: lineForm.status
    };
    const savedLine = lineForm.id ? await erpApi.updateModelBomLine(lineForm.id, payload) : await erpApi.saveModelBomLine(activeBom.value.id, payload);
    lineDialogVisible.value = false;
    const successMessage = shouldPromptOrderPreviewRefresh
      ? shouldKeepHistoryThicknessPending
        ? 'BOM 明细已保存；历史厚度仍需核对，请回到订单页点击“刷新 BOM 预览”查看厚度核对提示'
        : 'BOM 明细已保存，请回到订单页点击“刷新 BOM 预览”后再确认带入草稿'
      : shouldKeepHistoryThicknessPending
        ? '包内零件已保存；历史厚度仍需核对，点击“厚度核对”后才会写入当前 BOM'
        : '包内零件已保存';
    ElMessage.success(successMessage);
    await loadModelBoms();
    await focusBomLine(savedLine.id);
    if (savedFromThicknessReview) {
      await continueThicknessReviewAfterSave(thicknessReviewBomIdBeforeSave, savedLine.id);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '包内零件保存失败，请检查组件关系、默认数量和后端服务');
  } finally {
    saving.value = false;
  }
}

async function confirmLineComponentMutation() {
  if (!lineFormComponentMutationNotice.value) {
    return true;
  }
  return openModelBomConfirmDialog({
    title: '确认组件结构变更',
    message: `${lineFormComponentMutationNotice.value}。确认继续保存吗？`,
    details: ['组件结构变更只影响当前 BOM 明细，不会覆盖历史订单、生产任务或库存记录。'],
    confirmButtonText: '继续保存',
    confirmButtonType: 'warning'
  });
}

async function disableLine(row: ModelBomLine) {
  if (guardDesktopOperation('停用包内明细')) {
    return;
  }
  if (saving.value || modelBomLineOperationSavingKey.value) {
    return;
  }
  const operationKey = modelBomLineOperationKey(row, 'disable');
  modelBomLineOperationSavingKey.value = operationKey;
  try {
    const confirmed = await confirmDisableLine(row);
    if (!confirmed) {
      return;
    }
    saving.value = true;
    const savedLine = await erpApi.disableModelBomLine(row.id);
    ElMessage.success(row.lineType === 'COMPONENT' ? '组件行已停用，所属子零件已同步停用' : '包内零件已停用');
    await loadModelBoms();
    await focusBomLine(savedLine.id);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '包内零件停用失败，请确认后端服务和当前 BOM 状态');
  } finally {
    saving.value = false;
    if (modelBomLineOperationSavingKey.value === operationKey) {
      modelBomLineOperationSavingKey.value = '';
    }
  }
}

async function confirmDisableLine(row: ModelBomLine) {
  const isComponentLine = row.lineType === 'COMPONENT';
  const enabledChildLines = isComponentLine ? enabledChildLinesForComponentLine(row) : [];
  const componentImpact =
    enabledChildLines.length > 0
      ? `该组件下 ${enabledChildLines.length} 个启用子零件会同步软停用，历史订单不受影响。${formatComponentMutationChildSummary(enabledChildLines)}`
      : '该组件下没有启用子零件需要同步停用，历史订单不受影响。';
  const message = isComponentLine
    ? `确定停用组件 ${normalizeComponentNo(row.componentNo) || row.partCode} / ${row.partName} 吗？${componentImpact}`
    : `确定停用包内零件 ${row.partCode} / ${row.partName} 吗？停用只影响后续推荐，不会删除历史订单或基础零件。`;
  return openModelBomConfirmDialog({
    title: isComponentLine ? '停用组件行' : '停用包内零件',
    message,
    details: ['停用只影响后续下单推荐，不会删除历史订单、生产任务、库存批次或库存流水。'],
    confirmButtonText: '停用',
    confirmButtonType: 'warning'
  });
}

async function enableLine(row: ModelBomLine) {
  if (guardDesktopOperation('启用包内明细')) {
    return;
  }
  if (row.materialStatus === 'DISABLED') {
    ElMessage.warning(`${row.partCode} / ${row.partName} 的基础零件已停用，请先在零件管理中启用基础资料，再启用 BOM 明细`);
    return;
  }
  if (saving.value || modelBomLineOperationSavingKey.value) {
    return;
  }
  const operationKey = modelBomLineOperationKey(row, 'enable');
  modelBomLineOperationSavingKey.value = operationKey;
  try {
    saving.value = true;
    const savedLine = await erpApi.updateModelBomLine(row.id, buildLinePayload(row, { status: 'ENABLED' }));
    ElMessage.success('包内零件已启用');
    await loadModelBoms();
    await focusBomLine(savedLine.id);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '包内零件启用失败，请确认所属组件和零件基础资料状态');
  } finally {
    saving.value = false;
    if (modelBomLineOperationSavingKey.value === operationKey) {
      modelBomLineOperationSavingKey.value = '';
    }
  }
}

</script>

<style scoped>
.page-subtitle {
  margin: 6px 0 0;
  color: #64748b;
}

.page-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.model-bom-alert {
  margin-bottom: 16px;
}

.bom-revision-panel {
  margin: 12px 0;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.bom-revision-panel__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}

.bom-revision-panel__header span {
  margin-left: 10px;
  color: #64748b;
  font-size: 13px;
}

.bom-revision-panel__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
  color: #64748b;
  font-size: 13px;
}

.model-bom-dialog-table-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
  color: #64748b;
  font-size: 13px;
}

.bom-revision-detail {
  display: grid;
  gap: 12px;
}

.bom-scope-approval-apply,
.bom-scope-approval-panel {
  display: grid;
  gap: 12px;
}

.bom-scope-approval-apply {
  margin-top: 12px;
}

.scope-approval-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.scope-approval-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.model-bom-confirm-panel {
  display: grid;
  gap: 10px;
  color: #475569;
  font-size: 14px;
  line-height: 1.65;
}

.model-bom-confirm-panel p {
  margin: 0;
}

.model-bom-confirm-panel ul {
  display: grid;
  gap: 6px;
  padding-left: 18px;
  margin: 0;
}

.model-bom-filter-summary {
  margin: -4px 0 14px;
  color: #475569;
  font-size: 13px;
}

.model-bom-scope-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: -2px 0 14px;
  color: #475569;
  font-size: 13px;
}

.model-bom-scope-summary > span {
  font-weight: 600;
}

.model-bom-scope-summary small {
  color: #64748b;
  line-height: 1.4;
}

.model-bom-scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 10px;
  color: #475569;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
}

.model-bom-scope-chip strong {
  color: #0f172a;
}

.model-bom-scope-chip.active {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #93c5fd;
}

.model-bom-scope-guide {
  display: grid;
  grid-template-columns: auto repeat(3, minmax(180px, 1fr)) auto;
  align-items: stretch;
  gap: 8px;
  margin: -4px 0 14px;
  color: #475569;
  font-size: 13px;
}

.model-bom-scope-guide-title {
  align-self: center;
  font-weight: 600;
  white-space: nowrap;
}

.model-bom-scope-guide-item {
  display: grid;
  gap: 3px;
  min-height: 54px;
  padding: 8px 10px;
  text-align: left;
  color: #475569;
  background: #ffffff;
  border: 1px solid #dbe4ef;
  border-radius: 6px;
  cursor: pointer;
}

.model-bom-scope-guide-item strong {
  color: #0f172a;
}

.model-bom-scope-guide-item span {
  line-height: 1.4;
}

.model-bom-scope-guide-item.active {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #93c5fd;
}

.model-bom-scope-guide small {
  align-self: center;
  color: #64748b;
  line-height: 1.4;
}

.common-bom-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  color: #475569;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: grab;
  font-size: 16px;
  line-height: 1;
}

.common-bom-drag-handle:active {
  cursor: grabbing;
}

.common-bom-drag-handle.is-drop-target {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
}

.common-bom-drag-handle.is-disabled {
  color: #94a3b8;
  background: #f8fafc;
  cursor: not-allowed;
}

.common-bom-sort-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: #475569;
  font-size: 13px;
  white-space: nowrap;
}

.model-bom-name-cell {
  display: grid;
  gap: 6px;
}

.model-bom-name-cell strong {
  color: #0f172a;
  overflow-wrap: anywhere;
}

.model-bom-name-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-bom-scope-cell {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  color: #334155;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-readonly-note {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  color: #64748b;
  font-size: 12px;
}

.bom-scope-customer-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.bom-scope-help {
  width: 100%;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.bom-scope-help--warning {
  color: #b45309;
}

.model-bom-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.model-bom-layout > .table-card {
  min-width: 0;
}

.model-bom-list-card {
  overflow: hidden;
}

.model-bom-list-table {
  width: 100%;
}

.model-bom-list-table :deep(.cell) {
  line-height: 1.45;
  overflow-wrap: anywhere;
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

.model-bom-detail-card {
  overflow: hidden;
  min-height: 520px;
}

.bom-structure-panel {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  overflow-x: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  scrollbar-gutter: stable both-edges;
}

.bom-structure-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.bom-structure-panel__header > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.bom-structure-panel__header span {
  color: #64748b;
  font-size: 12px;
}

.section-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.model-bom-table-height-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.model-bom-dialog-table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 4px 0 8px;
}

.model-bom-dialog-table-toolbar strong {
  color: #0f172a;
}

.empty-line-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.active-bom-disabled-alert {
  margin: 0 16px 12px;
}

.bom-summary-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.model-bom-structure-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.clickable-review-tag {
  cursor: pointer;
}

.clickable-review-tag:hover {
  filter: brightness(0.98);
}

.bom-thickness-review {
  display: grid;
  gap: 12px;
}

.bom-thickness-review-table {
  width: 100%;
}

.bom-thickness-review-table :deep(.bom-thickness-review-table__row) {
  cursor: pointer;
}

.bom-thickness-review-table :deep(.bom-thickness-review-table__row:hover > td) {
  background: #f8fafc;
}

.thickness-review-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
}

.thickness-review-reason {
  color: #475569;
  line-height: 1.5;
}

.bom-structure-list {
  display: grid;
  gap: 8px;
  min-width: 1040px;
}

.bom-structure-group {
  display: grid;
  gap: 6px;
}

.bom-structure-main,
.bom-structure-child {
  display: grid;
  grid-template-columns: 34px 118px minmax(220px, 1fr) minmax(280px, 1.4fr) minmax(96px, auto);
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fff;
}

.bom-structure-child {
  margin-left: 34px;
  background: #f0fdf4;
}

.bom-structure-index,
.bom-structure-child > span:first-child {
  color: #64748b;
  font-size: 12px;
}

.bom-structure-main strong,
.bom-structure-child strong,
.bom-structure-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bom-structure-meta {
  color: #475569;
  font-size: 12px;
}

.bom-structure-actions {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
}

.bom-line-table {
  min-height: 360px;
  max-height: min(72vh, 760px);
  overflow: auto;
  resize: vertical;
  scrollbar-gutter: stable both-edges;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.bom-line-row {
  position: relative;
  display: grid;
  grid-template-columns: 96px minmax(280px, 0.95fr) minmax(220px, 0.75fr) minmax(280px, 1fr) 126px minmax(300px, 1.05fr) minmax(260px, 0.9fr) 120px minmax(240px, 0.85fr) 120px 180px;
  min-width: 2220px;
  align-items: start;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}

.bom-line-row > div {
  min-width: 0;
  padding: 10px 12px;
  line-height: 1.45;
}

.bom-line-row--head {
  position: sticky;
  top: 0;
  z-index: 1;
  align-items: center;
  background: #f8fafc;
  color: #334155;
  font-weight: 600;
}

.bom-line-body .bom-line-row:last-child {
  border-bottom: 0;
}

.bom-line-row.is-dragging {
  opacity: 0.48;
}

.bom-line-row.is-route-highlighted {
  background: #eff6ff;
  box-shadow: inset 3px 0 0 #2563eb;
}

.bom-line-row.is-drop-before::before,
.bom-line-row.is-drop-after::after {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 2;
  height: 2px;
  content: '';
  background: #2563eb;
}

.bom-line-row.is-drop-before::before {
  top: 0;
}

.bom-line-row.is-drop-after::after {
  bottom: 0;
}

.bom-line-sort-cell,
.bom-line-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bom-line-actions {
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 4px 8px;
}

.bom-line-drag-handle {
  width: 28px;
  height: 28px;
  cursor: grab;
}

.bom-line-drag-handle:active {
  cursor: grabbing;
}

.bom-line-drag-handle:disabled {
  cursor: not-allowed;
}

.line-order-readonly {
  display: grid;
  gap: 4px;
}

.line-order-readonly span {
  width: fit-content;
  min-width: 48px;
  padding: 6px 12px;
  color: #0f172a;
  font-weight: 600;
  text-align: center;
  background: #f8fafc;
  border: 1px solid #dbe3ef;
  border-radius: 6px;
}

.line-order-readonly small {
  color: #64748b;
  line-height: 1.4;
}

.default-process-help {
  display: block;
  margin-top: 8px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
}

.route-target-line-alert {
  margin-bottom: 14px;
}

.default-process-step-list {
  display: grid;
  gap: 8px;
  width: min(420px, 100%);
  margin-top: 10px;
}

.default-process-step-row {
  position: relative;
  display: grid;
  grid-template-columns: 30px 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.default-process-step-row.is-dragging {
  opacity: 0.55;
}

.default-process-step-row.is-drop-before,
.default-process-step-row.is-drop-after {
  border-color: #60a5fa;
  background: #eff6ff;
}

.default-process-step-row.is-drop-before::before,
.default-process-step-row.is-drop-after::after {
  position: absolute;
  right: 8px;
  left: 8px;
  height: 2px;
  background: #2563eb;
  content: '';
}

.default-process-step-row.is-drop-before::before {
  top: -6px;
}

.default-process-step-row.is-drop-after::after {
  bottom: -6px;
}

.default-process-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
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

.default-process-drag-handle:active {
  cursor: grabbing;
}

.default-process-drag-handle:disabled {
  cursor: not-allowed;
}

.default-process-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #1d4ed8;
  background: #dbeafe;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.default-process-step-row strong {
  overflow: hidden;
  color: #0f172a;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bom-line-text {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: normal;
}

.bom-line-status-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fixed-format-textarea :deep(textarea) {
  min-height: 460px;
  font-family: Consolas, 'Courier New', monospace;
  line-height: 1.55;
  white-space: pre;
}

.bom-line-structure {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  white-space: normal;
}

.bom-line-structure .el-tag {
  max-width: 100%;
  justify-self: start;
}

.bom-line-structure span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.bom-line-structure--child-part {
  padding-left: 0;
}

.bom-scope-review {
  display: grid;
  gap: 12px;
}

.bom-scope-review-table {
  width: 100%;
}

.bom-scope-review-notes {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  color: #475569;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
}

.bom-scope-review-notes strong {
  color: #0f172a;
}

.bom-source-diff-panel {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid #fde68a;
  border-radius: 8px;
  background: #fffbeb;
}

.bom-source-diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.bom-source-diff-header > div {
  display: grid;
  gap: 3px;
}

.bom-source-diff-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.bom-source-diff-header span,
.bom-source-diff-item span,
.bom-source-diff-empty {
  color: #64748b;
  font-size: 12px;
}

.bom-source-diff-list {
  display: grid;
  gap: 8px;
}

.bom-source-diff-item {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  padding: 9px 10px;
  border-radius: 6px;
  background: #fff;
}

.bom-source-diff-item > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.bom-source-diff-item strong,
.bom-source-diff-item span {
  overflow-wrap: anywhere;
}

.bom-source-diff-item small {
  color: #15803d;
  font-size: 12px;
}

.bom-source-diff-action-hint {
  color: #b45309;
}

.bom-source-diff-item__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.source-bom-review {
  display: grid;
  gap: 12px;
}

.source-bom-review-summary {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.source-bom-review-summary > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.source-bom-review-summary span,
.source-bom-review-lines p {
  color: #64748b;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.source-bom-review-lines {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.source-bom-review-confirm-form {
  padding: 10px;
  border: 1px solid #dcfce7;
  border-radius: 8px;
  background: #f0fdf4;
}

.source-bom-review-confirm-form :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.source-bom-review-lines section {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.source-bom-review-table {
  width: 100%;
}

.source-bom-review-changed {
  color: #b45309;
  font-weight: 700;
}

@media (max-width: 1100px) {
  .model-bom-scope-guide {
    grid-template-columns: 1fr;
  }

  .model-bom-scope-guide-title {
    align-self: start;
  }

  .model-bom-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .page-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .bom-source-diff-item,
  .source-bom-review-summary,
  .source-bom-review-lines {
    grid-template-columns: 1fr;
  }

  .bom-source-diff-item__actions {
    justify-content: flex-start;
  }
}
</style>
