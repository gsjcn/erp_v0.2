<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">客户资料</h2>
      <el-button type="primary" @click="openCreate">新增客户</el-button>
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
          @keyup.enter="loadCustomers"
        >
          <template #default="{ item }">
            <div class="customer-suggestion">
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
      <el-button type="primary" :loading="loading" @click="loadCustomers">搜索</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <div class="table-card desktop-table">
      <el-table v-loading="loading" :data="customers" max-height="calc(100vh - 250px)">
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
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link @click="openStatusDialog(row)">{{ row.status === 'ENABLED' ? '停用' : '启用' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-loading="loading" class="mobile-card-list">
      <article v-for="customer in customers" :key="customer.id" class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">
            <strong>{{ customer.customerName }}</strong>
            <small>{{ customer.customerCode }}</small>
          </div>
        </div>
        <div class="mobile-card-fields">
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
          <el-button link type="primary" @click="openEdit(customer)">编辑</el-button>
          <el-button link @click="openStatusDialog(customer)">{{ customer.status === 'ENABLED' ? '停用' : '启用' }}</el-button>
        </div>
      </article>
      <div v-if="!customers.length && !loading" class="mobile-empty">暂无客户资料</div>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑客户' : '新增客户'" width="min(860px, calc(100vw - 32px))">
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
              <el-radio-button label="CHINA">中国</el-radio-button>
              <el-radio-button label="OVERSEAS">国外</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <template v-if="form.regionType === 'CHINA'">
            <el-form-item label="省份" required>
              <el-select v-model="form.province" filterable placeholder="选择省份" @change="handleProvinceChange">
                <el-option v-for="item in chinaRegions" :key="item.province" :label="item.province" :value="item.province" />
              </el-select>
            </el-form-item>
            <el-form-item label="城市" required>
              <el-select v-model="form.city" filterable allow-create default-first-option placeholder="选择或输入城市">
                <el-option v-for="city in cityOptions" :key="city" :label="city" :value="city" />
              </el-select>
            </el-form-item>
          </template>

          <template v-else>
            <el-form-item label="国家" required>
              <el-select v-model="form.country" filterable allow-create default-first-option placeholder="选择或输入国家">
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
            <el-radio :model-value="primaryContactIndex" :label="index" @change="setPrimaryContact(index)">主要</el-radio>
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
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
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
          @click="confirmStatusChange"
        >
          确认{{ statusActionText }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { erpApi } from '../api/erp';
import StatusTag from '../components/StatusTag.vue';
import { chinaRegions, worldCountryOptions } from '../config/regions';
import type { CommonStatus, Customer, CustomerContact, CustomerRegionType } from '../types/erp';

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

type CustomerSearchSuggestion = Customer;

const customers = ref<Customer[]>([]);
const keyword = ref('');
const statusFilter = ref<CommonStatus>();
const loading = ref(false);
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
let nameCheckTimer: ReturnType<typeof window.setTimeout> | undefined;
let codeCheckTimer: ReturnType<typeof window.setTimeout> | undefined;
let customerSearchTimer: ReturnType<typeof window.setTimeout> | undefined;
let customerSuggestionSequence = 0;

const form = reactive<CustomerForm>(blankForm());

const cityOptions = computed(() => chinaRegions.find((item) => item.province === form.province)?.cities || []);
const statusActionText = computed(() => (statusCustomer.value?.status === 'ENABLED' ? '停用' : '启用'));
const nextCustomerStatus = computed<CommonStatus>(() => (statusCustomer.value?.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'));
const statusDialogTitle = computed(() => `${statusActionText.value}客户`);
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

watch([keyword, statusFilter], () => {
  if (customerSearchTimer) {
    window.clearTimeout(customerSearchTimer);
  }
  customerSearchTimer = window.setTimeout(() => {
    void loadCustomers();
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
    customers.value = await erpApi.customers(keyword.value, statusFilter.value);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '客户资料加载失败');
  } finally {
    loading.value = false;
  }
}

function reset() {
  keyword.value = '';
  statusFilter.value = undefined;
  void loadCustomers();
}

async function queryCustomerSuggestions(queryString: string, callback: (items: CustomerSearchSuggestion[]) => void) {
  const requestId = ++customerSuggestionSequence;
  callback([]);
  try {
    const result = await erpApi.customers(queryString, statusFilter.value);
    if (requestId === customerSuggestionSequence) {
      callback(result);
    }
  } catch {
    if (requestId === customerSuggestionSequence) {
      callback([]);
    }
  }
}

function handleCustomerSuggestionSelect(customer: CustomerSearchSuggestion) {
  keyword.value = customer.customerName;
  void loadCustomers();
}

function openCreate() {
  editingId.value = undefined;
  primaryContactIndex.value = undefined;
  applyForm(blankForm());
  clearNameCheck();
  clearCodeCheck();
  void loadNextCustomerCode();
  dialogVisible.value = true;
}

function openEdit(row: Customer) {
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

async function save() {
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
  statusCustomer.value = row;
  statusDialogVisible.value = true;
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

onMounted(loadCustomers);
onBeforeUnmount(clearCheckTimers);
</script>

<style scoped>
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
