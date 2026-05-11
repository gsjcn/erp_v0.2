import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CommonStatus,
  InventoryReservationStatus,
  InventoryTransactionType,
  OrderLineFulfillmentMode,
  OrderStatus,
  Prisma,
  ProductionNoticeStatus,
  ProductionNoticeTarget,
  ProductionStatus
} from '@prisma/client';
import {
  decimalToNumber,
  processSnapshotToArray,
  processSnapshotToDetails,
  type ProcessStepSnapshot
} from '../../common/serializers';
import { buildPinyinSearchText, normalizeSearchKeyword } from '../../common/pinyin-search';
import { runSerializableTransaction } from '../../common/transactions';
import { normalizeMultipartFileName } from '../../common/upload-filenames';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcessDefinitionsService } from '../process-definitions/process-definitions.service';
import {
  CancelOrderDto,
  CancelReplenishmentDto,
  CancelStartedOrderDto,
  CreateAdditionalMaterialDto,
  CreateLineReplenishmentDto,
  CreateOrderLineDto,
  CreateOrderDto,
  NextOrderNoQueryDto,
  OrderQueryDto,
  ResolveLineShortageDto,
  SubmitOrderDto,
  UpdateLineProcessDto,
  UpdateLineQuantityDto,
  UpdateOrderDto,
  CreateOrderImportSessionDto,
  GetOrderImportSessionQueryDto,
  GetOrderImportFilePreviewQueryDto,
  ListOrderImportSessionQueryDto,
  CommitOrderImportSessionDto
} from './dto';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { orderImportUploadPath } from '../../storage/upload-paths';
import * as ExcelJS from 'exceljs';

type NormalizedCancelHandlingPlanItem = {
  orderLineId: string;
  productionTaskNo: string;
  handlingMode: 'STOCK' | 'SCRAP' | 'NONE';
  handlingQuantity: number;
  remark?: string;
};

type SubmitPlanOperator = {
  accountId: string;
  name: string;
  role: string;
};

type PreparedOrderLinePlan = {
  productionPlanQuantity: number;
  productionPlanSuggestedQuantity: number;
  productionPlanOverrideByCode?: string | null;
  productionPlanOverrideByName?: string | null;
  productionPlanOverrideByRole?: string | null;
  productionPlanOverrideAt?: Date | null;
  productionPlanOverrideReason?: string | null;
};

type InventoryReservationCarryover = {
  quantity: number;
  createdAt: Date;
};

type StockReservationPriorityOrder = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  createdAt: Date;
};

type OrderImportIssue = {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
};

type ParsedOrderImportRow = {
  sourceRowNo: number;
  rowHash: string;
  orderBlock?: string;
  orderNo: string;
  orderDate: Date | null;
  customerName: string;
  projectModel?: string;
  lineType: 'PART' | 'COMPONENT';
  importSequence?: string;
  partCategory?: string;
  componentNo?: string;
  parentComponentNo?: string;
  partCode: string;
  drawingNo?: string;
  partName: string;
  partSpecification?: string;
  partThickness: number;
  orderQuantity?: number;
  unitUsage?: number;
  demandQuantity?: number;
  unit: string;
  processRoute?: string;
  processRemark?: string;
  drawingDate?: Date | null;
  drawingStatus?: string;
  raw: Record<string, unknown>;
  issues: OrderImportIssue[];
};

type OrderLineMaterialIdentityInfo = {
  identityKeys: Set<string>;
  identityFieldValues: Map<string, Set<string>>;
  variantCount: number;
  conflictFields: string[];
};

type ImportPreviewPageOptions = {
  allOrders?: boolean;
  includeRows?: boolean;
  orderLimit?: number;
  orderOffset?: number;
};

const orderLineMaterialIdentityFieldLabels: Record<string, string> = {
  partName: '名称',
  partSpecification: '规格',
  drawingNo: '图号',
  drawingVersion: '版本',
  drawingDate: '图纸日期',
  drawingStatus: '图纸状态',
  partThickness: '厚度',
  projectModel: '项目型号'
};

const orderImportRowPreviewSelect = {
  id: true,
  sessionId: true,
  fileId: true,
  sourceRowNo: true,
  orderBlock: true,
  orderNo: true,
  orderDate: true,
  customerName: true,
  projectModel: true,
  lineType: true,
  importSequence: true,
  partCategory: true,
  componentNo: true,
  parentComponentNo: true,
  partCode: true,
  drawingNo: true,
  partName: true,
  partSpecification: true,
  partThickness: true,
  orderQuantity: true,
  unitUsage: true,
  demandQuantity: true,
  unit: true,
  processRoute: true,
  processRemark: true,
  drawingDate: true,
  drawingStatus: true,
  issues: true,
  errorCount: true,
  warningCount: true,
  file: { select: { id: true, createdAt: true } }
} satisfies Prisma.OrderImportRowSelect;

const fallbackSubmitPlanOperators: SubmitPlanOperator[] = [
  {
    accountId: 'PLAN-001',
    name: '刘计划',
    role: '生产计划员'
  },
  {
    accountId: 'ORDER-001',
    name: '孙下单',
    role: '下单管理员'
  },
  {
    accountId: 'WS-001',
    name: '陈主任',
    role: '车间主任'
  },
  {
    accountId: 'TECH-001',
    name: '王工艺',
    role: '技术工艺员'
  }
];

const orderProductionFilterStatuses = [
  'ORDER_DRAFT',
  'WAITING_PRODUCTION',
  'ORDER_IN_PRODUCTION',
  'ORDER_COMPLETED_UNSHIPPED',
  'PARTIAL_SHIPPED',
  'ORDER_SHIPPED_COMPLETED',
  'ORDER_CANCELLED',
  ProductionStatus.PENDING,
  ProductionStatus.IN_PROGRESS,
  ProductionStatus.COMPLETED
] as const;

type OrderProductionFilterStatus = (typeof orderProductionFilterStatuses)[number];

