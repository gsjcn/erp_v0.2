import { Module } from '@nestjs/common';
import { ProcessDefinitionsModule } from '../process-definitions/process-definitions.module';
import { ProcessTemplatesController } from './process-templates.controller';
import { ProcessTemplatesService } from './process-templates.service';

@Module({
  imports: [ProcessDefinitionsModule],
  controllers: [ProcessTemplatesController],
  providers: [ProcessTemplatesService]
})
export class ProcessTemplatesModule {}
