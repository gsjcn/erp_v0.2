# 百胜 ERP 第一阶段

本项目只实现 `AGENTS.md` 中允许的第一阶段范围：客户、零件管理、订单、每个零件的生产流程选择、流程记忆、生产、统计、仓库、库存。

第一阶段页面入口固定为 9 个：

- 客户
- 零件管理
- 订单
- 生产流程
- 流程记忆
- 生产
- 统计
- 仓库
- 库存

## 技术栈

- `database`: PostgreSQL 16
- `ORM`: Prisma
- `backend`: NestJS + TypeScript
- `frontend`: Vue 3 + TypeScript + Vite + Element Plus
- `deployment`: Docker Compose，适配 TerraMaster F4-424 MAX NAS

## 本地开发

```bash
copy .env.example .env
npm install
npm run backend:db:generate
npm run backend:db:migrate
```

需要先准备 PostgreSQL，并在根目录 `.env` 中配置 `DATABASE_URL`。`backend/src/env/bootstrap-env.ts` 会在 NestJS 模块加载前读取环境变量，上传目录也从这里生效。
Prisma 脚本会通过 `backend/scripts/prisma-with-root-env.cjs` 先加载根目录 `.env`，确保本地执行 `backend:db:generate`、`backend:db:migrate`、`backend:db:deploy` 和 `backend:db:seed` 时都能读取同一份 `DATABASE_URL`。

首次初始化测试数据：

```bash
npm run backend:db:seed
```

注意：`backend:db:seed` 会清空并重建第一阶段业务测试数据，只允许直接用于 `localhost` / `127.0.0.1` / `::1` 本地开发库；Docker 内或远程测试库请使用 `npm run docker:db:seed`，该命令会先备份并传入 `SEED_BACKUP_CONFIRMED=true`。

清理回归脚本留下的测试主数据：

```bash
npm run cleanup:test-data
npm run cleanup:test-data -- --apply
```

`cleanup:test-data` dry-run 会同时列出需要人工复核的活动业务记录；如果匹配到未取消订单、未关闭生产任务、待处理通知、有效库存预占或可用库存批次，`--apply` 必须先阻断，不能直接停用相关主数据。

该命令默认 dry-run，只报告匹配 `VERIFY-`、`VERIFY_`、`COD-`、`MI-API-`、`MAT-STABLE`、`UPLOAD-FILENAME`、`CUST-SEARCH-`、`TEST-CUSTOMER` 前缀的测试客户、零件、BOM、仓库等主数据。预览数量可用 `--preview-limit=20` 或 `CLEANUP_TEST_DATA_PREVIEW_LIMIT=20` 调整。`--apply` 只做软停用和测试客户编号归档；默认只允许当前项目 PostgreSQL 目标库，例如 `POSTGRES_HOST_PORT`、`POSTGRES_USER` 和 `POSTGRES_DB` 指向的 `baisheng_erp`，其他测试库必须先显式设置 `CLEANUP_TEST_DATA_CONFIRMED=true`，生产环境还必须设置 `ALLOW_TEST_DATA_CLEANUP=true`。

非破坏性校验第一阶段关键数据：

```bash
npm run backend:verify:first-stage
```

查看当前第一阶段 P0-P5 源码 checklist 进度：

```bash
npm run project:progress
npm run project:progress -- --json
```

该进度用于开发跟踪，不等同于最终业务验收。

该命令只读取数据库，不会改数据；用于检查客户 / 仓库 / 库位大小写不敏感唯一、客户主联系人快照、`OrderNoReservation`、订单零件工序和 `ProductionTask` 一致性、`InventoryReservation`、草稿订单同批次库存预占先后顺序、`selectedStockSources`、库存流水余额、库存批次账实和来源一致性、生产 / 仓库通知确认记录、生产报废补单申请、报废记录、统计订单展示状态、生产计划偏差说明和盘点附件记录。

静态校验第一阶段前端范围和交互约束：

```bash
npm run verify:first-stage:source
```

