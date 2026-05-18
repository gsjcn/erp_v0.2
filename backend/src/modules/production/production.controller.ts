import { Body, Controller, Get, Header, Param, Post, Query, StreamableFile } from '@nestjs/common';
import {
  AcknowledgeProductionNoticeDto,
  ApproveProductionReplenishmentRequestDto,
  BatchStartProductionDto,
  CompleteProcessStepDto,
  CompleteProcessStepsDto,
  CompleteProductionDto,
  ProductionAnnualSummaryQueryDto,
  ProductionExportQueryDto,
  ProductionNoticeQueryDto,
  ProductionOperatorQueryDto,
  ProductionReplenishmentRequestQueryDto,
  ProductionScrapQueryDto,
  ProductionTaskQueryDto,
  RejectProductionReplenishmentRequestDto,
  StartProductionDto,
  WithdrawProductionTaskDto
} from './dto';
import { ProductionService } from './production.service';

@Controller('production/tasks')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  @Get()
  findTasks(@Query() query: ProductionTaskQueryDto) {
    return this.productionService.findTasks({ ...query, withPage: 'true' });
  }

  @Get('order-summary')
  orderSummary(@Query() query: ProductionTaskQueryDto) {
    return this.productionService.orderSummary({ ...query, withPage: 'true' });
  }

  @Get('annual-summary')
  annualSummary(@Query() query: ProductionAnnualSummaryQueryDto) {
    return this.productionService.annualSummary(query);
  }

  @Get('export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="production-export.xlsx"')
  async exportProduction(@Query() query: ProductionExportQueryDto) {
    return new StreamableFile(await this.productionService.buildProductionExport(query));
  }

  @Get('operators')
  operators(@Query() query: ProductionOperatorQueryDto) {
    return this.productionService.operators(query);
  }

  @Get('notices')
  notices(@Query() query: ProductionNoticeQueryDto) {
    return this.productionService.notices({ ...query, withPage: 'true' });
  }

  @Get('notices/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="production-notices-export.xlsx"')
  async exportNotices(@Query() query: ProductionNoticeQueryDto) {
    return new StreamableFile(await this.productionService.buildProductionNoticesExport(query));
  }

  @Get('notices/admin')
  adminNotices(@Query() query: ProductionNoticeQueryDto) {
    return this.productionService.adminNotices({ ...query, withPage: 'true' });
  }

  @Get('notices/admin/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="admin-notices-export.xlsx"')
  async exportAdminNotices(@Query() query: ProductionNoticeQueryDto) {
    return new StreamableFile(await this.productionService.buildProductionNoticesExport(query, { admin: true }));
  }

  @Post('notices/:id/acknowledge')
  acknowledgeNotice(@Param('id') id: string, @Body() dto: AcknowledgeProductionNoticeDto) {
    return this.productionService.acknowledgeNotice(id, dto);
  }

  @Post('process-completions/:id/replenishment-request/approve')
  approveReplenishmentRequest(@Param('id') id: string, @Body() dto: ApproveProductionReplenishmentRequestDto) {
    return this.productionService.approveReplenishmentRequest(id, dto);
  }

  @Post('process-completions/:id/replenishment-request/reject')
  rejectReplenishmentRequest(@Param('id') id: string, @Body() dto: RejectProductionReplenishmentRequestDto) {
    return this.productionService.rejectReplenishmentRequest(id, dto);
  }

  @Get('replenishment-requests')
  replenishmentRequests(@Query() query: ProductionReplenishmentRequestQueryDto) {
    return this.productionService.replenishmentRequests({ ...query, withPage: 'true' });
  }

  @Get('replenishment-requests/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="production-replenishment-requests-export.xlsx"')
  async exportReplenishmentRequests(@Query() query: ProductionReplenishmentRequestQueryDto) {
    return new StreamableFile(await this.productionService.buildProductionReplenishmentRequestsExport(query));
  }

  @Get('scrap-records')
  scrapRecords(@Query() query: ProductionScrapQueryDto) {
    return this.productionService.scrapRecords({ ...query, withPage: 'true' });
  }

  @Get('scrap-records/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="production-scrap-records-export.xlsx"')
  async exportScrapRecords(@Query() query: ProductionScrapQueryDto) {
    return new StreamableFile(await this.productionService.buildProductionScrapRecordsExport(query));
  }

  @Post('batch-start')
  batchStart(@Body() dto: BatchStartProductionDto) {
    return this.productionService.batchStart(dto);
  }

  @Post(':id/start')
  start(@Param('id') id: string, @Body() dto: StartProductionDto) {
    return this.productionService.start(id, dto);
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
