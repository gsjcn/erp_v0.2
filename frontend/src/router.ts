import { createRouter, createWebHistory } from 'vue-router';
import CustomersView from './views/CustomersView.vue';
import InventoryView from './views/InventoryView.vue';
import OrderDetailView from './views/OrderDetailView.vue';
import OrdersListView from './views/OrdersListView.vue';
import ProcessSelectionView from './views/ProcessSelectionView.vue';
import ProductionView from './views/ProductionView.vue';
import StatisticsView from './views/StatisticsView.vue';
import WarehouseView from './views/WarehouseView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/orders' },
    { path: '/customers', component: CustomersView, meta: { title: '客户页面' } },
    { path: '/orders', component: OrdersListView, meta: { title: '订单总列表' } },
    { path: '/orders/:orderNo', component: OrderDetailView, meta: { title: '订单明细' } },
    { path: '/processes', component: ProcessSelectionView, meta: { title: '零件生产流程选择' } },
    { path: '/production', component: ProductionView, meta: { title: '生产页面' } },
    { path: '/statistics', component: StatisticsView, meta: { title: '统计表' } },
    { path: '/warehouses', component: WarehouseView, meta: { title: '仓库页面' } },
    { path: '/inventory', component: InventoryView, meta: { title: '库存界面' } }
  ]
});
