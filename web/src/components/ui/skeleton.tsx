import * as React from "react"
import { cn } from "@/lib/utils"

/** 纸质暖石色调的骨架占位。加载态用它替代「加载中...」纯文字，消除空白感。 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-stone-200/70 dark:bg-stone-700/40", className)}
      {...props}
    />
  )
}

export { Skeleton }
