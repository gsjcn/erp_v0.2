<template>
  <div class="desktop-table order-line-fixed-toolbar">
    <div>
      <strong>订单零件清单</strong>
      <span>已填写 {{ orderLineFixedTextLineCount }} 行 / 当前 {{ lines.length }} 行</span>
    </div>
    <div class="order-line-fixed-toolbar-actions">
      <div class="order-line-table-height-actions" aria-label="订单零件编辑表格高度">
        <span class="order-line-table-height-label">表格高度</span>
        <el-tooltip content="降低表格高度" placement="top">
          <el-button
            circle
            size="small"
            :icon="Minus"
            :disabled="orderLineEditorTableHeight <= orderLineEditorTableHeightLimits.min"
            aria-label="降低订单零件编辑表格高度"
            @click="adjustOrderLineEditorTableHeight(-orderLineEditorTableHeightLimits.step)"
          />
        </el-tooltip>
        <el-tooltip content="提高表格高度" placement="top">
          <el-button
            circle
            size="small"
            :icon="Plus"
            :disabled="orderLineEditorTableHeight >= orderLineEditorTableHeightLimits.max"
            aria-label="提高订单零件编辑表格高度"
            @click="adjustOrderLineEditorTableHeight(orderLineEditorTableHeightLimits.step)"
          />
        </el-tooltip>
        <el-tooltip content="恢复默认高度" placement="top">
          <el-button
            circle
            size="small"
            :icon="RefreshLeft"
            aria-label="恢复订单零件编辑表格默认高度"
            @click="resetOrderLineEditorTableHeight"
          />
        </el-tooltip>
      </div>
      <el-button size="small" :disabled="orderLineFixedTextLineCount === 0" @click="openOrderLineFixedTextDialog">查看固定格式</el-button>
      <el-button size="small" :disabled="orderLineFixedTextLineCount === 0" @click="copyOrderLineFixedText">复制清单</el-button>
    </div>
  </div>

  <el-table
    class="desktop-table order-line-table"
    :data="lines"
    border
    :row-class-name="orderLineRowClassName"
    :max-height="orderLineEditorTableHeight"
  >
    <el-table-column label="顺序" width="72" fixed="left" align="center">
      <template #default="{ $index }">
        <el-button
          class="line-drag-handle"
          text
          :draggable="!readOnly && lines.length > 1"
          :disabled="readOnly || lines.length <= 1"
          title="拖动调整顺序"
          @dragstart.stop="startLineDrag($event, $index)"
          @dragenter.prevent="handleLineDragOver($event, $index)"
          @dragover.prevent="handleLineDragOver($event, $index)"
          @drop.prevent="dropLineDrag($index)"
          @dragend="endLineDrag"
        >
          <el-icon><Rank /></el-icon>
        </el-button>
      </template>
    </el-table-column>
    <el-table-column label="结构" width="140" fixed="left">
      <template #default="{ row }">
        <div class="order-line-structure-cell" :class="orderLineStructureClass(row)">
          <el-tag :type="orderLineStructureTagType(row)" effect="plain">
            {{ orderLineStructureLabel(row) }}
          </el-tag>
          <small>{{ orderLineStructureHint(row) }}</small>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="行类型" width="104">
      <template #default="{ row }">
        <el-select v-model="row.lineType" placeholder="行类型" :disabled="readOnly" @change="handleLineTypeChange(row)">
          <el-option label="零件" value="PART" />
          <el-option label="组件" value="COMPONENT" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="零件类型" width="120">
      <template #default="{ row }">
        <el-select v-model="row.partCategory" clearable filterable placeholder="类型" :disabled="readOnly">
          <el-option label="通用件" value="通用件" />
          <el-option label="定制件" value="定制件" />
          <el-option label="数控件" value="数控件" />
          <el-option label="外协件" value="外协件" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="组件编号" width="120">
      <template #default="{ row }">
        <el-input
          v-model="row.componentNo"
          placeholder="组件行填 C001"
          :disabled="readOnly || row.lineType !== 'COMPONENT'"
          @focus="captureComponentNoBeforeEdit(row)"
          @blur="normalizeComponentFields(row)"
        />
      </template>
    </el-table-column>
    <el-table-column label="所属组件" width="120">
      <template #default="{ row }">
        <el-select
          v-model="row.parentComponentNo"
          clearable
          filterable
          placeholder="选择组件"
          :disabled="readOnly || row.lineType === 'COMPONENT'"
          @change="normalizeComponentFields(row)"
        >
          <el-option v-for="option in componentOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="零件编码" width="130">
      <template #default="{ row }">
        <el-autocomplete
          v-model="row.partCode"
          :fetch-suggestions="queryMaterialSuggestions"
          value-key="partCode"
          placeholder="编码/名称/拼音/图号/厚度/客户"
          :debounce="250"
          :trigger-on-focus="true"
          clearable
          :disabled="readOnly"
          popper-class="material-suggestion-popper"
          @input="handlePartCodeInput(row)"
          @blur="() => fillExactMaterialFromInput(row, 'partCode')"
          @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(row, item)"
        >
          <template #default="{ item }">
            <MaterialSuggestionOption :item="item" />
          </template>
        </el-autocomplete>
      </template>
    </el-table-column>
    <el-table-column label="零件名称" width="150">
      <template #default="{ row }">
        <div class="material-input-cell">
          <el-autocomplete
            v-model="row.partName"
            :fetch-suggestions="queryMaterialSuggestions"
            value-key="partName"
            placeholder="名称/编码/拼音/图号/厚度/客户"
            :debounce="250"
            :trigger-on-focus="true"
            clearable
            :disabled="readOnly"
            popper-class="material-suggestion-popper"
            @input="handlePartNameInput(row)"
            @blur="() => fillExactMaterialFromInput(row, 'partName')"
            @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(row, item)"
          >
            <template #default="{ item }">
              <MaterialSuggestionOption :item="item" />
            </template>
          </el-autocomplete>
          <small v-if="materialIdentityWarningText(row)" class="material-identity-warning">
            {{ materialIdentityWarningText(row) }}
          </small>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="库存/生产方式" width="170">
      <template #default="{ row }">
        <el-select v-model="row.fulfillmentMode" placeholder="选择方式" :disabled="readOnly" @change="handleFulfillmentModeChange(row)">
          <el-option label="重新生产" value="PRODUCTION" />
          <el-option label="使用库存" value="STOCK" />
          <el-option label="库存再加工" value="REWORK" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="当前库存" width="130">
      <template #default="{ row }">
        <div class="stock-status-cell">
          <el-tag :type="stockTagType(row)" effect="plain">
            {{ formatStockQuantity(row) }}
          </el-tag>
          <small :class="{ warning: stockGapQuantity(row) > 0 }">{{ stockStatusHint(row) }}</small>
          <el-button class="stock-detail-button" link type="primary" @click="openStockDetails(row)">
            {{ stockSourceActionText(row) }}
          </el-button>
          <el-tooltip
            v-if="stockSourceReviewRequired(row)"
            :content="stockSourceReviewHint(row)"
            placement="top"
          >
            <el-tag :type="isStockSourceReviewed(row) ? 'success' : 'warning'" effect="plain">
              {{ isStockSourceReviewed(row) ? '已核对来源' : '未核对来源' }}
            </el-tag>
          </el-tooltip>
          <el-tooltip v-if="selectedSourceSummary(row)" :content="selectedSourceSummary(row)" placement="top">
            <small class="selected-source-summary">
              {{ selectedSourceSummary(row) }}
            </small>
          </el-tooltip>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="厚度(mm)" width="120">
      <template #default="{ row }">
        <el-tag v-if="!orderLineRequiresThickness(row)" type="info" effect="plain" title="父级组件由子零件分别维护厚度">组件不适用</el-tag>
        <el-input-number
          v-else
          v-model="row.partThickness"
          :min="0.001"
          :precision="3"
          :controls="false"
          :disabled="readOnly"
          style="width: 96px"
          @change="handleStockComparableChange(row)"
        />
      </template>
    </el-table-column>
    <el-table-column label="成品规格" width="190">
      <template #default="{ row }">
        <el-select
          v-model="row.partSpecification"
          filterable
          allow-create
          placeholder="例如 120mm x 204mm x 10mm"
          :disabled="readOnly"
          @change="handleStockComparableChange(row)"
        >
          <el-option v-for="item in specificationOptions" :key="item" :label="item" :value="item" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="图号" width="130">
      <template #default="{ row }"><el-input v-model="row.drawingNo" :disabled="readOnly" @input="handleStockComparableChange(row)" /></template>
    </el-table-column>
    <el-table-column label="版本" width="90">
      <template #default="{ row }"><el-input v-model="row.drawingVersion" placeholder="A" :disabled="readOnly" @input="handleStockComparableChange(row)" /></template>
    </el-table-column>
    <el-table-column label="图纸" width="230">
      <template #default="{ row }">
        <div class="drawing-upload-cell">
          <el-select
            v-if="row.partCode"
            v-model="row.selectedDrawingRevisionId"
            size="small"
            clearable
            filterable
            placeholder="选择零件库图纸"
            :loading="isDrawingRevisionLoading(row)"
            :disabled="readOnly"
            @visible-change="(visible: boolean) => handleDrawingRevisionVisibleChange(row, visible)"
            @change="(revisionId: string) => selectLineDrawingRevision(row, revisionId)"
          >
            <el-option
              v-for="revision in drawingRevisionOptionsForLine(row)"
              :key="revision.id"
              :label="formatDrawingRevisionOption(revision)"
              :value="revision.id"
            />
          </el-select>
          <el-upload :show-file-list="false" :http-request="createUploadRequest(row)" accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf" :disabled="readOnly">
            <el-button size="small" :disabled="readOnly">上传图纸</el-button>
          </el-upload>
          <DrawingPreviewLink :file-name="row.drawingFileName" :file-url="row.drawingFileUrl" :title="`${row.partName || row.partCode || '零件'} 图纸预览`" />
        </div>
      </template>
    </el-table-column>
    <el-table-column label="零件交期" width="150">
      <template #default="{ row }">
        <el-date-picker
          v-model="row.deliveryDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="默认订单交期"
          :disabled="readOnly"
          style="width: 132px"
        />
      </template>
    </el-table-column>
    <el-table-column label="客户订单数量" width="150">
      <template #default="{ row }">
        <el-input-number
          v-model="row.quantity"
          :min="1"
          :controls="false"
          :disabled="readOnly"
          style="width: 110px"
          @change="emitQuantityChange(row)"
        />
      </template>
    </el-table-column>
    <el-table-column label="生产计划数量" width="150">
      <template #default="{ row }">
        <el-input-number
          v-model="row.productionPlanQuantity"
          :min="productionPlanMin(row)"
          :controls="false"
          :disabled="readOnly"
          style="width: 110px"
          @change="handlePlanQuantityChange(row)"
        />
        <small v-if="stockProductionPlanHint(row)" class="stock-plan-hint">
          {{ stockProductionPlanHint(row) }}
        </small>
      </template>
    </el-table-column>
    <el-table-column label="计划偏差说明" width="260">
      <template #default="{ row }">
        <div v-if="stockProductionPlanDiffers(row)" class="plan-override-cell">
          <el-input v-model="row.productionPlanOverrideByCode" size="small" placeholder="操作人员账号" :disabled="readOnly" />
          <el-input
            v-model="row.productionPlanOverrideReason"
            size="small"
            type="textarea"
            :rows="2"
            placeholder="备货、替代品、客户确认少做或需多做备件"
            :disabled="readOnly"
          />
        </div>
        <span v-else class="muted">-</span>
      </template>
    </el-table-column>
    <el-table-column label="单位" width="100">
      <template #default="{ row }"><el-input v-model="row.unit" :disabled="readOnly" @input="handleUnitInput(row)" /></template>
    </el-table-column>
    <el-table-column label="操作" width="96" fixed="right" align="center">
      <template #default="{ $index }">
        <el-button v-if="!readOnly" class="line-remove-button" link type="danger" :icon="Delete" @click="emitRemove($index)">
          {{ removeButtonText }}
        </el-button>
      </template>
    </el-table-column>
  </el-table>

  <div class="mobile-section order-line-mobile">
    <div class="order-line-mobile-toolbar">
      <span>订单零件已填写 {{ orderLineFixedTextLineCount }} / 当前 {{ lines.length }} 项</span>
      <div>
        <el-button size="small" :disabled="orderLineFixedTextLineCount === 0" @click="openOrderLineFixedTextDialog">固定格式</el-button>
        <el-button size="small" @click="expandAllMobileLineCards">全部展开</el-button>
        <el-button size="small" @click="collapseAllMobileLineCards">全部收起</el-button>
      </div>
    </div>
    <article
      v-for="(line, index) in lines"
      :key="`${index}-${line.partCode}`"
      class="mobile-card order-line-card"
      :class="{ expanded: isMobileLineExpanded(index) }"
    >
      <div class="mobile-card-header">
        <div class="mobile-card-title">
          <strong>零件 {{ index + 1 }}</strong>
          <el-tag :type="orderLineStructureTagType(line)" effect="plain" size="small">
            {{ orderLineStructureLabel(line) }}
          </el-tag>
          <small>{{ line.partName || line.partCode || '未填写零件资料' }}</small>
        </div>
        <div class="mobile-card-header-actions">
          <el-button link type="primary" @click.stop="toggleMobileLineCard(index)">
            {{ isMobileLineExpanded(index) ? '收起' : '详情' }}
          </el-button>
          <el-button v-if="!readOnly" class="line-remove-button" link type="danger" :icon="Delete" @click="emitRemove(index)">
            {{ removeButtonText }}
          </el-button>
        </div>
      </div>

      <div class="mobile-card-compact-summary order-line-compact-summary">
        <span>{{ orderLineStructureHint(line) }}</span>
        <span>{{ line.partCode || '未填编码' }}</span>
        <span>{{ fulfillmentModeText(line) }}</span>
        <span>订单 {{ formatQuantity(line.quantity ?? 0, line.unit || '件') }}</span>
        <span>计划 {{ formatQuantity(line.productionPlanQuantity ?? suggestedProductionPlanQuantity(line), line.unit || '件') }}</span>
        <span>交期 {{ line.deliveryDate || defaultDeliveryDate || '-' }}</span>
        <span v-if="selectedStockSourceQuantity(line) > 0">库存 {{ formatQuantity(selectedStockSourceQuantity(line), line.unit || '件') }}</span>
        <span v-if="stockSourceReviewRequired(line)" :class="isStockSourceReviewed(line) ? 'success' : 'warning'">
          {{ isStockSourceReviewed(line) ? '已核对来源' : '未核对来源' }}
        </span>
        <span v-if="stockProductionPlanDiffers(line)" class="warning">计划偏差待说明</span>
      </div>

      <div v-show="isMobileLineExpanded(index)" class="order-line-mobile-fields">
        <label>
          <span>行类型</span>
          <el-select v-model="line.lineType" placeholder="行类型" :disabled="readOnly" @change="handleLineTypeChange(line)">
            <el-option label="零件" value="PART" />
            <el-option label="组件" value="COMPONENT" />
          </el-select>
        </label>
        <label>
          <span>零件类型</span>
          <el-select v-model="line.partCategory" clearable filterable placeholder="类型" :disabled="readOnly">
            <el-option label="通用件" value="通用件" />
            <el-option label="定制件" value="定制件" />
            <el-option label="数控件" value="数控件" />
            <el-option label="外协件" value="外协件" />
          </el-select>
        </label>
        <label>
          <span>组件编号</span>
          <el-input
            v-model="line.componentNo"
            placeholder="组件行填 C001"
            :disabled="readOnly || line.lineType !== 'COMPONENT'"
            @focus="captureComponentNoBeforeEdit(line)"
            @blur="normalizeComponentFields(line)"
          />
        </label>
        <label>
          <span>所属组件</span>
          <el-select
            v-model="line.parentComponentNo"
            clearable
            filterable
            placeholder="选择组件"
            :disabled="readOnly || line.lineType === 'COMPONENT'"
            @change="normalizeComponentFields(line)"
          >
            <el-option v-for="option in componentOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </label>
        <label>
          <span>零件编码</span>
          <el-autocomplete
            v-model="line.partCode"
            :fetch-suggestions="queryMaterialSuggestions"
            value-key="partCode"
            placeholder="编码/名称/拼音/图号/厚度/客户"
            :debounce="250"
            :trigger-on-focus="true"
            clearable
            :disabled="readOnly"
            popper-class="material-suggestion-popper"
            @input="handlePartCodeInput(line)"
            @blur="() => fillExactMaterialFromInput(line, 'partCode')"
            @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(line, item)"
          >
            <template #default="{ item }">
              <MaterialSuggestionOption :item="item" />
            </template>
          </el-autocomplete>
        </label>
        <label>
          <span>零件名称</span>
          <div class="material-input-cell">
            <el-autocomplete
              v-model="line.partName"
              :fetch-suggestions="queryMaterialSuggestions"
              value-key="partName"
              placeholder="名称/编码/拼音/图号/厚度/客户"
              :debounce="250"
              :trigger-on-focus="true"
              clearable
              :disabled="readOnly"
              popper-class="material-suggestion-popper"
              @input="handlePartNameInput(line)"
              @blur="() => fillExactMaterialFromInput(line, 'partName')"
              @select="(item: InventoryMaterialSuggestion) => selectMaterialSuggestion(line, item)"
            >
              <template #default="{ item }">
                <MaterialSuggestionOption :item="item" />
              </template>
            </el-autocomplete>
            <small v-if="materialIdentityWarningText(line)" class="material-identity-warning">
              {{ materialIdentityWarningText(line) }}
            </small>
          </div>
        </label>
        <label>
          <span>库存/生产方式</span>
          <el-select v-model="line.fulfillmentMode" placeholder="选择方式" :disabled="readOnly" @change="handleFulfillmentModeChange(line)">
            <el-option label="重新生产" value="PRODUCTION" />
            <el-option label="使用库存" value="STOCK" />
            <el-option label="库存再加工" value="REWORK" />
          </el-select>
        </label>
        <label>
          <span>当前库存</span>
          <div class="stock-status-cell">
            <el-tag :type="stockTagType(line)" effect="plain">
              {{ formatStockQuantity(line) }}
            </el-tag>
            <small :class="{ warning: stockGapQuantity(line) > 0 }">{{ stockStatusHint(line) }}</small>
            <el-button class="stock-detail-button" link type="primary" @click="openStockDetails(line)">
              {{ stockSourceActionText(line) }}
            </el-button>
            <el-tooltip
              v-if="stockSourceReviewRequired(line)"
              :content="stockSourceReviewHint(line)"
              placement="top"
            >
              <el-tag :type="isStockSourceReviewed(line) ? 'success' : 'warning'" effect="plain">
                {{ isStockSourceReviewed(line) ? '已核对来源' : '未核对来源' }}
              </el-tag>
            </el-tooltip>
            <el-tooltip v-if="selectedSourceSummary(line)" :content="selectedSourceSummary(line)" placement="top">
              <small class="selected-source-summary">
                {{ selectedSourceSummary(line) }}
              </small>
            </el-tooltip>
          </div>
        </label>
        <label>
          <span>图号</span>
          <el-input v-model="line.drawingNo" :disabled="readOnly" @input="handleStockComparableChange(line)" />
        </label>
        <label>
          <span>图纸版本</span>
          <el-input v-model="line.drawingVersion" placeholder="A" :disabled="readOnly" @input="handleStockComparableChange(line)" />
        </label>
        <label>
          <span>零件厚度(mm)</span>
          <el-tag v-if="!orderLineRequiresThickness(line)" type="info" effect="plain" title="父级组件由子零件分别维护厚度">组件不适用</el-tag>
          <el-input-number
            v-else
            v-model="line.partThickness"
            :min="0.001"
            :precision="3"
            :controls="false"
            :disabled="readOnly"
            @change="handleStockComparableChange(line)"
          />
        </label>
        <label>
          <span>成品规格</span>
          <el-select
            v-model="line.partSpecification"
            filterable
            allow-create
            placeholder="例如 120mm x 204mm x 10mm"
            :disabled="readOnly"
            @change="handleStockComparableChange(line)"
          >
            <el-option v-for="item in specificationOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </label>
        <label>
          <span>图纸上传</span>
          <div class="drawing-upload-cell">
            <el-select
              v-if="line.partCode"
              v-model="line.selectedDrawingRevisionId"
              clearable
              filterable
              placeholder="选择零件库图纸"
              :loading="isDrawingRevisionLoading(line)"
              :disabled="readOnly"
              @visible-change="(visible: boolean) => handleDrawingRevisionVisibleChange(line, visible)"
              @change="(revisionId: string) => selectLineDrawingRevision(line, revisionId)"
            >
              <el-option
                v-for="revision in drawingRevisionOptionsForLine(line)"
                :key="revision.id"
                :label="formatDrawingRevisionOption(revision)"
                :value="revision.id"
              />
            </el-select>
            <el-upload :show-file-list="false" :http-request="createUploadRequest(line)" accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf" :disabled="readOnly">
              <el-button :disabled="readOnly">上传图纸</el-button>
            </el-upload>
            <DrawingPreviewLink :file-name="line.drawingFileName" :file-url="line.drawingFileUrl" :title="`${line.partName || line.partCode || '零件'} 图纸预览`" />
          </div>
        </label>
        <label>
          <span>零件交期</span>
          <el-date-picker
            v-model="line.deliveryDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="默认订单交期"
            :disabled="readOnly"
          />
        </label>
        <label>
          <span>客户订单数量</span>
          <el-input-number v-model="line.quantity" :min="1" :controls="false" :disabled="readOnly" @change="emitQuantityChange(line)" />
        </label>
        <label>
          <span>生产计划数量</span>
          <el-input-number
            v-model="line.productionPlanQuantity"
            :min="productionPlanMin(line)"
            :controls="false"
            :disabled="readOnly"
            @change="handlePlanQuantityChange(line)"
          />
          <small v-if="stockProductionPlanHint(line)" class="stock-plan-hint">
            {{ stockProductionPlanHint(line) }}
          </small>
        </label>
        <label v-if="stockProductionPlanDiffers(line)">
          <span>计划偏差说明</span>
          <el-input v-model="line.productionPlanOverrideByCode" placeholder="操作人员账号" :disabled="readOnly" />
          <el-input
            v-model="line.productionPlanOverrideReason"
            type="textarea"
            :rows="2"
            placeholder="备货、替代品、客户确认少做或需多做备件"
            :disabled="readOnly"
          />
        </label>
        <label>
          <span>单位</span>
          <el-input v-model="line.unit" :disabled="readOnly" @input="handleUnitInput(line)" />
        </label>
      </div>
    </article>
  </div>

  <InventorySourceDetailsDialog
    v-model="sourceDetailsVisible"
    :loading="sourceDetailsLoading"
    :detail="sourceDetails"
    :expected="sourceExpected"
    :selected-sources="currentSourceLine?.selectedStockSources || []"
    :draft-reserved-sources="otherLineSelectedStockSources"
    :exclude-order-no="excludeOrderNo"
    :exclude-order-id="excludeOrderId"
    :customer-id="customerId"
    :review-mode="!readOnly"
    :reviewed="Boolean(currentSourceLine && isStockSourceReviewed(currentSourceLine))"
    @source-search="loadStockDetailsForPart"
    @selection-change="handleStockSourceSelectionChange"
    @confirm-reviewed="handleStockSourceReviewed"
  />

  <el-dialog v-model="orderLineFixedTextDialogVisible" class="responsive-dialog" title="订单零件固定格式清单" width="900px">
    <el-input
      class="order-line-fixed-textarea"
      :model-value="orderLineFixedText"
      type="textarea"
      :rows="22"
      readonly
    />
    <template #footer>
      <el-button @click="orderLineFixedTextDialogVisible = false">关闭</el-button>
      <el-button type="primary" :disabled="!orderLineFixedText" @click="copyOrderLineFixedText">复制清单</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadRequestOptions } from 'element-plus';