@Injectable()
export class OrdersService {
  private readonly importCommitCreatedOrdersPreviewLimit = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processDefinitionsService: ProcessDefinitionsService
  ) {}

  async findAll(query: OrderQueryDto) {
    const where: Prisma.CustomerOrderWhereInput = {};
    const orderStatuses = this.parseEnumList<OrderStatus>(
      query.statuses,
      Object.values(OrderStatus) as OrderStatus[],
      '订单状态'
    );
    const productionStatuses = this.parseEnumList<OrderProductionFilterStatus>(
      query.productionStatuses,
      [...orderProductionFilterStatuses],
      '生产状态'
    );

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (orderStatuses.length > 0) {
      where.status = { in: orderStatuses };
    } else if (query.status) {
      where.status = query.status;
    }

    if (query.dateFrom || query.dateTo) {
      const orderDate: Prisma.DateTimeFilter = {};
      if (query.dateFrom) {
        orderDate.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        const dateTo = new Date(query.dateTo);
        dateTo.setHours(23, 59, 59, 999);
        orderDate.lte = dateTo;
      }
      where.orderDate = orderDate;
    }

    const orders = await this.prisma.customerOrder.findMany({
      where,
      include: {
        lines: {
          include: {
            inventoryTransactions: {
              where: { transactionType: InventoryTransactionType.OUT, sourceRecordType: 'InventoryBatch' },
              select: { id: true, transactionType: true, sourceRecordType: true, orderNo: true, quantity: true, unit: true }
            },
            inventoryBatches: {
              include: { transactions: true }
            }
          }
        },
        productionTasks: {
          include: {
            inventoryBatch: true,
            processCompletions: {
              include: {
                replenishmentRequests: {
                  orderBy: { createdAt: 'desc' }
                }
              }
            }
          }
        },
        inventoryBatches: {
          include: { transactions: true }
        }
      },
      orderBy: [{ orderDate: 'desc' }, { orderNo: 'desc' }]
    });

    const summaries = orders.map((order) => this.toSummary(order));
    if (productionStatuses.length === 0) {
      return summaries;
    }

    return summaries.filter((order) => this.orderMatchesProductionFilter(order, productionStatuses));
  }

  async findOne(orderNo: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
      include: {
        customer: true,
        inventoryBatches: {
          include: { transactions: true }
        },
        productionTasks: {
          include: {
            inventoryBatch: true,
            processCompletions: {
              include: {
                replenishmentRequests: {
                  orderBy: { createdAt: 'desc' }
                }
              }
            }
          }
        },
        lines: {
          include: {
            processSteps: { orderBy: { stepNo: 'asc' } },
            inventoryTransactions: {
              where: { transactionType: InventoryTransactionType.OUT, sourceRecordType: 'InventoryBatch' },
              select: { id: true, transactionType: true, sourceRecordType: true, orderNo: true, quantity: true, unit: true }
            },
            inventoryBatches: {
              include: { warehouse: true, location: true, transactions: true },
              orderBy: { createdAt: 'asc' }
            },
            productionTasks: {
              include: {
                inventoryBatch: {
                  include: { warehouse: true, location: true }
                },
                processCompletions: {
                  include: {
                    replenishmentRequests: {
                      orderBy: { createdAt: 'desc' }
                    }
                  },
                  orderBy: { stepNo: 'asc' }
                }
              },
              orderBy: { productionTaskNo: 'asc' }
            }
          },
          orderBy: { lineNo: 'asc' }
        }
      }
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const taskNos = order.lines.flatMap((line) => line.productionTasks.map((task) => task.productionTaskNo));
    const stockQuantityByTaskNo = await this.getStockQuantityByTaskNo(taskNos);
    const selectedStockBatchIds = order.lines.flatMap((line) =>
      this.jsonToStockSourceSelections(line.stockSourceSelections).map((source) => source.batchId)
    );
    const stockSourceInfoByBatchId = await this.getStockSourceInfoByBatchId(selectedStockBatchIds, order.id);
    const importSourceFileByLineId = await this.getImportSourceFileInfoByLineId(order);
    const materialIdentityInfoByPartCode = await this.getOrderLineMaterialIdentityInfoByPartCode(
      order.lines.map((line) => line.partCode)
    );
    return this.toDetail(
      order,
      stockQuantityByTaskNo,
      stockSourceInfoByBatchId,
      importSourceFileByLineId,
      materialIdentityInfoByPartCode
    );
  }

  async importSourceFilePreview(orderNo: string, fileId: string, query: GetOrderImportFilePreviewQueryDto = {}) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const { limit, offset } = this.importRowPageOptions(query);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const file = await this.prisma.orderImportFile.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        sessionId: true,
        fileName: true,
        storedFileName: true,
        sheetName: true,
        rowCount: true,
        acceptedRowCount: true,
        duplicateRowCount: true,
        createdAt: true
      }
    });
    if (!file) {
      throw new NotFoundException('来源 Excel 文件记录不存在，可能已删除导入记忆');
    }

    const fileDisplayName = this.importDisplayFileName(file.fileName);
    const sourceRowNos = [
      ...new Set(
        order.lines
          .filter((line) => {
            if (!line.sourceImportRowNo) {
              return false;
            }
            if (line.sourceImportFileId) {
              return line.sourceImportFileId === file.id;
            }
            if (line.sourceImportSessionId !== file.sessionId) {
              return false;
            }
            const lineFileName = this.importDisplayFileName(line.sourceImportFileName);
            return !lineFileName || lineFileName === fileDisplayName;
          })
          .map((line) => Number(line.sourceImportRowNo))
      )
    ];
    if (sourceRowNos.length === 0) {
      throw new BadRequestException('该来源 Excel 文件不属于当前订单');
    }

    const where = {
      fileId,
      sourceRowNo: { in: sourceRowNos }
    };
    const [totalCount, rows] = await Promise.all([
      this.prisma.orderImportRow.count({ where }),
      this.prisma.orderImportRow.findMany({
        where,
        orderBy: { sourceRowNo: 'asc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          sourceRowNo: true,
          orderBlock: true,
          orderNo: true,
          orderDate: true,
          customerName: true,
          projectModel: true,
          lineType: true,
          importSequence: true,
          partCategory: true,
          componentNo: true,
          parentComponentNo: true,
          partCode: true,
          drawingNo: true,
          partName: true,
          partSpecification: true,
          partThickness: true,
          orderQuantity: true,
          unitUsage: true,
          demandQuantity: true,
          unit: true,
          processRoute: true,
          processRemark: true,
          drawingDate: true,
          drawingStatus: true,
          issues: true,
          errorCount: true,
          warningCount: true
        }
      })
    ]);
    if (totalCount === 0) {
      throw new NotFoundException('当前订单在该来源 Excel 文件中没有可预览的明细');
    }

    return {
      orderNo: order.orderNo,
      file: this.toImportSourceFileInfo(file),
      rowPage: {
        offset,
        limit,
        loadedCount: rows.length,
        totalCount,
        hasMore: offset + rows.length < totalCount
      },
      rows: rows.map((row) => ({
        id: row.id,
        sourceRowNo: row.sourceRowNo,
        orderBlock: row.orderBlock,
        orderNo: row.orderNo,
        orderDate: this.formatImportDateOnly(row.orderDate),
        customerName: row.customerName,
        projectModel: row.projectModel,
        lineType: row.lineType,
        importSequence: row.importSequence,
        partCategory: row.partCategory,
        componentNo: row.componentNo,
        parentComponentNo: row.parentComponentNo,
        partCode: row.partCode,
        drawingNo: row.drawingNo,
        partName: row.partName,
        partSpecification: row.partSpecification,
        partThickness: decimalToNumber(row.partThickness),
        orderQuantity: row.orderQuantity === null || row.orderQuantity === undefined ? undefined : decimalToNumber(row.orderQuantity),
        unitUsage: row.unitUsage === null || row.unitUsage === undefined ? undefined : decimalToNumber(row.unitUsage),
        demandQuantity: decimalToNumber(row.demandQuantity),
        unit: row.unit,
        processRoute: row.processRoute,
        processRemark: row.processRemark,
        drawingDate: row.drawingDate ? this.formatDateOnly(row.drawingDate) : undefined,
        drawingStatus: row.drawingStatus,
        issues: this.importIssueArray(row.issues),
        errorCount: row.errorCount,
        warningCount: row.warningCount
      }))
    };
  }

  async nextOrderNo(query: NextOrderNoQueryDto) {
    const orderDate = query.orderDate ? new Date(query.orderDate) : new Date();
    return { orderNo: await this.generateOrderNo(orderDate) };
  }

  async checkOrderNo(orderNo: string, excludeOrderNo?: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const exists = await this.orderNoExists(normalizedOrderNo, excludeOrderNo);
    return {
      orderNo: normalizedOrderNo,
      exists,
      available: !exists
    };
  }

  async findDuplicateDrawingNos(value: string, excludeOrderNo?: string) {
    return this.findDuplicateOrderLines('drawingNo', value, excludeOrderNo);
  }

  async findDuplicateDrawingFiles(value: string, excludeOrderNo?: string) {
    return this.findDuplicateOrderLines('drawingFileName', value, excludeOrderNo);
  }

  async createImportSession(dto: CreateOrderImportSessionDto) {
    const session = await this.prisma.orderImportSession.create({
      data: {
        createdBy: dto.createdBy?.trim() || null,
        status: 'DRAFT'
      }
    });
    return this.buildImportSessionPreview(session.id);
  }

  async getImportSession(sessionId: string, query: GetOrderImportSessionQueryDto = {}) {
    return this.buildImportSessionPreview(sessionId, this.importPreviewPageOptions(query));
  }

  async importSessionFilePreview(sessionId: string, fileId: string, query: GetOrderImportFilePreviewQueryDto = {}) {
    const { limit, offset } = this.importRowPageOptions(query);

    const session = await this.prisma.orderImportSession.findUnique({
      where: { id: sessionId },
      include: {
        files: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }
      }
    });
    if (!session) {
      throw new NotFoundException('导入会话不存在');
    }
    const file = session.files.find((item) => item.id === fileId);
    if (!file) {
      throw new NotFoundException('上传文件不存在或不属于当前导入会话');
    }

    const sessionRows = await this.prisma.orderImportRow.findMany({
      where: { sessionId },
      select: orderImportRowPreviewSelect,
      orderBy: [{ orderNo: 'asc' }, { sourceRowNo: 'asc' }]
    });
    const fileOrder = new Map(session.files.map((item, index) => [item.id, index]));
    const fileNameById = new Map(session.files.map((item) => [item.id, this.importDisplayFileName(item.fileName)]));
    const sortedRows = [...(sessionRows as any[])].sort((left, right) => {
      const orderCompare = String(left.orderNo || '').localeCompare(String(right.orderNo || ''));
      if (orderCompare !== 0) {
        return orderCompare;
      }
      const fileCompare = (fileOrder.get(left.fileId) ?? 0) - (fileOrder.get(right.fileId) ?? 0);
      if (fileCompare !== 0) {
        return fileCompare;
      }
      return left.sourceRowNo - right.sourceRowNo;
    });
    const normalizedRows = this.normalizeImportRowsForSessionPreview(sortedRows);
    const orderGroups = new Map<string, any[]>();
    const targetOrderKeys = new Set<string>();
    for (const row of normalizedRows) {
      const key = row.orderNo || `ROW-${row.id}`;
      const group = orderGroups.get(key) || [];
      group.push(row);
      orderGroups.set(key, group);
      if (row.fileId === fileId) {
        targetOrderKeys.add(key);
      }
    }

    const targetOrderEntries = [...orderGroups.entries()].filter(([orderKey]) => targetOrderKeys.has(orderKey));
    const targetRows = targetOrderEntries.flatMap(([, rows]) => rows);
    const customerLookup = await this.findEnabledCustomersForImport(targetRows.map((row) => row.customerName));
    const existingOrderNos =
      session.status === 'DRAFT' ? await this.findExistingOrderNosForImport(targetRows.map((row) => row.orderNo)) : new Set<string>();
    const activeProcessKeys = await this.activeProcessNameKeys();

    const targetPreviewRows = targetOrderEntries.flatMap(([orderNo, rows]) =>
      this.buildImportOrderPreview(orderNo, rows, customerLookup, existingOrderNos, activeProcessKeys, {
        includeRows: true,
        fileNameById
      }).rows
    );
    const fileRows = targetPreviewRows
      .filter((row: any) => row.sourceImportFileId === fileId)
      .sort((left: any, right: any) => left.sourceRowNo - right.sourceRowNo);
    const visibleRows = fileRows.slice(offset, offset + limit);

    return {
      sessionId: session.id,
      status: session.status,
      file: this.toImportSourceFileInfo(file),
      rowPage: {
        offset,
        limit,
        loadedCount: visibleRows.length,
        totalCount: fileRows.length,
        hasMore: offset + visibleRows.length < fileRows.length
      },
      rows: visibleRows
    };
  }

  async listImportSelectableOrderNos(sessionId: string) {
    const preview = await this.buildImportSessionPreview(sessionId, { allOrders: true, includeRows: false });
    if (preview.status !== 'DRAFT') {
      throw new BadRequestException('只有未提交的导入会话可以批量勾选订单');
    }
    const selectableOrders = preview.orders.filter((order) => order.errorCount === 0);
    return {
      sessionId,
      status: preview.status,
      totalOrderCount: preview.summary.orderCount,
      selectableCount: selectableOrders.length,
      blockedCount: preview.summary.orderCount - selectableOrders.length,
      errorCount: preview.summary.errorCount,
      warningCount: preview.summary.warningCount,
      orders: selectableOrders.map((order) => ({
        orderNo: order.orderNo,
        warningCount: order.warningCount
      })),
      orderNos: selectableOrders.map((order) => order.orderNo)
    };
  }

  async listImportSessions(query: ListOrderImportSessionQueryDto = {}) {
    const requestedLimit = Number(query.limit ?? 20);
    const requestedOffset = Number(query.offset ?? 0);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 20, 1), 100);
    const offset = Math.max(Number.isFinite(requestedOffset) ? requestedOffset : 0, 0);
    const [totalCount, sessions] = await Promise.all([
      this.prisma.orderImportSession.count(),
      this.prisma.orderImportSession.findMany({
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          status: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
          committedAt: true,
          _count: { select: { rows: true, files: true } }
        }
      })
    ]);

    const sessionIds = sessions.map((session) => session.id);
    const [rowStats, fileStats, fileNamePreviewRows, orderNoGroups, blankOrderNoStats, committedOrderCountRows] =
      sessionIds.length > 0
        ? await Promise.all([
            this.prisma.orderImportRow.groupBy({
              by: ['sessionId'],
              where: { sessionId: { in: sessionIds } },
              _count: { _all: true },
              _sum: { errorCount: true, warningCount: true }
            }),
            this.prisma.orderImportFile.groupBy({
              by: ['sessionId'],
              where: { sessionId: { in: sessionIds } },
              _count: { _all: true },
              _sum: { duplicateRowCount: true }
            }),
            this.prisma.$queryRaw<Array<{ sessionId: string; fileName: string }>>(Prisma.sql`
              SELECT "sessionId", "fileName"
              FROM (
                SELECT
                  "sessionId",
                  "fileName",
                  row_number() OVER (PARTITION BY "sessionId" ORDER BY "createdAt" ASC, "id" ASC) AS "rowNo"
                FROM "OrderImportFile"
                WHERE "sessionId" IN (${Prisma.join(sessionIds)})
              ) AS "rankedFiles"
              WHERE "rowNo" <= 5
              ORDER BY "sessionId" ASC, "rowNo" ASC
            `),
            this.prisma.orderImportRow.groupBy({
              by: ['sessionId', 'orderNo'],
              where: { sessionId: { in: sessionIds }, orderNo: { not: '' } },
              _count: { _all: true }
            }),
            this.prisma.orderImportRow.groupBy({
              by: ['sessionId'],
              where: { sessionId: { in: sessionIds }, orderNo: '' },
              _count: { _all: true }
            }),
            this.prisma.$queryRaw<Array<{ sessionId: string; committedOrderCount: number | bigint }>>(Prisma.sql`
              SELECT
                "id" AS "sessionId",
                CASE
                  WHEN jsonb_typeof("committedOrderNos") = 'array' THEN jsonb_array_length("committedOrderNos")
                  ELSE 0
                END AS "committedOrderCount"
              FROM "OrderImportSession"
              WHERE "id" IN (${Prisma.join(sessionIds)})
            `)
          ])
        : [[], [], [], [], [], []];
    const rowStatsBySessionId = new Map(rowStats.map((row) => [row.sessionId, row]));
    const fileStatsBySessionId = new Map(fileStats.map((row) => [row.sessionId, row]));
    const committedOrderCountBySessionId = new Map(
      committedOrderCountRows.map((row) => [row.sessionId, Number(row.committedOrderCount || 0)])
    );
    const sessionStatusById = new Map(sessions.map((session) => [session.id, session.status]));
    const orderPreviewStatsBySessionId = await this.buildImportSessionOrderStats(sessionIds, sessionStatusById);
    const currentCommittedOrderNoSummariesBySessionId = await this.findCurrentImportCommittedOrderNoSummariesBySessionIds(sessionIds);
    const fileNamesBySessionId = new Map<string, string[]>();
    for (const row of fileNamePreviewRows) {
      const fileNames = fileNamesBySessionId.get(row.sessionId) || [];
      fileNames.push(this.importDisplayFileName(row.fileName));
      fileNamesBySessionId.set(row.sessionId, fileNames);
    }
    const blankOrderNoCountBySessionId = new Map(blankOrderNoStats.map((row) => [row.sessionId, row._count._all]));
    const orderNosBySessionId = new Map<string, string[]>();
    const orderNoCountBySessionId = new Map<string, number>();
    [...orderNoGroups]
      .sort((left, right) => `${left.sessionId}:${left.orderNo}`.localeCompare(`${right.sessionId}:${right.orderNo}`))
      .forEach((group) => {
        const orderNos = orderNosBySessionId.get(group.sessionId) || [];
        orderNoCountBySessionId.set(group.sessionId, (orderNoCountBySessionId.get(group.sessionId) || 0) + 1);
        if (orderNos.length < 5) {
          orderNos.push(group.orderNo);
          orderNosBySessionId.set(group.sessionId, orderNos);
        }
      });

    const items = sessions.map((session) => {
      const rowStat = rowStatsBySessionId.get(session.id);
      const fileStat = fileStatsBySessionId.get(session.id);
      const orderPreviewStat = orderPreviewStatsBySessionId.get(session.id);
      const fileNamesPreview = fileNamesBySessionId.get(session.id) || [];
      const orderNosPreview = orderNosBySessionId.get(session.id) || [];
      const committedOrderCount = committedOrderCountBySessionId.get(session.id) || 0;
      const committedOrderNosPreview: string[] = [];
      const currentCommittedOrderNoSummary = currentCommittedOrderNoSummariesBySessionId.get(session.id);
      const currentCommittedOrderNosPreview = currentCommittedOrderNoSummary?.preview || [];
      const blankOrderNoCount = blankOrderNoCountBySessionId.get(session.id) || 0;
      const orderNoCount = orderPreviewStat?.orderCount ?? (orderNoCountBySessionId.get(session.id) || 0) + blankOrderNoCount;
      if (blankOrderNoCount > 0 && orderNosPreview.length < 5) {
        orderNosPreview.push(`未填写订单号 ${blankOrderNoCount} 行`);
      }
      return {
        id: session.id,
        status: session.status,
        createdBy: session.createdBy,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        committedAt: session.committedAt,
        fileCount: fileStat?._count._all || session._count.files,
        rowCount: rowStat?._count._all || session._count.rows,
        orderCount: orderNoCount,
        orderNoCount,
        orderNos: orderNosPreview,
        orderNosPreview,
        committedOrderCount,
        committedOrderNos: committedOrderNosPreview,
        committedOrderNosPreview,
        currentCommittedOrderCount: currentCommittedOrderNoSummary?.count || 0,
        currentCommittedOrderNos: currentCommittedOrderNosPreview,
        currentCommittedOrderNosPreview,
        fileNames: fileNamesPreview,
        fileNamesPreview,
        duplicateRowCount: fileStat?._sum.duplicateRowCount || 0,
        selectableOrderCount: orderPreviewStat?.selectableOrderCount ?? Math.max(orderNoCount - (rowStat?._sum.errorCount || 0), 0),
        blockedOrderCount: orderPreviewStat?.blockedOrderCount ?? (rowStat?._sum.errorCount ? orderNoCount : 0),
        errorCount: orderPreviewStat?.errorCount ?? rowStat?._sum.errorCount ?? 0,
        warningCount: orderPreviewStat?.warningCount ?? rowStat?._sum.warningCount ?? 0,
        materialSyncCount: orderPreviewStat?.materialSyncCount ?? 0,
        materialSyncPreview: orderPreviewStat?.materialSyncPreview ?? []
      };
    });

    return {
      items,
      totalCount,
      limit,
      offset,
      hasMore: offset + items.length < totalCount
    };
  }

  async discardImportSession(sessionId: string) {
    const session = await this.prisma.orderImportSession.findUnique({
      where: { id: sessionId },
      include: {
        files: {
          select: {
            storedFileName: true
          }
        }
      }
    });
    if (!session) {
      throw new NotFoundException('导入会话不存在');
    }

    await this.prisma.orderImportSession.delete({ where: { id: sessionId } });
    const deletedFiles = await Promise.all(
      session.files.map((file) => this.removeOrderImportStoredFile(file.storedFileName))
    );

    return {
      sessionId,
      discarded: session.status === 'DRAFT',
      deletedMemory: session.status !== 'DRAFT',
      previousStatus: session.status,
      deletedFileCount: deletedFiles.filter(Boolean).length
    };
  }

  async deleteImportFile(sessionId: string, fileId: string) {
    const session = await this.prisma.orderImportSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true }
    });
    if (!session) {
      throw new NotFoundException('导入会话不存在');
    }
    if (session.status !== 'DRAFT') {
      throw new BadRequestException('已提交的导入会话不能删除上传文件');
    }

    const importFile = await this.prisma.orderImportFile.findFirst({
      where: { id: fileId, sessionId },
      select: { id: true, storedFileName: true }
    });
    if (!importFile) {
      throw new NotFoundException('导入文件不存在');
    }

    await this.prisma.orderImportFile.delete({ where: { id: importFile.id } });
    const deletedFile = await this.removeOrderImportStoredFile(importFile.storedFileName);
    return {
      ...(await this.buildImportSessionPreview(sessionId)),
      deletedFileId: importFile.id,
      deletedFileCount: deletedFile ? 1 : 0
    };
  }

  async buildOrderImportTemplate(): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();

    const headers = [
      '订单块(自动)',
      '订单编号',
      '制单日期',
      '客户名称',
      '项目型号',
      '行类型',
      '自动序号',
      '零件类型',
      '组件编号(自动)',
      '所属组件编号(自动/可改)',
      '物料号',
      '图号',
      '产品名称',
      '展开尺寸',
      '厚度',
      '订单数',
      '单套用量',
      '需求数量(自动)',
      '单位',
      '工艺路线',
      '工艺备注',
      '图纸日期',
      '图纸状态'
    ];
    const widths = [12, 22, 14, 28, 14, 10, 10, 12, 16, 22, 20, 26, 24, 14, 10, 10, 10, 16, 8, 24, 42, 14, 12];
    const lineTypes = ['零件', '组件'];
    const partCategories = ['通用件', '定制件', '数控件', '外协件'];
    const units = ['件', '套', '张', '个', '根', '米'];
    const drawingStatuses = ['旧图', '新图', '图纸变更', '待确认'];

    const setRowValues = (worksheet: ExcelJS.Worksheet, rowNo: number, values: unknown[]) => {
      values.forEach((value, index) => {
        worksheet.getCell(rowNo, index + 1).value = value as ExcelJS.CellValue;
      });
    };

    const styleHeaderRow = (worksheet: ExcelJS.Worksheet, rowNo: number) => {
      const row = worksheet.getRow(rowNo);
      row.height = 28;
      row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24435F' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF8EA9C1' } },
          bottom: { style: 'thin', color: { argb: 'FF8EA9C1' } },
          left: { style: 'thin', color: { argb: 'FF8EA9C1' } },
          right: { style: 'thin', color: { argb: 'FF8EA9C1' } }
        };
      });
    };

    const styleDataArea = (worksheet: ExcelJS.Worksheet, startRow: number, endRow: number) => {
      for (let rowNo = startRow; rowNo <= endRow; rowNo += 1) {
        const row = worksheet.getRow(rowNo);
        row.height = 24;
        headers.forEach((_, index) => {
          const cell = row.getCell(index + 1);
          cell.alignment = { vertical: 'middle', wrapText: true };
          cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFE4EEF6' } },
            left: { style: 'thin', color: { argb: 'FFE4EEF6' } },
            right: { style: 'thin', color: { argb: 'FFE4EEF6' } }
          };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNo % 2 === 0 ? 'FFEAF8FC' : 'FFFFFFFF' } };
        });
      }
    };

    const addValidations = (worksheet: ExcelJS.Worksheet, startRow: number, endRow: number) => {
      for (let rowNo = startRow; rowNo <= endRow; rowNo += 1) {
        worksheet.getCell(rowNo, 1).value = {
          formula:
            rowNo === startRow
              ? `IF(B${rowNo}="","",1)`
              : `IF(B${rowNo}="","",IF(B${rowNo}=B${rowNo - 1},A${rowNo - 1},A${rowNo - 1}+1))`
        };
        worksheet.getCell(rowNo, 7).value = {
          formula: `IF($B${rowNo}="","",IF($J${rowNo}<>"",IFERROR(LOOKUP(2,1/(($B$${startRow}:$B$${endRow}=$B${rowNo})*($F$${startRow}:$F$${endRow}="组件")*($I$${startRow}:$I$${endRow}=$J${rowNo})),$G$${startRow}:$G$${endRow})&"."&COUNTIFS($B$${startRow}:$B${rowNo},$B${rowNo},$J$${startRow}:$J${rowNo},$J${rowNo}),""),COUNTIFS($B$${startRow}:$B${rowNo},$B${rowNo},$J$${startRow}:$J${rowNo},"")))`
        };
        worksheet.getCell(rowNo, 9).value = {
          formula: `IF($F${rowNo}="组件","C"&TEXT(COUNTIFS($B$${startRow}:$B${rowNo},$B${rowNo},$F$${startRow}:$F${rowNo},"组件"),"000"),"")`
        };
        worksheet.getCell(rowNo, 10).value = {
          formula: `IF($B${rowNo}="","",IF($F${rowNo}="组件","",IF($Q${rowNo}<>"",IF(AND($B${rowNo}=$B${rowNo - 1},$F${rowNo - 1}="组件"),$I${rowNo - 1},IF(AND($B${rowNo}=$B${rowNo - 1},$J${rowNo - 1}<>""),$J${rowNo - 1},"")),"")))`
        };
        worksheet.getCell(rowNo, 18).value = {
          formula: `IF($B${rowNo}="","",IF($J${rowNo}<>"",IFERROR(LOOKUP(2,1/(($B$${startRow}:$B$${endRow}=$B${rowNo})*($F$${startRow}:$F$${endRow}="组件")*($I$${startRow}:$I$${endRow}=$J${rowNo})),$R$${startRow}:$R$${endRow})*IF($Q${rowNo}="",1,$Q${rowNo}),""),IF($P${rowNo}="","",IF($Q${rowNo}="",$P${rowNo},$P${rowNo}*$Q${rowNo}))))`
        };
        worksheet.getCell(rowNo, 6).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [`"${lineTypes.join(',')}"`]
        };
        worksheet.getCell(rowNo, 8).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${partCategories.join(',')}"`]
        };
        worksheet.getCell(rowNo, 9).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ["'选项'!$E$2:$E$10000"],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: '组件编号可自定义',
          error: '下拉只是辅助选择；如果需要其他组件编号，可以继续输入，但必须保证同一订单内唯一。'
        };
        worksheet.getCell(rowNo, 10).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ["'选项'!$E$2:$E$10000"],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: '所属组件编号可自定义',
          error: '下拉只是辅助选择；如果需要其他所属组件编号，可以继续输入，但必须能在同一订单内找到对应组件。'
        };
        worksheet.getCell(rowNo, 19).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [`"${units.join(',')}"`]
        };
        worksheet.getCell(rowNo, 23).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${drawingStatuses.join(',')}"`]
        };
      }
    };

    const uploadSheet = workbook.addWorksheet('ERP上传净表');
    uploadSheet.views = [{ state: 'frozen', ySplit: 4 }];
    uploadSheet.mergeCells(1, 1, 1, headers.length);
    uploadSheet.getCell(1, 1).value = 'ERP 组件/零件清单上传模板';
    uploadSheet.getCell(1, 1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 16 };
    uploadSheet.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    uploadSheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    uploadSheet.mergeCells(2, 1, 2, headers.length);
    uploadSheet.getCell(2, 1).value =
      '只上传本工作表；明细从第 5 行开始连续填写，中间不得留空行，只允许尾部空白行。导入只创建草稿订单，不会自动提交生产、占用库存或生成生产任务。';
    uploadSheet.getCell(2, 1).font = { italic: true, color: { argb: 'FF37516B' } };
    uploadSheet.getCell(2, 1).alignment = { wrapText: true, vertical: 'middle' };
    uploadSheet.getRow(2).height = 32;
    setRowValues(uploadSheet, 4, headers);
    styleHeaderRow(uploadSheet, 4);
    headers.forEach((_, index) => {
      uploadSheet.getColumn(index + 1).width = widths[index];
    });
    uploadSheet.autoFilter = { from: 'A4', to: 'W4' };
    styleDataArea(uploadSheet, 5, 104);
    addValidations(uploadSheet, 5, 20000);

    const descriptionSheet = workbook.addWorksheet('字段说明');
    descriptionSheet.columns = [{ width: 24 }, { width: 64 }, { width: 34 }];
    [
      ['字段', '填写规则', '备注'],
      ['明细连续性', 'ERP上传净表从第 5 行开始连续填写，数据中间不能留空行。', '台账表可用空行分隔订单块；正式上传净表不允许中间空行，只允许尾部空白行。'],
      ['订单编号', '同一订单的所有明细行填写同一个订单编号。', '支持一个文件多订单，也支持连续上传多个文件。'],
      ['制单日期', '填写订单日期，格式建议 yyyy/m/d。', '例如 2026/6/1。'],
      ['行类型', '只能填写“零件”或“组件”。', '正式上传页没有订单头行。'],
      ['自动序号', '表格会按订单和所属组件自动生成 1、2、2.1、2.2。', '后端导入时也会重新计算缺失的自动序号。'],
      ['组件编号(自动)', '组件行会自动生成 C001-C9999，也可手工改成同订单内唯一编号。', '下拉只是辅助选择；每个订单内部独立编号，新的订单可以重新从 C001 开始。'],
      ['所属组件编号(自动/可改)', '组件子零件填写单套用量后，会优先沿用同订单上方组件编号；普通零件请保持为空。', '下拉只是辅助选择；必须能在同一个订单内找到对应组件。'],
      ['物料号', '每行必填真实物料号。', '不能用空白物料号创建正式订单。'],
      ['订单数', '普通零件填订单数；组件行填组件本体订单数。', '组件子零件可以留空。'],
      ['单套用量', '组件子零件必须填写。', '需求数量=所属组件需求数量×单套用量。'],
      ['需求数量(自动)', '普通零件=订单数×单套用量；组件子零件=父组件需求数量×单套用量。', '后端导入时会重新计算缺失值；不要填写库存、备库、手工计划等 ERP 内部决策字段。'],
      ['工艺路线', '可填可不填。', '复杂工序建议导入后在 ERP 零件工序编辑中完善。']
    ].forEach((row, index) => setRowValues(descriptionSheet, index + 1, row));
    styleHeaderRow(descriptionSheet, 1);
    descriptionSheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });

    const exampleSheet = workbook.addWorksheet('示例数据');
    setRowValues(exampleSheet, 1, headers);
    styleHeaderRow(exampleSheet, 1);
    const exampleRows = [
      [1, 'RSD-20260601-001', '2026/6/1', '示例客户', 'B型5P', '零件', 1, '通用件', '', '', 'RS1001', 'B5-10-50-01', '顶盖', '', '1mm', 16, '', 16, '件', '', '普通零件', '', '旧图'],
      [1, 'RSD-20260601-001', '2026/6/1', '示例客户', 'B型5P', '组件', 2, '定制件', 'C001', '', 'RS2001', 'B5-10-30', '风机支架组件', '', '2mm', 90, 2, 180, '套', '装配', '组件本体 90 套，每套用量 2', '', '旧图'],
      [1, 'RSD-20260601-001', '2026/6/1', '示例客户', 'B型5P', '零件', '2.1', '定制件', '', 'C001', 'RS2001-A', 'B5-10-30-A', '支架主板', '', '2mm', '', 2, 360, '件', '激光切割>折弯', '按父组件需求数量×2', '', '旧图'],
      [1, 'RSD-20260601-001', '2026/6/1', '示例客户', 'B型5P', '零件', '2.2', '定制件', '', 'C001', 'RS2001-B', 'B5-10-30-B', '支架加强片', '', '1.5mm', '', 1, 180, '件', '激光切割', '按父组件需求数量×1', '', '旧图']
    ];
    exampleRows.forEach((row, index) => setRowValues(exampleSheet, index + 2, row));
    headers.forEach((_, index) => {
      exampleSheet.getColumn(index + 1).width = widths[index];
    });

    const optionsSheet = workbook.addWorksheet('选项');
    optionsSheet.columns = [{ width: 16 }, { width: 16 }, { width: 12 }, { width: 14 }, { width: 18 }];
    setRowValues(optionsSheet, 1, ['行类型', '零件类型', '单位', '图纸状态', '组件编号']);
    for (let index = 0; index < 9999; index += 1) {
      setRowValues(optionsSheet, index + 2, [
        lineTypes[index] || '',
        partCategories[index] || '',
        units[index] || '',
        drawingStatuses[index] || '',
        `C${String(index + 1).padStart(3, '0')}`
      ]);
    }
    optionsSheet.state = 'hidden';

    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  async buildOrderImportIssueReport(sessionId: string): Promise<Uint8Array> {
    const preview = await this.buildImportSessionPreview(sessionId, { allOrders: true });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Baisheng ERP';
    workbook.created = new Date();
    workbook.modified = new Date();

    const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF24435F' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };
    const border = {
      top: { style: 'thin' as const, color: { argb: 'FFD9E5EF' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFD9E5EF' } },
      left: { style: 'thin' as const, color: { argb: 'FFD9E5EF' } },
      right: { style: 'thin' as const, color: { argb: 'FFD9E5EF' } }
    };
    const setValues = (worksheet: ExcelJS.Worksheet, rowNo: number, values: Array<string | number | null | undefined>) => {
      values.forEach((value, index) => {
        worksheet.getCell(rowNo, index + 1).value = value ?? '';
      });
    };
    const styleHeader = (worksheet: ExcelJS.Worksheet, rowNo: number) => {
      worksheet.getRow(rowNo).eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = border;
      });
      worksheet.getRow(rowNo).height = 26;
    };
    const styleBody = (worksheet: ExcelJS.Worksheet, startRow: number) => {
      for (let rowNo = startRow; rowNo <= worksheet.rowCount; rowNo += 1) {
        worksheet.getRow(rowNo).eachCell((cell) => {
          cell.alignment = { vertical: 'top', wrapText: true };
          cell.border = border;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNo % 2 === 0 ? 'FFF4FBFD' : 'FFFFFFFF' } };
        });
      }
    };

    const overviewSheet = workbook.addWorksheet('导入概览');
    overviewSheet.columns = [{ width: 24 }, { width: 28 }, { width: 28 }, { width: 28 }];
    setValues(overviewSheet, 1, ['项目', '数值', '项目', '数值']);
    styleHeader(overviewSheet, 1);
    const overviewRows = [
      ['导入会话', preview.id, '状态', preview.status === 'DRAFT' ? '未提交' : '已创建草稿'],
      ['上传文件数', preview.summary.fileCount, '明细行数', preview.summary.rowCount],
      ['订单数', preview.summary.orderCount, '可导入订单', preview.summary.selectableOrderCount],
      ['不可导入订单', preview.summary.blockedOrderCount, '重复行', preview.summary.duplicateRowCount],
      ['错误数', preview.summary.errorCount, '警告数', preview.summary.warningCount],
      ['预计同步物料', preview.summary.materialSyncCount, '物料示例', (preview.summary.materialSyncPreview || []).join('、')],
      ['生成时间', this.formatDateTime(new Date()), '说明', '仅用于修正 Excel；创建草稿前后端仍会重新校验']
    ];
    overviewRows.forEach((row, index) => setValues(overviewSheet, index + 2, row));
    styleBody(overviewSheet, 2);

    const fileSheet = workbook.addWorksheet('上传文件');
    fileSheet.columns = [{ width: 40 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 20 }];
    setValues(fileSheet, 1, ['文件名', '工作表', '明细行', '已读取', '重复行', '上传时间']);
    styleHeader(fileSheet, 1);
    preview.files.forEach((file, index) => {
      setValues(fileSheet, index + 2, [
        file.fileName,
        file.sheetName,
        file.rowCount,
        file.acceptedRowCount,
        file.duplicateRowCount,
        this.formatDateTime(file.createdAt)
      ]);
    });
    styleBody(fileSheet, 2);

    const issueSheet = workbook.addWorksheet('问题明细');
    issueSheet.views = [{ state: 'frozen', ySplit: 1 }];
    issueSheet.columns = [
      { width: 20 },
      { width: 12 },
      { width: 34 },
      { width: 12 },
      { width: 12 },
      { width: 10 },
      { width: 14 },
      { width: 14 },
      { width: 16 },
      { width: 18 },
      { width: 26 },
      { width: 12 },
      { width: 24 },
      { width: 62 },
      { width: 36 },
      { width: 12 }
    ];
    setValues(issueSheet, 1, [
      '订单编号',
      '订单状态',
      '来源文件',
      '来源行',
      '自动序号',
      '行类型',
      '组件编号',
      '所属组件',
      '物料号',
      '图号',
      '产品名称',
      '严重程度',
      '问题代码',
      '问题说明',
      '工艺备注',
      '图纸状态'
    ]);
    styleHeader(issueSheet, 1);

    let issueRowNo = 2;
    for (const order of preview.orders) {
      const orderStatus = order.errorCount > 0 ? '不可导入' : '可导入';
      for (const issue of order.issues) {
        setValues(issueSheet, issueRowNo, [
          order.orderNo,
          orderStatus,
          '',
          '',
          '',
          '订单',
          '',
          '',
          '',
          '',
          '',
          issue.severity === 'ERROR' ? '错误' : '警告',
          issue.code,
          issue.message,
          '',
          ''
        ]);
        issueRowNo += 1;
      }
      for (const row of order.rows) {
        for (const issue of row.issues) {
          setValues(issueSheet, issueRowNo, [
            order.orderNo,
            orderStatus,
            row.sourceFileName,
            row.sourceRowNo,
            row.importSequence,
            row.lineType === 'COMPONENT' ? '组件' : '零件',
            row.componentNo,
            row.parentComponentNo,
            row.partCode,
            row.drawingNo,
            row.partName,
            issue.severity === 'ERROR' ? '错误' : '警告',
            issue.code,
            issue.message,
            row.processRemark,
            row.drawingStatus
          ]);
          issueRowNo += 1;
        }
      }
    }
    if (issueRowNo === 2) {
      setValues(issueSheet, issueRowNo, ['', '通过', '', '', '', '', '', '', '', '', '', '', '', '当前导入预览没有错误或警告', '', '']);
    }
    issueSheet.autoFilter = { from: 'A1', to: 'P1' };
    styleBody(issueSheet, 2);

    const buffer = await workbook.xlsx.writeBuffer();
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    return new Uint8Array(buffer as unknown as ArrayLike<number>);
  }

  async uploadImportFile(sessionId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('必须上传 Excel 文件');
    }
    const originalFileName = this.importDisplayFileName(file.originalname) || 'order-import.xlsx';

    const session = await this.prisma.orderImportSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      await this.removeOrderImportStoredFile(file.filename);
      throw new NotFoundException('导入会话不存在');
    }
    if (session.status !== 'DRAFT') {
      await this.removeOrderImportStoredFile(file.filename);
      throw new BadRequestException('已提交的导入会话不能继续上传文件');
    }

    const fileBuffer = await readFile(file.path);
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
    const duplicatedFile = await this.prisma.orderImportFile.findUnique({
      where: { sessionId_fileHash: { sessionId, fileHash } }
    });
    if (duplicatedFile) {
      await this.removeOrderImportStoredFile(file.filename);
      throw new BadRequestException('该 Excel 文件已上传到当前导入会话，请勿重复上传');
    }

    let parsed: Awaited<ReturnType<typeof this.parseOrderImportWorkbook>>;
    try {
      parsed = await this.parseOrderImportWorkbook(file.path);
    } catch (error) {
      await this.removeOrderImportStoredFile(file.filename);
      throw error;
    }

    let uploadResult: { acceptedRowCount: number; duplicateRowCount: number };
    try {
      uploadResult = await runSerializableTransaction(
        this.prisma,
        async (tx) => {
          const freshSession = await tx.orderImportSession.findUnique({
            where: { id: sessionId },
            select: { status: true }
          });
          if (!freshSession) {
            throw new NotFoundException('导入会话不存在');
          }
          if (freshSession.status !== 'DRAFT') {
            throw new BadRequestException('已提交的导入会话不能继续上传文件');
          }

          const freshDuplicatedFile = await tx.orderImportFile.findUnique({
            where: { sessionId_fileHash: { sessionId, fileHash } }
          });
          if (freshDuplicatedFile) {
            throw new BadRequestException('该 Excel 文件已上传到当前导入会话，请勿重复上传');
          }

          const importFile = await tx.orderImportFile.create({
            data: {
              sessionId,
              fileName: originalFileName,
              storedFileName: file.filename,
              fileHash,
              sheetName: parsed.sheetName,
              rowCount: parsed.rows.length,
              acceptedRowCount: 0,
              duplicateRowCount: 0
            }
          });

          const importRows = parsed.rows.map((row) => {
            const issueCounts = this.countImportIssues(row.issues);
            return {
              sessionId,
              fileId: importFile.id,
              sourceRowNo: row.sourceRowNo,
              rowHash: row.rowHash,
              orderBlock: row.orderBlock || null,
              orderNo: row.orderNo,
              orderDate: row.orderDate || new Date(0),
              customerName: row.customerName,
              projectModel: row.projectModel || null,
              lineType: row.lineType,
              importSequence: row.importSequence || null,
              partCategory: row.partCategory || null,
              componentNo: row.componentNo || null,
              parentComponentNo: row.parentComponentNo || null,
              partCode: row.partCode,
              drawingNo: row.drawingNo || null,
              partName: row.partName,
              partSpecification: row.partSpecification || null,
              partThickness: row.partThickness || 1,
              orderQuantity: row.orderQuantity ?? null,
              unitUsage: row.unitUsage ?? null,
              demandQuantity: row.demandQuantity || 0,
              unit: row.unit || '件',
              processRoute: row.processRoute || null,
              processRemark: row.processRemark || null,
              drawingDate: row.drawingDate || null,
              drawingStatus: row.drawingStatus || null,
              raw: row.raw as Prisma.InputJsonValue,
              issues: row.issues as Prisma.InputJsonValue,
              errorCount: issueCounts.errorCount,
              warningCount: issueCounts.warningCount
            };
          });

          let acceptedRowCount = 0;
          for (const importRowsChunk of this.chunkValues(importRows, 500)) {
            const createRowsResult = await tx.orderImportRow.createMany({
              data: importRowsChunk,
              skipDuplicates: true
            });
            acceptedRowCount += createRowsResult.count;
          }
          const duplicateRowCount = parsed.rows.length - acceptedRowCount;

          await tx.orderImportFile.update({
            where: { id: importFile.id },
            data: { acceptedRowCount, duplicateRowCount }
          });

          return { acceptedRowCount, duplicateRowCount };
        },
        '导入文件正在被其他操作修改，请刷新后重新上传'
      );
    } catch (error) {
      await this.removeOrderImportStoredFile(file.filename);
      throw error;
    }

    const preview = await this.buildImportSessionPreview(sessionId, this.importPreviewPageOptions());
    return {
      ...preview,
      uploadResult: {
        fileName: originalFileName,
        sheetName: parsed.sheetName,
        rowCount: parsed.rows.length,
        acceptedRowCount: uploadResult.acceptedRowCount,
        duplicateRowCount: uploadResult.duplicateRowCount
      }
    };
  }

  async commitImportSession(sessionId: string, dto: CommitOrderImportSessionDto) {
    const preview = await this.buildImportSessionPreview(sessionId, { allOrders: true });
    if (preview.status !== 'DRAFT') {
      throw new BadRequestException('该导入会话已经提交，不能重复创建订单');
    }
    if (!dto.previewToken) {
      throw new BadRequestException('导入提交必须携带 previewToken，请刷新预览后重新提交');
    }
    if (dto.previewToken !== preview.previewToken) {
      throw new BadRequestException('导入预览已变化，请刷新预览后重新提交');
    }
    const useAllSelectableOrders = dto.allSelectable === true;
    const requestedOrderNos = dto.orderNos || [];
    const requestedExcludedOrderNos = dto.excludedOrderNos || [];
    if (useAllSelectableOrders && requestedOrderNos.length > 0) {
      throw new BadRequestException('批量创建全部可导入订单时，不需要同时传入订单编号列表');
    }
    if (!useAllSelectableOrders && requestedExcludedOrderNos.length > 0) {
      throw new BadRequestException('只有全部可导入模式才允许传入排除订单编号');
    }
    if (!useAllSelectableOrders && requestedOrderNos.length === 0) {
      throw new BadRequestException('必须明确选择要创建草稿的订单，不能空选后提交整批导入');
    }
    const normalizedRequestedOrderNos = requestedOrderNos.map((orderNo) => this.normalizeOrderNo(orderNo)).filter(Boolean);
    const selectedOrderNos = new Set(normalizedRequestedOrderNos);
    if (!useAllSelectableOrders && selectedOrderNos.size !== requestedOrderNos.length) {
      throw new BadRequestException('选择的订单编号存在空值或重复，请刷新导入预览后重新勾选');
    }
    const normalizedExcludedOrderNos = requestedExcludedOrderNos.map((orderNo) => this.normalizeOrderNo(orderNo)).filter(Boolean);
    const excludedOrderNos = new Set(normalizedExcludedOrderNos);
    if (useAllSelectableOrders && excludedOrderNos.size !== requestedExcludedOrderNos.length) {
      throw new BadRequestException('排除的订单编号存在空值或重复，请刷新导入预览后重新勾选');
    }
    const selectablePreviewOrders = preview.orders.filter((order) => order.errorCount === 0);
    if (useAllSelectableOrders && excludedOrderNos.size > 0) {
      const selectableOrderNos = new Set(selectablePreviewOrders.map((order) => this.normalizeOrderNo(order.orderNo)));
      const invalidExcludedOrderNos = [...excludedOrderNos].filter((orderNo) => !selectableOrderNos.has(orderNo));
      if (invalidExcludedOrderNos.length > 0) {
        throw new BadRequestException(`排除的订单不存在或已不可导入：${this.formatLimitedList(invalidExcludedOrderNos)}`);
      }
    }
    const targetOrders = useAllSelectableOrders
      ? selectablePreviewOrders.filter((order) => !excludedOrderNos.has(this.normalizeOrderNo(order.orderNo)))
      : preview.orders.filter((order) => selectedOrderNos.has(this.normalizeOrderNo(order.orderNo)));
    const skippedBlockedCount = useAllSelectableOrders ? preview.summary.blockedOrderCount : 0;
    const skippedSelectableCount = Math.max(selectablePreviewOrders.length - targetOrders.length, 0);
    if (targetOrders.length === 0) {
      throw new BadRequestException('没有可导入的订单');
    }
    if (!useAllSelectableOrders && targetOrders.length !== selectedOrderNos.size) {
      const matchedOrderNos = new Set(targetOrders.map((order) => this.normalizeOrderNo(order.orderNo)));
      const missingOrderNos = [...selectedOrderNos].filter((orderNo) => !matchedOrderNos.has(orderNo));
      throw new BadRequestException(`选择的订单不存在或已被过滤：${this.formatLimitedList(missingOrderNos)}`);
    }
    const occupiedPreviewOrderNos = targetOrders
      .filter((order) => order.issues.some((issue) => issue.code === 'ORDER_NO_EXISTS'))
      .map((order) => order.orderNo);
    if (occupiedPreviewOrderNos.length > 0) {
      throw new BadRequestException(`订单号已存在或已被占用：${this.formatLimitedList(occupiedPreviewOrderNos)}`);
    }
    const targetErrorCount = targetOrders.reduce((total, order) => total + order.errorCount, 0);
    if (targetErrorCount > 0) {
      throw new BadRequestException('选中的订单仍存在错误，请修正 Excel 后重新上传');
    }

    const activeProcessKeys = await this.activeProcessNameKeys();
    const importOrders: Array<{
      order: (typeof targetOrders)[number];
      orderNo: string;
      customerId: string;
      orderDate: Date;
      lines: CreateOrderDto['lines'];
      preparedLinePlans: PreparedOrderLinePlan[];
      normalizedLineSteps: ProcessStepSnapshot[][];
    }> = [];
    for (const order of targetOrders) {
      if (!order.customerId) {
        throw new BadRequestException(`订单 ${order.orderNo} 未匹配到客户，不能导入`);
      }
      const lines = order.rows.map((row) => this.importRowToOrderLinePayload(row, activeProcessKeys));
      this.validateOrderLines(lines, { requireStockSources: false });
      importOrders.push({
        order,
        orderNo: this.normalizeOrderNo(order.orderNo),
        customerId: order.customerId,
        orderDate: order.orderDate ? new Date(order.orderDate) : new Date(),
        lines,
        preparedLinePlans: await this.prepareOrderLinePlans(lines),
        normalizedLineSteps: await Promise.all(lines.map((line) => this.normalizeProcessSteps(line.processSteps, false)))
      });
    }

    const materialSyncSummary = this.materialSyncSummaryFromPartCodes(
      importOrders.flatMap((item) => item.lines.map((line) => line.partCode))
    );

    const createdOrders = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const freshSession = await tx.orderImportSession.findUnique({
          where: { id: sessionId },
          select: { status: true }
        });
        if (!freshSession) {
          throw new NotFoundException('导入会话不存在');
        }
        if (freshSession.status !== 'DRAFT') {
          throw new BadRequestException('该导入会话已经提交，不能重复创建订单');
        }

        const freshFiles = await tx.orderImportFile.findMany({
          where: { sessionId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            fileHash: true,
            rowCount: true,
            acceptedRowCount: true,
            duplicateRowCount: true,
            createdAt: true
          }
        });
        const freshPreviewToken = this.buildImportPreviewToken({
          sessionId,
          status: freshSession.status,
          files: freshFiles
        });
        if (freshPreviewToken !== preview.previewToken) {
          throw new BadRequestException('导入预览已变化，请刷新预览后重新提交');
        }

        const occupiedOrderNos = await this.findExistingOrderNosForImport(
          importOrders.map((item) => item.orderNo),
          tx
        );
        if (occupiedOrderNos.size > 0) {
          throw new BadRequestException(`订单号已存在或已被占用：${this.formatLimitedList([...occupiedOrderNos])}`);
        }

        const customers = [];
        const customerIds = [...new Set(importOrders.map((item) => item.customerId))];
        for (const customerIdChunk of this.chunkValues(customerIds, 1000)) {
          customers.push(
            ...(await tx.customer.findMany({
              where: {
                id: { in: customerIdChunk },
                status: CommonStatus.ENABLED
              }
            }))
          );
        }
        const customerById = new Map(customers.map((customer) => [customer.id, customer]));
        const created = [];

        for (const item of importOrders) {
          const customer = customerById.get(item.customerId);
          if (!customer) {
            throw new BadRequestException(`订单 ${item.orderNo} 未匹配到启用客户，不能导入`);
          }

          // Excel 导入只保存 DRAFT 草稿，不触发 submit，也不生成生产任务或库存扣减。
          await this.validateOrderStockSourceSelections(item.lines, undefined, tx);
          await this.reserveOrderNo(tx, item.orderNo, undefined, 'ORDER_IMPORTED');
          await this.upsertMaterials(tx, item.lines);
          const createdOrder = await tx.customerOrder.create({
            data: {
              orderNo: item.orderNo,
              customerId: customer.id,
              customerCode: customer.customerCode,
              customerName: customer.customerName,
              customerSnapshot: {
                customerCode: customer.customerCode,
                customerName: customer.customerName,
                contactName: customer.contactName,
                contactPhone: customer.contactPhone
              },
              orderDate: item.orderDate,
              deliveryDate: null,
              remark: `Excel导入会话：${sessionId}`,
              status: OrderStatus.DRAFT,
              lines: {
                create: item.lines.map((line, index) => ({
                  lineNo: index + 1,
                  partCode: line.partCode.trim(),
                  partName: line.partName.trim(),
                  drawingNo: line.drawingNo?.trim(),
                  drawingVersion: line.drawingVersion?.trim(),
                  drawingFileName: line.drawingFileName?.trim(),
                  drawingFileUrl: line.drawingFileUrl?.trim(),
                  partThickness: line.partThickness,
                  partSpecification: line.partSpecification?.trim(),
                  quantity: line.quantity,
                  ...this.orderLinePlanData(item.preparedLinePlans[index]),
                  fulfillmentMode: this.normalizeFulfillmentMode(line.fulfillmentMode),
                  unit: line.unit.trim(),
                  deliveryDate: line.deliveryDate ? new Date(line.deliveryDate) : null,
                  remark: line.remark,
                  processSnapshot: this.processStepsToJson(item.normalizedLineSteps[index]),
                  stockSourceSelections: this.stockSourceSelectionsToJson(line.selectedStockSources),
                  ...this.orderLineImportData(line),
                  processSteps: {
                    create: item.normalizedLineSteps[index].map((processStep, stepIndex) => ({
                      stepNo: stepIndex + 1,
                      processName: processStep.processName,
                      processRemark: processStep.processRemark
                    }))
                  }
                }))
              }
            },
            include: {
              lines: true
            }
          });
          await this.linkOrderNoReservation(tx, item.orderNo, createdOrder.id, 'ORDER_IMPORTED');
          await this.syncOrderInventoryReservations(tx, createdOrder.id);
          created.push({
            id: createdOrder.id,
            orderNo: createdOrder.orderNo,
            customerName: createdOrder.customerName,
            status: createdOrder.status
          });
        }

        await tx.orderImportSession.update({
          where: { id: sessionId },
          data: {
            status: 'COMMITTED',
            committedAt: new Date(),
            committedOrderNos: created.map((order) => order.orderNo)
          }
        });

        return created;
      },
      '导入订单正在被其他操作修改，请刷新后重新提交导入'
    );

    return {
      sessionId,
      requestedMode: useAllSelectableOrders ? 'ALL_SELECTABLE' : 'SELECTED',
      createdCount: createdOrders.length,
      skippedBlockedCount,
      skippedSelectableCount,
      excludedOrderCount: useAllSelectableOrders ? excludedOrderNos.size : 0,
      materialSyncCount: materialSyncSummary.materialSyncCount,
      materialSyncPreview: materialSyncSummary.materialSyncPreview,
      committedOrderNos: createdOrders.map((order) => order.orderNo),
      createdOrders: createdOrders.slice(0, this.importCommitCreatedOrdersPreviewLimit),
      createdOrdersPreviewCount: Math.min(createdOrders.length, this.importCommitCreatedOrdersPreviewLimit),
      createdOrdersTruncated: createdOrders.length > this.importCommitCreatedOrdersPreviewLimit
    };
  }

  private async removeOrderImportStoredFile(storedFileName?: string | null) {
    const cleanFileName = basename(storedFileName?.trim() || '');
    if (!cleanFileName) {
      return false;
    }

    const uploadDir = resolve(orderImportUploadPath());
    const filePath = resolve(uploadDir, cleanFileName);
    const safeUploadDir = uploadDir.endsWith(sep) ? uploadDir : `${uploadDir}${sep}`;
    if (!filePath.startsWith(safeUploadDir)) {
      return false;
    }

    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private importDisplayFileName(fileName?: string | null) {
    return normalizeMultipartFileName(fileName) || String(fileName || '').trim();
  }

  private importSourceFileUrl(storedFileName?: string | null) {
    const cleanFileName = basename(storedFileName?.trim() || '');
    return cleanFileName ? `/uploads/order-imports/${encodeURIComponent(cleanFileName)}` : undefined;
  }

  private toImportSourceFileInfo(file: {
    id: string;
    fileName: string | null;
    storedFileName?: string | null;
    sheetName?: string | null;
    rowCount?: number | null;
    acceptedRowCount?: number | null;
    duplicateRowCount?: number | null;
    createdAt?: Date | string | null;
  }) {
    return {
      id: file.id,
      fileName: this.importDisplayFileName(file.fileName),
      storedFileName: file.storedFileName || undefined,
      fileUrl: this.importSourceFileUrl(file.storedFileName),
      sheetName: file.sheetName || undefined,
      rowCount: file.rowCount || 0,
      acceptedRowCount: file.acceptedRowCount || 0,
      duplicateRowCount: file.duplicateRowCount || 0,
      createdAt: file.createdAt
    };
  }

  private importSourceLineKey(line: {
    sourceImportSessionId?: string | null;
    sourceImportRowNo?: number | null;
    partCode?: string | null;
    drawingNo?: string | null;
    partName?: string | null;
  }) {
    return [
      line.sourceImportSessionId || '',
      line.sourceImportRowNo || '',
      String(line.partCode || '').trim().toLocaleUpperCase(),
      String(line.drawingNo || '').trim().toLocaleUpperCase(),
      String(line.partName || '').trim()
    ].join('|');
  }

  private async getImportSourceFileInfoByLineId(order: { lines: any[] }) {
    const sourceLines = order.lines.filter(
      (line) => line.sourceImportFileId || (line.sourceImportSessionId && line.sourceImportRowNo)
    );
    if (sourceLines.length === 0) {
      return new Map<string, ReturnType<OrdersService['toImportSourceFileInfo']>>();
    }
    const sourceFileIds = [...new Set(sourceLines.map((line) => line.sourceImportFileId).filter(Boolean))];
    const sourceFiles = sourceFileIds.length
      ? await this.prisma.orderImportFile.findMany({
          where: { id: { in: sourceFileIds } },
          select: {
            id: true,
            fileName: true,
            storedFileName: true,
            sheetName: true,
            rowCount: true,
            acceptedRowCount: true,
            duplicateRowCount: true,
            createdAt: true
          }
        })
      : [];
    const filesById = new Map(sourceFiles.map((file) => [file.id, this.toImportSourceFileInfo(file)]));

    const fallbackLines = sourceLines.filter(
      (line) => line.sourceImportSessionId && line.sourceImportRowNo && (!line.sourceImportFileId || !filesById.has(line.sourceImportFileId))
    );
    const sessionIds = [...new Set(fallbackLines.map((line) => line.sourceImportSessionId).filter(Boolean))];
    const sourceRowNos = [...new Set(fallbackLines.map((line) => line.sourceImportRowNo).filter(Boolean))];
    const importRows =
      sessionIds.length && sourceRowNos.length
        ? await this.prisma.orderImportRow.findMany({
            where: {
              sessionId: { in: sessionIds },
              sourceRowNo: { in: sourceRowNos }
            },
            select: {
              sessionId: true,
              sourceRowNo: true,
              partCode: true,
              drawingNo: true,
              partName: true,
              file: {
                select: {
                  id: true,
                  fileName: true,
                  storedFileName: true,
                  sheetName: true,
                  rowCount: true,
                  acceptedRowCount: true,
                  duplicateRowCount: true,
                  createdAt: true
                }
              }
            }
          })
        : [];

    const rowsByKey = new Map<string, typeof importRows>();
    for (const row of importRows) {
      const key = this.importSourceLineKey({
        sourceImportSessionId: row.sessionId,
        sourceImportRowNo: row.sourceRowNo,
        partCode: row.partCode,
        drawingNo: row.drawingNo,
        partName: row.partName
      });
      const rows = rowsByKey.get(key) || [];
      rows.push(row);
      rowsByKey.set(key, rows);
    }

    const result = new Map<string, ReturnType<OrdersService['toImportSourceFileInfo']>>();
    for (const line of sourceLines) {
      if (line.sourceImportFileId) {
        const directFile = filesById.get(line.sourceImportFileId);
        if (directFile) {
          result.set(line.id, directFile);
          continue;
        }
      }
      const candidates = rowsByKey.get(this.importSourceLineKey(line)) || [];
      const decodedLineFileName = this.importDisplayFileName(line.sourceImportFileName);
      const matched =
        candidates.find((row) => this.importDisplayFileName(row.file.fileName) === decodedLineFileName) || candidates[0];
      if (matched?.file) {
        result.set(line.id, this.toImportSourceFileInfo(matched.file));
      }
    }
    return result;
  }

  private async normalizeOrderLineImportReferences<T extends CreateOrderLineDto>(lines: T[]): Promise<T[]> {
    const sourceFileIds = [
      ...new Set(lines.map((line) => line.sourceImportFileId?.trim()).filter((value): value is string => Boolean(value)))
    ];
    if (sourceFileIds.length === 0) {
      return lines;
    }
    const existingFiles = await this.prisma.orderImportFile.findMany({
      where: { id: { in: sourceFileIds } },
      select: { id: true, sessionId: true, fileName: true }
    });
    const filesById = new Map(existingFiles.map((file) => [file.id, file]));
    return lines.map((line) => {
      const sourceImportFileId = line.sourceImportFileId?.trim();
      if (!sourceImportFileId) {
        return line;
      }
      const file = filesById.get(sourceImportFileId);
      const sourceImportSessionId = line.sourceImportSessionId?.trim();
      const sourceImportRowNo = line.sourceImportRowNo;
      if (!file || !sourceImportSessionId || !sourceImportRowNo || file.sessionId !== sourceImportSessionId) {
        return { ...line, sourceImportFileId: undefined };
      }
      const sourceImportFileName = this.importDisplayFileName(line.sourceImportFileName);
      const fileDisplayName = this.importDisplayFileName(file.fileName);
      if (sourceImportFileName && sourceImportFileName !== fileDisplayName) {
        return { ...line, sourceImportFileId: undefined };
      }
      return {
        ...line,
        sourceImportSessionId,
        sourceImportFileId,
        sourceImportFileName: sourceImportFileName || fileDisplayName,
        sourceImportRowNo
      };
    });
  }

  private formatLimitedList(values: string[], limit = 20) {
    const cleanedValues = values.map((value) => String(value || '').trim()).filter(Boolean);
    const visibleValues = cleanedValues.slice(0, limit);
    const suffix = cleanedValues.length > visibleValues.length ? ` 等 ${cleanedValues.length} 项` : '';
    return `${visibleValues.join('、')}${suffix}`;
  }

  private firstValues(values: string[], limit: number) {
    const result: string[] = [];
    for (const value of values) {
      if (result.length >= limit) {
        break;
      }
      result.push(value);
    }
    return result;
  }

  private materialSyncSummaryFromPartCodes(partCodes: Array<string | null | undefined>, previewLimit = 5) {
    const seen = new Set<string>();
    const materialSyncPreview: string[] = [];
    for (const partCode of partCodes) {
      const cleanPartCode = String(partCode || '').trim();
      if (!cleanPartCode) {
        continue;
      }
      const key = cleanPartCode.toLocaleLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (materialSyncPreview.length < previewLimit) {
        materialSyncPreview.push(cleanPartCode);
      }
    }
    return {
      materialSyncCount: seen.size,
      materialSyncPreview
    };
  }

  private chunkValues<T>(values: T[], size = 500) {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
      chunks.push(values.slice(index, index + size));
    }
    return chunks;
  }

  private normalizedPartCodeKey(value?: string | null) {
    return value?.trim().toLocaleLowerCase() || '';
  }

  private async getOrderLineMaterialIdentityInfoByPartCode(
    partCodes: Array<string | null | undefined>,
    client: Pick<Prisma.TransactionClient, 'orderLine'> = this.prisma
  ) {
    const normalizedPartCodes = [
      ...new Set(partCodes.map((partCode) => this.normalizedPartCodeKey(partCode)).filter(Boolean))
    ];
    const infoByPartCode = new Map<string, OrderLineMaterialIdentityInfo>();
    if (normalizedPartCodes.length === 0) {
      return infoByPartCode;
    }

    for (const partCodeChunk of this.chunkValues(normalizedPartCodes, 100)) {
      const historyLines = await client.orderLine.findMany({
        where: {
          OR: partCodeChunk.map((partCode) => ({ partCode: { equals: partCode, mode: 'insensitive' as const } }))
        },
        select: {
          partCode: true,
          partName: true,
          partSpecification: true,
          drawingNo: true,
          drawingVersion: true,
          drawingDate: true,
          drawingStatus: true,
          partThickness: true,
          projectModel: true
        }
      });

      for (const line of historyLines) {
        const key = this.normalizedPartCodeKey(line.partCode);
        if (!key) {
          continue;
        }
        const existing =
          infoByPartCode.get(key) ||
          ({
            identityKeys: new Set<string>(),
            identityFieldValues: new Map<string, Set<string>>(),
            variantCount: 1,
            conflictFields: []
          } satisfies OrderLineMaterialIdentityInfo);
        this.recordOrderLineMaterialIdentity(existing, line);
        infoByPartCode.set(key, existing);
      }
    }

    return infoByPartCode;
  }

  private recordOrderLineMaterialIdentity(
    existing: OrderLineMaterialIdentityInfo,
    value: {
      partName?: string | null;
      partSpecification?: string | null;
      drawingNo?: string | null;
      drawingVersion?: string | null;
      drawingDate?: Date | null;
      drawingStatus?: string | null;
      partThickness?: Prisma.Decimal | number | string | null;
      projectModel?: string | null;
    }
  ) {
    const identityValues = this.orderLineMaterialIdentityValues(value);
    const identityKey = identityValues.map((item) => `${item.field}:${item.value}`).join('|');
    if (identityKey) {
      existing.identityKeys.add(identityKey);
    }
    for (const item of identityValues) {
      const values = existing.identityFieldValues.get(item.field) || new Set<string>();
      values.add(item.value);
      existing.identityFieldValues.set(item.field, values);
    }
    let maxDistinctValues = 0;
    const conflictFields: string[] = [];
    for (const [field, values] of existing.identityFieldValues) {
      maxDistinctValues = Math.max(maxDistinctValues, values.size);
      if (values.size > 1) {
        conflictFields.push(orderLineMaterialIdentityFieldLabels[field] || field);
      }
    }
    existing.conflictFields = conflictFields;
    existing.variantCount = Math.max(maxDistinctValues, maxDistinctValues > 1 ? existing.identityKeys.size : 1);
  }

  private orderLineMaterialIdentityValues(value: {
    partName?: string | null;
    partSpecification?: string | null;
    drawingNo?: string | null;
    drawingVersion?: string | null;
    drawingDate?: Date | null;
    drawingStatus?: string | null;
    partThickness?: Prisma.Decimal | number | string | null;
    projectModel?: string | null;
  }): Array<{ field: string; value: string }> {
    return [
      { field: 'partName', value: normalizeSearchKeyword(value.partName) },
      { field: 'partSpecification', value: normalizeSearchKeyword(value.partSpecification) },
      { field: 'drawingNo', value: normalizeSearchKeyword(value.drawingNo) },
      { field: 'drawingVersion', value: normalizeSearchKeyword(value.drawingVersion) },
      { field: 'drawingDate', value: value.drawingDate ? this.formatDateOnly(value.drawingDate) || '' : '' },
      { field: 'drawingStatus', value: normalizeSearchKeyword(value.drawingStatus) },
      { field: 'partThickness', value: value.partThickness ? String(decimalToNumber(value.partThickness)) : '' },
      { field: 'projectModel', value: normalizeSearchKeyword(value.projectModel) }
    ].filter((item) => item.value);
  }

  private assertSubmitMaterialIdentityConfirmed(
    lines: Array<{ lineNo: number; partCode: string; partName: string }>,
    infoByPartCode: Map<string, OrderLineMaterialIdentityInfo>,
    confirmed?: boolean
  ) {
    const conflictLines = this.submitMaterialIdentityConflictLines(lines, infoByPartCode);
    if (conflictLines.length === 0 || confirmed) {
      return;
    }

    throw new BadRequestException(
      `发现同编码多套历史资料零件，提交生产前必须确认已核对：${this.formatSubmitMaterialIdentityConflictPreview(conflictLines, infoByPartCode)}`
    );
  }

  private submitMaterialIdentityConflictLines(
    lines: Array<{ lineNo: number; partCode: string; partName: string }>,
    infoByPartCode: Map<string, OrderLineMaterialIdentityInfo>
  ) {
    return lines.filter((line) => {
      const info = infoByPartCode.get(this.normalizedPartCodeKey(line.partCode));
      return Boolean(info && info.conflictFields.length > 0);
    });
  }

  private formatSubmitMaterialIdentityConflictPreview(
    conflictLines: Array<{ lineNo: number; partCode: string; partName: string }>,
    infoByPartCode: Map<string, OrderLineMaterialIdentityInfo>
  ) {
    const previewRows: string[] = [];
    for (const line of conflictLines) {
      if (previewRows.length >= 5) {
        break;
      }
      const info = infoByPartCode.get(this.normalizedPartCodeKey(line.partCode));
      const fields = info?.conflictFields.length ? info.conflictFields.join('、') : '图号、规格、厚度';
      previewRows.push(`第 ${line.lineNo} 行 ${line.partCode} / ${line.partName}（核对${fields}）`);
    }
    const preview = previewRows.join('；');
    const moreText = conflictLines.length > 5 ? `；另 ${conflictLines.length - 5} 个零件` : '';
    return `${preview}${moreText}`;
  }

  private submitMaterialIdentityConfirmationRemark(
    lines: Array<{ lineNo: number; partCode: string; partName: string }>,
    infoByPartCode: Map<string, OrderLineMaterialIdentityInfo>,
    submitOperator: SubmitPlanOperator,
    confirmed?: boolean
  ) {
    if (!confirmed) {
      return '';
    }
    const conflictLines = this.submitMaterialIdentityConflictLines(lines, infoByPartCode);
    if (conflictLines.length === 0) {
      return '';
    }
    return `同编码多套历史资料已核对：${submitOperator.name}（${submitOperator.accountId} / ${submitOperator.role}）；${this.formatSubmitMaterialIdentityConflictPreview(conflictLines, infoByPartCode)}`;
  }

  async create(dto: CreateOrderDto) {
    const lines = this.normalizeEditableOrderLineComponentFields(await this.normalizeOrderLineImportReferences(dto.lines));
    this.validateOrderLines(lines, { requireStockSources: false });
    const preparedLinePlans = await this.prepareOrderLinePlans(lines);

    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) {
      throw new NotFoundException('客户不存在');
    }
    if (customer.status !== CommonStatus.ENABLED) {
      throw new BadRequestException('只有启用状态的客户可以创建订单');
    }

    const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date();
    const orderNo = dto.orderNo?.trim() ? this.normalizeOrderNo(dto.orderNo) : await this.generateOrderNo(orderDate);
    await this.ensureOrderNoAvailable(orderNo);
    const normalizedLineSteps = await Promise.all(lines.map((line) => this.normalizeProcessSteps(line.processSteps, false)));

    try {
      const created = await runSerializableTransaction(this.prisma, async (tx) => {
        // 草稿保存也会形成库存预占，库存来源必须在同一个 Serializable 事务内按最新库存复核。
        await this.validateOrderStockSourceSelections(lines, undefined, tx);
        await this.reserveOrderNo(tx, orderNo, undefined, 'ORDER_CREATED');
        await this.upsertMaterials(tx, lines);
        const createdOrder = await tx.customerOrder.create({
          data: {
            orderNo,
            customerId: customer.id,
            customerCode: customer.customerCode,
            customerName: customer.customerName,
            customerSnapshot: {
              customerCode: customer.customerCode,
              customerName: customer.customerName,
              contactName: customer.contactName,
              contactPhone: customer.contactPhone
            },
            orderDate,
            deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
            remark: dto.remark,
            status: OrderStatus.DRAFT,
            lines: {
              create: lines.map((line, index) => ({
                lineNo: index + 1,
                partCode: line.partCode.trim(),
                partName: line.partName.trim(),
                drawingNo: line.drawingNo?.trim(),
                drawingVersion: line.drawingVersion?.trim(),
                drawingFileName: line.drawingFileName?.trim(),
                drawingFileUrl: line.drawingFileUrl?.trim(),
                partThickness: line.partThickness,
                partSpecification: line.partSpecification?.trim(),
                quantity: line.quantity,
                ...this.orderLinePlanData(preparedLinePlans[index]),
                fulfillmentMode: this.normalizeFulfillmentMode(line.fulfillmentMode),
                unit: line.unit.trim(),
                deliveryDate: line.deliveryDate ? new Date(line.deliveryDate) : dto.deliveryDate ? new Date(dto.deliveryDate) : null,
                remark: line.remark,
                processSnapshot: this.processStepsToJson(normalizedLineSteps[index]),
                stockSourceSelections: this.stockSourceSelectionsToJson(line.selectedStockSources),
                ...this.orderLineImportData(line),
                processSteps: {
                  create: normalizedLineSteps[index].map((processStep, stepIndex) => ({
                    stepNo: stepIndex + 1,
                    processName: processStep.processName,
                    processRemark: processStep.processRemark
                  }))
                }
              }))
            }
          },
          include: {
            customer: true,
            inventoryBatches: true,
            lines: {
              include: {
                processSteps: { orderBy: { stepNo: 'asc' } },
                inventoryBatches: {
                  include: { warehouse: true, location: true },
                  orderBy: { createdAt: 'asc' }
                },
                productionTasks: {
                  include: {
                    inventoryBatch: {
                      include: { warehouse: true, location: true }
                    }
                  },
                  orderBy: { productionTaskNo: 'asc' }
                }
              },
              orderBy: { lineNo: 'asc' }
            }
          }
        });
        await this.linkOrderNoReservation(tx, orderNo, createdOrder.id, 'ORDER_CREATED');
        await this.syncOrderInventoryReservations(tx, createdOrder.id);
        return createdOrder;
      }, '库存正在被其他订单占用，请刷新库存后重新保存订单');

      return this.findOne(created.orderNo);
    } catch (error) {
      if (this.isDuplicateOrderNoError(error)) {
        throw new BadRequestException(`订单号 ${orderNo} 已存在，请修改后再保存`);
      }
      throw error;
    }
  }

  async update(orderNo: string, dto: UpdateOrderDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
      include: { lines: true }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('只有待提交生产订单可以编辑');
    }

    const lines = this.normalizeEditableOrderLineComponentFields(await this.normalizeOrderLineImportReferences(dto.lines));
    this.validateOrderLines(lines, { requireStockSources: false });
    const preparedLinePlans = await this.prepareOrderLinePlans(lines);
    const nextOrderNo = dto.orderNo?.trim() ? this.normalizeOrderNo(dto.orderNo) : order.orderNo;
    if (nextOrderNo !== order.orderNo) {
      await this.ensureOrderNoAvailable(nextOrderNo, order.orderNo);
    }
    const normalizedLineSteps = await Promise.all(lines.map((line) => this.normalizeProcessSteps(line.processSteps, false)));

    // DRAFT 订单还没有进入生产，允许修改订单号和整体替换订单零件，保持订单总表和明细表边界清晰。
    try {
      const updated = await runSerializableTransaction(this.prisma, async (tx) => {
        // 编辑草稿时先在事务内复核库存来源，再替换订单零件和同步 ACTIVE 预占。
        await this.validateOrderStockSourceSelections(lines, order, tx);
        if (nextOrderNo !== order.orderNo) {
          await this.reserveOrderNo(tx, nextOrderNo, order.id, 'DRAFT_ORDER_RENUMBERED');
          await tx.orderNoReservation.deleteMany({
            where: {
              orderNoNormalized: this.normalizeOrderNo(order.orderNo),
              sourceOrderId: order.id
            }
          });
        } else {
          await this.linkOrderNoReservation(tx, nextOrderNo, order.id, 'ORDER_CREATED');
        }
        const reservationCarryovers = await this.findOrderReservationCarryovers(tx, order.id);
        await this.upsertMaterials(tx, lines);
        await tx.orderLine.deleteMany({ where: { orderId: order.id } });
        const updatedOrder = await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            orderNo: nextOrderNo,
            deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
            remark: dto.remark,
            lines: {
              create: lines.map((line, index) => ({
                lineNo: index + 1,
                partCode: line.partCode.trim(),
                partName: line.partName.trim(),
                drawingNo: line.drawingNo?.trim(),
                drawingVersion: line.drawingVersion?.trim(),
                drawingFileName: line.drawingFileName?.trim(),
                drawingFileUrl: line.drawingFileUrl?.trim(),
                partThickness: line.partThickness,
                partSpecification: line.partSpecification?.trim(),
                quantity: line.quantity,
                ...this.orderLinePlanData(preparedLinePlans[index]),
                fulfillmentMode: this.normalizeFulfillmentMode(line.fulfillmentMode),
                unit: line.unit.trim(),
                deliveryDate: line.deliveryDate ? new Date(line.deliveryDate) : dto.deliveryDate ? new Date(dto.deliveryDate) : null,
                remark: line.remark,
                processSnapshot: this.processStepsToJson(normalizedLineSteps[index]),
                stockSourceSelections: this.stockSourceSelectionsToJson(line.selectedStockSources),
                ...this.orderLineImportData(line),
                processSteps: {
                  create: normalizedLineSteps[index].map((processStep, stepIndex) => ({
                    stepNo: stepIndex + 1,
                    processName: processStep.processName,
                    processRemark: processStep.processRemark
                  }))
                }
              }))
            }
          },
          include: {
            customer: true,
            inventoryBatches: true,
            lines: {
              include: {
                processSteps: { orderBy: { stepNo: 'asc' } },
                inventoryBatches: {
                  include: { warehouse: true, location: true },
                  orderBy: { createdAt: 'asc' }
                },
                productionTasks: {
                  include: {
                    inventoryBatch: {
                      include: { warehouse: true, location: true }
                    }
                  },
                  orderBy: { productionTaskNo: 'asc' }
                }
              },
              orderBy: { lineNo: 'asc' }
            }
          }
        });
        await this.syncOrderInventoryReservations(tx, updatedOrder.id, reservationCarryovers);
        return updatedOrder;
      }, '库存正在被其他订单占用，请刷新库存后重新保存订单');

      return this.findOne(updated.orderNo);
    } catch (error) {
      if (this.isDuplicateOrderNoError(error)) {
        throw new BadRequestException(`订单号 ${nextOrderNo} 已存在，请修改后再保存`);
      }
      throw error;
    }
  }

  async deleteDraft(orderNo: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
      include: {
        productionTasks: { select: { id: true } },
        inventoryBatches: { select: { id: true } },
        lines: {
          select: {
            id: true,
            inventoryTransactions: { select: { id: true } },
            productionTasks: { select: { id: true } },
            inventoryBatches: { select: { id: true } }
          }
        }
      }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('只有待提交生产草稿订单可以删除');
    }
    const hasProductionOrInventory =
      order.productionTasks.length > 0 ||
      order.inventoryBatches.length > 0 ||
      order.lines.some(
        (line) => line.productionTasks.length > 0 || line.inventoryBatches.length > 0 || line.inventoryTransactions.length > 0
      );
    if (hasProductionOrInventory) {
      throw new BadRequestException('该草稿订单已经存在生产或库存记录，不能删除，只能走取消订单流程');
    }

    await runSerializableTransaction(this.prisma, async (tx) => {
      // 删除导入错误的草稿订单时必须同步释放订单号占用，允许修正 Excel 后重新导入同一订单号。
      await tx.orderNoReservation.deleteMany({
        where: {
          orderNoNormalized: normalizedOrderNo,
          sourceOrderId: order.id
        }
      });
      await tx.customerOrder.delete({ where: { id: order.id } });
    }, '草稿订单正在被其他操作使用，请刷新后重试');

    return {
      orderNo: normalizedOrderNo,
      deleted: true
    };
  }

  async updateLineProcess(orderNo: string, lineId: string, dto: UpdateLineProcessDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const order = await this.prisma.customerOrder.findFirst({
      where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('只有待提交生产订单可以修改生产流程');
    }

    const line = await this.prisma.orderLine.findFirst({ where: { id: lineId, orderId: order.id } });
    if (!line) {
      throw new NotFoundException('订单零件不存在');
    }
    if (
      line.fulfillmentMode === OrderLineFulfillmentMode.STOCK &&
      decimalToNumber(line.productionPlanQuantity) <= 0
    ) {
      throw new BadRequestException('该零件已全量使用库存，不需要设置生产流程');
    }
    const steps = await this.normalizeProcessSteps(dto.steps, true);
    const processEditor = await this.resolveProcessEditorOperator(dto.configuredByCode);

    // 保存某个订单零件的独立生产流程，并同步未完成的生产任务快照。
    await this.prisma.$transaction(async (tx) => {
      await tx.orderLineProcessStep.deleteMany({ where: { orderLineId: lineId } });
      if (steps.length > 0) {
        await tx.orderLineProcessStep.createMany({
          data: steps.map((processStep, index) => ({
            orderLineId: lineId,
            stepNo: index + 1,
            processName: processStep.processName,
            processRemark: processStep.processRemark
          }))
        });
      }
      await tx.orderLine.update({
        where: { id: lineId },
        data: { processSnapshot: this.processStepsToJson(steps) }
      });
      await tx.customerOrder.update({
        where: { id: order.id },
        data: {
          remark: this.appendOrderRemark(
            order.remark,
            `生产流程填写：${processEditor.name}（${processEditor.accountId} / ${processEditor.role}），零件 ${line.partCode}`
          )
        }
      });
      await tx.productionTask.updateMany({
        where: { orderLineId: lineId, status: { not: 'COMPLETED' } },
        data: { processSnapshot: this.processStepsToJson(steps) }
      });
    });

    return this.findOne(order.orderNo);
  }

  async createLineReplenishment(orderNo: string, lineId: string, dto: CreateLineReplenishmentDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const { order, line, baseTask } = await this.findStartedOrderLineTask(tx, normalizedOrderNo, lineId);
        this.assertOrderAcceptsProductionChange(order);
        const quantity = this.normalizeQuantity(dto.quantity, '补单数量');
        const reason = dto.reason.trim();
        if (!reason) {
          throw new BadRequestException('补单原因不能为空');
        }

        const taskNo = await this.createReplenishmentTaskForLine(tx, order, line, baseTask, quantity, reason);
        const progressText = await this.describeOrderProductionProgress(tx, order.id);
        await this.createProductionNotice(tx, {
          noticeType: 'QUANTITY_INCREASE',
          target: ProductionNoticeTarget.PRODUCTION,
          order,
          line,
          productionTaskNo: taskNo,
          beforeQuantity: decimalToNumber(line.quantity),
          afterQuantity: this.roundQuantity(decimalToNumber(line.quantity) + quantity),
          deltaQuantity: quantity,
          reason: `补单：${reason}。${progressText}`,
          managerName: dto.managerName?.trim()
        });
        await this.markLineShortagesResolved(
          tx,
          line.id,
          quantity,
          'ORDER_REPLENISHMENT',
          dto.managerName?.trim() || '订单补单',
          `已创建订单补单 ${taskNo}：${reason}`
        );
      },
      '当前订单生产任务正在被其他操作修改，请刷新后重新创建补单'
    );

    return this.findOne(normalizedOrderNo);
  }

  async resolveLineShortage(orderNo: string, lineId: string, dto: ResolveLineShortageDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const { order, line } = await this.findStartedOrderLineTask(tx, normalizedOrderNo, lineId);
        this.assertOrderAcceptsProductionChange(order);
        const managerName = dto.managerName.trim();
        const reason = dto.reason.trim();
        if (!managerName) {
          throw new BadRequestException('处理人员不能为空');
        }
        if (!reason) {
          throw new BadRequestException('无需补单说明不能为空');
        }
        const resolvedCount = await this.markLineShortagesResolved(
          tx,
          line.id,
          undefined,
          dto.resolutionMode,
          managerName,
          reason
        );
        if (resolvedCount === 0) {
          throw new BadRequestException('当前零件没有待处理的管理确认短缺');
        }
        await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            remark: this.appendOrderRemark(
              order.remark,
              `短缺无需补单确认：${managerName}，零件 ${line.partCode} / ${line.partName}，说明：${reason}`
            )
          }
        });
      },
      '当前订单短缺处理正在被其他操作修改，请刷新后重试'
    );

    return this.findOne(normalizedOrderNo);
  }

  async cancelReplenishment(orderNo: string, productionTaskNo: string, dto: CancelReplenishmentDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const normalizedTaskNo = productionTaskNo.trim().toUpperCase();
    if (!normalizedTaskNo) {
      throw new BadRequestException('生产任务号不能为空');
    }

    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
      const task = await tx.productionTask.findFirst({
        where: {
          productionTaskNo: { equals: normalizedTaskNo, mode: 'insensitive' },
          orderNo: { equals: normalizedOrderNo, mode: 'insensitive' }
        },
        include: {
          order: true,
          orderLine: {
            include: {
              productionTasks: { include: { processCompletions: true } },
              inventoryBatches: true
            }
          },
          processCompletions: true,
          inventoryBatch: true
        }
      });
      if (!task) {
        throw new NotFoundException('补单任务不存在');
      }
      if (!task.isReplenishment) {
        throw new BadRequestException('这里只能取消补单任务');
      }
      if (task.order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('订单已经取消');
      }
      if (task.order.status === OrderStatus.COMPLETED) {
        throw new BadRequestException('已完成订单不能取消补单');
      }
      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('取消原因不能为空');
      }
      const managerName = dto.managerName?.trim();
      if (!managerName) {
        throw new BadRequestException('管理人员姓名不能为空');
      }
      if (task.inventoryBatch) {
        throw new BadRequestException('补单任务已入库，不能取消');
      }
      if (this.isStartedProductionTask(task)) {
        throw new BadRequestException('已开始生产的补单不能直接取消，请走生产撤回流程');
      }

      const onlyThisTaskOnLine = task.orderLine.productionTasks.length === 1;
      const hasLineInventory = task.orderLine.inventoryBatches.length > 0;

      // 未开始的补单可以取消；已经发到生产端的待确认通知必须同步清理，避免现场继续按旧补单开工。
      await tx.productionNotice.deleteMany({
        where: {
          status: ProductionNoticeStatus.PENDING,
          orderNo: { equals: normalizedOrderNo, mode: 'insensitive' },
          productionTaskNo: { equals: task.productionTaskNo, mode: 'insensitive' }
        }
      });
      await tx.productionTask.delete({ where: { id: task.id } });

      if (onlyThisTaskOnLine && !hasLineInventory && task.sourceProductionTaskNo === null) {
        await tx.orderLine.delete({ where: { id: task.orderLineId } });
      }

      await tx.customerOrder.update({
        where: { id: task.orderId },
        data: {
          remark: this.appendRemark(
            task.order.remark,
            `取消补单 ${task.productionTaskNo}：${reason}（管理人员：${managerName}）`
          )
        }
      });
      },
      '当前补单任务正在被其他操作修改，请刷新后重新取消补单'
    );

    return this.findOne(normalizedOrderNo);
  }

  async createAdditionalMaterial(orderNo: string, dto: CreateAdditionalMaterialDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    dto = this.normalizeEditableOrderLineComponentFields(await this.normalizeOrderLineImportReferences([dto]))[0];
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
      const order = await tx.customerOrder.findFirst({
        where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
        include: {
          lines: { orderBy: { lineNo: 'asc' } },
          productionTasks: {
            include: { processCompletions: true },
            orderBy: { productionTaskNo: 'asc' }
          }
        }
      });
      if (!order) {
        throw new NotFoundException('订单不存在');
      }
      if (order.status === OrderStatus.DRAFT) {
        throw new BadRequestException('待提交生产订单请直接编辑订单，不要创建补单物料');
      }
      this.assertOrderAcceptsProductionChange(order);
      const startedTask = order.productionTasks.find((task) => this.isStartedProductionTask(task));
      if (!startedTask) {
        throw new BadRequestException('订单尚未开始生产，不能新增补单物料，请直接修改订单');
      }

      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('新增补单物料原因不能为空');
      }
      const fulfillmentMode = this.normalizeFulfillmentMode(dto.fulfillmentMode);
      if (fulfillmentMode !== OrderLineFulfillmentMode.PRODUCTION) {
        throw new BadRequestException('新增补单物料必须使用重新生产方式');
      }
      const steps = await this.normalizeProcessSteps(dto.processSteps, true);
      this.validateSingleOrderLine(dto);
      this.validateAdditionalMaterialComponentStructure(order.lines, dto);
      const linePlan = await this.prepareOrderLinePlan(dto, '新增补单物料');
      if (linePlan.productionPlanQuantity <= 0) {
        throw new BadRequestException('新增补单物料生产计划数量必须大于 0');
      }
      await this.upsertMaterials(tx, [dto]);

      const lineNo = Math.max(0, ...order.lines.map((line) => line.lineNo)) + 1;
      const productionTaskNo = `PT-${order.orderNo}-${String(lineNo).padStart(3, '0')}`;
      const line = await tx.orderLine.create({
        data: {
          orderId: order.id,
          lineNo,
          partCode: dto.partCode.trim(),
          partName: dto.partName.trim(),
          drawingNo: dto.drawingNo?.trim(),
          drawingVersion: dto.drawingVersion?.trim(),
          drawingFileName: dto.drawingFileName?.trim(),
          drawingFileUrl: dto.drawingFileUrl?.trim(),
          partThickness: dto.partThickness,
          partSpecification: dto.partSpecification?.trim(),
          quantity: dto.quantity,
          ...this.orderLinePlanData(linePlan),
          fulfillmentMode,
          unit: dto.unit.trim(),
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : order.deliveryDate,
          remark: dto.remark,
          ...this.orderLineImportData(dto),
          processSnapshot: this.processStepsToJson(steps),
          processSteps: {
            create: steps.map((processStep, stepIndex) => ({
              stepNo: stepIndex + 1,
              processName: processStep.processName,
              processRemark: processStep.processRemark
            }))
          }
        },
        include: { processSteps: { orderBy: { stepNo: 'asc' } } }
      });

      await tx.productionTask.create({
        data: {
          productionTaskNo,
          orderId: order.id,
          orderLineId: line.id,
          orderNo: order.orderNo,
          customerName: order.customerName,
          partCode: line.partCode,
          partName: line.partName,
          plannedQuantity: line.productionPlanQuantity,
          unit: line.unit,
          processSnapshot: this.processStepsToJson(steps),
          status: ProductionStatus.PENDING,
          isReplenishment: true,
          replenishmentSourceType: 'ORDER_CHANGE',
          replenishmentSourceRequestNo: order.orderNo,
          remark: `客户新增物料：${reason}`
        }
      });

      const progressText = await this.describeOrderProductionProgress(tx, order.id);
      await this.createProductionNotice(tx, {
        noticeType: 'MATERIAL_ADDED',
        target: ProductionNoticeTarget.PRODUCTION,
        order,
        line,
        productionTaskNo,
        beforeQuantity: 0,
        afterQuantity: decimalToNumber(line.quantity),
        deltaQuantity: decimalToNumber(line.quantity),
        reason: `客户新增物料：${reason}。${progressText}`,
        managerName: dto.managerName?.trim()
      });
      },
      '当前订单生产任务正在被其他操作修改，请刷新后重新新增补单物料'
    );

    return this.findOne(normalizedOrderNo);
  }

  private validateAdditionalMaterialComponentStructure(
    existingLines: Array<{ lineType?: string | null; componentNo?: string | null }>,
    line: CreateAdditionalMaterialDto
  ) {
    const lineType = line.lineType || 'PART';
    const componentNo = this.normalizeEditableComponentNo(line.componentNo);
    const parentComponentNo = this.normalizeEditableComponentNo(line.parentComponentNo);
    const existingComponentNos = new Set(
      existingLines
        .filter((item) => (item.lineType || 'PART') === 'COMPONENT')
        .map((item) => this.normalizeEditableComponentNo(item.componentNo))
        .filter(Boolean)
    );

    if (lineType === 'COMPONENT') {
      if (!componentNo) {
        throw new BadRequestException('新增补单物料是组件行时，必须填写组件编号');
      }
      if (parentComponentNo) {
        throw new BadRequestException('新增补单物料是组件行时，不能填写所属组件');
      }
      if (existingComponentNos.has(componentNo)) {
        throw new BadRequestException(`新增补单物料组件编号 ${componentNo} 已在当前订单中存在`);
      }
      return;
    }

    if (componentNo) {
      throw new BadRequestException('新增补单物料是零件行时，不能填写组件编号；如属于组件，请填写所属组件');
    }
    if (parentComponentNo && !existingComponentNos.has(parentComponentNo)) {
      throw new BadRequestException(`新增补单物料所属组件 ${parentComponentNo} 在当前订单内不存在`);
    }
  }

  async updateLineQuantityAfterProductionStarted(orderNo: string, lineId: string, dto: UpdateLineQuantityDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
      const { order, line, baseTask } = await this.findStartedOrderLineTask(tx, normalizedOrderNo, lineId);
      this.assertOrderAcceptsProductionChange(order);
      const oldQuantity = decimalToNumber(line.quantity);
      const nextQuantity = this.normalizeQuantity(dto.quantity, '客户订单数量', true);
      const reason = dto.reason.trim();
      if (!reason) {
        throw new BadRequestException('生产数量变更原因不能为空');
      }
      if (oldQuantity === nextQuantity) {
        throw new BadRequestException('数量没有变化');
      }

      const deltaQuantity = this.roundQuantity(nextQuantity - oldQuantity);
      const currentPlanQuantity = decimalToNumber(line.productionPlanQuantity);
      const nextPlanQuantity =
        dto.productionPlanQuantity !== undefined
          ? this.normalizeQuantity(dto.productionPlanQuantity, '生产计划数量', true)
          : deltaQuantity > 0
            ? this.roundQuantity(currentPlanQuantity + deltaQuantity)
            : Math.max(currentPlanQuantity, nextQuantity);
      const suggestedPlanQuantity = this.resolveSuggestedProductionPlanQuantity({
        fulfillmentMode: line.fulfillmentMode,
        quantity: nextQuantity,
        stockSourceSelections: line.stockSourceSelections
      });
      const planDiffersFromSuggestion = Math.abs(nextPlanQuantity - suggestedPlanQuantity) > 0.0001;
      const planOverrideReason = dto.productionPlanOverrideReason?.trim() || reason;
      const planOverrideOperator = planDiffersFromSuggestion
        ? await this.resolveSubmitPlanOperator(dto.productionPlanOverrideByCode || '', '生产计划调整操作员')
        : undefined;

      await tx.orderLine.update({
        where: { id: line.id },
        data: {
          quantity: nextQuantity,
          productionPlanQuantity: nextPlanQuantity,
          productionPlanSuggestedQuantity: suggestedPlanQuantity,
          productionPlanOverrideByCode: planOverrideOperator?.accountId ?? null,
          productionPlanOverrideByName: planOverrideOperator?.name ?? null,
          productionPlanOverrideByRole: planOverrideOperator?.role ?? null,
          productionPlanOverrideAt: planDiffersFromSuggestion ? new Date() : null,
          productionPlanOverrideReason: planDiffersFromSuggestion ? planOverrideReason : null
        }
      });

      let replenishmentTaskNo: string | undefined;
      if (deltaQuantity > 0) {
        replenishmentTaskNo = await this.createReplenishmentTaskForLine(
          tx,
          order,
          line,
          baseTask,
          deltaQuantity,
          `客户数量增加：${reason}`
        );
      }

      const progressText = await this.describeOrderProductionProgress(tx, order.id);
      const noticeType =
        nextQuantity === 0 ? 'ORDER_CANCELLED' : deltaQuantity > 0 ? 'QUANTITY_INCREASE' : 'QUANTITY_DECREASE';
      const noticeReason =
        deltaQuantity > 0
          ? `客户要求增加 ${Math.abs(deltaQuantity)} ${line.unit}：${reason}。${progressText}`
          : nextQuantity === 0
            ? `客户取消该物料：${reason}。${progressText}。请管理人员确认已生产物料转库存或销毁处理，并同步仓库。`
            : `客户要求减少 ${Math.abs(deltaQuantity)} ${line.unit}：${reason}。${progressText}。请管理人员确认已生产多余物料转库存或销毁处理，并同步仓库。`;
      const planOverrideText = planDiffersFromSuggestion
        ? ` 生产计划调整：建议 ${suggestedPlanQuantity} ${line.unit}，实际计划 ${nextPlanQuantity} ${line.unit}，操作人员 ${planOverrideOperator?.name}（${planOverrideOperator?.accountId} / ${planOverrideOperator?.role}），说明：${planOverrideReason}。`
        : '';

      await this.createProductionNotice(tx, {
        noticeType,
        target: ProductionNoticeTarget.PRODUCTION,
        order,
        line,
        productionTaskNo: replenishmentTaskNo || baseTask.productionTaskNo,
        beforeQuantity: oldQuantity,
        afterQuantity: nextQuantity,
        deltaQuantity,
        reason: `${noticeReason}${planOverrideText}`,
        managerName: dto.managerName?.trim()
      });

      if (noticeType === 'QUANTITY_DECREASE' || noticeType === 'ORDER_CANCELLED') {
        await this.createProductionNotice(tx, {
          noticeType,
          target: ProductionNoticeTarget.WAREHOUSE,
          order,
          line,
          productionTaskNo: baseTask.productionTaskNo,
          beforeQuantity: oldQuantity,
          afterQuantity: nextQuantity,
          deltaQuantity,
          reason: `${noticeReason}${planOverrideText} 仓库需等待管理处理结果；后续如转库存必须按库存批次入库，如销毁不得进入可用库存。`,
          managerName: dto.managerName?.trim()
        });
      }
      if (deltaQuantity < 0) {
        await this.markLineShortagesResolved(
          tx,
          line.id,
          Math.abs(deltaQuantity),
          'CUSTOMER_QUANTITY_CHANGED',
          dto.managerName?.trim() || '客户数量变更',
          `客户数量由 ${oldQuantity} ${line.unit} 调整为 ${nextQuantity} ${line.unit}：${reason}`
        );
      }
      },
      '当前订单生产任务正在被其他操作修改，请刷新后重新变更数量'
    );

    return this.findOne(normalizedOrderNo);
  }

  async cancelOrder(orderNo: string, dto: CancelOrderDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const order = await tx.customerOrder.findFirst({
          where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
          include: {
            lines: {
              include: {
                inventoryBatches: true,
                processSteps: { orderBy: { stepNo: 'asc' } },
                productionTasks: {
                  include: { processCompletions: true, inventoryBatch: true },
                  orderBy: { productionTaskNo: 'asc' }
                }
              },
              orderBy: { lineNo: 'asc' }
            },
            productionTasks: {
              include: { processCompletions: true, inventoryBatch: true },
              orderBy: { productionTaskNo: 'asc' }
            },
            inventoryBatches: true
          }
        });
        if (!order) {
          throw new NotFoundException('订单不存在');
        }
        if (order.status === OrderStatus.CANCELLED) {
          throw new BadRequestException('订单已经取消');
        }
        if (order.status === OrderStatus.COMPLETED) {
          throw new BadRequestException('已完成订单不能在第一阶段取消');
        }

        const reason = dto.reason.trim();
        if (!reason) {
          throw new BadRequestException('取消原因不能为空');
        }
        const managerName = dto.managerName?.trim();
        if (!managerName) {
          throw new BadRequestException('管理人员姓名不能为空');
        }

        const startedTasks = order.productionTasks.filter((task) => this.isStartedProductionTask(task));
        const productionCancelState =
          dto.productionCancelState || (startedTasks.length > 0 ? 'PRODUCED' : 'NOT_PRODUCED');
        if (productionCancelState === 'NOT_PRODUCED' && startedTasks.length > 0) {
          throw new BadRequestException('订单已经有生产进度，请选择已生产取消');
        }
        if (productionCancelState === 'PRODUCED' && startedTasks.length === 0) {
          throw new BadRequestException('订单没有生产进度，请选择未生产取消');
        }
        const cancelHandlingPlanMap = this.normalizeCancelHandlingPlan(
          dto.handlingPlan,
          startedTasks,
          productionCancelState
        );
        const cancelHandledAt = new Date();
        const orderLineIds = order.lines.map((line) => line.id);
        const shippedTransaction = await tx.inventoryTransaction.findFirst({
          where: {
            transactionType: InventoryTransactionType.OUT,
            sourceRecordType: 'InventoryBatch',
            OR: [
              { batch: { sourceOrderId: order.id } },
              { orderNo: order.orderNo, orderLineId: { in: orderLineIds } }
            ]
          },
          select: { id: true }
        });
        if (shippedTransaction) {
          throw new BadRequestException('订单已有发货库存，不能直接取消');
        }

        const progressText = await this.describeOrderProductionProgress(tx, order.id);
        const noticeReason =
          startedTasks.length > 0
            ? `客户取消整张订单：${reason}。${progressText}。请管理人员确认已生产物料转库存或销毁处理，并同步仓库。`
            : `客户取消整张订单：${reason}。订单尚未开始生产，系统取消未开始任务并释放未发货库存。`;

        // 整单取消会释放订单库存和退回备货库存，必须放在 Serializable 事务内，避免和发货/提交订单并发造成库存账不一致。
        await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
            remark: this.appendRemark(order.remark, `客户取消整单：${reason}（管理人员：${managerName}）`)
          }
        });
        await this.releaseOrderInventoryReservations(tx, order.id, 'ORDER_CANCELLED');

        for (const line of order.lines) {
          const oldQuantity = decimalToNumber(line.quantity);
          const lineStartedTasks = line.productionTasks.filter((task) => this.isStartedProductionTask(task));
          if (lineStartedTasks.length === 0) {
            await this.releaseUnstartedLineStock(tx, order, line, reason);
          }

          if (oldQuantity > 0) {
            await tx.orderLine.update({
              where: { id: line.id },
              data: { quantity: 0 }
            });
          }

          const pendingTaskIds = line.productionTasks
            .filter((task) => !this.isStartedProductionTask(task))
            .map((task) => task.id);
          if (pendingTaskIds.length > 0) {
            await tx.productionNotice.deleteMany({
              where: {
                status: ProductionNoticeStatus.PENDING,
                productionTaskId: { in: pendingTaskIds }
              }
            });
            await tx.productionTask.deleteMany({ where: { id: { in: pendingTaskIds } } });
          }

          for (const task of lineStartedTasks) {
            const taskPlan = cancelHandlingPlanMap.get(task.productionTaskNo.toUpperCase());
            const plannedNoticeReason = taskPlan
              ? `${noticeReason} 取消处理计划：${this.formatCancelHandlingPlan(taskPlan, line.unit)}。`
              : noticeReason;
            const handlingPlanJson = taskPlan
              ? this.cancelHandlingPlanToJson(taskPlan, managerName, cancelHandledAt)
              : undefined;
            await this.createProductionNotice(tx, {
              noticeType: 'ORDER_CANCELLED',
              target: ProductionNoticeTarget.PRODUCTION,
              order,
              line,
              productionTaskId: task.id,
              productionTaskNo: task.productionTaskNo,
              beforeQuantity: oldQuantity,
              afterQuantity: 0,
              deltaQuantity: -oldQuantity,
              reason: plannedNoticeReason,
              managerName,
              handlingPlan: handlingPlanJson
            });
            await this.createProductionNotice(tx, {
              noticeType: 'ORDER_CANCELLED',
              target: ProductionNoticeTarget.WAREHOUSE,
              order,
              line,
              productionTaskId: task.id,
              productionTaskNo: task.productionTaskNo,
              beforeQuantity: oldQuantity,
              afterQuantity: 0,
              deltaQuantity: -oldQuantity,
              reason: `${plannedNoticeReason} 仓库需等待转库存或销毁结果；未确认前不得进入可用库存。`,
              managerName,
              handlingPlan: handlingPlanJson
            });
          }
        }
      },
      '当前订单或库存正在被其他操作修改，请刷新后重新取消订单'
    );

    return this.findOne(normalizedOrderNo);
  }

  async cancelAfterProductionStarted(orderNo: string, dto: CancelStartedOrderDto) {
    return this.cancelOrder(orderNo, dto);
  }

  async submit(orderNo: string, dto: SubmitOrderDto) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);

    // 提交订单时按零件来源处理：重新生产生成 ProductionTask，使用库存则把备货库存转为订单库存。
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const order = await tx.customerOrder.findFirst({
          where: { orderNo: { equals: normalizedOrderNo, mode: 'insensitive' } },
          include: {
            lines: {
              include: { processSteps: { orderBy: { stepNo: 'asc' } } },
              orderBy: { lineNo: 'asc' }
            }
          }
        });

        if (!order) {
          throw new NotFoundException('订单不存在');
        }
        if (order.lines.length === 0) {
          throw new BadRequestException('订单至少需要一个零件');
        }
        if (order.status !== OrderStatus.DRAFT) {
          throw new BadRequestException('只有待提交生产订单可以提交生产');
        }
        const submitOperator = await this.resolveSubmitPlanOperatorFromClient(tx, dto.submittedByCode, '下单/计划操作员');
        const submitValidationLines = order.lines.map((line) => this.persistedOrderLineToValidationDto(line));
        this.validateOrderLineComponentStructure(submitValidationLines);
        submitValidationLines.forEach((line, index) => {
          this.validateSingleOrderLine(line, `第 ${index + 1} 个零件`, true);
        });
        const materialIdentityInfoByPartCode = await this.getOrderLineMaterialIdentityInfoByPartCode(
          order.lines.map((line) => line.partCode),
          tx
        );
        this.assertSubmitMaterialIdentityConfirmed(order.lines, materialIdentityInfoByPartCode, dto.materialIdentityConfirmed);
        const materialIdentityConfirmationRemark = this.submitMaterialIdentityConfirmationRemark(
          order.lines,
          materialIdentityInfoByPartCode,
          submitOperator,
          dto.materialIdentityConfirmed
        );
        await this.syncOrderInventoryReservations(tx, order.id);
        const missingStockSourceLine = order.lines.find(
          (line) =>
            (this.normalizeFulfillmentMode(line.fulfillmentMode) === OrderLineFulfillmentMode.STOCK ||
              this.normalizeFulfillmentMode(line.fulfillmentMode) === OrderLineFulfillmentMode.REWORK) &&
            this.selectedStockSourceQuantity(line) <= 0
        );
        if (missingStockSourceLine) {
          const sourceModeText =
            this.normalizeFulfillmentMode(missingStockSourceLine.fulfillmentMode) === OrderLineFulfillmentMode.REWORK ? '库存再加工' : '使用库存';
          throw new BadRequestException(
            `零件 ${missingStockSourceLine.partCode} ${sourceModeText}时必须先选择库存批次并完成来源核对；如不使用库存请改为重新生产`
          );
        }
        const effectivePlanQuantityByLineId = new Map(
          order.lines.map((line) => [line.id, this.resolveSubmittedProductionPlanQuantity(line)])
        );
        const missingPlanOverrideLine = order.lines.find((line) => {
          const effectivePlanQuantity = effectivePlanQuantityByLineId.get(line.id) || 0;
          const suggestedQuantity = this.resolveSuggestedProductionPlanQuantity(line);
          return (
            Math.abs(effectivePlanQuantity - suggestedQuantity) > 0.0001 &&
            !this.hasProductionPlanOverrideRecord(line)
          );
        });
        if (missingPlanOverrideLine) {
          throw new BadRequestException(
            `零件 ${missingPlanOverrideLine.partCode} 生产计划数量与建议数量不一致，必须记录操作人员和调整说明`
          );
        }
        await this.assertSubmittedProductionPlanOverrides(tx, order.lines, effectivePlanQuantityByLineId);
        const insufficientReworkSourceLine = order.lines.find(
          (line) =>
            this.normalizeFulfillmentMode(line.fulfillmentMode) === OrderLineFulfillmentMode.REWORK &&
            this.selectedStockSourceQuantity(line) + 0.0001 < (effectivePlanQuantityByLineId.get(line.id) || 0)
        );
        if (insufficientReworkSourceLine) {
          throw new BadRequestException(
            `零件 ${insufficientReworkSourceLine.partCode} 库存再加工已选库存少于生产计划数量：需要 ${
              effectivePlanQuantityByLineId.get(insufficientReworkSourceLine.id) || 0
            }，已选 ${this.selectedStockSourceQuantity(insufficientReworkSourceLine)}`
          );
        }
        const missingProcessLine = order.lines.find(
          (line) => (effectivePlanQuantityByLineId.get(line.id) || 0) > 0 && line.processSteps.length === 0
        );
        if (missingProcessLine) {
          throw new BadRequestException(`零件 ${missingProcessLine.partCode} 必须先设置生产流程`);
        }

        // 订单提交会占用备货库存或生成生产任务，所有判断必须在事务内基于最新订单状态执行。
        const submitOrderRemark = this.appendOrderRemark(
          order.remark,
          `提交生产：${submitOperator.name}（${submitOperator.accountId} / ${submitOperator.role}）`
        );
        await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.SUBMITTED,
            remark: materialIdentityConfirmationRemark
              ? this.appendOrderRemark(submitOrderRemark, materialIdentityConfirmationRemark)
              : submitOrderRemark
          }
        });

        for (const line of order.lines) {
          const steps = this.processRowsToSnapshots(line.processSteps);
          const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
          const effectivePlanQuantity = effectivePlanQuantityByLineId.get(line.id) || 0;
          if (Math.abs(decimalToNumber(line.productionPlanQuantity) - effectivePlanQuantity) > 0.0001) {
            await tx.orderLine.update({
              where: { id: line.id },
              data: { productionPlanQuantity: effectivePlanQuantity }
            });
          }

          if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
            await this.allocateStockToOrderLine(tx, order, line);
          }

          if (fulfillmentMode === OrderLineFulfillmentMode.REWORK) {
            await this.consumeAvailableStock(tx, order, line, effectivePlanQuantity, 'REWORK');
          }

          if (effectivePlanQuantity <= 0) {
            continue;
          }

          // 生产任务计划数使用生产计划数量，不再混用客户订单数量；REWORK 会先扣备货库存再进入生产。
          await tx.productionTask.upsert({
            where: { productionTaskNo: `PT-${order.orderNo}-${String(line.lineNo).padStart(3, '0')}` },
            update: {
              processSnapshot: this.processStepsToJson(steps),
              plannedQuantity: effectivePlanQuantity,
              unit: line.unit
            },
            create: {
              productionTaskNo: `PT-${order.orderNo}-${String(line.lineNo).padStart(3, '0')}`,
              orderId: order.id,
              orderLineId: line.id,
              orderNo: order.orderNo,
              customerName: order.customerName,
              partCode: line.partCode,
              partName: line.partName,
              plannedQuantity: effectivePlanQuantity,
              unit: line.unit,
              processSnapshot: this.processStepsToJson(steps),
              status: 'PENDING'
            }
          });
        }
      },
      '库存正在被其他订单占用，请刷新库存后重新提交订单'
    );

    return this.findOne(normalizedOrderNo);
  }

  private async resolveSubmitPlanOperator(submittedByCode: string, label = '下单/计划操作员') {
    return this.resolveSubmitPlanOperatorFromClient(this.prisma, submittedByCode, label);
  }

  private async resolveSubmitPlanOperatorFromClient(
    client: { productionOperator: { findFirst: (args: any) => Promise<any> } },
    submittedByCode: string,
    label = '下单/计划操作员'
  ) {
    const accountId = submittedByCode?.trim();
    if (!accountId) {
      throw new BadRequestException(`请选择${label}`);
    }

    const operator = await client.productionOperator.findFirst({
      where: { accountId: { equals: accountId, mode: 'insensitive' } },
      select: { accountId: true, name: true, role: true, status: true }
    });
    const fallbackOperator = fallbackSubmitPlanOperators.find(
      (item) => item.accountId.toLocaleLowerCase() === accountId.toLocaleLowerCase()
    );
    const submitOperator = operator || fallbackOperator;
    if (!submitOperator) {
      throw new BadRequestException(`${label}不存在，请刷新后重新选择`);
    }
    if ('status' in submitOperator && submitOperator.status !== CommonStatus.ENABLED) {
      throw new BadRequestException(`${label}已停用，不能操作`);
    }
    if (!this.isSubmitPlanOperatorRole(submitOperator.role)) {
      throw new BadRequestException(`${label}必须是下单/计划管理人员，车间人员只能查看生产流程`);
    }
    return {
      accountId: submitOperator.accountId,
      name: submitOperator.name,
      role: submitOperator.role
    };
  }

  private async assertSubmittedProductionPlanOverrides(
    tx: Prisma.TransactionClient,
    lines: Array<{
      id: string;
      partCode: string;
      quantity: Prisma.Decimal | number | string | null;
      fulfillmentMode?: OrderLineFulfillmentMode | string | null;
      productionPlanQuantity: Prisma.Decimal | number | string | null;
      productionPlanOverrideByCode?: string | null;
      productionPlanOverrideByName?: string | null;
      productionPlanOverrideByRole?: string | null;
      productionPlanOverrideAt?: Date | string | null;
      productionPlanOverrideReason?: string | null;
      stockSourceSelections?: Prisma.JsonValue | null;
    }>,
    effectivePlanQuantityByLineId: Map<string, number>
  ) {
    for (const line of lines) {
      const effectivePlanQuantity = effectivePlanQuantityByLineId.get(line.id) || 0;
      const suggestedQuantity = this.resolveSuggestedProductionPlanQuantity(line);
      if (Math.abs(effectivePlanQuantity - suggestedQuantity) <= 0.0001) {
        continue;
      }

      const operator = await this.resolveSubmitPlanOperatorFromClient(
        tx,
        line.productionPlanOverrideByCode || '',
        `零件 ${line.partCode} 生产计划调整操作员`
      );
      const overrideAt = line.productionPlanOverrideAt ? new Date(line.productionPlanOverrideAt) : null;
      if (!overrideAt || Number.isNaN(overrideAt.getTime()) || !line.productionPlanOverrideReason?.trim()) {
        throw new BadRequestException(`零件 ${line.partCode} 生产计划数量与建议数量不一致，必须记录调整时间和说明`);
      }
      if (line.productionPlanOverrideByName !== operator.name || line.productionPlanOverrideByRole !== operator.role) {
        throw new BadRequestException(
          `零件 ${line.partCode} 生产计划调整操作员快照已过期，请重新选择 ${operator.accountId} 并保存订单后再提交生产`
        );
      }
    }
  }

  private isSubmitPlanOperatorRole(role?: string | null) {
    const value = role || '';
    return /计划|下单|订单/.test(value) && !/车间|主任|技术|工艺/.test(value);
  }

  private async resolveProcessEditorOperator(configuredByCode: string) {
    const accountId = configuredByCode?.trim();
    if (!accountId) {
      throw new BadRequestException('请选择生产流程填写人员');
    }

    const operator = await this.prisma.productionOperator.findFirst({
      where: { accountId: { equals: accountId, mode: 'insensitive' } },
      select: { accountId: true, name: true, role: true, status: true }
    });
    const fallbackOperator = fallbackSubmitPlanOperators.find(
      (item) => item.accountId.toLocaleLowerCase() === accountId.toLocaleLowerCase()
    );
    const processEditor = operator || fallbackOperator;
    if (!processEditor) {
      throw new BadRequestException('生产流程填写人员不存在，请刷新后重新选择');
    }
    if ('status' in processEditor && processEditor.status !== CommonStatus.ENABLED) {
      throw new BadRequestException('生产流程填写人员已停用，不能操作');
    }
    if (!this.isProcessEditorRole(processEditor.role)) {
      throw new BadRequestException('生产流程只能由下单/计划管理人员填写，车间人员只能查看生产流程');
    }
    return {
      accountId: processEditor.accountId,
      name: processEditor.name,
      role: processEditor.role
    };
  }

  private isProcessEditorRole(role?: string | null) {
    const value = role || '';
    return /计划|下单|订单/.test(value) && !/车间|主任|技术|工艺|操作员/.test(value);
  }

  private appendOrderRemark(existingRemark: string | null | undefined, line: string) {
    const normalizedRemark = existingRemark?.trim();
    const record = `${new Date().toISOString()} ${line}`;
    return normalizedRemark ? `${normalizedRemark}\n${record}` : record;
  }

  private async findStartedOrderLineTask(tx: Prisma.TransactionClient, orderNo: string, lineId: string) {
    const order = await tx.customerOrder.findFirst({
      where: { orderNo: { equals: orderNo, mode: 'insensitive' } }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    this.assertOrderAcceptsProductionChange(order);

    const line = await tx.orderLine.findFirst({
      where: { id: lineId, orderId: order.id },
      include: {
        processSteps: { orderBy: { stepNo: 'asc' } },
        productionTasks: {
          include: { processCompletions: true },
          orderBy: { productionTaskNo: 'asc' }
        }
      }
    });
    if (!line) {
      throw new NotFoundException('订单零件不存在');
    }

    const baseTask = line.productionTasks.find((task) => !task.isReplenishment && this.isStartedProductionTask(task));
    if (!baseTask) {
      throw new BadRequestException('该订单零件尚未开始生产，请修改订单，不要创建补单');
    }

    return { order, line, baseTask };
  }

  private assertOrderAcceptsProductionChange(order: { status: OrderStatus }) {
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('已取消订单不能创建补单或生产数量变更');
    }
    if (order.status === OrderStatus.COMPLETED) {
      throw new BadRequestException('已完成订单不能创建补单或生产数量变更');
    }
  }

  private isStartedProductionTask(task: { status: ProductionStatus; processCompletions?: unknown[] }) {
    return task.status !== ProductionStatus.PENDING || this.hasEffectiveProcessProgress(task);
  }

  private hasEffectiveProcessProgress(task: { processCompletions?: any[] }) {
    return Boolean(
      task.processCompletions?.some(
        (completion) =>
          completion.isCompleted ||
          Boolean(completion.completedAt) ||
          decimalToNumber(completion.completedQuantity) > 0 ||
          decimalToNumber(completion.scrapQuantity) > 0 ||
          decimalToNumber(completion.shortageQuantity) > 0
      )
    );
  }

  private appendRemark(current: string | null | undefined, next: string) {
    return [current?.trim(), next].filter(Boolean).join('\n');
  }

  private async markLineShortagesResolved(
    tx: Prisma.TransactionClient,
    orderLineId: string,
    coveringQuantity: number | undefined,
    resolutionMode: string,
    resolvedBy: string,
    reason: string
  ) {
    const tasks = await tx.productionTask.findMany({
      where: { orderLineId },
      include: { processCompletions: true }
    });
    const records = this.toUnresolvedShortageRecords(tasks);
    const totalShortage = records.reduce((sum: number, record: any) => sum + Number(record.shortageQuantity || 0), 0);
    if (records.length === 0 || (coveringQuantity !== undefined && coveringQuantity + 0.0001 < totalShortage)) {
      return 0;
    }

    const now = new Date();
    await tx.productionProcessCompletion.updateMany({
      where: { id: { in: records.map((record: any) => record.completionId).filter(Boolean) } },
      data: {
        shortageResolutionMode: resolutionMode,
        shortageResolutionBy: resolvedBy,
        shortageResolutionReason: reason,
        shortageResolvedAt: now
      }
    });
    return records.length;
  }

  private async createReplenishmentTaskForLine(
    tx: Prisma.TransactionClient,
    order: any,
    line: any,
    baseTask: any,
    plannedQuantity: number,
    reason: string
  ) {
    const sourceProductionTaskNo = baseTask.sourceProductionTaskNo || baseTask.productionTaskNo;
    const existingPending = await tx.productionTask.findFirst({
      where: {
        orderLineId: line.id,
        isReplenishment: true,
        sourceProductionTaskNo,
        replenishmentSourceType: 'ORDER_CHANGE',
        status: ProductionStatus.PENDING
      },
      orderBy: { productionTaskNo: 'asc' }
    });
    const steps = this.processRowsToSnapshots(line.processSteps || []);

    if (existingPending) {
      await tx.productionTask.update({
        where: { id: existingPending.id },
        data: {
          plannedQuantity,
          processSnapshot: this.processStepsToJson(steps),
          replenishmentSourceType: 'ORDER_CHANGE',
          replenishmentSourceRequestNo: order.orderNo,
          remark: reason
        }
      });
      return existingPending.productionTaskNo;
    }

    const existingStarted = await tx.productionTask.findFirst({
      where: {
        orderLineId: line.id,
        isReplenishment: true,
        sourceProductionTaskNo,
        replenishmentSourceType: 'ORDER_CHANGE',
        status: { not: ProductionStatus.PENDING }
      },
      orderBy: { productionTaskNo: 'desc' }
    });
    if (existingStarted) {
      throw new BadRequestException('已有补单任务已开始生产，请管理人员确认后再创建新的客户变更记录');
    }

    const productionTaskNo = await this.generateNextReplenishmentTaskNo(tx, sourceProductionTaskNo);
    await tx.productionTask.create({
      data: {
        productionTaskNo,
        orderId: order.id,
        orderLineId: line.id,
        orderNo: order.orderNo,
        customerName: order.customerName,
        partCode: line.partCode,
        partName: line.partName,
        plannedQuantity,
        unit: line.unit,
        processSnapshot: this.processStepsToJson(steps),
        status: ProductionStatus.PENDING,
        isReplenishment: true,
        sourceProductionTaskNo,
        replenishmentSourceType: 'ORDER_CHANGE',
        replenishmentSourceRequestNo: order.orderNo,
        remark: reason
      }
    });
    return productionTaskNo;
  }

  private async generateNextReplenishmentTaskNo(tx: Prisma.TransactionClient, sourceProductionTaskNo: string) {
    const prefix = `${sourceProductionTaskNo}-R`;
    const existingTasks = await tx.productionTask.findMany({
      where: {
        OR: [{ sourceProductionTaskNo }, { productionTaskNo: { startsWith: prefix } }]
      },
      select: { productionTaskNo: true }
    });
    const usedSequences = new Set<number>();
    for (const task of existingTasks) {
      const matched = task.productionTaskNo.match(/-R(\d+)$/);
      if (matched) {
        usedSequences.add(Number(matched[1]));
      }
    }
    for (let index = 1; index < 1000; index += 1) {
      if (!usedSequences.has(index)) {
        return `${prefix}${String(index).padStart(2, '0')}`;
      }
    }
    throw new BadRequestException('没有可用的补单任务号');
  }

  private async describeOrderProductionProgress(tx: Prisma.TransactionClient, orderId: string) {
    const tasks = await tx.productionTask.findMany({
      where: { orderId },
      include: { processCompletions: { orderBy: { stepNo: 'asc' } } },
      orderBy: { productionTaskNo: 'asc' }
    });
    const startedTasks = tasks.filter((task) => this.isStartedProductionTask(task));
    if (startedTasks.length === 0) {
      return '当前订单尚未开始生产';
    }
    const summaries = startedTasks.map((task) => {
      const steps = processSnapshotToArray(task.processSnapshot);
      const completedNames = task.processCompletions
        .filter((completion) => completion.isCompleted)
        .map((completion) => completion.processName);
      const nextStep = steps.find((step) => !completedNames.includes(step));
      if (task.status === ProductionStatus.COMPLETED) {
        return `${task.partCode} 已完成`;
      }
      if (completedNames.length === 0) {
        return `${task.partCode} 已开始生产，下一工序 ${nextStep || '待确认'}`;
      }
      return `${task.partCode} 已完成 ${completedNames.join('、')}，下一工序 ${nextStep || '待最终确认'}`;
    });
    return `当前订单生产进度：${summaries.join('；')}`;
  }

  private normalizeCancelHandlingPlan(
    items: CancelOrderDto['handlingPlan'],
    startedTasks: any[],
    productionCancelState: 'NOT_PRODUCED' | 'PRODUCED'
  ) {
    const planMap = new Map<string, NormalizedCancelHandlingPlanItem>();
    if (productionCancelState !== 'PRODUCED') {
      return planMap;
    }
    if (startedTasks.length === 0) {
      return planMap;
    }
    if (!items || items.length === 0) {
      throw new BadRequestException('已生产取消必须填写已生产零件的处理方案');
    }

    const taskMap = new Map(startedTasks.map((task) => [task.productionTaskNo.toUpperCase(), task]));
    for (const item of items) {
      const taskNo = item.productionTaskNo.trim().toUpperCase();
      const task = taskMap.get(taskNo);
      if (!task || task.orderLineId !== item.orderLineId) {
        throw new BadRequestException(`取消处理方案包含无效任务 ${item.productionTaskNo}`);
      }
      if (planMap.has(taskNo)) {
        throw new BadRequestException(`取消处理方案存在重复任务 ${item.productionTaskNo}`);
      }

      const handlingQuantity = this.roundQuantity(decimalToNumber(item.handlingQuantity));
      if ((item.handlingMode === 'STOCK' || item.handlingMode === 'SCRAP') && handlingQuantity <= 0) {
        throw new BadRequestException(`任务 ${item.productionTaskNo} 的处理数量必须大于 0`);
      }
      if (item.handlingMode === 'NONE' && handlingQuantity > 0) {
        throw new BadRequestException(`任务 ${item.productionTaskNo} 选择无实物处理时，处理数量必须为 0`);
      }
      if (item.handlingMode === 'NONE' && !item.remark?.trim()) {
        throw new BadRequestException(`任务 ${item.productionTaskNo} 选择无实物处理时必须填写说明`);
      }

      const maxQuantity = Math.max(
        decimalToNumber(task.completedQuantity),
        decimalToNumber(task.plannedQuantity),
        0
      );
      if (handlingQuantity > maxQuantity) {
        throw new BadRequestException(`任务 ${item.productionTaskNo} 的处理数量不能超过生产任务数量`);
      }

      planMap.set(taskNo, {
        orderLineId: item.orderLineId,
        productionTaskNo: task.productionTaskNo,
        handlingMode: item.handlingMode,
        handlingQuantity,
        remark: item.remark?.trim() || undefined
      });
    }

    const missingTask = startedTasks.find((task) => !planMap.has(task.productionTaskNo.toUpperCase()));
    if (missingTask) {
      throw new BadRequestException(`取消处理方案缺少任务 ${missingTask.productionTaskNo}`);
    }
    return planMap;
  }

  private formatCancelHandlingPlan(plan: NormalizedCancelHandlingPlanItem, unit?: string) {
    const quantityText = `${this.roundQuantity(plan.handlingQuantity)} ${unit || '件'}`;
    const remarkText = plan.remark ? `，说明：${plan.remark}` : '';
    if (plan.handlingMode === 'STOCK') {
      return `管理人员建议转备货库存 ${quantityText}${remarkText}`;
    }
    if (plan.handlingMode === 'SCRAP') {
      return `管理人员建议报废 ${quantityText}${remarkText}`;
    }
    return `管理人员确认无实物处理${remarkText}`;
  }

  private cancelHandlingPlanToJson(
    plan: NormalizedCancelHandlingPlanItem,
    managerName: string,
    plannedAt: Date
  ): Prisma.InputJsonValue {
    return {
      handlingMode: plan.handlingMode,
      handlingQuantity: plan.handlingQuantity,
      remark: plan.remark || '',
      plannedBy: managerName,
      plannedAt: plannedAt.toISOString()
    };
  }

  private async createProductionNotice(
    tx: Prisma.TransactionClient,
    data: {
      noticeType: 'QUANTITY_INCREASE' | 'QUANTITY_DECREASE' | 'ORDER_CANCELLED' | 'MATERIAL_ADDED' | 'TASK_WITHDRAWN';
      target?: ProductionNoticeTarget;
      order: any;
      line?: any;
      productionTaskId?: string;
      productionTaskNo?: string;
      beforeQuantity?: number;
      afterQuantity?: number;
      deltaQuantity?: number;
      reason: string;
      managerName?: string;
      handlingPlan?: Prisma.InputJsonValue;
    }
  ) {
    const target = data.target || ProductionNoticeTarget.PRODUCTION;
    const existingPendingNotice = await tx.productionNotice.findFirst({
      where: {
        noticeType: data.noticeType,
        target,
        status: ProductionNoticeStatus.PENDING,
        orderLineId: data.line?.id,
        productionTaskNo: data.productionTaskNo
      },
      orderBy: { createdAt: 'desc' }
    });

    const noticeData = {
      noticeType: data.noticeType,
      target,
      orderId: data.order.id,
      orderNo: data.order.orderNo,
      orderLineId: data.line?.id,
      productionTaskId: data.productionTaskId,
      productionTaskNo: data.productionTaskNo,
      partCode: data.line?.partCode,
      partName: data.line?.partName,
      beforeQuantity: data.beforeQuantity,
      afterQuantity: data.afterQuantity,
      deltaQuantity: data.deltaQuantity,
      unit: data.line?.unit,
      reason: data.reason,
      managerName: data.managerName || null,
      ...(data.handlingPlan !== undefined ? { handlingPlan: data.handlingPlan } : {})
    };

    if (existingPendingNotice) {
      await tx.productionNotice.update({
        where: { id: existingPendingNotice.id },
        data: noticeData
      });
      return;
    }

    await tx.productionNotice.create({
      data: {
        noticeNo: await this.generateNextNoticeNo(tx),
        ...noticeData
      }
    });
  }

  private async generateNextNoticeNo(tx: Prisma.TransactionClient) {
    const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PN-${dateKey}-`;
    const lastNotice = await tx.productionNotice.findFirst({
      where: { noticeNo: { startsWith: prefix } },
      orderBy: { noticeNo: 'desc' },
      select: { noticeNo: true }
    });
    const nextSequence = lastNotice ? Number(lastNotice.noticeNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(nextSequence).padStart(4, '0')}`;
  }

  private async allocateStockToOrderLine(tx: Prisma.TransactionClient, order: any, line: any) {
    await this.consumeAvailableStock(tx, order, line, this.selectedStockSourceQuantity(line), 'STOCK');
  }

  private async consumeStockForRework(tx: Prisma.TransactionClient, order: any, line: any) {
    // 库存再加工要按生产计划数量领用备货库存；多计划的数量后续生产完成后仍可转为备货库存。
    await this.consumeAvailableStock(tx, order, line, decimalToNumber(line.productionPlanQuantity), 'REWORK');
  }

  private async consumeAvailableStock(
    tx: Prisma.TransactionClient,
    order: any,
    line: any,
    requiredQuantity: number,
    purpose: 'STOCK' | 'REWORK'
  ) {
    const selectedSources = this.jsonToStockSourceSelections(line.stockSourceSelections);
    this.validateSelectedStockSourceManualConfirmations(selectedSources);
    const hasManualSelections = selectedSources.length > 0;
    if (!hasManualSelections) {
      throw new BadRequestException(`零件 ${line.partCode} 必须先选择库存批次并完成来源核对`);
    }
    const stockBatches = await tx.inventoryBatch.findMany({
      where: hasManualSelections
        ? {
            id: { in: selectedSources.map((source) => source.batchId) },
            sourceOrderId: null,
            quantity: { gt: 0 },
            status: 'AVAILABLE'
          }
        : {
            sourceOrderId: null,
            partCode: { equals: line.partCode, mode: 'insensitive' },
            unit: line.unit,
            quantity: { gt: 0 },
            status: 'AVAILABLE'
          },
      include: {
        sourceOrderLine: true,
        productionTask: { include: { orderLine: true } },
        reservations: {
          where: { status: InventoryReservationStatus.ACTIVE },
          include: {
            order: { select: { orderNo: true, customerName: true, orderDate: true } },
            orderLine: { select: { lineNo: true, partCode: true, partName: true } }
          },
          orderBy: [{ createdAt: 'asc' }]
        }
      },
      orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }]
    });
    const usageCandidateBatches = await this.findAvailableStockUsageCandidateBatches(tx, stockBatches, order.id);
    const sourceTaskMap = await this.findStockSourceTaskMap(tx, usageCandidateBatches);
    const selectedSourceMap = new Map(selectedSources.map((source) => [source.batchId, source]));
    const foundBatchIds = new Set(stockBatches.map((batch) => batch.id));
    const missingSelection = selectedSources.find((source) => !foundBatchIds.has(source.batchId));
    if (missingSelection) {
      throw new BadRequestException(`已选库存批次 ${missingSelection.batchNo || missingSelection.batchId} 不存在或当前不可用`);
    }
    const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(
      tx,
      stockBatches.map((batch) => batch.id),
      order
    );
    if (hasManualSelections) {
      const selectedTotal = selectedSources.reduce((sum, source) => sum + Number(source.quantity || 0), 0);
      if (selectedTotal > requiredQuantity + 0.0001) {
        throw new BadRequestException(
          `零件 ${line.partCode} 已选库存数量超过本次需要数量：需要 ${requiredQuantity}，已选 ${selectedTotal}`
        );
      }
    }

    // 操作员已经在库存来源弹窗确定了使用队列；提交生产扣库必须严格按 selectedStockSources 顺序执行。
    const sortedStockBatches = hasManualSelections
      ? selectedSources
          .map((source) => stockBatches.find((batch) => batch.id === source.batchId))
          .filter(Boolean)
      : this.sortStockBatchesForOrderLine(line, stockBatches, sourceTaskMap);
    const candidateBatches = hasManualSelections
      ? sortedStockBatches.map((batch) => ({
          ...batch,
          selectedQuantity: selectedSourceMap.get(batch.id)?.quantity || 0,
          reservedByOtherOrders: reservedQuantityByBatchId.get(batch.id) || 0,
          availableQuantity: Math.max(decimalToNumber(batch.quantity) - (reservedQuantityByBatchId.get(batch.id) || 0), 0)
        }))
      : purpose === 'STOCK'
        ? sortedStockBatches.filter((batch) => this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap))
        : sortedStockBatches;

    for (const batch of candidateBatches) {
      if (batch.unit !== line.unit) {
        throw new BadRequestException(`已选库存批次 ${batch.batchNo} 的单位 ${batch.unit} 与订单单位 ${line.unit} 不一致`);
      }
      const batchAvailableQuantity = Number(batch.availableQuantity ?? decimalToNumber(batch.quantity));
      if (hasManualSelections && batchAvailableQuantity + 0.0001 < Number(batch.selectedQuantity || 0)) {
        throw new BadRequestException(
          `已选库存批次 ${batch.batchNo} 的使用数量超过当前可用库存：${this.stockAvailabilitySummary([batch], order.id)}`
        );
      }
      const selectedSource = hasManualSelections ? selectedSourceMap.get(batch.id) : undefined;
      if (hasManualSelections) {
        const usageOrderIssue = this.stockSourceUsageOrderIssue(
          line,
          batch,
          sourceTaskMap,
          selectedSources,
          usageCandidateBatches,
          order.id
        );
        const needsManualConfirmation =
          purpose === 'STOCK'
            ? this.stockSourceSelectionNeedsManualConfirmation(line, batch, sourceTaskMap, selectedSources, usageCandidateBatches, order.id)
            : !this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap) ||
              Boolean(usageOrderIssue);
        if (needsManualConfirmation && !this.stockSourceManualConfirmationComplete(selectedSource)) {
          // 后端必须按真实库存来源重新核对，不能只相信前端提交的 compatibilityStatus。
          throw new BadRequestException(
            `已选库存批次 ${batch.batchNo} 需要填写人工确认记录${usageOrderIssue ? `：${usageOrderIssue}` : ''}`
          );
        }
      }
    }

    const availableQuantity = candidateBatches.reduce(
      (sum, batch) => sum + Number(batch.availableQuantity ?? decimalToNumber(batch.quantity)),
      0
    );
    const selectedAvailableQuantity = hasManualSelections
      ? candidateBatches.reduce(
          (sum, batch) => sum + Math.min(Number(batch.availableQuantity ?? decimalToNumber(batch.quantity)), Number(batch.selectedQuantity || 0)),
          0
        )
      : availableQuantity;
    const availabilitySummary = this.stockAvailabilitySummary(candidateBatches, order.id);
    if (selectedAvailableQuantity + 0.0001 < requiredQuantity) {
      if (hasManualSelections) {
        throw new BadRequestException(
          `零件 ${line.partCode} 已选库存不足：需要 ${requiredQuantity}，已选可用 ${selectedAvailableQuantity}。${availabilitySummary}`
        );
      }
      if (purpose === 'STOCK' && stockBatches.length > 0) {
        throw new BadRequestException(
          `零件 ${line.partCode} 可用库存不足：需要 ${requiredQuantity}，可用 ${availableQuantity}。${availabilitySummary}`
        );
      }
      throw new BadRequestException(`零件 ${line.partCode} 可用库存不足：需要 ${requiredQuantity}，可用 ${availableQuantity}。${availabilitySummary}`);
    }

    let remainingQuantity = this.roundQuantity(requiredQuantity);
    let sequence = 1;
    for (const batch of candidateBatches) {
      if (remainingQuantity <= 0) {
        break;
      }

      const batchQuantity = decimalToNumber(batch.quantity);
      const batchAvailableQuantity = this.roundQuantity(Number(batch.availableQuantity ?? batchQuantity));
      const selectedLimit = hasManualSelections ? Number(batch.selectedQuantity || 0) : batchAvailableQuantity;
      const usedQuantity = this.roundQuantity(Math.min(batchAvailableQuantity, selectedLimit, remainingQuantity));
      if (usedQuantity <= 0) {
        continue;
      }
      const leftQuantity = this.roundQuantity(batchQuantity - usedQuantity);
      const suffix = `${String(line.lineNo).padStart(3, '0')}-${String(sequence).padStart(2, '0')}`;

      // 使用备货库存不能只写订单字段，必须先扣减原备货库存并追加 OUT 流水，保证库存账准确。
      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: leftQuantity > 0 ? { quantity: leftQuantity } : { quantity: 0, status: 'USED' }
      });

      await tx.inventoryTransaction.create({
        data: {
          transactionNo: `IT-${purpose}-OUT-${order.orderNo}-${suffix}`,
          transactionType: 'OUT',
          batchId: batch.id,
          orderLineId: line.id,
          partCode: batch.partCode,
          partName: batch.partName,
          orderNo: null,
          productionTaskNo: batch.sourceProductionTaskNo,
          quantity: usedQuantity,
          unit: batch.unit,
          warehouseId: batch.warehouseId,
          locationId: batch.locationId,
          remark: purpose === 'STOCK' ? '订单使用备货库存' : '库存修改再加工领用',
          sourceRecordType: `OrderLine${purpose}`,
          sourceRecordId: line.id
        }
      });

      await this.consumeActiveInventoryReservations(tx, order, line, batch, usedQuantity);

      if (purpose === 'STOCK') {
        const sourceTask = batch.sourceProductionTaskNo ? sourceTaskMap.get(batch.sourceProductionTaskNo) : null;
        const orderBatch = await tx.inventoryBatch.create({
          data: {
            batchNo: `IB-ALLOC-${order.orderNo}-${suffix}`,
            partCode: line.partCode,
            partName: line.partName,
            sourceOrderId: order.id,
            sourceOrderLineId: line.id,
            sourceOrderNo: order.orderNo,
            sourceCustomerName: order.customerName,
            productionTaskId: null,
            // 备货库存转成订单待发库存时仍要保留原生产任务号，用于核对原订单、图号和版本。
            sourceProductionTaskNo: batch.sourceProductionTaskNo,
            sourceKind: batch.sourceKind || 'NORMAL_ORDER',
            // 订单占用库存后不能丢失原批次的补单来源，否则发货和库存来源核对会看不出是订单补单还是生产报废补单。
            replenishmentSourceType: batch.replenishmentSourceType || sourceTask?.replenishmentSourceType,
            replenishmentSourceRequestNo: batch.replenishmentSourceRequestNo || sourceTask?.replenishmentSourceRequestNo,
            quantity: usedQuantity,
            unit: line.unit,
            warehouseId: batch.warehouseId,
            locationId: batch.locationId,
            status: 'AVAILABLE'
          }
        });

        await tx.inventoryTransaction.create({
          data: {
            transactionNo: `IT-STOCK-IN-${order.orderNo}-${suffix}`,
            transactionType: 'IN',
            batchId: orderBatch.id,
            orderLineId: line.id,
            partCode: line.partCode,
            partName: line.partName,
            orderNo: order.orderNo,
            productionTaskNo: batch.sourceProductionTaskNo,
            quantity: usedQuantity,
            unit: line.unit,
            warehouseId: batch.warehouseId,
            locationId: batch.locationId,
            remark: '备货库存转订单待发货库存',
            sourceRecordType: 'OrderLineStockAllocation',
            sourceRecordId: line.id
          }
        });
      }

      remainingQuantity = this.roundQuantity(remainingQuantity - usedQuantity);
      sequence += 1;
    }
  }

  private async consumeActiveInventoryReservations(
    tx: Prisma.TransactionClient,
    order: { id: string; orderNo: string },
    line: { id: string; partCode: string; partName: string; unit: string },
    batch: { id: string; batchNo: string; unit: string },
    usedQuantity: number
  ) {
    const reservations = await tx.inventoryReservation.findMany({
      where: {
        batchId: batch.id,
        orderId: order.id,
        orderLineId: line.id,
        status: InventoryReservationStatus.ACTIVE
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const reservedQuantity = this.roundQuantity(
      reservations.reduce((sum, reservation) => sum + decimalToNumber(reservation.quantity), 0)
    );

    // 提交生产时必须把草稿预占、实际扣库存和库存流水逐批对齐，避免旧数据造成少生产或重复占用。
    if (Math.abs(reservedQuantity - usedQuantity) > 0.0001) {
      throw new BadRequestException(
        `库存批次 ${batch.batchNo} 的草稿预占数量异常：本次应消费 ${usedQuantity}${batch.unit}，` +
          `实际 ACTIVE 预占 ${reservedQuantity}${batch.unit}。请重新保存订单库存来源后再提交生产。`
      );
    }
    if (reservations.length === 0) {
      throw new BadRequestException(
        `库存批次 ${batch.batchNo} 缺少草稿库存预占记录，请重新保存订单库存来源后再提交生产。`
      );
    }

    await tx.inventoryReservation.updateMany({
      where: { id: { in: reservations.map((reservation) => reservation.id) } },
      data: {
        status: InventoryReservationStatus.CONSUMED,
        statusReason: `订单 ${order.orderNo} 提交生产消费库存`,
        consumedAt: new Date()
      }
    });
  }

  private stockAvailabilitySummary(batches: any[], currentOrderId?: string) {
    if (!batches.length) {
      return '没有可用库存批次';
    }
    return batches
      .map((batch) => {
        const unit = batch.unit || '件';
        const physicalQuantity = this.roundQuantity(decimalToNumber(batch.quantity));
        const reservationRows = (batch.reservations || []).filter((reservation: any) => reservation.orderId !== currentOrderId);
        const reservationQuantity = this.roundQuantity(
          batch.reservedByOtherOrders !== undefined
            ? Number(batch.reservedByOtherOrders || 0)
            : reservationRows.reduce((sum: number, reservation: any) => sum + decimalToNumber(reservation.quantity), 0)
        );
        const availableQuantity = this.roundQuantity(
          batch.availableQuantity !== undefined ? Number(batch.availableQuantity ?? 0) : Math.max(physicalQuantity - reservationQuantity, 0)
        );
        const selectedQuantity = this.roundQuantity(Number(batch.selectedQuantity || 0));
        const reservationText = reservationRows
          .map((reservation: any) => {
            const orderNo = reservation.orderNo || reservation.order?.orderNo || '草稿订单';
            const partName = reservation.partName || reservation.orderLine?.partName || reservation.partCode || reservation.orderLine?.partCode || '-';
            return `${orderNo}/${partName} 预占 ${this.roundQuantity(decimalToNumber(reservation.quantity))}${reservation.unit || unit}`;
          })
          .join('，');
        const selectedText = selectedQuantity > 0 ? `，本次选择 ${selectedQuantity}${unit}` : '';
        const reservationDetailText =
          reservationText || reservationQuantity <= 0
            ? reservationText
            : `其他订单合计预占 ${reservationQuantity}${unit}`;
        return `${batch.batchNo}: 当前库存 ${physicalQuantity}${unit}，其他订单预占 ${reservationQuantity}${unit}，可用 ${availableQuantity}${unit}${selectedText}${
          reservationDetailText ? `（${reservationDetailText}）` : ''
        }`;
      })
      .join('；');
  }

  private validateSelectedStockSourceManualConfirmations(selectedSources: ReturnType<OrdersService['jsonToStockSourceSelections']>) {
    const missingReviewSource = selectedSources.find((source) => !source.compatibilityStatus);
    if (missingReviewSource) {
      throw new BadRequestException(
        `已选库存批次 ${missingReviewSource.batchNo || missingReviewSource.batchId} 缺少库存来源核对结果，请重新打开库存来源并确认后再保存`
      );
    }

    const incompleteSource = selectedSources.find(
      (source) => source.compatibilityStatus && source.compatibilityStatus !== 'MATCHED' && !this.stockSourceManualConfirmationComplete(source)
    );
    if (!incompleteSource) {
      return;
    }

    throw new BadRequestException(
      `已选库存批次 ${incompleteSource.batchNo || incompleteSource.batchId} 与本次订单资料不完全匹配，必须填写人工确认记录`
    );
  }

  private stockSourceManualConfirmationComplete(source?: ReturnType<OrdersService['jsonToStockSourceSelections']>[number]) {
    const confirmedAt = source?.manualConfirmedAt?.trim();
    return Boolean(
      source?.manualConfirmedBy?.trim() &&
        confirmedAt &&
        !Number.isNaN(new Date(confirmedAt).getTime()) &&
        source?.manualConfirmRemark?.trim()
    );
  }

  private async findStockSourceTaskMap(tx: Prisma.TransactionClient, batches: any[]) {
    const taskNos = [...new Set(batches.map((batch) => batch.sourceProductionTaskNo).filter(Boolean))] as string[];
    if (taskNos.length === 0) {
      return new Map<string, any>();
    }

    const tasks = await tx.productionTask.findMany({
      where: { productionTaskNo: { in: taskNos } },
      include: { orderLine: true }
    });
    return new Map(tasks.map((task) => [task.productionTaskNo, task]));
  }

  private async findAvailableStockUsageCandidateBatches(
    client: { inventoryBatch: { findMany: (args: any) => Promise<any[]> } },
    selectedBatches: any[],
    excludeOrderId?: string
  ) {
    const keys = new Map<string, { partCode: string; unit: string }>();
    for (const batch of selectedBatches) {
      const partCode = String(batch.partCode || '').trim();
      const unit = String(batch.unit || '').trim();
      if (!partCode || !unit) {
        continue;
      }
      keys.set(`${partCode.toLocaleLowerCase()}__${unit.toLocaleLowerCase()}`, { partCode, unit });
    }
    if (keys.size === 0) {
      return selectedBatches;
    }

    const candidateBatches = await client.inventoryBatch.findMany({
      where: {
        sourceOrderId: null,
        quantity: { gt: 0 },
        status: 'AVAILABLE',
        OR: [...keys.values()].map((key) => ({
          partCode: { equals: key.partCode, mode: 'insensitive' },
          unit: key.unit
        }))
      },
      include: {
        sourceOrderLine: true,
        productionTask: { include: { orderLine: true } },
        reservations: {
          where: {
            status: InventoryReservationStatus.ACTIVE,
            ...(excludeOrderId ? { orderId: { not: excludeOrderId } } : {})
          }
        }
      },
      orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }]
    });

    // 使用顺序校验必须包含未被选中的同类小批次，后端才能发现“先用大库存、跳过小库存”的情况。
    const rows = new Map<string, any>();
    for (const batch of candidateBatches) {
      rows.set(batch.id, batch);
    }
    for (const batch of selectedBatches) {
      rows.set(batch.id, batch);
    }
    return [...rows.values()];
  }

  private resolveStockBatchSourceLine(batch: any, sourceTaskMap: Map<string, any>) {
    const sourceTask = batch.sourceProductionTaskNo ? sourceTaskMap.get(batch.sourceProductionTaskNo) : null;
    if (sourceTask?.orderLine) {
      // 备货库存可能后来被分配给新订单，图纸匹配必须取原生产任务的订单零件信息。
      return sourceTask.orderLine;
    }
    return batch.sourceOrderLine || batch.productionTask?.orderLine || null;
  }

  private sortStockBatchesForOrderLine(line: any, batches: any[], sourceTaskMap: Map<string, any>) {
    return batches
      .map((batch, index) => ({
        batch,
        index,
        rank: this.stockBatchCompatibilityRank(line, batch, sourceTaskMap)
      }))
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          this.stockBatchAvailableQuantity(left.batch) - this.stockBatchAvailableQuantity(right.batch) ||
          left.index - right.index
      )
      .map((item) => item.batch);
  }

  private stockBatchReservedQuantity(batch: any, currentOrderId?: string) {
    if (batch.reservedByOtherOrders !== undefined) {
      return this.roundQuantity(Number(batch.reservedByOtherOrders || 0));
    }
    return this.roundQuantity(
      (batch.reservations || [])
        .filter((reservation: any) => !currentOrderId || reservation.orderId !== currentOrderId)
        .reduce((sum: number, reservation: any) => sum + decimalToNumber(reservation.quantity), 0)
    );
  }

  private stockBatchAvailableQuantity(batch: any, currentOrderId?: string) {
    if (batch.availableQuantity !== undefined) {
      return this.roundQuantity(Number(batch.availableQuantity ?? 0));
    }
    return this.roundQuantity(Math.max(decimalToNumber(batch.quantity) - this.stockBatchReservedQuantity(batch, currentOrderId), 0));
  }

  private stockBatchCompatibilityRank(line: any, batch: any, sourceTaskMap: Map<string, any>) {
    const sourceLine = this.resolveStockBatchSourceLine(batch, sourceTaskMap);
    if (this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap)) {
      return 0;
    }
    if (!sourceLine) {
      return 2;
    }
    return 1;
  }

  private stockBatchMatchesOrderLine(line: any, batch: any, sourceTaskMap: Map<string, any>) {
    const sourceLine = this.resolveStockBatchSourceLine(batch, sourceTaskMap);
    if (!sourceLine) {
      return false;
    }

    return (
      this.sourceLineHasDirectStockDrawingInfo(sourceLine) &&
      this.requiredTextMatches(line.partCode, batch.partCode) &&
      this.requiredTextMatches(line.drawingNo, sourceLine.drawingNo) &&
      this.requiredTextMatches(line.drawingVersion, sourceLine.drawingVersion) &&
      this.requiredTextMatches(line.partSpecification, sourceLine.partSpecification) &&
      this.requiredNumberMatches(line.partThickness, sourceLine.partThickness)
    );
  }

  private stockSourceSelectionNeedsManualConfirmation(
    line: any,
    batch: any,
    sourceTaskMap: Map<string, any>,
    selectedSources: ReturnType<OrdersService['jsonToStockSourceSelections']>,
    availableBatches: any[],
    currentOrderId?: string
  ) {
    return (
      this.stockSourceMissingOrderInfo(line).length > 0 ||
      this.directStockSourceMissingDrawingInfo(batch, sourceTaskMap).length > 0 ||
      !this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap) ||
      Boolean(this.stockSourceUsageOrderIssue(line, batch, sourceTaskMap, selectedSources, availableBatches, currentOrderId))
    );
  }

  private stockSourceUsageOrderIssue(
    line: any,
    batch: any,
    sourceTaskMap: Map<string, any>,
    selectedSources: ReturnType<OrdersService['jsonToStockSourceSelections']>,
    availableBatches: any[],
    currentOrderId?: string
  ) {
    const selectedQuantityMap = new Map(selectedSources.map((source) => [source.batchId, source.quantity]));
    const selectedOrderIndexMap = new Map(selectedSources.map((source, index) => [source.batchId, index]));
    const currentSelectedIndex = selectedOrderIndexMap.get(batch.id);
    const currentQuantity = this.stockBatchAvailableQuantity(batch, currentOrderId);
    const currentCompatibilityRank = this.stockBatchCompatibilityRank(line, batch, sourceTaskMap);
    const requiredQuantity =
      this.normalizeFulfillmentMode(line.fulfillmentMode) === OrderLineFulfillmentMode.REWORK
        ? decimalToNumber(this.resolveProductionPlanQuantity(line))
        : decimalToNumber(line.quantity);
    const smallerBatch = availableBatches
      .filter(
        (candidate) =>
          candidate.id !== batch.id &&
          candidate.unit === batch.unit &&
          String(candidate.partCode || '').trim().toLocaleLowerCase() === String(batch.partCode || '').trim().toLocaleLowerCase() &&
          this.stockBatchCompatibilityRank(line, candidate, sourceTaskMap) === currentCompatibilityRank
      )
      .sort((left, right) => this.stockBatchAvailableQuantity(left, currentOrderId) - this.stockBatchAvailableQuantity(right, currentOrderId))
      .find((candidate) => {
        const selectedQuantity = selectedQuantityMap.get(candidate.id) || 0;
        const candidateSelectedIndex = selectedOrderIndexMap.get(candidate.id);
        const candidateAvailableQuantity = this.stockBatchAvailableQuantity(candidate, currentOrderId);
        const expectedEarlierUseQuantity = Math.min(candidateAvailableQuantity, requiredQuantity || candidateAvailableQuantity);
        const smallerQuantity = candidateAvailableQuantity > 0 && candidateAvailableQuantity + 0.0001 < currentQuantity;
        const notFullyUsed = selectedQuantity + 0.0001 < expectedEarlierUseQuantity;
        const selectedAfterCurrent =
          currentSelectedIndex !== undefined &&
          candidateSelectedIndex !== undefined &&
          candidateSelectedIndex > currentSelectedIndex;
        return smallerQuantity && (notFullyUsed || selectedAfterCurrent);
      });
    return smallerBatch ? `未优先使用较小库存批次 ${smallerBatch.batchNo}` : '';
  }

  private stockSourceMissingOrderInfo(line: any) {
    return [
      !String(line.drawingNo || '').trim() ? '图号' : '',
      !String(line.drawingVersion || '').trim() ? '图纸版本' : '',
      !String(line.partSpecification || '').trim() ? '成品规格' : '',
      decimalToNumber(line.partThickness) <= 0 ? '零件厚度' : ''
    ].filter(Boolean);
  }

  private directStockSourceMissingDrawingInfo(batch: any, sourceTaskMap: Map<string, any>) {
    const sourceLine = this.resolveStockBatchSourceLine(batch, sourceTaskMap);
    if (!sourceLine) {
      return ['图纸资料'];
    }
    return [
      !String(sourceLine.drawingNo || '').trim() ? '图号' : '',
      !String(sourceLine.drawingVersion || '').trim() ? '图纸版本' : '',
      !String(sourceLine.drawingFileUrl || '').trim() ? '图纸文件' : ''
    ].filter(Boolean);
  }

  private sourceLineHasDirectStockDrawingInfo(sourceLine: any) {
    return Boolean(
      String(sourceLine.drawingNo || '').trim() &&
        String(sourceLine.drawingVersion || '').trim() &&
        String(sourceLine.drawingFileUrl || '').trim()
    );
  }

  private requiredTextMatches(required?: string | null, actual?: string | null) {
    const normalizedRequired = String(required ?? '').trim().toLocaleLowerCase();
    if (!normalizedRequired) {
      return true;
    }
    return normalizedRequired === String(actual ?? '').trim().toLocaleLowerCase();
  }

  private requiredNumberMatches(required?: number | Prisma.Decimal | null, actual?: number | Prisma.Decimal | null) {
    const requiredNumber = decimalToNumber(required);
    if (!requiredNumber) {
      return true;
    }
    const actualNumber = decimalToNumber(actual);
    if (!actualNumber) {
      return false;
    }
    return Math.abs(requiredNumber - actualNumber) < 0.0001;
  }

  private async releaseUnstartedLineStock(tx: Prisma.TransactionClient, order: any, line: any, reason: string) {
    const allocationBatches = (line.inventoryBatches || []).filter(
      (batch: any) => batch.sourceOrderId && batch.status === 'AVAILABLE' && decimalToNumber(batch.quantity) > 0
    );

    for (const batch of allocationBatches) {
      const quantity = decimalToNumber(batch.quantity);
      await tx.inventoryTransaction.create({
        data: {
          transactionNo: this.buildOrderCancelTransactionNo('OUT', order.orderNo, line.lineNo),
          transactionType: 'OUT',
          batchId: batch.id,
          orderLineId: line.id,
          partCode: batch.partCode,
          partName: batch.partName,
          orderNo: order.orderNo,
          productionTaskNo: batch.sourceProductionTaskNo,
          quantity,
          unit: batch.unit,
          warehouseId: batch.warehouseId,
          locationId: batch.locationId,
          remark: `取消订单释放订单库存：${reason}`,
          sourceRecordType: 'OrderCancellation',
          sourceRecordId: line.id
        }
      });
      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: { quantity: 0, status: 'USED' }
      });
    }

    const consumedTransactions = await tx.inventoryTransaction.findMany({
      where: {
        transactionType: 'OUT',
        sourceRecordId: line.id,
        sourceRecordType: { in: ['OrderLineSTOCK', 'OrderLineREWORK'] }
      },
      orderBy: { createdAt: 'asc' }
    });

    for (const transaction of consumedTransactions) {
      const quantity = decimalToNumber(transaction.quantity);
      if (!transaction.batchId || quantity <= 0) {
        continue;
      }

      const sourceBatch = await tx.inventoryBatch.findUnique({ where: { id: transaction.batchId } });
      if (!sourceBatch) {
        continue;
      }

      // 未开工订单取消时，必须把已占用的备货库存退回原批次，并追加 IN 流水，不能直接改订单状态。
      await tx.inventoryBatch.update({
        where: { id: sourceBatch.id },
        data: {
          quantity: this.roundQuantity(decimalToNumber(sourceBatch.quantity) + quantity),
          status: 'AVAILABLE'
        }
      });
      await tx.inventoryTransaction.create({
        data: {
          transactionNo: this.buildOrderCancelTransactionNo('IN', order.orderNo, line.lineNo),
          transactionType: 'IN',
          batchId: sourceBatch.id,
          orderLineId: line.id,
          partCode: transaction.partCode,
          partName: transaction.partName,
          orderNo: null,
          productionTaskNo: transaction.productionTaskNo,
          quantity,
          unit: transaction.unit,
          warehouseId: transaction.warehouseId,
          locationId: transaction.locationId,
          remark: `取消订单退回备货库存：${reason}`,
          sourceRecordType: 'OrderCancellationReleaseStock',
          sourceRecordId: line.id
        }
      });
    }
  }

  private buildOrderCancelTransactionNo(direction: 'IN' | 'OUT', orderNo: string, lineNo: number) {
    return `IT-CANCEL-${direction}-${orderNo}-${String(lineNo).padStart(3, '0')}-${randomUUID()
      .slice(0, 8)
      .toUpperCase()}`;
  }

  private async parseOrderImportWorkbook(filePath: string): Promise<{ sheetName: string; rows: ParsedOrderImportRow[] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet('ERP上传净表');
    if (!worksheet) {
      throw new BadRequestException('Excel 文件必须包含名为 ERP上传净表 的工作表，请不要上传台账表或其他格式文件');
    }

    const header = this.findOrderImportHeaderRow(worksheet);
    const columns = {
      orderBlock: this.importColumn(header.columns, '订单块(自动)', '订单块'),
      orderNo: this.importColumn(header.columns, '订单编号'),
      orderDate: this.importColumn(header.columns, '制单日期'),
      customerName: this.importColumn(header.columns, '客户名称'),
      projectModel: this.importColumn(header.columns, '项目型号'),
      lineType: this.importColumn(header.columns, '行类型'),
      importSequence: this.importColumn(header.columns, '自动序号'),
      partCategory: this.importColumn(header.columns, '零件类型'),
      componentNo: this.importColumn(header.columns, '组件编号(自动)', '组件编号'),
      parentComponentNo: this.importColumn(header.columns, '所属组件编号(自动/可改)', '所属组件编号'),
      partCode: this.importColumn(header.columns, '物料号'),
      drawingNo: this.importColumn(header.columns, '图号'),
      partName: this.importColumn(header.columns, '产品名称'),
      partSpecification: this.importColumn(header.columns, '展开尺寸'),
      partThickness: this.importColumn(header.columns, '厚度'),
      orderQuantity: this.importColumn(header.columns, '订单数'),
      unitUsage: this.importColumn(header.columns, '单套用量'),
      demandQuantity: this.importColumn(header.columns, '需求数量(自动)', '需求数量'),
      unit: this.importColumn(header.columns, '单位'),
      processRoute: this.importColumn(header.columns, '工艺路线'),
      processRemark: this.importColumn(header.columns, '工艺备注'),
      drawingDate: this.importColumn(header.columns, '图纸日期'),
      drawingStatus: this.importColumn(header.columns, '图纸状态')
    };

    const requiredHeaders = [
      ['订单编号', columns.orderNo],
      ['制单日期', columns.orderDate],
      ['客户名称', columns.customerName],
      ['行类型', columns.lineType],
      ['物料号', columns.partCode],
      ['图号', columns.drawingNo],
      ['产品名称', columns.partName],
      ['需求数量(自动)', columns.demandQuantity],
      ['单位', columns.unit]
    ];
    const missingHeaders = requiredHeaders.filter(([, column]) => !column).map(([name]) => name);
    if (missingHeaders.length > 0) {
      throw new BadRequestException(`ERP上传净表缺少表头：${missingHeaders.join('、')}`);
    }

    const rows: ParsedOrderImportRow[] = [];
    const rowInputStates: Array<{ row: ParsedOrderImportRow; rawLineType: string; hasThickness: boolean; hasUnit: boolean }> = [];
    let firstBlankRowAfterData: number | null = null;

    for (let rowNo = header.rowNo + 1; rowNo <= worksheet.rowCount; rowNo += 1) {
      const row = worksheet.getRow(rowNo);
      const rawLineType = this.cellText(row, columns.lineType);
      const raw = this.rawImportRow(row, columns);
      if (this.isBlankImportRow(raw)) {
        if (rows.length > 0 && firstBlankRowAfterData === null) {
          firstBlankRowAfterData = rowNo;
        }
        continue;
      }
      if (firstBlankRowAfterData !== null) {
        throw new BadRequestException(
          `ERP上传净表必须连续填写，不能在第 ${firstBlankRowAfterData} 行留空后又从第 ${rowNo} 行继续填写`
        );
      }

      if (rawLineType.includes('订单头')) {
        throw new BadRequestException(`ERP上传净表不允许包含订单头行，请删除第 ${rowNo} 行订单头并让每条明细行填写订单编号、制单日期和客户名称`);
      }

      const parsedLineType = this.parseImportLineType(rawLineType);
      const orderDate = this.cellDate(row, columns.orderDate) || null;
      const orderNo = this.cellText(row, columns.orderNo);
      const customerName = this.cellText(row, columns.customerName);
      const projectModel = this.cellText(row, columns.projectModel);
      const partThickness = this.cellNumber(row, columns.partThickness);
      const demandQuantity = this.cellNumber(row, columns.demandQuantity);
      const unit = this.cellText(row, columns.unit);
      const parsedRow: ParsedOrderImportRow = {
        sourceRowNo: rowNo,
        rowHash: '',
        orderBlock: this.cellText(row, columns.orderBlock),
        orderNo: orderNo ? orderNo.trim().toUpperCase() : '',
        orderDate,
        customerName,
        projectModel,
        lineType: parsedLineType || 'PART',
        importSequence: this.cellText(row, columns.importSequence),
        partCategory: this.cellText(row, columns.partCategory),
        componentNo: this.cellText(row, columns.componentNo),
        parentComponentNo: this.cellText(row, columns.parentComponentNo),
        partCode: this.cellText(row, columns.partCode),
        drawingNo: this.cellText(row, columns.drawingNo),
        partName: this.cellText(row, columns.partName),
        partSpecification: this.cellText(row, columns.partSpecification),
        partThickness: partThickness && partThickness > 0 ? partThickness : 1,
        orderQuantity: this.cellNumber(row, columns.orderQuantity) ?? undefined,
        unitUsage: this.cellNumber(row, columns.unitUsage) ?? undefined,
        demandQuantity: demandQuantity ?? undefined,
        unit: unit || '件',
        processRoute: this.cellText(row, columns.processRoute),
        processRemark: this.cellText(row, columns.processRemark),
        drawingDate: this.cellDate(row, columns.drawingDate),
        drawingStatus: this.cellText(row, columns.drawingStatus),
        raw,
        issues: []
      };
      rows.push(parsedRow);
      rowInputStates.push({
        row: parsedRow,
        rawLineType,
        hasThickness: Boolean(partThickness),
        hasUnit: Boolean(unit)
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException('ERP上传净表没有可导入的零件或组件明细');
    }

    this.applyOrderImportAutomaticFields(rows);
    rowInputStates.forEach(({ row, rawLineType, hasThickness, hasUnit }) => {
      row.issues = this.buildParseImportIssues(row, rawLineType, hasThickness, hasUnit);
      row.rowHash = this.hashImportRow(row);
    });

    return { sheetName: worksheet.name, rows };
  }

  private findOrderImportHeaderRow(worksheet: ExcelJS.Worksheet) {
    for (let rowNo = 1; rowNo <= Math.min(20, worksheet.rowCount); rowNo += 1) {
      const row = worksheet.getRow(rowNo);
      const columns = new Map<string, number>();
      row.eachCell({ includeEmpty: false }, (cell, columnNo) => {
        const text = this.normalizeImportHeader(this.valueToText(this.normalizeExcelCellValue(cell.value)));
        if (text) {
          columns.set(text, columnNo);
        }
      });
      if (columns.has(this.normalizeImportHeader('订单编号')) && columns.has(this.normalizeImportHeader('产品名称'))) {
        return { rowNo, columns };
      }
    }
    throw new BadRequestException('ERP上传净表没有找到有效表头');
  }

  private applyOrderImportAutomaticFields(rows: ParsedOrderImportRow[]) {
    const rowsByOrder = new Map<string, ParsedOrderImportRow[]>();
    for (const row of rows) {
      const key = row.orderNo || `ROW-${row.sourceRowNo}`;
      const group = rowsByOrder.get(key) || [];
      group.push(row);
      rowsByOrder.set(key, group);
    }

    for (const group of rowsByOrder.values()) {
      let mainSequence = 0;
      let componentIndex = 0;
      let currentComponentNo = '';
      const componentSequence = new Map<string, string>();
      const componentDemand = new Map<string, number>();
      const childCounts = new Map<string, number>();

      for (const row of group) {
        row.componentNo = this.normalizeImportComponentNo(row.componentNo);
        row.parentComponentNo = this.normalizeImportComponentNo(row.parentComponentNo);

        if (row.lineType === 'COMPONENT') {
          mainSequence += 1;
          componentIndex += 1;
          if (!row.componentNo) {
            row.componentNo = `C${String(componentIndex).padStart(3, '0')}`;
          }
          if (!row.importSequence) {
            row.importSequence = String(mainSequence);
          }
          if (!row.demandQuantity || row.demandQuantity <= 0) {
            row.demandQuantity = this.calculateImportDemand(row.orderQuantity, row.unitUsage);
          }
          if (row.componentNo) {
            currentComponentNo = row.componentNo;
            componentSequence.set(row.componentNo, row.importSequence);
            if (row.demandQuantity && row.demandQuantity > 0) {
              componentDemand.set(row.componentNo, row.demandQuantity);
            }
          }
          continue;
        }

        if (this.shouldAutoBindImportParent(row, currentComponentNo)) {
          row.parentComponentNo = currentComponentNo;
        }

        if (row.parentComponentNo) {
          const childCount = (childCounts.get(row.parentComponentNo) || 0) + 1;
          childCounts.set(row.parentComponentNo, childCount);
          const parentSequence = componentSequence.get(row.parentComponentNo);
          if (!row.importSequence && parentSequence) {
            row.importSequence = `${parentSequence}.${childCount}`;
          }
          if ((!row.demandQuantity || row.demandQuantity <= 0) && row.unitUsage && componentDemand.has(row.parentComponentNo)) {
            row.demandQuantity = this.roundQuantity((componentDemand.get(row.parentComponentNo) || 0) * row.unitUsage);
          }
          continue;
        }

        currentComponentNo = '';
        mainSequence += 1;
        if (!row.importSequence) {
          row.importSequence = String(mainSequence);
        }
        if (!row.demandQuantity || row.demandQuantity <= 0) {
          row.demandQuantity = this.calculateImportDemand(row.orderQuantity, row.unitUsage);
        }
      }
    }
  }

  private normalizeImportComponentNo(value?: string) {
    return value?.trim().toUpperCase() || '';
  }

  private shouldAutoBindImportParent(
    row: { lineType?: string; parentComponentNo?: string | null; unitUsage?: unknown; orderQuantity?: unknown },
    currentComponentNo: string
  ) {
    const unitUsage = decimalToNumber(row.unitUsage as any);
    const orderQuantity = decimalToNumber(row.orderQuantity as any);
    return Boolean(
      currentComponentNo &&
        row.lineType === 'PART' &&
        !row.parentComponentNo &&
        unitUsage > 0 &&
        orderQuantity <= 0
    );
  }

  private calculateImportDemand(orderQuantity?: number, unitUsage?: number) {
    if (!orderQuantity || orderQuantity <= 0) {
      return undefined;
    }
    return this.roundQuantity(orderQuantity * (unitUsage && unitUsage > 0 ? unitUsage : 1));
  }

  private importColumn(columns: Map<string, number>, ...names: string[]) {
    for (const name of names) {
      const column = columns.get(this.normalizeImportHeader(name));
      if (column) {
        return column;
      }
    }
    return 0;
  }

  private normalizeImportHeader(value: string) {
    return value.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').trim();
  }

  private rawImportRow(row: ExcelJS.Row, columns: Record<string, number>) {
    const raw: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(columns)) {
      if (!column) {
        raw[key] = '';
        continue;
      }
      const value = this.normalizeExcelCellValue(row.getCell(column).value);
      raw[key] = value instanceof Date ? this.formatDateOnly(value) : value ?? '';
    }
    return raw;
  }

  private isBlankImportRow(raw: Record<string, unknown>) {
    return Object.values(raw).every((value) => String(value ?? '').trim() === '');
  }

  private normalizeExcelCellValue(value: unknown): unknown {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const cellValue = value as {
        result?: unknown;
        formula?: string;
        sharedFormula?: string;
        text?: string;
        richText?: Array<{ text?: string }>;
        hyperlink?: string;
      };
      if (cellValue.result !== undefined) {
        return this.normalizeExcelCellValue(cellValue.result);
      }
      if (cellValue.richText) {
        return cellValue.richText.map((item) => item.text || '').join('');
      }
      if (cellValue.text !== undefined) {
        return cellValue.text;
      }
      if (cellValue.hyperlink !== undefined) {
        return cellValue.hyperlink;
      }
      if (cellValue.formula !== undefined || cellValue.sharedFormula !== undefined) {
        return '';
      }
      return '';
    }
    return value;
  }

  private cellText(row: ExcelJS.Row, column: number) {
    if (!column) {
      return '';
    }
    return this.valueToText(this.normalizeExcelCellValue(row.getCell(column).value));
  }

  private valueToText(value: unknown) {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return this.formatDateOnly(value);
    }
    return String(value).replace(/\u00A0/g, ' ').trim();
  }

  private cellNumber(row: ExcelJS.Row, column: number) {
    const text = this.cellText(row, column)
      .replace(/,/g, '')
      .replace(/，/g, '')
      .replace(/mm$/i, '')
      .trim();
    if (!text) {
      return null;
    }
    const value = this.parseImportNumberText(text);
    return Number.isFinite(value) ? this.roundQuantity(value) : null;
  }

  private parseImportNumberText(text: string) {
    const normalized = text.replace(/\s+/g, '');
    const directValue = Number(normalized);
    if (Number.isFinite(directValue)) {
      return directValue;
    }
    if (!/^[+-]?\d+(?:\.\d+)?(?:[xX×*][+-]?\d+(?:\.\d+)?)+$/.test(normalized)) {
      return Number.NaN;
    }
    return normalized
      .split(/[xX×*]/)
      .map((part) => Number(part))
      .reduce((product, value) => (Number.isFinite(product) && Number.isFinite(value) ? product * value : Number.NaN), 1);
  }

  private cellDate(row: ExcelJS.Row, column: number) {
    if (!column) {
      return null;
    }
    const value = this.normalizeExcelCellValue(row.getCell(column).value);
    return this.parseExcelDate(value);
  }

  private parseExcelDate(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      if (value.getFullYear() <= 1900) {
        return null;
      }
      return value;
    }
    if (typeof value === 'number' && value > 20000) {
      return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    }
    const text = this.valueToText(value);
    if (!text) {
      return null;
    }
    const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (!match) {
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  private parseImportLineType(value: string): 'PART' | 'COMPONENT' | null {
    if (value.includes('组件')) {
      return 'COMPONENT';
    }
    if (value.includes('零件')) {
      return 'PART';
    }
    return null;
  }

  private buildParseImportIssues(row: ParsedOrderImportRow, rawLineType: string, hasThickness: boolean, hasUnit: boolean) {
    const issues: OrderImportIssue[] = [];
    if (!rawLineType || !this.parseImportLineType(rawLineType)) {
      issues.push({ severity: 'ERROR', code: 'INVALID_LINE_TYPE', message: '行类型必须是“零件”或“组件”' });
    }
    if (!row.orderNo) {
      issues.push({ severity: 'ERROR', code: 'ORDER_NO_REQUIRED', message: '订单编号不能为空' });
    }
    if (!row.orderDate) {
      issues.push({ severity: 'ERROR', code: 'ORDER_DATE_REQUIRED', message: '制单日期不能为空或格式无效' });
    }
    if (!row.customerName.trim()) {
      issues.push({ severity: 'ERROR', code: 'CUSTOMER_REQUIRED', message: '客户名称不能为空' });
    }
    if (!row.partCode.trim()) {
      issues.push({ severity: 'ERROR', code: 'PART_CODE_REQUIRED', message: '物料号不能为空' });
    }
    if (!row.partName.trim()) {
      issues.push({ severity: 'ERROR', code: 'PART_NAME_REQUIRED', message: '产品名称不能为空' });
    }
    if (!row.demandQuantity || row.demandQuantity <= 0) {
      issues.push({ severity: 'ERROR', code: 'DEMAND_QUANTITY_REQUIRED', message: '需求数量必须大于 0' });
    }
    const isOutsourcedPart = row.partCategory?.includes('外协') ?? false;
    if (!hasThickness && !isOutsourcedPart) {
      issues.push({ severity: 'WARNING', code: 'THICKNESS_DEFAULTED', message: '厚度为空，导入草稿暂按 1 处理，请在 ERP 中复核' });
    }
    if (!hasUnit) {
      issues.push({ severity: 'WARNING', code: 'UNIT_DEFAULTED', message: '单位为空，导入草稿暂按“件”处理，请在 ERP 中复核' });
    }
    return issues;
  }

  private hashImportRow(row: ParsedOrderImportRow) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          orderNo: row.orderNo,
          orderDate: row.orderDate ? this.formatDateOnly(row.orderDate) : '',
          customerName: row.customerName,
          projectModel: row.projectModel,
          lineType: row.lineType,
          importSequence: row.importSequence,
          partCategory: row.partCategory,
          componentNo: row.componentNo,
          parentComponentNo: row.parentComponentNo,
          partCode: row.partCode,
          drawingNo: row.drawingNo,
          partName: row.partName,
          partSpecification: row.partSpecification,
          partThickness: row.partThickness,
          orderQuantity: row.orderQuantity,
          unitUsage: row.unitUsage,
          demandQuantity: row.demandQuantity,
          unit: row.unit,
          processRoute: row.processRoute,
          processRemark: row.processRemark,
          drawingDate: row.drawingDate ? this.formatDateOnly(row.drawingDate) : '',
          drawingStatus: row.drawingStatus
        })
      )
      .digest('hex');
  }

  private importPreviewPageOptions(query: GetOrderImportSessionQueryDto = {}): ImportPreviewPageOptions {
    const requestedLimit = Number(query.orderLimit ?? 50);
    const requestedOffset = Number(query.orderOffset ?? 0);
    return {
      orderLimit: Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 100),
      orderOffset: Math.max(Number.isFinite(requestedOffset) ? requestedOffset : 0, 0)
    };
  }

  private importRowPageOptions(query: GetOrderImportFilePreviewQueryDto = {}) {
    const requestedLimit = Number(query.limit ?? 200);
    const requestedOffset = Number(query.offset ?? 0);
    return {
      limit: Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 200, 1), 500),
      offset: Math.max(Number.isFinite(requestedOffset) ? requestedOffset : 0, 0)
    };
  }

  private async buildImportSessionOrderStats(sessionIds: string[], sessionStatusById: Map<string, string>) {
    if (sessionIds.length === 0) {
      return new Map<
        string,
        {
          orderCount: number;
          selectableOrderCount: number;
          blockedOrderCount: number;
          errorCount: number;
          warningCount: number;
          materialSyncCount: number;
          materialSyncPreview: string[];
        }
      >();
    }

    const rows = await this.prisma.orderImportRow.findMany({
      where: { sessionId: { in: sessionIds } },
      select: orderImportRowPreviewSelect
    });
    if (rows.length === 0) {
      return new Map();
    }

    const sortedRows = [...rows].sort((left, right) => {
      const sessionCompare = String(left.sessionId || '').localeCompare(String(right.sessionId || ''));
      if (sessionCompare !== 0) {
        return sessionCompare;
      }
      const orderCompare = String(left.orderNo || '').localeCompare(String(right.orderNo || ''));
      if (orderCompare !== 0) {
        return orderCompare;
      }
      const fileCompare = (left.file?.createdAt?.getTime() || 0) - (right.file?.createdAt?.getTime() || 0);
      if (fileCompare !== 0) {
        return fileCompare;
      }
      const fileIdCompare = String(left.file?.id || left.fileId || '').localeCompare(String(right.file?.id || right.fileId || ''));
      if (fileIdCompare !== 0) {
        return fileIdCompare;
      }
      return left.sourceRowNo - right.sourceRowNo;
    });
    const normalizedRows = this.normalizeImportRowsForSessionPreview(sortedRows);
    const customerLookup = await this.findEnabledCustomersForImport(normalizedRows.map((row) => row.customerName));
    const draftRows = normalizedRows.filter((row) => sessionStatusById.get(row.sessionId) === 'DRAFT');
    const existingOrderNos =
      draftRows.length > 0 ? await this.findExistingOrderNosForImport(draftRows.map((row) => row.orderNo)) : new Set<string>();
    const activeProcessKeys = await this.activeProcessNameKeys();
    const rowsBySessionId = new Map<string, typeof rows>();
    for (const row of normalizedRows) {
      const sessionRows = rowsBySessionId.get(row.sessionId) || [];
      sessionRows.push(row);
      rowsBySessionId.set(row.sessionId, sessionRows);
    }

    const statsBySessionId = new Map<
      string,
      {
        orderCount: number;
        selectableOrderCount: number;
        blockedOrderCount: number;
        errorCount: number;
        warningCount: number;
        materialSyncCount: number;
        materialSyncPreview: string[];
      }
    >();
    for (const [sessionId, sessionRows] of rowsBySessionId.entries()) {
      const orderGroups = new Map<string, typeof sessionRows>();
      for (const row of sessionRows) {
        const key = row.orderNo || `ROW-${row.id}`;
        const group = orderGroups.get(key) || [];
        group.push(row);
        orderGroups.set(key, group);
      }
      const sessionExistingOrderNos = sessionStatusById.get(sessionId) === 'DRAFT' ? existingOrderNos : new Set<string>();
      const orders = [...orderGroups.entries()].map(([orderNo, orderRows]) =>
        this.buildImportOrderPreview(orderNo, orderRows, customerLookup, sessionExistingOrderNos, activeProcessKeys, {
          includeRows: false
        })
      );
      const orderCount = orders.length;
      const selectableOrderCount = orders.filter((order) => order.errorCount === 0).length;
      const selectableOrderNos = new Set(
        orders.filter((order) => order.errorCount === 0).map((order) => this.normalizeOrderNo(order.orderNo))
      );
      const materialSyncSummary = this.materialSyncSummaryFromPartCodes(
        sessionRows
          .filter((row) => selectableOrderNos.has(this.normalizeOrderNo(row.orderNo)))
          .map((row) => row.partCode)
      );
      statsBySessionId.set(sessionId, {
        orderCount,
        selectableOrderCount,
        blockedOrderCount: orderCount - selectableOrderCount,
        errorCount: orders.reduce((sum, order) => sum + order.errorCount, 0),
        warningCount: orders.reduce((sum, order) => sum + order.warningCount, 0),
        materialSyncCount: materialSyncSummary.materialSyncCount,
        materialSyncPreview: materialSyncSummary.materialSyncPreview
      });
    }

    return statsBySessionId;
  }

  private async findCurrentImportCommittedOrderNosBySessionIds(sessionIds: string[]) {
    const result = new Map<string, string[]>();
    const uniqueSessionIds = [...new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))];
    if (uniqueSessionIds.length === 0) {
      return result;
    }

    const rows = await this.prisma.$queryRaw<Array<{ sourceImportSessionId: string; orderNo: string }>>(Prisma.sql`
      SELECT DISTINCT
        line."sourceImportSessionId",
        customer_order."orderNo"
      FROM "OrderLine" AS line
      INNER JOIN "CustomerOrder" AS customer_order ON customer_order."id" = line."orderId"
      WHERE line."sourceImportSessionId" IN (${Prisma.join(uniqueSessionIds)})
      ORDER BY line."sourceImportSessionId" ASC, customer_order."orderNo" ASC
    `);

    for (const row of rows) {
      const orderNos = result.get(row.sourceImportSessionId) || [];
      orderNos.push(row.orderNo);
      result.set(row.sourceImportSessionId, orderNos);
    }
    return result;
  }

  private async findCurrentImportCommittedOrderNoSummariesBySessionIds(sessionIds: string[], previewLimit = 5) {
    const result = new Map<string, { count: number; preview: string[] }>();
    const uniqueSessionIds = [...new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))];
    if (uniqueSessionIds.length === 0) {
      return result;
    }
    const safePreviewLimit = Math.max(1, Math.min(Math.floor(previewLimit), 20));

    const rows = await this.prisma.$queryRaw<
      Array<{ sourceImportSessionId: string; orderNo: string; orderCount: number | bigint }>
    >(Prisma.sql`
      WITH "distinctOrders" AS (
        SELECT DISTINCT
          order_line."sourceImportSessionId",
          customer_order."orderNo"
        FROM "OrderLine" AS order_line
        INNER JOIN "CustomerOrder" AS customer_order ON customer_order."id" = order_line."orderId"
        WHERE order_line."sourceImportSessionId" IN (${Prisma.join(uniqueSessionIds)})
      ),
      "rankedOrders" AS (
        SELECT
          "sourceImportSessionId",
          "orderNo",
          COUNT(*) OVER (PARTITION BY "sourceImportSessionId") AS "orderCount",
          ROW_NUMBER() OVER (PARTITION BY "sourceImportSessionId" ORDER BY "orderNo" ASC) AS "rowNo"
        FROM "distinctOrders"
      )
      SELECT "sourceImportSessionId", "orderNo", "orderCount"
      FROM "rankedOrders"
      WHERE "rowNo" <= ${safePreviewLimit}
      ORDER BY "sourceImportSessionId" ASC, "rowNo" ASC
    `);

    for (const row of rows) {
      const summary = result.get(row.sourceImportSessionId) || { count: Number(row.orderCount || 0), preview: [] };
      summary.count = Number(row.orderCount || summary.count || 0);
      summary.preview.push(row.orderNo);
      result.set(row.sourceImportSessionId, summary);
    }
    return result;
  }

  private async buildImportSessionPreview(sessionId: string, options: ImportPreviewPageOptions = {}) {
    const session = await this.prisma.orderImportSession.findUnique({
      where: { id: sessionId },
      include: {
        files: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }
      }
    });
    if (!session) {
      throw new NotFoundException('导入会话不存在');
    }
    const committedOrderNos = this.importStringArray(session.committedOrderNos as Prisma.JsonValue | null);
    const currentCommittedOrderNosBySessionId =
      session.status === 'COMMITTED'
        ? await this.findCurrentImportCommittedOrderNosBySessionIds([sessionId])
        : new Map<string, string[]>();
    const currentCommittedOrderNos = currentCommittedOrderNosBySessionId.get(sessionId) || [];
    const previewToken = this.buildImportPreviewToken({
      sessionId: session.id,
      status: session.status,
      files: session.files
    });

    const sessionRows = await this.prisma.orderImportRow.findMany({
      where: { sessionId },
      select: orderImportRowPreviewSelect,
      orderBy: [{ orderNo: 'asc' }, { sourceRowNo: 'asc' }]
    });
    const fileOrder = new Map(session.files.map((file, index) => [file.id, index]));
    const fileNameById = new Map(session.files.map((file) => [file.id, this.importDisplayFileName(file.fileName)]));
    const sortedRows = [...(sessionRows as any[])].sort((left, right) => {
      const orderCompare = String(left.orderNo || '').localeCompare(String(right.orderNo || ''));
      if (orderCompare !== 0) {
        return orderCompare;
      }
      const fileCompare = (fileOrder.get(left.fileId) ?? 0) - (fileOrder.get(right.fileId) ?? 0);
      if (fileCompare !== 0) {
        return fileCompare;
      }
      return left.sourceRowNo - right.sourceRowNo;
    });

    const normalizedRows = this.normalizeImportRowsForSessionPreview(sortedRows);
    const customerLookup = await this.findEnabledCustomersForImport(normalizedRows.map((row) => row.customerName));
    const existingOrderNos =
      session.status === 'DRAFT' ? await this.findExistingOrderNosForImport(normalizedRows.map((row) => row.orderNo)) : new Set<string>();
    const activeProcessKeys = await this.activeProcessNameKeys();
    const orderGroups = new Map<string, any[]>();
    for (const row of normalizedRows) {
      const key = row.orderNo || `ROW-${row.id}`;
      const group = orderGroups.get(key) || [];
      group.push(row);
      orderGroups.set(key, group);
    }

    const orderEntries = Array.from(orderGroups.entries());
    const includeRows = options.includeRows !== false;
    const orderOffset = options.allOrders ? 0 : Math.min(options.orderOffset ?? 0, orderEntries.length);
    const orderLimit = options.allOrders ? orderEntries.length : options.orderLimit ?? 50;
    const visibleOrderEntries = options.allOrders ? orderEntries : orderEntries.slice(orderOffset, orderOffset + orderLimit);
    const orders = visibleOrderEntries.map(([orderNo, rows]) =>
      this.buildImportOrderPreview(orderNo, rows, customerLookup, existingOrderNos, activeProcessKeys, {
        includeRows,
        fileNameById
      })
    );
    const orderSummaries = options.allOrders
      ? orders
      : orderEntries.map(([orderNo, rows]) =>
          this.buildImportOrderPreview(orderNo, rows, customerLookup, existingOrderNos, activeProcessKeys, {
            includeRows: false
          })
        );
    const errorCount = orderSummaries.reduce((sum, order) => sum + order.errorCount, 0);
    const warningCount = orderSummaries.reduce((sum, order) => sum + order.warningCount, 0);
    const totalOrderCount = orderSummaries.length;
    const selectableOrderCount = orderSummaries.filter((order) => order.errorCount === 0).length;
    const selectableOrderNos = new Set(
      orderSummaries.filter((order) => order.errorCount === 0).map((order) => this.normalizeOrderNo(order.orderNo))
    );
    const materialSyncSummary = this.materialSyncSummaryFromPartCodes(
      normalizedRows
        .filter((row) => selectableOrderNos.has(this.normalizeOrderNo(row.orderNo)))
        .map((row) => row.partCode)
    );

    return {
      id: session.id,
      status: session.status,
      createdBy: session.createdBy,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      committedAt: session.committedAt,
      previewToken,
      committedOrderNos,
      currentCommittedOrderNos,
      files: session.files.map((file) => ({
        id: file.id,
        fileName: this.importDisplayFileName(file.fileName),
        sheetName: file.sheetName,
        rowCount: file.rowCount,
        acceptedRowCount: file.acceptedRowCount,
        duplicateRowCount: file.duplicateRowCount,
        createdAt: file.createdAt
      })),
      summary: {
        fileCount: session.files.length,
        rowCount: sessionRows.length,
        orderCount: totalOrderCount,
        selectableOrderCount,
        blockedOrderCount: totalOrderCount - selectableOrderCount,
        errorCount,
        warningCount,
        committedOrderCount: committedOrderNos.length,
        currentCommittedOrderCount: currentCommittedOrderNos.length,
        materialSyncCount: materialSyncSummary.materialSyncCount,
        materialSyncPreview: materialSyncSummary.materialSyncPreview,
        duplicateRowCount: session.files.reduce((sum, file) => sum + file.duplicateRowCount, 0)
      },
      orderPage: {
        offset: orderOffset,
        limit: orderLimit,
        loadedCount: orders.length,
        totalCount: totalOrderCount,
        hasMore: orderOffset + orders.length < totalOrderCount
      },
      orders
    };
  }

  private buildImportPreviewToken(input: {
    sessionId: string;
    status: string;
    files: Array<{
      id: string;
      fileHash: string;
      rowCount: number;
      acceptedRowCount: number;
      duplicateRowCount: number;
      createdAt: Date;
    }>;
  }) {
    const payload = {
      sessionId: input.sessionId,
      status: input.status,
      files: input.files.map((file) => ({
        id: file.id,
        fileHash: file.fileHash,
        rowCount: file.rowCount,
        acceptedRowCount: file.acceptedRowCount,
        duplicateRowCount: file.duplicateRowCount,
        createdAt: file.createdAt.toISOString()
      }))
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private normalizeImportRowsForSessionPreview(rows: any[]) {
    const rowsByOrder = new Map<string, any[]>();
    const normalizedRows = rows.map((row) => ({
      ...row,
      componentNo: this.normalizeImportComponentNo(row.componentNo || undefined),
      parentComponentNo: this.normalizeImportComponentNo(row.parentComponentNo || undefined)
    }));
    for (const row of normalizedRows) {
      const key = row.orderNo || `ROW-${row.id || row.sourceRowNo}`;
      const group = rowsByOrder.get(key) || [];
      group.push(row);
      rowsByOrder.set(key, group);
    }

    for (const group of rowsByOrder.values()) {
      let mainSequence = 0;
      let componentIndex = 0;
      let currentComponentNo = '';
      const componentSequence = new Map<string, string>();
      const componentDemand = new Map<string, number>();
      const childCounts = new Map<string, number>();

      for (const row of group) {
        const lineType = row.lineType === 'COMPONENT' ? 'COMPONENT' : 'PART';
        const orderQuantity = decimalToNumber(row.orderQuantity);
        const unitUsage = decimalToNumber(row.unitUsage);
        let demandQuantity = decimalToNumber(row.demandQuantity);

        if (lineType === 'COMPONENT') {
          mainSequence += 1;
          componentIndex += 1;
          if (!row.componentNo) {
            row.componentNo = `C${String(componentIndex).padStart(3, '0')}`;
          }
          if (!row.importSequence) {
            row.importSequence = String(mainSequence);
          }
          if (demandQuantity <= 0) {
            const calculatedDemand = this.calculateImportDemand(orderQuantity, unitUsage);
            if (calculatedDemand) {
              demandQuantity = calculatedDemand;
              row.demandQuantity = calculatedDemand;
            }
          }
          currentComponentNo = row.componentNo;
          componentSequence.set(row.componentNo, String(row.importSequence || mainSequence));
          if (demandQuantity > 0) {
            componentDemand.set(row.componentNo, demandQuantity);
            row.issues = this.removeResolvedImportDemandIssue(row.issues);
          }
          continue;
        }

        if (this.shouldAutoBindImportParent(row, currentComponentNo)) {
          row.parentComponentNo = currentComponentNo;
        }

        if (row.parentComponentNo) {
          const childCount = (childCounts.get(row.parentComponentNo) || 0) + 1;
          childCounts.set(row.parentComponentNo, childCount);
          const parentSequence = componentSequence.get(row.parentComponentNo);
          if (!row.importSequence && parentSequence) {
            row.importSequence = `${parentSequence}.${childCount}`;
          }
          if (demandQuantity <= 0 && unitUsage > 0 && componentDemand.has(row.parentComponentNo)) {
            demandQuantity = this.roundQuantity((componentDemand.get(row.parentComponentNo) || 0) * unitUsage);
            row.demandQuantity = demandQuantity;
          }
          if (demandQuantity > 0) {
            row.issues = this.removeResolvedImportDemandIssue(row.issues);
          }
          continue;
        }

        currentComponentNo = '';
        mainSequence += 1;
        if (!row.importSequence) {
          row.importSequence = String(mainSequence);
        }
        if (demandQuantity <= 0) {
          const calculatedDemand = this.calculateImportDemand(orderQuantity, unitUsage);
          if (calculatedDemand) {
            demandQuantity = calculatedDemand;
            row.demandQuantity = calculatedDemand;
            row.issues = this.removeResolvedImportDemandIssue(row.issues);
          }
        }
      }
    }

    return normalizedRows;
  }

  private removeResolvedImportDemandIssue(value: Prisma.JsonValue | OrderImportIssue[] | null | undefined) {
    return this.importIssueArray((value ?? null) as Prisma.JsonValue | null).filter((issue) => issue.code !== 'DEMAND_QUANTITY_REQUIRED');
  }

  private buildImportOrderPreview(
    orderNo: string,
    rows: any[],
    customerLookup: Map<string, any[]>,
    existingOrderNos: Set<string>,
    activeProcessKeys: Set<string>,
    options: { includeRows?: boolean; fileNameById?: Map<string, string> } = {}
  ) {
    const includeRows = options.includeRows !== false;
    const first = rows[0];
    const orderIssues: OrderImportIssue[] = [];
    const customerRows = customerLookup.get(this.importCustomerKey(first.customerName)) || [];
    if (customerRows.length === 0) {
      orderIssues.push({ severity: 'ERROR', code: 'CUSTOMER_NOT_FOUND', message: `客户“${first.customerName}”不存在或未启用` });
    } else if (customerRows.length > 1) {
      orderIssues.push({ severity: 'ERROR', code: 'CUSTOMER_NOT_UNIQUE', message: `客户“${first.customerName}”匹配到多条资料` });
    }
    if (existingOrderNos.has(orderNo)) {
      orderIssues.push({ severity: 'ERROR', code: 'ORDER_NO_EXISTS', message: `订单号 ${orderNo} 已存在或已被占用` });
    }
    const normalizedOrderDate = this.formatImportDateOnly(first.orderDate);
    if (
      rows.some(
        (row) =>
          row.customerName !== first.customerName ||
          this.formatImportDateOnly(row.orderDate) !== normalizedOrderDate ||
          (row.projectModel || '') !== (first.projectModel || '')
      )
    ) {
      orderIssues.push({ severity: 'ERROR', code: 'ORDER_META_CONFLICT', message: '同一订单编号内客户、制单日期或项目型号不一致' });
    }

    const componentRows = rows.filter((row) => row.lineType === 'COMPONENT' && row.componentNo);
    const componentNos = new Set<string>();
    const duplicateComponentNos = new Set<string>();
    const componentDemand = new Map<string, number>();
    const importSequenceCounts = new Map<string, number>();
    const importLineKeyCounts = new Map<string, number>();
    for (const row of componentRows) {
      if (componentNos.has(row.componentNo)) {
        duplicateComponentNos.add(row.componentNo);
      }
      componentNos.add(row.componentNo);
      componentDemand.set(row.componentNo, decimalToNumber(row.demandQuantity));
    }
    for (const row of rows) {
      const importSequence = String(row.importSequence || '').trim();
      if (!importSequence) {
        continue;
      }
      importSequenceCounts.set(importSequence, (importSequenceCounts.get(importSequence) || 0) + 1);
      const importLineKey = this.importLineDuplicateKey(row, importSequence);
      importLineKeyCounts.set(importLineKey, (importLineKeyCounts.get(importLineKey) || 0) + 1);
    }
    const duplicateImportSequences = new Set(
      [...importSequenceCounts.entries()].filter(([, count]) => count > 1).map(([importSequence]) => importSequence)
    );
    const duplicateImportLineKeys = new Set(
      [...importLineKeyCounts.entries()].filter(([, count]) => count > 1).map(([importLineKey]) => importLineKey)
    );

    let errorCount = 0;
    let warningCount = 0;
    const previewRows = [];
    for (const row of rows) {
      const issues = [...this.importIssueArray(row.issues), ...orderIssues];
      const importSequence = String(row.importSequence || '').trim();
      const importLineKey = importSequence ? this.importLineDuplicateKey(row, importSequence) : '';
      if (row.lineType === 'COMPONENT' && !row.componentNo) {
        issues.push({ severity: 'ERROR', code: 'COMPONENT_NO_REQUIRED', message: '组件行必须填写组件编号' });
      }
      if (row.lineType === 'COMPONENT' && row.parentComponentNo) {
        issues.push({
          severity: 'ERROR',
          code: 'COMPONENT_PARENT_NOT_ALLOWED',
          message: '组件行不能填写所属组件编号；所属组件编号只用于组件下面的零件'
        });
      }
      if (row.lineType === 'PART' && row.componentNo) {
        issues.push({
          severity: 'ERROR',
          code: 'PART_COMPONENT_NO_NOT_ALLOWED',
          message: '零件行不能填写组件编号；如属于组件，请填写所属组件编号'
        });
      }
      if (row.componentNo && duplicateComponentNos.has(row.componentNo)) {
        issues.push({ severity: 'ERROR', code: 'DUPLICATE_COMPONENT_NO', message: `同一订单内组件编号 ${row.componentNo} 重复` });
      }
      if (importLineKey && duplicateImportLineKeys.has(importLineKey)) {
        issues.push({
          severity: 'ERROR',
          code: 'DUPLICATE_IMPORT_LINE',
          message: `同一订单内自动序号 ${importSequence} 和物料 ${row.partCode} 重复，请删除重复文件或调整清单后重新导入`
        });
      } else if (importSequence && duplicateImportSequences.has(importSequence)) {
        issues.push({
          severity: 'WARNING',
          code: 'DUPLICATE_IMPORT_SEQUENCE',
          message: `同一订单内自动序号 ${importSequence} 重复，请确认是否为分批上传后未重新编号`
        });
      }
      if (row.lineType === 'PART' && row.parentComponentNo && !componentNos.has(row.parentComponentNo)) {
        issues.push({ severity: 'ERROR', code: 'PARENT_COMPONENT_NOT_FOUND', message: `所属组件编号 ${row.parentComponentNo} 在当前订单内不存在` });
      }
      this.pushImportQuantityIssue(row, componentDemand, issues);
      const processNames = this.splitProcessRoute(row.processRoute);
      const missingProcessNames = processNames.filter((name) => !activeProcessKeys.has(normalizeSearchKeyword(name)));
      if (missingProcessNames.length > 0) {
        issues.push({
          severity: 'WARNING',
          code: 'PROCESS_DEFINITION_MISSING',
          message: `工序未维护：${missingProcessNames.join('、')}；导入草稿会保留备注，正式工序需在 ERP 中确认`
        });
      }
      const counts = this.countImportIssues(issues);
      errorCount += counts.errorCount;
      warningCount += counts.warningCount;
      if (includeRows) {
        previewRows.push({
          id: row.id,
          sourceImportSessionId: row.sessionId,
          sourceImportFileId: row.fileId,
          sourceFileName: this.importDisplayFileName(row.file?.fileName || options.fileNameById?.get(row.fileId)),
          sourceRowNo: row.sourceRowNo,
          orderBlock: row.orderBlock,
          orderNo: row.orderNo,
          lineType: row.lineType,
          importSequence: row.importSequence,
          partCategory: row.partCategory,
          componentNo: row.componentNo,
          parentComponentNo: row.parentComponentNo,
          partCode: row.partCode,
          drawingNo: row.drawingNo,
          partName: row.partName,
          partSpecification: row.partSpecification,
          partThickness: decimalToNumber(row.partThickness),
          orderQuantity: row.orderQuantity === null || row.orderQuantity === undefined ? undefined : decimalToNumber(row.orderQuantity),
          unitUsage: row.unitUsage === null || row.unitUsage === undefined ? undefined : decimalToNumber(row.unitUsage),
          demandQuantity: decimalToNumber(row.demandQuantity),
          unit: row.unit,
          processRoute: row.processRoute,
          processRemark: row.processRemark,
          projectModel: row.projectModel,
          drawingDate: row.drawingDate ? this.formatDateOnly(row.drawingDate) : undefined,
          drawingStatus: row.drawingStatus,
          issues
        });
      }
    }

    return {
      orderNo,
      orderDate: this.formatImportDateOnly(first.orderDate),
      customerName: first.customerName,
      customerId: customerRows.length === 1 ? customerRows[0].id : undefined,
      projectModel: first.projectModel,
      rowCount: rows.length,
      errorCount,
      warningCount,
      issues: orderIssues,
      rows: previewRows
    };
  }

  private importLineDuplicateKey(row: any, importSequence: string) {
    return [
      importSequence,
      row.lineType || '',
      String(row.partCode || '').trim().toLocaleUpperCase(),
      String(row.drawingNo || '').trim().toLocaleUpperCase(),
      String(row.partName || '').trim()
    ].join('|');
  }

  private pushImportQuantityIssue(row: any, componentDemand: Map<string, number>, issues: OrderImportIssue[]) {
    const demandQuantity = decimalToNumber(row.demandQuantity);
    const orderQuantity = row.orderQuantity === null || row.orderQuantity === undefined ? null : decimalToNumber(row.orderQuantity);
    const unitUsage = row.unitUsage === null || row.unitUsage === undefined ? null : decimalToNumber(row.unitUsage);
    let expected: number | null = null;
    if (row.parentComponentNo && unitUsage && componentDemand.has(row.parentComponentNo)) {
      expected = this.roundQuantity((componentDemand.get(row.parentComponentNo) || 0) * unitUsage);
    } else if (orderQuantity && unitUsage) {
      expected = this.roundQuantity(orderQuantity * unitUsage);
    } else if (orderQuantity && !row.parentComponentNo) {
      expected = this.roundQuantity(orderQuantity);
    }
    if (expected !== null && Math.abs(expected - demandQuantity) > 0.001) {
      issues.push({
        severity: 'ERROR',
        code: 'DEMAND_QUANTITY_MISMATCH',
        message: `需求数量应为 ${expected}，当前为 ${demandQuantity}`
      });
    }
  }

  private importIssueArray(value: Prisma.JsonValue | null): OrderImportIssue[] {
    return Array.isArray(value) ? (value as OrderImportIssue[]) : [];
  }

  private importStringArray(value: Prisma.JsonValue | null) {
    if (!Array.isArray(value)) {
      return [];
    }
    const result: string[] = [];
    for (const item of value) {
      const normalized = String(item || '').trim();
      if (normalized) {
        result.push(normalized);
      }
    }
    return result;
  }

  private countImportIssues(issues: OrderImportIssue[]) {
    let errorCount = 0;
    let warningCount = 0;
    for (const issue of issues) {
      if (issue.severity === 'ERROR') {
        errorCount += 1;
      } else if (issue.severity === 'WARNING') {
        warningCount += 1;
      }
    }
    return { errorCount, warningCount };
  }

  private async findEnabledCustomersForImport(customerNames: string[]) {
    const nameByKey = new Map<string, string>();
    for (const rawName of customerNames) {
      const name = rawName.trim();
      if (!name) {
        continue;
      }
      const key = this.importCustomerKey(name);
      if (!nameByKey.has(key)) {
        nameByKey.set(key, name);
      }
    }

    const customerLookup = new Map<
      string,
      Array<{
        id: string;
        customerName: string;
        customerCode: string;
      }>
    >([...nameByKey.keys()].map((key) => [key, []]));

    for (const names of this.chunkValues([...nameByKey.values()], 200)) {
      const customers = await this.prisma.customer.findMany({
        where: {
          status: CommonStatus.ENABLED,
          OR: names.map((name) => ({ customerName: { equals: name, mode: 'insensitive' as const } }))
        },
        select: { id: true, customerName: true, customerCode: true }
      });
      for (const customer of customers) {
        const key = this.importCustomerKey(customer.customerName);
        customerLookup.get(key)?.push(customer);
      }
    }

    return customerLookup;
  }

  private importCustomerKey(name: string) {
    return name.trim().toLocaleLowerCase();
  }

  private async findExistingOrderNosForImport(orderNos: string[], client: Prisma.TransactionClient = this.prisma) {
    const normalizedOrderNos = [...new Set(orderNos.map((orderNo) => orderNo.trim().toUpperCase()).filter(Boolean))];
    if (normalizedOrderNos.length === 0) {
      return new Set<string>();
    }
    const existingOrderNos = new Set<string>();
    for (const chunk of this.chunkValues(normalizedOrderNos, 200)) {
      const [reservations, orders] = await Promise.all([
        client.orderNoReservation.findMany({
          where: { orderNoNormalized: { in: chunk } },
          select: { orderNoNormalized: true }
        }),
        client.customerOrder.findMany({
          where: {
            OR: chunk.map((orderNo) => ({
              orderNo: { equals: orderNo, mode: 'insensitive' as const }
            }))
          },
          select: { orderNo: true }
        })
      ]);
      reservations.forEach((row) => existingOrderNos.add(row.orderNoNormalized));
      orders.forEach((row) => existingOrderNos.add(row.orderNo.trim().toUpperCase()));
    }
    return existingOrderNos;
  }

  private async activeProcessNameKeys() {
    const rows = await this.prisma.processDefinition.findMany({
      where: { status: CommonStatus.ENABLED },
      select: { processName: true }
    });
    return new Set(rows.map((row) => normalizeSearchKeyword(row.processName)));
  }

  private importRowToOrderLinePayload(row: any, activeProcessKeys: Set<string>): CreateOrderLineDto {
    const processNames = this.splitProcessRoute(row.processRoute);
    const processNamesAreActive = processNames.length > 0 && processNames.every((name) => activeProcessKeys.has(normalizeSearchKeyword(name)));
    const processSteps = processNamesAreActive
      ? processNames.map((processName, index) => ({
          processName,
          processRemark: index === processNames.length - 1 ? row.processRemark || undefined : undefined
        }))
      : [];
    const remarkParts = [];
    if (!processNamesAreActive && row.processRoute) {
      remarkParts.push(`Excel工艺路线：${row.processRoute}`);
    }
    if (!processNamesAreActive && row.processRemark) {
      remarkParts.push(`Excel工艺备注：${row.processRemark}`);
    }

    return {
      lineType: row.lineType,
      partCategory: row.partCategory || undefined,
      componentNo: row.componentNo || undefined,
      parentComponentNo: row.parentComponentNo || undefined,
      importSequence: row.importSequence || undefined,
      sourceImportSessionId: row.sourceImportSessionId || row.sessionId,
      sourceImportFileId: row.sourceImportFileId || row.fileId,
      sourceImportFileName: row.sourceFileName || undefined,
      sourceImportRowNo: row.sourceRowNo,
      projectModel: row.projectModel || undefined,
      drawingDate: row.drawingDate || undefined,
      drawingStatus: row.drawingStatus || undefined,
      partCode: row.partCode,
      partName: row.partName,
      drawingNo: row.drawingNo || undefined,
      partThickness: row.partThickness || 1,
      partSpecification: row.partSpecification || undefined,
      quantity: row.demandQuantity,
      productionPlanQuantity: row.demandQuantity,
      fulfillmentMode: OrderLineFulfillmentMode.PRODUCTION,
      unit: row.unit || '件',
      remark: remarkParts.join('；') || undefined,
      processSteps
    };
  }

  private splitProcessRoute(route?: string | null) {
    return String(route || '')
      .split(/[>＞/、,，;；\r\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private formatDateOnly(value?: Date | string | null) {
    if (!value) {
      return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatImportDateOnly(value?: Date | string | null) {
    if (!value) {
      return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()) || date.getFullYear() <= 1970) {
      return '';
    }
    return this.formatDateOnly(date);
  }

  private formatDateTime(value?: Date | string | null) {
    if (!value) {
      return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${this.formatDateOnly(date)} ${hours}:${minutes}`;
  }

  private async upsertMaterials(tx: Prisma.TransactionClient, lines: CreateOrderDto['lines']) {
    const materialMap = new Map<
      string,
      {
        partCode: string;
        partName: string;
        unit: string;
        partSpecification?: string;
      }
    >();

    for (const line of lines) {
      const partCode = line.partCode.trim();
      const partName = line.partName.trim();
      const unit = line.unit.trim();
      if (!partCode || !partName || !unit) {
        continue;
      }
      materialMap.set(partCode.toLocaleLowerCase(), {
        partCode,
        partName,
        unit,
        partSpecification: line.partSpecification?.trim() || undefined
      });
    }

    const materials = [...materialMap.values()];
    const existingMaterialByCode = new Map<string, { id: string; partSpecification: string | null }>();
    for (const chunk of this.chunkValues(materials, 200)) {
      const existingMaterials = await tx.material.findMany({
        where: {
          OR: chunk.map((material) => ({ partCode: { equals: material.partCode, mode: 'insensitive' as const } }))
        },
        select: { id: true, partCode: true, partSpecification: true }
      });
      for (const material of existingMaterials) {
        existingMaterialByCode.set(material.partCode.trim().toLocaleLowerCase(), {
          id: material.id,
          partSpecification: material.partSpecification
        });
      }
    }

    for (const material of materials) {
      const existing = existingMaterialByCode.get(material.partCode.trim().toLocaleLowerCase());
      if (existing) {
        await tx.material.update({
          where: { id: existing.id },
          data: {
            partName: material.partName,
            unit: material.unit,
            partSpecification: material.partSpecification ?? existing.partSpecification,
            status: 'ENABLED'
          }
        });
        continue;
      }

      // 新订单里出现的新零件同步进入物料基础清单，库存页才能在 0 库存时搜索到它。
      await tx.material.create({
        data: {
          partCode: material.partCode,
          partName: material.partName,
          unit: material.unit,
          partSpecification: material.partSpecification
        }
      });
    }
  }

  private async generateOrderNo(orderDate: Date) {
    const dateKey = orderDate.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `SO-${dateKey}-`;
    const [existingOrders, reservedOrderNos] = await Promise.all([
      this.prisma.customerOrder.findMany({
        where: { orderNo: { startsWith: prefix } },
        select: { orderNo: true }
      }),
      this.prisma.orderNoReservation.findMany({
        where: { orderNoNormalized: { startsWith: prefix } },
        select: { orderNoNormalized: true }
      })
    ]);
    const usedOrderNos = new Set([
      ...existingOrders.map((order) => this.normalizeOrderNo(order.orderNo)),
      ...reservedOrderNos.map((reservation) => this.normalizeOrderNo(reservation.orderNoNormalized))
    ]);

    // 自动生成时按日期前缀递增，并跳过所有已占用编号；取消订单的编号也会永久保留。
    for (let index = 1; index < 10000; index += 1) {
      const orderNo = `${prefix}${String(index).padStart(3, '0')}`;
      if (!usedOrderNos.has(orderNo)) {
        return orderNo;
      }
    }
    throw new BadRequestException('当前日期没有可用订单号');
  }

  private async reserveOrderNo(
    tx: Prisma.TransactionClient,
    orderNo: string,
    sourceOrderId?: string,
    reservedReason = 'ORDER_CREATED'
  ) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    try {
      await tx.orderNoReservation.create({
        data: {
          orderNo: normalizedOrderNo,
          orderNoNormalized: normalizedOrderNo,
          sourceOrderId,
          reservedReason
        }
      });
    } catch (error) {
      if (this.isDuplicateOrderNoReservationError(error)) {
        throw new BadRequestException(`订单号 ${normalizedOrderNo} 已被占用，请修改后再保存`);
      }
      throw error;
    }
  }

  private async linkOrderNoReservation(
    tx: Prisma.TransactionClient,
    orderNo: string,
    sourceOrderId: string,
    reservedReason = 'ORDER_CREATED'
  ) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    await tx.orderNoReservation.upsert({
      where: { orderNoNormalized: normalizedOrderNo },
      create: {
        orderNo: normalizedOrderNo,
        orderNoNormalized: normalizedOrderNo,
        sourceOrderId,
        reservedReason
      },
      update: {
        sourceOrderId,
        reservedReason
      }
    });
  }

  private async orderNoExists(orderNo: string, excludeOrderNo?: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    const normalizedExcludeOrderNo = excludeOrderNo?.trim() ? this.normalizeOrderNo(excludeOrderNo) : undefined;
    const reservation = await this.prisma.orderNoReservation.findFirst({
      where: {
        orderNoNormalized: normalizedOrderNo,
        NOT: normalizedExcludeOrderNo ? { orderNoNormalized: normalizedExcludeOrderNo } : undefined
      },
      select: { id: true }
    });
    if (reservation) {
      return true;
    }

    const existing = await this.prisma.customerOrder.findFirst({
      where: {
        // 订单号查重必须大小写不敏感，避免 SO-xxx 和 so-xxx 被当成两个订单。
        orderNo: { equals: normalizedOrderNo, mode: 'insensitive' },
        NOT: normalizedExcludeOrderNo ? { orderNo: { equals: normalizedExcludeOrderNo, mode: 'insensitive' } } : undefined
      },
      select: { orderNo: true }
    });
    return Boolean(existing);
  }

  private async ensureOrderNoAvailable(orderNo: string, excludeOrderNo?: string) {
    const normalizedOrderNo = this.normalizeOrderNo(orderNo);
    if (await this.orderNoExists(normalizedOrderNo, excludeOrderNo)) {
      throw new BadRequestException(`订单号 ${normalizedOrderNo} 已存在，请修改后再保存`);
    }
  }

  private normalizeOrderNo(orderNo: string) {
    // 手工输入订单号时统一转成大写，保证 URL、查重、生产任务编号使用同一套订单号。
    const normalizedOrderNo = orderNo.trim().toUpperCase();
    if (!normalizedOrderNo) {
      throw new BadRequestException('订单号不能为空');
    }
    return normalizedOrderNo;
  }

  private isDuplicateOrderNoError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (Array.isArray(error.meta?.target)
        ? error.meta.target.includes('orderNo')
        : JSON.stringify(error.meta || {}).includes('CustomerOrder_orderNo_lower_key'))
    );
  }

  private isDuplicateOrderNoReservationError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (Array.isArray(error.meta?.target)
        ? error.meta.target.includes('orderNoNormalized')
        : JSON.stringify(error.meta || {}).includes('OrderNoReservation_orderNoNormalized_key'))
    );
  }

  private validateOrderLines(lines: CreateOrderDto['lines'], options: { requireStockSources?: boolean } = {}) {
    // 新增订单默认给 3 行方便录入，但允许删除误填行；业务上只要求订单至少保留 1 个零件。
    if (!lines || lines.length < 1) {
      throw new BadRequestException('订单至少需要一个零件');
    }

    lines.forEach((line, index) => {
      this.validateSingleOrderLine(line, `第 ${index + 1} 个零件`, Boolean(options.requireStockSources));
    });
    this.validateOrderLineComponentStructure(lines);
  }

  private validateOrderLineComponentStructure(lines: CreateOrderDto['lines']) {
    const componentNos = new Map<string, number>();
    const duplicateNos = new Set<string>();

    lines.forEach((line, index) => {
      const label = `第 ${index + 1} 个零件`;
      const lineType = line.lineType || 'PART';
      const componentNo = this.normalizeEditableComponentNo(line.componentNo);
      const parentComponentNo = this.normalizeEditableComponentNo(line.parentComponentNo);

      if (lineType === 'COMPONENT') {
        if (!componentNo) {
          throw new BadRequestException(`${label}是组件行，必须填写组件编号`);
        }
        if (parentComponentNo) {
          throw new BadRequestException(`${label}是组件行，不能填写所属组件`);
        }
        if (componentNos.has(componentNo)) {
          duplicateNos.add(componentNo);
        }
        componentNos.set(componentNo, index + 1);
        return;
      }

      if (componentNo) {
        throw new BadRequestException(`${label}是零件行，不能填写组件编号；如属于组件，请填写所属组件`);
      }
    });

    if (duplicateNos.size > 0) {
      throw new BadRequestException(`同一订单内组件编号重复：${Array.from(duplicateNos).join('、')}`);
    }

    lines.forEach((line, index) => {
      const lineType = line.lineType || 'PART';
      const parentComponentNo = this.normalizeEditableComponentNo(line.parentComponentNo);
      if (lineType === 'PART' && parentComponentNo && !componentNos.has(parentComponentNo)) {
        throw new BadRequestException(`第 ${index + 1} 个零件所属组件 ${parentComponentNo} 在当前订单内不存在`);
      }
    });
  }

  private normalizeEditableComponentNo(value?: string | null) {
    return value?.trim().toUpperCase() || '';
  }

  private normalizeEditableOrderLineComponentFields<T extends CreateOrderLineDto>(lines: T[]): T[] {
    return lines.map((line) => ({
      ...line,
      componentNo: this.normalizeEditableComponentNo(line.componentNo) || undefined,
      parentComponentNo: this.normalizeEditableComponentNo(line.parentComponentNo) || undefined
    }));
  }

  private validateSingleOrderLine(line: CreateOrderLineDto, label = 'Order line', requireStockSources = true) {
    if (!line.partCode?.trim() || !line.partName?.trim() || !line.unit?.trim()) {
      throw new BadRequestException(`${label}资料不完整`);
    }
    if (!Number.isFinite(Number(line.partThickness)) || Number(line.partThickness) <= 0) {
      throw new BadRequestException(`${label}厚度必须大于 0`);
    }
    const orderQuantity = this.normalizeQuantity(line.quantity, `${label} quantity`);
    const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
    const productionPlanQuantity = this.normalizeQuantity(
      this.resolveProductionPlanQuantity(line),
      `${label} production plan quantity`,
      true
    );
    if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      const selectedQuantity = this.selectedStockSourceQuantity(line);
      if (requireStockSources && selectedQuantity <= 0) {
        throw new BadRequestException(`${label}必须先选择库存批次并完成来源核对`);
      }
      if (selectedQuantity > orderQuantity + 0.0001) {
        throw new BadRequestException(`${label}已选库存数量超过客户订单数量：需要 ${orderQuantity}，已选 ${selectedQuantity}`);
      }
    }
    this.validateStockSourceSelectionQuantity(line, label, fulfillmentMode, orderQuantity, productionPlanQuantity, requireStockSources);
  }

  private persistedOrderLineToValidationDto(line: any): CreateOrderLineDto {
    // 提交生产必须基于数据库中的草稿明细重新校验，不能只依赖前端创建/编辑时的校验结果。
    return {
      partCode: line.partCode,
      partName: line.partName,
      drawingNo: line.drawingNo || undefined,
      drawingVersion: line.drawingVersion || undefined,
      drawingFileName: line.drawingFileName || undefined,
      drawingFileUrl: line.drawingFileUrl || undefined,
      partThickness: decimalToNumber(line.partThickness),
      partSpecification: line.partSpecification || undefined,
      quantity: decimalToNumber(line.quantity),
      productionPlanQuantity: decimalToNumber(line.productionPlanQuantity ?? 0),
      productionPlanOverrideByCode: line.productionPlanOverrideByCode || undefined,
      productionPlanOverrideReason: line.productionPlanOverrideReason || undefined,
      fulfillmentMode: this.normalizeFulfillmentMode(line.fulfillmentMode || undefined),
      unit: line.unit,
      deliveryDate: line.deliveryDate ? new Date(line.deliveryDate).toISOString().slice(0, 10) : undefined,
      remark: line.remark || undefined,
      lineType: line.lineType || 'PART',
      partCategory: line.partCategory || undefined,
      componentNo: this.normalizeEditableComponentNo(line.componentNo) || undefined,
      parentComponentNo: this.normalizeEditableComponentNo(line.parentComponentNo) || undefined,
      importSequence: line.importSequence || undefined,
      sourceImportSessionId: line.sourceImportSessionId || undefined,
      sourceImportFileId: line.sourceImportFileId || undefined,
      sourceImportFileName: line.sourceImportFileName || undefined,
      sourceImportRowNo: line.sourceImportRowNo || undefined,
      projectModel: line.projectModel || undefined,
      drawingDate: line.drawingDate ? new Date(line.drawingDate).toISOString().slice(0, 10) : undefined,
      drawingStatus: line.drawingStatus || undefined,
      processSteps: this.processRowsToSnapshots(line.processSteps || []),
      selectedStockSources: this.jsonToStockSourceSelections(line.stockSourceSelections)
    };
  }

  private validateStockSourceSelectionQuantity(
    line: CreateOrderLineDto,
    label: string,
    fulfillmentMode: OrderLineFulfillmentMode,
    orderQuantity: number,
    productionPlanQuantity: number,
    requireStockSources = true
  ) {
    const selectedSources = this.normalizeStockSourceSelections(line.selectedStockSources);
    if (fulfillmentMode !== OrderLineFulfillmentMode.STOCK && fulfillmentMode !== OrderLineFulfillmentMode.REWORK) {
      if (selectedSources.length === 0) {
        return;
      }
      throw new BadRequestException(`${label}不是使用库存或库存再加工，不能保留库存来源选择`);
    }

    const requiredQuantity = fulfillmentMode === OrderLineFulfillmentMode.STOCK ? orderQuantity : productionPlanQuantity;
    const selectedQuantity = selectedSources.reduce((sum, source) => sum + source.quantity, 0);
    if (selectedSources.length === 0 || selectedQuantity <= 0) {
      if (!requireStockSources) {
        return;
      }
      throw new BadRequestException(`${label}必须先选择库存批次并完成来源核对`);
    }
    this.validateSelectedStockSourceManualConfirmations(selectedSources);
    // 草稿允许库存来源暂存未选满；提交生产时 REWORK 才必须选满领料数量。
    if (requireStockSources && fulfillmentMode !== OrderLineFulfillmentMode.STOCK && selectedQuantity + 0.0001 < requiredQuantity) {
      throw new BadRequestException(`${label}已选库存数量少于本次需要数量：需要 ${requiredQuantity}，已选 ${selectedQuantity}`);
    }
    if (selectedQuantity > requiredQuantity + 0.0001) {
      throw new BadRequestException(`${label}已选库存数量超过本次需要数量：需要 ${requiredQuantity}，已选 ${selectedQuantity}`);
    }
  }

  private selectedStockSourceQuantity(line: { stockSourceSelections?: Prisma.JsonValue | null; selectedStockSources?: CreateOrderLineDto['selectedStockSources'] }) {
    const sources =
      'selectedStockSources' in line
        ? this.normalizeStockSourceSelections(line.selectedStockSources)
        : this.jsonToStockSourceSelections(line.stockSourceSelections);
    return this.roundQuantity(sources.reduce((sum, source) => sum + source.quantity, 0));
  }

  private async validateOrderStockSourceSelections(
    lines: CreateOrderDto['lines'],
    currentOrder?: StockReservationPriorityOrder,
    client: Prisma.TransactionClient | PrismaService = this.prisma
  ) {
    const selectedRows = lines.flatMap((line, lineIndex) =>
      this.normalizeStockSourceSelections(line.selectedStockSources).map((source) => ({ line, lineIndex, source }))
    );
    if (selectedRows.length === 0) {
      return;
    }

    const batchIds = [...new Set(selectedRows.map((row) => row.source.batchId))];
    const batches = await client.inventoryBatch.findMany({
      where: {
        id: { in: batchIds },
        sourceOrderId: null,
        quantity: { gt: 0 },
        status: 'AVAILABLE'
      },
      include: {
        sourceOrderLine: true,
        productionTask: { include: { orderLine: true } },
        reservations: {
          where: { status: InventoryReservationStatus.ACTIVE },
          include: {
            order: { select: { orderNo: true, customerName: true, orderDate: true } },
            orderLine: { select: { lineNo: true, partCode: true, partName: true } }
          },
          orderBy: [{ createdAt: 'asc' }]
        }
      }
    });
    const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
    const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(client, batchIds, currentOrder);
    const selectedQuantityByBatchId = new Map<string, number>();
    for (const { source } of selectedRows) {
      selectedQuantityByBatchId.set(
        source.batchId,
        this.roundQuantity((selectedQuantityByBatchId.get(source.batchId) || 0) + source.quantity)
      );
    }
    for (const [batchId, selectedQuantity] of selectedQuantityByBatchId) {
      const batch = batchMap.get(batchId);
      if (!batch) {
        continue;
      }
      const reservedQuantity = reservedQuantityByBatchId.get(batchId) || 0;
      const availableQuantity = this.roundQuantity(decimalToNumber(batch.quantity) - reservedQuantity);
      if (availableQuantity + 0.0001 < selectedQuantity) {
        throw new BadRequestException(
          `已选库存批次 ${batch.batchNo} 可用库存不足：${this.stockAvailabilitySummary(
            [{ ...batch, reservedByOtherOrders: reservedQuantity, availableQuantity: Math.max(availableQuantity, 0), selectedQuantity }],
            currentOrder?.id
          )}，本次合计选用 ${selectedQuantity}`
        );
      }
    }
    const usageCandidateBatches = await this.findAvailableStockUsageCandidateBatches(client, batches, currentOrder?.id);
    const sourceTaskMap = await this.findStockSourceTaskMapByBatches(client, usageCandidateBatches);

    for (const { line, lineIndex, source } of selectedRows) {
      const label = `第 ${lineIndex + 1} 个零件`;
      const batch = batchMap.get(source.batchId);
      if (!batch) {
        throw new BadRequestException(`${label}已选库存批次 ${source.batchNo || source.batchId} 不存在或当前不可用`);
      }
      if (batch.unit !== line.unit) {
        throw new BadRequestException(`${label}已选库存批次 ${batch.batchNo} 的单位 ${batch.unit} 与订单单位 ${line.unit} 不一致`);
      }
      const batchReservedQuantity = reservedQuantityByBatchId.get(batch.id) || 0;
      const batchAvailableQuantity = this.roundQuantity(decimalToNumber(batch.quantity) - batchReservedQuantity);
      if (batchAvailableQuantity + 0.0001 < source.quantity) {
        throw new BadRequestException(
          `${label}已选库存批次 ${batch.batchNo} 的使用数量超过当前可用库存：${this.stockAvailabilitySummary(
            [{ ...batch, reservedByOtherOrders: batchReservedQuantity, availableQuantity: Math.max(batchAvailableQuantity, 0), selectedQuantity: source.quantity }],
            currentOrder?.id
          )}`
        );
      }

      const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
      const lineSources = this.normalizeStockSourceSelections(line.selectedStockSources);
      const usageOrderIssue = this.stockSourceUsageOrderIssue(
        line,
        batch,
        sourceTaskMap,
        lineSources,
        usageCandidateBatches,
        currentOrder?.id
      );
      if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
        if (
          this.stockSourceSelectionNeedsManualConfirmation(line, batch, sourceTaskMap, lineSources, usageCandidateBatches, currentOrder?.id) &&
          !this.stockSourceManualConfirmationComplete(source)
        ) {
          throw new BadRequestException(
            `${label}已选库存批次 ${batch.batchNo} 需要填写人工确认记录${usageOrderIssue ? `：${usageOrderIssue}` : ''}`
          );
        }
        continue;
      }

      const needsReworkManualConfirmation =
        !this.stockBatchMatchesOrderLine(line, batch, sourceTaskMap) ||
        Boolean(usageOrderIssue);
      if (needsReworkManualConfirmation && !this.stockSourceManualConfirmationComplete(source)) {
        throw new BadRequestException(
          `${label}已选库存批次 ${batch.batchNo} 需要填写人工确认记录${usageOrderIssue ? `：${usageOrderIssue}` : ''}`
        );
      }
    }
  }

  private async activeReservationQuantityByBatchId(
    client: {
      inventoryReservation: {
        findMany: (args: any) => Promise<any[]>;
      };
      customerOrder?: {
        findUnique: (args: any) => Promise<any>;
      };
    },
    batchIds: string[],
    currentOrder?: string | StockReservationPriorityOrder
  ) {
    if (batchIds.length === 0) {
      return new Map<string, number>();
    }
    const currentPriorityOrder = await this.resolveStockReservationPriorityOrder(client, currentOrder);
    const rows = await client.inventoryReservation.findMany({
      where: {
        batchId: { in: batchIds },
        status: InventoryReservationStatus.ACTIVE,
        ...(currentPriorityOrder ? { orderId: { not: currentPriorityOrder.id } } : {})
      },
      select: {
        batchId: true,
        quantity: true,
        order: {
          select: {
            id: true,
            orderNo: true,
            status: true,
            createdAt: true
          }
        }
      }
    });
    const reservedQuantityByBatchId = new Map<string, number>();
    for (const row of rows) {
      if (!this.stockReservationConsumesAvailability(row.order, currentPriorityOrder)) {
        continue;
      }
      reservedQuantityByBatchId.set(
        row.batchId,
        this.roundQuantity((reservedQuantityByBatchId.get(row.batchId) || 0) + decimalToNumber(row.quantity))
      );
    }
    return reservedQuantityByBatchId;
  }

  private async resolveStockReservationPriorityOrder(
    client: { customerOrder?: { findUnique: (args: any) => Promise<any> } },
    currentOrder?: string | StockReservationPriorityOrder
  ) {
    if (!currentOrder) {
      return undefined;
    }
    if (typeof currentOrder !== 'string') {
      return currentOrder;
    }
    if (!client.customerOrder) {
      return undefined;
    }
    return (
      (await client.customerOrder.findUnique({
        where: { id: currentOrder },
        select: { id: true, orderNo: true, status: true, createdAt: true }
      })) || undefined
    );
  }

  private stockReservationConsumesAvailability(
    reservationOrder: StockReservationPriorityOrder,
    currentOrder?: StockReservationPriorityOrder
  ) {
    if (!currentOrder) {
      return true;
    }
    if (reservationOrder.id === currentOrder.id) {
      return false;
    }
    if (reservationOrder.status !== OrderStatus.DRAFT || currentOrder.status !== OrderStatus.DRAFT) {
      return true;
    }
    const createdAtDiff = reservationOrder.createdAt.getTime() - currentOrder.createdAt.getTime();
    if (createdAtDiff !== 0) {
      return createdAtDiff < 0;
    }
    return reservationOrder.orderNo.localeCompare(currentOrder.orderNo) < 0;
  }

  private async releaseOrderInventoryReservations(tx: Prisma.TransactionClient, orderId: string, reason: string) {
    await tx.inventoryReservation.updateMany({
      where: { orderId, status: InventoryReservationStatus.ACTIVE },
      data: {
        status: InventoryReservationStatus.RELEASED,
        statusReason: reason,
        releasedAt: new Date()
      }
    });
  }

  private reservationCarryoverKey(lineNo: number, batchId: string) {
    return `${lineNo}__${batchId}`;
  }

  private async findOrderReservationCarryovers(tx: Prisma.TransactionClient, orderId: string) {
    const reservations = await tx.inventoryReservation.findMany({
      where: { orderId, status: InventoryReservationStatus.ACTIVE },
      include: {
        orderLine: { select: { lineNo: true } }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const carryovers = new Map<string, InventoryReservationCarryover[]>();
    for (const reservation of reservations) {
      const lineNo = reservation.orderLine?.lineNo;
      if (!lineNo) {
        continue;
      }
      const key = this.reservationCarryoverKey(lineNo, reservation.batchId);
      const rows = carryovers.get(key) || [];
      rows.push({
        quantity: this.roundQuantity(decimalToNumber(reservation.quantity)),
        createdAt: reservation.createdAt
      });
      carryovers.set(key, rows);
    }
    return carryovers;
  }

  private buildReservationCreateRows(
    order: { id: string; orderNo: string },
    line: { id: string; lineNo: number; partCode: string; partName: string; unit: string },
    source: ReturnType<OrdersService['jsonToStockSourceSelections']>[number],
    carryovers: Map<string, InventoryReservationCarryover[]>
  ): Prisma.InventoryReservationCreateManyInput[] {
    const key = this.reservationCarryoverKey(line.lineNo, source.batchId);
    const sourceCarryovers = [...(carryovers.get(key) || [])];
    let remainingQuantity = this.roundQuantity(source.quantity);
    const rows: Prisma.InventoryReservationCreateManyInput[] = [];

    for (const carryover of sourceCarryovers) {
      if (remainingQuantity <= 0) {
        break;
      }
      const quantity = this.roundQuantity(Math.min(remainingQuantity, carryover.quantity));
      if (quantity <= 0) {
        continue;
      }
      rows.push({
        batchId: source.batchId,
        orderId: order.id,
        orderLineId: line.id,
        orderNo: order.orderNo,
        partCode: line.partCode,
        partName: line.partName,
        quantity,
        unit: line.unit,
        status: InventoryReservationStatus.ACTIVE,
        statusReason: 'DRAFT_ORDER_RESERVED',
        createdAt: carryover.createdAt
      });
      remainingQuantity = this.roundQuantity(remainingQuantity - quantity);
    }

    if (remainingQuantity > 0) {
      rows.push({
        batchId: source.batchId,
        orderId: order.id,
        orderLineId: line.id,
        orderNo: order.orderNo,
        partCode: line.partCode,
        partName: line.partName,
        quantity: remainingQuantity,
        unit: line.unit,
        status: InventoryReservationStatus.ACTIVE,
        statusReason: 'DRAFT_ORDER_RESERVED'
      });
    }

    return rows;
  }

  private async syncOrderInventoryReservations(
    tx: Prisma.TransactionClient,
    orderId: string,
    carryovers?: Map<string, InventoryReservationCarryover[]>
  ) {
    const order = await tx.customerOrder.findUnique({
      where: { id: orderId },
      include: { lines: { orderBy: { lineNo: 'asc' } } }
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }
    const reservationCarryovers = carryovers || (await this.findOrderReservationCarryovers(tx, order.id));
    await this.releaseOrderInventoryReservations(tx, order.id, 'SYNC_ORDER_RESERVATION');

    const selectedRows = order.lines.flatMap((line) => {
      const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
      if (fulfillmentMode !== OrderLineFulfillmentMode.STOCK && fulfillmentMode !== OrderLineFulfillmentMode.REWORK) {
        return [];
      }
      return this.jsonToStockSourceSelections(line.stockSourceSelections).map((source) => ({ line, source }));
    });
    if (selectedRows.length === 0) {
      return;
    }

    const batchIds = [...new Set(selectedRows.map((row) => row.source.batchId))];
    const batches = await tx.inventoryBatch.findMany({
      where: {
        id: { in: batchIds },
        sourceOrderId: null,
        quantity: { gt: 0 },
        status: 'AVAILABLE'
      },
      include: {
        reservations: {
          where: { status: InventoryReservationStatus.ACTIVE },
          include: {
            order: { select: { orderNo: true, customerName: true, orderDate: true } },
            orderLine: { select: { lineNo: true, partCode: true, partName: true } }
          },
          orderBy: [{ createdAt: 'asc' }]
        }
      }
    });
    const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
    const reservedQuantityByBatchId = await this.activeReservationQuantityByBatchId(tx, batchIds, order);
    const selectedQuantityByBatchId = new Map<string, number>();
    for (const { source } of selectedRows) {
      selectedQuantityByBatchId.set(
        source.batchId,
        this.roundQuantity((selectedQuantityByBatchId.get(source.batchId) || 0) + source.quantity)
      );
    }

    // 同一张草稿订单可能有多个零件共用一个库存批次，必须先按批次合计，再和扣除其他订单预占后的可用量比较。
    for (const [batchId, selectedQuantity] of selectedQuantityByBatchId) {
      const batch = batchMap.get(batchId);
      if (!batch) {
        throw new BadRequestException(`已选库存批次 ${batchId} 不存在或当前不可用`);
      }
      const reservedQuantity = reservedQuantityByBatchId.get(batchId) || 0;
      const availableQuantity = this.roundQuantity(decimalToNumber(batch.quantity) - reservedQuantity);
      if (availableQuantity + 0.0001 < selectedQuantity) {
        throw new BadRequestException(
          `库存批次 ${batch.batchNo} 可用库存不足：${this.stockAvailabilitySummary(
            [{ ...batch, reservedByOtherOrders: reservedQuantity, availableQuantity: Math.max(availableQuantity, 0), selectedQuantity }],
            order.id
          )}，本订单需要 ${selectedQuantity}`
        );
      }
    }

    const reservationRows = selectedRows.flatMap(({ line, source }) =>
      this.buildReservationCreateRows(order, line, source, reservationCarryovers)
    );
    if (reservationRows.length > 0) {
      await tx.inventoryReservation.createMany({ data: reservationRows });
    }
  }

  private async findStockSourceTaskMapByBatches(
    client: { productionTask: { findMany: (args: any) => Promise<any[]> } },
    batches: any[]
  ) {
    const taskNos = [...new Set(batches.map((batch) => batch.sourceProductionTaskNo).filter(Boolean))] as string[];
    if (taskNos.length === 0) {
      return new Map<string, any>();
    }
    const tasks = await client.productionTask.findMany({
      where: { productionTaskNo: { in: taskNos } },
      include: { orderLine: true }
    });
    return new Map(tasks.map((task) => [task.productionTaskNo, task]));
  }

  private normalizeFulfillmentMode(mode?: OrderLineFulfillmentMode | string) {
    if (!mode) {
      return OrderLineFulfillmentMode.PRODUCTION;
    }
    if (
      mode === OrderLineFulfillmentMode.PRODUCTION ||
      mode === OrderLineFulfillmentMode.STOCK ||
      mode === OrderLineFulfillmentMode.REWORK
    ) {
      return mode;
    }
    throw new BadRequestException('库存/生产方式无效');
  }

  private resolveProductionPlanQuantity(line: CreateOrderDto['lines'][number]) {
    const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
    if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      const suggestedQuantity = this.resolveStockSuggestedProductionQuantity(line);
      return line.productionPlanQuantity === undefined || line.productionPlanQuantity === null
        ? suggestedQuantity
        : this.roundQuantity(Number(line.productionPlanQuantity));
    }
    return line.productionPlanQuantity ?? line.quantity;
  }

  private resolveStockSuggestedProductionQuantity(line: {
    quantity: Prisma.Decimal | number | string | null | undefined;
    stockSourceSelections?: Prisma.JsonValue | null;
    selectedStockSources?: CreateOrderLineDto['selectedStockSources'];
  }) {
    return this.roundQuantity(Math.max(decimalToNumber(line.quantity) - this.selectedStockSourceQuantity(line), 0));
  }

  private resolveSuggestedProductionPlanQuantity(line: {
    fulfillmentMode?: OrderLineFulfillmentMode | string | null;
    quantity: Prisma.Decimal | number | string | null | undefined;
    stockSourceSelections?: Prisma.JsonValue | null;
    selectedStockSources?: CreateOrderLineDto['selectedStockSources'];
  }) {
    const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode || undefined);
    return fulfillmentMode === OrderLineFulfillmentMode.STOCK
      ? this.resolveStockSuggestedProductionQuantity(line)
      : this.roundQuantity(decimalToNumber(line.quantity));
  }

  private async prepareOrderLinePlans(lines: CreateOrderDto['lines']) {
    return Promise.all(lines.map((line, index) => this.prepareOrderLinePlan(line, `第 ${index + 1} 个零件`)));
  }

  private async prepareOrderLinePlan(line: CreateOrderDto['lines'][number], label: string): Promise<PreparedOrderLinePlan> {
    const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode);
    let productionPlanQuantity = this.normalizeQuantity(
      this.resolveProductionPlanQuantity(line),
      `${label} production plan quantity`,
      true
    );
    const suggestedQuantity = this.resolveSuggestedProductionPlanQuantity(line);
    const stockCoversCustomerQuantity =
      fulfillmentMode === OrderLineFulfillmentMode.STOCK &&
      suggestedQuantity <= 0 &&
      this.selectedStockSourceQuantity(line) + 0.0001 >= decimalToNumber(line.quantity);
    const hasExplicitProductionPlanOverride = Boolean(
      line.productionPlanOverrideByCode?.trim() || line.productionPlanOverrideReason?.trim()
    );
    if (stockCoversCustomerQuantity && productionPlanQuantity > 0 && !hasExplicitProductionPlanOverride) {
      productionPlanQuantity = suggestedQuantity;
    }

    if (Math.abs(productionPlanQuantity - suggestedQuantity) <= 0.0001) {
      return {
        productionPlanQuantity,
        productionPlanSuggestedQuantity: suggestedQuantity,
        productionPlanOverrideByCode: null,
        productionPlanOverrideByName: null,
        productionPlanOverrideByRole: null,
        productionPlanOverrideAt: null,
        productionPlanOverrideReason: null
      };
    }

    const reason = line.productionPlanOverrideReason?.trim();
    if (!reason) {
      throw new BadRequestException(`${label}生产计划数量与建议数量不一致，必须填写调整说明`);
    }
    const operator = await this.resolveSubmitPlanOperator(
      line.productionPlanOverrideByCode || '',
      '生产计划调整操作员'
    );
    return {
      productionPlanQuantity,
      productionPlanSuggestedQuantity: suggestedQuantity,
      productionPlanOverrideByCode: operator.accountId,
      productionPlanOverrideByName: operator.name,
      productionPlanOverrideByRole: operator.role,
      productionPlanOverrideAt: new Date(),
      productionPlanOverrideReason: reason
    };
  }

  private orderLinePlanData(plan: PreparedOrderLinePlan) {
    return {
      productionPlanQuantity: plan.productionPlanQuantity,
      productionPlanSuggestedQuantity: plan.productionPlanSuggestedQuantity,
      productionPlanOverrideByCode: plan.productionPlanOverrideByCode,
      productionPlanOverrideByName: plan.productionPlanOverrideByName,
      productionPlanOverrideByRole: plan.productionPlanOverrideByRole,
      productionPlanOverrideAt: plan.productionPlanOverrideAt,
      productionPlanOverrideReason: plan.productionPlanOverrideReason
    };
  }

  private orderLineImportData(line: CreateOrderLineDto) {
    return {
      lineType: line.lineType || 'PART',
      partCategory: line.partCategory?.trim() || null,
      componentNo: this.normalizeEditableComponentNo(line.componentNo) || null,
      parentComponentNo: this.normalizeEditableComponentNo(line.parentComponentNo) || null,
      importSequence: line.importSequence?.trim() || null,
      sourceImportSessionId: line.sourceImportSessionId?.trim() || null,
      sourceImportFileId: line.sourceImportFileId?.trim() || null,
      sourceImportFileName: this.importDisplayFileName(line.sourceImportFileName) || null,
      sourceImportRowNo: line.sourceImportRowNo || null,
      projectModel: line.projectModel?.trim() || null,
      drawingDate: line.drawingDate ? new Date(line.drawingDate) : null,
      drawingStatus: line.drawingStatus?.trim() || null
    };
  }

  private hasProductionPlanOverrideRecord(line: {
    productionPlanOverrideByCode?: string | null;
    productionPlanOverrideByName?: string | null;
    productionPlanOverrideByRole?: string | null;
    productionPlanOverrideAt?: Date | string | null;
    productionPlanOverrideReason?: string | null;
  }) {
    const overrideAt = line.productionPlanOverrideAt ? new Date(line.productionPlanOverrideAt) : null;
    return Boolean(
      line.productionPlanOverrideByCode?.trim() &&
        line.productionPlanOverrideByName?.trim() &&
        line.productionPlanOverrideByRole?.trim() &&
        overrideAt &&
        !Number.isNaN(overrideAt.getTime()) &&
        line.productionPlanOverrideReason?.trim()
    );
  }

  private resolveSubmittedProductionPlanQuantity(line: {
    fulfillmentMode?: OrderLineFulfillmentMode | string | null;
    quantity: Prisma.Decimal | number | string | null | undefined;
    productionPlanQuantity: Prisma.Decimal | number | string | null | undefined;
    stockSourceSelections?: Prisma.JsonValue | null;
    selectedStockSources?: CreateOrderLineDto['selectedStockSources'];
  }) {
    const fulfillmentMode = this.normalizeFulfillmentMode(line.fulfillmentMode || undefined);
    if (fulfillmentMode === OrderLineFulfillmentMode.STOCK) {
      return this.roundQuantity(decimalToNumber(line.productionPlanQuantity ?? 0));
    }
    return this.roundQuantity(decimalToNumber(line.productionPlanQuantity ?? line.quantity));
  }

  private roundQuantity(value: number) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  private normalizeQuantity(value: unknown, label: string, allowZero = false) {
    const quantity = this.roundQuantity(Number(value));
    if (!Number.isFinite(quantity)) {
      throw new BadRequestException(`${label}必须是有效数字`);
    }
    if (allowZero ? quantity < 0 : quantity <= 0) {
      throw new BadRequestException(
        allowZero ? `${label}不能小于 0` : `${label}必须大于 0`
      );
    }
    return quantity;
  }

  private async normalizeProcessSteps(steps: CreateOrderLineDto['processSteps'] | undefined, requireOne = false): Promise<ProcessStepSnapshot[]> {
    const normalized = processSnapshotToDetails(steps || []).filter((step) => step.processName);
    if (requireOne && normalized.length === 0) {
      throw new BadRequestException('至少需要一道生产工序');
    }

    const seen = new Set<string>();
    for (const step of normalized) {
      const key = normalizeSearchKeyword(step.processName);
      if (seen.has(key)) {
        throw new BadRequestException(`生产流程存在重复工序：${step.processName}`);
      }
      seen.add(key);
    }
    await this.processDefinitionsService.ensureActiveNames(normalized.map((step) => step.processName));

    return normalized;
  }

  private processRowsToSnapshots(steps: Array<{ processName: string; processRemark?: string | null }>): ProcessStepSnapshot[] {
    return processSnapshotToDetails(steps.map((step) => ({ processName: step.processName, processRemark: step.processRemark || '' })));
  }

  private processStepsToJson(steps: ProcessStepSnapshot[]): Prisma.InputJsonValue {
    return steps.map((step) => ({
      processName: step.processName,
      ...(step.processRemark ? { processRemark: step.processRemark } : {})
    })) as Prisma.InputJsonValue;
  }

  private normalizeStockSourceSelections(selections: CreateOrderLineDto['selectedStockSources'] | undefined) {
    const normalized = new Map<
      string,
      {
        batchId: string;
        batchNo?: string;
        partCode?: string;
        partName?: string;
        quantity: number;
        unit?: string;
        replenishmentSourceType?: string;
        replenishmentSourceRequestNo?: string;
        replenishmentSourceLabel?: string;
        compatibilityStatus?: 'MATCHED' | 'NEEDS_CONFIRMATION' | 'INCOMPLETE' | 'UNKNOWN';
        compatibilityReason?: string;
        manualConfirmedBy?: string;
        manualConfirmedAt?: string;
        manualConfirmRemark?: string;
      }
    >();
    for (const selection of selections || []) {
      const batchId = selection.batchId?.trim();
      const quantity = this.roundQuantity(Number(selection.quantity || 0));
      if (!batchId || quantity <= 0) {
        continue;
      }
      const current = normalized.get(batchId);
      normalized.set(batchId, {
        batchId,
        batchNo: selection.batchNo?.trim() || current?.batchNo,
        partCode: selection.partCode?.trim() || current?.partCode,
        partName: selection.partName?.trim() || current?.partName,
        quantity: this.roundQuantity((current?.quantity || 0) + quantity),
        unit: selection.unit?.trim() || current?.unit,
        replenishmentSourceType: selection.replenishmentSourceType?.trim() || current?.replenishmentSourceType,
        replenishmentSourceRequestNo: selection.replenishmentSourceRequestNo?.trim() || current?.replenishmentSourceRequestNo,
        replenishmentSourceLabel: selection.replenishmentSourceLabel?.trim() || current?.replenishmentSourceLabel,
        compatibilityStatus: selection.compatibilityStatus || current?.compatibilityStatus,
        compatibilityReason: selection.compatibilityReason?.trim() || current?.compatibilityReason,
        manualConfirmedBy: selection.manualConfirmedBy?.trim() || current?.manualConfirmedBy,
        manualConfirmedAt: selection.manualConfirmedAt?.trim() || current?.manualConfirmedAt,
        manualConfirmRemark: selection.manualConfirmRemark?.trim() || current?.manualConfirmRemark
      });
    }
    return [...normalized.values()];
  }

  private stockSourceSelectionsToJson(selections: CreateOrderLineDto['selectedStockSources'] | undefined): Prisma.InputJsonValue | undefined {
    const normalized = this.normalizeStockSourceSelections(selections);
    return normalized.length > 0 ? (normalized as Prisma.InputJsonValue) : undefined;
  }

  private jsonToStockSourceSelections(value: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }
    return this.normalizeStockSourceSelections(
      value.map((item) => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        return {
          batchId: String(row.batchId || ''),
          batchNo: row.batchNo ? String(row.batchNo) : undefined,
          partCode: row.partCode ? String(row.partCode) : undefined,
          partName: row.partName ? String(row.partName) : undefined,
          quantity: Number(row.quantity || 0),
          unit: row.unit ? String(row.unit) : undefined,
          replenishmentSourceType: row.replenishmentSourceType ? String(row.replenishmentSourceType) : undefined,
          replenishmentSourceRequestNo: row.replenishmentSourceRequestNo ? String(row.replenishmentSourceRequestNo) : undefined,
          replenishmentSourceLabel: row.replenishmentSourceLabel ? String(row.replenishmentSourceLabel) : undefined,
          compatibilityStatus: this.normalizeStockCompatibilityStatus(row.compatibilityStatus),
          compatibilityReason: row.compatibilityReason ? String(row.compatibilityReason) : undefined,
          manualConfirmedBy: row.manualConfirmedBy ? String(row.manualConfirmedBy) : undefined,
          manualConfirmedAt: row.manualConfirmedAt ? String(row.manualConfirmedAt) : undefined,
          manualConfirmRemark: row.manualConfirmRemark ? String(row.manualConfirmRemark) : undefined
        };
      })
    );
  }

  private normalizeStockCompatibilityStatus(value: unknown) {
    if (value === 'MATCHED' || value === 'NEEDS_CONFIRMATION' || value === 'INCOMPLETE' || value === 'UNKNOWN') {
      return value;
    }
    return undefined;
  }

  private async findDuplicateOrderLines(field: 'drawingNo' | 'drawingFileName', value: string, excludeOrderNo?: string) {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return [];
    }

    const where: Prisma.OrderLineWhereInput =
      field === 'drawingNo'
        ? { drawingNo: { equals: normalizedValue, mode: 'insensitive' } }
        : { drawingFileName: { equals: normalizedValue, mode: 'insensitive' } };

    if (excludeOrderNo?.trim()) {
      where.order = { orderNo: { not: this.normalizeOrderNo(excludeOrderNo) } };
    }

    const lines = await this.prisma.orderLine.findMany({
      where,
      include: {
        order: {
          select: {
            orderNo: true,
            customerName: true,
            orderDate: true
          }
        }
      },
      orderBy: [{ updatedAt: 'desc' }]
    });

    return lines.map((line) => ({
      orderNo: line.order.orderNo,
      customerName: line.order.customerName,
      orderDate: line.order.orderDate,
      partCode: line.partCode,
      partName: line.partName,
      drawingNo: line.drawingNo,
      drawingVersion: line.drawingVersion,
      drawingFileName: line.drawingFileName,
      drawingFileUrl: line.drawingFileUrl
    }));
  }

  private toSummary(order: any) {
    const quantityByUnit = this.toOrderQuantityByUnit(order.lines);
    const totalQuantity = quantityByUnit.reduce((sum, row) => sum + row.totalQuantity, 0);
    const totalProductionPlanQuantity = quantityByUnit.reduce((sum, row) => sum + row.totalProductionPlanQuantity, 0);
    const unresolvedShortageInfo = this.toOrderUnresolvedShortageInfo(order.productionTasks || []);

    return {
      id: order.id,
      orderNo: order.orderNo,
      customerId: order.customerId,
      customerCode: order.customerCode,
      customerName: order.customerName,
      // 订单下拉需要按客户中文、拼音、首字母和订单号搜索；搜索文本由后端统一生成，避免各页面规则分裂。
      customerSearchText: buildPinyinSearchText([order.orderNo, order.customerCode, order.customerName]),
      orderDate: order.orderDate,
      deliveryDate: order.deliveryDate,
      status: order.status,
      partCount: order.lines.length,
      totalQuantity,
      totalProductionPlanQuantity,
      quantityByUnit,
      unit: order.lines[0]?.unit || '件',
      productionStatus: this.toOrderProductionStatus(order),
      warehouseStage: this.toOrderWarehouseStage(order),
      ...unresolvedShortageInfo,
      remark: order.remark,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };
  }

  private toOrderUnresolvedShortageInfo(tasks: any[]) {
    const shortageRecords = this.toShortageRecords(tasks) as any[];
    const records = this.toEffectiveUnresolvedShortageRecords(tasks);
    const pendingProductionRecords = shortageRecords.filter((record) => this.isPendingProductionReplenishmentRecord(record));
    const unresolvedQuantityInfo = this.toShortageQuantityInfo(records);
    const pendingProductionQuantityInfo = this.toShortageQuantityInfo(pendingProductionRecords);

    return {
      unresolvedShortageLineCount: unresolvedQuantityInfo.lineCount,
      unresolvedShortageQuantity: unresolvedQuantityInfo.quantity,
      unresolvedShortageUnit: unresolvedQuantityInfo.unit,
      unresolvedShortageQuantityByUnit: unresolvedQuantityInfo.quantityByUnit,
      needsReplenishmentAction: records.length > 0,
      pendingProductionReplenishmentLineCount: pendingProductionQuantityInfo.lineCount,
      pendingProductionReplenishmentQuantity: pendingProductionQuantityInfo.quantity,
      pendingProductionReplenishmentUnit: pendingProductionQuantityInfo.unit,
      pendingProductionReplenishmentQuantityByUnit: pendingProductionQuantityInfo.quantityByUnit,
      needsProductionReplenishmentReview: pendingProductionRecords.length > 0
    };
  }

  private toShortageQuantityInfo(records: any[]) {
    const lineKeys = new Set(records.map((record) => record.orderLineId || record.productionTaskNo));
    const unitMap = new Map<string, number>();
    for (const record of records) {
      const unit = record.unit || '件';
      unitMap.set(unit, (unitMap.get(unit) || 0) + record.shortageQuantity);
    }
    const quantityByUnit = Array.from(unitMap.entries())
      .map(([unit, quantity]) => ({ unit, quantity: this.roundQuantity(quantity) }))
      .sort((left, right) => left.unit.localeCompare(right.unit, 'zh-Hans-CN'));

    return {
      lineCount: lineKeys.size,
      quantity: this.roundQuantity(records.reduce((sum, record) => sum + record.shortageQuantity, 0)),
      unit: quantityByUnit.length === 1 ? quantityByUnit[0].unit : undefined,
      quantityByUnit
    };
  }

  private toOrderQuantityByUnit(lines: any[]) {
    const unitMap = new Map<string, { unit: string; totalQuantity: number; totalProductionPlanQuantity: number }>();
    for (const line of lines) {
      const unit = line.unit || '件';
      const row = unitMap.get(unit) || { unit, totalQuantity: 0, totalProductionPlanQuantity: 0 };
      row.totalQuantity += decimalToNumber(line.quantity);
      row.totalProductionPlanQuantity += decimalToNumber(line.productionPlanQuantity ?? line.quantity);
      unitMap.set(unit, row);
    }
    // 订单可能包含不同计量单位，列表汇总必须按单位分组，避免把“件”和“米”等直接相加。
    return Array.from(unitMap.values()).sort((a, b) => a.unit.localeCompare(b.unit, 'zh-Hans-CN'));
  }

  private toOrderShippedQuantityByUnit(order: any) {
    const shippedQuantityByUnit = new Map<string, number>();
    const countedTransactionIds = new Set<string>();
    for (const line of order.lines || []) {
      for (const transaction of line.inventoryTransactions || []) {
        if (
          countedTransactionIds.has(transaction.id) ||
          transaction.transactionType !== InventoryTransactionType.OUT ||
          transaction.sourceRecordType !== 'InventoryBatch' ||
          transaction.orderNo !== order.orderNo
        ) {
          continue;
        }
        countedTransactionIds.add(transaction.id);
        const unit = transaction.unit || line.unit || '件';
        shippedQuantityByUnit.set(unit, (shippedQuantityByUnit.get(unit) || 0) + decimalToNumber(transaction.quantity));
      }
    }
    for (const batch of order.inventoryBatches || []) {
      if (!batch.sourceOrderId) {
        continue;
      }
      for (const transaction of batch.transactions || []) {
        if (
          countedTransactionIds.has(transaction.id) ||
          transaction.transactionType !== InventoryTransactionType.OUT ||
          transaction.sourceRecordType !== 'InventoryBatch' ||
          transaction.orderNo !== order.orderNo
        ) {
          continue;
        }
        countedTransactionIds.add(transaction.id);
        const unit = transaction.unit || batch.unit || '件';
        shippedQuantityByUnit.set(unit, (shippedQuantityByUnit.get(unit) || 0) + decimalToNumber(transaction.quantity));
      }
    }
    return shippedQuantityByUnit;
  }

  private allOrderQuantitiesReached(
    quantityByUnit: Array<{ unit: string; totalQuantity: number }>,
    actualQuantityByUnit: Map<string, number>
  ) {
    const targets = quantityByUnit.filter((row) => Number(row.totalQuantity || 0) > 0);
    if (targets.length === 0) {
      return false;
    }
    return targets.every((row) => (actualQuantityByUnit.get(row.unit || '件') || 0) + 0.0001 >= Number(row.totalQuantity || 0));
  }

  private totalQuantityFromUnitMap(quantityByUnit: Map<string, number>) {
    return Array.from(quantityByUnit.values()).reduce((sum, quantity) => sum + quantity, 0);
  }

  private toDetail(
    order: any,
    stockQuantityByTaskNo = new Map<string, number>(),
    stockSourceInfoByBatchId = new Map<string, ReturnType<OrdersService['toStockSourceSelectionInfo']>>(),
    importSourceFileByLineId = new Map<string, ReturnType<OrdersService['toImportSourceFileInfo']>>(),
    materialIdentityInfoByPartCode = new Map<string, OrderLineMaterialIdentityInfo>()
  ) {
    return {
      ...this.toSummary(order),
      customer: order.customer,
      lines: order.lines.map((line: any) => {
        const importSourceFile = importSourceFileByLineId.get(line.id);
        const materialIdentityInfo = materialIdentityInfoByPartCode.get(this.normalizedPartCodeKey(line.partCode));
        return {
        id: line.id,
        lineNo: line.lineNo,
        partCode: line.partCode,
        partName: line.partName,
        materialIdentityVariantCount: materialIdentityInfo?.variantCount || 1,
        materialHasIdentityConflict: Boolean(materialIdentityInfo && materialIdentityInfo.conflictFields.length > 0),
        materialIdentityConflictFields: materialIdentityInfo?.conflictFields || [],
        drawingNo: line.drawingNo,
        drawingVersion: line.drawingVersion,
        drawingFileName: line.drawingFileName,
        drawingFileUrl: line.drawingFileUrl,
        partThickness: decimalToNumber(line.partThickness),
        partSpecification: line.partSpecification,
        quantity: decimalToNumber(line.quantity),
        productionPlanQuantity: decimalToNumber(line.productionPlanQuantity ?? line.quantity),
        productionPlanSuggestedQuantity:
          line.productionPlanSuggestedQuantity === null || line.productionPlanSuggestedQuantity === undefined
            ? undefined
            : decimalToNumber(line.productionPlanSuggestedQuantity),
        productionPlanOverrideByCode: line.productionPlanOverrideByCode,
        productionPlanOverrideByName: line.productionPlanOverrideByName,
        productionPlanOverrideByRole: line.productionPlanOverrideByRole,
        productionPlanOverrideAt: line.productionPlanOverrideAt,
        productionPlanOverrideReason: line.productionPlanOverrideReason,
        fulfillmentMode: line.fulfillmentMode,
        lineType: line.lineType,
        partCategory: line.partCategory,
        componentNo: line.componentNo,
        parentComponentNo: line.parentComponentNo,
        importSequence: line.importSequence,
        sourceImportSessionId: line.sourceImportSessionId,
        sourceImportFileId: line.sourceImportFileId || importSourceFile?.id,
        sourceImportFileName: importSourceFile?.fileName || this.importDisplayFileName(line.sourceImportFileName),
        sourceImportFileUrl: importSourceFile?.fileUrl,
        sourceImportSheetName: importSourceFile?.sheetName,
        sourceImportFileAvailable: Boolean(importSourceFile?.fileUrl),
        sourceImportRowNo: line.sourceImportRowNo,
        projectModel: line.projectModel,
        drawingDate: line.drawingDate,
        drawingStatus: line.drawingStatus,
        unit: line.unit,
        deliveryDate: line.deliveryDate,
        remark: line.remark,
        selectedStockSources: this.enrichSelectedStockSources(
          this.jsonToStockSourceSelections(line.stockSourceSelections),
          stockSourceInfoByBatchId
        ),
        processSteps: this.processRowsToSnapshots(line.processSteps).map((step) => step.processName),
        processStepDetails: this.processRowsToSnapshots(line.processSteps),
        productionTasks: this.toLineProductionTasks(line.productionTasks || [], stockQuantityByTaskNo),
        ...this.toLineWarehouseInfo(line, stockQuantityByTaskNo, order.orderNo)
        };
      })
    };
  }

  private async getStockSourceInfoByBatchId(batchIds: string[], currentOrderId?: string) {
    const ids = [...new Set(batchIds.filter(Boolean))];
    if (ids.length === 0) {
      return new Map<string, ReturnType<OrdersService['toStockSourceSelectionInfo']>>();
    }

    const [batches, reservedQuantityByBatchId] = await Promise.all([
      this.prisma.inventoryBatch.findMany({
        where: { id: { in: ids } },
        include: { productionTask: true }
      }),
      this.activeReservationQuantityByBatchId(this.prisma, ids, currentOrderId)
    ]);

    return new Map(
      batches.map((batch) => [
        batch.id,
        this.toStockSourceSelectionInfo(batch, reservedQuantityByBatchId.get(batch.id) || 0)
      ])
    );
  }

  private toStockSourceSelectionInfo(batch: any, reservedByOtherOrders = 0) {
    const replenishmentSourceType = batch.replenishmentSourceType || batch.productionTask?.replenishmentSourceType || undefined;
    const replenishmentSourceRequestNo =
      batch.replenishmentSourceRequestNo || batch.productionTask?.replenishmentSourceRequestNo || undefined;
    const physicalQuantity = batch.status === 'AVAILABLE' ? decimalToNumber(batch.quantity) : 0;
    return {
      batchId: batch.id,
      batchNo: batch.batchNo,
      partCode: batch.partCode,
      partName: batch.partName,
      availableQuantity: Math.max(this.roundQuantity(physicalQuantity - reservedByOtherOrders), 0),
      unit: batch.unit,
      replenishmentSourceType,
      replenishmentSourceRequestNo,
      replenishmentSourceLabel: this.stockSourceReplenishmentSourceLabel(replenishmentSourceType, replenishmentSourceRequestNo)
    };
  }

  private enrichSelectedStockSources(
    selectedSources: ReturnType<OrdersService['jsonToStockSourceSelections']>,
    stockSourceInfoByBatchId: Map<string, ReturnType<OrdersService['toStockSourceSelectionInfo']>>
  ) {
    return selectedSources.map((source) => {
      const sourceInfo = stockSourceInfoByBatchId.get(source.batchId);
      if (!sourceInfo) {
        return source;
      }
      return {
        ...source,
        batchNo: source.batchNo || sourceInfo.batchNo,
        partCode: source.partCode || sourceInfo.partCode,
        partName: source.partName || sourceInfo.partName,
        availableQuantity: sourceInfo.availableQuantity,
        unit: source.unit || sourceInfo.unit,
        replenishmentSourceType: source.replenishmentSourceType || sourceInfo.replenishmentSourceType,
        replenishmentSourceRequestNo: source.replenishmentSourceRequestNo || sourceInfo.replenishmentSourceRequestNo,
        replenishmentSourceLabel: source.replenishmentSourceLabel || sourceInfo.replenishmentSourceLabel
      };
    });
  }

  private toLineProductionTasks(tasks: any[], stockQuantityByTaskNo = new Map<string, number>()) {
    return tasks.map((task) => ({
      id: task.id,
      productionTaskNo: task.productionTaskNo,
      status: this.toEffectiveTaskProductionStatus(task),
      isReplenishment: task.isReplenishment,
      sourceProductionTaskNo: task.sourceProductionTaskNo,
      replenishmentSourceType: this.resolveTaskReplenishmentSourceType(task),
      replenishmentSourceRequestNo: task.replenishmentSourceRequestNo,
      replenishmentSourceLabel: this.resolveTaskReplenishmentSourceLabel(task),
      plannedQuantity: decimalToNumber(task.plannedQuantity),
      completedQuantity: this.toEffectiveTaskCompletedQuantity(
        task,
        stockQuantityByTaskNo.get(task.productionTaskNo) || 0
      ),
      canCancelReplenishment: Boolean(
        task.isReplenishment &&
          this.resolveTaskReplenishmentSourceType(task) !== 'PRODUCTION_SCRAP' &&
          !task.inventoryBatch &&
          !this.isStartedProductionTask(task)
      )
    }));
  }

  private resolveTaskReplenishmentSourceType(task: any) {
    if (!task?.isReplenishment) {
      return null;
    }
    if (task.replenishmentSourceType) {
      return task.replenishmentSourceType;
    }
    const remark = String(task.remark || '');
    if (remark.includes('生产报废') || remark.includes('PRODUCTION_SCRAP')) {
      return 'PRODUCTION_SCRAP';
    }
    return 'ORDER_CHANGE';
  }

  private resolveTaskReplenishmentSourceLabel(task: any) {
    const sourceType = this.resolveTaskReplenishmentSourceType(task);
    if (sourceType === 'PRODUCTION_SCRAP') {
      return '生产报废补单';
    }
    if (sourceType === 'ORDER_CHANGE') {
      return '订单补单';
    }
    return null;
  }

  private stockSourceReplenishmentSourceLabel(sourceType?: string | null, sourceRequestNo?: string | null) {
    if (!sourceType) {
      return undefined;
    }
    const sourceTypeText =
      sourceType === 'PRODUCTION_SCRAP'
        ? '生产报废补单'
        : sourceType === 'ORDER_CHANGE'
          ? '订单数量补单'
          : sourceType;
    return sourceRequestNo ? `${sourceTypeText}：${sourceRequestNo}` : sourceTypeText;
  }

  private toOrderWarehouseStage(order: any) {
    if (order.status === OrderStatus.DRAFT) {
      return 'ORDER_DRAFT';
    }
    if (order.status === OrderStatus.CANCELLED) {
      return 'ORDER_CANCELLED';
    }
    if (order.status === OrderStatus.COMPLETED) {
      // 第一阶段订单 COMPLETED 只由仓库全量发货关闭订单产生，列表必须显示为已完成发货。
      return 'SHIPPED';
    }

    const tasks = order.productionTasks || [];
    const orderBatches = (order.inventoryBatches || []).filter((batch: any) => batch.sourceOrderId);
    if (tasks.length === 0 && orderBatches.length === 0) {
      return 'WAITING_PRODUCTION';
    }

    const finishedCount = tasks.filter((task: any) => this.isTaskWarehouseFinished(task)).length;
    const shippedCount = tasks.filter((task: any) => this.isTaskOrderBatchShipped(task)).length;
    const availableOrderBatchCount = orderBatches.filter((batch: any) => batch.status === 'AVAILABLE').length;
    const shippedOrderBatchCount = orderBatches.filter((batch: any) => batch.status === 'USED').length;
    const quantityByUnit = this.toOrderQuantityByUnit(order.lines || []);
    const shippedQuantityByUnit = this.toOrderShippedQuantityByUnit(order);
    const taskStatuses = tasks.map((task: any) => this.toEffectiveTaskProductionStatus(task));
    const productionFinished = tasks.length === 0 || taskStatuses.every((status: ProductionStatus) => status === ProductionStatus.COMPLETED);
    if (!productionFinished) {
      if (taskStatuses.some((status: ProductionStatus) => status !== ProductionStatus.PENDING)) {
        return 'IN_PRODUCTION_STAGE';
      }
      return 'WAITING_PRODUCTION';
    }

    const allTasksFinished = tasks.length === 0 || finishedCount === tasks.length;
    if (allTasksFinished && this.allOrderQuantitiesReached(quantityByUnit, shippedQuantityByUnit)) {
      return 'SHIPPED';
    }
    if (shippedCount > 0 || shippedOrderBatchCount > 0 || this.totalQuantityFromUnitMap(shippedQuantityByUnit) > 0) {
      return 'PARTIAL_SHIPPED';
    }

    if (tasks.some((task: any) => task.status === 'COMPLETED' && !task.inventoryBatch)) {
      return 'WAITING_RECEIPT';
    }

    if (availableOrderBatchCount > 0 || tasks.some((task: any) => this.isTaskOrderBatchAvailable(task))) {
      return 'WAITING_SHIPMENT';
    }

    if (tasks.some((task: any) => task.status === 'IN_PROGRESS')) {
      return 'IN_PRODUCTION_STAGE';
    }

    return 'WAITING_PRODUCTION';
  }

  private toOrderProductionStatus(order: any): ProductionStatus {
    if (order.status === OrderStatus.COMPLETED) {
      return ProductionStatus.COMPLETED;
    }

    const tasks = order.productionTasks || [];
    const orderBatches = (order.inventoryBatches || []).filter((batch: any) => batch.sourceOrderId);
    if (tasks.length === 0) {
      return orderBatches.length > 0 ? ProductionStatus.COMPLETED : ProductionStatus.PENDING;
    }

    const taskStatuses = tasks.map((task: any) => this.toEffectiveTaskProductionStatus(task));
    if (taskStatuses.every((status: ProductionStatus) => status === ProductionStatus.COMPLETED)) {
      return ProductionStatus.COMPLETED;
    }
    // 只要已有任务开工或部分任务完成，订单级生产状态就不再显示为待确认生产。
    if (taskStatuses.some((status: ProductionStatus) => status !== ProductionStatus.PENDING)) {
      return ProductionStatus.IN_PROGRESS;
    }
    return ProductionStatus.PENDING;
  }

  private orderMatchesProductionFilter(order: any, productionStatuses: OrderProductionFilterStatus[]) {
    const displayStatus = this.toOrderProductionFilterStatus(order);
    if (productionStatuses.includes(displayStatus)) {
      return true;
    }
    // 兼容旧查询值：PENDING / IN_PROGRESS / COMPLETED。
    return productionStatuses.includes(order.productionStatus);
  }

  private toOrderProductionFilterStatus(order: { status: OrderStatus; productionStatus: ProductionStatus; warehouseStage?: string }) {
    if (order.status === OrderStatus.DRAFT) {
      return 'ORDER_DRAFT';
    }
    if (order.status === OrderStatus.CANCELLED) {
      return 'ORDER_CANCELLED';
    }
    if (order.warehouseStage === 'SHIPPED') {
      return 'ORDER_SHIPPED_COMPLETED';
    }
    if (order.status === OrderStatus.COMPLETED) {
      return 'ORDER_SHIPPED_COMPLETED';
    }
    if (order.warehouseStage === 'PARTIAL_SHIPPED') {
      return 'PARTIAL_SHIPPED';
    }
    if (
      order.productionStatus === ProductionStatus.COMPLETED ||
      order.warehouseStage === 'WAITING_RECEIPT' ||
      order.warehouseStage === 'WAITING_SHIPMENT'
    ) {
      return 'ORDER_COMPLETED_UNSHIPPED';
    }
    if (
      order.status === OrderStatus.IN_PRODUCTION ||
      order.productionStatus === ProductionStatus.IN_PROGRESS ||
      order.warehouseStage === 'IN_PRODUCTION_STAGE'
    ) {
      return 'ORDER_IN_PRODUCTION';
    }
    return 'WAITING_PRODUCTION';
  }

  private parseEnumList<T extends string>(value: string | undefined, allowedValues: T[], fieldName: string) {
    if (!value) {
      return [];
    }

    const values = Array.from(
      new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
    const invalidValues = values.filter((item) => !allowedValues.includes(item as T));
    if (invalidValues.length > 0) {
      throw new BadRequestException(`${fieldName}不正确：${invalidValues.join('、')}`);
    }

    return values as T[];
  }

  private toLineWarehouseInfo(line: any, stockQuantityByTaskNo = new Map<string, number>(), orderNo?: string) {
    const tasks = line.productionTasks || [];
    const lineBatches = (line.inventoryBatches || []).filter((batch: any) => batch.sourceOrderId);
    const visibleLineBatch =
      lineBatches.find((batch: any) => batch.status === 'AVAILABLE') ||
      lineBatches.find((batch: any) => batch.status === 'USED');
    if (tasks.length === 0) {
      if (visibleLineBatch) {
        const shippedQuantity = this.toLineShippedQuantity(line, orderNo);
        const warehouseStage =
          shippedQuantity + 0.0001 >= decimalToNumber(line.quantity)
            ? 'SHIPPED'
            : shippedQuantity > 0
              ? 'PARTIAL_SHIPPED'
              : 'WAITING_SHIPMENT';
        return {
          productionTaskNo: null,
          productionStatus: null,
          // STOCK 直接使用库存没有生产任务；发货后批次当前剩余会变成 0，订单明细仍应显示客户订单数量。
          completedQuantity: decimalToNumber(line.quantity),
          productionTaskCount: 0,
          productionShortageQuantity: 0,
          productionScrapQuantity: 0,
          productionShortageMode: null,
          productionReplenishmentTaskNos: [],
          productionReplenishmentRequestNos: [],
          productionShortageReasons: [],
          productionProgressText: '使用库存，无生产工序',
          warehouseStage,
          inventoryBatchNo: visibleLineBatch.batchNo,
          inventoryStatus: visibleLineBatch.status,
          warehouseName: visibleLineBatch.warehouse?.warehouseName || null,
          locationName: visibleLineBatch.location?.locationName || null
        };
      }
      return {
        productionTaskNo: null,
        productionStatus: null,
        completedQuantity: 0,
        productionTaskCount: 0,
        productionShortageQuantity: 0,
        productionScrapQuantity: 0,
        productionShortageMode: null,
        productionReplenishmentTaskNos: [],
        productionReplenishmentRequestNos: [],
        productionShortageReasons: [],
        productionProgressText: '尚未生成生产任务',
        warehouseStage: 'ORDER_DRAFT',
        inventoryBatchNo: null,
        inventoryStatus: null,
        warehouseName: null,
        locationName: null
      };
    }

    // 一个订单零件可能因为报废补单生成多个生产任务，明细页必须按全部任务汇总阶段，避免原任务发货后误判零件已结束。
    const primaryTask = tasks[0];
    const visibleBatch =
      lineBatches.find((batch: any) => batch.status === 'AVAILABLE') ||
      lineBatches.find((batch: any) => batch.status === 'USED') ||
      tasks.find((task: any) => task.inventoryBatch?.sourceOrderId && task.inventoryBatch.status === 'AVAILABLE')?.inventoryBatch ||
      tasks.find((task: any) => task.inventoryBatch?.sourceOrderId && task.inventoryBatch.status === 'USED')?.inventoryBatch ||
      primaryTask.inventoryBatch;
    const finishedCount = tasks.filter((task: any) => this.isTaskWarehouseFinished(task)).length;
    const shippedCount = tasks.filter((task: any) => this.isTaskOrderBatchShipped(task)).length;
    const shippedQuantity = this.toLineShippedQuantity(line, orderNo);
    const shortageInfo = this.toLineShortageInfo(tasks);
    const taskStatuses = tasks.map((task: any) => this.toEffectiveTaskProductionStatus(task));
    const productionFinished = taskStatuses.every((status: ProductionStatus) => status === ProductionStatus.COMPLETED);
    const stockCoveredQuantity =
      line.fulfillmentMode === OrderLineFulfillmentMode.STOCK
        ? Math.max(decimalToNumber(line.quantity) - decimalToNumber(line.productionPlanQuantity), 0)
        : 0;
    let warehouseStage = 'WAITING_PRODUCTION';
    if (!productionFinished) {
      if (taskStatuses.some((status: ProductionStatus) => status !== ProductionStatus.PENDING)) {
        warehouseStage = 'IN_PRODUCTION_STAGE';
      }
    } else if (
      shippedQuantity + 0.0001 >= decimalToNumber(line.quantity) &&
      finishedCount === tasks.length
    ) {
      warehouseStage = 'SHIPPED';
    } else if (shippedQuantity > 0 || shippedCount > 0) {
      warehouseStage = 'PARTIAL_SHIPPED';
    } else if (tasks.some((task: any) => task.status === 'COMPLETED' && !task.inventoryBatch)) {
      warehouseStage = 'WAITING_RECEIPT';
    } else if (lineBatches.some((batch: any) => batch.status === 'AVAILABLE') || tasks.some((task: any) => this.isTaskOrderBatchAvailable(task))) {
      warehouseStage = 'WAITING_SHIPMENT';
    } else if (tasks.some((task: any) => task.status === 'IN_PROGRESS')) {
      warehouseStage = 'IN_PRODUCTION_STAGE';
    }

    return {
      productionTaskNo:
        tasks.length === 1 ? primaryTask.productionTaskNo : `${primaryTask.productionTaskNo} 等 ${tasks.length} 个任务`,
      productionStatus: tasks.every((task: any) => this.toEffectiveTaskProductionStatus(task) === 'COMPLETED')
        ? 'COMPLETED'
        : tasks.some((task: any) => this.toEffectiveTaskProductionStatus(task) === 'IN_PROGRESS')
          ? 'IN_PROGRESS'
          : 'PENDING',
      completedQuantity: tasks.reduce(
        (sum: number, task: any) =>
          sum + this.toEffectiveTaskCompletedQuantity(task, stockQuantityByTaskNo.get(task.productionTaskNo) || 0),
        stockCoveredQuantity
      ),
      productionTaskCount: tasks.length,
      ...shortageInfo,
      productionProgressText:
        stockCoveredQuantity > 0
          ? `库存已覆盖 ${stockCoveredQuantity} ${line.unit || '件'}；${this.formatLineProductionProgress(tasks)}`
          : this.formatLineProductionProgress(tasks),
      warehouseStage,
      inventoryBatchNo: visibleBatch?.batchNo || null,
      inventoryStatus: visibleBatch?.status || null,
      warehouseName: visibleBatch?.warehouse?.warehouseName || null,
      locationName: visibleBatch?.location?.locationName || null
    };
  }

  private formatLineProductionProgress(tasks: any[]) {
    // 订单变更和补单必须让操作人员先看到当前零件进行到哪一道工序，避免把已生产数量变更误当成待提交生产订单修改。
    if (tasks.length === 0) {
      return '尚未生成生产任务';
    }

    const summaries = tasks.map((task) => {
      const steps = processSnapshotToArray(task.processSnapshot);
      const completedNames = (task.processCompletions || [])
        .filter((completion: any) => completion.isCompleted)
        .map((completion: any) => completion.processName);
      const nextStep = steps.find((step) => !completedNames.includes(step));
      const taskNo = task.productionTaskNo;
      if (task.inventoryBatch) {
        return `${taskNo} 已入库`;
      }
      if (task.status === ProductionStatus.COMPLETED) {
        return `${taskNo} 已完成，等待仓库`;
      }
      if (task.status === ProductionStatus.PENDING && completedNames.length === 0) {
        return `${taskNo} 待确认生产`;
      }
      if (completedNames.length === 0) {
        return `${taskNo} 已开始，下一道 ${nextStep || '待确认完成'}`;
      }
      return `${taskNo} 已完成 ${completedNames.join('、')}，下一道 ${nextStep || '待确认完成'}`;
    });

    return summaries.join('；');
  }

  private isTaskOrderBatchAvailable(task: any) {
    return Boolean(task.inventoryBatch?.sourceOrderId && task.inventoryBatch.status === 'AVAILABLE');
  }

  private isTaskOrderBatchShipped(task: any) {
    return Boolean(task.inventoryBatch?.sourceOrderId && task.inventoryBatch.status === 'USED');
  }

  private toLineShippedQuantity(line: any, orderNo?: string) {
    const countedTransactionIds = new Set<string>();
    let lineShipmentQuantity = 0;
    for (const transaction of line.inventoryTransactions || []) {
      if (
        countedTransactionIds.has(transaction.id) ||
        transaction.transactionType !== InventoryTransactionType.OUT ||
        transaction.sourceRecordType !== 'InventoryBatch' ||
        (orderNo && transaction.orderNo !== orderNo)
      ) {
        continue;
      }
      countedTransactionIds.add(transaction.id);
      lineShipmentQuantity += decimalToNumber(transaction.quantity);
    }
    return lineShipmentQuantity + (line.inventoryBatches || []).reduce((sum: number, batch: any) => {
      if (!batch.sourceOrderId) {
        return sum;
      }
      return (
        sum +
        (batch.transactions || []).reduce((batchSum: number, transaction: any) => {
          if (
            countedTransactionIds.has(transaction.id) ||
            transaction.transactionType !== InventoryTransactionType.OUT ||
            transaction.sourceRecordType !== 'InventoryBatch' ||
            (orderNo && transaction.orderNo !== orderNo)
          ) {
            return batchSum;
          }
          countedTransactionIds.add(transaction.id);
          return batchSum + decimalToNumber(transaction.quantity);
        }, 0)
      );
    }, 0);
  }

  private isTaskWarehouseFinished(task: any) {
    // 已经入库的历史任务可能仍保留旧的 IN_PROGRESS 状态；订单页必须以仓库批次为准，避免误判还在生产。
    return Boolean(
      task.inventoryBatch &&
        (task.inventoryBatch.sourceOrderId === null || task.inventoryBatch.status === 'USED')
    );
  }

  private toEffectiveTaskProductionStatus(task: any) {
    if (task.inventoryBatch || task.status === 'COMPLETED') {
      return 'COMPLETED';
    }
    return task.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PENDING';
  }

  private toEffectiveTaskCompletedQuantity(task: any, stockQuantity = 0) {
    const completedQuantity = decimalToNumber(task.completedQuantity);
    if (completedQuantity > 0) {
      return completedQuantity;
    }
    // 已入库但旧任务完成数为 0 时，用订单入库批次 + 多做备货批次数量兜底，保证订单明细不漏算超产转库存部分。
    return (task.inventoryBatch ? decimalToNumber(task.inventoryBatch.quantity) : 0) + stockQuantity;
  }

  private async getStockQuantityByTaskNo(taskNos: string[]) {
    const uniqueTaskNos = Array.from(new Set(taskNos.filter(Boolean)));
    const quantityMap = new Map<string, number>();
    if (uniqueTaskNos.length === 0) {
      return quantityMap;
    }

    const stockBatches = await this.prisma.inventoryBatch.findMany({
      where: {
        sourceOrderId: null,
        sourceProductionTaskNo: { in: uniqueTaskNos }
      }
    });

    for (const batch of stockBatches) {
      if (!batch.sourceProductionTaskNo) {
        continue;
      }
      quantityMap.set(
        batch.sourceProductionTaskNo,
        (quantityMap.get(batch.sourceProductionTaskNo) || 0) + decimalToNumber(batch.quantity)
      );
    }
    return quantityMap;
  }

  private finalProcessCompletion(task: any) {
    return (task.processCompletions || []).reduce((current: any, item: any) => {
      if (!current || item.stepNo > current.stepNo) {
        return item;
      }
      return current;
    }, null);
  }

  private toShortageRecords(tasks: any[]) {
    return tasks
      .map((task) => {
        const finalCompletion = this.finalProcessCompletion(task);
        return finalCompletion
          ? {
              completionId: finalCompletion.id,
              productionTaskNo: task.productionTaskNo,
              orderLineId: task.orderLineId,
              partCode: task.partCode,
              partName: task.partName,
              shortageQuantity: decimalToNumber(finalCompletion.shortageQuantity),
              scrapQuantity: decimalToNumber(finalCompletion.scrapQuantity),
              shortageMode: finalCompletion.shortageMode,
              replenishmentTaskNo: finalCompletion.replenishmentTaskNo,
              replenishmentRequestNo: finalCompletion.replenishmentRequests?.[0]?.requestNo,
              replenishmentRequestStatus: finalCompletion.replenishmentRequests?.[0]?.status,
              managerName: finalCompletion.managerName,
              shortageReason: finalCompletion.shortageReason,
              shortageResolutionMode: finalCompletion.shortageResolutionMode,
              shortageResolutionBy: finalCompletion.shortageResolutionBy,
              shortageResolutionReason: finalCompletion.shortageResolutionReason,
              shortageResolvedAt: finalCompletion.shortageResolvedAt,
              unit: finalCompletion.unit || task.unit || '件'
            }
          : null;
      })
      .filter((record) => record && record.shortageQuantity > 0);
  }

  private isUnresolvedShortageRecord(record: any) {
    return record.shortageMode === 'MANAGER_APPROVED' && !record.shortageResolutionMode;
  }

  private isPendingProductionReplenishmentRecord(record: any) {
    return (
      record.shortageMode === 'REPLENISHMENT_REQUEST' &&
      !record.replenishmentTaskNo &&
      record.replenishmentRequestStatus !== 'REJECTED'
    );
  }

  private toUnresolvedShortageRecords(tasks: any[]) {
    return this.toEffectiveUnresolvedShortageRecords(tasks);
  }

  private toLineShortageInfo(tasks: any[]) {
    const shortageRecords = this.toShortageRecords(tasks);
    const unresolvedShortageRecords = this.toEffectiveUnresolvedShortageRecords(tasks);

    const productionReplenishmentTaskNos = shortageRecords
      .map((record: any) => record.replenishmentTaskNo)
      .filter(Boolean);
    const productionReplenishmentRequestNos = shortageRecords
      .map((record: any) => record.replenishmentRequestNo)
      .filter(Boolean);
    const productionShortageReasons = shortageRecords
      .filter((record: any) => record.shortageMode === 'MANAGER_APPROVED')
      .map((record: any) => ({
        managerName: record.managerName,
        shortageReason: record.shortageReason
      }));

    return {
      productionShortageQuantity: shortageRecords.reduce(
        (sum: number, record: any) => sum + decimalToNumber(record.shortageQuantity),
        0
      ),
      productionScrapQuantity: shortageRecords.reduce((sum: number, record: any) => sum + decimalToNumber(record.scrapQuantity), 0),
      productionShortageMode:
        shortageRecords.length === 0
          ? null
          : shortageRecords.some((record: any) => record.shortageMode === 'REPLENISHMENT')
            ? 'REPLENISHMENT'
            : shortageRecords.some((record: any) => record.shortageMode === 'REPLENISHMENT_REQUEST')
              ? 'REPLENISHMENT_REQUEST'
              : 'MANAGER_APPROVED',
      productionReplenishmentTaskNos,
      productionReplenishmentRequestNos,
      productionShortageReasons,
      unresolvedShortageQuantity: unresolvedShortageRecords.reduce(
        (sum: number, record: any) => sum + decimalToNumber(record.shortageQuantity),
        0
      ),
      unresolvedShortageCount: unresolvedShortageRecords.length,
      unresolvedShortageRecords: unresolvedShortageRecords.map((record: any) => ({
        completionId: record.completionId,
        productionTaskNo: record.productionTaskNo,
        partCode: record.partCode,
        partName: record.partName,
        shortageQuantity: record.shortageQuantity,
        scrapQuantity: record.scrapQuantity,
        managerName: record.managerName,
        shortageReason: record.shortageReason,
        unit: record.unit
      }))
    };
  }

  private toEffectiveUnresolvedShortageRecords(tasks: any[]) {
    const records = this.toShortageRecords(tasks).filter((record: any) => this.isUnresolvedShortageRecord(record));
    if (records.length === 0) {
      return [];
    }

    const completedReplenishmentQuantityByLine = this.toCompletedReplenishmentQuantityByLine(tasks);
    return records.flatMap((record: any) => {
      const key = record.orderLineId || record.productionTaskNo;
      const coveringQuantity = completedReplenishmentQuantityByLine.get(key) || 0;
      if (coveringQuantity <= 0) {
        return [record];
      }

      const usedQuantity = Math.min(record.shortageQuantity, coveringQuantity);
      const remainingQuantity = this.roundQuantity(record.shortageQuantity - usedQuantity);
      completedReplenishmentQuantityByLine.set(key, this.roundQuantity(coveringQuantity - usedQuantity));
      if (remainingQuantity <= 0) {
        return [];
      }
      return [{ ...record, shortageQuantity: remainingQuantity }];
    });
  }

  private toCompletedReplenishmentQuantityByLine(tasks: any[]) {
    const quantityByLine = new Map<string, number>();
    for (const task of tasks) {
      if (!task?.isReplenishment || this.toEffectiveTaskProductionStatus(task) !== ProductionStatus.COMPLETED) {
        continue;
      }
      const key = task.orderLineId || task.sourceProductionTaskNo || task.productionTaskNo;
      const quantity = this.roundQuantity(
        this.toEffectiveTaskCompletedQuantity(task) || decimalToNumber(task.plannedQuantity)
      );
      if (quantity <= 0) {
        continue;
      }
      quantityByLine.set(key, this.roundQuantity((quantityByLine.get(key) || 0) + quantity));
    }
    return quantityByLine;
  }
}
