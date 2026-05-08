import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateProcessDefinitionDto, ProcessDefinitionQueryDto, UpdateProcessDefinitionDto } from './dto';
import { ProcessDefinitionsService } from './process-definitions.service';

@Controller('process-definitions')
export class ProcessDefinitionsController {
  constructor(private readonly processDefinitionsService: ProcessDefinitionsService) {}

  @Get()
  findAll(@Query() query: ProcessDefinitionQueryDto) {
    return this.processDefinitionsService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateProcessDefinitionDto) {
    return this.processDefinitionsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProcessDefinitionDto) {
    return this.processDefinitionsService.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.processDefinitionsService.delete(id);
  }
}
