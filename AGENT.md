# AGENT.md — 百胜 ERP 第一阶段最小开发范围

Always respond in Simplified Chinese for explanations.

Keep code, technical keywords, function names, APIs, database fields, file names, and error messages in English.

Do not translate variable names, function names, class names, library names, API paths, database fields, file paths, or command names.

关键业务代码必须保留简洁中文备注，尤其是客户名称查重、客户地区校验、多联系人整理、订单提交、零件生产流程保存、生产状态流转、仓库入库、库存流水等会影响业务数据的逻辑。

---

## 1. 当前最高指令

本项目当前只允许开发第一阶段最小范围。

第一阶段没有完成前，不允许继续扩展完整 ERP、MES、QMS、IATF 16949、质量、追溯、财务、审批、报表、权限体系等模块。

只有当用户明确说出：

```text
第一阶段 完成，可以开始下一阶段
```

才允许进入下一阶段，并重新确认下一阶段范围。

如果用户没有说出上述原句，Codex 不得主动继续按照完整 ERP 要求扩展软件。

---

## 2. 当前第一阶段目标

当前第一阶段只做以下内容：

```text
客户
下单
生产
每个零件的生产流程选择
仓库
库存界面
只读统计表
```

第一阶段目标是把最小业务流程跑通：

```text
维护客户
-> 客户下单
-> 为每个订单零件选择生产流程
-> 进入生产
-> 仓库查看生产相关入库 / 出库信息
-> 库存界面查看当前库存
-> 统计页面只读查看订单、生产、发货和库存数量
```

第一阶段只追求简单、清楚、能用，不追求完整 ERP。

---

## 3. 当前严禁开发的内容

第一阶段严禁开发以下内容：

```text
质量
检验
不良品
追溯
IATF 16949
APQP
PPAP
FMEA
MSA
SPC
8D
CAPA
审核证据库
复杂权限
审批流
财务
成本
开票
采购
供应商体系
报表中心
驾驶舱
移动扫码
拍照留证
附件管理
复杂排产
设备负荷
班组派工
工时绩效
```

注意：

```text
第一阶段允许只读统计表，用于展示年度、季度、月度订单和生产数量。
只读统计表不等同于完整报表中心，不允许增加复杂图表、驾驶舱、导出报表、审批报表或财务报表。
```

如果用户提出的新需求涉及以上内容，必须先提醒：

```text
该内容不属于当前第一阶段范围，需要等用户确认“第一阶段 完成，可以开始下一阶段”后再做。
```

不得绕过此限制。

---

## 4. 环境与技术架构方案

当前虽然只开发第一阶段最小 ERP，但环境和技术选型必须能承接未来 16949 体系软件，避免后续大面积重构。

推荐技术栈：

```text
database：PostgreSQL 16
ORM：Prisma
backend：NestJS + TypeScript + Node.js
frontend：Vue 3 + TypeScript + Vite + Element Plus
deployment：Docker Compose
reverse proxy：Nginx 或 Caddy
storage：NAS 本地目录，后续可迁移到 MinIO / S3
```

数据库选择：

```text
首选 PostgreSQL。
不得使用纯 JSON 文件作为正式数据库。
不得使用 SQLite 作为正式生产数据库。
不建议使用 MongoDB 作为主数据库。
```

选择 PostgreSQL 的原因：

```text
订单、零件、生产流程、仓库和库存属于强关系数据。
库存入库、出库和数量变化需要 transaction。
未来 16949 体系会涉及条款、过程、记录、证据、审核、整改等复杂关系。
PostgreSQL 支持关系数据、transaction、索引、JSONB 和后续归档扩展。
未来从 NAS 迁移到服务器时，可以继续使用 PostgreSQL，不需要更换数据库。
```

选择 Prisma 的原因：

```text
Prisma schema 可以稳定管理数据库结构。
Prisma migration 可以记录每次数据库变化。
TypeScript 类型可以减少字段误用。
未来扩展 16949 表结构时，可以渐进新增表和字段，避免重写第一阶段代码。
```

代码种类：

```text
前端必须使用 TypeScript。
后端必须使用 TypeScript。
前端页面使用 Vue 3 Composition API。
后端使用 NestJS 模块化结构。
数据库访问统一通过 Prisma。
```

NAS 部署目标：

```text
目标设备：TerraMaster F4-424 MAX。
第一阶段部署方式：Docker Compose。
PostgreSQL、backend、frontend 分容器部署。
PostgreSQL 数据目录优先放在 SSD / NVMe 存储空间。
上传文件、导出文件和数据库备份放在 NAS 本地 storage 目录。
PostgreSQL 不直接暴露到公网，只允许 backend 访问。
Docker Compose 必须为 postgres、backend、frontend 配置 healthcheck，方便在 NAS Docker 管理界面判断服务是否真正可用。
上传目录、导出目录、PostgreSQL 数据目录和备份目录必须通过 .env 可配置，不能写死到容器内部。
docker-compose.yml 中的 .env UPLOAD_DIR 和 EXPORT_DIR 只表示 NAS 宿主机挂载路径；backend 容器内部必须显式设置 UPLOAD_DIR=/app/storage/uploads、EXPORT_DIR=/app/storage/exports，避免容器内外路径混用。
后端必须在 AppModule / Controller 装饰器加载前执行 env bootstrap，确保 UPLOAD_DIR、DATABASE_URL 等配置在上传拦截器创建目录前已经生效。
后端上传根目录必须优先读取 UPLOAD_DIR；未配置时才回退到仓库内 storage/uploads。
仓库根目录必须维护 .dockerignore，避免把 node_modules、日志、数据库目录、上传图纸和导出文件打进 Docker build context。
```

