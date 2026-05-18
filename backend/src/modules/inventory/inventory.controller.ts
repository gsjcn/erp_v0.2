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
import { drawingUploadPath, inventoryAdjustmentUploadPath, materialImportUploadPath } from '../../storage/upload-paths';
import {
  AdjustInventoryBatchDto,
  CommitModelBomDraftFromOrderImportDto,
  CommitMaterialImportSessionDto,
  ConfirmModelBomDiffReviewDto,
  CopyModelBomDto,
  CreateMaterialDto,
  CreateMaterialImportFromOrderImportDto,
  CreateMaterialImportSessionDto,
  CreateModelBomDraftFromOrderImportDto,
  CreateModelBomScopeApprovalRequestDto,
  GetMaterialImportSessionQueryDto,
  InventoryQueryDto,
  InventorySourceDetailQueryDto,
  MaterialQueryDto,
  MaterialSuggestionQueryDto,
  MaterialTransformRuleQueryDto,
  ModelBomDiffReviewQueryDto,
  ModelBomQueryDto,
  ModelBomRevisionQueryDto,
  ModelBomScopeApprovalRequestQueryDto,
  ReorderModelBomCommonDto,
  ReorderModelBomLinesDto,
  ReviewModelBomScopeApprovalRequestDto,
  SaveMaterialApplicabilityDto,
  SaveMaterialDrawingRevisionDto,
  SaveMaterialTransformRuleDto,
  SetModelBomCommonDto,
  SetModelBomsCommonBatchDto,
  SaveModelBomDto,
  SaveModelBomLineDto,
  UpdateMaterialDto
} from './dto';
import { InventoryService } from './inventory.service';

const allowedAdjustmentExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff']);
const allowedMaterialImportExtensions = new Set(['.xlsx']);
const allowedMaterialDrawingExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.dwg', '.dxf']);
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

function materialImportUploadMaxBytes() {
  const configuredMb = Number(process.env.MATERIAL_IMPORT_UPLOAD_MAX_MB || 100);
  const safeMb = Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : 100;
  return safeMb * 1024 * 1024;
}

