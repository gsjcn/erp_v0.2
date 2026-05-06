import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CompleteProductionDto, ProductionAnnualSummaryQueryDto, ProductionTaskQueryDto } from './dto';
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

  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.productionService.start(id);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteProductionDto) {
    return this.productionService.complete(id, dto);
  }
}
