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

订单零件只保留必要信息：

```text
partName
partCode
drawingNo
quantity
productionPlanQuantity
unit
deliveryDate
remark
```

要求：

```text
quantity 表示客户订单数量，productionPlanQuantity 表示实际生产计划数量，二者必须分开统计。
deliveryDate 可以在订单总表填写，也可以在每个订单零件单独填写；后续生产、仓库、库存页面必须优先显示订单零件交期，没有零件交期时才使用订单总交期。
数量和单位 unit 分开。
一个订单可以有多个零件。
订单提交后进入生产。
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
生产流程选择结果要能在生产页面看到。
```

### 5.4 生产页面

只做最小生产状态管理：

```text
待生产列表
生产中列表
已完成列表
开始生产
完成生产
填写完成数量
填写备注
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
生产完成后，数据可以进入仓库 / 库存界面。
生产计划表必须支持导出 Excel，可使用 Excel 兼容格式，但字段和当前筛选结果必须一致。
生产计划表必须支持打印预览和打印，打印版式固定为 A4 横版。
A4 横版打印时必须合理分配列宽，优先保证任务号、订单号、客户、订单日期、交期、零件、完成/计划、生产流程可读。
完成数量为 0 时，完成栏不显示“0 + unit”，可以只显示 unit，再与计划数量分隔展示。
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
统计页面不得提供编辑、提交、生产、入库、发货等操作按钮。
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
```

只要以上内容没有完成，就不得进入下一阶段。

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
