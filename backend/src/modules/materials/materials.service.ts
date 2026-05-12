import { Injectable } from '@nestjs/common';
import { CommonStatus, InventoryReservationStatus, Prisma } from '@prisma/client';
import { decimalToNumber, processSnapshotToDetails } from '../../common/serializers';
import { normalizeSearchKeyword, pinyinSearchMatches } from '../../common/pinyin-search';
import { PrismaService } from '../../prisma/prisma.service';
import { MaterialDashboardQueryDto, MaterialProjectOptionsQueryDto } from './dto';

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

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(query: MaterialDashboardQueryDto) {
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
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
      .sort((a, b) => {
        const aTime = a.lastOrderDate ? new Date(a.lastOrderDate).getTime() : 0;
        const bTime = b.lastOrderDate ? new Date(b.lastOrderDate).getTime() : 0;
        if (aTime !== bTime) {
          return bTime - aTime;
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

    const pageRows = allRows.slice(offset, offset + limit).map((row) => this.publicDashboardRow(row));
    const summary = {
      totalCount: allRows.length,
      enabledCount: allRows.filter((row) => row.status === 'ENABLED').length,
      disabledCount: allRows.filter((row) => row.status === 'DISABLED').length,
      commonCount: allRows.filter((row) => row.scopeType === 'COMMON').length,
      customCount: allRows.filter((row) => row.scopeType === 'CUSTOM').length,
      withBomCount: allRows.filter((row) => row.bomNames.length > 0).length,
      withRecentOrderCount: allRows.filter((row) => row.lastOrderDate).length
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
          ...(customerId ? { OR: [{ customerId }, { customerId: null }] } : {})
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
      const reservedQuantity = batch.sourceOrderId ? 0 : reservedQuantityByBatchId.get(batch.id) || 0;
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
    const matchingHistory = this.historyMatchingContext(history, query);
    const displayHistory = matchingHistory[0] || history[0];
    const matchedBomLine = this.pickBomLine(material, query);
    const materialDrawing = this.pickMaterialDrawingRevision(material.drawingRevisions);
    const bomDrawing = this.pickBomDrawingRevision(matchedBomLine);
    const displayDrawing = bomDrawing || materialDrawing || displayHistory;
    const activeApplicabilities = material.applicabilities.filter((item) => item.status === 'ENABLED');
    const activeBomLines = material.modelBomLines.filter((line) => line.status === 'ENABLED' && line.bom.status === 'ENABLED');
    const quantity = quantityByCode.get(key) || {
      availableQuantity: 0,
      orderInventoryQuantity: 0,
      stockInventoryQuantity: 0
    };
    const customerNames = this.uniqueList([
      ...activeApplicabilities.map((item) => item.customer?.customerName || item.customerNameSnapshot || ''),
      ...activeBomLines.map((line) => line.bom.customer?.customerName || line.bom.customerNameSnapshot || ''),
      ...history.map((line) => line.order.customerName)
    ]);
    const projectModels = this.uniqueList([
      ...activeApplicabilities.map((item) => item.projectModel || ''),
      ...activeBomLines.map((line) => line.bom.projectModel),
      ...history.map((line) => line.projectModel || '')
    ]);
    const bomNames = this.uniqueList(activeBomLines.map((line) => line.bom.bomName));
    const hasCustomScope =
      activeApplicabilities.some((item) => item.customerId || item.projectModel) ||
      activeBomLines.some((line) => line.bom.customerId) ||
      history.some((line) => String(line.partCategory || '').includes('定制'));
    const currentCustomerUsageCount = query.customerId
      ? history.filter((line) => line.order.customerId === query.customerId).length
      : 0;

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
      customerNames,
      customerIds: this.uniqueList([
        ...activeApplicabilities.map((item) => item.customerId || ''),
        ...activeBomLines.map((line) => line.bom.customerId || ''),
        ...history.map((line) => line.order.customerId)
      ]),
      hasGlobalCustomerScope:
        activeApplicabilities.some((item) => !item.customerId) ||
        activeBomLines.some((line) => !line.bom.customerId),
      projectModels,
      hasGlobalProjectScope: activeApplicabilities.some((item) => !item.projectModel),
      applicabilityCount: activeApplicabilities.length,
      bomLineCount: activeBomLines.length,
      bomNames,
      defaultQuantity: matchedBomLine ? decimalToNumber(matchedBomLine.defaultQuantity) : null,
      defaultQuantityUnit: matchedBomLine?.unitSnapshot || material.unit,
      defaultProcessRoute: matchedBomLine?.defaultProcessRoute || this.processRouteText(displayHistory),
      drawingNo: displayDrawing?.drawingNo || null,
      drawingVersion: displayDrawing?.drawingVersion || null,
      drawingDate: this.formatDateOnly(displayDrawing?.drawingDate),
      drawingStatus: displayDrawing?.drawingStatus || null,
      partThickness: displayHistory?.partThickness === undefined ? null : decimalToNumber(displayHistory.partThickness),
      projectModel: displayHistory?.projectModel || projectModels[0] || null,
      lastOrderNo: displayHistory?.order.orderNo || null,
      lastOrderDate: this.formatDateOnly(displayHistory?.order.orderDate),
      lastCustomerName: displayHistory?.order.customerName || null,
      orderLineUsageCount: history.length,
      currentCustomerUsageCount,
      ...quantity,
      searchText: this.searchText(material, history, activeApplicabilities, activeBomLines),
      history,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt
    };
  }

  private rowMatchesQuery(row: ReturnType<MaterialsService['buildDashboardRow']>, query: MaterialDashboardQueryDto) {
    const keyword = normalizeSearchKeyword(query.keyword);
    if (keyword && !pinyinSearchMatches([row.searchText], keyword)) {
      return false;
    }
    if (query.customerId?.trim() && !this.rowMatchesCustomer(row, query.customerId.trim())) {
      return false;
    }
    if (query.projectModel?.trim() && !this.rowMatchesProject(row, query.projectModel.trim())) {
      return false;
    }
    if (query.scopeType && row.scopeType !== query.scopeType) {
      return false;
    }
    if (query.drawingNo?.trim() && !this.rowMatchesDrawingText(row, 'drawingNo', query.drawingNo.trim())) {
      return false;
    }
    if (query.drawingStatus?.trim() && !this.rowMatchesDrawingText(row, 'drawingStatus', query.drawingStatus.trim())) {
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

  private rowMatchesCustomer(row: ReturnType<MaterialsService['buildDashboardRow']>, customerId: string) {
    return row.hasGlobalCustomerScope || row.customerIds.includes(customerId) || row.history.some((line) => line.order.customer?.id === customerId);
  }

  private rowMatchesProject(row: ReturnType<MaterialsService['buildDashboardRow']>, projectModel: string) {
    const keyword = normalizeSearchKeyword(projectModel);
    return (
      row.hasGlobalProjectScope ||
      row.projectModels.some((value) => pinyinSearchMatches([value], keyword)) ||
      row.history.some((line) => pinyinSearchMatches([line.projectModel], keyword))
    );
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

  private pickBomLine(material: DashboardMaterial, query: MaterialDashboardQueryDto) {
    const customerId = query.customerId?.trim();
    const projectModel = normalizeSearchKeyword(query.projectModel);
    const rows = material.modelBomLines
      .filter((line) => line.status === 'ENABLED' && line.bom.status === 'ENABLED')
      .filter((line) => !customerId || line.bom.customerId === customerId || !line.bom.customerId)
      .filter((line) => !projectModel || normalizeSearchKeyword(line.bom.projectModel).includes(projectModel))
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
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
    return rows[0];
  }

  private pickBomDrawingRevision(line?: DashboardMaterial['modelBomLines'][number]) {
    // 零件控制面板展示 BOM 默认图纸时，只允许使用启用图纸，避免停用图纸继续进入下单建议。
    return line?.defaultDrawingRevision?.status === 'ENABLED' ? line.defaultDrawingRevision : undefined;
  }

  private pickMaterialDrawingRevision(revisions: DashboardMaterial['drawingRevisions']) {
    return revisions
      .filter((revision) => revision.status === 'ENABLED')
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) {
          return a.isDefault ? -1 : 1;
        }
        const dateDiff = (b.drawingDate?.getTime() || 0) - (a.drawingDate?.getTime() || 0);
        if (dateDiff !== 0) {
          return dateDiff;
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      })[0];
  }

  private searchText(
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
    return parts.filter(Boolean).join(' ');
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
    const { history: _history, searchText: _searchText, customerIds: _customerIds, hasGlobalCustomerScope: _hasGlobalCustomerScope, hasGlobalProjectScope: _hasGlobalProjectScope, ...publicRow } = row;
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

  private codeKey(value: string) {
    return value.trim().toLocaleLowerCase();
  }
}
