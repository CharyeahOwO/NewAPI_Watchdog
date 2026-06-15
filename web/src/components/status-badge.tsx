import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ChannelStatus } from "@/types"

const labels: Record<ChannelStatus, string> = {
  unknown: "未知",
  healthy: "健康",
  degraded: "降级",
  down: "故障",
  auto_disabled: "熔断",
  manually_disabled: "手动禁用",
  recovering: "恢复中",
}

export function StatusBadge({ status }: { status: ChannelStatus | string }) {
  const label = labels[status as ChannelStatus] || status
  const variant =
    status === "healthy"
      ? "success"
      : status === "degraded" || status === "recovering"
        ? "warning"
        : status === "down" || status === "auto_disabled"
          ? "destructive"
          : "muted"
  return (
    <Badge
      variant={variant}
      className={cn(
        "h-7 min-w-[4.75rem] justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-medium leading-none",
        status === "manually_disabled" && "border-stone-200 bg-stone-50 text-stone-500",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "healthy" && "bg-emerald-500",
          status === "degraded" && "bg-amber-500",
          status === "recovering" && "bg-amber-500",
          status === "down" && "bg-rose-500",
          status === "auto_disabled" && "bg-rose-500",
          status === "manually_disabled" && "bg-stone-400",
          status === "unknown" && "bg-stone-400",
        )}
      />
      <span>{label}</span>
    </Badge>
  )
}
