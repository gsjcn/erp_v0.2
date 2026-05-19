import { Body, Controller, Get, Header, Patch, Query, StreamableFile } from '@nestjs/common';
import { MaterialDashboardQueryDto, MaterialProjectOptionsQueryDto, SaveCommonProjectModelsDto } from './dto';
import { MaterialsService } from './materials.service';

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get('dashboard')
  dashboard(@Query() query: MaterialDashboardQueryDto) {
    return this.materialsService.dashboard(query);
  }

  @Get('dashboard/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="material-dashboard-export.xlsx"')
  async dashboardExport(@Query() query: MaterialDashboardQueryDto) {
    return new StreamableFile(await this.materialsService.buildDashboardExport(query));
  }

  @Get('project-models')
  projectModels(@Query() query: MaterialProjectOptionsQueryDto) {
    return this.materialsService.projectModels(query);
  }

  @Get('common-project-models')
  commonProjectModels(@Query() query: MaterialProjectOptionsQueryDto) {
    return this.materialsService.commonProjectModels(query);
  }

  @Patch('common-project-models')
  saveCommonProjectModels(@Body() dto: SaveCommonProjectModelsDto) {
    return this.materialsService.saveCommonProjectModels(dto);
  }
}