该命令不连接数据库；用于检查第一阶段 9 个页面入口、关键共享组件、移动端响应式基线、禁用浏览器原生 `prompt` / `confirm` / `alert`、客户下拉搜索只展示客户名称、生产 / 仓库通知标题必须显示客户名称、生产流程填写和提交生产必须由下单 / 计划人员操作且车间人员只能查看、生产工序必须先开始生产并按保存顺序连续确认、订单展示状态统一显示“待提交生产 / 待确认生产 / 生产中 / 部分发货 / 已完成未发货 / 已完成发货”、生产短缺在补单完成后必须关闭待处理提醒并显示已处理记录、仓库分批发货必须支持“已发货 / 未发货 / 本次发货”、超发必须填写仓库确认人、销售确认人和说明并写入订单零件流水、生产首页“全部”位于“待处理”前面、旧库存来源缺少核对结果时前端必须拦截、库存来源已选批次必须按队列顺序自动重算后续使用数量、订单保存和库存实际扣减必须使用 Serializable transaction 内的实时 `selectedStockSources` / `availableQuantity`，历史修复脚本必须按草稿订单先后顺序校验库存预占，并确保 seed 保留同批库存跨行 / 跨订单预占场景。

该静态校验同时锁定图号 / 图纸文件名重复确认：新增和编辑订单的“订单零件”标题旁必须保留图纸重复规则说明入口；不同零件编号使用同一图号必须弹出“图号或版本号冲突”确认，弹窗要展示零件编号、图号、版本号和图纸预览入口；新增订单、订单明细编辑和上传图纸前都要校验，后端必须保留历史订单图号 / 图纸文件名查重兜底接口。

静态校验第一阶段部署配置：

```bash
npm run verify:first-stage:config
```

该命令不启动 Docker；用于检查 `.env.example`、`.dockerignore`、`docker-compose.yml` 和 backend healthcheck 是否保留 NAS 部署所需的端口、目录挂载、healthcheck 和上传 / 导出目录可写校验。

提交前建议执行第一阶段总验收：

```bash
npm run verify:first-stage
```

该命令会依次执行源码静态校验、部署配置校验、数据库只读校验、后端构建、API 回归和前端构建。
其中 API 回归会复用前一步生成的 backend build 并启动临时本地服务，覆盖订单导入、零件库导入、库存调整、生产通知、生产导出、仓库配置和上传文件名兼容性；如需复用已启动服务，可设置 `FIRST_STAGE_API_BASE_URL`。
排查单个 API 回归或全量超时时，可以只跑指定脚本，例如：

```bash
FIRST_STAGE_API_SCRIPTS=verify:inventory-export-api npm run verify:first-stage:api:after-build
node scripts/verify-first-stage-api.cjs --skip-build --scripts=verify:inventory-export-api,verify:statistics-api
```

Windows PowerShell 可使用：

```powershell
$env:FIRST_STAGE_API_SCRIPTS='verify:inventory-export-api'; npm run verify:first-stage:api:after-build
node scripts/verify-first-stage-api.cjs --skip-build --scripts=verify:inventory-export-api,verify:statistics-api
```

如果需要把 `Prisma generate` 也纳入一次性严格验收，先停止本地 backend 服务，再执行：

```bash
npm run verify:first-stage:strict
```

Windows 上正在运行的 backend 可能占用 `query_engine-windows.dll.node`，此时严格验收会在 `backend:db:generate` 报 `EPERM`，需要先停止 backend 后重试。

对历史测试数据做第一阶段安全修复检查：

```bash
npm run backend:repair:first-stage
```

该命令默认是 dry-run，只报告会补齐哪些 `productionPlanSuggestedQuantity`、生产计划偏差操作员和说明、库存来源临时字段、库存来源核对状态、草稿订单 `ACTIVE` 库存预占、历史订单发货状态、流程搜索字段、标准工序补录、生产操作人员基础资料、已消耗库存来源缺失的 `InventoryReservation` 记录，以及使用库存订单是否存在未正确转入订单待发货库存、BOM 同名范围重复、BOM 范围审批重复等阻断问题。标准工序补录会根据历史订单 / 流程模板引用恢复缺失或被停用的标准工序。确认要写入当前数据库时再执行：

