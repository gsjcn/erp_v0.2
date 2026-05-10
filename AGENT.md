# AGENT.md — 百胜 ERP 第一阶段开发规范

Always respond in Simplified Chinese for explanations.
Keep code, technical keywords, function names, APIs, database fields, file names, paths, commands, and error messages in English.
Do not translate variable names, function names, class names, library names, API paths, database fields, file paths, or command names.

关键业务代码必须保留简洁中文备注，尤其是客户查重、地区校验、多联系人、订单提交、零件流程保存、生产状态流转、仓库入库、库存流水、订单取消、补单和库存来源核对。

---

## 1. 阶段边界

当前只开发第一阶段最小范围。只有用户明确说出：

```text
第一阶段 完成，可以开始下一阶段
```

才允许进入下一阶段，并重新确认范围。未出现该原句前，不得主动扩展完整 ERP、MES、QMS、IATF 16949、质量、追溯、财务、审批、复杂权限或报表中心。

第一阶段允许范围：

- 客户
- 下单
- 每个零件的生产流程选择
- 流程记忆 / 标准工序维护
- 生产
- 仓库
- 库存界面
- 只读统计表

第一阶段主流程：

```text
维护客户 -> 客户下单 -> 为每个订单零件选择生产流程 -> 进入生产
-> 仓库确认入库 / 发货 -> 库存查看 -> 只读统计
```

第一阶段严禁开发：

- 质量、检验、不良品分析、追溯、IATF 16949、APQP、PPAP、FMEA、MSA、SPC、8D、CAPA、审核证据库
- 复杂权限、审批流、财务、成本、开票、采购、供应商体系
- 报表中心、驾驶舱、复杂图表、审批报表、财务报表
- 移动扫码、拍照留证系统、完整附件管理、复杂排产、设备负荷、班组派工、工时绩效

允许的例外：

- 只读统计表可展示年度、季度、月度订单和生产数量，但不得扩展成报表中心。
- 生产过程可记录报废数量、缺件数量和生产报废补单申请；这是生产数量闭环，不等同于质量模块。
- 订单图纸上传、库存盘点附件和图纸在线预览属于基础资料，不等同于完整附件管理或证据库。

超出第一阶段的需求，必须先说明超出当前阶段，不直接开发。

### P0-P5 第一阶段执行计划

优先级只用于第一阶段内部排期，不允许借 P 级计划扩展质量、追溯、IATF、财务、审批、复杂权限或报表中心。

P0 基线和阻断项：

- 项目必须能稳定启动、构建和连接 PostgreSQL。
- `backend:build`、`frontend:build`、Prisma generate / migration / seed 必须可重复执行。
- `.env`、Docker Compose、healthcheck、上传目录、导出目录和 `.dockerignore` 必须符合 NAS 部署要求。
- 若 P0 未通过，不继续开发新业务功能，先修复环境、schema、migration、seed、启动和构建问题。

P1 第一阶段主流程闭环：

- 完成客户新增 / 编辑 / 停用启用 / 多联系人 / 查重。
- 完成客户下单、一个订单多零件、订单号查重和订单提交生产。
- 完成每个订单零件独立选择生产流程，并能使用标准工序和流程记忆。
- 完成生产任务开始、逐道工序确认、最终确认完成。
- 完成仓库确认入库、待发货、确认发货。
- 完成库存查看、库存来源查看和只读统计。

P2 关键业务正确性：

- 客户名称、客户ID、订单号、仓库编码、库位编码必须大小写不敏感查重。
- `OrderNoReservation` 或等价机制必须保证订单号永久占用。
- `STOCK`、`REWORK`、`PRODUCTION` 三种履约方式必须正确处理库存、生产计划数量和生产任务。
- 库存变更必须通过 `InventoryTransaction` 追加流水，关键库存写入使用 Serializable transaction。
- 订单取消、客户数量变更、订单补单、生产报废补单、管理撤回和通知确认必须保留记录。
- 库存盘点必须校验附件，并保留清点人、日期、签字、附件和流水。
- 下单使用库存必须保留 `selectedStockSources`，逐批核对来源、图号、版本、规格、厚度和人工确认记录。

P3 UI、响应式和操作体验：

- Web、手机端、Figma 和文档必须同步 8 个入口：客户、订单、生产流程、流程记忆、生产、统计、仓库、库存。
- 桌面端使用左侧导航，移动端使用顶部品牌栏和横向滚动导航。
- 订单日期、客户、订单筛选顺序必须在订单相关页面保持一致。
- 表格页面必须支持横向滚动，移动端筛选区纵向排列，控件高度和字体满足移动端可点击要求。
- `orderNo` / `sourceOrderNo` 链接优先复用 `OrderNoLink.vue`，图纸入口优先复用 `DrawingPreviewLink.vue`。
- 通知确认、取消订单、管理撤回、盘点调整等关键操作必须使用 `el-dialog`，不得使用 `window.prompt` / `window.confirm`。

P4 验收、测试数据和部署验证：

- `seed.ts` 必须覆盖当前第一阶段需要的客户、订单、生产任务、仓库、库存、物料、流程备注、补单和通知场景。
- 新增数据库表或改变业务关系后，必须重新执行 migration + seed。
- 至少完成主流程手工验收：客户 -> 下单 -> 零件流程 -> 生产 -> 入库 / 发货 -> 库存 -> 统计。
- 对库存扣减、入库、发货、盘点、订单取消和补单做回归验证。
- Docker Compose 部署必须能通过 postgres、backend、frontend healthcheck。
- README 必须记录本地开发、NAS 部署、迁移、seed、备份目录和常见启动问题。

P5 优化和暂缓项：

- 可优化前端 chunk 体积、页面加载速度、表格列宽、打印样式和导出体验。
- 可整理第一阶段内的代码复用、注释、空状态、错误提示和移动端细节。
- 可记录下一阶段候选需求，但不得开发下一阶段页面、数据库表或业务流程。
- P5 不得阻塞 P0-P4 验收，除非问题影响第一阶段主流程或数据准确性。

