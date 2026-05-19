<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">客户资料</h2>
      <el-button title="刷新整页客户数据" :loading="customerPageRefreshing" @click="refreshCustomersPage">刷新</el-button>
      <el-button title="导出Excel" v-if="!isMobileLayout" :icon="Download" :loading="customerExporting" @click="exportCustomersExcel">导出 Excel</el-button>
      <el-button v-if="!isMobileLayout" type="primary" @click="openCreate">新增客户</el-button>
    </div>

    <div class="filter-bar">
      <div class="filter-field">
        <label>关键词</label>
        <el-autocomplete
          v-model="keyword"
          :fetch-suggestions="queryCustomerSuggestions"
          :trigger-on-focus="true"
          :debounce="240"
          clearable
          value-key="customerName"
          popper-class="customer-search-popper"
          placeholder="客户名称 / ID / 联系人 / 拼音"
          style="width: 320px"
          @select="handleCustomerSuggestionSelect"
          @keyup.enter="searchCustomers"
        >
          <template #default="{ item }">
            <div :class="['customer-suggestion', { 'customer-suggestion-more': item.isMoreHint }]">
              {{ item.customerName }}
            </div>
          </template>
        </el-autocomplete>
      </div>
      <div class="filter-field">
        <label>状态</label>
        <el-select v-model="statusFilter" clearable placeholder="全部状态" style="width: 150px">
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
      </div>
      <el-button type="primary" :loading="loading" @click="searchCustomers">搜索</el-button>
      <el-button title="重置" @click="reset">重置</el-button>
    </div>

    <div class="customer-bom-guide" aria-label="客户 BOM 入口说明">
      <span>客户 BOM 入口</span>
      <strong>客户零件包：只看客户私有 BOM。</strong>
      <strong>可用BOM：查看该客户可用的客户私有、指定客户可用和机型级通用 BOM。</strong>
      <strong>常用BOM：只看当前客户范围内人工设为常用的 BOM。</strong>
      <strong>新建常用BOM：创建客户私有 BOM，并默认设为常用；不创建订单、生产任务或库存。</strong>
      <small>客户页默认排除全部客户 / 全部机型泛用 BOM，避免把百胜通用包误认为客户资料。</small>
    </div>

    <div class="table-card desktop-table">
      <div class="customer-table-height-toolbar">
        <div class="customer-table-height-actions" aria-label="客户资料表格高度">
          <span class="customer-table-height-label">客户资料表格高度</span>
          <el-button-group>
            <el-button
              size="small"
              :icon="Minus"
              :disabled="customerWorkTableHeights.customers <= customerWorkTableHeightLimits.min"
              title="降低客户资料表格高度"
              aria-label="降低客户资料表格高度"
              @click="adjustCustomerWorkTableHeight('customers', -customerWorkTableHeightLimits.step)"
            />
            <el-button
              size="small"
              :icon="Plus"
              :disabled="customerWorkTableHeights.customers >= customerWorkTableHeightLimits.max"
              title="提高客户资料表格高度"
              aria-label="提高客户资料表格高度"
              @click="adjustCustomerWorkTableHeight('customers', customerWorkTableHeightLimits.step)"
            />
            <el-button
              size="small"
              :icon="RefreshLeft"
              :disabled="customerWorkTableHeights.customers === customerWorkTableDefaultHeights.customers"
              title="恢复客户资料表格默认高度"
              aria-label="恢复客户资料表格默认高度"
              @click="resetCustomerWorkTableHeight('customers')"
            />
          </el-button-group>
        </div>
      </div>
      <el-table v-loading="loading" :data="customers" :max-height="customerWorkTableHeights.customers">
        <el-table-column prop="customerCode" label="客户ID" width="130" />
        <el-table-column prop="customerName" label="客户名称" min-width="220" />
        <el-table-column label="地区" min-width="220">
          <template #default="{ row }">{{ formatRegion(row) }}</template>
        </el-table-column>
        <el-table-column label="联系人" min-width="210">
          <template #default="{ row }">
            <div class="contact-list">
              <span v-for="contact in row.contacts" :key="contact.id || contact.contactName" class="contact-pill">
                {{ contact.contactName }}{{ contact.isPrimary ? '（主要）' : '' }}{{ contact.contactPhone ? ` / ${contact.contactPhone}` : '' }}
              </span>
              <span v-if="!row.contacts?.length" class="muted">-</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <StatusTag :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="360" fixed="right">
          <template #default="{ row }">
            <div class="customer-row-actions">
              <div class="customer-row-action-group">
                <span class="customer-row-action-label">资料</span>
                <el-button link type="primary" title="零件管理" @click="openCustomerMaterials(row)">零件</el-button>
                <el-button link type="primary" title="编辑客户" @click="openEdit(row)">编辑</el-button>
                <el-button
                  link
                  :type="row.status === 'ENABLED' ? 'danger' : 'success'"
                  :title="row.status === 'ENABLED' ? '停用客户' : '启用客户'"
                  @click="openStatusDialog(row)"
                >
                  {{ row.status === 'ENABLED' ? '停用' : '启用' }}
                </el-button>
              </div>
              <div class="customer-row-action-group">
                <span class="customer-row-action-label">BOM</span>
                <el-button link type="primary" title="客户零件包" @click="openCustomerPrivateBoms(row)">客户包</el-button>
                <el-button link type="primary" title="可用BOM" @click="openCustomerAvailableBoms(row)">可用</el-button>
                <el-button link type="primary" title="常用BOM" @click="openCustomerCommonBoms(row)">常用</el-button>
                <el-button link type="success" title="设置常用BOM" @click="openCustomerCommonSetup(row)">设常用</el-button>
                <el-button link type="success" title="新建BOM" @click="openCustomerBomCreate(row)">新建</el-button>
                <el-button link type="success" title="新建常用BOM" @click="openCustomerCommonBomCreate(row)">新常用</el-button>
              </div>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="customerPagination.total > 0" class="table-pagination-row">
        <span>第 {{ customerPagination.page }} 页，已显示 {{ customers.length }} / {{ customerPagination.total }} 个客户</span>
        <el-pagination
          :current-page="customerPagination.page"
          :page-size="customerPagination.limit"
          :total="customerPagination.total"
          :hide-on-single-page="customerPagination.total <= customerPagination.limit"
          layout="prev, pager, next"
          @current-change="handleCustomerPageChange"
        />
      </div>
    </div>

    <div v-loading="loading" class="mobile-card-list">
      <article
        v-for="customer in customers"
        :key="customer.id"
        class="mobile-card mobile-order-card"
        :class="{ expanded: isMobileCustomerExpanded(customer.id) }"
      >
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ customer.customerName }}</strong>
            <small>{{ customer.customerCode }}</small>
          </div>
          <div class="mobile-card-header-actions">
            <el-button
              link
              type="primary"
              :title="isMobileCustomerExpanded(customer.id) ? '收起客户资料详情' : '查看客户资料详情'"
              @click="toggleMobileCustomerCard(customer.id)"
            >
              {{ isMobileCustomerExpanded(customer.id) ? '收起' : '详情' }}
            </el-button>
          </div>
        </div>
        <div class="mobile-card-compact-summary">
          <span><StatusTag :value="customer.status" compact /></span>
          <span>{{ primaryContactText(customer) }}</span>
        </div>
        <div v-show="isMobileCustomerExpanded(customer.id)" class="mobile-card-fields">
          <div class="mobile-field">
            <label>状态</label>
            <span><StatusTag :value="customer.status" /></span>
          </div>
          <div class="mobile-field mobile-full">
            <label>地区</label>
            <span>{{ formatRegion(customer) }}</span>
          </div>
          <div class="mobile-field mobile-full">
            <label>联系人</label>
            <div class="contact-list">
              <span v-for="contact in customer.contacts" :key="contact.id || contact.contactName" class="contact-pill">
                {{ contact.contactName }}{{ contact.isPrimary ? '（主要）' : '' }}{{ contact.contactPhone ? ` / ${contact.contactPhone}` : '' }}
              </span>
              <span v-if="!customer.contacts?.length" class="muted">无联系人</span>
            </div>
          </div>
        </div>
        <div class="mobile-card-actions">
          <el-button link type="primary" @click="openCustomerMaterials(customer)">零件管理</el-button>
          <el-button link type="primary" @click="openCustomerPrivateBoms(customer)">客户零件包</el-button>
          <el-button link type="primary" @click="openCustomerAvailableBoms(customer)">可用BOM</el-button>
          <el-button link type="primary" @click="openCustomerCommonBoms(customer)">常用BOM</el-button>
          <span class="mobile-readonly-note">手机端只保留资料和 BOM 查看入口</span>
        </div>
      </article>
      <div v-if="!customers.length && !loading" class="mobile-empty">暂无客户资料</div>
      <div v-if="customerPagination.total > 0" class="mobile-pagination-row">
        <span>第 {{ customerPagination.page }} 页，已显示 {{ customers.length }} / {{ customerPagination.total }} 个客户</span>
        <el-pagination
          small
          :current-page="customerPagination.page"
          :page-size="customerPagination.limit"
          :total="customerPagination.total"
          layout="prev, pager, next"
          @current-change="handleCustomerPageChange"
        />
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑客户' : '新增客户'"
      width="min(860px, calc(100vw - 32px))"
      class="responsive-dialog"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :before-close="handleCustomerDialogClose"
    >
      <el-form label-width="112px">
        <div class="customer-form-grid">
          <el-form-item label="客户ID">
            <div class="check-field">
              <el-input
                v-model="form.customerCode"
                :disabled="Boolean(editingId)"
                placeholder="可手工填写客户ID"
                @input="scheduleCodeCheck"
                @blur="checkCustomerCode(true)"
              />
              <span v-if="checkingCode" class="check-loading">自动查重中...</span>
            </div>
            <div class="field-hint">{{ customerCodeHint }}</div>
            <div v-if="codeCheckText" :class="['check-message', codeAvailable ? 'available' : 'duplicated']">
              {{ codeCheckText }}
            </div>
          </el-form-item>
          <el-form-item label="客户名称" required>
            <div class="check-field">
              <el-input v-model="form.customerName" @input="scheduleNameCheck" @blur="checkCustomerName(true)" />
              <span v-if="checkingName" class="check-loading">自动查重中...</span>
            </div>
            <div v-if="nameCheckText" :class="['check-message', nameAvailable ? 'available' : 'duplicated']">
              {{ nameCheckText }}
            </div>
          </el-form-item>
        </div>

        <div class="form-section-title">地区信息</div>
        <div class="customer-form-grid">
          <el-form-item label="地区范围" required>
            <el-radio-group v-model="form.regionType" @change="handleRegionTypeChange">
              <el-radio-button value="CHINA">中国</el-radio-button>
              <el-radio-button value="OVERSEAS">国外</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <template v-if="form.regionType === 'CHINA'">
            <el-form-item label="省份" required>
              <el-select v-model="form.province" filterable placeholder="选择省份" @change="handleProvinceChange">
                <el-option v-for="item in chinaRegions" :key="item.province" :label="item.province" :value="item.province" />
              </el-select>
            </el-form-item>
            <el-form-item label="城市" required>
              <el-select v-model="form.city" filterable allow-create placeholder="选择或输入城市">
                <el-option v-for="city in cityOptions" :key="city" :label="city" :value="city" />
              </el-select>
            </el-form-item>
          </template>

          <template v-else>
            <el-form-item label="国家" required>
              <el-select v-model="form.country" filterable allow-create placeholder="选择或输入国家">
                <el-option v-for="country in worldCountryOptions" :key="country" :label="country" :value="country" />
              </el-select>
            </el-form-item>
            <el-form-item label="州">
              <el-input v-model="form.state" placeholder="选填" />
            </el-form-item>
            <el-form-item label="省">
              <el-input v-model="form.province" placeholder="选填" />
            </el-form-item>
            <el-form-item label="区">
              <el-input v-model="form.district" placeholder="选填" />
            </el-form-item>
            <el-form-item label="城市">
              <el-input v-model="form.city" placeholder="选填" />
            </el-form-item>
          </template>

          <el-form-item label="详细地址">
            <el-input v-model="form.detailAddress" placeholder="选填" />
          </el-form-item>
        </div>

        <div class="form-section-title">
          <span>联系人</span>
          <el-button size="small" @click="addContact">新增联系人</el-button>
        </div>
        <div class="contacts-editor">
          <div v-for="(contact, index) in form.contacts" :key="index" class="contact-row">
            <el-radio :model-value="primaryContactIndex" :value="index" @change="setPrimaryContact(index)">主要</el-radio>
            <el-input v-model="contact.contactName" placeholder="联系人姓名" />
            <el-input v-model="contact.contactPhone" placeholder="电话" />
            <el-input v-model="contact.title" placeholder="职务 / 角色" />
            <el-button link @click="removeContact(index)">删除</el-button>
          </div>
          <span class="muted contact-rule">有联系人时必须选择一个主要联系人；如果不填写联系人，保存后客户会自动停用，但客户ID和客户名称继续保留。</span>
        </div>

        <el-form-item label="备注" class="mt-16">
          <el-input v-model="form.remark" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="closeCustomerDialog">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" @click="save"
          title="保存">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="statusDialogVisible"
      :title="statusDialogTitle"
      width="min(520px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
    >
      <div v-if="statusCustomer" class="status-confirm-panel">
        <p class="status-confirm-row">
          <span class="status-confirm-label">客户ID</span>
          <strong>{{ statusCustomer.customerCode }}</strong>
        </p>
        <p class="status-confirm-row">
          <span class="status-confirm-label">客户名称</span>
          <strong>{{ statusCustomer.customerName }}</strong>
        </p>
        <p class="status-confirm-row">
          <span class="status-confirm-label">当前状态</span>
          <StatusTag :value="statusCustomer.status" />
        </p>
        <p class="status-confirm-row">
          <span class="status-confirm-label">操作后状态</span>
          <StatusTag :value="nextCustomerStatus" />
        </p>
        <p class="status-confirm-row">
          <span class="status-confirm-label">主要联系人</span>
          <strong>{{ statusPrimaryContactText }}</strong>
        </p>
        <p class="status-confirm-warning">{{ statusDialogWarning }}</p>
      </div>
      <template #footer>
        <el-button :disabled="statusSaving" @click="statusDialogVisible = false">取消</el-button>
        <el-button
          :type="nextCustomerStatus === 'DISABLED' ? 'warning' : 'primary'"
          :disabled="statusConfirmDisabled"
          :loading="statusSaving"
          :title="`确认${statusActionText}`"
          @click="confirmStatusChange"
        >
          确认{{ statusActionText }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="bomCommonDialogVisible"
      :title="bomCommonDialogTitle"
      width="min(980px, calc(100vw - 32px))"
      class="responsive-dialog"
      append-to-body
    >
      <div class="customer-common-bom-dialog">
        <p class="customer-common-bom-note">
          这里设置的是 BOM 自身的常用状态，对该 BOM 的所属适用范围生效；客户私有 BOM 只影响当前客户，全部客户或指定客户可用 BOM 会影响对应可见范围。
        </p>
        <div class="customer-common-bom-toolbar">
          <div class="customer-common-bom-summary">
            <el-tag effect="plain">可见 BOM {{ customerBomCommonSummary.total }}</el-tag>
            <el-tag type="success" effect="plain">已设常用 {{ customerBomCommonSummary.common }}</el-tag>
            <el-tag effect="plain">普通可用 {{ customerBomCommonSummary.available }}</el-tag>
            <el-tag type="warning" effect="plain">客户私有 {{ customerBomCommonSummary.private }}</el-tag>
            <el-tag type="primary" effect="plain">指定客户可用 {{ customerBomCommonSummary.selected }}</el-tag>
            <el-tag type="info" effect="plain">全部客户机型通用 {{ customerBomCommonSummary.allCustomer }}</el-tag>
          </div>
          <el-radio-group v-model="bomCommonViewFilter" size="small">
            <el-radio-button value="ALL">全部</el-radio-button>
            <el-radio-button value="COMMON">已设常用</el-radio-button>
            <el-radio-button value="AVAILABLE">普通可用</el-radio-button>
          </el-radio-group>
          <el-button title="查看固定格式" size="small" :disabled="!customerBomCommonFixedText" @click="openCustomerBomCommonTextDialog">
            查看固定格式
          </el-button>
          <el-button title="复制当前筛选" size="small" :disabled="!customerBomCommonFixedText" @click="copyCustomerBomCommonText">
            复制当前筛选
          </el-button>
          <el-button
            v-if="!isMobileLayout"
            size="small"
            type="success"
            plain
            :loading="bomCommonBatchSaving"
            :disabled="customerBomCommonBatchSetRows.length === 0 || bomCommonBusy"
            title="将当前筛选结果设为客户常用 BOM"
            @click="setFilteredCustomerBomsCommon(true)"
          >
            筛选设为常用
          </el-button>
          <el-button
            v-if="!isMobileLayout"
            size="small"
            type="warning"
            plain
            :loading="bomCommonBatchSaving"
            :disabled="customerBomCommonBatchCancelRows.length === 0 || bomCommonBusy"
            title="取消筛选常用"
            @click="setFilteredCustomerBomsCommon(false)"
          >
            取消筛选常用
          </el-button>
        </div>
        <div class="customer-common-bom-filters">
          <el-radio-group v-model="bomCommonOwnershipFilter" size="small">
            <el-radio-button value="ALL">全部归属</el-radio-button>
            <el-radio-button value="PRIVATE">客户私有</el-radio-button>
            <el-radio-button value="SELECTED">指定客户可用</el-radio-button>
            <el-radio-button value="ALL_CUSTOMER">全部客户机型通用</el-radio-button>
          </el-radio-group>
          <el-input
            v-model="bomCommonKeyword"
            class="customer-common-bom-filter"
            clearable
            placeholder="搜索 BOM 名称 / 适用范围 / 机型 / 客户"
          />
        </div>
        <div class="customer-common-bom-load-summary">
          已按分页接口加载 {{ customerBomCommonRows.length }} / {{ customerBomCommonTotal }} 个客户可见 BOM；当前筛选显示
          {{ filteredCustomerBomCommonRows.length }} 个。
        </div>
        <div class="customer-table-height-toolbar">
          <div class="customer-table-height-actions" aria-label="客户常用 BOM 表格高度">
            <span class="customer-table-height-label">客户常用 BOM 表格高度</span>
            <el-button-group>
              <el-button
                size="small"
                :icon="Minus"
                :disabled="customerWorkTableHeights.commonBoms <= customerWorkTableHeightLimits.min"
                title="降低客户常用 BOM 表格高度"
                aria-label="降低客户常用 BOM 表格高度"
                @click="adjustCustomerWorkTableHeight('commonBoms', -customerWorkTableHeightLimits.step)"
              />
              <el-button
                size="small"
                :icon="Plus"
                :disabled="customerWorkTableHeights.commonBoms >= customerWorkTableHeightLimits.max"
                title="提高客户常用 BOM 表格高度"
                aria-label="提高客户常用 BOM 表格高度"
                @click="adjustCustomerWorkTableHeight('commonBoms', customerWorkTableHeightLimits.step)"
              />
              <el-button
                size="small"
                :icon="RefreshLeft"
                :disabled="customerWorkTableHeights.commonBoms === customerWorkTableDefaultHeights.commonBoms"
                title="恢复客户常用 BOM 表格默认高度"
                aria-label="恢复客户常用 BOM 表格默认高度"
                @click="resetCustomerWorkTableHeight('commonBoms')"
              />
            </el-button-group>
          </div>
        </div>
        <el-table
          v-loading="bomCommonBusy"
          :data="filteredCustomerBomCommonRows"
          empty-text="当前条件没有可设置的 BOM"
          :max-height="customerWorkTableHeights.commonBoms"
        >
          <el-table-column label="排序" width="80">
            <template #default="{ row }">
              <div v-if="row.status === 'ENABLED' && row.isCommon" class="customer-common-bom-sort-cell">
                <button
                  v-if="!isMobileLayout"
                  class="customer-common-bom-drag-handle"
                  :class="{
                    'is-drop-target': draggedCustomerCommonBomOverId === row.id,
                    'is-disabled': !canDragCustomerCommonBom(row)
                  }"
                  type="button"
                  aria-label="拖拽调整客户常用 BOM 顺序"
                  :draggable="canDragCustomerCommonBom(row)"
                  :title="customerBomCommonDragTitle(row)"
                  @click.stop
                  @dragstart.stop="startCustomerCommonBomDrag($event, row)"
                  @dragover.prevent.stop="handleCustomerCommonBomDragOver($event, row)"
                  @drop.prevent.stop="dropCustomerCommonBom(row)"
                  @dragend="endCustomerCommonBomDrag"
                >
                  <el-icon><Rank /></el-icon>
                </button>
                <span :title="`常用显示顺序 ${customerBomCommonDisplayOrder(row) || '-'}`">{{ customerBomCommonDisplayOrder(row) }}</span>
              </div>
              <span v-else class="cell-subtext">-</span>
            </template>
          </el-table-column>
          <el-table-column prop="bomName" label="零件包" min-width="220" />
          <el-table-column label="适用范围" min-width="220">
            <template #default="{ row }">
              <el-tooltip :content="customerBomCommonScopeTitle(row)" placement="top">
                <div class="bom-scope-cell">
                  <strong>{{ customerBomCommonScopePreview(row) }}</strong>
                  <small>{{ customerBomCommonCustomerText(row) }}</small>
                </div>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="归属类型" width="150">
            <template #default="{ row }">
              <el-tag :type="customerBomOwnershipTagType(row)" effect="plain">
                {{ customerBomOwnershipLabel(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="常用" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.isCommon" type="success" effect="plain" :title="`常用显示顺序 ${customerBomCommonDisplayOrder(row) || '-'}`">
                常用 {{ customerBomCommonDisplayOrder(row) }}
              </el-tag>
              <el-tag v-else effect="plain">普通可用</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <StatusTag :value="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <div class="customer-common-bom-actions">
                <div class="customer-common-bom-action-group">
                  <span class="customer-common-bom-action-label">详情</span>
                  <el-button link type="primary" title="查看或编辑 BOM" :disabled="bomCommonBusy" @click="openCustomerBomDetail(row)">查看</el-button>
                </div>
                <div class="customer-common-bom-action-group">
                  <span class="customer-common-bom-action-label">常用</span>
                  <el-button
                    link
                    :type="row.isCommon ? 'warning' : 'success'"
                    :title="row.isCommon ? '取消客户常用 BOM' : '设为客户常用 BOM'"
                    :loading="bomCommonSavingId === row.id"
                    :disabled="bomCommonBusy || (!row.isCommon && row.status === 'DISABLED')"
                    @click="setCustomerBomCommon(row, !row.isCommon)"
                  >
                    {{ row.isCommon ? '取消' : '设为' }}
                  </el-button>
                </div>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button title="刷新" :loading="bomCommonLoading" :disabled="bomCommonBusy" @click="loadCustomerCommonRows">刷新</el-button>
        <el-button title="关闭" :disabled="bomCommonBusy" @click="bomCommonDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="bomCommonBatchDialogVisible"
      class="responsive-dialog"
      :title="`批量${bomCommonBatchActionText}`"
      width="min(820px, calc(100vw - 32px))"
      append-to-body
      :close-on-click-modal="!bomCommonBatchSaving"
      :close-on-press-escape="!bomCommonBatchSaving"
      :before-close="handleBomCommonBatchDialogClose"
    >
      <div class="customer-common-bom-batch-preview">
        <p>
          将当前筛选结果中的
          <strong>{{ bomCommonBatchRows.length }}</strong>
          个 BOM 批量{{ bomCommonBatchActionText }}。
        </p>
        <p class="customer-common-bom-batch-scope">
          筛选：常用状态 {{ customerBomCommonViewFilterLabel() }}；归属
          {{ customerBomCommonOwnershipFilterLabel() }}；关键词 {{ bomCommonKeyword.trim() || '无' }}
        </p>
        <el-input
          class="fixed-format-textarea"
          :model-value="bomCommonBatchPreviewText"
          type="textarea"
          :rows="16"
          readonly
        />
        <p class="customer-common-bom-batch-boundary">
          业务边界：只修改 BOM 常用状态和显示顺序，不修改 BOM 明细、适用范围、订单、生产任务或库存。
        </p>
      </div>
      <template #footer>
        <el-button :disabled="bomCommonBatchSaving" @click="closeBomCommonBatchDialog">取消</el-button>
        <el-button
          :type="bomCommonBatchTargetIsCommon ? 'success' : 'warning'"
          :loading="bomCommonBatchSaving"
          :title="`确认${bomCommonBatchActionText}`"
          @click="confirmFilteredCustomerBomsCommon"
        >
          确认{{ bomCommonBatchActionText }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="customerBomCommonTextDialogVisible"
      class="responsive-dialog"
      title="客户常用 BOM 固定格式清单"
      width="min(980px, calc(100vw - 32px))"
      append-to-body
    >
      <el-input
        class="fixed-format-textarea"
        :model-value="customerBomCommonFixedText"
        type="textarea"
        :rows="22"
        readonly
      />
      <template #footer>
        <el-button title="关闭" @click="customerBomCommonTextDialogVisible = false">关闭</el-button>
        <el-button title="复制清单" type="primary" :disabled="!customerBomCommonFixedText" @click="copyCustomerBomCommonText">
          复制清单
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Minus, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue';
import { Download } from '@element-plus/icons-vue';
import { erpApi } from '../api/erp';
import StatusTag from '../components/StatusTag.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import { chinaRegions, worldCountryOptions } from '../config/regions';
import type { CommonStatus, Customer, CustomerContact, CustomerRegionType, ModelBom } from '../types/erp';
import { formatFileDateTime } from '../utils/tableExport';

interface CustomerForm {
  customerCode?: string;
  customerName: string;
  regionType: CustomerRegionType;
  country: string;
  province?: string;
  state?: string;
  district?: string;
  city?: string;
  detailAddress?: string;
  remark?: string;
  contacts: CustomerContact[];
}

type CustomerSearchSuggestion = Customer & { isMoreHint?: boolean };
type BomCommonViewFilter = 'ALL' | 'COMMON' | 'AVAILABLE';
type BomCommonOwnershipFilter = 'ALL' | 'PRIVATE' | 'SELECTED' | 'ALL_CUSTOMER';
type CustomerWorkTableKey = 'customers' | 'commonBoms';

const router = useRouter();
const { isMobileLayout } = useDeviceProfile();
const customers = ref<Customer[]>([]);
const keyword = ref('');
const statusFilter = ref<CommonStatus>('ENABLED');
const loading = ref(false);
const customerPageRefreshing = ref(false);
const customerExporting = ref(false);
const customerPagination = reactive({ page: 1, limit: Number(20), total: 0 });
const saving = ref(false);
const dialogVisible = ref(false);
const editingId = ref<string>();
const primaryContactIndex = ref<number>();
const statusDialogVisible = ref(false);
const statusSaving = ref(false);
const statusCustomer = ref<Customer>();
const nextCustomerCode = ref('');
const checkingName = ref(false);
const checkingCode = ref(false);
const nameAvailable = ref(false);
const codeAvailable = ref(false);
const nameCheckText = ref('');
const codeCheckText = ref('');
const expandedMobileCustomerIds = ref<string[]>([]);
const bomCommonDialogVisible = ref(false);
const customerBomCommonTextDialogVisible = ref(false);
const bomCommonLoading = ref(false);
const bomCommonSavingId = ref('');
const bomCommonCustomer = ref<Customer>();
const customerBomCommonRows = ref<ModelBom[]>([]);
const customerBomCommonTotal = ref(0);
const customerBomCommonPageLimit = Number(100);
const bomCommonViewFilter = ref<BomCommonViewFilter>('ALL');
const bomCommonOwnershipFilter = ref<BomCommonOwnershipFilter>('ALL');
const bomCommonKeyword = ref('');
const bomCommonDragSaving = ref(false);
const bomCommonBatchSaving = ref(false);
const bomCommonBatchDialogVisible = ref(false);
const bomCommonBatchTargetIsCommon = ref(false);
const bomCommonBatchRows = ref<ModelBom[]>([]);
const bomCommonBatchPreviewText = ref('');
const draggedCustomerCommonBomId = ref('');
const draggedCustomerCommonBomScopeKey = ref('');
const draggedCustomerCommonBomOverId = ref('');
let nameCheckTimer: ReturnType<typeof window.setTimeout> | undefined;
let codeCheckTimer: ReturnType<typeof window.setTimeout> | undefined;
let customerSearchTimer: ReturnType<typeof window.setTimeout> | undefined;
let customerSuggestionSequence = 0;
const customerSuggestionLimit = Number(20);
const customerSuggestionKeyword = ref('');
const customerWorkTableHeightLimits = {
  min: 320,
  max: 860,
  step: 80
};
const customerWorkTableDefaultHeights = {
  customers: 620,
  commonBoms: 520
} satisfies Record<CustomerWorkTableKey, number>;
const customerWorkTableHeightStorageKey = 'baisheng.erp.customerWorkTableHeights.v1';
// 客户页面表格高度只保存为本机 UI 偏好，不写入客户、多联系人、BOM、订单、生产或库存业务数据。
const customerWorkTableHeights = reactive<Record<CustomerWorkTableKey, number>>({
  ...customerWorkTableDefaultHeights
});

const form = reactive<CustomerForm>(blankForm());

const cityOptions = computed(() => chinaRegions.find((item) => item.province === form.province)?.cities || []);
const statusActionText = computed(() => (statusCustomer.value?.status === 'ENABLED' ? '停用' : '启用'));
const nextCustomerStatus = computed<CommonStatus>(() => (statusCustomer.value?.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'));
const statusDialogTitle = computed(() => `${statusActionText.value}客户`);
const bomCommonDialogTitle = computed(() =>
  bomCommonCustomer.value ? `${bomCommonCustomer.value.customerName} 常用 BOM 设置` : '客户常用 BOM 设置'
);
const bomCommonBusy = computed(
  () => bomCommonLoading.value || Boolean(bomCommonSavingId.value) || bomCommonDragSaving.value || bomCommonBatchSaving.value
);
const customerBomCommonSummary = computed(() => {
  const rows = customerBomCommonRows.value;
  return {
    total: rows.length,
    common: rows.filter((row) => row.isCommon).length,
    available: rows.filter((row) => !row.isCommon).length,
    private: rows.filter((row) => row.customerId || row.customerScopeMode === 'PRIVATE').length,
    selected: rows.filter((row) => row.customerScopeMode === 'SELECTED').length,
    allCustomer: rows.filter((row) => !row.customerId && row.customerScopeMode !== 'SELECTED').length
  };
});
const filteredCustomerBomCommonRows = computed(() => {
  const keywordText = bomCommonKeyword.value.trim().toLowerCase();
  return customerBomCommonRows.value.filter((row) => {
    if (bomCommonViewFilter.value === 'COMMON' && !row.isCommon) {
      return false;
    }
    if (bomCommonViewFilter.value === 'AVAILABLE' && row.isCommon) {
      return false;
    }
    return customerBomOwnershipFilterMatches(row) && customerBomCommonKeywordMatches(row, keywordText);
  });
});
const customerBomCommonFixedText = computed(() => {
  if (filteredCustomerBomCommonRows.value.length === 0) {
    return '';
  }
  const customerName = bomCommonCustomer.value?.customerName || '未选择客户';
  return [
    `客户常用 BOM 固定格式清单`,
    `客户：${customerName}`,
    `筛选：常用状态 ${customerBomCommonViewFilterLabel()}；归属 ${customerBomCommonOwnershipFilterLabel()}；关键词 ${bomCommonKeyword.value.trim() || '无'}`,
    `汇总：当前显示 ${filteredCustomerBomCommonRows.value.length} / 可见 ${customerBomCommonSummary.value.total}；已设常用 ${customerBomCommonSummary.value.common}；普通可用 ${customerBomCommonSummary.value.available}`,
    `业务边界：本清单只用于核对 BOM 常用状态和适用范围，不会创建订单、生产任务或库存流水。`,
    '',
    ...filteredCustomerBomCommonRows.value.map((row, index) =>
      [
        `${index + 1}. ${row.bomName}`,
        `常用 ${row.isCommon ? `是，顺序 ${customerBomCommonDisplayOrder(row)}` : '否'}`,
        `归属 ${customerBomOwnershipLabel(row)}`,
        `适用客户 ${customerBomCommonCustomerText(row)}`,
        `机型/项目 ${row.projectModel || '全部机型/项目'}`,
        `明细 ${row.lineCount} 行`,
        `状态 ${row.status === 'ENABLED' ? '启用' : '停用'}`
      ].join(' | ')
    )
  ].join('\n');
});
const customerBomCommonBatchSetRows = computed(() =>
  filteredCustomerBomCommonRows.value.filter((row) => !row.isCommon && row.status === 'ENABLED')
);
const customerBomCommonBatchCancelRows = computed(() => filteredCustomerBomCommonRows.value.filter((row) => row.isCommon));
const bomCommonBatchActionText = computed(() => (bomCommonBatchTargetIsCommon.value ? '设为常用' : '取消常用'));
const statusPrimaryContact = computed(() =>
  statusCustomer.value?.contacts?.find((contact) => contact.isPrimary && contact.contactName?.trim())
);
const statusPrimaryContactText = computed(() => {
  if (!statusPrimaryContact.value) {
    return '未设置';
  }
  return [
    statusPrimaryContact.value.contactName,
    statusPrimaryContact.value.contactPhone,
    statusPrimaryContact.value.title
  ]
    .filter(Boolean)
    .join(' / ');
});
const statusConfirmDisabled = computed(() => nextCustomerStatus.value === 'ENABLED' && !statusPrimaryContact.value);
const statusDialogWarning = computed(() =>
  nextCustomerStatus.value === 'DISABLED'
    ? '停用后该客户不能创建新订单，已存在订单和历史记录仍会保留。'
    : statusConfirmDisabled.value
      ? '该客户没有主要联系人，不能启用。请先编辑客户并设置一个主要联系人。'
      : '启用后该客户可继续创建新订单；系统仍会要求客户至少保留一个主要联系人。'
);

function clampCustomerWorkTableHeight(value: number) {
  return Math.min(customerWorkTableHeightLimits.max, Math.max(customerWorkTableHeightLimits.min, value));
}

function adjustCustomerWorkTableHeight(key: CustomerWorkTableKey, delta: number) {
  customerWorkTableHeights[key] = clampCustomerWorkTableHeight(customerWorkTableHeights[key] + delta);
}

function resetCustomerWorkTableHeight(key: CustomerWorkTableKey) {
  customerWorkTableHeights[key] = customerWorkTableDefaultHeights[key];
}

function restoreCustomerWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const rawValue = window.localStorage.getItem(customerWorkTableHeightStorageKey);
    const savedValue = rawValue ? JSON.parse(rawValue) : {};
    for (const key of Object.keys(customerWorkTableDefaultHeights) as CustomerWorkTableKey[]) {
      const savedHeight = Number(savedValue[key]);
      if (Number.isFinite(savedHeight)) {
        customerWorkTableHeights[key] = clampCustomerWorkTableHeight(savedHeight);
      }
    }
  } catch {
    customerWorkTableHeights.customers = customerWorkTableDefaultHeights.customers;
    customerWorkTableHeights.commonBoms = customerWorkTableDefaultHeights.commonBoms;
  }
}

function saveCustomerWorkTableHeights() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(customerWorkTableHeightStorageKey, JSON.stringify(customerWorkTableHeights));
  } catch {
    // 本机 UI 偏好写入失败不阻断客户资料、多联系人或常用 BOM 查看维护。
  }
}

watch([keyword, statusFilter], () => {
  if (customerSearchTimer) {
    window.clearTimeout(customerSearchTimer);
  }
  customerSearchTimer = window.setTimeout(() => {
    void searchCustomers();
  }, 300);
});
const customerCodeHint = computed(() => {
  if (editingId.value) {
    return '客户ID保存后不可更改。';
  }
  if (form.customerCode?.trim()) {
    return '手工填写的客户ID保存后不可更改。';
  }
  const code = nextCustomerCode.value || '生成中';
  return `如果不填写，这次客户ID自动生成为 ${code}。（一旦生成不可更改）`;
});

function blankForm(): CustomerForm {
  return {
    customerCode: '',
    customerName: '',
    regionType: 'CHINA',
    country: '中国',
    province: '',
    city: '',
    state: '',
    district: '',
    detailAddress: '',
    remark: '',
    contacts: [blankContact()]
  };
}

function blankContact(): CustomerContact {
  return {
    contactName: '',
    contactPhone: '',
    title: '',
    remark: '',
    isPrimary: false
  };
}

function applyForm(next: CustomerForm) {
  Object.assign(form, next);
}

async function loadCustomers() {
  loading.value = true;
  try {
    const offset = (customerPagination.page - 1) * customerPagination.limit;
    const result = await erpApi.customersPage(keyword.value.trim() || undefined, statusFilter.value, customerPagination.limit, offset);
    customers.value = result.items;
    customerPagination.total = result.totalCount;
    if (result.totalCount > 0 && customers.value.length === 0 && customerPagination.page > 1) {
      customerPagination.page = 1;
      await loadCustomers();
    }
  } catch (error) {
    customers.value = [];
    customerPagination.total = 0;
    ElMessage.error(error instanceof Error ? error.message : '客户资料加载失败，请确认后端服务和筛选条件');
  } finally {
    loading.value = false;
  }
}

function searchCustomers() {
  customerPagination.page = 1;
  void loadCustomers();
}

async function refreshCustomersPage() {
  if (customerPageRefreshing.value) {
    return;
  }
  customerPageRefreshing.value = true;
  try {
    // 整页刷新同步客户资料和已打开的客户常用 BOM，避免客户状态或 BOM 常用顺序显示旧数据。
    await loadCustomers();
    if (bomCommonDialogVisible.value) {
      await loadCustomerCommonRows();
    }
  } finally {
    customerPageRefreshing.value = false;
  }
}

async function exportCustomersExcel() {
  if (customerExporting.value) {
    return;
  }
  customerExporting.value = true;
  try {
    await erpApi.downloadCustomersExport(
      keyword.value.trim() || undefined,
      statusFilter.value,
      `客户资料_${formatFileDateTime()}.xlsx`
    );
    ElMessage.success('客户资料 Excel 已生成');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户资料导出失败，请稍后重试');
  } finally {
    customerExporting.value = false;
  }
}

function handleCustomerPageChange(page: number) {
  customerPagination.page = page;
  void loadCustomers();
}

function reset() {
  keyword.value = '';
  statusFilter.value = 'ENABLED';
  searchCustomers();
}

async function queryCustomerSuggestions(queryString: string, callback: (items: CustomerSearchSuggestion[]) => void) {
  const requestId = ++customerSuggestionSequence;
  const normalizedKeyword = queryString.trim();
  customerSuggestionKeyword.value = normalizedKeyword;
  callback([]);
  try {
    const result = await erpApi.customersPage(
      normalizedKeyword || undefined,
      statusFilter.value,
      customerSuggestionLimit,
      0
    );
    if (requestId === customerSuggestionSequence) {
      const suggestions: CustomerSearchSuggestion[] = [...result.items];
      if (result.hasMore) {
        suggestions.push({
          id: '__customer_suggestion_more__',
          customerCode: '',
          customerName: `已显示 ${result.items.length} / ${result.totalCount} 个客户，按 Enter 查询完整列表`,
          regionType: 'CHINA',
          country: '',
          status: 'ENABLED',
          contacts: [],
          isMoreHint: true
        });
      }
      callback(suggestions);
    }
  } catch {
    if (requestId === customerSuggestionSequence) {
      callback([]);
    }
  }
}

function handleCustomerSuggestionSelect(customer: CustomerSearchSuggestion) {
  if (customer.isMoreHint) {
    keyword.value = customerSuggestionKeyword.value;
    searchCustomers();
    return;
  }
  keyword.value = customer.customerName;
  searchCustomers();
}

function openCustomerMaterials(row: Customer) {
  // 客户零件管理入口保留客户上下文，并排除全部客户/全部机型泛用 BOM 的误显示。
  router.push({
    path: '/materials',
    query: {
      customerId: row.id,
      excludeGlobalAllProject: 'true'
    }
  });
}

function openCustomerPrivateBoms(row: Customer) {
  // 客户界面只进入客户私有 BOM，不展示全部客户通用 BOM，避免把百胜通用包误认为该客户资料。
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: row.id,
      scopeMode: 'PRIVATE',
      status: 'ALL'
    }
  });
}

