import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  AcknowledgeProductionNoticeDto,
  CompleteProcessStepDto,
  CompleteProcessStepsDto,
  CompleteProductionDto,
  ProductionAnnualSummaryQueryDto,
  ProductionNoticeQueryDto,
  ProductionOperatorQueryDto,
  ProductionScrapQueryDto,
  ProductionTaskQueryDto,
  WithdrawProductionTaskDto
} from './dto';
import { ProductionService } from './production.service';

@Controller('production/tasks')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  @Get()
  findTasks(@Query() query: ProductionTaskQueryDto) {
    return this.productionService.findTasks(query);
  }

  @Get('annual-summary')
  annualSummary(@Query() query: ProductionAnnualSummaryQueryDto) {
    return this.productionService.annualSummary(query);
  }

  @Get('operators')
  operators(@Query() query: ProductionOperatorQueryDto) {
    return this.productionService.operators(query);
  }

  @Get('notices')
  notices(@Query() query: ProductionNoticeQueryDto) {
    return this.productionService.notices(query);
  }

  @Post('notices/:id/acknowledge')
  acknowledgeNotice(@Param('id') id: string, @Body() dto: AcknowledgeProductionNoticeDto) {
    return this.productionService.acknowledgeNotice(id, dto);
  }

  @Get('scrap-records')
  scrapRecords(@Query() query: ProductionScrapQueryDto) {
    return this.productionService.scrapRecords(query);
  }

  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.productionService.start(id);
  }

  @Post(':id/withdraw')
  withdraw(@Param('id') id: string, @Body() dto: WithdrawProductionTaskDto) {
    return this.productionService.withdraw(id, dto);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteProductionDto) {
    return this.productionService.complete(id, dto);
  }

  @Post(':id/process-completions')
  completeProcessStep(@Param('id') id: string, @Body() dto: CompleteProcessStepDto) {
    return this.productionService.completeProcessStep(id, dto);
  }

  @Post(':id/process-completions/batch')
  completeProcessSteps(@Param('id') id: string, @Body() dto: CompleteProcessStepsDto) {
    return this.productionService.completeProcessSteps(id, dto);
  }
}