下一阶段候选需求记录：

- 管理员可为每个账号配置权限。候选范围包括人员账号、角色、权限点、登录认证、后端 Guard 校验、前端按钮可见性控制和操作日志。
- 第一阶段暂不开发管理员权限配置系统；当前阶段只保留后端岗位校验，例如下单 / 计划人员填写生产流程和提交生产，车间主任开始生产和确认生产，车间人员查看流程并按流程生产。

---

## 2. 技术架构与部署

推荐技术栈：

- `database`: PostgreSQL 16
- `ORM`: Prisma
- `backend`: NestJS + TypeScript + Node.js
- `frontend`: Vue 3 + TypeScript + Vite + Element Plus
- `deployment`: Docker Compose
- `reverse proxy`: Nginx 或 Caddy
- `storage`: NAS 本地目录，后续可迁移到 MinIO / S3

原则：

- 正式数据库首选 PostgreSQL；不得使用 JSON 文件或 SQLite 作为正式生产数据库，不建议 MongoDB 作为主库。
- 前后端必须使用 TypeScript；前端用 Vue 3 Composition API；后端用 NestJS 模块化；数据库访问统一通过 Prisma。
- 业务数据、附件、备份、Prisma schema 和 migration 必须可从 TerraMaster F4-424 MAX 迁移到服务器。

NAS 部署：

- 第一阶段使用 Docker Compose，PostgreSQL、backend、frontend 分容器部署。
- PostgreSQL 数据目录优先放 SSD / NVMe；上传、导出和备份放 NAS 本地 `storage` 目录。
- PostgreSQL 不直接暴露公网，只允许 backend 访问。
- `docker-compose.yml` 必须为 postgres、backend、frontend 配置 healthcheck。
- 上传目录、导出目录、PostgreSQL 数据目录和备份目录必须通过 `.env` 配置，不得写死容器内部路径。
- `.env` 中 `UPLOAD_DIR`、`EXPORT_DIR` 表示 NAS 宿主机挂载路径；backend 容器内必须显式使用 `/app/storage/uploads`、`/app/storage/exports`。
- backend 必须在 `AppModule` / Controller 装饰器加载前完成 env bootstrap，确保上传目录和 `DATABASE_URL` 已生效。
- 仓库根目录必须维护 `.dockerignore`，避免把 `node_modules`、日志、数据库目录、上传图纸和导出文件打进 Docker build context。

建议目录：

```text
frontend/                     Vue 3 前端
backend/                      NestJS 后端
database/prisma/schema.prisma Prisma schema
database/prisma/migrations/   Prisma migrations
database/postgres-data/       PostgreSQL 数据目录，不提交 Git
database/backups/             PostgreSQL 备份目录，不提交 Git
storage/uploads/              上传文件目录
storage/exports/              导出文件目录
docker-compose.yml            NAS 部署入口
README.md                     部署和运行说明
AGENT.md                      当前开发规范
```

数据库设计习惯：

- 核心表必须有 `id`、`status`、`createdAt`、`updatedAt`。
- 业务表必须保留稳定编号，例如 `orderNo`、`partCode`、`productionTaskNo`。
- 订单必须支持 order lines，不得只做订单总表。
- `Material` 只保存物料编码、名称、单位、规格等基础字段，不保存库存数量。
- 每个零件的生产流程必须独立保存，不得保存成一个长字符串。
- `quantity` 和 `unit` 必须分字段。
- 库存变化必须通过 `InventoryTransaction` 追加记录，不得静默改总数。
- 必要时保留 snapshot，例如 `customerSnapshot`、`processSnapshot`。
- 可预留 `relatedProcessId`、`relatedClauseId`、`evidenceStatus`、`sourceRecordType`、`sourceRecordId`，但不得在第一阶段展开质量、追溯或 IATF 页面。

---

## 3. 跨端、UI 与 Figma

本系统第一阶段按 responsive Web application 开发，不做原生 Android、iOS、HarmonyOS、Windows 或 macOS 客户端。

跨端规则：

- 同一套前端必须适配 Android 浏览器、iOS Safari、华为 / HarmonyOS 浏览器、Windows 浏览器、macOS 浏览器。
- 不得在前端写死 Windows、macOS、NAS 本地路径或浏览器私有 API。
- 后端 API 必须平台无关，前端只通过 HTTP API 访问业务数据。
- 本地开发前端端口固定 `5176`，Vite 必须绑定 `0.0.0.0` 并启用 `strictPort`，避免回落到 `5173` / `5175`。
- 手机真机测试不能用 `localhost`，必须用开发电脑局域网 IP。

前端结构：

```text
frontend/src/config/       导航和基础配置
frontend/src/composables/  设备、响应式、复用状态
frontend/src/layout/       桌面 / 移动通用布局
frontend/src/views/        业务页面
frontend/src/api/          HTTP API 封装
frontend/src/types/        TypeScript 类型
```

响应式规则：

- 桌面端使用左侧导航；移动端使用顶部品牌栏 + 横向滚动导航。
- 移动端断点优先 `900px`。
- 表格页面必须允许横向滚动，不能挤到文字重叠。
- 筛选区在移动端纵向排列。
- 移动端按钮、输入框、选择框可点击高度不低于 `44px`；输入框字体不小于 `16px`。
- 必须支持 `safe-area`；不得把 hover 作为唯一操作方式。
- 推荐验证尺寸：390 x 844、768 x 1024、1024 x 768、1366 x 768、1440 x 900。

导航和通用组件：

- 当前 `navItems`: 客户、订单、生产流程、流程记忆、生产、统计、仓库、库存。
- Web、手机端、Figma 和文档必须同步这 8 个入口。
- 有上下级关系的页面顶部显示当前位置路径；上一级可点击；返回按钮使用图标，不显示中文。
- 所有业务表格中的 `orderNo` / `sourceOrderNo` 必须可点击进入订单明细，并保留 `returnTo` 上下文。
- 前端订单号链接优先复用 `OrderNoLink.vue`。
- 图纸入口优先复用 `DrawingPreviewLink.vue`。
- 日期范围控件优先复用 `DateRangeFilter.vue`。
- 客户筛选优先复用 `CustomerSelect.vue`。
- 订单筛选优先复用 `OrderSelect.vue`。

