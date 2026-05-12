<template>
  <el-dialog
    :model-value="modelValue"
    title="库存来源详情"
    width="min(1120px, calc(100vw - 32px))"
    append-to-body
    class="responsive-dialog inventory-source-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-alert
      title="使用库存前必须核对生产订单、任务号、图号、版本和图纸文件；资料不一致、来源不完整或使用顺序异常时，必须逐批填写人工确认说明。"
      type="warning"
      :closable="false"
      class="source-warning"
    />

    <div v-if="reviewMode" class="source-search-panel">
      <div>
        <strong>库存查询</strong>
        <small>可按编码、名称、拼音、图号、客户历史或库存来源搜索；允许选择可替代产品，但必须逐批确认数量。</small>
      </div>
      <div class="source-search-controls">
        <el-autocomplete
          v-model="sourceSearchKeyword"
          :fetch-suggestions="queryInventorySuggestions"
          value-key="partCode"
          placeholder="编码/名称/拼音/图号/客户/库存来源"
          clearable
          popper-class="material-suggestion-popper"
          @select="handleInventorySuggestionSelect"
        >
          <template #default="{ item }">
            <MaterialSuggestionOption :item="item" />
          </template>
        </el-autocomplete>
        <el-button @click="searchInventoryKeyword">查询库存</el-button>
        <el-button v-if="expected?.partCode" @click="searchExpectedPart">返回订单零件</el-button>
      </div>
      <div v-if="sourceSearchManualPickRequired && lastInventorySuggestions.length" class="source-search-results">
        <strong>{{ sourceSearchResultHint }}</strong>
        <button
          v-for="item in lastInventorySuggestions"
          :key="`${item.partCode}-${item.matchedBatchNo || 'all'}`"
          type="button"
          class="source-search-result"
          @click="handleInventorySuggestionSelect(item)"
        >
          <MaterialSuggestionOption :item="item" />
        </button>
      </div>
      <div v-if="transformRuleLoading || transformRuleSuggestions.length" v-loading="transformRuleLoading" class="transform-suggestion-panel">
        <div class="transform-suggestion-title">
          <strong>来源加工建议</strong>
          <span>仅用于提示可搜索的来源零件；是否使用库存仍需逐批人工核对。</span>
        </div>
        <article v-for="rule in transformRuleSuggestions" :key="rule.id" class="transform-suggestion-item">
          <div>
            <strong>{{ rule.sourcePartCode }} / {{ rule.sourcePartName }}</strong>
            <span>{{ rule.scopeLabel }} / 倍率 {{ rule.multiplier }} / 损耗 {{ rule.lossRate ?? '-' }}</span>
            <small v-if="rule.defaultProcessRoute">建议工艺：{{ rule.defaultProcessRoute }}</small>
            <small v-if="rule.conversionDescription">{{ rule.conversionDescription }}</small>
          </div>
          <el-button size="small" type="primary" plain @click="searchTransformSource(rule)">
            查来源库存
          </el-button>
        </article>
      </div>
    </div>

    <div v-loading="loading" class="source-detail-body">
      <div v-if="detail" class="source-summary">
        <div>
          <span>零件</span>
          <strong>{{ detail.partName || '-' }} / {{ detail.partCode }}</strong>
        </div>
        <div>
          <span>当前可用</span>
          <strong>{{ formatQuantity(effectiveDetailAvailableQuantity, detail.unit) }}</strong>
        </div>
        <div>
          <span>库存批次</span>
          <strong>{{ detail.batchCount }} 批</strong>
        </div>
        <div>
          <span>来源构成</span>
          <strong>订单 {{ detail.orderSourceCount }} / 备货 {{ detail.stockSourceCount }}</strong>
          <small v-if="sourceKindSummaryText">{{ sourceKindSummaryText }}</small>
        </div>
      </div>

      <div v-if="expected && hasExpectedInfo" class="expected-card">
        <div class="expected-title">本次订单图纸要求</div>
        <div class="expected-grid">
          <span>图号：{{ expected.drawingNo || '未填写' }}</span>
          <span>版本：{{ expected.drawingVersion || '未填写' }}</span>
          <span>规格：{{ expected.partSpecification || '未填写' }}</span>
          <span>厚度：{{ expected.partThickness ? `${expected.partThickness} mm` : '未填写' }}</span>
          <span>本次需要：{{ expected.requiredQuantity ? formatQuantity(expected.requiredQuantity, expected.unit || '件') : '未填写' }}</span>
          <span>使用方式：{{ fulfillmentModeText }}</span>
        </div>
        <DrawingPreviewLink
          :file-name="expected.drawingFileName"
          :file-url="expected.drawingFileUrl"
          link-text="打开本次订单图纸"
          title="本次订单图纸"
        />
        <el-alert
          v-if="expectedMissingInfoReasons.length"
          :title="`本次订单资料不完整：${expectedMissingInfoReasons.join('、')}。仍可使用库存，但必须填写人工确认说明。`"
          type="warning"
          :closable="false"
          class="expected-warning"
        />
        <el-alert
          v-else-if="expectedFileMissing"
          title="本次订单未上传图纸文件，系统只能按图号、版本、规格和厚度进行初步核对。建议补上传图纸后再使用库存。"
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
        <el-button size="small" type="primary" plain @click="autoSelectSources">按默认顺序选用库存</el-button>
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
          <el-button size="small" @click="bulkSelectSourcesByQuantity">批量勾选</el-button>
        </div>
        <el-button size="small" @click="clearSelectedSources">清空选择</el-button>
        <span>默认优先使用数量少的库存批次；若先使用数量大的批次，必须填写说明。</span>
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
            <span>这里会保留跨物料搜索后选中的批次；取消勾选某批次后，系统会从后续批次自动补足，不会再选回该批次。</span>
          </div>
          <div class="selected-source-actions">
            <el-button size="small" @click="autoSelectSources">按默认顺序选用库存</el-button>
            <el-button size="small" @click="rebalanceCurrentSelectedSourcesByQueue">按当前顺序重算</el-button>
            <el-button size="small" @click="clearSelectedSources">清空选择</el-button>
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
                <template v-if="source.manualConfirmRemark"> / {{ source.manualConfirmRemark }}</template>
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
              {{ manualConfirmationReason(source) }}
            </el-tag>
            <el-tag v-else type="success" effect="plain">已匹配</el-tag>
            <div class="selected-source-sort-actions">
              <el-button link size="small" @click="focusSelectedSource(source)">查看该库存</el-button>
              <el-button link size="small" :disabled="index === 0" @click="moveSelectedSource(index, -1)">上移</el-button>
              <el-button link size="small" :disabled="index === selectedSourceRows.length - 1" @click="moveSelectedSource(index, 1)">下移</el-button>
            </div>
            <el-button link type="danger" @click="removeSelectedSource(source.batchId)">移除</el-button>
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
              <span>{{ manualConfirmationReason(item.source) }}</span>
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

      <el-table
        v-if="detail"
        class="desktop-table"
        :data="sourceRows"
        :row-class-name="sourceRowClassName"
        max-height="520"
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
              {{ compatibilityResult(row).reason }}
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
              <small v-if="sourceComponentText(row)">{{ sourceComponentText(row) }}</small>
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
              <span class="warning-text">{{ compatibilityResult(row).reason }}</span>
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

      <el-empty v-if="detail && adjustedSourceRows.length === 0" description="当前条件下没有可用库存来源" />
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
          <el-button @click="emit('update:modelValue', false)">关闭</el-button>
          <el-button
            type="primary"
            :disabled="!canConfirmReview"
            @click="confirmReviewed"
          >
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
        <el-table :data="orderPreview.lines" border max-height="360">
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
              <div>{{ row.drawingNo || '未填写' }} / {{ row.drawingVersion || '-' }}</div>
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
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Rank } from '@element-plus/icons-vue';
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
import { formatDate, formatQuantity } from '../utils/format';
import { orderDisplayStatus } from '../utils/orderStatus';

