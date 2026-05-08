import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommonStatus } from '@prisma/client';
import { buildPinyinSearchText, normalizeSearchKeyword, pinyinSearchMatches } from '../../common/pinyin-search';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProcessDefinitionDto, ProcessDefinitionQueryDto, UpdateProcessDefinitionDto } from './dto';

@Injectable()
export class ProcessDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ProcessDefinitionQueryDto) {
    const rows = await this.prisma.processDefinition.findMany({
      where: query.status ? { status: query.status } : undefined,
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
    this.validateRemark(remark);

    const existing = await this.prisma.processDefinition.findUnique({ where: { processNameNormalized } });
    if (existing) {
      if (existing.status === CommonStatus.DISABLED) {
        const restored = await this.prisma.processDefinition.update({
          where: { id: existing.id },
          data: {
            processName,
            remark,
            status: CommonStatus.ENABLED,
            searchText: this.buildSearchText(processName, remark)
          }
        });
        return this.mapDefinition(restored);
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
    const processName = dto.processName !== undefined ? this.normalizeProcessName(dto.processName) : existing.processName;
    const processNameNormalized = this.normalizeProcessNameKey(processName);
    const remark = dto.remark !== undefined ? dto.remark.trim() || null : existing.remark;
    this.validateRemark(remark);

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
        status: dto.status || existing.status,
        searchText: this.buildSearchText(processName, remark)
      }
    });
    return this.mapDefinition(updated);
  }

  async delete(id: string) {
    await this.ensureExists(id);
    const updated = await this.prisma.processDefinition.update({
      where: { id },
      data: { status: CommonStatus.DISABLED }
    });
    return this.mapDefinition(updated);
  }

  async ensureActiveNames(processNames: string[]) {
    const normalizedNames = [...new Set(processNames.map((name) => this.normalizeProcessNameKey(name)))];
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

  private normalizeProcessName(value: string | undefined) {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException('请填写标准工序名称');
    }
    if (normalized.length > 30) {
      throw new BadRequestException('标准工序名称不能超过 30 个字符');
    }
    return normalized;
  }

  private normalizeProcessNameKey(processName: string) {
    return normalizeSearchKeyword(processName);
  }

  private validateRemark(remark?: string | null) {
    if (remark && remark.length > 200) {
      throw new BadRequestException('标准工序备注不能超过 200 个字符');
    }
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
