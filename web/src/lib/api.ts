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
  AuthResponse,
} from "@/types"

const TOKEN_KEY = "newapi-watchdog-session-token"
const USER_KEY = "newapi-watchdog-session-user"

export function getStoredSession() {
  return {
    token: window.localStorage.getItem(TOKEN_KEY) || "",
    username: window.localStorage.getItem(USER_KEY) || "",
  }
}

export function setStoredSession(session: { token: string; username: string }) {
  window.localStorage.setItem(TOKEN_KEY, session.token)
  window.localStorage.setItem(USER_KEY, session.username)
}

export function clearStoredSession() {
  window.localStorage.removeItem(TOKEN_KEY)
  window.localStorage.removeItem(USER_KEY)
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
  login: (payload: { username: string; password: string }) =>
    request<AuthResponse>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),
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
  discoverChannels: (token: string, header: string) =>
    request<RunResult>("/api/channels/discover", { method: "POST" }, token, header),
  setChannelProbeSettings: (channelID: number, enabled: boolean, token: string, header: string) =>
    request<ChannelView>(`/api/channels/${channelID}/probe-settings`, { method: "PUT", body: JSON.stringify({ enabled }) }, token, header),
  runProbe: (token: string, header: string) =>
    request<RunResult>("/api/probe/run", { method: "POST" }, token, header),
  probeChannel: (channelID: number, token: string, header: string) =>
    request<RunResult>(`/api/channels/${channelID}/probe`, { method: "POST" }, token, header),
  disableChannel: (channelID: number, token: string, header: string) =>
    request(`/api/channels/${channelID}/disable`, { method: "POST" }, token, header),
  enableChannel: (channelID: number, token: string, header: string) =>
    request(`/api/channels/${channelID}/enable`, { method: "POST" }, token, header),
}
