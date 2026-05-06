# AGENTS.md — 百胜制冷钣金制造 ERP / MES 第一版开发规范

Always respond in Simplified Chinese for explanations.

Keep code, technical keywords, function names, APIs, database fields, file names, and error messages in English.

Do not translate variable names, function names, class names, library names, API paths, database fields, file paths, or command names.

---

## 0. 文档定位

本文件是 `G:\codex\百胜企业系统\erp_v0.1` 当前项目的唯一主开发规范。

目标是：**第一版先跑通钣金制造订单、库存、生产、报工、检验、追溯闭环；后续再扩展 IATF 16949 双结构体系。**

本文件按 `16949.md` 的规范化思路整理，但职责不同：

```text
AGENTS.md：当前项目实际开发规范、进度、第一版边界、架构、运行命令、下一步优先级。
16949.md：未来 IATF 16949 体系扩展蓝图、条款、过程、证据库、审核体系参考。
```

当两者冲突时：

```text
1. 用户当前明确指令优先。
2. 当前第一版开发以 AGENTS.md 为准。
3. 真实代码、数据库结构和已存在实现优先于旧文字记录。
4. 16949.md 只作为未来体系能力参考，不覆盖当前第一版开发方向。
```

---

## 1. Codex 工作规则

每次开始开发前必须检查：

```text
1. AGENTS.md。
2. 当前仓库结构。
3. package.json。
4. docker-compose.yml。
5. database/prisma/schema.prisma。
6. README.md。
7. 当前运行命令、测试命令、构建命令。
8. git status，避免覆盖用户或其他任务已修改内容。
```

协作触发规则：

```text
用户只是提问、讨论、确认想法或询问是否需要修改时，只能解释和建议，不得直接改代码。
用户明确说“继续”“继续编辑代码”“继续编写程序”“继续下一步代码开发”“执行下一步项目开发”等含义明确的开发指令时，才可以继续修改代码。
用户明确要求修改 AGENTS.md、README 或需求文档时，只修改对应文档，不顺带开发功能代码。
凡涉及新增数据库表、字段、统计口径、价格成本、开票、合同、权限、日志、审批、追溯、附件等关键业务请求，必须同步更新 AGENTS.md。
```

代码原则：

```text
优先使用成熟、简单、稳定、可维护的实现。
能用清晰函数解决，不写复杂臃肿代码。
能复用组件、工具函数或现有 API，就不要复制粘贴。
关键业务必须准确无误，尤其库存、单位、追溯、权限、报工、检验、导出。
先保证正确性和稳定性，再考虑性能优化。
```

---

## 2. 当前技术架构

第一版采用适合铁威马 TerraMaster F4-424 MAX NAS 的简洁部署架构：

```text
frontend：Vue 3 + TypeScript + Vite + Element Plus + ECharts
backend：Node.js API，当前仍保留 JSON 过渡层
database：PostgreSQL 16 + Prisma
deployment：Docker Compose
storage：NAS 本地目录保存上传、临时文件、导出文件和数据库备份
```

核心约束：

```text
正式数据路径应逐步迁移到 Prisma/PostgreSQL。
JSON 文件只作为过渡层、演示层或数据库不可用时的兜底层。
库存、报工、检验、审批、附件、追溯等关键写入必须优先走 Prisma transaction。
不得重新退回纯 JSON 架构。
```

实际目录：

```text
frontend/                    前端应用
backend/                     后端 API
backend/data/                JSON 过渡数据
database/prisma/schema.prisma Prisma schema 唯一路径
database/prisma/migrations/  Prisma migrations
database/postgres-data/      Docker PostgreSQL 数据目录，不提交 Git
database/backups/            数据库备份目录，不提交 Git
storage/uploads/             上传附件、图纸、图片、留证文件
storage/temp/                临时文件
storage/exports/             导出文件
README.md                    项目运行说明
AGENTS.md                    当前主规范
16949.md                     未来 IATF 扩展参考
```

端口规则：

```text
本地 frontend dev：5176
本地 backend：3001
Docker frontend：18080
Docker backend：13001
旧项目端口 5173 / 5175 不属于当前 erp_v0.2，不得混用。
```

---

## 3. 运行与验证命令

根目录命令：

```bash
npm run frontend:dev
npm run frontend:build
npm run frontend:preview
npm run backend:start
npm run backend:test
npm run backend:db:generate
npm run backend:db:migrate
npm run backend:db:deploy
npm run backend:db:push
npm run backend:db:seed
npm run docker:build
npm run docker:up
npm run docker:down
```

Docker / NAS：

```bash
docker compose up -d postgres
docker compose up -d
```

数据库健康检查：

```bash
curl http://127.0.0.1:13001/api/system/database
```

说明：

```text
package.json 当前没有根级 lint 命令，不得在总结中声称已运行不存在的 lint。
涉及后端逻辑必须优先运行 backend:test。
涉及前端构建必须运行 frontend:build。
只改文档时不要求运行构建或测试，但必须检查修改范围。
```

---

## 4. 当前进度总览

更新时间：

```text
2026-05-06
```

完成率说明：

```text
完成率按“可验收业务功能”计算，不按代码文件数量计算。
第一版系统当前总体完成率：约 75%。
未来完整 IATF 16949 双结构系统当前总体完成率：约 3%。
```

模块完成率：

| 模块 | 当前完成率 | 状态 |
|---|---:|---|
| 项目骨架 / Docker / PostgreSQL / Prisma | 85% | 已可本地和 NAS 方向部署，仍需继续消除 JSON 过渡层 |
| 登录 / Session / 基础 RBAC | 60% | 已有基础接口和权限种子，仍需细化页面级和动作级权限 |
| 基础资料 | 60% | 客户、供应商、物料、工艺、仓库、库位、单位主数据和单位换算已具备基础能力 |
| 客户订单 / 订单草稿 | 74% | 已有客户选择、订单页快捷新增 / 编辑客户、批量粘贴、历史复用、后端草稿、正式订单接口、库存策略复核、下单工作区分流和订单行级工艺标签路线编辑 |
| 库存管理 | 73% | 已有入库、出库、更正、期初导入、盘点、退库、转库、冻结 / 解冻、质量放行、统计、批次基础追溯和外部上下文自动查询 |
| 生产计划 / 工单 / 下发 | 64% | 第一版方向已调整：不再做排产、批量排产、派工、批量派工、班组 / 人员 / 工位分配和派工完工确认；生产页应改为“生产通知待确认 -> 生产人员确认 -> 正式生产 -> 扫码 / 人工报工 -> 质量处理 -> 完工入库”的简化闭环。既有排产 / 派工代码属于待删除历史实现，后续需从前端主流程移除并停止调用相关接口，避免页面复杂和状态混乱。 |
| 扫码 / 人工报工 / 流转卡 | 47% | 已有扫码报工、不良联动、图纸查看、外部 flowCardCode 上下文自动定位，仍需完善人工报工和现场闭环 |
| 质量检验 / 不良品 | 59% | 已有 IQC / IPQC / WIP / OQC / 其他检验入口、不良草稿、质量判定、补单确认入口、已补单申请展示、重复补单防呆、统一检验队列、质量问题库存批次自动入队、批次检验关联、检验证据附件、外部上下文自动定位、质量页库存转可用入口和库存流水复核；仍需继续完善正式检验计划、抽样方案和审批闭环 |
| 附件 / 图纸 / 受控下载 | 50% | 已有上传、预览、授权、版本替换、历史追溯、软删除规则 |
| 批次追溯 / 日志 / 导出 | 70% | 已有追溯查询、链路图、追溯完整性检查与复制、主链路 / 补单分支流向、图表节点联动明细筛选、节点到业务页面快捷处理、选中节点相关证据、选中节点跨模块 operation_logs、附件证据、外部上下文自动定位提示、操作日志查询 / 导出和导出文件记录 |
| 看板 / 统计报表 | 30% | 已新增库存统计口径，仍需更多真实业务看板和跨模块指标 |
| 手机 / PDA 现场体验 | 20% | 有入口和部分页面，仍需按现场流程优化 |
| 完整 IATF 模块 | 3% | 只预留字段、证据和条款映射，不做完整体系模块 |

