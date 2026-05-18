import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommonStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { buildPinyinSearchText, normalizeSearchKeyword, pinyinSearchMatches } from '../../common/pinyin-search';
import { processSnapshotToDetails } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProcessDefinitionDto, ProcessDefinitionQueryDto, UpdateProcessDefinitionDto } from './dto';

type ProcessDefinitionReferenceSummary = {
  total: number;
  samples: string[];
};

const PROCESS_DEFINITION_TEST_FIXTURE_PREFIXES = [
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
export class ProcessDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ProcessDefinitionQueryDto) {
    const status = query.status === 'ALL' ? undefined : query.status || CommonStatus.ENABLED;
    const withPage = query.withPage === 'true';
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const rows = await this.prisma.processDefinition.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ status: 'asc' }, { processName: 'asc' }]
    });
    const visibleRows =
      query.includeTestFixtures === 'true' ? rows : rows.filter((row) => !this.isProcessDefinitionTestFixture(row));
    const keyword = normalizeSearchKeyword(query.keyword);
    const filtered = keyword
      ? visibleRows.filter((row) => pinyinSearchMatches([row.processName, row.remark], keyword))
      : visibleRows;
    const mappedRows = filtered.map((row) => this.mapDefinition(row));
    if (!withPage) {
      return mappedRows;
    }

    // 标准工序是可增长基础资料，公开维护列表必须分页；下拉选项由前端显式逐页加载。
    const items = mappedRows.slice(offset, offset + limit);
    return {
      items,
      totalCount: mappedRows.length,
      limit,
      offset,
      hasMore: offset + items.length < mappedRows.length
    };
  }

  async buildProcessDefinitionsExport(query: ProcessDefinitionQueryDto = {}): Promise<Uint8Array> {
    const definitionResponse = await this.findAll({ ...query, withPage: undefined, limit: undefined, offset: undefined });
    const definitions = Array.isArray(definitionResponse) ? definitionResponse : definitionResponse.items;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();

    const headers = ['序号', '工序名称', '状态', '备注', '创建时间', '更新时间'];
    const worksheet = workbook.addWorksheet('标准工序', {
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
    const titleRow = worksheet.addRow(['标准工序导出']);
    worksheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount);
    titleRow.font = { bold: true, size: 16 };
    titleRow.alignment = { vertical: 'middle', horizontal: 'center' };

    const scopeRow = worksheet.addRow([this.processDefinitionExportScopeText(query, definitions.length)]);
    worksheet.mergeCells(scopeRow.number, 1, scopeRow.number, columnCount);
    scopeRow.font = { color: { argb: 'FF475569' } };
    scopeRow.alignment = { vertical: 'middle', wrapText: true };

    const generatedRow = worksheet.addRow([`制表时间：${this.processDefinitionExportDateTimeText(new Date())}`]);
    worksheet.mergeCells(generatedRow.number, 1, generatedRow.number, columnCount);
    generatedRow.font = { color: { argb: 'FF475569' } };

    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FF0F172A' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.border = this.processDefinitionExportThinBorder();
    });

    definitions.forEach((definition, index) => {
      const row = worksheet.addRow([
        index + 1,
        definition.processName,
        this.processDefinitionExportStatusLabel(definition.status),
        definition.remark || '',
        this.processDefinitionExportDateTimeText(definition.createdAt),
        this.processDefinitionExportDateTimeText(definition.updatedAt)
      ]);
      row.alignment = { vertical: 'top', wrapText: true };
      row.eachCell((cell) => {
        cell.border = this.processDefinitionExportThinBorder();
      });
    });

    [8, 24, 10, 36, 20, 20].forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });
    worksheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: columnCount }
    };

    // 标准工序导出只读取可复用基础资料，不新增、停用或修改订单零件流程快照。
    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
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

    // 标准工序被订单流程、流程记忆、零件默认工艺、BOM 或来源加工关系引用后，不能改名，避免默认工艺建议失效。
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
      // 已被历史订单、流程记忆、零件默认工艺、BOM 或来源加工关系引用的标准工序不能停用，避免后续默认工艺失效。
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
    // 恢复标准工序只恢复后续下拉可选；不会自动修改已保存订单流程、零件默认工艺、BOM 或来源加工关系。
    const restored = await this.prisma.processDefinition.update({
      where: { id },
      data: {
        status: CommonStatus.ENABLED,
        searchText: this.buildSearchText(existing.processName, existing.remark)
      }
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

  private isProcessDefinitionTestFixture(row: { processName?: string | null; remark?: string | null }) {
    const values = [row.processName, row.remark]
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean);
    return values.some((value) => PROCESS_DEFINITION_TEST_FIXTURE_PREFIXES.some((prefix) => value.startsWith(prefix.toUpperCase())));
  }

  private splitDefaultProcessRoute(value?: string | null) {
    return String(value || '')
      .split(/(?:->|→|[、,，;；\n\r]+)/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async findProcessDefinitionReferences(processNameNormalized: string): Promise<ProcessDefinitionReferenceSummary> {
    const [orderSteps, templates, materials, bomLines, transformRules] = await Promise.all([
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
      this.prisma.material.findMany({
        where: { defaultProcessRoute: { not: null } },
        select: {
          defaultProcessRoute: true,
          partCode: true,
          partName: true
        },
        orderBy: { partCode: 'asc' }
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

    for (const material of materials) {
      const processNames = this.splitDefaultProcessRoute(material.defaultProcessRoute);
      if (!processNames.some((processName) => this.normalizeProcessNameKey(processName) === processNameNormalized)) {
        continue;
      }
      addReference(`零件默认工艺 ${material.partCode} / ${material.partName}`);
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
      `标准工序“${processName}”已被${sampleText}${moreText}引用，不能${action}；请先调整对应订单流程、流程记忆、零件默认工艺、BOM 或来源加工关系`
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

  private processDefinitionExportScopeText(query: ProcessDefinitionQueryDto, count: number) {
    const keyword = query.keyword?.trim();
    const status = query.status || CommonStatus.ENABLED;
    const parts = [
      `状态：${status === 'ALL' ? '全部' : this.processDefinitionExportStatusLabel(status)}`,
      keyword ? `关键字：${keyword}` : '关键字：全部',
      `记录数：${count}`
    ];
    return parts.join('；');
  }

  private processDefinitionExportStatusLabel(status: CommonStatus | 'ALL') {
    if (status === CommonStatus.ENABLED) {
      return '启用';
    }
    if (status === CommonStatus.DISABLED) {
      return '停用';
    }
    return '全部';
  }

  private processDefinitionExportDateTimeText(value?: Date | string | null) {
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

  private processDefinitionExportThinBorder(): Partial<ExcelJS.Borders> {
    return {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };
  }
}
