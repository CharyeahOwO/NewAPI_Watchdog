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

Start the service via Docker Compose. No complex network configuration is required:

```bash
# 1. Create config and data directories
mkdir -p config
cp config.example.yaml config/config.yaml

# 2. Start the service
docker compose up -d
```
*Tip: After starting, configure your NewAPI's full public or local URL in the console Settings. No additional Docker network mappings are required.*

**For 1Panel or similar management panels, use the following `docker-compose.yml`:**

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

If 1Panel logs show `read /app/config.yaml: is a directory`, the host path was created as a directory. Remove that directory, then switch to `./config/config.yaml` and redeploy:

```bash
rm -rf config.yaml
mkdir -p config
cp config.example.yaml config/config.yaml
```

If logs show `open sqlite store: unable to open database file`, the host `./data` directory is usually not writable by the non-root container user. Use the Docker named volume `watchdog-data:/data` from the template above instead of binding a host directory to `/app/data`.

### 2. Run from Source

```bash
cp config.example.yaml config.yaml
go run ./cmd/watchdog -config config.yaml
```

### 3. Initial Configuration

`config.yaml` is only used for the initial startup to set the listening port and the initial admin token.
```yaml
auth:
  write_token: change-me  # Update this to a secure token
  write_token_header: X-Watchdog-Token
```

After starting the service:
1. Open the console at `http://127.0.0.1:8088/`
2. Click **"Input Token"** and enter your `write_token`.
3. Navigate to **Settings** to configure your NewAPI Base URL and Admin Token.
4. Navigate to **Rules** to configure failure/recovery thresholds and disable `dry-run` if actual auto-actions are required.

## Development

**Backend:**
```bash
go run ./cmd/watchdog -config config.yaml
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

The watchdog provides RESTful JSON APIs. Read APIs are public; Write/Action APIs require the `X-Watchdog-Token` authentication header.

- `GET /status.json` - Machine-readable overall status
- `GET /healthz` / `GET /readyz` - Health checks
- `GET /api/channels` - List channels and their watchdog states
- `POST /api/probe/run` - Trigger a manual global inspection
- `POST /api/channels/{id}/disable` - Manually disable a channel