```bash
npm run backend:repair:first-stage -- --write
```

执行 `--write` 前必须先备份数据库。修复脚本写入前会执行阻断检查；如果发现库存来源核对、草稿库存预占、库存消费预占、使用库存转订单待发货、BOM 同名范围重复或 BOM 范围审批重复存在无法自动确认的问题，会直接停止且不写入任何修复。通过阻断检查后，所有修复写入会在一个 `Serializable` transaction 内完成，遇到 PostgreSQL / Prisma `P2034` 并发冲突会短暂重试，最终仍失败时整次修复回滚。

启动开发服务：

```bash
npm run backend:dev
npm run frontend:dev
```

本地前端开发端口固定为 `5176`，Vite 绑定 `0.0.0.0` 并启用 `strictPort`。

## Excel 订单导入

订单页面提供“导入订单”入口，用于上传组件 / 零件清单。导入只创建 `DRAFT` 草稿订单，不会自动提交生产、不会占用库存、不会生成生产任务。

使用规则：

- 先下载系统生成的上传模板，正式导入只读取 `ERP上传净表` 工作表；台账页只用于录入和复核，不能直接上传。
- `ERP上传净表` 从第 5 行开始连续填写明细，中间不能留空行，只允许尾部空白行。
- 同一个导入会话可以一次多选或连续上传多个 `.xlsx` 文件；系统会按会话合并预览并识别重复文件、重复业务行。
- 同一订单拆成多个文件连续上传时，系统会按文件上传顺序和来源行顺序兜底计算组件子件关系。
- 组件编号只在同一个订单内表达父子关系；模板默认提供 `C001-C9999` 便于下拉选择，但下拉不阻止手工输入其他编号，导入校验以同一订单内唯一、组件/子零件关系正确为准。
- 草稿创建前必须先看导入预览；有错误的订单不会创建草稿，无错误订单可以先勾选创建。
- 如果勾选了全部可导入订单，前端会自动使用后端 `allSelectable` 模式创建草稿，不把大批量订单号列表塞进请求体，适合大文件和连续上传后的整批导入。
- 如果先勾选全部可导入订单、再取消少量订单，前端会使用 `allSelectable + excludedOrderNos` 提交，只传少量排除订单号，避免大批量订单号请求体过大；提交成功后会提示未创建的可导入订单数量。
- 有警告的订单仍可创建草稿，但前端会要求再次确认；厚度、单位、工艺路线、图纸状态等警告必须在 ERP 草稿里复核后再提交生产。
- 创建草稿时系统会校验本次预览的 `previewToken`；如果预览后又继续上传或删除文件，系统会要求刷新预览后再创建草稿，避免旧预览把未复核的新行直接导入。
- 预览出现错误或警告时，可以下载“问题明细”Excel，按来源文件和来源行修正原始清单。
- 上传后可以在导入弹窗里按单个 Excel 文件打开“上传文件级预览”，大文件预览分页加载；分页只影响界面显示，不限制实际上传、解析和创建草稿的数据量。
- 文件名和 Excel 单元格中文必须保持不乱码；订单导入字段不设置业务字数上限，工艺路线、工艺备注、产品名称、图号、规格和来源信息不得被截断。
- 导入预览和导入记录会显示“涉及零件编码”数量，并展示前 5 个零件编码示例；口径是当前可导入订单里去重后的零件编码数量，错误订单里的零件不会计入。
- 导入生成的 `DRAFT` 草稿可以继续编辑，也可以删除。删除草稿会释放订单号，便于修正 Excel 后重新导入。
- 导入生成的订单详情可以打开“预览来源Excel”，按来源文件、工作表和 Excel 行号回看原始导入行；删除导入记忆后只保留文字追溯，原文件不可再预览。
- 导入创建草稿时只会补建缺失的零件搜索记忆，底层记录仍是 `Material`，方便后续在订单、库存和零件搜索中继续使用；已有零件搜索记忆不会被订单覆盖，也不会自动恢复已停用零件搜索记忆。客户归属来自订单历史，不会创建客户 BOM、全局适用范围或库存数量。
- 已提交的导入记录会保存实际生成的订单号记录，并单独显示当前仍存在的订单；删除上传记忆只清理导入会话和上传文件记录，不会删除已经生成的订单。
- 手机端订单界面只保留查看入口：订单列表可进入订单明细，订单新增、编辑、删除、取消、补单、提交生产和 Excel 导入上传都应在电脑端操作。

