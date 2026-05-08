import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPinyinSearchText, normalizeSearchKeyword, pinyinSearchMatches } from '../../common/pinyin-search';
import { processSnapshotToDetails, type ProcessStepSnapshot } from '../../common/serializers';
import { ProcessDefinitionsService } from '../process-definitions/process-definitions.service';
import { CreateProcessTemplateDto, ProcessTemplateQueryDto, UpdateProcessTemplateDto } from './dto';

@Injectable()
export class ProcessTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processDefinitionsService: ProcessDefinitionsService
  ) {}

  async findAll(query: ProcessTemplateQueryDto) {
    const templates = await this.prisma.processTemplate.findMany({
      orderBy: [{ updatedAt: 'desc' }, { templateName: 'asc' }]
    });
    const keyword = normalizeSearchKeyword(query.keyword);
    const rows = keyword
      ? templates.filter((template) => this.templateMatchesKeyword(template, keyword))
      : templates;
    return rows.map((template) => this.mapTemplate(template));
  }

  async create(dto: CreateProcessTemplateDto) {
    const templateName = this.normalizeRequired(dto.templateName, '流程记忆名称不能为空');
    const templateNameNormalized = this.normalizeTemplateNameKey(templateName);
    const steps = await this.normalizeSteps(dto.steps, true);
    const remark = dto.remark?.trim() || null;
    this.validateRemarkLength(remark);
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
    const existing = await this.ensureExists(id);
    const templateName = dto.templateName !== undefined ? this.normalizeRequired(dto.templateName, '流程记忆名称不能为空') : existing.templateName;
    const templateNameNormalized = this.normalizeTemplateNameKey(templateName);
    const steps = dto.steps !== undefined ? await this.normalizeSteps(dto.steps, true) : processSnapshotToDetails(existing.steps);
    const remark = dto.remark !== undefined ? dto.remark.trim() || null : existing.remark;
    this.validateRemarkLength(remark);

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
    await this.ensureExists(id);
    await this.prisma.processTemplate.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async ensureExists(id: string) {
    const template = await this.prisma.processTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('流程记忆不存在');
    }
    return template;
  }

  private normalizeRequired(value: string | undefined, message: string) {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException(message);
    }
    if (normalized.length > 60) {
      throw new BadRequestException('流程记忆名称不能超过 60 个字符');
    }
    return normalized;
  }

  private normalizeTemplateNameKey(templateName: string) {
    return normalizeSearchKeyword(templateName);
  }

  private validateRemarkLength(remark?: string | null) {
    if (remark && remark.length > 300) {
      throw new BadRequestException('流程记忆备注不能超过 300 个字符');
    }
  }

  private async normalizeSteps(steps: Array<{ processName: string; processRemark?: string }> | undefined, requireOne = false) {
    const normalized = processSnapshotToDetails(steps || []);
    if (requireOne && normalized.length === 0) {
      throw new BadRequestException('流程记忆至少需要一道工序');
    }

    const seen = new Set<string>();
    const result = normalized.map((step) => {
      if (step.processRemark && step.processRemark.length > 120) {
        throw new BadRequestException(`工序“${step.processName}”的参数备注不能超过 120 个字符`);
      }
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
    const existing = await this.prisma.processTemplate.findUnique({ where: { templateNameNormalized } });
    if (existing && existing.id !== excludeId) {
      throw new BadRequestException(`流程记忆“${existing.templateName}”已存在，请勿重复创建`);
    }
  }

  private mapTemplate(template: {
    id: string;
    templateName: string;
    steps: Prisma.JsonValue;
    remark: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: template.id,
      templateName: template.templateName,
      steps: processSnapshotToDetails(template.steps),
      remark: template.remark || undefined,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    };
  }

  private isDuplicateTemplateNameError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
