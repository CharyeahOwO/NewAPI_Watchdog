import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Controller, useForm } from "react-hook-form"
import { motion, Variants } from "framer-motion"
import CountUp from "react-countup"
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Gauge,
  History,
  KeyRound,
  Languages,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Palette,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Workflow,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { z } from "zod"

import { DataTable } from "@/components/data-table"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Combobox } from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api, clearStoredSession, getStoredSession, setStoredSession } from "@/lib/api"
import { cn, percent, seconds } from "@/lib/utils"
import type {
  AuthResponse,
  ChannelView,
  ModelView,
  PolicyConfig,
  RunView,
  RunResult,
  SettingsResponse,
  StatusEvent,
  StatusSnapshot,
} from "@/types"

function formatLocalDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || "-"

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(/\//g, "-")
}

function runStatusLabel(status: string) {
  if (status === "running") return "运行中"
  if (status === "ok") return "完成"
  if (status === "failed") return "失败"
  return "未知"
}

const rulesSchema = z.object({
  interval_seconds: z.coerce.number().int().min(10),
  per_channel_delay_seconds: z.coerce.number().min(0),
  failure_threshold: z.coerce.number().int().min(1),
  recovery_threshold: z.coerce.number().int().min(1),
  recovery_wait_seconds: z.coerce.number().int().min(0),
  degraded_failure_threshold: z.coerce.number().int().min(1),
  slow_latency_ms: z.coerce.number().int().min(1),
  error_rate_threshold: z.coerce.number().min(1).max(100),
  error_rate_min_requests: z.coerce.number().int().min(1),
  auto_disable: z.boolean(),
  auto_recover: z.boolean(),
  dry_run: z.boolean(),
  respect_channel_auto_ban: z.boolean(),
  probe_manual_disabled: z.boolean(),
  transient_error_patterns: z.string(),
  fatal_error_patterns: z.string(),
})

type RulesForm = z.infer<typeof rulesSchema>

const defaultRulesForm: RulesForm = {
  interval_seconds: 120,
  per_channel_delay_seconds: 0,
  failure_threshold: 3,
  recovery_threshold: 2,
  recovery_wait_seconds: 60,
  degraded_failure_threshold: 1,
  slow_latency_ms: 5000,
  error_rate_threshold: 60,
  error_rate_min_requests: 10,
  auto_disable: true,
  auto_recover: true,
  dry_run: true,
  respect_channel_auto_ban: true,
  probe_manual_disabled: false,
  transient_error_patterns: "",
  fatal_error_patterns: "",
}

const settingsSchema = z.object({
  newapi_base_url: z.string().min(1),
  admin_token: z.string(),
  admin_user_id: z.string(),
  admin_token_header: z.string().min(1),
  admin_token_prefix: z.string(),
  timeout_seconds: z.coerce.number().int().min(1),
  enabled_status_value: z.coerce.number().int(),
  disabled_status_value: z.coerce.number().int(),
  discovery_source: z.string().min(1),
  discovery_sqlite_path: z.string(),
  discovery_sqlite_query: z.string(),
  discovery_page_size: z.coerce.number().int().min(1),
  probe_mode: z.string().min(1),
  model_query_param: z.string().min(1),
  headers_json: z.string(),
  endpoints_json: z.string(),
  disable_body_json: z.string(),
  enable_body_json: z.string(),
})

type SettingsForm = z.infer<typeof settingsSchema>
type SetupStep = "connection" | "policy" | "finish"
type Language = "zh" | "en"
type ThemeMode = "light" | "dark"

const messages = {
  zh: {
    navDashboard: "总览",
    navChannels: "渠道",
    navModels: "模型",
    navEvents: "事件",
    navRuns: "巡检",
    navRules: "策略",
    navSettings: "设置",
    sidebarSubtitle: "旁路健康控制台",
    console: "控制台",
    dryRun: "模拟运行",
    liveRun: "真实执行",
    runNow: "立即巡检",
    logout: "退出",
    language: "语言",
    theme: "主题",
    themeLight: "浅色",
    themeDark: "深色",
    dashboardEyebrow: "总览",
    dashboardTitle: "旁路健康总览",
    dashboardDesc: "快速查看渠道可用性、故障数量和最近巡检结果。",
    totalChannels: "总渠道",
    healthy: "健康",
    degradedRecovering: "降级/恢复",
    downDisabled: "故障/禁用",
    recentRuns: "最近巡检",
    recentRunsDesc: "成功和失败探测数量的短期走势。",
    statusDistribution: "状态分布",
    statusDistributionDesc: "渠道状态机当前计数。",
    modelHealth: "模型健康面",
    modelHealthDesc: "按模型聚合的健康渠道和风险渠道。",
    operationFailed: "操作失败",
    fetchingChannels: "正在向 NewAPI 拉取渠道信息。",
    discoveryComplete: "发现完成",
    probeComplete: "巡检完成",
    discoveredChannelsOnly: "发现 {channels} 个渠道，未执行渠道探测。",
    probeSummary: "发现 {channels} 个渠道，探测 {total} 次，成功 {ok} 次，失败 {failed} 次。",
    noChannelsHint: "没有渠道通常表示 NewAPI 管理接口没有返回渠道，或当前管理 Token 权限不够。",
  },
  en: {
    navDashboard: "Dashboard",
    navChannels: "Channels",
    navModels: "Models",
    navEvents: "Events",
    navRuns: "Runs",
    navRules: "Rules",
    navSettings: "Settings",
    sidebarSubtitle: "Sidecar health console",
    console: "Console",
    dryRun: "Dry run",
    liveRun: "Live run",
    runNow: "Run now",
    logout: "Logout",
    language: "Language",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    dashboardEyebrow: "Dashboard",
    dashboardTitle: "Sidecar Health Overview",
    dashboardDesc: "Quickly check channel availability, failures, and recent probe results.",
    totalChannels: "Channels",
    healthy: "Healthy",
    degradedRecovering: "Degraded/Recovering",
    downDisabled: "Down/Disabled",
    recentRuns: "Recent Runs",
    recentRunsDesc: "Short-term trend of successful and failed probes.",
    statusDistribution: "Status Distribution",
    statusDistributionDesc: "Current channel state counts.",
    modelHealth: "Model Health",
    modelHealthDesc: "Healthy and risky channels grouped by model.",
    operationFailed: "Operation failed",
    fetchingChannels: "Fetching channel data from NewAPI.",
    discoveryComplete: "Discovery complete",
    probeComplete: "Probe complete",
    discoveredChannelsOnly: "Found {channels} channels. No channel probes were executed.",
    probeSummary: "Found {channels} channels, ran {total} probes, {ok} succeeded and {failed} failed.",
    noChannelsHint: "No channels usually means the NewAPI admin API returned none, or the current admin token lacks permission.",
  },
} as const