import { Delete, Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import type { CreateOrderLinePayload, StockSourceSelectionPayload } from '../api/erp';
import type { InventoryMaterialSuggestion, InventorySourceDetailResponse, InventorySourceExpected, InventorySummaryRow, MaterialDrawingRevision } from '../types/erp';
import DrawingPreviewLink from './DrawingPreviewLink.vue';
import InventorySourceDetailsDialog from './InventorySourceDetailsDialog.vue';
import MaterialSuggestionOption from './MaterialSuggestionOption.vue';
import { confirmUploadDrawingFileName } from '../utils/orderLineDuplicateChecks';
import { formatQuantity } from '../utils/format';
import { availableStockQuantity as getAvailableStockQuantity, matchedStockSummary } from '../utils/orderLineStockChecks';
import {
  isStockSourceReviewed,
  markStockSourceReviewed,
  normalizeSelectedStockSources,
  selectedStockSourceQuantity,
  suggestedProductionPlanQuantity,
  stockSourceRequiredQuantity,
  stockSourceReviewRequired
} from '../utils/stockSourceReview';

const props = withDefaults(
  defineProps<{
    lines: CreateOrderLinePayload[];
    componentSourceLines?: Array<Pick<CreateOrderLinePayload, 'lineType' | 'componentNo' | 'partName' | 'partCode'>>;
    minLines?: number;
    defaultDeliveryDate?: string;
    customerId?: string;
    excludeOrderNo?: string;
    excludeOrderId?: string;
    inventorySummary?: InventorySummaryRow[];
    readOnly?: boolean;
  }>(),
  {
    componentSourceLines: () => [],
    minLines: 1,
    defaultDeliveryDate: '',
    customerId: '',
    excludeOrderNo: '',
    excludeOrderId: '',
    inventorySummary: () => [],
    readOnly: false
  }
);

const lines = computed(() => props.lines);
const defaultDeliveryDate = computed(() => props.defaultDeliveryDate);
const excludeOrderNo = computed(() => props.excludeOrderNo);
const excludeOrderId = computed(() => props.excludeOrderId);
const readOnly = computed(() => props.readOnly);
const removeButtonText = computed(() => (props.lines.length > props.minLines ? '删除' : '清空'));
const sourceDetailsVisible = ref(false);
const sourceDetailsLoading = ref(false);
const sourceDetails = ref<InventorySourceDetailResponse | null>(null);
const sourceExpected = ref<InventorySourceExpected | null>(null);
const currentSourceLine = ref<CreateOrderLinePayload | null>(null);
const sourceDetailsRequestSeq = ref(0);
const orderLineFixedTextDialogVisible = ref(false);
const stockCoverAutoSyncedLines = new WeakSet<CreateOrderLinePayload>();
const materialSuggestionRequestSeq = ref(0);
const expandedMobileLineIndexes = ref<number[]>([]);
const mobileLineExpansionInitialized = ref(false);
const draggedLineIndex = ref<number | null>(null);
const dragOverLineIndex = ref<number | null>(null);
const dragOverLineInsertAfter = ref(false);
const orderLineRuntimeIds = new WeakMap<CreateOrderLinePayload, string>();
const drawingRevisionOptionsByLineId = ref<Record<string, MaterialDrawingRevision[]>>({});
const drawingRevisionLoadingByLineId = ref<Record<string, boolean>>({});
let orderLineRuntimeSeq = 0;
const otherLineSelectedStockSources = computed(() =>
  currentSourceLine.value
    ? props.lines
        .filter((line) => line !== currentSourceLine.value)
        .flatMap((line) => line.selectedStockSources || [])
    : []
);
const componentOptions = computed(() => {
  const seen = new Set<string>();
  return [...props.componentSourceLines, ...props.lines]
    .map((line, index) => ({
      lineType: line.lineType,
      value: normalizeComponentNo(line.componentNo),
      labelText: line.partName || line.partCode || '',
      sourceLabel: index < props.componentSourceLines.length ? '已有订单组件' : '当前明细组件'
    }))
    .filter((line) => {
      if (line.lineType !== 'COMPONENT' || !line.value || seen.has(line.value)) {
        return false;
      }
      seen.add(line.value);
      return true;
    })
    .map((line) => ({
      value: line.value,
      label: line.labelText ? `${line.value} | ${line.sourceLabel} | ${line.labelText}` : `${line.value} | ${line.sourceLabel}`
    }));
});
const orderLineFixedTextLines = computed(() => props.lines.filter((line) => !isBlankOrderLineForFixedText(line)));
const orderLineFixedTextLineCount = computed(() => orderLineFixedTextLines.value.length);
const orderLineFixedText = computed(() => buildOrderLineFixedText());
const orderLineEditorTableHeightLimits = { min: 360, max: 920, step: 80 } as const;
const orderLineEditorTableDefaultHeight = 560;
const orderLineEditorTableHeightStorageKey = 'baisheng.erp.orderLineEditorTableHeight.v1';
// 订单零件编辑表格高度只保存为本机 UI 偏好，不写入订单明细、导入草稿、生产或库存业务数据。
const orderLineEditorTableHeight = ref(orderLineEditorTableDefaultHeight);

const emit = defineEmits<{
  remove: [index: number];
  quantityChange: [line: CreateOrderLinePayload];
}>();

const specificationOptions = ['120mm x 204mm x 10mm', '200mm x 300mm x 2mm', '500mm x 800mm x 3mm'];
type MaterialSuggestionInputField = 'partCode' | 'partName';
type AutoMaterialField =
  | 'partName'
  | 'unit'
  | 'partSpecification'
  | 'drawingNo'
  | 'drawingVersion'
  | 'drawingDate'
  | 'drawingStatus'
  | 'drawingFileName'
  | 'drawingFileUrl'
  | 'projectModel'
  | 'processRoute'
  | 'partThickness';
type AutoMaterialSnapshot = {
  partCode: string;
  partName: string;
  autoFields: Partial<Record<AutoMaterialField, string | number | null | undefined>>;
};
type MaterialIdentityWarning = {
  partCode: string;
  partName: string;
  text: string;
};
type OrderLineDragGroup = {
  line: CreateOrderLinePayload;
  children: CreateOrderLinePayload[];
};
type OrderLineStructureTagType = 'success' | 'warning' | 'info' | 'danger';
const autoMaterialSnapshots = new WeakMap<CreateOrderLinePayload, AutoMaterialSnapshot>();
const materialIdentityWarnings = new WeakMap<CreateOrderLinePayload, MaterialIdentityWarning>();
const materialIdentityWarningVersion = ref(0);
const componentNoEditSnapshots = new WeakMap<CreateOrderLinePayload, string>();

function clampOrderLineEditorTableHeight(value: number) {
  const normalizedHeight = Math.round(Number(value));
  if (!Number.isFinite(normalizedHeight)) {
    return orderLineEditorTableDefaultHeight;
  }
  return Math.min(
    orderLineEditorTableHeightLimits.max,
    Math.max(orderLineEditorTableHeightLimits.min, normalizedHeight)
  );
}

function adjustOrderLineEditorTableHeight(delta: number) {
  orderLineEditorTableHeight.value = clampOrderLineEditorTableHeight(orderLineEditorTableHeight.value + delta);
}

function resetOrderLineEditorTableHeight() {
  orderLineEditorTableHeight.value = orderLineEditorTableDefaultHeight;
}

function restoreOrderLineEditorTableHeight() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const savedHeightText = window.localStorage.getItem(orderLineEditorTableHeightStorageKey);
    if (!savedHeightText) {
      return;
    }
    const savedHeight = Number(savedHeightText);
    if (Number.isFinite(savedHeight)) {
      orderLineEditorTableHeight.value = clampOrderLineEditorTableHeight(savedHeight);
    }
  } catch {
    // 本机 UI 偏好读取失败时使用默认高度，不影响订单零件编辑。
  }
}