当前已落地关键能力：

```text
1. 单位主数据已落地：UnitMaster / UnitConversion Prisma 表和 migrations 已建立；GET /api/units、POST /api/units、POST /api/units/convert、GET /api/unit-conversions、POST /api/unit-conversions 已接入数据库优先、JSON 兜底方向。
2. 物料主数据扩展字段已落地：items 已新增 invoiceName、drawingStatus、materialGrade、thicknessMm、inspectionStandard 等字段，供订单评审、生产现场、检验和证据快照复用。
3. 订单草稿和历史复用已进入后端接口阶段：GET /api/orders/draft、POST /api/orders/draft、GET /api/orders/history-reuse、GET /api/orders、POST /api/orders、GET /api/orders/change-requests 已有数据库优先 / JSON 兜底路径。
4. 库存统计已新增真实计算入口：backend/src/inventory-statistics.js 和 GET /api/inventory/statistics 可按原单位 / 统计单位、可用 / 预占 / 受控状态做汇总。
5. 库存操作已不只是页面规则：期初导入 preview / submit、库存盘点 preview / submit、库存退库、库存转库、库存冻结 / 解冻、库存质量放行、库存流水查询已具备前后端接口痕迹。
6. 操作日志查询和导出已进入可用接口阶段：GET /api/operation-logs、GET /api/operation-logs/export 已接入导出文件、export task 和 access log 方向。
7. inspection_records 已支持 inventoryBatchId 关联库存批次，为 IQC / OQC 批次检验和后续受控放行打基础。
8. 库存 / 生产质量问题审查改正后转入可用库存已建立受控入口：POST /api/inventory/batches/:batchNo/quality-release，后端按 QUALITY_RELEASE 动作写 RELEASE 类型 inventory_transactions、operation_logs，不改变账面数量，只恢复可用数并把质量状态转为 RELEASED / 已放行；质量页可从检验记录发起该库存转可用动作，复核单号可选，但必须保留放行日期或备注依据。
9. GET /api/inspections 已把质量问题库存批次纳入统一检验队列：inspection_records、开放 nonconformities 和待检 / 待判定 / 隔离 / 冻结 / 不合格 / 合格待评估库存批次会合并返回；库存批次行使用 sourceType=inventory_batch，只能走 POST /api/inventory/batches/:batchNo/quality-release，不能误走 POST /api/inspections/:inspectionNo/release。
10. 质量页已接入库存批次流水复核入口：sourceType=inventory_batch 或带 batchNo 的检验行可直接调用 GET /api/inventory/batches/:batchNo/transactions 查看冻结、调整、预占释放、质量放行等流水，用于提交质量转可用前后核对依据和数量变化。
11. 订单草稿页已增加客户快捷维护入口：操作人员可在订单页调用同一套 /api/customers 新增客户或编辑当前客户联系资料，保存后自动选中当前客户；完整客户状态变更、停用、归档和批量维护仍归基础资料页面处理，历史正式订单保留下单时客户快照，不被后续客户资料修改静默覆盖。
12. 客户 / 供应商搜索和追溯搜索交互已进入统一规则：订单草稿页客户选择接入 /api/customers，通用 RemoteEntitySelect 客户 / 供应商搜索分别接入 /api/customers、/api/suppliers，支持单字或多字关键词模糊查询、结果按 pinyin / shortCode / name 排序并支持滚动；下拉结果只负责选择，不放置复制整条记录或字段按钮；操作人员点击某个结果后，搜索框区域必须显示当前已选主文本，例如客户显示客户名称、订单显示订单号、物料显示物料 / 产品名称、追溯显示当前查询对象，用户可点击该已选文本框后用 Ctrl+C 复制；不得复制整条数据库记录或整页搜索结果；接口不可用时保留本地兜底。追溯链路明细必须同时显示业务编号、名称和补充说明，客户和供应商不得只显示编号，库存批次需要能看到材料 / 批次 / 来源客户 / 供应商线索。基础资料页已补齐供应商维护入口，Supplier schema / migration 已扩展 pinyin、shortCode、supplyScope、qualityStatus、remark 字段，支持新增、编辑、停用 / 启用供应商并写入 operation_logs；供货范围、质量状态和备注可在基础资料页受控维护。供应商体系 / 质量证据附件第一段已接入基础资料页，按 businessType=supplier_evidence、businessId=供应商编码复用 POST /api/attachments/files 和 GET /api/attachments/files，可上传、列表、复制附件编号并查看 GET /api/attachments/:fileNo/history；Attachment schema / migration 已扩展 scene、permission、source、uploadReason 字段，避免切换 PostgreSQL 后丢失证据类型和上传依据；上传写入统一附件记录和 operation_logs；前端不提供自动删除，后续替换、作废、受控下载继续走受控附件、审批、日志和追溯流程。
13. 订单草稿页已支持从正式订单明细反查并导入订单行：从订单管理进入草稿时可自动反查正式订单上下文，操作人员可一键导入全部订单行或单行加入草稿；导入只替换 / 合并未下发草稿，重新复核库存分配，并生成 / 更新待确认生产需求草稿，不直接扣库存、不自动下发生产，已下发生产记录必须保留。
14. 订单历史复用已补齐正式订单和生产链路派生来源：GET /api/orders/history-reuse 不只读取正式 customer_orders；JSON 路径会把历史 orderLinks 按订单号汇总为可复用项目，Prisma/PostgreSQL 路径会在缺少正式 customer_orders 时从 work_orders / flow_cards 派生历史项目，并把正式订单与派生项目统一排序、统一分页，避免翻页重复或漏项；订单草稿页历史常用区用横条显示订单号、日期、项目、摘要、行数、数量和交期，抽屉内支持按物料号、客户物料号、名称、图纸、检验要求筛选项目零件，并可只全选 / 清空当前筛选结果后修改数量、单位和库存策略。
15. 生产需求下发上下文已补齐：从订单草稿或正式订单明细下发生产时，JSON 过渡路径和 Prisma/PostgreSQL 路径必须保留 customerId / customerCode、customerName、orderDate、dueDate，并写入 production_demand.release 的 beforeData / afterData；后续工单、流转卡、追溯和订单详情不得丢失客户与交期快照。
16. 订单详情中的生产需求必须区分“待确认草稿”和“已下发生产”：已有有效 workOrderNo / flowCardCode 或状态为已下发的订单行，不得再同时出现在 productionDemandDrafts；JSON 过渡路径和 Prisma/PostgreSQL 路径都必须按同一规则返回 summary 计数，避免操作人员重复下发。
17. 客户订单列表和订单详情的生产需求统计口径必须一致：只要订单生产链路已有有效 workOrderNo / flowCardCode，或 demandStatus / releaseStatus / draftStatus 表示已下发、已确认下发、已派工、生产中、已完成或已关闭，就必须计入 releasedDemandCount，不得因为旧的 demandStatus 文本仍是 PENDING 而继续计入 pendingDemandCount。
18. 正式订单明细到订单草稿的操作入口已补齐：订单总览 / 正式订单明细可跳转“去草稿确认下发”，路由携带 orderDraftAction=import-order-detail 和 autoImportOrderDetail=1；订单草稿页收到该受控参数后自动反查正式订单并导入订单行，只生成 / 更新待确认生产需求草稿，不自动下发生产。
19. 订单草稿反查正式订单时，必须把 releasedProductionDemands 镜像为本地“已下发生产”保护记录：已有 workOrderNo / flowCardCode 的物料不得因为再次导入正式订单行、重新复核库存或重新生成草稿而变回待确认生产需求；如需调整已下发需求，只能走撤回或受控订单变更。
20. 已下发生产需求必须能直达生产中心：订单详情和订单草稿中的已下发生产记录应提供“生产”入口，路由携带 orderNo、materialCode、workOrderNo / flowCardCode；生产中心收到路由上下文后必须自动定位对应生产通知、正式生产记录、扫码报工、质量处理或库存承接状态，不再以排产 / 派工作为第一版主流程。
21. GET /api/production/schedule-plan 当前仍是历史接口名，第一版后续应把语义调整为生产通知 / 正式生产关系查询；该接口的数据库路径和 JSON 过渡路径已接入同一套查询别名：customer / customerId / customerCode / customerName、order / orderNo、item / itemCode / materialCode / customerMaterialCode / drawingNo、workOrder / workOrderNo / flowCardCode / flowCard，避免不同页面跳转到生产中心时出现“前端有上下文但后端查不到”的问题。接口名未清理前，不得因为 schedule-plan 字样继续新增排产 / 派工功能。
22. 批次追溯页和 GET /api/traceability 已补齐外部上下文别名和生产中心联动：追溯页、JSON 过渡路径和 Prisma/PostgreSQL 路径可识别 customer / customerCode / customerName、order / orderNo、item / itemCode / materialCode / customerMaterialCode / drawingNo、flowCard / flowCardCode、workOrder / workOrderNo、batch / batchNo、supplier / supplierCode / supplierName；当前追溯对象可复制查询条件，也可带客户、订单、物料、工单、流转卡或批次关键字跳转到生产中心继续查看生产通知、正式生产、报工、质量和库存状态。
23. 供应商证据已进入追溯证据链：GET /api/traceability 的 JSON 过渡路径和 Prisma/PostgreSQL 路径必须按 supplierCode、supplierName、库存批次供应商关系和 attachment.businessId 关联 supplier_evidence 附件；追溯结果 attachmentEvidence / evidenceLinks 应显示供应商证据的 fileNo、scene、businessType、businessId、uploadReason、permission、source 和 storagePath，支持从追溯页打开附件历史。
24. 订单草稿和生产中心已补齐订单行级履约与工艺表达：同一订单可包含多个零件，每个订单行必须独立保留 inventoryUsePolicy、productionRoute、routeSource、routeTemplateCode、routeTemplateName；订单行可选择自动建议、使用库存 / 半成品 / 成品、库存改制进生产或按工序生产；按工序生产时可手工编辑工艺路线，也可引用相似物料历史工艺后修改。生产中心样例已改为同一订单多零件、多工艺路线、多 flowCardCode 展示，用于后续验证数据库和 API 是否按订单行粒度处理。
25. 质量检验页已从“不良品处置页”扩展为统一检验入口第一段：前端按 IQC 来料、IPQC 过程、WIP 半成品、OQC 成品和 OTHER 其他检验分组；支持扫描或输入 flowCardCode、batchNo、订单号、产品编号、图纸号或检验单号定位检验上下文；检验上下文必须显示订单、工单、产品 / 零件、批次、图纸、SOP、检验标准和包装要求，并提供追溯、生产中心、扫码报工和图纸证据入口。检验证据上传前可填写证据类型、标注位置和说明，上传后写入统一 attachments / operation_logs 方向。不良品只是检验异常后的处置结果，不得替代 IQC / IPQC / WIP / OQC / OTHER 检验流程。
26. 生产中心补单需求入口已补齐第一段：生产通知表、库存承接表或生产关系表中出现“补单 n 件”时，必须显示明确的“补单确认”操作，路由带入 orderNo、itemCode / itemName、workOrderNo、flowCardCode、nonconformityNo 或 supplementNo，直达不良品页的下料补单确认区；不良品页收到生产中心上下文后应自动选中匹配不良草稿，并提示操作人员依次完成补单申请、审批结论、补单完工确认和关闭证据。
27. 订单草稿页 UI 已开始按业务动作拆分：顶部明确分为新建订单、补单下单、订单草稿和工艺路线四个工作区；补单下单必须跳转到来源不良 / 原订单 / 原工单 / flowCardCode 绑定流程，不能混入普通新订单录入。批量粘贴预览和订单物料明细表必须显示第 N 行序号；阻断和提醒不得只写汇总数量，必须能定位到“第 N 行：工艺路线未确认 / 履约方式未选择 / 库存策略需确认 / 图纸版本待确认”等逐行问题。订单行内必须支持常用工序标签、上移 / 下移排序、删除工序、引用相似物料工艺和手工编辑路线；同一订单内不同零件可以有不同工艺路线。
28. 下料补单重复申请防呆已补齐：同一个 nonconformityNo 只允许一个未驳回 / 未取消的有效补单申请；已审批、已生成补单工单或已完成的补单再次提交时，后端 JSON fallback 和 Prisma/PostgreSQL 路径必须返回已有 supplementNo，并写入 blanking_supplement.duplicate_request_blocked 操作日志，不得创建新的 BLK-SUP；不良品页必须显示“已补单申请”列表并禁用重复提交，生产中心补单需求入口必须按 nonconformityNo / supplementNo 去重。
29. 生产全局预览 UI 已改为“订单到生产关系表”优先：第一屏不再用多块订单 / 工序卡片堆叠展示，必须以类似 Excel 的单一横向表格展示每条客户订单零件从订单、草稿、生产通知、正式生产、workOrderNo、flowCardCode、库存、质量到下一步的关系；表格必须支持显示全部客户或按客户筛选，并保留客户名称、客户编号、订单号和操作入口，便于操作人员快速定位。状态列不得只显示文字，必须按每行状态给出“去草稿确认 / 生产确认 / 补单确认 / 扫码报工 / 人工报工 / 质量处理 / 完工入库 / 追溯 / 库存”等动态下一步操作，避免操作人员看到待确认、未下发、生产中或补单状态却不知道去哪里处理。第一版不得再把“去排产 / 去派工”作为主操作或跳转焦点。
30. 生产全局预览到质量页 / 库存页的上下文跳转已补齐第一段：点击“质量处理”必须带入 focus=quality、order、item、workOrder、flowCardCode 等上下文，质量页读取后自动填充定位关键字并匹配检验队列，显示图纸 / SOP / 证据、质量判定、库存转可用和检验放行入口；点击“库存”必须带入 item、order、customer、batchNo 等可用线索，库存页读取后自动填充库存关键字并执行查询，避免操作人员跳到大页面后再次手工查找。
31. 生产全局预览到扫码报工页的上下文跳转已补齐第一段：点击“扫码报工”必须带入 flowCardCode / flowCard、order、item、workOrder 和 sourcePage；扫码报工页读取后自动填入 flowCardCode、静默查询 GET /api/flow-cards/:flowCardCode，刷新流转卡、生产通知 / 正式生产、图纸、SOP、检验要求和不良草稿上下文，并在页面顶部提示来源页面；在同一页面切换不同 flowCardCode 路由时必须重新定位，避免操作人员跳页后还要手工输入编码。
32. 生产中心第一版流程已调整为生产通知确认：生产中心首屏不得再以排产 / 派工为核心，不再显示待排产、待派工、批量排产、批量派工、派工待办、班组 / 人员 / 工位 / 设备分配和派工完工确认。订单草稿编辑完成并通过下发前复核后，生产中心应生成“生产通知待确认”；生产人员只需要查看客户、订单号、零件、数量、单位、图纸、库存策略、质量风险和备注，点击“确认生产”后该订单行才算正式进入生产。确认生产时后端必须生成或确认 workOrderNo、flowCardCode、customerOrderNo、itemCode、quantity、unit、drawingNo / drawingVersion、inventoryStrategy、operation_logs 和 traceability_links；后续主动作只保留扫码报工、人工报工、质量处理、完工入库、追溯和库存。既有 /api/production/schedule-plan/:workOrderNo/assign、/api/work-orders/:workOrderNo/dispatch、/api/work-orders/:workOrderNo/dispatch/:dispatchNo/complete 等排产 / 派工接口在第一版应标记为 deprecated，前端主流程不得继续调用；后续代码清理时应优先删除或隐藏相关 UI，避免复杂状态造成误操作。
33. 批次追溯页外部上下文提示已补齐第一段：从生产全局预览、生产中心、质量检验、库存、扫码报工、订单草稿或客户订单页跳入追溯页时，路由可带入 customer、order、item、workOrder、flowCardCode、batchNo、supplier 或 keyword；追溯页必须在顶部显示“已带入追溯上下文”，说明来源页面和已带入的客户、订单、物料、工单、流转卡、批次或供应商线索，并继续自动执行追溯查询，避免操作人员跳页后不知道当前追溯对象。
34. 生产中心辅助“生产订单全局预览”表应按第一版简化流程保留：该表作为辅助信息默认收起，不再挤占生产中心首屏；展开后不只显示生产需求、工单、流转卡、库存和风险文字，每行必须根据是否已有生产通知、workOrderNo / flowCardCode 显示去草稿、生产确认、扫码报工、人工报工、质量处理、完工入库、追溯、库存等操作入口。不得再提供排产 / 派工弹窗入口；未形成生产通知时应提示先去订单草稿确认下发。
35. 生产中心跳转定位可见提示必须按第一版简化流程调整：当其它页面带入 focus=production-confirm、focus=scan、focus=quality、focus=inbound 或普通 order / item / workOrder / flowCardCode 上下文跳到生产中心时，生产页必须在顶部显示“生产操作上下文”，列出当前生产通知、正式生产记录、扫码报工、质量或库存线索和匹配结果；匹配到待确认生产通知时提示操作人员复核后点击“确认生产”，未匹配时说明需要先去订单草稿确认下发或检查订单号、物料号、工单号。
36. 生产中心订单到生产关系表补单上下文已补齐第一段：GET /api/production/schedule-plan 的 JSON fallback 和 Prisma/PostgreSQL 路径返回 workOrders 时，补单工单必须携带 draftNo、nonconformityNo、supplementNo；生产中心顶部关系表必须按这些字段或“补单”文本识别补单行，并显示“补单确认 / 查看补单”入口，直达不良品页下料补单确认区，避免补单需求只在库存预占表出现而总表无法处理。
37. 生产中心订单到生产关系表建议操作字段必须按第一版简化流程调整：GET /api/production/schedule-plan 的 JSON fallback 和 Prisma/PostgreSQL 路径返回 workOrders 时，必须为每行返回 primaryActionCode、primaryActionText、primaryActionHint；GET /api/production/overview 返回 orderLinks 时也必须返回同一组建议操作字段，便于生产全局预览优先使用后端口径。前端生产全局预览必须显示“建议操作”列，并把建议操作做成可点击主按钮：去草稿跳订单草稿、生产确认进入生产中心确认通知、扫码报工跳扫码页、人工报工进入报工入口、质量处理跳质量页、完工入库进入库存 / 完工入口、补单确认跳不良品补单确认区、追溯复核跳批次追溯；不得再把去排产、去派工作为第一版主按钮。订单到生产关系表还必须支持按建议操作快速筛选：全部操作、草稿确认、生产确认、扫码报工、人工报工、质量处理、完工入库、补单处理、追溯复核；筛选统计应基于当前客户范围重新计算，便于操作人员按待办类型集中处理。GET /api/production/overview 后端也必须支持 action / primaryActionCode 等参数按建议操作筛选，并返回 actionSummary，保证后续数据量变大时仍能在服务端按待办类型查询。前端生产全局预览已支持读取路由上下文 customer / order / item / workOrder / flowCardCode / keyword / action，外部页面跳转时会自动请求对应生产关系并显示“外部上下文”提示；查询结果加载后会自动高亮并滚动到第一条匹配关系行，并在表格上方显示“当前定位关系”操作条，列出订单、物料、工单、流转卡、库存状态和主操作按钮，避免操作人员跳入页面后还要在大表里找当前订单或工单。当前定位关系操作条还必须提供单字段复制：只复制订单号、物料号、工单号或流转卡号，不得复制整行数据库内容。
38. 批次追溯链路明细展示已补齐去重与降噪规则：GET /api/traceability 的 JSON 过渡路径和 Prisma/PostgreSQL 路径返回链路前，必须按 sourceType、sourceId、targetType、targetId、relationType、quantity、unit 去重，避免同一业务关系因重复写入或推导链路叠加而显示多行；旧历史记录不得静默删除。前端追溯链路表中，如果 sourceTitle / targetTitle 与 sourceCode / targetCode 相同，只显示一次编号，subtitle 也不得重复显示同一编号，避免操作人员误以为产生了多个单号。
39. 客户订单页草稿待办已改为与客户订单总览一致的表格口径：草稿待办不得再使用卡片堆叠作为主展示，也不得放在右侧窄栏中挤压阅读；必须放在客户订单总览下方的全宽区域，表格必须显示草稿号、订单号、客户、日期、订单行、生产需求、来源、异常 / 交付风险、草稿状态和操作入口；支持关键词和状态筛选，显示筛选后 / 全部数量；“处理”必须携带 draftNo、orderDraftAction、autoImportOrderDetail、focusDraft、draftStatus 等上下文跳转订单草稿页，订单草稿页必须显示“来自客户订单页草稿待办”的可见提示并自动反查 / 导入正式订单上下文；“明细”和双击行可打开订单明细，“追溯”保留订单上下文，避免操作人员看到草稿状态但不知道如何处理。
40. 批次追溯页必须优先提供链路图，不得只依赖正向 / 反向清单或明细表格。链路图应按“来源 / 供应 -> 原材料 / 库存 -> 生产执行 -> 质量判定 -> 订单 / 交付”展示主链路；不良、下料补单、补单材料 / 库存、补单工单、补单流转卡、补单证据和回补交付应作为“补单 / 不良分支链路”单独展示，必要时再回接原订单或主工单，不得把同一补单链路在主链路和补单分支里重复展示。前端必须优先使用后端 relationType 识别补单链路，不得只靠中文文案猜测。链路图除分阶段节点外，还必须提供“主链路流向”和“补单分支流向”箭头关系带，逐条显示 source -> target、关系、数量和说明，支持复制单条链路，便于操作人员不看明细表也能理解顺序。追溯明细表保留用于审计、复制和导出，但页面第一阅读入口必须是图形化链路，且必须包含原材料、库存批次、生产工单、flowCardCode、质量记录、补单和订单交付等对象。JSON 过渡层和后端追溯 API 查询 flowCardCode 或 workOrderNo 时，必须受控补出当前工单对应的客户订单、客户和物料节点；但不得因为同一个 itemCode 横向扩散到其他客户订单。链路图顶部必须显示主链路、补单 / 不良分支、风险节点和推导节点摘要，帮助操作人员先判断当前追溯风险范围。链路图节点必须可点击，点击后显示该节点直接上游 / 下游链路和文本关联数量，支持复制节点编号、复制单条链路，并可按该节点重新发起追溯；切换查询后必须清理不存在的旧选中节点。当后端暂未返回订单节点但工单 / 流转卡说明中包含订单号时，前端可标记为“推导节点”用于图形化定位，但不得冒充真实 traceability_links。
41. Prisma/PostgreSQL 追溯上下文补链已完成第一段：GET /api/traceability 的数据库路径查询 flowCardCode、workOrderNo 或 nonconformityNo 时，必须把当前范围内的 customer、customer_order、item、work_order、flow_card、nonconformity 和 blanking_supplement 作为节点补齐，并生成 customer_to_order、item_to_work_order、order_to_work_order、work_order_flow_card、nonconformity_from_flow_card、nonconformity_blanking_supplement 等受控推导链路；这些推导链路只服务当前订单 / 工单上下文，不得把相同 itemCode 的其他客户订单带入当前追溯结果。数据库路径和 JSON 过渡层都必须继续按 sourceType、sourceId、targetType、targetId、relationType、quantity、unit 去重，只隐藏重复展示，不删除旧历史链路记录。
42. Prisma/PostgreSQL 追溯订单节点解析已补齐：GET /api/traceability 的数据库路径遇到 customer_order 链路时，必须按 customer_orders.id 或 customer_orders.orderNo 查询真实 CustomerOrder，并带出 customer、customerName、orderDate、dueDate、status、owner、orderLineCount、totalQty 和订单行 item / drawing 线索；链路图和明细表不得只把订单号当 fallback 节点展示，也不得因解析订单节点而横向扩散到同物料的其他客户订单。附件证据检索必须把 customer_order 的 orderNo、customerId / customerName、订单行 itemCode、customerMaterialCode 和 drawingNo 纳入 businessId 线索。
43. 批次追溯主链路路径带已补齐第一段：前端批次追溯页必须在分阶段链路图和明细表之前显示“主链路路径”，按 traceability_links 的 source -> target 关系和业务阶段推导阅读顺序，把供应 / 客户来源、原材料 / 库存、物料、客户订单、生产工单、flowCardCode、质量和交付对象串成可点击节点路径；补单 / 不良 relationType 必须继续从主路径中排除，并在补单分支链路单独展示。路径节点必须支持点击选中、复用节点详情、复制节点编号和按节点重新追溯，不得替代真实 traceability_links 审计明细。
44. 批次追溯主链路路径关系说明已补齐第一段：主链路路径节点之间的箭头不得只显示方向符号，必须尽量显示对应 traceability_links 的 relationText 和 quantityText；如果相邻路径节点没有直接 source -> target 链路，只能标记为“并行 / 分支”或类似提示，不得让操作人员误以为存在直接业务关系。箭头样式应区分材料、风险、补单和普通关系，补单关系仍以补单分支为主，不应混入主路径审计判断。
45. 批次追溯补单分支路径带已补齐第一段：前端批次追溯页的“补单 / 不良分支链路”中必须提供独立“补单分支路径”，使用补单 relationType 单独串联不良来源、下料补单、补单工单、补单 flowCardCode、补单完工证据和回补交付节点；补单路径节点和箭头必须同样支持点击选中、显示 relationText / quantityText，并复用节点详情、复制和重新追溯能力。主链路路径和补单分支路径不得互相混淆，补单审计仍以补单分支为准。
46. 批次追溯链路明细表筛选已补齐第一段：追溯链路明细表必须作为审计、复制和导出辅助区，不得默认要求操作人员从全部关系里人工寻找重点；前端应提供全部链路、选中节点、主链、补单 / 不良、风险、材料 / 库存、生产、订单 / 客户等快速筛选，并显示当前筛选数量 / 总数量。点击链路图节点时，明细表应自动切换到该节点相关链路；取消选择或切换查询后回到全部链路。筛选只影响明细表展示，不得影响上方主链路图、补单路径、附件证据和原始 traceability_links 数据。追溯页复制能力应支持两种粒度：只复制当前选中节点上下文，或只复制当前筛选下的链路明细；不得把整页数据库内容一次性复制给操作人员。链路图选中节点还必须按节点类型提供业务页面快捷入口：订单 / 客户节点去客户订单，工单 / 流转卡 / 物料节点去生产中心，流转卡节点去扫码报工，批次 / 物料 / 供应商节点去仓库库存，检验 / 不良 / 批次节点去质量检验，不良 / 补单节点去不良处置；跳转只带当前节点编号和必要上下文，不得把整条链路数据塞入 URL。选中节点详情区还必须按节点编号、名称和直接上下游对象匹配相关图纸、SOP、检验证据和供应商证据附件，并可直接打开附件历史；同时必须按当前追溯对象、链路节点和上下游编号跨模块读取 operation_logs，不得只读取 traceability 模块；前端应合并去重 production、inventory、quality、attachment、nonconformity、approval 等相关日志，显示日志模块、动作、对象、说明、操作人和时间，并支持复制当前节点相关日志。该节点证据和日志区只读，不得替代原始附件证据列表、traceability_links 明细和后台审计记录。链路图上方必须提供“追溯完整性检查”，按客户 / 订单、物料 / 图纸、原材料 / 库存、生产工单 / 流转卡、质量 / 检验、补单 / 不良分支、附件证据、时间线 / operation_logs 等维度提示已覆盖、缺失、未发生或需复核，帮助操作人员快速判断追溯链是否缺少原材料、生产或质量证据；完整性检查必须支持复制当前检查结果，复制内容只包含当前追溯对象、数据源、主链 / 补单链数量、缺失项、需复核项和各维度状态，不得复制整页数据库内容。
```

