<template>
  <RouterLink v-if="orderNo" class="order-no-link" :to="detailRoute">
    {{ orderNo }}
  </RouterLink>
  <span v-else class="muted">-</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const props = defineProps<{
  orderNo?: string | null;
  returnTo?: string;
  preserveReturn?: boolean;
}>();

const route = useRoute();

const detailRoute = computed(() => {
  const path = `/orders/${encodeURIComponent(props.orderNo || '')}`;
  const returnTo = normalizeReturnTo(props.returnTo ?? currentReturnToPath.value);
  if (!returnTo || props.preserveReturn === false) {
    return path;
  }
  return {
    path,
    query: { returnTo }
  };
});

const currentReturnToPath = computed(() => {
  // 订单明细页内部再次显示订单号时，不把当前明细页写成返回地址，避免回退循环。
  if (route.path.startsWith('/orders/')) {
    return '/orders';
  }
  return route.fullPath || route.path;
});

function normalizeReturnTo(value: string | undefined) {
  const path = String(value || '').trim();
  // 只允许站内相对路径，避免订单号链接变成外部跳转入口。
  if (!path.startsWith('/') || path.startsWith('//')) {
    return '';
  }
  return path;
}
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