type MessageKey = keyof typeof messages.zh
type Translate = (key: MessageKey) => string

const navItems = [
  { path: "/dashboard", labelKey: "navDashboard" as const, icon: LayoutDashboard },
  { path: "/channels", labelKey: "navChannels" as const, icon: Workflow },
  { path: "/models", labelKey: "navModels" as const, icon: Bot },
  { path: "/events", labelKey: "navEvents" as const, icon: History },
  { path: "/runs", labelKey: "navRuns" as const, icon: Activity },
  { path: "/rules", labelKey: "navRules" as const, icon: SlidersHorizontal },
  { path: "/settings", labelKey: "navSettings" as const, icon: Settings },
]

function detectLanguage(): Language {
  const stored = window.localStorage.getItem("watchdog-language")
  if (stored === "zh" || stored === "en") return stored
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"
}

function storedTheme(): ThemeMode {
  return window.localStorage.getItem("watchdog-theme") === "dark" ? "dark" : "light"
}

function formatMessage(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""))
}

function App() {
  const [path, setPath] = React.useState(() => normalizePath(window.location.pathname))
  const [session, setSession] = React.useState(getStoredSession)
  const [language, setLanguage] = React.useState<Language>(detectLanguage)
  const [theme, setTheme] = React.useState<ThemeMode>(storedTheme)
  const queryClient = useQueryClient()
  const t = React.useCallback<Translate>((key) => messages[language][key], [language])
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: api.bootstrap, refetchInterval: false })
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, enabled: !!session.token })

  React.useEffect(() => {
    const onPop = () => setPath(normalizePath(window.location.pathname))
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  React.useEffect(() => {
    window.localStorage.setItem("watchdog-language", language)
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en"
  }, [language])

  React.useEffect(() => {
    window.localStorage.setItem("watchdog-theme", theme)
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  function navigate(next: string) {
    window.history.pushState({}, "", next)
    setPath(normalizePath(next))
  }

  function saveSession(next: AuthResponse) {
    const stored = { token: next.token, username: next.username }
    setStoredSession(stored)
    setSession(stored)
    queryClient.invalidateQueries()
  }

  function logout() {
    clearStoredSession()
    setSession({ token: "", username: "" })
    queryClient.clear()
    window.history.pushState({}, "", "/")
    setPath("/dashboard")
  }

  const header = bootstrap.data?.write_token_header || "X-Watchdog-Token"
  const token = session.token
  const needsSetup = !!session.token && bootstrap.data ? !bootstrap.data.setup_completed : false
  const runMutation = useMutation({
    mutationFn: () => api.runProbe(token, header),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["status"] })
      queryClient.invalidateQueries({ queryKey: ["channels"] })
      queryClient.invalidateQueries({ queryKey: ["models"] })
      queryClient.invalidateQueries({ queryKey: ["events"] })
      queryClient.invalidateQueries({ queryKey: ["runs"] })
    },
  })

  if (!session.token) {
    return (
      <LoginPage
        title={bootstrap.data?.title || "NewAPI Channel Watchdog"}
        initialized={Boolean(bootstrap.data?.auth_initialized)}
        loading={bootstrap.isLoading}
        onLogin={saveSession}
      />
    )
  }

  if (needsSetup) {
    return <SetupWizard token={token} header={header} username={session.username || "admin"} onDone={() => queryClient.invalidateQueries()} />
  }

  const content = (() => {
    switch (path) {
      case "/channels":
        return <ChannelsPage token={token} header={header} />
      case "/models":
        return <ModelsPage />
      case "/events":
        return <EventsPage />
      case "/runs":
        return <RunsPage />
      case "/rules":
        return <RulesPage token={token} header={header} />
      case "/settings":
        return <SettingsPage token={token} header={header} />
      default:
        return <DashboardPage status={status.data} loading={status.isLoading} t={t} />
    }
  })()

  return (
    <div className="console-shell min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-stone-200 bg-stone-50/60 px-3 py-5 backdrop-blur-xl lg:flex">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 shadow-paper">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-medium text-stone-800">NewAPI Watchdog</div>
            <div className="text-xs text-stone-500">{t("sidebarSubtitle")}</div>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-stone-500 transition-all duration-300 ease-out active:scale-[0.99] hover:bg-white hover:text-stone-800",
                path === item.path && "bg-white text-stone-900 shadow-paper ring-1 ring-stone-200 hover:bg-white",
              )}
            >
              <item.icon className={cn("h-4 w-4 transition-colors", path === item.path ? "text-stone-700" : "text-stone-400")} />
              {t(item.labelKey)}
            </button>
          ))}
        </nav>
        <PreferenceControls
          className="mt-auto px-1 pt-6"
          language={language}
          theme={theme}
          side="top"
          onLanguageChange={setLanguage}
          onThemeChange={setTheme}
          t={t}
        />
      </aside>

      <div className="lg:pl-56">
        <header className="sticky top-0 z-30 border-b border-stone-200 bg-[#FDFCFB]/80 backdrop-blur-xl">
          <div className="px-4 py-3 sm:px-5 lg:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="inline-flex h-9 flex-wrap items-center gap-2 rounded-full border border-stone-200 bg-white px-3 text-sm text-stone-500 shadow-paper">
                  <span>{t("console")}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-stone-400" />
                  <span className="text-stone-800">{t(navItems.find((item) => item.path === path)?.labelKey || "navDashboard")}</span>
                </div>
                <h1 className="mt-2 break-words font-serif text-xl font-normal tracking-tight text-stone-900 sm:text-2xl">
                  {bootstrap.data?.title || "NewAPI Channel Watchdog"}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.data?.dry_run ? "warning" : "success"}>{status.data?.dry_run ? t("dryRun") : t("liveRun")}</Badge>
                <Badge variant="outline">{session.username || "admin"}</Badge>
                <Button size="sm" variant="outline" onClick={() => runMutation.mutate()} disabled={!token || runMutation.isPending}>
                  {runMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {t("runNow")}
                </Button>
                <Button size="sm" variant="ghost" onClick={logout}>
                  <LogOut className="h-4 w-4" />
                  {t("logout")}
                </Button>
              </div>
            </div>
            <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {navItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={cn(
                    "flex flex-none items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all duration-300 ease-out active:scale-[0.99]",
                    path === item.path
                      ? "border-stone-300 bg-white text-stone-900 shadow-paper"
                      : "border-stone-200 bg-transparent text-stone-500 hover:bg-white hover:text-stone-800",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </button>
              ))}
            </nav>
        <PreferenceControls
          className="mt-3 lg:hidden"
          language={language}
          theme={theme}
          onLanguageChange={setLanguage}
              onThemeChange={setTheme}
              t={t}
            />
          </div>
        </header>
        <main className="px-4 py-6 sm:px-5 lg:px-8">
          <RunFeedback mutation={runMutation} t={t} />
          {content}
        </main>
      </div>
    </div>
  )
}

