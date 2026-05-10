# 百胜 ERP 第一阶段

本项目只实现 `AGENT.md` 中允许的第一阶段范围：客户、订单、每个零件的生产流程选择、流程记忆、生产、统计、仓库、库存。

第一阶段页面入口固定为 8 个：

- 客户
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

注意：`backend:db:seed` 会清空并重建第一阶段业务测试数据，只用于本地开发库或明确要重置的测试库。

非破坏性校验第一阶段关键数据：

```bash
npm run backend:verify:first-stage
```

该命令只读取数据库，不会改数据；用于检查客户 / 仓库 / 库位大小写不敏感唯一、客户主联系人快照、`OrderNoReservation`、订单零件工序和 `ProductionTask` 一致性、`InventoryReservation`、草稿订单同批次库存预占先后顺序、`selectedStockSources`、库存流水余额、库存批次账实和来源一致性、生产 / 仓库通知确认记录、生产报废补单申请、报废记录、统计订单展示状态、生产计划偏差说明和盘点附件记录。

静态校验第一阶段前端范围和交互约束：

```bash
npm run verify:first-stage:source
```

该命令不连接数据库；用于检查第一阶段 8 个页面入口、关键共享组件、移动端响应式基线、禁用浏览器原生 `prompt` / `confirm` / `alert`、客户下拉搜索只展示客户名称、生产 / 仓库通知标题必须显示客户名称、生产流程填写和提交生产必须由下单 / 计划人员操作且车间人员只能查看、生产工序必须先开始生产并按保存顺序连续确认、订单展示状态统一显示“待提交生产 / 待确认生产 / 生产中 / 部分发货 / 已完成未发货 / 已完成发货”、生产短缺在补单完成后必须关闭待处理提醒并显示已处理记录、仓库分批发货必须支持“已发货 / 未发货 / 本次发货”、超发必须填写仓库确认人、销售确认人和说明并写入订单零件流水、生产首页“全部”位于“待处理”前面、旧库存来源缺少核对结果时前端必须拦截、库存来源已选批次必须按队列顺序自动重算后续使用数量、订单保存和库存实际扣减必须使用 Serializable transaction 内的实时 `selectedStockSources` / `availableQuantity`，历史修复脚本必须按草稿订单先后顺序校验库存预占，并确保 seed 保留同批库存跨行 / 跨订单预占场景。

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

该命令会依次执行源码静态校验、部署配置校验、数据库只读校验、后端构建和前端构建。

如果需要把 `Prisma generate` 也纳入一次性严格验收，先停止本地 backend 服务，再执行：

```bash
npm run verify:first-stage:strict
```

Windows 上正在运行的 backend 可能占用 `query_engine-windows.dll.node`，此时严格验收会在 `backend:db:generate` 报 `EPERM`，需要先停止 backend 后重试。

对历史测试数据做第一阶段安全修复检查：

```bash
npm run backend:repair:first-stage
```

该命令默认是 dry-run，只报告会补齐哪些 `productionPlanSuggestedQuantity`、生产计划偏差操作员和说明、库存来源临时字段、库存来源核对状态、草稿订单 `ACTIVE` 库存预占、历史订单发货状态、流程搜索字段、标准工序补录、生产操作人员基础资料、已消耗库存来源缺失的 `InventoryReservation` 记录，以及使用库存订单是否存在未正确转入订单待发货库存的阻断问题。标准工序补录会根据历史订单 / 流程模板引用恢复缺失或被停用的标准工序。确认要写入当前数据库时再执行：

```bash
npm run backend:repair:first-stage -- --write
```

执行 `--write` 前必须先备份数据库。修复脚本写入前会执行阻断检查；如果发现库存来源核对、草稿库存预占、库存消费预占或使用库存转订单待发货存在无法自动确认的问题，会直接停止且不写入任何修复。通过阻断检查后，所有修复写入会在一个 `Serializable` transaction 内完成，遇到 PostgreSQL / Prisma `P2034` 并发冲突会短暂重试，最终仍失败时整次修复回滚。

启动开发服务：

```bash
npm run backend:dev
npm run frontend:dev
```

本地前端开发端口固定为 `5176`，Vite 绑定 `0.0.0.0` 并启用 `strictPort`。

## NAS 部署

```bash
copy .env.example .env
docker compose up -d --build
```

建议在 `.env` 中修改：

```text
POSTGRES_PASSWORD=强密码
FRONTEND_PORT=8080
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
docker compose exec backend npm run db:deploy
```

如果是测试库并且需要灌入第一阶段验收数据，再执行：

```bash
docker compose exec backend npm run db:seed
```

注意：`db:seed` 会清理业务测试数据，不要在已有正式数据的库上执行。

前端默认访问地址：

```text
http://localhost:8080
```

后端 API 默认访问地址：

```text
http://localhost:3000/api
```

本地前端开发地址：

```text
http://localhost:5176
```

手机真机测试不要使用 `localhost`，需要使用开发电脑局域网 IP，例如：

```text
http://192.168.110.147:5176/orders
```

Docker 部署后可检查容器健康状态：

```bash
docker compose ps
docker compose logs backend
docker compose logs frontend
```

backend 健康检查会同时验证 PostgreSQL 连接、`UPLOAD_DIR` 和 `EXPORT_DIR` 可写；如果 NAS 挂载目录权限不正确，`backend` healthcheck 会失败。

## 数据备份

手工备份 PostgreSQL 到 `.env` 中的 `POSTGRES_BACKUP_DIR`：

```bash
docker compose exec postgres pg_dump -U baisheng -d baisheng_erp -F c -f /backups/baisheng_erp_$(date +%Y%m%d_%H%M%S).dump
```

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