function openCustomerAvailableBoms(row: Customer) {
  // 客户可用 BOM 会包含客户私有、指定客户可用和机型级百胜通用 BOM，但排除全部客户/全部机型泛用包。
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: row.id,
      excludeGlobalAllProject: 'true',
      status: 'ALL'
    }
  });
}

function openCustomerCommonBoms(row: Customer) {
  // 客户常用 BOM 包含客户私有、指定客户可用和机型级通用 BOM 中人工设为常用的零件包，但排除全部客户/全部机型泛用包。
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: row.id,
      excludeGlobalAllProject: 'true',
      commonOnly: 'true',
      status: 'ALL'
    }
  });
}

function openCustomerBomCreate(row: Customer) {
  if (requireDesktopCustomerMutation('新建客户 BOM')) {
    return;
  }
  // 新建入口固定为客户私有 BOM，后续是否设为常用在机型零件包页人工确认。
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: row.id,
      scopeMode: 'PRIVATE',
      status: 'ALL',
      action: 'createBom',
      bomName: `${row.customerName} 客户零件包`
    }
  });
}

function openCustomerCommonBomCreate(row: Customer) {
  if (requireDesktopCustomerMutation('新建客户常用 BOM')) {
    return;
  }
  // 新建客户常用 BOM 仍然只创建客户私有 BOM；常用只影响该客户范围内的显示顺序和推荐优先级。
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: row.id,
      scopeMode: 'PRIVATE',
      commonOnly: 'true',
      isCommon: 'true',
      status: 'ALL',
      action: 'createBom',
      bomName: `${row.customerName} 客户常用零件包`
    }
  });
}

