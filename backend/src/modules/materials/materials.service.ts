import { Injectable } from '@nestjs/common';
import { CommonStatus, InventoryReservationStatus, Prisma } from '@prisma/client';
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
              };
            };
            customerScopes: {
              where: { status: 'ENABLED' };
              select: {
                customerId: true;
                status: true;
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

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(query: MaterialDashboardQueryDto) {
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const sortBy = query.sortBy || 'LAST_ORDER_DATE';
    const sortOrder = query.sortOrder || 'DESC';
    const materials = await this.findDashboardMaterials(query.status);
    const partCodeConditions = materials.map((material) => ({
      partCode: { equals: material.partCode, mode: 'insensitive' as const }
    }));
    const [orderLines, quantityByCode] = await Promise.all([
      partCodeConditions.length > 0 ? this.findOrderLines(partCodeConditions) : Promise.resolve([]),
      partCodeConditions.length > 0 ? this.inventoryQuantityByCode(partCodeConditions) : Promise.resolve(new Map<string, InventoryQuantity>())
    ]);
    const historyByCode = this.groupHistoryByCode(orderLines);

    const allRows = materials
      .map((material) => this.buildDashboardRow(material, historyByCode.get(this.codeKey(material.partCode)) || [], quantityByCode, query))
      .filter((row) => this.rowMatchesQuery(row, query))
      .sort((a, b) => this.compareDashboardRows(a, b, sortBy, sortOrder));

    const pageRows = allRows.slice(offset, offset + limit).map((row) => this.publicDashboardRow(row));
    const summary = {
      totalCount: allRows.length,
      enabledCount: allRows.filter((row) => row.status === 'ENABLED').length,
      disabledCount: allRows.filter((row) => row.status === 'DISABLED').length,
      commonCount: allRows.filter((row) => row.scopeType === 'COMMON').length,
      customCount: allRows.filter((row) => row.scopeType === 'CUSTOM').length,
      withBomCount: allRows.filter((row) => row.bomNames.length > 0).length,
      withoutBomCount: allRows.filter((row) => row.bomNames.length === 0).length,
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

    return {
      items: pageRows,
      totalCount: allRows.length,
      limit,
      offset,
      hasMore: offset + pageRows.length < allRows.length,
      summary
    };
  }

  async projectModels(query: MaterialProjectOptionsQueryDto) {
    const customerId = query.customerId?.trim();
    const [applicabilities, boms, orderLines] = await Promise.all([
      this.prisma.materialApplicability.findMany({
        where: {
          status: 'ENABLED',
          ...(customerId ? { OR: [{ customerId }, { customerId: null }] } : {})
        },
        select: { projectModel: true, updatedAt: true }
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
        select: { projectModel: true, updatedAt: true }
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
              orderDate: true
            }
          }
        }
      })
    ]);

    const scoreByProject = new Map<
      string,
      {
        value: string;
        orderCount: number;
        bomCount: number;
        applicabilityCount: number;
        latestOrderTime: number;
        latestMasterTime: number;
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
          latestOrderTime: 0,
          latestMasterTime: 0
        };
      scoreByProject.set(key, current);
      return current;
    };

    // 客户常用机型按历史下单和 BOM/适用范围热度排序，避免快捷入口静默展示无业务依据的前几项。
    for (const row of orderLines) {
      const score = ensureProjectScore(row.projectModel);
      if (!score) {
        continue;
      }
      score.orderCount += 1;
      score.latestOrderTime = Math.max(score.latestOrderTime, row.order.orderDate?.getTime() || row.createdAt.getTime());
    }
    for (const row of boms) {
      const score = ensureProjectScore(row.projectModel);
      if (!score) {
        continue;
      }
      score.bomCount += 1;
      score.latestMasterTime = Math.max(score.latestMasterTime, row.updatedAt.getTime());
    }
    for (const row of applicabilities) {
      const score = ensureProjectScore(row.projectModel);
      if (!score) {
        continue;
      }
      score.applicabilityCount += 1;
      score.latestMasterTime = Math.max(score.latestMasterTime, row.updatedAt.getTime());
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
        if (a.latestMasterTime !== b.latestMasterTime) {
          return b.latestMasterTime - a.latestMasterTime;
        }
        return a.value.localeCompare(b.value, 'zh-Hans-CN');
      })
      .map((item) => item.value);
  }

  async commonProjectModels() {
    const [enabledRows, totalCount] = await Promise.all([
      this.prisma.materialCommonProjectModel.findMany({
        where: { status: 'ENABLED' },
        orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'asc' }],
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

  private findDashboardMaterials(status?: CommonStatus) {
    return this.prisma.material.findMany({
      where: status ? { status } : {},
      include: {
        applicabilities: {
          include: {
            customer: {
              select: {
                id: true,
                customerCode: true,
                customerName: true
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
                    customerName: true
                  }
                },
                customerScopes: {
                  where: { status: 'ENABLED' },
                  select: {
                    customerId: true,
                    status: true
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
      orderBy: [{ updatedAt: 'desc' }, { partCode: 'asc' }]
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
                customerName: true
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
    const matchingHistory = this.historyMatchingContext(history, query);
    const displayHistoryRows = hasScopedDashboardContext ? matchingHistory : history;
    const displayHistory = displayHistoryRows[0];
    const activeApplicabilities = material.applicabilities.filter((item) => item.status === 'ENABLED');
    const customerScopedApplicabilities = selectedCustomerId
      ? activeApplicabilities.filter((item) => !item.customerId || item.customerId === selectedCustomerId)
      : activeApplicabilities;
    const matchingApplicabilities = this.applicabilitiesMatchingContext(activeApplicabilities, query);
    const displayApplicabilities = hasScopedDashboardContext ? matchingApplicabilities : activeApplicabilities;
    const activeBomLines = material.modelBomLines.filter((line) => line.status === 'ENABLED' && line.bom.status === 'ENABLED');
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
    const customerNames = this.uniqueList([
      ...displayApplicabilities.map((item) => item.customer?.customerName || item.customerNameSnapshot || ''),
      ...displayBomLines.map((line) => line.bom.customer?.customerName || line.bom.customerNameSnapshot || ''),
      ...displayHistoryRows.map((line) => line.order.customerName)
    ]);
    const projectModels = this.uniqueList([
      ...displayApplicabilities.map((item) => item.projectModel || ''),
      ...displayBomLines.map((line) => line.bom.projectModel),
      ...displayHistoryRows.map((line) => line.projectModel || '')
    ]);
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
    const hasCustomScope =
      displayApplicabilities.some((item) => item.customerId || item.projectModel) ||
      displayBomLines.some((line) => line.bom.customerId) ||
      displayHistoryRows.some((line) => String(line.partCategory || '').includes('定制'));
    const currentCustomerUsageCount = query.customerId
      ? history.filter((line) => line.order.customerId === query.customerId).length
      : 0;
    const searchParts = this.searchParts(material, displayHistoryRows, displayApplicabilities, displayBomLines);

    return {
      id: material.id,
      partCode: material.partCode,
      partName: material.partName,
      partType: displayHistory?.partCategory || (hasCustomScope ? '定制件' : '通用件'),
      unit: material.unit,
      partSpecification: displayHistory?.partSpecification || material.partSpecification,
      status: material.status,
      scopeType: hasCustomScope ? 'CUSTOM' : 'COMMON',
      scopeLabel: hasCustomScope ? '定制件' : '通用件',
      currentRelationType: currentRelation.type,
      currentRelationLabel: currentRelation.label,
      currentRelationDescription: currentRelation.description,
      customerNames,
      customerIds: this.uniqueList([
        ...customerScopedApplicabilities.map((item) => item.customerId || ''),
        ...customerScopedBomLines.flatMap((line) => this.bomCustomerScopeIds(line)),
        ...history.map((line) => line.order.customerId)
      ]),
      hasGlobalCustomerScope:
        customerScopedApplicabilities.some((item) => !item.customerId) ||
        customerScopedBomLines.some((line) => this.bomLineHasGlobalCustomerScope(line)),
      projectModels,
      projectScopeEntries,
      // 项目筛选必须按当前客户识别“全部机型/项目”，避免其他客户的通用 BOM 污染当前客户筛选。
      hasGlobalProjectScope: projectScopeEntries.some(
        (entry) => entry.hasGlobalProjectScope && this.projectScopeMatchesCustomer(entry.customerId, selectedCustomerId)
      ),
      applicabilityCount: activeApplicabilities.length,
      bomLineCount: displayBomLines.length,
      bomNames,
      defaultQuantity: matchedBomLine ? decimalToNumber(matchedBomLine.defaultQuantity) : null,
      defaultQuantityUnit: matchedBomLine?.unitSnapshot || material.unit,
      defaultProcessRoute: matchedBomLine?.defaultProcessRoute || this.processRouteText(displayHistory),
      drawingNo: displayDrawing?.drawingNo || null,
      drawingVersion: displayDrawing?.drawingVersion || null,
      drawingDate: this.formatDateOnly(displayDrawing?.drawingDate),
      drawingStatus: displayDrawing?.drawingStatus || null,
      drawingSource,
      drawingSourceLabel: this.dashboardDrawingSourceLabel(drawingSource),
      partThickness: displayHistory?.partThickness === undefined ? null : decimalToNumber(displayHistory.partThickness),
      projectModel: displayHistory?.projectModel || projectModels[0] || null,
      bomStructureType: this.dashboardBomStructureType(matchedBomLine),
      bomStructureLabel: this.dashboardBomStructureLabel(matchedBomLine),
      bomStructureTypes,
      bomStructureLabels,
      bomStructureDetails,
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
      history,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt
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
      result = this.compareDashboardNumber(a.bomNames.length > 0 ? 1 : 0, b.bomNames.length > 0 ? 1 : 0, sortOrder);
    } else if (sortBy === 'UPDATED_AT') {
      result = this.compareDashboardNullableTime(a.updatedAt, b.updatedAt, sortOrder);
    } else {
      result = this.compareDashboardNullableTime(a.lastOrderDate, b.lastOrderDate, sortOrder);
    }
    return result || this.compareDashboardDefault(a, b);
  }

  private compareDashboardDefault(a: ReturnType<MaterialsService['buildDashboardRow']>, b: ReturnType<MaterialsService['buildDashboardRow']>) {
    return (
      this.compareDashboardNullableTime(a.lastOrderDate, b.lastOrderDate, 'DESC') ||
      this.compareDashboardNullableTime(a.updatedAt, b.updatedAt, 'DESC') ||
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
    return bomPresence === 'WITH_BOM' ? row.bomNames.length > 0 : row.bomNames.length === 0;
  }

  private rowMatchesRecentOrderPresence(
    row: ReturnType<MaterialsService['buildDashboardRow']>,
    recentOrderPresence: NonNullable<MaterialDashboardQueryDto['recentOrderPresence']>
  ) {
    return recentOrderPresence === 'WITH_RECENT_ORDER' ? Boolean(row.lastOrderDate) : !row.lastOrderDate;
  }

  private rowMatchesStockAlert(row: ReturnType<MaterialsService['buildDashboardRow']>, stockAlert: NonNullable<MaterialDashboardQueryDto['stockAlert']>) {
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
      hasGlobalCustomerScope: _hasGlobalCustomerScope,
      ...publicRow
    } = row;
    return publicRow;
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
