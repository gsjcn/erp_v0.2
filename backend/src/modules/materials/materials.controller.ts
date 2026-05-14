import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { MaterialDashboardQueryDto, MaterialProjectOptionsQueryDto, SaveCommonProjectModelsDto } from './dto';
import { MaterialsService } from './materials.service';

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get('dashboard')
  dashboard(@Query() query: MaterialDashboardQueryDto) {
    return this.materialsService.dashboard(query);
  }

  @Get('project-models')
  projectModels(@Query() query: MaterialProjectOptionsQueryDto) {
    return this.materialsService.projectModels(query);
  }

  @Get('common-project-models')
  commonProjectModels() {
    return this.materialsService.commonProjectModels();
  }

  @Patch('common-project-models')
  saveCommonProjectModels(@Body() dto: SaveCommonProjectModelsDto) {
    return this.materialsService.saveCommonProjectModels(dto);
  }
}
