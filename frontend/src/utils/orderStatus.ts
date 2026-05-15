import type { OrderDisplayStatus, OrderStatus, ProductionStatus, WarehouseStage } from '../types/erp';

type OrderStatusSource = {
  status: OrderStatus;
  productionStatus?: ProductionStatus;
  warehouseStage?: WarehouseStage;
};

export function orderDisplayStatus(order: OrderStatusSource): OrderDisplayStatus {
  if (order.status === 'DRAFT') {
    return 'ORDER_DRAFT';
  }
  if (order.status === 'CANCELLED') {
    return 'ORDER_CANCELLED';
  }
  if (order.warehouseStage === 'SHIPPED') {
    return 'ORDER_SHIPPED_COMPLETED';
  }
  if (order.warehouseStage === 'PARTIAL_SHIPPED') {
    return 'PARTIAL_SHIPPED';
  }
  if (!order.warehouseStage && order.status === 'COMPLETED') {
    return 'ORDER_SHIPPED_COMPLETED';
  }
  if (
    order.productionStatus === 'COMPLETED' ||
    order.productionStatus === 'STORED' ||
    order.warehouseStage === 'WAITING_RECEIPT' ||
    order.warehouseStage === 'WAITING_SHIPMENT'
  ) {
    return 'ORDER_COMPLETED_UNSHIPPED';
  }
  if (
    order.status === 'IN_PRODUCTION' ||
    order.productionStatus === 'IN_PROGRESS' ||
    order.productionStatus === 'WAITING_CONFIRMATION' ||
    order.warehouseStage === 'IN_PRODUCTION_STAGE'
  ) {
    return 'ORDER_IN_PRODUCTION';
  }
  if (order.status === 'PENDING_PRODUCTION' || order.productionStatus === 'PENDING' || order.warehouseStage === 'WAITING_PRODUCTION') {
    return 'WAITING_PRODUCTION';
  }
  return order.status;
}