---

## 5. 第一版禁止提前完整开发范围

除非用户明确要求，第一版不得提前完整开发：

```text
1. 完整 IATF 条款矩阵。
2. 完整过程乌龟图。
3. 完整审核证据库。
4. APQP 全流程。
5. PPAP 全流程。
6. FMEA / DFMEA / PFMEA。
7. MSA。
8. SPC。
9. CAPA 全流程。
10. 完整 8D。
11. 审核管理全流程。
12. 管理评审全流程。
13. 风险与应急管理全流程。
```

允许在第一版预留：

```text
relatedClauseId
relatedProcessId
evidenceFlag
evidenceStatus
attachments
operation_logs
approval_records
traceability_links
export_tasks
```

预留不得拖慢第一版订单、库存、工单、报工、检验、追溯闭环。

---

## 6. 当前下一步优先级

P0：从零业务闭环打通

```text
订单草稿后端快照、历史复用和正式订单接口已第一段接入；下一步重点是端到端验收和正式生产链路打通。
支持操作人员选择客户，再新建订单草稿。
支持操作人员在订单草稿页快捷新增客户、编辑当前客户联系人 / 电话 / 搜索信息，保存后自动绑定当前订单草稿。
支持客户搜索按名称、编号、拼音、简码和单字关键词模糊查询；下拉结果按首字母 / 拼音 / 简码排序并可滚动；选中客户后，搜索框区域必须显示可选中复制的客户名称，其他搜索框同理显示当前已选主文本，不在下拉结果内放置复杂复制按钮。
支持历史订单按客户、日期、订单号、项目名、关键字检索。
支持从历史订单选择项目，再选择全部或部分零件，并直接修改数量、单位、库存策略。
支持正式物料、新物料 TEMP-ITEM、图纸号、图纸版本进入同一订单草稿流程。
下单页必须按业务动作分流：客户订单只看正式订单和生产状态；新建订单只处理客户选择、订单行录入、图纸 / 工艺 / 库存策略确认；补单下单必须绑定来源不良单、原订单、原工单或 flowCardCode；订单草稿只作为未保存正式订单 / 未下发生产的队列；工艺路线维护必须在订单行内完成。
批量导入、订单行复核和下单前检查必须能定位到第 N 行，提醒必须写清楚具体行的问题，例如第 2 行工艺路线未确认、第 3 行履约方式未选择、第 5 行库存策略需确认、第 7 行图纸版本待确认。
同一客户订单必须按订单行处理，每个零件可有自己的履约方式和工艺路线，不能假设整张订单只对应一个零件或一套工艺。
订单行生成生产需求前，应允许选择按工序生产、使用库存 / 半成品 / 成品、或库存改制进生产。
按工序生产的新零件必须能手工编辑工艺路线，或引用相似物料 / 历史订单工艺路线后再修改。
工艺路线编辑不要求操作人员跳转背诵，订单行内必须提供常用工序标签、上移 / 下移排序、删除工序、相似物料工艺引用和保存当前订单行工艺的能力；后续可扩展保存为物料工艺模板。
支持从订单行生成生产需求草稿、正式 customer_orders / customer_order_lines、work_orders、flow_cards。
正式订单保存后必须能反查订单行、库存预占、生产需求草稿和操作日志。
已下发生产需求必须可从订单详情或订单草稿直接进入生产中心，并自动按订单、物料、工单或 flowCardCode 定位；生产中心第一版只做生产通知确认、正式生产记录、扫码 / 人工报工、质量处理和完工入库入口，不再做排产 / 派工。
生产中心展示补单需求时，不得只在表格中显示“补单 n 件”文字，必须提供直达不良品补单确认区的操作入口，并把订单、物料、工单、流转卡、不良单或补单号上下文带过去；同一来源不良或同一补单号的入口必须去重，避免误导操作人员重复提交。
```

