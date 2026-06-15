# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Go backend and a React/Vite admin console.

- `cmd/watchdog/` contains the application entrypoint.
- `internal/config`, `internal/httpapi`, `internal/newapi`, `internal/store`, `internal/watchdog`, and `internal/core` contain backend modules.
- `web/src/` contains the frontend application, shared UI components, API client, and types.
- `web/src/components/ui/` holds reusable UI primitives.
- `internal/httpapi/webdist/` contains embedded production frontend assets.
- `data/` stores local runtime SQLite data and should not be treated as source code.

## Build, Test, and Development Commands

- `go run ./cmd/watchdog` starts the backend locally on the configured port, default `8088`.
- `go test ./...` runs all Go tests.
- `cd web && npm install` installs frontend dependencies.
- `cd web && npm run dev` starts the Vite dev server, default `5173`.
- `cd web && npm run build` type-checks and builds the frontend.
- `docker compose up -d` runs the containerized service using `docker-compose.yml`.

## Coding Style & Naming Conventions

Use `gofmt` for all Go files. Keep package names short and lowercase. Prefer small, direct functions that match the current module boundaries.

Frontend code uses TypeScript, React, and existing local UI primitives. Prefer components already in `web/src/components/ui/` before adding new ones. Keep React component names in `PascalCase`, hooks and helpers in `camelCase`, and shared types in `web/src/types.ts`.

For frontend selection controls, use existing project UI primitives such as `Combobox`; do not use browser-native `select` controls unless the surrounding code already uses them.

## Testing Guidelines

Backend tests use Go’s standard `testing` package and live beside implementation files as `*_test.go`. Add focused tests for service, policy, store, and HTTP behavior when backend logic changes.

For frontend changes, run `npm run build` at minimum. For user-facing UI changes, verify the affected page in the browser and include screenshots or clear reproduction notes when relevant.

## Commit & Pull Request Guidelines

Recent commits use short imperative messages, for example `Add per-channel probe model selection` or `Polish channel status badges`. Keep commits focused on one feature or fix.

Pull requests should include a concise summary, test results, and screenshots for visible UI changes. Link related issues when available. Call out configuration or migration impacts explicitly.

## Security & Configuration Tips

Never commit real admin tokens, API keys, or production SQLite data. Use `config.example.yaml` as the safe reference for configuration. Keep local secrets in runtime config or environment-specific files outside version control.
