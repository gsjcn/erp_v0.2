import { Controller, Get, Query } from '@nestjs/common';
import { OrderStatisticsQueryDto } from './dto';
import { StatisticsService } from './statistics.service';

@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('orders')
  orderStatistics(@Query() query: OrderStatisticsQueryDto) {
    return this.statisticsService.orderStatistics(query);
  }
}