P1：质量检验与库存批次联动

```text
IQC / IPQC / WIP / OQC / OTHER 检验记录必须可关联 flowCardCode 或 batchNo；FQC 如后续单独启用，必须作为 OQC 或过程最终检验的受控扩展，不得与现有类型混用。
不良品只是检验异常后的处置结果，不是唯一质量流程；质量页必须先有检验入口，再把异常结果流入 nonconformities。
每个检验工序或检验对象必须支持图片、PDF、文本或表格等证据附件；上传前应填写证据类型、标注位置、问题说明或复核结论，便于后续审核和追溯。
质量检验扫码 / 输入定位必须支持 flowCardCode、batchNo、orderNo、workOrderNo、itemCode、customerMaterialCode、drawingNo 和 inspectionNo，并能跳转查看产品编号、订单编号、图纸、SOP、检验要求和追溯链路。
batchNo 检验当前只形成检验证据，不自动放行库存。
库存批次放行、冻结、隔离、退回、报废必须走受控接口和 operation_logs。
库存 qualityStatus 的变化必须可追溯到 inspection_records、approval_records 或 inventory_transactions。
检验队列和检验提交以 GET /api/inspections、POST /api/inspections 为统一方向。
GET /api/inspections 必须同时合并 inspection_records、开放 nonconformities 和待检 / 待判定 / 隔离 / 冻结 / 不合格 / 合格待评估库存批次，库存批次队列行必须标记 sourceType=inventory_batch。
质量放行以 POST /api/inspections/:inspectionNo/release 为受控方向，放行记录不等于库存自动变更。
如需把质量问题库存转为可用库存，必须另走 POST /api/inventory/batches/:batchNo/quality-release，不得由检验记录自动改库存。
sourceType=inventory_batch 的队列行只能打开“库存转可用”流程，不能提交检验记录放行；前端必须用 batchNo 读取库存批次版本后再提交 quality-release。
sourceType=inventory_batch 或带 batchNo 的检验行必须能从质量页查看 GET /api/inventory/batches/:batchNo/transactions，以复核质量放行、冻结、调整、预占释放和相关 evidenceSummary。
质量页允许提供该接口的操作入口，但必须先读取库存批次版本并提交 confirmChecked，不能绕过库存事务。
检验证据附件必须复用附件访问预检、下载授权和受控下载流程。
不良补单确认必须形成闭环入口：质量判定后如需要下料补单，操作人员应能从生产中心、质量页或不良品页直接进入同一补单申请 / 审批 / 完工确认 / 关闭证据流程，避免补单需求只停留在生产提示里；补单页必须展示已补单申请、状态、数量和关联补单工单，防止同一不良重复申请。
```

