import { Module } from '@nestjs/common';
import { ProcessDefinitionsModule } from '../process-definitions/process-definitions.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [ProcessDefinitionsModule],
  controllers: [OrdersController],
  providers: [OrdersService]
})
export class OrdersModule {}
