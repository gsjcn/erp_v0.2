import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/orders' },
    { path: '/customers', component: () => import('./views/CustomersView.vue'), meta: { title: '客户页面' } },
    { path: '/materials', component: () => import('./views/MaterialsManagementView.vue'), meta: { title: '零件管理' } },
    { path: '/orders', component: () => import('./views/OrdersListView.vue'), meta: { title: '订单总列表' } },
    { path: '/orders/:orderNo', component: () => import('./views/OrderDetailView.vue'), meta: { title: '订单明细' } },
    { path: '/processes', component: () => import('./views/ProcessSelectionView.vue'), meta: { title: '零件生产流程选择' } },
    { path: '/process-templates', component: () => import('./views/ProcessTemplatesView.vue'), meta: { title: '流程记忆' } },
    { path: '/production', component: () => import('./views/ProductionView.vue'), meta: { title: '生产页面' } },
    { path: '/notices', component: () => import('./views/AdminNoticesView.vue'), meta: { title: '通知中心' } },
    { path: '/statistics', component: () => import('./views/StatisticsView.vue'), meta: { title: '统计表' } },
    { path: '/warehouses', alias: '/warehouse', component: () => import('./views/WarehouseView.vue'), meta: { title: '仓库页面' } },
    { path: '/inventory/materials', component: () => import('./views/MaterialsView.vue'), meta: { title: '零件基础库' } },
    { path: '/inventory/model-boms', component: () => import('./views/ModelBomsView.vue'), meta: { title: '机型零件包' } },
    { path: '/inventory/material-transforms', component: () => import('./views/MaterialTransformsView.vue'), meta: { title: '来源加工关系' } },
    { path: '/inventory', component: () => import('./views/InventoryView.vue'), meta: { title: '库存界面' } }
  ]
});