P2：库存真实业务闭环

```text
库存数量和单位必须分字段处理。
库存更正必须填写数量、单位、原因、日期、备注或依据编号。
库存盘点单号 / 复核记录号可选，但非特殊情况建议填写。
前端不得直接修改库存数量，只能提交后端更正事务。
库存 / 生产质量问题审查、返工、让步接收或改正后转入可用库存，必须走 quality-release 受控动作；该动作不改账面数量，只重算 availableQuantity、写 RELEASE 类型 inventory_transactions 和 operation_logs。
库存被订单占用、释放、转生产、转出库必须保留 traceability_links。
GET /api/inventory/statistics 应作为库存统计汇总入口。
期初库存导入使用 POST /api/inventory/opening-batches/preview 和 POST /api/inventory/opening-batches/submit。
库存盘点使用 POST /api/inventory/stocktake/preview 和 POST /api/inventory/stocktake/submit。
库存退库、转库、冻结 / 解冻必须分别写 RETURN、TRANSFER、FREEZE、UNFREEZE 类型 inventory_transactions。
库存批次流水使用 GET /api/inventory/batches/:batchNo/transactions 方向。
```

P3：生产计划、扫码和人工报工

```text
默认以 flowCardCode 绑定订单、工单、工序和数量。
二维码优先贴在流转卡、周转箱、托盘、包装或批次随行单，不强制每个零件都贴码。
每道工序是否扫码由工艺路线和管理要求控制，不强制所有工序都扫码。
样品、小批量、临时返修允许人工报工，但必须填写 sampleJobNo / manualReason / operator / station / qty。
人工报工和扫码报工都必须写入 operation_records 和 operation_logs。
报工身份必须区分 entryMode、codeCarrier、physicalCodePresent、sampleJobNo 和 manualReason。
手工报工不是无追溯报工，缺少 manualReason 时后端应拒绝。
```

