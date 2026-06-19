import type { StatusEvent } from "@/types"

/**
 * 把后端产出的英文 reason / action 翻译成「一句人话」的中文摘要。
 *
 * 后端真实句式来源：
 *   - internal/core/policy.go（EvaluateProbe 各分支的 Reason）
 *   - internal/watchdog/service.go（手动操作、错误率熔断 reason，以及 action 名）
 *
 * 设计原则：能识别的句式给出中文摘要，识别不了的原样保留为 detail，绝不丢信息。
 * dry_run 不再做成同级徽章，而是融进措辞「（模拟，未真正执行）」。
 */

export type Severity = "ok" | "warn" | "danger" | "muted"

export type EventSummary = {
  /** 中文人话摘要，时间线副行展示 */
  title: string
  /** 补充细节（多为后端原始片段），可选 */
  detail?: string
  /** 严重度，决定左侧色条与主徽章语义色 */
  severity: Severity
}

const actionLabels: Record<string, string> = {
  auto_disable: "自动禁用",
  auto_recover: "自动恢复",
  manual_disable: "手动禁用",
  manual_enable: "手动启用",
}

/** action key → 中文。未知或空返回空串。 */
export function actionLabel(action?: string): string {
  if (!action) return ""
  return actionLabels[action] || action
}

/** 由当前状态推导兜底严重度。 */
function severityFromStatus(status?: string): Severity {
  switch (status) {
    case "healthy":
      return "ok"
    case "degraded":
    case "recovering":
      return "warn"
    case "down":
    case "auto_disabled":
      return "danger"
    default:
      return "muted"
  }
}

/** dry_run 后缀措辞。 */
function runSuffix(dryRun: boolean): string {
  return dryRun ? "（模拟，未真正执行）" : ""
}

/**
 * 把一条事件翻译成结构化摘要。
 * 匹配顺序从「最具体的句式」到「最泛的兜底」。
 */
export function summarizeEvent(event: StatusEvent): EventSummary {
  const reason = (event.reason || "").trim()
  const lower = reason.toLowerCase()
  const dry = event.dry_run

  // —— 手动操作 ——
  if (event.action === "manual_disable") {
    return { title: `手动禁用渠道${runSuffix(dry)}`, severity: "muted" }
  }
  if (event.action === "manual_enable") {
    return { title: `手动启用渠道${runSuffix(dry)}`, severity: "ok" }
  }

  // —— NewAPI 侧被手动禁用（非看门狗操作）——
  if (lower.includes("disabled in newapi")) {
    return {
      title: "该渠道在 NewAPI 侧被手动禁用（非看门狗操作）",
      severity: "muted",
    }
  }

  // —— 错误率熔断：error rate X% reached threshold Y% over N recent probes ——
  const errorRate = reason.match(/error rate ([\d.]+)% reached threshold ([\d.]+)% over (\d+)/i)
  if (errorRate) {
    const [, rate, threshold, total] = errorRate
    const act = event.action === "auto_disable" ? (dry ? "模拟熔断" : "已熔断禁用") : "触发熔断"
    return {
      title: `错误率 ${rate}% 超过阈值 ${threshold}%（近 ${total} 次探测），${act}${dry ? "（未真正执行）" : ""}`,
      detail: reason,
      severity: "danger",
    }
  }

  // —— 恢复进度：probe succeeded with N/M recovery successes ——
  const recovering = reason.match(/probe succeeded with (\d+)\/(\d+) recovery successes/i)
  if (recovering) {
    const [, done, need] = recovering
    const reached = Number(done) >= Number(need)
    return {
      title: reached ? `探测恢复成功（${done}/${need}），渠道已恢复健康` : `探测恢复中（${done}/${need} 次成功）`,
      severity: reached ? "ok" : "warn",
    }
  }

  // —— 熔断渠道恢复进度：auto-disabled channel has N/M recovery successes ——
  const autoRecovering = reason.match(/auto-disabled channel has (\d+)\/(\d+) recovery successes/i)
  if (autoRecovering) {
    const [, done, need] = autoRecovering
    const act = event.action === "auto_recover" ? (dry ? "（模拟恢复）" : "（已自动恢复）") : ""
    return {
      title: `熔断渠道恢复进度 ${done}/${need}${act}`,
      severity: "warn",
    }
  }

  // —— 慢响应降级：probe succeeded but latency Xms is slow ——
  const slow = reason.match(/probe succeeded but latency (\d+)ms is slow/i)
  if (slow) {
    const [, ms] = slow
    return { title: `探测成功但延迟偏高（${ms} ms），判定降级`, severity: "warn" }
  }

  // —— 致命错误：fatal probe failure: ... ——
  if (lower.startsWith("fatal probe failure")) {
    const rest = reason.replace(/^fatal probe failure:\s*/i, "")
    const act = event.action === "auto_disable" ? `，${dry ? "模拟熔断" : "已熔断禁用"}` : ""
    return { title: `致命错误，渠道判定故障${act}`, detail: rest || reason, severity: "danger" }
  }

  // —— 探测成功 ——
  if (lower === "probe succeeded") {
    return { title: "探测成功", severity: "ok" }
  }

  // —— 自动禁用但原因是普通错误原文 ——
  if (event.action === "auto_disable") {
    return {
      title: `连续故障，${dry ? "模拟熔断（未真正执行）" : "已熔断禁用"}`,
      detail: reason || undefined,
      severity: "danger",
    }
  }
  if (event.action === "auto_recover") {
    return {
      title: `探测恢复，${dry ? "模拟恢复（未真正执行）" : "已自动恢复"}`,
      detail: reason || undefined,
      severity: "ok",
    }
  }

  // —— 兜底：识别不了的 reason 原样保留，严重度由状态推导 ——
  return {
    title: reason || "状态更新",
    severity: severityFromStatus(event.current_status),
  }
}
