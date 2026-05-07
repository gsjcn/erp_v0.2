<template>
  <div class="app-shell" :class="shellClass">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-name">百胜 ERP</div>
        <div class="brand-subtitle">第一阶段最小范围</div>
      </div>

      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="scope-note">当前不包含质量 / 追溯 / IATF</div>
    </aside>

    <section class="app-main">
      <header class="mobile-header">
        <div>
          <div class="brand-name">百胜 ERP</div>
          <div class="brand-subtitle">第一阶段最小范围</div>
        </div>
      </header>

      <nav ref="mobileNav" class="mobile-nav-list" aria-label="移动端导航">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="mobile-nav-item">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <header class="topbar">
        <div class="addressbar">
          <el-button
            class="address-back"
            :icon="ArrowLeft"
            :disabled="!parentPath"
            circle
            aria-label="返回上一级"
            @click="goParent"
          />
          <nav class="breadcrumb" aria-label="当前位置">
            <template v-for="(item, index) in breadcrumbs" :key="`${item.path || item.label}-${index}`">
              <RouterLink v-if="item.path" :to="item.path" class="breadcrumb-item">{{ item.label }}</RouterLink>
              <span v-else class="breadcrumb-current">{{ item.label }}</span>
              <span v-if="index < breadcrumbs.length - 1" class="breadcrumb-separator">/</span>
            </template>
          </nav>
        </div>
        <span>TerraMaster F4-424 MAX / PostgreSQL / Docker</span>
      </header>

      <main class="content">
        <RouterView />
      </main>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ArrowLeft } from '@element-plus/icons-vue';
import { useRoute, useRouter } from 'vue-router';
import { useDeviceProfile } from '../composables/useDeviceProfile';
import { navItems } from '../config/navigation';

const route = useRoute();
const router = useRouter();
const { shellClass } = useDeviceProfile();
const mobileNav = ref<HTMLElement>();

interface BreadcrumbItem {
  label: string;
  path?: string;
}

const orderNo = computed(() => String(route.params.orderNo || route.query.orderNo || ''));

const breadcrumbs = computed<BreadcrumbItem[]>(() => {
  if (route.path.startsWith('/orders/') && orderNo.value) {
    return [
      { label: '订单', path: '/orders' },
      { label: orderNo.value },
      { label: '明细' }
    ];
  }

  if (route.path === '/processes' && orderNo.value) {
    return [
      { label: '订单', path: '/orders' },
      { label: orderNo.value, path: `/orders/${encodeURIComponent(orderNo.value)}` },
      { label: '生产流程' }
    ];
  }

  const current = navItems.find((item) => item.path === route.path);
  return [{ label: current?.label || String(route.meta.title || '百胜 ERP') }];
});

const parentPath = computed(() => {
  if (route.path.startsWith('/orders/') && orderNo.value) {
    return '/orders';
  }
  if (route.path === '/processes' && orderNo.value) {
    return `/orders/${encodeURIComponent(orderNo.value)}`;
  }
  return '';
});

function goParent() {
  if (parentPath.value) {
    void router.push(parentPath.value);
  }
}

async function scrollActiveMobileNavIntoView() {
  await nextTick();
  const activeItem = mobileNav.value?.querySelector('.router-link-active');
  // 手机端横向导航较长，切换到后面的栏目时自动把当前栏目滚到可见区域。
  activeItem?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

watch(() => route.path, scrollActiveMobileNavIntoView);
onMounted(scrollActiveMobileNavIntoView);
</script>