建议目录：

```text
frontend/                     Vue 3 前端
backend/                      NestJS 后端
database/prisma/schema.prisma Prisma schema
database/prisma/migrations/   Prisma migrations
database/postgres-data/       PostgreSQL 数据目录，不提交 Git
database/backups/             PostgreSQL 备份目录，不提交 Git
storage/uploads/              后续上传文件目录
storage/exports/              后续导出文件目录
docker-compose.yml            NAS 部署入口
README.md                     部署和运行说明
AGENT.md                      当前开发规范
```

第一阶段不开发质量、追溯和 16949，但数据库设计必须预留未来扩展的基本习惯：

```text
所有核心表必须有 id、status、createdAt、updatedAt。
业务表必须保留稳定业务编号，例如 orderNo、partCode、productionTaskNo。
订单必须支持 order lines，不得只做订单总表。
零件编码必须进入 Material 物料基础清单，Material 只保存编码、名称、单位、规格等基础字段，不保存库存数量。
每个零件的生产流程必须独立保存，不得只保存为一个长字符串。
数量 quantity 和单位 unit 必须分字段。
库存变化必须通过库存流水追加记录，不得只直接修改库存数量。
必要时保留 snapshot 字段，例如 customerSnapshot、processSnapshot。
```

第一阶段允许预留但不开发的字段方向：

```text
relatedProcessId
relatedClauseId
evidenceStatus
sourceRecordType
sourceRecordId
```

预留字段只能作为未来扩展接口，不允许在第一阶段展开质量、追溯、IATF 页面或业务功能。

迁移到服务器的原则：

```text
未来如果 16949 体系软件部署到服务器，应继续沿用 PostgreSQL + Prisma + Docker Compose 或 Kubernetes。
第一阶段不得选择只能在 NAS 本地运行、难以迁移的技术。
业务数据、附件、备份目录必须可迁移。
数据库 schema 和 migration 必须纳入版本管理。
```

跨系统适配原则：

```text
本系统第一阶段按 responsive Web application 开发，不开发原生 Android、iOS、HarmonyOS、Windows 或 macOS 客户端。
同一套前端必须适配 Android 浏览器、iOS Safari、华为 / HarmonyOS 浏览器、Windows 浏览器、macOS 浏览器。
不得把业务逻辑写成依赖某个操作系统的实现。
不得在前端写死 Windows 路径、macOS 路径、NAS 本地路径或浏览器私有 API。
后端 API 必须保持平台无关，前端只通过 HTTP API 访问业务数据。
本地开发前端端口固定使用 5176，Vite 必须绑定 0.0.0.0 并启用 strictPort，避免回落到 5173 / 5175 导致手机端或局域网测试访问错误。
手机真机测试不能使用 localhost，应使用开发电脑局域网 IP，例如 http://192.168.110.147:5176/orders；手机和开发电脑必须在同一局域网。
```

前端跨设备代码结构：

```text
frontend/src/config/          页面导航、基础配置等跨页面配置
frontend/src/composables/     设备、响应式、复用状态等 Composition API
frontend/src/layout/          桌面 / 移动通用布局
frontend/src/views/           业务页面
frontend/src/api/             HTTP API 封装
frontend/src/types/           TypeScript 类型
```

跨设备页面规则：

```text
桌面端使用左侧导航。
移动端使用顶部品牌栏 + 横向滚动导航。
移动端断点优先使用 900px。
表格页面必须允许横向滚动，不得把表格挤到文字重叠。
筛选区在移动端必须纵向排列。
移动端按钮、输入框、选择框的可点击高度不低于 44px。
输入框在移动端字体不得小于 16px，避免 iOS 自动放大页面。
必须支持 safe-area，例如 iPhone 刘海屏、华为挖孔屏。
不得用只适合鼠标 hover 的交互作为唯一操作方式。
```

推荐验证尺寸：

```text
390 x 844：常见手机竖屏
768 x 1024：平板竖屏
1024 x 768：平板横屏 / 小屏电脑
1366 x 768：常见 Windows 笔记本
1440 x 900：常见 macOS / 桌面浏览器
```

Figma 设计文件规则：

