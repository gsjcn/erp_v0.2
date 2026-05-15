import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommonStatus } from '@prisma/client';
import { buildPinyinSearchText, normalizeSearchKeyword, pinyinSearchMatches } from '../../common/pinyin-search';
import { processSnapshotToDetails } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProcessDefinitionDto, ProcessDefinitionQueryDto, UpdateProcessDefinitionDto } from './dto';

type ProcessDefinitionReferenceSummary = {
  total: number;
  samples: string[];
};

@Injectable()
export class ProcessDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ProcessDefinitionQueryDto) {
    const status = query.status === 'ALL' ? undefined : query.status || CommonStatus.ENABLED;
    const rows = await this.prisma.processDefinition.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ status: 'asc' }, { processName: 'asc' }]
    });
    const keyword = normalizeSearchKeyword(query.keyword);
    const filtered = keyword
      ? rows.filter((row) => pinyinSearchMatches([row.processName, row.remark], keyword))
      : rows;
    return filtered.map((row) => this.mapDefinition(row));
  }

  async create(dto: CreateProcessDefinitionDto) {
    const processName = this.normalizeProcessName(dto.processName);
    const processNameNormalized = this.normalizeProcessNameKey(processName);
    const remark = dto.remark?.trim() || null;

    const existing = await this.prisma.processDefinition.findUnique({ where: { processNameNormalized } });
    if (existing) {
      if (existing.status === CommonStatus.DISABLED) {
        // 同名停用工序必须走 restore；新建入口不能悄悄恢复状态或改写原备注。
        throw new BadRequestException(`标准工序“${existing.processName}”已停用，请在状态筛选中查看停用工序并恢复启用`);
      }
      throw new BadRequestException(`标准工序“${existing.processName}”已存在，请勿重复创建`);
    }

    const created = await this.prisma.processDefinition.create({
      data: {
        processName,
        processNameNormalized,
        remark,
        searchText: this.buildSearchText(processName, remark)
      }
    });
    return this.mapDefinition(created);
  }

  async update(id: string, dto: UpdateProcessDefinitionDto) {
    const existing = await this.ensureExists(id);
    if (dto.status !== undefined) {
      // 标准工序状态变更必须走 delete / restore，避免普通编辑绕过停用引用检查和恢复边界。
      throw new BadRequestException('标准工序状态请使用专用启用/停用接口');
    }
    if (existing.status !== CommonStatus.ENABLED) {
      throw new BadRequestException('已停用的标准工序需先恢复启用后再编辑');
    }
    const processName = dto.processName !== undefined ? this.normalizeProcessName(dto.processName) : existing.processName;
    const processNameNormalized = this.normalizeProcessNameKey(processName);
    const remark = dto.remark !== undefined ? dto.remark.trim() || null : existing.remark;

    // 标准工序被订单流程、流程记忆、BOM 或来源加工关系引用后，不能改名，避免默认工艺建议失效。
    if (processNameNormalized !== existing.processNameNormalized) {
      const references = await this.findProcessDefinitionReferences(existing.processNameNormalized);
      if (references.total > 0) {
        throw this.referencedProcessDefinitionError(existing.processName, references, '改名');
      }
    }

    if (processNameNormalized !== existing.processNameNormalized) {
      const duplicated = await this.prisma.processDefinition.findUnique({ where: { processNameNormalized } });
      if (duplicated && duplicated.id !== id) {
        throw new BadRequestException(`标准工序“${duplicated.processName}”已存在，请勿重复创建`);
      }
    }

    const updated = await this.prisma.processDefinition.update({
      where: { id },
      data: {
        processName,
        processNameNormalized,
        remark,
        searchText: this.buildSearchText(processName, remark)
      }
    });
    return this.mapDefinition(updated);
  }

  async delete(id: string) {
    const existing = await this.ensureExists(id);
    const references = await this.findProcessDefinitionReferences(existing.processNameNormalized);
    if (references.total > 0) {
      // 已被历史订单、流程记忆、BOM 或来源加工关系引用的标准工序不能停用，避免后续默认工艺失效。
      throw this.referencedProcessDefinitionError(existing.processName, references, '停用');
    }
    // 标准工序属于可复用基础资料；删除入口只做软停用，保留查重和后续恢复能力。
    const disabled = await this.prisma.processDefinition.update({
      where: { id },
      data: { status: CommonStatus.DISABLED }
    });
    return this.mapDefinition(disabled);
  }

  async restore(id: string) {
    const existing = await this.ensureExists(id);
    if (existing.status === CommonStatus.ENABLED) {
      return this.mapDefinition(existing);
    }
    // 恢复标准工序只恢复后续下拉可选；不会自动修改已保存订单流程、BOM 或来源加工关系。
    const restored = await this.prisma.processDefinition.update({
      where: { id },
      data: { status: CommonStatus.ENABLED }
    });
    return this.mapDefinition(restored);
  }

  async ensureActiveNames(processNames: string[]) {
    const normalizedRows = processNames
      .map((name) => ({ name, key: this.normalizeProcessNameKey(name) }))
      .filter((row) => row.key);
    const seenKeys = new Set<string>();
    for (const row of normalizedRows) {
      if (seenKeys.has(row.key)) {
        // 同一个零件流程不能重复保存同名工序；次数或参数差异请写入 processRemark，避免生产统计混乱。
        throw new BadRequestException(`标准工序“${row.name}”重复，请把次数或参数写入工序备注`);
      }
      seenKeys.add(row.key);
    }
    const normalizedNames = [...new Set(normalizedRows.map((row) => row.key))];
    if (normalizedNames.length === 0) {
      return;
    }
    const rows = await this.prisma.processDefinition.findMany({
      where: {
        processNameNormalized: { in: normalizedNames },
        status: CommonStatus.ENABLED
      }
    });
    const enabledNames = new Set(rows.map((row) => row.processNameNormalized));
    const missing = processNames.find((name) => !enabledNames.has(this.normalizeProcessNameKey(name)));
    if (missing) {
      throw new BadRequestException(`标准工序“${missing}”不存在或已停用，请先在流程记忆页面维护工序`);
    }
  }

  private async ensureExists(id: string) {
    const row = await this.prisma.processDefinition.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('标准工序不存在');
    }
    return row;
  }

  private splitDefaultProcessRoute(value?: string | null) {
    return String(value || '')
      .split(/(?:->|→|[、,，;；\n\r]+)/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async findProcessDefinitionReferences(processNameNormalized: string): Promise<ProcessDefinitionReferenceSummary> {
    const [orderSteps, templates, bomLines, transformRules] = await Promise.all([
      this.prisma.orderLineProcessStep.findMany({
        select: {
          processName: true,
          stepNo: true,
          orderLine: {
            select: {
              lineNo: true,
              partCode: true,
              order: { select: { orderNo: true } }
            }
          }
        },
        orderBy: [{ orderLine: { order: { orderNo: 'asc' } } }, { orderLine: { lineNo: 'asc' } }, { stepNo: 'asc' }]
      }),
      this.prisma.processTemplate.findMany({
        select: {
          templateName: true,
          steps: true
        },
        orderBy: { templateName: 'asc' }
      }),
      this.prisma.modelBomLine.findMany({
        where: { defaultProcessRoute: { not: null } },
        select: {
          defaultProcessRoute: true,
          partCodeSnapshot: true,
          bom: { select: { bomName: true } }
        },
        orderBy: [{ bom: { bomName: 'asc' } }, { sortOrder: 'asc' }]
      }),
      this.prisma.materialTransformRule.findMany({
        where: { defaultProcessRoute: { not: null } },
        select: {
          defaultProcessRoute: true,
          sourceMaterial: { select: { partCode: true } },
          targetMaterial: { select: { partCode: true } },
          customerNameSnapshot: true,
          projectModel: true
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
      })
    ]);

    const samples: string[] = [];
    let total = 0;
    const addReference = (label: string) => {
      total += 1;
      if (samples.length < 5) {
        samples.push(label);
      }
    };

    for (const step of orderSteps) {
      if (this.normalizeProcessNameKey(step.processName) !== processNameNormalized) {
        continue;
      }
      addReference(`订单 ${step.orderLine.order.orderNo} / ${step.orderLine.partCode} / 第 ${step.stepNo} 道`);
    }

    for (const template of templates) {
      if (!processSnapshotToDetails(template.steps).some((step) => this.normalizeProcessNameKey(step.processName) === processNameNormalized)) {
        continue;
      }
      addReference(`流程记忆 ${template.templateName}`);
    }

    for (const line of bomLines) {
      const processNames = this.splitDefaultProcessRoute(line.defaultProcessRoute);
      if (!processNames.some((processName) => this.normalizeProcessNameKey(processName) === processNameNormalized)) {
        continue;
      }
      addReference(`BOM ${line.bom.bomName} / ${line.partCodeSnapshot}`);
    }

    for (const rule of transformRules) {
      const processNames = this.splitDefaultProcessRoute(rule.defaultProcessRoute);
      if (!processNames.some((processName) => this.normalizeProcessNameKey(processName) === processNameNormalized)) {
        continue;
      }
      const scopeText = [rule.customerNameSnapshot, rule.projectModel].filter(Boolean).join(' / ') || '全部范围';
      addReference(`来源加工关系 ${rule.sourceMaterial.partCode} -> ${rule.targetMaterial.partCode} / ${scopeText}`);
    }

    return { total, samples };
  }

  private referencedProcessDefinitionError(processName: string, references: ProcessDefinitionReferenceSummary, action: '停用' | '改名') {
    const sampleText = references.samples.join('；');
    const moreText = references.total > references.samples.length ? ` 等 ${references.total} 处` : '';
    return new BadRequestException(
      `标准工序“${processName}”已被${sampleText}${moreText}引用，不能${action}；请先调整对应订单流程、流程记忆、BOM 或来源加工关系`
    );
  }

  private normalizeProcessName(value: string | undefined) {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException('请填写标准工序名称');
    }
    return normalized;
  }

  private normalizeProcessNameKey(processName: string) {
    return normalizeSearchKeyword(processName);
  }

  private buildSearchText(processName: string, remark?: string | null) {
    return buildPinyinSearchText([processName, remark]);
  }

  private mapDefinition(row: {
    id: string;
    processName: string;
    remark: string | null;
    status: CommonStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      processName: row.processName,
      remark: row.remark || undefined,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