function openCustomerCommonSetup(row: Customer) {
  if (requireDesktopCustomerMutation('设置客户常用 BOM')) {
    return;
  }
  bomCommonCustomer.value = row;
  bomCommonViewFilter.value = 'ALL';
  bomCommonOwnershipFilter.value = 'ALL';
  bomCommonKeyword.value = '';
  customerBomCommonRows.value = [];
  customerBomCommonTotal.value = 0;
  bomCommonDialogVisible.value = true;
  void loadCustomerCommonRows();
}

function customerBomOwnershipFilterMatches(row: ModelBom) {
  if (bomCommonOwnershipFilter.value === 'ALL') {
    return true;
  }
  if (bomCommonOwnershipFilter.value === 'PRIVATE') {
    return Boolean(row.customerId || row.customerScopeMode === 'PRIVATE');
  }
  if (bomCommonOwnershipFilter.value === 'SELECTED') {
    return row.customerScopeMode === 'SELECTED';
  }
  return !row.customerId && row.customerScopeMode !== 'SELECTED';
}

function customerBomCommonViewFilterLabel() {
  if (bomCommonViewFilter.value === 'COMMON') {
    return '已设常用';
  }
  if (bomCommonViewFilter.value === 'AVAILABLE') {
    return '普通可用';
  }
  return '全部';
}