P4：采购、外协、价格成本

```text
先保留模块入口和基础字段。
价格、成本、合同、开票口径必须等用户明确业务规则后再扩展。
涉及金额和税率的字段必须避免前端单独计算成为唯一依据。
```

P5：系统支撑、导出和后台管理

```text
补齐 RBAC、审批中心、附件中心、导出任务、操作日志查询。
导出必须区分前端即时导出和后端 export_tasks。
重要业务导出需要记录 requestedBy、filters、filePath、expiresAt 和 operation_logs。
GET /api/operation-logs 和 GET /api/operation-logs/export 已作为操作日志查询 / 导出方向。
操作日志导出文件必须进入 storage/exports，并记录 export_tasks / access log。
```

---

## 7. 核心业务规则

### 7.1 客户与订单

```text
新建订单草稿前，操作人员必须能选择客户。
默认客户不得硬编码为“百胜制冷公司”。
订单草稿页必须提供轻量客户维护入口：没有客户时可快捷新增客户；已选择客户时可快捷编辑当前客户名称、拼音 / 搜索名、简码、联系人和电话。
订单草稿页快捷维护必须复用 /api/customers 主数据接口，并写入 operation_logs；不得另建一套只存在前端的临时客户资料。
客户状态停用、归档、批量维护、完整资料清理仍归基础资料页面处理，订单页不得承担完整客户后台管理职责。
正式订单保存时必须保留下单当时的 customerSnapshot；后续修改客户主数据不得静默改写历史订单、库存预占、工单、检验记录和追溯证据。
客户订单号、项目名、交期、备注可选，但应尽量保留。
同一客户的历史订单必须可按日期倒序查看，并支持订单号、项目名、客户物料号、公司物料号、图纸号、产品名关键词搜索。
历史常用零件不应铺满页面，应采用搜索、抽屉、折叠横条或项目列表方式保持页面简洁。
```

### 7.2 物料号与新物料

```text
公司正式物料号 itemCode 由系统生成或由授权技术 / 工艺人员确认。
操作人员从 Excel 粘贴时，不要求一定有公司物料号。
Excel 可只包含客户物料号、图纸号、名称、数量、单位。
未精确匹配的行必须进入 TEMP-ITEM 待建档，不得自动当作相似正式物料。
TEMP-ITEM 不得直接生成正式库存事务、正式工单或正式 flowCardCode。
TEMP-ITEM 转正式物料后，订单草稿应可回写 officialItemCode 并重新计算。
```

### 7.2.1 物料主数据证据快照

```text
订单评审、库存复核、生产需求、工单、flowCardCode、检验记录、放行记录和追溯链路必须尽量保留下发当时的物料主数据快照。
快照字段至少包括 customerMaterialCode、invoiceName、drawingNo、drawingVersion、materialGrade、thicknessMm / thickness、inspectionStandard、inspectionRequirement、packagingRequirement。
这些字段用于证明现场生产、质量检验、包装要求和审核证据使用的是同一版受控依据。
后续物料主数据修改，不得静默改变历史订单、历史工单、历史检验记录中的证据快照。
生产现场页面只展示物料识别、图纸、SOP、检验和包装相关信息，不展示价格、成本、合同、开票金额等经营敏感信息。
```

### 7.3 数量与单位

```text
数量和单位必须分字段保存、显示、统计和导出。
不得把 “260 件” 作为唯一数据源保存。
允许展示层组合显示，但后端 DTO、Prisma、统计和导出必须保留 quantity + unit。
单位不一致时必须要求人工确认或按 UnitConversion 受控换算。
单位换算结果要把原始数量、原始单位、目标数量、目标单位、换算系数和来源记录到日志或业务数据。
```

### 7.4 库存分配