筛选和搜索：

- 订单总列表、生产流程、生产任务、仓库操作等涉及订单范围的页面，筛选顺序必须是：订单日期、客户、订单。
- 订单日期不是必填；选择日期段后必须能查询该日期段全部客户订单，再选择客户或订单只是缩小范围。
- 不选择具体订单时，页面必须按当前日期 / 客户范围展示全部订单或全部任务，不能显示空结果。
- `OrderSelect` 只在父页面日期 / 客户筛选范围内做本地过滤，不得改变父页面筛选范围；切换客户或订单日期后，必须同步刷新订单候选和业务表格。
- 客户下拉必须支持中文关键字、拼音、首字母缩写；空关键字点击下拉时显示全部可选客户并可滚动。
- 所有业务筛选里的客户下拉只显示客户名称；客户ID、联系人、电话和地区不得出现在下拉项里，避免筛选控件过载。搜索仍可命中客户名称、客户ID、联系人、电话、地区、拼音和首字母。
- 订单下拉选择框只显示订单号，客户、日期、交期、零件数等放在下拉选项或选择框下方说明。
- 搜索栏、远程下拉、自动补全和筛选结果不得静默 `take`、`limit`、`pageSize` 或 `slice(0, n)` 截断。若未来分页，UI 必须明确显示分页 / 继续加载 / 总数。
- 允许截断的场景仅限文件名安全截断、日期格式化、编号生成、上传大小限制、连续工序区间等非搜索结果。

Figma：

- 只维护一个 Figma 文件，不得为 Web、手机或修改重复创建多个文件。
- 当前唯一 Figma 文件：`百胜ERP v0.2 第一阶段 手机版UI`，file key: `eBsaAwDmqHSmaFKT9mzCXY`。
- 文件内必须同时保留 Web UI Board 和手机版 UI Board。
- Web 端默认 1440 x 900，手机版默认 390 x 844。
- Figma 只表现第一阶段页面和交互，不加入质量、追溯、IATF、财务、审批、权限等下一阶段内容。
- 设计风格与 Element Plus、浅灰背景、蓝色主按钮、表格优先、8px 或更小圆角保持一致。
- Figma 手机版必须体现顶部品牌栏、横向滚动导航、当前位置路径、图标返回、单列筛选、移动卡片或横向滚动表格。

---

## 4. 客户

页面范围：客户列表、新增、编辑、停用 / 启用、搜索、按状态筛选。

字段：

```text
customerCode, customerName, contactName, contactPhone, address,
regionType, country, province, state, district, city, detailAddress,
remark, status
```

规则：

- `customerName` 必填且必须自动查重；后端和数据库都要防重复。
- `customerCode` 是客户ID且唯一；创建时可留空自动生成，手工填写必须自动查重。
- 新增客户时，客户ID输入框下方显示“如果不填写，这次客户ID自动生成为 xxxxx。（一旦生成不可更改）”。
- 客户ID保存后不可更改；前端禁用，后端拒绝修改。
- 中国客户必须选择 `province` 和 `city`，`detailAddress` 可不填。
- 国外客户必须选择或填写 `country`；`state`、`province`、`district`、`city`、`detailAddress` 都可不填。
- 联系人使用 `CustomerContact` 明细表，支持多个；有联系人时必须且只能选择一个 `isPrimary=true`。
- `Customer.contactName`、`Customer.contactPhone` 只作为当前主要联系人快照。
- 没有联系人时客户自动停用，但 `customerCode` 和 `customerName` 继续保留并占用；同时清空联系人快照。
- 停用客户不能创建新订单；前端和后端都必须拦截。
- 客户资料搜索支持客户名称、客户ID、联系人、电话、地区、全拼和拼音首字母。

---

## 5. 订单与下单

页面范围：选择客户、新增订单、编辑订单、录入订单零件、提交订单、查看订单状态。

订单零件字段：

```text
partName, partCode, drawingNo, drawingVersion, drawingFileName,
drawingFileUrl, partThickness, partSpecification, quantity,
productionPlanQuantity, unit, deliveryDate, remark
```

订单号：

- 订单号默认自动生成，但 DRAFT 新增和编辑时允许手工修改。
- 查重由输入框自动触发，保存时再次强制校验，不得要求点击“查重”按钮。
- 查重大小写不敏感；后端保存手工订单号必须统一转大写。
- 数据库必须保留 `LOWER(orderNo)` 唯一约束或等价机制。
- 订单详情、编辑、提交生产和生产流程接口必须支持大小写不敏感查询。
- 订单号一旦创建即永久占用；即使取消、归档或迁移，也不得复用。
- 自动生成、手工查重和保存订单必须检查 `OrderNoReservation` 或等价表。

物料和数量：

- 订单必须支持多个零件；新增订单默认可预置 3 行，但必须允许删除误填零件；至少保留 1 个零件。
- 零件编码必须支持从 `Material` 搜索选择；搜索大小写不敏感，支持拼音和首字母。
- 选中物料后自动带出 `partCode`、`partName`、`unit`、`partSpecification`；库存数量从 `InventoryBatch` 实时汇总。
- `quantity` 表示客户订单数量，`productionPlanQuantity` 表示实际生产计划数量，二者必须分开统计。
- `deliveryDate` 可在订单总表或订单零件填写；后续页面优先显示零件交期，缺失时显示订单总交期。
- `partThickness` 必填；`partSpecification` 表示成品规格，可选或手工输入。

图纸：

