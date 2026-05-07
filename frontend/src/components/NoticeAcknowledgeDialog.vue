<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="min(520px, calc(100vw - 32px))"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
    @closed="resetForm"
  >
    <div class="notice-acknowledge">
      <div class="notice-summary">
        <strong>{{ noticeTitle || '-' }}</strong>
        <p>{{ noticeReason || '-' }}</p>
        <small v-if="createdAtText">{{ createdAtText }}</small>
      </div>

      <el-form label-width="112px">
        <el-form-item :label="nameLabel" required>
          <el-input
            v-model="acknowledgedBy"
            maxlength="30"
            show-word-limit
            :placeholder="namePlaceholder"
            @keyup.enter="submit"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button :disabled="loading" @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="loading" @click="submit">{{ confirmText }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title?: string;
    noticeTitle?: string;
    noticeReason?: string;
    createdAtText?: string;
    loading?: boolean;
    nameLabel?: string;
    namePlaceholder?: string;
    confirmText?: string;
  }>(),
  {
    title: '确认通知',
    noticeTitle: '',
    noticeReason: '',
    createdAtText: '',
    loading: false,
    nameLabel: '确认人员',
    namePlaceholder: '请输入确认人员姓名',
    confirmText: '确认已知晓'
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [acknowledgedBy: string];
}>();

const acknowledgedBy = ref('');

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      acknowledgedBy.value = '';
    }
  }
);

function resetForm() {
  acknowledgedBy.value = '';
}

function submit() {
  const name = acknowledgedBy.value.trim();
  if (!name) {
    ElMessage.warning(`请输入${props.nameLabel}`);
    return;
  }
  emit('confirm', name);
}
</script>

<style scoped>
.notice-acknowledge {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.notice-summary {
  padding: 14px 16px;
  border: 1px solid #dbe3f0;
  border-radius: 8px;
  background: #f8fbff;
}

.notice-summary strong {
  display: block;
  color: #0f172a;
  font-size: 16px;
  line-height: 1.5;
}

.notice-summary p {
  margin: 8px 0;
  color: #334155;
  line-height: 1.6;
}

.notice-summary small {
  color: #64748b;
}

@media (max-width: 900px) {
  .notice-summary {
    padding: 12px;
  }
}
</style>