function PreferenceControls({
  className,
  language,
  theme,
  onLanguageChange,
  onThemeChange,
  t,
  side = "bottom",
}: {
  className?: string
  language: Language
  theme: ThemeMode
  side?: "top" | "bottom"
  onLanguageChange: (value: Language) => void
  onThemeChange: (value: ThemeMode) => void
  t: Translate
}) {
  const languageOptions = [
    { value: "zh", label: "中文" },
    { value: "en", label: "English" },
  ]
  const themeOptions = [
    { value: "light", label: t("themeLight") },
    { value: "dark", label: t("themeDark") },
  ]

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Combobox
        className="w-10"
        contentClassName="w-40"
        value={language}
        onValueChange={(value) => onLanguageChange(value as Language)}
        options={languageOptions}
        searchable={false}
        side={side}
        ariaLabel={t("language")}
        trigger={<Languages className="mx-auto h-4 w-4 text-stone-700" />}
      />
      <Combobox
        className="w-10"
        contentClassName="w-36"
        value={theme}
        onValueChange={(value) => onThemeChange(value as ThemeMode)}
        options={themeOptions}
        searchable={false}
        side={side}
        ariaLabel={t("theme")}
        trigger={<Palette className="mx-auto h-4 w-4 text-stone-700" />}
      />
    </div>
  )
}

