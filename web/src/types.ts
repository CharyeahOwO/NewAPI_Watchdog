export type ChannelStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "down"
  | "auto_disabled"
  | "manually_disabled"
  | "recovering"

export type ChannelView = {
  channel_id: number
  name: string
  type?: string
  newapi_status?: string
  watchdog_status: ChannelStatus
  models: string[]
  test_model?: string
  group_name: string
  auto_ban: boolean | null
  newapi_disabled: boolean
  auto_disabled_by_watchdog: boolean
  consecutive_failures: number
  consecutive_successes: number
  last_probe_at?: string
  last_success_at?: string
  last_failure_at?: string
  last_error?: string
  last_latency_ms: number | null
  last_http_status: number | null
  success_rate_1h: number | null
  success_rate_24h: number | null
}

export type ModelView = {
  model: string
  group_name: string
  total_channels: number
  healthy: number
  degraded: number
  down: number
  auto_disabled: number
  manually_disabled: number
  avg_latency_ms: number | null
  success_rate_1h: number | null
  success_rate_24h: number | null
  snapshot_at: string
}

export type StatusEvent = {
  id: number
  channel_id: number | null
  previous_status?: string
  current_status: string
  reason?: string
  action?: string
  dry_run: boolean
  created_at: string
}

export type RunView = {
  id: string
  started_at: string
  finished_at?: string
  status: string
  channels_seen: number
  probes_total: number
  probes_ok: number
  probes_failed: number
  actions_taken: number
  error?: string
}

export type StatusSnapshot = {
  summary: {
    total_channels: number
    counts: Record<ChannelStatus, number>
  }
  channels: ChannelView[]
  models: ModelView[]
  events: StatusEvent[]
  runs: RunView[]
  generated_at: string
  dry_run: boolean
  newapi_base_url: string
}

export type ProbeTarget = {
  enabled?: boolean
  models: string[]
}

export type RuntimeConfig = {
  server: {
    host: string
    port: number
    title: string
    auto_start: boolean
  }
  auth: {
    write_token: string
    write_token_header: string
    username: string
    password_hash: string
  }
  database: {
    sqlite_path: string
  }
  discovery: {
    source: string
    sqlite_path: string
    sqlite_query: string
    page_size: number
  }
  probe: {
    mode: string
    model_query_param: string
    per_channel: Record<string, ProbeTarget>
  }
  newapi: {
    base_url: string
    admin_token: string
    admin_token_header: string
    admin_token_prefix: string
    timeout_seconds: number
    verify_ssl: boolean
    headers: Record<string, string>
    endpoints: Record<string, string>
    enabled_status_value: number
    disabled_status_value: number
    disable_action: ActionTemplate
    enable_action: ActionTemplate
  }
  policy: PolicyConfig
}

export type ActionTemplate = {
  method: string
  path: string
  body: Record<string, unknown>
  fetch_before_update: boolean
}

export type PolicyConfig = {
  interval_seconds: number
  per_channel_delay_seconds: number
  failure_threshold: number
  recovery_threshold: number
  degraded_failure_threshold: number
  slow_latency_ms: number
  auto_disable: boolean
  auto_recover: boolean
  dry_run: boolean
  respect_channel_auto_ban: boolean
  probe_manual_disabled: boolean
  transient_error_patterns: string[]
  fatal_error_patterns: string[]
}

export type SettingsResponse = {
  config: RuntimeConfig
  has_write_token: boolean
  has_admin_token: boolean
}

export type Bootstrap = {
  title: string
  write_token_header: string
  dry_run: boolean
  auth_initialized: boolean
  username: string
}

export type RunResult = {
  run_id: string
  channels_seen: number
  probes_total: number
  probes_ok: number
  probes_failed: number
  actions_taken: number
  status: string
  error?: string
}

export type AuthResponse = {
  token: string
  token_header: string
  username: string
  role: "admin"
  initialized: boolean
}