- `drawingNo`、`drawingVersion`、`drawingFileName`、`drawingFileUrl` 分字段保存。
- 保存前必须检查当前订单和历史订单的重复图号；重复时提示操作人员确认。
- 上传相同 `drawingFileName` 时，选择文件时先提示确认并展示当前图纸和重复图纸入口；保存时后端再次兜底检查。
- 订单新增、编辑、订单明细和生产工序完成表中，只要存在 `drawingFileUrl`，必须提供预览或打开入口。
- PDF 和图片优先在线预览；DWG / DXF 至少提供打开或下载入口。
- 新增和编辑订单的“订单零件”标题旁必须保留感叹号说明图号 / 图纸重复确认规则。

履约方式 `fulfillmentMode`：

- `PRODUCTION`: 重新生产，按 `productionPlanQuantity` 生成 `ProductionTask`；生产计划数量可以小于、等于或大于客户订单数量，但只要与建议生产数量不一致，必须记录下单 / 计划操作人员账号和调整说明。
- `STOCK`: 优先使用备货库存，提交时将已选备货库存转成该订单待发货库存并追加 OUT / IN 流水；库存不足的剩余数量自动进入生产计划。
- `REWORK`: 使用备货库存修改再加工，先按 `productionPlanQuantity` 扣减备货库存并追加 OUT 流水，再生成 `ProductionTask`。
- 创建或编辑 DRAFT 时可以提示库存不足但不阻止保存；提交生产时必须强制校验已选库存批次、数量和人工确认记录。`STOCK` 允许只选部分库存并把剩余数量转生产计划，`REWORK` 必须选满领料数量。
- 创建或编辑 DRAFT 时，`STOCK` / `REWORK` 可以暂时不选择库存来源并保存草稿；`REWORK` 也允许先部分选择库存批次并保存草稿，但提交生产前必须补齐到 `productionPlanQuantity`。
- 创建或编辑 DRAFT 时，只要已经选择库存批次，就必须校验批次存在、未超量和必要的人工确认记录。
- 提交生产时后端必须基于数据库中最新草稿明细重新执行订单行、库存来源、选用数量、人工确认和生产计划偏差校验；不得只依赖创建或编辑订单时的前端校验结果。
- 同一订单内相同 `partCode` / `unit` 的 STOCK 和 REWORK 需求必须合计校验，不能只按单行判断。
- 同一草稿订单内多个零件选择同一库存批次时，库存来源弹窗必须扣除其他零件已选数量后再显示当前可用数量；即使该批次是跨物料搜索选中的替代库存、不在当前库存列表内，也必须扣减本订单其他零件已选数量。保存和提交时后端必须按同一批次合计校验，不能让每个零件都按原始库存数量计算。
- 前端 `selectedStockSources.availableQuantity` 必须表示后端扣除其他订单预占后的批次总可用量；当前弹窗/当前零件的可用量必须单独计算，并额外扣除本订单其他零件已选数量，不能把两者混用。
- `STOCK` 表示优先使用库存，不要求库存覆盖全部客户订单数量；库存不足时系统必须按 `客户订单数量 - 已选库存数量` 自动计算 `productionPlanQuantity`，并在生产计划数量旁提示“此零件，客户要求 X，库存已有 Y，按需生产 Z”。
- `productionPlanQuantity` 是建议生产数量的默认值，不是上限；操作人员可少做或多做，但任何与建议数量不一致的情况都必须记录当前操作人员账号和说明，例如备货、找到其他不计入库存的替代产品或客户确认少做。
- 库存来源变化时，前端只能自动同步仍跟随建议值的 `productionPlanQuantity`；如果操作人员已经手动填写了多做或少做计划，不得在库存核对或确认时覆盖其生产计划和偏差说明。
- `STOCK` 已选库存覆盖全部客户订单数量时，不生成 `ProductionTask`；提交生产后库存直接转为该订单待发货库存。
- `STOCK` 全量使用库存且已形成订单待发货库存时，即使没有 `ProductionTask`，订单生产状态也应视为已完成，不得显示为待确认生产。
- `STOCK` 已选库存只覆盖部分数量时，提交生产必须先扣减已选库存并转入订单待发货库存，再按剩余 `productionPlanQuantity` 生成正常生产任务。
- `STOCK` 部分使用库存的订单行，只有库存覆盖部分和剩余生产任务对应的订单库存都发货后，才允许订单进入 `COMPLETED`；不得只因库存覆盖部分已发货就关闭订单。
- 生产流程配置页按 `productionPlanQuantity` 判断是否需要工序；计划数量为 0 的零件不生成生产任务且跳过工序，但计划数量与建议数量不一致时仍必须记录操作人员账号和说明。
- 库存来源默认按适配程度和库存数量从少到多使用；操作人员可以手动调整已选库存使用顺序。
- 如果操作人员跳过数量更少的同零件同单位库存，先使用数量更大的库存批次，必须填写人工确认人员、时间和原因说明。
- 直接使用库存时，本次订单缺图号、版本、规格或库存来源资料不完整不得直接硬拦截；必须转为人工确认记录，由操作人员说明为什么可以使用该库存。

订单提交和变更：

- 只有 DRAFT 订单允许提交生产；进入生产、入库、发货、完成或取消后，不得再次提交改变生产任务。
- 已开始生产的订单不能当作草稿修改；补单、数量变更、新增物料必须走订单变更流程并通知生产 / 仓库。
- 未开始生产的订单或零件不得创建补单，应修改 DRAFT 或正常订单。
- 禁用“补单”“数量变更”“新增补单物料”“取消订单”时，必须用 tooltip 或页面提示说明原因。
- 订单页面的补单只表示销售 / 计划原因的客户追加或数量增加，来源记录为 `ORDER_CHANGE`。

订单列表：

- 订单总列表不得使用“仓库阶段”命名；面向操作人员的列名和筛选项使用“生产状态”。
- 顶部搜索栏必须有“订单状态”和“生产状态”多选勾选筛选，可通过取消勾选排除某些状态。
- 后端查询必须支持 `statuses` 和 `productionStatuses`，不得只支持单一状态。
- 面向操作人员展示订单进度时，不得只把 `OrderStatus.COMPLETED` 显示为“已完成”；必须结合生产和仓库阶段显示为“生产中”“已完成未发货”或“已完成发货”。
- 订单总列表、订单下拉、订单明细、生产流程页和统计订单展示必须复用同一订单展示状态口径；草稿显示“待提交生产”，已取消显示“已取消”。