```text
本项目只维护一个 Figma 文件，不得为 Web 端、手机版或后续修改重复创建多个 Figma 文件。
当前唯一 Figma 文件：百胜ERP v0.2 第一阶段 手机版UI，文件 key 为 eBsaAwDmqHSmaFKT9mzCXY。
Figma 文件内必须同时保留 Web 端 UI Board 和手机版 UI Board。
Web 端 UI 默认画板尺寸为 1440 x 900，手机版 UI 默认画板尺寸为 390 x 844。
Web 端和手机版 UI 必须覆盖当前 navItems 的全部功能：客户、订单、生产流程、生产、统计、仓库、库存。
Figma 手机版 UI 必须体现现有移动端结构：顶部品牌栏、横向滚动导航、当前位置路径、图标返回按钮、单列筛选区、可横向滚动表格或移动卡片列表。
Figma 中的订单号 orderNo / sourceOrderNo 必须按可点击链接样式呈现，表示点击后进入订单明细。
Figma 只表现第一阶段页面和交互，不得加入质量、追溯、IATF、财务、审批、权限等下一阶段内容。
Figma 设计必须与当前代码里的 Element Plus 风格、颜色、8px 或更小圆角、蓝色主按钮、浅灰背景和表格优先布局保持一致。
```

---

## 5. 第一阶段页面范围

### 5.1 客户页面

只做最小客户资料：

```text
客户列表
新增客户
编辑客户
停用 / 启用客户
客户搜索
按启用 / 停用状态筛选
```

字段只保留必要信息：

```text
customerCode
customerName
contactName
contactPhone
address
regionType
country
province
state
district
city
detailAddress
remark
status
```

客户资料要求：

```text
customerName 为必填，必须自动查重，后端和数据库都要防止重复客户名称。
customerCode 作为客户ID必须唯一；创建客户时可以留空，由后端自动生成，但如果手工填写必须自动查重。
新增客户时，客户ID输入框下方必须显示“如果不填写，这次客户ID自动生成为 xxxxx。（一旦生成不可更改）”。
客户ID一旦保存后不可更改，前端编辑时必须禁用，后端也必须拒绝修改。
中国客户必须选择 province 和 city，detailAddress 可以不填。
国外客户必须选择或填写 country；state、province、district、city、detailAddress 都可以不填。
联系人必须支持多个，使用 CustomerContact 明细表，不得只在 Customer 主表保存单个联系人。
有联系人时必须明确选择一个当前主要联系人，只允许一个 CustomerContact.isPrimary 为 true。
Customer.contactName 和 Customer.contactPhone 只作为当前主要联系人快照，不能替代联系人明细。
没有联系人时客户必须自动停用，但 customerCode 和 customerName 继续保留并占用，后续新客户不得复用。
没有联系人时必须同步清空 Customer.contactName 和 Customer.contactPhone 快照，避免停用客户看起来仍有可用联系人。
停用客户不能创建新订单；前端下单客户列表只能显示启用客户，后端也必须拒绝停用客户下单。
客户资料搜索必须支持客户名称、客户ID、联系人、电话、地区、全拼和拼音首字母关键字。
所有页面的客户下拉必须复用 frontend/src/components/CustomerSelect.vue，通过后端 customers keyword 查询实现远程搜索和下拉滚动；不得在每个页面重新写普通 el-select 造成搜索规则不一致。
```

### 5.2 下单页面

只做客户订单录入：

```text
选择客户
新增订单
录入订单零件
编辑订单零件
提交订单
查看订单状态
```

通用订单选择规则：

```text
生产流程、生产、仓库等页面的订单下拉必须复用 frontend/src/components/OrderSelect.vue。
OrderSelect 只在当前日期 / 客户筛选范围内做本地过滤，不得改变父页面筛选范围。
不选择具体订单时，页面必须按当前日期 / 客户范围展示全部订单或全部任务，不能显示空结果。
生产、仓库等有业务表格的页面，切换客户或订单日期后必须同步刷新订单候选和表格数据，不得只刷新下拉候选。
```

```text
新增和编辑订单时，零件编码必须支持从数据库 Material 物料基础清单中搜索选择。
物料搜索必须大小写不敏感，例如输入 b3 可以匹配 B3、B3-xxxx、B3ASDJ。
选中物料后应自动带出 partCode、partName、unit、partSpecification；库存数量仍按 InventoryBatch 实时汇总展示。
```

订单零件只保留必要信息：

```text
partName
partCode
drawingNo
drawingVersion
drawingFileName
drawingFileUrl
partThickness
partSpecification
quantity
productionPlanQuantity
unit
deliveryDate
remark
```

要求：

