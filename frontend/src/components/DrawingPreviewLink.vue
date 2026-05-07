<template>
  <span v-if="fileUrl" class="drawing-preview-link">
    <el-button link type="primary" class="drawing-preview-button" @click="visible = true">
      {{ linkText || fileName || '查看图纸' }}
    </el-button>

    <el-dialog v-model="visible" :title="title || '产品图纸预览'" width="min(960px, calc(100vw - 32px))">
      <div class="drawing-preview-dialog">
        <div class="drawing-preview-toolbar">
          <strong>{{ fileName || '未记录文件名' }}</strong>
          <a :href="drawingHref" target="_blank" rel="noreferrer">打开图纸</a>
        </div>

        <img v-if="isImageDrawing" class="drawing-preview-media" :src="drawingHref" :alt="fileName || '产品图纸'" />
        <iframe v-else-if="isPdfDrawing" class="drawing-preview-media" :src="drawingHref" title="产品图纸预览" />
        <div v-else class="drawing-preview-empty">
          <strong>当前格式无法直接预览</strong>
          <span>DWG / DXF 等格式需要使用专业图纸软件打开。</span>
          <a :href="drawingHref" target="_blank" rel="noreferrer">打开或下载图纸</a>
        </div>
      </div>
    </el-dialog>
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  fileName?: string;
  fileUrl?: string;
  linkText?: string;
  title?: string;
}>();

const visible = ref(false);
const drawingHref = computed(() => props.fileUrl || '');
const isImageDrawing = computed(() => /\.(png|jpe?g|webp)$/i.test(props.fileUrl || props.fileName || ''));
const isPdfDrawing = computed(() => /\.pdf$/i.test(props.fileUrl || props.fileName || ''));
</script>

<style scoped>
.drawing-preview-link {
  display: inline-flex;
  min-width: 0;
}

.drawing-preview-button {
  max-width: 150px;
  overflow: hidden;
  padding: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawing-preview-dialog {
  display: grid;
  gap: 12px;
}

.drawing-preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  color: #334155;
}

.drawing-preview-toolbar strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawing-preview-toolbar a,
.drawing-preview-empty a {
  color: #2563eb;
  text-decoration: none;
}

.drawing-preview-media,
.drawing-preview-empty {
  width: 100%;
  height: min(70vh, 680px);
  border: 1px solid #d9e2ec;
  border-radius: 8px;
  background: #f8fafc;
}

.drawing-preview-media {
  object-fit: contain;
}

.drawing-preview-empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: #64748b;
  text-align: center;
}

.drawing-preview-empty strong {
  color: #0f172a;
}

@media (max-width: 768px) {
  .drawing-preview-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .drawing-preview-media,
  .drawing-preview-empty {
    height: min(68vh, 520px);
  }
}
</style>
