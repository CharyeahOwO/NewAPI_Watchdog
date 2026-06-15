import type {
  Bootstrap,
  ChannelView,
  ModelView,
  PolicyConfig,
  RunResult,
  RunView,
  SettingsResponse,
  StatusEvent,
  StatusSnapshot,
  RuntimeConfig,
} from "@/types"

const TOKEN_KEY = "newapi-watchdog-write-token"

export function getStoredToken() {
  return window.localStorage.getItem(TOKEN_KEY) || ""
}

export function setStoredToken(token: string) {
  if (!token) {
    window.localStorage.removeItem(TOKEN_KEY)
    return
  }
  window.localStorage.setItem(TOKEN_KEY, token)
}

async function request<T>(path: string, init: RequestInit = {}, token?: string, headerName = "X-Watchdog-Token"): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  if (token) {
    headers.set(headerName, token)
  }
  const response = await fetch(path, { ...init, headers })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as { error?: string }
      message = payload.error || message
    } catch {
      // keep HTTP status message
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export const api = {
  bootstrap: () => request<Bootstrap>("/api/bootstrap"),
  status: () => request<StatusSnapshot>("/status.json"),
  channels: () => request<ChannelView[]>("/api/channels"),
  models: () => request<ModelView[]>("/api/models"),
  events: () => request<StatusEvent[]>("/api/events?limit=300"),
  runs: () => request<RunView[]>("/api/runs?limit=100"),
  settings: (token: string, header: string) => request<SettingsResponse>("/api/settings", {}, token, header),
  saveSettings: (payload: RuntimeConfig, token: string, header: string) =>
    request<SettingsResponse>("/api/settings", { method: "PUT", body: JSON.stringify(payload) }, token, header),
  rules: (token: string, header: string) => request<PolicyConfig>("/api/rules", {}, token, header),
  saveRules: (payload: PolicyConfig, token: string, header: string) =>
    request<PolicyConfig>("/api/rules", { method: "PUT", body: JSON.stringify(payload) }, token, header),
  runProbe: (token: string, header: string) =>
    request<RunResult>("/api/probe/run", { method: "POST" }, token, header),
  probeChannel: (channelID: number, token: string, header: string) =>
    request<RunResult>(`/api/channels/${channelID}/probe`, { method: "POST" }, token, header),
  disableChannel: (channelID: number, token: string, header: string) =>
    request(`/api/channels/${channelID}/disable`, { method: "POST" }, token, header),
  enableChannel: (channelID: number, token: string, header: string) =>
    request(`/api/channels/${channelID}/enable`, { method: "POST" }, token, header),
}