function customerBomCommonOwnershipFilterLabel() {
  if (bomCommonOwnershipFilter.value === 'PRIVATE') {
    return '客户私有';
  }
  if (bomCommonOwnershipFilter.value === 'SELECTED') {
    return '指定客户可用';
  }
  if (bomCommonOwnershipFilter.value === 'ALL_CUSTOMER') {
    return '全部客户机型通用';
  }
  return '全部归属';
}

function customerBomCommonCustomerText(row: ModelBom) {
  if (row.customerId || row.customerScopeMode === 'PRIVATE') {
    return row.customerName || bomCommonCustomer.value?.customerName || '客户私有';
  }
  if (row.customerScopeMode === 'SELECTED') {
    return formatCustomerNamePreview(row.scopeCustomers?.map((customer) => customer.customerName) || [], '指定客户', row.scopeCustomerCount);
  }
  return '全部客户';
}

function customerBomCommonScopePreview(row: ModelBom) {
  return `${customerBomOwnershipLabel(row)} / ${row.projectModel || '全部机型/项目'}`;
}

function customerBomCommonScopeTitle(row: ModelBom) {
  return [
    `适用范围：${customerBomCommonScopePreview(row)}`,
    `适用客户：${customerBomCommonCustomerText(row)}`,
    `机型 / 项目：${row.projectModel || '全部机型/项目'}`,
    '客户页只显示摘要，需要完整范围时进入 BOM 详情核对；不会修改 BOM 明细、订单、生产任务或库存'
  ].join('。');
}

