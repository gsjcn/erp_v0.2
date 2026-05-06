import type { Component } from 'vue';
import { Box, Cpu, DataAnalysis, Files, Goods, Tickets, User } from '@element-plus/icons-vue';

export interface NavigationItem {
  label: string;
  path: string;
  icon: Component;
}

export const navItems: NavigationItem[] = [
  { label: '客户', path: '/customers', icon: User },
  { label: '订单', path: '/orders', icon: Tickets },
  { label: '生产流程', path: '/processes', icon: Files },
  { label: '生产', path: '/production', icon: Cpu },
  { label: '统计', path: '/statistics', icon: DataAnalysis },
  { label: '仓库', path: '/warehouses', icon: Box },
  { label: '库存', path: '/inventory', icon: Goods }
];
