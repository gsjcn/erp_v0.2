import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { CreateProcessDefinitionDto, ProcessDefinitionQueryDto, UpdateProcessDefinitionDto } from './dto';
import { ProcessDefinitionsService } from './process-definitions.service';

@Controller('process-definitions')
export class ProcessDefinitionsController {
  constructor(private readonly processDefinitionsService: ProcessDefinitionsService) {}

  @Get()
  findAll(@Query() query: ProcessDefinitionQueryDto) {
    return this.processDefinitionsService.findAll({ ...query, withPage: 'true' });
  }

  @Get('export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="process-definitions-export.xlsx"')
  async exportDefinitions(@Query() query: ProcessDefinitionQueryDto) {
    return new StreamableFile(await this.processDefinitionsService.buildProcessDefinitionsExport(query));
  }

  @Post()
  create(@Body() dto: CreateProcessDefinitionDto) {
    return this.processDefinitionsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProcessDefinitionDto) {
    return this.processDefinitionsService.update(id, dto);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.processDefinitionsService.restore(id);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.processDefinitionsService.delete(id);
  }
}