```text
quantity 表示客户订单数量，productionPlanQuantity 表示实际生产计划数量，二者必须分开统计。
每个订单零件必须支持 fulfillmentMode：PRODUCTION 表示重新生产，STOCK 表示直接使用备货库存，REWORK 表示使用备货库存修改再加工。
下单页面录入零件时必须展示该零件当前备货库存数量，库存数量必须来自 InventoryBatch 实时汇总，不能由前端假数据填写。
STOCK 模式下 productionPlanQuantity 必须为 0，提交订单时不生成 ProductionTask；系统必须把可用备货库存转成该订单的待发货库存，并追加 OUT / IN 库存流水。
REWORK 模式下必须先扣减可用备货库存并追加 OUT 库存流水，然后生成 ProductionTask；生产完成后仍按仓库确认入库流程进入订单库存或备货库存。
REWORK 模式的备货库存领用数量必须按 productionPlanQuantity 计算，不得只按客户订单 quantity 计算；否则生产计划多做时会少扣库存。
PRODUCTION 模式继续按生产计划数量生成 ProductionTask；生产计划数量不得小于客户订单数量。
选择 STOCK 或 REWORK 时，后端提交订单必须校验当前备货库存是否足够；库存不足时必须拒绝提交，不能让订单占用不存在的库存。
创建或编辑 DRAFT 订单时，前端可以提示备货库存不足，但不得阻止保存草稿；只有提交生产时必须强制校验并阻止。
下单前端库存提示不能只按单行判断；同一个订单内相同 partCode / unit 的 STOCK 和 REWORK 库存需求必须合计显示，避免多行合计超过备货库存时误导操作人员。
deliveryDate 可以在订单总表填写，也可以在每个订单零件单独填写；后续生产、仓库、库存页面必须优先显示订单零件交期，没有零件交期时才使用订单总交期。
partThickness 表示零件厚度，新增和编辑订单时必须填写。
partSpecification 表示成品规格，例如 120mm x 204mm x 10mm，可以选择或手工输入。
drawingNo 不能只作为普通文本保存；保存前必须检查当前订单和历史订单是否已有相同图号，如果重复必须提示操作人员确认后才能继续。
drawingVersion 用于区分图纸版本，不能只依赖 drawingNo。
drawingFileName 和 drawingFileUrl 用于保存上传图纸文件名和访问地址；上传相同 drawingFileName 时，必须在选择上传文件时先提示操作人员确认，并同时展示当前选择图纸和重复图纸或图纸打开入口；保存订单时也必须再次兜底检查。
订单新增、编辑、订单明细和生产工序完成表中，只要存在 drawingFileUrl，都必须提供可点击的图纸预览或打开入口；PDF 和图片优先在线预览，DWG / DXF 至少提供打开或下载入口。
前端图纸入口必须优先复用 `frontend/src/components/DrawingPreviewLink.vue`，不得在不同页面重复维护多套图纸预览弹窗逻辑。
新增订单和编辑订单页面的“订单零件”标题旁必须保留感叹号说明按钮，用于说明图号 / 图纸重复确认规则，后续开发不得删除。
数量和单位 unit 分开。
一个订单可以有多个零件。
新增订单默认可以预置 3 行方便录入，但操作人员必须可以删除误填零件；新增和编辑订单都只要求至少保留 1 个零件。
订单提交后进入生产。
只有 DRAFT 订单允许提交生产；进入生产、入库、发货或完成后的订单不得再次提交改变生产任务。
订单号默认自动生成，但 DRAFT 订单在新增和编辑时都必须允许手工修改并查重；后端必须支持排除当前订单自身后的唯一性检查。
订单号查重必须由输入框自动触发，保存时再次强制校验；不得要求操作人员点击“查重”按钮。
订单号查重必须大小写不敏感，数据库必须保留 LOWER(orderNo) 唯一索引，避免 SO-xxx 和 so-xxx 被当成两个订单。
后端保存手工订单号时必须统一转为大写；订单详情、编辑、提交生产和生产流程接口必须支持大小写不敏感查询。
```

### 5.3 每个零件的生产流程选择

每个订单零件必须能单独选择生产流程。

生产流程先做简单可选项，不做复杂工艺系统：

```text
激光切割
折弯
冲压
焊接
打磨
喷涂
装配
包装
其他
```

要求：

```text
不同零件可以选择不同生产流程。
同一个零件可以选择多个生产步骤。
生产步骤要能排序。
同一个订单零件内不允许重复保存相同工序名，避免生产页按工序确认完成时记录混乱。
生产流程必须拆分为标准工序名称和工序参数备注：processName 只能保存标准工序，例如“冲压”；次数、孔位、特殊要求等必须保存到 processRemark，例如“4次”，不得把“冲压+4次”作为 processName 保存。
后续统计只能按 processName 统计，processRemark 只用于生产现场说明和工序完成表展示，不能参与工序名称聚合。
生产流程选择结果要能在生产页面看到。
只有 DRAFT 订单允许编辑生产流程；订单提交生产后，生产流程页只能查看，前端必须禁用编辑，后端也必须拒绝修改。
```

### 5.4 生产页面

只做最小生产状态管理：

```text
待生产列表
生产中列表
已完成列表
开始生产
逐道工序确认完成
在工序完成表填写完成数量
在工序完成表填写备注
```

生产状态只保留：

```text
PENDING
IN_PROGRESS
COMPLETED
```

要求：

