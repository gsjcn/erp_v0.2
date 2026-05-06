<template>
  <RouterLink v-if="orderNo" class="order-no-link" :to="detailPath">
    {{ orderNo }}
  </RouterLink>
  <span v-else class="muted">-</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  orderNo?: string | null;
}>();

const detailPath = computed(() => `/orders/${encodeURIComponent(props.orderNo || '')}`);
</script>

<style scoped>
.order-no-link {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  color: #2563eb;
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px solid transparent;
}

.order-no-link:hover {
  border-bottom-color: currentColor;
}
</style>
