<template>
  <section class="page">
    <div class="page-header">
      <h2 class="page-title">流程记忆</h2>
    </div>

    <div class="process-template-page-grid">
      <div class="process-template-page-card">
        <ProcessDefinitionManager
          title="标准工序管理"
          hint="这里维护可选工序，例如喷涂、抛丸、抛光；重复工序名称会被系统拦截。"
          @updated="templateManagerKey += 1"
        />
      </div>

      <div class="process-template-page-card">
        <ProcessTemplateManager
          :key="templateManagerKey"
          title="流程记忆管理"
          hint="这里创建的流程模板不绑定客户、订单或零件号，可在每个订单零件的生产流程中直接搜索和套用。"
          @process-definition-updated="templateManagerKey += 1"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ProcessDefinitionManager from '../components/ProcessDefinitionManager.vue';
import ProcessTemplateManager from '../components/ProcessTemplateManager.vue';

const templateManagerKey = ref(0);
</script>

<style scoped>
.process-template-page-grid {
  display: grid;
  gap: 18px;
}

.process-template-page-card {
  padding: 18px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}
</style>