---

## 6. 生产流程与流程记忆

生产流程基础工序：

```text
激光切割、折弯、冲压、焊接、打磨、喷涂、装配、包装、其他
```

标准工序和参数：

- `processName` 必须来自标准工序清单，例如“冲压”。
- 次数、R角、孔位、特殊要求保存到 `processRemark`，不得把“冲压+4次”作为 `processName`。
- 后续统计只能按 `processName` 聚合，`processRemark` 只用于现场说明、打印、导出和完成表展示。
- seed 测试数据必须覆盖 `processRemark` 示例。
- 新建标准工序必须校验重复工序名称；重复时提示且不允许保存。

订单零件流程：

- 每个订单零件必须单独选择生产流程，不同零件可不同。
- 同一个零件可选择多个步骤，步骤可排序。
- 同一个订单零件内不允许重复保存相同工序名；若业务上需要多次同类工序，用 `processRemark` 记录次数或参数。
- 生产流程选择结果必须能在生产页面看到。
- 只有 DRAFT 订单允许编辑生产流程；订单提交生产后只能查看，前端禁用，后端拒绝修改。
- 左侧卡片描述使用“零件流程配置进度”。
- 保存按钮文案使用“保存零件流程”。

流程记忆：

- 流程记忆保存为 `ProcessTemplate` 或等价数据库表，不得写死在前端数组。
- 模板只保存 `templateName`、steps、remark 等可复用组合，不绑定客户、订单或零件号。
- `frontend/src/views/ProcessTemplatesView.vue` 维护同一批模板。
- 标准工序通过 `/api/process-definitions` 创建、编辑、停用 / 删除和搜索。
- 流程模板通过 `/api/process-templates` 创建、编辑、复制、删除、搜索和应用。
- 订单页面、生产流程页面和流程记忆页面不得维护各自独立的工序列表。
- 流程模板和标准工序搜索支持中文关键字、拼音和首字母，后端不得静默截断。
- 生产流程选择页和流程记忆导航页都必须能搜索、应用、新建、编辑、删除流程记忆。
- 模板悬停或点击预览必须显示工序、工序备注和模板备注。

生产流程页面 `/processes`：

- 默认先按订单日期、客户、订单条件查询订单列表；选择具体订单后才进入该订单零件流程配置界面。
- 订单列表操作文字使用“工序设定”，订单明细入口使用“订单明细”或“查看订单明细”。
- 从订单明细切入时可通过 `orderNo` 和 `returnTo` 直接打开该订单流程配置。
- 左上角返回和“查看订单明细”必须优先回到切入来源；从导航页进入则返回订单查询列表。

---

## 7. 生产

生产状态：

```text
PENDING, IN_PROGRESS, COMPLETED
```

生产页面范围：

- 待确认生产、生产中、待确认完成、已完成、已入库列表
- 订单生产汇总首页
- 订单生产详情
- 开始生产
- 批量开始生产
- 逐道工序确认完成
- 工序完成表填写数量、操作人员、备注
- 生产最终确认
- 生产报废统计只读入口
- 导出 Excel、A4 横版打印预览和打印

工序确认：

- 生产页面必须显示订单号、客户、订单日期、交期、零件、客户订单数量、完成 / 生产计划、生产流程。
- 任务必须先开始生产进入 `IN_PROGRESS`，才允许保存工序完成表；后端拒绝 `PENDING` 直接保存工序完成。
- 必须点击具体工序填写工序完成表；确认完成的工序才变绿色。
- 流程按保存顺序确认；未完成上一道时，后续工序前端置灰，后端拒绝跳过。
- 允许在同一完成表内勾选连续后续工序一起确认；后端校验连续且未跳过。
- 所有工序确认后，任务进入有效状态“待确认完成”，不得自动 `COMPLETED`；必须点击“确认完成”并填写最终数量。

生产首页和订单汇总：

- 生产首页默认展示订单生产汇总，不得默认把所有零件生产任务平铺在首页。
- 订单生产汇总按订单聚合展示：订单号、客户、订单日期、交期、零件数 / 任务数、待确认生产数量、生产中数量、待确认完成数量、已完成数量、已入库数量和整体进度。
- 首页状态筛选优先按订单级状态展示：全部、待处理、待确认生产、生产中、待确认完成、已完成、已入库。
- 首页保留“零件任务明细”视图入口，原零件级任务表可作为明细视图保留，用于排查单个零件任务。
- 点击订单应进入订单生产详情，展示该订单所有生产任务和每个零件的生产情况。
- 订单生产详情中展示每个任务的任务号、零件、生产流程、当前工序进度、完成 / 生产计划、状态和操作按钮。
- 车间主任可在订单汇总行直接批量开始生产，也可进入订单生产详情后勾选多个待确认生产任务批量开始生产。
- 批量开始生产必须弹出 `el-dialog`，选择车间主任，展示本次将开始的任务清单，默认勾选该订单下所有 `PENDING` 任务，并允许取消勾选部分任务。
- 批量开始生产后端必须逐项校验：订单未取消、任务未入库、任务未完成、任务状态仍为 `PENDING`，且操作人员必须是车间主任。
- 批量开始生产建议使用接口 `POST /production/tasks/batch-start`，payload 包含 `taskIds` 和 `supervisorCode`。
- 订单生产汇总建议使用接口 `GET /production/tasks/order-summary`，由后端按当前日期、客户、订单条件聚合返回，不得只在前端对截断列表做聚合。

操作人员：