function saveOrderLineEditorTableHeight() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(orderLineEditorTableHeightStorageKey, String(orderLineEditorTableHeight.value));
  } catch {
    // 本机 UI 偏好写入失败不阻断订单零件编辑、库存来源核对或导入草稿维护。
  }
}

restoreOrderLineEditorTableHeight();

watch(orderLineEditorTableHeight, () => {
  saveOrderLineEditorTableHeight();
});

watch(
  () => props.lines.length,
  (length, previousLength = 0) => {
    if (!mobileLineExpansionInitialized.value) {
      expandedMobileLineIndexes.value = length === 1 ? [0] : [];
      mobileLineExpansionInitialized.value = true;
      return;
    }
    const existingIndexes = expandedMobileLineIndexes.value.filter((index) => index < length);
    const startIndex = Math.max(previousLength, 0);
    const addedIndexes = Array.from({ length: Math.max(length - startIndex, 0) }, (_, offset) => startIndex + offset);
    expandedMobileLineIndexes.value = Array.from(new Set([...existingIndexes, ...addedIndexes]));
  },
  { immediate: true }
);

function isMobileLineExpanded(index: number) {
  return expandedMobileLineIndexes.value.includes(index);
}

function toggleMobileLineCard(index: number) {
  expandedMobileLineIndexes.value = isMobileLineExpanded(index)
    ? expandedMobileLineIndexes.value.filter((item) => item !== index)
    : [...expandedMobileLineIndexes.value, index];
}

function expandAllMobileLineCards() {
  expandedMobileLineIndexes.value = props.lines.map((_, index) => index);
}

function collapseAllMobileLineCards() {
  expandedMobileLineIndexes.value = [];
}

function orderLineRuntimeId(line: CreateOrderLinePayload) {
  const existing = orderLineRuntimeIds.get(line);
  if (existing) {
    return existing;
  }
  orderLineRuntimeSeq += 1;
  const id = `line-${orderLineRuntimeSeq}`;
  orderLineRuntimeIds.set(line, id);
  return id;
}

function drawingRevisionOptionsForLine(line: CreateOrderLinePayload) {
  return drawingRevisionOptionsByLineId.value[orderLineRuntimeId(line)] || [];
}

function isDrawingRevisionLoading(line: CreateOrderLinePayload) {
  return Boolean(drawingRevisionLoadingByLineId.value[orderLineRuntimeId(line)]);
}

function setDrawingRevisionOptions(line: CreateOrderLinePayload, rows: MaterialDrawingRevision[]) {
  const key = orderLineRuntimeId(line);
  drawingRevisionOptionsByLineId.value = {
    ...drawingRevisionOptionsByLineId.value,
    [key]: rows
  };
}

function setDrawingRevisionLoading(line: CreateOrderLinePayload, loading: boolean) {
  const key = orderLineRuntimeId(line);
  drawingRevisionLoadingByLineId.value = {
    ...drawingRevisionLoadingByLineId.value,
    [key]: loading
  };
}

function clearSelectedMaterialDrawingRevisions(line: CreateOrderLinePayload) {
  line.selectedMaterialId = '';
  line.selectedDrawingRevisionId = '';
  setDrawingRevisionOptions(line, []);
}

function formatDrawingRevisionOption(row: MaterialDrawingRevision) {
  const parts = [
    `${row.drawingNo} / ${row.drawingVersion}`,
    row.isDefault ? '默认' : '',
    row.drawingDate || '',
    row.drawingStatus || '',
    row.drawingFileName || ''
  ].filter(Boolean);
  return parts.join(' / ');
}

function matchDrawingRevisionId(line: CreateOrderLinePayload, rows: MaterialDrawingRevision[]) {
  const drawingNo = normalizeMaterialSuggestionValue(line.drawingNo);
  const drawingVersion = normalizeMaterialSuggestionValue(line.drawingVersion);
  const drawingFileUrl = String(line.drawingFileUrl || '').trim();
  const drawingFileName = normalizeMaterialSuggestionValue(line.drawingFileName);
  const matched = rows.find((row) => {
    const sameNo = normalizeMaterialSuggestionValue(row.drawingNo) === drawingNo;
    const sameVersion = normalizeMaterialSuggestionValue(row.drawingVersion) === drawingVersion;
    const sameUrl = drawingFileUrl && row.drawingFileUrl === drawingFileUrl;
    const sameFileName = drawingFileName && normalizeMaterialSuggestionValue(row.drawingFileName) === drawingFileName;
    return (sameNo && sameVersion) || sameUrl || sameFileName;
  });
  return matched?.id || '';
}