```text
生产页面必须显示订单号、客户、订单日期、交期、零件、数量、单位、生产流程。
生产任务不能绕过工序完成表直接完成；必须点击具体工序，填写工序完成表后，已确认工序才允许变绿色。
允许在同一个工序完成表内同时勾选连续的后续工序一起确认完成，用于节省生产操作时间；后端仍必须校验这些工序连续且未跳过上一道工序。
生产任务必须先执行开始生产，进入 IN_PROGRESS 后才允许保存工序完成表；后端不能允许 PENDING 任务直接保存工序完成。
生产流程必须按已保存的步骤顺序确认；未完成上一道工序时，后续工序在前端必须置灰，后端也必须拒绝跳过工序的保存请求。
工序完成表的操作人员列表必须由后端接口提供；第一阶段可以是后端固定列表，但不得只在某个前端页面写死，避免多终端名单不一致。
每个操作人员必须有唯一账户ID，当前用 operator.code / accountId 表示；后续如绑定身份证，只能保存脱敏展示或合规字段，不能在前端硬编码完整身份证号。
操作人员下拉必须支持姓名、账户ID、角色、拼音和拼音首字母关键字搜索，例如顾胜钧必须能用 gsj、gs、顾、胜、jun 等关键字命中。
后端 `/api/production/tasks/operators` 必须支持 keyword 查询，搜索规则和前端下拉一致，避免后续操作人员增多后只能依赖前端全量过滤。
前端操作人员选择框必须使用远程搜索接口，并保留已选人员缓存，避免搜索结果刷新后已选标签丢失。
前端操作人员候选列表渲染时也必须按当前 keyword 过滤本地缓存和已选人员，避免远程接口返回前显示不匹配的旧候选；例如输入 zm 时不得显示顾胜钧。
工序完成表允许操作人员不填写，也允许同一道工序多选操作人员；如果填写，前端只提交 operatorCodes，operatorName 和 operatorRole 必须由后端按操作人员名单补全，不能信任前端传入的姓名或角色。
同时完成多个连续工序时，必须每道工序都可以单独填写 operatorCodes，后端必须按每道工序分别保存操作人员和修改日志。
确认生产完成弹窗也必须支持 operatorCodes 多选或留空，并沿用同一套远程搜索、缓存和后端补全规则。
所有工序都确认完成后，生产任务只进入前端有效状态 READY_TO_COMPLETE（待确认完成），不得自动进入 COMPLETED；必须由操作人员点击“确认完成”并填写最终完成数量后，才进入 COMPLETED 等待仓库确认入库。
生产完成后，数据可以进入仓库 / 库存界面。
生产计划表必须支持导出 Excel，可使用 Excel 兼容格式，但字段和当前筛选结果必须一致。
生产计划表必须支持打印预览和打印，打印版式固定为 A4 横版。
A4 横版打印时必须合理分配列宽，优先保证任务号、订单号、客户、订单日期、交期、零件、完成/计划、生产流程可读。
完成数量为 0 时，完成栏不显示“0 + unit”，可以只显示 unit，再与计划数量分隔展示。
生产最终完成数量可以小于 plannedQuantity，但必须填写 scrapQuantity，并选择生成补单或由车间管理人员确认缺货完成。
生成补单时，新 productionTaskNo 必须基于原 productionTaskNo 追加 R01、R02 等顺序号，并继续链接原订单号，便于追溯订单缺口。
订单明细页允许对某个已开始生产的订单零件创建补单；未开始生产的订单零件不得补单，只能修改 DRAFT 订单或走正常订单变更。
补单的业务含义只能是补足生产缺件 / 报废缺件，或客户在原订单已开始生产后追加该零件数量；不得把未生产订单的录入错误伪装成补单。
客户在原订单已开始生产后新增物料时，必须通过订单明细页新增补单物料，不得直接修改原订单行；后端必须创建新的 OrderLine、ProductionTask(isReplenishment=true) 和 MATERIAL_ADDED ProductionNotice。
新增补单物料必须要求填写 reason，并在 ProductionNotice.reason 中写入当前订单已有生产进度，例如每个已开始零件已完成哪些工序、下一道工序是什么，确保生产人员知道客户变更发生在哪个阶段。
同一个 orderLineId + sourceProductionTaskNo 只能存在一条 PENDING 补单任务；重复提交补单必须更新现有 PENDING 补单，不得生成重复 R01 / R02 垃圾数据。
补单和已开始生产后的客户数量变更必须生成 ProductionNotice；生产端通知 target=PRODUCTION，仓库端通知 target=WAREHOUSE，双方确认状态必须分开保存。
客户数量增加时，系统应生成补单任务并通知生产；客户数量减少或取消时，必须通知生产管理确认已生产物料如何处理，并同步通知仓库等待转库存或销毁结果。
整张订单在已经开始生产后取消时，CustomerOrder.status 必须进入 CANCELLED；客户订单数量归零；未开始的 PENDING 生产任务必须删除，已开始的生产任务必须保留并分别生成 target=PRODUCTION 和 target=WAREHOUSE 的 ORDER_CANCELLED 通知。
判断生产任务是否已经开始，不能只看 ProductionProcessCompletion 是否存在；种子数据和页面初始化可能预建未完成工序记录。必须以 ProductionTask.status != PENDING，或工序记录中存在 isCompleted、completedAt、completedQuantity、scrapQuantity、shortageQuantity 等有效进度为准。
数量减少或取消订单时，已生产多余产品只能转为备货库存或销毁处理；未确认前不得静默进入可用库存。
如果不补单，必须填写 managerName 和 shortageReason；常见理由包括库存抵扣、客户取消部分数量、车间管理确认缺货完成。
生产最终完成数量允许大于 plannedQuantity，大于部分由仓库确认入库时拆分为备货库存。
已经仓库入库的生产任务不得再次修改工序完成表或最终完成数量，避免生产数量和库存批次数量不一致。
生产任务在未入库前允许管理人员撤回误操作，但必须填写 managerName 和 reason；已经入库的生产任务不得撤回。
生产任务管理撤回不得使用 window.prompt 分步输入；必须使用单页弹窗表单，包含管理人员姓名、撤回订单原因、自动带入且可修改的处理日期、处理方式、处理数量和其它说明。
管理撤回处理方式必须明确：零件入库存时只生成 target=WAREHOUSE 的 TASK_WITHDRAWN 待确认通知，不得直接静默入库；零件报废时必须写入 ProductionScrapRecord；无实物处理时处理数量必须为 0。
最终完成确认产生 scrapQuantity 时，必须写入 ProductionScrapRecord，记录 recordDate、orderNo、productionTaskNo、partCode、quantity、unit 和 reason。
生产页面必须提供只读生产报废统计入口，按 ProductionScrapRecord 展示日期、订单号、任务号、零件、报废数量和报废原因。
```