单个 Excel 文件默认安全上限为 `100MB`，可在 `.env` 中按部署机器能力调整。导入提交时前端会优先使用 `allSelectable` 或 `allSelectable + excludedOrderNos`，避免大批量订单号塞进请求体；如果确实需要一次传很多已选 / 排除订单号，可同步提高 `API_BODY_LIMIT`：

```text
API_BODY_LIMIT=10mb
ORDER_IMPORT_UPLOAD_MAX_MB=100
```

本地 backend 已启动并连接测试库后，可以单独跑一次导入 API 回归。该脚本会临时生成多组 Excel，覆盖模板下载、连续上传、重复上传拦截、选择部分订单创建草稿、全部可导入排除提交、旧预览拦截、错误订单预览拦截、缺失零件搜索记忆补建、草稿编辑删除、导入记忆删除，并在结束时清理测试草稿和导入记忆：

```bash
npm run verify:order-import-api
```

如需单独验证订单图纸、订单导入、库存盘点等上传入口的中文文件名兼容性，可以在 backend 已启动后执行：

```bash
npm run verify:upload-filenames-api
```

如需不启动 backend，单独验证前端显示文件名和后端 multipart 文件名清洗函数，可以执行：

```bash
npm run verify:file-name-normalizers
```

检查 `outputs/component-order-template` 中交付使用的 Excel 模板和 `erpordertest` 文件是否可打开、表头完整、最终版没有可见旧上传表和公式断链：

```bash
npm run verify:order-import-workbooks
```

## NAS 部署

```bash
copy .env.example .env
npm run docker:up
```

建议在 `.env` 中修改：

```text
POSTGRES_PASSWORD=强密码
FRONTEND_PORT=5176
BACKEND_PORT=3000
POSTGRES_DATA_DIR=./database/postgres-data
POSTGRES_BACKUP_DIR=./database/backups
UPLOAD_DIR=./storage/uploads
EXPORT_DIR=./storage/exports
```

说明：

- `.env` 里的 `UPLOAD_DIR` 和 `EXPORT_DIR` 表示 NAS 宿主机上的挂载目录。
- backend 容器内部固定使用 `/app/storage/uploads` 和 `/app/storage/exports`，避免容器内外路径混用。
- `POSTGRES_DATA_DIR` 建议放 SSD / NVMe；`POSTGRES_BACKUP_DIR`、`UPLOAD_DIR`、`EXPORT_DIR` 可放 NAS 大容量目录。

首次部署空库时执行 migration：

```bash
npm run docker:db:deploy
```

如果是测试库并且需要灌入第一阶段验收数据，再执行：

```bash
npm run docker:db:seed
```

注意：`docker:db:seed` 会先备份当前 PostgreSQL，校验备份后再传入 `SEED_BACKUP_CONFIRMED=true` 清理并重建第一阶段业务测试数据；不要在已有正式数据的库上执行裸 `db:seed`。

前端默认访问地址：

```text
http://localhost:5176
```

后端 API 默认访问地址：

```text
http://localhost:3000/api
```

本地 Vite 开发地址同样固定为：

```text
http://localhost:5176
```

手机真机测试不要使用 `localhost`，需要使用开发电脑局域网 IP，例如：

```text
http://192.168.110.147:5176/orders
```

Docker 部署后可检查容器健康状态：

```bash
npm run docker:ps
npm run docker:logs:backend
npm run docker:logs:frontend
npm run docker:db:status
npm run verify:docker-runtime
```

`verify:docker-runtime` 会校验当前 workspace 下只运行 `baisheng-erp-postgres`、`baisheng-erp-backend` 和 `baisheng-erp-frontend`，并确认当前项目只使用一个 PostgreSQL 容器。测试阶段如果 Docker Desktop 里还保留旧项目容器，应先用这个命令确认 ERP 没有误连旧库。

