import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { businessDateTimeKey } from '../../common/business-date';
import { normalizeMultipartFileName } from '../../common/upload-filenames';
import { drawingUploadPath, orderImportUploadPath } from '../../storage/upload-paths';
import {
  CancelStartedOrderDto,
  CancelOrderDto,
  CancelReplenishmentDto,
  CheckOrderNoQueryDto,
  CreateAdditionalMaterialDto,
  CommitOrderImportSessionDto,
  CreateLineReplenishmentDto,
  CreateOrderImportSessionDto,
  GetOrderImportFilePreviewQueryDto,
  GetOrderImportSessionQueryDto,
  ListOrderImportSessionQueryDto,
  CreateOrderDto,
  DrawingDuplicateQueryDto,
  NextOrderNoQueryDto,
  OrderQueryDto,
  ResolveLineShortageDto,
  SubmitOrderDto,
  UpdateLineQuantityDto,
  UpdateLineProcessDto,
  UpdateOrderDto
} from './dto';
import { OrdersService } from './orders.service';

const allowedDrawingExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.dwg', '.dxf']);
const allowedOrderImportExtensions = new Set(['.xlsx']);

function safeDrawingFileName(
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, filename: string) => void
) {
  const originalName = normalizeMultipartFileName(file.originalname);
  const extension = extname(originalName).toLowerCase();
  const baseName = originalName
    .replace(extension, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .substring(0, 60);
  const uniqueSuffix = randomUUID().slice(0, 8);
  // 上传文件名使用公司业务时区时间和短随机后缀，避免 NAS / Docker 默认 UTC 偏差和同秒重名覆盖。
  callback(null, `${businessDateTimeKey()}-${uniqueSuffix}-${baseName || 'drawing'}${extension}`);
}

function safeOrderImportFileName(
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, filename: string) => void
) {
  const originalName = normalizeMultipartFileName(file.originalname);
  const extension = extname(originalName).toLowerCase();
  const baseName = originalName
    .replace(extension, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .substring(0, 80);
  const uniqueSuffix = randomUUID().slice(0, 8);
  // 导入临时文件名只用于追溯和清理，时间戳仍按公司业务时区生成。
  callback(null, `${businessDateTimeKey()}-${uniqueSuffix}-${baseName || 'order-import'}${extension}`);
}

function orderImportUploadMaxBytes() {
  const configuredMb = Number(process.env.ORDER_IMPORT_UPLOAD_MAX_MB || 100);
  const safeMb = Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : 100;
  return safeMb * 1024 * 1024;
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
        const extension = extname(normalizeMultipartFileName(file.originalname)).toLowerCase();
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
      fileName: normalizeMultipartFileName(file.originalname),
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

  @Post('import-sessions')
  createImportSession(@Body() dto: CreateOrderImportSessionDto) {
    return this.ordersService.createImportSession(dto);
  }

  @Get('import-sessions')
  listImportSessions(@Query() query: ListOrderImportSessionQueryDto) {
    return this.ordersService.listImportSessions(query);
  }

  @Get('import-template')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="erp-order-import-template.xlsx"')
  async downloadImportTemplate() {
    return new StreamableFile(await this.ordersService.buildOrderImportTemplate());
  }

  @Get('import-config')
  importConfig() {
    const uploadMaxBytes = orderImportUploadMaxBytes();
    return {
      uploadMaxBytes,
      uploadMaxMb: Math.round((uploadMaxBytes / 1024 / 1024) * 10) / 10,
      allowedExtensions: [...allowedOrderImportExtensions]
    };
  }

  @Get('import-sessions/:sessionId/selectable-order-nos')
  listImportSelectableOrderNos(@Param('sessionId') sessionId: string) {
    return this.ordersService.listImportSelectableOrderNos(sessionId);
  }

  @Get('import-sessions/:sessionId/error-report')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="order-import-issues.xlsx"')
  async downloadImportIssueReport(@Param('sessionId') sessionId: string) {
    return new StreamableFile(await this.ordersService.buildOrderImportIssueReport(sessionId));
  }

  @Get('import-sessions/:sessionId')
  getImportSession(@Param('sessionId') sessionId: string, @Query() query: GetOrderImportSessionQueryDto) {
    return this.ordersService.getImportSession(sessionId, query);
  }

  @Get('import-sessions/:sessionId/files/:fileId/preview')
  importSessionFilePreview(
    @Param('sessionId') sessionId: string,
    @Param('fileId') fileId: string,
    @Query() query: GetOrderImportFilePreviewQueryDto
  ) {
    return this.ordersService.importSessionFilePreview(sessionId, fileId, query);
  }

  @Post('import-sessions/:sessionId/files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: orderImportUploadPath(),
        filename: safeOrderImportFileName
      }),
      limits: { fileSize: orderImportUploadMaxBytes() },
      fileFilter: (_request, file, callback) => {
        const extension = extname(normalizeMultipartFileName(file.originalname)).toLowerCase();
        if (!allowedOrderImportExtensions.has(extension)) {
          callback(new BadRequestException('订单导入只支持 .xlsx 文件'), false);
          return;
        }
        callback(null, true);
      }
    })
  )
  uploadImportFile(@Param('sessionId') sessionId: string, @UploadedFile() file?: Express.Multer.File) {
    return this.ordersService.uploadImportFile(sessionId, file);
  }

  @Post('import-sessions/:sessionId/commit')
  commitImportSession(@Param('sessionId') sessionId: string, @Body() dto: CommitOrderImportSessionDto) {
    return this.ordersService.commitImportSession(sessionId, dto);
  }

  @Delete('import-sessions/:sessionId/files/:fileId')
  deleteImportFile(@Param('sessionId') sessionId: string, @Param('fileId') fileId: string) {
    return this.ordersService.deleteImportFile(sessionId, fileId);
  }

  @Delete('import-sessions/:sessionId')
  discardImportSession(@Param('sessionId') sessionId: string) {
    return this.ordersService.discardImportSession(sessionId);
  }

  @Get(':orderNo/import-source-files/:fileId/preview')
  importSourceFilePreview(
    @Param('orderNo') orderNo: string,
    @Param('fileId') fileId: string,
    @Query() query: GetOrderImportFilePreviewQueryDto
  ) {
    return this.ordersService.importSourceFilePreview(orderNo, fileId, query);
  }

  @Get(':orderNo')
  findOne(@Param('orderNo') orderNo: string) {
    return this.ordersService.findOne(orderNo);
  }

  @Patch(':orderNo')
  update(@Param('orderNo') orderNo: string, @Body() dto: UpdateOrderDto) {
    return this.ordersService.update(orderNo, dto);
  }

  @Delete(':orderNo')
  deleteDraft(@Param('orderNo') orderNo: string) {
    return this.ordersService.deleteDraft(orderNo);
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

  @Post(':orderNo/lines/:lineId/shortage-resolution')
  resolveLineShortage(
    @Param('orderNo') orderNo: string,
    @Param('lineId') lineId: string,
    @Body() dto: ResolveLineShortageDto
  ) {
    return this.ordersService.resolveLineShortage(orderNo, lineId, dto);
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
