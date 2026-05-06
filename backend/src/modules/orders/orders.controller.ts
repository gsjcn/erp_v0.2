import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CheckOrderNoQueryDto,
  CreateOrderDto,
  NextOrderNoQueryDto,
  OrderQueryDto,
  UpdateLineProcessDto,
  UpdateOrderDto
} from './dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(@Query() query: OrderQueryDto) {
    return this.ordersService.findAll(query);
  }

  @Get('next-no')
  nextOrderNo(@Query() query: NextOrderNoQueryDto) {
    return this.ordersService.nextOrderNo(query);
  }

  @Get('check-no')
  checkOrderNo(@Query() query: CheckOrderNoQueryDto) {
    return this.ordersService.checkOrderNo(query.orderNo);
  }

  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  @Get(':orderNo')
  findOne(@Param('orderNo') orderNo: string) {
    return this.ordersService.findOne(orderNo);
  }

  @Patch(':orderNo')
  update(@Param('orderNo') orderNo: string, @Body() dto: UpdateOrderDto) {
    return this.ordersService.update(orderNo, dto);
  }

  @Patch(':orderNo/lines/:lineId/process')
  updateLineProcess(
    @Param('orderNo') orderNo: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateLineProcessDto
  ) {
    return this.ordersService.updateLineProcess(orderNo, lineId, dto);
  }

  @Post(':orderNo/submit')
  submit(@Param('orderNo') orderNo: string) {
    return this.ordersService.submit(orderNo);
  }
}