const props = defineProps<{
  modelValue: boolean;
  loading?: boolean;
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
}>();

type CompatibilityStatus = NonNullable<StockSourceSelectionPayload['compatibilityStatus']>;
type ManualConfirmForm = {
  confirmedBy: string;
  confirmedAt: Date;
  remark: string;
};
type SourceRow = InventorySourceBatchDetail & {
  backendAvailableQuantity?: number;
  draftReservedQuantity?: number;
};
type SelectedSourceRow = StockSourceSelectionPayload & {
  currentAvailableQuantity?: number;
};

const expected = computed(() => props.expected || null);
const sourceSearchKeyword = ref('');
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
const transformRuleLoading = ref(false);
const transformRuleRequestSeq = ref(0);
const transformRuleSuggestions = ref<MaterialTransformRule[]>([]);
const sourceSearchResultHint = computed(() => {
  if (lastInventorySuggestions.value.some((item) => item.hasIdentityConflict)) {
    return '同编码存在多套历史资料，请点击候选项确认';
  }
  return lastInventorySuggestions.value.length > 1 ? '匹配到多个物料，请选择具体零件' : '匹配到相似物料，请选择确认';
});
const draftReservedQuantityByBatchId = computed(() => {
  const rows = new Map<string, number>();
  for (const source of props.draftReservedSources || []) {
    const batchId = source.batchId?.trim();
    const quantity = Number(source.quantity || 0);
    if (!batchId || quantity <= 0) {
      continue;
    }
    rows.set(batchId, (rows.get(batchId) || 0) + quantity);
  }
  return rows;
});
const adjustedSourceRows = computed<SourceRow[]>(() =>
  (props.detail?.sources || []).map((row) => {
    const draftReservedQuantity = draftReservedQuantityByBatchId.value.get(row.id) || 0;
    const backendAvailableQuantity = row.quantity;
    return {
      ...row,
      backendAvailableQuantity,
      draftReservedQuantity,
      quantity: Math.max(Math.round((backendAvailableQuantity - draftReservedQuantity + Number.EPSILON) * 1000) / 1000, 0),
      reservedQuantity: Number(row.reservedQuantity || 0) + draftReservedQuantity
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
  adjustedSourceRows.value.some((row) => Number(row.reservedQuantity || 0) > 0 || Boolean(row.reservations?.length))
);
const selectedSourceRows = computed<SelectedSourceRow[]>(() => {
  const sourceMap = new Map(adjustedSourceRows.value.map((row) => [row.id, row]));
  return normalizeSelectedSources(props.selectedSources || []).map((source) => {
    const row = sourceMap.get(source.batchId);
    if (!row) {
      const draftReservedQuantity = draftReservedQuantityByBatchId.value.get(source.batchId) || 0;
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
    const savedManualReason = source.manualConfirmedBy && source.compatibilityReason ? source.compatibilityReason : '';
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
      compatibilityStatus: savedManualReason
        ? source.compatibilityStatus && source.compatibilityStatus !== 'MATCHED'
          ? source.compatibilityStatus
          : 'NEEDS_CONFIRMATION'
        : nextCompatibilityStatus,
      compatibilityReason: savedManualReason || nextCompatibilityReason
    };
  });
});
const selectedSourceMap = computed(() => new Map(selectedSourceRows.value.map((source) => [source.batchId, source])));
const requiredQuantity = computed(() => Number(expected.value?.requiredQuantity || 0));
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
  selectedSourceRows.value.filter((source) => Number(source.quantity || 0) > 0 && sourceNeedsManualConfirmation(source))
);

function selectedSourceQueuePlaceholder(source: StockSourceSelectionPayload) {
  return Number(source.quantity || 0) <= 0;
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
  const missingReviewSource = selectedSourceRows.value.find((source) => Number(source.quantity || 0) > 0 && !source.compatibilityStatus);
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
    !normalizeValue(row.partSpecification) ? '缺成品规格' : '',
    Number(row.partThickness || 0) <= 0 ? '缺零件厚度' : ''
  ].filter(Boolean);
});
const expectedFileMissing = computed(() => Boolean(expected.value && !expected.value.drawingFileUrl));
const orderDrawingInfoComplete = computed(() => expectedMissingInfoReasons.value.length === 0);
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