function safeAdjustmentFileName(
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, filename: string) => void
) {
  const originalName = normalizeMultipartFileName(file.originalname);
  const extension = extname(originalName).toLowerCase();
  const baseName = originalName
    .replace(extension, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .slice(0, 60);
  const uniqueSuffix = randomUUID().slice(0, 8);
  // 盘点附件文件名按公司业务时区和短随机后缀生成，方便核对库存流水并避免同秒重名。
  callback(null, `${businessDateTimeKey()}-${uniqueSuffix}-${baseName || 'inventory-adjustment'}${extension}`);
}

function safeMaterialImportFileName(
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, filename: string) => void
) {
  const originalName = normalizeMultipartFileName(file.originalname);
  const extension = extname(originalName).toLowerCase();
  const baseName = originalName
    .replace(extension, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .slice(0, 80);
  const uniqueSuffix = randomUUID().slice(0, 8);
  // 零件库导入临时文件名按公司业务时区生成，不使用服务器本地 UTC 时间戳。
  callback(null, `${businessDateTimeKey()}-${uniqueSuffix}-${baseName || 'material-import'}${extension}`);
}

function safeMaterialDrawingFileName(
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, filename: string) => void
) {
  const originalName = normalizeMultipartFileName(file.originalname);
  const extension = extname(originalName).toLowerCase();
  const baseName = originalName
    .replace(extension, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .slice(0, 60);
  const uniqueSuffix = randomUUID().slice(0, 8);
  // 零件基础库图纸文件和订单图纸使用同一图纸目录；文件名保留业务时区时间，方便后续按上传时间追溯。
  callback(null, `${businessDateTimeKey()}-${uniqueSuffix}-${baseName || 'material-drawing'}${extension}`);
}

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('summary')
  summary(@Query() query: InventoryQueryDto) {
    return this.inventoryService.summary(query);
  }

  @Get('export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="inventory-export.xlsx"')
  async inventoryExport(@Query() query: InventoryQueryDto) {
    return new StreamableFile(await this.inventoryService.buildInventoryExport(query));
  }

  @Get('materials/suggestions')
  materialSuggestions(@Query() query: MaterialSuggestionQueryDto) {
    return this.inventoryService.materialSuggestions(query);
  }

  @Get('materials')
  materials(@Query() query: MaterialQueryDto) {
    return this.inventoryService.materials({ ...query, withPage: 'true' });
  }

  @Get('materials/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="inventory-materials-export.xlsx"')
  async materialsExport(@Query() query: MaterialQueryDto) {
    return new StreamableFile(await this.inventoryService.buildMaterialMemoryExport(query));
  }

  @Post('materials')
  createMaterial(@Body() dto: CreateMaterialDto) {
    return this.inventoryService.createMaterial(dto);
  }

  @Post('material-drawings/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: drawingUploadPath(),
        filename: safeMaterialDrawingFileName
      }),
      limits: { fileSize: 30 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        const extension = extname(normalizeMultipartFileName(file.originalname)).toLowerCase();
        if (!allowedMaterialDrawingExtensions.has(extension)) {
          callback(new BadRequestException('图纸文件格式不支持'), false);
          return;
        }
        callback(null, true);
      }
    })
  )
  uploadMaterialDrawing(@UploadedFile() file?: Express.Multer.File) {
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

  @Get('materials/:materialId/drawing-revisions')
  materialDrawingRevisions(@Param('materialId') materialId: string) {
    return this.inventoryService.materialDrawingRevisions(materialId);
  }

  @Get('materials/:materialId/drawing-revisions/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="material-drawing-revisions-export.xlsx"')
  async materialDrawingRevisionsExport(@Param('materialId') materialId: string) {
    return new StreamableFile(await this.inventoryService.buildMaterialDrawingRevisionsExport(materialId));
  }

  @Post('materials/:materialId/drawing-revisions')
  saveMaterialDrawingRevision(@Param('materialId') materialId: string, @Body() dto: SaveMaterialDrawingRevisionDto) {
    return this.inventoryService.saveMaterialDrawingRevision(materialId, dto);
  }

  @Patch('material-drawing-revisions/:revisionId')
  updateMaterialDrawingRevision(@Param('revisionId') revisionId: string, @Body() dto: SaveMaterialDrawingRevisionDto) {
    return this.inventoryService.updateMaterialDrawingRevision(revisionId, dto);
  }

  @Patch('material-drawing-revisions/:revisionId/restore')
  restoreMaterialDrawingRevision(@Param('revisionId') revisionId: string) {
    return this.inventoryService.restoreMaterialDrawingRevision(revisionId);
  }

  @Delete('material-drawing-revisions/:revisionId')
  disableMaterialDrawingRevision(@Param('revisionId') revisionId: string) {
    return this.inventoryService.disableMaterialDrawingRevision(revisionId);
  }

  @Post('material-import-sessions')
  createMaterialImportSession(@Body() dto: CreateMaterialImportSessionDto) {
    return this.inventoryService.createMaterialImportSession(dto);
  }

  @Post('material-import-sessions/from-order-import/:orderImportSessionId')
  createMaterialImportSessionFromOrderImport(
    @Param('orderImportSessionId') orderImportSessionId: string,
    @Body() dto: CreateMaterialImportFromOrderImportDto
  ) {
    return this.inventoryService.createMaterialImportSessionFromOrderImport(orderImportSessionId, dto);
  }

  @Get('material-import-template')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename*=UTF-8\'\'material-library-import-template.xlsx')
  async materialImportTemplate() {
    return new StreamableFile(await this.inventoryService.buildMaterialImportTemplate());
  }

  @Get('material-import-config')
  materialImportConfig() {
    const uploadMaxBytes = materialImportUploadMaxBytes();
    return {
      uploadMaxBytes,
      uploadMaxMb: Math.round(uploadMaxBytes / 1024 / 1024),
      allowedExtensions: [...allowedMaterialImportExtensions]
    };
  }

  @Get('material-import-sessions/:sessionId')
  materialImportSession(@Param('sessionId') sessionId: string, @Query() query: GetMaterialImportSessionQueryDto) {
    return this.inventoryService.getMaterialImportSession(sessionId, query);
  }

  @Get('material-import-sessions/:sessionId/error-report')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename*=UTF-8\'\'material-library-import-issues.xlsx')
  async downloadMaterialImportIssueReport(@Param('sessionId') sessionId: string) {
    return new StreamableFile(await this.inventoryService.buildMaterialImportIssueReport(sessionId));
  }

  @Post('material-import-sessions/:sessionId/files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: materialImportUploadPath(),
        filename: safeMaterialImportFileName
      }),
      limits: { fileSize: materialImportUploadMaxBytes() },
      fileFilter: (_request, file, callback) => {
        const extension = extname(normalizeMultipartFileName(file.originalname)).toLowerCase();
        if (!allowedMaterialImportExtensions.has(extension)) {
          callback(new BadRequestException('零件库导入只支持 .xlsx 文件'), false);
          return;
        }
        callback(null, true);
      }
    })
  )
  uploadMaterialImportFile(@Param('sessionId') sessionId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('必须上传零件库导入文件');
    }
    return this.inventoryService.uploadMaterialImportFile(sessionId, file);
  }

  @Post('material-import-sessions/:sessionId/commit')
  commitMaterialImportSession(@Param('sessionId') sessionId: string, @Body() dto: CommitMaterialImportSessionDto) {
    return this.inventoryService.commitMaterialImportSession(sessionId, dto);
  }

  @Delete('material-import-sessions/:sessionId/files/:fileId')
  deleteMaterialImportFile(@Param('sessionId') sessionId: string, @Param('fileId') fileId: string) {
    return this.inventoryService.deleteMaterialImportFile(sessionId, fileId);
  }

  @Delete('material-import-sessions/:sessionId')
  discardMaterialImportSession(@Param('sessionId') sessionId: string) {
    return this.inventoryService.discardMaterialImportSession(sessionId);
  }

  @Get('materials/:materialId/applicabilities')
  materialApplicabilities(@Param('materialId') materialId: string) {
    return this.inventoryService.materialApplicabilities(materialId);
  }

  @Get('materials/:materialId/applicabilities/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="material-applicabilities-export.xlsx"')
  async materialApplicabilitiesExport(@Param('materialId') materialId: string) {
    return new StreamableFile(await this.inventoryService.buildMaterialApplicabilitiesExport(materialId));
  }

  @Post('materials/:materialId/applicabilities')
  saveMaterialApplicability(@Param('materialId') materialId: string, @Body() dto: SaveMaterialApplicabilityDto) {
    return this.inventoryService.saveMaterialApplicability(materialId, dto);
  }

  @Patch('material-applicabilities/:applicabilityId')
  updateMaterialApplicability(@Param('applicabilityId') applicabilityId: string, @Body() dto: SaveMaterialApplicabilityDto) {
    return this.inventoryService.updateMaterialApplicability(applicabilityId, dto);
  }

  @Patch('material-applicabilities/:applicabilityId/restore')
  restoreMaterialApplicability(@Param('applicabilityId') applicabilityId: string) {
    return this.inventoryService.restoreMaterialApplicability(applicabilityId);
  }

  @Delete('material-applicabilities/:applicabilityId')
  disableMaterialApplicability(@Param('applicabilityId') applicabilityId: string) {
    return this.inventoryService.disableMaterialApplicability(applicabilityId);
  }

  @Patch('materials/:materialId')
  updateMaterial(@Param('materialId') materialId: string, @Body() dto: UpdateMaterialDto) {
    return this.inventoryService.updateMaterial(materialId, dto);
  }

  @Patch('materials/:materialId/restore')
  restoreMaterial(@Param('materialId') materialId: string) {
    return this.inventoryService.restoreMaterial(materialId);
  }

  @Delete('materials/:materialId')
  disableMaterial(@Param('materialId') materialId: string) {
    return this.inventoryService.disableMaterial(materialId);
  }

  @Get('model-boms')
  modelBoms(@Query() query: ModelBomQueryDto) {
    return this.inventoryService.modelBoms({ ...query, withPage: 'true' });
  }

  @Get('model-boms/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="model-boms-export.xlsx"')
  async modelBomsExport(@Query() query: ModelBomQueryDto) {
    return new StreamableFile(await this.inventoryService.buildModelBomsExport(query));
  }

  @Post('model-bom-drafts/from-order-import/:orderImportSessionId')
  createModelBomDraftsFromOrderImport(
    @Param('orderImportSessionId') orderImportSessionId: string,
    @Body() dto: CreateModelBomDraftFromOrderImportDto
  ) {
    return this.inventoryService.createModelBomDraftsFromOrderImport(orderImportSessionId, dto);
  }

  @Post('model-bom-drafts/from-order-import/:orderImportSessionId/commit')
  commitModelBomDraftFromOrderImport(
    @Param('orderImportSessionId') orderImportSessionId: string,
    @Body() dto: CommitModelBomDraftFromOrderImportDto
  ) {
    return this.inventoryService.commitModelBomDraftFromOrderImport(orderImportSessionId, dto);
  }

  @Get('model-boms/:bomId/diff-reviews')
  modelBomDiffReviews(@Param('bomId') bomId: string, @Query() query: ModelBomDiffReviewQueryDto) {
    return this.inventoryService.modelBomDiffReviews(bomId, { ...query, withPage: 'true' });
  }

  @Get('model-boms/:bomId/diff-reviews/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="model-bom-diff-reviews-export.xlsx"')
  async modelBomDiffReviewsExport(@Param('bomId') bomId: string, @Query() query: ModelBomDiffReviewQueryDto) {
    return new StreamableFile(await this.inventoryService.buildModelBomDiffReviewsExport(bomId, query));
  }

  @Post('model-boms/:bomId/diff-reviews')
  confirmModelBomDiffReview(@Param('bomId') bomId: string, @Body() dto: ConfirmModelBomDiffReviewDto) {
    return this.inventoryService.confirmModelBomDiffReview(bomId, dto);
  }

  @Delete('model-bom-diff-reviews/:reviewId')
  disableModelBomDiffReview(@Param('reviewId') reviewId: string) {
    return this.inventoryService.disableModelBomDiffReview(reviewId);
  }

  @Get('model-boms/:bomId/revisions')
  modelBomRevisions(@Param('bomId') bomId: string, @Query() query: ModelBomRevisionQueryDto) {
    return this.inventoryService.modelBomRevisions(bomId, query);
  }

  @Get('model-bom-scope-approval-requests')
  modelBomScopeApprovalRequests(@Query() query: ModelBomScopeApprovalRequestQueryDto) {
    return this.inventoryService.modelBomScopeApprovalRequests(query);
  }

  @Post('model-boms/:bomId/scope-approval-requests')
  createModelBomScopeApprovalRequest(@Param('bomId') bomId: string, @Body() dto: CreateModelBomScopeApprovalRequestDto) {
    return this.inventoryService.createModelBomScopeApprovalRequest(bomId, dto);
  }

  @Post('model-bom-scope-approval-requests/:requestId/approve')
  approveModelBomScopeApprovalRequest(@Param('requestId') requestId: string, @Body() dto: ReviewModelBomScopeApprovalRequestDto) {
    return this.inventoryService.approveModelBomScopeApprovalRequest(requestId, dto);
  }

  @Post('model-bom-scope-approval-requests/:requestId/reject')
  rejectModelBomScopeApprovalRequest(@Param('requestId') requestId: string, @Body() dto: ReviewModelBomScopeApprovalRequestDto) {
    return this.inventoryService.rejectModelBomScopeApprovalRequest(requestId, dto);
  }

  @Get('model-boms/:bomId')
  modelBom(@Param('bomId') bomId: string) {
    return this.inventoryService.modelBom(bomId);
  }

  @Post('model-boms')
  createModelBom(@Body() dto: SaveModelBomDto) {
    return this.inventoryService.createModelBom(dto);
  }

  @Post('model-boms/:bomId/copy')
  copyModelBom(@Param('bomId') bomId: string, @Body() dto: CopyModelBomDto) {
    return this.inventoryService.copyModelBom(bomId, dto);
  }

  @Patch('model-boms/:bomId')
  updateModelBom(@Param('bomId') bomId: string, @Body() dto: SaveModelBomDto) {
    return this.inventoryService.updateModelBom(bomId, dto);
  }

  @Patch('model-boms/:bomId/common')
  setModelBomCommon(@Param('bomId') bomId: string, @Body() dto: SetModelBomCommonDto) {
    return this.inventoryService.setModelBomCommon(bomId, dto);
  }

  @Patch('model-boms/common/batch')
  setModelBomsCommonBatch(@Body() dto: SetModelBomsCommonBatchDto) {
    return this.inventoryService.setModelBomsCommonBatch(dto);
  }

  @Patch('model-boms/common/reorder')
  reorderModelBomCommon(@Body() dto: ReorderModelBomCommonDto) {
    return this.inventoryService.reorderModelBomCommon(dto);
  }

  @Delete('model-boms/:bomId')
  disableModelBom(@Param('bomId') bomId: string) {
    return this.inventoryService.disableModelBom(bomId);
  }

  @Delete('model-boms/:bomId/permanent')
  deleteModelBom(@Param('bomId') bomId: string) {
    return this.inventoryService.deleteModelBom(bomId);
  }

  @Post('model-boms/:bomId/lines')
  saveModelBomLine(@Param('bomId') bomId: string, @Body() dto: SaveModelBomLineDto) {
    return this.inventoryService.saveModelBomLine(bomId, dto);
  }

  @Patch('model-boms/:bomId/lines/reorder')
  reorderModelBomLines(@Param('bomId') bomId: string, @Body() dto: ReorderModelBomLinesDto) {
    return this.inventoryService.reorderModelBomLines(bomId, dto);
  }

  @Patch('model-bom-lines/:lineId')
  updateModelBomLine(@Param('lineId') lineId: string, @Body() dto: SaveModelBomLineDto) {
    return this.inventoryService.updateModelBomLine(lineId, dto);
  }

  @Delete('model-bom-lines/:lineId')
  disableModelBomLine(@Param('lineId') lineId: string) {
    return this.inventoryService.disableModelBomLine(lineId);
  }

  @Get('material-transform-rules')
  materialTransformRules(@Query() query: MaterialTransformRuleQueryDto) {
    return this.inventoryService.materialTransformRules(query);
  }

  @Get('material-transform-rules/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="material-transform-rules-export.xlsx"')
  async materialTransformRulesExport(@Query() query: MaterialTransformRuleQueryDto) {
    return new StreamableFile(await this.inventoryService.buildMaterialTransformRulesExport(query));
  }

  @Post('material-transform-rules')
  createMaterialTransformRule(@Body() dto: SaveMaterialTransformRuleDto) {
    return this.inventoryService.createMaterialTransformRule(dto);
  }

  @Patch('material-transform-rules/:ruleId')
  updateMaterialTransformRule(@Param('ruleId') ruleId: string, @Body() dto: SaveMaterialTransformRuleDto) {
    return this.inventoryService.updateMaterialTransformRule(ruleId, dto);
  }

  @Patch('material-transform-rules/:ruleId/restore')
  restoreMaterialTransformRule(@Param('ruleId') ruleId: string) {
    return this.inventoryService.restoreMaterialTransformRule(ruleId);
  }

  @Delete('material-transform-rules/:ruleId')
  disableMaterialTransformRule(@Param('ruleId') ruleId: string) {
    return this.inventoryService.disableMaterialTransformRule(ruleId);
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
        const extension = extname(normalizeMultipartFileName(file.originalname)).toLowerCase();
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
      fileName: normalizeMultipartFileName(file.originalname),
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

  @Get('batches/:batchId/reservations')
  batchReservations(@Param('batchId') batchId: string) {
    return this.inventoryService.findBatchReservations(batchId);
  }

  @Get()
  findAll(@Query() query: InventoryQueryDto) {
    return this.inventoryService.findAll({ ...query, withPage: 'true' });
  }
}
