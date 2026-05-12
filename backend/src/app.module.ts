import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CustomersModule } from './modules/customers/customers.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ProcessDefinitionsModule } from './modules/process-definitions/process-definitions.module';
import { ProcessTemplatesModule } from './modules/process-templates/process-templates.module';
import { ProductionModule } from './modules/production/production.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';

@Module({
  imports: [
    PrismaModule,
    CustomersModule,
    OrdersModule,
    ProcessDefinitionsModule,
    ProcessTemplatesModule,
    ProductionModule,
    StatisticsModule,
    WarehousesModule,
    MaterialsModule,
    InventoryModule
  ],
  controllers: [HealthController],
  providers: []
})
export class AppModule {}