async function loadTransformRuleSuggestions() {
  const targetPartCode = expected.value?.partCode?.trim();
  const requestId = ++transformRuleRequestSeq.value;
  if (!props.modelValue || !props.reviewMode || !targetPartCode) {
    transformRuleSuggestions.value = [];
    transformRuleLoading.value = false;
    return;
  }
  transformRuleLoading.value = true;
  try {
    const rows = await erpApi.materialTransformRules({
      targetPartCode,
      customerId: props.customerId || undefined,
      projectModel: expected.value?.projectModel?.trim() || undefined,
      status: 'ENABLED'
    });
    if (requestId === transformRuleRequestSeq.value) {
      transformRuleSuggestions.value = rows.filter((row) => row.sourceMaterialStatus !== 'DISABLED');
    }
  } catch {
    if (requestId === transformRuleRequestSeq.value) {
      transformRuleSuggestions.value = [];
    }
  } finally {
    if (requestId === transformRuleRequestSeq.value) {
      transformRuleLoading.value = false;
    }
  }
}

function searchTransformSource(rule: MaterialTransformRule) {
  resetReviewConfirmation();
  sourceSearchManualPickRequired.value = false;
  activeSearchFocusBatchNo.value = '';
  lastInventorySuggestions.value = [];
  sourceSearchKeyword.value = `${rule.sourcePartCode} ${rule.sourcePartName}`;
  emit('sourceSearch', rule.sourcePartCode);
  ElMessage.info('已按来源加工关系切换到来源零件库存，请逐批核对后再确认');
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
    ElMessage.warning(`物料编码 ${item.partCode} 存在多套历史资料，已按当前候选切换库存来源，请核对${materialIdentityConflictFieldsText(item)}`);
  }
  sourceSearchManualPickRequired.value = false;
  lastInventorySuggestions.value = [item];
  activeSearchFocusBatchNo.value = item.matchedBatchNo || '';
  sourceSearchKeyword.value = item.partName ? `${item.partCode} ${item.partName}` : item.partCode;
  emit('sourceSearch', item.partCode);
}

