# TNAS ERP 部署记录

本文记录从 Windows PowerShell 进入 TNAS SSH，到在 NAS 上启动 ERP 并访问网页的干净流程。

## 1. 进入 NAS SSH

在 Windows PowerShell 中执行：

```powershell
ssh <SSH_USER>@<NAS_LAN_IP> -p <SSH_PORT>
```

说明：

- `<SSH_USER>` 是 TNAS 允许 SSH 登录的用户。
- `<NAS_LAN_IP>` 是 NAS 局域网 IP。
- `<SSH_PORT>` 是 TNAS SSH 端口，例如 `9222`。
- 输入密码时屏幕不显示字符，这是正常现象。

## 2. 进入 ERP 项目目录

```bash
cd /Volume1/erpsoft/erp_v0.2
```

确认项目文件存在：

```bash
ls
```

应能看到类似文件和目录：

```text
backend
frontend
database
docker-compose.yml
package.json
```

## 3. 创建环境配置文件

如果 `.env` 不存在，执行：

```bash
cp .env.example .env
```

如果 `.env` 已经存在，可以跳过这一步。

## 4. 下载基础镜像

如果 NAS 访问 Docker Hub 慢或超时，可以从镜像站拉取基础镜像并打标签。

```bash
docker pull docker.1ms.run/library/postgres:16-alpine
docker tag docker.1ms.run/library/postgres:16-alpine postgres:16-alpine

docker pull docker.1ms.run/library/node:20-bookworm-slim
docker tag docker.1ms.run/library/node:20-bookworm-slim node:20-bookworm-slim

docker pull docker.1ms.run/library/nginx:1.27-alpine
docker tag docker.1ms.run/library/nginx:1.27-alpine nginx:1.27-alpine
```

如果某条命令出现临时下载错误，可以重新执行同一条命令。

## 5. 启动 ERP

```bash
cd /Volume1/erpsoft/erp_v0.2
docker-compose up -d --build
```

等待构建和启动完成。

## 6. 查看容器状态

```bash
docker-compose ps
```

正常状态应类似：

```text
baisheng-erp-postgres   healthy
baisheng-erp-backend    healthy
baisheng-erp-frontend   started
```

如果后端或前端没有正常启动，查看日志：

```bash
docker logs --tail=120 baisheng-erp-backend
docker logs --tail=120 baisheng-erp-frontend
```

## 7. 初始化数据库

第一次部署需要执行数据库迁移：

```bash
docker-compose exec backend npm run db:deploy
```

看到下面内容表示迁移成功：

```text
All migrations have been successfully applied.
```

## 8. 测试数据说明

`db:seed` 用于导入测试数据，不是启动网页必需步骤。

如果只是先让系统跑起来，可以不执行：

```bash
docker-compose exec backend npm run db:seed
```

如果执行 `db:seed`，它会写入或重置测试业务数据，只适合测试库。

## 9. 访问网页

局域网内电脑或手机浏览器访问：

```text
http://<NAS_LAN_IP>:8080
```

如果使用 Tailscale 远程访问，手机或电脑需要先连接 Tailscale，然后访问：

```text
http://<NAS_TAILSCALE_IP>:8080
```

## 常用维护命令

进入项目目录：

```bash
cd /Volume1/erpsoft/erp_v0.2
```

查看状态：

```bash
docker-compose ps
```

查看日志：

```bash
docker-compose logs --tail=120
```

重启服务：

```bash
docker-compose up -d --build
```

停止服务：

```bash
docker-compose down
```

注意：不要随意执行带 `-v` 的 down 命令，例如 `docker-compose down -v`，它可能删除数据库卷或数据。
