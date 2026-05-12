import { Controller, Get, Query } from '@nestjs/common';
import { MaterialDashboardQueryDto, MaterialProjectOptionsQueryDto } from './dto';
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
}
