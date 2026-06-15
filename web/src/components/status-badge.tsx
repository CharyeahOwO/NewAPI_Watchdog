import { Badge } from "@/components/ui/badge"
import type { ChannelStatus } from "@/types"

const labels: Record<ChannelStatus, string> = {
  unknown: "未知",
  healthy: "健康",
  degraded: "降级",
  down: "故障",
  auto_disabled: "自动禁用",
  manually_disabled: "手动禁用",
  recovering: "恢复中",
}

export function StatusBadge({ status }: { status: ChannelStatus | string }) {
  const variant =
    status === "healthy"
      ? "success"
      : status === "degraded" || status === "recovering"
        ? "warning"
        : status === "down"
          ? "destructive"
          : "muted"
  return <Badge variant={variant}>{labels[status as ChannelStatus] || status}</Badge>
}