function canAutoSwitchInventorySuggestion(item: InventoryMaterialSuggestion) {
  return !item.hasIdentityConflict;
}

function warnInventorySuggestionNeedsManualPick(item: InventoryMaterialSuggestion) {
  if (item.hasIdentityConflict) {
    ElMessage.warning(`物料编码 ${item.partCode} 存在多套历史资料，请核对${materialIdentityConflictFieldsText(item)}，并点击候选项人工确认后再切换库存来源`);
  }
}

function materialIdentityConflictFieldsText(item: InventoryMaterialSuggestion) {
  return item.identityConflictFields?.length ? item.identityConflictFields.join('、') : '图号、规格、厚度和项目型号';
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
    return;
  }

  const exactMatches = lastInventorySuggestions.value.filter(
    (item) => normalizeValue(item.partCode) === normalizeValue(keyword) || normalizeValue(item.partName) === normalizeValue(keyword)
  );
  if (exactMatches.length === 1) {
    const exact = exactMatches[0];
    if (!canAutoSwitchInventorySuggestion(exact)) {
      keepInventorySuggestionManualPick(exact);
      return;
    }
    sourceSearchManualPickRequired.value = false;
    lastInventorySuggestions.value = [exact];
    activeSearchFocusBatchNo.value = exact.matchedBatchNo || '';
    emit('sourceSearch', exact.partCode);
    return;
  }
  if (exactMatches.length > 1) {
    activeSearchFocusBatchNo.value = '';
    sourceSearchManualPickRequired.value = true;
    lastInventorySuggestions.value = exactMatches;
    ElMessage.warning('匹配到多个精确物料，请从下拉列表中选择具体零件');
    return;
  }

  try {
    const suggestions = await erpApi.inventoryMaterialSuggestions(
      keyword,
      undefined,
      'STOCK',
      props.excludeOrderNo,
      props.excludeOrderId,
      props.customerId
    );
    lastInventorySuggestions.value = suggestions;
    if (!suggestions.length) {
      activeSearchFocusBatchNo.value = '';
      sourceSearchManualPickRequired.value = false;
      ElMessage.warning('没有找到匹配物料');
      return;
    }
    const exactSuggestions = suggestions.filter(
      (item) => normalizeValue(item.partCode) === normalizeValue(keyword) || normalizeValue(item.partName) === normalizeValue(keyword)
    );
    if (exactSuggestions.length === 1) {
      const exact = exactSuggestions[0];
      if (!canAutoSwitchInventorySuggestion(exact)) {
        keepInventorySuggestionManualPick(exact);
        return;
      }
      sourceSearchManualPickRequired.value = false;
      activeSearchFocusBatchNo.value = exact.matchedBatchNo || '';
      sourceSearchKeyword.value = exact.partName ? `${exact.partCode} ${exact.partName}` : exact.partCode;
      emit('sourceSearch', exact.partCode);
      return;
    }
    sourceSearchManualPickRequired.value = true;
    if (exactSuggestions.length > 1) {
      activeSearchFocusBatchNo.value = '';
      lastInventorySuggestions.value = exactSuggestions;
      ElMessage.warning('匹配到多个精确物料，请从下拉列表中选择具体零件');
      return;
    }
    activeSearchFocusBatchNo.value = '';
    ElMessage.warning(
      suggestions.length > 1
        ? `找到 ${suggestions.length} 个匹配物料，请从下拉列表中选择具体零件`
        : '找到 1 个相似物料，请点击结果确认后再切换库存来源'
    );
  } catch (error) {
    activeSearchFocusBatchNo.value = '';
    sourceSearchManualPickRequired.value = false;
    ElMessage.error(error instanceof Error ? error.message : '库存查询失败');
  }
}

