import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommonStatus, Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPinyinSearchText, normalizeSearchKeyword, pinyinSearchMatches } from '../../common/pinyin-search';
import { processSnapshotToDetails, type ProcessStepSnapshot } from '../../common/serializers';
import { ProcessDefinitionsService } from '../process-definitions/process-definitions.service';
import { CreateProcessTemplateDto, ProcessTemplateQueryDto, UpdateProcessTemplateDto } from './dto';

const PROCESS_TEMPLATE_TEST_FIXTURE_PREFIXES = [
  'VERIFY-',
  'VERIFY_',
  'COD-',
  'MI-API-',
  'MAT-STABLE',
  'UPLOAD-FILENAME',
  'CUST-SEARCH-',
  'TEST-CUSTOMER'
];

@Injectable()
export class ProcessTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processDefinitionsService: ProcessDefinitionsService
  ) {}

  async findAll(query: ProcessTemplateQueryDto) {
    const status = query.status === 'ALL' ? undefined : query.status || CommonStatus.ENABLED;
    const withPage = query.withPage === 'true';
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const templates = await this.prisma.processTemplate.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ updatedAt: 'desc' }, { templateName: 'asc' }]
    });
    const visibleTemplates =
      query.includeTestFixtures === 'true' ? templates : templates.filter((template) => !this.isProcessTemplateTestFixture(template));
    const keyword = normalizeSearchKeyword(query.keyword);
    const rows = keyword
      ? visibleTemplates.filter((template) => this.templateMatchesKeyword(template, keyword))
      : visibleTemplates;
    const mappedRows = rows.map((template) => this.mapTemplate(template));
    if (!withPage) {
      return mappedRows;
    }

    // 流程记忆会长期积累，公开列表必须分页；导出接口才允许按筛选条件读取完整结果。
    const items = mappedRows.slice(offset, offset + limit);
    return {
      items,
      totalCount: mappedRows.length,
      limit,
      offset,
      hasMore: offset + items.length < mappedRows.length
    };
  }

  async buildProcessTemplatesExport(query: ProcessTemplateQueryDto = {}): Promise<Uint8Array> {
    const templateResponse = await this.findAll({ ...query, withPage: undefined, limit: undefined, offset: undefined });
    const templates = Array.isArray(templateResponse) ? templateResponse : templateResponse.items;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();

    const headers = ['序号', '流程名称', '状态', '工序数量', '工序路线', '备注', '创建时间', '更新时间'];
    const worksheet = workbook.addWorksheet('流程记忆', {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 }
      },
      views: [{ state: 'frozen', ySplit: 4 }]
    });
    const columnCount = headers.length;
    const titleRow = worksheet.addRow(['流程记忆导出']);
    worksheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount);
    titleRow.font = { bold: true, size: 16 };
    titleRow.alignment = { vertical: 'middle', horizontal: 'center' };

    const scopeRow = worksheet.addRow([this.processTemplateExportScopeText(query, templates.length)]);
    worksheet.mergeCells(scopeRow.number, 1, scopeRow.number, columnCount);
    scopeRow.font = { color: { argb: 'FF475569' } };
    scopeRow.alignment = { vertical: 'middle', wrapText: true };

    const generatedRow = worksheet.addRow([`制表时间：${this.processTemplateExportDateTimeText(new Date())}`]);
    worksheet.mergeCells(generatedRow.number, 1, generatedRow.number, columnCount);
    generatedRow.font = { color: { argb: 'FF475569' } };

    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FF0F172A' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.border = this.processTemplateExportThinBorder();
    });

    templates.forEach((template, index) => {
      const row = worksheet.addRow([
        index + 1,
        template.templateName,
        this.processTemplateExportStatusLabel(template.status),
        template.steps.length,
        this.processTemplateExportStepRoute(template.steps),
        template.remark || '',
        this.processTemplateExportDateTimeText(template.createdAt),
        this.processTemplateExportDateTimeText(template.updatedAt)
      ]);
      row.alignment = { vertical: 'top', wrapText: true };
      row.eachCell((cell) => {
        cell.border = this.processTemplateExportThinBorder();
      });
    });

    [8, 26, 10, 10, 48, 34, 20, 20].forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });
    worksheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: columnCount }
    };

    // 流程记忆导出只读取可复用流程模板，不写入订单流程、BOM 默认工艺或生产任务。
    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  async create(dto: CreateProcessTemplateDto) {
    const templateName = this.normalizeRequired(dto.templateName, '流程记忆名称不能为空');
    const templateNameNormalized = this.normalizeTemplateNameKey(templateName);
    const steps = await this.normalizeSteps(dto.steps, true);
    const remark = dto.remark?.trim() || null;
    await this.ensureTemplateNameAvailable(templateNameNormalized);

    try {
      const template = await this.prisma.processTemplate.create({
        data: {
          templateName,
          templateNameNormalized,
          steps: this.stepsToJson(steps),
          remark,
          searchText: this.buildSearchText(templateName, steps, remark)
        }
      });
      return this.mapTemplate(template);
    } catch (error) {
      if (this.isDuplicateTemplateNameError(error)) {
        throw new BadRequestException(`流程记忆“${templateName}”已存在，请勿重复创建`);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateProcessTemplateDto) {
    const existing = await this.ensureActiveExists(id);
    const templateName = dto.templateName !== undefined ? this.normalizeRequired(dto.templateName, '流程记忆名称不能为空') : existing.templateName;
    const templateNameNormalized = this.normalizeTemplateNameKey(templateName);
    const steps = dto.steps !== undefined ? await this.normalizeSteps(dto.steps, true) : processSnapshotToDetails(existing.steps);
    const remark = dto.remark !== undefined ? dto.remark.trim() || null : existing.remark;

    if (templateNameNormalized !== existing.templateNameNormalized) {
      await this.ensureTemplateNameAvailable(templateNameNormalized, id);
    }

    try {
      const template = await this.prisma.processTemplate.update({
        where: { id },
        data: {
          templateName,
          templateNameNormalized,
          steps: this.stepsToJson(steps),
          remark,
          searchText: this.buildSearchText(templateName, steps, remark)
        }
      });
      return this.mapTemplate(template);
    } catch (error) {
      if (this.isDuplicateTemplateNameError(error)) {
        throw new BadRequestException(`流程记忆“${templateName}”已存在，请勿重复创建`);
      }
      throw error;
    }
  }

  async delete(id: string) {
    const existing = await this.ensureActiveExists(id);
    // 流程记忆属于可复用基础资料，只软停用并释放名称查重键，不物理删除历史记录。
    await this.prisma.processTemplate.update({
      where: { id },
      data: {
        status: CommonStatus.DISABLED,
        templateNameNormalized: this.disabledTemplateNameKey(existing.templateNameNormalized, id),
        searchText: ''
      }
    });
    return { id, disabled: true };
  }

  async restore(id: string) {
    const existing = await this.ensureExists(id);
    if (existing.status === CommonStatus.ENABLED) {
      return this.mapTemplate(existing);
    }
    const templateNameNormalized = this.normalizeTemplateNameKey(existing.templateName);
    await this.ensureTemplateNameAvailable(templateNameNormalized, id);
    const steps = await this.normalizeSteps(processSnapshotToDetails(existing.steps), true);
    // 恢复流程记忆时重新校验标准工序仍启用，避免把失效工序重新带入订单流程。
    const restored = await this.prisma.processTemplate.update({
      where: { id },
      data: {
        templateNameNormalized,
        status: CommonStatus.ENABLED,
        searchText: this.buildSearchText(existing.templateName, steps, existing.remark)
      }
    });
    return this.mapTemplate(restored);
  }

  private async ensureExists(id: string) {
    const template = await this.prisma.processTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('流程记忆不存在');
    }
    return template;
  }

  private async ensureActiveExists(id: string) {
    const template = await this.ensureExists(id);
    if (template.status !== CommonStatus.ENABLED) {
      throw new NotFoundException('流程记忆不存在');
    }
    return template;
  }

  private isProcessTemplateTestFixture(template: { templateName?: string | null; remark?: string | null; steps?: Prisma.JsonValue }) {
    const steps = processSnapshotToDetails(template.steps || []);
    const values = [
      template.templateName,
      template.remark,
      ...steps.flatMap((step) => [step.processName, step.processRemark])
    ]
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean);
    return values.some((value) => PROCESS_TEMPLATE_TEST_FIXTURE_PREFIXES.some((prefix) => value.startsWith(prefix.toUpperCase())));
  }

  private normalizeRequired(value: string | undefined, message: string) {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException(message);
    }
    return normalized;
  }

  private normalizeTemplateNameKey(templateName: string) {
    return normalizeSearchKeyword(templateName);
  }

  private disabledTemplateNameKey(templateNameNormalized: string, id: string) {
    return `disabled:${id}:${templateNameNormalized}`;
  }

  private async normalizeSteps(steps: Array<{ processName: string; processRemark?: string }> | undefined, requireOne = false) {
    const normalized = processSnapshotToDetails(steps || []);
    if (requireOne && normalized.length === 0) {
      throw new BadRequestException('流程记忆至少需要一道工序');
    }

    const seen = new Set<string>();
    const result = normalized.map((step) => {
      const key = normalizeSearchKeyword(step.processName);
      if (seen.has(key)) {
        throw new BadRequestException(`流程记忆存在重复工序：${step.processName}`);
      }
      seen.add(key);
      return step;
    });
    await this.processDefinitionsService.ensureActiveNames(result.map((step) => step.processName));
    return result;
  }

  private stepsToJson(steps: ProcessStepSnapshot[]): Prisma.InputJsonValue {
    return steps.map((step) => ({
      processName: step.processName,
      ...(step.processRemark ? { processRemark: step.processRemark } : {})
    })) as Prisma.InputJsonValue;
  }

  private buildSearchText(templateName: string, steps: ProcessStepSnapshot[], remark?: string | null) {
    return buildPinyinSearchText([
      templateName,
      remark,
      ...steps.flatMap((step) => [step.processName, step.processRemark])
    ]);
  }

  private templateMatchesKeyword(
    template: {
      templateName: string;
      remark: string | null;
      steps: Prisma.JsonValue;
    },
    keyword: string
  ) {
    const steps = processSnapshotToDetails(template.steps);
    // 流程模板搜索沿用统一拼音规则，避免短拼音跨音节误命中。
    return pinyinSearchMatches(
      [template.templateName, template.remark, ...steps.flatMap((step) => [step.processName, step.processRemark])],
      keyword
    );
  }

  private async ensureTemplateNameAvailable(templateNameNormalized: string, excludeId?: string) {
    const existing = await this.prisma.processTemplate.findFirst({
      where: {
        templateNameNormalized,
        status: CommonStatus.ENABLED,
        ...(excludeId ? { id: { not: excludeId } } : {})
      }
    });
    if (existing) {
      throw new BadRequestException(`流程记忆“${existing.templateName}”已存在，请勿重复创建`);
    }
  }

  private mapTemplate(template: {
    id: string;
    templateName: string;
    steps: Prisma.JsonValue;
    remark: string | null;
    status: CommonStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: template.id,
      templateName: template.templateName,
      steps: processSnapshotToDetails(template.steps),
      remark: template.remark || undefined,
      status: template.status,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    };
  }

  private isDuplicateTemplateNameError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private processTemplateExportScopeText(query: ProcessTemplateQueryDto, count: number) {
    const keyword = query.keyword?.trim();
    const status = query.status || CommonStatus.ENABLED;
    const parts = [
      `状态：${status === 'ALL' ? '全部' : this.processTemplateExportStatusLabel(status)}`,
      keyword ? `关键字：${keyword}` : '关键字：全部',
      `记录数：${count}`
    ];
    return parts.join('；');
  }

  private processTemplateExportStatusLabel(status: CommonStatus | 'ALL') {
    if (status === CommonStatus.ENABLED) {
      return '启用';
    }
    if (status === CommonStatus.DISABLED) {
      return '停用';
    }
    return '全部';
  }

  private processTemplateExportStepRoute(steps: ProcessStepSnapshot[]) {
    return steps
      .map((step) => (step.processRemark ? `${step.processName}(${step.processRemark})` : step.processName))
      .join(' -> ');
  }

  private processTemplateExportDateTimeText(value?: Date | string | null) {
    if (!value) {
      return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const pad = (item: number) => String(item).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
      date.getMinutes()
    )}`;
  }

  private processTemplateExportThinBorder(): Partial<ExcelJS.Borders> {
    return {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };
  }
}
