# 百胜 ERP 第一阶段

本项目只实现 `AGENT.md` 中允许的第一阶段范围：客户、订单、每个零件的生产流程选择、生产、仓库、库存。

## 技术栈

- `database`: PostgreSQL 16
- `ORM`: Prisma
- `backend`: NestJS + TypeScript
- `frontend`: Vue 3 + TypeScript + Vite + Element Plus
- `deployment`: Docker Compose，适配 TerraMaster F4-424 MAX NAS

## 本地开发

```bash
npm install
npm run backend:db:generate
npm run frontend:dev
npm run backend:dev
```

需要先准备 PostgreSQL，并在 `backend/.env` 中配置 `DATABASE_URL`。

```bash
copy backend\.env.example backend\.env
npm run backend:db:migrate
npm run backend:db:seed
```

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

说明：`.env` 里的 `UPLOAD_DIR` 和 `EXPORT_DIR` 表示 NAS 宿主机上的挂载目录；backend 容器内部固定使用 `/app/storage/uploads` 和 `/app/storage/exports`，避免容器内外路径混用。

首次启动后进入 backend 容器执行数据库初始化：

```bash
docker compose exec backend npm run db:deploy
docker compose exec backend npm run db:seed
```

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
