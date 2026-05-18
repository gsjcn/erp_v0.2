import { Injectable } from '@nestjs/common';
import { InventoryReservationStatus, Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { businessDateTimeKey } from '../../common/business-date';
import { decimalToNumber, processSnapshotToDetails } from '../../common/serializers';
import { normalizeSearchKeyword, pinyinSearchMatches } from '../../common/pinyin-search';
import { PrismaService } from '../../prisma/prisma.service';
import { MaterialDashboardQueryDto, MaterialProjectOptionsQueryDto, SaveCommonProjectModelsDto } from './dto';

type DashboardMaterial = Prisma.MaterialGetPayload<{
  include: {
    applicabilities: {
      include: {
        customer: {
          select: {
            id: true;
            customerCode: true;
            customerName: true;
            status: true;
          };
        };
      };
    };
    drawingRevisions: true;
    modelBomLines: {
      include: {
        defaultDrawingRevision: true;
        bom: {
          include: {
            customer: {
              select: {
                id: true;
                customerCode: true;
                customerName: true;
                status: true;
              };
            };
            customerScopes: {
              where: { status: 'ENABLED' };
              select: {
                customerId: true;
                customerNameSnapshot: true;
                status: true;
                customer: {
                  select: {
                    customerCode: true;
                    customerName: true;
                    status: true;
                  };
                };
              };
            };
            lines: {
              where: { status: 'ENABLED' };
              select: {
                id: true;
                sortOrder: true;
                createdAt: true;
                status: true;
                lineType: true;
                componentNo: true;
                parentComponentNo: true;
                material: {
                  select: {
                    status: true;
                  };
                };
              };
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }];
            };
          };
        };
      };
    };
  };
}>;

type DashboardOrderLine = Prisma.OrderLineGetPayload<{
  include: {
    order: {
      include: {
        customer: {
          select: {
            id: true;
            customerCode: true;
            customerName: true;
            status: true;
          };
        };
      };
    };
    processSteps: {
      select: {
        stepNo: true;
        processName: true;
        processRemark: true;
      };
    };
  };
}>;

type InventoryQuantity = {
  availableQuantity: number;
  orderInventoryQuantity: number;
  stockInventoryQuantity: number;
};

const DEFAULT_COMMON_PROJECT_MODELS = ['B3', 'B5'];
const MATERIAL_DASHBOARD_CUSTOMER_PREVIEW_LIMIT = 20;
const MATERIAL_DASHBOARD_PROJECT_MODEL_PREVIEW_LIMIT = 20;
const MATERIAL_DASHBOARD_BOM_NAME_PREVIEW_LIMIT = 20;
const MATERIAL_DASHBOARD_BOM_STRUCTURE_PREVIEW_LIMIT = 10;

@Injectable()
export class MaterialsService {
  private readonly testFixturePrefixes = ['VERIFY-', 'VERIFY_', 'COD-', 'MI-API-', 'MAT-STABLE', 'UPLOAD-FILENAME', 'CUST-SEARCH-', 'TEST-CUSTOMER'];

  constructor(private readonly prisma: PrismaService) {}

  private hasTestFixturePrefix(...values: Array<string | null | undefined>) {
    return values.some((value) => {
      const text = String(value || '').trim();
      return this.testFixturePrefixes.some((prefix) => text.startsWith(prefix));
    });
  }

  private isDisabledTestFixtureMaterial(material: { partCode?: string | null; partName?: string | null; status?: string | null }) {
    return material.status === 'DISABLED' && this.hasTestFixturePrefix(material.partCode, material.partName);
  }

  private isTestFixtureMaterial(material: { partCode?: string | null; partName?: string | null }) {
    return this.hasTestFixturePrefix(material.partCode, material.partName);
  }

  private isArchivedTestFixtureCustomer(customer?: { customerCode?: string | null; customerName?: string | null; status?: string | null } | null) {
    return customer?.status === 'DISABLED' && this.hasTestFixturePrefix(customer.customerCode, customer.customerName);
  }

  async dashboard(query: MaterialDashboardQueryDto) {
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const { allRows, summary } = await this.dashboardData(query);
    const pageRows = allRows.slice(offset, offset + limit).map((row) => this.publicDashboardRow(row));

    return {
      items: pageRows,
      totalCount: allRows.length,
      limit,
      offset,
      hasMore: offset + pageRows.length < allRows.length,
      summary
    };
  }

  async buildDashboardExport(query: MaterialDashboardQueryDto): Promise<Uint8Array> {
    const { allRows, summary } = await this.dashboardData(query);
    const rows = allRows.map((row) => this.publicDashboardRow(row));
    const scopeText = await this.dashboardExportScopeText(query, summary.totalCount);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();

    const headers = [
      '序号',
      '零件编码',
      '零件名称',
      '零件类型',
      '当前关系',
      '适用客户',
      '机型 / 项目',
      '图号',
      '版本',
      '图纸日期',
      '图纸状态',
      '图纸来源',
      '厚度',
      '规格',
      '单位',
      '默认数量',
      '默认工艺',
      '最近订单号',
      '最近下单日期',
      '最近客户',
      '可用库存',
      '订单库存',
      '备货库存',
      '库存报警',
      'BOM',
      'BOM 结构',
      '图纸核对',
      'BOM 核对',
      '库存核对',
      '状态'
    ];
    const worksheet = workbook.addWorksheet('零件控制面板', {
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
    const titleRow = worksheet.addRow(['零件管理控制面板导出']);
    worksheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount);
    titleRow.font = { bold: true, size: 16 };
    titleRow.alignment = { vertical: 'middle', horizontal: 'center' };
    titleRow.height = 26;

    const scopeRow = worksheet.addRow([scopeText]);
    worksheet.mergeCells(scopeRow.number, 1, scopeRow.number, columnCount);
    scopeRow.font = { color: { argb: 'FF475569' } };
    scopeRow.alignment = { vertical: 'middle', wrapText: true };

    const generatedRow = worksheet.addRow([`制表日期：${this.businessDateTimeText(new Date())}`]);
    worksheet.mergeCells(generatedRow.number, 1, generatedRow.number, columnCount);
    generatedRow.font = { color: { argb: 'FF475569' } };

    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FF0F172A' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.border = this.dashboardExportThinBorder();
    });

    rows.forEach((row, index) => {
      const dataRow = worksheet.addRow([
        index + 1,
        row.partCode,
        row.partName,
        row.partType || row.scopeLabel,
        row.currentRelationLabel || '-',
        this.dashboardExportCustomerScopeText(row),
        this.dashboardExportProjectScopeText(row),
        row.drawingNo || '',
        row.drawingVersion || '',
        row.drawingDate || '',
        row.drawingStatus || '',
        row.drawingSourceLabel || '',
        row.partThickness ?? '',
        row.partSpecification || '',
        row.unit,
        row.defaultQuantity ?? '',
        this.dashboardExportProcessRouteText(row.defaultProcessRoute),
        row.lastOrderNo || '',
        row.lastOrderDate || '',
        row.lastCustomerName || '',
        row.availableQuantity,
        row.orderInventoryQuantity,
        row.stockInventoryQuantity,
        this.dashboardExportStockAlertText(row),
        this.joinDashboardExportValues(this.dashboardBomNameValues(row), '', 10, 'BOM', row.bomNameCount),
        this.dashboardExportBomStructureText(row),
        this.dashboardExportDrawingReviewText(row),
        this.dashboardExportBomReviewText(row),
        this.dashboardExportInventoryReviewText(row),
        row.status === 'ENABLED' ? '启用' : '停用'
      ]);
      dataRow.alignment = { vertical: 'top', wrapText: true };
      dataRow.eachCell((cell) => {
        cell.border = this.dashboardExportThinBorder();
      });
    });

    headers.forEach((header, index) => {
      const column = worksheet.getColumn(index + 1);
      const maxLength = [header, ...worksheet.getColumn(index + 1).values.slice(5)]
        .map((value) => this.dashboardExportDisplayWidth(value))
        .reduce((max, width) => Math.max(max, width), 0);
      column.width = Math.min(Math.max(maxLength + 2, 8), 34);
    });

    worksheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: columnCount }
    };

    // 零件管理导出只导出现有筛选结果，不写入零件、BOM、订单、生产任务或库存流水。
    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  private async dashboardData(query: MaterialDashboardQueryDto) {
    const sortBy = query.sortBy || 'LAST_ORDER_DATE';
    const sortOrder = query.sortOrder || 'DESC';
    const includeTestFixtures = query.includeTestFixtures === 'true';
    const materials = (await this.findDashboardMaterials(query.status)).filter(
      (material) => includeTestFixtures || !this.isTestFixtureMaterial(material)
    );
    const partCodeConditions = materials.map((material) => ({
      partCode: { equals: material.partCode, mode: 'insensitive' as const }
    }));
    const [orderLines, quantityByCode] = await Promise.all([
      partCodeConditions.length > 0 ? this.findOrderLines(partCodeConditions) : Promise.resolve([]),
      partCodeConditions.length > 0 ? this.inventoryQuantityByCode(partCodeConditions) : Promise.resolve(new Map<string, InventoryQuantity>())
    ]);
    const visibleOrderLines = includeTestFixtures
      ? orderLines
      : orderLines.filter(
          (line) =>
            !this.hasTestFixturePrefix(line.partCode, line.partName, line.projectModel, line.order.orderNo) &&
            !this.isArchivedTestFixtureCustomer(line.order.customer)
        );
    const historyByCode = this.groupHistoryByCode(visibleOrderLines);
    const allRows = materials
      .map((material) => this.buildDashboardRow(material, historyByCode.get(this.codeKey(material.partCode)) || [], quantityByCode, query))
      .filter((row) => this.rowMatchesQuery(row, query))
      .sort((a, b) => this.compareDashboardRows(a, b, sortBy, sortOrder));
    const summary = {
      totalCount: allRows.length,
      enabledCount: allRows.filter((row) => row.status === 'ENABLED').length,
      disabledCount: allRows.filter((row) => row.status === 'DISABLED').length,
      commonCount: allRows.filter((row) => row.scopeType === 'COMMON').length,
      customCount: allRows.filter((row) => row.scopeType === 'CUSTOM').length,
      withBomCount: allRows.filter((row) => this.dashboardRowHasBom(row)).length,
      withoutBomCount: allRows.filter((row) => !this.dashboardRowHasBom(row)).length,
      withRecentOrderCount: allRows.filter((row) => row.lastOrderDate).length,
      withoutRecentOrderCount: allRows.filter((row) => !row.lastOrderDate).length,
      relationCounts: this.dashboardCountMap(allRows.map((row) => row.currentRelationType)),
      drawingSourceCounts: this.dashboardCountMap(allRows.map((row) => row.drawingSource || 'NONE')),
      bomStructureCounts: this.dashboardCountMap(allRows.flatMap((row) => (row.bomStructureTypes.length > 0 ? row.bomStructureTypes : ['NONE']))),
      stockAlertCounts: {
        ENABLED: allRows.filter((row) => row.stockAlertEnabled).length,
        TRIGGERED: allRows.filter((row) => row.stockAlertTriggered).length,
        DISABLED: allRows.filter((row) => !row.stockAlertEnabled).length
      }
    };
    return { allRows, summary };
  }

  private async dashboardExportScopeText(query: MaterialDashboardQueryDto, totalCount: number) {
    const customerLabel = await this.dashboardExportCustomerLabel(query.customerId);
    return [
      `筛选结果：${totalCount} 条`,
      `客户：${customerLabel}`,
      `机型 / 项目：${query.projectModel?.trim() || '全部'}`,
      `关键字：${query.keyword?.trim() || '无'}`,
      `通用 / 定制：${this.dashboardExportScopeTypeLabel(query.scopeType)}`,
      `当前关系：${this.dashboardExportRelationTypeLabel(query.relationType)}`,
      `图号：${query.drawingNo?.trim() || '全部'}`,
      `图纸状态：${query.drawingStatus?.trim() || '全部'}`,
      `图纸来源：${this.dashboardExportDrawingSourceLabel(query.drawingSource)}`,
      `图纸日期：${this.dashboardExportDateRangeLabel(query.drawingDateFrom, query.drawingDateTo)}`,
      `BOM 结构：${this.dashboardExportBomStructureLabel(query.bomStructureType)}`,
      `BOM 状态：${this.dashboardExportBomPresenceLabel(query.bomPresence)}`,
      `下单记录：${this.dashboardExportRecentOrderPresenceLabel(query.recentOrderPresence)}`,
      `最近下单日期：${this.dashboardExportDateRangeLabel(query.lastOrderDateFrom, query.lastOrderDateTo)}`,
      `库存报警：${this.dashboardExportStockAlertFilterLabel(query.stockAlert)}`,
      `状态：${this.dashboardExportStatusLabel(query.status)}`,
      `排序：${this.dashboardExportSortByLabel(query.sortBy)} / ${this.dashboardExportSortOrderLabel(query.sortOrder)}`
    ].join('；');
  }

  private async dashboardExportCustomerLabel(customerId?: string) {
    const id = customerId?.trim();
    if (!id) {
      return '全部';
    }
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { customerCode: true, customerName: true }
    });
    // 导出范围必须给操作员可读客户名；找不到客户时保留 id 便于排查历史筛选链接。
    return customer ? `${customer.customerName}（${customer.customerCode}）` : id;
  }

  private dashboardExportScopeTypeLabel(value?: MaterialDashboardQueryDto['scopeType']) {
    return value === 'COMMON' ? '通用件' : value === 'CUSTOM' ? '定制件' : '全部';
  }

  private dashboardExportRelationTypeLabel(value?: MaterialDashboardQueryDto['relationType']) {
    const labels: Record<string, string> = {
      BOM: 'BOM 零件',
      APPLICABILITY: '显式适用',
      ORDER_HISTORY: '订单历史',
      MATERIAL_ONLY: '仅搜索记忆'
    };
    return labels[value || ''] || '全部';
  }

  private dashboardExportDrawingSourceLabel(value?: MaterialDashboardQueryDto['drawingSource']) {
    const labels: Record<string, string> = {
      BOM_LINE: 'BOM 指定图纸',
      MATERIAL_DEFAULT: '零件默认图纸',
      MATERIAL_LATEST: '零件最新图纸',
      ORDER_HISTORY: '历史订单图纸',
      NONE: '无图纸'
    };
    return labels[value || ''] || '全部';
  }

  private dashboardExportBomStructureLabel(value?: MaterialDashboardQueryDto['bomStructureType']) {
    const labels: Record<string, string> = {
      COMPONENT: '组件',
      CHILD_PART: '子零件',
      STANDALONE_PART: '单独零件',
      NONE: '未进 BOM'
    };
    return labels[value || ''] || '全部';
  }

  private dashboardExportBomPresenceLabel(value?: MaterialDashboardQueryDto['bomPresence']) {
    return value === 'WITH_BOM' ? '已进 BOM' : value === 'WITHOUT_BOM' ? '未进 BOM' : '全部';
  }

  private dashboardExportRecentOrderPresenceLabel(value?: MaterialDashboardQueryDto['recentOrderPresence']) {
    return value === 'WITH_RECENT_ORDER' ? '有历史下单' : value === 'WITHOUT_RECENT_ORDER' ? '无历史下单' : '全部';
  }

  private dashboardExportStockAlertFilterLabel(value?: MaterialDashboardQueryDto['stockAlert']) {
    return value === 'ENABLED' ? '已启用' : value === 'TRIGGERED' ? '低库存' : value === 'DISABLED' ? '未启用' : '全部';
  }

  private dashboardExportStatusLabel(value?: MaterialDashboardQueryDto['status']) {
    return value === 'ENABLED' ? '启用' : value === 'DISABLED' ? '停用' : '全部';
  }

  private dashboardExportSortByLabel(value?: MaterialDashboardQueryDto['sortBy']) {
    return (
      {
        LAST_ORDER_DATE: '最近下单',
        DRAWING_DATE: '图纸日期',
        BOM_STATUS: 'BOM 状态',
        PART_CODE: '零件编码'
      }[value || 'LAST_ORDER_DATE'] || '最近下单'
    );
  }

  private dashboardExportSortOrderLabel(value?: MaterialDashboardQueryDto['sortOrder']) {
    return value === 'ASC' ? '升序' : '降序';
  }

  private dashboardExportDateRangeLabel(from?: string, to?: string) {
    const start = from?.trim();
    const end = to?.trim();
    if (start && end) {
      return `${start} 至 ${end}`;
    }
    if (start) {
      return `${start} 起`;
    }
    if (end) {
      return `${end} 止`;
    }
    return '全部';
  }

  private dashboardExportProjectScopeText(row: Record<string, any>) {
    const values = this.uniqueList([row.hasGlobalProjectScope ? '全部机型/项目' : '', ...(row.projectModels || [])]);
    const projectCount = Math.max(Number(row.projectModelCount || 0), Array.isArray(row.projectModels) ? row.projectModels.length : 0);
    const totalCount = projectCount + (row.hasGlobalProjectScope ? 1 : 0);
    if (totalCount <= 0) {
      const historyValues = this.uniqueList(row.historyProjectModels || []);
      const historyCount = Math.max(Number(row.historyProjectModelCount || 0), historyValues.length);
      if (historyCount > 0) {
        const preview = historyValues.filter((_, index) => index < 10).join('、') || `${historyCount} 个机型/项目`;
        return historyCount > historyValues.length || historyValues.length > 10
          ? `仅订单历史 ${preview} 等 ${historyCount} 个机型/项目`
          : `仅订单历史 ${preview}`;
      }
      return '未设置机型/项目';
    }
    const preview = values.filter((_, index) => index < 10).join('、') || '全部机型/项目';
    return totalCount > values.length || values.length > 10 ? `${preview} 等 ${totalCount} 个机型/项目` : preview;
  }

  private dashboardExportCustomerScopeText(row: Record<string, any>) {
    if (row.customerScopeKind === 'ALL' || row.hasGlobalCustomerScope) {
      return '全部客户';
    }
    const values = this.uniqueList(row.customerNames || []);
    const customerCount = Math.max(Number(row.customerNameCount || 0), values.length);
    if (customerCount > 0) {
      const preview = values.filter((_, index) => index < 10).join('、') || `${customerCount} 个客户`;
      return customerCount > values.length || values.length > 10 ? `${preview} 等 ${customerCount} 个客户` : preview;
    }
    const historyValues = this.uniqueList(row.historyCustomerNames || []);
    const historyCount = Math.max(Number(row.historyCustomerCount || 0), historyValues.length);
    if (historyCount > 0) {
      const preview = historyValues.filter((_, index) => index < 10).join('、') || `${historyCount} 个客户`;
      return historyCount > historyValues.length || historyValues.length > 10
        ? `仅订单历史 ${preview} 等 ${historyCount} 个客户`
        : `仅订单历史 ${preview}`;
    }
    return '未设置适用客户';
  }

  private dashboardExportStockAlertText(row: Record<string, any>) {
    if (!row.stockAlertEnabled) {
      return '未启用';
    }
    const quantity = row.stockAlertQuantity === null || row.stockAlertQuantity === undefined ? '' : `${row.stockAlertQuantity} ${row.unit || ''}`.trim();
    return row.stockAlertTriggered ? `低库存：${quantity || '-'}` : `报警线：${quantity || '-'}`;
  }

  private dashboardExportDrawingReviewText(row: Record<string, any>) {
    if (!row.drawingNo) {
      return '需补图纸资料';
    }
    if (row.drawingSource === 'ORDER_HISTORY') {
      return '历史订单图纸，建议维护零件图纸版本';
    }
    if (row.drawingSource === 'BOM_LINE') {
      return 'BOM 指定图纸';
    }
    if (row.drawingSource === 'MATERIAL_DEFAULT') {
      return '零件默认图纸';
    }
    if (row.drawingSource === 'MATERIAL_LATEST') {
      return '零件最新启用图纸';
    }
    return row.drawingSourceLabel || '已核对';
  }

  private dashboardExportBomReviewText(row: Record<string, any>) {
    if (!this.dashboardRowHasBom(row)) {
      return '未进 BOM';
    }
    const structureText = this.dashboardExportBomStructureText(row);
    if (!structureText) {
      return 'BOM 已关联，结构待核对';
    }
    return `BOM 已关联：${structureText}`;
  }

  private dashboardExportInventoryReviewText(row: Record<string, any>) {
    const available = this.dashboardExportQuantityText(row.availableQuantity, row.unit);
    if (!row.stockAlertEnabled) {
      return `未启用库存报警；当前可用 ${available}`;
    }
    const alertQuantity = this.dashboardExportQuantityText(row.stockAlertQuantity, row.unit);
    // 库存核对列只提示人工复核，不自动补单、提交生产、扣库存或写入 InventoryTransaction。
    return row.stockAlertTriggered ? `低库存：可用 ${available} / 报警线 ${alertQuantity}` : `报警线 ${alertQuantity}；当前可用 ${available}`;
  }

  private dashboardExportQuantityText(value: unknown, unit?: string) {
    if (value === null || value === undefined || value === '') {
      return '-';
    }
    return `${value} ${unit || ''}`.trim();
  }

  private dashboardExportProcessRouteText(value?: string | null) {
    const routeText = String(value || '').trim();
    if (!routeText) {
      return '';
    }
    const steps = routeText
      .split(/(?:->|>|→|[、,，;；\n\r]+)/)
      .map((step) => step.trim())
      .filter(Boolean);
    if (steps.length <= 1) {
      return routeText;
    }
    const preview = steps.filter((_, index) => index < 10).join('、');
    return steps.length > 10 ? `${preview} 等 ${steps.length} 个工序` : preview;
  }

  private joinDashboardExportValues(values: Array<string | null | undefined>, emptyText = '-', limit = 10, unitLabel = '项', totalCount?: number) {
    const filtered = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
    if (filtered.length === 0) {
      return emptyText;
    }
    const preview = filtered.filter((_, index) => index < limit).join('、');
    const displayCount = Math.max(Number(totalCount || 0), filtered.length);
    return displayCount > filtered.length || filtered.length > limit ? `${preview} 等 ${displayCount} 个${unitLabel}` : preview;
  }

  private dashboardBomNameValues(row: Record<string, any>) {
    return this.uniqueList([
      ...(row.bomNames || []),
      ...(row.bomStructureDetails || []).map((detail: Record<string, any>) => detail.bomName)
    ]);
  }

  private dashboardExportBomStructureText(row: Record<string, any>) {
    const details = Array.isArray(row.bomStructureDetails) ? row.bomStructureDetails : [];
    const detailCount = Math.max(Number(row.bomStructureDetailCount || 0), details.length);
    if (detailCount > 0) {
      const detailTexts = details.map((detail: Record<string, any>) => this.dashboardExportBomStructureDetailText(detail));
      if (detailTexts.length === 0) {
        return `共 ${detailCount} 条，预览未展开`;
      }
      return this.joinDashboardExportValues(detailTexts, '', 10, '结构', detailCount);
    }
    return this.joinDashboardExportValues(row.bomStructureLabels || [], '', 10, '结构');
  }

  private dashboardExportBomStructureDetailText(detail: Record<string, any>) {
    const bomName = String(detail.bomName || '未命名 BOM').trim();
    const customerName = String(detail.customerName || '').trim() || '全部客户';
    const projectModel = String(detail.projectModel || '').trim() || '全部机型/项目';
    const structureLabel = String(detail.structureLabel || '').trim() || '未设置结构';
    const orderText = detail.displayOrder ? ` / 顺序 ${detail.displayOrder}` : '';
    return `${bomName} / ${customerName} / ${projectModel} / ${structureLabel}${orderText}`;
  }

  private dashboardRowHasBom(row: Record<string, any>) {
    return (
      this.dashboardBomNameValues(row).length > 0 ||
      Boolean(row.bomStructureLabels?.length) ||
      Number(row.bomStructureDetailCount || 0) > 0
    );
  }

  private dashboardExportDisplayWidth(value: unknown) {
    const text = String(value ?? '');
    return [...text].reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
  }

  private dashboardExportThinBorder() {
    return {
      top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } }
    };
  }

  private businessDateTimeText(value: Date) {
    const stamp = businessDateTimeKey(value);
    // 零件管理导出时间按公司业务时区展示，避免 NAS / Docker 默认 UTC 造成现场核对偏差。
    return stamp.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6');
  }

  async projectModels(query: MaterialProjectOptionsQueryDto) {
    const customerId = query.customerId?.trim();
    const includeTestFixtures = query.includeTestFixtures === 'true';
    const [applicabilities, boms, orderLines] = await Promise.all([
      this.prisma.materialApplicability.findMany({
        where: {
          status: 'ENABLED',
          ...(customerId ? { OR: [{ customerId }, { customerId: null }] } : {})
        },
        select: {
          projectModel: true,
          customer: {
            select: {
              customerCode: true,
              customerName: true,
              status: true
            }
          }
        }
      }),
      this.prisma.modelBom.findMany({
        where: {
          status: 'ENABLED',
          ...(customerId
            ? {
                OR: [
                  { customerId },
                  { customerId: null, customerScopeMode: 'ALL' },
                  { customerId: null, customerScopeMode: 'SELECTED', customerScopes: { some: { customerId, status: 'ENABLED' } } }
                ]
              }
            : {})
        },
        select: {
          bomName: true,
          projectModel: true,
          customer: {
            select: {
              customerCode: true,
              customerName: true,
              status: true
            }
          },
          customerScopes: {
            where: { status: 'ENABLED' },
            select: {
              customerNameSnapshot: true,
              customer: {
                select: {
                  customerCode: true,
                  customerName: true,
                  status: true
                }
              }
            }
          }
        }
      }),
      this.prisma.orderLine.findMany({
        where: {
          projectModel: { not: null },
          ...(customerId ? { order: { customerId } } : {})
        },
        select: {
          projectModel: true,
          createdAt: true,
          order: {
            select: {
              orderDate: true,
              customer: {
                select: {
                  customerCode: true,
                  customerName: true,
                  status: true
                }
              }
            }
          }
        }
      })
    ]);
    const visibleApplicabilities = includeTestFixtures ? applicabilities : applicabilities.filter((row) => !this.isArchivedTestFixtureCustomer(row.customer));
    const visibleBoms = includeTestFixtures
      ? boms
      : boms.filter(
          (row) =>
            !this.hasTestFixturePrefix(row.bomName, row.projectModel) &&
            !this.isArchivedTestFixtureCustomer(row.customer) &&
            !row.customerScopes.some((scope) => this.isArchivedTestFixtureCustomer(scope.customer))
        );
    const visibleOrderLines = includeTestFixtures
      ? orderLines
      : orderLines.filter((row) => !this.hasTestFixturePrefix(row.projectModel) && !this.isArchivedTestFixtureCustomer(row.order.customer));

    const scoreByProject = new Map<
      string,
      {
        value: string;
        orderCount: number;
        bomCount: number;
        applicabilityCount: number;
        latestOrderTime: number;
      }
    >();
    const ensureProjectScore = (projectModel?: string | null) => {
      const value = projectModel?.trim();
      if (!value) {
        return null;
      }
      const key = normalizeSearchKeyword(value);
      const current =
        scoreByProject.get(key) ||
        {
          value,
          orderCount: 0,
          bomCount: 0,
          applicabilityCount: 0,
          latestOrderTime: 0
        };
      scoreByProject.set(key, current);
      return current;
    };

    // 客户常用机型按历史下单和 BOM/适用范围热度排序，避免快捷入口静默展示无业务依据的前几项。
    for (const row of visibleOrderLines) {
      const score = ensureProjectScore(row.projectModel);
      if (!score) {
        continue;
      }
      score.orderCount += 1;
      score.latestOrderTime = Math.max(score.latestOrderTime, row.order.orderDate?.getTime() || row.createdAt.getTime());
    }
    for (const row of visibleBoms) {
      const score = ensureProjectScore(row.projectModel);
      if (!score) {
        continue;
      }
      score.bomCount += 1;
    }
    for (const row of visibleApplicabilities) {
      const score = ensureProjectScore(row.projectModel);
      if (!score) {
        continue;
      }
      score.applicabilityCount += 1;
    }

    return [...scoreByProject.values()]
      .sort((a, b) => {
        if (a.orderCount !== b.orderCount) {
          return b.orderCount - a.orderCount;
        }
        if (a.latestOrderTime !== b.latestOrderTime) {
          return b.latestOrderTime - a.latestOrderTime;
        }
        const aMasterCount = a.bomCount + a.applicabilityCount;
        const bMasterCount = b.bomCount + b.applicabilityCount;
        if (aMasterCount !== bMasterCount) {
          return bMasterCount - aMasterCount;
        }
        return a.value.localeCompare(b.value, 'zh-Hans-CN');
      })
      .map((item) => item.value);
  }

  async commonProjectModels() {
    const [enabledRows, totalCount] = await Promise.all([
      this.prisma.materialCommonProjectModel.findMany({
        where: { status: 'ENABLED' },
        orderBy: [{ sortOrder: 'asc' }, { projectModelNormalized: 'asc' }],
        select: { projectModel: true }
      }),
      this.prisma.materialCommonProjectModel.count()
    ]);
    if (enabledRows.length > 0) {
      return enabledRows.map((row) => row.projectModel);
    }
    return totalCount === 0 ? DEFAULT_COMMON_PROJECT_MODELS : [];
  }

  async saveCommonProjectModels(dto: SaveCommonProjectModelsDto) {
    const projectModels = this.normalizeCommonProjectModels(dto.projectModels || []);
    await this.prisma.$transaction(async (tx) => {
      // 常用机型只控制零件管理快捷入口，不修改 BOM、零件适用范围、订单或库存。
      await tx.materialCommonProjectModel.updateMany({
        data: { status: 'DISABLED' }
      });
      for (const [index, projectModel] of projectModels.entries()) {
        await tx.materialCommonProjectModel.upsert({
          where: { projectModelNormalized: this.commonProjectModelKey(projectModel) },
          update: {
            projectModel,
            sortOrder: index + 1,
            status: 'ENABLED'
          },
          create: {
            projectModel,
            projectModelNormalized: this.commonProjectModelKey(projectModel),
            sortOrder: index + 1,
            status: 'ENABLED'
          }
        });
      }
    });
    return projectModels;
  }

  private normalizeCommonProjectModels(values: string[]) {
    const seenKeys = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const projectModel = String(value || '').trim();
      const key = this.commonProjectModelKey(projectModel);
      if (!projectModel || seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      result.push(projectModel);
    }
    return result;
  }

  private commonProjectModelKey(projectModel: string) {
    return projectModel.trim().toLocaleLowerCase('zh-CN');
  }

  private findDashboardMaterials(status?: MaterialDashboardQueryDto['status']) {
    return this.prisma.material.findMany({
      where: status && status !== 'ALL' ? { status } : {},
      include: {
        applicabilities: {
          include: {
            customer: {
              select: {
                id: true,
                customerCode: true,
                customerName: true,
                status: true
              }
            }
          }
        },
        drawingRevisions: {
          where: { status: 'ENABLED' },
          orderBy: [{ isDefault: 'desc' }, { drawingDate: 'desc' }, { createdAt: 'desc' }]
        },
        modelBomLines: {
          include: {
            defaultDrawingRevision: true,
            bom: {
              include: {
                customer: {
                  select: {
                    id: true,
                    customerCode: true,
                    customerName: true,
                    status: true
                  }
                },
                customerScopes: {
                  where: { status: 'ENABLED' },
                  select: {
                    customerId: true,
                    customerNameSnapshot: true,
                    status: true,
                    customer: {
                      select: {
                        customerCode: true,
                        customerName: true,
                        status: true
                      }
                    }
                  }
                },
                lines: {
                  where: { status: 'ENABLED' },
                  select: {
                    id: true,
                    sortOrder: true,
                    createdAt: true,
                    status: true,
                    lineType: true,
                    componentNo: true,
                    parentComponentNo: true,
                    material: {
                      select: {
                        status: true
                      }
                    }
                  },
                  orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
                }
              }
            }
          }
        }
      },
      orderBy: [{ partCode: 'asc' }, { id: 'asc' }]
    });
  }

  private findOrderLines(partCodeConditions: Prisma.OrderLineWhereInput[]) {
    return this.prisma.orderLine.findMany({
      where: { OR: partCodeConditions },
      include: {
        order: {
          include: {
            customer: {
              select: {
                id: true,
                customerCode: true,
                customerName: true,
                status: true
              }
            }
          }
        },
        processSteps: {
          select: {
            stepNo: true,
            processName: true,
            processRemark: true
          },
          orderBy: [{ stepNo: 'asc' }]
        }
      },
      orderBy: [{ createdAt: 'desc' }]
    });
  }

  private async inventoryQuantityByCode(partCodeConditions: Prisma.InventoryBatchWhereInput[]) {
    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        status: 'AVAILABLE',
        quantity: { gt: 0 },
        OR: partCodeConditions
      },
      select: {
        id: true,
        partCode: true,
        quantity: true,
        sourceOrderId: true
      }
    });
    const stockBatchIds = batches.filter((batch) => !batch.sourceOrderId).map((batch) => batch.id);
    const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(stockBatchIds);
    const quantityByCode = new Map<string, InventoryQuantity>();

    for (const batch of batches) {
      const key = this.codeKey(batch.partCode);
      const current = quantityByCode.get(key) || {
        availableQuantity: 0,
        orderInventoryQuantity: 0,
        stockInventoryQuantity: 0
      };
      const reservedQuantity = batch.sourceOrderId ? 0 : (reservedQuantityByBatchId.get(batch.id) ?? 0);
      const quantity = Math.max(decimalToNumber(batch.quantity) - reservedQuantity, 0);
      current.availableQuantity += quantity;
      if (batch.sourceOrderId) {
        current.orderInventoryQuantity += quantity;
      } else {
        current.stockInventoryQuantity += quantity;
      }
      quantityByCode.set(key, current);
    }

    return quantityByCode;
  }

  private async activeReservationQuantityByBatchId(batchIds: string[]) {
    if (batchIds.length === 0) {
      return new Map<string, number>();
    }
    const rows = await this.prisma.inventoryReservation.groupBy({
      by: ['batchId'],
      where: {
        batchId: { in: batchIds },
        status: InventoryReservationStatus.ACTIVE
      },
      _sum: { quantity: true }
    });
    return new Map(rows.map((row) => [row.batchId, decimalToNumber(row._sum.quantity)]));
  }

  private groupHistoryByCode(orderLines: DashboardOrderLine[]) {
    const historyByCode = new Map<string, DashboardOrderLine[]>();
    for (const line of orderLines) {
      const key = this.codeKey(line.partCode);
      const rows = historyByCode.get(key) || [];
      rows.push(line);
      historyByCode.set(key, rows);
    }
    for (const rows of historyByCode.values()) {
      rows.sort((a, b) => {
        const aOrderTime = a.order.orderDate?.getTime() || 0;
        const bOrderTime = b.order.orderDate?.getTime() || 0;
        if (aOrderTime !== bOrderTime) {
          return bOrderTime - aOrderTime;
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    }
    return historyByCode;
  }

  private buildDashboardRow(
    material: DashboardMaterial,
    history: DashboardOrderLine[],
    quantityByCode: Map<string, InventoryQuantity>,
    query: MaterialDashboardQueryDto
  ) {
    const key = this.codeKey(material.partCode);
    const hasScopedDashboardContext = Boolean(query.customerId?.trim() || query.projectModel?.trim());
    const selectedCustomerId = query.customerId?.trim();
    const includeTestFixtures = query.includeTestFixtures === 'true';
    const matchingHistory = this.historyMatchingContext(history, query);
    const displayHistoryRows = hasScopedDashboardContext ? matchingHistory : history;
    const displayHistory = displayHistoryRows[0];
    const activeApplicabilities = material.applicabilities.filter(
      (item) =>
        item.status === 'ENABLED' &&
        (includeTestFixtures ||
          (!this.hasTestFixturePrefix(item.projectModel) && !this.isArchivedTestFixtureCustomer(item.customer)))
    );
    const customerScopedApplicabilities = selectedCustomerId
      ? activeApplicabilities.filter((item) => !item.customerId || item.customerId === selectedCustomerId)
      : activeApplicabilities;
    const matchingApplicabilities = this.applicabilitiesMatchingContext(activeApplicabilities, query);
    const displayApplicabilities = hasScopedDashboardContext ? matchingApplicabilities : activeApplicabilities;
    const activeBomLines = material.modelBomLines.filter(
      (line) =>
        line.status === 'ENABLED' &&
        line.bom.status === 'ENABLED' &&
        (includeTestFixtures ||
          (!this.hasTestFixturePrefix(line.bom.bomName, line.bom.projectModel) &&
            !this.isArchivedTestFixtureCustomer(line.bom.customer) &&
            !line.bom.customerScopes.some((scope) => this.isArchivedTestFixtureCustomer(scope.customer))))
    );
    const customerScopedBomLines = selectedCustomerId
      ? activeBomLines.filter((line) => this.bomLineMatchesCustomerScope(line, selectedCustomerId, { excludeGlobalAllProject: true }))
      : activeBomLines;
    const matchingBomLines = this.bomLinesMatchingContext(activeBomLines, query);
    // 零件管理按客户/机型筛选时，BOM 展示只看当前上下文，避免其他客户 BOM 混入当前查看范围。
    const displayBomLines = hasScopedDashboardContext ? matchingBomLines : activeBomLines;
    const matchedBomLine = this.pickBomLine(activeBomLines, query);
    const materialDrawing = this.pickMaterialDrawingRevision(material.drawingRevisions);
    const bomDrawing = this.pickBomDrawingRevision(matchedBomLine);
    const displayDrawing = bomDrawing || materialDrawing || displayHistory;
    const drawingSource = this.dashboardDrawingSource(bomDrawing, materialDrawing, displayHistory);
    const bomStructureTypes = this.uniqueList(displayBomLines.map((line) => this.dashboardBomStructureType(line) || '')) as Array<
      'COMPONENT' | 'CHILD_PART' | 'STANDALONE_PART'
    >;
    const bomStructureLabels = this.uniqueList(displayBomLines.map((line) => this.dashboardBomStructureLabel(line)));
    const bomStructureDetails = this.dashboardBomStructureDetails(displayBomLines);
    const bomStructureDetailCount = bomStructureDetails.length;
    const currentRelation = this.dashboardCurrentRelation({
      hasScopedDashboardContext,
      displayBomLines,
      displayApplicabilities,
      displayHistoryRows
    });
    const quantity = quantityByCode.get(key) || {
      availableQuantity: 0,
      orderInventoryQuantity: 0,
      stockInventoryQuantity: 0
    };
    const stockAlertQuantity =
      material.stockAlertQuantity === null || material.stockAlertQuantity === undefined ? null : decimalToNumber(material.stockAlertQuantity);
    const stockAlertEnabled = Boolean(material.stockAlertEnabled);
    const scopeCustomerNames = this.uniqueList([
      ...displayApplicabilities.map((item) => item.customer?.customerName || item.customerNameSnapshot || ''),
      ...displayBomLines.flatMap((line) => this.bomCustomerScopeNames(line))
    ]);
    const historyCustomerNames = this.uniqueList(displayHistoryRows.map((line) => line.order.customerName));
    const formalProjectModels = this.uniqueList([
      ...displayApplicabilities.map((item) => item.projectModel || ''),
      ...displayBomLines.map((line) => line.bom.projectModel)
    ]);
    const historyProjectModels = this.uniqueList(displayHistoryRows.map((line) => line.projectModel || ''));
    const targetBomProjectModel = query.projectModel?.trim() || (formalProjectModels.length === 1 ? formalProjectModels[0] : '');
    const currentScopeBomLineCount = targetBomProjectModel
      ? displayBomLines.filter((line) => {
          const customerMatches = selectedCustomerId
            ? this.bomLineMatchesCustomerScope(line, selectedCustomerId)
            : this.bomLineHasGlobalCustomerScope(line);
          const projectMatches =
            line.bom.projectModelScopeKey === 'ALL' ||
            normalizeSearchKeyword(line.bom.projectModel) === normalizeSearchKeyword(targetBomProjectModel);
          return (
            customerMatches &&
            projectMatches
          );
        }).length
      : 0;
    const projectScopeEntries = [
      ...customerScopedApplicabilities.map((item) => ({
        customerId: item.customerId || null,
        projectModel: item.projectModel || '',
        hasGlobalProjectScope: !item.projectModel
      })),
      ...customerScopedBomLines.map((line) => ({
        customerId: line.bom.customerId || null,
        projectModel: line.bom.projectModel || '',
        hasGlobalProjectScope: !line.bom.projectModel || line.bom.projectModelScopeKey === 'ALL'
      }))
    ];
    const bomNames = this.uniqueList(displayBomLines.map((line) => line.bom.bomName));
      const hasGlobalProjectScope = projectScopeEntries.some(
        (entry) => entry.hasGlobalProjectScope && this.projectScopeMatchesCustomer(entry.customerId, selectedCustomerId)
      );
      const hasGlobalCustomerScope =
        customerScopedApplicabilities.some((item) => !item.customerId) ||
        customerScopedBomLines.some((line) => this.bomLineHasGlobalCustomerScope(line));
      const hasFormalScope = displayApplicabilities.length > 0 || displayBomLines.length > 0;
      const hasCustomerSpecificScope =
        !hasGlobalCustomerScope &&
        (displayApplicabilities.some((item) => item.customerId) ||
          displayBomLines.some((line) => line.bom.customerId || line.bom.customerScopeMode === 'SELECTED'));
      const hasHistoryCustomScope = !hasFormalScope && displayHistoryRows.some((line) => String(line.partCategory || '').includes('定制'));
      const hasCustomScope = hasCustomerSpecificScope || hasHistoryCustomScope;
      const displayPartType = hasFormalScope ? (hasCustomScope ? '定制件' : '通用件') : displayHistory?.partCategory || (hasCustomScope ? '定制件' : '通用件');
      const currentCustomerUsageCount = query.customerId
        ? history.filter((line) => line.order.customerId === query.customerId).length
        : 0;
      const publicScopeCustomerNames = hasGlobalCustomerScope ? [] : scopeCustomerNames;
      const publicScopeCustomerNameCount = hasGlobalCustomerScope ? 0 : scopeCustomerNames.length;
      const publicProjectModels = hasGlobalProjectScope ? [] : formalProjectModels;
      const publicProjectModelCount = hasGlobalProjectScope ? 0 : formalProjectModels.length;
    const searchParts = this.searchParts(material, displayHistoryRows, displayApplicabilities, displayBomLines);

    return {
      id: material.id,
      partCode: material.partCode,
      partName: material.partName,
      partType: displayPartType,
      unit: material.unit,
      partSpecification: displayHistory?.partSpecification || material.partSpecification,
      status: material.status,
      scopeType: hasCustomScope ? 'CUSTOM' : 'COMMON',
      scopeLabel: hasCustomScope ? '定制件' : '通用件',
      currentRelationType: currentRelation.type,
      currentRelationLabel: currentRelation.label,
      currentRelationDescription: currentRelation.description,
      // 客户列只表达正式适用范围或 BOM 范围；历史订单客户单独返回，避免通用件把所有使用过的客户铺满列表。
      customerNames: publicScopeCustomerNames,
      customerNameCount: publicScopeCustomerNameCount,
      customerScopeLabel: this.dashboardCustomerScopeLabel(hasGlobalCustomerScope, scopeCustomerNames, historyCustomerNames),
      customerScopeKind: hasGlobalCustomerScope ? 'ALL' : scopeCustomerNames.length > 0 ? 'SCOPED' : historyCustomerNames.length > 0 ? 'ORDER_HISTORY' : 'NONE',
      historyCustomerNames,
      historyCustomerCount: historyCustomerNames.length,
      customerIds: this.uniqueList([
        ...customerScopedApplicabilities.map((item) => item.customerId || ''),
        ...customerScopedBomLines.flatMap((line) => this.bomCustomerScopeIds(line)),
        ...history.map((line) => line.order.customerId)
      ]),
      hasGlobalCustomerScope,
      projectModels: publicProjectModels,
      projectModelCount: publicProjectModelCount,
      historyProjectModels,
      historyProjectModelCount: historyProjectModels.length,
      projectScopeEntries,
      // 项目筛选必须按当前客户识别“全部机型/项目”，避免其他客户的通用 BOM 污染当前客户筛选。
      hasGlobalProjectScope,
      applicabilityCount: activeApplicabilities.length,
      bomLineCount: displayBomLines.length,
      currentScopeBomLineCount,
      bomNames,
      bomNameCount: bomNames.length,
      defaultQuantity: matchedBomLine ? decimalToNumber(matchedBomLine.defaultQuantity) : null,
      defaultQuantityUnit: matchedBomLine?.unitSnapshot || material.unit,
      defaultProcessRoute: matchedBomLine?.defaultProcessRoute || material.defaultProcessRoute || this.processRouteText(displayHistory),
      drawingNo: displayDrawing?.drawingNo || null,
      drawingVersion: displayDrawing?.drawingVersion || null,
      drawingDate: this.formatDateOnly(displayDrawing?.drawingDate),
      drawingStatus: displayDrawing?.drawingStatus || null,
      drawingSource,
      drawingSourceLabel: this.dashboardDrawingSourceLabel(drawingSource),
      partThickness: displayHistory?.partThickness === undefined ? null : decimalToNumber(displayHistory.partThickness),
      projectModel: hasGlobalProjectScope ? null : formalProjectModels[0] || null,
      bomStructureType: this.dashboardBomStructureType(matchedBomLine),
      bomStructureLabel: this.dashboardBomStructureLabel(matchedBomLine),
      bomStructureTypes,
      bomStructureLabels,
      bomStructureDetails,
      bomStructureDetailCount,
      lastOrderNo: displayHistory?.order.orderNo || null,
      lastOrderDate: this.formatDateOnly(displayHistory?.order.orderDate),
      lastCustomerName: displayHistory?.order.customerName || null,
      orderLineUsageCount: history.length,
      currentCustomerUsageCount,
      ...quantity,
      // 库存报警只基于 Material 配置和当前 InventoryBatch 可用量计算提醒，不自动下单、补单、提交生产或扣库存。
      stockAlertEnabled,
      stockAlertQuantity,
      stockAlertTriggered: stockAlertEnabled && stockAlertQuantity !== null && quantity.availableQuantity <= stockAlertQuantity,
      searchText: searchParts.join(' '),
      searchParts,
      history
    };
  }

  private rowMatchesQuery(row: ReturnType<MaterialsService['buildDashboardRow']>, query: MaterialDashboardQueryDto) {
    const keyword = normalizeSearchKeyword(query.keyword);
    if (keyword && !pinyinSearchMatches(row.searchParts, keyword)) {
      return false;
    }
    if (query.customerId?.trim() && !this.rowMatchesCustomer(row, query.customerId.trim())) {
      return false;
    }
    if (query.projectModel?.trim() && !this.rowMatchesProject(row, query.projectModel.trim(), query.customerId?.trim())) {
      return false;
    }
    if (query.scopeType && row.scopeType !== query.scopeType) {
      return false;
    }
    if (query.relationType && row.currentRelationType !== query.relationType) {
      return false;
    }
    if (query.drawingNo?.trim() && !this.rowMatchesDrawingText(row, 'drawingNo', query.drawingNo.trim())) {
      return false;
    }
    if (query.drawingStatus?.trim() && !this.rowMatchesDrawingText(row, 'drawingStatus', query.drawingStatus.trim())) {
      return false;
    }
    if (query.drawingSource && !this.rowMatchesDrawingSource(row, query.drawingSource)) {
      return false;
    }
    if (query.bomStructureType && !this.rowMatchesBomStructure(row, query.bomStructureType)) {
      return false;
    }
    if (query.bomPresence && !this.rowMatchesBomPresence(row, query.bomPresence)) {
      return false;
    }
    if (query.recentOrderPresence && !this.rowMatchesRecentOrderPresence(row, query.recentOrderPresence)) {
      return false;
    }
    if (query.stockAlert && query.stockAlert !== 'ALL' && !this.rowMatchesStockAlert(row, query.stockAlert)) {
      return false;
    }
    const drawingDateFrom = this.parseDate(query.drawingDateFrom);
    const drawingDateTo = this.parseDate(query.drawingDateTo, true);
    if (
      (drawingDateFrom || drawingDateTo) &&
      !(
        this.dateInRange(row.drawingDate ? new Date(row.drawingDate) : null, drawingDateFrom, drawingDateTo) ||
        row.history.some((line) => this.dateInRange(line.drawingDate, drawingDateFrom, drawingDateTo))
      )
    ) {
      return false;
    }
    const lastDate = row.lastOrderDate ? new Date(row.lastOrderDate) : null;
    const lastOrderDateFrom = this.parseDate(query.lastOrderDateFrom);
    const lastOrderDateTo = this.parseDate(query.lastOrderDateTo, true);
    if ((lastOrderDateFrom || lastOrderDateTo) && !this.dateInRange(lastDate, lastOrderDateFrom, lastOrderDateTo)) {
      return false;
    }
    return true;
  }

  private compareDashboardRows(
    a: ReturnType<MaterialsService['buildDashboardRow']>,
    b: ReturnType<MaterialsService['buildDashboardRow']>,
    sortBy: NonNullable<MaterialDashboardQueryDto['sortBy']>,
    sortOrder: NonNullable<MaterialDashboardQueryDto['sortOrder']>
  ) {
    let result = 0;
    if (sortBy === 'PART_CODE') {
      result = this.compareDashboardText(a.partCode, b.partCode, sortOrder);
    } else if (sortBy === 'DRAWING_DATE') {
      result = this.compareDashboardNullableTime(a.drawingDate, b.drawingDate, sortOrder);
    } else if (sortBy === 'BOM_STATUS') {
      result = this.compareDashboardNumber(this.dashboardRowHasBom(a) ? 1 : 0, this.dashboardRowHasBom(b) ? 1 : 0, sortOrder);
    } else {
      result = this.compareDashboardNullableTime(a.lastOrderDate, b.lastOrderDate, sortOrder);
    }
    return result || this.compareDashboardDefault(a, b);
  }

  private compareDashboardDefault(a: ReturnType<MaterialsService['buildDashboardRow']>, b: ReturnType<MaterialsService['buildDashboardRow']>) {
    // 第一阶段不把资料维护时间作为业务排序依据；同等业务条件下用稳定零件编码兜底。
    return (
      this.compareDashboardNullableTime(a.lastOrderDate, b.lastOrderDate, 'DESC') ||
      this.compareDashboardText(a.partCode, b.partCode, 'ASC')
    );
  }

  private compareDashboardNullableTime(aValue: Date | string | null | undefined, bValue: Date | string | null | undefined, sortOrder: 'ASC' | 'DESC') {
    const aTime = aValue ? new Date(aValue).getTime() : 0;
    const bTime = bValue ? new Date(bValue).getTime() : 0;
    if (!aTime && !bTime) {
      return 0;
    }
    if (!aTime) {
      return 1;
    }
    if (!bTime) {
      return -1;
    }
    return this.compareDashboardNumber(aTime, bTime, sortOrder);
  }

  private compareDashboardText(aValue: string | null | undefined, bValue: string | null | undefined, sortOrder: 'ASC' | 'DESC') {
    const result = String(aValue || '').localeCompare(String(bValue || ''), 'zh-Hans-CN', {
      numeric: true,
      sensitivity: 'base'
    });
    return sortOrder === 'ASC' ? result : -result;
  }

  private compareDashboardNumber(aValue: number, bValue: number, sortOrder: 'ASC' | 'DESC') {
    const result = aValue - bValue;
    return sortOrder === 'ASC' ? result : -result;
  }

  private rowMatchesDrawingSource(row: ReturnType<MaterialsService['buildDashboardRow']>, drawingSource: NonNullable<MaterialDashboardQueryDto['drawingSource']>) {
    return drawingSource === 'NONE' ? !row.drawingSource : row.drawingSource === drawingSource;
  }

  private rowMatchesBomStructure(row: ReturnType<MaterialsService['buildDashboardRow']>, bomStructureType: NonNullable<MaterialDashboardQueryDto['bomStructureType']>) {
    return bomStructureType === 'NONE' ? row.bomStructureTypes.length === 0 : row.bomStructureTypes.includes(bomStructureType);
  }

  private rowMatchesBomPresence(row: ReturnType<MaterialsService['buildDashboardRow']>, bomPresence: NonNullable<MaterialDashboardQueryDto['bomPresence']>) {
    return bomPresence === 'WITH_BOM' ? this.dashboardRowHasBom(row) : !this.dashboardRowHasBom(row);
  }

  private rowMatchesRecentOrderPresence(
    row: ReturnType<MaterialsService['buildDashboardRow']>,
    recentOrderPresence: NonNullable<MaterialDashboardQueryDto['recentOrderPresence']>
  ) {
    return recentOrderPresence === 'WITH_RECENT_ORDER' ? Boolean(row.lastOrderDate) : !row.lastOrderDate;
  }

  private rowMatchesStockAlert(row: ReturnType<MaterialsService['buildDashboardRow']>, stockAlert: NonNullable<MaterialDashboardQueryDto['stockAlert']>) {
    if (stockAlert === 'ALL') {
      return true;
    }
    if (stockAlert === 'ENABLED') {
      return row.stockAlertEnabled;
    }
    if (stockAlert === 'DISABLED') {
      return !row.stockAlertEnabled;
    }
    // 库存报警筛选只用于提醒核对，不触发订单、生产或库存流水。
    return row.stockAlertTriggered;
  }

  private rowMatchesCustomer(row: ReturnType<MaterialsService['buildDashboardRow']>, customerId: string) {
    return row.hasGlobalCustomerScope || row.customerIds.includes(customerId) || row.history.some((line) => line.order.customer?.id === customerId);
  }

  private rowMatchesProject(row: ReturnType<MaterialsService['buildDashboardRow']>, projectModel: string, customerId?: string) {
    const keyword = normalizeSearchKeyword(projectModel);
    return (
      row.projectScopeEntries.some(
        (entry) =>
          this.projectScopeMatchesCustomer(entry.customerId, customerId) &&
          (entry.hasGlobalProjectScope || pinyinSearchMatches([entry.projectModel], keyword))
      ) ||
      row.history.some((line) => (!customerId || line.order.customerId === customerId) && pinyinSearchMatches([line.projectModel], keyword))
    );
  }

  private projectScopeMatchesCustomer(scopeCustomerId: string | null | undefined, customerId?: string) {
    return !customerId || !scopeCustomerId || scopeCustomerId === customerId;
  }

  private historyMatchingContext(history: DashboardOrderLine[], query: MaterialDashboardQueryDto) {
    const customerId = query.customerId?.trim();
    const projectModel = query.projectModel?.trim();
    if (!customerId && !projectModel) {
      return history;
    }
    return history.filter((line) => {
      if (customerId && line.order.customerId !== customerId) {
        return false;
      }
      if (projectModel && !pinyinSearchMatches([line.projectModel], projectModel)) {
        return false;
      }
      return true;
    });
  }

  private applicabilitiesMatchingContext(items: DashboardMaterial['applicabilities'], query: MaterialDashboardQueryDto) {
    const customerId = query.customerId?.trim();
    const projectModel = normalizeSearchKeyword(query.projectModel);
    return items
      .filter((item) => !customerId || item.customerId === customerId || !item.customerId)
      .filter((item) => !projectModel || !item.projectModel || item.projectModelScopeKey === 'ALL' || normalizeSearchKeyword(item.projectModel).includes(projectModel));
  }

  private bomLinesMatchingContext(lines: DashboardMaterial['modelBomLines'], query: MaterialDashboardQueryDto) {
    const customerId = query.customerId?.trim();
    const projectModel = normalizeSearchKeyword(query.projectModel);
    return lines
      .filter((line) => this.bomLineMatchesCustomerScope(line, customerId, { excludeGlobalAllProject: Boolean(customerId) }))
      .filter(
        (line) =>
          !projectModel ||
          line.bom.projectModelScopeKey === 'ALL' ||
          normalizeSearchKeyword(line.bom.projectModel).includes(projectModel)
      );
  }

  private bomLineMatchesCustomerScope(
    line: DashboardMaterial['modelBomLines'][number],
    customerId?: string,
    options: { excludeGlobalAllProject?: boolean } = {}
  ) {
    if (!customerId) {
      return true;
    }
    if (line.bom.customerId) {
      return line.bom.customerId === customerId;
    }
    if (line.bom.customerScopeMode === 'SELECTED') {
      return line.bom.customerScopes.some((scope) => scope.customerId === customerId);
    }
    if (options.excludeGlobalAllProject && line.bom.projectModelScopeKey === 'ALL') {
      return false;
    }
    return line.bom.customerScopeMode === 'ALL' || !line.bom.customerScopeMode;
  }

  private bomCustomerScopeIds(line: DashboardMaterial['modelBomLines'][number]) {
    if (line.bom.customerId) {
      return [line.bom.customerId];
    }
    if (line.bom.customerScopeMode === 'SELECTED') {
      return line.bom.customerScopes.map((scope) => scope.customerId);
    }
    return [''];
  }

  private bomCustomerScopeNames(line: DashboardMaterial['modelBomLines'][number]) {
    if (line.bom.customerId) {
      return [line.bom.customer?.customerName || line.bom.customerNameSnapshot || ''];
    }
    if (line.bom.customerScopeMode === 'SELECTED') {
      return line.bom.customerScopes.map((scope) => scope.customer?.customerName || scope.customerNameSnapshot || '');
    }
    return [];
  }

  private dashboardCustomerScopeLabel(hasGlobalCustomerScope: boolean, scopeCustomerNames: string[], historyCustomerNames: string[]) {
    if (hasGlobalCustomerScope) {
      return '全部客户';
    }
    if (scopeCustomerNames.length === 1) {
      return scopeCustomerNames[0];
    }
    if (scopeCustomerNames.length > 1) {
      return `指定客户 ${scopeCustomerNames.length} 个`;
    }
    if (historyCustomerNames.length > 0) {
      return `仅订单历史 ${historyCustomerNames.length} 个客户`;
    }
    return '未设置适用客户';
  }

  private bomLineHasGlobalCustomerScope(line: DashboardMaterial['modelBomLines'][number]) {
    return !line.bom.customerId && (line.bom.customerScopeMode === 'ALL' || !line.bom.customerScopeMode);
  }

  private pickBomLine(lines: DashboardMaterial['modelBomLines'], query: MaterialDashboardQueryDto) {
    const customerId = query.customerId?.trim();
    const projectModel = normalizeSearchKeyword(query.projectModel);
    const rows = this.bomLinesMatchingContext(lines, query)
      .sort((a, b) => {
        const aCustomerRank = customerId && a.bom.customerId === customerId ? 0 : 1;
        const bCustomerRank = customerId && b.bom.customerId === customerId ? 0 : 1;
        if (aCustomerRank !== bCustomerRank) {
          return aCustomerRank - bCustomerRank;
        }
        const aProjectRank = projectModel && normalizeSearchKeyword(a.bom.projectModel) === projectModel ? 0 : 1;
        const bProjectRank = projectModel && normalizeSearchKeyword(b.bom.projectModel) === projectModel ? 0 : 1;
        if (aProjectRank !== bProjectRank) {
          return aProjectRank - bProjectRank;
        }
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      });
    return rows[0];
  }

  private pickBomDrawingRevision(line?: DashboardMaterial['modelBomLines'][number]) {
    // 零件控制面板展示 BOM 默认图纸时，只允许使用启用图纸，避免停用图纸继续进入下单建议。
    return line?.defaultDrawingRevision?.status === 'ENABLED' ? line.defaultDrawingRevision : undefined;
  }

  private dashboardDrawingSource(
    bomDrawing?: DashboardMaterial['modelBomLines'][number]['defaultDrawingRevision'],
    materialDrawing?: DashboardMaterial['drawingRevisions'][number],
    history?: DashboardOrderLine
  ) {
    if (bomDrawing) {
      return 'BOM_LINE';
    }
    if (materialDrawing) {
      return materialDrawing.isDefault ? 'MATERIAL_DEFAULT' : 'MATERIAL_LATEST';
    }
    if (history && (history.drawingNo || history.drawingVersion || history.drawingDate || history.drawingStatus)) {
      return 'ORDER_HISTORY';
    }
    return null;
  }

  private dashboardDrawingSourceLabel(source: 'BOM_LINE' | 'MATERIAL_DEFAULT' | 'MATERIAL_LATEST' | 'ORDER_HISTORY' | null) {
    if (source === 'BOM_LINE') {
      return 'BOM 指定图纸';
    }
    if (source === 'MATERIAL_DEFAULT') {
      return '零件默认图纸';
    }
    if (source === 'MATERIAL_LATEST') {
      return '零件最新图纸';
    }
    if (source === 'ORDER_HISTORY') {
      return '历史订单图纸';
    }
    return '';
  }

  private dashboardBomStructureType(line?: DashboardMaterial['modelBomLines'][number]) {
    if (!line) {
      return null;
    }
    if (line.lineType === 'COMPONENT') {
      return 'COMPONENT';
    }
    return line.parentComponentNo ? 'CHILD_PART' : 'STANDALONE_PART';
  }

  private dashboardBomStructureLabel(line?: DashboardMaterial['modelBomLines'][number]) {
    const structureType = this.dashboardBomStructureType(line);
    if (structureType === 'COMPONENT') {
      return `组件 ${line?.componentNo?.trim().toUpperCase() || '未编号'}`;
    }
    if (structureType === 'CHILD_PART') {
      return `子零件 -> ${line?.parentComponentNo?.trim().toUpperCase() || '-'}`;
    }
    if (structureType === 'STANDALONE_PART') {
      return '单独零件';
    }
    return '';
  }

  private dashboardBomStructureDetails(lines: DashboardMaterial['modelBomLines']) {
    return lines
      .slice()
      .sort(
        (a, b) =>
          this.compareDashboardText(a.bom.bomName, b.bom.bomName, 'ASC') ||
          this.compareDashboardText(a.bom.projectModel, b.bom.projectModel, 'ASC') ||
          this.dashboardBomLineDisplayOrder(a) - this.dashboardBomLineDisplayOrder(b) ||
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      )
      .map((line) => ({
        lineId: line.id,
        bomId: line.bomId,
        bomName: line.bom.bomName,
        customerId: line.bom.customerId,
        customerName: line.bom.customer?.customerName || line.bom.customerNameSnapshot || '',
        projectModel: line.bom.projectModel,
        structureType: this.dashboardBomStructureType(line),
        structureLabel: this.dashboardBomStructureLabel(line),
        componentNo: line.componentNo?.trim().toUpperCase() || null,
        parentComponentNo: line.parentComponentNo?.trim().toUpperCase() || null,
        displayOrder: this.dashboardBomLineDisplayOrder(line),
        sortOrder: line.sortOrder ?? 0
      }));
  }

  private dashboardBomLineDisplayOrder(line: DashboardMaterial['modelBomLines'][number]) {
    const orderedLines = this.dashboardBomOrderedDisplayLines(line.bom.lines || []);
    const index = orderedLines.findIndex((item) => item.id === line.id);
    return index >= 0 ? index + 1 : 0;
  }

  private dashboardBomOrderedDisplayLines(lines: DashboardMaterial['modelBomLines'][number]['bom']['lines']) {
    const sortedLines = [...lines]
      .filter((line) => line.status === 'ENABLED' && line.material?.status !== 'DISABLED')
      .sort(
      (left, right) =>
        (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id)
    );
    const childrenByParent = new Map<string, typeof sortedLines>();
    const enabledComponentNos = new Set(
      sortedLines
        .filter((line) => this.normalizeDashboardBomLineType(line.lineType) === 'COMPONENT')
        .map((line) => this.normalizeDashboardBomComponentNo(line.componentNo))
        .filter(Boolean)
    );
    const rootLines: typeof sortedLines = [];
    for (const line of sortedLines) {
      const parentComponentNo = this.normalizeDashboardBomComponentNo(line.parentComponentNo);
      if (this.normalizeDashboardBomLineType(line.lineType) === 'PART' && parentComponentNo) {
        childrenByParent.set(parentComponentNo, [...(childrenByParent.get(parentComponentNo) || []), line]);
      } else {
        rootLines.push(line);
      }
    }
    const ordered: typeof sortedLines = [];
    const attachedIds = new Set<string>();
    for (const line of rootLines) {
      ordered.push(line);
      const componentNo = this.normalizeDashboardBomComponentNo(line.componentNo);
      // 零件管理控制面板展示顺序跟机型 BOM 页一致：父组件后面紧跟它的子零件，内部 sortOrder 只作为拖拽持久化值。
      if (this.normalizeDashboardBomLineType(line.lineType) === 'COMPONENT' && componentNo && enabledComponentNos.has(componentNo)) {
        for (const child of childrenByParent.get(componentNo) || []) {
          ordered.push(child);
          attachedIds.add(child.id);
        }
      }
    }
    for (const line of sortedLines) {
      if (this.normalizeDashboardBomLineType(line.lineType) === 'PART' && line.parentComponentNo && !attachedIds.has(line.id)) {
        ordered.push(line);
      }
    }
    return ordered;
  }

  private normalizeDashboardBomLineType(lineType?: string | null) {
    return lineType === 'COMPONENT' ? 'COMPONENT' : 'PART';
  }

  private normalizeDashboardBomComponentNo(componentNo?: string | null) {
    return String(componentNo || '').trim().toUpperCase();
  }

  private dashboardCurrentRelation(args: {
    hasScopedDashboardContext: boolean;
    displayBomLines: DashboardMaterial['modelBomLines'];
    displayApplicabilities: DashboardMaterial['applicabilities'];
    displayHistoryRows: DashboardOrderLine[];
  }) {
    const scopedPrefix = args.hasScopedDashboardContext ? '当前客户/机型' : '当前列表';
    if (args.displayBomLines.length > 0) {
      return {
        type: 'BOM' as const,
        label: 'BOM 零件',
        description: `已进入${scopedPrefix} BOM，可通过零件包带入新订单。`
      };
    }
    if (args.displayApplicabilities.length > 0) {
      return {
        type: 'APPLICABILITY' as const,
        label: '显式适用',
        description: `已维护${scopedPrefix}适用范围，但尚未进入当前 BOM。`
      };
    }
    if (args.displayHistoryRows.length > 0) {
      return {
        type: 'ORDER_HISTORY' as const,
        label: '订单历史',
        description: `来自${scopedPrefix}历史订单或导入订单；只代表该客户曾使用，不会自动面向全部客户，也不等于正式适用范围或客户私有 BOM。`
      };
    }
    return {
      type: 'MATERIAL_ONLY' as const,
      label: '仅搜索记忆',
      description: '仅存在于零件搜索记忆，尚未确认客户适用范围或 BOM，不代表库存可用。'
    };
  }

  private pickMaterialDrawingRevision(revisions: DashboardMaterial['drawingRevisions']) {
    return revisions
      .filter((revision) => revision.status === 'ENABLED')
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) {
          return a.isDefault ? -1 : 1;
        }
        const dateDiff = (b.drawingDate?.getTime() ?? 0) - (a.drawingDate?.getTime() ?? 0);
        if (dateDiff !== 0) {
          return dateDiff;
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      })[0];
  }

  private searchParts(
    material: DashboardMaterial,
    history: DashboardOrderLine[],
    applicabilities: DashboardMaterial['applicabilities'],
    bomLines: DashboardMaterial['modelBomLines']
  ) {
    const parts = [
      material.partCode,
      material.partName,
      material.unit,
      material.partSpecification,
      ...material.drawingRevisions.flatMap((revision) => [
        revision.drawingNo,
        revision.drawingVersion,
        revision.drawingStatus,
        revision.drawingFileName,
        revision.remark,
        ...this.dateSearchVariants(revision.drawingDate)
      ]),
      ...applicabilities.flatMap((item) => [
        item.customer?.customerCode,
        item.customer?.customerName,
        item.customerNameSnapshot,
        item.projectModel,
        item.remark
      ]),
      ...bomLines.flatMap((line) => {
        const bomDrawing = this.pickBomDrawingRevision(line);
        return [
          line.bom.bomName,
          line.bom.projectModel,
          line.bom.customer?.customerCode,
          line.bom.customer?.customerName,
          line.bom.customerNameSnapshot,
          line.defaultProcessRoute,
          bomDrawing?.drawingNo,
          bomDrawing?.drawingVersion,
          bomDrawing?.drawingStatus,
          ...this.dateSearchVariants(bomDrawing?.drawingDate),
          line.remark
        ];
      }),
      ...history.flatMap((line) => [
        line.order.orderNo,
        line.order.customerCode,
        line.order.customerName,
        line.order.customer?.customerCode,
        line.order.customer?.customerName,
        line.partCategory,
        line.drawingNo,
        line.drawingVersion,
        line.drawingStatus,
        line.partSpecification,
        line.projectModel,
        line.partThickness === null ? '' : String(decimalToNumber(line.partThickness)),
        ...this.dateSearchVariants(line.drawingDate),
        ...this.dateSearchVariants(line.order.orderDate)
      ])
    ];
    // 零件管理关键字搜索必须逐字段匹配，避免编码类关键词跨字段拼接误命中。
    return parts.filter(Boolean).map((part) => String(part));
  }

  private processRouteText(line?: DashboardOrderLine) {
    if (!line) {
      return '';
    }
    const steps =
      line.processSteps.length > 0
        ? line.processSteps
            .slice()
            .sort((a, b) => a.stepNo - b.stepNo)
            .map((step) => step.processRemark ? `${step.processName}(${step.processRemark})` : step.processName)
        : processSnapshotToDetails(line.processSnapshot).map((step) =>
            step.processRemark ? `${step.processName}(${step.processRemark})` : step.processName
          );
    return steps.join(' > ');
  }

  private rowMatchesDrawingText(row: ReturnType<MaterialsService['buildDashboardRow']>, field: 'drawingNo' | 'drawingStatus', value: string) {
    const keyword = normalizeSearchKeyword(value);
    return pinyinSearchMatches([row[field]], keyword) || row.history.some((line) => pinyinSearchMatches([line[field]], keyword));
  }

  private publicDashboardRow(row: ReturnType<MaterialsService['buildDashboardRow']>) {
    const {
      history: _history,
      searchText: _searchText,
      searchParts: _searchParts,
      projectScopeEntries: _projectScopeEntries,
      customerIds: _customerIds,
      customerNames,
      historyCustomerNames,
      projectModels,
      historyProjectModels,
      bomNames,
      bomStructureDetails,
      ...publicRow
    } = row;
    return {
      ...publicRow,
      customerNames: customerNames.slice(0, MATERIAL_DASHBOARD_CUSTOMER_PREVIEW_LIMIT),
      historyCustomerNames: historyCustomerNames.slice(0, MATERIAL_DASHBOARD_CUSTOMER_PREVIEW_LIMIT),
      projectModels: projectModels.slice(0, MATERIAL_DASHBOARD_PROJECT_MODEL_PREVIEW_LIMIT),
      historyProjectModels: historyProjectModels.slice(0, MATERIAL_DASHBOARD_PROJECT_MODEL_PREVIEW_LIMIT),
      bomNames: bomNames.slice(0, MATERIAL_DASHBOARD_BOM_NAME_PREVIEW_LIMIT),
      bomStructureDetails: bomStructureDetails.slice(0, MATERIAL_DASHBOARD_BOM_STRUCTURE_PREVIEW_LIMIT)
    };
  }

  private dateInRange(value: Date | null | undefined, from?: Date | null, to?: Date | null) {
    if (!value) {
      return false;
    }
    const time = value.getTime();
    if (from && time < from.getTime()) {
      return false;
    }
    if (to && time > to.getTime()) {
      return false;
    }
    return true;
  }

  private parseDate(value?: string, endOfDay = false) {
    const raw = value?.trim();
    if (!raw) {
      return null;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    if (endOfDay) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date;
  }

  private dateSearchVariants(value?: Date | null) {
    if (!value) {
      return [];
    }
    const year = value.getFullYear();
    const month = value.getMonth() + 1;
    const day = value.getDate();
    return [
      this.formatDateOnly(value),
      `${year}/${month}/${day}`,
      `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`,
      `${year}${month}${day}`
    ].filter(Boolean) as string[];
  }

  private formatDateOnly(value?: Date | null) {
    if (!value) {
      return null;
    }
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  private uniqueList(values: Array<string | null | undefined>) {
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  }

  private dashboardCountMap(values: string[]) {
    return values.reduce<Record<string, number>>((counts, value) => {
      counts[value] = (counts[value] || 0) + 1;
      return counts;
    }, {});
  }

  private codeKey(value: string) {
    return value.trim().toLocaleLowerCase();
  }
}