- 操作人员列表由后端接口提供，当前可固定列表，但不得只写死在某个前端页面。
- 每个操作人员必须有唯一账户ID，用 `operator.code` / `accountId` 表示；未来身份证只能脱敏或合规保存。
- 下拉必须支持姓名、账户ID、角色、拼音和首字母搜索；例如顾胜钧可用 gsj、gs、顾、胜、jun 命中。
- `/api/production/tasks/operators` 必须支持 keyword 查询。
- 前端远程搜索必须保留已选人员缓存，并按当前 keyword 过滤候选；输入 zm 时不得显示顾胜钧。
- 工序完成表和最终完成弹窗允许不填操作人员，也允许多选；如填写，前端只提交 `operatorCodes`，姓名和角色由后端补全。
- 同时完成多个工序时，每道工序都可单独填写 `operatorCodes`，后端分别保存操作人员和修改日志。

数量规则：

- 后一道工序默认完成数量继承上一道有效完成数量。
- 如果填写超过上一道工序数量，必须警告并要求填写 `quantityOverrideReason`，例如补单一起做、历史库存补入、前道未上报。
- 最终完成数量可小于 `plannedQuantity`，但必须填写 `scrapQuantity`，并选择生产报废补单申请或管理确认缺货完成。
- 不补单时必须填写 `managerName` 和 `shortageReason`，例如库存抵扣、客户取消部分数量、车间管理确认缺货完成。
- 最终完成数量可大于 `plannedQuantity`，超出客户订单数量的部分由仓库确认入库时转备货库存。
- 已经仓库入库的任务不得再修改工序完成表或最终完成数量。
- 未入库前允许管理撤回误操作；已经入库不得撤回。

报废和补单：

- `ProductionScrapRecord` 记录 `recordDate`、`orderNo`、`productionTaskNo`、`partCode`、quantity、unit、reason。
- 生产页面因报废、缺件产生的补单必须走 `ProductionReplenishmentRequest`，`sourceType=PRODUCTION_SCRAP`，由生产人员发起，车间主管审批。
- 生产报废补单申请 `PENDING` 时不得直接生成补单任务；主管 `APPROVED` 后创建 R01 / R02 等补单 `ProductionTask`，并写入 `replenishmentSourceType` 和 `replenishmentSourceRequestNo`。
- 主管 `REJECTED` 时必须保留 `ProductionReplenishmentRequest` 和 `ProductionProcessCompletionLog`。
- 同一个 `orderLineId + sourceProductionTaskNo` 只能存在一条 `PENDING` 补单任务；重复提交必须更新现有 PENDING，不得生成重复 R01 / R02。
- 订单明细页的补单用于销售 / 计划原因；生产页的补单用于报废 / 缺件，二者来源必须区分。

订单取消和管理撤回：

- 所有订单必须有取消入口；订单总列表和订单明细页都应允许取消未完成、未取消订单。
- 未开始生产的正常订单取消时，删除未开工任务并释放已占用库存。
- 已开始生产的订单取消时，`CustomerOrder.status=CANCELLED`，客户订单数量归零；未开始的 PENDING 任务删除，已开始任务保留并生成生产和仓库通知。
- 取消弹窗必须让管理人员选择“未生产取消”或“已生产取消”；若与数据库生产进度冲突，后端拒绝并提示刷新。
- 取消订单和取消补单必须填写 `managerName` 和 reason，前端展示系统自动日期，后端写入订单备注和通知记录。
- 已生产取消订单时，弹窗同页展示每个已开工任务处理计划，逐项选择 STOCK、SCRAP 或 NONE，并填写数量或说明。
- 已生产取消不得自动入库；仓库逐项确认转备货、报废或无实物处理。
- 补单取消分两类：未开始生产可在订单明细取消；已开始生产必须到生产页“管理撤回”，并保留原因、处理方式和日志。
- 判断任务是否开始不能只看是否存在预建工序记录，必须以任务状态或有效进度字段为准。
- 管理撤回不得用 `window.prompt`；必须用单页 `el-dialog`，包含管理人员、原因、可修改处理日期、处理方式、处理数量和说明。
- 撤回入库存只生成仓库待确认通知，不得静默入库；报废写 `ProductionScrapRecord`；无实物处理数量必须为 0。

通知和导出：

- 补单、客户数量变更、客户新增物料、取消订单必须生成 `ProductionNotice`；生产端 `target=PRODUCTION`，仓库端 `target=WAREHOUSE`，确认状态分开保存。
- 通知确认不得使用 `window.prompt` / `window.confirm`；必须用系统 `el-dialog`，包含通知摘要、确认人员、确认时间，并通过后端 API 记录。
- 可复用 `frontend/src/components/NoticeAcknowledgeDialog.vue`。
- 生产报废统计筛选必须使用统一日期、客户、订单控件；客户筛选必须用 `customerId`，不能只靠订单号或关键字模糊查。
- 生产计划表支持导出 Excel；字段与当前筛选结果一致。
- 打印预览和打印固定 A4 横版；列宽优先保证任务号、订单号、客户、订单日期、交期、零件、完成 / 计划、生产流程可读。
- 完成数量为 0 时不显示“0 + unit”，可只显示单位并与计划数量分隔。

---

## 8. 仓库

页面范围：仓库列表、库位列表、生产完成待入库、确认入库、待发货、确认发货、库存出库记录查看、仓库通知。

字段：

```text
warehouseName, locationName, orderDate, deliveryDate, partName,
quantity, unit, status, remark
```

规则：