### 5.5 仓库页面

仓库页面只做最小仓库操作视图：

```text
仓库列表
库位列表
生产完成待入库
确认入库
库存出库记录查看
```

字段只保留：

```text
warehouseName
locationName
orderDate
deliveryDate
partName
quantity
unit
status
remark
```

要求：

```text
生产完成任务必须先进入仓库待入库列表，由仓库人员确认入库后才进入库存。
确认入库弹窗必须允许选择 warehouse 和 location，并支持填写可选 remark；remark 必须写入 IN 库存流水。
客户订单数量 quantity 以内的完成数量作为订单库存，后续进入待发货；超过客户订单数量的部分必须拆分为无订单绑定的备货库存，即使这些数量属于 productionPlanQuantity。
确认发货不能直接点击后立即出库，必须先弹出确认框，展示库存批次、订单号、零件、数量、仓库 / 库位，并支持填写可选 remark。
确认发货后对应库存批次改为 USED，并追加 OUT 库存流水；remark 必须写入出库流水。
仓库页面必须展示 target=WAREHOUSE 的待确认通知，例如客户减少数量、取消订单、生产多余件等待转库存或销毁；仓库确认通知不得影响生产端 target=PRODUCTION 的确认状态。
仓库页面仍属于第一阶段最小仓储操作，不得加入审批、扫码、库龄、盘点、批次追溯或质量放行。
仓库编码和库位编码必须由后端统一转为大写；warehouseCode 全局大小写不敏感唯一，同一仓库内 locationCode 大小写不敏感唯一。
```

### 5.6 库存界面

库存界面只做当前库存查看：

```text
库存列表
按零件搜索
按仓库搜索
按客户 / 订单搜索
查看库存数量
查看库存状态
```

库存字段只保留：

```text
partName
partCode
quantity
unit
warehouseName
locationName
sourceOrderNo
orderDate
deliveryDate
status
```

第一阶段库存只需要能看清：

```text
有什么零件
有多少数量
在哪个仓库 / 库位
来自哪个订单
来源订单的订单日期和交期
当前是否可用
```

要求：

```text
库存页面必须支持 keyword、customerId、warehouseId、orderNo、status 这些第一阶段筛选条件。
库存 keyword 输入必须支持数据库 Material 物料下拉搜索，大小写不敏感；物料可以没有库存。
库存 keyword 查询必须同时匹配 partCode、partName、partName 全拼、partName 拼音首字母、batchNo、sourceOrderNo、sourceProductionTaskNo、sourceCustomerName 和 warehouseName；例如输入 pt 可以命中 PT 开头的生产任务或批次，输入 cycsgb / cy 可以命中“冲压测试盖板”。
当查询到的物料没有库存批次时，库存汇总必须显示该物料当前查询仓库库存为 0，不得因为没有 InventoryBatch 就隐藏该物料。
前端库存页面在关键字命中物料但当前可用库存为 0 时，必须在筛选区下方明确展示“某零件在当前仓库 / 全部仓库库存为 0”，不能只显示空批次表。
客户筛选必须使用独立 customerId 字段，不能只依赖关键词模糊搜索。
订单库存和多做备货库存必须区分来源；无 sourceOrderNo 的备货库存不得错误计入某个客户订单。
库存页面允许增加按零件汇总的只读统计，汇总数量必须从 InventoryBatch 实时计算，不允许保存第二份可手工修改的汇总数量，避免库存账面不一致。
库存盘点调整属于当前第一阶段库存准确性要求，但必须通过 InventoryAdjustment、附件记录和 InventoryTransaction 库存流水实现，不得绕过记录直接静默改库存。
库存盘点只允许修正数量并保留清点人、日期、签字和盘点工单 / 图片 / PDF 附件，不得扩展成审批、质量放行、批次追溯或完整 WMS。
库存盘点调整必须上传附件；前端和后端都必须拒绝无盘点工单、无现场照片或无 PDF 附件的库存修改。
库存盘点附件必须来自后端 `/api/inventory/adjustments/upload` 上传接口，后端保存盘点记录前必须确认 attachmentFileUrl 位于 `/uploads/inventory-adjustments/` 且对应文件真实存在，不能接受手工伪造的外部链接或不存在的文件地址。
```

### 5.7 统计表

统计表只做只读展示，不做完整报表中心。

允许内容：

```text
年度统计
季度统计
月度统计
订单展示
```

统计口径：