async function loadDrawingRevisionsForLine(line: CreateOrderLinePayload, materialId: string) {
  if (!materialId) {
    setDrawingRevisionOptions(line, []);
    return;
  }
  setDrawingRevisionLoading(line, true);
  try {
    const response = await erpApi.materialDrawingRevisions(materialId);
    const rows = response.items.filter((item) => item.status === 'ENABLED');
    setDrawingRevisionOptions(line, rows);
    line.selectedDrawingRevisionId = matchDrawingRevisionId(line, rows);
  } catch (error) {
    setDrawingRevisionOptions(line, []);
    ElMessage.error(error instanceof Error ? error.message : '图纸版本加载失败，请确认零件基础库和后端服务');
  } finally {
    setDrawingRevisionLoading(line, false);
  }
}

async function resolveLineMaterialId(line: CreateOrderLinePayload) {
  const existing = line.selectedMaterialId?.trim();
  if (existing) {
    return existing;
  }
  const partCode = line.partCode?.trim();
  if (!partCode) {
    return '';
  }
  const matched = await erpApi.inventoryMaterialByPartCode(partCode, 'ENABLED');
  line.selectedMaterialId = matched?.id || '';
  return line.selectedMaterialId;
}

async function ensureDrawingRevisionsLoaded(line: CreateOrderLinePayload) {
  if (readOnly.value) {
    return;
  }
  if (drawingRevisionOptionsForLine(line).length > 0 || isDrawingRevisionLoading(line)) {
    return;
  }
  const materialId = await resolveLineMaterialId(line);
  if (materialId) {
    await loadDrawingRevisionsForLine(line, materialId);
  }
}

function handleDrawingRevisionVisibleChange(line: CreateOrderLinePayload, visible: boolean) {
  if (visible) {
    void ensureDrawingRevisionsLoaded(line);
  }
}

function applyDrawingRevisionToLine(line: CreateOrderLinePayload, revision: MaterialDrawingRevision) {
  if (guardReadOnlyOrderLineMutation('选择图纸版本')) {
    return;
  }
  line.drawingNo = revision.drawingNo;
  line.drawingVersion = revision.drawingVersion;
  line.drawingDate = revision.drawingDate || undefined;
  line.drawingStatus = revision.drawingStatus || '';
  line.drawingFileName = revision.drawingFileName || '';
  line.drawingFileUrl = revision.drawingFileUrl || '';
  line.selectedDrawingRevisionId = revision.id;
  invalidateStockSourceReview(line, false, true);
}

function selectLineDrawingRevision(line: CreateOrderLinePayload, revisionId: string) {
  if (!revisionId) {
    return;
  }
  const revision = drawingRevisionOptionsForLine(line).find((row) => row.id === revisionId);
  if (!revision) {
    return;
  }
  applyDrawingRevisionToLine(line, revision);
}

