import * as React from "react"
import { Inbox, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** 统一的空状态：柔和图标 + 标题 +（可选）描述，替换散落的「暂无数据 / 没有匹配」文案。 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  className,
  children,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-stone-200 bg-stone-50 text-stone-400 shadow-paper">
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium text-stone-700">{title}</div>
        {description ? <div className="max-w-sm text-sm text-stone-400">{description}</div> : null}
      </div>
      {children}
    </div>
  )
}