function formatCustomerNamePreview(names: Array<string | null | undefined>, emptyText = '-', totalCount?: number) {
  const filtered = names.map((name) => String(name || '').trim()).filter(Boolean);
  if (filtered.length === 0) {
    return emptyText;
  }
  const preview = filtered.filter((_, index) => index < 3).join('、');
  const total = typeof totalCount === 'number' && totalCount > filtered.length ? totalCount : filtered.length;
  return total > 3 ? `${preview} 等 ${total} 个客户` : preview;
}

function customerBomCommonKeywordMatches(row: ModelBom, keywordText: string) {
  if (!keywordText) {
    return true;
  }
  const scopeCustomerText = (row.scopeCustomers || [])
    .map((customer) => `${customer.customerCode || ''} ${customer.customerName}`)
    .join(' ');
  // 客户常用 BOM 弹窗只做本地过滤，不改变后端适用范围；用于快速核对 BOM 是否客户私有、指定客户可用或机型通用。
  return [
    row.bomName,
    row.scopeLabel,
    row.scopeTypeLabel,
    row.projectModel,
    row.customerCode,
    row.customerName,
    scopeCustomerText,
    customerBomOwnershipLabel(row),
    row.isCommon ? '常用' : '普通可用'
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(keywordText));
}

function customerBomCommonScopeKey(row: ModelBom) {
  return `${row.customerScopeKey || row.customerId || 'ALL'}::${row.projectModelScopeKey || row.projectModel || 'ALL'}`;
}