- 生产完成任务必须先进入仓库待入库，仓库确认后才进入库存。
- 确认入库弹窗必须选择 warehouse 和 location，可填写 remark；remark 写入 IN 流水。
- 客户订单数量以内作为订单库存进入待发货；超过客户订单数量的部分拆分为无订单绑定备货库存，即使属于 `productionPlanQuantity`。
- 确认发货必须弹窗确认，展示库存批次、订单号、零件、数量、仓库 / 库位，并可填写 remark。
- 确认发货后批次改为 `USED`，追加 OUT 流水。
- 仓库待发货和发货确认只允许处理 `sourceOrderId` 不为空、`status=AVAILABLE`、`quantity > 0` 的订单库存。
- 例外：订单发货确认中，若客户要求超过订单未发货数量继续发货，允许显式选择 `sourceOrderId=null` 的备货库存作为超发来源；必须绑定 `orderLineId`，填写仓库确认人、销售确认人和超发说明，并通过 `InventoryTransaction.orderLineId` 记录到具体订单零件。
- 待发货列表、单批发货和整单 / 批量发货弹窗必须提供“来源 / 图纸”入口，显示生产订单、任务、日期、图号、版本、图纸文件、规格、厚度。
- 从待发货进入库存来源弹窗时，必须高亮当前准备发货批次。
- 待入库列表和确认入库弹窗也必须展示图号、版本、图纸、规格和厚度。
- 待发货支持按订单批量选择同一订单全部待发货零件 / 批次；批量发货必须同一事务，且一次只能属于同一订单。
- 待发货订单号筛选必须匹配 `sourceOrderNo`、`sourceProductionTaskNo` 和生产任务对应 `orderNo`。
- 部分发货时订单显示待发货 / 部分发货；全部订单库存发完后 `CustomerOrder.status=COMPLETED`。
- 仓库页面展示 `target=WAREHOUSE` 的待确认通知，独立于生产端确认状态。
- 仓库编码和库位编码由后端转大写；`warehouseCode` 全局大小写不敏感唯一，同一仓库内 `locationCode` 大小写不敏感唯一。
- 仓库仍属于第一阶段最小操作，不加入审批、扫码、库龄、盘点、批次追溯或质量放行。

---

## 9. 库存

页面范围：库存列表、按零件搜索、按仓库搜索、按客户 / 订单搜索、查看数量、状态、批次、来源、盘点调整。

字段：

```text
partName, partCode, quantity, unit, warehouseName, locationName,
sourceOrderNo, orderDate, deliveryDate, status
```

基础查询：

- 库存页面支持 `keyword`、`customerId`、`warehouseId`、`orderNo`、`status`。
- `keyword` 必须支持数据库 `Material` 下拉搜索，大小写不敏感；物料可无库存。
- `keyword` 同时匹配 `partCode`、`partName`、全拼、首字母、`batchNo`、`sourceOrderNo`、`sourceProductionTaskNo`、`sourceCustomerName`、`warehouseName`。
- 例如 pt 可命中 PT 开头任务或批次；cycsgb / cy 可命中“冲压测试盖板”。
- 订单号筛选必须匹配当前绑定订单、备货库存原生产任务和生产任务对应订单。
- 查询到物料但无库存批次时，必须显示该物料当前查询范围库存为 0，不能只显示空表。
- 按指定仓库查询物料但该仓库库存为 0 时，可显示“该仓库 0 件”，但 `warehouseCount` 仍必须为 0，不能算作有库存仓库。
- 客户筛选必须用独立 `customerId`，不能只靠关键词。
- 订单库存和备货库存必须区分来源；无 `sourceOrderNo` 的备货库存不得计入客户订单。

库存准确性：

- 汇总数量必须从 `InventoryBatch` 实时计算，不保存第二份可手工修改汇总。
- 可用库存必须满足 `status=AVAILABLE` 且 `quantity > 0`；0 数量批次不得参与占用和有库存仓库统计。
- 盘点改为 0 时批次转 `USED`；0 数量批次盘点为正数可恢复 `AVAILABLE`。
- 批次 `quantity` 表示当前剩余；整批领用或发货后为 0 且 `USED`，历史出库以 OUT 流水汇总。
- 批次明细数量字段标识为“当前剩余”；汇总表可展示累计数量和已出库 / 已使用数量。
- 返回给前端的 `USED` 批次当前剩余显示 0；是否允许盘点由后端 `canAdjust` 决定。
- 计算某订单零件已入库数量必须按 IN 历史流水，不按当前剩余批次数量。
- `STOCK` 已选库存覆盖全部客户订单数量时没有 `ProductionTask`，订单明细完成数量显示客户订单 `quantity`；只覆盖部分数量时，剩余生产计划数量必须生成 `ProductionTask`。
- 订单提交、生产入库、库存调整、仓库发货、订单库存和备货拆分必须在数据库事务内完成，关键库存写入使用 Serializable transaction。

盘点调整：

- 库存盘点只允许修正数量并保留清点人、日期、签字、盘点工单 / 图片 / PDF 附件和库存流水。
- 不得扩展成审批、质量放行、批次追溯或完整 WMS。
- 前端和后端必须拒绝无附件的库存修改。
- 附件校验以安全扩展名白名单为基础；若浏览器上传为 `application/octet-stream` 或空 `mimeType` 不得误拒，但明确非法 `mimeType` 必须拒绝。
- 附件必须通过 `/api/inventory/adjustments/upload` 上传；保存前后端确认 `attachmentFileUrl` 位于 `/uploads/inventory-adjustments/` 且文件真实存在。

库存来源和图纸核对：

- 库存页面必须查看每个零件库存来源批次、生产订单、生产任务、生产日期、客户、仓库、库位、图号、版本和图纸文件。
- 同一零件由多个订单、任务或备货批次叠加时，明细逐批显示，不得只合并总数。
- `InventoryBatch.sourceKind` 区分 `NORMAL_ORDER`、`CANCELLED_ORDER`、`CUSTOMER_CHANGE` 等来源；汇总可合并，但明细必须显示每批来自哪个订单 / 取消订单 / 客户变更。
- 取消订单或客户变更产生的备货库存若要与其他来源库存合并，仓库确认时必须人工勾选来源合并确认；不得覆盖批次来源。
- 备货转订单待发货时，新订单库存批次继续保留原 `sourceProductionTaskNo`。
- 未开工订单取消并退回备货库存时，退回 IN 流水也保留原 `productionTaskNo`。

下单使用库存：