function searchExpectedPart() {
  if (expected.value?.partCode) {
    resetReviewConfirmation();
    sourceSearchManualPickRequired.value = false;
    activeSearchFocusBatchNo.value = '';
    lastInventorySuggestions.value = [];
    sourceSearchKeyword.value = expected.value.partName ? `${expected.value.partCode} ${expected.value.partName}` : expected.value.partCode;
    emit('sourceSearch', expected.value.partCode);
  }
}

function selectedSourceQuantity(row: InventorySourceBatchDetail) {
  return selectedSourceMap.value.get(row.id)?.quantity || 0;
}

function selectedSourceQuantityByBatchId(batchId: string) {
  return normalizeSelectedSources(props.selectedSources || []).find((source) => source.batchId === batchId)?.quantity || 0;
}

function selectedQuantityWithout(batchId: string) {
  return selectedSourceRows.value
    .filter((source) => source.batchId !== batchId)
    .reduce((sum, source) => sum + Number(source.quantity || 0), 0);
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
  return Math.max(Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000, 0);
}

function selectedSourceCapacity(source: StockSourceSelectionPayload) {
  return roundSelectionQuantity(selectedSourceCurrentAvailableQuantity(source));
}

function createSelectionFromRow(row: InventorySourceBatchDetail, quantity: number, previous?: StockSourceSelectionPayload) {
  const compatibility = compatibilityResult(row);
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
    compatibilityStatus: selectionCompatibilityStatus(row),
    compatibilityReason: selectionCompatibilityReason(compatibility),
    manualConfirmedBy: previous?.manualConfirmedBy,
    manualConfirmedAt: previous?.manualConfirmedAt,
    manualConfirmRemark: previous?.manualConfirmRemark
  } satisfies StockSourceSelectionPayload;
}

