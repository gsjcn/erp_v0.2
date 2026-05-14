import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
import {
  CheckCustomerCodeQueryDto,
  CheckCustomerNameQueryDto,
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
  UpdateCustomerStatusDto
} from './dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll(@Query() query: CustomerQueryDto) {
    return this.customersService.findAll(query);
  }

  @Get('check-name')
  checkName(@Query() query: CheckCustomerNameQueryDto) {
    return this.customersService.checkName(query);
  }

  @Get('next-code')
  nextCode() {
    return this.customersService.nextCode();
  }

  @Get('check-code')
  checkCode(@Query() query: CheckCustomerCodeQueryDto) {
    return this.customersService.checkCode(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCustomerStatusDto) {
    return this.customersService.updateStatus(id, dto);
  }
}