- 下单选择“使用库存”或“库存再加工”时，新增 / 编辑订单界面必须提供库存来源查看入口。
- 库存来源弹窗支持按 `Material` / `InventoryBatch` 关键字、拼音、首字母搜索，不只能显示系统推荐库存。
- 操作人员必须可逐批选择使用的库存批次和数量，不得默认一次性使用全部库存。
- 订单草稿必须保存 `selectedStockSources`；提交订单时后端优先按它扣减库存。
- 弹窗必须固定展示所有已选批次，即使切换搜索结果也不能消失；已选批次可移除。
- 弹窗必须提供批量按默认顺序选用库存的按钮，默认顺序为匹配优先、同匹配等级内按当前库存数量从少到多。
- 已选库存必须可上移 / 下移调整使用顺序。
- 操作人员可搜索并选择可替代产品库存，但系统必须展示生产订单、任务、图号、版本、图纸、规格、厚度、仓库和库位，并要求人工确认适用性。
- 只要替代库存 `partCode` 与本次订单零件不同，即使图纸资料看似一致，也必须显示“需要确认”并按批次填写人工确认记录。
- `selectedStockSources` 合计数量不得超过本次订单零件需要数量；前端限制，后端拒绝超量。
- 后端扣减时必须按真实 `InventoryBatch` 重新判断替代库存、图号、版本、图纸、规格、厚度；不匹配且无逐批人工确认记录时拒绝提交。
- 没有 `selectedStockSources` 时不得提交使用库存；必须由操作人员选择批次，不能由系统静默自动扣减。
- “使用库存”提交生产时，订单零件缺少 `drawingNo`、`drawingVersion`、`partSpecification` 或 `partThickness`，或者库存来源缺少图纸资料时，不得硬拦截；必须要求逐批人工确认说明。
- 操作人员先使用数量大的同零件同单位库存、跳过数量更少的库存时，也必须逐批填写人工确认说明。
- “库存再加工”允许使用资料不完全匹配库存，但应优先消耗匹配批次，再消耗需要改工确认批次。
- 库存来源界面必须区分“匹配订单”和“生产来源”。
- 库存来源弹窗内的订单号、生产来源订单号只能在当前弹窗打开订单信息预览，不得跳转离开订单草稿。
- 确认按钮必须依赖人工勾选“已核对库存批次、订单/任务、图号、版本、图纸文件、规格和厚度”。
- 选择“需要确认”或“资料不完整”的批次时，必须逐批填写确认人员、系统确认时间、使用说明；后端校验 `manualConfirmedBy`、`manualConfirmedAt`、`manualConfirmRemark`。
- 人工确认时间由系统生成且必须可解析；不能用一条总说明覆盖多个不适配批次。

---

## 10. 统计

统计表只读，不做完整报表中心。

允许内容：

- 年度统计
- 季度统计
- 月度统计
- 订单展示

统计口径：

- 统一按 `CustomerOrder.orderDate` 归属年度、季度、月度。
- 客户订单数量和生产计划数量分开统计。
- 订单发货数量和实际生产数量分开统计。
- 订单展示状态必须按业务进度显示：已全量发货显示“已完成发货”，已完成生产但未全量发货显示“已完成未发货”，仍在生产的订单显示“生产中”。
- 全量使用库存、无 `ProductionTask` 但已形成订单待发货库存的订单，在统计订单展示中必须显示“已完成未发货”，不得显示“待确认生产”。
- 年度生产情况表也按订单日期归属，不按生产完成、入库或发货日期归属。
- 转库存数量按 `InventoryTransaction IN` 历史流水计算，其中 `orderNo` 为空表示转入备货库存；不得按当前 `InventoryBatch.quantity` 计算。
- 历史任务 `completedQuantity=0` 但已入库时，实际完成数量兜底用 IN 历史订单入库数量和转库存数量；不得因后续发货或盘点变 0 冲掉历史统计。
- 统计页面不得提供编辑、提交、生产、入库、发货等操作。
- 可按 `customerId` 只读筛选，但不得扩展成复杂报表中心。

---

## 11. 状态枚举

订单状态：

```text
DRAFT, SUBMITTED, IN_PRODUCTION, COMPLETED, CANCELLED
```

生产状态：

```text
PENDING, IN_PROGRESS, COMPLETED
```

库存状态：

```text
AVAILABLE, USED
```

生产通知状态：

```text
PENDING, ACKNOWLEDGED
```

生产通知目标：

```text
PRODUCTION, WAREHOUSE
```

生产报废补单申请状态：

```text
PENDING, APPROVED, REJECTED
```

生产短缺处理方式：

```text
REPLENISHMENT_REQUEST, REPLENISHMENT, MANAGER_APPROVED
```

不要再增加复杂状态，除非用户明确要求。

---

## 12. 验收与测试数据

第一阶段验收标准：

1. 能新增和编辑客户。
2. 能选择客户下单。
3. 一个订单能录入多个零件。
4. 每个零件能选择自己的生产流程。
5. 订单提交后能在生产页面看到。
6. 生产页面能开始生产、逐道工序确认、最终确认完成。
7. 生产完成后能在仓库页面确认入库。
8. 入库后能在库存界面看到库存。
9. 库存界面能按零件、仓库、客户 / 订单搜索，并显示 0 库存物料。
10. 库存管理员能用盘点调整修正库存，并保留清点人、日期、签字、附件和库存流水。
11. 订单取消、客户数量变更、生产报废补单、仓库发货和库存来源核对必须能保留记录。

测试数据：

- `seed.ts` 必须先清理第一阶段业务测试数据，再写入当前版本需要的客户、订单、生产任务、仓库、库存和物料。
- 新增数据库表或改变业务关系后，必须重新执行 migration + seed，避免旧测试数据残留导致重复补单、库存不准或通知状态混乱。
- 测试数据只用于当前开发验证，不能把旧数据库错误状态当作新功能逻辑继续兼容。

---

## 13. Codex 协作规则

- 用户只是讨论、确认范围、要求修改文档时，只修改文档或解释，不编写程序。
- 用户明确要求开始开发时，只开发本文件第一阶段允许内容。
- 用户要求新增超出第一阶段的模块时，先说明超出当前阶段，不直接开发。
- 用户明确说出“第一阶段 完成，可以开始下一阶段”后，才允许规划下一阶段。
