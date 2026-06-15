# NewAPI Channel Watchdog

[English Documentation](README.md)

一个 0 侵入的 NewAPI 渠道健康守护器（Watchdog）。它作为独立 sidecar 运行，无需修改 NewAPI 源码、无需修改表结构、不接管主业务流量。

## 核心特性

- **零侵入架构**：旁路运行，通过 NewAPI 管理接口或只读 SQLite 发现渠道，不影响主流程。
- **原生探测**：复用 NewAPI 自带的 `/api/channel/test/{id}` 接口进行健康检查。
- **智能状态流转**：
  - 支持 `dry-run` 演练模式与真实的自动禁用/恢复动作。
  - 在 NewAPI 中被手动禁用的渠道会被识别为 `manually_disabled`，且不会被自动恢复。
- **安全优先**：不读取、不展示、不保存任何 NewAPI 渠道密钥（Key）。
- **现代控制台**：内置完整的管理后台（基于 React + shadcn/ui），提供数据总览、渠道管理、模型健康度、事件记录及策略配置。

## 数据与状态管理

Watchdog 所有数据均保存在自带的本地 SQLite 中，不对 NewAPI 数据库做任何写入：
- 包含表：`app_settings`, `channel_states`, `probe_events`, `status_events`, `watchdog_runs`, `model_health_snapshots`

状态机流转简述：
`unknown`（未知） -> `healthy`（健康） / `degraded`（降级） / `down`（宕机） -> `auto_disabled`（自动禁用） / `manually_disabled`（手动禁用） / `recovering`（恢复中）

## 快速启动

### 1. Docker 部署（推荐）

Docker / 1Panel 直接使用以下 `docker-compose.yml` 配置。无需提前创建 `config.yaml`，启动后在登录页和设置页完成初始化。

```yaml
services:
  newapi-watchdog:
    image: ghcr.io/charyeahowo/newapi_watchdog:latest
    container_name: newapi-watchdog
    restart: always
    environment:
      - TZ=Asia/Shanghai
    ports:
      - "8088:8088"
    volumes:
      - watchdog-data:/data

volumes:
  watchdog-data:
```

```bash
docker compose up -d
```

如果日志出现 `open sqlite store: unable to open database file`，通常是宿主机目录权限问题。请使用上面模板里的 Docker 命名卷 `watchdog-data:/data`，不要把宿主机目录直接挂到 `/app/data`。

### 2. 源码运行

```bash
go run ./cmd/watchdog
```

### 3. 初始化与配置

启动服务后：
1. 浏览器打开 `http://127.0.0.1:8088/`
2. 首次打开会进入登录页，输入账号和密码；第一个账号会自动成为管理员。
3. 登录后进入 **设置** 页面，配置 NewAPI 地址和具有管理权限的 Admin Token。
4. 进入 **策略** 页面，配置失败/恢复阈值（若需开启真实停用渠道动作，请关闭 `dry-run` 模式）。

## 开发与构建

**启动后端：**
```bash
go run ./cmd/watchdog
```

**启动前端：**
```bash
cd web
npm install
npm run dev
```

**生产环境构建（前端资源编译入 Go 二进制文件）：**
```bash
cd web && npm install && npm run build
cd .. && go build -o dist/newapi-watchdog ./cmd/watchdog
```

## API 接口参考

Watchdog 提供标准的 RESTful API。控制台登录后会自动携带会话凭证；读接口无需鉴权，写/操作接口需要管理员登录。

- `GET /status.json` - 获取机器可读的全局状态
- `GET /healthz` / `GET /readyz` - 存活与就绪检查
- `GET /api/channels` - 获取渠道列表及 Watchdog 状态
- `POST /api/probe/run` - 触发一次全局手动巡检
- `POST /api/channels/{id}/disable` - 手动禁用指定渠道
