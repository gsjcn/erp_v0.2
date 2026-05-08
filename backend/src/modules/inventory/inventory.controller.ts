import { BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { inventoryAdjustmentUploadPath } from '../../storage/upload-paths';
import { AdjustInventoryBatchDto, InventoryQueryDto, InventorySourceDetailQueryDto, MaterialSuggestionQueryDto } from './dto';
import { InventoryService } from './inventory.service';

const allowedAdjustmentExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff']);
const allowedAdjustmentMimeTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/gif',
  'image/tiff'
]);
const genericUploadMimeTypes = new Set(['', 'application/octet-stream']);

function safeAdjustmentFileName(
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, filename: string) => void
) {
  const extension = extname(file.originalname).toLowerCase();
  const baseName = file.originalname
    .replace(extension, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .slice(0, 60);
  callback(null, `${Date.now()}-${baseName || 'inventory-adjustment'}${extension}`);
}

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('summary')
  summary(@Query() query: InventoryQueryDto) {
    return this.inventoryService.summary(query);
  }

  @Get('materials/suggestions')
  materialSuggestions(@Query() query: MaterialSuggestionQueryDto) {
    return this.inventoryService.materialSuggestions(query);
  }

  @Get('materials/:partCode/source-details')
  materialSourceDetails(@Param('partCode') partCode: string, @Query() query: InventorySourceDetailQueryDto) {
    return this.inventoryService.materialSourceDetails(partCode, query);
  }

  @Post('adjustments/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: inventoryAdjustmentUploadPath(),
        filename: safeAdjustmentFileName
      }),
      limits: { fileSize: 30 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        const extension = extname(file.originalname).toLowerCase();
        const mimeType = file.mimetype || '';
        if (
          !allowedAdjustmentExtensions.has(extension) ||
          (!genericUploadMimeTypes.has(mimeType) && !allowedAdjustmentMimeTypes.has(mimeType))
        ) {
          callback(new BadRequestException('库存盘点附件格式不支持'), false);
          return;
        }
        callback(null, true);
      }
    })
  )
  uploadAdjustmentFile(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('必须上传库存盘点附件');
    }

    return {
      fileName: file.originalname,
      storedFileName: file.filename,
      fileUrl: `/uploads/inventory-adjustments/${file.filename}`,
      size: file.size,
      mimeType: file.mimetype
    };
  }

  @Post('batches/:batchId/adjust')
  adjustBatch(@Param('batchId') batchId: string, @Body() dto: AdjustInventoryBatchDto) {
    return this.inventoryService.adjustBatchQuantity(batchId, dto);
  }

  @Get('batches/:batchId/adjustments')
  batchAdjustments(@Param('batchId') batchId: string) {
    return this.inventoryService.findBatchAdjustments(batchId);
  }

  @Get()
  findAll(@Query() query: InventoryQueryDto) {
    return this.inventoryService.findAll(query);
  }
}