```text
同一共享库存池默认按订单数量少优先分配库存，便于小订单优先交货。
操作人员可以逐行选择 auto / use_stock / no_stock / stock_modification / process_production。
库存不要求必须用光。
高要求客户、指定新制客户或特殊订单可以选择不用库存，直接生成全量生产需求。
使用库存后，如果库存件还需要钻孔、焊接、改孔、返修、改装或重新检验，必须生成 stock_modification 类型生产需求，并进入生产计划。
使用库存 / 半成品 / 成品只是履约方式，不等于所有订单行都走同一工序；每个订单行必须独立保留 productionRoute 和 routeSource。
库存占用、释放、转生产、取消订单释放必须写入 inventory_reservations / inventory_transactions / traceability_links。
```

### 7.5 库存更正

```text
库存更正不是前端直接改数。
前端只能提交 afterQty、afterUnit、reason、evidenceNo、adjustmentDate、remark、reviewConfirm。
evidenceNo 可填写库存盘点单号、复核记录号、审批单号或差异处理单号。
库存盘点单号不是唯一入口，但正式业务建议优先填写。
后端必须校验 RBAC、批次状态、库位、单位、调整前数量、调整后数量和幂等键。
更正必须写入 inventory_transactions、operation_logs，并影响 traceability_links。
高风险更正应支持二次复核或审批。
```

### 7.6 图纸、附件和版本

```text
所有下单零件都可以填写 drawingNo、drawingVersion 或关联图纸附件，但不强制。
图纸来源可以是手工填写、订单上传、物料数据库导入或引用受控图纸版本。
生产工单、flowCardCode、扫码报工和人工报工页面必须能让工人查看当前工序相关图纸、SOP 和检验要求。
新上传业务附件不得覆盖旧物理文件。
旧图纸、旧 SOP、旧附件必须保留 storagePath、版本关系、作废 / 替换原因和追溯记录。
前端不得自动删除旧图纸、旧附件或历史版本。
只有系统管理员或授权后台管理员可后台执行受控手动删除，且必须二次确认、填写原因、记录影响范围、写入 operation_logs / approval_records。
默认删除策略是 SOFT_DELETE_ONLY，不物理删除文件。
```

### 7.7 报工、扫码和样品

```text
扫码的核心作用是把现场动作连接到 flowCardCode、workOrderNo、orderNo、itemCode、processStep。
不强制每个零件贴二维码，优先在流转卡、周转箱、托盘、包装、批次随行单上贴码。
样品、小批量、临时返修可以不贴二维码，使用人工报工。
人工报工必须保留人工原因、操作者、工位、工序、数量、时间和审核状态。
人工报工 DTO 必须保留 entryMode、manualReason、sampleJobNo、codeCarrier、physicalCodePresent。
扫码 / 手工来源、物理码状态、样品任务号和手工原因必须写入 operation_logs.afterData.reportIdentity。
报工中出现不良、报废或异常时，应生成 nonconformities 或 nonconformityDrafts，并联动质量判定。
```

### 7.8 检验与不良

```text
IQC 关联原材料或外购库存批次。
IPQC 关联工序、flowCardCode 和 operation_records。
FQC / OQC 关联成品批次、出货批次或 flowCardCode。
inspection_records 可以关联 flowCardId 或 inventoryBatchId。
检验记录不等于库存自动放行。
库存放行、隔离、退回、报废必须有单独受控动作。
不良关闭前必须完成质量判定、补单审批或处置确认。
GET /api/inspections 应作为 IQC / IPQC / OQC 待处理队列的统一查询方向。
GET /api/inspections 返回的库存批次待处理行必须使用 sourceType=inventory_batch、code=QINV-{batchNo}、batchNo={batchNo}，用于把 QA-HOLD、待判定、隔离、不合格或合格待评估库存推送到质量页处理。
POST /api/inspections 应作为 IQC / IPQC / OQC 统一检验记录提交方向。
POST /api/inspections/ipqc 只作为旧过程检验兼容入口。
POST /api/inspections/:inspectionNo/release 只做质量放行证据，不得自动改 inventory_batches 可用状态、自动入库或自动出货。
sourceType=inventory_batch 的库存质量问题行不得调用 POST /api/inspections/:inspectionNo/release，必须调用 POST /api/inventory/batches/:batchNo/quality-release。
库存批次审查改正后真正转入可用库存，使用 POST /api/inventory/batches/:batchNo/quality-release，必须写 RELEASE 类型 inventory_transactions 和 operation_logs。
检验附件查询 / 上传使用 GET /api/attachments/files 和 POST /api/attachments/files。
检验附件预览、下载授权和受控下载使用 POST /api/attachments/access-preview、POST /api/attachments/download-approvals、POST /api/attachments/download-grants/:grantNo/download。
质量页不得自动删除旧附件、静默替换历史证据或绕过受控预览 / 下载权限。
```

### 7.9 追溯、日志和证据

```text
关键业务必须写入 operation_logs。
跨业务对象关系必须写入 traceability_links。
审批类动作必须写入 approval_records。
附件、检验记录、报工记录、库存事务、导出任务均可作为 evidence。
追溯查询必须支持订单、客户物料号、公司物料号、图纸号、批次号、flowCardCode、workOrderNo、nonconformityNo。
追溯结果必须显示客户名称 + 客户编号、供应商名称 + 供应商编号，不能只显示编号。
追溯链路明细必须显示 source / target 的业务类型、编号、名称、补充说明、数量、关系和时间，并支持复制单条链路。
库存批次追溯必须能反查材料来源、供应商、sourceCustomer、sourceOrder、库存事务和相关工单 / 流转卡。
JSON 过渡层如果没有真实领料事务，可以把可用原材料标记为候选材料链路，但必须在 note 中注明“正式系统以 inventory_transactions ISSUE 为准”，不得伪装成真实领料。
批次拆分、返修拆分、部分隔离或质量状态分离时，后续应生成子 flowCardCode 或派生 inventory_batch，并保留父子关系、数量来源和质量状态。
同一张 flowCardCode 不应长期同时代表不同物理状态、不同质量状态或不同处置路径的实物。
```

### 7.10 权限与安全

```text
前端隐藏按钮只是用户体验，不是安全边界。
后端必须用 RBAC 校验关键接口。
一个账号可同时拥有多个角色和权限。
管理员需要能批量查看和维护员工权限。
库存、质量、附件下载、附件作废、后台软删除、导出、审批等动作必须受权限控制。
```

---

## 8. 操作日志归档方案

operation_logs 是系统审计、追溯、质量证据和权限追责的基础事实源。

第一版原则：

```text
operation_logs 只能追加，不允许前端删除、覆盖或静默修改。
业务查询默认读在线 operation_logs。
当前第一版不主动物理删除 operation_logs。
归档是为了控制数据库体积和提升查询性能，不是为了清除历史责任。
```

当前实现状态：

```text
已实现：GET /api/operation-logs 查询、GET /api/operation-logs/export CSV 导出、export_tasks 留存、导出文件 sha256、导出下载日志。
已实现：数据库优先读取 operation_logs，数据库不可用时读取 JSON 过渡层 operationLogs。
未完成：正式按月归档任务、JSONL 归档文件、operation_log_archives 表、归档恢复接口、在线日志与归档日志的统一查询。
当前导出文件路径使用 storage/exports/YYYYMMDD/module/，后续正式归档路径再统一为 storage/exports/operation-logs/YYYY/MM/。
```

热数据保留策略：

```text
默认保留最近 24 个月 operation_logs 为在线热数据。
质量、库存、订单、附件、审批、导出、权限等关键模块日志必须优先保证在线可查。
如果 NAS 磁盘空间充足，可以延长热数据周期；不得低于 12 个月。
```

冷归档方向：

```text
超过热数据周期的日志，后续应按月份归档。
归档文件建议保存到 storage/exports/operation-logs/YYYY/MM/。
归档格式优先 JSONL，必要时同时生成 CSV 供人工审计查看。
每个归档文件必须记录 module、action、targetType、targetId、actorName、beforeData、afterData、occurredAt、logNo。
归档文件必须生成 checksum，例如 SHA-256，用于证明归档后未被篡改。
```

数据库归档表方向：

```text
数据量变大后，可新增 operation_log_archives 或按月分区表。
归档后查询接口必须能同时查在线日志和归档日志。
traceability、attachment history、approval history 不得因为日志归档而断链。
logNo 必须全局稳定，归档前后不能变化。
```