function RunFeedback({ mutation, t = (key) => messages.zh[key] }: { mutation: UseMutationResult<RunResult, Error, void>; t?: Translate }) {
  if (mutation.isIdle) return null
  if (mutation.isPending) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }}>
        <Card className="mb-5 border-stone-200 bg-stone-50">
          <CardContent className="flex items-center gap-3 p-5 text-sm text-stone-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {t("fetchingChannels")}
          </CardContent>
        </Card>
      </motion.div>
    )
  }
  if (mutation.isError) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }}>
        <Card className="mb-5 border-rose-200 bg-rose-50/60">
          <CardContent className="flex items-start gap-3 p-5 text-sm text-rose-700">
            <CircleAlert className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <div className="font-medium">{t("operationFailed")}</div>
              <div className="mt-1 break-words">{mutation.error.message}</div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    )
  }
  const result = mutation.data
  const discoveryOnly = result.probes_total === 0 && result.actions_taken === 0
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }}>
      <Card className="mb-5 border-emerald-200 bg-emerald-50/60">
        <CardContent className="flex items-start gap-3 p-5 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
          <div>
            <div className="font-medium">{discoveryOnly ? t("discoveryComplete") : t("probeComplete")}</div>
            <div className="mt-1">
              {discoveryOnly
                ? formatMessage(t("discoveredChannelsOnly"), { channels: result.channels_seen })
                : formatMessage(t("probeSummary"), { channels: result.channels_seen, total: result.probes_total, ok: result.probes_ok, failed: result.probes_failed })}
            </div>
            {result.channels_seen === 0 ? <div className="mt-1 text-emerald-700/80">{t("noChannelsHint")}</div> : null}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function LoginPage({
  title,
  initialized,
  loading,
  onLogin,
}: {
  title: string
  initialized: boolean
  loading: boolean
  onLogin: (response: AuthResponse) => void
}) {
  const [username, setUsername] = React.useState(initialized ? "" : "admin")
  const [password, setPassword] = React.useState("")
  const mutation = useMutation({
    mutationFn: () => api.login({ username: username.trim(), password }),
    onSuccess: onLogin,
  })

  React.useEffect(() => {
    if (!initialized && !username) {
      setUsername("admin")
    }
  }, [initialized, username])

  const form = (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <div className="space-y-2">
        <Label>账号</Label>
        <Input
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="admin"
        />
      </div>
      <div className="space-y-2">
        <Label>密码</Label>
        <Input
          autoComplete={initialized ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          placeholder={initialized ? "输入管理员密码" : "设置管理员密码"}
        />
      </div>
      {mutation.error ? <p className="text-sm text-destructive">{mutation.error.message}</p> : null}
      <Button className="w-full" disabled={!username.trim() || !password || mutation.isPending}>
        {mutation.isPending ? "处理中" : initialized ? "登录" : "下一步"}
      </Button>
      {!initialized ? (
        <div className="flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs leading-5 text-stone-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-stone-400" />
          首个账号默认拥有管理员权限。
        </div>
      ) : null}
    </form>
  )

  if (!initialized) {
    return (
      <main className="console-shell min-h-screen px-4 py-8">
        <section className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-xl border border-stone-200 bg-white p-6 shadow-paper">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700">
                <Terminal className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium text-stone-800">NewAPI Watchdog</div>
                <div className="text-xs text-stone-500">首次引导</div>
              </div>
            </div>
            <div className="mt-8 space-y-2">
              <StepItem active done={false} index="1" label="管理员账号" />
              <StepItem active={false} done={false} index="2" label="连接 NewAPI" />
              <StepItem active={false} done={false} index="3" label="运行策略" />
              <StepItem active={false} done={false} index="4" label="完成" />
            </div>
          </aside>

          <Card className="min-h-[560px]">
            <CardHeader>
              <CardTitle>管理员账号</CardTitle>
              <CardDescription>{loading ? "正在读取控制台状态。" : "第一次提交的账号和密码会成为管理员账号。"}</CardDescription>
            </CardHeader>
            <CardContent className="max-w-xl">
              {form}
            </CardContent>
          </Card>
        </section>
      </main>
    )
  }

  return (
    <main className="console-shell flex min-h-screen items-center justify-center px-4 py-10">
      <section className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_440px] lg:items-center">
        <div className="hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-2 text-sm text-stone-500 shadow-paper">
            <Terminal className="h-4 w-4 text-stone-400" />
            旁路健康控制台
          </div>
          <h1 className="mt-6 max-w-xl font-serif text-4xl font-normal leading-tight tracking-tight text-stone-900">{title}</h1>
        </div>
        <Card className="shadow-lift">
          <CardHeader>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-stone-200 bg-stone-50 text-stone-700">
              <KeyRound className="h-5 w-5" />
            </div>
            <CardTitle>{initialized ? "管理员登录" : "初始化管理员"}</CardTitle>
            <CardDescription>
              {loading
                ? "正在读取控制台状态。"
                : initialized
                  ? "输入管理员账号和密码进入控制台。"
                  : "第一次提交的账号和密码会成为管理员账号。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {form}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

function DashboardPage({ status, loading, t }: { status?: StatusSnapshot; loading: boolean; t: Translate }) {
  const counts = status?.summary.counts
  const cards = [
    { label: t("totalChannels"), value: status?.summary.total_channels ?? "-", icon: Workflow, tint: "text-stone-400" },
    { label: t("healthy"), value: counts?.healthy ?? 0, icon: CheckCircle2, tint: "text-emerald-600" },
    { label: t("degradedRecovering"), value: (counts?.degraded ?? 0) + (counts?.recovering ?? 0), icon: Gauge, tint: "text-amber-600" },
    { label: t("downDisabled"), value: (counts?.down ?? 0) + (counts?.auto_disabled ?? 0), icon: CircleAlert, tint: "text-rose-500" },
  ]
  const statusPie = counts
    ? Object.entries(counts).map(([name, value]) => ({ name, value }))
    : []
  const runTrend = [...(status?.runs || [])]
    .reverse()
    .map((run, index) => ({ name: `#${index + 1}`, ok: run.probes_ok, failed: run.probes_failed }))
  const modelBars = (status?.models || []).slice(0, 8).map((model) => ({
    name: model.model,
    healthy: model.healthy,
    risk: model.degraded + model.down + model.auto_disabled,
  }))

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.05 }
    }
  }

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }
  }

  return (
    <motion.div className="space-y-6" initial="hidden" animate="show" variants={containerVariants}>
      <motion.div variants={itemVariants}>
        <PageHead
          eyebrow={t("dashboardEyebrow")}
          title={t("dashboardTitle")}
          description={t("dashboardDesc")}
        />
      </motion.div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <motion.div key={card.label} variants={itemVariants}>
            <Card className="transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.99]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
                <CardTitle className="font-sans text-sm font-medium text-stone-500">{card.label}</CardTitle>
                <card.icon className={cn("h-4 w-4", card.tint)} />
              </CardHeader>
              <CardContent className="p-6 pt-0">
                <div className="font-data text-5xl font-light tracking-tight text-stone-900">
                  {loading ? <span className="text-stone-300">…</span> : <CountUp end={Number(card.value) || 0} duration={1.6} separator="," />}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <motion.div variants={itemVariants}>
          <Card className="h-full transition-all duration-300 ease-out hover:shadow-lift">
            <CardHeader>
              <CardTitle>{t("recentRuns")}</CardTitle>
              <CardDescription>{t("recentRunsDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="h-72 pt-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={runTrend}>
                  <defs>
                    <linearGradient id="fillOk" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#059669" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="fillFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#78716c', fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: '#78716c', fontSize: 12 }} />
                  <Tooltip cursor={{ stroke: '#e7e5e4' }} contentStyle={{ borderRadius: '12px', border: '1px solid #e7e5e4', boxShadow: '0 8px 24px -8px rgba(168, 162, 158, 0.35)' }} />
                  <Area type="monotone" dataKey="ok" stackId="1" stroke="#059669" strokeWidth={2} fill="url(#fillOk)" animationDuration={900} animationEasing="ease-out" />
                  <Area type="monotone" dataKey="failed" stackId="1" stroke="#f43f5e" strokeWidth={2} fill="url(#fillFailed)" animationDuration={900} animationEasing="ease-out" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={itemVariants}>
          <Card className="h-full transition-all duration-300 ease-out hover:shadow-lift">
            <CardHeader>
              <CardTitle>{t("statusDistribution")}</CardTitle>
              <CardDescription>{t("statusDistributionDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="h-72 pt-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="#ffffff" strokeWidth={2} animationDuration={900} animationEasing="ease-out">
                    {statusPie.map((_, index) => (
                      <Cell key={index} fill={["#a8a29e", "#059669", "#d97706", "#f43f5e", "#e11d48", "#d6d3d1", "#78716c"][index % 7]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e7e5e4', boxShadow: '0 8px 24px -8px rgba(168, 162, 158, 0.35)' }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>
      <motion.div variants={itemVariants}>
        <Card className="transition-all duration-300 ease-out hover:shadow-lift">
          <CardHeader>
            <CardTitle>{t("modelHealth")}</CardTitle>
            <CardDescription>{t("modelHealthDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="h-80 pt-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelBars} barGap={6}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#78716c', fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#78716c', fontSize: 12 }} />
                <Tooltip cursor={{ fill: '#fafaf9' }} contentStyle={{ borderRadius: '12px', border: '1px solid #e7e5e4', boxShadow: '0 8px 24px -8px rgba(168, 162, 158, 0.35)' }} />
                <Bar dataKey="healthy" fill="#059669" radius={[4, 4, 0, 0]} animationDuration={900} animationEasing="ease-out" />
                <Bar dataKey="risk" fill="#f43f5e" radius={[4, 4, 0, 0]} animationDuration={900} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}

function channelModelNames(channel: ChannelView) {
  const names = new Set<string>()
  for (const model of channel.models || []) {
    if (model.trim()) names.add(model.trim())
  }
  if (channel.test_model?.trim()) names.add(channel.test_model.trim())
  return Array.from(names).sort((left, right) => left.localeCompare(right))
}

function selectedProbeModel(channel: ChannelView, probeModels: Record<number, string>) {
  return probeModels[channel.channel_id] ?? channel.probe_models?.[0] ?? ""
}

function ChannelsPage({ token, header }: ProtectedProps) {
  const queryClient = useQueryClient()
  const channels = useQuery({ queryKey: ["channels"], queryFn: api.channels })
  const [probeModels, setProbeModels] = React.useState<Record<number, string>>({})
  const [action, setAction] = React.useState<{ type: "disable" | "enable"; channel: ChannelView } | null>(null)
  type ChannelAction = NonNullable<typeof action> | { type: "probe"; channel: ChannelView; probeModel: string }
  const toggleMutation = useMutation({
    mutationFn: (payload: { channelID: number; enabled: boolean; model: string }) =>
      api.setChannelProbeSettings(payload.channelID, payload.enabled, payload.model, token, header),
    onSuccess: () => queryClient.invalidateQueries(),
  })
  const mutation = useMutation({
    mutationFn: async (payload: ChannelAction) => {
      if (payload.type === "probe") {
        if (!payload.probeModel.trim()) throw new Error("请先选择模型")
        return api.probeChannel(
          payload.channel.channel_id,
          token,
          header,
          { model: payload.probeModel },
        )
      }
      if (payload.type === "disable") return api.disableChannel(payload.channel.channel_id, token, header)
      return api.enableChannel(payload.channel.channel_id, token, header)
    },
    onSuccess: () => {
      setAction(null)
      queryClient.invalidateQueries()
    },
  })
  const columns = React.useMemo<ColumnDef<ChannelView>[]>(
    () => [
      {
        accessorKey: "name",
        header: "渠道（自动探测开关）",
        cell: ({ row }) => {
          const channel = row.original
          const model = selectedProbeModel(channel, probeModels)
          return (
            <div className="flex items-center gap-3">
              {model ? (
                <Switch
                  checked={channel.watchdog_enabled}
                  disabled={!token || toggleMutation.isPending}
                  aria-label={`${channel.name} 自动巡检`}
                  onCheckedChange={(enabled) => toggleMutation.mutate({ channelID: channel.channel_id, enabled, model })}
                />
              ) : (
                <Button className="h-7 rounded-full px-2.5 text-xs text-stone-400" size="sm" variant="outline" disabled>
                  请先选择模型
                </Button>
              )}
              <div>
                <div className="font-medium">{channel.name}</div>
                <div className="text-xs text-muted-foreground">#{channel.channel_id} / {channel.group_name}</div>
              </div>
            </div>
          )
        },
      },
      { accessorKey: "watchdog_status", header: "状态", cell: ({ row }) => <StatusBadge status={row.original.watchdog_status} /> },
      { accessorKey: "last_latency_ms", header: "延迟", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{seconds(row.original.last_latency_ms)}</span> },
      {
        id: "probe_model",
        header: "探测模型",
        cell: ({ row }) => {
          const channel = row.original
          const selected = selectedProbeModel(channel, probeModels)
          const options = channelModelNames(channel).map((model) => ({ value: model, label: model }))
          return (
            <Combobox
              className="w-40 max-w-full"
              contentClassName="w-96 max-w-[calc(100vw-2rem)]"
              value={selected}
              onValueChange={(value) => {
                setProbeModels((current) => ({
                  ...current,
                  [channel.channel_id]: value,
                }))
                if (channel.watchdog_enabled) {
                  toggleMutation.mutate({ channelID: channel.channel_id, enabled: true, model: value })
                }
              }}
              options={options}
              placeholder="选择模型"
              searchPlaceholder="搜索模型"
              emptyText="没有模型"
            />
          )
        },
      },
      { accessorKey: "success_rate_1h", header: "1h", cell: ({ row }) => percent(row.original.success_rate_1h) },
      { accessorKey: "success_rate_24h", header: "24h", cell: ({ row }) => percent(row.original.success_rate_24h) },
      {
        id: "streak",
        header: "连续",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            F{row.original.consecutive_failures} / S{row.original.consecutive_successes}
          </span>
        ),
      },
      { accessorKey: "last_error", header: "最近错误", cell: ({ row }) => row.original.last_error || "-" },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const selectedModel = selectedProbeModel(row.original, probeModels)
          return (
            <div className="flex justify-end gap-2">
              <Button
                className={cn("rounded-full", !selectedModel && "text-stone-400")}
                size="sm"
                variant="outline"
                disabled={!token || mutation.isPending || !selectedModel}
                onClick={() => mutation.mutate({
                  type: "probe",
                  channel: row.original,
                  probeModel: selectedModel,
                })}
              >
                {selectedModel ? "探测" : "请先选择模型"}
              </Button>
              <Button className="rounded-full" size="sm" variant="outline" onClick={() => setAction({ type: "disable", channel: row.original })}>禁用</Button>
              <Button className="rounded-full" size="sm" variant="outline" onClick={() => setAction({ type: "enable", channel: row.original })}>启用</Button>
            </div>
          )
        },
      },
    ],
    [token, toggleMutation, mutation, probeModels],
  )

  return (
    <div className="space-y-6">
      <PageHead eyebrow="渠道" title="渠道" description="查看渠道健康、错误和延迟，并执行手动探测、禁用、恢复操作。" />
      <DataTable columns={columns} data={channels.data || []} searchKey="name" searchPlaceholder="搜索渠道名称" />
      {toggleMutation.error ? <p className="text-sm text-destructive">{toggleMutation.error.message}</p> : null}
      {!action && mutation.error ? <p className="text-sm text-destructive">{mutation.error.message}</p> : null}
      <Dialog open={!!action} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认操作</DialogTitle>
            <DialogDescription>
              {action ? `${action.type} #${action.channel.channel_id} ${action.channel.name}` : ""}
            </DialogDescription>
          </DialogHeader>
          {mutation.error ? <p className="text-sm text-destructive">{mutation.error.message}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>取消</Button>
            <Button onClick={() => action && mutation.mutate(action)} disabled={!token || mutation.isPending}>
              {mutation.isPending ? "执行中" : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ModelsPage() {
  const models = useQuery({ queryKey: ["models"], queryFn: api.models })
  const columns = React.useMemo<ColumnDef<ModelView>[]>(
    () => [
      { accessorKey: "model", header: "模型", cell: ({ row }) => <span className="font-medium">{row.original.model}</span> },
      { accessorKey: "group_name", header: "分组" },
      { accessorKey: "total_channels", header: "渠道" },
      { accessorKey: "healthy", header: "健康" },
      { accessorKey: "degraded", header: "降级" },
      { accessorKey: "down", header: "故障" },
      { accessorKey: "success_rate_1h", header: "1h", cell: ({ row }) => percent(row.original.success_rate_1h) },
      { accessorKey: "avg_latency_ms", header: "均延迟", cell: ({ row }) => seconds(row.original.avg_latency_ms) },
    ],
    [],
  )
  return (
    <div className="space-y-6">
      <PageHead eyebrow="模型" title="模型健康" description="按模型和分组聚合渠道状态，适合判断某个模型是否还有可用通路。" />
      <DataTable columns={columns} data={models.data || []} searchKey="model" searchPlaceholder="搜索模型" />
    </div>
  )
}

function EventsPage() {
  const events = useQuery({ queryKey: ["events"], queryFn: api.events })
  const columns = React.useMemo<ColumnDef<StatusEvent>[]>(
    () => [
      { accessorKey: "created_at", header: "时间", cell: ({ row }) => formatLocalDateTime(row.original.created_at) },
      { accessorKey: "channel_id", header: "渠道" },
      { accessorKey: "current_status", header: "状态", cell: ({ row }) => <StatusBadge status={row.original.current_status} /> },
      { accessorKey: "action", header: "动作", cell: ({ row }) => row.original.action || "-" },
      {
        accessorKey: "dry_run",
        header: "模式",
        cell: ({ row }) => {
          const dryRun = row.original.dry_run
          return (
            <Badge
              variant={dryRun ? "warning" : "success"}
              className="h-7 min-w-[4.75rem] justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-medium leading-none"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", dryRun ? "bg-amber-500" : "bg-emerald-500")} />
              <span>{dryRun ? "模拟运行" : "真实执行"}</span>
            </Badge>
          )
        },
      },
      { accessorKey: "reason", header: "原因" },
    ],
    [],
  )
  return (
    <div className="space-y-6">
      <PageHead eyebrow="事件" title="事件记录" description="状态切换和自动动作都会在这里留下解释。" />
      <DataTable columns={columns} data={events.data || []} searchKey="reason" searchPlaceholder="搜索原因" />
    </div>
  )
}

function RunsPage() {
  const runs = useQuery({ queryKey: ["runs"], queryFn: api.runs })
  const columns = React.useMemo<ColumnDef<RunView>[]>(
    () => [
      { accessorKey: "started_at", header: "开始时间", cell: ({ row }) => formatLocalDateTime(row.original.started_at) },
      { id: "status", accessorFn: (row) => runStatusLabel(row.status), header: "状态" },
      { accessorKey: "channels_seen", header: "渠道" },
      { accessorKey: "probes_total", header: "探测" },
      { accessorKey: "probes_ok", header: "成功" },
      { accessorKey: "probes_failed", header: "失败" },
      { accessorKey: "actions_taken", header: "动作" },
      { accessorKey: "error", header: "错误", cell: ({ row }) => row.original.error || "-" },
    ],
    [],
  )
  return (
    <div className="space-y-6">
      <PageHead eyebrow="巡检" title="巡检记录" description="每一轮 watchdog 运行的范围、探测结果和动作数量。" />
      <DataTable columns={columns} data={runs.data || []} searchKey="status" searchPlaceholder="搜索状态" />
    </div>
  )
}

type ProtectedProps = {
  token: string
  header: string
}

function RulesPage({ token, header }: ProtectedProps) {
  const queryClient = useQueryClient()
  const rules = useQuery({ queryKey: ["rules", token], queryFn: () => api.rules(token, header), enabled: !!token, refetchInterval: false })
  const form = useForm<RulesForm>({
    resolver: zodResolver(rulesSchema),
    defaultValues: defaultRulesForm,
    values: rules.data ? toRulesForm(rules.data) : undefined,
  })
  const mutation = useMutation({
    mutationFn: (values: RulesForm) => api.saveRules(fromRulesForm(values), token, header),
    onSuccess: () => queryClient.invalidateQueries(),
  })
  return (
    <div className="space-y-6">
      <PageHead eyebrow="策略" title="策略配置" description="失败阈值、恢复阈值、自动动作和错误分类都在这里维护，保存后立即生效。" />
      <form className="space-y-5" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <Card>
          <CardHeader>
            <CardTitle>运行策略</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <NumberField label="巡检间隔（秒）" name="interval_seconds" form={form} />
            <NumberField label="单渠道延迟（秒）" name="per_channel_delay_seconds" form={form} />
            <NumberField label="连续失败阈值" name="failure_threshold" form={form} />
            <NumberField label="降级阈值" name="degraded_failure_threshold" form={form} />
            <NumberField label="慢响应阈值（ms）" name="slow_latency_ms" form={form} />
            <div />
            <SwitchField label="模拟运行" name="dry_run" form={form} />
            <SwitchField label="自动禁用" name="auto_disable" form={form} />
            <SwitchField label="自动恢复" name="auto_recover" form={form} />
            <SwitchField label="尊重渠道 auto_ban" name="respect_channel_auto_ban" form={form} />
            <SwitchField label="探测手动禁用渠道" name="probe_manual_disabled" form={form} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>熔断器设置</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <SettingNumberField label="恢复成功阈值" name="recovery_threshold" form={form} description="半开状态下成功多少次后恢复渠道" />
            <SettingNumberField label="恢复等待时间（秒）" name="recovery_wait_seconds" form={form} description="熔断器打开后，等待多久后尝试恢复" />
            <SettingNumberField label="错误率阈值（%）" name="error_rate_threshold" form={form} description="错误率超过此值时打开熔断器" />
            <SettingNumberField label="最小请求数" name="error_rate_min_requests" form={form} description="计算错误率前的最小请求数" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>错误分类</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <TextareaField label="临时错误关键词" name="transient_error_patterns" form={form} />
            <TextareaField label="致命错误关键词" name="fatal_error_patterns" form={form} />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => form.reset(defaultRulesForm)}>重置</Button>
          <Button disabled={!token || mutation.isPending}>{mutation.isPending ? "保存中" : "保存策略"}</Button>
        </div>
        {mutation.error ? <p className="text-sm text-destructive">{mutation.error.message}</p> : null}
      </form>
    </div>
  )
}

function SettingsPage({ token, header }: ProtectedProps) {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: ["settings", token],
    queryFn: () => api.settings(token, header),
    enabled: !!token,
    refetchInterval: false,
  })
  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    values: settings.data ? toSettingsForm(settings.data) : undefined,
  })
  const mutation = useMutation({
    mutationFn: (values: SettingsForm) => {
      if (!settings.data) throw new Error("settings not loaded")
      return api.saveSettings(fromSettingsForm(values, settings.data.config), token, header)
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
  return (
    <div className="space-y-6">
      <PageHead eyebrow="设置" title="系统设置" description="连接、探测、自动动作。" />
      <Card>
        <CardHeader>
          <CardTitle>连接与发现</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-8" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
            <ConnectionFields form={form} hasAdminToken={settings.data?.has_admin_token} />
            <details className="rounded-xl border border-stone-200 p-4">
              <summary className="cursor-pointer text-sm font-medium text-stone-700">高级配置</summary>
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <AdvancedSettingsFields form={form} />
              </div>
            </details>
            <div className="lg:col-span-2 flex justify-end">
              <Button disabled={!token || mutation.isPending}>{mutation.isPending ? "保存中" : "保存设置"}</Button>
            </div>
            {mutation.error ? <p className="text-sm text-destructive lg:col-span-2">{mutation.error.message}</p> : null}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function SetupWizard({ token, header, username, onDone }: { token: string; header: string; username: string; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [step, setStep] = React.useState<SetupStep>("connection")
  const settings = useQuery({
    queryKey: ["settings", token],
    queryFn: () => api.settings(token, header),
    enabled: !!token,
    refetchInterval: false,
  })
  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    values: settings.data ? toSettingsForm(settings.data) : undefined,
  })
  const rules = useQuery({ queryKey: ["rules", token], queryFn: () => api.rules(token, header), enabled: !!token, refetchInterval: false })
  const rulesForm = useForm<RulesForm>({
    resolver: zodResolver(rulesSchema),
    defaultValues: defaultRulesForm,
    values: rules.data ? toRulesForm(rules.data) : undefined,
  })
  const saveMutation = useMutation({
    mutationFn: (payload: { values: SettingsForm; setupCompleted?: boolean; next?: SetupStep | "done" }) => {
      if (!settings.data) throw new Error("settings not loaded")
      return api.saveSettings(fromSettingsForm(payload.values, settings.data.config, { setupCompleted: payload.setupCompleted }), token, header)
    },
    onSuccess: (_response, payload) => {
      queryClient.invalidateQueries()
      if (payload.next === "policy" || payload.next === "finish") setStep(payload.next)
      if (payload.next === "done") onDone()
    },
  })
  const rulesMutation = useMutation({
    mutationFn: (values: RulesForm) => api.saveRules(fromRulesForm(values), token, header),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", token] })
      setStep("finish")
    },
  })
  const runMutation = useMutation({
    mutationFn: () => api.discoverChannels(token, header),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["status"] })
      queryClient.invalidateQueries({ queryKey: ["channels"] })
      queryClient.invalidateQueries({ queryKey: ["models"] })
      queryClient.invalidateQueries({ queryKey: ["events"] })
      queryClient.invalidateQueries({ queryKey: ["runs"] })
    },
  })

  function submitCurrent() {
    form.handleSubmit((values) =>
      saveMutation.mutate({
        values,
        setupCompleted: step === "finish",
        next: step === "connection" ? "policy" : step === "policy" ? "finish" : "done",
      }),
    )()
  }

  function saveThenTest() {
    form.handleSubmit((values) => {
      saveMutation.mutate({ values }, {
        onSuccess: () => runMutation.mutate(),
      })
    })()
  }

  return (
    <main className="console-shell min-h-screen px-4 py-8">
      <section className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-xl border border-stone-200 bg-white p-6 shadow-paper">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-medium text-stone-800">NewAPI Watchdog</div>
              <div className="text-xs text-stone-500">{username}</div>
            </div>
          </div>
          <div className="mt-8 space-y-2">
            <StepItem active={false} done index="1" label="管理员账号" />
            <StepItem active={step === "connection"} done={step !== "connection"} index="2" label="连接 NewAPI" />
            <StepItem active={step === "policy"} done={step === "finish"} index="3" label="运行策略" />
            <StepItem active={step === "finish"} done={false} index="4" label="完成" />
          </div>
        </aside>

        <Card className="min-h-[560px]">
          <CardHeader>
            <CardTitle>{step === "connection" ? "连接 NewAPI" : step === "policy" ? "运行策略" : "完成初始化"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {step === "connection" ? (
              <div className="space-y-6">
                <div className="grid gap-5 lg:grid-cols-2">
                  <ConnectionFields form={form} hasAdminToken={settings.data?.has_admin_token} />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={saveThenTest} disabled={runMutation.isPending || saveMutation.isPending || settings.isLoading}>
                    {runMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    发现渠道
                  </Button>
                  <Button onClick={submitCurrent} disabled={saveMutation.isPending || settings.isLoading}>
                    {saveMutation.isPending ? "保存中" : "下一步"}
                  </Button>
                </div>
                <RunFeedback mutation={runMutation} />
              </div>
            ) : null}

            {step === "policy" ? (
              <div className="space-y-6">
                <div className="grid gap-5 lg:grid-cols-2">
                  <NumberField label="巡检间隔（秒）" name="interval_seconds" form={rulesForm} />
                  <NumberField label="连续失败阈值" name="failure_threshold" form={rulesForm} />
                  <SwitchField label="模拟运行" name="dry_run" form={rulesForm} />
                </div>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                  <SettingNumberField label="恢复成功阈值" name="recovery_threshold" form={rulesForm} description="成功多少次后恢复渠道" />
                  <SettingNumberField label="恢复等待时间（秒）" name="recovery_wait_seconds" form={rulesForm} description="等待多久后尝试恢复" />
                  <SettingNumberField label="错误率阈值（%）" name="error_rate_threshold" form={rulesForm} description="超过后打开熔断器" />
                  <SettingNumberField label="最小请求数" name="error_rate_min_requests" form={rulesForm} description="计算错误率前的样本数" />
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep("connection")}>上一步</Button>
                  <Button onClick={() => rulesForm.handleSubmit((values) => rulesMutation.mutate(values))()} disabled={rulesMutation.isPending || rules.isLoading}>
                    {rulesMutation.isPending ? "保存中" : "下一步"}
                  </Button>
                </div>
              </div>
            ) : null}

            {step === "finish" ? (
              <div className="space-y-6">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5">
                  <div className="flex items-center gap-3 text-emerald-800">
                    <CheckCircle2 className="h-5 w-5" />
                    <div className="font-medium">初始化完成</div>
                  </div>
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep("policy")}>上一步</Button>
                  <Button onClick={submitCurrent} disabled={saveMutation.isPending}>
                    进入控制台
                  </Button>
                </div>
              </div>
            ) : null}

            {saveMutation.error ? <p className="text-sm text-destructive">{saveMutation.error.message}</p> : null}
            {rulesMutation.error ? <p className="text-sm text-destructive">{rulesMutation.error.message}</p> : null}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

function StepItem({ active, done, index, label }: { active: boolean; done: boolean; index: string; label: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-300 ease-out", active ? "bg-white text-stone-900 shadow-paper ring-1 ring-stone-200" : "text-stone-500")}>
      <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border border-stone-200 text-xs", done && "border-emerald-600 bg-emerald-600 text-white", active && !done && "border-stone-300 text-stone-700")}>
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index}
      </span>
      {label}
    </div>
  )
}

function ConnectionFields({ form, hasAdminToken }: { form: FormLike; hasAdminToken?: boolean }) {
  return (
    <>
      <InputField label="NewAPI 地址" name="newapi_base_url" form={form} placeholder="http://1Panel-new-api-u10x:3000" />
      <InputField label="管理 Token" name="admin_token" form={form} type="password" placeholder={hasAdminToken ? "已设置" : ""} />
      <InputField label="管理员用户 ID（默认 1）" name="admin_user_id" form={form} placeholder="1" />
      <InputField label="请求超时（秒）" name="timeout_seconds" form={form} type="number" />
    </>
  )
}

function AdvancedSettingsFields({ form }: { form: FormLike }) {
  return (
    <>
      <InputField label="管理 Token 请求头" name="admin_token_header" form={form} />
      <InputField label="管理 Token 前缀" name="admin_token_prefix" form={form} />
      <SelectField
        label="发现来源"
        name="discovery_source"
        form={form}
        options={[
          { value: "api", label: "API 接口" },
          { value: "sqlite", label: "只读 SQLite" },
          { value: "api_then_sqlite", label: "先 API 后 SQLite" },
        ]}
      />
      <InputField label="发现分页大小" name="discovery_page_size" form={form} type="number" />
      <InputField label="只读 SQLite 路径" name="discovery_sqlite_path" form={form} />
      <SelectField
        label="探测模式"
        name="probe_mode"
        form={form}
        options={[
          { value: "channel", label: "按渠道" },
          { value: "test_model", label: "按测试模型" },
          { value: "models", label: "按模型列表" },
        ]}
      />
      <InputField label="模型查询参数" name="model_query_param" form={form} />
      <InputField label="启用状态值" name="enabled_status_value" form={form} type="number" />
      <InputField label="禁用状态值" name="disabled_status_value" form={form} type="number" />
      <TextareaField label="SQLite 查询" name="discovery_sqlite_query" form={form} />
      <TextareaField label="额外请求头 JSON" name="headers_json" form={form} />
      <TextareaField label="端点模板 JSON" name="endpoints_json" form={form} />
      <TextareaField label="禁用请求体 JSON" name="disable_body_json" form={form} />
      <TextareaField label="恢复请求体 JSON" name="enable_body_json" form={form} />
    </>
  )
}

function PageHead({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-400">
        <ListFilter className="h-3.5 w-3.5" />
        {eyebrow}
      </div>
      <div>
        <h2 className="font-serif text-2xl font-normal tracking-tight text-stone-900">{title}</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-stone-500">{description}</p>
      </div>
    </div>
  )
}

type FormLike = ReturnType<typeof useForm<any>>

function InputField({ label, name, form, type = "text", placeholder }: { label: string; name: string; form: FormLike; type?: string; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} placeholder={placeholder} {...form.register(name)} />
      {form.formState.errors[name] ? <p className="text-xs text-destructive">{String(form.formState.errors[name]?.message)}</p> : null}
    </div>
  )
}

function NumberField(props: { label: string; name: string; form: FormLike }) {
  return <InputField {...props} type="number" />
}

function SettingNumberField({ label, name, form, description }: { label: string; name: string; form: FormLike; description: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" {...form.register(name)} />
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      {form.formState.errors[name] ? <p className="text-xs text-destructive">{String(form.formState.errors[name]?.message)}</p> : null}
    </div>
  )
}

function TextareaField({ label, name, form }: { label: string; name: string; form: FormLike }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Textarea className="font-mono text-xs" {...form.register(name)} />
      {form.formState.errors[name] ? <p className="text-xs text-destructive">{String(form.formState.errors[name]?.message)}</p> : null}
    </div>
  )
}

function SwitchField({ label, name, form }: { label: string; name: string; form: FormLike }) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <div className="flex items-center justify-between rounded-xl border border-stone-200 p-3.5 transition-colors hover:bg-stone-50">
          <Label>{label}</Label>
          <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
        </div>
      )}
    />
  )
}

