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

首次初始化测试数据：

```bash
npm run backend:db:seed
```

注意：`backend:db:seed` 会清空并重建第一阶段业务测试数据，只用于本地开发库或明确要重置的测试库。

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
- Prisma 连接失败：确认 `DATABASE_URL` 指向 PostgreSQL 16，并先执行 `npm run backend:db:generate`。
