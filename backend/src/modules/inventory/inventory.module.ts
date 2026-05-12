import { Module } from '@nestjs/common';
import { ProcessDefinitionsModule } from '../process-definitions/process-definitions.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [ProcessDefinitionsModule],
  controllers: [InventoryController],
  providers: [InventoryService]
})
export class InventoryModule {}
