import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { drawingUploadPath } from '../../storage/upload-paths';
import {
  CancelStartedOrderDto,
  CancelOrderDto,
  CancelReplenishmentDto,
  CheckOrderNoQueryDto,
  CreateAdditionalMaterialDto,
  CreateLineReplenishmentDto,
  CreateOrderDto,
  DrawingDuplicateQueryDto,
  NextOrderNoQueryDto,
  OrderQueryDto,
  SubmitOrderDto,
  UpdateLineQuantityDto,
  UpdateLineProcessDto,
  UpdateOrderDto
} from './dto';
import { OrdersService } from './orders.service';

const allowedDrawingExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.dwg', '.dxf']);

function safeDrawingFileName(
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, filename: string) => void
) {
  const extension = extname(file.originalname).toLowerCase();
  const baseName = file.originalname
    .replace(extension, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .slice(0, 60);
  callback(null, `${Date.now()}-${baseName || 'drawing'}${extension}`);
}

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
    return this.ordersService.checkOrderNo(query.orderNo, query.excludeOrderNo);
  }

  @Post('drawings/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: drawingUploadPath(),
        filename: safeDrawingFileName
      }),
      limits: { fileSize: 30 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        const extension = extname(file.originalname).toLowerCase();
        if (!allowedDrawingExtensions.has(extension)) {
          callback(new BadRequestException('图纸文件格式不支持'), false);
          return;
        }
        callback(null, true);
      }
    })
  )
  uploadDrawing(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('必须上传图纸文件');
    }

    return {
      fileName: file.originalname,
      storedFileName: file.filename,
      fileUrl: `/uploads/drawings/${file.filename}`,
      size: file.size,
      mimeType: file.mimetype
    };
  }

  @Get('drawings/duplicate-nos')
  findDuplicateDrawingNos(@Query() query: DrawingDuplicateQueryDto) {
    return this.ordersService.findDuplicateDrawingNos(query.value, query.excludeOrderNo);
  }

  @Get('drawings/duplicate-files')
  findDuplicateDrawingFiles(@Query() query: DrawingDuplicateQueryDto) {
    return this.ordersService.findDuplicateDrawingFiles(query.value, query.excludeOrderNo);
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

  @Post(':orderNo/lines/:lineId/replenishments')
  createLineReplenishment(
    @Param('orderNo') orderNo: string,
    @Param('lineId') lineId: string,
    @Body() dto: CreateLineReplenishmentDto
  ) {
    return this.ordersService.createLineReplenishment(orderNo, lineId, dto);
  }

  @Post(':orderNo/replenishments/:productionTaskNo/cancel')
  cancelReplenishment(
    @Param('orderNo') orderNo: string,
    @Param('productionTaskNo') productionTaskNo: string,
    @Body() dto: CancelReplenishmentDto
  ) {
    return this.ordersService.cancelReplenishment(orderNo, productionTaskNo, dto);
  }

  @Post(':orderNo/lines/additional-materials')
  createAdditionalMaterial(@Param('orderNo') orderNo: string, @Body() dto: CreateAdditionalMaterialDto) {
    return this.ordersService.createAdditionalMaterial(orderNo, dto);
  }

  @Patch(':orderNo/lines/:lineId/quantity-change')
  updateLineQuantityAfterProductionStarted(
    @Param('orderNo') orderNo: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateLineQuantityDto
  ) {
    return this.ordersService.updateLineQuantityAfterProductionStarted(orderNo, lineId, dto);
  }

  @Post(':orderNo/submit')
  submit(@Param('orderNo') orderNo: string, @Body() dto: SubmitOrderDto) {
    return this.ordersService.submit(orderNo, dto);
  }

  @Post(':orderNo/cancel')
  cancelOrder(@Param('orderNo') orderNo: string, @Body() dto: CancelOrderDto) {
    return this.ordersService.cancelOrder(orderNo, dto);
  }

  @Post(':orderNo/cancel-after-production-started')
  cancelAfterProductionStarted(@Param('orderNo') orderNo: string, @Body() dto: CancelStartedOrderDto) {
    return this.ordersService.cancelAfterProductionStarted(orderNo, dto);
  }
}