`docker:db:status` 会先打印当前 ERP 项目实际使用的 PostgreSQL 目标：`baisheng-erp-postgres`、`127.0.0.1:55432`、`POSTGRES_DATA_DIR` 和 `POSTGRES_BACKUP_DIR`，并显示当前库匹配到的备份数量、最新 `.dump` 备份文件和 `.sha256` 校验状态。测试阶段只认这一套项目库；如果输出里出现其他 PostgreSQL 容器或旧 volume，它们只是旧环境提示，不是当前 ERP 正在使用的数据库。

`docker:db:status` 会显示当前项目库的 migration 状态和关键业务表行数；如果 Docker 中还存在其他 PostgreSQL 容器或疑似旧 PostgreSQL volume，也会提示它们未被当前 ERP 项目使用，避免测试阶段误连旧库。

backend 健康检查会同时验证 PostgreSQL 连接、`UPLOAD_DIR` 和 `EXPORT_DIR` 可写；如果 NAS 挂载目录权限不正确，`backend` healthcheck 会失败。

## 数据备份

备份 PostgreSQL 到 `.env` 中的 `POSTGRES_BACKUP_DIR`：

```bash
npm run docker:db:backup
npm run docker:db:verify-backups
npm run docker:db:restore-plan
```

备份命令会同时生成同名 `.sha256` 文件，并用 `pg_restore --list` 验证 `.dump` 归档可被 PostgreSQL 工具读取；后续 `npm run docker:db:status` 会重新计算最新 `.dump` 的 SHA-256 并提示校验是否通过。

旧备份如果缺少 `.sha256`，可先执行 `npm run docker:db:verify-backups -- --write-missing` 补齐校验文件，再执行 `npm run docker:db:verify-backups` 严格校验全部备份的 SHA-256 和 `pg_restore --list` 归档结构。

`npm run docker:db:restore-plan` 只会校验并打印最新备份的 `pg_restore` 恢复命令，不会执行恢复；如需查看指定备份的恢复命令，可执行 `npm run docker:db:restore-plan -- --file=baisheng_erp_YYYYMMDD_HHMMSS.dump`，`--file` 只接受当前备份目录内当前数据库的 `.dump` 文件名。真正恢复前必须再次确认目标库是 `baisheng-erp-postgres` / `baisheng_erp`，并先备份当前数据。

恢复到空库示例：

```bash
docker compose exec postgres pg_restore -U baisheng -d baisheng_erp --clean --if-exists /backups/baisheng_erp_YYYYMMDD_HHMMSS.dump
```

如果 `.env` 修改了 `POSTGRES_USER` 或 `POSTGRES_DB`，命令中的 `baisheng` 和 `baisheng_erp` 要同步替换。

## 常见问题

- `docker compose build` 连接失败：先确认 Docker Desktop 或 NAS Docker 服务已经启动。
- `frontend` 健康检查失败：确认 `backend` 已通过 `/api/health`，并检查 `docker compose logs backend`。
- 本地前端端口不是 `5176`：检查是否从 `npm run frontend:dev` 启动；Vite 已设置 `strictPort`，端口占用时会直接报错。
- 手机打不开本地页面：不要使用 `localhost`，改用开发电脑局域网 IP。
- 上传图纸或盘点附件失败：检查 `.env` 中 `UPLOAD_DIR` 是否存在、是否有写入权限，以及容器内 `/app/storage/uploads` 是否已挂载。
- 导出文件失败或 `backend` healthcheck 失败：检查 `.env` 中 `EXPORT_DIR` 是否存在、是否有写入权限，以及容器内 `/app/storage/exports` 是否已挂载。
- Prisma 连接失败：确认 `DATABASE_URL` 指向 PostgreSQL 16，并先执行 `npm run backend:db:generate`。
- Windows 上 `npm run backend:db:generate` 报 `EPERM ... query_engine-windows.dll.node`：通常是正在运行的 backend 进程占用了 Prisma engine 文件，先停止本地 backend 后再执行 generate。