```text
统一按下订单日期 CustomerOrder.orderDate 归属年度、季度、月度。
客户订单数量和生产计划数量必须分开统计。
订单发货数量和实际生产数量必须分开统计。
年度生产情况表同样必须按 CustomerOrder.orderDate 归属，不得按生产完成日期、入库日期或发货日期归属。
统计表和年度生产情况表中的转库存数量必须按 InventoryTransaction IN 历史流水计算，其中 orderNo 为空表示转入备货库存；不得按 InventoryBatch.quantity 当前剩余数量计算。
历史生产任务如果 completedQuantity 仍为 0，但已经入库，实际完成数量兜底必须使用 InventoryTransaction IN 历史订单入库数量和转库存数量；不能因为库存后续发货或盘点变成 0 而冲掉历史统计。
统计页面不得提供编辑、提交、生产、入库、发货等操作按钮。
统计页面允许按 customerId 做只读筛选，但不得把它扩展成复杂报表中心。
```

---

## 6. 第一阶段状态

订单状态：

```text
DRAFT
SUBMITTED
IN_PRODUCTION
COMPLETED
```

生产状态：

```text
PENDING
IN_PROGRESS
COMPLETED
```

库存状态：

```text
AVAILABLE
USED
```

不要增加复杂状态，除非用户明确要求。

---

## 7. 开发约束

当前阶段开发必须遵守：

```text
只做第一阶段范围内的页面和最小业务逻辑。
不要提前做质量、追溯、IATF、报表、审批、财务。
不要为了未来扩展写大量复杂结构。
不要把页面做成复杂后台系统。
不要把所有 ERP 想法一次性塞进去。
```

页面风格：

```text
简单
清楚
实用
表格优先
按钮明确
状态清楚
```

导航规则：

```text
有上下级关系的页面必须在顶部显示当前位置路径，类似 Windows 文件夹地址。
当前位置路径的上一级必须可点击返回。
上一级返回按钮使用图标按钮，不显示中文文字。
所有业务表格中显示的 orderNo / sourceOrderNo 必须可点击进入订单明细，不得只依赖“查看明细”文字按钮。
```

库存准确性规则：

```text
库存界面搜索必须基于数据库中的物料清单和库存批次，支持大小写不敏感关键字搜索。
物料编号、库存批次零件编号、下单零件编号的库存匹配必须大小写不敏感。
即使零件当前库存为 0，只要物料清单中存在，也必须能被搜索并显示 0 库存。
按指定仓库查询物料但该仓库库存为 0 时，可以在仓库分布中显示“该仓库 0 件”，但 warehouseCount 仍必须为 0，不能算作有库存仓库。
可用库存必须同时满足 status=AVAILABLE 且 quantity > 0，0 数量库存批次不得参与下单占用和有库存仓库统计。
盘点把库存批次数量改为 0 时，批次状态应转为 USED；如果 0 数量批次重新盘点为正数，可以恢复为 AVAILABLE。
仓库待发货列表和发货确认必须只允许 sourceOrderId 不为空、status=AVAILABLE、quantity > 0 的订单库存。
库存批次的 quantity 表示当前剩余数量；整批领用或发货后应改为 quantity=0、status=USED，历史出库数量以 InventoryTransaction OUT 流水汇总。
库存界面批次明细中的数量字段必须标识为“当前剩余”，汇总表可展示累计数量和已出库 / 已使用数量，避免把历史数量当成当前库存。
库存列表返回给前端的 USED 批次当前剩余数量必须显示为 0；是否允许盘点调整由后端 canAdjust 字段决定，前端不得自行用显示数量推断。
仓库计算某个订单零件已入库数量时必须按 InventoryTransaction IN 历史流水统计，不能按 InventoryBatch.quantity 当前剩余统计；发货后批次 quantity 会变成 0。
STOCK 直接使用库存的订单零件没有 ProductionTask，订单明细完成数量应显示客户订单 quantity，不能因发货后批次 quantity=0 显示成 0。
订单提交、生产入库、库存调整、仓库发货属于库存关键写入，必须使用数据库事务。
涉及订单库存和备货库存拆分时，读取、校验、写入必须在同一个 Serializable 事务内完成。
生产超出客户订单数量的部分必须转入无订单绑定的备货库存。
```

---

## 8. 第一阶段验收标准

第一阶段完成时，只按以下标准验收：

```text
1. 能新增和编辑客户。
2. 能选择客户下单。
3. 一个订单能录入多个零件。
4. 每个零件能选择自己的生产流程。
5. 订单提交后能在生产页面看到。
6. 生产页面能开始生产和完成生产。
7. 生产完成后能在仓库页面确认入库。
8. 入库后能在库存界面看到库存。
9. 库存界面能按零件、仓库、客户 / 订单搜索。
10. 库存管理员能用盘点调整修正库存，并保留清点人、日期、签字、附件和库存流水。
```

只要以上内容没有完成，就不得进入下一阶段。

开发测试数据规则：

```text
seed.ts 必须先清理第一阶段业务测试数据，再重新写入当前版本需要的客户、订单、生产任务、仓库、库存和物料测试数据。
新增数据库表或改变业务关系后，必须重新执行 migration + seed，避免旧测试数据残留导致重复补单、库存不准或通知状态混乱。
测试数据只能用于当前开发验证，不能把旧数据库中的错误状态当作新功能逻辑继续兼容。
```

