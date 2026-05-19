<template>
  <el-dialog
    :model-value="modelValue"
    :title="title || '库存来源详情'"
    width="min(1120px, calc(100vw - 32px))"
    append-to-body
    class="responsive-dialog inventory-source-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-alert
      :title="sourceGuardAlertTitle"
      :type="sourceGuardAlertType"
      :closable="false"
      class="source-warning"
    />

    <div v-if="reviewMode" class="source-search-panel">
      <div>
        <strong>库存查询</strong>
        <small>可按编码、名称、拼音、图号、客户历史或库存来源搜索；允许选择可替代零件，但必须逐批确认数量。</small>
      </div>
      <div class="source-search-controls">
        <el-autocomplete
          v-model="sourceSearchKeyword"
          :fetch-suggestions="queryInventorySuggestions"
          value-key="partCode"
          placeholder="编码/名称/拼音/图号/客户/库存来源"
          clearable
          popper-class="material-suggestion-popper"
          @input="handleSourceSearchKeywordInput"
          @select="handleInventorySuggestionSelect"
        >
          <template #default="{ item }">
            <MaterialSuggestionOption :item="item" />
          </template>
        </el-autocomplete>
        <el-button title="查询库存" @click="searchInventoryKeyword">查询库存</el-button>
        <el-button title="返回订单零件" v-if="expected?.partCode" @click="searchExpectedPart">返回订单零件</el-button>
      </div>
      <div v-if="sourceSearchManualPickRequired && lastInventorySuggestions.length" class="inventory-source-table-height-toolbar source-search-result-height-toolbar">
        <div class="inventory-source-table-height-actions" aria-label="替代物料搜索结果高度">
          <span class="inventory-source-table-height-label">替代物料搜索结果高度</span>
          <el-tooltip content="降低搜索结果高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="Minus"
              :disabled="inventorySourceDialogTableHeights.searchResults <= inventorySourceDialogTableHeightLimits.min"
              title="降低替代物料搜索结果高度"
              aria-label="降低替代物料搜索结果高度"
              @click="adjustInventorySourceDialogTableHeight('searchResults', -inventorySourceDialogTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="提高搜索结果高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="Plus"
              :disabled="inventorySourceDialogTableHeights.searchResults >= inventorySourceDialogTableHeightLimits.max"
              title="提高替代物料搜索结果高度"
              aria-label="提高替代物料搜索结果高度"
              @click="adjustInventorySourceDialogTableHeight('searchResults', inventorySourceDialogTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="恢复默认高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="RefreshLeft"
              :disabled="inventorySourceDialogTableHeights.searchResults === inventorySourceDialogTableDefaultHeights.searchResults"
              title="恢复替代物料搜索结果默认高度"
              aria-label="恢复替代物料搜索结果默认高度"
              @click="resetInventorySourceDialogTableHeight('searchResults')"
            />
          </el-tooltip>
        </div>
      </div>
      <div
        v-if="sourceSearchManualPickRequired && lastInventorySuggestions.length"
        class="source-search-results"
        :style="{ maxHeight: `${inventorySourceDialogTableHeights.searchResults}px` }"
      >
        <strong>{{ sourceSearchResultHint }}</strong>
        <button
          v-for="item in lastInventorySuggestions"
          :key="`${item.partCode}-${item.matchedBatchNo || 'all'}`"
          type="button"
          :title="inventorySuggestionPickTitle(item)"
          :aria-label="inventorySuggestionPickTitle(item)"
          class="source-search-result"
          @click="handleInventorySuggestionSelect(item)"
        >
          <MaterialSuggestionOption :item="item" />
        </button>
      </div>
      <div v-if="transformRulePanelVisible" v-loading="transformRuleLoading" class="transform-suggestion-panel">
        <div class="transform-suggestion-title">
          <div class="transform-suggestion-heading">
            <strong>来源加工建议</strong>
            <el-button size="small" link type="primary" @click="openTransformRulesPage">维护关系</el-button>
          </div>
          <span>查来源库存不会选中批次、不会扣库存，必须逐批勾选并确认。</span>
          <small class="transform-suggestion-count">{{ transformRuleSuggestionSummary }}</small>
        </div>
        <div v-if="transformRuleEmptyVisible" class="transform-suggestion-empty">
          本次订单零件暂无匹配的来源加工建议；需要使用半成品或通用件再加工时，请先维护来源加工关系。
        </div>
        <article v-for="rule in transformRuleSuggestions" :key="rule.id" class="transform-suggestion-item">
          <div>
            <strong>{{ rule.sourcePartCode }} / {{ rule.sourcePartName }}</strong>
            <el-tooltip :content="transformRuleScopeTitle(rule)" placement="top">
              <span class="transform-suggestion-meta">{{ transformRuleScopePreview(rule) }}</span>
            </el-tooltip>
            <small v-if="rule.defaultProcessRoute" :title="rule.defaultProcessRoute">建议工艺：{{ formatProcessRoutePreview(rule.defaultProcessRoute) }}</small>
            <el-tooltip v-if="rule.conversionDescription" :content="transformRuleDescriptionTitle(rule)" placement="top">
              <small class="transform-suggestion-description">{{ transformRuleDescriptionPreview(rule) }}</small>
            </el-tooltip>
          </div>
          <div class="transform-suggestion-action">
            <el-button size="small" type="primary" plain @click="searchTransformSource(rule)">
              查来源库存
            </el-button>
            <small>只切换搜索，不自动选用库存</small>
          </div>
        </article>
        <div v-if="transformRuleSuggestionHasMore" class="transform-suggestion-more">
          <el-button title="加载更多来源加工建议" size="small" plain :loading="transformRuleLoadingMore" @click="loadMoreTransformRuleSuggestions">
            加载更多来源加工建议
          </el-button>
        </div>
      </div>
    </div>

    <div v-loading="loading" class="source-detail-body">
      <div v-if="detail" class="source-summary">
        <div>
          <span>零件</span>
          <strong>{{ detail.partName || '-' }} / {{ detail.partCode }}</strong>
        </div>
        <div>
          <span>{{ sourceAvailableSummaryLabel }}</span>
          <strong>{{ formatQuantity(effectiveDetailAvailableQuantity, detail.unit) }}</strong>
        </div>
        <div>
          <span>{{ sourceBatchSummaryLabel }}</span>
          <strong>{{ detail.batchCount }} 批</strong>
        </div>
        <div>
          <span>{{ sourceCompositionSummaryLabel }}</span>
          <strong>{{ sourceCompositionSummaryText }}</strong>
          <small v-if="sourceKindSummaryVisible">{{ sourceKindSummaryText }}</small>
        </div>
      </div>

      <div v-if="expected && hasExpectedInfo" class="expected-card">
        <div class="expected-title">本次订单图纸要求</div>
        <div class="expected-grid">
          <span>图纸：{{ drawingTitle(expected) }}</span>
          <span>规格：{{ expected.partSpecification || '未填写' }}</span>
          <span>厚度：{{ expectedThicknessText }}</span>
        <span>本次需要：{{ expected.requiredQuantity != null ? formatQuantity(expected.requiredQuantity, expected.unit || '件') : '未填写' }}</span>
          <span>使用方式：{{ fulfillmentModeText }}</span>
        </div>
        <DrawingPreviewLink
          :file-name="expected.drawingFileName"
          :file-url="expected.drawingFileUrl"
          link-text="打开本次订单图纸"
          title="本次订单图纸"
        />
        <el-alert
          v-if="expectedOrderInfoReasons.length"
          :title="`本次订单资料不完整：${formatDialogReasonPreview(expectedOrderInfoReasons, '字段')}。仍可使用库存，但必须填写人工确认说明。`"
          type="warning"
          :closable="false"
          class="expected-warning"
        />
      </div>

      <div v-if="expected && hasExpectedInfo && detail" class="source-quantity-check">
        <span>图纸匹配库存：{{ formatQuantity(matchedQuantity, detail.unit) }}</span>
        <span>需确认或资料不完整：{{ formatQuantity(unmatchedQuantity, detail.unit) }}</span>
        <strong :class="{ danger: !stockReviewQuantityOk }">{{ stockReviewQuantityText }}</strong>
      </div>

      <div v-if="reviewMode && detail" class="source-bulk-actions">
        <div class="source-bulk-action-group">
          <span class="source-bulk-action-label">选用</span>
          <el-button size="small" type="primary" plain title="按默认顺序选用库存" @click="autoSelectSources">默认选用</el-button>
        </div>
        <div class="source-bulk-action-group">
          <span class="source-bulk-action-label">批量</span>
          <div class="source-bulk-quantity">
            <span>每批</span>
            <el-input-number
              v-model="bulkEachQuantity"
              :min="0"
              :precision="3"
              :controls="false"
              size="small"
              placeholder="数量"
            />
            <el-button size="small" title="按每批数量批量勾选库存" @click="bulkSelectSourcesByQuantity">勾选</el-button>
          </div>
        </div>
        <div class="source-bulk-action-group">
          <span class="source-bulk-action-label">选择</span>
          <el-button size="small" title="清空已选库存批次" @click="clearSelectedSources">清空</el-button>
        </div>
        <div class="source-bulk-note">
          默认优先使用数量少的库存批次；若先使用数量大的批次，必须填写说明。
        </div>
      </div>

      <div v-if="reviewMode && detail" class="source-selection-overview">
        <div>
          <span>本次需要</span>
          <strong>{{ formatQuantity(requiredQuantity, selectedQuantityUnit) }}</strong>
        </div>
        <div>
          <span>已选库存</span>
          <strong :class="{ danger: selectedQuantityOverRequired }">
            {{ formatQuantity(selectedQuantityTotal, selectedQuantityUnit) }}
          </strong>
        </div>
        <div>
          <span>{{ expected?.fulfillmentMode === 'STOCK' ? '按需生产' : '仍需领料' }}</span>
          <strong :class="{ danger: stockSelectionRemainingQuantity > 0 && expected?.fulfillmentMode !== 'STOCK' }">
            {{ formatQuantity(stockSelectionRemainingQuantity, selectedQuantityUnit) }}
          </strong>
        </div>
        <div>
          <span>已选批次</span>
          <strong>{{ selectedSourceRows.length }} 批</strong>
        </div>
      </div>

      <div v-if="reviewMode && selectedSourceRows.length" class="selected-source-card">
        <div class="selected-source-title">
          <div>
            <strong>已选库存批次</strong>
            <span>拖动左侧手柄调整扣库顺序；提交生产会按当前顺序消耗库存。这里会保留跨零件搜索后选中的批次；取消勾选某批次后，系统会从后续批次自动补足，不会再选回该批次。</span>
          </div>
          <div class="selected-source-actions">
            <div class="selected-source-action-group">
              <span class="selected-source-action-label">选用</span>
              <el-button size="small" title="按默认顺序选用库存" @click="autoSelectSources">默认选用</el-button>
              <el-button size="small" title="按当前顺序重算使用数量" @click="rebalanceCurrentSelectedSourcesByQueue">重算</el-button>
            </div>
            <div class="selected-source-action-group">
              <span class="selected-source-action-label">选择</span>
              <el-button size="small" title="清空已选库存批次" @click="clearSelectedSources">清空</el-button>
            </div>
          </div>
        </div>
        <div
          class="selected-source-list"
          @dragover.self.prevent="handleSelectedSourceListDragOverEnd"
          @dragleave="handleSelectedSourceListDragLeave"
          @drop.self.prevent="dropSelectedSourceAtEnd"
        >
          <article
            v-for="(source, index) in selectedSourceRows"
            :key="source.batchId"
            class="selected-source-item"
            :class="{
              'is-dragging': draggedSelectedSourceIndex === index,
              'is-drop-before': selectedSourceDragOverIndex === index && !selectedSourceDragInsertAfter,
              'is-drop-after': selectedSourceDragOverIndex === index && selectedSourceDragInsertAfter
            }"
            @dragenter.prevent="handleSelectedSourceDragOver($event, index)"
            @dragover.prevent="handleSelectedSourceDragOver($event, index)"
            @drop.prevent="dropSelectedSource($event, index)"
          >
            <div class="selected-source-order-cell">
              <button
                type="button"
                class="selected-source-drag-handle"
                draggable="true"
                title="拖拽调整使用顺序"
                aria-label="拖拽调整使用顺序"
                @dragstart.stop="startSelectedSourceDrag($event, index)"
                @dragend="endSelectedSourceDrag"
              >
                <el-icon><Rank /></el-icon>
              </button>
              <span>{{ index + 1 }}</span>
            </div>
            <div>
              <strong>{{ source.batchNo || source.batchId }}</strong>
              <span>{{ source.partCode || '-' }} / {{ source.partName || '-' }}</span>
              <small>{{ formatQuantity(source.quantity, source.unit || expected?.unit || detail?.unit || '件') }}</small>
              <small class="selected-source-availability-note">
                {{ selectedSourceAvailabilityText(source) }}
              </small>
              <small v-if="selectedSourceReplenishmentText(source)" class="selected-source-replenishment-note">
                {{ selectedSourceReplenishmentText(source) }}
              </small>
              <small v-if="source.manualConfirmedBy" class="selected-source-manual-note">
                人工确认：{{ source.manualConfirmedBy }}
                <template v-if="source.manualConfirmedAt"> / {{ formatDateTime(source.manualConfirmedAt) }}</template>
                <template v-if="source.manualConfirmRemark">
                  /
                  <span class="selected-source-manual-remark" :title="manualConfirmationRemarkTitle(source)">
                    {{ manualConfirmationRemarkPreview(source) }}
                  </span>
                </template>
              </small>
            </div>
            <div class="selected-source-quantity-editor">
              <span>使用数量</span>
              <el-input-number
                :model-value="source.quantity"
                :min="0"
                :max="selectedSourceMaxQuantity(source)"
                :precision="3"
                :controls="false"
                size="small"
                @change="handleSelectedSourceQuantityChange(source, $event)"
              />
            </div>
            <el-tag v-if="selectedSourceQueuePlaceholder(source)" type="info" effect="plain">队列占位</el-tag>
            <el-tag v-else-if="sourceNeedsManualConfirmation(source)" type="warning" effect="plain">
              <span :title="manualConfirmationReasonTitle(source)">{{ manualConfirmationReasonPreview(source) }}</span>
            </el-tag>
            <el-tag v-else type="success" effect="plain">已匹配</el-tag>
            <div class="selected-source-row-actions">
              <div class="selected-source-action-group">
                <span class="selected-source-action-label">定位</span>
                <el-button link size="small" title="查看该库存" @click="focusSelectedSource(source)">查看</el-button>
              </div>
              <div class="selected-source-action-group">
                <span class="selected-source-action-label">顺序</span>
                <el-button link size="small" title="上移库存扣减顺序" :disabled="index === 0" @click="moveSelectedSource(index, -1)">上移</el-button>
                <el-button link size="small" title="下移库存扣减顺序" :disabled="index === selectedSourceRows.length - 1" @click="moveSelectedSource(index, 1)">下移</el-button>
              </div>
              <div class="selected-source-action-group">
                <span class="selected-source-action-label">选择</span>
                <el-button link type="danger" title="移除已选库存批次" @click="removeSelectedSource(source.batchId)">移除</el-button>
              </div>
            </div>
          </article>
        </div>
      </div>

      <div v-if="reviewMode && selectedIssueSources.length" class="manual-confirm-card">
        <div class="manual-confirm-title">
          <strong>库存人工确认</strong>
          <span>已选库存存在资料差异、资料不完整或使用顺序异常，必须填写记录后才能确认。</span>
        </div>
        <div class="manual-confirm-issues">
          <article v-for="item in selectedIssueSourceForms" :key="item.source.batchId" class="manual-confirm-item">
            <div class="manual-confirm-item-head">
              <el-tag type="warning" effect="plain">
                {{ item.source.batchNo || item.source.batchId }}
              </el-tag>
              <span class="manual-confirm-reason" :title="manualConfirmationReasonTitle(item.source)">
                {{ manualConfirmationReasonPreview(item.source, 42) }}
              </span>
            </div>
            <div class="manual-confirm-form">
              <label>
                <span>确认人员</span>
                <el-input v-model="item.form.confirmedBy" placeholder="填写操作人员姓名" />
              </label>
              <label>
                <span>确认时间</span>
                <el-input :model-value="formatDateTime(item.form.confirmedAt)" disabled />
              </label>
              <label class="manual-confirm-remark">
                <span>说明</span>
                <el-input
                  v-model="item.form.remark"
                  type="textarea"
                  :rows="2"
                  placeholder="例如：该库存产品可替用；需要改工后使用；客户已确认规格差异；图纸缺失但实物已核对。"
                />
              </label>
            </div>
          </article>
        </div>
      </div>

      <div v-if="detail" class="inventory-source-table-height-toolbar">
        <div class="inventory-source-table-height-actions" aria-label="库存来源批次表格高度">
          <span class="inventory-source-table-height-label">库存来源批次表格高度</span>
          <el-tooltip content="降低表格高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="Minus"
              :disabled="inventorySourceDialogTableHeights.sources <= inventorySourceDialogTableHeightLimits.min"
              title="降低库存来源批次表格高度"

              aria-label="降低库存来源批次表格高度"
              @click="adjustInventorySourceDialogTableHeight('sources', -inventorySourceDialogTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="提高表格高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="Plus"
              :disabled="inventorySourceDialogTableHeights.sources >= inventorySourceDialogTableHeightLimits.max"
              title="提高库存来源批次表格高度"

              aria-label="提高库存来源批次表格高度"
              @click="adjustInventorySourceDialogTableHeight('sources', inventorySourceDialogTableHeightLimits.step)"
            />
          </el-tooltip>
          <el-tooltip content="恢复默认高度" placement="top">
            <el-button
              circle
              size="small"
              :icon="RefreshLeft"
              :disabled="inventorySourceDialogTableHeights.sources === inventorySourceDialogTableDefaultHeights.sources"
              title="恢复库存来源批次表格默认高度"
              aria-label="恢复库存来源批次表格默认高度"
              @click="resetInventorySourceDialogTableHeight('sources')"
            />
          </el-tooltip>
        </div>
      </div>
      <el-table
        v-if="detail"
        class="desktop-table"
        :data="sourceRows"
        :row-class-name="sourceRowClassName"
        :max-height="inventorySourceDialogTableHeights.sources"
        border
      >
        <el-table-column v-if="reviewMode" label="本次使用" width="180" fixed="left">
          <template #default="{ row }">
            <div class="source-selection-cell">
              <el-checkbox :model-value="isSourceSelected(row)" @change="handleSourceChecked(row, $event)">
                选用
              </el-checkbox>
              <el-input-number
                :model-value="selectedSourceQuantity(row)"
                :min="0"
                :max="sourceMaxSelectableQuantity(row)"
                :precision="3"
                :controls="false"
                size="small"
                @change="handleSourceQuantityChange(row, $event)"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="库存批次" min-width="220">
          <template #default="{ row }">
            <div class="cell-main batch-cell-main">
              <span>{{ row.batchNo }}</span>
              <el-tag v-if="isFocusedSource(row)" type="primary" size="small" effect="plain">当前批次</el-tag>
            </div>
            <div class="cell-subtext">{{ sourceTypeText(row.inventorySourceType) }} / {{ sourceKindText(row.sourceKind) }}</div>
            <div v-if="row.partCategory" class="cell-subtext">类型 {{ row.partCategory }}</div>
            <div v-if="row.projectModel" class="cell-subtext">项目 {{ row.projectModel }}</div>
            <div v-if="sourceComponentText(row)" class="cell-subtext">{{ sourceComponentText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="可用库存" width="135">
          <template #default="{ row }">
            <div>{{ formatQuantity(row.quantity, row.unit) }}</div>
            <div v-if="row.physicalQuantity !== undefined" class="cell-subtext">
              账面 {{ formatQuantity(row.physicalQuantity, row.unit) }}
            </div>
            <el-tooltip v-if="row.reservedQuantity" :content="reservationSummary(row)" placement="top">
              <div class="cell-subtext warning-text">
                已预占 {{ formatQuantity(row.reservedQuantity, row.unit) }}
              </div>
            </el-tooltip>
            <div v-if="draftReservedQuantity(row)" class="cell-subtext warning-text">
              本订单其他零件已选 {{ formatQuantity(draftReservedQuantity(row), row.unit) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="hasReservedSources" label="预占订单" min-width="240">
          <template #default="{ row }">
            <div v-if="row.reservations?.length" class="reservation-list">
              <div v-for="reservation in displayReservations(row)" :key="reservation.id" class="reservation-item">
                <div>
                  <el-button
                    v-if="reservation.orderNo"
                    link
                    type="primary"
                    class="inline-order-link reservation-order-link"
                    @click="openOrderPreview(reservation.orderNo)"
                  >
                    {{ reservation.orderNo }}
                  </el-button>
                  <span v-else class="reservation-order-link">草稿订单</span>
                  <span class="reservation-quantity">
                    {{ formatQuantity(reservation.quantity, reservation.unit || row.unit) }}
                  </span>
                </div>
                <small>{{ reservation.partName || reservation.partCode || '-' }}</small>
              </div>
            </div>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="仓库 / 库位" min-width="170">
          <template #default="{ row }">{{ row.warehouseName || '-' }} / {{ row.locationName || '-' }}</template>
        </el-table-column>
        <el-table-column label="匹配订单" min-width="170">
          <template #default="{ row }">
            <el-button v-if="row.sourceOrderNo" link type="primary" class="inline-order-link" @click="openOrderPreview(row.sourceOrderNo)">
              {{ row.sourceOrderNo }}
            </el-button>
            <span v-else class="muted">备货库存</span>
            <div v-if="row.sourceCustomerName" class="cell-subtext">{{ row.sourceCustomerName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="生产来源" min-width="210">
          <template #default="{ row }">
            <el-button v-if="productionOrderNo(row)" link type="primary" class="inline-order-link" @click="openOrderPreview(productionOrderNo(row))">
              {{ productionOrderNo(row) }}
            </el-button>
            <span v-else class="muted">未记录来源订单</span>
            <div class="cell-subtext">{{ row.sourceProductionTaskNo || '未记录生产任务' }}</div>
            <div v-if="replenishmentSourceText(row)" class="cell-subtext">{{ replenishmentSourceText(row) }}</div>
            <div v-if="sourceComponentText(row)" class="cell-subtext">{{ sourceComponentText(row) }}</div>
            <div v-if="productionCustomerName(row)" class="cell-subtext">{{ productionCustomerName(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="生产日期" width="125">
          <template #default="{ row }">{{ formatDate(row.productionDate || row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="图纸信息" min-width="220">
          <template #default="{ row }">
            <div class="cell-main">{{ drawingTitle(row) }}</div>
            <DrawingPreviewLink
              :file-name="row.drawingFileName"
              :file-url="row.drawingFileUrl"
              link-text="打开图纸"
              :title="`${row.partName || row.partCode} 库存图纸`"
            />
            <span v-if="!row.drawingFileUrl" class="muted">未上传图纸</span>
          </template>
        </el-table-column>
        <el-table-column v-if="expected && hasExpectedInfo" label="适用判断" min-width="190">
          <template #default="{ row }">
            <el-tag :type="compatibilityResult(row).type" effect="plain">
              {{ compatibilityResult(row).label }}
            </el-tag>
            <div v-if="compatibilityResult(row).reason" class="cell-subtext warning-text">
              <span :title="compatibilityReasonTitle(row)">{{ compatibilityReasonPreview(row) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="规格 / 厚度" min-width="170">
          <template #default="{ row }">
            <div>{{ row.partSpecification || '-' }}</div>
            <div class="cell-subtext">{{ row.partThickness ? `${row.partThickness} mm` : '-' }}</div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="detail" class="mobile-section source-mobile-list">
        <article
          v-for="row in sourceRows"
          :key="row.id || row.batchNo"
          class="mobile-card source-mobile-card mobile-order-card"
          :class="{ expanded: isMobileSourceBatchExpanded(sourceBatchCardKey(row)) }"
        >
          <div class="mobile-card-header">
            <div class="mobile-card-title">
              <strong>{{ row.batchNo }}</strong>
              <small>
                {{ sourceTypeText(row.inventorySourceType) }} / {{ sourceKindText(row.sourceKind) }} /
                可用 {{ formatQuantity(row.quantity, row.unit) }}
                <template v-if="row.physicalQuantity !== undefined"> / 账面 {{ formatQuantity(row.physicalQuantity, row.unit) }}</template>
                <template v-if="row.reservedQuantity"> / 已预占 {{ formatQuantity(row.reservedQuantity, row.unit) }}</template>
              </small>
              <small v-if="draftReservedQuantity(row)" class="warning-text">
                本订单其他零件已选 {{ formatQuantity(draftReservedQuantity(row), row.unit) }}
              </small>
              <small v-if="row.partCategory">类型 {{ row.partCategory }}</small>
              <small v-if="sourceComponentText(row)">{{ sourceComponentText(row) }}</small>
              <small v-if="row.projectModel">项目 {{ row.projectModel }}</small>
              <small v-if="row.reservedQuantity" class="warning-text">{{ reservationSummary(row) }}</small>
            </div>
            <div class="mobile-card-header-actions source-mobile-header-actions">
              <el-tag v-if="expected && hasExpectedInfo" :type="compatibilityResult(row).type" effect="plain">
                {{ compatibilityResult(row).label }}
              </el-tag>
              <el-button link type="primary" @click="toggleMobileSourceBatch(sourceBatchCardKey(row))">
                {{ isMobileSourceBatchExpanded(sourceBatchCardKey(row)) ? '收起' : '详情' }}
              </el-button>
            </div>
          </div>

          <div class="mobile-card-compact-summary source-mobile-compact-summary">
            <span>{{ row.partCode || '-' }}</span>
            <span>{{ row.warehouseName || '-' }} / {{ row.locationName || '-' }}</span>
            <span>{{ drawingTitle(row) }}</span>
          </div>

          <div v-if="reviewMode" class="mobile-source-selection">
            <el-checkbox :model-value="isSourceSelected(row)" @change="handleSourceChecked(row, $event)">
              选用该批次
            </el-checkbox>
            <el-input-number
              :model-value="selectedSourceQuantity(row)"
              :min="0"
              :max="sourceMaxSelectableQuantity(row)"
              :precision="3"
              :controls="false"
              @change="handleSourceQuantityChange(row, $event)"
            />
          </div>

          <div v-show="isMobileSourceBatchExpanded(sourceBatchCardKey(row))" class="mobile-card-fields">
            <div class="mobile-field">
              <label>仓库 / 库位</label>
              <span>{{ row.warehouseName || '-' }} / {{ row.locationName || '-' }}</span>
            </div>
            <div class="mobile-field">
              <label>匹配订单</label>
              <span>
                <el-button v-if="row.sourceOrderNo" link type="primary" class="inline-order-link" @click="openOrderPreview(row.sourceOrderNo)">
                  {{ row.sourceOrderNo }}
                </el-button>
                <span v-else>备货库存</span>
              </span>
            </div>
            <div class="mobile-field">
              <label>生产来源</label>
              <span>
                <el-button v-if="productionOrderNo(row)" link type="primary" class="inline-order-link" @click="openOrderPreview(productionOrderNo(row))">
                  {{ productionOrderNo(row) }}
                </el-button>
                <span v-else>未记录来源订单</span>
              </span>
            </div>
            <div class="mobile-field">
              <label>生产任务</label>
              <span>{{ row.sourceProductionTaskNo || '-' }}</span>
            </div>
            <div v-if="replenishmentSourceText(row)" class="mobile-field">
              <label>补单来源</label>
              <span>{{ replenishmentSourceText(row) }}</span>
            </div>
            <div v-if="sourceComponentText(row)" class="mobile-field">
              <label>组件关系</label>
              <span>{{ sourceComponentText(row) }}</span>
            </div>
            <div class="mobile-field">
              <label>生产日期</label>
              <span>{{ formatDate(row.productionDate || row.createdAt) }}</span>
            </div>
            <div class="mobile-field">
              <label>图纸信息</label>
              <span>{{ drawingTitle(row) }}</span>
            </div>
            <div class="mobile-field">
              <label>规格 / 厚度</label>
              <span>{{ row.partSpecification || '-' }} / {{ row.partThickness ? `${row.partThickness} mm` : '-' }}</span>
            </div>
            <div v-if="expected && hasExpectedInfo && compatibilityResult(row).reason" class="mobile-field">
              <label>适用说明</label>
              <span class="warning-text" :title="compatibilityReasonTitle(row)">{{ compatibilityReasonPreview(row, 38) }}</span>
            </div>
          </div>

          <div v-show="isMobileSourceBatchExpanded(sourceBatchCardKey(row))" class="mobile-card-actions">
            <DrawingPreviewLink
              :file-name="row.drawingFileName"
              :file-url="row.drawingFileUrl"
              link-text="打开图纸"
              :title="`${row.partName || row.partCode} 库存图纸`"
            />
          </div>
        </article>
      </div>

      <div v-if="sourcePaginationVisible" class="source-pagination-row">
        <span>
          第 {{ sourcePaginationCurrentPage }} 页，已显示 {{ sourceRows.length }} /
          {{ sourcePaginationTotal }} 批库存来源
        </span>
        <el-pagination
          background
          layout="prev, pager, next"
          :current-page="sourcePaginationCurrentPage"
          :page-size="sourcePaginationPageSize"
          :total="sourcePaginationTotal"
          :disabled="loading"
          @current-change="handleSourcePageChange"
        />
      </div>

      <el-empty v-if="detail && adjustedSourceRows.length === 0" :description="sourceEmptyDescription" />
    </div>

    <template v-if="reviewMode" #footer>
      <div class="source-dialog-footer">
        <div class="source-confirm-left">
          <el-checkbox v-model="reviewConfirmChecked">
            已核对库存批次、订单/任务、图号、版本、图纸文件、规格和厚度
          </el-checkbox>
          <span class="source-confirm-hint">{{ confirmHint }}</span>
        </div>
        <div class="source-dialog-actions">
          <el-button title="关闭" @click="emit('update:modelValue', false)">关闭</el-button>
          <el-button
            type="primary"
            :disabled="!canConfirmReview"
            @click="confirmReviewed"

            title="确认已核对库存来源">
            确认已核对库存来源
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <el-dialog
    v-model="orderPreviewVisible"
    title="订单信息"
    width="min(920px, calc(100vw - 32px))"
    append-to-body
    class="responsive-dialog order-preview-dialog"
  >
    <div v-loading="orderPreviewLoading" class="order-preview-body">
      <template v-if="orderPreview">
        <div class="order-preview-summary">
          <div>
            <span>订单号</span>
            <strong>{{ orderPreview.orderNo }}</strong>
          </div>
          <div>
            <span>客户</span>
            <strong>{{ orderPreview.customerName }}</strong>
          </div>
          <div>
            <span>订单日期</span>
            <strong>{{ formatDate(orderPreview.orderDate) }}</strong>
          </div>
          <div>
            <span>交期</span>
            <strong>{{ formatDate(orderPreview.deliveryDate) || '-' }}</strong>
          </div>
          <div>
            <span>状态</span>
            <StatusTag :value="orderDisplayStatus(orderPreview)" compact />
          </div>
        </div>
        <div class="inventory-source-table-height-toolbar order-preview-table-height-toolbar">
          <div class="inventory-source-table-height-actions" aria-label="订单信息预览表格高度">
            <span class="inventory-source-table-height-label">订单信息预览表格高度</span>
            <el-tooltip content="降低表格高度" placement="top">
              <el-button
                circle
                size="small"
                :icon="Minus"
                :disabled="inventorySourceDialogTableHeights.orderPreview <= inventorySourceDialogTableHeightLimits.min"
                title="降低订单信息预览表格高度"

                aria-label="降低订单信息预览表格高度"
                @click="adjustInventorySourceDialogTableHeight('orderPreview', -inventorySourceDialogTableHeightLimits.step)"
              />
            </el-tooltip>
            <el-tooltip content="提高表格高度" placement="top">
              <el-button
                circle
                size="small"
                :icon="Plus"
                :disabled="inventorySourceDialogTableHeights.orderPreview >= inventorySourceDialogTableHeightLimits.max"
                title="提高订单信息预览表格高度"

                aria-label="提高订单信息预览表格高度"
                @click="adjustInventorySourceDialogTableHeight('orderPreview', inventorySourceDialogTableHeightLimits.step)"
              />
            </el-tooltip>
            <el-tooltip content="恢复默认高度" placement="top">
              <el-button
                circle
                size="small"
                :icon="RefreshLeft"
                :disabled="inventorySourceDialogTableHeights.orderPreview === inventorySourceDialogTableDefaultHeights.orderPreview"
                title="恢复订单信息预览表格默认高度"
                aria-label="恢复订单信息预览表格默认高度"
                @click="resetInventorySourceDialogTableHeight('orderPreview')"
              />
            </el-tooltip>
          </div>
        </div>
        <el-table :data="orderPreview.lines" border :max-height="inventorySourceDialogTableHeights.orderPreview">
          <el-table-column prop="partCode" label="零件编码" min-width="130" />
          <el-table-column prop="partName" label="零件名称" min-width="150" />
          <el-table-column label="客户订单" width="120">
            <template #default="{ row }">{{ formatQuantity(row.quantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="生产计划" width="120">
            <template #default="{ row }">{{ formatQuantity(row.productionPlanQuantity, row.unit) }}</template>
          </el-table-column>
          <el-table-column label="图纸" min-width="170">
            <template #default="{ row }">
              <div>{{ drawingTitle(row) }}</div>
              <DrawingPreviewLink :file-name="row.drawingFileName" :file-url="row.drawingFileUrl" link-text="打开图纸" />
            </template>
          </el-table-column>
          <el-table-column label="规格 / 厚度" min-width="170">
            <template #default="{ row }">
              <div>{{ row.partSpecification || '-' }}</div>
              <div class="cell-subtext">{{ row.partThickness ? `${row.partThickness} mm` : '-' }}</div>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <el-empty v-else-if="!orderPreviewLoading" description="未找到订单信息" />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';
import DrawingPreviewLink from './DrawingPreviewLink.vue';
import MaterialSuggestionOption from './MaterialSuggestionOption.vue';
import StatusTag from './StatusTag.vue';
import { erpApi, type StockSourceSelectionPayload } from '../api/erp';
import type {
  InventoryMaterialSuggestion,
  InventorySourceBatchDetail,
  InventorySourceDetailResponse,
  InventorySourceExpected,
  InventorySourceType,
  MaterialTransformRule,
  OrderDetail
} from '../types/erp';
import { formatDate, formatDateTime, formatDateTimeInputValue, formatQuantity } from '../utils/format';
import { orderDisplayStatus } from '../utils/orderStatus';

const router = useRouter();
const props = defineProps<{
  modelValue: boolean;
  loading?: boolean;
  title?: string;
  referenceOnly?: boolean;
  detail?: InventorySourceDetailResponse | null;
  expected?: InventorySourceExpected | null;
  reviewMode?: boolean;
  reviewed?: boolean;
  focusBatchId?: string;
  focusBatchNo?: string;
  selectedSources?: StockSourceSelectionPayload[];
  draftReservedSources?: StockSourceSelectionPayload[];
  excludeOrderNo?: string;
  excludeOrderId?: string;
  customerId?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirmReviewed: [];
  sourceSearch: [partCode: string];
  selectionChange: [sources: StockSourceSelectionPayload[]];
  sourcePageChange: [offset: number];
}>();

type CompatibilityStatus = NonNullable<StockSourceSelectionPayload['compatibilityStatus']>;
type ManualConfirmForm = {
  confirmedBy: string;
  confirmedAt: Date;
  remark: string;
  reasonKey: string;
};

const selectedSourceCompatibilityRank: Record<CompatibilityStatus, number> = {
  MATCHED: 0,
  NEEDS_CONFIRMATION: 1,
  INCOMPLETE: 2,
  UNKNOWN: 3
};

const sourceGuardAlertTitle = computed(() =>
  props.referenceOnly
    ? '当前仅用于核对零件基础资料、图纸和历史来源；当前筛选范围没有可用库存批次，不能作为库存使用确认。'
    : '使用库存前必须核对生产订单、任务号、图号、版本和图纸文件；资料不一致、来源不完整或使用顺序异常时，必须逐批填写人工确认说明。'
);
const sourceGuardAlertType = computed(() => (props.referenceOnly ? 'info' : 'warning'));
const sourceEmptyDescription = computed(() =>
  props.referenceOnly ? '当前范围没有库存批次，仅展示零件基础资料和历史来源核对结果' : '当前条件下没有可用库存来源'
);
const sourceAvailableSummaryLabel = computed(() => (props.referenceOnly ? '当前范围可用' : '当前可用'));
const sourceBatchSummaryLabel = computed(() => (props.referenceOnly ? '当前范围批次' : '库存批次'));
const sourceCompositionSummaryLabel = computed(() => (props.referenceOnly ? '资料状态' : '来源构成'));
const sourceCompositionSummaryText = computed(() =>
  props.referenceOnly ? '无可用库存批次' : `订单 ${props.detail?.orderSourceCount || 0} / 备货 ${props.detail?.stockSourceCount || 0}`
);
type SourceRow = InventorySourceBatchDetail & {
  backendAvailableQuantity?: number;
  draftReservedQuantity?: number;
};
type SelectedSourceRow = StockSourceSelectionPayload & {
  currentAvailableQuantity?: number;
};
type InventorySourceDialogTableKey = 'sources' | 'searchResults' | 'orderPreview';

const inventorySourceDialogTableHeightLimits = {
  min: 280,
  max: 760,
  step: 80
};
const inventorySourceDialogTableDefaultHeights: Record<InventorySourceDialogTableKey, number> = {
  sources: 520,
  searchResults: 280,
  orderPreview: 360
};
const inventorySourceDialogTableHeightStorageKey = 'baisheng.erp.inventorySourceDialogTableHeights.v1';
// 库存来源弹窗表格和搜索结果高度只保存为本机 UI 偏好，不写入库存批次、预占、订单、生产或库存流水业务数据。
const inventorySourceDialogTableHeights = reactive<Record<InventorySourceDialogTableKey, number>>({
  ...inventorySourceDialogTableDefaultHeights
});

const expected = computed(() => props.expected || null);
const sourceSearchKeyword = ref('');
const sourceSearchSelectedLabel = ref('');
const activeSearchFocusBatchNo = ref('');
const inventorySuggestionRequestSeq = ref(0);
const lastInventorySuggestions = ref<InventoryMaterialSuggestion[]>([]);
const sourceSearchManualPickRequired = ref(false);
const reviewConfirmChecked = ref(false);
const bulkEachQuantity = ref(1);
const manualConfirmForms = ref<Record<string, ManualConfirmForm>>({});
const expandedMobileSourceBatchKeys = ref<string[]>([]);
const draggedSelectedSourceIndex = ref<number | null>(null);
const selectedSourceDragOverIndex = ref<number | null>(null);
const selectedSourceDragInsertAfter = ref(false);
const orderPreviewVisible = ref(false);
const orderPreviewLoading = ref(false);
const orderPreview = ref<OrderDetail | null>(null);
const orderPreviewRequestSeq = ref(0);
const transformRuleLoading = ref(false);
const transformRuleLoadingMore = ref(false);
const transformRuleRequestSeq = ref(0);
const transformRuleSuggestions = ref<MaterialTransformRule[]>([]);
const transformRuleSuggestionTotal = ref(0);
const transformRuleSuggestionOffset = ref(0);
const transformRuleSuggestionHasMore = ref(false);
const transformRuleSuggestionLimit = Number(5);
const transformRulePanelVisible = computed(() =>
  Boolean(props.reviewMode && expected.value?.partCode && (transformRuleLoading.value || transformRuleRequestSeq.value > 0))
);
const transformRuleEmptyVisible = computed(() =>
  Boolean(transformRulePanelVisible.value && !transformRuleLoading.value && transformRuleSuggestions.value.length === 0)
);
const transformRuleSuggestionSummary = computed(() => {
  if (transformRuleLoading.value && transformRuleSuggestions.value.length === 0) {
    return '正在加载来源加工建议';
  }
  if (transformRuleSuggestionTotal.value <= 0) {
    return '未匹配到来源加工建议';
  }
  return `已显示 ${transformRuleSuggestions.value.length} / ${transformRuleSuggestionTotal.value} 条来源加工建议`;
});
const sourceSearchResultHint = computed(() => {
  if (lastInventorySuggestions.value.some((item) => item.hasIdentityConflict)) {
    return '同编码存在多套历史资料，请点击候选项确认';
  }
  return lastInventorySuggestions.value.length > 1 ? '匹配到多个零件，请选择具体零件' : '匹配到相似零件，请选择确认';
});

function splitDefaultProcessRoute(value: string) {
  return value
    .split(/(?:->|→|[、,，;；\n\r]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatProcessRoutePreview(value?: string | null, emptyText = '-') {
  const steps = splitDefaultProcessRoute(String(value || ''));
  if (steps.length === 0) {
    return emptyText;
  }
  const preview = steps.filter((_, index) => index < 3).join('、');
  return steps.length > 3 ? `${preview} 等 ${steps.length} 个工序` : preview;
}

function formatLongTextPreview(value?: string | null, maxLength = 32, emptyText = '-') {
  const text = String(value || '').trim();
  if (!text) {
    return emptyText;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function inventorySuggestionPickTitle(item: InventoryMaterialSuggestion) {
  const materialText = [item.partCode, item.partName].filter(Boolean).join(' / ') || '该库存物料';
  const unit = item.unit || expected.value?.unit || props.detail?.unit || '件';
  const availableText = `可用 ${formatQuantity(item.availableQuantity, unit)}`;
  const batchText = item.matchedBatchNo ? `批次 ${item.matchedBatchNo}` : '';
  const riskText = item.hasIdentityConflict ? '存在同编码多套历史资料，选择前请核对图号、规格、厚度和项目型号。' : '';
  return ['选择库存物料', materialText, availableText, batchText, riskText].filter(Boolean).join('；');
}

function transformRuleScopePreview(rule: MaterialTransformRule) {
  return `${formatLongTextPreview(rule.scopeLabel, 24, '未设置范围')} / 倍率 ${rule.multiplier} / 损耗 ${rule.lossRate ?? '-'}`;
}

function transformRuleScopeTitle(rule: MaterialTransformRule) {
  const description = String(rule.conversionDescription || '').trim();
  return [
    `适用范围：${formatLongTextPreview(rule.scopeLabel, 24, '未设置范围')}`,
    `倍率：${rule.multiplier}`,
    `损耗：${rule.lossRate ?? '-'}`,
    description ? `说明：${description}` : '',
    '来源加工关系只提供库存来源建议；完整范围请进入来源加工关系详情核对，不会自动扣库存或自动选中批次'
  ]
    .filter(Boolean)
    .join('。');
}

function transformRuleDescriptionPreview(rule: MaterialTransformRule) {
  return `转换说明：${formatLongTextPreview(rule.conversionDescription, 36, '-')}`;
}

function transformRuleDescriptionTitle(rule: MaterialTransformRule) {
  return String(rule.conversionDescription || '').trim() || '-';
}

const draftReservedQuantityByBatchId = computed(() => {
  const rows = new Map<string, number>();
  for (const source of props.draftReservedSources || []) {
    const batchId = source.batchId?.trim();
    const quantity = Number(source.quantity ?? 0);
    if (!batchId || quantity <= 0) {
      continue;
    }
    rows.set(batchId, (rows.get(batchId) ?? 0) + quantity);
  }
  return rows;
});
const adjustedSourceRows = computed<SourceRow[]>(() =>
  (props.detail?.sources || []).map((row) => {
    const draftReservedQuantity = draftReservedQuantityByBatchId.value.get(row.id) ?? 0;
    const backendAvailableQuantity = row.quantity;
    return {
      ...row,
      backendAvailableQuantity,
      draftReservedQuantity,
      quantity: Math.max(Math.round((backendAvailableQuantity - draftReservedQuantity + Number.EPSILON) * 1000) / 1000, 0),
      reservedQuantity: Number(row.reservedQuantity ?? 0) + draftReservedQuantity
    };
  })
);
const sourceRows = computed(() => {
  const rows = adjustedSourceRows.value;
  if (
    !props.reviewMode &&
    !props.focusBatchId &&
    !props.focusBatchNo &&
    !activeSearchFocusBatchNo.value &&
    (!expected.value || !hasExpectedInfo.value)
  ) {
    return rows;
  }
  // 操作人员优先看到当前正在核对的批次；下单核对时，再把图纸匹配库存排在前面。
  return rows
    .map((row, index) => ({ row, index, rank: sourceRowRank(row) }))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        compatibilityRank(left.row) - compatibilityRank(right.row) ||
        left.row.quantity - right.row.quantity ||
        left.index - right.index
    )
    .map((item) => item.row);
});
const sourcePaginationTotal = computed(() => Number(props.detail?.totalSourceCount ?? 0));
const sourcePaginationPageSize = computed(() => Math.max(Number(props.detail?.sourceLimit ?? props.detail?.sources.length ?? 20), 1));
const sourcePaginationOffset = computed(() => Math.max(Number(props.detail?.sourceOffset ?? 0), 0));
const sourcePaginationCurrentPage = computed(() => Math.floor(sourcePaginationOffset.value / sourcePaginationPageSize.value) + 1);
const sourcePaginationVisible = computed(() =>
  Boolean(!props.reviewMode && props.detail && props.detail.totalSourceCount !== undefined && sourcePaginationTotal.value > sourcePaginationPageSize.value)
);
const mobileSourceBatchStateKey = computed(() =>
  (props.detail?.sources || []).map((row) => sourceBatchCardKey(row)).join('|')
);

function handleSourcePageChange(page: number) {
  emit('sourcePageChange', Math.max(page - 1, 0) * sourcePaginationPageSize.value);
}

function sourceBatchCardKey(row: Pick<InventorySourceBatchDetail, 'id' | 'batchNo'>) {
  return row.id || row.batchNo || '';
}

function isMobileSourceBatchExpanded(key: string) {
  return expandedMobileSourceBatchKeys.value.includes(key);
}

function toggleMobileSourceBatch(key: string) {
  expandedMobileSourceBatchKeys.value = isMobileSourceBatchExpanded(key)
    ? expandedMobileSourceBatchKeys.value.filter((item) => item !== key)
    : [...expandedMobileSourceBatchKeys.value, key];
}

const hasReservedSources = computed(() =>
  adjustedSourceRows.value.some((row) => Number(row.reservedQuantity ?? 0) > 0 || Boolean(row.reservations?.length))
);
const selectedSourceRows = computed<SelectedSourceRow[]>(() => {
  const sourceMap = new Map(adjustedSourceRows.value.map((row) => [row.id, row]));
  return normalizeSelectedSources(props.selectedSources || []).map((source) => {
    const row = sourceMap.get(source.batchId);
    if (!row) {
      const draftReservedQuantity = draftReservedQuantityByBatchId.value.get(source.batchId) ?? 0;
      const sourceAvailableQuantity = Number(source.availableQuantity ?? source.quantity ?? 0);
      return {
        ...source,
        availableQuantity: sourceAvailableQuantity,
        currentAvailableQuantity: Math.max(Math.round((sourceAvailableQuantity - draftReservedQuantity + Number.EPSILON) * 1000) / 1000, 0)
      };
    }
    const compatibility = compatibilityResult(row);
    const nextCompatibilityStatus = selectionCompatibilityStatus(row);
    const nextCompatibilityReason = selectionCompatibilityReason(compatibility);
    const manualConfirmationSource = selectedSourceManualConfirmationSource(
      source,
      undefined,
      nextCompatibilityStatus,
      nextCompatibilityReason
    );
    return {
      ...source,
      batchNo: row.batchNo || source.batchNo,
      partCode: row.partCode || source.partCode,
      partName: row.partName || source.partName,
      unit: row.unit || source.unit,
      availableQuantity: sourceBackendAvailableQuantity(row),
      currentAvailableQuantity: row.quantity,
      replenishmentSourceType: row.replenishmentSourceType || source.replenishmentSourceType,
      replenishmentSourceRequestNo: row.replenishmentSourceRequestNo || source.replenishmentSourceRequestNo,
      replenishmentSourceLabel: row.replenishmentSourceLabel || source.replenishmentSourceLabel,
      compatibilityStatus: nextCompatibilityStatus,
      compatibilityReason: nextCompatibilityReason,
      manualConfirmedBy: manualConfirmationSource?.manualConfirmedBy?.trim(),
      manualConfirmedAt: manualConfirmationSource?.manualConfirmedAt?.trim(),
      manualConfirmRemark: manualConfirmationSource?.manualConfirmRemark?.trim()
    };
  });
});
const selectedSourceMap = computed(() => new Map(selectedSourceRows.value.map((source) => [source.batchId, source])));
const requiredQuantity = computed(() => Number(expected.value?.requiredQuantity ?? 0));
const selectedQuantityTotal = computed(() => selectedSourceRows.value.reduce((sum, source) => sum + source.quantity, 0));
const selectedQuantityUnit = computed(() => expected.value?.unit || props.detail?.unit || '件');
const stockSelectionRemainingQuantity = computed(() => Math.max(requiredQuantity.value - selectedQuantityTotal.value, 0));
const hasReviewableSource = computed(() => Boolean(props.detail && (props.detail.sources.length > 0 || selectedSourceRows.value.length > 0)));
const selectedQuantityOverRequired = computed(
  () => props.reviewMode && requiredQuantity.value > 0 && selectedQuantityTotal.value > requiredQuantity.value + 0.0001
);
const selectedQuantityOverAvailableSource = computed(() =>
  selectedSourceRows.value.find((source) => {
    const availableQuantity = selectedSourceCurrentAvailableQuantity(source);
    return source.quantity > availableQuantity + 0.0001;
  })
);
const selectedIssueSources = computed(() =>
  selectedSourceRows.value.filter((source) => Number(source.quantity ?? 0) > 0 && sourceNeedsManualConfirmation(source))
);

function selectedSourceQueuePlaceholder(source: StockSourceSelectionPayload) {
  return Number(source.quantity ?? 0) <= 0;
}

const selectedIssueSourceForms = computed(() =>
  selectedIssueSources.value.map((source) => ({
    source,
    form: ensureManualConfirmForm(source)
  }))
);
const directStockBlockedIssue = computed(() => {
  if (!props.reviewMode) {
    return '';
  }
  const missingReviewSource = selectedSourceRows.value.find((source) => Number(source.quantity ?? 0) > 0 && !source.compatibilityStatus);
  if (!missingReviewSource) {
    return '';
  }
  return `已选库存批次 ${
    missingReviewSource.batchNo || missingReviewSource.batchId
  } 缺少库存来源核对结果，请重新打开库存来源并确认后再保存。`;
});
const matchedQuantity = computed(() =>
  adjustedSourceRows.value.reduce(
    (sum, row) => sum + (compatibilityResult(row).label === '图纸匹配' ? row.quantity : 0),
    0
  )
);
const effectiveDetailAvailableQuantity = computed(() =>
  Math.max(Math.round((adjustedSourceRows.value.reduce((sum, row) => sum + row.quantity, 0) + Number.EPSILON) * 1000) / 1000, 0)
);
const unmatchedQuantity = computed(() => Math.max(effectiveDetailAvailableQuantity.value - matchedQuantity.value, 0));
const fulfillmentModeText = computed(() => {
  if (expected.value?.fulfillmentMode === 'STOCK') {
    return '使用库存';
  }
  if (expected.value?.fulfillmentMode === 'REWORK') {
    return '库存再加工';
  }
  return '重新生产';
});
const expectedMissingInfoReasons = computed(() => {
  const row = expected.value;
  if (!row) {
    return [];
  }
  return [
    !normalizeValue(row.drawingNo) ? '缺图号' : '',
    !normalizeValue(row.drawingVersion) ? '缺图纸版本' : '',
    !normalizeValue(row.drawingDate) ? '缺图纸日期' : '',
    !normalizeValue(row.drawingStatus) ? '缺图纸状态' : '',
    !normalizeValue(row.partSpecification) ? '缺成品规格' : '',
    expectedRequiresThickness.value && Number(row.partThickness ?? 0) <= 0 ? '缺零件厚度' : ''
  ].filter(Boolean);
});
const expectedRequiresThickness = computed(() => expected.value?.lineType !== 'COMPONENT');
const expectedThicknessText = computed(() => {
  if (!expectedRequiresThickness.value) {
    return '不适用（父级组件由子零件维护）';
  }
  return expected.value?.partThickness ? `${expected.value.partThickness} mm` : '未填写';
});
const expectedFileMissingReasons = computed(() => {
  const row = expected.value;
  if (!row) {
    return [];
  }
  return [
    !normalizeValue(row.drawingFileName) ? '缺图纸文件名' : '',
    !normalizeValue(row.drawingFileUrl) ? '缺图纸文件' : ''
  ].filter(Boolean);
});
const expectedOrderInfoReasons = computed(() => [...expectedMissingInfoReasons.value, ...expectedFileMissingReasons.value]);
const stockReviewQuantityOk = computed(() => {
  if (!hasReviewableSource.value) {
    return false;
  }
  const detail = props.detail;
  if (!detail) {
    return false;
  }
  if (props.reviewMode) {
    if (selectedQuantityOverAvailableSource.value) {
      return false;
    }
    if (expected.value?.fulfillmentMode === 'STOCK') {
      return selectedQuantityTotal.value > 0 && !selectedQuantityOverRequired.value;
    }
    return selectedQuantityTotal.value > 0 && !selectedQuantityOverRequired.value;
  }
  if (expected.value?.fulfillmentMode === 'STOCK') {
    return effectiveDetailAvailableQuantity.value > 0;
  }
  return effectiveDetailAvailableQuantity.value + 0.0001 >= requiredQuantity.value;
});
const stockReviewQuantityText = computed(() => {
  if (!props.detail || (!props.detail.sources.length && !selectedSourceRows.value.length)) {
    return '没有可用库存';
  }
  if (props.reviewMode) {
    if (selectedQuantityTotal.value <= 0) {
      return '请先选择要使用的库存批次和数量';
    }
    if (selectedQuantityOverRequired.value) {
      return `已选 ${formatQuantity(selectedQuantityTotal.value, expected.value?.unit || props.detail.unit)}，超过本次需要 ${formatQuantity(requiredQuantity.value, expected.value?.unit || props.detail.unit)}`;
    }
    if (selectedQuantityOverAvailableSource.value) {
      const source = selectedQuantityOverAvailableSource.value;
      return `已选库存批次 ${source.batchNo || source.batchId} 超过当前可用：可用 ${formatQuantity(
        selectedSourceCurrentAvailableQuantity(source),
        source.unit || expected.value?.unit || props.detail.unit
      )}，已选 ${formatQuantity(source.quantity, source.unit || expected.value?.unit || props.detail.unit)}`;
    }
    if (expected.value?.fulfillmentMode === 'STOCK') {
      const shortageQuantity = Math.max(requiredQuantity.value - selectedQuantityTotal.value, 0);
      return shortageQuantity > 0
        ? `已选库存 ${formatQuantity(selectedQuantityTotal.value, expected.value?.unit || props.detail.unit)}，按需生产 ${formatQuantity(shortageQuantity, expected.value?.unit || props.detail.unit)}`
        : `已选 ${formatQuantity(selectedQuantityTotal.value, expected.value?.unit || props.detail.unit)}，库存已覆盖本次需要`;
    }
    if (selectedQuantityTotal.value + 0.0001 < requiredQuantity.value) {
      return `已选 ${formatQuantity(selectedQuantityTotal.value, expected.value?.unit || props.detail.unit)}，仍需补选 ${formatQuantity(
        Math.max(requiredQuantity.value - selectedQuantityTotal.value, 0),
        expected.value?.unit || props.detail.unit
      )}；草稿可先保存，提交生产前必须补齐`;
    }
    return `已选 ${formatQuantity(selectedQuantityTotal.value, expected.value?.unit || props.detail.unit)}，满足本次需要`;
  }
  if (expected.value?.fulfillmentMode === 'STOCK' && !stockReviewQuantityOk.value) {
    return '没有可用库存，请改为重新生产';
  }
  if (expected.value?.fulfillmentMode === 'REWORK') {
    return '库存再加工允许使用需确认库存，但必须保留来源记录';
  }
  return '库存数量满足当前选择';
});
const manualConfirmationOk = computed(() => {
  if (!selectedIssueSources.value.length) {
    return true;
  }
  return selectedIssueSourceForms.value.every((item) =>
    Boolean(item.form.confirmedBy.trim() && manualConfirmDateValid(item.form.confirmedAt) && item.form.remark.trim())
  );
});
const canConfirmReview = computed(() =>
  Boolean(!props.loading && stockReviewQuantityOk.value && !directStockBlockedIssue.value && reviewConfirmChecked.value && manualConfirmationOk.value)
);
const sourceKindSummaryText = computed(() => {
  const rows = adjustedSourceRows.value;
  if (!rows.length) {
    return '';
  }
  const quantityMap = rows.reduce<Record<string, number>>((map, row) => {
    const key = row.sourceKind || 'NORMAL_ORDER';
    map[key] = (map[key] || 0) + row.quantity;
    return map;
  }, {});
  return Object.entries(quantityMap)
    .map(([kind, quantity]) => `${sourceKindText(kind)} ${formatQuantity(quantity, props.detail?.unit || '件')}`)
    .join(' / ');
});
const sourceKindSummaryVisible = computed(() => !props.referenceOnly && Boolean(sourceKindSummaryText.value));
const confirmHint = computed(() => {
  if (props.loading) {
    return '正在查询库存来源...';
  }
  if (!hasReviewableSource.value) {
    return '当前没有可用库存来源，不能确认使用库存。';
  }
  if (!stockReviewQuantityOk.value) {
    return stockReviewQuantityText.value;
  }
  if (directStockBlockedIssue.value) {
    return directStockBlockedIssue.value;
  }
  if (!manualConfirmationOk.value) {
    return '已选不适配库存，请填写确认人员、确认时间和使用说明。';
  }
  if (!reviewConfirmChecked.value) {
    return '请先勾选人工核对确认。';
  }
  return props.reviewed ? '已核对；如果零件、图号、版本、规格或厚度被修改，需要重新核对。' : '请确认库存来源、生产任务、图号、版本和图纸文件后再保存订单。';
});
const hasExpectedInfo = computed(() => {
  const row = expected.value;
  return Boolean(row?.drawingNo || row?.drawingVersion || row?.drawingFileName || row?.partThickness || row?.partSpecification);
});

function resetTransformRuleSuggestions() {
  transformRuleSuggestions.value = [];
  transformRuleSuggestionTotal.value = 0;
  transformRuleSuggestionOffset.value = 0;
  transformRuleSuggestionHasMore.value = false;
  transformRuleLoadingMore.value = false;
}

async function loadTransformRuleSuggestions(append = false) {
  const targetPartCode = expected.value?.partCode?.trim();
  const requestId = append ? transformRuleRequestSeq.value : ++transformRuleRequestSeq.value;
  if (!props.modelValue || !props.reviewMode || !targetPartCode) {
    resetTransformRuleSuggestions();
    transformRuleLoading.value = false;
    return;
  }
  if (append) {
    if (transformRuleLoading.value || transformRuleLoadingMore.value || !transformRuleSuggestionHasMore.value) {
      return;
    }
    transformRuleLoadingMore.value = true;
  } else {
    resetTransformRuleSuggestions();
    transformRuleLoading.value = true;
  }
  try {
    const result = await erpApi.materialTransformRulesPage({
      targetPartCode,
      customerId: props.customerId || undefined,
      projectModel: expected.value?.projectModel?.trim() || undefined,
      status: 'ENABLED',
      limit: transformRuleSuggestionLimit,
      offset: append ? transformRuleSuggestionOffset.value : 0
    });
    if (requestId === transformRuleRequestSeq.value) {
      const rows = result.items.filter((row) => row.sourceMaterialStatus !== 'DISABLED');
      transformRuleSuggestions.value = append ? [...transformRuleSuggestions.value, ...rows] : rows;
      transformRuleSuggestionTotal.value = result.totalCount;
      transformRuleSuggestionOffset.value = result.offset + result.items.length;
      transformRuleSuggestionHasMore.value = result.hasMore;
    }
  } catch {
    if (requestId === transformRuleRequestSeq.value) {
      if (!append) {
        resetTransformRuleSuggestions();
      }
    }
  } finally {
    if (requestId === transformRuleRequestSeq.value) {
      transformRuleLoading.value = false;
      transformRuleLoadingMore.value = false;
    }
  }
}

function loadMoreTransformRuleSuggestions() {
  void loadTransformRuleSuggestions(true);
}

function searchTransformSource(rule: MaterialTransformRule) {
  resetReviewConfirmation();
  sourceSearchManualPickRequired.value = false;
  activeSearchFocusBatchNo.value = '';
  lastInventorySuggestions.value = [];
  sourceSearchKeyword.value = `${rule.sourcePartCode} ${rule.sourcePartName}`;
  sourceSearchSelectedLabel.value = sourceSearchKeyword.value;
  emit('sourceSearch', rule.sourcePartCode);
  ElMessage.info('已按来源加工关系切换到来源零件库存；系统未自动选用批次，请逐批勾选并人工确认');
}

function openTransformRulesPage() {
  const query: Record<string, string> = {
    status: 'ENABLED'
  };
  const targetPartCode = expected.value?.partCode?.trim();
  const projectModel = expected.value?.projectModel?.trim();
  if (targetPartCode) {
    query.targetPartCode = targetPartCode;
  }
  if (props.customerId) {
    query.customerId = props.customerId;
  }
  if (projectModel) {
    query.projectModel = projectModel;
  }
  emit('update:modelValue', false);
  void router.push({ path: '/inventory/material-transforms', query });
}

async function queryInventorySuggestions(keyword: string, callback: (items: InventoryMaterialSuggestion[]) => void) {
  const requestId = ++inventorySuggestionRequestSeq.value;
  sourceSearchManualPickRequired.value = false;
  try {
    const result = await erpApi.inventoryMaterialSuggestions(
      keyword.trim(),
      undefined,
      'STOCK',
      props.excludeOrderNo,
      props.excludeOrderId,
      props.customerId
    );
    if (requestId === inventorySuggestionRequestSeq.value) {
      lastInventorySuggestions.value = result;
      callback(result);
    }
  } catch {
    if (requestId === inventorySuggestionRequestSeq.value) {
      lastInventorySuggestions.value = [];
      callback([]);
    }
  }
}

function handleInventorySuggestionSelect(item: InventoryMaterialSuggestion) {
  resetReviewConfirmation();
  if (item.hasIdentityConflict) {
    ElMessage.warning(`零件编码 ${item.partCode} 存在多套历史资料，已按当前候选切换库存来源，请核对${materialIdentityConflictFieldsText(item)}`);
  }
  sourceSearchManualPickRequired.value = false;
  lastInventorySuggestions.value = [item];
  activeSearchFocusBatchNo.value = item.matchedBatchNo || '';
  sourceSearchKeyword.value = item.partName ? `${item.partCode} ${item.partName}` : item.partCode;
  sourceSearchSelectedLabel.value = sourceSearchKeyword.value;
  emit('sourceSearch', item.partCode);
}

function normalizeSourceSearchLabel(value: string) {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function handleSourceSearchKeywordInput(value: string) {
  if (!sourceSearchSelectedLabel.value || normalizeSourceSearchLabel(value) === normalizeSourceSearchLabel(sourceSearchSelectedLabel.value)) {
    return;
  }
  // 手工改动库存来源搜索词后清理旧候选和批次聚焦，避免显示新关键词但仍高亮上一次选择的库存批次。
  activeSearchFocusBatchNo.value = '';
  sourceSearchManualPickRequired.value = false;
  lastInventorySuggestions.value = [];
  sourceSearchSelectedLabel.value = '';
}

function canAutoSwitchInventorySuggestion(item: InventoryMaterialSuggestion, matchKind: 'EXACT' | 'FUZZY') {
  // 库存来源替代搜索只有唯一精确命中且无同编码多套资料风险时才允许自动切换；唯一模糊命中也必须人工点击候选项。
  return matchKind === 'EXACT' && !item.hasIdentityConflict;
}

function warnInventorySuggestionNeedsManualPick(item: InventoryMaterialSuggestion) {
  if (item.hasIdentityConflict) {
    ElMessage.warning(`零件编码 ${item.partCode} 存在多套历史资料，请核对${materialIdentityConflictFieldsText(item)}，并点击候选项人工确认后再切换库存来源`);
  }
}

function materialIdentityConflictFieldsText(item: InventoryMaterialSuggestion) {
  return item.identityConflictFields?.length ? formatDialogReasonPreview(item.identityConflictFields, '字段') : '图号、规格、厚度和项目型号';
}

function formatDialogReasonPreview(values: Array<string | null | undefined>, unitLabel: string, emptyText = '-') {
  const filtered = values.map((value) => String(value || '').trim()).filter(Boolean);
  if (filtered.length === 0) {
    return emptyText;
  }
  const preview = filtered.filter((_, index) => index < 3).join('、');
  return filtered.length > 3 ? `${preview} 等 ${filtered.length} 个${unitLabel}` : preview;
}

function keepInventorySuggestionManualPick(item: InventoryMaterialSuggestion) {
  activeSearchFocusBatchNo.value = '';
  sourceSearchManualPickRequired.value = true;
  lastInventorySuggestions.value = [item];
  warnInventorySuggestionNeedsManualPick(item);
}

async function searchInventoryKeyword() {
  const keyword = sourceSearchKeyword.value.trim();
  resetReviewConfirmation();
  if (!keyword) {
    activeSearchFocusBatchNo.value = '';
    sourceSearchManualPickRequired.value = false;
    lastInventorySuggestions.value = [];
    if (expected.value?.partCode) {
      emit('sourceSearch', expected.value.partCode);
    }
    sourceSearchSelectedLabel.value = '';
    return;
  }

  const exactMatches = lastInventorySuggestions.value.filter(
    (item) => normalizeValue(item.partCode) === normalizeValue(keyword) || normalizeValue(item.partName) === normalizeValue(keyword)
  );
  if (exactMatches.length === 1) {
    const exact = exactMatches[0];
    if (!canAutoSwitchInventorySuggestion(exact, 'EXACT')) {
      keepInventorySuggestionManualPick(exact);
      return;
    }
    sourceSearchManualPickRequired.value = false;
    lastInventorySuggestions.value = [exact];
    activeSearchFocusBatchNo.value = exact.matchedBatchNo || '';
    sourceSearchKeyword.value = exact.partName ? `${exact.partCode} ${exact.partName}` : exact.partCode;
    sourceSearchSelectedLabel.value = exact.partName ? `${exact.partCode} ${exact.partName}` : exact.partCode;
    emit('sourceSearch', exact.partCode);
    return;
  }
  if (exactMatches.length > 1) {
    activeSearchFocusBatchNo.value = '';
    sourceSearchManualPickRequired.value = true;
    lastInventorySuggestions.value = exactMatches;
    ElMessage.warning('匹配到多个精确零件，请从下拉列表中选择具体零件');
    return;
  }

  const requestId = ++inventorySuggestionRequestSeq.value;
  try {
    const suggestions = await erpApi.inventoryMaterialSuggestions(
      keyword,
      undefined,
      'STOCK',
      props.excludeOrderNo,
      props.excludeOrderId,
      props.customerId
    );
    if (requestId !== inventorySuggestionRequestSeq.value) {
      return;
    }
    lastInventorySuggestions.value = suggestions;
    if (!suggestions.length) {
      activeSearchFocusBatchNo.value = '';
      sourceSearchManualPickRequired.value = false;
      ElMessage.warning('没有找到匹配零件');
      return;
    }
    const exactSuggestions = suggestions.filter(
      (item) => normalizeValue(item.partCode) === normalizeValue(keyword) || normalizeValue(item.partName) === normalizeValue(keyword)
    );
    if (exactSuggestions.length === 1) {
      const exact = exactSuggestions[0];
      if (!canAutoSwitchInventorySuggestion(exact, 'EXACT')) {
        keepInventorySuggestionManualPick(exact);
        return;
      }
      sourceSearchManualPickRequired.value = false;
      activeSearchFocusBatchNo.value = exact.matchedBatchNo || '';
      sourceSearchKeyword.value = exact.partName ? `${exact.partCode} ${exact.partName}` : exact.partCode;
      sourceSearchSelectedLabel.value = sourceSearchKeyword.value;
      emit('sourceSearch', exact.partCode);
      return;
    }
    sourceSearchManualPickRequired.value = true;
    if (exactSuggestions.length > 1) {
      activeSearchFocusBatchNo.value = '';
      lastInventorySuggestions.value = exactSuggestions;
      ElMessage.warning('匹配到多个精确零件，请从下拉列表中选择具体零件');
      return;
    }
    activeSearchFocusBatchNo.value = '';
    ElMessage.warning(
      suggestions.length > 1
        ? `找到 ${suggestions.length} 个匹配零件，请从下拉列表中选择具体零件`
        : '找到 1 个相似零件，请点击结果确认后再切换库存来源'
    );
  } catch (error) {
    if (requestId === inventorySuggestionRequestSeq.value) {
      activeSearchFocusBatchNo.value = '';
      sourceSearchManualPickRequired.value = false;
      lastInventorySuggestions.value = [];
      sourceSearchSelectedLabel.value = '';
      ElMessage.error(error instanceof Error ? error.message : '库存查询失败，请确认零件关键字和后端服务');
    }
  }
}

function searchExpectedPart() {
  if (expected.value?.partCode) {
    resetReviewConfirmation();
    sourceSearchManualPickRequired.value = false;
    activeSearchFocusBatchNo.value = '';
    lastInventorySuggestions.value = [];
    sourceSearchKeyword.value = expected.value.partName ? `${expected.value.partCode} ${expected.value.partName}` : expected.value.partCode;
    sourceSearchSelectedLabel.value = sourceSearchKeyword.value;
    emit('sourceSearch', expected.value.partCode);
  }
}

function selectedSourceQuantity(row: InventorySourceBatchDetail) {
  return selectedSourceMap.value.get(row.id)?.quantity ?? 0;
}

function selectedSourceQuantityByBatchId(batchId: string) {
  return normalizeSelectedSources(props.selectedSources || []).find((source) => source.batchId === batchId)?.quantity ?? 0;
}

function selectedQuantityWithout(batchId: string) {
  return selectedSourceRows.value
    .filter((source) => source.batchId !== batchId)
    .reduce((sum, source) => sum + Number(source.quantity ?? 0), 0);
}

function sourceMaxSelectableQuantity(row: InventorySourceBatchDetail) {
  return row.quantity;
}

function selectedSourceMaxQuantity(source: StockSourceSelectionPayload) {
  return selectedSourceCurrentAvailableQuantity(source);
}

function selectedSourceCurrentAvailableQuantity(source: StockSourceSelectionPayload) {
  return Number((source as SelectedSourceRow).currentAvailableQuantity ?? source.availableQuantity ?? source.quantity ?? 0);
}

function selectedSourceAvailabilityText(source: StockSourceSelectionPayload) {
  const unit = source.unit || expected.value?.unit || props.detail?.unit || '件';
  const backendAvailableQuantity = Number(source.availableQuantity ?? selectedSourceCurrentAvailableQuantity(source));
  const currentAvailableQuantity = selectedSourceCurrentAvailableQuantity(source);
  if (Math.abs(backendAvailableQuantity - currentAvailableQuantity) <= 0.0001) {
    return `当前可用 ${formatQuantity(currentAvailableQuantity, unit)}`;
  }
  return `批次总可用 ${formatQuantity(backendAvailableQuantity, unit)} / 本行可用 ${formatQuantity(currentAvailableQuantity, unit)}`;
}

function sourceBackendAvailableQuantity(row: InventorySourceBatchDetail) {
  // availableQuantity 保存后端扣除其他订单预占后的批次总可用；currentAvailableQuantity 才扣除本订单其他零件已选数量。
  return Number((row as SourceRow).backendAvailableQuantity ?? row.quantity ?? 0);
}

function defaultSelectableRows() {
  return adjustedSourceRows.value
    .filter((row) => row.quantity > 0)
    .map((row, index) => ({ row, index }))
    .sort((left, right) => compatibilityRank(left.row) - compatibilityRank(right.row) || left.row.quantity - right.row.quantity || left.index - right.index)
    .map((item) => item.row);
}

function roundSelectionQuantity(value: number) {
  return Math.max(Math.round((Number(value ?? 0) + Number.EPSILON) * 1000) / 1000, 0);
}

function selectedSourceCapacity(source: StockSourceSelectionPayload) {
  return roundSelectionQuantity(selectedSourceCurrentAvailableQuantity(source));
}

function createSelectionFromRow(row: InventorySourceBatchDetail, quantity: number, previous?: StockSourceSelectionPayload) {
  const compatibility = compatibilityResult(row);
  const compatibilityStatus = selectionCompatibilityStatus(row);
  const compatibilityReason = selectionCompatibilityReason(compatibility);
  const manualConfirmationSource = selectedSourceManualConfirmationSource(previous, undefined, compatibilityStatus, compatibilityReason);
  return {
    batchId: row.id,
    batchNo: row.batchNo,
    partCode: row.partCode,
    partName: row.partName,
    quantity: roundSelectionQuantity(quantity),
    availableQuantity: sourceBackendAvailableQuantity(row),
    unit: row.unit,
    replenishmentSourceType: row.replenishmentSourceType,
    replenishmentSourceRequestNo: row.replenishmentSourceRequestNo,
    replenishmentSourceLabel: row.replenishmentSourceLabel,
    compatibilityStatus,
    compatibilityReason,
    manualConfirmedBy: manualConfirmationSource?.manualConfirmedBy?.trim(),
    manualConfirmedAt: manualConfirmationSource?.manualConfirmedAt?.trim(),
    manualConfirmRemark: manualConfirmationSource?.manualConfirmRemark?.trim()
  } satisfies StockSourceSelectionPayload;
}

function selectedQueueTargetQuantity(sources: StockSourceSelectionPayload[], refillToRequired: boolean) {
  if (!refillToRequired) {
    return roundSelectionQuantity(sources.reduce((sum, source) => sum + Number(source.quantity ?? 0), 0));
  }
  return Math.max(requiredQuantity.value > 0 ? requiredQuantity.value : effectiveDetailAvailableQuantity.value, 0);
}

function shouldRefillSelectedSourceQueue(sources: StockSourceSelectionPayload[], explicitRefill?: boolean) {
  if (explicitRefill !== undefined) {
    return explicitRefill;
  }
  if (requiredQuantity.value <= 0) {
    return false;
  }
  const nextQueueQuantity = sources.reduce((sum, source) => sum + Number(source.quantity ?? 0), 0);
  const queueAlreadyCoveredNeed = Math.max(selectedQuantityTotal.value, nextQueueQuantity) >= requiredQuantity.value - 0.0001;
  const hasQueuePlaceholder = sources.some((source) => Number(source.quantity ?? 0) <= 0);
  return queueAlreadyCoveredNeed || hasQueuePlaceholder;
}

function rebalanceSelectedSourceQueue(
  sources: StockSourceSelectionPayload[],
  options: {
    lockIndex?: number;
    lockQuantity?: number;
    refillToRequired?: boolean;
    distributeByQueue?: boolean;
    excludedBatchIds?: Set<string>;
  } = {}
) {
  const normalizedSources = normalizeSelectedSources(sources);
  const targetQuantity = selectedQueueTargetQuantity(normalizedSources, Boolean(options.refillToRequired));
  if (!props.reviewMode || targetQuantity <= 0) {
    return normalizedSources;
  }

  const sourceMap = new Map(adjustedSourceRows.value.map((row) => [row.id, row]));
  const rows: StockSourceSelectionPayload[] = [];
  let remainingQuantity = targetQuantity;

  normalizedSources.forEach((source, index) => {
    const row = sourceMap.get(source.batchId);
    const normalizedSource = row ? createSelectionFromRow(row, source.quantity, source) : source;
    const capacity = selectedSourceCapacity(normalizedSource);
    const requestedQuantity =
      options.distributeByQueue && (options.lockIndex === undefined || index !== options.lockIndex)
        ? capacity
        : options.lockIndex !== undefined && index === options.lockIndex
          ? Number(options.lockQuantity ?? 0)
          : normalizedSource.quantity;
    const nextQuantity =
      options.lockIndex !== undefined && index > options.lockIndex
        ? Math.min(capacity, remainingQuantity)
        : Math.min(Math.max(Number(requestedQuantity ?? 0), 0), capacity, remainingQuantity);

    rows.push({ ...normalizedSource, quantity: roundSelectionQuantity(nextQuantity) });
    remainingQuantity = roundSelectionQuantity(remainingQuantity - nextQuantity);
  });

  if (options.refillToRequired && remainingQuantity > 0.0001) {
    const selectedBatchIds = new Set(rows.map((source) => source.batchId));
    for (const row of defaultSelectableRows()) {
      if (remainingQuantity <= 0.0001) {
        break;
      }
      if (selectedBatchIds.has(row.id)) {
        continue;
      }
      if (options.excludedBatchIds?.has(row.id)) {
        continue;
      }
      const quantity = Math.min(row.quantity, remainingQuantity);
      if (quantity <= 0) {
        continue;
      }
      rows.push(createSelectionFromRow(row, quantity));
      selectedBatchIds.add(row.id);
      remainingQuantity = roundSelectionQuantity(remainingQuantity - quantity);
    }
  }

  return normalizeSelectedSources(rows);
}

function autoSelectSources() {
  if (!props.detail) {
    return;
  }
  const preservedRows = selectedSourcesOutsideCurrentDetail();
  const preservedQuantity = preservedRows.reduce((sum, source) => sum + Number(source.quantity ?? 0), 0);
  const targetQuantity = Math.max((requiredQuantity.value > 0 ? requiredQuantity.value : effectiveDetailAvailableQuantity.value) - preservedQuantity, 0);
  if (targetQuantity <= 0) {
    ElMessage.warning('当前已选库存已满足本次需要，如需重选请先清空选择');
    return;
  }
  let remainingQuantity = targetQuantity;
  const rows: StockSourceSelectionPayload[] = [];
  for (const row of defaultSelectableRows()) {
    if (remainingQuantity <= 0) {
      break;
    }
    const quantity = Math.min(row.quantity, remainingQuantity);
    if (quantity <= 0) {
      continue;
    }
    const compatibility = compatibilityResult(row);
    rows.push({
      batchId: row.id,
      batchNo: row.batchNo,
      partCode: row.partCode,
      partName: row.partName,
      quantity,
      availableQuantity: sourceBackendAvailableQuantity(row),
      unit: row.unit,
      replenishmentSourceType: row.replenishmentSourceType,
      replenishmentSourceRequestNo: row.replenishmentSourceRequestNo,
      replenishmentSourceLabel: row.replenishmentSourceLabel,
      compatibilityStatus: selectionCompatibilityStatus(row),
      compatibilityReason: selectionCompatibilityReason(compatibility)
    });
    remainingQuantity -= quantity;
  }
  resetReviewConfirmation();
  emit('selectionChange', mergeCurrentDetailSelection(rows));
  ElMessage.success(
    `已按默认顺序选用 ${rows.length} 批，合计 ${formatQuantity(
      rows.reduce((sum, source) => sum + Number(source.quantity ?? 0), 0),
      selectedQuantityUnit.value
    )}`
  );
}

function bulkSelectSourcesByQuantity() {
  if (!props.detail) {
    return;
  }
  const eachQuantity = Number(bulkEachQuantity.value ?? 0);
  if (!Number.isFinite(eachQuantity) || eachQuantity <= 0) {
    ElMessage.warning('请先填写每批使用数量');
    return;
  }

  const preservedRows = selectedSourcesOutsideCurrentDetail();
  const preservedQuantity = preservedRows.reduce((sum, source) => sum + Number(source.quantity ?? 0), 0);
  const targetQuantity = Math.max((requiredQuantity.value > 0 ? requiredQuantity.value : effectiveDetailAvailableQuantity.value) - preservedQuantity, 0);
  if (targetQuantity <= 0) {
    ElMessage.warning('当前已选库存已满足本次需要，如需重选请先清空选择');
    return;
  }
  let remainingQuantity = targetQuantity;
  const rows: StockSourceSelectionPayload[] = [];
  for (const row of defaultSelectableRows()) {
    if (remainingQuantity <= 0) {
      break;
    }
    const quantity = Math.min(row.quantity, eachQuantity, remainingQuantity);
    if (quantity <= 0) {
      continue;
    }
    const compatibility = compatibilityResult(row);
    rows.push({
      batchId: row.id,
      batchNo: row.batchNo,
      partCode: row.partCode,
      partName: row.partName,
      quantity,
      availableQuantity: sourceBackendAvailableQuantity(row),
      unit: row.unit,
      replenishmentSourceType: row.replenishmentSourceType,
      replenishmentSourceRequestNo: row.replenishmentSourceRequestNo,
      replenishmentSourceLabel: row.replenishmentSourceLabel,
      compatibilityStatus: selectionCompatibilityStatus(row),
      compatibilityReason: selectionCompatibilityReason(compatibility)
    });
    remainingQuantity -= quantity;
  }

  if (!rows.length) {
    ElMessage.warning('当前没有可批量选用的库存批次');
    return;
  }
  resetReviewConfirmation();
  emit('selectionChange', mergeCurrentDetailSelection(rows));
  ElMessage.success(
    `已批量勾选 ${rows.length} 批，合计 ${formatQuantity(
      rows.reduce((sum, source) => sum + Number(source.quantity ?? 0), 0),
      selectedQuantityUnit.value
    )}`
  );
}

function clearSelectedSources() {
  resetReviewConfirmation();
  emit('selectionChange', []);
}

function rebalanceCurrentSelectedSourcesByQueue() {
  if (!selectedSourceRows.value.length) {
    ElMessage.warning('请先选择库存批次');
    return;
  }
  resetReviewConfirmation();
  emit(
    'selectionChange',
    rebalanceSelectedSourceQueue(selectedSourceRows.value, {
      refillToRequired: true,
      distributeByQueue: true
    })
  );
  ElMessage.success('已按当前队列重新分配使用数量');
}

function isSourceSelected(row: InventorySourceBatchDetail) {
  return selectedSourceMap.value.has(row.id);
}

function handleSourceChecked(row: InventorySourceBatchDetail, value: string | number | boolean) {
  toggleSourceSelection(row, Boolean(value));
}

function handleSourceQuantityChange(row: InventorySourceBatchDetail, value: number | undefined) {
  updateSourceSelection(row, Number(value ?? 0));
}

function toggleSourceSelection(row: InventorySourceBatchDetail, checked: boolean) {
  if (!checked) {
    removeSelectedSource(row.id);
    return;
  }
  const remainingQuantity = Math.max(requiredQuantity.value - selectedQuantityTotal.value, 0);
  updateSourceSelection(row, Math.min(row.quantity, remainingQuantity || 0), { keepQueuedWhenZero: true });
}

function updateSourceSelection(
  row: InventorySourceBatchDetail,
  quantity: number,
  options: { keepQueuedWhenZero?: boolean; refillToRequired?: boolean } = {}
) {
  const nextQuantity = Math.max(0, Math.min(Number(quantity ?? 0), sourceMaxSelectableQuantity(row)));
  const previous = selectedSourceMap.value.get(row.id);
  const nextSource =
    nextQuantity > 0 || options.keepQueuedWhenZero
      ? createSelectionFromRow(row, nextQuantity, previous)
      : undefined;
  const rows: StockSourceSelectionPayload[] = [];
  let replaced = false;
  for (const source of selectedSourceRows.value) {
    if (source.batchId !== row.id) {
      rows.push(source);
      continue;
    }
    replaced = true;
    if (nextSource) {
      rows.push(nextSource);
    }
  }
  if (nextQuantity > 0) {
    if (!replaced && nextSource) {
      rows.push(nextSource);
    }
  } else if (options.keepQueuedWhenZero && !replaced && nextSource) {
    rows.push(nextSource);
  }
  const lockIndex = rows.findIndex((source) => source.batchId === row.id);
  resetReviewConfirmation();
  emit(
    'selectionChange',
    rebalanceSelectedSourceQueue(rows, {
      lockIndex: lockIndex >= 0 ? lockIndex : undefined,
      lockQuantity: nextQuantity,
      refillToRequired: shouldRefillSelectedSourceQueue(rows, options.refillToRequired)
    })
  );
}

function removeSelectedSource(batchId: string) {
  const shouldRefill = shouldRefillSelectedSourceQueue(selectedSourceRows.value);
  resetReviewConfirmation();
  emit(
    'selectionChange',
    rebalanceSelectedSourceQueue(
      selectedSourceRows.value.filter((source) => source.batchId !== batchId),
      { refillToRequired: shouldRefill, distributeByQueue: shouldRefill, excludedBatchIds: new Set([batchId]) }
    )
  );
}

function handleSelectedSourceQuantityChange(source: StockSourceSelectionPayload, value: number | undefined) {
  const nextQuantity = Math.max(0, Math.min(Number(value ?? 0), selectedSourceMaxQuantity(source)));
  const rows = selectedSourceRows.value.map((item) => (item.batchId === source.batchId ? { ...item, quantity: nextQuantity } : item));
  const lockIndex = rows.findIndex((item) => item.batchId === source.batchId);
  resetReviewConfirmation();
  emit(
    'selectionChange',
    rebalanceSelectedSourceQueue(rows, {
      lockIndex: lockIndex >= 0 ? lockIndex : undefined,
      lockQuantity: nextQuantity,
      refillToRequired: shouldRefillSelectedSourceQueue(rows)
    })
  );
}

function moveSelectedSource(index: number, direction: -1 | 1) {
  const insertionIndex = index + direction + (direction > 0 ? 1 : 0);
  reorderSelectedSource(index, insertionIndex);
}

function startSelectedSourceDrag(event: DragEvent, index: number) {
  draggedSelectedSourceIndex.value = index;
  selectedSourceDragOverIndex.value = index;
  selectedSourceDragInsertAfter.value = false;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function handleSelectedSourceDragOver(event: DragEvent, index: number) {
  if (draggedSelectedSourceIndex.value === null) {
    return;
  }
  selectedSourceDragOverIndex.value = index;
  selectedSourceDragInsertAfter.value = isSelectedSourceDragAfterRowMiddle(event);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function handleSelectedSourceListDragLeave(event: DragEvent) {
  if (draggedSelectedSourceIndex.value === null) {
    return;
  }
  const listElement = event.currentTarget;
  const nextElement = event.relatedTarget;
  if (listElement instanceof HTMLElement && nextElement instanceof Node && listElement.contains(nextElement)) {
    return;
  }
  selectedSourceDragOverIndex.value = null;
  selectedSourceDragInsertAfter.value = false;
}

function handleSelectedSourceListDragOverEnd(event: DragEvent) {
  if (draggedSelectedSourceIndex.value === null || selectedSourceRows.value.length === 0) {
    return;
  }
  selectedSourceDragOverIndex.value = selectedSourceRows.value.length - 1;
  selectedSourceDragInsertAfter.value = true;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function dropSelectedSource(event: DragEvent, index: number) {
  if (draggedSelectedSourceIndex.value === null) {
    endSelectedSourceDrag();
    return;
  }
  const insertionIndex = index + (isSelectedSourceDragAfterRowMiddle(event) ? 1 : 0);
  reorderSelectedSource(draggedSelectedSourceIndex.value, insertionIndex);
  endSelectedSourceDrag();
}

function dropSelectedSourceAtEnd() {
  if (draggedSelectedSourceIndex.value === null) {
    endSelectedSourceDrag();
    return;
  }
  reorderSelectedSource(draggedSelectedSourceIndex.value, selectedSourceRows.value.length);
  endSelectedSourceDrag();
}

function endSelectedSourceDrag() {
  draggedSelectedSourceIndex.value = null;
  selectedSourceDragOverIndex.value = null;
  selectedSourceDragInsertAfter.value = false;
}

function isSelectedSourceDragAfterRowMiddle(event: DragEvent) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const rect = target.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

function reorderSelectedSource(index: number, insertionIndex: number) {
  if (index < 0 || index >= selectedSourceRows.value.length) {
    return;
  }
  let target = Math.max(0, Math.min(insertionIndex, selectedSourceRows.value.length));
  if (index < target) {
    target -= 1;
  }
  if (index === target) {
    return;
  }
  const rows = [...selectedSourceRows.value];
  const [current] = rows.splice(index, 1);
  rows.splice(target, 0, current);
  resetReviewConfirmation();
  emit(
    'selectionChange',
    rebalanceSelectedSourceQueue(rows, {
      refillToRequired: shouldRefillSelectedSourceQueue(rows),
      distributeByQueue: true
    })
  );
}

function focusSelectedSource(source: StockSourceSelectionPayload) {
  const partCode = source.partCode?.trim();
  if (!partCode) {
    ElMessage.warning('该库存批次缺少零件编码，无法直接查询');
    return;
  }
  activeSearchFocusBatchNo.value = source.batchNo || '';
  sourceSearchKeyword.value = source.partName ? `${partCode} ${source.partName}` : partCode;
  sourceSearchSelectedLabel.value = sourceSearchKeyword.value;
  emit('sourceSearch', partCode);
}

function selectedSourcesOutsideCurrentDetail() {
  const currentBatchIds = new Set(adjustedSourceRows.value.map((row) => row.id));
  return selectedSourceRows.value.filter((source) => !currentBatchIds.has(source.batchId));
}

function mergeCurrentDetailSelection(currentRows: StockSourceSelectionPayload[]) {
  return normalizeSelectedSources([...selectedSourcesOutsideCurrentDetail(), ...currentRows]);
}

function compatibilityReasonText(reason?: string) {
  return reason?.trim() || undefined;
}

function stricterSelectedSourceCompatibilityStatus(
  incoming?: CompatibilityStatus,
  current?: CompatibilityStatus,
  hasIncoming = false,
  hasCurrent = false
) {
  if (!hasIncoming) {
    return current;
  }
  if (!hasCurrent) {
    return incoming;
  }
  if (!incoming || !current) {
    return undefined;
  }
  return selectedSourceCompatibilityRank[incoming] > selectedSourceCompatibilityRank[current] ? incoming : current;
}

function mergeSelectedSourceCompatibilityReason(
  incoming?: string,
  current?: string,
  hasIncoming = false,
  hasCurrent = false
) {
  const reasons = [hasCurrent ? current : undefined, hasIncoming ? incoming : undefined]
    .map((reason) => compatibilityReasonText(reason))
    .filter(Boolean);
  return [...new Set(reasons)].join('；') || undefined;
}

function selectedSourceManualConfirmationSource(
  incoming: StockSourceSelectionPayload | undefined,
  current: StockSourceSelectionPayload | undefined,
  mergedStatus?: CompatibilityStatus,
  mergedReason?: string
) {
  const normalizedMergedReason = compatibilityReasonText(mergedReason);
  const incomingMatchesMerged =
    incoming?.compatibilityStatus === mergedStatus && compatibilityReasonText(incoming?.compatibilityReason) === normalizedMergedReason;
  if (incomingMatchesMerged) {
    return incoming;
  }
  const currentMatchesMerged =
    current?.compatibilityStatus === mergedStatus && compatibilityReasonText(current?.compatibilityReason) === normalizedMergedReason;
  return currentMatchesMerged ? current : undefined;
}

function normalizeSelectedSources(sources: StockSourceSelectionPayload[]) {
  const rows = new Map<string, StockSourceSelectionPayload>();
  for (const source of sources || []) {
    const batchId = source.batchId?.trim();
    const quantity = Number(source.quantity ?? 0);
    if (!batchId || quantity < 0) {
      continue;
    }
    const current = rows.get(batchId);
    const availableQuantity =
      source.availableQuantity === undefined && current?.availableQuantity === undefined
        ? undefined
        : Math.max(Number(source.availableQuantity ?? 0), Number(current?.availableQuantity ?? 0));
    const currentQuantity = Number(current?.quantity ?? 0);
    const sourceNeedsReviewMerge = quantity > 0;
    const currentNeedsReviewMerge = currentQuantity > 0;
    const compatibilityStatus = stricterSelectedSourceCompatibilityStatus(
      normalizeCompatibilityStatus(source.compatibilityStatus),
      normalizeCompatibilityStatus(current?.compatibilityStatus),
      sourceNeedsReviewMerge,
      currentNeedsReviewMerge
    );
    const compatibilityReason = mergeSelectedSourceCompatibilityReason(
      source.compatibilityReason,
      current?.compatibilityReason,
      sourceNeedsReviewMerge,
      currentNeedsReviewMerge
    );
    const manualConfirmationSource = selectedSourceManualConfirmationSource(
      sourceNeedsReviewMerge ? source : undefined,
      currentNeedsReviewMerge ? current : undefined,
      compatibilityStatus,
      compatibilityReason
    );
    rows.set(batchId, {
      batchId,
      batchNo: source.batchNo?.trim() || current?.batchNo,
      partCode: source.partCode?.trim() || current?.partCode,
      partName: source.partName?.trim() || current?.partName,
      quantity: currentQuantity + quantity,
      availableQuantity,
      unit: source.unit?.trim() || current?.unit,
      replenishmentSourceType: source.replenishmentSourceType?.trim() || current?.replenishmentSourceType,
      replenishmentSourceRequestNo: source.replenishmentSourceRequestNo?.trim() || current?.replenishmentSourceRequestNo,
      replenishmentSourceLabel: source.replenishmentSourceLabel?.trim() || current?.replenishmentSourceLabel,
      compatibilityStatus,
      compatibilityReason,
      manualConfirmedBy: manualConfirmationSource?.manualConfirmedBy?.trim(),
      manualConfirmedAt: manualConfirmationSource?.manualConfirmedAt?.trim(),
      manualConfirmRemark: manualConfirmationSource?.manualConfirmRemark?.trim()
    });
  }
  return [...rows.values()];
}

function resetReviewConfirmation() {
  reviewConfirmChecked.value = false;
}

function sourceTypeText(type: InventorySourceType) {
  return type === 'ORDER' ? '订单待发库存' : '备货库存';
}

function sourceKindText(kind?: string) {
  const map: Record<string, string> = {
    NORMAL_ORDER: '正常订单来源',
    CANCELLED_ORDER: '取消订单来源',
    CUSTOMER_CHANGE: '客户变更来源'
  };
  return map[kind || 'NORMAL_ORDER'] || kind || '正常订单来源';
}

function reservationSummary(row: InventorySourceBatchDetail) {
  const reservations = row.reservations || [];
  const draftReserved = draftReservedQuantity(row);
  if (!reservations.length) {
    const backendReservedQuantity = Math.max(Number(row.reservedQuantity ?? 0) - draftReserved, 0);
    const parts = [
      backendReservedQuantity ? `已被其他订单预占 ${formatQuantity(backendReservedQuantity, row.unit)}` : '',
      draftReserved ? `本订单其他零件已选 ${formatQuantity(draftReserved, row.unit)}` : ''
    ].filter(Boolean);
    return parts.join('；');
  }
  const reservationText = reservations
    .map((reservation) => {
      const lineText = reservation.partName || reservation.partCode ? ` / ${reservation.partName || reservation.partCode}` : '';
      return `${reservation.orderNo || '草稿订单'}${lineText} 预占 ${formatQuantity(reservation.quantity, reservation.unit || row.unit)}`;
    })
    .join('；');
  return draftReserved
    ? `${reservationText}；本订单其他零件已选 ${formatQuantity(draftReserved, row.unit)}`
    : reservationText;
}

function draftReservedQuantity(row: InventorySourceBatchDetail) {
  return Number((row as SourceRow).draftReservedQuantity ?? 0);
}

function displayReservations(row: InventorySourceBatchDetail) {
  return row.reservations || [];
}

function isFocusedSource(row: InventorySourceBatchDetail) {
  return Boolean(
    (props.focusBatchId && row.id === props.focusBatchId) ||
      (props.focusBatchNo && row.batchNo === props.focusBatchNo) ||
      (activeSearchFocusBatchNo.value && row.batchNo === activeSearchFocusBatchNo.value)
  );
}

function sourceRowRank(row: InventorySourceBatchDetail) {
  if (isFocusedSource(row)) {
    return 0;
  }
  return isSourceSelected(row) ? 1 : 2;
}

function sourceRowClassName({ row }: { row: InventorySourceBatchDetail }) {
  return isFocusedSource(row) ? 'source-row-focused' : '';
}

function productionOrderNo(row: InventorySourceBatchDetail) {
  return row.productionSourceOrderNo || '';
}

function productionCustomerName(row: InventorySourceBatchDetail) {
  return row.productionSourceCustomerName || '';
}

function replenishmentSourceText(row: InventorySourceBatchDetail) {
  if (row.replenishmentSourceLabel) {
    return row.replenishmentSourceLabel;
  }
  if (!row.replenishmentSourceType) {
    return '';
  }
  const label = row.replenishmentSourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单';
  return row.replenishmentSourceRequestNo ? `${label}：${row.replenishmentSourceRequestNo}` : label;
}

function sourceComponentText(row: InventorySourceBatchDetail) {
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

function selectedSourceReplenishmentText(source: StockSourceSelectionPayload) {
  if (source.replenishmentSourceLabel) {
    return source.replenishmentSourceLabel;
  }
  if (!source.replenishmentSourceType) {
    return '';
  }
  const label = source.replenishmentSourceType === 'PRODUCTION_SCRAP' ? '生产报废补单' : '订单补单';
  return source.replenishmentSourceRequestNo ? `${label}：${source.replenishmentSourceRequestNo}` : label;
}

function drawingTitle(row: Pick<InventorySourceBatchDetail | InventorySourceExpected, 'drawingNo' | 'drawingVersion' | 'drawingDate' | 'drawingStatus'>) {
  return [row.drawingNo || '未记录图号', row.drawingVersion, row.drawingDate, row.drawingStatus].filter(Boolean).join(' / ');
}

function normalizeValue(value?: string | number | null) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function sameText(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeValue(left);
  const normalizedRight = normalizeValue(right);
  if (!normalizedLeft || !normalizedRight) {
    return true;
  }
  return normalizedLeft === normalizedRight;
}

function sameNumber(left?: number | null, right?: number | null) {
  const leftNumber = Number(left ?? 0);
  const rightNumber = Number(right ?? 0);
  if (!leftNumber || !rightNumber) {
    return true;
  }
  return Math.abs(leftNumber - rightNumber) < 0.0001;
}

function sourceStructureKind(row: { lineType?: string | null; parentComponentNo?: string | null }) {
  if (String(row.lineType || 'PART').trim().toUpperCase() === 'COMPONENT') {
    return 'COMPONENT';
  }
  return String(row.parentComponentNo || '').trim() ? 'CHILD_PART' : 'STANDALONE_PART';
}

function compatibilityResult(row: InventorySourceBatchDetail) {
  const target = expected.value;
  if (!target) {
    return { type: 'info' as const, label: '未提供对照', reason: '' };
  }

  if (expectedOrderInfoReasons.value.length > 0) {
    return { type: 'warning' as const, label: '资料不完整', reason: `本次订单资料不完整：${formatDialogReasonPreview(expectedOrderInfoReasons.value, '字段')}` };
  }

  const targetRequiresThickness = target.lineType !== 'COMPONENT';
  const missingReasons = [
    target.drawingNo && !row.drawingNo ? '库存缺图号' : '',
    target.drawingVersion && !row.drawingVersion ? '库存缺版本' : '',
    target.drawingDate && !row.drawingDate ? '库存缺图纸日期' : '',
    target.drawingStatus && !row.drawingStatus ? '库存缺图纸状态' : '',
    target.drawingFileName && !row.drawingFileName ? '库存缺图纸文件名' : '',
    target.drawingFileUrl && !row.drawingFileUrl ? '库存缺图纸文件' : '',
    target.partSpecification && !row.partSpecification ? '库存缺规格' : '',
    target.partCategory && !row.partCategory ? '库存缺零件类型' : '',
    target.projectModel && !row.projectModel ? '库存缺项目型号' : '',
    targetRequiresThickness && target.partThickness && !row.partThickness ? '库存缺厚度' : ''
  ].filter(Boolean);
  if (missingReasons.length > 0) {
    return { type: 'warning' as const, label: '资料不完整', reason: formatDialogReasonPreview(missingReasons, '字段') };
  }

  const mismatchReasons = [
    sameText(row.lineType || 'PART', target.lineType || 'PART') ? '' : '行类型不同',
    sourceStructureKind(row) === sourceStructureKind(target) ? '' : '组件结构不同',
    sameText(row.partCategory, target.partCategory) ? '' : '零件类型不同',
    sameText(row.partCode, target.partCode) ? '' : '零件编码不同',
    sameText(row.partName, target.partName) ? '' : '零件名称不同',
    sameText(row.unit, target.unit) ? '' : '单位不同',
    sameText(row.projectModel, target.projectModel) ? '' : '项目型号不同',
    sameText(row.drawingNo, target.drawingNo) ? '' : '图号不同',
    sameText(row.drawingVersion, target.drawingVersion) ? '' : '版本不同',
    sameText(row.drawingDate, target.drawingDate) ? '' : '图纸日期不同',
    sameText(row.drawingStatus, target.drawingStatus) ? '' : '图纸状态不同',
    sameText(row.drawingFileName, target.drawingFileName) ? '' : '图纸文件名不同',
    sameText(row.drawingFileUrl, target.drawingFileUrl) ? '' : '图纸文件不同',
    sameText(row.partSpecification, target.partSpecification) ? '' : '规格不同',
    targetRequiresThickness && !sameNumber(row.partThickness, target.partThickness) ? '厚度不同' : ''
  ].filter(Boolean);

  if (mismatchReasons.length > 0) {
    return { type: 'danger' as const, label: '需要确认', reason: formatDialogReasonPreview(mismatchReasons, '字段') };
  }
  if (!row.drawingNo || !row.drawingVersion || !row.drawingDate || !row.drawingStatus || !row.drawingFileName || !row.drawingFileUrl) {
    return { type: 'warning' as const, label: '资料不完整', reason: '库存图纸信息不完整' };
  }
  return { type: 'success' as const, label: '图纸匹配', reason: '' };
}

function compatibilityRank(row: InventorySourceBatchDetail) {
  const result = compatibilityResult(row).label;
  if (result === '图纸匹配') {
    return 0;
  }
  if (result === '需要确认') {
    return 1;
  }
  return 2;
}

function selectionCompatibilityStatus(row: InventorySourceBatchDetail): CompatibilityStatus {
  const result = compatibilityResult(row).label;
  if (result === '图纸匹配') {
    return 'MATCHED';
  }
  if (result === '需要确认') {
    return 'NEEDS_CONFIRMATION';
  }
  if (result === '资料不完整') {
    return 'INCOMPLETE';
  }
  return 'UNKNOWN';
}

function selectionCompatibilityReason(result: ReturnType<typeof compatibilityResult>) {
  if (result.reason) {
    return result.reason;
  }
  return result.label === '图纸匹配' ? '' : result.label;
}

function sourceUsageOrderIssue(source: StockSourceSelectionPayload) {
  const sourceMap = new Map(adjustedSourceRows.value.map((row) => [row.id, row]));
  const row = sourceMap.get(source.batchId);
  if (!row || Number(source.quantity ?? 0) <= 0) {
    return '';
  }
  const currentCompatibilityRank = compatibilityRank(row);
  const currentSelectedIndex = selectedSourceRows.value.findIndex((item) => item.batchId === source.batchId);
  const smallerAvailable = defaultSelectableRows().find((candidate) => {
    if (candidate.id === row.id || candidate.unit !== row.unit || normalizeValue(candidate.partCode) !== normalizeValue(row.partCode)) {
      return false;
    }
    if (compatibilityRank(candidate) !== currentCompatibilityRank) {
      return false;
    }
    if (candidate.quantity + 0.0001 >= row.quantity) {
      return false;
    }
    const selectedCandidateQuantity = selectedSourceQuantityByBatchId(candidate.id);
    const candidateSelectedIndex = selectedSourceRows.value.findIndex((item) => item.batchId === candidate.id);
    const notFullyUsed =
      selectedCandidateQuantity + 0.0001 < Math.min(candidate.quantity, requiredQuantity.value || candidate.quantity);
    const selectedAfterCurrent =
      currentSelectedIndex >= 0 && candidateSelectedIndex >= 0 && candidateSelectedIndex > currentSelectedIndex;
    return notFullyUsed || selectedAfterCurrent;
  });
  if (!smallerAvailable) {
    return '';
  }
  return `未优先使用较小库存批次 ${smallerAvailable.batchNo}（${formatQuantity(smallerAvailable.quantity, smallerAvailable.unit)}）`;
}

function manualConfirmationReason(source: StockSourceSelectionPayload) {
  return (
    sourceUsageOrderIssue(source) ||
    source.compatibilityReason ||
    (expectedOrderInfoReasons.value.length ? `本次订单资料不完整：${formatDialogReasonPreview(expectedOrderInfoReasons.value, '字段')}` : '') ||
    '需要人工确认'
  );
}

function manualConfirmationReasonPreview(source: StockSourceSelectionPayload, maxLength = 22) {
  return formatLongTextPreview(manualConfirmationReason(source), maxLength, '需要人工确认');
}

function manualConfirmationReasonTitle(source: StockSourceSelectionPayload) {
  return manualConfirmationReason(source).trim() || '需要人工确认';
}

function manualConfirmationRemarkPreview(source: Pick<StockSourceSelectionPayload, 'manualConfirmRemark'>, maxLength = 24) {
  return formatLongTextPreview(source.manualConfirmRemark, maxLength, '-');
}

function manualConfirmationRemarkTitle(source: Pick<StockSourceSelectionPayload, 'manualConfirmRemark'>) {
  return String(source.manualConfirmRemark || '').trim() || '-';
}

function compatibilityReasonPreview(row: SourceRow, maxLength = 30) {
  return formatLongTextPreview(compatibilityResult(row).reason, maxLength, '');
}

function compatibilityReasonTitle(row: SourceRow) {
  return compatibilityResult(row).reason || '-';
}

function sourceNeedsManualConfirmation(source: StockSourceSelectionPayload) {
  if (Number(source.quantity ?? 0) <= 0) {
    return false;
  }
  return (
    Boolean(sourceUsageOrderIssue(source)) ||
    source.compatibilityStatus !== 'MATCHED' ||
    !sameText(source.partCode, expected.value?.partCode) ||
    Boolean(
      (expected.value?.fulfillmentMode === 'STOCK' || expected.value?.fulfillmentMode === 'REWORK') &&
        expectedOrderInfoReasons.value.length > 0
    )
  );
}

function normalizeCompatibilityStatus(value?: string): CompatibilityStatus | undefined {
  if (value === 'MATCHED' || value === 'NEEDS_CONFIRMATION' || value === 'INCOMPLETE' || value === 'UNKNOWN') {
    return value;
  }
  return undefined;
}

function manualConfirmDateValid(value?: Date | string) {
  if (!value) {
    return false;
  }
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
}

function toManualConfirmDate(value?: string) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function manualConfirmationReasonKey(source: StockSourceSelectionPayload) {
  return manualConfirmationReason(source).trim();
}

function createManualConfirmForm(source: StockSourceSelectionPayload): ManualConfirmForm {
  const reasonKey = manualConfirmationReasonKey(source);
  const preserveSavedManualConfirmation =
    Boolean(source.manualConfirmedBy?.trim() && source.manualConfirmedAt?.trim() && source.manualConfirmRemark?.trim()) &&
    source.compatibilityReason?.trim() === reasonKey;
  return {
    confirmedBy: preserveSavedManualConfirmation ? source.manualConfirmedBy || '' : '',
    confirmedAt: preserveSavedManualConfirmation ? toManualConfirmDate(source.manualConfirmedAt) : new Date(),
    remark: preserveSavedManualConfirmation ? source.manualConfirmRemark || '' : '',
    reasonKey
  };
}

function ensureManualConfirmForm(source: StockSourceSelectionPayload) {
  const current = manualConfirmForms.value[source.batchId];
  if (!current || current.reasonKey !== manualConfirmationReasonKey(source)) {
    manualConfirmForms.value[source.batchId] = createManualConfirmForm(source);
  }
  return manualConfirmForms.value[source.batchId];
}

function syncManualConfirmForms() {
  const nextForms: Record<string, ManualConfirmForm> = {};
  for (const source of selectedIssueSources.value) {
    const current = manualConfirmForms.value[source.batchId];
    nextForms[source.batchId] =
      current && current.reasonKey === manualConfirmationReasonKey(source) ? current : createManualConfirmForm(source);
  }
  manualConfirmForms.value = nextForms;
}

async function openOrderPreview(orderNo?: string) {
  const normalizedOrderNo = orderNo?.trim();
  if (!normalizedOrderNo) {
    return;
  }
  const requestId = ++orderPreviewRequestSeq.value;
  orderPreviewVisible.value = true;
  orderPreviewLoading.value = true;
  orderPreview.value = null;
  try {
    const detail = await erpApi.order(normalizedOrderNo);
    if (requestId === orderPreviewRequestSeq.value) {
      orderPreview.value = detail;
    }
  } catch (error) {
    if (requestId === orderPreviewRequestSeq.value) {
      orderPreview.value = null;
      ElMessage.error(error instanceof Error ? error.message : '订单信息查询失败，请确认订单号和后端服务');
    }
  } finally {
    if (requestId === orderPreviewRequestSeq.value) {
      orderPreviewLoading.value = false;
    }
  }
}

function confirmReviewed() {
  if (!stockReviewQuantityOk.value) {
    ElMessage.warning(stockReviewQuantityText.value);
    return;
  }
  if (directStockBlockedIssue.value) {
    ElMessage.warning(directStockBlockedIssue.value);
    return;
  }
  if (!manualConfirmationOk.value) {
    ElMessage.warning('已选不适配库存，请填写确认人员、确认时间和使用说明');
    return;
  }
  if (!reviewConfirmChecked.value) {
    ElMessage.warning('请先勾选人工核对确认');
    return;
  }

  const confirmedAt = new Date();
  const nextSources = selectedSourceRows.value.map((source) => {
    if (!sourceNeedsManualConfirmation(source)) {
      return source;
    }
    const form = ensureManualConfirmForm(source);
    form.confirmedAt = confirmedAt;
    const reason = manualConfirmationReason(source);
    form.reasonKey = reason.trim();
    return {
      ...source,
      compatibilityStatus:
        reason && (!source.compatibilityStatus || source.compatibilityStatus === 'MATCHED')
          ? 'NEEDS_CONFIRMATION'
          : source.compatibilityStatus,
      compatibilityReason: reason || source.compatibilityReason,
      manualConfirmedBy: form.confirmedBy.trim(),
      manualConfirmedAt: formatDateTimeInputValue(form.confirmedAt || confirmedAt),
      manualConfirmRemark: form.remark.trim()
    };
  });

  emit('selectionChange', normalizeSelectedSources(nextSources));
  emit('confirmReviewed');
}

function clampInventorySourceDialogTableHeight(value: number) {
  return Math.min(inventorySourceDialogTableHeightLimits.max, Math.max(inventorySourceDialogTableHeightLimits.min, value));
}

function adjustInventorySourceDialogTableHeight(key: InventorySourceDialogTableKey, delta: number) {
  inventorySourceDialogTableHeights[key] = clampInventorySourceDialogTableHeight(inventorySourceDialogTableHeights[key] + delta);
}

function resetInventorySourceDialogTableHeight(key: InventorySourceDialogTableKey) {
  inventorySourceDialogTableHeights[key] = inventorySourceDialogTableDefaultHeights[key];
}

function restoreInventorySourceDialogTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const rawValue = window.localStorage.getItem(inventorySourceDialogTableHeightStorageKey);
    const savedHeights = rawValue ? JSON.parse(rawValue) as Partial<Record<InventorySourceDialogTableKey, number>> : {};
    for (const key of Object.keys(inventorySourceDialogTableDefaultHeights) as InventorySourceDialogTableKey[]) {
      const savedHeight = Number(savedHeights[key]);
      if (Number.isFinite(savedHeight)) {
        inventorySourceDialogTableHeights[key] = clampInventorySourceDialogTableHeight(savedHeight);
      }
    }
  } catch {
    // 本机 UI 偏好读取失败时使用默认高度，不影响库存来源核对、替代物料搜索或订单库存预览。
    inventorySourceDialogTableHeights.sources = inventorySourceDialogTableDefaultHeights.sources;
    inventorySourceDialogTableHeights.searchResults = inventorySourceDialogTableDefaultHeights.searchResults;
    inventorySourceDialogTableHeights.orderPreview = inventorySourceDialogTableDefaultHeights.orderPreview;
  }
}

function saveInventorySourceDialogTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      inventorySourceDialogTableHeightStorageKey,
      JSON.stringify({
        sources: inventorySourceDialogTableHeights.sources,
        searchResults: inventorySourceDialogTableHeights.searchResults,
        orderPreview: inventorySourceDialogTableHeights.orderPreview
      })
    );
  } catch {
    // 本机 UI 偏好写入失败不阻断库存来源核对、替代物料搜索或订单库存预览。
  }
}

restoreInventorySourceDialogTableHeights();

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      activeSearchFocusBatchNo.value = '';
      sourceSearchSelectedLabel.value = '';
      expandedMobileSourceBatchKeys.value = [];
      resetTransformRuleSuggestions();
      return;
    }
    reviewConfirmChecked.value = Boolean(props.reviewed);
    syncManualConfirmForms();
    void loadTransformRuleSuggestions();
  }
);

watch(
  () => [expected.value?.partCode, expected.value?.projectModel, props.customerId],
  () => {
    activeSearchFocusBatchNo.value = '';
    sourceSearchSelectedLabel.value = '';
    expandedMobileSourceBatchKeys.value = [];
    void loadTransformRuleSuggestions();
  }
);

watch(
  mobileSourceBatchStateKey,
  () => {
    expandedMobileSourceBatchKeys.value = [];
  }
);

watch(
  selectedIssueSources,
  () => {
    syncManualConfirmForms();
  },
  { deep: true, immediate: true, flush: 'sync' }
);

watch(
  () => [
    inventorySourceDialogTableHeights.sources,
    inventorySourceDialogTableHeights.searchResults,
    inventorySourceDialogTableHeights.orderPreview
  ],
  () => saveInventorySourceDialogTableHeights()
);
</script>

<style scoped>
.source-warning {
  margin-bottom: 14px;
}

.source-search-panel {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(360px, 1.4fr);
  gap: 12px;
  align-items: end;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
}

.source-search-panel > div:first-child {
  display: grid;
  gap: 4px;
}

.source-search-panel small {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.source-search-controls {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto auto;
  gap: 8px;
}

.source-search-results {
  grid-column: 1 / -1;
  display: grid;
  gap: 8px;
  overflow: auto;
  padding-top: 4px;
}

.source-search-results > strong {
  color: #1e3a8a;
  font-size: 13px;
}

.inventory-source-table-height-toolbar {
  display: flex;
  justify-content: flex-end;
  margin: 8px 0;
}

.inventory-source-table-height-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.inventory-source-table-height-label {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
}

.order-preview-table-height-toolbar {
  margin-top: 0;
}

.source-search-result-height-toolbar {
  grid-column: 1 / -1;
  margin: 0;
}

.transform-suggestion-panel {
  display: grid;
  gap: 8px;
  grid-column: 1 / -1;
  padding: 10px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
}

.transform-suggestion-title {
  display: grid;
  gap: 3px;
}

.transform-suggestion-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.transform-suggestion-title span,
.transform-suggestion-count,
.transform-suggestion-item span,
.transform-suggestion-item small {
  color: #475569;
  font-size: 12px;
  line-height: 18px;
}

.transform-suggestion-meta,
.transform-suggestion-description {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transform-suggestion-count {
  color: #1e3a8a;
}

.transform-suggestion-empty {
  padding: 10px;
  border: 1px dashed #93c5fd;
  border-radius: 8px;
  background: #f8fbff;
  color: #475569;
  font-size: 13px;
  line-height: 20px;
}

.transform-suggestion-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #fff;
}

.transform-suggestion-item > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.transform-suggestion-action {
  justify-items: end;
  text-align: right;
}

.transform-suggestion-more {
  display: flex;
  justify-content: center;
}

.source-search-result {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  background: #ffffff;
  color: #334155;
  text-align: left;
  cursor: pointer;
}

.source-search-result:hover,
.source-search-result:focus {
  border-color: #409eff;
  outline: none;
}

.source-detail-body {
  min-height: 180px;
}

.source-pagination-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.source-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.source-summary > div {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.source-summary span,
.source-summary small,
.cell-subtext,
.muted {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.source-summary strong,
.cell-main {
  color: #0f172a;
  font-weight: 600;
  line-height: 20px;
}

.batch-cell-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.reservation-list {
  display: grid;
  gap: 6px;
}

.reservation-item {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.reservation-item > div {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.reservation-order-link {
  max-width: 132px;
  overflow: hidden;
  color: #2563eb;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reservation-quantity {
  flex: none;
  color: #0f172a;
  font-size: 12px;
  font-weight: 600;
}

.reservation-item small {
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-selection-cell {
  display: grid;
  gap: 6px;
}

.source-selection-cell :deep(.el-input-number) {
  width: 100%;
}

.mobile-source-selection {
  display: grid;
  grid-template-columns: 1fr minmax(120px, 180px);
  gap: 8px;
  align-items: center;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #e2e8f0;
}

:deep(.source-row-focused > td) {
  background: #eff6ff !important;
}

:deep(.source-row-focused:hover > td) {
  background: #dbeafe !important;
}

.expected-card {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
}

.expected-warning {
  margin-top: 2px;
}

.expected-title {
  color: #0f172a;
  font-weight: 700;
}

.expected-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  color: #334155;
  font-size: 13px;
}

.warning-text {
  color: #dc2626;
}

.source-quantity-check {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
  color: #334155;
  font-size: 13px;
}

.source-quantity-check strong {
  color: #16a34a;
}

.source-quantity-check strong.danger {
  color: #dc2626;
}

.source-bulk-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin-bottom: 14px;
}

.source-bulk-action-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  line-height: 20px;
}

.source-bulk-action-label {
  flex: 0 0 auto;
  color: #64748b;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}

.source-bulk-note {
  color: #64748b;
  font-size: 12px;
  line-height: 20px;
}

.source-bulk-actions :deep(.el-button) {
  margin-left: 0;
}

.source-bulk-quantity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.source-bulk-quantity span {
  color: #64748b;
  font-size: 12px;
}

.source-bulk-quantity :deep(.el-input-number) {
  width: 92px;
}

.source-selection-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}

.source-selection-overview > div {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.source-selection-overview span {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.source-selection-overview strong {
  color: #0f172a;
  font-size: 18px;
  line-height: 24px;
  word-break: break-word;
}

.source-selection-overview strong.danger {
  color: #dc2626;
}

.selected-source-card {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #f8fbff;
}

.selected-source-title {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.selected-source-title > div:first-child {
  display: grid;
  gap: 4px;
}

.selected-source-actions,
.selected-source-sort-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.selected-source-action-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  line-height: 20px;
}

.selected-source-action-label {
  flex: 0 0 auto;
  color: #64748b;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}

.selected-source-actions :deep(.el-button),
.selected-source-row-actions :deep(.el-button) {
  margin-left: 0;
}

.selected-source-title strong {
  color: #1e3a8a;
}

.selected-source-title span {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
}

.selected-source-list {
  display: grid;
  gap: 8px;
}

.selected-source-item {
  position: relative;
  display: grid;
  grid-template-columns: 46px minmax(220px, 1fr) minmax(120px, 160px) auto minmax(180px, auto);
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #ffffff;
}

.selected-source-item.is-dragging {
  opacity: 0.55;
}

.selected-source-item.is-drop-before,
.selected-source-item.is-drop-after {
  border-color: #60a5fa;
  background: #eff6ff;
}

.selected-source-item.is-drop-before::before,
.selected-source-item.is-drop-after::after {
  position: absolute;
  right: 10px;
  left: 10px;
  height: 2px;
  background: #2563eb;
  content: '';
}

.selected-source-item.is-drop-before::before {
  top: -6px;
}

.selected-source-item.is-drop-after::after {
  bottom: -6px;
}

.selected-source-item > div {
  display: grid;
  gap: 3px;
}

.selected-source-item > .selected-source-order-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.selected-source-item > .selected-source-row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
}

.selected-source-order-cell span {
  color: #2563eb;
  font-size: 13px;
  font-weight: 700;
}

.selected-source-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
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

.selected-source-drag-handle:active {
  cursor: grabbing;
}

.selected-source-item strong {
  color: #0f172a;
}

.selected-source-item span,
.selected-source-item small {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.selected-source-item .selected-source-manual-note {
  color: #b45309;
}

.selected-source-item .selected-source-manual-remark {
  color: inherit;
}

.selected-source-item .selected-source-replenishment-note {
  color: #2563eb;
}

.selected-source-item .selected-source-availability-note {
  color: #475569;
}

.selected-source-quantity-editor {
  display: grid;
  gap: 4px;
}

.selected-source-quantity-editor span {
  color: #64748b;
  font-size: 12px;
}

.manual-confirm-card {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #fff7ed;
}

.manual-confirm-title {
  display: grid;
  gap: 4px;
}

.manual-confirm-title strong {
  color: #9a3412;
}

.manual-confirm-title span {
  color: #9a3412;
  font-size: 13px;
  line-height: 20px;
}

.manual-confirm-issues {
  display: grid;
  gap: 10px;
}

.manual-confirm-item {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #ffffff;
}

.manual-confirm-item-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.manual-confirm-item-head span {
  color: #9a3412;
  font-size: 13px;
  line-height: 20px;
}

.manual-confirm-item-head .manual-confirm-reason {
  max-width: 100%;
}

.manual-confirm-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.manual-confirm-form label {
  display: grid;
  gap: 6px;
  color: #475569;
  font-size: 13px;
}

.manual-confirm-remark {
  grid-column: 1 / -1;
}

.source-mobile-list {
  margin-top: 0;
}

.source-mobile-card {
  border-color: #dbe3ef;
}

.source-mobile-header-actions {
  align-items: flex-end;
  flex-direction: column;
  gap: 4px;
}

.source-mobile-compact-summary {
  margin-top: 8px;
}

.source-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.source-confirm-hint {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
}

.source-confirm-left {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.source-dialog-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.inline-order-link {
  height: auto;
  padding: 0;
  vertical-align: baseline;
  font-weight: 600;
}

.order-preview-body {
  min-height: 160px;
}

.order-preview-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.order-preview-summary > div {
  display: grid;
  gap: 5px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.order-preview-summary span {
  color: #64748b;
  font-size: 12px;
}

.order-preview-summary strong {
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .source-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .source-selection-overview,
  .expected-grid,
  .manual-confirm-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .source-search-panel {
    grid-template-columns: 1fr;
  }

  .order-preview-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .reservation-order-link,
  .reservation-item small,
  .order-preview-summary strong {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}

@media (max-width: 560px) {
  .source-warning {
    margin-bottom: 10px;
  }

  .source-summary {
    grid-template-columns: 1fr;
  }

  .source-selection-overview,
  .expected-grid,
  .manual-confirm-form,
  .order-preview-summary {
    grid-template-columns: 1fr;
  }

  .source-search-controls,
  .transform-suggestion-item,
  .source-search-result,
  .mobile-source-selection {
    grid-template-columns: 1fr;
  }

  .source-dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .source-dialog-actions {
    display: grid;
    grid-template-columns: 1fr;
    justify-content: stretch;
  }

  .source-dialog-actions .el-button {
    width: 100%;
    margin-left: 0;
  }

  .selected-source-item {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
}
</style>
