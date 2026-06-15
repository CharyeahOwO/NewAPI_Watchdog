# NewAPI Channel Watchdog

[中文文档](README_zh.md)

A zero-intrusion NewAPI channel health watchdog. It runs as an independent sidecar, monitoring and managing channel health without modifying NewAPI's source code, database structure, or intercepting any main business traffic.

## Key Features

- **Zero Intrusion**: Runs alongside NewAPI. Does not take over traffic or require database schema modifications.
- **Native Probing**: Reuses NewAPI's native `/api/channel/test/{id}` endpoint to perform health checks.
- **Smart State Management**: 
  - Supports both `dry-run` and actual automatic disable/recover actions.
  - Channels manually disabled in NewAPI are marked as `manually_disabled` and will never be automatically recovered.
- **Secure**: Does not read, display, or save NewAPI channel API keys.
- **Built-in Console**: Includes a fully-fledged modern dashboard (built with React + shadcn/ui) for managing channels, viewing probe trends, model health, and system logs.

## Architecture & Data

Watchdog only writes to its own local SQLite database:
- `app_settings`
- `channel_states`
- `probe_events`
- `status_events`
- `watchdog_runs`
- `model_health_snapshots`

State Machine Flow:
`unknown` -> `healthy` / `degraded` / `down` -> `auto_disabled` / `manually_disabled` / `recovering`

## Getting Started

### 1. Docker Deployment (Recommended)

For Docker or 1Panel, use the following `docker-compose.yml`. No `config.yaml` is required before startup; initialization is completed from the login page and settings UI.

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

If logs show `open sqlite store: unable to open database file`, it is usually a host directory permission issue. Use the Docker named volume `watchdog-data:/data` from the template above instead of binding a host directory to `/app/data`.

### 2. Run from Source

```bash
go run ./cmd/watchdog
```

### 3. Initial Configuration

After starting the service:
1. Open the console at `http://127.0.0.1:8088/`
2. The first visit opens the login page. Enter an account and password; the first account automatically becomes the administrator.
3. Navigate to **Settings** to configure your NewAPI Base URL and Admin Token.
4. Navigate to **Rules** to configure failure/recovery thresholds and disable `dry-run` if actual auto-actions are required.

## Development

**Backend:**
```bash
go run ./cmd/watchdog
```

**Frontend:**
```bash
cd web
npm install
npm run dev
```

**Production Build:**
```bash
cd web && npm install && npm run build
cd .. && go build -o dist/newapi-watchdog ./cmd/watchdog
```

## API Endpoints

The watchdog provides RESTful JSON APIs. The console automatically carries a session credential after login; read APIs are public, while write/action APIs require administrator login.

- `GET /status.json` - Machine-readable overall status
- `GET /healthz` / `GET /readyz` - Health checks
- `GET /api/channels` - List channels and their watchdog states
- `POST /api/probe/run` - Trigger a manual global inspection
- `POST /api/channels/{id}/disable` - Manually disable a channel
