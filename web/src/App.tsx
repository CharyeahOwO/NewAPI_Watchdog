import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Controller, useForm } from "react-hook-form"
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Gauge,
  History,
  LayoutDashboard,
  ListFilter,
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
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api, getStoredToken, setStoredToken } from "@/lib/api"
import { cn, ms, percent } from "@/lib/utils"
import type {
  ChannelView,
  ModelView,
  PolicyConfig,
  RunView,
  SettingsResponse,
  StatusEvent,
  StatusSnapshot,
} from "@/types"

const navItems = [
  { path: "/dashboard", label: "总览", icon: LayoutDashboard },
  { path: "/channels", label: "渠道", icon: Workflow },
  { path: "/models", label: "模型", icon: Bot },
  { path: "/events", label: "事件", icon: History },
  { path: "/runs", label: "巡检", icon: Activity },
  { path: "/rules", label: "策略", icon: SlidersHorizontal },
  { path: "/settings", label: "设置", icon: Settings },
]

const rulesSchema = z.object({
  interval_seconds: z.coerce.number().int().min(10),
  per_channel_delay_seconds: z.coerce.number().min(0),
  failure_threshold: z.coerce.number().int().min(1),
  recovery_threshold: z.coerce.number().int().min(1),
  degraded_failure_threshold: z.coerce.number().int().min(1),
  slow_latency_ms: z.coerce.number().int().min(1),
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
  degraded_failure_threshold: 1,
  slow_latency_ms: 5000,
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
  admin_token_header: z.string().min(1),
  admin_token_prefix: z.string(),
  timeout_seconds: z.coerce.number().int().min(1),
  enabled_status_value: z.coerce.number().int(),
  disabled_status_value: z.coerce.number().int(),
  write_token: z.string(),
  write_token_header: z.string().min(1),
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

function App() {
  const [path, setPath] = React.useState(() => normalizePath(window.location.pathname))
  const [token, setToken] = React.useState(getStoredToken)
  const queryClient = useQueryClient()
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: api.bootstrap, refetchInterval: false })
  const status = useQuery({ queryKey: ["status"], queryFn: api.status })

  React.useEffect(() => {
    const onPop = () => setPath(normalizePath(window.location.pathname))
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  function navigate(next: string) {
    window.history.pushState({}, "", next)
    setPath(normalizePath(next))
  }

  function saveToken(next: string) {
    setStoredToken(next)
    setToken(next)
  }

  const header = bootstrap.data?.write_token_header || "X-Watchdog-Token"
  const runMutation = useMutation({
    mutationFn: () => api.runProbe(token, header),
    onSuccess: () => queryClient.invalidateQueries(),
  })

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
        return <DashboardPage status={status.data} loading={status.isLoading} />
    }
  })()

  return (
    <div className="console-shell min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-background/80 px-4 py-5 backdrop-blur-xl lg:block">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-foreground text-background">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">NewAPI Watchdog</div>
            <div className="text-xs text-muted-foreground">旁路健康控制台</div>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                path === item.path && "bg-foreground text-background hover:bg-foreground hover:text-background",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b bg-background/82 backdrop-blur-xl">
          <div className="px-4 py-3 sm:px-5 sm:py-4 lg:px-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>控制台</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                  <span className="text-foreground">{navItems.find((item) => item.path === path)?.label || "总览"}</span>
                </div>
                <h1 className="mt-0.5 break-words text-lg font-semibold tracking-tight sm:text-xl">
                  {bootstrap.data?.title || "NewAPI Channel Watchdog"}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.data?.dry_run ? "warning" : "success"}>{status.data?.dry_run ? "模拟运行" : "真实执行"}</Badge>
                <TokenDialog token={token} onSave={saveToken} header={header} />
                <Button size="sm" variant="outline" onClick={() => runMutation.mutate()} disabled={!token || runMutation.isPending}>
                  {runMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  立即巡检
                </Button>
              </div>
            </div>
            <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {navItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={cn(
                    "flex flex-none items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                    path === item.path
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </header>
        <main className="px-4 py-5 sm:px-5 lg:px-8">{content}</main>
      </div>
    </div>
  )
}

function DashboardPage({ status, loading }: { status?: StatusSnapshot; loading: boolean }) {
  const counts = status?.summary.counts
  const cards = [
    { label: "总渠道", value: status?.summary.total_channels ?? "-", icon: Workflow },
    { label: "健康", value: counts?.healthy ?? 0, icon: CheckCircle2 },
    { label: "降级/恢复", value: (counts?.degraded ?? 0) + (counts?.recovering ?? 0), icon: Gauge },
    { label: "故障/禁用", value: (counts?.down ?? 0) + (counts?.auto_disabled ?? 0), icon: CircleAlert },
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

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="总览"
        title="旁路健康总览"
        description="这里展示 NewAPI 渠道和模型的当前健康面，不接管业务流量，只解释状态变化。"
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight">{loading ? "..." : card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>最近巡检</CardTitle>
            <CardDescription>成功和失败探测数量的短期走势。</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={runTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="ok" stackId="1" stroke="#111827" fill="#111827" fillOpacity={0.12} />
                <Area type="monotone" dataKey="failed" stackId="1" stroke="#dc2626" fill="#dc2626" fillOpacity={0.16} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>状态分布</CardTitle>
            <CardDescription>渠道状态机当前计数。</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88}>
                  {statusPie.map((_, index) => (
                    <Cell key={index} fill={["#111827", "#16a34a", "#f59e0b", "#dc2626", "#737373", "#a3a3a3", "#d97706"][index % 7]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>模型健康面</CardTitle>
          <CardDescription>按模型聚合的健康渠道和风险渠道。</CardDescription>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={modelBars}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="healthy" fill="#111827" radius={[4, 4, 0, 0]} />
              <Bar dataKey="risk" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

function ChannelsPage({ token, header }: ProtectedProps) {
  const queryClient = useQueryClient()
  const channels = useQuery({ queryKey: ["channels"], queryFn: api.channels })
  const [action, setAction] = React.useState<{ type: "probe" | "disable" | "enable"; channel: ChannelView } | null>(null)
  const mutation = useMutation({
    mutationFn: async () => {
      if (!action) return null
      if (action.type === "probe") return api.probeChannel(action.channel.channel_id, token, header)
      if (action.type === "disable") return api.disableChannel(action.channel.channel_id, token, header)
      return api.enableChannel(action.channel.channel_id, token, header)
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
        header: "渠道",
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">#{row.original.channel_id} / {row.original.group_name}</div>
          </div>
        ),
      },
      { accessorKey: "watchdog_status", header: "状态", cell: ({ row }) => <StatusBadge status={row.original.watchdog_status} /> },
      { accessorKey: "last_latency_ms", header: "延迟", cell: ({ row }) => ms(row.original.last_latency_ms) },
      { accessorKey: "success_rate_1h", header: "1h", cell: ({ row }) => percent(row.original.success_rate_1h) },
      { accessorKey: "success_rate_24h", header: "24h", cell: ({ row }) => percent(row.original.success_rate_24h) },
      {
        id: "streak",
        header: "连续",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            F{row.original.consecutive_failures} / S{row.original.consecutive_successes}
          </span>
        ),
      },
      { accessorKey: "last_error", header: "最近错误", cell: ({ row }) => row.original.last_error || "-" },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setAction({ type: "probe", channel: row.original })}>探测</Button>
            <Button size="sm" variant="outline" onClick={() => setAction({ type: "disable", channel: row.original })}>禁用</Button>
            <Button size="sm" variant="outline" onClick={() => setAction({ type: "enable", channel: row.original })}>启用</Button>
          </div>
        ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-6">
      <PageHead eyebrow="渠道" title="渠道管理" description="查看渠道健康、错误和延迟，并执行手动探测、禁用、恢复操作。" />
      <DataTable columns={columns} data={channels.data || []} searchKey="name" searchPlaceholder="搜索渠道名称" />
      <Dialog open={!!action} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认操作</DialogTitle>
            <DialogDescription>
              {action ? `${action.type} #${action.channel.channel_id} ${action.channel.name}` : ""}
            </DialogDescription>
          </DialogHeader>
          {!token ? <p className="text-sm text-destructive">请先在右上角输入写操作 Token。</p> : null}
          {mutation.error ? <p className="text-sm text-destructive">{mutation.error.message}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>取消</Button>
            <Button onClick={() => mutation.mutate()} disabled={!token || mutation.isPending}>
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
      { accessorKey: "avg_latency_ms", header: "均延迟", cell: ({ row }) => ms(row.original.avg_latency_ms) },
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
      { accessorKey: "created_at", header: "时间" },
      { accessorKey: "channel_id", header: "渠道" },
      { accessorKey: "current_status", header: "状态", cell: ({ row }) => <StatusBadge status={row.original.current_status} /> },
      { accessorKey: "action", header: "动作", cell: ({ row }) => row.original.action || "-" },
      { accessorKey: "dry_run", header: "模式", cell: ({ row }) => (row.original.dry_run ? <Badge variant="warning">模拟运行</Badge> : <Badge variant="success">真实执行</Badge>) },
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
      { accessorKey: "started_at", header: "开始时间" },
      { accessorKey: "status", header: "状态" },
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
      {!token ? <AuthRequired /> : null}
      <Card>
        <CardHeader>
          <CardTitle>运行策略</CardTitle>
          <CardDescription>建议先保持模拟运行，确认事件解释符合预期后再切到真实执行。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5 lg:grid-cols-2" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
            <NumberField label="巡检间隔（秒）" name="interval_seconds" form={form} />
            <NumberField label="单渠道延迟（秒）" name="per_channel_delay_seconds" form={form} />
            <NumberField label="失败阈值" name="failure_threshold" form={form} />
            <NumberField label="恢复阈值" name="recovery_threshold" form={form} />
            <NumberField label="降级阈值" name="degraded_failure_threshold" form={form} />
            <NumberField label="慢响应阈值（ms）" name="slow_latency_ms" form={form} />
            <SwitchField label="模拟运行" name="dry_run" form={form} />
            <SwitchField label="自动禁用" name="auto_disable" form={form} />
            <SwitchField label="自动恢复" name="auto_recover" form={form} />
            <SwitchField label="尊重渠道 auto_ban" name="respect_channel_auto_ban" form={form} />
            <SwitchField label="探测手动禁用渠道" name="probe_manual_disabled" form={form} />
            <div />
            <TextareaField label="临时错误关键词" name="transient_error_patterns" form={form} />
            <TextareaField label="致命错误关键词" name="fatal_error_patterns" form={form} />
            <div className="lg:col-span-2 flex justify-end">
              <Button disabled={!token || mutation.isPending}>{mutation.isPending ? "保存中" : "保存策略"}</Button>
            </div>
            {mutation.error ? <p className="text-sm text-destructive lg:col-span-2">{mutation.error.message}</p> : null}
          </form>
        </CardContent>
      </Card>
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
      <PageHead eyebrow="设置" title="系统设置" description="NewAPI 连接、发现来源、探测模式和写操作鉴权都在后台保存，不再依赖环境变量。" />
      {!token ? <AuthRequired /> : null}
      <Card>
        <CardHeader>
          <CardTitle>连接与发现</CardTitle>
          <CardDescription>Token 字段留空表示保留当前值，不会被接口回显。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5 lg:grid-cols-2" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
            <InputField label="NewAPI 地址" name="newapi_base_url" form={form} />
            <InputField label="NewAPI 管理 Token" name="admin_token" form={form} type="password" placeholder={settings.data?.has_admin_token ? "已设置，留空保留" : "未设置"} />
            <InputField label="管理 Token 请求头" name="admin_token_header" form={form} />
            <InputField label="管理 Token 前缀" name="admin_token_prefix" form={form} />
            <InputField label="写操作 Token" name="write_token" form={form} type="password" placeholder={settings.data?.has_write_token ? "已设置，留空保留" : "未设置"} />
            <InputField label="写操作请求头" name="write_token_header" form={form} />
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
            <InputField label="请求超时（秒）" name="timeout_seconds" form={form} type="number" />
            <InputField label="启用状态值" name="enabled_status_value" form={form} type="number" />
            <InputField label="禁用状态值" name="disabled_status_value" form={form} type="number" />
            <TextareaField label="SQLite 查询" name="discovery_sqlite_query" form={form} />
            <TextareaField label="额外请求头 JSON" name="headers_json" form={form} />
            <TextareaField label="端点模板 JSON" name="endpoints_json" form={form} />
            <TextareaField label="禁用请求体 JSON" name="disable_body_json" form={form} />
            <TextareaField label="恢复请求体 JSON" name="enable_body_json" form={form} />
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

function PageHead({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        <ListFilter className="h-3.5 w-3.5" />
        {eyebrow}
      </div>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function TokenDialog({ token, onSave, header }: { token: string; onSave: (value: string) => void; header: string }) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState(token)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ShieldCheck className="h-4 w-4" />
        {token ? "已授权" : "输入 Token"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>写操作授权</DialogTitle>
            <DialogDescription>保存到浏览器本地，只用于调用需要鉴权的后台接口。请求头：{header}</DialogDescription>
          </DialogHeader>
          <Input value={value} onChange={(event) => setValue(event.target.value)} type="password" placeholder="X-Watchdog-Token" />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setValue(""); onSave(""); setOpen(false) }}>清除</Button>
            <Button onClick={() => { onSave(value); setOpen(false) }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AuthRequired() {
  return (
    <Card className="border-amber-200 bg-amber-50/70">
      <CardContent className="flex items-center gap-3 p-4 text-sm text-amber-900">
        <ShieldCheck className="h-4 w-4" />
        请先在右上角输入写操作 Token，才能读取和保存后台配置。
      </CardContent>
    </Card>
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
        <div className="flex items-center justify-between rounded-lg border p-3">
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
    <div className="space-y-2">
      <Label>{label}</Label>
      <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm" {...form.register(name)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
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
    admin_token_header: cfg.newapi.admin_token_header,
    admin_token_prefix: cfg.newapi.admin_token_prefix,
    timeout_seconds: cfg.newapi.timeout_seconds,
    enabled_status_value: cfg.newapi.enabled_status_value,
    disabled_status_value: cfg.newapi.disabled_status_value,
    write_token: "",
    write_token_header: cfg.auth.write_token_header,
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

function fromSettingsForm(values: SettingsForm, current: SettingsResponse["config"]): SettingsResponse["config"] {
  return {
    ...current,
    auth: {
      ...current.auth,
      write_token: values.write_token,
      write_token_header: values.write_token_header,
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