function guardReadOnlyOrderLineMutation(actionText: string) {
  if (!props.readOnly) {
    return false;
  }
  // 手机端订单明细只读，防止绕过外层页面入口后误改订单、图纸或库存来源。
  ElMessage.warning(`订单明细只读，${actionText}请在电脑端操作`);
  return true;
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
  if (props.readOnly || props.lines.length <= 1) {
    return;
  }
  draggedLineIndex.value = index;
  dragOverLineIndex.value = index;
  dragOverLineInsertAfter.value = false;
  event.dataTransfer?.setData('text/plain', String(index));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function handleLineDragOver(event: DragEvent, index: number) {
  if (props.readOnly || draggedLineIndex.value === null) {
    return;
  }
  dragOverLineIndex.value = index;
  dragOverLineInsertAfter.value = isDragAfterRowMiddle(event);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function componentNoForOrderLine(line?: Pick<CreateOrderLinePayload, 'lineType' | 'componentNo'> | null) {
  return line?.lineType === 'COMPONENT' ? normalizeComponentNo(line.componentNo) : '';
}

function parentComponentNoForOrderLine(line?: Pick<CreateOrderLinePayload, 'lineType' | 'parentComponentNo'> | null) {
  return line?.lineType !== 'COMPONENT' ? normalizeComponentNo(line?.parentComponentNo) : '';
}

function hasAvailableComponentNo(componentNo: string) {
  return [...props.componentSourceLines, ...props.lines].some((line) => componentNoForOrderLine(line) === componentNo);
}

function hasSourceComponentNo(componentNo: string) {
  return props.componentSourceLines.some((line) => componentNoForOrderLine(line) === componentNo);
}

function isMissingParentComponentLine(line: CreateOrderLinePayload) {
  const parentComponentNo = parentComponentNoForOrderLine(line);
  return Boolean(parentComponentNo && !hasAvailableComponentNo(parentComponentNo));
}

function parentComponentScopeText(line: CreateOrderLinePayload) {
  const parentComponentNo = parentComponentNoForOrderLine(line);
  if (!parentComponentNo) {
    return '不属于组件';
  }
  if (isMissingParentComponentLine(line)) {
    return `所属组件不存在 ${parentComponentNo}`;
  }
  return hasSourceComponentNo(parentComponentNo) && !hasLocalComponentNo(parentComponentNo)
    ? `所属已有订单组件 ${parentComponentNo}`
    : `所属当前明细组件 ${parentComponentNo}`;
}

function orderLineStructureLabel(line: CreateOrderLinePayload) {
  if (line.lineType === 'COMPONENT') {
    return `组件 ${normalizeComponentNo(line.componentNo) || '未编号'}`;
  }
  const parentComponentNo = parentComponentNoForOrderLine(line);
  if (parentComponentNo && isMissingParentComponentLine(line)) {
    return `未匹配父级 ${parentComponentNo}`;
  }
  return parentComponentNo ? `子零件 -> ${parentComponentNo}` : '单独零件';
}

function orderLineStructureHint(line: CreateOrderLinePayload) {
  if (line.lineType === 'COMPONENT') {
    return '父级组件';
  }
  const parentComponentNo = parentComponentNoForOrderLine(line);
  return parentComponentNo ? parentComponentScopeText(line) : '不属于组件';
}

function orderLineStructureClass(line: CreateOrderLinePayload) {
  if (line.lineType === 'COMPONENT') {
    return 'is-structure-component';
  }
  if (isMissingParentComponentLine(line)) {
    return 'is-structure-orphan';
  }
  return parentComponentNoForOrderLine(line) ? 'is-structure-child' : 'is-structure-standalone';
}

function orderLineStructureTagType(line: CreateOrderLinePayload): OrderLineStructureTagType {
  if (line.lineType === 'COMPONENT') {
    return 'success';
  }
  if (isMissingParentComponentLine(line)) {
    return 'danger';
  }
  return parentComponentNoForOrderLine(line) ? 'warning' : 'info';
}

function orderLineRequiresThickness(line: Pick<CreateOrderLinePayload, 'lineType'>) {
  return line.lineType !== 'COMPONENT';
}

function isBlankOrderLineForFixedText(line: CreateOrderLinePayload) {
  // 固定格式清单只展示操作员已录入的有效行；默认数量、单位和厚度不应让备用空行进入清单。
  return (
    !line.partCode?.trim() &&
    !line.partName?.trim() &&
    !line.componentNo?.trim() &&
    !line.parentComponentNo?.trim() &&
    !line.importSequence?.trim() &&
    !line.drawingNo?.trim() &&
    !line.drawingFileName?.trim() &&
    !line.drawingFileUrl?.trim() &&
    !line.partSpecification?.trim() &&
    (!line.processSteps || line.processSteps.length === 0) &&
    (!line.selectedStockSources || line.selectedStockSources.length === 0)
  );
}

function orderLineStatusText(line: CreateOrderLinePayload) {
  const fulfillmentText = fulfillmentModeText(line);
  const stockText = selectedStockSourceQuantity(line) > 0 ? `已选库存 ${formatQuantity(selectedStockSourceQuantity(line), line.unit || '件')}` : '未选库存';
  const reviewText = stockSourceReviewRequired(line) ? (isStockSourceReviewed(line) ? '已核对来源' : '未核对来源') : '无需来源核对';
  return `${fulfillmentText} | ${stockText} | ${reviewText}`;
}

function formatOrderLineFixedTextLine(line: CreateOrderLinePayload, prefix: string) {
  const orderQuantity = formatQuantity(line.quantity ?? 0, line.unit || '件');
  const planQuantity = formatQuantity(line.productionPlanQuantity ?? suggestedProductionPlanQuantity(line), line.unit || '件');
  const drawingText = [line.drawingNo, line.drawingVersion, line.drawingDate, line.drawingStatus].filter(Boolean).join(' / ') || '-';
  const thicknessText = orderLineRequiresThickness(line) ? (line.partThickness ? `${line.partThickness}mm` : '厚度需核对') : '厚度不适用（父级组件由子零件维护）';
  const specificationText = [thicknessText, line.partSpecification || ''].filter(Boolean).join(' / ') || '-';
  return `${prefix} | 结构 ${orderLineStructureLabel(line)} | 父级 ${parentComponentScopeText(line)} | ${line.partCode || '-'} | ${line.partName || '-'} | ${line.partCategory || '-'} | 订单 ${orderQuantity} | 计划 ${planQuantity} | 单位 ${line.unit || '-'} | 交期 ${line.deliveryDate || defaultDeliveryDate.value || '-'} | 图纸 ${drawingText} | 规格 ${specificationText} | ${orderLineStatusText(line)}`;
}

function buildOrderLineFixedText() {
  if (!orderLineFixedTextLines.value.length) {
    return '';
  }
  const linesForText = ['订单零件固定格式清单'];
  buildOrderLineDragGroups(orderLineFixedTextLines.value).forEach((group, groupIndex) => {
    const prefix = group.line.lineType === 'COMPONENT'
      ? `${groupIndex + 1}. 组件 ${componentNoForOrderLine(group.line) || '未编号'}`
      : isMissingParentComponentLine(group.line)
        ? `${groupIndex + 1}. 未匹配父级 ${parentComponentNoForOrderLine(group.line)}`
        : parentComponentNoForOrderLine(group.line) && hasSourceComponentNo(parentComponentNoForOrderLine(group.line)) && !hasLocalComponentNo(parentComponentNoForOrderLine(group.line))
          ? `${groupIndex + 1}. 子零件 -> ${parentComponentNoForOrderLine(group.line)}（已有订单组件）`
        : parentComponentNoForOrderLine(group.line)
        ? `${groupIndex + 1}. 子零件 -> ${parentComponentNoForOrderLine(group.line)}`
        : `${groupIndex + 1}. 单独零件`;
    linesForText.push(formatOrderLineFixedTextLine(group.line, prefix));
    group.children.forEach((child, childIndex) => {
      linesForText.push(formatOrderLineFixedTextLine(child, `  ${groupIndex + 1}.${childIndex + 1} 子零件`));
    });
  });
  return linesForText.join('\n');
}

function openOrderLineFixedTextDialog() {
  if (!orderLineFixedText.value.trim()) {
    ElMessage.warning('暂无可查看的订单零件清单');
    return;
  }
  orderLineFixedTextDialogVisible.value = true;
}

async function copyOrderLineFixedText() {
  const text = orderLineFixedText.value.trim();
  if (!text) {
    ElMessage.warning('暂无可复制的订单零件清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('订单零件固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

function hasLocalComponentNo(componentNo: string) {
  return props.lines.some((line) => componentNoForOrderLine(line) === componentNo);
}

function isAttachedLocalChildLine(line?: CreateOrderLinePayload | null) {
  const parentComponentNo = parentComponentNoForOrderLine(line);
  return Boolean(parentComponentNo && hasLocalComponentNo(parentComponentNo));
}

function buildOrderLineDragGroups(linesToGroup = props.lines): OrderLineDragGroup[] {
  const firstComponentByNo = new Map<string, CreateOrderLinePayload>();
  for (const line of linesToGroup) {
    const componentNo = componentNoForOrderLine(line);
    if (componentNo && !firstComponentByNo.has(componentNo)) {
      firstComponentByNo.set(componentNo, line);
    }
  }

  const childrenByParent = new Map<string, CreateOrderLinePayload[]>();
  const attachedChildren = new Set<CreateOrderLinePayload>();
  for (const line of linesToGroup) {
    const parentComponentNo = parentComponentNoForOrderLine(line);
    if (!parentComponentNo || !firstComponentByNo.has(parentComponentNo)) {
      continue;
    }
    const children = childrenByParent.get(parentComponentNo) || [];
    children.push(line);
    childrenByParent.set(parentComponentNo, children);
    attachedChildren.add(line);
  }

  return linesToGroup
    .filter((line) => !attachedChildren.has(line))
    .map((line) => {
      const componentNo = componentNoForOrderLine(line);
      const children =
        componentNo && firstComponentByNo.get(componentNo) === line ? childrenByParent.get(componentNo) || [] : [];
      return { line, children };
    });
}

function flattenOrderLineDragGroups(groups: OrderLineDragGroup[]) {
  return groups.flatMap((group) => [group.line, ...group.children]);
}

function buildChildDraggedLineOrder(dragged: CreateOrderLinePayload, targetIndex: number, insertAfter: boolean) {
  const parentComponentNo = parentComponentNoForOrderLine(dragged);
  const target = props.lines[targetIndex];
  const targetParentComponentNo = parentComponentNoForOrderLine(target);
  const targetComponentNo = componentNoForOrderLine(target);
  if (targetComponentNo === parentComponentNo && !insertAfter) {
    ElMessage.warning('子零件不能拖到父组件前面；请拖到父组件下方子零件区域');
    return null;
  }
  if (targetComponentNo !== parentComponentNo && targetParentComponentNo !== parentComponentNo) {
    ElMessage.warning('子零件只能在同一父组件内拖拽排序；如需换父级，请编辑所属组件');
    return null;
  }

  const groups = buildOrderLineDragGroups();
  const parentGroup = groups.find(
    (group) => componentNoForOrderLine(group.line) === parentComponentNo && group.children.includes(dragged)
  );
  if (!parentGroup) {
    return props.lines;
  }

  const children = [...parentGroup.children];
  const sourceIndex = children.indexOf(dragged);
  if (sourceIndex < 0) {
    return props.lines;
  }
  children.splice(sourceIndex, 1);

  let insertionIndex = 0;
  if (target !== parentGroup.line) {
    insertionIndex = parentGroup.children.indexOf(target) + (insertAfter ? 1 : 0);
    if (sourceIndex < insertionIndex) {
      insertionIndex -= 1;
    }
  }
  children.splice(Math.max(0, Math.min(insertionIndex, children.length)), 0, dragged);
  parentGroup.children = children;
  return flattenOrderLineDragGroups(groups);
}

function buildRootDraggedLineOrder(dragged: CreateOrderLinePayload, targetIndex: number, insertAfter: boolean) {
  const target = props.lines[targetIndex];
  if (isAttachedLocalChildLine(target)) {
    ElMessage.warning('组件和单独零件请拖到顶层行之间排序，不要拖入子零件区域');
    return null;
  }

  const groups = buildOrderLineDragGroups();
  const sourceGroupIndex = groups.findIndex((group) => group.line === dragged);
  const targetGroupIndex = groups.findIndex((group) => group.line === target);
  if (sourceGroupIndex < 0 || targetGroupIndex < 0) {
    return props.lines;
  }

  const [movedGroup] = groups.splice(sourceGroupIndex, 1);
  if (!movedGroup) {
    return props.lines;
  }
  let insertionIndex = targetGroupIndex + (insertAfter ? 1 : 0);
  if (sourceGroupIndex < insertionIndex) {
    insertionIndex -= 1;
  }
  groups.splice(Math.max(0, Math.min(insertionIndex, groups.length)), 0, movedGroup);
  return flattenOrderLineDragGroups(groups);
}

function buildDraggedLineOrder(targetIndex: number, insertAfter: boolean): CreateOrderLinePayload[] | null {
  const sourceIndex = draggedLineIndex.value;
  if (sourceIndex === null) {
    return props.lines;
  }
  const dragged = props.lines[sourceIndex];
  if (!dragged) {
    return props.lines;
  }
  if (isAttachedLocalChildLine(dragged)) {
    return buildChildDraggedLineOrder(dragged, targetIndex, insertAfter);
  }
  return buildRootDraggedLineOrder(dragged, targetIndex, insertAfter);
}

function dropLineDrag(index: number) {
  if (props.readOnly || draggedLineIndex.value === null) {
    endLineDrag();
    return;
  }
  const ordered = buildDraggedLineOrder(index, dragOverLineInsertAfter.value);
  if (!ordered) {
    endLineDrag();
    return;
  }
  props.lines.splice(0, props.lines.length, ...ordered);
  endLineDrag();
}

function endLineDrag() {
  draggedLineIndex.value = null;
  dragOverLineIndex.value = null;
  dragOverLineInsertAfter.value = false;
}

function orderLineRowClassName({ row, rowIndex }: { row: CreateOrderLinePayload; rowIndex: number }) {
  const classes: string[] = [];
  if (row.lineType === 'COMPONENT') {
    classes.push('is-order-line-component');
  } else if (parentComponentNoForOrderLine(row)) {
    classes.push('is-order-line-child');
  } else {
    classes.push('is-order-line-standalone');
  }
  if (draggedLineIndex.value === rowIndex) {
    classes.push('is-order-line-dragging');
  }
  if (dragOverLineIndex.value === rowIndex) {
    classes.push(dragOverLineInsertAfter.value ? 'is-order-line-drop-after' : 'is-order-line-drop-before');
  }
  return classes.join(' ');
}

function materialIdentityWarningText(line: CreateOrderLinePayload) {
  materialIdentityWarningVersion.value;
  return materialIdentityWarnings.get(line)?.text || '';
}

function materialIdentityConflictFieldsText(item: InventoryMaterialSuggestion, separator = '、') {
  return item.identityConflictFields?.length ? item.identityConflictFields.join(separator) : `图号${separator}规格${separator}厚度${separator}项目型号`;
}

function setMaterialIdentityWarning(line: CreateOrderLinePayload, item: InventoryMaterialSuggestion) {
  if (item.hasIdentityConflict) {
    materialIdentityWarnings.set(line, {
      partCode: item.partCode,
      partName: item.partName,
      text: `同编码 ${item.identityVariantCount || '多'} 套历史资料，核对${materialIdentityConflictFieldsText(item, '/')}`
    });
  } else {
    materialIdentityWarnings.delete(line);
  }
  materialIdentityWarningVersion.value += 1;
}

function clearMaterialIdentityWarning(line: CreateOrderLinePayload) {
  if (!materialIdentityWarnings.has(line)) {
    return;
  }
  materialIdentityWarnings.delete(line);
  materialIdentityWarningVersion.value += 1;
}

function clearMaterialIdentityWarningWhenMaterialIdentityChanges(line: CreateOrderLinePayload) {
  const warning = materialIdentityWarnings.get(line);
  if (!warning) {
    return;
  }
  const partCodeMatches = normalizeMaterialSuggestionValue(line.partCode) === normalizeMaterialSuggestionValue(warning.partCode);
  const partNameMatches = normalizeMaterialSuggestionValue(line.partName) === normalizeMaterialSuggestionValue(warning.partName);
  if (partCodeMatches && partNameMatches) {
    return;
  }
  clearMaterialIdentityWarning(line);
}

function normalizeComponentNo(value?: string) {
  return value?.trim().toUpperCase() || '';
}

function isComponentNoOutOfRange(value?: string) {
  const matched = /^C(\d+)$/.exec(normalizeComponentNo(value));
  return !!matched && (Number(matched[1]) < 1 || Number(matched[1]) > 9999);
}

function captureComponentNoBeforeEdit(line: CreateOrderLinePayload) {
  componentNoEditSnapshots.set(line, normalizeComponentNo(line.componentNo));
}

function normalizeComponentFields(line: CreateOrderLinePayload) {
  const previousComponentNo = componentNoEditSnapshots.get(line) || normalizeComponentNo(line.componentNo);
  line.componentNo = normalizeComponentNo(line.componentNo);
  line.parentComponentNo = normalizeComponentNo(line.parentComponentNo);
  if (line.lineType === 'COMPONENT' && isComponentNoOutOfRange(line.componentNo)) {
    ElMessage.warning('组件编号只支持 C001-C9999；自定义编号请不要使用 C 开头的非 C001-C9999 数字格式');
  }
  syncChildParentComponentNo(line, previousComponentNo);
  componentNoEditSnapshots.delete(line);
}

function syncChildParentComponentNo(componentLine: CreateOrderLinePayload, previousComponentNo: string) {
  const nextComponentNoValue = normalizeComponentNo(componentLine.componentNo);
  if (
    componentLine.lineType !== 'COMPONENT' ||
    !previousComponentNo ||
    !nextComponentNoValue ||
    previousComponentNo === nextComponentNoValue
  ) {
    return;
  }
  for (const line of props.lines) {
    if (line === componentLine || line.lineType === 'COMPONENT') {
      continue;
    }
    if (normalizeComponentNo(line.parentComponentNo) === previousComponentNo) {
      line.parentComponentNo = nextComponentNoValue;
    }
  }
}

function clearChildParentComponentNo(componentNo: string) {
  if (!componentNo) {
    return;
  }
  const stillHasComponent = props.lines.some(
    (line) => line.lineType === 'COMPONENT' && normalizeComponentNo(line.componentNo) === componentNo
  );
  if (stillHasComponent) {
    return;
  }
  for (const line of props.lines) {
    if (line.lineType !== 'COMPONENT' && normalizeComponentNo(line.parentComponentNo) === componentNo) {
      line.parentComponentNo = '';
    }
  }
}

function handleLineTypeChange(line: CreateOrderLinePayload) {
  if (guardReadOnlyOrderLineMutation('切换行类型')) {
    return;
  }
  const previousComponentNo = normalizeComponentNo(line.componentNo);
  normalizeComponentFields(line);
  if (line.lineType === 'COMPONENT') {
    line.parentComponentNo = '';
    line.partThickness = 0;
    if (!line.componentNo) {
      const componentNo = nextComponentNo();
      if (!componentNo) {
        ElMessage.warning('当前订单 C001-C9999 自动组件编号已用完，请手工填写当前订单内唯一组件编号');
        return;
      }
      line.componentNo = componentNo;
    }
    return;
  }
  clearChildParentComponentNo(previousComponentNo);
  line.componentNo = '';
  applyDefaultParentComponent(line);
}

function applyDefaultParentComponent(line: CreateOrderLinePayload) {
  if (line.lineType === 'COMPONENT' || normalizeComponentNo(line.parentComponentNo)) {
    return;
  }
  line.parentComponentNo = inheritedParentComponentNoForLine(line);
}

function inheritedParentComponentNoForLine(line: CreateOrderLinePayload) {
  const lineIndex = props.lines.indexOf(line);
  if (lineIndex <= 0) {
    return '';
  }
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const previousLine = props.lines[index];
    if (previousLine.lineType === 'COMPONENT') {
      return normalizeComponentNo(previousLine.componentNo);
    }
    const inheritedParentNo = normalizeComponentNo(previousLine.parentComponentNo);
    if (inheritedParentNo) {
      return inheritedParentNo;
    }
  }
  return '';
}

function nextComponentNo() {
  const usedNos = new Set(
    [...props.componentSourceLines, ...props.lines].map((line) => normalizeComponentNo(line.componentNo)).filter(Boolean)
  );
  for (let index = 1; index <= 9999; index += 1) {
    const candidate = `C${String(index).padStart(3, '0')}`;
    if (!usedNos.has(candidate)) {
      return candidate;
    }
  }
  return '';
}

function fulfillmentModeText(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    return '使用库存';
  }
  if (line.fulfillmentMode === 'REWORK') {
    return '库存再加工';
  }
  return '重新生产';
}

function emitRemove(index: number) {
  if (guardReadOnlyOrderLineMutation('删除订单零件')) {
    return;
  }
  emit('remove', index);
}

function emitQuantityChange(line: CreateOrderLinePayload) {
  if (guardReadOnlyOrderLineMutation('修改订单数量')) {
    return;
  }
  invalidateStockSourceReview(line);
  // 客户订单数量变化时由父页面统一同步生产计划数量，避免创建和编辑逻辑分叉。
  emit('quantityChange', line);
}

function productionPlanMin(line: CreateOrderLinePayload) {
  return 0;
}

function handleFulfillmentModeChange(line: CreateOrderLinePayload) {
  if (guardReadOnlyOrderLineMutation('修改库存/生产方式')) {
    return;
  }
  if (line.fulfillmentMode === 'STOCK') {
    syncStockProductionPlanQuantity(line);
    invalidateStockSourceReview(line);
    void openStockDetails(line);
    return;
  }
  if (line.fulfillmentMode === 'REWORK') {
    ensureProductionPlanQuantity(line);
    invalidateStockSourceReview(line);
    void openStockDetails(line);
    return;
  }
  ensureProductionPlanQuantity(line);
  invalidateStockSourceReview(line, true);
  emitQuantityChange(line);
}

function ensureProductionPlanQuantity(line: CreateOrderLinePayload) {
  // 切换生产方式时只补默认值；少做或多做由“计划偏差说明”记录操作人员和原因。
  if (line.productionPlanQuantity === undefined || line.productionPlanQuantity === null) {
    line.productionPlanQuantity = line.quantity ?? 1;
  }
}

function stockShortageProductionQuantity(line: CreateOrderLinePayload) {
  const customerQuantity = Number(line.quantity ?? 0);
  const selectedQuantity = selectedStockSourceQuantity(line);
  return Math.max(Math.round((customerQuantity - selectedQuantity + Number.EPSILON) * 1000) / 1000, 0);
}

function syncStockProductionPlanQuantity(
  line: CreateOrderLinePayload,
  previousSuggestedQuantity = suggestedProductionPlanQuantity(line),
  options: { forceWhenStockCovers?: boolean } = {}
) {
  if (line.fulfillmentMode === 'STOCK') {
    const currentPlanQuantity = Number(line.productionPlanQuantity ?? previousSuggestedQuantity);
    const nextSuggestedQuantity = stockShortageProductionQuantity(line);
    line.productionPlanSuggestedQuantity = nextSuggestedQuantity;
    const planWasFollowingSuggestion = Math.abs(currentPlanQuantity - previousSuggestedQuantity) <= 0.0001;
    const stockCoversCustomerQuantity =
      nextSuggestedQuantity <= 0 && selectedStockSourceQuantity(line) + 0.0001 >= Number(line.quantity ?? 0);
    const hasExplicitProductionPlanOverride = hasProductionPlanOverride(line);
    // 库存完全覆盖时默认不生产；如果操作人员已填写多做/少做说明，不覆盖人工计划。
    if (options.forceWhenStockCovers && stockCoversCustomerQuantity && !hasExplicitProductionPlanOverride) {
      line.productionPlanQuantity = nextSuggestedQuantity;
      clearProductionPlanOverride(line);
      return;
    }
    // 库存来源变化时只同步“仍跟随建议值”的生产计划；操作人员手动多做/少做后必须保留其计划和说明。
    if (planWasFollowingSuggestion) {
      line.productionPlanQuantity = nextSuggestedQuantity;
      clearProductionPlanOverride(line);
      return;
    }
    if (!stockProductionPlanDiffers(line)) {
      clearProductionPlanOverride(line);
    }
  }
}

function syncInitialStockCoveredPlanQuantity(line: CreateOrderLinePayload) {
  if (stockCoverAutoSyncedLines.has(line)) {
    return;
  }
  stockCoverAutoSyncedLines.add(line);
  if (
    line.fulfillmentMode === 'STOCK' &&
    selectedStockSourceQuantity(line) + 0.0001 >= Number(line.quantity ?? 0) &&
    Number(line.productionPlanQuantity ?? 0) > 0
  ) {
    syncStockProductionPlanQuantity(line, suggestedProductionPlanQuantity(line), { forceWhenStockCovers: true });
  }
}

watch(
  () => props.lines,
  (rows) => {
    rows.forEach(syncInitialStockCoveredPlanQuantity);
  },
  { immediate: true }
);

function clearProductionPlanOverride(line: CreateOrderLinePayload) {
  line.productionPlanOverrideByCode = '';
  line.productionPlanOverrideByName = '';
  line.productionPlanOverrideByRole = '';
  line.productionPlanOverrideAt = '';
  line.productionPlanOverrideReason = '';
}

function hasProductionPlanOverride(line: CreateOrderLinePayload) {
  return Boolean(line.productionPlanOverrideByCode?.trim() || line.productionPlanOverrideReason?.trim());
}

function stockProductionPlanDiffers(line: CreateOrderLinePayload) {
  const suggestedQuantity = suggestedProductionPlanQuantity(line);
  const plannedQuantity = Number(line.productionPlanQuantity ?? suggestedQuantity);
  return Math.abs(plannedQuantity - suggestedQuantity) > 0.0001;
}

function invalidateStockSourceReview(line: CreateOrderLinePayload, clearSources = false, markSourcesForRecheck = false) {
  // 零件、数量或使用方式变化后必须重新核对库存来源，防止沿用旧批次记录。
  line.stockSourceReviewed = false;
  line.stockSourceReviewSignature = '';
  line.stockSourceAvailableQuantity = 0;
  line.stockSourceMatchedQuantity = 0;
  if (clearSources) {
    line.selectedStockSources = [];
    return;
  }
  if (markSourcesForRecheck && line.selectedStockSources?.length) {
    line.selectedStockSources = line.selectedStockSources.map((source) => ({
      ...source,
      compatibilityStatus: 'UNKNOWN',
      compatibilityReason: '订单图纸或规格资料已变更，需要重新核对库存来源',
      manualConfirmedBy: undefined,
      manualConfirmedAt: undefined,
      manualConfirmRemark: undefined
    }));
  }
}

function availableStockQuantity(line: CreateOrderLinePayload) {
  return getAvailableStockQuantity(line, props.inventorySummary);
}

function stockRequiredQuantity(line: CreateOrderLinePayload) {
  // STOCK 按客户订单数量占用库存；REWORK 按生产计划数量领料。
  return stockSourceRequiredQuantity(line);
}

function stockDemandKey(line: CreateOrderLinePayload) {
  const summary = matchedStockSummary(line, props.inventorySummary);
  if (summary) {
    return `${summary.partCode.trim().toLocaleLowerCase()}__${summary.unit.trim().toLocaleLowerCase()}`;
  }
  return `${(line.partCode || line.partName || '').trim().toLocaleLowerCase()}__${(line.unit || '件').trim().toLocaleLowerCase()}`;
}

function stockAggregateRequiredQuantity(line: CreateOrderLinePayload) {
  // 同一个订单内相同零件、相同单位的 STOCK / REWORK 需求必须合计校验，避免每行单独看库存时误判够用。
  return stockDemandLines(line).reduce((sum, item) => sum + stockRequiredQuantity(item), 0);
}

function stockAggregateSelectedQuantity(line: CreateOrderLinePayload) {
  return stockDemandLines(line).reduce((sum, item) => sum + selectedStockSourceQuantity(item), 0);
}

function stockDemandLines(line: CreateOrderLinePayload) {
  const key = stockDemandKey(line);
  if (!key.trim()) {
    return [line];
  }
  return props.lines
    .filter((item) => item.fulfillmentMode === 'STOCK' || item.fulfillmentMode === 'REWORK')
    .filter((item) => stockDemandKey(item) === key);
}

function stockGapQuantity(line: CreateOrderLinePayload) {
  if ((line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK') && isStockSourceReviewed(line)) {
    return Math.max(stockAggregateRequiredQuantity(line) - stockAggregateSelectedQuantity(line), 0);
  }
  return Math.max(stockAggregateRequiredQuantity(line) - availableStockQuantity(line), 0);
}

function stockTagType(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    const selectedQuantity = selectedStockSourceQuantity(line);
    if (selectedQuantity > 0) {
      return stockShortageProductionQuantity(line) > 0 ? 'warning' : 'success';
    }
    return availableStockQuantity(line) > 0 ? 'warning' : 'danger';
  }
  if (line.fulfillmentMode === 'REWORK') {
    return stockGapQuantity(line) > 0 ? 'danger' : 'success';
  }
  return availableStockQuantity(line) > 0 ? 'info' : 'warning';
}

function stockStatusHint(line: CreateOrderLinePayload) {
  // 下单时先把备货库存是否足够说清楚，避免保存或提交订单时才发现库存不足。
  const gap = stockGapQuantity(line);
  const requiredQuantity = stockAggregateRequiredQuantity(line);
  if (line.fulfillmentMode === 'STOCK') {
    const selectedQuantity = selectedStockSourceQuantity(line);
    if (selectedQuantity > 0) {
      const shortageQuantity = stockShortageProductionQuantity(line);
      return shortageQuantity > 0
        ? `此零件，客户要求 ${formatQuantity(line.quantity ?? 0, line.unit || '件')}，库存已有 ${formatQuantity(selectedQuantity, line.unit || '件')}，按需生产 ${formatQuantity(shortageQuantity, line.unit || '件')}`
        : `此零件库存已覆盖客户数量，确认生产后进入待发货`;
    }
    if (isStockSourceReviewed(line)) {
      const matchedQuantity = stockAggregateSelectedQuantity(line);
      return matchedQuantity + 0.0001 >= requiredQuantity
        ? `已选库存 ${formatQuantity(matchedQuantity, line.unit || '件')}，需 ${formatQuantity(requiredQuantity, line.unit || '件')}`
        : `已选库存不足，已选 ${formatQuantity(matchedQuantity, line.unit || '件')}，需 ${formatQuantity(requiredQuantity, line.unit || '件')}`;
    }
    return gap > 0
      ? `当前库存可先使用，缺 ${formatQuantity(gap, line.unit || '件')} 会自动转生产计划`
      : `库存可覆盖客户数量，必须选择库存批次并核对来源`;
  }
  if (line.fulfillmentMode === 'REWORK') {
    if (isStockSourceReviewed(line)) {
      return `已选库存 ${formatQuantity(stockAggregateSelectedQuantity(line), line.unit || '件')}`;
    }
    return gap > 0
      ? `合计领料 ${formatQuantity(requiredQuantity, line.unit || '件')}，缺 ${formatQuantity(gap, line.unit || '件')}`
      : `可领库存再加工，必须选择库存批次并核对来源`;
  }
  return availableStockQuantity(line) > 0 ? '有备货库存' : '无备货库存';
}

function stockProductionPlanHint(line: CreateOrderLinePayload) {
  const suggestedQuantity = suggestedProductionPlanQuantity(line);
  const plannedQuantity = Number(line.productionPlanQuantity ?? suggestedQuantity);
  if (Math.abs(plannedQuantity - suggestedQuantity) > 0.0001) {
    return `建议生产 ${formatQuantity(suggestedQuantity, line.unit || '件')}，当前计划 ${formatQuantity(plannedQuantity, line.unit || '件')}，需填写操作人员和说明`;
  }
  if (line.fulfillmentMode !== 'STOCK') {
    return '';
  }
  const selectedQuantity = selectedStockSourceQuantity(line);
  if (selectedQuantity <= 0) {
    return '选择库存来源后自动计算';
  }
  if (suggestedQuantity <= 0) {
    return `客户要求 ${formatQuantity(line.quantity ?? 0, line.unit || '件')}，库存已覆盖，不生成生产任务`;
  }
  return `客户要求 ${formatQuantity(line.quantity ?? 0, line.unit || '件')}，库存已有 ${formatQuantity(selectedQuantity, line.unit || '件')}，按需生产 ${formatQuantity(suggestedQuantity, line.unit || '件')}`;
}

function stockSourceReviewHint(line: CreateOrderLinePayload) {
  if (line.fulfillmentMode === 'STOCK') {
    return '使用库存提交生产前必须选择具体库存批次，并核对来源订单、任务号、图号、版本、规格、厚度和图纸文件。';
  }
  if (line.fulfillmentMode === 'REWORK') {
    return '库存再加工提交生产前必须选择具体库存批次，核对库存来源并保留记录。';
  }
  return '';
}

function stockSourceActionText(line: CreateOrderLinePayload) {
  if (!stockSourceReviewRequired(line)) {
    return '查看库存来源';
  }
  return isStockSourceReviewed(line) ? '调整库存来源' : '选择库存来源';
}

function formatStockQuantity(line: CreateOrderLinePayload) {
  if ((line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK') && selectedStockSourceQuantity(line) > 0) {
    return `已选 ${formatQuantity(selectedStockSourceQuantity(line), line.unit || '件')}`;
  }
  return formatQuantity(availableStockQuantity(line), line.unit || '件');
}

function selectedSourceSummary(line: CreateOrderLinePayload) {
  const sources = normalizeSelectedStockSources(line);
  if (!sources.length) {
    return '';
  }
  return sources
    .map((source) => {
      const label = source.batchNo || source.partCode || source.batchId;
      const replenishmentMark = selectedSourceReplenishmentText(source);
      const manualMark = source.compatibilityStatus && source.compatibilityStatus !== 'MATCHED' ? ' / 人工确认' : '';
      const sourceMark = replenishmentMark ? ` / ${replenishmentMark}` : '';
      return `${label} ${formatQuantity(source.quantity, source.unit || line.unit || '件')}${sourceMark}${manualMark}`;
    })
    .join('；');
}

function selectedSourceReplenishmentText(source: ReturnType<typeof normalizeSelectedStockSources>[number]) {
  if (source.replenishmentSourceLabel) {
    return source.replenishmentSourceLabel;
  }
  if (!source.replenishmentSourceType) {
    return '';
  }
  const sourceTypeText =
    source.replenishmentSourceType === 'PRODUCTION_SCRAP'
      ? '生产报废补单'
      : source.replenishmentSourceType === 'ORDER_CHANGE'
        ? '订单数量补单'
        : source.replenishmentSourceType;
  return source.replenishmentSourceRequestNo ? `${sourceTypeText}：${source.replenishmentSourceRequestNo}` : sourceTypeText;
}

async function openStockDetails(line: CreateOrderLinePayload) {
  if (!line.partCode?.trim()) {
    ElMessage.warning('请先选择零件编码');
    return;
  }
  currentSourceLine.value = line;
  sourceDetailsVisible.value = true;
  sourceDetailsLoading.value = true;
  sourceDetails.value = null;
  sourceExpected.value = {
    lineType: line.lineType,
    partCategory: line.partCategory,
    componentNo: line.componentNo,
    parentComponentNo: line.parentComponentNo,
    partCode: line.partCode,
    partName: line.partName,
    drawingNo: line.drawingNo,
    drawingVersion: line.drawingVersion,
    drawingDate: line.drawingDate,
    drawingStatus: line.drawingStatus,
    drawingFileName: line.drawingFileName,
    drawingFileUrl: line.drawingFileUrl,
    partThickness: line.partThickness,
    partSpecification: line.partSpecification,
    projectModel: line.projectModel,
    requiredQuantity: stockRequiredQuantity(line),
    unit: line.unit,
    fulfillmentMode: line.fulfillmentMode
  };
  await loadStockDetailsForPart(line.partCode.trim());
}

async function loadStockDetailsForPart(partCode: string) {
  const normalizedPartCode = partCode.trim();
  const sourceLine = currentSourceLine.value;
  if (!sourceLine || !normalizedPartCode) {
    return;
  }
  const requestId = ++sourceDetailsRequestSeq.value;
  sourceDetailsLoading.value = true;
  sourceDetails.value = null;
  try {
    const detail = await erpApi.inventoryMaterialSourceDetails(normalizedPartCode, {
      unit: sourceLine.unit,
      sourceType: 'STOCK',
      customerId: props.customerId,
      excludeOrderNo: props.excludeOrderNo,
      excludeOrderId: props.excludeOrderId
    });
    if (requestId === sourceDetailsRequestSeq.value && currentSourceLine.value === sourceLine) {
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

function handleStockSourceSelectionChange(sources: StockSourceSelectionPayload[]) {
  if (guardReadOnlyOrderLineMutation('调整库存来源')) {
    return;
  }
  if (!currentSourceLine.value) {
    return;
  }
  const previousSuggestedQuantity = suggestedProductionPlanQuantity(currentSourceLine.value);
  currentSourceLine.value.selectedStockSources = sources;
  currentSourceLine.value.stockSourceReviewed = false;
  currentSourceLine.value.stockSourceReviewSignature = '';
  currentSourceLine.value.stockSourceAvailableQuantity = sources.reduce((sum, source) => sum + Number(source.quantity ?? 0), 0);
  currentSourceLine.value.stockSourceMatchedQuantity = currentSourceLine.value.stockSourceAvailableQuantity;
  syncStockProductionPlanQuantity(currentSourceLine.value, previousSuggestedQuantity, { forceWhenStockCovers: true });
}

function handleStockSourceReviewed() {
  if (guardReadOnlyOrderLineMutation('确认库存来源')) {
    return;
  }
  if (!currentSourceLine.value) {
    return;
  }
  const selectedQuantity = selectedStockSourceQuantity(currentSourceLine.value);
  if (selectedQuantity <= 0) {
    ElMessage.warning('当前没有可用库存来源，不能确认');
    return;
  }
  syncStockProductionPlanQuantity(currentSourceLine.value, undefined, { forceWhenStockCovers: true });
  currentSourceLine.value.stockSourceAvailableQuantity = selectedQuantity;
  currentSourceLine.value.stockSourceMatchedQuantity = selectedQuantity;
  markStockSourceReviewed(currentSourceLine.value);
  sourceDetailsVisible.value = false;
  ElMessage.success('库存来源已核对');
}

async function queryMaterialSuggestions(keyword: string, callback: (items: InventoryMaterialSuggestion[]) => void) {
  const normalizedKeyword = keyword.trim();
  const requestId = ++materialSuggestionRequestSeq.value;
  callback([]);
  if (props.readOnly) {
    return;
  }
  if (!normalizedKeyword && !props.customerId?.trim()) {
    return;
  }
  try {
    const result = await loadMaterialSuggestions(normalizedKeyword);
    if (requestId === materialSuggestionRequestSeq.value) {
      callback(result);
    }
  } catch {
    if (requestId === materialSuggestionRequestSeq.value) {
      callback([]);
    }
  }
}

function normalizeMaterialSuggestionValue(value?: string | null) {
  return String(value || '').trim().toLocaleLowerCase();
}

function materialSuggestionExactMatches(item: InventoryMaterialSuggestion, keyword: string) {
  const normalizedKeyword = normalizeMaterialSuggestionValue(keyword);
  return (
    normalizeMaterialSuggestionValue(item.partCode) === normalizedKeyword ||
    normalizeMaterialSuggestionValue(item.partName) === normalizedKeyword
  );
}

function canAutoFillMaterialSuggestion(item: InventoryMaterialSuggestion) {
  return !item.hasIdentityConflict;
}

function warnMaterialSuggestionNeedsManualPick(item: InventoryMaterialSuggestion) {
  if (item.hasIdentityConflict) {
    ElMessage.warning(`零件编码 ${item.partCode} 存在多套历史资料，请核对${materialIdentityConflictFieldsText(item)}，并从下拉候选中人工确认后再套用`);
  }
}

function loadMaterialSuggestions(keyword: string) {
  return erpApi.inventoryMaterialSuggestions(
    keyword.trim(),
    undefined,
    undefined,
    props.excludeOrderNo,
    props.excludeOrderId,
    props.customerId
  );
}

async function fillExactMaterialFromInput(line: CreateOrderLinePayload, field: MaterialSuggestionInputField) {
  if (props.readOnly) {
    return;
  }
  const keyword = String(line[field] || '').trim();
  if (!keyword) {
    return;
  }
  try {
    const suggestions = await loadMaterialSuggestions(keyword);
    if (normalizeMaterialSuggestionValue(line[field]) !== normalizeMaterialSuggestionValue(keyword)) {
      return;
    }
    const exactMatches = suggestions.filter((item) => materialSuggestionExactMatches(item, keyword));
    if (exactMatches.length === 1) {
      if (!canAutoFillMaterialSuggestion(exactMatches[0])) {
        warnMaterialSuggestionNeedsManualPick(exactMatches[0]);
        return;
      }
      selectMaterialSuggestion(line, exactMatches[0]);
      return;
    }
    if (exactMatches.length > 1) {
      const normalizedKeyword = normalizeMaterialSuggestionValue(keyword);
      const exactFieldMatches = exactMatches.filter(
        (item) => normalizeMaterialSuggestionValue(item[field]) === normalizedKeyword
      );
      if (exactFieldMatches.length === 1) {
        if (!canAutoFillMaterialSuggestion(exactFieldMatches[0])) {
          warnMaterialSuggestionNeedsManualPick(exactFieldMatches[0]);
          return;
        }
        selectMaterialSuggestion(line, exactFieldMatches[0]);
        return;
      }
      const exactPartCodeMatches = exactMatches.filter(
        (item) => normalizeMaterialSuggestionValue(item.partCode) === normalizedKeyword
      );
      if (exactFieldMatches.length === 0 && exactPartCodeMatches.length === 1) {
        if (!canAutoFillMaterialSuggestion(exactPartCodeMatches[0])) {
          warnMaterialSuggestionNeedsManualPick(exactPartCodeMatches[0]);
          return;
        }
        selectMaterialSuggestion(line, exactPartCodeMatches[0]);
        return;
      }
      ElMessage.warning(`找到 ${exactMatches.length} 个精确匹配零件，请从下拉列表选择具体零件`);
    }
  } catch {
    // 查询失败时保留手工输入值，避免阻断新零件下单。
  }
}

function selectMaterialSuggestion(line: CreateOrderLinePayload, item: InventoryMaterialSuggestion) {
  if (guardReadOnlyOrderLineMutation('选择物料建议')) {
    return;
  }
  if (item.hasIdentityConflict) {
    ElMessage.warning(`零件编码 ${item.partCode} 存在多套历史资料，已按当前候选套用，请核对${materialIdentityConflictFieldsText(item)}`);
  }
  setMaterialIdentityWarning(line, item);
  const lineHadDrawingInfo = Boolean(
    line.drawingNo?.trim() ||
      line.drawingVersion?.trim() ||
      line.drawingDate ||
      line.drawingStatus?.trim() ||
      line.drawingFileName?.trim() ||
      line.drawingFileUrl?.trim() ||
      line.projectModel?.trim() ||
      line.partSpecification?.trim()
  );
  invalidateStockSourceReview(line, true);
  line.partCode = item.partCode;
  line.partName = item.partName;
  const autoFields: AutoMaterialSnapshot['autoFields'] = {
    partName: item.partName
  };
  line.unit = item.unit || line.unit || '件';
  if (item.unit) {
    autoFields.unit = item.unit;
  }
  if (!line.partSpecification && item.partSpecification) {
    line.partSpecification = item.partSpecification;
    autoFields.partSpecification = item.partSpecification;
  }
  if (!line.drawingNo && item.drawingNo) {
    line.drawingNo = item.drawingNo;
    autoFields.drawingNo = item.drawingNo;
  }
  if (!line.drawingVersion && item.drawingVersion) {
    line.drawingVersion = item.drawingVersion;
    autoFields.drawingVersion = item.drawingVersion;
  }
  if (!line.drawingDate && item.drawingDate) {
    line.drawingDate = item.drawingDate;
    autoFields.drawingDate = item.drawingDate;
  }
  if (!line.drawingStatus && item.drawingStatus) {
    line.drawingStatus = item.drawingStatus;
    autoFields.drawingStatus = item.drawingStatus;
  }
  if (!line.drawingFileName && item.drawingFileName) {
    line.drawingFileName = item.drawingFileName;
    autoFields.drawingFileName = item.drawingFileName;
  }
  if (!line.drawingFileUrl && item.drawingFileUrl) {
    line.drawingFileUrl = item.drawingFileUrl;
    autoFields.drawingFileUrl = item.drawingFileUrl;
  }
  if (!line.projectModel && item.projectModel) {
    line.projectModel = item.projectModel;
    autoFields.projectModel = item.projectModel;
  }
  if (!line.processRoute && item.defaultProcessRoute) {
    // 零件默认工艺只作为订单行流程初始建议，保存后仍形成当前订单行自己的流程快照。
    line.processRoute = item.defaultProcessRoute;
    autoFields.processRoute = item.defaultProcessRoute;
  }
  line.selectedMaterialId = item.materialId || '';
  line.selectedDrawingRevisionId = '';
  if (line.selectedMaterialId) {
    void loadDrawingRevisionsForLine(line, line.selectedMaterialId);
  } else {
    setDrawingRevisionOptions(line, []);
  }
  if (orderLineRequiresThickness(line) && !lineHadDrawingInfo && item.partThickness && Number(item.partThickness) > 0) {
    line.partThickness = item.partThickness;
    autoFields.partThickness = item.partThickness;
  }
  autoMaterialSnapshots.set(line, {
    partCode: item.partCode,
    partName: item.partName,
    autoFields
  });
}

function handlePartCodeInput(line: CreateOrderLinePayload) {
  if (guardReadOnlyOrderLineMutation('修改零件编码')) {
    return;
  }
  clearAutoMaterialFieldsWhenMaterialIdentityChanges(line);
  clearMaterialIdentityWarningWhenMaterialIdentityChanges(line);
  clearSelectedMaterialDrawingRevisions(line);
  if (line.selectedStockSources?.length || line.stockSourceReviewed) {
    invalidateStockSourceReview(line, true);
  }
}

function handlePartNameInput(line: CreateOrderLinePayload) {
  if (guardReadOnlyOrderLineMutation('修改零件名称')) {
    return;
  }
  clearAutoMaterialFieldsWhenMaterialIdentityChanges(line);
  clearMaterialIdentityWarningWhenMaterialIdentityChanges(line);
  clearSelectedMaterialDrawingRevisions(line);
  if (line.selectedStockSources?.length || line.stockSourceReviewed) {
    invalidateStockSourceReview(line, true);
  }
}

function handleStockComparableChange(line: CreateOrderLinePayload) {
  if (guardReadOnlyOrderLineMutation('修改图纸或规格资料')) {
    return;
  }
  if (line.fulfillmentMode === 'STOCK' || line.fulfillmentMode === 'REWORK' || line.selectedStockSources?.length) {
    invalidateStockSourceReview(line, false, true);
  }
}

function handlePlanQuantityChange(line: CreateOrderLinePayload) {
  if (guardReadOnlyOrderLineMutation('修改生产计划数量')) {
    return;
  }
  if (line.fulfillmentMode === 'STOCK') {
    if (!stockProductionPlanDiffers(line)) {
      clearProductionPlanOverride(line);
    }
    return;
  }
  if (line.fulfillmentMode === 'REWORK' || line.selectedStockSources?.length) {
    invalidateStockSourceReview(line);
  }
}

function handleUnitInput(line: CreateOrderLinePayload) {
  if (guardReadOnlyOrderLineMutation('修改单位')) {
    return;
  }
  if (line.selectedStockSources?.length || line.stockSourceReviewed) {
    invalidateStockSourceReview(line, true);
  }
}

function clearAutoMaterialFieldsWhenMaterialIdentityChanges(line: CreateOrderLinePayload) {
  const snapshot = autoMaterialSnapshots.get(line);
  if (!snapshot) {
    return;
  }
  const partCodeMatches = normalizeMaterialSuggestionValue(line.partCode) === normalizeMaterialSuggestionValue(snapshot.partCode);
  const partNameMatches = normalizeMaterialSuggestionValue(line.partName) === normalizeMaterialSuggestionValue(snapshot.partName);
  if (partCodeMatches && partNameMatches) {
    return;
  }
  const clearTextField = (
    field: Exclude<AutoMaterialField, 'unit' | 'partThickness'>,
    fallback: string | undefined = ''
  ) => {
    const snapshotValue = snapshot.autoFields[field];
    if (snapshotValue !== undefined && normalizeMaterialSuggestionValue(String(line[field] || '')) === normalizeMaterialSuggestionValue(String(snapshotValue || ''))) {
      line[field] = fallback as never;
    }
  };
  clearTextField('partName');
  clearTextField('partSpecification');
  clearTextField('drawingNo');
  clearTextField('drawingVersion');
  clearTextField('drawingDate', undefined);
  clearTextField('drawingStatus');
  clearTextField('drawingFileName');
  clearTextField('drawingFileUrl');
  clearTextField('projectModel');
  clearTextField('processRoute');
  if (
    snapshot.autoFields.unit !== undefined &&
    normalizeMaterialSuggestionValue(line.unit) === normalizeMaterialSuggestionValue(String(snapshot.autoFields.unit || ''))
  ) {
    line.unit = '件';
  }
  if (
    snapshot.autoFields.partThickness !== undefined &&
    Math.abs(Number(line.partThickness ?? 0) - Number(snapshot.autoFields.partThickness ?? 0)) <= 0.0001
  ) {
    line.partThickness = 0;
  }
  autoMaterialSnapshots.delete(line);
  clearMaterialIdentityWarning(line);
}

function createUploadRequest(line: CreateOrderLinePayload) {
  return (options: UploadRequestOptions) => uploadDrawing(options, line);
}

async function uploadDrawing(options: UploadRequestOptions, line: CreateOrderLinePayload) {
  if (guardReadOnlyOrderLineMutation('上传图纸')) {
    return;
  }
  try {
    const file = options.file as File;
    const canUpload = await confirmUploadDrawingFileName(file, props.lines, line, props.excludeOrderNo);
    if (!canUpload) {
      ElMessage.info('已取消图纸上传');
      return;
    }

    const result = await erpApi.uploadDrawing(file);
    // 图纸先上传到后端文件目录，订单保存时只保存文件名和访问地址。
    line.drawingFileName = result.fileName;
    line.drawingFileUrl = result.fileUrl;
    line.selectedDrawingRevisionId = '';
    invalidateStockSourceReview(line, false, true);
    options.onSuccess?.(result);
    ElMessage.success('图纸已上传');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '图纸上传失败');
  }
}

</script>

<style scoped>
.order-line-fixed-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.order-line-fixed-toolbar > div {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.order-line-fixed-toolbar-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.order-line-table-height-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-right: 4px;
}

.order-line-table-height-label {
  color: #475569;
  font-size: 12px;
  white-space: nowrap;
}

.order-line-fixed-toolbar span {
  color: #64748b;
  font-size: 12px;
}

.order-line-fixed-textarea :deep(textarea) {
  min-height: 460px;
  font-family: Consolas, 'Courier New', monospace;
  line-height: 1.55;
  white-space: pre;
}

.order-line-mobile {
  margin-top: 0;
}

.order-line-table :deep(.el-table__fixed-right) {
  box-shadow: -8px 0 12px rgba(15, 23, 42, 0.08);
}

.order-line-table :deep(.el-table__fixed-right .el-table__cell) {
  background: #ffffff;
}

.order-line-structure-cell {
  display: grid;
  gap: 4px;
  align-items: center;
}

.order-line-structure-cell small {
  color: #64748b;
  font-size: 12px;
  line-height: 16px;
}

.order-line-structure-cell.is-structure-child {
  padding-left: 12px;
  border-left: 3px solid #f59e0b;
}

.order-line-structure-cell.is-structure-orphan {
  padding-left: 12px;
  border-left: 3px solid #dc2626;
}

.order-line-structure-cell.is-structure-component {
  border-left: 3px solid #16a34a;
  padding-left: 8px;
}

.order-line-table :deep(.is-order-line-component > td) {
  background: #f8fafc;
}

.order-line-table :deep(.is-order-line-child > td:first-child) {
  border-left: 4px solid #f59e0b;
}

.order-line-table :deep(.is-order-line-standalone > td:first-child) {
  border-left: 4px solid #cbd5e1;
}

.line-drag-handle {
  width: 28px;
  height: 28px;
  cursor: grab;
}

.line-drag-handle:active {
  cursor: grabbing;
}

.line-drag-handle:disabled {
  cursor: not-allowed;
}

.order-line-table :deep(.is-order-line-dragging) {
  opacity: 0.48;
}

.order-line-table :deep(.is-order-line-drop-before > td) {
  box-shadow: inset 0 2px 0 #2563eb;
}

.order-line-table :deep(.is-order-line-drop-after > td) {
  box-shadow: inset 0 -2px 0 #2563eb;
}

.line-remove-button {
  color: #dc2626;
  font-weight: 600;
}

.line-remove-button:hover {
  color: #b91c1c;
}

.order-line-card {
  padding: 12px;
}

.order-line-card .mobile-card-title {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.order-line-card .mobile-card-title small {
  flex-basis: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-line-mobile-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #475569;
  font-size: 13px;
}

.order-line-mobile-toolbar > div {
  display: flex;
  gap: 6px;
}

.order-line-compact-summary {
  margin-bottom: 10px;
}

.order-line-compact-summary .warning {
  color: #d97706;
  font-weight: 600;
}

.order-line-compact-summary .success {
  color: #16a34a;
  font-weight: 600;
}

.order-line-mobile-fields {
  display: grid;
  gap: 10px;
}

.order-line-mobile-fields label {
  display: grid;
  gap: 6px;
  color: #64748b;
  font-size: 12px;
}

.order-line-mobile-fields :deep(.el-input),
.order-line-mobile-fields :deep(.el-input-number),
.order-line-mobile-fields :deep(.el-date-editor),
.order-line-mobile-fields :deep(.el-select) {
  width: 100% !important;
}

.drawing-upload-cell {
  display: grid;
  gap: 6px;
}

.material-input-cell {
  display: grid;
  gap: 4px;
}

.material-identity-warning {
  color: #d97706;
  font-size: 12px;
  line-height: 16px;
}

.stock-status-cell {
  display: grid;
  align-items: start;
  gap: 4px;
}

.stock-status-cell small {
  color: #64748b;
  font-size: 12px;
  line-height: 16px;
}

.stock-status-cell small.warning {
  color: #dc2626;
}

.selected-source-summary {
  display: -webkit-box;
  overflow: hidden;
  max-width: 220px;
  color: #2563eb !important;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.stock-plan-hint {
  display: block;
  margin-top: 4px;
  color: #d97706;
  font-size: 12px;
  line-height: 16px;
}

.plan-override-cell {
  display: grid;
  gap: 6px;
}

.muted {
  color: #94a3b8;
}

.stock-detail-button {
  justify-self: start;
  padding: 0;
  font-size: 12px;
}

.drawing-upload-cell :deep(.drawing-preview-button) {
  overflow: hidden;
  color: #2563eb;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.material-suggestion-popper .el-autocomplete-suggestion__wrap) {
  max-height: 340px;
}

:global(.material-suggestion-popper) {
  width: min(560px, calc(100vw - 48px)) !important;
}

:global(.material-suggestion-popper .el-autocomplete-suggestion li) {
  min-height: 58px;
  padding: 6px 14px;
}

@media (max-width: 900px) {
  .stock-status-cell {
    align-items: stretch;
  }

  .stock-status-cell :deep(.el-tag) {
    width: fit-content;
    max-width: 100%;
    white-space: normal;
  }

  .selected-source-summary {
    max-width: 100%;
    -webkit-line-clamp: 3;
  }

  .stock-detail-button {
    justify-self: stretch;
    min-height: 36px;
    border: 1px solid #dbeafe;
    border-radius: 6px;
    background: #f8fbff;
  }

  .drawing-upload-cell :deep(.drawing-preview-button) {
    max-width: 100%;
    white-space: normal;
  }

  .order-line-mobile-toolbar {
    flex-wrap: wrap;
  }

  .order-line-mobile-toolbar :deep(.el-button) {
    min-height: 36px;
  }
}
</style>
