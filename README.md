# NewAPI Channel Watchdog

一个 0 侵入的 NewAPI 渠道健康守护器。它作为独立 sidecar 运行，不修改 NewAPI 源码、不修改 NewAPI 表结构、不接管主业务流量。

技术栈：

- 后端：Go + chi + SQLite
- 前端：React + TypeScript + Vite + Tailwind CSS + shadcn/ui 风格组件
- 控制台能力：TanStack Query、TanStack Table、React Hook Form、Zod、Recharts
- 部署：单个 Go 二进制嵌入 React 构建产物

## 功能边界

watchdog 只做旁路健康管理：

- 通过 NewAPI 管理接口或只读 SQLite 发现渠道。
- 复用 NewAPI 自带 `/api/channel/test/{id}` 做探测。
- 本地 SQLite 保存 watchdog 自己的状态、历史探测、事件、运行记录和模型聚合快照。
- 支持 dry-run 和真实自动禁用/恢复。
- 手动禁用渠道会被识别为 `manually_disabled`，绝不自动恢复。
- 不读取、不展示、不保存 NewAPI 渠道 key。

## 控制台

默认打开完整管理后台，而不是简单状态页：

- Dashboard 总览
- Channels 渠道管理
- Models 模型健康
- Events 事件记录
- Runs 巡检记录
- Rules 策略配置
- Settings 系统设置

控制台视觉偏 OpenAI / Vercel / shadcn/ui：干净、现代、留白明确，不是老式蓝白后台，也不是监控大屏。

## 配置方式

不使用环境变量。

`config.yaml` 只做首次启动引导，包括服务监听地址、SQLite 路径和初始后台写操作 token。首次启动后，运行配置会写入本地 SQLite 的 `app_settings` 表；后续 NewAPI 地址、Admin Token、发现方式、探测模式、策略阈值、启停动作模板，都在后台 Settings / Rules 页面维护。

首次 token 在 `config.yaml`：

```yaml
auth:
  write_token: change-me
  write_token_header: X-Watchdog-Token
```

第一次进入后台后，请立刻在 Settings 中改成随机长 token。

## 快速启动

```bash
cp config.example.yaml config.yaml
go run ./cmd/watchdog -config config.yaml
```

打开：

- 控制台：`http://127.0.0.1:8088/`
- 机器可读状态：`http://127.0.0.1:8088/status.json`
- 健康检查：`http://127.0.0.1:8088/healthz`
- 就绪检查：`http://127.0.0.1:8088/readyz`

进入控制台后：

1. 点击右上角“输入 Token”。
2. 输入 `config.yaml` 里的 `auth.write_token`。
3. 进入 Settings，填写 NewAPI Base URL 和 Admin Token。
4. 进入 Rules，确认 dry-run、失败阈值、恢复阈值。
5. 回 Dashboard 或 Channels，点击“立即巡检”。

## Docker 部署

```bash
cp config.example.yaml config.yaml
docker compose -f docker-compose.example.yml up -d --build
```

如果你的 NewAPI compose 网络不是 `newapi`，修改 `docker-compose.example.yml` 里的 external network 名称。

Dockerfile 会先构建 React 控制台，再把 `web/dist` 嵌入 Go 二进制。

## 本地前端开发

先启动后端：

```bash
go run ./cmd/watchdog -config config.yaml
```

再启动前端开发服务器：

```bash
cd web
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。Vite 会把 `/api`、`/status.json`、`/healthz`、`/readyz` 代理到后端。

## 生产构建

```bash
cd web
npm install
npm run build
cd ..
```

把 `web/dist` 覆盖到 `internal/httpapi/webdist` 后构建 Go：

```bash
go build -o dist/newapi-watchdog ./cmd/watchdog
```

Dockerfile 已经自动完成这一步。

## JSON API

只读接口：

- `GET /api/bootstrap`
- `GET /healthz`
- `GET /readyz`
- `GET /status.json`
- `GET /api/channels`
- `GET /api/models`
- `GET /api/events?limit=100&channel_id=12`
- `GET /api/runs?limit=100`

写接口需要鉴权：

- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/rules`
- `PUT /api/rules`
- `POST /api/probe/run`
- `POST /api/channels/{id}/probe`
- `POST /api/channels/{id}/disable`
- `POST /api/channels/{id}/enable`

默认鉴权头：

```bash
X-Watchdog-Token: <后台写操作 token>
```

示例：

```bash
curl -X POST http://127.0.0.1:8088/api/probe/run \
  -H "X-Watchdog-Token: change-me"
```

## 状态机

- `unknown`：还没有足够探测结果。
- `healthy`：探测成功且延迟正常。
- `degraded`：探测失败次数未达下线阈值，或成功但延迟超过慢响应阈值。
- `down`：连续失败达到阈值，或 fatal 错误触发立即下线判断。
- `auto_disabled`：watchdog 已真实自动禁用该渠道。
- `manually_disabled`：NewAPI 中已禁用，但不是 watchdog 自动禁用，绝不自动恢复。
- `recovering`：故障后出现成功探测，但还没达到恢复阈值。

## 本地数据

watchdog 只写自己的 SQLite：

- `app_settings`
- `channel_states`
- `probe_events`
- `status_events`
- `watchdog_runs`
- `model_health_snapshots`

不会修改 NewAPI 表结构。

## 验收方式

1. 启动服务后打开 `http://127.0.0.1:8088/`。
2. 点击右上角“输入 Token”，输入 `config.yaml` 里的写操作 token。
3. 打开 Settings，填写 NewAPI Base URL 和 Admin Token，点击“保存设置”。
4. 打开 Rules，确认 `dry-run` 是开启状态，点击“保存策略”。
5. 点击右上角“立即巡检”。
6. Dashboard 预期出现渠道总览、巡检趋势、状态分布、模型健康图。
7. Channels 预期出现渠道表格，可搜索，可对单个渠道执行 Probe / Disable / Enable。
8. Models / Events / Runs 预期能看到模型聚合、状态变化事件、巡检运行记录。
9. 打开 `/status.json`，预期看到同样的机器可读状态。

如果失败，最常见原因：

- Settings 里的 NewAPI Base URL 在当前网络不可达。
- Admin Token 没有管理权限，或认证头格式与当前 NewAPI 部署不一致。
- 当前 NewAPI 版本的启停接口请求体不同，需要在 Settings 中调整启停动作模板。
- 使用只读 SQLite 发现时，容器没有挂载 NewAPI 数据库路径。

## 开发测试

```bash
go test ./...
cd web && npm run build
```