function SelectField({
  label,
  name,
  form,
  options,
}: {
  label: string
  name: string
  form: FormLike
  options: Array<{ value: string; label: string }>
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <div className="space-y-2">
          <Label>{label}</Label>
          <Combobox
            value={field.value}
            onValueChange={field.onChange}
            options={options}
            placeholder={`选择${label}`}
            searchPlaceholder={`搜索${label}`}
          />
        </div>
      )}
    />
  )
}

function toRulesForm(policy: PolicyConfig): RulesForm {
  return {
    ...policy,
    transient_error_patterns: policy.transient_error_patterns.join("\n"),
    fatal_error_patterns: policy.fatal_error_patterns.join("\n"),
  }
}

function fromRulesForm(values: RulesForm): PolicyConfig {
  return {
    ...values,
    transient_error_patterns: splitLines(values.transient_error_patterns),
    fatal_error_patterns: splitLines(values.fatal_error_patterns),
  }
}

function toSettingsForm(response: SettingsResponse): SettingsForm {
  const cfg = response.config
  return {
    newapi_base_url: cfg.newapi.base_url,
    admin_token: "",
    admin_user_id: cfg.newapi.admin_user_id || "1",
    admin_token_header: cfg.newapi.admin_token_header,
    admin_token_prefix: cfg.newapi.admin_token_prefix,
    timeout_seconds: cfg.newapi.timeout_seconds,
    enabled_status_value: cfg.newapi.enabled_status_value,
    disabled_status_value: cfg.newapi.disabled_status_value,
    discovery_source: cfg.discovery.source,
    discovery_sqlite_path: cfg.discovery.sqlite_path,
    discovery_sqlite_query: cfg.discovery.sqlite_query,
    discovery_page_size: cfg.discovery.page_size,
    probe_mode: cfg.probe.mode,
    model_query_param: cfg.probe.model_query_param,
    headers_json: JSON.stringify(cfg.newapi.headers || {}, null, 2),
    endpoints_json: JSON.stringify(cfg.newapi.endpoints || {}, null, 2),
    disable_body_json: JSON.stringify(cfg.newapi.disable_action.body || {}, null, 2),
    enable_body_json: JSON.stringify(cfg.newapi.enable_action.body || {}, null, 2),
  }
}