---

## 9. 对 Codex 的协作要求

当用户只是讨论、确认范围、要求修改文档时：

```text
只修改文档或只解释，不编写程序。
```

当用户明确要求开始开发时：

```text
只开发本 AGENT.md 中第一阶段允许的内容。
```

当用户要求新增超出第一阶段的模块时：

```text
先说明该内容超出当前阶段，不直接开发。
```

当用户说出：

```text
第一阶段 完成，可以开始下一阶段
```

才允许根据用户新指令规划下一阶段。

---

## 9.1 通知确认交互规则补充
```text
生产通知和仓库通知确认不得使用 window.prompt、window.confirm 等浏览器原生弹窗。
必须使用系统页面内的 el-dialog 表单，至少包含通知摘要、确认人员姓名、确认时间展示或系统自动记录。
确认人员姓名必须在前端做必填校验，并通过后端 API 写入通知确认记录。
生产通知和仓库通知可以复用 frontend/src/components/NoticeAcknowledgeDialog.vue，避免不同页面确认规则不一致。
```

## 9.2 标准工序与参数备注规则补充
```text
生产流程不得把“冲压+4次”“折弯R角”等混合文本直接保存为 processName。
processName 必须来自标准工序清单，次数、R角、特殊要求等信息必须保存到 processRemark。
seed.ts 测试数据也必须覆盖 processRemark 示例，避免只测试纯字符串工序导致页面或接口漏掉参数备注显示问题。
生产页面、生产流程选择页、打印和导出都必须优先显示 processName，并在需要时附带 processRemark。
```

## 9.3 搜索栏与下拉数据完整性规则补充
```text
所有搜索栏、远程下拉、自动补全和筛选结果，原则上不得在后端使用 take、limit、pageSize 等固定条数截断数据库结果。
不得在前端使用 slice(0, n) 截断搜索建议或查询结果，因为操作人员会误以为数据库不存在该客户、物料、订单或库存记录。
如果未来数据库数据量变大，需要分页或虚拟滚动，必须在 UI 上明确显示“当前为分页结果 / 继续加载 / 共多少条”，不能静默只显示前几条。
客户搜索必须返回所有匹配客户；物料搜索必须返回所有匹配 Material，空关键字点击下拉时也应能显示数据库已有物料，当前库存为 0 的物料也必须可见。
库存关键字查询命中物料但无 InventoryBatch 时，必须显示该物料当前查询范围库存为 0，不能用空表代替说明。
订单、生产任务、生产通知、仓库通知、库存流水、盘点记录等列表，如果按第一阶段筛选条件查询，也不得静默截断结果。
允许保留的 slice / limit 只限于文件名安全截断、日期字符串格式化、编号生成、上传文件大小限制、连续工序区间等非搜索结果场景。
```

## 9.4 日期 / 客户 / 订单筛选 UI 规则补充
```text
订单总列表、生产流程、生产任务、仓库操作等涉及订单范围筛选的页面，筛选顺序必须优先为：订单日期、客户、订单。
订单日期不是必填条件，选择日期段后必须能查询该日期段内所有客户订单；再选择客户或订单只是进一步缩小范围。
客户下拉必须支持中文关键字、拼音、首字母缩写搜索；不输入关键字点击下拉时必须显示全部可选客户，并允许滚动选择。
订单下拉的选择框中只显示订单号，客户、订单日期、交期、零件数等详情可以放在下拉选项或选择框下方说明，避免选择框内容过长。
前端统一使用 frontend/src/components/DateRangeFilter.vue、CustomerSelect.vue、OrderSelect.vue 维护筛选控件，禁止各页面复制一套不同的日期/客户/订单 UI。
```

## 10. 当前补单与客户变更开发规则补充

```text
订单明细页的“补单”“数量变更”“新增补单物料”只允许用于已经开始生产的订单或订单零件。
未开始生产的订单或订单零件，必须继续走 DRAFT 编辑或正常订单修改，不得创建补单。
前端如果因为订单未开始生产、订单已完成、订单已取消、零件未生成生产任务或零件仍为 PENDING 而禁用“补单”“数量变更”“新增补单物料”“取消订单”，必须用 tooltip 或页面提示说明具体原因，不能只把按钮置灰。
补单必须挂在原 orderNo 和原 orderLineId 下，ProductionTask.isReplenishment 必须为 true，任务号按原生产任务号追加 R01、R02 等序号。
订单明细页必须显示每个零件当前生产进度，例如已完成哪些工序、下一道工序是什么、是否已完成或已入库，避免操作人员在不了解现场进度时修改数量。
客户增加数量时必须生成 QUANTITY_INCREASE 生产通知；客户减少数量或取消物料时必须生成 QUANTITY_DECREASE / ORDER_CANCELLED 生产通知，并同步生成仓库通知。
新增补单物料必须生成新的 OrderLine、ProductionTask 和 MATERIAL_ADDED 生产通知，通知内容必须写入当前订单已有生产进度。
客户减少数量、取消物料或取消订单时，已经生产出来的多余产品只能由管理人员确认转库存或报废；未确认前不得自动进入可用库存。
报废必须写入 ProductionScrapRecord，记录日期、订单号、任务号、零件、数量和报废原因。
```