归档权限与审计：

```text
只有系统管理员或授权后台管理员可以执行日志归档、归档校验和归档恢复。
每次归档必须写入 system.operation_log_archive 类型 operation_logs 或后续专用 archive audit 表。
归档任务必须记录归档范围、日志数量、文件路径、checksum、执行人、执行时间和结果。
归档恢复必须二次确认，并记录恢复原因和影响范围。
```

备份要求：

```text
operation_logs 在线数据、归档文件、storage/uploads 和 PostgreSQL backup 必须一起纳入 NAS 定时备份。
关键质量和库存证据归档文件建议至少保留一份离线或异地副本。
归档文件不得由前端提供删除入口。
```

---

## 9. 数据库与迁移规则

Prisma 规则：

```text
schema 唯一路径：database/prisma/schema.prisma
migrations 路径：database/prisma/migrations/
新增字段必须考虑 PostgreSQL 类型、默认值、历史数据迁移、索引和可空性。
关键业务写入必须优先使用 Prisma transaction。
不允许绕过 Prisma 直接写 PostgreSQL，除非是受控 migration 或维护脚本。
```

JSON 过渡层规则：

```text
JSON 可以作为 fallback，但不能成为新核心业务的唯一正式实现。
新增功能如果暂时使用 JSON，必须明确后续 Prisma/PostgreSQL 迁移方向。
JSON fallback 返回结构必须兼容前端 DTO。
```

---

## 10. 前端设计规则

整体方向：

```text
当前 UI 应保持企业 ERP / MES 工具风格。
优先信息密度、清晰表格、稳定筛选、明确操作按钮。
不要做营销式首页、装饰性大卡片、无业务价值的视觉堆叠。
表格字段要适合统计和导出，数量与单位分列。
重要操作使用弹窗、抽屉或分步确认，避免页面杂乱。
```

订单草稿页面：

```text
先选择客户，再录入订单草稿。
订单页应有“新增客户”和“编辑当前客户”轻量入口，减少订单录入时反复跳转；完整客户后台仍在基础资料。
表格粘贴、历史常用、手工补一行应共用同一订单行结构。
历史常用应先显示客户过往订单 / 项目横条或列表，再进入该项目零件选择。
历史零件支持全选、单选、修改数量、修改单位、修改库存策略后加入草稿。
订单明细表内应允许直接修改数量、单位、履约方式、工艺路线和必要备注。
工艺路线编辑必须是订单行级别：可手工输入，也可从相似物料 / 历史订单复制引用后再修改；修改后必须刷新待确认生产需求草稿，但不得覆盖已下发生产记录。
```

客户下单到生产页面分层：

```text
客户订单页只负责正式订单总览、草稿待办、订单明细、交付风险和跨页面入口，不直接编辑批量订单行，也不承担排产 / 派工。
订单草稿页负责新建订单、补单入口分流、订单行录入、历史复用、库存 / 半成品 / 成品 / 库存改制 / 按工序生产策略、图纸和工艺路线确认，以及生产需求草稿下发前复核。
生产全局预览页只负责一行式查看“客户订单 -> 订单草稿 -> 生产通知 -> 正式生产 -> workOrderNo / flowCardCode -> 库存 / 质量下一步”的关系和建议操作，不承担录单、排产和现场派工。
生产中心页只负责已下发生产需求后的生产通知确认、正式生产记录、扫码 / 人工报工、质量处置、完工入库和库存动作入口；首屏默认显示“生产通知待确认”和“已确认生产”，生产关系、库存预占、库存改制和接口边界等辅助信息默认收起，需要时再展开。第一版不显示排产、派工、班组 / 人员 / 工位 / 设备分配和工序负荷。
页面入口必须保持清楚：新订单 / 补单 / 草稿 / 工艺路线 / 生产关系 / 生产中心分开显示，不能把不同业务动作堆在一个无说明区域。
```

库存页面：

```text
库存批次列表数量和单位分列。
库存更正弹窗数量输入框只填数字，单位单独显示或选择。
依据编号可选，但应提示盘点单号 / 复核记录号优先。
更正日期和备注必须可填写。
```

生产与质量页面：

```text
工人现场页面必须优先显示当前 flowCardCode、工序、图纸、SOP、检验要求和报工入口。
工人现场页面不得展示价格、成本、合同、开票金额等经营敏感信息。
质量页面必须支持 batchNo 和 flowCardCode 两类检验入口。
异常行处理必须明确“后端补查”“保留待建档”“使用相似物料”等动作区别。
```

---

## 11. AGENTS.md 与 16949.md 更新规则

AGENTS.md 不再记录逐条开发流水日志。

以后只更新以下内容：

```text
1. 当前总体完成率和模块完成率。
2. 第一版功能边界变化。
3. 当前下一步 P0-P5 优先级。
4. 实际技术架构、目录、命令、端口变化。
5. Prisma schema、关键表、关键字段、证据链变化。
6. 库存、订单、报工、检验、附件、追溯、权限等关键业务规则变化。
7. 用户明确要求写入 AGENTS.md 的需求。
```

不再写入 AGENTS.md 的内容：

```text
1. 每次代码提交式流水记录。
2. 已完成第几段的重复叙述。
3. 临时调试说明。
4. 与当前开发方向无关的细节。
```

如果后续需要保留详细开发日志，应另建：

```text
docs/dev-log/YYYY-MM.md
```

已归档开发日志阅读规则：

```text
每次程序开发不强制读取已归档开发日志。
每次开发必须优先读取 AGENTS.md、当前代码、Prisma schema、package.json、README 和相关测试。
docs/dev-log/YYYY-MM.md 只作为历史参考，不是当前开发主规范。
只有在以下情况才需要读取已归档开发日志：
1. 用户明确要求对比历史开发记录。
2. 当前需求涉及曾经反复修改、回滚或争议较大的功能。
3. 代码和 AGENTS.md / 16949.md 描述明显不一致，需要追溯当时决策。
4. 需要排查旧 bug、历史数据迁移、兼容 JSON 过渡层或旧接口行为。
5. 需要确认某个功能为什么采用当前业务规则。
```

16949.md 只在以下情况更新：

```text
1. 用户明确要求修改 16949.md。
2. 当前第一版业务规则会影响未来 IATF 条款、过程、证据链、审核或体系模块。
3. 需要新增未来 APQP / PPAP / FMEA / MSA / SPC / CAPA / 8D / 审核证据库设计。
```

---

## 12. 验收标准

每个功能完成时至少满足：

```text
1. 前端页面可操作，不只是静态展示。
2. 后端有真实接口或明确 fallback。
3. 关键写入有权限、日志、事务或幂等保护。
4. 数量与单位不混成一个字符串作为唯一数据。
5. 库存、订单、工单、流转卡、检验、不良、附件之间能追溯。
6. 不覆盖用户已有文件和数据。
7. 修改后运行对应测试或构建；无法运行时必须说明原因。
```

---

## 13. 当前默认开发方向

在用户继续要求“继续编辑代码 / 继续编写程序”且没有新业务问题时，默认按以下顺序推进：

```text
1. 验收订单草稿到正式 customer_orders / customer_order_lines 的端到端链路，包括客户选择、历史复用、数量 / 单位 / 库存策略和操作日志。
2. 理顺客户订单、订单草稿、生产全局预览、生产中心之间的页面边界、入口跳转和操作路径。
3. 从正式订单行稳定生成 production demand、work_orders、flow_cards，并确保库存预占和取消释放可追溯。
4. 完善库存期初导入、盘点、退库、转库、冻结 / 解冻的端到端测试和页面反馈。
5. 完善库存批次检验后的受控放行 / 冻结 / 隔离，确保检验记录不直接改库存但能作为放行依据。
6. 完善 flowCardCode 与扫码 / 人工报工 / 检验记录 / 附件图纸的闭环。
7. 增强 operation_logs 查询 / 导出 / 归档和 traceability_links，确保订单、库存、生产、质量、附件能互查。
```