function customerBomCommonDragRowsForScope(row: ModelBom) {
  const scopeKey = customerBomCommonScopeKey(row);
  return customerBomCommonRows.value
    .filter((item) => item.status === 'ENABLED' && item.isCommon && customerBomCommonScopeKey(item) === scopeKey)
    .sort(
      (left, right) =>
        (left.commonSortOrder || Number.MAX_SAFE_INTEGER) - (right.commonSortOrder || Number.MAX_SAFE_INTEGER) ||
        left.bomName.localeCompare(right.bomName)
    );
}

function customerBomCommonDisplayOrder(row: ModelBom) {
  if (row.status !== 'ENABLED' || !row.isCommon) {
    return '-';
  }
  const index = customerBomCommonDragRowsForScope(row).findIndex((item) => item.id === row.id);
  return index >= 0 ? index + 1 : '-';
}

function canDragCustomerCommonBom(row: ModelBom) {
  return (
    row.status === 'ENABLED' &&
    row.isCommon &&
    !isMobileLayout.value &&
    !bomCommonKeyword.value.trim() &&
    !bomCommonBusy.value &&
    customerBomCommonDragRowsForScope(row).length > 1
  );
}

function customerBomCommonDragTitle(row: ModelBom) {
  if (row.status === 'DISABLED') {
    return '停用 BOM 不参与常用排序，请先恢复启用';
  }
  if (!row.isCommon) {
    return '只有已设常用的 BOM 可以拖拽排序';
  }
  if (bomCommonKeyword.value.trim()) {
    return '请先清空搜索关键字，再拖拽调整完整常用顺序';
  }
  return customerBomCommonDragRowsForScope(row).length > 1
    ? '拖拽调整同一客户范围和同一机型范围内的常用 BOM 顺序'
    : '当前适用范围只有 1 个常用 BOM';
}

function startCustomerCommonBomDrag(event: DragEvent, row: ModelBom) {
  if (!canDragCustomerCommonBom(row)) {
    event.preventDefault();
    return;
  }
  draggedCustomerCommonBomId.value = row.id;
  draggedCustomerCommonBomScopeKey.value = customerBomCommonScopeKey(row);
  draggedCustomerCommonBomOverId.value = row.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.id);
  }
}

function handleCustomerCommonBomDragOver(event: DragEvent, row: ModelBom) {
  if (
    bomCommonBusy.value ||
    !draggedCustomerCommonBomId.value ||
    row.status !== 'ENABLED' ||
    !row.isCommon ||
    customerBomCommonScopeKey(row) !== draggedCustomerCommonBomScopeKey.value
  ) {
    return;
  }
  draggedCustomerCommonBomOverId.value = row.id;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

async function dropCustomerCommonBom(row: ModelBom) {
  if (bomCommonBusy.value) {
    endCustomerCommonBomDrag();
    return;
  }
  const sourceId = draggedCustomerCommonBomId.value;
  const sourceScopeKey = draggedCustomerCommonBomScopeKey.value;
  endCustomerCommonBomDrag();
  if (!sourceId || row.status !== 'ENABLED' || !row.isCommon || sourceId === row.id) {
    return;
  }
  if (customerBomCommonScopeKey(row) !== sourceScopeKey) {
    ElMessage.warning('客户常用 BOM 只能在同一客户范围和同一机型/项目范围内拖拽排序');
    return;
  }
  const orderedRows = [...customerBomCommonDragRowsForScope(row)];
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
  bomCommonDragSaving.value = true;
  try {
    // 客户页只调整常用 BOM 显示顺序；不会修改 BOM 明细、适用范围、订单、生产任务或库存。
    await erpApi.reorderModelBomCommon({
      items: orderedRows.map((item, index) => ({ bomId: item.id, commonSortOrder: index + 1 }))
    });
    ElMessage.success('客户常用 BOM 顺序已保存');
    await loadCustomerCommonRows();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户常用 BOM 排序保存失败，请确认后端服务');
  } finally {
    bomCommonDragSaving.value = false;
  }
}

function openCustomerBomCommonTextDialog() {
  if (!customerBomCommonFixedText.value) {
    ElMessage.warning('暂无可查看的客户常用 BOM 清单');
    return;
  }
  customerBomCommonTextDialogVisible.value = true;
}

async function copyCustomerBomCommonText() {
  if (!customerBomCommonFixedText.value) {
    ElMessage.warning('暂无可复制的客户常用 BOM 清单');
    return;
  }
  try {
    await navigator.clipboard.writeText(customerBomCommonFixedText.value);
    ElMessage.success('客户常用 BOM 固定格式清单已复制');
  } catch {
    ElMessage.error('复制失败，请在浏览器中允许剪贴板权限后重试');
  }
}

function customerBomCommonBatchPreviewText(rows: ModelBom[], isCommon: boolean) {
  const actionText = isCommon ? '设为常用' : '取消常用';
  const lines = rows.map((row, index) => {
    const beforeText = row.isCommon ? `常用，顺序 ${customerBomCommonDisplayOrder(row)}` : '普通可用';
    const afterText = isCommon ? '常用，顺序由后端重新计算' : '普通可用';
    return `${index + 1}. ${row.bomName} | ${customerBomOwnershipLabel(row)} | ${row.projectModel || '全部机型/项目'} | ${beforeText} -> ${afterText}`;
  });
  return [
    `变更预览：${actionText} ${rows.length} 个 BOM`,
    ...lines,
    `业务边界：只修改 BOM 常用状态和显示顺序，不修改 BOM 明细、适用范围、订单、生产任务或库存。`
  ].join('\n');
}

async function setFilteredCustomerBomsCommon(isCommon: boolean) {
  if (requireDesktopCustomerMutation('批量设置客户常用 BOM')) {
    return;
  }
  if (bomCommonBusy.value) {
    return;
  }
  const rows = isCommon ? customerBomCommonBatchSetRows.value : customerBomCommonBatchCancelRows.value;
  if (rows.length === 0) {
    ElMessage.warning(isCommon ? '当前筛选结果没有可设为常用的启用 BOM' : '当前筛选结果没有已设常用的 BOM');
    return;
  }
  bomCommonBatchTargetIsCommon.value = isCommon;
  bomCommonBatchRows.value = [...rows];
  bomCommonBatchPreviewText.value = customerBomCommonBatchPreviewText(rows, isCommon);
  bomCommonBatchDialogVisible.value = true;
}

function closeBomCommonBatchDialog() {
  if (bomCommonBatchSaving.value) {
    ElMessage.warning('客户常用 BOM 批量设置正在保存，请等待操作完成');
    return;
  }
  bomCommonBatchDialogVisible.value = false;
  bomCommonBatchRows.value = [];
  bomCommonBatchPreviewText.value = '';
}

function handleBomCommonBatchDialogClose(done: () => void) {
  if (bomCommonBatchSaving.value) {
    ElMessage.warning('客户常用 BOM 批量设置正在保存，请等待操作完成');
    return;
  }
  done();
  bomCommonBatchRows.value = [];
  bomCommonBatchPreviewText.value = '';
}

async function confirmFilteredCustomerBomsCommon() {
  if (bomCommonBatchSaving.value) {
    return;
  }
  const rows = [...bomCommonBatchRows.value];
  if (rows.length === 0) {
    ElMessage.warning('当前没有可批量设置的 BOM');
    closeBomCommonBatchDialog();
    return;
  }
  const isCommon = bomCommonBatchTargetIsCommon.value;
  const actionText = isCommon ? '设为常用' : '取消常用';
  bomCommonBatchSaving.value = true;
  try {
    // 批量常用只提交当前筛选结果的 BOM id；后端事务内保存常用状态和顺序，不自动创建订单、生产任务或库存流水。
    await erpApi.setModelBomsCommonBatch({ bomIds: rows.map((row) => row.id), isCommon });
    ElMessage.success(`已${actionText} ${rows.length} 个 BOM`);
    bomCommonBatchDialogVisible.value = false;
    bomCommonBatchRows.value = [];
    bomCommonBatchPreviewText.value = '';
    await loadCustomerCommonRows();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : `批量${actionText}失败，请确认后端服务`);
  } finally {
    bomCommonBatchSaving.value = false;
  }
}

function endCustomerCommonBomDrag() {
  draggedCustomerCommonBomId.value = '';
  draggedCustomerCommonBomScopeKey.value = '';
  draggedCustomerCommonBomOverId.value = '';
}

function customerBomOwnershipLabel(row: ModelBom) {
  if (row.customerId || row.customerScopeMode === 'PRIVATE') {
    return '客户私有';
  }
  if (row.customerScopeMode === 'SELECTED') {
    return '指定客户可用';
  }
  return row.projectModel ? '全部客户机型通用' : '全部客户泛用';
}

function customerBomOwnershipTagType(row: ModelBom) {
  if (row.customerId || row.customerScopeMode === 'PRIVATE') {
    return 'warning';
  }
  if (row.customerScopeMode === 'SELECTED') {
    return 'primary';
  }
  return 'info';
}

