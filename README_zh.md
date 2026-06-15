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

通过 Docker Compose 启动服务：

```bash
# 1. 创建配置和数据目录
mkdir -p config
cp config.example.yaml config/config.yaml

# 2. 启动服务
docker compose up -d
```
*提示：启动后，请在控制台的 Settings 页面填写 NewAPI 的完整外部或内部地址，无需配置额外的 Docker 网络映射。*

**针对 1Panel 等可视化面板部署，可以直接使用以下 `docker-compose.yml` 配置：**

```yaml
services:
  newapi-watchdog:
    image: ghcr.io/charyeahowo/newapi_watchdog:latest
    container_name: newapi-watchdog
    restart: always
    environment:
      - TZ=Asia/Shanghai
    command: ["-config", "/app/config/config.yaml"]
    ports:
      - "8088:8088"
    volumes:
      - ./config:/app/config:ro
      - watchdog-data:/data

volumes:
  watchdog-data:
```

如果 1Panel 日志出现 `read /app/config.yaml: is a directory`，说明宿主机上的 `config.yaml` 被面板创建成了目录。删除这个错误目录，改用 `./config/config.yaml` 文件后重新部署：

```bash
rm -rf config.yaml
mkdir -p config
cp config.example.yaml config/config.yaml
```

如果日志出现 `open sqlite store: unable to open database file`，通常是宿主机 `./data` 目录权限不允许容器内的非 root 用户写入。推荐使用上面模板里的 Docker 命名卷 `watchdog-data:/data`，不要把宿主机目录直接挂到 `/app/data`。

### 2. 源码运行

```bash
cp config.example.yaml config.yaml
go run ./cmd/watchdog -config config.yaml
```

### 3. 初始化与配置

`config.yaml` 仅用于首次启动引导（配置监听地址和初始鉴权 Token），后续业务配置均在控制台完成。
```yaml
auth:
  write_token: change-me  # 建议修改为安全的随机字符串
  write_token_header: X-Watchdog-Token
```

启动服务后：
1. 浏览器打开 `http://127.0.0.1:8088/`
2. 点击右上角 **"输入 Token"**，填入 `config.yaml` 中的 `write_token` 进行鉴权。
3. 进入 **Settings** 页面，配置 NewAPI Base URL 和具有管理权限的 Admin Token。
4. 进入 **Rules** 页面，配置失败/恢复阈值（若需开启真实停用渠道动作，请关闭 `dry-run` 模式）。

## 开发与构建

**启动后端：**
```bash
go run ./cmd/watchdog -config config.yaml
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

Watchdog 提供标准的 RESTful API。读接口无需鉴权，写/操作接口需要在 Header 中携带 `X-Watchdog-Token`。

- `GET /status.json` - 获取机器可读的全局状态
- `GET /healthz` / `GET /readyz` - 存活与就绪检查
- `GET /api/channels` - 获取渠道列表及 Watchdog 状态
- `POST /api/probe/run` - 触发一次全局手动巡检
- `POST /api/channels/{id}/disable` - 手动禁用指定渠道