function selectedQueueTargetQuantity(sources: StockSourceSelectionPayload[], refillToRequired: boolean) {
  if (!refillToRequired) {
    return roundSelectionQuantity(sources.reduce((sum, source) => sum + Number(source.quantity || 0), 0));
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
  const nextQueueQuantity = sources.reduce((sum, source) => sum + Number(source.quantity || 0), 0);
  const queueAlreadyCoveredNeed = Math.max(selectedQuantityTotal.value, nextQueueQuantity) >= requiredQuantity.value - 0.0001;
  const hasQueuePlaceholder = sources.some((source) => Number(source.quantity || 0) <= 0);
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
          ? Number(options.lockQuantity || 0)
          : normalizedSource.quantity;
    const nextQuantity =
      options.lockIndex !== undefined && index > options.lockIndex
        ? Math.min(capacity, remainingQuantity)
        : Math.min(Math.max(Number(requestedQuantity || 0), 0), capacity, remainingQuantity);

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
  const preservedQuantity = preservedRows.reduce((sum, source) => sum + Number(source.quantity || 0), 0);
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
      rows.reduce((sum, source) => sum + Number(source.quantity || 0), 0),
      selectedQuantityUnit.value
    )}`
  );
}

function bulkSelectSourcesByQuantity() {
  if (!props.detail) {
    return;
  }
  const eachQuantity = Number(bulkEachQuantity.value || 0);
  if (!Number.isFinite(eachQuantity) || eachQuantity <= 0) {
    ElMessage.warning('请先填写每批使用数量');
    return;
  }

  const preservedRows = selectedSourcesOutsideCurrentDetail();
  const preservedQuantity = preservedRows.reduce((sum, source) => sum + Number(source.quantity || 0), 0);
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
      rows.reduce((sum, source) => sum + Number(source.quantity || 0), 0),
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
  updateSourceSelection(row, Number(value || 0));
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
  const nextQuantity = Math.max(0, Math.min(Number(quantity || 0), sourceMaxSelectableQuantity(row)));
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
  const nextQuantity = Math.max(0, Math.min(Number(value || 0), selectedSourceMaxQuantity(source)));
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
  emit('sourceSearch', partCode);
}

function selectedSourcesOutsideCurrentDetail() {
  const currentBatchIds = new Set(adjustedSourceRows.value.map((row) => row.id));
  return selectedSourceRows.value.filter((source) => !currentBatchIds.has(source.batchId));
}

function mergeCurrentDetailSelection(currentRows: StockSourceSelectionPayload[]) {
  return normalizeSelectedSources([...selectedSourcesOutsideCurrentDetail(), ...currentRows]);
}

function normalizeSelectedSources(sources: StockSourceSelectionPayload[]) {
  const rows = new Map<string, StockSourceSelectionPayload>();
  for (const source of sources || []) {
    const batchId = source.batchId?.trim();
    const quantity = Number(source.quantity || 0);
    if (!batchId || quantity < 0) {
      continue;
    }
    const current = rows.get(batchId);
    const availableQuantity =
      source.availableQuantity === undefined && current?.availableQuantity === undefined
        ? undefined
        : Math.max(Number(source.availableQuantity ?? 0), Number(current?.availableQuantity ?? 0));
    rows.set(batchId, {
      batchId,
      batchNo: source.batchNo?.trim() || current?.batchNo,
      partCode: source.partCode?.trim() || current?.partCode,
      partName: source.partName?.trim() || current?.partName,
      quantity: (current?.quantity || 0) + quantity,
      availableQuantity,
      unit: source.unit?.trim() || current?.unit,
      replenishmentSourceType: source.replenishmentSourceType?.trim() || current?.replenishmentSourceType,
      replenishmentSourceRequestNo: source.replenishmentSourceRequestNo?.trim() || current?.replenishmentSourceRequestNo,
      replenishmentSourceLabel: source.replenishmentSourceLabel?.trim() || current?.replenishmentSourceLabel,
      compatibilityStatus: normalizeCompatibilityStatus(source.compatibilityStatus || current?.compatibilityStatus),
      compatibilityReason: source.compatibilityReason?.trim() || current?.compatibilityReason,
      manualConfirmedBy: source.manualConfirmedBy?.trim() || current?.manualConfirmedBy,
      manualConfirmedAt: source.manualConfirmedAt?.trim() || current?.manualConfirmedAt,
      manualConfirmRemark: source.manualConfirmRemark?.trim() || current?.manualConfirmRemark
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
    const backendReservedQuantity = Math.max(Number(row.reservedQuantity || 0) - draftReserved, 0);
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
  return Number((row as SourceRow).draftReservedQuantity || 0);
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
    return `组件 ${row.componentNo}`;
  }
  if (row.parentComponentNo) {
    return `属于组件 ${row.parentComponentNo}`;
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

function drawingTitle(row: InventorySourceBatchDetail) {
  const drawingNo = row.drawingNo || '未记录图号';
  const version = row.drawingVersion ? ` / ${row.drawingVersion}` : '';
  return `${drawingNo}${version}`;
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

function compatibilityResult(row: InventorySourceBatchDetail) {
  const target = expected.value;
  if (!target) {
    return { type: 'info' as const, label: '未提供对照', reason: '' };
  }

  if (expectedMissingInfoReasons.value.length > 0) {
    return { type: 'warning' as const, label: '资料不完整', reason: `本次订单${expectedMissingInfoReasons.value.join('、')}` };
  }

  if (expectedFileMissing.value) {
    return { type: 'warning' as const, label: '资料不完整', reason: '本次订单未上传图纸文件' };
  }

  const missingReasons = [
    target.drawingNo && !row.drawingNo ? '库存缺图号' : '',
    target.drawingVersion && !row.drawingVersion ? '库存缺版本' : '',
    target.drawingFileUrl && !row.drawingFileUrl ? '库存缺图纸文件' : '',
    target.partSpecification && !row.partSpecification ? '库存缺规格' : '',
    target.partThickness && !row.partThickness ? '库存缺厚度' : ''
  ].filter(Boolean);
  if (missingReasons.length > 0) {
    return { type: 'warning' as const, label: '资料不完整', reason: missingReasons.join('、') };
  }

  const mismatchReasons = [
    sameText(row.partCode, target.partCode) ? '' : '物料编码不同',
    sameText(row.drawingNo, target.drawingNo) ? '' : '图号不同',
    sameText(row.drawingVersion, target.drawingVersion) ? '' : '版本不同',
    sameText(row.partSpecification, target.partSpecification) ? '' : '规格不同',
    sameNumber(row.partThickness, target.partThickness) ? '' : '厚度不同'
  ].filter(Boolean);

  if (mismatchReasons.length > 0) {
    return { type: 'danger' as const, label: '需要确认', reason: mismatchReasons.join('、') };
  }
  if (!row.drawingNo || !row.drawingVersion || !row.drawingFileUrl) {
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
  if (!row || Number(source.quantity || 0) <= 0) {
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
  return sourceUsageOrderIssue(source) || source.compatibilityReason || '需要人工确认';
}

function sourceNeedsManualConfirmation(source: StockSourceSelectionPayload) {
  if (Number(source.quantity || 0) <= 0) {
    return false;
  }
  return (
    Boolean(sourceUsageOrderIssue(source)) ||
    source.compatibilityStatus !== 'MATCHED' ||
    !sameText(source.partCode, expected.value?.partCode) ||
    Boolean(expected.value?.fulfillmentMode === 'STOCK' && (!orderDrawingInfoComplete.value || expectedFileMissing.value))
  );
}

function normalizeCompatibilityStatus(value?: string): CompatibilityStatus | undefined {
  if (value === 'MATCHED' || value === 'NEEDS_CONFIRMATION' || value === 'INCOMPLETE' || value === 'UNKNOWN') {
    return value;
  }
  return undefined;
}

function formatDateTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

function createManualConfirmForm(source: StockSourceSelectionPayload): ManualConfirmForm {
  return {
    confirmedBy: source.manualConfirmedBy || '',
    confirmedAt: toManualConfirmDate(source.manualConfirmedAt),
    remark: source.manualConfirmRemark || ''
  };
}

function ensureManualConfirmForm(source: StockSourceSelectionPayload) {
  if (!manualConfirmForms.value[source.batchId]) {
    manualConfirmForms.value[source.batchId] = createManualConfirmForm(source);
  }
  return manualConfirmForms.value[source.batchId];
}

function syncManualConfirmForms() {
  const nextForms: Record<string, ManualConfirmForm> = {};
  for (const source of selectedIssueSources.value) {
    const current = manualConfirmForms.value[source.batchId];
    nextForms[source.batchId] = current || createManualConfirmForm(source);
  }
  manualConfirmForms.value = nextForms;
}

async function openOrderPreview(orderNo?: string) {
  const normalizedOrderNo = orderNo?.trim();
  if (!normalizedOrderNo) {
    return;
  }
  orderPreviewVisible.value = true;
  orderPreviewLoading.value = true;
  orderPreview.value = null;
  try {
    orderPreview.value = await erpApi.order(normalizedOrderNo);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单信息查询失败');
  } finally {
    orderPreviewLoading.value = false;
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
    return {
      ...source,
      compatibilityStatus:
        reason && (!source.compatibilityStatus || source.compatibilityStatus === 'MATCHED')
          ? 'NEEDS_CONFIRMATION'
          : source.compatibilityStatus,
      compatibilityReason: reason || source.compatibilityReason,
      manualConfirmedBy: form.confirmedBy.trim(),
      manualConfirmedAt: (form.confirmedAt || confirmedAt).toISOString(),
      manualConfirmRemark: form.remark.trim()
    };
  });

  emit('selectionChange', normalizeSelectedSources(nextSources));
  emit('confirmReviewed');
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      activeSearchFocusBatchNo.value = '';
      transformRuleSuggestions.value = [];
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
    void loadTransformRuleSuggestions();
  }
);

watch(
  selectedIssueSources,
  () => {
    syncManualConfirmForms();
  },
  { deep: true, immediate: true, flush: 'sync' }
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
  max-height: 220px;
  overflow: auto;
  padding-top: 4px;
}

.source-search-results > strong {
  color: #1e3a8a;
  font-size: 13px;
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

.transform-suggestion-title span,
.transform-suggestion-item span,
.transform-suggestion-item small {
  color: #475569;
  font-size: 12px;
  line-height: 18px;
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
  gap: 8px;
  margin-bottom: 14px;
}

.source-bulk-actions span {
  color: #64748b;
  font-size: 12px;
}

.source-bulk-quantity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  gap: 6px;
  align-items: center;
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
  grid-template-columns: 46px minmax(220px, 1fr) minmax(120px, 160px) auto auto auto;
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
