<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">流程记忆</h2>
    </div>

    <div class="process-template-page-grid">
      <section class="process-template-page-section">
        <ProcessDefinitionManager
          title="标准工序管理"
          :hint="isMobileLayout ? '手机端只查看标准工序；新建、编辑和删除请在电脑端操作。' : '这里维护可选工序，例如喷涂、抛丸、抛光；重复工序名称会被系统拦截。'"
          :read-only="isMobileLayout"
          :show-status-filter="true"
          @updated="templateManagerKey += 1"
        />
      </section>

      <section class="process-template-page-section">
        <ProcessTemplateManager
          :key="templateManagerKey"
          title="流程记忆管理"
          :hint="isMobileLayout ? '手机端只查看流程记忆；新建、编辑、复制和停用请在电脑端操作。' : '这里创建的流程模板不绑定客户、订单或零件号，可在每个订单零件的生产流程中直接搜索和套用。'"
          :read-only="isMobileLayout"
          :show-status-filter="true"
          @process-definition-updated="templateManagerKey += 1"
        />
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ProcessDefinitionManager from '../components/ProcessDefinitionManager.vue';
import ProcessTemplateManager from '../components/ProcessTemplateManager.vue';
import { useDeviceProfile } from '../composables/useDeviceProfile';

const templateManagerKey = ref(0);
const { isMobileLayout } = useDeviceProfile();
</script>

<style scoped>
.process-template-page-grid {
  display: grid;
  gap: 22px;
  align-items: start;
}

.process-template-page-section {
  min-width: 0;
}

@media (max-width: 900px) {
  .process-template-page-grid {
    gap: 16px;
  }
}
</style>
