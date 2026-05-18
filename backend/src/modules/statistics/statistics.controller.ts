import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { OrderStatisticsQueryDto } from './dto';
import { StatisticsService } from './statistics.service';

@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('orders')
  orderStatistics(@Query() query: OrderStatisticsQueryDto) {
    return this.statisticsService.orderStatistics(query);
  }

  @Get('orders/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="order-statistics-export.xlsx"')
  async orderStatisticsExport(@Query() query: OrderStatisticsQueryDto) {
    return new StreamableFile(await this.statisticsService.buildOrderStatisticsExport(query));
  }
}
