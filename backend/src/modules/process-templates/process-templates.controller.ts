import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { CreateProcessTemplateDto, ProcessTemplateQueryDto, UpdateProcessTemplateDto } from './dto';
import { ProcessTemplatesService } from './process-templates.service';

@Controller('process-templates')
export class ProcessTemplatesController {
  constructor(private readonly processTemplatesService: ProcessTemplatesService) {}

  @Get()
  findAll(@Query() query: ProcessTemplateQueryDto) {
    return this.processTemplatesService.findAll({ ...query, withPage: 'true' });
  }

  @Get('export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="process-templates-export.xlsx"')
  async exportTemplates(@Query() query: ProcessTemplateQueryDto) {
    return new StreamableFile(await this.processTemplatesService.buildProcessTemplatesExport(query));
  }

  @Post()
  create(@Body() dto: CreateProcessTemplateDto) {
    return this.processTemplatesService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProcessTemplateDto) {
    return this.processTemplatesService.update(id, dto);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.processTemplatesService.restore(id);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.processTemplatesService.delete(id);
  }
}