async function loadCustomerCommonRows() {
  const customer = bomCommonCustomer.value;
  if (!customer) {
    return;
  }
  bomCommonLoading.value = true;
  try {
    // 客户页常用设置需要完整的当前客户可见 BOM 来做排序和批量设置；这里显式按页加载并记录总数，不依赖旧全量接口。
    const rows: ModelBom[] = [];
    let offset = 0;
    let totalCount = 0;
    let hasMore = true;
    while (hasMore) {
      const result = await erpApi.modelBomsPage({
        customerId: customer.id,
        excludeGlobalAllProject: true,
        status: 'ALL',
        limit: customerBomCommonPageLimit,
        offset
      });
      rows.push(...result.items);
      totalCount = result.totalCount;
      hasMore = result.hasMore && result.items.length > 0;
      offset = result.offset + result.items.length;
    }
    customerBomCommonRows.value = rows;
    customerBomCommonTotal.value = totalCount;
  } catch (error) {
    customerBomCommonRows.value = [];
    customerBomCommonTotal.value = 0;
    ElMessage.error(error instanceof Error ? error.message : '客户可用 BOM 加载失败，请确认客户筛选和后端服务');
  } finally {
    bomCommonLoading.value = false;
  }
}

async function setCustomerBomCommon(row: ModelBom, isCommon: boolean) {
  if (requireDesktopCustomerMutation('设置客户常用 BOM')) {
    return;
  }
  if (bomCommonBusy.value) {
    return;
  }
  if (isCommon && row.status === 'DISABLED') {
    ElMessage.warning('已停用 BOM 不能设为常用，请先恢复启用');
    return;
  }
  bomCommonSavingId.value = row.id;
  try {
    await erpApi.setModelBomCommon(row.id, isCommon);
    // 常用排序由后端按 BOM 所属范围重新计算；保存后重新加载，避免弹窗里排序号和列表顺序滞后。
    await loadCustomerCommonRows();
    ElMessage.success(isCommon ? '已设为常用 BOM' : '已取消常用 BOM');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户常用 BOM 设置失败');
  } finally {
    bomCommonSavingId.value = '';
  }
}

function openCustomerBomDetail(row: ModelBom) {
  if (bomCommonBusy.value) {
    return;
  }
  bomCommonDialogVisible.value = false;
  router.push({
    path: '/inventory/model-boms',
    query: {
      customerId: bomCommonCustomer.value?.id || row.customerId || undefined,
      excludeGlobalAllProject: 'true',
      status: 'ALL',
      bomId: row.id
    }
  });
}

function openCreate() {
  if (requireDesktopCustomerMutation('新增客户')) {
    return;
  }
  editingId.value = undefined;
  primaryContactIndex.value = undefined;
  applyForm(blankForm());
  clearNameCheck();
  clearCodeCheck();
  void loadNextCustomerCode();
  dialogVisible.value = true;
}

function openEdit(row: Customer) {
  if (requireDesktopCustomerMutation('编辑客户')) {
    return;
  }
  editingId.value = row.id;
  const contacts = row.contacts?.length ? row.contacts.map((contact) => ({ ...contact })) : [blankContact()];
  applyForm({
    customerCode: row.customerCode,
    customerName: row.customerName,
    regionType: row.regionType || 'CHINA',
    country: row.country || '中国',
    province: row.province || '',
    state: row.state || '',
    district: row.district || '',
    city: row.city || '',
    detailAddress: row.detailAddress || '',
    remark: row.remark || '',
    contacts
  });
  const primaryIndex = contacts.findIndex((contact) => contact.isPrimary);
  primaryContactIndex.value = primaryIndex >= 0 ? primaryIndex : undefined;
  clearNameCheck();
  clearCodeCheck();
  nextCustomerCode.value = '';
  dialogVisible.value = true;
}

async function loadNextCustomerCode() {
  try {
    const result = await erpApi.nextCustomerCode();
    nextCustomerCode.value = result.customerCode;
  } catch {
    nextCustomerCode.value = '';
    ElMessage.warning('客户ID自动生成失败，请手工填写客户ID');
  }
}

function handleRegionTypeChange() {
  if (form.regionType === 'CHINA') {
    form.country = '中国';
    form.state = '';
    form.district = '';
  } else {
    form.country = '';
    form.province = '';
    form.city = '';
    form.state = '';
    form.district = '';
  }
}

function handleProvinceChange() {
  form.city = '';
}

function addContact() {
  form.contacts.push(blankContact());
}

function removeContact(index: number) {
  form.contacts.splice(index, 1);
  if (form.contacts.length === 0) {
    form.contacts.push(blankContact());
    primaryContactIndex.value = undefined;
    return;
  }
  if (primaryContactIndex.value === index) {
    primaryContactIndex.value = undefined;
    form.contacts.forEach((contact) => {
      contact.isPrimary = false;
    });
    return;
  }
  if (primaryContactIndex.value !== undefined && primaryContactIndex.value > index) {
    primaryContactIndex.value -= 1;
  }
}

function setPrimaryContact(index: number) {
  primaryContactIndex.value = index;
  form.contacts.forEach((contact, contactIndex) => {
    contact.isPrimary = contactIndex === index;
  });
}

function clearNameCheck() {
  nameAvailable.value = false;
  nameCheckText.value = '';
}

function clearCodeCheck() {
  codeAvailable.value = false;
  codeCheckText.value = '';
}

function clearCheckTimers() {
  if (customerSearchTimer) {
    window.clearTimeout(customerSearchTimer);
    customerSearchTimer = undefined;
  }
  if (nameCheckTimer) {
    window.clearTimeout(nameCheckTimer);
    nameCheckTimer = undefined;
  }
  if (codeCheckTimer) {
    window.clearTimeout(codeCheckTimer);
    codeCheckTimer = undefined;
  }
}

function scheduleNameCheck() {
  clearNameCheck();
  if (nameCheckTimer) {
    window.clearTimeout(nameCheckTimer);
  }
  const customerName = form.customerName.trim();
  if (!customerName) {
    return;
  }
  nameCheckTimer = window.setTimeout(() => {
    void checkCustomerName(true);
  }, 500);
}

function scheduleCodeCheck() {
  clearCodeCheck();
  if (codeCheckTimer) {
    window.clearTimeout(codeCheckTimer);
  }
  const customerCode = form.customerCode?.trim();
  if (!customerCode) {
    codeAvailable.value = true;
    return;
  }
  codeCheckTimer = window.setTimeout(() => {
    void checkCustomerCode(true);
  }, 500);
}

async function checkCustomerName(silent = false) {
  const customerName = form.customerName.trim();
  if (!customerName) {
    if (!silent) {
      ElMessage.warning('请填写客户名称');
    }
    clearNameCheck();
    return false;
  }

  checkingName.value = true;
  try {
    const result = await erpApi.checkCustomerName(customerName, editingId.value);
    nameAvailable.value = result.available;
    nameCheckText.value = result.available ? '客户名称可用' : '客户名称已存在，请修改';
    if (!result.available && !silent) {
      ElMessage.warning('客户名称已存在，请修改');
    }
    return result.available;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户名称查重失败');
    return false;
  } finally {
    checkingName.value = false;
  }
}

async function checkCustomerCode(silent = false) {
  const customerCode = form.customerCode?.trim();
  if (!customerCode) {
    codeAvailable.value = true;
    codeCheckText.value = '';
    return true;
  }

  checkingCode.value = true;
  try {
    const result = await erpApi.checkCustomerCode(customerCode, editingId.value);
    codeAvailable.value = result.available;
    codeCheckText.value = result.available ? '客户ID可用' : '客户ID已存在，请修改';
    if (!result.available && !silent) {
      ElMessage.warning('客户ID已存在，请修改');
    }
    return result.available;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户ID查重失败');
    return false;
  } finally {
    checkingCode.value = false;
  }
}

function validateForm() {
  // 客户资料保存前先做必填校验：客户名称必填；客户ID可手填，留空由后端自动生成。
  if (!form.customerName.trim()) {
    ElMessage.warning('客户名称为必填项');
    return false;
  }
  if (form.regionType === 'CHINA') {
    if (!form.province || !form.city) {
      ElMessage.warning('中国地区必须选择省份和城市');
      return false;
    }
    return validateContacts();
  }
  if (!form.country) {
    ElMessage.warning('国外地区必须选择或填写国家');
    return false;
  }
  return validateContacts();
}

function validateContacts() {
  const incompleteContact = form.contacts.find(
    (contact) =>
      !contact.contactName?.trim() &&
      Boolean(contact.contactPhone?.trim() || contact.title?.trim() || contact.remark?.trim())
  );
  if (incompleteContact) {
    ElMessage.warning('填写联系人电话或职务时，必须填写联系人姓名');
    return false;
  }

  const namedContacts = form.contacts
    .map((contact, index) => ({ contact, index, contactName: contact.contactName?.trim() }))
    .filter((item) => item.contactName);

  if (namedContacts.length === 0) {
    return true;
  }

  const primaryNamedContacts = namedContacts.filter((item) => item.contact.isPrimary);
  if (primaryNamedContacts.length !== 1) {
    ElMessage.warning('有联系人时必须选择一个主要联系人');
    return false;
  }
  return true;
}

function normalizedPayload() {
  // 联系人允许维护多条记录；提交时过滤空姓名，并保留用户明确选择的主要联系人。
  const contacts = form.contacts
    .map((contact) => ({
      contactName: contact.contactName?.trim(),
      contactPhone: contact.contactPhone?.trim(),
      title: contact.title?.trim(),
      remark: contact.remark?.trim(),
      isPrimary: Boolean(contact.isPrimary)
    }))
    .filter((contact) => contact.contactName);

  return {
    customerCode: form.customerCode?.trim() || undefined,
    customerName: form.customerName.trim(),
    regionType: form.regionType,
    country: form.regionType === 'CHINA' ? '中国' : form.country?.trim(),
    province: form.province?.trim() || undefined,
    state: form.regionType === 'OVERSEAS' ? form.state?.trim() : undefined,
    district: form.district?.trim() || undefined,
    city: form.city?.trim() || undefined,
    detailAddress: form.detailAddress?.trim() || undefined,
    remark: form.remark?.trim() || undefined,
    contacts
  };
}