function fromSettingsForm(
  values: SettingsForm,
  current: SettingsResponse["config"],
  options: { setupCompleted?: boolean } = {},
): SettingsResponse["config"] {
  return {
    ...current,
    setup: {
      ...current.setup,
      completed: options.setupCompleted ?? current.setup.completed,
    },
    discovery: {
      ...current.discovery,
      source: values.discovery_source,
      sqlite_path: values.discovery_sqlite_path,
      sqlite_query: values.discovery_sqlite_query,
      page_size: Number(values.discovery_page_size),
    },
    probe: {
      ...current.probe,
      mode: values.probe_mode,
      model_query_param: values.model_query_param,
    },
    newapi: {
      ...current.newapi,
      base_url: values.newapi_base_url,
      admin_token: values.admin_token,
      admin_user_id: values.admin_user_id || "1",
      admin_token_header: values.admin_token_header,
      admin_token_prefix: values.admin_token_prefix,
      timeout_seconds: Number(values.timeout_seconds),
      enabled_status_value: Number(values.enabled_status_value),
      disabled_status_value: Number(values.disabled_status_value),
      headers: parseJSON(values.headers_json, {}),
      endpoints: parseJSON(values.endpoints_json, {}),
      disable_action: {
        ...current.newapi.disable_action,
        body: parseJSON(values.disable_body_json, {}),
      },
      enable_action: {
        ...current.newapi.enable_action,
        body: parseJSON(values.enable_body_json, {}),
      },
    },
  }
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseJSON<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizePath(path: string) {
  if (path === "/" || path === "/status") return "/dashboard"
  if (navItems.some((item) => item.path === path)) return path
  return "/dashboard"
}

export default App