function warnCustomerSavingClose() {
  ElMessage.warning('客户资料正在保存，请等待保存完成');
}

function closeCustomerDialog() {
  if (saving.value) {
    warnCustomerSavingClose();
    return;
  }
  dialogVisible.value = false;
}

function handleCustomerDialogClose(done: () => void) {
  if (saving.value) {
    warnCustomerSavingClose();
    return;
  }
  done();
}

async function save() {
  if (saving.value) {
    return;
  }
  if (!validateForm()) {
    return;
  }
  if (!(await checkCustomerName(true))) {
    return;
  }
  if (!(await checkCustomerCode(true))) {
    return;
  }

  saving.value = true;
  try {
    if (editingId.value) {
      await erpApi.updateCustomer(editingId.value, normalizedPayload());
    } else {
      await erpApi.createCustomer(normalizedPayload());
    }
    ElMessage.success('客户已保存');
    dialogVisible.value = false;
    await loadCustomers();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户保存失败');
  } finally {
    saving.value = false;
  }
}

function openStatusDialog(row: Customer) {
  if (requireDesktopCustomerMutation(row.status === 'ENABLED' ? '停用客户' : '启用客户')) {
    return;
  }
  statusCustomer.value = row;
  statusDialogVisible.value = true;
}

function requireDesktopCustomerMutation(actionLabel: string) {
  if (!isMobileLayout.value) {
    return false;
  }
  ElMessage.warning(`手机端仅查看客户资料，${actionLabel}请在电脑端操作`);
  return true;
}

async function confirmStatusChange() {
  if (!statusCustomer.value) {
    return;
  }
  if (statusConfirmDisabled.value) {
    ElMessage.warning('请先编辑客户并设置一个主要联系人');
    return;
  }

  statusSaving.value = true;
  try {
    await erpApi.updateCustomerStatus(statusCustomer.value.id, nextCustomerStatus.value);
    ElMessage.success(`客户已${statusActionText.value}`);
    statusDialogVisible.value = false;
    statusCustomer.value = undefined;
    await loadCustomers();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户状态修改失败');
  } finally {
    statusSaving.value = false;
  }
}

function formatRegion(row: Customer) {
  if (row.regionType === 'OVERSEAS') {
    return [row.country, row.state, row.province, row.district, row.city].filter(Boolean).join(' / ') || '-';
  }
  return [row.country || '中国', row.province, row.city, row.district].filter(Boolean).join(' / ');
}

function primaryContactText(row: Customer) {
  const contact = row.contacts?.find((item) => item.isPrimary && item.contactName?.trim()) || row.contacts?.[0];
  if (!contact?.contactName) {
    return '无联系人';
  }
  return [contact.contactName, contact.contactPhone].filter(Boolean).join(' / ');
}

function isMobileCustomerExpanded(id: string) {
  return expandedMobileCustomerIds.value.includes(id);
}

function toggleMobileCustomerCard(id: string) {
  expandedMobileCustomerIds.value = isMobileCustomerExpanded(id)
    ? expandedMobileCustomerIds.value.filter((item) => item !== id)
    : [...expandedMobileCustomerIds.value, id];
}

onMounted(() => {
  restoreCustomerWorkTableHeights();
  void refreshCustomersPage();
});
watch(
  () => [customerWorkTableHeights.customers, customerWorkTableHeights.commonBoms],
  () => saveCustomerWorkTableHeights()
);
onBeforeUnmount(clearCheckTimers);
</script>

<style scoped>
.customer-bom-guide {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: -6px 0 14px;
  color: #475569;
  font-size: 13px;
  line-height: 1.45;
}

.customer-bom-guide > span {
  font-weight: 700;
  color: #334155;
}

.customer-bom-guide strong {
  padding: 5px 8px;
  color: #0f172a;
  font-weight: 600;
  background: #fff;
  border: 1px solid #dbe4ef;
  border-radius: 6px;
}

.customer-bom-guide small {
  flex: 1 1 100%;
  color: #64748b;
}

.table-pagination-row,
.mobile-pagination-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 0;
  color: #64748b;
  font-size: 13px;
}

.mobile-pagination-row {
  flex-direction: column;
  align-items: stretch;
}

.customer-table-height-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.customer-table-height-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.customer-table-height-label {
  color: #64748b;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
}

.customer-row-actions {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.customer-row-action-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px 8px;
  min-width: 0;
}

.customer-row-action-label {
  flex: 0 0 30px;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 700;
}

.customer-row-actions :deep(.el-button) {
  height: auto;
  margin-left: 0;
  padding: 0;
}

.customer-common-bom-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.customer-common-bom-note {
  margin: 0;
  padding: 10px 12px;
  color: #475569;
  background: #f8fafc;
  border: 1px solid #dbe4ef;
  border-radius: 6px;
  line-height: 1.6;
}

.customer-common-bom-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.customer-common-bom-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.customer-common-bom-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.customer-common-bom-filter {
  max-width: 520px;
}

.customer-common-bom-load-summary {
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.customer-common-bom-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  color: #475569;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: grab;
  font-size: 16px;
  line-height: 1;
}

.customer-common-bom-drag-handle:active {
  cursor: grabbing;
}

.customer-common-bom-drag-handle.is-drop-target {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
}

.customer-common-bom-drag-handle.is-disabled {
  color: #94a3b8;
  background: #f8fafc;
  cursor: not-allowed;
}

.customer-common-bom-sort-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: #475569;
  font-size: 13px;
  white-space: nowrap;
}

.customer-common-bom-actions {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.customer-common-bom-action-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px 8px;
  min-width: 0;
}

.customer-common-bom-action-label {
  flex: 0 0 32px;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 700;
}

.customer-common-bom-actions :deep(.el-button) {
  height: auto;
  margin-left: 0;
  padding: 0;
}

.cell-subtext {
  color: #64748b;
  font-size: 12px;
}

.fixed-format-textarea :deep(textarea) {
  font-family: Consolas, 'Courier New', monospace;
  white-space: pre;
}

.customer-common-bom-batch-preview {
  display: grid;
  gap: 10px;
  color: #475569;
  font-size: 14px;
  line-height: 1.6;
}

.customer-common-bom-batch-preview p {
  margin: 0;
}

.customer-common-bom-batch-preview strong {
  color: #0f172a;
}

.customer-common-bom-batch-scope {
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.customer-common-bom-batch-boundary {
  color: #b45309;
}

.bom-scope-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.bom-scope-cell strong,
.bom-scope-cell small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bom-scope-cell small {
  color: #64748b;
}

.customer-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 8px 14px;
}

.check-field {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.check-field .el-input {
  flex: 1;
}

.check-loading {
  flex: 0 0 auto;
  color: #64748b;
  font-size: 12px;
}

.field-hint {
  width: 100%;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 18px;
}

.check-message {
  width: 100%;
  margin-top: 6px;
  font-size: 12px;
}

.check-message.available {
  color: #16a34a;
}

.check-message.duplicated {
  color: #dc2626;
}

.form-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 10px 0 12px;
  color: #0f172a;
  font-weight: 700;
}

.contacts-editor {
  display: grid;
  gap: 10px;
}

.contact-row {
  display: grid;
  grid-template-columns: 86px minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr) 72px;
  gap: 8px;
  align-items: center;
}

.customer-suggestion {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 40px;
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.customer-suggestion-more {
  color: #2563eb;
  font-size: 13px;
  font-weight: 500;
}

:global(.customer-search-popper .el-autocomplete-suggestion__wrap) {
  max-height: 320px;
}

:global(.customer-search-popper .el-autocomplete-suggestion li) {
  height: 44px;
  padding: 0 14px;
  line-height: 44px;
}

.contact-rule {
  font-size: 12px;
}

.contact-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.contact-pill {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  padding: 0 8px;
  border-radius: 12px;
  color: #334155;
  background: #f1f5f9;
  font-size: 12px;
}

.mobile-readonly-note {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  color: #64748b;
  font-size: 12px;
}

.status-confirm-panel {
  display: grid;
  gap: 12px;
}

.status-confirm-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  margin: 0;
}

.status-confirm-label {
  color: #64748b;
  font-size: 13px;
}

.status-confirm-panel strong {
  min-width: 0;
  color: #0f172a;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.status-confirm-warning {
  display: block;
  padding: 10px 12px;
  border: 1px solid #fde68a;
  border-radius: 8px;
  color: #92400e;
  background: #fffbeb;
  font-size: 13px;
  line-height: 20px;
}

@media (max-width: 900px) {
  .customer-form-grid {
    grid-template-columns: 1fr;
  }

  .check-field {
    flex-direction: column;
    align-items: stretch;
  }

  .form-section-title {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .form-section-title .el-button {
    width: 100%;
  }

  .contact-row {
    grid-template-columns: 1fr;
  }

  .customer-suggestion {
    height: auto;
    min-height: 40px;
    line-height: 20px;
    white-space: normal;
  }

  .status-confirm-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
